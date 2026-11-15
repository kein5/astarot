//! The error codes the core answers with are those of the specification
//! (`docs/spec/reference/error-codes.md`), with the same category, default message, severity
//! and need for the user to act. The UI branches on these codes.

use vrct_core::errors::{self, ErrorReply};

struct Row {
    code: String,
    category: String,
    message: String,
    severity: String,
    action: bool,
}

fn spec_rows() -> Vec<Row> {
    let text = include_str!("../../../docs/spec/reference/error-codes.md");
    text.lines()
        .filter(|line| line.starts_with("| `"))
        .map(|line| {
            let cells: Vec<&str> = line.trim_matches('|').split(" | ").map(str::trim).collect();
            Row {
                code: cells[0].trim_matches('`').to_string(),
                category: cells[1].to_string(),
                message: cells[2].replace("\\|", "|"),
                severity: cells[3].to_string(),
                action: cells[4] == "要",
            }
        })
        .collect()
}

#[test]
fn every_code_matches_the_specification() {
    let rows = spec_rows();
    let codes = errors::codes();
    assert_eq!(rows.len(), codes.len(), "the specification and the core list different numbers of codes");
    for (row, info) in rows.iter().zip(codes) {
        assert_eq!(row.code, info.code, "codes are listed in the same order");
        assert_eq!(row.category, info.category.as_str(), "{}", info.code);
        assert_eq!(row.message, info.message, "{}", info.code);
        assert_eq!(row.severity, info.severity.as_str(), "{}", info.code);
        assert_eq!(row.action, info.user_action_required, "{}", info.code);
    }
}

#[test]
fn the_error_body_has_the_documented_shape() {
    let body = ErrorReply::new("VALIDATION_OSC_PORT_INVALID", serde_json::json!(9000)).body();
    assert_eq!(
        body,
        serde_json::json!({
            "error_code": "VALIDATION_OSC_PORT_INVALID",
            "message": "OSC port must be a number",
            "data": 9000,
            "details": {},
            "category": "validation",
            "severity": "warning",
        })
    );
    let keys: Vec<&String> = body.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["error_code", "message", "data", "details", "category", "severity"], "the key order of Python's body");
}

#[test]
fn an_unknown_code_is_described_as_general_unknown() {
    let body = ErrorReply::new("NOT_A_CODE", serde_json::Value::Null).body();
    assert_eq!(body["error_code"], "NOT_A_CODE");
    assert_eq!(body["message"], "Unknown error");
    assert_eq!(body["category"], "general");
}

#[test]
fn an_expected_state_is_not_reported_as_a_usage_event() {
    use std::sync::{Arc, Mutex};
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = Arc::clone(&seen);
    errors::register_report_hook(Arc::new(move |code| sink.lock().unwrap().push(code.to_string())));
    let _ = ErrorReply::new("TRANSLATION_MODEL_MISSING", serde_json::Value::Null).into_body();
    let _ = ErrorReply::new("AUTH_DEEPL_FAILED", serde_json::Value::Null).into_body();
    errors::clear_report_hooks();
    let seen = seen.lock().unwrap();
    assert!(seen.contains(&"AUTH_DEEPL_FAILED".to_string()));
    assert!(!seen.contains(&"TRANSLATION_MODEL_MISSING".to_string()));
}

#[test]
fn voice_failures_are_reported_only_by_listed_codes() {
    assert_eq!(errors::reported_failure_code("speech_server", "speech_server_exited"), Some("speech_server_exited"));
    assert_eq!(errors::reported_failure_code("speech_server", "free text"), Some("speech_server_failed_other"));
    assert_eq!(errors::reported_failure_code("tts", "free text"), None);
    assert_eq!(errors::reported_failure_code("unknown_area", "x"), None);
}
