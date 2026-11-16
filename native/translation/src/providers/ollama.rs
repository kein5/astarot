//! Ollama on this PC or the LAN (`translation_ollama.py`), at `OLLAMA_URL`.
//!
//! Python always used `http://localhost:11434`; the core keeps that as the default and lets the
//! user choose another address, as for LM Studio. It has no key: the server counts as there
//! when its root answers 200 within 0.2 seconds. The models are the names of `/api/tags`
//! (2 seconds). Translation is one `/api/chat` request with `stream: false`, the long local
//! wait and no retry.

use super::{checked, join, json_of, reply_text, Error, Translation, LOCAL_CHAT, LOCAL_PROBE, OLLAMA_TAGS};
use crate::http::{Request, Transport};
use crate::prompt;
use serde_json::json;

/// `OLLAMA_URL` of a fresh start (the address Python always used).
pub const DEFAULT_URL: &str = "http://localhost:11434";

/// Whether the server answers.
pub fn check(transport: &Transport, base: &str) -> Result<(), Error> {
    let response = transport(&Request::get(base), LOCAL_PROBE)?;
    if response.status == 200 { Ok(()) } else { Err(Error::Status(response.status)) }
}

/// The models, sorted; none when the server does not answer or cannot be read.
pub fn models(transport: &Transport, base: &str) -> Vec<String> {
    if check(transport, base).is_err() {
        return Vec::new();
    }
    let url = join(base, "/api/tags");
    let listed = transport(&Request::get(&url), OLLAMA_TAGS)
        .ok()
        .and_then(|r| r.json())
        .and_then(|body| body["models"].as_array().cloned())
        .unwrap_or_default();
    let mut names: Vec<String> = listed.iter().filter_map(|m| m["name"].as_str().map(str::to_string)).collect();
    names.sort();
    names
}

/// Translates one text with a model.
pub fn translate(transport: &Transport, base: &str, model: &str, t: &Translation<'_>) -> Result<String, Error> {
    let url = join(base, "/api/chat");
    let system = prompt::system_prompt(false, t.supported_languages, t.source, t.target, t.history);
    let body = json!({
        "model": model,
        "messages": [{ "role": "system", "content": system }, { "role": "user", "content": t.text }],
        "stream": false,
    });
    let answer = json_of(&checked(transport(&Request::post_json(&url, &body), LOCAL_CHAT)?)?)?;
    if answer["done_reason"] == "length" {
        return Ok(String::new());
    }
    Ok(reply_text(&answer["message"]["content"]))
}
