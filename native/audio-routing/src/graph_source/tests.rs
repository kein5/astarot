//! Ports of [`src-python/test/test_pipewire_graph.py`], with a substitute snapshotter
//! in place of `pw-dump`.
//!
//! [`src-python/test/test_pipewire_graph.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_pipewire_graph.py

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use serde_json::json;

use super::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode {
    Ok,
    Stall,
    Fail,
}

struct Backend {
    cookie: Mutex<u64>,
    mode: Mutex<Mode>,
    release: Event,
    snapshots: AtomicUsize,
    stalled: AtomicUsize,
    made: AtomicUsize,
    dropped: AtomicUsize,
}

impl Backend {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            cookie: Mutex::new(42),
            mode: Mutex::new(Mode::Ok),
            release: Event::new(),
            snapshots: AtomicUsize::new(0),
            stalled: AtomicUsize::new(0),
            made: AtomicUsize::new(0),
            dropped: AtomicUsize::new(0),
        })
    }
    fn set(&self, mode: Mode) {
        *lock(&self.mode) = mode;
    }
}

struct Fake(Arc<Backend>);

impl Snapshotter for Fake {
    fn snapshot(&mut self, deadline: f64, stop: &Event) -> Result<Graph, GraphUnavailable> {
        self.0.snapshots.fetch_add(1, Ordering::SeqCst);
        let mode = *lock(&self.0.mode);
        if mode == Mode::Stall {
            self.0.stalled.fetch_add(1, Ordering::SeqCst);
            while !self.0.release.is_set() {
                if stop.is_set() || monotonic() >= deadline {
                    return Err(GraphUnavailable);
                }
                self.0.release.wait(Duration::from_millis(5));
            }
        }
        if *lock(&self.0.mode) == Mode::Fail {
            return Err(GraphUnavailable);
        }
        Ok(vec![json!({"type": "PipeWire:Interface:Core", "info": {"cookie": *lock(&self.0.cookie)}})])
    }
}

impl Drop for Fake {
    fn drop(&mut self) {
        self.0.dropped.fetch_add(1, Ordering::SeqCst);
    }
}

fn source(backend: &Arc<Backend>) -> Arc<GraphSource> {
    let made = backend.clone();
    GraphSource::new(Arc::new(move || {
        made.made.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(Fake(made.clone())) as Box<dyn Snapshotter>)
    }))
}

fn until(predicate: impl Fn() -> bool) {
    let end = Instant::now() + Duration::from_secs(3);
    while Instant::now() < end {
        if predicate() {
            return;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    panic!("condition did not become true");
}

fn cookie(value: &Observation) -> u64 {
    value.data.as_ref().unwrap()[0]["info"]["cookie"].as_u64().unwrap()
}

#[test]
fn concurrent_readers_share_one_worker() {
    let backend = Backend::new();
    let source = source(&backend);
    let users: Vec<_> = (0..4).map(|_| source.subscribe(None).unwrap()).collect();
    let readers: Vec<_> = (0..4)
        .map(|_| {
            let source = source.clone();
            std::thread::spawn(move || source.read(true, None).map(|v| v.sequence))
        })
        .collect();
    for reader in readers {
        assert!(reader.join().unwrap().is_ok());
    }
    assert_eq!(backend.made.load(Ordering::SeqCst), 1);
    drop(users);
    source.close();
}

#[test]
fn unavailable_observation_fails_readers() {
    for fault in ["fail", "stale", "stopped"] {
        let backend = Backend::new();
        let source = source(&backend);
        let _user = source.subscribe(None).unwrap();
        let first = source.read(true, None).unwrap();
        match fault {
            "fail" => {
                backend.set(Mode::Fail);
                until(|| source.observation().data.is_none());
            }
            "stale" => {
                // No new snapshot arrives, and time moves past the last one.
                backend.set(Mode::Stall);
                until(|| backend.stalled.load(Ordering::SeqCst) >= 1);
                let offset = first.captured + MAX_AGE - monotonic();
                source.set_clock(Arc::new(move || monotonic() + offset.max(0.0) + 0.01));
            }
            _ => {
                lock(&source.state).stop.set();
                until(|| !source.is_running());
            }
        }
        assert_eq!(source.read(false, None).unwrap_err(), GraphUnavailable, "{fault}");
        assert_eq!(source.read(true, None).unwrap_err(), GraphUnavailable, "{fault}");
        backend.release.set();
        source.close();
    }
}

#[test]
fn freshness_is_measured_before_the_snapshot_and_confirmation_waits_past_mutation() {
    let backend = Backend::new();
    let source = source(&backend);
    let _user = source.subscribe(None).unwrap();
    let first = source.read(true, None).unwrap();
    backend.set(Mode::Stall);
    until(|| backend.stalled.load(Ordering::SeqCst) >= 1);
    let barrier = monotonic();
    *lock(&backend.cookie) = 43;
    backend.set(Mode::Ok);
    backend.release.set();
    let value = source.read(true, Some(barrier)).unwrap();
    assert!(value.sequence >= first.sequence + 2);
    assert!(value.captured >= barrier);
    assert_eq!(cookie(&value), 43);
    source.close();
}

#[test]
fn last_release_stops_the_worker_and_it_can_restart() {
    let backend = Backend::new();
    let source = source(&backend);
    let first = source.subscribe(None).unwrap();
    let second = source.subscribe(None).unwrap();
    source.read(true, None).unwrap();
    drop(first);
    assert!(source.is_running());
    backend.set(Mode::Stall);
    until(|| backend.stalled.load(Ordering::SeqCst) >= 1);
    drop(second);
    assert!(!source.is_running());
    assert_eq!(backend.dropped.load(Ordering::SeqCst), backend.made.load(Ordering::SeqCst));
    assert!(source.observation().data.is_none());
    backend.set(Mode::Ok);
    {
        let _user = source.subscribe(None).unwrap();
        assert!(source.read(true, None).unwrap().data.is_some());
    }
    assert!(!source.is_running());
}

#[test]
fn shutdown_with_users_prevents_restart() {
    let backend = Backend::new();
    let source = source(&backend);
    let user = source.subscribe(None).unwrap();
    source.read(true, None).unwrap();
    backend.set(Mode::Stall);
    until(|| backend.stalled.load(Ordering::SeqCst) >= 1);
    source.close();
    drop(user);
    assert!(!source.is_running());
    assert!(source.subscribe(None).is_err());
    assert_eq!(source.read(false, None).unwrap_err(), GraphUnavailable);
}

#[test]
fn reading_without_a_subscriber_never_starts_the_worker() {
    let backend = Backend::new();
    let source = source(&backend);
    assert!(source.read(true, None).is_err());
    assert_eq!(backend.made.load(Ordering::SeqCst), 0);
}

#[test]
fn failed_snapshots_back_off_and_recover() {
    let backend = Backend::new();
    backend.set(Mode::Fail);
    let source = source(&backend);
    let _user = source.subscribe(None).unwrap();
    assert!(source.read(true, None).is_err());
    let failures = backend.snapshots.load(Ordering::SeqCst);
    // 0.1, 0.2, 0.4 s: no more than a handful of attempts in the first second.
    assert!(failures <= 5, "{failures}");
    backend.set(Mode::Ok);
    until(|| source.read(false, None).is_ok());
    assert!(backend.made.load(Ordering::SeqCst) >= 2, "a failed connection is made again");
    source.close();
}

#[test]
fn wake_events_are_set_on_each_publication() {
    let backend = Backend::new();
    let source = source(&backend);
    let wake = Arc::new(Event::new());
    let _user = source.subscribe(Some(wake.clone())).unwrap();
    source.read(true, None).unwrap();
    wake.clear();
    assert!(wake.wait(Duration::from_secs(2)));
    source.close();
}
