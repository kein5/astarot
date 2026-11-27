//! Bounded synthesis capabilities from speech.cpp's model information.

use serde::Serialize;
use serde_json::{Number, Value};

/// Optional generation controls. Sent only when set, and only after the
/// server's model information says it accepts them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SynthesisOptions {
    pub seed: Option<u64>,
    /// Blank means none.
    pub instructions: String,
}

/// The largest integer a JavaScript number holds exactly (2^53 - 1).
pub const SAFE_SEED_MAX: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SeedRange {
    pub minimum: u64,
    pub maximum: u64,
}

/// One voice the synthesis model speaks with, as speech.cpp lists it in `speech.voices`: its
/// name (what `voice` takes), and its language, gender and description, empty when not given.
/// A voice file the server was started with (`--add-voice`) is one of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Voice {
    pub name: String,
    pub language: String,
    pub gender: String,
    pub description: String,
}

/// What the one synthesis model on a server accepts besides text, and the voices it takes
/// (#1266: the voice is chosen from them). No voices: the server did not say.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModelOptions {
    pub model: String,
    pub seed: Option<SeedRange>,
    pub instructions: bool,
    pub voices: Vec<Voice>,
}

/// The most voices read from one model.
const MAX_VOICES: usize = 128;

/// A short text of a voice: a string of at most `limit` characters without control characters.
fn voice_text(value: Option<&Value>, limit: usize) -> Option<String> {
    let text = value?.as_str()?;
    (text.chars().count() <= limit && !text.chars().any(char::is_control)).then(|| text.to_owned())
}

/// The voices of a synthesis model: `speech.voices` when it lists them, else the names the
/// `voice` option allows (`choices`). A row that is not a voice is left out, and the list does
/// not fail the options: without it the voice is typed as before.
fn voices(speech: &serde_json::Map<String, Value>, options: &[Value]) -> Vec<Voice> {
    let named = |name: Option<String>| name.filter(|name| (1..=64).contains(&name.chars().count()));
    let mut result: Vec<Voice> = Vec::new();
    if let Some(rows) = speech.get("voices").and_then(Value::as_array) {
        for row in rows.iter().filter_map(Value::as_object) {
            let Some(name) = named(voice_text(row.get("name"), 64)) else { continue };
            let text = |key: &str| voice_text(row.get(key), 256).unwrap_or_default();
            result.push(Voice { name, language: text("language"), gender: text("gender"), description: text("description") });
        }
    } else if let Some(choices) = options.iter().filter_map(Value::as_object).find(|option| option.get("name").and_then(Value::as_str) == Some("voice"))
        .and_then(|option| option.get("choices")).and_then(Value::as_array)
    {
        for name in choices.iter().filter_map(|choice| named(voice_text(Some(choice), 64))) {
            result.push(Voice { name, language: String::new(), gender: String::new(), description: String::new() });
        }
    }
    let mut seen = std::collections::HashSet::new();
    result.retain(|voice| seen.insert(voice.name.clone()));
    result.truncate(MAX_VOICES);
    result
}

/// The integer value of a JSON number written as an integer, saturated to i128.
/// Floats (`1.0`, `1e2`) are not integers, as in Python's `json`.
fn integer(number: &Number) -> Option<i128> {
    let literal = number.to_string();
    let digits = literal.strip_prefix('-').unwrap_or(&literal);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(literal.parse::<i128>().unwrap_or(if literal.starts_with('-') { i128::MIN } else { i128::MAX }))
}

/// An option's bound: the default when absent, otherwise it must be an integer.
fn bound(option: &serde_json::Map<String, Value>, key: &str, default: i128) -> Result<i128, &'static str> {
    match option.get(key) {
        None => Ok(default),
        Some(Value::Number(number)) => integer(number).ok_or("invalid_seed_range"),
        Some(_) => Err("invalid_seed_range"),
    }
}

/// Read `/v1/models`. Exactly one synthesis model must be listed.
pub fn parse_options(document: &Value) -> Result<ModelOptions, &'static str> {
    let rows = document.as_object().and_then(|d| d.get("data")).and_then(Value::as_array).ok_or("invalid_catalog")?;
    if rows.len() > 32 {
        return Err("invalid_catalog");
    }
    let mut models = Vec::new();
    for row in rows {
        let row = row.as_object().ok_or("invalid_model")?;
        let speech = row.get("speech").and_then(Value::as_object).ok_or("invalid_model")?;
        if speech.get("task").and_then(Value::as_str) != Some("synthesis") {
            continue;
        }
        let id = row.get("id").and_then(Value::as_str).filter(|id| (1..=512).contains(&id.chars().count()));
        let options = speech.get("options").and_then(Value::as_array).filter(|options| options.len() <= 128);
        let (Some(id), Some(options)) = (id, options) else {
            return Err("invalid_options");
        };
        let mut result = ModelOptions { model: id.to_owned(), seed: None, instructions: false, voices: voices(speech, options) };
        let mut seen = std::collections::HashSet::new();
        for option in options {
            let option = option.as_object().ok_or("invalid_option")?;
            let name = option.get("name").and_then(Value::as_str).ok_or("invalid_option")?;
            if !seen.insert(name) {
                return Err("duplicate_option");
            }
            let kind = option.get("type").and_then(Value::as_str);
            if name == "seed" && kind == Some("int") {
                let low = bound(option, "minimum", 0)?;
                let high = bound(option, "maximum", SAFE_SEED_MAX as i128)?;
                if low > high {
                    return Err("invalid_seed_range");
                }
                let (low, high) = (low.max(0), high.min(SAFE_SEED_MAX as i128));
                if low <= high {
                    result.seed = Some(SeedRange { minimum: low as u64, maximum: high as u64 });
                }
            }
            if name == "instructions" && kind == Some("string") {
                result.instructions = true;
            }
        }
        models.push(result);
    }
    if models.len() != 1 {
        return Err("synthesis_model_ambiguous");
    }
    Ok(models.remove(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn card(options: Value) -> Value {
        json!({"data": [{"id": "tts-test", "speech": {"task": "synthesis", "options": options}}]})
    }

    #[test]
    fn reads_seed_and_instruction_support() {
        let options = parse_options(&card(json!([
            {"name": "seed", "type": "int", "minimum": 0, "maximum": 9007199254740991u64},
            {"name": "instructions", "type": "string"}
        ])))
        .unwrap();
        assert_eq!(options.model, "tts-test");
        assert_eq!(options.seed, Some(SeedRange { minimum: 0, maximum: SAFE_SEED_MAX }));
        assert!(options.instructions);
        let none = parse_options(&card(json!([]))).unwrap();
        assert_eq!((none.seed, none.instructions), (None, false));
    }

    #[test]
    fn seed_bounds_default_clamp_and_must_be_integers() {
        let default = parse_options(&card(json!([{"name": "seed", "type": "int"}]))).unwrap();
        assert_eq!(default.seed, Some(SeedRange { minimum: 0, maximum: SAFE_SEED_MAX }));
        let doc: Value =
            serde_json::from_str(r#"{"data":[{"id":"m","speech":{"task":"synthesis","options":[{"name":"seed","type":"int","minimum":-5,"maximum":100000000000000000000000}]}}]}"#).unwrap();
        assert_eq!(parse_options(&doc).unwrap().seed, Some(SeedRange { minimum: 0, maximum: SAFE_SEED_MAX }));
        let negative = parse_options(&card(json!([{"name": "seed", "type": "int", "minimum": -9, "maximum": -1}]))).unwrap();
        assert_eq!(negative.seed, None);
        for bad in [json!(1.0), json!(true), json!(null), json!("1")] {
            assert_eq!(parse_options(&card(json!([{"name": "seed", "type": "int", "minimum": bad}]))), Err("invalid_seed_range"));
        }
        assert_eq!(parse_options(&card(json!([{"name": "seed", "type": "int", "minimum": 5, "maximum": 4}]))), Err("invalid_seed_range"));
        // A seed of another type is not a seed option.
        assert_eq!(parse_options(&card(json!([{"name": "seed", "type": "string"}]))).unwrap().seed, None);
    }

    #[test]
    fn reads_the_voices_the_model_lists_or_its_voice_choices() {
        // As speech.cpp 0.9.0 lists Qwen3-TTS CustomVoice's (one shortened).
        let listed = json!({"data": [{"id": "qwen", "speech": {"task": "synthesis",
            "voices": [{"name": "ono_anna", "language": "ja", "gender": "female", "description": "Playful Japanese female voice."},
                {"name": "ryan", "language": "en", "gender": "male", "description": "Dynamic male voice with rhythm."}],
            "options": [{"name": "voice", "type": "string", "required": true, "choices": ["ono_anna", "ryan"]}]}}]});
        let options = parse_options(&listed).unwrap();
        assert_eq!(options.voices.iter().map(|voice| (voice.name.as_str(), voice.language.as_str())).collect::<Vec<_>>(), [("ono_anna", "ja"), ("ryan", "en")]);
        assert_eq!(options.voices[0].description, "Playful Japanese female voice.");
        // Irodori lists its one voice; a voice file added at start is listed as well.
        let irodori = json!({"data": [{"id": "irodori", "speech": {"task": "synthesis",
            "voices": [{"name": "none", "language": "", "gender": "", "description": "speaks without a reference recording"}, {"name": "custom"}],
            "options": []}}]});
        assert_eq!(parse_options(&irodori).unwrap().voices.iter().map(|voice| voice.name.as_str()).collect::<Vec<_>>(), ["none", "custom"]);
        // No list: the names the voice option allows.
        let choices = card(json!([{"name": "voice", "type": "string", "choices": ["a", "b", "a"]}]));
        assert_eq!(parse_options(&choices).unwrap().voices.iter().map(|voice| voice.name.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        // Neither: no voices, and the other options are read as before.
        let none = parse_options(&card(json!([{"name": "instructions", "type": "string"}]))).unwrap();
        assert_eq!((none.voices.len(), none.instructions), (0, true));
    }

    #[test]
    fn a_row_that_is_not_a_voice_is_left_out_and_the_list_is_bounded() {
        let rows = json!([{"name": ""}, {"name": "x".repeat(65)}, {"name": "bad\nname"}, {"name": 1}, 2, {"name": "ok", "language": 3, "description": "d".repeat(257)},
            {"name": "ok"}]);
        let document = json!({"data": [{"id": "m", "speech": {"task": "synthesis", "voices": rows, "options": []}}]});
        let options = parse_options(&document).unwrap();
        assert_eq!(options.voices, [Voice { name: "ok".into(), language: String::new(), gender: String::new(), description: String::new() }]);
        let many: Vec<Value> = (0..200).map(|i| json!({"name": format!("v{i}")})).collect();
        let document = json!({"data": [{"id": "m", "speech": {"task": "synthesis", "voices": many, "options": []}}]});
        assert_eq!(parse_options(&document).unwrap().voices.len(), MAX_VOICES);
    }

    #[test]
    fn rejects_malformed_or_ambiguous_catalogs() {
        let synthesis = json!({"id": "a", "speech": {"task": "synthesis", "options": []}});
        let recognition = json!({"id": "b", "speech": {"task": "recognition"}});
        assert_eq!(parse_options(&json!({"data": [synthesis, recognition]})).unwrap().model, "a");
        for (document, code) in [
            (json!([]), "invalid_catalog"),
            (json!({"data": {}}), "invalid_catalog"),
            (json!({"data": vec![recognition.clone(); 33]}), "invalid_catalog"),
            (json!({"data": []}), "synthesis_model_ambiguous"),
            (json!({"data": [synthesis.clone(), synthesis.clone()]}), "synthesis_model_ambiguous"),
            (json!({"data": [1]}), "invalid_model"),
            (json!({"data": [{"id": "x"}]}), "invalid_model"),
            (card(Value::Null), "invalid_options"),
            (json!({"data": [{"id": "", "speech": {"task": "synthesis", "options": []}}]}), "invalid_options"),
            (json!({"data": [{"id": "x".repeat(513), "speech": {"task": "synthesis", "options": []}}]}), "invalid_options"),
            (card(json!(vec![json!({"name": "x"}); 129])), "invalid_options"),
            (card(json!([1])), "invalid_option"),
            (card(json!([{"name": 1}])), "invalid_option"),
            (card(json!([{"name": "x"}, {"name": "x"}])), "duplicate_option"),
        ] {
            assert_eq!(parse_options(&document), Err(code), "{document}");
        }
    }
}
