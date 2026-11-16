//! Direct voice and voice conversion for VRCT-VOX: the Rust counterpart of
//! `src-python/models/voice_conversion/` without its Python engines.
//!
//! - [`direct`]: one direct producer at a time, the microphone passed through or converted
//!   (`direct_voice.py`).
//! - [`process`]: one conversion session, the owner of the RVC worker process
//!   (`process.py`, `rvc_process.py`, `isolated.py`).
//! - [`protocol`]: the worker's pipe contract, "VVC1" (`protocol.py`).
//! - [`runtime`]: the consent-gated setup of the worker's runtime (`runtime_setup.py`).
//!
//! Nothing here logs audio, text or paths; failures are fixed codes.

// Callbacks and factories are spelled out where they are used.
#![allow(clippy::type_complexity)]

pub mod archive;
mod child;
pub mod direct;
pub mod process;
pub mod protocol;
pub mod runtime;
pub mod worker;

pub use direct::{DirectBackend, DirectHealth, DirectVoice};
pub use process::{DeviceRoute, Health, SpeakFailure, VcProcess, VcRoute};
