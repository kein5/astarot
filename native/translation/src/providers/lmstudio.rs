//! LM Studio on this PC or the LAN ([`translation_lmstudio.py`]), at `LMSTUDIO_URL`.
//!
//! It has no key: the server counts as there when `/models` answers 200 within 0.2 seconds.
//! The model list is every listed model; a server that cannot be read lists none. Translation
//! is one Chat Completions request with the long local wait and no retry. LM Studio takes any
//! key; the LangChain client sent `lmstudio`, and so does this one.
//!
//! [`translation_lmstudio.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/translation/translation_lmstudio.py

use super::chat::ChatCompletions;
use super::{join, listed, Access, Api, Error, Provider, Translation, LOCAL_PROBE};
use crate::http::{Request, Transport};

/// `LMSTUDIO_URL` of a fresh start.
pub const DEFAULT_URL: &str = "http://127.0.0.1:1234/v1";

pub struct LmStudio;

impl ChatCompletions for LmStudio {
    fn authorization(_key: &str) -> String {
        "Bearer lmstudio".into()
    }
}

impl Api for LmStudio {
    const PROVIDER: Provider = Provider::LmStudio;
    const ENGINE: &'static str = "LMStudio";
    const LOCAL: bool = true;

    /// Whether the server answers.
    fn reach(transport: &Transport, a: &Access<'_>) -> Result<(), Error> {
        let url = join(a.base, "/models");
        let response = transport(&Request::get(&url), LOCAL_PROBE)?;
        if response.status == 200 {
            Ok(())
        } else {
            Err(Error::Status(response.status))
        }
    }

    /// Every listed model, without a key; none when the server cannot be read.
    fn list(transport: &Transport, a: &Access<'_>) -> Result<Vec<String>, Error> {
        Ok(listed(transport, &join(a.base, "/models"), LOCAL_PROBE, "data", "id"))
    }

    fn translate(transport: &Transport, a: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        Self::chat(transport, a, t)
    }
}
