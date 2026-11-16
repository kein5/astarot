//! Chat reading (`src/controller/ocr.rs`) driven through the protocol, with a fake picture
//! source and a fake recogniser in place of the screen and ONNX Runtime: readiness from the files
//! on disk, the start checks and their `OCR_DISABLED_*` codes, the status, settings reaching the
//! running pipeline, the hand-off to the message pipeline, turning off and shutdown. No model,
//! screen, VR runtime or ONNX Runtime is used.

mod common;

use common::{Setup, Ui, error_code};
use ocr_runtime::BgrImage;
use ocr_runtime::detection::Surface;
use ocr_runtime::engine::Word;
use ocr_runtime::failure::{Clock, Failure, Log, MonotonicClock};
use ocr_runtime::languages::OcrModelSpec;
use ocr_runtime::pipeline::{CaptureFactory, CaptureStatus, Detector, FrameSource, Reader, ReaderFactory};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vrct_core::controller::Services;
use vrct_core::controller::ocr::{OcrMessage, OcrPlatform};

/// A line handed to the message pipeline: text, language, id, and whether it was still current.
type Delivered = (String, Option<String>, String, bool);

/// What the fake platform was asked and what it answers.
struct Fake {
    engine: AtomicBool,
    probe: Mutex<CaptureStatus>,
    vr: AtomicBool,
    /// Window titles the capture was opened for, and how often it was closed.
    opened: Mutex<Vec<String>>,
    closed: AtomicUsize,
    /// The lines the recogniser reads from every picture.
    lines: Mutex<Vec<&'static str>>,
    /// The minimum confidence of each read.
    reads: Mutex<Vec<f64>>,
    /// The roots the recognisers were made for.
    roots: Mutex<Vec<PathBuf>>,
    /// Lines handed to the message pipeline.
    delivered: Mutex<Vec<Delivered>>,
    /// While set, loading a recogniser waits (a slow model load).
    hold: AtomicBool,
    loading: AtomicBool,
}

impl Fake {
    fn new() -> Arc<Fake> {
        Arc::new(Fake {
            engine: AtomicBool::new(true),
            probe: Mutex::new(CaptureStatus::Ok),
            vr: AtomicBool::new(false),
            opened: Mutex::new(Vec::new()),
            closed: AtomicUsize::new(0),
            lines: Mutex::new(Vec::new()),
            reads: Mutex::new(Vec::new()),
            roots: Mutex::new(Vec::new()),
            delivered: Mutex::new(Vec::new()),
            hold: AtomicBool::new(false),
            loading: AtomicBool::new(false),
        })
    }

    fn read_count(&self) -> usize {
        self.reads.lock().unwrap().len()
    }

    fn delivered_texts(&self) -> Vec<String> {
        self.delivered.lock().unwrap().iter().map(|d| d.0.clone()).collect()
    }
}

/// A different picture on every frame, so that no read is reused from the cache.
struct Frames {
    fake: Arc<Fake>,
    frame: u8,
}

impl FrameSource for Frames {
    fn get(&mut self) -> Option<BgrImage> {
        self.frame = self.frame.wrapping_add(1);
        Some(BgrImage::filled(64, 32, 20 + self.frame % 200))
    }
    fn backend(&self) -> String {
        "hwnd".into()
    }
    fn source(&self) -> Option<Surface> {
        Some(Surface::Window)
    }
    fn failure_active(&self) -> bool {
        false
    }
    fn close(&mut self) {
        self.fake.closed.fetch_add(1, Ordering::SeqCst);
    }
}

struct FakeReader(Arc<Fake>);

impl Reader for FakeReader {
    fn read(&self, _crop: &BgrImage, min_confidence: f64) -> Result<Vec<Word>, Failure> {
        self.0.reads.lock().unwrap().push(min_confidence);
        Ok(self.0.lines.lock().unwrap().iter().map(|text| Word { text: (*text).into(), confidence: 0.99, bounds: None }).collect())
    }
}

/// Loads "models" as the real factory does as far as the files go: missing downloads are
/// refused with the catalog ids; present ones (by size) give the fake recogniser.
struct FakeReaders {
    fake: Arc<Fake>,
    root: PathBuf,
}

impl ReaderFactory for FakeReaders {
    fn reader_for(&self, spec: &OcrModelSpec) -> Result<Arc<dyn Reader>, ocr_runtime::Error> {
        self.fake.loading.store(true, Ordering::SeqCst);
        while self.fake.hold.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(10));
        }
        let missing = ocr_runtime::models::missing_models(&self.root, spec);
        if !missing.is_empty() {
            return Err(ocr_runtime::Error::ModelsMissing(missing));
        }
        Ok(Arc::new(FakeReader(Arc::clone(&self.fake))))
    }
}

struct Platform(Arc<Fake>);

impl OcrPlatform for Platform {
    fn engine_available(&self) -> bool {
        self.0.engine.load(Ordering::SeqCst)
    }
    fn probe_capture(&self, _window_title: &str, _log: Arc<dyn Log>) -> CaptureStatus {
        *self.0.probe.lock().unwrap()
    }
    fn available_sources(&self, _log: Arc<dyn Log>) -> Vec<&'static str> {
        if self.0.vr.load(Ordering::SeqCst) { vec!["window", "vr"] } else { vec!["window"] }
    }
    fn capture_factory(&self, _log: Arc<dyn Log>) -> CaptureFactory {
        let fake = Arc::clone(&self.0);
        Arc::new(move |title: &str| {
            fake.opened.lock().unwrap().push(title.to_string());
            Box::new(Frames { fake: Arc::clone(&fake), frame: 0 }) as Box<dyn FrameSource>
        })
    }
    fn readers(&self, root: &Path) -> Arc<dyn ReaderFactory> {
        self.0.roots.lock().unwrap().push(root.to_path_buf());
        Arc::new(FakeReaders { fake: Arc::clone(&self.0), root: root.to_path_buf() })
    }
    fn detector(&self, _root: &Path, _log: &Arc<dyn Log>) -> Option<Box<dyn Detector>> {
        None
    }
    fn clock(&self) -> Arc<dyn Clock> {
        Arc::new(MonotonicClock::default())
    }
}

fn services(fake: &Arc<Fake>) -> Services {
    let sink = Arc::clone(fake);
    Services {
        ocr: Arc::new(Platform(Arc::clone(fake))),
        ocr_message: Arc::new(move |_core, message: &OcrMessage, current: &dyn Fn() -> bool| {
            sink.delivered.lock().unwrap().push((message.text.clone(), message.language.clone(), message.id.clone(), current()));
        }),
        ..Setup::default().services
    }
}

/// A run with the fake platform; ticks every 100 ms.
fn start(fake: &Arc<Fake>) -> Ui {
    let ui = Ui::with(Setup { saved: Some(json!({ "OCR_POLL_INTERVAL_MS": 100 })), services: services(fake), ..Setup::default() });
    ui.ready();
    ui
}

/// Puts files of the catalog's sizes where the download manager keeps a model (no hashing is
/// done before the reader loads them, and the fake reader loads nothing).
fn install(dir: &Path, model_id: &str) {
    let entry = ocr_runtime::models::catalog_entry(model_id).unwrap();
    let folder = dir.join("downloaded_models").join(entry.id).join(entry.revision);
    std::fs::create_dir_all(&folder).unwrap();
    for artifact in entry.artifacts {
        std::fs::File::create(folder.join(artifact.filename)).unwrap().set_len(artifact.size).unwrap();
    }
}

/// The worker runs below normal priority (as on a user's PC); a loaded test machine may keep it
/// waiting a while.
const WORKER_TIMEOUT: Duration = Duration::from_secs(60);

fn wait_until(what: &str, done: impl Fn() -> bool) {
    let deadline = Instant::now() + WORKER_TIMEOUT;
    while !done() {
        assert!(Instant::now() < deadline, "{what} within {WORKER_TIMEOUT:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Turns chat reading on and returns the answer and the notifications on `/run/enable_ocr_capture`.
fn enable(ui: &Ui) -> (Value, Vec<Value>) {
    let mark = ui.send("/set/enable/ocr_capture", None);
    let answer = ui.wait_endpoint(mark, "/set/enable/ocr_capture");
    (answer, ui.on(mark, "/run/enable_ocr_capture"))
}

#[test]
fn model_readiness_follows_the_files_on_disk() {
    let fake = Fake::new();
    let ui = start(&fake);
    // The models are looked at on start-up (files only); the window and the worker are not.
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/ocr_model_readiness"]["missing_models"], json!(["ppocrv6-small"]));
    assert!(snapshot.get("/get/data/ocr_readiness").is_none() && snapshot.get("/get/data/ocr_capture_status").is_none());
    let readiness = ui.ok("/get/data/ocr_model_readiness", None);
    assert_eq!(
        readiness,
        json!({ "language": "auto", "language_supported": true, "required_models": ["ppocrv6-small"], "missing_models": ["ppocrv6-small"] })
    );
    // A file of the wrong size is not a download.
    install(&ui.dir, "ppocrv6-small");
    let entry = ocr_runtime::models::catalog_entry("ppocrv6-small").unwrap();
    let det = ui.dir.join("downloaded_models").join(entry.id).join(entry.revision).join("det.onnx");
    std::fs::File::create(&det).unwrap().set_len(10).unwrap();
    assert_eq!(ui.ok("/get/data/ocr_model_readiness", None)["missing_models"], json!(["ppocrv6-small"]));
    install(&ui.dir, "ppocrv6-small");
    assert_eq!(ui.ok("/get/data/ocr_model_readiness", None)["missing_models"], json!([]));

    // A script language needs its recogniser too; stopped, the choice is only stored.
    assert_eq!(ui.ok("/set/data/ocr_source_language", Some(json!("Korean"))), "Korean");
    let readiness = ui.ok("/get/data/ocr_model_readiness", None);
    assert_eq!(readiness["required_models"], json!(["ppocrv6-small", "ppocrv5-korean"]));
    assert_eq!(readiness["missing_models"], json!(["ppocrv5-korean"]));

    let full = ui.ok("/get/data/ocr_readiness", None);
    let keys: Vec<&str> = full.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        [
            "engine", "language", "language_supported", "required_models", "missing_models", "capture", "window_title",
            "detector_model", "detector_installed", "detector_enabled", "runtime",
        ]
    );
    assert_eq!(full["engine"], true);
    assert_eq!(full["capture"], "ok");
    assert_eq!(full["window_title"], "VRChat");
    assert_eq!(full["detector_model"], "vrct-vox-chatbox-detector");
    assert_eq!(full["detector_installed"], false);
    assert_eq!(full["detector_enabled"], true);
    assert_eq!(full["runtime"], json!({ "state": "stopped", "stage": null, "error_code": null, "detector": null }));
    install(&ui.dir, "vrct-vox-chatbox-detector");
    assert_eq!(ui.ok("/get/data/ocr_readiness", None)["detector_installed"], true);

    *fake.probe.lock().unwrap() = CaptureStatus::WindowNotFound;
    fake.engine.store(false, Ordering::SeqCst);
    let full = ui.ok("/get/data/ocr_readiness", None);
    assert_eq!((full["capture"].clone(), full["engine"].clone()), (json!("window_not_found"), json!(false)));
    *fake.probe.lock().unwrap() = CaptureStatus::CaptureUnavailable;
    assert_eq!(ui.ok("/get/data/ocr_readiness", None)["capture"], "capture_unavailable");

    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["OCR_SOURCE_LANGUAGE"], "Korean");
    ui.stop();
}

#[test]
fn a_start_that_cannot_read_tells_why_and_stays_off() {
    let fake = Fake::new();
    let ui = start(&fake);
    let check = |expected: &str| {
        let (answer, told) = enable(&ui);
        assert_eq!((answer["status"].clone(), answer["result"].clone()), (json!(200), json!(false)), "{expected}");
        assert_eq!(told.len(), 1, "{expected}: {told:?}");
        assert_eq!(told[0]["status"], 400);
        assert_eq!(error_code(&told[0]), expected);
        assert_eq!(told[0]["result"]["data"], false);
        assert_eq!(told[0]["result"]["category"], "ocr");
        assert_eq!(ui.ok("/get/data/ocr_capture_status", None)["active"], false);
    };
    check("OCR_DISABLED_MODEL_MISSING");
    install(&ui.dir, "ppocrv6-small");
    *fake.probe.lock().unwrap() = CaptureStatus::WindowNotFound;
    check("OCR_DISABLED_WINDOW_NOT_FOUND");
    // No display to read from (and no headset view): Wayland without a shared window, a
    // missing X server, or SteamVR without a mirror.
    *fake.probe.lock().unwrap() = CaptureStatus::CaptureUnavailable;
    check("OCR_DISABLED_CAPTURE_UNAVAILABLE");
    fake.engine.store(false, Ordering::SeqCst);
    check("OCR_DISABLED_ENGINE_UNAVAILABLE");
    // A language that needs a recogniser that is not downloaded.
    fake.engine.store(true, Ordering::SeqCst);
    *fake.probe.lock().unwrap() = CaptureStatus::Ok;
    ui.ok("/set/data/ocr_source_language", Some(json!("Thai")));
    check("OCR_DISABLED_MODEL_MISSING");
    assert!(fake.opened.lock().unwrap().is_empty(), "nothing was captured");
    assert_eq!(fake.read_count(), 0);
    ui.stop();
}

#[test]
fn the_source_language_is_checked_and_rolled_back() {
    let fake = Fake::new();
    let ui = start(&fake);
    let answer = ui.request("/set/data/ocr_source_language", Some(json!("Japanese")));
    assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID", "{answer}");
    assert_eq!(answer["result"]["data"], "auto");
    let answer = ui.request("/set/data/ocr_source_language", Some(json!(null)));
    assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID");
    assert_eq!(ui.ok("/get/data/ocr_source_language", None), "auto");
    ui.stop();
}

#[test]
fn read_lines_reach_the_message_pipeline_and_settings_reach_the_running_reader() {
    let fake = Fake::new();
    *fake.lines.lock().unwrap() = vec!["line-one"];
    fake.vr.store(true, Ordering::SeqCst);
    let ui = start(&fake);
    install(&ui.dir, "ppocrv6-small");

    let status = ui.ok("/get/data/ocr_capture_status", None);
    assert_eq!(
        status,
        json!({
            "active": false, "source": null, "shared_window": null, "available_sources": ["window", "vr"],
            "state": "stopped", "stage": null, "error_code": null, "detector": null,
        })
    );
    let (answer, told) = enable(&ui);
    assert_eq!(answer["result"], true, "{answer}");
    assert!(told.is_empty(), "{told:?}");
    assert_eq!(fake.roots.lock().unwrap().as_slice(), [ui.dir.join("downloaded_models")]);
    // The chatbox filter is on: the fake lines have no panel around them and are dropped.
    wait_until("three reads", || fake.read_count() >= 3);
    assert!(fake.delivered.lock().unwrap().is_empty());
    let status = ui.ok("/get/data/ocr_capture_status", None);
    assert_eq!(status["active"], true);
    assert_eq!(status["state"], "reading");
    assert_eq!(status["source"], "window");
    assert_eq!(status["detector"], "region");
    assert_eq!(ui.ok("/get/data/ocr_readiness", None)["runtime"]["state"], "reading");
    // Turning it on again changes nothing.
    assert_eq!(enable(&ui).0["result"], true);
    assert_eq!(fake.opened.lock().unwrap().len(), 1);

    // Settings reach the running reader without turning it off and on.
    assert_eq!(ui.ok("/set/disable/ocr_chatbox_filter", None), false);
    wait_until("the line delivered", || !fake.delivered.lock().unwrap().is_empty());
    let (text, language, id, current) = fake.delivered.lock().unwrap()[0].clone();
    assert_eq!(text, "line-one");
    assert_eq!(language, None, "auto reads with the target languages as the source");
    assert!(id.starts_with("transcription-ocr-") && id.len() > "transcription-ocr-".len());
    assert!(current);
    // Delivered once while it stays on screen.
    let reads = fake.read_count();
    wait_until("more reads", || fake.read_count() >= reads + 3);
    assert_eq!(fake.delivered_texts(), ["line-one"]);

    ui.ok("/set/data/ocr_min_confidence", Some(json!(0.7)));
    wait_until("a read with the new confidence", || fake.reads.lock().unwrap().last() == Some(&0.7));
    ui.ok("/set/data/ocr_window_title", Some(json!("VRChat Beta")));
    wait_until("the capture reopened", || fake.opened.lock().unwrap().last().map(String::as_str) == Some("VRChat Beta"));
    assert!(fake.closed.load(Ordering::SeqCst) >= 1, "the old capture was closed");
    // A refused setting reaches nothing.
    let answer = ui.request("/set/data/ocr_min_confidence", Some(json!(5)));
    assert_eq!(error_code(&answer), "VALIDATION_CONFIG_VALUE_INVALID");

    // A language whose recogniser is missing is refused while reading; the old one stays.
    let answer = ui.request("/set/data/ocr_source_language", Some(json!("Korean")));
    assert_eq!(error_code(&answer), "OCR_DISABLED_MODEL_MISSING", "{answer}");
    assert_eq!(answer["result"]["data"], "auto");
    assert_eq!(answer["result"]["details"], json!({ "requested_language": "Korean", "previous_language": "auto" }));
    assert_eq!(ui.ok("/get/data/ocr_source_language", None), "auto");
    install(&ui.dir, "ppocrv5-korean");
    *fake.lines.lock().unwrap() = vec!["line-two"];
    assert_eq!(ui.ok("/set/data/ocr_source_language", Some(json!("Korean"))), "Korean");
    wait_until("the second line", || fake.delivered.lock().unwrap().len() >= 2);
    assert_eq!(fake.delivered.lock().unwrap()[1].1.as_deref(), Some("Korean"));

    // Off: the worker stops and nothing more is read or delivered.
    let mark = ui.send("/set/disable/ocr_capture", None);
    assert_eq!(ui.wait_endpoint(mark, "/set/disable/ocr_capture")["result"], false);
    let status = ui.ok("/get/data/ocr_capture_status", None);
    assert_eq!((status["active"].clone(), status["state"].clone()), (json!(false), json!("stopped")));
    let (reads, delivered) = (fake.read_count(), fake.delivered.lock().unwrap().len());
    std::thread::sleep(Duration::from_millis(400));
    assert_eq!((fake.read_count(), fake.delivered.lock().unwrap().len()), (reads, delivered));
    assert_eq!(ui.ok("/set/disable/ocr_capture", None), false, "off twice is fine");

    // On again: a new worker with the stored settings.
    *fake.lines.lock().unwrap() = vec!["line-three"];
    assert_eq!(enable(&ui).0["result"], true);
    assert_eq!(fake.opened.lock().unwrap().last().map(String::as_str), Some("VRChat Beta"));
    wait_until("the third line", || fake.delivered_texts().contains(&"line-three".to_string()));
    ui.ok("/run/shutdown", None);

    // Recognised text never reaches the logs.
    let logs = std::fs::read_to_string(ui.dir.join("logs").join("process.log")).unwrap();
    assert!(logs.contains("OCR pipeline: started"), "the runtime's diagnostics are logged");
    for line in ["line-one", "line-two", "line-three"] {
        assert!(!logs.contains(line), "a read line is not logged");
    }
    // The switch is not saved: the next run starts with chat reading off.
    assert_eq!(ui.saved().get("ENABLE_OCR_CAPTURE"), None);
    ui.stop();
}

#[test]
fn shutdown_stops_the_running_capture() {
    let fake = Fake::new();
    *fake.lines.lock().unwrap() = vec!["line-one"];
    let ui = start(&fake);
    install(&ui.dir, "ppocrv6-small");
    assert_eq!(enable(&ui).0["result"], true);
    wait_until("a read", || fake.read_count() >= 1);
    ui.ok("/run/shutdown", None);
    wait_until("the worker closing its capture", || fake.closed.load(Ordering::SeqCst) == 1);
    let reads = fake.read_count();
    std::thread::sleep(Duration::from_millis(400));
    assert_eq!(fake.read_count(), reads, "nothing is read after shutdown");
    let status = ui.ok("/get/data/ocr_capture_status", None);
    assert_eq!(status["active"], false);
    // Nothing starts again once the backend shuts down.
    let (answer, told) = enable(&ui);
    assert_eq!((answer["result"].clone(), told.len()), (json!(false), 0));
    ui.stop();
}

#[test]
fn shutdown_during_a_model_load_starts_nothing() {
    let fake = Fake::new();
    *fake.lines.lock().unwrap() = vec!["line-one"];
    let ui = start(&fake);
    install(&ui.dir, "ppocrv6-small");
    fake.hold.store(true, Ordering::SeqCst);
    let mark = ui.send("/set/enable/ocr_capture", None);
    wait_until("the model load", || fake.loading.load(Ordering::SeqCst));
    let stop = ui.send("/run/shutdown", None);
    std::thread::sleep(Duration::from_millis(200));
    fake.hold.store(false, Ordering::SeqCst);
    let answer = ui.wait_endpoint(mark, "/set/enable/ocr_capture");
    assert_eq!(answer["result"], false, "{answer}");
    ui.wait_endpoint(stop, "/run/shutdown");
    assert!(ui.on(mark, "/run/enable_ocr_capture").is_empty(), "shutting down is not a failure to report");
    std::thread::sleep(Duration::from_millis(300));
    assert!(fake.opened.lock().unwrap().is_empty(), "no capture was opened");
    assert_eq!(fake.read_count(), 0);
    ui.stop();
}