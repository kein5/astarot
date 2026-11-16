//! The update endpoints of the Python backend (Issue #285: 更新). Python shipped its own updater
//! switched off; the app updates through the host's updater, which the UI calls directly.

mod common;

use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use vrct_core::controller::Services;
use vrct_core::controller::updates::{SoftwareUpdates, UpdateOutcome};

#[test]
fn start_up_reports_no_update_and_lists_no_release() {
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
fn start_up_checks_even_with_the_check_turned_off() {
    // Python checked at every start; the switch is read by the UI's own update check.
    let ui = Ui::with(Setup { saved: Some(json!({ "CHECK_SOFTWARE_UPDATES": false })), ..Setup::default() });
    ui.ready();
    ui.wait_endpoint(0, "/run/software_update_info");
    ui.stop();
}

#[test]
fn an_update_answers_at_once_and_reports_that_it_could_not_download() {
    let ui = Ui::start();
    ui.ready();
    for (endpoint, data, version) in [
        ("/run/update_software", None, Value::Null),
        ("/run/update_software", Some(json!("0.5.0")), json!("0.5.0")),
        ("/run/update_cuda_software", Some(json!("")), Value::Null),
        ("/run/update_cuda_software", Some(json!("0.5.1-beta.1")), json!("0.5.1-beta.1")),
    ] {
        let mark = ui.send(endpoint, data);
        let answer = ui.wait_endpoint(mark, endpoint);
        assert_eq!((answer["status"].clone(), answer["result"].clone()), (json!(200), json!(true)), "{endpoint}");
        let failed = ui.wait_from(mark, "the failure", |l| l["endpoint"] == endpoint && l["status"] == 400);
        assert_eq!(error_code(&failed), "UPDATE_SOFTWARE_DOWNLOAD");
        assert_eq!(failed["result"]["data"], version, "{endpoint}");
    }
    ui.stop();
}

#[derive(Default)]
struct Recording {
    installs: Mutex<Vec<(String, Option<String>)>>,
}

struct Fake {
    outcome: UpdateOutcome,
    recording: Arc<Recording>,
}

impl SoftwareUpdates for Fake {
    fn check(&self) -> Value {
        json!({ "is_update_available": true, "new_version": "0.6.0" })
    }

    fn releases(&self) -> Vec<Value> {
        vec![json!({ "tag": "v0.6.0", "version": "0.6.0", "is_prerelease": false, "published_at": "2026-12-01T00:00:00Z" })]
    }

    fn install(&self, edition: &str, target_version: Option<&str>) -> UpdateOutcome {
        self.recording.installs.lock().unwrap().push((edition.into(), target_version.map(str::to_string)));
        self.outcome
    }
}

fn with_updater(outcome: UpdateOutcome) -> (Ui, Arc<Recording>) {
    let recording = Arc::new(Recording::default());
    let services = Services {
        software_updates: Arc::new(Fake { outcome, recording: Arc::clone(&recording) }),
        ..Setup::default().services
    };
    (Ui::with(Setup { services, ..Setup::default() }), recording)
}

#[test]
fn a_host_updater_is_asked_with_the_edition_and_the_version() {
    let (ui, recording) = with_updater(UpdateOutcome::VerifyFailed);
    ui.ready();
    assert_eq!(ui.wait_endpoint(0, "/run/software_update_info")["result"]["new_version"], "0.6.0");
    assert_eq!(ui.ok("/get/data/available_releases", None)[0]["tag"], "v0.6.0");

    let mark = ui.send("/run/update_cuda_software", Some(json!("0.6.0")));
    let failed = ui.wait_from(mark, "the failure", |l| l["endpoint"] == "/run/update_cuda_software" && l["status"] == 400);
    assert_eq!(error_code(&failed), "UPDATE_SOFTWARE_VERIFY");
    assert_eq!(recording.installs.lock().unwrap().as_slice(), [("gpu".to_string(), Some("0.6.0".to_string()))]);
    ui.stop();
}

#[test]
fn a_launched_installer_is_not_reported() {
    let (ui, recording) = with_updater(UpdateOutcome::Launched);
    ui.ready();
    let mark = ui.send("/run/update_software", None);
    ui.wait_endpoint(mark, "/run/update_software");
    // The next request is answered after the update thread had its turn many times over.
    for _ in 0..50 {
        if !recording.installs.lock().unwrap().is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert_eq!(recording.installs.lock().unwrap().as_slice(), [("cpu".to_string(), None)]);
    std::thread::sleep(std::time::Duration::from_millis(100));
    assert_eq!(ui.on(mark, "/run/update_software").len(), 1, "only the answer");
    ui.stop();
}
