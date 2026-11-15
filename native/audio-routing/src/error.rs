use std::fmt;

/// Which Python exception class a failure corresponds to.
///
/// The Python backend distinguishes speech output failures (`SpeechError`), control
/// failures (`RuntimeError`) and invalid requests (`ValueError`). Some callers act on
/// the class, for example a monitor reports `monitor_<code>` only for speech output
/// failures, so the class travels with the code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Speech,
    Runtime,
    Value,
}

/// A failure, as a stable code that the UI and logs may show.
///
/// Codes never carry device names, driver messages, text or audio.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub kind: Kind,
    pub code: String,
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn speech(code: impl Into<String>) -> Self {
        Self { kind: Kind::Speech, code: code.into() }
    }

    pub fn runtime(code: impl Into<String>) -> Self {
        Self { kind: Kind::Runtime, code: code.into() }
    }

    pub fn value(code: impl Into<String>) -> Self {
        Self { kind: Kind::Value, code: code.into() }
    }

    pub fn is(&self, code: &str) -> bool {
        self.code == code
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.code)
    }
}

impl std::error::Error for Error {}
