//! SteamVR starting ASTAROT with itself, through the core (#1384): the switch's endpoints, the
//! watch that keeps the install in SteamVR's list, and the uninstaller's removal. SteamVR is the
//! stand-in of `native/vr-overlay`, which reads the manifest from a folder of the test as SteamVR
//! reads it from the install; nothing reaches a SteamVR of the PC.

mod common;

use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use astarot_core::controller::Services;
use astarot_core::controller::steamvr::{Unregistered, unregister};
use astarot_core::vr_overlay::registration::Install;
use astarot_core::vr_overlay::runtime::Vr;
use astarot_core::vr_overlay::runtime::fake::FakeVr;

const KEY: &str = "io.github.kein5.astarot";
const SHIPPED: &str = include_str!("../../../src-tauri/steamvr/astarot.vrmanifest");
const NOTIFIED: &str = "/run/steamvr_auto_launch";

/// An install in `folder`: the executable with the shipped manifest beside it.
fn install_in(folder: &Path) -> Install {
    std::fs::create_dir_all(folder).unwrap();
    std::fs::write(folder.join("astarot.vrmanifest"), SHIPPED).unwrap();
    std::fs::write(folder.join("astarot.exe"), b"").unwrap();
    Install::beside(&folder.join("astarot.exe")).expect("the manifest is beside it")
}

struct Run {
    ui: Ui,
    fake: FakeVr,
    install: Option<Install>,
    _folder: tempfile::TempDir,
}

/// A core over `fake`, as the build with the manifest (`with_manifest`) or one without it.
fn start(fake: FakeVr, with_manifest: bool) -> Run {
    let folder = tempfile::tempdir().unwrap();
    let install = with_manifest.then(|| install_in(&folder.path().join("ASTAROT")));
    let base = Setup::default().services;
    let services = Services { vr: Arc::new(fake.clone()) as Arc<dyn Vr>, steamvr_install: install.clone(), ..base };
    let ui = Ui::with(Setup { services, ..Setup::default() });
    ui.ready();
    Run { ui, fake, install, _folder: folder }
}

fn unavailable(reason: &str) -> Value {
    json!({ "available": false, "reason": reason, "enabled": null })
}

fn ready(enabled: bool) -> Value {
    json!({ "available": true, "enabled": enabled })
}

impl Run {
    /// The next notification after `from` that says `state`.
    fn told(&self, from: usize, state: &Value) -> Value {
        self.ui.wait_from(from, &format!("{NOTIFIED} with {state}"), |line| line["endpoint"] == NOTIFIED && line["result"] == *state)
    }

    fn manifests(&self) -> Vec<std::path::PathBuf> {
        self.fake.with(|s| s.manifests.clone())
    }

    fn flag(&self) -> Option<bool> {
        self.fake.with(|s| s.auto_launch.get(KEY).copied())
    }
}

#[test]
fn a_build_without_the_manifest_says_steamvr_cannot_start_it() {
    let run = start(FakeVr::running(), false);
    // Known from the start-up's answers, before the page asks SteamVR anything.
    assert_eq!(run.ui.ready()["/get/data/steamvr_auto_launch_supported"], json!(false));
    assert_eq!(run.ui.ok("/get/data/steamvr_auto_launch", None), unavailable("unsupported"));
    let answer = run.ui.request("/set/enable/steamvr_auto_launch", None);
    assert_eq!(answer["status"], 400);
    assert_eq!(error_code(&answer), "STEAMVR_AUTO_LAUNCH_UNAVAILABLE");
    assert_eq!(answer["result"]["data"], unavailable("unsupported"));
    // No watch and no connection: nothing of SteamVR is changed.
    assert_eq!(run.fake.with(|s| (s.connects, s.application_calls.len())), (0, 0));
    run.ui.stop();
}

#[test]
fn nothing_is_read_or_changed_while_steamvr_does_not_run() {
    let run = start(FakeVr::default(), true);
    run.told(0, &unavailable("steamvr_not_running"));
    assert_eq!(run.ui.ok("/get/data/steamvr_auto_launch", None), unavailable("steamvr_not_running"));
    for name in ["enable", "disable"] {
        let answer = run.ui.request(&format!("/set/{name}/steamvr_auto_launch"), None);
        assert_eq!(error_code(&answer), "STEAMVR_AUTO_LAUNCH_UNAVAILABLE", "{name}");
        assert_eq!(answer["result"]["data"], unavailable("steamvr_not_running"));
    }
    // The core never starts SteamVR: it connects only while SteamVR runs.
    assert_eq!(run.fake.with(|s| s.connects), 0);
    // The start-up's settings carry no answer from SteamVR; the page asks when it opens. They say
    // that this build can be started by SteamVR, which the page draws its row by.
    assert!(run.ui.ready().get("/get/data/steamvr_auto_launch").is_none());
    assert_eq!(run.ui.ready()["/get/data/steamvr_auto_launch_supported"], json!(true));
    run.ui.stop();
}

#[test]
fn steamvr_found_later_gets_the_install_registered_with_its_flag_left_off() {
    let run = start(FakeVr::default(), true);
    let mark = run.ui.lines().len();
    run.fake.with(|s| s.running = true);
    run.told(mark, &ready(false));
    let install = run.install.clone().unwrap();
    assert_eq!(run.manifests(), [install.manifest.clone()]);
    // SteamVR's own default is kept: the core turns nothing on that the user did not ask for.
    assert!(!run.fake.with(|s| s.application_calls.iter().any(|call| call.contains("auto_launch io.github.kein5.astarot true"))));
    // The shared connection was borrowed and given back.
    assert_eq!(run.fake.with(|s| s.sessions_open), 0);
    // SteamVR goes: the page hears that it cannot change anything now.
    let gone = run.ui.lines().len();
    run.fake.with(|s| s.running = false);
    run.told(gone, &unavailable("steamvr_not_running"));
    run.ui.stop();
}

#[test]
fn the_switch_changes_steamvrs_flag_and_shows_what_steamvr_holds() {
    let run = start(FakeVr::running(), true);
    run.told(0, &ready(false));
    assert_eq!(run.ui.ok("/set/enable/steamvr_auto_launch", None), ready(true));
    assert_eq!(run.flag(), Some(true));
    assert_eq!(run.ui.ok("/set/disable/steamvr_auto_launch", None), ready(false));
    assert_eq!(run.flag(), Some(false));
    // SteamVR's own startup settings turn it on: the page reads that, not a copy of its own.
    run.fake.with(|s| s.auto_launch.insert(KEY.into(), true));
    assert_eq!(run.ui.ok("/get/data/steamvr_auto_launch", None), ready(true));
    assert!(run.ui.saved().get("STEAMVR_AUTO_LAUNCH").is_none(), "config.json keeps no copy");
    assert_eq!(run.fake.with(|s| s.sessions_open), 0);
    run.ui.stop();
}

#[test]
fn a_refused_change_answers_what_steamvr_holds_after_it() {
    let run = start(FakeVr::running(), true);
    run.told(0, &ready(false));
    run.fake.with(|s| s.refuse_applications = Some(105));
    let answer = run.ui.request("/set/enable/steamvr_auto_launch", None);
    assert_eq!(answer["status"], 400);
    assert_eq!(error_code(&answer), "STEAMVR_AUTO_LAUNCH_FAILED");
    assert_eq!(answer["result"]["data"], unavailable("steamvr_unreachable"));
    assert_eq!(run.ui.ok("/get/data/steamvr_auto_launch", None), unavailable("steamvr_unreachable"));
    // A connection SteamVR does not give: the same answer, and nothing is left open.
    run.fake.with(|s| {
        s.refuse_applications = None;
        s.refuse_connect = true;
    });
    assert_eq!(error_code(&run.ui.request("/set/disable/steamvr_auto_launch", None)), "STEAMVR_AUTO_LAUNCH_FAILED");
    assert_eq!(run.fake.with(|s| s.sessions_open), 0);
    // The log says what could not be done, with SteamVR's error number and never the paths.
    let log = std::fs::read_to_string(run.ui.dir.join("logs").join("process.log")).unwrap_or_default();
    assert!(log.contains("SteamVR auto-launch: could not change"), "{log}");
    let folder = run.install.as_ref().unwrap().manifest.parent().unwrap().to_string_lossy().into_owned();
    assert!(!log.contains(&folder), "{log}");
    run.ui.stop();
}

#[test]
fn an_install_that_moved_takes_its_registration_and_flag_with_it() {
    let fake = FakeVr::running();
    let old_folder = tempfile::tempdir().unwrap();
    let old = install_in(&old_folder.path().join("ASTAROT"));
    {
        let mut session = fake.connect().unwrap();
        session.add_application_manifest(&old.manifest).unwrap();
        session.set_auto_launch(KEY, true).unwrap();
    }
    drop(old_folder);
    let run = start(fake, true);
    run.told(0, &ready(true));
    assert_eq!(run.manifests(), [run.install.clone().unwrap().manifest]);
    run.ui.stop();
}

#[test]
fn the_uninstaller_takes_only_this_install_out() {
    let folder = tempfile::tempdir().unwrap();
    let install = install_in(&folder.path().join("ASTAROT"));
    let fake = FakeVr::running();
    {
        let mut session = fake.connect().unwrap();
        session.add_application_manifest(&install.manifest).unwrap();
        session.set_auto_launch(KEY, true).unwrap();
    }
    assert_eq!(unregister(&fake, Some(&install)), Unregistered::Done);
    assert!(fake.with(|s| s.manifests.is_empty()));
    assert_eq!(fake.with(|s| s.auto_launch.get(KEY).copied()), Some(false), "no auto-launch is left behind");
    // Another install's registration stays.
    let other = install_in(&folder.path().join("Other"));
    fake.connect().unwrap().add_application_manifest(&other.manifest).unwrap();
    assert_eq!(unregister(&fake, Some(&install)), Unregistered::Done);
    assert_eq!(fake.with(|s| s.manifests.clone()), [other.manifest.clone()]);
    // Without SteamVR, or without a manifest, there is nothing it can do; it starts nothing.
    let stopped = FakeVr::default();
    assert_eq!(unregister(&stopped, Some(&install)), Unregistered::SteamVrNotRunning);
    assert_eq!(unregister(&fake, None), Unregistered::NoManifest);
    assert_eq!(stopped.with(|s| s.connects), 0);
    fake.with(|s| s.refuse_applications = Some(105));
    assert_eq!(unregister(&fake, Some(&other)), Unregistered::Failed);
    assert_eq!(fake.with(|s| s.sessions_open), 0);
}
