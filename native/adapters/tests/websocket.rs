//! Mirrors the module tests of `src-python/test/test_websocket_*.py` for
//! `websocket_server.py`: token checks, limits, slow clients, start and stop, TLS.

mod common;

use std::io::{Read, Write};
use std::net::TcpStream as StdTcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::Message;
use vrct_adapters::websocket::{
    Incoming, SendError, StartError, WebSocketServer, INCOMING_MESSAGE_BURST, MAX_CLIENTS, MAX_INCOMING_MESSAGE_SIZE,
    MAX_OPENING_CONNECTIONS, MAX_OUTGOING_MESSAGE_SIZE, MAX_PENDING_MESSAGES,
};

const TOKEN: &str = "test-token";

fn started(token: &str) -> (WebSocketServer, u16) {
    let server = WebSocketServer::new("127.0.0.1", 0, Some(token.to_string()), None);
    server.start(Duration::from_secs(5)).unwrap();
    let port = server.local_addrs()[0].port();
    (server, port)
}

fn wait_for_clients(server: &WebSocketServer, count: usize) {
    let end = Instant::now() + Duration::from_secs(5);
    while server.client_count() != count && Instant::now() < end {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(server.client_count(), count);
}

type Client = tokio_tungstenite::WebSocketStream<TcpStream>;

async fn connect(port: u16, token: Option<&str>) -> Result<Client, tokio_tungstenite::tungstenite::Error> {
    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let url = match token {
        Some(token) => format!("ws://127.0.0.1:{port}/?token={token}"),
        None => format!("ws://127.0.0.1:{port}/"),
    };
    tokio_tungstenite::client_async(url, stream).await.map(|(socket, _)| socket)
}

async fn recv_text<S>(client: &mut tokio_tungstenite::WebSocketStream<S>) -> String
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    loop {
        match tokio::time::timeout(Duration::from_secs(5), client.next()).await.unwrap() {
            Some(Ok(Message::Text(text))) => return text.as_str().to_string(),
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
            other => panic!("expected text, got {other:?}"),
        }
    }
}

/// The raw handshake reply to `path`.
fn raw_handshake(port: u16, path: &str) -> String {
    let mut sock = StdTcpStream::connect(("127.0.0.1", port)).unwrap();
    sock.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(
        sock,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
         Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    .unwrap();
    let mut reply = Vec::new();
    let mut byte = [0u8; 1];
    while !reply.ends_with(b"\r\n\r\n") {
        if sock.read(&mut byte).unwrap() == 0 {
            break;
        }
        reply.push(byte[0]);
    }
    String::from_utf8_lossy(&reply).into_owned()
}

#[test]
fn a_missing_or_wrong_token_is_refused_before_the_handshake() {
    let (server, port) = started(TOKEN);
    for path in ["/", "/?token=", "/?token=wrong", "/?other=test-token", "/?token=test-token-extra"] {
        let reply = raw_handshake(port, path);
        assert!(reply.starts_with("HTTP/1.1 403"), "{path}: {reply}");
    }
    assert!(raw_handshake(port, "/?token=test-token").starts_with("HTTP/1.1 101"));
    // Percent escapes are decoded like Python's parse_qs.
    assert!(raw_handshake(port, "/?token=test%2Dtoken").starts_with("HTTP/1.1 101"));
    server.stop();
}

#[test]
fn starting_needs_a_token() {
    for token in [None, Some(String::new()), Some("   ".to_string())] {
        let server = WebSocketServer::new("127.0.0.1", 0, token, None);
        assert_eq!(server.start(Duration::from_secs(5)), Err(StartError::TokenRequired));
        assert!(server.is_stopped());
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_right_token_receives_messages_in_order() {
    let (server, port) = started(TOKEN);
    let mut client = connect(port, Some(TOKEN)).await.unwrap();
    wait_for_clients(&server, 1);
    for index in 0..10 {
        server.send(&format!("message {index}")).unwrap();
    }
    for index in 0..10 {
        assert_eq!(recv_text(&mut client).await, format!("message {index}"));
    }
    assert!(connect(port, Some("wrong")).await.is_err());
    server.stop();
}

#[test]
fn start_fails_when_the_port_is_taken_and_stays_down() {
    let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port();
    let server = WebSocketServer::new("127.0.0.1", port, Some(TOKEN.into()), None);
    assert!(matches!(server.start(Duration::from_secs(5)), Err(StartError::Io(_))));
    assert!(!server.is_running());
    assert!(server.is_stopped());
    drop(taken);
    // The same object can start once the port is free.
    server.start(Duration::from_secs(5)).unwrap();
    assert!(server.is_running());
    server.stop();
    assert!(server.is_stopped());
}

#[test]
fn start_returns_once_the_server_is_listening_and_stop_closes_it() {
    let (server, port) = started(TOKEN);
    assert!(server.is_running());
    assert!(StdTcpStream::connect(("127.0.0.1", port)).is_ok());
    server.stop();
    assert!(server.is_stopped());
    assert!(!server.is_running());
    assert!(StdTcpStream::connect(("127.0.0.1", port)).is_err());
    // Sending after stop does nothing and reports nothing.
    assert_eq!(server.send("after stop"), Ok(()));
    // And it starts again.
    server.start(Duration::from_secs(5)).unwrap();
    server.stop();
}

#[test]
fn a_start_past_its_deadline_never_listens() {
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let server = WebSocketServer::new("127.0.0.1", port, Some(TOKEN.into()), None);
    assert_eq!(server.start(Duration::ZERO), Err(StartError::Timeout));
    std::thread::sleep(Duration::from_millis(200));
    assert!(StdTcpStream::connect(("127.0.0.1", port)).is_err());
    assert!(!server.is_running());
    // Starting right after the timeout works.
    server.start(Duration::from_secs(5)).unwrap();
    server.stop();
}

#[test]
fn concurrent_starts_share_one_attempt() {
    let server = WebSocketServer::new("127.0.0.1", 0, Some(TOKEN.into()), None);
    let first = server.begin_start(Duration::from_secs(5)).unwrap();
    let second = server.begin_start(Duration::from_secs(5)).unwrap();
    assert!(Arc::ptr_eq(&first, &second));
    server.wait_started(&first).unwrap();
    server.stop();
}

#[test]
fn stop_cancels_a_pending_start() {
    let server = WebSocketServer::new("127.0.0.1", 0, Some(TOKEN.into()), None);
    let run = server.begin_start(Duration::from_secs(5)).unwrap();
    server.stop();
    assert!(server.wait_started(&run).is_err());
    assert!(!server.is_running());
}

#[test]
fn admission_bounds_messages_and_utf8_bytes() {
    let (server, _port) = started(TOKEN);
    assert_eq!(server.send(&"x".repeat(MAX_OUTGOING_MESSAGE_SIZE + 1)), Err(SendError::TooLarge));
    // Multi-byte text counts in UTF-8 bytes: 3 bytes a character.
    assert_eq!(server.send(&"あ".repeat(MAX_OUTGOING_MESSAGE_SIZE / 3 + 1)), Err(SendError::TooLarge));
    assert_eq!(server.send(&"x".repeat(MAX_OUTGOING_MESSAGE_SIZE)), Ok(()));
    server.stop();
}

#[test]
fn a_full_queue_is_reported_not_dropped() {
    // Fill the queue faster than the loop drains it: at some point the 129th message
    // in flight or the 4 MiB budget is refused.
    let (server, _port) = started(TOKEN);
    let payload = "x".repeat(MAX_OUTGOING_MESSAGE_SIZE);
    let mut refused = false;
    for _ in 0..(MAX_PENDING_MESSAGES * 4) {
        if server.send(&payload) == Err(SendError::QueueFull) {
            refused = true;
            break;
        }
    }
    assert!(refused);
    // The loop drains what was admitted and accepts again.
    let end = Instant::now() + Duration::from_secs(5);
    while server.send("small") == Err(SendError::QueueFull) && Instant::now() < end {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(server.send("small"), Ok(()));
    server.stop();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_client_that_stops_reading_does_not_stall_the_others() {
    let (server, port) = started(TOKEN);
    let slow = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    {
        let mut slow = &slow;
        write!(
            slow,
            "GET /?token={TOKEN} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
             Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        .unwrap();
    }
    let mut fast = connect(port, Some(TOKEN)).await.unwrap();
    wait_for_clients(&server, 2);
    let payload = "x".repeat(60_000);
    let total = 600; // about 36 MB: far more than the slow client's socket buffers hold
    for index in 0..total {
        server.send(&format!("{index}:{payload}")).unwrap();
        let received = recv_text(&mut fast).await;
        assert_eq!(received.split(':').next().unwrap(), index.to_string());
    }
    // The slow client was cut off.
    wait_for_clients(&server, 1);
    drop(slow);
    server.stop();
}

#[tokio::test(flavor = "multi_thread")]
async fn incoming_messages_over_the_limit_close_the_connection() {
    let (server, port) = started(TOKEN);
    let mut client = connect(port, Some(TOKEN)).await.unwrap();
    wait_for_clients(&server, 1);
    client.send(Message::text("y".repeat(MAX_INCOMING_MESSAGE_SIZE + 1))).await.unwrap();
    let next = tokio::time::timeout(Duration::from_secs(5), client.next()).await.unwrap();
    match next {
        Some(Ok(Message::Close(Some(frame)))) => assert_eq!(frame.code, CloseCode::Size),
        Some(Ok(Message::Text(_))) => panic!("still open"),
        _ => {}
    }
    wait_for_clients(&server, 0);
    server.stop();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_flooding_client_is_closed_with_1008_and_the_others_keep_receiving() {
    let (server, port) = started(TOKEN);
    let mut listener = connect(port, Some(TOKEN)).await.unwrap();
    let mut flooder = connect(port, Some(TOKEN)).await.unwrap();
    wait_for_clients(&server, 2);
    let mut sent = 0;
    for _ in 0..500 {
        if flooder.send(Message::text("spam ".repeat(100))).await.is_err() {
            break;
        }
        sent += 1;
    }
    let mut code = None;
    while let Ok(Some(Ok(message))) = tokio::time::timeout(Duration::from_secs(5), flooder.next()).await {
        if let Message::Close(frame) = message {
            code = frame.map(|f| f.code);
            break;
        }
    }
    assert_eq!(code, Some(CloseCode::Policy));
    assert!(sent > INCOMING_MESSAGE_BURST);
    wait_for_clients(&server, 1);
    server.send("still here").unwrap();
    assert_eq!(recv_text(&mut listener).await, "still here");
    server.stop();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_client_that_sends_a_little_stays_connected_and_reaches_the_handler() {
    let (server, port) = started(TOKEN);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    server.set_message_handler(move |_, incoming| sink.lock().unwrap().push(incoming));
    let mut client = connect(port, Some(TOKEN)).await.unwrap();
    wait_for_clients(&server, 1);
    for index in 0..5 {
        client.send(Message::text(format!("hello {index}"))).await.unwrap();
    }
    // Wait until the handler has had all five; a flood would have closed the client by then.
    let end = Instant::now() + Duration::from_secs(5);
    while seen.lock().unwrap().len() < 5 && Instant::now() < end {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    server.send("reply").unwrap();
    assert_eq!(recv_text(&mut client).await, "reply");
    assert_eq!(server.client_count(), 1);
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen, (0..5).map(|i| Incoming::Text(format!("hello {i}"))).collect::<Vec<_>>());
    server.stop();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_new_token_shuts_out_the_old_one_and_its_open_connections() {
    let (server, port) = started("old-token");
    let mut client = connect(port, Some("old-token")).await.unwrap();
    wait_for_clients(&server, 1);
    server.set_token("new-token").unwrap();
    wait_for_clients(&server, 0);
    let closed = tokio::time::timeout(Duration::from_secs(5), client.next()).await.unwrap();
    assert!(!matches!(closed, Some(Ok(Message::Text(_)))));
    assert!(connect(port, Some("old-token")).await.is_err());
    let mut renewed = connect(port, Some("new-token")).await.unwrap();
    wait_for_clients(&server, 1);
    server.send("hello").unwrap();
    assert_eq!(recv_text(&mut renewed).await, "hello");
    server.stop();
}

#[test]
fn an_empty_token_is_never_set() {
    let server = WebSocketServer::new("127.0.0.1", 0, Some(TOKEN.into()), None);
    for token in ["", "   "] {
        assert!(server.set_token(token).is_err());
    }
    server.start(Duration::from_secs(5)).unwrap();
    let port = server.local_addrs()[0].port();
    assert!(raw_handshake(port, "/?token=test-token").starts_with("HTTP/1.1 101"));
    server.stop();
}

#[tokio::test(flavor = "multi_thread")]
async fn stopping_tells_clients_the_server_is_going_away() {
    let (server, port) = started(TOKEN);
    let mut client = connect(port, Some(TOKEN)).await.unwrap();
    wait_for_clients(&server, 1);
    let stopper = std::thread::spawn(move || server.stop());
    let next = tokio::time::timeout(Duration::from_secs(5), client.next()).await.unwrap();
    if let Some(Ok(Message::Close(Some(frame)))) = next {
        assert_eq!(frame.code, CloseCode::Away);
    }
    stopper.join().unwrap();
}

mod tls {
    use super::*;
    use rustls::pki_types::ServerName;
    use tokio_rustls::TlsConnector;
    use vrct_adapters::tls::server_config;

    async fn connect_tls(
        port: u16,
        client: Arc<rustls::ClientConfig>,
        token: &str,
    ) -> Result<tokio_tungstenite::WebSocketStream<tokio_rustls::client::TlsStream<TcpStream>>, String> {
        let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let stream = TlsConnector::from(client)
            .connect(ServerName::try_from("127.0.0.1").unwrap(), stream)
            .await
            .map_err(|e| e.to_string())?;
        tokio_tungstenite::client_async(format!("wss://127.0.0.1:{port}/?token={token}"), stream)
            .await
            .map(|(socket, _)| socket)
            .map_err(|e| e.to_string())
    }

    fn tls_server() -> (WebSocketServer, u16, common::Certificate) {
        let dir = common::temp_dir("ws-tls");
        let cert = common::make_certificate(&dir, "127.0.0.1", "server");
        let config = server_config(&cert.cert_file, &cert.key_file).unwrap();
        let server = WebSocketServer::new("127.0.0.1", 0, Some(TOKEN.into()), Some(config));
        server.start(Duration::from_secs(5)).unwrap();
        let port = server.local_addrs()[0].port();
        (server, port, cert)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn websocket_over_tls_carries_messages_to_a_client_that_trusts_the_certificate() {
        let (server, port, cert) = tls_server();
        let mut client = connect_tls(port, common::client_config(&cert), TOKEN).await.unwrap();
        wait_for_clients(&server, 1);
        server.send("over tls").unwrap();
        assert_eq!(recv_text(&mut client).await, "over tls");
        server.stop();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn websocket_over_tls_refuses_a_plain_client_and_a_wrong_token() {
        let (server, port, cert) = tls_server();
        assert!(connect(port, Some(TOKEN)).await.is_err());
        assert!(connect_tls(port, common::client_config(&cert), "wrong").await.is_err());
        assert_eq!(server.client_count(), 0);
        server.stop();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn websocket_refuses_a_client_that_does_not_trust_the_certificate() {
        let (server, port, _cert) = tls_server();
        let dir = common::temp_dir("ws-tls-other");
        let other = common::make_certificate(&dir, "127.0.0.1", "other");
        assert!(connect_tls(port, common::client_config(&other), TOKEN).await.is_err());
        server.stop();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_client_that_stalls_the_tls_handshake_does_not_hold_up_others() {
        let (server, port, cert) = tls_server();
        let stalled = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        let mut client = connect_tls(port, common::client_config(&cert), TOKEN).await.unwrap();
        wait_for_clients(&server, 1);
        server.send("not held up").unwrap();
        assert_eq!(recv_text(&mut client).await, "not held up");
        drop(stalled);
        server.stop();
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn connections_that_never_open_are_limited_and_do_not_shut_out_later_clients() {
    // #470: every accepted connection got a task and up to ten seconds, without a limit.
    let (server, port) = started(TOKEN);
    let stalled: Vec<_> = (0..MAX_OPENING_CONNECTIONS).map(|_| StdTcpStream::connect(("127.0.0.1", port)).unwrap()).collect();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut extra = StdTcpStream::connect(("127.0.0.1", port)).unwrap();
    extra.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let began = Instant::now();
    let closed = matches!(extra.read(&mut [0u8; 1]), Ok(0) | Err(_));
    assert!(closed && began.elapsed() < Duration::from_secs(4), "{:?}", began.elapsed());
    drop(stalled);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut client = connect(port, Some(TOKEN)).await.unwrap();
    wait_for_clients(&server, 1);
    server.send("still open").unwrap();
    assert_eq!(recv_text(&mut client).await, "still open");
    server.stop();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_client_over_the_limit_is_told_to_try_again_later() {
    let (server, port) = started(TOKEN);
    let mut clients = Vec::new();
    for _ in 0..MAX_CLIENTS {
        clients.push(connect(port, Some(TOKEN)).await.unwrap());
    }
    wait_for_clients(&server, MAX_CLIENTS);
    let mut extra = connect(port, Some(TOKEN)).await.unwrap();
    match tokio::time::timeout(Duration::from_secs(5), extra.next()).await.unwrap() {
        Some(Ok(Message::Close(Some(frame)))) => assert_eq!(frame.code, CloseCode::Again),
        other => panic!("expected a close, got {other:?}"),
    }
    assert_eq!(server.client_count(), MAX_CLIENTS);
    drop(clients.pop());
    wait_for_clients(&server, MAX_CLIENTS - 1);
    let _again = connect(port, Some(TOKEN)).await.unwrap();
    wait_for_clients(&server, MAX_CLIENTS);
    server.stop();
}

#[tokio::test(flavor = "multi_thread")]
async fn nothing_logged_holds_the_token_or_the_text() {
    let lines = Arc::new(Mutex::new(Vec::<&'static str>::new()));
    let sink = lines.clone();
    vrct_adapters::log::set_sink(move |line| sink.lock().unwrap().push(line));
    let (server, port) = started("secret-token-value");
    let mut flooder = connect(port, Some("secret-token-value")).await.unwrap();
    wait_for_clients(&server, 1);
    for _ in 0..200 {
        if flooder.send(Message::text("private words ".repeat(50))).await.is_err() {
            break;
        }
    }
    server.send("private words").unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    server.stop();
    for line in lines.lock().unwrap().iter() {
        assert!(!line.contains("secret-token-value") && !line.contains("private words"));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_client_that_never_answers_pings_is_cut_off_and_one_that_does_stays() {
    let server = WebSocketServer::new("127.0.0.1", 0, Some(TOKEN.into()), None);
    server.set_keepalive(Duration::from_millis(100), Duration::from_millis(200));
    server.start(Duration::from_secs(5)).unwrap();
    let port = server.local_addrs()[0].port();
    // A client that completes the handshake and then never reads (so never pongs).
    let silent = StdTcpStream::connect(("127.0.0.1", port)).unwrap();
    {
        let mut silent = &silent;
        write!(
            silent,
            "GET /?token={TOKEN} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
             Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        .unwrap();
    }
    let mut healthy = connect(port, Some(TOKEN)).await.unwrap();
    wait_for_clients(&server, 2);
    // The healthy client answers pings while it reads.
    let reader = tokio::spawn(async move {
        let end = tokio::time::Instant::now() + Duration::from_millis(1500);
        while tokio::time::Instant::now() < end {
            if tokio::time::timeout(Duration::from_millis(50), healthy.next()).await.is_ok_and(|n| n.is_none()) {
                return None;
            }
        }
        Some(healthy)
    });
    let healthy = reader.await.unwrap().expect("the healthy client stays connected");
    assert_eq!(server.client_count(), 1);
    drop((silent, healthy));
    server.stop();
}
