//! The saved forms of the realtime recognition settings and the direct voice (conversion)
//! settings ([`models/transcription/realtime_settings.py`], [`asr_vocabulary.py`] and
//! [`models/voice_conversion/settings.py`]). Each `normalize_*` returns the canonical saved value,
//! or an error code for a value that is refused as a whole.
//!
//! [`models/transcription/realtime_settings.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/realtime_settings.py
//! [`asr_vocabulary.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/asr_vocabulary.py
//! [`models/voice_conversion/settings.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/voice_conversion/settings.py

use serde_json::{Map, Value, json};

pub const MAX_USER_TERMS: usize = 100;
pub const MAX_TERMS: usize = 150;
/// The most built-in terms the user can take out (#792): more than the built-in list holds.
pub const MAX_REMOVED: usize = 150;
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

/// A built-in term's written form the user took out (#792), as `parse_term` keeps a written form:
/// trimmed, its spaces made single, at most 48 characters, without `,` or `=`.
fn parse_written(value: &Value) -> Result<String, &'static str> {
    const INVALID: &str = "realtime_vocabulary_invalid";
    let text = value.as_str().ok_or(INVALID)?;
    if text.chars().any(|c| (c as u32) < 32 || c as u32 == 127) {
        return Err(INVALID);
    }
    let written = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let length = char_len(&written);
    if length == 0 || length > MAX_WRITTEN || written.contains(',') || written.contains('=') {
        return Err(INVALID);
    }
    Ok(written)
}

/// `str.casefold` for the comparisons of written forms.
fn fold(text: &str) -> String {
    text.chars().flat_map(char::to_lowercase).collect::<String>().replace('ß', "ss")
}

/// `normalize_vocabulary`. `removed` lists the built-in terms the user took out, by their written
/// forms (#792). It is left out of the saved value while it is empty, so a version without it
/// still reads the settings as long as no built-in term is taken out.
pub fn normalize_vocabulary(value: Option<&Value>) -> Result<Value, &'static str> {
    const INVALID: &str = "realtime_vocabulary_invalid";
    let default = json!({ "builtin": true, "terms": [] });
    let value = match value {
        None | Some(Value::Null) => &default,
        Some(value) => value,
    };
    let object = value.as_object().ok_or(INVALID)?;
    if object.keys().any(|k| k != "builtin" && k != "terms" && k != "removed") {
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
    let removed = match object.get("removed") {
        None | Some(Value::Null) => &empty,
        Some(Value::Array(removed)) => removed,
        Some(_) => return Err(INVALID),
    };
    if removed.len() > MAX_REMOVED {
        return Err(INVALID);
    }
    let mut taken_out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for written in removed {
        let written = parse_written(written)?;
        if seen.insert(fold(&written)) {
            taken_out.push(Value::String(written));
        }
    }
    let mut saved = json!({ "builtin": builtin, "terms": result });
    if !taken_out.is_empty() {
        saved["removed"] = Value::Array(taken_out);
    }
    Ok(saved)
}

/// The head of a dictionary file the user writes out (#792). The lines after it are the form the
/// settings page reads back: one term a line, as the built-in terms' data file has them. Lines
/// starting with `#` are notes.
const VOCABULARY_FILE_HEAD: &str = "\
# ASTAROT term dictionary / 用語辞書
# The terms in use, one a line: written=reading,reading. Reading this file in makes the dictionary these terms.
# 使っている用語を1行に1語、「表記=読み,読み」で書いています。読み込むと、辞書がこのファイルの用語に置き換わります。
";

/// `vocabulary_file`: the dictionary in use as a file (#792): every term recognition uses, in the
/// order it uses them (`merged_terms`): the user's terms, a built-in term's changed readings among
/// them, then the built-in terms left as they ship. A built-in term taken out is not in use and
/// not written. From a value already normalized (`normalize_vocabulary`).
pub fn vocabulary_file(vocabulary: &Value) -> String {
    let mut text = VOCABULARY_FILE_HEAD.to_string();
    for term in vrct_transcription::speechcpp::merged_terms(vocabulary) {
        text.push_str(&term);
        text.push('\n');
    }
    text
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

/// The silences that may end an utterance in realtime recognition, in milliseconds.
pub const SILENCE_DURATION_MS: std::ops::RangeInclusive<u64> = 100..=2000;

/// `realtime_settings.normalize_settings`, with `silence_duration_ms` of the core's own (#556).
pub fn normalize_realtime(value: &Value) -> Result<Value, &'static str> {
    const INVALID: &str = "realtime_settings_invalid";
    let object = value.as_object().ok_or(INVALID)?;
    const KEYS: [&str; 9] = ["version", "server", "start_server", "base_url", "model", "mic", "speaker", "vocabulary", "silence_duration_ms"];
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
    // The silence that ends an utterance (#556): absent or null follows the default
    // (`vrct_transcription`'s `DEFAULT_SILENCE_MS`, 400 ms), so changing the default moves
    // only the settings that never chose one.
    match object.get("silence_duration_ms") {
        None | Some(Value::Null) => {}
        Some(value) => {
            let ms = value.as_u64().filter(|ms| SILENCE_DURATION_MS.contains(ms)).ok_or("realtime_silence_invalid")?;
            result.insert("silence_duration_ms".into(), ms.into());
        }
    }
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

/// The fields 0.5 added to the direct voice settings (the RVC worker's options).
const ADDED_IN_0_5: [&str; 3] = ["rvc_device", "rvc_threads", "rvc_highpass"];

/// The direct voice settings as `config.json` holds them: the fields 0.5 added are left out
/// while they hold their defaults, which a load fills in again. 0.4 refuses the whole value when
/// it finds a field it does not know, and would reset the model and index too; so a file saved
/// without those choices changed stays readable by 0.4. A changed choice is saved, and 0.4 then
/// still resets the value.
pub fn file_direct(value: &Value) -> Value {
    let defaults = default_direct();
    let mut value = value.clone();
    if let Value::Object(object) = &mut value {
        for field in ADDED_IN_0_5 {
            if object.get(field) == defaults.get(field) {
                object.remove(field);
            }
        }
    }
    value
}

/// The fields 0.6 added to the speech settings: how VOICEVOX, AivisSpeech and SHAREVOX read
/// (the Scale fields of their AudioQuery, #392).
const VOICE_ADDED_IN_0_6: [&str; 12] = [
    "voicevox_speed", "voicevox_volume", "voicevox_pitch", "voicevox_intonation",
    "aivis_speed", "aivis_volume", "aivis_pitch", "aivis_intonation",
    "sharevox_speed", "sharevox_volume", "sharevox_pitch", "sharevox_intonation",
];

/// The speech settings as `config.json` holds them: the fields 0.6 added are left out while they
/// hold their defaults, which a load fills in again. 0.5 refuses the whole value when it finds a
/// field it does not know and would reset every speech setting; so a file saved without those
/// values changed stays readable by 0.5. A changed value is saved, and 0.5 then still resets.
pub fn file_voice(value: &Value) -> Value {
    let defaults = vrct_tts::settings::VoiceSettings::default().to_value();
    let mut value = value.clone();
    if let Value::Object(object) = &mut value {
        for field in VOICE_ADDED_IN_0_6 {
            if object.get(field) == defaults.get(field) {
                object.remove(field);
            }
        }
    }
    value
}

/// The saved direct voice settings as they load: a Seed-VC engine saved by an earlier version
/// moves to RVC. The other fields stay, as 0.4 knew both engines ([`file_direct`]).
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

    // #792: the built-in terms live in a data file (vrct-transcription's data/vrchat_terms.txt).
    // Each line keeps the rules of a user's term and is already in its canonical form, and no
    // written form is there twice: an edit of the file that breaks them fails here. How many
    // there are is not held to a number: a longer list only loses its last terms to the cap of
    // the merge when the user has many of their own.
    #[test]
    fn the_built_in_terms_keep_the_rules_of_a_term() {
        let terms = vrct_transcription::speechcpp::vrchat_terms();
        assert!(!terms.is_empty());
        let mut seen = std::collections::HashSet::new();
        for term in terms {
            assert_eq!(parse_term(&json!(term)).as_deref(), Ok(term.as_str()), "{term} is a canonical term");
            assert!(seen.insert(fold(written_form(term))), "{term} is there once");
        }
    }

    // #792: the built-in terms the user took out are kept by their written forms, made canonical
    // and told apart without regard to letter case. Nothing taken out leaves the member out, so a
    // version without it reads the settings as before.
    #[test]
    fn the_built_in_terms_taken_out_are_kept_and_left_out_when_there_are_none() {
        let saved = normalize_vocabulary(Some(&json!({ "terms": [], "removed": ["  Friends+ ", "friends+", "Known   User"] }))).unwrap();
        assert_eq!(saved, json!({ "builtin": true, "terms": [], "removed": ["Friends+", "Known User"] }));
        assert_eq!(normalize_vocabulary(Some(&json!({ "terms": [], "removed": [] }))).unwrap(), json!({ "builtin": true, "terms": [] }));
        assert_eq!(normalize_vocabulary(Some(&json!({ "terms": [], "removed": null }))).unwrap(), json!({ "builtin": true, "terms": [] }));
        for refused in [json!("Quest"), json!([3]), json!(["a=b"]), json!(["a,b"]), json!([""]), json!(["x".repeat(49)]),
            json!(vec!["x"; MAX_REMOVED + 1])] {
            assert_eq!(normalize_vocabulary(Some(&json!({ "terms": [], "removed": refused }))), Err("realtime_vocabulary_invalid"), "{refused}");
        }
        let many: Vec<String> = (0..MAX_REMOVED).map(|i| format!("t{i}")).collect();
        assert_eq!(normalize_vocabulary(Some(&json!({ "removed": many }))).unwrap()["removed"].as_array().unwrap().len(), MAX_REMOVED);
    }

    // #792: the file the user writes out: the head, then the dictionary in use, as recognition
    // uses it. A built-in term taken out is not written.
    #[test]
    fn a_dictionary_file_holds_every_term_in_use() {
        use vrct_transcription::speechcpp::{merged_terms, vrchat_terms};
        let vocabulary = normalize_vocabulary(Some(&json!({ "terms": ["猫丸 = ねこまる", "Quest=くえすと"], "removed": ["Vket"] }))).unwrap();
        let text = vocabulary_file(&vocabulary);
        assert!(text.starts_with("# ASTAROT term dictionary"));
        let lines: Vec<&str> = text.lines().filter(|line| !line.starts_with('#')).collect();
        assert_eq!(lines, merged_terms(&vocabulary));
        assert_eq!(lines[..2], ["猫丸=ねこまる", "Quest=くえすと"], "the user's terms first");
        let shipped = |written: &str| vrchat_terms().iter().find(|term| term.split('=').next() == Some(written)).unwrap().as_str();
        assert!(lines.contains(&shipped("VRChat")), "a built-in term as it ships");
        assert!(!lines.contains(&shipped("Quest")), "a built-in term with changed readings is written once, changed");
        assert!(!lines.iter().any(|line| line.starts_with("Vket")), "a built-in term taken out is not in use");
        assert!(!lines.iter().any(|line| line.starts_with('-')));
        // Without the built-in terms, only the user's.
        let own = normalize_vocabulary(Some(&json!({ "builtin": false, "terms": ["猫丸=ねこまる"] }))).unwrap();
        assert_eq!(vocabulary_file(&own).lines().filter(|line| !line.starts_with('#')).collect::<Vec<_>>(), ["猫丸=ねこまる"]);
        let none = normalize_vocabulary(Some(&json!({ "builtin": false, "terms": [] }))).unwrap();
        assert!(vocabulary_file(&none).lines().all(|line| line.starts_with('#')), "nothing but the head");
    }

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
    fn the_file_leaves_out_unchanged_rvc_worker_choices_so_0_4_still_reads_it() {
        // #428: 0.4 refuses DIRECT_VOICE_SETTINGS with a field it does not know, and the model
        // and index went back to the defaults after a downgrade.
        let settings = normalize_direct(&json!({ "mode": "converted", "rvc_model": "a.pth", "rvc_index": "a.index" })).unwrap();
        let file = file_direct(&settings);
        for field in ADDED_IN_0_5 {
            assert!(file.get(field).is_none(), "{field}");
        }
        let fields_0_4 = ["mode", "runtime", "reference", "engine", "rvc_runtime", "rvc_model", "rvc_index", "rvc_pitch", "rvc_index_rate"];
        assert!(file.as_object().unwrap().keys().all(|k| fields_0_4.contains(&k.as_str())), "{file}");
        assert_eq!(load_direct(&file).unwrap(), settings, "loads back the same");
        // A changed choice is kept.
        let chosen = normalize_direct(&json!({ "rvc_device": "cpu", "rvc_threads": 0, "rvc_highpass": true })).unwrap();
        assert_eq!(file_direct(&chosen)["rvc_device"], "cpu");
        assert_eq!(load_direct(&file_direct(&chosen)).unwrap(), chosen);
    }

    #[test]
    fn the_file_leaves_out_unchanged_engine_readings_so_0_5_still_reads_it() {
        // 0.5 refuses VOICE_SETTINGS with a field it does not know, like 0.4 did with the direct
        // voice settings (#428), and would reset every speech setting after a downgrade.
        use vrct_tts::settings::VoiceSettings;
        let settings = VoiceSettings::from_value(&json!({ "japanese_engine": "aivis", "engine_voice_id": "1", "coeiroink_speed": "1.5" })).unwrap().to_value();
        let file = file_voice(&settings);
        for field in VOICE_ADDED_IN_0_6 {
            assert!(settings.get(field).is_some(), "{field} is a speech setting");
            assert!(file.get(field).is_none(), "{field}");
        }
        assert_eq!(file["coeiroink_speed"], "1.5", "fields 0.5 knows stay");
        assert_eq!(VoiceSettings::from_value(&file).unwrap().to_value(), settings, "loads back the same");
        // A changed value is kept.
        let chosen = VoiceSettings::from_value(&json!({ "aivis_speed": "1.25", "voicevox_pitch": "0.0" })).unwrap().to_value();
        assert_eq!(file_voice(&chosen)["aivis_speed"], "1.25");
        assert!(file_voice(&chosen).get("voicevox_pitch").is_none());
        assert_eq!(VoiceSettings::from_value(&file_voice(&chosen)).unwrap().to_value(), chosen);
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
    fn the_silence_that_ends_an_utterance_is_left_out_unless_chosen() {
        // Left out, the file stays as 0.4 reads it and the default applies (#556). A chosen
        // value stays as chosen, the former default of 500 ms too.
        let defaults = normalize_realtime(&json!({})).unwrap();
        assert!(defaults.get("silence_duration_ms").is_none(), "{defaults}");
        assert!(normalize_realtime(&json!({ "silence_duration_ms": null })).unwrap().get("silence_duration_ms").is_none());
        for chosen in [300, 400, 500] {
            assert_eq!(normalize_realtime(&json!({ "silence_duration_ms": chosen })).unwrap()["silence_duration_ms"], chosen);
        }
        for bad in [json!(99), json!(2001), json!(300.5), json!("300"), json!(-1), json!(true)] {
            assert_eq!(normalize_realtime(&json!({ "silence_duration_ms": bad })), Err("realtime_silence_invalid"), "{bad}");
        }
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
