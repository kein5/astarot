//! The update endpoints of the Python backend (Issue #285: 更新). The updater is the host's
//! (`src-tauri/src/app_update.rs`); these tests give a fake one, or none (Python's switched-off
//! updater). Nothing here reaches the network.

mod common;

use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use astarot_core::controller::Services;
use astarot_core::controller::updates::{SoftwareUpdates, UpdateOutcome};

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
    /// The channel of every call, in order.
    channels: Mutex<Vec<String>>,
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
    fn check(&self, channel: &str) -> Value {
        self.recording.channels.lock().unwrap().push(channel.into());
        self.recording.checks.fetch_add(1, Ordering::SeqCst);
        json!({ "is_update_available": true, "new_version": "0.6.0" })
    }

    fn releases(&self, channel: &str) -> Vec<Value> {
        self.recording.channels.lock().unwrap().push(channel.into());
        self.recording.listings.fetch_add(1, Ordering::SeqCst);
        vec![
            json!({ "tag": "v0.6.0", "version": "0.6.0", "is_prerelease": false, "published_at": "2026-12-01T00:00:00Z" }),
            json!({ "tag": "v0.5.0", "version": "0.5.0", "is_prerelease": false, "published_at": "2026-11-20T00:00:00Z" }),
        ]
    }

    fn install(&self, target_version: Option<&str>, channel: &str) -> UpdateOutcome {
        self.recording.channels.lock().unwrap().push(channel.into());
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

/// #466: the channel follows the running version until the user chooses one; a chosen channel
/// stays, also at the next start, and every call to the host updater names it.
#[test]
fn the_host_updater_gets_the_channel_the_user_chose_and_the_versions_until_then() {
    let (ui, recording) = with_updater(UpdateOutcome::DownloadFailed, Some(json!({ "CHECK_SOFTWARE_UPDATES": false })));
    ui.ready();
    assert_eq!(ui.ok("/get/data/release_channel", None), "stable", "a stable build");
    ui.ok("/get/data/available_releases", None);
    assert_eq!(ui.ok("/set/data/release_channel", Some(json!("beta"))), "beta");
    ui.ok("/get/data/available_releases", None);
    let mark = ui.send("/run/update_software", None);
    ui.wait_from(mark, "the failure", |l| l["endpoint"] == "/run/update_software" && l["status"] == 400);
    assert_eq!(*recording.channels.lock().unwrap(), ["stable", "beta", "beta"]);
    let refused = ui.request("/set/data/release_channel", Some(json!("nightly")));
    assert_eq!(error_code(&refused), "VALIDATION_CONFIG_VALUE_INVALID");
    assert_eq!(refused["result"]["data"], "beta");
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["RELEASE_CHANNEL_CHOSEN"], true);
    ui.stop();

    // At the next start: a chosen channel stays; one only written for the version does not.
    for (saved, expected) in [
        (json!({ "SELECTED_RELEASE_CHANNEL": "beta", "RELEASE_CHANNEL_CHOSEN": true }), "beta"),
        (json!({ "SELECTED_RELEASE_CHANNEL": "beta" }), "stable"),
        (json!({ "SELECTED_RELEASE_CHANNEL": "stable", "RELEASE_CHANNEL_CHOSEN": true }), "stable"),
    ] {
        let mut saved = saved;
        saved["CHECK_SOFTWARE_UPDATES"] = json!(false);
        let (ui, recording) = with_updater(UpdateOutcome::DownloadFailed, Some(saved.clone()));
        ui.ready();
        assert_eq!(ui.ok("/get/data/release_channel", None), expected, "{saved}");
        ui.ok("/get/data/available_releases", None);
        assert_eq!(*recording.channels.lock().unwrap(), [expected]);
        ui.stop();
    }
}

/// A host updater whose checks answer only when the test lets the channel answer, each with the
/// newest version of its channel (#1017).
#[derive(Default)]
struct Gate {
    /// The channels checked, in order, and those whose checks may answer.
    state: Mutex<(Vec<String>, Vec<String>)>,
    changed: Condvar,
}

impl Gate {
    fn wait_until(&self, what: &str, ok: impl Fn(&(Vec<String>, Vec<String>)) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut state = self.state.lock().unwrap();
        while !ok(&state) {
            let left = deadline.checked_duration_since(Instant::now()).unwrap_or_else(|| panic!("timed out: {what}"));
            state = self.changed.wait_timeout(state, left).unwrap().0;
        }
    }

    fn checked(&self) -> Vec<String> {
        self.state.lock().unwrap().0.clone()
    }

    fn open(&self, channel: &str) {
        self.state.lock().unwrap().1.push(channel.into());
        self.changed.notify_all();
    }
}

struct Gated(Arc<Gate>);

impl SoftwareUpdates for Gated {
    fn check(&self, channel: &str) -> Value {
        self.0.state.lock().unwrap().0.push(channel.into());
        self.0.changed.notify_all();
        self.0.wait_until("the test lets the check answer", |(_, open)| open.iter().any(|c| c == channel));
        let newest = if channel == "beta" { "0.7.0-beta.1" } else { "0.6.1" };
        json!({ "is_update_available": true, "new_version": newest })
    }

    fn releases(&self, _channel: &str) -> Vec<Value> {
        Vec::new()
    }

    fn install(&self, _target_version: Option<&str>, _channel: &str) -> UpdateOutcome {
        UpdateOutcome::DownloadFailed
    }
}

fn with_gate(saved: Option<Value>) -> (Ui, Arc<Gate>) {
    let gate = Arc::new(Gate::default());
    let services = Services { software_updates: Arc::new(Gated(Arc::clone(&gate))), ..Setup::default().services };
    (Ui::with(Setup { services, saved, ..Setup::default() }), gate)
}

fn wait_for_log(ui: &Ui, text: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    let path = ui.dir.join("logs").join("process.log");
    while !std::fs::read_to_string(&path).unwrap_or_default().contains(text) {
        assert!(Instant::now() < deadline, "timed out waiting for the log: {text}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// #1017: the start-up check of the channel set before answers after another one was set. Its
/// answer is dropped, the new channel is checked at once, and only that answer reaches the UI.
#[test]
fn a_check_of_the_channel_set_before_never_reports_after_another_is_set() {
    let (ui, gate) = with_gate(None);
    ui.ready();
    gate.wait_until("the start-up check", |(checked, _)| checked.len() == 1);
    assert_eq!(gate.checked(), ["stable"], "a stable build");

    assert_eq!(ui.ok("/set/data/release_channel", Some(json!("beta"))), "beta");
    gate.wait_until("the new channel's check", |(checked, _)| checked.len() == 2);
    assert_eq!(gate.checked(), ["stable", "beta"]);
    // The stable check answers now, after the switch: dropped.
    gate.open("stable");
    wait_for_log(&ui, "Software update check of the channel set before dropped");
    assert!(ui.on(0, "/run/software_update_info").is_empty(), "the stable channel's answer reached the UI");

    gate.open("beta");
    let info = ui.wait_endpoint(0, "/run/software_update_info");
    assert_eq!(info["result"], json!({ "is_update_available": true, "new_version": "0.7.0-beta.1" }));

    // The same channel again is no change: it is not checked again.
    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/data/release_channel", Some(json!("beta"))), "beta");
    assert_eq!(ui.ok("/set/data/release_channel", Some(json!("stable"))), "stable");
    let info = ui.wait_endpoint(mark, "/run/software_update_info");
    assert_eq!(info["result"]["new_version"], "0.6.1");
    assert_eq!(gate.checked(), ["stable", "beta", "stable"]);
    let versions: Vec<Value> = ui.on(0, "/run/software_update_info").iter().map(|l| l["result"]["new_version"].clone()).collect();
    assert_eq!(versions, [json!("0.7.0-beta.1"), json!("0.6.1")]);
    ui.stop();
}

/// #1017: with the check at start off, another channel is "no update" again, without asking.
#[test]
fn with_the_check_turned_off_another_channel_reports_no_update_without_asking() {
    let (ui, gate) = with_gate(Some(json!({ "CHECK_SOFTWARE_UPDATES": false })));
    ui.ready();
    ui.wait_endpoint(0, "/run/software_update_info");
    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/data/release_channel", Some(json!("beta"))), "beta");
    let info = ui.wait_endpoint(mark, "/run/software_update_info");
    assert_eq!(info["result"], json!({ "is_update_available": false, "new_version": "" }));
    assert!(gate.checked().is_empty());
    ui.stop();
}
