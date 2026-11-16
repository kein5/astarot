//! The OpenAI-style chat providers: `GET {base}/models` and `POST {base}/chat/completions`.
//!
//! PLaMo, OpenAI, Groq, OpenRouter, the OpenAI-compatible endpoint and LM Studio speak this
//! shape. [`ChatCompletions`] writes the two requests once; a provider sets what differs:
//!
//! - [`ChatCompletions::PLAMO_PROMPT`]: PLaMo's own system prompt.
//! - [`ChatCompletions::INCOMPLETE_DETAILS`]: whether `incomplete_details.reason ==
//!   "max_output_tokens"` also counts as a reply cut by the length limit (OpenAI and the
//!   OpenAI-compatible endpoint, as in Python). `finish_reason == "length"` always does.
//! - [`ChatCompletions::authorization`]: the `Authorization` header (`Bearer {key}`; LM Studio
//!   sends `Bearer lmstudio`).
//! - [`ChatCompletions::keep`]: which listed models are kept (every id by default).
//!
//! The waits and the retry come from [`Api::attempt`]: cloud waits and one retry, or the local
//! wait without a retry for a server on this PC or the LAN.

use super::{checked, contains_any, join, json_of, reply_text, Access, Api, Error, Translation, DISCOVERY};
use crate::http::{Request, Transport};
use crate::prompt;
use serde_json::{json, Value};

/// The words in a model id that the Python clients of OpenAI, Groq and OpenRouter left out.
pub(crate) const NOT_FOR_TEXT: [&str; 9] =
    ["whisper", "embedding", "image", "tts", "audio", "search", "transcribe", "diarize", "vision"];

/// The id of a listed model unless it (lower-cased) has one of `words`.
pub(crate) fn id_without(model: &Value, words: &[&str]) -> Option<String> {
    let id = model["id"].as_str()?;
    (!contains_any(&id.to_lowercase(), words)).then(|| id.to_string())
}

/// An OpenAI-style chat provider. Everything here is resolved at compile time per provider.
pub trait ChatCompletions: Api {
    /// PLaMo's prompt (`plamo-translate`) instead of the common one.
    const PLAMO_PROMPT: bool = false;
    /// A reply cut by `max_output_tokens` (`incomplete_details`) is also no translation.
    const INCOMPLETE_DETAILS: bool = false;

    /// The `Authorization` header for a key.
    fn authorization(key: &str) -> String {
        format!("Bearer {key}")
    }

    /// The id of a listed model to keep, or `None`.
    fn keep(model: &Value) -> Option<String> {
        model["id"].as_str().map(str::to_string)
    }

    /// `GET {base}/models` with the key; the answer also checks the key.
    fn list_models(transport: &Transport, access: &Access<'_>) -> Result<Vec<String>, Error> {
        let url = join(access.base, "/models");
        let request = Request::get(&url).header("Authorization", Self::authorization(access.key));
        let body = json_of(&checked(transport(&request, DISCOVERY)?)?)?;
        let mut models: Vec<String> =
            body["data"].as_array().ok_or(Error::Answer)?.iter().filter_map(Self::keep).collect();
        models.sort();
        Ok(models)
    }

    /// One `POST {base}/chat/completions` with the system prompt and the text.
    fn chat(transport: &Transport, access: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        let model = access.chosen_model()?;
        let url = join(access.base, "/chat/completions");
        let system = prompt::system_prompt(Self::PLAMO_PROMPT, t.supported_languages, t.source, t.target, t.history);
        let body = json!({
            "model": model,
            "messages": [{ "role": "system", "content": system }, { "role": "user", "content": t.text }],
            "stream": false,
        });
        Self::attempt(access.base, |wait| {
            let request = Request::post_json(&url, &body).header("Authorization", Self::authorization(access.key));
            let answer = json_of(&checked(transport(&request, wait)?)?)?;
            let choice = &answer["choices"][0];
            if choice["finish_reason"] == "length"
                || (Self::INCOMPLETE_DETAILS && answer["incomplete_details"]["reason"] == "max_output_tokens")
            {
                return Ok(String::new());
            }
            if choice.is_null() {
                return Err(Error::Answer);
            }
            Ok(reply_text(&choice["message"]["content"]))
        })
    }
}
