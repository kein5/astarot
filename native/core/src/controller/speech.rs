//! The bundled speech.cpp servers (`getSpeechServer*`, `startSpeechServer`,
//! `stopSpeechServer` and `_speechServerEnded` in [`src-python/controller.py`]).
//!
//! The processes themselves are owned by `vrct-speech-server`; this module keeps the hub, answers
//! the Settings page and tells the features that use a server when one ends. Saving or restoring
//! the settings never starts a server: only `/run/start_speech_server` (or a feature through
//! [`SpeechServers::hub`]) does.
//!
//! TTS and realtime ASR start and stop these servers and react to their end through
//! [`SpeechServers::on_end`], [`SpeechServers::on_listener`] (TTS: a request to a started
//! server ends with its run), [`SpeechServers::hub`] and [`SpeechServers::start_options`].
//!
//! [`src-python/controller.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/controller.py

use super::routes::{Builder, OPEN};
use super::{Core, ok};
use crate::config::Environment;
use crate::errors;
use crate::protocol::Reply;
use serde_json::{Map, Value, json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vrct_speech_server::server::{Binary, Hooks, Launch};
use vrct_speech_server::settings::{normalize_settings, start_options};
use vrct_speech_server::{Code, Profile, StartOptions, builds, codes, devices};

const SETTINGS_KEY: &str = "SPEECH_SERVER_SETTINGS";
const REQUEST_INVALID: &str = "speech_server_request_invalid";
const START_FAILED: &str = "speech_server_start_failed";
/// How long the shutdown waits for every owned server to end (`speech_servers.close(timeout=3)`).
const CLOSE_TIMEOUT: Duration = Duration::from_secs(3);

/// Where the bundled servers come from, checked against the pinned hashes at each start
/// ([`runtime.py`], `BUNDLE` and `bundled_binary`): the bundles among the app's shipped files
/// ([`crate::resources`]). Which build a start runs is [`vrct_speech_server::builds`].
///
/// [`runtime.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/speech_server/runtime.py
pub fn bundled_launch(env: &Environment) -> Launch {
    Launch::bundles(bundle_folders(env))
}

/// The folders of the bundled speech.cpp builds, for the servers and for the hardware probe:
/// `build/speechcpp` (the Vulkan build; Windows ships only this one) and, on Linux,
/// `build/speechcpp-cpu` (the CPU build). Each bundle's `bundle.json` says which build it is.
pub fn bundle_folders(env: &Environment) -> Vec<PathBuf> {
    BUNDLES.iter().map(|relative| crate::resources::locate(&env.app_dir, relative)).collect()
}

/// The bundle folders inside the shipped files, the Vulkan build first.
pub const BUNDLES: [&str; 2] = ["build/speechcpp", "build/speechcpp-cpu"];

/// A server ended. `run` names the start that ended (`None` when a Stop found none); `stopped`
/// is true when the user stopped it from Settings, false when it ended on its own. Each run's
/// end is told once, whichever came first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ended {
    pub profile: Profile,
    pub run: Option<u64>,
    pub stopped: bool,
}

pub type EndListener = Arc<dyn Fn(Ended) + Send + Sync>;
/// A speech (not recognition) server listens on `(port, pid)`, or no longer does (`None`).
pub type ListenerHook = Arc<dyn Fn(Profile, Option<(u16, u32)>) + Send + Sync>;

#[derive(Default)]
struct Subscribers {
    ended: Vec<EndListener>,
    listeners: Vec<ListenerHook>,
    /// The last run of each profile whose end was told.
    told: [Option<u64>; 3],
}

/// The servers of the app and who hears of them.
pub struct SpeechServers {
    hub: vrct_speech_server::SpeechServers,
    launch: Launch,
    environment: devices::Environment,
    subscribers: Arc<Mutex<Subscribers>>,
    /// The settings change under this lock, and so does a model file a download puts in them.
    settings_lock: Mutex<()>,
}

/// Tells the end of a run once. A stopped server ends twice in the hub, by the Stop and when its
/// child is gone, and a late end can come after a newer run's (Python's `_speechServerEnded`
/// skipped a run at or below the last one it handled).
fn tell_ended(subscribers: &Mutex<Subscribers>, ended: Ended) {
    let listeners = {
        let mut subscribers = subscribers.lock().unwrap();
        if let Some(run) = ended.run {
            let told = &mut subscribers.told[profile_index(ended.profile)];
            if told.is_some_and(|told| run <= told) {
                return;
            }
            *told = Some(run);
        }
        subscribers.ended.clone()
    };
    for listener in listeners {
        listener(ended);
    }
}

impl SpeechServers {
    pub(crate) fn new(launch: Launch) -> Self {
        let subscribers = Arc::new(Mutex::new(Subscribers::default()));
        let on_end = Arc::clone(&subscribers);
        let on_listener = Arc::clone(&subscribers);
        let hub = vrct_speech_server::SpeechServers::with_hooks(
            launch.clone(),
            Some(Box::new(move |profile, run| tell_ended(&on_end, Ended { profile, run: Some(run), stopped: false }))),
            Some(Box::new(move |profile| {
                let heard = Arc::clone(&on_listener);
                Hooks {
                    // A failure is reported as one fixed code; nothing the server printed.
                    on_failure: Some(Box::new(|code| errors::report_failure("speech_server", code))),
                    on_listener: Some(Box::new(move |listener| {
                        let hooks = heard.lock().unwrap().listeners.clone();
                        for hook in hooks {
                            hook(profile, listener);
                        }
                    })),
                    ..Hooks::default()
                }
            })),
        );
        let environment = launch.environment.clone();
        Self { hub, launch, environment, subscribers, settings_lock: Mutex::new(()) }
    }

    /// The hub, for a feature that starts or stops a server for its own use (the TTS toggle,
    /// realtime ASR) or binds to a ready one (`binding`, `current_run`).
    pub fn hub(&self) -> &vrct_speech_server::SpeechServers {
        &self.hub
    }

    /// Tells `listener` of every end: a Stop from Settings and a server that ended on its own
    /// (`_speechServerEnded`). TTS turns itself off and realtime ASR invalidates the captures
    /// that used the run that ended; a run that is not theirs is to be ignored.
    pub fn on_end(&self, listener: EndListener) {
        self.subscribers.lock().unwrap().ended.push(listener);
    }

    /// Tells `hook` where a speech server listens (the audio listener monitor of TTS).
    pub fn on_listener(&self, hook: ListenerHook) {
        self.subscribers.lock().unwrap().listeners.push(hook);
    }

    /// Whether the profile's server is preparing, ready or still stopping. A model file in its
    /// settings may not be replaced then (`model_target_busy`).
    pub fn is_running(&self, profile: Profile) -> bool {
        let state = &self.hub.state()[profile_index(profile)].1.health.state;
        !matches!(state, vrct_speech_server::State::Stopped | vrct_speech_server::State::Failed)
    }

    /// The options a start of `profile` would use, with its files checked.
    pub fn start_options(&self, core: &Core, profile: Profile) -> Result<StartOptions, Code> {
        start_options(&core.config().get(SETTINGS_KEY), profile)
    }

    /// Puts a downloaded model file into a profile's settings (`applyModelDownload`): refused
    /// with `model_target_busy` while its server runs, and with `settings_changed` when the
    /// field no longer holds `expected`.
    pub fn replace_model_file(
        &self,
        core: &Core,
        profile: Profile,
        field: &str,
        expected: &str,
        path: &str,
    ) -> Result<(), &'static str> {
        let _settings = self.settings_lock.lock().unwrap();
        if self.is_running(profile) {
            return Err("model_target_busy");
        }
        let mut settings = core.config().get(SETTINGS_KEY);
        let slot = &mut settings["profiles"][profile.name()][field];
        if slot.as_str() != Some(expected) {
            return Err("settings_changed");
        }
        *slot = json!(path);
        core.config().set(SETTINGS_KEY, settings).map(|_| ()).map_err(|_| codes::SETTINGS_INVALID)
    }

    /// The state of each profile, as the Settings page polls it.
    pub fn state(&self) -> Value {
        let mut result = Map::new();
        for (profile, state) in self.hub.state() {
            let health = &state.health;
            let mut row = Map::new();
            row.insert("state".into(), json!(health.state.name()));
            row.insert("base_url".into(), json!(health.base_url));
            row.insert("error_code".into(), json!(health.error_code));
            if let Some(standby) = &health.low_latency {
                row.insert(
                    "low_latency".into(),
                    json!({ "state": standby.state, "completed": standby.completed, "error_code": standby.error_code }),
                );
            }
            // Only when a start runs other than asked (the CPU build after the Vulkan build
            // did not start).
            if let Some(notice) = health.notice {
                row.insert("notice".into(), json!(notice));
            }
            row.insert("generation".into(), json!(state.generation));
            result.insert(profile.name().into(), Value::Object(row));
        }
        Value::Object(result)
    }

    /// The GPUs the bundled speech.cpp lists, without starting a model (`list_gpus`), and what
    /// the CPU choice runs on. No GPU when the bundle is missing or fails its check.
    ///
    /// `devices` keeps Python's rows. The CPU is a choice of its own on every platform, so it is
    /// not a row: `cpu_build` says what runs it (`separate`: the CPU build, Linux; `shared`: the
    /// one Vulkan build with `--device cpu`, Windows; `missing`), and `gpu_build` whether the
    /// GPU choices can start (`ready`; `unavailable`: the Vulkan build is bundled and does not
    /// start on this PC, e.g. without `libvulkan.so.1`; `missing`).
    pub fn devices(&self) -> Value {
        let survey = match &self.launch.binary {
            Binary::Bundled(_) => builds::survey(&self.launch.builds(), &self.environment),
            Binary::Fixed(binary) => {
                let listed = devices::list_gpus_checked(binary, &self.environment);
                let gpu_build = if listed.is_some() { "ready" } else { "unavailable" };
                builds::Survey { gpus: listed.unwrap_or_default(), gpu_build, cpu_build: "shared" }
            }
        };
        let rows: Vec<Value> =
            survey.gpus.into_iter().map(|gpu| json!({ "name": gpu.name, "kind": gpu.kind, "label": gpu.label })).collect();
        json!({ "devices": rows, "cpu_build": survey.cpu_build, "gpu_build": survey.gpu_build })
    }

    /// The builds the GPU check runs and the environment they start with: the checked bundles,
    /// or a fixed executable (tests) as the one build.
    pub(crate) fn check_builds(&self) -> (builds::Builds, devices::Environment) {
        let builds = match &self.launch.binary {
            Binary::Bundled(_) => self.launch.builds(),
            Binary::Fixed(binary) => builds::Builds { vulkan: Some(binary.clone()), cpu: None },
        };
        (builds, self.environment.clone())
    }

    fn stop(&self, profile: Profile) {
        // Not joined: the answer goes out at once, and the end is told to the listeners now,
        // with the run this Stop ended.
        let subscribers = &self.subscribers;
        self.hub.stop(
            profile,
            None,
            Some(&|profile, run| tell_ended(subscribers, Ended { profile, run, stopped: true })),
        );
    }

    /// Stops every server and refuses new starts. False when an end could not be confirmed.
    pub(crate) fn close(&self) -> bool {
        self.hub.close(CLOSE_TIMEOUT)
    }
}

fn profile_index(profile: Profile) -> usize {
    Profile::ALL.iter().position(|listed| *listed == profile).expect("every profile is listed")
}

/// A 400 or 409 answer with only a code, as Python answered these endpoints.
fn refused(status: u16, code: &str) -> Reply {
    Reply::status(status, json!({ "error_code": code }))
}

/// `{"profile": ...}`, with `"generation"` for a start (`_speechRequest`).
fn request(data: &Value, start: bool) -> Result<Profile, &'static str> {
    let object = data.as_object().ok_or(REQUEST_INVALID)?;
    let keys: &[&str] = if start { &["profile", "generation"] } else { &["profile"] };
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(REQUEST_INVALID);
    }
    let profile = object["profile"].as_str().and_then(|name| Profile::from_name(name).ok()).ok_or(REQUEST_INVALID)?;
    // A whole number of zero or more; `true` and `1.0` are other types.
    if start && !object["generation"].is_u64() {
        return Err(REQUEST_INVALID);
    }
    Ok(profile)
}

impl Core {
    /// The speech.cpp servers and the hooks of the features that use them.
    pub fn speech_servers(&self) -> &SpeechServers {
        &self.speech
    }

    /// Closes the owned servers at the end of the run (`Controller.shutdown`).
    pub(crate) fn close_speech_servers(&self) {
        if !self.speech.close() {
            self.step("[speech] owned server shutdown unconfirmed");
        }
    }
}

fn get_settings(core: &Core) -> Reply {
    ok(core.config().get(SETTINGS_KEY))
}

fn set_settings(core: &Core, data: &Value) -> Reply {
    let Ok(settings) = normalize_settings(data) else {
        return refused(400, codes::SETTINGS_INVALID);
    };
    let vad = core.vad_available();
    {
        let _settings = core.speech.settings_lock.lock().unwrap();
        if core.config().set(SETTINGS_KEY, settings.to_json()).is_err() {
            return refused(400, codes::SETTINGS_INVALID);
        }
    }
    core.vad_available_since(vad);
    get_settings(core)
}

fn start(core: &Core, data: &Value) -> Reply {
    let profile = match request(data, true) {
        Ok(profile) => profile,
        Err(code) => return refused(400, code),
    };
    // The files are checked before the hub is asked; the hub checks the generation after it,
    // so a Stop that came meanwhile is not undone.
    let options = match core.speech.start_options(core, profile) {
        Ok(options) => options,
        Err(code) => return refused(400, code),
    };
    let generation = data["generation"].as_u64().expect("checked above");
    if let Err(code) = core.speech.hub.start(profile, options, generation) {
        let code = if [codes::CLOSED, codes::STALE_START, codes::BUSY].contains(&code) { code } else { START_FAILED };
        return refused(409, code);
    }
    ok(core.speech.state())
}

fn stop(core: &Core, data: &Value) -> Reply {
    let Ok(profile) = request(data, false) else {
        return refused(400, REQUEST_INVALID);
    };
    core.speech.stop(profile);
    ok(core.speech.state())
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/get/data/speech_server_settings", OPEN, |core, _| get_settings(core));
    b.with("/set/data/speech_server_settings", OPEN, |core, data| set_settings(core, data));
    b.with("/get/data/speech_server_devices", OPEN, |core, _| ok(core.speech.devices()));
    b.with("/get/data/speech_server_state", OPEN, |core, _| ok(core.speech.state()));
    b.with("/run/start_speech_server", OPEN, |core, data| start(core, data));
    // Answered as it arrives (`IMMEDIATE_ENDPOINTS`): it never waits behind a busy worker.
    b.with("/run/stop_speech_server", OPEN, |core, data| stop(core, data));
}
