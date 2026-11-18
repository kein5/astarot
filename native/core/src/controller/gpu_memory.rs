//! `/get/data/gpu_memory`: the GPUs' memory for the flow panel (#448), read in the background.
//!
//! Nothing is read until the panel asks, and nothing is read on a timer: each request answers
//! the latest reading at once and starts a new one when that reading is older than
//! [`REFRESH`] and none is running. A reading never holds up another request, so a slow
//! driver (or `nvidia-smi`) only makes the numbers older. Nothing is logged.

use super::routes::{Builder, OPEN};
use super::{Core, ok};
use crate::gpu_memory::{Gpu, Reader};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// A reading this recent is answered again instead of starting another one. The panel asks
/// every 2 s; two windows asking at once still cause one reading.
pub(crate) const REFRESH: Duration = Duration::from_millis(1500);

#[derive(Default)]
struct State {
    gpus: Vec<Gpu>,
    /// When the latest reading finished.
    measured: Option<Instant>,
    error: Option<&'static str>,
}

#[derive(Default)]
pub(crate) struct GpuMemory {
    state: Arc<Mutex<State>>,
    running: Arc<AtomicBool>,
}

impl GpuMemory {
    /// The latest reading, starting the next one when it is due. `state` is `measuring`
    /// until the first reading ends, then `ready`, `unsupported` or `failed`.
    fn answer(&self, reader: &Reader) -> Value {
        let due = self.state.lock().unwrap().measured.is_none_or(|at| at.elapsed() >= REFRESH);
        if due && !self.running.swap(true, Ordering::SeqCst) {
            let (state, running, reader) = (self.state.clone(), self.running.clone(), reader.clone());
            let spawned = std::thread::Builder::new().name("gpu-memory".into()).spawn(move || {
                let reading = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| reader())).unwrap_or(Err(crate::gpu_memory::FAILED));
                {
                    let mut state = state.lock().unwrap();
                    match reading {
                        Ok(gpus) => {
                            state.gpus = gpus;
                            state.error = None;
                        }
                        Err(code) => {
                            state.gpus.clear();
                            state.error = Some(code);
                        }
                    }
                    state.measured = Some(Instant::now());
                }
                running.store(false, Ordering::SeqCst);
            });
            if spawned.is_err() {
                self.running.store(false, Ordering::SeqCst);
            }
        }
        let state = self.state.lock().unwrap();
        let phase = match (state.measured, state.error) {
            (None, _) => "measuring",
            (Some(_), None) => "ready",
            (Some(_), Some(crate::gpu_memory::UNSUPPORTED)) => "unsupported",
            (Some(_), Some(_)) => "failed",
        };
        json!({
            "state": phase,
            "gpus": state.gpus,
            "age_ms": state.measured.map(|at| at.elapsed().as_millis() as u64),
        })
    }
}

impl Core {
    fn gpu_memory(&self) -> Value {
        self.gpu_memory.answer(&self.services().gpu_memory)
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/get/data/gpu_memory", OPEN, |core, _| ok(core.gpu_memory()));
}
