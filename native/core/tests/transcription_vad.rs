//! The VAD switches of speech recognition (#391): `mic_vad_filter`, `speaker_vad_filter` and
//! `vad_available`.
//!
//! This build has no VAD engine (decision 13): a switch cannot be turned on, a saved one is kept,
//! and phrases are cut by volume. With an engine in the services (a fake here) the switch
//! reaches the recorder, which asks the engine for its segmenter instead of the energy listener.

mod common;

use common::fake_asr::{FakeAsr, KEY};
use common::fake_audio::{FakeAudio, windows};
use common::fake_capture::{FakeCapture, quiet, speech};
use common::net::eventually;
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use vrct_core::config::Platform;
use vrct_core::controller::Services;
use vrct_transcription::capture::Source;
use vrct_transcription::energy::EnergyListener;
use vrct_transcription::vad::{Segmenter, Segments, Vad, VadEngine};

/// A VAD engine that cuts like the energy listener and notes each segmenter it made:
/// (rate, channels, longest segment).
#[derive(Default)]
struct FakeVad {
    made: Mutex<Vec<(u32, usize, f64)>>,
}

struct Cutter(EnergyListener);

impl Segmenter for Cutter {
    fn feed(&mut self, samples: &[i16]) -> Segments {
        Segmenter::feed(&mut self.0, samples)
    }

    fn reset(&mut self) {
        Segmenter::reset(&mut self.0);
    }
}

impl VadEngine for FakeVad {
    fn segmenter(&self, rate: u32, channels: usize, max_speech_seconds: f64) -> Box<dyn Segmenter> {
        self.made.lock().unwrap().push((rate, channels, max_speech_seconds));
        Box::new(Cutter(EnergyListener::new(rate, channels, 300.0, false, max_speech_seconds)))
    }
}

struct Run {
    ui: Ui,
    capture: FakeCapture,
    asr: FakeAsr,
}

fn start(saved: Value, vad: Option<Vad>) -> Run {
    let asr = FakeAsr::start();
    let capture = FakeCapture::new();
    let audio = FakeAudio::with(windows(&[("Mic A", "{a}")], Some("{a}"), &[("Speakers", "{s}")], Some("{s}")));
    let mut saved = saved;
    saved["SELECTED_TRANSCRIPTION_ENGINE"] = json!("Groq_Whisper");
    saved["TRANSCRIPTION_AUTH_KEYS"] = json!({ "Groq_Whisper": KEY, "OpenAI_Whisper": null, "Custom_Whisper": null, "Deepgram": null });
    let services = Services {
        audio: audio.platform(),
        transcription_capture: capture.factory(),
        transcription_endpoints: vrct_transcription::providers::Endpoints::all_at(&asr.base()),
        vad,
        ..Setup::default().services
    };
    let ui = Ui::with(Setup { saved: Some(saved), services, platform: Platform::Windows, ..Setup::default() });
    ui.ready();
    Run { ui, capture, asr }
}

impl Run {
    /// The speaker hears one utterance and its message reaches the UI. Each text differs: the
    /// same sentence twice in a row is dropped as a repeat.
    fn hears_a_message(&self, text: &str) {
        *self.asr.behaviour.text.lock().unwrap() = text.into();
        assert_eq!(self.ui.ok("/set/enable/transcription_receive", None), true);
        let mark = self.ui.lines().len();
        self.capture.hear(Source::Speaker, &[speech(1000), quiet(1500)]);
        let message = self.ui.wait_endpoint(mark, "/run/transcription_receive_speaker_message");
        assert_eq!(message["result"]["original"]["message"], text);
        assert_eq!(self.ui.ok("/set/disable/transcription_receive", None), false);
    }
}

#[test]
fn without_a_vad_engine_a_switch_is_not_turned_on_and_a_saved_one_is_kept() {
    let run = start(json!({ "MIC_ENABLE_VAD": true, "SPEAKER_ENABLE_VAD": true }), None);
    let init = run.ui.ready();
    assert_eq!(init["/get/data/vad_available"], false, "the UI learns it at start-up");
    assert_eq!(run.ui.ok("/get/data/vad_available", None), false);
    // A switch saved by an earlier version stays as it was.
    assert_eq!(run.ui.ok("/get/data/mic_vad_filter", None), true);
    assert_eq!(run.ui.ok("/get/data/speaker_vad_filter", None), true);

    // Phrases are cut by volume meanwhile: recognition works as with the switch off.
    run.hears_a_message("こんにちは");

    // Off works; on again is refused with the saved value to roll back to.
    assert_eq!(run.ui.ok("/set/disable/mic_vad_filter", None), false);
    let answer = run.ui.request("/set/enable/mic_vad_filter", None);
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "VAD_UNAVAILABLE"));
    assert_eq!(answer["result"]["data"], false);
    assert_eq!(run.ui.ok("/get/data/mic_vad_filter", None), false);
    eventually("the switch is saved off", || run.ui.saved()["MIC_ENABLE_VAD"] == false);
    assert_eq!(run.ui.saved()["SPEAKER_ENABLE_VAD"], true, "the other switch is untouched");
    run.ui.stop();
}

#[test]
fn with_a_vad_engine_the_switch_reaches_the_recorder() {
    let engine = Arc::new(FakeVad::default());
    let run = start(json!({ "SPEAKER_RECORD_TIMEOUT": 2, "SPEAKER_PHRASE_TIMEOUT": 4 }), Some(Vad(engine.clone())));
    assert_eq!(run.ui.ok("/get/data/vad_available", None), true);

    // Off: the energy listener cuts, the engine is not asked.
    run.hears_a_message("こんにちは");
    assert!(engine.made.lock().unwrap().is_empty());

    // On: the next start asks the engine, with the record timeout as the longest segment.
    assert_eq!(run.ui.ok("/set/enable/speaker_vad_filter", None), true);
    run.hears_a_message("こんばんは");
    assert_eq!(*engine.made.lock().unwrap(), vec![(44100, 2, 2.0)]);
    eventually("the switch is saved on", || run.ui.saved()["SPEAKER_ENABLE_VAD"] == true);
    run.ui.stop();
}
