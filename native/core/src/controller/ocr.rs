//! The chat reading settings (`controller.py`: `setOcrWindowTitle`, `setOcrPollIntervalMs`,
//! `setOcrMinConfidence`, `setOcrBubbleMinTextLength`, `setOcrCaptureRegion`,
//! `setOcrVrCaptureRegion` and the chatbox filter and detector switches).
//!
//! Python stored each value and then handed it to the running capture
//! (`updateOCRCaptureSettings`), which did nothing while none ran. The capture itself is not
//! wired to the core yet (#281), so storing is all these endpoints do here; the capture reads
//! the stored values when it starts. Turning the capture on, its state, the readiness checks
//! and the source language (which loads the models) wait for it.

use super::routes::{Builder, OPEN, WAIT};
use super::settings::{python_str, store, switch};
use super::{Core, error, ok, python_round};
use crate::protocol::Reply;
use serde_json::{Map, Number, Value, json};
use std::sync::Arc;

/// Python's `round(value, 4)` for a float; other values are left as they are.
fn round4(value: &Value) -> Value {
    match value {
        Value::Number(n) if n.is_f64() => {
            n.as_f64().and_then(|f| Number::from_f64(python_round(f, 4))).map_or_else(|| value.clone(), Value::Number)
        }
        other => other.clone(),
    }
}

/// A capture region: its floats rounded so slider jitter does not reach `config.json`.
fn region(core: &Arc<Core>, key: &'static str) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| {
        let value = match data {
            Value::Object(map) => Value::Object(map.iter().map(|(k, v)| (k.clone(), round4(v))).collect::<Map<_, _>>()),
            other => other.clone(),
        };
        match core.config().set(key, value) {
            Ok(value) => ok(value),
            Err(_) => error("VALIDATION_CONFIG_VALUE_INVALID", core.config().get(key)),
        }
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    let core = b.core;
    b.with("/set/data/ocr_window_title", OPEN, |core, data| {
        let title = python_str(data).trim().to_string();
        match core.config().set("OCR_WINDOW_TITLE", json!(title)) {
            Ok(value) => ok(value),
            Err(_) => error("VALIDATION_CONFIG_VALUE_INVALID", core.config().get("OCR_WINDOW_TITLE")),
        }
    });
    for (endpoint, key) in [
        ("/set/data/ocr_poll_interval_ms", "OCR_POLL_INTERVAL_MS"),
        ("/set/data/ocr_min_confidence", "OCR_MIN_CONFIDENCE"),
        ("/set/data/ocr_bubble_min_text_length", "OCR_BUBBLE_MIN_TEXT_LENGTH"),
    ] {
        b.add(endpoint, OPEN, store(core, key, "VALIDATION_CONFIG_VALUE_INVALID"));
    }
    b.add("/set/data/ocr_capture_region", OPEN, region(core, "OCR_CAPTURE_REGION"));
    b.add("/set/data/ocr_vr_capture_region", OPEN, region(core, "OCR_VR_CAPTURE_REGION"));
    // Turning the capture off stops it when it runs; none runs in the core yet, so the switch
    // stays off (`setDisableOcrCapture`). Turning it on waits for the capture.
    b.with("/set/disable/ocr_capture", WAIT, |core, _| {
        let _ = core.config().set("ENABLE_OCR_CAPTURE", json!(false));
        ok(core.config().get("ENABLE_OCR_CAPTURE"))
    });
    for (name, key) in [("ocr_chatbox_filter", "OCR_CHATBOX_FILTER"), ("ocr_use_chatbox_detector", "OCR_USE_CHATBOX_DETECTOR")] {
        b.add(&format!("/set/enable/{name}"), OPEN, switch(core, key, true));
        b.add(&format!("/set/disable/{name}"), OPEN, switch(core, key, false));
    }
}

#[cfg(test)]
mod tests {
    use super::round4;
    use serde_json::json;

    #[test]
    fn floats_are_rounded_like_python() {
        assert_eq!(round4(&json!(0.123456789)), json!(0.1235));
        assert_eq!(round4(&json!(0.5)), json!(0.5));
        assert_eq!(round4(&json!(1)), json!(1));
        assert_eq!(round4(&json!("x")), json!("x"));
    }
}
