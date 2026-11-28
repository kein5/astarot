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

use common::fake_asr::{FakeAsr, RealtimeFault, recognition_model};
use common::fake_capture::{FakeCapture, speech};
use common::net::eventually;
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::net::UdpSocket;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use astarot_adapters::osc::{OscArg, decode_packet};
use astarot_core::config::Platform;
use astarot_core::controller::{RealtimeLimits, Services};
use astarot_core::vr_overlay::runtime::fake::FakeVr;
use astarot_translation::fake::FakeProviders;
use astarot_transcription::capture::Source;

const TRANSLATE: &str = "/deepl-free/v2/translate";

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
    start_with(platform, saved, configure, vr, None, RealtimeLimits::default())
}

/// Linux, where the main switch runs realtime recognition, with translation on through DeepL on
/// `providers`.
fn start_translating(providers: &FakeProviders) -> Run {
    let key = format!("{}:fx", "d".repeat(36));
    providers.key("/deepl-free", &key);
    let run =
        start_with(Platform::Linux, json!({ "AUTH_KEYS": { "DeepL_API": key } }), true, None, Some(providers), RealtimeLimits::default());
    let mut engines = run.ui.ok("/get/data/selected_translation_engines", None);
    engines["1"] = json!("DeepL_API");
    run.ui.ok("/set/data/selected_translation_engines", Some(engines));
    assert_eq!(run.ui.ok("/set/enable/translation", None), true);
    run
}

fn start_with(
    platform: Platform,
    saved: Value,
    configure: bool,
    vr: Option<FakeVr>,
    providers: Option<&FakeProviders>,
    limits: RealtimeLimits,
) -> Run {
    start_changed(platform, saved, configure, vr, providers, limits, |_| {})
}

/// [`start_with`], with `change` made to the services.
fn start_changed(
    platform: Platform,
    saved: Value,
    configure: bool,
    vr: Option<FakeVr>,
    providers: Option<&FakeProviders>,
    limits: RealtimeLimits,
    change: impl FnOnce(&mut Services),
) -> Run {
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
    let mut services = Services { transcription_capture: capture.factory(), realtime_limits: limits, ..Setup::default().services };
    if let Some(vr) = vr {
        common::warm_system_fonts();
        services.vr = Arc::new(vr);
    }
    if let Some(providers) = providers {
        services.translation_endpoints = astarot_translation::providers::Endpoints::all_at(&providers.url());
    }
    change(&mut services);
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

    /// Waits for the row in `state` of the caption `item`.
    fn caption_of(&self, from: usize, item: &str, state: &str) -> Value {
        self.ui.wait_from(from, state, |l| {
            l["endpoint"] == "/run/realtime_caption" && l["result"]["state"] == state && l["result"]["item_id"] == item
        })["result"]
            .clone()
    }

    /// Reads the chatbox until a text that contains `part` arrives.
    fn chatbox_until(&self, part: &str) -> Option<String> {
        loop {
            let text = self.chatbox_text(Duration::from_secs(5))?;
            if text.contains(part) {
                return Some(text);
            }
        }
    }

    fn process_log(&self) -> String {
        std::fs::read_to_string(self.ui.dir.join("logs").join("process.log")).unwrap_or_default()
    }
}

#[test]
fn settings_are_normalized_saved_and_refused_with_a_code() {
    let run = start(Platform::Windows, json!({}), false);
    let defaults = run.ui.ok("/get/data/realtime_asr_settings", None);
    // The run saves the chatbox's address and no recognition server: a saved file that never chose
    // one keeps the external server (#1266; a new install takes the bundled one, config_versions.rs).
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
    // Decision 24 (`_beginIoTrace`): the flow panel times the final from when it arrived, with
    // its wait before the message pipeline took it.
    let trace = run.ui.wait_from(mark, "the flow panel's trace", |l| l["endpoint"] == "/run/io_trace" && l["result"]["input"] == "voice")["result"].clone();
    assert_eq!(trace["origin"], "final", "{trace}");
    let wait = trace["stages"]["wait"].as_f64().expect("a wait stage");
    assert!((0.0..5000.0).contains(&wait), "{wait}");
    assert!(trace["stages"].get("recognition").is_none(), "{trace}");
    // The session asked for its model and sent the vocabulary as keywords; audio was 24 kHz.
    assert!(run.asr.requested("GET /v1/realtime?model=haas-ja") >= 1);
    // The switch listed the models once; the session took that list (decision 81).
    assert_eq!(run.asr.requested("GET /v1/models"), 1);
    assert!(run.asr.appends.load(Ordering::SeqCst) >= 25);

    let state = run.ui.ok("/get/data/realtime_asr_state", None);
    assert_eq!((state["mic"]["state"].clone(), state["mic"]["requested"].clone()), (json!("ready"), json!(true)));
    assert_eq!(state["speaker"]["state"], "idle");
    // The device the captions record, by the name the device list shows it with (#1314, M-6).
    assert_eq!((state["mic"]["device"].clone(), state["speaker"]["device"].clone()), (json!("USB Mic"), Value::Null));

    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/disable/transcription_send", None), false);
    eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);
    let state = run.ui.ok("/get/data/realtime_asr_state", None);
    assert_eq!(state["mic"]["requested"], false);
    assert!(run.ui.on(mark, "/set/enable/transcription_send").is_empty(), "no failure was told");
    assert!(!run.process_log().contains("こんにちは"), "recognised text reached process.log");
    assert!(!run.process_log().contains("realtime_caption"), "captions are not logged");
    // Decision 15 (`utterance_diagnostics`): the finals' waits are summed up when the session
    // stops, without the text or the item's id.
    eventually("the summary", || run.process_log().contains("[utterance-summary][mic] reason=stop"));
    let log = run.process_log();
    let summary = log.lines().find(|line| line.contains("[utterance-summary][mic] reason=stop")).unwrap();
    for part in ["realtime_final=", "realtime_delivery=", "realtime_processed=", "message=", "realtime_pending_ms(n=", "realtime_queue_ms(n=", "realtime_total_ms(n=", "realtime_translate_ms(n="] {
        assert!(summary.contains(part), "{part} in {summary}");
    }
    // Realtime recognition's own time is not known, so a final has no total of the message.
    assert!(!summary.contains(" total_ms(n="), "{summary}");
    run.ui.stop();
}

#[test]
fn a_final_that_reached_the_chatbox_is_delivered_though_it_expires_after() {
    // Decision 15 (`output_progress`): once the chatbox has it, a final is delivered, even when
    // its 2 seconds run out while the outputs after the chatbox (here the clipboard) still run.
    let run = start_changed(Platform::Linux, json!({ "ENABLE_CLIPBOARD": true }), true, None, None, RealtimeLimits::default(), |services| {
        services.clipboard = Arc::new(|_: &str| {
            std::thread::sleep(Duration::from_millis(2300));
            true
        });
    });
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the capture opened", || run.capture.running(Source::Mic) == 1);
    run.capture.hear(Source::Mic, &[speech(2000)]);
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("こんにちは"));
    let outcome = run.caption(mark, "outcome");
    assert_eq!((outcome["outcome"].clone(), outcome["reason"].clone()), (json!("delivered"), Value::Null), "{outcome}");
    run.ui.stop();
}

#[test]
fn captions_are_drawn_on_the_large_vr_log_and_one_it_cannot_show_is_told() {
    // `test_realtime_overlay*.py` and the realtime cases of [`test_overlay_lifecycle_publication.py`]
    // through the core: each caption state draws the large log; a picture SteamVR refuses is
    // told as the caption's `overlay_large` output failure, and the final still goes out.
    //
    // [`test_overlay_lifecycle_publication.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_overlay_lifecycle_publication.py
    let fake = FakeVr::running();
    let run = start_with_vr(Platform::Linux, json!({ "OVERLAY_LARGE_LOG": true }), true, Some(fake.clone()));
    // Built, not only made: the large log's first, empty picture is not a caption's (#861).
    eventually("the overlays built", || fake.built());
    let large = fake.handle("ASTAROT1").unwrap();
    let drawn = || fake.calls_on(large, "raw");
    let before = drawn().len();
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the capture opened", || run.capture.running(Source::Mic) == 1);
    run.capture.hear(Source::Mic, &[speech(600)]);
    for state in ["partial", "final", "translated"] {
        run.caption(mark, state);
    }
    // Each caption row was queued for the large log before it reached the UI (#861); the server
    // goes on speaking, so later captions may still wait.
    let core = run.ui.backend.core().clone();
    let queued = core.overlay_captions_queued();
    eventually("the captions drawn", || core.overlay_captions_drawn(queued));
    assert!(drawn().len() >= before + 3, "each state drew the log");
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

/// Holds the translations of `text` until the returned sender sends; drop it then, so that
/// later ones go through at once. Other texts are translated at once.
fn hold(providers: &FakeProviders, text: &'static str) -> Sender<()> {
    let (release, held) = channel::<()>();
    let held = Mutex::new(held);
    providers.reply(move |_, _, source| {
        if source == text {
            let _ = held.lock().unwrap().recv_timeout(Duration::from_secs(5));
        }
        None
    });
    release
}

/// Turns the microphone on, holds the next translation of a final, and waits for a final that
/// arrives while it is held: that one waits for translation. Returns its item id, the mark
/// before it, and the sender that lets the held translation finish.
fn a_final_waiting_for_translation(run: &Run, providers: &FakeProviders) -> (String, usize, Sender<()>) {
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the capture opened", || run.capture.running(Source::Mic) == 1);
    let release = hold(providers, "こんにちは");
    let before = providers.seen_under(TRANSLATE).len();
    run.capture.hear(Source::Mic, &[speech(2000)]);
    eventually("a final is being translated", || providers.seen_under(TRANSLATE).len() > before);
    let mark = run.ui.lines().len();
    let item = run.caption(mark, "final")["item_id"].as_str().unwrap().to_string();
    (item, mark, release)
}

#[test]
fn a_final_keeps_the_languages_it_arrived_with_while_it_waits_to_be_translated() {
    // Decision 80 (`MessageSnapshot.capture` in Python's `admit`): a final takes the settings as
    // it arrives. One that waits behind another final's translation while the user picks
    // another language is still translated to the language it arrived with, and its caption
    // row says so. A final that arrives after the change takes the new language.
    let providers = FakeProviders::start();
    let run = start_translating(&providers);
    let (item, mark, release) = a_final_waiting_for_translation(&run, &providers);
    let mut targets = run.ui.ok("/get/data/selected_target_languages", None);
    targets["1"]["1"]["language"] = json!("German");
    targets["1"]["1"]["country"] = json!("Germany");
    assert_eq!(run.ui.ok("/set/data/selected_target_languages", Some(targets))["1"]["1"]["language"], "German");
    let changed = run.ui.lines().len();
    release.send(()).unwrap();
    drop(release);

    let waited = run.caption_of(mark, &item, "translated");
    assert_eq!(waited["translations"], json!([{ "message": "deepl-free:EN-US:こんにちは", "transliteration": [] }]));
    run.ui.wait_from(changed, "a later final in German", |l| {
        l["endpoint"] == "/run/realtime_caption"
            && l["result"]["state"] == "translated"
            && l["result"]["translations"][0]["message"] == "deepl-free:DE:こんにちは"
    });
    run.ui.stop();
}

#[test]
fn a_chat_typed_while_a_final_waits_is_not_replaced_by_that_final_in_the_chatbox() {
    // Decision 80: a final takes its place in the chatbox order as it arrives
    // (`chatbox_order.admit()` in Python's `admit`), not when its translation starts. A chat
    // typed while the final waits goes out, and the older final does not replace it.
    let providers = FakeProviders::start();
    let run = start_translating(&providers);
    let (item, mark, release) = a_final_waiting_for_translation(&run, &providers);
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "c-1", "message": "打った文" })));
    assert!(run.chatbox_until("打った文").is_some(), "the typed chat was not sent");
    release.send(()).unwrap();
    drop(release);

    let outcome = run.caption_of(mark, &item, "outcome");
    assert_eq!((outcome["outcome"].clone(), outcome["reason"].clone()), (json!("not_delivered"), json!("superseded")), "{outcome}");
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
    // #556: a shorter silence gives the result sooner; left out, it is the default of 400 ms,
    // and a chosen one is kept, the former default of 500 ms too. The padding is at most half
    // the silence, so the server gives the utterance once the silence has lasted.
    for chosen in [None, Some(300), Some(500)] {
        let run = start(Platform::Linux, json!({}), true);
        if let Some(ms) = chosen {
            let mut settings = run.ui.ok("/get/data/realtime_asr_settings", None);
            settings["silence_duration_ms"] = json!(ms);
            assert_eq!(run.ui.ok("/set/data/realtime_asr_settings", Some(settings))["silence_duration_ms"], ms);
        }
        assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
        eventually("the session is configured", || !run.asr.turn_detection.lock().unwrap().is_empty());
        let sent = run.asr.turn_detection.lock().unwrap()[0].clone();
        let (silence, padding) = match chosen {
            Some(ms) => (ms, ms / 2),
            None => (400, 200),
        };
        assert_eq!(sent, json!({ "type": "server_vad", "silence_duration_ms": silence, "prefix_padding_ms": padding }));
        // Only a chosen silence is written; the default stays out of the file.
        run.ui.ok("/run/shutdown", None);
        assert_eq!(run.ui.saved()["REALTIME_ASR_SETTINGS"].get("silence_duration_ms"), chosen.map(|ms| json!(ms)).as_ref());
        run.ui.stop();
    }
}

#[test]
fn the_chosen_speech_detection_threshold_is_sent_and_none_otherwise() {
    // #392: left out, no threshold is sent and the server's own applies; a chosen one is sent
    // and written. A change starts the sessions again, as the silence does.
    for chosen in [None, Some(0.3)] {
        let run = start(Platform::Linux, json!({}), true);
        if let Some(threshold) = chosen {
            let mut settings = run.ui.ok("/get/data/realtime_asr_settings", None);
            settings["vad_threshold"] = json!(threshold);
            assert_eq!(run.ui.ok("/set/data/realtime_asr_settings", Some(settings))["vad_threshold"], threshold);
        }
        assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
        eventually("the session is configured", || !run.asr.turn_detection.lock().unwrap().is_empty());
        let sent = run.asr.turn_detection.lock().unwrap()[0].clone();
        assert_eq!(sent.get("threshold").and_then(Value::as_f64), chosen);
        run.ui.ok("/run/shutdown", None);
        assert_eq!(run.ui.saved()["REALTIME_ASR_SETTINGS"].get("vad_threshold").and_then(Value::as_f64), chosen);
        run.ui.stop();
    }
    let run = start(Platform::Linux, json!({}), true);
    let mut settings = run.ui.ok("/get/data/realtime_asr_settings", None);
    settings["vad_threshold"] = json!(1.5);
    assert_eq!(error_code(&run.ui.request("/set/data/realtime_asr_settings", Some(settings))), "realtime_settings_invalid");
    run.ui.stop();
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
fn the_settings_page_start_answers_what_the_server_lacks_before_any_session_starts() {
    // Decision 81: the start lists the server's models before it places a session, so what
    // the session's own list request found (and failed it with after the start) is the start's
    // answer now.
    let run = start(Platform::Windows, json!({ "SELECTED_TRANSCRIPTION_ENGINE": "Groq_Whisper" }), true);
    let refused = |change: &dyn Fn(&mut Value)| {
        let mut value = settings(&run.asr);
        change(&mut value);
        run.ui.ok("/set/data/realtime_asr_settings", Some(value));
        let before = run.ui.ok("/get/data/realtime_asr_state", None)["mic"]["generation"].clone();
        let answer = run.ui.request("/run/start_realtime_asr", Some(json!({ "source": "mic" })));
        let state = run.ui.ok("/get/data/realtime_asr_state", None);
        assert_eq!((state["mic"]["generation"].clone(), state["mic"]["requested"].clone()), (before, json!(false)), "{answer}");
        (answer["status"].as_u64().unwrap_or(0), answer["result"]["error_code"].as_str().unwrap_or("").to_string())
    };
    assert_eq!(refused(&|s| s["model"] = json!("other-model")), (409, "realtime_model_unavailable".into()));
    assert_eq!(refused(&|s| s["mic"]["language"] = json!("en")), (409, "realtime_language_unsupported".into()));
    assert_eq!(refused(&|s| s["model"] = json!("")), (400, "realtime_model_invalid".into()));
    let gone = format!("http://127.0.0.1:{}", common::net::free_port());
    assert_eq!(refused(&|s| s["base_url"] = json!(gone)), (409, "realtime_models_unavailable".into()));
    assert!(run.capture.opened().is_empty(), "no device was opened");
    assert_eq!(run.asr.requested("GET /v1/realtime"), 0, "no session connected");

    // With what the server lists, the session starts on that list alone.
    run.ui.ok("/set/data/realtime_asr_settings", Some(settings(&run.asr)));
    let listed = run.asr.requested("GET /v1/models");
    assert_eq!(run.ui.ok("/run/start_realtime_asr", Some(json!({ "source": "mic" })))["mic"]["requested"], true);
    eventually("the capture opened", || run.capture.running(Source::Mic) == 1);
    assert_eq!(run.asr.requested("GET /v1/models"), listed + 1);
    run.ui.stop();
}

// #1302: changing the captions' server stops them. A stopping session is no longer reported as
// asked to run, and the core sends no word of its end: the UI polls while one is stopping, and
// this is what it waits for, the session closed.
#[test]
fn a_settings_change_that_stops_the_captions_ends_with_them_closed() {
    let run = start(Platform::Linux, json!({}), true);
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the capture opened", || run.capture.running(Source::Mic) == 1);
    let mut value = settings(&run.asr);
    value["server"] = json!("bundled");
    run.ui.ok("/set/data/realtime_asr_settings", Some(value));
    assert_eq!(run.ui.ok("/get/data/realtime_asr_state", None)["mic"]["requested"], false);
    eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);
    eventually("the session closed", || run.ui.ok("/get/data/realtime_asr_state", None)["mic"]["state"] == "closed");
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
    // The session's own end comes after the capture stops and may still tell the UI about the
    // captions it drops (#861): only what the microphone says after the session closed counts.
    eventually("the session closed", || {
        let state = run.ui.ok("/get/data/realtime_asr_state", None)["mic"]["state"].clone();
        state == "closed" || state == "idle"
    });
    let heard = run.ui.lines().len();
    run.capture.hear(Source::Mic, &[speech(2000)]);
    std::thread::sleep(Duration::from_millis(500));
    assert!(run.ui.on(heard, "/run/realtime_caption").is_empty(), "no caption after the engine changed");
    run.ui.stop();
}

// #1298: Listening turned on with "auto" on a model that cannot tell the language is refused with
// the model's languages, as Mic input is, so the switch's dialog can offer them and a model that
// tells the language (#1225, #1242). The dialog's buttons are covered in
// `RecognitionFixController.test.ts`.
#[test]
fn listening_on_auto_is_refused_with_the_models_languages() {
    let run = start(Platform::Linux, json!({}), true);
    let mut value = settings(&run.asr);
    value["speaker"]["language"] = json!("auto");
    run.ui.ok("/set/data/realtime_asr_settings", Some(value));
    let endpoint = "/set/enable/transcription_receive";
    let mark = run.ui.send(endpoint, None);
    let answer = run.ui.wait_from(mark, "the answer", |l| l["endpoint"] == endpoint);
    assert_eq!(error_code(&answer), "TRANSCRIPTION_RECEIVE_NOT_READY", "{answer}");
    assert_eq!(answer["result"]["details"], json!({ "reason": "realtime_language_auto_unsupported", "languages": ["ja"] }));
}

#[test]
fn a_switch_says_what_is_missing() {
    let run = start(Platform::Linux, json!({}), true);
    let details = |run: &Run| {
        let mark = run.ui.send("/set/enable/transcription_send", None);
        let answer = run.ui.wait_from(mark, "the answer", |l| l["endpoint"] == "/set/enable/transcription_send");
        assert_eq!(error_code(&answer), "TRANSCRIPTION_SEND_NOT_READY", "{answer}");
        assert_eq!(answer["result"]["data"], false);
        answer["result"]["details"].clone()
    };
    let not_ready = |run: &Run| {
        let details = details(run);
        // Only a language the model does not take comes with the model's languages (#1225).
        assert!(details.get("languages").is_none(), "{details}");
        details["reason"].as_str().unwrap_or_default().to_string()
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
    // A language the model does not take: the answer lists the ones it does, so the switch can
    // offer them (#1225).
    set(&run, &|s| s["mic"]["language"] = json!("en"));
    assert_eq!(details(&run), json!({ "reason": "realtime_language_unsupported", "languages": ["ja"] }));
    set(&run, &|s| s["mic"]["language"] = json!("auto"));
    assert_eq!(details(&run), json!({ "reason": "realtime_language_auto_unsupported", "languages": ["ja"] }));
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

/// Turns the microphone on and waits for the failure the switch tells; gives its reason.
fn switch_failure(run: &Run, mark: usize) -> String {
    let failed = run.ui.wait_from(mark, "the failure", |l| l["endpoint"] == "/set/enable/transcription_send" && l["status"] == 400);
    assert_eq!(error_code(&failed), "TRANSCRIPTION_SEND_NOT_READY", "{failed}");
    failed["result"]["details"]["reason"].as_str().unwrap_or_default().to_string()
}

#[test]
fn a_session_the_server_sets_up_otherwise_ends_before_it_opens_the_device() {
    // Decision 81 (`_check_config`): a `session.updated` that is not what was asked for
    // (another model here) ends the session as `configuration_rejected`, before the capture.
    let run = start(Platform::Linux, json!({}), true);
    *run.asr.behaviour.realtime_fault.lock().unwrap() = RealtimeFault::OtherModel;
    let mark = run.ui.send("/set/enable/transcription_send", None);
    assert_eq!(switch_failure(&run, mark), "realtime_session_failed");
    assert_eq!(run.asr.turn_detection.lock().unwrap().len(), 1, "the session asked for its settings");
    assert!(run.capture.opened().is_empty(), "the device was opened for a session set up otherwise");
    assert_eq!(run.ui.ok("/get/data/realtime_asr_state", None)["mic"]["requested"], false);
    run.ui.stop();
}

#[test]
fn an_utterance_the_server_never_finishes_ends_the_session_after_its_limit() {
    // Decision 81: the first result may take 120 s (a GPU builds its kernels) and each later one
    // 15 s; shortened here. The limit is counted from the utterance's start.
    let limits = |first: u64, later: u64| RealtimeLimits {
        session: astarot_transcription::realtime::Limits {
            first_result: Duration::from_millis(first),
            pending: Duration::from_millis(later),
            ..Default::default()
        },
        ..RealtimeLimits::default()
    };
    // The first utterance never finishes: the first limit, not the later one.
    let run = start_with(Platform::Linux, json!({}), true, None, None, limits(1000, 30_000));
    *run.asr.behaviour.realtime_fault.lock().unwrap() = RealtimeFault::NeverFinish(0);
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    run.caption(mark, "partial");
    let began = Instant::now();
    assert_eq!(switch_failure(&run, mark), "realtime_asr_timeout");
    let waited = began.elapsed();
    assert!(waited >= Duration::from_millis(800) && waited < Duration::from_secs(5), "{waited:?}");
    eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);
    run.ui.stop();

    // After a first result, an utterance that never finishes gets the later limit.
    let run = start_with(Platform::Linux, json!({}), true, None, None, limits(30_000, 1000));
    *run.asr.behaviour.realtime_fault.lock().unwrap() = RealtimeFault::NeverFinish(1);
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let first = run.caption(mark, "final")["item_id"].clone();
    let second = run.ui.wait_from(mark, "the second utterance", |l| {
        l["endpoint"] == "/run/realtime_caption" && l["result"]["state"] == "partial" && l["result"]["item_id"] != first
    });
    let began = Instant::now();
    assert_eq!(switch_failure(&run, mark), "realtime_asr_timeout", "{second}");
    let waited = began.elapsed();
    assert!(waited >= Duration::from_millis(800) && waited < Duration::from_secs(5), "{waited:?}");
    run.ui.stop();
}

#[test]
fn a_connection_that_breaks_or_an_event_too_large_ends_the_session() {
    // Decision 81: a server that goes away without closing the WebSocket, or sends an event over
    // 1 MiB, ends the session, and the switch says so.
    for fault in [RealtimeFault::Drop, RealtimeFault::Oversized] {
        let run = start(Platform::Linux, json!({}), true);
        *run.asr.behaviour.realtime_fault.lock().unwrap() = fault;
        let mark = run.ui.send("/set/enable/transcription_send", None);
        assert_eq!(switch_failure(&run, mark), "realtime_session_failed", "{fault:?}");
        eventually("the capture stopped", || run.capture.running(Source::Mic) == 0);
        assert!(run.asr.appends.load(Ordering::SeqCst) >= 1, "{fault:?}: no audio reached the server");
        let state = run.ui.ok("/get/data/realtime_asr_state", None);
        assert_eq!((state["mic"]["requested"].clone(), state["mic"]["error_code"].clone()), (json!(false), json!("realtime_session_failed")));
        run.ui.stop();
    }
}

#[test]
fn a_microphone_that_stops_delivering_ends_its_session_and_the_switch_says_so() {
    // [`capture_windows.py`]: no audio 2 s after the last, or 5 s after the open, is a stopped
    // microphone; the user is told instead of seeing no captions.
    //
    // [`capture_windows.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/capture_windows.py
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

    // One that never delivers is given 5 s from the open. It never started, which is told apart
    // from a device that went away (#1300).
    let mark = run.ui.lines().len();
    let opened = std::time::Instant::now();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let failed = run.ui.wait_from(mark, "the failure", |l| l["endpoint"] == "/set/enable/transcription_send" && l["status"] == 400);
    assert_eq!(failed["result"]["details"]["reason"], "asr_capture_start_timeout");
    assert!(opened.elapsed() >= Duration::from_millis(4900), "{:?}", opened.elapsed());

    // The speaker's loopback delivers nothing while nothing plays: that is not a failure.
    run.capture.stall(Source::Speaker, true);
    assert_eq!(run.ui.ok("/set/enable/transcription_receive", None), true);
    std::thread::sleep(Duration::from_secs(3));
    assert_eq!(run.ui.ok("/get/data/realtime_asr_state", None)["speaker"]["requested"], true);
    run.ui.stop();
}

// #1300: Windows holds a microphone's open until its permission question is answered, and refuses
// the microphone when the question was left unanswered. The switch says so by the capture's own
// codes, whose words name the question and the privacy setting, not as a device that went away.
// #1300 (decided on 2026-11-28): while Windows holds a microphone's open for its permission question
// on the desktop, the captions' state says so once the open has run 3 s, so the screens can tell a
// user in VR to look at the desktop. It goes once the open returns.
#[test]
fn a_microphone_whose_open_waits_is_reported_as_waiting() {
    let run = start(Platform::Linux, json!({}), true);
    run.capture.hold("alsa.mic");
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let mic = || run.ui.ok("/get/data/realtime_asr_state", None)["mic"].clone();
    std::thread::sleep(Duration::from_millis(1500));
    assert_eq!((mic()["state"].clone(), mic()["capture_waiting"].clone()), (json!("starting"), json!(false)), "not before 3 s");
    eventually("the open is reported as waiting", || mic()["capture_waiting"] == true);
    run.capture.let_go("alsa.mic");
    eventually("the captions run", || mic()["state"] == "ready");
    assert_eq!(mic()["capture_waiting"], false);
    run.ui.stop();
}

#[test]
fn a_microphone_windows_holds_or_refuses_is_told_as_such() {
    // The reason Mic input's switch gives when its microphone's open fails with `code`.
    let reason = |code: &str| {
        let run = start(Platform::Linux, json!({}), true);
        run.capture.refuse_with("alsa.mic", code);
        let mark = run.ui.lines().len();
        assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
        let failed = run.ui.wait_from(mark, "the failure", |l| l["endpoint"] == "/set/enable/transcription_send" && l["status"] == 400);
        assert_eq!(error_code(&failed), "TRANSCRIPTION_SEND_NOT_READY", "{failed}");
        run.ui.stop();
        failed["result"]["details"]["reason"].as_str().unwrap_or_default().to_string()
    };
    assert_eq!(reason("asr_capture_start_timeout"), "asr_capture_start_timeout");
    assert_eq!(reason("asr_capture_stream_create_failed"), "asr_capture_stream_create_failed");
    // Another failure to open is still a capture that stopped.
    assert_eq!(reason("asr_capture_endpoint_missing"), "realtime_capture_failed");
}

#[test]
fn a_switch_turned_off_and_on_while_the_server_does_not_answer_starts_again() {
    // Decision 81 (speech.cpp#224): the session's thread waited for the server's answer to the
    // WebSocket without looking at the stop, so turning the switch on again right after turning
    // it off waited for that thread and failed with `realtime_previous_owner_busy`. The setup
    // may wait 10 s here and the next start waits 0.5 s for the previous session, so only a stop
    // that ends the wait lets the switch turn on again (the answer is 200, not that failure).
    let limits = RealtimeLimits {
        drain: Duration::from_millis(500),
        session: astarot_transcription::realtime::Limits { setup: Duration::from_secs(10), ..Default::default() },
        ..RealtimeLimits::default()
    };
    let run = start_with(Platform::Linux, json!({}), true, None, None, limits);
    run.asr.behaviour.realtime_silent.store(true, Ordering::SeqCst);
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the session waits for the server", || run.asr.requested("GET /v1/realtime") == 1);
    assert_eq!(run.ui.ok("/set/disable/transcription_send", None), false);

    run.asr.behaviour.realtime_silent.store(false, Ordering::SeqCst);
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the new session opened the capture", || run.capture.running(Source::Mic) == 1);
    assert_eq!(run.capture.opened().len(), 1, "the first session never reached the device");
    let state = run.ui.ok("/get/data/realtime_asr_state", None);
    assert_eq!((state["mic"]["state"].clone(), state["mic"]["error_code"].clone()), (json!("ready"), Value::Null));
    assert!(run.ui.on(mark, "/set/enable/transcription_send").iter().all(|l| l["status"] == 200), "no failure was told");
    run.ui.stop();
}

#[test]
fn a_stop_ends_a_start_that_waits_for_the_model_list() {
    // Decision 81: a switch's start asked for the model list with nothing that could end it. A
    // stop, a settings change or shutdown moves the source's generation on, which now ends that
    // request, and the start answers that it is stale. The list may wait 10 s here.
    let limits = RealtimeLimits { models: Duration::from_secs(10), ..RealtimeLimits::default() };
    let run = start_with(Platform::Linux, json!({}), true, None, None, limits);
    run.asr.behaviour.models_silent.store(true, Ordering::SeqCst);
    let mark = run.ui.send("/set/enable/transcription_send", None);
    eventually("the start asks for the models", || run.asr.requested("GET /v1/models") == 1);
    let stopped = Instant::now();
    run.ui.ok("/run/stop_realtime_asr", Some(json!({ "source": "mic" })));
    let answer = run.ui.wait_from(mark, "the start's answer", |l| l["endpoint"] == "/set/enable/transcription_send");
    assert!(stopped.elapsed() < Duration::from_secs(1), "the start answered {:?} after the stop", stopped.elapsed());
    assert_eq!(answer["result"]["details"]["reason"], "realtime_stale_start", "{answer}");
    assert!(run.capture.opened().is_empty(), "a stopped start opened the device");
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
            let mut launch = astarot_speech_server::server::Launch::fixed(fake);
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

// #1314 (M-3): with the bundled speech.cpp missing or failing its check, the switch's refusal keeps
// that reason, whose fix is to install the app again, instead of the general start failure that
// points to the model and the device.
#[test]
fn a_switch_without_the_bundled_server_says_the_bundle_is_missing() {
    let models = tempfile::tempdir().unwrap();
    let gguf = |name: &str| {
        let path = models.path().join(format!("{name}.gguf"));
        std::fs::write(&path, b"GGUF\0\0\0\0\0\0\0\0").unwrap();
        path.canonicalize().unwrap().to_str().unwrap().to_owned()
    };
    let row = |model: String, vad: String| json!({ "model": model, "vad_model": vad, "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false });
    let empty = || row(String::new(), String::new());
    let speech_settings = json!({ "version": 1, "profiles": { "japanese": empty(), "multilingual": empty(), "asr": row(gguf("asr"), gguf("vad")) } });
    let asr = FakeAsr::start();
    let mut realtime = settings(&asr);
    realtime["server"] = json!("bundled");
    let capture = FakeCapture::new();
    capture.add_endpoint(Source::Mic, "alsa.mic", "USB Mic");
    capture.set_default(Source::Mic, Some("alsa.mic"));
    // The app's own launch: the bundle is looked for beside the app, and the test's app folder has none.
    let services = Services { transcription_capture: capture.factory(), ..Setup::default().services };
    let saved = json!({ "OSC_IP_ADDRESS": "127.0.0.2", "REALTIME_ASR_SETTINGS": realtime, "SPEECH_SERVER_SETTINGS": speech_settings });
    let ui = Ui::with(Setup { saved: Some(saved), services, platform: Platform::Linux, ..Setup::default() });
    ui.ready();
    let mark = ui.send("/set/enable/transcription_send", None);
    let answer = ui.wait_from(mark, "the answer", |l| l["endpoint"] == "/set/enable/transcription_send");
    assert_eq!(error_code(&answer), "TRANSCRIPTION_SEND_NOT_READY", "{answer}");
    assert_eq!(answer["result"]["details"]["reason"], "speech_bundle_missing_or_invalid", "{answer}");
    assert!(capture.opened().is_empty(), "no device was opened without a server");
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
