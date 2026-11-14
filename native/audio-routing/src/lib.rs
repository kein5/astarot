//! Audio device enumeration, identity, default following and voice routing.
//!
//! The Rust replacement for `src-python/models/audio_routing/`,
//! `src-python/device_manager.py`, `src-python/active_endpoint_tracker.py` and
//! `src-python/audio_device_identity.py` (issue #280). Windows uses WASAPI and Linux
//! uses PipeWire, both through their native APIs. The crate never logs audio samples,
//! text or device payloads.

pub mod error;
pub mod identity;
pub mod manager;
pub mod report;
pub mod snapshot;
pub mod sync;
pub mod tracker;

pub use error::{Error, Kind, Result};
