//! The OpenAI-style chat providers: `GET {base}/models` and `POST {base}/chat/completions`, or
//! `POST {base}/responses` for the models that have only the Responses API.
//!
//! PLaMo, OpenAI, Groq, OpenRouter, the OpenAI-compatible endpoint and LM Studio speak this
//! shape. [`ChatCompletions`] writes the requests once; a provider sets what differs:
//!
//! - [`ChatCompletions::PLAMO_PROMPT`]: PLaMo's own system prompt.
//! - [`ChatCompletions::INCOMPLETE_DETAILS`]: whether a Responses API answer cut by
//!   `max_output_tokens` (`incomplete_details`) counts as no translation (OpenAI and the
//!   OpenAI-compatible endpoint, as in Python). A Chat Completions answer is cut when its
//!   `finish_reason` is `length`, for every provider.
//! - [`ChatCompletions::authorization`]: the `Authorization` header (`Bearer {key}`; LM Studio
//!   sends `Bearer lmstudio`).
//! - [`ChatCompletions::keep`]: which listed models are kept (every id by default).
//!
//! Which of the two APIs a translation uses follows LangChain's `ChatOpenAI`, which every one of
//! these Python clients used: the Responses API for a model whose name starts with one of
//! [`RESPONSES_ONLY_PREFIXES`] or has `codex` in it ([`responses_only`]), else Chat Completions.
//! The rule looks at the model name only, so it holds for every provider here.
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

/// The model names LangChain sends to the Responses API (`_RESPONSES_API_ONLY_PREFIXES` of
/// langchain-openai 1.7.3, the version the Python client locked).
pub const RESPONSES_ONLY_PREFIXES: [&str; 5] =
    ["gpt-5-pro", "gpt-5.2-pro", "gpt-5.4-pro", "gpt-5.5-pro", "gpt-5.6-sol"];

/// Whether a model is translated through the Responses API (`_model_prefers_responses_api`).
pub fn responses_only(model: &str) -> bool {
    RESPONSES_ONLY_PREFIXES.iter().any(|prefix| model.starts_with(prefix)) || model.contains("codex")
}

/// The id of a listed model unless it (lower-cased) has one of `words`.
pub(crate) fn id_without(model: &Value, words: &[&str]) -> Option<String> {
    let id = model["id"].as_str()?;
    (!contains_any(&id.to_lowercase(), words)).then(|| id.to_string())
}

/// The text of a Responses API answer: the `output_text` parts of its messages, in order and
/// trimmed. Reasoning, tool calls and refusals are not translations (LangChain's content blocks,
/// of which `extractTranslationText` keeps only the text).
fn output_text(answer: &Value) -> String {
    let mut joined = String::new();
    for item in answer["output"].as_array().into_iter().flatten().filter(|item| item["type"] == "message") {
        for part in item["content"].as_array().into_iter().flatten().filter(|part| part["type"] == "output_text") {
            if let Some(text) = part["text"].as_str() {
                joined.push_str(text);
            }
        }
    }
    joined.trim().to_string()
}

/// An OpenAI-style chat provider. Everything here is resolved at compile time per provider.
pub trait ChatCompletions: Api {
    /// PLaMo's prompt (`plamo-translate`) instead of the common one.
    const PLAMO_PROMPT: bool = false;
    /// A Responses API answer cut by `max_output_tokens` (`incomplete_details`) is also no
    /// translation.
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

    /// One translation: `POST {base}/chat/completions` with the system prompt and the text, or
    /// `POST {base}/responses` for a model that has only the Responses API.
    fn chat(transport: &Transport, access: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        let model = access.chosen_model()?;
        let system = prompt::system_prompt(Self::PLAMO_PROMPT, t.supported_languages, t.source, t.target, t.history);
        if responses_only(model) {
            return Self::respond(transport, access, model, &system, t.text);
        }
        let url = join(access.base, "/chat/completions");
        let body = json!({
            "model": model,
            "stream": false,
            "messages": [{ "role": "system", "content": system }, { "role": "user", "content": t.text }],
        });
        Self::attempt(access.base, |wait| {
            let request = Request::post_json(&url, &body).header("Authorization", Self::authorization(access.key));
            let answer = json_of(&checked(transport(&request, wait)?)?)?;
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

    /// `POST {base}/responses`, as LangChain sends it: the prompt and the text as two messages of
    /// `input`.
    fn respond(
        transport: &Transport,
        access: &Access<'_>,
        model: &str,
        system: &str,
        text: &str,
    ) -> Result<String, Error> {
        let url = join(access.base, "/responses");
        let body = json!({
            "model": model,
            "stream": false,
            "input": [
                { "content": system, "role": "system", "type": "message" },
                { "content": text, "role": "user", "type": "message" },
            ],
        });
        Self::attempt(access.base, |wait| {
            let request = Request::post_json(&url, &body).header("Authorization", Self::authorization(access.key));
            let answer = json_of(&checked(transport(&request, wait)?)?)?;
            if Self::INCOMPLETE_DETAILS && answer["incomplete_details"]["reason"] == "max_output_tokens" {
                return Ok(String::new());
            }
            Ok(output_text(&answer))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_responses_api_is_for_the_models_langchain_sends_there() {
        for model in
            ["gpt-5-pro", "gpt-5-pro-2025-10-06", "gpt-5.2-pro", "gpt-5.6-sol", "gpt-5-codex", "openai/codex-mini"]
        {
            assert!(responses_only(model), "{model}");
        }
        for model in ["gpt-5", "gpt-4o", "gpt-5.1-pro", "openai/gpt-5-pro", "Codex"] {
            assert!(!responses_only(model), "{model}");
        }
    }

    #[test]
    fn only_the_text_of_the_messages_is_the_translation() {
        let answer = json!({ "output": [
            { "type": "reasoning", "summary": [{ "type": "summary_text", "text": "thinking" }] },
            { "type": "message", "content": [
                { "type": "output_text", "text": " Hello, " },
                { "type": "refusal", "refusal": "no" },
                { "type": "output_text", "text": "world " },
            ] },
            { "type": "function_call", "arguments": "{}" },
        ] });
        assert_eq!(output_text(&answer), "Hello, world");
        assert_eq!(output_text(&json!({})), "");
    }
}
