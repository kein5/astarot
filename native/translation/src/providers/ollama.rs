//! Ollama on this PC or the LAN ([`translation_ollama.py`]), at `OLLAMA_URL`.
//!
//! Python always used `http://localhost:11434`; the core keeps that as the default and lets the
//! user choose another address, as for LM Studio. It has no key: the server counts as there
//! when its root answers 200 within 0.2 seconds. The models are the names of `/api/tags`
//! (2 seconds), asked only when the root answers. Translation is one `/api/chat` request with
//! `stream: false`, the long local wait and no retry. The body also has the empty `options` and
//! `tools` the LangChain client of Python sent: no sampling settings of its own, so the model's
//! defaults apply.
//!
//! [`translation_ollama.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/translation/translation_ollama.py

use super::{
    checked, join, json_of, listed, reply_text, Access, Api, Error, Provider, Translation, LOCAL_PROBE, OLLAMA_TAGS,
};
use crate::http::{Request, Transport};
use crate::prompt;
use serde_json::json;

/// `OLLAMA_URL` of a fresh start (the address Python always used).
pub const DEFAULT_URL: &str = "http://localhost:11434";

pub struct Ollama;

impl Api for Ollama {
    const PROVIDER: Provider = Provider::Ollama;
    const ENGINE: &'static str = "Ollama";
    const LOCAL: bool = true;

    /// Whether the server answers.
    fn reach(transport: &Transport, a: &Access<'_>) -> Result<(), Error> {
        let response = transport(&Request::get(a.base), LOCAL_PROBE)?;
        if response.status == 200 {
            Ok(())
        } else {
            Err(Error::Status(response.status))
        }
    }

    /// The names of `/api/tags`; none when the server does not answer or cannot be read.
    fn list(transport: &Transport, a: &Access<'_>) -> Result<Vec<String>, Error> {
        if Self::reach(transport, a).is_err() {
            return Ok(Vec::new());
        }
        Ok(listed(transport, &join(a.base, "/api/tags"), OLLAMA_TAGS, "models", "name"))
    }

    fn translate(transport: &Transport, a: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        let model = a.chosen_model()?;
        let url = join(a.base, "/api/chat");
        let system = prompt::system_prompt(false, t.supported_languages, t.source, t.target, t.history, t.glossary, t.instructions, t.speakers);
        // Ollama's sampling options; a temperature only when the user chose one (#392).
        let options = t.temperature.map_or_else(|| json!({}), |temperature| json!({ "temperature": temperature }));
        let body = json!({
            "model": model,
            "stream": false,
            "options": options,
            "messages": [{ "role": "system", "content": system }, { "role": "user", "content": t.text }],
            "tools": [],
        });
        Self::attempt(transport, a.base, |send, wait| {
            let answer = json_of(&checked(send(&Request::post_json(&url, &body), wait)?)?)?;
            if answer["done_reason"] == "length" {
                return Ok(String::new());
            }
            Ok(reply_text(&answer["message"]["content"]))
        })
    }
}
