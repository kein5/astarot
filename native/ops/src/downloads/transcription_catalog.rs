//! The speech recognition APIs the user adds (#414).
//!
//! The speech recognition page shows its engines in two groups, as the translation catalog does
//! (#413): speech.cpp on this PC, where the user adds a model by registering where its file is
//! (`user_models.rs`, #407), and the APIs, where the user adds an entry by naming its address,
//! its model and its key. This file keeps those API entries: a name, the protocol
//! (`openai_compatible`: a Whisper-compatible `/audio/transcriptions` endpoint, as the custom
//! Whisper server is), the address and the model (empty: the first one the endpoint lists). The
//! key never comes here: the core keeps it in the secret store and this file records only
//! whether the store holds it (`key`: false while the core holds it in memory because the store
//! did not take it).
//!
//! Using an entry points the custom Whisper server engine at it (the core's
//! `controller/transcription_catalog.rs`); an entry is not an engine of its own. The providers
//! the app ships with (Groq, OpenAI, Deepgram) are not in this file.
//!
//! An entry only remembers where an API is: nothing is sent when it is added, and removing it
//! changes no setting. The entries live in `transcription_catalog.json` next to config.json.
//! Names and addresses are the user's own data and are never logged here. A file this version
//! cannot read (a newer format, or edited by hand) is left as it is and never overwritten.

use serde_json::{Value, json};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use super::Error;
use super::translation_catalog::{plain_model, plain_url};
use super::user_models::{valid_name, write_atomically};

pub const FILE_NAME: &str = "transcription_catalog.json";
const FORMAT_VERSION: u64 = 1;
/// The protocols an entry may name in this version.
pub const PROTOCOLS: [&str; 1] = ["openai_compatible"];
const ENTRY_LIMIT: usize = 100;

/// The fixed codes of a refusal, answered as `{"error_code": ...}`.
pub mod codes {
    pub const INVALID: &str = "transcription_catalog_invalid";
    pub const NAME_INVALID: &str = "transcription_catalog_name_invalid";
    pub const URL_INVALID: &str = "transcription_catalog_url_invalid";
    pub const MODEL_INVALID: &str = "transcription_catalog_model_invalid";
    pub const PROTOCOL_UNSUPPORTED: &str = "transcription_catalog_protocol_unsupported";
    pub const EXISTS: &str = "transcription_catalog_exists";
    pub const LIMIT: &str = "transcription_catalog_limit";
    pub const UNKNOWN: &str = "transcription_catalog_unknown";
    pub const UNREADABLE: &str = "transcription_catalog_unreadable";
    pub const WRITE_FAILED: &str = "transcription_catalog_write_failed";
}

/// A protocol: ASCII letters, digits, `_` and `-`, 1 to 32.
fn token(text: &str) -> bool {
    (1..=32).contains(&text.len()) && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn valid_row(row: &Value) -> bool {
    row["id"].as_str().is_some_and(|id| !id.is_empty())
        && row["name"].as_str().is_some_and(valid_name)
        && row["protocol"].as_str().is_some_and(token)
        && row["url"].as_str().is_some_and(plain_url)
        && row["model"].as_str().is_some_and(plain_model)
        && row["key"].is_boolean()
}

/// `ok`, or `unsupported` (a protocol this version does not know).
fn status(row: &Value) -> &'static str {
    if PROTOCOLS.contains(&row["protocol"].as_str().unwrap_or_default()) { "ok" } else { "unsupported" }
}

/// An entry as the UI sees it: the row with its status, and `has_key` in place of `key`.
pub fn view(row: &Value) -> Value {
    let mut view = row.as_object().cloned().unwrap_or_default();
    if let Some(key) = view.remove("key") {
        view.insert("has_key".into(), key);
    }
    view.insert("status".into(), json!(status(row)));
    Value::Object(view)
}

/// Two entries the user could not tell apart: the same name, or the same address and model.
fn same_entry(a: &Value, b: &Value) -> bool {
    a["name"] == b["name"] || (a["url"] == b["url"] && a["model"] == b["model"])
}

/// The entries of one state directory. Every method is safe to call from any thread.
pub struct TranscriptionCatalog {
    path: PathBuf,
    lock: Mutex<()>,
}

impl TranscriptionCatalog {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        TranscriptionCatalog { path: path.into(), lock: Mutex::new(()) }
    }

    fn read(&self) -> Result<Vec<Value>, Error> {
        let text = match fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(Error::Code(codes::UNREADABLE)),
        };
        let data: Value = serde_json::from_str(&text).map_err(|_| Error::Code(codes::UNREADABLE))?;
        match (data["version"].as_u64(), data["entries"].as_array()) {
            // A file of a newer version or edited by hand is left as it is, never overwritten.
            (Some(FORMAT_VERSION), Some(entries)) if entries.iter().all(valid_row) => Ok(entries.clone()),
            _ => Err(Error::Code(codes::UNREADABLE)),
        }
    }

    fn write(&self, entries: Vec<Value>) -> Result<(), Error> {
        let text = serde_json::to_string_pretty(&json!({ "version": FORMAT_VERSION, "entries": entries })).expect("plain JSON");
        write_atomically(&self.path, &text).map_err(|_| Error::Code(codes::WRITE_FAILED))
    }

    /// `{entries: [...]}` as [`view`] shows them, and `error_code` when the file cannot be read.
    pub fn state(&self) -> Value {
        let _held = self.lock.lock().unwrap();
        self.state_locked()
    }

    fn state_locked(&self) -> Value {
        match self.read() {
            Ok(entries) => json!({ "entries": entries.iter().map(view).collect::<Vec<_>>() }),
            Err(error) => json!({ "entries": [], "error_code": error.to_string() }),
        }
    }

    /// The stored entry of an id.
    pub fn entry(&self, id: &str) -> Result<Value, Error> {
        let _held = self.lock.lock().unwrap();
        self.read()?.into_iter().find(|row| row["id"] == id).ok_or(Error::Code(codes::UNKNOWN))
    }

    /// Checks a request and turns it into the row to store (without id and time): exactly
    /// `{name, protocol, url, model, key}`, where `key` says whether the secret store holds a key
    /// for it.
    pub fn normalize(request: &Value) -> Result<Value, Error> {
        let invalid = Error::Code(codes::INVALID);
        let Some(fields) = request.as_object() else { return Err(invalid) };
        let shaped = fields.len() == 5 && ["name", "protocol", "url", "model", "key"].iter().all(|k| fields.contains_key(*k));
        if !shaped {
            return Err(invalid);
        }
        let text = |key: &str| fields.get(key).and_then(Value::as_str);
        let name = text("name").filter(|n| valid_name(n)).ok_or(Error::Code(codes::NAME_INVALID))?;
        let protocol = text("protocol").ok_or(Error::Code(codes::INVALID))?;
        if !PROTOCOLS.contains(&protocol) {
            return Err(Error::Code(codes::PROTOCOL_UNSUPPORTED));
        }
        let url = text("url").filter(|u| plain_url(u)).ok_or(Error::Code(codes::URL_INVALID))?;
        let model = text("model").filter(|m| plain_model(m)).ok_or(Error::Code(codes::MODEL_INVALID))?;
        let key = fields["key"].as_bool().ok_or(Error::Code(codes::INVALID))?;
        Ok(json!({ "name": name, "protocol": protocol, "url": url, "model": model, "key": key }))
    }

    /// Adds a row made by [`TranscriptionCatalog::normalize`] (and checked by the core). Returns
    /// the new entry's id and the state.
    pub fn add(&self, row: Value) -> Result<(String, Value), Error> {
        let Value::Object(mut row) = row else { return Err(Error::Code(codes::INVALID)) };
        let _held = self.lock.lock().unwrap();
        let mut entries = self.read()?;
        if entries.len() >= ENTRY_LIMIT {
            return Err(Error::Code(codes::LIMIT));
        }
        let candidate = Value::Object(row.clone());
        if entries.iter().any(|existing| same_entry(existing, &candidate)) {
            return Err(Error::Code(codes::EXISTS));
        }
        let id = format!("asr-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        row.insert("id".into(), json!(id));
        row.insert("registered_at".into(), json!(super::registered_at(jiff::Timestamp::now())));
        let row = Value::Object(row);
        if !valid_row(&row) {
            return Err(Error::Code(codes::INVALID));
        }
        entries.push(row);
        self.write(entries)?;
        Ok((id, self.state_locked()))
    }

    /// Records whether the secret store holds the key of the entry `id`. An entry that is gone,
    /// or already says so, is left as it is.
    pub fn set_key(&self, id: &str, kept: bool) -> Result<(), Error> {
        let _held = self.lock.lock().unwrap();
        let mut entries = self.read()?;
        let Some(row) = entries.iter_mut().find(|row| row["id"] == id) else { return Ok(()) };
        if row["key"] == kept {
            return Ok(());
        }
        row["key"] = json!(kept);
        self.write(entries)
    }

    /// Forgets `{id}`. Returns the row removed (the core deletes its key) and the state.
    pub fn remove(&self, request: &Value) -> Result<(Value, Value), Error> {
        let Some(id) = request.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("id")).and_then(Value::as_str) else {
            return Err(Error::Code(codes::INVALID));
        };
        let _held = self.lock.lock().unwrap();
        let mut entries = self.read()?;
        let Some(index) = entries.iter().position(|row| row["id"] == id) else { return Err(Error::Code(codes::UNKNOWN)) };
        let removed = entries.remove(index);
        self.write(entries)?;
        Ok((removed, self.state_locked()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, TranscriptionCatalog) {
        let dir = tempfile::tempdir().unwrap();
        let catalog = TranscriptionCatalog::new(dir.path().join(FILE_NAME));
        (dir, catalog)
    }

    fn api(name: &str, url: &str, model: &str) -> Value {
        json!({ "name": name, "protocol": "openai_compatible", "url": url, "model": model, "key": true })
    }

    #[test]
    fn entries_are_added_listed_and_removed() {
        let (dir, catalog) = setup();
        assert_eq!(catalog.state(), json!({ "entries": [] }), "no file: no entry");
        let (first, _) = catalog.add(TranscriptionCatalog::normalize(&api("Home", "http://192.168.1.5:8000/v1", "whisper-large")).unwrap()).unwrap();
        let (second, state) = catalog.add(TranscriptionCatalog::normalize(&api("Work", "https://asr.example.org/v1", "")).unwrap()).unwrap();
        assert!(first.starts_with("asr-") && second.starts_with("asr-") && first != second);
        let entries = state["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!((entries[0]["name"].as_str(), entries[0]["status"].as_str()), (Some("Home"), Some("ok")));
        assert_eq!((entries[1]["has_key"].as_bool(), entries[1].get("key")), (Some(true), None));
        assert!(entries[1]["registered_at"].is_string());
        // Whether the store holds the key.
        catalog.set_key(&second, false).unwrap();
        assert_eq!(catalog.entry(&second).unwrap()["key"], false);
        catalog.set_key("asr-gone", true).unwrap();
        // The file is the entries and their format, and nothing of a key.
        let saved: Value = serde_json::from_str(&fs::read_to_string(dir.path().join(FILE_NAME)).unwrap()).unwrap();
        assert_eq!(saved["version"], 1);
        assert!(!fs::read_to_string(dir.path().join(FILE_NAME)).unwrap().contains("auth_key"));
        let (removed, state) = catalog.remove(&json!({ "id": first })).unwrap();
        assert_eq!(removed["name"], "Home");
        assert_eq!(state["entries"].as_array().unwrap().len(), 1);
        assert_eq!(catalog.remove(&json!({ "id": first })).unwrap_err().code(), Some(codes::UNKNOWN));
        assert_eq!(catalog.entry(&first).unwrap_err().code(), Some(codes::UNKNOWN));
    }

    #[test]
    fn a_request_has_exactly_its_fields_and_plain_values() {
        let code = |request: Value| TranscriptionCatalog::normalize(&request).unwrap_err().code();
        let good = api("Home", "http://127.0.0.1:9000/v1", "");
        assert!(TranscriptionCatalog::normalize(&good).is_ok());
        let mut extra = good.clone();
        extra["auth_key"] = json!("sk-1");
        assert_eq!(code(extra), Some(codes::INVALID), "a key never reaches the file");
        let mut missing = good.clone();
        missing.as_object_mut().unwrap().remove("model");
        assert_eq!(code(missing), Some(codes::INVALID));
        for (field, value, expected) in [
            ("name", json!(""), codes::NAME_INVALID),
            ("name", json!(" padded "), codes::NAME_INVALID),
            ("protocol", json!("deepgram"), codes::PROTOCOL_UNSUPPORTED),
            ("url", json!(""), codes::URL_INVALID),
            ("url", json!("http://a b"), codes::URL_INVALID),
            ("model", json!(" m"), codes::MODEL_INVALID),
            ("key", json!("yes"), codes::INVALID),
        ] {
            let mut request = good.clone();
            request[field] = value;
            assert_eq!(code(request), Some(expected), "{field}");
        }
        assert_eq!(code(json!("Home")), Some(codes::INVALID));
    }

    #[test]
    fn the_same_name_or_the_same_address_and_model_is_refused_and_so_is_the_hundred_and_first() {
        let (_dir, catalog) = setup();
        catalog.add(TranscriptionCatalog::normalize(&api("Home", "http://192.168.1.5:8000/v1", "m")).unwrap()).unwrap();
        for request in [api("Home", "http://192.168.1.6:8000/v1", "m"), api("Other", "http://192.168.1.5:8000/v1", "m")] {
            let error = catalog.add(TranscriptionCatalog::normalize(&request).unwrap()).unwrap_err();
            assert_eq!(error.code(), Some(codes::EXISTS));
        }
        // The same address with another model is another entry.
        catalog.add(TranscriptionCatalog::normalize(&api("Small", "http://192.168.1.5:8000/v1", "s")).unwrap()).unwrap();
        for n in 2..ENTRY_LIMIT {
            catalog.add(TranscriptionCatalog::normalize(&api(&format!("E{n}"), &format!("http://10.0.0.{}/v1", n % 250), &format!("m{n}"))).unwrap()).unwrap();
        }
        let error = catalog.add(TranscriptionCatalog::normalize(&api("Last", "http://10.1.1.1/v1", "z")).unwrap()).unwrap_err();
        assert_eq!(error.code(), Some(codes::LIMIT));
    }

    #[test]
    fn a_file_this_version_cannot_read_is_left_as_it_is() {
        let (dir, catalog) = setup();
        let path = dir.path().join(FILE_NAME);
        for text in ["not JSON", r#"{"version": 2, "entries": []}"#, r#"{"version": 1, "entries": [{"id": "x"}]}"#] {
            fs::write(&path, text).unwrap();
            assert_eq!(catalog.state()["error_code"], codes::UNREADABLE, "{text}");
            let error = catalog.add(TranscriptionCatalog::normalize(&api("Home", "http://127.0.0.1/v1", "")).unwrap()).unwrap_err();
            assert_eq!(error.code(), Some(codes::UNREADABLE));
            assert_eq!(fs::read_to_string(&path).unwrap(), text, "never overwritten");
        }
    }

    #[test]
    fn an_entry_of_a_protocol_this_version_does_not_know_is_shown_as_unsupported() {
        let (dir, catalog) = setup();
        let row = json!({ "id": "asr-new", "name": "New", "protocol": "another_api", "url": "https://x.example/v1", "model": "", "key": true });
        fs::write(dir.path().join(FILE_NAME), serde_json::to_string(&json!({ "version": 1, "entries": [row] })).unwrap()).unwrap();
        assert_eq!(catalog.state()["entries"][0]["status"], "unsupported");
    }
}
