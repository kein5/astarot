//! Hand streamed PCM to an output in blocks of at most 10 ms.
//!
//! The output devices themselves (PipeWire, WASAPI, the managed route) are not
//! in this crate. They implement [`OutputFactory`] and [`OutputSink`]. An
//! optional [`Monitor`] gets a copy of exactly what the output accepted.

use std::sync::Arc;
use std::time::Duration;

use crate::cancel::CancelToken;
use crate::clock::monotonic_ns;
use crate::error::{SpeechError, TtsError};
use crate::events::AudioFrame;

/// Streamed speech frames, as [`crate::PcmStream`] yields them.
pub type Frames = Box<dyn Iterator<Item = Result<AudioFrame, SpeechError>> + Send>;

/// Called once, when the first nonzero sample has been written:
/// `(monotonic_ns, sample_rate)`. It may fail when the start deadline won.
pub type FirstAudio<'a> = &'a mut (dyn FnMut(i64, u32) -> Result<(), SpeechError> + Send);

/// One opened output stream.
pub trait OutputSink: Send {
    /// Write one block. May wait for room, but must return promptly once the
    /// token is cancelled. Outputs with nonblocking writes should commit
    /// through [`CancelToken::commit_audio_write`].
    fn write(&mut self, pcm: &[u8], token: &CancelToken) -> Result<(), TtsError>;
    /// Finish: play what is queued when `drain`, otherwise discard it.
    fn close(&mut self, drain: bool, token: &CancelToken) -> Result<(), TtsError>;
}

/// Opens an output device for one utterance's format.
pub trait OutputFactory: Send + Sync {
    fn open(&self, device: &str, sample_rate: u32, channels: u16) -> Result<Box<dyn OutputSink>, TtsError>;
}

impl<F> OutputFactory for F
where
    F: Fn(&str, u32, u16) -> Result<Box<dyn OutputSink>, TtsError> + Send + Sync,
{
    fn open(&self, device: &str, sample_rate: u32, channels: u16) -> Result<Box<dyn OutputSink>, TtsError> {
        self(device, sample_rate, channels)
    }
}

/// An optional local copy of the speech (Python's `MonitorTee`).
/// A monitor problem is reported by the monitor itself and never fails speech.
pub trait Monitor: Send + Sync {
    /// Queue a block. Never blocks the speech output.
    fn offer(&self, pcm: &[u8], sample_rate: u32, channels: u16);
    /// Stop taking blocks. Drain what is queued, or drop it. Idempotent, never waits.
    fn close(&self, drain: bool);
    /// Whether the monitor's device has been released, waiting up to `timeout`.
    fn join(&self, timeout: Duration) -> bool;
}

/// Plays one utterance's frames somewhere.
pub trait SpeechRouter: Send + Sync {
    fn play(&self, frames: Frames, device: &str, token: &CancelToken, on_first_audio: FirstAudio<'_>, monitor: Option<Arc<dyn Monitor>>) -> Result<(), TtsError>;
}

/// The device-independent half of Python's `AudioRouter.play`.
pub struct AudioRouter {
    factory: Arc<dyn OutputFactory>,
}

impl AudioRouter {
    pub fn new(factory: Arc<dyn OutputFactory>) -> Self {
        Self { factory }
    }
}

impl SpeechRouter for AudioRouter {
    fn play(&self, frames: Frames, device: &str, token: &CancelToken, on_first_audio: FirstAudio<'_>, monitor: Option<Arc<dyn Monitor>>) -> Result<(), TtsError> {
        let mut sink: Option<Box<dyn OutputSink>> = None;
        let result = play_frames(&*self.factory, frames, device, token, on_first_audio, monitor.as_deref(), &mut sink);
        let success = result.is_ok();
        if let Some(monitor) = &monitor {
            monitor.close(success);
        }
        let closed = match sink.as_mut() {
            Some(sink) => sink.close(success, token),
            None => Ok(()),
        };
        result.and(closed)
    }
}

fn play_frames(
    factory: &dyn OutputFactory,
    frames: Frames,
    device: &str,
    token: &CancelToken,
    on_first_audio: FirstAudio<'_>,
    monitor: Option<&dyn Monitor>,
    sink: &mut Option<Box<dyn OutputSink>>,
) -> Result<(), TtsError> {
    let mut format = None;
    let mut first = true;
    for frame in frames {
        let frame = frame?;
        token.check()?;
        let current = (frame.sample_rate(), frame.channels());
        if format.is_some_and(|format| format != current) {
            return Err(SpeechError::new("format_changed").into());
        }
        if sink.is_none() {
            *sink = Some(factory.open(device, current.0, current.1)?);
            format = Some(current);
        }
        let output = sink.as_mut().expect("opened above");
        // At most 10 ms per write; no inference or HTTP on device callbacks.
        let block = (frame.sample_rate() as usize / 100).max(1) * frame.channels() as usize * 2;
        for pcm in frame.pcm().chunks(block) {
            token.check()?;
            output.write(pcm, token)?;
            if let Some(monitor) = monitor {
                // After the main write: the monitor hears exactly what the
                // virtual microphone received, and only queues.
                monitor.offer(pcm, current.0, current.1);
            }
            if first && pcm.iter().any(|&b| b != 0) {
                // Nonblocking outputs commit at their write; others confirm here.
                token.begin_playback()?;
                first = false;
                on_first_audio(monotonic_ns(), frame.sample_rate())?;
            }
        }
    }
    token.check()?;
    Ok(())
}
