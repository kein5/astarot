//! The speech.cpp servers over the connection the UI uses (`tests/voice/test_speech_server_controls.py`
//! and the controller parts of the other speech server tests). A small stand-in executable
//! (`tests/fixture/fake_speech.rs`) plays speech.cpp: no model, GPU or audio.

mod common;

use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use vrct_core::controller::Services;
use vrct_core::controller::speech::Ended;
use vrct_speech_server::Profile;
use vrct_speech_server::server::Launch;

const FAKE: &str = env!("CARGO_BIN_EXE_fake-speech-core");

fn fake_services() -> Services {
    Services {
        speech_server_launch: Arc::new(|_| {
            let mut launch = Launch::fixed(FAKE);
            launch.start_timeout = Duration::from_secs(10);
            launch
        }),
        ..common::Setup::default().services
    }
}

/// Model files in a folder of their own, and the markers the stand-in leaves next to them.
struct Models {
    dir: tempfile::TempDir,
}

impl Models {
    fn new() -> Self {
        Self { dir: tempfile::tempdir().unwrap() }
    }

    fn gguf(&self, name: &str) -> String {
        let path = self.dir.path().join(format!("{name}.gguf"));
        std::fs::write(&path, b"GGUF\0\0\0\0\0\0\0\0").unwrap();
        path.canonicalize().unwrap().to_str().unwrap().to_owned()
    }

    /// Settings with `japanese` as the Japanese model and `asr` as the recognition model.
    fn settings(&self, japanese: &str, asr: &str) -> Value {
        let row = |model: &str| json!({ "model": model, "vad_model": "", "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false });
        let mut asr_row = row(&self.gguf(asr));
        asr_row["vad_model"] = json!(self.gguf("vad"));
        json!({ "version": 1, "profiles": { "japanese": row(&self.gguf(japanese)), "multilingual": row(""), "asr": asr_row } })
    }

    fn marker(&self, name: &str, suffix: &str) -> PathBuf {
        self.dir.path().join(format!("{name}.gguf{suffix}"))
    }

    /// Lets a gated stand-in print its ready line, or a dying one exit.
    fn trigger(&self, name: &str, suffix: &str) {
        std::fs::write(self.marker(name, suffix), b"").unwrap();
    }

    /// Whether any server was launched with a model of this folder.
    fn launched(&self) -> bool {
        std::fs::read_dir(self.dir.path()).unwrap().any(|entry| entry.unwrap().path().to_string_lossy().ends_with(".started"))
    }
}

fn state(ui: &Ui) -> Value {
    ui.ok("/get/data/speech_server_state", None)
}

/// Polls the state as the Settings page does until `done` holds for it.
fn wait_state(ui: &Ui, what: &str, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + common::TIMEOUT;
    loop {
        let current = state(ui);
        if done(&current) {
            return current;
        }
        assert!(Instant::now() < deadline, "no {what}; last state: {current}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn start(ui: &Ui, profile: &str, generation: &Value) -> Value {
    ui.request("/run/start_speech_server", Some(json!({ "profile": profile, "generation": generation })))
}

/// The error codes the usage events heard of, from every test in this file.
fn reported() -> &'static Mutex<Vec<String>> {
    static CODES: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    CODES.get_or_init(|| {
        vrct_core::errors::register_report_hook(Arc::new(|code| reported().lock().unwrap().push(code.to_string())));
        Mutex::new(Vec::new())
    })
}

fn ended(ui: &Ui) -> Arc<Mutex<Vec<Ended>>> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let heard = Arc::clone(&seen);
    ui.backend.core().speech_servers().on_end(Arc::new(move |end| heard.lock().unwrap().push(end)));
    seen
}

#[cfg(target_os = "linux")]
fn gone(marker: &Path) -> bool {
    let pid = std::fs::read_to_string(marker).unwrap();
    !Path::new(&format!("/proc/{}", pid.trim())).exists()
}

#[cfg(not(target_os = "linux"))]
fn gone(_marker: &Path) -> bool {
    // Windows: the child is in a job that ends with its owner; the state is what is checked.
    true
}

#[test]
fn restoring_and_saving_the_settings_never_starts_a_server() {
    let models = Models::new();
    let settings = models.settings("tts", "asr");
    let dir = tempfile::tempdir().unwrap();
    let ui = Ui::with(Setup { dir: Some(dir.path().to_path_buf()), services: fake_services(), ..Setup::default() });
    let snapshot = ui.ready();
    let defaults = snapshot["/get/data/speech_server_settings"].clone();
    assert_eq!(defaults["profiles"]["japanese"], json!({ "model": "", "vad_model": "", "diarization_model": "", "voice_file": "", "device": "auto", "low_latency": false }));
    assert_eq!(ui.ok("/set/data/speech_server_settings", Some(settings.clone())), settings);

    // An invalid change answers 400 and leaves the settings as they were.
    let mut running = settings.clone();
    running["running"] = json!(true);
    for invalid in [running, json!(null), json!({ "profiles": { "multilingual": { "low_latency": true } } })] {
        let answer = ui.request("/set/data/speech_server_settings", Some(invalid));
        assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "speech_server_settings_invalid"));
    }
    assert_eq!(ui.ok("/get/data/speech_server_settings", None), settings);
    assert_eq!(ui.ok("/run/shutdown", None), true);
    assert_eq!(ui.saved()["SPEECH_SERVER_SETTINGS"], settings);
    ui.stop();

    // The next start restores the choices and still runs nothing.
    let ui = Ui::with(Setup { dir: Some(dir.path().to_path_buf()), services: fake_services(), ..Setup::default() });
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/speech_server_settings"], settings);
    for profile in ["japanese", "multilingual", "asr"] {
        assert_eq!(snapshot["/get/data/speech_server_state"][profile]["state"], "stopped", "{profile}");
        assert_eq!(state(&ui)[profile], json!({ "state": "stopped", "base_url": null, "error_code": null, "generation": 0 }));
    }
    std::thread::sleep(Duration::from_millis(200));
    assert!(!models.launched());
    ui.stop();
}

#[test]
fn an_invalid_start_is_refused_and_never_launches() {
    let models = Models::new();
    let ui = Ui::with(Setup { services: fake_services(), ..Setup::default() });
    ui.ready();
    for payload in [
        json!(null),
        json!({}),
        json!({ "profile": "bad" }),
        json!({ "profile": [] }),
        json!({ "profile": "asr", "generation": true }),
        json!({ "profile": "asr", "generation": -1 }),
        json!({ "profile": "asr", "generation": 1.5 }),
        json!({ "profile": "asr", "generation": 0, "command": "bad" }),
    ] {
        let answer = ui.request("/run/start_speech_server", Some(payload.clone()));
        assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "speech_server_request_invalid"), "{payload}");
    }
    // A start needs local GGUF files.
    let answer = start(&ui, "asr", &json!(0));
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "speech_server_model_invalid"));
    let mut settings = models.settings("tts", "asr");
    let not_gguf = models.dir.path().join("model.bin");
    std::fs::write(&not_gguf, b"BAD!").unwrap();
    settings["profiles"]["japanese"]["model"] = json!(not_gguf.to_str().unwrap());
    ui.ok("/set/data/speech_server_settings", Some(settings));
    let answer = start(&ui, "japanese", &json!(0));
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "speech_server_model_invalid"));

    let answer = ui.request("/run/stop_speech_server", Some(json!({ "profile": "asr", "pid": 123 })));
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "speech_server_request_invalid"));
    std::thread::sleep(Duration::from_millis(200));
    assert!(!models.launched());
    assert!(["japanese", "multilingual", "asr"].iter().all(|p| state(&ui)[p]["state"] == "stopped"));
    ui.stop();
}

#[test]
fn a_start_prepares_then_becomes_ready_and_a_stop_invalidates_its_generation() {
    let models = Models::new();
    let ui = Ui::with(Setup { services: fake_services(), ..Setup::default() });
    ui.ready();
    let ends = ended(&ui);
    ui.ok("/set/data/speech_server_settings", Some(models.settings("tts_gate", "asr")));

    let answer = start(&ui, "japanese", &json!(0));
    assert_eq!(answer["status"], 200, "{answer}");
    assert_eq!(answer["result"]["japanese"]["state"], "preparing");
    assert_eq!(answer["result"]["japanese"]["generation"], 1);
    assert_eq!(answer["result"]["asr"]["state"], "stopped", "only the named profile starts");
    // While it prepares, another start is busy, and one decided on an older state is stale.
    let busy = start(&ui, "japanese", &json!(1));
    assert_eq!((busy["status"].clone(), error_code(&busy)), (json!(409), "speech_server_busy"));
    let stale = start(&ui, "japanese", &json!(0));
    assert_eq!((stale["status"].clone(), error_code(&stale)), (json!(409), "speech_server_stale_start"));
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(state(&ui)["japanese"]["state"], "preparing");

    models.trigger("tts_gate", ".go");
    let ready = wait_state(&ui, "ready server", |s| s["japanese"]["state"] == "ready");
    assert!(ready["japanese"]["base_url"].as_str().unwrap().starts_with("http://127.0.0.1:"), "{ready}");
    assert_eq!(ready["japanese"]["error_code"], Value::Null);
    let generation = ready["japanese"]["generation"].clone();

    // The Stop is answered at once, without waiting for the child, and takes the address away.
    let began = Instant::now();
    let stopped = ui.request("/run/stop_speech_server", Some(json!({ "profile": "japanese" })));
    assert!(began.elapsed() < Duration::from_secs(1), "{:?}", began.elapsed());
    assert_eq!(stopped["status"], 200);
    assert_eq!(stopped["result"]["japanese"]["base_url"], Value::Null);
    assert_eq!(stopped["result"]["japanese"]["generation"], generation.as_u64().unwrap() + 1);
    let stale = start(&ui, "japanese", &generation);
    assert_eq!((stale["status"].clone(), error_code(&stale)), (json!(409), "speech_server_stale_start"));
    wait_state(&ui, "stopped server", |s| s["japanese"]["state"] == "stopped");
    assert!(gone(&models.marker("tts_gate", ".started")));
    assert_eq!(*ends.lock().unwrap(), [Ended { profile: Profile::Japanese, run: Some(1), stopped: true }], "told once");

    // A restart is a new run on the generation the state shows now.
    let current = state(&ui)["japanese"]["generation"].clone();
    assert_eq!(start(&ui, "japanese", &current)["status"], 200);
    wait_state(&ui, "ready restart", |s| s["japanese"]["state"] == "ready");
    ui.stop();
}

#[test]
fn a_stop_during_preparation_cannot_be_undone_by_a_late_ready() {
    let models = Models::new();
    let ui = Ui::with(Setup { services: fake_services(), ..Setup::default() });
    ui.ready();
    ui.ok("/set/data/speech_server_settings", Some(models.settings("tts", "asr_gate")));
    assert_eq!(start(&ui, "asr", &json!(0))["status"], 200);
    let started = models.marker("asr_gate", ".started");
    let deadline = Instant::now() + common::TIMEOUT;
    while !started.exists() {
        assert!(Instant::now() < deadline, "the stand-in was not launched");
        std::thread::sleep(Duration::from_millis(20));
    }
    let stopped = ui.ok("/run/stop_speech_server", Some(json!({ "profile": "asr" })));
    assert_eq!(stopped["asr"]["generation"], 2);
    assert!(matches!(stopped["asr"]["state"].as_str(), Some("stopping" | "stopped")), "{stopped}");
    // The server would only now say it is ready.
    models.trigger("asr_gate", ".go");
    wait_state(&ui, "stopped server", |s| s["asr"]["state"] == "stopped");
    std::thread::sleep(Duration::from_millis(500));
    // The end of the stopped child moves the generation once more, as in Python's hub.
    assert_eq!(state(&ui)["asr"], json!({ "state": "stopped", "base_url": null, "error_code": null, "generation": 3 }));
    let stale = start(&ui, "asr", &json!(1));
    assert_eq!((stale["status"].clone(), error_code(&stale)), (json!(409), "speech_server_stale_start"));
    assert!(gone(&started));
    ui.stop();
}

#[test]
fn a_server_that_ends_on_its_own_shows_its_failure_and_is_reported() {
    let models = Models::new();
    let ui = Ui::with(Setup { services: fake_services(), ..Setup::default() });
    ui.ready();
    reported();
    let ends = ended(&ui);
    ui.ok("/set/data/speech_server_settings", Some(models.settings("tts_die", "asr_crash")));

    assert_eq!(start(&ui, "japanese", &json!(0))["status"], 200);
    wait_state(&ui, "ready server", |s| s["japanese"]["state"] == "ready");
    models.trigger("tts_die", ".die");
    let failed = wait_state(&ui, "failed server", |s| s["japanese"]["state"] == "failed");
    assert_eq!(failed["japanese"], json!({ "state": "failed", "base_url": null, "error_code": "speech_server_exited", "generation": 2 }));
    let deadline = Instant::now() + common::TIMEOUT;
    while ends.lock().unwrap().is_empty() {
        assert!(Instant::now() < deadline, "the end was not told");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(*ends.lock().unwrap(), [Ended { profile: Profile::Japanese, run: Some(1), stopped: false }]);
    assert!(reported().lock().unwrap().iter().any(|code| code == "speech_server_exited"));

    // A server that cannot start fails the same way; a failed one can be started again.
    assert_eq!(start(&ui, "asr", &json!(0))["status"], 200);
    let failed = wait_state(&ui, "failed start", |s| s["asr"]["state"] == "failed");
    assert_eq!(failed["asr"]["error_code"], "speech_server_exited");
    ui.ok("/set/data/speech_server_settings", Some(models.settings("tts", "asr")));
    assert_eq!(start(&ui, "asr", &failed["asr"]["generation"])["status"], 200);
    wait_state(&ui, "ready restart", |s| s["asr"]["state"] == "ready");
    ui.stop();
}

#[test]
fn shutdown_closes_the_owned_servers_and_refuses_a_new_start() {
    let models = Models::new();
    let ui = Ui::with(Setup { services: fake_services(), ..Setup::default() });
    ui.ready();
    ui.ok("/set/data/speech_server_settings", Some(models.settings("tts", "asr")));
    assert_eq!(start(&ui, "japanese", &json!(0))["status"], 200);
    assert_eq!(start(&ui, "asr", &json!(0))["status"], 200);
    wait_state(&ui, "ready servers", |s| s["japanese"]["state"] == "ready" && s["asr"]["state"] == "ready");

    assert_eq!(ui.ok("/run/shutdown", None), true);
    let after = state(&ui);
    for profile in ["japanese", "asr"] {
        assert_eq!(after[profile]["state"], "stopped", "{after}");
    }
    assert!(gone(&models.marker("tts", ".started")) && gone(&models.marker("asr", ".started")));
    let refused = start(&ui, "japanese", &after["japanese"]["generation"]);
    assert_eq!((refused["status"].clone(), error_code(&refused)), (json!(409), "speech_server_closed"));
    ui.stop();
}

#[test]
fn devices_are_listed_without_starting_a_model() {
    let models = Models::new();
    let ui = Ui::with(Setup { services: fake_services(), ..Setup::default() });
    let snapshot = ui.ready();
    let devices = json!({ "devices": [{ "name": "Vulkan0", "kind": "gpu", "label": "Fake GPU" }] });
    assert_eq!(snapshot["/get/data/speech_server_devices"], devices);
    ui.ok("/set/data/speech_server_settings", Some(models.settings("tts", "asr")));
    assert_eq!(ui.ok("/get/data/speech_server_devices", None), devices);
    assert!(["japanese", "multilingual", "asr"].iter().all(|p| state(&ui)[p]["state"] == "stopped"));
    assert!(!models.launched());
    ui.stop();

    // Without the bundled speech.cpp (it is checked against its pinned hash), nothing is listed.
    let ui = Ui::start();
    assert_eq!(ui.ready()["/get/data/speech_server_devices"], json!({ "devices": [] }));
    let answer = start(&ui, "japanese", &json!(0));
    assert_eq!(answer["status"], 400, "no model is set: {answer}");
    ui.stop();
}

#[test]
fn a_downloaded_model_replaces_a_setting_only_while_its_server_is_stopped() {
    let models = Models::new();
    let ui = Ui::with(Setup { services: fake_services(), ..Setup::default() });
    ui.ready();
    let settings = models.settings("tts", "asr");
    ui.ok("/set/data/speech_server_settings", Some(settings.clone()));
    let core = ui.backend.core();
    let servers = core.speech_servers();
    let model = settings["profiles"]["asr"]["model"].as_str().unwrap();
    let downloaded = models.gguf("asr_downloaded");

    assert_eq!(start(&ui, "asr", &json!(0))["status"], 200);
    assert!(servers.is_running(Profile::Asr));
    assert_eq!(servers.replace_model_file(core, Profile::Asr, "model", model, &downloaded), Err("model_target_busy"));
    ui.ok("/run/stop_speech_server", Some(json!({ "profile": "asr" })));
    wait_state(&ui, "stopped server", |s| s["asr"]["state"] == "stopped");
    assert!(!servers.is_running(Profile::Asr));
    assert_eq!(servers.replace_model_file(core, Profile::Asr, "model", "/another.gguf", &downloaded), Err("settings_changed"));
    assert_eq!(servers.replace_model_file(core, Profile::Asr, "model", model, &downloaded), Ok(()));
    assert_eq!(ui.ok("/get/data/speech_server_settings", None)["profiles"]["asr"]["model"], downloaded);
    ui.stop();
}
