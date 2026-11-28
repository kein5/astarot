//! Usage events to ASTAROT's own receiver (`src-python/models/telemetry/`).
//!
//! Two events are sent, and only these:
//!
//! - `app_started`: at start, at most once a day.
//! - `error`: when an error occurs, at most once a day per error code.
//!
//! Each carries the time (ISO 8601, UTC), the app's version, the OS and its version, the display
//! language and the PC's hardware, nothing else ([`client`]). [`Telemetry::preview`] shows the
//! user what is sent; the latest sent events are kept in the state file. Nothing is sent while
//! the user has it off. The first send comes only after the user has seen the notice: the caller
//! guarantees that by when it calls [`Telemetry::init`].
//!
//! Sending never blocks the caller and never fails it: hardware probing and posting run on
//! threads of their own, and a failure is only an event that was not sent.

pub mod client;
pub mod hardware;
pub mod state;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use client::{build_event, system_properties, IngestClient};
use hardware::Hardware;
use state::TelemetryState;

use crate::json::{Json, Object};

/// How long an error waits for the start's preparation (hardware and `app_started`).
pub const START_WAIT: Duration = Duration::from_secs(30);
/// How long [`Telemetry::shutdown`] waits for sends in flight before leaving them behind.
pub const STOP_WAIT: Duration = Duration::from_secs(5);

/// This PC's hardware, or `None` when it cannot be read.
pub type HardwareSource = Arc<dyn Fn() -> Option<Hardware> + Send + Sync>;

#[derive(Default)]
struct Ready {
    set: Mutex<bool>,
    changed: Condvar,
}

impl Ready {
    fn set(&self) {
        *self.set.lock().unwrap() = true;
        self.changed.notify_all();
    }

    /// Waits until set, stopped or `timeout`.
    fn wait(&self, stop: &AtomicBool, timeout: Duration) {
        let guard = self.set.lock().unwrap();
        let _ = self.changed.wait_timeout_while(guard, timeout, |set| !*set && !stop.load(Ordering::SeqCst)).unwrap();
    }
}

/// One period between `init` and `shutdown`. Its tasks never act once it is stopped.
struct Session {
    stop: AtomicBool,
    ready: Ready,
    tasks: Mutex<Vec<JoinHandle<()>>>,
}

impl Session {
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    fn halt(&self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake errors waiting for the start.
        let _guard = self.ready.set.lock().unwrap();
        self.ready.changed.notify_all();
    }
}

struct Lifecycle {
    init_called: bool,
    session: Option<Arc<Session>>,
}

struct Shared {
    state: TelemetryState,
    client: Mutex<IngestClient>,
    lifecycle: Mutex<Lifecycle>,
    hardware: Mutex<Option<HardwareSource>>,
}

/// The telemetry of one app. Every method is safe to call from any thread and returns at once
/// (except [`shutdown`](Self::shutdown), which waits up to [`STOP_WAIT`]).
#[derive(Clone)]
pub struct Telemetry {
    shared: Arc<Shared>,
}

impl Default for Telemetry {
    fn default() -> Self {
        Self::new(IngestClient::new())
    }
}

impl Telemetry {
    pub fn new(client: IngestClient) -> Self {
        Telemetry {
            shared: Arc::new(Shared {
                state: TelemetryState::new(None),
                client: Mutex::new(client),
                lifecycle: Mutex::new(Lifecycle { init_called: false, session: None }),
                hardware: Mutex::new(None),
            }),
        }
    }

    /// Where this PC's hardware comes from; without one, events carry no `hw`. The app passes
    /// [`hardware::cached`] over the bundled speech.cpp.
    pub fn set_hardware_source(&self, source: HardwareSource) {
        *self.shared.hardware.lock().unwrap() = Some(source);
    }

    pub fn state(&self) -> &TelemetryState {
        &self.shared.state
    }

    /// Starts telemetry (idempotent: a second call only sets whether it is on).
    ///
    /// Only when `enabled`, `app_started` is sent (unless it already was today), after the
    /// hardware is read, on a thread of its own. `storage_path` is the daily record;
    /// `locale` is the display language ("ja"), sent as its tag ("ja-JP").
    pub fn init(&self, enabled: bool, app_version: &str, storage_path: Option<&Path>, locale: &str) {
        let shared = &self.shared;
        let mut lifecycle = shared.lifecycle.lock().unwrap();
        if let Some(path) = storage_path {
            shared.state.set_storage_path(path);
        }
        if lifecycle.init_called {
            shared.state.set_enabled(enabled);
            return;
        }
        lifecycle.init_called = true;
        if enabled {
            shared.client.lock().unwrap().prepare();
            let session = Arc::new(Session { stop: AtomicBool::new(false), ready: Ready::default(), tasks: Mutex::new(Vec::new()) });
            lifecycle.session = Some(session.clone());
            // Queued before sending is enabled: any error comes after it.
            let (task_shared, task_session) = (shared.clone(), session.clone());
            let (version, locale) = (app_version.to_string(), locale.to_string());
            spawn(&session, "telemetry-start", move || {
                start_task(&task_shared, &task_session, &version, &locale);
            });
        }
        shared.state.set_enabled(enabled);
    }

    /// Sends an `error` event with this fixed code, unless sending is off or this code was
    /// already sent today. The day is recorded before sending, so a burst sends one event; an
    /// error that cannot be sent (no session) is not recorded, so it can still go out today.
    pub fn track_error(&self, error_code: &str) {
        let shared = &self.shared;
        if !shared.state.is_enabled() || error_code.is_empty() || !shared.state.should_send_error_today(error_code) {
            return;
        }
        let session = shared.lifecycle.lock().unwrap().session.clone();
        let Some(session) = session.filter(|s| !s.stopped()) else { return };
        shared.state.mark_error_sent_today(error_code);
        let (task_shared, task_session, code) = (shared.clone(), session.clone(), error_code.to_string());
        spawn(&session, "telemetry-error", move || {
            task_session.ready.wait(&task_session.stop, START_WAIT);
            send_event(&task_shared, &task_session, "error", Some(&code));
        });
    }

    /// What would be sent from this PC now, and what was sent before:
    /// `{endpoint, app_started, sent}`. Built by the call that builds what is sent; only the
    /// timestamp differs. Answers before `init` and while sending is off, and sends nothing.
    pub fn preview(&self, app_version: &str, locale: &str) -> Json {
        let hardware = self.hardware();
        let endpoint = self.shared.client.lock().unwrap().endpoint();
        let event = build_event("app_started", &system_properties(app_version, locale, hardware.as_ref()), None, None);
        let sent = self.shared.state.sent().iter().map(|r| r.to_json()).collect::<Vec<_>>();
        Object::new().with("endpoint", endpoint).with("app_started", event.unwrap_or(Json::Null)).with("sent", sent).into()
    }

    /// Stops sending: nothing more goes out, and an error after this is neither sent nor
    /// counted as sent. Waits up to [`STOP_WAIT`] for sends in flight; a send still in flight
    /// then is not recorded.
    pub fn shutdown(&self) {
        let shared = &self.shared;
        let mut lifecycle = shared.lifecycle.lock().unwrap();
        if shared.state.is_enabled() {
            shared.client.lock().unwrap().stop();
        }
        if let Some(session) = lifecycle.session.take() {
            session.halt();
            let deadline = Instant::now() + STOP_WAIT;
            let tasks = std::mem::take(&mut *session.tasks.lock().unwrap());
            for task in tasks {
                while !task.is_finished() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(5));
                }
                if task.is_finished() {
                    let _ = task.join();
                }
            }
        }
        shared.state.set_enabled(false);
        lifecycle.init_called = false;
    }

    pub fn is_enabled(&self) -> bool {
        self.shared.state.is_enabled()
    }

    /// `{enabled, storage_path, last_app_started_date, errors_sent}`.
    pub fn debug_state(&self) -> Json {
        self.shared.state.debug_info()
    }

    /// Waits until nothing is left to send, at most `timeout`. `true` if settled.
    pub fn settle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            let session = self.shared.lifecycle.lock().unwrap().session.clone();
            let busy = session.is_some_and(|s| s.tasks.lock().unwrap().iter().any(|t| !t.is_finished()));
            if !busy {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn hardware(&self) -> Option<Hardware> {
        let source = self.shared.hardware.lock().unwrap().clone()?;
        source()
    }
}

fn spawn(session: &Session, name: &str, task: impl FnOnce() + Send + 'static) {
    let mut tasks = session.tasks.lock().unwrap();
    tasks.retain(|t| !t.is_finished());
    if let Ok(handle) = thread::Builder::new().name(name.into()).spawn(task) {
        tasks.push(handle);
    }
}

fn start_task(shared: &Arc<Shared>, session: &Arc<Session>, app_version: &str, locale: &str) {
    let hardware = Telemetry { shared: shared.clone() }.hardware();
    if !session.stopped() {
        shared.client.lock().unwrap().start(app_version, locale, hardware.as_ref());
        // Marked as sent once tried, accepted or not, as the Python module did.
        if !session.stopped() && shared.state.should_send_app_started_today() && send_event(shared, session, "app_started", None) {
            shared.state.mark_app_started_sent_today();
        }
    }
    session.ready.set();
}

/// Posts one event and records it. `false` if the session stopped meanwhile (as a cancelled
/// Python task, it then neither records nor marks anything).
fn send_event(shared: &Shared, session: &Session, name: &str, error_code: Option<&str>) -> bool {
    if session.stopped() {
        return false;
    }
    // Built under the lock, posted outside it: a slow receiver never holds the client.
    let (body, sender) = {
        let client = shared.client.lock().unwrap();
        (client.event(name, error_code), client.sender())
    };
    let (Some(body), Some(sender)) = (body, sender) else { return true };
    let accepted = sender.post(&body);
    if session.stopped() {
        return false;
    }
    // What left this PC stays readable on this PC (the settings show it).
    if let Json::Object(body) = &body {
        shared.state.record_sent(body, accepted);
    }
    true
}

#[cfg(test)]
mod tests;
