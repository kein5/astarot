//! The audio devices over the connection the UI uses (Issue #285; `native/audio-routing`): the
//! lists and their options, choosing by name, by ID and by host with the values to roll back to,
//! Auto Select following the OS default, the lists following plugged and unplugged devices, the
//! order of the notifications, what is saved, choices saved by the Python backend, the start-up
//! snapshot, and the virtual microphone guide. The devices are in memory (`common::fake_audio`).

mod common;

use common::fake_audio::{CableSetup, FakeAudio, wasapi_id, windows};
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::path::Path;
use std::time::{Duration, Instant};
use vrct_audio_routing::manager::Topology;
use vrct_audio_routing::snapshot::RawLists;
use vrct_core::controller::Services;
use std::sync::{Arc, Mutex};
use vrct_audio_routing::identity::Device;
use vrct_core::controller::audio_devices::{CaptureOwner, Reopened, Source};

const A: &str = "mic:Windows WASAPI:{a}";
const H: &str = "mic:Windows WASAPI:{h}";
const S: &str = "speaker:2:{s}";
const P: &str = "speaker:2:{p}";

/// Two microphones (the headset is the default) and two speakers (the speakers are the default).
fn pc() -> RawLists {
    windows(&[("Mic A", "{a}"), ("Headset Mic", "{h}")], Some("{h}"), &[("Speakers", "{s}"), ("Headphones", "{p}")], Some("{s}"))
}

fn start_in(fake: &FakeAudio, saved: Option<Value>, dir: Option<&Path>) -> Ui {
    let services = Services { audio: fake.platform(), ..Setup::default().services };
    Ui::with(Setup { saved, services, dir: dir.map(Path::to_path_buf), ..Setup::default() })
}

fn start(fake: &FakeAudio, saved: Value) -> Ui {
    start_in(fake, Some(saved), None)
}

fn manual() -> Value {
    json!({ "AUTO_MIC_SELECT": false, "AUTO_SPEAKER_SELECT": false })
}

fn names(lines: &[Value]) -> Vec<String> {
    lines.iter().map(|l| l["endpoint"].as_str().unwrap_or_default().to_string()).collect()
}

fn refused(ui: &Ui, endpoint: &str, data: Value) -> Value {
    let answer = ui.request(endpoint, Some(data));
    assert_eq!(answer["status"], 400, "{endpoint}: {answer}");
    assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID");
    answer["result"]["data"].clone()
}

fn eventually(what: &str, check: impl Fn() -> bool) {
    let deadline = Instant::now() + common::TIMEOUT;
    while !check() {
        assert!(Instant::now() < deadline, "{what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn start_up_lists_the_devices_and_auto_select_takes_the_defaults() {
    let fake = FakeAudio::with(pc());
    let dir = tempfile::tempdir().unwrap();
    let ui = start_in(&fake, Some(json!({})), Some(dir.path()));
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/selectable_mic_host_list"], json!(["Windows WASAPI"]));
    assert_eq!(snapshot["/get/data/selectable_mic_device_list"], json!(["Mic A", "Headset Mic"]));
    assert_eq!(snapshot["/get/data/selectable_speaker_device_list"], json!(["Speakers [Loopback]", "Headphones [Loopback]"]));
    assert_eq!(snapshot["/get/data/selectable_mic_device_options"], json!([{ "id": A, "label": "Mic A" }, { "id": H, "label": "Headset Mic" }]));
    assert_eq!(
        snapshot["/get/data/selectable_speaker_device_options"],
        json!([{ "id": S, "label": "Speakers [Loopback]" }, { "id": P, "label": "Headphones [Loopback]" }])
    );
    assert_eq!(snapshot["/get/data/auto_mic_select"], true);
    assert_eq!(snapshot["/get/data/selected_mic_host"], "Windows WASAPI");
    assert_eq!(snapshot["/get/data/selected_mic_device"], "Headset Mic");
    assert_eq!(snapshot["/get/data/selected_mic_device_id"], H);
    assert_eq!(snapshot["/get/data/selected_speaker_device"], "Speakers [Loopback]");
    assert_eq!(snapshot["/get/data/selected_speaker_device_id"], S);
    assert_eq!(
        snapshot["/get/data/virtual_mic_status"],
        json!({ "supported": false, "cables": [], "error": null, "tts_output": null, "tts_output_is_cable": false })
    );

    // Python's order (`applyAutoMicSelect`, then the speaker), all before the snapshot.
    let lines = ui.lines();
    let all = names(&lines);
    let complete = all.iter().position(|n| n == "/run/initialization_complete").unwrap();
    let devices: Vec<&str> = all[..complete].iter().map(String::as_str).filter(|n| n.contains("_device") || n.contains("mic_host")).collect();
    assert_eq!(
        devices,
        [
            "/run/selectable_mic_host_list",
            "/run/selected_mic_host",
            "/run/selectable_mic_device_options",
            "/run/selected_mic_device",
            "/run/selected_mic_device_id",
            "/run/selectable_mic_device_list",
            "/run/selectable_speaker_device_options",
            "/run/selected_speaker_device",
            "/run/selected_speaker_device_id",
            "/run/selectable_speaker_device_list",
        ]
    );
    fake.wait_watching();

    assert_eq!(ui.ok("/run/shutdown", None), true);
    let saved = ui.saved();
    assert_eq!((saved["SELECTED_MIC_HOST"].clone(), saved["SELECTED_MIC_DEVICE"].clone()), (json!("Windows WASAPI"), json!("Headset Mic")));
    assert_eq!((saved["SELECTED_MIC_DEVICE_ID"].clone(), saved["SELECTED_SPEAKER_DEVICE_ID"].clone()), (json!(H), json!(S)));
    eventually("the device monitor lets go at shutdown", || !fake.watching());
    ui.stop();
}

#[test]
fn choosing_by_name_id_and_host_rolls_back_what_is_not_listed() {
    let fake = FakeAudio::with(pc());
    let dir = tempfile::tempdir().unwrap();
    let mut saved = manual();
    saved["SELECTED_MIC_HOST"] = json!("Windows WASAPI");
    saved["SELECTED_MIC_DEVICE"] = json!("Mic A");
    saved["SELECTED_MIC_DEVICE_ID"] = json!(A);
    let ui = start_in(&fake, Some(saved), Some(dir.path()));
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/selected_mic_device_id"], A, "without Auto Select the saved choice stays");
    assert_eq!(snapshot["/get/data/selected_speaker_device"], "NoDevice");

    let mark = ui.send("/set/data/selected_mic_device", Some(json!("Headset Mic")));
    let answer = ui.wait_endpoint(mark, "/set/data/selected_mic_device");
    assert_eq!((answer["status"].clone(), answer["result"].clone()), (json!(200), json!("Headset Mic")));
    let after = ui.lines()[mark..].to_vec();
    let order: Vec<String> = names(&after).into_iter().filter(|n| n.starts_with("/run/")).collect();
    assert_eq!(
        order,
        ["/run/selectable_mic_host_list", "/run/selected_mic_host", "/run/selectable_mic_device_options", "/run/selected_mic_device", "/run/selected_mic_device_id"]
    );
    assert_eq!(ui.on(mark, "/run/selected_mic_device_id")[0]["result"], H);
    assert!(ui.on(mark, "/run/audio_device_switched").is_empty(), "a choice is not a switch");

    assert_eq!(refused(&ui, "/set/data/selected_mic_device", json!("Missing")), "Headset Mic");
    assert_eq!(refused(&ui, "/set/data/selected_mic_device", json!(3)), "Headset Mic");
    assert_eq!(ui.ok("/set/data/selected_mic_device_id", Some(json!(A))), A);
    assert_eq!(ui.ok("/get/data/selected_mic_device", None), "Mic A");
    assert_eq!(refused(&ui, "/set/data/selected_mic_device_id", json!("")), A);
    assert_eq!(refused(&ui, "/set/data/selected_mic_device_id", json!("mic:Windows WASAPI:{gone}")), A);
    assert_eq!(refused(&ui, "/set/data/selected_mic_device_id", json!(5)), A);

    assert_eq!(refused(&ui, "/set/data/selected_mic_host", json!("MME")), "Windows WASAPI");
    assert_eq!(ui.request("/set/data/selected_mic_host", Some(json!(["Windows WASAPI"])))["status"], 500, "Python raised on an unhashable host");
    let mark = ui.send("/set/data/selected_mic_host", Some(json!("Windows WASAPI")));
    assert_eq!(ui.wait_endpoint(mark, "/set/data/selected_mic_host")["result"], "Windows WASAPI");
    assert_eq!(ui.on(mark, "/run/selected_mic_device")[0]["result"], "Mic A", "the saved name is kept under the host");
    assert_eq!(ui.on(mark, "/run/selectable_mic_device_list")[0]["result"], json!(["Mic A", "Headset Mic"]));

    assert_eq!(ui.ok("/set/data/selected_speaker_device", Some(json!("Headphones [Loopback]"))), "Headphones [Loopback]");
    assert_eq!(ui.ok("/get/data/selected_speaker_device_id", None), P);
    assert_eq!(ui.ok("/set/data/selected_speaker_device_id", Some(json!(S))), S);
    assert_eq!(refused(&ui, "/set/data/selected_speaker_device", json!("Headphones")), "Speakers [Loopback]");
    assert_eq!(refused(&ui, "/set/data/selected_speaker_device_id", json!(P.replace("{p}", "{x}"))), S);

    // Kept for the next start.
    assert_eq!(ui.ok("/run/shutdown", None), true);
    ui.stop();
    let ui = start_in(&fake, None, Some(dir.path()));
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/selected_mic_device_id"], A);
    assert_eq!(snapshot["/get/data/selected_speaker_device_id"], S);
    assert_eq!(snapshot["/get/data/auto_speaker_select"], false);
    ui.stop();
}

#[test]
fn an_old_name_that_two_devices_share_is_not_guessed() {
    let fake = FakeAudio::with(windows(&[("Twin Mic", "{t1}"), ("Twin Mic", "{t2}")], Some("{t1}"), &[], None));
    let mut saved = manual();
    saved["SELECTED_MIC_HOST"] = json!("Windows WASAPI");
    let ui = start(&fake, saved);
    ui.ready();
    refused(&ui, "/set/data/selected_mic_device", json!("Twin Mic"));
    assert_eq!(ui.ok("/set/data/selected_mic_device_id", Some(json!("mic:Windows WASAPI:{t2}"))), "mic:Windows WASAPI:{t2}");
    assert_eq!(ui.ok("/get/data/selected_mic_device", None), "Twin Mic");
    let options = ui.ok("/get/data/selectable_mic_device_options", None);
    assert_eq!(options, json!([{ "id": "mic:Windows WASAPI:{t1}", "label": "Twin Mic" }, { "id": "mic:Windows WASAPI:{t2}", "label": "Twin Mic" }]));
    ui.stop();
}

#[test]
fn auto_select_follows_the_os_default_until_it_is_turned_off() {
    let fake = FakeAudio::with(pc());
    let ui = start(&fake, json!({}));
    ui.ready();

    let mark = ui.lines().len();
    fake.set(windows(&[("Mic A", "{a}"), ("Headset Mic", "{h}")], Some("{a}"), &[("Speakers", "{s}"), ("Headphones", "{p}")], Some("{p}")));
    fake.event(Topology::DefaultChanged);
    ui.wait_from(mark, "the new default microphone", |l| l["endpoint"] == "/run/selected_mic_device" && l["result"] == "Mic A");
    ui.wait_from(mark, "the new default speaker", |l| l["endpoint"] == "/run/selected_speaker_device" && l["result"] == "Headphones [Loopback]");
    assert_eq!(ui.ok("/get/data/selected_mic_device_id", None), A);
    assert_eq!(ui.ok("/get/data/selected_speaker_device_id", None), P);

    // Off: the choice stays where it is when the default moves.
    assert_eq!(ui.ok("/set/disable/auto_mic_select", None), false);
    let mark = ui.lines().len();
    fake.set(windows(&[("Mic A", "{a}"), ("Headset Mic", "{h}")], Some("{h}"), &[("Speakers", "{s}"), ("Headphones", "{p}")], Some("{p}")));
    fake.event(Topology::DefaultChanged);
    let core = ui.backend.core().clone();
    eventually("the monitor listed the devices again", || core.audio_devices().snapshot().default_mic_device.device.endpoint_id.as_deref() == Some("{h}"));
    std::thread::sleep(Duration::from_millis(300));
    assert!(ui.on(mark, "/run/selected_mic_device").is_empty());
    assert_eq!(ui.ok("/get/data/selected_mic_device_id", None), A);

    // On again: the default is taken at once, before the answer.
    let mark = ui.send("/set/enable/auto_mic_select", None);
    let answer = ui.wait_endpoint(mark, "/set/enable/auto_mic_select");
    assert_eq!(answer["result"], true);
    let lines = ui.lines();
    let position = |what: &dyn Fn(&Value) -> bool| lines.iter().skip(mark).position(what).unwrap();
    assert!(position(&|l| l["endpoint"] == "/run/selected_mic_device" && l["result"] == "Headset Mic") < position(&|l| l["endpoint"] == "/set/enable/auto_mic_select"));
    assert!(lines.iter().skip(mark).any(|l| l["endpoint"] == "/run/selectable_mic_device_list"));
    ui.stop();
}

#[test]
fn the_lists_follow_unplugged_devices_and_a_lost_choice_falls_back() {
    let fake = FakeAudio::with(pc());
    let mut saved = manual();
    saved["SELECTED_MIC_HOST"] = json!("Windows WASAPI");
    saved["SELECTED_MIC_DEVICE"] = json!("Mic A");
    saved["SELECTED_MIC_DEVICE_ID"] = json!(A);
    let ui = start(&fake, saved);
    ui.ready();

    let mark = ui.lines().len();
    fake.set(windows(&[("Headset Mic", "{h}")], Some("{h}"), &[("Speakers", "{s}")], Some("{s}")));
    fake.event(Topology::DeviceChanged);
    let list = ui.wait_from(mark, "the new microphone list", |l| l["endpoint"] == "/run/selectable_mic_device_list");
    assert_eq!(list["result"], json!(["Headset Mic"]));
    ui.wait_from(mark, "the new speaker list", |l| l["endpoint"] == "/run/selectable_speaker_device_list" && l["result"] == json!(["Speakers [Loopback]"]));
    let order = names(&ui.lines()[mark..]);
    let at = |name: &str| order.iter().position(|n| n == name).unwrap_or_else(|| panic!("{name} was sent"));
    assert!(at("/run/selectable_mic_host_list") < at("/run/selected_mic_device"));
    assert!(at("/run/selected_mic_device") < at("/run/selectable_mic_device_list"));
    assert_eq!(ui.on(mark, "/run/selected_mic_device")[0]["result"], "Headset Mic", "the unplugged choice falls back to the default");
    assert_eq!(ui.ok("/get/data/selected_mic_device_id", None), H);
    assert_eq!(ui.ok("/get/data/selectable_mic_device_options", None), json!([{ "id": H, "label": "Headset Mic" }]));

    // Plugged in again: listed again, the fallback stays chosen.
    let mark = ui.lines().len();
    fake.set(pc());
    fake.event(Topology::DeviceChanged);
    ui.wait_from(mark, "the microphone list again", |l| l["endpoint"] == "/run/selectable_mic_device_list" && l["result"] == json!(["Mic A", "Headset Mic"]));
    assert_eq!(ui.ok("/get/data/selected_mic_device_id", None), H);
    ui.stop();
}

#[test]
fn choices_saved_by_the_python_backend_keep_resolving() {
    // The Python backend listed every microphone under each PortAudio host; MME cuts names at
    // 31 characters. The same device under WASAPI is chosen instead.
    let long = "Microphone (USB Audio Device Pro)";
    let cut: String = long.chars().take(31).collect();
    let lists = || windows(&[("Mic A", "{a}"), (long, "{u}")], Some("{a}"), &[("Speakers", "{s}"), ("Headphones", "{p}")], Some("{s}"));
    let fake = FakeAudio::with(lists());
    let usb = "mic:Windows WASAPI:{u}";

    let mut saved = manual();
    saved["SELECTED_MIC_HOST"] = json!("MME");
    saved["SELECTED_MIC_DEVICE"] = json!(cut);
    saved["SELECTED_MIC_DEVICE_ID"] = json!("");
    let ui = start(&fake, saved);
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/selected_mic_host"], "Windows WASAPI");
    assert_eq!(snapshot["/get/data/selected_mic_device"], long);
    assert_eq!(snapshot["/get/data/selected_mic_device_id"], usb);
    assert_eq!(snapshot["/get/data/selectable_mic_device_list"], json!(["Mic A", long]));
    ui.stop();

    // An identity Python gave a row under another host carries the endpoint ID.
    let mut saved = manual();
    saved["SELECTED_MIC_HOST"] = json!("Windows DirectSound");
    saved["SELECTED_MIC_DEVICE"] = json!(long);
    saved["SELECTED_MIC_DEVICE_ID"] = json!("mic:Windows DirectSound:{u}");
    saved["SELECTED_SPEAKER_DEVICE"] = json!("Headphones [Loopback]");
    saved["SELECTED_SPEAKER_DEVICE_ID"] = json!("speaker:11:{p}");
    let ui = start(&fake, saved);
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/selected_mic_device_id"], usb);
    assert_eq!(snapshot["/get/data/selected_speaker_device_id"], P, "the endpoint ID decides");
    ui.stop();

    // WASAPI choices are Python's identities already: kept as they are.
    let mut saved = manual();
    saved["SELECTED_MIC_HOST"] = json!("Windows WASAPI");
    saved["SELECTED_MIC_DEVICE"] = json!(long);
    saved["SELECTED_MIC_DEVICE_ID"] = json!(usb);
    saved["SELECTED_SPEAKER_DEVICE"] = json!("Headphones [Loopback]");
    saved["SELECTED_SPEAKER_DEVICE_ID"] = json!(P);
    let ui = start(&fake, saved);
    let snapshot = ui.ready();
    assert_eq!((snapshot["/get/data/selected_mic_device_id"].clone(), snapshot["/get/data/selected_speaker_device_id"].clone()), (json!(usb), json!(P)));
    ui.stop();

    // A device that is gone is not guessed: the saved host stays until the lists are watched,
    // then the default takes over as in Python.
    let mut saved = manual();
    saved["SELECTED_MIC_HOST"] = json!("MME");
    saved["SELECTED_MIC_DEVICE"] = json!("Old Mic");
    saved["SELECTED_MIC_DEVICE_ID"] = json!("mic:MME:{old}");
    let ui = start(&fake, saved);
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/selected_mic_host"], "MME");
    assert_eq!(snapshot["/get/data/selectable_mic_device_list"], json!(["NoDevice"]));
    let mark = ui.lines().len();
    fake.event(Topology::DeviceChanged);
    ui.wait_from(mark, "the fallback host", |l| l["endpoint"] == "/run/selected_mic_host" && l["result"] == "Windows WASAPI");
    assert_eq!(ui.ok("/get/data/selected_mic_device_id", None), A);
    ui.stop();
}

#[test]
fn with_no_device_the_placeholders_are_listed() {
    let fake = FakeAudio::new();
    let ui = start(&fake, json!({}));
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/selectable_mic_host_list"], json!(["NoHost"]));
    assert_eq!(snapshot["/get/data/selectable_mic_device_list"], json!(["NoDevice"]));
    assert_eq!(snapshot["/get/data/selectable_speaker_device_list"], json!(["NoDevice"]));
    assert_eq!(snapshot["/get/data/selectable_mic_device_options"], json!([{ "id": "", "label": "NoDevice" }]));
    assert_eq!(snapshot["/get/data/selected_mic_host"], "NoHost");
    assert_eq!(snapshot["/get/data/selected_mic_device"], "NoDevice");
    assert_eq!(snapshot["/get/data/selected_mic_device_id"], "");

    // The speech recognition reports a missing device through this area.
    let mark = ui.lines().len();
    ui.backend.core().audio_devices().notify_device_missing(Source::Speaker);
    let line = ui.wait_endpoint(mark, "/run/error_device");
    assert_eq!((line["status"].clone(), line["result"]["error_code"].clone()), (json!(400), json!("DEVICE_NO_SPEAKER")));
    ui.stop();
}

fn cables() -> CableSetup {
    CableSetup {
        outputs: vec![wasapi_id("Speakers (Realtek Audio)"), wasapi_id("CABLE Input (VB-Audio Virtual Cable)"), wasapi_id("Speakers (Steam Streaming Speakers)")],
        inputs: vec![wasapi_id("Microphone (Realtek Audio)"), wasapi_id("CABLE Output (VB-Audio Virtual Cable)"), wasapi_id("Microphone (Steam Streaming Microphone)")],
        // -12 dBFS, the tone's own level.
        amplitude: 8192,
        ..CableSetup::default()
    }
}

#[test]
fn the_virtual_microphone_check_plays_the_tone_through_the_cable() {
    let fake = FakeAudio::with(pc());
    fake.set_cables(Some(cables()));
    let playback = wasapi_id("CABLE Input (VB-Audio Virtual Cable)");
    let recording = wasapi_id("CABLE Output (VB-Audio Virtual Cable)");
    let mut saved = json!({});
    saved["VOICE_SETTINGS"] = json!({ "output_device": playback });
    let ui = start(&fake, saved);
    let snapshot = ui.ready();
    let cable = json!({
        "playback": playback, "recording": recording,
        "playback_label": "CABLE Input (VB-Audio Virtual Cable)", "recording_label": "CABLE Output (VB-Audio Virtual Cable)",
    });
    assert_eq!(
        snapshot["/get/data/virtual_mic_status"],
        json!({ "supported": true, "cables": [cable], "error": null, "tts_output": playback, "tts_output_is_cable": true }),
        "Steam's loop is not offered"
    );

    let mark = ui.send("/run/virtual_mic_test", Some(json!({ "playback": playback })));
    let answer = ui.wait_endpoint(mark, "/run/virtual_mic_test");
    assert_eq!(answer["status"], 200);
    assert_eq!(answer["result"], json!({ "heard": true, "peak_dbfs": -12.0, "stopped": false, "playback": playback, "recording": recording }));
    let levels: Vec<Value> = ui.on(mark, "/run/virtual_mic_level").iter().map(|l| l["result"].clone()).collect();
    assert_eq!(levels.len(), 25, "24 blocks of 50 ms, then zero");
    assert_eq!(levels[0], json!({ "playback": playback, "level": 0.799 }));
    assert_eq!(levels[24], json!({ "playback": playback, "level": 0.0 }));
    assert_eq!(ui.ok("/get/data/selected_mic_device_id", None), H, "the check changes no choice");

    let conflict = |data: Option<Value>| {
        let answer = ui.request("/run/virtual_mic_test", data);
        assert_eq!(answer["status"], 409, "{answer}");
        error_code(&answer).to_string()
    };
    assert_eq!(conflict(Some(json!({ "playback": wasapi_id("Speakers (Realtek Audio)") }))), "virtual_mic_missing");
    assert_eq!(conflict(None), "virtual_mic_missing");

    fake.set_cables(Some(CableSetup { amplitude: 0, ..cables() }));
    assert_eq!(ui.ok("/run/virtual_mic_test", Some(json!({ "playback": playback })))["heard"], false, "a muted cable passes nothing");
    assert_eq!(ui.ok("/run/virtual_mic_test", Some(json!({ "playback": playback })))["peak_dbfs"], Value::Null);
    fake.set_cables(Some(CableSetup { output_fails: true, ..cables() }));
    assert_eq!(conflict(Some(json!({ "playback": playback }))), "virtual_mic_playback_unavailable");
    fake.set_cables(Some(CableSetup { input_fails: true, ..cables() }));
    assert_eq!(conflict(Some(json!({ "playback": playback }))), "virtual_mic_recording_unavailable");
    fake.set_cables(Some(CableSetup { unreadable: true, ..cables() }));
    assert_eq!(conflict(Some(json!({ "playback": playback }))), "audio_devices_unavailable");
    assert_eq!(ui.ok("/get/data/virtual_mic_status", None)["error"], "audio_devices_unavailable");

    // A stop or mute request ends it at once.
    fake.set_cables(Some(CableSetup { read_delay: Duration::from_millis(50), ..cables() }));
    let mark = ui.send("/run/virtual_mic_test", Some(json!({ "playback": playback })));
    ui.wait_endpoint(mark, "/run/virtual_mic_level");
    ui.backend.core().audio_devices().stop_virtual_mic_check();
    let answer = ui.wait_endpoint(mark, "/run/virtual_mic_test");
    assert_eq!((answer["result"]["stopped"].clone(), answer["result"]["heard"].clone()), (json!(true), json!(false)));

    fake.set_cables(None);
    assert_eq!(conflict(Some(json!({ "playback": playback }))), "virtual_mic_unsupported");
    assert_eq!(ui.ok("/get/data/virtual_mic_status", None)["supported"], false);
    ui.stop();
}

#[test]
fn the_check_is_refused_while_the_voice_is_muted() {
    let fake = FakeAudio::new();
    fake.set_cables(Some(cables()));
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("voice_mute_state.json"), r#"{"version": 1, "muted": true}"#).unwrap();
    let ui = start_in(&fake, Some(json!({})), Some(dir.path()));
    ui.ready();
    let answer = ui.request("/run/virtual_mic_test", Some(json!({ "playback": wasapi_id("CABLE Input (VB-Audio Virtual Cable)") })));
    assert_eq!((answer["status"].clone(), error_code(&answer).to_string()), (json!(409), "virtual_mic_voice_muted".to_string()));
    assert!(ui.on(0, "/run/virtual_mic_level").is_empty(), "no tone");
    ui.stop();
}

/// The speech recognition's capture, as it plugs into this area.
#[derive(Default)]
struct Capture {
    moved: Mutex<Vec<String>>,
    lost: Mutex<Vec<Source>>,
    active: Mutex<Option<Device>>,
}

impl CaptureOwner for Capture {
    fn reconfigure(&self, _: Source, target: &Device, _: Option<&Device>) -> Reopened {
        self.moved.lock().unwrap().push(target.id.clone().unwrap_or_default());
        *self.active.lock().unwrap() = Some(target.clone());
        Reopened::On(Box::new(target.clone()))
    }
    fn device_lost(&self, source: Source) {
        self.lost.lock().unwrap().push(source);
        *self.active.lock().unwrap() = None;
    }
    fn active_device(&self, _: Source) -> Option<Device> {
        self.active.lock().unwrap().clone()
    }
}

#[test]
fn a_running_capture_is_moved_and_its_own_switch_is_reported() {
    let fake = FakeAudio::with(pc());
    let ui = start(&fake, json!({}));
    ui.ready();
    let core = ui.backend.core().clone();
    let capture = Arc::new(Capture::default());
    core.audio_devices().set_capture_owner(capture.clone());
    // What the recognition sets when the user turns transcription on.
    core.config().put("ENABLE_TRANSCRIPTION_SEND", json!(true));

    let mark = ui.lines().len();
    fake.set(windows(&[("Mic A", "{a}"), ("Headset Mic", "{h}")], Some("{a}"), &[("Speakers", "{s}")], Some("{s}")));
    fake.event(Topology::DefaultChanged);
    ui.wait_from(mark, "the capture's device", |l| l["endpoint"] == "/run/selected_mic_device_id" && l["result"] == A);
    assert!(capture.moved.lock().unwrap().contains(&A.to_string()), "the capture moved to the new default");
    assert!(capture.lost.lock().unwrap().is_empty());

    // A device the capture still holds stays in the options until it stops.
    let gone = Device { name: "USB Mic".into(), id: Some("mic:Windows WASAPI:{usb}".into()), ..Device::default() };
    // The default change may still move the capture once more (the list and the default are
    // reconciled separately), so hold the device until the options show it.
    let expected = json!({ "id": "mic:Windows WASAPI:{usb}", "label": "USB Mic" });
    let mut options = Value::Null;
    for _ in 0..100 {
        *capture.active.lock().unwrap() = Some(gone.clone());
        options = ui.ok("/get/data/selectable_mic_device_options", None);
        if options.as_array().and_then(|o| o.last()) == Some(&expected) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert_eq!(options.as_array().unwrap().last().unwrap(), &expected);

    // The capture moved by itself (its device vanished): the switch is reported.
    let mark = ui.lines().len();
    let headset = core.audio_devices().snapshot().mics("Windows WASAPI").unwrap()[1].clone();
    core.audio_devices().publish_device(Source::Mic, Some(&headset), Some(&gone));
    let switched = ui.wait_endpoint(mark, "/run/audio_device_switched");
    assert_eq!(
        switched["result"],
        json!({ "source": "mic", "old_device": { "id": "mic:Windows WASAPI:{usb}", "name": "USB Mic" }, "new_device": { "id": H, "name": "Headset Mic" } })
    );
    assert_eq!(ui.ok("/get/data/selected_mic_device_id", None), H);

    // Every microphone unplugged: the features end and no device is chosen.
    let mark = ui.lines().len();
    fake.set(windows(&[], None, &[("Speakers", "{s}")], Some("{s}")));
    fake.event(Topology::DeviceChanged);
    ui.wait_from(mark, "no microphone", |l| l["endpoint"] == "/run/selected_mic_device" && l["result"] == "NoDevice");
    // The capture hears that its device is gone. The list and the default are reconciled
    // separately, so it may hear it once per update; only the microphone is ever told.
    let deadline = Instant::now() + Duration::from_secs(5);
    while capture.lost.lock().unwrap().is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    let lost = capture.lost.lock().unwrap().clone();
    assert!(!lost.is_empty() && lost.iter().all(|s| *s == Source::Mic), "{lost:?}");
    ui.stop();
}