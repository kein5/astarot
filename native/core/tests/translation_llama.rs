//! A translation LLM (TranslateGemma) on llama.cpp's server as the local translation (ADR-015):
//! the app's [`Routed`] translation over a stand-in server (`fake-llama-core`, which answers the
//! prompt's text in upper case) set up as the runtime setup leaves it. No model, GPU or network.

use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use astarot_core::config::{Environment, Platform};
use astarot_core::controller::translation::{LocalError, LocalSetup, LocalTranslation};
use astarot_core::controller::translation_llama::{self, Routed};
use astarot_ops::downloads::translation_catalog::{TranslationCatalog, FILE_NAME};
use astarot_voice_conversion::runtime::{llama_server_name, llamacpp_runtime, version_of, Target};

const FAKE: &str = env!("CARGO_BIN_EXE_fake-llama-core");

fn environment(dir: &Path) -> Environment {
    Environment {
        version: "test".into(),
        state_dir: dir.join("state"),
        app_dir: dir.join("app"),
        data_dir: dir.join("data"),
        platform: Platform::current(),
        compute_devices: vec![Environment::cpu_device()],
        devices: None,
        websocket_token: None,
    }
}

/// What a finished setup of llama.cpp's server leaves, with the stand-in as the server.
fn set_up_server(env: &Environment) {
    let target = Target::current().expect("Windows or Linux on x86-64");
    let runtime = llamacpp_runtime(target);
    let folder = env.state_dir.join("vc_runtimes").join(runtime.id);
    std::fs::create_dir_all(folder.join("lib")).unwrap();
    for (_, name) in runtime.libraries.iter().flat_map(|l| &l.members) {
        std::fs::write(folder.join("lib").join(name), "library").unwrap();
    }
    std::fs::copy(FAKE, folder.join("lib").join(llama_server_name(target))).unwrap();
    std::fs::write(folder.join("receipt.json"), json!({ "version": version_of(&runtime), "id": runtime.id }).to_string()).unwrap();
}

/// A GGUF header naming Gemma 3's architecture. The stand-in reads its mode from the file's stem.
fn gguf(dir: &Path, stem: &str) -> PathBuf {
    let mut data = b"GGUF".to_vec();
    data.extend(3u32.to_le_bytes());
    data.extend(0u64.to_le_bytes());
    data.extend(1u64.to_le_bytes());
    let (key, value) = ("general.architecture", "gemma3");
    data.extend((key.len() as u64).to_le_bytes());
    data.extend(key.as_bytes());
    data.extend(8u32.to_le_bytes());
    data.extend((value.len() as u64).to_le_bytes());
    data.extend(value.as_bytes());
    let path = dir.join(format!("{stem}.gguf"));
    std::fs::write(&path, data).unwrap();
    path
}

/// Adds the file as a `llamacpp` entry and returns its weight.
fn add(env: &Environment, file: &Path, device: &str) -> String {
    std::fs::create_dir_all(&env.state_dir).unwrap();
    let catalog = TranslationCatalog::new(env.state_dir.join(FILE_NAME));
    let request = json!({ "group": "engine", "name": file.file_stem().unwrap().to_string_lossy(), "runtime": "llamacpp", "file": file.to_string_lossy(), "languages": ["en", "ja"], "device": device });
    let (id, _) = catalog.add(TranslationCatalog::normalize(&request).unwrap()).unwrap();
    format!("user:{id}")
}

fn setup(weight: &str) -> LocalSetup {
    LocalSetup { weight: weight.into(), device: Environment::cpu_device(), compute_type: "auto".into() }
}

/// The ONNX translation the router hands every other weight to, as a recorder.
#[derive(Default)]
struct Inner {
    calls: Mutex<Vec<String>>,
}

impl LocalTranslation for Inner {
    fn load(&self, setup: &LocalSetup) -> Result<(), LocalError> {
        self.calls.lock().unwrap().push(format!("load {}", setup.weight));
        Ok(())
    }
    fn loaded(&self) -> Option<LocalSetup> {
        None
    }
    fn translate(&self, _: &str, _: &str, _: &str) -> Result<String, LocalError> {
        self.calls.lock().unwrap().push("translate".into());
        Ok("onnx".into())
    }
    fn unload(&self) {
        self.calls.lock().unwrap().push("unload".into());
    }
}

#[test]
fn a_translation_llm_runs_on_the_server_it_starts_and_hands_other_models_back() {
    let dir = tempfile::tempdir().unwrap();
    let env = environment(dir.path());
    let weight = add(&env, &gguf(dir.path(), "ok"), "cpu");
    let inner = Arc::new(Inner::default());
    let routed = Routed::new(&env, inner.clone());
    // Without llama.cpp's server set up, the model is there but cannot run.
    assert!(!translation_llama::weight_available(&env, &weight));
    assert_eq!(routed.load(&setup(&weight)), Err(LocalError::Missing));
    set_up_server(&env);
    assert!(translation_llama::weight_available(&env, &weight));
    assert_eq!(routed.languages(&weight).unwrap()["source"], json!({ "English": "en", "Japanese": "ja" }));

    routed.load(&setup(&weight)).unwrap();
    assert_eq!(routed.loaded(), Some(setup(&weight)));
    let placement = routed.placement().unwrap();
    assert_eq!((placement.device.as_str(), placement.variant.as_str()), ("cpu", "gguf"));
    // The prompt reached the server and its answer came back (the stand-in answers in upper case).
    assert_eq!(routed.translate("hello there", "en", "ja"), Ok("HELLO THERE".into()));
    assert_eq!(routed.translate("hello", "en", "xx"), Err(LocalError::Unsupported));
    // The ONNX model was dropped for it (at each load, even the one that failed), and is asked
    // for nothing else meanwhile.
    assert_eq!(*inner.calls.lock().unwrap(), ["unload", "unload"]);

    // Another weight: the server stops and the ONNX translation loads it.
    routed.load(&setup("m2m100_418M-ct2-int8")).unwrap();
    assert_eq!(routed.translate("x", "en", "ja"), Ok("onnx".into()));
    assert_eq!(*inner.calls.lock().unwrap(), ["unload", "unload", "load m2m100_418M-ct2-int8", "translate"]);
    assert_eq!(routed.placement(), None);
}

#[test]
fn a_server_that_ended_is_started_again_once() {
    let dir = tempfile::tempdir().unwrap();
    let env = environment(dir.path());
    set_up_server(&env);
    // The stand-in ends after each translation.
    let weight = add(&env, &gguf(dir.path(), "die"), "auto");
    let routed = Routed::new(&env, Arc::new(Inner::default()));
    routed.load(&setup(&weight)).unwrap();
    assert_eq!(routed.translate("one", "en", "ja"), Ok("ONE".into()));
    std::thread::sleep(std::time::Duration::from_millis(800));
    assert_eq!(routed.translate("two", "en", "ja"), Ok("TWO".into()));
    assert_eq!(routed.loaded(), Some(setup(&weight)));
}

#[test]
fn a_model_the_server_cannot_load_is_a_load_failure() {
    let dir = tempfile::tempdir().unwrap();
    let env = environment(dir.path());
    set_up_server(&env);
    let routed = Routed::new(&env, Arc::new(Inner::default()));
    let bad = add(&env, &gguf(dir.path(), "bad_model"), "auto");
    let oom = add(&env, &gguf(dir.path(), "oom"), "auto");
    routed.refresh();
    assert_eq!(routed.load(&setup(&bad)), Err(LocalError::LoadFailed));
    assert!(matches!(routed.load(&setup(&oom)), Err(LocalError::OutOfMemory(_))));
    assert_eq!(routed.loaded(), None);
    // A GPU asked for by name that the server does not list (the stand-in lists none).
    let named = add(&env, &gguf(dir.path(), "ok"), "Vulkan1");
    routed.refresh();
    assert_eq!(routed.load(&setup(&named)), Err(LocalError::LoadFailed));
}
