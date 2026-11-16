//! The endpoints and the work between them (`src-python/controller.py`).
//!
//! [`Core`] holds what the endpoints share: the settings, the way to notify the UI, the log and
//! the services that reach outside the process. Each submodule adds the endpoints of one area;
//! [`routes`] adds them in the order of Python's `mapping`.

mod downloads;
pub mod adapters;
mod credentials;
mod files;
mod ocr;
mod overlay;
mod languages;
pub mod legacy_weights;
mod lifecycle;
mod routes;
mod settings;
pub mod speech;
mod telemetry;
pub mod updates;

pub use adapters::Osc;
pub use routes::routes;

/// Launches the bundled speech.cpp servers from `folder` (a development checkout's bundle).
pub fn speech_launch_from(folder: std::path::PathBuf) -> vrct_speech_server::server::Launch {
    vrct_speech_server::server::Launch::bundled(folder)
}

use crate::config::Config;
use crate::dispatch::Output;
use crate::errors::ErrorReply;
use crate::log::Log;
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The notifications, by the names the backend uses (`run_mapping` in `mainloop.py`).
pub const RUN_MAPPING: &[(&str, &str)] = &[
    ("enable_translation", "/run/enable_translation"),
    ("enable_transcription_send", "/run/enable_transcription_send"),
    ("enable_transcription_receive", "/run/enable_transcription_receive"),
    ("disable_transcription_send", "/set/disable/transcription_send"),
    ("disable_transcription_receive", "/set/disable/transcription_receive"),
    ("disable_check_mic_threshold", "/set/disable/check_mic_threshold"),
    ("disable_check_speaker_threshold", "/set/disable/check_speaker_threshold"),
    ("connected_network", "/run/connected_network"),
    ("enable_ai_models", "/run/enable_ai_models"),
    ("update_software", "/run/update_software"),
    ("update_cuda_software", "/run/update_cuda_software"),
    ("transcription_mic", "/run/transcription_send_mic_message"),
    ("transcription_speaker", "/run/transcription_receive_speaker_message"),
    ("transcription_ocr", "/run/transcription_ocr_message"),
    ("enable_ocr_capture", "/run/enable_ocr_capture"),
    ("check_mic_volume", "/run/check_mic_volume"),
    ("check_speaker_volume", "/run/check_speaker_volume"),
    ("audio_device_switched", "/run/audio_device_switched"),
    ("error_device", "/run/error_device"),
    ("error_translation_engine", "/run/error_translation_engine"),
    ("message_output_error", "/run/message_output_error"),
    ("error_translation_enable_vram_overflow", "/run/error_translation_enable_vram_overflow"),
    ("error_translation_chat_vram_overflow", "/run/error_translation_chat_vram_overflow"),
    ("error_translation_mic_vram_overflow", "/run/error_translation_mic_vram_overflow"),
    ("error_translation_speaker_vram_overflow", "/run/error_translation_speaker_vram_overflow"),
    ("word_filter", "/run/word_filter"),
    ("transcription_recognition_error", "/run/transcription_recognition_error"),
    ("download_progress_ctranslate2_weight", "/run/download_progress_ctranslate2_weight"),
    ("downloaded_ctranslate2_weight", "/run/downloaded_ctranslate2_weight"),
    ("error_ctranslate2_weight", "/run/error_ctranslate2_weight"),
    ("ctranslate2_license_notice", "/run/ctranslate2_license_notice"),
    ("translation_language_unsupported", "/run/translation_language_unsupported"),
    ("selected_mic_host", "/run/selected_mic_host"),
    ("selected_mic_device_id", "/run/selected_mic_device_id"),
    ("selectable_mic_device_options", "/run/selectable_mic_device_options"),
    ("selected_mic_device", "/run/selected_mic_device"),
    ("selected_speaker_device_id", "/run/selected_speaker_device_id"),
    ("selectable_speaker_device_options", "/run/selectable_speaker_device_options"),
    ("selected_speaker_device", "/run/selected_speaker_device"),
    ("selected_translation_engines", "/run/selected_translation_engines"),
    ("translation_engines", "/run/translation_engines"),
    ("selected_your_languages", "/run/selected_your_languages"),
    ("selected_target_languages", "/run/selected_target_languages"),
    ("selectable_language_list", "/run/selectable_language_list"),
    ("selected_translation_compute_type", "/run/selected_translation_compute_type"),
    ("selectable_plamo_model_list", "/run/selectable_plamo_model_list"),
    ("selected_plamo_model", "/run/selected_plamo_model"),
    ("selectable_gemini_model_list", "/run/selectable_gemini_model_list"),
    ("selected_gemini_model", "/run/selected_gemini_model"),
    ("selectable_openai_model_list", "/run/selectable_openai_model_list"),
    ("selected_openai_model", "/run/selected_openai_model"),
    ("selectable_groq_model_list", "/run/selectable_groq_model_list"),
    ("selected_groq_model", "/run/selected_groq_model"),
    ("selectable_openrouter_model_list", "/run/selectable_openrouter_model_list"),
    ("selected_openrouter_model", "/run/selected_openrouter_model"),
    ("selectable_lmstudio_model_list", "/run/selectable_lmstudio_model_list"),
    ("selected_lmstudio_model", "/run/selected_lmstudio_model"),
    ("selectable_openai_compatible_model_list", "/run/selectable_openai_compatible_model_list"),
    ("selected_openai_compatible_model", "/run/selected_openai_compatible_model"),
    ("selectable_ollama_model_list", "/run/selectable_ollama_model_list"),
    ("selected_ollama_model", "/run/selected_ollama_model"),
    ("selectable_groq_whisper_model_list", "/run/selectable_groq_whisper_model_list"),
    ("selected_groq_whisper_model", "/run/selected_groq_whisper_model"),
    ("selectable_openai_whisper_model_list", "/run/selectable_openai_whisper_model_list"),
    ("selected_openai_whisper_model", "/run/selected_openai_whisper_model"),
    ("selectable_custom_whisper_model_list", "/run/selectable_custom_whisper_model_list"),
    ("selected_custom_whisper_model", "/run/selected_custom_whisper_model"),
    ("selectable_deepgram_model_list", "/run/selectable_deepgram_model_list"),
    ("selected_deepgram_model", "/run/selected_deepgram_model"),
    ("overlay_small_log_settings", "/run/overlay_small_log_settings"),
    ("vr_panel_pointer", "/run/vr_panel_pointer"),
    ("vr_panel_log_out_of_view", "/run/vr_panel_log_out_of_view"),
    ("overlay_vr_launcher_hand", "/run/overlay_vr_launcher_hand"),
    ("vr_panel_launcher_intro", "/run/vr_panel_launcher_intro"),
    ("overlay_vr_panel_anchor", "/run/overlay_vr_panel_anchor"),
    ("vr_panel_layout", "/run/vr_panel_layout"),
    ("overlay_large_log_settings", "/run/overlay_large_log_settings"),
    ("selectable_mic_host_list", "/run/selectable_mic_host_list"),
    ("selectable_mic_device_list", "/run/selectable_mic_device_list"),
    ("selectable_speaker_device_list", "/run/selectable_speaker_device_list"),
    ("software_update_info", "/run/software_update_info"),
    ("initialization_progress", "/run/initialization_progress"),
    ("initialization_complete", "/run/initialization_complete"),
    ("config_file_unreadable", "/run/config_file_unreadable"),
    ("config_save_failed", "/run/config_save_failed"),
    ("config_save_recovered", "/run/config_save_recovered"),
    ("enable_osc_query", "/run/enable_osc_query"),
];

pub fn run_endpoint(name: &str) -> &'static str {
    RUN_MAPPING.iter().find(|(n, _)| *n == name).map(|(_, e)| *e).unwrap_or_else(|| panic!("{name} is not in run_mapping"))
}

/// What reaches outside the process, replaceable in tests.
#[derive(Clone)]
pub struct Services {
    /// Whether the local translation model of a weight is present and complete.
    pub translation_weight_available: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    /// How the speech.cpp servers are launched: the app's checked bundle, or a stand-in in tests.
    pub speech_server_launch: Arc<dyn Fn(&crate::config::Environment) -> vrct_speech_server::server::Launch + Send + Sync>,
    /// The model download manager of a root: the reviewed catalog over the public transport.
    /// Tests give a catalog and a transport of their own.
    pub model_downloads: downloads::DownloadsSource,
    /// Where the checked speech.cpp of the bundle is (`bundled_binary()`), for the hardware
    /// probe of the downloads and for the hardware in the usage events.
    pub speech_binary: downloads::SpeechBinary,
    /// Whether nothing runs on a download's target ("japanese", "multilingual", "asr": the
    /// speech server profile is stopped or failed; "rvc": the voice conversion is not
    /// requested, pending or stopping). An apply is refused with `model_target_busy` otherwise.
    /// The default says idle: neither runs in the core yet.
    pub model_target_idle: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    /// The usage-event sender, to VRCT-VOX's own receiver by default.
    pub telemetry: Arc<dyn Fn() -> vrct_ops::telemetry::Telemetry + Send + Sync>,
    /// `VRCT_TELEMETRY=off` by default.
    pub telemetry_forced_off: Arc<dyn Fn() -> bool + Send + Sync>,
    /// Opens the OSC link to VRChat for an address and a port ([`adapters::open_osc`]).
    pub osc: adapters::OpenOsc,
    /// Hears whether VRChat's mute holds the microphone back (mic mute sync). The microphone's
    /// recognition follows it once it runs in the core. Called under the mic lock: it must not
    /// block or call back into the core.
    pub vrc_mic_mute: Arc<dyn Fn(bool) + Send + Sync>,
    /// Turns the microphone's recognition off when mute sync is lost (`setDisableTranscriptionSend`).
    pub stop_mic_transcription: Arc<dyn Fn() + Send + Sync>,
    /// Remove the Python backend's CTranslate2 weights after start-up ([`legacy_weights`]).
    /// Only the host running the core as the default backend sets it: while the Python sidecar
    /// is the default, its local translation keeps its weights.
    pub retire_legacy_translation_weights: bool,
    /// The app's own updater behind the old update endpoints ([`updates`]). Switched off by
    /// default, as Python shipped it; the app updates through the host's updater.
    pub software_updates: Arc<dyn updates::SoftwareUpdates>,
}

impl Default for Services {
    fn default() -> Self {
        Self {
            translation_weight_available: Arc::new(|_| false),
            speech_server_launch: Arc::new(speech::bundled_launch),
            model_downloads: Arc::new(downloads::default_downloads),
            speech_binary: Arc::new(downloads::default_speech_binary),
            model_target_idle: Arc::new(|_| true),
            telemetry: Arc::new(vrct_ops::telemetry::Telemetry::default),
            telemetry_forced_off: Arc::new(telemetry::forced_off_from_environment),
            osc: Arc::new(adapters::open_osc),
            vrc_mic_mute: Arc::new(|_| {}),
            stop_mic_transcription: Arc::new(|| {}),
            retire_legacy_translation_weights: false,
            software_updates: Arc::new(updates::Disabled),
        }
    }
}

/// What the endpoints share.
pub struct Core {
    config: Arc<Config>,
    log: Arc<Log>,
    output: Arc<dyn Output>,
    services: Services,
    watchdog: Mutex<Option<vrct_ops::watchdog::Watchdog>>,
    shutdown_requested: AtomicBool,
    shut_down: Mutex<bool>,
    /// The language and engine settings change together under this lock.
    pub(crate) language_lock: Mutex<()>,
    /// A key, its URL and its models change together under this lock (`config.credential_lock`).
    pub(crate) credential_lock: Mutex<()>,
    /// The VR windows' saved positions change under this lock (`_VR_WINDOW_SETTINGS_LOCK`).
    pub(crate) vr_window_lock: Mutex<()>,
    translation_available: Mutex<Option<bool>>,
    speech: speech::SpeechServers,
    /// The model downloads and the usage events, made on first use.
    ops: std::sync::OnceLock<downloads::Ops>,
    adapters: std::sync::OnceLock<Arc<adapters::Adapters>>,
}

impl Core {
    pub fn new(config: Arc<Config>, log: Arc<Log>, output: Arc<dyn Output>, services: Services) -> Arc<Self> {
        let speech = speech::SpeechServers::new((services.speech_server_launch)(config.environment()));
        Arc::new(Self {
            config,
            log,
            output,
            services,
            watchdog: Mutex::new(None),
            shutdown_requested: AtomicBool::new(false),
            shut_down: Mutex::new(false),
            language_lock: Mutex::new(()),
            credential_lock: Mutex::new(()),
            vr_window_lock: Mutex::new(()),
            translation_available: Mutex::new(None),
            speech,
            ops: std::sync::OnceLock::new(),
            adapters: std::sync::OnceLock::new(),
        })
    }

    pub fn config(&self) -> &Arc<Config> {
        &self.config
    }

    pub fn log(&self) -> &Arc<Log> {
        &self.log
    }

    pub fn services(&self) -> &Services {
        &self.services
    }

    /// A notification (`controller.run`).
    pub fn run(&self, status: u16, endpoint: &str, result: Value) {
        self.output.answer(status, Some(endpoint), &result);
    }

    /// A notification by its `run_mapping` name.
    pub fn notify(&self, name: &str, result: Value) {
        self.run(200, run_endpoint(name), result);
    }

    /// A notifier that outlives a borrow of the core (for callbacks of the settings).
    pub(crate) fn notifier(&self) -> impl Fn(&str, Value) + Send + Sync + 'static {
        let output = Arc::clone(&self.output);
        move |name, value| output.answer(200, Some(run_endpoint(name)), &value)
    }

    /// An error notification on an endpoint.
    pub fn notify_error(&self, endpoint: &str, error: ErrorReply) {
        self.run(400, endpoint, error.into_body());
    }

    pub fn step(&self, text: &str) {
        self.log.step(text, None);
    }

    /// Stamps a request before it waits in the queue (generations of the voice features).
    pub fn stamp(&self, _endpoint: &str, _data: &mut Value) {}

    pub fn start_watchdog(&self, timeout: Duration, interval: Duration, on_timeout: Arc<dyn Fn() + Send + Sync>) {
        let watchdog = vrct_ops::watchdog::Watchdog::new(timeout, interval);
        watchdog.set_callback(move || on_timeout());
        watchdog.start_in_thread();
        *self.watchdog.lock().unwrap() = Some(watchdog);
    }

    pub fn feed_watchdog(&self) {
        if let Some(watchdog) = self.watchdog.lock().unwrap().as_ref() {
            watchdog.feed();
        }
    }

    pub fn shutdown_requested(&self) -> bool {
        self.shutdown_requested.load(Ordering::SeqCst)
    }

    /// Stops what runs and saves the settings (`Controller.shutdown`). Runs once.
    pub fn shutdown(&self) {
        self.shutdown_requested.store(true, Ordering::SeqCst);
        let mut done = self.shut_down.lock().unwrap();
        if *done {
            return;
        }
        *done = true;
        self.step("Shutdown");
        self.close_speech_servers();
        self.close_model_downloads();
        self.stop_adapters();
        self.config.save_now();
        self.stop_telemetry();
    }

    /// The end of the run: the watchdog and the settings saver stop.
    pub fn close(&self) {
        if let Some(watchdog) = self.watchdog.lock().unwrap().as_ref() {
            watchdog.stop(Some(Duration::from_secs(1)));
        }
        self.config.close();
    }

    pub(crate) fn set_translation_available(&self, available: bool) {
        *self.translation_available.lock().unwrap() = Some(available);
    }

    /// Whether the selected local translation model was present at start-up.
    pub fn translation_available(&self) -> Option<bool> {
        *self.translation_available.lock().unwrap()
    }
}

/// Python's `int(value)`: an integer, a finite float cut toward zero, `True` and `False`, or a
/// string of a whole number. `None` where Python raises.
pub fn python_int(value: &Value) -> Option<i64> {
    match value {
        Value::Bool(b) => Some(i64::from(*b)),
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.is_finite() && f.abs() < 9.2e18).map(|f| f.trunc() as i64)),
        Value::String(s) => {
            let text = s.trim().replace('_', "");
            if s.trim().starts_with('_') || s.trim().ends_with('_') || s.contains("__") {
                return None;
            }
            text.parse::<i64>().ok()
        }
        _ => None,
    }
}

/// Python's `float(value)` for the values the UI sends.
pub fn python_float(value: &Value) -> Option<f64> {
    match value {
        Value::Bool(b) => Some(f64::from(u8::from(*b))),
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

/// Python's `round(value, digits)` for a finite float: the nearest decimal of the exact binary
/// value, as Python rounds it (not `(value * 10^digits).round()`, which differs at some ties).
pub fn python_round(value: f64, digits: usize) -> f64 {
    format!("{value:.digits$}").parse().unwrap_or(value)
}

/// `{"status": 200, "result": value}`.
pub fn ok(value: impl Into<Value>) -> Reply {
    Reply::ok(value)
}

/// A 400 answer with a code and the value to roll back to.
pub fn error(code: &'static str, data: Value) -> Reply {
    Reply::error(ErrorReply::new(code, data))
}

pub fn ok_true() -> Reply {
    ok(json!(true))
}
