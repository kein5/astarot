//! Speech servers on a loopback port: a speech.cpp TTS server (`/health`, `/v1/models`, and
//! `/v1/audio/speech` streaming PCM) and an installed engine of the VOICEVOX family. They record
//! what they were asked; no model is loaded.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

#[derive(Default)]
struct State {
    healthy: AtomicBool,
    /// Each speech request's JSON body.
    requests: Mutex<Vec<Value>>,
    /// How long each 20 ms piece of speech waits before it is sent.
    pace: Mutex<Duration>,
    seconds: Mutex<f64>,
    /// Seconds of silence before the tone, as speech.cpp's speech starts.
    leading: Mutex<f64>,
}

/// A fake server; it stops answering when dropped.
pub struct FakeTts {
    pub url: String,
    state: Arc<State>,
    stop: Arc<AtomicBool>,
}

type Answer = (u16, &'static str, Vec<(String, String)>, Vec<Vec<u8>>);

impl FakeTts {
    /// A speech.cpp server that is ready and speaks `seconds` of a tone at 24 kHz.
    pub fn speechcpp(seconds: f64) -> FakeTts {
        Self::start(seconds, |state, method, path, body| match (method, path) {
            ("GET", "/health") if state.healthy.load(Ordering::SeqCst) => (200, "application/json", Vec::new(), vec![br#"{"status":"ok"}"#.to_vec()]),
            ("GET", "/health") => (503, "application/json", Vec::new(), vec![b"{}".to_vec()]),
            ("GET", "/v1/models") => (200, "application/json", Vec::new(), vec![serde_json::to_vec(&json!({"data": [{"id": "qwen3-tts", "speech": {"task": "synthesis", "options": [{"name": "seed", "type": "int", "minimum": 0, "maximum": 1000}, {"name": "instructions", "type": "string"}]}}]})).unwrap()]),
            ("POST", "/v1/audio/speech") => {
                state.requests.lock().unwrap().push(serde_json::from_slice(body).unwrap_or(Value::Null));
                let samples = (24000.0 * *state.seconds.lock().unwrap()) as usize;
                let silent = (24000.0 * *state.leading.lock().unwrap()) as usize;
                let tone = (0..samples).map(|i| ((i % 60) as i16 - 30) * 200);
                let pcm: Vec<u8> = std::iter::repeat_n(0i16, silent).chain(tone).flat_map(i16::to_le_bytes).collect();
                (200, "audio/pcm", vec![("X-Sample-Rate".into(), "24000".into())], pcm.chunks(960).map(<[u8]>::to_vec).collect())
            }
            _ => (404, "text/plain", Vec::new(), vec![Vec::new()]),
        })
    }

    /// A VOICEVOX-family engine with one speaker of two styles.
    pub fn voicevox() -> FakeTts {
        Self::start(0.1, |_, method, path, _| match (method, path.split('?').next().unwrap_or("")) {
            ("GET", "/version") => (200, "application/json", Vec::new(), vec![br#""0.26.1""#.to_vec()]),
            ("GET", "/speakers") => (
                200,
                "application/json",
                Vec::new(),
                vec![serde_json::to_vec(&json!([{"name": "Speaker A", "styles": [{"id": 3, "name": "Normal"}, {"id": 7, "name": "Song", "type": "sing"}]}, {"name": "\u{7}bad", "styles": [{"id": 9, "name": "x"}]}])).unwrap()],
            ),
            _ => (404, "text/plain", Vec::new(), vec![Vec::new()]),
        })
    }

    fn start(seconds: f64, route: impl Fn(&State, &str, &str, &[u8]) -> Answer + Send + Sync + 'static) -> FakeTts {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let state = Arc::new(State { healthy: AtomicBool::new(true), seconds: Mutex::new(seconds), ..State::default() });
        let stop = Arc::new(AtomicBool::new(false));
        let route = Arc::new(route);
        let (served, stopped) = (state.clone(), stop.clone());
        std::thread::spawn(move || {
            while !stopped.load(Ordering::SeqCst) {
                let Ok((socket, _)) = listener.accept() else {
                    // Briefly: a request waits for this in the pipeline's measured time.
                    std::thread::sleep(Duration::from_millis(1));
                    continue;
                };
                let (route, state) = (route.clone(), served.clone());
                std::thread::spawn(move || {
                    socket.set_nonblocking(false).unwrap();
                    let mut reader = BufReader::new(socket.try_clone().unwrap());
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
                        if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                            length = value.trim().parse().unwrap_or(0);
                        }
                    }
                    let mut body = vec![0; length];
                    let _ = reader.read_exact(&mut body);
                    let (status, kind, headers, chunks) = route(&state, &method, &path, &body);
                    let mut socket = socket;
                    let mut head = format!("HTTP/1.1 {status} X\r\nContent-Type: {kind}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n");
                    for (name, value) in headers {
                        head.push_str(&format!("{name}: {value}\r\n"));
                    }
                    head.push_str("\r\n");
                    if socket.write_all(head.as_bytes()).is_err() {
                        return;
                    }
                    let pace = *state.pace.lock().unwrap();
                    for chunk in chunks.into_iter().filter(|c| !c.is_empty()) {
                        std::thread::sleep(pace);
                        if socket.write_all(format!("{:x}\r\n", chunk.len()).as_bytes()).and_then(|()| socket.write_all(&chunk)).and_then(|()| socket.write_all(b"\r\n")).is_err() {
                            return;
                        }
                    }
                    let _ = socket.write_all(b"0\r\n\r\n");
                });
            }
        });
        FakeTts { url, state, stop }
    }

    pub fn set_healthy(&self, healthy: bool) {
        self.state.healthy.store(healthy, Ordering::SeqCst);
    }

    /// How long each piece of speech waits, so that a stop can come while it plays.
    pub fn set_pace(&self, pace: Duration) {
        *self.state.pace.lock().unwrap() = pace;
    }

    /// How many seconds of speech each later request answers with.
    pub fn set_seconds(&self, seconds: f64) {
        *self.state.seconds.lock().unwrap() = seconds;
    }

    /// Seconds of silence each later speech starts with, before its tone.
    pub fn set_leading_silence(&self, seconds: f64) {
        *self.state.leading.lock().unwrap() = seconds;
    }

    pub fn requests(&self) -> Vec<Value> {
        self.state.requests.lock().unwrap().clone()
    }
}

impl Drop for FakeTts {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}
