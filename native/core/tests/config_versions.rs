//! Settings across versions (#560): a version that is started after a newer one, and then the newer
//! one again, must not have lost the newer one's settings on the way.

use serde_json::{Map, Value, json};
use std::path::Path;
use vrct_core::config::secrets::MemoryStore;
use vrct_core::config::{Config, Environment, Platform, RETIRED_KEYS};

fn environment(dir: &Path) -> Environment {
    Environment {
        version: "0.0.0".into(),
        state_dir: dir.to_path_buf(),
        app_dir: dir.join("app"),
        data_dir: dir.join("data"),
        platform: Platform::current(),
        compute_devices: vec![Environment::cpu_device()],
        devices: None,
        websocket_token: Some("token".into()),
    }
}

fn read(dir: &Path) -> Map<String, Value> {
    serde_json::from_str(&std::fs::read_to_string(dir.join("config.json")).unwrap()).unwrap()
}

/// Makes the file the owner's only, as the app writes it: on Unix a file others may read is
/// written again at start, which these tests do not want.
fn owner_only(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[test]
fn a_setting_this_version_does_not_know_is_written_back_as_it_was() {
    let dir = tempfile::tempdir().unwrap();
    let newer = json!({ "kind": "added later", "list": [1, 2.5, null], "nested": { "on": true } });
    std::fs::write(
        dir.path().join("config.json"),
        serde_json::to_string(&json!({
            "UI_LANGUAGE": "ja",
            "SETTING_OF_A_NEWER_VERSION": newer,
            "WHISPER_WEIGHT_TYPE": "base",
            "VERSION": "9.9.9",
        }))
        .unwrap(),
    )
    .unwrap();
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    // It is not used ...
    assert_eq!(config.get("SETTING_OF_A_NEWER_VERSION"), Value::Null);
    assert_eq!(config.get("UI_LANGUAGE"), "ja");
    let saved = read(dir.path());
    // ... but it stays in the file, after the keys this version writes.
    assert_eq!(saved["SETTING_OF_A_NEWER_VERSION"], newer);
    assert_eq!(saved.keys().last().map(String::as_str), Some("SETTING_OF_A_NEWER_VERSION"));
    // A key an earlier version saved and this one retired goes, and so does a fixed value.
    assert!(RETIRED_KEYS.contains(&"WHISPER_WEIGHT_TYPE"));
    assert!(!saved.contains_key("WHISPER_WEIGHT_TYPE"));
    assert!(!saved.contains_key("VERSION"));

    // A change made in this version keeps it too.
    config.set("UI_LANGUAGE", json!("en")).unwrap();
    config.save_now();
    let saved = read(dir.path());
    assert_eq!(saved["UI_LANGUAGE"], "en");
    assert_eq!(saved["SETTING_OF_A_NEWER_VERSION"], newer);
    config.close();
    drop(config);

    // And the next start keeps it again.
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    assert_eq!(read(dir.path())["SETTING_OF_A_NEWER_VERSION"], newer);
    config.close();
}

#[test]
fn the_settings_of_the_removed_local_whisper_are_not_written_back() {
    // The local Whisper engine and its options went in #288: a saved file of that time still
    // names them, and the migration leaves them out of the file (`lifecycle.rs`). They must not
    // come back as unknown keys kept for a newer version.
    let retired = json!({
        "WHISPER_WEIGHT_TYPE": "small",
        "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE": { "device": "cpu", "device_index": 0 },
        "SELECTED_TRANSCRIPTION_COMPUTE_TYPE": "int8",
        "MIC_NO_REPEAT_NGRAM_SIZE": 3,
        "SPEAKER_NO_REPEAT_NGRAM_SIZE": 3,
    });
    assert_eq!(retired.as_object().unwrap().len(), RETIRED_KEYS.len());
    let known: Vec<&str> = vrct_core::config::schema::keys().iter().map(|key| key.name).collect();
    for key in RETIRED_KEYS {
        assert!(retired.get(key).is_some(), "{key} is checked here");
        assert!(!known.contains(&key), "{key} is retired but still a setting");
    }
    for older in [
        // Before the move to speech.cpp, with its migration and notice.
        json!({ "SELECTED_TRANSCRIPTION_ENGINE": "Whisper", "LOCAL_ASR_MIGRATION": 1 }),
        // Already migrated: nothing else to change, so only the retired keys make it written.
        json!({ "LOCAL_ASR_MIGRATION": 2, "UI_LANGUAGE": "ja" }),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut saved = older.as_object().unwrap().clone();
        saved.extend(retired.as_object().unwrap().clone());
        saved.insert("SETTING_OF_A_NEWER_VERSION".into(), json!(true));
        std::fs::write(dir.path().join("config.json"), serde_json::to_string(&saved).unwrap()).unwrap();
        owner_only(&dir.path().join("config.json"));
        let config = Config::open_with(environment(dir.path()), MemoryStore::new());
        for check in ["at start", "after a change"] {
            let file = read(dir.path());
            for key in RETIRED_KEYS {
                assert!(!file.contains_key(key), "{older} {check}: {key} is still written");
            }
            assert_eq!(file["SETTING_OF_A_NEWER_VERSION"], true, "{older} {check}: the unknown key is kept");
            config.set("UI_LANGUAGE", json!("en")).unwrap();
            config.save_now();
        }
        config.close();
    }
}

#[test]
fn a_start_that_changes_nothing_leaves_the_file_alone() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    // The first start writes every setting.
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    config.close();
    drop(config);
    let written = read(dir.path());
    assert!(!written.is_empty());

    // The same settings in another layout (as another version may write them, the keys in
    // another order): the next start has nothing to change, so it does not write.
    let mut reordered: Vec<(String, Value)> = written.clone().into_iter().collect();
    reordered.reverse();
    let compact = serde_json::to_string(&Value::Object(reordered.into_iter().collect())).unwrap();
    std::fs::write(&path, &compact).unwrap();
    owner_only(&path);
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), compact, "the file was written at start");
    config.close();
    drop(config);

    // A start that changes something writes it.
    let mut older = written.clone();
    older.shift_remove("USAGE_PRESETS");
    std::fs::write(&path, serde_json::to_string(&older).unwrap()).unwrap();
    owner_only(&path);
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    assert_eq!(read(dir.path())["USAGE_PRESETS"], json!(["all"]), "the migration was saved");
    config.close();
}

#[test]
fn a_translation_device_that_needs_a_restart_is_kept_for_the_next_start() {
    // A GPU build of ONNX Runtime set up during the run is listed with `restart_required`
    // (decision 2 (c)): it can be chosen, and the next start, which loads it, keeps the choice.
    let dir = tempfile::tempdir().unwrap();
    let cpu = Environment::cpu_device();
    let cuda = json!({ "device": "cuda", "device_index": 0, "device_name": "NVIDIA GPU (CUDA)", "compute_types": ["auto", "float32", "float16", "int4"] });
    let mut waiting = cuda.clone();
    waiting["restart_required"] = json!(true);
    let mut env = environment(dir.path());
    env.compute_devices = vec![cpu.clone(), waiting.clone()];
    let config = Config::open_with(env, MemoryStore::new());
    // Not in use yet.
    assert_eq!(config.get("COMPUTE_MODE"), "cpu");
    config.set("SELECTED_TRANSLATION_COMPUTE_DEVICE", json!({ "device": "cuda", "device_index": 0, "device_name": "NVIDIA GPU (CUDA)" })).unwrap();
    assert_eq!(config.get("SELECTED_TRANSLATION_COMPUTE_DEVICE"), waiting);
    config.set("SELECTED_TRANSLATION_COMPUTE_TYPE", json!("float16")).unwrap();
    config.save_now();
    config.close();
    drop(config);

    let mut env = environment(dir.path());
    env.compute_devices = vec![cpu.clone(), cuda.clone()];
    let config = Config::open_with(env, MemoryStore::new());
    assert_eq!(config.get("SELECTED_TRANSLATION_COMPUTE_DEVICE"), cuda);
    assert_eq!(config.get("SELECTED_TRANSLATION_COMPUTE_TYPE"), "float16");
    assert_eq!(config.get("COMPUTE_MODE"), "cuda");
    config.close();
    drop(config);

    // Started without it (the build was removed): the CPU, as with any device that is gone.
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    assert_eq!(config.get("SELECTED_TRANSLATION_COMPUTE_DEVICE"), cpu);
    config.close();
}

#[cfg(unix)]
#[test]
fn a_file_others_may_read_is_written_at_start_for_the_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    config.close();
    drop(config);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    config.close();
}
