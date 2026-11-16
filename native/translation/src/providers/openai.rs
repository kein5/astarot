//! OpenAI (`translation_openai.py`).
//!
//! The key is checked by listing the models. Only `gpt-` models (and fine-tunes of them) are
//! kept, without the words the Python client left out (case-sensitive, as in Python).
//! Translation is one Chat Completions request with one retry; a reply cut by
//! `max_output_tokens` also counts as no translation.

use super::chat::{ChatCompletions, NOT_FOR_TEXT};
use super::{contains_any, Access, Api, Error, Provider, Translation};
use crate::http::Transport;
use serde_json::Value;

pub const BASE_URL: &str = "https://api.openai.com/v1";

pub struct OpenAi;

impl ChatCompletions for OpenAi {
    const INCOMPLETE_DETAILS: bool = true;

    fn keep(model: &Value) -> Option<String> {
        let id = model["id"].as_str()?;
        let root = model["root"].as_str().unwrap_or("");
        let gpt = id.starts_with("gpt-") || (id.starts_with("ft:") && root.starts_with("gpt-"));
        (gpt && !contains_any(id, &NOT_FOR_TEXT)).then(|| id.to_string())
    }
}

impl Api for OpenAi {
    const PROVIDER: Provider = Provider::OpenAi;
    const ENGINE: &'static str = "OpenAI_API";

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
    use serde_json::json;

    #[test]
    fn only_gpt_models_and_their_fine_tunes_are_kept() {
        let ids = ["gpt-4o", "gpt-4o-audio-preview", "whisper-1", "o3", "text-embedding-3"];
        let kept: Vec<String> = ids.iter().filter_map(|id| OpenAi::keep(&json!({ "id": id }))).collect();
        assert_eq!(kept, ["gpt-4o"]);
        assert_eq!(OpenAi::keep(&json!({ "id": "ft:gpt-4o:me", "root": "gpt-4o" })).as_deref(), Some("ft:gpt-4o:me"));
        assert_eq!(OpenAi::keep(&json!({ "id": "ft:other", "root": "x" })), None);
    }
}
