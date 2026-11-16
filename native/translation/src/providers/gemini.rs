//! Gemini (`translation_gemini.py`).
//!
//! The key goes in `x-goog-api-key`. It is checked by listing the models, every page of them
//! (8 seconds for all). Only Gemini and Gemma models that generate content are kept, without
//! the audio, image, video, speech, robotics and computer-use models. Translation is one
//! `generateContent` request with the prompt as the system instruction and one retry; thought
//! parts are left out of the reply.

use super::{
    checked, join, json_of, percent, reply_text, Access, Api, Error, Provider, Translation, DISCOVERY,
    DISCOVERY_DEADLINE,
};
use crate::http::{Deadline, Request, Transport};
use crate::prompt;
use serde_json::{json, Value};

pub const BASE_URL: &str = "https://generativelanguage.googleapis.com";

const EXCLUDED: [&str; 6] = ["audio", "image", "veo", "tts", "robotics", "computer-use"];

fn keep(model: &Value) -> Option<String> {
    let name = model["name"].as_str()?;
    let actions = model.get("supportedActions").or_else(|| model.get("supportedGenerationMethods"));
    let generates = actions.and_then(Value::as_array).is_some_and(|a| a.iter().any(|v| v == "generateContent"));
    let lower = name.to_lowercase();
    let family = lower.contains("gemini") || lower.contains("gemma");
    (family && generates && !EXCLUDED.iter().any(|k| name.contains(k))).then(|| name.replace("models/", ""))
}

pub struct Gemini;

impl Api for Gemini {
    const PROVIDER: Provider = Provider::Gemini;
    const ENGINE: &'static str = "Gemini_API";

    /// The models fit for translation, every page, sorted; the answer also checks the key.
    fn list(transport: &Transport, a: &Access<'_>) -> Result<Vec<String>, Error> {
        let deadline = Deadline::after(DISCOVERY_DEADLINE);
        let mut names = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut url = join(a.base, "/v1beta/models?pageSize=1000");
            if let Some(token) = &token {
                url.push_str(&format!("&pageToken={}", percent(token)));
            }
            let request = Request::get(&url).header("x-goog-api-key", a.key);
            let body = json_of(&checked(transport(&request, deadline.cut(DISCOVERY)?)?)?)?;
            names.extend(body["models"].as_array().into_iter().flatten().filter_map(keep));
            match body["nextPageToken"].as_str() {
                Some(next) if !next.is_empty() => token = Some(next.to_string()),
                _ => break,
            }
        }
        names.sort();
        Ok(names)
    }

    fn translate(transport: &Transport, a: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        let model = a.chosen_model()?;
        let url = join(a.base, &format!("/v1beta/models/{}:generateContent", percent(model)));
        let system = prompt::system_prompt(false, t.supported_languages, t.source, t.target, t.history);
        let body = json!({
            "contents": [{ "role": "user", "parts": [{ "text": t.text }] }],
            "systemInstruction": { "parts": [{ "text": system }] },
        });
        Self::attempt(a.base, |wait| {
            let request = Request::post_json(&url, &body).header("x-goog-api-key", a.key);
            let answer = json_of(&checked(transport(&request, wait)?)?)?;
            let candidate = &answer["candidates"][0];
            if candidate["finishReason"] == "MAX_TOKENS" {
                return Ok(String::new());
            }
            let parts: Vec<Value> = candidate["content"]["parts"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|p| p["thought"] != true)
                .filter_map(|p| p["text"].as_str().map(|s| json!(s)))
                .collect();
            Ok(reply_text(&Value::Array(parts)))
        })
    }
}
