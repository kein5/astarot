//! The speech recognition APIs the user adds (#414): the API group of the speech recognition
//! page, beside the providers the app ships (Groq, OpenAI, Deepgram and the custom Whisper
//! server). An entry is a named Whisper-compatible endpoint (this PC, the LAN or the internet)
//! with its model and its key; using it points the custom Whisper server engine at it, through
//! the same check of the address and the key as typing them in (`set_custom_whisper_key_and_url`).
//! It is not an engine of its own: the engine list, the consent and the VR panel stay as they are.
//!
//! An entry's key is kept in the secret store (`TRANSCRIPTION_CATALOG/<id>`), never in
//! `transcription_catalog.json` or `config.json`. When the store does not take it, the key is
//! held in memory for this run, reported and tried again, as a setting's key is (ADR-013,
//! `Config::keep_secret`); the entry records `key: false` until the store holds the key. The
//! routes carry `transcription_catalog`, so the process log masks their values (names,
//! addresses and keys: `log::SENSITIVE_ENDPOINT_MARKERS`). Nothing here logs them either.

use super::routes::{Builder, OPEN, WAIT};
use super::{Core, ok};
use crate::config::Kept;
use crate::net_policy::validate_api_url;
use crate::protocol::Reply;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use astarot_ops::downloads::Error;
use astarot_ops::downloads::transcription_catalog::{self as catalog, TranscriptionCatalog, codes};

/// The engine an entry points.
const ENGINE: &str = "Custom_Whisper";
/// An entry needs a key, as the custom Whisper server engine does.
pub const KEY_REQUIRED: &str = "transcription_catalog_key_required";
/// The entry's key is neither in memory nor in the secret store.
pub const KEY_MISSING: &str = "transcription_catalog_key_missing";
/// The secret store could not be read now (locked, not running, a file it cannot read): the key
/// may well be there, so nothing is changed.
pub const KEY_UNREADABLE: &str = "transcription_catalog_key_unreadable";
/// The entry names a protocol this version cannot use.
pub const UNUSABLE: &str = "transcription_catalog_unusable";
/// The address did not answer, or did not accept the key.
pub const CONNECT_FAILED: &str = "transcription_catalog_connect_failed";
/// The entry's model is not in the endpoint's list; another model was chosen.
pub const MODEL_NOT_LISTED: &str = "transcription_catalog_model_not_listed";
/// The codes answered with 409: the request may pass once the state changes.
const CONFLICTS: [&str; 4] = [UNUSABLE, KEY_UNREADABLE, codes::EXISTS, codes::UNREADABLE];

fn failure(code: &str) -> Reply {
    Reply::status(if CONFLICTS.contains(&code) { 409 } else { 400 }, json!({ "error_code": code }))
}

fn code_of(error: Error) -> &'static str {
    error.code().unwrap_or(codes::WRITE_FAILED)
}

/// The secret store entry of an entry's key.
fn key_entry(id: &str) -> String {
    format!("TRANSCRIPTION_CATALOG/{id}")
}

impl Core {
    fn transcription_catalog(&self) -> &Arc<TranscriptionCatalog> {
        &self.ops().transcription_catalog
    }

    /// `{api: [...], protocols}` and `error_code` when the user's file cannot be read. Every
    /// entry has `origin: "user"`, `key_in_memory` (the store did not take its key yet) and
    /// `in_use` (the custom Whisper server engine points at it now).
    pub(crate) fn transcription_catalog_view(&self) -> Value {
        let config = self.config();
        let state = self.transcription_catalog().state();
        let url = config.get_str("TRANSCRIPTION_CUSTOM_URL");
        let model = config.get("SELECTED_CUSTOM_WHISPER_MODEL");
        let keyed = config.get("TRANSCRIPTION_AUTH_KEYS")[ENGINE].as_str().is_some_and(|k| !k.is_empty());
        let api: Vec<Value> = state["entries"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|entry| {
                let mut item = entry.as_object().cloned().unwrap_or_default();
                let same_model = entry["model"] == "" || entry["model"] == model;
                item.insert("origin".into(), json!("user"));
                let in_memory = config.secret_in_memory(&key_entry(entry["id"].as_str().unwrap_or_default()));
                item.insert("key_in_memory".into(), json!(in_memory));
                item.insert("in_use".into(), json!(keyed && entry["url"] == url.as_str() && same_model));
                Value::Object(item)
            })
            .collect();
        let mut view = Map::new();
        view.insert("api".into(), json!(api));
        view.insert("protocols".into(), json!(catalog::PROTOCOLS));
        if let Some(code) = state.get("error_code") {
            view.insert("error_code".into(), code.clone());
        }
        Value::Object(view)
    }

    /// Adds `{name, protocol, url, model, auth_key}`; the key goes to the secret store. When the
    /// store does not take it, the entry is added all the same and its key is held in memory for
    /// this run (reported through `/run/secret_store_failed` and tried again). Nothing is sent to
    /// the address: it is checked when the entry is used.
    fn register_transcription_entry(&self, data: &Value) -> Reply {
        let Some(mut request) = data.as_object().cloned() else { return failure(codes::INVALID) };
        let key = match request.remove("auth_key") {
            Some(Value::String(key)) => Some(key.trim().to_string()).filter(|k| !k.is_empty()),
            None | Some(Value::Null) => None,
            Some(_) => return failure(codes::INVALID),
        };
        // Whether the store holds the key: set once it does (below).
        request.insert("key".into(), json!(false));
        let row = match TranscriptionCatalog::normalize(&Value::Object(request)) {
            Ok(row) => row,
            Err(error) => return failure(code_of(error)),
        };
        if validate_api_url(row["url"].as_str().unwrap_or_default(), false).is_err() {
            return failure(codes::URL_INVALID);
        }
        let Some(key) = key else { return failure(KEY_REQUIRED) };
        let catalog = self.transcription_catalog();
        let id = match catalog.add(row) {
            Ok((id, _)) => id,
            Err(error) => return failure(code_of(error)),
        };
        let (catalog, marked) = (Arc::clone(catalog), id.clone());
        // Recorded for the next start, once the store holds the key (now or later this run).
        let on_stored = Box::new(move || {
            let _ = catalog.set_key(&marked, true);
        });
        if self.config().keep_secret(&key_entry(&id), &key, on_stored) == Kept::InMemory {
            self.step("Speech recognition catalog: the key store did not take an API entry's key; it is held in memory for this run");
        }
        ok(self.transcription_catalog_view())
    }

    /// Forgets `{id}` and its key. The custom Whisper server keeps what it points at.
    fn remove_transcription_entry(&self, data: &Value) -> Reply {
        let Some(id) = data.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("id")).and_then(Value::as_str) else {
            return failure(codes::INVALID);
        };
        if let Err(error) = self.transcription_catalog().remove(data) {
            return failure(code_of(error));
        }
        // Gone from memory now; from the store now or with the tries a deleted setting's key gets
        // (reported through `/run/secret_store_failed`).
        self.config().forget_secret(&key_entry(id));
        ok(self.transcription_catalog_view())
    }

    /// Uses `{id}`: the entry becomes the address, key and model of the custom Whisper server
    /// engine, once the address answers with the key. The engine selected does not change.
    fn use_transcription_entry(self: &Arc<Self>, data: &Value) -> Reply {
        let Some(id) = data.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("id")).and_then(Value::as_str) else {
            return failure(codes::INVALID);
        };
        let entry = match self.transcription_catalog().entry(id) {
            Ok(entry) => entry,
            Err(error) => return failure(code_of(error)),
        };
        if catalog::view(&entry)["status"] != "ok" {
            return failure(UNUSABLE);
        }
        // The key held in memory when the store did not take it, else the store's.
        let key = match self.config().secret(&key_entry(id)) {
            Ok(Some(key)) => key,
            Ok(None) => return failure(KEY_MISSING),
            // Locked or not answering: a temporary failure, not a missing key (ADR-013).
            Err(_) => return failure(KEY_UNREADABLE),
        };
        if self.set_custom_whisper_key_and_url(&json!({ "url": entry["url"], "auth_key": key })).status != 200 {
            return failure(CONNECT_FAILED);
        }
        // The connection chose a model already (the saved one if listed, else the first); the
        // entry's model replaces it when the endpoint lists it.
        let model = entry["model"].as_str().unwrap_or_default();
        let config = self.config();
        let listed = model.is_empty()
            || (config.get("SELECTABLE_CUSTOM_WHISPER_MODEL_LIST").as_array().is_some_and(|list| list.contains(&json!(model)))
                && config.set("SELECTED_CUSTOM_WHISPER_MODEL", json!(model)).is_ok());
        if listed && !model.is_empty() {
            self.notify("selected_custom_whisper_model", json!(model));
        }
        let mut view = self.transcription_catalog_view();
        if !listed {
            view["warning"] = json!(MODEL_NOT_LISTED);
        }
        ok(view)
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/get/data/transcription_catalog", OPEN, |core, _| ok(core.transcription_catalog_view()));
    b.with("/run/register_transcription_catalog_entry", WAIT, |core, data| core.register_transcription_entry(data));
    b.with("/run/remove_transcription_catalog_entry", WAIT, |core, data| core.remove_transcription_entry(data));
    b.with("/run/use_transcription_catalog_entry", WAIT, |core, data| core.use_transcription_entry(data));
}
