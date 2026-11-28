//! Direct voice and voice conversion for ASTAROT: the Rust counterpart of
//! `src-python/models/voice_conversion/` without its Python engines.
//!
//! - [`direct`]: one direct producer at a time, the microphone passed through or converted
//!   ([`direct_voice.py`]).
//! - [`process`]: one conversion session, the owner of the RVC worker process
//!   ([`process.py`], [`rvc_process.py`], [`isolated.py`]).
//! - [`protocol`]: the worker's pipe contract, "VVC1" ([`protocol.py`]).
//! - [`runtime`]: the consent-gated setup of the worker's runtime ([`runtime_setup.py`]).
//! - [`audition`]: a short sample converted by a worker of its own, for the voice audition of
//!   the RVC catalog (#415).
//!
//! Nothing here logs audio, text or paths; failures are fixed codes.
//!
//! [`direct_voice.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/voice_conversion/direct_voice.py
//! [`process.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/voice_conversion/process.py
//! [`rvc_process.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/voice_conversion/rvc_process.py
//! [`isolated.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/voice_conversion/isolated.py
//! [`protocol.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/voice_conversion/protocol.py
//! [`runtime_setup.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/voice_conversion/runtime_setup.py

// Callbacks and factories are spelled out where they are used.
#![allow(clippy::type_complexity)]

pub mod archive;
pub mod audition;
mod child;
pub mod direct;
pub mod process;
pub mod protocol;
pub mod runtime;
pub mod worker;

pub use direct::{DirectBackend, DirectHealth, DirectVoice};
pub use process::{DeviceRoute, Health, ManagedRoute, PreparedRvc, SpeakFailure, VcProcess, VcRoute};
