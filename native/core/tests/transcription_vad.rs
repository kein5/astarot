//! The VAD switches of speech recognition (#391, #278): `mic_vad_filter`, `speaker_vad_filter`
//! and `vad_available`, and the recorder's VAD on the speech.cpp server (decision 13).
//!
//! Silero VAD runs on the speech.cpp server of realtime recognition. A switch is turned on only
//! while that server is set up (a bundled server with its recognition and VAD models, or an
//! external address on this computer); a saved switch is kept either way. A recording with the
//! switch on opens a Realtime session with no transcription and cuts where the server says
//! speech started and stopped; when the server cannot be used the energy listener cuts and the
//! user is told why (`/run/vad_unavailable`). A fake engine of the services stands in for the
//! server in one test. The behaviours of [`src-python/test/test_model_vad_recorder_selection.py`]
//! are those of the last two tests.
//!
//! [`src-python/test/test_model_vad_recorder_selection.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_model_vad_recorder_selection.py

mod common;

use common::fake_asr::{FakeAsr, KEY};
use common::fake_audio::{FakeAudio, windows};
use common::fake_capture::{FakeCapture, quiet, speech};
use common::net::{eventually, free_port};
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use astarot_core::config::Platform;
use astarot_core::controller::Services;
use astarot_transcription::capture::Source;
use astarot_transcription::vad::{Segmenter, Vad, VadEngine};

/// A VAD engine that cuts like the energy listener it is handed and notes each segmenter it
/// made: (rate, channels, longest segment).
#[derive(Default)]
struct FakeVad {
    made: Mutex<Vec<(u32, usize, f64)>>,
}

impl VadEngine for FakeVad {
    fn segmenter(&self, rate: u32, channels: usize, max_speech_seconds: f64, fallback: Box<dyn Segmenter>) -> Box<dyn Segmenter> {
        self.made.lock().unwrap().push((rate, channels, max_speech_seconds));
        fallback
    }
}

struct Run {
    ui: Ui,
    capture: FakeCapture,
    asr: FakeAsr,
}

/// Realtime settings of an external speech.cpp server at `base`.
fn external(base: &str) -> Value {
    json!({ "version": 1, "server": "external", "start_server": false, "base_url": base, "model": "",
            "mic": { "language": "ja", "endpoint": null, "follow_default": true },
            "speaker": { "language": "ja", "endpoint": null, "follow_default": true },
            "vocabulary": { "builtin": true, "terms": [] } })
}

/// Settings of a bundled speech.cpp server without its models.
fn bundled_without_models() -> Value {
    let mut settings = external("http://127.0.0.1:8080");
    settings["server"] = json!("bundled");
    settings
}

fn start(saved: Value, vad: Option<Vad>, realtime: impl FnOnce(&FakeAsr) -> Value) -> Run {
    let asr = FakeAsr::start();
    let capture = FakeCapture::new();
    let audio = FakeAudio::with(windows(&[("Mic A", "{a}")], Some("{a}"), &[("Speakers", "{s}")], Some("{s}")));
    let mut saved = saved;
    // Migrated already: a bundled server of an older file would choose the local engine.
    saved["LOCAL_ASR_MIGRATION"] = json!(2);
    saved["SELECTED_TRANSCRIPTION_ENGINE"] = json!("Groq_Whisper");
    saved["TRANSCRIPTION_AUTH_KEYS"] = json!({ "Groq_Whisper": KEY, "OpenAI_Whisper": null, "Custom_Whisper": null, "Deepgram": null });
    saved["REALTIME_ASR_SETTINGS"] = realtime(&asr);
    let services = Services {
        audio: audio.platform(),
        transcription_capture: capture.factory(),
        transcription_endpoints: astarot_transcription::providers::Endpoints::all_at(&asr.base()),
        vad,
        ..Setup::default().services
    };
    let ui = Ui::with(Setup { saved: Some(saved), services, platform: Platform::Windows, ..Setup::default() });
    ui.ready();
    Run { ui, capture, asr }
}

impl Run {
    /// The speaker hears one utterance and its message reaches the UI. Each text differs: the
    /// same sentence twice in a row is dropped as a repeat. Returns the line mark it began at.
    fn hears_a_message(&self, text: &str) -> usize {
        *self.asr.behaviour.text.lock().unwrap() = text.into();
        let mark = self.ui.lines().len();
        assert_eq!(self.ui.ok("/set/enable/transcription_receive", None), true);
        self.capture.hear(Source::Speaker, &[quiet(300), speech(1000), quiet(1500)]);
        let message = self.ui.wait_endpoint(mark, "/run/transcription_receive_speaker_message");
        assert_eq!(message["result"]["original"]["message"], text);
        assert_eq!(self.ui.ok("/set/disable/transcription_receive", None), false);
        mark
    }

    fn vad_sessions(&self) -> usize {
        self.asr.requested("GET /v1/realtime")
    }
}

#[test]
fn without_a_server_set_up_a_switch_is_not_turned_on_and_a_saved_one_is_kept() {
    let run = start(json!({ "MIC_ENABLE_VAD": true, "SPEAKER_ENABLE_VAD": true }), None, |_| bundled_without_models());
    let init = run.ui.ready();
    assert_eq!(init["/get/data/vad_available"], false, "the UI learns it at start-up");
    assert_eq!(run.ui.ok("/get/data/vad_available", None), false);
    // A switch saved by an earlier version stays as it was.
    assert_eq!(run.ui.ok("/get/data/mic_vad_filter", None), true);
    assert_eq!(run.ui.ok("/get/data/speaker_vad_filter", None), true);

    // Phrases are cut by volume meanwhile, and the recording says why.
    let mark = run.hears_a_message("こんにちは");
    let told = run.ui.wait_endpoint(mark, "/run/vad_unavailable");
    assert_eq!((told["status"].clone(), error_code(&told)), (json!(400), "VAD_UNAVAILABLE"));
    assert_eq!(told["result"]["data"], json!({ "source": "speaker" }));
    assert_eq!(told["result"]["details"]["reason"], "realtime_asr_model_missing");
    assert_eq!(run.vad_sessions(), 0);

    // Off works; on again is refused with the saved value to roll back to, and the reason.
    assert_eq!(run.ui.ok("/set/disable/mic_vad_filter", None), false);
    let answer = run.ui.request("/set/enable/mic_vad_filter", None);
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "VAD_UNAVAILABLE"));
    assert_eq!(answer["result"]["data"], false);
    assert_eq!(answer["result"]["details"]["reason"], "realtime_asr_model_missing");
    assert_eq!(run.ui.ok("/get/data/mic_vad_filter", None), false);
    eventually("the switch is saved off", || run.ui.saved()["MIC_ENABLE_VAD"] == false);
    assert_eq!(run.ui.saved()["SPEAKER_ENABLE_VAD"], true, "the other switch is untouched");

    // A server set up later (an external one here, which answers) is told to the UI, and the
    // switch turns on.
    let mark = run.ui.lines().len();
    run.ui.ok("/set/data/realtime_asr_settings", Some(external(&run.asr.base())));
    assert_eq!(run.ui.wait_endpoint(mark, "/get/data/vad_available")["result"], true);
    assert_eq!(run.ui.ok("/set/enable/mic_vad_filter", None), true);
    // A save that changes nothing about it says nothing; one that takes it away says so.
    let mark = run.ui.lines().len();
    run.ui.ok("/set/data/realtime_asr_settings", Some(external("http://127.0.0.1:8081")));
    assert!(run.ui.on(mark, "/get/data/vad_available").is_empty());
    run.ui.ok("/set/data/realtime_asr_settings", Some(bundled_without_models()));
    assert_eq!(run.ui.wait_endpoint(mark, "/get/data/vad_available")["result"], false);
    run.ui.stop();
}

#[test]
fn the_recorder_cuts_where_the_speech_cpp_server_hears_speech() {
    let run = start(json!({}), None, |asr| external(&asr.base()));
    assert_eq!(run.ui.ok("/get/data/vad_available", None), true);

    // Off: the energy listener cuts and no session is opened.
    run.hears_a_message("こんにちは");
    assert_eq!(run.vad_sessions(), 0);

    // On: the next start opens a session that detects speech and transcribes nothing, with
    // Python's values, and the message comes from the region the server found.
    assert_eq!(run.ui.ok("/set/enable/speaker_vad_filter", None), true);
    let mark = run.hears_a_message("こんばんは");
    assert_eq!(run.vad_sessions(), 1);
    let turn = run.asr.turn_detection.lock().unwrap().last().cloned().unwrap();
    assert_eq!(turn, json!({ "type": "server_vad", "threshold": 0.25, "prefix_padding_ms": 160, "silence_duration_ms": 768 }));
    assert!(run.ui.on(mark, "/run/vad_unavailable").is_empty(), "nothing to tell");
    eventually("the switch is saved on", || run.ui.saved()["SPEAKER_ENABLE_VAD"] == true);

    // The volume meter alone needs no detection.
    assert_eq!(run.ui.ok("/set/enable/check_speaker_threshold", None), true);
    eventually("the meter's capture runs", || run.capture.running(Source::Speaker) == 1);
    assert_eq!(run.vad_sessions(), 1);
    run.ui.stop();
}

#[test]
fn a_server_that_does_not_answer_is_told_and_the_energy_listener_cuts() {
    let gone = format!("http://127.0.0.1:{}", free_port());
    let run = start(json!({ "SPEAKER_ENABLE_VAD": true }), None, |_| external(&gone));
    // Set up as far as the settings go: the switch can be turned on.
    assert_eq!(run.ui.ok("/get/data/vad_available", None), true);
    let mark = run.hears_a_message("こんにちは");
    let told = run.ui.wait_endpoint(mark, "/run/vad_unavailable");
    assert_eq!(told["result"]["details"]["reason"], "speech_server_not_ready");
    assert_eq!(told["result"]["data"], json!({ "source": "speaker" }));
    run.ui.stop();
}

#[test]
fn an_engine_of_the_services_reaches_the_recorder_of_its_source_only() {
    let engine = Arc::new(FakeVad::default());
    let run = start(json!({ "SPEAKER_RECORD_TIMEOUT": 2, "SPEAKER_PHRASE_TIMEOUT": 4, "MIC_ENABLE_VAD": true }), Some(Vad(engine.clone())), |_| bundled_without_models());
    assert_eq!(run.ui.ok("/get/data/vad_available", None), true);

    // The microphone's switch does not reach the speaker: the energy listener cuts.
    run.hears_a_message("こんにちは");
    assert!(engine.made.lock().unwrap().is_empty());

    // On: the next start asks the engine. The longest segment is Python's fixed 7 s, not the
    // record timeout ([`transcription_recorder.py`], `_MAX_SPEECH_DURATION_MS`).
    //
    // [`transcription_recorder.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/transcription_recorder.py
    assert_eq!(run.ui.ok("/set/enable/speaker_vad_filter", None), true);
    run.hears_a_message("こんばんは");
    assert_eq!(*engine.made.lock().unwrap(), vec![(44100, 2, 7.0)]);
    eventually("the switch is saved on", || run.ui.saved()["SPEAKER_ENABLE_VAD"] == true);
    run.ui.stop();
}

#[test]
fn an_external_server_that_does_not_answer_cannot_turn_a_switch_on() {
    // Decision 88 (b): turning a switch on checks, within a second, that the external server of
    // the settings answers a connection; otherwise it is refused with the reason the realtime
    // switch gives for it, and the saved value stays.
    let gone = format!("http://127.0.0.1:{}", free_port());
    let run = start(json!({}), None, |_| external(&gone));
    assert_eq!(run.ui.ok("/get/data/vad_available", None), true, "set up as far as the settings go");
    let started = std::time::Instant::now();
    let answer = run.ui.request("/set/enable/speaker_vad_filter", None);
    assert!(started.elapsed() < std::time::Duration::from_secs(3), "{:?}", started.elapsed());
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "VAD_UNAVAILABLE"));
    assert_eq!((answer["result"]["data"].clone(), answer["result"]["details"]["reason"].clone()), (json!(false), json!("realtime_models_unavailable")));
    assert_eq!(run.ui.ok("/get/data/speaker_vad_filter", None), false);
    // Off always works; with a server that answers, on works.
    assert_eq!(run.ui.ok("/set/disable/speaker_vad_filter", None), false);
    run.ui.ok("/set/data/realtime_asr_settings", Some(external(&run.asr.base())));
    assert_eq!(run.ui.ok("/set/enable/speaker_vad_filter", None), true);
    run.ui.stop();
}

#[test]
fn a_recording_with_the_vad_starts_the_bundled_server_when_the_settings_let_it() {
    // Decision 84 (b): as the realtime switch does, a recording whose VAD needs the bundled
    // server starts it when the realtime settings allow (`start_server`), and the server is
    // stopped once no recording uses it. With `start_server` off, the recording is told the
    // server is not running (`speech_server_not_ready`) and cuts by volume.
    let models = tempfile::tempdir().unwrap();
    let gguf = |name: &str| {
        let path = models.path().join(format!("{name}.gguf"));
        std::fs::write(&path, b"GGUF\0\0\0\0\0\0\0\0").unwrap();
        path.canonicalize().unwrap().to_str().unwrap().to_owned()
    };
    let row = |model: String, vad: String| json!({ "model": model, "vad_model": vad, "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false });
    let empty = || row(String::new(), String::new());
    let speech_settings = json!({ "version": 1, "profiles": { "japanese": empty(), "multilingual": empty(), "asr": row(gguf("asr_gate"), gguf("vad")) } });
    for start_server in [true, false] {
        let asr = FakeAsr::start();
        let capture = FakeCapture::new();
        let audio = FakeAudio::with(windows(&[("Mic A", "{a}")], Some("{a}"), &[("Speakers", "{s}")], Some("{s}")));
        let mut realtime = bundled_without_models();
        realtime["start_server"] = json!(start_server);
        let saved = json!({
            "LOCAL_ASR_MIGRATION": 2, "SELECTED_TRANSCRIPTION_ENGINE": "Groq_Whisper", "SPEAKER_ENABLE_VAD": true,
            "TRANSCRIPTION_AUTH_KEYS": { "Groq_Whisper": KEY, "OpenAI_Whisper": null, "Custom_Whisper": null, "Deepgram": null },
            "REALTIME_ASR_SETTINGS": realtime, "SPEECH_SERVER_SETTINGS": speech_settings,
        });
        let fake = env!("CARGO_BIN_EXE_fake-speech-core");
        let services = Services {
            audio: audio.platform(),
            transcription_capture: capture.factory(),
            transcription_endpoints: astarot_transcription::providers::Endpoints::all_at(&asr.base()),
            speech_server_launch: Arc::new(move |_| {
                let mut launch = astarot_speech_server::server::Launch::fixed(fake);
                launch.start_timeout = std::time::Duration::from_secs(10);
                launch
            }),
            ..Setup::default().services
        };
        let ui = Ui::with(Setup { saved: Some(saved), services, platform: Platform::Windows, ..Setup::default() });
        ui.ready();
        let asr_state = || ui.ok("/get/data/speech_server_state", None)["asr"]["state"].as_str().unwrap_or("").to_string();
        let mark = ui.lines().len();
        assert_eq!(ui.ok("/set/enable/transcription_receive", None), true);
        capture.hear(Source::Speaker, &[quiet(300), speech(1000), quiet(1500)]);
        if start_server {
            eventually("the recording starts the server", || asr_state() == "preparing");
            std::fs::write(models.path().join("asr_gate.gguf.go"), b"").unwrap();
            eventually("the server is ready", || asr_state() == "ready");
            // The stand-in does not speak the Realtime API: the VAD falls back to volume, and
            // the server stays while the recording uses it.
            ui.wait_endpoint(mark, "/run/vad_unavailable");
            std::thread::sleep(std::time::Duration::from_millis(300));
            assert_eq!(asr_state(), "ready");
            assert_eq!(ui.ok("/set/disable/transcription_receive", None), false);
            eventually("the server stops once no recording uses it", || matches!(asr_state().as_str(), "stopped" | "stopping" | "idle"));
        } else {
            let told = ui.wait_endpoint(mark, "/run/vad_unavailable");
            assert_eq!(told["result"]["details"]["reason"], "speech_server_not_ready");
            assert!(!matches!(asr_state().as_str(), "preparing" | "ready"), "the server was started");
            assert_eq!(ui.ok("/set/disable/transcription_receive", None), false);
        }
        ui.stop();
        let _ = std::fs::remove_file(models.path().join("asr_gate.gguf.go"));
    }
}
