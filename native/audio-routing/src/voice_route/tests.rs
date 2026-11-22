//! Ports of `tests/voice/test_managed_route.py` and
//! [`src-python/test/test_voice_route_monitor_mute.py`].
//!
//! [`src-python/test/test_voice_route_monitor_mute.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_voice_route_monitor_mute.py

use std::time::Instant;

use super::*;

#[derive(Default)]
struct Bus(Mutex<Vec<bool>>);
impl MuteBus for Bus {
    fn set_muted(&self, muted: bool) {
        lock(&self.0).push(muted);
    }
}
impl Bus {
    fn muted(&self) -> bool {
        lock(&self.0).last().copied().unwrap_or(false)
    }
    fn opened(&self) -> bool {
        lock(&self.0).contains(&false)
    }
}

struct Store {
    value: Mutex<bool>,
    fail: Mutex<bool>,
}
impl Store {
    fn new(muted: bool) -> Arc<Self> {
        Arc::new(Self { value: Mutex::new(muted), fail: Mutex::new(false) })
    }
    fn value(&self) -> bool {
        *lock(&self.value)
    }
}
impl MuteStore for Store {
    fn read(&self) -> Result<bool> {
        Ok(*lock(&self.value))
    }
    fn write(&self, muted: bool) -> Result<()> {
        if *lock(&self.fail) {
            return Err(Error::value("disk unavailable"));
        }
        *lock(&self.value) = muted;
        Ok(())
    }
}

#[derive(Clone)]
struct GateData {
    identity: (u64, u64),
    muted: bool,
    direct_identity: (u64, u64),
    direct_muted: bool,
    direct_missing: bool,
    direct_fail: bool,
    missing: bool,
    fail: bool,
    changes: Vec<(&'static str, bool)>,
    /// After an unmute: "drift" re-opens direct, "replacement" swaps its identity,
    /// "lost" applies the unmute but reports a failure.
    after_unmute: Option<&'static str>,
}

struct FakeGate {
    data: Mutex<GateData>,
    resuming: Event,
    release: Event,
    prepare_hook: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
}

impl FakeGate {
    fn new() -> Arc<Self> {
        let gate = Arc::new(Self {
            data: Mutex::new(GateData {
                identity: (123, 10),
                muted: false,
                direct_identity: (123, 11),
                direct_muted: false,
                direct_missing: false,
                direct_fail: false,
                missing: false,
                fail: false,
                changes: vec![],
                after_unmute: None,
            }),
            resuming: Event::new(),
            release: Event::new(),
            prepare_hook: Mutex::new(None),
        });
        gate.release.set();
        gate
    }
    fn with<R>(&self, f: impl FnOnce(&mut GateData) -> R) -> R {
        f(&mut lock(&self.data))
    }
    fn inspect(&self) -> Result<GateState> {
        let data = lock(&self.data);
        if data.missing {
            return Err(Error::runtime("managed_endpoint_missing"));
        }
        Ok(GateState { identity: data.identity, muted: data.muted })
    }
}

impl Gate for FakeGate {
    fn prepare(&self) -> Result<()> {
        if let Some(hook) = lock(&self.prepare_hook).as_ref() {
            hook();
        }
        Ok(())
    }
    fn inspect_pair(&self) -> Result<GatePair> {
        let source = self.inspect()?;
        let data = lock(&self.data);
        if data.direct_missing {
            return Err(Error::runtime("direct_endpoint_missing"));
        }
        Ok(GatePair { source, direct: GateState { identity: data.direct_identity, muted: data.direct_muted } })
    }
    fn set_muted(&self, muted: bool, identity: (u64, u64)) -> Result<GateState> {
        if lock(&self.data).fail {
            return Err(Error::runtime("gate_control_failed"));
        }
        if !muted {
            self.resuming.set();
            assert!(self.release.wait(Duration::from_secs(2)));
        }
        let after = {
            let mut data = lock(&self.data);
            if identity != data.identity {
                return Err(Error::runtime("managed_endpoint_changed"));
            }
            data.muted = muted;
            data.changes.push(("main", muted));
            if muted {
                None
            } else {
                data.after_unmute
            }
        };
        match after {
            Some("drift") => lock(&self.data).direct_muted = false,
            Some("replacement") => lock(&self.data).direct_identity = (123, 999),
            Some("lost") => return Err(Error::runtime("confirmation_lost_after_unmute")),
            _ => {}
        }
        self.inspect()
    }
    fn set_direct_muted(&self, muted: bool, identity: (u64, u64)) -> Result<GateState> {
        let mut data = lock(&self.data);
        if data.direct_fail {
            return Err(Error::runtime("direct_gate_control_failed"));
        }
        if data.direct_missing || identity != data.direct_identity {
            return Err(Error::runtime("direct_endpoint_changed"));
        }
        data.direct_muted = muted;
        data.changes.push(("direct", muted));
        Ok(GateState { identity: data.direct_identity, muted })
    }
    fn resume(&self, identity: (u64, u64), direct_identity: (u64, u64), suppress_direct: bool) -> Result<GatePair> {
        self.set_muted(false, identity)?;
        let pair = self.inspect_pair()?;
        if pair.direct.identity != direct_identity || pair.direct.muted != suppress_direct {
            return Err(Error::runtime("direct_gate_change_unconfirmed"));
        }
        Ok(pair)
    }
}

struct Fixture {
    control: VoiceRoute,
    bus: Arc<Bus>,
    gate: Arc<FakeGate>,
    store: Arc<Store>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.gate.release.set();
        self.gate.with(|d| {
            d.missing = false;
            d.fail = false;
            d.direct_missing = false;
            d.direct_fail = false;
            d.after_unmute = None;
        });
        *lock(&self.store.fail) = false;
        self.control.close(Duration::from_secs(3));
    }
}

fn fixture() -> Fixture {
    let (bus, gate, store) = (Arc::new(Bus::default()), FakeGate::new(), Store::new(false));
    let control = VoiceRoute::new(bus.clone(), gate.clone(), store.clone(), RouteOptions { poll_interval: Duration::from_millis(10), on_muted: None });
    Fixture { control, bus, gate, store }
}

const LONG: Duration = Duration::from_secs(3);

fn until(predicate: impl Fn() -> bool) {
    let end = Instant::now() + Duration::from_secs(5);
    while Instant::now() < end {
        if predicate() {
            return;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    panic!("condition did not become true");
}

fn ready(control: &VoiceRoute) {
    until(|| {
        let status = control.status();
        status.ready && !status.pending
    });
}

#[test]
fn managed_attachment_prepares_without_blocking_or_auto_resume() {
    let f = fixture();
    let (entered, release) = (Arc::new(Event::new()), Arc::new(Event::new()));
    f.gate.with(|d| d.missing = true);
    let (seen, held, gate) = (entered.clone(), release.clone(), Arc::downgrade(&f.gate));
    *lock(&f.gate.prepare_hook) = Some(Box::new(move || {
        seen.set();
        assert!(held.wait(Duration::from_secs(1)));
        if let Some(gate) = gate.upgrade() {
            gate.with(|d| d.missing = false);
        }
    }));
    f.control.configure(true, LONG, false).unwrap();
    assert!(entered.wait(Duration::from_millis(500)));
    assert!(f.control.status().preparing);
    assert!(!f.control.status().ready && f.bus.muted());
    release.set();
    ready(&f.control);
    assert!(!f.control.status().preparing);
    assert!(f.gate.with(|d| d.muted) && f.store.value());
}

#[test]
fn external_and_closed_route_never_prepare() {
    let f = fixture();
    *lock(&f.gate.prepare_hook) = Some(Box::new(|| panic!("external/closed route must not create host resources")));
    f.control.configure(false, LONG, false).unwrap();
    f.control.close(LONG);
    assert!(f.control.configure(true, LONG, false).is_err());
}

#[test]
fn managed_start_mutes_and_settings_refresh_cannot_unmute() {
    let f = fixture();
    f.control.configure(true, LONG, false).unwrap();
    ready(&f.control);
    assert!(f.gate.with(|d| d.muted) && f.store.value() && f.bus.muted());
    f.control.configure(true, LONG, false).unwrap();
    assert_eq!(f.control.status().observed_muted, Some(true));
    f.control.resume().unwrap();
    ready(&f.control);
    assert!(!f.gate.with(|d| d.muted) && !f.store.value() && !f.bus.muted());
    f.control.configure(true, LONG, false).unwrap();
    assert!(!f.control.status().requested_muted);
}

#[test]
fn stale_resume_never_opens_bus_after_new_mute() {
    let f = fixture();
    f.control.configure(true, LONG, false).unwrap();
    ready(&f.control);
    f.gate.release.clear();
    f.control.resume().unwrap();
    assert!(f.gate.resuming.wait(Duration::from_secs(1)));
    f.control.mute().unwrap();
    f.gate.release.set();
    ready(&f.control);
    assert!(f.gate.with(|d| d.muted) && f.store.value() && f.bus.muted());
}

#[test]
fn direct_change_during_resume_never_opens_software() {
    for fault in ["drift", "replacement"] {
        let f = fixture();
        f.control.configure(true, LONG, true).unwrap();
        ready(&f.control);
        lock(&f.bus.0).clear();
        f.gate.with(|d| d.after_unmute = Some(fault));
        f.control.resume().unwrap();
        until(|| f.gate.resuming.is_set() && !f.control.status().pending);
        assert!(!f.bus.opened(), "{fault}");
        assert!(f.control.status().requested_muted && f.gate.with(|d| d.muted) && f.store.value());
    }
}

#[test]
fn identity_replacement_requires_another_explicit_resume() {
    let f = fixture();
    f.control.configure(true, LONG, false).unwrap();
    ready(&f.control);
    f.control.resume().unwrap();
    ready(&f.control);
    f.gate.with(|d| {
        d.identity = (456, 10);
        d.muted = true;
    });
    until(|| f.control.status().requested_muted);
    ready(&f.control);
    assert!(f.gate.with(|d| d.muted) && f.bus.muted() && f.store.value());
}

#[test]
fn failed_control_never_claims_ready_and_keeps_software_closed() {
    for failure in ["missing", "fail", "storage"] {
        let f = fixture();
        match failure {
            "missing" => f.gate.with(|d| d.missing = true),
            "fail" => f.gate.with(|d| d.fail = true),
            _ => *lock(&f.store.fail) = true,
        }
        f.control.configure(true, LONG, false).unwrap();
        until(|| f.control.status().error.is_some());
        assert!(!f.control.status().ready, "{failure}");
        assert!(f.bus.muted());
        assert!(f.control.resume().is_err());
        if failure == "storage" {
            assert_eq!(f.control.status().error.as_deref(), Some("mute_state_unavailable"));
        }
    }
}

#[test]
fn leaving_managed_route_requires_confirmed_mute() {
    let f = fixture();
    f.control.configure(true, LONG, false).unwrap();
    ready(&f.control);
    f.control.resume().unwrap();
    ready(&f.control);
    f.gate.with(|d| d.fail = true);
    assert_eq!(f.control.configure(false, Duration::from_millis(100), false).unwrap_err(), Error::runtime("managed_mute_unconfirmed"));
    assert!(f.control.status().managed && f.bus.muted());
    f.gate.with(|d| d.fail = false);
    ready(&f.control);
    f.control.configure(false, LONG, false).unwrap();
    assert!(!f.control.status().managed && f.gate.with(|d| d.muted) && f.store.value());
}

#[test]
fn saved_latch_survives_control_recreation() {
    let (bus, store) = (Arc::new(Bus::default()), Store::new(true));
    let control = VoiceRoute::new(bus.clone(), FakeGate::new(), store.clone(), RouteOptions::default());
    assert!(bus.muted());
    control.resume().unwrap();
    ready(&control);
    assert!(!store.value() && !bus.muted());
    control.close(LONG);
}

#[test]
fn close_drains_late_resume_before_reporting_confirmed_shutdown() {
    for lost in [false, true] {
        let f = fixture();
        f.control.configure(true, LONG, false).unwrap();
        ready(&f.control);
        if lost {
            f.gate.with(|d| d.after_unmute = Some("lost"));
        }
        f.gate.release.clear();
        f.control.resume().unwrap();
        assert!(f.gate.resuming.wait(Duration::from_secs(1)));
        std::thread::scope(|scope| {
            let closing = scope.spawn(|| f.control.close(Duration::from_millis(50)));
            std::thread::sleep(Duration::from_millis(75));
            f.gate.release.set();
            closing.join().unwrap();
        });
        until(|| !f.control.is_working());
        assert!(f.gate.with(|d| d.muted), "a delayed resume must not outlive the final mute");
        assert!(f.store.value() && f.bus.muted());
        assert!(f.control.close(LONG));
        assert_eq!(f.control.status().observed_muted, Some(true));
        assert!(!f.control.status().pending);
    }
}

#[test]
fn shutdown_os_failure_is_not_reported_as_confirmed_shutdown() {
    let f = fixture();
    f.control.configure(true, LONG, false).unwrap();
    ready(&f.control);
    f.control.resume().unwrap();
    ready(&f.control);
    f.gate.with(|d| d.fail = true);
    assert!(!f.control.close(Duration::from_millis(50)));
    until(|| !f.control.is_working());
    let status = f.control.status();
    assert!(!status.ready && status.pending && status.error.is_some());
}

#[test]
fn status_orders_every_snapshot_even_on_a_coarse_clock() {
    let f = fixture();
    let (first, second) = (f.control.status(), f.control.status());
    assert_eq!(first.generation, second.generation);
    assert!(first.observation_id.parse::<u64>().unwrap() < second.observation_id.parse::<u64>().unwrap());
    let ids: Vec<u64> = (0..4).map(|_| next_observation_from(100)).collect();
    assert!(ids.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn direct_suppression_closes_main_first_and_policy_change_requires_resume() {
    let f = fixture();
    f.control.configure(true, LONG, true).unwrap();
    ready(&f.control);
    assert_eq!(f.gate.with(|d| d.changes.clone()), [("main", true), ("direct", true)]);
    assert!(f.control.status().requested_direct_suppressed);
    assert_eq!(f.control.status().observed_direct_suppressed, Some(true));
    f.control.resume().unwrap();
    ready(&f.control);
    assert!(f.gate.with(|d| !d.muted && d.direct_muted) && !f.bus.muted());
    f.gate.with(|d| d.changes.clear());
    f.control.configure(true, LONG, false).unwrap();
    ready(&f.control);
    assert_eq!(f.gate.with(|d| d.changes.clone()), [("main", true), ("direct", false)]);
    assert!(f.gate.with(|d| d.muted) && f.store.value() && f.bus.muted());
    f.control.resume().unwrap();
    ready(&f.control);
    assert!(f.gate.with(|d| !d.muted && !d.direct_muted));
}

#[test]
fn direct_fault_revokes_resume_and_mutes_main_before_repair() {
    for fault in ["drift", "replacement", "missing", "control"] {
        let f = fixture();
        f.control.configure(true, LONG, true).unwrap();
        ready(&f.control);
        f.control.resume().unwrap();
        ready(&f.control);
        f.gate.with(|d| {
            d.changes.clear();
            match fault {
                "replacement" => {
                    d.direct_identity = (123, 12);
                    d.direct_muted = false;
                }
                "missing" => d.direct_missing = true,
                _ => {
                    d.direct_muted = false;
                    d.direct_fail = fault == "control";
                }
            }
        });
        until(|| f.control.status().requested_muted);
        until(|| f.gate.with(|d| d.muted));
        assert_eq!(f.gate.with(|d| d.changes[0]), ("main", true), "{fault}");
        assert!(f.bus.muted());
        if matches!(fault, "missing" | "control") {
            until(|| f.control.status().error.is_some());
            assert!(!f.control.status().ready);
            assert!(f.control.resume().is_err());
        }
        f.gate.with(|d| {
            d.direct_fail = false;
            d.direct_missing = false;
        });
        ready(&f.control);
        assert!(f.gate.with(|d| d.direct_muted && d.muted) && f.store.value());
    }
}

#[test]
fn saved_mute_reaches_the_monitor_before_any_start() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let record = seen.clone();
    let control = VoiceRoute::new(Arc::new(Bus::default()), FakeGate::new(), Store::new(true), RouteOptions { on_muted: Some(Arc::new(move |m| lock(&record).push(m))), ..RouteOptions::default() });
    assert_eq!(*lock(&seen), [true]);
    assert!(!control.is_working(), "no gate worker before a request");
    control.close(LONG);
}

#[test]
fn unreadable_saved_state_starts_muted_and_not_ready() {
    struct Broken;
    impl MuteStore for Broken {
        fn read(&self) -> Result<bool> {
            Err(Error::value("invalid_mute_state"))
        }
        fn write(&self, _: bool) -> Result<()> {
            Ok(())
        }
    }
    let bus = Arc::new(Bus::default());
    let control = VoiceRoute::new(bus.clone(), FakeGate::new(), Arc::new(Broken), RouteOptions::default());
    let status = control.status();
    assert!(bus.muted() && !status.ready && status.requested_muted);
    assert_eq!(status.error.as_deref(), Some("mute_state_unavailable"));
    assert!(control.resume().is_err());
    control.close(LONG);
}

/// A saved mute that stays saved: `write` waits for `release`, or fails.
struct HeldStore {
    entered: Event,
    release: Event,
    fail: bool,
}
impl MuteStore for HeldStore {
    fn read(&self) -> Result<bool> {
        Ok(true)
    }
    fn write(&self, _: bool) -> Result<()> {
        self.entered.set();
        if self.fail {
            return Err(Error::value("disk unavailable"));
        }
        assert!(self.release.wait(Duration::from_secs(2)), "the write was never released");
        Ok(())
    }
}

fn monitor_calls() -> (Arc<Mutex<Vec<bool>>>, RouteOptions) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let record = seen.clone();
    (seen, RouteOptions { poll_interval: Duration::from_millis(10), on_muted: Some(Arc::new(move |m| lock(&record).push(m))) })
}

#[test]
fn a_resume_opens_the_monitor_only_once_its_mute_state_is_saved() {
    // `test_saved_mute_reaches_monitor_before_any_start_and_resume_waits_for_persistence`.
    let store = Arc::new(HeldStore { entered: Event::new(), release: Event::new(), fail: false });
    let (seen, options) = monitor_calls();
    let bus = Arc::new(Bus::default());
    let control = VoiceRoute::new(bus.clone(), FakeGate::new(), store.clone(), options);
    assert_eq!(*lock(&seen), [true]);
    control.resume().unwrap();
    assert!(store.entered.wait(Duration::from_secs(1)));
    // While the unmute is being saved, the monitor stays muted.
    assert_eq!(*lock(&seen), [true, true]);
    assert!(control.status().pending);
    store.release.set();
    until(|| lock(&seen).last() == Some(&false));
    assert_eq!(*lock(&seen), [true, true, false]);
    assert!(!control.status().pending);
    assert!(!bus.muted());
    assert!(control.close(LONG));
    // Closing mutes it again.
    assert_eq!(lock(&seen).last(), Some(&true));
}

#[test]
fn a_mute_state_that_cannot_be_saved_never_opens_the_monitor() {
    // `test_failed_persistence_never_reopens_monitor`.
    let store = Arc::new(HeldStore { entered: Event::new(), release: Event::new(), fail: true });
    let (seen, options) = monitor_calls();
    let control = VoiceRoute::new(Arc::new(Bus::default()), FakeGate::new(), store.clone(), options);
    control.resume().unwrap();
    assert!(store.entered.wait(Duration::from_secs(1)));
    until(|| control.status().error.as_deref() == Some("mute_state_unavailable"));
    // The close cannot save the final mute either: no confirmed shutdown.
    assert!(!control.close(LONG));
    let calls = lock(&seen).clone();
    assert!(!calls.is_empty() && calls.iter().all(|muted| *muted), "{calls:?}");
}

#[test]
fn a_saved_unmute_reaches_the_monitor_without_a_gate_worker_and_closing_mutes_it() {
    // `test_saved_unmuted_state_is_forwarded_without_creating_a_gate_worker`.
    let (seen, options) = monitor_calls();
    let control = VoiceRoute::new(Arc::new(Bus::default()), FakeGate::new(), Store::new(false), options);
    assert_eq!(*lock(&seen), [false]);
    assert!(!control.is_working());
    assert!(control.close(LONG));
    assert_eq!(lock(&seen).last(), Some(&true));
}
