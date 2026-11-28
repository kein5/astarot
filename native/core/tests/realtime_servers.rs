//! Each realtime switch on the bundled speech.cpp server it uses (#1242): Mic input's, and
//! Listening's own while Listening has a model of its own, each started by its switch alone; and
//! Listening refused when its model does not fit beside Mic input's (decided on 2026-11-27). A
//! switch that still waits for its server does not hold up the end of the run (#1340).
//!
//! The servers are the stand-in executable (`tests/fixture/fake_speech.rs`), which leaves
//! `MODEL.started` when a server runs that model. It does not speak the Realtime API, so a session
//! does not get far: what is checked is which server each switch starts.

mod common;

use common::fake_capture::FakeCapture;
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use astarot_core::config::Platform;
use astarot_core::controller::Services;
use astarot_transcription::capture::Source;

struct Run {
    ui: Ui,
    models: tempfile::TempDir,
    _capture: FakeCapture,
}

impl Run {
    /// Linux, where the main switches run realtime recognition, on the bundled server with Mic
    /// input's model `mic` and Listening's `listening` ("" for none of its own).
    fn start(mic: &str, listening: &str) -> Run {
        Run::with_start_timeout(mic, listening, Duration::from_secs(10))
    }

    /// [`Run::start`] with the servers' own start timeout.
    fn with_start_timeout(mic: &str, listening: &str, start_timeout: Duration) -> Run {
        let models = tempfile::tempdir().unwrap();
        let gguf = |name: &str| {
            if name.is_empty() {
                return String::new();
            }
            let path = models.path().join(format!("{name}.gguf"));
            std::fs::write(&path, b"GGUF\0\0\0\0\0\0\0\0").unwrap();
            path.canonicalize().unwrap().to_str().unwrap().to_owned()
        };
        let empty = json!({ "model": "", "vad_model": "", "diarization_model": "", "listening_model": "", "voice_file": "", "device": "auto", "low_latency": false });
        let mut asr = empty.clone();
        asr["model"] = json!(gguf(mic));
        asr["vad_model"] = json!(gguf("vad"));
        asr["listening_model"] = json!(gguf(listening));
        let saved = json!({
            "REALTIME_ASR_SETTINGS": {
                "version": 1, "server": "bundled", "start_server": true, "base_url": "http://127.0.0.1:8080", "model": "",
                "mic": { "language": "ja", "endpoint": null, "follow_default": true },
                "speaker": { "language": "ja", "endpoint": null, "follow_default": true },
                "vocabulary": { "builtin": true, "terms": [] },
            },
            "SPEECH_SERVER_SETTINGS": { "version": 1, "profiles": { "japanese": empty, "multilingual": empty, "asr": asr } },
        });
        let capture = FakeCapture::new();
        capture.add_endpoint(Source::Mic, "alsa.mic", "USB Mic");
        capture.add_endpoint(Source::Speaker, "alsa.out", "Speakers");
        capture.set_default(Source::Mic, Some("alsa.mic"));
        capture.set_default(Source::Speaker, Some("alsa.out"));
        let fake = env!("CARGO_BIN_EXE_fake-speech-core");
        let services = Services {
            transcription_capture: capture.factory(),
            speech_server_launch: Arc::new(move |_| {
                let mut launch = astarot_speech_server::server::Launch::fixed(fake);
                launch.start_timeout = start_timeout;
                launch
            }),
            ..Setup::default().services
        };
        let ui = Ui::with(Setup { saved: Some(saved), services, platform: Platform::Linux, ..Setup::default() });
        ui.ready();
        Run { ui, models, _capture: capture }
    }

    /// Whether a server ran the model `name`.
    fn ran(&self, name: &str) -> bool {
        Path::new(&self.models.path().join(format!("{name}.gguf.started"))).exists()
    }

    /// Turns a switch on and waits for its answer.
    fn turn_on(&self, endpoint: &str) -> Value {
        let mark = self.ui.send(endpoint, None);
        self.ui.wait_from(mark, "the switch's answer", |line| line["endpoint"] == endpoint)
    }

    fn state(&self) -> Value {
        self.ui.ok("/get/data/speech_server_state", None)
    }
}

const MIC: &str = "/set/enable/transcription_send";
const LISTENING: &str = "/set/enable/transcription_receive";

// The maintainer's wish of 2026-11-27: the two switches stay independent, each starting the
// server it needs. With a model of its own, Listening starts its own server and not Mic input's;
// Mic input starts its own. Without one, Listening uses Mic input's server, as before.
#[test]
fn each_switch_starts_the_server_it_uses() {
    let run = Run::start("asr_mic", "asr_listen");
    run.turn_on(LISTENING);
    assert!(run.ran("asr_listen"), "Listening started its own server");
    assert!(!run.ran("asr_mic"), "and not Mic input's");
    run.turn_on(MIC);
    assert!(run.ran("asr_mic"), "Mic input started its own");
    run.ui.stop();

    for listening in ["", "asr_mic"] {
        let run = Run::start("asr_mic", listening);
        run.turn_on(LISTENING);
        assert!(run.ran("asr_mic"), "one server for both ({listening:?})");
        assert_eq!(run.state()["asr_listening"]["generation"], 0, "Listening's own server never started ({listening:?})");
        run.ui.stop();
    }
}

// Decision 3 of #1242: Listening's own model that does not fit in memory beside Mic input's is
// refused with its own reason, so that the switch can offer one model for both; nothing else
// changes. Alone, the same failure is the server's own.
#[test]
fn listening_is_refused_when_its_model_does_not_fit_beside_mic_inputs() {
    let run = Run::start("asr_mic", "asr_oom");
    let mic = run.ui.request("/run/start_speech_server", Some(json!({ "profile": "asr", "generation": 0 })));
    assert_eq!(mic["status"], 200, "{mic}");
    common::net::eventually("Mic input's server is ready", || run.state()["asr"]["state"] == "ready");
    let answer = run.turn_on(LISTENING);
    assert_eq!(error_code(&answer), "TRANSCRIPTION_RECEIVE_NOT_READY", "{answer}");
    assert_eq!(answer["result"]["details"]["reason"], "realtime_asr_models_do_not_fit", "{answer}");
    assert_eq!(run.state()["asr"]["state"], "ready", "Mic input's server is left as it was");
    run.ui.stop();

    let run = Run::start("asr_mic", "asr_oom");
    let answer = run.turn_on(LISTENING);
    assert_eq!(answer["result"]["details"]["reason"], "speech_server_out_of_memory", "{answer}");
    run.ui.stop();
}

// The settings page lists the models of the server a source uses: Listening's own server, once
// it runs, for `{"source": "speaker"}`.
#[test]
fn the_models_list_is_that_of_the_sources_server() {
    let run = Run::start("asr_mic", "asr_listen");
    for profile in ["asr", "asr_listening"] {
        let started = run.ui.request("/run/start_speech_server", Some(json!({ "profile": profile, "generation": 0 })));
        assert_eq!(started["status"], 200, "{started}");
    }
    common::net::eventually("both servers are ready", || {
        let state = run.state();
        state["asr"]["state"] == "ready" && state["asr_listening"]["state"] == "ready"
    });
    let state = run.state();
    let mic = run.ui.ok("/get/data/realtime_asr_models", None);
    let listening = run.ui.ok("/get/data/realtime_asr_models", Some(json!({ "source": "speaker" })));
    assert_eq!(mic["base_url"], state["asr"]["base_url"], "{mic}");
    assert_eq!(listening["base_url"], state["asr_listening"]["base_url"], "{listening}");
    let refused = run.ui.request("/get/data/realtime_asr_models", Some(json!({ "source": "game" })));
    assert_eq!((refused["status"].clone(), error_code(&refused)), (json!(400), "realtime_source_invalid"));
    run.ui.stop();
}

// #1340: Mic input's switch waits for its server holding the talk lock, which the end of the run
// takes before it closes realtime recognition. The end stops the wait instead of waiting for it
// until the server's own start timeout, and the switch is answered as a stale start.
#[test]
fn the_end_of_the_run_does_not_wait_for_a_switch_that_waits_for_its_server() {
    // `gate` never says it is ready (no `.go` is written), and its start timeout is far beyond
    // the stop's limit, so only the stop can end the switch's wait.
    let run = Run::with_start_timeout("asr_gate", "", Duration::from_secs(120));
    let mark = run.ui.send(MIC, None);
    common::net::eventually("Mic input's server is launched", || run.ran("asr_gate"));
    let stopping = Instant::now();
    assert!(
        run.ui.backend.kill_and_wait(Duration::from_secs(20)),
        "the end of the run waited for the switch ({:?})",
        stopping.elapsed()
    );
    let answer = run.ui.wait_from(mark, "the switch's answer", |line| line["endpoint"] == MIC);
    assert_eq!(answer["result"]["details"]["reason"], "realtime_stale_start", "{answer}");
    run.ui.stop();
}
