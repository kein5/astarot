//! The settings a user saved with the Python backend carry over (Issue #285: 設定の移行).
//!
//! For every saved `config.json` in `reference/dump_reference.py`, on Windows and on Linux, the
//! Rust core must write back the same file the Python backend wrote after its start-up, and
//! notice the same things (a file moved aside, URLs dropped, the local ASR notice). The expected
//! results are `tests/data/python_config_reference.json`, written by the Python backend itself.
//!
//! One difference is intended: API keys (`AUTH_KEYS`, `TRANSCRIPTION_AUTH_KEYS`) leave
//! `config.json` for the key store (`vrct_core::config::secrets`). The settings are compared
//! without them, and the keys Python kept in the file must be in the store instead.

use serde_json::{json, Map, Value};
use std::path::Path;
use vrct_core::config::secrets::{MemoryStore, SECRET_SETTINGS};
use vrct_core::config::{Config, Environment, Platform};

fn reference() -> Value {
    serde_json::from_str(include_str!("data/python_config_reference.json")).unwrap()
}

fn environment(dir: &Path, platform: Platform, reference: &Value) -> Environment {
    Environment {
        version: reference["version"].as_str().unwrap().to_string(),
        state_dir: dir.to_path_buf(),
        app_dir: dir.join("app"),
        data_dir: dir.join("data"),
        platform,
        compute_devices: vec![reference["cpu_device"].clone()],
        devices: None,
        websocket_token: Some(reference["websocket_token"].as_str().unwrap().to_string()),
    }
}

fn write_input(dir: &Path, input: &Value, defaults: &Value) {
    let path = dir.join("config.json");
    match input {
        Value::Null => {}
        Value::String(text) if text == "the file no_file saved" => {
            std::fs::write(&path, serde_json::to_string_pretty(defaults).unwrap()).unwrap();
        }
        Value::Object(object) if object.contains_key("raw") => std::fs::write(&path, object["raw"].as_str().unwrap()).unwrap(),
        Value::Object(object) if object.contains_key("raw_bytes") => {
            let hex = object["raw_bytes"].as_str().unwrap().replace(' ', "");
            let bytes: Vec<u8> = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect();
            std::fs::write(&path, bytes).unwrap();
        }
        other => std::fs::write(&path, serde_json::to_string_pretty(other).unwrap()).unwrap(),
    }
}

/// Takes the keys out of an expected result: the entries the store must hold instead.
fn moved_keys(want: &mut Value) -> Vec<(String, String)> {
    let mut keys = Vec::new();
    if let Some(changed) = want["changed"].as_object_mut() {
        for name in SECRET_SETTINGS {
            if let Some(Value::Object(map)) = changed.remove(name) {
                keys.extend(map.into_iter().filter_map(|(provider, v)| Some((format!("{name}/{provider}"), v.as_str()?.to_string()))));
            }
        }
    }
    if let Some(missing) = want["missing"].as_array_mut() {
        missing.retain(|key| !SECRET_SETTINGS.contains(&key.as_str().unwrap_or_default()));
    }
    keys.sort();
    keys
}

fn changes(saved: &Map<String, Value>, defaults: &Map<String, Value>) -> Map<String, Value> {
    saved.iter().filter(|(k, v)| defaults.get(*k) != Some(*v)).map(|(k, v)| (k.clone(), v.clone())).collect()
}

fn check_platform(name: &str, platform: Platform) {
    let reference = reference();
    let expected = &reference["platforms"][name];
    let mut defaults = expected["defaults"].as_object().unwrap().clone();
    defaults.retain(|key, _| !SECRET_SETTINGS.contains(&key.as_str()));
    let defaults = &defaults;
    let mut failures = Vec::new();
    let mut moved = 0;
    for (case, want) in expected["cases"].as_object().unwrap() {
        let dir = tempfile::tempdir().unwrap();
        write_input(dir.path(), &reference["inputs"][case], &expected["defaults"]);
        let store = MemoryStore::new();
        let config = Config::open_with(environment(dir.path(), platform, &reference), store.clone());
        let saved: Map<String, Value> =
            serde_json::from_str(&std::fs::read_to_string(dir.path().join("config.json")).unwrap()).unwrap();
        let got_changes = changes(&saved, defaults);
        let mut want = want.clone();
        let wanted_keys = moved_keys(&mut want);
        moved += wanted_keys.len();
        let kept_keys: Vec<(String, String)> = store.snapshot().into_iter().collect();
        if SECRET_SETTINGS.iter().any(|key| saved.contains_key(*key)) || kept_keys != wanted_keys {
            failures.push(format!("{name}/{case}: keys\n  got:  {kept_keys:?} (in the file: {})\n  want: {wanted_keys:?}",
                SECRET_SETTINGS.iter().any(|key| saved.contains_key(*key))));
        }
        let missing: Vec<&String> = defaults.keys().filter(|k| !saved.contains_key(*k)).collect();
        let order_kept = saved.keys().eq(defaults.keys());
        let backups: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|n| n.contains(".unreadable-"))
            .map(|n| n.split(".unreadable-").next().unwrap().to_string())
            .collect();
        let report = |what: &str, got: String, want: String| format!("{name}/{case}: {what}\n  got:  {got}\n  want: {want}");
        if Value::Object(got_changes.clone()) != want["changed"] {
            failures.push(report("changed", Value::Object(got_changes).to_string(), want["changed"].to_string()));
        }
        if serde_json::json!(missing) != want["missing"] {
            failures.push(report("missing", format!("{missing:?}"), want["missing"].to_string()));
        }
        if serde_json::json!(order_kept) != want["order_kept"] {
            failures.push(report("order", order_kept.to_string(), want["order_kept"].to_string()));
        }
        if serde_json::json!(backups) != want["unreadable_backup"] {
            failures.push(report("unreadable backup", format!("{backups:?}"), want["unreadable_backup"].to_string()));
        }
        if serde_json::json!(config.invalid_saved_api_urls()) != want["invalid_saved_api_urls"] {
            failures.push(report("invalid urls", format!("{:?}", config.invalid_saved_api_urls()), want["invalid_saved_api_urls"].to_string()));
        }
        if config.get("LOCAL_ASR_NOTICE_PENDING") != want["local_asr_notice_pending"] {
            failures.push(report("notice", config.get("LOCAL_ASR_NOTICE_PENDING").to_string(), want["local_asr_notice_pending"].to_string()));
        }
        config.close();
    }
    assert!(failures.is_empty(), "{} differences:\n{}", failures.len(), failures.join("\n"));
    assert!(moved > 0, "a case with saved keys moves them to the store");
}

#[test]
fn windows_settings_carry_over_as_python_wrote_them() {
    check_platform("win32", Platform::Windows);
}

#[test]
fn linux_settings_carry_over_as_python_wrote_them() {
    check_platform("linux", Platform::Linux);
}

#[test]
fn the_lists_the_settings_are_checked_against_are_pythons() {
    let reference = reference();
    let dir = tempfile::tempdir().unwrap();
    let config = Config::open(environment(dir.path(), Platform::current(), &reference));
    let lists = &reference["platforms"]["win32"]["lists"];
    assert_eq!(config.get("SELECTABLE_TRANSCRIPTION_ENGINE_LIST"), lists["selectable_transcription_engines"]);
    // Python's list without the web translators no build could run ("判断が要ること" 17).
    let engines: Vec<&Value> = lists["selectable_translation_engines"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| !["Google", "Bing", "Papago"].contains(&e.as_str().unwrap()))
        .collect();
    assert_eq!(config.get("SELECTABLE_TRANSLATION_ENGINE_LIST"), json!(engines));
    assert_eq!(config.get("SELECTABLE_OCR_SOURCE_LANGUAGE_LIST"), lists["selectable_ocr_source_languages"]);
    assert_eq!(config.get("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST"), lists["selectable_ctranslate2_weight_types"]);
    config.close();
}
