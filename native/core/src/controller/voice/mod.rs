//! TTS, direct voice, voice conversion and the voice route ([`controller.py`]: `getVoice*`,
//! `setVoiceSettings`, `enableTts`, `disableTts`, `stopVoice`, `muteVoice`, `resumeVoice`,
//! `get/set/start/stopDirectVoice*`, `getVcRuntime*`, `getIoFlow`, `_publishChatVoice`,
//! `_publishMicVoice` and `_speechServerEnded` for the TTS profiles).
//!
//! The speech bus is `vrct-tts`; direct voice, the RVC worker's owner and its runtime setup
//! are `vrct-voice-conversion`; the route's mute and the devices are `vrct-audio-routing`.
//! What reaches the PC's devices is behind [`VoicePlatform`].
//!
//! Nothing here writes text, audio, device names or paths to the log.
//!
//! [`controller.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/controller.py

mod audition;
mod flow;
pub mod platform;

pub use platform::{NativeVoice, NoGate, VoicePlatform};

use super::messages::{SpeechStage, SpokenMessage};
use super::routes::{Builder, OPEN};
use super::{Core, ok};
use crate::config::Platform;
use crate::protocol::Reply;
use flow::{FlowState, IoTrace, IoTraces};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use vrct_audio_routing::graph::{Source, SourceId, parse_source};
use vrct_audio_routing::monitor::{MonitorOptions, MonitorSpec, MonitorTee};
use vrct_audio_routing::mute_state::MuteState;
use vrct_audio_routing::router::{Output, PlaybackToken};
use vrct_audio_routing::voice_route::{MuteBus, RouteOptions, VoiceRoute};
use vrct_speech_server::Profile;
use vrct_tts::converted::{Chunks, ConversionSpeaker, ConvertedSpeechRouter, SpeakError};
use vrct_tts::engines::EngineClient;
use vrct_tts::listener::{ListenerMonitor, ListenerMonitors, ProcessExit};
use vrct_tts::message_hook::{TranscriptUpdate, TranslationTarget, chat_event, microphone_event};
use vrct_tts::playback::{AudioRouter, FirstAudio, Monitor, OutputSink};
use vrct_tts::scheduler::{BusOptions, MonitorRequest};
use vrct_tts::settings::{self as tts_settings, VoiceSettings};
use vrct_tts::{CancelToken, SpeechCppTts, SpeechError, TtsError, VoiceEventBus};
use vrct_voice_conversion::direct::{ConvertedFactory, PassthroughFactory};
use vrct_voice_conversion::runtime::{RuntimeSetup, SetupOptions};
use vrct_voice_conversion::{DeviceRoute, DirectVoice, ManagedRoute, SpeakFailure, VcProcess, VcRoute};

const SETTINGS_KEY: &str = "VOICE_SETTINGS";
const DIRECT_KEY: &str = "DIRECT_VOICE_SETTINGS";
/// A started server enforces its own start timeout; this only bounds the toggle's wait.
const TTS_SERVER_WAIT: Duration = Duration::from_secs(vrct_speech_server::server::START_TIMEOUT.as_secs() + 5);
/// Server failures with their own next step; the rest share a generic code.
const TTS_START_FAILURES: [&str; 5] = [
    "speech_server_out_of_memory",
    "speech_server_start_timeout",
    "speech_server_low_latency_requires_gpu_irodori",
    "speech_server_vulkan_missing",
    "speech_server_device_failed",
];
const ENGINE_URL_FIELDS: [&str; 4] = ["voicevox", "coeiroink", "aivis", "sharevox"];
const ENGINE_VOICE_LIMIT: usize = 500;
const ROLES: [&str; 2] = ["japanese", "multilingual"];

fn profile(role: &str) -> Profile {
    if role == "japanese" { Profile::Japanese } else { Profile::Multilingual }
}

fn refused(status: u16, code: &str) -> Reply {
    Reply::status(status, json!({ "error_code": code }))
}

/// A voice audition's speech (#415): the sentence of `role`, read by that profile's running
/// bundled server with its saved voice. `None` while that server does not run; none is started.
fn audition_speech(core: &Core, settings: &VoiceSettings, role: &'static str) -> Option<audition::Speech> {
    let client = core.speech_servers().hub().binding(profile(role)).ok().and_then(|url| SpeechCppTts::new(&url).ok())?;
    let (voice, options) = audition::speech_options(settings, role);
    let (language, text) = audition::sentence_of(role);
    Some(audition::Speech { client, voice, options, language, text })
}

/// A request id the UI echoes: `[A-Za-z0-9_-]{1,64}`.
fn request_id(value: &Value) -> Option<&str> {
    value.as_str().filter(|id| (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
}

/// The TTS servers the main toggle started, as role → run; a server the user started from
/// Settings is never adopted or stopped by the toggle.
#[derive(Default)]
struct TtsOwner {
    owned: HashMap<&'static str, u64>,
    released: HashMap<&'static str, u64>,
    ended: HashMap<&'static str, u64>,
    attempts: Vec<Arc<AtomicBool>>,
    waiting: usize,
}

/// The speech bus as the route's software mute. A mute also ends a voice audition.
struct BusMute(Arc<VoiceEventBus>, Arc<audition::Audition>);

impl MuteBus for BusMute {
    fn set_muted(&self, muted: bool) {
        self.0.set_muted(muted);
        if muted {
            self.1.stop();
        }
    }
}

/// What speech and direct voice keep between requests.
pub struct Voice {
    core: Weak<Core>,
    platform: Arc<dyn VoicePlatform>,
    windows: bool,
    linux: bool,
    bus: Arc<VoiceEventBus>,
    /// `_voice_settings_lock`: voice settings, direct voice settings and their effects.
    settings_lock: Mutex<()>,
    owner: Mutex<TtsOwner>,
    direct: Arc<DirectVoice>,
    route: VoiceRoute,
    direct_closed: AtomicBool,
    direct_engine: Mutex<Option<String>>,
    traces: IoTraces,
    runtimes: RuntimeSetup,
    monitor_logged: Mutex<Option<String>>,
    realtime_mic: Mutex<Option<Arc<dyn Fn() -> bool + Send + Sync>>>,
    /// A Seed-VC conversion saved by an earlier version was moved to RVC at this start; the
    /// direct voice state says so until the settings are saved again (#391).
    seed_vc_moved: AtomicBool,
    /// The voice audition of the TTS catalog, on the monitor output only (#415).
    audition: Arc<audition::Audition>,
}

// ---------------------------------------------------------------- devices

/// The speech bus's token as an output's.
struct Token<'a>(&'a CancelToken);

fn speech_error(error: SpeechError) -> vrct_audio_routing::Error {
    vrct_audio_routing::Error::speech(error.code())
}

impl PlaybackToken for Token<'_> {
    fn check(&self) -> vrct_audio_routing::Result<()> {
        self.0.check().map_err(speech_error)
    }
    fn is_set(&self) -> bool {
        self.0.is_set()
    }
    fn wait(&self, timeout: Duration) -> bool {
        self.0.wait(timeout)
    }
    fn begin_playback(&self) -> vrct_audio_routing::Result<()> {
        self.0.begin_playback().map_err(speech_error)
    }
    fn commit_audio_write(&self, pcm: &[u8], write: &mut dyn FnMut() -> std::io::Result<usize>) -> vrct_audio_routing::Result<std::io::Result<usize>> {
        let mut failure = None;
        match self.0.commit_audio_write(pcm, || write().map_err(|error| failure.insert(error).kind())) {
            Ok(count) => Ok(Ok(count)),
            Err(vrct_tts::cancel::CommitError::Write(kind)) => Ok(Err(failure.take().unwrap_or_else(|| kind.into()))),
            Err(vrct_tts::cancel::CommitError::Speech(error)) => Err(speech_error(error)),
        }
    }
}

fn tts_error(error: vrct_audio_routing::Error) -> TtsError {
    if error.kind == vrct_audio_routing::Kind::Speech { TtsError::Speech(SpeechError::from_code(&error.code)) } else { TtsError::Output }
}

/// A device output as the speech bus's sink.
struct Sink(Box<dyn Output>);

impl OutputSink for Sink {
    fn write(&mut self, pcm: &[u8], token: &CancelToken) -> Result<(), TtsError> {
        self.0.write(pcm, &Token(token)).map_err(tts_error)
    }
    fn close(&mut self, drain: bool, token: &CancelToken) -> Result<(), TtsError> {
        self.0.close(drain, &Token(token)).map_err(tts_error)
    }
}

/// The audio routing's monitor as the speech bus's.
struct TeeMonitor(MonitorTee);

impl Monitor for TeeMonitor {
    fn offer(&self, pcm: &[u8], sample_rate: u32, channels: u16) {
        self.0.offer(pcm, sample_rate, channels);
    }
    fn close(&self, drain: bool) {
        self.0.close(drain);
    }
    fn join(&self, timeout: Duration) -> bool {
        self.0.join(timeout)
    }
}

/// Direct voice as the conversion speech goes through (ADR-007).
struct Speaker(Arc<DirectVoice>);

impl ConversionSpeaker for Speaker {
    fn speaking_available(&self) -> bool {
        self.0.speaking_available()
    }

    fn speak(&self, chunks: Chunks<'_>, token: &CancelToken, on_first_audio: FirstAudio<'_>) -> Result<(), SpeakError> {
        let mut pcm = chunks.map(|chunk| chunk.map_err(|error| error.code().to_owned()));
        let check = || token.check().map_err(|error| error.code().to_owned());
        let mut first = |at: i64, rate: u32| on_first_audio(at, rate).map_err(|error| error.code().to_owned());
        match self.0.speak(&mut pcm, &check, &mut first) {
            Ok(()) => Ok(()),
            Err(SpeakFailure::Unavailable) => Err(SpeakError::Unavailable),
            Err(SpeakFailure::Caller(code)) => Err(SpeakError::Speech(SpeechError::from_code(&code))),
        }
    }
}

// ---------------------------------------------------------------- construction

impl Voice {
    fn new(core: &Arc<Core>) -> Arc<Voice> {
        let config = core.config();
        let env = config.environment();
        let platform = core.services().voice.clone();
        let windows = env.platform == Platform::Windows;
        let linux = env.platform == Platform::Linux;
        let tts_platform = if windows { tts_settings::Platform::Windows } else { tts_settings::Platform::Other };
        let mut saved = config.get(SETTINGS_KEY);
        if saved["routing"] == "managed" && !linux {
            // Carried over from Linux. No such route exists here, and its mute could never be
            // confirmed, so the setting could not be left afterwards.
            saved["routing"] = json!("external");
            saved["mode"] = json!("off");
            saved["mic_mode"] = json!("off");
            let _ = config.set(SETTINGS_KEY, saved.clone());
        }
        let settings = VoiceSettings::from_value_on(&saved, tts_platform).unwrap_or_default();
        // The settings load moved a saved Seed-VC engine to RVC (`voice_settings::load_direct`).
        // Only a conversion the user had chosen is worth a word: Seed-VC was also Python's default.
        let started_direct = config.saved_at_start(DIRECT_KEY);
        let seed_vc_moved = started_direct["engine"] == crate::voice_settings::RETIRED_ENGINE && started_direct["mode"] == "converted";
        if seed_vc_moved {
            core.step("[voice] a saved Seed-VC conversion moved to RVC");
        }

        let weak = Arc::downgrade(core);
        let app_dir = env.app_dir.clone();
        let passthrough: PassthroughFactory = {
            let (platform, app_dir) = (platform.clone(), app_dir.clone());
            Arc::new(move |output| platform.passthrough(&app_dir, output))
        };
        let converted: ConvertedFactory = {
            let platform = platform.clone();
            let worker = platform.rvc_worker(&app_dir);
            let settings = weak.clone();
            let runtimes_root = env.state_dir.join("vc_runtimes");
            Arc::new(move |options, monitor, output| {
                // Seed-VC ran on Python and ended with it; a start of it fails as one whose
                // runtime is missing did.
                if options.get("engine").and_then(Value::as_str) != Some("rvc") {
                    return Err("vc_engine_unavailable".into());
                }
                let route: Arc<dyn VcRoute> = match output {
                    // Windows: the chosen output device.
                    Some(output) => {
                        let devices = platform.route_devices().ok_or("vc_engine_unavailable")?;
                        Arc::new(DeviceRoute::new(output, devices, platform.monitor_output()))
                    }
                    // Linux: the managed VC input, captured from PipeWire (decision 11).
                    None => {
                        let devices = platform.managed_vc_devices().ok_or("vc_engine_unavailable")?;
                        Arc::new(ManagedRoute::new(devices, platform.monitor_output()))
                    }
                };
                let options = with_block(options, settings.upgrade().map(|core| core.config().get("RVC_BLOCK_MS")));
                // The DirectML runtime (shared with the translation), looked up at each start: it
                // may have been set up since the app started.
                let directml = vrct_voice_conversion::runtime::directml_libraries(&runtimes_root).map(|found| found.lib);
                Ok(Box::new(VcProcess::rvc(&options, &worker, directml.as_deref(), route, monitor)?) as Box<dyn vrct_voice_conversion::DirectBackend>)
            })
        };
        let direct = Arc::new(DirectVoice::new(passthrough, Some(converted)));

        let output_platform = platform.clone();
        let factory = move |device: &str, rate: u32, channels: u16| -> Result<Box<dyn OutputSink>, TtsError> {
            Ok(Box::new(Sink(output_platform.speech_output(device, rate, channels).map_err(tts_error)?)))
        };
        let mut options = BusOptions::new(Arc::new(AudioRouter::new(Arc::new(factory))));
        options.engine_factory = Some(vrct_tts::engines::engine_factory());
        options.enabled = false;
        let servers = weak.clone();
        options.resolve_server = Some(Arc::new(move |role: &str| {
            let core = servers.upgrade().ok_or(TtsError::Speech(SpeechError::new("speech_server_not_ready")))?;
            core.speech_servers().hub().binding(profile(role)).map_err(|_| TtsError::Speech(SpeechError::new("speech_server_not_ready")))
        }));
        let monitor_platform = platform.clone();
        options.monitor_factory = Some(Arc::new(move |request: MonitorRequest| -> Result<Arc<dyn Monitor>, TtsError> {
            let on_error = request.on_error.clone();
            let on_ready = request.on_ready.clone();
            let tee = MonitorTee::new(
                &request.device,
                request.volume,
                MonitorOptions {
                    exclude: request.exclude.clone(),
                    factory: monitor_platform.monitor_output(),
                    on_error: Some(Arc::new(move |code: &str| on_error(code))),
                    on_ready: Some(Arc::new(move || on_ready())),
                    max_buffer_ms: 500,
                },
            );
            Ok(Arc::new(TeeMonitor(tee)))
        }));
        let logger = weak.clone();
        options.on_monitor_error = Some(Arc::new(move |code: &str| {
            if let Some(core) = logger.upgrade() {
                // A fixed identifier, never a device name.
                core.step(&format!("[voice] monitor output unavailable {code}"));
            }
        }));
        options.on_failure = Some(Arc::new(|code: &str| crate::errors::report_failure("tts", code)));
        options.converted_router = Some(Arc::new(ConvertedSpeechRouter::new(Arc::new(Speaker(direct.clone())))));
        let started = weak.clone();
        options.on_first_audio = Some(Arc::new(move |event, timestamp, converted, asked| {
            // The flow panel: when this message became audible, how long its synthesis took,
            // and by which path.
            if let Some(voice) = started.upgrade().and_then(|core| core.voice().cloned()) {
                let conversion = if converted { voice.direct.health().round_trip_ms } else { None };
                voice.traces.speech_started(&event.event_id, timestamp, converted, conversion, Some(timestamp - asked));
            }
        }));
        let bus = Arc::new(VoiceEventBus::new(settings.clone(), options));

        let muted_direct = direct.clone();
        let store = MuteState::new(config.path().with_file_name("voice_mute_state.json"));
        let audition = audition::Audition::new();
        let route = VoiceRoute::new(
            Arc::new(BusMute(bus.clone(), audition.clone())),
            platform.gate(&app_dir),
            Arc::new(store),
            RouteOptions { poll_interval: Duration::from_millis(100), on_muted: Some(Arc::new(move |muted| muted_direct.set_monitor_muted(muted))), ..RouteOptions::default() },
        );
        let emitter = weak.clone();
        let traces = IoTraces::new(Arc::new(move |payload| {
            if let Some(core) = emitter.upgrade() {
                // A readout never stops the message it describes.
                core.run(200, "/run/io_trace", payload);
            }
        }));
        let runtimes = RuntimeSetup::new(SetupOptions {
            root: env.state_dir.join("vc_runtimes"),
            target: platform.runtime_target(),
            transport: platform.runtime_transport(),
            gpu_check: {
                let platform = platform.clone();
                Arc::new(move || platform.nvidia_driver())
            },
            worker: platform.rvc_worker(&app_dir),
            free_space: Arc::new(|path: &Path| vrct_ops::downloads::free_space(path).ok()),
            entries: platform.runtime_entries(),
            loaded: {
                let platform = platform.clone();
                Arc::new(move || platform.loaded_libraries())
            },
        });
        let voice = Arc::new(Voice {
            core: weak,
            platform,
            windows,
            linux,
            bus,
            settings_lock: Mutex::new(()),
            owner: Mutex::new(TtsOwner::default()),
            direct,
            route,
            direct_closed: AtomicBool::new(false),
            direct_engine: Mutex::new(None),
            traces,
            runtimes,
            monitor_logged: Mutex::new(None),
            realtime_mic: Mutex::new(None),
            seed_vc_moved: AtomicBool::new(seed_vc_moved),
            audition,
        });
        let _ = voice.route.configure(settings.routing == "managed", Duration::from_secs(3), voice.gate_suppresses_direct(&settings));
        voice.apply_direct_policy(&settings);
        voice
    }

    fn core(&self) -> Option<Arc<Core>> {
        self.core.upgrade()
    }

    fn tts_platform(&self) -> tts_settings::Platform {
        if self.windows { tts_settings::Platform::Windows } else { tts_settings::Platform::Other }
    }

    // ------------------------------------------------------------ policies

    fn suppresses_direct(settings: &VoiceSettings) -> bool {
        settings.mic_mode == "translated" && settings.direct_policy == "suppress"
    }

    /// Speech through the conversion leaves by the conversion's sink, so the OS gate cannot
    /// silence that sink; the conversion silences the microphone's blocks itself.
    fn gate_suppresses_direct(&self, settings: &VoiceSettings) -> bool {
        Self::suppresses_direct(settings) && settings.conversion != "on"
    }

    fn apply_direct_policy(&self, settings: &VoiceSettings) {
        let (suppress, through) = (Self::suppresses_direct(settings), settings.conversion == "on");
        // The managed route does this with an OS gate; a device route has none.
        self.direct.set_suppressed(self.windows && suppress && !through);
        // Block by block, on either route, while speech goes through the conversion (ADR-007).
        self.direct.set_direct_suppressed(suppress && through);
    }

    // ------------------------------------------------------------ status

    fn waiting(&self) -> bool {
        self.owner.lock().unwrap().waiting > 0
    }

    fn status(&self) -> Value {
        let mut status = serde_json::to_value(self.bus.status()).expect("the status serializes");
        // An ON request is waiting for a bundled server to load.
        status["tts_server_starting"] = json!(self.waiting());
        status
    }

    fn route_status(&self) -> Value {
        let status = self.route.status();
        json!({
            "managed": status.managed, "requested_muted": status.requested_muted, "observed_muted": status.observed_muted,
            "ready": status.ready, "pending": status.pending, "error": status.error, "preparing": status.preparing,
            "generation": status.generation, "closed": status.closed,
            "requested_direct_suppressed": status.requested_direct_suppressed,
            "observed_direct_suppressed": status.observed_direct_suppressed,
            "observation_id": status.observation_id, "covers_direct": self.windows,
        })
    }

    fn direct_state(&self) -> Value {
        let health = self.direct.health();
        // The conversion's errors are not kept elsewhere: log each new monitor code once.
        {
            let mut logged = self.monitor_logged.lock().unwrap();
            if let Some(code) = health.monitor_error.as_ref().filter(|code| logged.as_ref() != Some(*code))
                && let Some(core) = self.core()
            {
                core.step(&format!("[voice] monitor output unavailable {code}"));
            }
            *logged = health.monitor_error.clone();
        }
        let mut state = health.to_json();
        let settings = self.core().map(|core| core.config().get(DIRECT_KEY)).unwrap_or(Value::Null);
        state.insert("settings".into(), settings);
        state.insert("output_route".into(), json!(if self.windows { "device" } else { "managed" }));
        if self.seed_vc_moved.load(Ordering::SeqCst) {
            state.insert("notice".into(), json!("seed_vc_moved_to_rvc"));
        }
        Value::Object(state)
    }
}

// ---------------------------------------------------------------- TTS

impl Voice {
    /// The selected roles at an epoch; mute is allowed only for the end-dependency check.
    fn tts_roles(&self, core: &Core, generation: u64, allow_muted: bool) -> Result<Vec<&'static str>, &'static str> {
        let state = self.bus.status();
        if generation != state.tts_generation {
            return Err("tts_state_changed");
        }
        // Name the blocking condition: the UI turns each code into its next step.
        if state.closed {
            return Err("voice_route_closed");
        }
        if state.muted && !allow_muted {
            return Err("voice_route_muted");
        }
        let settings = self.bus.settings();
        if settings.mode == "off" && settings.mic_mode == "off" {
            return Err("tts_source_not_selected");
        }
        let config = core.config();
        let tab = config.get_str("SELECTED_TAB_NO");
        let mut languages = Vec::new();
        if settings.mode == "original" {
            let language = config.get("SELECTED_YOUR_LANGUAGES")[&tab]["1"]["language"].clone();
            languages.push(language.as_str().ok_or("speech_server_or_settings_not_ready")?.to_owned());
        }
        if settings.mode == "translated" || settings.mic_mode == "translated" {
            let target = config.get("SELECTED_TARGET_LANGUAGES")[&tab][&settings.target_slot].clone();
            if target.is_null() {
                return Err("speech_server_or_settings_not_ready");
            }
            if !config.get_bool("ENABLE_TRANSLATION") || target["enable"] != true {
                return Err("tts_translation_not_ready");
            }
            languages.push(target["language"].as_str().ok_or("speech_server_or_settings_not_ready")?.to_owned());
        }
        let mut roles = Vec::new();
        for language in languages {
            let tag = tts_settings::language_tag(&language).map_err(|_| "tts_language_unsupported")?;
            let role = if tag == "ja" { "japanese" } else { "multilingual" };
            if !roles.contains(&role) {
                roles.push(role);
            }
        }
        // Checked before any server starts, so this never costs a model load.
        if settings.playback_device().chars().all(char::is_whitespace) {
            return Err("tts_output_missing");
        }
        Ok(roles)
    }

    fn role_server<'a>(settings: &'a VoiceSettings, role: &str) -> &'a str {
        if role == "japanese" { &settings.japanese_server } else { &settings.multilingual_server }
    }

    fn role_url<'a>(settings: &'a VoiceSettings, role: &str) -> &'a str {
        if role == "japanese" { &settings.japanese_url } else { &settings.multilingual_url }
    }

    fn enable_tts(&self, core: &Core, data: &Value) -> Reply {
        let generation = data.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("generation")).filter(|g| g.is_u64()).and_then(Value::as_u64);
        let Some(generation) = generation else { return refused(400, "invalid_tts_toggle") };
        let attempt = Arc::new(AtomicBool::new(false));
        self.owner.lock().unwrap().attempts.push(attempt.clone());
        let mut started: HashMap<&'static str, u64> = HashMap::new();
        let code = self.enable_tts_inner(core, generation, &attempt, &mut started);
        self.owner.lock().unwrap().attempts.retain(|a| !Arc::ptr_eq(a, &attempt));
        if let Err(code) = code {
            // A failed or cancelled ON leaves no server of its own running.
            self.release_tts_servers(core, Some(&started), false);
            // OFF during ON is the user's choice, not an error to report.
            return refused(409, if attempt.load(Ordering::SeqCst) { "tts_enable_cancelled" } else { code });
        }
        ok(self.status())
    }

    fn enable_tts_inner(&self, core: &Core, generation: u64, attempt: &AtomicBool, started: &mut HashMap<&'static str, u64>) -> Result<(), &'static str> {
        let bundled: Vec<&'static str> = {
            let _settings = self.settings_lock.lock().unwrap();
            let roles = self.tts_roles(core, generation, false)?;
            let settings = self.bus.settings();
            let mut bundled: Vec<&'static str> = roles.into_iter().filter(|role| settings.uses_speechcpp(role) && Self::role_server(&settings, role) == "bundled").collect();
            bundled.sort_unstable();
            bundled
        };
        if !bundled.is_empty() {
            // Loading a model takes seconds. Wait without the settings lock; OFF cancels the wait.
            self.await_tts_servers(core, &bundled, generation, attempt, started)?;
        }
        let _settings = self.settings_lock.lock().unwrap();
        let roles = self.tts_roles(core, generation, false)?;
        let settings = self.bus.settings();
        if !roles.iter().all(|role| settings.uses_speechcpp(role)) {
            // Japanese is read by an engine the user installed and runs (ADR-008): it must
            // answer and have a voice chosen. The app never starts it.
            if settings.engine_voice_id.is_empty() {
                return Err("tts_engine_voice_unset");
            }
            let engine = settings.japanese_engine.as_str();
            let client = EngineClient::new(engine, settings.engine_url(engine)).map_err(|_| "speech_server_or_settings_not_ready")?;
            client.check_health(None).map_err(|_| "tts_engine_not_ready")?;
        }
        let mut urls = Vec::new();
        for role in roles.iter().filter(|role| settings.uses_speechcpp(role)) {
            let url = if Self::role_server(&settings, role) == "bundled" {
                core.speech_servers().hub().binding(profile(role)).map_err(|_| "speech_server_not_ready")?
            } else {
                Self::role_url(&settings, role).to_owned()
            };
            if !urls.contains(&url) {
                urls.push(url);
            }
        }
        for url in urls {
            // A stopped bundled server and an unreachable external URL both need the user to
            // start (or fix) the server for that language.
            let client = SpeechCppTts::new(&url).map_err(|_| "speech_server_or_settings_not_ready")?;
            client.check_health().map_err(|_| "speech_server_not_ready")?;
        }
        // OFF bypasses the settings lock: the epoch is checked again under the owner's.
        let owner = self.owner.lock().unwrap();
        for role in roles.iter().filter(|role| settings.uses_speechcpp(role) && Self::role_server(&settings, role) == "bundled") {
            core.speech_servers().hub().binding(profile(role)).map_err(|_| "speech_server_not_ready")?;
        }
        let enabled = self.bus.set_enabled(true, Some(generation));
        drop(owner);
        if !enabled {
            return Err("tts_state_changed");
        }
        Ok(())
    }

    /// Start the stopped bundled servers of `roles`, then wait until all are ready.
    fn await_tts_servers(&self, core: &Core, roles: &[&'static str], generation: u64, attempt: &AtomicBool, started: &mut HashMap<&'static str, u64>) -> Result<(), &'static str> {
        let hub = core.speech_servers().hub();
        let state = hub.state();
        let row = |role: &str| state.iter().find(|(p, _)| *p == profile(role)).map(|(_, s)| s.clone()).expect("every profile");
        for role in roles {
            let current = row(role);
            match current.health.state {
                // Started from Settings: wait for it, but never own it.
                vrct_speech_server::State::Ready | vrct_speech_server::State::Preparing => continue,
                vrct_speech_server::State::Stopping => return Err("speech_server_busy"),
                _ => {}
            }
            let options = core.speech_servers().start_options(core, profile(role)).map_err(|code| if code == "speech_server_model_invalid" { code } else { "speech_server_start_failed" })?;
            let mut owner = self.owner.lock().unwrap();
            // OFF takes this lock too: it either cancels first or sees ownership.
            if attempt.load(Ordering::SeqCst) {
                return Err("tts_enable_cancelled");
            }
            hub.start(profile(role), options, current.generation).map_err(|code| if code == "speech_server_busy" { code } else { "speech_server_start_failed" })?;
            // A start succeeds only from this generation and takes the next one.
            started.insert(role, current.generation + 1);
            owner.owned.insert(role, current.generation + 1);
        }
        self.owner.lock().unwrap().waiting += 1;
        let result = (|| {
            let deadline = Instant::now() + TTS_SERVER_WAIT;
            while !attempt.load(Ordering::SeqCst) {
                let state = hub.state();
                let rows: Vec<(&str, vrct_speech_server::servers::ProfileState)> = roles.iter().map(|role| (*role, state.iter().find(|(p, _)| *p == profile(role)).map(|(_, s)| s.clone()).expect("every profile"))).collect();
                // Report a failure before the TTS epoch change that it causes.
                if let Some((_, failed)) = rows.iter().find(|(_, row)| row.health.state == vrct_speech_server::State::Failed) {
                    let code = failed.health.error_code.unwrap_or("speech_server_start_failed");
                    return Err(if TTS_START_FAILURES.contains(&code) { code } else { "speech_server_start_failed" });
                }
                if rows.iter().any(|(role, row)| matches!(row.health.state, vrct_speech_server::State::Stopped | vrct_speech_server::State::Stopping) || started.get(role).is_some_and(|run| *run != row.generation)) {
                    // Stopped from Settings meanwhile.
                    return Err("speech_server_not_ready");
                }
                if rows.iter().all(|(_, row)| row.health.state == vrct_speech_server::State::Ready) {
                    return Ok(());
                }
                if self.bus.generation() != generation {
                    return Err("tts_state_changed");
                }
                if Instant::now() >= deadline {
                    return Err("speech_server_start_timeout");
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err("tts_enable_cancelled")
        })();
        self.owner.lock().unwrap().waiting -= 1;
        result
    }

    /// Stop TTS servers the main toggle started; servers started from Settings stay up.
    fn release_tts_servers(&self, core: &Core, only: Option<&HashMap<&'static str, u64>>, cancel: bool) {
        let owned: Vec<(&'static str, u64)> = {
            let mut owner = self.owner.lock().unwrap();
            if cancel {
                for attempt in &owner.attempts {
                    attempt.store(true, Ordering::SeqCst);
                }
            }
            let owned: Vec<(&'static str, u64)> = owner.owned.iter().filter(|(role, run)| only.is_none_or(|only| only.get(*role) == Some(*run))).map(|(role, run)| (*role, *run)).collect();
            for (role, run) in &owned {
                owner.owned.remove(role);
                // Match the run, not the public generation: its late end must not
                // invalidate a quick OFF then ON.
                owner.released.insert(role, *run);
            }
            owned
        };
        for (role, run) in owned {
            // Not joined, as a Stop from Settings; a newer run is left alone.
            if !core.speech_servers().hub().stop(profile(role), Some(run), None) {
                let mut owner = self.owner.lock().unwrap();
                if owner.released.get(role) == Some(&run) {
                    owner.released.remove(role);
                }
            }
        }
    }

    fn disable_tts(&self, core: &Core) -> Reply {
        self.bus.set_enabled(false, None);
        // OFF also cancels an ON that is still waiting for its server.
        self.release_tts_servers(core, None, true);
        ok(self.status())
    }

    /// The TTS epoch that uses this exact bundled run (`_speechTtsDependency`).
    fn tts_dependency(&self, core: &Core, role: &'static str, run: u64) -> Option<u64> {
        loop {
            let state = self.bus.status();
            let settings = self.bus.settings();
            if !state.tts_enabled
                || state.closed
                || core.speech_servers().hub().current_run(profile(role)) != Some(run)
                || Self::role_server(&settings, role) != "bundled"
                || !settings.uses_speechcpp(role)
            {
                return None;
            }
            // Saves and language changes can alter the roles while TTS stays on.
            match self.tts_roles(core, state.tts_generation, true) {
                Err("tts_state_changed") => continue,
                Ok(roles) if roles.contains(&role) => return Some(state.tts_generation),
                _ => return None,
            }
        }
    }

    /// A speech server ended (a Stop from Settings, or by itself): TTS that used that run
    /// turns off, and servers the toggle started for it go too.
    fn server_ended(&self, core: &Core, ended: super::speech::Ended) {
        let role: &'static str = match ended.profile {
            Profile::Japanese => "japanese",
            Profile::Multilingual => "multilingual",
            _ => return,
        };
        let Some(run) = ended.run else { return };
        let owned = {
            let mut owner = self.owner.lock().unwrap();
            if owner.ended.get(role).is_some_and(|last| run <= *last) {
                return;
            }
            owner.ended.insert(role, run);
            if owner.released.get(role) == Some(&run) {
                // The end of a run the toggle's own OFF stopped.
                owner.released.remove(role);
                return;
            }
            loop {
                let Some(generation) = self.tts_dependency(core, role, run) else { return };
                // Settings, Stop and Mute can change the epoch without this lock.
                if self.bus.set_enabled(false, Some(generation)) {
                    break;
                }
            }
            owner.owned.clone()
        };
        // TTS is off now; a waiting ON is not cancelled here: it reports this failure itself.
        self.release_tts_servers(core, Some(&owned), false);
    }

    fn model_options(&self, core: &Core, data: &Value) -> Reply {
        let object = data.as_object();
        let valid = object.is_some_and(|o| {
            let keys: Vec<&str> = o.keys().map(String::as_str).collect();
            let shaped = (o.len() == 1 && keys == ["role"]) || (o.len() == 2 && o.contains_key("role") && o.contains_key("request_id"));
            shaped && ROLES.contains(&o["role"].as_str().unwrap_or("")) && o.get("request_id").is_none_or(|id| request_id(id).is_some())
        });
        if !valid {
            return refused(400, "tts_role_invalid");
        }
        let object = object.expect("checked above");
        let role: &'static str = if object["role"] == "japanese" { "japanese" } else { "multilingual" };
        let (server, configured_url, generation) = {
            let _settings = self.settings_lock.lock().unwrap();
            let settings = self.bus.settings();
            let server = Self::role_server(&settings, role).to_owned();
            let generation = (server == "bundled").then(|| core.speech_servers().hub().state().iter().find(|(p, _)| *p == profile(role)).map(|(_, s)| s.generation).unwrap_or(0));
            (server, Self::role_url(&settings, role).to_owned(), generation)
        };
        let mut result = Map::new();
        result.insert("role".into(), json!(role));
        result.insert("server".into(), json!(server));
        result.insert("configured_url".into(), json!(configured_url));
        result.insert("server_generation".into(), json!(generation));
        result.insert("base_url".into(), Value::Null);
        result.insert("options".into(), Value::Null);
        result.insert("error_code".into(), Value::Null);
        if let Some(id) = object.get("request_id") {
            result.insert("request_id".into(), id.clone());
        }
        // The base is set before the server is asked, so it stays when the asking fails.
        let base = if server == "bundled" { core.speech_servers().hub().binding(profile(role)).map_err(|_| "speech_server_not_ready".to_owned()) } else { Ok(configured_url.clone()) };
        let outcome = base.and_then(|base| {
            result.insert("base_url".into(), json!(base));
            let client = SpeechCppTts::new(&base).map_err(|_| "tts_model_options_unavailable".to_owned())?;
            let options = client.get_model_options(None).map_err(|e| e.code().to_owned())?;
            let current = core.speech_servers().hub().state().iter().find(|(p, _)| *p == profile(role)).map(|(_, s)| s.generation);
            if server == "bundled" && current != generation {
                return Err("tts_state_changed".to_owned());
            }
            Ok(serde_json::to_value(options).expect("options serialize"))
        });
        match outcome {
            Ok(options) => {
                result.insert("options".into(), options);
            }
            Err(code) => {
                result.insert("error_code".into(), json!(code));
            }
        }
        ok(Value::Object(result))
    }

    /// Whether an engine the user installed runs, and its voices (ADR-008). No text is sent and
    /// nothing is synthesized; an engine that does not answer is reported, never started.
    fn engine_voices(&self, data: &Value) -> Reply {
        let object = data.as_object().filter(|o| o.len() == 3 && ["engine", "url", "request_id"].iter().all(|k| o.contains_key(*k)));
        let shaped = object.and_then(|o| {
            let engine = o["engine"].as_str().filter(|e| ENGINE_URL_FIELDS.contains(e))?;
            let url = o["url"].as_str()?;
            let id = request_id(&o["request_id"])?;
            Some((engine, url, id))
        });
        let Some((engine, url, id)) = shaped else { return refused(400, "tts_engine_request_invalid") };
        let mut result = Map::new();
        result.insert("request_id".into(), json!(id));
        result.insert("engine".into(), json!(engine));
        result.insert("url".into(), Value::Null);
        result.insert("connected".into(), json!(false));
        result.insert("version".into(), Value::Null);
        result.insert("voices".into(), json!([]));
        result.insert("error_code".into(), Value::Null);
        let Ok(url) = tts_settings::local_url(url) else {
            result.insert("error_code".into(), json!("tts_engine_url_invalid"));
            return ok(Value::Object(result));
        };
        result.insert("url".into(), json!(url));
        let client = match EngineClient::new(engine, &url) {
            Ok(client) => client,
            Err(_) => {
                result.insert("error_code".into(), json!("tts_engine_not_ready"));
                return ok(Value::Object(result));
            }
        };
        let outcome = (|| -> Result<(), SpeechError> {
            let version = client.check_health(None)?;
            result.insert("connected".into(), json!(true));
            result.insert("version".into(), if version.chars().count() <= 64 { json!(version) } else { Value::Null });
            let mut voices = Vec::new();
            for voice in client.list_voices(None)? {
                // The same limits as a saved voice, so any voice offered here can be saved.
                let name_ok = |name: &str| (1..=128).contains(&name.chars().count()) && !name.chars().any(|c| (c as u32) < 32 || c as u32 == 127);
                if tts_settings::valid_engine_voice_id(&voice.id) && name_ok(&voice.speaker) && name_ok(&voice.style) {
                    voices.push(json!({ "id": voice.id, "speaker": voice.speaker, "style": voice.style }));
                }
                if voices.len() >= ENGINE_VOICE_LIMIT {
                    break;
                }
            }
            result.insert("voices".into(), Value::Array(voices));
            Ok(())
        })();
        if let Err(error) = outcome {
            let code = if error.code().is_empty() { "tts_engine_not_ready" } else { error.code() };
            result.insert("error_code".into(), json!(code));
        }
        ok(Value::Object(result))
    }

    fn set_settings(&self, core: &Core, data: &Value) -> Reply {
        let invalid = || Reply::status(400, json!({ "error_code": "VOICE_SETTINGS_INVALID", "message": "Invalid voice settings; select an output and local server.", "data": null }));
        let _settings = self.settings_lock.lock().unwrap();
        let current = self.bus.settings();
        let Some(changes) = data.as_object() else { return invalid() };
        let mut merged = current.to_value();
        for (key, value) in changes {
            merged[key] = value.clone();
        }
        let Ok(settings) = VoiceSettings::from_value_on(&merged, self.tts_platform()) else { return invalid() };
        if settings.routing == "managed" && !self.linux {
            return invalid();
        }
        let device_route = self.windows;
        if settings.routing != current.routing || (device_route && settings.output_device != current.output_device) {
            let direct = self.direct.health();
            if direct.requested || direct.pending || direct.stopping {
                return refused(409, "direct_voice_stop_required");
            }
        }
        // On Windows direct voice writes to the external output device.
        if settings.routing != "managed" && !device_route {
            self.direct.stop();
        }
        if let Err(error) = self.route.configure(settings.routing == "managed", Duration::from_secs(3), self.gate_suppresses_direct(&settings)) {
            return refused(409, &error.code);
        }
        self.apply_direct_policy(&settings);
        let _ = core.config().set(SETTINGS_KEY, settings.to_value());
        self.bus.configure(settings);
        ok(core.config().get(SETTINGS_KEY))
    }

    fn output_devices(&self, core: &Core) -> Reply {
        let settings = self.bus.settings();
        match core.audio_devices().outputs(&[settings.output_device.clone(), settings.monitor_device.clone()]) {
            Ok(devices) => ok(json!({ "devices": devices.iter().map(|d| json!({ "id": d.id, "label": d.label })).collect::<Vec<_>>(), "error": null })),
            Err(_) => ok(json!({ "devices": [], "error": "audio_devices_unavailable" })),
        }
    }

    fn stop_voice(&self, core: &Core) -> Reply {
        self.bus.cancel();
        self.audition.stop();
        core.audio_devices().stop_virtual_mic_check();
        ok(self.status())
    }

    fn mute(&self, core: &Core) -> Reply {
        // Before the route: a mute that fails to reach the OS still silences the audition.
        self.audition.stop();
        if self.route.mute().is_err() {
            // Python let a closed route raise.
            return Reply::status(500, "Internal error");
        }
        core.audio_devices().stop_virtual_mic_check();
        ok(self.route_status())
    }

    /// A voice audition (#415), on the monitor output only: the fixed sentence by the profile's
    /// running bundled server (TTS), or the user's voice recorded on the press and converted by a
    /// voice model (RVC). Refused while muted or without a monitor; a TTS one also without its
    /// server, an RVC one while a conversion runs and without the runtime or the model's files.
    fn start_audition(&self, core: &Core, data: &Value) -> Reply {
        let Some(request) = audition::parse(data) else { return refused(400, "voice_audition_request_invalid") };
        if self.audition.closed() || self.bus.status().closed {
            return refused(409, "voice_audition_closed");
        }
        // As the virtual microphone check: nothing sounds while the voice is muted.
        if self.route.status().requested_muted || self.bus.status().muted {
            return refused(409, "voice_audition_muted");
        }
        let settings = self.bus.settings();
        let target = match audition::monitor_target(&settings, core.audio_devices().cable_playbacks(), self.platform.monitor_output()) {
            Ok(target) => target,
            Err(code) => return refused(409, code),
        };
        let started = match request {
            audition::Request::Tts(request) => {
                let Some(speech) = audition_speech(core, &settings, request.profile) else { return refused(409, "voice_audition_server_not_ready") };
                self.audition.start_tts(request.profile, speech, target)
            }
            audition::Request::Rvc(request) => {
                let prepared = match self.rvc_audition_worker(core, &request) {
                    Ok(prepared) => prepared,
                    Err(code) => return refused(409, &code),
                };
                // The sample (`source` `recording`): the user's voice from the input chosen on
                // the RVC page, opened only now and as the live conversion captures it.
                let Some(open) = self.audition_capture() else { return refused(409, "voice_audition_input_unavailable") };
                let recording = audition::Recording { open, input: request.input.clone(), seconds: request.seconds };
                self.audition.start_rvc(request.entry, prepared, recording, target)
            }
        };
        match started {
            Ok(state) => ok(state),
            Err(code) => refused(409, code),
        }
    }

    /// How an RVC audition opens the microphone: the device route's capture on Windows, the
    /// managed route's on Linux, as a live conversion captures it.
    fn audition_capture(&self) -> Option<audition::CaptureOpener> {
        if self.windows {
            let devices = self.platform.route_devices()?;
            Some(Arc::new(move |input: &vrct_audio_routing::graph::Endpoint, callbacks| devices.capture(input, callbacks)))
        } else {
            let devices = self.platform.managed_vc_devices()?;
            Some(Arc::new(move |input: &vrct_audio_routing::graph::Endpoint, callbacks| devices.capture(input, callbacks)))
        }
    }

    /// The checked worker of an RVC audition: the model's files by its id, the request's pitch and
    /// index rate, the runtime and the worker's choices of the live conversion. Refused while a
    /// conversion runs: it holds the GPU, and the audition would compete with the voice heard.
    fn rvc_audition_worker(&self, core: &Core, request: &audition::RvcRequest) -> Result<vrct_voice_conversion::PreparedRvc, String> {
        let health = self.direct.health();
        if self.direct_engine.lock().unwrap().is_some() && (health.requested || health.pending || health.stopping) {
            return Err("voice_audition_conversion_running".into());
        }
        let (model, index) = core.rvc_model_files(&request.entry).ok_or("voice_audition_model_missing")?;
        let direct = core.config().get(DIRECT_KEY);
        // The runtime the live conversion uses, or else the one the app set up.
        let installed = self.runtimes.state()["installed"]["rvc"].as_str().unwrap_or_default().to_owned();
        let runtime = [direct["rvc_runtime"].as_str().unwrap_or_default().to_owned(), installed]
            .into_iter()
            .find(|path| !path.trim().is_empty() && vrct_voice_conversion::worker::runtime_complete(Path::new(path)))
            .ok_or("vc_runtime_missing")?;
        let options = with_block(&audition::rvc_start_options(request, &runtime, &model, &index, &direct), Some(core.config().get("RVC_BLOCK_MS")));
        let env = core.config().environment();
        let directml = vrct_voice_conversion::runtime::directml_libraries(&env.state_dir.join("vc_runtimes")).map(|found| found.lib);
        vrct_voice_conversion::process::prepare_rvc(&options, &self.platform.rvc_worker(&env.app_dir), directml.as_deref())
    }

    fn stop_audition(&self) -> Reply {
        // Answered as it arrives: it only cancels.
        self.audition.stop();
        ok(self.audition.status())
    }

    fn resume(&self) -> Reply {
        match self.route.resume() {
            Ok(()) => ok(self.route_status()),
            Err(error) => refused(409, &error.code),
        }
    }
}

// ---------------------------------------------------------------- direct voice

impl Voice {
    fn sources(&self, core: &Core) -> Reply {
        let (sources, error) = match self.platform.direct_sources() {
            Ok(sources) => (sources, Value::Null),
            Err(_) => (Vec::new(), json!(if self.windows { "source_bridge_devices_unavailable" } else { "source_bridge_graph_unavailable" })),
        };
        let preferred = self.preferred_source(core, &sources);
        let rows: Vec<Value> = sources.iter().map(|s| json!({ "id": s.id.to_json(), "label": s.label })).collect();
        ok(json!({ "sources": rows, "error": error, "preferred": preferred.map(|id| id.to_json()) }))
    }

    /// The Device page's microphone is the RVC input's default; the UI applies it only while
    /// the user has not picked another input on the RVC page.
    fn preferred_source(&self, core: &Core, sources: &[Source]) -> Option<SourceId> {
        let config = core.config();
        let selected = config.get("SELECTED_MIC_DEVICE");
        let names = vrct_audio_routing::graph::microphone_names(sources);
        if !self.windows {
            if config.get("SELECTED_MIC_HOST") != "PipeWire" {
                return None;
            }
            return sources.iter().zip(&names).find(|(_, name)| selected == **name).map(|(s, _)| s.id.clone());
        }
        // The Device page's choice is the same hardware under a possibly cut name.
        let found = selected.as_str().and_then(|selected| sources.iter().zip(&names).find(|(_, name)| vrct_audio_routing::naming::same_output(name, selected)).map(|(s, _)| s.id.clone()));
        if found.is_some() || sources.is_empty() {
            return found;
        }
        let default = self.platform.default_microphone()?;
        sources.iter().find(|s| s.id.name == default).map(|s| s.id.clone())
    }

    fn set_direct_settings(&self, core: &Core, data: &Value) -> Reply {
        if data.get("engine").and_then(Value::as_str) == Some(crate::voice_settings::RETIRED_ENGINE) {
            // Seed-VC ran on Python and ended with it (decision 10): nothing is saved.
            return Reply::status(400, json!({ "error_code": "vc_engine_unavailable", "settings": core.config().get(DIRECT_KEY) }));
        }
        let Some(settings) = crate::voice_settings::normalize_direct(data) else { return refused(400, "vc_settings_invalid") };
        {
            let _settings = self.settings_lock.lock().unwrap();
            let state = self.direct.health();
            if self.direct_closed.load(Ordering::SeqCst) || state.requested || state.pending {
                return refused(409, "vc_stop_required");
            }
            // Saving new intent invalidates any start queued before the change.
            self.direct.stop();
            let _ = core.config().set(DIRECT_KEY, settings);
            self.seed_vc_moved.store(false, Ordering::SeqCst);
        }
        ok(self.direct_state())
    }

    fn start_direct(&self, data: &Value) -> Reply {
        let invalid = || refused(400, "source_bridge_source_invalid");
        let Some(object) = data.as_object() else { return invalid() };
        let Some(generation) = object.get("_direct_generation").filter(|g| g.is_u64()).and_then(Value::as_u64) else { return invalid() };
        let Ok(source) = parse_source(object.get("source").unwrap_or(&Value::Null)) else { return invalid() };
        let mode = match object.get("mode") {
            None => "passthrough",
            Some(Value::String(mode)) if mode == "passthrough" || mode == "converted" => mode.as_str(),
            Some(_) => return invalid(),
        };
        let options = object.get("options").cloned().unwrap_or(Value::Null);
        let options = match start_options(mode, &options) {
            Ok(options) => options,
            Err(()) => return invalid(),
        };
        let _settings = self.settings_lock.lock().unwrap();
        let outcome = (|| -> Result<(), String> {
            if self.direct_closed.load(Ordering::SeqCst) {
                return Err("source_bridge_closed".into());
            }
            let output = self.direct_output()?;
            if mode == "converted" {
                // The live conversion's worker comes first: an RVC audition ends (#415).
                self.audition.stop_rvc();
            }
            // One monitor setting covers TTS and converted voice; passthrough is never monitored.
            let monitor = if mode == "converted" { self.bus.settings().monitor_choice().map(|(device, volume)| MonitorSpec { device: device.to_owned(), volume }) } else { None };
            self.direct.start(source, generation, mode, options.clone(), monitor, output.as_deref())?;
            *self.direct_engine.lock().unwrap() = if mode == "converted" { options.get("engine").and_then(Value::as_str).map(str::to_owned) } else { None };
            Ok(())
        })();
        match outcome {
            Ok(()) => ok(self.direct_state()),
            Err(code) => refused(409, &code),
        }
    }

    /// The device of a Windows start; `None` on Linux, where the managed route decides.
    fn direct_output(&self) -> Result<Option<String>, String> {
        let settings = self.bus.settings();
        if !self.windows {
            if !self.linux {
                return Err("source_bridge_linux_only".into());
            }
            if settings.routing != "managed" {
                return Err("source_bridge_managed_required".into());
            }
            return Ok(None);
        }
        if settings.output_device.is_empty() {
            return Err("source_bridge_output_required".into());
        }
        Ok(Some(settings.output_device.clone()))
    }

    fn stop_direct(&self) -> Reply {
        // Answered as it arrives: no settings lock, device query or join.
        self.direct.stop();
        ok(self.direct_state())
    }

    /// Whether nothing of the conversion runs (`model_target_busy` otherwise).
    fn direct_idle(&self) -> bool {
        let state = self.direct.health();
        !(self.direct_closed.load(Ordering::SeqCst) || state.requested || state.pending || state.stopping)
    }
}

/// An RVC start with the block of the settings (`RVC_BLOCK_MS`, #531) when the start does not
/// name one. The Advanced settings keep it, not the start options the UI sends.
fn with_block(options: &Value, saved: Option<Value>) -> Value {
    let mut options = options.clone();
    if let (Some(object), Some(ms)) = (options.as_object_mut(), saved.filter(crate::config::schema::is_valid_rvc_block_ms)) {
        object.entry("block_ms").or_insert(ms);
    }
    options
}

/// `start_options(mode, options)`: nothing for a passthrough; the engine's fields for a
/// conversion. Seed-VC's `{runtime, reference}` is still accepted, and fails to start.
fn start_options(mode: &str, options: &Value) -> Result<Value, ()> {
    if mode == "passthrough" && (options.is_null() || options.as_object().is_some_and(|o| o.is_empty())) {
        return Ok(json!({}));
    }
    let object = options.as_object().filter(|_| mode == "converted").ok_or(())?;
    if object.get("engine").and_then(Value::as_str) == Some("rvc") {
        vrct_voice_conversion::process::rvc_options(options).map_err(|_| ())?;
        return Ok(options.clone());
    }
    let keys: Vec<&str> = object.keys().map(String::as_str).collect();
    if object.len() != 2 || !keys.contains(&"runtime") || !keys.contains(&"reference") {
        return Err(());
    }
    let text = |key: &str| object[key].as_str().filter(|s| s.chars().count() <= 4096 && !s.chars().any(|c| (c as u32) < 32) && !s.trim().is_empty());
    match (text("runtime"), text("reference")) {
        (Some(runtime), Some(reference)) => Ok(json!({ "runtime": runtime, "reference": reference })),
        _ => Err(()),
    }
}

// ---------------------------------------------------------------- the message pipeline

impl Voice {
    /// A chat message for speech (`_publishChatVoice`), at the stage its voice mode speaks.
    fn spoken(&self, event: &SpokenMessage) -> Result<(), ()> {
        if event.kind != "chat" {
            // The microphone speaks only realtime finals: `Core::publish_mic_voice`.
            return Ok(());
        }
        let settings = self.bus.settings();
        let speaks = matches!((event.stage, settings.mode.as_str()), (SpeechStage::Original, "original") | (SpeechStage::Translated, "translated"));
        if !speaks {
            return Ok(());
        }
        let _settings = self.settings_lock.lock().unwrap();
        let generation = event.voice_generation.unwrap_or_else(|| self.bus.generation());
        let targets = targets_of(&event.destinations);
        let translations: Vec<Option<String>> = event.translations.iter().map(|t| Some(t.clone())).collect();
        let provenance: Vec<String> = event.provenance.iter().map(|p| (*p).to_owned()).collect();
        let mut message = chat_event(
            &event.message,
            &translations,
            &event.success,
            &provenance,
            event.id.as_deref(),
            event.started_ns,
            event.source_language.as_deref(),
            &targets,
            &event.target_slots,
            &settings.target_slot,
        );
        if let Some(core) = self.core.upgrade() {
            super::terms::read_terms(&mut message, &core.term_dictionary());
        }
        let queued = (settings.mode == "original" || message.translated_text.is_some()) && self.bus.publish(message, Some(generation), None);
        if let Some(trace) = event.id.as_deref().and_then(|id| self.traces.get(id)) {
            trace.speech_queued(queued);
        }
        Ok(())
    }
}

fn targets_of(destinations: &Value) -> Vec<TranslationTarget> {
    destinations
        .as_object()
        .map(|slots| {
            slots
                .iter()
                .map(|(slot, row)| TranslationTarget { slot: slot.clone(), enable: row["enable"] == true, language: row["language"].as_str().map(str::to_owned) })
                .collect()
        })
        .unwrap_or_default()
}

/// What a microphone final carries for speech from its arrival (`update.voice_snapshot`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicVoiceSnapshot {
    pub generation: u64,
    pub source_generation: u64,
    settings: Arc<VoiceSettings>,
}

impl Core {
    pub(crate) fn voice(&self) -> Option<&Arc<Voice>> {
        self.voice.get()
    }

    /// The speech bus's generation, stamped on a message at its admission.
    pub(crate) fn voice_generation(&self) -> Option<u64> {
        self.voice().map(|voice| voice.bus.generation())
    }

    /// Stamps a request before it waits in the queue: a stop meanwhile invalidates its speech
    /// (`_voice_generation`) or its direct voice start (`_direct_generation`).
    pub(crate) fn stamp_voice(&self, endpoint: &str, data: &mut Value) {
        let Some(voice) = self.voice() else { return };
        let Some(object) = data.as_object_mut() else { return };
        match endpoint {
            "/run/send_message_box" => {
                object.insert("_voice_generation".into(), json!(voice.bus.generation()));
            }
            "/run/start_direct_voice" => {
                object.insert("_direct_generation".into(), json!(voice.direct.health().generation));
            }
            _ => {}
        }
    }

    /// Queued and active microphone speech goes (a stop of the recognition, a change of the
    /// languages or of translation).
    pub fn cancel_mic_voice(&self) {
        if let Some(voice) = self.voice() {
            voice.bus.cancel_source(&vrct_tts::Source::Mic);
        }
    }

    /// Taken when a microphone final arrives: the speech it may become is refused once the
    /// settings or the microphone's session change.
    /// `None` unless microphone finals speak translated and translation is on
    /// (`_snapshotMicVoice`).
    pub fn mic_voice_snapshot(&self) -> Option<MicVoiceSnapshot> {
        let voice = self.voice()?;
        let _settings = voice.settings_lock.lock().unwrap();
        if voice.bus.settings().mic_mode != "translated" || !self.config().get_bool("ENABLE_TRANSLATION") {
            return None;
        }
        Some(MicVoiceSnapshot { generation: voice.bus.generation(), source_generation: voice.bus.source_generation(&vrct_tts::Source::Mic), settings: voice.bus.settings() })
    }

    /// A realtime microphone final, translated (`_publishMicVoice`). Only a successful
    /// translation of the selected target speaks. `targets` is the target languages of the
    /// message's tab as they were when it was admitted. Returns whether it was queued.
    #[allow(clippy::too_many_arguments)]
    /// Readies the speech server that will speak a message's translation while it is translated
    /// (#556): the speech of `mic` (the microphone's translated voice) or of a typed or
    /// recognised message, in the language of the speech's target slot among `destinations`.
    pub(crate) fn warm_speech(&self, mic: bool, destinations: &Value) {
        let Some(voice) = self.voice() else { return };
        let settings = voice.bus.settings();
        let Some(language) = destinations[&settings.target_slot]["language"].as_str() else { return };
        let source = if mic { vrct_tts::events::Source::Mic } else { vrct_tts::events::Source::Chat };
        voice.bus.warm(&source, language);
    }

    pub fn publish_mic_voice(
        &self,
        snapshot: &MicVoiceSnapshot,
        update: &TranscriptUpdate,
        tab: &str,
        source_language: Option<&str>,
        targets: &Value,
        translations: &[String],
        success: &[bool],
        provenance: &[&str],
        current: &dyn Fn() -> bool,
    ) -> bool {
        let Some(voice) = self.voice() else { return false };
        let _settings = voice.settings_lock.lock().unwrap();
        let config = self.config();
        if !current() || *voice.bus.settings() != *snapshot.settings || !config.get_bool("ENABLE_TRANSLATION") || config.get_str("SELECTED_TAB_NO") != tab {
            return false;
        }
        // Text keeps its snapshot; speech also requires the selected target to remain current.
        let slot = &snapshot.settings.target_slot;
        if config.get("SELECTED_TARGET_LANGUAGES")[tab][slot] != targets[slot] {
            return false;
        }
        let usable: Vec<bool> = success.iter().zip(provenance).map(|(ok, origin)| *ok && *origin == "translated").collect();
        let translations: Vec<Option<String>> = translations.iter().map(|t| Some(t.clone())).collect();
        let Some(mut event) = microphone_event(update, &translations, &usable, source_language, &targets_of(targets), slot) else { return false };
        super::terms::read_terms(&mut event, &self.term_dictionary());
        voice.bus.publish(event, Some(snapshot.generation), Some(snapshot.source_generation))
    }

    /// Whether a recognition endpoint is the virtual cable the voice plays into
    /// (`_carriesOwnVoice`): listening to it would caption the app's own speech. Only Windows
    /// plays the voice to a chosen output device.
    pub(crate) fn carries_own_voice(&self, endpoint: &str) -> bool {
        if !cfg!(windows) {
            return false;
        }
        let Some(voice) = self.voice() else { return false };
        let output = voice.bus.settings().output_device.clone();
        vrct_audio_routing::naming::carries_own_voice(endpoint, &output)
    }

    /// Tells the flow panel whether the microphone's realtime recognition is requested (the
    /// recognition area sets it; until then only the transcription switch counts).
    pub fn set_realtime_mic_probe(&self, probe: Arc<dyn Fn() -> bool + Send + Sync>) {
        if let Some(voice) = self.voice() {
            *voice.realtime_mic.lock().unwrap() = Some(probe);
        }
    }

    /// Puts a downloaded RVC model (and index) into the direct voice settings
    /// (`applyModelDownload` for the `rvc` target): refused while a conversion runs.
    pub(crate) fn apply_rvc_download(&self, expected: &Value, model: &str, index: &str) -> Result<(), &'static str> {
        let Some(voice) = self.voice() else { return Err("model_target_busy") };
        let _settings = voice.settings_lock.lock().unwrap();
        if !voice.direct_idle() {
            return Err("model_target_busy");
        }
        let mut settings = self.config().get(DIRECT_KEY);
        if ["model", "index"].iter().any(|k| settings[format!("rvc_{k}")] != expected[*k]) {
            return Err("settings_changed");
        }
        settings["rvc_model"] = json!(model);
        settings["rvc_index"] = json!(index);
        let Some(settings) = crate::voice_settings::normalize_direct(&settings) else { return Err("download_apply_failed") };
        // Invalidate queued starts, as the settings setter does.
        voice.direct.stop();
        self.config().set(DIRECT_KEY, settings).map(|_| ()).map_err(|_| "download_apply_failed")
    }

    /// Whether nothing runs on a model download's target, as far as speech and conversion go:
    /// `japanese` and `multilingual` while TTS uses that server, `rvc` while a conversion is
    /// requested, pending or stopping.
    pub fn voice_target_idle(&self, target: &str) -> bool {
        let Some(voice) = self.voice() else { return true };
        match target {
            "rvc" => voice.direct_idle(),
            "japanese" | "multilingual" => {
                let status = voice.bus.status();
                let settings = voice.bus.settings();
                let in_use = status.tts_enabled && settings.uses_speechcpp(target) && Voice::role_server(&settings, target) == "bundled";
                !in_use || !self.speech_servers().is_running(profile(target))
            }
            _ => true,
        }
    }

    // ------------------------------------------------------------ the flow panel

    /// Begins a message's trace (`_beginIoTrace`): the microphone's and typed chat.
    /// The flow panel's trace of a message (`_beginIoTrace`). A realtime microphone final is
    /// timed from when it arrived (`received_ns`), with its wait before the message pipeline
    /// took it; a recorder's from the start of its recognition (`asr_ms`).
    pub(crate) fn io_trace_begin(
        &self,
        kind: &str,
        message: &str,
        id: Option<&str>,
        started_ns: i64,
        asr_ms: Option<u64>,
        received_ns: Option<i64>,
    ) -> Option<Arc<IoTrace>> {
        let voice = self.voice()?;
        let trace_id = id.map(str::to_owned).unwrap_or_else(uuid_text);
        match kind {
            "chat" => Some(voice.traces.begin(&trace_id, "chat", message, "send", started_ns)),
            "mic" => Some(match (received_ns.filter(|received| (1..=started_ns).contains(received)), asr_ms) {
                (Some(received), _) => {
                    let trace = voice.traces.begin(&trace_id, "voice", message, "final", received);
                    trace.stage("wait", Some((started_ns - received) as f64 / 1e6));
                    trace
                }
                (None, Some(asr)) => {
                    let trace = voice.traces.begin(&trace_id, "voice", message, "recognition", started_ns - (asr as i64) * 1_000_000);
                    trace.stage("recognition", Some(asr as f64));
                    trace
                }
                (None, None) => voice.traces.begin(&trace_id, "voice", message, "received", started_ns),
            }),
            _ => None,
        }
    }

    /// The chatbox's outcome on a trace: sent, superseded, or off.
    pub(crate) fn io_trace_chatbox(trace: Option<&Arc<IoTrace>>, sent: Option<bool>) {
        if let Some(trace) = trace {
            let state = match sent {
                Some(true) => "sent",
                Some(false) => "superseded",
                None => "off",
            };
            trace.output("chatbox", state, (state == "sent").then(vrct_tts::clock::monotonic_ns), &[]);
        }
    }

    /// Publishes a trace at the end of its message (`_publishIoTrace`).
    pub(crate) fn io_trace_publish(&self, trace: Option<Arc<IoTrace>>, translations: Option<&[String]>, translate_ms: u128, deliver_ms: u128, failures: &[Value]) {
        let (Some(trace), Some(voice)) = (trace, self.voice()) else { return };
        if let Some(translations) = translations {
            trace.stage("translate", Some(translate_ms as f64));
            trace.set_translation(translations.iter().find(|t| !t.is_empty()).map(String::as_str).unwrap_or(""));
        }
        trace.stage("deliver", Some(deliver_ms as f64));
        for failure in failures {
            let name = match failure["output"].as_str() {
                Some("osc") => "chatbox",
                Some("tts") => "speech",
                _ => continue,
            };
            trace.output(name, "failed", None, &[]);
        }
        voice.traces.publish(&trace);
    }

    fn io_flow(&self) -> Reply {
        let Some(voice) = self.voice() else { return ok(Value::Null) };
        let config = self.config();
        let tab = config.get_str("SELECTED_TAB_NO");
        let targets = config.get("SELECTED_TARGET_LANGUAGES")[&tab].clone();
        let enabled: Vec<Value> = targets.as_object().map(|slots| slots.values().filter(|row| row["enable"] == true).map(|row| row["language"].clone()).collect()).unwrap_or_default();
        let settings = voice.bus.settings();
        let selected = &targets[&settings.target_slot];
        let status = voice.bus.status();
        let direct = voice.direct.health();
        let realtime_requested = voice.realtime_mic.lock().unwrap().clone().is_some_and(|probe| probe());
        let realtime = !voice.windows || config.get("SELECTED_TRANSCRIPTION_ENGINE") == "SpeechCpp";
        let state = FlowState {
            mic_on: config.get_bool("ENABLE_TRANSCRIPTION_SEND") || realtime_requested,
            realtime,
            engine: config.get("SELECTED_TRANSCRIPTION_ENGINE"),
            translation: config.get_bool("ENABLE_TRANSLATION"),
            source_language: config.get("SELECTED_YOUR_LANGUAGES")[&tab]["1"]["language"].clone(),
            targets: enabled,
            speech_language: if selected["enable"] == true { selected["language"].clone() } else { Value::Null },
            send_to_vrc: config.get_bool("SEND_MESSAGE_TO_VRC"),
            only_translated: config.get_bool("SEND_ONLY_TRANSLATED_MESSAGES"),
            desktop: config.get_bool("OVERLAY_DESKTOP"),
            large_log: config.get_bool("OVERLAY_LARGE_LOG"),
            clipboard: config.get_bool("ENABLE_CLIPBOARD"),
            websocket: self.websocket_alive(),
            voice: settings.to_value(),
            tts_enabled: status.tts_enabled,
            muted: status.muted,
            direct_engine: if direct.mode == "converted" { voice.direct_engine.lock().unwrap().clone() } else { None },
            direct_mode: direct.mode.clone(),
            direct_active: direct.active,
            round_trip_ms: direct.round_trip_ms,
        };
        ok(flow::describe(&state))
    }

    // ------------------------------------------------------------ the end

    /// Stops speech, direct voice and the route at the end of the run (`Controller.shutdown`):
    /// before the speech servers close.
    pub(crate) fn close_voice(&self) {
        let Some(voice) = self.voice() else { return };
        if !voice.audition.close(Duration::from_secs(2)) {
            self.step("[voice] audition shutdown pending");
        }
        voice.runtimes.request_close();
        if !voice.runtimes.close(Duration::from_secs(2)) {
            self.step("[voice] runtime setup shutdown pending");
        }
        {
            let _settings = voice.settings_lock.lock().unwrap();
            voice.direct_closed.store(true, Ordering::SeqCst);
            voice.direct.stop();
        }
        // One gate operation in flight plus the final mute.
        if !voice.route.close(Duration::from_secs(10)) {
            self.step("[voice] shutdown mute unconfirmed; check the virtual microphone");
        }
        if !voice.direct.close(Duration::from_secs(3)) {
            self.step("[voice] input forwarding shutdown unconfirmed");
        }
        if !voice.bus.close(Duration::from_secs(5)) {
            self.step("shutdown: TTS did not stop within 5s");
        }
    }
}

fn uuid_text() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::fill(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..])
}

/// The end of a server run, as the speech server reports it: the run's listener is gone when
/// its child has exited or is being stopped.
struct RunEnd(vrct_tts::sync::Event);

impl ProcessExit for RunEnd {
    fn wait(&self) -> std::io::Result<()> {
        self.0.wait(None);
        Ok(())
    }
}

/// The TTS servers this app started, each with the monitor its requests subscribe to.
#[derive(Default)]
struct ServerOwners(Mutex<HashMap<Profile, (ListenerMonitor, vrct_tts::sync::Event)>>);

impl ServerOwners {
    /// A server of `profile` listens on `(port, pid)`, or no longer does (`None`).
    fn heard(&self, registry: &ListenerMonitors, profile: Profile, listener: Option<(u16, u32)>) {
        let mut owners = self.0.lock().unwrap();
        // A new run replaces an older one whose end was not told; that end is told now.
        if let Some((monitor, end)) = owners.remove(&profile) {
            end.set();
            registry.forget(&monitor);
        }
        if let Some((port, _pid)) = listener {
            let end = vrct_tts::sync::Event::new();
            let monitor = registry.own(("127.0.0.1".to_owned(), port), Arc::new(RunEnd(end.clone())));
            owners.insert(profile, (monitor, end));
        }
    }
}

fn with_voice(core: &Arc<Core>, handler: impl FnOnce(&Voice) -> Reply) -> Reply {
    match core.voice() {
        Some(voice) => handler(voice),
        None => Reply::status(500, "Internal error"),
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    let core = b.core;
    let voice = Voice::new(core);
    let _ = core.voice.set(voice.clone());

    // Speech of typed chat (and the microphone's finals through `publish_mic_voice`).
    let speaker = Arc::downgrade(&voice);
    core.set_message_hooks(None, Some(Arc::new(move |event: &SpokenMessage| speaker.upgrade().map_or(Ok(()), |voice| voice.spoken(event)))));
    // The flow panel reads whether the microphone's realtime recognition is requested.
    let realtime = Arc::downgrade(core);
    core.set_realtime_mic_probe(Arc::new(move || {
        realtime.upgrade().is_some_and(|core| core.realtime_requested(super::audio_devices::Source::Mic))
    }));
    // A request to a TTS server this app started ends when the server does, and its port is not
    // probed while it speaks (`listener_monitors.own` in [`runtime.py`]).
    //
    // [`runtime.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/speech_server/runtime.py
    let owners = ServerOwners::default();
    core.speech_servers().on_listener(Arc::new(move |profile, listener| owners.heard(vrct_tts::listener::listener_monitors(), profile, listener)));
    // A TTS server that ends turns TTS off.
    let ended = Arc::downgrade(core);
    core.speech_servers().on_end(Arc::new(move |end| {
        if let Some(core) = ended.upgrade()
            && let Some(voice) = core.voice().cloned()
        {
            voice.server_ended(&core, end);
        }
    }));
    // The virtual microphone check is refused while the voice is muted.
    let route = Arc::downgrade(&voice);
    core.audio_devices().set_voice_muted(Arc::new(move || route.upgrade().is_none_or(|voice| voice.route.status().requested_muted)));

    b.with("/set/data/voice_settings", OPEN, |core, data| with_voice(core, |voice| voice.set_settings(core, data)));
    b.with("/get/data/voice_status", OPEN, |core, _| with_voice(core, |voice| ok(voice.status())));
    b.with("/get/data/tts_model_options", OPEN, |core, data| with_voice(core, |voice| voice.model_options(core, data)));
    b.with("/get/data/tts_engine_voices", OPEN, |core, data| with_voice(core, |voice| voice.engine_voices(data)));
    b.with("/get/data/voice_output_devices", OPEN, |core, _| with_voice(core, |voice| voice.output_devices(core)));
    // The stop requests are answered as they arrive (`IMMEDIATE_ENDPOINTS`).
    b.with("/run/stop_voice", OPEN, |core, _| with_voice(core, |voice| voice.stop_voice(core)));
    b.with("/run/enable_tts", OPEN, |core, data| with_voice(core, |voice| voice.enable_tts(core, data)));
    b.with("/run/disable_tts", OPEN, |core, _| with_voice(core, |voice| voice.disable_tts(core)));
    b.with("/get/data/voice_route", OPEN, |core, _| with_voice(core, |voice| ok(voice.route_status())));
    b.with("/run/mute_voice", OPEN, |core, _| with_voice(core, |voice| voice.mute(core)));
    b.with("/run/resume_voice", OPEN, |core, _| with_voice(core, Voice::resume));
    b.with("/get/data/direct_voice_sources", OPEN, |core, _| with_voice(core, |voice| voice.sources(core)));
    b.with("/set/data/direct_voice_settings", OPEN, |core, data| with_voice(core, |voice| voice.set_direct_settings(core, data)));
    b.with("/get/data/direct_voice_state", OPEN, |core, _| with_voice(core, |voice| ok(voice.direct_state())));
    b.with("/get/data/io_flow", OPEN, |core, _| core.io_flow());
    b.with("/run/start_direct_voice", OPEN, |core, data| with_voice(core, |voice| voice.start_direct(data)));
    b.with("/run/stop_direct_voice", OPEN, |core, _| with_voice(core, Voice::stop_direct));
    // The voice audition of the TTS catalog (#415).
    b.with("/get/data/voice_audition_state", OPEN, |core, _| with_voice(core, |voice| ok(voice.audition.status())));
    b.with("/run/start_voice_audition", OPEN, |core, data| with_voice(core, |voice| voice.start_audition(core, data)));
    b.with("/run/stop_voice_audition", OPEN, |core, _| with_voice(core, Voice::stop_audition));

    // The RVC worker's runtime (decision 6 in core-integration.md): set up after consent.
    b.with("/get/data/vc_runtime_catalog", OPEN, |core, _| with_voice(core, |voice| ok(voice.runtimes.catalog())));
    b.with("/get/data/vc_runtime_state", OPEN, |core, _| with_voice(core, |voice| ok(voice.runtimes.state())));
    b.with("/run/start_vc_runtime_setup", OPEN, |core, data| {
        with_voice(core, |voice| match voice.runtimes.start(data) {
            Ok(state) => ok(state),
            Err(code) => refused(runtime_status(code), code),
        })
    });
    b.with("/run/cancel_vc_runtime_setup", OPEN, |core, data| {
        with_voice(core, |voice| {
            let shaped = data.as_object().filter(|o| o.len() == 2).and_then(|o| Some((o.get("id")?.as_str().filter(|s| !s.is_empty())?, o.get("job_id")?.as_str().filter(|s| !s.is_empty())?)));
            let Some((id, job)) = shaped else { return refused(400, "download_request_invalid") };
            match voice.runtimes.cancel(id, job) {
                Ok(state) => ok(state),
                Err(code) => refused(runtime_status(code), code),
            }
        })
    });
}

/// 409 for a conflict, 400 for the rest (`_vcRuntimeFailure`).
fn runtime_status(code: &str) -> u16 {
    if ["vc_runtime_busy", "vc_runtime_closed", "stale_job"].contains(&code) { 409 } else { 400 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vrct_tts::listener::{Address, Probe};
    use vrct_tts::sync::Event;

    /// A probe that must never run: an owned server's port is not probed.
    fn no_probe() -> Probe {
        Arc::new(|_: &Address, _: &Event| panic!("an owned server's port was probed"))
    }

    #[test]
    fn a_request_to_a_started_server_ends_with_its_run_and_never_probes() {
        // `test_tts_listener_monitor.py::test_owned_exit_interrupts_suspended_stream_without_connects`
        // and `test_runtime_registers_owner_before_standby_uses_synthesis`, at the hook the
        // speech server calls when its run listens and when it ends.
        let registry = ListenerMonitors::new();
        let owners = ServerOwners::default();
        let address: Address = ("127.0.0.1".into(), 4321);
        owners.heard(&registry, Profile::Japanese, Some((4321, 7)));
        let owner = registry.owned(&address).expect("the started server is owned");
        let tokens = [CancelToken::new(), CancelToken::new()];
        let watches: Vec<_> = tokens.iter().map(|token| registry.watch(&address, token, Event::new(), no_probe(), Some(owner.clone()))).collect();
        // The other profile's server is someone else's.
        owners.heard(&registry, Profile::Multilingual, Some((4322, 8)));
        owners.heard(&registry, Profile::Multilingual, None);
        assert!(!tokens[0].wait(Duration::from_millis(50)), "another server's end cancelled the request");
        assert!(registry.owned(&address).is_some());

        owners.heard(&registry, Profile::Japanese, None);
        for token in &tokens {
            assert!(token.wait(Duration::from_secs(2)), "the server's end did not reach the request");
            assert_eq!(token.reason(), "server_unavailable");
        }
        assert!(owner.join(Duration::from_secs(2)), "the run's waiter is left behind");
        assert!(registry.owned(&address).is_none() && registry.external_count() == 0);
        drop(watches);
    }

    #[test]
    fn a_new_run_on_the_same_port_belongs_to_its_own_process() {
        // `test_owned_exit_before_first_pcm_and_port_reuse_keep_process_identity`: a request
        // sent to the new run is not cancelled by the old run's end.
        let registry = ListenerMonitors::new();
        let owners = ServerOwners::default();
        let address: Address = ("127.0.0.1".into(), 4323);
        owners.heard(&registry, Profile::Japanese, Some((4323, 7)));
        let old = registry.owned(&address).unwrap();
        // A restart whose old end was not told: the old run ends as the new one listens.
        owners.heard(&registry, Profile::Japanese, Some((4323, 9)));
        assert!(old.join(Duration::from_secs(2)));
        let new = registry.owned(&address).expect("the new run is owned");
        let token = CancelToken::new();
        let _watch = registry.watch(&address, &token, Event::new(), no_probe(), Some(new.clone()));
        assert!(!token.wait(Duration::from_millis(50)), "the old run's end cancelled a request to the new one");
        owners.heard(&registry, Profile::Japanese, None);
        assert!(token.wait(Duration::from_secs(2)));
        assert!(new.join(Duration::from_secs(2)));
    }
}
