//! The OCR loop: capture → candidates → OCR → bubbles → dedup → callback
//! ([`ocr_pipeline.py`]).
//!
//! Without a detector the configured region is read whole and PP-OCR's lines are
//! grouped into bubbles afterwards; with VRCT-VOX's chatbox detector each detected
//! chatbox whose centre lies in the region is read on its own. A message is delivered
//! once and suppressed while it stays on screen (and for 30 s after it leaves).
//!
//! [`PipelineCore`] is the worker's state machine (one tick at a time, everything
//! injectable); [`OcrPipeline`] runs it on its own thread with the start checks, the
//! settings queue and the stop handshake of the Python class.
//!
//! [`ocr_pipeline.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/ocr/ocr_pipeline.py

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;

use sha2::{Digest, Sha256};

use crate::capture::SharedState;
use crate::detection::{block_bounds, group_lines, looks_like_chatbox, region_pixels, BBox, Candidate, RegionCandidates, RegionValue, Surface};
use crate::engine::Word;
use crate::failure::{Clock, Failure, FailureLog, Log, Retry};
use crate::image::BgrImage;
use crate::languages::{resolve_model_spec, OcrModelSpec};
use crate::text::{merge_words, similar, text_key};

/// At most this many candidates get OCR on one tick, within this share of the interval.
pub const MAX_CANDIDATES_PER_TICK: usize = 6;
pub const TICK_OCR_BUDGET_RATIO: f64 = 0.8;
pub const ENGINE_BACKOFF_THRESHOLD: u32 = 3;
pub const ENGINE_BACKOFF_INITIAL_SEC: f64 = 1.0;
pub const ENGINE_BACKOFF_MAX_SEC: f64 = 30.0;
/// A few dozen word lists, never frames; reads are refreshed after twenty seconds.
pub const RECOGNITION_CACHE_SIZE: usize = 32;
pub const RECOGNITION_REFRESH_SEC: f64 = 20.0;
/// How often the tick breakdown is logged (frames / candidates / reads), to tell where
/// a silent reader stops.
pub const STATUS_INTERVAL_SEC: f64 = 30.0;
/// A delivered message is forgotten this long after it was last seen. Not a setting:
/// set to one second by a user, the same text kept coming back.
pub const DEDUP_RETENTION_SEC: f64 = 30.0;
pub const DEDUP_MAX_ITEMS: usize = 128;

/// Why reading could not start (`ErrorCode.OCR_DISABLED_*`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartError {
    EngineUnavailable,
    ModelLoadFailed,
    UnsupportedLanguage,
    ModelMissing,
    WindowNotFound,
    CaptureUnavailable,
    Unknown,
}

impl StartError {
    /// The error code the UI and the IPC contract use.
    pub fn code(self) -> &'static str {
        match self {
            StartError::EngineUnavailable => "OCR_DISABLED_ENGINE_UNAVAILABLE",
            StartError::ModelLoadFailed => "OCR_DISABLED_MODEL_LOAD_FAILED",
            StartError::UnsupportedLanguage => "OCR_DISABLED_UNSUPPORTED_LANGUAGE",
            StartError::ModelMissing => "OCR_DISABLED_MODEL_MISSING",
            StartError::WindowNotFound => "OCR_DISABLED_WINDOW_NOT_FOUND",
            StartError::CaptureUnavailable => "OCR_DISABLED_CAPTURE_UNAVAILABLE",
            StartError::Unknown => "OCR_DISABLED_UNKNOWN",
        }
    }
}

impl std::fmt::Display for StartError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

/// What `probeCapture` found before the worker starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureStatus {
    Ok,
    WindowNotFound,
    CaptureUnavailable,
}

/// Reads one crop. Errors are inference failures; no text is an empty list.
pub trait Reader: Send + Sync {
    fn read(&self, crop: &BgrImage, min_confidence: f64) -> std::result::Result<Vec<Word>, Failure>;
}

/// The capture facade the worker reads frames from (`OcrCapture`).
pub trait FrameSource: Send {
    /// The newest frame, or `None` (no window, minimized, failed and already logged).
    fn get(&mut self) -> Option<BgrImage>;
    /// Which backend is selected ("hwnd", "x11", "portal", "openvr_mirror", "none").
    fn backend(&self) -> String;
    /// The view the last frame came from.
    fn source(&self) -> Option<Surface>;
    /// A capture failure was logged and has not recovered yet.
    fn failure_active(&self) -> bool;
    /// Whether a window shared through the portal is read, or was and is gone (Linux).
    fn shared_window(&self) -> Option<SharedState> {
        None
    }
    fn close(&mut self);
}

/// What the controller shows of the capture: the view the last frame came from and the
/// shared window's state (`getOcrCaptureStatus`'s `source` and `shared_window`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CaptureView {
    pub source: Option<Surface>,
    pub shared_window: Option<SharedState>,
}

/// Where candidates come from: the region itself, or a detector.
pub trait Detector: Send {
    fn name(&self) -> String;
    /// One candidate may hold several bubbles (the region); detections are one each.
    fn splits_bubbles(&self) -> bool;
    fn is_available(&self) -> bool;
    fn load_model(&mut self) -> std::result::Result<(), Failure>;
    fn detect(&mut self, frame: &BgrImage) -> std::result::Result<Vec<Candidate>, Failure>;
    /// The detector's own settings; a change invalidates reused readings.
    fn settings(&self) -> String;
}

impl Detector for crate::chatbox::ChatboxDetector {
    fn name(&self) -> String {
        "vrct-vox-chatbox".into()
    }
    fn splits_bubbles(&self) -> bool {
        false
    }
    fn is_available(&self) -> bool {
        crate::chatbox::ChatboxDetector::is_available(self)
    }
    fn load_model(&mut self) -> std::result::Result<(), Failure> {
        crate::chatbox::ChatboxDetector::load_model(self).map_err(|e| Failure::from(&e))
    }
    fn detect(&mut self, frame: &BgrImage) -> std::result::Result<Vec<Candidate>, Failure> {
        crate::chatbox::ChatboxDetector::detect(self, frame).map_err(|e| Failure::new("OcrDetectorError", e.to_string()))
    }
    fn settings(&self) -> String {
        format!("{}|{}|{}|{}|{}", self.model_path.display(), self.image_size, self.confidence, self.crop_padding, self.nms_iou)
    }
}

/// A delivered message.
#[derive(Clone, PartialEq)]
pub struct Message {
    pub text: String,
    /// The source language setting, `None` for "auto".
    pub language: Option<String>,
    pub segment_id: String,
}

impl std::fmt::Debug for Message {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Message({} chars, {:?})", self.text.chars().count(), self.language)
    }
}

/// Opens the capture for a window title (on the worker thread).
pub type CaptureFactory = Arc<dyn Fn(&str) -> Box<dyn FrameSource> + Send + Sync>;

/// Takes a message; `Ok(false)` declines it (it stays eligible), an error is a tick
/// failure.
pub type Callback = Box<dyn FnMut(&Message) -> std::result::Result<bool, Failure> + Send>;

/// The worker's state as the controller reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeStatus {
    /// "waiting", "reading", "retrying" or "stopped".
    pub state: &'static str,
    pub stage: Option<&'static str>,
    pub error_code: Option<&'static str>,
    pub detector: Option<String>,
}

/// A settings change for a running pipeline (`applyConfig`); `None` leaves a value.
#[derive(Default)]
pub struct Settings {
    pub poll_interval_ms: Option<i64>,
    pub min_confidence: Option<f64>,
    pub min_text_length: Option<i64>,
    pub region: Option<RegionValue>,
    pub regions: Option<(RegionValue, RegionValue)>,
    pub chatbox_filter: Option<bool>,
    /// `Some(None)` returns to reading the region.
    pub detector: Option<Option<Box<dyn Detector>>>,
    pub window_title: Option<String>,
    /// A language with its already loaded reader.
    pub language_reader: Option<(String, Arc<dyn Reader>)>,
}

// ---- caches ------------------------------------------------------------------------

/// `(width, height, SHA-256 of the pixels)`.
pub type CropKey = (usize, usize, [u8; 32]);

pub fn crop_key(crop: &BgrImage) -> CropKey {
    let digest = Sha256::digest(&crop.data);
    (crop.width, crop.height, digest.into())
}

/// LRU of successful reads (including empty ones). A hit updates recency, not the read
/// time: a crop that stays on screen is still read again after twenty seconds.
#[derive(Default)]
pub struct RecognitionCache {
    items: Vec<(CropKey, f64, Vec<Word>)>,
}

impl RecognitionCache {
    pub fn get(&mut self, key: &CropKey, now: f64) -> Option<Vec<Word>> {
        let index = self.items.iter().position(|item| &item.0 == key)?;
        if now - self.items[index].1 >= RECOGNITION_REFRESH_SEC {
            self.items.remove(index);
            return None;
        }
        let item = self.items.remove(index);
        let words = item.2.clone();
        self.items.push(item);
        Some(words)
    }

    pub fn record(&mut self, key: CropKey, words: Vec<Word>, read_at: f64) {
        if let Some(index) = self.items.iter().position(|item| item.0 == key) {
            self.items.remove(index);
        }
        self.items.push((key, read_at, words));
        while self.items.len() > RECOGNITION_CACHE_SIZE {
            self.items.remove(0);
        }
    }

    /// Identical pixels still show these words even when a read is due. This only
    /// refreshes delivered-text visibility; it never delivers.
    pub fn visible_words(&self, key: &CropKey) -> Vec<Word> {
        self.items.iter().find(|item| &item.0 == key).map(|item| item.2.clone()).unwrap_or_default()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

/// Delivered messages, suppressed while they are remembered (`_DedupCache`).
///
/// Entries keep the last time they were seen, refreshed on every sighting, so the
/// retention counts from when a bubble left the screen. Under five characters only
/// exact matches count; longer texts allow 20 % (at most two) edits as OCR jitter.
pub struct DedupCache {
    /// (key, last seen, text, centre), oldest first.
    pub items: Vec<(String, f64, String, (i64, i64))>,
    max_items: usize,
}

impl Default for DedupCache {
    fn default() -> Self {
        DedupCache::with_capacity(DEDUP_MAX_ITEMS)
    }
}

impl DedupCache {
    pub fn with_capacity(max_items: usize) -> Self {
        DedupCache { items: Vec::new(), max_items }
    }

    pub fn evict_stale(&mut self, now: f64, retention: f64) {
        self.items.retain(|item| now - item.1 <= retention);
        while self.items.len() > self.max_items {
            self.items.remove(0);
        }
    }

    /// True when remembered; the sighting refreshes the entry.
    pub fn seen(&mut self, key: &str, text: &str, now: f64) -> bool {
        if let Some(index) = self.items.iter().position(|item| item.0 == key) {
            let mut item = self.items.remove(index);
            item.1 = now;
            item.2 = text.to_string();
            self.items.push(item);
            return true;
        }
        if let Some(index) = self.items.iter().position(|item| similar(text, &item.2, 2)) {
            let mut item = self.items.remove(index);
            item.1 = now;
            self.items.push(item);
            return true;
        }
        false
    }

    pub fn record(&mut self, key: String, text: &str, center: (i64, i64), now: f64) {
        if let Some(index) = self.items.iter().position(|item| item.0 == key) {
            self.items.remove(index);
        }
        self.items.push((key, now, text.to_string(), center));
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

fn box_overlap(a: BBox, b: BBox) -> f64 {
    let (ax, ay, aw, ah) = a;
    let (bx, by, bw, bh) = b;
    let intersection = 0.max((ax + aw).min(bx + bw) - ax.max(bx)) * 0.max((ay + ah).min(by + bh) - ay.max(by));
    let union = aw * ah + bw * bh - intersection;
    if union > 0 {
        intersection as f64 / union as f64
    } else {
        0.0
    }
}

fn segment_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut parts = [0u64; 2];
    for (i, part) in parts.iter_mut().enumerate() {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u64(count);
        hasher.write_usize(i);
        hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        *part = hasher.finish();
    }
    format!("{:016x}{:016x}", parts[0], parts[1])
}

// ---- the worker's state machine ------------------------------------------------------

/// Counters for the periodic status line.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Counts {
    pub tick: u64,
    pub frame: u64,
    pub candidate: u64,
    pub ocr: u64,
    pub reused: u64,
    pub text: u64,
    pub bubble: u64,
    pub emit: u64,
}

/// Which detector is in use: the built-in region reader or another one.
enum Candidates {
    Region,
    Other(Box<dyn Detector>),
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

/// Everything the worker thread owns (the body of Python's `OcrPipeline`).
pub struct PipelineCore {
    pub clock: Arc<dyn Clock>,
    log: Arc<dyn Log>,
    callback: Callback,
    activation_ready: Box<dyn Fn() -> bool + Send>,
    pub source_language: String,
    pub window_title: String,
    pub poll_interval: f64,
    pub tick_budget: f64,
    pub min_confidence: f64,
    pub min_text_length: usize,
    pub model_root: Option<String>,
    pub region_source: RegionCandidates,
    candidates_from: Candidates,
    /// Changes whenever the detector object is replaced.
    detector_id: u64,
    pub chatbox_filter: bool,
    pub dedup: DedupCache,
    pub recognition: RecognitionCache,
    recognition_context: Option<String>,
    pub reader: Option<Arc<dyn Reader>>,
    pub capture: Option<Box<dyn FrameSource>>,
    capture_id: u64,
    capture_factory: CaptureFactory,
    pub counts: Counts,
    counts_since: f64,
    pub last_tick_at: f64,
    candidate_attempts: Vec<(BBox, u64)>,
    attempt_number: u64,
    pub engine_failures: FailureLog,
    pub engine_failure_count: u32,
    pub engine_backoff: f64,
    pub engine_retry_at: f64,
    pub capture_retry: Retry,
    pub detector_retry: Retry,
    pub tick_retry: Retry,
    pub runtime: RuntimeStatus,
    stopped: Arc<AtomicBool>,
    /// Region regions follow the capture's actual source.
    source_regions: bool,
}

/// Options for a new pipeline (Python's constructor arguments).
pub struct PipelineOptions {
    pub source_language: String,
    pub window_title: String,
    pub poll_interval_ms: i64,
    pub min_confidence: f64,
    pub min_text_length: i64,
    pub model_root: Option<String>,
    pub region: RegionValue,
    pub chatbox_filter: bool,
}

impl Default for PipelineOptions {
    fn default() -> Self {
        PipelineOptions {
            source_language: "auto".into(),
            window_title: "VRChat".into(),
            poll_interval_ms: 750,
            min_confidence: 0.55,
            min_text_length: 2,
            model_root: None,
            region: RegionValue::Values([0.0, 0.0, 1.0, 1.0]),
            chatbox_filter: true,
        }
    }
}

impl PipelineCore {
    #[allow(clippy::too_many_arguments)]
    pub fn new(options: PipelineOptions, callback: Callback, detector: Option<Box<dyn Detector>>, capture_factory: CaptureFactory, clock: Arc<dyn Clock>, log: Arc<dyn Log>) -> PipelineCore {
        let poll_interval = (options.poll_interval_ms as f64 / 1000.0).max(0.1);
        let failure_log = |origin: &str| FailureLog::new(origin, log.clone(), clock.clone());
        let source_language = if options.source_language.is_empty() { "auto".to_string() } else { options.source_language };
        let window_title = if options.window_title.is_empty() { "VRChat".to_string() } else { options.window_title };
        PipelineCore {
            callback,
            activation_ready: Box::new(|| true),
            source_language,
            window_title,
            poll_interval,
            tick_budget: poll_interval * TICK_OCR_BUDGET_RATIO,
            min_confidence: options.min_confidence,
            min_text_length: options.min_text_length.max(1) as usize,
            model_root: options.model_root,
            region_source: RegionCandidates::new(options.region),
            candidates_from: detector.map_or(Candidates::Region, Candidates::Other),
            detector_id: next_id(),
            chatbox_filter: options.chatbox_filter,
            dedup: DedupCache::default(),
            recognition: RecognitionCache::default(),
            recognition_context: None,
            reader: None,
            capture: None,
            capture_id: 0,
            capture_factory,
            counts: Counts::default(),
            counts_since: 0.0,
            last_tick_at: 0.0,
            candidate_attempts: Vec::new(),
            attempt_number: 0,
            engine_failures: failure_log("OCR engine"),
            engine_failure_count: 0,
            engine_backoff: 0.0,
            engine_retry_at: 0.0,
            capture_retry: Retry::new(failure_log("OCR capture")),
            detector_retry: Retry::new(failure_log("OCR detector")),
            tick_retry: Retry::new(failure_log("OCR tick")),
            runtime: RuntimeStatus { state: "waiting", stage: Some("capture"), error_code: None, detector: None },
            stopped: Arc::new(AtomicBool::new(false)),
            source_regions: false,
            clock,
            log,
        }
    }

    pub fn set_activation_ready(&mut self, ready: Box<dyn Fn() -> bool + Send>) {
        self.activation_ready = ready;
    }

    pub fn set_callback(&mut self, callback: Callback) {
        self.callback = callback;
    }

    pub fn set_reader(&mut self, reader: Option<Arc<dyn Reader>>) {
        self.reader = reader;
    }

    pub fn set_capture(&mut self, capture: Option<Box<dyn FrameSource>>) {
        self.capture = capture;
        self.capture_id = next_id();
    }

    /// Replace the detector object (`None`: read the region).
    pub fn set_detector(&mut self, detector: Option<Box<dyn Detector>>) {
        self.candidates_from = detector.map_or(Candidates::Region, Candidates::Other);
        self.detector_id = next_id();
    }

    pub fn detector_mut(&mut self) -> Option<&mut Box<dyn Detector>> {
        match &mut self.candidates_from {
            Candidates::Other(detector) => Some(detector),
            Candidates::Region => None,
        }
    }

    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        self.stopped.clone()
    }

    fn stopping(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    /// The view whose region applies: the capture's, once per-view regions were set
    /// (until then the window's region applies to every frame).
    fn region_surface(&self) -> Option<Surface> {
        if self.source_regions {
            self.capture.as_ref().and_then(|c| c.source())
        } else {
            None
        }
    }

    /// The region the worker currently reads.
    pub fn current_region(&self) -> crate::detection::Region {
        self.region_source.region(self.region_surface())
    }

    /// Which candidate source reads frames ("region" without a detector).
    pub fn detector_name(&self) -> String {
        match &self.candidates_from {
            Candidates::Region => "region".into(),
            Candidates::Other(detector) => detector.name(),
        }
    }

    pub fn reset_failures(&mut self) {
        self.engine_failures.reset();
        self.tick_retry.reset();
        self.capture_retry.reset();
        self.detector_retry.reset();
        self.reset_engine_backoff();
    }

    pub fn runtime_status(&self) -> RuntimeStatus {
        if self.stopping() {
            return RuntimeStatus { state: "stopped", stage: None, error_code: None, detector: None };
        }
        RuntimeStatus { detector: Some(self.detector_name()), ..self.runtime.clone() }
    }

    fn set_runtime(&mut self, state: &'static str, stage: Option<&'static str>, error: Option<StartError>) {
        self.runtime = RuntimeStatus { state, stage, error_code: error.map(StartError::code), detector: Some(self.detector_name()) };
    }

    fn retry_mut(&mut self, stage: &str) -> &mut Retry {
        match stage {
            "capture" => &mut self.capture_retry,
            "detector" => &mut self.detector_retry,
            _ => &mut self.tick_retry,
        }
    }

    pub fn stage_failure(&mut self, stage: &'static str, failure: Option<&Failure>) {
        self.reset_recognition();
        self.retry_mut(stage).failure(failure);
        let code = match stage {
            "capture" => StartError::CaptureUnavailable,
            "detector" => StartError::ModelLoadFailed,
            _ => StartError::Unknown,
        };
        self.set_runtime("retrying", Some(stage), Some(code));
    }

    pub fn age_dedup(&mut self, now: f64) {
        // Empty, frameless and cooldown ticks count as cadence too.
        let interval = if self.last_tick_at != 0.0 { now - self.last_tick_at } else { 0.0 };
        self.last_tick_at = now;
        self.dedup.evict_stale(now, DEDUP_RETENTION_SEC.max(interval * 2.0));
    }

    fn reset_engine_backoff(&mut self) {
        self.engine_failure_count = 0;
        self.engine_backoff = 0.0;
        self.engine_retry_at = 0.0;
    }

    pub fn reset_recognition(&mut self) {
        self.recognition = RecognitionCache::default();
        self.recognition_context = None;
    }

    fn sync_recognition_context(&mut self) {
        let spec = resolve_model_spec(&self.source_language).map(|s| s.label());
        let reader_ptr = self.reader.as_ref().map(|r| Arc::as_ptr(r) as *const () as usize).unwrap_or(0);
        let detector = match &self.candidates_from {
            Candidates::Region => format!("region|{}|true", self.region_source.max_side),
            Candidates::Other(d) => format!("{}|{}", d.settings(), d.splits_bubbles()),
        };
        let source = self.region_surface();
        let context = format!(
            "{}|{:?}|{:?}|{}|{}|{}|{:?}|{}|{}|{:?}|{}|reader={}|capture={}|detector={}",
            self.source_language,
            spec,
            self.model_root,
            self.min_confidence,
            self.min_text_length,
            self.poll_interval,
            self.region_source.region(source),
            self.chatbox_filter,
            self.window_title,
            self.capture.as_ref().map(|c| c.backend()),
            detector,
            reader_ptr,
            self.capture_id,
            self.detector_id,
        );
        if self.recognition_context.as_deref() != Some(context.as_str()) {
            self.reset_recognition();
            self.recognition_context = Some(context);
            self.candidate_attempts.clear();
        }
    }

    /// Fold queued settings in. Only the worker calls this.
    pub fn apply_pending(&mut self, pending: Settings) {
        if self.stopping() {
            return;
        }
        self.reset_recognition();
        if let Some(ms) = pending.poll_interval_ms {
            self.poll_interval = (ms as f64 / 1000.0).max(0.1);
            self.tick_budget = self.poll_interval * TICK_OCR_BUDGET_RATIO;
        }
        if let Some(value) = pending.min_confidence {
            if value.is_finite() {
                self.min_confidence = value;
            }
        }
        if let Some(value) = pending.min_text_length {
            self.min_text_length = value.max(1) as usize;
        }
        if let Some(region) = pending.region {
            self.region_source.set_region(region);
        }
        if let Some((window, vr)) = pending.regions {
            self.region_source.set_source_regions(window, vr);
            self.source_regions = true;
        }
        if let Some(value) = pending.chatbox_filter {
            self.chatbox_filter = value;
        }
        if let Some(detector) = pending.detector {
            self.switch_detector(detector);
        }
        // Switching to a script model swaps the reader; the same model stays cached.
        if let Some((language, reader)) = pending.language_reader {
            if language != self.source_language {
                let same = self.reader.as_ref().is_some_and(|r| Arc::ptr_eq(r, &reader));
                if !same {
                    self.engine_failures.reset();
                    self.reset_engine_backoff();
                }
                self.reader = Some(reader);
                self.source_language = language;
                // The same bubble may read differently now; drop what was suppressed.
                self.dedup = DedupCache::default();
            }
        }
        // The capture holds OS resources on this thread, so it is reopened here.
        if let Some(title) = pending.window_title {
            if !self.stopping() && !title.is_empty() && title != self.window_title {
                self.window_title = title;
                if let Some(capture) = self.capture.as_mut() {
                    capture.close();
                }
                let capture = (self.capture_factory)(&self.window_title);
                self.set_capture(Some(capture));
            }
        }
    }

    /// A detector that cannot be used falls back to the region; reading never stops.
    fn switch_detector(&mut self, detector: Option<Box<dyn Detector>>) {
        let mut replacement = detector;
        if let Some(candidate) = replacement.as_mut() {
            if !candidate.is_available() {
                self.log.info(&format!("OCR pipeline: detector {:?} unavailable, reading the region instead", candidate.name()));
                replacement = None;
            } else if let Err(failure) = candidate.load_model() {
                self.log.error(&format!("OCR pipeline: {}: {}", failure.kind, failure.message));
                self.log.info("OCR pipeline: bubble detector model load failed, reading the region instead");
                replacement = None;
            }
        }
        let changed = !(replacement.is_none() && matches!(self.candidates_from, Candidates::Region));
        if changed {
            self.set_detector(replacement);
            self.detector_retry.reset();
            if self.runtime.stage == Some("detector") {
                self.set_runtime("waiting", Some("capture"), None);
            }
            self.log.info(&format!("OCR pipeline: candidates={}", self.detector_name()));
        }
    }

    /// Keep detections whose centre lies in the region (the whole frame is detected, at
    /// the training scale; a bubble on the edge is read whole).
    fn in_region(&self, candidates: Vec<Candidate>, frame: &BgrImage) -> Vec<Candidate> {
        let source = self.region_surface();
        let (x, y, w, h) = region_pixels(self.region_source.region(source), frame.width, frame.height);
        if (x, y, w, h) == (0, 0, frame.width as i64, frame.height as i64) {
            return candidates;
        }
        candidates
            .into_iter()
            .filter(|((bx, by, bw, bh), _)| {
                let (cx, cy) = (*bx as f64 + *bw as f64 / 2.0, *by as f64 + *bh as f64 / 2.0);
                x as f64 <= cx && cx < (x + w) as f64 && y as f64 <= cy && cy < (y + h) as f64
            })
            .collect()
    }

    fn emit(&mut self, text: &str) -> std::result::Result<bool, Failure> {
        if self.stopping() || !(self.activation_ready)() {
            return Ok(false);
        }
        let message = Message { text: text.to_string(), language: (self.source_language != "auto").then(|| self.source_language.clone()), segment_id: segment_id() };
        (self.callback)(&message)
    }

    /// Carry attempt order across confidence changes and small box motion.
    fn order_candidates(&mut self, candidates: Vec<Candidate>) -> Vec<Candidate> {
        let mut previous = std::mem::take(&mut self.candidate_attempts);
        let mut attempts: Vec<(BBox, u64)> = Vec::new();
        for (bbox, _) in &candidates {
            let best = previous.iter().enumerate().fold(None::<(usize, f64)>, |best, (i, (old, _))| {
                let overlap = box_overlap(*bbox, *old);
                match best {
                    Some((_, b)) if b >= overlap => best,
                    _ => Some((i, overlap)),
                }
            });
            let attempt = match best {
                Some((i, overlap)) if overlap >= 0.5 => previous.remove(i).1,
                _ => 0,
            };
            if let Some(entry) = attempts.iter_mut().find(|(b, _)| b == bbox) {
                entry.1 = attempt;
            } else {
                attempts.push((*bbox, attempt));
            }
        }
        self.candidate_attempts = attempts;
        let attempt_of = |bbox: &BBox, attempts: &[(BBox, u64)]| attempts.iter().find(|(b, _)| b == bbox).map_or(0, |a| a.1);
        let mut ordered = candidates;
        ordered.sort_by_key(|(bbox, _)| attempt_of(bbox, &self.candidate_attempts));
        ordered
    }

    fn set_attempt(&mut self, bbox: BBox, attempt: u64) {
        if let Some(entry) = self.candidate_attempts.iter_mut().find(|(b, _)| *b == bbox) {
            entry.1 = attempt;
        } else {
            self.candidate_attempts.push((bbox, attempt));
        }
    }

    /// The periodic breakdown of the ticks.
    pub fn log_status(&mut self, now: f64) {
        if self.counts_since == 0.0 {
            self.counts_since = now;
            return;
        }
        if now - self.counts_since < STATUS_INTERVAL_SEC {
            return;
        }
        let c = &self.counts;
        self.log.info(&format!(
            "OCR status ({:.0}s): tick={} frame={} candidate={} ocr={} reused={} text={} bubble={} emit={} lang={:?}",
            now - self.counts_since,
            c.tick,
            c.frame,
            c.candidate,
            c.ocr,
            c.reused,
            c.text,
            c.bubble,
            c.emit,
            self.source_language
        ));
        self.counts = Counts::default();
        self.counts_since = now;
    }

    /// One tick: capture, candidates, reads, delivery. An error is a tick failure.
    pub fn tick(&mut self) -> std::result::Result<(), Failure> {
        if self.stopping() || !(self.activation_ready)() {
            return Ok(());
        }
        self.counts.tick += 1;
        let tick_at = self.clock.now();
        self.age_dedup(tick_at);
        self.log_status(tick_at);
        self.engine_failures.report(tick_at);
        self.capture_retry.log.report(tick_at);
        self.detector_retry.log.report(tick_at);
        self.tick_retry.log.report(tick_at);
        // During a cooldown keep polling settings and stop, but do not capture or read.
        let retry_at = self.engine_retry_at.max(self.capture_retry.retry_at).max(self.detector_retry.retry_at).max(self.tick_retry.retry_at);
        if tick_at < retry_at {
            return Ok(());
        }
        if self.capture.is_none() || self.reader.is_none() {
            return Ok(());
        }
        let frame = self.capture.as_mut().expect("checked").get();
        if self.stopping() {
            return Ok(());
        }
        // get() can select another backend or fall back from VR to the desktop window.
        self.sync_recognition_context();
        let Some(frame) = frame else {
            self.reset_recognition();
            if self.capture.as_ref().is_some_and(|c| c.failure_active()) {
                self.stage_failure("capture", None);
            } else if self.runtime.state != "retrying" {
                self.set_runtime("waiting", Some("capture"), None);
            }
            return Ok(());
        };
        self.capture_retry.success();
        self.counts.frame += 1;
        let source = self.region_surface();
        let detected = match &mut self.candidates_from {
            Candidates::Region => Ok(self.region_source.detect(&frame, source)),
            Candidates::Other(detector) => detector.detect(&frame),
        };
        let mut candidates = match detected {
            Ok(candidates) => candidates,
            Err(failure) => {
                // Pause rather than widen the reading scope by switching to the region.
                self.stage_failure("detector", Some(&failure));
                return Ok(());
            }
        };
        self.detector_retry.success();
        if self.engine_failure_count == 0 {
            self.set_runtime("reading", None, None);
        }
        let splits = match &self.candidates_from {
            Candidates::Region => true,
            Candidates::Other(detector) => detector.splits_bubbles(),
        };
        if !candidates.is_empty() && !matches!(self.candidates_from, Candidates::Region) {
            candidates = self.in_region(candidates, &frame);
        }
        if candidates.is_empty() {
            self.candidate_attempts.clear();
            return Ok(());
        }
        self.counts.candidate += candidates.len() as u64;
        // A frame can hold several bubbles (and a few non-bubbles): only the strongest
        // few get a reading budget on one tick.
        candidates.truncate(MAX_CANDIDATES_PER_TICK);
        let candidates = self.order_candidates(candidates);

        let now = self.clock.now();
        let deadline = now + self.tick_budget;
        let keyed: Vec<(BBox, BgrImage, CropKey)> = candidates
            .into_iter()
            .map(|(bbox, crop)| {
                let key = crop_key(&crop);
                (bbox, crop, key)
            })
            .collect();
        // A slow rotation can outlast the retention: refresh known identical crops
        // even when their next read is outside the budget.
        for (bbox, crop, key) in &keyed {
            let words = self.recognition.visible_words(key);
            if words.is_empty() {
                continue;
            }
            for (block, _) in self.bubbles(*bbox, crop, &words, splits) {
                let text = merge_words(&block);
                self.dedup.seen(&text_key(&text), &text, now);
            }
        }

        for (bbox, crop, key) in &keyed {
            if self.stopping() {
                return Ok(());
            }
            let read_at = self.clock.now();
            if read_at > deadline {
                break;
            }
            self.attempt_number += 1;
            self.set_attempt(*bbox, self.attempt_number);
            let words = match self.recognition.get(key, read_at) {
                Some(words) => {
                    // Reuse says nothing about engine health.
                    self.counts.reused += 1;
                    words
                }
                None => {
                    self.counts.ocr += 1;
                    let reader = self.reader.clone().expect("checked");
                    match reader.read(crop, self.min_confidence) {
                        Ok(words) => {
                            self.engine_failures.success();
                            self.reset_engine_backoff();
                            self.set_runtime("reading", None, None);
                            self.recognition.record(*key, words.clone(), read_at);
                            words
                        }
                        Err(failure) => {
                            // Earlier cached successes must not hide a broken reader.
                            self.reset_recognition();
                            self.engine_failures.failure(&failure);
                            self.set_runtime("retrying", Some("recognition"), Some(StartError::EngineUnavailable));
                            self.engine_failure_count += 1;
                            if self.engine_failure_count >= ENGINE_BACKOFF_THRESHOLD {
                                self.engine_backoff = (self.engine_backoff * 2.0).clamp(ENGINE_BACKOFF_INITIAL_SEC, ENGINE_BACKOFF_MAX_SEC);
                                self.engine_retry_at = self.clock.now() + self.engine_backoff;
                            }
                            // The other crops use the same reader: retry on a later tick.
                            return Ok(());
                        }
                    }
                }
            };
            if words.is_empty() {
                continue;
            }
            self.counts.text += 1;
            for (block, center) in self.bubbles(*bbox, crop, &words, splits) {
                self.counts.bubble += 1;
                let merged = merge_words(&block);
                if merged.chars().count() < self.min_text_length {
                    continue;
                }
                let key = text_key(&merged);
                if self.dedup.seen(&key, &merged, now) {
                    continue;
                }
                if self.emit(&merged)? {
                    self.dedup.record(key, &merged, center, now);
                    self.counts.emit += 1;
                }
            }
        }
        Ok(())
    }

    /// One candidate's lines split into bubbles, with their centres. Detections are one
    /// bubble each; region crops are regrouped. Both drop what does not look like a
    /// chatbox (measured on the lab's validation split, the detector path only loses
    /// faded grey bubbles, which were read while they were bright).
    pub fn bubbles(&self, bbox: BBox, crop: &BgrImage, words: &[Word], splits: bool) -> Vec<(Vec<Word>, (i64, i64))> {
        let center = ((bbox.0 as f64 + bbox.2 as f64 / 2.0) as i64, (bbox.1 as f64 + bbox.3 as f64 / 2.0) as i64);
        if !splits {
            if self.chatbox_filter && !looks_like_chatbox(crop, words) {
                return Vec::new();
            }
            return vec![(words.to_vec(), center)];
        }
        let mut out = Vec::new();
        for block in group_lines(words) {
            if self.chatbox_filter && !looks_like_chatbox(crop, &block) {
                continue;
            }
            let block_center = match block_bounds(&block) {
                Some(b) => ((bbox.0 as f64 + b.0 as f64 + b.2 as f64 / 2.0) as i64, (bbox.1 as f64 + b.1 as f64 + b.3 as f64 / 2.0) as i64),
                None => center,
            };
            out.push((block, block_center));
        }
        out
    }

    /// The worker loop (`_run`). Returns when `stop` is set; closes the capture.
    pub fn run(&mut self, shared: &Shared) {
        if self.stopping() {
            return;
        }
        crate::priority::lower_current_thread();
        while !self.stopping() {
            let start = self.clock.now();
            self.tick_retry.log.report(start);
            let pending = shared.take_pending();
            let result = (|| -> std::result::Result<(), Failure> {
                if let Some(pending) = pending {
                    self.apply_pending(pending);
                }
                if start >= self.tick_retry.retry_at {
                    if self.capture.is_none() {
                        let capture = (self.capture_factory)(&self.window_title);
                        self.set_capture(Some(capture));
                    }
                    self.tick()?;
                    self.tick_retry.success();
                } else {
                    self.age_dedup(start);
                }
                Ok(())
            })();
            if let Err(failure) = result {
                self.stage_failure("tick", Some(&failure));
            }
            shared.publish(self);
            let elapsed = self.clock.now() - start;
            let sleep = self.poll_interval - elapsed;
            if sleep > 0.0 {
                shared.wait(sleep);
            }
        }
        self.stopped.store(true, Ordering::SeqCst);
        self.reset_recognition();
        if let Some(capture) = self.capture.as_mut() {
            capture.close();
        }
        shared.publish(self);
    }
}

// ---- the thread and lifecycle ----------------------------------------------------------

/// What the controller thread and the worker share.
pub struct Shared {
    pending: Mutex<Option<Settings>>,
    /// The same flag as the core's: set by `stop()`, read by the worker.
    stopped: Arc<AtomicBool>,
    sleep: Mutex<()>,
    wake: Condvar,
    status: Mutex<RuntimeStatus>,
    /// The worker's language and reader, for settings changes made while it runs.
    active: Mutex<(String, Option<Arc<dyn Reader>>)>,
    /// The capture as of the last tick.
    capture: Mutex<CaptureView>,
    /// True from the worker's start until its loop has returned.
    running: AtomicBool,
    /// Replaces the timed wait (tests drive a fake clock with it).
    waiter: Option<Box<dyn Fn(f64) + Send + Sync>>,
}

impl Shared {
    /// What a worker needs to run on its own: the core's stop flag, and optionally a
    /// replacement for sleeping between ticks.
    pub fn standalone(core: &PipelineCore, waiter: Option<Box<dyn Fn(f64) + Send + Sync>>) -> Shared {
        Shared { waiter, ..Shared::new(core.stop_flag()) }
    }

    fn new(stopped: Arc<AtomicBool>) -> Shared {
        Shared {
            waiter: None,
            pending: Mutex::new(None),
            stopped,
            sleep: Mutex::new(()),
            wake: Condvar::new(),
            status: Mutex::new(RuntimeStatus { state: "waiting", stage: Some("activation"), error_code: None, detector: None }),
            active: Mutex::new((String::new(), None)),
            capture: Mutex::new(CaptureView::default()),
            running: AtomicBool::new(false),
        }
    }

    fn take_pending(&self) -> Option<Settings> {
        self.pending.lock().ok()?.take()
    }

    fn publish(&self, core: &PipelineCore) {
        if let Ok(mut current) = self.status.lock() {
            *current = core.runtime_status();
        }
        if let Ok(mut active) = self.active.lock() {
            *active = (core.source_language.clone(), core.reader.clone());
        }
        if let Ok(mut capture) = self.capture.lock() {
            *capture = core.capture.as_ref().map_or_else(CaptureView::default, |c| CaptureView { source: c.source(), shared_window: c.shared_window() });
        }
    }

    /// Sleep until the timeout or `stop()`, whichever comes first.
    fn wait(&self, seconds: f64) {
        if let Some(waiter) = &self.waiter {
            waiter(seconds);
            return;
        }
        let Ok(guard) = self.sleep.lock() else { return };
        let _ = self.wake.wait_timeout_while(guard, std::time::Duration::from_secs_f64(seconds), |_| !self.stopped.load(Ordering::SeqCst));
    }

    fn signal_stop(&self) {
        let _guard = self.sleep.lock();
        self.stopped.store(true, Ordering::SeqCst);
        self.wake.notify_all();
    }
}

fn merge_settings(into: &mut Settings, from: Settings) {
    macro_rules! take {
        ($($field:ident),*) => { $( if from.$field.is_some() { into.$field = from.$field; } )* };
    }
    take!(poll_interval_ms, min_confidence, min_text_length, region, regions, chatbox_filter, detector, window_title, language_reader);
}

/// Loads readers for a language (`_readerFor`): resolves and verifies the downloads and
/// returns a cached engine.
pub trait ReaderFactory: Send + Sync {
    fn reader_for(&self, spec: &OcrModelSpec) -> std::result::Result<Arc<dyn Reader>, crate::Error>;
}

/// Runs a [`PipelineCore`] on its own thread (`OcrPipeline`).
pub struct OcrPipeline {
    core: Option<PipelineCore>,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<PipelineCore>>,
    readers: Arc<dyn ReaderFactory>,
    capture_probe: Box<dyn Fn(&str) -> CaptureStatus + Send>,
    shutdown: Arc<AtomicBool>,
    log: Arc<dyn Log>,
    stop_logged: bool,
}

impl OcrPipeline {
    pub fn new(core: PipelineCore, readers: Arc<dyn ReaderFactory>, capture_probe: Box<dyn Fn(&str) -> CaptureStatus + Send>) -> OcrPipeline {
        let log = core.log.clone();
        let shared = Arc::new(Shared::new(core.stop_flag()));
        shared.publish(&core);
        OcrPipeline { core: Some(core), shared, thread: None, readers, capture_probe, shutdown: Arc::new(AtomicBool::new(false)), log, stop_logged: false }
    }

    pub fn is_alive(&self) -> bool {
        self.thread.as_ref().is_some_and(|t| !t.is_finished())
    }

    /// The worker's state for the controller; never probes anything.
    pub fn runtime_status(&self) -> RuntimeStatus {
        if self.shared.stopped.load(Ordering::SeqCst) {
            return RuntimeStatus { state: "stopped", stage: None, error_code: None, detector: None };
        }
        if let Some(core) = &self.core {
            return core.runtime_status();
        }
        self.shared.status.lock().map(|s| s.clone()).unwrap_or(RuntimeStatus { state: "stopped", stage: None, error_code: None, detector: None })
    }

    /// The idle core, for inspection while no worker runs.
    pub fn core(&self) -> Option<&PipelineCore> {
        self.core.as_ref()
    }

    /// Load the models and start the worker; reading can begin when this returns.
    /// `Ok(false)` when shutdown was requested meanwhile.
    pub fn start(&mut self) -> std::result::Result<bool, StartError> {
        if self.shutdown.load(Ordering::SeqCst) {
            return Ok(false);
        }
        if self.is_alive() {
            return Ok(!self.shared.stopped.load(Ordering::SeqCst));
        }
        let Some(mut core) = self.core.take() else { return Ok(false) };
        let result = self.prepare(&mut core);
        if !matches!(result, Ok(true)) {
            self.shared.stopped.store(true, Ordering::SeqCst);
            core.reset_failures();
            core.reset_recognition();
            self.core = Some(core);
            return result;
        }
        self.shared.publish(&core);
        let shared = self.shared.clone();
        shared.running.store(true, Ordering::SeqCst);
        let spawned = std::thread::Builder::new().name("ocr_pipeline".into()).spawn(move || {
            /// Clears `running` when the loop returns or unwinds.
            struct Running<'a>(&'a AtomicBool);
            impl Drop for Running<'_> {
                fn drop(&mut self) {
                    self.0.store(false, Ordering::SeqCst);
                }
            }
            let _running = Running(&shared.running);
            core.run(&shared);
            core
        });
        match spawned {
            Ok(handle) => self.thread = Some(handle),
            Err(_) => {
                self.shared.running.store(false, Ordering::SeqCst);
                return Err(StartError::Unknown);
            }
        }
        Ok(true)
    }

    /// What another thread may read and signal without holding the pipeline.
    pub fn handle(&self) -> PipelineHandle {
        PipelineHandle { shared: self.shared.clone(), shutdown: self.shutdown.clone() }
    }

    fn prepare(&mut self, core: &mut PipelineCore) -> std::result::Result<bool, StartError> {
        core.reset_recognition();
        core.last_tick_at = 0.0;
        core.candidate_attempts.clear();
        core.attempt_number = 0;
        core.set_runtime("waiting", Some("activation"), None);
        self.shared.stopped.store(false, Ordering::SeqCst);
        core.reset_failures();
        let Some(spec) = resolve_model_spec(&core.source_language) else {
            self.log.info(&format!("OCR pipeline: language {:?} is not supported by the OCR engine", core.source_language));
            return Err(StartError::UnsupportedLanguage);
        };
        match self.readers.reader_for(&spec) {
            Ok(reader) => core.reader = Some(reader),
            Err(crate::Error::ModelsMissing(ids)) => {
                self.log.info(&format!("OCR pipeline: models not downloaded: {}", ids.join(", ")));
                return Err(StartError::ModelMissing);
            }
            Err(error) => {
                self.log.error(&format!("OCR pipeline: {error}"));
                self.log.info(&format!("OCR pipeline: OCR engine init failed for {}", spec.label()));
                return Err(StartError::ModelLoadFailed);
            }
        }
        if self.shutdown.load(Ordering::SeqCst) {
            return Ok(false);
        }
        let available = core.detector_mut().map(|d| (d.is_available(), d.name()));
        if let Some((false, name)) = available {
            self.log.info(&format!("OCR pipeline: detector {name:?} unavailable, reading the region instead"));
            core.set_detector(None);
        }
        if let Some(detector) = core.detector_mut() {
            if let Err(failure) = detector.load_model() {
                self.log.error(&format!("OCR pipeline: {}: {}", failure.kind, failure.message));
                self.log.info("OCR pipeline: bubble detector model load failed");
                return Err(StartError::ModelLoadFailed);
            }
        }
        if self.shutdown.load(Ordering::SeqCst) {
            return Ok(false);
        }
        match (self.capture_probe)(&core.window_title) {
            CaptureStatus::Ok => {}
            status => {
                self.log.info(&format!("OCR pipeline: capture not ready ({status:?}) for window {:?}", core.window_title));
                return Err(if status == CaptureStatus::CaptureUnavailable { StartError::CaptureUnavailable } else { StartError::WindowNotFound });
            }
        }
        if self.shutdown.load(Ordering::SeqCst) {
            return Ok(false);
        }
        self.log.info(&format!("OCR pipeline: started ({}, candidates={}, region={:?}, chatbox_filter={})", spec.label(), core.detector_name(), core.current_region(), core.chatbox_filter));
        Ok(true)
    }

    /// Close admission for good, including a start still loading models.
    pub fn request_shutdown(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        self.shared.signal_stop();
    }

    /// Stop the worker (waits up to five seconds). `false` when it did not finish in
    /// time; it then keeps its capture until the process exits.
    pub fn stop(&mut self) -> bool {
        self.shared.signal_stop();
        if let Some(handle) = self.thread.take() {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while !handle.is_finished() && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            if !handle.is_finished() {
                if !self.stop_logged {
                    self.stop_logged = true;
                    self.log.info("OCR pipeline: stop timed out; retaining worker and capture until exit");
                }
                self.thread = Some(handle);
                return false;
            }
            if let Ok(core) = handle.join() {
                self.core = Some(core);
            }
        }
        if let Some(core) = &mut self.core {
            // The worker closed the capture on its own thread before it returned.
            core.capture = None;
            core.reset_failures();
            core.reset_recognition();
        }
        true
    }

    /// Queue a settings change for the running worker (`applyConfig`). A language change
    /// loads its reader here, so a failure is reported to the caller and nothing changes.
    pub fn apply_config(&mut self, mut settings: Settings, language: Option<String>) -> std::result::Result<(), StartError> {
        if self.shutdown.load(Ordering::SeqCst) || self.shared.stopped.load(Ordering::SeqCst) {
            return Ok(());
        }
        if let Some(language) = language {
            let (current, current_reader) = self.active();
            let reader = if language != current {
                let spec = resolve_model_spec(&language).ok_or(StartError::UnsupportedLanguage)?;
                match self.readers.reader_for(&spec) {
                    Ok(reader) => Some(reader),
                    Err(crate::Error::ModelsMissing(_)) => return Err(StartError::ModelMissing),
                    Err(error) => {
                        self.log.error(&format!("OCR pipeline: {error}"));
                        return Err(StartError::ModelLoadFailed);
                    }
                }
            } else {
                current_reader
            };
            if let Some(reader) = reader {
                // Returning to the active language also supersedes an earlier queued switch.
                settings.language_reader = Some((language, reader));
            }
        }
        let Ok(mut pending) = self.shared.pending.lock() else { return Err(StartError::Unknown) };
        match pending.as_mut() {
            Some(queued) => merge_settings(queued, settings),
            None => *pending = Some(settings),
        }
        Ok(())
    }

    /// Apply queued settings to the idle core, as the worker does at the start of a
    /// tick. For tests and for a pipeline configured before it starts.
    pub fn apply_pending_idle(&mut self) {
        if let (Some(pending), Some(core)) = (self.shared.take_pending(), self.core.as_mut()) {
            core.apply_pending(pending);
        }
    }

    /// The idle core, to adjust before starting (tests).
    pub fn core_mut(&mut self) -> Option<&mut PipelineCore> {
        self.core.as_mut()
    }

    fn active(&self) -> (String, Option<Arc<dyn Reader>>) {
        if let Some(core) = &self.core {
            return (core.source_language.clone(), core.reader.clone());
        }
        self.shared.active.lock().map(|a| a.clone()).unwrap_or_default()
    }
}

/// A view of a pipeline for other threads: its state for status polling, and the
/// shutdown signal, neither of which waits for a start that is still loading models
/// (`requestShutdown` and the lock-free reads of `getOcrCaptureStatus`).
#[derive(Clone)]
pub struct PipelineHandle {
    shared: Arc<Shared>,
    shutdown: Arc<AtomicBool>,
}

impl PipelineHandle {
    /// The worker thread runs (it may still be waiting for activation).
    pub fn is_alive(&self) -> bool {
        self.shared.running.load(Ordering::SeqCst)
    }

    /// The worker's state as of its last tick; "stopped" once a stop was signalled.
    pub fn runtime_status(&self) -> RuntimeStatus {
        let stopped = RuntimeStatus { state: "stopped", stage: None, error_code: None, detector: None };
        if self.shared.stopped.load(Ordering::SeqCst) {
            return stopped;
        }
        self.shared.status.lock().map(|s| s.clone()).unwrap_or(stopped)
    }

    /// The capture as of the last tick.
    pub fn capture_view(&self) -> CaptureView {
        self.shared.capture.lock().map(|c| *c).unwrap_or_default()
    }

    /// Close admission for good and wake the worker ([`OcrPipeline::request_shutdown`]).
    pub fn request_shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        self.shared.signal_stop();
    }
}

/// Engines loaded per (model spec, files), as `getReader` caches them.
pub struct EngineReaders {
    root: Option<std::path::PathBuf>,
    threads: usize,
    cache: Mutex<HashMap<(OcrModelSpec, crate::models::ModelFiles), Arc<dyn Reader>>>,
}

impl EngineReaders {
    pub fn new(root: Option<std::path::PathBuf>, threads: usize) -> EngineReaders {
        EngineReaders { root, threads, cache: Mutex::new(HashMap::new()) }
    }
}

struct EngineReader(Mutex<crate::engine::Engine>);

impl Reader for EngineReader {
    fn read(&self, crop: &BgrImage, min_confidence: f64) -> std::result::Result<Vec<Word>, Failure> {
        let mut engine = self.0.lock().map_err(|_| Failure::new("RuntimeError", "OCR engine lock poisoned"))?;
        engine.read(crop, min_confidence).map_err(|e| Failure::from(&e))
    }
}

impl ReaderFactory for EngineReaders {
    fn reader_for(&self, spec: &OcrModelSpec) -> std::result::Result<Arc<dyn Reader>, crate::Error> {
        let files = crate::models::resolve_model_files(self.root.as_deref(), spec)?;
        let key = (*spec, files.clone());
        if let Some(reader) = self.cache.lock().ok().and_then(|cache| cache.get(&key).cloned()) {
            return Ok(reader);
        }
        let dictionary = crate::models::characters(&files.dict)?;
        let config = crate::engine::EngineConfig { threads: self.threads, ..crate::engine::EngineConfig::default() };
        let engine = crate::engine::Engine::load(&files.det, &files.rec, dictionary, spec.right_to_left(), config)?;
        let reader: Arc<dyn Reader> = Arc::new(EngineReader(Mutex::new(engine)));
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(key, reader.clone());
        }
        Ok(reader)
    }
}
