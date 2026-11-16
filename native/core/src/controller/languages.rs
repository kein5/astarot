//! Languages, tabs and the translation and recognition engines (the language parts of
//! `controller.py` and `model.py`).
//!
//! An engine is offered for a tab only when it is available and supports every enabled
//! language of the tab. When a language changes to one the selected engine cannot take, the
//! engine falls back to the local translation (CTranslate2, now ONNX); when an engine changes to
//! one that cannot take a selected language, the language is reset and the UI told why.

use super::{Core, ok};
use crate::errors::ErrorReply;
use crate::languages::{self, transcription};
use crate::protocol::Reply;
use serde_json::{Map, Value, json};
use std::collections::HashSet;

pub const LOCAL_ENGINE: &str = "CTranslate2";

fn enabled(entries: &Value) -> Vec<String> {
    entries
        .as_object()
        .map(|o| o.values().filter(|e| e["enable"] == true).filter_map(|e| e["language"].as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

fn base_code(code: &str) -> String {
    code.split(['-', '_']).next().unwrap_or(code).to_lowercase()
}

/// `resolveDeepgramLanguageCode`: the code a Deepgram model lists for the language, if any.
pub fn deepgram_code(language: &str, country: &str, model_languages: &[String]) -> Option<String> {
    let entry = transcription().get(language)?.get(country)?;
    let mut normalized: Vec<(String, String)> = Vec::new();
    for code in model_languages.iter().filter(|c| !c.is_empty()) {
        if !normalized.iter().any(|(n, _)| *n == code.to_lowercase()) {
            normalized.push((code.to_lowercase(), code.clone()));
        }
    }
    if normalized.is_empty() || normalized.iter().any(|(n, _)| n == "multi") {
        return None;
    }
    if let Some(google) = entry.get("Google").and_then(Value::as_str) {
        if let Some((_, original)) = normalized.iter().find(|(n, _)| *n == google.to_lowercase()) {
            return Some(original.clone());
        }
    }
    let whisper = base_code(entry.get("Whisper").and_then(Value::as_str)?);
    normalized.iter().find(|(n, _)| base_code(n) == whisper).map(|(_, o)| o.clone())
}

impl Core {
    /// The languages an engine takes as a source (`getTranslationLanguagesForEngine`).
    pub fn translation_languages(&self, engine: &str) -> Vec<String> {
        let table = languages::translation();
        let source = if engine == LOCAL_ENGINE {
            let weight = self.config().get_str("CTRANSLATE2_WEIGHT_TYPE");
            table.get(engine).and_then(|e| e.get(&weight)).and_then(|w| w.get("source"))
        } else {
            table.get(engine).and_then(|e| e.get("source"))
        };
        source.and_then(Value::as_object).map(|o| o.keys().cloned().collect()).unwrap_or_default()
    }

    fn engine_supports(&self, engine: &str, language: &str) -> bool {
        self.translation_languages(engine).iter().any(|l| l == language)
    }

    /// `findTranslationEngines`.
    pub fn find_translation_engines(&self, your: &Value, target: &Value, status: &Value) -> Vec<String> {
        let available: HashSet<&str> =
            status.as_object().map(|o| o.iter().filter(|(_, v)| **v == true).map(|(k, _)| k.as_str()).collect()).unwrap_or_default();
        let sources = enabled(your);
        let targets = enabled(target);
        languages::translation_engines()
            .into_iter()
            .filter(|engine| {
                let list = self.translation_languages(engine);
                available.contains(engine.as_str())
                    && sources.iter().all(|l| list.contains(l))
                    && targets.iter().all(|l| list.contains(l))
            })
            .collect()
    }

    /// `getTranslationEngines`: the engines offered for the current tab.
    pub fn selectable_translation_engines(&self) -> Vec<String> {
        let config = self.config();
        let tab = config.get_str("SELECTED_TAB_NO");
        let your = config.get("SELECTED_YOUR_LANGUAGES")[&tab].clone();
        let target = config.get("SELECTED_TARGET_LANGUAGES")[&tab].clone();
        let status = config.get("SELECTABLE_TRANSLATION_ENGINE_STATUS");
        let mut engines = self.find_translation_engines(&your, &target, &status);
        let source = your["1"]["language"].clone();
        let same = target.as_object().is_some_and(|o| o.values().any(|t| t["language"] == source && t["enable"] == true));
        if same {
            engines = if status[LOCAL_ENGINE] == true { vec![LOCAL_ENGINE.to_string()] } else { Vec::new() };
        }
        engines
    }

    /// Whether a recognition engine can listen for the language (`isLanguageSupportedByTranscriptionEngine`).
    pub fn transcription_supports(&self, engine: &str, language: &str, country: &str) -> bool {
        if !languages::known_language(language, country) {
            return false;
        }
        if engine != "Deepgram" {
            return true;
        }
        let config = self.config();
        let model = config.get_str("SELECTED_DEEPGRAM_MODEL");
        let codes: Vec<String> = config.get("DEEPGRAM_MODEL_LANGUAGES")[&model]
            .as_array()
            .map(|a| a.iter().filter_map(|c| c.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        codes.iter().any(|c| c.to_lowercase() == "multi") || deepgram_code(language, country, &codes).is_some()
    }

    /// `getListLanguageAndCountry`: every language some engine translates and the recognition
    /// engine can listen for, sorted by name.
    pub fn language_and_country_list(&self) -> Vec<Value> {
        let engine = self.config().get_str("SELECTED_TRANSCRIPTION_ENGINE");
        let mut translatable = HashSet::new();
        for engine in languages::translation_engines() {
            translatable.extend(self.translation_languages(&engine));
        }
        let mut list = Vec::new();
        for (language, countries) in transcription() {
            if !translatable.contains(language) {
                continue;
            }
            for country in countries.as_object().into_iter().flat_map(|c| c.keys()) {
                if self.transcription_supports(&engine, language, country) {
                    list.push(json!({ "language": language, "country": country }));
                }
            }
        }
        list.sort_by(|a, b| a["language"].as_str().cmp(&b["language"].as_str()));
        list
    }

    /// `pickDefaultLanguageForEngine`.
    fn default_language_for(&self, engine: &str, avoid: &HashSet<String>) -> Option<Value> {
        for (language, country) in [("Japanese", "Japan"), ("English", "United States")] {
            if !avoid.contains(language) && self.engine_supports(engine, language) {
                return Some(json!({ "language": language, "country": country }));
            }
        }
        for language in self.translation_languages(engine) {
            if avoid.contains(&language) {
                continue;
            }
            if let Some(country) = transcription().get(&language).and_then(Value::as_object).and_then(|c| c.keys().next()) {
                return Some(json!({ "language": language, "country": country }));
            }
        }
        None
    }

    /// `fallbackUnsupportedLanguagesForEngine`.
    pub fn fallback_unsupported_languages(&self, tab: &str, engine: &str) -> bool {
        let config = self.config();
        let mut your = config.get("SELECTED_YOUR_LANGUAGES");
        let mut target = config.get("SELECTED_TARGET_LANGUAGES");
        let mut changed = false;
        let mut reset = Vec::new();
        let enabled_targets: HashSet<String> = enabled(&target[tab]).into_iter().collect();
        let mut source = your[tab]["1"].clone();
        let source_language = source["language"].as_str().unwrap_or_default().to_string();
        if !self.engine_supports(engine, &source_language) {
            if let Some(default) = self.default_language_for(engine, &enabled_targets) {
                reset.push(source_language);
                let mut entry = default;
                entry["enable"] = json!(true);
                your[tab]["1"] = entry;
                let _ = config.set("SELECTED_YOUR_LANGUAGES", your.clone());
                changed = true;
                source = your[tab]["1"].clone();
            }
        }
        let mut taken: HashSet<String> = [source["language"].as_str().unwrap_or_default().to_string()].into();
        let mut target_changed = false;
        if let Some(slots) = target[tab].as_object_mut() {
            for entry in slots.values_mut() {
                if entry["enable"] != true {
                    continue;
                }
                let language = entry["language"].as_str().unwrap_or_default().to_string();
                if self.engine_supports(engine, &language) {
                    taken.insert(language);
                    continue;
                }
                if let Some(default) = self.default_language_for(engine, &taken) {
                    reset.push(language);
                    entry["language"] = default["language"].clone();
                    entry["country"] = default["country"].clone();
                    target_changed = true;
                }
                taken.insert(entry["language"].as_str().unwrap_or_default().to_string());
            }
        }
        if target_changed {
            let _ = config.set("SELECTED_TARGET_LANGUAGES", target);
            changed = true;
        }
        if changed {
            self.notify("selected_your_languages", config.get("SELECTED_YOUR_LANGUAGES"));
            self.notify("selected_target_languages", config.get("SELECTED_TARGET_LANGUAGES"));
            let mut unique = Vec::new();
            for language in reset {
                if !unique.contains(&language) {
                    unique.push(language);
                }
            }
            if !unique.is_empty() {
                let weight = if engine == LOCAL_ENGINE { config.get("CTRANSLATE2_WEIGHT_TYPE") } else { Value::Null };
                let error = ErrorReply::new(
                    "TRANSLATION_LANGUAGE_UNSUPPORTED",
                    json!({ "engine": engine, "weight_type": weight, "languages": unique }),
                );
                self.notify_error(super::run_endpoint("translation_language_unsupported"), error);
            }
        }
        changed
    }

    /// `updateTranslationEngineAndEngineList`: the tab's engine, falling back when it cannot be
    /// used, and both told to the UI.
    pub fn update_translation_engine_and_list(&self) {
        let _guard = self.language_lock.lock().unwrap();
        let config = self.config();
        let tab = config.get_str("SELECTED_TAB_NO");
        let mut engines = config.get("SELECTED_TRANSLATION_ENGINES");
        let mut engine = engines[&tab].as_str().unwrap_or(LOCAL_ENGINE).to_string();
        let mut selectable = self.selectable_translation_engines();
        if !selectable.contains(&engine) {
            engine = LOCAL_ENGINE.to_string();
        }
        engines[&tab] = json!(engine);
        let _ = config.set("SELECTED_TRANSLATION_ENGINES", engines.clone());
        let your = config.get("SELECTED_YOUR_LANGUAGES")[&tab]["1"]["language"].clone();
        let same = config.get("SELECTED_TARGET_LANGUAGES")[&tab]
            .as_object()
            .is_some_and(|o| o.values().any(|t| t["language"] == your && t["enable"] == true));
        if same {
            engine = LOCAL_ENGINE.to_string();
            engines[&tab] = json!(engine);
            let _ = config.set("SELECTED_TRANSLATION_ENGINES", engines);
        }
        if self.fallback_unsupported_languages(&tab, &engine) {
            selectable = self.selectable_translation_engines();
        }
        self.notify("selected_translation_engines", config.get("SELECTED_TRANSLATION_ENGINES"));
        self.notify("translation_engines", json!(selectable));
    }

    /// `pickDefaultLanguageAndCountryForTranscriptionEngine`.
    fn default_transcription_language(&self, engine: &str, avoid: &HashSet<String>) -> Option<Value> {
        for (language, country) in [("Japanese", "Japan"), ("English", "United States")] {
            if !avoid.contains(language) && self.transcription_supports(engine, language, country) {
                return Some(json!({ "language": language, "country": country }));
            }
        }
        for (language, countries) in transcription() {
            for country in countries.as_object().into_iter().flat_map(|c| c.keys()) {
                if self.transcription_supports(engine, language, country) && !avoid.contains(language) {
                    return Some(json!({ "language": language, "country": country }));
                }
            }
        }
        None
    }

    /// `fallbackUnsupportedLanguagesForTranscriptionEngine`, on every tab.
    pub fn fallback_unsupported_transcription_languages(&self, engine: &str) -> bool {
        let config = self.config();
        let mut your = config.get("SELECTED_YOUR_LANGUAGES");
        let mut target = config.get("SELECTED_TARGET_LANGUAGES");
        let mut changed = false;
        let tabs: Vec<String> = your.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
        for tab in tabs {
            let enabled_targets: HashSet<String> = enabled(&target[&tab]).into_iter().collect();
            let source = your[&tab]["1"].clone();
            let (language, country) = (source["language"].as_str().unwrap_or(""), source["country"].as_str().unwrap_or(""));
            if !self.transcription_supports(engine, language, country) {
                if let Some(mut default) = self.default_transcription_language(engine, &enabled_targets) {
                    default["enable"] = json!(true);
                    your[&tab]["1"] = default;
                    changed = true;
                }
            }
            let mut taken: HashSet<String> = [your[&tab]["1"]["language"].as_str().unwrap_or_default().to_string()].into();
            if let Some(slots) = target[&tab].as_object_mut() {
                for entry in slots.values_mut() {
                    if entry["enable"] != true {
                        continue;
                    }
                    let (language, country) = (entry["language"].as_str().unwrap_or("").to_string(), entry["country"].as_str().unwrap_or("").to_string());
                    if self.transcription_supports(engine, &language, &country) {
                        taken.insert(language);
                        continue;
                    }
                    if let Some(default) = self.default_transcription_language(engine, &taken) {
                        entry["language"] = default["language"].clone();
                        entry["country"] = default["country"].clone();
                        changed = true;
                    }
                    taken.insert(entry["language"].as_str().unwrap_or_default().to_string());
                }
            }
        }
        if changed {
            let _ = config.set_many(&[("SELECTED_YOUR_LANGUAGES", your), ("SELECTED_TARGET_LANGUAGES", target)]);
            self.notify("selected_your_languages", config.get("SELECTED_YOUR_LANGUAGES"));
            self.notify("selected_target_languages", config.get("SELECTED_TARGET_LANGUAGES"));
        }
        changed
    }

    /// `updateTranscriptionEngine`.
    pub fn update_transcription_engine(&self, requested: Option<Value>) {
        let config = self.config();
        let previous = config.get("SELECTED_TRANSCRIPTION_ENGINE");
        if let Some(requested) = requested {
            let _ = config.set("SELECTED_TRANSCRIPTION_ENGINE", requested);
        }
        let current = config.get("SELECTED_TRANSCRIPTION_ENGINE");
        if current != previous {
            self.fallback_unsupported_transcription_languages(current.as_str().unwrap_or(""));
            self.notify("selectable_language_list", json!(self.language_and_country_list()));
        }
    }

    /// `getTranscriptionEngines`: the available recognition engines.
    pub fn selectable_transcription_engines(&self) -> Vec<String> {
        self.config()
            .get("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS")
            .as_object()
            .map(|o| o.iter().filter(|(_, v)| **v == true).map(|(k, _)| k.clone()).collect())
            .unwrap_or_default()
    }
}

/// A language map written by the UI: stored if valid, then the engine follows.
pub fn set_languages(core: &Core, key: &str, value: &Value) -> Reply {
    {
        let _guard = core.language_lock.lock().unwrap();
        if core.config().set(key, value.clone()).is_err() {
            return super::error("VALIDATION_CONFIG_VALUE_INVALID", core.config().get(key));
        }
    }
    core.cancel_mic_voice();
    core.update_translation_engine_and_list();
    ok(core.config().get(key))
}

pub fn set_tab(core: &Core, value: &Value) -> Reply {
    // Python stored the value without catching a refusal: an unknown tab answered 500.
    {
        let _guard = core.language_lock.lock().unwrap();
        if core.config().set("SELECTED_TAB_NO", value.clone()).is_err() {
            return Reply::status(500, "Internal error");
        }
    }
    core.cancel_mic_voice();
    core.update_translation_engine_and_list();
    ok(core.config().get("SELECTED_TAB_NO"))
}

pub fn swap_languages(core: &Core) -> Reply {
    {
        let _guard = core.language_lock.lock().unwrap();
        let config = core.config();
        let tab = config.get_str("SELECTED_TAB_NO");
        let mut your = config.get("SELECTED_YOUR_LANGUAGES");
        let mut target = config.get("SELECTED_TARGET_LANGUAGES");
        let first_your = your[&tab]["1"].clone();
        your[&tab]["1"] = target[&tab]["1"].clone();
        target[&tab]["1"] = first_your;
        if config.set_many(&[("SELECTED_YOUR_LANGUAGES", your), ("SELECTED_TARGET_LANGUAGES", target)]).is_err() {
            return Reply::status(500, "Internal error");
        }
    }
    core.cancel_mic_voice();
    core.update_translation_engine_and_list();
    let config = core.config();
    let mut result = Map::new();
    result.insert("your".into(), config.get("SELECTED_YOUR_LANGUAGES"));
    result.insert("target".into(), config.get("SELECTED_TARGET_LANGUAGES"));
    ok(Value::Object(result))
}
