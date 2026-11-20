//! Tray companion (experimental feature `tray_companion`, Issue #355, #361).
//!
//! While the user has turned it on in the settings' "Experimental features" page, the app
//! lives in the system tray. The main window is still created: it keeps starting and talking
//! to the backend and keeps driving the desktop caption overlay, as it always does. Around it
//! come a tray icon with a menu, a small control panel for the everyday switches, and a small
//! handle beside the caption overlay that opens the panel. With the feature on, the next launch
//! starts in the tray without showing the main window, and closing the main window hides it.
//!
//! Off (the default), nothing here runs: no tray icon, panel or handle is made and every
//! command but `companion_set` refuses. The main window turns the feature on and off through
//! `companion_set` as the setting changes; at launch, before the backend has answered, the
//! saved setting is read from config.json so that the main window need not flash up.
//!
//! As with the quick chat window, events carry no data: the panel reads the state back
//! through a command that checks its label, and the main window takes the queued actions the
//! same way. Nothing here carries recognized or typed text.
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewUrl,
    WebviewWindow, Window, WindowEvent,
};

pub const PANEL: &str = "companion_panel";
pub const HANDLE: &str = "companion_handle";
const PANEL_TITLE: &str = "ASTAROT Control Panel";
const HANDLE_TITLE: &str = "ASTAROT Hexagram";
/// The panel, in logical px.
const PANEL_SIZE: (f64, f64) = (300.0, 208.0);
/// The hexagram's plate (its outer circle) as the handle page draws it, radius in logical px
/// (views/companion_handle: OPEN_RADIUS × 1.22).
const STAR_PLATE: f64 = 71.0;
/// The window while the hexagram is out, in logical px: beside a left or right edge, and along
/// a top or bottom edge. Half the hexagram shows; the rest is room for a docked label.
const OUT_BESIDE: (f64, f64) = (360.0, 240.0);
const OUT_ALONG: (f64, f64) = (580.0, 250.0);
/// How near the edge the pointer must come to bring the hexagram out, how far beyond its
/// window it may stray, and for how long, before it hides again (logical px).
const HOT_DEPTH: f64 = 14.0;
const STAY_MARGIN: f64 = 18.0;
const HIDE_AFTER: Duration = Duration::from_millis(450);
/// How often the pointer is looked at while the feature is on.
const WATCH_EVERY: Duration = Duration::from_millis(80);
/// How long the pointer stays near the edge before the hexagram comes out (a few looks).
const COME_OUT_AFTER: Duration = Duration::from_millis(160);
/// How far the pointer may move toward or away from the edge and still count as staying
/// (logical px). Resting at the end of the desktop it does not move across the edge at all.
const STAY_STILL: f64 = 4.0;
/// The panel's distance from the hexagram's plate.
const PANEL_GAP: f64 = 10.0;/// A click on the tray icon first takes the focus from the open panel, which hides
/// it; the click that follows must not open it again.
const REOPEN_GUARD: Duration = Duration::from_millis(400);
const MAX_ACTIONS: usize = 8;
const MAX_LABEL: usize = 80;
const MAX_MONITOR_NAME: usize = 256;
/// How often the list of monitors is read again, in rounds of the pointer watch (two seconds).
const DISPLAYS_EVERY: u32 = 25;
const LANGUAGES: [&str; 5] = ["en", "ja", "ko", "zh-Hans", "zh-Hant"];
/// What the panel, the hexagram and the tray may ask the main window to do: a switch to toggle,
/// or (from the hexagram's common settings) the edge it hides at.
const ACTIONS: [&str; 10] = [
    "toggle_mic", "toggle_translation", "toggle_listening", "toggle_ocr", "toggle_tts", "toggle_rvc",
    "edge_right", "edge_left", "edge_top", "edge_bottom",
];

/// The id in the experimental features list (src-ui/logics/configs/experimentalFeatures.ts,
/// src-python/models/experimental_features.py, native/core/src/config/schema.rs).
pub const FEATURE_ID: &str = "tray_companion";

static ENABLED: AtomicBool = AtomicBool::new(false);
/// What the main window last asked for. Turning the feature on takes a moment (two windows are
/// made); a request to turn it off in that moment is kept here and carried out once it is on.
static WANTED: AtomicBool = AtomicBool::new(false);
/// Held while `companion_set` turns the feature on or off.
static SWITCHING: Mutex<()> = Mutex::new(());

/// The feature is on in this run.
pub fn enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

/// Whether the saved settings have the feature on. Anything unreadable counts as off, so a
/// broken or missing file starts the app as usual.
fn saved_on(config: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(config)
        .ok()
        .and_then(|value| value.get("EXPERIMENTAL_FEATURES")?.get(FEATURE_ID)?.as_bool())
        == Some(true)
}

/// At launch: the feature was on when the app last saved its settings in `state_dir`. The
/// feature itself is on only once `install` has made its windows, so a failed start leaves it off.
pub fn starts_in_tray(state_dir: &Path) -> bool {
    let on = std::fs::read_to_string(state_dir.join("config.json")).is_ok_and(|text| saved_on(&text));
    WANTED.store(on, Ordering::SeqCst);
    on
}
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Switch {
    on: bool,
    /// The backend has not confirmed the last change yet.
    #[serde(default)]
    pending: bool,
}

/// The tray menu's words, in the UI language; the main window has the translations.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MenuLabels {
    start: String,
    stop: String,
    panel: String,
    main: String,
    quit: String,
    /// The monitor submenu: its title, the primary monitor, the word before a monitor's number,
    /// and a chosen monitor that is not connected now.
    #[serde(default = "default_monitor_label")]
    monitor: String,
    #[serde(default = "default_primary_label")]
    primary: String,
    #[serde(default = "default_display_label")]
    display: String,
    #[serde(default = "default_missing_label")]
    missing: String,
}

fn default_monitor_label() -> String {
    "Monitor".into()
}
fn default_primary_label() -> String {
    "Primary monitor".into()
}
fn default_display_label() -> String {
    "Display".into()
}
fn default_missing_label() -> String {
    "Monitor not connected".into()
}

/// What the main window reports. Only switches and words of the UI: no captions.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Status {
    /// The backend is running and the switches can be used.
    ready: bool,
    mic: Switch,
    translation: Switch,
    /// The other four main switches, which the handle's hexagram also shows.
    #[serde(default)]
    listening: Switch,
    #[serde(default)]
    ocr: Switch,
    #[serde(default)]
    tts: Switch,
    #[serde(default)]
    rvc: Switch,
    language: String,
    menu: MenuLabels,
    /// The screen edge the hexagram hides at (TRAY_COMPANION_EDGE).
    #[serde(default = "default_edge")]
    edge: String,
    /// The monitor it shows on, by the system's name for it; empty for the primary monitor
    /// (TRAY_COMPANION_MONITOR).
    #[serde(default)]
    monitor: String,
}

fn default_edge() -> String {
    "right".into()
}

impl Default for Status {
    fn default() -> Self {
        Self {
            ready: false,
            mic: Switch::default(),
            translation: Switch::default(),
            listening: Switch::default(),
            ocr: Switch::default(),
            tts: Switch::default(),
            rvc: Switch::default(),
            language: "en".into(),
            edge: default_edge(),
            monitor: String::new(),
            menu: MenuLabels {
                start: "Start recognition".into(),
                stop: "Stop recognition".into(),
                panel: "Open control panel".into(),
                main: "Open ASTAROT".into(),
                quit: "Quit".into(),
                monitor: default_monitor_label(),
                primary: default_primary_label(),
                display: default_display_label(),
                missing: default_missing_label(),
            },
        }
    }
}

fn valid_label(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= MAX_LABEL && !value.chars().any(char::is_control)
}

fn validate(status: &Status) -> Result<(), String> {
    let menu = &status.menu;
    if !LANGUAGES.contains(&status.language.as_str())
        || Edge::parse(&status.edge).is_none()
        || status.monitor.chars().count() > MAX_MONITOR_NAME
        || status.monitor.chars().any(char::is_control)
        || ![&menu.start, &menu.stop, &menu.panel, &menu.main, &menu.quit, &menu.monitor, &menu.primary, &menu.display, &menu.missing]
            .iter()
            .all(|label| valid_label(label))
    {
        return Err("companion_invalid".into());
    }
    Ok(())
}

#[derive(Default)]
struct Inner {
    status: Status,
    actions: VecDeque<String>,
    panel_hidden_at: Option<Instant>,
    tray: Option<tray::Items>,
    /// The hexagram is out: the window's rectangle and the hexagram's centre on the screen,
    /// in physical px, and the centre inside the window in CSS px.
    out: Option<Out>,
    /// Where the hexagram hides, as the main window last reported it.
    edge: Edge,
    /// The monitors connected now, in the order they are numbered (left to right, then top to
    /// bottom), as the watch last read them.
    displays: Vec<Display>,
}

/// A connected monitor: the system's name for it, its work area and size (physical px).
#[derive(Clone, Debug, PartialEq)]
struct Display {
    name: String,
    work: Rect,
    size: (u32, u32),
    scale: f64,
    primary: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Out {
    edge: Edge,
    /// The work area it came out on: when the chosen monitor changes, it goes back in.
    work: Rect,
    rect: Rect,
    centre: (i32, i32),
    local: (f64, f64),
}

#[derive(Default)]
pub struct CompanionState(Mutex<Inner>);

impl CompanionState {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
        self.0.lock().map_err(|_| "companion_unavailable".to_string())
    }
}

/// The main window, for the commands of the tray icon, which is there in every run.
fn from_main(label: &str) -> Result<(), String> {
    if label == "main" { Ok(()) } else { Err("companion_forbidden".into()) }
}

fn sender(label: &str, expected: &[&str]) -> Result<(), String> {
    if !expected.contains(&label) {
        return Err("companion_forbidden".into());
    }
    if !enabled() {
        return Err("companion_off".into());
    }
    Ok(())
}

/// Queues an action for the main window and tells it to take it.
fn request<R: Runtime>(app: &AppHandle<R>, action: &str) -> Result<(), String> {
    let state = app.state::<CompanionState>();
    let mut inner = state.lock()?;
    // `monitor:<name>`: a monitor connected now, or empty for the primary one.
    let monitor_ok = action
        .strip_prefix("monitor:")
        .is_some_and(|name| name.is_empty() || inner.displays.iter().any(|display| display.name == name));
    if !ACTIONS.contains(&action) && !monitor_ok {
        return Err("companion_invalid".into());
    }
    if inner.actions.len() >= MAX_ACTIONS {
        return Err("companion_busy".into());
    }
    inner.actions.push_back(action.into());
    drop(inner);
    app.emit_to("main", "companion-requested", ()).map_err(|error| error.to_string())
}

pub(crate) fn show_main<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("companion_no_main")?;
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())
}

/// Where a popover goes: right-aligned to `right`, above `top` if it fits in the
/// work area, else below `bottom`, and always inside the work area.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Anchor {
    right: f64,
    top: f64,
    bottom: f64,
}

fn place(anchor: Anchor, size: (u32, u32), work: (i32, i32, u32, u32)) -> (i32, i32) {
    let (width, height) = (f64::from(size.0), f64::from(size.1));
    let (left, top) = (f64::from(work.0), f64::from(work.1));
    let (right, bottom) = (left + f64::from(work.2), top + f64::from(work.3));
    let x = (anchor.right - width).clamp(left, (right - width).max(left));
    let above = anchor.top - height;
    let y = if above >= top { above } else { anchor.bottom };
    let y = y.clamp(top, (bottom - height).max(top));
    (x.round() as i32, y.round() as i32)
}

fn build_panel<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<WebviewWindow<R>> {
    crate::webview_environment::window(manager, PANEL, WebviewUrl::App("companion-panel.html".into()))
        .title(PANEL_TITLE)
        .inner_size(PANEL_SIZE.0, PANEL_SIZE.1)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        // Made hidden ahead of time; it must not take the focus from the window in use.
        .focused(false)
        .visible(false)
        .build()
}

/// Opens the panel at `anchor`, or closes it when it is open.
pub(crate) fn toggle_panel<R: Runtime>(app: &AppHandle<R>, anchor: Anchor) -> Result<(), String> {
    toggle_panel_by(app, (anchor.right, anchor.top), move |size, work, _| place(anchor, size, work))
}

/// Opens the panel where `position` puts it on the monitor at `point`, or closes it when it is open.
fn toggle_panel_by<R: Runtime>(
    app: &AppHandle<R>,
    point: (f64, f64),
    position: impl FnOnce((u32, u32), Rect, f64) -> (i32, i32),
) -> Result<(), String> {
    let state = app.state::<CompanionState>();
    let existing = app.get_webview_window(PANEL);
    if let Some(panel) = existing.as_ref().filter(|panel| panel.is_visible().unwrap_or(false)) {
        state.lock()?.panel_hidden_at = Some(Instant::now());
        return panel.hide().map_err(|error| error.to_string());
    }
    if state.lock()?.panel_hidden_at.take().is_some_and(|at| at.elapsed() < REOPEN_GUARD) {
        return Ok(());
    }
    let panel = match existing {
        Some(panel) => panel,
        None => build_panel(app).map_err(|error| error.to_string())?,
    };
    let monitor = app
        .monitor_from_point(point.0, point.1)
        .map_err(|error| error.to_string())?
        .or(app.primary_monitor().map_err(|error| error.to_string())?)
        .ok_or("companion_no_monitor")?;
    let scale = monitor.scale_factor();
    let size = ((PANEL_SIZE.0 * scale).round() as u32, (PANEL_SIZE.1 * scale).round() as u32);
    let work = monitor.work_area();
    let (x, y) = position(size, (work.position.x, work.position.y, work.size.width, work.size.height), scale);
    // Move first: a move to a monitor with another scale makes Windows rescale the window,
    // which would undo a size set before it. Then size it, and place it again at that size.
    let at = PhysicalPosition::new(x, y);
    panel.set_position(at).map_err(|error| error.to_string())?;
    panel.set_size(PhysicalSize::new(size.0, size.1)).map_err(|error| error.to_string())?;
    panel.set_position(at).map_err(|error| error.to_string())?;
    panel.set_always_on_top(true).map_err(|error| error.to_string())?;
    panel.show().map_err(|error| error.to_string())?;
    panel.set_focus().map_err(|error| error.to_string())?;
    panel.emit("companion-opened", ()).map_err(|error| error.to_string())
}

/// A rectangle as (x, y, width, height), in physical px.
type Rect = (i32, i32, u32, u32);

/// The screen edge the hexagram hides at (TRAY_COMPANION_EDGE; the main window reports it).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
enum Edge {
    #[default]
    Right,
    Left,
    Top,
    Bottom,
}

impl Edge {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "right" => Some(Self::Right),
            "left" => Some(Self::Left),
            "top" => Some(Self::Top),
            "bottom" => Some(Self::Bottom),
            _ => None,
        }
    }
}

/// The hexagram's centre while it is out: the middle of the edge of the work area.
fn edge_centre(edge: Edge, work: Rect) -> (i32, i32) {
    let (x, y, width, height) = work;
    let (mid_x, mid_y) = (x + width as i32 / 2, y + height as i32 / 2);
    match edge {
        Edge::Right => (x + width as i32, mid_y),
        Edge::Left => (x, mid_y),
        Edge::Top => (mid_x, y),
        Edge::Bottom => (mid_x, y + height as i32),
    }
}

/// The window while the hexagram is out, and the hexagram's centre inside it (physical px). The
/// centre is on the edge, so half the hexagram shows; the window lies on the screen's side.
fn out_rect(edge: Edge, work: Rect, scale: f64) -> (Rect, (i32, i32)) {
    let (logical_width, logical_height) = match edge {
        Edge::Right | Edge::Left => OUT_BESIDE,
        Edge::Top | Edge::Bottom => OUT_ALONG,
    };
    let (width, height) = ((logical_width * scale).round() as u32, (logical_height * scale).round() as u32);
    let (cx, cy) = edge_centre(edge, work);
    let clamp = |value: i32, start: i32, length: u32, side: u32| value.clamp(start, (start + length as i32 - side as i32).max(start));
    let (x, y) = match edge {
        Edge::Right => (cx - width as i32, clamp(cy - height as i32 / 2, work.1, work.3, height)),
        Edge::Left => (cx, clamp(cy - height as i32 / 2, work.1, work.3, height)),
        Edge::Top => (clamp(cx - width as i32 / 2, work.0, work.2, width), cy),
        Edge::Bottom => (clamp(cx - width as i32 / 2, work.0, work.2, width), cy - height as i32),
    };
    ((x, y, width, height), (cx - x, cy - y))
}

/// The pointer is near enough to the hidden hexagram to bring it out: within a strip along
/// the edge, as wide as the hexagram, a few px deep.
fn near_edge(edge: Edge, work: Rect, scale: f64, cursor: (f64, f64)) -> bool {
    let (cx, cy) = edge_centre(edge, work);
    let (depth, half) = (HOT_DEPTH * scale, (STAR_PLATE + 8.0) * scale);
    let (x, y) = cursor;
    let (left, top) = (f64::from(work.0), f64::from(work.1));
    let (right, bottom) = (left + f64::from(work.2), top + f64::from(work.3));
    match edge {
        Edge::Right => x >= right - depth && x <= right + 1.0 && (y - f64::from(cy)).abs() <= half,
        Edge::Left => x <= left + depth && x >= left - 1.0 && (y - f64::from(cy)).abs() <= half,
        Edge::Top => y <= top + depth && y >= top - 1.0 && (x - f64::from(cx)).abs() <= half,
        Edge::Bottom => y >= bottom - depth && y <= bottom + 1.0 && (x - f64::from(cx)).abs() <= half,
    }
}

/// How far the pointer is from the edge, inward (physical px).
fn depth(edge: Edge, work: Rect, cursor: (f64, f64)) -> f64 {
    let (left, top) = (f64::from(work.0), f64::from(work.1));
    let (right, bottom) = (left + f64::from(work.2), top + f64::from(work.3));
    match edge {
        Edge::Right => right - cursor.0,
        Edge::Left => cursor.0 - left,
        Edge::Top => cursor.1 - top,
        Edge::Bottom => bottom - cursor.1,
    }
}

/// The pointer has stayed near the edge for `COME_OUT_AFTER`, at about the same depth (`near`
/// is its depth, `None` when it is not near). Between two monitors the edge is not the end of
/// the desktop: a pointer passing over it to the other monitor is near for one look or two,
/// and must not bring the hexagram out. One that passes slowly is near for longer, but keeps
/// moving across the strip, so the wait starts again each time it has moved `still` (#563).
fn held_near(near: Option<f64>, since: &mut Option<(Instant, f64)>, now: Instant, still: f64) -> bool {
    let Some(depth) = near else {
        *since = None;
        return false;
    };
    match *since {
        Some((_, anchor)) if (depth - anchor).abs() <= still => {}
        _ => *since = Some((now, depth)),
    }
    since.is_some_and(|(started, _)| now.duration_since(started) >= COME_OUT_AFTER)
}

fn inside(rect: Rect, cursor: (f64, f64), margin: f64) -> bool {
    let (x, y, width, height) = rect;
    let (left, top) = (f64::from(x) - margin, f64::from(y) - margin);
    let (right, bottom) = (f64::from(x) + f64::from(width) + margin, f64::from(y) + f64::from(height) + margin);
    (left..=right).contains(&cursor.0) && (top..=bottom).contains(&cursor.1)
}

/// The panel beside the hexagram, on the screen's side of it, inside the work area.
fn panel_beside(edge: Edge, centre: (i32, i32), plate: f64, size: (u32, u32), work: Rect) -> (i32, i32) {
    let (width, height) = (f64::from(size.0), f64::from(size.1));
    let (cx, cy) = (f64::from(centre.0), f64::from(centre.1));
    let (x, y) = match edge {
        Edge::Right => (cx - plate - width, cy - height / 2.0),
        Edge::Left => (cx + plate, cy - height / 2.0),
        Edge::Top => (cx - width / 2.0, cy + plate),
        Edge::Bottom => (cx - width / 2.0, cy - plate - height),
    };
    let (left, top) = (f64::from(work.0), f64::from(work.1));
    let (right, bottom) = (left + f64::from(work.2), top + f64::from(work.3));
    (
        x.clamp(left, (right - width).max(left)).round() as i32,
        y.clamp(top, (bottom - height).max(top)).round() as i32,
    )
}

fn build_handle<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<WebviewWindow<R>> {
    crate::webview_environment::window(manager, HANDLE, WebviewUrl::App("companion-handle.html".into()))
        .title(HANDLE_TITLE)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        // Clicked, never focused: the game keeps the keyboard.
        .focusable(false)
        .visible(false)
        .build()
}

/// The monitors connected now, numbered left to right, then top to bottom.
fn read_displays(app: &AppHandle) -> Result<Vec<Display>, String> {
    let primary = app.primary_monitor().map_err(|error| error.to_string())?;
    let primary_name = primary.as_ref().and_then(|monitor| monitor.name().cloned());
    let mut displays: Vec<Display> = app
        .available_monitors()
        .map_err(|error| error.to_string())?
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let work = monitor.work_area();
            let name = monitor.name().cloned().unwrap_or_else(|| format!("monitor-{index}"));
            Display {
                primary: primary_name.as_deref() == Some(name.as_str()),
                name,
                work: (work.position.x, work.position.y, work.size.width, work.size.height),
                size: (monitor.size().width, monitor.size().height),
                scale: monitor.scale_factor(),
            }
        })
        .collect();
    displays.sort_by_key(|display| (display.work.0, display.work.1));
    let no_primary = !displays.iter().any(|display| display.primary);
    if let Some(first) = displays.first_mut().filter(|_| no_primary) {
        first.primary = true;
    }
    Ok(displays)
}

/// The monitor the hexagram lives on: the chosen one while it is connected, else the primary.
fn pick<'a>(displays: &'a [Display], wanted: &str) -> Option<&'a Display> {
    displays
        .iter()
        .find(|display| !wanted.is_empty() && display.name == wanted)
        .or_else(|| displays.iter().find(|display| display.primary))
        .or_else(|| displays.first())
}
/// Brings the hexagram out at `edge`: half of it shows over the edge of the screen. The window
/// work is handed to the main thread without waiting for it: a window call made from the
/// watching thread that waits for the main thread could hang there (hiding did).
fn come_out(app: &AppHandle, edge: Edge, work: Rect, scale: f64) -> Result<(), String> {
    let ((x, y, width, height), (cx, cy)) = out_rect(edge, work, scale);
    let out = Out { edge, work, rect: (x, y, width, height), centre: (x + cx, y + cy),
        local: (f64::from(cx) / scale, f64::from(cy) / scale) };
    app.state::<CompanionState>().lock()?.out = Some(out);
    let target = app.clone();
    app.run_on_main_thread(move || {
        let Some(handle) = target.get_webview_window(HANDLE) else { return };
        // Move, size, then move again: a move to a monitor with another scale rescales the window.
        let at = PhysicalPosition::new(x, y);
        let _ = handle.set_position(at);
        let _ = handle.set_size(PhysicalSize::new(width, height));
        let _ = handle.set_position(at);
        let _ = handle.set_always_on_top(true);
        let _ = handle.emit("companion-handle-changed", ());
        #[cfg(target_os = "linux")]
        tauri::async_runtime::spawn(async move {
            if crate::caption_overlay::prepare(&handle).await.is_ok() {
                let _ = crate::caption_overlay::show_without_focus(&handle).await;
            }
        });
        #[cfg(not(target_os = "linux"))]
        let _ = crate::caption_overlay::show_without_focus(&handle);
    })
    .map_err(|error| error.to_string())
}

/// Hides the hexagram at its edge again.
fn go_in(app: &AppHandle) -> Result<(), String> {
    app.state::<CompanionState>().lock()?.out = None;
    let target = app.clone();
    app.run_on_main_thread(move || {
        if let Some(handle) = target.get_webview_window(HANDLE) {
            hide_window(&handle);
            let _ = handle.emit("companion-handle-changed", ());
        }
    })
    .map_err(|error| error.to_string())
}
/// Hides the hexagram's window the way it was shown (caption_overlay::show_without_focus, past
/// Tauri): Tauri's own hide skips a window it does not know is shown.
#[cfg(windows)]
fn hide_window(handle: &WebviewWindow) {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn ShowWindow(window: *mut std::ffi::c_void, command: i32) -> i32;
    }
    const SW_HIDE: i32 = 0;
    if let Ok(window) = handle.hwnd() {
        // SAFETY: the handle is this process's own live window; ShowWindow has no other precondition.
        unsafe { ShowWindow(window.0, SW_HIDE) };
    }
}

#[cfg(target_os = "linux")]
fn hide_window(handle: &WebviewWindow) {
    use gtk::prelude::*;
    if let Ok(window) = handle.gtk_window() {
        window.hide();
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
fn hide_window(handle: &WebviewWindow) {
    let _ = handle.hide();
}

static WATCHING: AtomicBool = AtomicBool::new(false);

/// While the feature is on, looks at the pointer a dozen times a second: near the hexagram's
/// edge it brings the hexagram out; away from it for a moment, it hides it again. Hidden, the
/// hexagram has no window on the screen, so it takes no click from the game.
fn watch(app: AppHandle) {
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let mut away_since: Option<Instant> = None;
        let mut near_since: Option<(Instant, f64)> = None;
        let mut round: u32 = 0;
        while enabled() {
            std::thread::sleep(WATCH_EVERY);
            // The monitors are read again every two seconds; a change rebuilds the tray's list.
            if let Some(displays) = round.is_multiple_of(DISPLAYS_EVERY).then(|| read_displays(&app).ok()).flatten() {
                let changed = app.state::<CompanionState>().lock().is_ok_and(|mut inner| {
                    let changed = inner.displays != displays;
                    inner.displays = displays;
                    changed
                });
                if changed {
                    tray::refresh_monitors(&app);
                }
            }
            round = round.wrapping_add(1);
            let Ok(cursor) = app.cursor_position() else { continue };
            let Ok(inner) = app.state::<CompanionState>().lock().map(|inner| {
                (inner.edge, inner.out, pick(&inner.displays, &inner.status.monitor).map(|display| (display.work, display.scale)))
            }) else { continue };
            let (edge, out, Some((work, scale))) = inner else { continue };
            let cursor = (cursor.x, cursor.y);
            let near = near_edge(edge, work, scale, cursor).then(|| depth(edge, work, cursor));
            let result = match out {
                None if held_near(near, &mut near_since, Instant::now(), STAY_STILL * scale) => {
                    away_since = None;
                    near_since = None;
                    come_out(&app, edge, work, scale)
                }
                None => Ok(()),
                // The edge or the monitor was changed while it was out (or the monitor went away):
                // put it back, to come out at the new place.
                Some(out) if out.edge != edge || out.work != work => go_in(&app),
                Some(out) if inside(out.rect, cursor, STAY_MARGIN * scale) => {
                    away_since = None;
                    Ok(())
                }
                Some(_) => match away_since {
                    Some(since) if since.elapsed() >= HIDE_AFTER => {
                        away_since = None;
                        go_in(&app)
                    }
                    Some(_) => Ok(()),
                    None => {
                        away_since = Some(Instant::now());
                        Ok(())
                    }
                },
            };
            if let Err(error) = result {
                crate::startup_log(&format!("Tray companion hexagram failed: {error}"));
            }
        }        let _ = go_in(&app);
        WATCHING.store(false, Ordering::SeqCst);
        // Turned off and on again before this loop saw it: keep watching.
        if enabled() {
            watch(app);
        }
    });
}

/// The panel closes like a popover: when it loses the focus, or is asked to close.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != PANEL || !enabled() {
        return;
    }
    match event {
        WindowEvent::Focused(false) => {
            if window.is_visible().unwrap_or(false) {
                if let Ok(mut inner) = window.state::<CompanionState>().lock() {
                    inner.panel_hidden_at = Some(Instant::now());
                }
                let _ = window.hide();
            }
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.hide();
        }
        _ => {}
    }
}

/// The app's one tray icon, made at start-up whether or not the overlay feature is on: its menu
/// opens the main window, starts and stops recognition and quits, and while the feature is on it
/// also opens the control panel and chooses the hexagram's monitor. Doing it twice changes nothing.
pub(crate) fn install_tray(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<CompanionState>();
    if state.lock()?.tray.is_none() {
        // On Linux the tray loads libappindicator at run time and panics when it is missing
        // (Issue #420): without it the app starts with no tray icon instead.
        #[cfg(target_os = "linux")]
        if !linux_tray::library_loads() {
            let names: Vec<_> = linux_tray::LIBRARIES.iter().map(|name| name.to_string_lossy()).collect();
            return Err(format!("no appindicator library ({})", names.join(", ")));
        }
        let items = tray::install(app).map_err(|error| error.to_string())?;
        state.lock()?.tray = Some(items);
    }
    Ok(())
}

/// Turns the overlay feature on: the panel and the hexagram's window, made hidden so that the
/// first use shows them at once, and the pointer watch. Doing it twice changes nothing.
pub(crate) fn install(app: &AppHandle) -> Result<(), String> {
    // Without a tray (a desktop with no tray support) the hexagram still works.
    if let Err(error) = install_tray(app) {
        crate::startup_log(&format!("Tray icon could not be made: {error}"));
    }
    if let Err(error) = make_windows(app) {
        // A start that failed half way leaves no window behind: the feature stays off, and
        // turning it off later would find nothing to undo (#563).
        if !enabled() {
            destroy_windows(app);
        }
        return Err(error);
    }
    // Only now: a failed start leaves the feature off for every command.
    ENABLED.store(true, Ordering::SeqCst);
    tray::refresh_feature(app);
    watch(app.clone());
    Ok(())
}

fn make_windows(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(PANEL).is_none() {
        build_panel(app).map_err(|error| error.to_string())?;
    }
    // The hexagram's window is made hidden too; it shows only while the hexagram is out.
    if app.get_webview_window(HANDLE).is_none() {
        build_handle(app).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn destroy_windows(app: &AppHandle) {
    for label in [PANEL, HANDLE] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.destroy();
        }
    }
}

/// At launch with the feature on: whether the main window may stay hidden in the tray. Only a
/// tray icon brings it back for sure, so without one it shows (Issue #455): the hexagram may never
/// come out where the pointer cannot be read (native Wayland). On Linux the icon can be made yet
/// not shown (Issue #422); asking the session bus takes up to two seconds, so the start-up does
/// not wait for the answer, and the main window shows once it says no tray host is there.
pub(crate) fn may_start_hidden(app: &AppHandle) -> bool {
    let has_tray = app.state::<CompanionState>().lock().is_ok_and(|inner| inner.tray.is_some());
    #[cfg(target_os = "linux")]
    if has_tray {
        let app = app.clone();
        let asked = std::thread::Builder::new().name("astarot-tray-at-start".into()).spawn(move || {
            if linux_tray::shown() {
                return;
            }
            crate::startup_log("Tray icon is not shown on this desktop: showing the main window");
            let target = app.clone();
            let shown = app.run_on_main_thread(move || {
                if let Err(error) = show_main(&target) {
                    crate::startup_log(&format!("Main window show failed: {error}"));
                }
            });
            if let Err(error) = shown {
                crate::startup_log(&format!("Main window show failed: {error}"));
            }
        });
        // Without the thread nothing would show it later: show it now.
        return asked.is_ok();
    }
    has_tray
}

/// Turns the overlay feature off: the panel and the hexagram go, the tray icon stays with its
/// overlay items greyed out, and the main window comes back if it was hidden in the tray.
pub(crate) fn uninstall(app: &AppHandle) -> Result<(), String> {
    ENABLED.store(false, Ordering::SeqCst);
    let state = app.state::<CompanionState>();
    {
        let mut inner = state.lock()?;
        inner.panel_hidden_at = None;
        inner.out = None;
    }
    destroy_windows(app);
    tray::refresh_feature(app);
    show_main(app)
}
mod tray {
    use super::{enabled, pick, request, show_main, toggle_panel, Anchor, CompanionState, Status};
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{AppHandle, Emitter, Manager, Wry};

    pub const TRAY: &str = "astarot";

    /// The menu items are handles: a clone changes the same item in the menu.
    #[derive(Clone)]
    pub struct Items {
        toggle: MenuItem<Wry>,
        panel: MenuItem<Wry>,
        main: MenuItem<Wry>,
        quit: MenuItem<Wry>,
        /// Where the hexagram shows: the primary monitor, then each connected one.
        monitors: Submenu<Wry>,
        /// The monitor names behind the submenu's items, in their order ("monitor-<index>").
        names: Vec<String>,
    }

    fn log(result: Result<(), String>, what: &str) {
        if let Err(error) = result {
            crate::startup_log(&format!("Tray {what} failed: {error}"));
        }
    }

    pub fn install(app: &AppHandle) -> tauri::Result<Items> {
        // The main window sends the words in the UI language once the backend is ready.
        let labels = app.state::<CompanionState>().lock().map(|inner| inner.status.menu.clone())
            .unwrap_or_else(|_| Status::default().menu);
        // Until the backend is ready there is nothing to start.
        let toggle = MenuItem::with_id(app, "toggle", &labels.start, false, None::<&str>)?;
        // The overlay's items work only while the overlay feature is on.
        let panel = MenuItem::with_id(app, "panel", &labels.panel, enabled(), None::<&str>)?;
        let main = MenuItem::with_id(app, "main", &labels.main, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", &labels.quit, true, None::<&str>)?;
        let monitors = Submenu::with_id(app, "monitors", &labels.monitor, enabled())?;
        let menu = Menu::with_items(
            app,
            &[&main, &toggle, &PredefinedMenuItem::separator(app)?, &panel, &monitors,
              &PredefinedMenuItem::separator(app)?, &quit],
        )?;
        let mut builder = TrayIconBuilder::with_id(TRAY)
            // The display name (ADR-011); the tray's id (`TRAY`) keeps the internal name.
            .tooltip("ASTAROT")
            .menu(&menu)
            // Left click opens the control panel while the overlay is on, else the main window;
            // the menu is on the right button.
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "toggle" => log(request(app, "toggle_mic"), "toggle"),
                "panel" if enabled() => open_panel_near_cursor(app),
                "main" => log(show_main(app), "main window"),
                "quit" => quit_app(app),
                id if enabled() => choose_monitor(app, id),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    position,
                    ..
                } = event
                {
                    let app = tray.app_handle().clone();
                    if !enabled() {
                        log(show_main(&app), "main window");
                        return;
                    }
                    let anchor = Anchor { right: position.x, top: position.y, bottom: position.y };
                    // Windows can hang when a window is made or shown from inside an
                    // event handler; let the event return first.
                    tauri::async_runtime::spawn(async move { log(toggle_panel(&app, anchor), "panel") });
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(app)?;
        Ok(Items { toggle, panel, main, quit, monitors, names: Vec::new() })
    }

    /// A monitor chosen in the submenu: the main window saves it as TRAY_COMPANION_MONITOR.
    fn choose_monitor(app: &AppHandle, id: &str) {
        let name = if id == "monitor-primary" {
            Some(String::new())
        } else {
            id.strip_prefix("monitor-").and_then(|index| index.parse::<usize>().ok()).and_then(|index| {
                let state = app.state::<CompanionState>();
                let inner = state.lock().ok()?;
                inner.tray.as_ref()?.names.get(index).cloned()
            })
        };
        if let Some(name) = name {
            log(request(app, &format!("monitor:{name}")), "monitor");
        }
    }

    /// Runs `update` on the main thread, which is where the menu is changed (Issue #454). A menu
    /// call made on another thread waits for the main thread, and the main thread's synchronous
    /// commands take the state's lock: a thread that held the lock across a menu call could stop
    /// the whole app. So the menu is changed only on the main thread, and the updates take the
    /// lock just long enough to copy what they need. On the main thread `update` runs at once;
    /// from another thread it is queued and not waited for.
    fn on_main(app: &AppHandle, update: impl FnOnce(&AppHandle) + Send + 'static) {
        let target = app.clone();
        if let Err(error) = app.run_on_main_thread(move || update(&target)) {
            crate::startup_log(&format!("Tray update failed: {error}"));
        }
    }

    /// The tray's items, copied out of the state. The lock is let go before this returns.
    fn items(app: &AppHandle) -> Option<Items> {
        app.state::<CompanionState>().lock().ok()?.tray.clone()
    }

    /// Rebuilds the monitor submenu: the primary monitor, each connected one, and the chosen one
    /// while it is not connected. The one the hexagram uses is checked.
    pub fn refresh_monitors(app: &AppHandle) {
        on_main(app, |app| {
            let (monitors, wanted, labels, displays) = {
                let state = app.state::<CompanionState>();
                let Ok(mut inner) = state.lock() else { return };
                let names = inner.displays.iter().map(|display| display.name.clone()).collect();
                let Some(items) = inner.tray.as_mut() else { return };
                // The names behind the items made below: a click reads them by the item's index.
                items.names = names;
                let monitors = items.monitors.clone();
                (monitors, inner.status.monitor.clone(), inner.status.menu.clone(), inner.displays.clone())
            };
            let using = pick(&displays, &wanted).map(|display| display.name.clone());
            if let Ok(old) = monitors.items() {
                for item in old {
                    let _ = monitors.remove(&item);
                }
            }
            let _ = CheckMenuItem::with_id(app, "monitor-primary", &labels.primary, true, wanted.is_empty(), None::<&str>)
                .map(|item| monitors.append(&item));
            for (index, display) in displays.iter().enumerate() {
                let text = format!("{} {} ({}×{})", labels.display, index + 1, display.size.0, display.size.1);
                let checked = !wanted.is_empty() && using.as_deref() == Some(display.name.as_str());
                let _ = CheckMenuItem::with_id(app, format!("monitor-{index}"), text, true, checked, None::<&str>)
                    .map(|item| monitors.append(&item));
            }
            if !wanted.is_empty() && !displays.iter().any(|display| display.name == wanted) {
                let _ = CheckMenuItem::with_id(app, "monitor-missing", &labels.missing, false, true, None::<&str>)
                    .map(|item| monitors.append(&item));
            }
        });
    }

    fn open_panel_near_cursor(app: &AppHandle) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let anchor = match app.cursor_position() {
                Ok(at) => Anchor { right: at.x, top: at.y, bottom: at.y },
                Err(_) => Anchor { right: f64::MAX, top: f64::MAX, bottom: f64::MAX },
            };
            log(toggle_panel(&app, anchor), "panel");
        });
    }

    /// Quits the way the main window's close button does, so the backend saves
    /// the settings first; if the main window does not end the app, end it anyway.
    fn quit_app(app: &AppHandle) {
        if app.emit_to("main", "companion-quit", ()).is_err() || app.get_webview_window("main").is_none() {
            app.exit(0);
            return;
        }
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(6));
            crate::startup_log("Tray quit: main window did not close in time");
            app.exit(0);
        });
    }

    pub fn refresh(app: &AppHandle, status: &Status) {
        let status = status.clone();
        on_main(app, move |app| {
            let Some(items) = items(app) else { return };
            let menu = &status.menu;
            let _ = items.toggle.set_text(if status.mic.on { &menu.stop } else { &menu.start });
            let _ = items.toggle.set_enabled(status.ready && !status.mic.pending);
            let _ = items.panel.set_text(&menu.panel);
            let _ = items.main.set_text(&menu.main);
            let _ = items.quit.set_text(&menu.quit);
            let _ = items.monitors.set_text(&menu.monitor);
            refresh_feature(app);
            refresh_monitors(app);
        });
    }

    /// The overlay's items follow the feature: usable while it is on, greyed out while off.
    pub fn refresh_feature(app: &AppHandle) {
        on_main(app, |app| {
            let Some(items) = items(app) else { return };
            // Read when it runs: a change queued from another thread shows the latest state.
            let _ = items.panel.set_enabled(enabled());
            let _ = items.monitors.set_enabled(enabled());
        });
    }
}

/// The main window turns the feature on or off as the setting changes. Async: making the
/// panel window from a synchronous command can hang on Windows.
#[tauri::command]
pub async fn companion_set(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    if window.label() != "main" {
        return Err("companion_forbidden".into());
    }
    let app = window.app_handle().clone();
    WANTED.store(enabled, Ordering::SeqCst);
    // One change at a time: on, off and on again in quick succession ran two installs at once,
    // and the second failed on the window labels the first had just taken (#563).
    let _one_at_a_time = SWITCHING.lock().unwrap_or_else(PoisonError::into_inner);
    // A later request came while this one waited: that one decides.
    if WANTED.load(Ordering::SeqCst) != enabled {
        return Ok(());
    }
    if enabled {
        install(&app).inspect_err(|error| crate::startup_log(&format!("Tray companion could not start: {error}")))?;
        // Turned off while it was being made: the off request found nothing to undo yet.
        if !WANTED.load(Ordering::SeqCst) && self::enabled() {
            return uninstall(&app);
        }
        Ok(())
    } else if self::enabled() {
        uninstall(&app)
    } else {
        Ok(())
    }
}
/// The main window reports the switches and the words of the panel and the tray. The tray icon is
/// there whether or not the overlay feature is on, so this is taken either way.
#[tauri::command]
pub fn companion_publish(window: WebviewWindow, state: State<CompanionState>, status: Status) -> Result<(), String> {
    from_main(window.label())?;
    validate(&status)?;
    {
        let mut inner = state.lock()?;
        inner.edge = Edge::parse(&status.edge).unwrap_or_default();
        inner.status = status.clone();
    }
    let app = window.app_handle();
    tray::refresh(app, &status);
    // The panel or the handle may not exist yet: they read the state when they open.
    let _ = app.emit_to(PANEL, "companion-changed", ());
    let _ = app.emit_to(HANDLE, "companion-changed", ());
    Ok(())
}

/// The main window takes what the panel, the hexagram or the tray asked for (the tray asks
/// whether or not the overlay feature is on).
#[tauri::command]
pub fn companion_take(window: WebviewWindow, state: State<CompanionState>) -> Result<Vec<String>, String> {
    from_main(window.label())?;
    Ok(state.lock()?.actions.drain(..).collect())
}

/// The main window needs the user, for a consent dialog for example. It may be hidden in the tray
/// whether or not the overlay feature is on.
#[tauri::command]
pub fn companion_show_main(window: WebviewWindow) -> Result<(), String> {
    from_main(window.label())?;
    show_main(window.app_handle())
}

/// Closing the main window only hides it: the app stays in the tray, and the tray menu's Quit
/// ends it. Answers whether it hid the window: without a tray icon (a desktop with no tray
/// support) nothing could bring it back, so the main window quits as before. On Linux the icon
/// can be made yet not shown (GNOME without an AppIndicator extension, Issue #422), so the tray
/// host is asked at each close. The main window has no hide permission of its own.
/// Async: on Linux it waits for the session bus.
#[tauri::command]
pub async fn companion_hide_main(window: WebviewWindow, state: State<'_, CompanionState>) -> Result<bool, String> {
    from_main(window.label())?;
    if !tray_shown(&state).await? {
        crate::startup_log("Tray icon is not shown on this desktop: closing quits");
        return Ok(false);
    }
    window.hide().map_err(|error| error.to_string())?;
    Ok(true)
}

/// Whether closing the main window now would put it away in the tray (true) or quit (false),
/// asked the way [`companion_hide_main`] asks: the close button's name says which.
#[tauri::command]
pub async fn companion_close_hides(window: WebviewWindow, state: State<'_, CompanionState>) -> Result<bool, String> {
    from_main(window.label())?;
    tray_shown(&state).await
}

/// Whether the tray icon was made and, on Linux, a tray host shows it.
async fn tray_shown(state: &State<'_, CompanionState>) -> Result<bool, String> {
    // A statement of its own: the lock must not be held across the wait below.
    let has_tray = state.lock()?.tray.is_some();
    #[cfg(target_os = "linux")]
    if has_tray {
        return Ok(tauri::async_runtime::spawn_blocking(linux_tray::shown).await.unwrap_or(false));
    }
    Ok(has_tray)
}

/// Whether a tray icon can be made and seen on Linux.
#[cfg(target_os = "linux")]
mod linux_tray {
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::time::Duration;

    unsafe extern "C" {
        fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
        fn dlclose(handle: *mut c_void) -> c_int;
    }
    const RTLD_LAZY: c_int = 0x0001;
    /// The libraries libappindicator-sys 0.9 loads, in its order; it panics when neither loads.
    pub const LIBRARIES: [&CStr; 2] = [c"libayatana-appindicator3.so.1", c"libappindicator3.so.1"];
    /// The names a StatusNotifierItem host registers. libappindicator shows its icon through one.
    const WATCHERS: [&str; 2] = ["org.kde.StatusNotifierWatcher", "org.freedesktop.StatusNotifierWatcher"];
    /// How long the session bus may take to answer before the icon counts as not shown.
    const ASK_FOR: Duration = Duration::from_secs(2);

    /// Loads the way libappindicator-sys does (dlopen with the default search path).
    pub fn library_loads() -> bool {
        LIBRARIES.iter().any(|name| {
            // SAFETY: a NUL-terminated name; the handle is closed at once. The libraries' own
            // initializers are the ones the tray would run when it loads them.
            let handle = unsafe { dlopen(name.as_ptr(), RTLD_LAZY) };
            if handle.is_null() {
                return false;
            }
            unsafe { dlclose(handle) };
            true
        })
    }

    /// Whether a tray host (a StatusNotifierWatcher) is on the session bus. Without one the
    /// icon is made but nowhere to be seen. An XEmbed-only tray also counts as not shown, so
    /// closing quits there as before 0.5.0. Anything that fails counts as not shown.
    pub fn shown() -> bool {
        let (sender, receiver) = std::sync::mpsc::channel();
        let asked = std::thread::Builder::new().name("astarot-tray-host".into()).spawn(move || {
            let _ = sender.send(watcher_present());
        });
        asked.is_ok() && receiver.recv_timeout(ASK_FOR).unwrap_or(false)
    }

    fn watcher_present() -> bool {
        let Ok(connection) = zbus::blocking::Connection::session() else { return false };
        WATCHERS.iter().any(|name| {
            connection
                .call_method(Some("org.freedesktop.DBus"), "/org/freedesktop/DBus", Some("org.freedesktop.DBus"),
                    "NameHasOwner", &(*name,))
                .ok()
                .and_then(|reply| reply.body().deserialize::<bool>().ok())
                .unwrap_or(false)
        })
    }
}
#[tauri::command]
pub fn companion_status(window: WebviewWindow, state: State<CompanionState>) -> Result<Status, String> {
    sender(window.label(), &[PANEL, HANDLE])?;
    Ok(state.lock()?.status.clone())
}

/// The panel or the handle asks for a switch to change, or for the main window.
#[tauri::command]
pub fn companion_request(window: WebviewWindow, action: String) -> Result<(), String> {
    sender(window.label(), &[PANEL, HANDLE])?;
    if action == "open_main" {
        if window.label() == HANDLE {
            go_in(window.app_handle())?;
        } else {
            let _ = window.hide();
        }
        return show_main(window.app_handle());
    }
    request(window.app_handle(), &action)
}

#[tauri::command]
pub fn companion_panel_hide(window: WebviewWindow) -> Result<(), String> {
    sender(window.label(), &[PANEL])?;
    window.hide().map_err(|error| error.to_string())
}

/// The hexagram's middle opens the panel beside it, on the screen's side.
#[tauri::command]
pub async fn companion_panel_toggle(window: WebviewWindow) -> Result<(), String> {
    sender(window.label(), &[HANDLE])?;
    let app = window.app_handle();
    let out = app.state::<CompanionState>().lock()?.out.ok_or("companion_no_handle")?;
    let point = (f64::from(out.centre.0), f64::from(out.centre.1));
    toggle_panel_by(app, point, move |size, work, scale| {
        panel_beside(out.edge, out.centre, (STAR_PLATE + PANEL_GAP) * scale, size, work)
    })
}

/// A connected monitor, for the settings page's list: its name, its number (as the tray menu
/// numbers it), its size and whether it is the primary one.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MonitorInfo {
    id: String,
    number: usize,
    width: u32,
    height: u32,
    primary: bool,
}

fn monitor_infos(displays: &[Display]) -> Vec<MonitorInfo> {
    displays
        .iter()
        .enumerate()
        .map(|(index, display)| MonitorInfo {
            id: display.name.clone(),
            number: index + 1,
            width: display.size.0,
            height: display.size.1,
            primary: display.primary,
        })
        .collect()
}

/// The monitors connected now, for the settings page. Answered whether or not the feature is on
/// yet: just after it is turned on, its windows may still be in the making.
#[tauri::command]
pub fn companion_monitors(window: WebviewWindow) -> Result<Vec<MonitorInfo>, String> {
    from_main(window.label())?;
    Ok(monitor_infos(&read_displays(window.app_handle())?))
}

/// What the hexagram page draws: whether it is out, at which edge, and where its centre is
/// inside the window (CSS px).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HandleLayout {
    out: bool,
    edge: &'static str,
    x: f64,
    y: f64,
}

#[tauri::command]
pub fn companion_handle_layout(window: WebviewWindow, state: State<CompanionState>) -> Result<HandleLayout, String> {
    sender(window.label(), &[HANDLE])?;
    let inner = state.lock()?;
    let name = |edge: Edge| match edge {
        Edge::Right => "right",
        Edge::Left => "left",
        Edge::Top => "top",
        Edge::Bottom => "bottom",
    };
    Ok(match inner.out {
        Some(out) => HandleLayout { out: true, edge: name(out.edge), x: out.local.0, y: out.local.1 },
        None => HandleLayout { out: false, edge: name(inner.edge), x: 0.0, y: 0.0 },
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_saved_true_starts_in_the_tray() {
        assert!(saved_on(r#"{"EXPERIMENTAL_FEATURES": {"tray_companion": true}}"#));
        for text in [
            r#"{"EXPERIMENTAL_FEATURES": {"tray_companion": false}}"#,
            r#"{"EXPERIMENTAL_FEATURES": {"tray_companion": "true"}}"#,
            r#"{"EXPERIMENTAL_FEATURES": {"other": true}}"#,
            r#"{"EXPERIMENTAL_FEATURES": {}}"#,
            r#"{}"#,
            "not json",
            "",
        ] {
            assert!(!saved_on(text), "{text}");
        }
    }

    #[test]
    fn a_missing_settings_file_starts_as_usual_and_off_refuses_every_window() {
        let folder = std::env::temp_dir().join("vrct-vox-companion-test-missing");
        assert!(!starts_in_tray(&folder));
        assert!(!enabled());
        assert_eq!(sender("main", &["main"]), Err("companion_off".into()));
        assert_eq!(sender("quick_chat", &["main"]), Err("companion_forbidden".into()));
        assert_eq!(sender(HANDLE, &[PANEL]), Err("companion_forbidden".into()));
    }
    #[test]
    fn a_saved_on_setting_starts_in_the_tray_but_the_feature_waits_for_its_windows() {
        let folder = std::env::temp_dir().join("vrct-vox-companion-test-saved-on");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("config.json"), format!(r#"{{"EXPERIMENTAL_FEATURES": {{"{FEATURE_ID}": true}}}}"#)).unwrap();
        assert!(starts_in_tray(&folder));
        // A failed install must leave it off: only install turns it on.
        assert!(!enabled());
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn a_pointer_passing_over_the_edge_does_not_bring_the_hexagram_out() {
        let start = Instant::now();
        let mut since = None;
        // Passing to the next monitor: near for one look, then gone.
        assert!(!held_near(Some(5.0), &mut since, start, STAY_STILL));
        assert!(!held_near(None, &mut since, start + WATCH_EVERY, STAY_STILL));
        assert_eq!(since, None);
        // Resting at the edge: out after a few looks.
        assert!(!held_near(Some(1.0), &mut since, start + WATCH_EVERY * 2, STAY_STILL));
        assert!(!held_near(Some(1.0), &mut since, start + WATCH_EVERY * 3, STAY_STILL));
        assert!(held_near(Some(1.0), &mut since, start + WATCH_EVERY * 2 + COME_OUT_AFTER, STAY_STILL));
    }

    #[test]
    fn a_pointer_crossing_the_strip_slowly_does_not_bring_the_hexagram_out() {
        // #563: crossing the 14 px strip to the next monitor at 3 px a look (about 40 px a
        // second) kept the pointer near for 400 ms, and the hexagram came out on the way.
        let start = Instant::now();
        let mut since = None;
        let mut looked = start;
        for step in 0..5 {
            let depth = HOT_DEPTH - 3.0 * f64::from(step);
            assert!(!held_near(Some(depth), &mut since, looked, STAY_STILL), "look {step}");
            looked += WATCH_EVERY;
        }
        assert!(!held_near(None, &mut since, looked, STAY_STILL));
        // Stopping inside the strip, or sliding along the edge at the same depth, still does.
        let mut since = None;
        for step in 0..3 {
            let near = held_near(Some(6.0 + 0.5 * f64::from(step)), &mut since, start + WATCH_EVERY * step, STAY_STILL);
            assert_eq!(near, WATCH_EVERY * step >= COME_OUT_AFTER, "look {step}");
        }
        // At 150 % the pointer may move further in physical px.
        let mut since = None;
        assert!(!held_near(Some(10.0), &mut since, start, STAY_STILL * 1.5));
        assert!(held_near(Some(5.0), &mut since, start + COME_OUT_AFTER, STAY_STILL * 1.5));
    }

    #[test]
    fn depth_is_measured_inward_from_each_edge() {
        assert_eq!(depth(Edge::Right, WORK, (1919.0, 500.0)), 1.0);
        assert_eq!(depth(Edge::Left, WORK, (3.0, 500.0)), 3.0);
        assert_eq!(depth(Edge::Top, WORK, (900.0, 2.0)), 2.0);
        assert_eq!(depth(Edge::Bottom, WORK, (900.0, 1030.0)), f64::from(WORK.1) + f64::from(WORK.3) - 1030.0);
    }

    #[test]
    fn a_status_with_odd_words_is_refused() {
        assert!(validate(&Status::default()).is_ok());
        let cases: Vec<Box<dyn Fn(&mut Status)>> = vec![
            Box::new(|s| s.language = "fr".into()),
            Box::new(|s| s.menu.start = " ".into()),
            Box::new(|s| s.menu.quit = "a\nb".into()),
            Box::new(|s| s.menu.panel = "あ".repeat(MAX_LABEL + 1)),
        ];
        for change in cases {
            let mut status = Status::default();
            change(&mut status);
            assert_eq!(validate(&status), Err("companion_invalid".into()));
        }
        let mut long = Status::default();
        long.menu.main = "あ".repeat(MAX_LABEL);
        assert!(validate(&long).is_ok());
    }

    #[test]
    fn the_panel_opens_above_the_tray_and_stays_in_the_work_area() {
        // A 1920x1080 monitor with a 48px taskbar at the bottom; the tray icon is in it.
        let work = (0, 0, 1920, 1032);
        let at = Anchor { right: 1800.0, top: 1060.0, bottom: 1060.0 };
        assert_eq!(place(at, (300, 232), work), (1500, 800));
        // Near the right edge it is moved left, never off the screen.
        let edge = Anchor { right: 2000.0, top: 1060.0, bottom: 1060.0 };
        assert_eq!(place(edge, (300, 232), work).0, 1620);
        // A panel at the top of the screen opens below its anchor.
        let top = Anchor { right: 1800.0, top: 10.0, bottom: 40.0 };
        assert_eq!(place(top, (300, 232), work), (1500, 40));
        // A second monitor left of the first one has a negative origin.
        let (x, y) = place(Anchor { right: -100.0, top: 500.0, bottom: 520.0 }, (300, 232), (-1920, 0, 1920, 1080));
        assert!(x >= -1920 && x + 300 <= 0 && (0..=1080 - 232).contains(&y));
    }

    // A 1920x1080 monitor with a 48px taskbar at the bottom, at 125 %.
    const WORK: Rect = (0, 0, 1920, 1032);

    #[test]
    fn the_hexagram_comes_out_half_over_the_middle_of_its_edge() {
        for (edge, centre) in [
            (Edge::Right, (1920, 516)),
            (Edge::Left, (0, 516)),
            (Edge::Top, (960, 0)),
            (Edge::Bottom, (960, 1032)),
        ] {
            assert_eq!(edge_centre(edge, WORK), centre, "{edge:?}");
            let ((x, y, width, height), (cx, cy)) = out_rect(edge, WORK, 1.25);
            // The window lies on the screen, inside the work area, with the centre on its edge.
            assert!(x >= 0 && y >= 0 && x + width as i32 <= 1920 && y + height as i32 <= 1032, "{edge:?}");
            assert_eq!((x + cx, y + cy), centre, "{edge:?}");
        }
        // Beside a side edge the window is the narrow one; along a top or bottom edge, the wide one.
        assert_eq!(out_rect(Edge::Right, WORK, 1.0).0, (1920 - 360, 516 - 120, 360, 240));
        assert_eq!(out_rect(Edge::Bottom, WORK, 1.0).0, (960 - 290, 1032 - 250, 580, 250));
    }

    #[test]
    fn only_the_pointer_at_the_edge_near_the_hexagram_brings_it_out() {
        assert!(near_edge(Edge::Right, WORK, 1.0, (1919.0, 516.0)));
        assert!(near_edge(Edge::Right, WORK, 1.0, (1910.0, 560.0)));
        // Too far from the edge, or along it too far from the hexagram.
        assert!(!near_edge(Edge::Right, WORK, 1.0, (1890.0, 516.0)));
        assert!(!near_edge(Edge::Right, WORK, 1.0, (1919.0, 700.0)));
        // The other edges, and the taskbar below the work area does not count as the bottom edge.
        assert!(near_edge(Edge::Left, WORK, 1.0, (0.0, 500.0)));
        assert!(near_edge(Edge::Top, WORK, 1.0, (970.0, 3.0)));
        assert!(near_edge(Edge::Bottom, WORK, 1.0, (960.0, 1030.0)));
        assert!(!near_edge(Edge::Bottom, WORK, 1.0, (960.0, 1060.0)));
        // At 150 % the strip is deeper in physical px.
        assert!(near_edge(Edge::Right, WORK, 1.5, (1900.0, 516.0)));
    }

    #[test]
    fn it_stays_out_while_the_pointer_is_on_its_window_or_just_beside() {
        let rect = (1590, 396, 330, 240);
        assert!(inside(rect, (1700.0, 500.0), 18.0));
        assert!(inside(rect, (1580.0, 390.0), 18.0));
        assert!(!inside(rect, (1560.0, 500.0), 18.0));
    }

    #[test]
    fn the_panel_opens_beside_the_hexagram_on_the_screens_side() {
        let size = (375, 260);
        assert_eq!(panel_beside(Edge::Right, (1920, 516), 100.0, size, WORK), (1920 - 100 - 375, 516 - 130));
        assert_eq!(panel_beside(Edge::Left, (0, 516), 100.0, size, WORK), (100, 386));
        assert_eq!(panel_beside(Edge::Bottom, (960, 1032), 100.0, size, WORK), (773, 1032 - 100 - 260));
        // Near a corner it stays inside the work area.
        let (x, y) = panel_beside(Edge::Top, (10, 0), 100.0, size, WORK);
        assert!(x >= 0 && y >= 0);
    }

    #[test]
    fn a_status_names_one_of_the_four_edges() {
        for edge in ["right", "left", "top", "bottom"] {
            let mut status = Status::default();
            status.edge = edge.into();
            assert!(validate(&status).is_ok(), "{edge}");
        }
        let mut status = Status::default();
        status.edge = "middle".into();
        assert_eq!(validate(&status), Err("companion_invalid".into()));
        // A main window that reports no edge yet means the default, the right one.
        let value = serde_json::to_value(Status::default()).unwrap();
        let mut older = value.as_object().unwrap().clone();
        older.remove("edge");
        let read: Status = serde_json::from_value(serde_json::Value::Object(older)).unwrap();
        assert_eq!(read.edge, "right");
    }

    fn display(name: &str, x: i32, primary: bool) -> Display {
        Display { name: name.into(), work: (x, 0, 1920, 1032), size: (1920, 1080), scale: 1.0, primary }
    }

    #[test]
    fn the_chosen_monitor_is_used_while_connected_and_the_primary_one_otherwise() {
        let displays = [display("\\\\.\\DISPLAY2", -1920, false), display("\\\\.\\DISPLAY1", 0, true)];
        assert_eq!(pick(&displays, "").unwrap().name, "\\\\.\\DISPLAY1", "empty means the primary monitor");
        assert_eq!(pick(&displays, "\\\\.\\DISPLAY2").unwrap().name, "\\\\.\\DISPLAY2");
        // Unplugged: the primary one, until it comes back.
        assert_eq!(pick(&displays, "\\\\.\\DISPLAY3").unwrap().name, "\\\\.\\DISPLAY1");
        assert!(pick(&[], "").is_none());
        // The settings page numbers them as the tray menu does: left to right.
        let infos = monitor_infos(&displays);
        assert_eq!(infos.iter().map(|info| (info.number, info.primary)).collect::<Vec<_>>(), [(1, false), (2, true)]);
    }

    #[test]
    fn a_status_names_a_monitor_without_control_characters() {
        let mut status = Status::default();
        status.monitor = "\\\\.\\DISPLAY2".into();
        assert!(validate(&status).is_ok());
        status.monitor = "a\nb".into();
        assert_eq!(validate(&status), Err("companion_invalid".into()));
        status.monitor = "x".repeat(MAX_MONITOR_NAME + 1);
        assert_eq!(validate(&status), Err("companion_invalid".into()));
    }
}
