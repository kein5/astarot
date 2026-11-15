//! The error codes the backend answers with (`src-python/errors.py`).
//!
//! An expected failure answers with status 400 and a body built here:
//! `{"error_code", "message", "data", "details", "category", "severity"}`. `data` is the value
//! the UI rolls back to. The codes, their default English messages and their categories are a
//! contract with the UI (`src-ui/logics/_useBackendErrorHandling.js`) and with
//! `docs/spec/reference/error-codes.md`.

mod table;

use serde_json::{Map, Value, json};
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    Auth,
    Connection,
    Device,
    General,
    Model,
    ObsBrowserSource,
    Ocr,
    Transcription,
    Translation,
    Validation,
    Vrc,
    Websocket,
    Weight,
}

impl Category {
    pub fn as_str(self) -> &'static str {
        match self {
            Category::Auth => "auth",
            Category::Connection => "connection",
            Category::Device => "device",
            Category::General => "general",
            Category::Model => "model",
            Category::ObsBrowserSource => "obs_browser_source",
            Category::Ocr => "ocr",
            Category::Transcription => "transcription",
            Category::Translation => "translation",
            Category::Validation => "validation",
            Category::Vrc => "vrc",
            Category::Websocket => "websocket",
            Category::Weight => "weight",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Warning,
    Error,
    Critical,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Warning => "warning",
            Severity::Error => "error",
            Severity::Critical => "critical",
        }
    }
}

/// One error code and what the UI shows for it.
#[derive(Debug)]
pub struct CodeInfo {
    pub code: &'static str,
    pub category: Category,
    pub message: &'static str,
    pub severity: Severity,
    pub user_action_required: bool,
    /// False for a code that answers an expected state; it is not sent as a usage event.
    pub reported: bool,
}

/// Every code, in the order of `ERROR_METADATA` (the order of the specification's table).
pub fn codes() -> &'static [CodeInfo] {
    table::CODES
}

pub fn info(code: &str) -> Option<&'static CodeInfo> {
    table::CODES.iter().find(|info| info.code == code)
}

/// Where usage events learn of an error code (`register_error_report_hook`).
pub type ReportHook = Arc<dyn Fn(&str) + Send + Sync>;

static HOOKS: Mutex<Vec<ReportHook>> = Mutex::new(Vec::new());

pub fn register_report_hook(hook: ReportHook) {
    HOOKS.lock().unwrap().push(hook);
}

pub fn clear_report_hooks() {
    HOOKS.lock().unwrap().clear();
}

/// Tells the hooks, without answering the UI (`report_error_code`).
pub fn report(code: &str) {
    if code.is_empty() {
        return;
    }
    let hooks = HOOKS.lock().unwrap().clone();
    for hook in hooks {
        hook(code);
    }
}

/// A 400 answer: `VRCTError.create_error_response`.
#[derive(Clone, Debug, PartialEq)]
pub struct ErrorReply {
    pub code: &'static str,
    pub data: Value,
    pub details: Map<String, Value>,
    pub message: Option<String>,
}

impl ErrorReply {
    pub fn new(code: &'static str, data: Value) -> Self {
        Self { code, data, details: Map::new(), message: None }
    }

    pub fn details(mut self, details: Value) -> Self {
        if let Value::Object(map) = details {
            self.details = map;
        }
        self
    }

    pub fn message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    /// The body of the answer. An unknown code is described as `GENERAL_UNKNOWN`, as in Python.
    pub fn body(&self) -> Value {
        let info = info(self.code).or_else(|| info("GENERAL_UNKNOWN")).expect("GENERAL_UNKNOWN is listed");
        json!({
            "error_code": self.code,
            "message": self.message.clone().unwrap_or_else(|| info.message.to_string()),
            "data": self.data,
            "details": Value::Object(self.details.clone()),
            "category": info.category.as_str(),
            "severity": info.severity.as_str(),
        })
    }

    /// Builds the body and reports the code to the hooks, unless the code is an expected state.
    pub fn into_body(self) -> Value {
        let reported = info(self.code).is_none_or(|info| info.reported);
        if reported {
            report(self.code);
        }
        self.body()
    }
}

/// The failures a voice feature reports by a fixed lowercase code (`REPORTED_FAILURES`).
pub fn reported_failure_code(area: &str, code: &str) -> Option<&'static str> {
    let (codes, other): (&[&'static str], Option<&'static str>) = match area {
        "speech_server" => (
            &[
                "speech_server_out_of_memory", "speech_server_device_failed", "speech_server_vulkan_missing",
                "speech_server_start_timeout", "speech_server_exited", "speech_server_launch_failed",
                "speech_server_protocol", "speech_server_readiness", "speech_server_model_tasks",
                "speech_server_low_latency_requires_gpu_irodori", "speech_bundle_missing_or_invalid",
                "speech_server_cleanup_unconfirmed",
            ],
            Some("speech_server_failed_other"),
        ),
        "voice_conversion" => (
            &[
                "vc_capture_overrun", "vc_capture_invalid", "vc_capture_failed", "vc_worker_eof", "vc_worker_failed",
                "vc_gpu_unavailable", "vc_sink_changed", "vc_output_failed", "source_bridge_output_failed",
                "source_bridge_capture_failed",
            ],
            Some("voice_conversion_failed_other"),
        ),
        "realtime" => (
            &["realtime_session_failed", "realtime_capture_failed", "realtime_capture_stop_failed", "realtime_asr_timeout"],
            Some("realtime_failed_other"),
        ),
        "tts" => (
            &[
                "first_audio_timeout", "request_timeout", "transport_error", "audio_output_error", "output_missing",
                "output_disconnected", "output_stalled", "output_failed", "output_drain_timeout", "truncated_pcm",
                "truncated_http", "empty_pcm", "speech_server_not_ready",
            ],
            None,
        ),
        _ => return None,
    };
    codes.iter().find(|listed| **listed == code).copied().or(other)
}

pub fn report_failure(area: &str, code: &str) {
    if let Some(reported) = reported_failure_code(area, code) {
        report(reported);
    }
}
