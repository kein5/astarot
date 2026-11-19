//! Captions and finals of a session (`realtime_delivery.py`): every update is shown as it
//! comes; a final is processed (translation, chatbox, logs) on a second thread, at most four
//! waiting, and its caption row is settled once with an outcome. A final not processed within
//! 2 seconds of its receipt, or one whose session or admission ended, is not delivered.

use super::events::Update;
use super::session::Session;
use crate::diagnostics::{Event, Stage};
use serde_json::{Value, json};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

const FINAL_WINDOW: Duration = Duration::from_secs(2);
const FINALS: usize = 4;

/// Publishes a caption payload; false when it was not shown.
pub type Publish = Arc<dyn Fn(Value) -> bool + Send + Sync>;
/// Processes a final while `current` holds; `Ok(None)` when it was filtered, `Ok(Some)` the
/// pipeline's result, `Err` a failure.
pub type Process = Arc<dyn Fn(&Update, Current) -> Result<Option<Value>, ()> + Send + Sync>;
/// Whether a final may still be delivered (its session, its admission and its 2 seconds).
pub type Current = Arc<dyn Fn() -> bool + Send + Sync>;

/// What an update was admitted with (`admit`): where it is shown, how a final is processed,
/// and whether the admission still holds.
#[derive(Clone)]
pub struct Admission {
    pub publish: Publish,
    pub process: Process,
    pub admitted: Arc<dyn Fn() -> bool + Send + Sync>,
}

/// A process-wide monotonic clock in nanoseconds, for `expires_ns`.
pub fn monotonic_ns(at: Instant) -> u64 {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    let start = *START.get_or_init(|| Instant::now() - Duration::from_secs(1));
    at.saturating_duration_since(start).as_nanos() as u64
}

struct Pending {
    update: Update,
    deadline: Instant,
    admission: Admission,
    shown: bool,
}

struct Inner {
    session: Session,
    admit: Arc<dyn Fn(&Update) -> Admission + Send + Sync>,
    on_error: Arc<dyn Fn(&str) + Send + Sync>,
    on_stopped: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    stop: AtomicBool,
    finals: Mutex<VecDeque<String>>,
    queued: Condvar,
    pending: Mutex<HashMap<String, Pending>>,
    terminal: Mutex<VecDeque<String>>,
    done: Mutex<usize>,
    finished: Condvar,
}

#[derive(Clone)]
pub struct Delivery {
    inner: Arc<Inner>,
}

fn payload(update: &Update) -> Value {
    let received = update.received.unwrap_or_else(Instant::now);
    json!({
        "source": update.source,
        "namespace": update.namespace,
        "item_id": update.item_id,
        "revision": update.revision,
        "state": update.state,
        "text": update.text,
        "translations": [],
        "expires_ns": monotonic_ns(received) + 2_000_000_000,
        "speakers": update.speakers,
    })
}

impl Delivery {
    pub fn new(
        session: Session,
        admit: Arc<dyn Fn(&Update) -> Admission + Send + Sync>,
        on_error: Arc<dyn Fn(&str) + Send + Sync>,
        on_stopped: Box<dyn FnOnce() + Send>,
    ) -> Delivery {
        Delivery {
            inner: Arc::new(Inner {
                session,
                admit,
                on_error,
                on_stopped: Mutex::new(Some(on_stopped)),
                stop: AtomicBool::new(false),
                finals: Mutex::new(VecDeque::new()),
                queued: Condvar::new(),
                pending: Mutex::new(HashMap::new()),
                terminal: Mutex::new(VecDeque::new()),
                done: Mutex::new(0),
                finished: Condvar::new(),
            }),
        }
    }

    pub fn start(&self) -> Result<(), &'static str> {
        let reader = self.clone();
        std::thread::Builder::new()
            .name("realtime-captions".into())
            .spawn(move || reader.read())
            .map_err(|_| "realtime_start_failed")?;
        let translator = self.clone();
        std::thread::Builder::new()
            .name("realtime-finals".into())
            .spawn(move || translator.translate())
            .map_err(|_| "realtime_start_failed")?;
        Ok(())
    }

    pub fn request_stop(&self) {
        self.inner.stop.store(true, Ordering::SeqCst);
        self.inner.queued.notify_all();
        self.inner.session.request_stop();
    }

    /// Stops and waits up to `timeout` for both threads.
    pub fn close(&self, timeout: Duration) -> bool {
        self.request_stop();
        let deadline = Instant::now() + timeout;
        let mut done = self.inner.done.lock().unwrap_or_else(|e| e.into_inner());
        while *done < 2 {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            done = self.inner.finished.wait_timeout(done, left).unwrap_or_else(|e| e.into_inner()).0;
        }
        true
    }

    fn stopping(&self) -> bool {
        self.inner.stop.load(Ordering::SeqCst)
    }

    fn current(&self, update: &Update) -> bool {
        !self.stopping() && self.inner.session.is_current(&update.namespace)
    }

    fn reason(&self, update: &Update, deadline: Instant, admission: &Admission) -> Option<&'static str> {
        if !self.current(update) || !(admission.admitted)() {
            return Some("revoked");
        }
        if Instant::now() >= deadline {
            return Some("expired");
        }
        None
    }

    fn report(&self, code: &str, terminal: bool) {
        if terminal {
            self.request_stop();
        }
        (self.inner.on_error)(code);
    }

    /// `_settle`: the outcome of a final, told once on its caption row.
    fn settle(&self, update: &Update, outcome: &'static str, reason: Option<&str>, result: Option<Value>) {
        let Some(pending) = self.inner.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&update.item_id) else {
            return;
        };
        let chatbox_off = outcome == "delivered" && reason == Some("vrchat_off");
        let (mut outcome, mut reason, mut result) = (outcome, reason.map(str::to_string), result);
        if let Some(invalid) = self.reason(update, pending.deadline, &pending.admission) {
            outcome = "not_delivered";
            reason = Some(invalid.to_string());
            result = None;
        }
        let mut shown = pending.shown;
        if let Some(result) = result {
            let mut translated = payload(update);
            translated["state"] = json!("translated");
            translated["revision"] = json!(update.revision + 1);
            translated["original"] = result["original"].clone();
            translated["translations"] = result["translations"].clone();
            shown = (pending.admission.publish)(translated) || shown;
        }
        if let Some(invalid) = self.reason(update, pending.deadline, &pending.admission)
            && outcome == "delivered"
        {
            outcome = "not_delivered";
            reason = Some(invalid.to_string());
        }
        if chatbox_off && outcome == "delivered" {
            reason = Some("vrchat_off".into());
        }
        if shown {
            (pending.admission.publish)(json!({
                "source": update.source,
                "namespace": update.namespace,
                "item_id": update.item_id,
                "revision": update.revision + 2,
                "state": "outcome",
                "outcome": outcome,
                "reason": reason,
            }));
        }
    }

    fn settle_invalid(&self) {
        let items: Vec<Update> =
            self.inner.pending.lock().unwrap_or_else(|e| e.into_inner()).values().map(|p| p.update.clone()).collect();
        for update in items {
            let reason = {
                let pending = self.inner.pending.lock().unwrap_or_else(|e| e.into_inner());
                let Some(item) = pending.get(&update.item_id) else { continue };
                let (deadline, admission) = (item.deadline, item.admission.clone());
                drop(pending);
                self.reason(&update, deadline, &admission)
            };
            if let Some(reason) = reason {
                self.settle(&update, "not_delivered", Some(reason), None);
            }
        }
    }

    fn finish(&self) {
        *self.inner.done.lock().unwrap_or_else(|e| e.into_inner()) += 1;
        self.inner.finished.notify_all();
    }

    fn read(&self) {
        while !self.stopping() {
            self.settle_invalid();
            let Some(update) = self.inner.session.pop_update(Duration::from_millis(50)) else {
                if matches!(self.inner.session.state(), "failed" | "closed" | "stopping") {
                    self.request_stop();
                }
                continue;
            };
            if !self.current(&update) || self.inner.terminal.lock().unwrap_or_else(|e| e.into_inner()).contains(&update.item_id) {
                continue;
            }
            let received = update.received.unwrap_or_else(Instant::now);
            let deadline = received + FINAL_WINDOW;
            let expired = Instant::now() >= deadline;
            let empty_final = update.is_final && update.text.trim().is_empty();
            let mut shown_payload = payload(&update);
            if expired || empty_final {
                shown_payload["state"] = json!("discarded");
                shown_payload["text"] = json!("");
            }
            if update.is_final || update.state == "discarded" || expired {
                let mut terminal = self.inner.terminal.lock().unwrap_or_else(|e| e.into_inner());
                terminal.push_back(update.item_id.clone());
                if terminal.len() > 256 {
                    terminal.pop_front();
                }
            }
            let admission = (self.inner.admit)(&update);
            let shown = (admission.publish)(shown_payload);
            if update.is_final && !expired && !empty_final {
                self.inner.pending.lock().unwrap_or_else(|e| e.into_inner()).insert(
                    update.item_id.clone(),
                    Pending { update: update.clone(), deadline, admission: admission.clone(), shown },
                );
                if let Some(reason) = self.reason(&update, deadline, &admission) {
                    self.settle(&update, "not_delivered", Some(reason), None);
                    continue;
                }
                let mut finals = self.inner.finals.lock().unwrap_or_else(|e| e.into_inner());
                if finals.len() >= FINALS {
                    drop(finals);
                    self.settle(&update, "failed", Some("queue_full"), None);
                    self.report("realtime_final_queue_full", true);
                    continue;
                }
                finals.push_back(update.item_id.clone());
                drop(finals);
                self.inner.queued.notify_all();
            }
        }
        self.settle_invalid();
        if let Some(stopped) = self.inner.on_stopped.lock().unwrap_or_else(|e| e.into_inner()).take() {
            stopped();
        }
        self.finish();
    }

    fn translate(&self) {
        loop {
            let item = {
                let mut finals = self.inner.finals.lock().unwrap_or_else(|e| e.into_inner());
                while finals.is_empty() && !self.stopping() {
                    finals = self.inner.queued.wait_timeout(finals, Duration::from_millis(50)).unwrap_or_else(|e| e.into_inner()).0;
                }
                if self.stopping() {
                    break;
                }
                finals.pop_front()
            };
            let Some(item) = item else { continue };
            let Some((update, deadline, admission)) = self
                .inner
                .pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(&item)
                .map(|p| (p.update.clone(), p.deadline, p.admission.clone()))
            else {
                continue;
            };
            let delivery = self.clone();
            let (guarded, still_admitted) = (update.clone(), admission.admitted.clone());
            let current: Current =
                Arc::new(move || delivery.current(&guarded) && (still_admitted)() && Instant::now() < deadline);
            let received = update.received.unwrap_or_else(Instant::now);
            let queue_ms = received.elapsed().as_secs_f64() * 1000.0;
            if let Some(diagnostics) = self.inner.session.diagnostics() {
                diagnostics.record(
                    update.source,
                    Event::RealtimeDelivery,
                    &[(Stage::RealtimeQueue, queue_ms)],
                    Some(format!("[ASR-queue][{}] realtime wait={queue_ms:.1}ms", update.source)),
                    false,
                );
            }
            if !current() {
                self.settle(&update, "not_delivered", None, None);
                continue;
            }
            self.process(&update, &admission, current);
            if let Some(diagnostics) = self.inner.session.diagnostics() {
                let total_ms = received.elapsed().as_secs_f64() * 1000.0;
                diagnostics.record(
                    update.source,
                    Event::RealtimeProcessed,
                    &[(Stage::RealtimeTotal, total_ms)],
                    Some(format!("[latency][{}] realtime delivery={total_ms:.1}ms queue={queue_ms:.1}ms", update.source)),
                    false,
                );
            }
        }
        if let Some(diagnostics) = self.inner.session.diagnostics() {
            diagnostics.flush(Some(self.inner.session.source().as_str()), "stop");
        }
        self.finish();
    }

    /// Runs the message pipeline on a final and settles its caption with the outcome.
    fn process(&self, update: &Update, admission: &Admission, current: Current) {
        match (admission.process)(update, current.clone()) {
            Ok(None) => self.settle(update, "not_delivered", Some("filtered"), None),
            Ok(Some(result)) => {
                let outcome = match result["delivery_outcome"].as_str() {
                    Some("failed") => "failed",
                    Some("not_delivered") => "not_delivered",
                    _ => "delivered",
                };
                let reason = result["delivery_reason"].as_str().map(str::to_string);
                let result = (outcome != "failed").then_some(result);
                self.settle(update, outcome, reason.as_deref(), result);
            }
            Err(()) => {
                self.settle(update, "failed", Some("processing_failed"), None);
                if current() {
                    self.report("realtime_final_failed", false);
                }
            }
        }
    }
}
