//! The speech recognition APIs the user adds, through the IPC surface (#414): adding an entry
//! (its key goes to the key store), using it (the custom Whisper server engine points at it once
//! the address answers with the key) and removing it. The Whisper-compatible endpoint is a
//! stand-in on a loopback port (`common::fake_asr`); the OS credential store the keys go to is in
//! memory, as in `secret_store.rs`: the PC's own is never touched. Nothing leaves this PC.

mod common;

use common::fake_asr::{FakeAsr, KEY};
use common::{Setup, Ui};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use astarot_core::config::secrets::{FILE_NAME, MemoryStore};
use astarot_core::controller::Services;

fn start_in(dir: &Path, asr: &FakeAsr, vault: &Arc<MemoryStore>) -> Ui {
    let services = Services {
        transcription_endpoints: astarot_transcription::providers::Endpoints::all_at(&asr.base()),
        secret_store: vault.system_source(),
        ..Setup::default().services
    };
    let ui = Ui::with(Setup { services, dir: Some(dir.to_path_buf()), ..Setup::default() });
    ui.ready();
    ui
}

fn refused(ui: &Ui, endpoint: &str, data: Value) -> (u64, String) {
    let answer = ui.request(endpoint, Some(data));
    (answer["status"].as_u64().unwrap_or_default(), answer["result"]["error_code"].as_str().unwrap_or_default().to_string())
}

fn process_log(ui: &Ui) -> String {
    std::fs::read_to_string(ui.dir.join("logs").join("process.log")).unwrap_or_default()
}

/// An entry's key in the stand-in OS store, under the id `secrets.json` gives this settings folder.
fn in_vault(vault: &MemoryStore, dir: &Path, id: &str) -> Option<String> {
    let file: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(FILE_NAME)).unwrap()).unwrap();
    let scope = file["store_id"].as_str().expect("an id once a key is kept");
    vault.get(&MemoryStore::scoped(scope, &format!("TRANSCRIPTION_CATALOG/{id}")))
}

const REGISTER: &str = "/run/register_transcription_catalog_entry";
const USE: &str = "/run/use_transcription_catalog_entry";
const REMOVE: &str = "/run/remove_transcription_catalog_entry";

fn request(name: &str, url: &str, model: &str, key: Value) -> Value {
    json!({ "name": name, "protocol": "openai_compatible", "url": url, "model": model, "auth_key": key })
}

#[test]
fn an_entry_keeps_its_key_in_the_store_and_points_the_custom_whisper_server_at_it() {
    let asr = FakeAsr::start();
    let vault = MemoryStore::new();
    let temp = tempfile::tempdir().unwrap();
    let ui = start_in(temp.path(), &asr, &vault);
    let url = format!("{}/custom/v1", asr.base());

    // Nothing added yet; the protocols this version can use.
    let catalog = ui.ok("/get/data/transcription_catalog", None);
    assert_eq!(catalog, json!({ "api": [], "protocols": ["openai_compatible"] }));

    // A key is required; plain HTTP only to this PC and the LAN, as for the custom server.
    assert_eq!(refused(&ui, REGISTER, request("Home", &url, "", Value::Null)), (400, "transcription_catalog_key_required".into()));
    assert_eq!(refused(&ui, REGISTER, request("Home", "http://example.com/v1", "", json!(KEY))), (400, "transcription_catalog_url_invalid".into()));
    assert_eq!(refused(&ui, REGISTER, json!({ "name": "x" })), (400, "transcription_catalog_invalid".into()));
    assert_eq!(refused(&ui, REGISTER, request("", &url, "", json!(KEY))), (400, "transcription_catalog_name_invalid".into()));

    // Added: nothing is sent to the address, the key is in the store and in no file.
    let catalog = ui.ok(REGISTER, Some(request("Home server", &url, "distil-whisper", json!(format!(" {KEY} ")))));
    let entry = catalog["api"][0].clone();
    assert_eq!(
        (entry["name"].clone(), entry["origin"].clone(), entry["has_key"].clone(), entry["key_in_memory"].clone(), entry["in_use"].clone()),
        (json!("Home server"), json!("user"), json!(true), json!(false), json!(false))
    );
    let id = entry["id"].as_str().unwrap().to_string();
    assert!(id.starts_with("asr-"));
    let store = ui.backend.core().config().secret_store();
    assert_eq!(store.read(&format!("TRANSCRIPTION_CATALOG/{id}")).unwrap().as_deref(), Some(KEY));
    assert_eq!(in_vault(&vault, temp.path(), &id).as_deref(), Some(KEY));
    for file in ["transcription_catalog.json", FILE_NAME] {
        let text = std::fs::read_to_string(temp.path().join(file)).unwrap();
        assert!(!text.contains(KEY), "the key stays out of {file}");
    }
    assert_eq!(refused(&ui, REGISTER, request("Home server", &url, "x", json!(KEY))), (409, "transcription_catalog_exists".into()));
    assert_eq!(refused(&ui, REGISTER, request("Again", &url, "distil-whisper", json!(KEY))), (409, "transcription_catalog_exists".into()));
    assert_eq!(ui.ok("/get/data/custom_whisper_url", None), json!(""), "adding changes no setting");

    // Using it checks the address with the key, then points the custom server engine at it, on
    // the entry's model. The engine selected does not change.
    let engine = ui.ok("/get/data/selected_transcription_engine", None);
    let catalog = ui.ok(USE, Some(json!({ "id": id })));
    assert_eq!(catalog["api"][0]["in_use"], true, "{catalog}");
    assert!(catalog.get("warning").is_none(), "{catalog}");
    assert_eq!(ui.ok("/get/data/custom_whisper_url", None), json!(url));
    assert_eq!(ui.ok("/get/data/selected_custom_whisper_model", None), "distil-whisper");
    assert_eq!(ui.ok("/get/data/selected_transcription_engine", None), engine);

    // A model the endpoint does not list: pointed at all the same, on another model, with a warning.
    let other = ui.ok(REGISTER, Some(request("Gone model", &url, "gone", json!(KEY))));
    let other_id = other["api"][1]["id"].as_str().unwrap().to_string();
    let catalog = ui.ok(USE, Some(json!({ "id": other_id })));
    assert_eq!(catalog["warning"], "transcription_catalog_model_not_listed");
    assert_ne!(ui.ok("/get/data/selected_custom_whisper_model", None), "gone");

    // A key the address refuses: nothing changes.
    let wrong = ui.ok(REGISTER, Some(request("Wrong key", &url, "", json!("wrong"))));
    let wrong_id = wrong["api"][2]["id"].as_str().unwrap().to_string();
    assert_eq!(refused(&ui, USE, json!({ "id": wrong_id })), (400, "transcription_catalog_connect_failed".into()));
    assert_eq!(ui.ok("/get/data/custom_whisper_url", None), json!(url));

    // Removing forgets the entry and its key, and leaves the custom server as it is.
    let catalog = ui.ok(REMOVE, Some(json!({ "id": id })));
    assert_eq!(catalog["api"].as_array().unwrap().len(), 2);
    assert_eq!(store.read(&format!("TRANSCRIPTION_CATALOG/{id}")).unwrap(), None);
    assert_eq!(in_vault(&vault, temp.path(), &id), None);
    assert_eq!(ui.ok("/get/data/custom_whisper_url", None), json!(url));
    assert_eq!(refused(&ui, USE, json!({ "id": id })), (400, "transcription_catalog_unknown".into()));
    assert_eq!(refused(&ui, REMOVE, json!({ "id": id })), (400, "transcription_catalog_unknown".into()));

    // The names, the keys and the catalog's addresses never reach the log.
    let log = process_log(&ui);
    for secret in [KEY, "Home server", "Wrong key"] {
        let leaks: Vec<&str> = log.lines().filter(|line| line.contains(secret)).collect();
        assert!(leaks.is_empty(), "{secret} reached the log: {leaks:?}");
    }
    let leaks: Vec<&str> = log.lines().filter(|line| line.contains("transcription_catalog") && line.contains("/custom/v1")).collect();
    assert!(leaks.is_empty(), "{leaks:?}");
    ui.stop();

    // The entries are there at the next start, with their keys.
    let ui = start_in(temp.path(), &asr, &vault);
    let catalog = ui.ok("/get/data/transcription_catalog", None);
    assert_eq!(catalog["api"].as_array().unwrap().len(), 2);
    assert_eq!(catalog["api"][0]["has_key"], true);
    ui.ok(USE, Some(json!({ "id": other_id })));
    ui.stop();
}

#[test]
fn a_file_the_app_cannot_read_is_reported_and_kept() {
    let asr = FakeAsr::start();
    let vault = MemoryStore::new();
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("transcription_catalog.json"), "not JSON").unwrap();
    let ui = start_in(temp.path(), &asr, &vault);
    let catalog = ui.ok("/get/data/transcription_catalog", None);
    assert_eq!((catalog["api"].clone(), catalog["error_code"].clone()), (json!([]), json!("transcription_catalog_unreadable")));
    let url = format!("{}/custom/v1", asr.base());
    assert_eq!(refused(&ui, REGISTER, request("Home", &url, "", json!(KEY))), (409, "transcription_catalog_unreadable".into()));
    assert_eq!(std::fs::read_to_string(temp.path().join("transcription_catalog.json")).unwrap(), "not JSON");
    ui.stop();
}
