//! The recorder of one source (`_AudioDeviceSession` of `model.py` with
//! `BaseEnergyAndAudioRecorder` and `AudioTranscriber`): one capture of the device feeds the
//! volume meter, the energy listener and, when recognition is on, the phrase builder and the
//! engine.
//!
//! Threads: the capture's own, which only queues; the listener, which cuts phrases and reports
//! the volume; the transcriber, which builds utterances and asks the engine. A slow engine
//! never stalls the capture: phrases wait in a queue of 20, and the oldest is dropped when it
//! is full (`putDroppingOldestOnFull`).
//!
//! Phrases are cut by the energy listener, or by a VAD engine when the settings carry one
//! ([`crate::vad`]); the transcriber then joins them the way that path needs.

use crate::Transcript;
use crate::capture::{Capture, CapturePlatform, Source, Target};
use crate::energy::EnergyListener;
use crate::pcm;
use crate::phrases::{Clip, Phrases};
use crate::providers::{ApiError, AsrFailed};
use crate::vad::{Segmenter, Vad};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TrySendError, sync_channel};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use vrct_audio_routing::identity::Device;

/// `_AUDIO_QUEUE_MAXSIZE`.
const AUDIO_QUEUE: usize = 20;
/// How long the recorder waits for a device to open (`_MIC_OPEN_TIMEOUT_SEC`).
pub const OPEN_TIMEOUT: Duration = Duration::from_secs(8);

/// The settings a recorder starts with (`_create_recorder`, `_create_transcriber`).
#[derive(Clone, Debug, PartialEq)]
pub struct Settings {
    pub threshold: f64,
    pub automatic_threshold: bool,
    /// `*_RECORD_TIMEOUT`, at most the phrase timeout.
    pub record_timeout: f64,
    pub phrase_timeout: f64,
    pub max_phrases: usize,
    /// The VAD that cuts phrases in place of the energy listener (`*_ENABLE_VAD` with an engine
    /// at hand); `None` cuts by energy.
    pub vad: Option<Vad>,
}

/// A failure of the pipeline, by its error code and stage (`AudioPipelineFailure`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: &'static str,
    pub stage: &'static str,
    /// Why the engine failed, for an `ASR_ERROR` from an engine's answer (`TRANSCRIPTION_API_*`:
    /// a refused key, a rate limit, a timeout, a server error). The code stays `ASR_ERROR`.
    pub cause: Option<&'static str>,
}

impl Failure {
    pub const OPEN: Failure = Failure { code: "AUDIO_OPEN_ERROR", stage: "recording", cause: None };
    pub const READ: Failure = Failure { code: "AUDIO_READ_ERROR", stage: "recording", cause: None };
    pub const ASR: Failure = Failure { code: "ASR_ERROR", stage: "asr", cause: None };

    /// The engine failed for every candidate, for this reason.
    pub fn asr(error: ApiError) -> Failure {
        Failure { cause: Some(error.code()), ..Failure::ASR }
    }
}

/// What the recorder tells its owner. Called on the recorder's threads.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// The rms of a buffer, for the volume meter.
    Energy(u32),
    Transcript(Transcript),
    /// The pipeline stopped; reported once.
    Failed(Failure),
}

/// Recognises an utterance of mono samples at a rate.
pub type Recognize = Box<dyn FnMut(&[i16], u32) -> Result<Option<Transcript>, AsrFailed> + Send>;

struct Shared {
    stop: AtomicBool,
    /// Mute sync holds the source back while set (shared with the owner, which sets it).
    paused: Arc<AtomicBool>,
    failed: AtomicBool,
    clips: Mutex<ClipQueue>,
    ready: Condvar,
    on_event: Arc<dyn Fn(Event) + Send + Sync>,
}

#[derive(Default)]
struct ClipQueue {
    clips: VecDeque<Clip>,
    format: Option<(u32, usize)>,
    /// A resume asks the transcriber to forget what it was building.
    reset: bool,
}

impl Shared {
    fn fail(&self, failure: Failure) {
        if self.stop.load(Ordering::SeqCst) || self.failed.swap(true, Ordering::SeqCst) {
            return;
        }
        self.stop.store(true, Ordering::SeqCst);
        self.ready.notify_all();
        (self.on_event)(Event::Failed(failure));
    }

    fn running(&self) -> bool {
        !self.stop.load(Ordering::SeqCst)
    }
}

/// A running recorder.
pub struct Recorder {
    shared: Arc<Shared>,
    capture: Option<Box<dyn Capture>>,
    /// The device it opened.
    pub device: Device,
}

type Chunk = (Vec<i16>, u32, u16);

impl Recorder {
    /// Opens the first of `candidates` that opens (the chosen device, then the default, then
    /// the others, as `_start` tried them) and starts. `recognize` is `None` for the volume
    /// meter alone. While `paused` is set (mic mute sync) nothing is heard; when it clears,
    /// what was heard before is forgotten (`pauseMicTranscript`, `resumeMicTranscript`).
    /// `Err(Failure::OPEN)` when none opened.
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        platform: &dyn CapturePlatform,
        source: Source,
        candidates: &[Device],
        settings: Settings,
        recognize: Option<Recognize>,
        energy: bool,
        paused: Option<Arc<AtomicBool>>,
        on_event: Arc<dyn Fn(Event) + Send + Sync>,
    ) -> Result<Recorder, Failure> {
        let shared = Arc::new(Shared {
            stop: AtomicBool::new(false),
            paused: paused.unwrap_or_default(),
            failed: AtomicBool::new(false),
            clips: Mutex::new(ClipQueue::default()),
            ready: Condvar::new(),
            on_event,
        });
        let mut opened = None;
        for candidate in candidates {
            let (sender, receiver): (SyncSender<Chunk>, Receiver<Chunk>) = sync_channel(256);
            let feeding = Arc::clone(&shared);
            let on_audio = Box::new(move |samples: &[i16], rate: u32, channels: u16| {
                if !feeding.running() {
                    return false;
                }
                match sender.try_send((samples.to_vec(), rate, channels)) {
                    Ok(()) | Err(TrySendError::Full(_)) => true,
                    Err(TrySendError::Disconnected(_)) => false,
                }
            });
            let failing = Arc::clone(&shared);
            let on_error = Box::new(move |_code: &str| failing.fail(Failure::READ));
            if let Ok(capture) =
                platform.open(source, &Target::Device(candidate.clone()), OPEN_TIMEOUT, on_audio, on_error)
            {
                opened = Some((capture, candidate.clone(), receiver));
                break;
            }
        }
        let Some((capture, device, receiver)) = opened else { return Err(Failure::OPEN) };
        let listener = Arc::clone(&shared);
        let transcribing = recognize.is_some();
        let listening = settings.clone();
        std::thread::Builder::new()
            .name(format!("{}-listener", source.as_str()))
            .spawn(move || listen(listener, receiver, listening, energy, transcribing))
            .map_err(|_| Failure::OPEN)?;
        if let Some(recognize) = recognize {
            let transcriber = Arc::clone(&shared);
            std::thread::Builder::new()
                .name(format!("{}-transcription", source.as_str()))
                .spawn(move || transcribe(transcriber, settings, recognize))
                .map_err(|_| Failure::OPEN)?;
        }
        Ok(Recorder { shared, capture: Some(capture), device })
    }

    pub fn running(&self) -> bool {
        self.shared.running()
    }

    /// Stops without waiting for an engine request in flight: its result is dropped. False
    /// when the device could not be confirmed released.
    pub fn stop(&mut self) -> bool {
        self.shared.stop.store(true, Ordering::SeqCst);
        self.shared.ready.notify_all();
        match self.capture.take() {
            Some(mut capture) => capture.stop(),
            None => true,
        }
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        self.shared.ready.notify_all();
        if let Some(capture) = &self.capture {
            capture.request_stop();
        }
    }
}

fn listen(shared: Arc<Shared>, receiver: Receiver<Chunk>, settings: Settings, energy: bool, transcribing: bool) {
    let mut listener: Option<(Box<dyn Segmenter>, u32, usize)> = None;
    let mut was_paused = false;
    while shared.running() {
        let (samples, rate, channels) = match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => chunk,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        if shared.paused.load(Ordering::SeqCst) {
            if let Some((listener, _, _)) = listener.as_mut() {
                listener.reset();
            }
            was_paused = true;
            continue;
        }
        if std::mem::take(&mut was_paused) {
            // Resumed: what waited is dropped and the utterance starts over.
            let mut queue = shared.clips.lock().unwrap_or_else(|e| e.into_inner());
            queue.clips.clear();
            queue.reset = true;
        }
        let channels = usize::from(channels.max(1));
        if listener.as_ref().is_none_or(|(_, r, c)| (*r, *c) != (rate, channels)) {
            let created: Box<dyn Segmenter> = match &settings.vad {
                Some(vad) => vad.0.segmenter(rate, channels, crate::vad::MAX_SPEECH_SECONDS),
                None => {
                    let limit = settings.record_timeout.min(settings.phrase_timeout);
                    Box::new(EnergyListener::new(rate, channels, settings.threshold, settings.automatic_threshold, limit))
                }
            };
            listener = Some((created, rate, channels));
            shared.clips.lock().unwrap_or_else(|e| e.into_inner()).format = Some((rate, channels));
        }
        let (current, _, _) = listener.as_mut().expect("made above");
        let heard = current.feed(&samples);
        if energy {
            for value in heard.energies {
                if !shared.running() {
                    return;
                }
                (shared.on_event)(Event::Energy(value));
            }
        }
        if transcribing && !heard.segments.is_empty() {
            let mut queue = shared.clips.lock().unwrap_or_else(|e| e.into_inner());
            for segment in heard.segments {
                if queue.clips.len() >= AUDIO_QUEUE {
                    queue.clips.pop_front();
                }
                queue.clips.push_back(Clip { samples: segment.samples, ended: std::time::Instant::now(), cut: segment.cut });
            }
            drop(queue);
            shared.ready.notify_all();
        }
    }
}

fn transcribe(shared: Arc<Shared>, settings: Settings, mut recognize: Recognize) {
    let mut phrases: Option<(Phrases, u32, usize)> = None;
    while shared.running() {
        let mut pending = {
            let mut queue = shared.clips.lock().unwrap_or_else(|e| e.into_inner());
            if std::mem::take(&mut queue.reset) {
                phrases = None;
            }
            let timeout = phrases.as_ref().and_then(|(p, _, _)| p.wait_timeout());
            if queue.clips.is_empty() && shared.running() {
                queue = match timeout {
                    Some(timeout) => shared.ready.wait_timeout(queue, timeout).unwrap_or_else(|e| e.into_inner()).0,
                    None => shared.ready.wait_timeout(queue, Duration::from_millis(200)).unwrap_or_else(|e| e.into_inner()).0,
                };
            }
            if !shared.running() {
                return;
            }
            let Some((rate, channels)) = queue.format else { continue };
            if phrases.as_ref().is_none_or(|(_, r, c)| (*r, *c) != (rate, channels)) {
                let built = Phrases::new(rate, channels, settings.phrase_timeout, settings.max_phrases);
                phrases = Some((if settings.vad.is_some() { built.segmented() } else { built }, rate, channels));
            }
            std::mem::take(&mut queue.clips)
        };
        let (builder, rate, channels) = phrases.as_mut().expect("made above");
        let (rate, channels) = (*rate, *channels);
        let mut asr = |samples: &[i16]| recognize(&pcm::to_mono(samples, channels), rate);
        let drained = builder.drain(&mut pending, &mut asr);
        // What was not drained goes back in front of anything newer.
        if !pending.is_empty() {
            let mut queue = shared.clips.lock().unwrap_or_else(|e| e.into_inner());
            while let Some(clip) = pending.pop_back() {
                queue.clips.push_front(clip);
            }
        }
        if let Err(failed) = drained {
            shared.fail(Failure::asr(failed.error));
            return;
        }
        for result in builder.take_results() {
            if !shared.running() {
                return;
            }
            (shared.on_event)(Event::Transcript(result));
        }
    }
}
