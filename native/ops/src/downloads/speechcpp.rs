//! Recognition models offered from speech.cpp's own catalog.
//!
//! The data is in `data/` (its README describes the fields): the snapshot of `speech models
//! --json` (`speechcpp_models.json`, written by tools/speechcpp_models.py) and the reviewed offers
//! and profiles (`speechcpp_asr.json`).

use std::sync::OnceLock;

use serde::Deserialize;

use super::catalog::{Artifact, Model};
use crate::json::{Json, Object};

const SNAPSHOT_TEXT: &str = include_str!("../../data/speechcpp_models.json");
const OFFERS_TEXT: &str = include_str!("../../data/speechcpp_asr.json");

/// `speechcpp_asr.json`.
#[derive(Deserialize)]
struct Reviewed {
    offers: Vec<Offer>,
    id_prefixes: std::collections::BTreeMap<String, String>,
    tiers: Vec<(String, u64)>,
    profiles: std::collections::BTreeMap<String, Profile>,
}

#[derive(Deserialize)]
struct Snapshot {
    version: String,
    models: Vec<SpeechModel>,
}

#[derive(Deserialize)]
struct SpeechModel {
    name: String,
    repository: String,
    revision: String,
    task: String,
    languages: Vec<String>,
    start: Vec<String>,
    #[serde(rename = "type")]
    kind: String,
    files: Vec<SpeechFile>,
}

#[derive(Deserialize)]
struct SpeechFile {
    #[serde(rename = "type")]
    kind: String,
    file: String,
    size: u64,
    sha256: String,
}

#[derive(Deserialize)]
struct Offer {
    name: String,
    label: String,
    provider: String,
    license: String,
    licenses: Vec<String>,
    notice: String,
}

/// What a user compares before choosing (`profiles` in `speechcpp_asr.json`).
#[derive(Deserialize)]
struct Profile {
    summary: String,
    id: Option<String>,
    /// File type -> catalog id, for a name whose files are pinned in [`catalog.py`] (the speech models).
    ///
    /// [`catalog.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/model_downloads/catalog.py
    ids: Option<std::collections::BTreeMap<String, String>>,
    /// Replaces speech.cpp's start languages.
    recommended_for: Option<Vec<String>>,
    memory_measured_on: Option<String>,
    cpu: String,
    gpu: String,
    memory: Option<std::collections::BTreeMap<String, u64>>,
}

fn reviewed() -> &'static Reviewed {
    static REVIEWED: OnceLock<Reviewed> = OnceLock::new();
    REVIEWED.get_or_init(|| serde_json::from_str(OFFERS_TEXT).unwrap_or_else(|e| panic!("speechcpp_asr.json: {e}")))
}

fn profiles() -> &'static std::collections::BTreeMap<String, Profile> {
    &reviewed().profiles
}

fn tiers() -> &'static [(String, u64)] {
    &reviewed().tiers
}

fn snapshot() -> &'static Snapshot {
    static SNAPSHOT: OnceLock<Snapshot> = OnceLock::new();
    SNAPSHOT.get_or_init(|| serde_json::from_str(SNAPSHOT_TEXT).unwrap_or_else(|e| panic!("speechcpp_models.json: {e}")))
}

fn offers() -> &'static [Offer] {
    &reviewed().offers
}

fn slug(text: &str) -> String {
    let mut out = String::new();
    for c in text.to_lowercase().chars().filter(|c| *c != '.') {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// q8_0 -> q8, q5_k -> q5, f16 -> f16, iq4_nl -> iq4nl.
fn type_slug(kind: &str) -> String {
    let b = kind.as_bytes();
    if b.len() == 4 && b[0] == b'q' && b[1].is_ascii_digit() && b[2] == b'_' && (b[3] == b'0' || b[3] == b'k') {
        kind[..2].to_string()
    } else {
        kind.chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect()
    }
}

/// The id prefix of a name whose entry existed before the table ("haas-ja-q8").
fn id_prefix(name: &str) -> String {
    reviewed().id_prefixes.get(name).cloned().unwrap_or_else(|| slug(name))
}

fn entry_id(name: &str, kind: &str) -> String {
    format!("{}-{}", id_prefix(name), type_slug(kind))
}

fn offered() -> Vec<(&'static Offer, &'static SpeechModel)> {
    offers()
        .iter()
        .map(|offer| {
            let model = snapshot().models.iter().find(|m| m.name == offer.name).expect("an offered name is in speech.cpp's catalog");
            assert_eq!(model.task, "recognition", "{} recognizes speech", offer.name);
            (offer, model)
        })
        .collect()
}

fn license_url(model: &SpeechModel, link: &str) -> String {
    if link.starts_with("https://") { link.to_string() } else { format!("https://huggingface.co/{}/blob/{}/{link}", model.repository, model.revision) }
}

/// One entry per file of each offered name, the file speech.cpp fetches for the name first.
pub fn asr_models() -> Vec<Model> {
    let mut rows = Vec::new();
    for (offer, model) in offered() {
        let mut files: Vec<&SpeechFile> = model.files.iter().collect();
        files.sort_by_key(|f| f.kind != model.kind);
        for file in files {
            rows.push(Model {
                id: entry_id(&model.name, &file.kind),
                target: "asr".into(),
                name: format!("{} · {}", offer.label, file.kind.to_uppercase()),
                provider: offer.provider.clone(),
                repo: model.repository.clone(),
                revision: model.revision.clone(),
                license: offer.license.clone(),
                licenses: offer.licenses.iter().map(|link| license_url(model, link)).collect(),
                notice: offer.notice.clone(),
                artifacts: vec![Artifact { filename: file.file.clone(), size: file.size, sha256: file.sha256.clone(), role: "model".into(), remote: None }],
            });
        }
    }
    rows
}

/// What a user compares before choosing an entry, or null for entries outside speech.cpp.
pub fn model_profile(id: &str) -> Json {
    for (name, profile) in profiles() {
        let model = snapshot().models.iter().find(|m| &m.name == name).expect("a profiled name is in speech.cpp's catalog");
        let wanted = |f: &&SpeechFile| match &profile.ids {
            Some(ids) => ids.contains_key(&f.kind),
            None => profile.id.is_none() || f.kind == model.kind,
        };
        for file in model.files.iter().filter(wanted) {
            let entry = match &profile.ids {
                Some(ids) => ids[&file.kind].clone(),
                None => profile.id.clone().unwrap_or_else(|| entry_id(name, &file.kind)),
            };
            if entry != id {
                continue;
            }
            let words = |list: &[String]| list.iter().map(|w| Json::from(w.as_str())).collect::<Vec<_>>();
            let memory = profile.memory.as_ref().and_then(|m| m.get(&file.kind)).copied();
            let tier = memory.map(|bytes| tiers().iter().find(|(_, limit)| bytes <= *limit).map_or("heavy", |(name, _)| name.as_str()));
            let start = if file.kind == model.kind { words(profile.recommended_for.as_ref().unwrap_or(&model.start)) } else { Vec::new() };
            return Object::new()
                .with("summary", profile.summary.as_str())
                .with("languages", words(&model.languages))
                .with("recommended_for", start)
                .with("memory_bytes", memory)
                .with("memory_measured_on", memory.and(profile.memory_measured_on.as_deref()))
                .with("tier", tier)
                .with("cpu", profile.cpu.as_str())
                .with("gpu", profile.gpu.as_str())
                .into();
        }
    }
    Json::from(None::<Json>)
}

/// What speech.cpp's catalog says of an entry (its name, type, languages), or null.
pub fn speech_model(id: &str) -> Json {
    for (offer, model) in offered() {
        for file in &model.files {
            if entry_id(&model.name, &file.kind) == id {
                let words = |list: &[String]| list.iter().map(|w| Json::from(w.as_str())).collect::<Vec<_>>();
                return Object::new()
                    .with("name", model.name.as_str())
                    .with("label", offer.label.as_str())
                    .with("type", file.kind.as_str())
                    .with("default", file.kind == model.kind)
                    .with("languages", words(&model.languages))
                    // A recognizer of several languages tells which one it hears: its language
                    // option defaults to "auto" among them, as the server's `/v1/models` says once
                    // it runs (`detects` in astarot_transcription's speechcpp, #1242). One of a
                    // single language does not.
                    .with("detects", model.languages.len() > 1)
                    .with("start", words(&model.start))
                    .with("version", snapshot().version.as_str())
                    .into();
            }
        }
    }
    Json::from(None::<Json>)
}

#[cfg(test)]
mod tests {
    use super::{asr_models, speech_model, type_slug};
    use crate::json::Json;

    // #1242: the catalog says which recognizers tell the language they hear, from speech.cpp's own
    // languages: Qwen3-ASR and Parakeet TDT v3 do, ReazonSpeech v2 and the Japanese-only ones do not.
    #[test]
    fn a_recognizer_of_several_languages_is_marked_as_telling_the_language() {
        let detects = |name: &str| {
            let row = asr_models().into_iter().find(|row| speech_model(&row.id).get("name").and_then(|n| n.as_str()) == Some(name));
            let row = row.unwrap_or_else(|| panic!("{name} is offered"));
            match speech_model(&row.id).get("detects") {
                Some(Json::Bool(detects)) => Some(*detects),
                _ => None,
            }
        };
        for (name, expected) in [("qwen3-asr-0.6b", true), ("parakeet-tdt-0.6b-v3", true), ("reazonspeech-v2", false), ("haas-ja-v1.0", false)] {
            assert_eq!(detects(name), Some(expected), "{name}");
        }
    }

    #[test]
    fn a_quantization_type_becomes_its_short_slug() {
        for (kind, slug) in [("q8_0", "q8"), ("q5_k", "q5"), ("q4_0", "q4"), ("f16", "f16"), ("iq4_nl", "iq4nl"), ("bf16", "bf16")] {
            assert_eq!(type_slug(kind), slug, "{kind}");
        }
        // Only `q<digit>_0` and `q<digit>_k` shorten; anything else keeps its letters and digits.
        for (kind, slug) in [("q4_1", "q41"), ("x8_0", "x80"), ("qx_0", "qx0"), ("q8x0", "q8x0"), ("q8_00", "q800"), ("Q8_0", "80")] {
            assert_eq!(type_slug(kind), slug, "{kind}");
        }
    }
}
