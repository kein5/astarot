//! The pipeline's behaviour with fake readers, capture, detector and clock: ported from
//! src-python/test/test_ocr_pipeline.py, test_ocr_reuse.py, test_ocr_failure_backoff.py
//! and test_ocr_runtime_results.py. Each test names the Python test it ports.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use ocr_runtime::detection::{Candidate, RegionValue, Surface};
use ocr_runtime::engine::Word;
use ocr_runtime::failure::{Clock, Failure, Log};
use ocr_runtime::languages::OcrModelSpec;
use ocr_runtime::pipeline::{
    CaptureStatus, DedupCache, Detector, FrameSource, Message, OcrPipeline, PipelineCore, PipelineOptions, Reader, ReaderFactory, Settings, Shared, StartError, ENGINE_BACKOFF_THRESHOLD,
    RECOGNITION_REFRESH_SEC,
};
use ocr_runtime::text::{merge_words, similar, text_key};
use ocr_runtime::BgrImage;

// ---- fakes ---------------------------------------------------------------------------

#[derive(Default)]
struct FakeClock(Mutex<f64>);

impl FakeClock {
    fn set(&self, now: f64) {
        *self.0.lock().unwrap() = now;
    }
    fn advance(&self, seconds: f64) {
        *self.0.lock().unwrap() += seconds;
    }
}

impl Clock for FakeClock {
    fn now(&self) -> f64 {
        *self.0.lock().unwrap()
    }
}

#[derive(Default)]
struct Logs {
    errors: Mutex<Vec<String>>,
    infos: Mutex<Vec<String>>,
}

impl Log for Logs {
    fn error(&self, message: &str) {
        self.errors.lock().unwrap().push(message.to_string());
    }
    fn info(&self, message: &str) {
        self.infos.lock().unwrap().push(message.to_string());
    }
}

impl Logs {
    fn errors(&self) -> usize {
        self.errors.lock().unwrap().len()
    }
    fn count(&self, word: &str) -> usize {
        self.infos.lock().unwrap().iter().filter(|m| m.contains(word)).count()
    }
    fn find(&self, word: &str) -> Vec<String> {
        self.infos.lock().unwrap().iter().filter(|m| m.contains(word)).cloned().collect()
    }
}

type ReadFn = Box<dyn FnMut(&BgrImage) -> Result<Vec<Word>, Failure> + Send>;

struct FakeReader {
    calls: AtomicUsize,
    behaviour: Mutex<ReadFn>,
}

impl FakeReader {
    fn returning(text: &str) -> Arc<FakeReader> {
        let words = words(&[text]);
        Arc::new(FakeReader { calls: AtomicUsize::new(0), behaviour: Mutex::new(Box::new(move |_| Ok(words.clone()))) })
    }
    fn set(&self, behaviour: ReadFn) {
        *self.behaviour.lock().unwrap() = behaviour;
    }
    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl Reader for FakeReader {
    fn read(&self, crop: &BgrImage, _min_confidence: f64) -> Result<Vec<Word>, Failure> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        (self.behaviour.lock().unwrap())(crop)
    }
}

fn words(texts: &[&str]) -> Vec<Word> {
    texts.iter().map(|t| Word { text: t.to_string(), confidence: 0.9, bounds: None }).collect()
}

fn broken() -> Failure {
    Failure::new("RuntimeError", "broken reader")
}

#[derive(Default)]
struct CaptureState {
    frame: Option<BgrImage>,
    backend: String,
    source: Option<Surface>,
    gets: usize,
    closes: usize,
    failure_active: bool,
    /// Backend to switch to while get() runs.
    switch_to: Option<String>,
}

struct FakeCapture(Arc<Mutex<CaptureState>>);

impl FrameSource for FakeCapture {
    fn get(&mut self) -> Option<BgrImage> {
        let mut state = self.0.lock().unwrap();
        state.gets += 1;
        if let Some(backend) = state.switch_to.take() {
            state.backend = backend;
        }
        state.frame.clone()
    }
    fn backend(&self) -> String {
        self.0.lock().unwrap().backend.clone()
    }
    fn source(&self) -> Option<Surface> {
        self.0.lock().unwrap().source
    }
    fn failure_active(&self) -> bool {
        self.0.lock().unwrap().failure_active
    }
    fn close(&mut self) {
        self.0.lock().unwrap().closes += 1;
    }
}

#[derive(Default)]
struct DetectorState {
    candidates: Vec<Candidate>,
    calls: usize,
    settings: String,
    available: bool,
    load_failure: Option<Failure>,
    detect_failure: Option<Failure>,
    loads: usize,
}

struct FakeDetector(Arc<Mutex<DetectorState>>, &'static str);

impl Detector for FakeDetector {
    fn name(&self) -> String {
        self.1.to_string()
    }
    fn splits_bubbles(&self) -> bool {
        false
    }
    fn is_available(&self) -> bool {
        self.0.lock().unwrap().available
    }
    fn load_model(&mut self) -> Result<(), Failure> {
        let mut state = self.0.lock().unwrap();
        state.loads += 1;
        state.load_failure.clone().map_or(Ok(()), Err)
    }
    fn detect(&mut self, _frame: &BgrImage) -> Result<Vec<Candidate>, Failure> {
        let mut state = self.0.lock().unwrap();
        state.calls += 1;
        if let Some(failure) = state.detect_failure.clone() {
            return Err(failure);
        }
        Ok(state.candidates.clone())
    }
    fn settings(&self) -> String {
        self.0.lock().unwrap().settings.clone()
    }
}

/// A 64×24 crop filled with `value`.
fn filled(value: u8) -> BgrImage {
    BgrImage::filled(64, 24, value)
}

#[derive(Clone, Copy, PartialEq)]
enum Delivery {
    Accept,
    Reject,
    Fail,
}

struct Harness {
    clock: Arc<FakeClock>,
    logs: Arc<Logs>,
    received: Arc<Mutex<Vec<String>>>,
    delivery: Arc<Mutex<Delivery>>,
    callbacks: Arc<AtomicUsize>,
    reader: Arc<FakeReader>,
    capture: Arc<Mutex<CaptureState>>,
    detector: Arc<Mutex<DetectorState>>,
    opened: Arc<Mutex<Vec<String>>>,
    core: PipelineCore,
}

impl Harness {
    /// Python's TestRecognitionReuse.setUp: a detector returning one 64×24 crop, the
    /// chatbox filter off, a reader returning "hello world", the clock at 100.
    fn new() -> Harness {
        let clock = Arc::new(FakeClock::default());
        clock.set(100.0);
        let logs = Arc::new(Logs::default());
        let received = Arc::new(Mutex::new(Vec::new()));
        let delivery = Arc::new(Mutex::new(Delivery::Accept));
        let callbacks = Arc::new(AtomicUsize::new(0));
        let callback = {
            let (received, delivery, callbacks) = (received.clone(), delivery.clone(), callbacks.clone());
            Box::new(move |message: &Message| {
                callbacks.fetch_add(1, Ordering::SeqCst);
                match *delivery.lock().unwrap() {
                    Delivery::Accept => {
                        received.lock().unwrap().push(message.text.clone());
                        Ok(true)
                    }
                    Delivery::Reject => Ok(false),
                    Delivery::Fail => Err(Failure::new("RuntimeError", "callback failed")),
                }
            })
        };
        let capture = Arc::new(Mutex::new(CaptureState { frame: Some(filled(20)), backend: "x11".into(), ..Default::default() }));
        let detector = Arc::new(Mutex::new(DetectorState { candidates: vec![((0, 0, 64, 24), filled(20))], available: true, settings: "0.7".into(), ..Default::default() }));
        let opened = Arc::new(Mutex::new(Vec::new()));
        let factory = {
            let (capture, opened) = (capture.clone(), opened.clone());
            Arc::new(move |title: &str| -> Box<dyn FrameSource> {
                opened.lock().unwrap().push(title.to_string());
                Box::new(FakeCapture(capture.clone()))
            })
        };
        let options = PipelineOptions { chatbox_filter: false, ..PipelineOptions::default() };
        let mut core = PipelineCore::new(options, callback, Some(Box::new(FakeDetector(detector.clone(), "fake"))), factory, clock.clone(), logs.clone());
        let reader = FakeReader::returning("hello world");
        core.set_reader(Some(reader.clone()));
        core.set_capture(Some(Box::new(FakeCapture(capture.clone()))));
        Harness { clock, logs, received, delivery, callbacks, reader, capture, detector, opened, core }
    }

    fn tick_now(&mut self) -> Result<(), Failure> {
        self.core.tick()
    }

    /// Advance the clock, then tick.
    fn tick(&mut self, seconds: f64) {
        self.clock.advance(seconds);
        self.core.tick().unwrap();
    }

    fn prime(&mut self) {
        self.core.tick().unwrap();
        self.tick(0.75);
        assert_eq!(self.reader.calls(), 1);
    }

    fn candidates(&self, candidates: Vec<Candidate>) {
        self.detector.lock().unwrap().candidates = candidates;
    }

    fn received(&self) -> Vec<String> {
        self.received.lock().unwrap().clone()
    }

    fn seen_at(&self) -> f64 {
        self.core.dedup.items[0].1
    }
}

// ---- recognition reuse (test_ocr_reuse.py) ---------------------------------------------

#[test]
fn identical_pixels_in_a_new_array_reuse_words_and_still_deduplicate() {
    let mut h = Harness::new();
    h.tick_now().unwrap();
    h.candidates(vec![((10, 0, 64, 24), filled(20))]);
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 1);
    assert_eq!(h.received().len(), 1);
    assert_eq!((h.core.counts.ocr, h.core.counts.reused, h.core.counts.text, h.core.counts.bubble), (1, 1, 2, 2));
    assert_eq!(h.detector.lock().unwrap().calls, 2); // detection is never cached
}

#[test]
fn one_changed_pixel_reads_again() {
    let mut h = Harness::new();
    h.prime();
    let mut changed = filled(20);
    *changed.data.last_mut().unwrap() += 1;
    h.candidates(vec![((0, 0, 64, 24), changed)]);
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 2);
}

#[test]
fn the_picture_shape_is_part_of_the_pixel_key() {
    // Python also keys on the dtype; Rust crops are always 8-bit BGR.
    let mut h = Harness::new();
    h.prime();
    let reshaped = BgrImage::new(32, 48, filled(20).data).unwrap();
    h.candidates(vec![((0, 0, 64, 24), reshaped)]);
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 2);
}

#[test]
fn language_changes_invalidate_even_when_the_reader_and_model_are_shared() {
    let mut h = Harness::new();
    h.prime();
    for language in ["Japanese", "Korean", "auto"] {
        let reader: Arc<dyn Reader> = h.reader.clone();
        h.core.apply_pending(Settings { language_reader: Some((language.into(), reader)), ..Settings::default() });
        h.tick(0.75);
    }
    assert_eq!(h.reader.calls(), 4);
}

#[test]
fn reader_identity_change_reads_again() {
    let mut h = Harness::new();
    h.prime();
    let replacement = FakeReader::returning("hello world");
    h.core.set_reader(Some(replacement.clone()));
    h.tick(0.75);
    assert_eq!(replacement.calls(), 1);
    h.core.set_reader(Some(h.reader.clone()));
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 2);
}

#[test]
fn model_root_changes_invalidate() {
    let mut h = Harness::new();
    h.prime();
    h.core.model_root = Some("another-model-root".into());
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 2);
}

#[test]
fn scalar_and_region_settings_invalidate_even_with_identical_crops() {
    let mut h = Harness::new();
    h.prime();
    let changes: Vec<Settings> = vec![
        Settings { min_confidence: Some(0.99), ..Settings::default() },
        Settings { min_text_length: Some(50), ..Settings::default() },
        Settings { poll_interval_ms: Some(100), ..Settings::default() },
        Settings { chatbox_filter: Some(true), ..Settings::default() },
        Settings { region: Some(RegionValue::Values([0.1, 0.1, 0.8, 0.8])), ..Settings::default() },
    ];
    for settings in changes {
        let previous = h.reader.calls();
        h.core.apply_pending(settings);
        h.tick(0.75);
        assert_eq!(h.reader.calls(), previous + 1);
    }
}

#[test]
fn detector_replacement_and_reconfiguration_invalidate() {
    let mut h = Harness::new();
    h.prime();
    for _ in 0..3 {
        let detector: Box<dyn Detector> = Box::new(FakeDetector(h.detector.clone(), "fake"));
        h.core.apply_pending(Settings { detector: Some(Some(detector)), ..Settings::default() });
        h.tick(0.75);
    }
    assert_eq!(h.reader.calls(), 4);
}

#[test]
fn builtin_detector_setting_changes_are_not_reused() {
    let mut h = Harness::new();
    h.prime();
    for value in ["0.8", "padding 8", "nms 0.6", "size 320", "another.onnx"] {
        let previous = h.reader.calls();
        h.detector.lock().unwrap().settings = value.into();
        h.tick(0.75);
        assert_eq!(h.reader.calls(), previous + 1);
    }
}

#[test]
fn capture_title_and_capture_identity_changes_invalidate() {
    let mut h = Harness::new();
    h.prime();
    h.core.apply_pending(Settings { window_title: Some("Another VRChat".into()), ..Settings::default() });
    h.tick(0.75);
    h.core.set_capture(Some(Box::new(FakeCapture(h.capture.clone()))));
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 3);
    assert_eq!(*h.opened.lock().unwrap(), vec!["Another VRChat".to_string()]);
}

#[test]
fn backend_change_during_get_invalidates_in_both_directions() {
    let mut h = Harness::new();
    h.prime();
    for backend in ["openvr_mirror", "x11"] {
        h.capture.lock().unwrap().switch_to = Some(backend.into());
        h.tick(0.75);
    }
    assert_eq!(h.reader.calls(), 3);
}

#[test]
fn missing_frame_discards_recognition_without_marking_text_seen() {
    let mut h = Harness::new();
    h.prime();
    let seen_at = h.seen_at();
    h.capture.lock().unwrap().frame = None;
    h.tick(0.75);
    assert_eq!(h.core.recognition.len(), 0);
    assert_eq!(h.seen_at(), seen_at);
    h.capture.lock().unwrap().frame = Some(filled(20));
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 2);
}

#[test]
fn periodic_refresh_is_measured_from_read_not_last_hit() {
    let mut h = Harness::new();
    h.tick_now().unwrap();
    for _ in 1..20 {
        h.tick(1.0);
    }
    assert_eq!(h.reader.calls(), 1);
    let different = words(&["a different message"]);
    h.reader.set(Box::new(move |_| Ok(different.clone())));
    h.tick(1.0);
    assert_eq!(h.reader.calls(), 2);
    assert_eq!(h.received(), vec!["hello world", "a different message"]);
}

#[test]
fn empty_success_is_cached_but_also_refreshed() {
    let mut h = Harness::new();
    h.reader.set(Box::new(|_| Ok(Vec::new())));
    h.prime();
    assert!(h.received().is_empty());
    assert_eq!(h.core.counts.text, 0);
    h.tick(20.0);
    assert_eq!(h.reader.calls(), 2);
}

#[test]
fn reuse_refreshes_seen_for_longer_than_retention() {
    let mut h = Harness::new();
    for second in 0..91 {
        h.clock.set(100.0 + second as f64);
        h.tick_now().unwrap();
    }
    assert_eq!(h.received().len(), 1);
    assert_eq!(h.reader.calls(), 5);
    assert_eq!(h.seen_at(), 190.0);
}

#[test]
fn disappearance_and_reappearance_match_uncached_delivery() {
    let mut deliveries = Vec::new();
    for reuse in [false, true] {
        let mut h = Harness::new();
        let original: Candidate = ((0, 0, 64, 24), filled(20));
        let other: Candidate = ((0, 0, 64, 24), filled(40));
        let (first, second) = (words(&["hello world"]), words(&["a different message"]));
        h.reader.set(Box::new(move |crop| Ok(if crop.data[0] == 20 { first.clone() } else { second.clone() })));
        for second in 0..102 {
            h.clock.set(100.0 + second as f64);
            // Last seen at 39; back at 69 (exactly 30 s) and at 100 (over 30 s).
            h.candidates(vec![if second < 40 || second == 69 || second == 100 { original.clone() } else { other.clone() }]);
            if !reuse {
                h.core.reset_recognition();
            }
            h.tick_now().unwrap();
        }
        deliveries.push(h.received());
    }
    assert_eq!(deliveries[0], vec!["hello world", "a different message", "hello world"]);
    assert_eq!(deliveries[1], deliveries[0]);
}

#[test]
fn no_candidate_gap_expires_delivery_after_thirty_seconds() {
    let mut h = Harness::new();
    h.prime();
    h.candidates(Vec::new());
    for _ in 0..40 {
        h.tick(1.0);
    }
    h.candidates(vec![((0, 0, 64, 24), filled(20))]);
    h.tick(0.75);
    assert_eq!(h.received().len(), 2);
}

#[test]
fn no_frame_gap_also_expires_delivery() {
    let mut h = Harness::new();
    h.prime();
    h.capture.lock().unwrap().frame = None;
    for _ in 0..40 {
        h.tick(1.0);
    }
    assert!(h.core.dedup.is_empty());
    h.capture.lock().unwrap().frame = Some(filled(20));
    h.tick(0.75);
    assert_eq!(h.received().len(), 2);
}

#[test]
fn changing_slow_first_crop_does_not_starve_the_second() {
    let mut h = Harness::new();
    let attempted = Arc::new(Mutex::new(Vec::new()));
    {
        let (attempted, clock) = (attempted.clone(), h.clock.clone());
        h.reader.set(Box::new(move |crop| {
            attempted.lock().unwrap().push(crop.data[0]);
            clock.advance(0.7); // more than the 0.6 s budget
            let text = if crop.data[0] == 99 { "second bubble is readable" } else { "first bubble keeps changing" };
            Ok(words(&[text]))
        }));
    }
    for tick in 0..12u8 {
        h.candidates(vec![((0, 0, 64, 24), filled(tick)), ((80, 0, 64, 24), filled(99))]);
        h.tick(0.75);
    }
    let attempted = attempted.lock().unwrap();
    assert!(attempted[..2].contains(&99));
    assert!(h.received().iter().any(|t| t == "second bubble is readable"));
    assert!(attempted.len() <= 12);
}

#[test]
fn activation_gates_first_tick_and_rejected_delivery_is_retried() {
    let mut h = Harness::new();
    let active = Arc::new(AtomicBool::new(false));
    {
        let active = active.clone();
        h.core.set_activation_ready(Box::new(move || active.load(Ordering::SeqCst)));
    }
    h.tick_now().unwrap();
    assert_eq!(h.reader.calls(), 0);
    assert!(h.core.dedup.is_empty());
    active.store(true, Ordering::SeqCst);
    *h.delivery.lock().unwrap() = Delivery::Reject;
    h.tick(0.75);
    assert!(h.core.dedup.is_empty());
    assert_eq!(h.core.counts.emit, 0);
    *h.delivery.lock().unwrap() = Delivery::Accept;
    h.tick(0.75);
    h.tick(0.75);
    assert_eq!(h.received().len(), 1);
    assert_eq!(h.reader.calls(), 1); // reuse still applies
}

#[test]
fn confidence_reordering_and_small_motion_do_not_starve_a_bubble() {
    let mut h = Harness::new();
    let attempted = Arc::new(Mutex::new(Vec::new()));
    {
        let (attempted, clock) = (attempted.clone(), h.clock.clone());
        h.reader.set(Box::new(move |crop| {
            attempted.lock().unwrap().push(crop.data[0]);
            clock.advance(0.7);
            Ok(words(&["hello world"]))
        }));
    }
    for tick in 0..12i64 {
        let mut candidates = vec![((tick, 0, 64, 24), filled(tick as u8)), ((80 + tick, 0, 64, 24), filled(99))];
        if tick % 2 == 1 {
            candidates.reverse();
        }
        h.candidates(candidates);
        h.tick(0.75);
    }
    let attempted = attempted.lock().unwrap();
    assert!(attempted[..2].contains(&99));
    assert!(attempted.len() <= 12);
}

#[test]
fn slow_rotation_keeps_visible_messages_but_expires_absent_text() {
    let mut h = Harness::new();
    let texts = ["alpha message", "bravo reply", "charlie talks", "delta speaks", "echo greeting", "foxtrot says goodbye"];
    let crops: Vec<Candidate> = (0..6).map(|i| ((i * 80, 0, 64, 24), filled(i as u8))).collect();
    h.candidates(crops.clone());
    {
        let clock = h.clock.clone();
        h.reader.set(Box::new(move |crop| {
            clock.advance(6.0); // a full rotation takes over 30 seconds
            Ok(words(&[texts[crop.data[0] as usize]]))
        }));
    }
    for _ in 0..18 {
        h.tick(0.75);
    }
    assert_eq!(h.received(), texts);
    // New pixels at the same box must not keep the old text alive.
    h.candidates(vec![((0, 0, 64, 24), filled(1))]);
    for _ in 0..40 {
        h.tick(1.0);
    }
    assert!(!h.core.dedup.items.iter().any(|item| item.0 == text_key(texts[0])));
    h.candidates(crops[..1].to_vec());
    h.tick(0.75);
    let mut expected: Vec<&str> = texts.to_vec();
    expected.push(texts[0]);
    assert_eq!(h.received(), expected);
}

#[test]
fn distinct_short_replies_are_delivered_and_exact_repeats_are_not() {
    let mut h = Harness::new();
    for (index, text) in ["はい", "いや", "はい", "いや"].into_iter().enumerate() {
        h.candidates(vec![((0, 0, 64, 24), filled(index as u8))]);
        let reply = words(&[text]);
        h.reader.set(Box::new(move |_| Ok(reply.clone())));
        h.tick(0.75);
    }
    assert_eq!(h.received(), vec!["はい", "いや"]);
}

#[test]
fn callback_exception_does_not_mark_a_delivery() {
    let mut h = Harness::new();
    *h.delivery.lock().unwrap() = Delivery::Fail;
    let error = h.tick_now().unwrap_err();
    assert_eq!(error.message, "callback failed");
    assert!(h.core.dedup.is_empty());
    *h.delivery.lock().unwrap() = Delivery::Accept;
    h.tick(0.75);
    assert_eq!(h.received().len(), 1);
}

#[test]
fn deferred_candidate_must_still_be_present_in_current_frame() {
    let mut h = Harness::new();
    {
        let clock = h.clock.clone();
        h.reader.set(Box::new(move |_| {
            clock.advance(0.7);
            Ok(words(&["hello world"]))
        }));
    }
    h.candidates(vec![((0, 0, 64, 24), filled(20)), ((80, 0, 64, 24), filled(99))]);
    h.tick_now().unwrap();
    h.candidates(vec![((0, 0, 64, 24), filled(20))]);
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 1); // only the current, cached first crop
    assert_eq!(h.received().len(), 1);
}

#[test]
fn cached_near_duplicate_refreshes_the_original_seen_timestamp() {
    let mut h = Harness::new();
    h.tick_now().unwrap();
    h.candidates(vec![((0, 0, 64, 24), filled(21))]);
    let jittered = words(&["hallo world"]);
    h.reader.set(Box::new(move |_| Ok(jittered.clone())));
    for _ in 0..40 {
        h.tick(1.0);
    }
    assert_eq!(h.received().len(), 1);
    assert_eq!(h.core.dedup.len(), 1);
    assert_eq!((h.core.dedup.items[0].1, h.core.dedup.items[0].2.as_str()), (140.0, "hello world"));
}

#[test]
fn failure_drops_all_cached_successes_and_backoff_still_engages() {
    let mut h = Harness::new();
    h.prime();
    let cached: Candidate = ((0, 0, 64, 24), filled(20));
    h.candidates(vec![cached.clone(), ((0, 0, 64, 24), filled(40))]);
    h.reader.set(Box::new(|_| Err(broken())));
    h.tick(0.75); // the cached crop succeeds, the new one fails
    assert_eq!(h.core.engine_failure_count, 1);
    assert_eq!(h.core.recognition.len(), 0);
    h.candidates(vec![cached]);
    h.tick(0.75);
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 4);
    assert_eq!(h.core.engine_failure_count, 3);
    assert_eq!(h.core.engine_backoff, 1.0);
    assert_eq!(h.logs.errors(), 1);
    assert_eq!(h.logs.count("recovered"), 0);
    let detections = h.detector.lock().unwrap().calls;
    h.tick(0.1);
    assert_eq!(h.reader.calls(), 4);
    assert_eq!(h.detector.lock().unwrap().calls, detections);
    h.clock.set(h.core.engine_retry_at);
    h.tick_now().unwrap();
    assert_eq!(h.reader.calls(), 5);
    assert_eq!(h.core.engine_backoff, 2.0);
    h.clock.set(h.core.engine_retry_at);
    let fine = words(&["hello world"]);
    h.reader.set(Box::new(move |_| Ok(fine.clone())));
    h.tick_now().unwrap();
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 6);
    assert_eq!(h.core.engine_failure_count, 0);
    assert_eq!(h.logs.count("recovered"), 1);
}

#[test]
fn refresh_failure_never_falls_back_to_expired_words() {
    let mut h = Harness::new();
    h.prime();
    h.reader.set(Box::new(|_| Err(broken())));
    h.clock.set(120.0);
    h.tick_now().unwrap();
    assert_eq!(h.core.counts.text, 2);
    assert_eq!(h.core.recognition.len(), 0);
    h.tick(0.75);
    assert_eq!(h.reader.calls(), 3);
    assert_eq!(h.core.engine_failure_count, 2);
}

#[test]
fn lru_is_bounded_and_hits_protect_recent_entries() {
    let mut h = Harness::new();
    for i in 0..32u8 {
        h.candidates(vec![((0, 0, 64, 24), filled(i))]);
        h.tick_now().unwrap();
    }
    h.candidates(vec![((0, 0, 64, 24), filled(0))]);
    h.tick_now().unwrap(); // protect the oldest entry
    h.candidates(vec![((0, 0, 64, 24), filled(32))]);
    h.tick_now().unwrap();
    assert_eq!(h.core.recognition.len(), 32);
    h.candidates(vec![((0, 0, 64, 24), filled(0))]);
    h.tick_now().unwrap();
    assert_eq!(h.reader.calls(), 33);
    h.candidates(vec![((0, 0, 64, 24), filled(1))]);
    h.tick_now().unwrap(); // the evicted entry is read again
    assert_eq!(h.reader.calls(), 34);
    assert_eq!(h.core.recognition.len(), 32);
}

#[test]
fn status_distinguishes_engine_calls_from_reuse() {
    let mut h = Harness::new();
    h.prime();
    h.core.log_status(130.0);
    let status = h.logs.find("OCR status");
    assert!(status[0].contains("tick=2 frame=2 candidate=2 ocr=1 reused=1 text=2 bubble=2 emit=1"), "{status:?}");
    assert_eq!(h.core.counts, Default::default());
}

#[test]
fn static_scene_reader_calls_per_simulated_minute() {
    for (interval_ms, baseline) in [(750u64, 480), (100, 3600)] {
        for reuse in [false, true] {
            let mut h = Harness::new();
            h.core.apply_pending(Settings { poll_interval_ms: Some(interval_ms as i64), ..Settings::default() });
            h.candidates((0..6).map(|i| ((0, 0, 64, 24), filled(i))).collect());
            for tick in 0..60_000 / interval_ms {
                h.clock.set(100.0 + (tick * interval_ms) as f64 / 1000.0);
                if !reuse {
                    h.core.reset_recognition();
                }
                h.tick_now().unwrap();
            }
            assert_eq!(h.reader.calls(), if reuse { 18 } else { baseline }, "interval {interval_ms} ms, reuse {reuse}");
        }
    }
}

// ---- failures and backoff (test_ocr_failure_backoff.py) ---------------------------------

/// TestPipelineBackoff.setUp: a broken reader, six distinct 8×8 candidates.
fn backoff_harness() -> Harness {
    let mut h = Harness::new();
    h.reader.set(Box::new(|_| Err(broken())));
    h.capture.lock().unwrap().frame = Some(BgrImage::filled(8, 8, 0));
    h.candidates((0..6).map(|i| ((0, 0, 8, 8), BgrImage::filled(8, 8, i))).collect());
    h.core.chatbox_filter = false;
    h
}

fn fail_three_times(h: &mut Harness) {
    for _ in 0..3 {
        h.tick_now().unwrap();
        h.clock.advance(0.75);
    }
}

#[test]
fn simulated_minute_limits_work_and_preserves_status_summaries() {
    let mut h = backoff_harness();
    for tick in 0..80 {
        h.clock.set(100.0 + tick as f64 * 0.75);
        h.tick_now().unwrap();
    }
    assert_eq!(h.reader.calls(), 8);
    assert_eq!(h.logs.errors(), 1);
    assert_eq!(h.logs.count("suppressed"), 0);
    h.clock.set(160.0);
    h.tick_now().unwrap(); // the summary is due even during a cooldown
    assert_eq!(h.reader.calls(), 8);
    assert_eq!(h.logs.count("suppressed"), 1);
    assert!(h.logs.find("suppressed")[0].contains("suppressed 7 repeated failures"));
    assert_eq!(h.logs.count("OCR status (30s)"), 2);
    assert_eq!(h.callbacks.load(Ordering::SeqCst), 0);
}

#[test]
fn backoff_skips_capture_detection_and_all_crops_and_is_capped() {
    let mut h = backoff_harness();
    fail_three_times(&mut h);
    assert_eq!(h.reader.calls(), 3); // one attempt per failed tick, not six
    for delay in [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0] {
        let retry_at = h.core.engine_retry_at;
        assert_eq!(h.core.engine_backoff, delay);
        h.clock.set(retry_at - 0.001);
        let calls = (h.reader.calls(), h.capture.lock().unwrap().gets, h.detector.lock().unwrap().calls);
        h.tick_now().unwrap();
        assert_eq!(calls, (h.reader.calls(), h.capture.lock().unwrap().gets, h.detector.lock().unwrap().calls));
        h.clock.set(retry_at);
        h.tick_now().unwrap();
        assert_eq!(h.reader.calls(), calls.0 + 1);
    }
}

#[test]
fn empty_success_clears_backoff_and_recovery_is_logged_once() {
    let mut h = backoff_harness();
    fail_three_times(&mut h);
    h.clock.set(h.core.engine_retry_at);
    h.reader.set(Box::new(|_| Ok(Vec::new())));
    h.tick_now().unwrap();
    assert_eq!(h.core.engine_retry_at, 0.0);
    assert_eq!(h.core.engine_failure_count, 0);
    assert_eq!(h.reader.calls(), 9); // all six candidates resume at once
    h.tick_now().unwrap();
    assert_eq!(h.logs.count("recovered"), 1);
    h.reader.set(Box::new(|_| Err(broken())));
    h.clock.advance(RECOGNITION_REFRESH_SEC); // force a real health probe
    h.tick_now().unwrap();
    assert_eq!(h.logs.errors(), 2);
    assert_eq!(h.core.engine_backoff, 0.0);
}

#[test]
fn missing_frames_do_not_reset_an_engine_failure() {
    let mut h = backoff_harness();
    h.tick_now().unwrap();
    h.capture.lock().unwrap().frame = None;
    h.tick_now().unwrap();
    assert_eq!(h.core.engine_failure_count, 1);
    assert_eq!(h.logs.count("recovered"), 0);
}

#[test]
fn new_failure_kind_logs_again_without_evading_backoff() {
    let mut h = backoff_harness();
    let failures = Mutex::new(vec![Failure::new("ValueError", "two"), Failure::new("ValueError", "two"), Failure::new("RuntimeError", "one")]);
    h.reader.set(Box::new(move |_| Err(failures.lock().unwrap().pop().unwrap())));
    fail_three_times(&mut h);
    assert_eq!(h.logs.errors(), 2);
    assert_eq!(h.core.engine_backoff, 1.0);
    assert_eq!(ENGINE_BACKOFF_THRESHOLD, 3);
}

#[test]
fn a_different_reader_can_be_tried_without_waiting_for_old_cooldown() {
    let mut h = backoff_harness();
    fail_three_times(&mut h);
    let replacement = FakeReader::returning("");
    replacement.set(Box::new(|_| Ok(Vec::new())));
    h.core.apply_pending(Settings { language_reader: Some(("Korean".into(), replacement.clone())), ..Settings::default() });
    h.tick_now().unwrap();
    assert_eq!(replacement.calls(), 6);
    assert_eq!(h.core.engine_retry_at, 0.0);
}

#[test]
fn delivery_exceptions_use_tick_backoff_and_retry_until_accepted() {
    // Drives the worker loop itself with a fake clock (Python: the stop event's wait).
    let mut h = Harness::new();
    h.candidates(vec![((0, 0, 8, 8), BgrImage::filled(8, 8, 0))]);
    h.core.apply_pending(Settings { poll_interval_ms: Some(1000), ..Settings::default() });
    *h.delivery.lock().unwrap() = Delivery::Fail;
    let snapshots = Arc::new(Mutex::new(Vec::new()));
    let stop = h.core.stop_flag();
    let waiter = {
        let (clock, delivery, callbacks, snapshots) = (h.clock.clone(), h.delivery.clone(), h.callbacks.clone(), snapshots.clone());
        Box::new(move |seconds: f64| {
            snapshots.lock().unwrap().push((clock.now(), callbacks.load(Ordering::SeqCst)));
            clock.advance(seconds);
            if clock.now() >= 161.0 {
                *delivery.lock().unwrap() = Delivery::Accept;
            }
            if clock.now() >= 194.0 {
                stop.store(true, Ordering::SeqCst);
            }
        })
    };
    let shared = Shared::standalone(&h.core, Some(waiter));
    h.core.run(&shared);
    let snapshots = snapshots.lock().unwrap();
    let failures: Vec<_> = snapshots.iter().filter(|row| row.0 < 161.0).collect();
    assert_eq!(failures.last().unwrap().1, 6); // attempts at 100, 101, 103, 107, 115, 131
    assert_eq!(h.callbacks.load(Ordering::SeqCst), 7); // recovery at 161, then dedup
    assert_eq!(h.logs.errors(), 1);
    assert_eq!(h.logs.count("suppressed"), 1);
    assert_eq!(h.logs.count("recovered"), 1);
    assert_eq!(h.received().len(), 1);
    assert_eq!(h.capture.lock().unwrap().closes, 1);
}

#[test]
fn tick_failures_report_retrying_with_the_unknown_code() {
    let mut h = Harness::new();
    *h.delivery.lock().unwrap() = Delivery::Fail;
    let failure = h.tick_now().unwrap_err();
    h.core.stage_failure("tick", Some(&failure));
    let status = h.core.runtime_status();
    assert_eq!((status.state, status.stage, status.error_code), ("retrying", Some("tick"), Some("OCR_DISABLED_UNKNOWN")));
    assert!(h.core.dedup.is_empty());
}

// ---- runtime results (test_ocr_runtime_results.py) ---------------------------------------

#[test]
fn detector_run_failure_backs_off_logs_once_and_recovers() {
    let mut h = Harness::new();
    h.detector.lock().unwrap().detect_failure = Some(Failure::new("OcrDetectorError", "RuntimeError: broken detector"));
    for _ in 0..3 {
        h.tick_now().unwrap();
        h.clock.set(h.core.detector_retry.retry_at);
    }
    assert_eq!(h.logs.errors(), 1);
    assert_eq!(h.reader.calls(), 0); // a failed detection never widens to the region
    let status = h.core.runtime_status();
    assert_eq!((status.state, status.stage, status.error_code), ("retrying", Some("detector"), Some("OCR_DISABLED_MODEL_LOAD_FAILED")));
    h.detector.lock().unwrap().detect_failure = None;
    h.tick_now().unwrap();
    assert_eq!(h.logs.count("recovered"), 1);
    assert_eq!(h.core.runtime_status().state, "reading");
}

#[test]
fn capture_failures_back_off_and_missing_frames_do_not_claim_recovery() {
    let mut h = Harness::new();
    {
        let mut capture = h.capture.lock().unwrap();
        capture.frame = None;
        capture.failure_active = true;
    }
    h.tick_now().unwrap();
    let status = h.core.runtime_status();
    assert_eq!((status.state, status.stage, status.error_code), ("retrying", Some("capture"), Some("OCR_DISABLED_CAPTURE_UNAVAILABLE")));
    let gets = h.capture.lock().unwrap().gets;
    h.tick(0.5); // inside the one-second cooldown
    assert_eq!(h.capture.lock().unwrap().gets, gets);
    h.capture.lock().unwrap().failure_active = false;
    h.clock.set(h.core.capture_retry.retry_at);
    h.tick_now().unwrap(); // still no frame: waiting, not ready, no recovery
    assert_eq!(h.core.runtime_status().state, "retrying");
    h.capture.lock().unwrap().frame = Some(filled(20));
    h.tick(0.75);
    assert_eq!(h.core.runtime_status().state, "reading");
}

#[test]
fn first_missing_frame_is_waiting_not_ready() {
    let mut h = Harness::new();
    h.capture.lock().unwrap().frame = None;
    h.tick_now().unwrap();
    let status = h.core.runtime_status();
    assert_eq!((status.state, status.stage), ("waiting", Some("capture")));
}

#[test]
fn replacing_a_failed_detector_clears_only_its_retry() {
    let mut h = Harness::new();
    h.detector.lock().unwrap().detect_failure = Some(Failure::new("OcrDetectorError", "broken"));
    h.tick_now().unwrap();
    assert!(h.core.detector_retry.retry_at > 0.0);
    h.core.engine_retry_at = 0.0;
    h.core.apply_pending(Settings { detector: Some(None), ..Settings::default() });
    assert_eq!(h.core.detector_retry.retry_at, 0.0);
    assert_eq!(h.core.detector_name(), "region");
    assert_eq!(h.core.runtime_status().stage, Some("capture"));
}

// ---- settings, dedup and merging (test_ocr_pipeline.py) ------------------------------------

#[test]
fn init_values_are_clamped() {
    let make = |options: PipelineOptions| {
        PipelineCore::new(options, Box::new(|_| Ok(true)), None, Arc::new(|_: &str| -> Box<dyn FrameSource> { unreachable!() }), Arc::new(FakeClock::default()), Arc::new(Logs::default()))
    };
    assert_eq!(make(PipelineOptions { poll_interval_ms: 750, ..Default::default() }).poll_interval, 0.75);
    assert!(make(PipelineOptions { poll_interval_ms: 0, ..Default::default() }).poll_interval >= 0.1);
    assert_eq!(make(PipelineOptions { min_text_length: 0, ..Default::default() }).min_text_length, 1);
    assert_eq!(make(PipelineOptions { source_language: String::new(), ..Default::default() }).source_language, "auto");
    assert_eq!(make(PipelineOptions { window_title: String::new(), ..Default::default() }).window_title, "VRChat");
}

#[test]
fn retention_never_drops_below_twice_the_tick_interval() {
    let mut h = Harness::new();
    h.core.age_dedup(100.0);
    h.core.dedup.record(text_key("x"), "x", (0, 0), 40.0); // 63 s old by the next tick
    h.core.age_dedup(103.0); // 30 s > 2 × 3 s: the constant applies
    assert!(h.core.dedup.is_empty());
    h.core.dedup.record(text_key("y"), "y", (0, 0), 103.0);
    h.core.age_dedup(143.0); // a 40 s tick: retention rises to 80 s
    assert_eq!(h.core.dedup.len(), 1);
}

#[test]
fn scalar_settings_take_effect_and_pending_is_consumed_once() {
    let mut h = Harness::new();
    h.core.apply_pending(Settings { poll_interval_ms: Some(250), min_confidence: Some(0.3), min_text_length: Some(5), ..Settings::default() });
    assert_eq!(h.core.poll_interval, 0.25);
    assert!((h.core.tick_budget - 0.2).abs() < 1e-12);
    assert_eq!(h.core.min_confidence, 0.3);
    assert_eq!(h.core.min_text_length, 5);
    h.core.apply_pending(Settings { min_confidence: Some(f64::NAN), ..Settings::default() });
    assert_eq!(h.core.min_confidence, 0.3); // garbage is ignored
}

#[test]
fn language_change_swaps_the_reader_and_clears_the_dedup_cache() {
    let mut h = Harness::new();
    h.core.dedup.record("hash".into(), "こんにちは", (0, 0), 100.0);
    let korean = FakeReader::returning("x");
    h.core.apply_pending(Settings { language_reader: Some(("Korean".into(), korean.clone())), ..Settings::default() });
    assert_eq!(h.core.source_language, "Korean");
    assert!(Arc::ptr_eq(h.core.reader.as_ref().unwrap(), &(korean as Arc<dyn Reader>)));
    assert!(!h.core.dedup.seen("hash", "こんにちは", 101.0));
}

#[test]
fn window_title_change_reopens_the_capture_and_unchanged_values_touch_nothing() {
    let mut h = Harness::new();
    h.core.apply_pending(Settings { window_title: Some("VRChat".into()), ..Settings::default() });
    assert!(h.opened.lock().unwrap().is_empty());
    h.core.apply_pending(Settings { window_title: Some("VRChat (Other)".into()), ..Settings::default() });
    assert_eq!(h.capture.lock().unwrap().closes, 1);
    assert_eq!(*h.opened.lock().unwrap(), vec!["VRChat (Other)".to_string()]);
}

#[test]
fn dedup_cache_semantics() {
    let mut cache = DedupCache::default();
    assert!(!cache.seen("h1", "こんにちは", 100.0));
    cache.record("h1".into(), "こんにちは", (0, 0), 100.0);
    assert!(cache.seen("h1", "こんにちは", 100.5));
    assert!(cache.seen("h1", "こんにちは", 10_000.0)); // remembered no matter how long
    let mut cache = DedupCache::default();
    cache.record("h1".into(), "こんにちは", (0, 0), 100.0);
    for t in (101..200).step_by(5) {
        assert!(cache.seen("h1", "こんにちは", t as f64));
        cache.evict_stale(t as f64, 10.0);
    }
    assert!(cache.seen("h1", "こんにちは", 200.0));
    let mut cache = DedupCache::default();
    cache.record("h1".into(), "こんにちは", (0, 0), 100.0);
    cache.evict_stale(131.0, 30.0);
    assert!(!cache.seen("h1", "こんにちは", 131.0));
    let mut cache = DedupCache::default();
    cache.record("h1".into(), "hello world", (0, 0), 100.0);
    assert!(cache.seen("h2", "hallo world", 101.0));
    assert!(!cache.seen("h3", "ありがとうございます", 101.0));
    let mut cache = DedupCache::with_capacity(2);
    for (i, text) in ["aaaaaaaa", "bbbbbbbb", "cccccccc"].into_iter().enumerate() {
        cache.record(format!("h{i}"), text, (0, 0), 100.0 + i as f64);
    }
    cache.evict_stale(102.0, 30.0);
    assert!(!cache.seen("h0", "aaaaaaaa", 102.0));
    assert!(cache.seen("h2", "cccccccc", 102.0));
}

#[test]
fn similar_and_text_keys() {
    assert_eq!(text_key("Hello"), text_key("hELLO"));
    assert_ne!(text_key("hello"), text_key("world"));
    assert!(similar("hello world", "hello world", 2));
    assert!(similar("hello world", "hallo world", 2));
    assert!(similar("hello world", "hallo warld", 2));
    assert!(!similar("hello world", "hallo wxrlx", 2));
    assert!(!similar("hello world", "hello world!!!", 2));
    assert!(!similar("hello world", "hallo world", 0));
    assert!(similar("hello", "hallo", 2));
    assert!(!similar("hello", "halLo", 2));
    assert!(!similar("hello", "hello!!", 2));
    assert!(!similar("はい", "いや", 2)); // short texts must match exactly
}

fn line(text: &str, top: f64) -> Word {
    Word { text: text.into(), confidence: 0.9, bounds: Some((0.0, 100.0, top, top + 5.0)) }
}

#[test]
fn merging_lines_into_a_message() {
    assert_eq!(merge_words(&[line("窓の外に見える山が、夕焼けで少", 0.0), line("しずつ赤くなっている", 10.0)]), "窓の外に見える山が、夕焼けで少しずつ赤くなっている");
    assert_eq!(merge_words(&[line("La luce tra questi alberi sembra", 0.0), line("uscita da un sogno", 10.0)]), "La luce tra questi alberi sembra uscita da un sogno");
    assert_eq!(merge_words(&[line("1. Gather at the bridge.", 0.0), line("2. Take a group photo.", 10.0)]), "1. Gather at the bridge.\n2. Take a group photo.");
    assert_eq!(merge_words(&[line("行きましょう。", 0.0), line("そのあとで写真を撮ります", 10.0)]), "行きましょう。\nそのあとで写真を撮ります");
    assert_eq!(merge_words(&[line("しずつ", 20.0), line("窓の外に", 0.0)]), "窓の外にしずつ");
    assert_eq!(merge_words(&words(&["abc", "def"])), "abc def");
    assert_eq!(merge_words(&[line("  ", 0.0), line("hello", 10.0)]), "hello");
    assert_eq!(merge_words(&[]), "");
}

// ---- lifecycle (start errors, stop, restart) -----------------------------------------

struct Readers {
    result: Mutex<Result<Arc<dyn Reader>, ocr_runtime::Error>>,
    calls: AtomicUsize,
}

impl ReaderFactory for Readers {
    fn reader_for(&self, _spec: &OcrModelSpec) -> Result<Arc<dyn Reader>, ocr_runtime::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        match &*self.result.lock().unwrap() {
            Ok(reader) => Ok(reader.clone()),
            Err(ocr_runtime::Error::ModelsMissing(ids)) => Err(ocr_runtime::Error::ModelsMissing(ids.clone())),
            Err(error) => Err(ocr_runtime::Error::Backend(error.to_string())),
        }
    }
}

fn pipeline(h: Harness, result: Result<Arc<dyn Reader>, ocr_runtime::Error>, probe: CaptureStatus) -> (OcrPipeline, Arc<Readers>) {
    let readers = Arc::new(Readers { result: Mutex::new(result), calls: AtomicUsize::new(0) });
    (OcrPipeline::new(h.core, readers.clone(), Box::new(move |_| probe)), readers)
}

#[test]
fn start_reports_why_it_cannot_read() {
    let h = Harness::new();
    let (mut p, _) = pipeline(h, Err(ocr_runtime::Error::ModelsMissing(vec!["ppocrv6-small".into()])), CaptureStatus::Ok);
    assert_eq!(p.start(), Err(StartError::ModelMissing));
    assert!(!p.is_alive());

    let h = Harness::new();
    let (mut p, _) = pipeline(h, Err(ocr_runtime::Error::ModelsInvalid("hash mismatch".into())), CaptureStatus::Ok);
    assert_eq!(p.start(), Err(StartError::ModelLoadFailed));

    let h = Harness::new();
    h.detector.lock().unwrap().load_failure = Some(Failure::new("RuntimeError", "bad onnx"));
    let reader: Arc<dyn Reader> = h.reader.clone();
    let (mut p, _) = pipeline(h, Ok(reader), CaptureStatus::Ok);
    assert_eq!(p.start(), Err(StartError::ModelLoadFailed));
    assert!(!p.is_alive());

    for (probe, error) in [(CaptureStatus::WindowNotFound, StartError::WindowNotFound), (CaptureStatus::CaptureUnavailable, StartError::CaptureUnavailable)] {
        let h = Harness::new();
        let reader: Arc<dyn Reader> = h.reader.clone();
        let (mut p, _) = pipeline(h, Ok(reader), probe);
        assert_eq!(p.start(), Err(error));
    }

    let mut h = Harness::new();
    h.core.source_language = "Klingon".into();
    let reader: Arc<dyn Reader> = h.reader.clone();
    let (mut p, _) = pipeline(h, Ok(reader), CaptureStatus::Ok);
    assert_eq!(p.start(), Err(StartError::UnsupportedLanguage));
    assert_eq!(StartError::UnsupportedLanguage.code(), "OCR_DISABLED_UNSUPPORTED_LANGUAGE");
}

#[test]
fn an_unavailable_detector_falls_back_to_the_region_at_start() {
    let h = Harness::new();
    h.detector.lock().unwrap().available = false;
    let reader: Arc<dyn Reader> = h.reader.clone();
    let (mut p, _) = pipeline(h, Ok(reader), CaptureStatus::Ok);
    assert_eq!(p.start(), Ok(true));
    assert!(p.stop());
    assert_eq!(p.core().unwrap().detector_name(), "region");
}

#[test]
fn start_runs_the_worker_and_stop_wakes_it_from_a_long_wait() {
    let mut h = Harness::new();
    h.core.apply_pending(Settings { poll_interval_ms: Some(30_000), ..Settings::default() });
    h.core.engine_retry_at = f64::INFINITY;
    let capture = h.capture.clone();
    let reader: Arc<dyn Reader> = h.reader.clone();
    let (mut p, readers) = pipeline(h, Ok(reader), CaptureStatus::Ok);
    assert_eq!(p.start(), Ok(true));
    assert_eq!(readers.calls.load(Ordering::SeqCst), 1);
    std::thread::sleep(std::time::Duration::from_millis(100));
    assert!(p.is_alive());
    let started = std::time::Instant::now();
    assert!(p.stop());
    assert!(started.elapsed() < std::time::Duration::from_secs(1), "stop must wake the worker, not wait out the interval");
    assert_eq!(p.runtime_status().state, "stopped");
    assert!(capture.lock().unwrap().closes >= 1);
    // A restart discards what was recognised and starts fresh.
    assert_eq!(p.core().unwrap().recognition.len(), 0);
    assert_eq!(p.core().unwrap().engine_retry_at, 0.0);
}

#[test]
fn settings_reach_the_idle_pipeline_and_language_failures_are_reported() {
    let h = Harness::new();
    let reader: Arc<dyn Reader> = h.reader.clone();
    let (mut p, readers) = pipeline(h, Ok(reader), CaptureStatus::Ok);
    assert_eq!(p.apply_config(Settings::default(), Some("Klingon".into())), Err(StartError::UnsupportedLanguage));
    assert_eq!(readers.calls.load(Ordering::SeqCst), 0);
    // Returning to the active language does not load anything.
    p.apply_config(Settings { poll_interval_ms: Some(250), ..Settings::default() }, Some("auto".into())).unwrap();
    assert_eq!(readers.calls.load(Ordering::SeqCst), 0);
    p.apply_pending_idle();
    assert_eq!(p.core().unwrap().poll_interval, 0.25);
    *readers.result.lock().unwrap() = Err(ocr_runtime::Error::ModelsMissing(vec!["ppocrv5-korean".into()]));
    assert_eq!(p.apply_config(Settings::default(), Some("Korean".into())), Err(StartError::ModelMissing));
    p.apply_pending_idle();
    assert_eq!(p.core().unwrap().source_language, "auto");
}
