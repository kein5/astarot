//! The settings, kept in `config.json` (`src-python/config.py`).
//!
//! The file and its rules stay what the Python backend used, so a user's settings carry over:
//!
//! - The same keys, defaults and checks ([`schema`]). A saved value that fails its check is
//!   dropped and the default kept; unknown keys, fixed values and runtime state are ignored.
//! - The same migrations when the file is read: a removed UI language falls back to English, the
//!   removed local Whisper engine moves to speech.cpp (with a one-time notice), a saved
//!   `"bundled"` realtime server selects speech.cpp, saved API URLs that are no longer allowed
//!   are emptied and reported, the release channel follows the running version, and the
//!   installer's language marker is applied once.
//! - A file that is not JSON (or not an object, or not UTF-8) is moved aside as
//!   `config.json.unreadable-<time>-<random>` and the app starts with defaults. Any other read
//!   failure keeps the file untouched and blocks saving for the run.
//! - Saving writes a temporary file next to `config.json`, flushes it and renames it over the
//!   old one, under the byte lock of `config.json.lock` that the Python backend also took. Most
//!   changes are saved 2 s after the last one; a few at once. A failed save is reported once,
//!   tried again every 30 s while the values stay in memory, and its recovery is reported too.
//! - API keys are not written to `config.json` but to a store of their own ([`secrets`]). Keys
//!   found in the file (written by an older version) are moved there when it is read: each is
//!   written and read back first, and only then is `config.json` written without it. A key the
//!   store does not take stays where it was, stays usable, and is reported and tried again.

pub mod schema;
pub mod secrets;

use base64::Engine;
use serde_json::{Map, Value, json};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

pub const LOCAL_ASR_MIGRATION_LATEST: i64 = 2;
const RETIRED_UI_LANGUAGES: [&str; 3] = ["ko", "zh-Hant", "zh-Hans"];
const DEBOUNCE: Duration = Duration::from_secs(2);
const SAVE_RETRY: Duration = Duration::from_secs(30);

/// Settings whose change ends what the translation history may reuse.
const TRANSLATION_HISTORY_SETTINGS: [&str; 17] = [
    "ENABLE_TRANSLATION", "SELECTED_TAB_NO", "SELECTED_TRANSLATION_ENGINES", "CTRANSLATE2_WEIGHT_TYPE", "AUTH_KEYS",
    "LMSTUDIO_URL", "OLLAMA_URL", "PAPAGO_CLIENT_ID", "OPENAI_COMPATIBLE_URL", "SELECTED_PLAMO_MODEL", "SELECTED_GEMINI_MODEL", "SELECTED_OPENAI_MODEL",
    "SELECTED_GROQ_MODEL", "SELECTED_OPENROUTER_MODEL", "SELECTED_LMSTUDIO_MODEL", "SELECTED_OPENAI_COMPATIBLE_MODEL",
    "SELECTED_OLLAMA_MODEL",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Linux,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(windows) { Platform::Windows } else { Platform::Linux }
    }
}

/// The audio devices the device settings are checked against once they are listed.
pub trait DeviceLists: Send + Sync {
    fn mic_hosts(&self) -> Vec<String>;
    fn mic_devices(&self, host: &str) -> Vec<String>;
    fn speaker_devices(&self) -> Vec<String>;
}

/// What the settings need to know about the run.
#[derive(Clone)]
pub struct Environment {
    pub version: String,
    /// Where `config.json` and `logs/` live (`VRCT_CONFIG_DIR`, or the app's own folder).
    pub state_dir: PathBuf,
    /// The application folder: where the installer leaves `installer_language.txt`.
    pub app_dir: PathBuf,
    /// Where weights and downloaded models live.
    pub data_dir: PathBuf,
    pub platform: Platform,
    /// The translation compute devices (`getComputeDeviceList`); the first is the default.
    pub compute_devices: Vec<Value>,
    pub devices: Option<Arc<dyn DeviceLists>>,
    /// A fixed WebSocket token for tests; otherwise a new one is made on a first start.
    pub websocket_token: Option<String>,
}

impl Environment {
    /// The CPU device as the translation settings have always listed it.
    pub fn cpu_device() -> Value {
        json!({ "device": "cpu", "device_index": 0, "device_name": "cpu", "compute_types": ["auto", "float32", "int8", "int8_float32"] })
    }
}

/// What a check may read: the current values and, while `config.json` is read, the file.
pub struct Ctx<'a> {
    pub values: &'a Map<String, Value>,
    pub saved: &'a Map<String, Value>,
    pub loading: bool,
    pub env: &'a Environment,
}

static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new();

impl<'a> Ctx<'a> {
    pub fn empty(env: &'a Environment) -> Self {
        let empty = EMPTY.get_or_init(Map::new);
        Ctx { values: empty, saved: empty, loading: false, env }
    }

    pub fn get(&self, name: &str) -> Value {
        self.values.get(name).cloned().unwrap_or(Value::Null)
    }

    pub fn list(&self, name: &str) -> Vec<Value> {
        self.values.get(name).and_then(Value::as_array).cloned().unwrap_or_default()
    }
}

/// A value refused by its check (`ConfigValidationError`).
#[derive(Debug, Clone, PartialEq)]
pub struct Invalid {
    pub key: String,
}

/// Where a failed or recovered save is reported.
pub type SaveFailed = Arc<dyn Fn(&str, &Path) + Send + Sync>;
pub type SaveRecovered = Arc<dyn Fn() + Send + Sync>;
/// Where a failure of the key store is reported: what failed (`"read"`, `"write"`, `"delete"`,
/// `"migrate"`), the entries (names such as `AUTH_KEYS/DeepL_API`, never values) and the reason.
pub type SecretFailed = Arc<dyn Fn(&str, &[String], &str) + Send + Sync>;

/// The keys on their way to or from the store.
#[derive(Default)]
struct Secrets {
    /// Changes not yet in the store: `Some` to write, `None` to delete.
    pending: std::collections::BTreeMap<String, Option<String>>,
    /// Keys read from `config.json` that the store has not taken yet: they stay in the file.
    in_file: std::collections::BTreeSet<String>,
    /// Failures found before anyone listens: (operation, entry, reason).
    unreported: Vec<(&'static str, String, &'static str)>,
    /// Entries whose failure was reported and has not recovered (reported once).
    reported: std::collections::BTreeSet<String>,
    on_failed: Option<SecretFailed>,
    /// The keys were read at start-up: changes from now on go to the store.
    ready: bool,
}

fn report_secret_failures(callback: &SecretFailed, failures: Vec<(&'static str, String, &'static str)>) {
    // One report per operation and reason, naming its entries.
    let mut grouped: Vec<(&'static str, &'static str, Vec<String>)> = Vec::new();
    for (operation, entry, reason) in failures {
        match grouped.iter_mut().find(|(o, r, _)| *o == operation && *r == reason) {
            Some((_, _, entries)) => entries.push(entry),
            None => grouped.push((operation, reason, vec![entry])),
        }
    }
    for (operation, reason, entries) in grouped {
        callback(operation, &entries, reason);
    }
}

struct State {
    values: Map<String, Value>,
    loaded: bool,
    loading: bool,
    saved: Map<String, Value>,
    save_due: Option<Instant>,
    retry_due: Option<Instant>,
    save_failed: bool,
    failure_reason: Option<String>,
    on_failed: Option<SaveFailed>,
    on_recovered: Option<SaveRecovered>,
    unreadable_backup: Option<PathBuf>,
    invalid_saved_api_urls: Vec<String>,
    history_generation: u64,
    closed: bool,
    secrets: Secrets,
}

pub struct Config {
    env: Environment,
    keys: Vec<schema::Key>,
    state: Mutex<State>,
    file_lock: Mutex<()>,
    wake: Condvar,
    store: Arc<dyn secrets::SecretStore>,
    /// One exchange with the key store at a time.
    store_lock: Mutex<()>,
}

/// `secrets.token_urlsafe(32)`.
pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("the OS gives random bytes");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_suffix() -> String {
    let mut bytes = [0u8; 6];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The reason a save failed, as the UI names it.
fn failure_reason(error: &io::Error) -> &'static str {
    #[cfg(windows)]
    const DISK_FULL: [i32; 2] = [112, 39];
    #[cfg(not(windows))]
    const DISK_FULL: [i32; 1] = [28];
    #[cfg(windows)]
    const READ_ONLY: [i32; 1] = [19];
    #[cfg(not(windows))]
    const READ_ONLY: [i32; 1] = [30];
    match error.raw_os_error() {
        Some(code) if DISK_FULL.contains(&code) => "disk_full",
        Some(code) if READ_ONLY.contains(&code) => "read_only",
        _ if error.kind() == io::ErrorKind::PermissionDenied => "permission_denied",
        _ => "write_failed",
    }
}

impl Config {
    /// Fills in the defaults, reads `config.json` and saves it back, as a start did. The keys
    /// go to the app's store ([`secrets::default_store`]).
    pub fn open(env: Environment) -> Arc<Config> {
        let store = secrets::default_store(&env);
        Self::open_with(env, store)
    }

    /// [`Config::open`] with the keys in `store`.
    pub fn open_with(env: Environment, store: Arc<dyn secrets::SecretStore>) -> Arc<Config> {
        let keys = schema::keys();
        let values = schema::defaults(&env);
        debug_assert!(keys.iter().all(|k| values.contains_key(k.name)), "every key has a default");
        let config = Arc::new(Config {
            env,
            keys,
            state: Mutex::new(State {
                values,
                loaded: false,
                loading: false,
                saved: Map::new(),
                save_due: None,
                retry_due: None,
                save_failed: false,
                failure_reason: None,
                on_failed: None,
                on_recovered: None,
                unreadable_backup: None,
                invalid_saved_api_urls: Vec::new(),
                history_generation: 0,
                closed: false,
                secrets: Secrets::default(),
            }),
            file_lock: Mutex::new(()),
            wake: Condvar::new(),
            store,
            store_lock: Mutex::new(()),
        });
        let _ = fs::create_dir_all(config.env.state_dir.join("logs"));
        config.load();
        let saver = Arc::downgrade(&config);
        std::thread::Builder::new()
            .name("config_saver".into())
            .spawn(move || Self::saver(saver))
            .expect("the settings saver starts");
        config
    }

    pub fn environment(&self) -> &Environment {
        &self.env
    }

    pub fn path(&self) -> PathBuf {
        self.env.state_dir.join("config.json")
    }

    fn key(&self, name: &str) -> Option<&schema::Key> {
        self.keys.iter().find(|k| k.name == name)
    }

    pub fn get(&self, name: &str) -> Value {
        self.state.lock().unwrap().values.get(name).cloned().unwrap_or(Value::Null)
    }

    pub fn get_str(&self, name: &str) -> String {
        self.get(name).as_str().unwrap_or_default().to_string()
    }

    pub fn get_bool(&self, name: &str) -> bool {
        self.get(name).as_bool().unwrap_or(false)
    }

    /// Every value, for a snapshot.
    pub fn values(&self) -> Map<String, Value> {
        self.state.lock().unwrap().values.clone()
    }

    pub fn history_generation(&self) -> u64 {
        self.state.lock().unwrap().history_generation
    }

    pub fn unreadable_backup(&self) -> Option<PathBuf> {
        self.state.lock().unwrap().unreadable_backup.clone()
    }

    pub fn invalid_saved_api_urls(&self) -> Vec<String> {
        self.state.lock().unwrap().invalid_saved_api_urls.clone()
    }

    /// A value as `config.json` held it when the app started, before any check or move;
    /// `null` when the file did not have it.
    pub fn saved_at_start(&self, name: &str) -> Value {
        self.state.lock().unwrap().saved.get(name).cloned().unwrap_or(Value::Null)
    }

    fn check(&self, state: &State, name: &str, value: &Value) -> Result<Value, Invalid> {
        let invalid = || Invalid { key: name.to_string() };
        let key = self.key(name).ok_or_else(invalid)?;
        if key.readonly {
            return Err(invalid());
        }
        let check = key.check.as_ref().ok_or_else(invalid)?;
        let ctx = Ctx { values: &state.values, saved: &state.saved, loading: state.loading, env: &self.env };
        check(value, &ctx).ok_or_else(invalid)
    }

    fn store(state: &mut State, name: &str, value: Value) {
        if TRANSLATION_HISTORY_SETTINGS.contains(&name) && state.values.get(name) != Some(&value) {
            state.history_generation += 1;
        }
        if state.secrets.ready && secrets::SECRET_SETTINGS.contains(&name) {
            // A changed key goes to the store (see `flush_secrets`); the file no longer holds it.
            let old: std::collections::BTreeMap<String, Option<String>> =
                secrets::entries(name, state.values.get(name).unwrap_or(&Value::Null)).into_iter().collect();
            for (entry, new) in secrets::entries(name, &value) {
                if old.get(&entry) != Some(&new) {
                    state.secrets.in_file.remove(&entry);
                    state.secrets.pending.insert(entry, new);
                }
            }
        }
        state.values.insert(name.to_string(), value);
    }

    /// The store this run keeps the keys in.
    pub fn secret_store(&self) -> &Arc<dyn secrets::SecretStore> {
        &self.store
    }

    /// Hands the changed keys to the store, and the keys `config.json` still holds. A failure
    /// keeps the key in memory (usable), is reported once per entry, and is tried again with the
    /// next save and every 30 s. Returns whether a key left the file (the file needs writing).
    fn flush_secrets(&self) -> bool {
        let _io = self.store_lock.lock().unwrap();
        let (pending, in_file) = {
            let state = self.state.lock().unwrap();
            if !state.secrets.ready {
                return false;
            }
            let in_file: Vec<(String, Option<String>)> = state
                .secrets
                .in_file
                .iter()
                .map(|entry| (entry.clone(), self.secret_value(&state, entry)))
                .collect();
            (state.secrets.pending.clone(), in_file)
        };
        let mut failures = Vec::new();
        let mut recovered = Vec::new();
        for (entry, value) in pending {
            let (operation, result) = match &value {
                Some(key) => ("write", secrets::write_verified(self.store.as_ref(), &entry, key)),
                None => ("delete", self.store.delete(&entry)),
            };
            let mut state = self.state.lock().unwrap();
            match result {
                Ok(()) => {
                    if state.secrets.pending.get(&entry) == Some(&value) {
                        state.secrets.pending.remove(&entry);
                    }
                    recovered.push(entry);
                }
                Err(error) => failures.push((operation, entry, error.as_str())),
            }
        }
        let mut left_file = false;
        for (entry, value) in in_file {
            let result = match &value {
                Some(key) => secrets::write_verified(self.store.as_ref(), &entry, key),
                None => Ok(()),
            };
            let mut state = self.state.lock().unwrap();
            match result {
                Ok(()) => {
                    left_file |= state.secrets.in_file.remove(&entry);
                    recovered.push(entry);
                }
                Err(error) => failures.push(("migrate", entry, error.as_str())),
            }
        }
        self.secret_results(failures, recovered);
        left_file
    }

    /// The value of one entry in memory.
    fn secret_value(&self, state: &State, entry: &str) -> Option<String> {
        let name = secrets::SECRET_SETTINGS.iter().find(|name| entry == **name || entry.starts_with(&format!("{name}/")))?;
        secrets::entries(name, state.values.get(*name).unwrap_or(&Value::Null))
            .into_iter()
            .find(|(e, _)| e == entry)
            .and_then(|(_, value)| value)
    }

    /// Records what the store did: new failures are reported (or kept until someone listens),
    /// and a retry is due while anything is left.
    fn secret_results(&self, failures: Vec<(&'static str, String, &'static str)>, recovered: Vec<String>) {
        let mut state = self.state.lock().unwrap();
        for entry in &recovered {
            state.secrets.reported.remove(entry);
        }
        let mut fresh: Vec<(&'static str, String, &'static str)> = Vec::new();
        for (operation, entry, reason) in failures {
            if state.secrets.reported.insert(entry.clone()) {
                fresh.push((operation, entry, reason));
            }
        }
        if (!state.secrets.pending.is_empty() || !state.secrets.in_file.is_empty()) && state.retry_due.is_none() {
            state.retry_due = Some(Instant::now() + SAVE_RETRY);
        }
        let callback = state.secrets.on_failed.clone();
        if callback.is_none() {
            state.secrets.unreported.extend(fresh);
            return;
        }
        drop(state);
        self.wake.notify_all();
        if let Some(callback) = callback {
            report_secret_failures(&callback, fresh);
        }
    }

    /// Where failures of the key store are reported; failures found before (while reading the
    /// settings) are reported now.
    pub fn set_secret_callback(&self, on_failed: SecretFailed) {
        let pending = {
            let mut state = self.state.lock().unwrap();
            state.secrets.on_failed = Some(on_failed.clone());
            std::mem::take(&mut state.secrets.unreported)
        };
        report_secret_failures(&on_failed, pending);
    }

    /// Reads the keys at start-up: keys in `config.json` move to the store (written and read
    /// back), and the store fills in the keys the file does not have.
    fn load_secrets(&self) {
        let _io = self.store_lock.lock().unwrap();
        let mut failures = Vec::new();
        let mut in_file = Vec::new();
        for name in secrets::SECRET_SETTINGS {
            let current = self.get(name);
            for (entry, value) in secrets::entries(name, &current) {
                match value {
                    Some(key) => {
                        if let Err(error) = secrets::write_verified(self.store.as_ref(), &entry, &key) {
                            failures.push(("migrate", entry.clone(), error.as_str()));
                            in_file.push(entry);
                        }
                    }
                    None => match self.store.read(&entry) {
                        Ok(Some(key)) => {
                            let mut state = self.state.lock().unwrap();
                            let value = secrets::with_entry(name, state.values.get(name).unwrap_or(&Value::Null), &entry, Some(&key));
                            Self::store(&mut state, name, value);
                        }
                        Ok(None) => {}
                        Err(error) => failures.push(("read", entry, error.as_str())),
                    },
                }
            }
        }
        let mut state = self.state.lock().unwrap();
        state.secrets.in_file.extend(in_file);
        for (operation, entry, _) in &failures {
            if *operation == "migrate" {
                // Tried again with every save: reported once until it succeeds.
                state.secrets.reported.insert(entry.clone());
            }
        }
        state.secrets.unreported.extend(failures);
        state.secrets.ready = true;
    }

    /// Checks and stores a value, then schedules the save. Returns the value as stored.
    pub fn set(&self, name: &str, value: Value) -> Result<Value, Invalid> {
        let (immediate, serialize) = {
            let mut state = self.state.lock().unwrap();
            let stored = self.check(&state, name, &value)?;
            Self::store(&mut state, name, stored);
            let key = self.key(name).expect("checked above");
            (key.immediate, key.serialize)
        };
        self.flush_changed_secrets();
        if serialize {
            self.schedule_save(immediate);
        }
        Ok(self.get(name))
    }

    /// Stores several values only if every one passes (`setSelectedLanguages`).
    pub fn set_many(&self, pairs: &[(&str, Value)]) -> Result<(), Invalid> {
        let mut immediate = false;
        let mut serialize = false;
        {
            let mut state = self.state.lock().unwrap();
            let mut checked = Vec::new();
            for (name, value) in pairs {
                checked.push((*name, self.check(&state, name, value)?));
            }
            for (name, value) in checked {
                let key = self.key(name).expect("checked above");
                immediate |= key.immediate;
                serialize |= key.serialize;
                Self::store(&mut state, name, value);
            }
        }
        self.flush_changed_secrets();
        if serialize {
            self.schedule_save(immediate);
        }
        Ok(())
    }

    /// Stores a value without its check, for state the backend computes itself.
    pub fn put(&self, name: &str, value: Value) {
        let serialize = self.key(name).is_some_and(|k| k.serialize);
        Self::store(&mut self.state.lock().unwrap(), name, value);
        self.flush_changed_secrets();
        if serialize {
            self.schedule_save(false);
        }
    }

    /// Hands changed keys to the store now, so that a key is kept before the request answers.
    fn flush_changed_secrets(&self) {
        if !self.state.lock().unwrap().secrets.pending.is_empty() {
            self.flush_secrets();
        }
    }

    /// Changes one credential without overwriting another provider's (`updateCredential`).
    pub fn update_credential(&self, map: &str, provider: &str, value: Option<&str>) -> Result<(), Invalid> {
        let invalid = || Invalid { key: map.to_string() };
        if map != "AUTH_KEYS" && map != "TRANSCRIPTION_AUTH_KEYS" {
            return Err(invalid());
        }
        let mut keys = self.get(map);
        let entry = keys.get_mut(provider).ok_or_else(invalid)?;
        *entry = value.map_or(Value::Null, |v| Value::String(v.to_string()));
        self.set(map, keys).map(|_| ())
    }

    fn schedule_save(&self, immediate: bool) {
        {
            let mut state = self.state.lock().unwrap();
            if !state.loaded || state.closed {
                return;
            }
            state.save_due = if immediate { None } else { Some(Instant::now() + DEBOUNCE) };
        }
        if immediate {
            self.save_now();
        } else {
            self.wake.notify_all();
        }
    }

    fn saver(config: std::sync::Weak<Config>) {
        loop {
            let Some(this) = config.upgrade() else { return };
            let mut state = this.state.lock().unwrap();
            if state.closed {
                return;
            }
            let due = [state.save_due, state.retry_due].into_iter().flatten().min();
            let now = Instant::now();
            match due {
                Some(due) if due <= now => {
                    if state.save_due.is_some_and(|d| d <= now) {
                        state.save_due = None;
                    }
                    if state.retry_due.is_some_and(|d| d <= now) {
                        state.retry_due = None;
                    }
                    drop(state);
                    this.save_now();
                }
                Some(due) => {
                    let wait = (due - now).min(Duration::from_millis(500));
                    let _ = this.wake.wait_timeout(state, wait).unwrap();
                }
                None => {
                    let _ = this.wake.wait_timeout(state, Duration::from_millis(500)).unwrap();
                }
            }
        }
    }

    /// The saved values, in the file's order.
    fn snapshot(&self, state: &State) -> Map<String, Value> {
        self.keys
            .iter()
            .filter(|k| k.serialize && !k.readonly)
            .filter_map(|k| {
                let value = state.values.get(k.name).cloned().unwrap_or(Value::Null);
                if secrets::SECRET_SETTINGS.contains(&k.name) {
                    // Only keys the store has not taken yet; none at all once it has them.
                    return secrets::file_value(k.name, &value, &state.secrets.in_file).map(|v| (k.name.to_string(), v));
                }
                Some((k.name.to_string(), value))
            })
            .collect()
    }

    /// Writes `config.json` now (`saveConfigToFile`), after handing changed keys to the store.
    pub fn save_now(&self) {
        let has_secrets = {
            let state = self.state.lock().unwrap();
            !state.secrets.pending.is_empty() || !state.secrets.in_file.is_empty()
        };
        if has_secrets {
            self.flush_secrets();
        }
        let _file = self.file_lock.lock().unwrap();
        let snapshot = {
            let state = self.state.lock().unwrap();
            if !state.loaded {
                return;
            }
            self.snapshot(&state)
        };
        let result = write_config(&self.path(), &Value::Object(snapshot));
        let mut state = self.state.lock().unwrap();
        match result {
            Ok(()) => {
                let recovered = state.save_failed;
                state.save_failed = false;
                state.failure_reason = None;
                // Keys the store has not taken are tried again.
                let keys_left = !state.secrets.pending.is_empty() || !state.secrets.in_file.is_empty();
                state.retry_due = keys_left.then(|| Instant::now() + SAVE_RETRY);
                let callback = state.on_recovered.clone();
                drop(state);
                if recovered {
                    if let Some(callback) = callback {
                        callback();
                    }
                }
            }
            Err(error) => {
                let reason = failure_reason(&error);
                self.failed(state, reason, true);
            }
        }
    }

    fn failed(&self, mut state: MutexGuard<'_, State>, reason: &str, retry: bool) {
        let first = !state.save_failed;
        state.save_failed = true;
        state.failure_reason = Some(reason.to_string());
        if retry && state.retry_due.is_none() {
            state.retry_due = Some(Instant::now() + SAVE_RETRY);
        }
        let callback = state.on_failed.clone();
        drop(state);
        self.wake.notify_all();
        if first {
            if let Some(callback) = callback {
                let path = self.path();
                let reason = reason.to_string();
                std::thread::spawn(move || callback(&reason, &path));
            }
        }
    }

    /// Where failed and recovered saves are reported; a failure before this call is reported now.
    pub fn set_save_callbacks(&self, on_failed: SaveFailed, on_recovered: SaveRecovered) {
        let pending = {
            let mut state = self.state.lock().unwrap();
            state.on_failed = Some(on_failed.clone());
            state.on_recovered = Some(on_recovered);
            state.save_failed.then(|| state.failure_reason.clone()).flatten()
        };
        if let Some(reason) = pending {
            on_failed(&reason, &self.path());
        }
    }

    /// Saves what is pending and stops the saver.
    pub fn close(&self) {
        let pending = {
            let state = self.state.lock().unwrap();
            state.save_due.is_some() || state.retry_due.is_some()
        };
        if pending {
            self.save_now();
        }
        self.state.lock().unwrap().closed = true;
        self.wake.notify_all();
    }

    fn load(&self) {
        {
            let mut state = self.state.lock().unwrap();
            state.loaded = false;
            state.loading = true;
        }
        let result = self.read_file();
        match result {
            Ok(data) => {
                self.apply_saved(data);
                // The store takes the file's keys before the file is written without them.
                self.load_secrets();
                let mut state = self.state.lock().unwrap();
                state.loading = false;
                state.loaded = true;
                drop(state);
                self.save_now();
            }
            Err(_) => {
                // The file stays as it is; the keys in the store are still used.
                self.load_secrets();
                let mut state = self.state.lock().unwrap();
                state.loading = false;
                // A read or preservation failure is not repaired by writing again.
                self.failed(state, "load_failed", false);
            }
        }
    }

    /// The saved object, `{}` for a missing file, or the error that blocks saving.
    fn read_file(&self) -> io::Result<Map<String, Value>> {
        let path = self.path();
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                // A dangling link is not "no file": leave it alone and do not write.
                if fs::symlink_metadata(&path).is_ok() {
                    return Err(error);
                }
                return Ok(Map::new());
            }
            Err(error) => return Err(error),
        };
        // As Python's json.load: a byte order mark makes the file unreadable too.
        let parsed = std::str::from_utf8(&bytes).ok().and_then(|text| serde_json::from_str::<Value>(text).ok());
        match parsed {
            Some(Value::Object(object)) => Ok(object),
            _ => {
                let backup = self.move_aside(&path)?;
                self.state.lock().unwrap().unreadable_backup = Some(backup);
                Ok(Map::new())
            }
        }
    }

    fn move_aside(&self, path: &Path) -> io::Result<PathBuf> {
        let stamp = local_stamp();
        let directory = path.parent().unwrap_or(Path::new("."));
        for _ in 0..16 {
            let backup = directory.join(format!("config.json.unreadable-{stamp}-{}", random_suffix()));
            if OpenOptions::new().write(true).create_new(true).open(&backup).is_ok() {
                return match fs::rename(path, &backup) {
                    Ok(()) => Ok(backup),
                    Err(error) => {
                        let _ = fs::remove_file(&backup);
                        Err(error)
                    }
                };
            }
        }
        Err(io::Error::other("no free backup name"))
    }

    /// `_loadConfig` after the file was read.
    fn apply_saved(&self, mut data: Map<String, Value>) {
        let saved = data.clone();
        self.state.lock().unwrap().saved = data.clone();
        if !data.contains_key("OCR_VR_CAPTURE_REGION") {
            data.insert("OCR_VR_CAPTURE_REGION".into(), json!({ "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0 }));
        }
        let mut invalid_urls = Vec::new();
        for (key, value) in &data {
            if crate::net_policy::CUSTOM_URL_KEYS.contains(&key.as_str()) && !crate::net_policy::valid_saved_api_url(value) {
                // Empty turns the lookup off; a saved key never moves to another host.
                self.put_loading(key, json!(""));
                invalid_urls.push(key.clone());
                continue;
            }
            if key == "UI_LANGUAGE" && value.as_str().is_some_and(|v| RETIRED_UI_LANGUAGES.contains(&v)) {
                continue;
            }
            if key == "SELECTED_TRANSCRIPTION_ENGINE" && value.as_str() == Some(crate::languages::RETIRED_WHISPER_ENGINE) {
                continue;
            }
            let Some(definition) = self.key(key) else { continue };
            if definition.readonly || !definition.serialize {
                continue;
            }
            let mut state = self.state.lock().unwrap();
            if let Ok(stored) = self.check(&state, key, value) {
                Self::store(&mut state, key, stored);
            }
        }
        self.state.lock().unwrap().invalid_saved_api_urls = invalid_urls;
        self.migrate_local_asr(&saved);
        let channel = if ["-beta", "-rc"].iter().any(|m| self.env.version.contains(m)) { "beta" } else { "stable" };
        self.put_loading("SELECTED_RELEASE_CHANNEL", json!(channel));
        self.apply_installer_language();
    }

    fn put_loading(&self, name: &str, value: Value) {
        Self::store(&mut self.state.lock().unwrap(), name, value);
    }

    fn set_loading(&self, name: &str, value: Value) {
        let mut state = self.state.lock().unwrap();
        if let Ok(stored) = self.check(&state, name, &value) {
            Self::store(&mut state, name, stored);
        }
    }

    /// `_migrateLocalASR`: brings the local recognition settings of an older version up to date, once.
    fn migrate_local_asr(&self, saved: &Map<String, Value>) {
        let step = if saved.is_empty() {
            Value::from(LOCAL_ASR_MIGRATION_LATEST)
        } else {
            saved.get("LOCAL_ASR_MIGRATION").cloned().unwrap_or(Value::from(0))
        };
        let step = step.as_i64().filter(|s| step.is_i64() && (0..=LOCAL_ASR_MIGRATION_LATEST).contains(s)).unwrap_or(0);
        if step < 1 && self.get("REALTIME_ASR_SETTINGS")["server"] == "bundled" {
            self.set_loading("SELECTED_TRANSCRIPTION_ENGINE", json!(crate::languages::LOCAL_SPEECH_ENGINE));
        }
        if step < 2 && saved.get("SELECTED_TRANSCRIPTION_ENGINE").and_then(Value::as_str) == Some(crate::languages::RETIRED_WHISPER_ENGINE) {
            self.set_loading("SELECTED_TRANSCRIPTION_ENGINE", json!(crate::languages::LOCAL_SPEECH_ENGINE));
            if self.env.platform == Platform::Windows {
                let mut realtime = self.get("REALTIME_ASR_SETTINGS");
                realtime["server"] = json!("bundled");
                self.set_loading("REALTIME_ASR_SETTINGS", realtime);
            }
            self.set_loading("LOCAL_ASR_NOTICE_PENDING", json!(true));
        }
        self.set_loading("LOCAL_ASR_MIGRATION", json!(LOCAL_ASR_MIGRATION_LATEST));
    }

    /// The UI language the installer chose, written as a plain marker next to the app; used once.
    fn apply_installer_language(&self) {
        let marker = self.env.app_dir.join("installer_language.txt");
        if !marker.is_file() {
            return;
        }
        if let Ok(text) = fs::read_to_string(&marker) {
            let language = text.trim();
            if ["en", "ja"].contains(&language) {
                self.set_loading("UI_LANGUAGE", json!(language));
            }
        }
        let _ = fs::remove_file(&marker);
    }

    /// `revalidate_selected_models`: a saved model no longer offered moves to the first offered.
    pub fn revalidate_selected_models(&self) {
        for (selected, list) in [
            ("SELECTED_PLAMO_MODEL", "SELECTABLE_PLAMO_MODEL_LIST"),
            ("SELECTED_GEMINI_MODEL", "SELECTABLE_GEMINI_MODEL_LIST"),
            ("SELECTED_OPENAI_MODEL", "SELECTABLE_OPENAI_MODEL_LIST"),
            ("SELECTED_GROQ_MODEL", "SELECTABLE_GROQ_MODEL_LIST"),
            ("SELECTED_OPENROUTER_MODEL", "SELECTABLE_OPENROUTER_MODEL_LIST"),
            ("SELECTED_LMSTUDIO_MODEL", "SELECTABLE_LMSTUDIO_MODEL_LIST"),
            ("SELECTED_OPENAI_COMPATIBLE_MODEL", "SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST"),
            ("SELECTED_OLLAMA_MODEL", "SELECTABLE_OLLAMA_MODEL_LIST"),
            ("SELECTED_GROQ_WHISPER_MODEL", "SELECTABLE_GROQ_WHISPER_MODEL_LIST"),
            ("SELECTED_OPENAI_WHISPER_MODEL", "SELECTABLE_OPENAI_WHISPER_MODEL_LIST"),
            ("SELECTED_CUSTOM_WHISPER_MODEL", "SELECTABLE_CUSTOM_WHISPER_MODEL_LIST"),
            ("SELECTED_DEEPGRAM_MODEL", "SELECTABLE_DEEPGRAM_MODEL_LIST"),
        ] {
            let current = self.get(selected);
            let offered = self.get(list);
            let Some(offered) = offered.as_array() else { continue };
            if !offered.is_empty() && !current.is_null() && !offered.contains(&current) {
                let _ = self.set(selected, offered[0].clone());
            }
        }
    }
}

impl Drop for Config {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            state.closed = true;
        }
        self.wake.notify_all();
    }
}

fn local_stamp() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}{month:02}{day:02}-{:02}{:02}{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// `json.dump(value, indent=4, ensure_ascii=False)`.
pub fn to_python_json(value: &Value) -> String {
    let mut out = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b"    ");
    let mut serializer = serde_json::Serializer::with_formatter(&mut out, formatter);
    serde::Serialize::serialize(value, &mut serializer).expect("writing to memory does not fail");
    String::from_utf8(out).expect("serde_json writes UTF-8")
}

/// Writes the file under the shared lock, through a fresh temporary file and a rename.
fn write_config(path: &Path, value: &Value) -> io::Result<()> {
    let directory = path.parent().unwrap_or(Path::new("."));
    let _lock = lock::FileLock::acquire(&path.with_file_name("config.json.lock"))?;
    let text = to_python_json(value);
    let (temporary, mut file) = loop {
        let candidate = directory.join(format!("config.json.{}.tmp", random_suffix()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        // Owner only, as Python wrote it (`docs/spec/cross-cutting.md`).
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        match options.open(&candidate) {
            Ok(file) => break (candidate, file),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    };
    let written = (|| {
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written
}

mod lock {
    //! The byte lock on `config.json.lock` (`_configFileLock`): `flock` on Linux, a lock on the
    //! first byte on Windows, so the Rust and the Python backends exclude each other.
    use super::*;

    pub struct FileLock {
        file: File,
    }

    impl FileLock {
        pub fn acquire(path: &Path) -> io::Result<Self> {
            let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path)?;
            if !file.metadata()?.is_file() {
                return Err(io::Error::other("the settings lock is not a regular file"));
            }
            imp::lock(&file)?;
            Ok(Self { file })
        }
    }

    impl Drop for FileLock {
        fn drop(&mut self) {
            imp::unlock(&self.file);
        }
    }

    #[cfg(unix)]
    mod imp {
        use std::fs::File;
        use std::io;
        use std::os::fd::AsRawFd;

        pub fn lock(file: &File) -> io::Result<()> {
            loop {
                if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
                    return Ok(());
                }
                let error = io::Error::last_os_error();
                if error.kind() != io::ErrorKind::Interrupted {
                    return Err(error);
                }
            }
        }

        pub fn unlock(file: &File) {
            unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
        }
    }

    #[cfg(windows)]
    mod imp {
        use std::fs::File;
        use std::io;
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{LOCKFILE_EXCLUSIVE_LOCK, LockFileEx, UnlockFileEx};
        use windows_sys::Win32::System::IO::OVERLAPPED;

        pub fn lock(file: &File) -> io::Result<()> {
            let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
            let ok = unsafe { LockFileEx(file.as_raw_handle() as _, LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, &mut overlapped) };
            if ok == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
        }

        pub fn unlock(file: &File) {
            let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
            unsafe { UnlockFileEx(file.as_raw_handle() as _, 0, 1, 0, &mut overlapped) };
        }
    }
}
