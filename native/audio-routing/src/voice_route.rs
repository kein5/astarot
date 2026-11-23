//! Mute control of the managed route: the OS gate and the durable intent.
//!
//! Port of [`src-python/models/audio_routing/managed_route.py`]. It never processes
//! audio. Software output stays closed until the OS gate and the saved intent both
//! confirm a resume; any doubt (a replaced endpoint, an external change, a failed
//! control, a lost confirmation) mutes and requires another explicit resume.
//!
//! [`src-python/models/audio_routing/managed_route.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/managed_route.py

use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::Duration;

use crate::error::{Error, Kind, Result};
use crate::graph::GateState;
use crate::mute_state::MuteStore;
use crate::sync::{lock, monotonic, monotonic_ns, Event, Worker};

/// The managed source and the direct VC input, as one observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GatePair {
    pub source: GateState,
    pub direct: GateState,
}

/// The OS-side control of the managed route.
pub trait Gate: Send + Sync {
    /// Start or stop observing the graph; `wake` is set when it changes.
    fn observe(&self, enabled: bool, wake: &Arc<Event>) -> Result<()> {
        let _ = (enabled, wake);
        Ok(())
    }
    fn close_observer(&self) {}
    /// Create the managed endpoints if they are missing.
    fn prepare(&self) -> Result<()> {
        Ok(())
    }
    /// Whether a [`Gate::prepare`] since the last call retired the units of the route's old
    /// names, so that the virtual microphone VRChat had chosen is gone (ADR-014, 2.8). Asked
    /// after each preparation, also a failed one: the old units may have stopped before it failed.
    fn retired_legacy(&self) -> bool {
        false
    }
    fn inspect_pair(&self) -> Result<GatePair>;
    fn set_muted(&self, muted: bool, identity: (u64, u64)) -> Result<GateState>;
    fn set_direct_muted(&self, muted: bool, identity: (u64, u64)) -> Result<GateState>;
    /// Unmute the source while the direct branch keeps `suppress_direct`.
    fn resume(&self, identity: (u64, u64), direct_identity: (u64, u64), suppress_direct: bool) -> Result<GatePair>;
}

/// The software side: the speech bus whose output is opened or closed.
pub trait MuteBus: Send + Sync {
    fn set_muted(&self, muted: bool);
}

/// Strictly increasing across every route in the process, even on a coarse clock.
fn next_observation_from(now: u64) -> u64 {
    static LAST: OnceLock<Mutex<u64>> = OnceLock::new();
    let mut last = lock(LAST.get_or_init(|| Mutex::new(0)));
    *last = now.max(*last + 1);
    *last
}

/// One status snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteStatus {
    pub managed: bool,
    pub requested_muted: bool,
    pub observed_muted: Option<bool>,
    pub ready: bool,
    pub pending: bool,
    pub error: Option<String>,
    pub preparing: bool,
    pub generation: u64,
    pub closed: bool,
    pub requested_direct_suppressed: bool,
    pub observed_direct_suppressed: Option<bool>,
    /// Text, so that nanosecond order survives JavaScript numbers.
    pub observation_id: String,
}

struct State {
    closed: bool,
    managed: bool,
    identity: Option<(u64, u64)>,
    direct_identity: Option<(u64, u64)>,
    suppress_direct: bool,
    direct_observed: Option<bool>,
    revision: u64,
    pending: bool,
    error: Option<String>,
    ready: bool,
    preparing: bool,
    prepare_needed: bool,
    prepare_after: f64,
    desired: bool,
    observed: Option<bool>,
    worker: Option<Worker>,
}

struct Shared {
    state: Mutex<State>,
    changed: Condvar,
    wake: Arc<Event>,
    bus: Arc<dyn MuteBus>,
    gate: Arc<dyn Gate>,
    store: Arc<dyn MuteStore>,
    on_muted: Option<Arc<dyn Fn(bool) + Send + Sync>>,
    on_retired: Option<Arc<dyn Fn() + Send + Sync>>,
    poll_interval: Duration,
}

impl Shared {
    fn set_muted(&self, muted: bool) {
        self.bus.set_muted(muted);
        if let Some(on_muted) = &self.on_muted {
            // Intent only; the VC owner handles delivery and health.
            on_muted(muted);
        }
    }
}

pub struct VoiceRoute {
    shared: Arc<Shared>,
}

pub struct RouteOptions {
    pub poll_interval: Duration,
    pub on_muted: Option<Arc<dyn Fn(bool) + Send + Sync>>,
    /// Told when a preparation retired the units of the route's old names
    /// ([`Gate::retired_legacy`]), on the route's worker.
    pub on_retired: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl Default for RouteOptions {
    fn default() -> Self {
        Self { poll_interval: Duration::from_millis(100), on_muted: None, on_retired: None }
    }
}

enum Step {
    Continue,
    Return,
}

impl VoiceRoute {
    pub fn new(bus: Arc<dyn MuteBus>, gate: Arc<dyn Gate>, store: Arc<dyn MuteStore>, options: RouteOptions) -> Self {
        let (desired, ready, error) = match store.read() {
            Ok(muted) => (muted, true, None),
            Err(_) => (true, false, Some("mute_state_unavailable".to_owned())),
        };
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                closed: false,
                managed: false,
                identity: None,
                direct_identity: None,
                suppress_direct: false,
                direct_observed: None,
                revision: 0,
                pending: false,
                error,
                ready,
                preparing: false,
                prepare_needed: false,
                prepare_after: 0.0,
                desired,
                observed: Some(desired),
                worker: None,
            }),
            changed: Condvar::new(),
            wake: Arc::new(Event::new()),
            bus,
            gate,
            store,
            on_muted: options.on_muted,
            on_retired: options.on_retired,
            poll_interval: options.poll_interval,
        });
        shared.set_muted(desired);
        Self { shared }
    }

    pub fn status(&self) -> RouteStatus {
        let state = lock(&self.shared.state);
        RouteStatus {
            managed: state.managed,
            requested_muted: state.desired,
            observed_muted: state.observed,
            ready: state.ready,
            pending: state.pending,
            error: state.error.clone(),
            preparing: state.preparing,
            generation: state.revision,
            closed: state.closed,
            requested_direct_suppressed: state.suppress_direct,
            observed_direct_suppressed: state.direct_observed,
            observation_id: next_observation_from(monotonic_ns()).to_string(),
        }
    }

    fn request_locked(&self, state: &mut State, muted: bool) -> Result<()> {
        if state.closed {
            return Err(Error::runtime("voice_route_closed"));
        }
        state.desired = muted;
        state.revision += 1;
        state.pending = true;
        state.error = None;
        // Even a resume keeps software closed until native and durable confirmation.
        self.shared.set_muted(true);
        if state.worker.is_none() {
            let shared = self.shared.clone();
            state.worker = Some(Worker::spawn("astarot-voice-gate", move || work(&shared)).map_err(|_| Error::runtime("voice_route_unavailable"))?);
        }
        self.shared.wake.set();
        Ok(())
    }

    pub fn mute(&self) -> Result<()> {
        let mut state = lock(&self.shared.state);
        self.request_locked(&mut state, true)
    }

    pub fn resume(&self) -> Result<()> {
        let mut state = lock(&self.shared.state);
        if !state.ready || state.pending {
            return Err(Error::runtime("voice_route_not_ready"));
        }
        self.request_locked(&mut state, false)
    }

    /// Enter or leave the managed route. Leaving waits up to `timeout` for a
    /// confirmed mute and keeps the managed configuration when there is none.
    pub fn configure(&self, managed: bool, timeout: Duration, suppress_direct: bool) -> Result<()> {
        let mut state = lock(&self.shared.state);
        if state.closed {
            return Err(Error::runtime("voice_route_closed"));
        }
        if state.managed == managed {
            if managed && state.suppress_direct != suppress_direct {
                state.suppress_direct = suppress_direct;
                state.ready = false;
                self.request_locked(&mut state, true)?;
            }
            return Ok(());
        }
        if managed {
            state.managed = true;
            state.prepare_needed = true;
            state.prepare_after = 0.0;
            state.identity = None;
            state.direct_identity = None;
            state.suppress_direct = suppress_direct;
            state.direct_observed = None;
            state.observed = None;
            state.ready = false;
            return self.request_locked(&mut state, true);
        }
        self.request_locked(&mut state, true)?;
        let deadline = monotonic() + timeout.as_secs_f64();
        while state.pending {
            let remaining = deadline - monotonic();
            if remaining <= 0.0 {
                break;
            }
            state = self.shared.changed.wait_timeout(state, Duration::from_secs_f64(remaining)).unwrap_or_else(|e| e.into_inner()).0;
        }
        if state.pending || state.error.is_some() || state.observed != Some(true) {
            return Err(Error::runtime("managed_mute_unconfirmed"));
        }
        state.managed = false;
        state.identity = None;
        state.direct_identity = None;
        state.direct_observed = None;
        state.suppress_direct = false;
        state.revision += 1;
        self.shared.wake.set();
        Ok(())
    }

    /// Mute, refuse further requests, and report whether shutdown was confirmed
    /// within `timeout`: the worker ended, nothing pending, and (when managed) the OS
    /// confirmed the mute.
    pub fn close(&self, timeout: Duration) -> bool {
        let worker = {
            let mut state = lock(&self.shared.state);
            if !state.closed {
                if state.managed {
                    let _ = self.request_locked(&mut state, true);
                }
                state.closed = true; // Reject new requests, but drain the final mute.
                state.revision += 1;
                self.shared.set_muted(true);
                self.shared.wake.set();
            }
            state.worker.clone()
        };
        let stopped = worker.as_ref().is_none_or(|worker| worker.join(timeout));
        let state = lock(&self.shared.state);
        stopped && !state.pending && state.error.is_none() && (!state.managed || state.observed == Some(true))
    }

    /// Whether the worker thread is running.
    pub fn is_working(&self) -> bool {
        lock(&self.shared.state).worker.as_ref().is_some_and(Worker::is_alive)
    }
}

fn work(shared: &Arc<Shared>) {
    loop {
        shared.wake.wait(shared.poll_interval);
        shared.wake.clear();
        if let Step::Return = round(shared) {
            break;
        }
    }
    shared.gate.close_observer();
}

fn round(shared: &Arc<Shared>) -> Step {
    let (managed, desired, revision, identity, direct_identity, suppress_direct, pending) = {
        let state = lock(&shared.state);
        if state.closed && !state.pending {
            return Step::Return;
        }
        (state.managed, state.desired, state.revision, state.identity, state.direct_identity, state.suppress_direct, state.pending)
    };
    let mut local = Local { desired, revision, identity, direct_observed: None };
    match attempt(shared, managed, pending, direct_identity, suppress_direct, &mut local) {
        Ok(step) => step,
        Err(error) => recover(shared, managed, &local, &error),
    }
}

struct Local {
    desired: bool,
    revision: u64,
    identity: Option<(u64, u64)>,
    direct_observed: Option<bool>,
}

fn attempt(shared: &Arc<Shared>, managed: bool, pending: bool, direct_identity: Option<(u64, u64)>, suppress_direct: bool, local: &mut Local) -> Result<Step> {
    shared.gate.observe(managed, &shared.wake)?;
    if !managed && !pending {
        return Ok(Step::Continue);
    }
    let observed;
    if managed {
        let prepare = {
            let mut state = lock(&shared.state);
            let prepare = state.prepare_needed && !state.closed;
            if prepare && monotonic() < state.prepare_after {
                return Ok(Step::Continue);
            }
            state.preparing = prepare;
            prepare
        };
        if prepare {
            let prepared = shared.gate.prepare();
            if shared.gate.retired_legacy()
                && let Some(on_retired) = &shared.on_retired
            {
                on_retired();
            }
            let mut state = lock(&shared.state);
            if prepared.is_ok() {
                state.prepare_needed = false;
            }
            state.preparing = false;
            state.prepare_after = monotonic() + 2.0;
            prepared?;
        }
        let pair = shared.gate.inspect_pair()?;
        let (mut source, mut direct) = (pair.source, pair.direct);
        if local.identity != Some(source.identity) || direct_identity != Some(direct.identity) || direct.muted != suppress_direct || (!pending && source.muted != local.desired) {
            // First attach, reconnection or an external change revokes any resume.
            let mut state = lock(&shared.state);
            if local.revision != state.revision {
                return Ok(Step::Continue);
            }
            state.desired = true;
            local.desired = true;
            shared.set_muted(true);
            state.identity = Some(source.identity);
            local.identity = Some(source.identity);
            state.direct_identity = Some(direct.identity);
            state.revision += 1;
            local.revision = state.revision;
            state.pending = true;
        }
        // Close the shared source before changing the direct branch.
        if local.desired && !source.muted {
            source = shared.gate.set_muted(true, source.identity)?;
        }
        if direct.muted != suppress_direct {
            direct = shared.gate.set_direct_muted(suppress_direct, direct.identity)?;
        }
        local.direct_observed = Some(direct.muted);
        if direct.muted != suppress_direct {
            return Err(Error::runtime("direct_gate_change_unconfirmed"));
        }
        if source.muted != local.desired {
            if local.desired {
                source = shared.gate.set_muted(true, source.identity)?;
            } else {
                let pair = shared.gate.resume(source.identity, direct.identity, suppress_direct)?;
                source = pair.source;
                local.direct_observed = Some(pair.direct.muted);
            }
        }
        observed = source.muted;
        if observed != local.desired {
            return Err(Error::runtime("gate_change_unconfirmed"));
        }
    } else {
        observed = local.desired;
    }
    // No settings write is mistaken for the durable latch.
    let persist = {
        let state = lock(&shared.state);
        if local.revision != state.revision {
            shared.wake.set();
            return Ok(Step::Continue);
        }
        state.pending
    };
    if persist {
        shared.store.write(local.desired).map_err(|_| Error::value("mute_state_unavailable"))?;
    }
    let mut state = lock(&shared.state);
    if local.revision != state.revision {
        shared.wake.set();
        return Ok(Step::Continue);
    }
    state.observed = Some(observed);
    state.direct_observed = local.direct_observed;
    state.ready = true;
    state.pending = false;
    state.error = None;
    shared.set_muted(if state.closed { true } else { local.desired });
    shared.changed.notify_all();
    Ok(if state.closed { Step::Return } else { Step::Continue })
}

fn recover(shared: &Arc<Shared>, managed: bool, local: &Local, error: &Error) -> Step {
    // Inspection or control can fail while the shared source is open. Mute the last
    // bound identity; never infer silence from an unconfirmed change, and never
    // retarget a replacement by name.
    let observed = match (managed, local.identity) {
        (true, Some(identity)) => shared.gate.set_muted(true, identity).ok().map(|s| s.muted),
        _ => None,
    };
    let mut state = lock(&shared.state);
    if state.closed && local.revision != state.revision {
        // A stale resume may have applied before its confirmation failed; the final
        // mute still has to run.
        shared.wake.set();
        return Step::Continue;
    }
    // A failed resume never stays authorised for an automatic retry.
    state.desired = true;
    shared.set_muted(true);
    state.revision += 1;
    state.observed = observed;
    state.direct_observed = local.direct_observed;
    state.ready = false;
    state.pending = true;
    if error.is("managed_endpoint_missing_or_invalid") {
        state.prepare_needed = true;
    }
    state.error = Some(if error.kind == Kind::Runtime { error.code.clone() } else { "mute_state_unavailable".to_owned() });
    shared.changed.notify_all();
    // A stopped worker is not confirmed silence: pending and the error stay.
    if state.closed {
        Step::Return
    } else {
        Step::Continue
    }
}

#[cfg(test)]
mod tests;
