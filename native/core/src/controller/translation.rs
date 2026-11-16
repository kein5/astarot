//! The translation engines (#277): the keys and models of the online providers, LM Studio and
//! Ollama, the local translation, the switch, the start-up check and the translation itself
//! (`controller.py`: `_setTranslationEngineAuthKey`, `_setTranslationEngineModel`,
//! `_checkTranslationEngineConnection`, `setDeeplAuthKey`, `setOpenAICompatibleAuthKey`,
//! `_setEndpointCredential`, `setTranslatorLMStudioURL`, `setCtranslate2WeightType`,
//! `setEnableTranslation`, `changeToCTranslate2Process` and the engine part of `init`;
//! `model.py`: `getTranslate`, `getInputTranslate`, `getOutputTranslate` and the history).
//!
//! The provider clients are in `native/translation`, one module per provider and no common
//! layer; the branches that choose the module are here ([`Translators::check`],
//! [`Translators::models`], [`Translators::translate`]), as `translation_translator.py` chose
//! the client. Google Cloud Translation and Papago (NAVER Cloud Platform) are core additions
//! (#277); the Ollama URL is a core addition (`OLLAMA_URL`). The local translation is a
//! [`LocalTranslation`] given by [`super::Services::local_translation`]: ONNX Runtime
//! (`native/translate-onnx`) when the core is built with the `onnx-translation` feature, else
//! nothing (see "判断が要ること" 1 and 2 in `docs/voice-stack/core-integration.md`).
//!
//! Keys, URLs with their queries and the user's text never reach the log.

use super::languages::LOCAL_ENGINE;
use super::routes::{Builder, OPEN, WAIT};
use super::settings::python_str;
use super::{error, ok, Core};
use crate::errors::ErrorReply;
use crate::net_policy::validate_api_url;
use crate::protocol::Reply;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vrct_translation::http::Transport;
use vrct_translation::prompt::HistoryItem;
use vrct_translation::providers::{
    self as providers, deepl, gemini, google_cloud, groq, lmstudio, ollama, openai, openai_compatible, openrouter, papago,
    plamo, Endpoints, Provider,
};

// ------------------------------------------------------------------------- local translation

/// What the local model is loaded with: the weight and the compute settings as saved.
#[derive(Clone, Debug, PartialEq)]
pub struct LocalSetup {
    /// `CTRANSLATE2_WEIGHT_TYPE` (e.g. `m2m100_418M-ct2-int8`).
    pub weight: String,
    /// `SELECTED_TRANSLATION_COMPUTE_DEVICE`.
    pub device: Value,
    /// `SELECTED_TRANSLATION_COMPUTE_TYPE`.
    pub compute_type: String,
}

/// Why the local translation could not load or translate. Fixed values only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocalError {
    /// The model of the weight is not on this PC (`MissingCTranslate2Tokenizer`).
    Missing,
    /// It is there but could not be loaded.
    LoadFailed,
    /// The GPU ran out of memory (`detectVRAMError`); the text is a fixed description.
    OutOfMemory(String),
    /// The model has no such language.
    Unsupported,
    /// Nothing loaded, or the translation failed.
    Failed,
}

/// Where the loaded model runs. Fixed names only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Placement {
    /// The execution provider (`cpu`, `directml`, `cuda`, ...).
    pub device: String,
    pub device_index: u32,
    /// The quantization variant (`int8`, `float16`, ...).
    pub variant: String,
    /// The device asked for and the fixed reason it could not be used, when the model runs on
    /// the CPU instead.
    pub fallback: Option<(String, &'static str)>,
}

/// The local translation model (`changeCTranslate2Model`, `translateCTranslate2`).
pub trait LocalTranslation: Send + Sync {
    /// Loads a model, dropping the one loaded before even when this fails.
    fn load(&self, setup: &LocalSetup) -> Result<(), LocalError>;
    /// What is loaded now.
    fn loaded(&self) -> Option<LocalSetup>;
    /// Translates with the loaded model; codes as the weight's language table gives them.
    fn translate(&self, text: &str, source: &str, target: &str) -> Result<String, LocalError>;
    /// Where the loaded model runs, if one is loaded.
    fn placement(&self) -> Option<Placement> {
        None
    }
    /// The language table (`{"source": {name: code}, "target": ...}`) of a weight the built-in
    /// table does not have: a model the user added.
    fn languages(&self, _weight: &str) -> Option<Value> {
        None
    }
}

/// No local translation in this build: nothing loads.
pub struct NoLocalTranslation;

impl LocalTranslation for NoLocalTranslation {
    fn load(&self, _setup: &LocalSetup) -> Result<(), LocalError> {
        Err(LocalError::Missing)
    }

    fn loaded(&self) -> Option<LocalSetup> {
        None
    }

    fn translate(&self, _text: &str, _source: &str, _target: &str) -> Result<String, LocalError> {
        Err(LocalError::Failed)
    }
}

/// Makes the local translation for a run (`Services::local_translation`).
pub type LocalTranslationSource = Arc<dyn Fn(&crate::config::Environment) -> Arc<dyn LocalTranslation> + Send + Sync>;

/// The default: ONNX Runtime with the `onnx-translation` feature, else none.
pub fn default_local_translation(env: &crate::config::Environment) -> Arc<dyn LocalTranslation> {
    #[cfg(feature = "onnx-translation")]
    {
        Arc::new(super::translation_onnx::OnnxTranslation::new(env))
    }
    #[cfg(not(feature = "onnx-translation"))]
    {
        let _ = env;
        Arc::new(NoLocalTranslation)
    }
}

/// Whether a weight's local model is on this PC (`Services::translation_weight_available`).
pub fn default_weight_available(env: &crate::config::Environment, weight: &str) -> bool {
    #[cfg(feature = "onnx-translation")]
    {
        super::translation_onnx::weight_available(env, weight)
    }
    #[cfg(not(feature = "onnx-translation"))]
    {
        let _ = (env, weight);
        false
    }
}

/// The weights the settings may name (`SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST`): the built-in
/// ones, then the models the user added (`custom:<folder>`).
pub fn weight_ids(env: &crate::config::Environment) -> Vec<String> {
    #[cfg(feature = "onnx-translation")]
    {
        super::translation_onnx::weight_ids(env)
    }
    #[cfg(not(feature = "onnx-translation"))]
    {
        let _ = env;
        crate::languages::TRANSLATION_WEIGHTS.iter().map(|w| w.to_string()).collect()
    }
}

/// The translation compute devices for [`crate::config::Environment::compute_devices`]: the
/// CPU, and the GPU execution providers of the ONNX Runtime library beside the app. The host
/// calls this once at start.
pub fn compute_devices() -> Vec<Value> {
    #[cfg(feature = "onnx-translation")]
    {
        super::translation_onnx::compute_devices()
    }
    #[cfg(not(feature = "onnx-translation"))]
    {
        vec![crate::config::Environment::cpu_device()]
    }
}

/// The user's model folders that were refused, with the fixed reason, for the log.
pub fn refused_models(env: &crate::config::Environment) -> Vec<(String, &'static str)> {
    #[cfg(feature = "onnx-translation")]
    {
        super::translation_onnx::discover(&env.data_dir).1
    }
    #[cfg(not(feature = "onnx-translation"))]
    {
        let _ = env;
        Vec::new()
    }
}

// ------------------------------------------------------------------------- the providers

/// A provider with a key and a model list (`TRANSLATION_PROVIDER_REGISTRY`).
struct KeySpec {
    provider: Provider,
    name: &'static str,
    wait: bool,
    /// `auth_validate`: a prefix and a minimum length in characters.
    prefix: &'static str,
    min_length: usize,
    invalid: &'static str,
    failed: &'static str,
    model_invalid: &'static str,
    list: &'static str,
    selected: &'static str,
}

const KEY_PROVIDERS: [KeySpec; 5] = [
    KeySpec {
        provider: Provider::Plamo,
        name: "plamo",
        wait: WAIT,
        prefix: "",
        min_length: 72,
        invalid: "AUTH_PLAMO_LENGTH",
        failed: "AUTH_PLAMO_FAILED",
        model_invalid: "MODEL_PLAMO_INVALID",
        list: "SELECTABLE_PLAMO_MODEL_LIST",
        selected: "SELECTED_PLAMO_MODEL",
    },
    KeySpec {
        provider: Provider::Gemini,
        name: "gemini",
        wait: OPEN,
        prefix: "",
        min_length: 39,
        invalid: "AUTH_GEMINI_LENGTH",
        failed: "AUTH_GEMINI_FAILED",
        model_invalid: "MODEL_GEMINI_INVALID",
        list: "SELECTABLE_GEMINI_MODEL_LIST",
        selected: "SELECTED_GEMINI_MODEL",
    },
    KeySpec {
        provider: Provider::OpenAi,
        name: "openai",
        wait: OPEN,
        prefix: "sk-",
        min_length: 164,
        invalid: "AUTH_OPENAI_INVALID",
        failed: "AUTH_OPENAI_FAILED",
        model_invalid: "MODEL_OPENAI_INVALID",
        list: "SELECTABLE_OPENAI_MODEL_LIST",
        selected: "SELECTED_OPENAI_MODEL",
    },
    KeySpec {
        provider: Provider::Groq,
        name: "groq",
        wait: OPEN,
        prefix: "gsk",
        min_length: 40,
        invalid: "AUTH_GROQ_INVALID",
        failed: "AUTH_GROQ_FAILED",
        model_invalid: "MODEL_GROQ_INVALID",
        list: "SELECTABLE_GROQ_MODEL_LIST",
        selected: "SELECTED_GROQ_MODEL",
    },
    KeySpec {
        provider: Provider::OpenRouter,
        name: "openrouter",
        wait: OPEN,
        prefix: "",
        min_length: 20,
        invalid: "AUTH_OPENROUTER_INVALID",
        failed: "AUTH_OPENROUTER_FAILED",
        model_invalid: "MODEL_OPENROUTER_INVALID",
        list: "SELECTABLE_OPENROUTER_MODEL_LIST",
        selected: "SELECTED_OPENROUTER_MODEL",
    },
];

/// The model list, the selection and the model error of a provider (`_resolveEngineSpec`).
fn model_keys(provider: Provider) -> Option<(&'static str, &'static str, &'static str)> {
    if let Some(spec) = KEY_PROVIDERS.iter().find(|s| s.provider == provider) {
        return Some((spec.list, spec.selected, spec.model_invalid));
    }
    match provider {
        Provider::OpenAiCompatible => Some((
            "SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST",
            "SELECTED_OPENAI_COMPATIBLE_MODEL",
            "MODEL_OPENAI_COMPATIBLE_INVALID",
        )),
        Provider::LmStudio => {
            Some(("SELECTABLE_LMSTUDIO_MODEL_LIST", "SELECTED_LMSTUDIO_MODEL", "MODEL_LMSTUDIO_INVALID"))
        }
        Provider::Ollama => Some(("SELECTABLE_OLLAMA_MODEL_LIST", "SELECTED_OLLAMA_MODEL", "MODEL_OLLAMA_INVALID")),
        _ => None,
    }
}

/// The setting that holds the address of a provider the user runs or chooses.
fn url_key(provider: Provider) -> Option<&'static str> {
    match provider {
        Provider::LmStudio => Some("LMSTUDIO_URL"),
        Provider::Ollama => Some("OLLAMA_URL"),
        Provider::OpenAiCompatible => Some("OPENAI_COMPATIBLE_URL"),
        _ => None,
    }
}

/// The fixed address of a cloud provider (DeepL: by its key); empty for those the user places.
fn fixed_url(endpoints: &Endpoints, provider: Provider, key: &str) -> String {
    match provider {
        Provider::DeepL => deepl::base_url(&endpoints.deepl, &endpoints.deepl_free, key).to_string(),
        Provider::GoogleCloud => endpoints.google_cloud.clone(),
        Provider::Papago => endpoints.papago.clone(),
        Provider::Plamo => endpoints.plamo.clone(),
        Provider::Gemini => endpoints.gemini.clone(),
        Provider::OpenAi => endpoints.openai.clone(),
        Provider::Groq => endpoints.groq.clone(),
        Provider::OpenRouter => endpoints.openrouter.clone(),
        Provider::OpenAiCompatible | Provider::LmStudio | Provider::Ollama => String::new(),
    }
}

/// How long a listed model list is used again instead of asking (`_RECENT_SEC`).
const RECENT: Duration = Duration::from_secs(30);
/// The history kept for the chat providers (`translation_history_max_items`).
const HISTORY_ITEMS: usize = 20;

/// A provider ready to translate with: its address, its credentials and the chosen model
/// (Python's client object). The key and the Client ID are never printed.
#[derive(Clone)]
pub(crate) struct Session {
    base: String,
    key: Option<String>,
    /// Papago's Client ID.
    client_id: Option<String>,
    model: Option<String>,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("key", &self.key.as_ref().map(|_| "<hidden>"))
            .field("client_id", &self.client_id.as_ref().map(|_| "<hidden>"))
            .field("model", &self.model)
            .finish()
    }
}

/// A provider that answered: the session and the models it listed (empty for the machine
/// translation APIs).
struct Connected {
    session: Session,
    models: Vec<String>,
}

/// One message of the conversation, kept for the context of the chat providers.
#[derive(Clone)]
struct Said {
    source: String,
    text: String,
    time: String,
}

#[derive(Default)]
struct History {
    generation: u64,
    items: Vec<Said>,
}

/// What the translation keeps between requests.
pub(crate) struct Translators {
    transport: Transport,
    endpoints: Endpoints,
    clients: Mutex<HashMap<Provider, Session>>,
    recent: Mutex<HashMap<Provider, (Instant, Vec<String>)>>,
    lmstudio_connected: AtomicBool,
    ollama_connected: AtomicBool,
    local: Arc<dyn LocalTranslation>,
    /// Loading and translating with the local model, one at a time (`_ctranslate2_lock`).
    local_lock: Mutex<()>,
    history: Mutex<History>,
}

impl Translators {
    pub(crate) fn new(services: &super::Services, env: &crate::config::Environment) -> Translators {
        Translators {
            transport: services.translation_transport.clone(),
            endpoints: services.translation_endpoints.clone(),
            clients: Mutex::new(HashMap::new()),
            recent: Mutex::new(HashMap::new()),
            lmstudio_connected: AtomicBool::new(false),
            ollama_connected: AtomicBool::new(false),
            local: (services.local_translation)(env),
            local_lock: Mutex::new(()),
            history: Mutex::new(History::default()),
        }
    }

    // ------------------------------------------------------------ one branch per provider

    /// Checks the key (or that the server answers) and lists the models: `setAuthKey` and the
    /// first `getModelList` of each Python client. The machine translation APIs list nothing.
    fn check(&self, provider: Provider, base: &str, key: &str, client_id: &str) -> Result<Vec<String>, providers::Error> {
        let t = &self.transport;
        match provider {
            Provider::DeepL => deepl::check(t, base, key).map(|()| Vec::new()),
            Provider::GoogleCloud => google_cloud::check(t, base, key).map(|()| Vec::new()),
            Provider::Papago => papago::check(t, base, client_id, key).map(|()| Vec::new()),
            Provider::Plamo => plamo::models(t, base, key),
            Provider::Gemini => gemini::models(t, base, key),
            Provider::OpenAi => openai::models(t, base, key),
            Provider::Groq => groq::models(t, base, key),
            Provider::OpenRouter => {
                openrouter::check(t, base, key)?;
                openrouter::models(t, base, key)
            }
            Provider::OpenAiCompatible => openai_compatible::models(t, base, key),
            Provider::LmStudio => {
                lmstudio::check(t, base)?;
                Ok(lmstudio::models(t, base))
            }
            Provider::Ollama => {
                ollama::check(t, base)?;
                Ok(ollama::models(t, base))
            }
        }
    }

    /// Whether LM Studio or Ollama answers at an address.
    fn server_answers(&self, provider: Provider, base: &str) -> bool {
        match provider {
            Provider::LmStudio => lmstudio::check(&self.transport, base).is_ok(),
            Provider::Ollama => ollama::check(&self.transport, base).is_ok(),
            _ => false,
        }
    }

    /// The models of a live session, asked again (`getModelList`); none when they cannot be read.
    fn models(&self, provider: Provider, session: &Session) -> Vec<String> {
        let (t, base, key) = (&self.transport, session.base.as_str(), session.key.as_deref().unwrap_or(""));
        match provider {
            Provider::DeepL | Provider::GoogleCloud | Provider::Papago => Vec::new(),
            Provider::Plamo => plamo::models(t, base, key).unwrap_or_default(),
            Provider::Gemini => gemini::models(t, base, key).unwrap_or_default(),
            Provider::OpenAi => openai::models(t, base, key).unwrap_or_default(),
            Provider::Groq => groq::models(t, base, key).unwrap_or_default(),
            Provider::OpenRouter => openrouter::models(t, base, key).unwrap_or_default(),
            Provider::OpenAiCompatible => openai_compatible::models(t, base, key).unwrap_or_default(),
            Provider::LmStudio => lmstudio::models(t, base),
            Provider::Ollama => ollama::models(t, base),
        }
    }

    /// Translates one text (`Translator.translate`, one branch per engine). Codes as the
    /// engine's language table gives them.
    fn translate(
        &self,
        provider: Provider,
        session: &Session,
        chat: &providers::Translation<'_>,
    ) -> Result<String, providers::Error> {
        let (t, base, key) = (&self.transport, session.base.as_str(), session.key.as_deref().unwrap_or(""));
        let model = || session.model.as_deref().ok_or(providers::Error::UnknownModel);
        let (text, source, target) = (chat.text, chat.source, chat.target);
        match provider {
            Provider::DeepL => deepl::translate(t, base, key, text, source, target),
            Provider::GoogleCloud => google_cloud::translate(t, base, key, text, source, target),
            Provider::Papago => {
                papago::translate(t, base, session.client_id.as_deref().unwrap_or(""), key, text, source, target)
            }
            Provider::Plamo => plamo::translate(t, base, key, model()?, chat),
            Provider::Gemini => gemini::translate(t, base, key, model()?, chat),
            Provider::OpenAi => openai::translate(t, base, key, model()?, chat),
            Provider::Groq => groq::translate(t, base, key, model()?, chat),
            Provider::OpenRouter => openrouter::translate(t, base, key, model()?, chat),
            Provider::OpenAiCompatible => openai_compatible::translate(t, base, key, model()?, chat),
            Provider::LmStudio => lmstudio::translate(t, base, model()?, chat),
            Provider::Ollama => ollama::translate(t, base, model()?, chat),
        }
    }

    /// A provider checked and ready (`Translator.prepareCredential`): the saved model when the
    /// provider lists it, else the first one.
    fn connect(
        &self,
        provider: Provider,
        base: &str,
        key: Option<&str>,
        client_id: Option<&str>,
        selected: Option<&str>,
    ) -> Result<Connected, providers::Error> {
        let models = self.check(provider, base, key.unwrap_or(""), client_id.unwrap_or(""))?;
        let model = if provider.without_models() { None } else { Some(providers::choose_model(&models, selected)?) };
        let session = Session {
            base: base.to_string(),
            key: key.map(str::to_string),
            client_id: client_id.map(str::to_string),
            model,
        };
        Ok(Connected { session, models })
    }

    // ------------------------------------------------------------ what is kept

    /// The local translation's language table of a weight: the built-in one, else that of a
    /// model the user added.
    pub(crate) fn local_table(&self, weight: &str) -> Option<Value> {
        crate::languages::translation()
            .get(LOCAL_ENGINE)
            .and_then(|engine| engine.get(weight))
            .cloned()
            .or_else(|| self.local.languages(weight))
    }

    fn session(&self, provider: Provider) -> Option<Session> {
        self.clients.lock().unwrap().get(&provider).cloned()
    }

    fn commit(&self, provider: Provider, connected: &Connected) {
        self.clients.lock().unwrap().insert(provider, connected.session.clone());
        if !connected.models.is_empty() {
            self.recent.lock().unwrap().insert(provider, (Instant::now(), connected.models.clone()));
        }
    }

    fn forget(&self, provider: Provider) {
        self.clients.lock().unwrap().remove(&provider);
        self.recent.lock().unwrap().remove(&provider);
    }

    fn connected(&self, provider: Provider) -> &AtomicBool {
        if provider == Provider::LmStudio { &self.lmstudio_connected } else { &self.ollama_connected }
    }

    /// The models of a live session: the recent list, else asked again (`RecentModelList.setModel`).
    fn models_of(&self, provider: Provider, session: &Session) -> Vec<String> {
        if let Some((_, models)) = self.recent.lock().unwrap().get(&provider).filter(|(at, _)| at.elapsed() <= RECENT) {
            return models.clone();
        }
        let models = self.models(provider, session);
        if !models.is_empty() {
            self.recent.lock().unwrap().insert(provider, (Instant::now(), models.clone()));
        }
        models
    }
}

impl Core {
    /// Sets an engine's entry of `SELECTABLE_TRANSLATION_ENGINE_STATUS`.
    pub(crate) fn set_engine_status(&self, engine: &str, available: bool) {
        let mut status = self.config().get("SELECTABLE_TRANSLATION_ENGINE_STATUS");
        if let Some(map) = status.as_object_mut() {
            map.insert(engine.to_string(), json!(available));
        }
        self.config().put("SELECTABLE_TRANSLATION_ENGINE_STATUS", status);
    }

    fn engine_status(&self, engine: &str) -> bool {
        self.config().get("SELECTABLE_TRANSLATION_ENGINE_STATUS")[engine] == true
    }

    /// Stores a model list and its selection, and tells the UI.
    fn publish_models(&self, list: &str, selected: &str, models: &[String], choice: Option<&str>) {
        self.config().put(list, json!(models));
        self.config().put(selected, choice.map_or(Value::Null, |c| json!(c)));
        self.notify(&list.to_lowercase(), self.config().get(list));
        self.notify(&selected.to_lowercase(), self.config().get(selected));
    }

    fn connect(
        &self,
        provider: Provider,
        base: &str,
        key: Option<&str>,
        selected: Option<&str>,
    ) -> Result<Connected, providers::Error> {
        self.translation.connect(provider, base, key, None, selected)
    }

    // ------------------------------------------------------------ keys and models

    /// `setDeeplAuthKey`.
    fn set_deepl_key(&self, data: &Value) -> Reply {
        let engine = "DeepL_API";
        let key = python_str(data);
        let current = || self.config().get("AUTH_KEYS")[engine].clone();
        if ![36, 39].contains(&key.chars().count()) {
            return error("AUTH_DEEPL_LENGTH", current());
        }
        let base = fixed_url(&self.translation.endpoints, Provider::DeepL, &key);
        let Ok(connected) = self.connect(Provider::DeepL, &base, Some(&key), None) else {
            self.step("DeepL: the key was not accepted");
            return error("AUTH_DEEPL_FAILED", current());
        };
        let _guard = self.credential_lock.lock().unwrap();
        if self.config().update_credential("AUTH_KEYS", engine, Some(&key)).is_err() {
            return Reply::status(500, "Internal error");
        }
        self.translation.commit(Provider::DeepL, &connected);
        self.set_engine_status(engine, true);
        self.update_translation_engine_and_list();
        ok(json!(key))
    }

    /// Google Cloud Translation (core only): checked like DeepL's key, saved when accepted. A key
    /// is any text without spaces; its format is Google's to change.
    fn set_google_cloud_key(&self, data: &Value) -> Reply {
        let engine = Provider::GoogleCloud.engine();
        let key = python_str(data).trim().to_string();
        let current = || self.config().get("AUTH_KEYS")[engine].clone();
        if key.is_empty() || key.chars().any(char::is_whitespace) {
            return error("AUTH_GOOGLE_CLOUD_INVALID", current());
        }
        let base = fixed_url(&self.translation.endpoints, Provider::GoogleCloud, &key);
        let Ok(connected) = self.connect(Provider::GoogleCloud, &base, Some(&key), None) else {
            self.step("Google Cloud Translation: the key was not accepted");
            return error("AUTH_GOOGLE_CLOUD_FAILED", current());
        };
        let _guard = self.credential_lock.lock().unwrap();
        if self.config().update_credential("AUTH_KEYS", engine, Some(&key)).is_err() {
            return Reply::status(500, "Internal error");
        }
        self.translation.commit(Provider::GoogleCloud, &connected);
        self.set_engine_status(engine, true);
        self.update_translation_engine_and_list();
        ok(json!(key))
    }

    /// Papago's Client ID (core only). Like the URL of the OpenAI-compatible endpoint, it
    /// changes only while no secret is saved: the secret is checked with the ID.
    fn set_papago_client_id(&self, data: &Value) -> Reply {
        let current = || self.config().get("PAPAGO_CLIENT_ID");
        let id = match data {
            Value::String(text) => text.trim().to_string(),
            _ => return error("AUTH_PAPAGO_INVALID", current()),
        };
        if id.is_empty() || id.chars().any(char::is_whitespace) {
            return error("AUTH_PAPAGO_INVALID", current());
        }
        let _guard = self.credential_lock.lock().unwrap();
        if current() == json!(id) {
            return ok(current());
        }
        let secret = &self.config().get("AUTH_KEYS")[Provider::Papago.engine()];
        if secret.as_str().is_some_and(|s| !s.is_empty()) {
            return error("CREDENTIAL_REENTRY_REQUIRED", current());
        }
        if self.config().set("PAPAGO_CLIENT_ID", json!(id)).is_err() {
            return error("AUTH_PAPAGO_INVALID", current());
        }
        ok(current())
    }

    /// Papago's Client Secret (core only), checked with the saved Client ID.
    fn set_papago_key(&self, data: &Value) -> Reply {
        let engine = Provider::Papago.engine();
        let secret = python_str(data).trim().to_string();
        let current = || self.config().get("AUTH_KEYS")[engine].clone();
        let client_id = self.config().get_str("PAPAGO_CLIENT_ID");
        if secret.is_empty() || secret.chars().any(char::is_whitespace) || client_id.is_empty() {
            return error("AUTH_PAPAGO_INVALID", current());
        }
        let base = fixed_url(&self.translation.endpoints, Provider::Papago, &secret);
        let Ok(connected) = self.translation.connect(Provider::Papago, &base, Some(&secret), Some(&client_id), None) else {
            self.step("Papago: the Client ID and secret were not accepted");
            return error("AUTH_PAPAGO_FAILED", current());
        };
        let _guard = self.credential_lock.lock().unwrap();
        if self.config().get_str("PAPAGO_CLIENT_ID") != client_id {
            return error("AUTH_PAPAGO_FAILED", current());
        }
        if self.config().update_credential("AUTH_KEYS", engine, Some(&secret)).is_err() {
            return Reply::status(500, "Internal error");
        }
        self.translation.commit(Provider::Papago, &connected);
        self.set_engine_status(engine, true);
        self.update_translation_engine_and_list();
        ok(json!(secret))
    }

    /// `_setTranslationEngineAuthKey`.
    fn set_registry_key(&self, spec: &KeySpec, data: &Value) -> Reply {
        let engine = spec.provider.engine();
        let key = python_str(data);
        let current = || self.config().get("AUTH_KEYS")[engine].clone();
        if !key.starts_with(spec.prefix) || key.chars().count() < spec.min_length {
            return error(spec.invalid, current());
        }
        let previous = self.config().get(spec.selected);
        let base = fixed_url(&self.translation.endpoints, spec.provider, &key);
        let connected = match self.connect(spec.provider, &base, Some(&key), previous.as_str()) {
            Ok(connected) => connected,
            Err(_) => {
                self.step("Translation provider: the key was not accepted");
                return error(spec.failed, current());
            }
        };
        let _guard = self.credential_lock.lock().unwrap();
        if self.config().get(spec.selected) != previous {
            return error(spec.failed, current());
        }
        if self.config().update_credential("AUTH_KEYS", engine, Some(&key)).is_err() {
            return Reply::status(500, "Internal error");
        }
        self.translation.commit(spec.provider, &connected);
        self.set_engine_status(engine, true);
        self.publish_models(spec.list, spec.selected, &connected.models, connected.session.model.as_deref());
        self.update_translation_engine_and_list();
        ok(json!(key))
    }

    /// `_setTranslationEngineModel` (and `setOpenAICompatibleModel`).
    fn set_model(&self, provider: Provider, data: &Value) -> Reply {
        let (_, selected, invalid) = model_keys(provider).expect("a provider with models");
        let model = python_str(data);
        let Some(mut session) = self.translation.session(provider) else {
            return error(invalid, self.config().get(selected));
        };
        if !self.translation.models_of(provider, &session).contains(&model) {
            return error(invalid, self.config().get(selected));
        }
        session.model = Some(model.clone());
        self.config().put(selected, json!(model));
        self.translation.clients.lock().unwrap().insert(provider, session);
        ok(self.config().get(selected))
    }

    /// `setOpenAICompatibleAuthKey`.
    fn set_compatible_key(&self, data: &Value) -> Reply {
        let engine = "OpenAI_Compatible";
        let key = python_str(data).trim().to_string();
        let current = || self.config().get("AUTH_KEYS")[engine].clone();
        if key.is_empty() {
            return error("AUTH_OPENAI_COMPATIBLE_INVALID", current());
        }
        let url = self.config().get_str("OPENAI_COMPATIBLE_URL");
        let previous = self.config().get("SELECTED_OPENAI_COMPATIBLE_MODEL");
        let Ok(connected) = self.connect(Provider::OpenAiCompatible, &url, Some(&key), previous.as_str()) else {
            self.step("OpenAI-compatible endpoint: the key was not accepted");
            return error("AUTH_OPENAI_COMPATIBLE_FAILED", current());
        };
        let _guard = self.credential_lock.lock().unwrap();
        if self.config().get_str("OPENAI_COMPATIBLE_URL") != url
            || self.config().get("SELECTED_OPENAI_COMPATIBLE_MODEL") != previous
        {
            return error("AUTH_OPENAI_COMPATIBLE_FAILED", current());
        }
        if self.config().update_credential("AUTH_KEYS", engine, Some(&key)).is_err() {
            return Reply::status(500, "Internal error");
        }
        self.commit_compatible(&connected);
        ok(json!(key))
    }

    /// `_commitOpenAICompatibleCandidate`, under the credential lock.
    fn commit_compatible(&self, connected: &Connected) {
        self.translation.commit(Provider::OpenAiCompatible, connected);
        self.set_engine_status("OpenAI_Compatible", true);
        self.publish_models(
            "SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST",
            "SELECTED_OPENAI_COMPATIBLE_MODEL",
            &connected.models,
            connected.session.model.as_deref(),
        );
        self.update_translation_engine_and_list();
    }

    /// `_setEndpointCredential` for the OpenAI-compatible endpoint: the URL and the key are
    /// checked together before either is saved.
    fn set_compatible_key_and_url(&self, data: &Value) -> Reply {
        let engine = "OpenAI_Compatible";
        let current_key = || self.config().get("AUTH_KEYS")[engine].clone();
        let failed = || error("AUTH_OPENAI_COMPATIBLE_FAILED", current_key());
        let Some(object) =
            data.as_object().filter(|o| o.len() == 2 && o.contains_key("url") && o.contains_key("auth_key"))
        else {
            return failed();
        };
        let url = match &object["url"] {
            Value::String(text) => text.trim().to_string(),
            _ => return error("CONNECTION_OPENAI_COMPATIBLE_URL_INVALID", self.config().get("OPENAI_COMPATIBLE_URL")),
        };
        if validate_api_url(&url, false).is_err() {
            return error("CONNECTION_OPENAI_COMPATIBLE_URL_INVALID", self.config().get("OPENAI_COMPATIBLE_URL"));
        }
        let key = match &object["auth_key"] {
            Value::Null => None,
            Value::String(text) => Some(text.trim().to_string()).filter(|k| !k.is_empty()),
            _ => return failed(),
        };
        let snapshot = || {
            (
                self.config().get("OPENAI_COMPATIBLE_URL"),
                self.config().get("AUTH_KEYS")[engine].clone(),
                self.config().get("SELECTED_OPENAI_COMPATIBLE_MODEL"),
            )
        };
        let previous = {
            let _guard = self.credential_lock.lock().unwrap();
            snapshot()
        };
        let connected = match &key {
            Some(key) => match self.connect(Provider::OpenAiCompatible, &url, Some(key), previous.2.as_str()) {
                Ok(connected) => Some(connected),
                Err(_) => {
                    self.step("OpenAI-compatible endpoint: the key was not accepted");
                    return failed();
                }
            },
            None => None,
        };
        {
            let _guard = self.credential_lock.lock().unwrap();
            if snapshot() != previous {
                return failed();
            }
            if self.config().set("OPENAI_COMPATIBLE_URL", json!(url)).is_err() {
                return Reply::status(500, "Internal error");
            }
            if let (Some(key), Some(connected)) = (&key, &connected) {
                if self.config().update_credential("AUTH_KEYS", engine, Some(key)).is_err() {
                    return Reply::status(500, "Internal error");
                }
                self.commit_compatible(connected);
            }
        }
        if key.is_none() {
            // `delOpenAICompatibleAuthKey`, which takes the credential lock itself.
            self.translation.forget(Provider::OpenAiCompatible);
            self.delete_translation_key(
                engine,
                Some(("SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST", "SELECTED_OPENAI_COMPATIBLE_MODEL")),
            );
        }
        ok(json!({ "url": url, "auth_key": key }))
    }

    // ------------------------------------------------------------ LM Studio and Ollama

    /// `setLMStudioClientURL` / `checkOllamaClient`: a session for the server, kept only when it
    /// answers.
    fn connect_local_server(&self, provider: Provider, base: &str) -> bool {
        let answered = self.translation.server_answers(provider, base);
        if answered {
            let session = Session { base: base.to_string(), key: None, client_id: None, model: None };
            self.translation.clients.lock().unwrap().insert(provider, session);
        } else {
            self.translation.forget(provider);
        }
        self.translation.connected(provider).store(answered, Ordering::SeqCst);
        answered
    }

    fn local_server_models(&self, provider: Provider) -> Vec<String> {
        match self.translation.session(provider) {
            Some(session) => {
                let models = self.translation.models(provider, &session);
                if !models.is_empty() {
                    self.translation.recent.lock().unwrap().insert(provider, (Instant::now(), models.clone()));
                }
                models
            }
            None => Vec::new(),
        }
    }

    /// Forgets a local server's models and selection after a failed connection, and tells the UI.
    fn local_server_failed(&self, provider: Provider) {
        let (list, selected, _) = model_keys(provider).expect("a provider with models");
        self.set_engine_status(provider.engine(), false);
        self.publish_models(list, selected, &[], None);
        self.update_translation_engine_and_list();
    }

    /// Chooses the saved model when the server lists it, else the first, for the live session.
    fn choose_server_model(&self, provider: Provider, models: &[String]) -> String {
        let (_, selected, _) = model_keys(provider).expect("a provider with models");
        let saved = self.config().get_str(selected);
        let choice = if models.contains(&saved) { saved } else { models[0].clone() };
        if let Some(mut session) = self.translation.session(provider) {
            session.model = Some(choice.clone());
            self.translation.clients.lock().unwrap().insert(provider, session);
        }
        choice
    }

    /// After a server answered: its models, a selection, the engine list. `false` when it has
    /// no model.
    fn local_server_connected(&self, provider: Provider) -> bool {
        let (list, selected, _) = model_keys(provider).expect("a provider with models");
        self.set_engine_status(provider.engine(), true);
        let models = self.local_server_models(provider);
        self.config().put(list, json!(models));
        self.notify(&list.to_lowercase(), self.config().get(list));
        if models.is_empty() {
            return false;
        }
        let choice = self.choose_server_model(provider, &models);
        self.config().put(selected, json!(choice));
        self.notify(&selected.to_lowercase(), self.config().get(selected));
        self.update_translation_engine_and_list();
        true
    }

    /// `_checkTranslationEngineConnection`, at the saved address.
    fn check_local_server(&self, provider: Provider) -> Reply {
        let code =
            if provider == Provider::LmStudio { "CONNECTION_LMSTUDIO_FAILED" } else { "CONNECTION_OLLAMA_FAILED" };
        let base = self.config().get_str(url_key(provider).expect("a server the user runs"));
        if self.connect_local_server(provider, &base) && self.local_server_connected(provider) {
            return ok(json!(true));
        }
        self.local_server_failed(provider);
        error(code, json!(false))
    }

    /// `setTranslatorLMStudioURL`, and the same for Ollama (core only): the address is saved only
    /// when a server answers there with a model. Plain HTTP only to this PC and the LAN.
    fn set_server_url(&self, provider: Provider, data: &Value) -> Reply {
        let key = url_key(provider).expect("a server the user runs");
        let code =
            if provider == Provider::LmStudio { "CONNECTION_LMSTUDIO_URL_INVALID" } else { "CONNECTION_OLLAMA_URL_INVALID" };
        let invalid = |core: &Core| error(code, core.config().get(key));
        let url = match data {
            Value::String(text) => text.trim().to_string(),
            _ => return invalid(self),
        };
        if validate_api_url(&url, false).is_err() {
            return invalid(self);
        }
        if !self.connect_local_server(provider, &url) {
            self.local_server_failed(provider);
            return invalid(self);
        }
        if self.config().set(key, json!(url)).is_err() || !self.local_server_connected(provider) {
            self.local_server_failed(provider);
            return invalid(self);
        }
        ok(self.config().get(key))
    }

    // ------------------------------------------------------------ the local translation

    /// The local model's settings as saved now.
    fn local_setup(&self) -> LocalSetup {
        let config = self.config();
        LocalSetup {
            weight: config.get_str("CTRANSLATE2_WEIGHT_TYPE"),
            device: config.get("SELECTED_TRANSLATION_COMPUTE_DEVICE"),
            compute_type: config.get_str("SELECTED_TRANSLATION_COMPUTE_TYPE"),
        }
    }

    fn load_local(&self) -> Result<(), LocalError> {
        let _guard = self.translation.local_lock.lock().unwrap();
        self.translation.local.load(&self.local_setup())
    }

    /// Writes where the local model runs to the log and, when the chosen device could not be
    /// used and the model runs on the CPU instead, tells the UI (never silent).
    fn report_local_placement(&self) {
        let Some(placement) = self.translation.local.placement() else { return };
        self.step(&format!("Translation: the local model runs on {} ({})", placement.device, placement.variant));
        if let Some((requested, reason)) = placement.fallback {
            self.step(&format!("Translation: {requested} could not be used ({reason}); running on the CPU"));
            // A notice, not an error: translation is on and works, on the CPU.
            self.notify(
                "translation_compute_device_fallback",
                json!({ "requested": requested, "used": placement.device, "variant": placement.variant, "reason": reason }),
            );
        }
    }

    /// `setCtranslate2WeightType`: a weight under a non-commercial licence needs the user's
    /// confirmation, unless it is already the selected one.
    fn set_weight_type(&self, data: &Value) -> Reply {
        let (weight, accepted) = match data {
            Value::Object(object) => (
                object.get("weight_type").map_or_else(|| "None".to_string(), python_str),
                object.get("accept_non_commercial_license") == Some(&json!(true)),
            ),
            other => (python_str(other), false),
        };
        let config = self.config();
        let selected = config.get_str("CTRANSLATE2_WEIGHT_TYPE");
        if !accepted && super::lifecycle::non_commercial(&weight) && weight != selected {
            return error(
                "WEIGHT_CTRANSLATE2_LICENSE_CONSENT_REQUIRED",
                json!({ "weight_type": weight, "selected": selected }),
            );
        }
        // Python let a refused weight raise: 500.
        if config.set("CTRANSLATE2_WEIGHT_TYPE", json!(weight)).is_err() {
            return Reply::status(500, "Internal error");
        }
        if accepted && super::lifecycle::non_commercial(&weight) {
            let _ = config.set("CTRANSLATE2_LICENSE_NOTICE_SHOWN", json!(true));
        }
        self.update_translation_engine_and_list();
        ok(config.get("CTRANSLATE2_WEIGHT_TYPE"))
    }

    /// `setEnableTranslation`.
    fn enable_translation(&self) -> Reply {
        let config = self.config();
        if config.get_bool("ENABLE_TRANSLATION") {
            return ok(json!(true));
        }
        let engine = config.get("SELECTED_TRANSLATION_ENGINES")[config.get_str("SELECTED_TAB_NO")]
            .as_str()
            .unwrap_or("")
            .to_string();
        if engine != LOCAL_ENGINE && self.engine_status(&engine) && !self.engine_status(LOCAL_ENGINE) {
            // A connected provider does not need the local model.
            let _ = config.set("ENABLE_TRANSLATION", json!(true));
            return ok(json!(true));
        }
        if self.translation.local.loaded().as_ref() == Some(&self.local_setup()) {
            let _ = config.set("ENABLE_TRANSLATION", json!(true));
            return ok(config.get("ENABLE_TRANSLATION"));
        }
        match self.load_local() {
            Ok(()) => {
                let _ = config.set("ENABLE_TRANSLATION", json!(true));
                self.report_local_placement();
            }
            Err(LocalError::OutOfMemory(message)) => {
                self.step("Translation: the GPU ran out of memory while loading the model");
                self.notify_error(
                    super::run_endpoint("error_translation_enable_vram_overflow"),
                    ErrorReply::new("TRANSLATION_VRAM_ENABLE", json!(message)),
                );
                let _ = config.set("ENABLE_TRANSLATION", json!(false));
                self.notify_error(
                    super::run_endpoint("enable_translation"),
                    ErrorReply::new("TRANSLATION_DISABLED_VRAM", json!(false)),
                );
                let _ = self.load_local();
            }
            Err(LocalError::Missing) => return error("TRANSLATION_MODEL_MISSING", json!(false)),
            Err(_) => {
                self.step("Translation: the local model could not be loaded");
                return error("TRANSLATION_MODEL_LOAD_FAILED", json!(false));
            }
        }
        ok(config.get("ENABLE_TRANSLATION"))
    }

    /// `changeToCTranslate2Process`: after a provider failed, the tab's engine becomes the local
    /// one and the provider counts as unavailable, unless the selection changed meanwhile.
    pub(crate) fn fall_back_to_local(&self, snapshot: &super::messages::Snapshot) {
        let _guard = self.language_lock.lock().unwrap();
        let config = self.config();
        let tab = config.get_str("SELECTED_TAB_NO");
        let engines = config.get("SELECTED_TRANSLATION_ENGINES");
        if tab != snapshot.tab
            || engines[&tab] != json!(snapshot.engine)
            || config.get("SELECTED_YOUR_LANGUAGES")[&tab] != snapshot.your
            || config.get("SELECTED_TARGET_LANGUAGES")[&tab] != snapshot.target
        {
            return;
        }
        let engine = engines[&tab].as_str().unwrap_or("").to_string();
        self.set_engine_status(&engine, false);
        let mut engines = engines;
        engines[&tab] = json!(LOCAL_ENGINE);
        let _ = config.set("SELECTED_TRANSLATION_ENGINES", engines);
        self.fallback_unsupported_languages(&tab, LOCAL_ENGINE);
        let selectable = self.selectable_translation_engines();
        self.notify("selected_translation_engines", config.get("SELECTED_TRANSLATION_ENGINES"));
        self.notify("translation_engines", json!(selectable));
    }

    // ------------------------------------------------------------ translating

    /// `getLanguageCode`: the engine's codes for the source and the target, or `None` when
    /// it lacks either.
    fn language_codes(
        &self,
        engine: &str,
        weight: &str,
        country: &str,
        source: &str,
        target: &str,
    ) -> Option<(String, String)> {
        let entry = if engine == LOCAL_ENGINE {
            self.translation.local_table(weight)?
        } else {
            crate::languages::translation().get(engine)?.clone()
        };
        let mut target = target.to_string();
        if engine == "DeepL_API" {
            if target == "English" {
                let american = ["United States", "Canada", "Philippines"].contains(&country);
                target = if american { "English American" } else { "English British" }.into();
            } else if target == "Portuguese" {
                target = if country == "Portugal" { "Portuguese European" } else { "Portuguese Brazilian" }.into();
            }
        }
        let source = entry["source"].get(source)?.as_str()?.to_string();
        let target = entry["target"].get(&target)?.as_str()?.to_string();
        Some((source, target))
    }

    /// The source languages of an engine, for the prompt (`supported_languages`).
    fn supported_languages(engine: &str) -> Vec<String> {
        crate::languages::translation()
            .get(engine)
            .and_then(|e| e["source"].as_object())
            .map(|o| o.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// One try with one engine (`Translator.translate`).
    #[allow(clippy::too_many_arguments)]
    fn attempt(
        &self,
        engine: &str,
        weight: &str,
        source: Option<&str>,
        target: &str,
        country: &str,
        text: &str,
        history: &[HistoryItem],
    ) -> Attempt {
        if source == Some(target) {
            return Attempt::Text(text.to_string());
        }
        let Some(source) = source else { return Attempt::Unsupported };
        let Some((source, target)) = self.language_codes(engine, weight, country, source, target) else {
            return Attempt::Unsupported;
        };
        if engine == LOCAL_ENGINE {
            let _guard = self.translation.local_lock.lock().unwrap();
            let Some(mut setup) = self.translation.local.loaded() else { return Attempt::Failed };
            if setup.weight != weight {
                // The message's weight, even if a newer one is selected already.
                setup.weight = weight.to_string();
                if self.translation.local.load(&setup).is_err() {
                    return Attempt::Failed;
                }
            }
            return match self.translation.local.translate(text, &source, &target) {
                Ok(text) => Attempt::Text(text),
                Err(LocalError::OutOfMemory(message)) => Attempt::OutOfMemory(message),
                Err(LocalError::Unsupported) => Attempt::Unsupported,
                Err(_) => Attempt::Failed,
            };
        }
        let Some(provider) = Provider::from_engine(engine) else { return Attempt::Failed };
        let Some(session) = self.translation.session(provider) else { return Attempt::Failed };
        let supported = Self::supported_languages(engine);
        let request =
            providers::Translation { text, source: &source, target: &target, supported_languages: &supported, history };
        match self.translation.translate(provider, &session, &request) {
            Ok(text) => Attempt::Text(text),
            // Papago translates only some pairs of its languages directly.
            Err(providers::Error::UnsupportedPair) => Attempt::Unsupported,
            Err(_) => {
                self.step("Translation: the provider failed");
                Attempt::Failed
            }
        }
    }

    /// The conversation history the chat providers get (`getTranslationHistory`), if the
    /// translation still goes where the message was admitted to.
    fn history_for(&self, engine: &str, generation: u64) -> Vec<HistoryItem> {
        let config = self.config();
        let mut history = self.translation.history.lock().unwrap();
        let current = config.history_generation();
        if history.generation != current {
            history.items.clear();
            history.generation = current;
        }
        let selected = config.get("SELECTED_TRANSLATION_ENGINES")[config.get_str("SELECTED_TAB_NO")] == json!(engine);
        if !config.get_bool("ENABLE_TRANSLATION") || !selected || generation != current {
            return Vec::new();
        }
        history
            .items
            .iter()
            .map(|s| HistoryItem { source: s.source.clone(), text: s.text.clone(), time: s.time.clone() })
            .collect()
    }

    /// `addTranslationHistory`: kept only while translation is on and the destination is the
    /// one the message was admitted to.
    pub(crate) fn add_history(&self, source: &str, text: &str, snapshot: &super::messages::Snapshot) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let config = self.config();
        let mut history = self.translation.history.lock().unwrap();
        let current = config.history_generation();
        if history.generation != current {
            history.items.clear();
            history.generation = current;
        }
        if !config.get_bool("ENABLE_TRANSLATION")
            || !snapshot.translation_enabled
            || snapshot.history_generation != current
        {
            return;
        }
        let time = chrono::Local::now().format("%H:%M").to_string();
        history.items.push(Said { source: source.to_string(), text: text.to_string(), time });
        let excess = history.items.len().saturating_sub(HISTORY_ITEMS);
        history.items.drain(..excess);
    }

    /// `getTranslate`: the selected engine, then the local translation when it failed or
    /// lacked the languages. `Err` only when the GPU ran out of memory.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn translate(
        &self,
        engine: &str,
        weight: &str,
        source: Option<&str>,
        target: &str,
        country: &str,
        text: &str,
        generation: u64,
    ) -> Result<Translated, String> {
        let history = self.history_for(engine, generation);
        let empty = |attempt: Attempt| match attempt {
            Attempt::Text(t) if t.trim().is_empty() && !text.trim().is_empty() => Attempt::Failed,
            other => other,
        };
        let first = empty(self.attempt(engine, weight, source, target, country, text, &history));
        let primary_failed = match first {
            Attempt::Text(t) => return Ok(Translated { text: t, success: true, provenance: "translated" }),
            Attempt::OutOfMemory(message) => return Err(message),
            Attempt::Failed => true,
            Attempt::Unsupported => false,
        };
        let mut fallback = Attempt::Failed;
        for _ in 0..20 {
            fallback = self.attempt(LOCAL_ENGINE, weight, source, target, country, text, &[]);
            match fallback {
                Attempt::Text(_) | Attempt::Unsupported | Attempt::OutOfMemory(_) => break,
                Attempt::Failed if self.translation.local.loaded().is_none() => break,
                Attempt::Failed => std::thread::sleep(Duration::from_millis(100)),
            }
        }
        match empty(fallback) {
            Attempt::Text(t) => Ok(Translated { text: t, success: true, provenance: "translated" }),
            Attempt::OutOfMemory(message) => Err(message),
            Attempt::Unsupported if !primary_failed => {
                Ok(Translated { text: text.to_string(), success: true, provenance: "unsupported" })
            }
            Attempt::Unsupported => {
                self.step("Translation failed and the local model cannot translate this language pair");
                Ok(Translated { text: text.to_string(), success: false, provenance: "failed" })
            }
            Attempt::Failed => Ok(Translated { text: text.to_string(), success: false, provenance: "failed" }),
        }
    }
}

enum Attempt {
    Text(String),
    Unsupported,
    Failed,
    OutOfMemory(String),
}

/// One translation of a message (`getTranslate` with provenance).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Translated {
    pub text: String,
    pub success: bool,
    /// "translated", "unsupported" or "failed".
    pub provenance: &'static str,
}

// ------------------------------------------------------------------------- start-up

/// What the start-up check found for one engine.
struct Checked {
    available: bool,
    models: Option<(Vec<String>, Option<String>)>,
    connected: Option<Connected>,
}

impl Core {
    /// The start-up check of every engine (`check_translation_engine` in `init`): each is
    /// checked at the same time, then the results are applied in order. A key is never
    /// removed: a failed check cannot tell a refused key from a network that is down.
    pub(crate) fn check_translation_engines(&self, local_available: bool) -> Map<String, Value> {
        let config = self.config();
        let engines: Vec<String> = config
            .get("SELECTABLE_TRANSLATION_ENGINE_LIST")
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| e.as_str().map(str::to_string))
            .collect();
        let keys = config.get("AUTH_KEYS");
        let results: Vec<(String, Checked)> = std::thread::scope(|scope| {
            let handles: Vec<_> = engines
                .iter()
                .map(|engine| {
                    let keys = &keys;
                    scope.spawn(move || (engine.clone(), self.check_engine(engine, keys, local_available)))
                })
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        let mut status = Map::new();
        for engine in &engines {
            let checked = results.iter().find(|(e, _)| e == engine).map(|(_, c)| c);
            let available = checked.is_some_and(|c| c.available);
            status.insert(engine.clone(), json!(available));
            let provider = Provider::from_engine(engine);
            match (checked, provider) {
                (Some(Checked { available: true, models, connected }), Some(provider)) => {
                    if let Some(connected) = connected {
                        self.translation.commit(provider, connected);
                    }
                    if let (Some((models, choice)), Some((list, selected, _))) = (models, model_keys(provider)) {
                        config.put(list, json!(models));
                        config.put(selected, choice.as_ref().map_or(Value::Null, |c| json!(c)));
                    }
                }
                (_, Some(provider))
                    if matches!(provider, Provider::LmStudio | Provider::OpenAiCompatible | Provider::Ollama) =>
                {
                    let (list, selected, _) = model_keys(provider).expect("a provider with models");
                    config.put(list, json!([]));
                    let _ = config.set(selected, Value::Null);
                }
                _ => {}
            }
        }
        status
    }

    fn check_engine(&self, engine: &str, keys: &Value, local_available: bool) -> Checked {
        let none = Checked { available: false, models: None, connected: None };
        if engine == LOCAL_ENGINE {
            return Checked { available: local_available, ..none };
        }
        // An engine without a client. The web translators Python let through (every request
        // failed) are not in the list any more (`languages::RETIRED_WEB_TRANSLATORS`).
        let Some(provider) = Provider::from_engine(engine) else { return none };
        let config = self.config();
        let key = keys[engine].as_str().filter(|k| !k.is_empty()).map(str::to_string);
        let connected = match provider {
            Provider::LmStudio | Provider::Ollama => {
                let url = config.get_str(url_key(provider).expect("a server the user runs"));
                if url.is_empty() || !self.connect_local_server(provider, &url) {
                    return none;
                }
                return self.local_server_checked(provider);
            }
            Provider::OpenAiCompatible => {
                let url = config.get_str("OPENAI_COMPATIBLE_URL");
                let Some(key) = key.filter(|_| !url.is_empty()) else { return none };
                let selected = config.get("SELECTED_OPENAI_COMPATIBLE_MODEL");
                self.connect(provider, &url, Some(&key), selected.as_str())
            }
            Provider::Papago => {
                let client_id = config.get_str("PAPAGO_CLIENT_ID");
                let Some(key) = key.filter(|_| !client_id.is_empty()) else { return none };
                let base = fixed_url(&self.translation.endpoints, provider, &key);
                self.translation.connect(provider, &base, Some(&key), Some(&client_id), None)
            }
            _ => {
                let Some(key) = key else { return none };
                let selected = model_keys(provider).map(|(_, selected, _)| config.get(selected)).unwrap_or(Value::Null);
                let base = fixed_url(&self.translation.endpoints, provider, &key);
                self.connect(provider, &base, Some(&key), selected.as_str())
            }
        };
        match connected {
            Ok(connected) => {
                let models = (!provider.without_models())
                    .then(|| (connected.models.clone(), connected.session.model.clone()));
                Checked { available: true, models, connected: Some(connected) }
            }
            Err(_) => {
                self.step("Translation engine check failed; the saved key is kept");
                none
            }
        }
    }

    /// LM Studio or Ollama answered at start-up: usable only with a model.
    fn local_server_checked(&self, provider: Provider) -> Checked {
        let models = self.local_server_models(provider);
        if models.is_empty() {
            return Checked { available: false, models: None, connected: None };
        }
        let choice = self.choose_server_model(provider, &models);
        Checked { available: true, models: Some((models, Some(choice))), connected: None }
    }
}

// ------------------------------------------------------------------------- endpoints

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/set/data/deepl_auth_key", WAIT, |core, data| core.set_deepl_key(data));
    for (index, spec) in KEY_PROVIDERS.iter().enumerate() {
        b.with(&format!("/set/data/{}_auth_key", spec.name), spec.wait, move |core, data| {
            core.set_registry_key(&KEY_PROVIDERS[index], data)
        });
        let provider = spec.provider;
        b.with(&format!("/set/data/selected_{}_model", spec.name), spec.wait, move |core, data| {
            core.set_model(provider, data)
        });
    }

    // The official machine translation APIs (core only, #277).
    b.with("/set/data/google_cloud_auth_key", OPEN, |core, data| core.set_google_cloud_key(data));
    b.with("/set/data/papago_client_id", OPEN, |core, data| core.set_papago_client_id(data));
    b.with("/set/data/papago_auth_key", OPEN, |core, data| core.set_papago_key(data));

    b.with("/get/data/connected_lmstudio", OPEN, |core, _| {
        ok(json!(core.translation.lmstudio_connected.load(Ordering::SeqCst)))
    });
    b.with("/run/lmstudio_connection", OPEN, |core, _| core.check_local_server(Provider::LmStudio));
    b.with("/get/data/selectable_lmstudio_model_list", OPEN, |core, _| {
        ok(json!(core.local_server_models(Provider::LmStudio)))
    });
    b.with("/set/data/selected_lmstudio_model", OPEN, |core, data| core.set_model(Provider::LmStudio, data));
    b.with("/set/data/lmstudio_url", OPEN, |core, data| core.set_server_url(Provider::LmStudio, data));

    b.with("/set/data/openai_compatible_auth_key", OPEN, |core, data| core.set_compatible_key(data));
    b.with("/set/data/openai_compatible_auth_key_and_url", OPEN, |core, data| core.set_compatible_key_and_url(data));
    b.with("/set/data/selected_openai_compatible_model", OPEN, |core, data| {
        core.set_model(Provider::OpenAiCompatible, data)
    });

    b.with("/get/data/connected_ollama", OPEN, |core, _| {
        ok(json!(core.translation.ollama_connected.load(Ordering::SeqCst)))
    });
    b.with("/run/ollama_connection", OPEN, |core, _| core.check_local_server(Provider::Ollama));
    b.with("/get/data/selectable_ollama_model_list", OPEN, |core, _| {
        ok(json!(core.local_server_models(Provider::Ollama)))
    });
    b.with("/set/data/selected_ollama_model", OPEN, |core, data| core.set_model(Provider::Ollama, data));
    // Core only: where Ollama runs (Python always used localhost:11434).
    b.with("/set/data/ollama_url", OPEN, |core, data| core.set_server_url(Provider::Ollama, data));

    b.with("/set/data/selected_ctranslate2_weight_type", OPEN, |core, data| core.set_weight_type(data));
    b.with("/set/enable/translation", WAIT, |core, _| core.enable_translation());
}
