//! The language tables the settings are checked against.
//!
//! `data/translation_languages.json` is `languages.yml` of the translation engines (engine, then
//! `source` and `target` display names to codes; CTranslate2 has one table per model), and
//! `data/transcription_languages.json` is `transcription_languages.py` (language, then country,
//! then each recognition engine's code). Both were written by `reference/dump_reference.py`.
//! The columns `Google_Cloud_API` and `Papago_API` (the official APIs, #277) were added in the
//! core afterwards: the first has the codes of the `Google` column, the second the languages of
//! the `Papago` column that NAVER Cloud Platform's Papago Translation has (no Hindi and no
//! Portuguese). A new dump must keep them.

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

pub fn translation() -> &'static Map<String, Value> {
    TRANSLATION.get_or_init(|| parse(include_str!("../data/translation_languages.json")))
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
/// Recognition on this PC through speech.cpp.
pub const LOCAL_SPEECH_ENGINE: &str = "SpeechCpp";

/// The recognition engines: the table's columns without Whisper, and speech.cpp after Google.
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
    let mut engines: Vec<String> = engines.keys().filter(|e| *e != RETIRED_WHISPER_ENGINE).cloned().collect();
    let at = engines.iter().position(|e| e == "Google").map_or(0, |i| i + 1);
    engines.insert(at, LOCAL_SPEECH_ENGINE.to_string());
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
