//! Audio capture for recognition, behind one trait so that tests feed PCM of their own.
//!
//! [`CapturePlatform`] opens the microphone or the speaker of a source and lists the endpoints
//! realtime recognition chooses among. [`NativeCapture`] is this computer's: WASAPI on Windows
//! (a speaker is read through its loopback), and on Linux the `vrct-asr-capture` helper that
//! Python started too (`native/asr-capture/main.c`), reading the PipeWire node it is given.

use crate::pcm::{self, Resampler};
use std::time::{Duration, Instant};
use vrct_audio_routing::graph::Endpoint;
use vrct_audio_routing::identity::Device;
pub use vrct_audio_routing::selection::Source;

/// What a capture opens: a device row of the settings (the recorder), or an endpoint of the
/// realtime settings.
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    Device(Device),
    Endpoint(Endpoint),
}

/// Interleaved 16-bit samples at `rate` and `channels`; return false to stop the capture.
pub type OnAudio = Box<dyn FnMut(&[i16], u32, u16) -> bool + Send>;
/// A fixed code when the capture fails while running.
pub type OnError = Box<dyn FnMut(&str) + Send>;

/// A running capture.
pub trait Capture: Send {
    /// Stops delivering without waiting.
    fn request_stop(&self);
    /// Stops and waits a little; false when the device could not be confirmed released.
    fn stop(&mut self) -> bool;
}

/// The devices of this computer, or of a test.
pub trait CapturePlatform: Send + Sync {
    /// Opens `target` for `source` and starts delivering. Waits up to `timeout` for the device
    /// to open. `Err` is a fixed code.
    fn open(
        &self,
        source: Source,
        target: &Target,
        timeout: Duration,
        on_audio: OnAudio,
        on_error: OnError,
    ) -> Result<Box<dyn Capture>, String>;
    /// The endpoints realtime recognition may pick (`enumerate_endpoints`): endpoint, label.
    fn endpoints(&self, source: Source) -> Result<Vec<(Endpoint, String)>, String>;
    /// The system's default endpoint of a source (`default_endpoint`). Errors:
    /// `realtime_default_endpoint_missing`, `realtime_default_endpoint_feedback`.
    fn default_endpoint(&self, source: Source) -> Result<Endpoint, String>;
}

/// `source.as_str()` with the media class the endpoints of a source have.
pub fn media_class(source: Source) -> &'static str {
    match source {
        Source::Mic => "Audio/Source",
        Source::Speaker => "Audio/Sink",
    }
}

/// 48 kHz mono frames of 20 ms stamped with when their first sample was heard (`FrameBuilder`
/// of `capture_windows.py`).
pub struct FrameBuilder {
    channels: usize,
    resampler: Resampler,
    pcm: Vec<i16>,
    last: Option<Instant>,
}

pub const FRAME_RATE: u32 = 48000;
pub const FRAME_SAMPLES: usize = 960;

impl FrameBuilder {
    pub fn new(rate: u32, channels: usize) -> Self {
        FrameBuilder { channels: channels.max(1), resampler: Resampler::new(rate, FRAME_RATE), pcm: Vec::new(), last: None }
    }

    pub fn feed(&mut self, samples: &[i16], received: Instant) -> Vec<(Vec<i16>, Instant)> {
        let mono = pcm::to_mono(samples, self.channels);
        let out = self.resampler.process(&pcm::to_f32(&mono));
        self.pcm.extend(pcm::to_i16(&out));
        let mut frames = Vec::new();
        while self.pcm.len() >= FRAME_SAMPLES {
            let block: Vec<i16> = self.pcm.drain(..FRAME_SAMPLES).collect();
            // Everything after this frame's first sample arrived by `received`.
            let age = Duration::from_nanos(((self.pcm.len() + FRAME_SAMPLES) as u64) * 1_000_000_000 / u64::from(FRAME_RATE));
            let mut stamp = received.checked_sub(age).unwrap_or(received);
            if let Some(last) = self.last
                && stamp <= last
            {
                stamp = last + Duration::from_nanos(1);
            }
            self.last = Some(stamp);
            frames.push((block, stamp));
        }
        frames
    }
}

/// This computer's devices.
pub struct NativeCapture {
    /// The `vrct-asr-capture` helper (Linux).
    #[allow(dead_code)]
    helper: std::path::PathBuf,
}

impl NativeCapture {
    pub fn new(helper: std::path::PathBuf) -> NativeCapture {
        NativeCapture { helper }
    }
}

#[cfg(windows)]
mod windows_capture {
    use super::*;
    use vrct_audio_routing::wasapi::capture::{DeviceCapture, DeviceTarget};

    pub struct Wasapi(pub DeviceCapture);

    impl Capture for Wasapi {
        fn request_stop(&self) {
            self.0.request_stop();
        }
        fn stop(&mut self) -> bool {
            self.0.stop()
        }
    }

    pub fn open(source: Source, target: &Target, timeout: Duration, mut on_audio: OnAudio, on_error: OnError) -> Result<Box<dyn Capture>, String> {
        let device = match target {
            Target::Device(device) => {
                DeviceTarget::EndpointId(device.endpoint_id.clone().ok_or("asr_capture_endpoint_missing")?)
            }
            Target::Endpoint(endpoint) => DeviceTarget::Identity(endpoint.name.clone()),
        };
        let deliver = Box::new(move |bytes: &[u8], format: vrct_audio_routing::wasapi::capture::DeviceFormat| {
            on_audio(&pcm::samples(bytes), format.rate, format.channels)
        });
        let (capture, _) = DeviceCapture::start(device, source == Source::Speaker, timeout, deliver, on_error)
            .map_err(|error| error.code)?;
        Ok(Box::new(Wasapi(capture)))
    }

    pub fn endpoints(source: Source) -> Result<Vec<(Endpoint, String)>, String> {
        let rows = vrct_audio_routing::wasapi::enumerate_endpoints(source.as_str()).map_err(|e| e.code)?;
        Ok(rows.into_iter().map(|row| (row.endpoint, row.label)).collect())
    }

    pub fn default_endpoint(source: Source) -> Result<Endpoint, String> {
        vrct_audio_routing::wasapi::default_endpoint(source.as_str()).map_err(|e| e.code)
    }
}

impl CapturePlatform for NativeCapture {
    fn open(
        &self,
        source: Source,
        target: &Target,
        timeout: Duration,
        on_audio: OnAudio,
        on_error: OnError,
    ) -> Result<Box<dyn Capture>, String> {
        #[cfg(windows)]
        {
            windows_capture::open(source, target, timeout, on_audio, on_error)
        }
        #[cfg(target_os = "linux")]
        {
            let _ = timeout;
            match target {
                Target::Endpoint(endpoint) => {
                    crate::helper::HelperCapture::open(&self.helper, endpoint, source, on_audio, on_error)
                        .map(|c| Box::new(c) as Box<dyn Capture>)
                }
                // The recorder (the cloud engines) read PyAudioWPatch, which is Windows only.
                Target::Device(_) => Err("asr_capture_windows_only".into()),
            }
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            let _ = (source, target, timeout, on_audio, on_error);
            Err("realtime_platform_unsupported".into())
        }
    }

    fn endpoints(&self, source: Source) -> Result<Vec<(Endpoint, String)>, String> {
        #[cfg(windows)]
        {
            windows_capture::endpoints(source)
        }
        #[cfg(target_os = "linux")]
        {
            crate::helper::endpoints(source)
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            let _ = source;
            Err("realtime_platform_unsupported".into())
        }
    }

    fn default_endpoint(&self, source: Source) -> Result<Endpoint, String> {
        #[cfg(windows)]
        {
            windows_capture::default_endpoint(source)
        }
        #[cfg(target_os = "linux")]
        {
            crate::helper::default_endpoint(source)
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            let _ = source;
            Err("realtime_default_endpoint_missing".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_20_ms_at_48_khz_and_stamped_in_order() {
        let mut builder = FrameBuilder::new(44100, 2);
        let start = Instant::now();
        let mut frames = Vec::new();
        for i in 0..50u32 {
            frames.extend(builder.feed(&vec![100; 441 * 2], start + Duration::from_millis(u64::from(i) * 10)));
        }
        // Half a second of audio, less the converter's delay.
        assert!((20..=25).contains(&frames.len()), "{}", frames.len());
        assert!(frames.iter().all(|(f, _)| f.len() == FRAME_SAMPLES));
        assert!(frames.windows(2).all(|w| w[0].1 < w[1].1));
    }
}
