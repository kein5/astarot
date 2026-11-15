//! One bounded, read-only PipeWire observation shared by every control reader.
//!
//! Port of `src-python/models/audio_routing/pipewire_graph.py`. While anyone is
//! subscribed, one worker thread takes a snapshot of the graph every 100 ms and
//! publishes it with the time taken *before* the snapshot started. Readers accept an
//! observation only while it is younger than one second, and a reader confirming a
//! change asks for one captured after the change. When the last subscriber leaves,
//! the worker stops; a closed source never starts again.
//!
//! Python ran `pw-dump` for each snapshot. Here a [`Snapshotter`] does it; the native
//! one (`pipewire::observer`) keeps a registry connection and ends each snapshot with
//! a server round trip, so a snapshot holds every change made before it began.

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

use crate::graph::Graph;
use crate::sync::{lock, monotonic, Event, Worker};

pub const INTERVAL: f64 = 0.1;
/// The age at which an observation is no longer evidence of the present.
pub const MAX_AGE: f64 = 1.0;
/// The largest graph accepted, in bytes of JSON.
pub const MAX_BYTES: usize = 8 * 1024 * 1024;

/// No current observation: the graph cannot be read now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GraphUnavailable;

/// One published observation.
#[derive(Debug, Clone)]
pub struct Observation {
    pub sequence: u64,
    /// Monotonic seconds before the snapshot began, never when it arrived.
    pub captured: f64,
    pub data: Option<Arc<Graph>>,
}

/// Takes snapshots on the worker thread.
pub trait Snapshotter {
    /// The graph now, or `Err` when it cannot be read before `deadline` (monotonic
    /// seconds) or `stop` is set.
    fn snapshot(&mut self, deadline: f64, stop: &Event) -> Result<Graph, GraphUnavailable>;
}

/// Makes a snapshotter on the worker thread (native handles may be thread-bound).
pub type SnapshotterFactory = Arc<dyn Fn() -> Result<Box<dyn Snapshotter>, GraphUnavailable> + Send + Sync>;
pub type Clock = Arc<dyn Fn() -> f64 + Send + Sync>;

struct State {
    users: Vec<(u64, Option<Arc<Event>>)>,
    next_user: u64,
    thread: Option<Worker>,
    stop: Arc<Event>,
    closed: bool,
    observation: Observation,
}

pub struct GraphSource {
    factory: SnapshotterFactory,
    clock: Mutex<Clock>,
    state: Mutex<State>,
    changed: Condvar,
    lifecycle: Mutex<()>,
}

/// Keeps the worker running; dropping it is `close()`.
pub struct Subscription {
    source: Arc<GraphSource>,
    id: u64,
    closed: bool,
}

impl Subscription {
    pub fn close(&mut self) {
        if !self.closed {
            self.closed = true;
            self.source.release(Some(self.id));
        }
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self.close();
    }
}

impl GraphSource {
    pub fn new(factory: SnapshotterFactory) -> Arc<Self> {
        Self::with_clock(factory, Arc::new(monotonic))
    }

    pub fn with_clock(factory: SnapshotterFactory, clock: Clock) -> Arc<Self> {
        Arc::new(Self {
            factory,
            clock: Mutex::new(clock),
            state: Mutex::new(State {
                users: Vec::new(),
                next_user: 0,
                thread: None,
                stop: Arc::new(Event::new()),
                closed: false,
                observation: Observation { sequence: 0, captured: 0.0, data: None },
            }),
            changed: Condvar::new(),
            lifecycle: Mutex::new(()),
        })
    }

    fn now(&self) -> f64 {
        (lock(&self.clock))()
    }

    /// Replace the clock (tests).
    pub fn set_clock(&self, clock: Clock) {
        *lock(&self.clock) = clock;
    }

    /// Register interest; `wake` is set on every publication.
    pub fn subscribe(self: &Arc<Self>, wake: Option<Arc<Event>>) -> Result<Subscription, GraphUnavailable> {
        let _lifecycle = lock(&self.lifecycle);
        let mut state = lock(&self.state);
        if state.closed {
            return Err(GraphUnavailable);
        }
        state.next_user += 1;
        let id = state.next_user;
        state.users.push((id, wake));
        Ok(Subscription { source: self.clone(), id, closed: false })
    }

    fn publish(&self, captured: f64, data: Option<Arc<Graph>>) {
        let mut state = lock(&self.state);
        state.observation = Observation { sequence: state.observation.sequence + 1, captured, data };
        self.changed.notify_all();
        for (_, wake) in &state.users {
            if let Some(wake) = wake {
                wake.set();
            }
        }
    }

    pub fn observation(&self) -> Observation {
        lock(&self.state).observation.clone()
    }

    fn current(&self, state: &State) -> Result<Observation, GraphUnavailable> {
        let value = &state.observation;
        let age = self.now() - value.captured;
        let alive = state.thread.as_ref().is_some_and(Worker::is_alive);
        if state.closed || value.data.is_none() || !alive || state.stop.is_set() || !(0.0..MAX_AGE).contains(&age) {
            return Err(GraphUnavailable);
        }
        Ok(value.clone())
    }

    /// The current observation; with `after`, one captured at or after that time.
    ///
    /// With `wait`, a subscribed reader may start the worker and waits up to one
    /// second; only the very first acquisition may wait out unavailable data.
    pub fn read(self: &Arc<Self>, wait: bool, after: Option<f64>) -> Result<Observation, GraphUnavailable> {
        let mut state = lock(&self.state);
        if state.closed {
            return Err(GraphUnavailable);
        }
        if wait && state.thread.is_none() && !state.users.is_empty() {
            state = self.start_locked(state);
        }
        let deadline = self.now() + MAX_AGE;
        let initial = state.observation.sequence;
        loop {
            match self.current(&state) {
                Ok(value) if after.is_none_or(|after| value.captured >= after) => return Ok(value),
                Ok(_) => {}
                Err(_) => {
                    let observation = &state.observation;
                    if !wait || observation.data.is_some() || observation.sequence != initial || observation.captured > 0.0 {
                        return Err(GraphUnavailable);
                    }
                }
            }
            let dead = state.thread.as_ref().is_some_and(|t| !t.is_alive());
            if !wait || state.closed || state.stop.is_set() || dead {
                return Err(GraphUnavailable);
            }
            let remaining = deadline - self.now();
            if remaining <= 0.0 {
                return Err(GraphUnavailable);
            }
            state = self.changed.wait_timeout(state, Duration::from_secs_f64(remaining.min(0.05))).unwrap_or_else(|e| e.into_inner()).0;
        }
    }

    fn start_locked<'a>(self: &'a Arc<Self>, mut state: MutexGuard<'a, State>) -> MutexGuard<'a, State> {
        let stop = Arc::new(Event::new());
        state.stop = stop.clone();
        let source = Arc::downgrade(self);
        let factory = self.factory.clone();
        match Worker::spawn("vrct-pipewire-graph", move || work(&source, &factory, &stop)) {
            Ok(worker) => state.thread = Some(worker),
            Err(_) => state.stop.set(),
        }
        state
    }

    fn release(&self, user: Option<u64>) {
        let _lifecycle = lock(&self.lifecycle);
        let thread = {
            let mut state = lock(&self.state);
            if let Some(user) = user {
                state.users.retain(|(id, _)| *id != user);
            }
            if !state.users.is_empty() {
                return;
            }
            state.stop.set();
            self.changed.notify_all();
            state.thread.clone()
        };
        if let Some(thread) = &thread {
            thread.join(Duration::from_secs_f64(MAX_AGE + INTERVAL));
        }
        let mut state = lock(&self.state);
        let same = match (&state.thread, &thread) {
            (Some(current), Some(joined)) => current.same(joined) && !joined.is_alive(),
            (None, None) => true,
            _ => false,
        };
        if same {
            state.thread = None;
            state.observation = Observation { sequence: state.observation.sequence + 1, captured: 0.0, data: None };
        }
    }

    /// Stop for good: no subscription or read succeeds afterwards.
    pub fn close(&self) {
        {
            let mut state = lock(&self.state);
            state.closed = true;
            state.users.clear();
        }
        self.release(None);
    }

    pub fn is_running(&self) -> bool {
        lock(&self.state).thread.as_ref().is_some_and(Worker::is_alive)
    }

    pub fn is_closed(&self) -> bool {
        lock(&self.state).closed
    }
}

fn work(source: &std::sync::Weak<GraphSource>, factory: &SnapshotterFactory, stop: &Event) {
    let mut backoff = INTERVAL;
    let mut snapshotter: Option<Box<dyn Snapshotter>> = None;
    while !stop.is_set() {
        let Some(owner) = source.upgrade() else { return };
        let captured = owner.now();
        let result = (|| {
            if snapshotter.is_none() {
                snapshotter = Some(factory()?);
            }
            let graph = snapshotter.as_mut().ok_or(GraphUnavailable)?.snapshot(captured + MAX_AGE, stop)?;
            if stop.is_set() || owner.now() - captured >= MAX_AGE {
                return Err(GraphUnavailable);
            }
            Ok(graph)
        })();
        let delay = match result {
            Ok(graph) => {
                owner.publish(captured, Some(Arc::new(graph)));
                backoff = INTERVAL;
                (INTERVAL - (owner.now() - captured)).max(0.0)
            }
            Err(GraphUnavailable) => {
                // A broken connection is made again on the next attempt.
                snapshotter = None;
                owner.publish(captured, None);
                let delay = backoff;
                backoff = (backoff * 2.0).min(1.0);
                delay
            }
        };
        drop(owner);
        stop.wait(Duration::from_secs_f64(delay));
    }
    drop(snapshotter);
    if let Some(owner) = source.upgrade() {
        let now = owner.now();
        owner.publish(now, None);
    }
}

#[cfg(test)]
mod tests;
