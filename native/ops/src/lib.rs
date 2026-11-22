//! The operations side of the VRCT-VOX backend, moved from Python (Issue #284).
//!
//! Codename: Nebiros (#689; the table is in `docs/voice-stack/project-rename.md`).
//!
//! - [`downloads`]: consent-gated model downloads from pinned public artifacts, with size and
//!   SHA-256 verification, staging that is never published half-written, and recovery of what an
//!   interrupted run left behind (`src-python/models/model_downloads/`).
//! - [`telemetry`]: the two usage events, `app_started` and `error`, each at most once a day, with
//!   no identifier of the user or the PC (`src-python/models/telemetry/`).
//! - [`watchdog`]: the timer that stops the backend when the UI stops feeding it
//!   (`src-python/models/watchdog/`).
//!
//! Nothing here logs text, audio, paths or the bodies it sends or receives.

pub mod downloads;
pub mod json;
mod net;
mod process;
pub mod telemetry;
#[cfg(test)]
mod testing;
pub mod watchdog;
