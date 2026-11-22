//! The voice auditions of the TTS and RVC catalogs (#415), played only on the monitor output
//! the user chose.
//!
//! - TTS: a short fixed sentence, spoken by the running bundled speech.cpp server of one profile
//!   with that profile's voice settings.
//! - RVC: the user's own voice, recorded for a few seconds from the input chosen on the RVC page
//!   on the press, converted by a downloaded or registered voice model in an RVC worker of its own
//!   ([`astarot_voice_conversion::audition`]). The microphone opens only for that recording, and the
//!   recording stays in memory until the audition ends; it is never saved. The pitch and the index
//!   rate come with the request, so the values on the form can be heard before they are saved.
//!
//! Both:
//!
//! - never reach the virtual microphone, the managed route or VRChat: the output is the monitor
//!   device, checked against the TTS output and the virtual cables found, and refused when the
//!   monitor is off (no fallback to any other output);
//! - sound only on the user's press, are refused while the voice is muted, and end with Stop,
//!   Mute, their own stop and the end of the run. One plays at a time: a new press replaces the
//!   one playing;
//! - name the sentence by an id or the model by its catalog or registration id. The text, the
//!   audio and the files' paths go only to the local server and worker; nothing of them is logged,
//!   kept or returned.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Map, Value, json};
use astarot_audio_routing::graph::{Endpoint, parse_source};
use astarot_audio_routing::monitor::{MonitorFactory, check_monitor_target, scale_pcm};
use astarot_audio_routing::router::Output;
use astarot_audio_routing::windows_route::{Capture, CaptureCallbacks};
use astarot_tts::playback::Frames;
use astarot_tts::sync::Event;
use astarot_tts::{CancelToken, SpeechCppTts, SpeechError, SynthesisOptions};
use astarot_voice_conversion::PreparedRvc;
use astarot_voice_conversion::protocol::RATE;

use super::Token;

/// The sentences by id: `(id, language tag, text)`. Short, so that a change of a setting can be
/// heard again at once.
const SENTENCES: [(&str, &str, &str); 2] = [
    ("ja", "ja", "こんにちは。この声で読み上げます。"),
    ("en", "en", "Hello. This is how I will sound."),
];

/// A TTS audition ends within this time, as one utterance of the speech bus does.
const TIMEOUT: Duration = Duration::from_secs(30);
/// An RVC audition: the worker may take a while to load (and, with a new model or GPU, to time the
/// GPU for its block, #531) before the sample plays.
const RVC_TIMEOUT: Duration = Duration::from_secs(120);

/// The reason a token carries when a newer audition took its place.
const REPLACED: &str = "voice_audition_replaced";

/// What an RVC audition converts. `recording`: the user's voice, recorded on the press.
pub(super) const RVC_SOURCES: [&str; 1] = ["recording"];
/// How long a recording may be, in whole seconds.
pub(super) const RECORD_SECONDS: std::ops::RangeInclusive<u64> = 1..=10;
/// A recording whose loudest sample stays under this (about -50 dBFS) heard nothing: the
/// microphone is off, muted or another one.
const SILENT_PEAK: u16 = 100;
/// How long the microphone may take to give its first audio once it has started.
const FIRST_AUDIO_WAIT: Duration = Duration::from_secs(5);

/// Opens a capture of a microphone at 48 kHz mono s16le: the device route's on Windows, the
/// managed route's on Linux.
pub(super) type CaptureOpener = Arc<dyn Fn(&Endpoint, CaptureCallbacks) -> Box<dyn Capture> + Send + Sync>;

/// What a start asks for, checked.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Request {
    Tts(TtsRequest),
    Rvc(RvcRequest),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TtsRequest {
    pub profile: &'static str,
    pub language: &'static str,
    pub text: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct RvcRequest {
    /// The model's catalog id, or the id of a model the user registered.
    pub entry: String,
    pub source: &'static str,
    /// The microphone to record from: the input chosen on the RVC page.
    pub input: Endpoint,
    /// How long to record.
    pub seconds: u64,
    pub pitch: i64,
    /// As sent: an integer stays one for the worker (`rate_text`).
    pub index_rate: Value,
}

/// `{"kind": "tts", "profile": "japanese"|"multilingual", "sentence": "ja"|"en"}` or
/// `{"kind": "rvc", "entry", "source": "recording", "input": {cookie, serial, name, media_class},
/// "seconds": 1..=10, "pitch": -24..=24, "index_rate": 0..=1}`.
pub(super) fn parse(data: &Value) -> Option<Request> {
    let object = data.as_object()?;
    match object.get("kind")?.as_str()? {
        "tts" => parse_tts(object).map(Request::Tts),
        "rvc" => parse_rvc(object).map(Request::Rvc),
        _ => None,
    }
}

/// Each profile reads the language it speaks in use: TTS sends Japanese to the Japanese server
/// and every other language to the multilingual one.
fn parse_tts(object: &Map<String, Value>) -> Option<TtsRequest> {
    if object.len() != 3 {
        return None;
    }
    let profile = match object.get("profile")?.as_str()? {
        "japanese" => "japanese",
        "multilingual" => "multilingual",
        _ => return None,
    };
    let sentence = object.get("sentence")?.as_str()?;
    let (_, language, text) = SENTENCES.iter().find(|(id, _, _)| *id == sentence)?;
    if (profile == "japanese") != (*language == "ja") {
        return None;
    }
    Some(TtsRequest { profile, language, text })
}

fn parse_rvc(object: &Map<String, Value>) -> Option<RvcRequest> {
    if object.len() != 7 {
        return None;
    }
    let entry = object.get("entry")?.as_str().filter(|id| (1..=128).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b)))?;
    let source = object.get("source")?.as_str()?;
    let source = *RVC_SOURCES.iter().find(|known| **known == source)?;
    let input = parse_source(object.get("input")?).ok()?;
    let seconds = object.get("seconds").filter(|value| value.is_u64())?.as_u64().filter(|seconds| RECORD_SECONDS.contains(seconds))?;
    let pitch = object.get("pitch").filter(|value| value.is_i64() || value.is_u64())?.as_i64().filter(|pitch| (-24..=24).contains(pitch))?;
    let index_rate = object.get("index_rate").filter(|value| value.as_f64().is_some_and(|rate| rate.is_finite() && (0.0..=1.0).contains(&rate)))?;
    Some(RvcRequest { entry: entry.to_owned(), source, input, seconds, pitch, index_rate: index_rate.clone() })
}

/// The sentence a TTS profile reads: `(language tag, text)`.
pub(super) fn sentence_of(profile: &str) -> (&'static str, &'static str) {
    let id = if profile == "japanese" { "ja" } else { "en" };
    SENTENCES.iter().find(|(key, _, _)| *key == id).map(|(_, language, text)| (*language, *text)).expect("both sentences are listed")
}

/// Where and how loud an audition plays.
pub(super) struct Target {
    pub device: String,
    pub volume: u8,
    /// Outputs it must never be: the TTS output and the virtual cables.
    pub exclude: Vec<String>,
    pub factory: MonitorFactory,
}

/// One audition's synthesis: the server, the voice and its options, and what it reads.
pub(super) struct Speech {
    pub client: SpeechCppTts,
    pub voice: String,
    pub options: SynthesisOptions,
    pub language: &'static str,
    pub text: &'static str,
}

/// What the status names of an audition: its kind and the profile or model it plays.
#[derive(Debug, Clone)]
pub(super) struct Label {
    pub kind: &'static str,
    pub profile: Option<&'static str>,
    pub entry: Option<String>,
}

/// `recording` while an RVC audition records, `preparing` until the first audio is written,
/// then `playing`.
#[derive(Clone)]
pub(super) struct Stage(Arc<Mutex<&'static str>>);

impl Stage {
    fn new(initial: &'static str) -> Self {
        Self(Arc::new(Mutex::new(initial)))
    }

    fn set(&self, stage: &'static str) {
        *self.0.lock().unwrap() = stage;
    }

    fn playing(&self) {
        self.set("playing");
    }

    fn get(&self) -> &'static str {
        *self.0.lock().unwrap()
    }
}

/// What an RVC audition records: the microphone, how it opens, and for how long.
pub(super) struct Recording {
    pub open: CaptureOpener,
    pub input: Endpoint,
    pub seconds: u64,
}

type Job = Box<dyn FnOnce(&CancelToken, &Stage) -> Result<(), String> + Send>;

struct Running {
    run: u64,
    token: CancelToken,
    label: Label,
    stage: Stage,
    finished: Event,
}

#[derive(Default)]
struct State {
    run: u64,
    current: Option<Running>,
    /// The last audition that ended: `(run, outcome, error code)`.
    last: Option<(u64, &'static str, Option<String>)>,
    closed: bool,
}

/// The audition in progress and the outcome of the last one.
#[derive(Default)]
pub(super) struct Audition {
    state: Mutex<State>,
}

impl Audition {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// `{state, run, kind, profile, entry, stage, last_run, outcome, error_code}`: what the UI
    /// polls. Never text, paths or devices.
    pub fn status(&self) -> Value {
        let state = self.state.lock().unwrap();
        let (last_run, outcome, code) = state.last.clone().map_or((None, None, None), |(run, outcome, code)| (Some(run), Some(outcome), code));
        match &state.current {
            Some(running) => json!({
                "state": "playing", "run": running.run, "kind": running.label.kind, "profile": running.label.profile, "entry": running.label.entry,
                "stage": running.stage.get(), "last_run": last_run, "outcome": outcome, "error_code": code,
            }),
            None => json!({
                "state": "idle", "run": state.run, "kind": null, "profile": null, "entry": null, "stage": null,
                "last_run": last_run, "outcome": outcome, "error_code": code,
            }),
        }
    }

    /// Ends the audition in progress (Stop, Mute, its own stop). Never waits.
    pub fn stop(&self) {
        if let Some(running) = &self.state.lock().unwrap().current {
            running.token.cancel();
        }
    }

    /// Ends an RVC audition in progress: a conversion starts, and its worker comes first.
    pub fn stop_rvc(&self) {
        if let Some(running) = self.state.lock().unwrap().current.as_ref().filter(|running| running.label.kind == "rvc") {
            running.token.cancel();
        }
    }

    /// Ends the audition in progress and refuses new ones; true when it ended within `timeout`.
    pub fn close(&self, timeout: Duration) -> bool {
        let finished = {
            let mut state = self.state.lock().unwrap();
            state.closed = true;
            state.current.as_ref().map(|running| {
                running.token.cancel();
                running.finished.clone()
            })
        };
        finished.is_none_or(|finished| finished.wait(Some(timeout)))
    }

    pub fn closed(&self) -> bool {
        self.state.lock().unwrap().closed
    }

    /// The TTS sentence of `speech`, on `target`.
    pub fn start_tts(self: &Arc<Self>, profile: &'static str, speech: Speech, target: Target) -> Result<Value, &'static str> {
        let label = Label { kind: "tts", profile: Some(profile), entry: None };
        self.start(label, TIMEOUT, "preparing", Box::new(move |token, stage| play_tts(&speech, &target, token, stage)))
    }

    /// The user's voice, recorded now, converted by the worker `prepared` describes, on `target`.
    pub fn start_rvc(self: &Arc<Self>, entry: String, prepared: PreparedRvc, recording: Recording, target: Target) -> Result<Value, &'static str> {
        let label = Label { kind: "rvc", profile: None, entry: Some(entry) };
        self.start(label, RVC_TIMEOUT, "recording", Box::new(move |token, stage| play_rvc(&prepared, &recording, &target, token, stage)))
    }

    /// Starts `job` on its own thread, in place of the audition playing. Answers at once.
    fn start(self: &Arc<Self>, label: Label, timeout: Duration, stage: &'static str, job: Job) -> Result<Value, &'static str> {
        let token = CancelToken::new();
        let finished = Event::new();
        let stage = Stage::new(stage);
        let run = {
            let mut state = self.state.lock().unwrap();
            if state.closed {
                return Err("voice_audition_closed");
            }
            if let Some(previous) = state.current.take() {
                // Its thread records its end under its own run, which is no longer current.
                previous.token.cancel_with(REPLACED);
            }
            state.run += 1;
            state.current = Some(Running { run: state.run, token: token.clone(), label, stage: stage.clone(), finished: finished.clone() });
            state.run
        };
        // The answer says it plays, even when so short a sentence ends before the answer leaves.
        let answer = self.status();
        let this = self.clone();
        let spawned = thread::Builder::new().name("astarot-audition".into()).spawn({
            let token = token.clone();
            move || {
                let timer = Timer::start(token.clone(), timeout);
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| job(&token, &stage))).unwrap_or(Err("voice_audition_failed".into()));
                timer.cancel();
                this.ended(run, &token, result);
                finished.set();
            }
        });
        if spawned.is_err() {
            self.ended(run, &token, Err("voice_audition_failed".into()));
            return Err("voice_audition_failed");
        }
        Ok(answer)
    }

    fn ended(&self, run: u64, token: &CancelToken, result: Result<(), String>) {
        let (outcome, code) = match result {
            Ok(()) => ("completed", None),
            Err(_) if token.is_set() && matches!(token.reason().as_str(), "cancelled" | REPLACED) => ("stopped", None),
            Err(code) => ("failed", Some(code)),
        };
        let mut state = self.state.lock().unwrap();
        if state.current.as_ref().is_some_and(|running| running.run == run) {
            state.current = None;
        }
        if state.last.as_ref().is_none_or(|(last, _, _)| *last < run) {
            state.last = Some((run, outcome, code));
        }
    }
}

/// Cancels the token with `voice_audition_timeout` after `timeout`.
struct Timer(Event);

impl Timer {
    fn start(token: CancelToken, timeout: Duration) -> Self {
        let stopped = Event::new();
        let flag = stopped.clone();
        let _ = thread::Builder::new().name("astarot-audition-timeout".into()).spawn(move || {
            if !flag.wait(Some(timeout)) {
                token.cancel_with("voice_audition_timeout");
            }
        });
        Self(stopped)
    }

    fn cancel(&self) {
        self.0.set();
    }
}

fn speech_code(error: &SpeechError) -> String {
    if error.code().is_empty() { "voice_audition_failed".into() } else { error.code().to_owned() }
}

/// The sentence as the server reads it, from the voice on: speech.cpp's models put near-silence
/// before the voice (#556), and an audition starts at the voice.
fn sentence_frames(speech: &Speech, token: &CancelToken) -> Frames {
    let frames: Frames = Box::new(speech.client.synthesize_stream(speech.text, &speech.voice, speech.language, token, &speech.options));
    astarot_tts::onset::skip_leading_silence(frames)
}

/// The monitor, opened for the first audio and written in blocks of at most 10 ms.
struct Monitor<'a> {
    target: &'a Target,
    token: &'a CancelToken,
    stage: &'a Stage,
    output: Option<(Box<dyn Output>, (u32, u16))>,
}

impl<'a> Monitor<'a> {
    fn new(target: &'a Target, token: &'a CancelToken, stage: &'a Stage) -> Self {
        Self { target, token, stage, output: None }
    }

    fn write(&mut self, pcm: &[u8], format: (u32, u16)) -> Result<(), String> {
        if self.output.is_none() {
            // Checked again here, for the OS default the factory resolves.
            let device = (self.target.factory)(&self.target.device, format.0, format.1, &self.target.exclude).map_err(|error| astarot_audio_routing::monitor::error_code(&error))?;
            self.output = Some((device, format));
            self.stage.playing();
        }
        let (device, opened) = self.output.as_mut().expect("opened above");
        if *opened != format {
            return Err("format_changed".into());
        }
        let block = (format.0 as usize / 100).max(1) * format.1 as usize * 2;
        for pcm in pcm.chunks(block) {
            self.token.check().map_err(|error| speech_code(&error))?;
            device.write(&scale_pcm(pcm, self.target.volume), &Token(self.token)).map_err(|error| astarot_audio_routing::monitor::error_code(&error))?;
        }
        Ok(())
    }

    /// A finished audition plays out; a stopped one is cut.
    fn close(self, result: Result<(), String>) -> Result<(), String> {
        let Some((mut device, _)) = self.output else { return result };
        let closed = device.close(result.is_ok(), &Token(self.token)).map_err(|error| astarot_audio_routing::monitor::error_code(&error));
        result.and(closed)
    }
}

/// Synthesizes the sentence and writes it to the monitor only.
fn play_tts(speech: &Speech, target: &Target, token: &CancelToken, stage: &Stage) -> Result<(), String> {
    let mut monitor = Monitor::new(target, token, stage);
    let result = (|| -> Result<(), String> {
        for frame in sentence_frames(speech, token) {
            let frame = frame.map_err(|error| speech_code(&error))?;
            token.check().map_err(|error| speech_code(&error))?;
            monitor.write(frame.pcm(), (frame.sample_rate(), frame.channels()))?;
        }
        token.check().map_err(|error| speech_code(&error))
    })();
    monitor.close(result)
}

/// Records the user's voice, converts it with the voice model and writes the answers to the
/// monitor only. The worker loads while the voice is recorded.
fn play_rvc(prepared: &PreparedRvc, recording: &Recording, target: &Target, token: &CancelToken, stage: &Stage) -> Result<(), String> {
    let mut monitor = Monitor::new(target, token, stage);
    let check = || token.check().map_err(|error| speech_code(&error));
    let mut sample = || record(recording, token, stage);
    let mut write = |pcm: &[u8], _state: &'static str| monitor.write(pcm, (RATE, 1));
    let result = astarot_voice_conversion::audition::convert_sample(prepared, &mut sample, &mut write, &check).and_then(|()| check());
    monitor.close(result)
}

/// What a recording has taken so far.
struct Taken {
    pcm: Vec<u8>,
    error: Option<String>,
    done: bool,
}

/// Records `recording.seconds` of the chosen microphone, opening it now and closing it before
/// this returns, whether the recording is whole, stopped or failed. The audio is only returned.
fn record(recording: &Recording, token: &CancelToken, stage: &Stage) -> Result<Vec<u8>, String> {
    let want = recording.seconds as usize * RATE as usize * 2;
    let taken = Arc::new(Mutex::new(Taken { pcm: Vec::with_capacity(want), error: None, done: false }));
    let (audio, errors) = (taken.clone(), taken.clone());
    let callbacks = CaptureCallbacks {
        on_audio: Box::new(move |pcm: &[u8]| {
            let mut taken = audio.lock().unwrap();
            if taken.done {
                return false;
            }
            let room = want - taken.pcm.len();
            taken.pcm.extend_from_slice(&pcm[..pcm.len().min(room)]);
            taken.done = taken.pcm.len() >= want;
            !taken.done
        }),
        on_error: Box::new(move |code: &str| {
            let mut taken = errors.lock().unwrap();
            taken.error.get_or_insert_with(|| astarot_audio_routing::windows_route::capture_code(code).to_owned());
            taken.done = true;
        }),
    };
    stage.set("recording");
    let mut capture = (recording.open)(&recording.input, callbacks);
    let result = (|| -> Result<(), String> {
        capture.start().map_err(|error| astarot_audio_routing::windows_route::capture_code(&error.code).to_owned())?;
        let started = Instant::now();
        loop {
            token.check().map_err(|error| speech_code(&error))?;
            {
                let taken = taken.lock().unwrap();
                if let Some(code) = &taken.error {
                    return Err(code.clone());
                }
                if taken.done {
                    return Ok(());
                }
                // The device opened but gives nothing (Windows still asking for permission).
                if taken.pcm.is_empty() && started.elapsed() > FIRST_AUDIO_WAIT {
                    return Err("asr_capture_start_timeout".into());
                }
            }
            thread::sleep(Duration::from_millis(20));
        }
    })();
    capture.stop();
    result?;
    stage.set("preparing");
    let mut pcm = std::mem::take(&mut taken.lock().unwrap().pcm);
    pcm.truncate(pcm.len() & !1);
    let peak = pcm.chunks_exact(2).map(|sample| i16::from_le_bytes([sample[0], sample[1]]).unsigned_abs()).max().unwrap_or(0);
    if peak < SILENT_PEAK {
        return Err("voice_audition_recording_silent".into());
    }
    Ok(pcm)
}

/// The monitor an audition plays on, or why there is none. `cables` is `None` when the virtual
/// cables could not be listed on a PC that has them (Windows).
pub(super) fn monitor_target(settings: &astarot_tts::VoiceSettings, cables: Option<Vec<String>>, factory: MonitorFactory) -> Result<Target, &'static str> {
    // The monitor is off: the user chose no local output, and no other output is taken in its place.
    let (device, volume) = settings.monitor_choice().ok_or("voice_audition_monitor_off")?;
    let cables = cables.ok_or("voice_audition_devices_unavailable")?;
    let mut exclude: Vec<String> = Vec::new();
    for device in [settings.playback_device(), settings.output_device.as_str()].into_iter().map(str::to_owned).chain(cables) {
        if !device.is_empty() && !exclude.contains(&device) {
            exclude.push(device);
        }
    }
    // `""` is the OS default: the factory resolves it and checks it against the same list.
    if !device.is_empty() && check_monitor_target(device, &exclude).is_err() {
        return Err("voice_audition_monitor_blocked");
    }
    Ok(Target { device: device.to_owned(), volume, exclude, factory })
}

/// The voice, seed and instructions of a profile, as the speech bus would send them.
pub(super) fn speech_options(settings: &astarot_tts::VoiceSettings, profile: &str) -> (String, SynthesisOptions) {
    let (voice, seed, instructions) = if profile == "japanese" {
        (&settings.japanese_voice, &settings.japanese_seed, &settings.japanese_instructions)
    } else {
        (&settings.multilingual_voice, &settings.multilingual_seed, &settings.multilingual_instructions)
    };
    // Validated settings: the seed is empty or at most 16 digits within the safe range.
    let options = SynthesisOptions { seed: seed.parse().ok(), instructions: if instructions.trim().is_empty() { String::new() } else { instructions.clone() } };
    (voice.clone(), options)
}

/// The options of an RVC start for the audition of a model: its files, the request's pitch and
/// index rate, and the worker's choices saved for the live conversion (`direct`: the saved
/// direct voice settings). Without an index file the rate has nothing to blend and is 0.
pub(super) fn rvc_start_options(request: &RvcRequest, runtime: &str, model: &str, index: &str, direct: &Value) -> Value {
    let index_rate = if index.is_empty() { json!(0) } else { request.index_rate.clone() };
    let mut options = json!({ "engine": "rvc", "runtime": runtime, "model": model, "index": index, "pitch": request.pitch, "index_rate": index_rate });
    for (key, saved) in [("device", "rvc_device"), ("threads", "rvc_threads"), ("highpass", "rvc_highpass")] {
        if let Some(value) = direct.get(saved).filter(|value| !value.is_null()) {
            options[key] = value.clone();
        }
    }
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_start_names_a_sentence_and_never_carries_text() {
        let tts = |value: Value| match parse(&value) {
            Some(Request::Tts(request)) => Some(request),
            _ => None,
        };
        assert_eq!(tts(json!({ "kind": "tts", "profile": "japanese", "sentence": "ja" })).unwrap().language, "ja");
        assert_eq!(tts(json!({ "kind": "tts", "profile": "multilingual", "sentence": "en" })).unwrap().language, "en");
        for bad in [
            json!(null),
            json!({ "kind": "tts", "profile": "multilingual", "sentence": "ja" }),
            json!({ "kind": "tts", "profile": "japanese", "sentence": "en" }),
            json!({ "kind": "tts", "profile": "asr", "sentence": "ja" }),
            json!({ "kind": "rvc", "profile": "japanese", "sentence": "ja" }),
            json!({ "kind": "tts", "profile": "japanese", "sentence": "こんにちは" }),
            json!({ "kind": "tts", "profile": "japanese", "sentence": "ja", "text": "x" }),
            json!({ "kind": "tts", "profile": "japanese" }),
        ] {
            assert!(parse(&bad).is_none(), "{bad}");
        }
        assert_eq!(sentence_of("japanese").0, "ja");
        assert_eq!(sentence_of("multilingual").0, "en");
    }

    fn microphone() -> Value {
        json!({ "cookie": "1", "serial": "42", "name": "alsa_input.usb-mic", "media_class": "Audio/Source" })
    }

    #[test]
    fn an_rvc_start_names_a_model_by_its_id_and_never_a_path() {
        let rvc = json!({ "kind": "rvc", "entry": "rvc-saisho", "source": "recording", "input": microphone(), "seconds": 5, "pitch": -3, "index_rate": 0.5 });
        let Some(Request::Rvc(request)) = parse(&rvc) else { panic!("refused") };
        assert_eq!((request.entry.as_str(), request.source, request.seconds, request.pitch, request.index_rate.clone()), ("rvc-saisho", "recording", 5, -3, json!(0.5)));
        assert_eq!(request.input.name, "alsa_input.usb-mic");
        let mut own = rvc.clone();
        own["entry"] = json!("user-0123456789ab");
        own["index_rate"] = json!(1);
        let Some(Request::Rvc(own)) = parse(&own) else { panic!("refused") };
        assert_eq!(own.index_rate, json!(1), "an integer rate stays one");
        let with = |key: &str, value: Value| {
            let mut changed = rvc.clone();
            changed[key] = value;
            changed
        };
        let without = |key: &str| {
            let mut changed = rvc.clone();
            changed.as_object_mut().unwrap().remove(key);
            changed
        };
        for bad in [
            with("entry", json!("C:\\voices\\model.pth")),
            with("entry", json!("/voices/model.pth")),
            with("entry", json!("")),
            with("entry", json!("x".repeat(129))),
            with("source", json!("tts")),
            with("source", json!("file")),
            with("input", json!("Mic (Realtek)")),
            with("input", json!({ "name": "alsa_input.usb-mic" })),
            with("seconds", json!(0)),
            with("seconds", json!(11)),
            with("seconds", json!(2.5)),
            with("pitch", json!(25)),
            with("pitch", json!(1.5)),
            with("pitch", json!("3")),
            with("index_rate", json!(1.5)),
            with("index_rate", json!(-0.1)),
            with("index_rate", json!("0.5")),
            with("model", json!("/voices/model.pth")),
            without("input"),
            without("seconds"),
        ] {
            assert!(parse(&bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn the_audition_uses_the_requests_values_and_the_saved_worker_choices() {
        let input = parse_source(&microphone()).unwrap();
        let request = RvcRequest { entry: "rvc-saisho".into(), source: "recording", input, seconds: 5, pitch: 5, index_rate: json!(0.75) };
        let direct = json!({ "rvc_pitch": 0, "rvc_index_rate": 0.0, "rvc_device": "cpu", "rvc_threads": 4, "rvc_highpass": false });
        let options = rvc_start_options(&request, "/r", "/v.pth", "/v.index", &direct);
        assert_eq!(options, json!({ "engine": "rvc", "runtime": "/r", "model": "/v.pth", "index": "/v.index", "pitch": 5, "index_rate": 0.75, "device": "cpu", "threads": 4, "highpass": false }));
        assert!(astarot_voice_conversion::process::rvc_options(&options).is_ok());
        // Without an index file there is nothing to blend.
        let options = rvc_start_options(&request, "/r", "/v.pth", "", &json!({}));
        assert_eq!((options["index_rate"].clone(), options.get("device")), (json!(0), None));
        assert!(astarot_voice_conversion::process::rvc_options(&options).is_ok());
    }

    /// A microphone that hands over `pcm` in 10 ms parts until it is stopped, or fails to start.
    struct Feed {
        part: Vec<u8>,
        fails: Option<&'static str>,
        callbacks: Option<CaptureCallbacks>,
        stop: Arc<std::sync::atomic::AtomicBool>,
        stopped: Arc<std::sync::atomic::AtomicBool>,
        thread: Option<thread::JoinHandle<()>>,
    }

    impl Capture for Feed {
        fn start(&mut self) -> astarot_audio_routing::Result<()> {
            if let Some(code) = self.fails {
                return Err(astarot_audio_routing::Error::runtime(code));
            }
            let (mut callbacks, part, stop) = (self.callbacks.take().unwrap(), self.part.clone(), self.stop.clone());
            self.thread = Some(thread::spawn(move || {
                while !stop.load(std::sync::atomic::Ordering::SeqCst) && (callbacks.on_audio)(&part) {
                    thread::sleep(Duration::from_millis(1));
                }
            }));
            Ok(())
        }
        fn request_stop(&self) {
            self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        fn stop(&mut self) {
            self.request_stop();
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
            self.stopped.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }

    fn recording_of(sample: i16, fails: Option<&'static str>, seconds: u64) -> (Recording, Arc<std::sync::atomic::AtomicBool>) {
        let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let closed = stopped.clone();
        let open: CaptureOpener = Arc::new(move |_: &Endpoint, callbacks| {
            Box::new(Feed { part: sample.to_le_bytes().repeat(480), fails, callbacks: Some(callbacks), stop: Default::default(), stopped: closed.clone(), thread: None }) as Box<dyn Capture>
        });
        (Recording { open, input: parse_source(&microphone()).unwrap(), seconds }, stopped)
    }

    #[test]
    fn a_recording_is_as_long_as_asked_and_the_microphone_is_closed_after_it() {
        let (token, stage) = (CancelToken::new(), Stage::new("recording"));
        let (recording, stopped) = recording_of(2000, None, 1);
        let pcm = record(&recording, &token, &stage).unwrap();
        assert_eq!(pcm.len(), 48000 * 2, "one second at 48 kHz mono");
        assert!(stopped.load(std::sync::atomic::Ordering::SeqCst), "the microphone was left open");
        assert_eq!(stage.get(), "preparing");
        // Nothing heard: the microphone is off or another one. It is closed all the same.
        let (quiet, stopped) = recording_of(40, None, 1);
        assert_eq!(record(&quiet, &token, &stage).unwrap_err(), "voice_audition_recording_silent");
        assert!(stopped.load(std::sync::atomic::Ordering::SeqCst));
        // A microphone that cannot start says so with the capture's code, a code it does not know
        // as the generic one.
        let (failing, _) = recording_of(2000, Some("asr_capture_stream_create_failed"), 1);
        assert_eq!(record(&failing, &token, &stage).unwrap_err(), "asr_capture_stream_create_failed");
        let (unknown, _) = recording_of(2000, Some("C:\\private\\path"), 1);
        assert_eq!(record(&unknown, &token, &stage).unwrap_err(), "asr_capture_failed");
        // A stop ends the recording at once and closes the microphone.
        let stopping = CancelToken::new();
        stopping.cancel();
        let (long, stopped) = recording_of(2000, None, 10);
        assert!(record(&long, &stopping, &stage).is_err());
        assert!(stopped.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn the_monitor_must_be_on_and_never_the_voice_output_or_a_cable() {
        let factory: MonitorFactory = Arc::new(|_: &str, _: u32, _: u16, _: &[String]| Err(astarot_audio_routing::Error::speech("unused")));
        let settings = |value: Value| astarot_tts::VoiceSettings::from_value_on(&value, astarot_tts::settings::Platform::Windows).unwrap();
        let off = settings(json!({ "output_device": "Cable In" }));
        assert_eq!(monitor_target(&off, Some(vec![]), factory.clone()).err(), Some("voice_audition_monitor_off"));
        let on = settings(json!({ "output_device": "Cable In", "monitor": "on", "monitor_device": "Other Cable", "monitor_volume": "40" }));
        assert_eq!(monitor_target(&on, None, factory.clone()).err(), Some("voice_audition_devices_unavailable"));
        assert_eq!(monitor_target(&on, Some(vec!["Other Cable".into()]), factory.clone()).err(), Some("voice_audition_monitor_blocked"));
        let target = monitor_target(&on, Some(vec![]), factory.clone()).unwrap();
        assert_eq!((target.device.as_str(), target.volume), ("Other Cable", 40));
        assert!(target.exclude.contains(&"Cable In".to_owned()));
        // The OS default is resolved by the factory, which checks it against the same list.
        let default = settings(json!({ "output_device": "Cable In", "monitor": "on" }));
        let target = monitor_target(&default, Some(vec!["Cable B".into()]), factory).unwrap();
        assert_eq!(target.device, "");
        assert_eq!(target.exclude, ["Cable In", "Cable B"]);
    }
}
