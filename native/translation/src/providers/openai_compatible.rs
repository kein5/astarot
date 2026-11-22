//! An OpenAI-compatible endpoint the user chooses ([`translation_openai_compatible.py`]): a
//! service with its own key, or a server on this PC or the LAN.
//!
//! The key is checked by listing the models at the saved URL. Every model is kept except those
//! whose id (lower-cased) has a word the Python client left out. Translation is one Chat
//! Completions request (the Responses API for the models that have only it, as for OpenAI); a
//! Responses API answer cut by `max_output_tokens` also counts as no translation. A
//! cloud address gets the cloud waits and one retry, as in Python; an address on this PC or the
//! LAN ([`crate::http::is_local_host`]) gets the waits of LM Studio and no retry, because such a
//! server may first load its model.
//!
//! [`translation_openai_compatible.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/translation/translation_openai_compatible.py

use super::chat::{id_without, ChatCompletions};
use super::{Access, Api, Error, Provider, Translation};
use crate::http::{is_local_host, Transport, Url};
use serde_json::Value;

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

/// Whether the endpoint is on this PC or the LAN.
pub fn is_local(base: &str) -> bool {
    Url::parse(base).is_ok_and(|url| is_local_host(&url.host))
}

pub struct OpenAiCompatible;

impl ChatCompletions for OpenAiCompatible {
    const INCOMPLETE_DETAILS: bool = true;

    fn keep(model: &Value) -> Option<String> {
        id_without(model, &EXCLUDED)
    }
}

impl Api for OpenAiCompatible {
    const PROVIDER: Provider = Provider::OpenAiCompatible;
    const ENGINE: &'static str = "OpenAI_Compatible";

    fn local(base: &str) -> bool {
        is_local(base)
    }

    fn list(transport: &Transport, a: &Access<'_>) -> Result<Vec<String>, Error> {
        Self::list_models(transport, a)
    }

    fn translate(transport: &Transport, a: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        Self::chat(transport, a, t)
    }
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
