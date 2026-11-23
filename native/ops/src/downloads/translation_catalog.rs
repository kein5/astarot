//! The translation entries the user adds to the translation catalog (#413).
//!
//! The translation catalog has two groups, and the user can add an entry to each in the form
//! that fits it:
//!
//! - **engine**: a model that runs on an inference engine on this PC. The user names where it
//!   is, the runtime that reads it (`onnx`: a folder of `native/translate-onnx`, M2M100 or
//!   NLLB-200, in `folder`; `llamacpp`: one GGUF file of a decoder-only translation LLM such as
//!   TranslateGemma, run by llama.cpp's server, ADR-015, in `file`) and, if they want, the
//!   language codes to offer (none: every language the model lists).
//! - **api**: an API the app calls. The user names the protocol (`openai_compatible`), the
//!   address (this PC, the LAN or the internet) and the model. The key never comes here: the
//!   core keeps it in the secret store and this file records only whether the store holds it
//!   (`key`: false while the core holds it in memory because the store did not take it).
//!
//! The entries the app ships with are not in this file; the core lists them next to these
//! (`controller/translation_catalog.rs`). New runtimes and protocols (MADLAD-400, a
//! decoder-only LLM such as TranslateGemma, another API) are added to [`RUNTIMES`] or
//! [`PROTOCOLS`] when the core can run them. An entry a newer app wrote with one this app does
//! not know stays in the file and is shown as `unsupported`.
//!
//! An entry only remembers where a model or an API is: nothing is copied, moved, downloaded or
//! deleted, and removing an entry leaves the folder alone. The entries live in
//! `translation_catalog.json` next to config.json. Names, folders, files and addresses are the
//! user's own data and are never logged here.
//!
//! The file's format version is 1 while no entry has a `file` (the shape every earlier app
//! reads), and 2 once one does. An app that knows only version 1 then leaves the whole file
//! alone: it reads as unreadable, is never overwritten, and that app lists no added entry until
//! the `llamacpp` entries are removed in a newer app. Removing the last such entry writes
//! version 1 again.

use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::Error;
use super::user_models::{same_path, valid_name, write_atomically};

pub const FILE_NAME: &str = "translation_catalog.json";
/// The format of a file whose entries all have the shape version 1 knew.
const FORMAT_VERSION: u64 = 1;
/// The format once an entry stores a `file` (a `llamacpp` entry). An app that knows only
/// version 1 does not read or overwrite such a file.
const FILE_FORMAT_VERSION: u64 = 2;
/// The two groups of the translation catalog.
pub const GROUPS: [&str; 2] = ["engine", "api"];
/// The runtimes an engine entry may name in this version: the ONNX folders of
/// `native/translate-onnx` (M2M100 and NLLB-200 architectures), and a GGUF file of a
/// decoder-only translation LLM (TranslateGemma) that llama.cpp's server runs (`llamacpp`,
/// ADR-015). A `llamacpp` entry stores the path of that file in `file` (not `folder`), and it
/// may name the device (`device`: `auto`, `cpu` or a Vulkan device such as `Vulkan1`, as the
/// speech servers do).
pub const RUNTIMES: [&str; 2] = ["onnx", "llamacpp"];
/// The runtime whose entry is one GGUF file rather than a folder.
pub const LLAMACPP: &str = "llamacpp";
/// The device a `llamacpp` entry runs on when it names none.
pub const LLAMACPP_DEVICE: &str = "auto";
/// The protocols an API entry may name in this version.
pub const PROTOCOLS: [&str; 1] = ["openai_compatible"];
const PATH_LIMIT: usize = 4096;
const URL_LIMIT: usize = 2048;
const MODEL_LIMIT: usize = 200;
const LANGUAGE_LIMIT: usize = 512;
const ENTRY_LIMIT: usize = 100;

/// The fixed codes of a refusal, answered as `{"error_code": ...}`.
pub mod codes {
    pub const INVALID: &str = "translation_catalog_invalid";
    pub const NAME_INVALID: &str = "translation_catalog_name_invalid";
    pub const PATH_INVALID: &str = "translation_catalog_path_invalid";
    pub const FOLDER_MISSING: &str = "translation_catalog_folder_missing";
    /// A `llamacpp` entry's file is not there, or is not a `.gguf` file.
    pub const FILE_MISSING: &str = "translation_catalog_file_missing";
    /// A `llamacpp` entry's device is not `auto`, `cpu` or a Vulkan device.
    pub const DEVICE_INVALID: &str = "translation_catalog_device_invalid";
    pub const LANGUAGES_INVALID: &str = "translation_catalog_languages_invalid";
    pub const URL_INVALID: &str = "translation_catalog_url_invalid";
    pub const MODEL_INVALID: &str = "translation_catalog_model_invalid";
    pub const RUNTIME_UNSUPPORTED: &str = "translation_catalog_runtime_unsupported";
    pub const PROTOCOL_UNSUPPORTED: &str = "translation_catalog_protocol_unsupported";
    pub const EXISTS: &str = "translation_catalog_exists";
    pub const LIMIT: &str = "translation_catalog_limit";
    pub const UNKNOWN: &str = "translation_catalog_unknown";
    pub const UNREADABLE: &str = "translation_catalog_unreadable";
    pub const WRITE_FAILED: &str = "translation_catalog_write_failed";
}

/// A runtime, protocol or language code: ASCII letters, digits, `_` and `-`, 1 to 32.
fn token(text: &str) -> bool {
    (1..=32).contains(&text.len()) && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A path the user typed: absolute, trimmed, no NUL.
fn plain_path(path: &str) -> bool {
    !path.is_empty() && path.len() <= PATH_LIMIT && !path.contains('\0') && path == path.trim() && Path::new(path).is_absolute()
}

/// A URL as stored: the core checks the address itself (`net_policy`); here only its shape.
pub(super) fn plain_url(url: &str) -> bool {
    !url.is_empty() && url.len() <= URL_LIMIT && !url.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// A model name: empty (chosen later from the list) or up to 200 printable characters.
pub(super) fn plain_model(model: &str) -> bool {
    model.chars().count() <= MODEL_LIMIT && model == model.trim() && !model.chars().any(char::is_control)
}

fn languages_of(value: &Value) -> Option<Vec<String>> {
    let list = value.as_array()?;
    if list.len() > LANGUAGE_LIMIT {
        return None;
    }
    let mut codes: Vec<String> = Vec::with_capacity(list.len());
    for item in list {
        let code = item.as_str().filter(|c| token(c))?;
        if !codes.iter().any(|c| c == code) {
            codes.push(code.to_string());
        }
    }
    Some(codes)
}

/// A device a `llamacpp` entry may name: `auto`, `cpu` or `Vulkan<N>` (one or two digits).
pub fn llamacpp_device(device: &str) -> bool {
    matches!(device, "auto" | "cpu")
        || device.strip_prefix("Vulkan").is_some_and(|digits| (1..=2).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()))
}

/// A path that ends in `.gguf`, in any case.
fn gguf_path(path: &str) -> bool {
    Path::new(path).extension().is_some_and(|extension| extension.eq_ignore_ascii_case("gguf"))
}

fn valid_row(row: &Value) -> bool {
    let common = row["id"].as_str().is_some_and(|id| !id.is_empty()) && row["name"].as_str().is_some_and(valid_name);
    common
        && match row["group"].as_str() {
            Some("engine") => {
                // A `llamacpp` entry has its `file`; every other runtime has its `folder`.
                let (place, other) = if row["runtime"] == LLAMACPP { ("file", "folder") } else { ("folder", "file") };
                row["runtime"].as_str().is_some_and(token)
                    && row[place].as_str().is_some_and(plain_path)
                    && row.get(other).is_none()
                    && languages_of(&row["languages"]).is_some()
                    && (row.get("device").is_none() || row["device"].as_str().is_some_and(token))
            }
            Some("api") => {
                row["protocol"].as_str().is_some_and(token)
                    && row["url"].as_str().is_some_and(plain_url)
                    && row["model"].as_str().is_some_and(plain_model)
                    && row["key"].is_boolean()
            }
            _ => false,
        }
}

/// `ok`, `missing` (the folder, or a `llamacpp` entry's file, is gone) or `unsupported` (a
/// runtime or protocol this version does not know).
fn status(row: &Value) -> &'static str {
    match row["group"].as_str() {
        Some("engine") if !RUNTIMES.contains(&row["runtime"].as_str().unwrap_or_default()) => "unsupported",
        Some("engine") if row["runtime"] == LLAMACPP && !row["file"].as_str().is_some_and(|f| Path::new(f).is_file()) => "missing",
        Some("engine") if row["runtime"] != LLAMACPP && !row["folder"].as_str().is_some_and(|f| Path::new(f).is_dir()) => "missing",
        Some("api") if !PROTOCOLS.contains(&row["protocol"].as_str().unwrap_or_default()) => "unsupported",
        _ => "ok",
    }
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

/// The entries of one state directory. Every method is safe to call from any thread.
pub struct TranslationCatalog {
    path: PathBuf,
    lock: Mutex<()>,
}

impl TranslationCatalog {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        TranslationCatalog { path: path.into(), lock: Mutex::new(()) }
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
            // Version 2, or version 1 when no entry has a `file` (which only version 2 knows).
            (Some(version), Some(entries)) if (version == FILE_FORMAT_VERSION || version == format_version(entries)) && entries.iter().all(valid_row) => Ok(entries.clone()),
            _ => Err(Error::Code(codes::UNREADABLE)),
        }
    }

    fn write(&self, entries: Vec<Value>) -> Result<(), Error> {
        let text = serde_json::to_string_pretty(&json!({ "version": format_version(&entries), "entries": entries })).expect("plain JSON");
        write_atomically(&self.path, &text).map_err(|_| Error::Code(codes::WRITE_FAILED))
    }

    /// Every entry as stored (the key flag included), in the order they were added. A file that
    /// cannot be read gives none.
    pub fn rows(&self) -> Vec<Value> {
        let _held = self.lock.lock().unwrap();
        self.read().unwrap_or_default()
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

    /// Checks a request and turns it into the row to store (without id and time).
    ///
    /// Engine: exactly `{group, name, runtime, folder}` and, optionally, `languages`; a
    /// `llamacpp` entry has `file` (a `.gguf` file) in place of `folder` and may also name its
    /// `device`.
    /// API: exactly `{group, name, protocol, url, model, key}`, where `key` says whether the
    /// secret store holds a key for it.
    pub fn normalize(request: &Value) -> Result<Value, Error> {
        let invalid = Error::Code(codes::INVALID);
        let Some(fields) = request.as_object() else { return Err(invalid) };
        let text = |key: &str| fields.get(key).and_then(Value::as_str);
        let has_only = |required: &[&str], optional: &[&str]| {
            required.iter().all(|k| fields.contains_key(*k)) && fields.keys().all(|k| required.contains(&k.as_str()) || optional.contains(&k.as_str()))
        };
        let group = text("group").filter(|g| GROUPS.contains(g)).ok_or(Error::Code(codes::INVALID))?;
        let llamacpp = text("runtime") == Some(LLAMACPP);
        let shaped = match group {
            "engine" if llamacpp => has_only(&["group", "name", "runtime", "file"], &["languages", "device"]),
            "engine" => has_only(&["group", "name", "runtime", "folder"], &["languages"]),
            _ => has_only(&["group", "name", "protocol", "url", "model", "key"], &[]),
        };
        if !shaped {
            return Err(invalid);
        }
        let name = text("name").filter(|n| valid_name(n)).ok_or(Error::Code(codes::NAME_INVALID))?;
        if group == "engine" {
            let runtime = text("runtime").ok_or(Error::Code(codes::INVALID))?;
            if !RUNTIMES.contains(&runtime) {
                return Err(Error::Code(codes::RUNTIME_UNSUPPORTED));
            }
            let place = if llamacpp { "file" } else { "folder" };
            let path = text(place).filter(|f| plain_path(f)).ok_or(Error::Code(codes::PATH_INVALID))?;
            if llamacpp {
                if !gguf_path(path) || !Path::new(path).is_file() {
                    return Err(Error::Code(codes::FILE_MISSING));
                }
            } else if !Path::new(path).is_dir() {
                return Err(Error::Code(codes::FOLDER_MISSING));
            }
            let languages = match fields.get("languages") {
                None | Some(Value::Null) => Vec::new(),
                Some(value) => languages_of(value).ok_or(Error::Code(codes::LANGUAGES_INVALID))?,
            };
            let mut row = json!({ "group": group, "name": name, "runtime": runtime, "languages": languages });
            row[place] = json!(path);
            if llamacpp {
                let device = match fields.get("device") {
                    None | Some(Value::Null) => LLAMACPP_DEVICE,
                    Some(value) => value.as_str().filter(|d| llamacpp_device(d)).ok_or(Error::Code(codes::DEVICE_INVALID))?,
                };
                row["device"] = json!(device);
            }
            return Ok(row);
        }
        let protocol = text("protocol").ok_or(Error::Code(codes::INVALID))?;
        if !PROTOCOLS.contains(&protocol) {
            return Err(Error::Code(codes::PROTOCOL_UNSUPPORTED));
        }
        let url = text("url").filter(|u| plain_url(u)).ok_or(Error::Code(codes::URL_INVALID))?;
        let model = text("model").filter(|m| plain_model(m)).ok_or(Error::Code(codes::MODEL_INVALID))?;
        let key = fields["key"].as_bool().ok_or(Error::Code(codes::INVALID))?;
        Ok(json!({ "group": group, "name": name, "protocol": protocol, "url": url, "model": model, "key": key }))
    }

    /// Adds a row made by [`TranslationCatalog::normalize`] (and checked by the core). Returns the
    /// new entry's id and the state.
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
        let id = format!("tr-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
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

    /// Records whether the secret store holds the key of the API entry `id`. An entry that is
    /// gone, or already says so, is left as it is.
    pub fn set_key(&self, id: &str, kept: bool) -> Result<(), Error> {
        let _held = self.lock.lock().unwrap();
        let mut entries = self.read()?;
        let Some(row) = entries.iter_mut().find(|row| row["id"] == id && row["group"] == "api") else { return Ok(()) };
        if row["key"] == kept {
            return Ok(());
        }
        row["key"] = json!(kept);
        self.write(entries)
    }

    /// Forgets `{id}`. Returns the row removed (the core deletes its key) and the state. The
    /// folder stays where it is.
    pub fn remove(&self, request: &Value) -> Result<(Value, Value), Error> {
        let Some(id) = request.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("id")).and_then(Value::as_str) else {
            return Err(Error::Code(codes::INVALID));
        };
        let _held = self.lock.lock().unwrap();
        let entries = self.read()?;
        let Some(index) = entries.iter().position(|row| row["id"] == id) else { return Err(Error::Code(codes::UNKNOWN)) };
        let mut kept = entries;
        let removed = kept.remove(index);
        self.write(kept)?;
        Ok((removed, self.state_locked()))
    }
}

/// The version a file of these entries is written as, and must say to be read: 2 once an entry
/// stores a `file`, else 1.
fn format_version(entries: &[Value]) -> u64 {
    if entries.iter().any(|row| row.get("file").is_some()) { FILE_FORMAT_VERSION } else { FORMAT_VERSION }
}

/// Where an engine entry's model is: its `file`, or its `folder`.
fn place_of(row: &Value) -> Option<&str> {
    row["file"].as_str().or_else(|| row["folder"].as_str())
}

/// Two entries the user could not tell apart: the same name in a group, the same folder or
/// file, or the same address and model.
fn same_entry(a: &Value, b: &Value) -> bool {
    if a["group"] != b["group"] {
        return false;
    }
    if a["name"] == b["name"] {
        return true;
    }
    match a["group"].as_str() {
        Some("engine") => matches!((place_of(a), place_of(b)), (Some(x), Some(y)) if same_path(x, y)),
        _ => a["url"] == b["url"] && a["model"] == b["model"],
    }
}

/// The language codes an engine entry offers out of the model's own: all of them when the
/// entry names none, else the entry's codes the model has, in the model's order.
pub fn offered_languages(entry: &Value, model: &[String]) -> Vec<String> {
    let chosen: Vec<&str> = entry["languages"].as_array().map(|l| l.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    model.iter().filter(|code| chosen.is_empty() || chosen.contains(&code.as_str())).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, TranslationCatalog, String) {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("my-model");
        fs::create_dir(&folder).unwrap();
        let catalog = TranslationCatalog::new(dir.path().join(FILE_NAME));
        (dir, catalog, folder.to_string_lossy().into_owned())
    }

    fn engine(name: &str, folder: &str) -> Value {
        json!({ "group": "engine", "name": name, "runtime": "onnx", "folder": folder, "languages": ["ja", "en", "ja"] })
    }

    fn api(name: &str, url: &str) -> Value {
        json!({ "group": "api", "name": name, "protocol": "openai_compatible", "url": url, "model": "qwen", "key": true })
    }

    #[test]
    fn entries_of_both_groups_are_added_listed_and_removed() {
        let (_dir, catalog, folder) = setup();
        let (engine_id, _) = catalog.add(TranslationCatalog::normalize(&engine("Mine", &folder)).unwrap()).unwrap();
        let (api_id, state) = catalog.add(TranslationCatalog::normalize(&api("LAN", "http://192.168.1.5:8000/v1")).unwrap()).unwrap();
        assert!(engine_id.starts_with("tr-") && api_id.starts_with("tr-") && engine_id != api_id);
        let entries = state["entries"].as_array().unwrap();
        assert_eq!(entries[0]["languages"], json!(["ja", "en"]), "duplicate codes are dropped");
        assert_eq!(entries[0]["status"], "ok");
        assert_eq!((entries[1]["has_key"].as_bool(), entries[1].get("key")), (Some(true), None));
        assert_eq!(catalog.entry(&api_id).unwrap()["key"], true);
        // Whether the store holds the key: changed for an API entry only.
        catalog.set_key(&api_id, false).unwrap();
        assert_eq!(catalog.entry(&api_id).unwrap()["key"], false);
        assert_eq!(catalog.state()["entries"][1]["has_key"], false);
        catalog.set_key(&api_id, true).unwrap();
        assert_eq!(catalog.entry(&api_id).unwrap()["key"], true);
        catalog.set_key(&engine_id, false).unwrap();
        assert!(catalog.entry(&engine_id).unwrap().get("key").is_none(), "an engine entry has no key");
        catalog.set_key("tr-gone", false).unwrap();
        let (removed, state) = catalog.remove(&json!({ "id": engine_id })).unwrap();
        assert_eq!(removed["name"], "Mine");
        assert_eq!(state["entries"].as_array().unwrap().len(), 1);
        assert!(Path::new(&folder).is_dir(), "the folder is left alone");
        assert_eq!(catalog.remove(&json!({ "id": engine_id })).unwrap_err().to_string(), codes::UNKNOWN);
    }

    #[test]
    fn bad_requests_are_refused_and_write_nothing() {
        let (dir, _catalog, folder) = setup();
        let gone = dir.path().join("gone").to_string_lossy().into_owned();
        let cases = [
            (json!({ "group": "other", "name": "x" }), codes::INVALID),
            (json!({ "group": "engine", "name": "x", "runtime": "onnx", "folder": folder, "extra": 1 }), codes::INVALID),
            (json!({ "group": "engine", "name": " x", "runtime": "onnx", "folder": folder }), codes::NAME_INVALID),
            (json!({ "group": "engine", "name": "x", "runtime": "gguf", "folder": folder }), codes::RUNTIME_UNSUPPORTED),
            (json!({ "group": "engine", "name": "x", "runtime": "onnx", "folder": "relative" }), codes::PATH_INVALID),
            (json!({ "group": "engine", "name": "x", "runtime": "onnx", "folder": gone }), codes::FOLDER_MISSING),
            (json!({ "group": "engine", "name": "x", "runtime": "onnx", "folder": folder, "languages": ["ja", "a b"] }), codes::LANGUAGES_INVALID),
            (json!({ "group": "api", "name": "x", "protocol": "deepl", "url": "https://a", "model": "", "key": false }), codes::PROTOCOL_UNSUPPORTED),
            (json!({ "group": "api", "name": "x", "protocol": "openai_compatible", "url": "http://a b", "model": "", "key": false }), codes::URL_INVALID),
            (json!({ "group": "api", "name": "x", "protocol": "openai_compatible", "url": "https://a", "model": "a\nb", "key": false }), codes::MODEL_INVALID),
            (json!({ "group": "api", "name": "x", "protocol": "openai_compatible", "url": "https://a", "model": "", "key": "yes" }), codes::INVALID),
            (json!({ "group": "api", "name": "x", "protocol": "openai_compatible", "url": "https://a", "model": "", "key": true, "auth_key": "k" }), codes::INVALID),
        ];
        for (request, code) in cases {
            assert_eq!(TranslationCatalog::normalize(&request).unwrap_err().to_string(), code, "{request}");
        }
        assert!(!dir.path().join(FILE_NAME).exists());
    }

    #[test]
    fn the_same_name_folder_or_address_is_refused_in_a_group() {
        let (_dir, catalog, folder) = setup();
        catalog.add(TranslationCatalog::normalize(&engine("Mine", &folder)).unwrap()).unwrap();
        let again = |request: Value| catalog.add(TranslationCatalog::normalize(&request).unwrap()).unwrap_err().to_string();
        assert_eq!(again(engine("Other", &folder)), codes::EXISTS);
        assert_eq!(again(engine("Mine", &folder)), codes::EXISTS);
        catalog.add(TranslationCatalog::normalize(&api("Mine", "https://example.com/v1")).unwrap()).unwrap();
        assert_eq!(again(api("Other", "https://example.com/v1")), codes::EXISTS);
        catalog.add(TranslationCatalog::normalize(&json!({ "group": "api", "name": "Other model", "protocol": "openai_compatible", "url": "https://example.com/v1", "model": "llama", "key": false })).unwrap()).unwrap();
    }

    #[test]
    fn a_missing_folder_and_an_unknown_runtime_are_shown_not_dropped() {
        let (dir, catalog, folder) = setup();
        catalog.add(TranslationCatalog::normalize(&engine("Mine", &folder)).unwrap()).unwrap();
        fs::remove_dir(&folder).unwrap();
        assert_eq!(catalog.state()["entries"][0]["status"], "missing");
        // What a newer app may write: a runtime this one does not know.
        let mut rows = catalog.rows();
        rows.push(json!({ "id": "tr-new", "group": "engine", "name": "Gemma", "runtime": "gguf", "folder": folder, "languages": [], "registered_at": null }));
        catalog.write(rows).unwrap();
        let state = catalog.state();
        assert_eq!(state["entries"][1]["status"], "unsupported");
        assert!(state.get("error_code").is_none());
        fs::write(dir.path().join(FILE_NAME), b"{ not json").unwrap();
        assert_eq!(catalog.state()["error_code"], codes::UNREADABLE);
        assert_eq!(catalog.add(TranslationCatalog::normalize(&api("x", "https://a")).unwrap()).unwrap_err().to_string(), codes::UNREADABLE);
        assert_eq!(fs::read(dir.path().join(FILE_NAME)).unwrap(), b"{ not json");
    }

    #[test]
    fn a_llamacpp_entry_is_one_gguf_file_with_its_device() {
        let (dir, catalog, folder) = setup();
        let file = Path::new(&folder).join("translategemma-4b-it.Q4_K_M.GGUF");
        fs::write(&file, b"GGUF").unwrap();
        let file = file.to_string_lossy().into_owned();
        let entry = |extra: Value| {
            let mut request = json!({ "group": "engine", "name": "TranslateGemma", "runtime": "llamacpp", "file": file, "languages": ["ja", "en"] });
            for (key, value) in extra.as_object().unwrap() {
                request[key] = value.clone();
            }
            request
        };
        // Without a device, the one the speech servers would take.
        let row = TranslationCatalog::normalize(&entry(json!({}))).unwrap();
        assert_eq!(row["device"], "auto");
        for device in ["cpu", "Vulkan0", "Vulkan12"] {
            assert_eq!(TranslationCatalog::normalize(&entry(json!({ "device": device }))).unwrap()["device"], device);
        }
        for device in [json!("Vulkan"), json!("Vulkan123"), json!("cuda"), json!(1)] {
            assert_eq!(TranslationCatalog::normalize(&entry(json!({ "device": device }))).unwrap_err().to_string(), codes::DEVICE_INVALID, "{device}");
        }
        // The file must be there and be a GGUF file; a folder is not one.
        for path in [folder.clone(), dir.path().join("gone.gguf").to_string_lossy().into_owned()] {
            assert_eq!(TranslationCatalog::normalize(&entry(json!({ "file": path }))).unwrap_err().to_string(), codes::FILE_MISSING);
        }
        let other = Path::new(&folder).join("model.bin");
        fs::write(&other, b"GGUF").unwrap();
        assert_eq!(TranslationCatalog::normalize(&entry(json!({ "file": other.to_string_lossy() }))).unwrap_err().to_string(), codes::FILE_MISSING);
        // The file goes in `file`: `folder` is not a field of a `llamacpp` entry, nor `file` of an ONNX one.
        let mut in_folder = entry(json!({}));
        in_folder.as_object_mut().unwrap().remove("file");
        in_folder["folder"] = json!(file);
        assert_eq!(TranslationCatalog::normalize(&in_folder).unwrap_err().to_string(), codes::INVALID);
        let onnx_file = json!({ "group": "engine", "name": "x", "runtime": "onnx", "folder": folder, "file": file });
        assert_eq!(TranslationCatalog::normalize(&onnx_file).unwrap_err().to_string(), codes::INVALID);
        // An ONNX entry names no device.
        let onnx = json!({ "group": "engine", "name": "x", "runtime": "onnx", "folder": folder, "device": "cpu" });
        assert_eq!(TranslationCatalog::normalize(&onnx).unwrap_err().to_string(), codes::INVALID);
        // Stored, listed and shown missing once the file goes; the same file twice is refused.
        assert_eq!((row["file"].as_str(), row.get("folder")), (Some(file.as_str()), None));
        let (id, state) = catalog.add(row).unwrap();
        assert_eq!((state["entries"][0]["status"].as_str(), state["entries"][0]["device"].as_str()), (Some("ok"), Some("auto")));
        assert_eq!(catalog.add(TranslationCatalog::normalize(&entry(json!({ "name": "Again" }))).unwrap()).unwrap_err().to_string(), codes::EXISTS);
        fs::remove_file(&file).unwrap();
        assert_eq!(catalog.state()["entries"][0]["status"], "missing");
        assert_eq!(catalog.entry(&id).unwrap()["runtime"], LLAMACPP);
    }

    fn version_on_disk(dir: &Path) -> Value {
        serde_json::from_str::<Value>(&fs::read_to_string(dir.join(FILE_NAME)).unwrap()).unwrap()["version"].clone()
    }

    #[test]
    fn the_file_is_version_2_only_while_it_holds_a_llamacpp_entry() {
        let (dir, catalog, folder) = setup();
        let (onnx, _) = catalog.add(TranslationCatalog::normalize(&engine("Mine", &folder)).unwrap()).unwrap();
        // ONNX and API entries keep the shape every earlier app reads.
        assert_eq!(version_on_disk(dir.path()), 1);
        let gguf = Path::new(&folder).join("translategemma.gguf");
        fs::write(&gguf, b"GGUF").unwrap();
        let request = json!({ "group": "engine", "name": "TG", "runtime": "llamacpp", "file": gguf.to_string_lossy() });
        let (llama, _) = catalog.add(TranslationCatalog::normalize(&request).unwrap()).unwrap();
        assert_eq!(version_on_disk(dir.path()), 2);
        assert_eq!(catalog.rows().len(), 2, "this app reads its own version 2");
        // What an app that knows only version 1 does with it: reads it as unreadable and leaves
        // it alone (its `read` asks for version 1). The file says 2, so nothing older takes it.
        let text = fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(text.contains("\"version\": 2") && text.contains("\"file\""));
        // A version-1 file with a `file` entry was not written by any app: it is not read.
        let mut data: Value = serde_json::from_str(&text).unwrap();
        data["version"] = json!(1);
        fs::write(dir.path().join(FILE_NAME), serde_json::to_string(&data).unwrap()).unwrap();
        assert_eq!(catalog.state()["error_code"], codes::UNREADABLE);
        fs::write(dir.path().join(FILE_NAME), &text).unwrap();
        // Removing the last `llamacpp` entry writes version 1 again, for the older app.
        catalog.remove(&json!({ "id": llama })).unwrap();
        assert_eq!(version_on_disk(dir.path()), 1);
        catalog.remove(&json!({ "id": onnx })).unwrap();
        assert_eq!(version_on_disk(dir.path()), 1);
        // A version-2 file without one is read, and written back as version 1.
        fs::write(dir.path().join(FILE_NAME), json!({ "version": 2, "entries": [] }).to_string()).unwrap();
        assert!(catalog.state().get("error_code").is_none());
        catalog.add(TranslationCatalog::normalize(&engine("Mine", &folder)).unwrap()).unwrap();
        assert_eq!(version_on_disk(dir.path()), 1);
        fs::write(dir.path().join(FILE_NAME), json!({ "version": 3, "entries": [] }).to_string()).unwrap();
        assert_eq!(catalog.state()["error_code"], codes::UNREADABLE);
    }

    #[test]
    fn an_entry_offers_its_languages_out_of_the_model() {
        let model: Vec<String> = ["en", "ja", "ko"].iter().map(|s| s.to_string()).collect();
        assert_eq!(offered_languages(&json!({ "languages": [] }), &model), model);
        assert_eq!(offered_languages(&json!({ "languages": ["ko", "ja", "xx"] }), &model), vec!["ja".to_string(), "ko".to_string()]);
    }

    /// A stored row with every field this version checks when it reads the file.
    fn stored_engine(folder: &str) -> Value {
        json!({ "id": "tr-engine", "group": "engine", "name": "Mine", "runtime": "onnx", "folder": folder, "languages": ["ja", "en"] })
    }

    fn stored_api() -> Value {
        json!({ "id": "tr-api", "group": "api", "name": "LAN", "protocol": "openai_compatible", "url": "http://192.168.1.5:8000/v1", "model": "qwen", "key": true })
    }

    #[test]
    fn a_file_with_a_row_this_version_cannot_trust_is_not_read_and_stays_as_it_was() {
        let (dir, catalog, folder) = setup();
        let path = dir.path().join(FILE_NAME);
        let write = |rows: Vec<Value>| fs::write(&path, serde_json::to_string(&json!({ "version": 1, "entries": rows })).unwrap()).unwrap();
        write(vec![stored_engine(&folder), stored_api()]);
        assert_eq!(catalog.rows().len(), 2, "the file as written is read");
        let mut broken = Vec::new();
        for (field, value) in [
            ("id", json!("")), ("id", json!(1)), ("name", json!("")), ("name", json!(" padded")), ("group", json!("other")),
            ("runtime", json!("has space")), ("folder", json!("relative/path")), ("languages", json!(["ja", "not a code"])),
            ("languages", json!("ja")), ("device", json!("")), ("file", json!("/also/a/file.gguf")),
        ] {
            let mut row = stored_engine(&folder);
            row[field] = value.clone();
            broken.push((format!("engine {field}={value}"), row));
        }
        for (field, value) in [("protocol", json!("")), ("url", json!("http://a b")), ("url", json!("")), ("model", json!(" qwen")), ("key", json!("yes"))] {
            let mut row = stored_api();
            row[field] = value.clone();
            broken.push((format!("api {field}={value}"), row));
        }
        for (why, row) in broken {
            write(vec![stored_engine(&folder), row]);
            let before = fs::read(&path).unwrap();
            assert_eq!(catalog.state()["error_code"], codes::UNREADABLE, "{why}");
            assert_eq!(catalog.add(TranslationCatalog::normalize(&engine("Other", &folder)).unwrap()).unwrap_err().to_string(), codes::UNREADABLE, "{why}");
            assert_eq!(fs::read(&path).unwrap(), before, "{why}: never overwritten");
        }
        // A file that cannot be read at all is not an empty catalog either; only no file is.
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(catalog.state()["error_code"], codes::UNREADABLE);
        fs::remove_dir(&path).unwrap();
        assert_eq!(catalog.state(), json!({ "entries": [] }));
    }

    #[test]
    fn an_api_entry_of_a_protocol_this_version_does_not_know_is_shown_as_unsupported() {
        assert_eq!(view(&stored_api())["status"], "ok");
        let mut newer = stored_api();
        newer["protocol"] = json!("some_newer_protocol");
        assert_eq!(view(&newer)["status"], "unsupported");
    }

    #[test]
    fn up_to_the_limit_of_language_codes_are_kept() {
        let codes: Vec<String> = (0..LANGUAGE_LIMIT).map(|i| format!("l{i}")).collect();
        assert_eq!(languages_of(&json!(codes)).map(|kept| kept.len()), Some(LANGUAGE_LIMIT));
        let one_more: Vec<String> = (0..=LANGUAGE_LIMIT).map(|i| format!("l{i}")).collect();
        assert_eq!(languages_of(&json!(one_more)), None);
        assert_eq!(languages_of(&json!([])), Some(Vec::new()));
    }
}

