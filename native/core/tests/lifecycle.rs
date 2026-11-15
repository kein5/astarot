//! Start-up and shut-down over the connection the UI uses (Issue #285: 起動と終了).

mod common;

use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use vrct_core::controller::Services;

#[test]
fn start_up_sends_its_notifications_in_order_and_then_opens_every_endpoint() {
    let ui = Ui::start();
    let snapshot = ui.ready();
    let lines = ui.lines();
    let names: Vec<&str> = lines.iter().map(|l| l["endpoint"].as_str().unwrap_or("")).collect();
    let position = |endpoint: &str| names.iter().position(|n| *n == endpoint).unwrap_or_else(|| panic!("{endpoint} was sent"));
    assert_eq!(lines[position("/run/connected_network")]["result"], Value::Null, "nothing probed without a download due");
    let progress: Vec<Value> = ui.on(0, "/run/initialization_progress").iter().map(|l| l["result"].clone()).collect();
    assert_eq!(progress, [json!(1), json!(2), json!(3), json!(4)]);
    assert!(position("/run/connected_network") < position("/run/initialization_progress"));
    assert!(position("/run/enable_ai_models") < position("/run/selected_translation_engines"));
    assert!(position("/run/translation_engines") < position("/run/initialization_complete"));

    // The snapshot holds the /get/data endpoints, without those that reach outside.
    assert_eq!(snapshot["/get/data/version"], common::VERSION);
    assert_eq!(snapshot["/get/data/ui_language"], "en");
    assert!(snapshot.get("/get/data/available_releases").is_none());
    assert!(snapshot.as_object().unwrap().keys().all(|k| k.starts_with("/get/data/")));

    // An endpoint that waits for start-up now answers at once.
    assert_eq!(ui.ok("/get/data/selected_translation_engines", None), json!({ "1": "CTranslate2", "2": "CTranslate2", "3": "CTranslate2" }));
    ui.stop();
}

#[test]
fn without_the_local_translation_model_ai_models_are_reported_off() {
    let ui = Ui::start();
    ui.ready();
    assert_eq!(ui.on(0, "/run/enable_ai_models")[0]["result"], false);
    assert_eq!(ui.on(0, "/run/translation_engines").last().unwrap()["result"], json!([]), "no engine is offered");
    ui.stop();

    let services = Services {
        translation_weight_available: Arc::new(|weight| weight == "m2m100_418M-ct2-int8"),
        ..Services::default()
    };
    let ui = Ui::with(Setup { services, ..Setup::default() });
    let snapshot = ui.ready();
    assert_eq!(ui.on(0, "/run/enable_ai_models")[0]["result"], true);
    assert_eq!(snapshot["/get/data/selectable_ctranslate2_weight_type_dict"]["m2m100_418M-ct2-int8"], true);
    assert_eq!(snapshot["/get/data/selectable_ctranslate2_weight_type_dict"]["m2m100_1.2B-ct2-int8"], false);
    let engines = ui.on(0, "/run/translation_engines").last().unwrap()["result"].clone();
    assert!(engines.as_array().unwrap().contains(&json!("CTranslate2")), "{engines}");
    ui.stop();
}

#[test]
fn shutdown_answers_and_keeps_the_settings_for_the_next_start() {
    let dir = tempfile::tempdir().unwrap();
    let ui = Ui::with(Setup { dir: Some(dir.path().to_path_buf()), ..Setup::default() });
    ui.ready();
    assert_eq!(ui.ok("/set/data/ui_language", Some(json!("ja"))), "ja");
    assert_eq!(ui.ok("/set/data/transparency", Some(json!(70))), 70);
    assert_eq!(ui.ok("/run/shutdown", None), true);
    assert_eq!(ui.saved()["UI_LANGUAGE"], "ja", "saved at shutdown, without waiting for the 2 s delay");
    assert_eq!(ui.saved()["TRANSPARENCY"], 70);
    ui.stop();

    let ui = Ui::with(Setup { dir: Some(dir.path().to_path_buf()), ..Setup::default() });
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/ui_language"], "ja");
    assert_eq!(snapshot["/get/data/transparency"], 70);
    ui.stop();
}

#[test]
fn a_change_is_saved_two_seconds_after_the_last_one() {
    let ui = Ui::start();
    ui.ready();
    ui.ok("/set/data/font_family", Some(json!("Noto Sans JP")));
    assert_eq!(ui.saved()["FONT_FAMILY"], "Yu Gothic UI", "not yet");
    std::thread::sleep(Duration::from_millis(2600));
    assert_eq!(ui.saved()["FONT_FAMILY"], "Noto Sans JP");
    // Some settings are saved at once.
    ui.ok("/set/data/main_window_geometry", Some(json!({ "x_pos": 5, "y_pos": 6, "width": 900, "height": 700 })));
    assert_eq!(ui.saved()["MAIN_WINDOW_GEOMETRY"]["x_pos"], 5);
    ui.stop();
}

#[test]
fn the_backend_stops_itself_when_the_watchdog_is_not_fed() {
    let ui = Ui::with(Setup { watchdog: Some((Duration::from_millis(600), Duration::from_millis(100))), ..Setup::default() });
    ui.ready();
    for _ in 0..6 {
        ui.ok("/run/feed_watchdog", None);
        std::thread::sleep(Duration::from_millis(200));
    }
    assert_eq!(ui.wait_exit(Duration::from_millis(100)), None, "fed: still running");
    assert_eq!(ui.wait_exit(Duration::from_secs(5)), Some(0), "not fed: a graceful stop");
}

#[test]
fn the_backend_stops_when_the_ui_input_closes_but_not_after_a_requested_shutdown() {
    let ui = Ui::start();
    ui.ready();
    ui.backend.close_input();
    assert_eq!(ui.wait_exit(Duration::from_secs(5)), Some(0));

    let ui = Ui::start();
    ui.ready();
    ui.ok("/run/shutdown", None);
    ui.backend.close_input();
    assert_eq!(ui.wait_exit(Duration::from_millis(500)), None, "the shutdown the UI asked for is already under way");
    ui.stop();
}

#[test]
fn an_unreadable_settings_file_is_kept_aside_and_reported_after_start_up() {
    let ui = Ui::with(Setup { raw: Some("{\"UI_LANGUAGE\": ".into()), ..Setup::default() });
    ui.ready();
    let notice = ui.wait_endpoint(0, "/run/config_file_unreadable");
    let backup = notice["result"]["backup"].as_str().unwrap().to_string();
    assert!(backup.contains("config.json.unreadable-"), "{backup}");
    assert_eq!(std::fs::read_to_string(&backup).unwrap(), "{\"UI_LANGUAGE\": ", "the old file is kept as it was");
    assert_eq!(ui.saved()["UI_LANGUAGE"], "en", "started with defaults");
    ui.stop();
}

#[test]
fn settings_of_an_older_version_are_migrated_and_the_user_is_told() {
    let saved = json!({
        "SELECTED_TRANSCRIPTION_ENGINE": "Whisper",
        "UI_LANGUAGE": "zh-Hant",
        "LMSTUDIO_URL": "http://lan.example/v1",
        "CTRANSLATE2_WEIGHT_TYPE": "nllb-200-distilled-600M-ct2-int8",
        "HOTKEYS": { "toggle_translation": ["Ctrl", "T"] },
        "AUTH_KEYS": { "DeepL_API": "kept-key" },
    });
    let ui = Ui::with(Setup { saved: Some(saved), ..Setup::default() });
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/selected_transcription_engine"], "SpeechCpp");
    assert_eq!(snapshot["/get/data/local_asr_notice"], true);
    assert_eq!(snapshot["/get/data/ui_language"], "en");
    assert_eq!(snapshot["/get/data/hotkeys"]["toggle_translation"], json!(["Ctrl", "T"]));
    assert_eq!(snapshot["/get/data/hotkeys"]["toggle_tts"], Value::Null, "new actions are added unset");

    let url = ui.wait_endpoint(0, "/set/data/lmstudio_url");
    assert_eq!((url["status"].clone(), error_code(&url)), (json!(400), "CONNECTION_LMSTUDIO_URL_INVALID"));
    assert_eq!(url["result"]["data"], "");
    let license = ui.wait_endpoint(0, "/run/ctranslate2_license_notice");
    assert_eq!(error_code(&license), "WEIGHT_CTRANSLATE2_NON_COMMERCIAL_NOTICE");
    assert_eq!(license["result"]["data"], json!({ "weight_type": "nllb-200-distilled-600M-ct2-int8", "license": "CC-BY-NC-4.0" }));
    ui.ok("/run/shutdown", None);
    let saved = ui.saved();
    assert_eq!(saved["AUTH_KEYS"]["DeepL_API"], "kept-key", "a saved key is kept even while its engine is unavailable");
    assert_eq!(saved["CTRANSLATE2_LICENSE_NOTICE_SHOWN"], true, "the notice is shown once");
    assert_eq!(saved["LOCAL_ASR_MIGRATION"], 2);
    ui.stop();
}

#[test]
fn a_failed_save_is_reported_once_and_its_recovery_too() {
    let dir = tempfile::tempdir().unwrap();
    let ui = Ui::with(Setup { dir: Some(dir.path().to_path_buf()), ..Setup::default() });
    ui.ready();
    // A folder where the settings file goes makes the rename fail.
    std::fs::remove_file(dir.path().join("config.json")).unwrap();
    std::fs::create_dir(dir.path().join("config.json")).unwrap();
    let mark = ui.send("/set/data/main_window_geometry", Some(json!({ "x_pos": 1, "y_pos": 1, "width": 900, "height": 700 })));
    let failed = ui.wait_endpoint(mark, "/run/config_save_failed");
    assert!(failed["result"]["reason"].is_string());
    assert!(failed["result"]["path"].as_str().unwrap().ends_with("config.json"));
    ui.ok("/set/data/main_window_geometry", Some(json!({ "x_pos": 2, "y_pos": 1, "width": 900, "height": 700 })));
    assert_eq!(ui.on(mark, "/run/config_save_failed").len(), 1, "reported once while it keeps failing");
    std::fs::remove_dir(dir.path().join("config.json")).unwrap();
    let mark = ui.send("/set/data/main_window_geometry", Some(json!({ "x_pos": 3, "y_pos": 1, "width": 900, "height": 700 })));
    ui.wait_endpoint(mark, "/run/config_save_recovered");
    assert_eq!(ui.saved()["MAIN_WINDOW_GEOMETRY"]["x_pos"], 3);
    ui.stop();
}
