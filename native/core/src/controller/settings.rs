//! Endpoints that read or write one setting, with the checks and error codes of their Python
//! handlers.

use super::{Core, error, ok, python_float, python_int};
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::sync::Arc;

/// `{"status": 200, "result": config.X}`.
pub fn get(core: &Arc<Core>, key: &'static str) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |_| ok(core.config().get(key))
}

/// `setEnableX` / `setDisableX` of a plain switch.
pub fn switch(core: &Arc<Core>, key: &'static str, on: bool) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |_| {
        if core.config().get_bool(key) != on {
            let _ = core.config().set(key, json!(on));
        }
        ok(core.config().get(key))
    }
}

/// The VAD switch of a source (`setEnableMicVadFilter`). Turning it on needs a VAD engine;
/// without one it answers `VAD_UNAVAILABLE` with the saved value, which stays as it was.
/// Turning it off always works.
pub fn vad_switch(core: &Arc<Core>, key: &'static str, on: bool) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |_| {
        if on && core.services().vad.is_none() {
            return error("VAD_UNAVAILABLE", core.config().get(key));
        }
        if core.config().get_bool(key) != on {
            let _ = core.config().set(key, json!(on));
        }
        ok(core.config().get(key))
    }
}

/// A value stored through its check; a refusal answers `code` with the current value
/// (`_configValidationErrorResponse`).
pub fn store(core: &Arc<Core>, key: &'static str, code: &'static str) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| match core.config().set(key, data.clone()) {
        Ok(value) => ok(value),
        Err(_) => error(code, core.config().get(key)),
    }
}

/// `str(data)` stored through its check (release channel, compute type).
pub fn store_text(core: &Arc<Core>, key: &'static str, code: &'static str) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| {
        let text = python_str(data);
        match core.config().set(key, json!(text)) {
            Ok(value) => ok(value),
            Err(_) => error(code, core.config().get(key)),
        }
    }
}

/// An integer through `int(data)`, a range test of the handler, and the setting's own check.
pub fn integer(
    core: &Arc<Core>,
    key: &'static str,
    code: &'static str,
    allowed: impl Fn(i64, &Core) -> bool + Send + Sync + 'static,
) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| {
        let stored = python_int(data).filter(|v| allowed(*v, &core)).and_then(|v| core.config().set(key, json!(v)).ok());
        match stored {
            Some(value) => ok(value),
            None => error(code, core.config().get(key)),
        }
    }
}

/// `setTransparency` and its kind: `int(data)` or a general error with a message.
pub fn integer_or_message(core: &Arc<Core>, key: &'static str, message: &'static str) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| match python_int(data) {
        Some(value) => match core.config().set(key, json!(value)) {
            Ok(value) => ok(value),
            Err(_) => Reply::status(500, "Internal error"),
        },
        None => Reply::error(crate::errors::ErrorReply::new("GENERAL_EXCEPTION", core.config().get(key)).message(message)),
    }
}

/// An ASR threshold: `float(data)`, never a boolean, then the setting's range.
pub fn threshold(core: &Arc<Core>, key: &'static str, message: &'static str) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| {
        let stored = (!data.is_boolean()).then(|| python_float(data)).flatten().and_then(|v| core.config().set(key, json!(v)).ok());
        match stored {
            Some(value) => ok(value),
            None => Reply::error(crate::errors::ErrorReply::new("VALIDATION_CONFIG_VALUE_INVALID", core.config().get(key)).message(message)),
        }
    }
}

/// A transcription API model: offered by the service, else `MODEL_TRANSCRIPTION_INVALID`.
pub fn transcription_model(core: &Arc<Core>, list: &'static str, key: &'static str) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| {
        let name = json!(python_str(data));
        let offered = core.config().get(list).as_array().is_some_and(|l| l.contains(&name));
        if offered && core.config().set(key, name).is_ok() {
            if key == "SELECTED_DEEPGRAM_MODEL" && core.config().get_str("SELECTED_TRANSCRIPTION_ENGINE") == "Deepgram" {
                core.fallback_unsupported_transcription_languages("Deepgram");
                core.notify("selectable_language_list", json!(core.language_and_country_list()));
            }
            return ok(core.config().get(key));
        }
        error("MODEL_TRANSCRIPTION_INVALID", core.config().get(key))
    }
}

/// Python's `str(value)` for the values the UI sends.
pub fn python_str(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => "None".into(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        other => other.to_string(),
    }
}

pub fn vr_panel_font_size(core: &Arc<Core>) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| {
        let valid = (data.is_i64() || data.is_u64()) && data.as_i64().is_some_and(|v| (14..=28).contains(&v));
        if !valid {
            return error("VALIDATION_CONFIG_VALUE_INVALID", core.config().get("OVERLAY_VR_PANEL_FONT_SIZE"));
        }
        let _ = core.config().set("OVERLAY_VR_PANEL_FONT_SIZE", data.clone());
        ok(core.config().get("OVERLAY_VR_PANEL_FONT_SIZE"))
    }
}

pub fn compute_device(core: &Arc<Core>) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| {
        // Python let a refused device raise: 500.
        if core.config().set("SELECTED_TRANSLATION_COMPUTE_DEVICE", data.clone()).is_err() {
            return Reply::status(500, "Internal error");
        }
        let _ = core.config().set("SELECTED_TRANSLATION_COMPUTE_TYPE", json!("auto"));
        core.notify("selected_translation_compute_type", core.config().get("SELECTED_TRANSLATION_COMPUTE_TYPE"));
        ok(core.config().get("SELECTED_TRANSLATION_COMPUTE_DEVICE"))
    }
}
