//! The translation catalog (#413): what translates, in two groups, with the entries the app
//! ships and the ones the user adds side by side.
//!
//! - **engine**: models that run on an inference engine on this PC. The built-in weights, the
//!   folders in `<data>/translation-models/`, and the engine entries the user added
//!   (`vrct_ops::downloads::translation_catalog`). An engine entry is a local translation weight
//!   named `user:<id>`, chosen like any other weight.
//! - **api**: the providers the core calls (DeepL, Google Cloud, Papago, the LLM APIs, LM
//!   Studio, Ollama and the OpenAI-compatible endpoint), and the API entries the user added. An
//!   API entry is a named OpenAI-compatible endpoint (this PC, the LAN or the internet); using it
//!   points the OpenAI-compatible engine at it, through the same check of the address and the
//!   key as typing them in.
//!
//! An API entry's key is kept in the secret store (`TRANSLATION_CATALOG/<id>`), never in
//! `translation_catalog.json` or `config.json`. When the store does not take it, the key is held
//! in memory for this run, reported and tried again, as a setting's key is (ADR-013,
//! `Config::keep_secret`); the entry records `key: false` until the store holds the key. The
//! routes carry `translation_catalog`, so the process log masks their values (names, folders,
//! addresses and keys: `log::SENSITIVE_ENDPOINT_MARKERS`). Nothing here logs them either.

use super::languages::LOCAL_ENGINE;
use super::routes::{Builder, OPEN, WAIT};
use super::{Core, ok};
use crate::config::Kept;
use crate::net_policy::validate_api_url;
use crate::protocol::Reply;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use vrct_ops::downloads::Error;
use vrct_ops::downloads::translation_catalog::{self as catalog, TranslationCatalog, codes};
use vrct_translation::providers::Provider;

/// The engine the API entries switch.
const COMPATIBLE_ENGINE: &str = "OpenAI_Compatible";
/// An OpenAI-compatible entry needs a key, as the engine it switches does.
pub const KEY_REQUIRED: &str = "translation_catalog_key_required";
/// The entry's key is neither in memory nor in the secret store.
pub const KEY_MISSING: &str = "translation_catalog_key_missing";
/// The secret store could not be read now (locked, not running, a file it cannot read): the
/// key may well be there, so nothing is changed.
pub const KEY_UNREADABLE: &str = "translation_catalog_key_unreadable";
/// The entry cannot be used now: its folder is gone or its runtime or protocol is unknown.
pub const UNUSABLE: &str = "translation_catalog_unusable";
/// The engine entry is the selected local model: choose another before removing it.
pub const IN_USE: &str = "translation_catalog_in_use";
/// The address did not answer, or did not accept the key.
pub const CONNECT_FAILED: &str = "translation_catalog_connect_failed";
/// Switching the local model failed.
pub const USE_FAILED: &str = "translation_catalog_use_failed";
/// The API entry's model is not in the endpoint's list; another model was chosen.
pub const MODEL_NOT_LISTED: &str = "translation_catalog_model_not_listed";
/// The codes answered with 409: the request may pass once the state changes.
const CONFLICTS: [&str; 4] = [IN_USE, UNUSABLE, KEY_UNREADABLE, codes::EXISTS];

fn failure(code: &str) -> Reply {
    Reply::status(if CONFLICTS.contains(&code) { 409 } else { 400 }, json!({ "error_code": code }))
}

fn code_of(error: Error) -> &'static str {
    error.code().unwrap_or(codes::WRITE_FAILED)
}

/// The secret store entry of an API entry's key.
fn key_entry(id: &str) -> String {
    format!("TRANSLATION_CATALOG/{id}")
}

/// The runtimes this build can run: `onnx` with the `onnx-translation` feature.
fn runtimes() -> Vec<&'static str> {
    if cfg!(feature = "onnx-translation") { catalog::RUNTIMES.to_vec() } else { Vec::new() }
}

/// Checks an engine entry's folder before it is added (`onnx`: the folder holds a model with a
/// language the entry offers).
fn inspect_engine(row: &Value) -> Result<(), &'static str> {
    #[cfg(feature = "onnx-translation")]
    {
        let folder = std::path::Path::new(row["folder"].as_str().unwrap_or_default());
        super::translation_onnx::inspect(folder, row)
    }
    #[cfg(not(feature = "onnx-translation"))]
    {
        let _ = row;
        Err(codes::RUNTIME_UNSUPPORTED)
    }
}

fn entry_weight(id: &str) -> String {
    format!("user:{id}")
}

impl Core {
    fn translation_catalog(&self) -> &Arc<TranslationCatalog> {
        &self.ops().translation_catalog
    }

    /// `{engine: [...], api: [...], runtimes, protocols}` and `error_code` when the user's file
    /// cannot be read. Every item has `origin`: `builtin` (shipped), `folder` (a folder in
    /// `<data>/translation-models/`) or `user` (an entry the user added).
    pub(crate) fn translation_catalog_view(&self) -> Value {
        let config = self.config();
        let state = self.translation_catalog().state();
        let selected = config.get_str("CTRANSLATE2_WEIGHT_TYPE");
        let present = config.get("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT");
        let weights = config.get("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST");
        let entries = state["entries"].as_array().cloned().unwrap_or_default();

        let mut engine: Vec<Value> = weights
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|weight| !weight.starts_with("user:"))
            .map(|weight| {
                let folder = weight.strip_prefix("custom:");
                json!({
                    "id": weight, "weight": weight, "origin": if folder.is_some() { "folder" } else { "builtin" },
                    "name": folder.unwrap_or(weight), "runtime": "onnx",
                    "non_commercial": super::lifecycle::non_commercial(weight),
                    "available": present[weight] == true, "in_use": weight == selected,
                })
            })
            .collect();
        for entry in entries.iter().filter(|e| e["group"] == "engine") {
            let weight = entry_weight(entry["id"].as_str().unwrap_or_default());
            let mut item = entry.as_object().cloned().unwrap_or_default();
            item.insert("origin".into(), json!("user"));
            item.insert("available".into(), json!(present[&weight] == true));
            item.insert("in_use".into(), json!(weight == selected));
            item.insert("weight".into(), json!(weight));
            engine.push(Value::Object(item));
        }

        let status = config.get("SELECTABLE_TRANSLATION_ENGINE_STATUS");
        let mut api: Vec<Value> = config
            .get("SELECTABLE_TRANSLATION_ENGINE_LIST")
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|engine| *engine != LOCAL_ENGINE)
            .map(|engine| {
                let local = Provider::from_engine(engine).is_some_and(Provider::local) || engine == COMPATIBLE_ENGINE;
                json!({
                    "id": engine, "origin": "builtin", "name": engine,
                    "kind": if local { "local_server" } else { "cloud" }, "available": status[engine] == true,
                })
            })
            .collect();
        let url = config.get_str("OPENAI_COMPATIBLE_URL");
        let model = config.get("SELECTED_OPENAI_COMPATIBLE_MODEL");
        let keyed = config.get("AUTH_KEYS")[COMPATIBLE_ENGINE].as_str().is_some_and(|k| !k.is_empty());
        for entry in entries.iter().filter(|e| e["group"] == "api") {
            let mut item = entry.as_object().cloned().unwrap_or_default();
            let same_model = entry["model"] == "" || entry["model"] == model;
            item.insert("origin".into(), json!("user"));
            // The store did not take the key: held until the app closes, and tried again.
            let in_memory = config.secret_in_memory(&key_entry(entry["id"].as_str().unwrap_or_default()));
            item.insert("key_in_memory".into(), json!(in_memory));
            // What the OpenAI-compatible engine points at now.
            item.insert("in_use".into(), json!(keyed && entry["url"] == url.as_str() && same_model));
            api.push(Value::Object(item));
        }

        let mut view = Map::new();
        view.insert("engine".into(), json!(engine));
        view.insert("api".into(), json!(api));
        view.insert("runtimes".into(), json!(runtimes()));
        view.insert("protocols".into(), json!(catalog::PROTOCOLS));
        if let Some(code) = state.get("error_code") {
            view.insert("error_code".into(), code.clone());
        }
        Value::Object(view)
    }

    /// The local weights again after an engine entry came or went: the list the settings check
    /// `CTRANSLATE2_WEIGHT_TYPE` against, and which of them are on this PC.
    fn refresh_translation_weights(&self) {
        self.translation.refresh_local_models();
        let config = self.config();
        let env = config.environment();
        let ids = super::translation::weight_ids(env);
        let before = config.get("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT");
        let dict: Map<String, Value> = ids
            .iter()
            .map(|id| {
                // A built-in weight keeps what start-up and the downloads found.
                let present = if id.starts_with("user:") || id.starts_with("custom:") || before.get(id).is_none() {
                    (self.services().translation_weight_available)(id) || super::translation::default_weight_available(env, id)
                } else {
                    before[id] == true
                };
                (id.clone(), json!(present))
            })
            .collect();
        config.put("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST", json!(ids));
        config.put("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT", Value::Object(dict));
    }

    /// Adds an entry. Engine: `{group, name, runtime, folder, languages?}`. API: `{group, name,
    /// protocol, url, model, auth_key}`; the key goes to the secret store. When the store does
    /// not take it, the entry is added all the same and its key is held in memory for this run
    /// (reported through `/run/secret_store_failed` and tried again, as a setting's key is).
    fn register_translation_entry(&self, data: &Value) -> Reply {
        let Some(mut request) = data.as_object().cloned() else { return failure(codes::INVALID) };
        let api = request.get("group") == Some(&json!("api"));
        let key = if api {
            match request.remove("auth_key") {
                Some(Value::String(key)) => Some(key.trim().to_string()).filter(|k| !k.is_empty()),
                None | Some(Value::Null) => None,
                Some(_) => return failure(codes::INVALID),
            }
        } else {
            None
        };
        if api {
            // Whether the store holds the key: set once it does (below).
            request.insert("key".into(), json!(false));
        }
        let row = match TranslationCatalog::normalize(&Value::Object(request)) {
            Ok(row) => row,
            Err(error) => return failure(code_of(error)),
        };
        if api {
            if validate_api_url(row["url"].as_str().unwrap_or_default(), false).is_err() {
                return failure(codes::URL_INVALID);
            }
            if key.is_none() {
                return failure(KEY_REQUIRED);
            }
        } else if let Err(code) = inspect_engine(&row) {
            return failure(code);
        }
        let catalog = self.translation_catalog();
        let id = match catalog.add(row) {
            Ok((id, _)) => id,
            Err(error) => return failure(code_of(error)),
        };
        if let Some(key) = &key {
            let (catalog, marked) = (Arc::clone(catalog), id.clone());
            // Recorded for the next start, once the store holds the key (now or later this run).
            let on_stored = Box::new(move || {
                let _ = catalog.set_key(&marked, true);
            });
            if self.config().keep_secret(&key_entry(&id), key, on_stored) == Kept::InMemory {
                self.step("Translation catalog: the key store did not take an API entry's key; it is held in memory for this run");
            }
        }
        if !api {
            self.refresh_translation_weights();
        }
        ok(self.translation_catalog_view())
    }

    /// Forgets `{id}`, and an API entry's key. The selected local model cannot be removed.
    fn remove_translation_entry(&self, data: &Value) -> Reply {
        let Some(id) = data.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("id")).and_then(Value::as_str) else {
            return failure(codes::INVALID);
        };
        if self.config().get_str("CTRANSLATE2_WEIGHT_TYPE") == entry_weight(id) {
            return failure(IN_USE);
        }
        let removed = match self.translation_catalog().remove(data) {
            Ok((removed, _)) => removed,
            Err(error) => return failure(code_of(error)),
        };
        if removed["group"] == "api" {
            // Gone from memory now; from the store now or with the tries a deleted setting's key
            // gets (reported through `/run/secret_store_failed`).
            self.config().forget_secret(&key_entry(id));
        } else {
            self.refresh_translation_weights();
        }
        ok(self.translation_catalog_view())
    }

    /// Uses `{id}`: an engine entry becomes the local model; an API entry becomes the address,
    /// key and model of the OpenAI-compatible engine, once the address answers with the key.
    fn use_translation_entry(&self, data: &Value) -> Reply {
        let Some(id) = data.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("id")).and_then(Value::as_str) else {
            return failure(codes::INVALID);
        };
        let entry = match self.translation_catalog().entry(id) {
            Ok(entry) => entry,
            Err(error) => return failure(code_of(error)),
        };
        if catalog::view(&entry)["status"] != "ok" {
            return failure(UNUSABLE);
        }
        if entry["group"] == "engine" {
            let weight = entry_weight(id);
            self.refresh_translation_weights();
            if self.config().get("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT")[&weight] != true {
                return failure(UNUSABLE);
            }
            if self.set_weight_type(&json!(weight)).status != 200 {
                return failure(USE_FAILED);
            }
            return ok(self.translation_catalog_view());
        }
        // The key held in memory when the store did not take it, else the store's.
        let key = match self.config().secret(&key_entry(id)) {
            Ok(Some(key)) => key,
            Ok(None) => return failure(KEY_MISSING),
            // Locked or not answering: a temporary failure, not a missing key (ADR-013).
            Err(_) => return failure(KEY_UNREADABLE),
        };
        let url = entry["url"].clone();
        if self.set_compatible_key_and_url(&json!({ "url": url, "auth_key": key })).status != 200 {
            return failure(CONNECT_FAILED);
        }
        // The connection chose a model already (the saved one if listed, else the first); the
        // entry's model replaces it when the endpoint lists it.
        let model = entry["model"].as_str().unwrap_or_default();
        let listed = model.is_empty() || self.set_model(Provider::OpenAiCompatible, &json!(model)).status == 200;
        let mut view = self.translation_catalog_view();
        if !listed {
            view["warning"] = json!(MODEL_NOT_LISTED);
        }
        ok(view)
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/get/data/translation_catalog", OPEN, |core, _| ok(core.translation_catalog_view()));
    b.with("/run/register_translation_catalog_entry", WAIT, |core, data| core.register_translation_entry(data));
    b.with("/run/remove_translation_catalog_entry", WAIT, |core, data| core.remove_translation_entry(data));
    b.with("/run/use_translation_catalog_entry", WAIT, |core, data| core.use_translation_entry(data));
}
