//! Requests from the UI: the queue, the locks and the workers (`Main` in `src-python/mainloop.py`).
//!
//! The rules (`docs/spec/ipc-protocol.md`, "並行性とロック"):
//!
//! - Requests wait in one queue served by three workers. Requests that share a lock run in the
//!   order they arrived, each answered before the next starts; requests under different locks may
//!   run at the same time.
//! - Every endpoint has a lock. `/set/enable/x` and `/set/disable/x` share one, and so do a few
//!   groups (typing, one provider's credentials, the OBS and WebSocket servers).
//! - A request whose lock is busy stays at the head of its lock's line without holding a worker.
//!   If it waits about 20 s it is answered 423 without running.
//! - Before start-up ends, endpoints marked "wait" answer 423 inside; the request is tried again
//!   every 0.1 s, still at the head of its line, and after 300 tries (about 30 s) answered 423.
//! - The stop requests of the voice features skip the queue, and `/run/feed_watchdog` has its own
//!   thread, so that busy workers delay neither.

use crate::protocol::{Incoming, Reply, Request, parse_line};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const DEFAULT_WORKER_COUNT: usize = 3;
pub const LOCK_BUSY_RETRY_INTERVAL: Duration = Duration::from_millis(50);
pub const LOCK_BUSY_MAX_RETRIES: u32 = 400;
pub const ENDPOINT_LOCKED_RETRY_INTERVAL: Duration = Duration::from_millis(100);
pub const ENDPOINT_LOCKED_MAX_RETRIES: u32 = 300;
pub const WATCHDOG_FEED_ENDPOINT: &str = "/run/feed_watchdog";

/// Answered as they arrive: they only signal workers, and must not wait behind a busy one.
pub const IMMEDIATE_ENDPOINTS: [&str; 7] = [
    "/run/stop_voice",
    "/run/disable_tts",
    "/run/mute_voice",
    "/run/resume_voice",
    "/run/stop_direct_voice",
    "/run/stop_realtime_asr",
    "/run/stop_speech_server",
];

pub type Handler = Arc<dyn Fn(&Value) -> Reply + Send + Sync>;

/// One endpoint: its handler, and whether it waits for start-up to end.
#[derive(Clone)]
pub struct Route {
    pub wait_for_init: bool,
    pub handler: Handler,
}

/// The endpoints, in the order they were added (the order of `mapping` in Python).
#[derive(Clone, Default)]
pub struct Routes {
    order: Vec<String>,
    routes: HashMap<String, Route>,
}

impl Routes {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds an endpoint. Adding one twice is a programming error.
    pub fn add(&mut self, endpoint: &str, wait_for_init: bool, handler: impl Fn(&Value) -> Reply + Send + Sync + 'static) {
        assert!(!self.routes.contains_key(endpoint), "{endpoint} is routed twice");
        self.order.push(endpoint.to_string());
        self.routes.insert(endpoint.to_string(), Route { wait_for_init, handler: Arc::new(handler) });
    }

    pub fn get(&self, endpoint: &str) -> Option<&Route> {
        self.routes.get(endpoint)
    }

    pub fn endpoints(&self) -> impl Iterator<Item = &str> {
        self.order.iter().map(String::as_str)
    }

    pub fn contains(&self, endpoint: &str) -> bool {
        self.routes.contains_key(endpoint)
    }

    pub fn len(&self) -> usize {
        self.order.len()
    }

    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }
}

/// The lock an endpoint runs under.
pub fn canonical_lock_key(endpoint: &str) -> String {
    if endpoint == "/run/typing_message_box" || endpoint == "/run/stop_typing_message_box" {
        return "/lock/typing_message_box".into();
    }
    for provider in [
        "deepl", "plamo", "gemini", "openai", "groq", "openrouter", "openai_compatible",
        "groq_whisper", "openai_whisper", "custom_whisper", "deepgram",
    ] {
        let credential = endpoint == format!("/set/data/{provider}_auth_key")
            || endpoint == format!("/delete/data/{provider}_auth_key")
            || endpoint == format!("/set/data/selected_{provider}_model");
        let url = matches!(provider, "openai_compatible" | "custom_whisper")
            && (endpoint == format!("/set/data/{provider}_url") || endpoint == format!("/set/data/{provider}_auth_key_and_url"));
        if credential || url {
            return format!("/lock/credential/{provider}");
        }
    }
    if [
        "/set/enable/websocket_server", "/set/disable/websocket_server",
        "/set/enable/obs_browser_source", "/set/disable/obs_browser_source",
        "/set/data/websocket_host", "/set/data/websocket_port",
        "/set/data/obs_browser_source_port", "/set/data/websocket_tls",
        "/run/regenerate_websocket_auth_token",
    ]
    .contains(&endpoint)
    {
        return "/lock/obs_websocket_lifecycle".into();
    }
    if let Some(name) = endpoint.strip_prefix("/set/enable/").or_else(|| endpoint.strip_prefix("/set/disable/")) {
        return format!("/lock/set/{name}");
    }
    endpoint.to_string()
}

/// What the VR panel may ask for (`src-python/models/vr_panel_policy.py`, SEC-02 and SEC-07).
pub const VR_PANEL_ORIGIN: &str = "vr_panel";

pub fn vr_panel_endpoints() -> HashSet<String> {
    let toggle = |name: &str| [format!("/set/enable/{name}"), format!("/set/disable/{name}")];
    let mut set: HashSet<String> = [
        "/run/vr_panel_windows", "/run/vr_panel_recall_log", "/run/vr_panel_layout_rendered", "/run/vr_panel_tooltip",
        "/set/data/overlay_vr_panel_anchor", "/set/data/overlay_vr_panel_opacity", "/set/data/overlay_vr_panel_font_size",
        "/set/data/selected_tab_no", "/set/data/selected_your_languages", "/set/data/selected_target_languages",
        "/set/data/selected_translation_engines", "/run/swap_your_language_and_target_language",
        "/get/data/selected_tab_no", "/get/data/selected_your_languages", "/get/data/selected_target_languages",
        "/get/data/selected_translation_engines", "/get/data/selectable_translation_engines",
        "/set/data/selected_mic_host", "/set/data/selected_mic_device_id", "/set/data/selected_speaker_device_id",
        "/set/data/mic_threshold", "/set/data/speaker_threshold",
        "/set/data/selected_ctranslate2_weight_type", "/set/data/selected_translation_compute_device",
        "/set/data/selected_translation_compute_type", "/set/data/selected_transcription_engine",
        "/set/data/ocr_source_language", "/set/data/ocr_min_confidence", "/set/data/ocr_poll_interval_ms",
        "/set/data/ocr_bubble_min_text_length", "/set/data/overlay_vr_launcher_hand",
        "/set/data/ui_language", "/set/data/font_family",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    for name in [
        "overlay_vr_panel_locked", "translation", "transcription_send", "transcription_receive", "ocr_capture",
        "mic_automatic_threshold", "speaker_automatic_threshold", "auto_mic_select", "auto_speaker_select",
        "check_mic_threshold", "check_speaker_threshold", "convert_message_to_hiragana", "convert_message_to_romaji",
        "vrc_mic_mute_sync", "overlay_small_log", "overlay_large_log", "overlay_show_only_translated_messages",
        "overlay_vr_launcher_auto_hide", "overlay_vr_tooltip",
    ] {
        set.extend(toggle(name));
    }
    set
}

/// Where answers go, one line each, and the log of what came and went.
pub trait Output: Send + Sync {
    fn answer(&self, status: u16, endpoint: Option<&str>, result: &Value);
    fn received(&self, endpoint: &str, data: &Value);
    fn note(&self, text: &str);
}

/// Changes a request's data before it waits in the queue: generation stamps that a later stop
/// can invalidate (`_voice_generation`, `_realtime_generation`, `_direct_generation`).
pub type Stamp = Arc<dyn Fn(&str, &mut Value) + Send + Sync>;

struct Pending {
    endpoint: Option<String>,
    data: Value,
    attempt: u32,
    ready_at: Instant,
    busy_until: Option<Instant>,
}

struct QueueState {
    pending: VecDeque<Pending>,
    busy: HashSet<String>,
    unfinished: usize,
}

/// The receiver, the workers and the watchdog feed thread.
pub struct Dispatcher {
    routes: Routes,
    initialized: AtomicBool,
    stopping: AtomicBool,
    output: Arc<dyn Output>,
    stamp: Option<Stamp>,
    vr_panel: HashSet<String>,
    lock_keys: HashSet<String>,
    queue: Mutex<QueueState>,
    ready: Condvar,
    idle: Condvar,
    feed: Mutex<Option<mpsc::Sender<Value>>>,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

impl Dispatcher {
    pub fn new(routes: Routes, output: Arc<dyn Output>, stamp: Option<Stamp>) -> Arc<Self> {
        let lock_keys = routes.endpoints().map(canonical_lock_key).collect();
        Arc::new(Self {
            routes,
            initialized: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            output,
            stamp,
            vr_panel: vr_panel_endpoints(),
            lock_keys,
            queue: Mutex::new(QueueState { pending: VecDeque::new(), busy: HashSet::new(), unfinished: 0 }),
            ready: Condvar::new(),
            idle: Condvar::new(),
            feed: Mutex::new(None),
            threads: Mutex::new(Vec::new()),
        })
    }

    pub fn routes(&self) -> &Routes {
        &self.routes
    }

    /// Starts the workers and the watchdog feed thread.
    pub fn start(self: &Arc<Self>, workers: usize) {
        let mut threads = self.threads.lock().unwrap();
        for index in 0..workers.max(1) {
            let this = Arc::clone(self);
            threads.push(
                std::thread::Builder::new()
                    .name(format!("main_handler_{index}"))
                    .spawn(move || this.worker())
                    .expect("a worker thread starts"),
            );
        }
        let (sender, receiver) = mpsc::channel::<Value>();
        *self.feed.lock().unwrap() = Some(sender);
        let this = Arc::clone(self);
        threads.push(
            std::thread::Builder::new()
                .name("main_watchdog_feed".into())
                .spawn(move || {
                    while let Ok(data) = receiver.recv() {
                        let reply = this.call(Some(WATCHDOG_FEED_ENDPOINT), &data);
                        this.output.answer(reply.status, Some(WATCHDOG_FEED_ENDPOINT), &reply.result);
                    }
                })
                .expect("the feed thread starts"),
        );
    }

    /// Start-up has ended: every endpoint is open from now on.
    pub fn open(&self) {
        self.initialized.store(true, Ordering::SeqCst);
        self.ready.notify_all();
    }

    pub fn is_open(&self) -> bool {
        self.initialized.load(Ordering::SeqCst)
    }

    /// Handles one line from the UI (`Main.receiver`, one iteration).
    pub fn receive_line(&self, line: &str) {
        match parse_line(line) {
            Incoming::Nothing => {}
            Incoming::Malformed => self.output.note("A request line could not be read"),
            Incoming::Request(request) => self.receive(request),
        }
    }

    pub fn receive(&self, request: Request) {
        let Request { endpoint, mut data, origin } = request;
        if let Some(origin) = origin {
            let allowed = origin.as_str() == Some(VR_PANEL_ORIGIN) && endpoint.as_deref().is_some_and(|e| self.vr_panel.contains(e));
            if !allowed {
                self.output.note("Refused a request relayed for the VR panel");
                self.output.answer(403, endpoint.as_deref(), &json!({ "error_code": "vr_panel_request_refused" }));
                return;
            }
        }
        if let Some(name) = endpoint.as_deref() {
            if !crate::log::is_quiet_poll(name, 200) {
                self.output.received(name, &data);
            }
            if name == WATCHDOG_FEED_ENDPOINT {
                if let Some(sender) = self.feed.lock().unwrap().as_ref() {
                    let _ = sender.send(data);
                }
                return;
            }
            if IMMEDIATE_ENDPOINTS.contains(&name) {
                let reply = self.call(Some(name), &data);
                self.output.answer(reply.status, Some(name), &reply.result);
                return;
            }
            if let Some(stamp) = &self.stamp {
                stamp(name, &mut data);
            }
        }
        self.enqueue(endpoint, data);
    }

    fn enqueue(&self, endpoint: Option<String>, data: Value) {
        let mut queue = self.queue.lock().unwrap();
        queue.pending.push_back(Pending { endpoint, data, attempt: 0, ready_at: Instant::now(), busy_until: None });
        queue.unfinished += 1;
        self.ready.notify_all();
    }

    fn lock_key(&self, endpoint: Option<&str>) -> Option<String> {
        let key = canonical_lock_key(endpoint?);
        self.lock_keys.contains(&key).then_some(key)
    }

    /// Runs a handler: 404 for an unknown endpoint, 423 while it waits for start-up, 500 for a panic.
    pub fn call(&self, endpoint: Option<&str>, data: &Value) -> Reply {
        let Some(route) = endpoint.and_then(|e| self.routes.get(e)) else {
            return Reply::status(404, "Invalid endpoint");
        };
        if route.wait_for_init && !self.is_open() {
            return Reply::status(423, "Locked endpoint");
        }
        let handler = Arc::clone(&route.handler);
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handler(data))) {
            Ok(reply) => reply,
            Err(_) => {
                self.output.note("A request handler failed");
                Reply::status(500, "Internal error")
            }
        }
    }

    /// Takes the first request that can run now (`_EndpointQueue.get_ready`).
    fn next(&self, timeout: Duration) -> Option<(Pending, Option<String>, bool)> {
        let deadline = Instant::now() + timeout;
        let mut queue = self.queue.lock().unwrap();
        loop {
            if self.stopping.load(Ordering::SeqCst) {
                return None;
            }
            let now = Instant::now();
            let mut wake_at = deadline;
            let mut seen = HashSet::new();
            let mut chosen = None;
            for index in 0..queue.pending.len() {
                let key = self.lock_key(queue.pending[index].endpoint.as_deref());
                let seen_key = key.clone().unwrap_or_else(|| format!("\0{index}"));
                if !seen.insert(seen_key) {
                    continue;
                }
                let attempt = queue.pending[index].attempt;
                if queue.pending[index].ready_at > now {
                    wake_at = wake_at.min(queue.pending[index].ready_at);
                    continue;
                }
                match &key {
                    None => {
                        chosen = Some((index, None, false));
                        break;
                    }
                    Some(key) if !queue.busy.contains(key) => {
                        queue.busy.insert(key.clone());
                        chosen = Some((index, Some(key.clone()), false));
                        break;
                    }
                    Some(_) => {
                        let busy_until = *queue.pending[index].busy_until.get_or_insert_with(|| {
                            now + LOCK_BUSY_RETRY_INTERVAL * LOCK_BUSY_MAX_RETRIES.saturating_sub(attempt)
                        });
                        if now >= busy_until {
                            chosen = Some((index, None, true));
                            break;
                        }
                        wake_at = wake_at.min(busy_until);
                    }
                }
            }
            if let Some((index, lock, busy)) = chosen {
                let request = queue.pending.remove(index).expect("the index is in the queue");
                return Some((request, lock, busy));
            }
            let remaining = wake_at.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return None;
            }
            queue = self.ready.wait_timeout(queue, remaining).unwrap().0;
        }
    }

    /// Answered, or put back at the head of its line to be tried again (`_EndpointQueue.finish`).
    fn finish(&self, mut request: Pending, lock: Option<String>, retry: bool) {
        let mut queue = self.queue.lock().unwrap();
        if retry {
            request.attempt += 1;
            request.ready_at = Instant::now() + ENDPOINT_LOCKED_RETRY_INTERVAL;
            request.busy_until = None;
            queue.pending.push_front(request);
        }
        if let Some(lock) = lock {
            queue.busy.remove(&lock);
        }
        if !retry {
            queue.unfinished -= 1;
            if queue.unfinished == 0 {
                self.idle.notify_all();
            }
        }
        self.ready.notify_all();
    }

    fn worker(&self) {
        while !self.stopping.load(Ordering::SeqCst) {
            let Some((request, lock, busy)) = self.next(Duration::from_millis(500)) else {
                continue;
            };
            let endpoint = request.endpoint.clone();
            let reply = if busy {
                self.output.note("A request waited too long for its lock; answering 423");
                Reply::status(423, "Locked endpoint (busy)")
            } else {
                self.call(endpoint.as_deref(), &request.data)
            };
            if reply.status == 423 && !busy && request.attempt < ENDPOINT_LOCKED_MAX_RETRIES {
                self.finish(request, lock, true);
                continue;
            }
            let result = request_error_result(endpoint.as_deref(), &request.data, reply.result, reply.status);
            self.output.answer(reply.status, endpoint.as_deref(), &result);
            self.finish(request, lock, false);
        }
    }

    /// Waits until every queued request has been answered, or the time is up.
    pub fn wait_idle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut queue = self.queue.lock().unwrap();
        while queue.unfinished > 0 {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            queue = self.idle.wait_timeout(queue, remaining).unwrap().0;
        }
        true
    }

    /// Stops the threads; requests still queued are not answered.
    pub fn stop(&self, wait: Duration) {
        self.stopping.store(true, Ordering::SeqCst);
        self.feed.lock().unwrap().take();
        self.ready.notify_all();
        let deadline = Instant::now() + wait;
        let threads: Vec<_> = self.threads.lock().unwrap().drain(..).collect();
        for thread in threads {
            if thread.thread().id() == std::thread::current().id() {
                continue;
            }
            while !thread.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            if thread.is_finished() {
                let _ = thread.join();
            }
        }
    }
}

/// A failed legacy weight download names the weight, without echoing the request
/// (`_request_error_result`).
fn request_error_result(endpoint: Option<&str>, data: &Value, result: Value, status: u16) -> Value {
    if !matches!(status, 404 | 423 | 500) || endpoint != Some("/run/download_ctranslate2_weight") {
        return result;
    }
    let weight_type = match data {
        Value::Object(object) => object.get("weight_type").cloned(),
        other => Some(other.clone()),
    };
    let Some(Value::String(weight_type)) = weight_type else {
        return result;
    };
    let mut payload = match result {
        Value::Object(object) => object,
        other => {
            let mut map = serde_json::Map::new();
            map.insert("message".into(), other);
            map
        }
    };
    payload.insert("data".into(), json!({ "weight_type": weight_type }));
    Value::Object(payload)
}
