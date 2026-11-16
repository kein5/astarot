//! OpenAI (`translation_openai.py`).
//!
//! The key is checked by listing the models. Only `gpt-` models (and fine-tunes of them) are
//! kept, without the words the Python client left out (case-sensitive, as in Python).
//! Translation is one Chat Completions request with one retry.

use super::{checked, contains_any, join, json_of, reply_text, retry_once, Error, Translation, CLOUD_CHAT, DISCOVERY};
use crate::http::{Request, Transport};
use crate::prompt;
use serde_json::{json, Value};

pub const BASE_URL: &str = "https://api.openai.com/v1";

const EXCLUDED: [&str; 9] = ["whisper", "embedding", "image", "tts", "audio", "search", "transcribe", "diarize", "vision"];

fn keep(model: &Value) -> Option<String> {
    let id = model["id"].as_str()?;
    let root = model["root"].as_str().unwrap_or("");
    let gpt = id.starts_with("gpt-") || (id.starts_with("ft:") && root.starts_with("gpt-"));
    (gpt && !contains_any(id, &EXCLUDED)).then(|| id.to_string())
}

/// The models fit for translation, sorted; the answer also checks the key.
pub fn models(transport: &Transport, base: &str, key: &str) -> Result<Vec<String>, Error> {
    let url = join(base, "/models");
    let request = Request::get(&url).header("Authorization", format!("Bearer {key}"));
    let body = json_of(&checked(transport(&request, DISCOVERY)?)?)?;
    let mut models: Vec<String> = body["data"].as_array().ok_or(Error::Answer)?.iter().filter_map(keep).collect();
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
        if choice["finish_reason"] == "length" || answer["incomplete_details"]["reason"] == "max_output_tokens" {
            return Ok(String::new());
        }
        if choice.is_null() {
            return Err(Error::Answer);
        }
        Ok(reply_text(&choice["message"]["content"]))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_gpt_models_and_their_fine_tunes_are_kept() {
        let ids = ["gpt-4o", "gpt-4o-audio-preview", "whisper-1", "o3", "text-embedding-3"];
        let kept: Vec<String> = ids.iter().filter_map(|id| keep(&json!({ "id": id }))).collect();
        assert_eq!(kept, ["gpt-4o"]);
        assert_eq!(keep(&json!({ "id": "ft:gpt-4o:me", "root": "gpt-4o" })).as_deref(), Some("ft:gpt-4o:me"));
        assert_eq!(keep(&json!({ "id": "ft:other", "root": "x" })), None);
    }
}
