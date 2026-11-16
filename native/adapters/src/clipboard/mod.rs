//! The clipboard with automatic paste into the game window.
//!
//! The same behaviour as `src-python/models/clipboard/`:
//!
//! - The text is always copied when it can be, so the user can paste it by hand.
//! - The automatic paste (Ctrl+V) is sent only when the target window actually came
//!   to the front; otherwise the keys would reach whatever else has focus.
//! - The target is the window named in the call, or else the name of the game SteamVR
//!   runs ([`VrAppName`], asked at each paste). Windows matches a window title (case-insensitive substring), then a process
//!   name. Linux finds X11/XWayland windows by title (exact, then substring), then by
//!   class or process name, asks the window manager to activate it and sends the keys
//!   through XTest over one kept connection (desktops grant input per connection).
//! - Windows copies with `clip.exe` (UTF-16LE with a BOM); Linux with `wl-copy`,
//!   `xclip`, `xsel` or Klipper, in pyperclip's order.
//!
//! Neither the text nor the window name is logged.

pub mod copy;
#[cfg(windows)]
pub mod windows;
#[cfg(target_os = "linux")]
pub mod x11;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::log;

/// How long the focused window gets to be able to read the clipboard.
pub const FOCUS_SETTLE: Duration = Duration::from_millis(200);

/// The desktop connection broke; it is closed and opened again next time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesktopBroken;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    /// The window is in front.
    Focused,
    /// No such window, or it did not come forward.
    NotFocused,
    /// Automatic paste is not possible here (no X11 display, no XTest).
    Unavailable,
}

/// What a desktop can do. The real ones are chosen by [`Clipboard::new`]; tests
/// give a stand-in.
pub trait Desktop: Send {
    /// Windows brings the window forward before copying; X11 copies first.
    fn focuses_before_copy(&self) -> bool;
    fn copy(&mut self, text: &str) -> bool;
    fn focus(&mut self, window_name: &str) -> Result<Focus, DesktopBroken>;
    /// Send Ctrl+V to the window in front, after `countdown` seconds.
    fn paste(&mut self, countdown: u32) -> Result<bool, DesktopBroken>;
}

/// The name of the game SteamVR runs (its scene application), read through the OpenVR
/// connection the overlays share. The host provides this; `None` while SteamVR does not
/// run or runs no game. It is asked on every paste that names no window.
pub trait VrAppName: Send + Sync {
    fn running_app_name(&self) -> Option<String>;
}

/// No OpenVR: no app name, so a call without a window name only copies.
pub struct NoVrAppName;

impl VrAppName for NoVrAppName {
    fn running_app_name(&self) -> Option<String> {
        None
    }
}

/// Whether a process called `name` runs. `false` when that cannot be known.
pub fn is_process_running(name: &str) -> bool {
    #[cfg(windows)]
    {
        windows::is_process_running(name)
    }
    #[cfg(target_os = "linux")]
    {
        let Ok(entries) = std::fs::read_dir("/proc") else { return false };
        entries.flatten().any(|entry| {
            let is_pid = entry.file_name().to_str().is_some_and(|n| n.bytes().all(|b| b.is_ascii_digit()));
            is_pid
                && std::fs::read_to_string(entry.path().join("comm"))
                    .is_ok_and(|comm| comm.trim_end_matches('\n') == name)
        })
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = name;
        false
    }
}

/// The desktop of this platform.
pub fn system_desktop() -> Box<dyn Desktop> {
    #[cfg(windows)]
    {
        Box::new(windows::WindowsDesktop::default())
    }
    #[cfg(target_os = "linux")]
    {
        Box::new(x11::X11Desktop::default())
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Box::new(CopyOnlyDesktop)
    }
}

/// Copy only: automatic paste is not supported on this system.
pub struct CopyOnlyDesktop;

impl Desktop for CopyOnlyDesktop {
    fn focuses_before_copy(&self) -> bool {
        true
    }

    fn copy(&mut self, text: &str) -> bool {
        copy::copy_to_clipboard(text)
    }

    fn focus(&mut self, _window_name: &str) -> Result<Focus, DesktopBroken> {
        Ok(Focus::NotFocused)
    }

    fn paste(&mut self, _countdown: u32) -> Result<bool, DesktopBroken> {
        Ok(false)
    }
}

pub struct Clipboard {
    desktop: Mutex<Box<dyn Desktop>>,
    vr: Arc<dyn VrAppName>,
}

impl Clipboard {
    /// The clipboard of this system.
    pub fn new(vr: Arc<dyn VrAppName>) -> Self {
        Self::with_desktop(system_desktop(), vr)
    }

    /// A clipboard over `desktop`. `vr` is asked for the game on every paste without a
    /// window name (Python read it once when SteamVR started, before the game ran).
    pub fn with_desktop(desktop: Box<dyn Desktop>, vr: Arc<dyn VrAppName>) -> Self {
        Self { desktop: Mutex::new(desktop), vr }
    }

    /// The name of the game SteamVR runs now, if any.
    pub fn app_name(&self) -> Option<String> {
        self.vr.running_app_name()
    }

    /// Copy `message`, and paste it into `window_name` (or the SteamVR app) when that
    /// window came to the front. True only when the paste was sent.
    pub fn copy_and_paste(&self, message: &str, window_name: Option<&str>, countdown: u32) -> bool {
        let window_name = window_name.map(str::to_string).or_else(|| self.app_name());
        let mut desktop = self.desktop.lock().unwrap_or_else(|e| e.into_inner());
        if desktop.focuses_before_copy() {
            // Focusing another process's window is a privilege the OS does not always
            // grant; the text is copied either way for a manual paste.
            let focused = match &window_name {
                Some(name) => matches!(desktop.focus(name), Ok(Focus::Focused)),
                None => false,
            };
            if window_name.is_some() && !focused {
                log::line("copy_and_paste: could not focus the target window; copying only");
            } else if focused {
                thread::sleep(FOCUS_SETTLE);
            }
            if !desktop.copy(message) {
                log::line("copy_and_paste: failed to copy to clipboard");
                return false;
            }
            if !focused {
                return false;
            }
            return desktop.paste(countdown).unwrap_or(false);
        }
        if !desktop.copy(message) {
            log::line("copy_and_paste: failed to copy to clipboard");
            return false;
        }
        let Some(name) = window_name else { return false };
        match desktop.focus(&name) {
            Ok(Focus::Focused) => {}
            Ok(Focus::Unavailable) => {
                log::line("copy_and_paste: X11 is not available; copying only");
                return false;
            }
            Ok(Focus::NotFocused) => {
                log::line("copy_and_paste: could not focus the target window; copying only");
                return false;
            }
            Err(DesktopBroken) => {
                log::line("copy_and_paste: paste failed");
                return false;
            }
        }
        // Let the window that came forward read the clipboard.
        thread::sleep(FOCUS_SETTLE);
        match desktop.paste(countdown) {
            Ok(pasted) => pasted,
            Err(DesktopBroken) => {
                log::line("copy_and_paste: paste failed");
                false
            }
        }
    }
}
