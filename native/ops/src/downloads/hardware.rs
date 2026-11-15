//! Inspect the fixed speech.cpp device list, without models or network access (`hardware.py`).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::json::{Json, Object};
use crate::process::{devices_command, Owned, Waited, OUTPUT_LIMIT};

const MAX_DEVICES: usize = 32;
const MAX_TEXT: usize = 256;
const MAX_MEMORY: u64 = (1 << 53) - 1;

/// One row of `speech devices --json`. A memory that cannot be reported is `None`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Device {
    pub name: String,
    pub description: String,
    pub kind: String,
    pub memory_total: Option<u64>,
    pub memory_free: Option<u64>,
}

/// Checks the device list and returns its rows; anything doubtful is `hardware_invalid`,
/// never a guess of more capacity than reported.
pub fn parse_devices(value: &serde_json::Value) -> Result<Vec<Device>, &'static str> {
    const INVALID: &str = "hardware_invalid";
    let rows = value.get("devices").and_then(|d| d.as_array()).filter(|d| value.is_object() && d.len() <= MAX_DEVICES).ok_or(INVALID)?;
    let text_ok = |v: Option<&serde_json::Value>| -> Option<String> {
        let s = v?.as_str()?;
        (!s.is_empty() && s.chars().count() <= MAX_TEXT && !s.chars().any(|c| (c as u32) < 32)).then(|| s.to_string())
    };
    // An integer from 0 to 2^53-1, or null/missing. Booleans and floats are not integers.
    let memory = |v: Option<&serde_json::Value>| -> Result<Option<u64>, &'static str> {
        match v {
            None | Some(serde_json::Value::Null) => Ok(None),
            Some(serde_json::Value::Number(n)) => n.as_u64().filter(|m| *m <= MAX_MEMORY).map(Some).ok_or(INVALID),
            Some(_) => Err(INVALID),
        }
    };
    let mut out: Vec<Device> = Vec::new();
    for row in rows {
        let row = row.as_object().ok_or(INVALID)?;
        let name = text_ok(row.get("name")).ok_or(INVALID)?;
        let description = text_ok(row.get("description")).ok_or(INVALID)?;
        let kind = row.get("kind").and_then(|k| k.as_str()).filter(|k| ["cpu", "gpu", "igpu"].contains(k)).ok_or(INVALID)?;
        if out.iter().any(|d| d.name == name) {
            return Err(INVALID);
        }
        let (total, free) = (memory(row.get("memory_total"))?, memory(row.get("memory_free"))?);
        if let (Some(t), Some(f)) = (total, free) {
            if f > t {
                return Err(INVALID);
            }
        }
        // Zero total means the backend cannot report capacity. A zero free with a known
        // positive total is real exhaustion, never an unknown value.
        let (total, free) = if total.unwrap_or(0) == 0 { (None, None) } else { (total, free) };
        out.push(Device { name, description, kind: kind.to_string(), memory_total: total, memory_free: free });
    }
    Ok(out)
}

/// Where the bundled speech.cpp executable is, or why it cannot be used.
pub type BinarySource = Arc<dyn Fn() -> Result<PathBuf, String> + Send + Sync>;

#[derive(Clone)]
struct ProbeState {
    phase: &'static str,
    devices: Vec<Device>,
    measured_at_ms: Option<u64>,
    error_code: Option<&'static str>,
}

struct Shared {
    binary: BinarySource,
    timeout: Duration,
    state: Mutex<ProbeState>,
    closed: AtomicBool,
    child: Mutex<Option<Arc<Owned>>>,
    worker: Mutex<Option<(thread::JoinHandle<()>, Arc<AtomicBool>)>>,
}

/// Asks speech.cpp for its devices in the background, one probe at a time.
pub struct HardwareProbe {
    shared: Arc<Shared>,
}

impl HardwareProbe {
    pub fn new(binary: BinarySource, timeout: Duration) -> Self {
        HardwareProbe {
            shared: Arc::new(Shared {
                binary,
                timeout,
                state: Mutex::new(ProbeState { phase: "unknown", devices: Vec::new(), measured_at_ms: None, error_code: None }),
                closed: AtomicBool::new(false),
                child: Mutex::new(None),
                worker: Mutex::new(None),
            }),
        }
    }

    /// `{phase, devices, measured_at_ms, error_code, observation_id}`.
    pub fn state(&self) -> Json {
        let state = self.shared.state.lock().unwrap().clone();
        let devices = state.devices.iter().map(Json::from_serialize).collect::<Vec<_>>();
        Object::new()
            .with("phase", state.phase)
            .with("devices", devices)
            .with("measured_at_ms", state.measured_at_ms)
            .with("error_code", state.error_code)
            .with("observation_id", observation_id())
            .into()
    }

    /// Starts a probe unless one is running. After [`close`](Self::close): `hardware_closed`.
    pub fn refresh(&self) -> Result<Json, &'static str> {
        {
            let mut worker = self.shared.worker.lock().unwrap();
            if self.shared.closed.load(Ordering::SeqCst) {
                return Err("hardware_closed");
            }
            let running = worker.as_ref().is_some_and(|(_, done)| !done.load(Ordering::SeqCst));
            if !running {
                *self.shared.state.lock().unwrap() = ProbeState { phase: "probing", devices: Vec::new(), measured_at_ms: None, error_code: None };
                let done = Arc::new(AtomicBool::new(false));
                let (shared, finished) = (self.shared.clone(), done.clone());
                let handle = thread::Builder::new()
                    .name("model-hardware".into())
                    .spawn(move || {
                        shared.run();
                        finished.store(true, Ordering::SeqCst);
                    })
                    .map_err(|_| "hardware_unavailable")?;
                *worker = Some((handle, done));
            }
        }
        Ok(self.state())
    }

    /// Whether a probe child is running now (for tests and diagnostics).
    pub fn child_running(&self) -> bool {
        self.shared.child.lock().unwrap().as_ref().is_some_and(|c| c.running())
    }

    /// Stops a running probe (terminate, then kill after 0.2 s) and refuses new ones. `false`
    /// if the probe thread is still running at the deadline.
    pub fn close(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        {
            let _worker = self.shared.worker.lock().unwrap();
            self.shared.closed.store(true, Ordering::SeqCst);
            let mut state = self.shared.state.lock().unwrap();
            state.phase = "closed";
            state.devices.clear();
        }
        let child = self.shared.child.lock().unwrap().clone();
        if let Some(child) = &child {
            child.terminate();
        }
        let done = self.shared.worker.lock().unwrap().as_ref().map(|(_, done)| done.clone());
        let Some(done) = done else { return true };
        let wait_until = |until: Instant| {
            while !done.load(Ordering::SeqCst) && Instant::now() < until {
                thread::sleep(Duration::from_millis(5));
            }
        };
        wait_until((Instant::now() + Duration::from_millis(200)).min(deadline));
        if let Some(child) = &child {
            child.kill();
        }
        wait_until(deadline);
        done.load(Ordering::SeqCst)
    }
}

impl Shared {
    fn run(&self) {
        let outcome = self.probe();
        let mut state = self.state.lock().unwrap();
        if !self.closed.load(Ordering::SeqCst) {
            *state = match outcome {
                Ok(Some(devices)) => ProbeState { phase: "ready", devices, measured_at_ms: Some(now_ms()), error_code: None },
                Ok(None) => return,
                Err(code) => ProbeState { phase: "failed", devices: Vec::new(), measured_at_ms: state.measured_at_ms, error_code: Some(code) },
            };
        }
    }

    /// `Ok(None)`: closed before it started.
    fn probe(&self) -> Result<Option<Vec<Device>>, &'static str> {
        let binary = (self.binary)().map_err(|_| "hardware_unavailable")?;
        let child = {
            let mut slot = self.child.lock().unwrap();
            if self.closed.load(Ordering::SeqCst) {
                return Ok(None);
            }
            let child = Owned::spawn(devices_command(&binary)).map_err(|_| "hardware_unavailable")?;
            *slot = Some(child.clone());
            child
        };
        let waited = child.wait(self.timeout);
        *self.child.lock().unwrap() = None;
        match waited.map_err(|_| "hardware_unavailable")? {
            Waited::TimedOut => Err("hardware_timeout"),
            Waited::Exited(status, _) if !status.success() => Err("hardware_failed"),
            Waited::Exited(_, output) if output.len() > OUTPUT_LIMIT => Err("hardware_invalid"),
            Waited::Exited(_, output) => {
                let value: serde_json::Value = serde_json::from_slice(&output).map_err(|_| "hardware_invalid")?;
                parse_devices(&value).map(Some)
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn observation_id() -> String {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_nanos().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn devices() -> serde_json::Value {
        json!({"devices": [
            {"name": "CPU", "description": "host CPU", "kind": "cpu", "memory_total": 0, "memory_free": 0},
            {"name": "Vulkan0", "description": "test GPU", "kind": "gpu", "memory_total": 8u64 << 30, "memory_free": 3u64 << 30},
        ]})
    }

    #[test]
    fn device_memory_preserves_zero_and_missing_without_summing_gpus() {
        let mut data = devices();
        data["devices"][1]["memory_free"] = json!(0);
        data["devices"].as_array_mut().unwrap().push(json!({"name": "Vulkan1", "description": "shared", "kind": "igpu", "memory_total": null}));
        let rows = parse_devices(&data).unwrap();
        assert_eq!(rows[1].memory_free, Some(0));
        assert_eq!((rows[2].memory_total, rows[2].memory_free), (None, None));
        assert_eq!(rows.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["CPU", "Vulkan0", "Vulkan1"]);
        // A CPU row whose total is 0 reports neither number.
        assert_eq!((rows[0].memory_total, rows[0].memory_free), (None, None));
    }

    #[test]
    fn bad_device_values_do_not_create_optimistic_capacity() {
        for (key, value) in [
            ("memory_free", json!(-1)),
            ("memory_free", json!(true)),
            ("memory_free", json!(9u64 << 30)),
            ("memory_total", json!("8 GB")),
            ("memory_total", json!(8.0)),
            ("name", json!("bad\nname")),
            ("name", json!("")),
            ("description", json!("x".repeat(257))),
            ("kind", json!("mystery")),
        ] {
            let mut data = devices();
            data["devices"][1][key] = value.clone();
            assert_eq!(parse_devices(&data), Err("hardware_invalid"), "{key}={value}");
        }
        assert_eq!(parse_devices(&json!({"devices": vec![json!(1); 1]})), Err("hardware_invalid"));
        assert_eq!(parse_devices(&json!([])), Err("hardware_invalid"));
        let too_many: Vec<_> = (0..33).map(|i| json!({"name": format!("D{i}"), "description": "d", "kind": "gpu"})).collect();
        assert_eq!(parse_devices(&json!({ "devices": too_many })), Err("hardware_invalid"));
    }

    #[test]
    fn duplicate_device_names_are_rejected() {
        let mut data = devices();
        let copy = data["devices"][1].clone();
        data["devices"].as_array_mut().unwrap().push(copy);
        assert_eq!(parse_devices(&data), Err("hardware_invalid"));
    }
}
