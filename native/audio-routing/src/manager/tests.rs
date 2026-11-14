//! Ports of `src-python/test/test_device_manager.py` and
//! `tests/voice/test_device_reconciliation.py`.

use std::sync::atomic::AtomicUsize;
use std::sync::Barrier;
use std::time::Instant;

use super::*;
use crate::identity::device_id;
use crate::snapshot::{DefaultMic, Host};
use crate::tracker::{MeterSource, Reading};

struct NoMeters;
impl MeterFactory for NoMeters {
    fn available(&self) -> bool {
        false
    }
    fn open(&self, _: Flow) -> Option<Box<dyn MeterSource>> {
        None
    }
}

#[derive(Default)]
struct Quiet(Mutex<Vec<String>>);
impl Reporter for Quiet {
    fn log(&self, message: &str) {
        lock(&self.0).push(message.to_owned());
    }
}

type Enumerate = Box<dyn Fn() -> RawLists + Send + Sync>;

struct WatchToken(Arc<AtomicUsize>);
impl Watch for WatchToken {}
impl Drop for WatchToken {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

struct FakeBackend {
    enumerate: Mutex<Enumerate>,
    registers: bool,
    registered: AtomicUsize,
    unregistered: Arc<AtomicUsize>,
    watch_gate: Option<Arc<Event>>,
    handler: Mutex<Option<Arc<dyn Fn(Topology) + Send + Sync>>>,
}

impl FakeBackend {
    fn new(registers: bool) -> Self {
        Self { enumerate: Mutex::new(Box::new(RawLists::none)), registers, registered: AtomicUsize::new(0), unregistered: Arc::new(AtomicUsize::new(0)), watch_gate: None, handler: Mutex::new(None) }
    }

    fn set_enumerate(&self, f: impl Fn() -> RawLists + Send + Sync + 'static) {
        *lock(&self.enumerate) = Box::new(f);
    }
}

impl DeviceBackend for FakeBackend {
    fn enumerate(&self) -> RawLists {
        (lock(&self.enumerate))()
    }
    fn watch(&self, notify: Arc<dyn Fn(Topology) + Send + Sync>) -> Option<Box<dyn Watch>> {
        self.registered.fetch_add(1, Ordering::SeqCst);
        *lock(&self.handler) = Some(notify);
        if let Some(gate) = &self.watch_gate {
            gate.wait(Duration::from_secs(2));
        }
        self.registers.then(|| Box::new(WatchToken(self.unregistered.clone())) as Box<dyn Watch>)
    }
    fn meters(&self) -> Arc<dyn MeterFactory> {
        Arc::new(NoMeters)
    }
}

/// The stand-in for `_BlockingTracker`.
struct BlockingTracker {
    started: AtomicBool,
    running: AtomicBool,
    stopped: AtomicBool,
    stop_timeout: bool,
    released: Event,
}

impl EndpointTracker for BlockingTracker {
    fn set_on_change(&self, _: Box<dyn Fn(TrackedEndpoint) + Send + Sync>) {}
    fn start(&self) {
        std::thread::sleep(Duration::from_millis(100));
        self.started.store(true, Ordering::SeqCst);
        self.running.store(true, Ordering::SeqCst);
    }
    fn stop(&self) -> bool {
        self.stopped.store(true, Ordering::SeqCst);
        if self.stop_timeout {
            return false;
        }
        self.running.store(false, Ordering::SeqCst);
        self.released.set();
        true
    }
    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
    fn is_stop_requested(&self) -> bool {
        self.stop_timeout && self.stopped.load(Ordering::SeqCst)
    }
    fn wait_until_stopped(&self) {
        if self.stop_timeout {
            self.released.wait_forever();
        }
        self.running.store(false, Ordering::SeqCst);
    }
    fn pause(&self) {}
    fn resume(&self) {}
}

struct Trackers {
    instances: Mutex<Vec<Arc<BlockingTracker>>>,
    stop_timeout: AtomicBool,
}

fn manager_with(backend: Arc<FakeBackend>) -> (Arc<DeviceManager>, Arc<Trackers>) {
    let trackers = Arc::new(Trackers { instances: Mutex::new(Vec::new()), stop_timeout: AtomicBool::new(false) });
    let made = trackers.clone();
    let factory: TrackerFactory = Box::new(move || {
        let tracker = Arc::new(BlockingTracker {
            started: AtomicBool::new(false),
            running: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            stop_timeout: made.stop_timeout.load(Ordering::SeqCst),
            released: Event::new(),
        });
        lock(&made.instances).push(tracker.clone());
        tracker
    });
    (DeviceManager::with_tracker_factory(backend, Arc::new(Quiet::default()), factory), trackers)
}

fn shutdown(manager: &Arc<DeviceManager>) {
    manager.set_mic_auto_active(false);
    manager.set_speaker_auto_active(false);
    manager.set_device_list_monitoring_active(false);
}

#[test]
fn concurrent_enable_does_not_start_two_monitoring_threads() {
    let gate = Arc::new(Event::new());
    let backend = Arc::new(FakeBackend { watch_gate: Some(gate.clone()), ..FakeBackend::new(false) });
    let (manager, _) = manager_with(backend.clone());
    let barrier = Arc::new(Barrier::new(2));
    let threads: Vec<_> = [true, false]
        .into_iter()
        .map(|mic| {
            let (manager, barrier) = (manager.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                if mic {
                    manager.set_mic_auto_active(true)
                } else {
                    manager.set_speaker_auto_active(true)
                }
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    gate.set();
    assert_eq!(backend.registered.load(Ordering::SeqCst), 1, "two monitoring threads started");
    shutdown(&manager);
}

#[test]
fn enabling_mic_auto_starts_no_endpoint_tracker() {
    let (manager, trackers) = manager_with(Arc::new(FakeBackend::new(false)));
    manager.set_mic_auto_active(true);
    assert!(lock(&trackers.instances).is_empty());
    assert!(!manager.has_speaker_tracker());
    assert!(manager.mic_auto_active());
    shutdown(&manager);
}

#[test]
fn concurrent_enable_starts_speaker_tracker_exactly_once() {
    let (manager, trackers) = manager_with(Arc::new(FakeBackend::new(false)));
    let barrier = Arc::new(Barrier::new(2));
    let threads: Vec<_> = (0..2)
        .map(|_| {
            let (manager, barrier) = (manager.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                manager.set_speaker_auto_active(true);
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    let started = lock(&trackers.instances).iter().filter(|t| t.started.load(Ordering::SeqCst)).count();
    assert_eq!(started, 1);
    shutdown(&manager);
}

#[test]
fn stop_timeout_blocks_parallel_tracker_and_restarts_after_cleanup() {
    let (manager, trackers) = manager_with(Arc::new(FakeBackend::new(false)));
    trackers.stop_timeout.store(true, Ordering::SeqCst);
    manager.set_speaker_auto_active(true);
    let first = lock(&trackers.instances)[0].clone();
    manager.set_speaker_auto_active(false);
    assert!(manager.has_speaker_tracker(), "a timed-out tracker stays referenced");
    manager.set_speaker_auto_active(true);
    assert_eq!(lock(&trackers.instances).len(), 1);
    trackers.stop_timeout.store(false, Ordering::SeqCst);
    first.released.set();
    let deadline = Instant::now() + Duration::from_secs(2);
    while lock(&trackers.instances).len() < 2 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(lock(&trackers.instances).len(), 2, "no restart after the old tracker ended");
    shutdown(&manager);
}

#[test]
fn disable_one_side_while_other_stays_active_does_not_stop_monitoring() {
    let (manager, _) = manager_with(Arc::new(FakeBackend::new(false)));
    manager.set_mic_auto_active(true);
    manager.set_speaker_auto_active(true);
    assert!(manager.is_monitoring());
    manager.set_mic_auto_active(false);
    assert!(manager.is_monitoring());
    assert!(manager.speaker_auto_active());
    shutdown(&manager);
}

#[test]
fn device_list_monitoring_stays_active_when_auto_select_is_off() {
    let (manager, _) = manager_with(Arc::new(FakeBackend::new(false)));
    manager.set_device_list_monitoring_active(true);
    manager.set_mic_auto_active(false);
    manager.set_speaker_auto_active(false);
    assert!(manager.is_monitoring());
    manager.set_device_list_monitoring_active(false);
    assert!(!manager.is_monitoring());
}

/// Time that moves only when the loop waits.
struct FakeClock {
    now: Mutex<f64>,
    waits: Mutex<Vec<Duration>>,
    stop: Arc<Event>,
    /// Runs before the wait looks at the notification.
    hook: Box<dyn Fn(&FakeClock, &Event) + Send + Sync>,
    /// Runs after a wait timed out and the clock advanced.
    after: Box<dyn Fn(&FakeClock, &Event) + Send + Sync>,
}

impl FakeClock {
    fn new(manager: &DeviceManager) -> Self {
        Self { now: Mutex::new(0.0), waits: Mutex::new(Vec::new()), stop: manager.stop.clone(), hook: Box::new(|_, _| {}), after: Box::new(|_, _| {}) }
    }
    fn now(&self) -> f64 {
        *lock(&self.now)
    }
}

impl MonitorClock for FakeClock {
    fn now(&self) -> f64 {
        *lock(&self.now)
    }
    fn wait(&self, notify: &Event, timeout: Duration) -> bool {
        lock(&self.waits).push(timeout);
        if lock(&self.waits).len() > 100 {
            self.stop.set();
            return false;
        }
        (self.hook)(self, notify);
        if notify.is_set() {
            return true;
        }
        *lock(&self.now) += timeout.as_secs_f64();
        (self.after)(self, notify);
        notify.is_set()
    }
}

/// Run the loop with a backend whose enumeration records the time and calls `on_update`.
fn run_monitor(
    registers: bool,
    clock_hook: impl Fn(&FakeClock, &Event) + Send + Sync + 'static,
    after_hook: impl Fn(&FakeClock, &Event) + Send + Sync + 'static,
    on_update: impl Fn(usize, &DeviceManager) + Send + Sync + 'static,
    initial_notify: bool,
) -> (Vec<f64>, Arc<FakeBackend>, Vec<Duration>) {
    let backend = Arc::new(FakeBackend::new(registers));
    let (manager, _) = manager_with(backend.clone());
    let mut clock = FakeClock::new(&manager);
    clock.hook = Box::new(clock_hook);
    clock.after = Box::new(after_hook);
    let clock = Arc::new(clock);
    let snapshots = Arc::new(Mutex::new(Vec::new()));
    let (seen, time, weak) = (snapshots.clone(), clock.clone(), Arc::downgrade(&manager));
    backend.set_enumerate(move || {
        let count = {
            let mut seen = lock(&seen);
            seen.push(time.now());
            seen.len()
        };
        if let Some(manager) = weak.upgrade() {
            on_update(count, &manager);
        }
        RawLists::none()
    });
    manager.stop.clear();
    if initial_notify {
        manager.notify.set();
    }
    manager.monitoring_with(clock.as_ref());
    let waits = lock(&clock.waits).clone();
    let result = lock(&snapshots).clone();
    (result, backend, waits)
}

#[test]
fn registers_once_and_unregisters_once_across_notification_cycles() {
    let (snapshots, backend, _) = run_monitor(
        true,
        |_, notify| notify.set(),
        |_, _| {},
        |count, manager| {
            if count == 3 {
                manager.stop.set();
            }
        },
        false,
    );
    assert_eq!(snapshots.len(), 3);
    assert_eq!(backend.registered.load(Ordering::SeqCst), 1);
    assert_eq!(backend.unregistered.load(Ordering::SeqCst), 1);
}

#[test]
fn com_events_during_snapshot_survive_and_timeouts_reconcile() {
    for during_refresh in [true, false] {
        let (snapshots, backend, _) = run_monitor(
            true,
            |_, _| {},
            |_, _| {},
            move |count, manager| {
                if count == 1 && during_refresh {
                    manager.notify.set();
                }
                if count == 2 {
                    manager.stop.set();
                }
            },
            true,
        );
        assert_eq!(snapshots, if during_refresh { vec![0.0, 0.0] } else { vec![0.0, 60.0] });
        assert_eq!(backend.registered.load(Ordering::SeqCst), 1);
        assert_eq!(backend.unregistered.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn registered_notifications_skip_short_timeouts_until_safety_net_deadline() {
    let (snapshots, _, waits) = run_monitor(
        true,
        |_, _| {},
        |clock, notify| {
            if clock.now() == 10.0 {
                notify.set();
            }
        },
        |count, manager| {
            if count == 3 {
                manager.stop.set();
            }
        },
        false,
    );
    assert_eq!(snapshots, [10.0, 70.0, 130.0]);
    assert!(waits.iter().all(|w| *w == MONITOR_WAIT_TIMEOUT));
}

#[test]
fn without_registration_every_two_second_timeout_refreshes() {
    let (snapshots, backend, _) = run_monitor(
        false,
        |_, _| {},
        |_, _| {},
        |count, manager| {
            if count == 2 {
                manager.stop.set();
            }
        },
        false,
    );
    assert_eq!(snapshots, [2.0, 4.0]);
    assert_eq!(backend.registered.load(Ordering::SeqCst), 1);
}

#[test]
fn stop_between_reconciliations_never_enumerates() {
    for wake in [false, true] {
        let backend = Arc::new(FakeBackend::new(true));
        let (manager, _) = manager_with(backend.clone());
        let mut clock = FakeClock::new(&manager);
        let stop = manager.stop.clone();
        clock.hook = Box::new(move |_, notify| {
            stop.set();
            if wake {
                notify.set();
            }
        });
        let enumerated = Arc::new(AtomicUsize::new(0));
        let count = enumerated.clone();
        backend.set_enumerate(move || {
            count.fetch_add(1, Ordering::SeqCst);
            RawLists::none()
        });
        manager.stop.clear();
        manager.monitoring_with(&clock);
        assert_eq!(enumerated.load(Ordering::SeqCst), 0);
        assert_eq!(clock.now(), if wake { 0.0 } else { 2.0 });
        assert_eq!(backend.unregistered.load(Ordering::SeqCst), 1);
    }
}

fn one_device_lists(device: &Device) -> RawLists {
    RawLists {
        mic_devices: vec![("WASAPI".into(), vec![device.clone()])],
        default_mic_device: DefaultMic { host: Host { index: 0, name: "WASAPI".into() }, device: device.clone() },
        speaker_devices: vec![device.clone()],
        default_speaker_device: device.clone(),
    }
}

#[test]
fn incarnation_or_format_change_is_not_hidden_by_same_label() {
    let original = Device { name: "USB mic".into(), index: 1, endpoint_id: Some("native-a".into()), default_sample_rate: Some(48000.0), max_input_channels: Some(2), ..Device::default() };
    let changes: [fn(&mut Device); 4] = [|d| d.index = 6, |d| d.default_sample_rate = Some(16000.0), |d| d.max_input_channels = Some(1), |d| d.endpoint_id = Some("replacement".into())];
    for change in changes {
        let backend = Arc::new(FakeBackend::new(false));
        let (manager, _) = manager_with(backend.clone());
        let first = original.clone();
        backend.set_enumerate(move || one_device_lists(&first));
        manager.update();
        manager.apply_device_diffs();
        manager.notice_update_devices();
        let before = manager.snapshot().mics("WASAPI").unwrap()[0].clone();
        let mut changed = original.clone();
        change(&mut changed);
        backend.set_enumerate(move || one_device_lists(&changed));
        manager.update();
        manager.apply_device_diffs();
        let previous = lock(&manager.previous);
        assert!(previous.flags.mic_list && previous.flags.speaker_list && previous.flags.default_mic && previous.flags.default_speaker);
        drop(previous);
        assert_ne!(capture_key(Some(&before)), capture_key(Some(&manager.snapshot().mics("WASAPI").unwrap()[0])));
    }
}

#[test]
fn notifications_run_callbacks_once_per_change() {
    let backend = Arc::new(FakeBackend::new(false));
    let (manager, _) = manager_with(backend.clone());
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (a, b, c) = (calls.clone(), calls.clone(), calls.clone());
    manager.set_callbacks(Callbacks {
        default_mic_device: Some(Arc::new(move |host, name| lock(&a).push(format!("mic:{host}:{name}")))),
        mic_device_list: Some(Arc::new(move || lock(&b).push("list".into()))),
        host_list: Some(Arc::new(move || lock(&c).push("hosts".into()))),
        ..Callbacks::default()
    });
    let device = Device { name: "USB mic".into(), endpoint_id: Some("a".into()), ..Device::default() };
    backend.set_enumerate(move || one_device_lists(&device));
    for _ in 0..2 {
        manager.update();
        manager.apply_device_diffs();
        manager.notice_update_devices();
    }
    assert_eq!(*lock(&calls), ["mic:WASAPI:USB mic", "hosts", "list"]);
}

#[test]
fn topology_event_during_enumeration_keeps_next_incarnation_distinct() {
    let backend = Arc::new(FakeBackend::new(false));
    let (manager, _) = manager_with(backend.clone());
    let handler = manager.topology_handler();
    let fired = Arc::new(AtomicBool::new(false));
    let once = fired.clone();
    let device = Device { name: "USB mic".into(), index: 1, default_sample_rate: Some(48000.0), max_input_channels: Some(2), is_loopback: Some(false), ..Device::default() };
    backend.set_enumerate(move || {
        if !once.swap(true, Ordering::SeqCst) {
            handler(Topology::DeviceChanged);
        }
        one_device_lists(&device)
    });
    manager.update();
    let before = manager.snapshot().mics("WASAPI").unwrap()[0].clone();
    manager.update();
    let after = manager.snapshot().mics("WASAPI").unwrap()[0].clone();
    assert_eq!(before.incarnation.unwrap().0 + 1, after.incarnation.unwrap().0);
    assert_ne!(device_id(Some(&before)), device_id(Some(&after)));
    assert!(manager.notify.is_set());
}

#[test]
fn default_change_keeps_slot_identities() {
    let (manager, _) = manager_with(Arc::new(FakeBackend::new(false)));
    manager.topology_handler()(Topology::DefaultChanged);
    assert_eq!(manager.generation.load(Ordering::SeqCst), 0);
    assert!(manager.notify.is_set());
}

#[test]
fn speaker_peak_identity_survives_fallback_polling() {
    let backend = Arc::new(FakeBackend::new(false));
    let (manager, _) = manager_with(backend.clone());
    manager.speaker_auto.store(true, Ordering::SeqCst);
    let speakers: Vec<Device> = [("a", 1), ("b", 6)].iter().map(|&(id, index)| Device { name: "USB Audio [Loopback]".into(), endpoint_id: Some(id.into()), index, ..Device::default() }).collect();
    let rows = speakers.clone();
    backend.set_enumerate(move || RawLists { speaker_devices: rows.clone(), default_speaker_device: rows[0].clone(), ..RawLists::none() });
    manager.update();
    let changed = Arc::new(Mutex::new(Vec::new()));
    let seen = changed.clone();
    manager.update_callbacks(|c| c.default_speaker_device = Some(Arc::new(move |name: &str| lock(&seen).push(name.to_owned()))));
    manager.report_active_speaker_endpoint(TrackedEndpoint { id: "b".into(), name: "USB Audio".into() });
    assert_eq!(manager.default_speaker_device().endpoint_id.as_deref(), Some("b"));
    manager.update();
    assert_eq!(manager.default_speaker_device().endpoint_id.as_deref(), Some("b"));
    assert_eq!(lock(&changed).len(), 1);
}

#[test]
fn tracked_endpoint_is_ignored_while_auto_speaker_is_off() {
    let (manager, _) = manager_with(Arc::new(FakeBackend::new(false)));
    manager.report_active_speaker_endpoint(TrackedEndpoint { id: "b".into(), name: "USB Audio".into() });
    assert!(lock(&manager.tracked_speaker).is_none());
}

#[test]
fn empty_enumeration_shows_placeholders() {
    let (manager, _) = manager_with(Arc::new(FakeBackend::new(false)));
    manager.update();
    assert_eq!(*manager.snapshot(), DeviceSnapshot::empty());
}

#[test]
fn real_tracker_change_reaches_the_default_speaker() {
    struct Playing;
    impl MeterSource for Playing {
        fn poll(&mut self) -> Vec<Reading> {
            vec![Reading { id: "b".into(), name: "USB Audio".into(), peak: 0.5 }]
        }
    }
    struct Meters;
    impl MeterFactory for Meters {
        fn available(&self) -> bool {
            true
        }
        fn open(&self, _: Flow) -> Option<Box<dyn MeterSource>> {
            Some(Box::new(Playing))
        }
    }
    struct Backend(Vec<Device>);
    impl DeviceBackend for Backend {
        fn enumerate(&self) -> RawLists {
            RawLists { speaker_devices: self.0.clone(), default_speaker_device: self.0[0].clone(), ..RawLists::none() }
        }
        fn watch(&self, _: Arc<dyn Fn(Topology) + Send + Sync>) -> Option<Box<dyn Watch>> {
            None
        }
        fn meters(&self) -> Arc<dyn MeterFactory> {
            Arc::new(Meters)
        }
    }
    let speakers = [("a", 1), ("b", 6)].iter().map(|&(id, index)| Device { name: "USB Audio [Loopback]".into(), endpoint_id: Some(id.into()), index, ..Device::default() }).collect();
    let manager = DeviceManager::new(Arc::new(Backend(speakers)), Arc::new(Quiet::default()));
    let changed = Arc::new(Event::new());
    let flag = changed.clone();
    manager.update_callbacks(|c| c.default_speaker_device = Some(Arc::new(move |_: &str| flag.set())));
    manager.set_speaker_auto_active(true);
    assert!(changed.wait(Duration::from_secs(5)));
    assert_eq!(manager.default_speaker_device().endpoint_id.as_deref(), Some("b"));
    shutdown(&manager);
}
