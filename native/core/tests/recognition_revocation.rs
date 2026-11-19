//! What recognition had heard but not yet delivered when it stopped (#278, carried over from
//! #285's message sending): a recognised utterance waits in translation, then the user turns the
//! switch off, a device is lost or its reads fail, the device moves, the settings pause
//! recognition or realtime recognition takes the microphone over. Turning off and a failure drop
//! it everywhere; a pause, a move and the hand-over keep it.
//!
//! The behaviours are those of `src-python/test/test_message_delivery_revocation.py`
//! (`disable_during_translation_drops_all_outputs_but_keeps_typed_chat`,
//! `user_off_while_settings_paused_revokes_inflight_delivery`,
//! `internal_pause_preserves_inflight_legacy_delivery`, `error_disable_revokes_before_cleanup`,
//! `realtime_toggle_off_revokes_source_but_settings_pause_keeps_epoch`,
//! `terminal_realtime_failure_only_revokes_its_current_owner`, and the VRChat mute:
//! `legacy_mute_during_translation_revokes_every_output[resume=False]`,
//! `mic_mute_does_not_revoke_other_sources`, `vrc_mute_sync_off_leaves_mic_delivery_unchanged`,
//! `realtime_muted_captions_and_new_results_after_unmute`). What a mute does to text admitted
//! before it once it is lifted is decision 55 of `docs/voice-stack/core-integration.md`, and is
//! not tested here. The translation is DeepL on `FakeProviders`, held until the test releases
//! it; recognition is `common::fake_asr` with the devices of `common::fake_capture`, and OSC is
//! `common::fake_osc`.

mod common;

use common::fake_asr::{FakeAsr, KEY, RealtimeFault};
use common::fake_audio::{FakeAudio, windows};
use common::fake_capture::{FakeCapture, quiet, speech};
use common::net::eventually;
use common::{Setup, Ui};
use serde_json::{Value, json};
use std::net::UdpSocket;
use std::sync::Mutex;
use std::sync::mpsc::{Sender, channel};
use std::time::{Duration, Instant};
use vrct_adapters::osc::{OscArg, PARAMETER_MUTE_SELF, decode_packet};
use vrct_audio_routing::manager::Topology;
use vrct_core::config::Platform;
use vrct_core::controller::{RealtimeLimits, Services};
use vrct_translation::fake::FakeProviders;
use vrct_transcription::capture::Source;

/// VRChat on this PC: OSCQuery runs (the fake link has no mDNS), which mute sync needs.
const VRCHAT: &str = "127.0.0.1";
const TRANSLATE: &str = "/deepl-free/v2/translate";

fn deepl_key() -> String {
    format!("{}:fx", "d".repeat(36))
}

struct Run {
    ui: Ui,
    capture: FakeCapture,
    asr: FakeAsr,
    audio: FakeAudio,
    providers: FakeProviders,
    chatbox: UdpSocket,
    osc: common::fake_osc::Opened,
    /// Releases the translation the test holds.
    release: Mutex<Option<Sender<()>>>,
}

fn start(platform: Platform, saved: Value) -> Run {
    start_with(platform, saved, RealtimeLimits::default())
}

fn start_with(platform: Platform, saved: Value, realtime_limits: RealtimeLimits) -> Run {
    let asr = FakeAsr::start();
    let providers = FakeProviders::start();
    providers.key("/deepl-free", &deepl_key());
    let capture = FakeCapture::new();
    capture.add_endpoint(Source::Mic, "alsa.mic", "USB Mic");
    capture.add_endpoint(Source::Speaker, "alsa.out", "Speakers");
    capture.set_default(Source::Mic, Some("alsa.mic"));
    capture.set_default(Source::Speaker, Some("alsa.out"));
    let audio = FakeAudio::with(windows(&[("Mic A", "{a}"), ("Mic B", "{b}")], Some("{a}"), &[("Speakers", "{s}")], Some("{s}")));
    let chatbox = UdpSocket::bind((VRCHAT, 0)).unwrap();
    let mut saved = saved;
    for (key, value) in [
        ("OSC_IP_ADDRESS", json!(VRCHAT)),
        ("OSC_PORT", json!(chatbox.local_addr().unwrap().port())),
        ("LOGGER_FEATURE", json!(true)),
        // Received speech goes to the chat box too, so that both sources can be checked there.
        ("SEND_RECEIVED_MESSAGE_TO_VRC", json!(true)),
        ("AUTH_KEYS", json!({ "DeepL_API": deepl_key() })),
        ("SELECTED_TRANSCRIPTION_ENGINE", json!("OpenAI_Whisper")),
        ("TRANSCRIPTION_AUTH_KEYS", json!({ "Groq_Whisper": null, "OpenAI_Whisper": KEY, "Custom_Whisper": null, "Deepgram": null })),
    ] {
        if saved.get(key).is_none() {
            saved[key] = value;
        }
    }
    let (osc, opened) = common::fake_osc::factory(false);
    let services = Services {
        osc,
        audio: audio.platform(),
        transcription_capture: capture.factory(),
        transcription_endpoints: vrct_transcription::providers::Endpoints::all_at(&asr.base()),
        translation_endpoints: vrct_translation::providers::Endpoints::all_at(&providers.url()),
        realtime_limits,
        ..Setup::default().services
    };
    let ui = Ui::with(Setup { saved: Some(saved), services, platform, ..Setup::default() });
    ui.ready();
    let mut engines = ui.ok("/get/data/selected_translation_engines", None);
    engines["1"] = json!("DeepL_API");
    ui.ok("/set/data/selected_translation_engines", Some(engines));
    assert_eq!(ui.ok("/set/enable/translation", None), true);
    Run { ui, capture, asr, audio, providers, chatbox, osc: opened, release: Mutex::new(None) }
}

/// The recognition switch of a source and the message it delivers.
fn switch(source: Source) -> (&'static str, &'static str) {
    match source {
        Source::Mic => ("transcription_send", "/run/transcription_send_mic_message"),
        Source::Speaker => ("transcription_receive", "/run/transcription_receive_speaker_message"),
    }
}

impl Run {
    /// Turns VRChat mic mute sync on; it needs OSCQuery, which starts in the background.
    fn mute_sync(&self) {
        assert_eq!(self.ui.wait_endpoint(0, "/run/enable_osc_query")["result"]["data"], true);
        assert_eq!(self.ui.ok("/set/enable/vrc_mic_mute_sync", None), true);
    }

    /// VRChat says the user is muted; an unmute is confirmed by OSCQuery, as VRChat does.
    fn vrchat_mutes(&self, muted: bool) {
        let osc = self.osc.last();
        *osc.mute.lock().unwrap() = Some(muted);
        osc.vrchat_sends(PARAMETER_MUTE_SELF, vec![OscArg::Bool(muted)]);
    }

    /// Holds every translation until [`Run::release`].
    fn hold(&self) {
        let (release, held) = channel::<()>();
        let held = Mutex::new(held);
        self.providers.reply(move |_, _, _| {
            let _ = held.lock().unwrap().recv_timeout(Duration::from_secs(10));
            None
        });
        *self.release.lock().unwrap() = Some(release);
    }

    /// Lets the held translation finish, and every later one at once.
    fn release(&self) {
        if let Some(release) = self.release.lock().unwrap().take() {
            let _ = release.send(());
        }
    }

    /// Hears an utterance on `source` and waits until its text is being translated.
    fn heard_and_translating(&self, source: Source) {
        let before = self.providers.seen_under(TRANSLATE).len();
        self.capture.hear(source, &[speech(900), quiet(1200)]);
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.providers.seen_under(TRANSLATE).len() == before {
            assert!(Instant::now() < deadline, "the recognised text was never translated");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

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

    fn conversation_log(&self) -> String {
        let mut text = String::new();
        for entry in std::fs::read_dir(self.ui.dir.join("logs")).unwrap().flatten() {
            if entry.file_name().to_string_lossy().starts_with("20") {
                text.push_str(&std::fs::read_to_string(entry.path()).unwrap_or_default());
            }
        }
        text
    }

    /// Nothing of the held utterance reached the UI, the chat box or the conversation log.
    fn delivered_nothing(&self, mark: usize, source: Source) {
        let (_, message) = switch(source);
        std::thread::sleep(Duration::from_millis(500));
        assert!(self.ui.on(mark, message).is_empty(), "the UI got it");
        assert!(self.chatbox_text(Duration::from_millis(300)).is_none(), "the chat box got it");
        assert!(!self.conversation_log().contains("こんにちは"), "the conversation log got it");
    }

    /// The held utterance reached the UI and the chat box.
    fn delivered(&self, mark: usize, source: Source) {
        self.delivered_text(mark, source, "こんにちは");
    }

    fn delivered_text(&self, mark: usize, source: Source, text: &str) {
        let (_, message) = switch(source);
        assert_eq!(self.ui.wait_endpoint(mark, message)["result"]["original"]["message"], text);
        let sent = self.chatbox_text(Duration::from_secs(5)).expect("the chat box got nothing");
        assert!(sent.contains(text), "{sent}");
    }
}

#[test]
fn turning_recognition_off_while_its_text_is_translated_drops_it_but_not_typed_chat() {
    for source in [Source::Mic, Source::Speaker] {
        let run = start(Platform::Windows, json!({}));
        let (name, _) = switch(source);
        assert_eq!(run.ui.ok(&format!("/set/enable/{name}"), None), true);
        run.hold();
        let mark = run.ui.lines().len();
        run.heard_and_translating(source);
        assert_eq!(run.ui.ok(&format!("/set/disable/{name}"), None), false);
        // Turning it on again does not bring the old utterance back.
        assert_eq!(run.ui.ok(&format!("/set/enable/{name}"), None), true);
        run.release();
        run.delivered_nothing(mark, source);

        // Typed chat is not recognition: it still goes out.
        run.ui.ok("/run/send_message_box", Some(json!({ "id": "c-1", "message": "打ったチャット" })));
        let sent = run.chatbox_text(Duration::from_secs(5)).expect("the typed chat was not sent");
        assert!(sent.contains("打ったチャット"), "{sent}");
        // And the source hears again. The repeat check counted the dropped utterance when it
        // was admitted (as Python did), so the next one says something else.
        *run.asr.behaviour.text.lock().unwrap() = "また話した".into();
        let mark = run.ui.lines().len();
        run.capture.hear(source, &[speech(900), quiet(1200)]);
        run.delivered_text(mark, source, "また話した");
        run.ui.stop();
    }
}

#[test]
fn a_settings_pause_keeps_what_was_heard_and_turning_off_after_it_drops_it() {
    for source in [Source::Mic, Source::Speaker] {
        let (name, _) = switch(source);
        // The settings page pauses recognition while it is open: what was already heard is sent.
        let run = start(Platform::Windows, json!({}));
        assert_eq!(run.ui.ok(&format!("/set/enable/{name}"), None), true);
        run.hold();
        let mark = run.ui.lines().len();
        run.heard_and_translating(source);
        assert_eq!(run.ui.ok(&format!("/set/disable/{name}"), Some(json!({ "reason": "settings_pause" }))), false);
        run.release();
        run.delivered(mark, source);
        run.ui.stop();

        // The user turns it off for good while it is paused: dropped.
        let run = start(Platform::Windows, json!({}));
        assert_eq!(run.ui.ok(&format!("/set/enable/{name}"), None), true);
        run.hold();
        let mark = run.ui.lines().len();
        run.heard_and_translating(source);
        run.ui.ok(&format!("/set/disable/{name}"), Some(json!({ "reason": "settings_pause" })));
        run.ui.ok(&format!("/set/disable/{name}"), None);
        run.release();
        run.delivered_nothing(mark, source);
        run.ui.stop();
    }
}

/// A failing engine takes the path of a failing read (`recorder_failed`). It cannot fail while
/// an utterance is translated: the recognizer delivers on its own thread, one at a time, as
/// Python's transcriber did.
#[test]
fn a_lost_device_or_a_failing_read_drops_what_was_heard() {
    // The last microphone is unplugged.
    let run = start(Platform::Windows, json!({}));
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    run.hold();
    let mark = run.ui.lines().len();
    run.heard_and_translating(Source::Mic);
    // Unplugged: the list loses it and its reads fail, as a real device does.
    run.audio.set(windows(&[], None, &[("Speakers", "{s}")], Some("{s}")));
    run.capture.break_device(Source::Mic);
    run.audio.event(Topology::DeviceChanged);
    run.ui.wait_endpoint(mark, "/set/disable/transcription_send");
    run.release();
    run.delivered_nothing(mark, Source::Mic);
    run.ui.stop();

    // The last speaker is unplugged.
    let run = start(Platform::Windows, json!({}));
    assert_eq!(run.ui.ok("/set/enable/transcription_receive", None), true);
    run.hold();
    let mark = run.ui.lines().len();
    run.heard_and_translating(Source::Speaker);
    run.audio.set(windows(&[("Mic A", "{a}"), ("Mic B", "{b}")], Some("{a}"), &[], None));
    run.capture.break_device(Source::Speaker);
    run.audio.event(Topology::DeviceChanged);
    run.ui.wait_endpoint(mark, "/set/disable/transcription_receive");
    run.release();
    run.delivered_nothing(mark, Source::Speaker);
    run.ui.stop();

    // The device is still listed but its reads fail.
    for source in [Source::Mic, Source::Speaker] {
        let (name, _) = switch(source);
        let run = start(Platform::Windows, json!({}));
        assert_eq!(run.ui.ok(&format!("/set/enable/{name}"), None), true);
        run.hold();
        let mark = run.ui.lines().len();
        run.heard_and_translating(source);
        run.capture.break_device(source);
        assert_eq!(run.ui.wait_endpoint(mark, "/run/transcription_recognition_error")["result"]["error_code"], "AUDIO_READ_ERROR");
        run.release();
        run.delivered_nothing(mark, source);
        run.ui.stop();
    }
}

#[test]
fn a_vrchat_mute_while_the_microphone_text_is_translated_drops_it_but_not_typed_chat() {
    // `legacy_mute_during_translation_revokes_every_output[resume=False]`: with mute sync on,
    // the user mutes in VRChat while what the microphone heard is translated. It goes nowhere.
    // Lifting the mute before the translation ends is decision 55 and not checked here.
    let run = start(Platform::Windows, json!({}));
    run.mute_sync();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    run.hold();
    let mark = run.ui.lines().len();
    run.heard_and_translating(Source::Mic);
    run.vrchat_mutes(true);
    run.release();
    run.delivered_nothing(mark, Source::Mic);

    // `mic_mute_does_not_revoke_other_sources[chat]`: typed chat still goes out while muted.
    run.ui.ok("/run/send_message_box", Some(json!({ "id": "c-1", "message": "打ったチャット" })));
    let sent = run.chatbox_text(Duration::from_secs(5)).expect("the typed chat was not sent");
    assert!(sent.contains("打ったチャット"), "{sent}");
    run.ui.stop();
}

#[test]
fn a_vrchat_mute_leaves_what_the_speaker_heard() {
    // `mic_mute_does_not_revoke_other_sources[speaker]`: the mute holds back the microphone only.
    let run = start(Platform::Windows, json!({}));
    run.mute_sync();
    assert_eq!(run.ui.ok("/set/enable/transcription_receive", None), true);
    run.hold();
    let mark = run.ui.lines().len();
    run.heard_and_translating(Source::Speaker);
    run.vrchat_mutes(true);
    run.release();
    run.delivered(mark, Source::Speaker);
    run.ui.stop();
}

#[test]
fn without_mute_sync_a_vrchat_mute_leaves_the_microphone_text() {
    // `vrc_mute_sync_off_leaves_mic_delivery_unchanged`: mute sync is off (the default).
    let run = start(Platform::Windows, json!({}));
    assert_eq!(run.ui.wait_endpoint(0, "/run/enable_osc_query")["result"]["data"], true);
    assert_eq!(run.ui.ok("/get/data/vrc_mic_mute_sync", None), false);
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    run.hold();
    let mark = run.ui.lines().len();
    run.heard_and_translating(Source::Mic);
    run.vrchat_mutes(true);
    run.release();
    run.delivered(mark, Source::Mic);
    run.ui.stop();
}

#[test]
fn a_device_that_does_not_open_at_the_start_drops_nothing_heard_before() {
    // `error_disable_revokes_before_cleanup[start_refused]`: after a settings pause, the switch
    // is turned on again and no device opens; what the pause kept is dropped with it.
    let run = start(Platform::Windows, json!({}));
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    run.hold();
    let mark = run.ui.lines().len();
    run.heard_and_translating(Source::Mic);
    run.ui.ok("/set/disable/transcription_send", Some(json!({ "reason": "settings_pause" })));
    run.capture.refuse("{a}");
    run.capture.refuse("{b}");
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), false);
    run.release();
    run.delivered_nothing(mark, Source::Mic);
    run.ui.stop();
}

#[test]
fn moving_to_another_device_keeps_what_was_heard() {
    // `internal_pause_preserves_inflight_legacy_delivery[device_update]`.
    let run = start(Platform::Windows, json!({}));
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    run.hold();
    let mark = run.ui.lines().len();
    run.heard_and_translating(Source::Mic);
    run.audio.set(windows(&[("Mic B", "{b}")], Some("{b}"), &[("Speakers", "{s}")], Some("{s}")));
    run.capture.break_device(Source::Mic);
    run.audio.event(Topology::DeviceChanged);
    run.ui.wait_endpoint(mark, "/run/audio_device_switched");
    eventually("the capture moved", || run.capture.opened().last() == Some(&(Source::Mic, "{b}".to_string())));
    run.release();
    run.delivered(mark, Source::Mic);
    run.ui.stop();
}

/// Realtime settings that point at the fake speech.cpp server.
fn realtime(asr: &FakeAsr) -> Value {
    json!({
        "version": 1, "server": "external", "start_server": true, "base_url": asr.base(), "model": "haas-ja",
        "mic": { "language": "ja", "endpoint": null, "follow_default": true },
        "speaker": { "language": "ja", "endpoint": null, "follow_default": true },
        "vocabulary": { "builtin": true, "terms": [] },
    })
}

#[test]
fn realtime_recognition_taking_the_microphone_over_keeps_what_the_recorder_heard() {
    // `internal_pause_preserves_inflight_legacy_delivery[handoff]`: the settings page starts a
    // session on the microphone while the recorder's utterance is translated.
    let run = start(Platform::Windows, json!({}));
    let settings = realtime(&run.asr);
    run.ui.ok("/set/data/realtime_asr_settings", Some(settings));
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    run.hold();
    let mark = run.ui.lines().len();
    run.heard_and_translating(Source::Mic);
    let state = run.ui.ok("/run/start_realtime_asr", Some(json!({ "source": "mic" })));
    assert_eq!(state["mic"]["requested"], true);
    run.release();
    run.delivered(mark, Source::Mic);
    run.ui.stop();
}

#[test]
fn turning_the_realtime_switch_off_while_a_final_is_translated_drops_it() {
    // `realtime_toggle_off_revokes_source_but_settings_pause_keeps_epoch`: on Linux the main
    // switch runs realtime recognition.
    let run = start(Platform::Linux, json!({}));
    let settings = realtime(&run.asr);
    run.ui.ok("/set/data/realtime_asr_settings", Some(settings));
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    eventually("the capture opened", || run.capture.running(Source::Mic) == 1);
    run.hold();
    let mark = run.ui.lines().len();
    let before = run.providers.seen_under(TRANSLATE).len();
    run.capture.hear(Source::Mic, &[speech(2000)]);
    run.ui.wait_from(mark, "the final", |l| l["endpoint"] == "/run/realtime_caption" && l["result"]["state"] == "final");
    eventually("the final is translated", || run.providers.seen_under(TRANSLATE).len() > before);
    assert_eq!(run.ui.ok("/set/disable/transcription_send", None), false);
    run.release();
    std::thread::sleep(Duration::from_millis(500));
    let outcomes: Vec<Value> = run
        .ui
        .on(mark, "/run/realtime_caption")
        .into_iter()
        .filter(|l| l["result"]["state"] == "outcome")
        .map(|l| l["result"].clone())
        .collect();
    assert!(outcomes.iter().all(|o| o["outcome"] != "delivered"), "{outcomes:?}");
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none(), "the chat box got it");
    assert!(!run.conversation_log().contains("こんにちは"), "the conversation log got it");
    run.ui.stop();
}

#[test]
fn a_realtime_session_that_fails_while_its_final_is_translated_drops_it() {
    // `terminal_realtime_failure_only_revokes_its_current_owner`: the session ends on its own
    // (here the server never finishes the next utterance) while a final waits for translation.
    // The switch says so, and the final goes nowhere.
    let limits = RealtimeLimits {
        session: vrct_transcription::realtime::Limits {
            first_result: Duration::from_secs(30),
            pending: Duration::from_millis(1000),
            ..Default::default()
        },
        ..RealtimeLimits::default()
    };
    let run = start_with(Platform::Linux, json!({}), limits);
    let settings = realtime(&run.asr);
    run.ui.ok("/set/data/realtime_asr_settings", Some(settings));
    *run.asr.behaviour.realtime_fault.lock().unwrap() = RealtimeFault::NeverFinish(1);
    run.hold();
    let mark = run.ui.lines().len();
    let before = run.providers.seen_under(TRANSLATE).len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let first = run.ui.wait_from(mark, "the final", |l| l["endpoint"] == "/run/realtime_caption" && l["result"]["state"] == "final");
    eventually("the final is translated", || run.providers.seen_under(TRANSLATE).len() > before);
    let failed = run.ui.wait_from(mark, "the failure", |l| l["endpoint"] == "/set/enable/transcription_send" && l["status"] == 400);
    assert_eq!(failed["result"]["details"]["reason"], "realtime_asr_timeout", "{failed}");
    run.release();
    std::thread::sleep(Duration::from_millis(500));
    let item = &first["result"]["item_id"];
    let rows: Vec<Value> =
        run.ui.on(mark, "/run/realtime_caption").into_iter().map(|l| l["result"].clone()).filter(|r| &r["item_id"] == item).collect();
    assert!(rows.iter().all(|r| r["state"] != "translated" && r["outcome"] != "delivered"), "{rows:?}");
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none(), "the chat box got it");
    assert!(!run.conversation_log().contains("こんにちは"), "the conversation log got it");
    run.ui.stop();
}

#[test]
fn a_vrchat_mute_holds_realtime_microphone_results_back_but_not_the_speakers() {
    // `realtime_muted_captions_and_new_results_after_unmute`: while VRChat mutes the user, the
    // microphone's captions and finals go nowhere and the speaker's still do; once the mute is
    // lifted, what the microphone hears next goes out again. Received speech stays out of the
    // chat box here, so that the chat box shows the microphone alone.
    let run = start(Platform::Linux, json!({ "SEND_RECEIVED_MESSAGE_TO_VRC": false }));
    let settings = realtime(&run.asr);
    run.ui.ok("/set/data/realtime_asr_settings", Some(settings));
    run.mute_sync();
    let delivered = |from: usize, source: &str| {
        run.ui.wait_from(from, "a delivered final", |l| {
            l["endpoint"] == "/run/realtime_caption" && l["result"]["source"] == source && l["result"]["outcome"] == "delivered"
        })
    };
    let mark = run.ui.lines().len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    assert_eq!(run.ui.ok("/set/enable/transcription_receive", None), true);
    delivered(mark, "mic");
    delivered(mark, "speaker");

    run.vrchat_mutes(true);
    // What was already on its way when the mute came may still end; then the chat box is empty.
    std::thread::sleep(Duration::from_millis(500));
    while run.chatbox_text(Duration::from_millis(200)).is_some() {}
    let mark = run.ui.lines().len();
    delivered(mark, "speaker");
    std::thread::sleep(Duration::from_millis(1500));
    let mic: Vec<Value> = run
        .ui
        .on(mark, "/run/realtime_caption")
        .into_iter()
        .map(|l| l["result"].clone())
        .filter(|r| r["source"] == "mic" && r["state"] != "outcome")
        .collect();
    assert!(mic.is_empty(), "the microphone's captions were shown while muted: {mic:?}");
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none(), "the chat box got the microphone while muted");

    let mark = run.ui.lines().len();
    run.vrchat_mutes(false);
    delivered(mark, "mic");
    assert!(run.chatbox_text(Duration::from_secs(5)).is_some_and(|t| t.contains("こんにちは")));
    run.ui.stop();
}

#[test]
fn a_vrchat_mute_while_a_realtime_final_is_translated_drops_it() {
    // `realtime_mute_during_translation_revokes_every_late_output[resume=False]`. Lifting the
    // mute before the translation ends is decision 55 and not checked here.
    let run = start(Platform::Linux, json!({}));
    let settings = realtime(&run.asr);
    run.ui.ok("/set/data/realtime_asr_settings", Some(settings));
    run.mute_sync();
    run.hold();
    let mark = run.ui.lines().len();
    let before = run.providers.seen_under(TRANSLATE).len();
    assert_eq!(run.ui.ok("/set/enable/transcription_send", None), true);
    let first = run.ui.wait_from(mark, "the final", |l| l["endpoint"] == "/run/realtime_caption" && l["result"]["state"] == "final");
    eventually("the final is translated", || run.providers.seen_under(TRANSLATE).len() > before);
    run.vrchat_mutes(true);
    run.release();
    std::thread::sleep(Duration::from_millis(500));
    let item = &first["result"]["item_id"];
    let rows: Vec<Value> =
        run.ui.on(mark, "/run/realtime_caption").into_iter().map(|l| l["result"].clone()).filter(|r| &r["item_id"] == item).collect();
    assert!(rows.iter().all(|r| r["state"] != "translated" && r["outcome"] != "delivered"), "{rows:?}");
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none(), "the chat box got it");
    assert!(!run.conversation_log().contains("こんにちは"), "the conversation log got it");
    run.ui.stop();
}
