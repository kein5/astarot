//! One run of the backend: start-up, the requests, and the end (`mainloop.py`).
//!
//! [`Backend::start`] reads the settings, starts the workers and runs the start-up sequence on
//! its own thread; endpoints marked "wait" answer 423 inside until it ends. Lines from the UI go
//! to [`Backend::write_line`]; answers and notifications come out through the [`Sink`]. The run
//! ends when the watchdog is not fed, when the UI's input closes, or when the host stops it;
//! the sink then hears the exit code, as the UI heard a sidecar process end.

use crate::config::{Config, Environment};
use crate::controller::{self, Core, Services};
use crate::dispatch::{self, Dispatcher, Output};
use crate::log::Log;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// The exit code of a run whose start-up stopped on an internal error (a panic, or no thread to
/// run it on). It is the code a Rust program that panics ends with, so the UI can name it.
pub const STARTUP_FAILED_EXIT: i32 = 101;
/// The exit code of a run whose start-up did not end within [`Options::startup_limit`].
pub const STARTUP_TIMEOUT_EXIT: i32 = 124;
/// How long the start-up may take before the run is ended and the UI told. The engines are
/// checked at the same time, each with its own network timeout, so this is far beyond a slow
/// start; it is there for a start-up that hangs, so the UI does not say "starting" for ever.
pub const STARTUP_LIMIT: Duration = Duration::from_secs(180);

/// Where the backend's lines and its end go.
#[derive(Clone)]
pub struct Sink {
    /// One answer or notification, as one line of JSON.
    pub line: Arc<dyn Fn(String) + Send + Sync>,
    /// The run ended, with the code a process would have ended with.
    pub exit: Arc<dyn Fn(i32) + Send + Sync>,
}

pub struct Options {
    pub env: Environment,
    pub workers: usize,
    /// The watchdog's timeout and check interval; `None` runs without it.
    pub watchdog: Option<(Duration, Duration)>,
    /// How long a graceful stop may take before the run is ended anyway.
    pub grace: Duration,
    /// How long the start-up may take before the run ends with [`STARTUP_TIMEOUT_EXIT`];
    /// `None` waits for it however long it takes.
    pub startup_limit: Option<Duration>,
    /// Write `process.log` and `error.log` under the settings folder.
    pub logs: bool,
    pub services: Services,
}

impl Options {
    pub fn new(env: Environment) -> Self {
        Self {
            env,
            workers: dispatch::DEFAULT_WORKER_COUNT,
            watchdog: Some((vrct_ops::watchdog::TIMEOUT, vrct_ops::watchdog::INTERVAL)),
            grace: Duration::from_secs(30),
            startup_limit: Some(STARTUP_LIMIT),
            logs: true,
            services: Services::default(),
        }
    }
}

struct LineOutput {
    sink: Sink,
    log: Arc<Log>,
}

impl Output for LineOutput {
    fn answer(&self, status: u16, endpoint: Option<&str>, result: &Value) {
        self.log.response(status, endpoint, result);
        (self.sink.line)(crate::protocol::response_line(status, endpoint, result));
    }

    fn received(&self, endpoint: &str, data: &Value) {
        let mut record = serde_json::Map::new();
        record.insert("receive_data".into(), data.clone());
        self.log.step(endpoint, Some(&Value::Object(record)));
    }

    fn note(&self, text: &str) {
        self.log.step(text, None);
    }
}

struct Inner {
    core: Arc<Core>,
    dispatcher: Arc<Dispatcher>,
    sink: Sink,
    grace: Duration,
    ending: AtomicBool,
    exit_code: Mutex<Option<i32>>,
    exited: Condvar,
    /// The start-up ended and the endpoints opened. Set and read under its lock together with
    /// `ending`, so a start-up that ends at its deadline either opens or is stopped, not both.
    started: Mutex<bool>,
    started_changed: Condvar,
}

/// A running backend.
#[derive(Clone)]
pub struct Backend {
    inner: Arc<Inner>,
}

impl Backend {
    pub fn start(options: Options, sink: Sink) -> Backend {
        let log = Arc::new(if options.logs { Log::new(&options.env.state_dir.join("logs")) } else { Log::disabled() });
        log.step("Start Initialization", None);
        let config = Config::open(options.env.clone());
        let output = Arc::new(LineOutput { sink: sink.clone(), log: Arc::clone(&log) });
        let core = Core::new(config, Arc::clone(&log), output.clone(), options.services);
        let routes = controller::routes(&core);
        let stamp_core = Arc::clone(&core);
        let stamp: dispatch::Stamp = Arc::new(move |endpoint, data| stamp_core.stamp(endpoint, data));
        let dispatcher = Dispatcher::new(routes, output, Some(stamp));
        dispatcher.start(options.workers);
        let inner = Arc::new(Inner {
            core: Arc::clone(&core),
            dispatcher: Arc::clone(&dispatcher),
            sink,
            grace: options.grace,
            ending: AtomicBool::new(false),
            exit_code: Mutex::new(None),
            exited: Condvar::new(),
            started: Mutex::new(false),
            started_changed: Condvar::new(),
        });
        let backend = Backend { inner };
        if let Some((timeout, interval)) = options.watchdog {
            let weak = Arc::downgrade(&backend.inner);
            core.start_watchdog(timeout, interval, Arc::new(move || {
                if let Some(inner) = weak.upgrade() {
                    Backend { inner }.escalate("The UI stopped feeding the watchdog; stopping");
                }
            }));
        }
        let starter = backend.clone();
        let spawned = std::thread::Builder::new().name("backend_init".into()).spawn(move || starter.run_startup());
        if spawned.is_err() {
            backend.startup_failed("The start-up thread could not be started");
            return backend;
        }
        if let Some(limit) = options.startup_limit {
            let watcher = backend.clone();
            // Without this thread a start-up that hangs is not ended, as before.
            let _ = std::thread::Builder::new().name("backend_init_deadline".into()).spawn(move || watcher.watch_startup(limit));
        }
        backend
    }

    /// The start-up sequence, then the endpoints open. A panic in it ends the run with
    /// [`STARTUP_FAILED_EXIT`], so the UI shows why it cannot start instead of "starting" for
    /// ever. Only a fixed line is logged: a panic's message may quote what the user said.
    fn run_startup(&self) {
        let core = &self.inner.core;
        if std::panic::catch_unwind(AssertUnwindSafe(|| core.init(&self.inner.dispatcher))).is_err() {
            self.startup_failed("The start-up stopped on an internal error");
            return;
        }
        {
            let mut started = self.inner.started.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if self.inner.ending.load(Ordering::SeqCst) {
                // Stopped meanwhile, or past its deadline: the endpoints stay closed.
                return;
            }
            *started = true;
            self.inner.started_changed.notify_all();
        }
        self.inner.dispatcher.open();
        if std::panic::catch_unwind(AssertUnwindSafe(|| core.after_init())).is_err() {
            core.log().error("The work after the start-up stopped on an internal error");
        }
    }

    fn startup_failed(&self, why: &str) {
        self.inner.core.log().error(why);
        self.finish(STARTUP_FAILED_EXIT, true);
    }

    /// Ends the run when the start-up has not ended after `limit`.
    fn watch_startup(&self, limit: Duration) {
        let started = self.inner.started.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let (started, _) = self.inner.started_changed
            .wait_timeout_while(started, limit, |started| !*started && !self.inner.ending.load(Ordering::SeqCst))
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *started || self.inner.ending.swap(true, Ordering::SeqCst) {
            return;
        }
        drop(started);
        self.inner.core.log().error("The start-up did not end in time; stopping");
        self.finish(STARTUP_TIMEOUT_EXIT, true);
    }

    pub fn core(&self) -> &Arc<Core> {
        &self.inner.core
    }

    pub fn dispatcher(&self) -> &Arc<Dispatcher> {
        &self.inner.dispatcher
    }

    /// One line from the UI.
    pub fn write_line(&self, line: &str) {
        if self.inner.ending.load(Ordering::SeqCst) {
            return;
        }
        self.inner.dispatcher.receive_line(line);
    }

    /// The UI's input closed: stop as the watchdog would, without waiting for it. Nothing is
    /// done if a stop was already asked for.
    pub fn close_input(&self) {
        if self.inner.core.shutdown_requested() {
            return;
        }
        self.escalate("The UI input closed; stopping");
    }

    /// Stops the run now, as when the host ends the process.
    pub fn kill(&self) {
        self.finish(-1, true);
    }

    /// The graceful stop with a hard deadline (`escalateShutdown`), once.
    pub fn escalate(&self, why: &str) {
        if self.inner.ending.swap(true, Ordering::SeqCst) {
            return;
        }
        self.inner.core.log().step(why, None);
        let deadline = self.clone();
        let grace = self.inner.grace;
        std::thread::spawn(move || {
            std::thread::sleep(grace);
            deadline.finish(1, false);
        });
        let graceful = self.clone();
        std::thread::spawn(move || {
            graceful.inner.core.shutdown();
            graceful.finish(0, false);
        });
    }

    fn finish(&self, code: i32, stop_core: bool) {
        {
            let mut exit = self.inner.exit_code.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if exit.is_some() {
                return;
            }
            *exit = Some(code);
        }
        self.inner.ending.store(true, Ordering::SeqCst);
        if stop_core {
            let core = Arc::clone(&self.inner.core);
            std::thread::spawn(move || core.shutdown());
        }
        // A start-up that panicked may leave a lock poisoned; the UI must still hear the end.
        let closed = std::panic::catch_unwind(AssertUnwindSafe(|| {
            self.inner.dispatcher.stop(Duration::from_secs(2));
            self.inner.core.close();
        }));
        if closed.is_err() {
            self.inner.core.log().error("The run could not be closed cleanly");
        }
        (self.inner.sink.exit)(code);
        self.inner.exited.notify_all();
    }

    /// The exit code once the run has ended.
    pub fn wait(&self, timeout: Duration) -> Option<i32> {
        let exit = self.inner.exit_code.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let (exit, _) = self.inner.exited.wait_timeout_while(exit, timeout, |code| code.is_none())
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *exit
    }
}
