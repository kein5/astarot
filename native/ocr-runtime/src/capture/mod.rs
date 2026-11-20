//! Reading VRChat's picture ([`ocr_capture.py`] and the backends).
//!
//! The desktop window is read through PrintWindow on Windows ([`hwnd`]) and through
//! X11/XWayland on Linux ([`x11`]). While SteamVR runs, the headset view is read from
//! the OpenVR compositor's mirror ([`openvr`]); when that gives nothing (VRChat is not
//! the scene, or the read failed) the desktop window is read until the next check. On
//! Linux, a window the user shares through the desktop's ScreenCast portal ([`portal`])
//! is read instead of the one found by name for as long as it is shared.
//!
//! [`OcrCapture::get`] never fails: failures are logged (boundedly) and give `None`.
//!
//! [`ocr_capture.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/ocr/ocr_capture.py

pub mod openvr;
pub mod portal;
pub mod process;

#[cfg(windows)]
pub mod hwnd;
#[cfg(target_os = "linux")]
pub mod x11;

use std::sync::Arc;

use crate::detection::Surface;
use crate::failure::{Clock, Failure, FailureLog, Log};
use crate::image::BgrImage;
use crate::pipeline::{CaptureStatus, FrameSource};

/// Seconds between checks for SteamVR.
pub const STEAMVR_RECHECK_INTERVAL_SEC: f64 = 5.0;

/// The backends, by the names the Python facade reported.
pub const BACKEND_HWND: &str = "hwnd";
pub const BACKEND_X11: &str = "x11";
pub const BACKEND_PORTAL: &str = "portal";
pub const BACKEND_OPENVR: &str = "openvr_mirror";
pub const BACKEND_NONE: &str = "none";

/// True when a frame is effectively black or has no signal (a minimized window).
///
/// Every fourth pixel each way: the mean and variance of a whole 2575×1455 frame took
/// 170 ms per tick in Python; the sample keeps it cheap.
pub fn is_frame_blank(frame: Option<&BgrImage>) -> bool {
    let Some(frame) = frame else { return true };
    if frame.is_empty() {
        return true;
    }
    let mut values = Vec::with_capacity(frame.width.div_ceil(4) * frame.height.div_ceil(4) * 3);
    for y in (0..frame.height).step_by(4) {
        for x in (0..frame.width).step_by(4) {
            let p = frame.pixel(x, y);
            values.extend(p.iter().map(|&v| v as f64));
        }
    }
    let n = values.len() as f64;
    let mean = values.iter().sum::<f64>() / n;
    let var = values.iter().map(|v| (v - mean) * (v - mean)).sum::<f64>() / n;
    mean < 3.0 || var < 20.0
}

/// The desktop window backend (HWND or X11).
pub trait WindowCapture: Send {
    fn is_available(&mut self) -> bool;
    /// `Ok(None)`: no window, or nothing to read now. An error is a failed read.
    fn capture(&mut self) -> Result<Option<BgrImage>, Failure>;
    /// Whether a window with the title exists (the start check; reads no pixels).
    fn find(&mut self) -> Result<bool, Failure>;
    /// The backend logged a failure of its own that has not recovered.
    fn failure_active(&self) -> bool {
        false
    }
    fn close(&mut self);
}

/// The headset view (OpenVR mirror).
pub trait VrCapture: Send {
    fn is_available(&self) -> bool;
    /// `None` when VRChat is not the scene or the read failed (logged by the backend).
    fn capture(&mut self) -> Option<BgrImage>;
    fn failure_active(&self) -> bool;
    fn close(&mut self);
}

/// The window shared through the portal.
pub trait SharedWindow: Send {
    fn is_active(&self) -> bool;
    fn capture(&mut self) -> Result<Option<BgrImage>, Failure>;
    fn close(&mut self);
}

impl SharedWindow for portal::SharedWindowCapture {
    fn is_active(&self) -> bool {
        portal::SharedWindowCapture::is_active(self)
    }
    fn capture(&mut self) -> Result<Option<BgrImage>, Failure> {
        portal::SharedWindowCapture::capture(self)
    }
    fn close(&mut self) {
        portal::SharedWindowCapture::close(self)
    }
}

/// Whether the shared window is read, or was and is gone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SharedState {
    Active,
    Ended,
}

/// What the facade is built from; the defaults come from [`Platform::current`].
pub struct Platform {
    pub window_backend: &'static str,
    pub window: Box<dyn WindowCapture>,
    pub shared: Option<Box<dyn SharedWindow>>,
    /// A new headset-view reader (checked with `is_available`).
    pub vr: Box<dyn Fn() -> Box<dyn VrCapture> + Send>,
    pub steamvr_running: Box<dyn Fn() -> bool + Send>,
}

impl Platform {
    /// The backends of this platform for `window_title`.
    pub fn current(window_title: &str, log: Arc<dyn Log>, clock: Arc<dyn Clock>) -> Platform {
        #[cfg(windows)]
        let (window_backend, window): (&'static str, Box<dyn WindowCapture>) = (BACKEND_HWND, Box::new(hwnd::HwndCapture::new(window_title, log.clone(), clock.clone())));
        #[cfg(target_os = "linux")]
        let (window_backend, window): (&'static str, Box<dyn WindowCapture>) = (BACKEND_X11, Box::new(x11::X11WindowCapture::new(window_title)));
        #[cfg(not(any(windows, target_os = "linux")))]
        let (window_backend, window): (&'static str, Box<dyn WindowCapture>) = (BACKEND_NONE, Box::new(NoWindow));
        let _ = window_title;
        let shared: Option<Box<dyn SharedWindow>> = if cfg!(target_os = "linux") { Some(Box::new(portal::SharedWindowCapture::new(None))) } else { None };
        let (vr_log, vr_clock) = (log, clock);
        Platform {
            window_backend,
            window,
            shared,
            vr: Box::new(move || Box::new(openvr::OpenVrMirrorCapture::new(vr_log.clone(), vr_clock.clone())) as Box<dyn VrCapture>),
            steamvr_running: Box::new(|| process::is_process_running(if cfg!(windows) { "vrmonitor.exe" } else { "vrmonitor" })),
        }
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
struct NoWindow;

#[cfg(not(any(windows, target_os = "linux")))]
impl WindowCapture for NoWindow {
    fn is_available(&mut self) -> bool {
        false
    }
    fn capture(&mut self) -> Result<Option<BgrImage>, Failure> {
        Ok(None)
    }
    fn find(&mut self) -> Result<bool, Failure> {
        Ok(false)
    }
    fn close(&mut self) {}
}

/// The capture facade: the current VRChat frame from the best backend (`OcrCapture`).
pub struct OcrCapture {
    window_backend: &'static str,
    window: Box<dyn WindowCapture>,
    shared: Option<Box<dyn SharedWindow>>,
    shared_state: Option<SharedState>,
    new_vr: Box<dyn Fn() -> Box<dyn VrCapture> + Send>,
    steamvr_running: Box<dyn Fn() -> bool + Send>,
    vr: Option<Box<dyn VrCapture>>,
    backend: &'static str,
    /// The backend that actually gave the last frame (logged when it changes).
    source_backend: &'static str,
    frame_source: Option<Surface>,
    /// When the backend was last chosen (`None`: never).
    last_check: Option<f64>,
    clock: Arc<dyn Clock>,
    log: Arc<dyn Log>,
    pub failures: FailureLog,
}

impl OcrCapture {
    pub fn new(platform: Platform, log: Arc<dyn Log>, clock: Arc<dyn Clock>) -> OcrCapture {
        OcrCapture {
            window_backend: platform.window_backend,
            window: platform.window,
            shared: platform.shared,
            shared_state: None,
            new_vr: platform.vr,
            steamvr_running: platform.steamvr_running,
            vr: None,
            backend: BACKEND_NONE,
            source_backend: BACKEND_NONE,
            frame_source: None,
            last_check: None,
            failures: FailureLog::new("OCR capture", log.clone(), clock.clone()),
            clock,
            log,
        }
    }

    /// The facade of this platform for `window_title`.
    pub fn for_window(window_title: &str, log: Arc<dyn Log>, clock: Arc<dyn Clock>) -> OcrCapture {
        OcrCapture::new(Platform::current(window_title, log.clone(), clock.clone()), log, clock)
    }

    pub fn window_backend(&self) -> &'static str {
        self.window_backend
    }

    /// "Active" while a shared window is read, "ended" when it is gone and nothing
    /// found by name replaced it.
    pub fn shared_window(&self) -> Option<SharedState> {
        self.shared_state
    }

    pub fn has_shared_window(&self) -> bool {
        self.shared.is_some()
    }

    fn select_backend(&mut self, force: bool) -> &'static str {
        let now = self.clock.now();
        if !force && self.last_check.is_some_and(|last| now - last < STEAMVR_RECHECK_INTERVAL_SEC) {
            return self.backend;
        }
        self.last_check = Some(now);
        if (self.steamvr_running)() {
            if self.vr.is_none() {
                let candidate = (self.new_vr)();
                if candidate.is_available() {
                    self.vr = Some(candidate);
                }
            }
            if self.vr.as_ref().is_some_and(|vr| vr.is_available()) {
                self.backend = BACKEND_OPENVR;
                return self.backend;
            }
        }
        // Fall back to the desktop window.
        if let Some(mut vr) = self.vr.take() {
            vr.close();
        }
        self.backend = if self.window.is_available() { self.window_backend } else { BACKEND_NONE };
        self.backend
    }

    fn shared_backend(&mut self, backend: &'static str) -> &'static str {
        let shared = self.shared.as_ref().expect("checked");
        if shared.is_active() {
            self.shared_state = Some(SharedState::Active);
            self.backend = BACKEND_PORTAL;
            return self.backend;
        }
        if self.shared_state == Some(SharedState::Active) {
            // It was being read and is gone: the window closed, or sharing stopped.
            self.shared_state = Some(SharedState::Ended);
            self.log.info("OCR capture: the shared window is gone");
        }
        if backend == BACKEND_PORTAL {
            self.backend = if self.window.is_available() { self.window_backend } else { BACKEND_NONE };
            return self.backend;
        }
        backend
    }

    fn note_source(&mut self, backend: &'static str) {
        self.frame_source = Some(if backend == BACKEND_OPENVR { Surface::Vr } else { Surface::Window });
        if self.source_backend != backend {
            self.log.info(&format!("OCR capture backend -> {backend}"));
            self.source_backend = backend;
        }
    }

    fn read(&mut self) -> Result<Option<BgrImage>, Failure> {
        let mut backend = self.select_backend(false);
        if backend == BACKEND_OPENVR {
            if let Some(frame) = self.vr.as_mut().and_then(|vr| vr.capture()) {
                // The compositor only hands out a texture while it presents, so a black
                // frame is a dark scene; only a truly uniform frame is dropped.
                let first = frame.data.first().copied();
                if frame.data.iter().all(|&v| Some(v) == first) {
                    self.frame_source = None;
                    return Ok(None);
                }
                self.note_source(BACKEND_OPENVR);
                self.failures.success();
                return Ok(Some(frame));
            }
            // VRChat is not the scene, or the read failed: read the desktop window
            // until the next check instead of reading nothing.
            self.backend = if self.window.is_available() { self.window_backend } else { BACKEND_NONE };
            backend = self.backend;
        }
        if self.shared.is_some() {
            backend = self.shared_backend(backend);
        }
        if backend == BACKEND_PORTAL {
            let frame = self.shared.as_mut().expect("checked").capture()?;
            // No picture yet, or a minimized window's last black one.
            if is_frame_blank(frame.as_ref()) {
                self.frame_source = None;
                return Ok(None);
            }
            self.note_source(BACKEND_PORTAL);
            self.failures.success();
            return Ok(frame);
        }
        if backend == self.window_backend && backend != BACKEND_NONE {
            let frame = self.window.capture()?;
            // A minimized or covered window keeps returning a stale black buffer.
            if is_frame_blank(frame.as_ref()) {
                if self.shared_state == Some(SharedState::Ended) {
                    return Err(Failure::new("SharedWindowEnded", "The shared window is gone"));
                }
                self.frame_source = None;
                return Ok(None);
            }
            // A window found by name is readable: the lost one is no longer missed.
            self.shared_state = None;
            self.note_source(self.window_backend);
            self.failures.success();
            return Ok(frame);
        }
        if self.shared_state == Some(SharedState::Ended) {
            // Say so instead of waiting for a picture that cannot come.
            return Err(Failure::new("SharedWindowEnded", "The shared window is gone"));
        }
        Ok(None)
    }
}

impl FrameSource for OcrCapture {
    fn get(&mut self) -> Option<BgrImage> {
        self.failures.report(self.clock.now());
        match self.read() {
            Ok(Some(frame)) => Some(frame),
            Ok(None) => {
                self.frame_source = None;
                None
            }
            Err(failure) => {
                self.failures.failure(&failure);
                self.frame_source = None;
                None
            }
        }
    }

    fn backend(&self) -> String {
        self.backend.to_string()
    }

    fn source(&self) -> Option<Surface> {
        self.frame_source
    }

    fn failure_active(&self) -> bool {
        self.failures.active() || self.window.failure_active() || self.vr.as_ref().is_some_and(|vr| vr.failure_active())
    }

    fn shared_window(&self) -> Option<SharedState> {
        self.shared_state
    }

    fn close(&mut self) {
        self.failures.reset();
        self.window.close();
        if let Some(shared) = self.shared.as_mut() {
            shared.close();
        }
        self.shared_state = None;
        if let Some(mut vr) = self.vr.take() {
            vr.close();
        }
        self.backend = BACKEND_NONE;
        self.source_backend = BACKEND_NONE;
        self.frame_source = None;
    }
}

/// Can the window be read right now? Run before the worker starts so the toggle can say
/// why reading cannot begin; opens and closes what it uses, and never asks to share.
pub fn probe_capture(platform: Platform) -> CaptureStatus {
    // The headset view needs no window (VRChat's desktop window may be minimized in VR).
    if (platform.steamvr_running)() && (platform.vr)().is_available() {
        return CaptureStatus::Ok;
    }
    if let Some(shared) = &platform.shared {
        if shared.is_active() {
            return CaptureStatus::Ok;
        }
    }
    let mut window = platform.window;
    let status = if !window.is_available() {
        CaptureStatus::CaptureUnavailable
    } else {
        match window.find() {
            Ok(true) => CaptureStatus::Ok,
            Ok(false) => CaptureStatus::WindowNotFound,
            Err(_) => CaptureStatus::CaptureUnavailable,
        }
    };
    window.close();
    status
}

/// The views that can be read here: the window always, the headset view where the
/// mirror can be read.
pub fn available_capture_sources(log: Arc<dyn Log>, clock: Arc<dyn Clock>) -> Vec<&'static str> {
    if openvr::OpenVrMirrorCapture::new(log, clock).is_available() {
        vec!["window", "vr"]
    } else {
        vec!["window"]
    }
}

/// Opens this platform's facade for a window title (the pipeline's capture factory).
pub fn capture_factory(log: Arc<dyn Log>, clock: Arc<dyn Clock>) -> crate::pipeline::CaptureFactory {
    Arc::new(move |title: &str| Box::new(OcrCapture::for_window(title, log.clone(), clock.clone())) as Box<dyn FrameSource>)
}

/// [`probe_capture`] with this platform's backends.
pub fn probe(window_title: &str, log: Arc<dyn Log>, clock: Arc<dyn Clock>) -> CaptureStatus {
    probe_capture(Platform::current(window_title, log, clock))
}
