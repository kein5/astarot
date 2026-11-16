//! A stand-in for every provider on one loopback port, for tests (feature `fake-server`).
//!
//! Point [`crate::providers::Endpoints::all_at`] (and the LM Studio and OpenAI-compatible URLs)
//! at [`FakeProviders::url`]. Each provider lives under its own prefix: `/deepl`,
//! `/deepl-free`, `/plamo/v1`, `/gemini`, `/openai/v1`, `/groq/v1`, `/openrouter/v1`,
//! `/compatible/v1`, `/lmstudio/v1`, `/ollama`, `/google-cloud` and `/papago`. A provider
//! accepts the key set with [`FakeProviders::key`] (Papago: `"<client id>:<secret>"`), lists the
//! models set with [`FakeProviders::models`] and translates text `t` to `"<prefix>:<target>:<t>"`
//! unless told otherwise.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// A request the fake received.
#[derive(Clone, Debug)]
pub struct Seen {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

type Reply = Arc<dyn Fn(&str, &str, &str) -> Option<String> + Send + Sync>;

#[derive(Default)]
struct State {
    keys: HashMap<String, String>,
    models: HashMap<String, Vec<Value>>,
    status: HashMap<String, u16>,
    truncated: HashMap<String, bool>,
    down: HashMap<String, bool>,
    reply: Option<Reply>,
    seen: Vec<Seen>,
}

pub struct FakeProviders {
    port: u16,
    state: Arc<Mutex<State>>,
    stop: Arc<AtomicBool>,
}

const PREFIXES: [&str; 12] = [
    "/google-cloud",
    "/papago",
    "/deepl-free",
    "/deepl",
    "/plamo/v1",
    "/gemini",
    "/openai/v1",
    "/groq/v1",
    "/openrouter/v1",
    "/compatible/v1",
    "/lmstudio/v1",
    "/ollama",
];

impl FakeProviders {
    pub fn start() -> FakeProviders {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind a loopback port");
        let port = listener.local_addr().unwrap().port();
        let state = Arc::new(Mutex::new(State::default()));
        let stop = Arc::new(AtomicBool::new(false));
        let (thread_state, thread_stop) = (Arc::clone(&state), Arc::clone(&stop));
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if thread_stop.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                let state = Arc::clone(&thread_state);
                std::thread::spawn(move || serve(stream, &state));
            }
        });
        FakeProviders { port, state, stop }
    }

    /// `http://127.0.0.1:<port>`.
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// The URL of one prefix, e.g. `url_of("/lmstudio/v1")`.
    pub fn url_of(&self, prefix: &str) -> String {
        format!("{}{prefix}", self.url())
    }

    /// The key a prefix accepts.
    pub fn key(&self, prefix: &str, key: &str) -> &Self {
        self.state.lock().unwrap().keys.insert(prefix.into(), key.into());
        self
    }

    /// The models a prefix lists, as ids (Gemini: names that generate content).
    pub fn models(&self, prefix: &str, ids: &[&str]) -> &Self {
        let list = ids.iter().map(|id| json!(id)).collect();
        self.state.lock().unwrap().models.insert(prefix.into(), list);
        self
    }

    /// Every request under a prefix answers this status.
    pub fn fail(&self, prefix: &str, status: u16) -> &Self {
        self.state.lock().unwrap().status.insert(prefix.into(), status);
        self
    }

    pub fn recover(&self, prefix: &str) -> &Self {
        self.state.lock().unwrap().status.remove(prefix);
        self
    }

    /// The prefix closes every connection without answering.
    pub fn down(&self, prefix: &str, down: bool) -> &Self {
        self.state.lock().unwrap().down.insert(prefix.into(), down);
        self
    }

    /// Chat replies under a prefix are cut by the length limit.
    pub fn truncate(&self, prefix: &str, truncated: bool) -> &Self {
        self.state.lock().unwrap().truncated.insert(prefix.into(), truncated);
        self
    }

    /// Replies `(prefix, target, text) -> translation`; `None` uses the default.
    pub fn reply(&self, reply: impl Fn(&str, &str, &str) -> Option<String> + Send + Sync + 'static) -> &Self {
        self.state.lock().unwrap().reply = Some(Arc::new(reply));
        self
    }

    pub fn seen(&self) -> Vec<Seen> {
        self.state.lock().unwrap().seen.clone()
    }

    pub fn seen_under(&self, prefix: &str) -> Vec<Seen> {
        self.seen().into_iter().filter(|s| s.path.starts_with(prefix)).collect()
    }
}

impl Drop for FakeProviders {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Seen> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut data = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = stream.read(&mut buffer).ok()?;
        if read == 0 {
            return None;
        }
        data.extend_from_slice(&buffer[..read]);
        let mut headers = [httparse::EMPTY_HEADER; 64];
        let mut request = httparse::Request::new(&mut headers);
        if let Ok(httparse::Status::Complete(length)) = request.parse(&data) {
            let headers: Vec<(String, String)> = request
                .headers
                .iter()
                .map(|h| (h.name.to_string(), String::from_utf8_lossy(h.value).to_string()))
                .collect();
            let content_length = headers
                .iter()
                .find(|(n, _)| n.eq_ignore_ascii_case("content-length"))
                .and_then(|(_, v)| v.parse::<usize>().ok())
                .unwrap_or(0);
            let (method, path) = (request.method?.to_string(), request.path?.to_string());
            let mut body = data[length..].to_vec();
            while body.len() < content_length {
                let read = stream.read(&mut buffer).ok()?;
                if read == 0 {
                    break;
                }
                body.extend_from_slice(&buffer[..read]);
            }
            let body = serde_json::from_slice(&body).unwrap_or(Value::Null);
            return Some(Seen { method, path, headers, body });
        }
    }
}

fn answer(stream: &mut TcpStream, status: u16, body: &Value) {
    let text = body.to_string();
    let _ = write!(
        stream,
        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
        text.len()
    );
}

fn serve(mut stream: TcpStream, state: &Mutex<State>) {
    let Some(seen) = read_request(&mut stream) else {
        return;
    };
    let prefix = PREFIXES.iter().find(|p| seen.path.starts_with(**p)).copied().unwrap_or("");
    let rest = seen.path[prefix.len()..].to_string();
    let (key, models, status, truncated, down, reply) = {
        let mut state = state.lock().unwrap();
        state.seen.push(seen.clone());
        (
            state.keys.get(prefix).cloned().unwrap_or_default(),
            state.models.get(prefix).cloned().unwrap_or_default(),
            state.status.get(prefix).copied(),
            state.truncated.get(prefix).copied().unwrap_or(false),
            state.down.get(prefix).copied().unwrap_or(false),
            state.reply.clone(),
        )
    };
    if down {
        return;
    }
    if let Some(status) = status {
        answer(&mut stream, status, &json!({ "error": "failed" }));
        return;
    }
    let translate = |target: &str, text: &str| {
        reply
            .as_ref()
            .and_then(|r| r(prefix, target, text))
            .unwrap_or_else(|| format!("{}:{target}:{text}", prefix.trim_start_matches('/')))
    };
    let bearer = seen.header("authorization").map(|v| v.trim_start_matches("Bearer ").to_string()).unwrap_or_default();
    let target_of =
        |system: &str| system.split(" to ").nth(1).and_then(|t| t.split('.').next()).unwrap_or("").to_string();
    match prefix {
        "/deepl" | "/deepl-free" => {
            let auth = seen.header("authorization").unwrap_or("");
            if auth != format!("DeepL-Auth-Key {key}") {
                return answer(&mut stream, 403, &json!({ "message": "Forbidden" }));
            }
            let target = seen.body["target_lang"].as_str().unwrap_or("").to_string();
            let texts: Vec<Value> = seen.body["text"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|t| json!({ "detected_source_language": "JA", "text": translate(&target, t.as_str().unwrap_or("")) }))
                .collect();
            answer(&mut stream, 200, &json!({ "translations": texts }))
        }
        "/google-cloud" => {
            if seen.header("x-goog-api-key") != Some(key.as_str()) || key.is_empty() {
                return answer(
                    &mut stream,
                    400,
                    &json!({ "error": { "code": 400, "message": "API key not valid.", "status": "INVALID_ARGUMENT" } }),
                );
            }
            match rest.as_str() {
                "/language/translate/v2/languages" => {
                    answer(&mut stream, 200, &json!({ "data": { "languages": [{ "language": "en" }, { "language": "ja" }] } }))
                }
                "/language/translate/v2" => {
                    let target = seen.body["target"].as_str().unwrap_or("").to_string();
                    let texts: Vec<Value> = seen.body["q"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|t| json!({ "translatedText": translate(&target, t.as_str().unwrap_or("")) }))
                        .collect();
                    answer(&mut stream, 200, &json!({ "data": { "translations": texts } }))
                }
                _ => answer(&mut stream, 404, &json!({})),
            }
        }
        "/papago" => {
            let pair = format!(
                "{}:{}",
                seen.header("x-ncp-apigw-api-key-id").unwrap_or(""),
                seen.header("x-ncp-apigw-api-key").unwrap_or("")
            );
            if pair != key || key.is_empty() {
                return answer(
                    &mut stream,
                    401,
                    &json!({ "error": { "errorCode": "200", "message": "Authentication Failed" } }),
                );
            }
            if rest != "/nmt/v1/translation" {
                return answer(&mut stream, 404, &json!({}));
            }
            let text = seen.body["text"].as_str().unwrap_or("").to_string();
            if text.is_empty() {
                return answer(&mut stream, 400, &json!({ "error": { "errorCode": "N2MT07", "message": "text parameter is needed" } }));
            }
            let (source, target) = (seen.body["source"].as_str().unwrap_or(""), seen.body["target"].as_str().unwrap_or(""));
            answer(
                &mut stream,
                200,
                &json!({ "message": { "result": { "srcLangType": source, "tarLangType": target, "translatedText": translate(target, &text) } } }),
            )
        }
        "/gemini" => {
            if seen.header("x-goog-api-key") != Some(key.as_str()) {
                return answer(&mut stream, 400, &json!({ "error": { "status": "INVALID_ARGUMENT" } }));
            }
            if rest.starts_with("/v1beta/models?") || rest == "/v1beta/models" {
                let list: Vec<Value> = models
                    .iter()
                    .map(|m| json!({ "name": format!("models/{}", m.as_str().unwrap_or("")), "supportedGenerationMethods": ["generateContent"] }))
                    .collect();
                return answer(&mut stream, 200, &json!({ "models": list }));
            }
            let system = seen.body["systemInstruction"]["parts"][0]["text"].as_str().unwrap_or("").to_string();
            let text = seen.body["contents"][0]["parts"][0]["text"].as_str().unwrap_or("").to_string();
            let finish = if truncated { "MAX_TOKENS" } else { "STOP" };
            answer(
                &mut stream,
                200,
                &json!({ "candidates": [{ "content": { "parts": [{ "text": translate(&target_of(&system), &text) }] }, "finishReason": finish }] }),
            )
        }
        "/ollama" => match rest.as_str() {
            "" | "/" => answer(&mut stream, 200, &json!("Ollama is running")),
            "/api/tags" => {
                let list: Vec<Value> = models.iter().map(|m| json!({ "name": m })).collect();
                answer(&mut stream, 200, &json!({ "models": list }))
            }
            _ => {
                let system = seen.body["messages"][0]["content"].as_str().unwrap_or("").to_string();
                let text = seen.body["messages"][1]["content"].as_str().unwrap_or("").to_string();
                let reason = if truncated { "length" } else { "stop" };
                answer(
                    &mut stream,
                    200,
                    &json!({ "message": { "role": "assistant", "content": translate(&target_of(&system), &text) }, "done_reason": reason }),
                )
            }
        },
        "" => answer(&mut stream, 404, &json!({})),
        _ => {
            let keyless = prefix == "/lmstudio/v1";
            if !keyless && bearer != key {
                return answer(&mut stream, 401, &json!({ "error": { "message": "invalid key" } }));
            }
            match rest.as_str() {
                "/models" => {
                    let list: Vec<Value> = models.iter().map(|m| json!({ "id": m, "object": "model" })).collect();
                    answer(&mut stream, 200, &json!({ "object": "list", "data": list }))
                }
                "/auth/key" => answer(&mut stream, 200, &json!({ "data": {} })),
                "/chat/completions" => {
                    let system = seen.body["messages"][0]["content"].as_str().unwrap_or("").to_string();
                    let text = seen.body["messages"][1]["content"].as_str().unwrap_or("").to_string();
                    let reason = if truncated { "length" } else { "stop" };
                    answer(
                        &mut stream,
                        200,
                        &json!({ "choices": [{ "index": 0, "message": { "role": "assistant", "content": translate(&target_of(&system), &text) }, "finish_reason": reason }] }),
                    )
                }
                _ => answer(&mut stream, 404, &json!({})),
            }
        }
    }
}
