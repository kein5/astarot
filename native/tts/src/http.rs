//! A minimal HTTP/1.1 client for one local request per connection.
//!
//! Only what speech.cpp's documented API needs: a GET or a JSON POST, a status
//! line and headers, and a body framed by `Content-Length`, chunked transfer
//! coding or the connection's end. Redirects are not followed.
//!
//! Every receive waits at most 20 ms at a time and then looks at an interrupt
//! flag, so cancellation is bounded even where shutting a socket down does not
//! wake a blocked receive (Winsock). The caller's timeout still bounds each
//! receive as a whole.

use std::io::{self, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

const POLL: Duration = Duration::from_millis(20);
const MAX_HEAD: usize = 64 * 1024;

/// Wakes a connection's reader from another thread. Never closes the socket;
/// the reader owns the final close.
#[derive(Clone)]
pub(crate) struct Interrupter {
    flag: Arc<AtomicBool>,
    stream: Weak<TcpStream>,
}

impl Interrupter {
    pub(crate) fn interrupt(&self) {
        self.flag.store(true, Ordering::SeqCst);
        if let Some(stream) = self.stream.upgrade() {
            let _ = stream.shutdown(Shutdown::Both);
        }
    }
}

#[derive(Debug)]
pub(crate) enum HttpError {
    Timeout,
    Interrupted,
    /// The connection or the response failed; [`Fault`] says how.
    Transport(Fault),
}

/// How a response failed to arrive (#861): the speech's status keeps it as a fixed word, so that a
/// failed read can be told apart without any of the response's bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Fault {
    /// The socket failed: the address did not resolve, a connect or a receive failed.
    Socket,
    /// The stream ended before the head, a body's announced length or a chunk was complete.
    EndedEarly,
    /// The head, a length or a chunk was not in the form HTTP/1.1 gives it.
    Malformed,
}

impl Fault {
    pub(crate) fn word(self) -> &'static str {
        match self {
            Fault::Socket => "socket",
            Fault::EndedEarly => "ended_early",
            Fault::Malformed => "malformed",
        }
    }
}

impl From<io::Error> for HttpError {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => HttpError::Timeout,
            _ => HttpError::Transport(Fault::Socket),
        }
    }
}

pub(crate) struct Connection {
    stream: Arc<TcpStream>,
    flag: Arc<AtomicBool>,
    host_header: String,
    /// The limit for each receive; `None` waits without limit.
    timeout: Option<Duration>,
    /// A limit for every receive from now on, whatever the per-receive timeout.
    deadline: Option<Instant>,
    buffer: Vec<u8>,
    start: usize,
}

/// Resolve and connect within `timeout`, trying each address in turn.
pub(crate) fn connect(host: &str, port: u16, timeout: Duration) -> Result<Connection, HttpError> {
    let addresses: Vec<SocketAddr> = (host, port).to_socket_addrs().map_err(|_| HttpError::Transport(Fault::Socket))?.collect();
    let mut last = HttpError::Transport(Fault::Socket);
    for address in addresses {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(stream) => {
                let _ = stream.set_nodelay(true);
                let host_header = if host.contains(':') { format!("[{host}]:{port}") } else { format!("{host}:{port}") };
                return Ok(Connection { stream: Arc::new(stream), flag: Arc::new(AtomicBool::new(false)), host_header, timeout: Some(timeout), deadline: None, buffer: Vec::new(), start: 0 });
            }
            Err(error) => last = error.into(),
        }
    }
    Err(last)
}

impl Connection {
    pub(crate) fn interrupter(&self) -> Interrupter {
        Interrupter { flag: self.flag.clone(), stream: Arc::downgrade(&self.stream) }
    }

    pub(crate) fn set_timeout(&mut self, timeout: Option<Duration>) {
        self.timeout = timeout;
    }

    pub(crate) fn set_deadline(&mut self, deadline: Option<Instant>) {
        self.deadline = deadline;
    }

    pub(crate) fn send(&mut self, method: &str, path: &str, body: Option<(&str, &[u8])>) -> Result<(), HttpError> {
        let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {}\r\nAccept-Encoding: identity\r\n", self.host_header);
        if let Some((content_type, body)) = body {
            head.push_str(&format!("Content-Length: {}\r\nContent-Type: {content_type}\r\n", body.len()));
        }
        head.push_str("\r\n");
        let mut request = head.into_bytes();
        if let Some((_, body)) = body {
            request.extend_from_slice(body);
        }
        if self.flag.load(Ordering::SeqCst) {
            return Err(HttpError::Interrupted);
        }
        let _ = self.stream.set_write_timeout(self.timeout);
        (&*self.stream).write_all(&request).map_err(|error| self.classify(error))
    }

    fn classify(&self, error: io::Error) -> HttpError {
        if self.flag.load(Ordering::SeqCst) {
            HttpError::Interrupted
        } else {
            error.into()
        }
    }

    /// Receive more bytes into the buffer. `Ok(0)` is the end of the stream.
    fn fill(&mut self) -> Result<usize, HttpError> {
        let deadline = match (self.timeout.map(|t| Instant::now() + t), self.deadline) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        let mut chunk = [0u8; 8192];
        loop {
            if self.flag.load(Ordering::SeqCst) {
                return Err(HttpError::Interrupted);
            }
            let wait = match deadline {
                None => POLL,
                Some(deadline) => {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        return Err(HttpError::Timeout);
                    }
                    remaining.min(POLL)
                }
            };
            self.stream.set_read_timeout(Some(wait)).map_err(|_| HttpError::Transport(Fault::Socket))?;
            match (&*self.stream).read(&mut chunk) {
                Ok(count) => {
                    if self.flag.load(Ordering::SeqCst) {
                        return Err(HttpError::Interrupted);
                    }
                    if self.start > 0 && self.start == self.buffer.len() {
                        self.buffer.clear();
                        self.start = 0;
                    }
                    self.buffer.extend_from_slice(&chunk[..count]);
                    return Ok(count);
                }
                Err(error) if matches!(error.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => continue,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(self.classify(error)),
            }
        }
    }

    fn buffered(&self) -> &[u8] {
        &self.buffer[self.start..]
    }

    fn consume(&mut self, count: usize) {
        self.start += count;
        if self.start == self.buffer.len() {
            self.buffer.clear();
            self.start = 0;
        }
    }

    fn read_line(&mut self) -> Result<String, HttpError> {
        loop {
            if let Some(end) = self.buffered().iter().position(|&b| b == b'\n') {
                let line = String::from_utf8_lossy(&self.buffered()[..end]).trim_end_matches('\r').to_owned();
                self.consume(end + 1);
                return Ok(line);
            }
            if self.buffered().len() > MAX_HEAD {
                return Err(HttpError::Transport(Fault::Malformed));
            }
            if self.fill()? == 0 {
                return Err(HttpError::Transport(Fault::EndedEarly));
            }
        }
    }

    /// Read the status line and headers.
    pub(crate) fn response(mut self) -> Result<Response, HttpError> {
        let status_line = self.read_line()?;
        let mut parts = status_line.splitn(3, ' ');
        let version = parts.next().unwrap_or("");
        let status = parts.next().and_then(|code| (code.len() == 3).then_some(code)).and_then(|code| code.parse::<u16>().ok());
        let Some(status) = status.filter(|_| version.starts_with("HTTP/1.")) else {
            return Err(HttpError::Transport(Fault::Malformed));
        };
        let mut headers = Vec::new();
        let mut size = 0;
        loop {
            let line = self.read_line()?;
            if line.is_empty() {
                break;
            }
            size += line.len();
            if size > MAX_HEAD || headers.len() >= 100 {
                return Err(HttpError::Transport(Fault::Malformed));
            }
            let (name, value) = line.split_once(':').ok_or(HttpError::Transport(Fault::Malformed))?;
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
        }
        let header = |name: &str| headers.iter().rev().find(|(n, _)| n == name).map(|(_, v)| v.as_str());
        let chunked = header("transfer-encoding").is_some_and(|value| value.to_ascii_lowercase().split(',').any(|v| v.trim() == "chunked"));
        // HEAD-like bodiless statuses do not occur for GET or POST here except these.
        let bodiless = status == 204 || status == 304 || (100..200).contains(&status);
        let framing = if bodiless {
            Framing::Length(0)
        } else if chunked {
            Framing::Chunked { remaining: 0, done: false }
        } else if let Some(length) = header("content-length") {
            Framing::Length(length.parse::<u64>().map_err(|_| HttpError::Transport(Fault::Malformed))?)
        } else {
            Framing::Close
        };
        Ok(Response { connection: self, status, headers, framing })
    }
}

enum Framing {
    /// Bytes still to read.
    Length(u64),
    Chunked {
        remaining: u64,
        done: bool,
    },
    Close,
}

pub(crate) struct Response {
    connection: Connection,
    pub(crate) status: u16,
    headers: Vec<(String, String)>,
    framing: Framing,
}

impl Response {
    pub(crate) fn header(&self, name: &str) -> Option<&str> {
        let name = name.to_ascii_lowercase();
        self.headers.iter().find(|(n, _)| *n == name).map(|(_, v)| v.as_str())
    }

    pub(crate) fn set_timeout(&mut self, timeout: Option<Duration>) {
        self.connection.set_timeout(timeout);
    }

    pub(crate) fn set_deadline(&mut self, deadline: Option<Instant>) {
        self.connection.set_deadline(deadline);
    }

    /// Body bytes still announced by `Content-Length` (Python's `response.length`).
    pub(crate) fn length_remaining(&self) -> Option<u64> {
        match self.framing {
            Framing::Length(remaining) => Some(remaining),
            _ => None,
        }
    }

    /// Up to `limit` body bytes that are available now, waiting for at least
    /// one. Empty at the end of the body (Python's `read1`).
    pub(crate) fn read_some(&mut self, limit: usize) -> Result<Vec<u8>, HttpError> {
        let connection = &mut self.connection;
        match &mut self.framing {
            Framing::Length(remaining) => {
                if *remaining == 0 {
                    return Ok(Vec::new());
                }
                if connection.buffered().is_empty() && connection.fill()? == 0 {
                    return Err(HttpError::Transport(Fault::EndedEarly));
                }
                let take = connection.buffered().len().min(limit).min(*remaining as usize);
                let data = connection.buffered()[..take].to_vec();
                connection.consume(take);
                *remaining -= take as u64;
                Ok(data)
            }
            Framing::Close => {
                if connection.buffered().is_empty() && connection.fill()? == 0 {
                    return Ok(Vec::new());
                }
                let take = connection.buffered().len().min(limit);
                let data = connection.buffered()[..take].to_vec();
                connection.consume(take);
                Ok(data)
            }
            Framing::Chunked { remaining, done } => {
                if *done {
                    return Ok(Vec::new());
                }
                if *remaining == 0 {
                    let line = connection.read_line()?;
                    let size = line.split(';').next().unwrap_or("").trim();
                    let size = u64::from_str_radix(size, 16).map_err(|_| HttpError::Transport(Fault::Malformed))?;
                    if size == 0 {
                        // Trailers end with an empty line.
                        while !connection.read_line()?.is_empty() {}
                        *done = true;
                        return Ok(Vec::new());
                    }
                    *remaining = size;
                }
                if connection.buffered().is_empty() && connection.fill()? == 0 {
                    return Err(HttpError::Transport(Fault::EndedEarly));
                }
                let take = connection.buffered().len().min(limit).min(*remaining as usize);
                let data = connection.buffered()[..take].to_vec();
                connection.consume(take);
                *remaining -= take as u64;
                if *remaining == 0 {
                    // The CRLF after the chunk's data.
                    if !connection.read_line()?.is_empty() {
                        return Err(HttpError::Transport(Fault::Malformed));
                    }
                }
                Ok(data)
            }
        }
    }

    /// Read the body up to `limit` bytes; `None` when it is longer.
    pub(crate) fn read_body(&mut self, limit: usize) -> Result<Option<Vec<u8>>, HttpError> {
        let mut body = Vec::new();
        loop {
            let chunk = self.read_some(8192)?;
            if chunk.is_empty() {
                return Ok(Some(body));
            }
            body.extend_from_slice(&chunk);
            if body.len() > limit {
                return Ok(None);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    fn serve(reply: &'static [u8]) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = socket.read(&mut request);
            socket.write_all(reply).unwrap();
        });
        port
    }

    fn get(port: u16) -> Response {
        let mut connection = connect("127.0.0.1", port, Duration::from_secs(2)).unwrap();
        connection.send("GET", "/", None).unwrap();
        connection.response().unwrap()
    }

    #[test]
    fn chunked_body_with_extensions_and_trailers() {
        let port = serve(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nX-A: 1\r\n\r\n3;x=y\r\nabc\r\n2\r\nde\r\n0\r\nT: v\r\n\r\n");
        let mut response = get(port);
        assert_eq!(response.status, 200);
        assert_eq!(response.header("x-a"), Some("1"));
        assert_eq!(response.read_body(10).unwrap().unwrap(), b"abcde");
        assert_eq!(response.length_remaining(), None);
    }

    #[test]
    fn content_length_and_close_framing() {
        let mut response = get(serve(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabcdef"));
        assert_eq!(response.read_body(10).unwrap().unwrap(), b"abc");
        assert_eq!(response.length_remaining(), Some(0));
        let mut response = get(serve(b"HTTP/1.0 200 OK\r\n\r\nxyz"));
        assert_eq!(response.read_body(2).unwrap(), None);
    }

    #[test]
    fn truncated_bodies_are_transport_errors() {
        let mut response = get(serve(b"HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nabc"));
        assert!(matches!(response.read_body(10), Err(HttpError::Transport(Fault::EndedEarly))));
        let mut response = get(serve(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nab"));
        assert!(matches!(response.read_body(10), Err(HttpError::Transport(Fault::EndedEarly))));
    }

    #[test]
    fn a_chunk_out_of_form_is_told_from_one_that_ended_early() {
        // #861: which of the two a failed speech read was is kept in the speech's status.
        let mut response = get(serve(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\nab"));
        assert!(matches!(response.read_body(10), Err(HttpError::Transport(Fault::Malformed))));
        let mut response = get(serve(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nabXY\r\n"));
        assert!(matches!(response.read_body(10), Err(HttpError::Transport(Fault::Malformed))));
        let port = serve(b"HTTP/1.1 200 OK\r\nContent-Le");
        let mut connection = connect("127.0.0.1", port, Duration::from_secs(2)).unwrap();
        connection.send("GET", "/", None).unwrap();
        assert!(matches!(connection.response(), Err(HttpError::Transport(Fault::EndedEarly))));
        assert_eq!([Fault::Socket.word(), Fault::EndedEarly.word(), Fault::Malformed.word()], ["socket", "ended_early", "malformed"]);
    }

    #[test]
    fn malformed_status_is_rejected() {
        let port = serve(b"SPEECH 200 OK\r\n\r\n");
        let mut connection = connect("127.0.0.1", port, Duration::from_secs(2)).unwrap();
        connection.send("GET", "/", None).unwrap();
        assert!(matches!(connection.response(), Err(HttpError::Transport(Fault::Malformed))));
    }
}
