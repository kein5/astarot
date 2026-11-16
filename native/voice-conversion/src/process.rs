//! One conversion session: the worker's owner (`process.py`, `rvc_process.py`, `isolated.py`).
//!
//! The microphone is captured in 80 ms blocks, each block goes to the worker, and only its
//! checked, fresh answer reaches the output. No original-audio fallback exists. Capture never
//! waits for the worker.
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
use vrct_audio_routing::monitor::{MonitorFactory, MonitorOptions, MonitorSpec, MonitorTee};
use vrct_audio_routing::router::{CancelToken, Output, PlaybackToken};
use vrct_audio_routing::sync::monotonic_ns;
use vrct_audio_routing::windows_route::{Capture, CaptureCallbacks, RouteDevices, WindowsRoute};

use crate::protocol::{self as p, ProtocolError};
use crate::worker::{arguments, rate_text, runtime_complete, RvcOptions, WorkerPipe};

/// Device route: a block older than this is dropped instead of sent. More than half of six
/// seconds of blocks late means this PC cannot keep up, and the voice stops.
pub const LATE_NS: i64 = 240_000_000;
pub const LATE_WINDOW: usize = 75;
/// 20 ms parts of the microphone at 48 kHz mono s16le.
pub const PART: usize = 1920;
const PART_NS: i64 = 20_000_000;
/// Speech through the conversion (ADR-007): what may wait to replace the microphone.
const SPEECH_LIMIT: usize = p::PCM_BYTES * 25;
/// One 80 ms block per send, at most this far ahead of real time, waited out by about two
/// conversion blocks.
const SPEECH_FRAME: usize = 7680;
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
pub fn rvc_options(options: &Value) -> Result<(RvcOptions, String), String> {
    let invalid = || "vc_options_invalid".to_owned();
    let object = options.as_object().ok_or_else(invalid)?;
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    if keys != ["engine", "index", "index_rate", "model", "pitch", "runtime"] || object["engine"] != "rvc" {
        return Err(invalid());
    }
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
    Ok((RvcOptions { runtime: PathBuf::from(runtime), model: PathBuf::from(model), index, pitch, index_rate }, rate))
}

fn resolve(path: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok().map(|path| {
        // Windows' canonical form starts with `\\?\`, which the worker does not need.
        let text = path.to_string_lossy();
        PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned())
    })
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
        Ok(Self::with(worker.to_path_buf(), args, session, "rvc", route, monitor))
    }

    fn with(worker: PathBuf, args: Vec<String>, session: String, engine: &'static str, route: Arc<dyn VcRoute>, monitor_choice: Option<MonitorSpec>) -> Self {
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

fn too_late(state: &mut State, late: bool) -> bool {
    state.late.push_back(late);
    while state.late.len() > LATE_WINDOW {
        state.late.pop_front();
    }
    state.late.iter().filter(|&&late| late).count() > LATE_WINDOW / 2
}

/// Capture thread: cut the audio into 20 ms parts and the parts into 80 ms blocks.
fn audio(shared: &Shared, pcm: &[u8]) -> bool {
    let mut fault = None;
    {
        let mut state = lock(&shared.state);
        if !state.requested || shared.token.is_set() {
            return false;
        }
        state.remainder.extend_from_slice(pcm);
        while state.remainder.len() >= PART {
            let part: Vec<u8> = state.remainder.drain(..PART).collect();
            // A part is stamped with when it began: it ended as it arrived.
            let stamp = (monotonic_ns() as i64 - PART_NS).max(state.last + 1);
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
            if state.partial.len() == p::PCM_BYTES {
                let info = match p::input_info(&shared.session, state.sequence, state.first) {
                    Ok(mut info) => {
                        info.insert("pcm_bytes".into(), json!(p::PCM_BYTES));
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
                    if too_late(&mut state, true) {
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
    if too_late(&mut state, late) {
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
    let (device, latency) = p::require_ready(&info, &pcm, &shared.session, shared.engine).map_err(|e| e.0)?;
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
                fail(&shared, if code.starts_with("vc_") { code } else { "vc_capture_failed" });
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
    lock(&capture).start().map_err(|e| if e.code.starts_with("vc_") { e.code } else { "vc_capture_failed".into() })?;
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
            while state.rounds.len() > LATE_WINDOW {
                state.rounds.pop_front();
            }
        }
        let converted_state = p::require_output(&result, &converted, &info, &pcm, monotonic_ns() as i64, route.max_age_ns()).map_err(|e| e.0)?;
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
