//! Speech recognition (#278): the microphone and speaker switches, the volume meters, the cloud
//! engines' keys and their start-up check, mic mute sync and device changes.
//!
//! Port of the recorder parts of `src-python/controller.py` (`setEnable/DisableTranscription*`,
//! `setEnable/DisableCheck*Threshold`, `_start*Locked`, `micMessage`, `speakerMessage`,
//! `progressBar*Energy`, `_audioPipelineFailed*`, `_disableAudioAfterDeviceLossLocked`,
//! `_setTranscriptionCredential`, `_setEndpointCredential` for the custom server, the engine
//! check of `init`) and of `model.py` (`_AudioDeviceSession`). The recorder, the engines and
//! realtime recognition are in `native/transcription`; realtime recognition is wired in
//! [`super::realtime_asr`].
//!
//! Locks: a source's lock is the audio devices' (`_audioLock`); the recorder of a source is
//! changed only under it. Nothing here logs recognised text, audio or a key.

use super::audio_devices::{CaptureOwner, Reopened, Source, SourceGuard};
use super::messages::{Guard, Recognized};
use super::routes::{Builder, OPEN};
use super::{Core, ok};
use crate::errors::ErrorReply;
use crate::protocol::Reply;
use serde_json::{Map, Value, json};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use vrct_audio_routing::identity::{Device, capture_key};
use vrct_transcription::providers::{self, Candidate, Engine, Recognizer};
use vrct_transcription::diagnostics::{Diagnostics, Event as Diagnosed, Stage};
use vrct_transcription::recorder::{Event, Failure, Recorder, Settings};

/// The Whisper APIs whose models come from `/models` (`TRANSCRIPTION_API_ENGINES`).
const COMPATIBLE_ENGINES: [&str; 3] = ["Groq_Whisper", "OpenAI_Whisper", "Custom_Whisper"];

pub(crate) fn index(source: Source) -> usize {
    match source {
        Source::Mic => 0,
        Source::Speaker => 1,
    }
}

pub(crate) fn direction(source: Source) -> &'static str {
    match source {
        Source::Mic => "send",
        Source::Speaker => "receive",
    }
}

/// `_audioFlags`.
pub(crate) fn flags(source: Source) -> (&'static str, &'static str) {
    match source {
        Source::Mic => ("ENABLE_TRANSCRIPTION_SEND", "ENABLE_CHECK_ENERGY_SEND"),
        Source::Speaker => ("ENABLE_TRANSCRIPTION_RECEIVE", "ENABLE_CHECK_ENERGY_RECEIVE"),
    }
}

fn upper(source: Source) -> &'static str {
    match source {
        Source::Mic => "MIC",
        Source::Speaker => "SPEAKER",
    }
}

/// The recognition language table as one value, for the engines.
fn table() -> &'static Value {
    static TABLE: OnceLock<Value> = OnceLock::new();
    TABLE.get_or_init(|| Value::Object(crate::languages::transcription().clone()))
}

/// The recorder of one source (`_AudioDeviceSession`).
#[derive(Default)]
struct Legacy {
    recorder: Option<Recorder>,
    transcript: bool,
    energy: bool,
    /// The device the running capture has open.
    active: Option<Device>,
    /// Stopped recorders whose engine request ran past the stop's wait (`_cleanup_workers`):
    /// a handoff waits for them.
    lingering: Vec<Recorder>,
}

/// Why the recorder could not start.
enum StartError {
    /// `TranscriptionStartError`: the engine could not be made (`/set/enable/transcription_*`).
    Engine(&'static str),
    /// The device could not be opened, or there was none.
    Device,
}

/// What a reconfiguration did.
#[allow(clippy::large_enum_variant)]
enum Reconfigured {
    Unchanged,
    /// Running on this device; `previous` is what to tell the UI it moved from.
    Running { device: Device, previous: Option<Device> },
    Off,
}

/// The recognition area.
pub struct Transcription {
    core: OnceLock<Weak<Core>>,
    legacy: [Mutex<Legacy>; 2],
    /// The capture revision of each source's recorder: events of an older one are dropped.
    revisions: [AtomicU64; 2],
    /// `message_delivery`: a revoked epoch refuses what was admitted before.
    epochs: [AtomicU64; 2],
    /// Whether mic mute sync holds the microphone back now.
    mic_paused: Arc<AtomicBool>,
    pub(crate) realtime: super::realtime_asr::Realtime,
    /// `utterance_diagnostics`: the speech timings of both paths, summed up in `process.log`
    /// (decision 15).
    pub(crate) diagnostics: Diagnostics,
}

impl Transcription {
    pub(crate) fn new(config: &crate::config::Config) -> Arc<Transcription> {
        Arc::new_cyclic(|area: &Weak<Transcription>| {
            let area = area.clone();
            let log = Arc::new(move |line: &str| {
                if let Some(core) = area.upgrade().and_then(|area| area.core()) {
                    core.step(line);
                }
            });
            Transcription {
                core: OnceLock::new(),
                legacy: [Mutex::default(), Mutex::default()],
                revisions: [AtomicU64::new(0), AtomicU64::new(0)],
                epochs: [AtomicU64::new(0), AtomicU64::new(0)],
                mic_paused: Arc::new(AtomicBool::new(false)),
                realtime: super::realtime_asr::Realtime::new(config),
                diagnostics: Diagnostics::new(log),
            }
        })
    }

    /// Makes the mute sync hooks of the services reach the microphone's recognition too.
    pub(crate) fn wrap_services(self: &Arc<Self>, mut services: super::Services) -> super::Services {
        let (muted, stopped) = (services.vrc_mic_mute.clone(), services.stop_mic_transcription.clone());
        let area = Arc::downgrade(self);
        services.vrc_mic_mute = Arc::new(move |held| {
            if let Some(area) = area.upgrade() {
                area.mic_paused.store(held, Ordering::SeqCst);
            }
            muted(held);
        });
        let area = Arc::downgrade(self);
        services.stop_mic_transcription = Arc::new(move || {
            // Called under the mute lock: the stop runs on its own thread.
            if let Some(core) = area.upgrade().and_then(|area| area.core()) {
                core.transcription.revoke(Source::Mic);
                let _ = core.config().set("ENABLE_TRANSCRIPTION_SEND", json!(false));
                std::thread::spawn(move || {
                    core.set_disable_transcription(Source::Mic, &Value::Null);
                });
            }
            stopped();
        });
        services
    }

    fn core(&self) -> Option<Arc<Core>> {
        self.core.get().and_then(Weak::upgrade)
    }

    fn legacy(&self, source: Source) -> std::sync::MutexGuard<'_, Legacy> {
        self.legacy[index(source)].lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `message_delivery.revoke`.
    pub(crate) fn revoke(&self, source: Source) {
        self.epochs[index(source)].fetch_add(1, Ordering::SeqCst);
    }

    /// `_messagePublicationGuard`: still current while the epoch holds (the mute is checked by
    /// the message pipeline itself).
    pub(crate) fn publication_guard(self: &Arc<Self>, source: Source) -> Guard {
        let epoch = self.epochs[index(source)].load(Ordering::SeqCst);
        let area = Arc::downgrade(self);
        Arc::new(move || area.upgrade().is_some_and(|area| area.epochs[index(source)].load(Ordering::SeqCst) == epoch))
    }

    /// `stop_for_handoff`: stops the recorder; false when its device was not confirmed released
    /// or an engine request of a stopped recorder still runs.
    pub(crate) fn stop_legacy(&self, source: Source) -> bool {
        let mut legacy = self.legacy(source);
        legacy.transcript = false;
        legacy.energy = false;
        legacy.active = None;
        self.revisions[index(source)].fetch_add(1, Ordering::SeqCst);
        self.stop_recorder(source, &mut legacy)
    }

    /// `_stop`: stops the recorder and waits up to `Services::recorder_stop_wait` (15 s) for an
    /// engine request in flight (decision 15 (1)); its result is dropped. A request still running
    /// is kept until it ends, and the answer is false until then, as it is when the device was not
    /// confirmed released.
    fn stop_recorder(&self, source: Source, legacy: &mut Legacy) -> bool {
        let core = self.core();
        let stopped = match legacy.recorder.take() {
            Some(mut recorder) => {
                let wait = core.as_ref().map_or(vrct_transcription::recorder::STOP_WAIT, |core| core.services().recorder_stop_wait);
                let stopped = recorder.stop_within(wait);
                if !recorder.settled() {
                    if let Some(core) = &core {
                        core.step(&format!("{}: an engine request did not end within the stop's wait", source.as_str()));
                    }
                    legacy.lingering.push(recorder);
                }
                stopped
            }
            None => true,
        };
        legacy.lingering.retain(|recorder| !recorder.settled());
        stopped && legacy.lingering.is_empty()
    }
}

impl CaptureOwner for Transcription {
    fn reconfigure(&self, source: Source, target: &vrct_audio_routing::identity::Device, previous: Option<&Device>) -> Reopened {
        let Some(core) = self.core() else { return Reopened::Unchanged };
        let (transcript, energy) = flags(source);
        let (transcript, energy) = (core.config().get_bool(transcript), core.config().get_bool(energy));
        match core.reconfigure(source, Some(transcript), Some(energy), Some(Some(target.clone())), previous.cloned()) {
            Ok(Reconfigured::Running { device, previous }) => match previous {
                Some(previous) if capture_key(Some(&previous)) != capture_key(Some(&device)) => {
                    Reopened::Moved(Box::new(device), Box::new(previous))
                }
                _ => Reopened::On(Box::new(device)),
            },
            Ok(Reconfigured::Unchanged) => match self.legacy(source).active.clone() {
                Some(device) => Reopened::On(Box::new(device)),
                None => Reopened::Unchanged,
            },
            Ok(Reconfigured::Off) | Err(_) => {
                core.terminal_failure(source);
                Reopened::Off
            }
        }
    }

    fn device_lost(&self, source: Source) {
        if let Some(core) = self.core() {
            core.disable_after_device_loss(source);
        }
    }

    fn active_device(&self, source: Source) -> Option<Device> {
        self.legacy(source).active.clone()
    }
}

impl Core {
    pub(crate) fn transcription(&self) -> &Arc<Transcription> {
        &self.transcription
    }

    /// `_realtimeToggles`: the main switches start realtime recognition (Linux always, Windows
    /// with the local engine) instead of the recorder.
    pub(crate) fn realtime_toggles(&self) -> bool {
        match self.config().environment().platform {
            crate::config::Platform::Linux => true,
            crate::config::Platform::Windows => {
                self.config().get_str("SELECTED_TRANSCRIPTION_ENGINE") == crate::languages::LOCAL_SPEECH_ENGINE
            }
        }
    }

    /// `_disableTranscriptionAfterPipelineErrorLocked`: both switches off, told to the UI.
    pub(crate) fn disable_after_pipeline_error(&self, source: Source) {
        // What the recorder still reports is stale from here on.
        self.transcription.revisions[index(source)].fetch_add(1, Ordering::SeqCst);
        let (transcript_key, energy_key) = flags(source);
        let config = self.config();
        let (transcript, energy) = (config.get_bool(transcript_key), config.get_bool(energy_key));
        let _ = config.set(transcript_key, json!(false));
        let _ = config.set(energy_key, json!(false));
        if transcript {
            self.transcription.revoke(source);
        }
        self.run(200, &format!("/set/disable/transcription_{}", direction(source)), json!(false));
        if energy {
            self.run(200, &format!("/set/disable/check_{}_threshold", source.as_str()), json!(false));
            self.run(200, &format!("/run/check_{}_volume", source.as_str()), json!(0));
        }
    }

    /// `_audioTerminalFailureLocked`: off and told, unless already off.
    fn terminal_failure(&self, source: Source) {
        let (transcript, energy) = flags(source);
        if self.config().get_bool(transcript) || self.config().get_bool(energy) {
            self.disable_after_pipeline_error(source);
        }
    }

    /// `_disableAudioAfterDeviceLossLocked` (the source's lock is held).
    fn disable_after_device_loss(&self, source: Source) {
        self.audio_devices().advance_generation(source);
        self.disable_after_pipeline_error(source);
        self.transcription.stop_legacy(source);
    }

    fn notify_device_error(&self, source: Source) {
        self.audio_devices().notify_device_missing(source);
    }

    /// `AudioPipelineFailure.to_notification`, with `cause` when the engine said why it failed
    /// (`TRANSCRIPTION_API_*`). `error_code` stays what Python sent.
    fn failure_payload(source: Source, failure: Failure) -> Value {
        let message = ErrorReply::new(failure.code, Value::Null).body()["message"].clone();
        let mut payload = json!({
            "text": "",
            "language": null,
            "recognition_error": true,
            "error_code": failure.code,
            "stage": failure.stage,
            "source": source.as_str(),
            "message": message,
            "recoverable": false,
        });
        if let Some(cause) = failure.cause {
            payload["cause"] = json!(cause);
        }
        payload
    }

    /// The candidate languages of a source (`_transcribe`): its enabled own or target slots.
    fn candidates(&self, source: Source, engine: &str) -> Vec<Candidate> {
        let config = self.config();
        let tab = config.get_str("SELECTED_TAB_NO");
        let key = if source == Source::Mic { "SELECTED_YOUR_LANGUAGES" } else { "SELECTED_TARGET_LANGUAGES" };
        let slots = config.get(key)[&tab].clone();
        let mut candidates = Vec::new();
        for slot in slots.as_object().into_iter().flat_map(|o| o.values()) {
            if slot["enable"] != true {
                continue;
            }
            let (language, country) = (slot["language"].as_str().unwrap_or(""), slot["country"].as_str().unwrap_or(""));
            let entry = &table()[language][country];
            let text = |column: &str| entry[column].as_str().unwrap_or("").to_string();
            candidates.push(Candidate {
                language: language.to_string(),
                google: text("Google"),
                whisper: text("Whisper"),
                engine: text(engine),
            });
        }
        candidates
    }

    /// The configured engine (`_resolve_api_transcription_kwargs` and the checks of
    /// `AudioTranscriber.__init__`); `Err` names why it cannot start.
    fn recognizer(&self) -> Result<Recognizer, &'static str> {
        let config = self.config();
        let engine = config.get("SELECTED_TRANSCRIPTION_ENGINE");
        let Some(engine) = engine.as_str() else { return Err("TRANSCRIPTION_ENGINE_NOT_SELECTED") };
        let endpoints = &self.services().transcription_endpoints;
        let key = |name: &str| config.get("TRANSCRIPTION_AUTH_KEYS")[name].as_str().unwrap_or("").to_string();
        let selected = |name: &str| config.get(name).as_str().unwrap_or("").to_string();
        let built = match engine {
            "Groq_Whisper" | "OpenAI_Whisper" | "Custom_Whisper" => {
                let _guard = self.credential_lock.lock().unwrap();
                let (base_url, model) = match engine {
                    "Groq_Whisper" => (endpoints.groq.clone(), selected("SELECTED_GROQ_WHISPER_MODEL")),
                    "OpenAI_Whisper" => (endpoints.openai.clone(), selected("SELECTED_OPENAI_WHISPER_MODEL")),
                    _ => (config.get_str("TRANSCRIPTION_CUSTOM_URL"), selected("SELECTED_CUSTOM_WHISPER_MODEL")),
                };
                if vrct_translation::http::Url::parse(&base_url).is_err() {
                    return Err("TRANSCRIPTION_ENGINE_UNAVAILABLE");
                }
                Engine::Compatible { name: engine.to_string(), key: key(engine), base_url, model }
            }
            "Deepgram" => {
                let model = selected("SELECTED_DEEPGRAM_MODEL");
                let languages = config.get("DEEPGRAM_MODEL_LANGUAGES")[&model]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect();
                Engine::Deepgram { key: key("Deepgram"), model, languages, base_url: endpoints.deepgram.clone() }
            }
            // The local engine listens through realtime recognition, not this recorder.
            _ => return Err("TRANSCRIPTION_ENGINE_UNAVAILABLE"),
        };
        Ok(Recognizer::new(built, self.services().transcription_transport.clone()))
    }

    /// The settings of a source's recorder (`_create_recorder`, `_create_transcriber`).
    /// `transcribing` is false for a recorder that only feeds the volume meter.
    fn recorder_settings(self: &Arc<Self>, source: Source, transcribing: bool) -> Settings {
        let config = self.config();
        let number = |key: &str| super::python_float(&config.get(&format!("{}_{key}", upper(source)))).unwrap_or(0.0);
        let phrase_timeout = number("PHRASE_TIMEOUT");
        Settings {
            threshold: number("THRESHOLD"),
            automatic_threshold: config.get_bool(&format!("{}_AUTOMATIC_THRESHOLD", upper(source))),
            record_timeout: number("RECORD_TIMEOUT").min(phrase_timeout),
            phrase_timeout,
            max_phrases: number("MAX_PHRASES").max(0.0) as usize,
            // The switch takes effect at the next start, as in Python. When the speech.cpp server
            // cannot detect speech the energy listener cuts phrases and the user is told. The
            // volume meter alone needs no detection.
            vad: (transcribing && config.get_bool(&format!("{}_ENABLE_VAD", upper(source)))).then(|| self.recorder_vad(source)).flatten(),
            diagnostics: transcribing.then(|| self.transcription.diagnostics.clone()),
        }
    }

    /// The devices to try: the chosen one, the default, then the others (`_start`).
    fn candidate_devices(&self, source: Source, chosen: &Device) -> Vec<Device> {
        let snapshot = self.audio_devices().snapshot();
        let (default, available): (Option<Device>, Vec<Device>) = match source {
            Source::Mic => (
                Some(snapshot.default_mic_device.device.clone()),
                snapshot.mic_devices.iter().flat_map(|(_, devices)| devices.iter().cloned()).collect(),
            ),
            Source::Speaker => (Some(snapshot.default_speaker_device.clone()), snapshot.speaker_devices.clone()),
        };
        let mut candidates = vec![chosen.clone()];
        for candidate in default.into_iter().chain(available) {
            if candidate.is_no_device() || candidate.node_name.is_some() {
                continue;
            }
            let key = capture_key(Some(&candidate));
            if !candidates.iter().any(|c| capture_key(Some(c)) == key) {
                candidates.push(candidate);
            }
        }
        candidates
    }

    /// `_AudioDeviceSession.reconfigure`: `None` keeps a feature as it is. `device` is the
    /// device to open (`Some(None)` for none); without it the saved choice is opened. The
    /// caller holds the source's lock and publishes what started.
    fn reconfigure(
        self: &Arc<Self>,
        source: Source,
        transcript: Option<bool>,
        energy: Option<bool>,
        device: Option<Option<Device>>,
        previous: Option<Device>,
    ) -> Result<Reconfigured, StartError> {
        let area = &self.transcription;
        let mut legacy = area.legacy(source);
        let new_transcript = transcript.unwrap_or(legacy.transcript);
        let new_energy = energy.unwrap_or(legacy.energy);
        let resolved = match device {
            Some(device) => device.filter(|d| !d.is_no_device()),
            None => self.audio_devices().selected(source).filter(|d| !d.is_no_device() && d.node_name.is_none()),
        };
        let wanted = new_transcript || new_energy;
        let running = legacy.recorder.as_ref().is_some_and(Recorder::running);
        if (new_transcript, new_energy) == (legacy.transcript, legacy.energy)
            && capture_key(resolved.as_ref()) == capture_key(legacy.active.as_ref())
            && (!wanted || running)
        {
            return Ok(Reconfigured::Unchanged);
        }
        let shown_previous = legacy.active.clone().or(previous);
        if wanted && resolved.is_none() {
            drop(legacy);
            self.disable_after_pipeline_error(source);
            legacy = area.legacy(source);
        }
        area.revisions[index(source)].fetch_add(1, Ordering::SeqCst);
        area.stop_recorder(source, &mut legacy);
        legacy.active = None;
        legacy.transcript = new_transcript;
        legacy.energy = new_energy;
        if !wanted {
            legacy.transcript = false;
            legacy.energy = false;
            return Ok(Reconfigured::Off);
        }
        let Some(requested) = resolved else {
            // `_start(device=None)`: no device to listen to. Decision 15 (2): as in Python, the
            // microphone's recognition alone tells nothing here (its message came after its
            // delivery was revoked); the speaker and the volume meters say which device is missing.
            legacy.transcript = false;
            legacy.energy = false;
            drop(legacy);
            if source == Source::Speaker || new_energy {
                self.notify_device_error(source);
            }
            return Err(StartError::Device);
        };
        let recognize = if new_transcript {
            match self.recognizer() {
                Ok(recognizer) => {
                    let core = Arc::downgrade(self);
                    // `asr_attempts` and `asr_successes` of this recorder, for `[ASR-stats]`.
                    let (mut attempts, mut successes) = (0u64, 0u64);
                    let recognize: vrct_transcription::recorder::Recognize = Box::new(move |mono: &[i16], rate: u32| {
                        let Some(core) = core.upgrade() else { return Ok(None) };
                        let engine = recognizer.engine.name().to_string();
                        let candidates = core.candidates(source, &engine);
                        let (logprob, silence) = (
                            super::python_float(&core.config().get(&format!("{}_AVG_LOGPROB", upper(source)))).unwrap_or(-0.8),
                            super::python_float(&core.config().get(&format!("{}_NO_SPEECH_PROB", upper(source)))).unwrap_or(0.6),
                        );
                        let asked = std::time::Instant::now();
                        let result = recognizer.recognize(mono, rate, &candidates, logprob, silence, table());
                        let asr_ms = asked.elapsed().as_millis();
                        let diagnostics = &core.transcription.diagnostics;
                        let name = source.as_str();
                        match &result {
                            Err(failed) => {
                                diagnostics.record(name, Diagnosed::AsrError, &[(Stage::Asr, asr_ms as f64)], None, false);
                                core.step(&format!("[ASR-error][{name}][{engine}] {}", failed.error.code()));
                            }
                            Ok(heard) => {
                                attempts += 1;
                                successes += u64::from(heard.is_some());
                                let outcome = if heard.is_some() { "success" } else { "failure" };
                                diagnostics.record(
                                    name,
                                    if heard.is_some() { Diagnosed::AsrSuccess } else { Diagnosed::AsrFailure },
                                    &[(Stage::Asr, asr_ms as f64)],
                                    Some(format!(
                                        "[ASR-stats][{name}][{engine}] this_call={outcome} attempts={attempts} successes={successes} rate={:.1}% asr={asr_ms}ms",
                                        successes as f64 * 100.0 / attempts as f64
                                    )),
                                    // A call that heard nothing is told at once, as in Python.
                                    heard.is_none(),
                                );
                            }
                        }
                        result
                    });
                    Some(recognize)
                }
                Err(code) => {
                    legacy.transcript = false;
                    legacy.energy = false;
                    drop(legacy);
                    self.disable_after_pipeline_error(source);
                    return Err(StartError::Engine(code));
                }
            }
        } else {
            None
        };
        let revision = area.revisions[index(source)].load(Ordering::SeqCst);
        let weak = Arc::downgrade(self);
        let on_event = Arc::new(move |event: Event| {
            if let Some(core) = weak.upgrade() {
                core.on_recorder_event(source, revision, event);
            }
        });
        let paused = if source == Source::Mic { Some(Arc::clone(&area.mic_paused)) } else { None };
        let started = Recorder::start(
            (self.services().transcription_capture)(self.config().environment()).as_ref(),
            source,
            &self.candidate_devices(source, &requested),
            self.recorder_settings(source, new_transcript),
            recognize,
            new_energy,
            paused,
            on_event,
        );
        match started {
            Ok(recorder) => {
                let device = recorder.device.clone();
                legacy.active = Some(device.clone());
                legacy.recorder = Some(recorder);
                Ok(Reconfigured::Running { device, previous: shown_previous.or(Some(requested)) })
            }
            Err(failure) => {
                legacy.transcript = false;
                legacy.energy = false;
                drop(legacy);
                self.step(&format!("{}: the recorder could not open a device", source.as_str()));
                self.disable_after_pipeline_error(source);
                self.notify("transcription_recognition_error", Self::failure_payload(source, failure));
                Err(StartError::Device)
            }
        }
    }

    /// What a recorder's thread reports (`micMessage`, `speakerMessage`, `progressBar*Energy`,
    /// `_audioPipelineFailed`).
    fn on_recorder_event(self: &Arc<Self>, source: Source, revision: u64, event: Event) {
        // A transcript's guard is made before the recorder is checked (#278, item 65). Made after,
        // it could read the epoch of a later run when the switch went off and on between the two,
        // and the old recorder's text would pass as the new run's. Made before, a stop between them
        // either fails the check below (the recorder's revision moved) or revokes the guard.
        let guard = matches!(event, Event::Transcript(_)).then(|| self.transcription.publication_guard(source));
        if self.transcription.revisions[index(source)].load(Ordering::SeqCst) != revision || self.shutdown_requested() {
            return;
        }
        match event {
            Event::Energy(value) => {
                let name = if source == Source::Mic { "check_mic_volume" } else { "check_speaker_volume" };
                self.notify(name, json!(value));
            }
            Event::Transcript(transcript) => {
                let guard = guard.expect("made above for a transcript");
                let recognized = Recognized {
                    text: transcript.text,
                    language: transcript.language,
                    id: None,
                    asr_ms: Some(transcript.asr_ms),
                };
                let source = match source {
                    Source::Mic => super::messages::Source::Mic,
                    Source::Speaker => super::messages::Source::Speaker,
                };
                self.deliver_transcription(source, recognized, Some(guard));
            }
            Event::Failed(failure) => {
                let core = Arc::clone(self);
                std::thread::spawn(move || core.recorder_failed(source, revision, failure));
            }
        }
    }

    /// `_audioPipelineFailedLocked(cleanup=True)` and `_recoverAudioDeviceLoss`.
    fn recorder_failed(self: &Arc<Self>, source: Source, revision: u64, failure: Failure) {
        let current = |core: &Arc<Core>| core.transcription.revisions[index(source)].load(Ordering::SeqCst) == revision;
        let failed_device = {
            let _guard = self.audio_devices().lock_source(source);
            if !current(self) {
                return;
            }
            self.transcription.legacy(source).active.clone()
        };
        if failure == Failure::READ
            && let Some(failed) = failed_device
        {
            // A read error can come before the device list changes: look again first.
            self.audio_devices().refresh();
            let guard = self.audio_devices().lock_source(source);
            if !current(self) {
                return;
            }
            let snapshot = self.audio_devices().snapshot();
            let listed: Vec<&Device> = match source {
                Source::Mic => snapshot.mic_devices.iter().flat_map(|(_, d)| d.iter()).collect(),
                Source::Speaker => snapshot.speaker_devices.iter().collect(),
            };
            if !listed.iter().any(|d| capture_key(Some(d)) == capture_key(Some(&failed))) {
                self.reconcile_locked(&guard, source, Some(failed));
                return;
            }
            self.disable_after_device_loss(source);
            self.notify("transcription_recognition_error", Self::failure_payload(source, failure));
            return;
        }
        let _guard = self.audio_devices().lock_source(source);
        if !current(self) {
            return;
        }
        self.disable_after_device_loss(source);
        self.notify("transcription_recognition_error", Self::failure_payload(source, failure));
    }

    /// `_reconcileAudioLocked`: the capture moves to the source's target, or stops.
    fn reconcile_locked(self: &Arc<Self>, guard: &SourceGuard<'_>, source: Source, previous: Option<Device>) {
        let (transcript_key, energy_key) = flags(source);
        let (transcript, energy) = (self.config().get_bool(transcript_key), self.config().get_bool(energy_key));
        let target = self.audio_devices().target(source, true).filter(|d| !d.is_no_device());
        if !transcript && !energy {
            guard.publish(target.as_ref(), None);
            return;
        }
        let Some(target) = target else {
            self.disable_after_device_loss(source);
            guard.publish(None, None);
            return;
        };
        match self.reconfigure(source, Some(transcript), Some(energy), Some(Some(target)), previous) {
            Ok(Reconfigured::Running { device, previous }) => guard.publish(Some(&device), previous.as_ref()),
            Ok(Reconfigured::Unchanged) => {}
            Ok(Reconfigured::Off) | Err(_) => {
                self.terminal_failure(source);
                guard.publish(None, None);
            }
        }
    }

    /// Starts a feature of the recorder under the source's lock (`_start*Locked`): false when
    /// it did not start.
    fn start_feature_locked(self: &Arc<Self>, guard: &SourceGuard<'_>, source: Source, transcript: bool) -> bool {
        self.stop_realtime_for_recorder(source);
        if !self.drain_realtime(source) {
            return false;
        }
        let (enable_transcript, enable_energy) = if transcript { (Some(true), None) } else { (None, Some(true)) };
        match self.reconfigure(source, enable_transcript, enable_energy, None, None) {
            Ok(Reconfigured::Running { device, previous }) => {
                guard.publish(Some(&device), previous.as_ref());
                true
            }
            Ok(Reconfigured::Unchanged) => {
                let legacy = self.transcription.legacy(source);
                legacy.recorder.is_some() && if transcript { legacy.transcript } else { legacy.energy }
            }
            Ok(Reconfigured::Off) => false,
            Err(StartError::Engine(code)) if transcript => {
                let endpoint = format!("/set/enable/transcription_{}", direction(source));
                self.notify_error(&endpoint, ErrorReply::new(code, json!(false)));
                false
            }
            Err(_) => false,
        }
    }

    /// `setEnableTranscriptionSend` / `setEnableTranscriptionReceive`.
    pub(crate) fn set_enable_transcription(self: &Arc<Self>, source: Source, data: &Value) -> Reply {
        if self.realtime_toggles() {
            return self.enable_realtime_toggle(source, data);
        }
        let key = flags(source).0;
        let guard = self.audio_devices().lock_source(source);
        if self.config().get("SELECTED_TRANSCRIPTION_ENGINE").is_null() {
            return Reply::error(ErrorReply::new("TRANSCRIPTION_ENGINE_NOT_SELECTED", json!(false)));
        }
        if !self.config().get_bool(key) {
            guard.advance();
            let _ = self.config().set(key, json!(true));
            let started = self.start_feature_locked(&guard, source, true);
            if !started {
                self.transcription.revoke(source);
            }
            let _ = self.config().set(key, json!(started));
        }
        ok(self.config().get(key))
    }

    /// `setDisableTranscriptionSend` / `setDisableTranscriptionReceive`.
    pub(crate) fn set_disable_transcription(self: &Arc<Self>, source: Source, data: &Value) -> Reply {
        let settings_pause = data.get("reason").and_then(Value::as_str) == Some("settings_pause");
        if !settings_pause {
            self.transcription.revoke(source);
        }
        let key = flags(source).0;
        if self.realtime_toggles() {
            self.note_realtime_pause(source, data);
            if !self.config().get_bool(key) {
                return self.disable_realtime_toggle(source);
            }
        }
        let guard = self.audio_devices().lock_source(source);
        guard.advance();
        let _ = self.config().set(key, json!(false));
        let _ = self.reconfigure(source, Some(false), None, None, None);
        ok(json!(false))
    }

    /// `setEnableCheck*Threshold`.
    fn set_enable_check(self: &Arc<Self>, source: Source) -> Reply {
        let key = flags(source).1;
        let guard = self.audio_devices().lock_source(source);
        if !self.config().get_bool(key) {
            guard.advance();
            let _ = self.config().set(key, json!(true));
            let started = !self.realtime_requested(source) && self.start_feature_locked(&guard, source, false);
            let _ = self.config().set(key, json!(started));
        }
        ok(self.config().get(key))
    }

    /// `setDisableCheck*Threshold`.
    fn set_disable_check(self: &Arc<Self>, source: Source) -> Reply {
        let key = flags(source).1;
        let guard = self.audio_devices().lock_source(source);
        guard.advance();
        let _ = self.config().set(key, json!(false));
        let _ = self.reconfigure(source, None, Some(false), None, None);
        ok(json!(false))
    }

    /// `_leaveTranscriptionRoute` and an engine change on the recorder: what listens through
    /// the engine that was selected stops, and the switches show off. Turning one on again
    /// starts the newly selected engine. `realtime` is the route of the previous engine.
    pub(crate) fn leave_transcription_route(&self, realtime: bool) {
        let Some(core) = self.transcription.core() else { return };
        if realtime {
            for source in [Source::Mic, Source::Speaker] {
                core.transcription.revoke(source);
                core.stop_realtime_for_recorder(source);
            }
            return;
        }
        for source in [Source::Mic, Source::Speaker] {
            if core.config().get_bool(flags(source).0) {
                // The recorder stops as one, whatever the engine now is.
                core.set_disable_transcription(source, &Value::Null);
                core.run(200, &format!("/set/disable/transcription_{}", direction(source)), json!(false));
            }
        }
    }

    /// Stops both recorders and realtime recognition at the end of the run.
    pub(crate) fn stop_transcription(&self) {
        if !self.close_realtime() {
            self.step("[asr] realtime shutdown unconfirmed");
        }
        for source in [Source::Mic, Source::Speaker] {
            self.transcription.revoke(source);
            if !self.transcription.stop_legacy(source) {
                self.step("shutdown: a recorder did not stop in time");
            }
        }
        self.transcription.diagnostics.flush(None, "shutdown");
    }

    // ------------------------------------------------------------------------- keys

    /// `_setTranscriptionCredential`: checks a key with its service, then saves it with the
    /// models it lists.
    fn set_transcription_key(self: &Arc<Self>, engine: &'static str, data: &Value, base_url: String) -> Reply {
        self.step(&format!("Set {engine} Auth Key"));
        let refused = |core: &Core| {
            Reply::error(ErrorReply::new(
                "TRANSCRIPTION_API_AUTH_FAILED",
                core.config().get("TRANSCRIPTION_AUTH_KEYS")[engine].clone(),
            ))
        };
        let key = super::settings::python_str(data).trim().to_string();
        if key.is_empty() {
            return refused(self);
        }
        let transport = &self.services().transcription_transport;
        let (models, languages) = if engine == "Deepgram" {
            if !providers::deepgram_key_valid(transport, &base_url, &key) {
                return refused(self);
            }
            let detailed = providers::deepgram_models(transport, &base_url, &key);
            let languages: Map<String, Value> = detailed.iter().map(|(name, codes)| (name.clone(), json!(codes))).collect();
            (detailed.into_iter().map(|(name, _)| name).collect::<Vec<_>>(), Some(languages))
        } else {
            match providers::compatible_models(transport, &base_url, &key, engine != "Custom_Whisper") {
                Ok(models) => (models, None),
                Err(_) => return refused(self),
            }
        };
        if models.is_empty() || models.iter().any(|m| m.trim().is_empty()) {
            return refused(self);
        }
        let prefix = engine.to_uppercase();
        let selected_key = format!("SELECTED_{prefix}_MODEL");
        let saved = self.config().get(&selected_key);
        let selected = saved.as_str().filter(|s| models.iter().any(|m| m == s)).unwrap_or(&models[0]).to_string();
        {
            let _guard = self.credential_lock.lock().unwrap();
            if engine == "Custom_Whisper" && self.config().get_str("TRANSCRIPTION_CUSTOM_URL") != base_url {
                return refused(self);
            }
            self.commit_transcription_key(engine, &key, &models, &selected, languages);
        }
        ok(json!(key))
    }

    /// Saves a checked key, its models and the choice, and tells the UI (under the credential lock).
    fn commit_transcription_key(&self, engine: &str, key: &str, models: &[String], selected: &str, languages: Option<Map<String, Value>>) {
        let config = self.config();
        let prefix = engine.to_uppercase();
        if config.update_credential("TRANSCRIPTION_AUTH_KEYS", engine, Some(key)).is_err() {
            return;
        }
        config.put(&format!("SELECTABLE_{prefix}_MODEL_LIST"), json!(models));
        let _ = config.set(&format!("SELECTED_{prefix}_MODEL"), json!(selected));
        if let Some(languages) = languages {
            config.put("DEEPGRAM_MODEL_LANGUAGES", Value::Object(languages));
        }
        let mut status = config.get("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS");
        status[engine] = json!(true);
        config.put("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS", status);
        let lower = engine.to_lowercase();
        self.notify(&format!("selectable_{lower}_model_list"), json!(models));
        self.notify(&format!("selected_{lower}_model"), json!(selected));
        self.update_transcription_engine(None);
    }

    /// `_setEndpointCredential("Custom_Whisper")`: a URL and a key, checked together first.
    fn set_custom_whisper_key_and_url(self: &Arc<Self>, data: &Value) -> Reply {
        let config = self.config();
        let refused = |core: &Core| {
            Reply::error(ErrorReply::new(
                "TRANSCRIPTION_API_AUTH_FAILED",
                core.config().get("TRANSCRIPTION_AUTH_KEYS")["Custom_Whisper"].clone(),
            ))
        };
        let Some(object) = data.as_object().filter(|o| o.len() == 2 && o.contains_key("url") && o.contains_key("auth_key")) else {
            return refused(self);
        };
        let url = match &object["url"] {
            Value::String(text) => text.trim().to_string(),
            _ => String::new(),
        };
        if crate::net_policy::validate_api_url(&url, false).is_err() {
            return Reply::error(ErrorReply::new("CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID", config.get("TRANSCRIPTION_CUSTOM_URL")));
        }
        let key = match &object["auth_key"] {
            Value::Null => None,
            Value::String(text) => Some(text.trim().to_string()).filter(|k| !k.is_empty()),
            _ => return refused(self),
        };
        let previous = {
            let _guard = self.credential_lock.lock().unwrap();
            (
                config.get("TRANSCRIPTION_CUSTOM_URL"),
                config.get("TRANSCRIPTION_AUTH_KEYS")["Custom_Whisper"].clone(),
                config.get("SELECTED_CUSTOM_WHISPER_MODEL"),
            )
        };
        let checked = match &key {
            Some(key) => {
                let Ok(models) = providers::compatible_models(&self.services().transcription_transport, &url, key, false) else {
                    return refused(self);
                };
                if models.is_empty() || models.iter().any(|m| m.trim().is_empty()) {
                    return refused(self);
                }
                let selected = previous.2.as_str().filter(|s| models.iter().any(|m| m == s)).unwrap_or(&models[0]).to_string();
                Some((models, selected))
            }
            None => None,
        };
        let _guard = self.credential_lock.lock().unwrap();
        let now = (
            config.get("TRANSCRIPTION_CUSTOM_URL"),
            config.get("TRANSCRIPTION_AUTH_KEYS")["Custom_Whisper"].clone(),
            config.get("SELECTED_CUSTOM_WHISPER_MODEL"),
        );
        if now != previous {
            return refused(self);
        }
        if config.set("TRANSCRIPTION_CUSTOM_URL", json!(url)).is_err() {
            return Reply::error(ErrorReply::new("CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID", config.get("TRANSCRIPTION_CUSTOM_URL")));
        }
        match (&key, checked) {
            (Some(key), Some((models, selected))) => self.commit_transcription_key("Custom_Whisper", key, &models, &selected, None),
            _ => {
                // `delCustomWhisperAuthKey` (the lock is already held).
                let _ = config.update_credential("TRANSCRIPTION_AUTH_KEYS", "Custom_Whisper", None);
                config.put("SELECTABLE_CUSTOM_WHISPER_MODEL_LIST", json!([]));
                config.put("SELECTED_CUSTOM_WHISPER_MODEL", Value::Null);
                self.notify("selectable_custom_whisper_model_list", json!([]));
                self.notify("selected_custom_whisper_model", Value::Null);
                let mut status = config.get("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS");
                status["Custom_Whisper"] = json!(false);
                config.put("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS", status);
                self.update_transcription_engine(None);
            }
        }
        ok(json!({ "url": url, "auth_key": key }))
    }

    // ------------------------------------------------------------------------- start-up

    /// The start-up check of the recognition engines (`check_transcription_engine` in
    /// `init`), at the same time. Keys stay, as in Python. Only the selected engine, and a
    /// custom server at a loopback address, are contacted (#457): another engine with a saved
    /// key stays selectable and is checked when it is selected
    /// ([`Core::ensure_transcription_engine`]). Its model list stays empty until then.
    pub(crate) fn check_transcription_engines(&self) -> Map<String, Value> {
        let config = self.config();
        let engines: Vec<String> = config
            .get("SELECTABLE_TRANSCRIPTION_ENGINE_LIST")
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| e.as_str().map(str::to_string))
            .collect();
        let selected = config.get_str("SELECTED_TRANSCRIPTION_ENGINE");
        let custom_url = config.get_str("TRANSCRIPTION_CUSTOM_URL");
        let results: Vec<(String, TranscriptionCheck)> = std::thread::scope(|scope| {
            let handles: Vec<_> = engines
                .iter()
                .map(|engine| {
                    let check_now = *engine == selected
                        || (engine == "Custom_Whisper" && crate::net_policy::is_loopback_url(&custom_url));
                    scope.spawn(move || {
                        let checked = if check_now { self.check_transcription_engine(engine) } else { self.deferred_transcription_engine(engine) };
                        (engine.clone(), checked)
                    })
                })
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        let mut status = Map::new();
        for engine in &engines {
            let checked = results.iter().find(|(e, _)| e == engine).map(|(_, c)| c.clone()).unwrap_or_default();
            status.insert(engine.clone(), json!(checked.available));
            self.apply_transcription_check(engine, checked);
        }
        status
    }

    /// Asks one engine's service for its models with the saved key.
    fn check_transcription_engine(&self, engine: &str) -> TranscriptionCheck {
        let config = self.config();
        let key = config.get("TRANSCRIPTION_AUTH_KEYS")[engine].as_str().unwrap_or("").to_string();
        let transport = &self.services().transcription_transport;
        let endpoints = &self.services().transcription_endpoints;
        let none = TranscriptionCheck::default();
        match engine {
            "Groq_Whisper" | "OpenAI_Whisper" | "Custom_Whisper" => {
                let base = match engine {
                    "Groq_Whisper" => endpoints.groq.clone(),
                    "OpenAI_Whisper" => endpoints.openai.clone(),
                    _ => config.get_str("TRANSCRIPTION_CUSTOM_URL"),
                };
                if key.is_empty() || base.is_empty() {
                    return none;
                }
                match providers::compatible_models(transport, &base, &key, engine != "Custom_Whisper") {
                    Ok(models) if !models.is_empty() => TranscriptionCheck { available: true, models: Some(models), ..none },
                    _ => none,
                }
            }
            "Deepgram" => {
                if key.is_empty() || !providers::deepgram_key_valid(transport, &endpoints.deepgram, &key) {
                    return none;
                }
                let detailed = providers::deepgram_models(transport, &endpoints.deepgram, &key);
                let languages = detailed.iter().map(|(name, codes)| (name.clone(), json!(codes))).collect();
                let models: Vec<String> = detailed.into_iter().map(|(name, _)| name).collect();
                if models.is_empty() {
                    none
                } else {
                    TranscriptionCheck { available: true, models: Some(models), languages: Some(languages), deferred: false }
                }
            }
            // speech.cpp: established by its server, not a probe.
            crate::languages::LOCAL_SPEECH_ENGINE => TranscriptionCheck { available: true, ..none },
            _ => none,
        }
    }

    /// An engine left unchecked at start-up: selectable when its key (and the custom server's
    /// address) is saved.
    fn deferred_transcription_engine(&self, engine: &str) -> TranscriptionCheck {
        let config = self.config();
        let key = config.get("TRANSCRIPTION_AUTH_KEYS")[engine].as_str().is_some_and(|k| !k.is_empty());
        let available = match engine {
            "Groq_Whisper" | "OpenAI_Whisper" | "Deepgram" => key,
            "Custom_Whisper" => key && !config.get_str("TRANSCRIPTION_CUSTOM_URL").is_empty(),
            crate::languages::LOCAL_SPEECH_ENGINE => true,
            _ => false,
        };
        TranscriptionCheck { available, deferred: true, ..TranscriptionCheck::default() }
    }

    /// Keeps the models and the choice an engine's check found.
    fn apply_transcription_check(&self, engine: &str, checked: TranscriptionCheck) {
        if checked.deferred || !checked.available {
            return;
        }
        if !COMPATIBLE_ENGINES.contains(&engine) && engine != "Deepgram" {
            return;
        }
        let config = self.config();
        if let Some(models) = checked.models {
            let prefix = engine.to_uppercase();
            let selected_key = format!("SELECTED_{prefix}_MODEL");
            let saved = config.get(&selected_key);
            let selected = saved.as_str().filter(|s| models.iter().any(|m| m == s)).unwrap_or(&models[0]).to_string();
            config.put(&format!("SELECTABLE_{prefix}_MODEL_LIST"), json!(models));
            let _ = config.set(&selected_key, json!(selected));
            if let Some(languages) = checked.languages {
                config.put("DEEPGRAM_MODEL_LANGUAGES", Value::Object(languages));
            }
            self.step(&format!("{engine} transcription engine is valid/available"));
        }
    }

    /// Checks an engine the start-up left unchecked, before it is selected (#457). An engine
    /// that has listed its models this run, or has no saved key, is not asked. `false` when it cannot be used:
    /// it is then no longer selectable, and its model list and choice are forgotten as at
    /// start-up.
    pub(crate) fn ensure_transcription_engine(&self, engine: &str) -> bool {
        if !COMPATIBLE_ENGINES.contains(&engine) && engine != "Deepgram" {
            return true;
        }
        let config = self.config();
        let list = format!("SELECTABLE_{}_MODEL_LIST", engine.to_uppercase());
        if config.get(&list).as_array().is_some_and(|models| !models.is_empty()) {
            return true;
        }
        // Without a saved key there is nothing to check: the selection is taken as before, and a
        // switch then says the engine cannot be used.
        if !self.deferred_transcription_engine(engine).available {
            return true;
        }
        let checked = self.check_transcription_engine(engine);
        let available = checked.available;
        self.apply_transcription_check(engine, checked);
        let mut status = config.get("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS");
        status[engine] = json!(available);
        config.put("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS", status);
        if !available {
            self.forget_failed_engine(engine);
        }
        let lower = engine.to_lowercase();
        self.notify(&format!("selectable_{lower}_model_list"), config.get(&list));
        self.notify(&format!("selected_{lower}_model"), config.get(&format!("SELECTED_{}_MODEL", engine.to_uppercase())));
        available
    }
}

/// What a recognition engine's check found.
#[derive(Clone, Default)]
struct TranscriptionCheck {
    available: bool,
    models: Option<Vec<String>>,
    languages: Option<Map<String, Value>>,
    /// Not checked at start-up (#457); `available` then only says that its key is saved.
    deferred: bool,
}

/// The endpoints that only answer from the settings (`getGroqWhisperAuthKey` and the like are
/// in `credentials`).
pub(crate) fn add(b: &mut Builder<'_>) {
    let _ = b.core.transcription.core.set(Arc::downgrade(b.core));
    b.core.audio_devices().set_capture_owner(Arc::clone(&b.core.transcription) as Arc<dyn CaptureOwner>);
    vrct_transcription::set_failure_reporter(Box::new(crate::errors::report_failure));

    for source in [Source::Mic, Source::Speaker] {
        let dir = direction(source);
        b.with(&format!("/set/enable/transcription_{dir}"), super::routes::WAIT, move |core, data| {
            core.set_enable_transcription(source, data)
        });
        b.with(&format!("/set/disable/transcription_{dir}"), super::routes::WAIT, move |core, data| {
            core.set_disable_transcription(source, data)
        });
        let s = source.as_str();
        b.with(&format!("/set/enable/check_{s}_threshold"), OPEN, move |core, _| core.set_enable_check(source));
        b.with(&format!("/set/disable/check_{s}_threshold"), OPEN, move |core, _| core.set_disable_check(source));
    }
    b.with("/set/data/groq_whisper_auth_key", OPEN, |core, data| {
        let base = core.services().transcription_endpoints.groq.clone();
        core.set_transcription_key("Groq_Whisper", data, base)
    });
    b.with("/set/data/openai_whisper_auth_key", OPEN, |core, data| {
        let base = core.services().transcription_endpoints.openai.clone();
        core.set_transcription_key("OpenAI_Whisper", data, base)
    });
    b.with("/set/data/custom_whisper_auth_key", OPEN, |core, data| {
        let base = core.config().get_str("TRANSCRIPTION_CUSTOM_URL");
        core.set_transcription_key("Custom_Whisper", data, base)
    });
    b.with("/set/data/custom_whisper_auth_key_and_url", OPEN, |core, data| core.set_custom_whisper_key_and_url(data));
    b.with("/set/data/deepgram_auth_key", OPEN, |core, data| {
        let base = core.services().transcription_endpoints.deepgram.clone();
        core.set_transcription_key("Deepgram", data, base)
    });
    super::realtime_asr::add(b);
}
