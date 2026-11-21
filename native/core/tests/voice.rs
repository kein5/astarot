//! TTS, direct voice, voice conversion and the voice route over the connection the UI uses:
//! the controller parts of `tests/voice/test_tts_toggle.py`, `test_tts_toggle_server.py`,
//! `test_spoken_controls.py`, `test_direct_voice_controller.py`, `test_io_flow_controller.py`,
//! `test_managed_controller.py`, `test_vc_runtime_setup.py` and
//! `src-python/test/test_voice_settings_patches.py`, `test_voice_route_monitor_mute.py`.
//!
//! Speech servers are fakes on loopback ports (`common::fake_tts`) or the speech.cpp stand-in
//! (`fake-speech-core`); outputs, microphones and the managed route's gate are in memory
//! (`common::fake_voice`); the RVC worker is the `fake-rvc-worker` stand-in. No model, GPU,
//! audio device or network outside this PC.

mod common;

use common::fake_audio::FakeAudio;
use common::fake_tts::FakeTts;
use common::fake_voice::{source, wasapi, FakeVoice, MonitorFault, MANAGED_VC};
use common::net::eventually;
use common::{error_code, Setup, Ui};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use vrct_core::config::Platform;
use vrct_speech_server::server::Launch;
use vrct_voice_conversion::runtime::{Asset, Library, Runtime};

const OUTPUT: &str = "Windows WASAPI: CABLE Input (VB-Audio Virtual Cable)";

struct Run {
    ui: Ui,
    voice: FakeVoice,
}

fn start_with(saved: Value, platform: Platform, voice: FakeVoice, audio: FakeAudio, launch: bool) -> Run {
    let mut setup = Setup { saved: Some(saved), platform, ..Setup::default() };
    setup.services.voice = voice.platform();
    setup.services.audio = audio.platform();
    if launch {
        setup.services.speech_server_launch = Arc::new(|_| {
            let mut launch = Launch::fixed(env!("CARGO_BIN_EXE_fake-speech-core"));
            launch.start_timeout = Duration::from_secs(10);
            launch
        });
    }
    let ui = Ui::with(setup);
    ui.ready();
    Run { ui, voice }
}

fn start(saved: Value, platform: Platform) -> Run {
    start_with(saved, platform, FakeVoice::new(), FakeAudio::new(), false)
}

impl Run {
    fn status(&self) -> Value {
        self.ui.ok("/get/data/voice_status", None)
    }

    fn generation(&self) -> Value {
        self.status()["tts_generation"].clone()
    }

    fn enable(&self) -> Value {
        let generation = self.generation();
        self.ui.request("/run/enable_tts", Some(json!({ "generation": generation })))
    }

    fn settings(&self, mut changes: Value) -> Value {
        // New settings start on the bundled server (#566). These runs speak through fake servers
        // at the URLs they give, so a URL also chooses the external server, as in the settings page.
        for role in ["japanese", "multilingual"] {
            if changes.get(format!("{role}_url")).is_some() && changes.get(format!("{role}_server")).is_none() {
                changes[format!("{role}_server")] = json!("external");
            }
        }
        self.ui.request("/set/data/voice_settings", Some(changes))
    }

    fn played_on(&self, device: &str) -> usize {
        self.voice.played().iter().filter(|p| p.device == device).map(|p| p.bytes.len()).sum()
    }

    fn process_log(&self) -> String {
        std::fs::read_to_string(self.ui.dir.join("logs").join("process.log")).unwrap_or_default()
    }
}

/// Speech of the original chat, to `OUTPUT`, from a fake speech.cpp server for Japanese.
fn speaking(run: &Run, server: &FakeTts) {
    let answer = run.settings(json!({ "mode": "original", "output_device": OUTPUT, "japanese_url": server.url }));
    assert_eq!(answer["status"], 200, "{answer}");
    let answer = run.enable();
    assert_eq!(answer["status"], 200, "{answer}");
    assert_eq!(answer["result"]["tts_enabled"], true);
}

#[test]
fn tts_starts_off_and_its_switch_names_each_blocking_condition() {
    let run = start(json!({}), Platform::Windows);
    let server = FakeTts::speechcpp(0.2);
    let status = run.status();
    assert_eq!((status["tts_enabled"].clone(), status["muted"].clone(), status["tts_server_starting"].clone()), (json!(false), json!(false), json!(false)));
    for bad in [json!(null), json!({}), json!({ "generation": -1 }), json!({ "generation": true }), json!({ "generation": 0, "x": 1 })] {
        let answer = run.ui.request("/run/enable_tts", Some(bad));
        assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "invalid_tts_toggle"));
    }
    assert_eq!(error_code(&run.enable()), "tts_source_not_selected");

    // A mode needs an output; a refusal answers what the UI shows and changes nothing.
    let refused = run.settings(json!({ "mode": "original" }));
    assert_eq!(refused, json!({ "status": 400, "endpoint": "/set/data/voice_settings", "result": { "error_code": "VOICE_SETTINGS_INVALID", "message": "Invalid voice settings; select an output and local server.", "data": null } }));
    assert_eq!(error_code(&run.settings(json!({ "routing": "managed", "output_device": OUTPUT }))), "VOICE_SETTINGS_INVALID", "no managed route on Windows");
    assert_eq!(error_code(&run.settings(json!({ "unknown": "x" }))), "VOICE_SETTINGS_INVALID");
    assert_eq!(run.ui.ok("/get/data/voice_settings", None)["mode"], "off");

    let old = run.generation();
    let saved = run.settings(json!({ "mode": "original", "output_device": OUTPUT, "japanese_url": server.url }));
    assert_eq!(saved["result"]["mode"], "original");
    // Saving starts a new epoch: an ON decided before it is refused.
    assert_eq!(error_code(&run.ui.request("/run/enable_tts", Some(json!({ "generation": old })))), "tts_state_changed");
    server.set_healthy(false);
    assert_eq!(error_code(&run.enable()), "speech_server_not_ready");
    server.set_healthy(true);
    assert_eq!(run.enable()["result"]["tts_enabled"], true);
    // Translated speech needs translation on.
    run.ui.ok("/run/disable_tts", None);
    run.settings(json!({ "mode": "translated" }));
    assert_eq!(error_code(&run.enable()), "tts_translation_not_ready");
    // The settings were saved, with the masked instructions never logged.
    eventually("the voice settings are saved", || run.ui.saved()["VOICE_SETTINGS"]["mode"] == "translated");
    assert!(!run.process_log().contains(&server.url), "the server address of the voice settings reached the log");
    run.ui.stop();
}

#[test]
fn typed_chat_is_spoken_once_to_the_chosen_output_and_never_logged() {
    let run = start(json!({}), Platform::Windows);
    let server = FakeTts::speechcpp(0.2);
    speaking(&run, &server);
    let mark = run.ui.lines().len();
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "m-1", "message": "spoken words" })));
    eventually("the speech is played", || run.voice.played().iter().any(|p| p.device == OUTPUT && p.closed && p.bytes.len() >= 4800 * 2));
    let request = server.requests().pop().unwrap();
    assert_eq!((request["input"].as_str(), request["language"].as_str(), request["response_format"].as_str()), (Some("spoken words"), Some("ja"), Some("pcm")));
    let played = run.voice.played().into_iter().find(|p| p.device == OUTPUT).unwrap();
    assert_eq!((played.rate, played.channels), (24000, 1));
    eventually("the bus counts it", || run.status()["completed"] == 1);
    // The monitor is off (the default): nothing is opened for it (`disabled_monitor_opens_no_stream`).
    assert!(run.voice.played().iter().all(|p| !p.device.starts_with("monitor:")), "a monitor was opened while it was off");
    // The flow panel's trace: queued, then playing, with the input's text only there.
    let traces = || run.ui.on(mark, "/run/io_trace");
    eventually("the trace says the speech played", || traces().iter().any(|t| t["result"]["outputs"]["speech"]["state"] == "playing"));
    assert_eq!(traces()[0]["result"]["input"], "chat");
    // The same message twice is spoken once (`duplicates`).
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "m-1", "message": "spoken words" })));
    eventually("the duplicate is counted", || run.status()["duplicates"] == 1);
    let log = run.process_log();
    assert!(!log.contains("spoken words"), "the text reached the log");
    assert!(!log.contains("/run/io_trace"));
    run.ui.stop();
}

#[test]
fn japanese_speech_reads_the_terms_with_their_readings() {
    // #446: the built-in "VRChat=ブイアールチャット,…" and a term of the user's.
    let saved = json!({ "REALTIME_ASR_SETTINGS": { "vocabulary": { "builtin": true, "terms": ["猫丸=ねこまる"] } } });
    let run = start(saved, Platform::Windows);
    let server = FakeTts::speechcpp(0.2);
    speaking(&run, &server);
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "m-1", "message": "猫丸とVRChatで" })));
    eventually("the speech is asked for", || !server.requests().is_empty());
    assert_eq!(spoken_inputs(&server)[0], "ねこまるとブイアールチャットで");
    run.ui.stop();
}

// #792: a built-in term the user took out is no longer read with its reading, and one whose readings
// they changed is read with theirs. The settings page lists the built-in terms it can change.
#[test]
fn speech_follows_the_users_changes_of_the_built_in_terms() {
    let saved = json!({ "REALTIME_ASR_SETTINGS": { "vocabulary": { "builtin": true, "terms": ["Friends+=ふれぷら"], "removed": ["VRChat"] } } });
    let run = start(saved, Platform::Windows);
    let builtin = run.ui.ok("/get/data/builtin_vocabulary", None);
    let terms = builtin["terms"].as_array().unwrap();
    assert!(terms.iter().any(|t| t == "VRChat=ブイアールチャット,ブイチャ"), "the list is the shipped one, without the user's changes");
    assert!(terms.iter().any(|t| t == "Friends+=フレンドプラス,フレプラ"));
    let settings = run.ui.ok("/get/data/realtime_asr_settings", None);
    assert_eq!(settings["vocabulary"]["removed"], json!(["VRChat"]));
    let server = FakeTts::speechcpp(0.2);
    speaking(&run, &server);
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "m-1", "message": "VRChatでFriends+のQuest" })));
    eventually("the speech is asked for", || !server.requests().is_empty());
    assert_eq!(spoken_inputs(&server)[0], "VRChatでふれぷらのクエスト");
    run.ui.stop();
}

// #792: the dictionary the settings page shows is written out as the file the page reads back, in
// a folder of its own beside the settings. What is written is checked as a saved dictionary is,
// and none of it reaches the log.
#[test]
fn the_dictionary_is_written_out_to_a_file_the_settings_read_back() {
    let run = start(json!({}), Platform::Windows);
    let vocabulary = json!({ "builtin": true, "terms": ["猫丸 = ねこまる", "Quest=くえすと"], "removed": ["Vket"] });
    let answer = run.ui.ok("/run/export_vocabulary", Some(vocabulary));
    let file = answer["file"].as_str().unwrap();
    assert!(file.starts_with("vocabulary-") && file.ends_with(".txt"), "{file}");
    let text = std::fs::read_to_string(run.ui.dir.join("exports").join(file)).unwrap();
    // The dictionary in use (#792): the user's terms first, then the built-in terms; the one taken
    // out is not written.
    let lines: Vec<&str> = text.lines().filter(|line| !line.starts_with('#')).collect();
    assert_eq!(lines, vrct_transcription::speechcpp::merged_terms(&json!({ "builtin": true,
        "terms": ["猫丸=ねこまる", "Quest=くえすと"], "removed": ["Vket"] })));
    assert_eq!(lines[..2], ["猫丸=ねこまる", "Quest=くえすと"]);
    assert!(lines.iter().any(|line| line.starts_with("VRChat=")) && !lines.iter().any(|line| line.starts_with("Vket")));
    let refused = run.ui.request("/run/export_vocabulary", Some(json!({ "terms": ["a,b"] })));
    assert_eq!((refused["status"].as_u64(), &refused["result"]["error_code"]), (Some(400), &json!("realtime_vocabulary_invalid")));
    let log = run.process_log();
    assert!(!log.contains("猫丸") && !log.contains("くえすと"), "a term reached process.log");
    run.ui.stop();
}

#[test]
fn a_stop_or_mute_cancels_speech_and_a_stale_stamp_is_refused() {
    let run = start(json!({}), Platform::Windows);
    let server = FakeTts::speechcpp(3.0);
    server.set_pace(Duration::from_millis(15));
    speaking(&run, &server);
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "long", "message": "a long one" })));
    eventually("speech plays", || run.played_on(OUTPUT) > 0);
    let before = run.generation();
    let stopped = run.ui.ok("/run/stop_voice", None);
    assert_ne!(stopped["tts_generation"], before, "a stop starts a new epoch");
    eventually("the speech is cancelled", || run.status()["cancelled"] == 1 && run.status()["active"] == false);
    assert_eq!(run.status()["tts_enabled"], true, "a stop is not OFF");

    // A message stamped before a stop is not spoken after it, though its text still goes out.
    let core = run.ui.backend.core().clone();
    let mut data = json!({ "id": "stale", "message": "too late" });
    core.stamp("/run/send_message_box", &mut data);
    run.ui.ok("/run/stop_voice", None);
    let accepted = run.status()["accepted"].clone();
    let answer = run.ui.backend.dispatcher().call(Some("/run/send_message_box"), &data);
    assert_eq!(answer.result["original"]["message"], "too late");
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(run.status()["accepted"], accepted, "the stale speech was queued");

    // Mute: speech stops, the switch refuses ON, the mute is kept for the next start.
    let route = run.ui.ok("/run/mute_voice", None);
    assert_eq!((route["requested_muted"].clone(), route["covers_direct"].clone()), (json!(true), json!(true)));
    eventually("the bus is muted", || run.status()["muted"] == true);
    assert_eq!(error_code(&run.enable()), "voice_route_muted");
    eventually("the mute is saved", || std::fs::read_to_string(run.ui.dir.join("voice_mute_state.json")).is_ok_and(|t| t.contains("true")));
    // The virtual microphone check is refused while muted.
    assert_eq!(run.ui.request("/run/virtual_mic_test", Some(json!({ "output": "x", "input": "y" })))["status"], 409);
    let resumed = run.ui.ok("/run/resume_voice", None);
    assert_eq!(resumed["requested_muted"], false);
    eventually("the bus is unmuted", || run.status()["muted"] == false);
    // OFF.
    let off = run.ui.ok("/run/disable_tts", None);
    assert_eq!(off["tts_enabled"], false);
    run.ui.stop();
}

/// The inputs the server was asked to speak, in order.
fn spoken_inputs(server: &FakeTts) -> Vec<String> {
    server.requests().iter().map(|r| r["input"].as_str().unwrap_or_default().to_owned()).collect()
}

#[test]
fn speech_starts_while_the_server_still_streams_and_messages_follow_in_order() {
    // #279: the start delay and speech one after another (`test_scheduler.py`,
    // `test_tts.py::test_audio_arrives_before_response_completes` through the endpoints).
    let run = start(json!({}), Platform::Windows);
    let server = FakeTts::speechcpp(1.5);
    server.set_pace(Duration::from_millis(15));
    speaking(&run, &server);
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "o-1", "message": "first" })));
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "o-2", "message": "second" })));
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "o-3", "message": "third" })));
    // The first audio plays before the server has sent the whole answer.
    eventually("the first speech is audible", || run.played_on(OUTPUT) > 0);
    eventually("the others wait", || run.status()["queued"] == 2);
    // The bus records the start delay right after the first write returns.
    eventually("the start delay is reported", || run.status()["last_first_write_ms"].is_number());
    let status = run.status();
    assert_eq!((status["active"].clone(), status["completed"].clone()), (json!(true), json!(0)), "{status}");
    assert_eq!(spoken_inputs(&server), ["first"], "a later message was asked for while the first one speaks");

    // Each message is spoken whole, once, in the order it came.
    server.set_pace(Duration::ZERO);
    eventually("all three are spoken", || run.status()["completed"] == 3);
    assert_eq!(spoken_inputs(&server), ["first", "second", "third"]);
    let whole = (24000.0 * 1.5) as usize * 2;
    assert_eq!(run.played_on(OUTPUT), whole * 3, "a message was cut or played twice");
    assert!(run.voice.played().iter().filter(|p| p.device == OUTPUT).all(|p| p.closed));
    let status = run.status();
    assert_eq!((status["dropped"].clone(), status["cancelled"].clone(), status["errors"].clone(), status["queued"].clone()), (json!(0), json!(0), json!(0), json!(0)), "{status}");
    run.ui.stop();
}

#[test]
fn a_stop_cuts_the_speech_and_empties_the_queue_and_the_next_message_speaks() {
    // #279: an interruption (`test_scheduler.py::test_bounded_queue_cancel_and_old_generation`,
    // `test_stopping_speech_is_not_reported_as_expired` through `/run/stop_voice`).
    let run = start(json!({}), Platform::Windows);
    let server = FakeTts::speechcpp(3.0);
    server.set_pace(Duration::from_millis(15));
    speaking(&run, &server);
    for (id, message) in [("c-1", "cut"), ("c-2", "waiting one"), ("c-3", "waiting two")] {
        run.ui.ok("/run/send_message_box", Some(json!({ "id": id, "message": message })));
    }
    eventually("speech plays", || run.played_on(OUTPUT) > 0);
    eventually("the others wait", || run.status()["queued"] == 2);
    run.ui.ok("/run/stop_voice", None);
    eventually("the speech stops", || run.status()["active"] == false);
    let status = run.status();
    assert_eq!(
        (status["cancelled"].clone(), status["dropped"].clone(), status["expired"].clone(), status["queued"].clone(), status["completed"].clone(), status["errors"].clone()),
        (json!(1), json!(2), json!(0), json!(0), json!(0), json!(0)),
        "{status}"
    );
    assert!(run.played_on(OUTPUT) < (24000 * 3) * 2, "the speech played to its end");
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(spoken_inputs(&server), ["cut"], "a message waiting at the stop was spoken");

    // The switch stays on, and a message sent after the stop speaks.
    assert_eq!(run.status()["tts_enabled"], true);
    server.set_pace(Duration::ZERO);
    server.set_seconds(0.1);
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "c-4", "message": "after" })));
    eventually("the next message is spoken", || run.status()["completed"] == 1);
    assert_eq!(spoken_inputs(&server), ["cut", "after"]);
    run.ui.stop();
}

#[test]
fn saving_the_voice_settings_cuts_the_speech_but_keeps_the_switch() {
    // The `configure` stop of `test_tts_playback_ownership.py`, through `/set/data/voice_settings`.
    let run = start(json!({}), Platform::Windows);
    let server = FakeTts::speechcpp(3.0);
    server.set_pace(Duration::from_millis(15));
    speaking(&run, &server);
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "s-1", "message": "cut by a save" })));
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "s-2", "message": "waiting" })));
    eventually("speech plays", || run.played_on(OUTPUT) > 0);
    let before = run.generation();
    let saved = run.settings(json!({ "japanese_voice": "other" }));
    assert_eq!(saved["status"], 200, "{saved}");
    assert_ne!(run.generation(), before, "a save starts a new epoch");
    eventually("the speech stops", || run.status()["active"] == false);
    let status = run.status();
    assert_eq!((status["cancelled"].clone(), status["dropped"].clone(), status["tts_enabled"].clone()), (json!(1), json!(1), json!(true)), "{status}");
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(spoken_inputs(&server), ["cut by a save"]);
    run.ui.stop();
}

#[test]
fn the_mute_survives_a_restart_and_a_broken_record_fails_closed() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("voice_mute_state.json"), r#"{"version": 1, "muted": true}"#).unwrap();
    let mut setup = Setup { dir: Some(dir.path().to_path_buf()), platform: Platform::Windows, ..Setup::default() };
    setup.services.voice = FakeVoice::new().platform();
    let ui = Ui::with(setup);
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/voice_status"]["muted"], true);
    assert_eq!(snapshot["/get/data/voice_route"]["requested_muted"], true);
    ui.stop();

    std::fs::write(dir.path().join("voice_mute_state.json"), "not json").unwrap();
    let mut setup = Setup { dir: Some(dir.path().to_path_buf()), platform: Platform::Windows, ..Setup::default() };
    setup.services.voice = FakeVoice::new().platform();
    let ui = Ui::with(setup);
    let route = ui.ready()["/get/data/voice_route"].clone();
    assert_eq!((route["requested_muted"].clone(), route["ready"].clone(), route["error"].clone()), (json!(true), json!(false), json!("mute_state_unavailable")));
    assert_eq!(error_code(&ui.request("/run/resume_voice", None)), "voice_route_not_ready");
    ui.stop();
}

#[test]
fn the_managed_route_follows_the_os_gate_on_linux() {
    let voice = FakeVoice::new();
    let gate = voice.gate();
    let run = start_with(json!({}), Platform::Linux, voice, FakeAudio::new(), false);
    // Choosing the managed route mutes until the gate confirms, and the gate is closed.
    let saved = run.settings(json!({ "routing": "managed" }));
    assert_eq!(saved["status"], 200, "{saved}");
    eventually("the managed route is ready", || run.ui.ok("/get/data/voice_route", None)["ready"] == true);
    let route = run.ui.ok("/get/data/voice_route", None);
    assert_eq!((route["managed"].clone(), route["requested_muted"].clone(), route["covers_direct"].clone()), (json!(true), json!(true), json!(false)));
    assert!(*gate.source_muted.lock().unwrap());
    run.ui.ok("/run/resume_voice", None);
    eventually("the gate opens", || !*gate.source_muted.lock().unwrap() && run.ui.ok("/get/data/voice_route", None)["observed_muted"] == false);
    // An unknown OS state is not success: the route mutes and waits for another resume.
    gate.fail.store(true, std::sync::atomic::Ordering::SeqCst);
    run.ui.ok("/run/mute_voice", None);
    eventually("the failure is reported", || run.ui.ok("/get/data/voice_route", None)["error"] == "managed_endpoint_missing_or_invalid");
    assert_eq!(run.status()["muted"], true);
    gate.fail.store(false, std::sync::atomic::Ordering::SeqCst);
    // Linux direct voice goes into the managed route, never to a device; it needs the route.
    let state = run.ui.ok("/get/data/direct_voice_state", None);
    assert_eq!(state["output_route"], "managed");
    let mic = source("Mic").id.to_json();
    assert_eq!(run.ui.request("/run/start_direct_voice", Some(json!({ "source": mic })))["status"], 200);
    assert_eq!(run.voice.passthrough_starts(), vec![None]);
    run.ui.ok("/run/stop_direct_voice", None);
    // Leaving the managed route while direct voice runs needs a stop first; then it is left.
    assert_eq!(run.settings(json!({ "routing": "external" }))["status"], 200);
    assert_eq!(error_code(&run.ui.request("/run/start_direct_voice", Some(json!({ "source": mic })))), "source_bridge_managed_required");
    run.ui.stop();
}

#[test]
fn speech_servers_the_switch_starts_are_its_own_and_go_with_it() {
    let models = tempfile::tempdir().unwrap();
    let model = models.path().join("tts.gguf");
    std::fs::write(&model, b"GGUF\0\0\0\0\0\0\0\0").unwrap();
    let row = |model: &str| json!({ "model": model, "vad_model": "", "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false });
    let speech = json!({ "version": 1, "profiles": { "japanese": row(model.canonicalize().unwrap().to_str().unwrap()), "multilingual": row(""), "asr": row("") } });
    let saved = json!({ "SPEECH_SERVER_SETTINGS": speech, "VOICE_SETTINGS": { "mode": "original", "output_device": OUTPUT, "japanese_server": "bundled" } });
    let run = start_with(saved, Platform::Windows, FakeVoice::new(), FakeAudio::new(), true);
    let core = run.ui.backend.core().clone();
    assert!(core.voice_target_idle("japanese"));
    let on = run.enable();
    assert_eq!(on["status"], 200, "{on}");
    let state = run.ui.ok("/get/data/speech_server_state", None);
    assert_eq!(state["japanese"]["state"], "ready");
    // Requests to the server the app started end with it; its port is not probed.
    let port: u16 = state["japanese"]["base_url"].as_str().and_then(|url| url.rsplit(':').next()).and_then(|port| port.parse().ok()).expect("a ready server has an address");
    let address = ("127.0.0.1".to_owned(), port);
    assert!(vrct_tts::listener::listener_monitors().owned(&address).is_some(), "the started server is not owned");
    assert!(!core.voice_target_idle("japanese"), "a model download must not replace the model TTS uses");
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "b-1", "message": "bundled" })));
    eventually("the bundled server's speech plays", || run.played_on(OUTPUT) >= 9600);
    // OFF stops the server the switch started.
    run.ui.ok("/run/disable_tts", None);
    eventually("the server stops", || run.ui.ok("/get/data/speech_server_state", None)["japanese"]["state"] == "stopped");
    assert!(core.voice_target_idle("japanese"));
    assert!(vrct_tts::listener::listener_monitors().owned(&address).is_none(), "a stopped server is still owned");
    // A server started from Settings is not the switch's: OFF leaves it, and its stop turns
    // TTS off.
    let state = run.ui.ok("/get/data/speech_server_state", None);
    run.ui.ok("/run/start_speech_server", Some(json!({ "profile": "japanese", "generation": state["japanese"]["generation"] })));
    eventually("the server is ready", || run.ui.ok("/get/data/speech_server_state", None)["japanese"]["state"] == "ready");
    assert_eq!(run.enable()["result"]["tts_enabled"], true);
    run.ui.ok("/run/stop_speech_server", Some(json!({ "profile": "japanese" })));
    eventually("TTS follows the server's stop", || run.status()["tts_enabled"] == false);
    // A model that is not there is named, and nothing starts.
    run.ui.ok("/set/data/speech_server_settings", Some(json!({ "version": 1, "profiles": { "japanese": row(""), "multilingual": row(""), "asr": row("") } })));
    eventually("the server is stopped", || run.ui.ok("/get/data/speech_server_state", None)["japanese"]["state"] == "stopped");
    let answer = run.enable();
    assert_eq!(answer["status"], 409);
    assert!(["speech_server_model_invalid", "speech_server_start_failed"].contains(&error_code(&answer)), "{answer}");
    run.ui.stop();
}

const MONITOR: &str = "Windows WASAPI: Headphones (Realtek Audio)";

/// A run whose Japanese bundled server serves `stem.gguf` (see the fixture), with `voice` saved.
fn auditioning(stem: &str, voice: Value, audio: FakeAudio) -> (Run, tempfile::TempDir, std::path::PathBuf) {
    let models = tempfile::tempdir().unwrap();
    let model = models.path().join(format!("{stem}.gguf"));
    std::fs::write(&model, b"GGUF\0\0\0\0\0\0\0\0").unwrap();
    let model = model.canonicalize().unwrap();
    let row = |model: &str| json!({ "model": model, "vad_model": "", "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false });
    let speech = json!({ "version": 1, "profiles": { "japanese": row(model.to_str().unwrap()), "multilingual": row(""), "asr": row("") } });
    let run = start_with(json!({ "SPEECH_SERVER_SETTINGS": speech, "VOICE_SETTINGS": voice }), Platform::Windows, FakeVoice::new(), audio, true);
    (run, models, model)
}

impl Run {
    fn start_japanese_server(&self) {
        let state = self.ui.ok("/get/data/speech_server_state", None);
        self.ui.ok("/run/start_speech_server", Some(json!({ "profile": "japanese", "generation": state["japanese"]["generation"] })));
        eventually("the server is ready", || self.ui.ok("/get/data/speech_server_state", None)["japanese"]["state"] == "ready");
    }

    fn audition(&self) -> Value {
        self.ui.request("/run/start_voice_audition", Some(json!({ "kind": "tts", "profile": "japanese", "sentence": "ja" })))
    }

    fn audition_state(&self) -> Value {
        self.ui.ok("/get/data/voice_audition_state", None)
    }

    /// Waits until audition `run` has ended, and gives its outcome.
    fn audition_outcome(&self, run: &Value) -> Value {
        let run = run.as_u64().expect("a run number");
        eventually("the audition ends", || self.audition_state()["last_run"].as_u64().is_some_and(|last| last >= run));
        let state = self.audition_state();
        assert_eq!(state["last_run"], run, "a later audition ended first: {state}");
        json!([state["outcome"], state["error_code"]])
    }
}

/// The 16-bit samples an output received.
fn samples(bytes: &[u8]) -> Vec<i16> {
    bytes.chunks_exact(2).map(|pair| i16::from_le_bytes([pair[0], pair[1]])).collect()
}

#[test]
fn a_voice_audition_plays_on_the_monitor_only_and_never_logs_its_sentence() {
    // #415: the TTS catalog's audition. Only the monitor hears it, at the monitor's volume; the
    // speech output (the virtual cable) is never opened, and TTS itself stays off and untouched.
    let voice = json!({ "output_device": OUTPUT, "monitor": "on", "monitor_device": MONITOR, "monitor_volume": "50", "japanese_voice": "aoi" });
    let (run, _models, model) = auditioning("tts", voice, FakeAudio::new());
    for bad in [json!(null), json!({ "kind": "tts", "profile": "japanese", "sentence": "en" }), json!({ "kind": "tts", "profile": "japanese", "sentence": "ja", "text": "spoken" })] {
        let answer = run.ui.request("/run/start_voice_audition", Some(bad));
        assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "voice_audition_request_invalid"), "{answer}");
    }
    // The profile's bundled server must run: the audition never starts one.
    let answer = run.audition();
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(409), "voice_audition_server_not_ready"));
    assert_eq!(run.ui.ok("/get/data/speech_server_state", None)["japanese"]["state"], "stopped");

    run.start_japanese_server();
    let answer = run.audition();
    assert_eq!(answer["status"], 200, "{answer}");
    assert_eq!((answer["result"]["state"].clone(), answer["result"]["profile"].clone()), (json!("playing"), json!("japanese")));
    assert_eq!(run.audition_outcome(&answer["result"]["run"]), json!(["completed", null]));

    let monitor = format!("monitor:{MONITOR}");
    let played = run.voice.played();
    assert!(played.iter().all(|p| p.device == monitor), "the audition reached another output: {:?}", played.iter().map(|p| &p.device).collect::<Vec<_>>());
    let heard: Vec<i16> = played.iter().flat_map(|p| samples(&p.bytes)).collect();
    assert!(heard.len() >= 2400, "the sentence was not played: {} samples", heard.len());
    assert!(played.iter().all(|p| p.closed && (p.rate, p.channels) == (24000, 1)));
    // At half volume: the tone's peak of 6000 plays at 3000.
    assert_eq!(heard.iter().map(|s| s.unsigned_abs()).max(), Some(3000));

    // The server got the sentence with the profile's voice; the UI's request and the log never did.
    let sent: Value = serde_json::from_slice(&std::fs::read(model.with_extension("gguf.speech")).unwrap()).unwrap();
    let sentence = sent["input"].as_str().unwrap().to_owned();
    assert!(!sentence.trim().is_empty());
    assert_eq!((sent["language"].as_str(), sent["voice"].as_str()), (Some("ja"), Some("aoi")));
    let status = run.status();
    assert_eq!((status["tts_enabled"].clone(), status["accepted"].clone()), (json!(false), json!(0)), "the audition went through TTS: {status}");
    let log = run.process_log();
    assert!(log.contains("/run/start_voice_audition"));
    assert!(!log.contains(&sentence), "the sentence reached the log");
    assert!(!log.contains("/get/data/voice_audition_state"), "a polled state was logged, or the start-up snapshot has it");
    run.ui.stop();
}

#[test]
fn stop_mute_and_a_new_press_end_a_voice_audition_and_a_mute_refuses_one() {
    let audio = FakeAudio::new();
    let voice = json!({ "output_device": OUTPUT, "monitor": "on", "monitor_device": "" });
    let (run, _models, _model) = auditioning("tts-slow", voice, audio.clone());
    run.start_japanese_server();
    let monitor_bytes = || run.voice.played().iter().filter(|p| p.device == "monitor:").map(|p| p.bytes.len()).sum::<usize>();
    let whole = 72000 * 2;

    // Its own stop, which skips the queue.
    let first = run.audition();
    assert_eq!(first["status"], 200, "{first}");
    eventually("the audition plays on the OS default monitor", || monitor_bytes() > 0);
    run.ui.ok("/run/stop_voice_audition", None);
    assert_eq!(run.audition_outcome(&first["result"]["run"]), json!(["stopped", null]));
    assert!(monitor_bytes() < whole, "it played to its end");

    // Stop speech, from the top bar or a hotkey.
    let second = run.audition();
    eventually("it plays", || run.audition_state()["state"] == "playing");
    run.ui.ok("/run/stop_voice", None);
    assert_eq!(run.audition_outcome(&second["result"]["run"]), json!(["stopped", null]));

    // A new press replaces the one playing; one plays at a time.
    let third = run.audition();
    let fourth = run.audition();
    assert_eq!(run.audition_outcome(&third["result"]["run"]), json!(["stopped", null]));
    let state = run.audition_state();
    assert_eq!((state["state"].clone(), state["run"].clone()), (json!("playing"), fourth["result"]["run"].clone()));

    // Mute ends it, and refuses a new one until the voice is unmuted.
    run.ui.ok("/run/mute_voice", None);
    assert_eq!(run.audition_outcome(&fourth["result"]["run"]), json!(["stopped", null]));
    assert_eq!(error_code(&run.audition()), "voice_audition_muted");
    // The route takes a resume only once the mute is confirmed and saved (voice_route_not_ready before).
    eventually("the mute is confirmed", || {
        let route = run.ui.ok("/get/data/voice_route", None);
        route["requested_muted"] == true && route["pending"] == false && route["ready"] == true
    });
    run.ui.ok("/run/resume_voice", None);
    eventually("the bus is unmuted", || run.status()["muted"] == false);
    assert!(run.played_on(OUTPUT) == 0, "the audition reached the speech output");

    // Without a monitor there is no output it may use: no fallback to any other.
    let cables = common::fake_audio::CableSetup { unreadable: true, ..Default::default() };
    audio.set_cables(Some(cables));
    assert_eq!(error_code(&run.audition()), "voice_audition_devices_unavailable");
    audio.set_cables(None);
    assert_eq!(run.settings(json!({ "monitor": "off" }))["status"], 200);
    assert_eq!(error_code(&run.audition()), "voice_audition_monitor_off");
    assert_eq!(run.played_on(OUTPUT), 0);
    // The end of the run ends an audition in progress.
    run.settings(json!({ "monitor": "on" }));
    let last = run.audition();
    assert_eq!(last["status"], 200, "{last}");
    run.ui.stop();
}

#[test]
fn model_options_and_installed_engines_are_asked_without_speaking() {
    let run = start(json!({}), Platform::Windows);
    let server = FakeTts::speechcpp(0.1);
    run.settings(json!({ "multilingual_url": server.url }));
    assert_eq!(error_code(&run.ui.request("/get/data/tts_model_options", Some(json!({ "role": "other" })))), "tts_role_invalid");
    let options = run.ui.ok("/get/data/tts_model_options", Some(json!({ "role": "multilingual", "request_id": "r-1" })));
    assert_eq!(options["options"], json!({ "model": "qwen3-tts", "seed": { "minimum": 0, "maximum": 1000 }, "instructions": true }));
    assert_eq!((options["request_id"].as_str(), options["server"].as_str(), options["error_code"].clone()), (Some("r-1"), Some("external"), Value::Null));
    let bundled = run.settings(json!({ "multilingual_server": "bundled" }));
    assert_eq!(bundled["status"], 200);
    let options = run.ui.ok("/get/data/tts_model_options", Some(json!({ "role": "multilingual" })));
    assert_eq!((options["error_code"].as_str(), options["server_generation"].clone()), (Some("speech_server_not_ready"), json!(0)));
    assert!(server.requests().is_empty(), "nothing was synthesized");

    let engine = FakeTts::voicevox();
    let voices = run.ui.ok("/get/data/tts_engine_voices", Some(json!({ "engine": "voicevox", "url": engine.url, "request_id": "e-1" })));
    assert_eq!(voices["connected"], true);
    assert_eq!(voices["version"], "0.26.1");
    assert_eq!(voices["voices"], json!([{ "id": "3", "speaker": "Speaker A", "style": "Normal" }]), "singing styles and names the settings cannot hold are left out");
    let elsewhere = run.ui.ok("/get/data/tts_engine_voices", Some(json!({ "engine": "voicevox", "url": "http://192.0.2.1:50021", "request_id": "e-2" })));
    assert_eq!((elsewhere["error_code"].as_str(), elsewhere["url"].clone()), (Some("tts_engine_url_invalid"), Value::Null));
    let closed = common::net::free_port();
    let absent = run.ui.ok("/get/data/tts_engine_voices", Some(json!({ "engine": "coeiroink", "url": format!("http://127.0.0.1:{closed}"), "request_id": "e-3" })));
    assert_eq!((absent["connected"].clone(), absent["error_code"].as_str()), (json!(false), Some("tts_engine_not_ready")));
    assert_eq!(error_code(&run.ui.request("/get/data/tts_engine_voices", Some(json!({ "engine": "speechcpp", "url": engine.url, "request_id": "x" })))), "tts_engine_request_invalid");

    // Japanese from an installed engine: ON needs a voice, then a running engine.
    run.settings(json!({ "mode": "original", "output_device": OUTPUT, "japanese_engine": "voicevox", "voicevox_url": engine.url }));
    assert_eq!(error_code(&run.enable()), "tts_engine_voice_unset");
    run.settings(json!({ "engine_voice_id": "3", "engine_voice_speaker": "Speaker A", "engine_voice_style": "Normal" }));
    assert_eq!(run.enable()["result"]["tts_enabled"], true);
    run.ui.stop();
}

#[test]
fn the_output_list_comes_from_the_audio_devices() {
    let audio = FakeAudio::new();
    audio.set_outputs(Some(&[(OUTPUT, "CABLE Input"), ("Windows WASAPI: Speakers", "Speakers")]));
    let run = start_with(json!({}), Platform::Windows, FakeVoice::new(), audio.clone(), false);
    let devices = run.ui.ok("/get/data/voice_output_devices", None);
    assert_eq!(devices, json!({ "devices": [{ "id": OUTPUT, "label": "CABLE Input" }, { "id": "Windows WASAPI: Speakers", "label": "Speakers" }], "error": null }));
    audio.set_outputs(None);
    assert_eq!(run.ui.ok("/get/data/voice_output_devices", None), json!({ "devices": [], "error": "audio_devices_unavailable" }));
    run.ui.stop();
}


/// Waits until the route has confirmed what it was last asked (`ready`, nothing `pending`): a
/// resume is refused before that (`voice_route_not_ready`).
fn route_settled(run: &Run) {
    eventually("the route confirms", || {
        let route = run.ui.ok("/get/data/voice_route", None);
        route["ready"] == true && route["pending"] == false
    });
}

fn start_direct(run: &Run, body: Value) -> Value {
    // The receiver stamps the generation; the UI never sends it.
    run.ui.request("/run/start_direct_voice", Some(body))
}

#[test]
fn direct_voice_passes_the_microphone_through_on_its_own_switch() {
    let voice = FakeVoice::new();
    voice.set_sources(Some(&["Mic (Realtek)", "CABLE Output (VB-Audio Virtual Cable)"]));
    voice.set_outputs(&[OUTPUT]);
    voice.set_default_mic(Some("Mic (Realtek)"));
    let run = start_with(json!({}), Platform::Windows, voice, FakeAudio::new(), false);
    let sources = run.ui.ok("/get/data/direct_voice_sources", None);
    assert_eq!(sources["sources"][0], json!({ "id": source("Mic (Realtek)").id.to_json(), "label": "Mic (Realtek)" }));
    assert_eq!(sources["preferred"]["name"], wasapi("Mic (Realtek)"), "without a Device page choice among them, the OS default is the default input");
    run.voice.set_sources(None);
    assert_eq!(run.ui.ok("/get/data/direct_voice_sources", None), json!({ "sources": [], "error": "source_bridge_devices_unavailable", "preferred": null }));
    run.voice.set_sources(Some(&["Mic (Realtek)", "CABLE Output (VB-Audio Virtual Cable)"]));
    let state = run.ui.ok("/get/data/direct_voice_state", None);
    assert_eq!((state["mode"].as_str(), state["requested"].clone(), state["output_route"].as_str()), (Some("off"), json!(false), Some("device")));

    let mic = source("Mic (Realtek)").id.to_json();
    // A start needs the output device on Windows.
    assert_eq!(error_code(&start_direct(&run, json!({ "source": mic }))), "source_bridge_output_required");
    assert_eq!(error_code(&start_direct(&run, json!({ "source": { "name": "x" } }))), "source_bridge_source_invalid");
    assert_eq!(error_code(&start_direct(&run, json!({ "source": mic, "mode": "passthrough", "options": { "a": 1 } }))), "source_bridge_source_invalid");
    run.settings(json!({ "output_device": OUTPUT }));
    let started = start_direct(&run, json!({ "source": mic }));
    assert_eq!(started["status"], 200, "{started}");
    eventually("the bridge runs", || run.ui.ok("/get/data/direct_voice_state", None)["active"] == true);
    assert_eq!(run.voice.passthrough_starts(), vec![Some(OUTPUT.to_owned())]);
    // The route's mute holds the device silent (no OS gate behind it); resumed, the voice goes.
    eventually("the microphone reaches the device", || run.played_on(OUTPUT) > 0);
    // TTS controls never stop it.
    run.ui.ok("/run/stop_voice", None);
    run.ui.ok("/run/disable_tts", None);
    assert_eq!(run.ui.ok("/get/data/direct_voice_state", None)["requested"], true);
    // Changing the output device while it runs needs an explicit stop.
    assert_eq!(error_code(&run.settings(json!({ "output_device": "Windows WASAPI: Speakers" }))), "direct_voice_stop_required");
    let stopped = run.ui.ok("/run/stop_direct_voice", None);
    assert_eq!(stopped["requested"], false);
    // A start decided before that stop is refused.
    let stale = run.ui.backend.dispatcher().call(Some("/run/start_direct_voice"), &json!({ "source": mic, "_direct_generation": 0 }));
    assert_eq!(stale.result["error_code"], "source_bridge_stale_start");
    run.ui.stop();
}

/// A runtime folder the fake worker accepts, a model, and the options of an RVC start.
fn rvc_files(behaviour: &str) -> (tempfile::TempDir, Value) {
    let dir = tempfile::tempdir().unwrap();
    let runtime = dir.path().join("rvc");
    std::fs::create_dir_all(runtime.join("lib")).unwrap();
    std::fs::write(runtime.join("lib").join(vrct_voice_conversion::worker::ort_library()), b"x").unwrap();
    for asset in vrct_voice_conversion::worker::ASSETS {
        let path = runtime.join("assets").join(asset);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }
    let model = dir.path().join("voice.pth");
    std::fs::write(&model, behaviour).unwrap();
    let options = json!({ "engine": "rvc", "runtime": runtime.to_str().unwrap(), "model": model.to_str().unwrap(), "index": "", "pitch": 0, "index_rate": 0 });
    (dir, options)
}

fn converting_run() -> Run {
    let voice = FakeVoice::new();
    voice.set_sources(Some(&["Mic (Realtek)"]));
    voice.set_outputs(&[OUTPUT]);
    let run = start_with(json!({}), Platform::Windows, voice, FakeAudio::new(), false);
    run.settings(json!({ "output_device": OUTPUT }));
    run
}

#[test]
fn a_conversion_runs_through_the_worker_and_never_passes_the_microphone_through() {
    let run = converting_run();
    let core = run.ui.backend.core().clone();
    let mic = source("Mic (Realtek)").id.to_json();
    let (_files, options) = rvc_files("convert");
    let started = start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }));
    assert_eq!(started["status"], 200, "{started}");
    eventually("the conversion is verified", || run.ui.ok("/get/data/direct_voice_state", None)["conversion_verified"] == true);
    let state = run.ui.ok("/get/data/direct_voice_state", None);
    assert_eq!((state["mode"].as_str(), state["conversion_device"].as_str(), state["conversion_latency_ms"].clone()), (Some("converted"), Some("gpu"), json!(52)));
    assert!(!core.voice_target_idle("rvc"), "a downloaded model must not replace the one converting");
    // Not muted (nothing saved), the device gets the converted voice.
    eventually("converted audio is written", || run.voice.played().iter().any(|p| p.device == OUTPUT && p.bytes.as_chunks::<2>().0.iter().any(|s| *s != [0, 0])));
    let played = run.voice.played().into_iter().find(|p| p.device == OUTPUT).unwrap();
    // The fake worker turns each sample's sign and adds one: never the microphone itself.
    let samples: Vec<i16> = played.bytes.as_chunks::<2>().0.iter().map(|s| i16::from_le_bytes(*s)).filter(|s| *s != 0).collect();
    assert!(!samples.is_empty() && samples.iter().all(|s| (s - 1) % 100 == 0), "a block that was not the worker's answer reached the device");
    // The flow panel shows the converted voice.
    let flow = run.ui.ok("/get/data/io_flow", None);
    assert_eq!((flow["voice"]["outputs"][2]["carried"].as_str(), flow["voice"]["outputs"][2]["engine"].as_str()), (Some("converted"), Some("rvc")));
    // Muted, the device route writes silence: no OS gate is behind it.
    run.ui.ok("/run/mute_voice", None);
    eventually("the flow says muted", || run.ui.ok("/get/data/io_flow", None)["voice"]["outputs"][2]["carried"] == "muted");
    let written = run.played_on(OUTPUT);
    eventually("silence is written", || run.played_on(OUTPUT) > written + 7680);
    let played = run.voice.played().into_iter().find(|p| p.device == OUTPUT).unwrap();
    assert!(played.bytes[played.bytes.len() - 7680..].iter().all(|b| *b == 0), "the muted voice reached the device");
    // Saving direct voice settings needs a stop first.
    assert_eq!(error_code(&run.ui.request("/set/data/direct_voice_settings", Some(json!({ "mode": "converted" })))), "vc_stop_required");
    run.ui.ok("/run/stop_direct_voice", None);
    eventually("the conversion stops", || {
        let state = run.ui.ok("/get/data/direct_voice_state", None);
        state["requested"] == false && state["pending"] == false
    });
    assert!(core.voice_target_idle("rvc"));
    let saved = run.ui.ok("/set/data/direct_voice_settings", Some(json!({ "mode": "converted", "engine": "rvc", "rvc_pitch": 3 })));
    assert_eq!(saved["settings"]["rvc_pitch"], 3);
    assert_eq!(error_code(&run.ui.request("/set/data/direct_voice_settings", Some(json!({ "rvc_pitch": 99 })))), "vc_settings_invalid");
    eventually("the direct voice settings are saved", || run.ui.saved()["DIRECT_VOICE_SETTINGS"]["rvc_pitch"] == 3);
    run.ui.stop();
}

#[test]
fn a_linux_conversion_goes_into_the_managed_vc_input_and_leaves_mute_to_its_gate() {
    // Decision 11: on Linux the converted voice goes into the managed route's VC input, captured
    // from PipeWire (`_PipeWireRoute`). The route's OS gate mutes it; nothing is silenced here.
    // With the monitor off nothing is opened for it (`test_disabled_monitor_opens_nothing`).
    let voice = FakeVoice::new();
    let gate = voice.gate();
    let run = start_with(json!({}), Platform::Linux, voice, FakeAudio::new(), false);
    assert_eq!(run.settings(json!({ "routing": "managed", "monitor": "off" }))["status"], 200);
    eventually("the managed route is ready", || run.ui.ok("/get/data/voice_route", None)["ready"] == true);
    let mic = source("Mic").id.to_json();
    let (_files, options) = rvc_files("convert");
    let started = start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }));
    assert_eq!(started["status"], 200, "{started}");
    eventually("the conversion is verified", || run.ui.ok("/get/data/direct_voice_state", None)["conversion_verified"] == true);
    assert_eq!(run.ui.ok("/get/data/direct_voice_state", None)["output_route"], "managed");
    let converted = |run: &Run| {
        run.voice.played().into_iter().find(|p| p.device == MANAGED_VC).map(|p| p.bytes).unwrap_or_default()
    };
    eventually("converted audio reaches the VC input", || converted(&run).as_chunks::<2>().0.iter().any(|s| *s != [0, 0]));
    let played = run.voice.played().into_iter().find(|p| p.device == MANAGED_VC).unwrap();
    assert_eq!((played.rate, played.channels), (48000, 1));
    assert!(!run.voice.played().iter().any(|p| p.device.starts_with("monitor:")), "a monitor was opened while it was off");
    // The fake worker turns each sample's sign and adds one: never the microphone itself.
    let samples: Vec<i16> = played.bytes.as_chunks::<2>().0.iter().map(|s| i16::from_le_bytes(*s)).filter(|s| *s != 0).collect();
    assert!(samples.iter().all(|s| (s - 1) % 100 == 0), "a block that was not the worker's answer reached the VC input");
    // Muted, the OS gate holds the voice; the conversion keeps writing what it converts.
    run.ui.ok("/run/mute_voice", None);
    eventually("the gate is closed", || *gate.source_muted.lock().unwrap());
    let written = converted(&run).len();
    eventually("the conversion goes on", || converted(&run).len() > written + 7680);
    let bytes = converted(&run);
    assert!(bytes[bytes.len() - 7680..].iter().any(|b| *b != 0), "the conversion wrote silence in place of the gate");
    run.ui.ok("/run/stop_direct_voice", None);
    eventually("the conversion stops", || {
        let state = run.ui.ok("/get/data/direct_voice_state", None);
        state["requested"] == false && state["pending"] == false
    });
    // A Linux build without PipeWire cannot convert, as every Linux build could not before.
    run.voice.set_managed_vc(false);
    assert_eq!(error_code(&start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))), "vc_start_failed");
    run.ui.stop();
}

#[test]
fn a_linux_conversion_is_monitored_and_its_gate_holds_the_monitor_but_not_the_conversion() {
    // The managed route's cases of `test_monitor_vc.py` and `test_vc_monitor_mute.py` (decision
    // 11): the monitor gets the converted blocks the VC input gets; a mute, or a gate that fails,
    // stops the monitor while the conversion goes on; a resume brings it back; and the external
    // route converts nothing and leaves the gate alone.
    let voice = FakeVoice::new();
    let gate = voice.gate();
    let run = start_with(json!({}), Platform::Linux, voice, FakeAudio::new(), false);
    const HEADPHONES: &str = "alsa_output.headphones";
    assert_eq!(run.settings(json!({ "routing": "managed", "monitor": "on", "monitor_device": HEADPHONES }))["status"], 200);
    route_settled(&run);
    run.ui.ok("/run/resume_voice", None);
    eventually("the gate opens", || !*gate.source_muted.lock().unwrap());
    let mic = source("Mic").id.to_json();
    let (_files, options) = rvc_files("convert");
    let monitor = format!("monitor:{HEADPHONES}");
    let monitor_bytes = || run.voice.played().iter().filter(|p| p.device == monitor).map(|p| p.bytes.len()).sum::<usize>();
    let converted = || run.voice.played().iter().filter(|p| p.device == MANAGED_VC).map(|p| p.bytes.len()).sum::<usize>();
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options.clone() }))["status"], 200);
    eventually("the monitor hears the converted voice", || {
        run.voice.played().iter().filter(|p| p.device == monitor).any(|p| p.bytes.as_chunks::<2>().0.iter().any(|s| *s != [0, 0]))
    });
    for played in run.voice.played().into_iter().filter(|p| p.device == monitor || p.device == MANAGED_VC) {
        let samples: Vec<i16> = played.bytes.as_chunks::<2>().0.iter().map(|s| i16::from_le_bytes(*s)).filter(|s| *s != 0).collect();
        assert!(samples.iter().all(|s| (s - 1) % 100 == 0), "{} got audio that was not the worker's answer", played.device);
    }

    // Muted: the gate holds the VC input, the conversion goes on into it, the monitor stops.
    run.ui.ok("/run/mute_voice", None);
    eventually("the gate is closed", || *gate.source_muted.lock().unwrap());
    // What the monitor had taken before the mute may still play out (at most 500 ms).
    std::thread::sleep(Duration::from_millis(700));
    let (heard, written) = (monitor_bytes(), converted());
    eventually("the conversion goes on while muted", || converted() > written + 7680);
    assert_eq!(monitor_bytes(), heard, "the monitor went on while muted");
    route_settled(&run);
    run.ui.ok("/run/resume_voice", None);
    eventually("the monitor hears it again", || monitor_bytes() > heard);

    // A gate that fails mutes the monitor too; the conversion is not stopped, and a resume is
    // refused until the gate answers.
    gate.fail.store(true, std::sync::atomic::Ordering::SeqCst);
    run.ui.ok("/run/mute_voice", None);
    eventually("the failure is reported", || run.ui.ok("/get/data/voice_route", None)["error"] == "managed_endpoint_missing_or_invalid");
    std::thread::sleep(Duration::from_millis(700));
    let (heard, written) = (monitor_bytes(), converted());
    eventually("the conversion goes on", || converted() > written + 7680);
    assert_eq!(monitor_bytes(), heard, "the monitor went on while the gate failed");
    let state = run.ui.ok("/get/data/direct_voice_state", None);
    assert_eq!((state["requested"].clone(), state["active"].clone()), (json!(true), json!(true)));
    assert_eq!(error_code(&run.ui.request("/run/resume_voice", None)), "voice_route_not_ready");
    gate.fail.store(false, std::sync::atomic::Ordering::SeqCst);
    run.ui.ok("/run/stop_direct_voice", None);
    eventually("the conversion stops", || {
        let state = run.ui.ok("/get/data/direct_voice_state", None);
        state["requested"] == false && state["pending"] == false
    });

    // The external route converts nothing and never touches the gate.
    assert_eq!(run.settings(json!({ "routing": "external" }))["status"], 200);
    let (source_muted, direct_muted) = (*gate.source_muted.lock().unwrap(), *gate.direct_muted.lock().unwrap());
    assert_eq!(error_code(&start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))), "source_bridge_managed_required");
    run.ui.ok("/run/mute_voice", None);
    route_settled(&run);
    run.ui.ok("/run/resume_voice", None);
    route_settled(&run);
    assert_eq!(run.status()["muted"], false);
    assert_eq!((*gate.source_muted.lock().unwrap(), *gate.direct_muted.lock().unwrap()), (source_muted, direct_muted), "the external route touched the gate");
    run.ui.stop();
}

#[test]
fn a_monitor_that_fails_or_stalls_never_stops_a_linux_conversion() {
    // `test_monitor_failure_never_affects_converted_output` (missing, unplugged, stalled): the VC
    // input gets every converted block, and a monitor that fails tells its own code. One that
    // stalls only holds itself up.
    for (fault, told) in [
        (MonitorFault::Missing, Some("monitor_output_missing")),
        (MonitorFault::Unplugged, Some("monitor_output_disconnected")),
        (MonitorFault::Stalled(Arc::new(AtomicBool::new(false))), None),
    ] {
        let voice = FakeVoice::new();
        voice.set_monitor_fault(fault.clone());
        let run = start_with(json!({}), Platform::Linux, voice, FakeAudio::new(), false);
        assert_eq!(run.settings(json!({ "routing": "managed", "monitor": "on", "monitor_device": "alsa_output.headphones" }))["status"], 200);
        route_settled(&run);
        run.ui.ok("/run/resume_voice", None);
        let mic = source("Mic").id.to_json();
        let (_files, options) = rvc_files("convert");
        assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
        if let Some(code) = told {
            eventually("the monitor's failure is told", || run.ui.ok("/get/data/direct_voice_state", None)["monitor_error"] == code);
        }
        let converted = || run.voice.played().iter().filter(|p| p.device == MANAGED_VC).map(|p| p.bytes.len()).sum::<usize>();
        eventually("the conversion is verified", || run.ui.ok("/get/data/direct_voice_state", None)["conversion_verified"] == true);
        let written = converted();
        // Four blocks more, as Python waited for.
        eventually("the conversion goes on", || converted() >= written + 4 * 3840);
        let state = run.ui.ok("/get/data/direct_voice_state", None);
        assert_eq!((state["active"].clone(), state["error"].clone()), (json!(true), Value::Null), "{state}");
        if told.is_none() {
            assert_eq!(state["monitor_error"], Value::Null, "a monitor that only waits is not a failure");
        }
        run.ui.ok("/run/stop_direct_voice", None);
        if let MonitorFault::Stalled(release) = fault {
            release.store(true, Ordering::SeqCst);
        }
        run.ui.stop();
    }
}

#[test]
fn a_resume_waits_for_the_gate_and_keeps_tts_and_the_conversion_on() {
    // `test_controller_waits_for_resume_confirmation_and_keeps_both_switches`: a conversion on
    // the managed route starts muted with its monitor; a resume opens the monitor only once the
    // gate has confirmed it; a mute closes it again and leaves TTS and the conversion on, and a
    // stop of the speech touches neither.
    let voice = FakeVoice::new();
    let gate = voice.gate();
    let run = start_with(json!({}), Platform::Linux, voice, FakeAudio::new(), false);
    const HEADPHONES: &str = "alsa_output.headphones";
    assert_eq!(run.settings(json!({ "routing": "managed", "monitor": "on", "monitor_device": HEADPHONES }))["status"], 200);
    route_settled(&run);
    let mic = source("Mic").id.to_json();
    let (_files, options) = rvc_files("convert");
    let monitor = format!("monitor:{HEADPHONES}");
    let monitor_bytes = || run.voice.played().iter().filter(|p| p.device == monitor).map(|p| p.bytes.len()).sum::<usize>();
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
    eventually("the conversion is verified", || run.ui.ok("/get/data/direct_voice_state", None)["conversion_verified"] == true);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(monitor_bytes(), 0, "the monitor was heard while the route was muted");
    assert!(*gate.source_muted.lock().unwrap());
    let generation = run.ui.ok("/get/data/direct_voice_state", None)["generation"].clone();
    run.ui.ok("/run/resume_voice", None);
    route_settled(&run);
    eventually("the monitor hears the conversion", || monitor_bytes() > 0);

    // TTS on; a mute closes the gate and the monitor, and leaves both switches on.
    let server = FakeTts::speechcpp(0.1);
    assert_eq!(run.settings(json!({ "mode": "original", "japanese_url": server.url }))["status"], 200);
    assert_eq!(run.enable()["result"]["tts_enabled"], true);
    run.ui.ok("/run/mute_voice", None);
    route_settled(&run);
    assert!(*gate.source_muted.lock().unwrap());
    std::thread::sleep(Duration::from_millis(700));
    let heard = monitor_bytes();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(monitor_bytes(), heard, "the monitor went on while muted");
    assert_eq!(run.status()["tts_enabled"], true, "a mute is not OFF");
    let state = run.ui.ok("/get/data/direct_voice_state", None);
    assert_eq!((state["generation"].clone(), state["requested"].clone(), state["active"].clone()), (generation.clone(), json!(true), json!(true)));

    // A resume the gate has not confirmed yet keeps everything muted.
    gate.hold_resume.store(true, Ordering::SeqCst);
    gate.resuming.store(false, Ordering::SeqCst);
    run.ui.ok("/run/resume_voice", None);
    eventually("the resume reaches the gate", || gate.resuming.load(Ordering::SeqCst));
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(monitor_bytes(), heard, "the monitor opened before the gate confirmed");
    assert_eq!(run.status()["muted"], true);
    gate.hold_resume.store(false, Ordering::SeqCst);
    route_settled(&run);
    eventually("the monitor hears it again", || monitor_bytes() > heard);
    assert_eq!(run.status()["muted"], false);
    assert_eq!(run.ui.ok("/get/data/direct_voice_state", None)["generation"], generation, "the conversion was restarted");

    // Stopping the speech leaves the monitor and the conversion as they are.
    run.ui.ok("/run/stop_voice", None);
    let heard = monitor_bytes();
    eventually("the monitor goes on", || monitor_bytes() > heard);
    let state = run.ui.ok("/get/data/direct_voice_state", None);
    assert_eq!((state["requested"].clone(), state["active"].clone()), (json!(true), json!(true)));
    run.ui.ok("/run/stop_direct_voice", None);
    run.ui.stop();
}

#[test]
fn a_capture_that_fails_ends_the_conversion_with_its_own_code() {
    // Decision 3 of #733 (`_capture_failed`): a capture's fixed code is shown as it is; the
    // settings explain some of them (`asr_capture_start_timeout`). Anything else is
    // `vc_capture_failed`.
    let run = converting_run();
    let mic = source("Mic (Realtek)").id.to_json();
    let (_files, options) = rvc_files("convert");
    for (code, shown) in [
        ("asr_capture_start_timeout", "asr_capture_start_timeout"),
        ("asr_capture_stream_create_failed", "asr_capture_stream_create_failed"),
        ("asr_capture_failed", "vc_capture_failed"),
        ("the device said something", "vc_capture_failed"),
    ] {
        run.voice.fail_capture(Some(code));
        assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options.clone() }))["status"], 200);
        eventually("the conversion fails", || run.ui.ok("/get/data/direct_voice_state", None)["error"] == shown);
        let state = run.ui.ok("/get/data/direct_voice_state", None);
        assert_eq!((state["requested"].clone(), state["active"].clone()), (json!(false), json!(false)), "{code}: {state}");
        // The next start is refused while this one still cleans up.
        eventually("the conversion has stopped", || {
            let state = run.ui.ok("/get/data/direct_voice_state", None);
            state["pending"] == false && state["stopping"] == false
        });
    }
    run.ui.stop();
}

#[test]
fn a_conversion_converts_in_the_block_of_the_advanced_settings() {
    // #531: the worker chooses unless the user chose a block (0, "automatic", by default). The
    // worker is asked for the saved block when a conversion starts, and the state says which
    // one runs: the stand-in worker chooses 80 ms when asked to choose.
    let run = converting_run();
    let mic = source("Mic (Realtek)").id.to_json();
    let (files, options) = rvc_files("convert");
    let asked = || std::fs::read_to_string(files.path().join("rvc").join("asked-block-ms")).unwrap();
    let converts_in = |asked_for: &str, ms: i64| {
        assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
        eventually("the conversion is verified", || run.ui.ok("/get/data/direct_voice_state", None)["conversion_verified"] == true);
        assert_eq!(run.ui.ok("/get/data/direct_voice_state", None)["conversion_block_ms"], ms);
        assert_eq!(asked(), asked_for);
        run.ui.ok("/run/stop_direct_voice", None);
        eventually("the conversion stops", || {
            let state = run.ui.ok("/get/data/direct_voice_state", None);
            state["requested"] == false && state["pending"] == false
        });
        assert_eq!(run.ui.ok("/get/data/direct_voice_state", None)["conversion_block_ms"], Value::Null);
    };
    assert_eq!(run.ui.ok("/get/data/rvc_block_ms", None), 0);
    converts_in("auto", 80);
    assert_eq!(run.ui.ok("/set/data/rvc_block_ms", Some(json!(120))), 120);
    converts_in("120", 120);
    assert_eq!(run.ui.ok("/set/data/rvc_block_ms", Some(json!(0))), 0);
    converts_in("auto", 80);
    assert_eq!(run.ui.ok("/set/data/rvc_block_ms", Some(json!(120))), 120);
    // Anything but 0 or 20 to 200 ms in steps of 20 is refused, and the saved block stays.
    for bad in [json!(30), json!(10), json!(220), json!(-40), json!("forty"), json!("auto"), json!(null)] {
        let answer = run.ui.request("/set/data/rvc_block_ms", Some(bad.clone()));
        assert_eq!((error_code(&answer), answer["result"]["data"].clone()), ("VALIDATION_RVC_BLOCK_MS", json!(120)), "{bad}");
    }
    run.ui.ok("/run/shutdown", None);
    assert_eq!(run.ui.saved()["RVC_BLOCK_MS"], 120);
    run.ui.stop();
}

#[test]
fn a_worker_that_would_use_another_block_is_refused_and_a_bad_saved_block_loads_as_the_default() {
    let voice = FakeVoice::new();
    voice.set_sources(Some(&["Mic (Realtek)"]));
    voice.set_outputs(&[OUTPUT]);
    // Edited by hand: not a block a conversion may use. It loads as the default: automatic.
    let run = start_with(json!({ "RVC_BLOCK_MS": 30 }), Platform::Windows, voice, FakeAudio::new(), false);
    run.settings(json!({ "output_device": OUTPUT }));
    assert_eq!(run.ui.ok("/get/data/rvc_block_ms", None), 0);
    assert_eq!(run.ui.ok("/set/data/rvc_block_ms", Some(json!(40))), 40);
    let mic = source("Mic (Realtek)").id.to_json();
    // The worker confirms 80 ms when it was asked for 40: its blocks would not be the owner's.
    let (_files, options) = rvc_files("block:80");
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
    eventually("the mismatch is refused", || run.ui.ok("/get/data/direct_voice_state", None)["error"] == "vc_ready_invalid");
    assert_eq!(run.voice.captures(), 0, "the microphone was opened");
    eventually("the refused start has ended", || {
        let state = run.ui.ok("/get/data/direct_voice_state", None);
        state["pending"] == false && state["stopping"] == false
    });
    // Left to the worker, the block it says is the session's (#531).
    assert_eq!(run.ui.ok("/set/data/rvc_block_ms", Some(json!(0))), 0);
    let (_chosen, options) = rvc_files("block:120");
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
    eventually("the conversion is verified", || run.ui.ok("/get/data/direct_voice_state", None)["conversion_verified"] == true);
    assert_eq!(run.ui.ok("/get/data/direct_voice_state", None)["conversion_block_ms"], 120);
    run.ui.stop();
}

#[test]
fn a_conversion_that_cannot_start_says_why_and_opens_nothing() {
    let run = converting_run();
    let mic = source("Mic (Realtek)").id.to_json();
    // The worker refuses to start: its code, and no capture.
    let (_files, options) = rvc_files("fail:vc_gpu_unavailable");
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
    eventually("the worker's refusal is shown", || run.ui.ok("/get/data/direct_voice_state", None)["error"] == "vc_gpu_unavailable");
    assert_eq!(run.ui.ok("/get/data/direct_voice_state", None)["requested"], false);
    assert_eq!(run.voice.captures(), 0, "the microphone was opened");
    // A runtime that is not set up: refused before anything starts.
    let (files, mut options) = rvc_files("convert");
    std::fs::remove_file(files.path().join("rvc").join("lib").join(vrct_voice_conversion::worker::ort_library())).unwrap();
    options["model"] = json!(files.path().join("voice.pth").to_str().unwrap());
    eventually("the failed run is reaped", || run.ui.ok("/get/data/direct_voice_state", None)["pending"] == false);
    assert_eq!(error_code(&start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))), "vc_start_failed");
    // Seed-VC ran on Python: its start fails as a missing runtime did.
    let seed = json!({ "source": mic, "mode": "converted", "options": { "runtime": "x", "reference": "y" } });
    assert_eq!(error_code(&start_direct(&run, seed)), "vc_start_failed");
    // A payload the contract refuses never opens the original.
    let bad = json!({ "source": mic, "mode": "converted", "options": { "engine": "rvc", "runtime": "x", "model": "voice.txt", "index": "", "pitch": 0, "index_rate": 0 } });
    assert_eq!(error_code(&start_direct(&run, bad)), "source_bridge_source_invalid");
    assert!(run.voice.passthrough_starts().is_empty(), "a failed conversion fell back to the microphone");
    run.ui.stop();
}

#[test]
fn a_conversion_is_heard_on_the_monitor_only_while_it_is_on_and_not_muted() {
    // `test_monitor_vc.py`: the monitor gets the same converted blocks as the voice, nothing
    // is opened for it while it is off, a mute stops it while the conversion goes on, and a
    // resume brings it back. The monitor never gets the microphone itself.
    let run = converting_run();
    run.settings(json!({ "monitor": "on", "monitor_device": MONITOR }));
    run.ui.ok("/run/resume_voice", None);
    let mic = source("Mic (Realtek)").id.to_json();
    let (_files, options) = rvc_files("convert");
    let monitor = format!("monitor:{MONITOR}");
    let monitor_bytes = || run.voice.played().iter().filter(|p| p.device == monitor).map(|p| p.bytes.len()).sum::<usize>();
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options.clone() }))["status"], 200);
    eventually("the monitor hears the converted voice", || {
        run.voice.played().iter().filter(|p| p.device == monitor).any(|p| p.bytes.as_chunks::<2>().0.iter().any(|s| *s != [0, 0]))
    });
    for played in run.voice.played().into_iter().filter(|p| p.device == monitor) {
        assert_eq!((played.rate, played.channels), (48000, 1));
        let samples: Vec<i16> = played.bytes.as_chunks::<2>().0.iter().map(|s| i16::from_le_bytes(*s)).filter(|s| *s != 0).collect();
        assert!(samples.iter().all(|s| (s - 1) % 100 == 0), "the monitor got audio that was not the worker's answer");
    }

    // Muted: the conversion goes on to the device (as silence there), the monitor stops.
    run.ui.ok("/run/mute_voice", None);
    eventually("the flow says muted", || run.ui.ok("/get/data/io_flow", None)["voice"]["outputs"][2]["carried"] == "muted");
    // What the monitor had taken before the mute may still play out (at most 500 ms).
    std::thread::sleep(Duration::from_millis(700));
    let (heard, written) = (monitor_bytes(), run.played_on(OUTPUT));
    eventually("the conversion goes on while muted", || run.played_on(OUTPUT) > written + 7680);
    assert_eq!(monitor_bytes(), heard, "the monitor went on while muted");

    // Resumed: the monitor hears it again.
    run.ui.ok("/run/resume_voice", None);
    eventually("the monitor hears it again", || monitor_bytes() > heard);
    run.ui.ok("/run/stop_direct_voice", None);
    eventually("the conversion stops", || {
        let state = run.ui.ok("/get/data/direct_voice_state", None);
        state["requested"] == false && state["pending"] == false
    });

    // Monitor off: a conversion opens nothing for it.
    run.settings(json!({ "monitor": "off" }));
    let before = run.voice.played().iter().filter(|p| p.device.starts_with("monitor:")).count();
    let written = run.played_on(OUTPUT);
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
    eventually("the conversion is written", || run.played_on(OUTPUT) > written + 7680);
    assert_eq!(run.voice.played().iter().filter(|p| p.device.starts_with("monitor:")).count(), before, "a monitor was opened while it was off");
    run.ui.stop();
}

#[test]
fn a_worker_that_stalls_or_only_finds_silence_is_never_taken_for_a_conversion() {
    // `test_seedvc_live.py` and `test_rvc_integration.py` (the generic parts): a worker that
    // answers nothing is stopped as stalled, and one that answers only silence is not
    // confirmed as converting. Neither passes the microphone through.
    let run = converting_run();
    let mic = source("Mic (Realtek)").id.to_json();
    let (_files, options) = rvc_files("stall");
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
    // The block it holds grows too old (`vc_block_expired`) before the 1 s read ends (`vc_worker_stalled`).
    eventually("the stalled worker is stopped", || {
        let error = run.ui.ok("/get/data/direct_voice_state", None)["error"].clone();
        error == "vc_worker_stalled" || error == "vc_block_expired"
    });
    let state = run.ui.ok("/get/data/direct_voice_state", None);
    assert_eq!((state["requested"].clone(), state["conversion_verified"].clone()), (json!(false), json!(false)));
    assert!(run.voice.played().iter().filter(|p| p.device == OUTPUT).all(|p| p.bytes.iter().all(|b| *b == 0)), "a stalled worker's microphone reached the device");
    eventually("the failed run is reaped", || run.ui.ok("/get/data/direct_voice_state", None)["pending"] == false);

    let (_files, options) = rvc_files("silence");
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
    eventually("the conversion runs", || run.ui.ok("/get/data/direct_voice_state", None)["active"] == true);
    let written = run.played_on(OUTPUT);
    eventually("its answers are written", || run.played_on(OUTPUT) > written + 7680);
    let state = run.ui.ok("/get/data/direct_voice_state", None);
    assert_eq!(state["conversion_verified"], false, "silence alone does not show that the worker converts");
    assert!(run.voice.played().iter().filter(|p| p.device == OUTPUT).all(|p| p.bytes.iter().all(|b| *b == 0)), "the microphone reached the device");
    run.ui.ok("/run/stop_direct_voice", None);

    // On the CPU, the state says so with its delay.
    eventually("the silent run stops", || run.ui.ok("/get/data/direct_voice_state", None)["pending"] == false);
    let (_files, options) = rvc_files("cpu");
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
    eventually("the conversion is verified", || run.ui.ok("/get/data/direct_voice_state", None)["conversion_verified"] == true);
    let state = run.ui.ok("/get/data/direct_voice_state", None);
    assert_eq!((state["conversion_device"].as_str(), state["conversion_latency_ms"].clone()), (Some("cpu"), json!(1182)));
    run.ui.stop();
}

#[test]
fn speech_goes_through_a_running_conversion_when_chosen() {
    let run = converting_run();
    let server = FakeTts::speechcpp(0.5);
    let mic = source("Mic (Realtek)").id.to_json();
    let (_files, options) = rvc_files("convert");
    run.settings(json!({ "mode": "original", "japanese_url": server.url, "conversion": "on" }));
    run.ui.ok("/run/resume_voice", None);
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
    eventually("the conversion runs", || run.ui.ok("/get/data/direct_voice_state", None)["active"] == true);
    // Starting the conversion moves the speech generation; an enable stamped with the
    // generation read just before is refused as stale, so it is asked again until it holds.
    eventually("TTS turns on", || run.enable()["result"]["tts_enabled"] == true);
    let mark = run.ui.lines().len();
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "c-1", "message": "through" })));
    eventually("the speech is converted", || run.ui.on(mark, "/run/io_trace").iter().any(|t| t["result"]["outputs"]["speech"]["converted"] == true));
    // No output of its own was opened for the speech: it went into the conversion.
    assert!(run.voice.played().iter().all(|p| p.rate == 48000), "speech opened a device of its own");
    eventually("the speech completes", || run.status()["completed"] == 1);
    run.ui.stop();
}

/// A zip with one stored file.
fn zip(name: &str, data: &[u8]) -> Vec<u8> {
    let crc = vrct_audio_routing::naming::crc32(data);
    let mut out = Vec::new();
    out.extend(b"PK\x03\x04");
    out.extend([20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    out.extend(crc.to_le_bytes());
    out.extend((data.len() as u32).to_le_bytes());
    out.extend((data.len() as u32).to_le_bytes());
    out.extend((name.len() as u16).to_le_bytes());
    out.extend(0u16.to_le_bytes());
    out.extend(name.as_bytes());
    out.extend(data);
    let central = out.len() as u32;
    out.extend(b"PK\x01\x02");
    out.extend([20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    out.extend(crc.to_le_bytes());
    out.extend((data.len() as u32).to_le_bytes());
    out.extend((data.len() as u32).to_le_bytes());
    out.extend((name.len() as u16).to_le_bytes());
    out.extend([0u8; 12]);
    out.extend(0u32.to_le_bytes());
    out.extend(name.as_bytes());
    let size = out.len() as u32 - central;
    out.extend(b"PK\x05\x06");
    out.extend([0u8; 4]);
    out.extend(1u16.to_le_bytes());
    out.extend(1u16.to_le_bytes());
    out.extend(size.to_le_bytes());
    out.extend(central.to_le_bytes());
    out.extend(0u16.to_le_bytes());
    out
}

fn sha(data: &[u8]) -> String {
    vrct_voice_conversion::runtime::sha256_hex(data)
}

/// A small runtime of the same shape as the pinned one, served by the fake transport.
fn small_runtime(voice: &FakeVoice, asset_data: &[u8]) -> Runtime {
    let library = zip("ort/lib/onnxruntime.dll", b"onnx runtime");
    voice.serve("https://github.com/ort.zip", library.clone());
    voice.serve("https://huggingface.co/rmvpe.onnx", b"the asset".to_vec());
    Runtime {
        id: "rvc",
        name: "RVC",
        assets: vec![Asset { url: "https://huggingface.co/rmvpe.onnx".into(), path: "rmvpe/rmvpe.onnx".into(), size: asset_data.len() as u64, sha256: sha(asset_data) }],
        license: "MIT",
        licenses: vec!["https://example.invalid/LICENSE".into()],
        notice: "rvc_cpu",
        download_bytes: library.len() as u64 + asset_data.len() as u64,
        disk_bytes: 1,
        libraries: vec![Library { url: "https://github.com/ort.zip".into(), size: library.len() as u64, sha256: sha(&library), members: vec![("ort/lib/onnxruntime.dll".into(), "onnxruntime.dll".into())] }],
        device: "cpu",
    }
}

fn wait_phase(run: &Run, phase: &str) -> Value {
    let mut last = Value::Null;
    eventually(&format!("the setup reaches {phase}"), || {
        last = run.ui.ok("/get/data/vc_runtime_state", None);
        last["jobs"]["rvc"]["phase"] == phase
    });
    last
}

#[test]
fn the_rvc_runtime_is_set_up_only_after_consent_and_checked_by_the_worker() {
    let voice = FakeVoice::new();
    let runtime = small_runtime(&voice, b"the asset");
    voice.set_runtime(runtime.clone());
    let run = start_with(json!({}), Platform::Windows, voice, FakeAudio::new(), false);
    let catalog = run.ui.ok("/get/data/vc_runtime_catalog", None);
    let row = &catalog["runtimes"][0];
    let version = vrct_voice_conversion::runtime::version_of(&runtime);
    assert_eq!((row["id"].as_str(), row["version"].as_str(), row["device"].as_str(), row["requires_gpu"].clone()), (Some("rvc"), Some(version.as_str()), Some("cpu"), json!(false)));
    assert_eq!(catalog["runtimes"].as_array().unwrap().len(), 1, "Seed-VC is not offered");
    let destination = row["destination"].as_str().unwrap().to_owned();
    assert!(Path::new(&destination).starts_with(&run.ui.dir), "{destination}");

    assert_eq!(error_code(&run.ui.request("/run/start_vc_runtime_setup", Some(json!({ "id": "rvc", "consent": false, "version": version })))), "consent_required");
    assert_eq!(error_code(&run.ui.request("/run/start_vc_runtime_setup", Some(json!({ "id": "rvc", "consent": true, "version": "0" })))), "vc_runtime_changed");
    assert_eq!(error_code(&run.ui.request("/run/start_vc_runtime_setup", Some(json!({ "id": "rvc" })))), "vc_runtime_request_invalid");
    assert!(run.voice.fetched().is_empty(), "something was fetched without consent");

    run.ui.ok("/run/start_vc_runtime_setup", Some(json!({ "id": "rvc", "consent": true, "version": version })));
    let state = wait_phase(&run, "ready");
    assert_eq!(state["installed"]["rvc"], destination);
    assert_eq!(std::fs::read(Path::new(&destination).join("lib/onnxruntime.dll")).unwrap(), b"onnx runtime");
    assert!(Path::new(&destination).join("assets/rmvpe/rmvpe.onnx").is_file());
    assert!(!Path::new(&destination).join("downloads").exists());
    assert_eq!(error_code(&run.ui.request("/run/cancel_vc_runtime_setup", Some(json!({ "id": "rvc", "job_id": "other" })))), "stale_job");
    assert_eq!(error_code(&run.ui.request("/run/cancel_vc_runtime_setup", Some(json!({ "id": "rvc" })))), "download_request_invalid");
    run.ui.stop();
}

#[test]
fn a_failed_runtime_setup_names_its_step() {
    // An asset that is not the pinned file is refused and not kept.
    let voice = FakeVoice::new();
    let runtime = small_runtime(&voice, b"the pinned asset");
    voice.set_runtime(runtime.clone());
    let run = start_with(json!({}), Platform::Windows, voice, FakeAudio::new(), false);
    let version = vrct_voice_conversion::runtime::version_of(&runtime);
    run.ui.ok("/run/start_vc_runtime_setup", Some(json!({ "id": "rvc", "consent": true, "version": version })));
    let state = wait_phase(&run, "failed");
    assert_eq!(state["jobs"]["rvc"]["error_code"], "vc_runtime_assets_failed");
    assert_eq!(state["installed"], json!({}));
    let destination = run.ui.ok("/get/data/vc_runtime_catalog", None)["runtimes"][0]["destination"].as_str().unwrap().to_owned();
    assert!(!Path::new(&destination).join("assets/rmvpe/rmvpe.onnx").exists());
    assert!(Path::new(&destination).join("lib/onnxruntime.dll").is_file(), "the finished step is kept");
    run.ui.stop();

    // The worker's check refuses the runtime.
    let voice = FakeVoice::new();
    let runtime = small_runtime(&voice, b"the asset");
    voice.set_runtime(runtime.clone());
    let run = start_with(json!({}), Platform::Windows, voice, FakeAudio::new(), false);
    let destination = run.ui.ok("/get/data/vc_runtime_catalog", None)["runtimes"][0]["destination"].as_str().unwrap().to_owned();
    std::fs::create_dir_all(&destination).unwrap();
    std::fs::write(Path::new(&destination).join("probe-exit"), "4").unwrap();
    run.ui.ok("/run/start_vc_runtime_setup", Some(json!({ "id": "rvc", "consent": true, "version": vrct_voice_conversion::runtime::version_of(&runtime) })));
    assert_eq!(wait_phase(&run, "failed")["jobs"]["rvc"]["error_code"], "vc_runtime_check_failed");
    run.ui.stop();
}

/// A run of the core on the settings folder `dir`, with `voice`'s runtime setup (#517).
fn start_in(dir: &Path, voice: FakeVoice) -> Run {
    let mut setup = Setup { saved: Some(json!({})), platform: Platform::Windows, dir: Some(dir.to_path_buf()), ..Setup::default() };
    setup.services.voice = voice.platform();
    let ui = Ui::with(setup);
    ui.ready();
    Run { ui, voice }
}

fn set_up_rvc(run: &Run, runtime: &Runtime) -> std::path::PathBuf {
    run.ui.ok("/run/start_vc_runtime_setup", Some(json!({ "id": "rvc", "consent": true, "version": vrct_voice_conversion::runtime::version_of(runtime) })));
    let state = wait_phase(run, "ready");
    std::path::PathBuf::from(state["installed"]["rvc"].as_str().unwrap())
}

#[test]
fn a_repair_puts_the_new_libraries_in_place_of_the_old_ones() {
    let voice = FakeVoice::new();
    let runtime = small_runtime(&voice, b"the asset");
    voice.set_runtime(runtime.clone());
    let run = start_with(json!({}), Platform::Windows, voice, FakeAudio::new(), false);
    let folder = set_up_rvc(&run, &runtime);
    // Something only the earlier libraries hold: the repair's own folder replaces it.
    std::fs::write(folder.join("lib/earlier-only"), b"x").unwrap();
    let again = set_up_rvc(&run, &runtime);
    assert_eq!(again, folder);
    assert_eq!(std::fs::read(folder.join("lib/onnxruntime.dll")).unwrap(), b"onnx runtime");
    assert!(!folder.join("lib/earlier-only").exists(), "the earlier libraries were kept in lib");
    for leftover in ["lib.previous", "lib.part", "downloads", "receipt.json.part"] {
        assert!(!folder.join(leftover).exists(), "{leftover} was left");
    }
    run.ui.stop();
}

#[test]
fn libraries_a_stopped_repair_moved_aside_come_back_at_start() {
    let dir = tempfile::tempdir().unwrap();
    let voice = FakeVoice::new();
    let runtime = small_runtime(&voice, b"the asset");
    voice.set_runtime(runtime.clone());
    let run = start_in(dir.path(), voice);
    let folder = set_up_rvc(&run, &runtime);
    run.ui.stop();

    // A repair stopped between its two renames: the earlier libraries aside, the new ones
    // half unpacked, no lib.
    std::fs::rename(folder.join("lib"), folder.join("lib.previous")).unwrap();
    std::fs::create_dir_all(folder.join("lib.part")).unwrap();
    std::fs::write(folder.join("lib.part/onnxruntime.dll"), b"half").unwrap();
    let voice = FakeVoice::new();
    voice.set_runtime(runtime.clone());
    let run = start_in(dir.path(), voice);
    assert_eq!(run.ui.ok("/get/data/vc_runtime_state", None)["installed"]["rvc"], folder.to_str().unwrap(), "the runtime set up before is not usable");
    assert_eq!(std::fs::read(folder.join("lib/onnxruntime.dll")).unwrap(), b"onnx runtime");
    assert!(!folder.join("lib.previous").exists());
    assert!(run.voice.fetched().is_empty(), "something was fetched to get it back");

    // A receipt cut short by a stop is no receipt: the runtime is not offered as set up.
    std::fs::write(folder.join("receipt.json"), b"{\"version\": \"").unwrap();
    assert_eq!(run.ui.ok("/get/data/vc_runtime_state", None)["installed"], json!({}));
    run.ui.stop();
}

/// Translation through DeepL at a fake provider: Japanese to English (`deepl-free:EN-US:<text>`).
fn translating(voice: FakeVoice) -> (Run, vrct_translation::fake::FakeProviders) {
    let fake = vrct_translation::fake::FakeProviders::start();
    let key = format!("{}:fx", "d".repeat(36));
    fake.key("/deepl-free", &key);
    let mut setup = Setup { saved: Some(json!({ "AUTH_KEYS": { "DeepL_API": key } })), platform: Platform::Windows, ..Setup::default() };
    setup.services.voice = voice.platform();
    setup.services.translation_endpoints = vrct_translation::providers::Endpoints::all_at(&fake.url());
    let ui = Ui::with(setup);
    ui.ready();
    let mut engines = ui.ok("/get/data/selected_translation_engines", None);
    engines["1"] = json!("DeepL_API");
    ui.ok("/set/data/selected_translation_engines", Some(engines));
    assert_eq!(ui.ok("/set/enable/translation", None), true);
    (Run { ui, voice }, fake)
}

#[test]
fn translated_chat_and_microphone_finals_speak_the_selected_translation() {
    let (run, _fake) = translating(FakeVoice::new());
    let japanese = FakeTts::speechcpp(0.1);
    let english = FakeTts::speechcpp(0.1);
    let saved = run.settings(json!({ "mode": "translated", "mic_mode": "translated", "direct_policy": "mix", "output_device": OUTPUT, "japanese_url": japanese.url, "multilingual_url": english.url }));
    assert_eq!(saved["status"], 200, "{saved}");
    assert_eq!(run.enable()["result"]["tts_enabled"], true);
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "t-1", "message": "konnichiwa" })));
    eventually("the translation is spoken", || english.requests().len() == 1);
    let request = english.requests().pop().unwrap();
    assert_eq!((request["input"].as_str(), request["language"].as_str()), (Some("deepl-free:EN-US:konnichiwa"), Some("en")));
    assert!(japanese.requests().is_empty(), "the original was spoken in translated mode");

    // A realtime microphone final (the recognition area hands it over): only a successful
    // translation of the selected target speaks.
    let core = run.ui.backend.core().clone();
    let config = core.config();
    let tab = config.get_str("SELECTED_TAB_NO");
    let targets = config.get("SELECTED_TARGET_LANGUAGES")[&tab].clone();
    let update = |item: &str| vrct_tts::message_hook::TranscriptUpdate {
        source: "mic".into(), is_final: true, state: "final".into(), namespace: "session".into(), item_id: item.into(), text: "ohayou".into(), revision: 1, received_ns: vrct_tts::clock::monotonic_ns(),
    };
    let snapshot = core.mic_voice_snapshot().unwrap();
    let translated = vec!["good morning".to_owned()];
    assert!(!core.publish_mic_voice(&snapshot, &update("a"), &tab, Some("Japanese"), &targets, &translated, &[true], &["failed"], &|| true), "a failed translation spoke");
    assert!(core.publish_mic_voice(&snapshot, &update("b"), &tab, Some("Japanese"), &targets, &translated, &[true], &["translated"], &|| true));
    eventually("the final is spoken", || english.requests().iter().any(|r| r["input"] == "good morning"));
    // A change of the languages cancels the microphone's speech: an older final is refused.
    let snapshot = core.mic_voice_snapshot().unwrap();
    let target = run.ui.ok("/get/data/selected_target_languages", None);
    run.ui.ok("/set/data/selected_target_languages", Some(target));
    assert!(!core.publish_mic_voice(&snapshot, &update("c"), &tab, Some("Japanese"), &targets, &translated, &[true], &["translated"], &|| true));
    // So does turning translation off, and a final that arrives then takes no voice at all.
    let snapshot = core.mic_voice_snapshot().unwrap();
    run.ui.ok("/set/disable/translation", None);
    assert!(!core.publish_mic_voice(&snapshot, &update("d"), &tab, Some("Japanese"), &targets, &translated, &[true], &["translated"], &|| true), "spoken without translation");
    assert!(core.mic_voice_snapshot().is_none(), "a final without translation has no voice");
    run.ui.stop();
}

#[test]
fn the_flow_panel_describes_where_voice_and_chat_go() {
    let run = start(json!({}), Platform::Windows);
    let flow = run.ui.ok("/get/data/io_flow", None);
    assert_eq!(flow["chat"]["outputs"][1], json!({ "id": "speech", "on": false, "reason": "chat_speech_off", "path": null, "content": null, "language": null }));
    assert_eq!(flow["voice"]["outputs"][1]["reason"], "mic_speech_off");
    assert_eq!(flow["voice"]["outputs"][2]["carried"], "vrchat_mic");
    assert_eq!(flow["chat"]["outputs"][0], json!({ "id": "chatbox", "on": true, "reason": null, "content": "original" }));
    let server = FakeTts::speechcpp(0.1);
    speaking(&run, &server);
    let flow = run.ui.ok("/get/data/io_flow", None);
    assert_eq!(flow["chat"]["outputs"][1], json!({ "id": "speech", "on": true, "reason": null, "path": "device", "content": "original", "language": "Japanese" }));
    run.ui.ok("/run/mute_voice", None);
    eventually("the flow says muted", || run.ui.ok("/get/data/io_flow", None)["chat"]["outputs"][1]["reason"] == "muted");
    run.ui.stop();
}

#[test]
fn shutdown_stops_speech_direct_voice_and_the_route() {
    let run = converting_run();
    let server = FakeTts::speechcpp(5.0);
    server.set_pace(Duration::from_millis(15));
    let mic = source("Mic (Realtek)").id.to_json();
    let (_files, options) = rvc_files("convert");
    run.settings(json!({ "mode": "original", "japanese_url": server.url }));
    assert_eq!(start_direct(&run, json!({ "source": mic, "mode": "converted", "options": options }))["status"], 200);
    eventually("the conversion runs", || run.ui.ok("/get/data/direct_voice_state", None)["active"] == true);
    assert_eq!(run.enable()["status"], 200);
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "s-1", "message": "to be cut" })));
    eventually("speech plays", || run.status()["active"] == true);
    run.ui.ok("/run/shutdown", None);
    let core = run.ui.backend.core().clone();
    assert!(!core.voice_target_idle("rvc"), "after the end no model may be put in place");
    eventually("the conversion is gone", || run.ui.backend.dispatcher().call(Some("/get/data/direct_voice_state"), &Value::Null).result["pending"] == false);
    // After the end a start is refused.
    let after = run.ui.backend.dispatcher().call(Some("/run/start_direct_voice"), &json!({ "source": mic, "_direct_generation": 0 }));
    assert_eq!(after.result["error_code"], "source_bridge_closed");
    assert_eq!(run.ui.backend.dispatcher().call(Some("/get/data/voice_status"), &Value::Null).result["closed"], true);
    run.ui.stop();
}

/// A run that recognises the microphone in realtime, translates to English and speaks.
fn realtime_speaking(mic_name: &str) -> (Run, common::fake_asr::FakeAsr, common::fake_capture::FakeCapture, vrct_translation::fake::FakeProviders) {
    use vrct_transcription::capture::Source;
    let fake = vrct_translation::fake::FakeProviders::start();
    let key = format!("{}:fx", "d".repeat(36));
    fake.key("/deepl-free", &key);
    let asr = common::fake_asr::FakeAsr::start();
    let capture = common::fake_capture::FakeCapture::new();
    capture.add_endpoint(Source::Mic, mic_name, "Microphone");
    capture.set_default(Source::Mic, Some(mic_name));
    let realtime = json!({
        "version": 1, "server": "external", "start_server": true, "base_url": asr.base(), "model": "haas-ja",
        "mic": { "language": "ja", "endpoint": null, "follow_default": true },
        "speaker": { "language": "ja", "endpoint": null, "follow_default": true },
        "vocabulary": { "builtin": true, "terms": [] },
    });
    let saved = json!({ "AUTH_KEYS": { "DeepL_API": key }, "REALTIME_ASR_SETTINGS": realtime, "SEND_MESSAGE_TO_VRC": false });
    let mut setup = Setup { saved: Some(saved), platform: Platform::Windows, ..Setup::default() };
    let voice = FakeVoice::new();
    setup.services.voice = voice.platform();
    setup.services.translation_endpoints = vrct_translation::providers::Endpoints::all_at(&fake.url());
    setup.services.transcription_capture = capture.factory();
    let ui = Ui::with(setup);
    ui.ready();
    let mut engines = ui.ok("/get/data/selected_translation_engines", None);
    engines["1"] = json!("DeepL_API");
    ui.ok("/set/data/selected_translation_engines", Some(engines));
    assert_eq!(ui.ok("/set/enable/translation", None), true);
    (Run { ui, voice }, asr, capture, fake)
}

#[test]
fn a_realtime_microphone_final_speaks_its_translation() {
    use vrct_transcription::capture::Source;
    let (run, _asr, capture, _fake) = realtime_speaking("usb.mic");
    let english = FakeTts::speechcpp(0.1);
    let japanese = FakeTts::speechcpp(0.1);
    let saved = run.settings(json!({ "mode": "off", "mic_mode": "translated", "direct_policy": "mix", "output_device": OUTPUT, "japanese_url": japanese.url, "multilingual_url": english.url }));
    assert_eq!(saved["status"], 200, "{saved}");
    assert_eq!(run.enable()["result"]["tts_enabled"], true);
    let state = run.ui.ok("/run/start_realtime_asr", Some(json!({ "source": "mic" })));
    assert_eq!(state["mic"]["requested"], true);
    eventually("the capture opened", || !capture.opened().is_empty());
    capture.hear(Source::Mic, &[common::fake_capture::speech(2000)]);
    eventually("the final's translation is spoken", || english.requests().iter().any(|r| r["language"] == "en"));
    let request = english.requests().into_iter().find(|r| r["language"] == "en").unwrap();
    assert!(request["input"].as_str().unwrap().starts_with("deepl-free:EN-US:"), "the translation was spoken");
    assert!(japanese.requests().is_empty(), "the original was spoken");
    run.ui.ok("/run/stop_realtime_asr", Some(json!({ "source": "mic" })));
    run.ui.stop();
}

#[cfg(windows)]
#[test]
fn realtime_recognition_refuses_the_cable_the_voice_plays_into() {
    let (run, _asr, _capture, _fake) = realtime_speaking("Windows WASAPI: CABLE Output (VB-Audio Virtual Cable)");
    let saved = run.settings(json!({ "mode": "original", "output_device": OUTPUT, "japanese_url": "http://127.0.0.1:9", "multilingual_url": "http://127.0.0.1:9" }));
    assert_eq!(saved["status"], 200, "{saved}");
    let answer = run.ui.request("/run/start_realtime_asr", Some(json!({ "source": "mic" })));
    assert_eq!((answer["status"].clone(), answer["result"]["error_code"].clone()), (json!(400), json!("realtime_endpoint_feedback")));
    run.ui.stop();
}