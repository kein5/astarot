//! Measures the voice pipeline end to end on real models (#556): a recorded Japanese utterance
//! goes through realtime recognition on the bundled speech.cpp server, the local translation,
//! the chatbox and the translated speech, the way the application runs them, and the time of
//! each stage is printed.
//!
//! The core runs in this process as the application starts it, with three stand-ins that keep
//! the PC's own devices out of the measurement:
//!
//! - the microphone plays WAVE files in real time (10 ms blocks, as a capture device delivers
//!   them), with silence between them;
//! - the speech output records when the first audible sample is written and then takes the
//!   audio at the pace of a device (40 ms ahead at most);
//! - the chatbox is a UDP socket on 127.0.0.2.
//!
//! ```sh
//! cargo run --release --locked --manifest-path native/core/Cargo.toml --example pipeline_latency -- \
//!     --app-dir <checkout or extracted package with build/speechcpp> \
//!     --clips <folder of clip*.wav and texts.txt> \
//!     --asr-model <recognition .gguf> --vad-model <silero-vad .gguf> \
//!     --tts-model <Qwen3-TTS .gguf> --translation <m2m100_418M-onnx-int8 folder> \
//!     --runs 3 --out <file.jsonl>
//! ```
//!
//! `ORT_DYLIB_PATH` names the ONNX Runtime library of the translation, as for the application.
//! `texts.txt` holds the expected text of each clip, one line each, in file name order; it is
//! read only to give the recognition's character error rate. No recognised, translated or
//! expected text and no audio is printed or written: only times, counts and error rates.
//!
//! Times are the monotonic clock's (`vrct_tts::clock::monotonic_ns`), the clock of the flow
//! panel's trace. "End of speech" is when the block holding the clip's last voiced sample
//! (10 ms frames within 30 dB of the loudest) reached the core, less the rest of that block.

use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::Write as _;
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use vrct_audio_routing::graph::{Endpoint, OutputOption};
use vrct_audio_routing::router::{Output, PlaybackToken};
use vrct_core::config::{Environment, Platform};
use vrct_core::controller::voice::{NativeVoice, VoicePlatform};
use vrct_core::{Backend, Options, Sink};
use vrct_transcription::capture::{Capture, CapturePlatform, OnAudio, OnError, Source, Target};
use vrct_tts::clock::monotonic_ns;

const RATE: u32 = 48_000;
const BLOCK: usize = (RATE / 100) as usize;
const OUTPUT_DEVICE: &str = "pipeline-latency";
const MIC_ENDPOINT: &str = "pipeline-latency.mic";

// ---------------------------------------------------------------------------------------------
// Arguments

struct Args {
    app_dir: PathBuf,
    clips: PathBuf,
    asr_model: PathBuf,
    vad_model: PathBuf,
    tts_model: PathBuf,
    tts_voice: String,
    translation: PathBuf,
    runs: usize,
    gap: Duration,
    out: Option<PathBuf>,
    device: String,
    label: String,
    /// Realtime recognition's `silence_duration_ms`; the server's own when absent.
    silence_ms: Option<u64>,
}

fn args() -> Args {
    let mut found: HashMap<String, String> = HashMap::new();
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        let Some(name) = arg.strip_prefix("--") else { panic!("unexpected argument {arg}") };
        let value = it.next().unwrap_or_else(|| panic!("--{name} needs a value"));
        found.insert(name.to_string(), value);
    }
    let path = |name: &str| PathBuf::from(found.get(name).unwrap_or_else(|| panic!("--{name} is required")));
    Args {
        app_dir: path("app-dir"),
        clips: path("clips"),
        asr_model: path("asr-model"),
        vad_model: path("vad-model"),
        tts_model: path("tts-model"),
        tts_voice: found.get("tts-voice").cloned().unwrap_or_else(|| "ryan".into()),
        translation: path("translation"),
        runs: found.get("runs").map_or(3, |v| v.parse().expect("--runs takes a number")),
        gap: Duration::from_millis(found.get("gap-ms").map_or(8000, |v| v.parse().expect("--gap-ms takes a number"))),
        out: found.get("out").map(PathBuf::from),
        device: found.get("device").cloned().unwrap_or_else(|| "auto".into()),
        label: found.get("label").cloned().unwrap_or_default(),
        silence_ms: found.get("silence-ms").map(|v| v.parse().expect("--silence-ms takes a number")),
    }
}

// ---------------------------------------------------------------------------------------------
// Clips

struct Clip {
    samples: Vec<i16>,
    /// The index of the last sample of the last voiced 10 ms frame.
    last_voiced: usize,
    expected: String,
}

fn read_wav(path: &Path) -> Vec<i16> {
    let data = std::fs::read(path).expect("the clip can be read");
    assert!(&data[0..4] == b"RIFF" && &data[8..12] == b"WAVE", "{} is not a WAVE file", path.display());
    let mut at = 12;
    let (mut channels, mut rate, mut bits) = (0u16, 0u32, 0u16);
    while at + 8 <= data.len() {
        let id = &data[at..at + 4];
        let size = u32::from_le_bytes(data[at + 4..at + 8].try_into().unwrap()) as usize;
        let body = &data[at + 8..(at + 8 + size).min(data.len())];
        if id == b"fmt " {
            channels = u16::from_le_bytes(body[2..4].try_into().unwrap());
            rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
            bits = u16::from_le_bytes(body[14..16].try_into().unwrap());
        } else if id == b"data" {
            assert!(rate == RATE && bits == 16, "{}: 48 kHz 16-bit clips only", path.display());
            let frames: Vec<i16> = body.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
            // Down to mono by the first channel.
            return frames.chunks(channels.max(1) as usize).map(|f| f[0]).collect();
        }
        at += 8 + size + (size & 1);
    }
    panic!("{} has no data", path.display());
}

fn load_clips(dir: &Path) -> Vec<Clip> {
    let mut names: Vec<PathBuf> = std::fs::read_dir(dir).expect("the clip folder can be read").filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|e| e == "wav")).collect();
    names.sort_by_key(|p| {
        let stem = p.file_stem().unwrap().to_string_lossy().to_string();
        let digits: String = stem.chars().filter(char::is_ascii_digit).collect();
        (digits.parse::<u64>().unwrap_or(u64::MAX), stem)
    });
    let texts = std::fs::read_to_string(dir.join("texts.txt")).unwrap_or_default();
    let texts: Vec<&str> = texts.lines().collect();
    names
        .iter()
        .enumerate()
        .map(|(i, path)| {
            let samples = read_wav(path);
            let frames: Vec<f64> = samples.chunks(BLOCK).map(|f| (f.iter().map(|&s| f64::from(s) * f64::from(s)).sum::<f64>() / f.len() as f64).sqrt()).collect();
            let loudest = frames.iter().copied().fold(0.0, f64::max);
            let last = frames.iter().rposition(|&rms| rms > loudest * 10f64.powf(-30.0 / 20.0)).unwrap_or(0);
            Clip { last_voiced: ((last + 1) * BLOCK).min(samples.len()) - 1, samples, expected: texts.get(i).unwrap_or(&"").to_string() }
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// The microphone: the clips in real time

#[derive(Default)]
struct Script {
    /// What the microphone hears next, block by block.
    queue: std::collections::VecDeque<Vec<i16>>,
    /// For a block: the number of samples after the clip's last voiced one, and the mark.
    marks: HashMap<usize, (usize, usize)>,
    delivered: usize,
}

#[derive(Clone, Default)]
struct Mic {
    script: Arc<Mutex<Script>>,
    /// (mark, monotonic ns of the end of speech) as the core received it.
    ends: Arc<(Mutex<Vec<(usize, i64)>>, Condvar)>,
    running: Arc<AtomicBool>,
}

impl Mic {
    /// Queues a clip and then `gap` of silence; `mark` names the clip in [`Mic::ends`].
    fn play(&self, clip: &Clip, gap: Duration, mark: usize) {
        let mut script = self.script.lock().unwrap();
        let first = script.delivered + script.queue.len();
        for (i, block) in clip.samples.chunks(BLOCK).enumerate() {
            let mut block = block.to_vec();
            block.resize(BLOCK, 0);
            let start = i * BLOCK;
            if (start..start + BLOCK).contains(&clip.last_voiced) {
                script.marks.insert(first + i, (start + BLOCK - 1 - clip.last_voiced, mark));
            }
            script.queue.push_back(block);
        }
        for _ in 0..gap.as_millis() / 10 {
            script.queue.push_back(vec![0; BLOCK]);
        }
    }

    fn wait_end(&self, mark: usize) -> i64 {
        let (lock, cond) = &*self.ends;
        let mut ends = lock.lock().unwrap();
        loop {
            if let Some((_, at)) = ends.iter().find(|(m, _)| *m == mark) {
                return *at;
            }
            assert!(self.running.load(Ordering::SeqCst), "the core stopped the microphone's capture");
            ends = cond.wait_timeout(ends, Duration::from_millis(200)).unwrap().0;
        }
    }

    /// Whether the queued audio was heard; a capture the core stopped ends the measurement.
    fn idle(&self) -> bool {
        assert!(self.running.load(Ordering::SeqCst), "the core stopped the microphone's capture");
        self.script.lock().unwrap().queue.is_empty()
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

impl CapturePlatform for Mic {
    fn open(&self, _: Source, _: &Target, _: Duration, mut on_audio: OnAudio, _: OnError) -> Result<Box<dyn Capture>, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let (flag, mic) = (Arc::clone(&stop), self.clone());
        mic.running.store(true, Ordering::SeqCst);
        let thread = std::thread::spawn(move || {
            let started = Instant::now();
            let mut sent = 0u32;
            while !flag.load(Ordering::SeqCst) {
                sent += 1;
                // A device hands over a block once it has been heard in full.
                let due = started + Duration::from_millis(10) * sent;
                if let Some(wait) = due.checked_duration_since(Instant::now()) {
                    std::thread::sleep(wait);
                }
                let (block, mark) = {
                    let mut script = mic.script.lock().unwrap();
                    match script.queue.pop_front() {
                        Some(block) => {
                            let index = script.delivered;
                            script.delivered += 1;
                            (block, script.marks.remove(&index))
                        }
                        None => (vec![0; BLOCK], None),
                    }
                };
                let delivered = monotonic_ns();
                if !on_audio(&block, RATE, 1, None) {
                    break;
                }
                if let Some((after, mark)) = mark {
                    let end = delivered - (after as i64) * 1_000_000_000 / i64::from(RATE);
                    let (lock, cond) = &*mic.ends;
                    lock.lock().unwrap().push((mark, end));
                    cond.notify_all();
                }
            }
            mic.running.store(false, Ordering::SeqCst);
        });
        Ok(Box::new(Running { stop, thread: Some(thread) }))
    }

    fn endpoints(&self, source: Source) -> Result<Vec<(Endpoint, String)>, String> {
        Ok(match source {
            Source::Mic => vec![(endpoint(), "Pipeline latency clips".into())],
            Source::Speaker => Vec::new(),
        })
    }

    fn default_endpoint(&self, source: Source) -> Result<Endpoint, String> {
        match source {
            Source::Mic => Ok(endpoint()),
            Source::Speaker => Err("realtime_default_endpoint_missing".into()),
        }
    }
}

fn endpoint() -> Endpoint {
    Endpoint { cookie: 1, serial: 1, name: MIC_ENDPOINT.into(), media_class: "Audio/Source".into() }
}

// ---------------------------------------------------------------------------------------------
// The speech output: when speech becomes audible

#[derive(Clone, Default)]
struct Speaker {
    /// Monotonic ns of each playback's first audible write.
    first_audio: Arc<Mutex<Vec<i64>>>,
}

struct Playback {
    speaker: Speaker,
    bytes_per_second: f64,
    opened: Instant,
    played: f64,
    heard: bool,
}

impl Output for Playback {
    fn write(&mut self, pcm: &[u8], token: &dyn PlaybackToken) -> vrct_audio_routing::Result<()> {
        token.check()?;
        if !self.heard && pcm.chunks_exact(2).any(|s| i16::from_le_bytes([s[0], s[1]]).unsigned_abs() > 64) {
            self.heard = true;
            self.speaker.first_audio.lock().unwrap().push(monotonic_ns());
        }
        // A device takes the audio in real time and buffers 40 ms ahead.
        self.played += pcm.len() as f64 / self.bytes_per_second;
        let ahead = self.played - self.opened.elapsed().as_secs_f64() - 0.040;
        if ahead > 0.0 {
            std::thread::sleep(Duration::from_secs_f64(ahead));
        }
        Ok(())
    }
    fn close(&mut self, _: bool, _: &dyn PlaybackToken) -> vrct_audio_routing::Result<()> {
        Ok(())
    }
}

struct Voice {
    native: NativeVoice,
    speaker: Speaker,
}

impl VoicePlatform for Voice {
    fn direct_sources(&self) -> vrct_audio_routing::Result<Vec<vrct_audio_routing::graph::Source>> {
        self.native.direct_sources()
    }
    fn default_microphone(&self) -> Option<String> {
        self.native.default_microphone()
    }
    fn speech_output(&self, device: &str, rate: u32, channels: u16) -> vrct_audio_routing::Result<Box<dyn Output>> {
        assert_eq!(device, OUTPUT_DEVICE, "speech went to another output");
        Ok(Box::new(Playback { speaker: self.speaker.clone(), bytes_per_second: f64::from(rate) * f64::from(channels) * 2.0, opened: Instant::now(), played: 0.0, heard: false }))
    }
    fn monitor_output(&self) -> vrct_audio_routing::monitor::MonitorFactory {
        self.native.monitor_output()
    }
    fn gate(&self, app_dir: &Path) -> Arc<dyn vrct_audio_routing::voice_route::Gate> {
        self.native.gate(app_dir)
    }
    fn passthrough(&self, app_dir: &Path, output: Option<&str>) -> Result<Box<dyn vrct_voice_conversion::DirectBackend>, String> {
        self.native.passthrough(app_dir, output)
    }
    fn route_devices(&self) -> Option<Arc<dyn vrct_audio_routing::windows_route::RouteDevices>> {
        self.native.route_devices()
    }
    fn rvc_worker(&self, app_dir: &Path) -> PathBuf {
        self.native.rvc_worker(app_dir)
    }
    fn runtime_transport(&self) -> Arc<dyn vrct_ops::downloads::transport::Transport> {
        self.native.runtime_transport()
    }
    fn nvidia_driver(&self) -> bool {
        self.native.nvidia_driver()
    }
    fn runtime_target(&self) -> Option<vrct_voice_conversion::runtime::Target> {
        self.native.runtime_target()
    }
}

/// The PC's devices, with the speech output of this measurement among the outputs.
struct Audio(vrct_audio_routing::platform::NativePlatform);

impl vrct_audio_routing::platform::AudioPlatform for Audio {
    fn backend(&self, reporter: Arc<dyn vrct_audio_routing::report::Reporter>) -> Arc<dyn vrct_audio_routing::manager::DeviceBackend> {
        self.0.backend(reporter)
    }
    fn outputs(&self, keep: &[String]) -> vrct_audio_routing::Result<Vec<OutputOption>> {
        let mut outputs = self.0.outputs(keep).unwrap_or_default();
        outputs.push(OutputOption { id: OUTPUT_DEVICE.into(), label: "Pipeline latency".into() });
        Ok(outputs)
    }
    fn cables(&self) -> Option<Arc<dyn vrct_audio_routing::virtual_mic::CableDevices>> {
        None
    }
}

// ---------------------------------------------------------------------------------------------
// The backend's lines

#[derive(Default)]
struct Seen {
    lines: Vec<(i64, Value)>,
}

struct Ui {
    backend: Backend,
    seen: Arc<(Mutex<Seen>, Condvar)>,
}

impl Ui {
    fn send(&self, endpoint: &str, data: Option<Value>) -> usize {
        let mark = self.seen.0.lock().unwrap().lines.len();
        self.backend.write_line(&vrct_core::protocol::request_line(endpoint, data.as_ref()));
        mark
    }

    fn wait(&self, from: usize, timeout: Duration, matches: impl Fn(&Value) -> bool) -> Option<(i64, Value)> {
        let deadline = Instant::now() + timeout;
        let (lock, cond) = &*self.seen;
        let mut seen = lock.lock().unwrap();
        loop {
            if let Some(found) = seen.lines.iter().skip(from).find(|(_, l)| matches(l)) {
                return Some(found.clone());
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return None;
            }
            seen = cond.wait_timeout(seen, left).unwrap().0;
        }
    }

    fn request(&self, endpoint: &str, data: Option<Value>, timeout: Duration) -> Value {
        let mark = self.send(endpoint, data);
        let (_, answer) = self.wait(mark, timeout, |l| l["endpoint"] == endpoint && l.get("status").is_some()).unwrap_or_else(|| panic!("no answer to {endpoint} within {timeout:?}"));
        answer
    }

    fn ok(&self, endpoint: &str, data: Option<Value>, timeout: Duration) -> Value {
        let answer = self.request(endpoint, data, timeout);
        // The answer's result can hold settings, never text of a message: print only the code.
        assert_eq!(answer["status"], 200, "{endpoint} failed: {}", answer["result"]["error_code"]);
        answer["result"].clone()
    }

    fn lines_since(&self, from: usize) -> Vec<(i64, Value)> {
        self.seen.0.lock().unwrap().lines[from..].to_vec()
    }

    fn len(&self) -> usize {
        self.seen.0.lock().unwrap().lines.len()
    }
}

fn caption_state(line: &Value) -> Option<&str> {
    (line["endpoint"] == "/run/realtime_caption").then(|| line["result"]["state"].as_str()).flatten()
}

// ---------------------------------------------------------------------------------------------
// Measures

/// Character error rate over letters and digits, punctuation and spaces left out.
fn cer(expected: &str, got: &str) -> Option<f64> {
    let clean = |s: &str| s.chars().filter(|c| c.is_alphanumeric()).collect::<Vec<char>>();
    let (a, b) = (clean(expected), clean(got));
    if a.is_empty() {
        return None;
    }
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let current = row[j + 1];
            row[j + 1] = (previous + usize::from(ca != cb)).min(row[j] + 1).min(row[j + 1] + 1);
            previous = current;
        }
    }
    Some(row[b.len()] as f64 / a.len() as f64)
}

fn ms(ns: i64) -> f64 {
    (ns as f64 / 1e5).round() / 10.0
}

fn percentile(values: &[f64], p: f64) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let rank = ((p / 100.0) * sorted.len() as f64).ceil().max(1.0) as usize;
    sorted[rank.min(sorted.len()) - 1]
}

/// Puts the translation model where the core looks for it, without copying it where that can
/// be helped: a symbolic link on Unix; on Windows, where a symbolic link needs Developer Mode or
/// administrator rights, a hard link to each file, or a copy when the model is on another drive.
fn place_model(model: &Path, place: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(model, place).expect("the translation model can be linked");
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(place).expect("the translation model's folder can be made");
        for entry in std::fs::read_dir(model).expect("the translation model can be read") {
            let entry = entry.expect("the translation model can be read");
            if entry.file_type().is_ok_and(|kind| kind.is_file()) {
                let target = place.join(entry.file_name());
                if std::fs::hard_link(entry.path(), &target).is_err() {
                    std::fs::copy(entry.path(), &target).expect("the translation model can be copied");
                }
            }
        }
    }
}

fn main() {
    let args = args();
    let clips = load_clips(&args.clips);
    assert!(clips.len() >= 2, "at least two clips: the first one warms the pipeline up");
    let work = tempfile::tempdir().expect("a working folder");
    let state = work.path().join("state");
    let data = work.path().join("data");
    std::fs::create_dir_all(&state).unwrap();
    let weights = data.join("weights").join("translate-onnx");
    std::fs::create_dir_all(&weights).unwrap();
    place_model(&args.translation, &weights.join("m2m100_418M-onnx-int8"));

    let chatbox = UdpSocket::bind(("127.0.0.2", 0)).expect("a chatbox socket on 127.0.0.2");
    let chatbox_port = chatbox.local_addr().unwrap().port();
    let chatbox_times: Arc<Mutex<Vec<i64>>> = Arc::default();
    {
        let times = Arc::clone(&chatbox_times);
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            while let Ok(size) = chatbox.recv(&mut buffer) {
                if buffer[..size].starts_with(b"/chatbox/input\0") {
                    times.lock().unwrap().push(monotonic_ns());
                }
            }
        });
    }

    let row = |model: &Path, vad: &Path| json!({ "model": model.to_str().unwrap_or(""), "vad_model": vad.to_str().unwrap_or(""), "diarization_model": "", "voice_file": "", "device": args.device, "low_latency": false });
    let none = PathBuf::new();
    let saved = json!({
        "OSC_IP_ADDRESS": "127.0.0.2",
        "OSC_PORT": chatbox_port,
        "SEND_MESSAGE_TO_VRC": true,
        "CTRANSLATE2_WEIGHT_TYPE": "m2m100_418M-ct2-int8",
        "SPEECH_SERVER_SETTINGS": {
            "version": 1,
            "profiles": { "japanese": row(&none, &none), "multilingual": row(&args.tts_model, &none), "asr": row(&args.asr_model, &args.vad_model) },
        },
        "REALTIME_ASR_SETTINGS": {
            "version": 1, "server": "bundled", "start_server": true, "base_url": "http://127.0.0.1:8080", "model": "",
            "mic": { "language": "ja", "endpoint": null, "follow_default": true },
            "speaker": { "language": "auto", "endpoint": null, "follow_default": true },
            "vocabulary": { "builtin": true, "terms": [] },
        },
        "VOICE_SETTINGS": {
            "mode": "off", "mic_mode": "translated", "direct_policy": "mix", "routing": "external",
            "output_device": OUTPUT_DEVICE, "multilingual_server": "bundled", "multilingual_voice": args.tts_voice, "multilingual_seed": "1",
        },
    });
    let mut saved = saved;
    if let Some(ms) = args.silence_ms {
        // Only when asked: a core before #556 refuses the field and drops the settings.
        saved["REALTIME_ASR_SETTINGS"]["silence_duration_ms"] = json!(ms);
    }
    std::fs::write(state.join("config.json"), serde_json::to_string_pretty(&saved).unwrap()).unwrap();

    let mic = Mic::default();
    let speaker = Speaker::default();
    let seen: Arc<(Mutex<Seen>, Condvar)> = Arc::default();
    let lines = Arc::clone(&seen);
    let sink = Sink {
        line: Arc::new(move |line: String| {
            let at = monotonic_ns();
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                lines.0.lock().unwrap().lines.push((at, value));
                lines.1.notify_all();
            }
        }),
        exit: Arc::new(|_| {}),
    };
    let environment = Environment {
        version: "0.0.0".into(),
        state_dir: state.clone(),
        app_dir: args.app_dir.clone(),
        data_dir: data.clone(),
        platform: Platform::current(),
        compute_devices: vec![Environment::cpu_device()],
        devices: None,
        websocket_token: None,
    };
    let mut options = Options::new(environment);
    // No UI feeds the watchdog here.
    options.watchdog = None;
    options.services.transcription_capture = {
        let mic = mic.clone();
        Arc::new(move |_| Arc::new(mic.clone()) as Arc<dyn CapturePlatform>)
    };
    options.services.voice = Arc::new(Voice { native: NativeVoice, speaker: speaker.clone() });
    options.services.audio = Arc::new(Audio(vrct_audio_routing::platform::NativePlatform));
    options.services.translation_weight_available = Arc::new(|weight| weight == "m2m100_418M-ct2-int8");
    options.services.telemetry_forced_off = Arc::new(|| true);
    vrct_core::resources::use_development_checkout(args.app_dir.clone());
    let started = Instant::now();
    let backend = Backend::start(options, sink);
    let ui = Ui { backend, seen };
    ui.wait(0, Duration::from_secs(180), |l| l["endpoint"] == "/run/initialization_complete").expect("start-up ends");
    eprintln!("[pipeline] core ready in {:.1} s", started.elapsed().as_secs_f64());

    // Translation on: loads the local model.
    let t = Instant::now();
    assert_eq!(ui.ok("/set/enable/translation", None, Duration::from_secs(120)), json!(true), "translation turned on");
    eprintln!("[pipeline] translation ready in {:.1} s", t.elapsed().as_secs_f64());
    // Speech: starts the bundled multilingual server.
    let t = Instant::now();
    let generation = ui.ok("/get/data/voice_status", None, Duration::from_secs(10))["tts_generation"].clone();
    ui.ok("/run/enable_tts", Some(json!({ "generation": generation })), Duration::from_secs(300));
    eprintln!("[pipeline] speech ready in {:.1} s", t.elapsed().as_secs_f64());
    // Recognition: starts the bundled recognition server and the session.
    let t = Instant::now();
    let mark = ui.send("/set/enable/transcription_send", None);
    let (_, answer) = ui.wait(mark, Duration::from_secs(300), |l| l["endpoint"] == "/set/enable/transcription_send" && l.get("status").is_some()).expect("the microphone switch answers");
    assert_eq!(answer["result"], json!(true), "the microphone switch turned on: {}", answer["result"]["details"]["reason"]);
    while !mic.running.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(20));
    }
    // The session is ready once the capture runs; give the server a moment for its config.
    std::thread::sleep(Duration::from_millis(500));
    eprintln!("[pipeline] recognition ready in {:.1} s", t.elapsed().as_secs_f64());

    let mut out: Box<dyn std::io::Write> = match &args.out {
        Some(path) => Box::new(std::fs::OpenOptions::new().create(true).append(true).open(path).expect("the output file")),
        None => Box::new(std::io::stdout()),
    };
    let mut rows: Vec<Value> = Vec::new();
    // Clip 0 warms the recognition, the translation and the synthesis up and is not measured.
    let mut plan: Vec<(usize, usize)> = vec![(0, 0)];
    for run in 1..=args.runs {
        for clip in 1..clips.len() {
            plan.push((run, clip));
        }
    }
    for (mark, &(run, index)) in plan.iter().enumerate() {
        let clip = &clips[index];
        while !mic.idle() {
            std::thread::sleep(Duration::from_millis(10));
        }
        let from = ui.len();
        let audio_from = speaker.first_audio.lock().unwrap().len();
        let chat_from = chatbox_times.lock().unwrap().len();
        mic.play(clip, args.gap, mark);
        let end = mic.wait_end(mark);
        // Wait out the gap: the result and the speech come within it.
        while !mic.idle() {
            std::thread::sleep(Duration::from_millis(10));
        }
        let lines = ui.lines_since(from);
        let finals: Vec<&(i64, Value)> = lines.iter().filter(|(_, l)| caption_state(l) == Some("final")).collect();
        let translated: Vec<&(i64, Value)> = lines.iter().filter(|(_, l)| caption_state(l) == Some("translated")).collect();
        let first_partial = lines.iter().find(|(_, l)| caption_state(l) == Some("partial")).map(|(at, _)| *at);
        let traces: Vec<&Value> = lines.iter().filter(|(_, l)| l["endpoint"] == "/run/io_trace").map(|(_, l)| &l["result"]).collect();
        let recognised: String = finals.iter().filter_map(|(_, l)| l["result"]["text"].as_str()).collect::<Vec<_>>().join("");
        // Whether the last final's text was already the latest partial before it, and how long
        // before: how much a translation started on that partial could have saved.
        let partial_matches = finals.last().map(|(final_at, final_line)| {
            let latest = lines.iter().filter(|(at, l)| at < final_at && caption_state(l) == Some("partial")).last();
            match latest {
                Some((at, partial)) if partial["result"]["text"] == final_line["result"]["text"] => json!(ms(final_at - at)),
                _ => Value::Null,
            }
        });
        let audio = speaker.first_audio.lock().unwrap()[audio_from..].to_vec();
        let chats = chatbox_times.lock().unwrap()[chat_from..].to_vec();
        let last_final = finals.last().map(|(at, _)| *at);
        let trace = traces.last().cloned().cloned().unwrap_or(Value::Null);
        let since_end = |at: Option<i64>| at.map_or(Value::Null, |at| json!(ms(at - end)));
        // The trace's times count from the start of the message's processing; the chatbox's
        // datagram, seen here too, places that start on this clock.
        let pipeline_start = match (chats.last(), trace["outputs"]["chatbox"]["at_ms"].as_f64()) {
            (Some(&at), Some(offset)) => Some(at - (offset * 1e6) as i64),
            _ => None,
        };
        let first_write = match (pipeline_start, trace["outputs"]["speech"]["at_ms"].as_f64()) {
            (Some(start), Some(offset)) => Some(start + (offset * 1e6) as i64),
            _ => None,
        };
        let row = json!({
            "label": args.label,
            "run": run,
            "clip": index,
            "clip_ms": ms(clip.samples.len() as i64 * 1_000_000_000 / i64::from(RATE)),
            "utterances": finals.len(),
            "cer": cer(&clip.expected, &recognised),
            "final_was_partial_ms_before": partial_matches.unwrap_or(Value::Null),
            "first_partial_after_end_ms": since_end(first_partial),
            "final_after_end_ms": since_end(last_final),
            "pipeline_start_after_end_ms": since_end(pipeline_start),
            "translated_after_end_ms": since_end(translated.last().map(|(at, _)| *at)),
            "first_write_after_end_ms": since_end(first_write),
            "chatbox_after_end_ms": since_end(chats.last().copied()),
            "speech_after_end_ms": since_end(audio.last().copied()),
            "trace": {
                "origin": trace["origin"],
                "translate_ms": trace["stages"]["translate"],
                "deliver_ms": trace["stages"]["deliver"],
                "chatbox_at_ms": trace["outputs"]["chatbox"]["at_ms"],
                "speech_at_ms": trace["outputs"]["speech"]["at_ms"],
                "synthesis_ms": trace["outputs"]["speech"]["synthesis_ms"],
            },
        });
        if run > 0 {
            writeln!(out, "{row}").unwrap();
            rows.push(row);
        } else {
            eprintln!("[pipeline] warm-up: {row}");
        }
    }

    let summary_of = |pick: &dyn Fn(&Value) -> Option<f64>| -> Value {
        let values: Vec<f64> = rows.iter().filter_map(pick).collect();
        if values.is_empty() {
            return Value::Null;
        }
        json!({ "n": values.len(), "p50": percentile(&values, 50.0), "p95": percentile(&values, 95.0), "max": percentile(&values, 100.0) })
    };
    let summary = json!({
        "label": args.label,
        "summary": true,
        "silence_duration_ms": args.silence_ms,
        "final_after_end_ms": summary_of(&|r| r["final_after_end_ms"].as_f64()),
        "pipeline_start_after_end_ms": summary_of(&|r| r["pipeline_start_after_end_ms"].as_f64()),
        "translate_ms": summary_of(&|r| r["trace"]["translate_ms"].as_f64()),
        "deliver_ms": summary_of(&|r| r["trace"]["deliver_ms"].as_f64()),
        "chatbox_after_end_ms": summary_of(&|r| r["chatbox_after_end_ms"].as_f64()),
        "synthesis_ms": summary_of(&|r| r["trace"]["synthesis_ms"].as_f64()),
        "speech_at_ms": summary_of(&|r| r["trace"]["speech_at_ms"].as_f64()),
        "first_write_after_end_ms": summary_of(&|r| r["first_write_after_end_ms"].as_f64()),
        "speech_after_end_ms": summary_of(&|r| r["speech_after_end_ms"].as_f64()),
        "cer": summary_of(&|r| r["cer"].as_f64()),
        "split_utterances": rows.iter().filter(|r| r["utterances"].as_u64() != Some(1)).count(),
    });
    writeln!(out, "{summary}").unwrap();
    eprintln!("[pipeline] {summary}");
    ui.send("/run/shutdown", None);
    let _ = ui.backend.wait(Duration::from_secs(30));
}
