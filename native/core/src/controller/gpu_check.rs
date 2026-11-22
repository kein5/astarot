//! The GPU check (#288, decision 6): a report of how the bundled speech.cpp runs on this PC's
//! CPU and each of its GPUs, for the user to read and, if they choose, send as a GitHub issue.
//! It is how AMD results are gathered: the project has no AMD GPU to measure on.
//!
//! - It runs only when the user starts it, and sends nothing: the report goes back to the UI,
//!   which shows all of it before anything leaves the PC. Telemetry is not involved.
//! - It uses the models already in the settings (`SPEECH_SERVER_SETTINGS`): the TTS model of the
//!   Japanese profile (else the multilingual one) and the ASR model. It never downloads, never
//!   opens a microphone or plays a sound, and never touches the running servers: each step is a
//!   run of the `speech` command line (`speech tts`, `speech asr`), which ends with the step.
//! - TTS speaks one fixed sentence on each device into a temporary WAVE file. ASR then
//!   transcribes the audio of the first device that spoke it on each device, and the text is
//!   compared with the sentence and with the CPU's text. The texts and the audio stay in this
//!   module and the temporary folder, which is removed at the end; the report holds numbers only.
//! - The report holds the app and OS versions, the hardware as the usage events describe it
//!   (CPU and GPU names, rounded memory, GPU driver versions), the speech.cpp devices, the
//!   models' own names, and per run the device asked for, the device speech.cpp says it used,
//!   timings, error rates and failure codes. No file path, user or host name, text or audio.
//! - The log says only that a check started and how it ended.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Map, Value, json};
use vrct_ops::telemetry::hardware::{self, NAME_LIMIT, ascii_text, memory_step};
use vrct_speech_server::builds::{self, Builds};
use vrct_speech_server::check::{self, Run, char_error_rate};
use vrct_speech_server::devices::{self, Environment, not_a_compute_gpu};
use vrct_speech_server::{Profile, bundle};

use super::routes::{Builder, OPEN};
use super::{Core, ok};

/// The report's format, raised when a field changes meaning.
pub const SCHEMA: u64 = 1;
/// At most this many GPUs are run (the usage events keep as many).
const MAX_GPUS: usize = hardware::MAX_GPUS;
/// The sentences, one per language, short so that the CPU speaks them in reasonable time.
const SENTENCES: [(&str, &str); 2] = [("ja", "今日はいい天気ですね。"), ("en", "The weather is nice today.")];
const SEED: &str = "7";
/// How long a run may take: speaking on a slow CPU is the longest.
const TTS_CPU_TIMEOUT: Duration = Duration::from_secs(240);
const TTS_GPU_TIMEOUT: Duration = Duration::from_secs(120);
const ASR_TIMEOUT: Duration = Duration::from_secs(120);

/// The failure codes of the check as a whole (`error_code` in the state).
pub const NO_SPEECH_BUILD: &str = "gpu_check_no_speech_build";
pub const NO_DEVICES: &str = "gpu_check_devices_unreadable";
pub const FAILED: &str = "gpu_check_failed";

#[derive(Default)]
struct State {
    run: u64,
    running: bool,
    step: Option<&'static str>,
    /// How the last check ended: `done`, `cancelled` or `failed`.
    outcome: Option<&'static str>,
    error_code: Option<&'static str>,
    report: Option<Value>,
    closed: bool,
}

/// The check in progress and the report of the last one.
#[derive(Default)]
pub struct GpuCheck {
    state: Mutex<State>,
    cancel: Arc<AtomicBool>,
}

impl GpuCheck {
    /// `{state, run, step, outcome, error_code, report, text}`. `text` is the report exactly as
    /// the UI shows it and as it is sent if the user chooses to.
    pub fn status(&self) -> Value {
        let state = self.state.lock().unwrap();
        let text = state.report.as_ref().and_then(|report| serde_json::to_string_pretty(report).ok());
        json!({
            "state": if state.running { "running" } else { "idle" },
            "run": state.run,
            "step": state.step,
            "outcome": state.outcome,
            "error_code": state.error_code,
            "report": state.report,
            "text": text,
        })
    }

    /// Ends the check in progress at its next step; the run of the command line is ended too.
    pub fn stop(&self) {
        if self.state.lock().unwrap().running {
            self.cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Ends the check in progress and refuses new ones (the app is closing).
    pub fn close(&self) {
        self.state.lock().unwrap().closed = true;
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Marks a new check as running; None when one runs already or the app is closing.
    fn begin(&self) -> Option<u64> {
        let mut state = self.state.lock().unwrap();
        if state.running || state.closed {
            return None;
        }
        state.run += 1;
        state.running = true;
        state.step = Some("environment");
        state.outcome = None;
        state.error_code = None;
        state.report = None;
        self.cancel.store(false, Ordering::SeqCst);
        Some(state.run)
    }

    fn set_step(&self, step: &'static str) {
        self.state.lock().unwrap().step = Some(step);
    }

    fn finish(&self, outcome: &'static str, error_code: Option<&'static str>, report: Option<Value>) {
        let mut state = self.state.lock().unwrap();
        state.running = false;
        state.step = None;
        state.outcome = Some(outcome);
        state.error_code = error_code;
        state.report = report;
    }

    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
}

/// What the check needs from the app, gathered before it starts.
pub(crate) struct Inputs {
    pub app_version: String,
    pub builds: Builds,
    pub environment: Environment,
    pub speech_settings: Value,
    /// The translation devices the settings offer (`SELECTABLE_COMPUTE_DEVICE_LIST`).
    pub translation_devices: Value,
    /// The profiles whose bundled server runs during the check.
    pub busy: Vec<&'static str>,
}

/// One device a step runs on: `cpu` or a Vulkan device of the list.
#[derive(Clone, Debug, PartialEq)]
struct Target {
    device: String,
    kind: String,
    name: Option<String>,
    memory_gb: Option<u64>,
}

/// The CPU, then each GPU speech.cpp lists that can compute (no software rasterizer, no
/// Direct3D 12 mapping layer), at most [`MAX_GPUS`].
fn targets(rows: &[Value]) -> Vec<Target> {
    let mut targets = vec![Target { device: "cpu".into(), kind: "cpu".into(), name: None, memory_gb: None }];
    for row in rows {
        let (Some(device), Some(kind)) = (row.get("name").and_then(Value::as_str), row.get("kind").and_then(Value::as_str)) else { continue };
        let description = row.get("description").and_then(Value::as_str).unwrap_or("");
        if !matches!(kind, "gpu" | "igpu") || !vrct_speech_server::settings::is_named_gpu(device) || not_a_compute_gpu(description) {
            continue;
        }
        let name = ascii_text(description, NAME_LIMIT);
        targets.push(Target {
            device: device.to_owned(),
            kind: kind.to_owned(),
            name: (!name.is_empty()).then_some(name),
            memory_gb: row.get("memory_total").and_then(Value::as_u64).filter(|total| *total > 0).map(memory_step),
        });
        if targets.len() > MAX_GPUS {
            break;
        }
    }
    targets
}

/// A number as the report keeps it: three decimals.
fn round(value: f64) -> Value {
    json!((value * 1000.0).round() / 1000.0)
}

/// The model's own name and weight type, as `speech info` reads them from the file.
fn model_label(info: &Value) -> String {
    let name = ascii_text(info.get("name").and_then(Value::as_str).unwrap_or(""), NAME_LIMIT);
    let weights = ascii_text(info.get("weight_type").and_then(Value::as_str).unwrap_or(""), 16);
    match (name.is_empty(), weights.is_empty()) {
        (true, _) => "unknown".into(),
        (false, true) => name,
        (false, false) => format!("{name} {weights}"),
    }
}

/// Whether the model takes a request option (`--language`, `--seed`): speech.cpp refuses a
/// command line with an option the model does not have.
fn has_option(info: &Value, name: &str) -> bool {
    info.get("options").and_then(Value::as_array).into_iter().flatten().any(|option| option.get("name").and_then(Value::as_str) == Some(name))
}

fn languages(info: &Value) -> Vec<String> {
    info.get("languages").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect()
}

/// The sentence to speak: Japanese when the model speaks it, else English; None when it speaks
/// neither. A model that names no language is taken to speak both.
fn sentence(tts_languages: &[String]) -> Option<(&'static str, &'static str)> {
    SENTENCES.iter().copied().find(|(language, _)| tts_languages.is_empty() || tts_languages.iter().any(|l| l == language))
}

/// The voice arguments: the model's first named voice, else the profile's voice file.
fn voice_args(info: &Value, voice_file: &str) -> Option<Vec<OsString>> {
    let plain = |name: &str| !name.is_empty() && name.len() <= 64 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b));
    let named = info.get("voices").and_then(Value::as_array).into_iter().flatten().filter_map(|voice| voice.get("name")?.as_str()).find(|name| plain(name));
    if let Some(name) = named {
        return Some(vec!["--voice".into(), name.into()]);
    }
    let takes_files = info.get("voice_files").and_then(Value::as_bool).unwrap_or(false);
    if takes_files && !voice_file.is_empty() && Path::new(voice_file).is_file() {
        let mut add = OsString::from("check=");
        add.push(voice_file);
        return Some(vec!["--add-voice".into(), add, "--voice".into(), "check".into()]);
    }
    None
}

/// What one run of the command line tells: the device used, timings and the failure code.
fn run_row(target: &Target, run: &std::io::Result<Run>) -> Map<String, Value> {
    let mut row = Map::new();
    row.insert("device".into(), json!(target.device));
    match run {
        Err(_) => {
            row.insert("ok".into(), json!(false));
            row.insert("error".into(), json!("launch_failed"));
        }
        Ok(run) => {
            row.insert("ok".into(), json!(run.succeeded()));
            if let Some(loaded) = run.loaded() {
                row.insert("ran_on".into(), json!(loaded.device));
                row.insert("load_s".into(), round(loaded.seconds));
            }
            if let Some(timing) = run.timing() {
                row.insert("audio_s".into(), round(timing.audio_seconds));
                row.insert("work_s".into(), round(timing.seconds));
                if let Some(rtfx) = timing.rtfx {
                    row.insert("rtfx".into(), round(rtfx));
                }
                if let Some(first) = timing.first_audio_seconds {
                    row.insert("first_audio_s".into(), round(first));
                }
            }
            row.insert("total_s".into(), round(run.seconds));
            let error = if run.timed_out {
                Some("timed_out".to_owned())
            } else if run.cancelled {
                Some("cancelled".to_owned())
            } else if !run.succeeded() {
                Some(run.failure().unwrap_or_else(|| run.code.map_or("ended".into(), |code| format!("exit_{code}"))))
            } else {
                None
            };
            if let Some(error) = error {
                row.insert("error".into(), json!(error));
            }
        }
    }
    row
}

/// The build and `--device` a target runs with.
fn choice(builds: &Builds, target: &Target) -> Option<(PathBuf, String)> {
    builds::choose(builds, &target.device, |_| None).ok().map(|choice| (choice.binary, choice.device))
}

fn args(parts: &[&str]) -> Vec<OsString> {
    parts.iter().map(OsString::from).collect()
}

/// A temporary folder of its own for one check's files, removed when dropped.
struct Scratch(PathBuf);

impl Scratch {
    /// `vrct-gpu-check-<process>-<n>` in the temporary folder, `n` counting the checks of this
    /// process (a test process runs several cores). A folder of that name left by a process
    /// that ended with the same id is replaced.
    fn new() -> std::io::Result<Self> {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let n = NEXT.fetch_add(1, Ordering::SeqCst);
        let folder = std::env::temp_dir().join(format!("vrct-gpu-check-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder)?;
        Ok(Self(folder))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The check itself. Returns the report, or the failure code of the check as a whole.
fn measure(check: &GpuCheck, inputs: &Inputs) -> Result<Value, &'static str> {
    let cancel = Arc::clone(&check.cancel);
    let listing = inputs.builds.for_listing(|binary| devices::device_rows(binary, &inputs.environment).is_some()).ok_or(NO_SPEECH_BUILD)?;
    let rows = devices::device_rows(&listing, &inputs.environment).ok_or(NO_DEVICES)?;
    let hardware = hardware::collect(Some(&listing), Duration::from_secs(15));
    let (os, os_version) = vrct_ops::telemetry::client::os_and_version();
    let targets = targets(&rows);
    let mut report = Map::new();
    report.insert("report".into(), json!("astarot-gpu-check"));
    report.insert("schema".into(), json!(SCHEMA));
    report.insert("app_version".into(), json!(ascii_text(&inputs.app_version, 32)));
    report.insert("os".into(), json!(os));
    report.insert("os_version".into(), json!(os_version.map(|v| ascii_text(&v, 32))));
    report.insert("hardware".into(), serde_json::to_value(&hardware).unwrap_or(Value::Null));
    let mut built = Vec::new();
    if inputs.builds.vulkan.is_some() {
        built.push("vulkan");
    }
    if inputs.builds.cpu.is_some() {
        built.push("cpu");
    }
    report.insert("speechcpp".into(), json!({ "version": bundle::VERSION, "builds": built }));
    report.insert(
        "devices".into(),
        Value::Array(targets.iter().map(|t| json!({ "device": t.device, "kind": t.kind, "name": t.name, "memory_gb": t.memory_gb })).collect()),
    );
    report.insert("busy".into(), json!(inputs.busy));
    let translation: Vec<Value> = inputs
        .translation_devices
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|device| device.get("device")?.as_str())
        .map(|device| json!(ascii_text(device, 32)))
        .collect();
    report.insert("translation".into(), json!({ "devices": translation, "measured": false }));
    if check.cancelled() {
        return Err("cancelled");
    }

    let scratch = Scratch::new().map_err(|_| FAILED)?;
    let profiles = &inputs.speech_settings["profiles"];
    let file = |profile: Profile, field: &str| {
        profiles[profile.name()][field].as_str().filter(|path| !path.is_empty() && Path::new(path).is_file()).map(PathBuf::from)
    };

    // TTS: the fixed sentence on every device; the first to speak gives ASR its audio.
    check.set_step("tts");
    let tts_profile = [Profile::Japanese, Profile::Multilingual].into_iter().find(|profile| file(*profile, "model").is_some());
    let mut audio: Option<(PathBuf, &'static str, &'static str, String)> = None;
    let tts = match tts_profile {
        None => json!({ "skipped": "no_model" }),
        Some(profile) => {
            let model = file(profile, "model").expect("found above");
            let voice_file = profiles[profile.name()]["voice_file"].as_str().unwrap_or("").to_owned();
            match check::info(&listing, &inputs.environment, &model, &cancel) {
                None => json!({ "skipped": "model_unreadable" }),
                Some(info) => match (sentence(&languages(&info)), voice_args(&info, &voice_file)) {
                    (None, _) => json!({ "model": model_label(&info), "skipped": "unsupported_language" }),
                    (_, None) => json!({ "model": model_label(&info), "skipped": "no_voice" }),
                    (Some((language, text)), Some(voice)) => {
                        let mut runs = Vec::new();
                        // The GPUs first: on a slow CPU speaking takes long, and the first GPU's
                        // audio is then ready for ASR.
                        for target in targets.iter().skip(1).chain(targets.iter().take(1)) {
                            if check.cancelled() {
                                return Err("cancelled");
                            }
                            let Some((binary, device)) = choice(&inputs.builds, target) else { continue };
                            let wave = scratch.0.join(format!("tts-{}.wav", target.device));
                            let mut command = vec![OsString::from("tts"), model.clone().into_os_string(), "-o".into(), wave.clone().into_os_string()];
                            command.extend(args(&["--device", &device]));
                            if has_option(&info, "seed") {
                                command.extend(args(&["--seed", SEED]));
                            }
                            if has_option(&info, "language") {
                                command.extend(args(&["--language", language]));
                            }
                            command.extend(voice.iter().cloned());
                            command.push("--".into());
                            command.push(text.into());
                            let timeout = if target.device == "cpu" { TTS_CPU_TIMEOUT } else { TTS_GPU_TIMEOUT };
                            let outcome = check::run(&binary, &inputs.environment, &command, timeout, &cancel);
                            let spoke = outcome.as_ref().is_ok_and(Run::succeeded) && wave.is_file();
                            if spoke && audio.is_none() {
                                audio = Some((wave, language, text, target.device.clone()));
                            }
                            runs.push(Value::Object(run_row(target, &outcome)));
                        }
                        json!({ "model": model_label(&info), "language": language, "runs": runs })
                    }
                },
            }
        }
    };
    report.insert("tts".into(), tts);

    // ASR: the same audio on every device, compared with the sentence and with the CPU's text.
    check.set_step("asr");
    let asr = match (file(Profile::Asr, "model"), &audio) {
        (None, _) => json!({ "skipped": "no_model" }),
        (Some(_), None) => json!({ "skipped": "no_audio" }),
        (Some(model), Some((wave, language, text, from))) => match check::info(&listing, &inputs.environment, &model, &cancel) {
            None => json!({ "skipped": "model_unreadable" }),
            Some(info) => {
                let heard = languages(&info);
                if !heard.is_empty() && !heard.iter().any(|l| l == language) {
                    json!({ "model": model_label(&info), "skipped": "unsupported_language" })
                } else {
                    let mut runs = Vec::new();
                    let mut cpu_text: Option<String> = None;
                    let mut texts: Vec<(usize, String)> = Vec::new();
                    for target in &targets {
                        if check.cancelled() {
                            return Err("cancelled");
                        }
                        let Some((binary, device)) = choice(&inputs.builds, target) else { continue };
                        let mut command = vec![OsString::from("asr"), model.clone().into_os_string()];
                        command.extend(args(&["--format", "json", "--device", &device]));
                        if has_option(&info, "language") {
                            command.extend(args(&["--language", language]));
                        }
                        command.push(wave.clone().into_os_string());
                        let outcome = check::run(&binary, &inputs.environment, &command, ASR_TIMEOUT, &cancel);
                        let mut row = run_row(target, &outcome);
                        let heard_text = outcome
                            .as_ref()
                            .ok()
                            .filter(|run| run.succeeded())
                            .and_then(|run| String::from_utf8_lossy(&run.stdout).lines().find_map(|line| serde_json::from_str::<Value>(line).ok()))
                            .and_then(|answer| answer.get("text").and_then(Value::as_str).map(str::to_owned));
                        if let Some(heard_text) = heard_text {
                            row.insert("cer_to_sentence".into(), round(char_error_rate(text, &heard_text)));
                            if target.device == "cpu" {
                                cpu_text = Some(heard_text.clone());
                            }
                            texts.push((runs.len(), heard_text));
                        }
                        runs.push(row);
                    }
                    // Against the CPU's text, once it is known (the CPU runs first).
                    if let Some(cpu_text) = &cpu_text {
                        for (index, heard_text) in &texts {
                            runs[*index].insert("cer_to_cpu".into(), round(char_error_rate(cpu_text, heard_text)));
                        }
                    }
                    let runs: Vec<Value> = runs.into_iter().map(Value::Object).collect();
                    json!({ "model": model_label(&info), "language": language, "audio_from": from, "runs": runs })
                }
            }
        },
    };
    report.insert("asr".into(), asr);
    drop(scratch);
    Ok(Value::Object(report))
}

impl Core {
    pub(crate) fn gpu_check_inputs(&self) -> Inputs {
        let (builds, environment) = self.speech.check_builds();
        let busy = Profile::ALL.iter().filter(|profile| self.speech.is_running(**profile)).map(|profile| profile.name()).collect();
        Inputs {
            app_version: self.config().environment().version.clone(),
            builds,
            environment,
            speech_settings: self.config().get("SPEECH_SERVER_SETTINGS"),
            translation_devices: self.config().get("SELECTABLE_COMPUTE_DEVICE_LIST"),
            busy,
        }
    }

    /// Starts a check on its own thread unless one runs; answers the state at once.
    fn start_gpu_check(self: &Arc<Self>) -> Value {
        if self.gpu_check.begin().is_none() {
            return self.gpu_check.status();
        }
        self.step("GPU check: started");
        let core = Arc::clone(self);
        let started = std::thread::Builder::new().name("gpu_check".into()).spawn(move || {
            let inputs = core.gpu_check_inputs();
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| measure(&core.gpu_check, &inputs)));
            let (end, code, report) = match outcome {
                Ok(Ok(report)) => ("done", None, Some(report)),
                Ok(Err("cancelled")) => ("cancelled", None, None),
                Ok(Err(code)) => ("failed", Some(code), None),
                Err(_) => ("failed", Some(FAILED), None),
            };
            core.log().step("GPU check: ended", Some(&json!({ "outcome": end, "error_code": code })));
            core.gpu_check.finish(end, code, report);
        });
        if started.is_err() {
            self.gpu_check.finish("failed", Some(FAILED), None);
        }
        self.gpu_check.status()
    }

    pub(crate) fn close_gpu_check(&self) {
        self.gpu_check.close();
    }
}

/// `{state, run}`: what a start or a stop answers. The report comes only with the polled state,
/// which the log leaves out.
fn brief(status: &Value) -> Value {
    json!({ "state": status["state"], "run": status["run"] })
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/get/data/gpu_check_state", OPEN, |core, _| ok(core.gpu_check.status()));
    b.with("/run/start_gpu_check", OPEN, |core, _| ok(brief(&core.start_gpu_check())));
    b.with("/run/stop_gpu_check", OPEN, |core, _| {
        core.gpu_check.stop();
        ok(brief(&core.gpu_check.status()))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_targets_are_the_cpu_and_the_gpus_that_compute() {
        let rows = vec![
            json!({ "name": "Vulkan0", "description": "Intel(R) Iris(R) Xe Graphics", "kind": "igpu", "memory_total": 17087799296u64 }),
            json!({ "name": "Vulkan1", "description": "NVIDIA GeForce RTX 3060 Ti", "kind": "gpu", "memory_total": 8638169088u64 }),
            json!({ "name": "Vulkan2", "description": "Microsoft Direct3D12 (NVIDIA GeForce RTX 3060 Ti)", "kind": "gpu" }),
            json!({ "name": "Vulkan3", "description": "llvmpipe (LLVM 19)", "kind": "igpu" }),
            json!({ "name": "CPU", "description": "12th Gen Intel(R) Core(TM) i7-1255U", "kind": "cpu" }),
        ];
        let found = targets(&rows);
        let devices: Vec<&str> = found.iter().map(|t| t.device.as_str()).collect();
        assert_eq!(devices, ["cpu", "Vulkan0", "Vulkan1"]);
        assert_eq!(found[1].name.as_deref(), Some("Intel(R) Iris(R) Xe Graphics"));
        assert_eq!((found[1].memory_gb, found[2].memory_gb), (Some(16), Some(8)));
    }

    #[test]
    fn at_most_four_gpus_are_run() {
        let rows: Vec<Value> = (0..8).map(|i| json!({ "name": format!("Vulkan{i}"), "description": "AMD Radeon", "kind": "gpu" })).collect();
        assert_eq!(targets(&rows).len(), 1 + MAX_GPUS);
    }

    #[test]
    fn the_sentence_and_voice_follow_the_model() {
        assert_eq!(sentence(&["ja".into()]).map(|s| s.0), Some("ja"));
        assert_eq!(sentence(&["en".into(), "ja".into()]).map(|s| s.0), Some("ja"));
        assert_eq!(sentence(&["en".into()]).map(|s| s.0), Some("en"));
        assert_eq!(sentence(&[]).map(|s| s.0), Some("ja"));
        assert_eq!(sentence(&["de".into()]), None);
        let named = json!({ "voices": [{ "name": "none" }], "voice_files": true });
        assert_eq!(voice_args(&named, ""), Some(args(&["--voice", "none"])));
        let odd = json!({ "voices": [{ "name": "a b" }], "voice_files": false });
        assert_eq!(voice_args(&odd, ""), None);
        let files = json!({ "voices": [], "voice_files": true });
        assert_eq!(voice_args(&files, ""), None);
        let file = std::env::current_exe().unwrap();
        let mut add = OsString::from("check=");
        add.push(&file);
        assert_eq!(voice_args(&files, file.to_str().unwrap()), Some(vec!["--add-voice".into(), add, "--voice".into(), "check".into()]));
    }

    #[test]
    fn a_model_is_named_by_what_its_file_says() {
        assert_eq!(model_label(&json!({ "name": "Irodori-TTS-v4.1-Small-MF", "weight_type": "Q8_0" })), "Irodori-TTS-v4.1-Small-MF Q8_0");
        assert_eq!(model_label(&json!({ "name": "モデル" })), "unknown");
        assert_eq!(model_label(&json!({})), "unknown");
    }

    #[test]
    fn each_check_has_its_own_folder_and_it_is_removed() {
        let (first, second) = (Scratch::new().unwrap(), Scratch::new().unwrap());
        assert_ne!(first.0, second.0);
        std::fs::write(first.0.join("tts-cpu.wav"), b"audio").unwrap();
        let folder = first.0.clone();
        drop(first);
        assert!(!folder.exists());
        assert!(second.0.is_dir());
    }

    #[test]
    fn the_state_holds_the_report_and_its_text() {
        let check = GpuCheck::default();
        assert_eq!(check.status()["state"], "idle");
        assert_eq!(check.begin(), Some(1));
        assert_eq!(check.begin(), None, "one at a time");
        assert_eq!(check.status()["state"], "running");
        check.finish("done", None, Some(json!({ "schema": SCHEMA })));
        let status = check.status();
        assert_eq!((status["state"].clone(), status["outcome"].clone()), (json!("idle"), json!("done")));
        assert_eq!(status["text"], "{\n  \"schema\": 1\n}");
        check.close();
        assert_eq!(check.begin(), None, "closed");
    }
}
