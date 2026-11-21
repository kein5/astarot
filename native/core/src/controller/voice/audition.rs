//! The voice auditions of the TTS and RVC catalogs (#415), played only on the monitor output
//! the user chose.
//!
//! - TTS: a short fixed sentence, spoken by the running bundled speech.cpp server of one profile
//!   with that profile's voice settings.
//! - RVC: a sample converted by a downloaded or registered voice model, in an RVC worker of its
//!   own ([`vrct_voice_conversion::audition`]). The sample is chosen by `source`; the only one so
//!   far is `tts`, the TTS sentence read by a running bundled server. The pitch and the index rate
//!   come with the request, so the values on the form can be heard before they are saved.
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
use std::time::Duration;

use serde_json::{Map, Value, json};
use vrct_audio_routing::monitor::{MonitorFactory, check_monitor_target, scale_pcm};
use vrct_audio_routing::router::Output;
use vrct_tts::playback::Frames;
use vrct_tts::sync::Event;
use vrct_tts::{CancelToken, SpeechCppTts, SpeechError, SynthesisOptions};
use vrct_voice_conversion::PreparedRvc;
use vrct_voice_conversion::protocol::RATE;

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

/// What an RVC audition converts. `tts`: the TTS sentence of a running bundled server.
pub(super) const RVC_SOURCES: [&str; 1] = ["tts"];

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
    pub pitch: i64,
    /// As sent: an integer stays one for the worker (`rate_text`).
    pub index_rate: Value,
}

/// `{"kind": "tts", "profile": "japanese"|"multilingual", "sentence": "ja"|"en"}` or
/// `{"kind": "rvc", "entry", "source": "tts", "pitch": -24..=24, "index_rate": 0..=1}`.
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
    if object.len() != 5 {
        return None;
    }
    let entry = object.get("entry")?.as_str().filter(|id| (1..=128).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b)))?;
    let source = object.get("source")?.as_str()?;
    let source = *RVC_SOURCES.iter().find(|known| **known == source)?;
    let pitch = object.get("pitch").filter(|value| value.is_i64() || value.is_u64())?.as_i64().filter(|pitch| (-24..=24).contains(pitch))?;
    let index_rate = object.get("index_rate").filter(|value| value.as_f64().is_some_and(|rate| rate.is_finite() && (0.0..=1.0).contains(&rate)))?;
    Some(RvcRequest { entry: entry.to_owned(), source, pitch, index_rate: index_rate.clone() })
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

/// `preparing` until the first audio is written, then `playing`.
#[derive(Clone)]
pub(super) struct Stage(Arc<Mutex<&'static str>>);

impl Stage {
    fn new() -> Self {
        Self(Arc::new(Mutex::new("preparing")))
    }

    fn playing(&self) {
        *self.0.lock().unwrap() = "playing";
    }

    fn get(&self) -> &'static str {
        *self.0.lock().unwrap()
    }
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
        self.start(label, TIMEOUT, Box::new(move |token, stage| play_tts(&speech, &target, token, stage)))
    }

    /// The TTS sentence of `speech` converted by the worker `prepared` describes, on `target`.
    pub fn start_rvc(self: &Arc<Self>, entry: String, prepared: PreparedRvc, speech: Speech, target: Target) -> Result<Value, &'static str> {
        let label = Label { kind: "rvc", profile: None, entry: Some(entry) };
        self.start(label, RVC_TIMEOUT, Box::new(move |token, stage| play_rvc(&prepared, &speech, &target, token, stage)))
    }

    /// Starts `job` on its own thread, in place of the audition playing. Answers at once.
    fn start(self: &Arc<Self>, label: Label, timeout: Duration, job: Job) -> Result<Value, &'static str> {
        let token = CancelToken::new();
        let finished = Event::new();
        let stage = Stage::new();
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
    vrct_tts::onset::skip_leading_silence(frames)
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
            let device = (self.target.factory)(&self.target.device, format.0, format.1, &self.target.exclude).map_err(|error| vrct_audio_routing::monitor::error_code(&error))?;
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
            device.write(&scale_pcm(pcm, self.target.volume), &Token(self.token)).map_err(|error| vrct_audio_routing::monitor::error_code(&error))?;
        }
        Ok(())
    }

    /// A finished audition plays out; a stopped one is cut.
    fn close(self, result: Result<(), String>) -> Result<(), String> {
        let Some((mut device, _)) = self.output else { return result };
        let closed = device.close(result.is_ok(), &Token(self.token)).map_err(|error| vrct_audio_routing::monitor::error_code(&error));
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

/// Converts the sentence with the voice model and writes the answers to the monitor only. The
/// sentence is read while the worker loads.
fn play_rvc(prepared: &PreparedRvc, speech: &Speech, target: &Target, token: &CancelToken, stage: &Stage) -> Result<(), String> {
    let mut monitor = Monitor::new(target, token, stage);
    let check = || token.check().map_err(|error| speech_code(&error));
    let mut sample = || -> Result<Vec<u8>, String> {
        let mut pcm = Vec::new();
        for chunk in vrct_tts::converted::to_conversion_rate(sentence_frames(speech, token)) {
            pcm.extend(chunk.map_err(|error| speech_code(&error))?);
            if pcm.len() > vrct_voice_conversion::audition::MAX_SAMPLE_BYTES {
                return Err("voice_audition_sample_invalid".into());
            }
        }
        check()?;
        if pcm.is_empty() {
            return Err("voice_audition_sample_invalid".into());
        }
        Ok(pcm)
    };
    let mut write = |pcm: &[u8], _state: &'static str| monitor.write(pcm, (RATE, 1));
    let result = vrct_voice_conversion::audition::convert_sample(prepared, &mut sample, &mut write, &check).and_then(|()| check());
    monitor.close(result)
}

/// The monitor an audition plays on, or why there is none. `cables` is `None` when the virtual
/// cables could not be listed on a PC that has them (Windows).
pub(super) fn monitor_target(settings: &vrct_tts::VoiceSettings, cables: Option<Vec<String>>, factory: MonitorFactory) -> Result<Target, &'static str> {
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
pub(super) fn speech_options(settings: &vrct_tts::VoiceSettings, profile: &str) -> (String, SynthesisOptions) {
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

    #[test]
    fn an_rvc_start_names_a_model_by_its_id_and_never_a_path() {
        let rvc = json!({ "kind": "rvc", "entry": "rvc-saisho", "source": "tts", "pitch": -3, "index_rate": 0.5 });
        let Some(Request::Rvc(request)) = parse(&rvc) else { panic!("refused") };
        assert_eq!((request.entry.as_str(), request.source, request.pitch, request.index_rate.clone()), ("rvc-saisho", "tts", -3, json!(0.5)));
        let Some(Request::Rvc(own)) = parse(&json!({ "kind": "rvc", "entry": "user-0123456789ab", "source": "tts", "pitch": 24, "index_rate": 1 })) else { panic!("refused") };
        assert_eq!(own.index_rate, json!(1), "an integer rate stays one");
        let with = |key: &str, value: Value| {
            let mut changed = rvc.clone();
            changed[key] = value;
            changed
        };
        for bad in [
            with("entry", json!("C:\\voices\\model.pth")),
            with("entry", json!("/voices/model.pth")),
            with("entry", json!("")),
            with("entry", json!("x".repeat(129))),
            with("source", json!("recording")),
            with("source", json!("file")),
            with("pitch", json!(25)),
            with("pitch", json!(1.5)),
            with("pitch", json!("3")),
            with("index_rate", json!(1.5)),
            with("index_rate", json!(-0.1)),
            with("index_rate", json!("0.5")),
            with("model", json!("/voices/model.pth")),
            json!({ "kind": "rvc", "entry": "rvc-saisho", "source": "tts", "pitch": 0 }),
        ] {
            assert!(parse(&bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn the_audition_uses_the_requests_values_and_the_saved_worker_choices() {
        let request = RvcRequest { entry: "rvc-saisho".into(), source: "tts", pitch: 5, index_rate: json!(0.75) };
        let direct = json!({ "rvc_pitch": 0, "rvc_index_rate": 0.0, "rvc_device": "cpu", "rvc_threads": 4, "rvc_highpass": false });
        let options = rvc_start_options(&request, "/r", "/v.pth", "/v.index", &direct);
        assert_eq!(options, json!({ "engine": "rvc", "runtime": "/r", "model": "/v.pth", "index": "/v.index", "pitch": 5, "index_rate": 0.75, "device": "cpu", "threads": 4, "highpass": false }));
        assert!(vrct_voice_conversion::process::rvc_options(&options).is_ok());
        // Without an index file there is nothing to blend.
        let options = rvc_start_options(&request, "/r", "/v.pth", "", &json!({}));
        assert_eq!((options["index_rate"].clone(), options.get("device")), (json!(0), None));
        assert!(vrct_voice_conversion::process::rvc_options(&options).is_ok());
    }

    #[test]
    fn the_monitor_must_be_on_and_never_the_voice_output_or_a_cable() {
        let factory: MonitorFactory = Arc::new(|_: &str, _: u32, _: u16, _: &[String]| Err(vrct_audio_routing::Error::speech("unused")));
        let settings = |value: Value| vrct_tts::VoiceSettings::from_value_on(&value, vrct_tts::settings::Platform::Windows).unwrap();
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
