//! The update endpoints of the Python backend (Issue #285: 更新). The updater is the host's
//! (`src-tauri/src/app_update.rs`); these tests give a fake one, or none (Python's switched-off
//! updater). Nothing here reaches the network.

mod common;

use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use vrct_core::controller::Services;
use vrct_core::controller::updates::{SoftwareUpdates, UpdateOutcome};

#[test]
fn without_a_host_updater_no_update_and_no_release() {
    let ui = Ui::start();
    let snapshot = ui.ready();
    assert!(snapshot.get("/get/data/available_releases").is_none(), "it reaches the network: the UI asks for it");
    let info = ui.wait_endpoint(0, "/run/software_update_info");
    assert_eq!(info["status"], 200);
    assert_eq!(info["result"], json!({ "is_update_available": false, "new_version": "" }));
    assert_eq!(ui.ok("/get/data/available_releases", None), json!([]));
    ui.stop();
}

#[test]
fn without_a_host_updater_an_update_reports_that_it_could_not_download() {
    let ui = Ui::start();
    ui.ready();
    for (endpoint, data, version) in [
        ("/run/update_software", None, Value::Null),
        ("/run/update_software", Some(json!("0.5.0")), json!("0.5.0")),
        ("/run/update_cuda_software", Some(json!("")), Value::Null),
        ("/run/update_cuda_software", Some(json!("0.5.1-beta.1")), json!("0.5.1-beta.1")),
    ] {
        let mark = ui.send(endpoint, data);
        // The update runs on its own thread, so its failure can come before the answer.
        let answer = ui.wait_from(mark, "the answer", |l| l["endpoint"] == endpoint && l["status"] == 200);
        assert_eq!(answer["result"], json!(true), "{endpoint}");
        let failed = ui.wait_from(mark, "the failure", |l| l["endpoint"] == endpoint && l["status"] == 400);
        assert_eq!(error_code(&failed), "UPDATE_SOFTWARE_DOWNLOAD");
        assert_eq!(failed["result"]["data"], version, "{endpoint}");
    }
    ui.stop();
}

#[derive(Default)]
struct Recording {
    checks: AtomicUsize,
    listings: AtomicUsize,
    installs: Mutex<Vec<Option<String>>>,
}

impl Recording {
    fn installs(&self) -> Vec<Option<String>> {
        self.installs.lock().unwrap().clone()
    }

    /// The install runs on its own thread after the answer.
    fn wait_for_installs(&self, count: usize) -> Vec<Option<String>> {
        for _ in 0..250 {
            if self.installs.lock().unwrap().len() >= count {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        self.installs()
    }
}

/// A host updater: two releases, a newer one available, and a fixed outcome for installs.
struct Fake {
    outcome: UpdateOutcome,
    recording: Arc<Recording>,
}

impl SoftwareUpdates for Fake {
    fn check(&self) -> Value {
        self.recording.checks.fetch_add(1, Ordering::SeqCst);
        json!({ "is_update_available": true, "new_version": "0.6.0" })
    }

    fn releases(&self) -> Vec<Value> {
        self.recording.listings.fetch_add(1, Ordering::SeqCst);
        vec![
            json!({ "tag": "v0.6.0", "version": "0.6.0", "is_prerelease": false, "published_at": "2026-12-01T00:00:00Z" }),
            json!({ "tag": "v0.5.0", "version": "0.5.0", "is_prerelease": false, "published_at": "2026-11-20T00:00:00Z" }),
        ]
    }

    fn install(&self, target_version: Option<&str>) -> UpdateOutcome {
        self.recording.installs.lock().unwrap().push(target_version.map(str::to_string));
        self.outcome
    }
}

fn with_updater(outcome: UpdateOutcome, saved: Option<Value>) -> (Ui, Arc<Recording>) {
    let recording = Arc::new(Recording::default());
    let services = Services {
        software_updates: Arc::new(Fake { outcome, recording: Arc::clone(&recording) }),
        ..Setup::default().services
    };
    (Ui::with(Setup { services, saved, ..Setup::default() }), recording)
}

#[test]
fn the_start_up_check_reports_what_the_host_updater_found() {
    let (ui, recording) = with_updater(UpdateOutcome::Launched, None);
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/check_software_updates"], true, "on by default");
    let info = ui.wait_endpoint(0, "/run/software_update_info");
    assert_eq!(info["status"], 200);
    assert_eq!(info["result"], json!({ "is_update_available": true, "new_version": "0.6.0" }));
    assert_eq!(recording.checks.load(Ordering::SeqCst), 1);
    assert_eq!(recording.listings.load(Ordering::SeqCst), 0, "the list is not part of the start");
    ui.stop();
}

#[test]
fn with_the_check_turned_off_the_start_reports_no_update_without_asking() {
    let (ui, recording) = with_updater(UpdateOutcome::Launched, Some(json!({ "CHECK_SOFTWARE_UPDATES": false })));
    ui.ready();
    let info = ui.wait_endpoint(0, "/run/software_update_info");
    assert_eq!(info["result"], json!({ "is_update_available": false, "new_version": "" }));
    // The notification goes out at the check's place in the start, so the check had its turn.
    assert_eq!(recording.checks.load(Ordering::SeqCst), 0);
    assert_eq!(ui.on(0, "/run/software_update_info").len(), 1);
    ui.stop();
}

#[test]
fn the_release_list_is_the_host_updaters_answer() {
    let (ui, recording) = with_updater(UpdateOutcome::Launched, Some(json!({ "CHECK_SOFTWARE_UPDATES": false })));
    ui.ready();
    let releases = ui.ok("/get/data/available_releases", None);
    assert_eq!(releases.as_array().map(Vec::len), Some(2));
    assert_eq!(releases[0], json!({ "tag": "v0.6.0", "version": "0.6.0", "is_prerelease": false, "published_at": "2026-12-01T00:00:00Z" }));
    assert_eq!(releases[1]["version"], "0.5.0");
    // Asked by the user: the start-up switch does not hold the list back.
    assert_eq!(recording.listings.load(Ordering::SeqCst), 1);
    ui.stop();
}

#[test]
fn a_launched_update_is_not_reported_and_gets_the_version() {
    let (ui, recording) = with_updater(UpdateOutcome::Launched, None);
    ui.ready();
    let mark = ui.send("/run/update_software", None);
    let answer = ui.wait_endpoint(mark, "/run/update_software");
    assert_eq!((answer["status"].clone(), answer["result"].clone()), (json!(200), json!(true)));
    assert_eq!(recording.wait_for_installs(1), [None]);

    let mark = ui.send("/run/update_software", Some(json!("0.5.0")));
    ui.wait_endpoint(mark, "/run/update_software");
    assert_eq!(recording.wait_for_installs(2)[1], Some("0.5.0".to_string()));

    // The CUDA endpoint stays in the contract and makes the same update (#288).
    let mark = ui.send("/run/update_cuda_software", Some(json!("0.6.0")));
    ui.wait_endpoint(mark, "/run/update_cuda_software");
    assert_eq!(recording.wait_for_installs(3)[2], Some("0.6.0".to_string()));

    std::thread::sleep(std::time::Duration::from_millis(100));
    for endpoint in ["/run/update_software", "/run/update_cuda_software"] {
        assert!(ui.on(0, endpoint).iter().all(|l| l["status"] == 200), "{endpoint}: only the answers");
    }
    ui.stop();
}

#[test]
fn a_signature_that_does_not_verify_is_reported_with_the_version() {
    let (ui, recording) = with_updater(UpdateOutcome::VerifyFailed, None);
    ui.ready();
    for (endpoint, data, version) in [
        ("/run/update_software", Some(json!("0.6.0")), json!("0.6.0")),
        ("/run/update_cuda_software", None, Value::Null),
    ] {
        let mark = ui.send(endpoint, data);
        let failed = ui.wait_from(mark, "the failure", |l| l["endpoint"] == endpoint && l["status"] == 400);
        assert_eq!(error_code(&failed), "UPDATE_SOFTWARE_VERIFY", "{endpoint}");
        assert_eq!(failed["result"]["data"], version, "{endpoint}");
    }
    assert_eq!(recording.installs(), [Some("0.6.0".to_string()), None]);
    ui.stop();
}

#[test]
fn a_failed_download_is_reported_with_the_version() {
    let (ui, recording) = with_updater(UpdateOutcome::DownloadFailed, None);
    ui.ready();
    let mark = ui.send("/run/update_software", Some(json!("0.6.0")));
    let failed = ui.wait_from(mark, "the failure", |l| l["endpoint"] == "/run/update_software" && l["status"] == 400);
    assert_eq!(error_code(&failed), "UPDATE_SOFTWARE_DOWNLOAD");
    assert_eq!(failed["result"]["data"], "0.6.0");
    assert_eq!(recording.installs(), [Some("0.6.0".to_string())]);
    ui.stop();
}
