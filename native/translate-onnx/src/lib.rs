//! Local translation with M2M100 and NLLB-200 on ONNX Runtime.
//!
//! This replaces the app's CTranslate2 translator (`src-python/models/translation/`) with the
//! same decoding: the input limit of 1024 tokens, the output limit of 256, and the beam size
//! of each model (5 for M2M100, 2 for NLLB). [`beam`] describes the search.
//!
//! A model is a folder that `tools/translation_onnx/export.py` writes, or a user puts together
//! the same way: two ONNX graphs, the tokenizer and a manifest with the SHA-256 of every file.
//! See [`Bundle`]. Each folder holds one quantization [`Variant`]; [`accelerate`] decides where
//! it runs (the ONNX Runtime execution provider) and falls back to the CPU, reported.
//!
//! ONNX Runtime is loaded at run time ([`runtime`]), shared with the app's chat reading.
//!
//! Nothing here logs. An [`Error`] carries a fixed code, never the text being translated.

pub mod accelerate;
pub mod beam;
mod bundle;
mod model;
pub mod runtime;
mod tokens;

pub use accelerate::{Accelerator, Fallback, Provider, Support, Variant};
pub use bundle::{Bundle, Manifest, Pin, ARCHITECTURES};
pub use model::Translator;

/// The fixed codes of [`Error`].
pub mod codes {
    /// The manifest is there but malformed, names a file outside the folder or lacks one of
    /// the required files in its list.
    pub const BUNDLE_INVALID: &str = "translation_bundle_invalid";
    /// A file's size or SHA-256 differs from the manifest.
    pub const BUNDLE_MODIFIED: &str = "translation_bundle_modified";
    /// No `manifest.json` in the folder (or not a plain file).
    pub const MANIFEST_MISSING: &str = "translation_manifest_missing";
    /// The manifest names an architecture this crate cannot run.
    pub const ARCHITECTURE_UNSUPPORTED: &str = "translation_architecture_unsupported";
    /// The manifest names a quantization variant this crate does not know.
    pub const VARIANT_UNSUPPORTED: &str = "translation_variant_unsupported";
    /// A file the manifest lists is not in the folder.
    pub const FILE_MISSING: &str = "translation_file_missing";
    pub const LANGUAGE_UNSUPPORTED: &str = "translation_language_unsupported";
    pub const INPUT_TOO_LONG: &str = "translation_input_too_long";
    pub const UNFINISHED: &str = "translation_unfinished";
    pub const TOKENIZER_FAILED: &str = "translation_tokenizer_failed";
    /// The ONNX Runtime library could not be loaded.
    pub const RUNTIME_MISSING: &str = "translation_runtime_missing";
    /// The loaded ONNX Runtime has no such execution provider, or it failed to start.
    pub const PROVIDER_UNAVAILABLE: &str = "translation_provider_unavailable";
    /// The provider started, but the short translation run right after loading failed on it or
    /// gave values that are not numbers of a sane size; the model runs on the CPU instead.
    pub const PROVIDER_CHECK_FAILED: &str = "translation_provider_check_failed";
    /// The device ran out of memory (GPU memory on a GPU provider).
    pub const OUT_OF_MEMORY: &str = "translation_out_of_memory";
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
