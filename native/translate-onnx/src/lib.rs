//! Local translation with M2M100 and NLLB-200 on ONNX Runtime.
//!
//! This replaces the app's CTranslate2 translator (`src-python/models/translation/`) with the
//! same decoding: the input limit of 1024 tokens, the output limit of 256, and the beam size
//! of each model (5 for M2M100, 2 for NLLB). [`beam`] describes the search.
//!
//! A model is a folder that `tools/translation_onnx/export.py` writes: two ONNX graphs, the
//! tokenizer and a manifest with the SHA-256 of every file. See [`Bundle`].
//!
//! Nothing here logs. An [`Error`] carries a fixed code, never the text being translated.

pub mod beam;
mod bundle;
mod model;
mod tokens;

pub use bundle::{Bundle, Manifest, Pin};
pub use model::{Backend, Device, Translator};

/// The fixed codes of [`Error`].
pub mod codes {
    pub const BUNDLE_INVALID: &str = "translation_bundle_invalid";
    pub const BUNDLE_MODIFIED: &str = "translation_bundle_modified";
    pub const LANGUAGE_UNSUPPORTED: &str = "translation_language_unsupported";
    pub const INPUT_TOO_LONG: &str = "translation_input_too_long";
    pub const UNFINISHED: &str = "translation_unfinished";
    pub const TOKENIZER_FAILED: &str = "translation_tokenizer_failed";
    pub const RUNTIME_FAILED: &str = "translation_runtime_failed";
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub code: &'static str,
}

impl Error {
    pub(crate) const fn new(code: &'static str) -> Error {
        Error { code }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;
