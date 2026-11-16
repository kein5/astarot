//! The SteamVR overlays of VRCT-VOX (`src-python/models/overlay/`, issue #282).
//!
//! - [`engine`]: the overlay thread. It waits for SteamVR, makes the overlays, keeps their
//!   positions, fades the subtitles out, shows the VR panel's picture and takes the controllers
//!   (laser, clicks on the page, grabbing, scaling, resizing, the toolbar).
//! - [`subtitle`] and [`fonts`]: the pictures of the small and the large log.
//! - [`runtime`]: what the engine asks of SteamVR, with the real one in [`openvr`] (the
//!   `openvr_api` library is loaded when SteamVR runs) and stand-ins in tests.
//! - [`surface`]: where the VR panel's page is captured, how its size is set and how the mouse
//!   input reaches it.
//! - [`layout`], [`math`], [`placement`], [`pose`], [`timing`], [`tooltip`]: the arrangement of
//!   the VR page and the pose math, checked against the Python overlay on recorded cases.
//!
//! Nothing here logs user text: the engine's log lines name steps and sizes only.

pub mod canvas;
pub mod engine;
pub mod fonts;
pub mod layout;
pub mod math;
pub mod openvr;
pub mod placement;
pub mod pose;
pub mod process;
pub mod runtime;
pub mod subtitle;
pub mod surface;
pub mod timing;
pub mod tooltip;

#[cfg(test)]
mod reference_tests;
