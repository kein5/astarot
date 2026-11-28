//! One SteamVR connection for the whole process ([`src-python/models/openvr_session.py`]).
//!
//! OpenVR keeps one connection per process: `VR_ShutdownInternal` closes it for every caller.
//! The overlays and the clipboard (which reads the scene application's name) therefore share
//! it. [`SharedVr::connect`] opens the connection for the first holder and hands later holders
//! the same one; the connection closes when the last holder drops its session.
//!
//! [`src-python/models/openvr_session.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/openvr_session.py

use crate::math::{Mat34, Mat4, Vec3};
use crate::runtime::{ApplicationError, ControllerState, Device, Hand, Handle, Intersection, SceneApp, Session, TextureSlot, Vr, VrError};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

struct Slot {
    session: Option<Box<dyn Session>>,
    holders: usize,
}

/// A [`Vr`] whose sessions share one connection to `inner`.
pub struct SharedVr {
    inner: Arc<dyn Vr>,
    slot: Arc<Mutex<Slot>>,
}

impl SharedVr {
    pub fn new(inner: Arc<dyn Vr>) -> Self {
        Self { inner, slot: Arc::new(Mutex::new(Slot { session: None, holders: 0 })) }
    }

    /// How many sessions hold the connection now.
    pub fn holders(&self) -> usize {
        lock(&self.slot).holders
    }
}

fn lock(slot: &Mutex<Slot>) -> MutexGuard<'_, Slot> {
    slot.lock().unwrap_or_else(|e| e.into_inner())
}

impl Vr for SharedVr {
    fn runtime_running(&self) -> bool {
        self.inner.runtime_running()
    }

    fn connect(&self) -> Result<Box<dyn Session>, VrError> {
        let mut slot = lock(&self.slot);
        if slot.session.is_none() {
            slot.session = Some(self.inner.connect()?);
            slot.holders = 0;
        }
        slot.holders += 1;
        Ok(Box::new(SharedSession { slot: Arc::clone(&self.slot) }))
    }
}

/// One holder of the shared connection.
struct SharedSession {
    slot: Arc<Mutex<Slot>>,
}

impl SharedSession {
    fn with<T>(&mut self, f: impl FnOnce(&mut dyn Session) -> T) -> T {
        let mut slot = lock(&self.slot);
        let session = slot.session.as_mut().expect("the connection stays open while a holder has it");
        f(session.as_mut())
    }
}

impl Drop for SharedSession {
    fn drop(&mut self) {
        let mut slot = lock(&self.slot);
        slot.holders = slot.holders.saturating_sub(1);
        if slot.holders == 0 {
            // Closed under the lock, so a new holder cannot connect before it is closed.
            slot.session = None;
        }
    }
}

impl Session for SharedSession {
    fn create_overlay(&mut self, key: &str, name: &str) -> Result<Handle, VrError> {
        self.with(|s| s.create_overlay(key, name))
    }
    fn destroy_overlay(&mut self, overlay: Handle) -> Result<(), VrError> {
        self.with(|s| s.destroy_overlay(overlay))
    }
    fn set_raw(&mut self, overlay: Handle, rgba: &[u8], width: u32, height: u32) -> Result<(), VrError> {
        self.with(|s| s.set_raw(overlay, rgba, width, height))
    }
    fn set_shared_texture(&mut self, slot: TextureSlot, overlays: &[Handle], bgra: &[u8], width: u32, height: u32, texture: (u32, u32))
    -> Result<(u32, u32), VrError> {
        self.with(|s| s.set_shared_texture(slot, overlays, bgra, width, height, texture))
    }
    fn set_alpha(&mut self, overlay: Handle, alpha: f32) -> Result<(), VrError> {
        self.with(|s| s.set_alpha(overlay, alpha))
    }
    fn set_color(&mut self, overlay: Handle, rgb: [f32; 3]) -> Result<(), VrError> {
        self.with(|s| s.set_color(overlay, rgb))
    }
    fn set_width(&mut self, overlay: Handle, metres: f32) -> Result<(), VrError> {
        self.with(|s| s.set_width(overlay, metres))
    }
    fn set_sort_order(&mut self, overlay: Handle, order: u32) -> Result<(), VrError> {
        self.with(|s| s.set_sort_order(overlay, order))
    }
    fn set_texture_bounds(&mut self, overlay: Handle, bounds: [f32; 4]) -> Result<(), VrError> {
        self.with(|s| s.set_texture_bounds(overlay, bounds))
    }
    fn set_transform_absolute(&mut self, overlay: Handle, pose: &Mat34) -> Result<(), VrError> {
        self.with(|s| s.set_transform_absolute(overlay, pose))
    }
    fn set_transform_relative(&mut self, overlay: Handle, device: Device, pose: &Mat34) -> Result<(), VrError> {
        self.with(|s| s.set_transform_relative(overlay, device, pose))
    }
    fn show(&mut self, overlay: Handle) -> Result<(), VrError> {
        self.with(|s| s.show(overlay))
    }
    fn hide(&mut self, overlay: Handle) -> Result<(), VrError> {
        self.with(|s| s.hide(overlay))
    }
    fn quit_requested(&mut self) -> bool {
        self.with(|s| s.quit_requested())
    }
    fn hand(&mut self, hand: Hand) -> Device {
        self.with(|s| s.hand(hand))
    }
    fn connected(&mut self, device: Device) -> bool {
        self.with(|s| s.connected(device))
    }
    fn poses(&mut self) -> Vec<Option<Mat4>> {
        self.with(|s| s.poses())
    }
    fn headset_worn(&mut self) -> bool {
        self.with(|s| s.headset_worn())
    }
    fn scene_application(&mut self) -> Result<Option<SceneApp>, VrError> {
        self.with(|s| s.scene_application())
    }
    fn controller_state(&mut self, device: Device) -> Option<ControllerState> {
        self.with(|s| s.controller_state(device))
    }
    fn intersect(&mut self, overlay: Handle, source: Vec3, direction: Vec3) -> Option<Intersection> {
        self.with(|s| s.intersect(overlay, source, direction))
    }
    fn tip_offset(&mut self, device: Device) -> Option<Mat4> {
        self.with(|s| s.tip_offset(device))
    }
    fn add_application_manifest(&mut self, manifest: &Path) -> Result<(), ApplicationError> {
        self.with(|s| s.add_application_manifest(manifest))
    }
    fn remove_application_manifest(&mut self, manifest: &Path) -> Result<(), ApplicationError> {
        self.with(|s| s.remove_application_manifest(manifest))
    }
    fn application_binary(&mut self, key: &str) -> Result<Option<String>, ApplicationError> {
        self.with(|s| s.application_binary(key))
    }
    fn set_auto_launch(&mut self, key: &str, on: bool) -> Result<(), ApplicationError> {
        self.with(|s| s.set_auto_launch(key, on))
    }
    fn auto_launch(&mut self, key: &str) -> Result<bool, ApplicationError> {
        self.with(|s| s.auto_launch(key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::fake::FakeVr;

    #[test]
    fn holders_share_one_connection_and_the_last_one_closes_it() {
        let fake = FakeVr::running();
        let shared = SharedVr::new(Arc::new(fake.clone()));
        let mut overlay = shared.connect().unwrap();
        let handle = overlay.create_overlay("vrct.small", "small").unwrap();
        {
            let mut clipboard = shared.connect().unwrap();
            assert_eq!(shared.holders(), 2);
            assert_eq!(clipboard.scene_application().unwrap(), None);
        }
        // The clipboard let go; the overlay's connection stays open.
        assert_eq!(fake.with(|s| (s.connects, s.sessions_open)), (1, 1));
        overlay.show(handle).unwrap();
        drop(overlay);
        assert_eq!(fake.with(|s| (s.connects, s.sessions_open)), (1, 0));
        assert_eq!(shared.holders(), 0);
        // The next holder connects again.
        let again = shared.connect().unwrap();
        assert_eq!(fake.with(|s| (s.connects, s.sessions_open)), (2, 1));
        drop(again);
    }

    #[test]
    fn a_refused_connection_leaves_nothing_held() {
        let fake = FakeVr::running();
        fake.with(|s| s.refuse_connect = true);
        let shared = SharedVr::new(Arc::new(fake.clone()));
        assert!(shared.connect().is_err());
        assert_eq!(shared.holders(), 0);
        fake.with(|s| s.refuse_connect = false);
        let session = shared.connect().unwrap();
        assert_eq!(shared.holders(), 1);
        drop(session);
        assert_eq!(fake.with(|s| s.sessions_open), 0);
    }

    #[test]
    fn the_scene_application_comes_through_the_shared_connection() {
        let fake = FakeVr::running();
        let app = SceneApp { key: "steam.app.438100".into(), name: "VRChat".into(), process_id: 42 };
        fake.with(|s| s.scene = Some(app.clone()));
        let shared = SharedVr::new(Arc::new(fake.clone()));
        let mut session = shared.connect().unwrap();
        assert_eq!(session.scene_application().unwrap(), Some(app));
        assert_eq!(fake.with(|s| s.scene_reads), 1);
    }

    #[test]
    fn the_controllers_come_through_the_shared_connection() {
        let fake = FakeVr::running();
        let held = ControllerState { pressed: crate::runtime::TRIGGER_MASK, axis: (0.0, 0.5) };
        fake.set_controller(2, Some(held));
        fake.with(|s| {
            s.tips.insert(2, crate::math::IDENTITY);
        });
        let shared = SharedVr::new(Arc::new(fake.clone()));
        let mut session = shared.connect().unwrap();
        assert_eq!(session.controller_state(2), Some(held));
        assert_eq!(session.controller_state(1), None);
        assert_eq!(session.tip_offset(2), Some(crate::math::IDENTITY));
        assert_eq!(fake.with(|s| s.controller_reads), 2);
        // A shown overlay one metre ahead is hit at its centre.
        let handle = session.create_overlay("vrct.panel", "panel").unwrap();
        let ahead = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, -1.0]];
        session.set_transform_absolute(handle, &ahead).unwrap();
        session.set_width(handle, 0.5).unwrap();
        session.show(handle).unwrap();
        let hit = session.intersect(handle, [0.0, 0.0, 0.0], [0.0, 0.0, -1.0]).expect("hit");
        assert!((hit.distance - 1.0).abs() < 1e-9);
        assert!((hit.uv.0 - 0.5).abs() < 1e-9 && (hit.uv.1 - 0.5).abs() < 1e-9);
        // The resize frame's texture slot reaches the runtime.
        session.set_shared_texture(TextureSlot::Ghost, &[handle], &[0u8; 16], 2, 2, (2, 2)).unwrap();
        assert_eq!(fake.with(|s| s.textures.get(&handle).map(|t| t.0)), Some(TextureSlot::Ghost));
    }
}
