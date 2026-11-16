//! Chat reading: VRChat's chat bubbles read from the screen (`controller.py`: the OCR handlers,
//! `startOcrCapture`, `ocrMessage`; `model.py`: `startOCRCapture`, `setOCRSourceLanguage`,
//! `updateOCRCaptureSettings`, `stopOCRCapture`). The capture, the engine and the pipeline are
//! `native/ocr-runtime`; this module keeps the pipeline of the run, its settings and its
//! notifications.
//!
//! What reaches outside the process (the screen, the VR runtime, ONNX Runtime and the model
//! files) goes through [`OcrPlatform`] in [`Services::ocr`](super::Services::ocr). Recognised
//! lines leave through [`Services::ocr_message`](super::Services::ocr_message) to the message
//! pipeline; nothing here logs them.

use super::routes::{Builder, OPEN, WAIT};
use super::settings::{python_str, store, switch};
use super::{Core, error, ok, python_float, python_int, python_round, run_endpoint};
use crate::errors::ErrorReply;
use crate::protocol::Reply;
use ocr_runtime::capture::SharedState;
use ocr_runtime::detection::{RegionValue, Surface};
use ocr_runtime::failure::{Clock, Log as OcrLog, MonotonicClock};
use ocr_runtime::pipeline::{
    CaptureFactory, CaptureStatus, Detector, Message, OcrPipeline, PipelineCore, PipelineHandle, PipelineOptions, ReaderFactory,
    RuntimeStatus, Settings, StartError,
};
use serde_json::{Map, Number, Value, json};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// How long shutdown waits for the worker (`_SHUTDOWN_SERVICE_STOP_TIMEOUT_SEC`).
const STOP_TIMEOUT: Duration = Duration::from_secs(5);

/// What chat reading reaches outside the process through. The default is the real screen,
/// VR runtime, ONNX Runtime and downloads ([`RealOcr`]); tests give a fake picture source and
/// a fake recogniser.
pub trait OcrPlatform: Send + Sync {
    /// ONNX Runtime can be used (`ocr_engine.isAvailable`).
    fn engine_available(&self) -> bool;
    /// Whether the window (or the headset view) can be read now; reads no pixels
    /// (`ocr_capture.probeCapture`).
    fn probe_capture(&self, window_title: &str, log: Arc<dyn OcrLog>) -> CaptureStatus;
    /// "window", and "vr" where the headset view can be read (`availableCaptureSources`).
    fn available_sources(&self, log: Arc<dyn OcrLog>) -> Vec<&'static str>;
    /// Opens the capture for a window title, on the worker thread.
    fn capture_factory(&self, log: Arc<dyn OcrLog>) -> CaptureFactory;
    /// Loads the recognisers from the verified downloads under `root` (`getReader`). Made once
    /// per run, so that a loaded engine is kept between starts.
    fn readers(&self, root: &Path) -> Arc<dyn ReaderFactory>;
    /// VRCT-VOX's chatbox detector from its verified download, `None` when it is not there
    /// (`buildChatboxDetector`).
    fn detector(&self, root: &Path, log: &Arc<dyn OcrLog>) -> Option<Box<dyn Detector>>;
    fn clock(&self) -> Arc<dyn Clock>;
}

/// The real platform: this machine's capture backends and the ONNX Runtime engine.
pub struct RealOcr {
    clock: Arc<dyn Clock>,
}

impl Default for RealOcr {
    fn default() -> Self {
        Self { clock: Arc::new(MonotonicClock::default()) }
    }
}

impl OcrPlatform for RealOcr {
    fn engine_available(&self) -> bool {
        ocr_runtime::engine::is_available()
    }
    fn probe_capture(&self, window_title: &str, log: Arc<dyn OcrLog>) -> CaptureStatus {
        ocr_runtime::capture::probe(window_title, log, Arc::clone(&self.clock))
    }
    fn available_sources(&self, log: Arc<dyn OcrLog>) -> Vec<&'static str> {
        ocr_runtime::capture::available_capture_sources(log, Arc::clone(&self.clock))
    }
    fn capture_factory(&self, log: Arc<dyn OcrLog>) -> CaptureFactory {
        ocr_runtime::capture::capture_factory(log, Arc::clone(&self.clock))
    }
    fn readers(&self, root: &Path) -> Arc<dyn ReaderFactory> {
        Arc::new(ocr_runtime::pipeline::EngineReaders::new(Some(root.to_path_buf()), ocr_runtime::engine::onnx_threads()))
    }
    fn detector(&self, root: &Path, log: &Arc<dyn OcrLog>) -> Option<Box<dyn Detector>> {
        ocr_runtime::chatbox::build_chatbox_detector(root, ocr_runtime::engine::onnx_threads(), log).map(|d| Box::new(d) as Box<dyn Detector>)
    }
    fn clock(&self) -> Arc<dyn Clock> {
        Arc::clone(&self.clock)
    }
}

/// A chat line read from the screen, for the message pipeline (the `result` dict of
/// `Controller.ocrMessage`).
#[derive(Clone, PartialEq)]
pub struct OcrMessage {
    pub text: String,
    /// The language setting of chat reading; `None` for "auto" (the pipeline then translates
    /// from the target languages, never from the user's own).
    pub language: Option<String>,
    /// The message's id in the log: `transcription-ocr-<segment id>`.
    pub id: String,
}

impl std::fmt::Debug for OcrMessage {
    // Never print recognised text.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "OcrMessage({} chars, {:?}, {})", self.text.chars().count(), self.language, self.id)
    }
}

/// Hands a read line to the message pipeline: `_processMessage(OCR_MESSAGE_SPEC, ...)`, which
/// translates it, writes the log, sends the `transcription_ocr` notification and the WebSocket
/// and overlay copies, and never sends it to VRChat's chatbox. The third argument tells whether
/// the message may still be published (false once chat reading was turned off or the backend
/// shuts down); the pipeline asks it before each output.
pub type OcrDelivery = Arc<dyn Fn(&Core, &OcrMessage, &dyn Fn() -> bool) + Send + Sync>;

/// The default [`OcrDelivery`] until the message pipeline is wired: the line is dropped.
pub(crate) fn no_delivery(_: &Core, _: &OcrMessage, _: &dyn Fn() -> bool) {}

/// The default [`OcrPlatform`].
pub(crate) fn real_platform() -> Arc<dyn OcrPlatform> {
    Arc::new(RealOcr::default())
}

/// The pipeline of the run (`model.ocr_pipeline`) and the detector it was given.
#[derive(Default)]
struct Running {
    pipeline: Option<OcrPipeline>,
    /// The running detector's settings (`_ocr_detector_path`), to tell a change.
    detector: Option<String>,
}

/// What chat reading keeps for the run.
#[derive(Default)]
pub(crate) struct Ocr {
    /// Short changes of the switch and the shutdown flag (`_OCR_CONTROL_LOCK`).
    control: Mutex<()>,
    /// `_ocr_shutting_down` and `_ocr_shutdown_requested`.
    shutting_down: AtomicBool,
    /// Start, stop, settings and language changes, in order (`_ocr_lifecycle_lock`).
    running: Mutex<Running>,
    /// The running pipeline as status polling and shutdown see it, without waiting for a start.
    handle: Mutex<Option<PipelineHandle>>,
    readers: OnceLock<Arc<dyn ReaderFactory>>,
    /// Turning chat reading off revokes the messages still on their way
    /// (`message_delivery.revoke("ocr")`).
    generation: AtomicU64,
}

impl Ocr {
    fn shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
    }

    fn handle(&self) -> Option<PipelineHandle> {
        self.handle.lock().unwrap().clone()
    }

    /// `model.stopOCRCapture`: waits up to five seconds for the worker. One that does not stop
    /// keeps its capture until the process ends.
    fn stop(&self) {
        let mut running = self.running.lock().unwrap();
        if running.pipeline.as_mut().is_some_and(|pipeline| !pipeline.stop()) {
            return;
        }
        running.pipeline = None;
        *self.handle.lock().unwrap() = None;
    }
}

/// The diagnostics of the runtime, in the backend's logs. The runtime never passes recognised
/// text or pixels here.
struct CoreLog(Arc<crate::log::Log>);

impl OcrLog for CoreLog {
    fn error(&self, message: &str) {
        self.0.error(message);
    }
    fn info(&self, message: &str) {
        self.0.step(message, None);
    }
}

fn runtime_value(status: &RuntimeStatus) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("state".into(), json!(status.state));
    map.insert("stage".into(), json!(status.stage));
    map.insert("error_code".into(), json!(status.error_code));
    map.insert("detector".into(), json!(status.detector));
    map
}

fn stopped() -> RuntimeStatus {
    RuntimeStatus { state: "stopped", stage: None, error_code: None, detector: None }
}

/// A region as the settings hold it (`{"x", "y", "width", "height"}`); anything else reads the
/// whole view, as `normalizeRegion` did.
fn region_value(value: &Value) -> RegionValue {
    let part = |key: &str| value.get(key).and_then(python_float);
    match (part("x"), part("y"), part("width"), part("height")) {
        (Some(x), Some(y), Some(w), Some(h)) => RegionValue::Values([x, y, w, h]),
        _ => RegionValue::Invalid,
    }
}

impl Core {
    fn ocr_log(&self) -> Arc<dyn OcrLog> {
        Arc::new(CoreLog(Arc::clone(self.log())))
    }

    /// Where the consented downloads are (`model_downloads.root`).
    fn ocr_model_root(&self) -> PathBuf {
        self.config().environment().state_dir.join("downloaded_models")
    }

    fn ocr_readers(&self) -> Arc<dyn ReaderFactory> {
        Arc::clone(self.ocr.readers.get_or_init(|| self.services().ocr.readers(&self.ocr_model_root())))
    }

    /// `_ocrChatboxDetector`: used when the switch is on and the download is there.
    fn ocr_detector(&self) -> Option<Box<dyn Detector>> {
        if self.config().get("OCR_USE_CHATBOX_DETECTOR") != json!(true) {
            return None;
        }
        self.services().ocr.detector(&self.ocr_model_root(), &self.ocr_log())
    }

    fn ocr_regions(&self) -> (RegionValue, RegionValue) {
        (region_value(&self.config().get("OCR_CAPTURE_REGION")), region_value(&self.config().get("OCR_VR_CAPTURE_REGION")))
    }

    /// `Controller.ocrMessage`: a read line goes to the message pipeline while chat reading is on.
    fn ocr_message(&self, message: &Message) -> bool {
        let generation = self.ocr.generation.load(Ordering::SeqCst);
        let current = || self.ocr.generation.load(Ordering::SeqCst) == generation && !self.ocr.shutting_down();
        if self.ocr.shutting_down() || self.config().get("ENABLE_OCR_CAPTURE") != json!(true) || message.text.is_empty() {
            return false;
        }
        let line = OcrMessage {
            text: message.text.clone(),
            language: message.language.clone().filter(|l| !l.is_empty()),
            id: format!("transcription-ocr-{}", message.segment_id),
        };
        (self.services().ocr_message)(self, &line, &current);
        current()
    }

    /// `model.startOCRCapture`: loads the models and starts the worker. `Ok(false)` when the
    /// backend shuts down meanwhile; an error is the `OCR_DISABLED_*` reason.
    fn start_ocr_pipeline(self: &Arc<Self>) -> Result<bool, &'static str> {
        let ocr = &self.ocr;
        if ocr.shutting_down() {
            return Ok(false);
        }
        let mut running = ocr.running.lock().unwrap();
        if ocr.shutting_down() {
            return Ok(false);
        }
        if let Some(pipeline) = running.pipeline.as_mut().filter(|p| p.is_alive()) {
            // False while the previous stop still waits for its worker.
            return pipeline.start().map_err(StartError::code);
        }
        let config = self.config();
        let language = config.get_str("OCR_SOURCE_LANGUAGE");
        let log = self.ocr_log();
        if !ocr_runtime::languages::is_supported(&language) {
            self.step("OCR: the source language is not selected or not supported, refusing to start");
            return Err(StartError::UnsupportedLanguage.code());
        }
        let platform = Arc::clone(&self.services().ocr);
        if !platform.engine_available() {
            self.step("OCR pipeline: engine unavailable, refusing to start");
            return Err(StartError::EngineUnavailable.code());
        }
        let detector = self.ocr_detector();
        let detector_key = detector.as_ref().map(|d| d.settings());
        let options = PipelineOptions {
            source_language: language,
            window_title: config.get_str("OCR_WINDOW_TITLE"),
            poll_interval_ms: python_int(&config.get("OCR_POLL_INTERVAL_MS")).unwrap_or(750),
            min_confidence: python_float(&config.get("OCR_MIN_CONFIDENCE")).unwrap_or(0.85),
            min_text_length: python_int(&config.get("OCR_BUBBLE_MIN_TEXT_LENGTH")).unwrap_or(2),
            model_root: Some(self.ocr_model_root().to_string_lossy().into_owned()),
            region: region_value(&config.get("OCR_CAPTURE_REGION")),
            chatbox_filter: config.get("OCR_CHATBOX_FILTER") == json!(true),
        };
        let weak = Arc::downgrade(self);
        let callback = Box::new(move |message: &Message| Ok(weak.upgrade().is_some_and(|core| core.ocr_message(message))));
        let factory = platform.capture_factory(Arc::clone(&log));
        let mut worker = PipelineCore::new(options, callback, detector, factory, platform.clock(), Arc::clone(&log));
        // The worker reads nothing until the switch is on (`activation_ready`).
        let switch = Arc::clone(config);
        worker.set_activation_ready(Box::new(move || switch.get("ENABLE_OCR_CAPTURE") == json!(true)));
        let probe_platform = Arc::clone(&platform);
        let probe_log = Arc::clone(&log);
        let probe = Box::new(move |title: &str| probe_platform.probe_capture(title, Arc::clone(&probe_log)));
        let mut pipeline = OcrPipeline::new(worker, self.ocr_readers(), probe);
        // Both views' regions are queued before the first capture: no window coordinates reach VR.
        let _ = pipeline.apply_config(Settings { regions: Some(self.ocr_regions()), ..Settings::default() }, None);
        running.detector = detector_key;
        *ocr.handle.lock().unwrap() = Some(pipeline.handle());
        // Shutdown may have come while the pipeline was made.
        if ocr.shutting_down() {
            pipeline.request_shutdown();
            running.pipeline = Some(pipeline);
            return Ok(false);
        }
        match pipeline.start() {
            Ok(started) => {
                running.pipeline = Some(pipeline);
                Ok(started)
            }
            Err(reason) => {
                running.pipeline = None;
                *ocr.handle.lock().unwrap() = None;
                Err(reason.code())
            }
        }
    }

    /// `startOcrCapture`: a refusal is told on `/run/enable_ocr_capture` with its reason.
    fn start_ocr_capture(self: &Arc<Self>) -> bool {
        if self.ocr.shutting_down() {
            return false;
        }
        let code = match self.start_ocr_pipeline() {
            Ok(started) => return started,
            Err(code) => code,
        };
        self.notify_error(run_endpoint("enable_ocr_capture"), ErrorReply::new(code, json!(false)));
        false
    }

    /// `updateOCRCaptureSettings`: the settings other than the language reach the running
    /// pipeline without turning it off and on. Nothing happens while none runs.
    pub(crate) fn update_ocr_settings(&self) {
        let mut running = self.ocr.running.lock().unwrap();
        if self.ocr.shutting_down() || running.pipeline.is_none() {
            return;
        }
        let detector = self.ocr_detector();
        let key = detector.as_ref().map(|d| d.settings());
        let detector = if key == running.detector {
            None
        } else {
            running.detector = key;
            Some(detector)
        };
        let config = self.config();
        let settings = Settings {
            window_title: Some(config.get_str("OCR_WINDOW_TITLE")),
            poll_interval_ms: python_int(&config.get("OCR_POLL_INTERVAL_MS")),
            min_confidence: python_float(&config.get("OCR_MIN_CONFIDENCE")),
            min_text_length: python_int(&config.get("OCR_BUBBLE_MIN_TEXT_LENGTH")),
            regions: Some(self.ocr_regions()),
            chatbox_filter: Some(config.get("OCR_CHATBOX_FILTER") == json!(true)),
            detector,
            ..Settings::default()
        };
        if let Some(pipeline) = running.pipeline.as_mut() {
            let _ = pipeline.apply_config(settings, None);
        }
    }

    /// `model.setOCRSourceLanguage`: stored while stopped (missing files are reported at the
    /// start); while running, the reader is loaded first and the worker swaps it. Never
    /// downloads. `Ok(false)` once the backend shuts down.
    fn set_ocr_language(&self, language: &str) -> Result<bool, &'static str> {
        if self.ocr.shutting_down() {
            return Ok(false);
        }
        let mut running = self.ocr.running.lock().unwrap();
        if self.ocr.shutting_down() {
            return Ok(false);
        }
        if ocr_runtime::languages::resolve_model_spec(language).is_none() {
            return Err(StartError::UnsupportedLanguage.code());
        }
        if let Some(pipeline) = running.pipeline.as_mut().filter(|p| p.is_alive()) {
            pipeline.apply_config(Settings::default(), Some(language.to_string())).map_err(StartError::code)?;
            if self.ocr.shutting_down() {
                return Ok(false);
            }
        }
        let _ = self.config().set("OCR_SOURCE_LANGUAGE", json!(language));
        Ok(true)
    }

    /// `_ocrModelReadiness`: whether the models of the selected language are on disk (sizes only).
    fn ocr_model_readiness(&self) -> Map<String, Value> {
        let language = self.config().get("OCR_SOURCE_LANGUAGE");
        let spec = language.as_str().and_then(ocr_runtime::languages::resolve_model_spec);
        let root = self.ocr_model_root();
        let mut map = Map::new();
        map.insert("language".into(), language);
        map.insert("language_supported".into(), json!(spec.is_some()));
        map.insert("required_models".into(), json!(spec.map(|s| s.model_ids()).unwrap_or_default()));
        map.insert("missing_models".into(), json!(spec.map(|s| ocr_runtime::models::missing_models(&root, &s)).unwrap_or_default()));
        map
    }

    /// `getOCRRuntime`: the worker's state, without probing anything.
    fn ocr_runtime_status(&self) -> RuntimeStatus {
        self.ocr.handle().filter(PipelineHandle::is_alive).map_or_else(stopped, |h| h.runtime_status())
    }

    /// `getOcrReadiness`: what chat reading still needs (models, window). Probing finds the
    /// window but captures nothing.
    fn ocr_readiness(&self) -> Value {
        let platform = &self.services().ocr;
        let config = self.config();
        let capture = match platform.probe_capture(&config.get_str("OCR_WINDOW_TITLE"), self.ocr_log()) {
            CaptureStatus::Ok => "ok",
            CaptureStatus::WindowNotFound => "window_not_found",
            CaptureStatus::CaptureUnavailable => "capture_unavailable",
        };
        let mut map = Map::new();
        map.insert("engine".into(), json!(platform.engine_available()));
        map.extend(self.ocr_model_readiness());
        map.insert("capture".into(), json!(capture));
        map.insert("window_title".into(), config.get("OCR_WINDOW_TITLE"));
        map.insert("detector_model".into(), json!(ocr_runtime::models::DETECTOR_MODEL_ID));
        map.insert("detector_installed".into(), json!(ocr_runtime::chatbox::is_detector_installed(&self.ocr_model_root())));
        map.insert("detector_enabled".into(), json!(config.get("OCR_USE_CHATBOX_DETECTOR") == json!(true)));
        map.insert("runtime".into(), Value::Object(runtime_value(&self.ocr_runtime_status())));
        Value::Object(map)
    }

    /// `getOcrCaptureStatus`: the worker's state for polling; never probes devices or loads models.
    fn ocr_capture_status(&self) -> Value {
        let handle = self.ocr.handle();
        let mut active = self.config().get("ENABLE_OCR_CAPTURE") == json!(true) && handle.as_ref().is_some_and(PipelineHandle::is_alive);
        let runtime = match &handle {
            Some(handle) if active => handle.runtime_status(),
            _ => stopped(),
        };
        active = active && runtime.state != "stopped";
        let view = handle.filter(|_| active).map(|h| h.capture_view()).unwrap_or_default();
        let mut map = Map::new();
        map.insert("active".into(), json!(active));
        map.insert(
            "source".into(),
            json!(view.source.map(|s| match s {
                Surface::Window => "window",
                Surface::Vr => "vr",
            })),
        );
        map.insert(
            "shared_window".into(),
            json!(view.shared_window.map(|s| match s {
                SharedState::Active => "active",
                SharedState::Ended => "ended",
            })),
        );
        map.insert("available_sources".into(), json!(self.services().ocr.available_sources(self.ocr_log())));
        map.extend(runtime_value(&runtime));
        Value::Object(map)
    }

    /// Stops chat reading at shutdown: admission closes and the worker is told without waiting
    /// for a start that still loads models; then the worker is waited for, at most five seconds.
    pub(crate) fn stop_ocr(&self) {
        {
            let _control = self.ocr.control.lock().unwrap();
            self.ocr.shutting_down.store(true, Ordering::SeqCst);
            let _ = self.config().set("ENABLE_OCR_CAPTURE", json!(false));
            if let Some(handle) = self.ocr.handle() {
                handle.request_shutdown();
            }
        }
        let ocr = Arc::clone(&self.ocr);
        let (done, finished) = std::sync::mpsc::channel();
        let spawned = std::thread::Builder::new().name("ocr_shutdown".into()).spawn(move || {
            ocr.stop();
            let _ = done.send(());
        });
        if spawned.is_err() || finished.recv_timeout(STOP_TIMEOUT).is_err() {
            self.step("shutdown: OCR capture did not stop in time");
        }
    }
}

/// Python's `round(value, 4)` for a float; other values are left as they are.
fn round4(value: &Value) -> Value {
    match value {
        Value::Number(n) if n.is_f64() => {
            n.as_f64().and_then(|f| Number::from_f64(python_round(f, 4))).map_or_else(|| value.clone(), Value::Number)
        }
        other => other.clone(),
    }
}

/// A handler whose success reaches the running pipeline (`model.updateOCRCaptureSettings()`
/// after the setting is stored).
fn then_update(core: &Arc<Core>, handler: impl Fn(&Value) -> Reply + Send + Sync + 'static) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| {
        let reply = handler(data);
        if reply.status == 200 {
            core.update_ocr_settings();
        }
        reply
    }
}

/// A capture region: its floats rounded so slider jitter does not reach `config.json`.
fn region(core: &Arc<Core>, key: &'static str) -> impl Fn(&Value) -> Reply + Send + Sync + 'static {
    let core = Arc::clone(core);
    move |data| {
        let value = match data {
            Value::Object(map) => Value::Object(map.iter().map(|(k, v)| (k.clone(), round4(v))).collect::<Map<_, _>>()),
            other => other.clone(),
        };
        match core.config().set(key, value) {
            Ok(value) => ok(value),
            Err(_) => error("VALIDATION_CONFIG_VALUE_INVALID", core.config().get(key)),
        }
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    let core = b.core;
    let title = {
        let core = Arc::clone(core);
        move |data: &Value| {
            let title = python_str(data).trim().to_string();
            match core.config().set("OCR_WINDOW_TITLE", json!(title)) {
                Ok(value) => ok(value),
                Err(_) => error("VALIDATION_CONFIG_VALUE_INVALID", core.config().get("OCR_WINDOW_TITLE")),
            }
        }
    };
    b.add("/set/data/ocr_window_title", OPEN, then_update(core, title));
    for (endpoint, key) in [
        ("/set/data/ocr_poll_interval_ms", "OCR_POLL_INTERVAL_MS"),
        ("/set/data/ocr_min_confidence", "OCR_MIN_CONFIDENCE"),
        ("/set/data/ocr_bubble_min_text_length", "OCR_BUBBLE_MIN_TEXT_LENGTH"),
    ] {
        b.add(endpoint, OPEN, then_update(core, store(core, key, "VALIDATION_CONFIG_VALUE_INVALID")));
    }
    b.add("/set/data/ocr_capture_region", OPEN, then_update(core, region(core, "OCR_CAPTURE_REGION")));
    b.add("/set/data/ocr_vr_capture_region", OPEN, then_update(core, region(core, "OCR_VR_CAPTURE_REGION")));
    for (name, key) in [("ocr_chatbox_filter", "OCR_CHATBOX_FILTER"), ("ocr_use_chatbox_detector", "OCR_USE_CHATBOX_DETECTOR")] {
        b.add(&format!("/set/enable/{name}"), OPEN, then_update(core, switch(core, key, true)));
        b.add(&format!("/set/disable/{name}"), OPEN, then_update(core, switch(core, key, false)));
    }

    // `setEnableOcrCapture`: the switch is on only once the models are loaded and the worker
    // runs; a refusal was told on `/run/enable_ocr_capture`.
    b.with("/set/enable/ocr_capture", WAIT, |core, _| {
        let enabled = {
            let _control = core.ocr.control.lock().unwrap();
            if core.ocr.shutting_down() {
                return ok(false);
            }
            core.config().get("ENABLE_OCR_CAPTURE")
        };
        if enabled == json!(false) {
            let started = core.start_ocr_capture();
            let _control = core.ocr.control.lock().unwrap();
            let _ = core.config().set("ENABLE_OCR_CAPTURE", json!(started && !core.ocr.shutting_down()));
        }
        ok(core.config().get("ENABLE_OCR_CAPTURE"))
    });
    // `setDisableOcrCapture`: messages still on their way are revoked, then the worker stops.
    b.with("/set/disable/ocr_capture", WAIT, |core, _| {
        core.ocr.generation.fetch_add(1, Ordering::SeqCst);
        if core.config().get("ENABLE_OCR_CAPTURE") == json!(true) {
            let _ = core.config().set("ENABLE_OCR_CAPTURE", json!(false));
            core.ocr.stop();
        }
        ok(core.config().get("ENABLE_OCR_CAPTURE"))
    });
    // `setOcrSourceLanguage`
    b.with("/set/data/ocr_source_language", OPEN, |core, data| {
        let previous = core.config().get("OCR_SOURCE_LANGUAGE");
        let language = python_str(data);
        if !ocr_runtime::languages::selectable_languages().contains(&language.as_str()) {
            return error("VALIDATION_CONFIG_VALUE_INVALID", previous);
        }
        match core.set_ocr_language(&language) {
            Ok(true) => ok(core.config().get("OCR_SOURCE_LANGUAGE")),
            Ok(false) => Reply::status(423, previous),
            Err(code) => Reply::error(
                ErrorReply::new(code, previous.clone()).details(json!({ "requested_language": language, "previous_language": previous })),
            ),
        }
    });
    b.with("/get/data/ocr_capture_status", OPEN, |core, _| ok(core.ocr_capture_status()));
    b.with("/get/data/ocr_readiness", OPEN, |core, _| ok(core.ocr_readiness()));
    b.with("/get/data/ocr_model_readiness", OPEN, |core, _| ok(Value::Object(core.ocr_model_readiness())));
}

#[cfg(test)]
mod tests {
    use super::{region_value, round4};
    use ocr_runtime::detection::RegionValue;
    use serde_json::json;

    #[test]
    fn floats_are_rounded_like_python() {
        assert_eq!(round4(&json!(0.123456789)), json!(0.1235));
        assert_eq!(round4(&json!(0.5)), json!(0.5));
        assert_eq!(round4(&json!(1)), json!(1));
        assert_eq!(round4(&json!("x")), json!("x"));
    }

    #[test]
    fn regions_are_read_from_the_settings_shape() {
        assert_eq!(region_value(&json!({ "x": 0.1, "y": 0, "width": "0.5", "height": 1 })), RegionValue::Values([0.1, 0.0, 0.5, 1.0]));
        assert_eq!(region_value(&json!({ "x": 0.1 })), RegionValue::Invalid);
        assert_eq!(region_value(&json!([0, 0, 1, 1])), RegionValue::Invalid);
    }
}
