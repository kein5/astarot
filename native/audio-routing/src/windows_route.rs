//! Windows direct voice: a chosen output device stands in for the managed sink.
//!
//! Port of `src-python/models/audio_routing/windows_route.py`. Windows has no
//! private virtual microphone to create, so the user's cable is the route: voice is
//! written to its playback end and VRChat records from the other. No OS gate sits
//! behind that device, so mute is applied here by writing silence, which keeps the
//! stream and its timing alive.
//!
//! The device access is behind [`RouteDevices`], so the queueing, stall and mute
//! rules are the same, and tested, on every platform.

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use crate::error::{Error, Kind, Result};
use crate::graph::{Endpoint, SourceId};
use crate::naming::same_virtual_cable;
use crate::report::Reporter;
use crate::router::{CancelToken, Output, PlaybackToken};
use crate::sync::{lock, monotonic, monotonic_ns, Worker};

pub const RATE: u32 = 48000;
/// A device that took nothing for this long is gone, not slow: a write to an
/// unplugged device may never return, so no error would come from the stream.
pub const OUTPUT_STALL_S: f64 = 2.0;
/// Loading the conversion took 53 s on a warm cache; a real-time scan adds more.
pub const READY_TIMEOUT_S: u64 = 180;
pub const INPUT_BLOCKS: usize = 4;
const OUTPUT_QUEUE: usize = 4;
const BRIDGE_QUEUE: usize = 8;

/// A running capture.
pub trait Capture: Send {
    fn start(&mut self) -> Result<()>;
    /// Ask to stop without waiting (safe from any thread).
    fn request_stop(&self);
    fn stop(&mut self);
    /// After [`Capture::stop`]: whether the device was confirmed released.
    fn released(&self) -> bool {
        true
    }
}

/// What a capture reports. `on_audio` returns `false` to end the capture.
pub struct CaptureCallbacks {
    pub on_audio: Box<dyn FnMut(&[u8]) -> bool + Send>,
    pub on_error: Box<dyn FnMut(&str) + Send>,
}

/// The device access of the Windows route.
pub trait RouteDevices: Send + Sync {
    /// Output identities, keeping `keep` listed while it exists.
    fn outputs(&self, keep: &[String]) -> Result<Vec<String>>;
    /// The output at 48 kHz mono, tolerating underflow.
    fn open_output(&self, device: &str) -> Result<Box<dyn Output>>;
    fn capture(&self, source: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture>;
}

/// WASAPI devices.
#[cfg(windows)]
pub struct WasapiDevices;

#[cfg(windows)]
impl RouteDevices for WasapiDevices {
    fn outputs(&self, keep: &[String]) -> Result<Vec<String>> {
        Ok(crate::wasapi::output::enumerate_outputs(keep)?.into_iter().map(|o| o.id).collect())
    }
    fn open_output(&self, device: &str) -> Result<Box<dyn Output>> {
        Ok(Box::new(crate::wasapi::output::WindowsOutput::open(device, RATE, 1, false)?))
    }
    fn capture(&self, source: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture> {
        Box::new(crate::wasapi::capture::WasapiCapture::new(&source.name, callbacks))
    }
}

type Clock = Arc<dyn Fn() -> f64 + Send + Sync>;

fn check_devices(devices: &dyn RouteDevices, source: &Endpoint, output: &str) -> Result<()> {
    if !devices.outputs(&[output.to_owned()])?.iter().any(|id| id == output) {
        return Err(Error::runtime("vc_output_missing"));
    }
    if same_virtual_cable(&source.name, output) {
        return Err(Error::runtime("vc_feedback_blocked"));
    }
    Ok(())
}

/// A bounded queue that, when full, replaces its oldest item: speech that old is
/// worth less than speech on time.
struct Bounded<T> {
    items: Mutex<VecDeque<T>>,
    changed: Condvar,
    capacity: usize,
}

impl<T> Bounded<T> {
    fn new(capacity: usize) -> Self {
        Self { items: Mutex::new(VecDeque::new()), changed: Condvar::new(), capacity }
    }

    /// `false` when full.
    fn try_push(&self, item: T) -> std::result::Result<(), T> {
        let mut items = lock(&self.items);
        if items.len() >= self.capacity {
            return Err(item);
        }
        items.push_back(item);
        self.changed.notify_all();
        Ok(())
    }

    fn replace_oldest(&self, item: T) {
        let mut items = lock(&self.items);
        if items.pop_front().is_some() {
            items.push_back(item);
            self.changed.notify_all();
        }
    }

    /// Put `item` in, dropping old items to make room.
    fn force(&self, item: T) {
        let mut items = lock(&self.items);
        while items.len() >= self.capacity {
            items.pop_front();
        }
        items.push_back(item);
        self.changed.notify_all();
    }

    fn pop(&self, timeout: Option<Duration>) -> Option<T> {
        let mut items = lock(&self.items);
        loop {
            if let Some(item) = items.pop_front() {
                return Some(item);
            }
            match timeout {
                None => items = self.changed.wait(items).unwrap_or_else(|e| e.into_inner()),
                Some(timeout) => {
                    let (next, result) = self.changed.wait_timeout(items, timeout).unwrap_or_else(|e| e.into_inner());
                    items = next;
                    if result.timed_out() {
                        return items.pop_front();
                    }
                }
            }
        }
    }

    fn len(&self) -> usize {
        lock(&self.items).len()
    }
}

struct QueueState {
    queue: Bounded<Option<Vec<u8>>>,
    token: CancelToken,
    failed: std::sync::atomic::AtomicBool,
    written: Mutex<f64>,
    output: Mutex<Option<Box<dyn Output>>>,
}

/// Device writes on their own thread.
///
/// A device write blocks for about the length of the audio, so writing inside the
/// conversion loop adds a block's duration to every block and overruns capture. The
/// queue also absorbs a late block; when it is full the oldest block goes.
pub struct QueuedOutput {
    state: Arc<QueueState>,
    worker: Worker,
    clock: Clock,
}

impl QueuedOutput {
    pub fn open(devices: &dyn RouteDevices, device: &str) -> Result<Self> {
        Self::with(devices.open_output(device)?, Arc::new(monotonic))
    }

    pub fn with(output: Box<dyn Output>, clock: Clock) -> Result<Self> {
        let state = Arc::new(QueueState {
            queue: Bounded::new(OUTPUT_QUEUE),
            token: CancelToken::default(),
            failed: std::sync::atomic::AtomicBool::new(false),
            written: Mutex::new(clock()),
            output: Mutex::new(Some(output)),
        });
        let (worker_state, worker_clock) = (state.clone(), clock.clone());
        let worker = Worker::spawn("vrct-vc-output", move || {
            // The device is taken out for writing so that a stuck write holds nothing
            // the closing thread needs.
            let Some(mut output) = lock(&worker_state.output).take() else { return };
            while let Some(Some(pcm)) = worker_state.queue.pop(None) {
                if output.write(&pcm, &worker_state.token).is_err() {
                    worker_state.failed.store(true, std::sync::atomic::Ordering::SeqCst);
                    break;
                }
                *lock(&worker_state.written) = worker_clock();
            }
            *lock(&worker_state.output) = Some(output);
        })
        .map_err(|_| Error::speech("vc_output_failed"))?;
        Ok(Self { state, worker, clock })
    }

    pub fn is_failed(&self) -> bool {
        self.state.failed.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn queued(&self) -> usize {
        self.state.queue.len()
    }
}

impl Output for QueuedOutput {
    fn write(&mut self, pcm: &[u8], token: &dyn PlaybackToken) -> Result<()> {
        token.check()?;
        if self.is_failed() {
            return Err(Error::speech("vc_output_failed"));
        }
        if let Err(item) = self.state.queue.try_push(Some(pcm.to_vec())) {
            if (self.clock)() - *lock(&self.state.written) > OUTPUT_STALL_S {
                return Err(Error::speech("vc_output_failed"));
            }
            self.state.queue.replace_oldest(item);
        }
        Ok(())
    }

    fn close(&mut self, drain: bool, token: &dyn PlaybackToken) -> Result<()> {
        self.state.token.cancel();
        self.state.queue.force(None);
        // A write stuck in the driver would hang this close; leave it alone.
        if !self.worker.join(Duration::from_secs(1)) {
            return Ok(());
        }
        match lock(&self.state.output).as_mut() {
            Some(output) => output.close(drain, token),
            None => Ok(()),
        }
    }
}

/// The capture and output of a converted voice, in place of the PipeWire graph.
pub struct WindowsRoute {
    pub device: String,
    devices: Arc<dyn RouteDevices>,
}

impl WindowsRoute {
    pub const GATES_OUTPUT: bool = true;
    pub const DROPS_LATE_BLOCKS: bool = true;

    pub fn new(output: &str, devices: Arc<dyn RouteDevices>) -> Self {
        Self { device: output.to_owned(), devices }
    }

    /// Check the pair before a run. Enumerating is too slow for every audio block; a
    /// device lost later surfaces as an error from its own stream.
    pub fn bind(&self, source: &Endpoint, wait: bool) -> Result<Endpoint> {
        if wait {
            check_devices(self.devices.as_ref(), source, &self.device)?;
        }
        Ok(Endpoint { cookie: 0, serial: 0, name: self.device.clone(), media_class: "Audio/Sink".to_owned() })
    }

    pub fn output(&self, sink: &Endpoint) -> Result<QueuedOutput> {
        QueuedOutput::open(self.devices.as_ref(), &sink.name)
    }

    pub fn capture(&self, source: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture> {
        self.devices.capture(source, callbacks)
    }
}

/// The bridge's state as `health()` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeHealth {
    pub requested: bool,
    pub active: bool,
    pub pending: bool,
    pub error: Option<String>,
    pub generation: u64,
    pub conversion_verified: bool,
    pub source: Option<SourceId>,
    pub stopping: bool,
    /// Text, so that nanosecond order survives JavaScript numbers.
    pub observation_id: String,
}

struct BridgeState {
    worker: Option<Worker>,
    capture: Option<Arc<Mutex<Box<dyn Capture>>>>,
    source: Option<Endpoint>,
    requested: bool,
    active: bool,
    pending: bool,
    muted: bool,
    error: Option<String>,
    observation: u64,
}

struct BridgeShared {
    state: Mutex<BridgeState>,
    queue: Bounded<Vec<u8>>,
    token: CancelToken,
    written: Mutex<f64>,
    clock: Mutex<Clock>,
    devices: Arc<dyn RouteDevices>,
    reporter: Arc<dyn Reporter>,
    device: String,
}

/// The original microphone to the output device, for when no conversion runs.
pub struct WindowsBridge {
    shared: Arc<BridgeShared>,
}

impl WindowsBridge {
    pub fn new(output: &str, devices: Arc<dyn RouteDevices>, reporter: Arc<dyn Reporter>) -> Self {
        let clock: Clock = Arc::new(monotonic);
        Self {
            shared: Arc::new(BridgeShared {
                state: Mutex::new(BridgeState { worker: None, capture: None, source: None, requested: false, active: false, pending: false, muted: true, error: None, observation: 0 }),
                queue: Bounded::new(BRIDGE_QUEUE),
                token: CancelToken::default(),
                written: Mutex::new(clock()),
                clock: Mutex::new(clock),
                devices,
                reporter,
                device: output.to_owned(),
            }),
        }
    }

    /// Replace the clock (tests).
    pub fn set_clock(&self, clock: Clock) {
        *lock(&self.shared.clock) = clock;
    }

    pub fn set_monitor_muted(&self, muted: bool) {
        lock(&self.shared.state).muted = muted;
    }

    pub fn health(&self) -> BridgeHealth {
        let mut state = lock(&self.shared.state);
        state.observation = monotonic_ns().max(state.observation + 1);
        BridgeHealth {
            requested: state.requested,
            active: state.active,
            pending: state.pending,
            error: state.error.clone(),
            generation: 0,
            conversion_verified: false,
            source: state.source.as_ref().map(SourceId::from),
            stopping: state.worker.as_ref().is_some_and(Worker::is_alive) && !state.requested,
            observation_id: state.observation.to_string(),
        }
    }

    pub fn start(&self, source: Endpoint) -> Result<()> {
        let mut state = lock(&self.shared.state);
        if state.worker.is_some() || self.shared.token.is_set() {
            return Err(Error::runtime("source_bridge_stopping"));
        }
        state.source = Some(source.clone());
        state.requested = true;
        state.pending = true;
        let shared = self.shared.clone();
        let worker = Worker::spawn("vrct-windows-bridge", move || run(&shared, &source)).map_err(|_| Error::runtime("source_bridge_output_failed"))?;
        state.worker = Some(worker);
        Ok(())
    }

    pub fn stop(&self) {
        stop(&self.shared);
    }

    /// Stop and report whether the bridge thread ended within `timeout`.
    pub fn close(&self, timeout: Duration) -> bool {
        self.stop();
        let worker = lock(&self.shared.state).worker.clone();
        worker.is_none_or(|worker| worker.join(timeout))
    }

    /// The capture callback: queue one block. `false` ends the capture.
    pub fn offer_audio(&self, pcm: &[u8]) -> bool {
        offer(&self.shared, pcm)
    }

    pub fn queued(&self) -> Vec<Vec<u8>> {
        lock(&self.shared.queue.items).iter().cloned().collect()
    }
}

fn stop(shared: &BridgeShared) {
    let capture = {
        let mut state = lock(&shared.state);
        state.requested = false;
        state.active = false;
        shared.token.cancel();
        state.capture.clone()
    };
    if let Some(capture) = capture {
        if let Ok(capture) = capture.try_lock() {
            capture.request_stop();
        }
    }
}

fn fail(shared: &BridgeShared, code: &str) {
    let failed = {
        let mut state = lock(&shared.state);
        if shared.token.is_set() {
            false
        } else {
            state.error = Some(code.to_owned());
            state.requested = false;
            state.active = false;
            true
        }
    };
    stop(shared);
    if failed {
        shared.reporter.report_failure("voice_conversion", code);
    }
}

fn offer(shared: &BridgeShared, pcm: &[u8]) -> bool {
    if let Err(pcm) = shared.queue.try_push(pcm.to_vec()) {
        let now = (lock(&shared.clock))();
        if now - *lock(&shared.written) > OUTPUT_STALL_S {
            fail(shared, "source_bridge_output_failed");
            return false;
        }
        // A busy PC can hold the bridge up: lose a little audio and carry on.
        shared.queue.replace_oldest(pcm);
    }
    true
}

fn run(shared: &Arc<BridgeShared>, source: &Endpoint) {
    let mut output: Option<Box<dyn Output>> = None;
    let mut capture: Option<Arc<Mutex<Box<dyn Capture>>>> = None;
    let result = (|| -> Result<()> {
        check_devices(shared.devices.as_ref(), source, &shared.device)?;
        output = Some(shared.devices.open_output(&shared.device)?);
        let (audio, errors) = (Arc::downgrade(shared), Arc::downgrade(shared));
        let callbacks = CaptureCallbacks {
            on_audio: Box::new(move |pcm| audio.upgrade().is_some_and(|shared| offer(&shared, pcm))),
            on_error: Box::new(move |_| {
                if let Some(shared) = errors.upgrade() {
                    fail(&shared, "source_bridge_capture_failed");
                }
            }),
        };
        let started = Arc::new(Mutex::new(shared.devices.capture(source, callbacks)));
        capture = Some(started.clone());
        lock(&shared.state).capture = Some(started.clone());
        shared.token.check()?;
        lock(&started).start()?;
        {
            let mut state = lock(&shared.state);
            shared.token.check()?;
            state.active = true;
            state.pending = false;
        }
        *lock(&shared.written) = (lock(&shared.clock))();
        loop {
            shared.token.check()?;
            let Some(pcm) = shared.queue.pop(Some(Duration::from_millis(50))) else { continue };
            let muted = lock(&shared.state).muted;
            let block = if muted { vec![0; pcm.len()] } else { pcm };
            if let Some(output) = output.as_mut() {
                output.write(&block, &shared.token)?;
            }
            *lock(&shared.written) = (lock(&shared.clock))();
        }
    })();
    if let Err(error) = result {
        let code = if error.kind == Kind::Runtime && (error.code.starts_with("vc_") || error.code.starts_with("source_bridge_")) { error.code } else { "source_bridge_output_failed".to_owned() };
        fail(shared, &code);
    }
    stop(shared);
    if let Some(capture) = capture {
        lock(&capture).stop();
    }
    if let Some(mut output) = output {
        let _ = output.close(false, &shared.token);
    }
    lock(&shared.state).pending = false;
}

#[cfg(test)]
mod tests;
