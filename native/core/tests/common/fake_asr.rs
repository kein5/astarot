//! Recognition services on a loopback port: the OpenAI-compatible transcription APIs (Groq,
//! OpenAI, a custom server), Deepgram, and a speech.cpp server with its model list and Realtime
//! WebSocket. No model and no network beyond 127.0.0.1.
//!
//! Paths: `/{groq,openai,custom}/v1/...`, `/deepgram/v1/...`,
//! `/v1/models` and `/v1/realtime`. A key `good-key` is accepted, anything else refused.

use serde_json::{Value, json};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const KEY: &str = "good-key";

/// What the fake answers.
#[derive(Default)]
pub struct Behaviour {
    /// Recognition answers 500 (the APIs, Deepgram).
    pub fail: AtomicBool,
    /// The text every engine recognises.
    pub text: Mutex<String>,
    /// The speech.cpp model list (`/v1/models`).
    pub models: Mutex<Value>,
    /// Realtime: audio blocks to receive before an utterance is announced (0: never).
    pub realtime_after: AtomicUsize,
    /// The status of the Realtime handshake; 0 accepts.
    pub realtime_refuse: AtomicU16,
}

#[derive(Clone)]
pub struct FakeAsr {
    pub port: u16,
    pub behaviour: Arc<Behaviour>,
    /// Each request as "METHOD path" with its query.
    pub requests: Arc<Mutex<Vec<String>>>,
    /// Bodies of the recognition requests (form fields and queries, not audio).
    pub fields: Arc<Mutex<Vec<String>>>,
    pub appends: Arc<AtomicUsize>,
}

pub fn recognition_model(id: &str, languages: &[&str], detects: bool, options: &[&str]) -> Value {
    let mut rows: Vec<Value> = options.iter().map(|name| json!({ "name": name })).collect();
    rows.push(if detects {
        json!({ "name": "language", "default": "auto", "choices": ["auto", "ja", "en"] })
    } else {
        json!({ "name": "language", "default": languages.first().copied().unwrap_or("ja"), "choices": languages })
    });
    json!({ "id": id, "speech": { "task": "recognition", "languages": languages, "options": rows } })
}

impl FakeAsr {
    pub fn start() -> FakeAsr {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let behaviour = Arc::new(Behaviour::default());
        *behaviour.text.lock().unwrap() = "こんにちは".into();
        *behaviour.models.lock().unwrap() = json!({ "data": [recognition_model("haas-ja", &["ja"], false, &["keywords"])] });
        behaviour.realtime_after.store(25, Ordering::SeqCst);
        let fake = FakeAsr {
            port,
            behaviour,
            requests: Arc::default(),
            fields: Arc::default(),
            appends: Arc::default(),
        };
        let serving = fake.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let fake = serving.clone();
                std::thread::spawn(move || fake.handle(stream));
            }
        });
        fake
    }

    pub fn base(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn requested(&self, prefix: &str) -> usize {
        self.requests.lock().unwrap().iter().filter(|r| r.starts_with(prefix)).count()
    }

    fn respond(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8]) {
        let head = format!(
            "HTTP/1.1 {status} X\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(head.as_bytes());
        let _ = stream.write_all(body);
    }

    fn json(stream: &mut TcpStream, status: u16, body: Value) {
        Self::respond(stream, status, "application/json", body.to_string().as_bytes());
    }

    fn handle(&self, mut stream: TcpStream) {
        stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        // Peek the head first: the Realtime path is handed to the WebSocket whole.
        let mut peeked = [0u8; 4096];
        let Ok(size) = stream.peek(&mut peeked) else { return };
        let head = String::from_utf8_lossy(&peeked[..size]).to_string();
        let line = head.lines().next().unwrap_or("").to_string();
        if line.starts_with("GET /v1/realtime") {
            self.requests.lock().unwrap().push(line.split_whitespace().take(2).collect::<Vec<_>>().join(" "));
            return self.realtime(stream);
        }
        let mut data = Vec::new();
        let mut block = [0u8; 16384];
        let header_end = loop {
            if let Some(at) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                break at + 4;
            }
            match stream.read(&mut block) {
                Ok(0) | Err(_) => return,
                Ok(n) => data.extend_from_slice(&block[..n]),
            }
        };
        let head = String::from_utf8_lossy(&data[..header_end]).to_string();
        let length: usize = head
            .lines()
            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap_or(0)))
            .unwrap_or(0);
        while data.len() < header_end + length {
            match stream.read(&mut block) {
                Ok(0) | Err(_) => break,
                Ok(n) => data.extend_from_slice(&block[..n]),
            }
        }
        let body = data[header_end..].to_vec();
        let mut parts = head.lines().next().unwrap_or("").split_whitespace();
        let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or("").to_string());
        self.requests.lock().unwrap().push(format!("{method} {target}"));
        let authorization = head
            .lines()
            .find_map(|l| l.strip_prefix("Authorization: ").or_else(|| l.strip_prefix("authorization: ")))
            .unwrap_or("")
            .to_string();
        let path = target.split('?').next().unwrap_or("").to_string();
        let text = self.behaviour.text.lock().unwrap().clone();
        let failing = self.behaviour.fail.load(Ordering::SeqCst);
        let bearer = authorization == format!("Bearer {KEY}");
        match (method, path.as_str()) {
            ("GET", "/v1/models") => {
                let models = self.behaviour.models.lock().unwrap().clone();
                Self::json(&mut stream, 200, models)
            }
            ("GET", p) if p.ends_with("/v1/models") && !p.starts_with("/deepgram") => {
                if !bearer {
                    return Self::json(&mut stream, 401, json!({ "error": "invalid key" }));
                }
                Self::json(
                    &mut stream,
                    200,
                    json!({ "data": [{ "id": "whisper-large-v3" }, { "id": "llama-3.3-70b" }, { "id": "gpt-4o-transcribe-diarize" }, { "id": "distil-whisper" }] }),
                )
            }
            ("POST", p) if p.ends_with("/v1/audio/transcriptions") => {
                let form = String::from_utf8_lossy(&body);
                let fields: Vec<String> = ["model", "language", "response_format"]
                    .iter()
                    .filter_map(|name| {
                        let marker = format!("name=\"{name}\"\r\n\r\n");
                        let at = form.find(&marker)? + marker.len();
                        let end = form[at..].find("\r\n")?;
                        Some(format!("{name}={}", &form[at..at + end]))
                    })
                    .collect();
                self.fields.lock().unwrap().push(fields.join("&"));
                if !bearer {
                    return Self::json(&mut stream, 401, json!({ "error": "invalid key" }));
                }
                if failing {
                    return Self::json(&mut stream, 500, json!({ "error": "down" }));
                }
                Self::json(
                    &mut stream,
                    200,
                    json!({ "text": text, "language": "japanese", "segments": [
                        { "text": text, "avg_logprob": -0.2, "no_speech_prob": 0.1 },
                        { "text": "(noise)", "avg_logprob": -1.9, "no_speech_prob": 0.9 },
                    ] }),
                )
            }
            ("GET", "/deepgram/v1/auth/token") => {
                let status = if authorization == format!("Token {KEY}") { 200 } else { 401 };
                Self::json(&mut stream, status, json!({}))
            }
            ("GET", "/deepgram/v1/models") => Self::json(
                &mut stream,
                200,
                json!({ "stt": [
                    { "name": "nova-3", "batch": true, "languages": ["en", "ja"] },
                    { "name": "nova-2", "batch": true, "languages": ["multi"] },
                    { "name": "flux", "batch": false, "languages": ["en"] },
                ] }),
            ),
            ("POST", "/deepgram/v1/listen") => {
                self.fields.lock().unwrap().push(target.clone());
                if authorization != format!("Token {KEY}") {
                    return Self::json(&mut stream, 401, json!({}));
                }
                if failing {
                    return Self::json(&mut stream, 500, json!({}));
                }
                Self::json(
                    &mut stream,
                    200,
                    json!({ "results": { "channels": [{ "alternatives": [{ "transcript": text, "confidence": 0.8 }], "detected_language": "ja" }] } }),
                )
            }
            _ => Self::json(&mut stream, 404, json!({})),
        }
    }

    /// The Realtime session: created, configured, then one utterance after enough audio.
    fn realtime(&self, stream: TcpStream) {
        let refuse = self.behaviour.realtime_refuse.load(Ordering::SeqCst);
        let mut stream = stream;
        if refuse != 0 {
            let mut head = [0u8; 4096];
            let _ = stream.read(&mut head);
            return Self::respond(&mut stream, refuse, "text/plain", b"");
        }
        let Ok(mut socket) = tungstenite::accept(stream) else { return };
        let mut event = 0u32;
        let mut next = |kind: &str, extra: Value| {
            event += 1;
            let mut value = json!({ "event_id": format!("event_{event}"), "type": kind });
            for (key, item) in extra.as_object().unwrap() {
                value[key] = item.clone();
            }
            tungstenite::Message::text(value.to_string())
        };
        if socket.send(next("session.created", json!({}))).is_err() {
            return;
        }
        let after = self.behaviour.realtime_after.load(Ordering::SeqCst);
        let mut item = 0;
        let mut counted = 0usize;
        while let Ok(message) = socket.read() {
            let tungstenite::Message::Text(text) = message else { continue };
            let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else { continue };
            match value["type"].as_str() {
                Some("session.update") => {
                    let mut session = value["session"].clone();
                    if session["audio"]["input"].get("diarization").is_none() {
                        session["audio"]["input"]["diarization"] = Value::Null;
                    }
                    let _ = socket.send(next("session.updated", json!({ "session": session })));
                }
                Some("input_audio_buffer.append") => {
                    self.appends.fetch_add(1, Ordering::SeqCst);
                    counted += 1;
                    if after > 0 && counted == after {
                        counted = 0;
                        item += 1;
                        let id = format!("item_{item}");
                        let text = self.behaviour.text.lock().unwrap().clone();
                        let half: String = text.chars().take(text.chars().count() / 2).collect();
                        let prefix = "conversation.item.input_audio_transcription.";
                        for message in [
                            next("input_audio_buffer.speech_started", json!({ "item_id": id })),
                            next(&format!("{prefix}delta"), json!({ "item_id": id, "delta": half })),
                            next(&format!("{prefix}completed"), json!({ "item_id": id, "transcript": text, "stop": "complete", "languages": [{ "code": "ja" }] })),
                        ] {
                            if socket.send(message).is_err() {
                                return;
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
}
