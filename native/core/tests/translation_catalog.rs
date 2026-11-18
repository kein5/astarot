//! The translation catalog through the IPC surface (#413): the two groups (inference engines
//! and APIs), the built-in entries next to the user's, and adding, using and removing an entry
//! of each group. The OpenAI-compatible endpoint is a stand-in on a loopback port
//! (`vrct_translation::fake`); the engine models are folders of tiny fake files, as in
//! `translation_models.rs`. The OS credential store the keys go to is in memory, as in
//! `secret_store.rs`: the PC's own is never touched. Nothing leaves this PC.

mod common;

use common::{Setup, Ui};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use vrct_core::config::secrets::{FILE_NAME, Faults, MemoryStore};
use vrct_core::controller::Services;
use vrct_translation::fake::FakeProviders;
use vrct_translation::providers::Endpoints;

const FILES: [(&str, &str); 4] = [("encoder.onnx", "a"), ("decoder.onnx", "b"), ("tokenizer.json", "c"), ("vocab.json", "d")];

fn sha(data: &[u8]) -> String {
    vrct_voice_conversion::runtime::sha256_hex(data)
}

fn write_model(dir: &Path, family: &str, languages: &[&str]) {
    let files: serde_json::Map<String, Value> =
        FILES.iter().map(|(name, content)| (name.to_string(), json!({"size": content.len(), "sha256": sha(content.as_bytes())}))).collect();
    let manifest = json!({
        "schema": 2, "name": "test", "family": family, "license": "MIT", "variant": "int8",
        "encoder": "encoder.onnx", "decoder": "decoder.onnx",
        "decoder_layers": 2, "decoder_attention_heads": 4, "hidden_size": 16,
        "decoder_start_token": "</s>", "end_token": "</s>", "unknown_token": "<unk>",
        "language_token": "__{}__", "languages": languages,
        "beam_size": 2, "max_input_length": 1024, "max_decoding_length": 256,
        "files": files,
    });
    std::fs::create_dir_all(dir).unwrap();
    for (name, content) in FILES {
        std::fs::write(dir.join(name), content).unwrap();
    }
    std::fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
}

fn start_in(dir: &Path, services: Services) -> Ui {
    let ui = Ui::with(Setup { services, dir: Some(dir.to_path_buf()), ..Setup::default() });
    ui.ready();
    ui
}

fn process_log(ui: &Ui) -> String {
    std::fs::read_to_string(ui.dir.join("logs").join("process.log")).unwrap_or_default()
}

fn refused(ui: &Ui, endpoint: &str, data: Value) -> (u64, String) {
    let answer = ui.request(endpoint, Some(data));
    (answer["status"].as_u64().unwrap_or_default(), answer["result"]["error_code"].as_str().unwrap_or_default().to_string())
}

fn user_entries(catalog: &Value, group: &str) -> Vec<Value> {
    catalog[group].as_array().unwrap().iter().filter(|e| e["origin"] == "user").cloned().collect()
}

/// The app's key store over `secrets.json`, with `vault` standing in for the OS credential store,
/// and the providers at `fake`.
fn api_services(fake: &FakeProviders, vault: &Arc<MemoryStore>) -> Services {
    Services { translation_endpoints: Endpoints::all_at(&fake.url()), secret_store: vault.system_source(), ..Setup::default().services }
}

/// An API entry's key in the stand-in OS store, under the id `secrets.json` gives this settings
/// folder.
fn in_vault(vault: &MemoryStore, dir: &Path, id: &str) -> Option<String> {
    let file: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(FILE_NAME)).unwrap()).unwrap();
    let scope = file["store_id"].as_str().expect("an id once a key is kept");
    vault.get(&MemoryStore::scoped(scope, &format!("TRANSLATION_CATALOG/{id}")))
}

#[test]
fn an_api_entry_keeps_its_key_in_the_store_and_switches_the_compatible_engine() {
    let fake = FakeProviders::start();
    fake.key("/compatible/v1", "lan-key").models("/compatible/v1", &["mistral", "qwen"]);
    let vault = MemoryStore::new();
    let temp = tempfile::tempdir().unwrap();
    let ui = start_in(temp.path(), api_services(&fake, &vault));
    let url = fake.url_of("/compatible/v1");

    // The built-in entries of both groups, told apart from the user's by `origin`.
    let catalog = ui.ok("/get/data/translation_catalog", None);
    let builtin = |group: &str, id: &str| catalog[group].as_array().unwrap().iter().find(|e| e["id"] == id).cloned().unwrap_or_default();
    assert_eq!(builtin("engine", "m2m100_418M-ct2-int8")["origin"], "builtin");
    assert_eq!(builtin("engine", "nllb-200-distilled-600M-ct2-int8")["non_commercial"], true);
    assert_eq!(builtin("api", "DeepL_API")["kind"], "cloud");
    assert_eq!(builtin("api", "Ollama")["kind"], "local_server");
    assert!(builtin("api", "CTranslate2").is_null(), "the local engine is not an API");
    assert_eq!(catalog["protocols"], json!(["openai_compatible"]));
    assert!(user_entries(&catalog, "api").is_empty());

    let request = |name: &str, url: &str, key: Value| json!({ "group": "api", "name": name, "protocol": "openai_compatible", "url": url, "model": "qwen", "auth_key": key });
    let register = "/run/register_translation_catalog_entry";
    assert_eq!(refused(&ui, register, request("LAN", &url, Value::Null)), (400, "translation_catalog_key_required".into()));
    // Plain HTTP only to this PC and the LAN, as for the OpenAI-compatible engine.
    assert_eq!(refused(&ui, register, request("LAN", "http://example.com/v1", json!("lan-key"))), (400, "translation_catalog_url_invalid".into()));
    assert_eq!(refused(&ui, register, json!({ "group": "api", "name": "x" })), (400, "translation_catalog_invalid".into()));

    let catalog = ui.ok(register, Some(request("LAN server", &url, json!(" lan-key "))));
    let entry = user_entries(&catalog, "api")[0].clone();
    assert_eq!((entry["name"].clone(), entry["has_key"].clone(), entry["in_use"].clone()), (json!("LAN server"), json!(true), json!(false)));
    let id = entry["id"].as_str().unwrap().to_string();
    let store = ui.backend.core().config().secret_store();
    assert_eq!(store.read(&format!("TRANSLATION_CATALOG/{id}")).unwrap().as_deref(), Some("lan-key"));
    // In the OS store under this settings folder's id, and in no file.
    assert_eq!(in_vault(&vault, temp.path(), &id).as_deref(), Some("lan-key"));
    for file in ["translation_catalog.json", FILE_NAME] {
        let text = std::fs::read_to_string(temp.path().join(file)).unwrap();
        assert!(!text.contains("lan-key"), "the key stays out of {file}");
    }
    assert_eq!(refused(&ui, register, request("LAN server", &url, json!("lan-key"))), (409, "translation_catalog_exists".into()));

    // Using it checks the address with the key, then points the compatible engine at it.
    let catalog = ui.ok("/run/use_translation_catalog_entry", Some(json!({ "id": id })));
    assert_eq!(user_entries(&catalog, "api")[0]["in_use"], true);
    assert!(catalog.get("warning").is_none(), "{catalog}");
    assert_eq!(ui.ok("/get/data/openai_compatible_url", None), json!(url));
    assert_eq!(ui.ok("/get/data/selected_openai_compatible_model", None), "qwen");
    let compatible = catalog["api"].as_array().unwrap().iter().find(|e| e["id"] == "OpenAI_Compatible").cloned().unwrap();
    assert_eq!((compatible["origin"].clone(), compatible["available"].clone()), (json!("builtin"), json!(true)));

    // A model the endpoint does not list: switched, with a warning, on another model.
    let other = ui.ok(register, Some(json!({ "group": "api", "name": "Other", "protocol": "openai_compatible", "url": url, "model": "gone", "auth_key": "lan-key" })));
    let other_id = user_entries(&other, "api")[1]["id"].as_str().unwrap().to_string();
    let catalog = ui.ok("/run/use_translation_catalog_entry", Some(json!({ "id": other_id })));
    assert_eq!(catalog["warning"], "translation_catalog_model_not_listed");

    // Removing forgets the entry and its key, and leaves the engine as it is.
    let catalog = ui.ok("/run/remove_translation_catalog_entry", Some(json!({ "id": id })));
    assert_eq!(user_entries(&catalog, "api").len(), 1);
    assert_eq!(store.read(&format!("TRANSLATION_CATALOG/{id}")).unwrap(), None);
    assert_eq!(in_vault(&vault, temp.path(), &id), None);
    assert_eq!(ui.ok("/get/data/openai_compatible_url", None), json!(url));
    assert_eq!(refused(&ui, "/run/use_translation_catalog_entry", json!({ "id": id })), (400, "translation_catalog_unknown".into()));

    let log = process_log(&ui);
    for secret in ["lan-key", "LAN server"] {
        let leaks: Vec<&str> = log.lines().filter(|line| line.contains(secret)).collect();
        assert!(leaks.is_empty(), "{secret} reached the log: {leaks:?}");
    }
    // The address is masked in the catalog's own lines (`/get/data/openai_compatible_url`
    // logs it, as it always did).
    let leaks: Vec<&str> = log.lines().filter(|line| line.contains("translation_catalog") && line.contains("/compatible/v1")).collect();
    assert!(leaks.is_empty(), "{leaks:?}");
    ui.stop();
}

#[test]
fn an_api_entry_whose_key_the_os_store_does_not_take_is_not_added() {
    // A locked keyring, and an OS store that is not there (Linux without a Secret Service).
    let fake = FakeProviders::start();
    fake.key("/compatible/v1", "lan-key").models("/compatible/v1", &["qwen"]);
    let url = fake.url_of("/compatible/v1");
    for faults in [Faults { locked: true, ..Faults::default() }, Faults { unavailable: true, ..Faults::default() }] {
        let vault = MemoryStore::new();
        vault.set_faults(faults);
        let temp = tempfile::tempdir().unwrap();
        let ui = start_in(temp.path(), api_services(&fake, &vault));

        let request = json!({ "group": "api", "name": "LAN server", "protocol": "openai_compatible", "url": url, "model": "qwen", "auth_key": "lan-key" });
        assert_eq!(refused(&ui, "/run/register_translation_catalog_entry", request), (400, "translation_catalog_key_store_failed".into()), "{faults:?}");
        assert!(user_entries(&ui.ok("/get/data/translation_catalog", None), "api").is_empty(), "{faults:?}: no entry without its key");
        assert!(vault.snapshot().is_empty(), "{faults:?}");
        for file in ["translation_catalog.json", FILE_NAME, "config.json"] {
            let text = std::fs::read_to_string(temp.path().join(file)).unwrap_or_default();
            assert!(!text.contains("lan-key"), "{faults:?}: the key reached {file}");
        }
        let log = process_log(&ui);
        for secret in ["lan-key", "LAN server"] {
            assert!(!log.contains(secret), "{faults:?}: {secret} reached the log");
        }
        ui.stop();
    }
}

#[cfg(feature = "onnx-translation")]
#[test]
fn an_engine_entry_is_a_local_weight_with_the_languages_it_offers() {
    let temp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let model = outside.path().join("my nllb");
    write_model(&model, "m2m100", &["en", "ja", "ko"]);
    let marian = outside.path().join("marian");
    write_model(&marian, "marian", &["en"]);
    // A folder model of the old kind is listed in the same group.
    write_model(&temp.path().join("data").join("translation-models").join("dropped"), "m2m100", &["en", "ja"]);
    let services = Services { telemetry_forced_off: Arc::new(|| true), ..Setup::default().services };
    let ui = start_in(temp.path(), services);

    let catalog = ui.ok("/get/data/translation_catalog", None);
    let folder = catalog["engine"].as_array().unwrap().iter().find(|e| e["id"] == "custom:dropped").cloned().unwrap();
    assert_eq!((folder["origin"].clone(), folder["available"].clone()), (json!("folder"), json!(true)));
    assert_eq!(catalog["runtimes"], json!(["onnx"]));

    let register = "/run/register_translation_catalog_entry";
    let request = |name: &str, folder: &Path, languages: Value| json!({ "group": "engine", "name": name, "runtime": "onnx", "folder": folder.to_string_lossy(), "languages": languages });
    assert_eq!(refused(&ui, register, request("Marian", &marian, json!([]))), (400, "translation_architecture_unsupported".into()));
    assert_eq!(refused(&ui, register, request("Nothing", &model, json!(["xx"]))), (400, "translation_languages_unknown".into()));
    assert_eq!(refused(&ui, register, request("Gone", &outside.path().join("gone"), json!([]))), (400, "translation_catalog_folder_missing".into()));
    assert_eq!(
        refused(&ui, register, json!({ "group": "engine", "name": "Gemma", "runtime": "gguf", "folder": model.to_string_lossy() })),
        (400, "translation_catalog_runtime_unsupported".into())
    );

    let catalog = ui.ok(register, Some(request("My NLLB", &model, json!(["ja", "en"]))));
    let entry = user_entries(&catalog, "engine")[0].clone();
    let id = entry["id"].as_str().unwrap().to_string();
    let weight = format!("user:{id}");
    assert_eq!((entry["weight"].clone(), entry["available"].clone(), entry["status"].clone()), (json!(weight), json!(true), json!("ok")));
    assert_eq!(ui.ok("/get/data/selectable_ctranslate2_weight_type_dict", None)[&weight], true);

    // Using it selects it as the local model; the languages are the ones the entry offers.
    let catalog = ui.ok("/run/use_translation_catalog_entry", Some(json!({ "id": id })));
    assert_eq!(user_entries(&catalog, "engine")[0]["in_use"], true);
    assert_eq!(ui.ok("/get/data/selected_ctranslate2_weight_type", None), json!(weight));
    let mut target = ui.ok("/get/data/selected_target_languages", None);
    target["1"]["1"] = json!({ "language": "Korean", "country": "South Korea", "enable": true });
    let mark = ui.send("/set/data/selected_target_languages", Some(target));
    ui.wait_endpoint(mark, "/set/data/selected_target_languages");
    let reset = ui.wait_endpoint(mark, "/run/translation_language_unsupported");
    assert_eq!(reset["result"]["data"]["languages"], json!(["Korean"]), "Korean is in the model but not offered");

    // The selected model cannot be removed; another one first.
    assert_eq!(refused(&ui, "/run/remove_translation_catalog_entry", json!({ "id": id })), (409, "translation_catalog_in_use".into()));
    ui.ok("/set/data/selected_ctranslate2_weight_type", Some(json!("custom:dropped")));
    let catalog = ui.ok("/run/remove_translation_catalog_entry", Some(json!({ "id": id })));
    assert!(user_entries(&catalog, "engine").is_empty());
    assert!(ui.ok("/get/data/selectable_ctranslate2_weight_type_dict", None).get(&weight).is_none());
    assert!(model.is_dir(), "the folder is left alone");

    let log = process_log(&ui);
    assert!(!log.contains("My NLLB") && !log.contains("my nllb"), "a name or folder reached the log");
    ui.stop();
}

#[cfg(feature = "onnx-translation")]
#[test]
fn an_engine_entry_is_found_again_at_start_and_reported_when_its_folder_breaks() {
    let temp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let model = outside.path().join("mine");
    write_model(&model, "m2m100", &["en", "ja"]);
    let services = || Services { telemetry_forced_off: Arc::new(|| true), ..Setup::default().services };
    let ui = start_in(temp.path(), services());
    let request = json!({ "group": "engine", "name": "Mine", "runtime": "onnx", "folder": model.to_string_lossy() });
    let id = user_entries(&ui.ok("/run/register_translation_catalog_entry", Some(request)), "engine")[0]["id"].as_str().unwrap().to_string();
    ui.ok("/run/use_translation_catalog_entry", Some(json!({ "id": id })));
    ui.stop();

    let ui = start_in(temp.path(), services());
    assert_eq!(ui.ok("/get/data/selected_ctranslate2_weight_type", None), json!(format!("user:{id}")));
    ui.stop();

    // A file the manifest lists is gone: the entry stays, the weight is not offered, and the
    // setting falls back to the default model.
    std::fs::remove_file(model.join("vocab.json")).unwrap();
    let ui = start_in(temp.path(), services());
    assert_eq!(ui.ok("/get/data/selected_ctranslate2_weight_type", None), "m2m100_418M-ct2-int8");
    let entry = user_entries(&ui.ok("/get/data/translation_catalog", None), "engine")[0].clone();
    assert_eq!((entry["status"].clone(), entry["available"].clone()), (json!("ok"), json!(false)));
    assert_eq!(refused(&ui, "/run/use_translation_catalog_entry", json!({ "id": id })), (409, "translation_catalog_unusable".into()));
    let log = process_log(&ui);
    assert!(log.contains(&format!("Translation model folder refused: {id} (translation_file_missing)")), "{log}");
    ui.stop();
}
