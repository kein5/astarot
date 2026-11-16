//! An OpenAI-compatible endpoint the user chooses (`translation_openai_compatible.py`): a
//! service with its own key, or a server on this PC or the LAN.
//!
//! The key is checked by listing the models at the saved URL. Every model is kept except those
//! whose id (lower-cased) has a word the Python client left out. Translation is one Chat
//! Completions request. A cloud address gets the cloud waits and one retry, as in Python; an
//! address on this PC or the LAN ([`crate::http::is_local_host`]) gets the waits of LM Studio
//! and no retry, because such a server may first load its model.

use super::{
    checked, contains_any, join, json_of, reply_text, retry_once, Error, Translation, CLOUD_CHAT, DISCOVERY, LOCAL_CHAT,
};
use crate::http::{is_local_host, Request, Transport, Url};
use crate::prompt;
use serde_json::json;

/// `OPENAI_COMPATIBLE_URL` of a fresh start.
pub const DEFAULT_URL: &str = "https://api.openai.com/v1";

const EXCLUDED: [&str; 12] = [
    "whisper",
    "embedding",
    "image",
    "tts",
    "audio",
    "search",
    "transcribe",
    "diarize",
    "vision",
    "dall-e",
    "moderation",
    "rerank",
];

/// The models fit for translation, sorted; the answer also checks the key.
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

/// Whether the endpoint is on this PC or the LAN.
pub fn is_local(base: &str) -> bool {
    Url::parse(base).is_ok_and(|url| is_local_host(&url.host))
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
    let local = is_local(base);
    let once = || {
        let request = Request::post_json(&url, &body).header("Authorization", format!("Bearer {key}"));
        let answer = json_of(&checked(transport(&request, if local { LOCAL_CHAT } else { CLOUD_CHAT })?)?)?;
        let choice = &answer["choices"][0];
        if choice["finish_reason"] == "length" || answer["incomplete_details"]["reason"] == "max_output_tokens" {
            return Ok(String::new());
        }
        if choice.is_null() {
            return Err(Error::Answer);
        }
        Ok(reply_text(&choice["message"]["content"]))
    };
    if local { once() } else { retry_once(once) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_addresses_count_as_local() {
        assert!(is_local("http://192.168.1.20:8000/v1"));
        assert!(is_local("http://localhost:8000/v1"));
        assert!(!is_local("https://api.example.com/v1"));
    }
}
