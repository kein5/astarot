//! API keys live in a store of their own, not in `config.json` (`vrct_core::config::secrets`).
//! Through the protocol: keys saved by an older version (Python or an earlier core) move to the
//! store, the endpoints answer as before, a failing store never loses a key silently, and a
//! deleted key leaves the store. The store here is in memory; the PC's own is never touched.

mod common;

use common::{error_code, Setup, Ui};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use vrct_core::config::secrets::{Faults, MemoryStore};
use vrct_core::controller::Services;
use vrct_translation::fake::FakeProviders;

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
        translation_endpoints: vrct_translation::providers::Endpoints::all_at(&fake.url()),
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
