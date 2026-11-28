//! SteamVR starting ASTAROT with itself (#1384): the switch on the VR settings page, the watch that
//! keeps this install in SteamVR's list of applications, and the uninstaller's removal.
//!
//! What the manifest is and how the key is handed over between installs is in
//! [`astarot_vr_overlay::registration`]. SteamVR keeps the auto-launch flag, and its own startup
//! settings change it too, so the core keeps no setting of its own: each answer is what SteamVR
//! said just now. Without SteamVR running nothing can be read or changed, and the page says so.
//!
//! - `/get/data/steamvr_auto_launch_supported` says whether SteamVR can start this build at all
//!   (the manifest is beside the executable). It reaches nothing, so it is in the start-up's
//!   answers: the page knows from the first draw whether it has a row for the switch, and nothing
//!   moves when SteamVR's answer comes (#912).
//! - `/get/data/steamvr_auto_launch` reads SteamVR; it changes nothing.
//! - `/set/enable/steamvr_auto_launch` and `/set/disable/...` change the flag and answer what
//!   SteamVR holds afterwards. Turning it on registers this install first.
//! - The watch looks for SteamVR every [`Services::steamvr_poll`](super::Services) while the app
//!   runs. The first time a run finds it, it registers this install again (the manifest may have
//!   changed with an update, the install may have moved), then tells the page
//!   (`/run/steamvr_auto_launch`); it tells it again whenever SteamVR comes or goes.
//!
//! The answer is one object: `{"available": true, "enabled": <SteamVR's flag>}`, or
//! `{"available": false, "reason": ..., "enabled": null}` with the reason `unsupported` (no
//! manifest beside the executable: the Linux packages, a development build), `steamvr_not_running`
//! or `steamvr_unreachable` (SteamVR runs but did not answer). Nothing is logged but the steps and
//! SteamVR's error numbers: the paths hold the user's name.

use super::routes::{Builder, OPEN};
use super::{Core, error, ok};
use crate::protocol::Reply;
use astarot_vr_overlay::registration::{self, Install, Registration, Want};
use astarot_vr_overlay::runtime::{ApplicationError, Vr};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, OnceLock, Weak};
use std::thread::JoinHandle;

/// What the VR page can show of SteamVR starting ASTAROT.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AutoLaunch {
    /// This build has no manifest beside its executable: SteamVR cannot start it.
    Unsupported,
    SteamVrNotRunning,
    /// SteamVR runs but the connection or its list of applications did not answer.
    SteamVrUnreachable,
    /// SteamVR's auto-launch flag for ASTAROT's key.
    Ready(bool),
}

impl AutoLaunch {
    pub fn to_json(self) -> Value {
        let unavailable = |reason: &str| json!({ "available": false, "reason": reason, "enabled": Value::Null });
        match self {
            AutoLaunch::Unsupported => unavailable("unsupported"),
            AutoLaunch::SteamVrNotRunning => unavailable("steamvr_not_running"),
            AutoLaunch::SteamVrUnreachable => unavailable("steamvr_unreachable"),
            AutoLaunch::Ready(enabled) => json!({ "available": true, "enabled": enabled }),
        }
    }
}

/// Why SteamVR could not be asked.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Unasked {
    NotRunning,
    /// The connection failed (the reason has no user data).
    Connect(String),
    /// SteamVR refused a call on its list of applications.
    Refused(ApplicationError),
}

impl Unasked {
    fn state(&self) -> AutoLaunch {
        if *self == Unasked::NotRunning { AutoLaunch::SteamVrNotRunning } else { AutoLaunch::SteamVrUnreachable }
    }
}

/// Asks SteamVR for `want` over the shared connection, which it borrows and gives back; `None`
/// only reads. Never starts SteamVR: it connects only while SteamVR runs.
fn ask(vr: &dyn Vr, install: &Install, want: Option<Want>) -> Result<Registration, Unasked> {
    if !vr.runtime_running() {
        return Err(Unasked::NotRunning);
    }
    let mut session = vr.connect().map_err(|error| Unasked::Connect(error.to_string()))?;
    let exists = |path: &Path| path.exists();
    let answer = match want {
        Some(want) => registration::apply(session.as_mut(), install, want, &exists),
        None => registration::read(session.as_mut(), install, &exists),
    };
    answer.map_err(Unasked::Refused)
}

/// The watch and the lock that keeps one change of SteamVR's list at a time.
#[derive(Default)]
pub(crate) struct SteamVr {
    /// Held over every [`ask`], so that the watch's upkeep cannot put back a flag the user just
    /// changed.
    asking: Mutex<()>,
    /// The core the watch works for, set with the routes ([`add`]).
    core: OnceLock<Weak<Core>>,
    watch: Mutex<Option<Watch>>,
}

/// The watch's thread and the right to stop it.
struct Watch {
    stop: Arc<(Mutex<bool>, Condvar)>,
    thread: JoinHandle<()>,
}

/// What the watch saw of SteamVR at its last look.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Seen {
    /// Before the first look.
    Nothing,
    Absent,
    /// SteamVR runs; `told` once the page has heard what SteamVR holds since it came.
    Present { told: bool },
}

/// What one look of the watch does ([`look`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Look {
    /// Nothing changed.
    Wait,
    /// SteamVR went away: tell the page.
    Gone,
    /// SteamVR is there and the page has not heard: ask it (with the upkeep unless `kept`).
    Ask { upkeep: bool },
}

/// What to do at a look that finds SteamVR `running` (or not), after `seen` at the last one and
/// with the upkeep `kept` (done once already in this run).
fn look(seen: Seen, running: bool, kept: bool) -> Look {
    match (seen, running) {
        (Seen::Present { told: true }, true) => Look::Wait,
        (_, true) => Look::Ask { upkeep: !kept },
        (Seen::Present { .. } | Seen::Nothing, false) => Look::Gone,
        (Seen::Absent, false) => Look::Wait,
    }
}

impl Core {
    fn steamvr_install(&self) -> Option<&Install> {
        self.services().steamvr_install.as_ref()
    }

    /// Asks SteamVR under the lock and says what the page shows.
    fn ask_steamvr(&self, want: Option<Want>) -> Result<AutoLaunch, (Unasked, AutoLaunch)> {
        let Some(install) = self.steamvr_install() else { return Ok(AutoLaunch::Unsupported) };
        let _one_at_a_time = self.steamvr.asking.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        match ask(self.services().vr.as_ref(), install, want) {
            Ok(registration) => Ok(AutoLaunch::Ready(registration.auto_launch)),
            Err(unasked) => {
                let state = unasked.state();
                Err((unasked, state))
            }
        }
    }

    /// `/get/data/steamvr_auto_launch`.
    fn steamvr_auto_launch(&self) -> Value {
        match self.ask_steamvr(None) {
            Ok(state) => state.to_json(),
            Err((unasked, state)) => {
                self.log_unasked("read", &unasked);
                state.to_json()
            }
        }
    }

    /// `/set/enable/steamvr_auto_launch` and `/set/disable/steamvr_auto_launch`.
    fn set_steamvr_auto_launch(&self, on: bool) -> Reply {
        match self.ask_steamvr(Some(Want::AutoLaunch(on))) {
            Ok(AutoLaunch::Unsupported) => error("STEAMVR_AUTO_LAUNCH_UNAVAILABLE", AutoLaunch::Unsupported.to_json()),
            Ok(state) => {
                self.step(&format!("SteamVR auto-launch {}", if on { "on" } else { "off" }));
                ok(state.to_json())
            }
            Err((Unasked::NotRunning, state)) => error("STEAMVR_AUTO_LAUNCH_UNAVAILABLE", state.to_json()),
            Err((unasked, _)) => {
                self.log_unasked("change", &unasked);
                // What SteamVR holds after the failed change, to show instead.
                let now = self.ask_steamvr(None).unwrap_or_else(|(_, state)| state);
                error("STEAMVR_AUTO_LAUNCH_FAILED", now.to_json())
            }
        }
    }

    fn log_unasked(&self, what: &str, unasked: &Unasked) {
        match unasked {
            Unasked::NotRunning => {}
            Unasked::Connect(reason) => self.step_with(&format!("SteamVR auto-launch: could not {what}"), &json!({ "connect": reason })),
            Unasked::Refused(error) => self.step_with(&format!("SteamVR auto-launch: could not {what}"), &json!({ "error": error.0 })),
        }
    }

    /// Starts the watch, for a build SteamVR can start (one with the manifest). Once per run.
    pub(crate) fn start_steamvr_watch(&self) {
        let Some(core) = self.steamvr.core.get().cloned() else { return };
        if self.steamvr_install().is_none() {
            return;
        }
        let mut watch = self.steamvr.watch.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if watch.is_some() {
            return;
        }
        let stop = Arc::new((Mutex::new(false), Condvar::new()));
        let poll = self.services().steamvr_poll;
        let stopping = Arc::clone(&stop);
        let thread = std::thread::Builder::new().name("steamvr-auto-launch".into()).spawn(move || {
            let mut seen = Seen::Nothing;
            let mut kept = false;
            loop {
                let Some(core) = core.upgrade() else { return };
                if *stopping.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) {
                    return;
                }
                let running = core.services().vr.runtime_running();
                seen = match look(seen, running, kept) {
                    Look::Wait => seen,
                    Look::Gone => {
                        core.notify("steamvr_auto_launch", AutoLaunch::SteamVrNotRunning.to_json());
                        Seen::Absent
                    }
                    Look::Ask { upkeep } => match core.ask_steamvr(upkeep.then_some(Want::Upkeep)) {
                        Ok(state) => {
                            if upkeep {
                                core.step("SteamVR: this install is in its list of applications");
                                kept = true;
                            }
                            core.notify("steamvr_auto_launch", state.to_json());
                            Seen::Present { told: true }
                        }
                        // Asked again at the next look; SteamVR may still be starting.
                        Err((unasked, _)) => {
                            if seen != (Seen::Present { told: false }) {
                                core.log_unasked(if upkeep { "register" } else { "read" }, &unasked);
                            }
                            Seen::Present { told: false }
                        }
                    },
                };
                drop(core);
                let stopped = stopping.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                let (stopped, _) = stopping.1.wait_timeout_while(stopped, poll, |stopped| !*stopped).unwrap_or_else(|poisoned| poisoned.into_inner());
                if *stopped {
                    return;
                }
            }
        });
        if let Ok(thread) = thread {
            *watch = Some(Watch { stop, thread });
        }
    }

    /// Stops the watch and waits for its thread (at most one look at SteamVR).
    pub(crate) fn stop_steamvr_watch(&self) {
        let watch = self.steamvr.watch.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
        if let Some(watch) = watch {
            *watch.stop.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
            watch.stop.1.notify_all();
            // The thread may be this one when the last core goes from the watch itself.
            if watch.thread.thread().id() != std::thread::current().id() {
                let _ = watch.thread.join();
            }
        }
    }
}

/// What the uninstaller's `--steamvr-unregister` did, as its exit code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unregistered {
    /// This install is out of SteamVR's list, or was never in it.
    Done = 0,
    /// SteamVR does not run, so its list could not be changed. The manifest goes with the
    /// install, and SteamVR cannot start a binary that is gone.
    SteamVrNotRunning = 1,
    /// SteamVR did not answer or refused.
    Failed = 2,
    /// No manifest beside the executable: nothing of this install can be in SteamVR's list.
    NoManifest = 3,
}

/// Takes this install out of SteamVR's list with its auto-launch off, for the uninstaller. An
/// entry another install made stays.
pub fn unregister(vr: &dyn Vr, install: Option<&Install>) -> Unregistered {
    let Some(install) = install else { return Unregistered::NoManifest };
    match ask(vr, install, Some(Want::Unregister)) {
        Ok(_) => Unregistered::Done,
        Err(Unasked::NotRunning) => Unregistered::SteamVrNotRunning,
        Err(_) => Unregistered::Failed,
    }
}

/// [`unregister`] for the executable that runs, over SteamVR itself: the uninstaller runs
/// `astarot.exe --steamvr-unregister` before it removes the files.
pub fn unregister_this_install() -> Unregistered {
    let install = std::env::current_exe().ok().and_then(|executable| Install::beside(&executable));
    let vr = astarot_vr_overlay::openvr::OpenVr::new(Vec::new());
    unregister(&vr, install.as_ref())
}

/// This install, for [`super::Services::steamvr_install`]: Windows packages only, as only they
/// ship the manifest.
pub(crate) fn this_install() -> Option<Install> {
    if !cfg!(windows) {
        return None;
    }
    std::env::current_exe().ok().and_then(|executable| Install::beside(&executable))
}

pub(crate) fn add(b: &mut Builder<'_>) {
    let _ = b.core.steamvr.core.set(Arc::downgrade(b.core));
    b.with("/get/data/steamvr_auto_launch_supported", OPEN, |core, _| ok(json!(core.steamvr_install().is_some())));
    b.with("/get/data/steamvr_auto_launch", OPEN, |core, _| ok(core.steamvr_auto_launch()));
    for (name, on) in [("enable", true), ("disable", false)] {
        b.with(&format!("/set/{name}/steamvr_auto_launch"), OPEN, move |core, _| core.set_steamvr_auto_launch(on));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_hears_once_each_time_steamvr_comes_or_goes() {
        // The first look: SteamVR runs, nothing kept yet.
        assert_eq!(look(Seen::Nothing, true, false), Look::Ask { upkeep: true });
        // Not running at the first look: the page hears it.
        assert_eq!(look(Seen::Nothing, false, false), Look::Gone);
        assert_eq!(look(Seen::Absent, false, false), Look::Wait);
        // Told: nothing until SteamVR goes.
        assert_eq!(look(Seen::Present { told: true }, true, true), Look::Wait);
        assert_eq!(look(Seen::Present { told: true }, false, true), Look::Gone);
        // Asked but unanswered: asked again, with the upkeep while it is not done.
        assert_eq!(look(Seen::Present { told: false }, true, false), Look::Ask { upkeep: true });
        assert_eq!(look(Seen::Present { told: false }, false, false), Look::Gone);
        // SteamVR back in the same run: read again, no second upkeep.
        assert_eq!(look(Seen::Absent, true, true), Look::Ask { upkeep: false });
    }

    #[test]
    fn the_answer_says_why_nothing_can_be_shown() {
        assert_eq!(AutoLaunch::Ready(true).to_json(), json!({ "available": true, "enabled": true }));
        assert_eq!(AutoLaunch::Ready(false).to_json(), json!({ "available": true, "enabled": false }));
        for (state, reason) in [
            (AutoLaunch::Unsupported, "unsupported"),
            (AutoLaunch::SteamVrNotRunning, "steamvr_not_running"),
            (AutoLaunch::SteamVrUnreachable, "steamvr_unreachable"),
        ] {
            assert_eq!(state.to_json(), json!({ "available": false, "reason": reason, "enabled": null }));
        }
        assert_eq!(Unasked::NotRunning.state(), AutoLaunch::SteamVrNotRunning);
        assert_eq!(Unasked::Refused(ApplicationError(105)).state(), AutoLaunch::SteamVrUnreachable);
        assert_eq!(Unasked::Connect("VRInitError 108".into()).state(), AutoLaunch::SteamVrUnreachable);
    }
}
