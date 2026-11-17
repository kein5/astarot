//! Where the API keys live: a store of their own, never `config.json`.
//!
//! The settings named in [`SECRET_SETTINGS`] stay ordinary settings in memory (the endpoints read
//! and change them as before), but their values are written to a [`SecretStore`] instead of
//! `config.json`. Each value is one entry: `AUTH_KEYS/DeepL_API` for a provider of a map of keys,
//! the setting's own name for a single string. A provider added to one of the maps' defaults is
//! kept the same way without more code; a new setting that holds a key only needs its name in
//! [`SECRET_SETTINGS`].
//!
//! The store of the app is the OS credential store (ADR-013, issue #575): the Windows Credential
//! Manager, the Secret Service on Linux. [`SystemStore`] keeps the keys there and reads
//! `secrets.json` next to `config.json` (the [`FileStore`] that kept them before) as the place
//! keys move from: a key found only there is used, written to the OS store, read back, and only
//! then removed from the file. The file also holds the id that names this settings folder's
//! entries in the OS store, so two settings folders never share keys. In the file, on Windows the
//! entries are encrypted for the signed-in user with DPAPI (`CryptProtectData`); on Linux the file
//! is readable by its owner only (0600). Tests use a [`MemoryStore`], also as a stand-in OS store.
//!
//! The OS store is never asked to show a dialog: a locked keyring, a store that does not answer
//! or that is not there is a passing failure, which changes nothing in either place.
//!
//! Nothing here logs or returns a key in an error: an error names its reason only.

use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

mod system;
pub use system::SystemStore;
#[cfg(windows)]
mod credential_manager;
#[cfg(target_os = "linux")]
mod secret_service;

/// The settings whose values are keys: kept in the store, never in `config.json`.
pub const SECRET_SETTINGS: [&str; 3] = ["AUTH_KEYS", "TRANSCRIPTION_AUTH_KEYS", "PAPAGO_CLIENT_ID"];

/// Why the store failed. Never carries a key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreError {
    /// The store could not be read, or what it holds could not be decoded or decrypted.
    Unreadable,
    /// The store could not be written.
    WriteFailed,
    /// The OS store is not there or did not answer in time (no Secret Service on the session
    /// bus, no session bus, no signed-in user's credentials). It may answer later.
    Unavailable,
    /// The OS store is locked (a keyring not opened). The app does not ask to open it.
    Locked,
}

impl StoreError {
    pub fn as_str(self) -> &'static str {
        match self {
            StoreError::Unreadable => "unreadable",
            StoreError::WriteFailed => "write_failed",
            StoreError::Unavailable => "unavailable",
            StoreError::Locked => "locked",
        }
    }
}

/// A place for keys, one string per entry name.
pub trait SecretStore: Send + Sync {
    /// What the store is, for the error notification (`"credential_manager"`,
    /// `"secret_service"`, `"file"`, `"memory"`).
    fn kind(&self) -> &'static str;
    fn read(&self, entry: &str) -> Result<Option<String>, StoreError>;
    fn write(&self, entry: &str, value: &str) -> Result<(), StoreError>;
    /// Removing an entry that is not there succeeds.
    fn delete(&self, entry: &str) -> Result<(), StoreError>;
    /// The entries [`SecretStore::read`] answered from an older place that still holds them (they
    /// have not moved yet); each is named once. Writing such an entry moves it.
    fn take_unmoved(&self) -> Vec<String> {
        Vec::new()
    }
}

/// An OS credential store: entries under a scope (this settings folder's id).
pub trait Vault: Send + Sync {
    /// What the store is, for the error notification.
    fn label(&self) -> &'static str;
    fn fetch(&self, scope: &str, entry: &str) -> Result<Option<String>, StoreError>;
    fn put(&self, scope: &str, entry: &str, value: &str) -> Result<(), StoreError>;
    /// Removing an entry that is not there succeeds.
    fn remove(&self, scope: &str, entry: &str) -> Result<(), StoreError>;
}

/// Makes the store for the settings' environment (a [`crate::controller::Services`] field).
pub type StoreSource = Arc<dyn Fn(&super::Environment) -> Arc<dyn SecretStore> + Send + Sync>;

/// The app's store: the OS credential store, with `secrets.json` in the settings folder as the
/// place keys move from.
pub fn default_store(env: &super::Environment) -> Arc<dyn SecretStore> {
    Arc::new(SystemStore::new(FileStore::new(env.state_dir.join(FILE_NAME)), os_vault()))
}

/// The OS credential store of this platform.
pub fn os_vault() -> Arc<dyn Vault> {
    #[cfg(windows)]
    return Arc::new(credential_manager::CredentialManager);
    #[cfg(target_os = "linux")]
    return Arc::new(secret_service::SecretService::new());
    #[cfg(not(any(windows, target_os = "linux")))]
    return Arc::new(NoVault);
}

/// No OS store on this platform: every call is a passing failure, so keys stay where they are.
#[cfg(not(any(windows, target_os = "linux")))]
struct NoVault;

#[cfg(not(any(windows, target_os = "linux")))]
impl Vault for NoVault {
    fn label(&self) -> &'static str {
        "none"
    }
    fn fetch(&self, _: &str, _: &str) -> Result<Option<String>, StoreError> {
        Err(StoreError::Unavailable)
    }
    fn put(&self, _: &str, _: &str, _: &str) -> Result<(), StoreError> {
        Err(StoreError::Unavailable)
    }
    fn remove(&self, _: &str, _: &str) -> Result<(), StoreError> {
        Err(StoreError::Unavailable)
    }
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
        // An empty string is "no key", like null in a map: nothing to keep.
        Value::String(s) => vec![(name.to_string(), (!s.is_empty()).then(|| s.clone()))],
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
        // A single string setting keeps its type: no key is the empty string.
        Value::String(_) | Value::Null if entry == name => if new.is_null() { Value::String(String::new()) } else { new },
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

/// Keys in memory, for tests and for hosts that keep nothing. It can be told to fail. As a
/// [`Vault`] (a stand-in OS store) it keeps each entry as `<scope>/<entry>` ([`MemoryStore::scoped`]).
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
    /// Every call fails as a store that is not there or does not answer.
    pub unavailable: bool,
    /// Every call fails as a locked keyring.
    pub locked: bool,
}

impl Faults {
    fn passing(self) -> Result<(), StoreError> {
        if self.unavailable {
            return Err(StoreError::Unavailable);
        }
        if self.locked {
            return Err(StoreError::Locked);
        }
        Ok(())
    }
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

    /// The name an entry has when this store stands in for an OS store.
    pub fn scoped(scope: &str, entry: &str) -> String {
        format!("{scope}/{entry}")
    }

    /// A [`StoreSource`] for the app's store over `secrets.json`, with this store standing in for
    /// the OS store: what the app does, without touching the PC's own credentials.
    pub fn system_source(self: &Arc<Self>) -> StoreSource {
        let vault = Arc::clone(self);
        Arc::new(move |env| {
            Arc::new(SystemStore::new(FileStore::new(env.state_dir.join(FILE_NAME)), Arc::clone(&vault) as Arc<dyn Vault>))
                as Arc<dyn SecretStore>
        })
    }
}

impl SecretStore for MemoryStore {
    fn kind(&self) -> &'static str {
        "memory"
    }

    fn read(&self, entry: &str) -> Result<Option<String>, StoreError> {
        let faults = *self.faults.lock().unwrap();
        faults.passing()?;
        if faults.read {
            return Err(StoreError::Unreadable);
        }
        Ok(self.get(entry))
    }

    fn write(&self, entry: &str, value: &str) -> Result<(), StoreError> {
        let faults = *self.faults.lock().unwrap();
        faults.passing()?;
        if faults.write {
            return Err(StoreError::WriteFailed);
        }
        if !faults.lose_writes {
            self.insert(entry, value);
        }
        Ok(())
    }

    fn delete(&self, entry: &str) -> Result<(), StoreError> {
        let faults = *self.faults.lock().unwrap();
        faults.passing()?;
        if faults.delete {
            return Err(StoreError::WriteFailed);
        }
        self.entries.lock().unwrap().remove(entry);
        Ok(())
    }
}

impl Vault for MemoryStore {
    fn label(&self) -> &'static str {
        "memory"
    }

    fn fetch(&self, scope: &str, entry: &str) -> Result<Option<String>, StoreError> {
        SecretStore::read(self, &Self::scoped(scope, entry))
    }

    fn put(&self, scope: &str, entry: &str, value: &str) -> Result<(), StoreError> {
        SecretStore::write(self, &Self::scoped(scope, entry), value)
    }

    fn remove(&self, scope: &str, entry: &str) -> Result<(), StoreError> {
        SecretStore::delete(self, &Self::scoped(scope, entry))
    }
}

/// `secrets.json`: `{"version": 1, "protection": ..., "entries": ..., "store_id": ...}`. With
/// `"dpapi"` (Windows) `entries` is the base64 of the DPAPI-encrypted JSON object of the entries;
/// with `"none"` (Linux, where the file is 0600) it is the object itself. `store_id` (added with the
/// OS store) names this settings folder's entries there; it is not secret. 0.5, which kept the
/// keys in this file, reads it and ignores the id. Written like `config.json`: a new temporary file, flushed, renamed
/// over the old one.
pub struct FileStore {
    path: PathBuf,
    lock: Mutex<()>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReadFailure {
    Io,
    Undecodable,
}

impl FileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path, lock: Mutex::new(()) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn read_all(&self) -> Result<Map<String, Value>, StoreError> {
        self.read_entries().map_err(|_| StoreError::Unreadable)
    }

    /// The file's bytes, `None` when there is no file.
    fn read_bytes(&self) -> Result<Option<Vec<u8>>, ReadFailure> {
        match fs::read(&self.path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(ReadFailure::Io),
        }
    }

    /// The entries, or why there are none: the file could not be read now (it may be readable
    /// again later), or what it holds cannot be decoded.
    fn read_entries(&self) -> Result<Map<String, Value>, ReadFailure> {
        match self.read_bytes()? {
            Some(bytes) => Self::decode(&bytes, protect::open),
            None => Ok(Map::new()),
        }
    }

    /// One entry, or why the file cannot say.
    fn lookup(&self, entry: &str) -> Result<Option<String>, ReadFailure> {
        let _guard = self.lock.lock().unwrap();
        Ok(self.read_entries()?.get(entry).and_then(Value::as_str).map(str::to_string))
    }

    /// The id of this settings folder's entries in the OS store; `None` until a key was kept
    /// there. A file that is not JSON has none that can be read.
    fn store_id(&self) -> Result<Option<String>, ReadFailure> {
        let _guard = self.lock.lock().unwrap();
        match self.read_bytes()? {
            Some(bytes) => Self::decode_id(&bytes),
            None => Ok(None),
        }
    }

    /// The store id of a file's bytes. It is read apart from the entries, so that a file whose
    /// entries cannot be decrypted (another user's DPAPI) keeps naming the same OS entries.
    fn decode_id(bytes: &[u8]) -> Result<Option<String>, ReadFailure> {
        let file: Value = serde_json::from_slice(bytes).map_err(|_| ReadFailure::Undecodable)?;
        if !file.is_object() || file["version"] != 1 {
            return Err(ReadFailure::Undecodable);
        }
        Ok(file["store_id"].as_str().filter(|id| valid_store_id(id)).map(str::to_string))
    }

    /// The store id, made and written now if the file has none. The entries are left exactly as
    /// they are (they may be sealed for another user). A file that is not JSON is moved aside
    /// first, as a change does; a file that cannot be read now is left alone and this fails.
    fn ensure_store_id(&self) -> Result<String, StoreError> {
        let _guard = self.lock.lock().unwrap();
        let _file = super::lock::FileLock::acquire(&self.path.with_file_name(format!("{FILE_NAME}.lock")))
            .map_err(|_| StoreError::WriteFailed)?;
        let bytes = self.read_bytes().map_err(|_| StoreError::WriteFailed)?;
        if let Some(bytes) = &bytes {
            match Self::decode_id(bytes) {
                Ok(Some(id)) => return Ok(id),
                Ok(None) => {
                    let mut file: Value = serde_json::from_slice(bytes).map_err(|_| StoreError::WriteFailed)?;
                    let id = new_store_id();
                    file["store_id"] = Value::String(id.clone());
                    let text = super::to_python_json(&file);
                    write_private(&self.path, text.as_bytes()).map_err(|_| StoreError::WriteFailed)?;
                    return Ok(id);
                }
                Err(_) => self.move_aside()?,
            }
        }
        let id = new_store_id();
        self.write_all(&Map::new(), Some(&id))?;
        Ok(id)
    }

    /// The entries of a file's bytes; `open` decrypts DPAPI-sealed entries. A DPAPI that cannot
    /// answer now is a passing failure ([`ReadFailure::Io`]), so the file is not moved aside.
    fn decode(bytes: &[u8], open: impl Fn(&[u8]) -> Result<Vec<u8>, OpenFailure>) -> Result<Map<String, Value>, ReadFailure> {
        let file: Value = serde_json::from_slice(bytes).map_err(|_| ReadFailure::Undecodable)?;
        if file["version"] != 1 {
            return Err(ReadFailure::Undecodable);
        }
        match (file["protection"].as_str(), &file["entries"]) {
            (Some("none"), Value::Object(entries)) => Ok(entries.clone()),
            (Some("dpapi"), Value::String(encoded)) => {
                use base64::Engine;
                let sealed = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| ReadFailure::Undecodable)?;
                let plain = open(&sealed).map_err(|failure| match failure {
                    OpenFailure::NotNow => ReadFailure::Io,
                    OpenFailure::Undecodable => ReadFailure::Undecodable,
                })?;
                match serde_json::from_slice(&plain) {
                    Ok(Value::Object(entries)) => Ok(entries),
                    _ => Err(ReadFailure::Undecodable),
                }
            }
            _ => Err(ReadFailure::Undecodable),
        }
    }

    fn write_all(&self, entries: &Map<String, Value>, store_id: Option<&str>) -> Result<(), StoreError> {
        let mut body = if protect::AVAILABLE {
            use base64::Engine;
            let plain = serde_json::to_vec(entries).expect("writing to memory does not fail");
            let sealed = protect::seal(&plain).ok_or(StoreError::WriteFailed)?;
            json!({ "version": 1, "protection": "dpapi", "entries": base64::engine::general_purpose::STANDARD.encode(sealed) })
        } else {
            json!({ "version": 1, "protection": "none", "entries": entries })
        };
        if let Some(id) = store_id {
            body["store_id"] = Value::String(id.to_string());
        }
        let text = super::to_python_json(&body);
        write_private(&self.path, text.as_bytes()).map_err(|_| StoreError::WriteFailed)
    }

    /// Changes one entry. A file that cannot be decoded any more (another user's or another
    /// PC's DPAPI, or a broken file) is moved aside first, so that new keys can be kept; its
    /// store id, when it can still be read, carries over. A file that could not be read just now
    /// (locked, a passing I/O error, or DPAPI not answering) is left as it is and the change
    /// fails: writing only this entry would drop every other key.
    fn change(&self, entry: &str, value: Option<&str>) -> Result<(), StoreError> {
        let _guard = self.lock.lock().unwrap();
        let _file = super::lock::FileLock::acquire(&self.path.with_file_name(format!("{FILE_NAME}.lock")))
            .map_err(|_| StoreError::WriteFailed)?;
        let read = self.read_bytes();
        let store_id = match &read {
            Ok(Some(bytes)) => Self::decode_id(bytes).ok().flatten(),
            _ => None,
        };
        let decoded = match read {
            Ok(Some(bytes)) => Self::decode(&bytes, protect::open),
            Ok(None) => Ok(Map::new()),
            Err(failure) => Err(failure),
        };
        let mut moved_aside = false;
        let mut entries = match decoded {
            Ok(entries) => entries,
            // Removing from a file that is gone meanwhile is done.
            Err(ReadFailure::Io) if value.is_none() && !self.path.exists() => Map::new(),
            Err(ReadFailure::Io) => return Err(StoreError::WriteFailed),
            Err(ReadFailure::Undecodable) => {
                self.move_aside()?;
                moved_aside = true;
                Map::new()
            }
        };
        let changed = match value {
            Some(value) => entries.insert(entry.to_string(), Value::String(value.to_string())) != Some(Value::String(value.to_string())),
            None => entries.remove(entry).is_some(),
        };
        // A file moved aside leaves its store id behind in a new one.
        if !changed && !(moved_aside && store_id.is_some()) {
            return Ok(());
        }
        self.write_all(&entries, store_id.as_deref())
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

/// A new store id: 16 random hex digits.
fn new_store_id() -> String {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).expect("the OS gives random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A store id as [`new_store_id`] makes them. Anything else in the file is ignored, so that a
/// hand-edited id cannot reach the OS store's names.
fn valid_store_id(id: &str) -> bool {
    id.len() == 16 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
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

    pub fn open(sealed: &[u8]) -> Result<Vec<u8>, super::OpenFailure> {
        let (input, entropy) = (blob(sealed), blob(ENTROPY));
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe {
            CryptUnprotectData(&input, std::ptr::null_mut(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        if ok != 0 {
            return Ok(take(out));
        }
        let error = unsafe { windows_sys::Win32::Foundation::GetLastError() };
        Err(if passing(error) { super::OpenFailure::NotNow } else { super::OpenFailure::Undecodable })
    }

    /// Errors that say DPAPI could not answer just now (the security service busy or restarting,
    /// memory short), not that the data is another user's or broken. Anything else counts as
    /// undecodable, as before.
    pub(super) fn passing(error: u32) -> bool {
        const ERROR_NOT_ENOUGH_MEMORY: u32 = 8;
        const ERROR_OUTOFMEMORY: u32 = 14;
        const ERROR_BUSY: u32 = 170;
        const ERROR_SHUTDOWN_IN_PROGRESS: u32 = 1115;
        const ERROR_NO_SYSTEM_RESOURCES: u32 = 1450;
        const ERROR_TIMEOUT: u32 = 1460;
        const RPC_S_SERVER_UNAVAILABLE: u32 = 1722;
        const RPC_S_SERVER_TOO_BUSY: u32 = 1723;
        const RPC_S_CALL_FAILED: u32 = 1726;
        const RPC_S_CALL_FAILED_DNE: u32 = 1727;
        const E_OUTOFMEMORY: u32 = 0x8007_000E;
        matches!(
            error,
            ERROR_NOT_ENOUGH_MEMORY
                | ERROR_OUTOFMEMORY
                | ERROR_BUSY
                | ERROR_SHUTDOWN_IN_PROGRESS
                | ERROR_NO_SYSTEM_RESOURCES
                | ERROR_TIMEOUT
                | RPC_S_SERVER_UNAVAILABLE
                | RPC_S_SERVER_TOO_BUSY
                | RPC_S_CALL_FAILED
                | RPC_S_CALL_FAILED_DNE
                | E_OUTOFMEMORY
        )
    }
}

/// Why sealed entries could not be opened.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenFailure {
    /// Another user's or another PC's data, or broken: it will not open later either.
    Undecodable,
    /// DPAPI could not answer now; the file may open later.
    NotNow,
}

#[cfg(not(windows))]
mod protect {
    //! No encryption: the file's permissions (0600) protect it.
    pub const AVAILABLE: bool = false;

    pub fn seal(_: &[u8]) -> Option<Vec<u8>> {
        None
    }

    pub fn open(_: &[u8]) -> Result<Vec<u8>, super::OpenFailure> {
        Err(super::OpenFailure::Undecodable)
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
    fn a_file_that_cannot_be_read_now_fails_a_change_and_is_kept() {
        // #427: a passing read error was taken for a broken file, which was moved aside; the new
        // file held only the one key written, and the others were gone at the next start.
        let dir = tempfile_dir();
        let path = dir.join(FILE_NAME);
        // A directory where the file is: reading fails with an I/O error, not "not found".
        fs::create_dir(&path).unwrap();
        let store = FileStore::new(path.clone());
        assert_eq!(store.write("AUTH_KEYS/DeepL_API", "new-value"), Err(StoreError::WriteFailed));
        assert_eq!(store.delete("AUTH_KEYS/DeepL_API"), Err(StoreError::WriteFailed));
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Err(StoreError::Unreadable));
        assert!(path.is_dir(), "left where it is");
        let aside = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()?.file_name().into_string().ok()).filter(|n| n.contains(".unreadable-")).count();
        assert_eq!(aside, 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn dpapi_not_answering_is_a_passing_failure_and_other_failures_are_not() {
        // #470: any DPAPI failure counted as "cannot be decoded", and the file was moved aside.
        let file = br#"{"version": 1, "protection": "dpapi", "entries": "AAAA"}"#;
        assert!(matches!(FileStore::decode(file, |_| Err(OpenFailure::NotNow)), Err(ReadFailure::Io)));
        assert!(matches!(FileStore::decode(file, |_| Err(OpenFailure::Undecodable)), Err(ReadFailure::Undecodable)));
        assert_eq!(FileStore::decode(file, |_| Ok(br#"{"A": "b"}"#.to_vec())).ok(), Some(json!({ "A": "b" }).as_object().unwrap().clone()));
        assert!(matches!(FileStore::decode(b"not json", |_| Err(OpenFailure::NotNow)), Err(ReadFailure::Undecodable)));
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_data_that_is_not_this_users_counts_as_undecodable() {
        // What DPAPI says about bytes it did not seal, and about a blob made with other entropy
        // (as close to another user's data as a test can get), stays "undecodable".
        assert_eq!(protect::open(b"not sealed by DPAPI"), Err(OpenFailure::Undecodable));
        let mut sealed = protect::seal(b"{}").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0xff;
        assert_eq!(protect::open(&sealed), Err(OpenFailure::Undecodable));
        assert!(protect::passing(1722) && !protect::passing(13) && !protect::passing(0x8009_000B));
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
