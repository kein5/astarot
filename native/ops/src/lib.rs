//! The operations side of the VRCT-VOX backend, moved from Python (Issue #284).
//!
//! - [`downloads`]: consent-gated model downloads from pinned public artifacts, with size and
//!   SHA-256 verification, staging that is never published half-written, and recovery of what an
//!   interrupted run left behind (`src-python/models/model_downloads/`).
//! - [`telemetry`]: the two usage events, `app_started` and `error`, each at most once a day, with
//!   no identifier of the user or the PC (`src-python/models/telemetry/`).
//!
//! Nothing here logs text, audio, paths or the bodies it sends or receives.

pub mod downloads;
pub mod json;
mod net;
mod process;
pub mod telemetry;
#[cfg(test)]
mod testing;
