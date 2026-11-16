//! Plain clients for the servers the backend starts: an HTTP GET, a WebSocket handshake and
//! the reading of text frames. Everything stays on loopback addresses.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

/// Where [`free_port`] takes its ports from: below the ranges the OS picks ports from by
/// itself (Linux from 32768, Windows and macOS from 49152).
const PORTS_FROM: u32 = 20000;
const PORTS: u32 = 12000;

/// A port for a server the backend starts later from its settings, which take no port 0.
///
/// A port the OS chose for port 0 and that was let go can be chosen again, for another
/// listener or as the local port of any outgoing connection, before the backend binds it;
/// tests running at the same time then took each other's ports. These ports come from a
/// range the OS never picks from, each one only once in this process (starting at a place
/// that depends on the process, for test processes running side by side), and only when
/// nothing listens on it right now.
pub fn free_port() -> u16 {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let start = std::process::id().wrapping_mul(7919) % PORTS;
    loop {
        let next = NEXT.fetch_add(1, Ordering::SeqCst);
        assert!(next < PORTS, "no free test port left");
        let port = (PORTS_FROM + (start + next) % PORTS) as u16;
        if port_free("127.0.0.1", port) {
            return port;
        }
    }
}

/// Whether `host:port` can be bound (nothing listens there).
pub fn port_free(host: &str, port: u16) -> bool {
    TcpListener::bind((host, port)).is_ok()
}

/// Waits up to 5 s for `condition`.
pub fn eventually(what: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(Instant::now() < deadline, "{what} did not happen within 5 s");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn connect(host: &str, port: u16) -> TcpStream {
    let stream = TcpStream::connect((host, port)).unwrap_or_else(|e| panic!("connect to {host}:{port}: {e}"));
    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    stream
}

/// `GET path` with a `Host` header (and more headers); the status and the body.
pub fn http_get(host: &str, port: u16, path: &str, host_header: &str, extra: &str) -> (u16, String) {
    let mut stream = connect(host, port);
    write!(stream, "GET {path} HTTP/1.1\r\nHost: {host_header}\r\n{extra}Connection: close\r\n\r\n").unwrap();
    let mut response = Vec::new();
    let _ = stream.read_to_end(&mut response);
    let text = String::from_utf8_lossy(&response).into_owned();
    let status = text.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let body = text.split_once("\r\n\r\n").map(|(_, body)| body.to_string()).unwrap_or_default();
    (status, body)
}

/// The OBS page or metadata as OBS asks for it.
pub fn obs_get(host: &str, port: u16, path: &str) -> (u16, String) {
    http_get(host, port, path, &format!("{host}:{port}"), "")
}

/// Opens a WebSocket with `?token=`; the status of the handshake and, on 101, the connection.
pub fn websocket(host: &str, port: u16, token: Option<&str>) -> (u16, Option<TcpStream>) {
    let mut stream = connect(host, port);
    let query = token.map(|t| format!("?token={t}")).unwrap_or_default();
    write!(
        stream,
        "GET /{query} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
         Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    .unwrap();
    // Byte by byte, so that nothing after the head is taken from the frames.
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        match stream.read(&mut byte) {
            Ok(1) => head.push(byte[0]),
            _ => break,
        }
    }
    let text = String::from_utf8_lossy(&head);
    let status = text.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    (status, (status == 101).then_some(stream))
}

pub fn websocket_status(host: &str, port: u16, token: Option<&str>) -> u16 {
    websocket(host, port, token).0
}

/// The next text frame from the server; `None` when the connection closed or nothing came.
pub fn read_text(stream: &mut TcpStream, timeout: Duration) -> Option<String> {
    stream.set_read_timeout(Some(timeout)).unwrap();
    loop {
        let mut head = [0u8; 2];
        stream.read_exact(&mut head).ok()?;
        let opcode = head[0] & 0x0f;
        let mut length = u64::from(head[1] & 0x7f);
        if length == 126 {
            let mut extended = [0u8; 2];
            stream.read_exact(&mut extended).ok()?;
            length = u64::from(u16::from_be_bytes(extended));
        } else if length == 127 {
            let mut extended = [0u8; 8];
            stream.read_exact(&mut extended).ok()?;
            length = u64::from_be_bytes(extended);
        }
        let mut payload = vec![0u8; length as usize];
        stream.read_exact(&mut payload).ok()?;
        match opcode {
            1 => return String::from_utf8(payload).ok(),
            8 => return None,
            _ => continue,
        }
    }
}

/// Whether the server closed the connection within `timeout`.
pub fn closed(stream: &mut TcpStream, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        stream.set_read_timeout(Some(Duration::from_millis(200))).unwrap();
        let mut buffer = [0u8; 256];
        match stream.read(&mut buffer) {
            Ok(0) => return true,
            Ok(n) if buffer[..n].first().is_some_and(|b| b & 0x0f == 8) => return true,
            Ok(_) => continue,
            Err(error) if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(_) => return true,
        }
    }
    false
}
