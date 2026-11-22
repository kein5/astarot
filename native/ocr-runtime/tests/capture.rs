//! Capture paths without a real window, display or headset: the shared-window frame
//! file, the facade's choice of backend, blank frames and X11 pixel layouts. Ported from
//! src-python/test/test_ocr_capture.py, test_ocr_capture_portal.py,
//! test_ocr_capture_x11.py and the facade part of test_ocr_failure_backoff.py.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use ocr_runtime::capture::portal::{frame_from_pixels, parse_header, SharedWindowCapture};
use ocr_runtime::capture::{is_frame_blank, probe_capture, OcrCapture, Platform, SharedState, SharedWindow, VrCapture, WindowCapture, BACKEND_NONE, BACKEND_OPENVR, BACKEND_PORTAL, BACKEND_X11};
use ocr_runtime::detection::Surface;
use ocr_runtime::failure::{Clock, Failure, Log};
use ocr_runtime::pipeline::{CaptureStatus, FrameSource};
use ocr_runtime::BgrImage;

const INSTANCE: u64 = (4242 << 32) | 1;
const BGRX: u32 = 0;
const BGRA: u32 = 1;
const RGBX: u32 = 2;
const RGBA: u32 = 3;

#[derive(Default)]
struct FakeClock(Mutex<f64>);
impl Clock for FakeClock {
    fn now(&self) -> f64 {
        *self.0.lock().unwrap()
    }
}
impl FakeClock {
    fn advance(&self, seconds: f64) {
        *self.0.lock().unwrap() += seconds;
    }
}

#[derive(Default)]
struct Logs {
    errors: Mutex<Vec<String>>,
    infos: Mutex<Vec<String>>,
}
impl Log for Logs {
    fn error(&self, message: &str) {
        self.errors.lock().unwrap().push(message.into());
    }
    fn info(&self, message: &str) {
        self.infos.lock().unwrap().push(message.into());
    }
}
impl Logs {
    fn count(&self, word: &str) -> usize {
        self.infos.lock().unwrap().iter().filter(|m| m.contains(word)).count()
    }
    fn errors(&self) -> usize {
        self.errors.lock().unwrap().len()
    }
}

/// A picture with enough detail not to count as blank.
fn picture(width: usize, height: usize, seed: u64) -> BgrImage {
    let mut state = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let data = (0..width * height * 3)
        .map(|_| {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (state >> 56) as u8
        })
        .collect();
    BgrImage::new(width, height, data).unwrap()
}

fn header(sequence: u64, instance: u64, width: u32, height: u32, stride: u32, layout: u32, magic: &[u8; 8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(64);
    out.extend_from_slice(magic);
    out.extend_from_slice(&sequence.to_le_bytes());
    out.extend_from_slice(&instance.to_le_bytes());
    for v in [width, height, stride, layout] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&123u64.to_le_bytes());
    out.resize(64, 0);
    out
}

/// What the helper writes: rows `width * 4 + pad` apart, the last one without padding.
fn pixels(bgr: &BgrImage, layout: u32, pad: usize) -> Vec<u8> {
    let mut out = Vec::new();
    for y in 0..bgr.height {
        for x in 0..bgr.width {
            let [b, g, r] = bgr.pixel(x, y);
            if layout == RGBX || layout == RGBA {
                out.extend_from_slice(&[r, g, b, 0x7F]);
            } else {
                out.extend_from_slice(&[b, g, r, 0x7F]);
            }
        }
        if y + 1 < bgr.height {
            out.extend(std::iter::repeat_n(0xEE, pad));
        }
    }
    out
}

fn write(path: &Path, bgr: &BgrImage, layout: u32, pad: usize, sequence: u64, instance: u64) {
    let mut data = header(sequence, instance, bgr.width as u32, bgr.height as u32, (bgr.width * 4 + pad) as u32, layout, b"ASTRSCR1");
    data.extend(pixels(bgr, layout, pad));
    std::fs::write(path, data).unwrap();
}

fn frame_file(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ocr-capture-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("screen-frame")
}

fn alive(_: u64) -> bool {
    true
}

fn dead(_: u64) -> bool {
    false
}

fn shared(path: &Path) -> SharedWindowCapture {
    SharedWindowCapture::new(Some(path.to_path_buf())).with_alive_check(alive)
}

// ---- the frame file ------------------------------------------------------------------

#[test]
fn every_layout_becomes_bgr() {
    let path = frame_file("layouts");
    let bgr = picture(6, 5, 0);
    for layout in [BGRX, BGRA, RGBX, RGBA] {
        write(&path, &bgr, layout, 0, 2, INSTANCE);
        assert_eq!(shared(&path).capture().unwrap(), Some(bgr.clone()), "layout {layout}");
    }
}

#[test]
fn row_padding_is_skipped_and_the_last_row_may_be_short() {
    let path = frame_file("padding");
    let bgr = picture(7, 4, 0);
    write(&path, &bgr, BGRX, 12, 2, INSTANCE);
    assert_eq!(std::fs::metadata(&path).unwrap().len(), 64 + 3 * (7 * 4 + 12) + 7 * 4);
    assert_eq!(shared(&path).capture().unwrap(), Some(bgr));
}

#[test]
fn an_unchanged_frame_is_not_read_again() {
    let path = frame_file("unchanged");
    write(&path, &picture(6, 5, 0), BGRX, 0, 2, INSTANCE);
    let mut capture = shared(&path);
    let first = capture.capture().unwrap();
    // Same sequence, different bytes: the cached frame is returned without reading.
    write(&path, &picture(6, 5, 9), BGRX, 0, 2, INSTANCE);
    assert_eq!(capture.capture().unwrap(), first);
    let newer = picture(6, 5, 1);
    write(&path, &newer, BGRX, 0, 4, INSTANCE);
    assert_eq!(capture.capture().unwrap(), Some(newer));
}

#[test]
fn a_frame_being_replaced_is_never_returned_half_written() {
    let path = frame_file("replaced");
    let bgr = picture(6, 5, 0);
    write(&path, &bgr, BGRX, 0, 2, INSTANCE);
    let mut capture = shared(&path);
    assert_eq!(capture.capture().unwrap(), Some(bgr.clone()));
    write(&path, &picture(6, 5, 2), BGRX, 0, 3, INSTANCE); // odd: being written
    assert_eq!(capture.capture().unwrap(), Some(bgr));
    assert_eq!(shared(&path).capture().unwrap(), None);
}

#[test]
fn no_picture_before_the_first_frame() {
    let path = frame_file("first");
    std::fs::write(&path, header(0, INSTANCE, 0, 0, 0, BGRX, b"ASTRSCR1")).unwrap();
    let mut capture = shared(&path);
    assert!(capture.is_active());
    assert_eq!(capture.capture().unwrap(), None);
}

#[test]
fn the_stream_is_over_when_the_file_says_so_or_is_gone() {
    let path = frame_file("over");
    let mut capture = shared(&path);
    assert!(!capture.is_active());
    assert_eq!(capture.capture().unwrap(), None);
    write(&path, &picture(6, 5, 0), BGRX, 0, 2, INSTANCE);
    assert!(capture.is_active());
    write(&path, &picture(6, 5, 0), BGRX, 0, 2, 0);
    assert!(!capture.is_active());
    assert_eq!(capture.capture().unwrap(), None);
}

#[test]
fn a_file_left_by_a_killed_helper_is_not_a_stream() {
    let path = frame_file("killed");
    write(&path, &picture(6, 5, 0), BGRX, 0, 2, INSTANCE);
    assert!(!SharedWindowCapture::new(Some(path)).with_alive_check(dead).is_active());
    // The helper's process id is the upper half of the instance. The portal's helper runs on
    // Linux only, and the check reads /proc.
    #[cfg(target_os = "linux")]
    assert!(ocr_runtime::capture::portal::writer_alive((std::process::id() as u64) << 32 | 7));
}

#[test]
fn other_files_are_not_frames() {
    let path = frame_file("other");
    let contents: Vec<Vec<u8>> = vec![
        Vec::new(),
        b"ASTRSCR1".to_vec(),
        header(2, INSTANCE, 0, 0, 0, BGRX, b"ASTRVRP1"),
        header(2, INSTANCE, 20000, 10, 80000, BGRX, b"ASTRSCR1"),
        header(2, INSTANCE, 10, 10, 8, BGRX, b"ASTRSCR1"),
        header(2, INSTANCE, 10, 0, 40, BGRX, b"ASTRSCR1"),
    ];
    for content in contents {
        std::fs::write(&path, &content).unwrap();
        let mut capture = shared(&path);
        assert!(!capture.is_active());
        assert_eq!(capture.capture().unwrap(), None);
    }
    assert_eq!(parse_header(b"short"), None);
}

#[test]
fn an_unknown_pixel_layout_is_an_error_not_a_wrong_picture() {
    let path = frame_file("layout9");
    write(&path, &picture(6, 5, 0), 9, 0, 2, INSTANCE);
    assert_eq!(shared(&path).capture().unwrap_err().kind, "SharedWindowError");
    assert_eq!(frame_from_pixels(2, 2, 8, 9, &[0; 16]), None);
    assert_eq!(frame_from_pixels(2, 2, 8, BGRX, &[0; 15]), None);
}

#[test]
fn a_truncated_file_gives_nothing() {
    let path = frame_file("truncated");
    write(&path, &picture(6, 5, 0), BGRX, 0, 2, INSTANCE);
    let mut bytes = std::fs::read(&path).unwrap();
    bytes.pop();
    std::fs::write(&path, bytes).unwrap();
    assert_eq!(shared(&path).capture().unwrap(), None);
}

// ---- the facade -----------------------------------------------------------------------

#[derive(Default)]
struct WindowState {
    available: bool,
    frame: Option<BgrImage>,
    failure: Option<Failure>,
    captures: usize,
    exists: bool,
    closes: usize,
}

struct FakeWindow(Arc<Mutex<WindowState>>);

impl WindowCapture for FakeWindow {
    fn is_available(&mut self) -> bool {
        self.0.lock().unwrap().available
    }
    fn capture(&mut self) -> Result<Option<BgrImage>, Failure> {
        let mut state = self.0.lock().unwrap();
        state.captures += 1;
        match &state.failure {
            Some(failure) => Err(failure.clone()),
            None => Ok(state.frame.clone()),
        }
    }
    fn find(&mut self) -> Result<bool, Failure> {
        Ok(self.0.lock().unwrap().exists)
    }
    fn close(&mut self) {
        self.0.lock().unwrap().closes += 1;
    }
}

#[derive(Default)]
struct VrState {
    available: bool,
    frame: Option<BgrImage>,
    captures: usize,
}

struct FakeVr(Arc<Mutex<VrState>>);

impl VrCapture for FakeVr {
    fn is_available(&self) -> bool {
        self.0.lock().unwrap().available
    }
    fn capture(&mut self) -> Option<BgrImage> {
        let mut state = self.0.lock().unwrap();
        state.captures += 1;
        state.frame.clone()
    }
    fn failure_active(&self) -> bool {
        false
    }
    fn close(&mut self) {}
}

struct Rig {
    window: Arc<Mutex<WindowState>>,
    vr: Arc<Mutex<VrState>>,
    steamvr: Arc<Mutex<bool>>,
    path: PathBuf,
    logs: Arc<Logs>,
    clock: Arc<FakeClock>,
}

impl Rig {
    fn new(name: &str) -> Rig {
        Rig {
            window: Arc::new(Mutex::new(WindowState { available: true, frame: Some(picture(8, 8, 7)), exists: true, ..Default::default() })),
            vr: Arc::new(Mutex::new(VrState::default())),
            steamvr: Arc::new(Mutex::new(false)),
            path: frame_file(name),
            logs: Arc::new(Logs::default()),
            clock: Arc::new(FakeClock::default()),
        }
    }

    fn platform(&self, with_shared: bool) -> Platform {
        let (vr, steamvr) = (self.vr.clone(), self.steamvr.clone());
        Platform {
            window_backend: BACKEND_X11,
            window: Box::new(FakeWindow(self.window.clone())),
            shared: with_shared.then(|| Box::new(shared(&self.path)) as Box<dyn SharedWindow>),
            vr: Box::new(move || Box::new(FakeVr(vr.clone())) as Box<dyn VrCapture>),
            steamvr_running: Box::new(move || *steamvr.lock().unwrap()),
        }
    }

    fn capture(&self) -> OcrCapture {
        OcrCapture::new(self.platform(true), self.logs.clone(), self.clock.clone())
    }

    fn x11_frame(&self) -> BgrImage {
        self.window.lock().unwrap().frame.clone().unwrap()
    }
}

#[test]
fn x11_stays_the_default_and_is_not_disturbed() {
    let rig = Rig::new("default");
    let mut capture = rig.capture();
    assert_eq!(capture.get(), Some(rig.x11_frame()));
    assert_eq!(capture.backend(), BACKEND_X11);
    assert_eq!(capture.source(), Some(Surface::Window));
    assert_eq!(capture.shared_window(), None);
}

#[test]
fn a_shared_window_is_read_instead_of_the_one_found_by_name() {
    let rig = Rig::new("shared");
    let shared_picture = picture(6, 5, 3);
    write(&rig.path, &shared_picture, BGRX, 0, 2, INSTANCE);
    let mut capture = rig.capture();
    assert_eq!(capture.get(), Some(shared_picture));
    assert_eq!(capture.backend(), BACKEND_PORTAL);
    assert_eq!(capture.source(), Some(Surface::Window)); // still the desktop window's region
    assert_eq!(capture.shared_window(), Some(SharedState::Active));
    assert_eq!(rig.window.lock().unwrap().captures, 0);
}

#[test]
fn sharing_started_later_takes_over_at_once() {
    let rig = Rig::new("later");
    let mut capture = rig.capture();
    assert_eq!(capture.get(), Some(rig.x11_frame()));
    let shared_picture = picture(6, 5, 3);
    write(&rig.path, &shared_picture, BGRX, 0, 2, INSTANCE);
    assert_eq!(capture.get(), Some(shared_picture));
    assert_eq!(capture.backend(), BACKEND_PORTAL);
}

#[test]
fn a_shared_window_works_without_any_x11_display() {
    let rig = Rig::new("nodisplay");
    rig.window.lock().unwrap().available = false;
    let mut capture = rig.capture();
    assert_eq!(capture.get(), None);
    assert!(!capture.failure_active());
    let shared_picture = picture(6, 5, 3);
    write(&rig.path, &shared_picture, BGRX, 0, 2, INSTANCE);
    assert_eq!(capture.get(), Some(shared_picture));
}

#[test]
fn no_frame_yet_is_waiting_not_a_failure() {
    let rig = Rig::new("waiting");
    std::fs::write(&rig.path, header(0, INSTANCE, 0, 0, 0, BGRX, b"ASTRSCR1")).unwrap();
    let mut capture = rig.capture();
    assert_eq!(capture.get(), None);
    assert_eq!(capture.source(), None);
    assert_eq!(capture.shared_window(), Some(SharedState::Active));
    assert!(!capture.failure_active());
    assert_eq!(rig.window.lock().unwrap().captures, 0);
}

#[test]
fn when_the_shared_window_goes_a_window_found_by_name_is_read() {
    let rig = Rig::new("goes");
    write(&rig.path, &picture(6, 5, 3), BGRX, 0, 2, INSTANCE);
    let mut capture = rig.capture();
    capture.get();
    std::fs::remove_file(&rig.path).unwrap();
    assert_eq!(capture.get(), Some(rig.x11_frame()));
    assert_eq!(capture.backend(), BACKEND_X11);
    assert_eq!(capture.shared_window(), None);
    assert!(!capture.failure_active());
}

#[test]
fn when_the_shared_window_goes_and_nothing_replaces_it_that_is_a_failure() {
    for available in [true, false] {
        let rig = Rig::new(&format!("nothing-{available}"));
        {
            let mut window = rig.window.lock().unwrap();
            window.available = available;
            window.frame = None; // no window of that name
        }
        let mut capture = rig.capture();
        write(&rig.path, &picture(6, 5, 3), BGRX, 0, 2, INSTANCE);
        assert!(capture.get().is_some());
        write(&rig.path, &picture(6, 5, 3), BGRX, 0, 2, 0);
        for _ in 0..3 {
            assert_eq!(capture.get(), None);
            assert_eq!(capture.source(), None);
            assert_eq!(capture.shared_window(), Some(SharedState::Ended));
            assert!(capture.failure_active());
        }
        assert!(rig.logs.errors.lock().unwrap()[0].contains("SharedWindowEnded"));
    }
}

#[test]
fn sharing_again_ends_the_failure() {
    let rig = Rig::new("again");
    rig.window.lock().unwrap().frame = None;
    write(&rig.path, &picture(6, 5, 3), BGRX, 0, 2, INSTANCE);
    let mut capture = rig.capture();
    capture.get();
    std::fs::remove_file(&rig.path).unwrap();
    assert_eq!(capture.get(), None);
    assert!(capture.failure_active());
    let again = picture(6, 5, 4);
    write(&rig.path, &again, BGRX, 0, 2, (4343 << 32) | 1);
    assert_eq!(capture.get(), Some(again));
    assert_eq!(capture.shared_window(), Some(SharedState::Active));
    assert!(!capture.failure_active());
}

#[test]
fn a_window_that_was_never_shared_is_not_missed() {
    let rig = Rig::new("never");
    rig.window.lock().unwrap().frame = None;
    let mut capture = rig.capture();
    for _ in 0..3 {
        assert_eq!(capture.get(), None);
    }
    assert_eq!(capture.shared_window(), None);
    assert!(!capture.failure_active());
}

#[test]
fn an_unreadable_frame_is_reported_like_other_capture_errors() {
    let rig = Rig::new("unreadable");
    write(&rig.path, &picture(6, 5, 0), 9, 0, 2, INSTANCE);
    let mut capture = rig.capture();
    assert_eq!(capture.get(), None);
    assert!(rig.logs.errors.lock().unwrap()[0].contains("SharedWindowError"));
}

#[test]
fn close_forgets_the_shared_window() {
    let rig = Rig::new("close");
    write(&rig.path, &picture(6, 5, 3), BGRX, 0, 2, INSTANCE);
    let mut capture = rig.capture();
    capture.get();
    capture.close();
    assert_eq!(capture.shared_window(), None);
    assert_eq!(capture.backend(), BACKEND_NONE);
}

#[test]
fn a_platform_without_a_shared_window_never_reads_one() {
    let rig = Rig::new("noshare");
    write(&rig.path, &picture(6, 5, 3), BGRX, 0, 2, INSTANCE);
    let mut capture = OcrCapture::new(rig.platform(false), rig.logs.clone(), rig.clock.clone());
    assert!(!capture.has_shared_window());
    assert_eq!(capture.get(), Some(rig.x11_frame()));
}

#[test]
fn the_probe_accepts_a_shared_window_and_otherwise_asks_the_window() {
    let rig = Rig::new("probe");
    write(&rig.path, &picture(6, 5, 3), BGRX, 0, 2, INSTANCE);
    rig.window.lock().unwrap().available = false;
    assert_eq!(probe_capture(rig.platform(true)), CaptureStatus::Ok);
    std::fs::remove_file(&rig.path).unwrap();
    assert_eq!(probe_capture(rig.platform(true)), CaptureStatus::CaptureUnavailable);
    assert!(rig.window.lock().unwrap().closes >= 1);
    rig.window.lock().unwrap().available = true;
    rig.window.lock().unwrap().exists = false;
    assert_eq!(probe_capture(rig.platform(true)), CaptureStatus::WindowNotFound);
    rig.window.lock().unwrap().exists = true;
    assert_eq!(probe_capture(rig.platform(true)), CaptureStatus::Ok);
    // The headset view needs no window.
    *rig.steamvr.lock().unwrap() = true;
    rig.vr.lock().unwrap().available = true;
    rig.window.lock().unwrap().available = false;
    assert_eq!(probe_capture(rig.platform(true)), CaptureStatus::Ok);
}

#[test]
fn the_vr_frame_is_used_when_available() {
    let rig = Rig::new("vr");
    *rig.steamvr.lock().unwrap() = true;
    let vr = picture(8, 8, 11);
    *rig.vr.lock().unwrap() = VrState { available: true, frame: Some(vr.clone()), captures: 0 };
    let mut capture = rig.capture();
    assert_eq!(capture.get(), Some(vr));
    assert_eq!(capture.backend(), BACKEND_OPENVR);
    assert_eq!(capture.source(), Some(Surface::Vr));
    assert_eq!(rig.window.lock().unwrap().captures, 0);
}

#[test]
fn falls_back_to_the_window_when_vr_gives_nothing_until_the_next_check() {
    let rig = Rig::new("fallback");
    *rig.steamvr.lock().unwrap() = true;
    rig.vr.lock().unwrap().available = true;
    let mut capture = rig.capture();
    assert_eq!(capture.get(), Some(rig.x11_frame()));
    assert_eq!(capture.backend(), BACKEND_X11);
    capture.get(); // no VR retry before the next check
    assert_eq!(rig.vr.lock().unwrap().captures, 1);
    rig.clock.advance(5.0);
    capture.get();
    assert_eq!(rig.vr.lock().unwrap().captures, 2);
}

#[test]
fn only_a_truly_uniform_vr_frame_is_dropped() {
    let rig = Rig::new("uniform");
    *rig.steamvr.lock().unwrap() = true;
    let mut dark = BgrImage::filled(64, 36, 0);
    *rig.vr.lock().unwrap() = VrState { available: true, frame: Some(dark.clone()), captures: 0 };
    assert_eq!(rig.capture().get(), None);
    dark.data[700] = 1; // a night world: one pixel off uniform is still a scene
    rig.vr.lock().unwrap().frame = Some(dark.clone());
    assert_eq!(rig.capture().get(), Some(dark));
}

#[test]
fn backend_failures_are_suppressed_and_only_a_frame_means_recovery() {
    let rig = Rig::new("failures");
    rig.window.lock().unwrap().failure = Some(Failure::new("RuntimeError", "window lookup failed"));
    let mut capture = OcrCapture::new(rig.platform(false), rig.logs.clone(), rig.clock.clone());
    for _ in 0..81 {
        rig.clock.advance(0.75);
        assert_eq!(capture.get(), None);
    }
    assert_eq!(rig.logs.errors(), 1);
    assert_eq!(rig.logs.count("suppressed"), 1);
    rig.window.lock().unwrap().failure = Some(Failure::new("ValueError", "bad frame"));
    capture.get();
    assert_eq!(rig.logs.errors(), 2);
    {
        let mut window = rig.window.lock().unwrap();
        window.failure = None;
        window.frame = None;
    }
    capture.get();
    assert_eq!(rig.logs.count("recovered"), 0);
    rig.window.lock().unwrap().frame = Some(picture(8, 8, 1));
    assert!(capture.get().is_some());
    capture.get();
    assert_eq!(rig.logs.count("recovered"), 1);
    rig.window.lock().unwrap().failure = Some(Failure::new("ValueError", "bad frame"));
    capture.get();
    capture.close();
    rig.clock.advance(5.0);
    capture.get();
    assert_eq!(rig.logs.errors(), 4);
}

#[test]
fn black_and_uniform_frames_are_blank_but_a_dark_scene_with_text_is_not() {
    let black = BgrImage::filled(2575, 1455, 0);
    assert!(is_frame_blank(Some(&black)));
    assert!(is_frame_blank(Some(&BgrImage::filled(2575, 1455, 2))));
    let mut scene = black.clone();
    for y in 500..800 {
        for x in 900..1700 {
            let i = (y * scene.width + x) * 3;
            scene.data[i..i + 3].copy_from_slice(&[255, 255, 255]);
        }
    }
    assert!(!is_frame_blank(Some(&scene)));
    assert!(!is_frame_blank(Some(&picture(2575, 1455, 0))));
    assert!(is_frame_blank(None));
}

// ---- X11 pieces (Linux) ---------------------------------------------------------------------

#[cfg(target_os = "linux")]
mod x11 {
    use ocr_runtime::capture::x11::{frame_from_ximage, window_rank};

    #[test]
    fn pixel_layouts() {
        // BGRX little-endian, the common case, with row padding.
        let data = [10, 20, 30, 0, 40, 50, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(frame_from_ximage(2, 1, 16, 32, 0xFF0000, 0xFF, true, &data).unwrap().data, vec![10, 20, 30, 40, 50, 60]);
        // RGBX is swapped to BGR.
        assert_eq!(frame_from_ximage(1, 1, 4, 32, 0xFF, 0xFF0000, true, &[30, 20, 10, 0]).unwrap().data, vec![10, 20, 30]);
        // Big-endian XRGB.
        assert_eq!(frame_from_ximage(1, 1, 4, 32, 0xFF0000, 0xFF, false, &[0, 30, 20, 10]).unwrap().data, vec![10, 20, 30]);
        // Unsupported layouts give nothing.
        assert!(frame_from_ximage(1, 1, 2, 16, 0xF800, 0x1F, true, &[0, 0]).is_none());
        assert!(frame_from_ximage(2, 1, 4, 32, 0xFF0000, 0xFF, true, &[0; 4]).is_none());
        assert!(frame_from_ximage(1, 1, 4, 32, 0xFF0000, 0xFF, true, &[0]).is_none());
        assert!(frame_from_ximage(1, 1, 4, 32, 0x7C00, 0x1F, true, &[0; 4]).is_none());
    }

    #[test]
    fn exact_title_beats_substring_beats_class_or_process() {
        let none: Vec<String> = Vec::new();
        assert_eq!(window_rank("VRChat", &none, "VRChat"), Some(0));
        assert_eq!(window_rank("VRChat - Discord", &none, "VRChat"), Some(1));
        assert_eq!(window_rank("my vrchat window", &none, "VRChat"), Some(1));
        let proton = vec!["steam_app_438100".to_string(), "vrchat.exe".to_string()];
        assert_eq!(window_rank("", &proton, "VRChat"), Some(2));
        assert_eq!(window_rank("Unity", &["vrchat.exe".to_string()], "VRChat.exe"), Some(2));
        assert_eq!(window_rank("Firefox", &none, "VRChat"), None);
        // The lowest (rank, window id) wins, as Python's min() over the ranked list.
        let ranked = [(1u8, 1u32), (2, 2), (0, 3)];
        assert_eq!(ranked.iter().min().unwrap().1, 3);
    }
}
