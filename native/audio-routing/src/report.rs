//! Where diagnostics go.
//!
//! The Python backend writes `printLog` lines, `errorLogging` tracebacks and
//! `report_error_code` telemetry. Here the host application supplies a [`Reporter`];
//! the crate only ever passes it fixed messages and error codes, never device
//! payloads, text or audio.

use std::sync::{Arc, OnceLock, RwLock};

pub trait Reporter: Send + Sync {
    /// A diagnostic line (`printLog`).
    fn log(&self, message: &str);
    /// An unexpected failure, by code (`errorLogging`).
    fn error(&self, code: &str) {
        self.log(code);
    }
    /// A telemetry error code (`report_error_code`).
    fn report_error_code(&self, code: &str) {
        let _ = code;
    }
    /// A user-visible feature failed (`report_failure`): feature and code only.
    fn report_failure(&self, feature: &str, code: &str) {
        let _ = (feature, code);
    }
}

/// Writes log lines to standard error.
#[derive(Debug, Default)]
pub struct StderrReporter;

impl Reporter for StderrReporter {
    fn log(&self, message: &str) {
        eprintln!("{message}");
    }
}

fn slot() -> &'static RwLock<Arc<dyn Reporter>> {
    static SLOT: OnceLock<RwLock<Arc<dyn Reporter>>> = OnceLock::new();
    SLOT.get_or_init(|| RwLock::new(Arc::new(StderrReporter)))
}

/// Replace the process-wide reporter.
pub fn set_reporter(reporter: Arc<dyn Reporter>) {
    *slot().write().unwrap_or_else(|e| e.into_inner()) = reporter;
}

/// The process-wide reporter.
pub fn reporter() -> Arc<dyn Reporter> {
    slot().read().unwrap_or_else(|e| e.into_inner()).clone()
}
