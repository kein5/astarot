//! The online and local-server translation providers (`src-python/models/translation/`).
//!
//! Each provider is a unit struct in its own module (as each was its own file in Python) that
//! implements [`Api`]. What the providers have in common is written once, as default methods
//! and associated constants of [`Api`] and, for the OpenAI-style chat providers, of
//! [`chat::ChatCompletions`]; a provider overrides only where it differs. Everything is resolved
//! at compile time: the traits are used only as generic bounds (`P: Api`), never as `dyn`, so
//! each call is a direct call to that provider's code.
//!
//! The settings name a provider at run time ([`Provider`]). [`Provider::call`] is the one place
//! that turns that name into the static type, with one `match`; [`Provider::check`],
//! [`Provider::models`], [`Provider::translate`] and the others go through it.
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

pub mod chat;
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

pub mod retry;

use crate::http::{HttpError, Response, Timeouts, Transport};
use crate::prompt::HistoryItem;
use serde_json::Value;
use std::time::{Duration, Instant};

pub use deepl::DeepL;
pub use gemini::Gemini;
pub use google_cloud::GoogleCloud;
pub use groq::Groq;
pub use lmstudio::LmStudio;
pub use ollama::Ollama;
pub use openai::OpenAi;
pub use openai_compatible::OpenAiCompatible;
pub use openrouter::OpenRouter;
pub use papago::Papago;
pub use plamo::Plamo;

// ------------------------------------------------------------------------- the provider trait

/// Where and as whom a provider is called. A provider reads only what it uses: the machine
/// translation APIs have no model, LM Studio and Ollama no key, only Papago a Client ID. Not
/// `Debug`, so that a key cannot be printed by mistake.
#[derive(Clone, Copy, Default)]
pub struct Access<'a> {
    pub base: &'a str,
    pub key: &'a str,
    /// Papago's Client ID.
    pub client_id: &'a str,
    /// The model to translate with (chat providers).
    pub model: Option<&'a str>,
}

impl<'a> Access<'a> {
    pub fn at(base: &'a str) -> Access<'a> {
        Access { base, ..Access::default() }
    }

    pub fn key(self, key: &'a str) -> Access<'a> {
        Access { key, ..self }
    }

    pub fn client_id(self, client_id: &'a str) -> Access<'a> {
        Access { client_id, ..self }
    }

    pub fn model(self, model: &'a str) -> Access<'a> {
        Access { model: Some(model), ..self }
    }

    /// The model of a chat provider; none chosen is [`Error::UnknownModel`].
    pub fn chosen_model(&self) -> Result<&'a str, Error> {
        self.model.ok_or(Error::UnknownModel)
    }
}

/// A translation provider. Each provider is a unit struct implementing this; the defaults are
/// the common case and a provider overrides only what it does differently.
///
/// A check is [`Api::reach`] then [`Api::list`]: `reach` is a check of its own where the provider
/// has one (DeepL, Google Cloud, Papago, OpenRouter's `/auth/key`, LM Studio and Ollama answering
/// at all); for the others the model list itself checks the key and `reach` does nothing.
///
/// Used only as a generic bound, never as `dyn Api`: the methods take no `self` and some are
/// generic, so every call is resolved at compile time.
pub trait Api {
    /// The runtime name of this provider.
    const PROVIDER: Provider;
    /// The engine name the settings keep (`AUTH_KEYS`, `SELECTABLE_TRANSLATION_ENGINE_STATUS`).
    const ENGINE: &'static str;
    /// Whether the user chooses a model. The machine translation APIs have none.
    const MODELS: bool = true;
    /// A server the user runs (this PC or the LAN): no key, the long local wait for a reply
    /// (it may load the model first) and no retry.
    const LOCAL: bool = false;
    /// The wait for one translation from a provider that is not local.
    const TRANSLATE_WAIT: Timeouts = CLOUD_CHAT;

    /// Whether this address gets the local wait and no retry. [`Api::LOCAL`], except where the
    /// user's address decides (the OpenAI-compatible endpoint).
    fn local(_base: &str) -> bool {
        Self::LOCAL
    }

    /// The provider's own check before the model list, if it has one.
    fn reach(_transport: &Transport, _access: &Access<'_>) -> Result<(), Error> {
        Ok(())
    }

    /// The models fit for translation, sorted. None for a provider without models.
    fn list(_transport: &Transport, _access: &Access<'_>) -> Result<Vec<String>, Error> {
        Ok(Vec::new())
    }

    /// Checks the key (or that the server answers) and lists the models: `setAuthKey` and the
    /// first `getModelList` of each Python client.
    fn check(transport: &Transport, access: &Access<'_>) -> Result<Vec<String>, Error> {
        Self::reach(transport, access)?;
        Self::list(transport, access)
    }

    /// The models asked again (`getModelList`); none when they cannot be read.
    fn models(transport: &Transport, access: &Access<'_>) -> Vec<String> {
        Self::list(transport, access).unwrap_or_default()
    }

    /// Translates one text. Codes as the engine's language table gives them.
    fn translate(transport: &Transport, access: &Access<'_>, request: &Translation<'_>) -> Result<String, Error>;

    /// Whether a failed translation is tried once more, and after how long: the rule of the SDK
    /// the Python client used (`docs/spec/cross-cutting.md`: the SDK's own judgement and
    /// backoff). `answer` is what the provider answered, if it answered; `since_start` the time
    /// since the first try began. The default is the OpenAI SDK's ([`retry::openai`]).
    fn backoff(error: Error, answer: Option<&Response>, since_start: Duration) -> Option<Duration> {
        let _ = since_start;
        retry::openai(error, answer)
    }

    /// Runs one translation request: a local address once with [`LOCAL_CHAT`], else with
    /// [`Api::TRANSLATE_WAIT`] and, when [`Api::backoff`] says so, once more after its pause (the
    /// SDKs' `max_retries=1`). `once` sends through the transport it is given, so that the
    /// answer's retry headers can be read.
    fn attempt<T>(
        transport: &Transport,
        base: &str,
        mut once: impl FnMut(&Transport, Timeouts) -> Result<T, Error>,
    ) -> Result<T, Error> {
        if Self::local(base) {
            return once(transport, LOCAL_CHAT);
        }
        let (watching, last) = retry::watch(transport);
        let started = Instant::now();
        match once(&watching, Self::TRANSLATE_WAIT) {
            Err(error) => {
                let answer = last.lock().unwrap_or_else(|e| e.into_inner()).take();
                match Self::backoff(error, answer.as_ref(), started.elapsed()) {
                    Some(pause) => {
                        std::thread::sleep(pause);
                        once(transport, Self::TRANSLATE_WAIT)
                    }
                    None => Err(error),
                }
            }
            done => done,
        }
    }
}

/// Something to do with whichever provider a runtime [`Provider`] names: [`Provider::call`]
/// calls `call::<P>()` with that provider's static type. A generic method, so each provider gets
/// its own compiled copy and nothing is looked up at run time beyond the one `match`.
pub trait Call {
    type Output;
    fn call<P: Api>(self) -> Self::Output;
}

struct Engine;
impl Call for Engine {
    type Output = &'static str;
    fn call<P: Api>(self) -> &'static str {
        P::ENGINE
    }
}

struct Facts;
impl Call for Facts {
    type Output = (bool, bool);
    fn call<P: Api>(self) -> (bool, bool) {
        (P::MODELS, P::LOCAL)
    }
}

struct Check<'t, 'a>(&'t Transport, Access<'a>);
impl Call for Check<'_, '_> {
    type Output = Result<Vec<String>, Error>;
    fn call<P: Api>(self) -> Self::Output {
        P::check(self.0, &self.1)
    }
}

struct Reach<'t, 'a>(&'t Transport, Access<'a>);
impl Call for Reach<'_, '_> {
    type Output = Result<(), Error>;
    fn call<P: Api>(self) -> Self::Output {
        P::reach(self.0, &self.1)
    }
}

struct Models<'t, 'a>(&'t Transport, Access<'a>);
impl Call for Models<'_, '_> {
    type Output = Vec<String>;
    fn call<P: Api>(self) -> Vec<String> {
        P::models(self.0, &self.1)
    }
}

struct Translate<'t, 'a, 'r>(&'t Transport, Access<'a>, &'r Translation<'r>);
impl Call for Translate<'_, '_, '_> {
    type Output = Result<String, Error>;
    fn call<P: Api>(self) -> Self::Output {
        P::translate(self.0, &self.1, self.2)
    }
}

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

    /// Calls `call::<P>()` with the provider's static type: the one place where the runtime name
    /// becomes a type. Static dispatch: each arm is a direct call to a monomorphized copy.
    pub fn call<C: Call>(self, call: C) -> C::Output {
        match self {
            Provider::DeepL => call.call::<DeepL>(),
            Provider::GoogleCloud => call.call::<GoogleCloud>(),
            Provider::Papago => call.call::<Papago>(),
            Provider::Plamo => call.call::<Plamo>(),
            Provider::Gemini => call.call::<Gemini>(),
            Provider::OpenAi => call.call::<OpenAi>(),
            Provider::Groq => call.call::<Groq>(),
            Provider::OpenRouter => call.call::<OpenRouter>(),
            Provider::OpenAiCompatible => call.call::<OpenAiCompatible>(),
            Provider::LmStudio => call.call::<LmStudio>(),
            Provider::Ollama => call.call::<Ollama>(),
        }
    }

    /// [`Api::ENGINE`].
    pub fn engine(self) -> &'static str {
        self.call(Engine)
    }

    pub fn from_engine(engine: &str) -> Option<Provider> {
        Provider::ALL.into_iter().find(|p| p.engine() == engine)
    }

    /// [`Api::LOCAL`].
    pub fn local(self) -> bool {
        self.call(Facts).1
    }

    /// Not [`Api::MODELS`]: a machine translation API, no model to choose.
    pub fn without_models(self) -> bool {
        !self.call(Facts).0
    }

    /// [`Api::check`].
    pub fn check(self, transport: &Transport, access: &Access<'_>) -> Result<Vec<String>, Error> {
        self.call(Check(transport, *access))
    }

    /// [`Api::reach`]: for LM Studio and Ollama, whether the server answers.
    pub fn reach(self, transport: &Transport, access: &Access<'_>) -> Result<(), Error> {
        self.call(Reach(transport, *access))
    }

    /// [`Api::models`].
    pub fn models(self, transport: &Transport, access: &Access<'_>) -> Vec<String> {
        self.call(Models(transport, *access))
    }

    /// [`Api::translate`].
    pub fn translate(
        self,
        transport: &Transport,
        access: &Access<'_>,
        request: &Translation<'_>,
    ) -> Result<String, Error> {
        self.call(Translate(transport, *access, request))
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

    /// Worth one more try by the OpenAI SDK's statuses (`max_retries=1`): a connection that
    /// failed or timed out, and 408, 409, 429 and 5xx. The answer's headers can say otherwise
    /// ([`retry::openai`]); the providers whose Python client used another SDK have their own
    /// rule in [`Api::backoff`].
    pub fn retryable(self) -> bool {
        self.retryable_with(|status| matches!(status, 408 | 409 | 429) || status >= 500)
    }

    /// Worth one more try: a connection that failed or timed out, or a status `statuses` takes.
    pub fn retryable_with(self, statuses: impl Fn(u16) -> bool) -> bool {
        match self {
            Error::Http(HttpError::Url) => false,
            Error::Http(_) => true,
            Error::Status(status) => statuses(status),
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
    /// Names and terms from the user's term dictionary that appear in `text` (#446), for the
    /// prompt; only the AI providers read it. Empty adds nothing to the prompt.
    pub glossary: &'a [String],
    /// The sampling temperature the user chose for the AI providers (#392). `None` sends none,
    /// so each provider keeps its own default (Gemini's is LangChain's 0.7).
    pub temperature: Option<f64>,
    /// What the user adds to the AI providers' system prompt (#392); empty adds nothing.
    pub instructions: &'a str,
}

// ------------------------------------------------------------------------- leaf helpers

/// `base` and a path, without a doubled slash.
pub(crate) fn join(base: &str, path: &str) -> String {
    format!("{}{path}", base.trim_end_matches('/'))
}

/// The answer when its status is 2xx.
pub(crate) fn checked(response: Response) -> Result<Response, Error> {
    if response.ok() {
        Ok(response)
    } else {
        Err(Error::Status(response.status))
    }
}

pub(crate) fn json_of(response: &Response) -> Result<Value, Error> {
    response.json().ok_or(Error::Answer)
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

/// A query value as a form encodes it (Python's `quote_plus`, which the Google SDK used): a
/// space becomes `+`, the rest as [`percent`].
pub(crate) fn form_value(text: &str) -> String {
    text.split(' ').map(percent).collect::<Vec<_>>().join("+")
}

/// The sorted `field` of each entry of `array` in the answer of a local server, without a key;
/// none when it does not answer or the answer cannot be read (the status is not looked at).
pub(crate) fn listed(transport: &Transport, url: &str, wait: Timeouts, array: &str, field: &str) -> Vec<String> {
    let entries = transport(&crate::http::Request::get(url), wait)
        .ok()
        .and_then(|r| r.json())
        .and_then(|body| body[array].as_array().cloned())
        .unwrap_or_default();
    let mut names: Vec<String> = entries.iter().filter_map(|m| m[field].as_str().map(str::to_string)).collect();
    names.sort();
    names
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

    #[test]
    fn each_runtime_name_reaches_its_own_type() {
        struct Id;
        impl Call for Id {
            type Output = Provider;
            fn call<P: Api>(self) -> Provider {
                P::PROVIDER
            }
        }
        for provider in Provider::ALL {
            assert_eq!(provider.call(Id), provider);
        }
        let without: Vec<Provider> = Provider::ALL.into_iter().filter(|p| p.without_models()).collect();
        assert_eq!(without, [Provider::DeepL, Provider::GoogleCloud, Provider::Papago]);
        let local: Vec<Provider> = Provider::ALL.into_iter().filter(|p| p.local()).collect();
        assert_eq!(local, [Provider::LmStudio, Provider::Ollama]);
    }
}
