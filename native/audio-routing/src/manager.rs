//! Device lists, change notification and following the OS default devices.
//!
//! Port of `src-python/device_manager.py`. One monitoring thread refreshes the lists
//! when the OS reports a topology or default change (Windows endpoint notifications,
//! PipeWire registry events), and also polls: every two seconds without
//! notifications, and once a minute with them as a safety net for a missed event.
//! The thread runs while device list monitoring or either Auto Select is on.
//!
//! Auto Speaker Select additionally follows the endpoint that is actually playing,
//! through an [`ActiveEndpointTracker`]. Auto Microphone Select follows only the OS
//! default (see `tracker.rs` for why).

use std::collections::{BTreeMap, HashMap};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use crate::identity::{capture_key, CaptureKey, Device};
use crate::report::Reporter;
use crate::snapshot::{identify, DeviceSnapshot, IdentityContext, MicDevices, RawLists, TrackedEndpoint};
use crate::sync::{audio_op_lock, lock, monotonic, Event, Worker};
use crate::tracker::{ActiveEndpointTracker, Flow, MeterFactory};

/// Stop checks and polling without notifications, at the Python pace.
pub const MONITOR_WAIT_TIMEOUT: Duration = Duration::from_secs(2);
/// With notifications, one idle reconciliation per minute.
pub const RECONCILE_INTERVAL_SEC: f64 = 60.0;
/// Upper bound for the pause barrier: a stuck OS call must not hold the caller.
pub const PAUSE_BARRIER_TIMEOUT: Duration = Duration::from_secs(5);
/// How long a stop waits for the monitoring thread before returning.
pub const MONITOR_STOP_JOIN: Duration = Duration::from_millis(500);

/// A topology event from the OS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Topology {
    /// The default endpoint changed. Identities stay valid.
    DefaultChanged,
    /// An endpoint was added, removed or changed state. Slot identities become invalid.
    DeviceChanged,
}

/// Keeps OS notifications registered until dropped. Dropped on the thread that made it.
pub trait Watch {}

/// What the manager needs from the platform.
pub trait DeviceBackend: Send + Sync {
    /// The current lists. Failures yield empty lists (shown as the placeholders).
    fn enumerate(&self) -> RawLists;
    /// Native endpoint IDs by friendly name, for rows without one. Empty by default.
    fn endpoint_ids(&self) -> HashMap<String, Vec<String>> {
        HashMap::new()
    }
    /// Register for topology events on the calling thread. `None` means polling only.
    fn watch(&self, notify: Arc<dyn Fn(Topology) + Send + Sync>) -> Option<Box<dyn Watch>>;
    /// Meters for the speaker peak tracker.
    fn meters(&self) -> Arc<dyn MeterFactory>;
}

/// The lifecycle of a peak tracker, as the manager uses it.
pub trait EndpointTracker: Send + Sync {
    fn set_on_change(&self, callback: Box<dyn Fn(TrackedEndpoint) + Send + Sync>);
    fn start(&self);
    fn stop(&self) -> bool;
    fn is_running(&self) -> bool;
    fn is_stop_requested(&self) -> bool;
    fn wait_until_stopped(&self);
    fn pause(&self);
    fn resume(&self);
}

impl EndpointTracker for ActiveEndpointTracker {
    fn set_on_change(&self, callback: Box<dyn Fn(TrackedEndpoint) + Send + Sync>) {
        ActiveEndpointTracker::set_on_change(self, callback);
    }
    fn start(&self) {
        ActiveEndpointTracker::start(self);
    }
    fn stop(&self) -> bool {
        ActiveEndpointTracker::stop(self)
    }
    fn is_running(&self) -> bool {
        ActiveEndpointTracker::is_running(self)
    }
    fn is_stop_requested(&self) -> bool {
        ActiveEndpointTracker::is_stop_requested(self)
    }
    fn wait_until_stopped(&self) {
        ActiveEndpointTracker::wait_until_stopped(self, None);
    }
    fn pause(&self) {
        ActiveEndpointTracker::pause(self);
    }
    fn resume(&self) {
        ActiveEndpointTracker::resume(self);
    }
}

type TrackerFactory = Box<dyn Fn() -> Arc<dyn EndpointTracker> + Send + Sync>;
type Callback0 = Arc<dyn Fn() + Send + Sync>;
type DefaultMicCallback = Arc<dyn Fn(&str, &str) + Send + Sync>;
type DefaultSpeakerCallback = Arc<dyn Fn(&str) + Send + Sync>;

/// The callbacks the controller registers. Each runs on the monitoring thread, except
/// the default speaker callback, which the peak tracker also calls from its thread.
#[derive(Default, Clone)]
pub struct Callbacks {
    pub default_mic_device: Option<DefaultMicCallback>,
    pub default_speaker_device: Option<DefaultSpeakerCallback>,
    pub host_list: Option<Callback0>,
    pub mic_device_list: Option<Callback0>,
    pub speaker_device_list: Option<Callback0>,
    pub before_update_mic_devices: Option<Callback0>,
    pub after_update_mic_devices: Option<Callback0>,
    pub before_update_speaker_devices: Option<Callback0>,
    pub after_update_speaker_devices: Option<Callback0>,
}

#[derive(Default)]
struct Flags {
    default_mic: bool,
    default_speaker: bool,
    host_list: bool,
    mic_list: bool,
    speaker_list: bool,
}

struct Previous {
    snapshot: Arc<DeviceSnapshot>,
    flags: Flags,
}

#[derive(Default)]
struct Lifecycle {
    device_list_monitoring: bool,
    monitor: Option<Worker>,
    monitor_stop_logged: bool,
    speaker_tracker: Option<Arc<dyn EndpointTracker>>,
    reaper: Option<Worker>,
}

/// Something the monitoring loop can wait on, so that tests control time.
pub trait MonitorClock {
    fn now(&self) -> f64;
    /// Wait for a notification for at most `timeout`. Returns whether one arrived.
    fn wait(&self, notify: &Event, timeout: Duration) -> bool;
}

struct RealClock;

impl MonitorClock for RealClock {
    fn now(&self) -> f64 {
        monotonic()
    }
    fn wait(&self, notify: &Event, timeout: Duration) -> bool {
        notify.wait(timeout)
    }
}

/// The device manager. Create one per process with [`DeviceManager::new`].
pub struct DeviceManager {
    backend: Arc<dyn DeviceBackend>,
    reporter: Arc<dyn Reporter>,
    tracker_factory: TrackerFactory,
    snapshot: RwLock<Arc<DeviceSnapshot>>,
    previous: Mutex<Previous>,
    callbacks: RwLock<Callbacks>,
    lifecycle: Mutex<Lifecycle>,
    mic_auto: AtomicBool,
    speaker_auto: AtomicBool,
    tracked_speaker: Mutex<Option<TrackedEndpoint>>,
    stop: Arc<Event>,
    notify: Arc<Event>,
    namespace: String,
    generation: Arc<AtomicU64>,
}

impl DeviceManager {
    /// A manager over `backend`, with one best-effort enumeration done. Monitoring
    /// does not start until requested.
    pub fn new(backend: Arc<dyn DeviceBackend>, reporter: Arc<dyn Reporter>) -> Arc<Self> {
        let meters = backend.meters();
        let tracker_reporter = reporter.clone();
        let factory: TrackerFactory = Box::new(move || Arc::new(ActiveEndpointTracker::new(Flow::Render, meters.clone(), Some(audio_op_lock()), tracker_reporter.clone())));
        let manager = Self::with_tracker_factory(backend, reporter, factory);
        manager.update();
        manager
    }

    /// As [`new`](Self::new) without the first enumeration, with a custom tracker.
    pub fn with_tracker_factory(backend: Arc<dyn DeviceBackend>, reporter: Arc<dyn Reporter>, tracker_factory: TrackerFactory) -> Arc<Self> {
        let initial = Arc::new(DeviceSnapshot::empty());
        let stop = Arc::new(Event::new());
        stop.set();
        Arc::new(Self {
            backend,
            reporter,
            tracker_factory,
            snapshot: RwLock::new(initial.clone()),
            previous: Mutex::new(Previous { snapshot: initial, flags: Flags::default() }),
            callbacks: RwLock::new(Callbacks::default()),
            lifecycle: Mutex::new(Lifecycle::default()),
            mic_auto: AtomicBool::new(false),
            speaker_auto: AtomicBool::new(false),
            tracked_speaker: Mutex::new(None),
            stop,
            notify: Arc::new(Event::new()),
            namespace: random_hex(),
            generation: Arc::new(AtomicU64::new(0)),
        })
    }

    /// The current lists, all from one enumeration.
    pub fn snapshot(&self) -> Arc<DeviceSnapshot> {
        self.snapshot.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn mic_devices(&self) -> MicDevices {
        self.snapshot().mic_devices.clone()
    }

    pub fn default_mic_device(&self) -> crate::snapshot::DefaultMic {
        self.snapshot().default_mic_device.clone()
    }

    pub fn speaker_devices(&self) -> Vec<Device> {
        self.snapshot().speaker_devices.clone()
    }

    pub fn default_speaker_device(&self) -> Device {
        self.snapshot().default_speaker_device.clone()
    }

    pub fn set_callbacks(&self, callbacks: Callbacks) {
        *self.callbacks.write().unwrap_or_else(|e| e.into_inner()) = callbacks;
    }

    pub fn update_callbacks(&self, change: impl FnOnce(&mut Callbacks)) {
        change(&mut self.callbacks.write().unwrap_or_else(|e| e.into_inner()));
    }

    fn callbacks(&self) -> Callbacks {
        self.callbacks.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn publish(&self, snapshot: DeviceSnapshot) {
        *self.snapshot.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(snapshot);
    }

    /// Enumerate and publish a new snapshot.
    pub fn update(&self) {
        // An event during enumeration belongs to the next snapshot.
        let generation = self.generation.load(Ordering::SeqCst);
        let mut lists = self.backend.enumerate();
        if lists.mic_devices.is_empty() {
            lists.mic_devices = DeviceSnapshot::empty().mic_devices;
        }
        if lists.speaker_devices.is_empty() {
            lists.speaker_devices = vec![Device::no_device()];
        }
        let endpoint_ids = self.backend.endpoint_ids();
        let tracked = self.tracked_speaker.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let tracked = tracked.filter(|_| self.speaker_auto.load(Ordering::SeqCst));
        let context = IdentityContext { namespace: &self.namespace, generation, endpoint_ids: &endpoint_ids, tracked_speaker: tracked.as_ref() };
        self.publish(identify(lists, &context));
    }

    /// Invalidate slot identities after a topology event.
    pub fn invalidate_device_incarnations(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    /// The handler a backend's notification registration calls.
    pub fn topology_handler(&self) -> Arc<dyn Fn(Topology) + Send + Sync> {
        let generation = self.generation.clone();
        let notify = self.notify.clone();
        Arc::new(move |event| {
            if event == Topology::DeviceChanged {
                generation.fetch_add(1, Ordering::SeqCst);
            }
            notify.set();
        })
    }

    /// Compare with the previous lists and raise the change flags.
    fn apply_device_diffs(&self) {
        let current = self.snapshot();
        let mut previous = lock(&self.previous);
        let old = previous.snapshot.clone();
        let mut next = (*old).clone();
        if capture_key(Some(&old.default_mic_device.device)) != capture_key(Some(&current.default_mic_device.device)) {
            previous.flags.default_mic = true;
            next.default_mic_device = current.default_mic_device.clone();
        }
        if capture_key(Some(&old.default_speaker_device)) != capture_key(Some(&current.default_speaker_device)) {
            previous.flags.default_speaker = true;
            next.default_speaker_device = current.default_speaker_device.clone();
        }
        let hosts = |s: &DeviceSnapshot| s.mic_hosts().into_iter().map(str::to_owned).collect::<Vec<_>>();
        if hosts(&old) != hosts(&current) {
            previous.flags.host_list = true;
        }
        if mic_keys(&old.mic_devices) != mic_keys(&current.mic_devices) {
            previous.flags.mic_list = true;
            next.mic_devices = current.mic_devices.clone();
        } else if hosts(&old) != hosts(&current) {
            // Same rows per host in another order: keep the order for the host check.
            next.mic_devices = current.mic_devices.clone();
        }
        if keys(&old.speaker_devices) != keys(&current.speaker_devices) {
            previous.flags.speaker_list = true;
            next.speaker_devices = current.speaker_devices.clone();
        }
        previous.snapshot = Arc::new(next);
    }

    /// Run the callbacks for the raised flags, then lower them.
    fn notice_update_devices(&self) {
        let flags = std::mem::take(&mut lock(&self.previous).flags);
        if flags.default_mic {
            self.run_default_mic();
        }
        if flags.default_speaker {
            self.run_default_speaker();
        }
        if flags.host_list {
            self.run(self.callbacks().host_list, "host_list_callback_failed");
        }
        if flags.mic_list {
            self.run(self.callbacks().mic_device_list, "mic_list_callback_failed");
        }
        if flags.speaker_list {
            self.run(self.callbacks().speaker_device_list, "speaker_list_callback_failed");
        }
    }

    fn run(&self, callback: Option<Callback0>, code: &str) {
        if let Some(callback) = callback {
            if catch_unwind(AssertUnwindSafe(|| callback())).is_err() {
                self.reporter.error(code);
            }
        }
    }

    fn run_default_mic(&self) {
        if let Some(callback) = self.callbacks().default_mic_device {
            let default = self.default_mic_device();
            if catch_unwind(AssertUnwindSafe(|| callback(&default.host.name, &default.device.name))).is_err() {
                self.reporter.error("default_mic_callback_failed");
            }
        }
    }

    fn run_default_speaker(&self) {
        if let Some(callback) = self.callbacks().default_speaker_device {
            let default = self.default_speaker_device();
            if catch_unwind(AssertUnwindSafe(|| callback(&default.name))).is_err() {
                self.reporter.error("default_speaker_callback_failed");
            }
        }
    }

    /// Refresh now and report the microphone lists and default.
    pub fn force_update_and_set_mic_devices(&self) {
        self.update();
        self.run(self.callbacks().host_list, "host_list_callback_failed");
        self.run(self.callbacks().mic_device_list, "mic_list_callback_failed");
        self.run_default_mic();
    }

    /// Refresh now and report the speaker list and default.
    pub fn force_update_and_set_speaker_devices(&self) {
        self.update();
        self.run(self.callbacks().speaker_device_list, "speaker_list_callback_failed");
        self.run_default_speaker();
    }

    /// The body of the monitoring thread.
    pub fn monitoring(&self) {
        self.monitoring_with(&RealClock);
    }

    /// [`monitoring`](Self::monitoring) with a substitute clock.
    pub fn monitoring_with(&self, clock: &dyn MonitorClock) {
        // Registered once for the life of the thread, never per event.
        let watch = self.backend.watch(self.topology_handler());
        let registered = watch.is_some();
        let mut next_reconcile = clock.now() + RECONCILE_INTERVAL_SEC;
        while !self.stop.is_set() {
            let notified = clock.wait(&self.notify, MONITOR_WAIT_TIMEOUT);
            if self.stop.is_set() {
                break;
            }
            if registered && !notified && clock.now() < next_reconcile {
                continue;
            }
            // Consume before enumerating: an event during it stays for the next turn.
            self.notify.clear();
            next_reconcile = clock.now() + RECONCILE_INTERVAL_SEC;
            let callbacks = self.callbacks();
            let mic_auto = self.mic_auto.load(Ordering::SeqCst);
            let speaker_auto = self.speaker_auto.load(Ordering::SeqCst);
            if mic_auto {
                self.run(callbacks.before_update_mic_devices.clone(), "before_mic_update_failed");
            }
            if speaker_auto {
                self.run(callbacks.before_update_speaker_devices.clone(), "before_speaker_update_failed");
            }
            self.update();
            if self.stop.is_set() {
                break;
            }
            self.apply_device_diffs();
            self.notice_update_devices();
            if mic_auto {
                self.run(callbacks.after_update_mic_devices.clone(), "after_mic_update_failed");
            }
            if speaker_auto {
                self.run(callbacks.after_update_speaker_devices.clone(), "after_speaker_update_failed");
            }
        }
        drop(watch);
    }

    fn start_monitoring_locked(self: &Arc<Self>, lifecycle: &mut Lifecycle) {
        // A stopped worker may still be cleaning up; never replace it while alive.
        if lifecycle.monitor.as_ref().is_some_and(Worker::is_alive) {
            return;
        }
        lifecycle.monitor_stop_logged = false;
        self.stop.clear();
        self.notify.clear();
        let manager = self.clone();
        match Worker::spawn("astarot-device-monitor", move || manager.monitoring()) {
            Ok(worker) => lifecycle.monitor = Some(worker),
            Err(_) => self.reporter.error("device_monitor_thread_unavailable"),
        }
    }

    fn stop_monitoring_locked(&self, lifecycle: &mut Lifecycle) {
        self.stop.set();
        self.notify.set();
        if let Some(worker) = &lifecycle.monitor {
            if !worker.join(MONITOR_STOP_JOIN) && !lifecycle.monitor_stop_logged {
                lifecycle.monitor_stop_logged = true;
                self.reporter.log("DeviceManager: monitoring stop timed out; restart deferred until the worker exits");
            }
        }
    }

    pub fn start_monitoring(self: &Arc<Self>) {
        let mut lifecycle = lock(&self.lifecycle);
        self.start_monitoring_locked(&mut lifecycle);
    }

    pub fn stop_monitoring(&self) {
        let mut lifecycle = lock(&self.lifecycle);
        self.stop_monitoring_locked(&mut lifecycle);
    }

    pub fn is_monitoring(&self) -> bool {
        !self.stop.is_set()
    }

    fn sync_monitoring_locked(self: &Arc<Self>, lifecycle: &mut Lifecycle) {
        if lifecycle.device_list_monitoring || self.mic_auto.load(Ordering::SeqCst) || self.speaker_auto.load(Ordering::SeqCst) {
            self.start_monitoring_locked(lifecycle);
        } else {
            self.stop_monitoring_locked(lifecycle);
        }
    }

    /// Auto Microphone Select follows the OS default only; no peak tracker runs.
    pub fn set_mic_auto_active(self: &Arc<Self>, active: bool) {
        let mut lifecycle = lock(&self.lifecycle);
        self.mic_auto.store(active, Ordering::SeqCst);
        self.sync_monitoring_locked(&mut lifecycle);
    }

    pub fn set_speaker_auto_active(self: &Arc<Self>, active: bool) {
        let mut lifecycle = lock(&self.lifecycle);
        self.speaker_auto.store(active, Ordering::SeqCst);
        if active {
            self.start_speaker_tracker_locked(&mut lifecycle);
        } else {
            *lock(&self.tracked_speaker) = None;
            self.stop_speaker_tracker_locked(&mut lifecycle);
        }
        self.sync_monitoring_locked(&mut lifecycle);
    }

    /// Keep the lists current whatever the Auto Select settings are.
    pub fn set_device_list_monitoring_active(self: &Arc<Self>, active: bool) {
        let mut lifecycle = lock(&self.lifecycle);
        lifecycle.device_list_monitoring = active;
        self.sync_monitoring_locked(&mut lifecycle);
    }

    pub fn mic_auto_active(&self) -> bool {
        self.mic_auto.load(Ordering::SeqCst)
    }

    pub fn speaker_auto_active(&self) -> bool {
        self.speaker_auto.load(Ordering::SeqCst)
    }

    fn start_speaker_tracker_locked(self: &Arc<Self>, lifecycle: &mut Lifecycle) {
        if let Some(tracker) = &lifecycle.speaker_tracker {
            if tracker.is_running() {
                if tracker.is_stop_requested() {
                    self.reporter.log("DeviceManager: speaker endpoint tracker restart deferred until the previous tracker thread has stopped.");
                }
                return;
            }
            // The old tracker finished its cleanup after a timed-out stop.
            lifecycle.speaker_tracker = None;
        }
        let tracker = (self.tracker_factory)();
        let manager = Arc::downgrade(self);
        tracker.set_on_change(Box::new(move |endpoint| {
            if let Some(manager) = manager.upgrade() {
                manager.on_active_speaker_endpoint_changed(endpoint);
            }
        }));
        tracker.start();
        lifecycle.speaker_tracker = Some(tracker);
    }

    fn stop_speaker_tracker_locked(self: &Arc<Self>, lifecycle: &mut Lifecycle) {
        let Some(tracker) = lifecycle.speaker_tracker.clone() else { return };
        if tracker.stop() {
            lifecycle.speaker_tracker = None;
            return;
        }
        // Keep the reference so a re-enable cannot start a second tracker; restart
        // once after the old thread has ended, if Auto Select is on by then.
        if lifecycle.reaper.as_ref().is_some_and(Worker::is_alive) {
            return;
        }
        let manager = self.clone();
        let spawned = Worker::spawn("speaker_endpoint_tracker_reaper", move || {
            tracker.wait_until_stopped();
            let mut lifecycle = lock(&manager.lifecycle);
            if !lifecycle.speaker_tracker.as_ref().is_some_and(|current| Arc::ptr_eq(current, &tracker)) {
                return;
            }
            lifecycle.speaker_tracker = None;
            lifecycle.reaper = None;
            if manager.speaker_auto.load(Ordering::SeqCst) {
                manager.start_speaker_tracker_locked(&mut lifecycle);
            }
        });
        match spawned {
            Ok(worker) => lifecycle.reaper = Some(worker),
            Err(_) => self.reporter.error("tracker_reaper_unavailable"),
        }
    }

    /// Hold the speaker tracker and wait for its OS call in progress, if any.
    pub fn pause_speaker_endpoint_tracker(&self) {
        let Some(tracker) = lock(&self.lifecycle).speaker_tracker.clone() else { return };
        tracker.pause();
        if audio_op_lock().try_lock_for(PAUSE_BARRIER_TIMEOUT).is_none() {
            self.reporter.log(&format!(
                "pauseSpeakerEndpointTracker: barrier timed out after {}s waiting for the audio lock; a COM call may be stuck. Proceeding without the barrier.",
                PAUSE_BARRIER_TIMEOUT.as_secs_f64()
            ));
        }
    }

    pub fn resume_speaker_endpoint_tracker(&self) {
        if let Some(tracker) = lock(&self.lifecycle).speaker_tracker.clone() {
            tracker.resume();
        }
    }

    /// Whether a speaker tracker is held (running or awaiting cleanup).
    pub fn has_speaker_tracker(&self) -> bool {
        lock(&self.lifecycle).speaker_tracker.is_some()
    }

    fn on_active_speaker_endpoint_changed(&self, endpoint: TrackedEndpoint) {
        if !self.speaker_auto.load(Ordering::SeqCst) {
            return;
        }
        *lock(&self.tracked_speaker) = Some(endpoint.clone());
        let selected = {
            let mut current = self.snapshot.write().unwrap_or_else(|e| e.into_inner());
            let Some(selected) = crate::snapshot::tracked_speaker_device(&current.speaker_devices, &endpoint).cloned() else { return };
            // One snapshot target, one reconciliation callback.
            let mut next = (**current).clone();
            next.default_speaker_device = selected.clone();
            *current = Arc::new(next);
            selected
        };
        if let Some(callback) = self.callbacks().default_speaker_device {
            if catch_unwind(AssertUnwindSafe(|| callback(&selected.name))).is_err() {
                self.reporter.error("default_speaker_callback_failed");
            }
        }
    }

    /// Simulate the tracker reporting an endpoint (for hosts that run their own).
    pub fn report_active_speaker_endpoint(&self, endpoint: TrackedEndpoint) {
        self.on_active_speaker_endpoint_changed(endpoint);
    }

    pub fn stop_event(&self) -> &Event {
        &self.stop
    }

    pub fn notify_event(&self) -> &Event {
        &self.notify
    }
}

fn keys(devices: &[Device]) -> Vec<Option<CaptureKey>> {
    devices.iter().map(|d| capture_key(Some(d))).collect()
}

fn mic_keys(devices: &MicDevices) -> BTreeMap<String, Vec<Option<CaptureKey>>> {
    devices.iter().map(|(host, rows)| (host.clone(), keys(rows))).collect()
}

/// 128 random bits as hex, for the slot identity namespace.
fn random_hex() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for salt in 0..2u64 {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(salt);
        hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        out.push_str(&format!("{:016x}", hasher.finish()));
    }
    out
}

/// The device lists of this platform: WASAPI on Windows, PipeWire on Linux, and
/// only the placeholders elsewhere.
pub fn platform_backend(reporter: Arc<dyn Reporter>) -> Arc<dyn DeviceBackend> {
    #[cfg(windows)]
    {
        Arc::new(crate::wasapi::WasapiBackend::new(reporter))
    }
    #[cfg(all(target_os = "linux", feature = "pipewire"))]
    {
        let _ = reporter;
        Arc::new(crate::pipewire::devices::PipeWireBackend)
    }
    #[cfg(not(any(windows, all(target_os = "linux", feature = "pipewire"))))]
    {
        let _ = reporter;
        Arc::new(NullBackend)
    }
}

/// No devices and no notifications.
pub struct NullBackend;

struct NoMeters;

impl MeterFactory for NoMeters {
    fn available(&self) -> bool {
        false
    }
    fn open(&self, _: Flow) -> Option<Box<dyn crate::tracker::MeterSource>> {
        None
    }
}

impl DeviceBackend for NullBackend {
    fn enumerate(&self) -> RawLists {
        RawLists::none()
    }
    fn watch(&self, _: Arc<dyn Fn(Topology) + Send + Sync>) -> Option<Box<dyn Watch>> {
        None
    }
    fn meters(&self) -> Arc<dyn MeterFactory> {
        Arc::new(NoMeters)
    }
}

#[cfg(test)]
mod tests;
