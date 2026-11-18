//! Realtime recognition on speech.cpp (#278, #288): its settings, endpoints and models, the
//! main switches that run it (Linux, and Windows with the local engine), the start and stop
//! endpoints, captions and finals, what a switch says is missing, a failing server, and
//! shutdown.
//!
//! The behaviours are those of `tests/voice/test_realtime_*.py` (settings, session, delivery,
//! events, toggles), `test_speechcpp_asr.py` and `test_asr_vocabulary.py` for what reaches the
//! server. The server is `common::fake_asr` (the model list and the Realtime WebSocket on
//! 127.0.0.1), the devices `common::fake_capture`.

mod common;

use common::fake_asr::{FakeAsr, recognition_model};
use common::fake_capture::{FakeCapture, speech};
use common::net::eventually;
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::net::UdpSocket;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;
use vrct_adapters::osc::{OscArg, decode_packet};
use vrct_core::config::Platform;
use vrct_core::controller::Services;
use vrct_core::vr_overlay::runtime::fake::FakeVr;
use vrct_transcription::capture::Source;

struct Run {
    ui: Ui,
    capture: FakeCapture,
    asr: FakeAsr,
    chatbox: UdpSocket,
}

fn settings(asr: &FakeAsr) -> Value {
    json!({
        "version": 1, "server": "external", "start_server": true, "base_url": asr.base(), "model": "haas-ja",
        "mic": { "language": "ja", "endpoint": null, "follow_default": true },
        "speaker": { "language": "ja", "endpoint": null, "follow_default": true },
        "vocabulary": { "builtin": true, "terms": ["猫=ねこ"] },
    })
}

fn start(platform: Platform, saved: Value, configure: bool) -> Run {
    start_with_vr(platform, saved, configure, None)
}

/// [`start`] with a SteamVR that runs (`FakeVr::running`), for the VR logs.
fn start_with_vr(platform: Platform, saved: Value, configure: bool, vr: Option<FakeVr>) -> Run {
    let asr = FakeAsr::start();
    let capture = FakeCapture::new();
    capture.add_endpoint(Source::Mic, "alsa.mic", "USB Mic");
    capture.add_endpoint(Source::Speaker, "alsa.out", "Speakers");
    capture.set_default(Source::Mic, Some("alsa.mic"));
    capture.set_default(Source::Speaker, Some("alsa.out"));
    let chatbox = UdpSocket::bind(("127.0.0.2", 0)).unwrap();
    let mut saved = saved;
    saved["OSC_IP_ADDRESS"] = json!("127.0.0.2");
    saved["OSC_PORT"] = json!(chatbox.local_addr().unwrap().port());
    if configure {
        saved["REALTIME_ASR_SETTINGS"] = settings(&asr);
    }
    let mut services = Services { transcription_capture: capture.factory(), ..Setup::default().services };
    if let Some(vr) = vr {
        services.vr = Arc::new(vr);
    }
    let ui = Ui::with(Setup { saved: Some(saved), services, platform, ..Setup::default() });
    ui.ready();
    Run { ui, capture, asr, chatbox }
}

impl Run {
    fn chatbox_text(&self, wait: Duration) -> Option<String> {
        self.chatbox.set_read_timeout(Some(wait)).unwrap();
        let mut buffer = [0u8; 4096];
        loop {
            let (size, _) = self.chatbox.recv_from(&mut buffer).ok()?;
            for message in decode_packet(&buffer[..size]).unwrap() {
                if let ("/chatbox/input", Some(OscArg::String(text))) = (message.address.as_str(), message.args.first()) {
                    return Some(text.clone());
                }
            }
        }
    }

    /// Waits for a caption row in `state`.
    fn caption(&self, from: usize, state: &str) -> Value {
        self.ui.wait_from(from, state, |l| l["endpoint"] == "/run/realtime_caption" && l["result"]["state"] == state)["result"].clone()
    }

    fn process_log(&self) -> String {
        std::fs::read_to_string(self.ui.dir.join("logs").join("process.log")).unwrap_or_default()
    }
}

#[test]
fn settings_are_normalized_saved_and_refused_with_a_code() {
    let run = start(Platform::Windows, json!({}), false);
    let defaults = run.ui.ok("/get/data/realtime_asr_settings", None);
    assert_eq!((defaults["server"].clone(), defaults["mic"]["language"].clone(), defaults["speaker"]["language"].clone()), (json!("external"), json!("ja"), json!("auto")));

    let answer = run.ui.request("/set/data/realtime_asr_settings", Some(json!({ "server": "cloud" })));
    assert_eq!((answer["status"].clone(), answer["result"].clone()), (json!(400), json!({ "error_code": "realtime_settings_invalid" })));
    let answer = run.ui.request("/set/data/realtime_asr_settings", Some(json!({ "base_url": "http://192.168.0.2:8080" })));
    assert_eq!(answer["result"]["error_code"], "realtime_settings_invalid", "only this PC");

    let mut wanted = settings(&run.asr);
    wanted["mic"]["endpoint"] = json!({ "cookie": "7", "serial": "100", "name": "alsa.mic", "media_class": "Audio/Source" });
    let stored = run.ui.ok("/set/data/realtime_asr_settings", Some(wanted.clone()));
    assert_eq!(stored["mic"]["endpoint"]["serial"], "100");
    assert_eq!(stored["vocabulary"]["terms"], json!(["猫=ねこ"]));
    assert_eq!(run.ui.ok("/get/data/realtime_asr_settings", None), stored);
    run.ui.ok("/run/shutdown", None);
    assert_eq!(run.ui.saved()["REALTIME_ASR_SETTINGS"], stored);
    run.ui.stop();
}

#[test]
fn endpoints_and_models_come_from_the_devices_and_the_server() {
    let run = start(Platform::Windows, json!({}), true);
    let endpoints = run.ui.ok("/get/data/realtime_asr_endpoints", Some(json!({ "source": "mic" })));
    assert_eq!(
        endpoints,
        json!({ "source": "mic", "endpoints": [{ "endpoint": { "cookie": "7", "serial": "100", "name": "alsa.mic", "media_class": "Audio/Source" }, "label": "USB Mic" }], "error_code": null })
    );
    let answer = run.ui.request("/get/data/realtime_asr_endpoints", Some(json!({ "source": "both" })));
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "realtime_source_invalid"));

    let models = run.ui.ok("/get/data/realtime_asr_models", None);
    assert_eq!(models["error_code"], Value::Null);
    assert_eq!(models["models"][0]["id"], "haas-ja");
    assert_eq!(models["models"][0]["options"], json!(["keywords", "language"]));
    assert_eq!(models["models"][0]["detects_language"], false);

    // The bundled server is not running: nothing to ask.
    let mut bundled = settings(&run.asr);
    bundled["server"] = json!("bundled");
    run.ui.ok("/set/data/realtime_asr_settings", Some(bundled));
    let models = run.ui.ok("/get/data/realtime_asr_models", None);
    assert_eq!((models["error_code"].clone(), models["base_url"].clone()), (json!("speech_server_not_ready"), Value::Null));
    assert!(models["server_generation"].is_u64());

    // A server that does not answer.
    let mut gone = settings(&run.asr);
    gone["base_url"] = json!(format!("http://127.0.0.1:{}", common::net::free_port()));
    run.ui.ok("/set/data/realtime_asr_settings", Some(gone));
    assert_eq!(run.ui.ok("/get/data/realtime_asr_models", None)["error_code"], "realtime_models_unavailable");
    run.ui.stop();
}

#[test]
fn the_main_switch_streams_the_microphone_and_its_final_goes_out() {
    let run = start(Platform::Linux, json!({ "LOGGER_FEATURE": true }), true);
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    // The session opens the default it resolved at start, once the server took it.
    eventually("the capture opened", || run.capture.opened() == vec![(Source::Mic, "alsa.mic".to_string())]);
    run.capture.hear(Source::Mic, &[speech(2000)]);
    let partial = run.caption(mark, "partial");
    assert_eq!((partial["text"].clone(), partial["source"].clone(), partial["revision"].clone()), (json!("こん"), json!("mic"), json!(1)));
    assert!(partial["generation"].is_u64() && partial["expires_ns"].is_u64());
    let final_ = run.caption(mark, "final");
    assert_eq!(final_["text"], "こんにちは");
    let translated = run.caption(mark, "translated");
    assert_eq!((translated["original"]["message"].clone(), translated["revision"].clone()), (json!("こんにちは"), json!(3)));
    let outcome = run.caption(mark, "outcome");
    assert_eq!((outcome["outcome"].clone(), outcome["reason"].clone(), outcome["revision"].clone()), (json!("delivered"), Value::Null, json!(4)));
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("こんにちは"));
    // The session asked for its model and sent the vocabulary as keywords; audio was 24 kHz.
    assert!(run.asr.requested("GET /v1/realtime?model=haas-ja") >= 1);
    assert!(run.asr.appends.load(Ordering::SeqCst) >= 25);

    let state = run.ui.ok("/get/data/realtime_asr_state", None);
    assert_eq!((state["mic"]["state"].clone(), state["mic"]["requested"].clone()), (json!("ready"), json!(true)));
    assert_eq!(state["speaker"]["state"], "idle");

    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/disable/transcription_send", None), false);
    eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);
    let state = run.ui.ok("/get/data/realtime_asr_state", None);
    assert_eq!(state["mic"]["requested"], false);
    assert!(run.ui.on(mark, "/set/enable/transcription_send").is_empty(), "no failure was told");
    assert!(!run.process_log().contains("こんにちは"), "recognised text reached process.log");
    assert!(!run.process_log().contains("realtime_caption"), "captions are not logged");
    run.ui.stop();
}

#[test]
fn captions_are_drawn_on_the_large_vr_log_and_one_it_cannot_show_is_told() {
    // `test_realtime_overlay*.py` and the realtime cases of `test_overlay_lifecycle_publication.py`
    // through the core: each caption state draws the large log; a picture SteamVR refuses is
    // told as the caption's `overlay_large` output failure, and the final still goes out.
    let fake = FakeVr::running();
    let run = start_with_vr(Platform::Linux, json!({ "OVERLAY_LARGE_LOG": true }), true, Some(fake.clone()));
    eventually("the large log made", || fake.handle("VRCT1").is_some());
    let large = fake.handle("VRCT1").unwrap();
    let drawn = || fake.calls_on(large, "raw");
    let before = drawn().len();
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the capture opened", || run.capture.running(Source::Mic) == 1);
    run.capture.hear(Source::Mic, &[speech(600)]);
    for state in ["partial", "final", "translated"] {
        run.caption(mark, state);
    }
    eventually("each state drew the log", || drawn().len() >= before + 3);
    let last = drawn().last().cloned().unwrap();
    assert!(!last.ends_with(" 1x1"), "the log shows the caption: {last}");
    assert!(run.ui.on(mark, "/run/message_output_error").is_empty());
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("こんにちは"));

    // SteamVR refuses the pictures from now on.
    fake.with(|s| s.fail_pictures = true);
    let mark = run.ui.lines().len();
    run.capture.hear(Source::Mic, &[speech(600)]);
    let partial = run.caption(mark, "partial");
    let failure = run.ui.wait_from(mark, "the caption's output failure", |l| l["endpoint"] == "/run/message_output_error");
    assert_eq!(failure["status"], 400);
    let data = failure["result"]["data"].clone();
    assert_eq!((data["source"].clone(), data["output"].clone(), data["error_code"].clone()), (json!("mic"), json!("overlay_large"), json!("MESSAGE_OUTPUT_FAILED")));
    // The id is the caption's (`namespace:item`); the fake server keeps speaking, so it may be a
    // later state of an earlier utterance.
    let namespace = partial["namespace"].as_str().unwrap();
    let item = data["id"].as_str().unwrap().strip_prefix(&format!("{namespace}:")).expect("the session's namespace").to_string();
    assert!(run.ui.lines().iter().any(|l| l["endpoint"] == "/run/realtime_caption" && l["result"]["item_id"] == item.as_str()), "{item}");
    // The caption rows still reach the UI, the final still goes out, and recognition goes on.
    run.caption(mark, "translated");
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("こんにちは"));
    let state = run.ui.ok("/get/data/realtime_asr_state", None);
    assert_eq!((state["mic"]["state"].clone(), state["mic"]["requested"].clone()), (json!("ready"), json!(true)));
    assert!(run.ui.on(mark, "/set/disable/transcription_send").is_empty());
    run.ui.stop();
}

#[test]
fn the_vocabulary_puts_right_what_the_model_wrote() {
    // #446: a reading the model wrote becomes its written form, in the captions and what goes out.
    let run = start(Platform::Linux, json!({}), true);
    let mut wanted = settings(&run.asr);
    wanted["vocabulary"] = json!({ "builtin": false, "terms": ["今日は=こんにちは"] });
    run.ui.ok("/set/data/realtime_asr_settings", Some(wanted));
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the capture opened", || !run.capture.opened().is_empty());
    run.capture.hear(Source::Mic, &[speech(2000)]);
    assert_eq!(run.caption(mark, "final")["text"], "今日は");
    assert_eq!(run.caption(mark, "translated")["original"]["message"], "今日は");
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("今日は"));
    assert!(!run.process_log().contains("今日は"), "a term reached process.log");
    run.ui.stop();
}

#[test]
fn the_chosen_silence_ends_utterances_with_at_most_half_of_it_as_padding() {
    // #556: a shorter silence gives the result sooner; left out, it is 500 ms. The padding is
    // at most half the silence, so the server gives the utterance once the silence has lasted.
    for chosen in [None, Some(300)] {
        let run = start(Platform::Linux, json!({}), true);
        if let Some(ms) = chosen {
            let mut settings = run.ui.ok("/get/data/realtime_asr_settings", None);
            settings["silence_duration_ms"] = json!(ms);
            assert_eq!(run.ui.ok("/set/data/realtime_asr_settings", Some(settings))["silence_duration_ms"], ms);
        }
        assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
        eventually("the session is configured", || !run.asr.turn_detection.lock().unwrap().is_empty());
        let sent = run.asr.turn_detection.lock().unwrap()[0].clone();
        match chosen {
            Some(ms) => assert_eq!(sent, json!({ "type": "server_vad", "silence_duration_ms": ms, "prefix_padding_ms": 150 })),
            None => assert_eq!(sent, json!({ "type": "server_vad", "silence_duration_ms": 500, "prefix_padding_ms": 250 })),
        }
        run.ui.stop();
    }
}

#[test]
fn a_saved_google_engine_leaves_realtime_recognition_as_it_was() {
    // Linux with a config.json that chose the retired Google engine: the main switch still streams.
    let run = start(Platform::Linux, json!({ "SELECTED_TRANSCRIPTION_ENGINE": "Google", "LOCAL_ASR_MIGRATION": 2 }), true);
    assert_eq!(run.ui.ok("/get/data/selected_transcription_engine", None), Value::Null);
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the capture opened", || run.capture.opened() == vec![(Source::Mic, "alsa.mic".to_string())]);
    run.capture.hear(Source::Mic, &[speech(2000)]);
    assert_eq!(run.caption(mark, "final")["text"], "こんにちは");
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("こんにちは"));
    run.ui.ok("/set/disable/transcription_send", None);
    run.ui.stop();
}

#[test]
fn the_settings_page_starts_and_stops_a_session_beside_the_recorder() {
    // Windows with a cloud engine: the main switches run the recorder.
    let run = start(Platform::Windows, json!({ "SELECTED_TRANSCRIPTION_ENGINE": "Groq_Whisper" }), true);
    assert_eq!(run.ui.ok("/get/data/selected_transcription_engine", None), "Groq_Whisper");
    let answer = run.ui.request("/run/start_realtime_asr", Some(json!({ "source": "both" })));
    assert_eq!((answer["status"].clone(), answer["result"].clone()), (json!(400), json!({ "error_code": "realtime_start_invalid" })));

    let mark = run.ui.lines().len();
    let state = run.ui.ok("/run/start_realtime_asr", Some(json!({ "source": "speaker" })));
    assert_eq!(state["speaker"]["requested"], true);
    // The recorder of that source stops, and its switches show it.
    assert_eq!(run.ui.on(mark, "/set/disable/check_speaker_threshold")[0]["result"], false);
    assert_eq!(run.ui.on(mark, "/set/disable/transcription_receive")[0]["result"], false);
    let answer = run.ui.request("/run/start_realtime_asr", Some(json!({ "source": "speaker" })));
    assert_eq!((answer["status"].clone(), answer["result"]["error_code"].clone()), (json!(409), json!("realtime_already_started")));

    run.capture.hear(Source::Speaker, &[speech(2000)]);
    assert_eq!(run.caption(mark, "final")["source"], "speaker");
    assert_eq!(run.caption(mark, "outcome")["outcome"], "delivered");
    // The other party's speech never goes to the chatbox.
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none());

    let state = run.ui.ok("/run/stop_realtime_asr", Some(json!({ "source": "speaker" })));
    assert_eq!(state["speaker"]["requested"], false);
    eventually("the capture stopped", || run.capture.running(Source::Speaker) == 0);
    // A new start after a stop is a new generation.
    let generation = run.ui.ok("/get/data/realtime_asr_state", None)["speaker"]["generation"].as_u64().unwrap();
    let state = run.ui.ok("/run/start_realtime_asr", Some(json!({ "source": "speaker" })));
    assert!(state["speaker"]["generation"].as_u64().unwrap() > generation);
    run.ui.stop();
}

#[test]
fn leaving_the_local_engine_stops_its_realtime_session() {
    // #394: on Windows the local engine listens through realtime recognition; choosing a cloud
    // engine stopped nothing, and the switch then turned off the recorder instead.
    let run = start(Platform::Windows, json!({ "SELECTED_TRANSCRIPTION_ENGINE": "SpeechCpp" }), true);
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the capture opened", || run.capture.running(Source::Mic) == 1);
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/data/selected_transcription_engine", Some(json!("Groq_Whisper"))), "Groq_Whisper");
    assert_eq!(run.ui.wait_endpoint(mark, "/set/disable/transcription_send")["result"], false);
    assert_eq!(run.ui.ok("/get/data/realtime_asr_state", None)["mic"]["requested"], false);
    eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);
    run.capture.hear(Source::Mic, &[speech(2000)]);
    std::thread::sleep(Duration::from_millis(500));
    assert!(run.ui.on(mark, "/run/realtime_caption").is_empty(), "no caption after the engine changed");
    run.ui.stop();
}

#[test]
fn a_switch_says_what_is_missing() {
    let run = start(Platform::Linux, json!({}), true);
    let not_ready = |run: &Run| {
        let mark = run.ui.send("/set/enable/transcription_send", None);
        let answer = run.ui.wait_from(mark, "the answer", |l| l["endpoint"] == "/set/enable/transcription_send");
        assert_eq!(error_code(&answer), "TRANSCRIPTION_SEND_NOT_READY", "{answer}");
        assert_eq!(answer["result"]["data"], false);
        answer["result"]["details"]["reason"].as_str().unwrap_or_default().to_string()
    };
    let set = |run: &Run, change: &dyn Fn(&mut Value)| {
        let mut value = settings(&run.asr);
        change(&mut value);
        run.ui.ok("/set/data/realtime_asr_settings", Some(value));
    };
    set(&run, &|s| s["model"] = json!(""));
    assert_eq!(not_ready(&run), "realtime_model_required");
    set(&run, &|s| s["model"] = json!("other-model"));
    assert_eq!(not_ready(&run), "realtime_model_unavailable");
    set(&run, &|s| s["mic"]["language"] = json!("en"));
    assert_eq!(not_ready(&run), "realtime_language_unsupported");
    set(&run, &|s| s["mic"]["language"] = json!("auto"));
    assert_eq!(not_ready(&run), "realtime_language_auto_unsupported");
    set(&run, &|s| s["mic"]["follow_default"] = json!(false));
    assert_eq!(not_ready(&run), "realtime_endpoint_required");
    set(&run, &|s| s["server"] = json!("bundled"));
    // Stopped, and the server needs its model files first.
    assert_eq!(not_ready(&run), "realtime_asr_model_missing");
    set(&run, &|s| {
        s["server"] = json!("bundled");
        s["start_server"] = json!(false);
    });
    assert_eq!(not_ready(&run), "speech_server_autostart_off");
    run.capture.set_default(Source::Mic, None);
    set(&run, &|_| {});
    assert_eq!(not_ready(&run), "realtime_default_endpoint_missing");
    assert!(run.capture.opened().is_empty(), "no device was opened for a switch that was not ready");

    // A model that detects languages takes "auto".
    *run.asr.behaviour.models.lock().unwrap() = json!({ "data": [recognition_model("qwen3-asr", &["ja", "en"], true, &["prompt"])] });
    run.capture.set_default(Source::Mic, Some("alsa.mic"));
    set(&run, &|s| {
        s["model"] = json!("qwen3-asr");
        s["mic"]["language"] = json!("auto");
    });
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    run.ui.stop();
}

#[test]
fn a_session_the_server_refuses_ends_and_the_switch_says_so() {
    let run = start(Platform::Linux, json!({}), true);
    run.asr.behaviour.realtime_refuse.store(503, Ordering::SeqCst);
    let mark = run.ui.send("/set/enable/transcription_receive", None);
    let failed = run.ui.wait_from(mark, "the failure", |l| l["endpoint"] == "/set/enable/transcription_receive" && l["status"] == 400);
    assert_eq!(error_code(&failed), "TRANSCRIPTION_RECEIVE_NOT_READY");
    assert_eq!(failed["result"]["details"]["reason"], "realtime_session_failed");
    eventually("the state shows the failure", || {
        let state = run.ui.ok("/get/data/realtime_asr_state", None);
        state["speaker"]["error_code"] == "realtime_session_failed" && state["speaker"]["requested"] == false
    });
    assert_eq!(run.capture.running(Source::Speaker), 0);
    run.ui.stop();
}

#[test]
fn a_microphone_that_stops_delivering_ends_its_session_and_the_switch_says_so() {
    // `capture_windows.py`: no audio 2 s after the last, or 5 s after the open, is a stopped
    // microphone; the user is told instead of seeing no captions.
    let run = start(Platform::Linux, json!({}), true);
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the capture opened", || run.capture.running(Source::Mic) == 1);
    // Audio has reached the server: what follows is the 2 s rule, not the 5 s one of a
    // microphone that never delivered (a busy test run may open it late).
    eventually("audio reached the server", || run.asr.appends.load(Ordering::SeqCst) > 0);
    let mark = run.ui.lines().len();
    run.capture.stall(Source::Mic, true);
    let stopped = std::time::Instant::now();
    let failed = run.ui.wait_from(mark, "the failure", |l| l["endpoint"] == "/set/enable/transcription_send" && l["status"] == 400);
    assert_eq!((error_code(&failed), failed["result"]["details"]["reason"].clone()), ("TRANSCRIPTION_SEND_NOT_READY", json!("realtime_capture_failed")));
    let waited = stopped.elapsed();
    assert!(waited >= Duration::from_millis(1900) && waited < Duration::from_secs(5), "{waited:?}");
    eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);

    // One that never delivers is given 5 s from the open.
    let mark = run.ui.lines().len();
    let opened = std::time::Instant::now();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let failed = run.ui.wait_from(mark, "the failure", |l| l["endpoint"] == "/set/enable/transcription_send" && l["status"] == 400);
    assert_eq!(failed["result"]["details"]["reason"], "realtime_capture_failed");
    assert!(opened.elapsed() >= Duration::from_millis(4900), "{:?}", opened.elapsed());

    // The speaker's loopback delivers nothing while nothing plays: that is not a failure.
    run.capture.stall(Source::Speaker, true);
    assert_eq!(run.ui.ok("/set/enable/transcription_receive", None), true);
    std::thread::sleep(Duration::from_secs(3));
    assert_eq!(run.ui.ok("/get/data/realtime_asr_state", None)["speaker"]["requested"], true);
    run.ui.stop();
}

#[test]
fn both_switches_turned_on_together_share_one_bundled_server_start() {
    // #427: both switches read the server's generation before taking the start lock; the
    // second one's start was then stale and it failed with speech_server_start_failed.
    let models = tempfile::tempdir().unwrap();
    let gguf = |name: &str| {
        let path = models.path().join(format!("{name}.gguf"));
        std::fs::write(&path, b"GGUF\0\0\0\0\0\0\0\0").unwrap();
        path.canonicalize().unwrap().to_str().unwrap().to_owned()
    };
    let row = |model: String, vad: String| json!({ "model": model, "vad_model": vad, "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false });
    let empty = || row(String::new(), String::new());
    let speech_settings = json!({ "version": 1, "profiles": { "japanese": empty(), "multilingual": empty(), "asr": row(gguf("asr_gate"), gguf("vad")) } });
    let asr = FakeAsr::start();
    let mut realtime = settings(&asr);
    realtime["server"] = json!("bundled");
    let capture = FakeCapture::new();
    capture.add_endpoint(Source::Mic, "alsa.mic", "USB Mic");
    capture.add_endpoint(Source::Speaker, "alsa.out", "Speakers");
    capture.set_default(Source::Mic, Some("alsa.mic"));
    capture.set_default(Source::Speaker, Some("alsa.out"));
    let fake = env!("CARGO_BIN_EXE_fake-speech-core");
    let services = Services {
        transcription_capture: capture.factory(),
        speech_server_launch: std::sync::Arc::new(move |_| {
            let mut launch = vrct_speech_server::server::Launch::fixed(fake);
            launch.start_timeout = Duration::from_secs(10);
            launch
        }),
        ..Setup::default().services
    };
    let saved = json!({ "OSC_IP_ADDRESS": "127.0.0.2", "REALTIME_ASR_SETTINGS": realtime, "SPEECH_SERVER_SETTINGS": speech_settings });
    let ui = Ui::with(Setup { saved: Some(saved), services, platform: Platform::Linux, ..Setup::default() });
    ui.ready();

    let mark = ui.send("/set/enable/transcription_send", None);
    ui.send("/set/enable/transcription_receive", None);
    eventually("the server prepares", || ui.ok("/get/data/speech_server_state", None)["asr"]["state"] == "preparing");
    std::fs::write(models.path().join("asr_gate.gguf.go"), b"").unwrap();
    // The stand-in does not speak the Realtime API, so the sessions themselves may fail; what
    // matters is that neither switch failed to start the server.
    for endpoint in ["/set/enable/transcription_send", "/set/enable/transcription_receive"] {
        let answer = ui.wait_from(mark, endpoint, |l| l["endpoint"] == endpoint);
        let reason = answer["result"]["details"]["reason"].as_str().unwrap_or_default().to_string();
        assert!(!reason.starts_with("speech_server_"), "{endpoint}: {answer}");
    }
    ui.stop();
}

#[test]
fn shutdown_closes_running_sessions() {
    let run = start(Platform::Linux, json!({}), true);
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    assert_eq!(run.ui.ok("/set/enable/transcription_receive", None), true);
    eventually("both captures run", || run.capture.running(Source::Mic) == 1 && run.capture.running(Source::Speaker) == 1);
    run.ui.ok("/run/shutdown", None);
    eventually("every capture stopped", || run.capture.running(Source::Mic) + run.capture.running(Source::Speaker) == 0);
    let state = run.ui.ok("/get/data/realtime_asr_state", None);
    assert_eq!((state["mic"]["requested"].clone(), state["speaker"]["requested"].clone()), (json!(false), json!(false)));
    run.ui.stop();
}
