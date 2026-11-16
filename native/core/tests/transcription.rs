//! Speech recognition through the recorder (#278): the microphone and speaker switches with the
//! cloud engines, the volume meters, recognition errors, a lost device, mic mute
//! sync, the engines' keys and the start-up check, and shutdown.
//!
//! The behaviours are those of `src-python/test/test_controller_transcription_*.py`,
//! `test_model_audio_session*.py`, `test_transcription_providers.py`,
//! `test_credential_commits.py` (recognition) and the transcription parts of
//! `test_endpoints.py`. Devices are `common::fake_capture` (PCM paced like a device at 48 and
//! 44.1 kHz) and `common::fake_audio`; the engines are `common::fake_asr` on 127.0.0.1.

mod common;

use common::fake_asr::{FakeAsr, KEY};
use common::fake_audio::{FakeAudio, windows};
use common::fake_capture::{FakeCapture, quiet, speech};
use common::net::eventually;
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::net::UdpSocket;
use std::sync::atomic::Ordering;
use std::time::Duration;
use vrct_adapters::osc::{OscArg, PARAMETER_MUTE_SELF, decode_packet};
use vrct_audio_routing::manager::Topology;
use vrct_core::config::Platform;
use vrct_core::controller::Services;
use vrct_transcription::capture::Source;

const VRCHAT: &str = "127.0.0.1";

struct Run {
    ui: Ui,
    capture: FakeCapture,
    asr: FakeAsr,
    audio: FakeAudio,
    chatbox: UdpSocket,
    osc: common::fake_osc::Opened,
}

fn devices() -> vrct_audio_routing::snapshot::RawLists {
    windows(&[("Mic A", "{a}"), ("Mic B", "{b}")], Some("{a}"), &[("Speakers", "{s}"), ("Headphones", "{h}")], Some("{s}"))
}

fn start(saved: Value) -> Run {
    start_with(saved, devices())
}

fn start_with(saved: Value, lists: vrct_audio_routing::snapshot::RawLists) -> Run {
    let asr = FakeAsr::start();
    let capture = FakeCapture::new();
    let audio = FakeAudio::with(lists);
    let chatbox = UdpSocket::bind((VRCHAT, 0)).unwrap();
    let mut saved = saved;
    saved["OSC_IP_ADDRESS"] = json!(VRCHAT);
    saved["OSC_PORT"] = json!(chatbox.local_addr().unwrap().port());
    let (osc, opened) = common::fake_osc::factory(false);
    let services = Services {
        osc,
        audio: audio.platform(),
        transcription_capture: capture.factory(),
        transcription_endpoints: vrct_transcription::providers::Endpoints::all_at(&asr.base()),
        ..Setup::default().services
    };
    let ui = Ui::with(Setup { saved: Some(saved), services, platform: Platform::Windows, ..Setup::default() });
    ui.ready();
    Run { ui, capture, asr, audio, chatbox, osc: opened }
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

    fn process_log(&self) -> String {
        std::fs::read_to_string(self.ui.dir.join("logs").join("process.log")).unwrap_or_default()
    }

    /// The UI line on `endpoint` after `mark`, waiting for it.
    fn heard(&self, mark: usize, endpoint: &str) -> Value {
        self.ui.wait_endpoint(mark, endpoint)
    }
}

/// A cloud engine the fake serves: OpenAI's Whisper API with a key it accepts.
fn cloud() -> Value {
    json!({
        "SELECTED_TRANSCRIPTION_ENGINE": "OpenAI_Whisper",
        "TRANSCRIPTION_AUTH_KEYS": { "Groq_Whisper": null, "OpenAI_Whisper": KEY, "Custom_Whisper": null, "Deepgram": null },
    })
}

/// [`cloud`] with more saved settings.
fn cloud_and(extra: Value) -> Value {
    let mut saved = cloud();
    for (key, value) in extra.as_object().unwrap() {
        saved[key] = value.clone();
    }
    saved
}

#[test]
fn a_switch_needs_an_engine_and_a_device() {
    let run = start(json!({ "SELECTED_TRANSCRIPTION_ENGINE": null }));
    let answer = run.ui.request("/set/enable/transcription_send", None);
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "TRANSCRIPTION_ENGINE_NOT_SELECTED"));
    assert_eq!(answer["result"]["data"], false);
    run.ui.stop();

    // No device to open: the switch is turned off again and the UI hears why.
    let run = start_with(cloud(), vrct_audio_routing::snapshot::RawLists::none());
    let mark = run.ui.send("/set/enable/transcription_receive", None);
    assert_eq!(run.ui.wait_endpoint(mark, "/set/enable/transcription_receive")["result"], false);
    assert_eq!(run.ui.on(mark, "/set/disable/transcription_receive")[0]["result"], false);
    assert_eq!(error_code(&run.heard(mark, "/run/error_device")), "DEVICE_NO_SPEAKER");
    assert_eq!(run.capture.opened(), vec![]);
    run.ui.stop();
}

#[test]
fn a_recognised_utterance_reaches_the_ui_the_chatbox_and_the_log_but_not_the_diagnostics() {
    let run = start(cloud_and(json!({ "LOGGER_FEATURE": true })));
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    assert_eq!(run.capture.opened(), vec![(Source::Mic, "{a}".to_string())], "the chosen microphone, by its endpoint");
    let mark = run.ui.lines().len();
    run.capture.hear(Source::Mic, &[quiet(200), speech(900), quiet(1200)]);
    let message = run.heard(mark, "/run/transcription_send_mic_message");
    assert_eq!(message["result"]["original"]["message"], "こんにちは");
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("こんにちは"));
    // The request named the model the start-up check chose and the language of the own slot.
    let fields = run.asr.fields.lock().unwrap().clone();
    assert!(fields.iter().any(|f| f == "model=distil-whisper&language=ja&response_format=verbose_json"), "{fields:?}");
    assert!(run.asr.requested("POST /openai/v1/audio/transcriptions") >= 1);

    // The latency line is written without the text, once the message has gone everywhere.
    eventually("the latency line", || run.process_log().contains("[latency][mic] asr="));

    // Off: the capture stops and nothing more is delivered.
    assert_eq!(run.ui.ok("/set/disable/transcription_send", None), false);
    eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);
    assert_eq!(run.ui.ok("/get/data/mic_word_filter", None), json!([]));
    let log = run.process_log();
    assert!(!log.contains("こんにちは"), "recognised text reached process.log");
    run.ui.stop();
}

#[test]
fn the_speaker_is_heard_through_a_whisper_api_at_44_1_khz() {
    let run = start(json!({
        "SELECTED_TRANSCRIPTION_ENGINE": "Groq_Whisper",
        "TRANSCRIPTION_AUTH_KEYS": { "Groq_Whisper": KEY, "OpenAI_Whisper": null, "Custom_Whisper": null, "Deepgram": null },
    }));
    // The start-up check listed the transcription models of the key and chose one.
    assert_eq!(run.ui.ok("/get/data/selectable_groq_whisper_model_list", None), json!(["distil-whisper", "whisper-large-v3"]));
    run.capture.set_format(Source::Speaker, 44100, 2);
    assert_eq!(run.ui.ok("/set/enable/transcription_receive", None), true);
    let mark = run.ui.lines().len();
    run.capture.hear(Source::Speaker, &[speech(1000), quiet(1500)]);
    let message = run.heard(mark, "/run/transcription_receive_speaker_message");
    // The noise segment below the thresholds was left out.
    assert_eq!(message["result"]["original"]["message"], "こんにちは");
    let fields = run.asr.fields.lock().unwrap().clone();
    // One target language (the default English): the request names it.
    assert!(fields.iter().any(|f| f == "model=distil-whisper&language=en&response_format=verbose_json"), "{fields:?}");
    assert!(run.chatbox_text(Duration::from_millis(500)).is_none(), "received messages stay off the chatbox by default");
    run.ui.stop();
}

#[test]
fn the_volume_meter_reports_levels_and_needs_a_device() {
    let run = start(cloud());
    run.capture.hear(Source::Mic, &[speech(300)]);
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/check_mic_threshold", None), true);
    eventually("a loud level", || run.ui.on(mark, "/run/check_mic_volume").iter().any(|l| l["result"].as_u64() == Some(3000)));
    assert_eq!(run.ui.ok("/set/disable/check_mic_threshold", None), false);
    eventually("the meter's capture stopped", || run.capture.running(Source::Mic) == 0);
    // The meter and recognition share one capture of the device.
    assert_eq!(run.ui.ok("/set/enable/check_speaker_threshold", None), true);
    assert_eq!(run.ui.ok("/set/enable/transcription_receive", None), true);
    assert_eq!(run.capture.running(Source::Speaker), 1);
    run.ui.ok("/set/disable/transcription_receive", None);
    assert_eq!(run.capture.running(Source::Speaker), 1, "the meter keeps listening");
    run.ui.stop();

    let run = start_with(cloud(), vrct_audio_routing::snapshot::RawLists::none());
    let mark = run.ui.send("/set/enable/check_mic_threshold", None);
    assert_eq!(run.ui.wait_endpoint(mark, "/set/enable/check_mic_threshold")["result"], false);
    assert_eq!(error_code(&run.heard(mark, "/run/error_device")), "DEVICE_NO_MIC");
    run.ui.stop();
}

#[test]
fn changing_the_engine_stops_the_recorder_that_used_the_old_one() {
    // #394: the recorder kept sending to the engine it started with.
    let run = start(json!({
        "SELECTED_TRANSCRIPTION_ENGINE": "Groq_Whisper",
        "TRANSCRIPTION_AUTH_KEYS": { "Groq_Whisper": KEY, "OpenAI_Whisper": KEY, "Custom_Whisper": null, "Deepgram": null },
    }));
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/data/selected_transcription_engine", Some(json!("OpenAI_Whisper"))), "OpenAI_Whisper");
    assert_eq!(run.heard(mark, "/set/disable/transcription_send")["result"], false);
    eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);
    // The speaker was off: it stays off and says nothing.
    assert!(run.ui.on(mark, "/set/disable/transcription_receive").is_empty());

    // On again: the newly selected engine hears it.
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let mark = run.ui.lines().len();
    run.capture.hear(Source::Mic, &[speech(900), quiet(1200)]);
    run.heard(mark, "/run/transcription_send_mic_message");
    assert!(run.asr.requested("POST /openai/") >= 1);
    assert_eq!(run.asr.requested("POST /groq/"), 0, "nothing went to the engine no longer selected");

    // Choosing the same engine again leaves recognition running.
    let mark = run.ui.lines().len();
    run.ui.ok("/set/data/selected_transcription_engine", Some(json!("OpenAI_Whisper")));
    assert_eq!(run.capture.running(Source::Mic), 1);
    assert!(run.ui.on(mark, "/set/disable/transcription_send").is_empty());
    run.ui.stop();
}

#[test]
fn a_failing_engine_turns_recognition_off_with_its_code() {
    let run = start(cloud_and(json!({ "ENABLE_CHECK_ENERGY_SEND": false })));
    run.asr.behaviour.fail.store(true, Ordering::SeqCst);
    assert_eq!(run.ui.ok("/set/enable/check_mic_threshold", None), true);
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let mark = run.ui.lines().len();
    run.capture.hear(Source::Mic, &[speech(800), quiet(1200)]);
    let error = run.heard(mark, "/run/transcription_recognition_error")["result"].clone();
    assert_eq!(
        error,
        json!({
            "text": "", "language": null, "recognition_error": true, "error_code": "ASR_ERROR", "stage": "asr",
            "source": "mic", "message": "Speech recognition failed", "recoverable": false,
            // The engine answered 500: the UI says why, the code stays Python's.
            "cause": "TRANSCRIPTION_API_SERVER_ERROR",
        })
    );
    // Both switches went off first, the meter at zero.
    assert_eq!(run.ui.on(mark, "/set/disable/transcription_send")[0]["result"], false);
    assert_eq!(run.ui.on(mark, "/set/disable/check_mic_threshold")[0]["result"], false);
    assert_eq!(run.ui.on(mark, "/run/check_mic_volume").last().unwrap()["result"], 0);
    eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);
    assert!(run.ui.on(mark, "/run/transcription_send_mic_message").is_empty());
    run.ui.stop();
}

#[test]
fn an_unusable_engine_is_refused_before_the_device_opens() {
    // A custom server whose address is not usable.
    let run = start(json!({ "SELECTED_TRANSCRIPTION_ENGINE": "Custom_Whisper", "TRANSCRIPTION_CUSTOM_URL": "" }));
    let mark = run.ui.send("/set/enable/transcription_send", None);
    let answer = run.ui.wait_from(mark, "the answer", |l| l["endpoint"] == "/set/enable/transcription_send" && l["status"] == 200);
    assert_eq!(answer["result"], false);
    let notice = run.ui.wait_from(mark, "the engine error", |l| l["endpoint"] == "/set/enable/transcription_send" && l["status"] == 400);
    assert_eq!((error_code(&notice), notice["result"]["data"].clone()), ("TRANSCRIPTION_ENGINE_UNAVAILABLE", json!(false)));
    assert!(run.capture.opened().is_empty());
    run.ui.stop();
}

#[test]
fn a_lost_device_moves_the_capture_to_another_or_stops_it() {
    let run = start(cloud());
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let mark = run.ui.lines().len();
    // Mic A is unplugged: its read fails and the list no longer has it.
    run.audio.set(windows(&[("Mic B", "{b}")], Some("{b}"), &[("Speakers", "{s}")], Some("{s}")));
    run.capture.break_device(Source::Mic);
    run.audio.event(Topology::DeviceChanged);
    let switched = run.heard(mark, "/run/audio_device_switched")["result"].clone();
    assert_eq!((switched["old_device"]["name"].clone(), switched["new_device"]["name"].clone()), (json!("Mic A"), json!("Mic B")));
    eventually("the capture moved", || run.capture.opened().last() == Some(&(Source::Mic, "{b}".to_string())));
    assert_eq!(run.ui.ok("/get/data/selected_mic_device", None), "Mic B");

    // The last microphone goes: recognition stops and says why.
    let mark = run.ui.lines().len();
    run.audio.set(windows(&[], None, &[("Speakers", "{s}")], Some("{s}")));
    run.audio.event(Topology::DeviceChanged);
    eventually("the switch went off", || !run.ui.on(mark, "/set/disable/transcription_send").is_empty());
    eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);
    run.ui.stop();
}

#[test]
fn a_read_error_on_a_device_that_is_still_there_stops_recognition() {
    let run = start(cloud());
    assert_eq!(run.ui.ok("/set/enable/transcription_receive", None), true);
    let mark = run.ui.lines().len();
    run.capture.break_device(Source::Speaker);
    let error = run.heard(mark, "/run/transcription_recognition_error")["result"].clone();
    assert_eq!((error["error_code"].clone(), error["stage"].clone(), error["source"].clone()), (json!("AUDIO_READ_ERROR"), json!("recording"), json!("speaker")));
    assert_eq!(run.ui.on(mark, "/set/disable/transcription_receive")[0]["result"], false);
    run.ui.stop();
}

#[test]
fn a_device_that_does_not_open_falls_back_to_another() {
    let run = start(cloud());
    run.capture.refuse("{a}");
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    assert_eq!(run.capture.opened(), vec![(Source::Mic, "{b}".to_string())]);
    let switched = run.heard(mark, "/run/audio_device_switched")["result"].clone();
    assert_eq!(switched["new_device"]["name"], "Mic B");
    run.ui.stop();

    let run = start(cloud());
    run.capture.refuse("{s}");
    run.capture.refuse("{h}");
    let mark = run.ui.send("/set/enable/transcription_receive", None);
    assert_eq!(run.ui.wait_endpoint(mark, "/set/enable/transcription_receive")["result"], false);
    assert_eq!(run.heard(mark, "/run/transcription_recognition_error")["result"]["error_code"], "AUDIO_OPEN_ERROR");
    run.ui.stop();
}

#[test]
fn mute_sync_holds_the_microphone_back_and_losing_it_stops_recognition() {
    let run = start(cloud());
    // Mute sync needs OSCQuery, which starts in the background: wait until it says it runs.
    assert_eq!(run.ui.wait_endpoint(0, "/run/enable_osc_query")["result"]["data"], true);
    assert_eq!(run.ui.ok("/set/enable/vrc_mic_mute_sync", None), true);
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let osc = run.osc.last();
    // Muted in VRChat: nothing heard while it lasts.
    osc.vrchat_sends(PARAMETER_MUTE_SELF, vec![OscArg::Bool(true)]);
    let mark = run.ui.lines().len();
    run.capture.hear(Source::Mic, &[speech(800), quiet(1500)]);
    std::thread::sleep(Duration::from_millis(2600));
    assert!(run.ui.on(mark, "/run/transcription_send_mic_message").is_empty(), "held back while muted");
    assert_eq!(run.asr.requested("POST /openai"), 0, "nothing was even sent to the engine");
    // Unmuted (confirmed by OSCQuery): heard again.
    *osc.mute.lock().unwrap() = Some(false);
    osc.vrchat_sends(PARAMETER_MUTE_SELF, vec![OscArg::Bool(false)]);
    std::thread::sleep(Duration::from_millis(300));
    let mark = run.ui.lines().len();
    run.capture.hear(Source::Mic, &[speech(800), quiet(1500)]);
    run.heard(mark, "/run/transcription_send_mic_message");

    // Mute sync is lost (OSC turned to a remote destination): the microphone stops.
    let mark = run.ui.lines().len();
    run.ui.ok("/set/data/osc_ip_address", Some(json!("127.0.0.3")));
    eventually("the recognition stopped", || run.capture.running(Source::Mic) == 0);
    assert_eq!(run.ui.on(mark, "/set/disable/transcription_send")[0]["result"], false);
    run.ui.stop();
}

#[test]
fn keys_are_checked_with_their_service_and_a_refusal_keeps_the_saved_one() {
    let run = start(json!({}));
    let refused = |endpoint: &str, data: Value| {
        let answer = run.ui.request(endpoint, Some(data));
        assert_eq!(answer["status"], 400, "{endpoint}: {answer}");
        (error_code(&answer).to_string(), answer["result"]["data"].clone())
    };
    assert_eq!(refused("/set/data/groq_whisper_auth_key", json!("wrong")), ("TRANSCRIPTION_API_AUTH_FAILED".into(), Value::Null));
    assert_eq!(refused("/set/data/groq_whisper_auth_key", json!("  ")), ("TRANSCRIPTION_API_AUTH_FAILED".into(), Value::Null));

    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/data/groq_whisper_auth_key", Some(json!(format!(" {KEY} ")))), KEY);
    // Only transcription models, sorted, without the diarization one.
    assert_eq!(run.ui.on(mark, "/run/selectable_groq_whisper_model_list")[0]["result"], json!(["distil-whisper", "whisper-large-v3"]));
    assert_eq!(run.ui.on(mark, "/run/selected_groq_whisper_model")[0]["result"], "distil-whisper");
    assert!(run.ui.ok("/get/data/selectable_transcription_engines", None).as_array().unwrap().contains(&json!("Groq_Whisper")));
    // A wrong key now is refused with the saved one to roll back to.
    assert_eq!(refused("/set/data/groq_whisper_auth_key", json!("wrong")), ("TRANSCRIPTION_API_AUTH_FAILED".into(), json!(KEY)));
    assert_eq!(run.ui.ok("/set/data/openai_whisper_auth_key", Some(json!(KEY))), KEY);

    // Deepgram lists its batch models with their languages.
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/data/deepgram_auth_key", Some(json!(KEY))), KEY);
    assert_eq!(run.ui.on(mark, "/run/selectable_deepgram_model_list")[0]["result"], json!(["nova-2", "nova-3"]));
    assert_eq!(refused("/set/data/deepgram_auth_key", json!("wrong")), ("TRANSCRIPTION_API_AUTH_FAILED".into(), json!(KEY)));

    // The custom server: the URL first, then a key for it; or both at once.
    let custom = format!("{}/custom/v1", run.asr.base());
    assert_eq!(refused("/set/data/custom_whisper_auth_key", json!(KEY)), ("TRANSCRIPTION_API_AUTH_FAILED".into(), Value::Null));
    assert_eq!(run.ui.ok("/set/data/custom_whisper_url", Some(json!(custom))), json!(custom));
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/data/custom_whisper_auth_key", Some(json!(KEY))), KEY);
    assert_eq!(run.ui.on(mark, "/run/selectable_custom_whisper_model_list")[0]["result"].as_array().unwrap().len(), 4, "not filtered");
    assert_eq!(
        refused("/set/data/custom_whisper_auth_key_and_url", json!({ "url": "ftp://x", "auth_key": KEY })),
        ("CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID".into(), json!(custom))
    );
    assert_eq!(
        refused("/set/data/custom_whisper_auth_key_and_url", json!({ "url": custom })),
        ("TRANSCRIPTION_API_AUTH_FAILED".into(), json!(KEY))
    );
    assert_eq!(
        refused("/set/data/custom_whisper_auth_key_and_url", json!({ "url": custom, "auth_key": "wrong" })),
        ("TRANSCRIPTION_API_AUTH_FAILED".into(), json!(KEY))
    );
    assert_eq!(
        run.ui.ok("/set/data/custom_whisper_auth_key_and_url", Some(json!({ "url": custom, "auth_key": KEY }))),
        json!({ "url": custom, "auth_key": KEY })
    );
    // No key: the URL changes and the key goes.
    let other = format!("{}/other/v1", run.asr.base());
    assert_eq!(
        run.ui.ok("/set/data/custom_whisper_auth_key_and_url", Some(json!({ "url": other, "auth_key": null }))),
        json!({ "url": other, "auth_key": null })
    );
    assert_eq!(run.ui.ok("/get/data/custom_whisper_auth_key", None), Value::Null);

    run.ui.ok("/run/shutdown", None);
    let file = run.ui.saved();
    assert_eq!(run.ui.kept_key("TRANSCRIPTION_AUTH_KEYS", "Groq_Whisper"), KEY);
    assert_eq!(run.ui.kept_key("TRANSCRIPTION_AUTH_KEYS", "Deepgram"), KEY);
    assert_eq!(file["TRANSCRIPTION_CUSTOM_URL"], json!(other));
    assert!(!run.process_log().contains(KEY), "a key reached the log");
    run.ui.stop();
}

#[test]
fn the_start_up_check_asks_each_service_with_its_saved_key() {
    let run = start(json!({
        "TRANSCRIPTION_AUTH_KEYS": { "Groq_Whisper": KEY, "OpenAI_Whisper": "wrong", "Custom_Whisper": KEY, "Deepgram": KEY },
        "TRANSCRIPTION_CUSTOM_URL": "http://127.0.0.1:9/v1",
        "SELECTED_DEEPGRAM_MODEL": "nova-3",
        "SELECTED_OPENAI_WHISPER_MODEL": "whisper-1",
    }));
    let mut offered: Vec<String> = serde_json::from_value(run.ui.ok("/get/data/selectable_transcription_engines", None)).unwrap();
    offered.sort();
    assert_eq!(offered, ["Deepgram", "Groq_Whisper", "SpeechCpp"]);
    assert_eq!(run.ui.ok("/get/data/selected_deepgram_model", None), "nova-3", "a listed choice stays");
    assert_eq!(run.ui.ok("/get/data/selected_openai_whisper_model", None), Value::Null, "a failed check forgets the choice");
    assert_eq!(run.ui.ok("/get/data/openai_whisper_auth_key", None), "wrong", "and keeps the key");
    assert!(run.asr.requested("GET /deepgram/v1/auth/token") >= 1);
    run.ui.stop();
}

#[test]
fn a_saved_google_engine_loads_as_none_and_google_is_not_offered() {
    // A config.json of 0.4 or earlier with the retired Google web speech engine.
    let run = start(json!({ "SELECTED_TRANSCRIPTION_ENGINE": "Google", "LOCAL_ASR_MIGRATION": 2 }));
    assert_eq!(run.ui.ok("/get/data/selected_transcription_engine", None), Value::Null, "the user chooses again");
    let offered = run.ui.ok("/get/data/selectable_transcription_engines", None);
    assert!(!offered.as_array().unwrap().contains(&json!("Google")), "{offered}");
    assert_eq!(offered, json!(["SpeechCpp"]), "no key saved: only the local engine is ready");
    // Google cannot be chosen again.
    assert_eq!(run.ui.ok("/set/data/selected_transcription_engine", Some(json!("Google"))), Value::Null);
    // A switch asks for an engine, as on a first start, and sends nothing anywhere.
    let answer = run.ui.request("/set/enable/transcription_send", None);
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "TRANSCRIPTION_ENGINE_NOT_SELECTED"));
    assert!(run.asr.requests.lock().unwrap().is_empty(), "nothing was sent");
    // Another engine can be chosen and is kept.
    assert_eq!(run.ui.ok("/set/data/selected_transcription_engine", Some(json!("SpeechCpp"))), "SpeechCpp");
    run.ui.ok("/run/shutdown", None);
    assert_eq!(run.ui.saved()["SELECTED_TRANSCRIPTION_ENGINE"], "SpeechCpp");
    run.ui.stop();

    // Left as it loaded, the file no longer names Google.
    let run = start(json!({ "SELECTED_TRANSCRIPTION_ENGINE": "Google", "LOCAL_ASR_MIGRATION": 2 }));
    run.ui.ok("/run/shutdown", None);
    assert_eq!(run.ui.saved()["SELECTED_TRANSCRIPTION_ENGINE"], Value::Null);
    run.ui.stop();
}

#[test]
fn shutdown_stops_every_capture() {
    let run = start(cloud());
    run.ui.ok("/set/enable/transcription_send", None);
    run.ui.ok("/set/enable/check_speaker_threshold", None);
    assert_eq!((run.capture.running(Source::Mic), run.capture.running(Source::Speaker)), (1, 1));
    run.ui.ok("/run/shutdown", None);
    eventually("every capture stopped", || run.capture.running(Source::Mic) + run.capture.running(Source::Speaker) == 0);
    run.ui.stop();
}
