//! Where the API keys live: a store of their own, never `config.json`.
//!
//! The settings named in [`SECRET_SETTINGS`] stay ordinary settings in memory (the endpoints read
//! and change them as before), but their values are written to a [`SecretStore`] instead of
//! `config.json`. Each value is one entry: `AUTH_KEYS/DeepL_API` for a provider of a map of keys,
//! the setting's own name for a single string. A provider added to one of the maps' defaults is
//! kept the same way without more code; a new setting that holds a key only needs its name in
//! [`SECRET_SETTINGS`].
//!
//! The store of the app is [`FileStore`]: `secrets.json` next to `config.json`. On Windows its
//! entries are encrypted for the signed-in user with DPAPI (`CryptProtectData`); on Linux the file
//! is readable by its owner only (0600). Tests use a [`MemoryStore`]. Whether to move to the OS
//! credential stores (Windows Credential Manager, the Secret Service on Linux) is open:
//! `docs/voice-stack/core-integration.md`, "判断が要ること".
//!
//! Nothing here logs or returns a key in an error: an error names its reason only.

use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// The settings whose values are keys: kept in the store, never in `config.json`.
pub const SECRET_SETTINGS: [&str; 2] = ["AUTH_KEYS", "TRANSCRIPTION_AUTH_KEYS"];

/// Why the store failed. Never carries a key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreError {
    /// The store could not be read, or what it holds could not be decoded or decrypted.
    Unreadable,
    /// The store could not be written.
    WriteFailed,
}

impl StoreError {
    pub fn as_str(self) -> &'static str {
        match self {
            StoreError::Unreadable => "unreadable",
            StoreError::WriteFailed => "write_failed",
        }
    }
}

/// A place for keys, one string per entry name.
pub trait SecretStore: Send + Sync {
    /// What the store is, for the error notification (`"file"`, `"memory"`).
    fn kind(&self) -> &'static str;
    fn read(&self, entry: &str) -> Result<Option<String>, StoreError>;
    fn write(&self, entry: &str, value: &str) -> Result<(), StoreError>;
    /// Removing an entry that is not there succeeds.
    fn delete(&self, entry: &str) -> Result<(), StoreError>;
}

/// Makes the store for the settings' environment (a [`crate::controller::Services`] field).
pub type StoreSource = Arc<dyn Fn(&super::Environment) -> Arc<dyn SecretStore> + Send + Sync>;

/// The app's store: `secrets.json` in the settings folder.
pub fn default_store(env: &super::Environment) -> Arc<dyn SecretStore> {
    Arc::new(FileStore::new(env.state_dir.join(FILE_NAME)))
}

pub const FILE_NAME: &str = "secrets.json";

/// Writes an entry and reads it back; only a value read back counts as kept.
pub fn write_verified(store: &dyn SecretStore, entry: &str, value: &str) -> Result<(), StoreError> {
    store.write(entry, value)?;
    match store.read(entry)? {
        Some(read) if read == value => Ok(()),
        _ => Err(StoreError::WriteFailed),
    }
}

/// The entries of a secret setting's value: `(entry, value)`, `None` where no key is set.
pub fn entries(name: &str, value: &Value) -> Vec<(String, Option<String>)> {
    match value {
        Value::Object(map) => map.iter().map(|(provider, v)| (format!("{name}/{provider}"), v.as_str().map(str::to_string))).collect(),
        Value::String(s) => vec![(name.to_string(), Some(s.clone()))],
        _ => vec![(name.to_string(), None)],
    }
}

/// The value with one entry replaced (the inverse of [`entries`]).
pub fn with_entry(name: &str, value: &Value, entry: &str, new: Option<&str>) -> Value {
    let new = new.map_or(Value::Null, |s| Value::String(s.to_string()));
    match value {
        Value::Object(map) => {
            let mut map = map.clone();
            if let Some(provider) = entry.strip_prefix(name).and_then(|rest| rest.strip_prefix('/'))
                && map.contains_key(provider)
            {
                map.insert(provider.to_string(), new);
            }
            Value::Object(map)
        }
        _ if entry == name => new,
        _ => value.clone(),
    }
}

/// The part of a secret setting `config.json` still holds: only the entries named in `kept`
/// (keys the store could not take yet). `None` leaves the setting out of the file.
pub fn file_value(name: &str, value: &Value, kept: &std::collections::BTreeSet<String>) -> Option<Value> {
    match value {
        Value::Object(map) => {
            let left: Map<String, Value> = map
                .iter()
                .filter(|(provider, v)| v.is_string() && kept.contains(&format!("{name}/{provider}")))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            (!left.is_empty()).then_some(Value::Object(left))
        }
        Value::String(_) if kept.contains(name) => Some(value.clone()),
        _ => None,
    }
}

/// Keys in memory, for tests and for hosts that keep nothing. It can be told to fail.
#[derive(Default)]
pub struct MemoryStore {
    entries: Mutex<BTreeMap<String, String>>,
    faults: Mutex<Faults>,
}

/// What a [`MemoryStore`] does wrong, to test the failures.
#[derive(Clone, Copy, Debug, Default)]
pub struct Faults {
    pub read: bool,
    pub write: bool,
    pub delete: bool,
    /// Writes answer success but keep nothing (caught by reading back).
    pub lose_writes: bool,
}

impl MemoryStore {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// A [`StoreSource`] that always hands out this store.
    pub fn source(self: &Arc<Self>) -> StoreSource {
        let store = Arc::clone(self);
        Arc::new(move |_| Arc::clone(&store) as Arc<dyn SecretStore>)
    }

    pub fn set_faults(&self, faults: Faults) {
        *self.faults.lock().unwrap() = faults;
    }

    /// Every entry, as kept.
    pub fn snapshot(&self) -> BTreeMap<String, String> {
        self.entries.lock().unwrap().clone()
    }

    pub fn get(&self, entry: &str) -> Option<String> {
        self.entries.lock().unwrap().get(entry).cloned()
    }

    pub fn insert(&self, entry: &str, value: &str) {
        self.entries.lock().unwrap().insert(entry.to_string(), value.to_string());
    }
}

impl SecretStore for MemoryStore {
    fn kind(&self) -> &'static str {
        "memory"
    }

    fn read(&self, entry: &str) -> Result<Option<String>, StoreError> {
        if self.faults.lock().unwrap().read {
            return Err(StoreError::Unreadable);
        }
        Ok(self.get(entry))
    }

    fn write(&self, entry: &str, value: &str) -> Result<(), StoreError> {
        let faults = *self.faults.lock().unwrap();
        if faults.write {
            return Err(StoreError::WriteFailed);
        }
        if !faults.lose_writes {
            self.insert(entry, value);
        }
        Ok(())
    }

    fn delete(&self, entry: &str) -> Result<(), StoreError> {
        if self.faults.lock().unwrap().delete {
            return Err(StoreError::WriteFailed);
        }
        self.entries.lock().unwrap().remove(entry);
        Ok(())
    }
}

/// `secrets.json`: `{"version": 1, "protection": ..., "entries": ...}`. With `"dpapi"` (Windows)
/// `entries` is the base64 of the DPAPI-encrypted JSON object of the entries; with `"none"`
/// (Linux, where the file is 0600) it is the object itself. Written like `config.json`: a new
/// temporary file, flushed, renamed over the old one.
pub struct FileStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl FileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path, lock: Mutex::new(()) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn read_all(&self) -> Result<Map<String, Value>, StoreError> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Map::new()),
            Err(_) => return Err(StoreError::Unreadable),
        };
        let file: Value = serde_json::from_slice(&bytes).map_err(|_| StoreError::Unreadable)?;
        if file["version"] != 1 {
            return Err(StoreError::Unreadable);
        }
        match (file["protection"].as_str(), &file["entries"]) {
            (Some("none"), Value::Object(entries)) => Ok(entries.clone()),
            (Some("dpapi"), Value::String(encoded)) => {
                use base64::Engine;
                let sealed = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| StoreError::Unreadable)?;
                let plain = protect::open(&sealed).ok_or(StoreError::Unreadable)?;
                match serde_json::from_slice(&plain) {
                    Ok(Value::Object(entries)) => Ok(entries),
                    _ => Err(StoreError::Unreadable),
                }
            }
            _ => Err(StoreError::Unreadable),
        }
    }

    fn write_all(&self, entries: &Map<String, Value>) -> Result<(), StoreError> {
        let body = if protect::AVAILABLE {
            use base64::Engine;
            let plain = serde_json::to_vec(entries).expect("writing to memory does not fail");
            let sealed = protect::seal(&plain).ok_or(StoreError::WriteFailed)?;
            json!({ "version": 1, "protection": "dpapi", "entries": base64::engine::general_purpose::STANDARD.encode(sealed) })
        } else {
            json!({ "version": 1, "protection": "none", "entries": entries })
        };
        let text = super::to_python_json(&body);
        write_private(&self.path, text.as_bytes()).map_err(|_| StoreError::WriteFailed)
    }

    /// Changes one entry. A file that cannot be read any more (another user's or another PC's
    /// DPAPI, or a broken file) is moved aside first, so that new keys can be kept.
    fn change(&self, entry: &str, value: Option<&str>) -> Result<(), StoreError> {
        let _guard = self.lock.lock().unwrap();
        let _file = super::lock::FileLock::acquire(&self.path.with_file_name(format!("{FILE_NAME}.lock")))
            .map_err(|_| StoreError::WriteFailed)?;
        let mut entries = match self.read_all() {
            Ok(entries) => entries,
            Err(_) if value.is_none() && !self.path.exists() => Map::new(),
            Err(_) => {
                self.move_aside()?;
                Map::new()
            }
        };
        let changed = match value {
            Some(value) => entries.insert(entry.to_string(), Value::String(value.to_string())) != Some(Value::String(value.to_string())),
            None => entries.remove(entry).is_some(),
        };
        if !changed {
            return Ok(());
        }
        self.write_all(&entries)
    }

    fn move_aside(&self) -> Result<(), StoreError> {
        if !self.path.exists() {
            return Ok(());
        }
        let directory = self.path.parent().unwrap_or(Path::new("."));
        let backup = directory.join(format!("{FILE_NAME}.unreadable-{}-{}", super::local_stamp(), super::random_suffix()));
        fs::rename(&self.path, backup).map_err(|_| StoreError::WriteFailed)
    }
}

impl SecretStore for FileStore {
    fn kind(&self) -> &'static str {
        "file"
    }

    fn read(&self, entry: &str) -> Result<Option<String>, StoreError> {
        let _guard = self.lock.lock().unwrap();
        Ok(self.read_all()?.get(entry).and_then(Value::as_str).map(str::to_string))
    }

    fn write(&self, entry: &str, value: &str) -> Result<(), StoreError> {
        self.change(entry, Some(value))
    }

    fn delete(&self, entry: &str) -> Result<(), StoreError> {
        self.change(entry, None)
    }
}

/// Writes a file only its owner can read (0600 on Unix), through a new temporary file and a
/// rename, so that a crash leaves the old file or the new one.
pub(super) fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let directory = path.parent().unwrap_or(Path::new("."));
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let (temporary, mut file) = loop {
        let candidate = directory.join(format!("{name}.{}.tmp", super::random_suffix()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&candidate) {
            Ok(file) => break (candidate, file),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    };
    let written = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written
}

#[cfg(windows)]
mod protect {
    //! DPAPI for the signed-in user: only this user on this PC can decrypt.
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData};

    pub const AVAILABLE: bool = true;
    const ENTROPY: &[u8] = b"VRCT-VOX secrets v1";

    fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 }
    }

    fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
        unsafe { LocalFree(out.pbData as _) };
        bytes
    }

    pub fn seal(plain: &[u8]) -> Option<Vec<u8>> {
        let (input, entropy) = (blob(plain), blob(ENTROPY));
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe {
            CryptProtectData(&input, std::ptr::null(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        (ok != 0).then(|| take(out))
    }

    pub fn open(sealed: &[u8]) -> Option<Vec<u8>> {
        let (input, entropy) = (blob(sealed), blob(ENTROPY));
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe {
            CryptUnprotectData(&input, std::ptr::null_mut(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        (ok != 0).then(|| take(out))
    }
}

#[cfg(not(windows))]
mod protect {
    //! No encryption: the file's permissions (0600) protect it.
    pub const AVAILABLE: bool = false;

    pub fn seal(_: &[u8]) -> Option<Vec<u8>> {
        None
    }

    pub fn open(_: &[u8]) -> Option<Vec<u8>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_store_keeps_entries_across_instances_and_forgets_deleted_ones() {
        let dir = tempfile_dir();
        let path = dir.join(FILE_NAME);
        let store = FileStore::new(path.clone());
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(None));
        write_verified(&store, "AUTH_KEYS/DeepL_API", "deepl-value").unwrap();
        store.write("AUTH_KEYS/OpenAI_API", "openai-value").unwrap();
        let again = FileStore::new(path.clone());
        assert_eq!(again.read("AUTH_KEYS/DeepL_API"), Ok(Some("deepl-value".into())));
        again.delete("AUTH_KEYS/DeepL_API").unwrap();
        again.delete("AUTH_KEYS/Missing").unwrap();
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(None));
        assert_eq!(store.read("AUTH_KEYS/OpenAI_API"), Ok(Some("openai-value".into())));
        let text = fs::read_to_string(&path).unwrap();
        if protect::AVAILABLE {
            assert!(!text.contains("openai-value"), "the file holds the keys encrypted");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn an_unreadable_file_fails_reads_and_is_moved_aside_by_a_write() {
        let dir = tempfile_dir();
        let path = dir.join(FILE_NAME);
        fs::write(&path, b"not json").unwrap();
        let store = FileStore::new(path.clone());
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Err(StoreError::Unreadable));
        store.write("AUTH_KEYS/DeepL_API", "new-value").unwrap();
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(Some("new-value".into())));
        let aside = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()?.file_name().into_string().ok()).filter(|n| n.contains(".unreadable-")).count();
        assert_eq!(aside, 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn entries_and_file_values_follow_the_maps() {
        let value = json!({ "DeepL_API": "a", "Gemini_API": null });
        assert_eq!(entries("AUTH_KEYS", &value), vec![("AUTH_KEYS/DeepL_API".to_string(), Some("a".to_string())), ("AUTH_KEYS/Gemini_API".to_string(), None)]);
        assert_eq!(with_entry("AUTH_KEYS", &value, "AUTH_KEYS/Gemini_API", Some("b")), json!({ "DeepL_API": "a", "Gemini_API": "b" }));
        let kept = ["AUTH_KEYS/DeepL_API".to_string()].into_iter().collect();
        assert_eq!(file_value("AUTH_KEYS", &value, &kept), Some(json!({ "DeepL_API": "a" })));
        assert_eq!(file_value("AUTH_KEYS", &value, &Default::default()), None);
    }

    fn tempfile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vrct-secrets-test-{}", super::super::random_suffix()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
