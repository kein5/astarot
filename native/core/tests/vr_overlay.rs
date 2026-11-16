//! The VR overlays through the protocol (#282): turning the subtitle logs and the VR panel on
//! and off with and without SteamVR, settings reaching the running overlay, the VR panel's
//! endpoints, failures and shut-down. SteamVR and the VR page are stand-ins; no VR runtime runs.

mod common;

use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, Instant};
use vrct_core::controller::Services;
use vrct_core::protocol::encode_data;
use vrct_core::vr_overlay::runtime::fake::FakeVr;
use vrct_core::vr_overlay::runtime::{Session, Vr, VrError};
use vrct_core::vr_overlay::surface::{Frame, PanelSurface};

/// The VR page: one dark picture of the default layout's size.
struct FakePage;

impl PanelSurface for FakePage {
    fn available(&self) -> bool {
        true
    }
    fn find(&self) -> Option<u64> {
        Some(7)
    }
    fn alive(&self, window: u64) -> bool {
        window == 7
    }
    fn capture(&self, _window: u64) -> Option<Frame> {
        let (width, height) = (1628, 880);
        Some(Frame { bgra: vec![40; (width * height * 4) as usize], width, height })
    }
    fn resize(&self, _window: u64, width: u32, height: u32) -> (u32, u32) {
        (width, height)
    }
}

/// SteamVR runs, but the OpenVR library is not there.
struct NoLibrary;

impl Vr for NoLibrary {
    fn runtime_running(&self) -> bool {
        true
    }
    fn connect(&self) -> Result<Box<dyn Session>, VrError> {
        Err(VrError("openvr_api_not_found".into()))
    }
}

fn with_vr(vr: Arc<dyn Vr>, page: bool, saved: Option<Value>) -> Ui {
    let base = Setup::default();
    let services = Services {
        vr,
        vr_panel_surface: page.then(|| Arc::new(FakePage) as Arc<dyn PanelSurface>),
        ..base.services
    };
    Ui::with(Setup { services, saved, ..Setup::default() })
}

fn wait(what: &str, ok: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !ok() {
        assert!(Instant::now() < deadline, "{what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn the_overlay_starts_with_the_saved_switches_and_announces_the_vr_page_state() {
    let fake = FakeVr::running();
    let ui = with_vr(Arc::new(fake.clone()), false, Some(json!({ "OVERLAY_SMALL_LOG": true })));
    ui.ready();
    let names: Vec<String> = ui.lines().iter().map(|l| l["endpoint"].as_str().unwrap_or("").to_string()).collect();
    let at = |e: &str| names.iter().position(|n| n == e).unwrap_or_else(|| panic!("{e} was sent"));
    assert!(at("/run/vr_panel_layout") < at("/run/connected_network"));
    assert_eq!(ui.on(0, "/run/vr_panel_launcher_intro")[0]["result"], "idle");
    wait("connected to SteamVR", || fake.with(|s| s.sessions_open) == 1);
    let keys: Vec<String> = fake.with(|s| s.created.iter().map(|(k, _)| k.clone()).collect());
    assert_eq!(&keys[..5], ["VRCT0", "VRCT1", "VRCT2", "VRCT3", "VRCT4"]);
    ui.ok("/run/shutdown", None);
    assert_eq!(fake.with(|s| s.sessions_open), 0, "the shut-down closes SteamVR");
    let calls = fake.with(|s| s.calls.len());
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(fake.with(|s| s.calls.len()), calls, "nothing after the shut-down");
    ui.stop();
}

#[test]
fn a_log_turns_on_without_steamvr_and_connects_once_it_runs() {
    let fake = FakeVr::default();
    let ui = with_vr(Arc::new(fake.clone()), false, None);
    ui.ready();
    assert_eq!(ui.ok("/set/enable/overlay_large_log", None), true);
    std::thread::sleep(Duration::from_millis(80));
    assert_eq!(fake.with(|s| s.connects), 0, "waits for SteamVR");
    assert_eq!(ui.ok("/run/send_text_overlay", Some(json!("sample"))), "sample", "nothing to show yet");
    fake.with(|s| {
        s.running = true;
        s.hands_connected = true;
    });
    wait("connected", || fake.with(|s| s.sessions_open) == 1 && fake.handle("VRCT1").is_some());
    wait("overlays made", || fake.calls_on(fake.handle("VRCT1").unwrap(), "width").len() == 1);
    let large = fake.handle("VRCT1").unwrap();
    assert_eq!(fake.calls_on(large, "width"), [format!("width {large} 0.2500")], "the large log is a quarter of its stored width");

    assert_eq!(ui.ok("/run/send_text_overlay", Some(json!("サンプル"))), "サンプル");
    let (width, height) = fake.with(|s| s.raw[&large]);
    assert_eq!(width, 1010, "960 px and the margins");
    assert!(height > 200, "five sample messages");

    // The last log off stops the overlay.
    assert_eq!(ui.ok("/set/disable/overlay_large_log", None), false);
    assert_eq!(fake.with(|s| s.raw[&large]), (1, 1), "cleared first");
    assert_eq!(fake.with(|s| s.sessions_open), 0);
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["OVERLAY_LARGE_LOG"], false);
    ui.stop();
}

#[test]
fn settings_reach_the_running_overlay() {
    let fake = FakeVr::running();
    let ui = with_vr(Arc::new(fake.clone()), false, None);
    ui.ready();
    assert_eq!(ui.ok("/set/enable/overlay_small_log", None), true);
    wait("connected", || fake.handle("VRCT0").is_some() && !fake.calls_on(fake.handle("VRCT0").unwrap(), "relative").is_empty());
    let small = fake.handle("VRCT0").unwrap();
    let mut settings = ui.ok("/get/data/overlay_small_log_settings", None);
    settings["x_pos"] = json!(0.25);
    settings["ui_scaling"] = json!(1.5);
    settings["tracker"] = json!("LeftHand");
    assert_eq!(ui.ok("/set/data/overlay_small_log_settings", Some(settings.clone())), settings);
    assert!(fake.calls_on(small, "relative").last().unwrap().starts_with(&format!("relative {small} 1 ")), "follows the left hand");
    assert_eq!(fake.calls_on(small, "width").last().unwrap(), &format!("width {small} 1.5000"));

    // The launcher moves to the other wrist.
    let launcher = fake.handle("VRCT3").unwrap();
    assert_eq!(ui.ok("/set/data/overlay_vr_launcher_hand", Some(json!("RightHand"))), "RightHand");
    assert!(fake.calls_on(launcher, "relative").last().unwrap().starts_with(&format!("relative {launcher} 2 ")));
    ui.stop();
}

#[test]
fn the_vr_panel_is_refused_where_the_page_cannot_be_captured() {
    let fake = FakeVr::running();
    let ui = with_vr(Arc::new(fake.clone()), false, Some(json!({ "OVERLAY_SMALL_LOG": true })));
    ui.ready();
    wait("connected", || fake.with(|s| s.sessions_open) == 1);
    let answer = ui.request("/set/enable/overlay_vr_panel", None);
    assert_eq!(answer["status"], 400);
    assert_eq!(error_code(&answer), "OVERLAY_VR_PANEL_UNSUPPORTED");
    assert_eq!(answer["result"]["data"], false);
    assert_eq!(ui.ok("/get/data/overlay_vr_panel", None), false);
    assert_eq!(fake.with(|s| s.sessions_open), 1, "the subtitles keep running");
    ui.stop();

    // A saved "on" alone does not start the overlay there.
    let fake = FakeVr::running();
    let ui = with_vr(Arc::new(fake.clone()), false, Some(json!({ "OVERLAY_VR_PANEL": true })));
    ui.ready();
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(fake.with(|s| s.connects), 0);
    assert_eq!(ui.ok("/set/disable/overlay_vr_panel", None), false);
    ui.stop();
}

#[test]
fn the_vr_panel_shows_the_page_and_follows_its_requests() {
    let fake = FakeVr::running();
    let ui = with_vr(Arc::new(fake.clone()), true, None);
    ui.ready();
    assert_eq!(ui.ok("/set/enable/overlay_vr_panel", None), true);
    wait("connected", || fake.handle("VRCT2").is_some());
    let (panel, launcher) = (fake.handle("VRCT2").unwrap(), fake.handle("VRCT3").unwrap());
    // The launcher shows once the page was captured, with its opening animation.
    wait("launcher shown", || fake.with(|s| s.visible.contains(&launcher)));
    assert!(!fake.calls_on(launcher, "texture").is_empty());
    wait("animation", || ui.on(0, "/run/vr_panel_launcher_intro").iter().any(|l| l["result"] == "playing"));
    assert!(!fake.with(|s| s.visible.contains(&panel)), "the log waits until the page opens it");

    let opened = ui.ok("/run/vr_panel_windows", Some(json!({ "log": true, "popup": "yes" })));
    assert_eq!(opened, json!({ "log": true, "popup": false }), "only true opens");
    wait("log shown", || fake.with(|s| s.visible.contains(&panel)));

    // Another anchor: the overlay settles the place and the UI hears the anchor.
    let answer = ui.request("/set/data/overlay_vr_panel_anchor", Some(json!("Wall")));
    assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID");
    assert_eq!(answer["result"]["data"], "Playspace");
    let mark = ui.send("/set/data/overlay_vr_panel_anchor", Some(json!("HMD")));
    assert_eq!(ui.wait_endpoint(mark, "/set/data/overlay_vr_panel_anchor")["result"], "HMD");
    // (Opening the log may first have brought it in front of the eyes: that says "Playspace".)
    ui.wait_from(mark, "the HMD anchor", |l| l["endpoint"] == "/run/overlay_vr_panel_anchor" && l["result"] == "HMD");
    // Recalled in front of the eyes, fixed in the play space.
    let mark = ui.send("/run/vr_panel_recall_log", None);
    assert_eq!(ui.wait_endpoint(mark, "/run/vr_panel_recall_log")["result"], true);
    ui.wait_from(mark, "the recall", |l| l["endpoint"] == "/run/overlay_vr_panel_anchor" && l["result"] == "Playspace");

    // The page's layout and tooltip requests are checked.
    for bad in [json!([900]), json!([900.0, 700]), json!([true, 700]), json!("900x700")] {
        let answer = ui.request("/run/vr_panel_layout_rendered", Some(bad.clone()));
        assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID", "{bad}");
        assert_eq!(answer["result"]["data"], Value::Null);
    }
    assert_eq!(ui.ok("/run/vr_panel_layout_rendered", Some(json!([900, 700]))), json!([900, 700]));
    let epoch = ui.ok("/get/data/vr_panel_layout", None)["tooltip_epoch"].clone();
    let tooltip = json!({ "epoch": epoch, "revision": 1, "visible": false });
    assert_eq!(ui.ok("/run/vr_panel_tooltip", Some(tooltip.clone())), tooltip);
    let answer = ui.request("/run/vr_panel_tooltip", Some(json!({ "epoch": 0, "revision": 1, "visible": false })));
    assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID");

    // Turning it off hides the page's windows and stops the overlay.
    assert_eq!(ui.ok("/set/disable/overlay_vr_panel", None), false);
    assert_eq!(fake.with(|s| s.sessions_open), 0);
    ui.ok("/run/shutdown", None);
    let saved = ui.saved();
    assert_eq!(saved["OVERLAY_VR_PANEL"], false);
    assert_eq!(saved["OVERLAY_VR_PANEL_SETTINGS"]["tracker"], "Playspace");
    assert!(saved["OVERLAY_VR_PANEL_SETTINGS"]["z_pos"].as_f64().unwrap() > 0.0, "the recalled place is saved");
    ui.stop();
}

#[test]
fn the_vr_panel_relays_its_own_endpoints() {
    let ui = with_vr(Arc::new(FakeVr::default()), true, None);
    ui.ready();
    let relayed = |endpoint: &str, data: Value| {
        format!(r#"{{"endpoint": "{endpoint}", "data": "{}", "origin": "vr_panel"}}"#, encode_data(&data))
    };
    for (endpoint, data) in [
        ("/run/vr_panel_windows", json!({ "log": true, "popup": false })),
        ("/run/vr_panel_recall_log", Value::Null),
        ("/run/vr_panel_layout_rendered", json!([900, 700])),
        ("/set/data/overlay_vr_panel_anchor", json!("HMD")),
    ] {
        let mark = ui.send_raw(&relayed(endpoint, data));
        assert_eq!(ui.wait_endpoint(mark, endpoint)["status"], 200, "{endpoint}");
    }
    let mark = ui.send_raw(&relayed("/set/enable/overlay_vr_panel", Value::Null));
    assert_eq!(ui.wait_endpoint(mark, "/set/enable/overlay_vr_panel")["status"], 403, "not the page's to switch");
    ui.stop();
}

#[test]
fn a_failure_turns_the_overlays_off_and_is_reported() {
    // SteamVR runs but OpenVR cannot be loaded.
    let ui = with_vr(Arc::new(NoLibrary), false, None);
    ui.ready();
    let mark = ui.send("/set/enable/overlay_small_log", None);
    // On until it fails; when the failure comes first, the answer says so (as in Python).
    let answer = ui.wait_endpoint(mark, "/set/enable/overlay_small_log");
    assert!(answer["result"] == true || error_code(&answer) == "OVERLAY_RUNTIME_FAILED", "{answer}");
    let failure = ui.wait_endpoint(mark, "/run/message_output_error");
    assert_eq!(failure["status"], 400);
    assert_eq!(failure["result"]["error_code"], "OVERLAY_RUNTIME_FAILED");
    assert_eq!(failure["result"]["data"], json!({ "reason": "runtime" }));
    wait("turned off", || ui.ok("/get/data/overlay_small_log", None) == false);
    // Turning it on again tries again (and may fail first again, as above).
    let mark = ui.send("/set/enable/overlay_small_log", None);
    let again = ui.wait_endpoint(mark, "/set/enable/overlay_small_log");
    // It tried again: either the answer carries the failure, or the answer came first and the
    // failure follows as a notification.
    if again["result"] == true {
        let failure = ui.wait_endpoint(mark, "/run/message_output_error");
        assert_eq!(failure["result"]["error_code"], "OVERLAY_RUNTIME_FAILED");
    } else {
        assert_eq!(error_code(&again), "OVERLAY_RUNTIME_FAILED", "{again}");
    }
    ui.stop();

    // An upload that keeps failing after the reconnect.
    let fake = FakeVr::running();
    let ui = with_vr(Arc::new(fake.clone()), false, None);
    ui.ready();
    ui.ok("/set/enable/overlay_small_log", None);
    ui.ok("/set/enable/overlay_large_log", None);
    wait("connected", || fake.with(|s| s.sessions_open) == 1 && fake.handle("VRCT4").is_some());
    std::thread::sleep(Duration::from_millis(100));
    fake.with(|s| s.fail_raw = true);
    let mark = ui.send("/run/send_text_overlay", Some(json!("x")));
    assert_eq!(ui.wait_endpoint(mark, "/run/send_text_overlay")["status"], 200);
    let failure = ui.wait_endpoint(mark, "/run/message_output_error");
    assert_eq!(failure["result"]["data"], json!({ "reason": "runtime" }));
    wait("both logs off", || {
        ui.ok("/get/data/overlay_small_log", None) == false && ui.ok("/get/data/overlay_large_log", None) == false
    });
    ui.stop();
}

#[test]
fn a_message_the_vr_log_cannot_show_is_reported_for_that_output() {
    // #394: the pipeline said nothing when the overlay could not show a message.
    let fake = FakeVr::running();
    let ui = with_vr(Arc::new(fake.clone()), false, Some(json!({ "OVERLAY_LARGE_LOG": true })));
    ui.ready();
    wait("the large log made", || fake.handle("VRCT1").is_some());
    std::thread::sleep(Duration::from_millis(100));
    // SteamVR takes the reconnect but refuses the picture again.
    fake.with(|s| s.fail_pictures = true);
    let mark = ui.lines().len();
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m1", "message": "hello" })));
    assert_eq!(answer["id"], "m1", "{answer}");
    assert_eq!(answer["output_failures"], json!([{ "output": "overlay_large", "error_code": "MESSAGE_OUTPUT_FAILED" }]));
    let failure = ui.wait_from(mark, "the output failure", |l| {
        l["endpoint"] == "/run/message_output_error" && l["result"]["error_code"] == "MESSAGE_OUTPUT_FAILED"
    });
    assert_eq!(failure["status"], 400);
    assert_eq!(
        failure["result"]["data"],
        json!({ "id": "m1", "source": "chat", "output": "overlay_large", "error_code": "MESSAGE_OUTPUT_FAILED" })
    );
    ui.stop();
}

#[test]
fn launcher_and_panel_switches_reach_the_overlay_and_are_saved() {
    let fake = FakeVr::running();
    let ui = with_vr(Arc::new(fake.clone()), true, Some(json!({ "OVERLAY_VR_PANEL": true })));
    ui.ready();
    wait("connected", || fake.with(|s| s.sessions_open) == 1);
    assert_eq!(ui.ok("/set/enable/overlay_vr_panel_locked", None), true);
    assert_eq!(ui.ok("/set/disable/overlay_vr_launcher_auto_hide", None), false);
    assert_eq!(ui.ok("/set/data/overlay_vr_panel_opacity", Some(json!(0.5))), 0.5);
    let mark = ui.send("/run/vr_launcher_reset", None);
    assert_eq!(ui.wait_endpoint(mark, "/run/overlay_vr_launcher_hand")["result"], "LeftHand");
    ui.ok("/run/shutdown", None);
    let saved = ui.saved();
    assert_eq!(saved["OVERLAY_VR_PANEL_LOCKED"], true);
    assert_eq!(saved["OVERLAY_VR_LAUNCHER_AUTO_HIDE"], false);
    assert_eq!(saved["OVERLAY_VR_PANEL_SETTINGS"]["opacity"], 0.5);
    assert_eq!(fake.with(|s| s.sessions_open), 0);
    ui.stop();
}

#[test]
fn a_sent_message_is_drawn_on_the_running_large_log() {
    let fake = FakeVr::running();
    let ui = with_vr(Arc::new(fake.clone()), false, Some(json!({ "OVERLAY_LARGE_LOG": true })));
    ui.ready();
    wait("the large log made", || fake.handle("VRCT1").is_some());
    let large = fake.handle("VRCT1").unwrap();
    let before = fake.calls_on(large, "raw").len();
    let small = fake.handle("VRCT0").unwrap();
    let small_before = fake.calls_on(small, "raw").len();
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m1", "message": "hello" })));
    assert_eq!(answer["id"], "m1", "{answer}");
    wait("the message drawn on the large log", || fake.calls_on(large, "raw").len() > before);
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(fake.calls_on(small, "raw").len(), small_before, "a sent message stays off the small log");
    ui.stop();
}
