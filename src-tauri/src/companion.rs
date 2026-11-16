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
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};

pub const PANEL: &str = "companion_panel";
pub const HANDLE: &str = "companion_handle";
const PANEL_TITLE: &str = "VRCT-VOX Control Panel";
const HANDLE_TITLE: &str = "VRCT-VOX Captions Handle";
/// The panel, in logical px.
const PANEL_SIZE: (f64, f64) = (300.0, 208.0);
/// The handle's square side and its distance from the caption band, in logical px.
const HANDLE_SIZE: f64 = 28.0;
const HANDLE_GAP: f64 = 6.0;
/// A click on the tray icon first takes the focus from the open panel, which hides
/// it; the click that follows must not open it again.
const REOPEN_GUARD: Duration = Duration::from_millis(400);
const MAX_ACTIONS: usize = 8;
const MAX_LABEL: usize = 80;
const LANGUAGES: [&str; 5] = ["en", "ja", "ko", "zh-Hans", "zh-Hant"];
/// What the panel and the tray may ask the main window to do.
const ACTIONS: [&str; 2] = ["toggle_mic", "toggle_translation"];

/// The id in the experimental features list (src-ui/logics/configs/experimentalFeatures.ts,
/// src-python/models/experimental_features.py, native/core/src/config/schema.rs).
pub const FEATURE_ID: &str = "tray_companion";

static ENABLED: AtomicBool = AtomicBool::new(false);

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

/// At launch: the feature was on when the app last saved its settings in `state_dir`.
pub fn starts_in_tray(state_dir: &Path) -> bool {
    let on = std::fs::read_to_string(state_dir.join("config.json")).is_ok_and(|text| saved_on(&text));
    ENABLED.store(on, Ordering::SeqCst);
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
}

/// What the main window reports. Only switches and words of the UI: no captions.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Status {
    /// The backend is running and the switches can be used.
    ready: bool,
    mic: Switch,
    translation: Switch,
    language: String,
    menu: MenuLabels,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            ready: false,
            mic: Switch::default(),
            translation: Switch::default(),
            language: "en".into(),
            menu: MenuLabels {
                start: "Start recognition".into(),
                stop: "Stop recognition".into(),
                panel: "Open control panel".into(),
                main: "Open VRCT-VOX".into(),
                quit: "Quit".into(),
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
        || ![&menu.start, &menu.stop, &menu.panel, &menu.main, &menu.quit].iter().all(|label| valid_label(label))
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
}

#[derive(Default)]
pub struct CompanionState(Mutex<Inner>);

impl CompanionState {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
        self.0.lock().map_err(|_| "companion_unavailable".to_string())
    }
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
    if !ACTIONS.contains(&action) {
        return Err("companion_invalid".into());
    }
    let state = app.state::<CompanionState>();
    let mut inner = state.lock()?;
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

/// The handle sits just right of the caption band, level with its last line:
/// outside the band, so it never covers a caption.
fn handle_position(band: (i32, i32, u32, u32), at_top: bool, size: u32, gap: i32) -> (i32, i32) {
    let (x, y, width, height) = band;
    let left = x + width as i32 + gap;
    let top = if at_top { y } else { y + height as i32 - size as i32 };
    (left, top)
}

fn build_panel<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<WebviewWindow<R>> {
    WebviewWindowBuilder::new(manager, PANEL, WebviewUrl::App("companion-panel.html".into()))
        .title(PANEL_TITLE)
        .inner_size(PANEL_SIZE.0, PANEL_SIZE.1)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .additional_browser_args(crate::BROWSER_ARGS)
        .build()
}

/// Opens the panel at `anchor`, or closes it when it is open.
pub(crate) fn toggle_panel<R: Runtime>(app: &AppHandle<R>, anchor: Anchor) -> Result<(), String> {
    let state = app.state::<CompanionState>();
    let existing = app.get_webview_window(PANEL);
    if let Some(panel) = &existing {
        if panel.is_visible().unwrap_or(false) {
            state.lock()?.panel_hidden_at = Some(Instant::now());
            return panel.hide().map_err(|error| error.to_string());
        }
    }
    if state.lock()?.panel_hidden_at.take().is_some_and(|at| at.elapsed() < REOPEN_GUARD) {
        return Ok(());
    }
    let panel = match existing {
        Some(panel) => panel,
        None => build_panel(app).map_err(|error| error.to_string())?,
    };
    let monitor = app
        .monitor_from_point(anchor.right, anchor.top)
        .map_err(|error| error.to_string())?
        .or(app.primary_monitor().map_err(|error| error.to_string())?)
        .ok_or("companion_no_monitor")?;
    let scale = monitor.scale_factor();
    let size = ((PANEL_SIZE.0 * scale).round() as u32, (PANEL_SIZE.1 * scale).round() as u32);
    let work = monitor.work_area();
    let (x, y) = place(anchor, size, (work.position.x, work.position.y, work.size.width, work.size.height));
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

/// The caption overlay was placed over `band`: put the handle beside it.
pub(crate) async fn overlay_shown(
    app: &AppHandle,
    overlay: &WebviewWindow,
    band: (i32, i32, u32, u32),
    position: &str,
) -> Result<(), String> {
    if !enabled() {
        return Ok(());
    }
    let scale = overlay.scale_factor().map_err(|error| error.to_string())?;
    let size = (HANDLE_SIZE * scale).round() as u32;
    let gap = (HANDLE_GAP * scale).round() as i32;
    let (x, y) = handle_position(band, position == "top", size, gap);
    let handle = match app.get_webview_window(HANDLE) {
        Some(handle) => handle,
        None => WebviewWindowBuilder::new(app, HANDLE, WebviewUrl::App("companion-handle.html".into()))
            .title(HANDLE_TITLE)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            // Clicked, never focused: the game under the captions keeps the keyboard.
            .focusable(false)
            .visible(false)
            .additional_browser_args(crate::BROWSER_ARGS)
            .build()
            .map_err(|error| error.to_string())?,
    };
    #[cfg(target_os = "linux")]
    crate::caption_overlay::prepare(&handle).await?;
    handle.set_position(PhysicalPosition::new(x, y)).map_err(|error| error.to_string())?;
    handle.set_size(PhysicalSize::new(size, size)).map_err(|error| error.to_string())?;
    handle.set_always_on_top(true).map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    {
        crate::caption_overlay::show_without_focus(&handle).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        crate::caption_overlay::show_without_focus(&handle)
    }
}

/// The caption overlay was removed: the handle goes with it.
pub(crate) fn overlay_hidden<R: Runtime>(app: &AppHandle<R>) {
    if let Some(handle) = app.get_webview_window(HANDLE) {
        let _ = handle.destroy();
    }
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

/// Turns the feature on: the tray icon, and the panel made hidden so that the first click
/// opens it at once. Doing it twice changes nothing.
pub(crate) fn install(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<CompanionState>();
    if state.lock()?.tray.is_none() {
        let items = tray::install(app).map_err(|error| error.to_string())?;
        state.lock()?.tray = Some(items);
    }
    if app.get_webview_window(PANEL).is_none() {
        build_panel(app).map_err(|error| error.to_string())?;
    }
    // Only now: a failed start leaves the feature off for every command.
    ENABLED.store(true, Ordering::SeqCst);
    Ok(())
}

/// Turns the feature off: the tray icon, the panel and the handle go, and the main window
/// comes back if it was hidden in the tray.
pub(crate) fn uninstall(app: &AppHandle) -> Result<(), String> {
    ENABLED.store(false, Ordering::SeqCst);
    let state = app.state::<CompanionState>();
    {
        let mut inner = state.lock()?;
        inner.tray = None;
        inner.actions.clear();
        inner.panel_hidden_at = None;
    }
    let _ = app.remove_tray_by_id(tray::TRAY);
    for label in [PANEL, HANDLE] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.destroy();
        }
    }
    show_main(app)
}

mod tray {
    use super::{request, show_main, toggle_panel, Anchor, CompanionState, Status};
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{AppHandle, Emitter, Manager, Wry};

    pub const TRAY: &str = "companion";

    pub struct Items {
        toggle: MenuItem<Wry>,
        panel: MenuItem<Wry>,
        main: MenuItem<Wry>,
        quit: MenuItem<Wry>,
    }

    fn log(result: Result<(), String>, what: &str) {
        if let Err(error) = result {
            crate::startup_log(&format!("Tray companion {what} failed: {error}"));
        }
    }

    pub fn install(app: &AppHandle) -> tauri::Result<Items> {
        // The main window sends the words in the UI language once the backend is ready.
        let labels = app.state::<CompanionState>().lock().map(|inner| inner.status.menu.clone())
            .unwrap_or_else(|_| Status::default().menu);
        // Until the backend is ready there is nothing to start.
        let toggle = MenuItem::with_id(app, "toggle", &labels.start, false, None::<&str>)?;
        let panel = MenuItem::with_id(app, "panel", &labels.panel, true, None::<&str>)?;
        let main = MenuItem::with_id(app, "main", &labels.main, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", &labels.quit, true, None::<&str>)?;
        let menu = Menu::with_items(
            app,
            &[&toggle, &PredefinedMenuItem::separator(app)?, &panel, &main,
              &PredefinedMenuItem::separator(app)?, &quit],
        )?;
        let mut builder = TrayIconBuilder::with_id(TRAY)
            .tooltip("VRCT-VOX")
            .menu(&menu)
            // Left click opens the panel; the menu is on the right button.
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "toggle" => log(request(app, "toggle_mic"), "toggle"),
                "panel" => open_panel_near_cursor(app),
                "main" => log(show_main(app), "main window"),
                "quit" => quit_app(app),
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
        Ok(Items { toggle, panel, main, quit })
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
            crate::startup_log("Tray companion quit: main window did not close in time");
            app.exit(0);
        });
    }

    pub fn refresh(app: &AppHandle, status: &Status) {
        let state = app.state::<CompanionState>();
        let Ok(inner) = state.lock() else { return };
        let Some(items) = &inner.tray else { return };
        let menu = &status.menu;
        let _ = items.toggle.set_text(if status.mic.on { &menu.stop } else { &menu.start });
        let _ = items.toggle.set_enabled(status.ready && !status.mic.pending);
        let _ = items.panel.set_text(&menu.panel);
        let _ = items.main.set_text(&menu.main);
        let _ = items.quit.set_text(&menu.quit);
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
    if enabled {
        install(&app).inspect_err(|error| crate::startup_log(&format!("Tray companion could not start: {error}")))
    } else if self::enabled() || app.state::<CompanionState>().lock()?.tray.is_some() {
        uninstall(&app)
    } else {
        Ok(())
    }
}
/// The main window reports the switches and the words of the panel and the tray.
#[tauri::command]
pub fn companion_publish(window: WebviewWindow, state: State<CompanionState>, status: Status) -> Result<(), String> {
    sender(window.label(), &["main"])?;
    validate(&status)?;
    state.lock()?.status = status.clone();
    let app = window.app_handle();
    tray::refresh(app, &status);
    // The panel or the handle may not exist yet: they read the state when they open.
    let _ = app.emit_to(PANEL, "companion-changed", ());
    let _ = app.emit_to(HANDLE, "companion-changed", ());
    Ok(())
}

/// The main window takes what the panel or the tray asked for.
#[tauri::command]
pub fn companion_take(window: WebviewWindow, state: State<CompanionState>) -> Result<Vec<String>, String> {
    sender(window.label(), &["main"])?;
    Ok(state.lock()?.actions.drain(..).collect())
}

/// The main window needs the user, for a consent dialog for example.
#[tauri::command]
pub fn companion_show_main(window: WebviewWindow) -> Result<(), String> {
    sender(window.label(), &["main"])?;
    show_main(window.app_handle())
}

/// Closing the main window only hides it: the app stays in the tray. The main
/// window has no hide permission of its own, and ordinary launches keep it so.
#[tauri::command]
pub fn companion_hide_main(window: WebviewWindow) -> Result<(), String> {
    sender(window.label(), &["main"])?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn companion_status(window: WebviewWindow, state: State<CompanionState>) -> Result<Status, String> {
    sender(window.label(), &[PANEL, HANDLE])?;
    Ok(state.lock()?.status.clone())
}

/// The panel asks for a switch to change, or for the main window.
#[tauri::command]
pub fn companion_request(window: WebviewWindow, action: String) -> Result<(), String> {
    sender(window.label(), &[PANEL])?;
    if action == "open_main" {
        let _ = window.hide();
        return show_main(window.app_handle());
    }
    request(window.app_handle(), &action)
}

#[tauri::command]
pub fn companion_panel_hide(window: WebviewWindow) -> Result<(), String> {
    sender(window.label(), &[PANEL])?;
    window.hide().map_err(|error| error.to_string())
}

/// The handle beside the captions opens the panel next to itself.
#[tauri::command]
pub async fn companion_panel_toggle(window: WebviewWindow) -> Result<(), String> {
    sender(window.label(), &[HANDLE])?;
    let at = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let gap = HANDLE_GAP * window.scale_factor().map_err(|error| error.to_string())?;
    let anchor = Anchor {
        right: f64::from(at.x) + f64::from(size.width),
        top: f64::from(at.y) - gap,
        bottom: f64::from(at.y) + f64::from(size.height) + gap,
    };
    toggle_panel(window.app_handle(), anchor)
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

    #[test]
    fn the_handle_sits_outside_the_band_level_with_the_last_line() {
        let band = (192, 650, 1536, 351);
        assert_eq!(handle_position(band, false, 28, 6), (192 + 1536 + 6, 650 + 351 - 28));
        assert_eq!(handle_position(band, true, 28, 6), (1734, 650));
    }
}
