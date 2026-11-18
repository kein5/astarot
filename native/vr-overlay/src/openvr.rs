//! SteamVR through the OpenVR C API (`openvr_api`), loaded when the overlay connects.
//!
//! The library is not linked: a build needs no OpenVR SDK, and a machine without it runs
//! everything else. The function tables are those of OpenVR 2.12 (`IVRSystem_023`,
//! `IVROverlay_028`, `IVRApplications_007`, `IVRRenderModels_006`), the version the Python sidecar's pyopenvr
//! 2.12.1401 shipped.
//!
//! Where the library is looked for (the first that loads): `VRCT_OPENVR_API`, the folders the
//! host gives, next to the executable, the Python bundle's copy (`_internal/openvr`), then the
//! system's library path. Shipping it with the app is an open decision
//! (`docs/voice-stack/core-integration.md`).

use crate::math::{Mat34, Mat4, Vec3};
use crate::runtime::{
    ControllerState, Device, HMD, Hand, Handle, INVALID_DEVICE, Intersection, MAX_DEVICES, SceneApp, Session, TextureSlot, Vr,
    VrError,
};
use std::ffi::{CStr, CString, c_char, c_void};
use std::path::PathBuf;

const SYSTEM_VERSION: &str = "FnTable:IVRSystem_023";
const OVERLAY_VERSION: &str = "FnTable:IVROverlay_028";
const APPLICATIONS_VERSION: &str = "FnTable:IVRApplications_007";
/// `k_unMaxApplicationKeyLength`.
const MAX_APPLICATION_KEY: usize = 128;
/// `VRApplicationProperty_Name_String`.
const PROPERTY_NAME: i32 = 0;
const RENDER_MODELS_VERSION: &str = "FnTable:IVRRenderModels_006";
/// `Prop_RenderModelName_String`.
const PROP_RENDER_MODEL_NAME: i32 = 1003;
/// `sizeof(VRControllerState_t)`: packed to 4 bytes outside Windows, like `VREvent_t`.
const CONTROLLER_STATE_SIZE: usize = if cfg!(windows) { 64 } else { 60 };
/// Where `ulButtonPressed` and `rAxis[0]` sit in it.
const CONTROLLER_PRESSED_AT: usize = if cfg!(windows) { 8 } else { 4 };
const CONTROLLER_AXIS_AT: usize = if cfg!(windows) { 24 } else { 20 };
const UNIVERSE_STANDING: i32 = 1;
const ROLE_LEFT: i32 = 1;
const ROLE_RIGHT: i32 = 2;
const EVENT_QUIT: u32 = 700;
/// `sizeof(VREvent_t)`: packed to 4 bytes outside Windows.
const EVENT_SIZE: usize = if cfg!(windows) { 64 } else { 60 };
const TEXTURE_DIRECTX: i32 = 0;
const COLOR_SPACE_AUTO: i32 = 0;
/// `k_EDeviceActivityLevel_Unknown`, `_UserInteraction`, `_UserInteraction_Timeout`.
const WORN_LEVELS: [i32; 3] = [-1, 1, 2];

// Indices in the function tables (the order of openvr_capi.h).
mod system {
    pub const DEVICE_TO_ABSOLUTE_TRACKING_POSE: usize = 11;
    pub const ACTIVITY_LEVEL: usize = 15;
    pub const INDEX_FOR_CONTROLLER_ROLE: usize = 17;
    pub const IS_CONNECTED: usize = 20;
    pub const STRING_PROPERTY: usize = 27;
    pub const POLL_NEXT_EVENT: usize = 29;
    pub const CONTROLLER_STATE: usize = 34;
}
mod render_models {
    pub const COMPONENT_STATE: usize = 14;
}
mod overlay {
    pub const CREATE: usize = 1;
    pub const DESTROY: usize = 3;
    pub const SET_COLOR: usize = 14;
    pub const SET_ALPHA: usize = 16;
    pub const SET_SORT_ORDER: usize = 20;
    pub const SET_WIDTH: usize = 22;
    pub const SET_TEXTURE_BOUNDS: usize = 30;
    pub const SET_TRANSFORM_ABSOLUTE: usize = 33;
    pub const SET_TRANSFORM_RELATIVE: usize = 35;
    pub const SHOW: usize = 43;
    pub const HIDE: usize = 44;
    pub const COMPUTE_INTERSECTION: usize = 53;
    pub const SET_TEXTURE: usize = 60;
    pub const SET_RAW: usize = 62;
}
mod applications {
    pub const KEY_BY_PROCESS_ID: usize = 5;
    pub const PROPERTY_STRING: usize = 14;
    pub const CURRENT_SCENE_PROCESS_ID: usize = 29;
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Matrix34 {
    m: [[f32; 4]; 3],
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Pose {
    device_to_absolute: Matrix34,
    velocity: [f32; 3],
    angular_velocity: [f32; 3],
    tracking_result: i32,
    valid: bool,
    connected: bool,
}

#[repr(C)]
struct Texture {
    handle: *mut c_void,
    kind: i32,
    color_space: i32,
}

/// `VROverlayIntersectionParams_t`.
#[repr(C)]
struct IntersectionParams {
    source: [f32; 3],
    direction: [f32; 3],
    origin: i32,
}

/// `VROverlayIntersectionResults_t`.
#[repr(C)]
#[derive(Default)]
struct IntersectionResults {
    point: [f32; 3],
    normal: [f32; 3],
    uv: [f32; 2],
    distance: f32,
}

/// `RenderModel_ComponentState_t`: two matrices and the properties.
#[repr(C)]
#[derive(Default)]
struct ComponentState {
    tracking_to_render_model: Matrix34,
    tracking_to_local: Matrix34,
    properties: u32,
}

fn mat4(m: &Matrix34) -> Mat4 {
    let mut out = crate::math::IDENTITY;
    for row in 0..3 {
        for column in 0..4 {
            out[row][column] = f64::from(m.m[row][column]);
        }
    }
    out
}

fn matrix(pose: &Mat34) -> Matrix34 {
    let mut m = Matrix34::default();
    for (row, values) in pose.iter().enumerate() {
        for (column, value) in values.iter().enumerate() {
            m.m[row][column] = *value as f32;
        }
    }
    m
}

/// The real SteamVR.
///
/// The connection is the process's one ([`vrct_openvr_client`]): the OCR capture holds it too,
/// and closing the overlay's session leaves the OCR's connected.
pub struct OpenVr {
    folders: Vec<PathBuf>,
}

impl OpenVr {
    /// `folders` are searched for the library before the defaults.
    pub fn new(folders: Vec<PathBuf>) -> Self {
        Self { folders }
    }

    fn candidates(&self) -> Vec<PathBuf> {
        let (name, bundled) = if cfg!(windows) {
            ("openvr_api.dll", "libopenvr_api_64.dll")
        } else {
            ("libopenvr_api.so", "libopenvr_api_64.so")
        };
        let mut out = Vec::new();
        if let Some(path) = std::env::var_os("VRCT_OPENVR_API").filter(|v| !v.is_empty()) {
            out.push(PathBuf::from(path));
        }
        for folder in &self.folders {
            out.push(folder.join(name));
        }
        if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
            out.push(dir.join(name));
            out.push(dir.join("_internal").join("openvr").join(bundled));
        }
        out.push(PathBuf::from(name));
        out
    }
}

impl Vr for OpenVr {
    fn runtime_running(&self) -> bool {
        crate::process::steamvr_running()
    }

    fn connect(&self) -> Result<Box<dyn Session>, VrError> {
        let lease = vrct_openvr_client::acquire(&self.candidates()).map_err(|error| VrError(error.to_string()))?;
        let table = |name: &str| -> Result<*const *const c_void, VrError> {
            lease.interface(name).map_err(|error| VrError(format!("interface {name} error {error}")))
        };
        // A failure here drops the lease, which shuts OpenVR down only when nobody else holds it.
        let system = table(SYSTEM_VERSION)?;
        let overlay = table(OVERLAY_VERSION)?;
        // Only the clipboard reads the scene application; the overlays work without it.
        let applications = table(APPLICATIONS_VERSION).unwrap_or(std::ptr::null());
        // Only the laser's tip needs the render models; without them it points from the
        // controller's body.
        let render_models = table(RENDER_MODELS_VERSION).ok();
        Ok(Box::new(OpenVrSession { system, overlay, applications, render_models, textures: [None, None], lease }))
    }
}

struct OpenVrSession {
    system: *const *const c_void,
    overlay: *const *const c_void,
    /// `IVRApplications`; null when the runtime does not offer this version.
    applications: *const *const c_void,
    render_models: Option<*const *const c_void>,
    /// The page's texture and the resize frame's ([`TextureSlot`]).
    textures: [Option<d3d::SharedTexture>; 2],
    /// The hold on the process's connection; released after the textures (field order).
    lease: vrct_openvr_client::Lease,
}

// The tables are used from one thread at a time, behind the engine's lock.
unsafe impl Send for OpenVrSession {}

macro_rules! call {
    ($table:expr, $index:expr, fn($($arg:ty),*) -> $ret:ty, $($value:expr),*) => {{
        let f: unsafe extern "system" fn($($arg),*) -> $ret = unsafe { std::mem::transmute(*$table.add($index)) };
        unsafe { f($($value),*) }
    }};
}

impl OpenVrSession {
    fn check(&self, error: i32, what: &str) -> Result<(), VrError> {
        if error == 0 { Ok(()) } else { Err(VrError(format!("{what}: VROverlayError {error}"))) }
    }

    /// The raw `VRControllerState_t` (8-byte aligned for the 64-bit fields).
    fn controller_bytes(&mut self, device: Device) -> Option<[u64; 8]> {
        if device == INVALID_DEVICE {
            return None;
        }
        let mut state = [0u64; 8];
        let ok = call!(self.system, system::CONTROLLER_STATE, fn(u32, *mut u64, u32) -> bool,
            device, state.as_mut_ptr(), CONTROLLER_STATE_SIZE as u32);
        ok.then_some(state)
    }
}

fn controller_state_of(raw: &[u64; 8]) -> ControllerState {
    let bytes: Vec<u8> = raw.iter().flat_map(|word| word.to_ne_bytes()).collect();
    let u64_at = |i: usize| u64::from_ne_bytes(bytes[i..i + 8].try_into().expect("8 bytes"));
    let f32_at = |i: usize| f32::from_ne_bytes(bytes[i..i + 4].try_into().expect("4 bytes"));
    ControllerState {
        pressed: u64_at(CONTROLLER_PRESSED_AT),
        axis: (f64::from(f32_at(CONTROLLER_AXIS_AT)), f64::from(f32_at(CONTROLLER_AXIS_AT + 4))),
    }
}

impl Session for OpenVrSession {
    fn create_overlay(&mut self, key: &str, name: &str) -> Result<Handle, VrError> {
        let (key, name) = (CString::new(key).unwrap(), CString::new(name).unwrap());
        let mut handle: u64 = 0;
        let error = call!(self.overlay, overlay::CREATE, fn(*const c_char, *const c_char, *mut u64) -> i32, key.as_ptr(), name.as_ptr(), &mut handle);
        self.check(error, "createOverlay")?;
        Ok(handle)
    }

    fn destroy_overlay(&mut self, handle: Handle) -> Result<(), VrError> {
        let error = call!(self.overlay, overlay::DESTROY, fn(u64) -> i32, handle);
        self.check(error, "destroyOverlay")
    }

    fn set_raw(&mut self, handle: Handle, rgba: &[u8], width: u32, height: u32) -> Result<(), VrError> {
        let error = call!(self.overlay, overlay::SET_RAW, fn(u64, *mut c_void, u32, u32, u32) -> i32,
            handle, rgba.as_ptr() as *mut c_void, width, height, 4);
        self.check(error, "setOverlayRaw")
    }

    fn set_shared_texture(&mut self, slot: TextureSlot, overlays: &[Handle], bgra: &[u8], width: u32, height: u32, texture: (u32, u32))
    -> Result<(u32, u32), VrError> {
        #[cfg(windows)]
        {
            let size = (texture.0.max(width), texture.1.max(height));
            let held = &mut self.textures[slot as usize];
            if held.as_ref().is_none_or(|t| t.size.0 < width || t.size.1 < height) {
                *held = Some(d3d::SharedTexture::new(size)?);
            }
            let shared = held.as_ref().expect("made above");
            shared.upload(bgra, width, height)?;
            let size = shared.size;
            let texture = Texture { handle: shared.raw(), kind: TEXTURE_DIRECTX, color_space: COLOR_SPACE_AUTO };
            for handle in overlays {
                let error = call!(self.overlay, overlay::SET_TEXTURE, fn(u64, *const Texture) -> i32, *handle, &texture);
                self.check(error, "setOverlayTexture")?;
            }
            Ok(size)
        }
        #[cfg(not(windows))]
        {
            // No GPU texture here yet: the picture goes to each overlay as raw pixels.
            let _ = (slot, texture, TEXTURE_DIRECTX, COLOR_SPACE_AUTO);
            let mut rgba = bgra[..(width * height * 4) as usize].to_vec();
            for pixel in rgba.chunks_exact_mut(4) {
                pixel.swap(0, 2);
            }
            for handle in overlays {
                self.set_raw(*handle, &rgba, width, height)?;
            }
            Ok((width, height))
        }
    }

    fn set_alpha(&mut self, handle: Handle, alpha: f32) -> Result<(), VrError> {
        let error = call!(self.overlay, overlay::SET_ALPHA, fn(u64, f32) -> i32, handle, alpha);
        self.check(error, "setOverlayAlpha")
    }

    fn set_color(&mut self, handle: Handle, rgb: [f32; 3]) -> Result<(), VrError> {
        let error = call!(self.overlay, overlay::SET_COLOR, fn(u64, f32, f32, f32) -> i32, handle, rgb[0], rgb[1], rgb[2]);
        self.check(error, "setOverlayColor")
    }

    fn set_width(&mut self, handle: Handle, metres: f32) -> Result<(), VrError> {
        let error = call!(self.overlay, overlay::SET_WIDTH, fn(u64, f32) -> i32, handle, metres);
        self.check(error, "setOverlayWidthInMeters")
    }

    fn set_sort_order(&mut self, handle: Handle, order: u32) -> Result<(), VrError> {
        let error = call!(self.overlay, overlay::SET_SORT_ORDER, fn(u64, u32) -> i32, handle, order);
        self.check(error, "setOverlaySortOrder")
    }

    fn set_texture_bounds(&mut self, handle: Handle, bounds: [f32; 4]) -> Result<(), VrError> {
        let error = call!(self.overlay, overlay::SET_TEXTURE_BOUNDS, fn(u64, *const [f32; 4]) -> i32, handle, &bounds);
        self.check(error, "setOverlayTextureBounds")
    }

    fn set_transform_absolute(&mut self, handle: Handle, pose: &Mat34) -> Result<(), VrError> {
        let m = matrix(pose);
        let error = call!(self.overlay, overlay::SET_TRANSFORM_ABSOLUTE, fn(u64, i32, *const Matrix34) -> i32, handle, UNIVERSE_STANDING, &m);
        self.check(error, "setOverlayTransformAbsolute")
    }

    fn set_transform_relative(&mut self, handle: Handle, device: Device, pose: &Mat34) -> Result<(), VrError> {
        let m = matrix(pose);
        let error = call!(self.overlay, overlay::SET_TRANSFORM_RELATIVE, fn(u64, u32, *const Matrix34) -> i32, handle, device, &m);
        self.check(error, "setOverlayTransformTrackedDeviceRelative")
    }

    fn show(&mut self, handle: Handle) -> Result<(), VrError> {
        let error = call!(self.overlay, overlay::SHOW, fn(u64) -> i32, handle);
        self.check(error, "showOverlay")
    }

    fn hide(&mut self, handle: Handle) -> Result<(), VrError> {
        let error = call!(self.overlay, overlay::HIDE, fn(u64) -> i32, handle);
        self.check(error, "hideOverlay")
    }

    fn quit_requested(&mut self) -> bool {
        let mut event = [0u8; 64];
        let mut quit = false;
        for _ in 0..256 {
            let more = call!(self.system, system::POLL_NEXT_EVENT, fn(*mut u8, u32) -> bool, event.as_mut_ptr(), EVENT_SIZE as u32);
            if !more {
                break;
            }
            if u32::from_ne_bytes([event[0], event[1], event[2], event[3]]) == EVENT_QUIT {
                quit = true;
            }
        }
        if quit {
            // The OCR capture lets go too, so the next connection is a fresh one.
            self.lease.end_connection();
        }
        quit
    }

    fn hand(&mut self, hand: Hand) -> Device {
        let role = if hand == Hand::Left { ROLE_LEFT } else { ROLE_RIGHT };
        call!(self.system, system::INDEX_FOR_CONTROLLER_ROLE, fn(i32) -> u32, role)
    }

    fn connected(&mut self, device: Device) -> bool {
        if device == INVALID_DEVICE {
            return false;
        }
        call!(self.system, system::IS_CONNECTED, fn(u32) -> bool, device)
    }

    fn poses(&mut self) -> Vec<Option<Mat4>> {
        let mut poses = [Pose::default(); MAX_DEVICES];
        call!(self.system, system::DEVICE_TO_ABSOLUTE_TRACKING_POSE, fn(i32, f32, *mut Pose, u32) -> (),
            UNIVERSE_STANDING, 0.0, poses.as_mut_ptr(), MAX_DEVICES as u32);
        poses
            .iter()
            .map(|pose| {
                pose.valid.then(|| {
                    let m = pose.device_to_absolute.m;
                    let mut out = crate::math::IDENTITY;
                    for row in 0..3 {
                        for column in 0..4 {
                            out[row][column] = f64::from(m[row][column]);
                        }
                    }
                    out
                })
            })
            .collect()
    }

    fn headset_worn(&mut self) -> bool {
        let level = call!(self.system, system::ACTIVITY_LEVEL, fn(u32) -> i32, HMD);
        WORN_LEVELS.contains(&level)
    }

    fn scene_application(&mut self) -> Result<Option<SceneApp>, VrError> {
        if self.applications.is_null() {
            return Err(VrError("IVRApplications unavailable".into()));
        }
        let process_id = call!(self.applications, applications::CURRENT_SCENE_PROCESS_ID, fn() -> u32,);
        if process_id == 0 {
            return Ok(None);
        }
        let mut key = [0 as c_char; MAX_APPLICATION_KEY];
        let error = call!(self.applications, applications::KEY_BY_PROCESS_ID, fn(u32, *mut c_char, u32) -> i32,
            process_id, key.as_mut_ptr(), MAX_APPLICATION_KEY as u32);
        if error != 0 {
            // A scene process SteamVR has no manifest for.
            return Ok(None);
        }
        let key = unsafe { CStr::from_ptr(key.as_ptr()) }.to_owned();
        let mut name = vec![0 as c_char; 256];
        loop {
            let mut error = 0i32;
            let needed = call!(self.applications, applications::PROPERTY_STRING,
                fn(*const c_char, i32, *mut c_char, u32, *mut i32) -> u32,
                key.as_ptr(), PROPERTY_NAME, name.as_mut_ptr(), name.len() as u32, &mut error);
            if (needed as usize) > name.len() && name.len() < 65536 {
                name = vec![0 as c_char; needed as usize];
                continue;
            }
            if error != 0 {
                return Err(VrError(format!("getApplicationPropertyString: VRApplicationError {error}")));
            }
            break;
        }
        Ok(Some(SceneApp {
            key: key.to_string_lossy().into_owned(),
            name: unsafe { CStr::from_ptr(name.as_ptr()) }.to_string_lossy().into_owned(),
            process_id,
        }))
    }

    fn controller_state(&mut self, device: Device) -> Option<ControllerState> {
        self.controller_bytes(device).map(|raw| controller_state_of(&raw))
    }

    fn intersect(&mut self, handle: Handle, source: Vec3, direction: Vec3) -> Option<Intersection> {
        let params = IntersectionParams {
            source: source.map(|v| v as f32),
            direction: direction.map(|v| v as f32),
            origin: UNIVERSE_STANDING,
        };
        let mut results = IntersectionResults::default();
        let hit = call!(self.overlay, overlay::COMPUTE_INTERSECTION, fn(u64, *const IntersectionParams, *mut IntersectionResults) -> bool,
            handle, &params, &mut results);
        hit.then(|| Intersection {
            point: results.point.map(f64::from),
            normal: results.normal.map(f64::from),
            uv: (f64::from(results.uv[0]), f64::from(results.uv[1])),
            distance: f64::from(results.distance),
        })
    }

    fn tip_offset(&mut self, device: Device) -> Option<Mat4> {
        let render_models = self.render_models?;
        let mut name = [0u8; 256];
        let mut error = 0i32;
        let length = call!(self.system, system::STRING_PROPERTY, fn(u32, i32, *mut u8, u32, *mut i32) -> u32,
            device, PROP_RENDER_MODEL_NAME, name.as_mut_ptr(), name.len() as u32, &mut error);
        if error != 0 || length <= 1 || length as usize > name.len() {
            return None;
        }
        let state = self.controller_bytes(device)?;
        let tip = CString::new("tip").expect("no NUL");
        let mode = [0u8; 4]; // RenderModel_ControllerMode_State_t { bScrollWheelVisible: false }
        let mut component = ComponentState::default();
        let found = call!(render_models, render_models::COMPONENT_STATE, fn(*const u8, *const c_char, *const u64, *const u8, *mut ComponentState) -> bool,
            name.as_ptr(), tip.as_ptr(), state.as_ptr(), mode.as_ptr(), &mut component);
        let _ = component.tracking_to_render_model;
        let _ = component.properties;
        found.then(|| mat4(&component.tracking_to_local))
    }
}

#[allow(dead_code)]
fn error_name(text: *const c_char) -> String {
    if text.is_null() { String::new() } else { unsafe { CStr::from_ptr(text) }.to_string_lossy().into_owned() }
}

#[cfg(windows)]
mod d3d {
    use super::VrError;
    use std::ffi::c_void;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_BOX, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        D3D11_RESOURCE_MISC_SHARED, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11CreateDevice,
        ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    };
    use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
    use windows::core::Interface;

    /// One BGRA texture the VR panel's overlays share (the Python overlay used OpenGL; Direct3D
    /// needs no window here). It is made big enough for the largest layout and then kept: SteamVR
    /// keeps the first size it was given (`newPanelTexture`).
    pub struct SharedTexture {
        _device: ID3D11Device,
        context: ID3D11DeviceContext,
        texture: ID3D11Texture2D,
        pub size: (u32, u32),
    }

    impl SharedTexture {
        pub fn new(size: (u32, u32)) -> Result<Self, VrError> {
            let fail = |what: &str| VrError(format!("d3d11 {what}"));
            let mut device = None;
            let mut context = None;
            unsafe {
                D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None,
                    D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut context))
                    .map_err(|_| fail("device"))?;
            }
            let (device, context): (ID3D11Device, ID3D11DeviceContext) = (device.ok_or_else(|| fail("device"))?, context.ok_or_else(|| fail("context"))?);
            let description = D3D11_TEXTURE2D_DESC {
                Width: size.0,
                Height: size.1,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: D3D11_RESOURCE_MISC_SHARED.0 as u32,
            };
            let mut texture = None;
            unsafe { device.CreateTexture2D(&description, None, Some(&mut texture)) }.map_err(|_| fail("texture"))?;
            Ok(Self { _device: device, context, texture: texture.ok_or_else(|| fail("texture"))?, size })
        }

        pub fn upload(&self, bgra: &[u8], width: u32, height: u32) -> Result<(), VrError> {
            if bgra.len() < (width * height * 4) as usize {
                return Err(VrError("d3d11 short picture".into()));
            }
            let area = D3D11_BOX { left: 0, top: 0, front: 0, right: width, bottom: height, back: 1 };
            unsafe {
                self.context.UpdateSubresource(&self.texture, 0, Some(&area), bgra.as_ptr() as *const c_void, width * 4, 0);
                self.context.Flush();
            }
            Ok(())
        }

        pub fn raw(&self) -> *mut c_void {
            self.texture.as_raw()
        }
    }
}

#[cfg(not(windows))]
mod d3d {
    pub struct SharedTexture;
}
