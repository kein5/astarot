//! The endpoints that read, store or forget a setting whose feature is not running in the core
//! (`src/controller/credentials.rs`, `ocr.rs`, `overlay.rs`, `files.rs`): the answers, the error
//! codes and the rolled-back values are Python's, what is stored reaches `config.json`, and no
//! saved key is written to the logs.

mod common;

use common::{Setup, Ui, error_code};
use serde_json::{Value, json};

fn keys() -> Value {
    json!({
        "AUTH_KEYS": {
            "DeepL_API": "deepl-key:fx", "Plamo_API": "plamo-key", "Gemini_API": "gemini-key", "OpenAI_API": "openai-key",
            "OpenAI_Compatible": "compatible-key", "Groq_API": "groq-key", "OpenRouter_API": "openrouter-key",
        },
        "TRANSCRIPTION_AUTH_KEYS": { "Groq_Whisper": "gw-key", "OpenAI_Whisper": "ow-key", "Custom_Whisper": "cw-key", "Deepgram": "dg-key" },
        "OPENAI_COMPATIBLE_URL": "https://api.example.com/v1",
        "TRANSCRIPTION_CUSTOM_URL": "http://127.0.0.1:9000/v1",
        "SELECTED_GEMINI_MODEL": "gemini-2.5-flash",
    })
}

fn with_keys() -> Ui {
    let ui = Ui::with(Setup { saved: Some(keys()), ..Setup::default() });
    ui.ready();
    ui
}

#[test]
fn saved_keys_and_choices_are_answered_and_in_the_start_up_snapshot() {
    let ui = Ui::with(Setup { saved: Some(keys()), ..Setup::default() });
    let snapshot = ui.ready();
    for (name, key) in [
        ("deepl", "deepl-key:fx"), ("plamo", "plamo-key"), ("gemini", "gemini-key"), ("openai", "openai-key"),
        ("groq", "groq-key"), ("openrouter", "openrouter-key"), ("openai_compatible", "compatible-key"),
        ("groq_whisper", "gw-key"), ("openai_whisper", "ow-key"), ("custom_whisper", "cw-key"), ("deepgram", "dg-key"),
    ] {
        assert_eq!(ui.ok(&format!("/get/data/{name}_auth_key"), None), key, "{name}");
    }
    // An engine without a client keeps its choice; one that lists a server's models forgets it.
    assert_eq!(snapshot["/get/data/selected_gemini_model"], "gemini-2.5-flash");
    assert_eq!(snapshot["/get/data/selectable_gemini_model_list"], json!([]));
    assert_eq!(snapshot["/get/data/selected_lmstudio_model"], Value::Null);
    assert_eq!(snapshot["/get/data/openai_compatible_url"], "https://api.example.com/v1");
    assert_eq!(snapshot["/get/data/lmstudio_url"], "http://127.0.0.1:1234/v1");
    ui.ok("/run/shutdown", None);
    let logs = std::fs::read_to_string(ui.dir.join("logs").join("process.log")).unwrap();
    assert!(logs.contains("/get/data/deepl_auth_key"), "the answers are logged, masked");
    for key in ["deepl-key", "plamo-key", "gemini-key", "compatible-key", "gw-key", "dg-key"] {
        assert!(!logs.contains(key), "{key} is not written to the log");
    }
    ui.stop();
}

#[test]
fn deleting_a_translation_key_forgets_its_models_and_tells_the_ui() {
    let ui = with_keys();
    let mark = ui.send("/delete/data/gemini_auth_key", None);
    let answer = ui.wait_endpoint(mark, "/delete/data/gemini_auth_key");
    assert_eq!(answer["status"], 200);
    assert_eq!(answer["result"], Value::Null);
    assert_eq!(ui.on(mark, "/run/selectable_gemini_model_list")[0]["result"], json!([]));
    assert_eq!(ui.on(mark, "/run/selected_gemini_model")[0]["result"], Value::Null);
    assert!(!ui.on(mark, "/run/translation_engines").is_empty(), "the engines are offered again");
    assert_eq!(ui.ok("/get/data/selected_gemini_model", None), Value::Null);
    // DeepL has no models: only the key goes.
    let mark = ui.send("/delete/data/deepl_auth_key", None);
    assert_eq!(ui.wait_endpoint(mark, "/delete/data/deepl_auth_key")["result"], Value::Null);
    assert!(ui.on(mark, "/run/selected_deepl_model").is_empty());
    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    assert_eq!(file["AUTH_KEYS"]["Gemini_API"], Value::Null);
    assert_eq!(file["AUTH_KEYS"]["DeepL_API"], Value::Null);
    assert_eq!(file["AUTH_KEYS"]["OpenAI_API"], "openai-key", "another provider's key stays");
    assert_eq!(file["SELECTED_GEMINI_MODEL"], Value::Null);
    ui.stop();
}

#[test]
fn deleting_a_recognition_key_forgets_its_models() {
    let ui = with_keys();
    let mark = ui.send("/delete/data/deepgram_auth_key", None);
    assert_eq!(ui.wait_endpoint(mark, "/delete/data/deepgram_auth_key")["result"], Value::Null);
    assert_eq!(ui.on(mark, "/run/selectable_deepgram_model_list")[0]["result"], json!([]));
    assert_eq!(ui.on(mark, "/run/selected_deepgram_model")[0]["result"], Value::Null);
    ui.ok("/delete/data/custom_whisper_auth_key", None);
    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    assert_eq!(file["TRANSCRIPTION_AUTH_KEYS"]["Deepgram"], Value::Null);
    assert_eq!(file["TRANSCRIPTION_AUTH_KEYS"]["Custom_Whisper"], Value::Null);
    assert_eq!(file["TRANSCRIPTION_AUTH_KEYS"]["Groq_Whisper"], "gw-key");
    ui.stop();
}

#[test]
fn a_url_changes_only_after_its_key_is_deleted() {
    let ui = with_keys();
    for (endpoint, invalid, current) in [
        ("/set/data/openai_compatible_url", "CONNECTION_OPENAI_COMPATIBLE_URL_INVALID", "https://api.example.com/v1"),
        ("/set/data/custom_whisper_url", "CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID", "http://127.0.0.1:9000/v1"),
    ] {
        // Plain HTTP to a remote host, a key in the query, not a string: refused, rolled back.
        for bad in [json!("http://example.com/v1"), json!("https://api.example.com/v1?api_key=x"), json!(5), json!("")] {
            let answer = ui.request(endpoint, Some(bad.clone()));
            assert_eq!(answer["status"], 400, "{endpoint} {bad}");
            assert_eq!(error_code(&answer), invalid);
            assert_eq!(answer["result"]["data"], current);
        }
        // The same URL (spaces around it are dropped) is not a change.
        assert_eq!(ui.ok(endpoint, Some(json!(format!("  {current} ")))), current);
        // A saved key must be entered again for a new destination.
        let answer = ui.request(endpoint, Some(json!("https://other.example.com/v1")));
        assert_eq!(error_code(&answer), "CREDENTIAL_REENTRY_REQUIRED");
        assert_eq!(answer["result"]["data"], current);
    }
    ui.ok("/delete/data/openai_compatible_auth_key", None);
    ui.ok("/delete/data/custom_whisper_auth_key", None);
    assert_eq!(ui.ok("/set/data/openai_compatible_url", Some(json!("https://other.example.com/v1"))), "https://other.example.com/v1");
    assert_eq!(ui.ok("/set/data/custom_whisper_url", Some(json!("http://localhost:8080/v1"))), "http://localhost:8080/v1");
    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    assert_eq!(file["OPENAI_COMPATIBLE_URL"], "https://other.example.com/v1");
    assert_eq!(file["TRANSCRIPTION_CUSTOM_URL"], "http://localhost:8080/v1");
    ui.stop();
}

#[test]
fn chat_reading_settings_are_checked_and_stored() {
    let ui = Ui::start();
    ui.ready();
    assert_eq!(ui.ok("/set/data/ocr_window_title", Some(json!("  VRChat Beta "))), "VRChat Beta");
    let answer = ui.request("/set/data/ocr_window_title", Some(json!("   ")));
    assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID");
    assert_eq!(answer["result"]["data"], "VRChat Beta");

    assert_eq!(ui.ok("/set/data/ocr_poll_interval_ms", Some(json!(1000))), 1000);
    assert_eq!(error_code(&ui.request("/set/data/ocr_poll_interval_ms", Some(json!(50)))), "VALIDATION_CONFIG_VALUE_INVALID");
    assert_eq!(ui.ok("/set/data/ocr_min_confidence", Some(json!(0.7))), 0.7);
    let answer = ui.request("/set/data/ocr_min_confidence", Some(json!(1.5)));
    assert_eq!(answer["result"]["data"], 0.7);
    assert_eq!(ui.ok("/set/data/ocr_bubble_min_text_length", Some(json!(4))), 4);

    // Slider values are rounded to four places.
    let region = ui.ok("/set/data/ocr_capture_region", Some(json!({ "x": 0.123456789, "y": 0.1, "width": 0.5, "height": 0.5 })));
    assert_eq!(region, json!({ "x": 0.1235, "y": 0.1, "width": 0.5, "height": 0.5 }));
    let answer = ui.request("/set/data/ocr_vr_capture_region", Some(json!({ "x": 0.9, "y": 0.0, "width": 0.5, "height": 1.0 })));
    assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID", "outside the frame");
    assert_eq!(answer["result"]["data"], json!({ "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0 }));

    assert_eq!(ui.ok("/set/disable/ocr_chatbox_filter", None), false);
    assert_eq!(ui.ok("/set/disable/ocr_use_chatbox_detector", None), false);
    assert_eq!(ui.ok("/set/enable/ocr_use_chatbox_detector", None), true);
    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    assert_eq!(file["OCR_WINDOW_TITLE"], "VRChat Beta");
    assert_eq!(file["OCR_POLL_INTERVAL_MS"], 1000);
    assert_eq!(file["OCR_CAPTURE_REGION"]["x"], 0.1235);
    assert_eq!(file["OCR_CHATBOX_FILTER"], false);
    assert_eq!(file["OCR_USE_CHATBOX_DETECTOR"], true);
    ui.stop();
}

#[test]
fn vr_window_settings_are_checked_and_stored() {
    let ui = Ui::start();
    ui.ready();
    assert_eq!(ui.ok("/set/data/overlay_vr_panel_opacity", Some(json!(0.456))), 0.46);
    assert_eq!(ui.ok("/set/data/overlay_vr_panel_opacity", Some(json!("0.8"))), 0.8);
    for bad in [json!(0.1), json!(1.5), json!("x"), json!({})] {
        let answer = ui.request("/set/data/overlay_vr_panel_opacity", Some(bad.clone()));
        assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID", "{bad}");
        assert_eq!(answer["result"]["data"], 0.8);
    }

    // The launcher moves to the same place on the other hand.
    // The default launcher, on the left wrist.
    let before = json!({ "x_pos": 0.0641, "y_pos": -0.0416 });
    assert_eq!(ui.ok("/set/data/overlay_vr_launcher_hand", Some(json!("RightHand"))), "RightHand");
    let answer = ui.request("/set/data/overlay_vr_launcher_hand", Some(json!("HMD")));
    assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID");
    assert_eq!(answer["result"]["data"], "RightHand");
    ui.ok("/run/shutdown", None);
    let moved = ui.saved()["OVERLAY_VR_LAUNCHER_SETTINGS"].clone();
    assert_eq!(moved["tracker"], "RightHand");
    assert_eq!(moved["x_pos"].as_f64().unwrap(), -before["x_pos"].as_f64().unwrap());
    assert_eq!(moved["y_pos"], before["y_pos"]);
    ui.stop();
}

#[test]
fn the_launcher_reset_and_the_overlay_switches() {
    let saved = json!({ "OVERLAY_SMALL_LOG": true, "OVERLAY_VR_PANEL": true, "OVERLAY_VR_PANEL_LOCKED": false });
    let ui = Ui::with(Setup { saved: Some(saved), ..Setup::default() });
    ui.ready();
    ui.ok("/set/data/overlay_vr_launcher_hand", Some(json!("RightHand")));
    let mark = ui.send("/run/vr_launcher_reset", None);
    assert_eq!(ui.wait_endpoint(mark, "/run/vr_launcher_reset")["result"], true);
    assert_eq!(ui.wait_endpoint(mark, "/run/overlay_vr_launcher_hand")["result"], "LeftHand");

    assert_eq!(ui.ok("/set/disable/overlay_small_log", None), false);
    assert_eq!(ui.ok("/set/disable/overlay_vr_panel", None), false);
    assert_eq!(ui.ok("/set/disable/overlay_large_log", None), false);
    assert_eq!(ui.ok("/set/enable/overlay_vr_panel_locked", None), true);
    assert_eq!(ui.ok("/set/disable/overlay_vr_launcher_auto_hide", None), false);

    let small = ui.ok("/get/data/overlay_small_log_settings", None);
    let mut changed = small.clone();
    changed["opacity"] = json!(0.5);
    assert_eq!(ui.ok("/set/data/overlay_small_log_settings", Some(changed.clone())), changed);
    let answer = ui.request("/set/data/overlay_large_log_settings", Some(json!({ "opacity": 0.5 })));
    assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID", "every key is required");
    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    assert_eq!(file["OVERLAY_SMALL_LOG"], false);
    assert_eq!(file["OVERLAY_VR_PANEL"], false);
    assert_eq!(file["OVERLAY_VR_PANEL_LOCKED"], true);
    assert_eq!(file["OVERLAY_VR_LAUNCHER_AUTO_HIDE"], false);
    assert_eq!(file["OVERLAY_VR_LAUNCHER_SETTINGS"]["tracker"], "LeftHand");
    assert_eq!(file["OVERLAY_SMALL_LOG_SETTINGS"]["opacity"], 0.5);
    ui.stop();
}

#[test]
fn the_old_whisper_weights_are_shown_and_removed_on_request_only() {
    let temp = tempfile::tempdir().unwrap();
    let whisper = temp.path().join("data").join("weights").join("whisper");
    std::fs::create_dir_all(whisper.join("base")).unwrap();
    std::fs::write(whisper.join("base").join("model.bin"), vec![0u8; 64]).unwrap();
    std::fs::create_dir_all(whisper.join("notes")).unwrap();
    let ui = Ui::with(Setup { dir: Some(temp.path().to_path_buf()), ..Setup::default() });
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/old_whisper_weights"], json!({ "total_bytes": 64, "folders": ["base"] }));
    assert!(whisper.join("base").exists(), "nothing is removed at start-up");
    let result = ui.ok("/run/delete_old_whisper_weights", None);
    assert_eq!(result, json!({ "total_bytes": 0, "folders": [], "freed_bytes": 64, "failed": [] }));
    assert!(whisper.join("notes").exists(), "a folder the app did not make stays");
    ui.stop();
}

#[test]
fn the_remaining_switches_and_choices() {
    let saved = json!({ "SELECTED_MIC_HOST": "Windows WASAPI", "SELECTED_SPEAKER_DEVICE_ID": "{0.0.0.00000000}.{abc}", "AUTO_MIC_SELECT": false });
    let ui = Ui::with(Setup { saved: Some(saved), ..Setup::default() });
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/auto_mic_select"], false);
    assert_eq!(snapshot["/get/data/selected_speaker_device_id"], "{0.0.0.00000000}.{abc}");
    assert_eq!(snapshot["/get/data/check_software_updates"], true);
    assert!(snapshot["/get/data/voice_settings"].is_object());

    assert_eq!(ui.ok("/set/enable/logger_feature", None), true);
    assert_eq!(ui.ok("/set/disable/check_software_updates", None), false);
    assert_eq!(ui.ok("/set/disable/translation", None), false);
    assert_eq!(ui.ok("/set/data/mic_word_filter", Some(json!(["a", "b", "a"]))), json!(["a", "b"]));
    assert_eq!(ui.request("/set/data/mic_word_filter", Some(json!("ab")))["status"], 500);
    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    assert_eq!(file["LOGGER_FEATURE"], true);
    assert_eq!(file["CHECK_SOFTWARE_UPDATES"], false);
    assert_eq!(file["MIC_WORD_FILTER"], json!(["a", "b"]));
    ui.stop();
}
