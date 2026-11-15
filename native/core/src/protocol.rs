//! The messages between the UI and the backend (`docs/spec/ipc-protocol.md`).
//!
//! A request is one line of JSON: `{"endpoint": "/set/data/osc_port", "data": "<base64>"}`, where
//! `data` is the value as `JSON.stringify` wrote it, in Base64. An answer or a notification is one
//! line too: `{"status": 200, "endpoint": "/set/data/osc_port", "result": 9001}`. The format is the
//! one the Python sidecar spoke over stdin and stdout; the UI keeps using it unchanged.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Map, Value, json};

/// One request read from the UI.
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    /// The endpoint as sent. A request without a string endpoint is answered with 404.
    pub endpoint: Option<String>,
    /// The decoded value, or `Value::Null` when the request carried none.
    pub data: Value,
    /// `Some("vr_panel")` when the main window relays a request of the VR panel.
    pub origin: Option<Value>,
}

/// What one line from the UI held.
#[derive(Clone, Debug, PartialEq)]
pub enum Incoming {
    /// A blank line, or a JSON value Python reads as false (`{}`, `[]`, `0`, `""`, `null`).
    Nothing,
    Request(Request),
    /// Not JSON, or JSON that is not an object. Logged and skipped.
    Malformed,
}

/// Reads one line the way `Main.receiver` did.
pub fn parse_line(line: &str) -> Incoming {
    let text = line.trim();
    if text.is_empty() {
        return Incoming::Nothing;
    }
    let value: Value = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(_) => return Incoming::Malformed,
    };
    if !truthy(&value) {
        return Incoming::Nothing;
    }
    let Value::Object(object) = value else {
        // `received_data.get` raises on a list or a number; the receiver logged it and went on.
        return Incoming::Malformed;
    };
    let endpoint = object.get("endpoint").and_then(Value::as_str).map(str::to_string);
    let data = match object.get("data") {
        None | Some(Value::Null) => Value::Null,
        Some(encoded) => decode_data(encoded),
    };
    let origin = object.get("origin").filter(|origin| !origin.is_null()).cloned();
    Incoming::Request(Request { endpoint, data, origin })
}

/// `encodeBase64`: Base64, then UTF-8, then JSON. Anything that fails gives an empty object.
pub fn decode_data(encoded: &Value) -> Value {
    let Some(text) = encoded.as_str() else {
        return Value::Object(Map::new());
    };
    let Ok(bytes) = STANDARD.decode(text.trim_end_matches(['\n', '\r'])) else {
        return Value::Object(Map::new());
    };
    let Ok(text) = String::from_utf8(bytes) else {
        return Value::Object(Map::new());
    };
    serde_json::from_str(&text).unwrap_or_else(|_| Value::Object(Map::new()))
}

/// Encodes a value the way the UI does (`encode(JSON.stringify(value))`), for tests and tools.
pub fn encode_data(value: &Value) -> String {
    STANDARD.encode(serde_json::to_string(value).expect("a JSON value serializes"))
}

/// One request line, as the UI writes it.
pub fn request_line(endpoint: &str, data: Option<&Value>) -> String {
    let mut object = Map::new();
    object.insert("endpoint".into(), Value::String(endpoint.to_string()));
    if let Some(data) = data {
        object.insert("data".into(), Value::String(encode_data(data)));
    }
    Value::Object(object).to_string()
}

/// One answer or notification line.
pub fn response_line(status: u16, endpoint: Option<&str>, result: &Value) -> String {
    json!({ "status": status, "endpoint": endpoint, "result": result }).to_string()
}

/// Python's truth value of a JSON value.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// What a handler answers: a status and a result (`{"status": ..., "result": ...}` in Python).
#[derive(Clone, Debug, PartialEq)]
pub struct Reply {
    pub status: u16,
    pub result: Value,
}

impl Reply {
    pub fn ok(result: impl Into<Value>) -> Self {
        Self { status: 200, result: result.into() }
    }

    pub fn status(status: u16, result: impl Into<Value>) -> Self {
        Self { status, result: result.into() }
    }

    /// A 400 answer with the error body.
    pub fn error(error: crate::errors::ErrorReply) -> Self {
        Self { status: 400, result: error.into_body() }
    }

    /// The answer of a voice endpoint that cannot act in the current state: 409 and a code.
    pub fn conflict(code: &str) -> Self {
        Self { status: 409, result: json!({ "error_code": code }) }
    }
}
