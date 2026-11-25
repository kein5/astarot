//! Mirrors [`src-python/test/test_obs_http_lifecycle.py`], [`test_obs_reconnect.py`] and the
//! OBS cases of [`test_websocket_auth_and_bind_guard.py`] and [`test_websocket_tls.py`].
//!
//! [`src-python/test/test_obs_http_lifecycle.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_obs_http_lifecycle.py
//! [`test_obs_reconnect.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_obs_reconnect.py
//! [`test_websocket_auth_and_bind_guard.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_websocket_auth_and_bind_guard.py
//! [`test_websocket_tls.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_websocket_tls.py

mod common;

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use astarot_adapters::obs::settings::{parse_numeric_setting, NumericSetting, RawNumeric};
use astarot_adapters::obs::{build_overlay_html, is_trusted_host_header, ObsBrowserSourceServer, ObsPageSettings};

const TOKEN: &str = "secret-token";

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

#[test]
fn the_page_is_the_python_page_with_the_speakers() {
    // Made by `_build_overlay_html` of the Python implementation with the same values, and the
    // line of who spoke added since (#1035).
    assert_eq!(build_overlay_html(&ObsPageSettings::default(), "tok_EN-123"), fixture("obs_page_default.html"));
    let custom = ObsPageSettings {
        websocket_port: 9876,
        max_messages: 7,
        display_duration: 30,
        fadeout_duration: 0,
        font_size: 72,
        font_color: " #12abEF ".into(),
        font_outline_thickness: 20,
        font_outline_color: "#00FF00".into(),
    };
    assert_eq!(build_overlay_html(&custom, "abc"), fixture("obs_page_custom.html"));
    let clamped = ObsPageSettings {
        websocket_port: 70000,
        max_messages: 0,
        display_duration: 500,
        fadeout_duration: -3,
        font_size: 5,
        font_color: "red".into(),
        font_outline_thickness: 99,
        font_outline_color: "#12345".into(),
    };
    assert_eq!(build_overlay_html(&clamped, ""), fixture("obs_page_clamped.html"));
}

#[test]
fn an_open_page_refreshes_the_port_without_a_notification() {
    // The page's script runs under Node ([`test_obs_reconnect.py`] of the Python backend did the same).
    //
    // [`test_obs_reconnect.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_obs_reconnect.py
    run_page_script("obs_reconnect.mjs");
}

#[test]
fn the_page_says_who_spoke() {
    // #1035: the labels of the voices, and the names when the message carries them.
    run_page_script("obs_speakers.mjs");
}

/// Runs a fixture script under Node with the page on its input.
fn run_page_script(name: &str) {
    let script = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    if !std::path::Path::new(&script).exists() {
        return;
    }
    let Ok(mut node) = std::process::Command::new("node")
        .arg(&script)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    else {
        eprintln!("Node is required to execute the generated OBS page; skipped");
        return;
    };
    let page = build_overlay_html(&ObsPageSettings { websocket_port: 2231, ..Default::default() }, "test-token");
    node.stdin.take().unwrap().write_all(page.as_bytes()).unwrap();
    let output = node.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn numeric_settings_parse_like_python() {
    use NumericSetting::*;
    assert_eq!(parse_numeric_setting(MaxMessages, RawNumeric::Int(14)), Ok(14));
    assert_eq!(parse_numeric_setting(MaxMessages, RawNumeric::Text(" 14 ")), Ok(14));
    assert_eq!(parse_numeric_setting(MaxMessages, RawNumeric::Text("+7")), Ok(7));
    assert_eq!(parse_numeric_setting(FadeoutDuration, RawNumeric::Text("-0")), Ok(0));
    for bad in ["", "1.5", "1e2", "abc", "0x10", "１２", "- 1"] {
        assert!(parse_numeric_setting(FontSize, RawNumeric::Text(bad)).is_err(), "{bad}");
    }
    assert!(parse_numeric_setting(MaxMessages, RawNumeric::Int(0)).is_err());
    assert!(parse_numeric_setting(MaxMessages, RawNumeric::Int(51)).is_err());
    assert!(parse_numeric_setting(FontSize, RawNumeric::Text("99999999999999999999999")).is_err());
    assert_eq!(parse_numeric_setting(FontOutlineThickness, RawNumeric::Int(20)), Ok(20));
    let error = parse_numeric_setting(FontSize, RawNumeric::Int(5)).unwrap_err();
    assert_eq!(error.to_string(), "Invalid OBS FONT_SIZE");
}

#[test]
fn only_address_literals_and_localhost_are_trusted_hosts() {
    for host in [
        "127.0.0.1",
        "127.0.0.1:2232",
        "localhost",
        "LOCALHOST:2232",
        "192.168.1.20:8080",
        "[::1]:2232",
        "[::1]",
        "::1",
        " 127.0.0.1 ",
    ] {
        assert!(is_trusted_host_header(Some(host)), "{host}");
    }
    for host in ["", "attacker.example", "attacker.example:2232", "127.0.0.1.nip.io", "[::1", "localhost.", "1.2.3"] {
        assert!(!is_trusted_host_header(Some(host)), "{host}");
    }
    assert!(!is_trusted_host_header(None));
}

fn server_with(token: &str) -> (ObsBrowserSourceServer, u16) {
    let server = ObsBrowserSourceServer::new("127.0.0.1", 0, token, None, || ObsPageSettings {
        websocket_port: 2231,
        ..Default::default()
    });
    server.start().unwrap();
    let port = server.local_addr().unwrap().port();
    (server, port)
}

struct Response {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Response {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

fn parse_response(raw: &[u8]) -> Response {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").expect("a complete head");
    let head = String::from_utf8_lossy(&raw[..split]).into_owned();
    let mut lines = head.split("\r\n");
    let status = lines.next().unwrap().split(' ').nth(1).unwrap().parse().unwrap();
    let headers =
        lines.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_string(), v.trim().to_string())).collect();
    Response { status, headers, body: raw[split + 4..].to_vec() }
}

fn request_raw(port: u16, raw: &str) -> Response {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    stream.write_all(raw.as_bytes()).unwrap();
    let mut reply = Vec::new();
    stream.read_to_end(&mut reply).unwrap();
    parse_response(&reply)
}

fn get(port: u16, path: &str, host: &str, extra: &str) -> Response {
    request_raw(port, &format!("GET {path} HTTP/1.0\r\nHost: {host}\r\n{extra}\r\n"))
}

#[test]
fn the_page_refuses_invalid_tokens() {
    let (server, port) = server_with(TOKEN);
    for path in ["/", "/obs"] {
        for query in [
            "",
            "?token=wrong",
            "?token=",
            "?token=%E3%81%82",
            "?token=%FF",
            "?token=wrong&token=secret-token",
            "?token=secret-token&token=wrong",
            "?token=&token=secret-token",
        ] {
            let response = get(port, &format!("{path}{query}"), "127.0.0.1:2232", "");
            assert_eq!(response.status, 403, "{path}{query}");
            assert_eq!(response.header("Content-Type"), Some("text/plain; charset=utf-8"));
            assert_eq!(response.body, b"Forbidden\n");
        }
    }
    server.stop();
}

#[test]
fn the_page_accepts_the_token_and_protects_the_response() {
    let (server, port) = server_with(TOKEN);
    for path in ["/", "/obs"] {
        for query in ["?token=secret-token", "?token=secret%2Dtoken&unused=1"] {
            let response = get(port, &format!("{path}{query}"), "127.0.0.1:2232", "");
            assert_eq!(response.status, 200);
            assert_eq!(response.header("Content-Type"), Some("text/html; charset=utf-8"));
            assert!(response.header("Cache-Control").unwrap().contains("no-store"));
            assert_eq!(response.header("Referrer-Policy"), Some("no-referrer"));
            assert_eq!(response.header("Content-Length").unwrap().parse::<usize>().unwrap(), response.body.len());
            assert!(response.body.starts_with(b"<!doctype html>"));
            assert!(String::from_utf8_lossy(&response.body).contains("wsToken: \"secret-token\""));
        }
    }
    server.stop();
}

#[test]
fn the_page_fails_closed_without_a_configured_token() {
    let (server, port) = server_with("");
    for query in ["", "?token=", "?token=secret-token"] {
        let response = get(port, &format!("/obs{query}"), "127.0.0.1", "");
        assert_eq!(response.status, 403);
        assert_eq!(response.body, b"Forbidden\n");
    }
    server.stop();
}

#[test]
fn the_connection_metadata_needs_a_bearer_token() {
    let (server, port) = server_with(TOKEN);
    let ok = get(port, "/obs/connection", "127.0.0.1", "Authorization: Bearer secret-token\r\n");
    assert_eq!(ok.status, 200);
    assert_eq!(ok.header("Content-Type"), Some("application/json"));
    assert_eq!(ok.body, b"{\"wsPort\": 2231}");
    for header in [
        "",
        "Authorization: secret-token\r\n",
        "Authorization: Bearer wrong\r\n",
        "Authorization: bearer secret-token\r\n",
    ] {
        assert_eq!(get(port, "/obs/connection", "127.0.0.1", header).status, 403, "{header}");
    }
    // The query does not count for the metadata.
    assert_eq!(get(port, "/obs/connection?token=secret-token", "127.0.0.1", "").status, 403);
    server.stop();
}

// Run on Windows for the first time in CI (#884), the reply to one of several requests in a row
// came back as a connection reset (WSAECONNRESET) there; one request alone does not. Whether the
// server closes a connection with data still unread on Windows is to be found out on a Windows
// PC, as it could cost an OBS browser source its page. Until then these two are left out there.
#[test]
#[cfg_attr(windows, ignore = "connection reset on Windows when requests follow each other (#884)")]
fn health_stays_public_and_other_paths_are_not_found() {
    let (server, port) = server_with(TOKEN);
    for query in ["", "?token=wrong"] {
        let response = get(port, &format!("/health{query}"), "127.0.0.1", "");
        assert_eq!(response.status, 200);
        assert_eq!(response.header("Content-Type"), Some("text/plain; charset=utf-8"));
        assert_eq!(response.body, b"ok");
    }
    assert_eq!(get(port, "/unknown?token=secret-token", "127.0.0.1", "").status, 404);
    let post = request_raw(port, "POST /obs?token=secret-token HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
    assert_eq!(post.status, 501);
    server.stop();
}

#[test]
fn the_host_check_rejects_authenticated_rebound_requests() {
    let (server, port) = server_with(TOKEN);
    let response = get(port, "/obs?token=secret-token", "attacker.example", "");
    assert_eq!(response.status, 403);
    assert!(!String::from_utf8_lossy(&response.body).contains("secret-token"));
    let missing = request_raw(port, "GET /obs?token=secret-token HTTP/1.0\r\n\r\n");
    assert_eq!(missing.status, 403);
    server.stop();
}

#[test]
fn the_page_follows_a_new_token_at_once() {
    let (server, port) = server_with("old-token");
    assert_eq!(get(port, "/obs?token=old-token", "127.0.0.1", "").status, 200);
    server.set_token("new-token").unwrap();
    assert_eq!(get(port, "/obs?token=old-token", "127.0.0.1", "").status, 403);
    let response = get(port, "/obs?token=new-token", "127.0.0.1", "");
    assert_eq!(response.status, 200);
    assert!(String::from_utf8_lossy(&response.body).contains("wsToken: \"new-token\""));
    assert!(server.set_token("").is_err());
    assert!(server.set_token("  ").is_err());
    server.stop();
}

#[test]
fn requests_log_nothing() {
    let lines = Arc::new(Mutex::new(Vec::<&'static str>::new()));
    let sink = lines.clone();
    astarot_adapters::log::set_sink(move |line| sink.lock().unwrap().push(line));
    let (server, port) = server_with(TOKEN);
    get(port, "/obs?token=secret-token", "127.0.0.1", "");
    get(port, "/obs?token=wrong", "127.0.0.1", "");
    get(port, "/unknown?token=secret-token", "127.0.0.1", "");
    server.stop();
    assert!(lines.lock().unwrap().iter().all(|line| !line.contains("secret-token")));
}

fn stalled(port: u16, prefix: &str) -> TcpStream {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.write_all(prefix.as_bytes()).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    stream
}

fn closed(stream: &mut TcpStream) -> bool {
    let mut buf = [0u8; 1024];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => return true,
            Ok(_) => continue,
            Err(e) => return e.kind() == std::io::ErrorKind::ConnectionReset,
        }
    }
}

#[test]
fn stop_retires_incomplete_request_lines_and_headers() {
    for prefix in ["", "GET /obs", "GET /obs HTTP/1.0\r\nHost: 127.0.0.1\r\n"] {
        let (server, port) = server_with(TOKEN);
        let mut request = stalled(port, prefix);
        std::thread::sleep(Duration::from_millis(300));
        let started = Instant::now();
        server.stop();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(closed(&mut request));
        assert!(server.is_stopped());
    }
}

#[test]
fn handler_admission_is_bounded_and_stop_rejects_new_clients() {
    let (server, port) = server_with(TOKEN);
    let mut requests: Vec<_> = (0..16).map(|_| stalled(port, "GET /obs")).collect();
    std::thread::sleep(Duration::from_millis(400));
    let mut extra = stalled(port, "GET /obs");
    assert!(closed(&mut extra), "the 17th request is refused");
    // A slot frees when a request completes.
    server.stop();
    for request in &mut requests {
        assert!(closed(request));
    }
    assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
}

#[test]
fn the_total_deadline_closes_a_client_that_drips_its_headers() {
    let server = ObsBrowserSourceServer::new("127.0.0.1", 0, TOKEN, None, ObsPageSettings::default);
    server.set_request_timeout(Duration::from_millis(600));
    server.start().unwrap();
    let port = server.local_addr().unwrap().port();
    let mut stream = stalled(port, "GET /obs HTTP/1.0\r\n");
    let started = Instant::now();
    // Drip a header byte often enough to beat any per-read timeout.
    let mut cut = false;
    while started.elapsed() < Duration::from_secs(3) {
        std::thread::sleep(Duration::from_millis(100));
        if stream.write_all(b"X").is_err() {
            cut = true;
            break;
        }
    }
    assert!(cut || closed(&mut stream));
    assert!(started.elapsed() < Duration::from_secs(3));
    server.stop();
}

// Run on Windows for the first time in CI (#884), the reply to one of several requests in a row
// came back as a connection reset (WSAECONNRESET) there; one request alone does not. Whether the
// server closes a connection with data still unread on Windows is to be found out on a Windows
// PC, as it could cost an OBS browser source its page. Until then these two are left out there.
#[test]
#[cfg_attr(windows, ignore = "connection reset on Windows when requests follow each other (#884)")]
fn a_completed_request_releases_its_slot_and_the_server_restarts() {
    let (server, port) = server_with(TOKEN);
    for _ in 0..40 {
        assert_eq!(get(port, "/health", "localhost", "").status, 200);
    }
    server.stop();
    assert!(server.is_stopped());
    assert!(!server.is_running());
    server.start().unwrap();
    assert!(server.is_running());
    let port = server.local_addr().unwrap().port();
    assert_eq!(get(port, "/health", "localhost", "").status, 200);
    server.stop();
}

#[test]
fn a_taken_port_is_an_error() {
    let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port();
    let server = ObsBrowserSourceServer::new("127.0.0.1", port, TOKEN, None, ObsPageSettings::default);
    assert!(server.start().is_err());
    assert!(server.is_stopped());
}

mod https {
    use super::*;
    use rustls::pki_types::ServerName;
    use astarot_adapters::tls::server_config;

    fn https_get(port: u16, client: Arc<rustls::ClientConfig>, path: &str) -> Result<Response, std::io::Error> {
        let tcp = TcpStream::connect(("127.0.0.1", port)).unwrap();
        tcp.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let connection = rustls::ClientConnection::new(client, ServerName::try_from("127.0.0.1").unwrap()).unwrap();
        let mut tls = rustls::StreamOwned::new(connection, tcp);
        tls.write_all(format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())?;
        let mut reply = Vec::new();
        match tls.read_to_end(&mut reply) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof && !reply.is_empty() => {}
            Err(e) => return Err(e),
        }
        Ok(parse_response(&reply))
    }

    fn https_server() -> (ObsBrowserSourceServer, u16, common::Certificate) {
        let dir = common::temp_dir("obs-tls");
        let cert = common::make_certificate(&dir, "127.0.0.1", "server");
        let config = server_config(&cert.cert_file, &cert.key_file).unwrap();
        let server = ObsBrowserSourceServer::new("127.0.0.1", 0, TOKEN, Some(config), ObsPageSettings::default);
        server.start().unwrap();
        let port = server.local_addr().unwrap().port();
        (server, port, cert)
    }

    #[test]
    fn obs_over_https_serves_the_page_only_with_the_token() {
        let (server, port, cert) = https_server();
        let ok = https_get(port, common::client_config(&cert), "/obs?token=secret-token").unwrap();
        assert_eq!(ok.status, 200);
        let page = String::from_utf8_lossy(&ok.body).into_owned();
        assert!(page.contains("wsToken: \"secret-token\""));
        // The page connects back over wss when it was served over https.
        assert!(page.contains("location.protocol === \"https:\" ? \"wss\" : \"ws\""));
        assert_eq!(https_get(port, common::client_config(&cert), "/obs?token=wrong").unwrap().status, 403);
        server.stop();
    }

    #[test]
    fn obs_over_https_refuses_plain_http() {
        let (server, port, _cert) = https_server();
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        stream.write_all(b"GET /obs?token=secret-token HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut reply = Vec::new();
        let _ = stream.read_to_end(&mut reply);
        assert!(!String::from_utf8_lossy(&reply).contains("secret-token"));
        assert!(!reply.starts_with(b"HTTP/1.0 200"));
        server.stop();
    }

    #[test]
    fn a_client_that_stalls_the_tls_handshake_does_not_hold_up_others() {
        let (server, port, cert) = https_server();
        let _stalled = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let started = Instant::now();
        assert_eq!(https_get(port, common::client_config(&cert), "/health").unwrap().status, 200);
        assert!(started.elapsed() < Duration::from_secs(2));
        server.stop();
    }
}
