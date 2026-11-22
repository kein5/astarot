//! Model downloads over the connection the UI uses (`tests/voice/test_model_download_controller.py`,
//! `test_model_download_policy.py`, the controller side of `test_model_downloads_ui.py`).
//!
//! Nothing leaves the PC: the manager gets a catalog of its own and a transport that serves
//! fixed bytes from memory, and the hardware probe finds no speech.cpp to run.

mod common;

use common::{Setup, Ui};
use serde_json::{Value, json};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use astarot_core::controller::Services;
use astarot_ops::downloads::catalog::{Artifact, CATALOG_VERSION, Model};
use astarot_ops::downloads::transport::{Body, Transport};
use astarot_ops::downloads::{Downloads, Error, Options};

const REVISION: &str = "0123456789abcdef0123456789abcdef01234567";
/// "GGUF" and 60 times "x", and its SHA-256.
const MODEL_SHA256: &str = "b5b15e9ef45baba45ea245a6986c481a123459e7d328ec8723b1f555d3584bbe";
/// "INDEX" and 27 times "y", and its SHA-256.
const INDEX_SHA256: &str = "e0166c866040b6d8e9ff1e42d7ff58d57d6b73c8b012206faf35f091b65129a1";
const SLOW_SIZE: u64 = 100_000;

fn model_bytes() -> Vec<u8> {
    [b"GGUF".as_slice(), &[b'x'; 60]].concat()
}

fn index_bytes() -> Vec<u8> {
    [b"INDEX".as_slice(), &[b'y'; 27]].concat()
}

fn artifact(filename: &str, size: u64, sha256: &str, role: &str) -> Artifact {
    Artifact { filename: filename.into(), size, sha256: sha256.into(), role: role.into(), remote: None }
}

fn model(id: &str, target: &str, artifacts: Vec<Artifact>) -> Model {
    Model {
        id: id.into(),
        target: target.into(),
        name: format!("Test {id}"),
        provider: "Test".into(),
        repo: "test/models".into(),
        revision: REVISION.into(),
        license: "MIT".into(),
        licenses: vec!["https://example.invalid/LICENSE".into()],
        notice: "test".into(),
        artifacts,
    }
}

fn entries() -> Vec<Model> {
    let gguf = |name: &str| artifact(name, 64, MODEL_SHA256, "model");
    vec![
        model("voice-ja", "japanese", vec![gguf("voice.gguf")]),
        model("asr-x", "asr", vec![gguf("asr.gguf")]),
        model("vad-x", "vad", vec![gguf("vad.gguf")]),
        model("rvc-x", "rvc", vec![artifact("voice.pth", 64, MODEL_SHA256, "model"), artifact("voice.index", 32, INDEX_SHA256, "index")]),
        model("ocr-x", "ocr", vec![artifact("det.onnx", 64, MODEL_SHA256, "det")]),
        model("slow-x", "multilingual", vec![artifact("slow.gguf", SLOW_SIZE, &"a".repeat(64), "model")]),
        model("bad-x", "multilingual", vec![artifact("bad.gguf", 64, &"0".repeat(64), "model")]),
        // A non-commercial license, as NLLB-200's.
        Model { license: "CC-BY-NC-4.0".into(), ..model("nc-x", "japanese", vec![gguf("nc.gguf")]) },
    ]
}

/// A body that hands out one byte at a time, slowly enough to be cancelled while it runs.
struct Slow(u64);

impl Read for Slow {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.0 == 0 || buf.is_empty() {
            return Ok(0);
        }
        std::thread::sleep(Duration::from_millis(10));
        self.0 -= 1;
        buf[0] = b'z';
        Ok(1)
    }
}

impl Body for Slow {}

/// What the fake outside world saw.
#[derive(Clone, Default)]
struct World {
    opened: Arc<Mutex<Vec<String>>>,
    probes: Arc<AtomicUsize>,
    busy: Arc<Mutex<Vec<String>>>,
}

impl World {
    fn opened(&self) -> Vec<String> {
        self.opened.lock().unwrap().clone()
    }

    fn set_busy(&self, targets: &[&str]) {
        *self.busy.lock().unwrap() = targets.iter().map(|t| t.to_string()).collect();
    }

    fn services(&self) -> Services {
        let opened = Arc::clone(&self.opened);
        let transport: Arc<dyn Transport> = Arc::new(move |url: &str| -> Result<Box<dyn Body>, Error> {
            opened.lock().unwrap().push(url.to_string());
            Ok(if url.ends_with("slow.gguf") {
                Box::new(Slow(SLOW_SIZE))
            } else if url.ends_with(".index") {
                Box::new(std::io::Cursor::new(index_bytes()))
            } else {
                Box::new(std::io::Cursor::new(model_bytes()))
            })
        });
        let options = Options { reserve_bytes: 0, free_space: Arc::new(|_| Ok(1 << 40)) };
        let probes = Arc::clone(&self.probes);
        let busy = Arc::clone(&self.busy);
        Services {
            model_downloads: Arc::new(move |root: &Path| Downloads::with(root, entries(), Arc::clone(&transport), options.clone())),
            speech_binary: Arc::new(move |_| {
                probes.fetch_add(1, Ordering::SeqCst);
                Err("no speech.cpp in the tests".into())
            }),
            model_target_idle: Arc::new(move |target| !busy.lock().unwrap().iter().any(|t| t == target)),
            telemetry_forced_off: Arc::new(|| true),
            ..common::Setup::default().services
        }
    }

    fn start(&self) -> Ui {
        self.start_with(None)
    }

    fn start_with(&self, saved: Option<Value>) -> Ui {
        let ui = Ui::with(Setup { saved, services: self.services(), ..Setup::default() });
        ui.ready();
        ui
    }
}

fn root(ui: &Ui) -> PathBuf {
    ui.dir.join("downloaded_models")
}

fn consent(id: &str) -> Value {
    json!({ "id": id, "consent": true, "catalog_version": CATALOG_VERSION })
}

fn jobs(ui: &Ui) -> Value {
    ui.ok("/get/data/model_download_state", None)["jobs"].clone()
}

/// Polls the state as the UI does until the job is in one of `phases`.
fn wait_phase(ui: &Ui, id: &str, phases: &[&str]) -> Value {
    let deadline = Instant::now() + common::TIMEOUT;
    loop {
        let job = jobs(ui)[id].clone();
        if phases.iter().any(|p| job["phase"] == *p) {
            return job;
        }
        assert!(Instant::now() < deadline, "{id} never reached {phases:?}: {job}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn download(ui: &Ui, id: &str) -> Value {
    assert_eq!(ui.request("/run/start_model_download", Some(consent(id)))["status"], 200);
    wait_phase(ui, id, &["ready", "failed"])
}

fn failure(answer: &Value) -> (u64, &str) {
    (answer["status"].as_u64().unwrap(), answer["result"]["error_code"].as_str().unwrap_or_default())
}

fn speech_settings(ui: &Ui) -> Value {
    ui.backend.core().config().get("SPEECH_SERVER_SETTINGS")
}

fn partials(ui: &Ui) -> Vec<String> {
    std::fs::read_dir(root(ui))
        .map(|dir| dir.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with(".partial-")).collect())
        .unwrap_or_default()
}

#[test]
fn the_catalog_lists_each_entry_with_its_size_destination_and_sources() {
    // The reviewed catalog itself; reading it reaches nothing.
    let ui = Ui::start();
    let snapshot = ui.ready();
    let catalog = ui.ok("/get/data/model_download_catalog", None);
    assert_eq!(catalog["catalog_version"], CATALOG_VERSION);
    assert_eq!(snapshot["/get/data/model_download_catalog"]["catalog_version"], CATALOG_VERSION, "in the start-up snapshot");
    assert_eq!(catalog["legacy_models"], json!([]), "the built-in CTranslate2 download is not offered by the core");
    let models = catalog["models"].as_array().unwrap();
    assert!(!models.is_empty());
    let root = root(&ui);
    for row in models {
        for key in ["id", "target", "name", "provider", "repo", "revision", "license", "licenses", "notice", "artifacts", "guidance", "restrictions"] {
            assert!(row.get(key).is_some(), "{key} in {row}");
        }
        let sizes: u64 = row["artifacts"].as_array().unwrap().iter().map(|a| a["size"].as_u64().unwrap()).sum();
        assert_eq!(row["total_bytes"], sizes);
        let destination = PathBuf::from(row["destination"].as_str().unwrap());
        assert_eq!(destination, root.join(row["id"].as_str().unwrap()).join(row["revision"].as_str().unwrap()));
        assert!(row["source"].as_str().unwrap().starts_with("https://huggingface.co/"));
        assert!(row["sources"].as_array().unwrap().iter().all(|s| s.as_str().unwrap().starts_with("https://huggingface.co/")));
    }
    assert!(!root.exists(), "listing creates no folder");
    ui.stop();
}

#[test]
fn the_state_is_polled_without_starting_anything() {
    let world = World::default();
    let ui = world.start();
    let first = ui.ok("/get/data/model_download_state", None);
    let second = ui.ok("/get/data/model_download_state", None);
    assert_eq!(first["jobs"], json!({}));
    assert_eq!(first["downloaded"], json!({}), "nothing on disk yet");
    assert_ne!(first["observation_id"], second["observation_id"], "each answer is a new observation");
    assert!(world.opened().is_empty() && !root(&ui).exists());
    ui.stop();
}

#[test]
fn a_start_without_consent_or_for_another_catalog_touches_no_file_or_network() {
    let world = World::default();
    let ui = world.start();
    let cases = [
        (None, 400, "download_request_invalid"),
        (Some(json!({})), 400, "download_request_invalid"),
        (Some(json!({ "id": [] })), 400, "download_request_invalid"),
        (Some(json!({ "id": "voice-ja", "consent": true })), 400, "download_request_invalid"),
        (Some(json!({ "id": "voice-ja", "consent": true, "catalog_version": CATALOG_VERSION, "url": "https://example.com/x" })), 400, "download_request_invalid"),
        (Some(json!({ "id": "voice-ja", "consent": false, "catalog_version": CATALOG_VERSION })), 400, "consent_required"),
        (Some(json!({ "id": "voice-ja", "consent": "true", "catalog_version": CATALOG_VERSION })), 400, "consent_required"),
        (Some(json!({ "id": "voice-ja", "consent": true, "catalog_version": "2020-01-01.1" })), 400, "catalog_changed"),
        (Some(json!({ "id": "not-listed", "consent": true, "catalog_version": CATALOG_VERSION })), 400, "catalog_changed"),
    ];
    for (data, status, code) in cases {
        let answer = ui.request("/run/start_model_download", data.clone());
        assert_eq!(failure(&answer), (status, code), "{data:?}");
    }
    assert_eq!(jobs(&ui), json!({}));
    assert!(world.opened().is_empty(), "nothing was fetched");
    assert!(!root(&ui).exists(), "no folder was made");
    ui.stop();
}

#[test]
fn a_non_commercial_model_downloads_only_with_its_separate_acknowledgement() {
    let world = World::default();
    let ui = world.start();
    let catalog = ui.ok("/get/data/model_download_catalog", None);
    let restrictions = |id: &str| catalog["models"].as_array().unwrap().iter().find(|m| m["id"] == id).unwrap()["restrictions"].clone();
    assert_eq!((restrictions("nc-x"), restrictions("voice-ja")), (json!(["non_commercial"]), json!([])));
    let acknowledging = |id: &str, acknowledged: Value| json!({ "id": id, "consent": true, "catalog_version": CATALOG_VERSION, "acknowledged": acknowledged });
    for (data, code) in [
        (consent("nc-x"), "model_download_restriction_unacknowledged"),
        (acknowledging("nc-x", json!([])), "model_download_restriction_unacknowledged"),
        (acknowledging("nc-x", json!(["non_commercial", "unknown_terms"])), "download_request_invalid"),
        // An unrestricted model takes no acknowledgement it does not carry.
        (acknowledging("voice-ja", json!(["non_commercial"])), "download_request_invalid"),
    ] {
        assert_eq!(failure(&ui.request("/run/start_model_download", Some(data.clone()))), (400, code), "{data}");
    }
    assert_eq!(jobs(&ui), json!({}));
    assert!(world.opened().is_empty() && !root(&ui).exists(), "a refused start fetches and writes nothing");
    assert_eq!(ui.request("/run/start_model_download", Some(acknowledging("nc-x", json!(["non_commercial"]))))["status"], 200);
    assert_eq!(wait_phase(&ui, "nc-x", &["ready", "failed"])["phase"], "ready");
    ui.stop();
}

#[test]
fn malformed_cancel_and_apply_requests_fail_without_side_effects() {
    let world = World::default();
    let ui = world.start();
    for (endpoint, data) in [
        ("/run/cancel_model_download", Some(json!({ "id": "x" }))),
        ("/run/cancel_model_download", Some(json!({ "id": "voice-ja", "job_id": "" }))),
        ("/run/cancel_model_download", Some(json!({ "id": "voice-ja", "job_id": 1 }))),
        ("/run/cancel_model_download", Some(json!({ "id": "voice-ja", "job_id": "a", "extra": 1 }))),
        ("/run/apply_model_download", None),
        ("/run/apply_model_download", Some(json!({ "id": "voice-ja", "job_id": "a" }))),
        ("/run/apply_model_download", Some(json!([1, 2]))),
    ] {
        assert_eq!(failure(&ui.request(endpoint, data.clone())), (400, "download_request_invalid"), "{endpoint} {data:?}");
    }
    // Well formed, but for no job: a stale reply.
    let answer = ui.request("/run/cancel_model_download", Some(json!({ "id": "voice-ja", "job_id": "nope" })));
    assert_eq!(failure(&answer), (409, "stale_job"));
    assert_eq!(jobs(&ui), json!({}));
    assert!(world.opened().is_empty() && !root(&ui).exists());
    ui.stop();
}

#[test]
fn a_consented_download_is_verified_and_published_and_starts_nothing_else() {
    let world = World::default();
    let ui = world.start();
    let before = speech_settings(&ui);
    let answer = ui.ok("/run/start_model_download", Some(consent("voice-ja")));
    let job = &answer["jobs"]["voice-ja"];
    assert!(job["job_id"].as_str().is_some_and(|id| !id.is_empty()));
    assert_eq!(job["total_bytes"], 64);
    let job = wait_phase(&ui, "voice-ja", &["ready", "failed"]);
    assert_eq!(job["phase"], "ready", "{job}");
    assert_eq!((job["received_bytes"].as_u64(), job["error_code"].clone()), (Some(64), Value::Null));
    let published = root(&ui).join("voice-ja").join(REVISION).join("voice.gguf");
    assert_eq!(PathBuf::from(job["paths"]["model"].as_str().unwrap()), published);
    assert_eq!(std::fs::read(&published).unwrap(), model_bytes());
    assert_eq!(world.opened(), [format!("https://huggingface.co/test/models/resolve/{REVISION}/voice.gguf")]);
    assert!(partials(&ui).is_empty());
    // A download is not applied by itself.
    assert_eq!(speech_settings(&ui), before);
    ui.stop();
}

#[test]
fn a_file_that_does_not_match_its_hash_fails_and_publishes_nothing() {
    let world = World::default();
    let ui = world.start();
    let job = download(&ui, "bad-x");
    assert_eq!((job["phase"].as_str(), job["error_code"].as_str()), (Some("failed"), Some("hash_mismatch")));
    assert_eq!(job["paths"], json!({}));
    assert!(!root(&ui).join("bad-x").join(REVISION).exists());
    assert!(partials(&ui).is_empty());
    ui.stop();
}

#[test]
fn a_running_download_is_busy_and_can_be_cancelled_leaving_nothing_behind() {
    let world = World::default();
    let ui = world.start();
    let job_id = ui.ok("/run/start_model_download", Some(consent("slow-x")))["jobs"]["slow-x"]["job_id"].as_str().unwrap().to_string();
    wait_phase(&ui, "slow-x", &["downloading"]);
    // One download at a time; applying an unfinished one is refused.
    assert_eq!(failure(&ui.request("/run/start_model_download", Some(consent("voice-ja")))), (409, "download_busy"));
    let early = json!({ "id": "slow-x", "job_id": job_id, "expected": { "model": "" } });
    assert_eq!(failure(&ui.request("/run/apply_model_download", Some(early))), (409, "download_not_ready"));
    // A reply to another job is stale.
    let stale = json!({ "id": "slow-x", "job_id": "0".repeat(32) });
    assert_eq!(failure(&ui.request("/run/cancel_model_download", Some(stale))), (409, "stale_job"));

    let answer = ui.ok("/run/cancel_model_download", Some(json!({ "id": "slow-x", "job_id": job_id })));
    assert!(["cancelling", "cancelled"].contains(&answer["jobs"]["slow-x"]["phase"].as_str().unwrap()));
    let job = wait_phase(&ui, "slow-x", &["cancelled", "failed"]);
    assert_eq!((job["phase"].as_str(), job["error_code"].clone()), (Some("cancelled"), Value::Null));
    assert!(partials(&ui).is_empty(), "the staging is gone once it reads cancelled");
    assert!(!root(&ui).join("slow-x").join(REVISION).exists());
    // Cancelling again changes nothing; a new download may start.
    assert_eq!(ui.ok("/run/cancel_model_download", Some(json!({ "id": "slow-x", "job_id": job_id })))["jobs"]["slow-x"]["phase"], "cancelled");
    assert_eq!(download(&ui, "voice-ja")["phase"], "ready");
    ui.stop();
}

fn apply(ui: &Ui, id: &str, job: &Value, expected: Value) -> Value {
    ui.request("/run/apply_model_download", Some(json!({ "id": id, "job_id": job["job_id"], "expected": expected })))
}

#[test]
fn apply_writes_only_the_profiles_path_and_keeps_its_options() {
    let world = World::default();
    let saved = json!({ "SPEECH_SERVER_SETTINGS": { "version": 1, "profiles": { "japanese": { "model": "/old.gguf", "low_latency": true, "device": "cpu" } } } });
    let ui = world.start_with(Some(saved));
    let job = download(&ui, "voice-ja");
    let answer = apply(&ui, "voice-ja", &job, json!({ "model": "/old.gguf" }));
    assert_eq!(answer["status"], 200, "{answer}");
    assert_eq!(answer["result"]["jobs"]["voice-ja"]["phase"], "applied");
    let row = speech_settings(&ui)["profiles"]["japanese"].clone();
    assert_eq!(row["model"], job["paths"]["model"]);
    assert_eq!((row["low_latency"].clone(), row["device"].clone()), (json!(true), json!("cpu")));
    assert_eq!(speech_settings(&ui)["profiles"]["multilingual"]["model"], "");
    // Applied once: a second apply is refused.
    assert_eq!(failure(&apply(&ui, "voice-ja", &job, json!({ "model": job["paths"]["model"] }))), (409, "download_not_ready"));
    // The change is saved.
    assert_eq!(ui.ok("/run/shutdown", None), true);
    assert_eq!(ui.saved()["SPEECH_SERVER_SETTINGS"]["profiles"]["japanese"]["model"], job["paths"]["model"]);
    ui.stop();
}

#[test]
fn stale_settings_and_a_running_target_are_not_overwritten() {
    let world = World::default();
    let ui = world.start();
    let job = download(&ui, "voice-ja");
    // The settings hold "" while the user saw "/old.gguf".
    assert_eq!(failure(&apply(&ui, "voice-ja", &job, json!({ "model": "/old.gguf" }))), (409, "settings_changed"));
    world.set_busy(&["japanese"]);
    assert_eq!(failure(&apply(&ui, "voice-ja", &job, json!({ "model": "" }))), (409, "model_target_busy"));
    assert_eq!(speech_settings(&ui)["profiles"]["japanese"]["model"], "");
    assert_eq!(jobs(&ui)["voice-ja"]["phase"], "ready", "the download stays ready to apply");
    world.set_busy(&[]);
    assert_eq!(apply(&ui, "voice-ja", &job, json!({ "model": "" }))["status"], 200);
    assert_eq!(speech_settings(&ui)["profiles"]["japanese"]["model"], job["paths"]["model"]);
    ui.stop();
}

#[test]
fn an_asr_apply_sets_only_the_recognizer_and_keeps_the_vad() {
    let world = World::default();
    let saved = json!({ "SPEECH_SERVER_SETTINGS": { "version": 1, "profiles": { "asr": { "vad_model": "/vad.gguf", "device": "gpu" } } } });
    let ui = world.start_with(Some(saved));
    let job = download(&ui, "asr-x");
    assert_eq!(apply(&ui, "asr-x", &job, json!({ "model": "" }))["status"], 200);
    let profiles = speech_settings(&ui)["profiles"].clone();
    assert_eq!(profiles["asr"]["model"], job["paths"]["model"]);
    assert_eq!((profiles["asr"]["vad_model"].clone(), profiles["asr"]["device"].clone()), (json!("/vad.gguf"), json!("gpu")));
    assert_eq!(profiles["japanese"]["model"], "");
    ui.stop();
}

#[test]
fn a_vad_apply_sets_only_the_asr_vad_path_and_checks_that_field() {
    let world = World::default();
    let saved = json!({ "SPEECH_SERVER_SETTINGS": { "version": 1, "profiles": { "asr": { "model": "/asr.gguf", "vad_model": "/old-vad.gguf" } } } });
    let ui = world.start_with(Some(saved));
    let job = download(&ui, "vad-x");
    // expected names the replaced field, vad_model, not the recognizer.
    assert_eq!(failure(&apply(&ui, "vad-x", &job, json!({ "model": "/asr.gguf" }))), (409, "settings_changed"));
    world.set_busy(&["asr"]);
    assert_eq!(failure(&apply(&ui, "vad-x", &job, json!({ "model": "/old-vad.gguf" }))), (409, "model_target_busy"));
    world.set_busy(&[]);
    assert_eq!(apply(&ui, "vad-x", &job, json!({ "model": "/old-vad.gguf" }))["status"], 200);
    let asr = speech_settings(&ui)["profiles"]["asr"].clone();
    assert_eq!((asr["model"].clone(), asr["vad_model"].clone()), (json!("/asr.gguf"), job["paths"]["model"].clone()));
    ui.stop();
}

#[test]
fn an_rvc_apply_sets_both_paths_and_keeps_the_rest_of_the_voice_settings() {
    let world = World::default();
    let saved = json!({ "DIRECT_VOICE_SETTINGS": { "rvc_runtime": "/owned/runtime", "rvc_pitch": 3, "rvc_index_rate": 0.2 } });
    let ui = world.start_with(Some(saved));
    let job = download(&ui, "rvc-x");
    assert_eq!(job["phase"], "ready", "{job}");
    // Both files are named in expected.
    assert_eq!(failure(&apply(&ui, "rvc-x", &job, json!({ "model": "" }))), (400, "download_request_invalid"));
    assert_eq!(failure(&apply(&ui, "rvc-x", &job, json!({ "model": "", "index": 0 }))), (400, "download_request_invalid"));
    world.set_busy(&["rvc"]);
    assert_eq!(failure(&apply(&ui, "rvc-x", &job, json!({ "model": "", "index": "" }))), (409, "model_target_busy"));
    world.set_busy(&[]);
    assert_eq!(failure(&apply(&ui, "rvc-x", &job, json!({ "model": "/other.pth", "index": "" }))), (409, "settings_changed"));
    assert_eq!(apply(&ui, "rvc-x", &job, json!({ "model": "", "index": "" }))["status"], 200);
    let voice = ui.backend.core().config().get("DIRECT_VOICE_SETTINGS");
    assert_eq!((voice["rvc_model"].clone(), voice["rvc_index"].clone()), (job["paths"]["model"].clone(), job["paths"]["index"].clone()));
    assert_eq!((voice["rvc_runtime"].clone(), voice["rvc_pitch"].clone(), voice["rvc_index_rate"].clone()), (json!("/owned/runtime"), json!(3), json!(0.2)));
    assert_eq!((voice["mode"].clone(), voice["engine"].clone()), (json!("passthrough"), json!("rvc")), "nothing is switched on");
    ui.stop();
}

#[test]
fn an_ocr_apply_changes_no_setting() {
    let world = World::default();
    let ui = world.start();
    let before = (speech_settings(&ui), ui.backend.core().config().get("DIRECT_VOICE_SETTINGS"));
    let job = download(&ui, "ocr-x");
    assert_eq!(failure(&apply(&ui, "ocr-x", &job, json!({ "model": "" }))), (400, "download_request_invalid"));
    assert_eq!(apply(&ui, "ocr-x", &job, json!({}))["result"]["jobs"]["ocr-x"]["phase"], "applied");
    assert_eq!((speech_settings(&ui), ui.backend.core().config().get("DIRECT_VOICE_SETTINGS")), before);
    // An absent expectation (null) is accepted as well, as Python's `expected in ({}, None)`.
    let job = download(&ui, "ocr-x");
    assert_eq!(apply(&ui, "ocr-x", &job, Value::Null)["status"], 200);
    ui.stop();
}

#[test]
fn the_hardware_snapshot_and_refresh_start_no_model() {
    let world = World::default();
    let ui = world.start();
    let snapshot = ui.ok("/get/data/model_download_hardware", None);
    assert_eq!((snapshot["phase"].clone(), snapshot["devices"].clone()), (json!("unknown"), json!([])));
    assert_eq!(world.probes.load(Ordering::SeqCst), 0, "reading the snapshot probes nothing");
    // The refresh takes no options: no binary from the UI.
    assert_eq!(failure(&ui.request("/run/refresh_model_download_hardware", Some(json!({ "binary": "arbitrary" })))), (400, "download_request_invalid"));
    assert_eq!(world.probes.load(Ordering::SeqCst), 0);
    let refreshed = ui.ok("/run/refresh_model_download_hardware", Some(json!({})));
    assert!(["probing", "failed"].contains(&refreshed["phase"].as_str().unwrap()), "{refreshed}");
    let deadline = Instant::now() + common::TIMEOUT;
    let state = loop {
        let state = ui.ok("/get/data/model_download_hardware", None);
        if state["phase"] != "probing" {
            break state;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    };
    // No bundled speech.cpp here: the probe fails without inventing a device.
    assert_eq!((state["phase"].clone(), state["error_code"].clone(), state["devices"].clone()), (json!("failed"), json!("hardware_unavailable"), json!([])));
    assert_eq!(world.probes.load(Ordering::SeqCst), 1);
    let again = ui.ok("/run/refresh_model_download_hardware", None);
    assert!(["probing", "failed"].contains(&again["phase"].as_str().unwrap()), "no data is also no options: {again}");
    assert_eq!(jobs(&ui), json!({}));
    assert!(world.opened().is_empty());
    ui.stop();
}

#[test]
fn shutdown_closes_the_downloads_and_the_probe() {
    let world = World::default();
    let ui = world.start();
    ui.ok("/run/start_model_download", Some(consent("slow-x")));
    wait_phase(&ui, "slow-x", &["downloading"]);
    assert_eq!(ui.ok("/run/shutdown", None), true);
    let job = jobs(&ui)["slow-x"].clone();
    assert_eq!(job["phase"], "cancelled", "the download was cancelled and its staging removed before the answer: {job}");
    assert!(partials(&ui).is_empty());
    assert_eq!(failure(&ui.request("/run/start_model_download", Some(consent("voice-ja")))), (409, "downloads_closed"));
    assert_eq!(ui.request("/run/refresh_model_download_hardware", None)["status"], 409);
    ui.stop();
}

#[test]
fn starting_with_automatic_downloads_on_fetches_nothing() {
    // Neither a saved selection nor the switch is consent (test_model_download_policy.py).
    let world = World::default();
    let ui = world.start_with(Some(json!({ "AUTO_DOWNLOAD_MODELS": true })));
    assert_eq!(ui.ok("/get/data/auto_download_models", None), true);
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(jobs(&ui), json!({}));
    assert!(world.opened().is_empty() && !root(&ui).exists());
    ui.stop();
}

/// A model file of the user's own, outside the downloads folder (#403).
fn own_file(ui: &Ui, name: &str, bytes: &[u8]) -> String {
    let folder = ui.dir.join("my models");
    std::fs::create_dir_all(&folder).unwrap();
    let path = folder.join(name);
    std::fs::write(&path, bytes).unwrap();
    path.to_string_lossy().into_owned()
}

fn register(ui: &Ui, target: &str, name: &str, paths: Value) -> Value {
    ui.request("/run/register_user_model", Some(json!({ "target": target, "name": name, "paths": paths })))
}

#[test]
fn a_registered_model_is_listed_and_switched_to_with_the_checks_of_an_apply() {
    let world = World::default();
    let saved = json!({ "SPEECH_SERVER_SETTINGS": { "version": 1, "profiles": { "japanese": { "model": "/old.gguf", "low_latency": true, "device": "cpu" } } } });
    let ui = world.start_with(Some(saved));
    assert_eq!(ui.ok("/get/data/user_models", None), json!({ "models": [] }));
    let file = own_file(&ui, "mine.gguf", b"GGUF mine");
    let answer = register(&ui, "japanese", "Mine", json!({ "model": file }));
    assert_eq!(answer["status"], 200, "{answer}");
    let row = answer["result"]["models"][0].clone();
    assert_eq!((row["name"].as_str(), row["status"].as_str(), row["total_bytes"].as_u64()), (Some("Mine"), Some("ok"), Some(9)));
    assert_eq!(row["paths"], json!({ "model": file }));
    let id = row["id"].as_str().unwrap().to_string();
    // Registering changes no setting and touches no network.
    assert_eq!(speech_settings(&ui)["profiles"]["japanese"]["model"], "/old.gguf");
    let switch = |expected: Value| ui.request("/run/apply_user_model", Some(json!({ "id": id, "expected": expected })));
    assert_eq!(failure(&switch(json!({ "model": "/elsewhere.gguf" }))), (409, "settings_changed"));
    world.set_busy(&["japanese"]);
    assert_eq!(failure(&switch(json!({ "model": "/old.gguf" }))), (409, "model_target_busy"));
    world.set_busy(&[]);
    assert_eq!(switch(json!({ "model": "/old.gguf" }))["status"], 200);
    let profile = speech_settings(&ui)["profiles"]["japanese"].clone();
    assert_eq!((profile["model"].as_str(), profile["low_latency"].clone(), profile["device"].clone()), (Some(file.as_str()), json!(true), json!("cpu")));
    // A changed file is reported and not switched to.
    std::fs::write(&file, b"GGUF but changed").unwrap();
    assert_eq!(ui.ok("/get/data/user_models", None)["models"][0]["status"], "changed");
    assert_eq!(failure(&switch(json!({ "model": file }))), (400, "user_model_changed"));
    // Removing forgets the registration; the file and the setting stay.
    assert_eq!(ui.ok("/run/remove_user_model", Some(json!({ "id": id }))), json!({ "models": [] }));
    assert!(Path::new(&file).exists());
    assert_eq!(speech_settings(&ui)["profiles"]["japanese"]["model"], file.as_str());
    assert!(world.opened().is_empty() && !root(&ui).exists());
    ui.stop();
}

#[test]
fn a_registered_rvc_model_without_an_index_replaces_both_paths() {
    let world = World::default();
    let saved = json!({ "DIRECT_VOICE_SETTINGS": { "rvc_runtime": "/owned/runtime", "rvc_model": "/old.pth", "rvc_index": "/old.index", "rvc_pitch": 3 } });
    let ui = world.start_with(Some(saved));
    let file = own_file(&ui, "voice.pth", b"pth");
    let id = register(&ui, "rvc", "Voice", json!({ "model": file }))["result"]["models"][0]["id"].as_str().unwrap().to_string();
    let answer = ui.request("/run/apply_user_model", Some(json!({ "id": id, "expected": { "model": "/old.pth", "index": "/old.index" } })));
    assert_eq!(answer["status"], 200, "{answer}");
    let voice = ui.backend.core().config().get("DIRECT_VOICE_SETTINGS");
    assert_eq!((voice["rvc_model"].as_str(), voice["rvc_index"].as_str()), (Some(file.as_str()), Some("")));
    assert_eq!((voice["rvc_runtime"].clone(), voice["rvc_pitch"].clone()), (json!("/owned/runtime"), json!(3)));
    ui.stop();
}

#[test]
fn bad_user_model_requests_fail_with_a_code_and_write_nothing() {
    let world = World::default();
    let ui = world.start();
    let file = own_file(&ui, "mine.gguf", b"GGUF");
    for (endpoint, data, code) in [
        ("/run/register_user_model", None, "user_model_invalid"),
        ("/run/register_user_model", Some(json!({ "target": "ocr", "name": "x", "paths": { "model": file } })), "user_model_invalid"),
        ("/run/register_user_model", Some(json!({ "target": "japanese", "name": "", "paths": { "model": file } })), "user_model_name_invalid"),
        ("/run/register_user_model", Some(json!({ "target": "japanese", "name": "x", "paths": { "model": "mine.gguf" } })), "user_model_path_invalid"),
        ("/run/register_user_model", Some(json!({ "target": "rvc", "name": "x", "paths": { "model": file } })), "user_model_file_type"),
        ("/run/remove_user_model", Some(json!({ "id": "user-none" })), "user_model_unknown"),
        ("/run/apply_user_model", Some(json!({ "id": "x" })), "user_model_invalid"),
        ("/run/apply_user_model", Some(json!({ "id": "user-none", "expected": { "model": "" } })), "user_model_unknown"),
    ] {
        assert_eq!(failure(&ui.request(endpoint, data.clone())), (400, code), "{endpoint} {data:?}");
    }
    assert!(!ui.dir.join("user_models.json").exists());
    ui.stop();
}
/// Chat reading resolves its models from a table of its own (`astarot_ocr_runtime::models::CATALOG`),
/// which repeats the OCR entries of the download catalog: the same models, revisions and files.
/// Python's catalog was the reference until 0.6.0 (`ocr-runtime/tests/models.rs` compared them);
/// the download catalog is now.
#[test]
fn chat_reading_s_table_repeats_the_ocr_entries_of_the_download_catalog() {
    let downloads: Vec<Value> = astarot_ops::downloads::catalog::catalog()
        .into_iter()
        .filter(|m| m.target == "ocr")
        .map(|m| json!([m.id, m.revision, m.artifacts.iter().map(|a| json!([a.filename, a.size, a.sha256, a.role])).collect::<Vec<_>>()]))
        .collect();
    let reading: Vec<Value> = astarot_ocr_runtime::models::CATALOG
        .iter()
        .map(|e| json!([e.id, e.revision, e.artifacts.iter().map(|a| json!([a.filename, a.size, a.sha256, a.role])).collect::<Vec<_>>()]))
        .collect();
    assert!(!reading.is_empty());
    assert_eq!(reading, downloads);
    assert_eq!(
        (astarot_ocr_runtime::models::DETECTOR_MODEL_ID, astarot_ocr_runtime::models::DETECTOR_FILE_NAME),
        (astarot_ops::downloads::catalog::DETECTOR_MODEL_ID, astarot_ops::downloads::catalog::DETECTOR_FILE_NAME)
    );
}
