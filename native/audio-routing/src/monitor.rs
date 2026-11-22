//! An optional local monitor of the speech written to the virtual microphone.
//!
//! Port of [`src-python/models/audio_routing/monitor_output.py`]. The main write path
//! only appends PCM to a bounded queue. Opening, volume and writing run on the
//! monitor's own thread with its own token, so a missing, unplugged or stalled
//! monitor never delays, cancels or fails the main output.
//!
//! [`src-python/models/audio_routing/monitor_output.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/monitor_output.py

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde_json::Value;

use crate::error::{Error, Kind, Result};
use crate::graph::is_virtual_name;
use crate::router::{CancelToken, Output, PlaybackToken};
use crate::sync::{lock, Worker};

pub const MONITOR_NODE: &str = "vrct.tts.monitor";

fn same_device(first: &str, second: &str) -> bool {
    if cfg!(windows) {
        crate::naming::same_output(first, second)
    } else {
        first == second
    }
}

/// Refuse the virtual microphone and anything in `exclude` (the voice's own output).
pub fn check_monitor_target<'a>(target: &'a str, exclude: &[String]) -> Result<&'a str> {
    if target.is_empty() {
        return Err(Error::speech("output_missing"));
    }
    if is_virtual_name(target) || exclude.iter().any(|device| same_device(target, device)) {
        return Err(Error::speech("feedback_blocked"));
    }
    Ok(target)
}

/// The monitor choice: a device (`""` is the OS default) and a volume in percent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonitorSpec {
    pub device: String,
    pub volume: u8,
}

/// Validate `None` (disabled) or `{"device", "volume"}` from across a process boundary.
pub fn parse_monitor(value: &Value) -> Result<Option<MonitorSpec>> {
    if value.is_null() {
        return Ok(None);
    }
    let invalid = || Error::value("vc_monitor_invalid");
    let object = value.as_object().ok_or_else(invalid)?;
    if object.len() != 2 {
        return Err(invalid());
    }
    let device = object.get("device").and_then(Value::as_str).ok_or_else(invalid)?;
    let volume = object.get("volume").ok_or_else(invalid)?;
    if device.chars().count() > 512 || device.chars().any(|c| (c as u32) < 32) || is_virtual_name(device) {
        return Err(invalid());
    }
    let volume = if volume.is_boolean() { None } else { volume.as_u64() }.filter(|&v| v <= 100).ok_or_else(invalid)?;
    Ok(Some(MonitorSpec { device: device.to_owned(), volume: volume as u8 }))
}

/// Attenuate signed 16-bit little-endian PCM; never amplifies, so never clips.
pub fn scale_pcm(pcm: &[u8], volume: u8) -> Vec<u8> {
    if volume >= 100 {
        return pcm.to_vec();
    }
    let volume = i32::from(volume);
    pcm.as_chunks::<2>()
        .0
        .iter()
        .flat_map(|pair| {
            let sample = i32::from(i16::from_le_bytes([pair[0], pair[1]]));
            // Truncation toward zero, as Python's int() does.
            ((sample * volume / 100) as i16).to_le_bytes()
        })
        .collect()
}

/// The status code of a monitor failure. Device names and driver text never appear.
pub fn error_code(error: &Error) -> String {
    if error.kind == Kind::Speech {
        format!("monitor_{}", error.code)
    } else {
        "monitor_output_error".to_owned()
    }
}

/// Open the monitor output; an empty device is the OS default, resolved here, off the
/// main path.
pub fn open_monitor_output(device: &str, rate: u32, channels: u16, exclude: &[String]) -> Result<Box<dyn Output>> {
    #[cfg(windows)]
    {
        use crate::wasapi::output::{default_output, WindowsOutput};
        let target = if device.is_empty() { default_output()? } else { device.to_owned() };
        Ok(Box::new(WindowsOutput::open(check_monitor_target(&target, exclude)?, rate, channels, false)?))
    }
    #[cfg(all(target_os = "linux", feature = "pipewire"))]
    {
        use crate::pipewire::output::{default_output, PipeWireOutput};
        let target = if device.is_empty() { default_output()? } else { device.to_owned() };
        Ok(Box::new(PipeWireOutput::open(check_monitor_target(&target, exclude)?, rate, channels, None, MONITOR_NODE)?))
    }
    #[cfg(not(any(windows, all(target_os = "linux", feature = "pipewire"))))]
    {
        let _ = (device, rate, channels, exclude);
        Err(Error::speech("unsupported_platform"))
    }
}

pub type MonitorFactory = Arc<dyn Fn(&str, u32, u16, &[String]) -> Result<Box<dyn Output>> + Send + Sync>;
type Notice = Arc<dyn Fn(&str) + Send + Sync>;
type Ready = Arc<dyn Fn() + Send + Sync>;

struct Queue {
    items: VecDeque<(Vec<u8>, u32, u16)>,
    queued: usize,
    closed: bool,
    failed: bool,
    dropped: u64,
    error: Option<String>,
}

struct Shared {
    queue: Mutex<Queue>,
    changed: Condvar,
    token: CancelToken,
    max_buffer_ms: usize,
}

pub struct MonitorTee {
    shared: Arc<Shared>,
    worker: Option<Worker>,
}

pub struct MonitorOptions {
    pub exclude: Vec<String>,
    pub factory: MonitorFactory,
    pub on_error: Option<Notice>,
    pub on_ready: Option<Ready>,
    pub max_buffer_ms: usize,
}

impl Default for MonitorOptions {
    fn default() -> Self {
        Self { exclude: Vec::new(), factory: Arc::new(open_monitor_output), on_error: None, on_ready: None, max_buffer_ms: 500 }
    }
}

impl MonitorTee {
    pub fn new(device: &str, volume: u8, options: MonitorOptions) -> Self {
        let shared = Arc::new(Shared {
            queue: Mutex::new(Queue { items: VecDeque::new(), queued: 0, closed: false, failed: false, dropped: 0, error: None }),
            changed: Condvar::new(),
            token: CancelToken::default(),
            max_buffer_ms: options.max_buffer_ms,
        });
        let exclude: Vec<String> = options.exclude.into_iter().filter(|d| !d.is_empty()).collect();
        let (state, device) = (shared.clone(), device.to_owned());
        let worker = Worker::spawn("astarot-monitor", move || run(&state, &device, volume, &exclude, &options.factory, options.on_error.as_ref(), options.on_ready.as_ref())).ok();
        if worker.is_none() {
            lock(&shared.queue).failed = true;
        }
        Self { shared, worker }
    }

    /// Called after each main write: constant time, never blocks on the device.
    pub fn offer(&self, pcm: &[u8], rate: u32, channels: u16) {
        let mut queue = lock(&self.shared.queue);
        if queue.closed || queue.failed {
            return;
        }
        queue.items.push_back((pcm.to_vec(), rate, channels));
        queue.queued += pcm.len();
        // A late or slow monitor drops its oldest audio instead of growing.
        let limit = (rate as usize * channels as usize * 2 * self.shared.max_buffer_ms / 1000).max(1);
        while queue.queued > limit && queue.items.len() > 1 {
            if let Some((old, _, _)) = queue.items.pop_front() {
                queue.queued -= old.len();
                queue.dropped += 1;
            }
        }
        self.shared.changed.notify_all();
    }

    /// Nonblocking. With `drain`, play what is queued; otherwise stop at once.
    pub fn close(&self, drain: bool) {
        {
            let mut queue = lock(&self.shared.queue);
            queue.closed = true;
            if !drain {
                queue.items.clear();
                queue.queued = 0;
            }
            self.shared.changed.notify_all();
        }
        if !drain {
            self.shared.token.cancel();
        }
    }

    pub fn join(&self, timeout: Duration) -> bool {
        self.worker.as_ref().is_none_or(|worker| worker.join(timeout))
    }

    pub fn dropped(&self) -> u64 {
        lock(&self.shared.queue).dropped
    }

    pub fn queued(&self) -> usize {
        lock(&self.shared.queue).queued
    }

    pub fn error(&self) -> Option<String> {
        lock(&self.shared.queue).error.clone()
    }
}

fn fail(shared: &Shared, error: &Error, on_error: Option<&Notice>) {
    let code = {
        let mut queue = lock(&shared.queue);
        if queue.failed || shared.token.is_set() {
            return;
        }
        queue.failed = true;
        let code = error_code(error);
        queue.error = Some(code.clone());
        queue.items.clear();
        queue.queued = 0;
        code
    };
    if let Some(on_error) = on_error {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| on_error(&code)));
    }
}

fn run(shared: &Shared, device: &str, volume: u8, exclude: &[String], factory: &MonitorFactory, on_error: Option<&Notice>, on_ready: Option<&Ready>) {
    let mut sink: Option<(Box<dyn Output>, (u32, u16))> = None;
    let result = (|| -> Result<()> {
        loop {
            let (pcm, rate, channels) = {
                let mut queue = lock(&shared.queue);
                while queue.items.is_empty() && !queue.closed {
                    queue = shared.changed.wait(queue).unwrap_or_else(|e| e.into_inner());
                }
                if queue.items.is_empty() || shared.token.is_set() {
                    return Ok(());
                }
                let item = queue.items.pop_front().unwrap_or_default();
                queue.queued -= item.0.len();
                item
            };
            if sink.is_none() {
                sink = Some((factory(device, rate, channels, exclude)?, (rate, channels)));
                if let Some(on_ready) = on_ready {
                    on_ready();
                }
            }
            let Some((output, format)) = &mut sink else { continue };
            if (rate, channels) != *format {
                continue; // The main path refuses format changes first.
            }
            output.write(&scale_pcm(&pcm, volume), &shared.token)?;
        }
    })();
    if let Err(error) = &result {
        fail(shared, error, on_error);
    }
    if let Some((mut output, _)) = sink {
        let drain = !lock(&shared.queue).failed && !shared.token.is_set();
        if let Err(error) = output.close(drain, &shared.token) {
            fail(shared, &error, on_error);
        }
    }
}
