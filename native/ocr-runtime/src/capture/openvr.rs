//! The headset view from the OpenVR compositor's mirror texture
//! ([`ocr_capture_openvr.py`], [`ocr_capture_d3d11.py`], [`ocr_capture_gl.py`]).
//!
//! Reads the left eye so OCR keeps working while VRChat's desktop window is minimized.
//! Windows reads `GetMirrorTextureD3D11` (the OpenGL variant fails there: SteamVR cannot
//! import its own D3D11 texture into GL, ValveSoftware/openvr#178, #1410). Linux reads
//! `GetMirrorTextureGL` between the shared-texture lock and unlock, with an OpenGL
//! context of its own (EGL, offscreen). The Linux path was only checked against a fake
//! compositor, in Python as here.
//!
//! - The OpenVR client library (`openvr_api`, BSD-3-Clause, Valve) is loaded at run
//!   time: `ASTAROT_OPENVR_API` (or `VRCT_OPENVR_API`) names it, else it is looked for next
//!   to the executable, else by name. Without it there is no headset view.
//! - The connection is the process's one, shared with the VR overlay through
//!   `astarot-openvr-client` ([`acquire`]): `VR_Shutdown` ends it for the whole process, so
//!   only the last holder calls it.
//! - The mirror is acquired once and reused; releasing it every frame makes SteamVR
//!   serve stale frames (ValveSoftware/openvr#1888). Everything is created, read and
//!   released on the OCR worker thread.
//! - Only VRChat's frames are read: while another scene app presents, `capture` gives
//!   nothing so the facade falls back to the desktop window.
//!
//! [`ocr_capture_openvr.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/ocr/ocr_capture_openvr.py
//! [`ocr_capture_d3d11.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/ocr/ocr_capture_d3d11.py
//! [`ocr_capture_gl.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/ocr/ocr_capture_gl.py

use std::ffi::c_void;
use std::sync::Arc;

use super::VrCapture;
use crate::failure::{Clock, Failure, FailureLog, Log};
use crate::image::BgrImage;

/// The interface versions of OpenVR SDK 2.12.14 (what pyopenvr 2.12.1401 used).
pub const COMPOSITOR_VERSION: &str = "IVRCompositor_029";
pub const SYSTEM_VERSION: &str = "IVRSystem_023";
pub const EYE_LEFT: i32 = 0;
/// After a failed start on Linux (an OpenGL context opened and closed) wait this long.
pub const GL_RETRY_SEC: f64 = 30.0;
/// After SteamVR asked applications to quit, connect again no sooner than this.
pub const QUIT_RETRY_SEC: f64 = 10.0;

// Positions in the function tables (openvr_capi.h, SDK 2.12.14), each with the name of the
// function there in pyopenvr. The tests below check every one, on either system: a wrong
// position calls another function without any error (#610).
astarot_openvr_client::fn_table! {
    COMPOSITOR_TABLE = COMPOSITOR_VERSION;
    COMPOSITOR_GET_CURRENT_SCENE_FOCUS_PROCESS = 24 => "getCurrentSceneFocusProcess",
    COMPOSITOR_GET_LAST_FRAME_RENDERER = 25 => "getLastFrameRenderer",
    #[cfg(windows)]
    COMPOSITOR_GET_MIRROR_TEXTURE_D3D11 = 35 => "getMirrorTextureD3D11",
    #[cfg(windows)]
    COMPOSITOR_RELEASE_MIRROR_TEXTURE_D3D11 = 36 => "releaseMirrorTextureD3D11",
    #[cfg(not(windows))]
    COMPOSITOR_GET_MIRROR_TEXTURE_GL = 37 => "getMirrorTextureGL",
    #[cfg(not(windows))]
    COMPOSITOR_RELEASE_SHARED_GL_TEXTURE = 38 => "releaseSharedGLTexture",
    #[cfg(not(windows))]
    COMPOSITOR_LOCK_GL_SHARED_TEXTURE = 39 => "lockGLSharedTextureForAccess",
    #[cfg(not(windows))]
    COMPOSITOR_UNLOCK_GL_SHARED_TEXTURE = 40 => "unlockGLSharedTextureForAccess",
}
astarot_openvr_client::fn_table! {
    SYSTEM_TABLE = SYSTEM_VERSION;
    #[cfg(windows)]
    SYSTEM_GET_DXGI_OUTPUT_INFO = 7 => "getDXGIOutputInfo",
}

fn library_name() -> &'static str {
    if cfg!(windows) {
        "openvr_api.dll"
    } else {
        "libopenvr_api.so"
    }
}

/// Where the OpenVR client library is.
pub fn library_path() -> std::path::PathBuf {
    if let Some(path) = astarot_app_identity::env::OPENVR_API.value_os() {
        return path.into();
    }
    if let Some(beside) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|d| d.join(library_name()))) {
        if beside.is_file() {
            return beside;
        }
    }
    library_name().into()
}

/// The OCR's hold on the process's OpenVR connection, with the tables it reads.
pub struct Session {
    compositor: *const *const c_void,
    #[cfg_attr(not(windows), allow(dead_code))]
    system: *const *const c_void,
    lease: astarot_openvr_client::Lease,
}

// The tables are process-wide and thread-safe in the OpenVR client.
unsafe impl Send for Session {}
unsafe impl Sync for Session {}

/// A hold on the process's OpenVR connection ([`astarot_openvr_client`]), which the VR overlay
/// shares: the first holder initializes OpenVR as a background application (never stealing
/// focus from the scene app), and the last one to let go shuts it down.
pub fn acquire() -> Result<Arc<Session>, Failure> {
    let lease = astarot_openvr_client::acquire(&[library_path()]).map_err(|error| match error {
        astarot_openvr_client::Error::LibraryNotFound | astarot_openvr_client::Error::MissingSymbol(_) => {
            Failure::new("OSError", format!("OpenVR client library: {error}"))
        }
        error => Failure::new("OpenVRError", format!("VR_Init failed ({error})")),
    })?;
    let table = |version: &str| {
        lease
            .interface(&format!("FnTable:{version}"))
            .map_err(|error| Failure::new("OpenVRError", format!("{version} unavailable (error {error})")))
    };
    // A failure drops the lease, which leaves the overlay's connection alone.
    let compositor = table(COMPOSITOR_VERSION)?;
    let system = table(SYSTEM_VERSION)?;
    Ok(Arc::new(Session { compositor, system, lease }))
}

impl Session {
    /// SteamVR asked applications to quit (the overlay read the event): let go.
    fn closing(&self) -> bool {
        self.lease.closing()
    }

    unsafe fn compositor_fn<T: Copy>(&self, index: usize) -> T {
        unsafe {
            let entry = *self.compositor.add(index);
            std::mem::transmute_copy(&entry)
        }
    }

    pub fn last_frame_renderer(&self) -> u32 {
        unsafe { self.compositor_fn::<unsafe extern "system" fn() -> u32>(COMPOSITOR_GET_LAST_FRAME_RENDERER)() }
    }

    pub fn scene_focus_process(&self) -> u32 {
        unsafe { self.compositor_fn::<unsafe extern "system" fn() -> u32>(COMPOSITOR_GET_CURRENT_SCENE_FOCUS_PROCESS)() }
    }
}

/// Reads the mirror texture as BGR, top row first.
///
/// A mirror holds graphics handles that are created, used and released on the OCR worker
/// thread; it is only moved there together with the capture before first use.
trait Mirror: Send {
    fn read(&mut self) -> Result<BgrImage, Failure>;
    fn close(&mut self);
}

/// The headset view of VRChat (`OpenVRMirrorCapture`); never fails, logs boundedly.
pub struct OpenVrMirrorCapture {
    session: Option<Arc<Session>>,
    mirror: Option<Box<dyn Mirror>>,
    retry_at: f64,
    failures: FailureLog,
    clock: Arc<dyn Clock>,
}

impl OpenVrMirrorCapture {
    pub fn new(log: Arc<dyn Log>, clock: Arc<dyn Clock>) -> Self {
        OpenVrMirrorCapture { session: None, mirror: None, retry_at: 0.0, failures: FailureLog::new("OCR OpenVR capture", log, clock.clone()), clock }
    }

    fn init(&mut self) -> bool {
        if self.mirror.is_some() {
            return true;
        }
        if !self.is_available() || self.clock.now() < self.retry_at {
            return false;
        }
        let result = acquire().and_then(|session| {
            self.session = Some(session.clone());
            open_mirror(&session)
        });
        match result {
            Ok(mirror) => {
                self.mirror = Some(mirror);
                true
            }
            Err(failure) => {
                self.failures.failure(&failure);
                self.reset();
                if !cfg!(windows) {
                    self.retry_at = self.clock.now() + GL_RETRY_SEC;
                }
                false
            }
        }
    }

    /// Release the mirror (through the compositor, so first), then the session. The mirror
    /// holds the session too, so dropping it is what lets go of the connection.
    fn reset(&mut self) {
        if let Some(mut mirror) = self.mirror.take() {
            mirror.close();
        }
        self.session = None;
    }

    /// VRChat is what SteamVR presents: the last frame renderer is the scene focus
    /// process, and it is VRChat (checked on hardware with the collection tool).
    fn is_vrchat_scene(&self) -> bool {
        let Some(session) = &self.session else { return false };
        let renderer = session.last_frame_renderer();
        if renderer == 0 || renderer != session.scene_focus_process() {
            return false;
        }
        super::process::process_name_of(renderer) == "vrchat.exe"
    }
}

impl VrCapture for OpenVrMirrorCapture {
    fn is_available(&self) -> bool {
        let library = unsafe { libloading::Library::new(library_path()) }.is_ok();
        library && gl_available()
    }

    fn capture(&mut self) -> Option<BgrImage> {
        self.failures.report(self.clock.now());
        if self.session.as_ref().is_some_and(|session| session.closing()) {
            // SteamVR is quitting: let go so the next connection is a fresh one. Not at once: the
            // quitting vrserver may still accept a connection, and the OCR reads no events, so it
            // would never hear the request to quit and could hold SteamVR up.
            self.reset();
            self.retry_at = self.clock.now() + QUIT_RETRY_SEC;
        }
        if !self.init() {
            return None;
        }
        if !self.is_vrchat_scene() {
            return None;
        }
        match self.mirror.as_mut().expect("initialized").read() {
            Ok(frame) => {
                self.failures.success();
                Some(frame)
            }
            Err(failure) => {
                // The compositor may have gone (SteamVR restarting): start over next time.
                self.failures.failure(&failure);
                self.reset();
                None
            }
        }
    }

    fn failure_active(&self) -> bool {
        self.failures.active()
    }

    fn close(&mut self) {
        self.reset();
        self.failures.reset();
    }
}

impl Drop for OpenVrMirrorCapture {
    fn drop(&mut self) {
        self.reset();
    }
}

// ---- Windows: D3D11 ------------------------------------------------------------------------

#[cfg(windows)]
fn gl_available() -> bool {
    true
}

#[cfg(windows)]
fn open_mirror(session: &Arc<Session>) -> Result<Box<dyn Mirror>, Failure> {
    Ok(Box::new(d3d11::D3D11Mirror::open(session.clone())?))
}

#[cfg(windows)]
mod d3d11 {
    use std::ffi::c_void;
    use std::sync::Arc;

    use windows::core::Interface;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11ShaderResourceView, ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_FLAG, D3D11_MAPPED_SUBRESOURCE,
        D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_SHADER_RESOURCE_VIEW_DESC, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT;
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory, IDXGIFactory};

    use super::{Failure, Mirror, Session, COMPOSITOR_GET_MIRROR_TEXTURE_D3D11, COMPOSITOR_RELEASE_MIRROR_TEXTURE_D3D11, EYE_LEFT, SYSTEM_GET_DXGI_OUTPUT_INFO};
    use crate::image::BgrImage;

    fn hr(operation: &str, error: windows::core::Error) -> Failure {
        Failure::new("RuntimeError", format!("{operation}: HRESULT 0x{:08x}", error.code().0 as u32))
    }

    /// Acquire once, copy to a CPU staging texture every read, release on close.
    pub struct D3D11Mirror {
        session: Arc<Session>,
        srv: *mut c_void,
        device: Option<ID3D11Device>,
        context: ID3D11DeviceContext,
        texture: Option<ID3D11Texture2D>,
        staging: Option<ID3D11Texture2D>,
        width: u32,
        height: u32,
        bgra: bool,
    }

    // See `Mirror`: created, read and released on the worker thread.
    unsafe impl Send for D3D11Mirror {}

    impl D3D11Mirror {
        pub fn open(session: Arc<Session>) -> Result<D3D11Mirror, Failure> {
            unsafe {
                let mut adapter_index = -1i32;
                let get_output: unsafe extern "system" fn(*mut i32) = std::mem::transmute_copy(&*session.system.add(SYSTEM_GET_DXGI_OUTPUT_INFO));
                get_output(&mut adapter_index);
                if adapter_index < 0 {
                    return Err(Failure::new("RuntimeError", "SteamVR did not return a DXGI adapter"));
                }
                let factory: IDXGIFactory = CreateDXGIFactory().map_err(|e| hr("CreateDXGIFactory", e))?;
                let adapter = factory.EnumAdapters(adapter_index as u32).map_err(|e| hr("EnumAdapters", e))?;
                let (mut device, mut context) = (None, None);
                D3D11CreateDevice(&adapter, D3D_DRIVER_TYPE_UNKNOWN, HMODULE::default(), D3D11_CREATE_DEVICE_FLAG(0), None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut context))
                    .map_err(|e| hr("D3D11CreateDevice", e))?;
                let (device, context): (ID3D11Device, ID3D11DeviceContext) = (device.expect("created"), context.expect("created"));
                let get_mirror: unsafe extern "system" fn(i32, *mut c_void, *mut *mut c_void) -> i32 = session.compositor_fn(COMPOSITOR_GET_MIRROR_TEXTURE_D3D11);
                let mut srv: *mut c_void = std::ptr::null_mut();
                let error = get_mirror(EYE_LEFT, device.as_raw(), &mut srv);
                if error != 0 {
                    return Err(Failure::new("RuntimeError", format!("GetMirrorTextureD3D11: OpenVR error {error}")));
                }
                if srv.is_null() {
                    return Err(Failure::new("RuntimeError", "GetMirrorTextureD3D11 returned null"));
                }
                let release = |srv: *mut c_void| {
                    let release: unsafe extern "system" fn(*mut c_void) = session.compositor_fn(COMPOSITOR_RELEASE_MIRROR_TEXTURE_D3D11);
                    release(srv);
                };
                let built = (|| {
                    let view = ID3D11ShaderResourceView::from_raw_borrowed(&srv).ok_or_else(|| Failure::new("RuntimeError", "null view"))?;
                    let resource: ID3D11Resource = view.GetResource().map_err(|e| hr("GetResource", e))?;
                    let texture: ID3D11Texture2D = resource.cast().map_err(|e| hr("QueryInterface", e))?;
                    let mut desc = D3D11_TEXTURE2D_DESC::default();
                    texture.GetDesc(&mut desc);
                    let mut view_desc = D3D11_SHADER_RESOURCE_VIEW_DESC::default();
                    view.GetDesc(&mut view_desc);
                    let (format, view_format) = (desc.Format.0, view_desc.Format.0);
                    // The compositor may expose a TYPELESS resource with a typed view.
                    if ![27, 28, 29, 87, 90, 91].contains(&format) || ![28, 29, 87, 91].contains(&view_format) {
                        return Err(Failure::new("RuntimeError", format!("Unsupported DXGI format: {format}")));
                    }
                    if desc.SampleDesc.Count != 1 || desc.ArraySize != 1 || desc.MipLevels != 1 {
                        return Err(Failure::new("RuntimeError", "expected a single-sample, single-mip 2D texture"));
                    }
                    let staging_desc =
                        D3D11_TEXTURE2D_DESC { Format: DXGI_FORMAT(view_format), Usage: D3D11_USAGE_STAGING, BindFlags: 0, CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32, MiscFlags: 0, ..desc };
                    let mut staging = None;
                    device.CreateTexture2D(&staging_desc, None, Some(&mut staging)).map_err(|e| hr("CreateTexture2D", e))?;
                    Ok((texture, staging.expect("created"), desc.Width, desc.Height, view_format == 87 || view_format == 91))
                })();
                match built {
                    Ok((texture, staging, width, height, bgra)) => {
                        Ok(D3D11Mirror { session: session.clone(), srv, device: Some(device), context, texture: Some(texture), staging: Some(staging), width, height, bgra })
                    }
                    Err(failure) => {
                        release(srv);
                        Err(failure)
                    }
                }
            }
        }
    }

    impl Mirror for D3D11Mirror {
        fn read(&mut self) -> Result<BgrImage, Failure> {
            let (Some(staging), Some(texture)) = (&self.staging, &self.texture) else {
                return Err(Failure::new("RuntimeError", "the mirror was released"));
            };
            unsafe {
                self.context.CopyResource(staging, texture);
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                self.context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).map_err(|e| hr("Map", e))?;
                let (w, h, pitch) = (self.width as usize, self.height as usize, mapped.RowPitch as usize);
                let mut data = Vec::with_capacity(w * h * 3);
                for y in 0..h {
                    let row = std::slice::from_raw_parts((mapped.pData as *const u8).add(y * pitch), w * 4);
                    for px in row.as_chunks::<4>().0 {
                        // D3D's top row is row zero (no vertical flip, unlike GL).
                        if self.bgra {
                            data.extend_from_slice(&px[..3]);
                        } else {
                            data.extend_from_slice(&[px[2], px[1], px[0]]);
                        }
                    }
                }
                self.context.Unmap(staging, 0);
                BgrImage::new(w, h, data).map_err(|e| Failure::new("ValueError", e.to_string()))
            }
        }

        /// Staging copy and texture first, then the mirror through the compositor,
        /// then the device.
        fn close(&mut self) {
            self.staging = None;
            self.texture = None;
            if !self.srv.is_null() {
                unsafe {
                    let release: unsafe extern "system" fn(*mut c_void) = self.session.compositor_fn(COMPOSITOR_RELEASE_MIRROR_TEXTURE_D3D11);
                    release(self.srv);
                }
                self.srv = std::ptr::null_mut();
            }
            self.device = None;
        }
    }
}

// ---- Linux: OpenGL through EGL -------------------------------------------------------------

#[cfg(not(windows))]
fn gl_available() -> bool {
    gl::Egl::load().is_ok()
}

#[cfg(not(windows))]
fn open_mirror(session: &Arc<Session>) -> Result<Box<dyn Mirror>, Failure> {
    Ok(Box::new(gl::GlMirror::open(session.clone())?))
}

#[cfg(not(windows))]
mod gl {
    use std::ffi::c_void;
    use std::sync::Arc;

    use super::{Failure, Mirror, Session, COMPOSITOR_GET_MIRROR_TEXTURE_GL, COMPOSITOR_LOCK_GL_SHARED_TEXTURE, COMPOSITOR_RELEASE_SHARED_GL_TEXTURE, COMPOSITOR_UNLOCK_GL_SHARED_TEXTURE, EYE_LEFT};
    use crate::image::BgrImage;

    const EGL_DEFAULT_DISPLAY: *mut c_void = std::ptr::null_mut();
    const EGL_NO_CONTEXT: *mut c_void = std::ptr::null_mut();
    const EGL_NONE: i32 = 0x3038;
    const EGL_SURFACE_TYPE: i32 = 0x3033;
    const EGL_PBUFFER_BIT: i32 = 0x0001;
    const EGL_RENDERABLE_TYPE: i32 = 0x3040;
    const EGL_OPENGL_BIT: i32 = 0x0008;
    const EGL_WIDTH: i32 = 0x3057;
    const EGL_HEIGHT: i32 = 0x3056;
    const EGL_OPENGL_API: u32 = 0x30A2;
    const GL_TEXTURE_2D: u32 = 0x0DE1;
    const GL_TEXTURE_WIDTH: u32 = 0x1000;
    const GL_TEXTURE_HEIGHT: u32 = 0x1001;
    const GL_PACK_ALIGNMENT: u32 = 0x0D05;
    const GL_RGB: u32 = 0x1907;
    const GL_UNSIGNED_BYTE: u32 = 0x1401;

    type Ptr = *mut c_void;

    /// The EGL entry points used here, from `libEGL.so.1`.
    pub struct Egl {
        _library: libloading::Library,
        get_display: unsafe extern "C" fn(Ptr) -> Ptr,
        initialize: unsafe extern "C" fn(Ptr, *mut i32, *mut i32) -> u32,
        bind_api: unsafe extern "C" fn(u32) -> u32,
        choose_config: unsafe extern "C" fn(Ptr, *const i32, *mut Ptr, i32, *mut i32) -> u32,
        create_pbuffer: unsafe extern "C" fn(Ptr, Ptr, *const i32) -> Ptr,
        create_context: unsafe extern "C" fn(Ptr, Ptr, Ptr, *const i32) -> Ptr,
        make_current: unsafe extern "C" fn(Ptr, Ptr, Ptr, Ptr) -> u32,
        destroy_context: unsafe extern "C" fn(Ptr, Ptr) -> u32,
        destroy_surface: unsafe extern "C" fn(Ptr, Ptr) -> u32,
        terminate: unsafe extern "C" fn(Ptr) -> u32,
        get_proc_address: unsafe extern "C" fn(*const u8) -> Ptr,
    }

    impl Egl {
        pub fn load() -> Result<Egl, Failure> {
            let fail = |e: libloading::Error| Failure::new("OSError", format!("EGL: {e}"));
            unsafe {
                let library = libloading::Library::new("libEGL.so.1").map_err(fail)?;
                macro_rules! sym {
                    ($name:literal) => {
                        *library.get($name).map_err(fail)?
                    };
                }
                Ok(Egl {
                    get_display: sym!(b"eglGetDisplay\0"),
                    initialize: sym!(b"eglInitialize\0"),
                    bind_api: sym!(b"eglBindAPI\0"),
                    choose_config: sym!(b"eglChooseConfig\0"),
                    create_pbuffer: sym!(b"eglCreatePbufferSurface\0"),
                    create_context: sym!(b"eglCreateContext\0"),
                    make_current: sym!(b"eglMakeCurrent\0"),
                    destroy_context: sym!(b"eglDestroyContext\0"),
                    destroy_surface: sym!(b"eglDestroySurface\0"),
                    terminate: sym!(b"eglTerminate\0"),
                    get_proc_address: sym!(b"eglGetProcAddress\0"),
                    _library: library,
                })
            }
        }
    }

    struct GlFns {
        bind_texture: unsafe extern "system" fn(u32, u32),
        get_tex_level_parameteriv: unsafe extern "system" fn(u32, i32, u32, *mut i32),
        pixel_storei: unsafe extern "system" fn(u32, i32),
        get_tex_image: unsafe extern "system" fn(u32, i32, u32, u32, *mut c_void),
    }

    /// Acquire once, read repeatedly between lock and unlock, release on close.
    pub struct GlMirror {
        session: Arc<Session>,
        egl: Egl,
        display: Ptr,
        surface: Ptr,
        context: Ptr,
        gl: GlFns,
        texture: Option<(u32, Ptr)>,
    }

    fn failure(message: &str) -> Failure {
        Failure::new("RuntimeError", message)
    }

    // See `Mirror`: created, read and released on the worker thread.
    unsafe impl Send for GlMirror {}

    impl GlMirror {
        pub fn open(session: Arc<Session>) -> Result<GlMirror, Failure> {
            let egl = Egl::load()?;
            unsafe {
                let display = (egl.get_display)(EGL_DEFAULT_DISPLAY);
                if display.is_null() || (egl.initialize)(display, std::ptr::null_mut(), std::ptr::null_mut()) == 0 {
                    return Err(failure("eglInitialize failed"));
                }
                let mut mirror = GlMirror {
                    session,
                    display,
                    surface: std::ptr::null_mut(),
                    context: std::ptr::null_mut(),
                    gl: GlFns { bind_texture: noop2, get_tex_level_parameteriv: noop4, pixel_storei: noop2i, get_tex_image: noop5 },
                    texture: None,
                    egl,
                };
                mirror.start().inspect_err(|_| mirror.close())?;
                Ok(mirror)
            }
        }

        unsafe fn start(&mut self) -> Result<(), Failure> {
            unsafe {
                let egl = &self.egl;
                if (egl.bind_api)(EGL_OPENGL_API) == 0 {
                    return Err(failure("eglBindAPI(OpenGL) failed"));
                }
                let attributes = [EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE];
                let (mut config, mut count) = (std::ptr::null_mut(), 0);
                if (egl.choose_config)(self.display, attributes.as_ptr(), &mut config, 1, &mut count) == 0 || count < 1 {
                    return Err(failure("no EGL configuration for an OpenGL pbuffer"));
                }
                self.surface = (egl.create_pbuffer)(self.display, config, [EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE].as_ptr());
                self.context = (egl.create_context)(self.display, config, EGL_NO_CONTEXT, [EGL_NONE].as_ptr());
                if self.surface.is_null() || self.context.is_null() || (egl.make_current)(self.display, self.surface, self.surface, self.context) == 0 {
                    return Err(failure("could not make an OpenGL context current"));
                }
                let proc = |name: &[u8]| -> Result<Ptr, Failure> {
                    let p = (egl.get_proc_address)(name.as_ptr());
                    if p.is_null() {
                        Err(failure("missing OpenGL function"))
                    } else {
                        Ok(p)
                    }
                };
                self.gl = GlFns {
                    bind_texture: std::mem::transmute::<Ptr, unsafe extern "system" fn(u32, u32)>(proc(b"glBindTexture\0")?),
                    get_tex_level_parameteriv: std::mem::transmute::<Ptr, unsafe extern "system" fn(u32, i32, u32, *mut i32)>(proc(b"glGetTexLevelParameteriv\0")?),
                    pixel_storei: std::mem::transmute::<Ptr, unsafe extern "system" fn(u32, i32)>(proc(b"glPixelStorei\0")?),
                    get_tex_image: std::mem::transmute::<Ptr, unsafe extern "system" fn(u32, i32, u32, u32, *mut c_void)>(proc(b"glGetTexImage\0")?),
                };
                let get_mirror: unsafe extern "system" fn(i32, *mut u32, *mut Ptr) -> i32 = self.session.compositor_fn(COMPOSITOR_GET_MIRROR_TEXTURE_GL);
                let (mut texture, mut handle) = (0u32, std::ptr::null_mut());
                let error = get_mirror(EYE_LEFT, &mut texture, &mut handle);
                if error != 0 {
                    return Err(Failure::new("RuntimeError", format!("GetMirrorTextureGL: OpenVR error {error}")));
                }
                self.texture = Some((texture, handle));
                Ok(())
            }
        }
    }

    unsafe extern "system" fn noop2(_: u32, _: u32) {}
    unsafe extern "system" fn noop2i(_: u32, _: i32) {}
    unsafe extern "system" fn noop4(_: u32, _: i32, _: u32, _: *mut i32) {}
    unsafe extern "system" fn noop5(_: u32, _: i32, _: u32, _: u32, _: *mut c_void) {}

    impl Mirror for GlMirror {
        fn read(&mut self) -> Result<BgrImage, Failure> {
            let (texture, handle) = self.texture.ok_or_else(|| failure("no mirror texture"))?;
            unsafe {
                (self.egl.make_current)(self.display, self.surface, self.surface, self.context);
                let lock: unsafe extern "system" fn(Ptr) = self.session.compositor_fn(COMPOSITOR_LOCK_GL_SHARED_TEXTURE);
                let unlock: unsafe extern "system" fn(Ptr) = self.session.compositor_fn(COMPOSITOR_UNLOCK_GL_SHARED_TEXTURE);
                lock(handle);
                let result = (|| {
                    (self.gl.bind_texture)(GL_TEXTURE_2D, texture);
                    let (mut width, mut height) = (0, 0);
                    (self.gl.get_tex_level_parameteriv)(GL_TEXTURE_2D, 0, GL_TEXTURE_WIDTH, &mut width);
                    (self.gl.get_tex_level_parameteriv)(GL_TEXTURE_2D, 0, GL_TEXTURE_HEIGHT, &mut height);
                    if width <= 0 || height <= 0 {
                        (self.gl.bind_texture)(GL_TEXTURE_2D, 0);
                        return Err(failure("mirror texture has no size"));
                    }
                    (self.gl.pixel_storei)(GL_PACK_ALIGNMENT, 1);
                    let (w, h) = (width as usize, height as usize);
                    let mut rgb = vec![0u8; w * h * 3];
                    (self.gl.get_tex_image)(GL_TEXTURE_2D, 0, GL_RGB, GL_UNSIGNED_BYTE, rgb.as_mut_ptr().cast());
                    (self.gl.bind_texture)(GL_TEXTURE_2D, 0);
                    Ok((w, h, rgb))
                })();
                unlock(handle);
                let (w, h, rgb) = result?;
                // OpenGL's first row is the bottom of the picture.
                let mut bgr = Vec::with_capacity(w * h * 3);
                for y in (0..h).rev() {
                    for px in rgb[y * w * 3..(y + 1) * w * 3].as_chunks::<3>().0 {
                        bgr.extend_from_slice(&[px[2], px[1], px[0]]);
                    }
                }
                BgrImage::new(w, h, bgr).map_err(|e| Failure::new("ValueError", e.to_string()))
            }
        }

        fn close(&mut self) {
            unsafe {
                if let Some((texture, handle)) = self.texture.take() {
                    (self.egl.make_current)(self.display, self.surface, self.surface, self.context);
                    let release: unsafe extern "system" fn(u32, Ptr) -> bool = self.session.compositor_fn(COMPOSITOR_RELEASE_SHARED_GL_TEXTURE);
                    release(texture, handle);
                }
                (self.egl.make_current)(self.display, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut());
                if !self.context.is_null() {
                    (self.egl.destroy_context)(self.display, self.context);
                    self.context = std::ptr::null_mut();
                }
                if !self.surface.is_null() {
                    (self.egl.destroy_surface)(self.display, self.surface);
                    self.surface = std::ptr::null_mut();
                }
                if !self.display.is_null() {
                    (self.egl.terminate)(self.display);
                    self.display = std::ptr::null_mut();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The names of `interface`'s functions in table order, from pyopenvr 2.12.1401.
    fn reference(interface: &str) -> Vec<String> {
        let tables: serde_json::Value = serde_json::from_str(astarot_openvr_client::REFERENCE_FN_TABLES).unwrap();
        let names = tables["tables"][interface]
            .as_array()
            .unwrap_or_else(|| panic!("no {interface} in the reference: add it to native/openvr-client/reference/dump_reference.py"));
        names.iter().map(|name| name.as_str().unwrap().to_owned()).collect()
    }

    #[test]
    fn every_position_called_holds_the_function_meant() {
        for table in [COMPOSITOR_TABLE, SYSTEM_TABLE] {
            let wrong = table.mismatches(&reference(table.interface));
            assert!(wrong.is_empty(), "{wrong:#?}");
        }
    }
}
