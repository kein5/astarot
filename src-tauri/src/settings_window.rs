//! The settings window (#1236): the settings in a window of their own, beside the main window.
//!
//! - There is at most one. Opening it when it is open brings it to the front instead; opening it
//!   at a page or a setting then sends it there (`settings-navigate`).
//! - The main window opens it (its settings button and every link to a setting), and so do the
//!   tray menu and the tray's control panel.
//! - It joins the main window's run of the backend (`backend_host::backend_attach`), so the two
//!   windows read the same answers.
//! - Closing it destroys it; the settings save by themselves (#1111), so nothing asks first. It
//!   has no "Go back": the main window is beside it. The main window hears whether it is open
//!   (`settings-window-changed`); nothing pauses while it is (decided on 2026-11-26).
//! - When the run it joined ends, it stays and joins the next one the main window starts
//!   (`settings-backend-run`).
//! - It remembers its own place and size, as the main window does (`SETTINGS_WINDOW_GEOMETRY`,
//!   saved by the page; `window_placement`). The first time, it is centred on the main window's
//!   monitor, at the main window's first size.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow};

pub const LABEL: &str = "settings";
/// What the main window hears when the settings window opens (true) or goes away (false).
pub const CHANGED_EVENT: &str = "settings-window-changed";
/// What an open settings window hears when it is asked to show a page or a setting.
pub const NAVIGATE_EVENT: &str = "settings-navigate";
/// What the settings window hears when the main window has started a run of the backend.
pub const RUN_EVENT: &str = "settings-backend-run";

// Its size before it goes to its place: the main window's own default (tauri.conf.json).
const DEFAULT_SIZE: (f64, f64) = (870.0, 654.0);
const MIN_SIZE: (f64, f64) = (400.0, 200.0);
// A page's id ("translation") and a setting's id or label are short words; anything else is not
// passed on to the page.
const MAX_PAGE: usize = 64;
const MAX_TARGET: usize = 256;

/// Whether a command the settings pages use may come from this window: the main window, which
/// showed the settings until #1236, or the settings window.
pub fn main_or_settings(label: &str) -> bool {
    label == "main" || label == LABEL
}

/// Where the settings window is asked to go: a page, and a setting on it to show.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Navigation {
    pub page: Option<String>,
    pub target: Option<String>,
}

impl Navigation {
    pub fn is_empty(&self) -> bool {
        self.page.is_none() && self.target.is_none()
    }
}

/// The navigation a new window takes when its page is ready.
#[derive(Default)]
pub struct SettingsWindowState {
    pending: Mutex<Option<Navigation>>,
}

/// A page and a setting as a request gives them, checked: a page id of lower-case letters, digits
/// and `_`, and a setting of plain text.
pub fn checked(page: Option<String>, target: Option<String>) -> Result<Navigation, String> {
    let page = page.filter(|page| !page.is_empty());
    let target = target.filter(|target| !target.trim().is_empty());
    let page_ok = page.as_deref().is_none_or(|page| {
        page.len() <= MAX_PAGE && page.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    });
    let target_ok = target.as_deref().is_none_or(|target| target.chars().count() <= MAX_TARGET && !target.chars().any(char::is_control));
    if page_ok && target_ok { Ok(Navigation { page, target }) } else { Err("settings_window_invalid".into()) }
}

/// Opens the settings window, or brings it to the front, and sends it to `navigation`.
/// `focus` false leaves the focus where it is (the VR panel's settings open it so).
pub fn open(app: &AppHandle, navigation: Navigation, focus: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        if focus {
            let _ = window.set_focus();
        }
        if !navigation.is_empty() {
            app.emit_to(LABEL, NAVIGATE_EVENT, navigation).map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    *app.state::<SettingsWindowState>().pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) =
        (!navigation.is_empty()).then_some(navigation);
    let main = app.get_webview_window("main");
    let window = crate::webview_environment::window(app, LABEL, WebviewUrl::App("settings.html".into()))
        .title("ASTAROT")
        .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .decorations(false)
        .transparent(main_is_transparent(app))
        .shadow(false)
        .focused(focus)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    let saved = std::env::current_exe().ok().and_then(|executable| {
        crate::window_placement::saved(&crate::backend_host::state_dir(&executable), crate::window_placement::SETTINGS_KEY)
    });
    crate::window_placement::apply_saved(&window, saved, main.as_ref().unwrap_or(&window));
    window.show().map_err(|error| error.to_string())?;
    if focus {
        let _ = window.set_focus();
    }
    let _ = app.emit_to("main", CHANGED_EVENT, true);
    Ok(())
}

/// The settings window went away: it reads no more lines, and the main window hears it.
pub fn closed(app: &AppHandle) {
    app.state::<crate::backend_host::BackendHost>().detach();
    *app.state::<SettingsWindowState>().pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    let _ = app.emit_to("main", CHANGED_EVENT, false);
}

/// The main window's look (tauri.conf.json): the app draws its own title bar and corners on a
/// transparent window, made opaque where transparency fails (lib.rs). The settings window follows.
fn main_is_transparent(app: &AppHandle) -> bool {
    app.config().app.windows.iter().find(|window| window.label == "main").is_none_or(|window| window.transparent)
}

/// The main window opens the settings window at a page or a setting, or brings it to the front.
/// Async: a window made from a command that is not async can hang Windows.
#[tauri::command]
pub async fn settings_window_open(
    window: WebviewWindow,
    app: AppHandle,
    page: Option<String>,
    target: Option<String>,
    focus: Option<bool>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("settings_window_forbidden".into());
    }
    let navigation = checked(page, target)?;
    open(&app, navigation, focus.unwrap_or(true))
}

/// The settings window takes where it was asked to go when it was made, once.
#[tauri::command]
pub fn settings_window_take_navigation(window: WebviewWindow, state: tauri::State<'_, SettingsWindowState>) -> Result<Option<Navigation>, String> {
    if window.label() != LABEL {
        return Err("settings_window_forbidden".into());
    }
    Ok(state.pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take())
}

/// Whether the settings window is open: the main window asks when it starts again (a reload).
#[tauri::command]
pub fn settings_window_is_open(window: WebviewWindow, app: AppHandle) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("settings_window_forbidden".into());
    }
    Ok(app.get_webview_window(LABEL).is_some())
}

/// The main window closes the settings window: the VR panel's settings, which opened it, closed.
#[tauri::command]
pub async fn settings_window_close(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    if window.label() != "main" {
        return Err("settings_window_forbidden".into());
    }
    if let Some(settings) = app.get_webview_window(LABEL) {
        settings.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// The main window has started a run: an open settings window joins it, when the run it read has
/// ended.
pub fn run_started(app: &AppHandle) {
    if app.get_webview_window(LABEL).is_some() {
        let _ = app.emit_to(LABEL, RUN_EVENT, ());
    }
}

/// What the settings window may hand to the main window, which runs Quick Chat and the hotkeys:
/// Quick Chat to open (the Hotkeys page's button), and the hotkeys to pause while the Hotkeys page
/// is shown and to resume after it, so a key pressed to record it does not act.
pub const HAND_OVER_EVENT: &str = "settings-hand-over";
const HAND_OVER: [&str; 3] = ["open_quick_chat", "pause_hotkeys", "resume_hotkeys"];

#[tauri::command]
pub async fn settings_window_hand_over(window: WebviewWindow, app: AppHandle, action: String) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("settings_window_forbidden".into());
    }
    if !HAND_OVER.contains(&action.as_str()) {
        return Err("settings_window_invalid".into());
    }
    app.emit_to("main", HAND_OVER_EVENT, action).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{Navigation, checked};

    #[test]
    fn a_page_is_an_id_and_a_setting_plain_text() {
        assert_eq!(checked(None, None), Ok(Navigation::default()));
        assert_eq!(checked(Some("transcription".into()), Some("speechcpp_section".into())),
            Ok(Navigation { page: Some("transcription".into()), target: Some("speechcpp_section".into()) }));
        // A setting may be found by its label, in any language.
        assert_eq!(checked(None, Some("音声認識の言語".into())), Ok(Navigation { page: None, target: Some("音声認識の言語".into()) }));
        // Empty parts are no part.
        assert_eq!(checked(Some(String::new()), Some("  ".into())), Ok(Navigation::default()));
        for (page, target) in [
            (Some("Translation".into()), None),
            (Some("../vr".into()), None),
            (Some("a".repeat(65)), None),
            (None, Some("line\\nbreak".replace("\\n", "\n"))),
            (None, Some("x".repeat(257))),
        ] {
            assert_eq!(checked(page.clone(), target.clone()), Err("settings_window_invalid".into()), "{page:?} {target:?}");
        }
        assert!(Navigation::default().is_empty());
        assert!(!Navigation { page: Some("vr".into()), target: None }.is_empty());
    }
}
