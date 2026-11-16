//! SteamVR through the OpenVR C API (`openvr_api`), loaded when the overlay connects.
//!
//! The library is not linked: a build needs no OpenVR SDK, and a machine without it runs
//! everything else. The function tables are those of OpenVR 2.12 (`IVRSystem_023`,
//! `IVROverlay_028`, `IVRApplications_007`), the version the Python sidecar's pyopenvr
//! 2.12.1401 shipped.
//!
//! Where the library is looked for (the first that loads): `VRCT_OPENVR_API`, the folders the
//! host gives, next to the executable, the Python bundle's copy (`_internal/openvr`), then the
//! system's library path. Shipping it with the app is an open decision
//! (`docs/voice-stack/core-integration.md`).

use crate::math::{Mat34, Mat4};
use crate::runtime::{Device, HMD, Hand, Handle, INVALID_DEVICE, MAX_DEVICES, SceneApp, Session, Vr, VrError};
use libloading::Library;
use std::ffi::{CStr, CString, c_char, c_void};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const SYSTEM_VERSION: &str = "FnTable:IVRSystem_023";
const OVERLAY_VERSION: &str = "FnTable:IVROverlay_028";
const APPLICATIONS_VERSION: &str = "FnTable:IVRApplications_007";
/// `k_unMaxApplicationKeyLength`.
const MAX_APPLICATION_KEY: usize = 128;
/// `VRApplicationProperty_Name_String`.
const PROPERTY_NAME: i32 = 0;
const APPLICATION_BACKGROUND: i32 = 3;
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
    pub const POLL_NEXT_EVENT: usize = 29;
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

fn matrix(pose: &Mat34) -> Matrix34 {
    let mut m = Matrix34::default();
    for (row, values) in pose.iter().enumerate() {
        for (column, value) in values.iter().enumerate() {
            m.m[row][column] = *value as f32;
        }
    }
    m
}

type InitInternal2 = unsafe extern "C" fn(*mut i32, i32, *const c_char) -> u32;
type ShutdownInternal = unsafe extern "C" fn();
type GetGenericInterface = unsafe extern "C" fn(*const c_char, *mut i32) -> *mut c_void;

/// The real SteamVR.
pub struct OpenVr {
    folders: Vec<PathBuf>,
    library: Mutex<Option<Arc<Library>>>,
}

impl OpenVr {
    /// `folders` are searched for the library before the defaults.
    pub fn new(folders: Vec<PathBuf>) -> Self {
        Self { folders, library: Mutex::new(None) }
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

    fn library(&self) -> Result<Arc<Library>, VrError> {
        let mut slot = self.library.lock().unwrap();
        if let Some(library) = slot.as_ref() {
            return Ok(Arc::clone(library));
        }
        for candidate in self.candidates() {
            // A bare name goes through the system's search; a path must exist.
            if candidate.components().count() > 1 && !candidate.is_file() {
                continue;
            }
            if let Ok(library) = unsafe { Library::new(&candidate) } {
                let library = Arc::new(library);
                *slot = Some(Arc::clone(&library));
                return Ok(library);
            }
        }
        Err(VrError("openvr_api_not_found".into()))
    }
}

impl Vr for OpenVr {
    fn runtime_running(&self) -> bool {
        crate::process::steamvr_running()
    }

    fn connect(&self) -> Result<Box<dyn Session>, VrError> {
        let library = self.library()?;
        unsafe {
            let init: libloading::Symbol<InitInternal2> =
                library.get(b"VR_InitInternal2\0").map_err(|_| VrError("VR_InitInternal2 missing".into()))?;
            let get: libloading::Symbol<GetGenericInterface> =
                library.get(b"VR_GetGenericInterface\0").map_err(|_| VrError("VR_GetGenericInterface missing".into()))?;
            let shutdown: ShutdownInternal = *library
                .get::<ShutdownInternal>(b"VR_ShutdownInternal\0")
                .map_err(|_| VrError("VR_ShutdownInternal missing".into()))?;
            let mut error = 0i32;
            init(&mut error, APPLICATION_BACKGROUND, std::ptr::null());
            if error != 0 {
                return Err(VrError(format!("VRInitError {error}")));
            }
            let table = |name: &str| -> Result<*const *const c_void, VrError> {
                let name = CString::new(name).expect("no NUL");
                let mut error = 0i32;
                let pointer = get(name.as_ptr(), &mut error);
                if error != 0 || pointer.is_null() {
                    return Err(VrError(format!("interface {} error {error}", name.to_string_lossy())));
                }
                Ok(pointer as *const *const c_void)
            };
            let tables = table(SYSTEM_VERSION).and_then(|system| Ok((system, table(OVERLAY_VERSION)?)));
            let (system, overlay) = match tables {
                Ok(tables) => tables,
                Err(error) => {
                    shutdown();
                    return Err(error);
                }
            };
            // Only the clipboard reads the scene application; the overlays work without it.
            let applications = table(APPLICATIONS_VERSION).unwrap_or(std::ptr::null());
            Ok(Box::new(OpenVrSession { _library: library, shutdown, system, overlay, applications, texture: None }))
        }
    }
}

struct OpenVrSession {
    _library: Arc<Library>,
    shutdown: ShutdownInternal,
    system: *const *const c_void,
    overlay: *const *const c_void,
    /// `IVRApplications`; null when the runtime does not offer this version.
    applications: *const *const c_void,
    texture: Option<d3d::SharedTexture>,
}

// The tables are used from one thread at a time, behind the engine's lock.
unsafe impl Send for OpenVrSession {}

impl Drop for OpenVrSession {
    fn drop(&mut self) {
        self.texture = None;
        unsafe { (self.shutdown)() };
    }
}

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

    fn set_shared_texture(&mut self, overlays: &[Handle], bgra: &[u8], width: u32, height: u32, texture: (u32, u32))
    -> Result<(u32, u32), VrError> {
        #[cfg(windows)]
        {
            let size = (texture.0.max(width), texture.1.max(height));
            if self.texture.as_ref().is_none_or(|t| t.size.0 < width || t.size.1 < height) {
                self.texture = Some(d3d::SharedTexture::new(size)?);
            }
            let shared = self.texture.as_ref().expect("made above");
            shared.upload(bgra, width, height)?;
            let texture = Texture { handle: shared.raw(), kind: TEXTURE_DIRECTX, color_space: COLOR_SPACE_AUTO };
            for handle in overlays {
                let error = call!(self.overlay, overlay::SET_TEXTURE, fn(u64, *const Texture) -> i32, *handle, &texture);
                self.check(error, "setOverlayTexture")?;
            }
            Ok(shared.size)
        }
        #[cfg(not(windows))]
        {
            // No GPU texture here yet: the picture goes to each overlay as raw pixels.
            let _ = (texture, TEXTURE_DIRECTX, COLOR_SPACE_AUTO);
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
