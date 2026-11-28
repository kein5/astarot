//! Screen sharing uses a separately consented source. A worker retains only the selected
//! capture and drops its frames on stop. No capture output is passed to logging or IPC.

use super::{BgrImage, Core, State, invalid, ok};
use super::{Builder, OPEN};
use crate::protocol::Reply;
use astarot_ocr_runtime::capture::{Platform, VrCapture, WindowCapture};
use astarot_ocr_runtime::cv::Interpolation;
use astarot_talk_ai::{Talk, protocol::ImageDetail};
use image::{ExtendedColorType, codecs::jpeg::JpegEncoder};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

const WINDOW: &str = "window";
const VR: &str = "vr";
const MONITOR: &str = "monitor";
const JPEG_QUALITY: u8 = 80;

pub trait Reader {
    fn frame(&mut self) -> Result<Option<BgrImage>, &'static str>;
}

/// Opens a locally selected monitor on the screen worker. The stop flag also cancels
/// an outstanding native chooser.
pub type ScreenFactory =
    Arc<dyn Fn(&str, &AtomicBool) -> Result<Box<dyn Reader>, &'static str> + Send + Sync>;

fn open_native_monitor() -> Result<Box<dyn Reader>, &'static str> {
    #[cfg(windows)]
    return Ok(Box::new(NativeMonitor(
        astarot_ocr_runtime::capture::hwnd::MonitorCapture::open()?,
    )));
    #[cfg(target_os = "linux")]
    return Ok(Box::new(NativeMonitor(
        astarot_ocr_runtime::capture::x11::MonitorCapture::open()?,
    )));
    #[cfg(not(any(windows, target_os = "linux")))]
    Err("talk_monitor_unavailable")
}

#[cfg(any(windows, target_os = "linux"))]
struct NativeMonitor(MonitorCapture);
#[cfg(windows)]
use astarot_ocr_runtime::capture::hwnd::MonitorCapture;
#[cfg(target_os = "linux")]
use astarot_ocr_runtime::capture::x11::MonitorCapture;

#[cfg(any(windows, target_os = "linux"))]
impl Reader for NativeMonitor {
    fn frame(&mut self) -> Result<Option<BgrImage>, &'static str> {
        self.0.read().map(Some)
    }
}

enum GameCapture {
    Window(Box<dyn WindowCapture>),
    Vr(Box<dyn VrCapture>),
}

impl Reader for GameCapture {
    fn frame(&mut self) -> Result<Option<BgrImage>, &'static str> {
        match self {
            Self::Window(window) => window.capture().map_err(|_| "talk_window_unavailable"),
            Self::Vr(vr) => Ok(vr.capture()),
        }
    }
}

impl Drop for GameCapture {
    fn drop(&mut self) {
        match self {
            Self::Window(window) => window.close(),
            Self::Vr(vr) => vr.close(),
        }
    }
}

/// Keep capture errors out of the process log. The caller receives only fixed status codes.
struct Quiet;
impl astarot_ocr_runtime::failure::Log for Quiet {
    fn info(&self, _: &str) {}
    fn error(&self, _: &str) {}
}

struct Settings {
    interval: Duration,
    edge: usize,
}

impl Settings {
    fn load(core: &Core) -> Self {
        Self {
            interval: Duration::from_millis(
                core.config()
                    .get("TALK_AI_SCREEN_INTERVAL_MS")
                    .as_u64()
                    .unwrap_or(1000),
            ),
            edge: core
                .config()
                .get("TALK_AI_SCREEN_LONG_EDGE")
                .as_u64()
                .unwrap_or(1024) as usize,
        }
    }
}

pub(super) fn detail(core: &Core) -> ImageDetail {
    match core.config().get_str("TALK_AI_SCREEN_DETAIL").as_str() {
        "low" => ImageDetail::Low,
        "high" => ImageDetail::High,
        _ => ImageDetail::Auto,
    }
}

pub(super) struct Screen {
    source: &'static str,
    stopped: AtomicBool,
    sending: AtomicBool,
}

impl Screen {
    pub(super) fn source(&self) -> &'static str {
        self.source
    }

    pub(super) fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }

    pub(super) fn sending(&self) -> bool {
        self.sending.load(Ordering::Acquire) && !self.stopped.load(Ordering::Acquire)
    }
}

fn start(core: &Arc<Core>, data: &Value) -> Reply {
    let session = core.talk_ai.lock().unwrap();
    let (Some(state), Some(talk)) = (&session.state, &session.talk) else {
        return Reply::conflict("talk_not_ready");
    };
    let mut current = state.lock().unwrap();
    if current.phase != "ready" || data["session_id"].as_u64() != Some(current.id) {
        return Reply::conflict("talk_not_ready");
    }
    if current.local {
        return Reply::conflict("talk_vision_unavailable");
    }
    if current.screen.is_some() {
        return Reply::conflict("talk_screen_already_running");
    }
    if data["consent"]["screen"] != true || data["destination"] != core.services().talk_cloud_url {
        return invalid("talk_consent_required");
    }
    if data["indicator_visible"] != true {
        return invalid("talk_indicator_required");
    }
    let source = match data["source"].as_str() {
        Some(WINDOW) => WINDOW,
        Some(VR) => VR,
        Some(MONITOR) => MONITOR,
        _ => return invalid("talk_screen_source_invalid"),
    };
    let screen = Arc::new(Screen {
        source,
        stopped: AtomicBool::new(false),
        sending: AtomicBool::new(false),
    });
    current.screen = Some(Arc::clone(&screen));
    drop(current);
    let weak_talk = Arc::downgrade(talk);
    let worker_state = Arc::clone(state);
    let factory = Arc::clone(&core.services().talk_screen);
    let settings = Settings::load(core);
    let worker = std::thread::Builder::new()
        .name("talk-ai-screen".into())
        .spawn(move || {
            if let Err(code) = send_frames(&screen, &weak_talk, settings, factory)
                && !screen.stopped.load(Ordering::Acquire)
            {
                fail(&worker_state, &weak_talk, code);
            }
        });
    if worker.is_err() {
        fail(state, &Arc::downgrade(talk), "talk_screen_worker");
    }
    ok(session.status())
}

fn fail(state: &Mutex<State>, talk: &Weak<Talk>, code: &'static str) {
    let mut state = state.lock().unwrap();
    state.stop_media();
    state.phase = "failed";
    state.error = Some(code);
    if let Some(talk) = talk.upgrade() {
        talk.cancel();
    }
}

pub fn open_native_screen(source: &str, _: &AtomicBool) -> Result<Box<dyn Reader>, &'static str> {
    if source == MONITOR {
        return open_native_monitor();
    }
    let log = Arc::new(Quiet);
    let clock = Arc::new(astarot_ocr_runtime::failure::MonotonicClock::default());
    let platform = Platform::current("VRChat", log, clock);
    if source == VR {
        let vr = (platform.vr)();
        if !vr.is_available() {
            return Err("talk_vr_unavailable");
        }
        return Ok(Box::new(GameCapture::Vr(vr)));
    }
    let mut window = platform.window;
    if !window.find().unwrap_or(false) {
        return Err("talk_window_unavailable");
    }
    Ok(Box::new(GameCapture::Window(window)))
}

fn send_frames(
    screen: &Screen,
    talk: &Weak<Talk>,
    settings: Settings,
    factory: ScreenFactory,
) -> Result<(), &'static str> {
    if screen.stopped.load(Ordering::Acquire) {
        return Ok(());
    }
    let mut capture = factory(screen.source, &screen.stopped)?;
    let mut next = Instant::now();
    while !screen.stopped.load(Ordering::Acquire) {
        let now = Instant::now();
        if now < next {
            std::thread::sleep((next - now).min(Duration::from_millis(50)));
            continue;
        }
        next = now + settings.interval;
        let frame = capture.frame()?;
        let Some(frame) = frame.filter(|frame| !frame.is_empty()) else {
            screen.sending.store(false, Ordering::Release);
            continue;
        };
        let bytes = jpeg(frame, settings.edge)?;
        if screen.stopped.load(Ordering::Acquire) {
            break;
        }
        let Some(talk) = talk.upgrade() else { break };
        screen
            .sending
            .store(talk.send_image(bytes), Ordering::Release);
    }
    Ok(())
}

fn jpeg(frame: BgrImage, max_edge: usize) -> Result<Vec<u8>, &'static str> {
    let longest = frame.width.max(frame.height);
    let mut frame = if longest > max_edge {
        let width = (frame.width * max_edge / longest).max(1);
        let height = (frame.height * max_edge / longest).max(1);
        frame.resize(width, height, Interpolation::Area)
    } else {
        frame
    };
    for pixel in frame.data.chunks_exact_mut(3) {
        pixel.swap(0, 2);
    }
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY)
        .encode(
            &frame.data,
            frame.width as u32,
            frame.height as u32,
            ExtendedColorType::Rgb8,
        )
        .map_err(|_| "talk_screen_encode_failed")?;
    Ok(bytes)
}

pub(super) fn add(b: &mut Builder<'_>) {
    for (name, key) in [
        ("talk_ai_screen_interval_ms", "TALK_AI_SCREEN_INTERVAL_MS"),
        ("talk_ai_screen_long_edge", "TALK_AI_SCREEN_LONG_EDGE"),
        ("talk_ai_screen_detail", "TALK_AI_SCREEN_DETAIL"),
    ] {
        b.get(&format!("/get/data/{name}"), OPEN, key);
        b.with(&format!("/set/data/{name}"), OPEN, move |core, data| {
            super::store(core, key, data)
        });
    }
    b.with("/get/data/talk_ai_screen_sources", OPEN, |_, _| {
        ok(json!([WINDOW, VR, MONITOR]))
    });
    b.with("/set/enable/talk_ai_screen", OPEN, start);
    b.with("/set/disable/talk_ai_screen", OPEN, |core, data| {
        let mut session = core.talk_ai.lock().unwrap();
        if session.state.as_ref().is_some_and(|state| {
            let state = state.lock().unwrap();
            state.screen.is_some() && data["session_id"].as_u64() == Some(state.id)
        }) {
            // Ending the conversation also revokes every image already in its send queue.
            session.stop();
        }
        ok(session.status())
    });
}
