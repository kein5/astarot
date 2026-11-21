//! The language tables the settings are checked against.
//!
//! `data/translation_languages.json` is `languages.yml` of the translation engines (engine, then
//! `source` and `target` display names to codes; CTranslate2 has one table per model), and
//! `data/transcription_languages.json` is [`transcription_languages.py`] (language, then country,
//! then each recognition engine's code). Both are written by `reference/dump_reference.py`.
//!
//! The official APIs the core adds (#277) get their columns here, after `DeepL_API`, so that the
//! file stays Python's: `Google_Cloud_API` has the codes of the `Google` column (Cloud
//! Translation lists them all), `Papago_API` the languages of the `Papago` column that NAVER
//! Cloud Platform's Papago Translation has (not Hindi or Portuguese).
//!
//! [`transcription_languages.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/transcription_languages.py

use serde_json::{Map, Value};
use std::sync::OnceLock;

static TRANSLATION: OnceLock<Map<String, Value>> = OnceLock::new();
static TRANSCRIPTION: OnceLock<Map<String, Value>> = OnceLock::new();

fn parse(text: &str) -> Map<String, Value> {
    match serde_json::from_str(text).expect("the embedded language table is JSON") {
        Value::Object(map) => map,
        _ => panic!("the embedded language table is an object"),
    }
}

/// The languages of NAVER Cloud Platform's Papago Translation, by their codes.
const PAPAGO_CODES: [&str; 13] = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "fr", "es", "ru", "de", "it"];

/// Python's table with the columns of the official APIs after DeepL.
fn with_official_apis(python: Map<String, Value>) -> Map<String, Value> {
    let papago = |side: &str| -> Value {
        let names = python.get("Papago").and_then(|p| p[side].as_object()).cloned().unwrap_or_default();
        Value::Object(names.into_iter().filter(|(_, code)| code.as_str().is_some_and(|c| PAPAGO_CODES.contains(&c))).collect())
    };
    let google = python.get("Google").cloned().unwrap_or_else(|| Value::Object(Map::new()));
    let papago = serde_json::json!({ "source": papago("source"), "target": papago("target") });
    let mut table = Map::new();
    for (engine, column) in python.clone() {
        table.insert(engine.clone(), column);
        if engine == "DeepL_API" {
            table.insert("Google_Cloud_API".into(), google.clone());
            table.insert("Papago_API".into(), papago.clone());
        }
    }
    table
}

pub fn translation() -> &'static Map<String, Value> {
    TRANSLATION.get_or_init(|| with_official_apis(parse(include_str!("../data/translation_languages.json"))))
}

pub fn transcription() -> &'static Map<String, Value> {
    TRANSCRIPTION.get_or_init(|| parse(include_str!("../data/transcription_languages.json")))
}

/// Upstream VRCT's web translators. Their module is licensed for the official VRCT only, so no
/// VRCT-VOX build could ever run them; they are not offered (`languages.yml` keeps their columns).
pub const RETIRED_WEB_TRANSLATORS: [&str; 3] = ["Google", "Bing", "Papago"];

/// The translation engines, in the order of `languages.yml`, without the retired web translators.
pub fn translation_engines() -> Vec<String> {
    translation().keys().filter(|e| !RETIRED_WEB_TRANSLATORS.contains(&e.as_str())).cloned().collect()
}

/// The removed local Whisper engine; its column stays for the cloud Whisper engines.
pub const RETIRED_WHISPER_ENGINE: &str = "Whisper";
/// Python's Google web speech engine. It sent audio to an unofficial endpoint with the generic
/// key of `speech_recognition`, so it is not offered; its column stays for the regional codes
/// ([`transcription_languages.py`] keeps it) and a saved selection of it loads as none.
///
/// [`transcription_languages.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/transcription_languages.py
pub const RETIRED_GOOGLE_ENGINE: &str = "Google";
/// Recognition on this PC through speech.cpp.
pub const LOCAL_SPEECH_ENGINE: &str = "SpeechCpp";

/// The recognition engines: speech.cpp first, then the table's columns without the retired
/// Whisper and Google engines (Python listed Google first, and speech.cpp came after it).
pub fn transcription_engines() -> Vec<String> {
    let first = transcription()
        .values()
        .next()
        .and_then(Value::as_object)
        .and_then(|countries| countries.values().next())
        .and_then(Value::as_object);
    let Some(engines) = first else {
        return Vec::new();
    };
    let mut engines: Vec<String> = engines
        .keys()
        .filter(|e| *e != RETIRED_WHISPER_ENGINE && *e != RETIRED_GOOGLE_ENGINE)
        .cloned()
        .collect();
    engines.insert(0, LOCAL_SPEECH_ENGINE.to_string());
    engines
}

/// Whether the pair is in the recognition table.
pub fn known_language(language: &str, country: &str) -> bool {
    transcription().get(language).and_then(Value::as_object).is_some_and(|countries| countries.contains_key(country))
}

/// The local translation weights, by the names the settings keep (`ctranslate2_weights`).
pub const TRANSLATION_WEIGHTS: [&str; 5] = [
    "m2m100_418M-ct2-int8",
    "m2m100_1.2B-ct2-int8",
    "nllb-200-distilled-600M-ct2-int8",
    "nllb-200-distilled-1.3B-ct2-int8",
    "nllb-200-3.3B-ct2-int8",
];
pub const DEFAULT_TRANSLATION_WEIGHT: &str = "m2m100_418M-ct2-int8";

/// The languages OCR can read beyond "auto" (`ocr_languages.SELECTABLE_LANGUAGES`).
pub const OCR_SOURCE_LANGUAGES: [&str; 7] = ["auto", "Arabic", "Hindi", "Korean", "Russian", "Thai", "Ukrainian"];

#[cfg(test)]
mod official_api_tests {
    use super::*;

    #[test]
    fn the_official_apis_follow_deepl_with_their_languages() {
        let engines: Vec<&String> = translation().keys().collect();
        let deepl = engines.iter().position(|e| *e == "DeepL_API").unwrap();
        assert_eq!((engines[deepl + 1].as_str(), engines[deepl + 2].as_str()), ("Google_Cloud_API", "Papago_API"));
        assert_eq!(translation()["Google_Cloud_API"], translation()["Google"]);
        let papago = translation()["Papago_API"]["source"].as_object().unwrap();
        assert_eq!(papago.len(), 13);
        assert_eq!(papago["Chinese Simplified"], "zh-CN");
        assert!(!papago.contains_key("Hindi") && !papago.contains_key("Portuguese"));
    }

    #[test]
    fn the_retired_recognition_engines_are_not_offered() {
        let engines = transcription_engines();
        assert_eq!(engines.first().map(String::as_str), Some(LOCAL_SPEECH_ENGINE));
        assert!(!engines.iter().any(|e| e == RETIRED_GOOGLE_ENGINE || e == RETIRED_WHISPER_ENGINE), "{engines:?}");
        // The column stays: it gives the regional codes.
        assert_eq!(transcription()["Japanese"]["Japan"][RETIRED_GOOGLE_ENGINE], "ja-JP");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_translation_engines_are_offered_in_the_table_s_order_without_the_web_translators() {
        assert_eq!(
            translation_engines(),
            [
                "DeepL_API", "Google_Cloud_API", "Papago_API", "CTranslate2", "Plamo_API", "Gemini_API", "OpenAI_API",
                "LMStudio", "OpenAI_Compatible", "Ollama", "Groq_API", "OpenRouter_API",
            ]
        );
    }

    #[test]
    fn a_recognition_language_is_known_only_with_one_of_its_own_countries() {
        assert!(known_language("Japanese", "Japan"));
        assert!(known_language("English", "United States"));
        assert!(!known_language("Japanese", "United States"));
        assert!(!known_language("Japan", "Japanese"));
        assert!(!known_language("", ""));
    }
}
