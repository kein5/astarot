//! The operations side of the VRCT-VOX backend, moved from Python (Issue #284).
//!
//! - [`downloads`]: consent-gated model downloads from pinned public artifacts, with size and
//!   SHA-256 verification, staging that is never published half-written, and recovery of what an
//!   interrupted run left behind (`src-python/models/model_downloads/`).
//!
//! Nothing here logs text, audio, paths or the bodies it sends or receives.

pub mod downloads;
pub mod json;
mod net;
mod process;
#[cfg(test)]
mod testing;
