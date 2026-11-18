//! The endpoints, in the order of Python's `mapping` (`mainloop.py`). An endpoint whose feature
//! is not wired yet is not listed and answers 404; `docs/voice-stack/core-integration.md` keeps
//! the list of what is left.

use super::settings::{
    compute_device, get, integer, integer_or_message, store, store_text, switch, threshold, transcription_model,
    vad_switch, vr_panel_font_size,
};
use super::{Core, languages, ok, ok_true};
use crate::dispatch::Routes;
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::sync::Arc;

/// The endpoint waits for start-up to end (`"status": False` in Python's `mapping`).
pub(crate) const WAIT: bool = true;
/// The endpoint answers from the start.
pub(crate) const OPEN: bool = false;

/// Adds endpoints; each area of the controller adds its own through it.
pub(crate) struct Builder<'a> {
    pub(crate) routes: Routes,
    pub(crate) core: &'a Arc<Core>,
}

impl Builder<'_> {
    pub(crate) fn add(&mut self, endpoint: &str, wait: bool, handler: impl Fn(&Value) -> Reply + Send + Sync + 'static) {
        self.routes.add(endpoint, wait, handler);
    }

    /// A handler that needs the core.
    pub(crate) fn with(&mut self, endpoint: &str, wait: bool, handler: impl Fn(&Arc<Core>, &Value) -> Reply + Send + Sync + 'static) {
        let core = Arc::clone(self.core);
        self.routes.add(endpoint, wait, move |data| handler(&core, data));
    }

    pub(crate) fn get(&mut self, endpoint: &str, wait: bool, key: &'static str) {
        let handler = get(self.core, key);
        self.add(endpoint, wait, handler);
    }

    /// `/get/data/x`, `/set/enable/x` and `/set/disable/x` of a plain switch.
    pub(crate) fn switch(&mut self, name: &str, key: &'static str, with_get: bool) {
        if with_get {
            self.get(&format!("/get/data/{name}"), OPEN, key);
        }
        let on = switch(self.core, key, true);
        let off = switch(self.core, key, false);
        self.add(&format!("/set/enable/{name}"), OPEN, on);
        self.add(&format!("/set/disable/{name}"), OPEN, off);
    }

    /// The VAD switch of a source: [`vad_switch`].
    fn vad_switch(&mut self, name: &str, key: &'static str) {
        self.get(&format!("/get/data/{name}"), OPEN, key);
        let on = vad_switch(self.core, key, true);
        let off = vad_switch(self.core, key, false);
        self.add(&format!("/set/enable/{name}"), OPEN, on);
        self.add(&format!("/set/disable/{name}"), OPEN, off);
    }
}

pub fn routes(core: &Arc<Core>) -> Routes {
    let mut b = Builder { routes: Routes::new(), core };

    // Main window
    b.switch("foreground", "ENABLE_FOREGROUND", true);
    b.get("/get/data/selected_tab_no", OPEN, "SELECTED_TAB_NO");
    b.with("/set/data/selected_tab_no", OPEN, |core, data| languages::set_tab(core, data));
    b.switch("main_window_sidebar_compact_mode", "MAIN_WINDOW_SIDEBAR_COMPACT_MODE", true);
    b.with("/get/data/selectable_translation_engines", OPEN, |core, _| ok(json!(core.selectable_translation_engines())));
    b.with("/get/data/selectable_language_list", OPEN, |core, _| ok(json!(core.language_and_country_list())));
    b.get("/get/data/selected_translation_engines", WAIT, "SELECTED_TRANSLATION_ENGINES");
    b.with("/set/data/selected_translation_engines", OPEN, |core, data| {
        languages::set_languages(core, "SELECTED_TRANSLATION_ENGINES", data)
    });
    b.get("/get/data/selected_your_languages", OPEN, "SELECTED_YOUR_LANGUAGES");
    b.with("/set/data/selected_your_languages", OPEN, |core, data| languages::set_languages(core, "SELECTED_YOUR_LANGUAGES", data));
    b.get("/get/data/selected_target_languages", OPEN, "SELECTED_TARGET_LANGUAGES");
    b.with("/set/data/selected_target_languages", OPEN, |core, data| {
        languages::set_languages(core, "SELECTED_TARGET_LANGUAGES", data)
    });
    b.with("/get/data/selectable_transcription_engines", WAIT, |core, _| ok(json!(core.selectable_transcription_engines())));
    b.get("/get/data/selected_transcription_engine", WAIT, "SELECTED_TRANSCRIPTION_ENGINE");
    b.with("/set/data/selected_transcription_engine", WAIT, |core, data| {
        let engine = super::settings::python_str(data);
        // Only an engine of the list can be chosen. Anything else (the retired Whisper and
        // Google, an unknown name, a value that is not a name) is refused and nothing stops:
        // Python's setter raised and the request answered 500 (#278).
        let listed = core.config().get("SELECTABLE_TRANSCRIPTION_ENGINE_LIST");
        if !listed.as_array().is_some_and(|engines| engines.contains(&json!(engine))) {
            return super::error("VALIDATION_CONFIG_VALUE_INVALID", core.config().get("SELECTED_TRANSCRIPTION_ENGINE"));
        }
        // An engine the start-up left unchecked is checked first (#457); one that fails is
        // not selected.
        if !core.ensure_transcription_engine(&engine) {
            return ok(core.config().get("SELECTED_TRANSCRIPTION_ENGINE"));
        }
        core.update_transcription_engine(Some(json!(engine)));
        ok(core.config().get("SELECTED_TRANSCRIPTION_ENGINE"))
    });

    for (provider, list, key) in [
        ("groq_whisper", "SELECTABLE_GROQ_WHISPER_MODEL_LIST", "SELECTED_GROQ_WHISPER_MODEL"),
        ("openai_whisper", "SELECTABLE_OPENAI_WHISPER_MODEL_LIST", "SELECTED_OPENAI_WHISPER_MODEL"),
        ("custom_whisper", "SELECTABLE_CUSTOM_WHISPER_MODEL_LIST", "SELECTED_CUSTOM_WHISPER_MODEL"),
        ("deepgram", "SELECTABLE_DEEPGRAM_MODEL_LIST", "SELECTED_DEEPGRAM_MODEL"),
    ] {
        if provider == "custom_whisper" {
            b.get("/get/data/custom_whisper_url", OPEN, "TRANSCRIPTION_CUSTOM_URL");
        }
        b.get(&format!("/get/data/selectable_{provider}_model_list"), OPEN, list);
        b.get(&format!("/get/data/selected_{provider}_model"), OPEN, key);
        let set = transcription_model(core, list, key);
        b.add(&format!("/set/data/selected_{provider}_model"), OPEN, set);
    }

    b.get("/get/data/selectable_release_channels", OPEN, "SELECTABLE_RELEASE_CHANNEL_LIST");
    b.get("/get/data/release_channel", OPEN, "SELECTED_RELEASE_CHANNEL");
    let release = store_text(core, "SELECTED_RELEASE_CHANNEL", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/release_channel", OPEN, release);

    b.get("/get/data/telemetry", OPEN, "ENABLE_TELEMETRY");
    b.switch("auto_download_models", "AUTO_DOWNLOAD_MODELS", true);
    b.with("/run/shutdown", OPEN, |core, _| {
        core.shutdown();
        ok_true()
    });
    b.with("/run/swap_your_language_and_target_language", OPEN, |core, _| languages::swap_languages(core));
    // Turning translation on loads the local model and waits for the translation pipeline;
    // turning it off clears the switch and the microphone's queued speech of translations.
    b.with("/set/disable/translation", WAIT, |core, _| {
        core.cancel_mic_voice();
        let _ = core.config().set("ENABLE_TRANSLATION", json!(false));
        ok(core.config().get("ENABLE_TRANSLATION"))
    });

    // Audio devices: the saved choices (the lists and the changes are in `audio_devices`)
    for (name, key) in [
        ("auto_mic_select", "AUTO_MIC_SELECT"),
        ("auto_speaker_select", "AUTO_SPEAKER_SELECT"),
        ("selected_mic_host", "SELECTED_MIC_HOST"),
        ("selected_mic_device", "SELECTED_MIC_DEVICE"),
        ("selected_mic_device_id", "SELECTED_MIC_DEVICE_ID"),
        ("selected_speaker_device", "SELECTED_SPEAKER_DEVICE"),
        ("selected_speaker_device_id", "SELECTED_SPEAKER_DEVICE_ID"),
    ] {
        b.get(&format!("/get/data/{name}"), OPEN, key);
    }
    b.get("/get/data/voice_settings", OPEN, "VOICE_SETTINGS");
    // Core only (#531): the block an RVC conversion cuts the microphone into, read when one
    // starts. Refused unless 20 to 200 ms in steps of 20; the saved value stays.
    b.get("/get/data/rvc_block_ms", OPEN, "RVC_BLOCK_MS");
    let rvc_block = integer(core, "RVC_BLOCK_MS", "VALIDATION_RVC_BLOCK_MS", |v, _| {
        u32::try_from(v).ok().and_then(vrct_voice_conversion::protocol::Block::from_ms).is_some()
    });
    b.add("/set/data/rvc_block_ms", OPEN, rvc_block);

    // Appearance
    b.get("/get/data/version", OPEN, "VERSION");
    b.get("/get/data/transparency", OPEN, "TRANSPARENCY");
    let transparency = integer_or_message(core, "TRANSPARENCY", "Transparency must be a number");
    b.add("/set/data/transparency", OPEN, transparency);
    b.get("/get/data/ui_scaling", OPEN, "UI_SCALING");
    let ui_scaling = integer_or_message(core, "UI_SCALING", "UI scaling must be a number");
    b.add("/set/data/ui_scaling", OPEN, ui_scaling);
    b.get("/get/data/textbox_ui_scaling", OPEN, "TEXTBOX_UI_SCALING");
    let textbox = integer_or_message(core, "TEXTBOX_UI_SCALING", "Textbox UI scaling must be a number");
    b.add("/set/data/textbox_ui_scaling", OPEN, textbox);
    b.get("/get/data/message_box_ratio", OPEN, "MESSAGE_BOX_RATIO");
    let ratio = store(core, "MESSAGE_BOX_RATIO", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/message_box_ratio", OPEN, ratio);
    b.get("/get/data/send_message_button_type", OPEN, "SEND_MESSAGE_BUTTON_TYPE");
    let button = store(core, "SEND_MESSAGE_BUTTON_TYPE", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/send_message_button_type", OPEN, button);
    b.switch("show_resend_button", "SHOW_RESEND_BUTTON", true);
    b.get("/get/data/font_family", OPEN, "FONT_FAMILY");
    let font = store(core, "FONT_FAMILY", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/font_family", OPEN, font);
    b.get("/get/data/ui_language", OPEN, "UI_LANGUAGE");
    let ui_language = store(core, "UI_LANGUAGE", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/ui_language", OPEN, ui_language);
    b.get("/get/data/main_window_geometry", OPEN, "MAIN_WINDOW_GEOMETRY");
    let geometry = store(core, "MAIN_WINDOW_GEOMETRY", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/main_window_geometry", OPEN, geometry);

    // Compute device and the local translation
    b.get("/get/data/compute_mode", OPEN, "COMPUTE_MODE");
    b.get("/get/data/selectable_translation_compute_device_list", OPEN, "SELECTABLE_COMPUTE_DEVICE_LIST");
    b.get("/get/data/selected_translation_compute_device", OPEN, "SELECTED_TRANSLATION_COMPUTE_DEVICE");
    let device = compute_device(core);
    b.add("/set/data/selected_translation_compute_device", OPEN, device);
    b.get("/get/data/selectable_ctranslate2_weight_type_dict", OPEN, "SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT");
    b.get("/get/data/selected_ctranslate2_weight_type", OPEN, "CTRANSLATE2_WEIGHT_TYPE");
    b.get("/get/data/selected_translation_compute_type", OPEN, "SELECTED_TRANSLATION_COMPUTE_TYPE");
    b.with("/set/data/selected_translation_compute_type", OPEN, |core, data| {
        // Python let a refused type raise: 500.
        match core.config().set("SELECTED_TRANSLATION_COMPUTE_TYPE", json!(super::settings::python_str(data))) {
            Ok(value) => ok(value),
            Err(_) => Reply::status(500, "Internal error"),
        }
    });

    // Transliteration (the conversion itself runs with the message pipeline)
    b.switch("convert_message_to_romaji", "CONVERT_MESSAGE_TO_ROMAJI", true);
    b.switch("convert_message_to_hiragana", "CONVERT_MESSAGE_TO_HIRAGANA", true);

    // Transcription settings
    b.get("/get/data/mic_threshold", OPEN, "MIC_THRESHOLD");
    let mic_threshold = integer(core, "MIC_THRESHOLD", "VALIDATION_MIC_THRESHOLD", |v, c| {
        v >= 0 && v <= c.config().get("MAX_MIC_THRESHOLD").as_i64().unwrap_or(0)
    });
    b.add("/set/data/mic_threshold", OPEN, mic_threshold);
    b.switch("mic_automatic_threshold", "MIC_AUTOMATIC_THRESHOLD", true);
    b.get("/get/data/mic_record_timeout", OPEN, "MIC_RECORD_TIMEOUT");
    let record = integer(core, "MIC_RECORD_TIMEOUT", "VALIDATION_MIC_RECORD_TIMEOUT", |v, c| {
        v >= 0 && v <= c.config().get("MIC_PHRASE_TIMEOUT").as_i64().unwrap_or(0)
    });
    b.add("/set/data/mic_record_timeout", OPEN, record);
    b.get("/get/data/mic_phrase_timeout", OPEN, "MIC_PHRASE_TIMEOUT");
    let phrase = integer(core, "MIC_PHRASE_TIMEOUT", "VALIDATION_MIC_PHRASE_TIMEOUT", |v, c| {
        v >= c.config().get("MIC_RECORD_TIMEOUT").as_i64().unwrap_or(0)
    });
    b.add("/set/data/mic_phrase_timeout", OPEN, phrase);
    b.get("/get/data/mic_max_phrases", OPEN, "MIC_MAX_PHRASES");
    let phrases = integer(core, "MIC_MAX_PHRASES", "VALIDATION_MIC_MAX_PHRASES", |v, _| v >= 0);
    b.add("/set/data/mic_max_phrases", OPEN, phrases);
    b.get("/get/data/hotkeys", OPEN, "HOTKEYS");
    let hotkeys = store(core, "HOTKEYS", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/hotkeys", OPEN, hotkeys);
    b.get("/get/data/experimental_features", OPEN, "EXPERIMENTAL_FEATURES");
    let experimental = store(core, "EXPERIMENTAL_FEATURES", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/experimental_features", OPEN, experimental);
    b.get("/get/data/usage_presets", OPEN, "USAGE_PRESETS");
    let presets = store(core, "USAGE_PRESETS", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/usage_presets", OPEN, presets);
    b.get("/get/data/tray_companion_edge", OPEN, "TRAY_COMPANION_EDGE");
    let edge = store(core, "TRAY_COMPANION_EDGE", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/tray_companion_edge", OPEN, edge);
    b.get("/get/data/tray_companion_monitor", OPEN, "TRAY_COMPANION_MONITOR");
    let monitor = store(core, "TRAY_COMPANION_MONITOR", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/tray_companion_monitor", OPEN, monitor);
    b.get("/get/data/mic_avg_logprob", OPEN, "MIC_AVG_LOGPROB");
    let logprob = threshold(core, "MIC_AVG_LOGPROB", "Mic average logprob must be finite and between -2 and 0");
    b.add("/set/data/mic_avg_logprob", OPEN, logprob);
    b.get("/get/data/mic_no_speech_prob", OPEN, "MIC_NO_SPEECH_PROB");
    let no_speech = threshold(core, "MIC_NO_SPEECH_PROB", "Mic no-speech probability must be finite and between 0 and 1");
    b.add("/set/data/mic_no_speech_prob", OPEN, no_speech);
    b.vad_switch("mic_vad_filter", "MIC_ENABLE_VAD");
    b.get("/get/data/mic_word_filter", OPEN, "MIC_WORD_FILTER");
    // The filter is applied by the recognition, which reads the stored words when it starts.
    b.with("/set/data/mic_word_filter", OPEN, |core, data| {
        // Python let anything but a list of words raise: 500.
        if !data.is_array() {
            return Reply::status(500, "Internal error");
        }
        match core.config().set("MIC_WORD_FILTER", data.clone()) {
            Ok(value) => ok(value),
            Err(_) => Reply::status(500, "Internal error"),
        }
    });

    b.get("/get/data/speaker_threshold", OPEN, "SPEAKER_THRESHOLD");
    let speaker_threshold = integer(core, "SPEAKER_THRESHOLD", "VALIDATION_SPEAKER_THRESHOLD", |v, c| {
        v >= 0 && v <= c.config().get("MAX_SPEAKER_THRESHOLD").as_i64().unwrap_or(0)
    });
    b.add("/set/data/speaker_threshold", OPEN, speaker_threshold);
    b.switch("speaker_automatic_threshold", "SPEAKER_AUTOMATIC_THRESHOLD", true);
    b.get("/get/data/speaker_record_timeout", OPEN, "SPEAKER_RECORD_TIMEOUT");
    let speaker_record = integer(core, "SPEAKER_RECORD_TIMEOUT", "VALIDATION_SPEAKER_RECORD_TIMEOUT", |v, c| {
        v >= 0 && v <= c.config().get("SPEAKER_PHRASE_TIMEOUT").as_i64().unwrap_or(0)
    });
    b.add("/set/data/speaker_record_timeout", OPEN, speaker_record);
    b.get("/get/data/speaker_phrase_timeout", OPEN, "SPEAKER_PHRASE_TIMEOUT");
    let speaker_phrase = integer(core, "SPEAKER_PHRASE_TIMEOUT", "VALIDATION_SPEAKER_PHRASE_TIMEOUT", |v, c| {
        v >= 0 && v >= c.config().get("SPEAKER_RECORD_TIMEOUT").as_i64().unwrap_or(0)
    });
    b.add("/set/data/speaker_phrase_timeout", OPEN, speaker_phrase);
    b.get("/get/data/speaker_max_phrases", OPEN, "SPEAKER_MAX_PHRASES");
    let speaker_phrases = integer(core, "SPEAKER_MAX_PHRASES", "VALIDATION_SPEAKER_MAX_PHRASES", |v, _| v >= 0);
    b.add("/set/data/speaker_max_phrases", OPEN, speaker_phrases);
    b.get("/get/data/speaker_avg_logprob", OPEN, "SPEAKER_AVG_LOGPROB");
    let speaker_logprob = threshold(core, "SPEAKER_AVG_LOGPROB", "Speaker average logprob must be finite and between -2 and 0");
    b.add("/set/data/speaker_avg_logprob", OPEN, speaker_logprob);
    b.get("/get/data/speaker_no_speech_prob", OPEN, "SPEAKER_NO_SPEECH_PROB");
    let speaker_no_speech =
        threshold(core, "SPEAKER_NO_SPEECH_PROB", "Speaker no-speech probability must be finite and between 0 and 1");
    b.add("/set/data/speaker_no_speech_prob", OPEN, speaker_no_speech);
    b.vad_switch("speaker_vad_filter", "SPEAKER_ENABLE_VAD");
    // Whether the VAD switches can be turned on: the speech.cpp server is set up for Silero VAD
    // (decision 13).
    b.with("/get/data/vad_available", OPEN, |core, _| ok(json!(core.vad_available())));

    // The notice of the move from the removed Whisper engine to speech.cpp
    // (`/get/data/local_asr_notice`, `/set/disable/local_asr_notice`) went in 0.6.0 (#288).

    // The virtual microphone guide (#321); finding the cables and the check are in `audio_devices`.
    b.get("/get/data/virtual_mic_notice", OPEN, "VIRTUAL_MIC_NOTICE_PENDING");
    b.with("/set/disable/virtual_mic_notice", OPEN, |core, _| {
        let _ = core.config().set("VIRTUAL_MIC_NOTICE_PENDING", json!(false));
        ok(core.config().get("VIRTUAL_MIC_NOTICE_PENDING"))
    });

    // The first-run setup (#557): whether it may still open by itself. It downloads nothing
    // without the user's consent in its own dialog.
    b.get("/get/data/first_run_setup", OPEN, "FIRST_RUN_SETUP_PENDING");
    b.with("/set/disable/first_run_setup", OPEN, |core, _| {
        let _ = core.config().set("FIRST_RUN_SETUP_PENDING", json!(false));
        ok(core.config().get("FIRST_RUN_SETUP_PENDING"))
    });

    // VR: the values the VR UI reads; the overlay itself is not wired yet (#282)
    b.with("/get/data/overlay_vr_panel_opacity", OPEN, |core, _| ok(core.config().get("OVERLAY_VR_PANEL_SETTINGS")["opacity"].clone()));
    b.with("/get/data/overlay_vr_panel_anchor", OPEN, |core, _| ok(core.config().get("OVERLAY_VR_PANEL_SETTINGS")["tracker"].clone()));
    b.get("/get/data/overlay_vr_panel_locked", OPEN, "OVERLAY_VR_PANEL_LOCKED");
    b.get("/get/data/overlay_vr_panel_font_size", OPEN, "OVERLAY_VR_PANEL_FONT_SIZE");
    b.with("/get/data/overlay_vr_launcher_hand", OPEN, |core, _| ok(core.config().get("OVERLAY_VR_LAUNCHER_SETTINGS")["tracker"].clone()));
    b.get("/get/data/overlay_vr_launcher_auto_hide", OPEN, "OVERLAY_VR_LAUNCHER_AUTO_HIDE");
    b.switch("overlay_vr_tooltip", "OVERLAY_VR_TOOLTIP", true);
    let font_size = vr_panel_font_size(core);
    b.add("/set/data/overlay_vr_panel_font_size", OPEN, font_size);
    b.get("/get/data/overlay_small_log", OPEN, "OVERLAY_SMALL_LOG");
    b.get("/get/data/overlay_small_log_settings", OPEN, "OVERLAY_SMALL_LOG_SETTINGS");
    b.get("/get/data/overlay_large_log", OPEN, "OVERLAY_LARGE_LOG");
    b.get("/get/data/overlay_vr_panel", OPEN, "OVERLAY_VR_PANEL");
    b.get("/get/data/overlay_large_log_settings", OPEN, "OVERLAY_LARGE_LOG_SETTINGS");

    // Captions over the desktop (drawn by the UI in its own window)
    b.switch("overlay_desktop", "OVERLAY_DESKTOP", true);
    b.get("/get/data/overlay_desktop_settings", OPEN, "OVERLAY_DESKTOP_SETTINGS");
    let desktop = store(core, "OVERLAY_DESKTOP_SETTINGS", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/overlay_desktop_settings", OPEN, desktop);
    b.get("/get/data/overlay_desktop_placement", OPEN, "OVERLAY_DESKTOP_PLACEMENT");
    let placement = store(core, "OVERLAY_DESKTOP_PLACEMENT", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/overlay_desktop_placement", OPEN, placement);
    b.get("/get/data/io_flow_overlay_settings", OPEN, "IO_FLOW_OVERLAY_SETTINGS");
    let io_flow = store(core, "IO_FLOW_OVERLAY_SETTINGS", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/io_flow_overlay_settings", OPEN, io_flow);
    b.switch("overlay_show_only_translated_messages", "OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES", true);

    // Others
    b.get("/get/data/send_message_format_parts", OPEN, "SEND_MESSAGE_FORMAT_PARTS");
    let send_format = store(core, "SEND_MESSAGE_FORMAT_PARTS", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/send_message_format_parts", OPEN, send_format);
    b.get("/get/data/received_message_format_parts", OPEN, "RECEIVED_MESSAGE_FORMAT_PARTS");
    let received_format = store(core, "RECEIVED_MESSAGE_FORMAT_PARTS", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/received_message_format_parts", OPEN, received_format);
    b.switch("auto_clear_message_box", "AUTO_CLEAR_MESSAGE_BOX", true);
    b.switch("send_only_translated_messages", "SEND_ONLY_TRANSLATED_MESSAGES", true);
    // The conversation log switch opens and closes the log file: `messages::add`.
    b.switch("check_software_updates", "CHECK_SOFTWARE_UPDATES", true);
    b.get("/get/data/vrc_mic_mute_sync", OPEN, "VRC_MIC_MUTE_SYNC");
    b.get("/get/data/send_message_to_vrc", OPEN, "SEND_MESSAGE_TO_VRC");
    b.switch("send_received_message_to_vrc", "SEND_RECEIVED_MESSAGE_TO_VRC", true);

    // WebSocket and OBS: the values (the servers are wired with the adapters)
    b.get("/get/data/websocket_host", OPEN, "WEBSOCKET_HOST");
    b.get("/get/data/websocket_port", OPEN, "WEBSOCKET_PORT");
    b.get("/get/data/websocket_auth_token", OPEN, "WEBSOCKET_AUTH_TOKEN");
    b.with("/get/data/websocket_tls", OPEN, |core, _| {
        ok(json!({ "cert_file": core.config().get("WEBSOCKET_TLS_CERT_FILE"), "key_file": core.config().get("WEBSOCKET_TLS_KEY_FILE") }))
    });
    b.get("/get/data/websocket_server", OPEN, "WEBSOCKET_SERVER");
    b.get("/get/data/obs_browser_source", OPEN, "OBS_BROWSER_SOURCE");
    for (name, key) in [
        ("port", "OBS_BROWSER_SOURCE_PORT"),
        ("max_messages", "OBS_BROWSER_SOURCE_MAX_MESSAGES"),
        ("display_duration", "OBS_BROWSER_SOURCE_DISPLAY_DURATION"),
        ("fadeout_duration", "OBS_BROWSER_SOURCE_FADEOUT_DURATION"),
        ("font_size", "OBS_BROWSER_SOURCE_FONT_SIZE"),
        ("font_color", "OBS_BROWSER_SOURCE_FONT_COLOR"),
        ("font_outline_thickness", "OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS"),
        ("font_outline_color", "OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR"),
    ] {
        b.get(&format!("/get/data/obs_browser_source_{name}"), OPEN, key);
    }

    // Clipboard
    b.switch("clipboard", "ENABLE_CLIPBOARD", true);

    // OCR settings (the capture is wired with the OCR runtime)
    b.get("/get/data/selectable_ocr_source_languages", OPEN, "SELECTABLE_OCR_SOURCE_LANGUAGE_LIST");
    b.get("/get/data/ocr_source_language", OPEN, "OCR_SOURCE_LANGUAGE");
    b.get("/get/data/ocr_window_title", OPEN, "OCR_WINDOW_TITLE");
    b.get("/get/data/ocr_poll_interval_ms", OPEN, "OCR_POLL_INTERVAL_MS");
    b.get("/get/data/ocr_min_confidence", OPEN, "OCR_MIN_CONFIDENCE");
    b.get("/get/data/ocr_bubble_min_text_length", OPEN, "OCR_BUBBLE_MIN_TEXT_LENGTH");
    b.get("/get/data/ocr_capture_region", OPEN, "OCR_CAPTURE_REGION");
    b.get("/get/data/ocr_vr_capture_region", OPEN, "OCR_VR_CAPTURE_REGION");
    b.get("/get/data/ocr_chatbox_filter", OPEN, "OCR_CHATBOX_FILTER");
    b.get("/get/data/ocr_use_chatbox_detector", OPEN, "OCR_USE_CHATBOX_DETECTOR");
    b.get("/get/data/ocr_portal_restore_token", OPEN, "OCR_PORTAL_RESTORE_TOKEN");
    let portal = store(core, "OCR_PORTAL_RESTORE_TOKEN", "VALIDATION_CONFIG_VALUE_INVALID");
    b.add("/set/data/ocr_portal_restore_token", OPEN, portal);

    // Advanced settings
    b.get("/get/data/osc_ip_address", OPEN, "OSC_IP_ADDRESS");
    b.get("/get/data/osc_port", OPEN, "OSC_PORT");
    b.switch("notification_vrc_sfx", "NOTIFICATION_VRC_SFX", true);
    b.with("/run/feed_watchdog", OPEN, |core, _| {
        core.feed_watchdog();
        ok_true()
    });

    // Each wired area adds its endpoints here, in its own module.
    for add in AREAS {
        add(&mut b);
    }
    b.routes
}

/// The areas wired to their crates, each with an `add(&mut Builder)`.
const AREAS: &[fn(&mut Builder<'_>)] = &[
    super::speech::add,
    super::telemetry::add,
    super::downloads::add,
    super::adapters::add,
    super::credentials::add,
    super::ocr::add,
    super::overlay::add,
    super::speakers::add,
    super::files::add,
    super::translation::add,
    super::translation_catalog::add,
    super::messages::add,
    super::audio_devices::add,
    super::updates::add,
    super::transcription::add,
    super::voice::add,
    super::gpu_memory::add,
];
