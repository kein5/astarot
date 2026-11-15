//! Captions over the desktop, for VRChat without a headset.
//!
//! A second window stays above the other windows, lets every click through and
//! never takes the focus, so the game under it keeps its input. The main window
//! decides what it shows: it hands a snapshot to this module, and the overlay
//! page reads it back through a command that checks its label. Events carry no
//! data, as with the quick chat window.
//!
//! While the user holds Ctrl the window takes the mouse instead, so it can be dragged, and with
//! the cursor over it Ctrl and + or - change the text size. The main window saves both.
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "caption_overlay";
const TITLE: &str = "VRCT-VOX Captions";
const MAX_LINES: usize = 8;
const MAX_TEXT: usize = 2000;
const MAX_TRANSLATIONS: usize = 3;
const MAX_SPEAKERS: usize = 4;
/// The flow strip: at most three recent inputs, each with a few rows.
const MAX_FLOW: usize = 3;
const MAX_FLOW_ROWS: usize = 8;
const MAX_FLOW_LABEL: usize = 120;
const MAX_FLOW_TEXT: usize = 200;
/// The longest axis a strip draws, in ms (ten minutes).
const MAX_FLOW_SCALE: u32 = 600_000;
/// The band the captions are drawn in, as parts of the monitor's work area.
const BAND_WIDTH: f64 = 0.8;
const BAND_HEIGHT: f64 = 0.34;
const BAND_MARGIN: f64 = 0.03;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Line {
    id: String,
    /// "sent" for the user's own words, "received" for what was heard or read.
    kind: String,
    text: String,
    #[serde(default)]
    translations: Vec<String>,
    /// Still being recognized or sent: the line stays until it settles.
    #[serde(default)]
    pending: bool,
    /// Who spoke a received line, where the voices were told apart: labels such as "A" and
    /// "B", in the order they speak. A label is a voice within one session, not a person.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    speakers: Vec<String>,
    /// Milliseconds since the epoch after which the line is no longer shown.
    until: f64,
}

/// One to three capital letters, as the speech server labels a voice.
fn valid_speaker(label: &str) -> bool {
    (1..=3).contains(&label.len()) && label.bytes().all(|byte| byte.is_ascii_uppercase())
}

/// One row of a flow item: a stage or an output, drawn as a bar from `start` to `end` ms.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FlowRow {
    /// "stage", "chatbox", "speech" or "conversion": only the bar's colour depends on it.
    kind: String,
    label: String,
    /// The duration as the main window writes it, such as "230 ms", or why the output was not used.
    value: String,
    #[serde(default)]
    start: u32,
    #[serde(default)]
    end: u32,
    /// The output was not used; the row says why and draws no bar.
    #[serde(default)]
    off: bool,
}

/// One of the user's own recent inputs: where it went and how long each step took.
/// The main window words every label; the overlay page only draws them.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FlowItem {
    id: String,
    /// "voice" or "chat".
    input: String,
    label: String,
    text: String,
    /// The axis of the bars, in ms.
    scale: u32,
    rows: Vec<FlowRow>,
}

fn valid_label(value: &str, limit: usize) -> bool {
    value.chars().count() <= limit && !value.chars().any(char::is_control)
}

fn valid_flow(item: &FlowItem) -> bool {
    !item.id.is_empty()
        && item.id.len() <= 512
        && matches!(item.input.as_str(), "voice" | "chat")
        && valid_label(&item.label, MAX_FLOW_LABEL)
        && valid_label(&item.text, MAX_FLOW_TEXT)
        && (1..=MAX_FLOW_SCALE).contains(&item.scale)
        && item.rows.len() <= MAX_FLOW_ROWS
        && item.rows.iter().all(|row| {
            matches!(row.kind.as_str(), "stage" | "chatbox" | "speech" | "conversion")
                && valid_label(&row.label, MAX_FLOW_LABEL)
                && valid_label(&row.value, MAX_FLOW_LABEL)
                && row.start <= row.end
                && row.end <= item.scale
        })
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Snapshot {
    lines: Vec<Line>,
    /// "bottom" or "top" of the monitor.
    position: String,
    font_size: u16,
    /// How dark the plate behind the words is, 0 to 1.
    opacity: f32,
    font_family: String,
    /// The flow strip, newest first; empty while it is off.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    flow: Vec<FlowItem>,
    /// A live reading under the strip, such as the conversion's round trip.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    flow_note: String,
    /// The user holds Ctrl over the window to move it or change the text size, and the page
    /// outlines the window. Only this module sets it; the main window's value is ignored.
    #[serde(default, skip_deserializing, skip_serializing_if = "std::ops::Not::not")]
    adjusting: bool,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            lines: Vec::new(),
            position: "bottom".into(),
            font_size: 28,
            opacity: 0.6,
            font_family: "Yu Gothic UI".into(),
            flow: Vec::new(),
            flow_note: String::new(),
            adjusting: false,
        }
    }
}

#[derive(Default)]
pub struct CaptionOverlayState(Mutex<Snapshot>);

fn sender(label: &str, expected: &str) -> Result<(), String> {
    if label == expected {
        Ok(())
    } else {
        Err("caption_overlay_forbidden".into())
    }
}

fn valid_position(position: &str) -> Result<(), String> {
    if matches!(position, "bottom" | "top") {
        Ok(())
    } else {
        Err("caption_overlay_invalid".into())
    }
}

fn validate(snapshot: &Snapshot) -> Result<(), String> {
    let invalid = || Err("caption_overlay_invalid".to_string());
    valid_position(&snapshot.position)?;
    if !(16..=72).contains(&snapshot.font_size)
        || !(0.0..=1.0).contains(&snapshot.opacity)
        || snapshot.font_family.trim().is_empty()
        || snapshot.font_family.chars().count() > 256
        || snapshot.font_family.chars().any(char::is_control)
        || snapshot.lines.len() > MAX_LINES
        || snapshot.flow.len() > MAX_FLOW
        || !snapshot.flow.iter().all(valid_flow)
        || !valid_label(&snapshot.flow_note, MAX_FLOW_LABEL)
    {
        return invalid();
    }
    for line in &snapshot.lines {
        if line.id.is_empty()
            || line.id.len() > 512
            || !matches!(line.kind.as_str(), "sent" | "received")
            || line.text.chars().count() > MAX_TEXT
            || line.translations.len() > MAX_TRANSLATIONS
            || line.translations.iter().any(|text| text.chars().count() > MAX_TEXT)
            || line.speakers.len() > MAX_SPEAKERS
            || !line.speakers.iter().all(|label| valid_speaker(label))
            // Only what was heard has several voices; the user's own line names no one.
            || (line.kind == "sent" && !line.speakers.is_empty())
            || !line.until.is_finite()
            || line.until < 0.0
        {
            return invalid();
        }
    }
    Ok(())
}

/// Where the band goes inside a work area of `(x, y, width, height)` physical pixels.
fn band(work: (i32, i32, u32, u32), position: &str) -> (i32, i32, u32, u32) {
    let (x, y, width, height) = work;
    let band_width = (f64::from(width) * BAND_WIDTH).round().max(1.0);
    let band_height = (f64::from(height) * BAND_HEIGHT).round().max(1.0);
    let margin = (f64::from(height) * BAND_MARGIN).round();
    let left = f64::from(x) + (f64::from(width) - band_width) / 2.0;
    let top = if position == "top" {
        f64::from(y) + margin
    } else {
        f64::from(y) + f64::from(height) - band_height - margin
    };
    (left.round() as i32, top.round() as i32, band_width as u32, band_height as u32)
}

/// Where the user dragged the window: its top-left corner in physical pixels of the virtual
/// desktop (OVERLAY_DESKTOP_PLACEMENT in src-python/config.py).
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Placement {
    x: i32,
    y: i32,
}

/// The same bound the settings file keeps.
const PLACEMENT_LIMIT: i32 = 100_000;
/// How much of a dragged window, in physical pixels each way, must still be on a monitor's
/// work area for it to open there again. A monitor that was unplugged or moved leaves less.
const VISIBLE_PART: i64 = 64;

fn valid_placement(placement: &Option<Placement>) -> Result<(), String> {
    match placement {
        Some(Placement { x, y }) if x.unsigned_abs() > PLACEMENT_LIMIT as u32 || y.unsigned_abs() > PLACEMENT_LIMIT as u32 => {
            Err("caption_overlay_invalid".into())
        }
        _ => Ok(()),
    }
}

fn overlap(a: (i32, i32, u32, u32), b: (i32, i32, u32, u32)) -> (i64, i64) {
    let span = |start_a: i32, len_a: u32, start_b: i32, len_b: u32| {
        let end = (i64::from(start_a) + i64::from(len_a)).min(i64::from(start_b) + i64::from(len_b));
        (end - i64::from(start_a).max(i64::from(start_b))).max(0)
    };
    (span(a.0, a.2, b.0, b.2), span(a.1, a.3, b.1, b.3))
}

/// The window's place and size. A dragged window keeps its corner and takes the size of the
/// band on the monitor it is on, while enough of it is on one; otherwise it goes to the band
/// of `position` on `home`, the monitor the main window is on.
fn placed(
    works: &[(i32, i32, u32, u32)],
    home: (i32, i32, u32, u32),
    position: &str,
    placement: Option<Placement>,
) -> (i32, i32, u32, u32) {
    if let Some(Placement { x, y }) = placement {
        for work in works {
            let (_, _, width, height) = band(*work, position);
            let (across, down) = overlap((x, y, width, height), *work);
            if across >= VISIBLE_PART && down >= VISIBLE_PART {
                return (x, y, width, height);
            }
        }
    }
    band(home, position)
}

/// What the watcher reads each tick: Ctrl and the primary mouse button, held anywhere, and
/// the cursor in physical pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Input {
    ctrl: bool,
    button: bool,
    cursor: (i32, i32),
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Drag {
    /// The cursor when the button went down, and the window's corner then and now.
    grab: (i32, i32),
    origin: (i32, i32),
    at: (i32, i32),
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Adjust {
    ctrl: bool,
    button: bool,
    /// Ctrl is held over the window or during a drag: the outline shows and + / - change the size.
    active: bool,
    drag: Option<Drag>,
}

#[derive(Debug, PartialEq)]
enum Action {
    /// Let clicks through (Ctrl up) or take them (Ctrl down).
    ClickThrough(bool),
    Active(bool),
    MoveTo(i32, i32),
    /// A drag ended somewhere new: the main window saves the place.
    Dropped(Placement),
}

fn inside(window: (i32, i32, u32, u32), cursor: (i32, i32)) -> bool {
    let (x, y, width, height) = window;
    let (cx, cy) = (i64::from(cursor.0), i64::from(cursor.1));
    cx >= i64::from(x)
        && cy >= i64::from(y)
        && cx < i64::from(x) + i64::from(width)
        && cy < i64::from(y) + i64::from(height)
}

/// One tick of the adjustment. Holding Ctrl makes the window take the mouse; pressing the button
/// over it with Ctrl held starts a drag, which follows the cursor until the button or Ctrl is
/// let go. A button already held when Ctrl goes down (a game's drag) never starts one.
fn step(state: Adjust, input: Input, window: (i32, i32, u32, u32)) -> (Adjust, Vec<Action>) {
    let mut actions = Vec::new();
    if input.ctrl != state.ctrl {
        actions.push(Action::ClickThrough(!input.ctrl));
    }
    let over = inside(window, input.cursor);
    let drag = match state.drag {
        Some(mut drag) if input.ctrl && input.button => {
            let follow = |origin: i32, now: i32, grab: i32| {
                (i64::from(origin) + i64::from(now) - i64::from(grab))
                    .clamp(-i64::from(PLACEMENT_LIMIT), i64::from(PLACEMENT_LIMIT)) as i32
            };
            let to = (follow(drag.origin.0, input.cursor.0, drag.grab.0), follow(drag.origin.1, input.cursor.1, drag.grab.1));
            if to != drag.at {
                drag.at = to;
                actions.push(Action::MoveTo(to.0, to.1));
            }
            Some(drag)
        }
        Some(drag) => {
            if drag.at != drag.origin {
                actions.push(Action::Dropped(Placement { x: drag.at.0, y: drag.at.1 }));
            }
            None
        }
        None if input.ctrl && input.button && !state.button && over => {
            Some(Drag { grab: input.cursor, origin: (window.0, window.1), at: (window.0, window.1) })
        }
        None => None,
    };
    let active = input.ctrl && (over || drag.is_some());
    if active != state.active {
        actions.push(Action::Active(active));
    }
    (Adjust { ctrl: input.ctrl, button: input.button, active, drag }, actions)
}

/// Ctrl and + or - change the text size, as in a browser. They are registered only while the
/// adjustment is active, so the same keys reach other programs at every other time.
fn size_keys() -> [(tauri_plugin_global_shortcut::Shortcut, i8); 5] {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    let ctrl = Some(Modifiers::CONTROL);
    [
        // "=" on a US keyboard and ";" on a Japanese one: the key that carries "+".
        (Shortcut::new(ctrl, Code::Equal), 1),
        (Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Equal), 1),
        (Shortcut::new(ctrl, Code::NumpadAdd), 1),
        (Shortcut::new(ctrl, Code::Minus), -1),
        (Shortcut::new(ctrl, Code::NumpadSubtract), -1),
    ]
}

/// Registers the size keys and returns the ones this call registered; a key the user already
/// took as a hotkey stays theirs and is left out.
fn register_size_keys(app: &tauri::AppHandle) -> Vec<tauri_plugin_global_shortcut::Shortcut> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let shortcuts = app.global_shortcut();
    let mut taken = Vec::new();
    for (shortcut, change) in size_keys() {
        if shortcuts.is_registered(shortcut) {
            continue;
        }
        let registered = shortcuts.on_shortcut(shortcut, move |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app.emit_to("main", "caption-overlay-font-step", change);
            }
        });
        if registered.is_ok() {
            taken.push(shortcut);
        }
    }
    taken
}

fn unregister_size_keys(app: &tauri::AppHandle, taken: &mut Vec<tauri_plugin_global_shortcut::Shortcut>) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let shortcuts = app.global_shortcut();
    for shortcut in taken.drain(..) {
        let _ = shortcuts.unregister(shortcut);
    }
}

/// The watcher of the current window; an older one stops when this changes.
static GENERATION: AtomicU64 = AtomicU64::new(0);
/// Ctrl is held, so a window shown again takes the mouse as the watcher left it.
static CTRL: AtomicBool = AtomicBool::new(false);
static ADJUSTING: AtomicBool = AtomicBool::new(false);
/// Read Ctrl this often, and the cursor more often while it is held, for a smooth drag.
const IDLE_TICK: Duration = Duration::from_millis(50);
const ADJUST_TICK: Duration = Duration::from_millis(16);

#[cfg(windows)]
fn read_input(_overlay: &WebviewWindow) -> Option<Input> {
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetAsyncKeyState(key: i32) -> i16;
        fn GetSystemMetrics(index: i32) -> i32;
        fn GetCursorPos(point: *mut Point) -> i32;
    }
    const VK_LBUTTON: i32 = 0x01;
    const VK_RBUTTON: i32 = 0x02;
    const VK_CONTROL: i32 = 0x11;
    const SM_SWAPBUTTON: i32 = 23;
    // SAFETY: the three calls only read the input state; the point is a valid local.
    unsafe {
        let down = |key: i32| (GetAsyncKeyState(key) as u16) & 0x8000 != 0;
        // With the buttons swapped for a left hand, the primary button is the right one.
        let primary = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
        let mut point = Point { x: 0, y: 0 };
        if GetCursorPos(&mut point) == 0 {
            return None;
        }
        Some(Input { ctrl: down(VK_CONTROL), button: down(primary), cursor: (point.x, point.y) })
    }
}

/// X11: the pointer query on the root window carries the modifier and button state of the whole
/// display, whichever window has the focus.
#[cfg(target_os = "linux")]
fn read_input(overlay: &WebviewWindow) -> Option<Input> {
    let (tx, rx) = std::sync::mpsc::channel();
    overlay
        .run_on_main_thread(move || {
            let read = || -> Option<Input> {
                use gtk::gdk::prelude::*;
                use gtk::gdk::ModifierType;
                let display = gtk::gdk::Display::default()?;
                let pointer = display.default_seat()?.pointer()?;
                let root = display.default_screen().root_window()?;
                let (_, x, y, mask) = root.device_position(&pointer);
                let scale = root.scale_factor();
                Some(Input {
                    ctrl: mask.contains(ModifierType::CONTROL_MASK),
                    button: mask.contains(ModifierType::BUTTON1_MASK),
                    cursor: (x.saturating_mul(scale), y.saturating_mul(scale)),
                })
            };
            let _ = tx.send(read());
        })
        .ok()?;
    rx.recv_timeout(Duration::from_millis(500)).ok().flatten()
}

#[cfg(not(any(windows, target_os = "linux")))]
fn read_input(_overlay: &WebviewWindow) -> Option<Input> {
    None
}

fn set_adjusting(app: &tauri::AppHandle, value: bool) {
    if ADJUSTING.swap(value, Ordering::SeqCst) != value {
        let _ = app.emit_to(LABEL, "caption-overlay-changed", ());
    }
}

fn apply(app: &tauri::AppHandle, overlay: &WebviewWindow, action: Action, taken: &mut Vec<tauri_plugin_global_shortcut::Shortcut>) {
    match action {
        Action::ClickThrough(through) => {
            CTRL.store(!through, Ordering::SeqCst);
            let _ = overlay.set_ignore_cursor_events(through);
        }
        Action::Active(active) => {
            if active {
                *taken = register_size_keys(app);
            } else {
                unregister_size_keys(app, taken);
            }
            set_adjusting(app, active);
        }
        Action::MoveTo(x, y) => {
            let _ = overlay.set_position(PhysicalPosition::new(x, y));
        }
        Action::Dropped(placement) => {
            let _ = app.emit_to("main", "caption-overlay-moved", placement);
        }
    }
}

/// Watches Ctrl and the mouse while the window exists. The window never has the focus, so its
/// page gets no keys; the state is read from the system instead, which also works over a game.
fn watch(app: tauri::AppHandle) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    CTRL.store(false, Ordering::SeqCst);
    set_adjusting(&app, false);
    let spawned = std::thread::Builder::new().name("caption-overlay-adjust".into()).spawn(move || {
        let mut state = Adjust::default();
        let mut taken = Vec::new();
        while GENERATION.load(Ordering::SeqCst) == generation {
            let Some(overlay) = app.get_webview_window(LABEL) else { break };
            if let Some(input) = read_input(&overlay) {
                // The window's rectangle is needed only while Ctrl is held or a step is under way.
                let window = if input.ctrl || state != Adjust::default() {
                    match (overlay.outer_position(), overlay.outer_size()) {
                        (Ok(at), Ok(size)) => Some((at.x, at.y, size.width, size.height)),
                        _ => None,
                    }
                } else {
                    Some((0, 0, 0, 0))
                };
                if let Some(window) = window {
                    let (next, actions) = step(state, input, window);
                    state = next;
                    for action in actions {
                        apply(&app, &overlay, action, &mut taken);
                    }
                }
            }
            std::thread::sleep(if state.ctrl { ADJUST_TICK } else { IDLE_TICK });
        }
        unregister_size_keys(&app, &mut taken);
        if GENERATION.load(Ordering::SeqCst) == generation {
            CTRL.store(false, Ordering::SeqCst);
            set_adjusting(&app, false);
        }
    });
    // Without the thread the window still shows captions; it only cannot be moved.
    drop(spawned);
}

/// Shows the window without making it the foreground window. Tauri's `show()`
/// activates it, which takes the keyboard from the game the captions are over.
#[cfg(windows)]
pub(crate) fn show_without_focus(overlay: &WebviewWindow) -> Result<(), String> {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn ShowWindow(window: *mut std::ffi::c_void, command: i32) -> i32;
    }
    const SW_SHOWNOACTIVATE: i32 = 4;
    let handle = overlay.hwnd().map_err(|error| error.to_string())?;
    // SAFETY: the handle is this process's own live window, and ShowWindow has
    // no other precondition; its return value is the previous visibility.
    unsafe { ShowWindow(handle.0 as *mut std::ffi::c_void, SW_SHOWNOACTIVATE) };
    Ok(())
}

/// Linux, on X11 or XWayland: the window is mapped as an unmanaged (override-redirect)
/// window. A window manager stacks a focused full-screen game above "keep above"
/// windows (KWin's active layer), so a managed window would vanish under VRChat in
/// full screen. An unmanaged window is never focused, decorated or listed, and
/// KWin keeps it above managed windows, as it does tooltips and menus.
#[cfg(target_os = "linux")]
async fn on_gtk<F>(overlay: &WebviewWindow, work: F) -> Result<(), String>
where
    F: FnOnce(&gtk::ApplicationWindow) -> Result<(), String> + Send + 'static,
{
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let target = overlay.clone();
    overlay
        .run_on_main_thread(move || {
            let result = target.gtk_window().map_err(|error| error.to_string()).and_then(|window| work(&window));
            let _ = tx.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    rx.recv().await.ok_or("caption_overlay_unavailable")?
}

/// Before any setting that needs the native window: tao's click-through request
/// unwraps the GdkWindow and panics while the window is not realized (seen on the
/// first open in CI). Realizing does not map it, so override-redirect still applies.
#[cfg(target_os = "linux")]
pub(crate) async fn prepare(overlay: &WebviewWindow) -> Result<(), String> {
    use gtk::prelude::*;

    on_gtk(overlay, |window| {
        window.realize();
        let native = window.window().ok_or("caption_overlay_unavailable")?;
        if !native.is_visible() {
            // X11 takes this attribute only while the window is unmapped.
            native.set_override_redirect(true);
        }
        window.set_accept_focus(false);
        window.set_focus_on_map(false);
        Ok(())
    })
    .await
}

#[cfg(target_os = "linux")]
pub(crate) async fn show_without_focus(overlay: &WebviewWindow) -> Result<(), String> {
    use gtk::prelude::*;

    on_gtk(overlay, |window| {
        window.show_all();
        if let Some(native) = window.window() {
            native.raise();
        }
        Ok(())
    })
    .await
}

/// Keeps the unmanaged window on top. Under a plain X11 window manager a game raised
/// later can cover it; KWin needs nothing here. Raising never takes the focus.
#[cfg(target_os = "linux")]
fn raise(overlay: &WebviewWindow) {
    use gtk::prelude::*;

    let target = overlay.clone();
    let _ = overlay.run_on_main_thread(move || {
        if let Ok(window) = target.gtk_window() {
            if let Some(native) = window.window() {
                native.raise();
            }
            // A transparent X11 surface may stay unpainted until it is drawn again.
            window.queue_draw();
        }
    });
}

#[cfg(not(any(windows, target_os = "linux")))]
pub(crate) fn show_without_focus(overlay: &WebviewWindow) -> Result<(), String> {
    overlay.show().map_err(|error| error.to_string())
}

/// Windows, and Linux where GTK draws on X11 (the AppImage, which uses XWayland on
/// a Wayland desktop). Native Wayland gives a client no window that stays above a
/// full-screen game; the layer-shell protocol would, and is not used yet.
fn platform_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        !crate::quick_chat::native_wayland()
    }
    #[cfg(not(target_os = "linux"))]
    {
        cfg!(windows)
    }
}

#[tauri::command]
pub fn caption_overlay_supported(window: WebviewWindow) -> Result<bool, String> {
    sender(window.label(), "main")?;
    Ok(platform_supported())
}

// One open or close at a time: a close that has not finished must not look
// like an existing window to the next open (see set_vr_panel_window).
static LOCK: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());

/// Shows the overlay where the user dragged it, or on the band of `position` on the monitor
/// the main window is on, or removes it.
#[tauri::command]
pub async fn caption_overlay_set(
    window: WebviewWindow,
    app: tauri::AppHandle,
    open: bool,
    position: String,
    placement: Option<Placement>,
) -> Result<(), String> {
    sender(window.label(), "main")?;
    valid_position(&position)?;
    valid_placement(&placement)?;
    let _guard = LOCK.lock().await;
    let existing = app.get_webview_window(LABEL);
    if !open {
        // The watcher stops and gives the size keys back.
        GENERATION.fetch_add(1, Ordering::SeqCst);
        CTRL.store(false, Ordering::SeqCst);
        ADJUSTING.store(false, Ordering::SeqCst);
        if let Some(overlay) = existing {
            overlay.destroy().map_err(|error| error.to_string())?;
            for _ in 0..40 {
                if app.get_webview_window(LABEL).is_none() {
                    break;
                }
                tauri::async_runtime::spawn_blocking(|| {
                    std::thread::sleep(std::time::Duration::from_millis(50))
                })
                .await
                .map_err(|error| error.to_string())?;
            }
        }
        crate::companion::overlay_hidden(&app);
        return Ok(());
    }
    if !platform_supported() {
        return Err("caption_overlay_unsupported".into());
    }
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(window.primary_monitor().map_err(|error| error.to_string())?)
        .ok_or("caption_overlay_no_monitor")?;
    let area = |monitor: &tauri::Monitor| {
        let work = monitor.work_area();
        (work.position.x, work.position.y, work.size.width, work.size.height)
    };
    let works: Vec<_> = window.available_monitors().map_err(|error| error.to_string())?.iter().map(area).collect();
    let (x, y, width, height) = placed(&works, area(&monitor), &position, placement);
    let created = existing.is_none();
    let overlay = match existing {
        Some(overlay) => overlay,
        None => WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("caption-overlay.html".into()))
            .title(TITLE)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .visible(false)
            .additional_browser_args(super::BROWSER_ARGS)
            .build()
            .map_err(|error| error.to_string())?,
    };
    #[cfg(target_os = "linux")]
    prepare(&overlay).await?;
    // Clicks pass through unless the watcher sees Ctrl held right now.
    overlay.set_ignore_cursor_events(created || !CTRL.load(Ordering::SeqCst)).map_err(|error| error.to_string())?;
    overlay.set_position(PhysicalPosition::new(x, y)).map_err(|error| error.to_string())?;
    overlay.set_size(PhysicalSize::new(width, height)).map_err(|error| error.to_string())?;
    overlay.set_always_on_top(true).map_err(|error| error.to_string())?;
    if created {
        watch(app.clone());
    }
    #[cfg(target_os = "linux")]
    show_without_focus(&overlay).await?;
    #[cfg(not(target_os = "linux"))]
    show_without_focus(&overlay)?;
    // The experimental companion form puts its handle beside the band; elsewhere a no-op.
    crate::companion::overlay_shown(&app, &overlay, (x, y, width, height), &position).await
}

/// The main window hands over what to draw.
#[tauri::command]
pub fn caption_overlay_update(
    window: WebviewWindow,
    state: State<CaptionOverlayState>,
    snapshot: Snapshot,
) -> Result<(), String> {
    sender(window.label(), "main")?;
    validate(&snapshot)?;
    *state.0.lock().map_err(|_| "caption_overlay_unavailable")? = snapshot;
    // No overlay window yet is not an error: it reads the snapshot when it opens.
    let _ = window.app_handle().emit_to(LABEL, "caption-overlay-changed", ());
    #[cfg(target_os = "linux")]
    if let Some(overlay) = window.app_handle().get_webview_window(LABEL) {
        raise(&overlay);
    }
    Ok(())
}

/// The overlay page reads what to draw.
#[tauri::command]
pub fn caption_overlay_snapshot(
    window: WebviewWindow,
    state: State<CaptionOverlayState>,
) -> Result<Snapshot, String> {
    sender(window.label(), LABEL)?;
    let mut snapshot = state.0.lock().map_err(|_| "caption_overlay_unavailable")?.clone();
    snapshot.adjusting = ADJUSTING.load(Ordering::SeqCst);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line() -> Line {
        Line {
            id: "realtime:mic:1:session:item".into(),
            kind: "sent".into(),
            text: "こんにちは".into(),
            translations: vec!["Hello".into()],
            pending: false,
            speakers: Vec::new(),
            until: 1_800_000_000_000.0,
        }
    }

    fn heard(speakers: &[&str]) -> Snapshot {
        let mut value = snapshot();
        value.lines[0].kind = "received".into();
        value.lines[0].speakers = speakers.iter().map(|label| label.to_string()).collect();
        value
    }

    #[test]
    fn a_heard_line_may_name_up_to_four_voices_by_short_capital_labels() {
        for speakers in [vec![], vec!["A"], vec!["C", "B"], vec!["A", "B", "C", "AB"], vec!["ABC"]] {
            let value = heard(&speakers);
            assert!(validate(&value).is_ok(), "{speakers:?}");
            let copy: Snapshot = serde_json::from_value(serde_json::to_value(&value).unwrap()).unwrap();
            assert_eq!(copy, value);
        }
        // A line without speakers is written as before, so an older overlay page reads it.
        assert!(serde_json::to_value(heard(&[])).unwrap()["lines"][0].get("speakers").is_none());
        for speakers in [vec!["a"], vec![""], vec!["ABCD"], vec!["A1"], vec!["あ"], vec!["A", "B", "C", "D", "E"]] {
            assert_eq!(validate(&heard(&speakers)), Err("caption_overlay_invalid".into()), "{speakers:?}");
        }
        // The user's own words are one voice: a sent line that names speakers is refused.
        let mut own = heard(&["A"]);
        own.lines[0].kind = "sent".into();
        assert_eq!(validate(&own), Err("caption_overlay_invalid".into()));
    }

    fn snapshot() -> Snapshot {
        Snapshot { lines: vec![line()], ..Snapshot::default() }
    }

    #[test]
    fn only_the_main_window_writes_and_only_the_overlay_reads() {
        assert!(sender("main", "main").is_ok());
        assert!(sender(LABEL, LABEL).is_ok());
        for label in ["quick_chat", "vr_panel", LABEL, "unknown"] {
            assert_eq!(sender(label, "main"), Err("caption_overlay_forbidden".into()));
        }
        for label in ["main", "quick_chat", "vr_panel"] {
            assert_eq!(sender(label, LABEL), Err("caption_overlay_forbidden".into()));
        }
    }

    #[test]
    fn a_snapshot_roundtrips_and_old_lines_default_their_optional_fields() {
        let copy: Snapshot = serde_json::from_value(serde_json::to_value(snapshot()).unwrap()).unwrap();
        assert_eq!(copy, snapshot());
        let legacy = serde_json::json!({ "id": "a", "kind": "received", "text": "hi", "until": 5.0 });
        let line: Line = serde_json::from_value(legacy).unwrap();
        assert!(line.translations.is_empty() && !line.pending);
        assert!(validate(&snapshot()).is_ok());
        assert!(validate(&Snapshot::default()).is_ok());
    }

    #[test]
    fn a_snapshot_out_of_bounds_is_refused() {
        let cases: Vec<Box<dyn Fn(&mut Snapshot)>> = vec![
            Box::new(|s| s.position = "left".into()),
            Box::new(|s| s.font_size = 15),
            Box::new(|s| s.font_size = 73),
            Box::new(|s| s.opacity = 1.5),
            Box::new(|s| s.opacity = f32::NAN),
            Box::new(|s| s.font_family = " ".into()),
            Box::new(|s| s.font_family = "a\nb".into()),
            Box::new(|s| s.lines = vec![line(); MAX_LINES + 1]),
            Box::new(|s| s.lines[0].id.clear()),
            Box::new(|s| s.lines[0].kind = "system".into()),
            Box::new(|s| s.lines[0].text = "あ".repeat(MAX_TEXT + 1)),
            Box::new(|s| s.lines[0].translations = vec!["a".into(); MAX_TRANSLATIONS + 1]),
            Box::new(|s| s.lines[0].until = f64::INFINITY),
            Box::new(|s| s.lines[0].until = -1.0),
        ];
        for change in cases {
            let mut value = snapshot();
            change(&mut value);
            assert_eq!(validate(&value), Err("caption_overlay_invalid".into()));
        }
        // Long Japanese text is counted in characters, not bytes.
        let mut long = snapshot();
        long.lines[0].text = "あ".repeat(MAX_TEXT);
        assert!(validate(&long).is_ok());
    }

    fn flow() -> FlowItem {
        FlowItem {
            id: "realtime:mic:1:session:item".into(),
            input: "voice".into(),
            label: "声".into(),
            text: "こんにちは".into(),
            scale: 1000,
            rows: vec![
                FlowRow { kind: "stage".into(), label: "翻訳".into(), value: "210 ms".into(), start: 12, end: 222, off: false },
                FlowRow { kind: "speech".into(), label: "読み上げ".into(), value: "820 ms".into(), start: 0, end: 820, off: false },
                FlowRow { kind: "chatbox".into(), label: "チャットボックス".into(), value: "送らない".into(), start: 0, end: 0, off: true },
            ],
        }
    }

    #[test]
    fn the_flow_strip_roundtrips_and_is_left_out_while_off() {
        let mut value = snapshot();
        value.flow = vec![flow(), FlowItem { input: "chat".into(), ..flow() }];
        value.flow_note = "声の変換の往復 31 ms".into();
        assert!(validate(&value).is_ok());
        let copy: Snapshot = serde_json::from_value(serde_json::to_value(&value).unwrap()).unwrap();
        assert_eq!(copy, value);
        // Off, the snapshot is written as before, and an older main window's snapshot still reads.
        let plain = serde_json::to_value(snapshot()).unwrap();
        assert!(plain.get("flow").is_none() && plain.get("flow_note").is_none());
        let read: Snapshot = serde_json::from_value(plain).unwrap();
        assert!(read.flow.is_empty() && read.flow_note.is_empty());
    }

    #[test]
    fn a_flow_strip_out_of_bounds_is_refused() {
        let cases: Vec<Box<dyn Fn(&mut Snapshot)>> = vec![
            Box::new(|s| s.flow = vec![flow(); MAX_FLOW + 1]),
            Box::new(|s| s.flow[0].id.clear()),
            Box::new(|s| s.flow[0].input = "speaker".into()),
            Box::new(|s| s.flow[0].scale = 0),
            Box::new(|s| s.flow[0].scale = MAX_FLOW_SCALE + 1),
            Box::new(|s| s.flow[0].text = "あ".repeat(MAX_FLOW_TEXT + 1)),
            Box::new(|s| s.flow[0].label = "a\nb".into()),
            Box::new(|s| s.flow[0].rows = vec![s.flow[0].rows[0].clone(); MAX_FLOW_ROWS + 1]),
            Box::new(|s| s.flow[0].rows[0].kind = "image".into()),
            Box::new(|s| s.flow[0].rows[0].start = 300),
            Box::new(|s| s.flow[0].rows[1].end = 1001),
            Box::new(|s| s.flow_note = "x".repeat(MAX_FLOW_LABEL + 1)),
        ];
        for change in cases {
            let mut value = snapshot();
            value.flow = vec![flow()];
            change(&mut value);
            assert_eq!(validate(&value), Err("caption_overlay_invalid".into()));
        }
    }

    #[test]
    fn the_band_is_centred_and_stays_inside_the_work_area() {
        // A 1920x1080 monitor with a 48px taskbar at the bottom.
        let work = (0, 0, 1920, 1032);
        let (x, y, width, height) = band(work, "bottom");
        assert_eq!((x, width), (192, 1536));
        assert_eq!(height, 351);
        assert_eq!(y + height as i32, 1032 - 31);
        let (_, top, _, _) = band(work, "top");
        assert_eq!(top, 31);
        // A second monitor above the first one has a negative origin.
        let (x, y, width, height) = band((-1920, -1080, 1920, 1080), "bottom");
        assert!(x >= -1920 && x + width as i32 <= 0);
        assert!(y >= -1080 && y + height as i32 <= 0);
    }

    const PRIMARY: (i32, i32, u32, u32) = (0, 0, 1920, 1032);
    const LEFT: (i32, i32, u32, u32) = (-2560, 0, 2560, 1400);

    #[test]
    fn a_dragged_window_opens_where_it_was_left_sized_for_its_monitor() {
        let works = [PRIMARY, LEFT];
        // Not dragged: the band of the setting on the main window's monitor.
        assert_eq!(placed(&works, PRIMARY, "top", None), band(PRIMARY, "top"));
        // On the left monitor, with that monitor's band size.
        let (_, _, width, height) = band(LEFT, "bottom");
        assert_eq!(placed(&works, PRIMARY, "bottom", Some(Placement { x: -2000, y: 300 })), (-2000, 300, width, height));
        // Partly off the screen is fine while a grip of it is still on one.
        let (_, _, width, height) = band(PRIMARY, "bottom");
        assert_eq!(placed(&[PRIMARY], PRIMARY, "bottom", Some(Placement { x: 1800, y: 900 })), (1800, 900, width, height));
    }

    #[test]
    fn a_window_left_on_a_monitor_that_is_gone_comes_back_to_the_band() {
        // The left monitor was unplugged.
        assert_eq!(placed(&[PRIMARY], PRIMARY, "bottom", Some(Placement { x: -2000, y: 300 })), band(PRIMARY, "bottom"));
        // Less than the grip is left on screen.
        assert_eq!(placed(&[PRIMARY], PRIMARY, "top", Some(Placement { x: 1900, y: 100 })), band(PRIMARY, "top"));
        assert!(valid_placement(&Some(Placement { x: -PLACEMENT_LIMIT, y: PLACEMENT_LIMIT })).is_ok());
        assert!(valid_placement(&None).is_ok());
        assert_eq!(valid_placement(&Some(Placement { x: PLACEMENT_LIMIT + 1, y: 0 })), Err("caption_overlay_invalid".into()));
        assert_eq!(valid_placement(&Some(Placement { x: 0, y: i32::MIN })), Err("caption_overlay_invalid".into()));
    }

    const WINDOW: (i32, i32, u32, u32) = (100, 600, 800, 300);

    fn input(ctrl: bool, button: bool, cursor: (i32, i32)) -> Input {
        Input { ctrl, button, cursor }
    }

    /// Runs the inputs in order and returns the last state and every action.
    fn run(inputs: &[Input]) -> (Adjust, Vec<Action>) {
        let mut state = Adjust::default();
        let mut window = WINDOW;
        let mut actions = Vec::new();
        for value in inputs {
            let (next, done) = step(state, *value, window);
            for action in &done {
                if let Action::MoveTo(x, y) = action {
                    window.0 = *x;
                    window.1 = *y;
                }
            }
            state = next;
            actions.extend(done);
        }
        (state, actions)
    }

    #[test]
    fn clicks_pass_through_unless_ctrl_is_held() {
        // Moving the mouse and clicking without Ctrl never touches the window.
        let (state, actions) = run(&[input(false, false, (200, 700)), input(false, true, (250, 700))]);
        assert!(actions.is_empty() && state.drag.is_none());
        // Ctrl anywhere makes the window take the mouse; letting go gives it back.
        let (_, actions) = run(&[input(true, false, (5000, 5000)), input(false, false, (5000, 5000))]);
        assert_eq!(actions, vec![Action::ClickThrough(false), Action::ClickThrough(true)]);
    }

    #[test]
    fn the_size_keys_are_live_only_with_ctrl_held_over_the_window() {
        let (_, actions) = run(&[
            input(true, false, (5000, 5000)), // Ctrl held elsewhere: another program's Ctrl and -
            input(true, false, (200, 700)),
            input(true, false, (5000, 5000)),
            input(true, false, (200, 700)),
            input(false, false, (200, 700)),
        ]);
        assert_eq!(actions, vec![
            Action::ClickThrough(false),
            Action::Active(true), Action::Active(false), Action::Active(true),
            Action::ClickThrough(true), Action::Active(false),
        ]);
    }

    #[test]
    fn ctrl_and_a_drag_move_the_window_and_the_drop_is_saved() {
        let (state, actions) = run(&[
            input(true, false, (200, 700)),
            input(true, true, (200, 700)),
            input(true, true, (260, 650)),
            input(true, true, (5000, 100)), // the cursor may leave the window during a drag
            input(true, false, (5000, 100)),
            input(false, false, (5000, 100)),
        ]);
        // The window followed the cursor, so it stays active until Ctrl is let go.
        assert_eq!(actions, vec![
            Action::ClickThrough(false), Action::Active(true),
            Action::MoveTo(160, 550), Action::MoveTo(4900, 0),
            Action::Dropped(Placement { x: 4900, y: 0 }),
            Action::ClickThrough(true), Action::Active(false),
        ]);
        assert!(state.drag.is_none());
        // Letting go of Ctrl ends the drag too, and a click that moved nothing saves nothing.
        let (_, actions) = run(&[input(true, true, (200, 700)), input(true, true, (210, 700)), input(false, true, (220, 700))]);
        assert!(actions.contains(&Action::Dropped(Placement { x: 110, y: 600 })));
        let (_, actions) = run(&[input(true, false, (200, 700)), input(true, true, (200, 700)), input(true, false, (200, 700))]);
        assert!(!actions.iter().any(|action| matches!(action, Action::Dropped(_) | Action::MoveTo(..))));
    }

    #[test]
    fn a_button_held_before_ctrl_or_pressed_outside_never_starts_a_drag() {
        // A game's drag that is still held when Ctrl goes down.
        let (state, actions) = run(&[input(false, true, (200, 700)), input(true, true, (200, 700)), input(true, true, (300, 700))]);
        assert!(state.drag.is_none() && !actions.iter().any(|action| matches!(action, Action::MoveTo(..))));
        // Pressed beside the window, then moved over it.
        let (state, _) = run(&[input(true, false, (50, 50)), input(true, true, (50, 50)), input(true, true, (200, 700))]);
        assert!(state.drag.is_none());
    }

    #[test]
    fn a_drag_stays_inside_the_bound_the_settings_keep() {
        let (_, actions) = run(&[input(true, false, (200, 700)), input(true, true, (200, 700)), input(true, true, (i32::MAX, i32::MIN)), input(true, false, (0, 0))]);
        assert!(actions.contains(&Action::Dropped(Placement { x: PLACEMENT_LIMIT, y: -PLACEMENT_LIMIT })));
    }

    #[test]
    fn the_overlay_reads_whether_it_is_being_adjusted_and_the_main_window_cannot_set_it() {
        let mut value = snapshot();
        assert!(serde_json::to_value(&value).unwrap().get("adjusting").is_none());
        value.adjusting = true;
        assert_eq!(serde_json::to_value(&value).unwrap()["adjusting"], true);
        let mut written = serde_json::to_value(snapshot()).unwrap();
        written["adjusting"] = true.into();
        let read: Snapshot = serde_json::from_value(written).unwrap();
        assert!(!read.adjusting);
    }

    #[test]
    fn ctrl_and_plus_or_minus_change_the_size_by_one_step_either_way() {
        let keys = size_keys();
        assert_eq!(keys.iter().filter(|(_, change)| *change == 1).count(), 3);
        assert_eq!(keys.iter().filter(|(_, change)| *change == -1).count(), 2);
        use tauri_plugin_global_shortcut::Modifiers;
        assert!(keys.iter().all(|(shortcut, _)| shortcut.mods.contains(Modifiers::CONTROL)));
    }
}
