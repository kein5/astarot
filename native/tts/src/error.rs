//! Fixed failure codes. Never server bodies, text, voice data or OS messages.

use std::borrow::Cow;
use std::fmt;

/// A safe speech failure code, such as `transport_error` or `http_503`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeechError(Cow<'static, str>);

impl SpeechError {
    pub const fn new(code: &'static str) -> Self {
        Self(Cow::Borrowed(code))
    }

    /// `http_<status>`. The status is a number the server chose, never its body.
    pub fn http_status(status: u16) -> Self {
        Self(Cow::Owned(format!("http_{status}")))
    }

    pub(crate) fn from_reason(reason: &str) -> Self {
        Self(Cow::Owned(reason.to_owned()))
    }

    pub fn code(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SpeechError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for SpeechError {}

/// Why one utterance failed, in the three classes the status reports.
///
/// The Python worker distinguished `SpeechError` (its code is safe to show),
/// `ValueError` (settings or language; its message may quote input, so only
/// `language_or_text_unavailable` is shown) and anything else (an output or
/// driver failure, shown as `audio_output_error`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TtsError {
    Speech(SpeechError),
    /// The selected mode has no text, the language is unknown, or the server
    /// selection is invalid. The message is for developers and is never shown.
    Unavailable(&'static str),
    /// An output device, conversion or other dependency failed.
    Output,
}

impl TtsError {
    /// The code put into status and failure reports.
    pub fn failure_code(&self) -> &str {
        match self {
            TtsError::Speech(error) => error.code(),
            TtsError::Unavailable(_) => "language_or_text_unavailable",
            TtsError::Output => "audio_output_error",
        }
    }
}

impl From<SpeechError> for TtsError {
    fn from(error: SpeechError) -> Self {
        TtsError::Speech(error)
    }
}

impl fmt::Display for TtsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.failure_code())
    }
}

impl std::error::Error for TtsError {}
