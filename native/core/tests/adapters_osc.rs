//! OSC towards VRChat through the IPC surface (Issue #285): the destination, typing, the switch
//! to VRChat, VRChat's presence, mic mute sync and the `/run/enable_osc_query` notifications.
//! The behaviours are those of `src-python/test/test_osc_controller_lifecycle.py`,
//! `test_model_osc_mute_sync.py`, `test_osc_vrchat_presence.py` and the OSC parts of
//! `test_endpoints.py`.
//!
//! Packets go to UDP sockets the test binds on 127.0.0.2: a destination on this PC that is not
//! `127.0.0.1`, so the real link never starts OSCQuery or mDNS. Receiving and VRChat's answers
//! are played by `common::fake_osc` where a test needs them.

mod common;

use common::fake_osc::{FakeOsc, Opened, factory};
use common::net::eventually;
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::net::UdpSocket;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vrct_adapters::osc::{OscArg, OscMessage, PARAMETER_MUTE_SELF, decode_packet};
use vrct_core::controller::Services;

const DESTINATION: &str = "127.0.0.2";

/// A stand-in for VRChat's OSC port.
fn vrchat() -> (UdpSocket, u16) {
    let socket = UdpSocket::bind((DESTINATION, 0)).unwrap();
    let port = socket.local_addr().unwrap().port();
    (socket, port)
}

fn received(socket: &UdpSocket, wait: Duration) -> Option<Vec<OscMessage>> {
    socket.set_read_timeout(Some(wait)).unwrap();
    let mut buffer = [0u8; 2048];
    let (size, _) = socket.recv_from(&mut buffer).ok()?;
    Some(decode_packet(&buffer[..size]).unwrap())
}

fn typing(flag: bool) -> Vec<OscMessage> {
    vec![OscMessage::new("/chatbox/typing", vec![OscArg::Bool(flag)])]
}

/// What the recognition heard from mute sync, and how often it was told to stop.
#[derive(Clone, Default)]
struct Mic {
    held: Arc<Mutex<Vec<bool>>>,
    stopped: Arc<AtomicUsize>,
}

impl Mic {
    fn last(&self) -> Option<bool> {
        self.held.lock().unwrap().last().copied()
    }
}

struct Run {
    ui: Ui,
    opened: Opened,
    mic: Mic,
}

impl Run {
    fn osc(&self) -> Arc<FakeOsc> {
        self.opened.last()
    }
}

/// A backend with the stand-in link; `receive_fails` plays an OSCQuery that cannot start.
fn start(saved: Value, receive_fails: bool) -> Run {
    let (osc, opened) = factory(receive_fails);
    let mic = Mic::default();
    let held = Arc::clone(&mic.held);
    let stopped = Arc::clone(&mic.stopped);
    let services = Services {
        osc,
        vrc_mic_mute: Arc::new(move |on| held.lock().unwrap().push(on)),
        stop_mic_transcription: Arc::new(move || {
            stopped.fetch_add(1, Ordering::SeqCst);
        }),
        ..Setup::default().services
    };
    let ui = Ui::with(Setup { saved: Some(saved), services, ..Setup::default() });
    ui.ready();
    Run { ui, opened, mic }
}

fn refused(ui: &Ui, endpoint: &str, data: Value) -> (String, Value) {
    let answer = ui.request(endpoint, Some(data));
    assert_eq!(answer["status"], 400, "{endpoint}: {answer}");
    (error_code(&answer).to_string(), answer["result"]["data"].clone())
}

#[test]
fn typing_reaches_vrchat_and_turning_sending_off_ends_it() {
    let (socket, port) = vrchat();
    // The real link of the adapters crate.
    let ui = Ui::with(Setup {
        saved: Some(json!({ "OSC_IP_ADDRESS": DESTINATION, "OSC_PORT": port })),
        services: Services { osc: Services::default().osc, ..Setup::default().services },
        ..Setup::default()
    });
    ui.ready();
    // Sending to another address is a choice made in the settings: no warning at start-up.
    let notice = ui.wait_endpoint(0, "/run/enable_osc_query");
    assert_eq!(
        notice["result"],
        json!({ "data": false, "disabled_functions": [], "reason": "remote_destination", "microphone_stopped": false })
    );

    assert_eq!(ui.ok("/run/typing_message_box", None), true);
    assert_eq!(received(&socket, Duration::from_secs(2)), Some(typing(true)));
    assert_eq!(ui.ok("/run/stop_typing_message_box", None), true);
    assert_eq!(received(&socket, Duration::from_secs(2)), Some(typing(false)));
    ui.ok("/run/stop_typing_message_box", None);
    assert_eq!(received(&socket, Duration::from_millis(300)), None, "nothing to stop");

    ui.ok("/run/typing_message_box", None);
    assert_eq!(received(&socket, Duration::from_secs(2)), Some(typing(true)));
    assert_eq!(ui.ok("/set/disable/send_message_to_vrc", None), false);
    assert_eq!(received(&socket, Duration::from_secs(2)), Some(typing(false)), "turning sending off ends typing");
    ui.ok("/run/typing_message_box", None);
    assert_eq!(received(&socket, Duration::from_millis(300)), None, "nothing goes out while off");
    assert_eq!(ui.ok("/set/enable/send_message_to_vrc", None), true);

    // A new port: the next packet goes there.
    let (other, other_port) = vrchat();
    assert_eq!(ui.ok("/set/data/osc_port", Some(json!(other_port))), other_port);
    ui.ok("/run/typing_message_box", None);
    assert_eq!(received(&other, Duration::from_secs(2)), Some(typing(true)));
    assert_eq!(received(&socket, Duration::from_millis(200)), None);

    // VRChat on another address cannot be seen, and mute sync needs OSCQuery.
    assert_eq!(ui.ok("/get/data/vrchat_osc_presence", None), "unknown");
    assert_eq!(refused(&ui, "/set/enable/vrc_mic_mute_sync", Value::Null), ("VRC_MIC_MUTE_SYNC_OSC_DISABLED".into(), json!(false)));
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["OSC_PORT"], other_port);
    ui.stop();
}

#[test]
fn only_an_indicator_the_app_turned_on_is_turned_off() {
    // `test_controller_typing.py`.
    let (socket, port) = vrchat();
    let ui = Ui::with(Setup {
        saved: Some(json!({ "OSC_IP_ADDRESS": DESTINATION, "OSC_PORT": port, "SEND_MESSAGE_TO_VRC": false })),
        services: Services { osc: Services::default().osc, ..Setup::default().services },
        ..Setup::default()
    });
    ui.ready();
    // Sending off: typing, stop and turning sending off again send nothing.
    assert_eq!(ui.ok("/run/typing_message_box", None), true);
    assert_eq!(ui.ok("/run/stop_typing_message_box", None), true);
    assert_eq!(ui.ok("/set/disable/send_message_to_vrc", None), false);
    assert_eq!(received(&socket, Duration::from_millis(300)), None, "the indicator was not the app's");

    // Turning sending on does not start typing by itself.
    assert_eq!(ui.ok("/set/enable/send_message_to_vrc", None), true);
    assert_eq!(received(&socket, Duration::from_millis(300)), None);
    // An indicator the app turned on is turned off even if sending went off in between.
    ui.ok("/run/typing_message_box", None);
    assert_eq!(received(&socket, Duration::from_secs(2)), Some(typing(true)));
    ui.backend.core().config().set("SEND_MESSAGE_TO_VRC", json!(false)).unwrap();
    ui.ok("/run/stop_typing_message_box", None);
    assert_eq!(received(&socket, Duration::from_secs(2)), Some(typing(false)));
    ui.ok("/run/stop_typing_message_box", None);
    assert_eq!(received(&socket, Duration::from_millis(300)), None, "only once");
    ui.stop();
}

#[test]
fn the_destination_is_checked_and_a_failed_change_keeps_the_saved_one() {
    let run = start(json!({}), true);
    let ui = &run.ui;
    // This PC, but receiving cannot start: the UI is warned even with sync off.
    let notice = ui.wait_endpoint(0, "/run/enable_osc_query");
    assert_eq!(
        notice["result"],
        json!({ "data": false, "disabled_functions": ["vrc_mic_mute_sync"], "reason": "setup_failed", "microphone_stopped": false })
    );
    for bad in ["abc", "0210.1564.845.0", "localhost", "", "1.2.3"] {
        assert_eq!(refused(ui, "/set/data/osc_ip_address", json!(bad)), ("VALIDATION_INVALID_IP".into(), json!("127.0.0.1")), "{bad}");
    }
    assert_eq!(refused(ui, "/set/data/osc_ip_address", Value::Null).0, "VALIDATION_INVALID_IP");
    // Python's ip_address takes an integer, which the handler then cannot open.
    assert_eq!(refused(ui, "/set/data/osc_ip_address", json!(12)), ("VALIDATION_CANNOT_SET_IP".into(), json!("127.0.0.1")));

    // Another machine: saved, and the UI hears that OSCQuery is off for that reason.
    let mark = ui.send("/set/data/osc_ip_address", Some(json!("192.0.2.10")));
    assert_eq!(ui.wait_endpoint(mark, "/set/data/osc_ip_address")["result"], "192.0.2.10");
    let notice = ui.wait_endpoint(mark, "/run/enable_osc_query");
    assert_eq!(
        notice["result"],
        json!({ "data": false, "disabled_functions": ["vrc_mic_mute_sync"], "reason": "remote_destination", "microphone_stopped": false })
    );
    // Back to this PC fails to receive: the change is refused and the old one kept.
    assert_eq!(
        refused(ui, "/set/data/osc_ip_address", json!("127.0.0.1")),
        ("VALIDATION_CANNOT_SET_IP".into(), json!("192.0.2.10"))
    );
    assert_eq!(run.osc().ip(), "192.0.2.10");
    assert_eq!(ui.ok("/get/data/osc_ip_address", None), "192.0.2.10");
    run.ui.stop();
}

#[test]
fn a_saved_destination_that_cannot_be_opened_falls_back_to_this_pc_and_is_reported() {
    // #394: a hand-edited destination that cannot be opened dropped every send and never
    // started receiving (Python did not start at all).
    const UNOPENABLE: &str = "fe80::1%nowhere";
    let (inner, opened) = factory(false);
    let osc: vrct_core::controller::adapters::OpenOsc = Arc::new(move |ip: &str, port: u16| {
        if ip == UNOPENABLE {
            return Err(std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, "no such interface"));
        }
        inner(ip, port)
    });
    let ui = Ui::with(Setup {
        saved: Some(json!({ "OSC_IP_ADDRESS": UNOPENABLE, "OSC_PORT": 9000 })),
        services: Services { osc, ..Setup::default().services },
        ..Setup::default()
    });
    ui.ready();
    let notice = ui.wait_endpoint(0, "/set/data/osc_ip_address");
    assert_eq!((notice["status"].clone(), error_code(&notice)), (json!(400), "VALIDATION_CANNOT_SET_IP"));
    assert_eq!(notice["result"]["data"], "127.0.0.1", "the address now in use");
    // Receiving started on this PC.
    assert_eq!(ui.wait_endpoint(0, "/run/enable_osc_query")["result"], json!({ "data": true, "disabled_functions": [] }));
    assert_eq!(opened.last().ip(), "127.0.0.1");
    assert_eq!(ui.ok("/get/data/osc_ip_address", None), "127.0.0.1");
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["OSC_IP_ADDRESS"], "127.0.0.1");
    ui.stop();
}

#[test]
fn the_port_is_an_exact_integer() {
    let run = start(json!({}), false);
    let ui = &run.ui;
    for bad in [json!("9000"), json!(true), json!(0), json!(65536), json!(9001.0), Value::Null] {
        assert_eq!(refused(ui, "/set/data/osc_port", bad.clone()), ("VALIDATION_OSC_PORT_INVALID".into(), json!(9000)), "{bad}");
    }
    let mark = ui.send("/set/data/osc_port", Some(json!(9002)));
    assert_eq!(ui.wait_endpoint(mark, "/set/data/osc_port")["result"], 9002);
    assert_eq!(ui.wait_endpoint(mark, "/run/enable_osc_query")["result"], json!({ "data": true, "disabled_functions": [] }));
    run.ui.stop();
}

#[test]
fn mute_sync_holds_the_microphone_until_oscquery_confirms_an_unmute() {
    let run = start(json!({}), false);
    let ui = &run.ui;
    assert_eq!(ui.wait_endpoint(0, "/run/enable_osc_query")["result"]["data"], true);
    let osc = run.osc();

    assert_eq!(run.mic.last(), Some(false), "sync off: nothing held");
    assert_eq!(ui.ok("/set/enable/vrc_mic_mute_sync", None), true);
    assert!(run.mic.held.lock().unwrap().ends_with(&[false, true, false]), "held until VRChat said it is unmuted");
    assert_eq!(ui.ok("/set/enable/vrc_mic_mute_sync", None), true, "already on");

    // A mute holds the microphone at once.
    osc.vrchat_sends(PARAMETER_MUTE_SELF, vec![OscArg::Bool(true)]);
    assert_eq!(run.mic.last(), Some(true));
    // An unmute is believed once OSCQuery confirms it.
    osc.vrchat_sends(PARAMETER_MUTE_SELF, vec![OscArg::Bool(false)]);
    eventually("the confirmed unmute", || run.mic.last() == Some(false));

    // A forged unmute that OSCQuery contradicts keeps it held.
    osc.vrchat_sends(PARAMETER_MUTE_SELF, vec![OscArg::Bool(true)]);
    *osc.mute.lock().unwrap() = Some(true);
    let asked = osc.mute_queries.load(Ordering::SeqCst);
    osc.vrchat_sends(PARAMETER_MUTE_SELF, vec![OscArg::Bool(false)]);
    eventually("the query", || osc.mute_queries.load(Ordering::SeqCst) > asked);
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(run.mic.last(), Some(true));
    // Unknown (no answer) keeps it held too; a non-boolean is ignored.
    *osc.mute.lock().unwrap() = None;
    osc.vrchat_sends(PARAMETER_MUTE_SELF, vec![OscArg::Int(0)]);
    osc.vrchat_sends("/avatar/change", vec![OscArg::String("avtr".into())]);
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(run.mic.last(), Some(true));

    // A new avatar: held, then released once OSCQuery says unmuted.
    *osc.mute.lock().unwrap() = Some(false);
    osc.vrchat_sends("/avatar/change", vec![OscArg::String("avtr".into())]);
    eventually("the unmute after the avatar loaded", || run.mic.last() == Some(false));

    // Off: VRChat's mute no longer matters.
    assert_eq!(ui.ok("/set/disable/vrc_mic_mute_sync", None), false);
    let heard = run.mic.held.lock().unwrap().len();
    osc.vrchat_sends(PARAMETER_MUTE_SELF, vec![OscArg::Bool(true)]);
    assert_eq!(run.mic.held.lock().unwrap().len(), heard);
    assert_eq!(ui.ok("/set/disable/vrc_mic_mute_sync", None), false, "already off");
    run.ui.stop();
}

#[test]
fn losing_oscquery_with_sync_on_stops_the_microphone_before_turning_sync_off() {
    let run = start(json!({}), false);
    let ui = &run.ui;
    ui.wait_endpoint(0, "/run/enable_osc_query");
    ui.ok("/set/enable/vrc_mic_mute_sync", None);

    let mark = ui.send("/set/data/osc_ip_address", Some(json!("192.0.2.10")));
    ui.wait_endpoint(mark, "/set/data/osc_ip_address");
    let notice = ui.wait_endpoint(mark, "/run/enable_osc_query");
    assert_eq!(
        notice["result"],
        json!({ "data": false, "disabled_functions": ["vrc_mic_mute_sync"], "reason": "remote_destination", "microphone_stopped": true })
    );
    let after: Vec<Value> = ui.lines().into_iter().skip(mark).map(|l| l["endpoint"].clone()).collect();
    let at = |e: &str| after.iter().position(|n| n == e).unwrap_or_else(|| panic!("{e}: {after:?}"));
    assert!(at("/set/disable/transcription_send") < at("/set/disable/vrc_mic_mute_sync"), "the microphone first");
    assert!(at("/set/disable/vrc_mic_mute_sync") < at("/run/enable_osc_query"));
    assert_eq!(ui.on(mark, "/set/disable/transcription_send")[0]["result"], false);
    assert_eq!(run.mic.stopped.load(Ordering::SeqCst), 1);
    assert_eq!(ui.ok("/get/data/vrc_mic_mute_sync", None), false);
    run.ui.stop();
}

#[test]
fn a_saved_sync_is_checked_at_start_up_or_turned_off_when_oscquery_cannot_start() {
    // OSCQuery runs: VRChat is asked, and the microphone held until it answers.
    let run = start(json!({ "VRC_MIC_MUTE_SYNC": true }), false);
    eventually("the start-up query", || run.osc().mute_queries.load(Ordering::SeqCst) >= 1);
    eventually("the release", || run.mic.last() == Some(false));
    assert!(run.mic.held.lock().unwrap()[0], "held first");
    assert_eq!(run.ui.ok("/get/data/vrc_mic_mute_sync", None), true);
    run.ui.stop();

    // It cannot start on this PC: the microphone stops and sync goes off, with a warning.
    let run = start(json!({ "VRC_MIC_MUTE_SYNC": true }), true);
    let notice = run.ui.wait_endpoint(0, "/run/enable_osc_query");
    assert_eq!(
        notice["result"],
        json!({ "data": false, "disabled_functions": ["vrc_mic_mute_sync"], "reason": "setup_failed", "microphone_stopped": true })
    );
    assert_eq!(run.ui.wait_endpoint(0, "/set/disable/vrc_mic_mute_sync")["result"], false);
    assert_eq!(run.mic.stopped.load(Ordering::SeqCst), 1);
    run.ui.ok("/run/shutdown", None);
    assert_eq!(run.ui.saved()["VRC_MIC_MUTE_SYNC"], false);
    run.ui.stop();

    // Another machine with sync on: the user is told, since something was stopped.
    let run = start(json!({ "VRC_MIC_MUTE_SYNC": true, "OSC_IP_ADDRESS": "192.0.2.10" }), false);
    let notice = run.ui.wait_endpoint(0, "/run/enable_osc_query");
    assert_eq!(notice["result"]["reason"], "remote_destination");
    assert_eq!(notice["result"]["disabled_functions"], json!(["vrc_mic_mute_sync"]));
    assert_eq!(notice["result"]["microphone_stopped"], true);
    run.ui.stop();
}

#[test]
fn vrchat_presence_is_reported_in_words_and_left_out_of_the_start_up_snapshot() {
    let run = start(json!({}), false);
    let ui = &run.ui;
    assert!(ui.ready().get("/get/data/vrchat_osc_presence").is_none(), "it reaches the network");
    ui.wait_endpoint(0, "/run/enable_osc_query");
    let osc = run.osc();
    assert_eq!(ui.ok("/get/data/vrchat_osc_presence", None), "found");
    *osc.presence.lock().unwrap() = Some(false);
    assert_eq!(ui.ok("/get/data/vrchat_osc_presence", None), "not_found");
    *osc.presence.lock().unwrap() = None;
    assert_eq!(ui.ok("/get/data/vrchat_osc_presence", None), "unknown");
    run.ui.stop();
}

#[test]
fn shutdown_stops_osc_and_a_late_receive_start_changes_nothing() {
    let run = start(json!({ "VRC_MIC_MUTE_SYNC": true }), false);
    let ui = &run.ui;
    ui.wait_endpoint(0, "/run/enable_osc_query");
    eventually("the start-up query", || run.osc().mute_queries.load(Ordering::SeqCst) >= 1);
    assert_eq!(ui.ok("/run/shutdown", None), true);
    let osc = run.osc();
    assert!(osc.stopped.load(Ordering::SeqCst), "OSC stopped");
    // What VRChat sends after the stop is ignored, and the saved intent is kept.
    let heard = run.mic.held.lock().unwrap().len();
    osc.vrchat_sends(PARAMETER_MUTE_SELF, vec![OscArg::Bool(true)]);
    assert_eq!(run.mic.held.lock().unwrap().len(), heard);
    assert_eq!(ui.saved()["VRC_MIC_MUTE_SYNC"], true);
    run.ui.stop();
}
