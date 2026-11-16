//! What the overlay engine asks of SteamVR. [`crate::openvr`] is the real one; tests use
//! [`fake::FakeVr`].

use crate::math::{Mat34, Mat4, Vec3};

pub type Handle = u64;
/// A tracked device index (`TrackedDeviceIndex_t`).
pub type Device = u32;
pub const HMD: Device = 0;
pub const INVALID_DEVICE: Device = u32::MAX;
pub const MAX_DEVICES: usize = 64;
/// `1 << k_EButton_Grip`.
pub const GRIP_MASK: u64 = 1 << 2;
/// `1 << k_EButton_SteamVR_Trigger`.
pub const TRIGGER_MASK: u64 = 1 << 33;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hand {
    Left,
    Right,
}

/// What a controller reports (`VRControllerState_t`): the buttons held and the first axis
/// (the stick or the trackpad).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ControllerState {
    pub pressed: u64,
    pub axis: (f64, f64),
}

impl ControllerState {
    pub fn grip(&self) -> bool {
        self.pressed & GRIP_MASK != 0
    }

    pub fn trigger(&self) -> bool {
        self.pressed & TRIGGER_MASK != 0
    }
}

/// Where a laser meets an overlay (`VROverlayIntersectionResults_t`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Intersection {
    pub point: Vec3,
    pub normal: Vec3,
    pub uv: (f64, f64),
    pub distance: f64,
}

/// The VR panel's second texture (the resize frame) next to the page's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextureSlot {
    Page,
    Ghost,
}

/// A failed call: what failed, without user data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VrError(pub String);

impl std::fmt::Display for VrError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// The application SteamVR shows as the scene (the game), from `IVRApplications`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SceneApp {
    /// The application key, such as `steam.app.438100`.
    pub key: String,
    /// The application's name (`VRApplicationProperty_Name_String`), such as `VRChat`.
    pub name: String,
    pub process_id: u32,
}

/// SteamVR on this machine.
pub trait Vr: Send + Sync {
    /// Whether SteamVR runs (its `vrmonitor` process). Cheap; polled every 10 seconds.
    fn runtime_running(&self) -> bool;
    /// Connects as a background application. Fails while the headset is not found yet, and
    /// when the OpenVR library cannot be loaded.
    fn connect(&self) -> Result<Box<dyn Session>, VrError>;
}

/// One connection to SteamVR. Dropping it closes the connection.
pub trait Session: Send {
    fn create_overlay(&mut self, key: &str, name: &str) -> Result<Handle, VrError>;
    fn destroy_overlay(&mut self, overlay: Handle) -> Result<(), VrError>;
    /// An RGBA picture (`SetOverlayRaw`, 4 bytes per pixel).
    fn set_raw(&mut self, overlay: Handle, rgba: &[u8], width: u32, height: u32) -> Result<(), VrError>;
    /// Shows a BGRA picture of `width` x `height` on every overlay of `overlays` through one
    /// GPU texture made at least `texture` big (the VR panel; `SetOverlayTexture`). Returns
    /// the texture's size: the picture fills its top left.
    fn set_shared_texture(&mut self, slot: TextureSlot, overlays: &[Handle], bgra: &[u8], width: u32, height: u32, texture: (u32, u32))
    -> Result<(u32, u32), VrError>;
    fn set_alpha(&mut self, overlay: Handle, alpha: f32) -> Result<(), VrError>;
    fn set_color(&mut self, overlay: Handle, rgb: [f32; 3]) -> Result<(), VrError>;
    fn set_width(&mut self, overlay: Handle, metres: f32) -> Result<(), VrError>;
    fn set_sort_order(&mut self, overlay: Handle, order: u32) -> Result<(), VrError>;
    /// (uMin, vMin, uMax, vMax).
    fn set_texture_bounds(&mut self, overlay: Handle, bounds: [f32; 4]) -> Result<(), VrError>;
    /// Fixed in the standing play space.
    fn set_transform_absolute(&mut self, overlay: Handle, pose: &Mat34) -> Result<(), VrError>;
    fn set_transform_relative(&mut self, overlay: Handle, device: Device, pose: &Mat34) -> Result<(), VrError>;
    fn show(&mut self, overlay: Handle) -> Result<(), VrError>;
    fn hide(&mut self, overlay: Handle) -> Result<(), VrError>;
    /// Reads the pending events; true when SteamVR asked applications to quit.
    fn quit_requested(&mut self) -> bool;
    /// The controller in a hand, or [`INVALID_DEVICE`].
    fn hand(&mut self, hand: Hand) -> Device;
    fn connected(&mut self, device: Device) -> bool;
    /// The devices' poses in the standing play space; `None` where not valid.
    fn poses(&mut self) -> Vec<Option<Mat4>>;
    /// Whether the headset is worn; true when SteamVR cannot tell.
    fn headset_worn(&mut self) -> bool;
    /// The scene application (the game in the headset); `None` while there is none.
    fn scene_application(&mut self) -> Result<Option<SceneApp>, VrError> {
        Ok(None)
    }
    /// The buttons and the stick of a controller (`GetControllerState`); `None` when SteamVR
    /// does not answer for it.
    fn controller_state(&mut self, _device: Device) -> Option<ControllerState> {
        None
    }
    /// SteamVR's own test of the laser from `source` along `direction` (standing space) against
    /// an overlay (`ComputeOverlayIntersection`).
    fn intersect(&mut self, _overlay: Handle, _source: Vec3, _direction: Vec3) -> Option<Intersection> {
        None
    }
    /// The pose of the controller's tip (its render model's "tip" component) as seen from the
    /// controller (`GetComponentState`); `None` when SteamVR does not know it.
    fn tip_offset(&mut self, _device: Device) -> Option<Mat4> {
        None
    }
}

/// A stand-in SteamVR for tests: records what is asked and lets a test choose what runs, where
/// the devices are and what the controllers press. Laser tests are answered from where the
/// overlays were placed, as SteamVR would.
pub mod fake {
    use super::*;
    use crate::math;
    use std::collections::{HashMap, HashSet};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    pub struct State {
        pub running: bool,
        pub refuse_connect: bool,
        pub fail_raw: bool,
        pub quit: bool,
        pub connects: usize,
        pub sessions_open: usize,
        pub next_handle: Handle,
        /// (key, handle) of the overlays made, in order.
        pub created: Vec<(String, Handle)>,
        pub destroyed: Vec<Handle>,
        /// Every call, as a short line ("raw 3 1010x200", "alpha 1 0.50").
        pub calls: Vec<String>,
        pub visible: HashSet<Handle>,
        pub raw: HashMap<Handle, (u32, u32)>,
        /// The devices' poses (index 0 is the headset). Empty: the headset at the origin only.
        pub poses: Vec<Option<Mat4>>,
        pub hands_connected: bool,
        /// The scene application [`Session::scene_application`] reports.
        pub scene: Option<SceneApp>,
        /// Whether reading the scene application fails.
        pub fail_scene: bool,
        /// How often the scene application was read.
        pub scene_reads: usize,
        /// What each controller holds and where its stick is; a controller missing here does not
        /// answer.
        pub controllers: HashMap<Device, ControllerState>,
        /// How many times a controller's buttons were read (tests wait for the loop to see a press).
        pub controller_reads: u64,
        /// The controllers' tips; missing: not known.
        pub tips: HashMap<Device, Mat4>,
        /// Where each overlay was put: the device it follows (`None`: the play space) and the pose.
        pub placed: HashMap<Handle, (Option<Device>, Mat34)>,
        pub widths: HashMap<Handle, f64>,
        pub alphas: HashMap<Handle, f64>,
        pub colors: HashMap<Handle, [f32; 3]>,
        /// (uMin, vMin, uMax, vMax).
        pub bounds: HashMap<Handle, [f32; 4]>,
        /// The texture each overlay shows and its size.
        pub textures: HashMap<Handle, (TextureSlot, (u32, u32))>,
    }

    impl State {
        fn pose_of(&self, device: Device) -> Option<Mat4> {
            if self.poses.is_empty() {
                return (device == HMD).then_some(math::IDENTITY);
            }
            self.poses.get(device as usize).copied().flatten()
        }

        /// An overlay's pose in the play space, if it was placed and its device is tracked.
        pub fn world(&self, overlay: Handle) -> Option<Mat4> {
            let (device, pose) = self.placed.get(&overlay)?;
            let base = match device {
                None => math::IDENTITY,
                Some(device) => self.pose_of(*device)?,
            };
            Some(math::mul(&base, &math::to_homogeneous(pose)))
        }

        /// Height over width of what an overlay shows.
        fn aspect(&self, overlay: Handle) -> f64 {
            match (self.textures.get(&overlay), self.raw.get(&overlay)) {
                (Some((_, (tw, th))), _) => {
                    let [u0, v0, u1, v1] = self.bounds.get(&overlay).copied().unwrap_or([0.0, 0.0, 1.0, 1.0]);
                    let w = f64::from((u1 - u0).abs()) * f64::from(*tw);
                    let h = f64::from((v0 - v1).abs()) * f64::from(*th);
                    if w > 0.0 { h / w } else { 1.0 }
                }
                (None, Some((w, h))) if *w > 0 => f64::from(*h) / f64::from(*w),
                _ => 1.0,
            }
        }
    }

    #[derive(Clone, Default)]
    pub struct FakeVr {
        pub state: Arc<Mutex<State>>,
    }

    impl FakeVr {
        pub fn running() -> Self {
            let fake = Self::default();
            fake.state.lock().unwrap().running = true;
            fake.state.lock().unwrap().hands_connected = true;
            fake
        }

        pub fn with<T>(&self, f: impl FnOnce(&mut State) -> T) -> T {
            f(&mut self.state.lock().unwrap())
        }

        /// The handle of the overlay made with `key`, the latest one.
        pub fn handle(&self, key: &str) -> Option<Handle> {
            self.with(|s| s.created.iter().rev().find(|(k, _)| k == key).map(|(_, h)| *h))
        }

        pub fn calls_on(&self, handle: Handle, prefix: &str) -> Vec<String> {
            let tag = format!("{prefix} {handle} ");
            self.with(|s| s.calls.iter().filter(|c| c.starts_with(&tag)).cloned().collect())
        }

        /// Puts a device somewhere (index 0 is the headset); `None` loses its tracking.
        pub fn set_pose(&self, device: Device, pose: Option<Mat4>) {
            self.with(|s| {
                if s.poses.is_empty() {
                    s.poses = vec![None; MAX_DEVICES];
                    s.poses[HMD as usize] = Some(math::IDENTITY);
                }
                s.poses[device as usize] = pose;
            });
        }

        /// What a controller holds and where its stick is; `None`: it does not answer.
        pub fn set_controller(&self, device: Device, state: Option<ControllerState>) {
            self.with(|s| match state {
                Some(state) => {
                    s.controllers.insert(device, state);
                }
                None => {
                    s.controllers.remove(&device);
                }
            });
        }
    }

    impl Vr for FakeVr {
        fn runtime_running(&self) -> bool {
            self.with(|s| s.running)
        }

        fn connect(&self) -> Result<Box<dyn Session>, VrError> {
            self.with(|s| {
                s.connects += 1;
                if s.refuse_connect {
                    return Err(VrError("VRInitError_Init_HmdNotFound".into()));
                }
                s.sessions_open += 1;
                s.quit = false;
                Ok(Box::new(FakeSession { state: Arc::clone(&self.state) }) as Box<dyn Session>)
            })
        }
    }

    pub struct FakeSession {
        state: Arc<Mutex<State>>,
    }

    impl FakeSession {
        fn call(&self, line: String) -> Result<(), VrError> {
            self.state.lock().unwrap().calls.push(line);
            Ok(())
        }
    }

    impl Drop for FakeSession {
        fn drop(&mut self) {
            self.state.lock().unwrap().sessions_open -= 1;
        }
    }

    impl Session for FakeSession {
        fn create_overlay(&mut self, key: &str, _name: &str) -> Result<Handle, VrError> {
            let mut s = self.state.lock().unwrap();
            s.next_handle += 1;
            let handle = s.next_handle;
            s.created.push((key.to_string(), handle));
            Ok(handle)
        }
        fn destroy_overlay(&mut self, overlay: Handle) -> Result<(), VrError> {
            let mut s = self.state.lock().unwrap();
            s.destroyed.push(overlay);
            s.visible.remove(&overlay);
            Ok(())
        }
        fn set_raw(&mut self, overlay: Handle, rgba: &[u8], width: u32, height: u32) -> Result<(), VrError> {
            let mut s = self.state.lock().unwrap();
            if s.fail_raw {
                return Err(VrError("VROverlayError_RequestFailed".into()));
            }
            assert_eq!(rgba.len(), (width * height * 4) as usize);
            s.raw.insert(overlay, (width, height));
            s.textures.remove(&overlay);
            s.calls.push(format!("raw {overlay} {width}x{height}"));
            Ok(())
        }
        fn set_shared_texture(&mut self, slot: TextureSlot, overlays: &[Handle], bgra: &[u8], width: u32, height: u32, texture: (u32, u32))
        -> Result<(u32, u32), VrError> {
            assert!(bgra.len() >= (width * height * 4) as usize);
            let size = (texture.0.max(width), texture.1.max(height));
            for overlay in overlays {
                self.state.lock().unwrap().textures.insert(*overlay, (slot, size));
                self.call(format!("texture {overlay} {width}x{height}"))?;
            }
            Ok(size)
        }
        fn set_alpha(&mut self, overlay: Handle, alpha: f32) -> Result<(), VrError> {
            self.state.lock().unwrap().alphas.insert(overlay, f64::from(alpha));
            self.call(format!("alpha {overlay} {alpha:.2}"))
        }
        fn set_color(&mut self, overlay: Handle, rgb: [f32; 3]) -> Result<(), VrError> {
            self.state.lock().unwrap().colors.insert(overlay, rgb);
            self.call(format!("color {overlay} {:?}", rgb))
        }
        fn set_width(&mut self, overlay: Handle, metres: f32) -> Result<(), VrError> {
            self.state.lock().unwrap().widths.insert(overlay, f64::from(metres));
            self.call(format!("width {overlay} {metres:.4}"))
        }
        fn set_sort_order(&mut self, overlay: Handle, order: u32) -> Result<(), VrError> {
            self.call(format!("sort {overlay} {order}"))
        }
        fn set_texture_bounds(&mut self, overlay: Handle, bounds: [f32; 4]) -> Result<(), VrError> {
            self.state.lock().unwrap().bounds.insert(overlay, bounds);
            self.call(format!("bounds {overlay} {:.4} {:.4} {:.4} {:.4}", bounds[0], bounds[1], bounds[2], bounds[3]))
        }
        fn set_transform_absolute(&mut self, overlay: Handle, pose: &Mat34) -> Result<(), VrError> {
            self.state.lock().unwrap().placed.insert(overlay, (None, *pose));
            self.call(format!("absolute {overlay} {:.3} {:.3} {:.3}", pose[0][3], pose[1][3], pose[2][3]))
        }
        fn set_transform_relative(&mut self, overlay: Handle, device: Device, pose: &Mat34) -> Result<(), VrError> {
            self.state.lock().unwrap().placed.insert(overlay, (Some(device), *pose));
            self.call(format!("relative {overlay} {device} {:.3} {:.3} {:.3}", pose[0][3], pose[1][3], pose[2][3]))
        }
        fn show(&mut self, overlay: Handle) -> Result<(), VrError> {
            self.state.lock().unwrap().visible.insert(overlay);
            self.call(format!("show {overlay} "))
        }
        fn hide(&mut self, overlay: Handle) -> Result<(), VrError> {
            self.state.lock().unwrap().visible.remove(&overlay);
            self.call(format!("hide {overlay} "))
        }
        fn quit_requested(&mut self) -> bool {
            self.state.lock().unwrap().quit
        }
        fn hand(&mut self, hand: Hand) -> Device {
            if self.state.lock().unwrap().hands_connected {
                if hand == Hand::Left { 1 } else { 2 }
            } else {
                INVALID_DEVICE
            }
        }
        fn connected(&mut self, device: Device) -> bool {
            device == HMD || (self.state.lock().unwrap().hands_connected && device != INVALID_DEVICE)
        }
        fn poses(&mut self) -> Vec<Option<Mat4>> {
            let poses = self.state.lock().unwrap().poses.clone();
            if poses.is_empty() {
                let mut all = vec![None; MAX_DEVICES];
                all[0] = Some(crate::math::IDENTITY);
                return all;
            }
            poses
        }
        fn headset_worn(&mut self) -> bool {
            true
        }
        fn scene_application(&mut self) -> Result<Option<SceneApp>, VrError> {
            let mut s = self.state.lock().unwrap();
            s.scene_reads += 1;
            if s.fail_scene {
                return Err(VrError("VRApplicationError_IPCFailed".into()));
            }
            Ok(s.scene.clone())
        }
        fn controller_state(&mut self, device: Device) -> Option<ControllerState> {
            let mut s = self.state.lock().unwrap();
            s.controller_reads += 1;
            s.controllers.get(&device).copied()
        }
        /// A shown overlay is hit within its width and its picture's height; the UV follows
        /// SteamVR's (v in widths from the centre, see `uv_to_pixel`).
        fn intersect(&mut self, overlay: Handle, source: Vec3, direction: Vec3) -> Option<Intersection> {
            let s = self.state.lock().unwrap();
            if !s.visible.contains(&overlay) {
                return None;
            }
            let world = s.world(overlay)?;
            let width = *s.widths.get(&overlay)?;
            let height = width * s.aspect(overlay);
            let normal = math::axis(&world, 2);
            let denom = math::dot(direction, normal);
            if denom.abs() < 1e-9 {
                return None;
            }
            let distance = math::dot(math::sub(math::translation(&world), source), normal) / denom;
            if distance <= 0.0 {
                return None;
            }
            let point = math::add(source, math::scale(direction, distance));
            let local = math::transform_point(&math::inverse(&world)?, point);
            if local[0].abs() > width / 2.0 || local[1].abs() > height / 2.0 {
                return None;
            }
            Some(Intersection { point, normal, uv: (local[0] / width + 0.5, 0.5 + local[1] / width), distance })
        }
        fn tip_offset(&mut self, device: Device) -> Option<Mat4> {
            self.state.lock().unwrap().tips.get(&device).copied()
        }
    }
}
