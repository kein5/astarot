//! The GPU check (#288): over the connection the UI uses, with a stand-in for the speech.cpp
//! command line (`tests/fixture/fake_speech.rs`). No model, GPU or audio.

mod common;

use common::{Setup, Ui};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use astarot_core::controller::Services;
use astarot_speech_server::server::Launch;

const FAKE: &str = env!("CARGO_BIN_EXE_fake-speech-core");

/// A copy of the stand-in in a folder of its own with a `bundle.json` beside it, so that it lists
/// a GPU (`Vulkan0`, "Fake GPU") and the CPU.
struct Bundle {
    dir: tempfile::TempDir,
}

impl Bundle {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        std::fs::copy(FAKE, Self::exe_in(dir.path())).unwrap();
        std::fs::write(dir.path().join("bundle.json"), b"{}").unwrap();
        Self { dir }
    }

    fn exe_in(dir: &std::path::Path) -> PathBuf {
        dir.join(if cfg!(windows) { "speech.exe" } else { "speech" })
    }

    fn services(&self) -> Services {
        let exe = Self::exe_in(self.dir.path());
        Services {
            speech_server_launch: Arc::new(move |_| Launch::fixed(exe.clone())),
            ..Setup::default().services
        }
    }
}

/// Model files the stand-in reads by their names, in a folder whose name holds non-ASCII text
/// and a name a report must not carry.
struct Models {
    dir: tempfile::TempDir,
}

impl Models {
    fn new() -> Self {
        Self { dir: tempfile::Builder::new().prefix("someone ユーザー").tempdir().unwrap() }
    }

    fn gguf(&self, name: &str) -> String {
        let path = self.dir.path().join(format!("{name}.gguf"));
        std::fs::write(&path, b"GGUF\0\0\0\0\0\0\0\0").unwrap();
        path.canonicalize().unwrap().to_str().unwrap().trim_start_matches(r"\\?\").to_owned()
    }

    fn settings(&self, tts: &str, asr: &str) -> Value {
        let row = |model: String| json!({ "model": model, "vad_model": "", "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false });
        let tts = if tts.is_empty() { String::new() } else { self.gguf(tts) };
        let asr = if asr.is_empty() { String::new() } else { self.gguf(asr) };
        json!({ "version": 1, "profiles": { "japanese": row(tts), "multilingual": row(String::new()), "asr": row(asr) } })
    }
}

fn start(bundle: &Bundle, settings: Value) -> Ui {
    let ui = Ui::with(Setup { services: bundle.services(), saved: Some(json!({ "SPEECH_SERVER_SETTINGS": settings })), ..Setup::default() });
    ui.ready();
    ui
}

/// Polls the state until the check ends.
fn finished(ui: &Ui) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let state = ui.ok("/get/data/gpu_check_state", None);
        if state["state"] == "idle" && !state["outcome"].is_null() {
            return state;
        }
        assert!(Instant::now() < deadline, "the check did not end: {state}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn runs<'a>(report: &'a Value, step: &str) -> &'a Vec<Value> {
    report[step]["runs"].as_array().unwrap_or_else(|| panic!("{step}: {}", report[step]))
}

#[test]
fn a_check_measures_each_device_and_reports_numbers_only() {
    let bundle = Bundle::new();
    let models = Models::new();
    let ui = start(&bundle, models.settings("tts", "asr"));
    assert_eq!(ui.ok("/get/data/gpu_check_state", None)["state"], "idle");
    let started = ui.ok("/run/start_gpu_check", None);
    assert_eq!(started.as_object().map(|o| o.len()), Some(2), "a start answers only its state: {started}");
    let state = finished(&ui);
    assert_eq!((state["outcome"].clone(), state["error_code"].clone()), (json!("done"), Value::Null));
    let report = &state["report"];
    assert_eq!((report["report"].clone(), report["schema"].clone()), (json!("astarot-gpu-check"), json!(1)));
    let devices: Vec<&str> = report["devices"].as_array().unwrap().iter().map(|d| d["device"].as_str().unwrap()).collect();
    assert_eq!(devices, ["cpu", "Vulkan0"]);
    assert_eq!(report["devices"][1]["name"], "Fake GPU");

    // TTS on the GPU first, then the CPU; each says where speech.cpp loaded the model.
    let tts = runs(report, "tts");
    assert_eq!(report["tts"]["model"], "Fake-TTS Q8_0");
    assert_eq!(tts.iter().map(|r| (r["device"].as_str().unwrap(), r["ran_on"].as_str().unwrap(), r["ok"].as_bool().unwrap())).collect::<Vec<_>>(), [("Vulkan0", "Vulkan0", true), ("cpu", "CPU", true)], "{}", report["tts"]);
    assert_eq!((tts[0]["audio_s"].clone(), tts[0]["rtfx"].clone(), tts[0]["first_audio_s"].clone()), (json!(0.5), json!(10.0), json!(0.02)));

    // ASR of the GPU's audio on every device, compared with the sentence and the CPU's text.
    let asr = runs(report, "asr");
    assert_eq!(report["asr"]["audio_from"], "Vulkan0");
    assert_eq!(asr.iter().map(|r| r["device"].as_str().unwrap()).collect::<Vec<_>>(), ["cpu", "Vulkan0"]);
    for run in asr {
        assert_eq!((run["cer_to_sentence"].clone(), run["cer_to_cpu"].clone(), run["ok"].clone()), (json!(0.0), json!(0.0), json!(true)), "{run}");
    }

    // The text shown and sent is the report itself; it holds no path, text or name.
    let text = state["text"].as_str().unwrap();
    assert_eq!(serde_json::from_str::<Value>(text).unwrap(), *report);
    for absent in ["someone", "ユーザー", "天気", "weather", ".gguf", ".wav", "vrct-gpu-check", std::env::temp_dir().to_str().unwrap()] {
        assert!(!text.contains(absent), "the report holds {absent:?}: {text}");
    }
    // The temporary folder is removed at the end (the unit test `each_check_has_its_own_folder`).
    ui.stop();
}

#[test]
fn a_device_that_fails_is_reported_with_its_code_and_the_rest_goes_on() {
    let bundle = Bundle::new();
    let models = Models::new();
    let ui = start(&bundle, models.settings("tts-gpufail", "asr-garble"));
    ui.ok("/run/start_gpu_check", None);
    let state = finished(&ui);
    let report = &state["report"];
    let tts = runs(report, "tts");
    assert_eq!((tts[0]["device"].clone(), tts[0]["ok"].clone(), tts[0]["error"].clone()), (json!("Vulkan0"), json!(false), json!("out_of_memory")));
    assert_eq!(tts[1]["ok"], true);
    // The CPU spoke, so its audio is the one heard.
    assert_eq!(report["asr"]["audio_from"], "cpu");
    let asr = runs(report, "asr");
    assert_eq!(asr[0]["cer_to_sentence"], 0.0);
    assert!(asr[1]["cer_to_cpu"].as_f64().unwrap() > 0.5, "a GPU that hears it wrong shows: {}", asr[1]);
    assert!(!state["text"].as_str().unwrap().contains("allocateMemory"), "only the code, not the message");
    ui.stop();
}

#[test]
fn without_models_the_steps_say_why_they_did_not_run() {
    let bundle = Bundle::new();
    let models = Models::new();
    let ui = start(&bundle, models.settings("", "asr"));
    ui.ok("/run/start_gpu_check", None);
    let state = finished(&ui);
    assert_eq!(state["outcome"], "done");
    assert_eq!(state["report"]["tts"], json!({ "skipped": "no_model" }));
    assert_eq!(state["report"]["asr"], json!({ "skipped": "no_audio" }));
    assert!(state["report"]["hardware"].is_object());
    ui.stop();

    let ui = start(&bundle, models.settings("tts-unreadable", ""));
    ui.ok("/run/start_gpu_check", None);
    let state = finished(&ui);
    assert_eq!(state["report"]["tts"], json!({ "skipped": "model_unreadable" }));
    assert_eq!(state["report"]["asr"], json!({ "skipped": "no_model" }));
    ui.stop();
}

#[test]
fn a_check_stops_when_asked_and_only_one_runs_at_a_time() {
    let bundle = Bundle::new();
    let models = Models::new();
    let ui = start(&bundle, models.settings("tts-slow", "asr"));
    let first = ui.ok("/run/start_gpu_check", None);
    let again = ui.ok("/run/start_gpu_check", None);
    assert_eq!(first["run"], again["run"], "a second start joins the one that runs");
    let asked = Instant::now();
    std::thread::sleep(Duration::from_millis(300));
    ui.ok("/run/stop_gpu_check", None);
    let state = finished(&ui);
    assert_eq!((state["outcome"].clone(), state["report"].clone()), (json!("cancelled"), Value::Null));
    assert!(asked.elapsed() < Duration::from_secs(15), "the slow run was ended: {:?}", asked.elapsed());
    ui.stop();
}

#[test]
fn without_a_speech_build_the_check_fails_with_its_code() {
    let models = Models::new();
    let services = Services {
        speech_server_launch: Arc::new(|_| Launch::fixed(std::env::temp_dir().join("no-such-speech-build.exe"))),
        ..Setup::default().services
    };
    let ui = Ui::with(Setup { services, saved: Some(json!({ "SPEECH_SERVER_SETTINGS": models.settings("tts", "asr") })), ..Setup::default() });
    ui.ready();
    ui.ok("/run/start_gpu_check", None);
    let state = finished(&ui);
    assert_eq!((state["outcome"].clone(), state["error_code"].clone()), (json!("failed"), json!("gpu_check_devices_unreadable")));
    ui.stop();
}
