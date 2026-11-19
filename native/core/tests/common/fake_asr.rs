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
    /// `/v1/models` is held without an answer until the client goes or 10 s pass.
    pub models_silent: AtomicBool,
    /// Deepgram's speech models (`/deepgram/v1/models`, the `stt` rows).
    pub deepgram_models: Mutex<Value>,
    /// Realtime: audio blocks to receive before an utterance is announced (0: never).
    pub realtime_after: AtomicUsize,
    /// The status of the Realtime handshake; 0 accepts.
    pub realtime_refuse: AtomicU16,
    /// Realtime: the connection is held without an answer to its handshake, as a server that
    /// is going away may do, until the client goes or 10 s pass.
    pub realtime_silent: AtomicBool,
    /// Realtime: who spoke each utterance, as a diarizing server says it
    /// (`[{"speaker": "A", "start_ms": 0, "end_ms": 900}, ...]`); null sends none.
    pub speakers: Mutex<Value>,
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
    /// The `turn_detection` of each `session.update`.
    pub turn_detection: Arc<Mutex<Vec<Value>>>,
    /// The `diarization` each `session.update` asked for (null when it asked for none).
    pub diarization: Arc<Mutex<Vec<Value>>>,
}

/// A speaker diarization model as `/v1/models` lists it, on `device`.
pub fn diarization_model(id: &str, device: &str) -> Value {
    json!({ "id": id, "speech": { "task": "diarization", "device": device } })
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
        *behaviour.deepgram_models.lock().unwrap() = json!([
            { "name": "nova-3", "batch": true, "languages": ["en", "ja"] },
            { "name": "nova-2", "batch": true, "languages": ["multi"] },
            { "name": "flux", "batch": false, "languages": ["en"] },
        ]);
        behaviour.realtime_after.store(25, Ordering::SeqCst);
        let fake = FakeAsr {
            port,
            behaviour,
            requests: Arc::default(),
            fields: Arc::default(),
            appends: Arc::default(),
            turn_detection: Arc::default(),
            diarization: Arc::default(),
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
                if self.behaviour.models_silent.load(Ordering::SeqCst) {
                    let mut sink = [0u8; 64];
                    while matches!(stream.read(&mut sink), Ok(size) if size > 0) {}
                    return;
                }
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
            ("GET", "/deepgram/v1/models") => {
                let models = self.behaviour.deepgram_models.lock().unwrap().clone();
                Self::json(&mut stream, 200, json!({ "stt": models }))
            }
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
        if self.behaviour.realtime_silent.load(Ordering::SeqCst) {
            let mut sink = [0u8; 4096];
            while matches!(stream.read(&mut sink), Ok(size) if size > 0) {}
            return;
        }
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
        // A session without a transcription detects speech alone (the recorder's VAD): by
        // volume here, in blocks of 20 ms, with server_vad's padding and silence.
        let mut detecting: Option<Value> = None;
        let (mut heard_ms, mut speech_from, mut quiet_since): (f64, Option<f64>, Option<f64>) = (0.0, None, None);
        while let Ok(message) = socket.read() {
            let tungstenite::Message::Text(text) = message else { continue };
            let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else { continue };
            match value["type"].as_str() {
                Some("session.update") => {
                    self.turn_detection.lock().unwrap().push(value["session"]["audio"]["input"]["turn_detection"].clone());
                    self.diarization.lock().unwrap().push(value["session"]["audio"]["input"]["diarization"].clone());
                    let mut session = value["session"].clone();
                    if session["audio"]["input"].get("diarization").is_none() {
                        session["audio"]["input"]["diarization"] = Value::Null;
                    }
                    if session["audio"]["input"]["transcription"].is_null() {
                        detecting = Some(session["audio"]["input"]["turn_detection"].clone());
                    }
                    let _ = socket.send(next("session.updated", json!({ "session": session })));
                }
                Some("input_audio_buffer.append") if detecting.is_some() => {
                    self.appends.fetch_add(1, Ordering::SeqCst);
                    let turn = detecting.clone().unwrap_or_default();
                    let pad = turn["prefix_padding_ms"].as_f64().unwrap_or(300.0);
                    let silence = turn["silence_duration_ms"].as_f64().unwrap_or(500.0);
                    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, value["audio"].as_str().unwrap_or("")).unwrap_or_default();
                    let samples: Vec<i16> = bytes.as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b)).collect();
                    for block in samples.chunks(480) {
                        let loud = block.iter().map(|s| i64::from(*s).abs()).max().unwrap_or(0) > 1000;
                        if loud {
                            quiet_since = None;
                            if speech_from.is_none() {
                                speech_from = Some(heard_ms);
                                let started = json!({ "item_id": "vad", "audio_start_ms": (heard_ms - pad).max(0.0) });
                                if socket.send(next("input_audio_buffer.speech_started", started)).is_err() {
                                    return;
                                }
                            }
                        } else if speech_from.is_some() {
                            let since = *quiet_since.get_or_insert(heard_ms);
                            if heard_ms - since >= silence {
                                speech_from = None;
                                quiet_since = None;
                                let stopped = json!({ "item_id": "vad", "audio_end_ms": since + pad });
                                if socket.send(next("input_audio_buffer.speech_stopped", stopped)).is_err() {
                                    return;
                                }
                            }
                        }
                        heard_ms += block.len() as f64 / 24.0;
                    }
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
                        let mut completed = json!({ "item_id": id, "transcript": text, "stop": "complete", "languages": [{ "code": "ja" }] });
                        let speakers = self.behaviour.speakers.lock().unwrap().clone();
                        if !speakers.is_null() {
                            completed["speakers"] = speakers;
                        }
                        for message in [
                            next("input_audio_buffer.speech_started", json!({ "item_id": id })),
                            next(&format!("{prefix}delta"), json!({ "item_id": id, "delta": half })),
                            next(&format!("{prefix}completed"), completed),
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
