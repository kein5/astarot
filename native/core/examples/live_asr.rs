//! Realtime recognition with a real speech.cpp server (#278): how soon the first partial comes
//! after speech starts, and the final and the chat box after it ends. The microphone is a WAVE
//! file played like a device, so every run hears the same speech.
//!
//! cargo run --release --locked --manifest-path native/core/Cargo.toml --example live_asr --
//!     --base-url http://127.0.0.1:<port> --model <id> --state-dir <empty folder>
//!     --wav <file>=<expected text> [--wav ...] [--rounds 3] [--language ja] [--layer core|session]
//!
//! Start the server first, with a recognition model and a detection (VAD) model, and its stderr
//! sent to a file: `speech serve <asr.gguf> <vad.gguf> --host 127.0.0.1 --port <port>`.
//!
//! `--layer core` runs the core in this process as the application runs it and turns on the main
//! microphone switch (the local engine); the final then goes through the message pipeline to a
//! chat box on 127.0.0.2. `--layer session` runs only the realtime session, as the core starts
//! it, to compare with Python's `RealtimeSession` on the same files. Set `VRCT_TELEMETRY=off`.
//!
//! Prints one JSON line per utterance and a summary. The character error rate is computed here
//! against the expected text; no recognised text, audio, path or device name is printed.

use serde_json::{Value, json};
use std::collections::VecDeque;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::time::{Duration, Instant};
use vrct_audio_routing::graph::Endpoint;
use vrct_core::config::{Environment, Platform};
use vrct_core::{Backend, Options, Sink};
use vrct_transcription::capture::{Capture, CapturePlatform, OnAudio, OnError, Source, Target};
use vrct_transcription::realtime;

const RATE: u32 = 48000;
/// Silence after each utterance, so that the server's VAD ends it, and before the next.
const TRAILING: Duration = Duration::from_millis(2500);

/// One utterance: 48 kHz mono samples and the text it says.
struct Clip {
    samples: Vec<i16>,
    expected: String,
    /// Where the speech starts and ends in the clip: the first and the last sample above 1/32
    /// of full scale (a file has silence around the speech).
    lead: Duration,
    tail: Duration,
}

impl Clip {
    fn new(samples: Vec<i16>, expected: String) -> Clip {
        let loud = |s: &i16| s.unsigned_abs() > 1024;
        let first = samples.iter().position(loud).expect("the file has speech");
        let last = samples.iter().rposition(loud).expect("the file has speech") + 1;
        let at = |index: usize| Duration::from_secs_f64(index as f64 / f64::from(RATE));
        Clip { lead: at(first), tail: at(last), samples, expected }
    }
}

/// When the player gave the device the first block of a clip.
#[derive(Clone, Copy, Default)]
struct Played {
    started: Option<Instant>,
}

#[derive(Default)]
struct PlayerState {
    queue: VecDeque<Vec<i16>>,
    played: Played,
    idle: bool,
}

/// A microphone that plays queued clips, 10 ms every 10 ms as a 48 kHz stereo device, and
/// silence in between.
#[derive(Clone, Default)]
struct Player {
    state: Arc<(Mutex<PlayerState>, Condvar)>,
    opened: Arc<AtomicBool>,
}

impl Player {
    fn play(&self, samples: &[i16]) {
        let (lock, _) = &*self.state;
        let mut state = lock.lock().unwrap();
        state.played = Played::default();
        state.idle = false;
        state.queue.push_back(samples.to_vec());
    }

    /// Waits until the queued clip and its trailing silence were played.
    fn wait_played(&self) -> Played {
        let (lock, done) = &*self.state;
        let mut state = lock.lock().unwrap();
        while !state.idle {
            state = done.wait(state).unwrap();
        }
        state.played
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

fn endpoint() -> Endpoint {
    Endpoint { cookie: 1, serial: 1, name: "live.mic".into(), media_class: "Audio/Source".into() }
}

impl CapturePlatform for Player {
    fn open(&self, source: Source, _: &Target, _: Duration, mut on_audio: OnAudio, _: OnError) -> Result<Box<dyn Capture>, String> {
        if source != Source::Mic {
            return Err("asr_capture_endpoint_missing".into());
        }
        self.opened.store(true, Ordering::SeqCst);
        let stop = Arc::new(AtomicBool::new(false));
        let (flag, state) = (stop.clone(), self.state.clone());
        let thread = std::thread::spawn(move || {
            let block = (RATE / 100) as usize;
            let started = Instant::now();
            let mut sent = 0u64;
            // (samples, position, silence blocks left after it)
            let mut current: Option<(Vec<i16>, usize)> = None;
            let mut silence_left = 0u64;
            while !flag.load(Ordering::SeqCst) {
                let due = started + Duration::from_millis(sent * 10);
                if let Some(wait) = due.checked_duration_since(Instant::now()) {
                    std::thread::sleep(wait);
                }
                sent += 1;
                let (lock, done) = &*state;
                if current.is_none() && silence_left == 0 {
                    let mut state = lock.lock().unwrap();
                    if let Some(next) = state.queue.pop_front() {
                        current = Some((next, 0));
                    }
                }
                let mut mono = vec![0i16; block];
                if let Some((samples, position)) = current.as_mut() {
                    let end = (*position + block).min(samples.len());
                    mono[..end - *position].copy_from_slice(&samples[*position..end]);
                    let first = *position == 0;
                    *position = end;
                    let finished = *position >= samples.len();
                    if first {
                        // The block is due now: its first sample is heard at this instant.
                        lock.lock().unwrap().played.started = Some(due);
                    }
                    if finished {
                        current = None;
                        silence_left = TRAILING.as_millis() as u64 / 10;
                    }
                } else if silence_left > 0 {
                    silence_left -= 1;
                    if silence_left == 0 {
                        let mut state = lock.lock().unwrap();
                        if state.queue.is_empty() {
                            state.idle = true;
                            done.notify_all();
                        }
                    }
                }
                let stereo: Vec<i16> = mono.iter().flat_map(|s| [*s, *s]).collect();
                if !on_audio(&stereo, RATE, 2, None) {
                    break;
                }
            }
        });
        Ok(Box::new(Running { stop, thread: Some(thread) }))
    }

    fn endpoints(&self, source: Source) -> Result<Vec<(Endpoint, String)>, String> {
        Ok(if source == Source::Mic { vec![(endpoint(), "Live microphone".into())] } else { Vec::new() })
    }

    fn default_endpoint(&self, source: Source) -> Result<Endpoint, String> {
        if source == Source::Mic { Ok(endpoint()) } else { Err("realtime_default_endpoint_missing".into()) }
    }
}

/// A 16-bit PCM WAVE file as 48 kHz mono.
fn read_wav(path: &PathBuf) -> Vec<i16> {
    let bytes = std::fs::read(path).expect("the WAVE file can be read");
    assert!(bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE", "a WAVE file");
    let (mut at, mut format, mut data) = (12usize, None, None);
    while at + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
        let body = &bytes[at + 8..(at + 8 + size).min(bytes.len())];
        match &bytes[at..at + 4] {
            b"fmt " => format = Some((u16::from_le_bytes([body[0], body[1]]), u16::from_le_bytes([body[2], body[3]]), u32::from_le_bytes(body[4..8].try_into().unwrap()), u16::from_le_bytes([body[14], body[15]]))),
            b"data" => data = Some(body),
            _ => {}
        }
        at += 8 + size + size % 2;
    }
    let (kind, channels, rate, bits) = format.expect("a fmt chunk");
    assert!(kind == 1 && bits == 16 && rate == RATE, "16-bit PCM at 48 kHz");
    let samples: Vec<i16> = data.expect("a data chunk").as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b)).collect();
    samples.chunks(usize::from(channels)).map(|frame| (frame.iter().map(|s| i32::from(*s)).sum::<i32>() / i32::from(channels)) as i16).collect()
}

/// The character error rate of `heard` against `expected`, ignoring punctuation and spaces.
fn cer(expected: &str, heard: &str) -> f64 {
    let keep = |text: &str| -> Vec<char> {
        text.chars().filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation() && !"、。！？「」・…,.!?".contains(*c)).collect()
    };
    let (a, b) = (keep(expected), keep(heard));
    if a.is_empty() {
        return if b.is_empty() { 0.0 } else { 1.0 };
    }
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut previous = row[0];
        row[0] = i;
        for j in 1..=b.len() {
            let current = row[j];
            row[j] = (row[j] + 1).min(row[j - 1] + 1).min(previous + usize::from(a[i - 1] != b[j - 1]));
            previous = current;
        }
    }
    (row[b.len()] as f64 / a.len() as f64 * 1000.0).round() / 1000.0
}

fn ms(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1000.0 * 10.0).round() / 10.0
}

fn since(later: Option<Instant>, earlier: Option<Instant>) -> Value {
    match (later, earlier) {
        (Some(later), Some(earlier)) => json!(if later >= earlier { ms(later - earlier) } else { -ms(earlier - later) }),
        _ => Value::Null,
    }
}

/// What one utterance produced, on this process's clock.
#[derive(Default)]
struct Heard {
    first_partial: Option<Instant>,
    finals: Vec<(Instant, String)>,
    chatbox: Option<Instant>,
}

fn summary(rows: &[Value], key: &str) -> Value {
    let mut values: Vec<f64> = rows.iter().filter_map(|row| row[key].as_f64()).collect();
    if values.is_empty() {
        return Value::Null;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |q: f64| values[((values.len() - 1) as f64 * q).round() as usize];
    json!({ "n": values.len(), "min": values[0], "median": at(0.5), "p90": at(0.9), "max": values[values.len() - 1] })
}

fn main() {
    let (mut base_url, mut model, mut state_dir) = (None, None, None);
    let (mut language, mut layer, mut rounds) = ("ja".to_owned(), "core".to_owned(), 3usize);
    let mut clips: Vec<Clip> = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| panic!("{arg} needs a value"));
        match arg.as_str() {
            "--base-url" => base_url = Some(value()),
            "--model" => model = Some(value()),
            "--state-dir" => state_dir = Some(PathBuf::from(value())),
            "--language" => language = value(),
            "--layer" => layer = value(),
            "--rounds" => rounds = value().parse().expect("--rounds takes a number"),
            "--wav" => {
                let spec = value();
                let (path, expected) = spec.split_once('=').expect("--wav <file>=<expected text>");
                clips.push(Clip::new(read_wav(&PathBuf::from(path)), expected.to_owned()));
            }
            other => panic!("unknown argument {other}"),
        }
    }
    let base_url = base_url.expect("--base-url is required");
    let model = model.expect("--model is required");
    assert!(!clips.is_empty(), "at least one --wav");
    assert!((1..=20).contains(&rounds), "1..20 rounds");
    let player = Player::default();
    let heard: Arc<Mutex<Heard>> = Arc::default();

    let mut rows = Vec::new();
    let finish: Box<dyn FnOnce()> = match layer.as_str() {
        "core" => {
            let state_dir = state_dir.expect("--state-dir is required for --layer core");
            std::fs::create_dir_all(&state_dir).expect("the state folder can be made");
            let chatbox = UdpSocket::bind(("127.0.0.2", 0)).expect("a chat box socket");
            let config = json!({
                "OSC_IP_ADDRESS": "127.0.0.2",
                "OSC_PORT": chatbox.local_addr().unwrap().port(),
                "SEND_MESSAGE_TO_VRC": true,
                "SELECTED_TRANSCRIPTION_ENGINE": "SpeechCpp",
                "LOCAL_ASR_MIGRATION": 2,
                "REALTIME_ASR_SETTINGS": {
                    "version": 1, "server": "external", "start_server": false, "base_url": base_url, "model": model,
                    "mic": { "language": language, "endpoint": null, "follow_default": true },
                    "speaker": { "language": language, "endpoint": null, "follow_default": true },
                    "vocabulary": { "builtin": true, "terms": [] },
                },
            });
            std::fs::write(state_dir.join("config.json"), serde_json::to_vec_pretty(&config).unwrap()).expect("the settings can be written");
            {
                let heard = heard.clone();
                std::thread::spawn(move || {
                    let mut buffer = [0u8; 4096];
                    while let Ok((size, _)) = chatbox.recv_from(&mut buffer) {
                        let packets = vrct_adapters::osc::decode_packet(&buffer[..size]).unwrap_or_default();
                        if packets.iter().any(|m| m.address == "/chatbox/input") {
                            // The last one: an utterance the server cut in two sends twice.
                            heard.lock().unwrap().chatbox = Some(Instant::now());
                        }
                    }
                });
            }
            let environment = Environment {
                version: "0.0.0".into(),
                state_dir: state_dir.clone(),
                app_dir: state_dir.clone(),
                data_dir: state_dir.clone(),
                platform: Platform::current(),
                compute_devices: vec![Environment::cpu_device()],
                devices: None,
                websocket_token: None,
            };
            let (done, ready) = mpsc::channel();
            let lines = heard.clone();
            let sink = Sink {
                line: Arc::new(move |line: String| {
                    if line.contains("\"/run/initialization_complete\"") {
                        let _ = done.send(());
                    }
                    if !line.contains("\"/run/realtime_caption\"") {
                        return;
                    }
                    let at = Instant::now();
                    let Ok(value) = serde_json::from_str::<Value>(&line) else { return };
                    let caption = &value["result"];
                    let mut heard = lines.lock().unwrap();
                    match caption["state"].as_str() {
                        Some("partial") => {
                            heard.first_partial.get_or_insert(at);
                        }
                        Some("final") => heard.finals.push((at, caption["text"].as_str().unwrap_or("").to_owned())),
                        _ => {}
                    }
                }),
                exit: Arc::new(|_| {}),
            };
            let mut options = Options::new(environment);
            let platform = player.clone();
            options.services.transcription_capture = Arc::new(move |_| Arc::new(platform.clone()) as Arc<dyn CapturePlatform>);
            let backend = Backend::start(options, sink);
            let core = backend.core().clone();
            std::thread::spawn(move || {
                loop {
                    core.feed_watchdog();
                    std::thread::sleep(Duration::from_secs(2));
                }
            });
            ready.recv_timeout(Duration::from_secs(60)).expect("start-up ends within 60 s");
            let started = Instant::now();
            // As the queue does: a request that waits for start-up is tried again.
            let reply = loop {
                let reply = backend.dispatcher().call(Some("/set/enable/transcription_send"), &Value::Null);
                if reply.status != 423 || started.elapsed() > Duration::from_secs(30) {
                    break reply;
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            assert_eq!(reply.status, 200, "the switch did not turn on: {}", reply.result);
            while !player.opened.load(Ordering::SeqCst) {
                assert!(started.elapsed() < Duration::from_secs(30), "the capture did not open");
                std::thread::sleep(Duration::from_millis(5));
            }
            println!("{}", json!({ "case": "enable", "layer": "core", "switch_to_capture_ms": ms(started.elapsed()) }));
            Box::new(move || {
                let _ = backend.dispatcher().call(Some("/set/disable/transcription_send"), &Value::Null);
                let stopped = backend.kill_and_wait(Duration::from_secs(10));
                println!("{}", json!({ "case": "end", "stopped_cleanly": stopped }));
            })
        }
        "session" => {
            let vocabulary = vrct_transcription::speechcpp::merged_terms(&json!({ "builtin": true, "terms": [] }));
            // The silence that ends an utterance is the core's default, as with unchanged settings.
            // The session takes the model as the server lists it, as the core's start gives it.
            let (models, diarizes) = vrct_transcription::speechcpp::survey(&vrct_translation::http::direct(), &base_url, Duration::from_secs(5), None)
                .expect("the server lists its models");
            let model = models.into_iter().find(|listed| listed.id == model).expect("the server lists the model");
            let options = realtime::Options { base_url, model, language, vocabulary, silence_duration_ms: None, diarizes, limits: Default::default() };
            let session = realtime::Session::new(Source::Mic, options, endpoint(), Arc::new(player.clone()));
            let started = Instant::now();
            session.start().expect("the session starts");
            while session.state() != "ready" {
                assert!(started.elapsed() < Duration::from_secs(30), "the session did not start: {}", session.health());
                std::thread::sleep(Duration::from_millis(5));
            }
            println!("{}", json!({ "case": "enable", "layer": "session", "start_to_ready_ms": ms(started.elapsed()) }));
            let reading = session.clone();
            let lines = heard.clone();
            std::thread::spawn(move || {
                while !matches!(reading.state(), "closed" | "failed") {
                    let Some(update) = reading.pop_update(Duration::from_millis(50)) else { continue };
                    let at = Instant::now();
                    let mut heard = lines.lock().unwrap();
                    if update.is_final {
                        heard.finals.push((at, update.text.clone()));
                    } else {
                        heard.first_partial.get_or_insert(at);
                    }
                }
            });
            Box::new(move || {
                let health = session.health();
                let closed = session.close(Duration::from_secs(3));
                println!("{}", json!({ "case": "end", "closed": closed, "error_code": health["error_code"] }));
            })
        }
        other => panic!("--layer is core or session, not {other}"),
    };

    for round in 1..=rounds {
        for (index, clip) in clips.iter().enumerate() {
            *heard.lock().unwrap() = Heard::default();
            player.play(&clip.samples);
            let played = player.wait_played();
            let heard = std::mem::take(&mut *heard.lock().unwrap());
            let text: String = heard.finals.iter().map(|(_, text)| text.as_str()).collect::<Vec<_>>().join("");
            // The player keeps the device's pace, so the speech is heard at a fixed offset.
            let speech_start = played.started.map(|at| at + clip.lead);
            let speech_end = played.started.map(|at| at + clip.tail);
            let row = json!({
                "case": "utterance",
                "layer": layer,
                "round": round,
                "clip": index + 1,
                "speech_ms": ms(clip.tail - clip.lead),
                "first_partial_after_speech_start_ms": since(heard.first_partial, speech_start),
                "final_after_speech_end_ms": since(heard.finals.last().map(|(at, _)| *at), speech_end),
                "chatbox_after_speech_end_ms": since(heard.chatbox, speech_end),
                "finals": heard.finals.len(),
                "cer": cer(&clip.expected, &text),
            });
            println!("{row}");
            rows.push(row);
        }
    }
    let total = json!({
        "case": "summary",
        "layer": layer,
        "utterances": rows.len(),
        "first_partial_after_speech_start_ms": summary(&rows, "first_partial_after_speech_start_ms"),
        "final_after_speech_end_ms": summary(&rows, "final_after_speech_end_ms"),
        "chatbox_after_speech_end_ms": summary(&rows, "chatbox_after_speech_end_ms"),
        "cer": summary(&rows, "cer"),
        "missed": rows.iter().filter(|row| row["finals"] == 0).count(),
    });
    println!("{total}");
    finish();
}
