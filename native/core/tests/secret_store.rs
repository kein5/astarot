//! API keys live in a store of their own, not in `config.json` (`astarot_core::config::secrets`).
//! Through the protocol: keys saved by an older version (Python or an earlier core) move to the
//! store, the endpoints answer as before, a failing store never loses a key silently, and a
//! deleted key leaves the store. Keys in `secrets.json` (0.5) move to the OS store one at a
//! time, and only once read back. The OS store here is in memory; the PC's own is never touched.

mod common;

use common::{error_code, Setup, Ui};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use astarot_core::config::secrets::{FILE_NAME, Faults, FileStore, MemoryStore, SecretStore, SystemStore, Vault};
use astarot_core::controller::Services;
use astarot_translation::fake::FakeProviders;

const DEEPL: &str = "0123456789abcdef0123456789abcdef0123:fx";
const OPENAI: &str = "sk-older-version-openai-key";
const DEEPGRAM: &str = "older-version-deepgram-key";

/// `config.json` as the Python backend (0.4) wrote it, with keys in it.
fn python_era() -> Value {
    json!({
        "AUTH_KEYS": {
            "DeepL_API": DEEPL, "Plamo_API": null, "Gemini_API": null, "OpenAI_API": OPENAI,
            "OpenAI_Compatible": null, "Groq_API": null, "OpenRouter_API": null,
        },
        "TRANSCRIPTION_AUTH_KEYS": { "Groq_Whisper": null, "OpenAI_Whisper": null, "Custom_Whisper": null, "Deepgram": DEEPGRAM },
        "UI_LANGUAGE": "ja",
    })
}

fn start(dir: &Path, store: &Arc<MemoryStore>, saved: Option<Value>) -> Ui {
    start_with(dir, store, saved, Setup::default().services)
}

fn start_with(dir: &Path, store: &Arc<MemoryStore>, saved: Option<Value>, services: Services) -> Ui {
    let ui = Ui::with(Setup {
        saved,
        dir: Some(dir.to_path_buf()),
        services: Services { secret_store: store.source(), ..services },
        ..Setup::default()
    });
    ui.ready();
    ui
}

fn raw_config(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("config.json")).unwrap()
}

fn process_log(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("logs").join("process.log")).unwrap_or_default()
}

fn store_failure(ui: &Ui, operation: &str) -> Value {
    let line = ui.wait_from(0, operation, |l| l["endpoint"] == "/run/secret_store_failed" && l["result"]["data"]["operation"] == operation);
    assert_eq!(line["status"], 400, "{line}");
    assert_eq!(error_code(&line), "SECRET_STORE_FAILED");
    line["result"]["data"].clone()
}

fn entries(data: &Value) -> Vec<String> {
    let mut entries: Vec<String> = data["entries"].as_array().unwrap().iter().map(|e| e.as_str().unwrap().to_string()).collect();
    entries.sort();
    entries
}

#[test]
fn keys_saved_by_an_older_version_move_to_the_store_and_answer_as_before() {
    let dir = tempfile::tempdir().unwrap();
    let store = MemoryStore::new();
    let ui = start(dir.path(), &store, Some(python_era()));

    // The file no longer holds them; the store does; the rest of the settings stay.
    let saved = ui.saved();
    assert!(saved.get("AUTH_KEYS").is_none() && saved.get("TRANSCRIPTION_AUTH_KEYS").is_none(), "{saved}");
    assert_eq!(saved["UI_LANGUAGE"], "ja");
    let text = raw_config(dir.path());
    assert!(![DEEPL, OPENAI, DEEPGRAM].iter().any(|key| text.contains(key)), "a key is still in config.json");
    assert_eq!(store.get("AUTH_KEYS/DeepL_API").as_deref(), Some(DEEPL));
    assert_eq!(store.get("AUTH_KEYS/OpenAI_API").as_deref(), Some(OPENAI));
    assert_eq!(store.get("TRANSCRIPTION_AUTH_KEYS/Deepgram").as_deref(), Some(DEEPGRAM));
    assert_eq!(store.snapshot().len(), 3, "only keys that were set: {:?}", store.snapshot().keys());

    // The endpoints answer as they did when the keys were in the file.
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
    assert_eq!(ui.ok("/get/data/openai_auth_key", None), OPENAI);
    assert_eq!(ui.ok("/get/data/deepgram_auth_key", None), DEEPGRAM);
    assert_eq!(ui.ok("/get/data/gemini_auth_key", None), Value::Null);
    assert!(ui.on(0, "/run/secret_store_failed").is_empty());
    ui.ok("/run/shutdown", None);
    ui.stop();

    // The next start reads them from the store.
    let ui = start(dir.path(), &store, None);
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
    assert_eq!(ui.ok("/get/data/deepgram_auth_key", None), DEEPGRAM);
    let snapshot = ui.wait_endpoint(0, "/run/initialization_complete")["result"].clone();
    assert_eq!(snapshot["/get/data/openai_auth_key"], OPENAI, "the start-up snapshot carries the key as before");
    ui.ok("/run/shutdown", None);
    assert!(ui.saved().get("AUTH_KEYS").is_none());
    ui.stop();
    let log = process_log(dir.path());
    assert!(![DEEPL, OPENAI, DEEPGRAM].iter().any(|key| log.contains(key)), "a key reached the log");
}

#[test]
fn a_store_that_does_not_take_the_old_keys_leaves_them_in_the_file_and_takes_them_later() {
    for faults in [Faults { write: true, ..Faults::default() }, Faults { lose_writes: true, ..Faults::default() }] {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::new();
        store.set_faults(faults);
        let ui = start(dir.path(), &store, Some(python_era()));

        let failure = store_failure(&ui, "migrate");
        assert_eq!(entries(&failure), ["AUTH_KEYS/DeepL_API", "AUTH_KEYS/OpenAI_API", "TRANSCRIPTION_AUTH_KEYS/Deepgram"], "{faults:?}");
        assert_eq!(failure["reason"], "write_failed");
        assert_eq!(failure["store"], "memory");
        assert!(!failure.to_string().contains(DEEPL), "the report names entries, not keys");
        // Nothing is lost: the file keeps the keys the store did not take, and they work.
        let saved = ui.saved();
        assert_eq!(saved["AUTH_KEYS"], json!({ "DeepL_API": DEEPL, "OpenAI_API": OPENAI }));
        assert_eq!(saved["TRANSCRIPTION_AUTH_KEYS"], json!({ "Deepgram": DEEPGRAM }));
        assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);

        // Once the store works, the next save moves them.
        store.set_faults(Faults::default());
        ui.ok("/run/shutdown", None);
        assert_eq!(store.get("AUTH_KEYS/DeepL_API").as_deref(), Some(DEEPL));
        assert_eq!(store.get("TRANSCRIPTION_AUTH_KEYS/Deepgram").as_deref(), Some(DEEPGRAM));
        let saved = ui.saved();
        assert!(saved.get("AUTH_KEYS").is_none() && saved.get("TRANSCRIPTION_AUTH_KEYS").is_none(), "{saved}");
        assert_eq!(ui.on(0, "/run/secret_store_failed").len(), 1, "reported once");
        ui.stop();
    }
}

#[test]
fn a_key_the_store_refuses_stays_usable_for_the_run_and_is_reported() {
    let fake = FakeProviders::start();
    fake.key("/deepl-free", DEEPL);
    let services = Services {
        translation_endpoints: astarot_translation::providers::Endpoints::all_at(&fake.url()),
        ..Setup::default().services
    };
    let dir = tempfile::tempdir().unwrap();
    let store = MemoryStore::new();
    let ui = start_with(dir.path(), &store, None, services);
    store.set_faults(Faults { write: true, ..Faults::default() });

    // The endpoint answers as before; the failure comes as its own notification.
    let mark = ui.send("/set/data/deepl_auth_key", Some(json!(DEEPL)));
    let answer = ui.wait_endpoint(mark, "/set/data/deepl_auth_key");
    assert_eq!(answer["status"], 200, "{answer}");
    let failure = store_failure(&ui, "write");
    assert_eq!(entries(&failure), ["AUTH_KEYS/DeepL_API"]);
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL, "usable for the run");
    assert!(!raw_config(dir.path()).contains(DEEPL), "never written to config.json");
    assert_eq!(store.get("AUTH_KEYS/DeepL_API"), None);

    // Tried again with the next save.
    store.set_faults(Faults::default());
    ui.ok("/run/shutdown", None);
    assert_eq!(store.get("AUTH_KEYS/DeepL_API").as_deref(), Some(DEEPL));
    assert!(!raw_config(dir.path()).contains(DEEPL));
    ui.stop();
    assert!(!process_log(dir.path()).contains(DEEPL), "a key reached the log");
}

#[test]
fn deleting_a_key_deletes_it_from_the_store() {
    let dir = tempfile::tempdir().unwrap();
    let store = MemoryStore::new();
    store.insert("AUTH_KEYS/DeepL_API", DEEPL);
    store.insert("AUTH_KEYS/OpenAI_API", OPENAI);
    store.insert("TRANSCRIPTION_AUTH_KEYS/Deepgram", DEEPGRAM);
    let ui = start(dir.path(), &store, None);
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);

    assert_eq!(ui.ok("/delete/data/deepl_auth_key", None), Value::Null, "answered as before");
    assert_eq!(store.get("AUTH_KEYS/DeepL_API"), None);
    assert_eq!(ui.ok("/delete/data/deepgram_auth_key", None), Value::Null);
    assert_eq!(store.get("TRANSCRIPTION_AUTH_KEYS/Deepgram"), None);
    assert_eq!(store.get("AUTH_KEYS/OpenAI_API").as_deref(), Some(OPENAI), "another provider's key stays");

    // A delete the store refuses is reported, the key is gone for the run, and it is tried again.
    store.set_faults(Faults { delete: true, ..Faults::default() });
    assert_eq!(ui.ok("/delete/data/openai_auth_key", None), Value::Null);
    let failure = store_failure(&ui, "delete");
    assert_eq!(entries(&failure), ["AUTH_KEYS/OpenAI_API"]);
    assert_eq!(ui.ok("/get/data/openai_auth_key", None), Value::Null);
    store.set_faults(Faults::default());
    ui.ok("/run/shutdown", None);
    assert_eq!(store.get("AUTH_KEYS/OpenAI_API"), None);
    assert!(store.snapshot().is_empty());
    ui.stop();

    let ui = start(dir.path(), &store, None);
    assert_eq!(ui.ok("/get/data/openai_auth_key", None), Value::Null, "a deleted key does not come back");
    ui.stop();
}

// ---- The app's store: the OS store, with `secrets.json` (0.5) as the place keys move from ----

/// Starts with the app's store over `secrets.json`, `vault` standing in for the OS store.
fn start_system(dir: &Path, vault: &Arc<MemoryStore>, saved: Option<Value>) -> Ui {
    let ui = Ui::with(Setup {
        saved,
        dir: Some(dir.to_path_buf()),
        services: Services { secret_store: vault.system_source(), ..Setup::default().services },
        ..Setup::default()
    });
    ui.ready();
    ui
}

/// `secrets.json` as 0.5 wrote it (DPAPI on Windows, plain text and 0600 on Linux).
fn secrets_05(dir: &Path, entries: &[(&str, &str)]) {
    let file = FileStore::new(dir.join(FILE_NAME));
    for (entry, value) in entries {
        file.write(entry, value).unwrap();
    }
}

fn file_entry(dir: &Path, entry: &str) -> Option<String> {
    FileStore::new(dir.join(FILE_NAME)).read(entry).unwrap()
}

fn raw_secrets(dir: &Path) -> String {
    std::fs::read_to_string(dir.join(FILE_NAME)).unwrap_or_default()
}

fn store_id(dir: &Path) -> String {
    let file: Value = serde_json::from_str(&raw_secrets(dir)).unwrap();
    file["store_id"].as_str().expect("an id once a key is kept").to_string()
}

fn in_vault(vault: &MemoryStore, dir: &Path, entry: &str) -> Option<String> {
    vault.get(&MemoryStore::scoped(&store_id(dir), entry))
}

#[test]
fn keys_in_secrets_json_move_to_the_os_store_one_by_one_and_answer_as_before() {
    let dir = tempfile::tempdir().unwrap();
    secrets_05(dir.path(), &[("AUTH_KEYS/DeepL_API", DEEPL), ("AUTH_KEYS/OpenAI_API", OPENAI), ("TRANSCRIPTION_AUTH_KEYS/Deepgram", DEEPGRAM)]);
    let vault = MemoryStore::new();
    let ui = start_system(dir.path(), &vault, Some(json!({ "UI_LANGUAGE": "ja" })));

    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
    assert_eq!(ui.ok("/get/data/openai_auth_key", None), OPENAI);
    assert_eq!(ui.ok("/get/data/deepgram_auth_key", None), DEEPGRAM);
    assert!(ui.on(0, "/run/secret_store_failed").is_empty());
    // In the OS store, read back, and gone from the file, which keeps only the id.
    assert_eq!(in_vault(&vault, dir.path(), "AUTH_KEYS/DeepL_API").as_deref(), Some(DEEPL));
    assert_eq!(in_vault(&vault, dir.path(), "AUTH_KEYS/OpenAI_API").as_deref(), Some(OPENAI));
    assert_eq!(in_vault(&vault, dir.path(), "TRANSCRIPTION_AUTH_KEYS/Deepgram").as_deref(), Some(DEEPGRAM));
    for entry in ["AUTH_KEYS/DeepL_API", "AUTH_KEYS/OpenAI_API", "TRANSCRIPTION_AUTH_KEYS/Deepgram"] {
        assert_eq!(file_entry(dir.path(), entry), None, "{entry} left the file");
    }
    let text = raw_secrets(dir.path());
    assert!(![DEEPL, OPENAI, DEEPGRAM].iter().any(|key| text.contains(key)));
    assert!(!raw_config(dir.path()).contains(DEEPL));
    ui.ok("/run/shutdown", None);
    ui.stop();

    // The next start reads the OS store.
    let ui = start_system(dir.path(), &vault, None);
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
    ui.ok("/run/shutdown", None);
    ui.stop();
    let log = process_log(dir.path());
    assert!(![DEEPL, OPENAI, DEEPGRAM].iter().any(|key| log.contains(key)), "a key reached the log");
}

#[test]
fn keys_from_an_older_config_json_go_to_the_os_store_without_passing_through_secrets_json() {
    let dir = tempfile::tempdir().unwrap();
    let vault = MemoryStore::new();
    let ui = start_system(dir.path(), &vault, Some(python_era()));
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
    assert_eq!(in_vault(&vault, dir.path(), "AUTH_KEYS/DeepL_API").as_deref(), Some(DEEPL));
    assert_eq!(in_vault(&vault, dir.path(), "TRANSCRIPTION_AUTH_KEYS/Deepgram").as_deref(), Some(DEEPGRAM));
    assert!(ui.saved().get("AUTH_KEYS").is_none());
    assert!(![DEEPL, OPENAI, DEEPGRAM].iter().any(|key| raw_secrets(dir.path()).contains(key)));
    ui.ok("/run/shutdown", None);
    ui.stop();
}

#[test]
fn a_move_the_os_store_does_not_take_leaves_the_key_in_secrets_json_working_and_is_tried_again() {
    for faults in [
        Faults { unavailable: true, ..Faults::default() },
        Faults { locked: true, ..Faults::default() },
        Faults { write: true, ..Faults::default() },
        Faults { lose_writes: true, ..Faults::default() },
    ] {
        let dir = tempfile::tempdir().unwrap();
        secrets_05(dir.path(), &[("AUTH_KEYS/DeepL_API", DEEPL), ("TRANSCRIPTION_AUTH_KEYS/Deepgram", DEEPGRAM)]);
        let vault = MemoryStore::new();
        vault.set_faults(faults);
        let ui = start_system(dir.path(), &vault, None);

        let failure = store_failure(&ui, "migrate");
        assert_eq!(entries(&failure), ["AUTH_KEYS/DeepL_API", "TRANSCRIPTION_AUTH_KEYS/Deepgram"], "{faults:?}");
        let reason = if faults.unavailable { "unavailable" } else if faults.locked { "locked" } else { "write_failed" };
        assert_eq!(failure["reason"], reason, "{faults:?}");
        assert!(!failure.to_string().contains(DEEPL));
        // Nothing lost: the keys work and stay in the file.
        assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL, "{faults:?}");
        assert_eq!(file_entry(dir.path(), "AUTH_KEYS/DeepL_API").as_deref(), Some(DEEPL), "{faults:?}");
        assert_eq!(file_entry(dir.path(), "TRANSCRIPTION_AUTH_KEYS/Deepgram").as_deref(), Some(DEEPGRAM));

        // Once the store answers, the next save moves them; reported once.
        vault.set_faults(Faults::default());
        ui.ok("/run/shutdown", None);
        assert_eq!(in_vault(&vault, dir.path(), "AUTH_KEYS/DeepL_API").as_deref(), Some(DEEPL), "{faults:?}");
        assert_eq!(file_entry(dir.path(), "AUTH_KEYS/DeepL_API"), None, "{faults:?}");
        assert_eq!(file_entry(dir.path(), "TRANSCRIPTION_AUTH_KEYS/Deepgram"), None);
        assert_eq!(ui.on(0, "/run/secret_store_failed").len(), 1, "{faults:?}: reported once");
        ui.stop();
        assert!(!process_log(dir.path()).contains(DEEPL), "a key reached the log");
    }
}

#[test]
fn a_move_cut_short_continues_at_the_next_start() {
    // The state a crash can leave: the id written, one key in the OS store whose copy was not yet
    // removed from the file, another not moved at all.
    let dir = tempfile::tempdir().unwrap();
    secrets_05(dir.path(), &[("AUTH_KEYS/DeepL_API", DEEPL), ("AUTH_KEYS/OpenAI_API", OPENAI)]);
    let vault = MemoryStore::new();
    let store = vault.system_source()(&common::environment(dir.path(), astarot_core::config::Platform::current()));
    store.write("TRANSCRIPTION_AUTH_KEYS/Deepgram", DEEPGRAM).unwrap();
    vault.insert(&MemoryStore::scoped(&store_id(dir.path()), "AUTH_KEYS/DeepL_API"), DEEPL);
    assert_eq!(file_entry(dir.path(), "AUTH_KEYS/DeepL_API").as_deref(), Some(DEEPL), "both places hold it");

    let ui = start_system(dir.path(), &vault, None);
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
    assert_eq!(ui.ok("/get/data/openai_auth_key", None), OPENAI);
    assert_eq!(ui.ok("/get/data/deepgram_auth_key", None), DEEPGRAM);
    assert!(ui.on(0, "/run/secret_store_failed").is_empty());
    assert_eq!(file_entry(dir.path(), "AUTH_KEYS/DeepL_API"), None, "the copy goes");
    assert_eq!(file_entry(dir.path(), "AUTH_KEYS/OpenAI_API"), None, "the rest moves");
    assert_eq!(in_vault(&vault, dir.path(), "AUTH_KEYS/OpenAI_API").as_deref(), Some(OPENAI));
    ui.ok("/run/shutdown", None);
    ui.stop();
}

#[test]
fn a_locked_or_absent_os_store_at_start_is_reported_and_nothing_is_lost_or_written_in_plain_text() {
    let fake = FakeProviders::start();
    fake.key("/deepl-free", DEEPL);
    for faults in [Faults { locked: true, ..Faults::default() }, Faults { unavailable: true, ..Faults::default() }] {
        let dir = tempfile::tempdir().unwrap();
        let vault = MemoryStore::new();
        // A key kept in the OS store by an earlier run.
        let store = vault.system_source()(&common::environment(dir.path(), astarot_core::config::Platform::current()));
        store.write("AUTH_KEYS/OpenAI_API", OPENAI).unwrap();
        let before = (vault.snapshot(), raw_secrets(dir.path()));

        vault.set_faults(faults);
        let ui = Ui::with(Setup {
            dir: Some(dir.path().to_path_buf()),
            services: Services {
                secret_store: vault.system_source(),
                translation_endpoints: astarot_translation::providers::Endpoints::all_at(&fake.url()),
                ..Setup::default().services
            },
            ..Setup::default()
        });
        ui.ready();
        let failure = store_failure(&ui, "read");
        assert!(entries(&failure).contains(&"AUTH_KEYS/OpenAI_API".to_string()), "{faults:?}");
        assert_eq!(failure["reason"], if faults.locked { "locked" } else { "unavailable" });
        assert_eq!(ui.ok("/get/data/openai_auth_key", None), Value::Null, "{faults:?}: not known this run");
        // A new key is kept for the run and reported; it is never written to the file instead.
        ui.ok("/set/data/deepl_auth_key", Some(json!(DEEPL)));
        let failure = store_failure(&ui, "write");
        assert_eq!(entries(&failure), ["AUTH_KEYS/DeepL_API"]);
        assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
        assert!(!raw_secrets(dir.path()).contains(DEEPL), "{faults:?}: no plain-text fallback");
        ui.ok("/run/shutdown", None);
        ui.stop();
        assert_eq!((vault.snapshot(), raw_secrets(dir.path())), before, "{faults:?}: nothing changed");
        assert!(!process_log(dir.path()).contains(DEEPL), "a key reached the log");

        // Opened again: the kept key is there.
        vault.set_faults(Faults::default());
        let ui = start_system(dir.path(), &vault, None);
        assert_eq!(ui.ok("/get/data/openai_auth_key", None), OPENAI, "{faults:?}");
        ui.ok("/run/shutdown", None);
        ui.stop();
    }
}

#[test]
fn deleting_a_key_removes_it_from_the_os_store_and_from_secrets_json() {
    let dir = tempfile::tempdir().unwrap();
    secrets_05(dir.path(), &[("AUTH_KEYS/DeepL_API", DEEPL), ("AUTH_KEYS/OpenAI_API", OPENAI)]);
    let vault = MemoryStore::new();
    // OpenAI's key cannot move this run.
    vault.set_faults(Faults { locked: true, ..Faults::default() });
    let ui = start_system(dir.path(), &vault, None);
    store_failure(&ui, "migrate");
    // Deleting it removes the plain-text copy at once; the OS store's part is tried again.
    ui.ok("/delete/data/openai_auth_key", None);
    assert_eq!(file_entry(dir.path(), "AUTH_KEYS/OpenAI_API"), None);
    vault.set_faults(Faults::default());
    ui.ok("/delete/data/deepl_auth_key", None);
    ui.ok("/run/shutdown", None);
    ui.stop();
    assert!(vault.snapshot().is_empty(), "{:?}", vault.snapshot().keys());
    assert_eq!(file_entry(dir.path(), "AUTH_KEYS/DeepL_API"), None);

    let ui = start_system(dir.path(), &vault, None);
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), Value::Null, "a deleted key does not come back");
    assert_eq!(ui.ok("/get/data/openai_auth_key", None), Value::Null);
    ui.stop();
}

/// The app's own store, with the PC's real OS store (the Credential Manager, or the Secret Service
/// on the session bus): a 0.5 `secrets.json` moves there, the keys answer after a restart, and
/// deleting them leaves nothing behind. The keys are made-up values under a settings folder of
/// its own. Run with `cargo test --test secret_store -- --ignored`.
#[test]
#[ignore = "uses the signed-in user's OS credential store"]
fn the_real_os_store_takes_the_keys_from_secrets_json_and_gives_them_back() {
    const FIRST: &str = "test-only-value-1-not-a-real-key";
    const SECOND: &str = "test-only-value-2-not-a-real-key";
    let dir = tempfile::tempdir().unwrap();
    secrets_05(dir.path(), &[("AUTH_KEYS/DeepL_API", FIRST), ("TRANSCRIPTION_AUTH_KEYS/Deepgram", SECOND)]);
    let start = || {
        let ui = Ui::with(Setup {
            dir: Some(dir.path().to_path_buf()),
            services: Services { secret_store: std::sync::Arc::new(astarot_core::config::secrets::default_store), ..Setup::default().services },
            ..Setup::default()
        });
        ui.ready();
        ui
    };
    let ui = start();
    assert!(ui.on(0, "/run/secret_store_failed").is_empty(), "{:?}", ui.on(0, "/run/secret_store_failed"));
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), FIRST);
    assert_eq!(file_entry(dir.path(), "AUTH_KEYS/DeepL_API"), None, "moved out of the file");
    assert_eq!(file_entry(dir.path(), "TRANSCRIPTION_AUTH_KEYS/Deepgram"), None);
    assert!(![FIRST, SECOND].iter().any(|key| raw_secrets(dir.path()).contains(key)));
    ui.ok("/run/shutdown", None);
    ui.stop();

    let ui = start();
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), FIRST, "read back from the OS store");
    assert_eq!(ui.ok("/get/data/deepgram_auth_key", None), SECOND);
    ui.ok("/delete/data/deepl_auth_key", None);
    ui.ok("/delete/data/deepgram_auth_key", None);
    assert!(ui.on(0, "/run/secret_store_failed").is_empty());
    ui.ok("/run/shutdown", None);
    ui.stop();

    let store = astarot_core::config::secrets::default_store(&common::environment(dir.path(), astarot_core::config::Platform::current()));
    assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(None), "nothing left in the OS store");
    assert_eq!(store.read("TRANSCRIPTION_AUTH_KEYS/Deepgram"), Ok(None));
    assert!(![FIRST, SECOND].iter().any(|key| process_log(dir.path()).contains(key)), "a key reached the log");
}

// ---- The OS store under the names of 0.6.0 (ADR-014, 2.9) ----

/// Starts with the app's store: `vault` stands in for the OS store under the names this build
/// writes, `older` for the same store under those 0.6.0 kept its keys with.
fn start_with_older(dir: &Path, vault: &Arc<MemoryStore>, older: &Arc<MemoryStore>, saved: Option<Value>) -> Ui {
    let ui = Ui::with(Setup {
        saved,
        dir: Some(dir.to_path_buf()),
        services: Services { secret_store: vault.system_source_with_older(older), ..Setup::default().services },
        ..Setup::default()
    });
    ui.ready();
    ui
}

#[test]
fn keys_0_6_0_kept_under_its_names_move_to_the_new_names_and_stay_for_0_6_0() {
    let dir = tempfile::tempdir().unwrap();
    let older = MemoryStore::new();
    // 0.6.0: the keys of an older `config.json` went to the OS store under its names.
    let ui = start_system(dir.path(), &older, Some(python_era()));
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
    ui.ok("/run/shutdown", None);
    ui.stop();
    let kept = older.snapshot();
    assert_eq!(kept.len(), 3);

    let vault = MemoryStore::new();
    let ui = start_with_older(dir.path(), &vault, &older, None);
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
    assert_eq!(ui.ok("/get/data/openai_auth_key", None), OPENAI);
    assert_eq!(ui.ok("/get/data/deepgram_auth_key", None), DEEPGRAM);
    assert!(ui.on(0, "/run/secret_store_failed").is_empty(), "{:?}", ui.on(0, "/run/secret_store_failed"));
    for (entry, key) in [("AUTH_KEYS/DeepL_API", DEEPL), ("AUTH_KEYS/OpenAI_API", OPENAI), ("TRANSCRIPTION_AUTH_KEYS/Deepgram", DEEPGRAM)] {
        assert_eq!(in_vault(&vault, dir.path(), entry).as_deref(), Some(key), "{entry} is under the new names");
    }
    assert_eq!(older.snapshot(), kept, "0.6.0 still finds its keys");
    assert!(![DEEPL, OPENAI, DEEPGRAM].iter().any(|key| raw_secrets(dir.path()).contains(key)), "never through the file");

    // Deleting a key removes it under both names: it does not come back from the old ones.
    ui.ok("/delete/data/deepl_auth_key", None);
    ui.ok("/run/shutdown", None);
    ui.stop();
    assert_eq!(in_vault(&vault, dir.path(), "AUTH_KEYS/DeepL_API"), None);
    assert_eq!(in_vault(&older, dir.path(), "AUTH_KEYS/DeepL_API"), None);

    let ui = start_with_older(dir.path(), &vault, &older, None);
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), Value::Null);
    assert_eq!(ui.ok("/get/data/openai_auth_key", None), OPENAI);
    ui.ok("/run/shutdown", None);
    ui.stop();
    let log = process_log(dir.path());
    assert!(![DEEPL, OPENAI, DEEPGRAM].iter().any(|key| log.contains(key)), "a key reached the log");
}

#[test]
fn a_key_under_the_names_of_0_6_0_that_cannot_be_copied_works_and_is_tried_again() {
    let dir = tempfile::tempdir().unwrap();
    let older = MemoryStore::new();
    let ui = start_system(dir.path(), &older, Some(python_era()));
    ui.ok("/run/shutdown", None);
    ui.stop();

    let vault = MemoryStore::new();
    vault.set_faults(Faults { write: true, ..Faults::default() });
    let ui = start_with_older(dir.path(), &vault, &older, None);
    // The copy fails: the key from the old names works for the run, and the failure is told.
    assert_eq!(entries(&store_failure(&ui, "migrate")).len(), 3);
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
    ui.ok("/run/shutdown", None);
    ui.stop();
    assert!(vault.snapshot().is_empty());
    assert_eq!(older.snapshot().len(), 3, "nothing lost");

    vault.set_faults(Faults::default());
    let ui = start_with_older(dir.path(), &vault, &older, None);
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), DEEPL);
    assert_eq!(in_vault(&vault, dir.path(), "AUTH_KEYS/DeepL_API").as_deref(), Some(DEEPL));
    ui.ok("/run/shutdown", None);
    ui.stop();
}

/// The PC's real OS store: a key 0.6.0 kept under its names is found, copied to the new names,
/// and deleting it leaves nothing under either. The key is a made-up value under a settings
/// folder of its own. Run with `cargo test --test secret_store -- --ignored`.
#[test]
#[ignore = "uses the signed-in user's OS credential store"]
fn the_real_os_store_moves_a_key_from_the_names_of_0_6_0() {
    const KEY: &str = "test-only-value-3-not-a-real-key";
    let dir = tempfile::tempdir().unwrap();
    let older: Arc<dyn Vault> = astarot_core::config::secrets::older_os_vault().expect("an OS store on this platform");
    // As 0.6.0 kept it: the folder's id in `secrets.json`, the key under the old names.
    SystemStore::new(FileStore::new(dir.path().join(FILE_NAME)), Arc::clone(&older)).write("AUTH_KEYS/DeepL_API", KEY).unwrap();
    let scope = store_id(dir.path());
    let start = || {
        let ui = Ui::with(Setup {
            dir: Some(dir.path().to_path_buf()),
            services: Services { secret_store: Arc::new(astarot_core::config::secrets::default_store), ..Setup::default().services },
            ..Setup::default()
        });
        ui.ready();
        ui
    };
    let ui = start();
    assert!(ui.on(0, "/run/secret_store_failed").is_empty(), "{:?}", ui.on(0, "/run/secret_store_failed"));
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), KEY);
    ui.ok("/run/shutdown", None);
    ui.stop();
    let current = astarot_core::config::secrets::os_vault();
    assert_eq!(current.fetch(&scope, "AUTH_KEYS/DeepL_API"), Ok(Some(KEY.to_string())), "under the new names");
    assert_eq!(older.fetch(&scope, "AUTH_KEYS/DeepL_API"), Ok(Some(KEY.to_string())), "and still under the old ones");

    let ui = start();
    ui.ok("/delete/data/deepl_auth_key", None);
    assert!(ui.on(0, "/run/secret_store_failed").is_empty());
    ui.ok("/run/shutdown", None);
    ui.stop();
    assert_eq!(current.fetch(&scope, "AUTH_KEYS/DeepL_API"), Ok(None), "nothing left under the new names");
    assert_eq!(older.fetch(&scope, "AUTH_KEYS/DeepL_API"), Ok(None), "nor under the old ones");
}

#[test]
fn a_store_that_cannot_be_read_is_reported_and_its_keys_are_left_alone() {
    let dir = tempfile::tempdir().unwrap();
    let store = MemoryStore::new();
    store.insert("AUTH_KEYS/DeepL_API", DEEPL);
    store.set_faults(Faults { read: true, ..Faults::default() });
    let ui = start(dir.path(), &store, None);

    let failure = store_failure(&ui, "read");
    assert!(entries(&failure).contains(&"AUTH_KEYS/DeepL_API".to_string()));
    assert_eq!(failure["reason"], "unreadable");
    assert_eq!(ui.ok("/get/data/deepl_auth_key", None), Value::Null);
    ui.ok("/run/shutdown", None);
    ui.stop();
    // Not knowing the key is no reason to forget it.
    assert_eq!(store.get("AUTH_KEYS/DeepL_API").as_deref(), Some(DEEPL));
}
