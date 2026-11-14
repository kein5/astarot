//! The external adapters of VRCT-VOX, in Rust: OSC and OSCQuery towards VRChat, the
//! OBS browser source page, the local WebSocket server (with TLS beyond this PC) and
//! the clipboard with automatic paste.
//!
//! The behaviour follows `src-python/models/osc/`, `obs/`, `websocket/` and
//! `clipboard/`, which this crate is to replace (issue #283): the same wire formats,
//! ports, token checks, limits and certificate rules, so that VRChat, OBS and other
//! WebSocket clients need no new settings.
//!
//! Nothing in this crate logs text, translations, tokens, paths or file contents.
//! Log lines are fixed strings sent to the sink set with [`log::set_sink`].

pub mod log;
pub mod tls;
pub mod websocket;
