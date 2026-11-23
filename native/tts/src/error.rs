//! Fixed failure codes. Never server bodies, text, voice data or OS messages.

use std::borrow::Cow;
use std::fmt;

/// A safe speech failure code, such as `transport_error` or `http_503`.
///
/// A `transport_error` also carries how the server's answer failed to arrive, as one fixed word
/// ([`SpeechError::detail`]; #861). Two errors are the same when their codes are: the detail only
/// tells failures of one code apart in the speech's status.
#[derive(Debug, Clone)]
pub struct SpeechError {
    code: Cow<'static, str>,
    detail: Option<&'static str>,
}

impl PartialEq for SpeechError {
    fn eq(&self, other: &Self) -> bool {
        self.code == other.code
    }
}

impl Eq for SpeechError {}

impl SpeechError {
    pub const fn new(code: &'static str) -> Self {
        Self { code: Cow::Borrowed(code), detail: None }
    }

    /// `transport_error`, and how the answer failed: `socket`, `ended_early`, `malformed`,
    /// `stalled` (a send or a receive passed its time limit) or `interrupted`.
    pub const fn transport(detail: &'static str) -> Self {
        Self { code: Cow::Borrowed("transport_error"), detail: Some(detail) }
    }

    /// `http_<status>`. The status is a number the server chose, never its body.
    pub fn http_status(status: u16) -> Self {
        Self { code: Cow::Owned(format!("http_{status}")), detail: None }
    }

    pub(crate) fn from_reason(reason: &str) -> Self {
        Self { code: Cow::Owned(reason.to_owned()), detail: None }
    }

    /// A fixed code another crate reported (an output device's, the conversion's).
    pub fn from_code(code: &str) -> Self {
        Self::from_reason(code)
    }

    pub fn code(&self) -> &str {
        &self.code
    }

    /// One fixed word that says more about the code, when there is one (only `transport_error`
    /// has one). Never a server body, text, voice data or an OS message.
    pub fn detail(&self) -> Option<&'static str> {
        self.detail
    }
}

impl fmt::Display for SpeechError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.code)
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

    /// The fixed word the status keeps beside the code ([`SpeechError::detail`]).
    pub fn failure_detail(&self) -> Option<&'static str> {
        match self {
            TtsError::Speech(error) => error.detail(),
            TtsError::Unavailable(_) | TtsError::Output => None,
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
