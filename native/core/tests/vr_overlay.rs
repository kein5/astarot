//! The VR overlays through the protocol (#282): turning the subtitle logs and the VR panel on
//! and off with and without SteamVR, settings reaching the running overlay, the VR panel's
//! endpoints, failures and shut-down. SteamVR and the VR page are stand-ins; no VR runtime runs.

mod common;

use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, Instant};
use astarot_core::controller::Services;
use astarot_core::protocol::encode_data;
use astarot_core::vr_overlay::runtime::fake::FakeVr;
use astarot_core::vr_overlay::runtime::{ControllerState, GRIP_MASK, Session, TRIGGER_MASK, Vr, VrError};
use astarot_core::vr_overlay::surface::{Frame, PanelSurface, PointerInput};

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
    common::warm_system_fonts();
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
    // The engine opens the session, then makes the five overlays one by one (#861: on a slow
    // runner, four of them were made when the session was seen open).
    wait("connected to SteamVR", || fake.with(|s| s.sessions_open) == 1 && fake.built());
    let keys: Vec<String> = fake.with(|s| s.created.iter().map(|(k, _)| k.clone()).collect());
    assert_eq!(&keys[..5], ["ASTAROT0", "ASTAROT1", "ASTAROT2", "ASTAROT3", "ASTAROT4"]);
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
    wait("connected", || fake.with(|s| s.sessions_open) == 1 && fake.handle("ASTAROT1").is_some());
    wait("overlays made", || fake.calls_on(fake.handle("ASTAROT1").unwrap(), "width").len() == 1);
    let large = fake.handle("ASTAROT1").unwrap();
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
    wait("connected", || fake.handle("ASTAROT0").is_some() && !fake.calls_on(fake.handle("ASTAROT0").unwrap(), "relative").is_empty());
    let small = fake.handle("ASTAROT0").unwrap();
    let mut settings = ui.ok("/get/data/overlay_small_log_settings", None);
    settings["x_pos"] = json!(0.25);
    settings["ui_scaling"] = json!(1.5);
    settings["tracker"] = json!("LeftHand");
    assert_eq!(ui.ok("/set/data/overlay_small_log_settings", Some(settings.clone())), settings);
    assert!(fake.calls_on(small, "relative").last().unwrap().starts_with(&format!("relative {small} 1 ")), "follows the left hand");
    assert_eq!(fake.calls_on(small, "width").last().unwrap(), &format!("width {small} 1.5000"));

    // The launcher moves to the other wrist.
    let launcher = fake.handle("ASTAROT3").unwrap();
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
    wait("connected", || fake.handle("ASTAROT2").is_some());
    let (panel, launcher) = (fake.handle("ASTAROT2").unwrap(), fake.handle("ASTAROT3").unwrap());
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
    wait("connected", || fake.with(|s| s.sessions_open) == 1 && fake.built());
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
    wait("the overlays built", || fake.built());
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

/// The VR page that records the mouse input from the controllers.
#[derive(Default)]
struct PointedPage {
    inputs: std::sync::Mutex<Vec<PointerInput>>,
}

impl PanelSurface for PointedPage {
    fn available(&self) -> bool {
        true
    }
    fn find(&self) -> Option<u64> {
        Some(7)
    }
    fn alive(&self, window: u64) -> bool {
        window == 7
    }
    fn capture(&self, window: u64) -> Option<Frame> {
        FakePage.capture(window)
    }
    fn resize(&self, _window: u64, width: u32, height: u32) -> (u32, u32) {
        (width, height)
    }
    fn pointer(&self, _window: u64, input: PointerInput) {
        self.inputs.lock().unwrap().push(input);
    }
}

#[test]
fn the_controllers_hover_click_and_move_the_log_and_the_place_is_saved() {
    let fake = FakeVr::running();
    let page = Arc::new(PointedPage::default());
    let base = Setup::default();
    let services = Services {
        vr: Arc::new(fake.clone()),
        vr_panel_surface: Some(Arc::clone(&page) as Arc<dyn PanelSurface>),
        ..base.services
    };
    // The log 1 m in front of the headset (at the origin, looking down -Z), 0.4 m wide.
    let panel = json!({
        "width": 900, "height": 700, "x_pos": 0.0, "y_pos": 0.0, "z_pos": 1.0, "x_rotation": 0.0, "y_rotation": 0.0, "z_rotation": 0.0,
        "display_duration": 5, "fadeout_duration": 0, "opacity": 1.0, "ui_scaling": 0.4, "tracker": "Playspace",
    });
    let saved = json!({ "OVERLAY_VR_PANEL": true, "OVERLAY_VR_PANEL_SETTINGS": panel });
    let ui = Ui::with(Setup { services, saved: Some(saved), ..Setup::default() });
    ui.ready();
    wait("connected", || fake.handle("ASTAROT2").is_some());
    ui.ok("/run/vr_panel_windows", Some(json!({ "log": true, "popup": false })));
    let log = fake.handle("ASTAROT2").unwrap();
    wait("log shown", || fake.with(|s| s.visible.contains(&log) && s.bounds.contains_key(&log)));

    // The right controller 60 cm in front of the log's centre, its laser on it.
    let aim = |x: f64, y: f64| {
        let mut ray = astarot_core::vr_overlay::math::IDENTITY;
        ray[0][3] = x;
        ray[1][3] = y;
        ray[2][3] = -0.4;
        let tilt = astarot_core::vr_overlay::pose::laser_tilt(astarot_core::vr_overlay::pose::LASER_PITCH_UP_DEG);
        let untilt = astarot_core::vr_overlay::math::inverse(&tilt).unwrap();
        fake.set_pose(2, Some(astarot_core::vr_overlay::math::mul(&ray, &untilt)));
    };
    let press = |buttons: u64| fake.set_controller(2, Some(ControllerState { pressed: buttons, axis: (0.0, 0.0) }));
    press(0);
    aim(0.0, 0.0);
    // The hover position goes to the UI (the main window relays it to the VR page).
    let hover = ui.wait_from(0, "the hover position", |l| l["endpoint"] == "/run/vr_panel_pointer" && l["result"].is_object());
    assert_eq!(hover["result"], json!({ "x": 450, "y": 350 }));
    // The trigger is a click on the page where the laser points.
    press(TRIGGER_MASK);
    wait("pressed", || page.inputs.lock().unwrap().contains(&PointerInput::Down { x: 450, y: 350 }));
    press(0);
    wait("released", || page.inputs.lock().unwrap().contains(&PointerInput::Up { x: 450, y: 350 }));

    // The grip holds the log; moved up and let go, its place is saved and the UI hears it.
    let mark = ui.lines().len();
    press(GRIP_MASK);
    ui.wait_from(mark, "the hover ends while held", |l| l["endpoint"] == "/run/vr_panel_pointer" && l["result"].is_null());
    aim(0.0, 0.2);
    std::thread::sleep(Duration::from_millis(200));
    press(0);
    ui.wait_from(mark, "the place", |l| l["endpoint"] == "/run/overlay_vr_panel_anchor" && l["result"] == "Playspace");
    ui.ok("/run/shutdown", None);
    let saved = ui.saved()["OVERLAY_VR_PANEL_SETTINGS"].clone();
    assert!(saved["y_pos"].as_f64().unwrap() > 0.1, "{saved}");
    assert_eq!(saved["width"], 900);
    ui.stop();
}

/// A font file with only a `name` table naming its family (Windows platform, English).
fn name_only_font(family: &str) -> Vec<u8> {
    let records = [(1u16, family), (2u16, "Regular")];
    let mut strings = Vec::new();
    let mut table = Vec::new();
    for value in [0u16, records.len() as u16, (6 + 12 * records.len()) as u16] {
        table.extend_from_slice(&value.to_be_bytes());
    }
    for (id, text) in records {
        let bytes: Vec<u8> = text.encode_utf16().flat_map(u16::to_be_bytes).collect();
        for value in [3u16, 1, 0x409, id, bytes.len() as u16, strings.len() as u16] {
            table.extend_from_slice(&value.to_be_bytes());
        }
        strings.extend(bytes);
    }
    table.extend(strings);
    let mut file = Vec::new();
    file.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    file.extend_from_slice(&1u16.to_be_bytes());
    file.extend_from_slice(&[0; 6]);
    file.extend_from_slice(b"name");
    file.extend_from_slice(&0u32.to_be_bytes());
    file.extend_from_slice(&28u32.to_be_bytes());
    file.extend_from_slice(&(table.len() as u32).to_be_bytes());
    file.extend(table);
    file
}

#[test]
fn the_subtitle_font_is_chosen_from_the_system_and_checked() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("example.ttf"), name_only_font("Example Sans")).unwrap();
    let fonts_folder = folder.path().to_path_buf();
    let base = Setup::default();
    let services = Services {
        overlay_fonts: Arc::new(move |_| Arc::new(astarot_core::vr_overlay::fonts::FontLibrary::only(vec![fonts_folder.clone()]))),
        ..base.services
    };
    let ui = Ui::with(Setup { services, ..Setup::default() });
    let ready = ui.ready();
    assert_eq!(ready["/get/data/overlay_font_family"], "", "automatic by default");
    assert!(ready.get("/get/data/overlay_font_missing_languages").is_none(), "asked for by the settings, not at start-up");

    assert_eq!(ui.ok("/set/data/overlay_font_family", Some(json!(" Example Sans "))), "Example Sans");
    assert_eq!(ui.ok("/set/data/overlay_font_family", Some(json!("example sans"))), "example sans", "any case");
    // Not on this system: refused, the current family given back.
    let answer = ui.request("/set/data/overlay_font_family", Some(json!("Missing Sans")));
    assert_eq!(error_code(&answer), "OVERLAY_FONT_NOT_FOUND");
    assert_eq!(answer["result"]["data"], "example sans");
    for bad in [json!("a\nb"), json!(5), json!("x".repeat(257)), json!("   x\u{7}")] {
        let answer = ui.request("/set/data/overlay_font_family", Some(bad.clone()));
        assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID", "{bad}");
        assert_eq!(answer["result"]["data"], "example sans");
    }
    // The stand-in font draws nothing: every checked language is reported missing.
    assert_eq!(
        ui.ok("/get/data/overlay_font_missing_languages", None),
        json!(["Japanese", "Korean", "Chinese Simplified", "Chinese Traditional"])
    );
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["OVERLAY_FONT_FAMILY"], "example sans");
    ui.stop();

    // A blank answer goes back to automatic.
    let ui = Ui::with(Setup { saved: Some(json!({ "OVERLAY_FONT_FAMILY": "Gone Sans" })), ..Setup::default() });
    assert_eq!(ui.ready()["/get/data/overlay_font_family"], "Gone Sans", "a saved family that is gone stays (drawn automatically)");
    assert_eq!(ui.ok("/set/data/overlay_font_family", Some(json!(""))), "");
    ui.stop();
}

#[test]
fn a_diarized_caption_names_its_speakers_and_the_large_log_draws_their_names() {
    // #447 end to end: a server with a diarization model on a GPU, the game audio's captions
    // with speakers, a name given to one voice, and the VR large log drawn again with it.
    use common::fake_asr::{FakeAsr, diarization_model, recognition_model};
    use common::fake_capture::{FakeCapture, speech};
    use astarot_transcription::capture::Source;

    let asr = FakeAsr::start();
    *asr.behaviour.models.lock().unwrap() = json!({ "data": [
        recognition_model("haas-ja", &["ja"], false, &["keywords"]),
        diarization_model("nemotron-3-diarization", "Vulkan0"),
    ] });
    *asr.behaviour.speakers.lock().unwrap() = json!([
        { "speaker": "A", "start_ms": 0, "end_ms": 900 },
        { "speaker": "B", "start_ms": 1000, "end_ms": 1800 },
        // Too short to count while others spoke longer.
        { "speaker": "C", "start_ms": 1800, "end_ms": 1900 },
    ]);
    let capture = FakeCapture::new();
    capture.add_endpoint(Source::Mic, "alsa.mic", "USB Mic");
    capture.add_endpoint(Source::Speaker, "alsa.out", "Speakers");
    capture.set_default(Source::Mic, Some("alsa.mic"));
    capture.set_default(Source::Speaker, Some("alsa.out"));
    let fake = FakeVr::running();
    common::warm_system_fonts();
    let base = Setup::default();
    let services = Services { vr: Arc::new(fake.clone()), transcription_capture: capture.factory(), ..base.services };
    let saved = json!({
        "OVERLAY_LARGE_LOG": true,
        "OSC_IP_ADDRESS": "127.0.0.2",
        "REALTIME_ASR_SETTINGS": {
            "server": "external", "base_url": asr.base(), "model": "haas-ja",
            "mic": { "language": "ja", "endpoint": null, "follow_default": true },
            "speaker": { "language": "ja", "endpoint": null, "follow_default": true },
            "vocabulary": { "builtin": false, "terms": [] },
        },
    });
    let ui = Ui::with(Setup { services, saved: Some(saved), platform: astarot_core::config::Platform::Linux, ..Setup::default() });
    ui.ready();
    wait("the overlays built", || fake.built());
    let large = fake.handle("ASTAROT1").unwrap();

    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/enable/transcription_receive", None), true);
    wait("the game audio is captured", || capture.opened() == vec![(Source::Speaker, "alsa.out".to_string())]);
    // The game audio's session asks the server to tell the voices apart.
    wait("the session is configured", || !asr.diarization.lock().unwrap().is_empty());
    assert_eq!(asr.diarization.lock().unwrap()[0], json!({}));
    let before = fake.calls_on(large, "raw").len();
    capture.hear(Source::Speaker, &[speech(2000)]);
    let caption = |state: &str| {
        ui.wait_from(mark, state, |l| l["endpoint"] == "/run/realtime_caption" && l["result"]["state"] == state)["result"].clone()
    };
    let final_ = caption("final");
    assert_eq!(final_["speakers"], json!(["A", "B"]), "the voices that spoke long enough, in order");
    assert_eq!(caption("partial")["speakers"], json!([]), "a partial caption names no one");
    assert_eq!(caption("translated")["speakers"], json!(["A", "B"]));
    // Each caption row was queued for the large log before it reached the UI (#861); the server
    // goes on speaking, so later captions may still wait.
    let core = ui.backend.core().clone();
    let queued = core.overlay_captions_queued();
    wait("the captions drawn", || core.overlay_captions_drawn(queued));
    assert!(fake.calls_on(large, "raw").len() > before, "the caption drawn on the large log");

    // Listening stops, so that no newer caption draws the log; the captions shown stay.
    let namespace = final_["namespace"].as_str().unwrap().to_string();
    assert_eq!(ui.ok("/set/disable/transcription_receive", None), false);
    wait("the capture stopped", || capture.running(Source::Speaker) == 0);
    // The session closed: it reads no update after, and its end discards no pending caption
    // (#861; the end drew the log again before, even with nothing to discard).
    wait("the session closed", || ui.ok("/get/data/realtime_asr_state", None)["speaker"]["state"] == "closed");
    // A name for one voice of this session: answered as kept, and the large log drawn again.
    let drawn = fake.calls_on(large, "raw").len();
    let named = ui.ok("/set/data/speaker_names", Some(json!({ "namespace": namespace, "names": { "A": "ミカ" } })));
    assert_eq!(named, json!({ "namespace": namespace, "names": { "A": "ミカ" } }));
    wait("the large log drawn with the name", || fake.calls_on(large, "raw").len() > drawn);
    // Another session's names change nothing on screen.
    std::thread::sleep(Duration::from_millis(200));
    let drawn = fake.calls_on(large, "raw").len();
    ui.ok("/set/data/speaker_names", Some(json!({ "namespace": "another", "names": { "A": "別の人" } })));
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(fake.calls_on(large, "raw").len(), drawn);

    let log = std::fs::read_to_string(ui.dir.join("logs").join("process.log")).unwrap_or_default();
    assert!(!log.contains("ミカ") && !log.contains("別の人"), "a name reached process.log");
    ui.stop();
}

#[test]
fn a_sent_message_is_drawn_on_the_running_large_log() {
    let fake = FakeVr::running();
    let ui = with_vr(Arc::new(fake.clone()), false, Some(json!({ "OVERLAY_LARGE_LOG": true })));
    ui.ready();
    // Built, not only made: the small log's first, empty picture came after the large log was
    // made on a slow runner, and counted as the message (#861).
    wait("the overlays built", || fake.built());
    let large = fake.handle("ASTAROT1").unwrap();
    let before = fake.calls_on(large, "raw").len();
    let small = fake.handle("ASTAROT0").unwrap();
    let small_before = fake.calls_on(small, "raw").len();
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m1", "message": "hello" })));
    assert_eq!(answer["id"], "m1", "{answer}");
    wait("the message drawn on the large log", || fake.calls_on(large, "raw").len() > before);
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(fake.calls_on(small, "raw").len(), small_before, "a sent message stays off the small log");
    ui.stop();
}

#[test]
fn the_game_audio_s_realtime_finals_reach_the_small_log_under_who_spoke() {
    // #447: the small log shows a realtime final of the game audio as it shows a message, once
    // translated, with the voices the server told apart written above it.
    use common::fake_asr::{FakeAsr, diarization_model, recognition_model};
    use common::fake_capture::{FakeCapture, speech};
    use astarot_transcription::capture::Source;

    let asr = FakeAsr::start();
    *asr.behaviour.models.lock().unwrap() = json!({ "data": [
        recognition_model("haas-ja", &["ja"], false, &["keywords"]),
        diarization_model("nemotron-3-diarization", "Vulkan0"),
    ] });
    *asr.behaviour.speakers.lock().unwrap() = json!([
        { "speaker": "A", "start_ms": 0, "end_ms": 900 },
        { "speaker": "B", "start_ms": 1000, "end_ms": 1800 },
    ]);
    let capture = FakeCapture::new();
    capture.add_endpoint(Source::Mic, "alsa.mic", "USB Mic");
    capture.add_endpoint(Source::Speaker, "alsa.out", "Speakers");
    capture.set_default(Source::Mic, Some("alsa.mic"));
    capture.set_default(Source::Speaker, Some("alsa.out"));
    let fake = FakeVr::running();
    common::warm_system_fonts();
    let base = Setup::default();
    let services = Services { vr: Arc::new(fake.clone()), transcription_capture: capture.factory(), ..base.services };
    let saved = json!({
        "OVERLAY_SMALL_LOG": true,
        "OSC_IP_ADDRESS": "127.0.0.2",
        "REALTIME_ASR_SETTINGS": {
            "server": "external", "base_url": asr.base(), "model": "haas-ja",
            "mic": { "language": "ja", "endpoint": null, "follow_default": true },
            "speaker": { "language": "ja", "endpoint": null, "follow_default": true },
            "vocabulary": { "builtin": false, "terms": [] },
        },
    });
    let ui = Ui::with(Setup { services, saved: Some(saved), platform: astarot_core::config::Platform::Linux, ..Setup::default() });
    ui.ready();
    wait("the small log made", || fake.handle("ASTAROT0").is_some());
    let small = fake.handle("ASTAROT0").unwrap();
    // The heights of the pictures shown, leaving out the empty ones the overlays start with.
    let heights = || -> Vec<u32> {
        fake.calls_on(small, "raw")
            .iter()
            .filter_map(|call| call.rsplit(' ').next()?.split_once('x').map(|(_, h)| h.parse().unwrap()))
            .filter(|&height| height > 1)
            .collect()
    };

    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/enable/transcription_receive", None), true);
    wait("the game audio is captured", || capture.opened() == vec![(Source::Speaker, "alsa.out".to_string())]);
    wait("the session is configured", || !asr.diarization.lock().unwrap().is_empty());
    assert!(heights().is_empty(), "nothing is drawn before a caption");
    capture.hear(Source::Speaker, &[speech(2000)]);
    let translated = ui.wait_from(mark, "translated", |l| l["endpoint"] == "/run/realtime_caption" && l["result"]["state"] == "translated");
    assert_eq!(translated["result"]["speakers"], json!(["A", "B"]));
    wait("the final drawn on the small log", || !heights().is_empty());
    let told_apart = heights()[0];

    // Voices not told apart: the same message without the row of who spoke. The caption comes
    // first, so that a failure says whether the final or its picture did not come.
    let mark = ui.lines().len();
    *asr.behaviour.speakers.lock().unwrap() = Value::Null;
    capture.hear(Source::Speaker, &[speech(2000)]);
    ui.wait_from(mark, "a translated caption without speakers", |l| {
        l["endpoint"] == "/run/realtime_caption" && l["result"]["state"] == "translated" && l["result"]["speakers"] == json!([])
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    while !heights().iter().any(|&height| height < told_apart) {
        if Instant::now() >= deadline {
            let captions: Vec<String> = ui.lines()[mark..]
                .iter()
                .filter(|l| l["endpoint"] == "/run/realtime_caption")
                .map(|l| format!("{} {}", l["result"]["state"], l["result"]["speakers"]))
                .collect();
            panic!("a final drawn without who spoke: told apart {told_apart}, heights {:?}, captions since {captions:?}", heights());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    ui.stop();
}

#[test]
fn a_slow_small_log_picture_does_not_keep_the_final_past_its_expiry() {
    // #447: the single-line overlay's picture of a realtime final is drawn on the overlay's
    // caption thread. A picture that takes longer than the final's expiry (2 s after it came),
    // as the fonts read for the first time do on a cold PC, must not keep the final from being
    // delivered; the picture follows.
    use common::fake_asr::{FakeAsr, diarization_model, recognition_model};
    use common::fake_capture::{FakeCapture, speech};
    use astarot_transcription::capture::Source;

    let asr = FakeAsr::start();
    *asr.behaviour.models.lock().unwrap() = json!({ "data": [
        recognition_model("haas-ja", &["ja"], false, &["keywords"]),
        diarization_model("nemotron-3-diarization", "Vulkan0"),
    ] });
    let capture = FakeCapture::new();
    capture.add_endpoint(Source::Mic, "alsa.mic", "USB Mic");
    capture.add_endpoint(Source::Speaker, "alsa.out", "Speakers");
    capture.set_default(Source::Mic, Some("alsa.mic"));
    capture.set_default(Source::Speaker, Some("alsa.out"));
    let fake = FakeVr::running();
    common::warm_system_fonts();
    let base = Setup::default();
    let services = Services { vr: Arc::new(fake.clone()), transcription_capture: capture.factory(), ..base.services };
    let saved = json!({
        "OVERLAY_SMALL_LOG": true,
        "OSC_IP_ADDRESS": "127.0.0.2",
        "REALTIME_ASR_SETTINGS": {
            "server": "external", "base_url": asr.base(), "model": "haas-ja",
            "mic": { "language": "ja", "endpoint": null, "follow_default": true },
            "speaker": { "language": "ja", "endpoint": null, "follow_default": true },
            "vocabulary": { "builtin": false, "terms": [] },
        },
    });
    let ui = Ui::with(Setup { services, saved: Some(saved), platform: astarot_core::config::Platform::Linux, ..Setup::default() });
    ui.ready();
    wait("the overlays built", || fake.built());
    let small = fake.handle("ASTAROT0").unwrap();
    let drawn = || fake.calls_on(small, "raw").iter().any(|call| !call.ends_with(" 1x1"));
    fake.with(|s| s.slow_pictures = Some(Duration::from_millis(2500)));

    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/enable/transcription_receive", None), true);
    wait("the game audio is captured", || capture.opened() == vec![(Source::Speaker, "alsa.out".to_string())]);
    wait("the session is configured", || !asr.diarization.lock().unwrap().is_empty());
    capture.hear(Source::Speaker, &[speech(2000)]);
    let outcome = ui.wait_from(mark, "an outcome", |l| l["endpoint"] == "/run/realtime_caption" && l["result"]["state"] == "outcome");
    assert_eq!(outcome["result"]["outcome"], "delivered", "{outcome}");
    wait("the slow picture shown after the final was delivered", drawn);
    ui.stop();
}
