//! The SteamVR overlay, moving here from the Python sidecar (`src-python/models/overlay/`,
//! issue #282; design in `docs/superpowers/specs/2026-11-15-vr-overlay-rust-design.md`).
//!
//! Phase 1 holds what does not need SteamVR: the VR page's arrangement, the pose math for
//! pointing, grabbing and placing windows, the timing of fades and of showing and hiding,
//! and the tooltip checks. The Python overlay still drives SteamVR; tests compare these
//! modules with it on recorded cases (`tests/vr_overlay_reference/`). Nothing here logs,
//! and none of it sees caption text.
//!
//! Only the default layout is used by the app so far (the Linux VR surface's first size);
//! the rest waits for the SteamVR host of Phase 3.
#![allow(dead_code)]

pub mod layout;
pub mod math;
pub mod placement;
pub mod pose;
pub mod timing;
