//! Names for the voices that speaker diarization tells apart (#447).
//!
//! The speech server labels the voices of one realtime session "A", "B", ...; a label means
//! nothing outside that session, and the labels start again with the next one. The user may give
//! a label a name for its session: the UI keeps the names for the log and the desktop captions,
//! and the core hands them to the VR large log ([`Core::name_overlay_speakers`]). The names are
//! not saved, and `process.log` masks them (`speaker_names` in `log::SENSITIVE_ENDPOINT_MARKERS`).

use super::routes::{Builder, OPEN};
use super::{Core, ok};
use crate::protocol::Reply;
use serde_json::{Map, Value, json};

/// The most voices one request names (the server tells up to eight apart).
const MAX_LABELS: usize = 8;
/// The longest name, in characters.
pub const MAX_NAME: usize = 32;
const MAX_NAMESPACE: usize = 128;
const INVALID: &str = "speaker_names_invalid";

/// One to three capital letters, as the speech server labels a voice.
fn is_label(label: &str) -> bool {
    (1..=3).contains(&label.len()) && label.bytes().all(|b| b.is_ascii_uppercase())
}

/// `{"namespace": <session>, "names": {"A": "Mika", "B": ""}}`: the whole set of names of the
/// session. Spaces inside a name are made single and an empty name leaves its label unnamed.
fn request(data: &Value) -> Result<(String, Vec<(String, String)>), &'static str> {
    let object = data.as_object().filter(|o| o.len() == 2).ok_or(INVALID)?;
    let namespace = object
        .get("namespace")
        .and_then(Value::as_str)
        .filter(|n| !n.is_empty() && n.len() <= MAX_NAMESPACE && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
        .ok_or(INVALID)?;
    let names = object.get("names").and_then(Value::as_object).filter(|n| n.len() <= MAX_LABELS).ok_or(INVALID)?;
    let mut result = Vec::new();
    for (label, name) in names {
        let name = name.as_str().ok_or(INVALID)?;
        if !is_label(label) || name.chars().any(char::is_control) {
            return Err(INVALID);
        }
        let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
        if name.chars().count() > MAX_NAME {
            return Err(INVALID);
        }
        if !name.is_empty() {
            result.push((label.clone(), name));
        }
    }
    Ok((namespace.to_string(), result))
}

fn set_names(core: &Core, data: &Value) -> Reply {
    let (namespace, names) = match request(data) {
        Ok(request) => request,
        Err(code) => return Reply::status(400, json!({ "error_code": code })),
    };
    let answer: Map<String, Value> = names.iter().map(|(label, name)| (label.clone(), json!(name))).collect();
    core.name_overlay_speakers(&namespace, names);
    ok(json!({ "namespace": namespace, "names": answer }))
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/set/data/speaker_names", OPEN, |core, data| set_names(core, data));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_checked_and_tidied() {
        let (namespace, names) = request(&json!({ "namespace": "0a1b", "names": { "A": "  ミカ   さん ", "B": "" } })).unwrap();
        assert_eq!(namespace, "0a1b");
        assert_eq!(names, vec![("A".to_string(), "ミカ さん".to_string())]);
        for bad in [
            json!(null),
            json!({ "namespace": "0a1b" }),
            json!({ "namespace": "", "names": {} }),
            json!({ "namespace": "a/b", "names": {} }),
            json!({ "namespace": "0a1b", "names": { "a": "x" } }),
            json!({ "namespace": "0a1b", "names": { "ABCD": "x" } }),
            json!({ "namespace": "0a1b", "names": { "A": 1 } }),
            json!({ "namespace": "0a1b", "names": { "A": "a\nb" } }),
            json!({ "namespace": "0a1b", "names": { "A": "x".repeat(33) } }),
            json!({ "namespace": "0a1b", "names": {}, "extra": 1 }),
        ] {
            assert_eq!(request(&bad), Err(INVALID), "{bad}");
        }
        let nine: Map<String, Value> = (0..9).map(|i| (char::from(b'A' + i).to_string(), json!("x"))).collect();
        assert_eq!(request(&json!({ "namespace": "n", "names": nine })), Err(INVALID));
    }
}
