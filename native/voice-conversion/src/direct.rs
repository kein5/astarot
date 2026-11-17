//! One direct producer at a time, independently of ASR, TTS and global mute
//! (`direct_voice.py`).
//!
//! Start, stop and health never block: slow work belongs to a backend's own thread, and
//! `close` reaps it. Endpoint connectivity is never taken as proof of conversion.

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::Value;
use vrct_audio_routing::graph::{Endpoint, SourceId};
use vrct_audio_routing::monitor::MonitorSpec;
use vrct_audio_routing::sync::monotonic_ns;
use vrct_audio_routing::windows_route::WindowsBridge;

use crate::process::{Health, SpeakFailure, VcProcess};

/// A started direct producer: the microphone passed through, or converted.
pub trait DirectBackend: Send + Sync {
    fn start(&self, source: Endpoint) -> Result<(), String>;
    fn stop(&self);
    fn close(&self, timeout: Duration) -> bool;
    fn health(&self) -> Health;
    fn set_monitor_muted(&self, muted: bool);
    fn set_direct_suppressed(&self, _suppressed: bool) {}
    fn speaking_available(&self) -> bool {
        false
    }
    fn speak(
        &self,
        _chunks: &mut dyn Iterator<Item = Result<Vec<u8>, String>>,
        _check: &dyn Fn() -> Result<(), String>,
        _first: &mut dyn FnMut(i64, u32) -> Result<(), String>,
    ) -> Result<(), SpeakFailure> {
        Err(SpeakFailure::Unavailable)
    }
}

impl DirectBackend for VcProcess {
    fn start(&self, source: Endpoint) -> Result<(), String> {
        VcProcess::start(self, source)
    }
    fn stop(&self) {
        VcProcess::stop(self)
    }
    fn close(&self, timeout: Duration) -> bool {
        VcProcess::close(self, timeout)
    }
    fn health(&self) -> Health {
        VcProcess::health(self)
    }
    fn set_monitor_muted(&self, muted: bool) {
        VcProcess::set_monitor_muted(self, muted)
    }
    fn set_direct_suppressed(&self, suppressed: bool) {
        VcProcess::set_direct_suppressed(self, suppressed)
    }
    fn speaking_available(&self) -> bool {
        VcProcess::speaking_available(self)
    }
    fn speak(
        &self,
        chunks: &mut dyn Iterator<Item = Result<Vec<u8>, String>>,
        check: &dyn Fn() -> Result<(), String>,
        first: &mut dyn FnMut(i64, u32) -> Result<(), String>,
    ) -> Result<(), SpeakFailure> {
        VcProcess::speak(self, chunks, check, first)
    }
}

impl DirectBackend for WindowsBridge {
    fn start(&self, source: Endpoint) -> Result<(), String> {
        WindowsBridge::start(self, source).map_err(|e| e.code)
    }
    fn stop(&self) {
        WindowsBridge::stop(self)
    }
    fn close(&self, timeout: Duration) -> bool {
        WindowsBridge::close(self, timeout)
    }
    fn health(&self) -> Health {
        let health = WindowsBridge::health(self);
        Health { requested: health.requested, active: health.active, pending: health.pending, stopping: health.stopping, error: health.error, ..Health::default() }
    }
    fn set_monitor_muted(&self, muted: bool) {
        WindowsBridge::set_monitor_muted(self, muted)
    }
}

/// Makes the passthrough backend: `Some(device)` writes to a device (Windows), `None` uses
/// the managed route (Linux).
pub type PassthroughFactory = Arc<dyn Fn(Option<&str>) -> Result<Box<dyn DirectBackend>, String> + Send + Sync>;

/// Makes the converted backend from its start options, its monitor and its output device.
/// An error is a refused start (`vc_start_failed`).
pub type ConvertedFactory = Arc<dyn Fn(&Value, Option<MonitorSpec>, Option<&str>) -> Result<Box<dyn DirectBackend>, String> + Send + Sync>;

/// What `health()` returns (`DirectVoice.health`).
#[derive(Debug, Clone, PartialEq)]
pub struct DirectHealth {
    pub requested: bool,
    pub active: bool,
    pub pending: bool,
    pub stopping: bool,
    pub mode: String,
    pub source: Option<SourceId>,
    pub generation: u64,
    pub observation_id: String,
    pub error: Option<String>,
    pub conversion_state: Option<String>,
    pub conversion_verified: bool,
    pub monitor_error: Option<String>,
    pub round_trip_ms: Option<i64>,
    pub conversion_device: Option<String>,
    pub conversion_latency_ms: Option<i64>,
}

impl DirectHealth {
    /// The fields in Python's order.
    pub fn to_json(&self) -> serde_json::Map<String, Value> {
        let value = serde_json::json!({
            "requested": self.requested,
            "active": self.active,
            "pending": self.pending,
            "stopping": self.stopping,
            "mode": self.mode,
            "source": self.source.as_ref().map(SourceId::to_json),
            "generation": self.generation,
            "observation_id": self.observation_id,
            "error": self.error,
            "conversion_state": self.conversion_state,
            "conversion_verified": self.conversion_verified,
            "monitor_error": self.monitor_error,
            "round_trip_ms": self.round_trip_ms,
            "conversion_device": self.conversion_device,
            "conversion_latency_ms": self.conversion_latency_ms,
        });
        match value {
            Value::Object(map) => map,
            _ => unreachable!(),
        }
    }
}

struct State {
    backend: Option<Arc<dyn DirectBackend>>,
    source: Option<Endpoint>,
    mode: String,
    options: Value,
    generation: u64,
    observation: u64,
    requested: bool,
    closed: bool,
    error: Option<String>,
    monitor_muted: bool,
    monitor_enabled: bool,
    suppressed: bool,
    direct_suppressed: bool,
}

pub struct DirectVoice {
    passthrough: PassthroughFactory,
    converted: Option<ConvertedFactory>,
    state: Mutex<State>,
}

impl DirectVoice {
    pub fn new(passthrough: PassthroughFactory, converted: Option<ConvertedFactory>) -> Self {
        Self {
            passthrough,
            converted,
            state: Mutex::new(State {
                backend: None,
                source: None,
                mode: "off".into(),
                options: Value::Object(Default::default()),
                generation: 0,
                observation: 0,
                requested: false,
                closed: false,
                error: None,
                monitor_muted: true,
                monitor_enabled: false,
                suppressed: false,
                direct_suppressed: false,
            }),
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn send_mute(state: &State) {
        if state.requested
            && state.monitor_enabled
            && let Some(backend) = &state.backend
        {
            backend.set_monitor_muted(state.monitor_muted || state.suppressed);
        }
    }

    /// Speech through the conversion (ADR-007): silence the microphone's blocks only.
    pub fn set_direct_suppressed(&self, suppressed: bool) {
        let mut state = self.state();
        state.direct_suppressed = suppressed;
        if state.requested
            && let Some(backend) = &state.backend
        {
            backend.set_direct_suppressed(suppressed);
        }
    }

    /// Latch the route's mute intent, also before a start; never toggles a producer.
    pub fn set_monitor_muted(&self, muted: bool) {
        let mut state = self.state();
        state.monitor_muted = muted;
        Self::send_mute(&state);
    }

    /// Device route: translated speech replaces the voice (an OS gate does this on Linux).
    pub fn set_suppressed(&self, suppressed: bool) {
        let mut state = self.state();
        state.suppressed = suppressed;
        Self::send_mute(&state);
    }

    fn converting(state: &State) -> Option<Arc<dyn DirectBackend>> {
        let backend = state.backend.as_ref().filter(|_| state.requested && state.mode == "converted")?;
        backend.speaking_available().then(|| backend.clone())
    }

    /// True while a conversion runs that speech can be sent through.
    pub fn speaking_available(&self) -> bool {
        Self::converting(&self.state()).is_some()
    }

    /// Convert speech (48 kHz mono s16le) in place of the microphone while it lasts.
    pub fn speak(
        &self,
        chunks: &mut dyn Iterator<Item = Result<Vec<u8>, String>>,
        check: &dyn Fn() -> Result<(), String>,
        first: &mut dyn FnMut(i64, u32) -> Result<(), String>,
    ) -> Result<(), SpeakFailure> {
        let backend = Self::converting(&self.state()).ok_or(SpeakFailure::Unavailable)?;
        backend.speak(chunks, check, first)
    }

    /// Start a producer. `monitor` applies to converted output only; `output` names the device
    /// to write to when no managed route exists (then mute is this owner's job).
    pub fn start(&self, source: Endpoint, expected_generation: u64, mode: &str, options: Value, monitor: Option<MonitorSpec>, output: Option<&str>) -> Result<(), String> {
        let mut state = self.state();
        if state.closed {
            return Err("source_bridge_closed".into());
        }
        if expected_generation != state.generation {
            return Err("source_bridge_stale_start".into());
        }
        if state.requested {
            if state.source.as_ref() == Some(&source) && state.mode == mode && state.options == options {
                return Ok(());
            }
            return Err("vc_stop_required".into());
        }
        if mode == "converted" && self.converted.is_none() {
            return Err("vc_engine_unavailable".into());
        }
        if let Some(backend) = state.backend.take()
            && !backend.close(Duration::ZERO)
        {
            state.backend = Some(backend);
            return Err("source_bridge_stopping".into());
        }
        state.generation += 1;
        state.source = Some(source.clone());
        state.mode = mode.to_owned();
        state.options = options.clone();
        state.monitor_enabled = output.is_some() || (mode == "converted" && monitor.is_some());
        state.error = None;
        let made = if mode == "passthrough" { (self.passthrough)(output) } else { (self.converted.as_ref().expect("checked above"))(&options, monitor, output) };
        let backend: Arc<dyn DirectBackend> = match made {
            Ok(backend) => Arc::from(backend),
            Err(_) => {
                state.requested = false;
                state.error = Some("vc_start_failed".into());
                return Err("vc_start_failed".into());
            }
        };
        state.backend = Some(backend.clone());
        state.requested = true;
        Self::send_mute(&state);
        backend.set_direct_suppressed(state.direct_suppressed);
        if backend.start(source).is_err() {
            state.requested = false;
            state.error = Some("vc_start_failed".into());
            backend.stop();
            return Err("vc_start_failed".into());
        }
        Ok(())
    }

    fn stop_locked(state: &mut State) {
        state.requested = false;
        state.generation += 1;
        if let Some(backend) = &state.backend {
            backend.stop();
        }
    }

    pub fn stop(&self) {
        Self::stop_locked(&mut self.state());
    }

    /// Refuse further starts, stop and wait up to `timeout`.
    pub fn close(&self, timeout: Duration) -> bool {
        let backend = {
            let mut state = self.state();
            state.closed = true;
            Self::stop_locked(&mut state);
            state.backend.clone()
        };
        backend.is_none_or(|backend| backend.close(timeout))
    }

    pub fn health(&self) -> DirectHealth {
        let mut state = self.state();
        let mut backend_health = state.backend.as_ref().map(|b| b.health()).unwrap_or_default();
        if state.requested && (!backend_health.requested || backend_health.error.is_some()) {
            state.error = backend_health.error.clone();
            Self::stop_locked(&mut state);
            backend_health = state.backend.as_ref().map(|b| b.health()).unwrap_or_default();
        }
        state.observation = (monotonic_ns()).max(state.observation + 1);
        let converted = state.requested && state.mode == "converted";
        DirectHealth {
            requested: state.requested,
            active: state.requested && backend_health.active,
            pending: backend_health.pending || backend_health.stopping,
            stopping: backend_health.stopping,
            mode: if state.requested { state.mode.clone() } else { "off".into() },
            source: state.source.as_ref().map(SourceId::from),
            generation: state.generation,
            observation_id: state.observation.to_string(),
            error: state.error.clone().or(backend_health.error),
            conversion_state: converted.then(|| backend_health.state.clone()).filter(|s| !s.is_empty()),
            conversion_verified: converted && backend_health.conversion_verified,
            monitor_error: if converted { backend_health.monitor_error } else { None },
            round_trip_ms: if converted { backend_health.round_trip_ms } else { None },
            conversion_device: if converted { backend_health.device } else { None },
            conversion_latency_ms: if converted { backend_health.latency_ms } else { None },
        }
    }
}
