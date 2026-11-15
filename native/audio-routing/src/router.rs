//! Playing speech to an explicitly chosen output.
//!
//! Port of `src-python/models/audio_routing/audio_router.py` and of the cancellation
//! token the Python speech scheduler hands it (`CancelToken` in `speechcpp_tts.py`).
//! The router never captures, mixes, or routes an unconverted microphone, and never
//! falls back to the OS default output.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::error::{Error, Result};
use crate::monitor::MonitorTee;
use crate::sync::{lock, monotonic, monotonic_ns, Event};

/// Signed 16-bit little-endian PCM at one rate and channel count.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub pcm: Vec<u8>,
    pub sample_rate: u32,
    pub channels: u16,
}

/// What an output checks while it writes: cancellation and the start deadline.
pub trait PlaybackToken: Send + Sync {
    /// `Err` once cancelled or once the start deadline passed without audio.
    fn check(&self) -> Result<()>;
    fn is_set(&self) -> bool;
    /// Wait for cancellation for at most `timeout`. Returns whether it is cancelled.
    fn wait(&self, timeout: Duration) -> bool;
    /// The first audible write happened: the start deadline no longer applies.
    fn begin_playback(&self) -> Result<()>;
    /// Run one nonblocking `write` of `pcm` so that expiry cannot slip between the
    /// write and the decision whether it started playback.
    fn commit_audio_write(&self, pcm: &[u8], write: &mut dyn FnMut() -> std::io::Result<usize>) -> Result<std::io::Result<usize>> {
        let _ = pcm;
        Ok(write())
    }
}

type Clock = Arc<dyn Fn() -> f64 + Send + Sync>;

struct TokenState {
    started: bool,
    reason: String,
}

/// Cancellation with an optional start deadline.
pub struct CancelToken {
    event: Event,
    state: Mutex<TokenState>,
    start_deadline: Option<f64>,
    clock: Clock,
}

impl Default for CancelToken {
    fn default() -> Self {
        Self::new(None)
    }
}

impl CancelToken {
    /// `start_deadline` in monotonic seconds: unless audible audio was written by
    /// then, the token cancels itself with `speech_expired`.
    pub fn new(start_deadline: Option<f64>) -> Self {
        Self::with_clock(start_deadline, Arc::new(monotonic))
    }

    pub fn with_clock(start_deadline: Option<f64>, clock: Clock) -> Self {
        Self { event: Event::new(), state: Mutex::new(TokenState { started: false, reason: "cancelled".into() }), start_deadline, clock }
    }

    pub fn cancel(&self) {
        self.cancel_with("cancelled");
    }

    pub fn cancel_with(&self, reason: &str) {
        let mut state = lock(&self.state);
        self.cancel_locked(&mut state, reason);
    }

    fn cancel_locked(&self, state: &mut TokenState, reason: &str) {
        if !self.event.is_set() {
            state.reason = reason.to_owned();
            self.event.set();
        }
    }

    fn expire_start_locked(&self, state: &mut TokenState) {
        if !state.started && self.start_deadline.is_some_and(|deadline| (self.clock)() >= deadline) {
            self.cancel_locked(state, "speech_expired");
        }
    }

    pub fn reason(&self) -> String {
        lock(&self.state).reason.clone()
    }
}

impl PlaybackToken for CancelToken {
    fn check(&self) -> Result<()> {
        let mut state = lock(&self.state);
        self.expire_start_locked(&mut state);
        if self.event.is_set() {
            return Err(Error::speech(state.reason.clone()));
        }
        Ok(())
    }

    fn is_set(&self) -> bool {
        self.event.is_set()
    }

    fn wait(&self, timeout: Duration) -> bool {
        self.event.wait(timeout)
    }

    fn begin_playback(&self) -> Result<()> {
        {
            let mut state = lock(&self.state);
            self.expire_start_locked(&mut state);
            if !self.event.is_set() {
                state.started = true;
            }
        }
        self.check()
    }

    fn commit_audio_write(&self, pcm: &[u8], write: &mut dyn FnMut() -> std::io::Result<usize>) -> Result<std::io::Result<usize>> {
        let result = {
            let mut state = lock(&self.state);
            self.expire_start_locked(&mut state);
            if self.event.is_set() {
                None
            } else {
                let result = write();
                if let Ok(count) = result {
                    if count == 0 || count > pcm.len() {
                        return Err(Error::speech("output_write_invalid"));
                    }
                    // Only written audible bytes end the start deadline.
                    if pcm[..count].iter().any(|&b| b != 0) {
                        state.started = true;
                    }
                }
                Some(result)
            }
        };
        self.check()?;
        Ok(result.unwrap_or(Ok(0)))
    }
}

/// An open output device.
pub trait Output: Send {
    fn write(&mut self, pcm: &[u8], token: &dyn PlaybackToken) -> Result<()>;
    /// With `drain`, play what is buffered first; otherwise stop at once.
    fn close(&mut self, drain: bool, token: &dyn PlaybackToken) -> Result<()>;
}

/// Opens `device` at a rate and channel count.
pub type OutputFactory = Box<dyn Fn(&str, u32, u16) -> Result<Box<dyn Output>> + Send + Sync>;

/// The OS output for `device`; an empty device is refused, never the default.
pub fn open_output(device: &str, rate: u32, channels: u16) -> Result<Box<dyn Output>> {
    if device.is_empty() {
        return Err(Error::speech("output_not_selected"));
    }
    #[cfg(windows)]
    {
        Ok(Box::new(crate::wasapi::output::WindowsOutput::open(device, rate, channels, true)?))
    }
    #[cfg(target_os = "linux")]
    {
        Ok(Box::new(crate::pipewire::output::PipeWireOutput::open(device, rate, channels, None, "vrct.tts")?))
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (rate, channels);
        Err(Error::speech("unsupported_platform"))
    }
}

pub struct AudioRouter {
    factory: OutputFactory,
}

impl Default for AudioRouter {
    fn default() -> Self {
        Self::new(Box::new(open_output))
    }
}

impl AudioRouter {
    pub fn new(factory: OutputFactory) -> Self {
        Self { factory }
    }

    /// Play `frames` to `device`, at most 10 ms per write. `on_first_audio` gets the
    /// monotonic nanoseconds and rate of the first audible write. A monitor hears
    /// exactly what the output was given, after the output had it.
    pub fn play(&self, frames: impl IntoIterator<Item = Result<Frame>>, device: &str, token: &dyn PlaybackToken, mut on_first_audio: impl FnMut(u64, u32), monitor: Option<&MonitorTee>) -> Result<()> {
        let mut sink: Option<Box<dyn Output>> = None;
        let result = (|| {
            let mut format = None;
            let mut first = true;
            for frame in frames {
                let frame = frame?;
                token.check()?;
                let current = (frame.sample_rate, frame.channels);
                if format.is_some_and(|format| format != current) {
                    return Err(Error::speech("format_changed"));
                }
                let output = match &mut sink {
                    Some(output) => output,
                    None => {
                        format = Some(current);
                        sink.insert((self.factory)(device, frame.sample_rate, frame.channels)?)
                    }
                };
                let block = (frame.sample_rate as usize / 100).max(1) * frame.channels as usize * 2;
                for pcm in frame.pcm.chunks(block) {
                    token.check()?;
                    output.write(pcm, token)?;
                    if let Some(monitor) = monitor {
                        monitor.offer(pcm, frame.sample_rate, frame.channels);
                    }
                    if first && pcm.iter().any(|&b| b != 0) {
                        token.begin_playback()?;
                        first = false;
                        on_first_audio(monotonic_ns(), frame.sample_rate);
                    }
                }
            }
            token.check()
        })();
        let success = result.is_ok();
        if let Some(monitor) = monitor {
            monitor.close(success);
        }
        let closed = match &mut sink {
            Some(output) => output.close(success, token),
            None => Ok(()),
        };
        result.and(closed)
    }
}

#[cfg(test)]
mod tests;
