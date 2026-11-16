//! PLaMo (`translation_plamo.py`).
//!
//! The key is checked by listing the models; every listed model is kept. Translation is one
//! Chat Completions request with PLaMo's own prompt and one retry.

use super::{checked, join, json_of, reply_text, retry_once, Error, Translation, CLOUD_CHAT, DISCOVERY};
use crate::http::{Request, Transport};
use crate::prompt;
use serde_json::json;

pub const BASE_URL: &str = "https://api.platform.preferredai.jp/v1";

/// The models, sorted; the answer also checks the key.
pub fn models(transport: &Transport, base: &str, key: &str) -> Result<Vec<String>, Error> {
    let url = join(base, "/models");
    let request = Request::get(&url).header("Authorization", format!("Bearer {key}"));
    let body = json_of(&checked(transport(&request, DISCOVERY)?)?)?;
    let mut models: Vec<String> = body["data"]
        .as_array()
        .ok_or(Error::Answer)?
        .iter()
        .filter_map(|m| m["id"].as_str().map(str::to_string))
        .collect();
    models.sort();
    Ok(models)
}

/// Translates one text with a model.
pub fn translate(transport: &Transport, base: &str, key: &str, model: &str, t: &Translation<'_>) -> Result<String, Error> {
    let url = join(base, "/chat/completions");
    let system = prompt::system_prompt(true, t.supported_languages, t.source, t.target, t.history);
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
