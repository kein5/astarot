//! The local translation on ONNX Runtime through the IPC surface, with model folders made of
//! tiny fake files (no real model, no ONNX Runtime needed): which folder a weight and a compute
//! type choose, the retired `<data>/translation-models` folder (#597: not listed, a saved
//! selection of it goes back to the default), the compute device list, and a translation model that comes through the consent
//! catalog. Loading a fake graph fails by design: reaching that failure shows the folder was
//! found and verified.

mod common;

use common::{error_code, Setup, Ui};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use astarot_core::controller::Services;
use astarot_ops::downloads::catalog::{Artifact, Model, CATALOG_VERSION, TRANSLATION_TARGET};
use astarot_ops::downloads::transport::{Body, Transport};
use astarot_ops::downloads::{Downloads, Error, Options};

const FILES: [(&str, &str); 4] = [("encoder.onnx", "a"), ("decoder.onnx", "b"), ("tokenizer.json", "c"), ("vocab.json", "d")];

fn sha(data: &[u8]) -> String {
    astarot_voice_conversion::runtime::sha256_hex(data)
}

/// A manifest of the fake files, as `export.py` writes it.
fn manifest(family: &str, variant: Option<&str>, languages: &[&str]) -> Value {
    let files: serde_json::Map<String, Value> =
        FILES.iter().map(|(name, content)| (name.to_string(), json!({"size": content.len(), "sha256": sha(content.as_bytes())}))).collect();
    let mut manifest = json!({
        "schema": if variant.is_some() { 2 } else { 1 }, "name": "test", "family": family, "license": "MIT",
        "encoder": "encoder.onnx", "decoder": "decoder.onnx",
        "decoder_layers": 2, "decoder_attention_heads": 4, "hidden_size": 16,
        "decoder_start_token": "</s>", "end_token": "</s>", "unknown_token": "<unk>",
        "language_token": if family == "m2m100" { "__{}__" } else { "{}" }, "languages": languages,
        "beam_size": 2, "max_input_length": 1024, "max_decoding_length": 256,
        "files": files,
    });
    if let Some(variant) = variant {
        manifest["variant"] = json!(variant);
    }
    manifest
}

fn write_folder(dir: &Path, manifest: &Value) {
    std::fs::create_dir_all(dir).unwrap();
    for (name, content) in FILES {
        std::fs::write(dir.join(name), content).unwrap();
    }
    std::fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
}

fn start_in(dir: &Path, saved: Option<Value>, services: Services) -> Ui {
    let ui = Ui::with(Setup { saved, services, dir: Some(dir.to_path_buf()), ..Setup::default() });
    ui.ready();
    ui
}

fn services() -> Services {
    Services { telemetry_forced_off: Arc::new(|| true), ..Setup::default().services }
}

fn process_log(ui: &Ui) -> String {
    std::fs::read_to_string(ui.dir.join("logs").join("process.log")).unwrap_or_default()
}

fn enable(ui: &Ui) -> (String, Value) {
    let answer = ui.request("/set/enable/translation", None);
    (error_code(&answer).to_string(), answer["result"].clone())
}

#[test]
fn the_cpu_is_listed_with_its_saved_name_and_the_onnx_compute_types() {
    // No ONNX Runtime beside the test executable: only the CPU, and nothing is loaded.
    let devices = astarot_core::controller::translation::compute_devices();
    assert_eq!(devices[0]["device"], "cpu");
    assert_eq!(devices[0]["device_index"], 0);
    assert_eq!(devices[0]["device_name"], "cpu");
    assert_eq!(devices[0]["compute_types"], json!(["auto", "float32", "int8", "int8_float32", "int4"]));
}

#[test]
fn a_gpu_build_set_up_during_the_run_is_offered_for_the_next_start() {
    use astarot_voice_conversion::runtime::{self as runtimes, Target};
    let Some(target) = Target::current() else { return };
    let temp = tempfile::tempdir().unwrap();
    let ui = start_in(temp.path(), None, services());
    let list = "/get/data/selectable_translation_compute_device_list";
    assert_eq!(ui.ok(list, None).as_array().unwrap().len(), 1);

    // The CUDA build, as its setup leaves it (the files are empty: nothing loads them here).
    let runtime = runtimes::onnx_cuda_runtime(target);
    let folder = temp.path().join("vc_runtimes").join(runtime.id);
    std::fs::create_dir_all(folder.join("lib")).unwrap();
    for (_, name) in runtime.libraries.iter().flat_map(|library| &library.members) {
        std::fs::write(folder.join("lib").join(name), b"").unwrap();
    }
    std::fs::write(folder.join("receipt.json"), json!({ "version": runtimes::version_of(&runtime), "id": runtime.id }).to_string()).unwrap();

    let devices = ui.ok(list, None);
    assert_eq!(devices.as_array().unwrap().len(), 2);
    let cuda = devices[1].clone();
    assert_eq!((cuda["device"].as_str(), cuda["restart_required"].as_bool()), (Some("cuda"), Some(true)));
    let chosen = ui.ok(
        "/set/data/selected_translation_compute_device",
        Some(json!({ "device": "cuda", "device_index": 0, "device_name": cuda["device_name"] })),
    );
    assert_eq!(chosen, cuda);
    // Asked again, the list stays as it is.
    assert_eq!(ui.ok(list, None), devices);
    // Not in use before the next start.
    assert_eq!(ui.ok("/get/data/compute_mode", None), "cpu");
}

#[test]
fn a_built_in_weight_finds_its_hand_placed_folder_by_compute_type() {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().join("data").join("weights").join("translate-onnx").join("m2m100_418M-onnx-int8");
    write_folder(&folder, &manifest("m2m100", None, &["en", "ja"]));
    // A folder whose manifest says another variant than its name is not used.
    let wrong = temp.path().join("data").join("weights").join("translate-onnx").join("m2m100_418M-onnx-float32");
    write_folder(&wrong, &manifest("m2m100", Some("int8"), &["en", "ja"]));
    let ui = start_in(temp.path(), None, services());
    let weights = ui.ok("/get/data/selectable_ctranslate2_weight_type_dict", None);
    assert_eq!(weights["m2m100_418M-ct2-int8"], true);
    assert_eq!(weights["nllb-200-distilled-600M-ct2-int8"], false);

    // `auto` on the CPU takes int8: the folder is verified and its fake graph fails to load.
    assert_eq!(enable(&ui), ("TRANSLATION_MODEL_LOAD_FAILED".to_string(), json!({
        "error_code": "TRANSLATION_MODEL_LOAD_FAILED",
        "message": "The CTranslate2 model could not be loaded; translation was not enabled",
        "data": false, "details": {}, "category": "translation", "severity": "error",
    })));
    // float32 is not installed (the float32 folder holds int8): the model is missing.
    ui.ok("/set/data/selected_translation_compute_type", Some(json!("float32")));
    assert_eq!(enable(&ui).0, "TRANSLATION_MODEL_MISSING");
    ui.ok("/set/data/selected_translation_compute_type", Some(json!("int8_float32")));
    assert_eq!(enable(&ui).0, "TRANSLATION_MODEL_LOAD_FAILED");
    assert!(!process_log(&ui).contains("panicked"));

    // The same size, other bytes: the folder no longer verifies.
    std::fs::write(folder.join("decoder.onnx"), "x").unwrap();
    assert_eq!(enable(&ui).0, "TRANSLATION_MODEL_MISSING");
    ui.stop();
}

#[test]
fn models_in_the_retired_folder_are_not_listed_and_a_saved_selection_goes_back_to_the_default() {
    // A user of an earlier version: a valid model in `<data>/translation-models/`, selected.
    let temp = tempfile::tempdir().unwrap();
    let models = temp.path().join("data").join("translation-models");
    write_folder(&models.join("my-secret-model"), &manifest("m2m100", Some("int8"), &["en", "ja"]));
    let saved = json!({ "CTRANSLATE2_WEIGHT_TYPE": "custom:my-secret-model" });
    let ui = start_in(temp.path(), Some(saved), services());

    // Not listed, not selectable; the selection is the default model, and start-up went on.
    let weights = ui.ok("/get/data/selectable_ctranslate2_weight_type_dict", None);
    assert!(weights.as_object().unwrap().keys().all(|k| !k.starts_with("custom:")), "{weights}");
    assert_eq!(ui.ok("/get/data/selected_ctranslate2_weight_type", None), "m2m100_418M-ct2-int8");
    // Translation still answers as for a missing default model, without a panic.
    assert_eq!(enable(&ui).0, "TRANSLATION_MODEL_MISSING");

    // The catalog has no item for it and says only that the folder holds something.
    let catalog = ui.ok("/get/data/translation_catalog", None);
    let engine = catalog["engine"].as_array().unwrap();
    assert!(engine.iter().all(|e| e["origin"] == "builtin" || e["origin"] == "user"), "{catalog}");
    assert!(engine.iter().all(|e| !e["id"].as_str().unwrap().starts_with("custom:")), "{catalog}");
    assert_eq!(catalog["retired_folder_used"], true);
    assert!(!catalog.to_string().contains("my-secret-model"), "{catalog}");

    // The reason is in the log as a fixed code; the folder's name is not.
    let log = process_log(&ui);
    assert!(log.contains("Translation model selection reset to the default (translation_models_folder_retired)"), "{log}");
    assert!(!log.contains("my-secret-model"), "{log}");
    assert!(!process_log(&ui).contains("panicked"));
    // Asked for by name, it is refused and the selection stays.
    let refused = ui.request("/set/data/selected_ctranslate2_weight_type", Some(json!("custom:my-secret-model")));
    assert_ne!(refused["status"], 200, "{refused}");
    assert_eq!(ui.ok("/get/data/selected_ctranslate2_weight_type", None), "m2m100_418M-ct2-int8");
    ui.stop();
    // The user's folder and files are left as they are.
    assert!(models.join("my-secret-model").join("manifest.json").is_file());
    assert!(models.join("my-secret-model").join("encoder.onnx").is_file());

    // The next start no longer names the old selection.
    let ui = start_in(temp.path(), None, services());
    assert_eq!(ui.ok("/get/data/selected_ctranslate2_weight_type", None), "m2m100_418M-ct2-int8");
    assert!(!process_log(&ui).contains("translation_models_folder_retired"));
    ui.stop();
}

#[test]
fn the_catalog_says_whether_the_retired_folder_holds_a_folder() {
    let temp = tempfile::tempdir().unwrap();
    let models = temp.path().join("data").join("translation-models");
    let ui = start_in(temp.path(), None, services());
    // No folder at all.
    assert_eq!(ui.ok("/get/data/translation_catalog", None)["retired_folder_used"], false);
    // Only files and a hidden folder: earlier versions listed nothing from these either.
    std::fs::create_dir_all(models.join(".cache")).unwrap();
    std::fs::write(models.join("readme.txt"), "x").unwrap();
    assert_eq!(ui.ok("/get/data/translation_catalog", None)["retired_folder_used"], false);
    // Any folder, even one that is not a model; asked again, so moving it out is seen.
    std::fs::create_dir_all(models.join("anything")).unwrap();
    assert_eq!(ui.ok("/get/data/translation_catalog", None)["retired_folder_used"], true);
    std::fs::remove_dir_all(models.join("anything")).unwrap();
    assert_eq!(ui.ok("/get/data/translation_catalog", None)["retired_folder_used"], false);
    ui.stop();
}

/// Serves each file of a translation entry by name.
fn translation_services(manifest_bytes: Vec<u8>) -> (Services, Model) {
    let mut artifacts = vec![Artifact {
        filename: "manifest.json".into(),
        size: manifest_bytes.len() as u64,
        sha256: sha(&manifest_bytes),
        role: "manifest".into(),
        remote: None,
    }];
    let roles = ["encoder", "decoder", "tokenizer", "vocabulary"];
    for ((name, content), role) in FILES.iter().zip(roles) {
        artifacts.push(Artifact { filename: name.to_string(), size: content.len() as u64, sha256: sha(content.as_bytes()), role: role.into(), remote: None });
    }
    let entry = Model {
        id: "m2m100-418m-onnx-int8".into(),
        target: TRANSLATION_TARGET.into(),
        name: "M2M100 418M · int8".into(),
        provider: "Test".into(),
        repo: "test/models".into(),
        revision: "0123456789abcdef0123456789abcdef01234567".into(),
        license: "MIT".into(),
        licenses: vec!["https://example.invalid/LICENSE".into()],
        notice: "test".into(),
        artifacts,
    };
    let transport: Arc<dyn Transport> = Arc::new(move |url: &str| -> Result<Box<dyn Body>, Error> {
        let name = url.rsplit('/').next().unwrap_or_default();
        let bytes = if name == "manifest.json" {
            manifest_bytes.clone()
        } else {
            FILES.iter().find(|(file, _)| *file == name).map(|(_, c)| c.as_bytes().to_vec()).unwrap_or_default()
        };
        Ok(Box::new(std::io::Cursor::new(bytes)))
    });
    let options = Options { reserve_bytes: 0, free_space: Arc::new(|_| Ok(1 << 40)) };
    let catalog = vec![entry.clone()];
    let services = Services {
        model_downloads: Arc::new(move |root: &Path| Downloads::with(root, catalog.clone(), Arc::clone(&transport), options.clone())),
        speech_binary: Arc::new(|_| Err("no speech.cpp in the tests".into())),
        ..services()
    };
    (services, entry)
}

#[test]
fn a_translation_model_comes_only_through_the_consent_catalog_and_is_then_found() {
    let manifest_bytes = manifest("m2m100", Some("int8"), &["en", "ja"]).to_string().into_bytes();
    let (services, entry) = translation_services(manifest_bytes);
    let temp = tempfile::tempdir().unwrap();
    let ui = start_in(temp.path(), None, services);
    assert_eq!(enable(&ui).0, "TRANSLATION_MODEL_MISSING");
    let catalog = ui.ok("/get/data/model_download_catalog", None);
    assert_eq!(catalog["models"][0]["target"], "translation");
    // No folder to place models in is named any more (#597): the translation catalog adds them.
    assert!(catalog.get("translation_models_folder").is_none(), "{catalog}");

    // Nothing starts without consent to this catalog.
    let refused = ui.request("/run/start_model_download", Some(json!({ "id": entry.id, "consent": false, "catalog_version": CATALOG_VERSION })));
    assert_eq!(refused["status"], 400, "{refused}");
    let answer = ui.request("/run/start_model_download", Some(json!({ "id": entry.id, "consent": true, "catalog_version": CATALOG_VERSION })));
    assert_eq!(answer["status"], 200, "{answer}");
    let deadline = std::time::Instant::now() + common::TIMEOUT;
    let job = loop {
        let job = ui.ok("/get/data/model_download_state", None)["jobs"][&entry.id].clone();
        if job["phase"] == "ready" || job["phase"] == "failed" {
            break job;
        }
        assert!(std::time::Instant::now() < deadline, "{job}");
        std::thread::sleep(std::time::Duration::from_millis(10));
    };
    assert_eq!(job["phase"], "ready", "{job}");
    // A translation entry writes no setting: `expected` is empty, as for chat reading.
    let bad = ui.request("/run/apply_model_download", Some(json!({ "id": entry.id, "job_id": job["job_id"], "expected": {"model": ""} })));
    assert_eq!(bad["result"]["error_code"], "download_request_invalid");
    let mark = ui.send("/run/apply_model_download", Some(json!({ "id": entry.id, "job_id": job["job_id"], "expected": {} })));
    assert_eq!(ui.wait_endpoint(mark, "/run/apply_model_download")["status"], 200);
    let told = ui.wait_endpoint(mark, "/run/downloaded_ctranslate2_weight");
    assert_eq!(told["result"], json!({ "weight_type": "m2m100_418M-ct2-int8", "downloaded": true }));
    assert_eq!(ui.ok("/get/data/selectable_ctranslate2_weight_type_dict", None)["m2m100_418M-ct2-int8"], true);
    // Found in downloaded_models and verified; the fake graph does not load.
    assert_eq!(enable(&ui).0, "TRANSLATION_MODEL_LOAD_FAILED");
    ui.stop();
}

/// A model that loads and says it runs on the CPU because the GPU it was given failed.
struct FellBack;

impl astarot_core::controller::translation::LocalTranslation for FellBack {
    fn load(&self, _setup: &astarot_core::controller::translation::LocalSetup) -> Result<(), astarot_core::controller::translation::LocalError> {
        Ok(())
    }
    fn loaded(&self) -> Option<astarot_core::controller::translation::LocalSetup> {
        None
    }
    fn translate(&self, text: &str, _source: &str, _target: &str) -> Result<String, astarot_core::controller::translation::LocalError> {
        Ok(text.to_string())
    }
    fn placement(&self) -> Option<astarot_core::controller::translation::Placement> {
        Some(astarot_core::controller::translation::Placement {
            device: "cpu".into(),
            device_index: 0,
            variant: "int8".into(),
            fallback: Some(("directml".into(), "translation_provider_unavailable")),
        })
    }
}

#[test]
fn a_device_that_cannot_start_is_reported_and_translation_still_turns_on() {
    let temp = tempfile::tempdir().unwrap();
    let services = Services { local_translation: Arc::new(|_| Arc::new(FellBack)), ..services() };
    let ui = start_in(temp.path(), None, services);
    let mark = ui.send("/set/enable/translation", None);
    assert_eq!(ui.wait_endpoint(mark, "/set/enable/translation")["result"], true);
    let told = ui.wait_endpoint(mark, "/run/translation_compute_device_fallback");
    assert_eq!(told["status"], 200);
    assert_eq!(told["result"], json!({ "requested": "directml", "used": "cpu", "variant": "int8", "reason": "translation_provider_unavailable" }));
    let log = process_log(&ui);
    assert!(log.contains("directml could not be used (translation_provider_unavailable); running on the CPU"), "{log}");
    ui.stop();
}
