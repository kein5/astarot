//! Audio device enumeration, identity, default following and voice routing.
//!
//! The Rust replacement for `src-python/models/audio_routing/`,
//! `src-python/device_manager.py`, `src-python/active_endpoint_tracker.py` and
//! `src-python/audio_device_identity.py` (issue #280). Windows uses WASAPI and Linux
//! uses PipeWire, both through their native APIs. The crate never logs audio samples,
//! text or device payloads.

// Callbacks and factories are spelled out where they are used.
#![allow(clippy::type_complexity)]

pub mod error;
pub mod graph;
pub mod graph_source;
pub mod identity;
pub mod manager;
pub mod monitor;
pub mod mute_state;
pub mod naming;
#[cfg(target_os = "linux")]
pub mod pipewire;
pub mod process;
pub mod report;
pub mod router;
pub mod snapshot;
pub mod sync;
pub mod tracker;
pub mod voice_route;
#[cfg(windows)]
pub mod wasapi;
pub mod windows_route;

pub use error::{Error, Kind, Result};
