//! OpenRouter (`translation_openrouter.py`).
//!
//! The key is checked with `/auth/key` (status 200), then the models are listed. Every model is
//! kept except those whose id (lower-cased) has a word the Python client left out. Translation
//! is one Chat Completions request with one retry.

use super::{checked, contains_any, join, json_of, reply_text, retry_once, Error, Translation, CLOUD_CHAT, DISCOVERY};
use crate::http::{Request, Transport};
use crate::prompt;
use serde_json::json;

pub const BASE_URL: &str = "https://openrouter.ai/api/v1";

const EXCLUDED: [&str; 9] = ["whisper", "embedding", "image", "tts", "audio", "search", "transcribe", "diarize", "vision"];

/// Checks a key.
pub fn check(transport: &Transport, base: &str, key: &str) -> Result<(), Error> {
    let url = join(base, "/auth/key");
    let request = Request::get(&url).header("Authorization", format!("Bearer {key}"));
    let response = transport(&request, DISCOVERY)?;
    if response.status == 200 { Ok(()) } else { Err(Error::Status(response.status)) }
}

/// The models fit for translation, sorted.
pub fn models(transport: &Transport, base: &str, key: &str) -> Result<Vec<String>, Error> {
    let url = join(base, "/models");
    let request = Request::get(&url).header("Authorization", format!("Bearer {key}"));
    let body = json_of(&checked(transport(&request, DISCOVERY)?)?)?;
    let mut models: Vec<String> = body["data"]
        .as_array()
        .ok_or(Error::Answer)?
        .iter()
        .filter_map(|m| m["id"].as_str())
        .filter(|id| !contains_any(&id.to_lowercase(), &EXCLUDED))
        .map(str::to_string)
        .collect();
    models.sort();
    Ok(models)
}

/// Translates one text with a model.
pub fn translate(transport: &Transport, base: &str, key: &str, model: &str, t: &Translation<'_>) -> Result<String, Error> {
    let url = join(base, "/chat/completions");
    let system = prompt::system_prompt(false, t.supported_languages, t.source, t.target, t.history);
    let body = json!({
        "model": model,
        "messages": [{ "role": "system", "content": system }, { "role": "user", "content": t.text }],
        "stream": false,
    });
    retry_once(|| {
        let request = Request::post_json(&url, &body).header("Authorization", format!("Bearer {key}"));
        let answer = json_of(&checked(transport(&request, CLOUD_CHAT)?)?)?;
        let choice = &answer["choices"][0];
        if choice["finish_reason"] == "length" {
            return Ok(String::new());
        }
        if choice.is_null() {
            return Err(Error::Answer);
        }
        Ok(reply_text(&choice["message"]["content"]))
    })
}
