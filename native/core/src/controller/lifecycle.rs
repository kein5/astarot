//! The start-up sequence (`Controller.init`) and its notifications.
//!
//! The UI waits for `/run/initialization_complete`: one object with the answer of almost every
//! `/get/data/...` endpoint. Until it is sent, endpoints marked "wait" answer 423 inside and are
//! tried again. The order of the notifications before it is that of Python:
//! `/run/connected_network` (null: nothing is probed unless a download is due),
//! `/run/initialization_progress` 1 to 4, `/run/enable_ai_models`, the engines.

use super::Core;
use crate::dispatch::Dispatcher;
use crate::errors::ErrorReply;
use crate::languages::TRANSLATION_WEIGHTS;
use serde_json::{Map, Value, json};

/// Left out of `/run/initialization_complete`: they reach the network, a device or a server, or
/// they describe what runs. The UI asks for them itself (`_INIT_MAPPING_EXCLUDED_ENDPOINTS`).
pub const INIT_EXCLUDED: [&str; 7] = [
    "/get/data/available_releases",
    "/get/data/ocr_readiness",
    "/get/data/ocr_capture_status",
    "/get/data/vrchat_osc_presence",
    "/get/data/realtime_asr_models",
    "/get/data/telemetry_preview",
    "/get/data/tts_engine_voices",
];

/// The recognition engines the core can run. The cloud engines (Google, the Whisper APIs,
/// Deepgram) come with the providers of #278; until then they are not offered.
const WIRED_TRANSCRIPTION_ENGINES: [&str; 1] = ["SpeechCpp"];

/// The weights under a non-commercial license (CC-BY-NC-4.0).
pub fn non_commercial(weight: &str) -> bool {
    weight.starts_with("nllb-200")
}

impl Core {
    /// Runs the start-up sequence; the caller opens the endpoints afterwards.
    pub fn init(&self, dispatcher: &Dispatcher) {
        let config = self.config();
        self.notify("connected_network", Value::Null);
        self.notify("initialization_progress", json!(1));

        let weight = config.get_str("CTRANSLATE2_WEIGHT_TYPE");
        let available = (self.services().translation_weight_available)(&weight);
        self.set_translation_available(available);
        let uses_local = config.get("SELECTED_TRANSLATION_ENGINES")[config.get_str("SELECTED_TAB_NO")] == "CTranslate2";
        self.notify("enable_ai_models", json!(!(uses_local && !available)));

        self.step("Init Translation Engine Status");
        let mut status = Map::new();
        for engine in config.get("SELECTABLE_TRANSLATION_ENGINE_LIST").as_array().into_iter().flatten() {
            let name = engine.as_str().unwrap_or_default();
            // Only the local translation runs in the core so far; the online engines come with
            // the providers of #277. They are not offered, but their saved keys and models stay
            // as they are (Python cleared some selections when a check failed).
            status.insert(name.to_string(), json!(name == "CTranslate2" && available));
        }
        config.put("SELECTABLE_TRANSLATION_ENGINE_STATUS", Value::Object(status));

        self.step("Init Transcription Engine Status");
        let mut status = Map::new();
        for engine in config.get("SELECTABLE_TRANSCRIPTION_ENGINE_LIST").as_array().into_iter().flatten() {
            let name = engine.as_str().unwrap_or_default();
            status.insert(name.to_string(), json!(WIRED_TRANSCRIPTION_ENGINES.contains(&name)));
        }
        config.put("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS", Value::Object(status));
        self.notify("initialization_progress", json!(2));

        self.step("Set Translation Engine");
        let mut weights = Map::new();
        for candidate in TRANSLATION_WEIGHTS {
            let present = if candidate == weight { available } else { (self.services().translation_weight_available)(candidate) };
            weights.insert(candidate.to_string(), json!(present));
        }
        config.put("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT", Value::Object(weights));
        self.update_translation_engine_and_list();
        self.step("Set Transcription Engine");
        self.update_transcription_engine(None);
        self.notify("initialization_progress", json!(3));
        self.notify("initialization_progress", json!(4));

        self.step("Revalidate Selected Models");
        config.revalidate_selected_models();

        // Not before the user has answered the notice.
        self.start_telemetry();

        self.step("Update settings");
        self.notify("initialization_complete", Value::Object(self.snapshot(dispatcher)));
        self.notify_after_start();
    }

    /// The answers of the `/get/data/...` endpoints the UI needs at start (`updateConfigSettings`).
    /// A getter that fails gives `null`; the rest still go out.
    fn snapshot(&self, dispatcher: &Dispatcher) -> Map<String, Value> {
        let mut settings = Map::new();
        for endpoint in dispatcher.routes().endpoints() {
            if !endpoint.starts_with("/get/data/") || INIT_EXCLUDED.contains(&endpoint) {
                continue;
            }
            let route = dispatcher.routes().get(endpoint).expect("listed above");
            let handler = route.handler.clone();
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handler(&Value::Null)));
            let value = match result {
                Ok(reply) => reply.result,
                Err(_) => {
                    self.step("updateConfigSettings: a value could not be read");
                    Value::Null
                }
            };
            settings.insert(endpoint.to_string(), value);
        }
        settings
    }

    /// Notices the UI shows once it is ready.
    fn notify_after_start(&self) {
        let config = self.config();
        let weight = config.get_str("CTRANSLATE2_WEIGHT_TYPE");
        if !config.get_bool("CTRANSLATE2_LICENSE_NOTICE_SHOWN") && non_commercial(&weight) {
            let error = ErrorReply::new("WEIGHT_CTRANSLATE2_NON_COMMERCIAL_NOTICE", json!({ "weight_type": weight, "license": "CC-BY-NC-4.0" }));
            self.run(400, super::run_endpoint("ctranslate2_license_notice"), error.into_body());
            let _ = config.set("CTRANSLATE2_LICENSE_NOTICE_SHOWN", json!(true));
        }
        for key in config.invalid_saved_api_urls() {
            let (endpoint, code) = match key.as_str() {
                "LMSTUDIO_URL" => ("/set/data/lmstudio_url", "CONNECTION_LMSTUDIO_URL_INVALID"),
                "OPENAI_COMPATIBLE_URL" => ("/set/data/openai_compatible_url", "CONNECTION_OPENAI_COMPATIBLE_URL_INVALID"),
                _ => ("/set/data/custom_whisper_url", "CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID"),
            };
            self.notify_error(endpoint, ErrorReply::new(code, json!("")));
        }
        if let Some(backup) = config.unreadable_backup() {
            self.notify("config_file_unreadable", json!({ "backup": backup.to_string_lossy() }));
        }
        let failed = self.notifier();
        let recovered = self.notifier();
        config.set_save_callbacks(
            std::sync::Arc::new(move |reason, path| {
                failed("config_save_failed", json!({ "reason": reason, "path": path.to_string_lossy() }));
            }),
            std::sync::Arc::new(move || recovered("config_save_recovered", json!(true))),
        );
        self.step("End Initialization");
    }

    /// Work after the endpoints opened.
    pub fn after_init(&self) {}
}
