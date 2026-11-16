//! The online and local-server translation providers (`src-python/models/translation/`).
//!
//! Each provider is its own module, as each was its own file in Python: it builds its own
//! requests and reads its own answers. There is no provider trait and no shared request
//! builder; the caller (the core) chooses the module, as `translation_translator.py` chose the
//! client. What this module shares is only leaf work that is not a provider: the provider names,
//! the fixed addresses, the error values, the waits, and small helpers for URLs, JSON and one
//! retry.
//!
//! The rules are those of the Python clients:
//!
//! - DeepL checks a key by translating `" "` to `EN-US`; a key ending in `:fx` goes to the free
//!   API.
//! - OpenAI, Groq, Plamo, the OpenAI-compatible endpoint and Gemini check a key by listing the
//!   models; OpenRouter asks `/auth/key`. Each keeps only the models its Python client kept.
//! - LM Studio and Ollama have no key: the server must answer within 0.2 seconds.
//! - The chat providers send the system prompt of [`crate::prompt`] with the recent history. A
//!   reply cut by the length limit counts as no translation (`""`), as in Python.
//! - Google Cloud Translation (Basic, v2) and NAVER Cloud Platform Papago Translation are new in
//!   the core (no Python client): see their modules.
//!
//! Keys go into a header only. No key, text or URL reaches an [`Error`].

pub mod deepl;
pub mod gemini;
pub mod google_cloud;
pub mod groq;
pub mod lmstudio;
pub mod ollama;
pub mod openai;
pub mod openai_compatible;
pub mod openrouter;
pub mod papago;
pub mod plamo;

use crate::http::{HttpError, Response, Timeouts};
use crate::prompt::HistoryItem;
use serde_json::Value;
use std::time::Duration;

/// A provider, by the name the settings keep (`AUTH_KEYS`, `SELECTABLE_TRANSLATION_ENGINE_STATUS`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Provider {
    DeepL,
    GoogleCloud,
    Papago,
    Plamo,
    Gemini,
    OpenAi,
    Groq,
    OpenRouter,
    OpenAiCompatible,
    LmStudio,
    Ollama,
}

impl Provider {
    pub const ALL: [Provider; 11] = [
        Provider::DeepL,
        Provider::GoogleCloud,
        Provider::Papago,
        Provider::Plamo,
        Provider::Gemini,
        Provider::OpenAi,
        Provider::Groq,
        Provider::OpenRouter,
        Provider::OpenAiCompatible,
        Provider::LmStudio,
        Provider::Ollama,
    ];

    pub fn engine(self) -> &'static str {
        match self {
            Provider::DeepL => "DeepL_API",
            Provider::GoogleCloud => "Google_Cloud_API",
            Provider::Papago => "Papago_API",
            Provider::Plamo => "Plamo_API",
            Provider::Gemini => "Gemini_API",
            Provider::OpenAi => "OpenAI_API",
            Provider::Groq => "Groq_API",
            Provider::OpenRouter => "OpenRouter_API",
            Provider::OpenAiCompatible => "OpenAI_Compatible",
            Provider::LmStudio => "LMStudio",
            Provider::Ollama => "Ollama",
        }
    }

    pub fn from_engine(engine: &str) -> Option<Provider> {
        Provider::ALL.into_iter().find(|p| p.engine() == engine)
    }

    /// A server the user runs (this PC or the LAN): no retry, a long wait for the reply (it may
    /// load the model first).
    pub fn local(self) -> bool {
        matches!(self, Provider::LmStudio | Provider::Ollama)
    }

    /// A machine translation API: no model to choose.
    pub fn without_models(self) -> bool {
        matches!(self, Provider::DeepL | Provider::GoogleCloud | Provider::Papago)
    }
}

/// Where the providers with a fixed address are. Tests point them at a local server. LM Studio,
/// Ollama and the OpenAI-compatible endpoint are where the user says (`LMSTUDIO_URL`,
/// `OLLAMA_URL`, `OPENAI_COMPATIBLE_URL`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoints {
    pub deepl: String,
    pub deepl_free: String,
    pub google_cloud: String,
    pub papago: String,
    pub plamo: String,
    pub gemini: String,
    pub openai: String,
    pub groq: String,
    pub openrouter: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Endpoints {
            deepl: deepl::BASE_URL.into(),
            deepl_free: deepl::FREE_BASE_URL.into(),
            google_cloud: google_cloud::BASE_URL.into(),
            papago: papago::BASE_URL.into(),
            plamo: plamo::BASE_URL.into(),
            gemini: gemini::BASE_URL.into(),
            openai: openai::BASE_URL.into(),
            groq: groq::BASE_URL.into(),
            openrouter: openrouter::BASE_URL.into(),
        }
    }
}

impl Endpoints {
    /// Every provider at one local server (for tests): `{base}/deepl`, `{base}/openai/v1`, ...
    /// (the prefixes of [`crate::fake`]).
    pub fn all_at(base: &str) -> Endpoints {
        let base = base.trim_end_matches('/');
        Endpoints {
            deepl: format!("{base}/deepl"),
            deepl_free: format!("{base}/deepl-free"),
            google_cloud: format!("{base}/google-cloud"),
            papago: format!("{base}/papago"),
            plamo: format!("{base}/plamo/v1"),
            gemini: format!("{base}/gemini"),
            openai: format!("{base}/openai/v1"),
            groq: format!("{base}/groq/v1"),
            openrouter: format!("{base}/openrouter/v1"),
        }
    }
}

/// Why a provider call failed. Fixed values only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Http(HttpError),
    /// The provider answered with this status.
    Status(u16),
    /// The answer was not what the provider sends.
    Answer,
    /// No model fit for translation.
    NoModels,
    /// The model is not one the provider lists.
    UnknownModel,
    /// The provider cannot translate between these two languages.
    UnsupportedPair,
}

impl From<HttpError> for Error {
    fn from(error: HttpError) -> Self {
        Error::Http(error)
    }
}

impl Error {
    /// Nothing answered at all (a local server that is not running).
    pub fn nothing_answered(self) -> bool {
        matches!(self, Error::Http(HttpError::Unreachable))
    }

    /// Worth one more try at run time (`max_retries=1`; the SDKs' retry rules).
    pub fn retryable(self) -> bool {
        match self {
            Error::Http(HttpError::Url) => false,
            Error::Http(_) => true,
            Error::Status(status) => matches!(status, 408 | 409 | 429) || status >= 500,
            _ => false,
        }
    }

    pub fn code(self) -> String {
        match self {
            Error::Http(error) => error.code().to_string(),
            Error::Status(status) => format!("status_{status}"),
            Error::Answer => "unexpected_answer".into(),
            Error::NoModels => "no_models".into(),
            Error::UnknownModel => "unknown_model".into(),
            Error::UnsupportedPair => "unsupported_pair".into(),
        }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.code())
    }
}

impl std::error::Error for Error {}

/// The wait for key checks and model lists (`DISCOVERY_TIMEOUT`), and for all of one check
/// together (`DISCOVERY_DEADLINE`).
pub const DISCOVERY: Timeouts = Timeouts::all(3.0);
pub const DISCOVERY_DEADLINE: Duration = Duration::from_secs(8);
/// A cloud chat (`CLOUD_LLM_TIMEOUT`).
pub const CLOUD_CHAT: Timeouts =
    Timeouts { connect: Duration::from_secs(5), read: Duration::from_secs(30), write: Duration::from_secs(10) };
/// A chat with a server the user runs, which may load its model first (`LOCAL_LLM_TIMEOUT`).
pub const LOCAL_CHAT: Timeouts =
    Timeouts { connect: Duration::from_secs(5), read: Duration::from_secs(120), write: Duration::from_secs(10) };
/// A machine translation API at run time: DeepL's `DEEPL_TIMEOUT` (5 s to connect, 10 s to
/// read), also used for Google Cloud and Papago.
pub const MACHINE_TRANSLATION: Timeouts =
    Timeouts { connect: Duration::from_secs(5), read: Duration::from_secs(10), write: Duration::from_secs(10) };
/// Whether LM Studio or Ollama answers: most people never start them.
pub const LOCAL_PROBE: Timeouts = Timeouts::all(0.2);
/// Ollama's model list (`/api/tags`), which start-up waits for.
pub const OLLAMA_TAGS: Timeouts = Timeouts::all(2.0);

/// One translation to ask a chat provider for.
#[derive(Clone, Debug)]
pub struct Translation<'a> {
    pub text: &'a str,
    /// The source and target as the engine's language table names them.
    pub source: &'a str,
    pub target: &'a str,
    /// The source languages of the engine, for the prompt.
    pub supported_languages: &'a [String],
    pub history: &'a [HistoryItem],
}

// ------------------------------------------------------------------------- leaf helpers

/// `base` and a path, without a doubled slash.
pub(crate) fn join(base: &str, path: &str) -> String {
    format!("{}{path}", base.trim_end_matches('/'))
}

/// The answer when its status is 2xx.
pub(crate) fn checked(response: Response) -> Result<Response, Error> {
    if response.ok() { Ok(response) } else { Err(Error::Status(response.status)) }
}

pub(crate) fn json_of(response: &Response) -> Result<Value, Error> {
    response.json().ok_or(Error::Answer)
}

/// Runs a request once more when the first failure is worth it (the SDKs' `max_retries=1`).
pub(crate) fn retry_once<T>(mut attempt: impl FnMut() -> Result<T, Error>) -> Result<T, Error> {
    match attempt() {
        Err(error) if error.retryable() => attempt(),
        other => other,
    }
}

/// Percent-encodes a query or path value.
pub(crate) fn percent(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Whether a model id contains one of the words a client left out.
pub(crate) fn contains_any(id: &str, words: &[&str]) -> bool {
    words.iter().any(|w| id.contains(w))
}

/// The text of a chat reply (`extractTranslationText`).
pub fn reply_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.trim().to_string(),
        Value::Array(parts) => {
            let mut joined = String::new();
            for part in parts {
                match part {
                    Value::String(text) => joined.push_str(text),
                    Value::Object(object) => {
                        let text = match object.get("type") {
                            Some(kind) if kind == "text" => object.get("text").or_else(|| object.get("content")),
                            Some(_) => None,
                            None => object.get("content"),
                        };
                        if let Some(Value::String(text)) = text {
                            joined.push_str(text);
                        }
                    }
                    _ => {}
                }
            }
            joined.trim().to_string()
        }
        _ => String::new(),
    }
}

/// The model to use from a provider's list (`Translator.prepareCredential`): `selected` when
/// the provider lists it, else the first one. An empty list, or one with a blank name, has none.
pub fn choose_model(models: &[String], selected: Option<&str>) -> Result<String, Error> {
    if models.is_empty() || models.iter().any(|m| m.trim().is_empty()) {
        return Err(Error::NoModels);
    }
    Ok(match selected {
        Some(selected) if models.iter().any(|m| m == selected) => selected.to_string(),
        _ => models[0].clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reply_text_joins_text_parts() {
        assert_eq!(reply_text(&json!("  hello \n")), "hello");
        let parts = json!(["a", { "type": "text", "text": "b" }, { "type": "image" }, { "content": "c" }]);
        assert_eq!(reply_text(&parts), "abc");
        assert_eq!(reply_text(&json!(null)), "");
    }

    #[test]
    fn a_saved_model_is_kept_while_listed() {
        let models = vec!["a".to_string(), "b".to_string()];
        assert_eq!(choose_model(&models, Some("b")).unwrap(), "b");
        assert_eq!(choose_model(&models, Some("gone")).unwrap(), "a");
        assert_eq!(choose_model(&[], None), Err(Error::NoModels));
        assert_eq!(choose_model(&[" ".to_string()], None), Err(Error::NoModels));
    }

    #[test]
    fn engine_names_round_trip() {
        for provider in Provider::ALL {
            assert_eq!(Provider::from_engine(provider.engine()), Some(provider));
        }
    }
}
