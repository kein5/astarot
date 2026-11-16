//! LM Studio on this PC or the LAN (`translation_lmstudio.py`), at `LMSTUDIO_URL`.
//!
//! It has no key: the server counts as there when `/models` answers 200 within 0.2 seconds.
//! The model list is every listed model; a server that cannot be read lists none. Translation
//! is one Chat Completions request with the long local wait and no retry. LM Studio takes any
//! key; the LangChain client sent `lmstudio`, and so does this one.

use super::{checked, join, json_of, reply_text, Error, Translation, LOCAL_CHAT, LOCAL_PROBE};
use crate::http::{Request, Transport};
use crate::prompt;
use serde_json::json;

/// `LMSTUDIO_URL` of a fresh start.
pub const DEFAULT_URL: &str = "http://127.0.0.1:1234/v1";

/// Whether the server answers.
pub fn check(transport: &Transport, base: &str) -> Result<(), Error> {
    let url = join(base, "/models");
    let response = transport(&Request::get(&url), LOCAL_PROBE)?;
    if response.status == 200 { Ok(()) } else { Err(Error::Status(response.status)) }
}

/// The models, sorted; none when the server cannot be read.
pub fn models(transport: &Transport, base: &str) -> Vec<String> {
    let url = join(base, "/models");
    let listed = transport(&Request::get(&url), LOCAL_PROBE)
        .ok()
        .and_then(|r| r.json())
        .and_then(|body| body["data"].as_array().cloned())
        .unwrap_or_default();
    let mut models: Vec<String> = listed.iter().filter_map(|m| m["id"].as_str().map(str::to_string)).collect();
    models.sort();
    models
}

/// Translates one text with a model.
pub fn translate(transport: &Transport, base: &str, model: &str, t: &Translation<'_>) -> Result<String, Error> {
    let url = join(base, "/chat/completions");
    let system = prompt::system_prompt(false, t.supported_languages, t.source, t.target, t.history);
    let body = json!({
        "model": model,
        "messages": [{ "role": "system", "content": system }, { "role": "user", "content": t.text }],
        "stream": false,
    });
    let request = Request::post_json(&url, &body).header("Authorization", "Bearer lmstudio");
    let answer = json_of(&checked(transport(&request, LOCAL_CHAT)?)?)?;
    let choice = &answer["choices"][0];
    if choice["finish_reason"] == "length" {
        return Ok(String::new());
    }
    if choice.is_null() {
        return Err(Error::Answer);
    }
    Ok(reply_text(&choice["message"]["content"]))
}
