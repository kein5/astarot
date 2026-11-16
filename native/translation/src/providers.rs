//! The online and local-server translation providers (`src-python/models/translation/`).
//!
//! Each provider checks a key (or that its server answers), lists the models fit for
//! translation, and translates one text. The rules are those of the Python clients:
//!
//! - DeepL checks a key by translating `" "` to `EN-US`; a key ending in `:fx` goes to the free
//!   API.
//! - OpenAI, Groq, Plamo, the OpenAI-compatible endpoint and Gemini check a key by listing the
//!   models; OpenRouter asks `/auth/key`. Each keeps only the models its Python client kept.
//! - LM Studio and Ollama have no key: the server must answer within 0.2 seconds.
//! - The chat providers send the system prompt of [`crate::prompt`] with the recent history. A
//!   reply cut by the length limit counts as no translation (`""`), as in Python.
//!
//! Keys go into a header only. No key, text or URL reaches an [`Error`].

use crate::http::{Deadline, HttpError, Request, Response, Timeouts, Transport};
use crate::prompt::{self, HistoryItem};
use serde_json::{json, Value};
use std::time::Duration;

/// A provider, by the name the settings keep (`AUTH_KEYS`, `SELECTABLE_TRANSLATION_ENGINE_STATUS`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Provider {
    DeepL,
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
    pub const ALL: [Provider; 9] = [
        Provider::DeepL,
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

    /// A server on this PC: no retry, a long wait for the reply (it may load the model).
    pub fn local(self) -> bool {
        matches!(self, Provider::LmStudio | Provider::Ollama)
    }
}

/// Where the providers with a fixed address are. Tests point them at a local server.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoints {
    pub deepl: String,
    pub deepl_free: String,
    pub plamo: String,
    pub gemini: String,
    pub openai: String,
    pub groq: String,
    pub openrouter: String,
    pub ollama: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Endpoints {
            deepl: "https://api.deepl.com".into(),
            deepl_free: "https://api-free.deepl.com".into(),
            plamo: "https://api.platform.preferredai.jp/v1".into(),
            gemini: "https://generativelanguage.googleapis.com".into(),
            openai: "https://api.openai.com/v1".into(),
            groq: "https://api.groq.com/openai/v1".into(),
            openrouter: "https://openrouter.ai/api/v1".into(),
            ollama: "http://localhost:11434".into(),
        }
    }
}

impl Endpoints {
    /// Every provider at one local server (for tests): `{base}/deepl`, `{base}/openai/v1`, ...
    pub fn all_at(base: &str) -> Endpoints {
        let base = base.trim_end_matches('/');
        Endpoints {
            deepl: format!("{base}/deepl"),
            deepl_free: format!("{base}/deepl-free"),
            plamo: format!("{base}/plamo/v1"),
            gemini: format!("{base}/gemini"),
            openai: format!("{base}/openai/v1"),
            groq: format!("{base}/groq/v1"),
            openrouter: format!("{base}/openrouter/v1"),
            ollama: format!("{base}/ollama"),
        }
    }

    /// The fixed address of a provider; `None` for those whose address the user chooses.
    pub fn fixed(&self, provider: Provider, key: &str) -> Option<String> {
        Some(match provider {
            Provider::DeepL if key.ends_with(":fx") => self.deepl_free.clone(),
            Provider::DeepL => self.deepl.clone(),
            Provider::Plamo => self.plamo.clone(),
            Provider::Gemini => self.gemini.clone(),
            Provider::OpenAi => self.openai.clone(),
            Provider::Groq => self.groq.clone(),
            Provider::OpenRouter => self.openrouter.clone(),
            Provider::Ollama => self.ollama.clone(),
            Provider::OpenAiCompatible | Provider::LmStudio => return None,
        })
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
    fn retryable(self) -> bool {
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
/// A chat with a server on this PC, which may load its model first (`LOCAL_LLM_TIMEOUT`).
pub const LOCAL_CHAT: Timeouts =
    Timeouts { connect: Duration::from_secs(5), read: Duration::from_secs(120), write: Duration::from_secs(10) };
/// DeepL at run time (`DEEPL_TIMEOUT`: 5 s to connect, 10 s to read).
pub const DEEPL: Timeouts =
    Timeouts { connect: Duration::from_secs(5), read: Duration::from_secs(10), write: Duration::from_secs(10) };
/// Whether LM Studio or Ollama answers: most people never start them.
pub const LOCAL_PROBE: Timeouts = Timeouts::all(0.2);
/// Ollama's model list (`/api/tags`), which start-up waits for.
pub const OLLAMA_TAGS: Timeouts = Timeouts::all(2.0);

fn join(base: &str, path: &str) -> String {
    format!("{}{path}", base.trim_end_matches('/'))
}

fn checked(response: Response) -> Result<Response, Error> {
    if response.ok() {
        Ok(response)
    } else {
        Err(Error::Status(response.status))
    }
}

fn json_of(response: &Response) -> Result<Value, Error> {
    response.json().ok_or(Error::Answer)
}

/// A provider with its address, key and model. The key is never printed.
#[derive(Clone)]
pub struct Client {
    pub provider: Provider,
    pub base_url: String,
    key: Option<String>,
    pub model: Option<String>,
    transport: Transport,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
            .field("provider", &self.provider)
            .field("key", &self.key.as_ref().map(|_| "<hidden>"))
            .field("model", &self.model)
            .finish()
    }
}

/// One translation to ask a provider for.
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

/// The models a provider lists, kept as its Python client kept them.
fn filter_models(provider: Provider, models: &[Value]) -> Vec<String> {
    const COMMON: [&str; 9] =
        ["whisper", "embedding", "image", "tts", "audio", "search", "transcribe", "diarize", "vision"];
    const COMPATIBLE: [&str; 12] = [
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
    let mut kept: Vec<String> = Vec::new();
    for model in models {
        let Some(id) = model["id"].as_str() else {
            continue;
        };
        let lower = id.to_lowercase();
        let keep = match provider {
            Provider::OpenAi => {
                let root = model["root"].as_str().unwrap_or("");
                !COMMON.iter().any(|k| id.contains(k))
                    && (id.starts_with("gpt-") || (id.starts_with("ft:") && root.starts_with("gpt-")))
            }
            Provider::Groq | Provider::OpenRouter => !COMMON.iter().any(|k| lower.contains(k)),
            Provider::OpenAiCompatible => !COMPATIBLE.iter().any(|k| lower.contains(k)),
            _ => true,
        };
        if keep {
            kept.push(id.to_string());
        }
    }
    kept.sort();
    kept
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

impl Client {
    pub fn new(provider: Provider, base_url: impl Into<String>, key: Option<String>, transport: Transport) -> Client {
        Client { provider, base_url: base_url.into(), key, model: None, transport }
    }

    fn send(&self, request: &Request<'_>, timeouts: Timeouts) -> Result<Response, HttpError> {
        (self.transport)(request, timeouts)
    }

    pub fn key(&self) -> Option<&str> {
        self.key.as_deref()
    }

    fn bearer<'a>(&self, request: Request<'a>) -> Request<'a> {
        let key = match self.provider {
            // LM Studio takes any key; LangChain sent "lmstudio".
            Provider::LmStudio => "lmstudio",
            _ => self.key.as_deref().unwrap_or(""),
        };
        request.header("Authorization", format!("Bearer {key}"))
    }

    fn gemini<'a>(&self, request: Request<'a>) -> Request<'a> {
        request.header("x-goog-api-key", self.key.clone().unwrap_or_default())
    }

    /// The raw model list of an OpenAI-style `/models`.
    fn openai_models(&self, timeouts: Timeouts) -> Result<Vec<Value>, Error> {
        let url = join(&self.base_url, "/models");
        let response = checked(self.send(&self.bearer(Request::get(&url)), timeouts)?)?;
        let body = json_of(&response)?;
        body["data"].as_array().cloned().ok_or(Error::Answer)
    }

    /// Every page of Gemini's models: (name without `models/`, can generate content).
    fn gemini_models(&self, deadline: Deadline) -> Result<Vec<String>, Error> {
        let mut names = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut url = join(&self.base_url, "/v1beta/models?pageSize=1000");
            if let Some(token) = &token {
                url.push_str(&format!("&pageToken={}", percent(token)));
            }
            let response = checked(self.send(&self.gemini(Request::get(&url)), deadline.cut(DISCOVERY)?)?)?;
            let body = json_of(&response)?;
            for model in body["models"].as_array().into_iter().flatten() {
                let Some(name) = model["name"].as_str() else {
                    continue;
                };
                let actions = model.get("supportedActions").or_else(|| model.get("supportedGenerationMethods"));
                let generates =
                    actions.and_then(Value::as_array).is_some_and(|a| a.iter().any(|v| v == "generateContent"));
                let lower = name.to_lowercase();
                const EXCLUDED: [&str; 6] = ["audio", "image", "veo", "tts", "robotics", "computer-use"];
                if (lower.contains("gemini") || lower.contains("gemma"))
                    && generates
                    && !EXCLUDED.iter().any(|k| name.contains(k))
                {
                    names.push(name.replace("models/", ""));
                }
            }
            match body["nextPageToken"].as_str() {
                Some(next) if !next.is_empty() => token = Some(next.to_string()),
                _ => break,
            }
        }
        names.sort();
        Ok(names)
    }

    /// Checks the key, or that the server answers. A provider whose check lists the models
    /// returns them, so that [`Client::models`] need not ask again right away.
    pub fn check(&self) -> Result<Option<Vec<String>>, Error> {
        let deadline = Deadline::after(DISCOVERY_DEADLINE);
        match self.provider {
            Provider::DeepL => {
                let url = join(&self.base_url, "/v2/translate");
                let body = json!({ "text": [" "], "target_lang": "EN-US" });
                let request = Request::post_json(&url, &body)
                    .header("Authorization", format!("DeepL-Auth-Key {}", self.key().unwrap_or("")));
                checked(self.send(&request, deadline.cut(DISCOVERY)?)?)?;
                Ok(None)
            }
            Provider::OpenRouter => {
                let url = join(&self.base_url, "/auth/key");
                let response = self.send(&self.bearer(Request::get(&url)), deadline.cut(DISCOVERY)?)?;
                if response.status == 200 {
                    Ok(None)
                } else {
                    Err(Error::Status(response.status))
                }
            }
            Provider::Gemini => Ok(Some(self.gemini_models(deadline)?)),
            Provider::OpenAi | Provider::Groq | Provider::Plamo | Provider::OpenAiCompatible => {
                let models = self.openai_models(deadline.cut(DISCOVERY)?)?;
                Ok(Some(filter_models(self.provider, &models)))
            }
            Provider::LmStudio => {
                let url = join(&self.base_url, "/models");
                let response = self.send(&Request::get(&url), LOCAL_PROBE)?;
                if response.status == 200 {
                    Ok(None)
                } else {
                    Err(Error::Status(response.status))
                }
            }
            Provider::Ollama => {
                let response = self.send(&Request::get(&self.base_url), LOCAL_PROBE)?;
                if response.status == 200 {
                    Ok(None)
                } else {
                    Err(Error::Status(response.status))
                }
            }
        }
    }

    /// The models fit for translation, sorted. LM Studio and Ollama answer an empty list when
    /// their server cannot be read, as in Python.
    pub fn models(&self) -> Result<Vec<String>, Error> {
        match self.provider {
            Provider::DeepL => Ok(Vec::new()),
            Provider::Gemini => self.gemini_models(Deadline::after(DISCOVERY_DEADLINE)),
            Provider::OpenAi | Provider::Groq | Provider::Plamo | Provider::OpenAiCompatible | Provider::OpenRouter => {
                Ok(filter_models(self.provider, &self.openai_models(DISCOVERY)?))
            }
            Provider::LmStudio => {
                let url = join(&self.base_url, "/models");
                let models = self
                    .send(&Request::get(&url), LOCAL_PROBE)
                    .ok()
                    .and_then(|r| r.json())
                    .and_then(|body| body["data"].as_array().cloned())
                    .unwrap_or_default();
                let mut ids: Vec<String> = models.iter().filter_map(|m| m["id"].as_str().map(str::to_string)).collect();
                ids.sort();
                Ok(ids)
            }
            Provider::Ollama => {
                if self.check().is_err() {
                    return Ok(Vec::new());
                }
                let url = join(&self.base_url, "/api/tags");
                let models = self
                    .send(&Request::get(&url), OLLAMA_TAGS)
                    .ok()
                    .and_then(|r| r.json())
                    .and_then(|body| body["models"].as_array().cloned())
                    .unwrap_or_default();
                let mut names: Vec<String> =
                    models.iter().filter_map(|m| m["name"].as_str().map(str::to_string)).collect();
                names.sort();
                Ok(names)
            }
        }
    }

    /// Chooses a model the provider lists (`setModel`).
    pub fn set_model(&mut self, model: &str, listed: &[String]) -> Result<(), Error> {
        if listed.iter().any(|m| m == model) {
            self.model = Some(model.to_string());
            Ok(())
        } else {
            Err(Error::UnknownModel)
        }
    }

    /// Translates one text. `Ok("")` when the reply was cut by the length limit or empty.
    pub fn translate(&self, translation: &Translation<'_>) -> Result<String, Error> {
        let retries = if self.provider.local() { 0 } else { 1 };
        let mut attempt = 0;
        loop {
            match self.translate_once(translation) {
                Err(error) if attempt < retries && error.retryable() => attempt += 1,
                other => return other,
            }
        }
    }

    fn translate_once(&self, t: &Translation<'_>) -> Result<String, Error> {
        if self.provider == Provider::DeepL {
            let url = join(&self.base_url, "/v2/translate");
            let body = json!({ "text": [t.text], "source_lang": t.source.to_uppercase(), "target_lang": t.target.to_uppercase() });
            let request = Request::post_json(&url, &body)
                .header("Authorization", format!("DeepL-Auth-Key {}", self.key().unwrap_or("")));
            let response = checked(self.send(&request, DEEPL)?)?;
            let body = json_of(&response)?;
            return body["translations"][0]["text"].as_str().map(str::to_string).ok_or(Error::Answer);
        }
        let model = self.model.clone().ok_or(Error::UnknownModel)?;
        let system = prompt::system_prompt(
            self.provider == Provider::Plamo,
            t.supported_languages,
            t.source,
            t.target,
            t.history,
        );
        let timeouts = if self.provider.local() { LOCAL_CHAT } else { CLOUD_CHAT };
        match self.provider {
            Provider::Gemini => {
                let url = join(&self.base_url, &format!("/v1beta/models/{}:generateContent", percent(&model)));
                let body = json!({
                    "contents": [{ "role": "user", "parts": [{ "text": t.text }] }],
                    "systemInstruction": { "parts": [{ "text": system }] },
                });
                let response = checked(self.send(&self.gemini(Request::post_json(&url, &body)), timeouts)?)?;
                let body = json_of(&response)?;
                let candidate = &body["candidates"][0];
                if candidate["finishReason"] == "MAX_TOKENS" {
                    return Ok(String::new());
                }
                let parts: Vec<Value> = candidate["content"]["parts"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|p| p["thought"] != true)
                    .filter_map(|p| p["text"].as_str().map(|s| json!(s)))
                    .collect();
                Ok(reply_text(&Value::Array(parts)))
            }
            Provider::Ollama => {
                let url = join(&self.base_url, "/api/chat");
                let body = json!({
                    "model": model,
                    "messages": [{ "role": "system", "content": system }, { "role": "user", "content": t.text }],
                    "stream": false,
                });
                let response = checked(self.send(&Request::post_json(&url, &body), timeouts)?)?;
                let body = json_of(&response)?;
                if body["done_reason"] == "length" {
                    return Ok(String::new());
                }
                Ok(reply_text(&body["message"]["content"]))
            }
            _ => {
                let url = join(&self.base_url, "/chat/completions");
                let body = json!({
                    "model": model,
                    "messages": [{ "role": "system", "content": system }, { "role": "user", "content": t.text }],
                    "stream": false,
                });
                let response = checked(self.send(&self.bearer(Request::post_json(&url, &body)), timeouts)?)?;
                let body = json_of(&response)?;
                let choice = &body["choices"][0];
                if choice["finish_reason"] == "length" || body["incomplete_details"]["reason"] == "max_output_tokens" {
                    return Ok(String::new());
                }
                if choice.is_null() {
                    return Err(Error::Answer);
                }
                Ok(reply_text(&choice["message"]["content"]))
            }
        }
    }
}

/// Percent-encodes a query or path value.
fn percent(text: &str) -> String {
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

/// A client ready to translate with: the key or server checked, the models listed, a model
/// chosen (`Translator.prepareCredential`). The chosen model is `selected` when the provider
/// lists it, else the first one.
#[derive(Clone, Debug)]
pub struct Prepared {
    pub client: Client,
    pub models: Vec<String>,
    pub selected: Option<String>,
}

pub fn prepare(
    transport: &Transport,
    provider: Provider,
    base_url: &str,
    key: Option<&str>,
    selected: Option<&str>,
) -> Result<Prepared, Error> {
    let mut client = Client::new(provider, base_url, key.map(str::to_string), transport.clone());
    let listed = client.check()?;
    if provider == Provider::DeepL {
        return Ok(Prepared { client, models: Vec::new(), selected: None });
    }
    let models = match listed {
        Some(models) if !models.is_empty() => models,
        _ => client.models()?,
    };
    if models.is_empty() || models.iter().any(|m| m.trim().is_empty()) {
        return Err(Error::NoModels);
    }
    let choice = match selected {
        Some(selected) if models.iter().any(|m| m == selected) => selected.to_string(),
        _ => models[0].clone(),
    };
    client.set_model(&choice, &models)?;
    Ok(Prepared { client, models, selected: Some(choice) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&str]) -> Vec<Value> {
        list.iter().map(|id| json!({ "id": id })).collect()
    }

    #[test]
    fn each_provider_keeps_the_models_its_python_client_kept() {
        let all = ids(&[
            "gpt-4o",
            "gpt-4o-audio-preview",
            "whisper-1",
            "o3",
            "llama-3.3-70b",
            "text-embedding-3",
            "Whisper-Large",
        ]);
        assert_eq!(filter_models(Provider::OpenAi, &all), ["gpt-4o"]);
        assert_eq!(filter_models(Provider::Groq, &all), ["gpt-4o", "llama-3.3-70b", "o3"]);
        assert_eq!(filter_models(Provider::Plamo, &all).len(), 7);
        let fine_tuned =
            vec![json!({ "id": "ft:gpt-4o:me", "root": "gpt-4o" }), json!({ "id": "ft:other", "root": "x" })];
        assert_eq!(filter_models(Provider::OpenAi, &fine_tuned), ["ft:gpt-4o:me"]);
        let compatible = ids(&["mistral-large", "dall-e-3", "bge-rerank", "omni-moderation"]);
        assert_eq!(filter_models(Provider::OpenAiCompatible, &compatible), ["mistral-large"]);
    }

    #[test]
    fn reply_text_joins_text_parts() {
        assert_eq!(reply_text(&json!("  hello \n")), "hello");
        let parts = json!(["a", { "type": "text", "text": "b" }, { "type": "image" }, { "content": "c" }]);
        assert_eq!(reply_text(&parts), "abc");
        assert_eq!(reply_text(&json!(null)), "");
    }

    #[test]
    fn the_key_is_not_printed() {
        let client =
            Client::new(Provider::OpenAi, "https://api.openai.com/v1", Some("sk-secret".into()), crate::http::direct());
        assert!(!format!("{client:?}").contains("secret"));
    }

    #[test]
    fn free_deepl_keys_go_to_the_free_api() {
        let endpoints = Endpoints::default();
        assert_eq!(endpoints.fixed(Provider::DeepL, "abc:fx").unwrap(), "https://api-free.deepl.com");
        assert_eq!(endpoints.fixed(Provider::DeepL, "abc").unwrap(), "https://api.deepl.com");
        assert_eq!(endpoints.fixed(Provider::LmStudio, ""), None);
    }
}
