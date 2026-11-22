//! Voice typing's clipboard through the core (issue #393): a recognised message is copied and
//! pasted into the game SteamVR runs, read from a stand-in SteamVR through the connection the
//! overlays share. A stand-in desktop records the focus, the copy and the keys; nothing touches
//! the real clipboard, windows or keyboard. The behaviours are those of
//! [`src-python/models/clipboard/clipboard.py`] and [`src-python/test/test_clipboard_focus_and_paste.py`].
//!
//! [`src-python/models/clipboard/clipboard.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/clipboard/clipboard.py
//! [`src-python/test/test_clipboard_focus_and_paste.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_clipboard_focus_and_paste.py

mod common;

use common::{Setup, Ui};
use serde_json::json;
use std::sync::{Arc, Mutex};
use astarot_adapters::clipboard::{Desktop, DesktopBroken, Focus};
use astarot_core::controller::Services;
use astarot_core::controller::clipboard::steamvr_clipboard;
use astarot_core::controller::messages::{Recognized, Source};
use astarot_core::vr_overlay::runtime::fake::FakeVr;
use astarot_core::vr_overlay::runtime::{SceneApp, Vr};
use astarot_core::vr_overlay::shared::SharedVr;

const GAME: &str = "Scene Game Seven";
const SAID: &str = "secret words said aloud";

#[derive(Clone, Debug, PartialEq)]
enum Step {
    Focus(String),
    Copy(String),
    CtrlV,
}

#[derive(Clone)]
struct FakeDesktop {
    windows_style: bool,
    focus: Focus,
    steps: Arc<Mutex<Vec<Step>>>,
}

impl Desktop for FakeDesktop {
    fn focuses_before_copy(&self) -> bool {
        self.windows_style
    }
    fn copy(&mut self, text: &str) -> bool {
        self.steps.lock().unwrap().push(Step::Copy(text.into()));
        true
    }
    fn focus(&mut self, window_name: &str) -> Result<Focus, DesktopBroken> {
        self.steps.lock().unwrap().push(Step::Focus(window_name.into()));
        Ok(self.focus)
    }
    fn paste(&mut self, countdown: u32) -> Result<bool, DesktopBroken> {
        assert_eq!(countdown, 0);
        self.steps.lock().unwrap().push(Step::CtrlV);
        Ok(true)
    }
}

struct Run {
    ui: Ui,
    fake: FakeVr,
    shared: Arc<SharedVr>,
    steps: Arc<Mutex<Vec<Step>>>,
}

fn steam_game() -> SceneApp {
    SceneApp { key: "steam.app.438100".into(), name: GAME.into(), process_id: 4242 }
}

/// A core whose SteamVR is `fake` behind the shared connection and whose desktop records.
fn start(fake: FakeVr, windows_style: bool, focus: Focus) -> Run {
    let shared = Arc::new(SharedVr::new(Arc::new(fake.clone())));
    let steps = Arc::new(Mutex::new(Vec::new()));
    let desktop = FakeDesktop { windows_style, focus, steps: Arc::clone(&steps) };
    let base = Setup::default().services;
    let services = Services {
        vr: Arc::clone(&shared) as Arc<dyn Vr>,
        clipboard: steamvr_clipboard(
            Arc::clone(&shared) as Arc<dyn Vr>,
            Arc::new(move || Box::new(desktop.clone()) as Box<dyn Desktop>),
        ),
        ..base
    };
    // The overlays stay off, so only the clipboard connects to the stand-in SteamVR.
    let saved = json!({ "ENABLE_CLIPBOARD": true, "OVERLAY_SMALL_LOG": false, "OVERLAY_LARGE_LOG": false });
    let ui = Ui::with(Setup { saved: Some(saved), services, ..Setup::default() });
    ui.ready();
    ui.backend.core().config().set("ENABLE_TRANSCRIPTION_SEND", json!(true)).unwrap();
    Run { ui, fake, shared, steps }
}

impl Run {
    /// Hands the core a recognised message from the microphone and waits until it went out.
    fn say(&self, text: &str) {
        let mark = self.ui.lines().len();
        let heard = Recognized { text: text.into(), language: Some("Japanese".into()), ..Recognized::default() };
        self.ui.backend.core().deliver_transcription(Source::Mic, heard, None);
        self.ui.wait_endpoint(mark, "/run/transcription_send_mic_message");
    }

    fn steps(&self) -> Vec<Step> {
        self.steps.lock().unwrap().clone()
    }

    fn process_log(&self) -> String {
        std::fs::read_to_string(self.ui.dir.join("logs").join("process.log")).unwrap_or_default()
    }
}

#[test]
fn the_message_is_pasted_into_the_game_steamvr_runs() {
    for windows_style in [true, false] {
        let fake = FakeVr::running();
        fake.with(|s| s.scene = Some(steam_game()));
        let run = start(fake, windows_style, Focus::Focused);
        run.say(SAID);
        let expected = if windows_style {
            vec![Step::Focus(GAME.into()), Step::Copy(SAID.into()), Step::CtrlV]
        } else {
            vec![Step::Copy(SAID.into()), Step::Focus(GAME.into()), Step::CtrlV]
        };
        assert_eq!(run.steps(), expected);
        // The connection was borrowed for the read and closed again.
        assert_eq!(run.fake.with(|s| (s.scene_reads, s.sessions_open)), (1, 0));
        assert_eq!(run.shared.holders(), 0);
        run.ui.stop();
    }
}

#[test]
fn the_game_is_read_at_each_message() {
    let fake = FakeVr::running();
    let run = start(fake, true, Focus::Focused);
    run.say("first words");
    assert_eq!(run.steps(), vec![Step::Copy("first words".into())], "no game yet: copied only");
    run.fake.with(|s| s.scene = Some(steam_game()));
    run.say(SAID);
    assert_eq!(run.steps()[1..], [Step::Focus(GAME.into()), Step::Copy(SAID.into()), Step::CtrlV]);
    run.ui.stop();
}

#[test]
fn without_steamvr_or_a_steam_game_the_message_is_only_copied() {
    // SteamVR does not run: OpenVR is not even loaded.
    let run = start(FakeVr::default(), true, Focus::Focused);
    run.say(SAID);
    assert_eq!(run.steps(), vec![Step::Copy(SAID.into())]);
    assert_eq!(run.fake.with(|s| s.connects), 0);
    run.ui.stop();

    // SteamVR runs but cannot be connected to (no headset yet, no library).
    let fake = FakeVr::running();
    fake.with(|s| s.refuse_connect = true);
    let run = start(fake, true, Focus::Focused);
    run.say(SAID);
    assert_eq!(run.steps(), vec![Step::Copy(SAID.into())]);
    run.ui.stop();

    // The scene application cannot be read.
    let fake = FakeVr::running();
    fake.with(|s| {
        s.scene = Some(steam_game());
        s.fail_scene = true;
    });
    let run = start(fake, true, Focus::Focused);
    run.say(SAID);
    assert_eq!(run.steps(), vec![Step::Copy(SAID.into())]);
    assert_eq!(run.fake.with(|s| s.sessions_open), 0);
    run.ui.stop();

    // SteamVR's own scene (SteamVR Home) is not a Steam game: Python took only `steam.app.*`.
    let fake = FakeVr::running();
    fake.with(|s| {
        s.scene = Some(SceneApp { key: "openvr.tool.steamvr_environments".into(), name: "SteamVR Home".into(), process_id: 7 })
    });
    let run = start(fake, false, Focus::Focused);
    run.say(SAID);
    assert_eq!(run.steps(), vec![Step::Copy(SAID.into())]);
    run.ui.stop();
}

#[test]
fn a_window_that_does_not_come_forward_gets_no_keys() {
    for (windows_style, focus) in [(true, Focus::NotFocused), (false, Focus::NotFocused), (false, Focus::Unavailable)] {
        let fake = FakeVr::running();
        fake.with(|s| s.scene = Some(steam_game()));
        let run = start(fake, windows_style, focus);
        run.say(SAID);
        let steps = run.steps();
        assert!(steps.contains(&Step::Copy(SAID.into())), "copied for a manual paste");
        assert!(steps.contains(&Step::Focus(GAME.into())));
        assert!(!steps.contains(&Step::CtrlV), "{windows_style} {focus:?}");
        run.ui.stop();
    }
}

#[test]
fn the_clipboard_shares_the_overlays_connection() {
    let fake = FakeVr::running();
    fake.with(|s| s.scene = Some(steam_game()));
    let run = start(fake, true, Focus::Focused);
    // Another holder (as the overlays are while they show) has the connection open.
    let overlays = run.shared.connect().unwrap();
    assert_eq!(run.fake.with(|s| s.connects), 1);
    run.say(SAID);
    assert_eq!(run.steps().last(), Some(&Step::CtrlV));
    // The clipboard used the open connection and left it open.
    assert_eq!(run.fake.with(|s| (s.connects, s.sessions_open)), (1, 1));
    drop(overlays);
    assert_eq!(run.fake.with(|s| s.sessions_open), 0);
    run.ui.stop();
}

#[test]
fn neither_the_message_nor_the_game_reaches_the_log() {
    for focus in [Focus::Focused, Focus::NotFocused] {
        let fake = FakeVr::running();
        fake.with(|s| s.scene = Some(steam_game()));
        let run = start(fake, true, focus);
        run.say(SAID);
        let log = run.process_log();
        assert!(!log.is_empty(), "the run logs");
        assert!(!log.contains(SAID) && !log.contains(GAME), "no message or game name in the log");
        run.ui.stop();
    }
}
