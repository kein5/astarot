//! The update endpoints of the Python backend (`controller.py`: `listAvailableReleases`,
//! `updateSoftware`, `updateCudaSoftware`, `checkSoftwareUpdated`; `model.py`).
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

use super::routes::{Builder, OPEN};
use super::{Core, ok, ok_true};
use crate::errors::ErrorReply;
use crate::protocol::truthy;
use serde_json::{Value, json};
use std::sync::Arc;

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

/// The app's own updater, as the Python backend's `model.py` saw it.
pub trait SoftwareUpdates: Send + Sync {
    /// `checkSoftwareUpdated`: `{"is_update_available": bool, "new_version": str}`. May reach
    /// the network; it runs off the start-up path, and only while `CHECK_SOFTWARE_UPDATES` is on.
    fn check(&self) -> Value;
    /// `listAvailableReleases`: `[{"tag", "version", "is_prerelease", "published_at"}, ...]`,
    /// newest first. May reach the network; the UI asks for it.
    fn releases(&self) -> Vec<Value>;
    /// `updateSoftware` (`edition` "cpu") and `updateCudaSoftware` ("gpu"), to the latest
    /// release of the channel or to `target_version`. Runs on its own thread. Downloads,
    /// verifies and starts the installer; the app then ends or restarts.
    fn install(&self, edition: &str, target_version: Option<&str>) -> UpdateOutcome;
}

/// The start-up answer when nothing was asked: no update.
pub fn no_update() -> Value {
    json!({ "is_update_available": false, "new_version": "" })
}

/// Python's updater as shipped: switched off.
pub struct Disabled;

impl SoftwareUpdates for Disabled {
    fn check(&self) -> Value {
        no_update()
    }

    fn releases(&self) -> Vec<Value> {
        Vec::new()
    }

    fn install(&self, _edition: &str, _target_version: Option<&str>) -> UpdateOutcome {
        UpdateOutcome::DownloadFailed
    }
}

impl Core {
    /// "Check Software Updated (Background)": the result goes to `/run/software_update_info`.
    /// Python sent it at every start; with `CHECK_SOFTWARE_UPDATES` off the answer is "no
    /// update" and nothing reaches the network.
    pub(crate) fn check_software_update_in_background(&self) {
        self.step("Check Software Updated (Background)");
        if !self.config().get_bool("CHECK_SOFTWARE_UPDATES") {
            self.notify("software_update_info", no_update());
            return;
        }
        let updates = Arc::clone(&self.services().software_updates);
        let notify = self.notifier();
        let log = Arc::clone(self.log());
        std::thread::Builder::new()
            .name("software_update_check".into())
            .spawn(move || match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| updates.check())) {
                Ok(info) => notify("software_update_info", info),
                Err(_) => log.step("[Background] Software update check failed", None),
            })
            .ok();
    }

    /// `_runSoftwareUpdate`: on its own thread; anything but a launched installer is reported
    /// on the endpoint, with the version asked for as the error's data.
    fn run_software_update(self: &Arc<Self>, edition: &'static str, endpoint: &'static str, target_version: Option<String>) {
        let core = Arc::clone(self);
        std::thread::Builder::new()
            .name("software_update".into())
            .spawn(move || {
                let updates = Arc::clone(&core.services().software_updates);
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    updates.install(edition, target_version.as_deref())
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
        ok(Value::Array(updates.releases()))
    });
    b.with("/run/update_software", OPEN, |core, data| {
        core.run_software_update("cpu", "/run/update_software", target_version(data));
        ok_true()
    });
    b.with("/run/update_cuda_software", OPEN, |core, data| {
        core.run_software_update("gpu", "/run/update_cuda_software", target_version(data));
        ok_true()
    });
}

#[cfg(test)]
mod tests {
    use super::target_version;
    use serde_json::json;

    #[test]
    fn the_version_is_python_str_of_a_truthy_value() {
        assert_eq!(target_version(&json!(null)), None);
        assert_eq!(target_version(&json!("")), None);
        assert_eq!(target_version(&json!(0)), None);
        assert_eq!(target_version(&json!("0.5.0")), Some("0.5.0".into()));
        assert_eq!(target_version(&json!(true)), Some("True".into()));
    }
}
