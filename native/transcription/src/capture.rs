//! Audio capture for recognition, behind one trait so that tests feed PCM of their own.
//!
//! [`CapturePlatform`] opens the microphone or the speaker of a source and lists the endpoints
//! realtime recognition chooses among. [`NativeCapture`] is this computer's: WASAPI on Windows
//! (a speaker is read through its loopback), and on Linux the PipeWire capture of
//! `vrct-audio-routing` ([`crate::linux`]; Python started the `vrct-asr-capture` helper).

use crate::pcm::{self, Resampler};
use std::sync::{Arc, Condvar, Mutex};
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
///
/// The last argument is how long before the call the first sample was captured, when the
/// capture knows it; `None`: the audio ends as it is delivered (the captures of this computer
/// hand it over as they read it).
pub type OnAudio = Box<dyn FnMut(&[i16], u32, u16, Option<Duration>) -> bool + Send>;
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

/// How long a capture may take to give its first audio before its start fails
/// (`asr_capture_start_timeout`), as the `vrct-asr-capture` helper's start waited.
pub const FIRST_AUDIO_WAIT: Duration = Duration::from_secs(5);

/// A capture of `vrct-audio-routing`.
pub type DeviceCapture = Box<dyn vrct_audio_routing::windows_route::Capture>;

/// Where a capture is before its first audio.
#[derive(Clone, Debug, PartialEq)]
enum Opening {
    Waiting,
    Heard,
    Failed(String),
}

/// Tells `code` the first time only.
fn tell(slot: &Mutex<Option<OnError>>, code: &str) {
    if let Some(mut on_error) = slot.lock().unwrap_or_else(|e| e.into_inner()).take() {
        on_error(code);
    }
}

/// Starts the capture `make` builds and waits up to `wait` for its first audio, as the
/// `vrct-asr-capture` helper's start did: a failure before it is the start's own (`Err`, and
/// `on_error` is not called), a failure after it goes to `on_error` once. Audio goes on as 48 kHz
/// mono, as it arrives; a receiver that refuses it ends the capture with
/// `asr_capture_consumer_closed`.
pub fn start_until_audio(
    make: impl FnOnce(vrct_audio_routing::windows_route::CaptureCallbacks) -> DeviceCapture,
    mut on_audio: OnAudio,
    on_error: OnError,
    wait: Duration,
) -> Result<Box<dyn Capture>, String> {
    let opening = Arc::new((Mutex::new(Opening::Waiting), Condvar::new()));
    let told = Arc::new(Mutex::new(Some(on_error)));
    let (heard, failed, closing) = (opening.clone(), opening.clone(), told.clone());
    let callbacks = vrct_audio_routing::windows_route::CaptureCallbacks {
        on_audio: Box::new(move |bytes: &[u8]| {
            {
                let (state, changed) = &*heard;
                let mut state = state.lock().unwrap_or_else(|e| e.into_inner());
                if *state == Opening::Waiting {
                    *state = Opening::Heard;
                    changed.notify_all();
                }
            }
            if on_audio(&pcm::samples(bytes), FRAME_RATE, 1, None) {
                return true;
            }
            tell(&closing, "asr_capture_consumer_closed");
            false
        }),
        on_error: Box::new(move |code: &str| {
            let (state, changed) = &*failed;
            let mut state = state.lock().unwrap_or_else(|e| e.into_inner());
            if *state == Opening::Waiting {
                *state = Opening::Failed(code.to_owned());
                changed.notify_all();
                return;
            }
            drop(state);
            tell(&told, code);
        }),
    };
    let mut capture = make(callbacks);
    capture.start().map_err(|error| error.code)?;
    let outcome = {
        let (state, changed) = &*opening;
        let state = state.lock().unwrap_or_else(|e| e.into_inner());
        let (state, _) = changed.wait_timeout_while(state, wait, |state| *state == Opening::Waiting).unwrap_or_else(|e| e.into_inner());
        state.clone()
    };
    match outcome {
        Opening::Heard => Ok(Box::new(Started(capture))),
        Opening::Failed(code) => {
            capture.stop();
            Err(code)
        }
        Opening::Waiting => {
            capture.stop();
            Err("asr_capture_start_timeout".into())
        }
    }
}

/// A capture that gave its first audio.
struct Started(DeviceCapture);

impl Capture for Started {
    fn request_stop(&self) {
        self.0.request_stop();
    }

    fn stop(&mut self) -> bool {
        self.0.stop();
        self.0.released()
    }
}

/// This computer's devices.
#[derive(Default)]
pub struct NativeCapture;

impl NativeCapture {
    pub fn new() -> NativeCapture {
        NativeCapture
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
            on_audio(&pcm::samples(bytes), format.rate, format.channels, None)
        });
        // Decision 15 (3): only realtime recognition (an endpoint) gets silence while the
        // speaker plays nothing; the recorder (a device) hears only what is played, as in Python.
        let fill_silence = matches!(target, Target::Endpoint(_));
        let (capture, _) = DeviceCapture::start(device, source == Source::Speaker, fill_silence, timeout, deliver, on_error)
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
                Target::Endpoint(endpoint) => crate::linux::open(endpoint, source, on_audio, on_error),
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
            crate::linux::endpoints(source)
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
            crate::linux::default_endpoint(source)
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
    use std::sync::atomic::{AtomicBool, Ordering};
    use vrct_audio_routing::windows_route::CaptureCallbacks;

    /// What the stand-in capture does once started, in order.
    #[derive(Clone)]
    enum Step {
        Audio(usize),
        Fail(&'static str),
        Wait(u64),
    }

    /// A capture of `vrct-audio-routing` that plays `steps` on a thread of its own.
    struct Scripted {
        steps: Vec<Step>,
        start: Option<&'static str>,
        callbacks: Option<CaptureCallbacks>,
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl vrct_audio_routing::windows_route::Capture for Scripted {
        fn start(&mut self) -> vrct_audio_routing::Result<()> {
            if let Some(code) = self.start {
                return Err(vrct_audio_routing::Error::runtime(code));
            }
            let (mut callbacks, steps, stop) = (self.callbacks.take().unwrap(), self.steps.clone(), self.stop.clone());
            self.thread = Some(std::thread::spawn(move || {
                for step in steps {
                    if stop.load(Ordering::SeqCst) {
                        return;
                    }
                    match step {
                        Step::Audio(samples) => {
                            let bytes: Vec<u8> = (0..samples as i16).flat_map(i16::to_le_bytes).collect();
                            if !(callbacks.on_audio)(&bytes) {
                                return;
                            }
                        }
                        Step::Fail(code) => {
                            (callbacks.on_error)(code);
                            return;
                        }
                        Step::Wait(ms) => {
                            let until = Instant::now() + Duration::from_millis(ms);
                            while Instant::now() < until && !stop.load(Ordering::SeqCst) {
                                std::thread::sleep(Duration::from_millis(5));
                            }
                        }
                    }
                }
            }));
            Ok(())
        }
        fn request_stop(&self) {
            self.stop.store(true, Ordering::SeqCst);
        }
        fn stop(&mut self) {
            self.request_stop();
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    /// What the receiver got: the audio (samples, rate, channels, age) and the codes.
    type Got = (Arc<Mutex<Vec<(usize, u32, u16, Option<Duration>)>>>, Arc<Mutex<Vec<String>>>);

    fn start(steps: Vec<Step>, start: Option<&'static str>, accept: bool, wait: Duration) -> (Result<Box<dyn Capture>, String>, Got) {
        let (audio, codes) = (Arc::new(Mutex::new(Vec::new())), Arc::new(Mutex::new(Vec::new())));
        let (heard, told) = (audio.clone(), codes.clone());
        let on_audio: OnAudio = Box::new(move |samples: &[i16], rate: u32, channels: u16, ago: Option<Duration>| {
            heard.lock().unwrap().push((samples.len(), rate, channels, ago));
            accept
        });
        let on_error: OnError = Box::new(move |code: &str| told.lock().unwrap().push(code.to_string()));
        let started = start_until_audio(
            |callbacks| Box::new(Scripted { steps, start, callbacks: Some(callbacks), stop: Arc::new(AtomicBool::new(false)), thread: None }),
            on_audio,
            on_error,
            wait,
        );
        (started, (audio, codes))
    }

    fn eventually(what: &str, done: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !done() {
            assert!(Instant::now() < deadline, "{what}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn a_capture_starts_on_its_first_audio_and_tells_a_later_failure_once() {
        // The `vrct-asr-capture` helper's start (decision 2 of #733): audio goes on as 48 kHz mono
        // as it arrives, and a failure after it goes to `on_error`.
        let (started, (audio, codes)) = start(vec![Step::Audio(480), Step::Audio(512), Step::Fail("asr_capture_stalled")], None, true, FIRST_AUDIO_WAIT);
        let mut capture = started.expect("the capture starts");
        eventually("the failure is told", || codes.lock().unwrap().len() == 1);
        assert_eq!(*codes.lock().unwrap(), ["asr_capture_stalled"]);
        assert_eq!(*audio.lock().unwrap(), [(480, 48000, 1, None), (512, 48000, 1, None)]);
        assert!(capture.stop());
    }

    #[test]
    fn a_failure_before_the_first_audio_is_the_starts_own() {
        // Decision 9 of #727, kept: the start fails with the code, and `on_error` is not called.
        let (started, (_, codes)) = start(vec![Step::Fail("asr_capture_endpoint_removed")], None, true, FIRST_AUDIO_WAIT);
        assert_eq!(started.err().as_deref(), Some("asr_capture_endpoint_removed"));
        let (started, (_, refused)) = start(vec![], Some("asr_capture_endpoint_changed"), true, FIRST_AUDIO_WAIT);
        assert_eq!(started.err().as_deref(), Some("asr_capture_endpoint_changed"));
        std::thread::sleep(Duration::from_millis(50));
        assert!(codes.lock().unwrap().is_empty() && refused.lock().unwrap().is_empty());
    }

    #[test]
    fn no_audio_within_the_wait_fails_the_start() {
        let began = Instant::now();
        let (started, (_, codes)) = start(vec![Step::Wait(2000), Step::Audio(480)], None, true, Duration::from_millis(200));
        assert_eq!(started.err().as_deref(), Some("asr_capture_start_timeout"));
        assert!(began.elapsed() < Duration::from_millis(1500), "the stop waited for the audio");
        assert!(codes.lock().unwrap().is_empty());
    }

    #[test]
    fn a_receiver_that_refuses_audio_ends_the_capture_as_the_helper_told_it() {
        let (started, (_, codes)) = start(vec![Step::Audio(480), Step::Audio(480)], None, false, FIRST_AUDIO_WAIT);
        let _capture = started.expect("the capture starts");
        eventually("the closing is told", || !codes.lock().unwrap().is_empty());
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(*codes.lock().unwrap(), ["asr_capture_consumer_closed"]);
    }

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
