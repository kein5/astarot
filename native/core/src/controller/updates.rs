//! The update endpoints of the Python backend ([`controller.py`]: `listAvailableReleases`,
//! `updateSoftware`, `updateCudaSoftware`, `checkSoftwareUpdated`; [`model.py`]).
//!
//! The updater itself belongs to the host: the core cannot reach Tauri's updater, so it takes
//! one from [`super::Services::software_updates`]. The app (`src-tauri/src/app_update.rs`)
//! gives the same updater its own update page uses: GitHub releases of the project, the
//! channel of the running version, signed downloads. Without a host the updater is
//! [`Disabled`], which answers as Python shipped it (`BUILTIN_UPDATER_ENABLED = False`): no
//! release is listed, the start-up check reports no update, and asking to update fails with
//! `UPDATE_SOFTWARE_DOWNLOAD`.
//!
//! The start-up check only reaches the network while `CHECK_SOFTWARE_UPDATES` is on; with the
//! switch off it reports no update without asking the updater. (Python checked at every start,
//! but its updater never reached the network.)
//!
//! A channel the user sets is checked again the same way (#1017), and the check of the channel
//! set before no longer reports: what `/run/software_update_info` said last is always about the
//! channel set now ([`UpdateChecks`]).
//!
//! `/run/update_cuda_software` stays in the IPC contract and does what `/run/update_software`
//! does. Python switched to the CUDA package there; from 0.5.0 that package held the same files,
//! and since #288 there is no CUDA package at all.
//!
//! [`controller.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/controller.py
//! [`model.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/model.py

use super::routes::{Builder, OPEN};
use super::{Core, ok, ok_true};
use crate::errors::ErrorReply;
use crate::protocol::truthy;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

/// What became of an update (`SETUP_LAUNCHED`, `SETUP_DOWNLOAD_FAILED`, `SETUP_VERIFY_FAILED`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateOutcome {
    /// The installer runs and the app ends: nothing is reported.
    Launched,
    /// The installer could not be fetched (`UPDATE_SOFTWARE_DOWNLOAD`).
    DownloadFailed,
    /// The installer did not match its published hash (`UPDATE_SOFTWARE_VERIFY`).
    VerifyFailed,
}

/// The app's own updater, as the Python backend's [`model.py`] saw it.
///
/// [`model.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/model.py
/// Each call names the update channel (`SELECTED_RELEASE_CHANNEL`, "stable" or "beta"): the one
/// the user chose, or the running version's until a choice (#466).
pub trait SoftwareUpdates: Send + Sync {
    /// `checkSoftwareUpdated`: `{"is_update_available": bool, "new_version": str}`. May reach
    /// the network; it runs off the start-up path, and only while `CHECK_SOFTWARE_UPDATES` is on.
    fn check(&self, channel: &str) -> Value;
    /// `listAvailableReleases`: `[{"tag", "version", "is_prerelease", "published_at"}, ...]`,
    /// newest first. May reach the network; the UI asks for it.
    fn releases(&self, channel: &str) -> Vec<Value>;
    /// `updateSoftware` and `updateCudaSoftware`, to the latest release of the channel or to
    /// `target_version`. Runs on its own thread. Downloads, verifies and starts the installer;
    /// the app then ends or restarts.
    fn install(&self, target_version: Option<&str>, channel: &str) -> UpdateOutcome;
}

/// The start-up answer when nothing was asked: no update.
pub fn no_update() -> Value {
    json!({ "is_update_available": false, "new_version": "" })
}

/// Python's updater as shipped: switched off.
pub struct Disabled;

impl SoftwareUpdates for Disabled {
    fn check(&self, _channel: &str) -> Value {
        no_update()
    }

    fn releases(&self, _channel: &str) -> Vec<Value> {
        Vec::new()
    }

    fn install(&self, _target_version: Option<&str>, _channel: &str) -> UpdateOutcome {
        UpdateOutcome::DownloadFailed
    }
}

/// Which update channel's check may still report (#1017). Setting another channel starts a new
/// turn; a check reports only in the turn it started in. It reports while it holds the turn, so
/// that a check of the channel set before is told before the new turn begins, or never.
#[derive(Default)]
pub(crate) struct UpdateChecks {
    turn: Mutex<u64>,
}

impl UpdateChecks {
    fn current(&self) -> u64 {
        *self.turn.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Another channel was set: the checks under way are of the one before.
    fn next(&self) {
        *self.turn.lock().unwrap_or_else(|e| e.into_inner()) += 1;
    }

    /// Runs `report` when `turn` is still the current one. Whether it ran.
    fn report_in(&self, turn: u64, report: impl FnOnce()) -> bool {
        let current = self.turn.lock().unwrap_or_else(|e| e.into_inner());
        if *current != turn {
            return false;
        }
        report();
        true
    }
}

impl Core {
    /// "Check Software Updated (Background)": the result goes to `/run/software_update_info`.
    /// Python sent it at every start; with `CHECK_SOFTWARE_UPDATES` off the answer is "no
    /// update" and nothing reaches the network. A result that comes after another channel was
    /// set is dropped: the check of that channel reports instead ([`Self::release_channel_set`]).
    pub(crate) fn check_software_update_in_background(&self) {
        self.step("Check Software Updated (Background)");
        let checks = Arc::clone(&self.update_checks);
        let turn = checks.current();
        if !self.config().get_bool("CHECK_SOFTWARE_UPDATES") {
            let notify = self.notifier();
            checks.report_in(turn, || notify("software_update_info", no_update()));
            return;
        }
        let updates = Arc::clone(&self.services().software_updates);
        let notify = self.notifier();
        let log = Arc::clone(self.log());
        let channel = self.config().get_str("SELECTED_RELEASE_CHANNEL");
        std::thread::Builder::new()
            .name("software_update_check".into())
            .spawn(move || match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| updates.check(&channel))) {
                Ok(info) => {
                    if !checks.report_in(turn, || notify("software_update_info", info)) {
                        log.step("[Background] Software update check of the channel set before dropped", None);
                    }
                }
                Err(_) => log.step("[Background] Software update check failed", None),
            })
            .ok();
    }

    /// The user set another update channel (#1017): a check of the channel before that is under
    /// way no longer reports, and the new channel is checked as at the start. With
    /// `CHECK_SOFTWARE_UPDATES` off, that is "no update" again, without asking the updater.
    pub(crate) fn release_channel_set(&self) {
        self.update_checks.next();
        self.check_software_update_in_background();
    }

    /// `_runSoftwareUpdate`: on its own thread; anything but a launched installer is reported
    /// on the endpoint, with the version asked for as the error's data.
    fn run_software_update(self: &Arc<Self>, endpoint: &'static str, target_version: Option<String>) {
        let core = Arc::clone(self);
        std::thread::Builder::new()
            .name("software_update".into())
            .spawn(move || {
                let updates = Arc::clone(&core.services().software_updates);
                let channel = core.config().get_str("SELECTED_RELEASE_CHANNEL");
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    updates.install(target_version.as_deref(), &channel)
                }))
                .unwrap_or(UpdateOutcome::DownloadFailed);
                let code = match outcome {
                    UpdateOutcome::Launched => return,
                    UpdateOutcome::VerifyFailed => "UPDATE_SOFTWARE_VERIFY",
                    UpdateOutcome::DownloadFailed => "UPDATE_SOFTWARE_DOWNLOAD",
                };
                if !core.shutdown_requested() {
                    core.notify_error(endpoint, ErrorReply::new(code, json!(target_version)));
                }
            })
            .ok();
    }
}

/// `str(data) if data else None`.
fn target_version(data: &Value) -> Option<String> {
    truthy(data).then(|| super::settings::python_str(data))
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/get/data/available_releases", OPEN, |core, _| {
        let updates = Arc::clone(&core.services().software_updates);
        ok(Value::Array(updates.releases(&core.config().get_str("SELECTED_RELEASE_CHANNEL"))))
    });
    b.with("/run/update_software", OPEN, |core, data| {
        core.run_software_update("/run/update_software", target_version(data));
        ok_true()
    });
    // Kept for the IPC contract; the same update (#288).
    b.with("/run/update_cuda_software", OPEN, |core, data| {
        core.run_software_update("/run/update_cuda_software", target_version(data));
        ok_true()
    });
}

#[cfg(test)]
mod tests {
    use super::{UpdateChecks, target_version};
    use serde_json::json;

    #[test]
    fn a_check_reports_only_in_the_turn_it_started_in() {
        let checks = UpdateChecks::default();
        let before = checks.current();
        assert!(checks.report_in(before, || {}));
        checks.next();
        let mut reported = false;
        assert!(!checks.report_in(before, || reported = true), "a check of the channel set before");
        assert!(!reported);
        assert!(checks.report_in(checks.current(), || reported = true));
        assert!(reported);
    }

    #[test]
    fn the_version_is_python_str_of_a_truthy_value() {
        assert_eq!(target_version(&json!(null)), None);
        assert_eq!(target_version(&json!("")), None);
        assert_eq!(target_version(&json!(0)), None);
        assert_eq!(target_version(&json!("0.5.0")), Some("0.5.0".into()));
        assert_eq!(target_version(&json!(true)), Some("True".into()));
    }
}
