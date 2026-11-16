//! The saved forms of the realtime recognition settings and the direct voice (conversion)
//! settings (`models/transcription/realtime_settings.py`, `asr_vocabulary.py` and
//! `models/voice_conversion/settings.py`). Each `normalize_*` returns the canonical saved value,
//! or an error code for a value that is refused as a whole.

use serde_json::{Map, Value, json};

pub const MAX_USER_TERMS: usize = 100;
pub const MAX_TERMS: usize = 150;
const MAX_WRITTEN: usize = 48;
const MAX_READING: usize = 32;
const MAX_READINGS: usize = 8;

fn char_len(text: &str) -> usize {
    text.chars().count()
}

/// A canonical `written=reading,reading` term (`parse_term`).
pub fn parse_term(value: &Value) -> Result<String, &'static str> {
    const INVALID: &str = "realtime_vocabulary_term_invalid";
    let text = value.as_str().ok_or(INVALID)?;
    if text.chars().any(|c| (c as u32) < 32 || c as u32 == 127) {
        return Err(INVALID);
    }
    let trimmed = text.trim();
    let (written, readings) = trimmed.split_once('=').unwrap_or((trimmed, ""));
    let written = written.split_whitespace().collect::<Vec<_>>().join(" ");
    let readings: Vec<String> =
        if readings.trim().is_empty() { Vec::new() } else { readings.split(',').map(|r| r.trim().to_string()).collect() };
    let written_len = char_len(&written);
    if written_len == 0 || written_len > MAX_WRITTEN || written.contains(',') || readings.len() > MAX_READINGS
        || readings.iter().any(|r| r.is_empty() || char_len(r) > MAX_READING || r.contains('='))
    {
        return Err(INVALID);
    }
    Ok(if readings.is_empty() { written } else { format!("{written}={}", readings.join(",")) })
}

fn written_form(term: &str) -> &str {
    term.split_once('=').map_or(term, |(w, _)| w)
}

/// `str.casefold` for the comparisons of written forms.
fn fold(text: &str) -> String {
    text.chars().flat_map(char::to_lowercase).collect::<String>().replace('ß', "ss")
}

/// `normalize_vocabulary`.
pub fn normalize_vocabulary(value: Option<&Value>) -> Result<Value, &'static str> {
    const INVALID: &str = "realtime_vocabulary_invalid";
    let default = json!({ "builtin": true, "terms": [] });
    let value = match value {
        None | Some(Value::Null) => &default,
        Some(value) => value,
    };
    let object = value.as_object().ok_or(INVALID)?;
    if object.keys().any(|k| k != "builtin" && k != "terms") {
        return Err(INVALID);
    }
    let builtin = match object.get("builtin") {
        None => true,
        Some(Value::Bool(b)) => *b,
        Some(_) => return Err(INVALID),
    };
    let empty = Vec::new();
    let terms = match object.get("terms") {
        None => &empty,
        Some(Value::Array(terms)) => terms,
        Some(_) => return Err(INVALID),
    };
    if terms.len() > MAX_USER_TERMS {
        return Err(INVALID);
    }
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for term in terms {
        let term = parse_term(term)?;
        if seen.insert(fold(written_form(&term))) {
            result.push(Value::String(term));
        }
    }
    Ok(json!({ "builtin": builtin, "terms": result }))
}

const EXCLUDED: [&str; 3] = ["vrct.managed.", "vrct.source-bridge.", "vrct.asr.capture."];

fn decimal(text: &Value, bits: u32) -> Result<String, &'static str> {
    const INVALID: &str = "realtime_endpoint_invalid";
    let text = text.as_str().ok_or(INVALID)?;
    if text.is_empty() || text.len() > 20 || !text.bytes().all(|b| b.is_ascii_digit()) || (text.len() > 1 && text.starts_with('0')) {
        return Err(INVALID);
    }
    let number: u128 = text.parse().map_err(|_| INVALID)?;
    if number >= 1u128 << bits {
        return Err(INVALID);
    }
    Ok(number.to_string())
}

/// `parse_endpoint` and `endpoint_dict`: a PipeWire endpoint the recognizer may listen to.
pub fn normalize_endpoint(value: &Value, source: &str) -> Result<Value, &'static str> {
    let object = value.as_object().ok_or("realtime_endpoint_invalid")?;
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    if keys != ["cookie", "media_class", "name", "serial"] {
        return Err("realtime_endpoint_invalid");
    }
    let cookie = decimal(&object["cookie"], 32)?;
    let serial = decimal(&object["serial"], 64)?;
    const ENDPOINT: &str = "asr_capture_endpoint_invalid";
    let name = object["name"].as_str().ok_or(ENDPOINT)?;
    let media_class = object["media_class"].as_str().ok_or(ENDPOINT)?;
    let expected = if source == "mic" { "Audio/Source" } else { "Audio/Sink" };
    if name.is_empty() || name.contains('\0') || name.len() > 512 || EXCLUDED.iter().any(|p| name.starts_with(p)) || media_class != expected {
        return Err(ENDPOINT);
    }
    Ok(json!({ "cookie": cookie, "serial": serial, "name": name, "media_class": media_class }))
}

fn model(value: Option<&Value>) -> Result<String, &'static str> {
    const INVALID: &str = "realtime_model_invalid";
    let text = match value {
        None => "",
        Some(Value::String(text)) => text,
        Some(_) => return Err(INVALID),
    };
    if char_len(text) > 200 || text.chars().any(|c| (c as u32) < 32) {
        return Err(INVALID);
    }
    Ok(text.to_string())
}

fn language(value: &Value) -> Result<String, &'static str> {
    const INVALID: &str = "realtime_language_invalid";
    let text = value.as_str().ok_or(INVALID)?;
    if text == "auto" {
        return Ok(text.into());
    }
    let (primary, rest) = text.split_once('-').map_or((text, None), |(p, r)| (p, Some(r)));
    let primary_ok = (2..=3).contains(&primary.len()) && primary.bytes().all(|b| b.is_ascii_lowercase());
    let rest_ok = rest.is_none_or(|r| (2..=8).contains(&r.len()) && r.bytes().all(|b| b.is_ascii_alphanumeric()));
    if primary_ok && rest_ok { Ok(text.into()) } else { Err(INVALID) }
}

/// `realtime_settings.normalize_settings`.
pub fn normalize_realtime(value: &Value) -> Result<Value, &'static str> {
    const INVALID: &str = "realtime_settings_invalid";
    let object = value.as_object().ok_or(INVALID)?;
    const KEYS: [&str; 8] = ["version", "server", "start_server", "base_url", "model", "mic", "speaker", "vocabulary"];
    if object.keys().any(|k| !KEYS.contains(&k.as_str())) {
        return Err(INVALID);
    }
    if let Some(version) = object.get("version") {
        if !(version.is_u64() && version.as_u64() == Some(1)) {
            return Err("realtime_settings_version");
        }
    }
    let server = match object.get("server") {
        None => "external",
        Some(Value::String(s)) if s == "external" || s == "bundled" => s,
        Some(_) => return Err("realtime_server_invalid"),
    };
    let start_server = match object.get("start_server") {
        None => true,
        Some(Value::Bool(b)) => *b,
        Some(_) => return Err(INVALID),
    };
    let base_url = match object.get("base_url") {
        None => "http://127.0.0.1:8080",
        Some(Value::String(s)) => s,
        Some(_) => return Err("Use http://127.0.0.1:PORT (local server only)"),
    };
    let base_url = vrct_tts::settings::local_url(base_url).map_err(|e| e.0)?;
    let mut result = Map::new();
    result.insert("version".into(), 1.into());
    result.insert("server".into(), server.into());
    result.insert("start_server".into(), start_server.into());
    result.insert("base_url".into(), base_url.into());
    result.insert("model".into(), model(object.get("model"))?.into());
    result.insert("vocabulary".into(), normalize_vocabulary(object.get("vocabulary"))?);
    for (source, default_language) in [("mic", "ja"), ("speaker", "auto")] {
        let empty = Map::new();
        let row = match object.get(source) {
            None => &empty,
            Some(Value::Object(row)) => row,
            Some(_) => return Err("realtime_source_settings_invalid"),
        };
        if row.keys().any(|k| !matches!(k.as_str(), "language" | "endpoint" | "follow_default")) {
            return Err("realtime_source_settings_invalid");
        }
        let follow = match row.get("follow_default") {
            None => true,
            Some(Value::Bool(b)) => *b,
            Some(_) => return Err("realtime_source_settings_invalid"),
        };
        let language = language(row.get("language").unwrap_or(&Value::String(default_language.into())))?;
        let endpoint = match row.get("endpoint") {
            None | Some(Value::Null) => Value::Null,
            Some(endpoint) => normalize_endpoint(endpoint, source)?,
        };
        result.insert(source.into(), json!({ "language": language, "endpoint": endpoint, "follow_default": follow }));
    }
    Ok(Value::Object(result))
}

/// The engine Python ran and the core cannot: Seed-VC ended with the Python backend (decision 10).
pub const RETIRED_ENGINE: &str = "seed-vc";

/// The defaults of the direct voice settings, in the saved order. Python's default engine was
/// Seed-VC; RVC is the only one left (#391). `rvc_device`, `rvc_threads` (0: the worker chooses)
/// and `rvc_highpass` are the RVC worker's `--device`, `--threads` and `--highpass`; a file saved
/// before them takes these defaults, which are the worker's own.
pub fn default_direct() -> Value {
    json!({
        "mode": "passthrough", "runtime": "", "reference": "", "engine": "rvc", "rvc_runtime": "",
        "rvc_model": "", "rvc_index": "", "rvc_pitch": 0, "rvc_index_rate": 0.0,
        "rvc_device": "auto", "rvc_threads": 0, "rvc_highpass": true,
    })
}

/// The saved direct voice settings as they load: a Seed-VC engine saved by an earlier version
/// moves to RVC. The other fields stay, so the file stays readable by 0.4, which knew both.
pub fn load_direct(value: &Value) -> Option<Value> {
    let mut value = value.clone();
    if value.get("engine").and_then(Value::as_str) == Some(RETIRED_ENGINE) {
        value["engine"] = json!("rvc");
    }
    normalize_direct(&value)
}

/// `DirectSettings.from_dict(...).to_dict()`, with RVC as the only engine.
pub fn normalize_direct(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    let Value::Object(mut result) = default_direct() else { unreachable!() };
    if object.keys().any(|k| !result.contains_key(k)) {
        return None;
    }
    for (key, item) in object {
        result.insert(key.clone(), item.clone());
    }
    let text_ok = |key: &str| {
        result[key].as_str().is_some_and(|s| s.chars().count() <= 4096 && !s.chars().any(|c| (c as u32) < 32))
    };
    let mode_ok = matches!(result["mode"].as_str(), Some("passthrough" | "converted"));
    let engine_ok = result["engine"].as_str() == Some("rvc");
    let texts_ok = ["runtime", "reference", "rvc_runtime", "rvc_model", "rvc_index"].iter().all(|k| text_ok(k));
    let pitch_ok = result["rvc_pitch"].as_i64().is_some_and(|p| result["rvc_pitch"].is_i64() && (-24..=24).contains(&p));
    let rate = &result["rvc_index_rate"];
    let rate_ok = rate.is_number() && rate.as_f64().is_some_and(|r| r.is_finite() && (0.0..=1.0).contains(&r));
    use vrct_voice_conversion::worker::{DEVICES, MAX_THREADS};
    let device_ok = result["rvc_device"].as_str().is_some_and(|d| DEVICES.contains(&d));
    let threads = &result["rvc_threads"];
    let threads_ok = threads.is_u64() && threads.as_u64().is_some_and(|n| n <= u64::from(MAX_THREADS));
    let highpass_ok = result["rvc_highpass"].is_boolean();
    (mode_ok && engine_ok && texts_ok && pitch_ok && rate_ok && device_ok && threads_ok && highpass_ok).then_some(Value::Object(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terms_are_canonical() {
        assert_eq!(parse_term(&json!("  Avatar   Name = あ , い ")).unwrap(), "Avatar Name=あ,い");
        assert!(parse_term(&json!("a,b")).is_err());
        assert!(parse_term(&json!("x=")).is_ok());
        let vocabulary = normalize_vocabulary(Some(&json!({ "terms": ["VRChat", "vrchat=ぶい"] }))).unwrap();
        assert_eq!(vocabulary, json!({ "builtin": true, "terms": ["VRChat"] }));
    }

    #[test]
    fn rvc_worker_choices_default_to_the_workers_own_and_are_checked() {
        let older = normalize_direct(&json!({ "mode": "converted", "engine": "rvc", "rvc_pitch": 3 })).unwrap();
        assert_eq!((&older["rvc_device"], &older["rvc_threads"], &older["rvc_highpass"]), (&json!("auto"), &json!(0), &json!(true)));
        let chosen = normalize_direct(&json!({ "rvc_device": "cpu", "rvc_threads": 4, "rvc_highpass": false })).unwrap();
        assert_eq!((&chosen["rvc_device"], &chosen["rvc_threads"], &chosen["rvc_highpass"]), (&json!("cpu"), &json!(4), &json!(false)));
        for bad in [
            json!({ "rvc_device": "gpu" }), json!({ "rvc_device": 1 }), json!({ "rvc_threads": -1 }), json!({ "rvc_threads": 65 }),
            json!({ "rvc_threads": 2.0 }), json!({ "rvc_threads": "2" }), json!({ "rvc_highpass": "on" }),
        ] {
            assert!(normalize_direct(&bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn a_saved_seed_vc_engine_loads_as_rvc_and_a_new_one_is_refused() {
        let saved = json!({ "mode": "converted", "engine": "seed-vc", "runtime": "/seed", "rvc_model": "a.pth" });
        let loaded = load_direct(&saved).unwrap();
        assert_eq!((loaded["mode"].clone(), loaded["engine"].clone(), loaded["runtime"].clone()), (json!("converted"), json!("rvc"), json!("/seed")));
        assert_eq!(normalize_direct(&saved), None);
        assert_eq!(default_direct()["engine"], "rvc");
    }

    #[test]
    fn endpoints_keep_exact_integers() {
        let endpoint = json!({ "cookie": "42", "serial": "18446744073709551615", "name": "alsa", "media_class": "Audio/Source" });
        assert!(normalize_endpoint(&endpoint, "mic").is_ok());
        assert!(normalize_endpoint(&endpoint, "speaker").is_err());
        let too_big = json!({ "cookie": "4294967296", "serial": "1", "name": "a", "media_class": "Audio/Source" });
        assert!(normalize_endpoint(&too_big, "mic").is_err());
    }
}
