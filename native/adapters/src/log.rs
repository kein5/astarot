//! Where this crate's few log lines go.
//!
//! A line is always a fixed `&'static str`: the type keeps text, translations, tokens,
//! paths and file contents out of the log. The application installs a sink; without
//! one, lines are dropped.

use std::sync::{Arc, OnceLock, RwLock};

type Sink = Arc<dyn Fn(&'static str) + Send + Sync>;

fn slot() -> &'static RwLock<Option<Sink>> {
    static SLOT: OnceLock<RwLock<Option<Sink>>> = OnceLock::new();
    SLOT.get_or_init(|| RwLock::new(None))
}

/// Send every later line to `sink` (replacing an earlier one).
pub fn set_sink(sink: impl Fn(&'static str) + Send + Sync + 'static) {
    *slot().write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(sink));
}

/// Drop every later line.
pub fn clear_sink() {
    *slot().write().unwrap_or_else(|e| e.into_inner()) = None;
}

pub(crate) fn line(message: &'static str) {
    let sink = slot().read().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(sink) = sink {
        sink(message);
    }
}
