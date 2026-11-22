//! A GPU build of ONNX Runtime the user set up, chosen and loaded for the app at start (decision
//! 2 (c) of docs/voice-stack/core-integration.md). Its own test binary, because the library is
//! chosen and loaded once per process. Without the variable this test does nothing.
//!
//! `ASTAROT_TEST_GPU_BUILD_STATE` names a settings folder whose `vc_runtimes/` holds the build set up
//! (`onnxruntime-directml/` or `onnxruntime-cuda/`, as the runtime setup leaves it); the test
//! writes its `config.json`. `ASTAROT_TEST_GPU_BUILD_DEVICE` is `directml` (the default) or `cuda`.
//! With `ASTAROT_TEST_GPU_BUILD_MODEL` a model folder is also translated on the device (device 0)
//! and on the CPU.
//!
//!     ASTAROT_TEST_GPU_BUILD_STATE=<folder> cargo test --manifest-path native/core/Cargo.toml --test gpu_build

#![cfg(feature = "onnx-translation")]

use std::path::PathBuf;

use serde_json::json;
use vrct_core::shipped_libraries::{onnx_runtime_library, use_libraries, OnnxRuntimeLibrary};
use vrct_translate_onnx::{Accelerator, Bundle, Provider, Translator};

#[test]
fn the_build_set_up_is_loaded_and_its_device_listed() {
    let Some(state) = std::env::var_os("ASTAROT_TEST_GPU_BUILD_STATE").map(PathBuf::from) else {
        return;
    };
    let device = match std::env::var("ASTAROT_TEST_GPU_BUILD_DEVICE").as_deref() {
        Ok("cuda") => "cuda",
        _ => "directml",
    };
    assert!(std::env::var_os(vrct_onnx_runtime::LIBRARY_VARIABLE).is_none_or(|value| value.is_empty()), "unset ORT_DYLIB_PATH for this test");
    let provider = Provider::from_name(device).unwrap();
    let saved = json!({ "SELECTED_TRANSLATION_COMPUTE_DEVICE": { "device": device, "device_index": 0, "device_name": provider.label() } });
    std::fs::write(state.join("config.json"), saved.to_string()).unwrap();
    // No shipped library: the build must come from the settings folder.
    let app = tempfile::tempdir().unwrap();

    let line = use_libraries(app.path(), &state);
    assert_eq!(line, format!("Libraries: ONNX Runtime the {device} build set up for translation, OpenVR not shipped"));
    assert_eq!(onnx_runtime_library(), OnnxRuntimeLibrary::Gpu(device));
    let devices = vrct_core::controller::translation::compute_devices_for(&state);
    let listed = devices.iter().find(|entry| entry["device"] == device).expect("the build's device is listed");
    assert_eq!(listed.get("restart_required"), None, "{devices:?}");

    // The library and the libraries before it load, and it brings the provider.
    assert!(vrct_onnx_runtime::environment().is_ok(), "{:?}", vrct_onnx_runtime::environment().err());
    assert_eq!(vrct_onnx_runtime::dependencies_missing(), Some(0));
    assert!(vrct_onnx_runtime::library_path().starts_with(state.join("vc_runtimes")));
    let providers = vrct_translate_onnx::runtime::available_providers().unwrap();
    assert!(providers.contains(&provider), "{providers:?}");

    // With `ASTAROT_TEST_GPU_BUILD_MODEL` (a folder tools/translation_onnx/tiny.py or export.py
    // wrote), the provider starts from the libraries loaded here alone (no PATH) and decodes as
    // the CPU does.
    let Some(folder) = std::env::var_os("ASTAROT_TEST_GPU_BUILD_MODEL") else { return };
    let bundle = Bundle::open(folder).unwrap();
    bundle.verify().unwrap();
    let at = Accelerator::new(provider, 0);
    let mut cpu = Translator::load(&bundle, Accelerator::CPU).unwrap();
    let mut gpu = Translator::load(&bundle, at).unwrap();
    assert_eq!((gpu.backend(), gpu.fallback()), (at, None), "the provider did not start");
    let manifest = bundle.manifest();
    let (source, target) = (&manifest.languages[0], &manifest.languages[manifest.languages.len() - 1]);
    let words: Vec<String> = (0..24).map(|index| format!("w{}", 300 + index * 37)).collect();
    let ids = cpu.source_ids(&words.join(" "), source).unwrap();
    let want = cpu.translate_ids(&ids, target).unwrap();
    let got = gpu.translate_ids(&ids, target).unwrap();
    if manifest.variant.as_deref() == Some("float16") {
        assert_eq!(got[..2], want[..2]);
    } else {
        assert_eq!(got, want);
    }
}
