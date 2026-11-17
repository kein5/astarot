//! Microphones and speakers in memory, in place of WASAPI and the Linux capture helper: a
//! capture delivers 16-bit PCM paced like a device (10 ms every 10 ms at 44.1 or 48 kHz). The
//! test says what each source "hears": loud blocks that the energy listener takes for speech,
//! then quiet. No real device is touched.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vrct_audio_routing::graph::Endpoint;
use vrct_transcription::capture::{Capture, CapturePlatform, OnAudio, OnError, Source, Target};

/// One stretch of sound: an amplitude for a while.
#[derive(Clone, Copy, Debug)]
pub struct Sound {
    pub level: i16,
    pub duration: Duration,
}

pub fn speech(millis: u64) -> Sound {
    Sound { level: 3000, duration: Duration::from_millis(millis) }
}

pub fn quiet(millis: u64) -> Sound {
    Sound { level: 0, duration: Duration::from_millis(millis) }
}

#[derive(Default)]
struct Inner {
    /// What each source hears next (mic, speaker); quiet after it.
    script: [Mutex<VecDeque<Sound>>; 2],
    /// Device rate and channels of each source.
    format: Mutex<[(u32, u16); 2]>,
    /// Targets that refuse to open (endpoint IDs or endpoint names).
    refused: Mutex<Vec<String>>,
    /// What was opened, in order: (source, endpoint id or name).
    opened: Mutex<Vec<(Source, String)>>,
    running: [AtomicUsize; 2],
    /// Failures to inject into the running capture of a source.
    fail: [AtomicBool; 2],
    endpoints: Mutex<Vec<(Source, Endpoint, String)>>,
    default: Mutex<[Option<String>; 2]>,
}

#[derive(Clone)]
pub struct FakeCapture(Arc<Inner>);

fn index(source: Source) -> usize {
    match source {
        Source::Mic => 0,
        Source::Speaker => 1,
    }
}

impl Default for FakeCapture {
    fn default() -> Self {
        let fake = FakeCapture(Arc::default());
        *fake.0.format.lock().unwrap() = [(48000, 2), (44100, 2)];
        fake
    }
}

impl FakeCapture {
    pub fn new() -> Self {
        Self::default()
    }

    /// The services' factory.
    pub fn factory(&self) -> vrct_core::controller::TranscriptionCapture {
        let fake = self.clone();
        Arc::new(move |_| Arc::new(fake.clone()) as Arc<dyn CapturePlatform>)
    }

    pub fn hear(&self, source: Source, sounds: &[Sound]) {
        self.0.script[index(source)].lock().unwrap().extend(sounds.iter().copied());
    }

    pub fn set_format(&self, source: Source, rate: u32, channels: u16) {
        self.0.format.lock().unwrap()[index(source)] = (rate, channels);
    }

    pub fn refuse(&self, target: &str) {
        self.0.refused.lock().unwrap().push(target.to_string());
    }

    pub fn opened(&self) -> Vec<(Source, String)> {
        self.0.opened.lock().unwrap().clone()
    }

    pub fn running(&self, source: Source) -> usize {
        self.0.running[index(source)].load(Ordering::SeqCst)
    }

    /// The running capture of `source` fails as an unplugged device does.
    pub fn break_device(&self, source: Source) {
        self.0.fail[index(source)].store(true, Ordering::SeqCst);
    }

    pub fn add_endpoint(&self, source: Source, name: &str, label: &str) -> Endpoint {
        let class = if source == Source::Mic { "Audio/Source" } else { "Audio/Sink" };
        let endpoint = Endpoint { cookie: 7, serial: 100 + self.0.endpoints.lock().unwrap().len() as u64, name: name.into(), media_class: class.into() };
        self.0.endpoints.lock().unwrap().push((source, endpoint.clone(), label.into()));
        endpoint
    }

    pub fn set_default(&self, source: Source, name: Option<&str>) {
        self.0.default.lock().unwrap()[index(source)] = name.map(str::to_string);
    }
}

struct Running {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Capture for Running {
    fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    fn stop(&mut self) -> bool {
        self.request_stop();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        true
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.request_stop();
    }
}

impl CapturePlatform for FakeCapture {
    fn open(&self, source: Source, target: &Target, _: Duration, mut on_audio: OnAudio, mut on_error: OnError) -> Result<Box<dyn Capture>, String> {
        let name = match target {
            Target::Device(device) => device.endpoint_id.clone().unwrap_or_else(|| device.name.clone()),
            Target::Endpoint(endpoint) => endpoint.name.clone(),
        };
        if self.0.refused.lock().unwrap().contains(&name) {
            return Err("asr_capture_stream_create_failed".into());
        }
        self.0.opened.lock().unwrap().push((source, name));
        self.0.fail[index(source)].store(false, Ordering::SeqCst);
        let (rate, channels) = self.0.format.lock().unwrap()[index(source)];
        let stop = Arc::new(AtomicBool::new(false));
        let (inner, flag) = (Arc::clone(&self.0), Arc::clone(&stop));
        inner.running[index(source)].fetch_add(1, Ordering::SeqCst);
        let thread = std::thread::spawn(move || {
            let block = (rate / 100) as usize;
            let mut current: Option<(Sound, Duration)> = None;
            let started = Instant::now();
            let mut sent = 0u64;
            while !flag.load(Ordering::SeqCst) {
                if inner.fail[index(source)].swap(false, Ordering::SeqCst) {
                    on_error("asr_capture_stream_disconnected");
                    break;
                }
                // Device pacing: a block is due every 10 ms.
                let due = started + Duration::from_millis(sent * 10);
                if let Some(wait) = due.checked_duration_since(Instant::now()) {
                    std::thread::sleep(wait);
                }
                sent += 1;
                if current.as_ref().is_none_or(|(sound, played)| *played >= sound.duration) {
                    current = inner.script[index(source)].lock().unwrap().pop_front().map(|s| (s, Duration::ZERO));
                }
                let level = match current.as_mut() {
                    Some((sound, played)) => {
                        *played += Duration::from_millis(10);
                        sound.level
                    }
                    None => 0,
                };
                let samples: Vec<i16> =
                    (0..block * usize::from(channels)).map(|i| if (i / usize::from(channels)) % 2 == 0 { level } else { -level }).collect();
                if !on_audio(&samples, rate, channels) {
                    break;
                }
            }
            inner.running[index(source)].fetch_sub(1, Ordering::SeqCst);
        });
        Ok(Box::new(Running { stop, thread: Some(thread) }))
    }

    fn endpoints(&self, source: Source) -> Result<Vec<(Endpoint, String)>, String> {
        Ok(self.0.endpoints.lock().unwrap().iter().filter(|(s, _, _)| *s == source).map(|(_, e, l)| (e.clone(), l.clone())).collect())
    }

    fn default_endpoint(&self, source: Source) -> Result<Endpoint, String> {
        let name = self.0.default.lock().unwrap()[index(source)].clone().ok_or("realtime_default_endpoint_missing")?;
        self.0
            .endpoints
            .lock()
            .unwrap()
            .iter()
            .find(|(s, e, _)| *s == source && e.name == name)
            .map(|(_, e, _)| e.clone())
            .ok_or_else(|| "realtime_default_endpoint_missing".to_string())
    }
}
