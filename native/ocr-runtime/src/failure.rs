//! Bounded diagnostics for repeated OCR failures, and the per-stage retry schedule
//! (`ocr_failure.py`).
//!
//! A failure streak logs the first occurrence in full, then at most one summary a minute,
//! and one line on recovery. Only the error's kind and message are kept, never frames.

use std::sync::Arc;

/// Seconds between summaries of a repeating failure.
pub const FAILURE_SUMMARY_INTERVAL_SEC: f64 = 60.0;

/// Where diagnostics go. `error` stands for Python's `errorLogging()` (a traceback),
/// `info` for `printLog`. Neither ever receives recognised text or pixels.
pub trait Log: Send + Sync {
    fn error(&self, message: &str);
    fn info(&self, message: &str);
}

/// Writes to standard error.
pub struct StderrLog;

impl Log for StderrLog {
    fn error(&self, message: &str) {
        eprintln!("{message}");
    }
    fn info(&self, message: &str) {
        eprintln!("{message}");
    }
}

/// Seconds on a monotonic clock. Tests use a fake one.
pub trait Clock: Send + Sync {
    fn now(&self) -> f64;
}

pub struct MonotonicClock {
    start: std::time::Instant,
}

impl Default for MonotonicClock {
    fn default() -> Self {
        MonotonicClock { start: std::time::Instant::now() }
    }
}

impl Clock for MonotonicClock {
    fn now(&self) -> f64 {
        // Offset so that 0.0 keeps meaning "never" for the timestamps derived from it.
        1000.0 + self.start.elapsed().as_secs_f64()
    }
}

/// An error as the failure log keeps it: its kind (Python's exception type) and message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub kind: String,
    pub message: String,
}

impl Failure {
    pub fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Failure { kind: kind.into(), message: message.into() }
    }
}

impl From<&crate::Error> for Failure {
    fn from(error: &crate::Error) -> Self {
        let kind = match error {
            crate::Error::Io(_) => "OSError",
            crate::Error::Format { .. } => "FormatError",
            crate::Error::Unsupported { .. } => "UnsupportedError",
            crate::Error::Invalid(_) => "ValueError",
            crate::Error::Backend(_) => "BackendError",
            crate::Error::ModelsMissing(_) => "OcrModelsMissing",
            crate::Error::ModelsInvalid(_) => "OcrModelsInvalid",
            crate::Error::Capture(_) => "CaptureError",
        };
        Failure::new(kind, error.to_string())
    }
}

/// One operation's failure streak (`OcrFailureLog`).
pub struct FailureLog {
    origin: String,
    log: Arc<dyn Log>,
    clock: Arc<dyn Clock>,
    kind: Option<Failure>,
    count: u64,
    suppressed: u64,
    last_report: f64,
}

impl FailureLog {
    pub fn new(origin: impl Into<String>, log: Arc<dyn Log>, clock: Arc<dyn Clock>) -> Self {
        FailureLog { origin: origin.into(), log, clock, kind: None, count: 0, suppressed: 0, last_report: 0.0 }
    }

    pub fn reset(&mut self) {
        self.kind = None;
        self.count = 0;
        self.suppressed = 0;
        self.last_report = 0.0;
    }

    /// A failure stays unresolved until the owner sees a success.
    pub fn active(&self) -> bool {
        self.kind.is_some()
    }

    pub fn failure(&mut self, failure: &Failure) {
        let now = self.clock.now();
        if self.kind.as_ref() != Some(failure) {
            self.kind = Some(failure.clone());
            self.count = 1;
            self.suppressed = 0;
            self.last_report = now;
            self.log.error(&format!("{}: {}: {}", self.origin, failure.kind, failure.message));
            return;
        }
        self.count += 1;
        self.suppressed += 1;
        self.report(now);
    }

    pub fn report(&mut self, now: f64) {
        if self.suppressed > 0 && now - self.last_report >= FAILURE_SUMMARY_INTERVAL_SEC {
            let kind = self.kind.as_ref().map(|k| k.kind.as_str()).unwrap_or("?");
            self.log.info(&format!("{}: suppressed {} repeated failures in {:.0}s ({}, total={})", self.origin, self.suppressed, now - self.last_report, kind, self.count));
            self.suppressed = 0;
            self.last_report = now;
        }
    }

    pub fn success(&mut self) {
        if self.kind.is_some() {
            self.log.info(&format!("{}: recovered after {} failures ({} repeats since last summary)", self.origin, self.count, self.suppressed));
            self.reset();
        }
    }
}

/// One stage's retry schedule: 1, 2, 4 … 30 seconds (`OcrRetry`).
pub struct Retry {
    pub log: FailureLog,
    pub delay: f64,
    pub retry_at: f64,
}

impl Retry {
    pub fn new(log: FailureLog) -> Self {
        Retry { log, delay: 0.0, retry_at: 0.0 }
    }

    pub fn reset(&mut self) {
        self.delay = 0.0;
        self.retry_at = 0.0;
        self.log.reset();
    }

    /// `failure` is `None` when a capture wrapper already logged it.
    pub fn failure(&mut self, failure: Option<&Failure>) {
        if let Some(failure) = failure {
            self.log.failure(failure);
        }
        self.delay = (self.delay * 2.0).clamp(1.0, 30.0);
        self.retry_at = self.log.clock.now() + self.delay;
    }

    pub fn success(&mut self) {
        self.log.success();
        self.delay = 0.0;
        self.retry_at = 0.0;
    }
}

/// `readtext_bgr`: a read that never fails. A failure is logged (boundedly) and gives
/// no words; a success ends the streak. The pipeline uses the failing variant instead.
pub fn read_or_empty<T>(read: impl FnOnce() -> Result<Vec<T>, Failure>, log: &mut FailureLog) -> Vec<T> {
    match read() {
        Ok(words) => {
            log.success();
            words
        }
        Err(failure) => {
            log.failure(&failure);
            Vec::new()
        }
    }
}
