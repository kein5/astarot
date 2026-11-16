//! PLaMo (`translation_plamo.py`).
//!
//! The key is checked by listing the models; every listed model is kept. Translation is one
//! Chat Completions request with PLaMo's own prompt and one retry.

use super::chat::ChatCompletions;
use super::{Access, Api, Error, Provider, Translation};
use crate::http::Transport;

pub const BASE_URL: &str = "https://api.platform.preferredai.jp/v1";

pub struct Plamo;

impl ChatCompletions for Plamo {
    const PLAMO_PROMPT: bool = true;
}

impl Api for Plamo {
    const PROVIDER: Provider = Provider::Plamo;
    const ENGINE: &'static str = "Plamo_API";

    fn list(transport: &Transport, a: &Access<'_>) -> Result<Vec<String>, Error> {
        Self::list_models(transport, a)
    }

    fn translate(transport: &Transport, a: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        Self::chat(transport, a, t)
    }
}
