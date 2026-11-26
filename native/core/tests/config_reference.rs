//! The settings a user saved with the Python backend carry over (Issue #285: 設定の移行).
//!
//! For every saved `config.json` in `reference/dump_reference.py`, on Windows and on Linux, the
//! Rust core must write back the same file the Python backend wrote after its start-up, and
//! notice the same things (a file moved aside, URLs dropped, the local ASR notice). The expected
//! results are `tests/data/python_config_reference.json`, written by the Python backend itself.
//!
//! Five differences are intended. API keys (`AUTH_KEYS`, `TRANSCRIPTION_AUTH_KEYS`) leave
//! `config.json` for the key store (`astarot_core::config::secrets`): the settings are compared
//! without them, and the keys Python kept in the file must be in the store instead. A saved
//! choice of the retired Google recognition engine loads as none (`retire_google_engine`). The
//! direct voice engine is RVC where Python saved Seed-VC, which ended with Python (#391). And
//! settings added after the Python backend (Issue #390) are written with their defaults into the
//! voice settings Python wrote: [`added`] lists them, and they are added to the expected results
//! before the comparison. The RVC worker's choices added to the direct voice settings are not:
//! left at their defaults they stay out of the file, which 0.4 reads (#428). And a key the core
//! does not know stays in the file as it was, where Python dropped it, so that the version that
//! wrote it finds it again (#560): [`without_unknown_keys`] checks that and leaves it out. And
//! since 0.6.0 the local recognition migration of 0.3 to 0.5 and its notice are gone (#288):
//! [`without_local_asr_migration`] takes them out of what Python did. And NLLB-200 3.3B is not
//! offered since #565 (it will not be published): the list of local translation models has the
//! others, and a saved choice of it loads as the default (no saved file here chose it).

use serde_json::{json, Map, Value};

/// Fields the Rust core added to a nested setting, with their defaults.
fn added() -> [(&'static str, Value); 1] {
    [
        ("VOICE_SETTINGS", json!({
            "coeiroink_speed": "1.0", "coeiroink_volume": "1.0", "coeiroink_pitch": "0.0", "coeiroink_intonation": "1.0",
            "coeiroink_pre_phoneme": "0.1", "coeiroink_post_phoneme": "0.1", "coeiroink_sampling_rate": "24000",
        })),
    ]
}

/// The expected settings with [`added`] fields appended to the nested settings they belong to.
fn with_added(settings: &mut Map<String, Value>) {
    for (key, fields) in added() {
        if let Some(Value::Object(saved)) = settings.get_mut(key) {
            for (field, value) in fields.as_object().unwrap() {
                saved.entry(field.clone()).or_insert_with(|| value.clone());
            }
        }
    }
}
use std::path::Path;
use astarot_core::config::secrets::{MemoryStore, SECRET_SETTINGS};
use astarot_core::config::{Config, Environment, Platform, RETIRED_KEYS};

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

/// What the core saves that Python never had (#277): the Ollama URL, Papago's Client ID, the subtitles' font and the
/// keys of the official machine translation APIs. They are left out before comparing.
// USAGE_PRESETS (#554) is also one: the Python backend has no usage presets. RVC_BLOCK_MS
// (#531) too: Python's RVC always cut 80 ms blocks.
// OSC_QUERY (#559) too: the Python backend could not turn OSCQuery off. CATALOG_LAYOUT too: the
// Python backend's UI had no layouts of the model catalogs. The AI translation's temperature and
// instructions (#392) too: Python sent neither. RELEASE_CHANNEL_CHOSEN (#466) too: Python always
// took the channel from the version. TRAY_COMPANION_WHEEL_HINT_SHOWN (#536) too: the Python
// backend's hexagram had no wheel hint. MANAGED_ROUTE_RENAME_NOTICE_PENDING (ADR-014, 2.8) too:
// the Python backend's virtual microphone never changed its name. THEME (#965) too: the Python
// backend's UI had one look. SETTINGS_WINDOW_GEOMETRY (#1236) too: the Python backend's settings
// were a page of the main window.
const CORE_ONLY_KEYS: [&str; 20] = [
    "OLLAMA_URL",
    "PAPAGO_CLIENT_ID",
    "OVERLAY_FONT_FAMILY",
    "USAGE_PRESETS",
    "RVC_BLOCK_MS",
    "OSC_QUERY",
    "CATALOG_LAYOUT",
    "LLM_TRANSLATION_TEMPERATURE",
    "LLM_TRANSLATION_INSTRUCTIONS",
    "RELEASE_CHANNEL_CHOSEN",
    "TRAY_COMPANION_WHEEL_HINT_SHOWN",
    "MANAGED_ROUTE_RENAME_NOTICE_PENDING",
    "THEME",
    "CONVERSATION_LOG_DIRECTORY",
    "TALK_AI_PROVIDER",
    "TALK_AI_LOCAL_URL",
    "TALK_AI_SCREEN_INTERVAL_MS",
    "TALK_AI_SCREEN_LONG_EDGE",
    "TALK_AI_SCREEN_DETAIL",
    "SETTINGS_WINDOW_GEOMETRY",
];
const CORE_ONLY_AUTH_KEYS: [&str; 2] = ["Google_Cloud_API", "Papago_API"];
/// The engines the core adds after DeepL (the official APIs, #277).
const CORE_ONLY_ENGINES: [&str; 2] = ["Google_Cloud_API", "Papago_API"];

fn without_core_additions(mut saved: Map<String, Value>) -> Map<String, Value> {
    for key in CORE_ONLY_KEYS {
        saved.shift_remove(key);
    }
    if let Some(Value::Object(features)) = saved.get_mut("EXPERIMENTAL_FEATURES") {
        features.shift_remove("talk_ai");
    }
    if let Some(Value::Object(keys)) = saved.get_mut("AUTH_KEYS") {
        for engine in CORE_ONLY_AUTH_KEYS {
            keys.shift_remove(engine);
        }
    }
    saved
}

/// The second intended difference: the Google web speech engine is retired (its unofficial
/// endpoint and generic key are gone), so a saved choice of it loads as none, the default, where
/// Python kept it.
fn retire_google_engine(want: &mut Value) {
    if let Some(changed) = want["changed"].as_object_mut()
        && changed.get("SELECTED_TRANSCRIPTION_ENGINE").and_then(Value::as_str) == Some("Google")
    {
        changed.shift_remove("SELECTED_TRANSCRIPTION_ENGINE");
    }
}

/// The sixth intended difference (#288): Python moved a saved Whisper choice (and, in a file
/// older than the migration, a saved bundled realtime server) to speech.cpp, took the bundled
/// server on Windows and set the notice `LOCAL_ASR_NOTICE_PENDING`. The core loads the saved
/// choice as it is (Whisper as none) and writes no notice; the saved realtime server stays.
fn without_local_asr_migration(want: &mut Value, input: &Value) {
    let Some(changed) = want["changed"].as_object_mut() else { return };
    changed.shift_remove("LOCAL_ASR_NOTICE_PENDING");
    let Some(saved) = input.as_object() else { return };
    let engine = |map: &Map<String, Value>| map.get("SELECTED_TRANSCRIPTION_ENGINE").and_then(Value::as_str).map(str::to_string);
    if engine(changed).as_deref() == Some("SpeechCpp") && engine(saved).as_deref() != Some("SpeechCpp") {
        changed.shift_remove("SELECTED_TRANSCRIPTION_ENGINE");
        if !saved.contains_key("REALTIME_ASR_SETTINGS") {
            changed.shift_remove("REALTIME_ASR_SETTINGS");
        }
    }
}

/// The fifth intended difference (#560): each key of the input the core does not know must be in
/// the saved file with the input's value. Those keys are taken out of `saved`, which then holds
/// what Python wrote.
fn without_unknown_keys(mut saved: Map<String, Value>, input: &Value, case: &str, failures: &mut Vec<String>) -> Map<String, Value> {
    let known: Vec<&str> = astarot_core::config::schema::keys().iter().map(|key| key.name).collect();
    // Only a saved object has keys; `raw` and `raw_bytes` describe a file that is not one.
    let saved_object = input.as_object().filter(|object| !object.contains_key("raw") && !object.contains_key("raw_bytes"));
    for (key, value) in saved_object.into_iter().flatten() {
        if known.contains(&key.as_str()) || RETIRED_KEYS.contains(&key.as_str()) {
            continue;
        }
        match saved.shift_remove(key) {
            Some(kept) if kept == *value => {}
            kept => failures.push(format!("{case}: the unknown key {key} was not kept as it was: {kept:?}")),
        }
    }
    // Python did not mark the file; the core names the newest version that saved it (#560).
    if saved.shift_remove(astarot_core::config::NEWEST_SAVING_VERSION).is_none() {
        failures.push(format!("{case}: {} is not written", astarot_core::config::NEWEST_SAVING_VERSION));
    }
    saved
}

fn changes(saved:&Map<String, Value>, defaults: &Map<String, Value>) -> Map<String, Value> {
    saved.iter().filter(|(k, v)| defaults.get(*k) != Some(*v)).map(|(k, v)| (k.clone(), v.clone())).collect()
}

fn check_platform(name: &str, platform: Platform) {
    let reference = reference();
    let expected = &reference["platforms"][name];
    let mut defaults = expected["defaults"].as_object().unwrap().clone();
    with_added(&mut defaults);
    defaults.retain(|key, _| !SECRET_SETTINGS.contains(&key.as_str()));
    // Intended (#391): Seed-VC, Python's default engine of direct voice, ended with Python, so
    // the core's default is RVC and a saved Seed-VC loads as RVC.
    defaults.get_mut("DIRECT_VOICE_SETTINGS").unwrap()["engine"] = json!("rvc");
    // Intended (#288): the notice of the move to speech.cpp went in 0.6.0, with its key.
    defaults.shift_remove("LOCAL_ASR_NOTICE_PENDING");
    let defaults = &defaults;
    let mut failures = Vec::new();
    let mut moved = 0;
    for (case, want) in expected["cases"].as_object().unwrap() {
        let mut want = want.clone();
        if let Some(changed) = want["changed"].as_object_mut() {
            with_added(changed);
        }
        let want = &want;
        let dir = tempfile::tempdir().unwrap();
        write_input(dir.path(), &reference["inputs"][case], &expected["defaults"]);
        let store = MemoryStore::new();
        let config = Config::open_with(environment(dir.path(), platform, &reference), store.clone());
        let saved: Map<String, Value> = without_core_additions(without_unknown_keys(
            serde_json::from_str(&std::fs::read_to_string(dir.path().join("config.json")).unwrap()).unwrap(),
            &reference["inputs"][case],
            &format!("{name}/{case}"),
            &mut failures,
        ));
        let got_changes = changes(&saved, defaults);
        let mut want = want.clone();
        retire_google_engine(&mut want);
        without_local_asr_migration(&mut want, &reference["inputs"][case]);
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
        // Python's `local_asr_notice_pending` is not compared: the notice went in 0.6.0 (#288).
        if saved.contains_key("LOCAL_ASR_NOTICE_PENDING") {
            failures.push(format!("{name}/{case}: the retired notice LOCAL_ASR_NOTICE_PENDING is written"));
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
    let config = Config::open_with(environment(dir.path(), Platform::current(), &reference), MemoryStore::new());
    let lists = &reference["platforms"]["win32"]["lists"];
    // Python's recognition engines without the retired Google web speech engine.
    let recognition: Vec<Value> =
        lists["selectable_transcription_engines"].as_array().unwrap().iter().filter(|e| *e != "Google").cloned().collect();
    assert_eq!(config.get("SELECTABLE_TRANSCRIPTION_ENGINE_LIST"), json!(recognition));
    // Python's list without the web translators no build could run ("判断が要ること" 17), with the
    // official APIs the core adds after DeepL.
    let mut engines: Vec<Value> = lists["selectable_translation_engines"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| !["Google", "Bing", "Papago"].contains(&e.as_str().unwrap()))
        .cloned()
        .collect();
    let after_deepl = engines.iter().position(|e| e == "DeepL_API").unwrap() + 1;
    for (offset, engine) in CORE_ONLY_ENGINES.iter().enumerate() {
        engines.insert(after_deepl + offset, json!(engine));
    }
    assert_eq!(config.get("SELECTABLE_TRANSLATION_ENGINE_LIST"), json!(engines));
    assert_eq!(config.get("SELECTABLE_OCR_SOURCE_LANGUAGE_LIST"), lists["selectable_ocr_source_languages"]);
    // Python's list less the weights no longer offered (#565).
    let weights: Vec<Value> = lists["selectable_ctranslate2_weight_types"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|w| !astarot_core::languages::RETIRED_TRANSLATION_WEIGHTS.contains(&w.as_str().unwrap()))
        .cloned()
        .collect();
    assert_eq!(config.get("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST"), json!(weights));
    config.close();
}
