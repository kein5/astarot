//! The saved credentials, URLs and model choices of the translation and recognition services
//! (`controller.py`: `_getTranslationEngineAuthKey`, `_delTranslationEngineAuthKey`,
//! `_getTranslationEngineModelList`, `_getTranslationEngineModel`, `delDeeplAuthKey`,
//! `delOpenAICompatibleAuthKey`, `setOpenAICompatibleURL`, the transcription counterparts and
//! `setCustomWhisperURL`).
//!
//! What is wired here only reads or forgets what is saved; it never reaches a service. Saving a
//! translation key, choosing a model and asking a local server for its models check them with
//! the service: [`super::translation`]. The recognition services wait for their clients (#278):
//! those endpoints still answer 404, and a saved key is kept while its engine counts as
//! unavailable.

use super::routes::{Builder, OPEN, WAIT};
use super::{Core, error, ok};
use crate::net_policy::validate_api_url;
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::sync::Arc;

/// A translation provider that keeps a key and a list of models (`TRANSLATION_PROVIDER_REGISTRY`).
struct Translation {
    /// The name in the endpoints (`/get/data/{name}_auth_key`).
    name: &'static str,
    /// The key in `AUTH_KEYS` and `SELECTABLE_TRANSLATION_ENGINE_STATUS`.
    engine: &'static str,
    list: &'static str,
    selected: &'static str,
    /// Whether the endpoints wait for start-up (`"status": False` in Python's `mapping`).
    wait: bool,
}

const TRANSLATION: [Translation; 5] = [
    Translation { name: "plamo", engine: "Plamo_API", list: "SELECTABLE_PLAMO_MODEL_LIST", selected: "SELECTED_PLAMO_MODEL", wait: WAIT },
    Translation { name: "gemini", engine: "Gemini_API", list: "SELECTABLE_GEMINI_MODEL_LIST", selected: "SELECTED_GEMINI_MODEL", wait: OPEN },
    Translation { name: "openai", engine: "OpenAI_API", list: "SELECTABLE_OPENAI_MODEL_LIST", selected: "SELECTED_OPENAI_MODEL", wait: OPEN },
    Translation { name: "groq", engine: "Groq_API", list: "SELECTABLE_GROQ_MODEL_LIST", selected: "SELECTED_GROQ_MODEL", wait: OPEN },
    Translation {
        name: "openrouter",
        engine: "OpenRouter_API",
        list: "SELECTABLE_OPENROUTER_MODEL_LIST",
        selected: "SELECTED_OPENROUTER_MODEL",
        wait: OPEN,
    },
];

/// A recognition service with a key (`TRANSCRIPTION_AUTH_KEYS`).
struct Transcription {
    name: &'static str,
    engine: &'static str,
    list: &'static str,
    selected: &'static str,
}

const TRANSCRIPTION: [Transcription; 4] = [
    Transcription {
        name: "groq_whisper",
        engine: "Groq_Whisper",
        list: "SELECTABLE_GROQ_WHISPER_MODEL_LIST",
        selected: "SELECTED_GROQ_WHISPER_MODEL",
    },
    Transcription {
        name: "openai_whisper",
        engine: "OpenAI_Whisper",
        list: "SELECTABLE_OPENAI_WHISPER_MODEL_LIST",
        selected: "SELECTED_OPENAI_WHISPER_MODEL",
    },
    Transcription {
        name: "custom_whisper",
        engine: "Custom_Whisper",
        list: "SELECTABLE_CUSTOM_WHISPER_MODEL_LIST",
        selected: "SELECTED_CUSTOM_WHISPER_MODEL",
    },
    Transcription { name: "deepgram", engine: "Deepgram", list: "SELECTABLE_DEEPGRAM_MODEL_LIST", selected: "SELECTED_DEEPGRAM_MODEL" },
];

/// The `_list` / `_model` notification names of a settings key (`selectable_x_model_list`).
fn notification(key: &str) -> String {
    key.to_lowercase()
}

impl Core {
    /// Marks an engine unavailable in one of the status maps.
    fn mark_unavailable(&self, status_key: &str, engine: &str) {
        let mut status = self.config().get(status_key);
        if let Some(map) = status.as_object_mut() {
            map.insert(engine.to_string(), json!(false));
        }
        self.config().put(status_key, status);
    }

    /// Empties a model list and its choice, and tells the UI (`setattr(config, ..., [])`, `None`).
    fn forget_models(&self, list: &str, selected: &str) {
        self.config().put(list, json!([]));
        self.config().put(selected, Value::Null);
        self.notify(&notification(list), self.config().get(list));
        self.notify(&notification(selected), self.config().get(selected));
    }

    /// `_delTranslationEngineAuthKey` (and `delDeeplAuthKey`, which has no models).
    pub(crate) fn delete_translation_key(&self, engine: &str, models: Option<(&str, &str)>) -> Reply {
        let _guard = self.credential_lock.lock().unwrap();
        if self.config().update_credential("AUTH_KEYS", engine, None).is_err() {
            return Reply::status(500, "Internal error");
        }
        if let Some((list, selected)) = models {
            self.forget_models(list, selected);
        }
        self.mark_unavailable("SELECTABLE_TRANSLATION_ENGINE_STATUS", engine);
        self.update_translation_engine_and_list();
        ok(self.config().get("AUTH_KEYS")[engine].clone())
    }

    /// `delGroqWhisperAuthKey` and the other recognition services.
    fn delete_transcription_key(&self, service: &Transcription) -> Reply {
        let _guard = self.credential_lock.lock().unwrap();
        if self.config().update_credential("TRANSCRIPTION_AUTH_KEYS", service.engine, None).is_err() {
            return Reply::status(500, "Internal error");
        }
        if service.engine == "Deepgram" {
            // The Deepgram languages go with its models (`DEEPGRAM_MODEL_LANGUAGES = {}`).
            self.config().put("DEEPGRAM_MODEL_LANGUAGES", json!({}));
        }
        self.forget_models(service.list, service.selected);
        self.mark_unavailable("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS", service.engine);
        self.update_transcription_engine(None);
        ok(self.config().get("TRANSCRIPTION_AUTH_KEYS")[service.engine].clone())
    }

    /// `setOpenAICompatibleURL` and `setCustomWhisperURL`: a new destination for a saved key
    /// needs the key again, so the URL changes only while no key is saved.
    fn set_endpoint_url(&self, key: &str, credentials: &str, provider: &str, invalid: &'static str, data: &Value) -> Reply {
        let url = match data {
            Value::String(s) => s.trim().to_string(),
            _ => return error(invalid, self.config().get(key)),
        };
        if validate_api_url(&url, false).is_err() {
            return error(invalid, self.config().get(key));
        }
        let _guard = self.credential_lock.lock().unwrap();
        if self.config().get(key) == json!(url) {
            return ok(self.config().get(key));
        }
        let saved = &self.config().get(credentials)[provider];
        if saved.as_str().is_some_and(|s| !s.is_empty()) {
            return error("CREDENTIAL_REENTRY_REQUIRED", self.config().get(key));
        }
        if self.config().set(key, json!(url)).is_err() {
            return Reply::status(500, "Internal error");
        }
        ok(self.config().get(key))
    }
}

fn read(core: &Arc<Core>, map: &'static str, provider: &'static str) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |_| ok(core.config().get(map)[provider].clone())
}

pub(crate) fn add(b: &mut Builder<'_>) {
    // Translation
    b.add("/get/data/deepl_auth_key", WAIT, read(b.core, "AUTH_KEYS", "DeepL_API"));
    b.with("/delete/data/deepl_auth_key", WAIT, |core, _| core.delete_translation_key("DeepL_API", None));
    for provider in TRANSLATION {
        let Translation { name, engine, list, selected, wait } = provider;
        b.add(&format!("/get/data/{name}_auth_key"), wait, read(b.core, "AUTH_KEYS", engine));
        b.with(&format!("/delete/data/{name}_auth_key"), wait, move |core, _| {
            core.delete_translation_key(engine, Some((list, selected)))
        });
        b.get(&format!("/get/data/selectable_{name}_model_list"), wait, list);
        b.get(&format!("/get/data/selected_{name}_model"), wait, selected);
    }

    b.add("/get/data/openai_compatible_auth_key", OPEN, read(b.core, "AUTH_KEYS", "OpenAI_Compatible"));
    b.with("/delete/data/openai_compatible_auth_key", OPEN, |core, _| {
        core.delete_translation_key(
            "OpenAI_Compatible",
            Some(("SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST", "SELECTED_OPENAI_COMPATIBLE_MODEL")),
        )
    });
    b.get("/get/data/openai_compatible_url", OPEN, "OPENAI_COMPATIBLE_URL");
    b.with("/set/data/openai_compatible_url", OPEN, |core, data| {
        core.set_endpoint_url("OPENAI_COMPATIBLE_URL", "AUTH_KEYS", "OpenAI_Compatible", "CONNECTION_OPENAI_COMPATIBLE_URL_INVALID", data)
    });
    b.get("/get/data/selectable_openai_compatible_model_list", OPEN, "SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST");
    b.get("/get/data/selected_openai_compatible_model", OPEN, "SELECTED_OPENAI_COMPATIBLE_MODEL");
    b.get("/get/data/lmstudio_url", OPEN, "LMSTUDIO_URL");
    b.get("/get/data/selected_lmstudio_model", OPEN, "SELECTED_LMSTUDIO_MODEL");
    b.get("/get/data/selected_ollama_model", OPEN, "SELECTED_OLLAMA_MODEL");

    // Recognition
    for service in TRANSCRIPTION {
        let name = service.name;
        b.add(&format!("/get/data/{name}_auth_key"), OPEN, read(b.core, "TRANSCRIPTION_AUTH_KEYS", service.engine));
        b.with(&format!("/delete/data/{name}_auth_key"), OPEN, move |core, _| core.delete_transcription_key(&service));
    }
    b.with("/set/data/custom_whisper_url", OPEN, |core, data| {
        core.set_endpoint_url(
            "TRANSCRIPTION_CUSTOM_URL",
            "TRANSCRIPTION_AUTH_KEYS",
            "Custom_Whisper",
            "CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID",
            data,
        )
    });
}
