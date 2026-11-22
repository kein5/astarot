//! One bounded worker; chat delivery never waits for HTTP or audio devices.
//!
//! The rules, unchanged from the Python `VoiceEventBus`:
//!
//! - Only final chat (when the chat mode is not `off`) and final microphone
//!   translations (when microphone speech is `translated`) are accepted, while
//!   speech is enabled and not muted. Each message is spoken at most once.
//! - At most `capacity` messages wait. A full queue drops its oldest microphone
//!   message for a newcomer, or its oldest message when it holds no microphone
//!   message; a microphone message is refused rather than displace chat.
//! - The worker takes queued chat before microphone speech, oldest first.
//! - A message older than `max_age` when its turn comes is dropped and counted
//!   as expired. Microphone speech must also become audible within `max_age`
//!   of its recognition, or it ends with `speech_expired`; speech that has
//!   started is never cut short by that deadline.
//! - Typed chat does not count the time it waited while the worker spoke an
//!   earlier message (decision 61 of `docs/voice-stack/core-integration.md`):
//!   messages sent one after another are spoken however long the earlier ones
//!   are, and only one left waiting while nothing speaks expires. Python
//!   counted that time for chat too.
//! - Every utterance ends within `request_timeout` (`request_timeout`).
//! - Stop, mute, unmute, disable, reconfigure and close cancel the utterance
//!   in progress, empty the queue, silence speech monitors and advance the
//!   generation, so requests made against an older state are refused.
//!   Cancelling one source affects only that source.

use std::collections::{HashMap, HashSet, VecDeque};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, RwLock, Weak};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::cancel::CancelToken;
use crate::client::SpeechCppTts;
use crate::clock::monotonic_ns;
use crate::converted::ConvertedRouter;
use crate::error::{SpeechError, TtsError};
use crate::events::{Source, SpeechMessageEvent};
use crate::model_options::SynthesisOptions;
use crate::playback::{Frames, Monitor, SpeechRouter};
use crate::settings::{is_blank, SpeechRequest, VoiceSettings, SPEECHCPP};
use crate::sync::{lock, Event};
use crate::trace::write_voice_trace;

/// Makes speech for one utterance. `request.engine_voice` is set for an
/// installed engine.
pub trait Synthesizer: Send {
    fn synthesize_stream(&self, request: &SpeechRequest, token: &CancelToken, options: &SynthesisOptions) -> Result<Frames, TtsError>;
}

impl Synthesizer for SpeechCppTts {
    fn synthesize_stream(&self, request: &SpeechRequest, token: &CancelToken, options: &SynthesisOptions) -> Result<Frames, TtsError> {
        Ok(Box::new(SpeechCppTts::synthesize_stream(self, &request.text, &request.voice, request.language, token, options)))
    }
}

/// Readies a speech.cpp server (base URL, voice, language tag) for the speech that follows
/// ([`SpeechCppTts::warm_up`]).
/// The token stops it.
pub type WarmUp = Arc<dyn Fn(&str, &str, &str, &CancelToken) -> Result<(), TtsError> + Send + Sync>;

/// How long a server stays ready after it last spoke or was readied: [`VoiceEventBus::warm`]
/// sends nothing within it.
const WARM_FOR: Duration = Duration::from_secs(1);

/// A speech.cpp synthesizer for a server's base URL.
pub type ProviderFactory = Arc<dyn Fn(&str) -> Result<Box<dyn Synthesizer>, TtsError> + Send + Sync>;

/// A client for an installed engine (ADR-008): `(engine, base URL)`, such as
/// `("voicevox", "http://127.0.0.1:50021")`. The engine clients are not in
/// this crate.
pub type EngineFactory = Arc<dyn Fn(&str, &str) -> Result<Box<dyn Synthesizer>, TtsError> + Send + Sync>;

/// The base URL of a running bundled server for a role (`japanese` or `multilingual`).
pub type ResolveServer = Arc<dyn Fn(&str) -> Result<String, TtsError> + Send + Sync>;

/// What a speech monitor is opened with.
pub struct MonitorRequest {
    pub device: String,
    /// 0-100 percent.
    pub volume: u8,
    /// Devices the monitor must never be: the virtual microphone output.
    pub exclude: Vec<String>,
    /// The monitor reports a failure code (`monitor_output_error` and so on).
    pub on_error: Arc<dyn Fn(&str) + Send + Sync>,
    /// The monitor's device opened.
    pub on_ready: Arc<dyn Fn() + Send + Sync>,
}

pub type MonitorFactory = Arc<dyn Fn(MonitorRequest) -> Result<Arc<dyn Monitor>, TtsError> + Send + Sync>;

/// Receives a short fixed code (a failure or a monitor notice).
pub type Notice = Arc<dyn Fn(&str) + Send + Sync>;

/// `(event, first audible write in monotonic ns, spoken through the conversion, when this
/// message's synthesis was asked for in monotonic ns)`. The last one is taken when the worker
/// picks the message from the queue, before the engine is reached, so that the time from it to
/// the first write is the synthesis alone, without the wait in the queue.
pub type FirstAudioHook = Arc<dyn Fn(&SpeechMessageEvent, i64, bool, i64) + Send + Sync>;

/// Construction options. The defaults are the application's.
pub struct BusOptions {
    pub provider_factory: ProviderFactory,
    pub warm_up: WarmUp,
    /// Japanese from an installed engine. Without one, choosing an engine
    /// fails like an unknown engine does.
    pub engine_factory: Option<EngineFactory>,
    pub router: Arc<dyn SpeechRouter>,
    pub capacity: usize,
    pub max_age: Duration,
    pub request_timeout: Duration,
    pub resolve_server: Option<ResolveServer>,
    /// Speech starts disabled in the app; the user turns it on.
    pub enabled: bool,
    pub monitor_factory: Option<MonitorFactory>,
    pub on_monitor_error: Option<Notice>,
    /// Failure reports (`report_failure("tts", code)` in Python).
    pub on_failure: Option<Notice>,
    pub converted_router: Option<Arc<dyn ConvertedRouter>>,
    pub on_first_audio: Option<FirstAudioHook>,
}

impl BusOptions {
    /// Speech through `router`, from speech.cpp servers.
    pub fn new(router: Arc<dyn SpeechRouter>) -> Self {
        Self {
            provider_factory: Arc::new(|url: &str| -> Result<Box<dyn Synthesizer>, TtsError> { Ok(Box::new(SpeechCppTts::new(url)?)) }),
            warm_up: Arc::new(|url: &str, voice: &str, language: &str, token: &CancelToken| -> Result<(), TtsError> { Ok(SpeechCppTts::new(url)?.warm_up(voice, language, token)?) }),
            engine_factory: None,
            router,
            capacity: 4,
            max_age: Duration::from_secs(5),
            request_timeout: Duration::from_secs(30),
            resolve_server: None,
            enabled: true,
            monitor_factory: None,
            on_monitor_error: None,
            on_failure: None,
            converted_router: None,
            on_first_audio: None,
        }
    }
}

/// Counters and state for the UI. Never text, URLs or device names.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VoiceStatus {
    pub accepted: u64,
    pub completed: u64,
    /// Every message that was accepted or offered but not spoken.
    pub dropped: u64,
    /// Messages that waited past `max_age`. Also counted in `dropped`; the UI
    /// warns when it grows, because the user sees no other sign.
    pub expired: u64,
    pub duplicates: u64,
    pub cancelled: u64,
    pub errors: u64,
    pub last_error: Option<String>,
    pub last_first_write_ms: Option<f64>,
    pub sample_rate: Option<u32>,
    pub monitor_error: Option<String>,
    pub queued: usize,
    pub active: bool,
    pub mode: String,
    pub closed: bool,
    pub muted: bool,
    pub tts_enabled: bool,
    pub tts_generation: u64,
    pub tts_stopping: bool,
    /// Strictly increasing per status read, as a string (JavaScript-safe).
    pub observation_id: String,
}

#[derive(Default)]
struct Stats {
    accepted: u64,
    completed: u64,
    dropped: u64,
    expired: u64,
    duplicates: u64,
    cancelled: u64,
    errors: u64,
    last_error: Option<String>,
    last_first_write_ms: Option<f64>,
    sample_rate: Option<u32>,
    monitor_error: Option<String>,
}

struct Job {
    event: Arc<SpeechMessageEvent>,
    settings: Arc<VoiceSettings>,
    epoch: u64,
    /// [`Busy::total`] when the message was queued.
    busy_at_queue: i64,
}

/// How long the worker has spent on utterances, so that typed chat can leave out the time it
/// waited behind them (decision 61).
#[derive(Default)]
struct Busy {
    /// Nanoseconds of finished utterances.
    done: i64,
    /// When the utterance in progress was taken.
    since: Option<i64>,
}

impl Busy {
    fn total(&self, now: i64) -> i64 {
        self.done + self.since.map_or(0, |since| (now - since).max(0))
    }

    fn start(&mut self, now: i64) {
        self.since = Some(now);
    }

    fn end(&mut self, now: i64) {
        if let Some(since) = self.since.take() {
            self.done += (now - since).max(0);
        }
    }
}

type SeenKey = (Source, String);

struct State {
    settings: Arc<VoiceSettings>,
    queue: VecDeque<Job>,
    seen_order: VecDeque<(SeenKey, Instant)>,
    seen: HashSet<SeenKey>,
    worker: Option<Event>,
    active: Option<CancelToken>,
    active_source: Option<Source>,
    monitors: Vec<(Arc<dyn Monitor>, Source)>,
    closed: bool,
    muted: bool,
    tts_enabled: bool,
    observation_id: i64,
    epoch: u64,
    source_epochs: HashMap<Source, u64>,
    stats: Stats,
    busy: Busy,
    /// The [`VoiceEventBus::warm`] request under way, which speech that starts stops, and when
    /// the speech server last spoke or was readied.
    warming: Option<CancelToken>,
    ready_at: Option<Instant>,
}

struct Hooks {
    converted_router: Option<Arc<dyn ConvertedRouter>>,
    on_first_audio: Option<FirstAudioHook>,
    monitor_factory: Option<MonitorFactory>,
}

struct Inner {
    state: Mutex<State>,
    changed: Condvar,
    hooks: RwLock<Hooks>,
    provider_factory: ProviderFactory,
    warm_up: WarmUp,
    engine_factory: Option<EngineFactory>,
    router: Arc<dyn SpeechRouter>,
    capacity: usize,
    max_age: Duration,
    request_timeout: Duration,
    resolve_server: Option<ResolveServer>,
    on_monitor_error: Option<Notice>,
    on_failure: Option<Notice>,
}

/// Serializes final chat and opted-in microphone translations into speech.
pub struct VoiceEventBus {
    inner: Arc<Inner>,
}

impl Inner {
    fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.state)
    }

    /// Returns the monitors to silence once the state lock is released: a
    /// monitor may report from inside `close`, and its report takes the lock.
    #[must_use]
    fn cancel_locked(&self, state: &mut State) -> Silence {
        state.epoch += 1;
        state.stats.dropped += state.queue.len() as u64;
        state.queue.clear();
        if let Some(active) = &state.active {
            // Token closers only wake sockets and detach server watches.
            active.cancel();
        }
        self.changed.notify_all();
        Silence(state.monitors.iter().map(|(monitor, _)| monitor.clone()).collect())
    }
}

/// Monitors to close without draining, after the state lock is released.
struct Silence(Vec<Arc<dyn Monitor>>);

impl Silence {
    fn run(self) {
        for monitor in self.0 {
            monitor.close(false);
        }
    }
}

impl VoiceEventBus {
    pub fn new(settings: VoiceSettings, options: BusOptions) -> Self {
        Self {
            inner: Arc::new(Inner {
                state: Mutex::new(State {
                    settings: Arc::new(settings),
                    queue: VecDeque::new(),
                    seen_order: VecDeque::new(),
                    seen: HashSet::new(),
                    worker: None,
                    active: None,
                    active_source: None,
                    monitors: Vec::new(),
                    closed: false,
                    muted: false,
                    tts_enabled: options.enabled,
                    observation_id: 0,
                    epoch: 0,
                    source_epochs: HashMap::new(),
                    stats: Stats::default(),
                    busy: Busy::default(),
                    warming: None,
                    ready_at: None,
                }),
                changed: Condvar::new(),
                hooks: RwLock::new(Hooks { converted_router: options.converted_router, on_first_audio: options.on_first_audio, monitor_factory: options.monitor_factory }),
                provider_factory: options.provider_factory,
                warm_up: options.warm_up,
                engine_factory: options.engine_factory,
                router: options.router,
                capacity: options.capacity,
                max_age: options.max_age,
                request_timeout: options.request_timeout,
                resolve_server: options.resolve_server,
                on_monitor_error: options.on_monitor_error,
                on_failure: options.on_failure,
            }),
        }
    }

    /// Speech through the running voice conversion, when settings ask for it.
    pub fn set_converted_router(&self, router: Option<Arc<dyn ConvertedRouter>>) {
        self.inner.hooks.write().unwrap_or_else(|p| p.into_inner()).converted_router = router;
    }

    /// Called on the worker thread when a message becomes audible.
    pub fn set_on_first_audio(&self, hook: Option<FirstAudioHook>) {
        self.inner.hooks.write().unwrap_or_else(|p| p.into_inner()).on_first_audio = hook;
    }

    pub fn set_monitor_factory(&self, factory: Option<MonitorFactory>) {
        self.inner.hooks.write().unwrap_or_else(|p| p.into_inner()).monitor_factory = factory;
    }

    pub fn settings(&self) -> Arc<VoiceSettings> {
        self.inner.state().settings.clone()
    }

    /// Apply new settings. Cancels everything and clears the last errors.
    pub fn configure(&self, settings: VoiceSettings) {
        let silence = {
            let mut state = self.inner.state();
            state.settings = Arc::new(settings);
            let silence = self.inner.cancel_locked(&mut state);
            state.stats.last_error = None;
            state.stats.monitor_error = None;
            silence
        };
        silence.run();
    }

    /// Stop speaking and empty the queue.
    pub fn cancel(&self) {
        let silence = self.inner.cancel_locked(&mut self.inner.state());
        silence.run();
    }

    /// Turn speech on or off. Turning on fails while muted, after close, or
    /// when `expected_generation` is given and is no longer current. Turning
    /// off always cancels, even when already off, so it also revokes enables
    /// still on their way.
    pub fn set_enabled(&self, enabled: bool, expected_generation: Option<u64>) -> bool {
        let silence = {
            let mut state = self.inner.state();
            if state.closed || expected_generation.is_some_and(|generation| generation != state.epoch) {
                return false;
            }
            if enabled && state.muted {
                return false;
            }
            if enabled && state.tts_enabled {
                return true;
            }
            state.tts_enabled = enabled;
            // The same epoch invalidates pending finals, saves and late enables.
            self.inner.cancel_locked(&mut state)
        };
        silence.run();
        true
    }

    /// Mute or unmute. Both edges invalidate messages accepted before them.
    pub fn set_muted(&self, muted: bool) {
        let silence = {
            let mut state = self.inner.state();
            if state.muted == muted {
                return;
            }
            state.muted = muted;
            self.inner.cancel_locked(&mut state)
        };
        silence.run();
    }

    /// Cancel all output. The worker exits only after its monitors are
    /// released. Returns whether it exited within `timeout`.
    pub fn close(&self, timeout: Duration) -> bool {
        let (worker, silence) = {
            let mut state = self.inner.state();
            state.closed = true;
            let silence = self.inner.cancel_locked(&mut state);
            (state.worker.clone(), silence)
        };
        silence.run();
        worker.is_none_or(|finished| finished.wait(Some(timeout)))
    }

    pub fn generation(&self) -> u64 {
        self.inner.state().epoch
    }

    pub fn source_generation(&self, source: &Source) -> u64 {
        self.inner.state().source_epochs.get(source).copied().unwrap_or(0)
    }

    /// Cancel one source's queued, active and monitored speech.
    pub fn cancel_source(&self, source: &Source) {
        let silence = {
            let mut state = self.inner.state();
            *state.source_epochs.entry(source.clone()).or_insert(0) += 1;
            let before = state.queue.len();
            state.queue.retain(|job| job.event.source != *source);
            state.stats.dropped += (before - state.queue.len()) as u64;
            if state.active_source.as_ref() == Some(source) {
                if let Some(active) = &state.active {
                    active.cancel();
                }
            }
            self.inner.changed.notify_all();
            Silence(state.monitors.iter().filter(|(_, monitor_source)| monitor_source == source).map(|(monitor, _)| monitor.clone()).collect())
        };
        silence.run();
    }

    /// Offer a message. Returns whether it was queued.
    /// Readies the speech.cpp server that will speak a message of `source` in `language` while
    /// the message is still being translated (#556): between utterances the GPU falls to a power
    /// state with lower clocks, the next speech's first frames are made about twice as slowly,
    /// and a short synthesis during the translation's wait raises the clocks again. Sends one short request on a thread of its own
    /// and plays nothing; nothing when speech is off or muted for `source`, an installed engine
    /// speaks the language, speech is under way or queued, or the server spoke or was readied
    /// within [`WARM_FOR`]. Whether a request was sent.
    pub fn warm(&self, source: &Source, language: &str) -> bool {
        let token = CancelToken::new();
        let settings = {
            let mut state = self.inner.state();
            let ready = state.ready_at.is_some_and(|at| at.elapsed() < WARM_FOR);
            if state.closed || state.muted || !state.tts_enabled || state.warming.is_some() || ready || state.active.is_some() || !state.queue.is_empty() {
                return false;
            }
            state.warming = Some(token.clone());
            state.settings.clone()
        };
        let resolve = self.inner.resolve_server.clone();
        let resolver = resolve.as_ref().map(|resolve| &**resolve as &dyn Fn(&str) -> Result<String, TtsError>);
        let Some((url, voice, language)) = settings.speechcpp_target(source, language, resolver) else {
            finish_warm(&self.inner, &token, false);
            return false;
        };
        let inner = self.inner.clone();
        let running = token.clone();
        let spawned = thread::Builder::new().name("astarot-tts-warm".into()).spawn(move || {
            // A refusal or a server that is not there is left to the speech that follows to report.
            let done = catch_unwind(AssertUnwindSafe(|| (inner.warm_up)(&url, &voice, language, &running))).is_ok_and(|r| r.is_ok());
            finish_warm(&inner, &running, done);
        });
        if spawned.is_err() {
            finish_warm(&self.inner, &token, false);
            return false;
        }
        true
    }

    pub fn publish(&self, event: SpeechMessageEvent, expected_generation: Option<u64>, expected_source_generation: Option<u64>) -> bool {
        let mut state = self.inner.state();
        if expected_generation.is_some_and(|generation| generation != state.epoch) {
            return false;
        }
        if expected_source_generation.is_some_and(|generation| generation != state.source_epochs.get(&event.source).copied().unwrap_or(0)) {
            return false;
        }
        if state.closed || state.muted || !state.tts_enabled || !event.is_final {
            return false;
        }
        match event.source {
            Source::Chat => {
                if state.settings.mode == "off" {
                    return false;
                }
            }
            Source::Mic => {
                if state.settings.mic_mode != "translated" || event.translated_text.as_deref().is_none_or(is_blank) {
                    return false;
                }
                if event.timestamp_ns <= 0 || event.timestamp_ns > monotonic_ns() {
                    state.stats.dropped += 1;
                    return false;
                }
            }
            Source::Other(_) => return false,
        }
        if event.event_id.is_empty() || is_blank(&event.original_text) {
            return false;
        }
        let now = Instant::now();
        while state.seen_order.front().is_some_and(|(_, at)| *at + Duration::from_secs(120) < now) {
            let (key, _) = state.seen_order.pop_front().expect("checked above");
            state.seen.remove(&key);
        }
        let identity = event.utterance_id.clone().filter(|id| !id.is_empty()).unwrap_or_else(|| event.event_id.clone());
        let key = (event.source.clone(), identity);
        if state.seen.contains(&key) {
            state.stats.duplicates += 1;
            return false;
        }
        if state.queue.len() >= self.inner.capacity {
            let oldest_mic = state.queue.iter().position(|job| job.event.source == Source::Mic);
            if oldest_mic.is_none() && event.source == Source::Mic {
                state.stats.dropped += 1;
                return false;
            }
            state.queue.remove(oldest_mic.unwrap_or(0));
            state.stats.dropped += 1;
        }
        state.seen.insert(key.clone());
        state.seen_order.push_back((key, now));
        while state.seen_order.len() > 512 {
            let (key, _) = state.seen_order.pop_front().expect("longer than 512");
            state.seen.remove(&key);
        }
        let busy_at_queue = state.busy.total(monotonic_ns());
        let job = Job { event: Arc::new(event), settings: state.settings.clone(), epoch: state.epoch, busy_at_queue };
        state.queue.push_back(job);
        state.stats.accepted += 1;
        if state.worker.is_none() {
            let finished = Event::new();
            state.worker = Some(finished.clone());
            let inner = self.inner.clone();
            thread::Builder::new()
                .name("astarot".into())
                .spawn(move || {
                    // A panic outside one utterance must not leave a dead
                    // worker that close() waits for and publish() never replaces.
                    if catch_unwind(AssertUnwindSafe(|| work(&inner))).is_err() {
                        let mut state = inner.state();
                        state.worker = None;
                        state.busy.end(monotonic_ns());
                        state.active = None;
                        state.active_source = None;
                        inner.changed.notify_all();
                    }
                    finished.set();
                })
                .expect("spawn the speech worker");
        }
        self.inner.changed.notify_all();
        true
    }

    pub fn status(&self) -> VoiceStatus {
        let mut state = self.inner.state();
        state.observation_id = monotonic_ns().max(state.observation_id + 1);
        let stats = &state.stats;
        VoiceStatus {
            accepted: stats.accepted,
            completed: stats.completed,
            dropped: stats.dropped,
            expired: stats.expired,
            duplicates: stats.duplicates,
            cancelled: stats.cancelled,
            errors: stats.errors,
            last_error: stats.last_error.clone(),
            last_first_write_ms: stats.last_first_write_ms,
            sample_rate: stats.sample_rate,
            monitor_error: stats.monitor_error.clone(),
            queued: state.queue.len(),
            active: state.active.is_some(),
            mode: state.settings.mode.clone(),
            closed: state.closed,
            muted: state.muted,
            tts_enabled: state.tts_enabled,
            tts_generation: state.epoch,
            tts_stopping: !state.tts_enabled && (state.active.is_some() || !state.monitors.is_empty()),
            observation_id: state.observation_id.to_string(),
        }
    }

    /// Whether the worker thread has been started (it starts on the first accepted message).
    pub fn worker_started(&self) -> bool {
        self.inner.state().worker.is_some()
    }

    /// Speech monitors still owned (draining or releasing their device).
    pub fn monitor_count(&self) -> usize {
        self.inner.state().monitors.len()
    }
}

impl Drop for VoiceEventBus {
    fn drop(&mut self) {
        // Never leave speech playing for a bus nobody can stop.
        self.close(Duration::ZERO);
    }
}

/// Expire a token's start deadline once it has really passed.
///
/// A single timed wait is not enough: on Windows it can return a little
/// before the clock reaches the deadline (a 15.6 ms timer tick), and nothing
/// would retry.
pub(crate) struct StartExpiry {
    stopped: Event,
}

impl StartExpiry {
    pub(crate) fn start(token: CancelToken, deadline_ns: i64) -> Self {
        let stopped = Event::new();
        let flag = stopped.clone();
        thread::Builder::new()
            .name("astarot-start-expiry".into())
            .spawn(move || {
                run_start_expiry(deadline_ns, monotonic_ns, |remaining| flag.wait(Some(remaining)), || flag.is_set(), || token.expire_start());
            })
            .expect("spawn the start expiry");
        Self { stopped }
    }

    pub(crate) fn cancel(&self) {
        self.stopped.set();
    }
}

fn run_start_expiry(deadline_ns: i64, now: impl Fn() -> i64, mut wait: impl FnMut(Duration) -> bool, stopped: impl Fn() -> bool, expire: impl FnOnce()) {
    while !stopped() {
        let remaining = deadline_ns - now();
        if remaining <= 0 {
            expire();
            return;
        }
        wait(Duration::from_nanos(remaining as u64));
    }
}

/// Cancel one utterance's token with `request_timeout` after `timeout`.
/// The callback is bound to its own token, so a late one cannot touch the next.
struct RequestTimer {
    stopped: Event,
}

impl RequestTimer {
    fn start(token: CancelToken, timeout: Duration) -> Self {
        let stopped = Event::new();
        let flag = stopped.clone();
        thread::Builder::new()
            .name("astarot-request-timeout".into())
            .spawn(move || {
                if !flag.wait(Some(timeout)) {
                    token.cancel_with("request_timeout");
                }
            })
            .expect("spawn the request timer");
        Self { stopped }
    }

    fn cancel(&self) {
        self.stopped.set();
    }
}

/// Open the optional speech monitor. A monitor problem is a notice, never a
/// speech error.
fn open_monitor(inner: &Arc<Inner>, settings: &VoiceSettings, epoch: u64) -> Option<Arc<dyn Monitor>> {
    let (device, volume) = settings.monitor_choice()?;
    let factory = inner.hooks.read().unwrap_or_else(|p| p.into_inner()).monitor_factory.clone()?;
    let weak: Weak<Inner> = Arc::downgrade(inner);
    let failed: Notice = Arc::new(move |code: &str| {
        if let Some(inner) = weak.upgrade() {
            {
                let mut state = inner.state();
                if state.epoch == epoch {
                    state.stats.monitor_error = Some(code.to_owned());
                }
            }
            if let Some(report) = &inner.on_monitor_error {
                report(code);
            }
        }
    });
    let weak: Weak<Inner> = Arc::downgrade(inner);
    let ready: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
        if let Some(inner) = weak.upgrade() {
            let mut state = inner.state();
            if state.epoch == epoch {
                state.stats.monitor_error = None;
            }
        }
    });
    let request = MonitorRequest { device: device.to_owned(), volume, exclude: vec![settings.playback_device().to_owned()], on_error: failed.clone(), on_ready: ready };
    match catch_unwind(AssertUnwindSafe(|| factory(request))) {
        Ok(Ok(monitor)) => Some(monitor),
        _ => {
            failed("monitor_output_error");
            None
        }
    }
}

/// Ends the warm-up `token` stops: only its own, as speech may have stopped it and another may
/// have started since. `ready` when the server spoke it.
fn finish_warm(inner: &Inner, token: &CancelToken, ready: bool) {
    let mut state = inner.state();
    if state.warming.as_ref().is_some_and(|warming| warming.same(token)) {
        state.warming = None;
    }
    if ready {
        state.ready_at = Some(Instant::now());
    }
}

fn next_job(inner: &Arc<Inner>) -> Option<(Job, CancelToken, Option<i64>)> {
    let mut state = inner.state();
    loop {
        loop {
            // Keep ownership through drain and device close. Poll only while
            // monitors remain; reaping never paces the next utterance.
            state.monitors.retain(|(monitor, _)| !monitor.join(Duration::ZERO));
            if state.closed && state.monitors.is_empty() {
                return None;
            }
            if !state.closed && !state.queue.is_empty() {
                break;
            }
            state = if state.monitors.is_empty() {
                inner.changed.wait(state).unwrap_or_else(|p| p.into_inner())
            } else {
                inner.changed.wait_timeout(state, Duration::from_millis(50)).unwrap_or_else(|p| p.into_inner()).0
            };
        }
        let next = state.queue.iter().position(|job| job.event.source == Source::Chat).unwrap_or(0);
        let job = state.queue.remove(next).expect("the queue is not empty");
        let max_age_ns = inner.max_age.as_nanos() as i64;
        let now = monotonic_ns();
        // Chat leaves out the time it waited behind earlier utterances (decision 61).
        let behind = if job.event.source == Source::Chat { state.busy.total(now) - job.busy_at_queue } else { 0 };
        if now - job.event.timestamp_ns - behind > max_age_ns {
            state.stats.dropped += 1;
            state.stats.expired += 1;
            continue;
        }
        let deadline = (job.event.source == Source::Mic).then(|| job.event.timestamp_ns + max_age_ns);
        let token = CancelToken::with_start_deadline(deadline);
        // Speech that starts stops a warm-up still under way, so that it does not wait behind it.
        if let Some(warming) = state.warming.take() {
            warming.cancel();
        }
        state.busy.start(now);
        state.active = Some(token.clone());
        state.active_source = Some(job.event.source.clone());
        return Some((job, token, deadline));
    }
}

fn work(inner: &Arc<Inner>) {
    while let Some((job, token, deadline)) = next_job(inner) {
        let start_expiry = deadline.map(|deadline| StartExpiry::start(token.clone(), deadline));
        let timer = RequestTimer::start(token.clone(), inner.request_timeout);
        let mut first_write: Option<(i64, u32)> = None;
        let mut monitor: Option<Arc<dyn Monitor>> = None;
        let result = catch_unwind(AssertUnwindSafe(|| speak(inner, &job, &token, &mut first_write, &mut monitor))).unwrap_or(Err(TtsError::Output));
        let outcome = match &result {
            Ok(()) => {
                let mut state = inner.state();
                state.stats.completed += 1;
                if job.epoch == state.epoch {
                    state.stats.last_error = None;
                }
                "completed"
            }
            Err(error) => {
                let mut failure = None;
                let outcome = {
                    let mut state = inner.state();
                    if token.is_set() && token.reason() == "cancelled" {
                        state.stats.cancelled += 1;
                        "cancelled"
                    } else {
                        state.stats.errors += 1;
                        // Settings and driver errors can include input content or
                        // device paths; only fixed codes go into status.
                        let code = if token.is_set() { token.reason() } else { error.failure_code().to_owned() };
                        if job.epoch == state.epoch {
                            state.stats.last_error = Some(code.clone());
                        }
                        failure = Some(code);
                        "error"
                    }
                };
                if let (Some(code), Some(report)) = (&failure, &inner.on_failure) {
                    report(code);
                }
                outcome
            }
        };
        if let Some(monitor) = &monitor {
            monitor.close(outcome == "completed"); // Idempotent; never waits.
        }
        timer.cancel();
        if let Some(expiry) = &start_expiry {
            expiry.cancel();
        }
        write_voice_trace(&job.event.event_id, job.event.timestamp_ns, first_write, outcome);
        let mut state = inner.state();
        state.busy.end(monotonic_ns());
        state.active = None;
        state.active_source = None;
        state.ready_at = Some(Instant::now());
        inner.changed.notify_all();
    }
}

fn speak(inner: &Arc<Inner>, job: &Job, token: &CancelToken, first_write: &mut Option<(i64, u32)>, monitor_slot: &mut Option<Arc<dyn Monitor>>) -> Result<(), TtsError> {
    let synthesis_started = monotonic_ns();
    let event = &job.event;
    let settings = &job.settings;
    let resolve = inner.resolve_server.clone();
    let resolver = resolve.as_ref().map(|resolve| &**resolve as &dyn Fn(&str) -> Result<String, TtsError>);
    let request = settings.request_for(event, resolver)?;
    let provider = if request.engine == SPEECHCPP {
        (inner.provider_factory)(&request.url)?
    } else {
        let factory = inner.engine_factory.as_ref().ok_or(TtsError::Unavailable("Unknown speech engine"))?;
        factory(request.engine, &request.url)?
    };
    let options = settings.options_for(request.language)?;
    let frames = provider.synthesize_stream(&request, token, &options)?;
    // speech.cpp's models put near-silence before the voice; it is heard as a wait (#556). The
    // installed engines keep the silence their own settings put there.
    let frames = if request.engine == SPEECHCPP { crate::onset::skip_leading_silence(frames) } else { frames };
    let (converted_router, on_first_audio) = {
        let hooks = inner.hooks.read().unwrap_or_else(|p| p.into_inner());
        (hooks.converted_router.clone(), hooks.on_first_audio.clone())
    };
    let converted_router = converted_router.filter(|router| settings.conversion == "on" && router.available());
    let converted = converted_router.is_some();
    let mut first_audio = |timestamp: i64, rate: u32| -> Result<(), SpeechError> {
        *first_write = Some((timestamp, rate));
        {
            let mut state = inner.state();
            state.stats.last_first_write_ms = Some(((timestamp - event.timestamp_ns) as f64 / 1e3).round() / 1e3);
            state.stats.sample_rate = Some(rate);
        }
        if let Some(hook) = &on_first_audio {
            // The flow panel: when this message became audible, and by which
            // path. A readout never stops speech.
            let _ = catch_unwind(AssertUnwindSafe(|| hook(event, timestamp, converted, synthesis_started)));
        }
        Ok(())
    };
    let device = settings.playback_device();
    if let Some(router) = converted_router {
        // Through the conversion, its own monitor plays the converted voice.
        router.play(frames, device, token, &mut first_audio, None)?;
    } else {
        let monitor = open_monitor(inner, settings, job.epoch);
        if let Some(monitor) = &monitor {
            let raced = {
                let mut state = inner.state();
                state.monitors.push((monitor.clone(), event.source.clone()));
                token.is_set() || job.epoch != state.epoch
            };
            // Stop may have raced the factory before registration.
            if raced {
                monitor.close(false);
            }
        }
        *monitor_slot = monitor.clone();
        inner.router.play(frames, device, token, &mut first_audio, monitor)?;
    }
    token.check()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::run_start_expiry;
    use std::cell::{Cell, RefCell};
    use std::time::Duration;

    #[test]
    fn start_expiry_waits_again_when_the_timer_wakes_early() {
        // Windows timed waits can return up to a timer tick before the deadline.
        let clock = Cell::new(0i64);
        let waits = RefCell::new(Vec::new());
        let expired = Cell::new(0);
        run_start_expiry(
            1_000_000_000,
            || clock.get(),
            |remaining| {
                waits.borrow_mut().push(remaining);
                let early = if waits.borrow().len() == 1 { 15_600_000 } else { 0 };
                clock.set(clock.get() + remaining.as_nanos() as i64 - early);
                false
            },
            || false,
            || {
                assert!(clock.get() >= 1_000_000_000, "expired before the deadline");
                expired.set(expired.get() + 1);
            },
        );
        assert_eq!(expired.get(), 1);
        assert_eq!(waits.borrow().len(), 2, "the early wake was waited out");
        assert_eq!(waits.borrow()[1], Duration::from_nanos(15_600_000));
    }

    #[test]
    fn start_expiry_cancel_stops_without_expiring() {
        let token = crate::CancelToken::new();
        let expiry = super::StartExpiry::start(token.clone(), crate::clock::monotonic_ns() + 30_000_000_000);
        expiry.cancel();
        std::thread::sleep(Duration::from_millis(20));
        assert!(!token.is_set());
    }
}
