//! The chat-reading language setting → which PP-OCR models read it.
//!
//! PP-OCRv6 small reads Japanese, English, Chinese (simplified and traditional) and 40
//! Latin-script languages with one model, so that range needs no choice ("auto").
//! Hangul, Cyrillic, Thai, Arabic and Devanagari are not in it and switch to the
//! PP-OCRv5 script models. Measured on 95 training bubbles (CPU): v6 small CER 0.27,
//! v5 ch 0.62, EasyOCR 0.69; Hangul, Cyrillic and Thai were only readable with the v5
//! script models (CER 0.12 / 0.08 / 0.00).

/// Detection always comes from this download; only recognition changes by script.
/// The ids match the OCR block of the download catalog.
pub const BASE_MODEL_ID: &str = "ppocrv6-small";

/// Which models RapidOCR was given for a language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OcrModelSpec {
    /// "PP-OCRv6" or "PP-OCRv5".
    pub ocr_version: &'static str,
    /// "small" or "mobile".
    pub model_type: &'static str,
    /// RapidOCR's `LangRec`, `None` for the model's own (multilingual) default.
    pub lang_rec: Option<&'static str>,
    /// The download that holds the recogniser.
    pub rec_model_id: &'static str,
}

impl OcrModelSpec {
    pub fn label(&self) -> String {
        format!("{}/{}/{}", self.ocr_version, self.model_type, self.lang_rec.unwrap_or("default"))
    }

    /// The downloads needed to start, the one with the detector first.
    pub fn model_ids(&self) -> Vec<&'static str> {
        if self.rec_model_id == BASE_MODEL_ID {
            vec![BASE_MODEL_ID]
        } else {
            vec![BASE_MODEL_ID, self.rec_model_id]
        }
    }

    /// RapidOCR reorders the text of these languages for display (`RTL_LANGS`).
    pub fn right_to_left(&self) -> bool {
        matches!(self.lang_rec, Some("arabic") | Some("fa") | Some("ur"))
    }
}

pub const AUTO: &str = "auto";

const MULTILINGUAL: OcrModelSpec = OcrModelSpec { ocr_version: "PP-OCRv6", model_type: "small", lang_rec: None, rec_model_id: BASE_MODEL_ID };

const fn script(lang: &'static str, id: &'static str) -> OcrModelSpec {
    OcrModelSpec { ocr_version: "PP-OCRv5", model_type: "mobile", lang_rec: Some(lang), rec_model_id: id }
}

const BY_LANGUAGE: &[(&str, OcrModelSpec)] = &[
    (AUTO, MULTILINGUAL),
    ("Korean", script("korean", "ppocrv5-korean")),
    ("Russian", script("cyrillic", "ppocrv5-cyrillic")),
    ("Ukrainian", script("cyrillic", "ppocrv5-cyrillic")),
    ("Thai", script("th", "ppocrv5-thai")),
    ("Arabic", script("arabic", "ppocrv5-arabic")),
    ("Hindi", script("devanagari", "ppocrv5-devanagari")),
];

/// Languages v6 small reads on its own. Accepted as settings (older versions stored a
/// language name) and treated as "auto".
const COVERED_BY_MULTILINGUAL: &[&str] =
    &["Japanese", "English", "Chinese Simplified", "Chinese Traditional", "French", "German", "Spanish", "Italian", "Portuguese", "Dutch", "Polish", "Turkish", "Vietnamese", "Indonesian"];

/// The choices offered in the UI: "auto" first, then the script languages sorted.
pub fn selectable_languages() -> Vec<&'static str> {
    let mut rest: Vec<&'static str> = BY_LANGUAGE.iter().map(|(name, _)| *name).filter(|name| *name != AUTO).collect();
    rest.sort_unstable();
    let mut out = vec![AUTO];
    out.extend(rest);
    out
}

/// The models for a language setting; `None` for unsupported or empty settings.
pub fn resolve_model_spec(language: &str) -> Option<OcrModelSpec> {
    if language.is_empty() {
        return None;
    }
    if let Some((_, spec)) = BY_LANGUAGE.iter().find(|(name, _)| *name == language) {
        return Some(*spec);
    }
    COVERED_BY_MULTILINGUAL.contains(&language).then_some(MULTILINGUAL)
}

pub fn is_supported(language: &str) -> bool {
    resolve_model_spec(language).is_some()
}
