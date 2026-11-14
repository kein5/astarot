//! A fake speech.cpp server and recording outputs, as in `tests/voice/conftest.py`.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use vrct_tts::{Source, SpeechMessageEvent};

pub type Hook = Arc<dyn Fn() + Send + Sync>;
pub type ChunkHook = Arc<dyn Fn(usize) + Send + Sync>;
pub type GetHook = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Clone)]
pub struct ServerOptions {
    pub chunks: Vec<Vec<u8>>,
    pub status: u16,
    pub content_type: String,
    pub rate: Option<String>,
    pub before_chunk: Option<ChunkHook>,
    pub before_headers: Option<Hook>,
    pub headers: Vec<(String, String)>,
    pub truncate: bool,
    pub health_status: u16,
    pub health_body: Vec<u8>,
    pub model_document: Arc<Mutex<Value>>,
    pub models_body: Option<Vec<u8>>,
    pub before_get: Option<GetHook>,
    /// Called after the chunks, before the body's terminator.
    pub before_end: Option<Hook>,
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            chunks: vec![vec![1], vec![0, 2], vec![0]],
            status: 200,
            content_type: "audio/pcm".into(),
            rate: Some("48000".into()),
            before_chunk: None,
            before_headers: None,
            headers: Vec::new(),
            truncate: false,
            health_status: 200,
            health_body: br#"{"status":"ok"}"#.to_vec(),
            model_document: Arc::new(Mutex::new(Value::Null)),
            models_body: None,
            before_get: None,
            before_end: None,
        }
    }
}

/// `(path, JSON body)` of each speech POST.
pub type Requests = Arc<Mutex<Vec<(String, Value)>>>;

pub struct PcmServer {
    pub url: String,
    pub port: u16,
    pub requests: Requests,
    stop: Arc<AtomicBool>,
    acceptor: Option<thread::JoinHandle<()>>,
}

impl PcmServer {
    pub fn start(options: ServerOptions) -> Self {
        Self::start_on("127.0.0.1", options)
    }

    pub fn start_on(host: &str, options: ServerOptions) -> Self {
        let listener = TcpListener::bind((host, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests: Requests = Arc::default();
        let stop = Arc::new(AtomicBool::new(false));
        let acceptor = {
            let (requests, stop) = (requests.clone(), stop.clone());
            thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((socket, _)) => {
                            let (options, requests) = (options.clone(), requests.clone());
                            thread::spawn(move || handle(socket, &options, &requests));
                        }
                        Err(_) => thread::sleep(Duration::from_millis(5)),
                    }
                }
                // Dropping the listener closes it: later connects are refused.
            })
        };
        let authority = if host.contains(':') { format!("[{host}]") } else { host.to_owned() };
        Self { url: format!("http://{authority}:{port}"), port, requests, stop, acceptor: Some(acceptor) }
    }

    /// Stop listening. Connections already accepted keep being served.
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(acceptor) = self.acceptor.take() {
            acceptor.join().unwrap();
        }
    }

    pub fn posts(&self) -> Vec<(String, Value)> {
        self.requests.lock().unwrap().clone()
    }
}

impl Drop for PcmServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn handle(socket: TcpStream, options: &ServerOptions, requests: &Requests) {
    let mut reader = BufReader::new(socket.try_clone().unwrap());
    let mut socket = socket;
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or("").to_owned(), parts.next().unwrap_or("").to_owned());
    let mut length = 0;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).is_err() || header.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse().unwrap_or(0);
            }
        }
    }
    let _ = (|| -> std::io::Result<()> {
        if method == "GET" {
            if let Some(hook) = &options.before_get {
                hook(&path);
            }
            let (status, body) = if path == "/v1/models" {
                (200, options.models_body.clone().unwrap_or_else(|| serde_json::to_vec(&*options.model_document.lock().unwrap()).unwrap()))
            } else if path == "/health" {
                (options.health_status, options.health_body.clone())
            } else {
                (404, options.health_body.clone())
            };
            write!(socket, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n", body.len())?;
            socket.write_all(&body)?;
            return Ok(());
        }
        let mut body = vec![0; length];
        reader.read_exact(&mut body)?;
        requests.lock().unwrap().push((path, serde_json::from_slice(&body).unwrap()));
        if let Some(hook) = &options.before_headers {
            hook();
        }
        let mut head = format!("HTTP/1.1 {} X\r\nContent-Type: {}\r\n", options.status, options.content_type);
        if let Some(rate) = &options.rate {
            head.push_str(&format!("X-Sample-Rate: {rate}\r\n"));
        }
        head.push_str("Transfer-Encoding: chunked\r\n");
        for (name, value) in &options.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");
        socket.write_all(head.as_bytes())?;
        for (index, chunk) in options.chunks.iter().enumerate() {
            if let Some(hook) = &options.before_chunk {
                hook(index);
            }
            socket.write_all(format!("{:x}\r\n", chunk.len()).as_bytes())?;
            socket.write_all(chunk)?;
            socket.write_all(b"\r\n")?;
            socket.flush()?;
        }
        if let Some(hook) = &options.before_end {
            hook();
        }
        if !options.truncate {
            socket.write_all(b"0\r\n\r\n")?;
        }
        Ok(())
    })();
}

/// A server that sends `pcm` in one chunk, then waits for `finish` before
/// ending the response. Stopping it closes the listener but keeps the response
/// socket alive, as a real TCP backlog would.
pub struct BufferedServer {
    pub server: PcmServer,
    pub sent: vrct_tts::sync::Event,
    pub finish: vrct_tts::sync::Event,
}

impl BufferedServer {
    pub fn start(pcm: Vec<u8>) -> Self {
        Self::start_on("127.0.0.1", pcm)
    }

    pub fn start_on(host: &str, pcm: Vec<u8>) -> Self {
        let sent = vrct_tts::sync::Event::new();
        let finish = vrct_tts::sync::Event::new();
        let (hook_sent, hook_finish) = (sent.clone(), finish.clone());
        let server = PcmServer::start_on(
            host,
            ServerOptions {
                chunks: vec![pcm],
                before_end: Some(Arc::new(move || {
                    hook_sent.set();
                    hook_finish.wait(Some(Duration::from_secs(5)));
                })),
                ..Default::default()
            },
        );
        Self { server, sent, finish }
    }

    pub fn url(&self) -> &str {
        &self.server.url
    }
}

impl Drop for BufferedServer {
    fn drop(&mut self) {
        self.finish.set();
    }
}

pub fn until(predicate: impl Fn() -> bool, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if predicate() {
            return;
        }
        thread::sleep(Duration::from_millis(5));
    }
    assert!(predicate(), "condition not reached within {timeout:?}");
}

pub fn until2(predicate: impl Fn() -> bool) {
    until(predicate, Duration::from_secs(2));
}

pub fn chat(id: &str) -> SpeechMessageEvent {
    SpeechMessageEvent { source_language: Some("Japanese".into()), ..SpeechMessageEvent::new(id, Source::Chat, "こんにちは") }
}

pub fn mic(id: &str) -> SpeechMessageEvent {
    SpeechMessageEvent {
        translated_text: Some("Hello".into()),
        source_language: Some("ja".into()),
        target_language: Some("en".into()),
        utterance_id: Some(id.into()),
        ..SpeechMessageEvent::new(id, Source::Mic, "こんにちは")
    }
}
