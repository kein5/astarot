//! Groq (`translation_groq.py`).
//!
//! The key is checked by listing the models. Every model is kept except those whose id
//! (lower-cased) has a word the Python client left out. Translation is one Chat Completions
//! request with one retry.

use super::chat::{id_without, ChatCompletions, NOT_FOR_TEXT};
use super::{Access, Api, Error, Provider, Translation};
use crate::http::Transport;
use serde_json::Value;

pub const BASE_URL: &str = "https://api.groq.com/openai/v1";

pub struct Groq;

impl ChatCompletions for Groq {
    fn keep(model: &Value) -> Option<String> {
        id_without(model, &NOT_FOR_TEXT)
    }
}

impl Api for Groq {
    const PROVIDER: Provider = Provider::Groq;
    const ENGINE: &'static str = "Groq_API";

    fn list(transport: &Transport, a: &Access<'_>) -> Result<Vec<String>, Error> {
        Self::list_models(transport, a)
    }

    fn translate(transport: &Transport, a: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        Self::chat(transport, a, t)
    }
}
