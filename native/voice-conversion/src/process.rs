//! One conversion session: the worker's owner (`process.py`, `rvc_process.py`, `isolated.py`).
//!
//! The microphone is captured in blocks of the session's length (`block_ms` of the start, 40 ms
//! unless chosen; Python's were 80 ms), each block goes to the worker, and only its checked,
//! fresh answer reaches the output. No original-audio fallback exists. Capture never waits for
//! the worker.
//!
//! Python ran this in a router process of its own, to keep its garbage collector and global
//! lock away from the app. Here it runs on a thread of the app; the worker is still a process.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use vrct_audio_routing::graph::Endpoint;
use vrct_audio_routing::managed_vc::{self, ManagedVcDevices};
use vrct_audio_routing::monitor::{MonitorFactory, MonitorOptions, MonitorSpec, MonitorTee};
use vrct_audio_routing::router::{CancelToken, Output, PlaybackToken};
use vrct_audio_routing::sync::monotonic_ns;
use vrct_audio_routing::windows_route::{Capture, CaptureCallbacks, RouteDevices, WindowsRoute};

use crate::protocol::{self as p, ProtocolError};
use crate::worker::{arguments, rate_text, runtime_complete, RvcOptions, WorkerPipe, DEFAULT_BLOCK_MS, DEVICES, MAX_THREADS};

/// Device route: a block older than this is dropped instead of sent. More than half of the
/// blocks of the last six seconds late means the PC cannot keep up, and the voice stops.
pub const LATE_NS: i64 = 240_000_000;
const LATE_WINDOW_NS: i64 = 6_000_000_000;
/// 20 ms parts of the microphone at 48 kHz mono s16le; a block is a whole number of them.
pub const PART: usize = 1920;
const PART_NS: i64 = 20_000_000;
/// Speech through the conversion (ADR-007): what may wait to replace the microphone (2 s).
const SPEECH_LIMIT: usize = 2 * p::RATE as usize * 2;
/// 80 ms of speech per send, at most this far ahead of real time, waited out by about two
/// conversion blocks.
const SPEECH_FRAME: usize = 7680;

/// The blocks of the last six seconds: what the lateness and the round trips are judged on.
pub fn late_window(block: p::Block) -> usize {
    (LATE_WINDOW_NS / block.ns()) as usize
}
const SPEECH_LEAD_NS: i64 = 400_000_000;
const SPEECH_TAIL_NS: i64 = 250_000_000;

/// Where a conversion captures and plays.
pub trait VcRoute: Send + Sync {
    /// Mute is applied here by writing silence (no OS gate behind the output).
    fn gates_output(&self) -> bool;
    fn drops_late_blocks(&self) -> bool;
    fn ready_timeout(&self) -> Duration;
    fn input_blocks(&self) -> usize;
    /// The output for `source`; `wait` checks the devices (slow), otherwise the binding only.
    fn bind(&self, source: &Endpoint, wait: bool) -> Result<Endpoint, String>;
    fn output(&self, sink: &Endpoint) -> Result<Box<dyn Output>, String>;
    fn capture(&self, source: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture>;
    /// How the converted voice's monitor opens its device.
    fn monitor_factory(&self) -> MonitorFactory;
    /// How old a block may be when its answer is written.
    fn max_age_ns(&self) -> i64 {
        p::MANAGED_MAX_AGE_NS
    }
}

/// A chosen output device in place of the managed sink (Windows, `windows_route.py`).
pub struct DeviceRoute {
    route: WindowsRoute,
    devices: Arc<dyn RouteDevices>,
    monitor: MonitorFactory,
}

impl DeviceRoute {
    pub fn new(output: &str, devices: Arc<dyn RouteDevices>, monitor: MonitorFactory) -> Self {
        Self { route: WindowsRoute::new(output, devices.clone()), devices, monitor }
    }
}

impl VcRoute for DeviceRoute {
    fn gates_output(&self) -> bool {
        WindowsRoute::GATES_OUTPUT
    }
    fn drops_late_blocks(&self) -> bool {
        WindowsRoute::DROPS_LATE_BLOCKS
    }
    fn ready_timeout(&self) -> Duration {
        Duration::from_secs(vrct_audio_routing::windows_route::READY_TIMEOUT_S)
    }
    fn input_blocks(&self) -> usize {
        vrct_audio_routing::windows_route::INPUT_BLOCKS
    }
    fn bind(&self, source: &Endpoint, wait: bool) -> Result<Endpoint, String> {
        self.route.bind(source, wait).map_err(|e| e.code)
    }
    fn output(&self, sink: &Endpoint) -> Result<Box<dyn Output>, String> {
        Ok(Box::new(self.route.output(sink).map_err(|e| e.code)?))
    }
    fn capture(&self, source: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture> {
        self.devices.capture(source, callbacks)
    }
    fn monitor_factory(&self) -> MonitorFactory {
        self.monitor.clone()
    }
    fn max_age_ns(&self) -> i64 {
        p::DEVICE_MAX_AGE_NS
    }
}

/// The managed VC input on Linux (`_PipeWireRoute`, decision 11): the microphone is captured
/// from PipeWire and the converted voice goes into `vrct.managed.vc`, whose OS gate mutes it, so
/// nothing is silenced here. One block waits for the worker; a second is an overrun.
pub struct ManagedRoute {
    devices: Arc<dyn ManagedVcDevices>,
    monitor: MonitorFactory,
}

impl ManagedRoute {
    pub fn new(devices: Arc<dyn ManagedVcDevices>, monitor: MonitorFactory) -> Self {
        Self { devices, monitor }
    }
}

impl VcRoute for ManagedRoute {
    fn gates_output(&self) -> bool {
        managed_vc::GATES_OUTPUT
    }
    fn drops_late_blocks(&self) -> bool {
        managed_vc::DROPS_LATE_BLOCKS
    }
    fn ready_timeout(&self) -> Duration {
        Duration::from_secs(managed_vc::READY_TIMEOUT_S)
    }
    fn input_blocks(&self) -> usize {
        managed_vc::INPUT_BLOCKS
    }
    fn bind(&self, source: &Endpoint, wait: bool) -> Result<Endpoint, String> {
        self.devices.bind(source, wait).map_err(|e| e.code)
    }
    fn output(&self, sink: &Endpoint) -> Result<Box<dyn Output>, String> {
        self.devices.open_output(sink).map_err(|e| e.code)
    }
    fn capture(&self, source: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture> {
        self.devices.capture(source, callbacks)
    }
    fn monitor_factory(&self) -> MonitorFactory {
        self.monitor.clone()
    }
}

/// What the owner reports (`VCProcess.health`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Health {
    pub requested: bool,
    pub active: bool,
    pub pending: bool,
    pub stopping: bool,
    pub conversion_verified: bool,
    pub error: Option<String>,
    pub state: String,
    pub converted_blocks: u64,
    pub monitor_error: Option<String>,
    pub round_trip_ms: Option<i64>,
    /// `gpu` or `cpu`, from the worker's ready packet.
    pub device: Option<String>,
    pub latency_ms: Option<i64>,
    /// The session's block, once the worker has confirmed it.
    pub block_ms: Option<i64>,
}

/// Why speech could not go through the conversion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpeakFailure {
    /// No conversion runs (`vc_speech_unavailable`).
    Unavailable,
    /// The caller's own code (its cancellation, its stream's failure).
    Caller(String),
}

struct Block {
    info: p::Info,
    pcm: Vec<u8>,
    speech: bool,
}

struct State {
    requested: bool,
    active: bool,
    pending: bool,
    verified: bool,
    error: Option<String>,
    state: &'static str,
    device: Option<String>,
    latency_ms: Option<i64>,
    blocks: u64,
    monitor_error: Option<String>,
    rounds: VecDeque<i64>,
    late: VecDeque<bool>,
    partial: Vec<u8>,
    remainder: Vec<u8>,
    first: i64,
    last: i64,
    sequence: u64,
    sent: u64,
    speech: VecDeque<u8>,
    speech_open: bool,
    speech_part: bool,
    direct_suppressed: bool,
    queue: VecDeque<Block>,
    capture: Option<Arc<Mutex<Box<dyn Capture>>>>,
    thread: Option<thread::JoinHandle<()>>,
    finished: bool,
    cleanup_ok: bool,
}

struct MonitorState {
    muted: bool,
    after_ns: i64,
    tee: Option<MonitorTee>,
    retiring: bool,
    sink: Option<String>,
}

struct Shared {
    state: Mutex<State>,
    changed: Condvar,
    monitor: Mutex<MonitorState>,
    token: CancelToken,
    route: Arc<dyn VcRoute>,
    monitor_choice: Option<MonitorSpec>,
    worker: PathBuf,
    args: Vec<String>,
    session: String,
    engine: &'static str,
    block: p::Block,
    late_window: usize,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn median_ms(values: &VecDeque<i64>) -> Option<i64> {
    if values.is_empty() {
        return None;
    }
    let mut ordered: Vec<i64> = values.iter().copied().collect();
    ordered.sort_unstable();
    Some((ordered[ordered.len() / 2] as f64 / 1e6).round() as i64)
}

/// The conversion's own session id: 32 hex digits.
fn new_session() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// The checked options of an RVC start (`start_options('converted', ...)` with engine `rvc`).
/// `device` (`auto`), `threads` (0: the worker's choice), `highpass` (true) and `block_ms`
/// ([`DEFAULT_BLOCK_MS`]) may be left out.
pub fn rvc_options(options: &Value) -> Result<(RvcOptions, String), String> {
    let invalid = || "vc_options_invalid".to_owned();
    let object = options.as_object().ok_or_else(invalid)?;
    const REQUIRED: [&str; 6] = ["engine", "index", "index_rate", "model", "pitch", "runtime"];
    const OPTIONAL: [&str; 4] = ["device", "threads", "highpass", "block_ms"];
    if !REQUIRED.iter().all(|key| object.contains_key(*key)) || object.keys().any(|key| !REQUIRED.contains(&key.as_str()) && !OPTIONAL.contains(&key.as_str())) || object["engine"] != "rvc" {
        return Err(invalid());
    }
    let device = match object.get("device") {
        None => "auto".to_owned(),
        Some(Value::String(device)) if DEVICES.contains(&device.as_str()) => device.clone(),
        Some(_) => return Err(invalid()),
    };
    let threads = match object.get("threads") {
        None => 0,
        Some(value) => value.as_u64().filter(|n| value.is_u64() && *n <= u64::from(MAX_THREADS)).ok_or_else(invalid)? as u32,
    };
    let highpass = match object.get("highpass") {
        None => true,
        Some(Value::Bool(on)) => *on,
        Some(_) => return Err(invalid()),
    };
    let block_ms = match object.get("block_ms") {
        None => DEFAULT_BLOCK_MS,
        Some(value) => value.as_u64().filter(|_| value.is_u64()).and_then(|ms| u32::try_from(ms).ok()).and_then(p::Block::from_ms).ok_or_else(invalid)?.ms(),
    };
    let text = |key: &str| -> Result<String, String> {
        let value = object[key].as_str().ok_or_else(invalid)?;
        if value.chars().count() > 4096 || value.chars().any(|c| (c as u32) < 32) {
            return Err(invalid());
        }
        Ok(value.to_owned())
    };
    let (runtime, model, index) = (text("runtime")?, text("model")?, text("index")?);
    let pitch = object["pitch"].as_i64().filter(|p| object["pitch"].is_i64() && (-24..=24).contains(p)).ok_or_else(invalid)?;
    let rate = &object["index_rate"];
    let index_rate = rate.as_f64().filter(|r| rate.is_number() && r.is_finite() && (0.0..=1.0).contains(r)).ok_or_else(invalid)?;
    if runtime.trim().is_empty() || !model.to_lowercase().ends_with(".pth") || (!index.is_empty() && !index.to_lowercase().ends_with(".index")) || (index_rate != 0.0 && index.is_empty()) {
        return Err(invalid());
    }
    let rate = rate_text(index_rate, !rate.is_f64());
    Ok((RvcOptions { runtime: PathBuf::from(runtime), model: PathBuf::from(model), index, pitch, index_rate, device, threads, highpass, block_ms }, rate))
}

fn resolve(path: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok().map(|path| PathBuf::from(without_verbatim_prefix(&path.to_string_lossy())))
}

/// Windows' canonical form starts with `\\?\`, which the worker does not need. A share (a NAS,
/// or a mapped drive, which canonicalizes to its share) is `\\?\UNC\server\share\...`: it goes
/// back to `\\server\share\...`, as dropping only `\\?\` would leave the relative path
/// `UNC\server\...`.
fn without_verbatim_prefix(text: &str) -> String {
    if let Some(share) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{share}");
    }
    text.strip_prefix(r"\\?\").unwrap_or(text).to_owned()
}

/// A started conversion is single use: start once, stop, close.
pub struct VcProcess {
    shared: Arc<Shared>,
}

impl VcProcess {
    /// Check the files before anything starts (`RVCProcess.__init__`): the worker, the runtime
    /// the worker loads and the user's model and index.
    pub fn rvc(options: &Value, worker: &Path, route: Arc<dyn VcRoute>, monitor: Option<MonitorSpec>) -> Result<Self, String> {
        let (mut options, rate) = rvc_options(options)?;
        if !worker.is_file() {
            return Err("vc_engine_unavailable".into());
        }
        options.runtime = resolve(&options.runtime).unwrap_or(options.runtime);
        options.model = resolve(&options.model).filter(|p| p.is_file()).ok_or("vc_runtime_missing")?;
        if !options.index.is_empty() {
            options.index = resolve(Path::new(&options.index)).filter(|p| p.is_file()).ok_or("vc_runtime_missing")?.to_string_lossy().into_owned();
        }
        if !runtime_complete(&options.runtime) {
            return Err("vc_runtime_missing".into());
        }
        let session = new_session();
        let args = arguments(&options, &rate, &session);
        let block = p::Block::from_ms(options.block_ms).ok_or("vc_options_invalid")?;
        Ok(Self::with(worker.to_path_buf(), args, session, "rvc", route, monitor, block))
    }

    fn with(worker: PathBuf, args: Vec<String>, session: String, engine: &'static str, route: Arc<dyn VcRoute>, monitor_choice: Option<MonitorSpec>, block: p::Block) -> Self {
        Self {
            shared: Arc::new(Shared {
                state: Mutex::new(State {
                    requested: false,
                    active: false,
                    pending: false,
                    verified: false,
                    error: None,
                    state: "off",
                    device: None,
                    latency_ms: None,
                    blocks: 0,
                    monitor_error: None,
                    rounds: VecDeque::new(),
                    late: VecDeque::new(),
                    partial: Vec::new(),
                    remainder: Vec::new(),
                    first: 0,
                    last: 0,
                    sequence: 0,
                    sent: 0,
                    speech: VecDeque::new(),
                    speech_open: false,
                    speech_part: false,
                    direct_suppressed: false,
                    queue: VecDeque::new(),
                    capture: None,
                    thread: None,
                    finished: false,
                    cleanup_ok: true,
                }),
                changed: Condvar::new(),
                monitor: Mutex::new(MonitorState { muted: true, after_ns: 0, tee: None, retiring: false, sink: None }),
                token: CancelToken::default(),
                route,
                monitor_choice,
                worker,
                args,
                session,
                engine,
                block,
                late_window: late_window(block),
            }),
        }
    }

    /// Start capturing `source` and converting. Single use.
    pub fn start(&self, source: Endpoint) -> Result<(), String> {
        let mut state = lock(&self.shared.state);
        if state.thread.is_some() || self.shared.token.is_set() {
            return Err("vc_single_use".into());
        }
        state.requested = true;
        state.pending = true;
        state.state = "preparing";
        let shared = self.shared.clone();
        let handle = thread::Builder::new().name("vrct-vc".into()).spawn(move || run(&shared, &source)).map_err(|_| "vc_start_failed".to_owned())?;
        state.thread = Some(handle);
        Ok(())
    }

    /// Ask to stop; never waits.
    pub fn stop(&self) {
        stop(&self.shared);
    }

    /// Stop and wait up to `timeout` for the session to end and clean up.
    pub fn close(&self, timeout: Duration) -> bool {
        self.stop();
        let deadline = std::time::Instant::now() + timeout;
        let mut state = lock(&self.shared.state);
        while state.thread.is_some() && !state.finished {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() {
                return false;
            }
            state = self.shared.changed.wait_timeout(state, left).unwrap_or_else(|e| e.into_inner()).0;
        }
        if let Some(handle) = state.thread.take() {
            drop(state);
            let _ = handle.join();
            let mut state = lock(&self.shared.state);
            let ok = state.cleanup_ok;
            state.thread = None;
            return ok;
        }
        state.cleanup_ok
    }

    pub fn health(&self) -> Health {
        let state = lock(&self.shared.state);
        Health {
            requested: state.requested,
            active: state.active,
            pending: state.pending,
            stopping: state.thread.is_some() && !state.finished && !state.requested,
            conversion_verified: state.verified,
            error: state.error.clone(),
            state: state.state.to_owned(),
            converted_blocks: state.blocks,
            monitor_error: state.monitor_error.clone(),
            round_trip_ms: median_ms(&state.rounds),
            device: state.device.clone(),
            latency_ms: state.latency_ms,
            // Known once the worker's ready packet has confirmed it.
            block_ms: state.device.as_ref().map(|_| i64::from(self.shared.block.ms())),
        }
    }

    /// Mute intent of the route; with a device route, the output is silenced here.
    pub fn set_monitor_muted(&self, muted: bool) {
        let mut monitor = lock(&self.shared.monitor);
        // Every control is a boundary: never reuse a cancelled monitor or its queue.
        monitor.muted = muted;
        monitor.after_ns = monotonic_ns() as i64;
        if let Some(tee) = &monitor.tee {
            tee.close(false);
            monitor.retiring = true;
        }
    }

    /// Silence the microphone's blocks only; converted speech still plays (ADR-007).
    pub fn set_direct_suppressed(&self, suppressed: bool) {
        lock(&self.shared.state).direct_suppressed = suppressed;
    }

    /// True while a conversion runs that speech can be sent through.
    pub fn speaking_available(&self) -> bool {
        lock(&self.shared.state).active && !self.shared.token.is_set()
    }

    fn speech_check(&self, check: &dyn Fn() -> Result<(), String>) -> Result<(), SpeakFailure> {
        check().map_err(SpeakFailure::Caller)?;
        let state = lock(&self.shared.state);
        if self.shared.token.is_set() || !state.active {
            return Err(SpeakFailure::Unavailable);
        }
        Ok(())
    }

    /// Send speech (48 kHz mono s16le chunks) to be converted in place of the microphone, in
    /// real time: at most 0.4 s ahead of what plays. Returns once all of it had time to play.
    pub fn speak(
        &self,
        chunks: &mut dyn Iterator<Item = Result<Vec<u8>, String>>,
        check: &dyn Fn() -> Result<(), String>,
        on_first_audio: &mut dyn FnMut(i64, u32) -> Result<(), String>,
    ) -> Result<(), SpeakFailure> {
        let mut start: Option<i64> = None;
        let mut sent_ns: i64 = 0;
        let result = (|| -> Result<(), SpeakFailure> {
            let mut send = |chunk: &[u8], start: &mut Option<i64>, sent_ns: &mut i64| -> Result<(), SpeakFailure> {
                let begun = *start.get_or_insert_with(|| monotonic_ns() as i64);
                while monotonic_ns() as i64 - begun < *sent_ns - SPEECH_LEAD_NS {
                    self.speech_check(check)?;
                    thread::sleep(Duration::from_millis(10));
                }
                self.speech_check(check)?;
                self.speech_chunk(chunk);
                if *sent_ns == 0 {
                    on_first_audio(monotonic_ns() as i64, p::RATE).map_err(SpeakFailure::Caller)?;
                }
                *sent_ns += chunk.len() as i64 * 1_000_000_000 / (2 * i64::from(p::RATE));
                Ok(())
            };
            let mut pending: Vec<u8> = Vec::new();
            for chunk in chunks {
                self.speech_check(check)?;
                pending.extend(chunk.map_err(SpeakFailure::Caller)?);
                while pending.len() >= SPEECH_FRAME {
                    let frame: Vec<u8> = pending.drain(..SPEECH_FRAME).collect();
                    send(&frame, &mut start, &mut sent_ns)?;
                }
            }
            if pending.len() >= 2 {
                let whole = pending.len() - pending.len() % 2;
                send(&pending[..whole], &mut start, &mut sent_ns)?;
            }
            lock(&self.shared.state).speech_open = false;
            while let Some(begun) = start {
                if monotonic_ns() as i64 - begun >= sent_ns + SPEECH_TAIL_NS {
                    break;
                }
                self.speech_check(check)?;
                thread::sleep(Duration::from_millis(10));
            }
            Ok(())
        })();
        if result.is_err() {
            let mut state = lock(&self.shared.state);
            state.speech.clear();
            state.speech_open = false;
        }
        result
    }

    /// Converted speech to come; dropped when it would overflow.
    fn speech_chunk(&self, pcm: &[u8]) -> bool {
        let mut state = lock(&self.shared.state);
        if !state.requested || state.speech.len() + pcm.len() > SPEECH_LIMIT {
            return false;
        }
        state.speech.extend(pcm);
        state.speech_open = true;
        true
    }

    /// The capture callback: microphone audio of any length.
    pub fn offer_audio(&self, pcm: &[u8]) -> bool {
        audio(&self.shared, pcm)
    }
}

impl Drop for VcProcess {
    fn drop(&mut self) {
        stop(&self.shared);
    }
}

fn stop(shared: &Shared) {
    let capture = {
        let mut state = lock(&shared.state);
        state.requested = false;
        state.active = false;
        state.verified = false;
        shared.token.cancel();
        state.partial.clear();
        shared.changed.notify_all();
        state.capture.clone()
    };
    if let Some(capture) = capture
        && let Ok(capture) = capture.try_lock()
    {
        capture.request_stop();
    }
}

fn fail(shared: &Shared, code: &str) {
    {
        let mut state = lock(&shared.state);
        if !shared.token.is_set() {
            state.error = Some(code.to_owned());
            state.state = "failed";
        }
    }
    stop(shared);
}

fn too_late(state: &mut State, late: bool, window: usize) -> bool {
    state.late.push_back(late);
    while state.late.len() > window {
        state.late.pop_front();
    }
    state.late.iter().filter(|&&late| late).count() > window / 2
}

/// Capture thread: cut the audio into 20 ms parts and the parts into the session's blocks.
fn audio(shared: &Shared, pcm: &[u8]) -> bool {
    let mut fault = None;
    {
        let mut state = lock(&shared.state);
        if !state.requested || shared.token.is_set() {
            return false;
        }
        state.remainder.extend_from_slice(pcm);
        // The last sample arrived now. A capture can hand over several parts at once (PipeWire
        // in quanta of its own), so each part is stamped back from now by what came after it:
        // a block that ended as it arrived is never stamped as ending in the future.
        let arrived = monotonic_ns() as i64;
        while state.remainder.len() >= PART {
            let part: Vec<u8> = state.remainder.drain(..PART).collect();
            // A part is stamped with when it began.
            let after = state.remainder.len() as i64 * 1_000_000_000 / (2 * i64::from(p::RATE));
            let stamp = (arrived - after - PART_NS).max(state.last + 1);
            state.last = stamp;
            if state.partial.is_empty() {
                state.first = stamp;
            }
            let part = if !state.speech.is_empty() || state.speech_open {
                // Speech replaces the microphone part for part; underrun inside an utterance
                // is silence, never the microphone.
                let take = state.speech.len().min(PART);
                let mut speech: Vec<u8> = state.speech.drain(..take).collect();
                speech.resize(PART, 0);
                state.speech_part = true;
                speech
            } else {
                part
            };
            state.partial.extend_from_slice(&part);
            if state.partial.len() == shared.block.pcm_bytes() {
                let info = match p::input_info(&shared.session, state.sequence, state.first, shared.block) {
                    Ok(mut info) => {
                        info.insert("pcm_bytes".into(), json!(shared.block.pcm_bytes()));
                        info
                    }
                    Err(error) => {
                        fault = Some(error.0);
                        break;
                    }
                };
                let speech = std::mem::replace(&mut state.speech_part, false);
                let block = Block { info, pcm: std::mem::take(&mut state.partial), speech };
                if state.queue.len() < shared.route.input_blocks() {
                    state.queue.push_back(block);
                } else if !shared.route.drops_late_blocks() {
                    fault = Some("vc_capture_overrun".to_owned());
                    break;
                } else {
                    state.queue.pop_front();
                    state.queue.push_back(block);
                    if too_late(&mut state, true, shared.late_window) {
                        fault = Some("vc_capture_overrun".to_owned());
                        break;
                    }
                }
                state.sequence += 1;
                shared.changed.notify_all();
            }
        }
    }
    if let Some(code) = fault {
        fail(shared, &code);
        return false;
    }
    true
}

/// Device route: this block as the worker's next one, or `None` when it came too late.
fn next_block(shared: &Shared, info: p::Info) -> Result<Option<p::Info>, String> {
    let mut state = lock(&shared.state);
    let end = info.get("end_ns").and_then(Value::as_i64).unwrap_or(0);
    let age = monotonic_ns() as i64 - end;
    let late = age > LATE_NS;
    if too_late(&mut state, late, shared.late_window) {
        return Err("vc_capture_overrun".into());
    }
    if late {
        return Ok(None);
    }
    let mut info = info;
    info.insert("sequence".into(), json!(state.sent));
    state.sent += 1;
    Ok(Some(info))
}

/// The write's token: the session's cancellation and the block's freshness.
struct Deadline<'a> {
    token: &'a CancelToken,
    end_ns: i64,
    max_age_ns: i64,
}

impl Deadline<'_> {
    fn fresh(&self) -> Result<(), String> {
        if self.token.is_set() {
            return Err("cancelled".into());
        }
        p::require_fresh(self.end_ns, monotonic_ns() as i64, self.max_age_ns).map_err(|e| e.0)
    }
}

impl PlaybackToken for Deadline<'_> {
    fn check(&self) -> vrct_audio_routing::Result<()> {
        self.token.check()?;
        self.fresh().map_err(vrct_audio_routing::Error::speech)
    }
    fn is_set(&self) -> bool {
        self.token.is_set()
    }
    fn wait(&self, timeout: Duration) -> bool {
        self.token.wait(timeout)
    }
    fn begin_playback(&self) -> vrct_audio_routing::Result<()> {
        self.check()
    }
}

fn audible(shared: &Shared, converted: Vec<u8>, speech: bool) -> Vec<u8> {
    if lock(&shared.state).direct_suppressed && !speech {
        return vec![0; converted.len()];
    }
    if !shared.route.gates_output() {
        return converted;
    }
    if lock(&shared.monitor).muted {
        vec![0; converted.len()]
    } else {
        converted
    }
}

fn offer_monitor(shared: &Arc<Shared>, converted: &[u8], start_ns: i64) {
    let mut monitor = lock(&shared.monitor);
    if monitor.muted || start_ns < monitor.after_ns {
        return;
    }
    if monitor.retiring {
        // Never wait for a device on the conversion path.
        if !monitor.tee.as_ref().is_none_or(|tee| tee.join(Duration::ZERO)) {
            return;
        }
        monitor.tee = None;
        monitor.retiring = false;
    }
    if monitor.tee.is_none() {
        let (Some(choice), Some(sink)) = (&shared.monitor_choice, monitor.sink.clone()) else { return };
        let failed = Arc::downgrade(shared);
        let ready = Arc::downgrade(shared);
        let options = MonitorOptions {
            exclude: vec![sink],
            factory: shared.route.monitor_factory(),
            on_error: Some(Arc::new(move |code: &str| {
                if let Some(shared) = failed.upgrade() {
                    lock(&shared.state).monitor_error = Some(code.to_owned());
                }
            })),
            on_ready: Some(Arc::new(move || {
                if let Some(shared) = ready.upgrade() {
                    lock(&shared.state).monitor_error = None;
                }
            })),
            max_buffer_ms: 500,
        };
        monitor.tee = Some(MonitorTee::new(&choice.device, choice.volume, options));
    }
    if let Some(tee) = &monitor.tee {
        tee.offer(converted, p::RATE, 1);
    }
}

/// `_capture_failed`: how a capture's failure ends the conversion. One of the capture's fixed
/// codes is shown as it is, as Python showed it (the settings explain some of them); a code it
/// does not know, or its generic `asr_capture_failed`, is `vc_capture_failed`. A conversion's own
/// code (`vc_*`) is kept.
fn capture_failure(code: &str) -> String {
    if code.starts_with("vc_") {
        return code.to_owned();
    }
    match vrct_audio_routing::windows_route::capture_code(code) {
        "asr_capture_failed" => "vc_capture_failed".to_owned(),
        known => known.to_owned(),
    }
}

fn code_of(error: vrct_audio_routing::Error) -> String {
    if error.code.starts_with("vc_") || error.code.starts_with("source_bridge_") || error.code.starts_with("output_") {
        error.code
    } else {
        "vc_worker_failed".into()
    }
}

fn run(shared: &Arc<Shared>, source: &Endpoint) {
    let mut worker: Option<WorkerPipe> = None;
    let mut output: Option<Box<dyn Output>> = None;
    let result = session(shared, source, &mut worker, &mut output);
    if let Err(code) = result {
        fail(shared, &code);
    }
    stop(shared);
    let mut cleanup_ok = true;
    let capture = lock(&shared.state).capture.take();
    if let Some(capture) = capture {
        lock(&capture).stop();
    }
    if let Some(mut output) = output {
        let _ = output.close(false, &shared.token);
    }
    {
        // After the output. The monitor's own thread reaps its device; a slow monitor never
        // marks the conversion's cleanup as incomplete.
        let tee = {
            let mut monitor = lock(&shared.monitor);
            monitor.muted = true;
            monitor.tee.take()
        };
        if let Some(tee) = tee {
            tee.close(false);
            tee.join(Duration::from_millis(1500));
        }
    }
    if let Some(mut worker) = worker {
        cleanup_ok = worker.end();
    }
    let mut state = lock(&shared.state);
    if !cleanup_ok {
        state.cleanup_ok = false;
        state.error = Some(state.error.clone().unwrap_or_else(|| "vc_cleanup_failed".into()));
    }
    state.pending = false;
    state.state = if state.error.is_some() { "failed" } else { "stopped" };
    state.queue.clear();
    state.finished = true;
    shared.changed.notify_all();
}

fn cancelled(shared: &Shared) -> Result<(), String> {
    if shared.token.is_set() {
        Err("cancelled".into())
    } else {
        Ok(())
    }
}

fn session(shared: &Arc<Shared>, source: &Endpoint, worker_slot: &mut Option<WorkerPipe>, output_slot: &mut Option<Box<dyn Output>>) -> Result<(), String> {
    let route = &shared.route;
    let sink = route.bind(source, true)?;
    cancelled(shared)?;
    let worker = worker_slot.insert(WorkerPipe::start(&shared.worker, &shared.args, None).map_err(|_| "vc_worker_failed".to_owned())?);
    let check = || -> Result<(), ProtocolError> { cancelled(shared).map_err(ProtocolError) };
    let (info, pcm) = worker.read(route.ready_timeout(), &mut || check()).map_err(|e| e.0)?;
    let (device, latency) = p::require_ready(&info, &pcm, &shared.session, shared.engine, shared.block).map_err(|e| e.0)?;
    {
        let mut state = lock(&shared.state);
        state.device = device.map(str::to_owned);
        state.latency_ms = latency;
    }
    cancelled(shared)?;
    if route.bind(source, true)? != sink {
        return Err("vc_sink_changed".into());
    }
    let output = output_slot.insert(route.output(&sink)?);
    lock(&shared.monitor).sink = Some(sink.name.clone());
    cancelled(shared)?;
    let (audio_to, errors_to) = (Arc::downgrade(shared), Arc::downgrade(shared));
    let callbacks = CaptureCallbacks {
        on_audio: Box::new(move |pcm| audio_to.upgrade().is_some_and(|shared| audio(&shared, pcm))),
        on_error: Box::new(move |code| {
            if let Some(shared) = errors_to.upgrade() {
                fail(&shared, &capture_failure(code));
            }
        }),
    };
    let capture = Arc::new(Mutex::new(route.capture(source, callbacks)));
    {
        let mut state = lock(&shared.state);
        state.capture = Some(capture.clone());
        if shared.token.is_set() {
            lock(&capture).request_stop();
        }
    }
    cancelled(shared)?;
    lock(&capture).start().map_err(|e| capture_failure(&e.code))?;
    {
        let mut state = lock(&shared.state);
        cancelled(shared)?;
        state.active = true;
        state.pending = false;
        state.state = "ready";
    }
    let check_binding = || -> Result<(), String> {
        if route.bind(source, false)? != sink {
            return Err("vc_sink_changed".into());
        }
        Ok(())
    };
    loop {
        cancelled(shared)?;
        if worker.exited() {
            return Err("vc_worker_eof".into());
        }
        check_binding()?;
        let block = {
            let mut state = lock(&shared.state);
            if state.queue.is_empty() {
                state = shared.changed.wait_timeout(state, Duration::from_millis(20)).unwrap_or_else(|e| e.into_inner()).0;
            }
            state.queue.pop_front()
        };
        let Some(Block { info, pcm, speech }) = block else { continue };
        let info = if route.drops_late_blocks() {
            match next_block(shared, info)? {
                Some(info) => info,
                None => continue,
            }
        } else {
            info
        };
        let end_ns = info.get("end_ns").and_then(Value::as_i64).unwrap_or(0);
        let start_ns = info.get("start_ns").and_then(Value::as_i64).unwrap_or(0);
        let deadline = Deadline { token: &shared.token, end_ns, max_age_ns: route.max_age_ns() };
        let fresh = || -> Result<(), ProtocolError> {
            deadline.fresh().map_err(ProtocolError)?;
            check_binding().map_err(ProtocolError)
        };
        fresh().map_err(|e| e.0)?;
        let sent_at = monotonic_ns() as i64;
        let mut wire_info = info.clone();
        wire_info.remove("pcm_bytes");
        worker.send(p::encode_packet(&wire_info, &pcm).map_err(|e| e.0)?).map_err(|e| e.0)?;
        let (result, converted) = worker.read(Duration::from_secs(1), &mut || fresh()).map_err(|e| e.0)?;
        {
            let mut state = lock(&shared.state);
            state.rounds.push_back(monotonic_ns() as i64 - sent_at);
            while state.rounds.len() > shared.late_window {
                state.rounds.pop_front();
            }
        }
        let converted_state = p::require_output(&result, &converted, &info, &pcm, monotonic_ns() as i64, route.max_age_ns(), shared.block).map_err(|e| e.0)?;
        fresh().map_err(|e| e.0)?;
        let audible = audible(shared, converted, speech);
        output.write(&audible, &deadline).map_err(code_of)?;
        // Queue only, after the main write: the same block, no added wait.
        offer_monitor(shared, &audible, start_ns);
        fresh().map_err(|e| e.0)?;
        let mut state = lock(&shared.state);
        cancelled(shared)?;
        if converted_state == "converted" {
            state.verified = true;
            state.blocks += 1;
        }
        state.state = if converted_state == "converted" { "converted" } else { "idle" };
    }
}

#[cfg(test)]
mod tests {
    use super::{late_window, rvc_options, without_verbatim_prefix, PART};
    use crate::protocol::Block;

    #[test]
    fn blocks_are_judged_on_six_seconds_whatever_their_length() {
        // 75 blocks of 80 ms, as before the block could be chosen.
        assert_eq!(late_window(Block::default()), 75);
        assert_eq!(late_window(Block::from_ms(40).unwrap()), 150);
        assert_eq!(late_window(Block::from_ms(200).unwrap()), 30);
    }

    #[test]
    fn a_start_converts_in_40_ms_blocks_unless_it_chooses_another_length() {
        let base = serde_json::json!({ "engine": "rvc", "runtime": "/r", "model": "/v.pth", "index": "", "pitch": 0, "index_rate": 0 });
        assert_eq!(rvc_options(&base).unwrap().0.block_ms, 40);
        let mut chosen = base.clone();
        chosen["block_ms"] = serde_json::json!(120);
        assert_eq!(rvc_options(&chosen).unwrap().0.block_ms, 120);
        // Every block holds whole 20 ms capture parts.
        for ms in [20, 40, 120, 200] {
            assert_eq!(Block::from_ms(ms).unwrap().pcm_bytes() % PART, 0, "{ms}");
        }
    }

    #[test]
    fn a_share_keeps_its_double_backslash_and_a_drive_loses_the_verbatim_prefix() {
        assert_eq!(without_verbatim_prefix(r"\\?\UNC\nas\voices\model.pth"), r"\\nas\voices\model.pth");
        assert_eq!(without_verbatim_prefix(r"\\?\C:\voices\model.pth"), r"C:\voices\model.pth");
        assert_eq!(without_verbatim_prefix("/home/user/voices/model.pth"), "/home/user/voices/model.pth");
    }

    /// A route whose sink cannot be found: a session fails at once, without a worker.
    struct Unbound;

    impl super::VcRoute for Unbound {
        fn gates_output(&self) -> bool {
            false
        }
        fn drops_late_blocks(&self) -> bool {
            true
        }
        fn ready_timeout(&self) -> std::time::Duration {
            std::time::Duration::from_millis(100)
        }
        fn input_blocks(&self) -> usize {
            8
        }
        fn bind(&self, _: &vrct_audio_routing::graph::Endpoint, _: bool) -> Result<vrct_audio_routing::graph::Endpoint, String> {
            Err("vc_output_missing".into())
        }
        fn output(&self, _: &vrct_audio_routing::graph::Endpoint) -> Result<Box<dyn vrct_audio_routing::router::Output>, String> {
            Err("vc_output_missing".into())
        }
        fn capture(&self, _: &vrct_audio_routing::graph::Endpoint, _: vrct_audio_routing::windows_route::CaptureCallbacks) -> Box<dyn vrct_audio_routing::windows_route::Capture> {
            unreachable!("a session without a sink captures nothing")
        }
        fn monitor_factory(&self) -> vrct_audio_routing::monitor::MonitorFactory {
            std::sync::Arc::new(|_: &str, _: u32, _: u16, _: &[String]| Err(vrct_audio_routing::Error::speech("monitor_output_missing")))
        }
    }

    fn process(block_ms: u32) -> super::VcProcess {
        let session = "0123456789abcdef0123456789abcdef".to_owned();
        super::VcProcess::with("/nonexistent-worker".into(), Vec::new(), session, "rvc", std::sync::Arc::new(Unbound), None, Block::from_ms(block_ms).unwrap())
    }

    /// The process as a running session sees its capture: requested, nothing started.
    fn requested(block_ms: u32) -> super::VcProcess {
        let process = process(block_ms);
        process.shared.state.lock().unwrap().requested = true;
        process
    }

    fn queued(process: &super::VcProcess) -> Vec<(Vec<u8>, bool)> {
        process.shared.state.lock().unwrap().queue.iter().map(|b| (b.pcm.clone(), b.speech)).collect()
    }

    #[test]
    fn speech_replaces_the_microphone_part_for_part_and_an_underrun_inside_it_is_silence() {
        // `test_vc_speech_through.py`: speech in place of the microphone, a gap inside an
        // utterance as silence, never the microphone, and the microphone again after it.
        let process = requested(40);
        let microphone = vec![7u8; PART];
        // One and a half parts of speech; the utterance is still open.
        assert!(process.speech_chunk(&vec![9u8; PART + PART / 2]));
        assert!(process.offer_audio(&microphone));
        assert!(process.offer_audio(&microphone));
        let blocks = queued(&process);
        assert_eq!(blocks.len(), 1);
        let (pcm, speech) = &blocks[0];
        assert!(speech, "a block that carried speech says so");
        assert!(pcm[..PART + PART / 2].iter().all(|&b| b == 9));
        assert!(pcm[PART + PART / 2..].iter().all(|&b| b == 0), "the rest of the part is silence, not the microphone");
        // Still open with nothing to say: silence.
        assert!(process.offer_audio(&microphone));
        assert!(process.offer_audio(&microphone));
        let (pcm, speech) = &queued(&process)[1];
        assert!(*speech && pcm.iter().all(|&b| b == 0));
        // The utterance ends: the microphone again.
        process.shared.state.lock().unwrap().speech_open = false;
        assert!(process.offer_audio(&microphone));
        assert!(process.offer_audio(&microphone));
        let (pcm, speech) = &queued(&process)[2];
        assert!(!*speech && pcm.iter().all(|&b| b == 7));
    }

    #[test]
    fn speech_waits_only_while_a_session_runs_and_never_beyond_two_seconds() {
        let idle = process(40);
        assert!(!idle.speech_chunk(&[1, 2]), "no session, no speech");
        assert!(!idle.offer_audio(&[0u8; PART]), "no session, no capture");
        let process = requested(40);
        let two_seconds = 2 * 48000 * 2;
        assert!(process.speech_chunk(&vec![1u8; two_seconds - 2]));
        assert!(!process.speech_chunk(&[1u8; 4]), "over the limit");
        assert!(process.speech_chunk(&[1u8; 2]));
    }

    #[test]
    fn the_microphone_is_cut_into_whole_blocks_of_the_sessions_length() {
        // Any length in, blocks of 40 ms out, in order, stamped one after another.
        let process = requested(40);
        let pcm: Vec<u8> = (0..PART * 5).map(|i| (i % 251) as u8).collect();
        for piece in pcm.chunks(1000) {
            assert!(process.offer_audio(piece));
        }
        let blocks = queued(&process);
        assert_eq!(blocks.len(), 2, "five parts make two blocks of two and one part waits");
        assert_eq!(blocks[0].0, pcm[..PART * 2]);
        assert_eq!(blocks[1].0, pcm[PART * 2..PART * 4]);
        let state = process.shared.state.lock().unwrap();
        let starts: Vec<i64> = state.queue.iter().map(|b| b.info["start_ns"].as_i64().unwrap()).collect();
        assert!(starts[1] > starts[0]);
        assert_eq!(state.queue.iter().map(|b| b.info["sequence"].as_u64().unwrap()).collect::<Vec<_>>(), [0, 1]);
    }

    #[test]
    fn parts_handed_over_together_are_stamped_back_from_their_arrival() {
        // PipeWire hands the microphone over in quanta of its own (decision 11): a whole block
        // can come in one go. It ended as it arrived, so its end is now, never in the future.
        vrct_audio_routing::sync::monotonic_ns();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let process = requested(40);
        assert!(process.offer_audio(&vec![0u8; PART * 2 + 100]));
        let arrived = vrct_audio_routing::sync::monotonic_ns() as i64;
        let state = process.shared.state.lock().unwrap();
        let block = &state.queue[0];
        let (start, end) = (block.info["start_ns"].as_i64().unwrap(), block.info["end_ns"].as_i64().unwrap());
        assert!(end <= arrived, "the block ends {} ns in the future", end - arrived);
        // 100 bytes (about 1 ms) came after the block.
        assert!(arrived - end >= 1_000_000 && arrived - end < 20_000_000, "{}", arrived - end);
        assert_eq!(end - start, 40_000_000);
        crate::protocol::require_fresh(end, arrived, crate::protocol::MANAGED_MAX_AGE_NS).expect("a block handed over whole is fresh");
    }

    #[test]
    fn a_capture_failure_is_shown_by_the_captures_own_code_as_python_showed_it() {
        // `_capture_failed` over `capture_error_code` (decision 3 of #733).
        assert_eq!(super::capture_failure("asr_capture_start_timeout"), "asr_capture_start_timeout");
        assert_eq!(super::capture_failure("asr_capture_stream_create_failed"), "asr_capture_stream_create_failed");
        assert_eq!(super::capture_failure("asr_capture_stalled"), "asr_capture_stalled");
        assert_eq!(super::capture_failure("asr_capture_failed"), "vc_capture_failed");
        assert_eq!(super::capture_failure("asr_capture_endpoint_invalid"), "vc_capture_failed");
        assert_eq!(super::capture_failure("a driver's own words"), "vc_capture_failed");
        assert_eq!(super::capture_failure("vc_source_changed"), "vc_source_changed");
    }

    #[test]
    fn a_session_starts_once_and_a_failed_one_ends_with_its_code() {
        // `test_vc_isolated.py`: `stop` never waits, a second start is refused (`vc_single_use`),
        // and `close` reports how the session ended.
        let process = process(40);
        let source = vrct_audio_routing::graph::Endpoint { cookie: 1, serial: 2, name: "mic".into(), media_class: "Audio/Source".into() };
        process.start(source.clone()).unwrap();
        assert_eq!(process.start(source.clone()).unwrap_err(), "vc_single_use");
        // The session fails on its own (no sink); a close before that would only stop it.
        let began = std::time::Instant::now();
        while process.health().pending {
            assert!(began.elapsed() < std::time::Duration::from_secs(5), "the session did not end");
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let health = process.health();
        assert_eq!((health.state.as_str(), health.error.as_deref(), health.requested, health.active), ("failed", Some("vc_output_missing"), false, false));
        assert!(process.close(std::time::Duration::from_secs(5)));
        // Stopped, it does not start again either.
        assert_eq!(process.start(source).unwrap_err(), "vc_single_use");
        let stopped = super::VcProcess::with("/nonexistent-worker".into(), Vec::new(), "0123456789abcdef0123456789abcdef".into(), "rvc", std::sync::Arc::new(Unbound), None, Block::default());
        let began = std::time::Instant::now();
        stopped.stop();
        assert!(began.elapsed() < std::time::Duration::from_millis(100), "stop waits for nothing");
        assert_eq!(stopped.start(vrct_audio_routing::graph::Endpoint { cookie: 1, serial: 2, name: "mic".into(), media_class: "Audio/Source".into() }).unwrap_err(), "vc_single_use");
    }

    #[test]
    fn options_outside_the_contract_are_refused_before_anything_starts() {
        // `test_rvc_integration.py`: `invalid_rvc_options`.
        let base = serde_json::json!({ "engine": "rvc", "runtime": "/r", "model": "/v.pth", "index": "", "pitch": 0, "index_rate": 0 });
        assert!(rvc_options(&base).is_ok());
        let with = |key: &str, value: serde_json::Value| {
            let mut options = base.clone();
            options[key] = value;
            options
        };
        let without = |key: &str| {
            let mut options = base.clone();
            options.as_object_mut().unwrap().remove(key);
            options
        };
        let refused = [
            with("engine", serde_json::json!("seed-vc")),
            with("pitch", serde_json::json!(25)),
            with("pitch", serde_json::json!(-25)),
            with("pitch", serde_json::json!(1.5)),
            with("index_rate", serde_json::json!(1.5)),
            with("index_rate", serde_json::json!(-0.1)),
            // An index rate needs an index, and an index is a .index file.
            with("index_rate", serde_json::json!(0.5)),
            with("index", serde_json::json!("/v.bin")),
            with("model", serde_json::json!("/v.onnx")),
            with("runtime", serde_json::json!("  ")),
            with("model", serde_json::json!("/v\u{1}.pth")),
            with("model", serde_json::json!(format!("/{}.pth", "a".repeat(4096)))),
            with("device", serde_json::json!("npu")),
            with("threads", serde_json::json!(-1)),
            with("threads", serde_json::json!(super::MAX_THREADS + 1)),
            with("highpass", serde_json::json!("yes")),
            with("block_ms", serde_json::json!(30)),
            with("block_ms", serde_json::json!(220)),
            with("other", serde_json::json!(1)),
            without("model"),
            without("index_rate"),
            serde_json::json!([]),
        ];
        for options in refused {
            assert_eq!(rvc_options(&options).unwrap_err(), "vc_options_invalid", "{options}");
        }
        let mut indexed = with("index", serde_json::json!("/v.INDEX"));
        indexed["index_rate"] = serde_json::json!(0.75);
        let (options, rate) = rvc_options(&indexed).unwrap();
        assert_eq!((options.index.as_str(), options.index_rate, rate.as_str()), ("/v.INDEX", 0.75, "0.75"));
    }

    #[test]
    fn a_start_checks_the_worker_the_runtime_and_the_users_files() {
        // `test_rvc_integration.py`: `missing_runtime` and the files of the start.
        let dir = std::env::temp_dir().join(format!("vrct-vc-files-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let worker = dir.join("worker");
        let model = dir.join("voice.pth");
        std::fs::write(&model, b"model").unwrap();
        let options = |model: &std::path::Path, index: &str| {
            serde_json::json!({ "engine": "rvc", "runtime": dir.join("runtime"), "model": model, "index": index, "pitch": 0, "index_rate": 0 })
        };
        let route = || -> std::sync::Arc<dyn super::VcRoute> { std::sync::Arc::new(Unbound) };
        let code = |result: Result<super::VcProcess, String>| result.err().unwrap_or_default();
        // No worker.
        assert_eq!(code(super::VcProcess::rvc(&options(&model, ""), &worker, route(), None)), "vc_engine_unavailable");
        std::fs::write(&worker, b"worker").unwrap();
        // No model, no index file, then no runtime.
        assert_eq!(code(super::VcProcess::rvc(&options(&dir.join("absent.pth"), ""), &worker, route(), None)), "vc_runtime_missing");
        let absent_index = dir.join("absent.index").to_string_lossy().into_owned();
        assert_eq!(code(super::VcProcess::rvc(&options(&model, &absent_index), &worker, route(), None)), "vc_runtime_missing");
        assert_eq!(code(super::VcProcess::rvc(&options(&model, ""), &worker, route(), None)), "vc_runtime_missing");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
