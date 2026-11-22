//! The backend core of VRCT-VOX, in Rust (Issue #285).
//!
//! Codename: Ayperos (#689; the table is in `docs/voice-stack/project-rename.md`).
//!
//! It takes over what the Python sidecar's [`mainloop.py`], [`controller.py`] and [`config.py`] did:
//! the requests from the UI and their answers ([`protocol`], [`dispatch`]), the error codes
//! ([`errors`]), the settings and their migration from the Python era ([`config`]), the start-up
//! and shut-down ([`backend`]) and the endpoints ([`controller`]). The feature crates under
//! `native/` do the work behind the endpoints.
//!
//! The application runs it in its own process: `src-tauri` hands it the request lines the UI
//! writes and gives the UI the lines it answers, in the format the sidecar spoke over stdio.
//! Nothing here logs the user's text or audio.
//!
//! [`mainloop.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/mainloop.py
//! [`controller.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/controller.py
//! [`config.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/config.py

pub mod backend;
pub mod config;
pub mod controller;
pub mod dispatch;
pub mod errors;
pub mod gpu_memory;
pub mod languages;
mod local_time;
pub mod log;
pub mod net_policy;
pub mod protocol;
pub mod resources;
pub mod shipped_libraries;
pub mod storage;
pub mod voice_settings;

pub use backend::{Backend, Options, STARTUP_FAILED_EXIT, STARTUP_LIMIT, STARTUP_TIMEOUT_EXIT, Sink};
/// The VR overlay crate, for the app's VR panel surface (its layout).
pub use astarot_vr_overlay as vr_overlay;
