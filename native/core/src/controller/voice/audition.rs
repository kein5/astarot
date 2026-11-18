//! The voice audition of the TTS catalog (#415): a short fixed sentence, spoken by the running
//! bundled speech.cpp server of one profile with that profile's voice settings, and played only
//! on the monitor output the user chose.
//!
//! - It never reaches the virtual microphone, the managed route or VRChat: the output is the
//!   monitor device, checked against the TTS output and the virtual cables found, and refused
//!   when the monitor is off (no fallback to any other output).
//! - It sounds only on the user's press, is refused while the voice is muted, and ends with
//!   Stop, Mute, its own stop and the end of the run. One plays at a time: a new press replaces
//!   the one playing.
//! - The sentence is chosen by an id; its text lives here and goes only into the request to the
//!   local server. Nothing of it, nor the audio, is logged, kept or returned.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};
use vrct_audio_routing::monitor::{MonitorFactory, check_monitor_target, scale_pcm};
use vrct_audio_routing::router::Output;
use vrct_tts::playback::Frames;
use vrct_tts::sync::Event;
use vrct_tts::{CancelToken, SpeechCppTts, SpeechError, SynthesisOptions};

use super::Token;

/// The sentences by id: `(id, language tag, text)`. Short, so that a change of a setting can be
/// heard again at once.
const SENTENCES: [(&str, &str, &str); 2] = [
    ("ja", "ja", "こんにちは。この声で読み上げます。"),
    ("en", "en", "Hello. This is how I will sound."),
];

/// An audition ends within this time, as one utterance of the speech bus does.
const TIMEOUT: Duration = Duration::from_secs(30);

/// The reason a token carries when a newer audition took its place.
const REPLACED: &str = "voice_audition_replaced";

/// What a start asks for, checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Request {
    pub profile: &'static str,
    pub language: &'static str,
    pub text: &'static str,
}

/// `{"kind": "tts", "profile": "japanese"|"multilingual", "sentence": "ja"|"en"}`. Each profile
/// reads the language it speaks in use: TTS sends Japanese to the Japanese server and every
/// other language to the multilingual one.
pub(super) fn parse(data: &Value) -> Option<Request> {
    let object = data.as_object().filter(|o| o.len() == 3)?;
    if object.get("kind")?.as_str()? != "tts" {
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
    Some(Request { profile, language, text })
}

/// Where and how loud an audition plays.
pub(super) struct Target {
    pub device: String,
    pub volume: u8,
    /// Outputs it must never be: the TTS output and the virtual cables.
    pub exclude: Vec<String>,
    pub factory: MonitorFactory,
}

/// One audition's synthesis: the server, the voice and its options.
pub(super) struct Speech {
    pub client: SpeechCppTts,
    pub voice: String,
    pub options: SynthesisOptions,
}

struct Running {
    run: u64,
    token: CancelToken,
    profile: &'static str,
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

    /// `{state, run, profile, outcome, error_code}`: what the UI polls. Never text or devices.
    pub fn status(&self) -> Value {
        let state = self.state.lock().unwrap();
        let (last_run, outcome, code) = state.last.clone().map_or((None, None, None), |(run, outcome, code)| (Some(run), Some(outcome), code));
        match &state.current {
            Some(running) => json!({ "state": "playing", "run": running.run, "profile": running.profile, "last_run": last_run, "outcome": outcome, "error_code": code }),
            None => json!({ "state": "idle", "run": state.run, "profile": null, "last_run": last_run, "outcome": outcome, "error_code": code }),
        }
    }

    /// Ends the audition in progress (Stop, Mute, its own stop). Never waits.
    pub fn stop(&self) {
        if let Some(running) = &self.state.lock().unwrap().current {
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

    /// Starts an audition on its own thread, in place of the one playing. Answers at once.
    pub fn start(self: &Arc<Self>, request: Request, speech: Speech, target: Target) -> Result<Value, &'static str> {
        let token = CancelToken::new();
        let finished = Event::new();
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
            state.current = Some(Running { run: state.run, token: token.clone(), profile: request.profile, finished: finished.clone() });
            state.run
        };
        // The answer says it plays, even when so short a sentence ends before the answer leaves.
        let answer = self.status();
        let this = self.clone();
        let spawned = thread::Builder::new().name("vrct-vox-audition".into()).spawn({
            let token = token.clone();
            move || {
                let timer = Timer::start(token.clone());
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| play(&request, &speech, &target, &token))).unwrap_or(Err("voice_audition_failed".into()));
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

/// Cancels the token with `voice_audition_timeout` after [`TIMEOUT`].
struct Timer(Event);

impl Timer {
    fn start(token: CancelToken) -> Self {
        let stopped = Event::new();
        let flag = stopped.clone();
        let _ = thread::Builder::new().name("vrct-vox-audition-timeout".into()).spawn(move || {
            if !flag.wait(Some(TIMEOUT)) {
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

/// Synthesizes the sentence and writes it to the monitor only, in blocks of at most 10 ms.
fn play(request: &Request, speech: &Speech, target: &Target, token: &CancelToken) -> Result<(), String> {
    let frames: Frames = Box::new(speech.client.synthesize_stream(request.text, &speech.voice, request.language, token, &speech.options));
    // speech.cpp's models put near-silence before the voice (#556); an audition starts at the voice.
    let frames = vrct_tts::onset::skip_leading_silence(frames);
    let mut output: Option<(Box<dyn Output>, (u32, u16))> = None;
    let result = (|| -> Result<(), String> {
        for frame in frames {
            let frame = frame.map_err(|error| speech_code(&error))?;
            token.check().map_err(|error| speech_code(&error))?;
            let format = (frame.sample_rate(), frame.channels());
            if output.is_none() {
                // Checked again here, for the OS default the factory resolves.
                let device = (target.factory)(&target.device, format.0, format.1, &target.exclude).map_err(|error| vrct_audio_routing::monitor::error_code(&error))?;
                output = Some((device, format));
            }
            let (device, opened) = output.as_mut().expect("opened above");
            if *opened != format {
                return Err("format_changed".into());
            }
            let block = (format.0 as usize / 100).max(1) * format.1 as usize * 2;
            for pcm in frame.pcm().chunks(block) {
                token.check().map_err(|error| speech_code(&error))?;
                device.write(&scale_pcm(pcm, target.volume), &Token(token)).map_err(|error| vrct_audio_routing::monitor::error_code(&error))?;
            }
        }
        token.check().map_err(|error| speech_code(&error))
    })();
    if let Some((mut device, _)) = output {
        // A finished sentence plays out; a stopped one is cut.
        let closed = device.close(result.is_ok(), &Token(token)).map_err(|error| vrct_audio_routing::monitor::error_code(&error));
        return result.and(closed);
    }
    result
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_start_names_a_sentence_and_never_carries_text() {
        assert_eq!(parse(&json!({ "kind": "tts", "profile": "japanese", "sentence": "ja" })).unwrap().language, "ja");
        assert_eq!(parse(&json!({ "kind": "tts", "profile": "multilingual", "sentence": "en" })).unwrap().language, "en");
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
