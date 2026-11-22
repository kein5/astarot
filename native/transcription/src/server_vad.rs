//! Voice activity detection of the recorder on a speech.cpp server (decision 13 in
//! `docs/voice-stack/core-integration.md`: Silero VAD as the GGUF model speech.cpp fetches).
//!
//! speech.cpp 0.11.2 runs a detection model only inside transcriptions and Realtime sessions:
//! its worker refuses detection models, and `speech vad` reads whole files. So a segmenter opens
//! a Realtime session on the server with no transcription (`transcription: null`) and OpenAI's
//! `server_vad`, streams the device's audio to it at 24 kHz, and cuts the device's audio where
//! the server says speech started and stopped (`audio_start_ms`, `audio_end_ms`). The server
//! needs a recognition model loaded to take the session; nothing is transcribed.
//!
//! The values follow Python's VAD (`audio_vad.VadSegmenter`, whose probability threshold,
//! hangover and pre-roll were 0.25, 768 ms and 160 ms): threshold 0.25, 160 ms of padding and
//! 768 ms of silence. Speech that goes on past the longest segment is cut here, as Python cut it
//! (`MAX_SPEECH_SECONDS`), while the server's region goes on.
//!
//! The energy listener the recorder hands over hears the same audio all along: it gives the
//! volume meter, and it cuts phrases instead when the server cannot be used (none set up, not
//! running, refusing `server_vad`, or gone). The reason is reported once. Nothing here logs audio.

use crate::pcm::{self, Resampler};
use crate::realtime::session::{RATE, Socket, base64, open_socket};
use crate::vad::{Cut, Noted, Segment, Segmenter, Segments, VadEngine};
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, TryRecvError, channel};
use std::time::{Duration, Instant};
use tungstenite::Message;

/// How speech.cpp's `server_vad` cuts.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Options {
    /// The speech probability from which audio counts as speech.
    pub threshold: f64,
    /// The audio kept before each region's speech, and after it within the silence that ends it.
    pub prefix_padding_ms: u32,
    /// The silence that ends a region.
    pub silence_duration_ms: u32,
}

/// Python's values (`audio_vad.VadSegmenter`): threshold 0.25, a pre-roll of 5 frames of 32 ms
/// and a hangover of 24 frames.
pub const PYTHON: Options = Options { threshold: 0.25, prefix_padding_ms: 160, silence_duration_ms: 768 };

/// The base URL of a speech.cpp server to detect speech on, or the code why there is none.
pub type Resolve = Arc<dyn Fn() -> Result<String, String> + Send + Sync>;
/// Told the code once when a segmenter cuts by volume instead.
pub type Report = Arc<dyn Fn(&str) + Send + Sync>;

/// The audio kept before a region can start: a region's start comes about 0.26 s after the
/// speech began, padded before it.
const KEEP_SECONDS: f64 = 3.0;
/// Audio sent to the server in pieces of at most this many 24 kHz samples (200 ms).
const PIECE: usize = RATE as usize / 5;

/// The engine: a segmenter per device format, each with its own session.
pub struct ServerVad {
    resolve: Resolve,
    report: Report,
    options: Options,
}

impl ServerVad {
    pub fn new(resolve: Resolve, report: Report, options: Options) -> ServerVad {
        ServerVad { resolve, report, options }
    }
}

impl VadEngine for ServerVad {
    fn segmenter(&self, rate: u32, channels: usize, max_speech_seconds: f64, fallback: Box<dyn Segmenter>) -> Box<dyn Segmenter> {
        Box::new(ServerSegmenter::new(
            Arc::clone(&self.resolve),
            Arc::clone(&self.report),
            self.options,
            rate,
            channels,
            max_speech_seconds,
            fallback,
        ))
    }
}

enum Link {
    /// The session is being opened on another thread; audio waits to be sent.
    Opening(Receiver<Result<Socket, String>>),
    Open(Box<Socket>),
    /// The energy listener cuts from now on.
    Failed,
}

/// Opens and configures a session, or says why not.
fn open(resolve: &Resolve, options: Options) -> Result<Socket, String> {
    let base = resolve()?;
    let setup = Duration::from_secs(2);
    let mut socket = open_socket(&base, None, setup, None).ok_or_else(|| "speech_server_not_ready".to_string())?;
    let deadline = Instant::now() + setup;
    let created = read_setup(&mut socket, deadline)?;
    if created["type"] != "session.created" {
        return Err("realtime_session_failed".into());
    }
    let update = json!({ "type": "session.update", "session": { "type": "transcription", "audio": { "input": {
        "format": { "type": "audio/pcm", "rate": RATE },
        "transcription": null,
        "turn_detection": {
            "type": "server_vad",
            "threshold": options.threshold,
            "prefix_padding_ms": options.prefix_padding_ms,
            "silence_duration_ms": options.silence_duration_ms,
        },
        "noise_reduction": null,
    } } } });
    socket.send(Message::text(update.to_string())).map_err(|_| "realtime_session_failed".to_string())?;
    let answer = read_setup(&mut socket, deadline)?;
    let input = &answer["session"]["audio"]["input"];
    if answer["type"] == "error" {
        // A server without a detection model answers `server_vad` with an error event.
        return Err("realtime_vad_model_missing".into());
    }
    if answer["type"] != "session.updated" || input["turn_detection"]["type"] != "server_vad" || !input["transcription"].is_null() {
        return Err("realtime_session_failed".into());
    }
    socket.get_mut().set_nonblocking(true).map_err(|_| "realtime_session_failed".to_string())?;
    Ok(socket)
}

fn read_setup(socket: &mut Socket, deadline: Instant) -> Result<Value, String> {
    loop {
        if Instant::now() >= deadline {
            return Err("realtime_session_failed".into());
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                if let Ok(value) = serde_json::from_str::<Value>(text.as_str()) {
                    return Ok(value);
                }
                return Err("realtime_session_failed".into());
            }
            Ok(Message::Close(_)) => return Err("realtime_session_failed".into()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(_) => return Err("realtime_session_failed".into()),
        }
    }
}

/// Cuts one device's audio where the server finds speech.
pub struct ServerSegmenter {
    report: Report,
    rate: u32,
    channels: usize,
    max_frames: u64,
    link: Link,
    fallback: Box<dyn Segmenter>,
    /// What the energy listener cut while the session opened: given if it does not open.
    held: Vec<Segment>,
    resampler: Resampler,
    /// 24 kHz audio not sent yet (while the session opens).
    unsent: Vec<i16>,
    /// Device frames heard since the session's audio began.
    heard: u64,
    /// The device's audio from frame `kept_from` on, interleaved.
    kept: VecDeque<i16>,
    kept_from: u64,
    /// The first frame of the segment under way.
    speaking: Option<u64>,
    /// The end of the last segment given: no segment starts before it.
    given_to: u64,
    /// What was noticed since the last feed, for the diagnostics.
    noted: Vec<Noted>,
}

impl ServerSegmenter {
    fn new(
        resolve: Resolve,
        report: Report,
        options: Options,
        rate: u32,
        channels: usize,
        max_speech_seconds: f64,
        fallback: Box<dyn Segmenter>,
    ) -> ServerSegmenter {
        let (sender, receiver) = channel();
        let opening = std::thread::Builder::new().name("vad-session".into()).spawn(move || {
            let _ = sender.send(open(&resolve, options));
        });
        let link = match opening {
            Ok(_) => Link::Opening(receiver),
            Err(_) => Link::Failed,
        };
        let mut segmenter = ServerSegmenter {
            report,
            rate: rate.max(1),
            channels: channels.max(1),
            max_frames: (max_speech_seconds * f64::from(rate.max(1))).round().max(1.0) as u64,
            link,
            fallback,
            held: Vec::new(),
            resampler: Resampler::new(rate.max(1), RATE),
            unsent: Vec::new(),
            heard: 0,
            kept: VecDeque::new(),
            kept_from: 0,
            speaking: None,
            given_to: 0,
            noted: Vec::new(),
        };
        if matches!(segmenter.link, Link::Failed) {
            segmenter.fail("realtime_session_failed");
        }
        segmenter
    }

    fn fail(&mut self, code: &str) {
        if let Link::Open(socket) = &mut self.link {
            let _ = socket.close(None);
        }
        self.link = Link::Failed;
        self.kept.clear();
        self.unsent.clear();
        self.speaking = None;
        (self.report)(code);
    }

    /// The device frame at a time of the session's audio.
    fn frame_at(&self, ms: f64) -> u64 {
        (ms.max(0.0) * f64::from(self.rate) / 1000.0).round() as u64
    }

    /// The time of a number of device frames.
    fn duration(&self, frames: u64) -> Duration {
        Duration::from_secs_f64(frames as f64 / f64::from(self.rate))
    }

    fn give(&mut self, start: u64, end: u64, cut: Cut, segments: &mut Vec<Segment>) {
        let start = start.max(self.kept_from).max(self.given_to);
        let end = end.min(self.heard);
        if end <= start {
            return;
        }
        let from = ((start - self.kept_from) as usize) * self.channels;
        let to = (((end - self.kept_from) as usize) * self.channels).min(self.kept.len());
        let samples: Vec<i16> = self.kept.range(from..to).copied().collect();
        self.given_to = end;
        if !samples.is_empty() {
            let length = self.duration((samples.len() / self.channels) as u64);
            // A natural end is known once the silence after it has lasted: what was heard since.
            let waited = if cut == Cut::Silence { self.duration(self.heard - end) } else { Duration::ZERO };
            self.noted.push(Noted::End { cut, length, waited });
            segments.push(Segment { samples, cut });
        }
    }

    fn event(&mut self, event: &Value, segments: &mut Vec<Segment>) -> Result<(), String> {
        match event["type"].as_str() {
            Some("input_audio_buffer.speech_started") => {
                let start = self.frame_at(event["audio_start_ms"].as_f64().unwrap_or(0.0));
                // A region the server cut at 10 s goes on as the segment under way.
                if self.speaking.is_none() {
                    self.speaking = Some(start.max(self.given_to));
                    self.noted.push(Noted::Start);
                }
            }
            Some("input_audio_buffer.speech_stopped") => {
                let end = self.frame_at(event["audio_end_ms"].as_f64().unwrap_or(0.0));
                if let Some(start) = self.speaking.take() {
                    self.give(start, end, Cut::Silence, segments);
                }
                self.given_to = self.given_to.max(end.min(self.heard));
            }
            Some("error") => return Err("realtime_session_failed".into()),
            _ => {}
        }
        Ok(())
    }

    fn send(&mut self) -> Result<(), String> {
        let Link::Open(socket) = &mut self.link else { return Ok(()) };
        for piece in self.unsent.chunks(PIECE) {
            let message = json!({ "type": "input_audio_buffer.append", "audio": base64(&pcm::bytes(piece)) });
            match socket.send(Message::text(message.to_string())) {
                Ok(()) => {}
                // Queued: the next send or flush writes it.
                Err(tungstenite::Error::Io(e)) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => return Err("realtime_session_failed".into()),
            }
        }
        self.unsent.clear();
        Ok(())
    }

    fn receive(&mut self, segments: &mut Vec<Segment>) -> Result<(), String> {
        loop {
            let Link::Open(socket) = &mut self.link else { return Ok(()) };
            let event = match socket.read() {
                Ok(Message::Text(text)) => serde_json::from_str::<Value>(text.as_str()).map_err(|_| "realtime_session_failed".to_string())?,
                Ok(Message::Close(_)) => return Err("realtime_session_failed".into()),
                Ok(_) => continue,
                Err(tungstenite::Error::Io(e)) if e.kind() == std::io::ErrorKind::WouldBlock => return Ok(()),
                Err(_) => return Err("realtime_session_failed".into()),
            };
            self.event(&event, segments)?;
        }
    }

    /// Drops what no region can reach any more.
    fn trim(&mut self) {
        let keep = (KEEP_SECONDS * f64::from(self.rate)) as u64;
        let from = match self.speaking {
            Some(start) => start.max(self.given_to).min(self.heard),
            None => self.heard.saturating_sub(keep).max(self.given_to.min(self.heard)),
        };
        if from > self.kept_from {
            let drop = (((from - self.kept_from) as usize) * self.channels).min(self.kept.len());
            self.kept.drain(..drop);
            self.kept_from = from;
        }
    }
}

impl Segmenter for ServerSegmenter {
    fn feed(&mut self, samples: &[i16]) -> Segments {
        let mut heard = self.fallback.feed(samples);
        if matches!(self.link, Link::Failed) {
            heard.segments.splice(0..0, std::mem::take(&mut self.held));
            return heard;
        }
        if matches!(self.link, Link::Opening(_)) {
            self.held.append(&mut heard.segments);
        }
        let mut segments = Vec::new();
        let frames = samples.len() / self.channels;
        let samples = &samples[..frames * self.channels];
        self.kept.extend(samples.iter().copied());
        self.heard += frames as u64;
        let mono = pcm::to_mono(samples, self.channels);
        self.unsent.extend(pcm::to_i16(&self.resampler.process(&pcm::to_f32(&mono))));
        if let Link::Opening(receiver) = &self.link {
            let opened = match receiver.try_recv() {
                Ok(Ok(socket)) => Ok(Some(socket)),
                Ok(Err(code)) => Err(code),
                Err(TryRecvError::Empty) => Ok(None),
                Err(TryRecvError::Disconnected) => Err("realtime_session_failed".to_string()),
            };
            match opened {
                Ok(Some(socket)) => {
                    // The server hears the same audio from its start: what was held goes.
                    self.held.clear();
                    self.link = Link::Open(Box::new(socket));
                }
                Ok(None) => {}
                Err(code) => {
                    self.fail(&code);
                    heard.segments = std::mem::take(&mut self.held);
                    return heard;
                }
            }
        }
        if let Err(code) = self.send().and_then(|()| self.receive(&mut segments)) {
            self.fail(&code);
            return heard;
        }
        // Speech that goes on is cut at the longest segment; the region goes on.
        while let Some(start) = self.speaking {
            let start = start.max(self.given_to);
            if self.heard - start < self.max_frames {
                self.speaking = Some(start);
                break;
            }
            self.give(start, start + self.max_frames, Cut::Limit, &mut segments);
            self.speaking = Some(start + self.max_frames);
        }
        self.trim();
        Segments { energies: heard.energies, segments, noted: std::mem::take(&mut self.noted) }
    }

    fn reset(&mut self) {
        self.fallback.reset();
        if matches!(self.link, Link::Failed) {
            return;
        }
        self.kept.clear();
        self.kept_from = self.heard;
        self.given_to = self.heard;
        self.speaking = None;
        // A clear drops what the server holds; detection begins again on the audio that follows.
        if let Link::Open(socket) = &mut self.link {
            let clear = json!({ "type": "input_audio_buffer.clear" });
            match socket.send(Message::text(clear.to_string())) {
                Ok(()) => {}
                Err(tungstenite::Error::Io(e)) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => self.fail("realtime_session_failed"),
            }
        }
    }
}

impl Drop for ServerSegmenter {
    fn drop(&mut self) {
        if let Link::Open(socket) = &mut self.link {
            let _ = socket.close(None);
            let _ = socket.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::energy::EnergyListener;
    use std::net::TcpListener;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const DEVICE_RATE: u32 = 48000;
    const CHANNELS: usize = 2;

    #[derive(Clone, Copy, PartialEq)]
    enum Mode {
        Detects,
        /// No detection model: `server_vad` is answered with an error event.
        NoDetection,
        /// The connection ends once this much audio arrived (ms).
        DropsAfter(f64),
    }

    /// A speech.cpp server's Realtime endpoint that "detects" the given regions (ms of the
    /// session's audio): `speech_started` 260 ms into a region, with the region's start less the
    /// padding, and `speech_stopped` once the silence after it has lasted, with its end plus the
    /// padding.
    struct Server {
        port: u16,
        clears: Arc<AtomicUsize>,
        configs: Arc<Mutex<Vec<Value>>>,
    }

    fn decoded_samples(text: &str) -> usize {
        let padding = text.bytes().rev().take_while(|b| *b == b'=').count();
        (text.len() / 4 * 3 - padding) / 2
    }

    impl Server {
        fn start(regions: Vec<(f64, f64)>, mode: Mode) -> Server {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let clears = Arc::new(AtomicUsize::new(0));
            let configs = Arc::new(Mutex::new(Vec::new()));
            let (counted, saved) = (Arc::clone(&clears), Arc::clone(&configs));
            std::thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    let (regions, counted, saved) = (regions.clone(), Arc::clone(&counted), Arc::clone(&saved));
                    std::thread::spawn(move || {
                        let Ok(mut socket) = tungstenite::accept(stream) else { return };
                        let _ = socket.send(Message::text(json!({ "type": "session.created", "event_id": "e0" }).to_string()));
                        let mut heard_ms = 0.0;
                        let (mut started, mut stopped) = (vec![false; regions.len()], vec![false; regions.len()]);
                        while let Ok(message) = socket.read() {
                            let Message::Text(text) = message else { continue };
                            let event: Value = serde_json::from_str(text.as_str()).unwrap();
                            match event["type"].as_str() {
                                Some("session.update") => {
                                    saved.lock().unwrap().push(event["session"].clone());
                                    let answer = if mode == Mode::NoDetection {
                                        json!({ "type": "error", "error": { "message": "give it a detection model" } })
                                    } else {
                                        json!({ "type": "session.updated", "session": event["session"] })
                                    };
                                    let _ = socket.send(Message::text(answer.to_string()));
                                }
                                Some("input_audio_buffer.clear") => {
                                    counted.fetch_add(1, Ordering::SeqCst);
                                }
                                Some("input_audio_buffer.append") => {
                                    heard_ms += decoded_samples(event["audio"].as_str().unwrap()) as f64 / 24.0;
                                    if let Mode::DropsAfter(ms) = mode
                                        && heard_ms >= ms
                                    {
                                        return;
                                    }
                                    for (i, (start, end)) in regions.iter().enumerate() {
                                        if !started[i] && heard_ms >= start + 260.0 {
                                            started[i] = true;
                                            let event = json!({ "type": "input_audio_buffer.speech_started", "audio_start_ms": start - 160.0, "item_id": format!("i{i}") });
                                            let _ = socket.send(Message::text(event.to_string()));
                                        }
                                        if started[i] && !stopped[i] && heard_ms >= end + 768.0 {
                                            stopped[i] = true;
                                            let event = json!({ "type": "input_audio_buffer.speech_stopped", "audio_end_ms": end + 160.0, "item_id": format!("i{i}") });
                                            let _ = socket.send(Message::text(event.to_string()));
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    });
                }
            });
            Server { port, clears, configs }
        }

        fn base(&self) -> String {
            format!("http://127.0.0.1:{}", self.port)
        }
    }

    /// Each frame's two channels carry its index (mod 30000), so a segment shows where it began.
    fn frames(from: u64, count: u64, loud: bool) -> Vec<i16> {
        let mut samples = Vec::with_capacity((count as usize) * CHANNELS);
        for frame in from..from + count {
            let value = if loud { (frame % 30000) as i16 + 1000 } else { 0 };
            samples.extend(std::iter::repeat_n(value, CHANNELS));
        }
        samples
    }

    struct Feeding {
        segmenter: Box<dyn Segmenter>,
        reports: Arc<Mutex<Vec<String>>>,
        fed: u64,
        segments: Vec<Segment>,
        energies: usize,
        noted: Vec<Noted>,
    }

    impl Feeding {
        fn new(resolve: Result<String, String>, max_seconds: f64) -> Feeding {
            let reports = Arc::new(Mutex::new(Vec::new()));
            let told = Arc::clone(&reports);
            let engine = ServerVad::new(
                Arc::new(move || resolve.clone()),
                Arc::new(move |code: &str| told.lock().unwrap().push(code.to_string())),
                PYTHON,
            );
            let fallback = Box::new(EnergyListener::new(DEVICE_RATE, CHANNELS, 300.0, false, 0.0));
            Feeding {
                segmenter: engine.segmenter(DEVICE_RATE, CHANNELS, max_seconds, fallback),
                reports,
                fed: 0,
                segments: Vec::new(),
                energies: 0,
                noted: Vec::new(),
            }
        }

        /// Feeds `ms` of audio in pieces of 10 ms, a little behind the device's pace so the
        /// server's events come in between.
        fn feed(&mut self, ms: u64, loud: bool) {
            for _ in 0..ms / 10 {
                let count = u64::from(DEVICE_RATE) / 100;
                let found = self.segmenter.feed(&frames(self.fed, count, loud));
                self.fed += count;
                self.energies += found.energies.len();
                self.segments.extend(found.segments);
                self.noted.extend(found.noted);
                std::thread::sleep(Duration::from_micros(300));
            }
        }

        /// Feeds silence until `done` holds, for at most 10 s.
        fn until(&mut self, done: impl Fn(&Feeding) -> bool) {
            let deadline = Instant::now() + Duration::from_secs(10);
            while !done(self) {
                assert!(Instant::now() < deadline, "the server's events did not come");
                self.feed(10, false);
            }
        }
    }

    fn frame(ms: f64) -> u64 {
        (ms * f64::from(DEVICE_RATE) / 1000.0).round() as u64
    }

    #[test]
    fn a_region_the_server_finds_cuts_the_devices_audio_between_its_times() {
        let server = Server::start(vec![(1000.0, 2000.0)], Mode::Detects);
        let mut feeding = Feeding::new(Ok(server.base()), MAX);
        feeding.feed(1000, false);
        feeding.feed(1000, true);
        feeding.until(|f| !f.segments.is_empty());
        let segment = &feeding.segments[0];
        assert_eq!(segment.cut, Cut::Silence);
        // From the region's start less the padding to its end plus the padding.
        let (start, end) = (frame(840.0), frame(2160.0));
        assert_eq!(segment.samples.len() as u64, (end - start) * CHANNELS as u64);
        assert_eq!(segment.samples[0], 0, "the padding before the speech is the silence heard");
        let first_loud = (frame(1000.0) - start) as usize * CHANNELS;
        assert_eq!(segment.samples[first_loud], (frame(1000.0) % 30000) as i16 + 1000);
        assert!(feeding.reports.lock().unwrap().is_empty());
        assert!(feeding.energies > 0, "the volume meter still hears the energy listener");
        // The session asked for detection alone, with Python's values.
        let config = server.configs.lock().unwrap()[0].clone();
        assert!(config["audio"]["input"]["transcription"].is_null());
        assert_eq!(config["audio"]["input"]["turn_detection"], json!({ "type": "server_vad", "threshold": 0.25, "prefix_padding_ms": 160, "silence_duration_ms": 768 }));
        assert_eq!(config["audio"]["input"]["format"], json!({ "type": "audio/pcm", "rate": 24000 }));
    }

    const MAX: f64 = crate::vad::MAX_SPEECH_SECONDS;

    #[test]
    fn speech_past_the_longest_segment_is_cut_there_and_goes_on() {
        // The region's end (2660 ms with its padding) is told 608 ms later, before the third
        // second of the segment is up.
        let server = Server::start(vec![(500.0, 2500.0)], Mode::Detects);
        let mut feeding = Feeding::new(Ok(server.base()), 1.0);
        feeding.feed(500, false);
        feeding.feed(2000, true);
        feeding.until(|f| f.segments.iter().any(|s| s.cut == Cut::Silence));
        let cuts: Vec<(Cut, usize)> = feeding.segments.iter().map(|s| (s.cut, s.samples.len() / CHANNELS)).collect();
        let second = frame(1000.0) as usize;
        let rest = (frame(2660.0) - frame(340.0)) as usize - 2 * second;
        assert_eq!(cuts, [(Cut::Limit, second), (Cut::Limit, second), (Cut::Silence, rest)]);
        // The pieces follow each other without a gap or an overlap.
        let first = &feeding.segments[1];
        assert_eq!(first.samples[0], ((frame(340.0) + frame(1000.0)) % 30000) as i16 + 1000);
        // For the diagnostics: one start, and each piece's length; a cut at the limit waited for
        // nothing, the natural end for the silence after it (768 ms after the speech, 608 ms after
        // the padding) and for the event to arrive.
        let length = |frames: usize| Duration::from_secs_f64(frames as f64 / f64::from(DEVICE_RATE));
        assert_eq!(feeding.noted.len(), 4, "{:?}", feeding.noted);
        assert_eq!(feeding.noted[0], Noted::Start);
        for (noted, cut, frames) in [(feeding.noted[1], Cut::Limit, second), (feeding.noted[2], Cut::Limit, second)] {
            assert_eq!(noted, Noted::End { cut, length: length(frames), waited: Duration::ZERO });
        }
        let Noted::End { cut, length: last, waited } = feeding.noted[3] else { panic!("{:?}", feeding.noted) };
        assert_eq!((cut, last), (Cut::Silence, length(rest)));
        assert!(waited >= Duration::from_millis(600) && waited < Duration::from_secs(2), "{waited:?}");
    }

    #[test]
    fn without_a_server_the_energy_listener_cuts_and_the_reason_is_told_once() {
        let mut feeding = Feeding::new(Err("speech_server_not_ready".into()), MAX);
        feeding.feed(300, false);
        feeding.feed(1000, true);
        feeding.feed(1500, false);
        assert_eq!(*feeding.reports.lock().unwrap(), ["speech_server_not_ready"]);
        assert_eq!(feeding.segments.len(), 1, "the phrase the energy listener cut");
        assert_eq!(feeding.segments[0].cut, Cut::Silence);
        assert!(feeding.energies > 0);
    }

    #[test]
    fn a_phrase_cut_while_the_session_opens_is_kept_if_it_does_not_open() {
        // A closed port can take seconds to refuse: the phrase heard meanwhile is not lost.
        let reports = Arc::new(Mutex::new(Vec::new()));
        let told = Arc::clone(&reports);
        let engine = ServerVad::new(
            Arc::new(|| {
                std::thread::sleep(Duration::from_millis(800));
                Err("speech_server_not_ready".to_string())
            }),
            Arc::new(move |code: &str| told.lock().unwrap().push(code.to_string())),
            PYTHON,
        );
        let fallback = Box::new(EnergyListener::new(DEVICE_RATE, CHANNELS, 300.0, false, 0.0));
        let mut feeding = Feeding { segmenter: engine.segmenter(DEVICE_RATE, CHANNELS, MAX, fallback), reports, fed: 0, segments: Vec::new(), energies: 0, noted: Vec::new() };
        // Fed at once, well before the refusal comes.
        for (ms, loud) in [(200, false), (500, true), (1200, false)] {
            let count = u64::from(DEVICE_RATE) * ms / 1000;
            let found = feeding.segmenter.feed(&frames(feeding.fed, count, loud));
            feeding.fed += count;
            assert!(found.segments.is_empty(), "held while the session opens");
        }
        feeding.until(|f| !f.segments.is_empty());
        assert_eq!(*feeding.reports.lock().unwrap(), ["speech_server_not_ready"]);
        assert_eq!(feeding.segments.len(), 1);
    }

    #[test]
    fn a_server_without_a_detection_model_is_told_and_the_energy_listener_cuts() {
        let server = Server::start(vec![(500.0, 1500.0)], Mode::NoDetection);
        let mut feeding = Feeding::new(Ok(server.base()), MAX);
        feeding.until(|f| !f.reports.lock().unwrap().is_empty());
        assert_eq!(*feeding.reports.lock().unwrap(), ["realtime_vad_model_missing"]);
        feeding.feed(1000, true);
        feeding.feed(1500, false);
        assert_eq!(feeding.segments.len(), 1);
    }

    #[test]
    fn a_session_that_ends_is_told_once_and_the_energy_listener_takes_over() {
        let server = Server::start(vec![(3000.0, 4000.0)], Mode::DropsAfter(1000.0));
        let mut feeding = Feeding::new(Ok(server.base()), MAX);
        feeding.feed(1000, false);
        feeding.until(|f| !f.reports.lock().unwrap().is_empty());
        assert_eq!(*feeding.reports.lock().unwrap(), ["realtime_session_failed"]);
        feeding.feed(1000, true);
        feeding.feed(1500, false);
        assert_eq!(feeding.segments.len(), 1, "cut by volume from then on");
        assert_eq!(feeding.reports.lock().unwrap().len(), 1, "told once");
    }

    #[test]
    fn a_reset_drops_the_segment_under_way_and_clears_the_server() {
        let server = Server::start(vec![(500.0, 2500.0)], Mode::Detects);
        let mut feeding = Feeding::new(Ok(server.base()), MAX);
        feeding.feed(500, false);
        feeding.feed(1000, true);
        feeding.segmenter.reset();
        feeding.feed(1000, true);
        feeding.feed(2000, false);
        assert!(feeding.segments.is_empty(), "{}", feeding.segments.len());
        let deadline = Instant::now() + Duration::from_secs(5);
        while server.clears.load(Ordering::SeqCst) == 0 {
            assert!(Instant::now() < deadline);
            feeding.feed(10, false);
        }
    }
}
