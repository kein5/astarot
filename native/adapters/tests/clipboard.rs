//! Mirrors [`src-python/test/test_clipboard_focus_and_paste.py`]: the order of focus,
//! copy and paste, and what happens when any of them fails. A stand-in desktop
//! records the steps; nothing touches the real clipboard or sends real keys.
//!
//! [`src-python/test/test_clipboard_focus_and_paste.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_clipboard_focus_and_paste.py

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use vrct_adapters::clipboard::copy::{choose_tool, Tool};
use vrct_adapters::clipboard::{Clipboard, Desktop, DesktopBroken, Focus, NoVrAppName, VrAppName};

#[derive(Clone, Debug, PartialEq)]
enum Step {
    Focus(String),
    Copy(String),
    Paste(u32),
}

struct Fake {
    windows_style: bool,
    copy_ok: bool,
    focus: Vec<Result<Focus, DesktopBroken>>,
    paste: Result<bool, DesktopBroken>,
    steps: Arc<Mutex<Vec<Step>>>,
}

impl Desktop for Fake {
    fn focuses_before_copy(&self) -> bool {
        self.windows_style
    }
    fn copy(&mut self, text: &str) -> bool {
        self.steps.lock().unwrap().push(Step::Copy(text.into()));
        self.copy_ok
    }
    fn focus(&mut self, window_name: &str) -> Result<Focus, DesktopBroken> {
        self.steps.lock().unwrap().push(Step::Focus(window_name.into()));
        if self.focus.len() > 1 {
            self.focus.remove(0)
        } else {
            self.focus[0]
        }
    }
    fn paste(&mut self, countdown: u32) -> Result<bool, DesktopBroken> {
        self.steps.lock().unwrap().push(Step::Paste(countdown));
        self.paste
    }
}

fn clipboard(
    windows_style: bool,
    copy_ok: bool,
    focus: Vec<Result<Focus, DesktopBroken>>,
) -> (Clipboard, Arc<Mutex<Vec<Step>>>) {
    let steps = Arc::new(Mutex::new(Vec::new()));
    let fake = Fake { windows_style, copy_ok, focus, paste: Ok(true), steps: steps.clone() };
    (Clipboard::with_desktop(Box::new(fake), Arc::new(NoVrAppName)), steps)
}

fn steps(recorded: &Arc<Mutex<Vec<Step>>>) -> Vec<Step> {
    recorded.lock().unwrap().clone()
}

// ---------------------------------------------------------------- Windows

#[test]
fn windows_copies_even_when_no_window_can_be_focused() {
    let (clipboard, recorded) = clipboard(true, true, vec![Ok(Focus::NotFocused)]);
    assert!(!clipboard.copy_and_paste("text", Some("VRChat"), 0));
    assert_eq!(steps(&recorded), vec![Step::Focus("VRChat".into()), Step::Copy("text".into())]);
}

#[test]
fn windows_focuses_then_copies_then_pastes() {
    let (clipboard, recorded) = clipboard(true, true, vec![Ok(Focus::Focused)]);
    let started = Instant::now();
    assert!(clipboard.copy_and_paste("text", Some("VRChat"), 3));
    assert!(started.elapsed() >= Duration::from_millis(200), "the focus settles first");
    assert_eq!(steps(&recorded), vec![Step::Focus("VRChat".into()), Step::Copy("text".into()), Step::Paste(3)]);
}

#[test]
fn windows_without_a_window_name_only_copies() {
    let (clipboard, recorded) = clipboard(true, true, vec![Ok(Focus::Focused)]);
    assert!(!clipboard.copy_and_paste("text", None, 0));
    assert_eq!(steps(&recorded), vec![Step::Copy("text".into())]);
}

#[test]
fn windows_a_failed_copy_sends_no_keys() {
    let (clipboard, recorded) = clipboard(true, false, vec![Ok(Focus::Focused)]);
    assert!(!clipboard.copy_and_paste("text", Some("VRChat"), 0));
    assert!(!steps(&recorded).iter().any(|s| matches!(s, Step::Paste(_))));
}

// ---------------------------------------------------------------- X11

#[test]
fn x11_copies_then_brings_the_window_forward_before_the_keys() {
    let (clipboard, recorded) = clipboard(false, true, vec![Ok(Focus::Focused)]);
    assert!(clipboard.copy_and_paste("text", Some("VRChat"), 0));
    assert_eq!(steps(&recorded), vec![Step::Copy("text".into()), Step::Focus("VRChat".into()), Step::Paste(0)]);
}

#[test]
fn x11_sends_no_keys_unless_the_window_came_forward() {
    for focus in [Ok(Focus::NotFocused), Ok(Focus::Unavailable), Err(DesktopBroken)] {
        let (clipboard, recorded) = clipboard(false, true, vec![focus]);
        assert!(!clipboard.copy_and_paste("text", Some("VRChat"), 0));
        assert_eq!(steps(&recorded), vec![Step::Copy("text".into()), Step::Focus("VRChat".into())], "{focus:?}");
    }
}

#[test]
fn x11_without_a_known_game_window_only_copies() {
    let (clipboard, recorded) = clipboard(false, true, vec![Ok(Focus::Focused)]);
    assert!(!clipboard.copy_and_paste("text", None, 0));
    assert_eq!(steps(&recorded), vec![Step::Copy("text".into())]);
}

#[test]
fn x11_a_failed_copy_sends_nothing() {
    let (clipboard, recorded) = clipboard(false, false, vec![Ok(Focus::Focused)]);
    assert!(!clipboard.copy_and_paste("text", Some("VRChat"), 0));
    assert_eq!(steps(&recorded), vec![Step::Copy("text".into())]);
}

#[test]
fn x11_a_broken_connection_fails_once_and_the_next_paste_works() {
    let (clipboard, recorded) = clipboard(false, true, vec![Err(DesktopBroken), Ok(Focus::Focused)]);
    assert!(!clipboard.copy_and_paste("first", Some("VRChat"), 0));
    assert!(clipboard.copy_and_paste("second", Some("VRChat"), 0));
    assert_eq!(steps(&recorded).last(), Some(&Step::Paste(0)));
}

// ---------------------------------------------------------------- SteamVR app name

/// The game SteamVR runs, as the test sets it; counts how often it is asked.
#[derive(Default)]
struct Named {
    name: Mutex<Option<String>>,
    asked: Mutex<usize>,
}

impl VrAppName for Named {
    fn running_app_name(&self) -> Option<String> {
        *self.asked.lock().unwrap() += 1;
        self.name.lock().unwrap().clone()
    }
}

#[test]
fn the_game_steamvr_runs_is_the_target() {
    for windows_style in [true, false] {
        let steps_seen = Arc::new(Mutex::new(Vec::new()));
        let fake = Fake {
            windows_style,
            copy_ok: true,
            focus: vec![Ok(Focus::Focused)],
            paste: Ok(true),
            steps: steps_seen.clone(),
        };
        let vr = Arc::new(Named::default());
        *vr.name.lock().unwrap() = Some("VRChat".into());
        let clipboard = Clipboard::with_desktop(Box::new(fake), vr.clone());
        assert_eq!(clipboard.app_name().as_deref(), Some("VRChat"));
        assert!(clipboard.copy_and_paste("text", None, 0));
        assert!(steps(&steps_seen).contains(&Step::Focus("VRChat".into())));
        assert_eq!(steps(&steps_seen).last(), Some(&Step::Paste(0)));
        // A name given in the call wins, and SteamVR is not asked.
        let asked = *vr.asked.lock().unwrap();
        let before = steps(&steps_seen).len();
        assert!(clipboard.copy_and_paste("text", Some("Other"), 0));
        let after = steps(&steps_seen);
        assert!(after[before..].contains(&Step::Focus("Other".into())));
        assert!(!after[before..].contains(&Step::Focus("VRChat".into())));
        assert_eq!(*vr.asked.lock().unwrap(), asked);
    }
}

#[test]
fn the_game_is_looked_up_again_at_each_paste() {
    // Python read the name once when SteamVR started, usually before the game ran.
    let steps_seen = Arc::new(Mutex::new(Vec::new()));
    let fake =
        Fake { windows_style: true, copy_ok: true, focus: vec![Ok(Focus::Focused)], paste: Ok(true), steps: steps_seen.clone() };
    let vr = Arc::new(Named::default());
    let clipboard = Clipboard::with_desktop(Box::new(fake), vr.clone());
    assert!(!clipboard.copy_and_paste("first", None, 0));
    assert_eq!(steps(&steps_seen), vec![Step::Copy("first".into())]);
    *vr.name.lock().unwrap() = Some("VRChat".into());
    assert!(clipboard.copy_and_paste("second", None, 0));
    assert_eq!(
        steps(&steps_seen)[1..],
        [Step::Focus("VRChat".into()), Step::Copy("second".into()), Step::Paste(0)]
    );
}

// ---------------------------------------------------------------- copy tools

#[test]
fn the_copy_tool_follows_pyperclips_order() {
    if cfg!(target_os = "macos") {
        return;
    }
    let all = |_: &str| true;
    let only = |names: &'static [&'static str]| move |name: &str| names.contains(&name);
    assert_eq!(choose_tool(true, true, all), Some(Tool::WlCopy));
    // wl-copy needs wl-paste beside it.
    assert_eq!(choose_tool(true, true, only(&["wl-copy", "xsel"])), Some(Tool::Xsel));
    assert_eq!(choose_tool(false, true, all), Some(Tool::Xclip));
    assert_eq!(choose_tool(false, true, only(&["xsel", "klipper", "qdbus"])), Some(Tool::Xsel));
    assert_eq!(choose_tool(false, true, only(&["klipper", "qdbus"])), Some(Tool::Klipper));
    assert_eq!(choose_tool(false, true, only(&["klipper"])), None);
    // Without a display, only Wayland's tool.
    assert_eq!(choose_tool(false, false, all), None);
    assert_eq!(choose_tool(true, false, only(&["xclip"])), None);
}

#[test]
fn nothing_logged_holds_the_text_or_the_window_name() {
    let lines = Arc::new(Mutex::new(Vec::<&'static str>::new()));
    let sink = lines.clone();
    vrct_adapters::log::set_sink(move |line| sink.lock().unwrap().push(line));
    for (windows_style, copy_ok, focus) in [
        (true, true, Ok(Focus::NotFocused)),
        (true, false, Ok(Focus::Focused)),
        (false, true, Ok(Focus::Unavailable)),
        (false, true, Err(DesktopBroken)),
    ] {
        let (clipboard, _) = clipboard(windows_style, copy_ok, vec![focus]);
        clipboard.copy_and_paste("private words", Some("Secret Window"), 0);
    }
    for line in lines.lock().unwrap().iter() {
        assert!(!line.contains("private words") && !line.contains("Secret Window"));
    }
}
