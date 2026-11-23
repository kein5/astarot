//! The translation providers go through the proxy the environment names, as the cloud
//! recognition engines do (#924, item 18). A stand-in proxy on this PC refuses every tunnel, so
//! that nothing reaches a provider: only the `CONNECT` line with the provider's host reaches it.
//!
//! The proxy is named in this process's environment, so this file holds one test: its binary
//! has no other test to read the variables meanwhile.

mod common;

use astarot_core::controller::Services;
use common::{Setup, Ui};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// A proxy on this PC that answers each tunnel with 502 and keeps the requests' first lines.
fn refusing_proxy() -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&seen);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut head = Vec::new();
            let mut byte = [0u8; 1];
            while !head.ends_with(b"\r\n\r\n") && head.len() < 16 * 1024 {
                match stream.read(&mut byte) {
                    Ok(1) => head.push(byte[0]),
                    _ => break,
                }
            }
            let first = String::from_utf8_lossy(&head).lines().next().unwrap_or_default().to_string();
            kept.lock().unwrap().push(first);
            let _ = stream.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
        }
    });
    (port, seen)
}

#[test]
fn a_provider_is_reached_through_the_proxy_the_environment_names() {
    let (port, seen) = refusing_proxy();
    // SAFETY: the only test of this binary sets them before the core starts any thread.
    unsafe {
        for name in ["HTTPS_PROXY", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy", "HTTP_PROXY", "http_proxy"] {
            std::env::remove_var(name);
        }
        std::env::set_var("https_proxy", format!("http://127.0.0.1:{port}"));
    }
    let base = Setup::default();
    // The app's own way out, with the providers where they are.
    let services = Services {
        translation_transport: Services::default().translation_transport,
        translation_endpoints: astarot_translation::providers::Endpoints::default(),
        ..base.services
    };
    let ui = Ui::with(Setup { services, ..base });
    ui.ready();

    // A DeepL key is checked with DeepL's free API before it is kept.
    let key = format!("{}:fx", "d".repeat(36));
    let answer = ui.request("/set/data/deepl_auth_key", Some(json!(key)));
    assert_eq!(answer["status"], 400, "the proxy refused the tunnel: {answer}");
    let deadline = Instant::now() + Duration::from_secs(10);
    while seen.lock().unwrap().is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(seen.lock().unwrap().first().map(String::as_str), Some("CONNECT api-free.deepl.com:443 HTTP/1.1"));
    ui.stop();
}
