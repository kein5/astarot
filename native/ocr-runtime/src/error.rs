use std::fmt;

/// What can go wrong while loading models, capturing or reading a picture.
///
/// Messages never include pixels or recognised text; paths are left to the caller.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    /// The file is not what its format says it should be.
    #[error("malformed {kind}: {detail}")]
    Format { kind: &'static str, detail: String },
    /// The file is well-formed but uses something this runtime does not implement.
    #[error("unsupported {kind}: {detail}")]
    Unsupported { kind: &'static str, detail: String },
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("inference backend error: {0}")]
    Backend(String),
    /// Model files are absent or incomplete (catalog ids).
    #[error("models not downloaded: {}", .0.join(", "))]
    ModelsMissing(Vec<String>),
    /// Model files exist but do not match the catalog.
    #[error("model files do not match the catalog: {0}")]
    ModelsInvalid(String),
    /// A capture backend failed (the window or display is still there).
    #[error("capture failed: {0}")]
    Capture(String),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub(crate) fn format(kind: &'static str, detail: impl fmt::Display) -> Self {
        Error::Format { kind, detail: detail.to_string() }
    }

    pub(crate) fn unsupported(kind: &'static str, detail: impl fmt::Display) -> Self {
        Error::Unsupported { kind, detail: detail.to_string() }
    }

    pub(crate) fn invalid(detail: impl fmt::Display) -> Self {
        Error::Invalid(detail.to_string())
    }
}

impl From<ort::Error> for Error {
    fn from(error: ort::Error) -> Self {
        Error::Backend(error.to_string())
    }
}
