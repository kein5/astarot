//! Speech recognition of VRCT-VOX (#278), the Rust replacement for
//! `src-python/models/transcription/`.
//!
//! - [`recorder`]: the recorder of the cloud engines: capture, the energy listener
//!   ([`energy`]) or voice activity detection ([`vad`], on a speech.cpp server: [`server_vad`]),
//!   utterances from phrases ([`phrases`]) and the engines ([`providers`]).
//! - [`realtime`]: realtime recognition on a speech.cpp server, with [`speechcpp`] for what a
//!   server offers and the vocabulary.
//! - [`terms`]: the vocabulary applied to recognised, translated and spoken text (#446).
//! - [`capture`]: the devices behind one trait, so that tests feed PCM of their own.
//! - [`diagnostics`]: counts and timings of speech, summed up in the log once a minute at most.
//!
//! Nothing here logs or returns recognised text, audio or a key in a diagnostic.

pub mod capture;
pub mod diagnostics;
mod endpoint_choice;
pub mod energy;
#[cfg(target_os = "linux")]
pub mod linux;
pub mod pcm;
pub mod phrases;
pub mod providers;
pub mod realtime;
pub mod recorder;
pub mod server_vad;
pub mod speechcpp;
pub mod terms;
pub mod vad;

pub use capture::Source;

/// A recognised utterance.
#[derive(Clone, Debug, PartialEq)]
pub struct Transcript {
    pub text: String,
    /// The candidate language the engine detected, by name; `None` when unknown.
    pub language: Option<String>,
    /// How long the engine took.
    pub asr_ms: u64,
}

type FailureReporter = Box<dyn Fn(&str, &str) + Send + Sync>;

static REPORTER: std::sync::OnceLock<FailureReporter> = std::sync::OnceLock::new();

/// Where a failure of a voice feature is reported by its fixed code (`report_failure`). The
/// first caller sets it for the process.
pub fn set_failure_reporter(reporter: FailureReporter) {
    let _ = REPORTER.set(reporter);
}

pub(crate) fn report_failure(area: &str, code: &str) {
    if let Some(reporter) = REPORTER.get() {
        reporter(area, code);
    }
}
