//! OpenRouter ([`translation_openrouter.py`]).
//!
//! The key is checked with `/auth/key` (status 200), then the models are listed. Every model is
//! kept except those whose id (lower-cased) has a word the Python client left out. Translation
//! is one Chat Completions request with one retry.
//!
//! [`translation_openrouter.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/translation/translation_openrouter.py

use super::chat::{id_without, ChatCompletions, NOT_FOR_TEXT};
use super::{join, Access, Api, Error, Provider, Translation, DISCOVERY};
use crate::http::{Request, Transport};
use serde_json::Value;

pub const BASE_URL: &str = "https://openrouter.ai/api/v1";

pub struct OpenRouter;

impl ChatCompletions for OpenRouter {
    fn keep(model: &Value) -> Option<String> {
        id_without(model, &NOT_FOR_TEXT)
    }
}

impl Api for OpenRouter {
    const PROVIDER: Provider = Provider::OpenRouter;
    const ENGINE: &'static str = "OpenRouter_API";

    /// Checks a key with `/auth/key`.
    fn reach(transport: &Transport, a: &Access<'_>) -> Result<(), Error> {
        let url = join(a.base, "/auth/key");
        let request = Request::get(&url).header("Authorization", Self::authorization(a.key));
        let response = transport(&request, DISCOVERY)?;
        if response.status == 200 {
            Ok(())
        } else {
            Err(Error::Status(response.status))
        }
    }

    fn list(transport: &Transport, a: &Access<'_>) -> Result<Vec<String>, Error> {
        Self::list_models(transport, a)
    }

    fn translate(transport: &Transport, a: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        Self::chat(transport, a, t)
    }
}
