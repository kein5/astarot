//! Follows the endpoint that is actually playing (or recording) sound.
//!
//! Port of `src-python/active_endpoint_tracker.py`. Every endpoint's peak meter is
//! polled; the loudest one over a rolling window is the active endpoint, with
//! hysteresis so that a pause in the sound or a briefly louder device does not flip
//! the choice. When everything is silent the previous choice stays.
//!
//! Known limit (kept from the Python implementation): Windows reports a capture
//! endpoint's peak only while some client has it open, so following microphones by
//! peak does not work in practice. The device manager therefore runs a tracker only
//! for speakers.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::report::Reporter;
use crate::snapshot::TrackedEndpoint;
use crate::sync::{lock, monotonic, Event, TimedLock, Worker};

pub const POLL_INTERVAL: Duration = Duration::from_millis(250);
pub const WINDOW_SEC: f64 = 3.0;
pub const SILENT_THRESHOLD: f32 = 0.001;
pub const SWITCH_RATIO: f32 = 2.0;
pub const SWITCH_HOLD_SEC: f64 = 1.0;
/// One cycle is a poll plus up to one interval of waiting; two seconds leaves room
/// for a poll that enumeration made slow.
pub const STOP_JOIN_TIMEOUT: Duration = Duration::from_secs(2);
pub const STOP_TIMEOUT_ERROR_CODE: &str = "AUDIO_TRACKER_STOP_TIMEOUT";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flow {
    Render,
    Capture,
}

impl Flow {
    pub fn as_str(self) -> &'static str {
        match self {
            Flow::Render => "render",
            Flow::Capture => "capture",
        }
    }
}

/// The pure part: peak history and the hysteresis decision.
#[derive(Debug, Default)]
pub struct Selector {
    history: HashMap<String, VecDeque<(f64, f32)>>,
    current: Option<String>,
    candidate: Option<(String, f64)>,
}

impl Selector {
    pub fn current(&self) -> Option<&str> {
        self.current.as_deref()
    }

    /// Record one poll and drop what fell out of the window or disappeared.
    pub fn update_history(&mut self, peaks: &HashMap<String, f32>, now: f64) {
        for (name, &peak) in peaks {
            let history = self.history.entry(name.clone()).or_default();
            history.push_back((now, peak));
            let cutoff = now - WINDOW_SEC;
            while history.front().is_some_and(|&(at, _)| at < cutoff) {
                history.pop_front();
            }
        }
        self.history.retain(|name, _| peaks.contains_key(name));
    }

    /// The endpoint to select now.
    pub fn decide(&mut self, now: f64) -> Option<String> {
        let rolling: HashMap<&String, f32> = self.history.iter().map(|(name, h)| (name, h.iter().map(|&(_, p)| p).fold(0.0, f32::max))).collect();
        let selected = self.current.clone();
        // Exact ties go to the smallest ID, so the choice never depends on hash order.
        let mut active: Vec<(&String, f32)> = rolling.iter().filter(|(_, &peak)| peak > SILENT_THRESHOLD).map(|(n, &p)| (*n, p)).collect();
        if active.is_empty() {
            self.candidate = None;
            return selected;
        }
        active.sort_by(|a, b| a.0.cmp(b.0));
        let (best_name, best_peak) = active.iter().fold(active[0], |best, &item| if item.1 > best.1 { item } else { best });
        let Some(selected) = selected.filter(|name| rolling.contains_key(name)) else {
            self.candidate = None;
            return Some(best_name.clone());
        };
        if *best_name == selected {
            self.candidate = None;
            return Some(selected);
        }
        let current_peak = rolling.get(&selected).copied().unwrap_or(0.0);
        if best_peak >= current_peak * SWITCH_RATIO {
            match &self.candidate {
                Some((name, since)) if name == best_name => {
                    if now - since >= SWITCH_HOLD_SEC {
                        self.candidate = None;
                        return Some(best_name.clone());
                    }
                }
                _ => self.candidate = Some((best_name.clone(), now)),
            }
            return Some(selected);
        }
        self.candidate = None;
        Some(selected)
    }

    /// One poll: record, decide, remember. Returns whether the choice changed.
    pub fn feed(&mut self, peaks: &HashMap<String, f32>, now: f64) -> bool {
        self.update_history(peaks, now);
        let selected = self.decide(now);
        let changed = selected != self.current;
        self.current = selected;
        changed
    }
}

/// One endpoint's reading in one poll.
#[derive(Debug, Clone, PartialEq)]
pub struct Reading {
    pub id: String,
    pub name: String,
    pub peak: f32,
}

/// Reads every active endpoint's peak. Created on, used on and dropped on the
/// tracker's own thread, so an OS implementation may hold thread-affine handles.
pub trait MeterSource {
    fn poll(&mut self) -> Vec<Reading>;
}

/// The OS endpoints a [`MeterCache`] reads.
pub trait Endpoints {
    type Device;
    type Meter;
    /// `(id, device)` of every active endpoint of the flow.
    fn enumerate(&mut self) -> Result<Vec<(String, Self::Device)>, ()>;
    /// A meter and the friendly name of a newly seen endpoint.
    fn activate(&mut self, device: &Self::Device) -> Result<(String, Self::Meter), ()>;
    fn peak(&mut self, meter: &Self::Meter) -> Result<f32, ()>;
}

/// Activates each endpoint's meter once and reuses it across polls.
///
/// An endpoint that left the list or whose meter failed is dropped and activated
/// again when it is next seen.
pub struct MeterCache<E: Endpoints> {
    endpoints: E,
    cache: HashMap<String, (String, E::Meter)>,
}

impl<E: Endpoints> MeterCache<E> {
    pub fn new(endpoints: E) -> Self {
        Self { endpoints, cache: HashMap::new() }
    }

    pub fn endpoints(&self) -> &E {
        &self.endpoints
    }

    pub fn cached_ids(&self) -> Vec<&str> {
        let mut ids: Vec<&str> = self.cache.keys().map(String::as_str).collect();
        ids.sort_unstable();
        ids
    }
}

impl<E: Endpoints> MeterSource for MeterCache<E> {
    fn poll(&mut self) -> Vec<Reading> {
        let Ok(current) = self.endpoints.enumerate() else {
            return Vec::new();
        };
        self.cache.retain(|id, _| current.iter().any(|(current, _)| current == id));
        let mut readings = Vec::new();
        for (id, device) in current {
            if !self.cache.contains_key(&id) {
                let Ok(entry) = self.endpoints.activate(&device) else { continue };
                self.cache.insert(id.clone(), entry);
            }
            let (name, meter) = &self.cache[&id];
            match self.endpoints.peak(meter) {
                Ok(peak) => readings.push(Reading { id: id.clone(), name: name.clone(), peak }),
                Err(()) => {
                    self.cache.remove(&id);
                }
            }
        }
        readings
    }
}

/// Makes the OS meter source for a flow on the tracker thread.
pub trait MeterFactory: Send + Sync {
    /// Whether this platform can meter endpoints at all. Without it no thread starts.
    fn available(&self) -> bool;
    /// `None` when the OS refused (for example COM could not be initialised).
    fn open(&self, flow: Flow) -> Option<Box<dyn MeterSource>>;
}

type ChangeCallback = Arc<dyn Fn(TrackedEndpoint) + Send + Sync>;

struct Shared {
    flow: Flow,
    factory: Arc<dyn MeterFactory>,
    com_lock: Option<&'static TimedLock>,
    reporter: Arc<dyn Reporter>,
    running: Event,
    stop: Event,
    stopped: Event,
    selector: Mutex<Selector>,
    names: Mutex<HashMap<String, String>>,
    on_change: Mutex<Option<ChangeCallback>>,
}

/// Polls one flow's endpoint meters on its own thread.
pub struct ActiveEndpointTracker {
    shared: Arc<Shared>,
    thread: Mutex<Option<Worker>>,
}

impl ActiveEndpointTracker {
    /// `com_lock` serialises meter polls with stream opening; `None` only in tests.
    pub fn new(flow: Flow, factory: Arc<dyn MeterFactory>, com_lock: Option<&'static TimedLock>, reporter: Arc<dyn Reporter>) -> Self {
        let shared = Shared {
            flow,
            factory,
            com_lock,
            reporter,
            running: Event::new(),
            stop: Event::new(),
            stopped: Event::new(),
            selector: Mutex::new(Selector::default()),
            names: Mutex::new(HashMap::new()),
            on_change: Mutex::new(None),
        };
        shared.running.set();
        shared.stopped.set();
        Self { shared: Arc::new(shared), thread: Mutex::new(None) }
    }

    /// Called on the tracker thread whenever the active endpoint changes.
    pub fn set_on_change(&self, callback: impl Fn(TrackedEndpoint) + Send + Sync + 'static) {
        *lock(&self.shared.on_change) = Some(Arc::new(callback));
    }

    pub fn active_endpoint(&self) -> Option<TrackedEndpoint> {
        let id = lock(&self.shared.selector).current()?.to_owned();
        let name = lock(&self.shared.names).get(&id).cloned().unwrap_or_else(|| id.clone());
        Some(TrackedEndpoint { id, name })
    }

    pub fn is_running(&self) -> bool {
        lock(&self.thread).as_ref().is_some_and(Worker::is_alive)
    }

    pub fn is_stop_requested(&self) -> bool {
        self.shared.stop.is_set()
    }

    /// Wait until the thread and its OS cleanup have finished. `None` waits forever.
    pub fn wait_until_stopped(&self, timeout: Option<Duration>) -> bool {
        match timeout {
            Some(timeout) => self.shared.stopped.wait(timeout),
            None => {
                self.shared.stopped.wait_forever();
                true
            }
        }
    }

    pub fn start(&self) {
        if !self.shared.factory.available() {
            return;
        }
        let mut thread = lock(&self.thread);
        // A thread that outlived a timed-out stop keeps its apartment; never run two.
        if thread.as_ref().is_some_and(Worker::is_alive) {
            return;
        }
        self.shared.stop.clear();
        self.shared.running.set();
        self.shared.stopped.clear();
        let shared = self.shared.clone();
        match Worker::spawn("vrct-endpoint-tracker", move || run(&shared)) {
            Ok(worker) => *thread = Some(worker),
            Err(_) => {
                self.shared.stopped.set();
                self.shared.reporter.error("tracker_thread_unavailable");
            }
        }
    }

    /// Stop and report whether the thread and its OS cleanup finished in time.
    pub fn stop(&self) -> bool {
        let worker = {
            let thread = lock(&self.thread);
            self.shared.stop.set();
            self.shared.running.set();
            thread.clone()
        };
        let Some(worker) = worker else { return true };
        if worker.join(STOP_JOIN_TIMEOUT) {
            return true;
        }
        self.shared.reporter.log(&format!(
            "ActiveEndpointTracker({}): stop() timed out after {}s; tracker thread is still running (likely blocked in a COM call). COM cleanup will happen whenever it eventually returns, if ever.",
            self.shared.flow.as_str(),
            STOP_JOIN_TIMEOUT.as_secs_f64()
        ));
        self.shared.reporter.report_error_code(STOP_TIMEOUT_ERROR_CODE);
        false
    }

    /// Hold polls while a stream is being opened or closed.
    pub fn pause(&self) {
        self.shared.running.clear();
    }

    pub fn resume(&self) {
        self.shared.running.set();
    }
}

fn run(shared: &Shared) {
    struct Stopped<'a>(&'a Event);
    impl Drop for Stopped<'_> {
        fn drop(&mut self) {
            self.0.set();
        }
    }
    let _stopped = Stopped(&shared.stopped);
    let Some(mut source) = shared.factory.open(shared.flow) else {
        shared.reporter.error("tracker_meter_unavailable");
        return;
    };
    while !shared.stop.is_set() {
        shared.running.wait_forever();
        if shared.stop.is_set() {
            break;
        }
        poll_once(shared, source.as_mut());
        if shared.stop.wait(POLL_INTERVAL) {
            break;
        }
    }
    // The source (and its OS handles) is dropped here, on this thread, before
    // `stopped` is set.
    drop(source);
}

fn poll_once(shared: &Shared, source: &mut dyn MeterSource) {
    let readings = match shared.com_lock {
        Some(com_lock) => {
            let _guard = com_lock.lock();
            source.poll()
        }
        None => source.poll(),
    };
    let now = monotonic();
    let peaks: HashMap<String, f32> = readings.iter().map(|r| (r.id.clone(), r.peak)).collect();
    {
        let mut names = lock(&shared.names);
        names.retain(|id, _| peaks.contains_key(id));
        names.extend(readings.into_iter().map(|r| (r.id, r.name)));
    }
    let (changed, current) = {
        let mut selector = lock(&shared.selector);
        let changed = selector.feed(&peaks, now);
        (changed, selector.current().map(str::to_owned))
    };
    let (true, Some(id)) = (changed, current) else { return };
    let name = lock(&shared.names).get(&id).cloned().unwrap_or_else(|| id.clone());
    let callback = lock(&shared.on_change).clone();
    if let Some(callback) = callback {
        callback(TrackedEndpoint { id, name });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peaks(values: &[(&str, f32)]) -> HashMap<String, f32> {
        values.iter().map(|&(k, v)| (k.to_owned(), v)).collect()
    }

    fn feed(selector: &mut Selector, values: &[(&str, f32)], now: f64) -> Option<String> {
        selector.feed(&peaks(values), now);
        selector.current().map(str::to_owned)
    }

    #[test]
    fn all_silent_returns_none_initially() {
        assert_eq!(feed(&mut Selector::default(), &[("A", 0.0), ("B", 0.0)], 1.0), None);
    }

    #[test]
    fn first_active_endpoint_is_picked_immediately() {
        assert_eq!(feed(&mut Selector::default(), &[("A", 0.5), ("B", 0.0)], 1.0).as_deref(), Some("A"));
    }

    #[test]
    fn silence_preserves_previous_selection() {
        let mut s = Selector::default();
        feed(&mut s, &[("A", 0.5), ("B", 0.0)], 1.0);
        assert_eq!(feed(&mut s, &[("A", 0.0), ("B", 0.0)], 5.0).as_deref(), Some("A"));
    }

    #[test]
    fn new_candidate_requires_ratio_and_hold_to_switch() {
        let mut s = Selector::default();
        feed(&mut s, &[("A", 0.2), ("B", 0.0)], 1.0);
        assert_eq!(feed(&mut s, &[("A", 0.1), ("B", 0.5)], 1.1).as_deref(), Some("A"));
        assert_eq!(feed(&mut s, &[("A", 0.1), ("B", 0.5)], 1.6).as_deref(), Some("A"));
        assert_eq!(feed(&mut s, &[("A", 0.1), ("B", 0.5)], 2.2).as_deref(), Some("B"));
    }

    #[test]
    fn no_switch_when_ratio_never_met() {
        let mut s = Selector::default();
        feed(&mut s, &[("A", 0.5), ("B", 0.0)], 1.0);
        assert_eq!(feed(&mut s, &[("A", 0.5), ("B", 0.7)], 1.1).as_deref(), Some("A"));
        assert_eq!(feed(&mut s, &[("A", 0.5), ("B", 0.8)], 3.0).as_deref(), Some("A"));
        assert_eq!(feed(&mut s, &[("A", 0.5), ("B", 0.9)], 5.0).as_deref(), Some("A"));
    }

    #[test]
    fn selected_disappears_from_list_falls_to_best() {
        let mut s = Selector::default();
        feed(&mut s, &[("A", 0.5), ("B", 0.0)], 1.0);
        assert_eq!(feed(&mut s, &[("B", 0.3)], 5.0).as_deref(), Some("B"));
    }

    #[derive(Default)]
    struct FakeEndpoints {
        devices: Vec<(&'static str, &'static str, Result<f32, ()>)>,
        activations: Vec<String>,
    }

    impl Endpoints for FakeEndpoints {
        type Device = usize;
        type Meter = &'static str;
        fn enumerate(&mut self) -> Result<Vec<(String, usize)>, ()> {
            Ok(self.devices.iter().enumerate().map(|(i, d)| (d.0.to_owned(), i)).collect())
        }
        fn activate(&mut self, device: &usize) -> Result<(String, &'static str), ()> {
            self.activations.push(self.devices[*device].0.to_owned());
            Ok((self.devices[*device].1.to_owned(), self.devices[*device].0))
        }
        fn peak(&mut self, meter: &&'static str) -> Result<f32, ()> {
            self.devices.iter().find(|d| d.0 == *meter).map_or(Err(()), |d| d.2)
        }
    }

    #[test]
    fn second_poll_reuses_cached_meter() {
        let mut cache = MeterCache::new(FakeEndpoints { devices: vec![("id-a", "A", Ok(0.5))], ..Default::default() });
        assert_eq!(cache.poll(), vec![Reading { id: "id-a".into(), name: "A".into(), peak: 0.5 }]);
        cache.poll();
        assert_eq!(cache.endpoints().activations, ["id-a"]);
    }

    #[test]
    fn disappeared_endpoint_dropped_and_present_one_kept() {
        let mut cache = MeterCache::new(FakeEndpoints { devices: vec![("a", "A", Ok(0.1)), ("b", "B", Ok(0.2))], ..Default::default() });
        cache.poll();
        let _ = cache.endpoints.devices.remove(0);
        cache.poll();
        assert_eq!(cache.cached_ids(), ["b"]);
        assert_eq!(cache.endpoints().activations, ["a", "b"]);
    }

    #[test]
    fn peak_failure_invalidates_the_entry() {
        let mut cache = MeterCache::new(FakeEndpoints { devices: vec![("a", "A", Err(()))], ..Default::default() });
        assert!(cache.poll().is_empty());
        assert!(cache.cached_ids().is_empty());
        cache.endpoints.devices[0].2 = Ok(0.3);
        assert_eq!(cache.poll().len(), 1);
        assert_eq!(cache.endpoints().activations, ["a", "a"]);
    }

    struct Unavailable;
    impl MeterFactory for Unavailable {
        fn available(&self) -> bool {
            false
        }
        fn open(&self, _: Flow) -> Option<Box<dyn MeterSource>> {
            panic!("native worker must not start")
        }
    }

    #[derive(Default)]
    struct Recorder(Mutex<Vec<String>>);
    impl Reporter for Recorder {
        fn log(&self, message: &str) {
            lock(&self.0).push(message.to_owned());
        }
        fn report_error_code(&self, code: &str) {
            lock(&self.0).push(format!("code:{code}"));
        }
    }

    #[test]
    fn missing_meters_do_not_start_a_native_worker() {
        let tracker = ActiveEndpointTracker::new(Flow::Render, Arc::new(Unavailable), None, Arc::new(Recorder::default()));
        tracker.start();
        assert!(!tracker.is_running());
        assert!(tracker.stop());
    }

    struct Stuck(Arc<Event>, Arc<Event>);
    impl MeterSource for Stuck {
        fn poll(&mut self) -> Vec<Reading> {
            self.1.set();
            self.0.wait_forever();
            vec![Reading { id: "a".into(), name: "A".into(), peak: 0.5 }]
        }
    }
    struct StuckFactory(Arc<Event>, Arc<Event>);
    impl MeterFactory for StuckFactory {
        fn available(&self) -> bool {
            true
        }
        fn open(&self, _: Flow) -> Option<Box<dyn MeterSource>> {
            Some(Box::new(Stuck(self.0.clone(), self.1.clone())))
        }
    }

    #[test]
    fn stop_timeout_is_reported_and_restart_waits_for_cleanup() {
        let release = Arc::new(Event::new());
        let recorder = Arc::new(Recorder::default());
        let polling = Arc::new(Event::new());
        let tracker = ActiveEndpointTracker::new(Flow::Render, Arc::new(StuckFactory(release.clone(), polling.clone())), None, recorder.clone());
        let changes = Arc::new(Mutex::new(Vec::new()));
        let seen = changes.clone();
        tracker.set_on_change(move |endpoint| lock(&seen).push(endpoint));
        tracker.start();
        assert!(polling.wait(Duration::from_secs(5)));
        assert!(!tracker.stop());
        let log = lock(&recorder.0).clone();
        assert_eq!(log.len(), 2);
        assert!(log[0].contains("timed out"));
        assert_eq!(log[1], "code:AUDIO_TRACKER_STOP_TIMEOUT");
        assert!(tracker.is_stop_requested());
        // Still alive: a new start must not run a second thread.
        tracker.start();
        assert!(tracker.is_running());
        release.set();
        assert!(tracker.wait_until_stopped(Some(Duration::from_secs(5))));
        // The stuck poll finished after the stop request and may still report its result.
        assert!(lock(&changes).len() <= 1);
    }

    struct Fixed;
    impl MeterSource for Fixed {
        fn poll(&mut self) -> Vec<Reading> {
            vec![Reading { id: "{id-b}".into(), name: "Headphones".into(), peak: 0.4 }]
        }
    }
    struct FixedFactory;
    impl MeterFactory for FixedFactory {
        fn available(&self) -> bool {
            true
        }
        fn open(&self, _: Flow) -> Option<Box<dyn MeterSource>> {
            Some(Box::new(Fixed))
        }
    }

    #[test]
    fn change_reports_id_and_friendly_name() {
        let tracker = ActiveEndpointTracker::new(Flow::Render, Arc::new(FixedFactory), None, Arc::new(Recorder::default()));
        let changed = Arc::new(Event::new());
        let seen = Arc::new(Mutex::new(None));
        let (flag, slot) = (changed.clone(), seen.clone());
        tracker.set_on_change(move |endpoint| {
            *lock(&slot) = Some(endpoint);
            flag.set();
        });
        tracker.start();
        assert!(changed.wait(Duration::from_secs(5)));
        assert!(tracker.stop());
        let expected = TrackedEndpoint { id: "{id-b}".into(), name: "Headphones".into() };
        assert_eq!(lock(&seen).clone(), Some(expected.clone()));
        assert_eq!(tracker.active_endpoint(), Some(expected));
    }
}
