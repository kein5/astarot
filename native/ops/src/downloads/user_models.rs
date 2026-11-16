//! Model files the user registers under a name, listed next to the reviewed catalog
//! (`src-python/models/model_downloads/user_models.py`, #403).
//!
//! A registration only remembers where a file is: nothing is copied, moved, downloaded or
//! deleted, and removing a registration leaves the file alone. Using a registered model is a
//! separate request that writes its paths into the settings through the same checks as applying
//! a download.
//!
//! The registrations live in `user_models.json` next to config.json, in the format Python
//! writes, so either core reads what the other saved. Each file is recorded with its size and
//! modification time (nanoseconds since 1970); a file that is gone or differs is reported as
//! `missing` or `changed` and cannot be used until it is registered again. No SHA-256 is
//! computed. Names and paths are the user's own data and are never logged here.

use serde_json::{Map, Value, json};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use super::Error;

pub const FILE_NAME: &str = "user_models.json";
const FORMAT_VERSION: u64 = 1;
/// The targets a registered file may go to (`catalog::speech_field`, and RVC).
pub const TARGETS: [&str; 6] = ["japanese", "multilingual", "asr", "vad", "diarization", "rvc"];
const NAME_LIMIT: usize = 80;
const PATH_LIMIT: usize = 4096;
const MODEL_LIMIT: usize = 200;

/// The roles a target takes and the suffix of each; `model` is required, the RVC index is not.
pub fn suffixes(target: &str) -> &'static [(&'static str, &'static str)] {
    if target == "rvc" { &[("model", ".pth"), ("index", ".index")] } else { &[("model", ".gguf")] }
}

/// A name as Python's `valid_name`: 1 to 80 characters, no surrounding space, all printable.
pub fn valid_name(name: &str) -> bool {
    let count = name.chars().count();
    name == name.trim() && count > 0 && count <= NAME_LIMIT && name.chars().all(printable)
}

/// Python's `str.isprintable` for the characters a name may hold: no control, format,
/// separator other than the plain space, or unassigned characters. Rust has no Unicode
/// category table in std, so this refuses the categories that matter in practice.
fn printable(ch: char) -> bool {
    !(ch.is_control()
        || matches!(ch, '\u{00AD}' | '\u{061C}' | '\u{180E}' | '\u{200B}'..='\u{200F}' | '\u{2028}'..='\u{202E}' | '\u{2060}'..='\u{206F}' | '\u{FEFF}' | '\u{FFF9}'..='\u{FFFB}')
        || (ch.is_whitespace() && ch != ' '))
}

fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        let norm = |p: &str| p.replace('/', "\\").to_lowercase();
        norm(a) == norm(b)
    } else {
        Path::new(a) == Path::new(b)
    }
}

fn mtime_ns(meta: &fs::Metadata) -> Option<i64> {
    let modified = meta.modified().ok()?;
    Some(match modified.duration_since(UNIX_EPOCH) {
        Ok(after) => i64::try_from(after.as_nanos()).ok()?,
        Err(before) => -i64::try_from(before.duration().as_nanos()).ok()?,
    })
}

/// `{path, size, mtime_ns}` of a regular file (links followed), or `user_model_file_missing`.
fn file_record(path: &str) -> Result<Value, Error> {
    let meta = fs::metadata(path).map_err(|_| Error::Code("user_model_file_missing"))?;
    if !meta.is_file() {
        return Err(Error::Code("user_model_file_missing"));
    }
    let mtime = mtime_ns(&meta).ok_or(Error::Code("user_model_file_missing"))?;
    Ok(json!({ "path": path, "size": meta.len(), "mtime_ns": mtime }))
}

/// `ok`, `missing` or `changed` for one recorded file.
fn file_status(record: &Value) -> &'static str {
    match record["path"].as_str().map(file_record) {
        Some(Ok(current)) if current["size"] == record["size"] && current["mtime_ns"] == record["mtime_ns"] => "ok",
        Some(Ok(_)) => "changed",
        _ => "missing",
    }
}

fn valid_row(row: &Value) -> bool {
    let Some(target) = row["target"].as_str().filter(|t| TARGETS.contains(t)) else { return false };
    let Some(files) = row["files"].as_object() else { return false };
    let roles = suffixes(target);
    row["id"].is_string()
        && row["name"].as_str().is_some_and(valid_name)
        && files.contains_key("model")
        && files.keys().all(|k| roles.iter().any(|(r, _)| r == k))
        && files.values().all(|f| f["path"].is_string() && f["size"].is_u64() && f["mtime_ns"].is_i64())
}

/// The registrations of one state directory. Every method is safe to call from any thread.
pub struct UserModels {
    path: PathBuf,
    lock: Mutex<()>,
}

impl UserModels {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        UserModels { path: path.into(), lock: Mutex::new(()) }
    }

    fn read(&self) -> Result<Vec<Value>, Error> {
        let text = match fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(Error::Code("user_models_unreadable")),
        };
        let data: Value = serde_json::from_str(&text).map_err(|_| Error::Code("user_models_unreadable"))?;
        match (&data["version"], data["models"].as_array()) {
            // A file of a newer version or edited by hand is left as it is, never overwritten.
            (version, Some(models)) if version.as_u64() == Some(FORMAT_VERSION) && models.iter().all(valid_row) => Ok(models.clone()),
            _ => Err(Error::Code("user_models_unreadable")),
        }
    }

    fn write(&self, models: Vec<Value>) -> Result<(), Error> {
        let failed = |_| Error::Code("user_models_write_failed");
        let parent = self.path.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(parent).map_err(failed)?;
        let temporary = parent.join(format!(".{FILE_NAME}.{}.tmp", uuid::Uuid::new_v4().simple()));
        let text = serde_json::to_string_pretty(&json!({ "version": FORMAT_VERSION, "models": models })).expect("plain JSON");
        let result = (|| {
            let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
            output.write_all(text.as_bytes())?;
            output.sync_all()?;
            drop(output);
            fs::rename(&temporary, &self.path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result.map_err(failed)
    }

    fn view(row: &Value) -> Value {
        let files = row["files"].as_object().cloned().unwrap_or_default();
        let statuses: Vec<&str> = files.values().map(file_status).collect();
        let status = if statuses.contains(&"missing") { "missing" } else if statuses.contains(&"changed") { "changed" } else { "ok" };
        let paths: Map<String, Value> = files.iter().map(|(role, f)| (role.clone(), f["path"].clone())).collect();
        let total: u64 = files.values().filter_map(|f| f["size"].as_u64()).sum();
        json!({
            "id": row["id"], "target": row["target"], "name": row["name"], "paths": paths,
            "total_bytes": total, "registered_at": row.get("registered_at").cloned().unwrap_or(Value::Null), "status": status,
        })
    }

    fn state_locked(&self) -> Value {
        match self.read() {
            Ok(models) => json!({ "models": models.iter().map(Self::view).collect::<Vec<_>>() }),
            Err(error) => json!({ "models": [], "error_code": error.to_string() }),
        }
    }

    /// `{models: [{id, target, name, paths, total_bytes, registered_at, status}]}`, and
    /// `error_code` when the file cannot be read.
    pub fn state(&self) -> Value {
        let _held = self.lock.lock().unwrap();
        self.state_locked()
    }

    /// Adds `{target, name, paths: {role: path}}`. The file must exist; it is not opened.
    pub fn register(&self, request: &Value) -> Result<Value, Error> {
        let invalid = Error::Code("user_model_invalid");
        let fields = request.as_object().filter(|o| o.len() == 3 && ["target", "name", "paths"].iter().all(|k| o.contains_key(*k)));
        let Some(fields) = fields else { return Err(invalid) };
        let Some(target) = fields["target"].as_str().filter(|t| TARGETS.contains(t)) else { return Err(invalid) };
        let Some(paths) = fields["paths"].as_object() else { return Err(invalid) };
        let Some(name) = fields["name"].as_str().filter(|n| valid_name(n)) else { return Err(Error::Code("user_model_name_invalid")) };
        let roles = suffixes(target);
        if !paths.contains_key("model") || !paths.keys().all(|k| roles.iter().any(|(r, _)| r == k)) {
            return Err(invalid);
        }
        let mut files = Map::new();
        for (role, path) in paths {
            let Some(path) = path.as_str().filter(|p| !p.is_empty() && p.len() <= PATH_LIMIT && !p.contains('\0') && *p == p.trim() && Path::new(p).is_absolute())
            else {
                return Err(Error::Code("user_model_path_invalid"));
            };
            let suffix = roles.iter().find(|(r, _)| r == role).map(|(_, s)| *s).unwrap_or_default();
            if !path.to_lowercase().ends_with(suffix) {
                return Err(Error::Code("user_model_file_type"));
            }
            files.insert(role.clone(), Value::Null);
        }
        for (role, slot) in files.iter_mut() {
            *slot = file_record(paths[role].as_str().unwrap_or_default())?;
        }
        let model_path = paths["model"].as_str().unwrap_or_default();
        let _held = self.lock.lock().unwrap();
        let mut models = self.read()?;
        if models.len() >= MODEL_LIMIT {
            return Err(Error::Code("user_model_limit"));
        }
        let taken = models.iter().any(|row| {
            row["target"] == target && (row["name"] == name || row["files"]["model"]["path"].as_str().is_some_and(|p| same_path(p, model_path)))
        });
        if taken {
            return Err(Error::Code("user_model_exists"));
        }
        let id = format!("user-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        let registered_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false);
        models.push(json!({ "id": id, "target": target, "name": name, "files": files, "registered_at": registered_at }));
        self.write(models)?;
        Ok(self.state_locked())
    }

    /// Forgets `{id}`. The files stay where they are, and settings that name them keep them.
    pub fn remove(&self, request: &Value) -> Result<Value, Error> {
        let Some(id) = request.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("id")).and_then(Value::as_str) else {
            return Err(Error::Code("user_model_invalid"));
        };
        let _held = self.lock.lock().unwrap();
        let models = self.read()?;
        let count = models.len();
        let kept: Vec<Value> = models.into_iter().filter(|row| row["id"] != id).collect();
        if kept.len() == count {
            return Err(Error::Code("user_model_unknown"));
        }
        self.write(kept)?;
        Ok(self.state_locked())
    }

    /// The target and `[(role, path)]` of a registration whose files are as recorded.
    ///
    /// Errors: `user_model_unknown`, `user_model_missing`, `user_model_changed`.
    pub fn usable(&self, id: &str) -> Result<(String, Vec<(String, String)>), Error> {
        let row = {
            let _held = self.lock.lock().unwrap();
            self.read()?.into_iter().find(|row| row["id"] == id)
        };
        let Some(row) = row else { return Err(Error::Code("user_model_unknown")) };
        let view = Self::view(&row);
        match view["status"].as_str() {
            Some("ok") => {}
            Some("missing") => return Err(Error::Code("user_model_missing")),
            _ => return Err(Error::Code("user_model_changed")),
        }
        let paths = view["paths"].as_object().map(|o| o.iter().map(|(r, p)| (r.clone(), p.as_str().unwrap_or_default().to_string())).collect()).unwrap_or_default();
        Ok((view["target"].as_str().unwrap_or_default().to_string(), paths))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, UserModels, String) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("voice.gguf");
        fs::write(&file, b"GGUF").unwrap();
        let models = UserModels::new(dir.path().join(FILE_NAME));
        (dir, models, file.to_string_lossy().into_owned())
    }

    #[test]
    fn a_registered_file_is_listed_and_usable_until_it_changes() {
        let (_dir, models, file) = setup();
        let state = models.register(&json!({ "target": "japanese", "name": "My voice", "paths": { "model": file } })).unwrap();
        let row = &state["models"][0];
        assert_eq!((row["name"].as_str(), row["status"].as_str(), row["total_bytes"].as_u64()), (Some("My voice"), Some("ok"), Some(4)));
        let id = row["id"].as_str().unwrap().to_string();
        assert!(id.starts_with("user-"));
        assert_eq!(models.usable(&id).unwrap(), ("japanese".to_string(), vec![("model".to_string(), file.clone())]));
        fs::write(&file, b"GGUF but longer").unwrap();
        assert_eq!(models.state()["models"][0]["status"], "changed");
        assert_eq!(models.usable(&id).unwrap_err().to_string(), "user_model_changed");
        fs::remove_file(&file).unwrap();
        assert_eq!(models.state()["models"][0]["status"], "missing");
        models.remove(&json!({ "id": id })).unwrap();
        assert_eq!(models.state()["models"], json!([]));
    }

    #[test]
    fn bad_requests_are_refused_and_change_nothing() {
        let (dir, models, file) = setup();
        let relative = "voice.gguf";
        let cases = [
            (json!({ "target": "ocr", "name": "x", "paths": { "model": file } }), "user_model_invalid"),
            (json!({ "target": "japanese", "name": " x", "paths": { "model": file } }), "user_model_name_invalid"),
            (json!({ "target": "japanese", "name": "a\nb", "paths": { "model": file } }), "user_model_name_invalid"),
            (json!({ "target": "japanese", "name": "x", "paths": { "index": file } }), "user_model_invalid"),
            (json!({ "target": "japanese", "name": "x", "paths": { "model": relative } }), "user_model_path_invalid"),
            (json!({ "target": "rvc", "name": "x", "paths": { "model": file } }), "user_model_file_type"),
            (json!({ "target": "japanese", "name": "x", "paths": { "model": dir.path().join("none.gguf") } }), "user_model_file_missing"),
        ];
        for (request, code) in cases {
            assert_eq!(models.register(&request).unwrap_err().to_string(), code, "{request}");
        }
        assert!(!dir.path().join(FILE_NAME).exists());
        models.register(&json!({ "target": "japanese", "name": "x", "paths": { "model": file } })).unwrap();
        assert_eq!(models.register(&json!({ "target": "japanese", "name": "y", "paths": { "model": file } })).unwrap_err().to_string(), "user_model_exists");
        assert_eq!(models.register(&json!({ "target": "japanese", "name": "x", "paths": { "model": file } })).unwrap_err().to_string(), "user_model_exists");
        // The same file may serve another target.
        models.register(&json!({ "target": "multilingual", "name": "x", "paths": { "model": file } })).unwrap();
        assert_eq!(models.remove(&json!({ "id": "user-none" })).unwrap_err().to_string(), "user_model_unknown");
    }

    #[test]
    fn an_unreadable_file_is_reported_and_never_overwritten() {
        let (dir, models, file) = setup();
        fs::write(dir.path().join(FILE_NAME), b"{ not json").unwrap();
        assert_eq!(models.state()["error_code"], "user_models_unreadable");
        let request = json!({ "target": "japanese", "name": "x", "paths": { "model": file } });
        assert_eq!(models.register(&request).unwrap_err().to_string(), "user_models_unreadable");
        assert_eq!(fs::read(dir.path().join(FILE_NAME)).unwrap(), b"{ not json");
    }
}
