//! Realtime recognition on speech.cpp (#288): its settings, endpoints, models, state, start and
//! stop, and the main switches where they run it (Linux always, Windows with the local engine).
//!
//! Port of the realtime parts of `src-python/controller.py` (`_initRealtimeASR` to
//! `_startRealtime`). The session, its transport and the delivery of captions are in
//! `vrct_transcription::realtime`. Captions go to the UI as `/run/realtime_caption` and to the
//! VR large log; finals go through the message pipeline (`REALTIME_MIC`, `REALTIME_SPEAKER`).

use super::audio_devices::Source;
use super::messages::{REALTIME_MIC, REALTIME_SPEAKER};
use super::routes::{Builder, OPEN};
use super::transcription::{direction, flags, index};
use super::{Core, ok};
use crate::errors::ErrorReply;
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vrct_audio_routing::graph::{Endpoint, SourceId};
use vrct_speech_server::Profile;
use vrct_transcription::realtime::{Admission, Delivery, Options, Session, Update};
use vrct_transcription::speechcpp;

const SETTINGS_KEY: &str = "REALTIME_ASR_SETTINGS";
/// A started server enforces its own start timeout; this only bounds a switch's wait.
const ASR_SERVER_WAIT: Duration = Duration::from_secs(120 + 5);
const ASR_START_FAILURES: [&str; 4] =
    ["speech_server_out_of_memory", "speech_server_start_timeout", "speech_server_vulkan_missing", "speech_server_device_failed"];

#[derive(Clone)]
struct Owner {
    id: u64,
    session: Session,
    delivery: Delivery,
}

struct State {
    settings: Value,
    generation: [u64; 2],
    requested: [bool; 2],
    owners: [Option<Owner>; 2],
    server_runs: [Option<(u64, u64)>; 2],
    errors: [Option<String>; 2],
    closed: bool,
    /// Stopped while Settings is open (`_realtime_settings_paused`).
    paused: [bool; 2],
    /// Not to resume when Settings closes (`_realtime_resume_refused`).
    refused: [bool; 2],
}

#[derive(Default)]
struct Toggle {
    shown: [bool; 2],
    /// The run of the bundled ASR server a switch started.
    asr_owned: Option<u64>,
    starting: usize,
}

pub(crate) struct Realtime {
    state: Mutex<State>,
    settings_lock: Mutex<()>,
    toggle: Mutex<Toggle>,
    owners: AtomicU64,
}

impl Realtime {
    pub(crate) fn new(config: &crate::config::Config) -> Realtime {
        let settings = crate::voice_settings::normalize_realtime(&config.get(SETTINGS_KEY))
            .unwrap_or_else(|_| crate::voice_settings::normalize_realtime(&json!({})).unwrap_or_default());
        Realtime {
            state: Mutex::new(State {
                settings,
                generation: [0; 2],
                requested: [false; 2],
                owners: [None, None],
                server_runs: [None; 2],
                errors: [None, None],
                closed: false,
                paused: [false; 2],
                refused: [false; 2],
            }),
            settings_lock: Mutex::new(()),
            toggle: Mutex::new(Toggle::default()),
            owners: AtomicU64::new(0),
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn toggle(&self) -> std::sync::MutexGuard<'_, Toggle> {
        self.toggle.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn source_of(data: &Value) -> Result<Source, ()> {
    match data.get("source").and_then(Value::as_str) {
        Some("mic") if data.is_object() => Ok(Source::Mic),
        Some("speaker") if data.is_object() => Ok(Source::Speaker),
        _ => Err(()),
    }
}

fn refused(status: u16, code: &str) -> Reply {
    Reply::status(status, json!({ "error_code": code }))
}

/// The pipeline spec of a source.
fn spec(source: Source) -> &'static super::messages::Spec {
    match source {
        Source::Mic => &REALTIME_MIC,
        Source::Speaker => &REALTIME_SPEAKER,
    }
}

/// An endpoint of the settings (`parse_endpoint`), already normalized.
fn endpoint_of(value: &Value) -> Option<Endpoint> {
    Some(Endpoint {
        cookie: value["cookie"].as_str()?.parse().ok()?,
        serial: value["serial"].as_str()?.parse().ok()?,
        name: value["name"].as_str()?.to_string(),
        media_class: value["media_class"].as_str()?.to_string(),
    })
}

/// `realtime_endpoint`: the pinned endpoint, `Ok(None)` to resolve the system default.
fn pinned_endpoint(settings: &Value, source: Source) -> Result<Option<Endpoint>, &'static str> {
    let row = &settings[source.as_str()];
    if row["endpoint"].is_null() {
        if row["follow_default"] == false {
            return Err("realtime_endpoint_required");
        }
        return Ok(None);
    }
    endpoint_of(&row["endpoint"]).map(Some).ok_or("realtime_endpoint_invalid")
}

/// `session_options` without the endpoint: a session needs a saved model id.
fn session_options(settings: &Value, source: Source) -> Result<Options, &'static str> {
    let model = settings["model"].as_str().unwrap_or("");
    if model.trim().is_empty() {
        return Err("realtime_model_invalid");
    }
    Ok(Options {
        base_url: settings["base_url"].as_str().unwrap_or("").to_string(),
        model: model.to_string(),
        language: settings[source.as_str()]["language"].as_str().unwrap_or("auto").to_string(),
        vocabulary: speechcpp::merged_terms(&settings["vocabulary"]),
    })
}

impl Core {
    fn realtime(&self) -> &Realtime {
        &self.transcription().realtime
    }

    /// `_realtimeLanguage`: the language name of a speech.cpp code (Google's column first).
    fn realtime_language(code: &str) -> Option<String> {
        for engine in ["Google", "Whisper"] {
            for (name, countries) in crate::languages::transcription() {
                let found = countries.as_object().into_iter().flat_map(|c| c.values()).any(|row| {
                    row[engine].as_str().is_some_and(|value| value.eq_ignore_ascii_case(code))
                });
                if found {
                    return Some(name.clone());
                }
            }
        }
        None
    }

    /// `_realtimeFallbackLanguage`: the language the settings have for this side.
    fn realtime_fallback_language(&self, source: Source) -> Option<String> {
        let config = self.config();
        let key = if source == Source::Mic { "SELECTED_YOUR_LANGUAGES" } else { "SELECTED_TARGET_LANGUAGES" };
        config.get(key)[config.get_str("SELECTED_TAB_NO")]["1"]["language"].as_str().map(str::to_string)
    }

    fn realtime_active(state: &State, source: Source) -> bool {
        let i = index(source);
        let owner_state = state.owners[i].as_ref().map_or("idle", |owner| owner.session.state());
        state.requested[i] && !matches!(owner_state, "closed" | "failed" | "stopping")
    }

    pub(crate) fn realtime_requested(&self, source: Source) -> bool {
        self.realtime().state().requested[index(source)]
    }

    /// Whether a source listens on the bundled server (a download may not replace its model).
    pub(crate) fn realtime_uses_bundled_server(&self) -> bool {
        let state = self.realtime().state();
        state.settings["server"] == "bundled" && state.requested.iter().any(|r| *r)
    }

    /// `_invalidateRealtimeLocked`.
    fn invalidate_locked(&self, state: &mut State, source: Source) {
        let i = index(source);
        state.generation[i] += 1;
        state.requested[i] = false;
        state.server_runs[i] = None;
        if source == Source::Mic {
            self.cancel_mic_voice();
        }
        if let Some(owner) = &state.owners[i] {
            owner.delivery.request_stop();
        }
    }

    /// `getRealtimeASRState`.
    fn realtime_state(&self) -> Value {
        let state = self.realtime().state();
        let mut result = serde_json::Map::new();
        for source in [Source::Mic, Source::Speaker] {
            let i = index(source);
            let mut health = match &state.owners[i] {
                Some(owner) => owner.session.health(),
                None => json!({ "source": source.as_str(), "state": "idle", "namespace": null, "error_code": null }),
            };
            let terminal = matches!(health["state"].as_str(), Some("closed" | "failed" | "stopping"));
            health["generation"] = json!(state.generation[i]);
            health["requested"] = json!(state.requested[i] && !terminal);
            let error = state.errors[i].clone().map(Value::String).unwrap_or_else(|| health["error_code"].clone());
            health["error_code"] = error;
            result.insert(source.as_str().into(), health);
        }
        Value::Object(result)
    }

    /// Stamps a request before it waits in the queue, so that a fast stop also cancels its
    /// preparation (`mainloop.py`).
    pub(crate) fn stamp_realtime(&self, endpoint: &str, data: &mut Value) {
        let source = match endpoint {
            "/set/enable/transcription_send" => Some(Source::Mic),
            "/set/enable/transcription_receive" => Some(Source::Speaker),
            "/run/start_realtime_asr" => {
                if !data.is_object() {
                    return;
                }
                let generation = source_of(data).ok().map(|s| self.realtime().state().generation[index(s)]);
                data["_realtime_generation"] = json!(generation);
                return;
            }
            _ => None,
        };
        let Some(source) = source else { return };
        if !data.is_object() {
            *data = json!({});
        }
        data["_realtime_generation"] = json!(self.realtime().state().generation[index(source)]);
    }

    fn get_realtime_settings(&self) -> Reply {
        ok(self.realtime().state().settings.clone())
    }

    /// `setRealtimeASRSettings`.
    fn set_realtime_settings(self: &Arc<Self>, data: &Value) -> Reply {
        let Ok(settings) = crate::voice_settings::normalize_realtime(data) else {
            return refused(400, "realtime_settings_invalid");
        };
        {
            let _settings = self.realtime().settings_lock.lock().unwrap_or_else(|e| e.into_inner());
            {
                let mut state = self.realtime().state();
                let old = state.settings.clone();
                let shared = ["server", "base_url", "model", "vocabulary"].iter().any(|key| settings[*key] != old[*key]);
                for source in [Source::Mic, Source::Speaker] {
                    if shared || settings[source.as_str()] != old[source.as_str()] {
                        self.invalidate_locked(&mut state, source);
                    }
                }
                state.settings = settings.clone();
            }
            let _ = self.config().set(SETTINGS_KEY, settings);
        }
        for source in [Source::Mic, Source::Speaker] {
            self.publish_realtime_toggle(source, None);
        }
        self.get_realtime_settings()
    }

    /// `getRealtimeASREndpoints`.
    fn realtime_endpoints(&self, data: &Value) -> Reply {
        let Ok(source) = source_of(data) else { return refused(400, "realtime_source_invalid") };
        let platform = (self.services().transcription_capture)(self.config().environment());
        match platform.endpoints(source) {
            Ok(rows) => {
                let rows: Vec<Value> = rows
                    .iter()
                    .map(|(endpoint, label)| json!({ "endpoint": SourceId::from(endpoint).to_json(), "label": label }))
                    .collect();
                ok(json!({ "source": source.as_str(), "endpoints": rows, "error_code": null }))
            }
            Err(code) if code == "realtime_platform_unsupported" => {
                ok(json!({ "source": source.as_str(), "endpoints": [], "error_code": code }))
            }
            Err(_) => ok(json!({ "source": source.as_str(), "endpoints": [], "error_code": "realtime_graph_unavailable" })),
        }
    }

    /// `getRealtimeASRModels`.
    fn realtime_models(&self) -> Reply {
        let settings = self.realtime().state().settings.clone();
        let mut result = json!({
            "server": settings["server"],
            "configured_url": settings["base_url"],
            "base_url": settings["base_url"],
            "server_generation": null,
            "models": [],
            "error_code": null,
        });
        if settings["server"] == "bundled" {
            result["server_generation"] = self.speech_servers().state()["asr"]["generation"].clone();
            match self.speech_servers().hub().binding(Profile::Asr) {
                Ok(url) => result["base_url"] = json!(url),
                Err(_) => {
                    result["base_url"] = Value::Null;
                    result["error_code"] = json!("speech_server_not_ready");
                    return ok(result);
                }
            }
        }
        let base = result["base_url"].as_str().and_then(speechcpp::local_url);
        let models = base.and_then(|base| {
            speechcpp::survey(&self.services().translation_transport, &base, Duration::from_secs(5)).ok()
        });
        match models {
            Some((models, _)) => result["models"] = Value::Array(models.iter().map(speechcpp::Model::to_json).collect()),
            None => result["error_code"] = json!("realtime_models_unavailable"),
        }
        ok(result)
    }

    /// `stopRealtimeASR`.
    fn stop_realtime(self: &Arc<Self>, data: &Value) -> Reply {
        let Ok(source) = source_of(data) else { return refused(400, "realtime_source_invalid") };
        self.invalidate_locked(&mut self.realtime().state(), source);
        self.publish_realtime_toggle(source, None);
        ok(self.realtime_state())
    }

    /// The recorder takes the source over (`stopRealtimeASR` from `_start*Locked`).
    pub(crate) fn stop_realtime_for_recorder(self: &Arc<Self>, source: Source) {
        self.invalidate_locked(&mut self.realtime().state(), source);
        self.publish_realtime_toggle(source, None);
    }

    /// `_drainRealtimeASR`: waits for the previous session of a source to end.
    pub(crate) fn drain_realtime(&self, source: Source) -> bool {
        let owner = self.realtime().state().owners[index(source)].clone();
        let Some(owner) = owner else { return true };
        let deadline = Instant::now() + Duration::from_secs(3);
        let session_done = owner.session.close(Duration::from_secs(3));
        let delivery_done = owner.delivery.close(deadline.saturating_duration_since(Instant::now()));
        if session_done && delivery_done {
            let mut state = self.realtime().state();
            if state.owners[index(source)].as_ref().is_some_and(|o| o.id == owner.id) {
                state.owners[index(source)] = None;
            }
            return true;
        }
        false
    }

    /// `_closeRealtimeASR`.
    pub(crate) fn close_realtime(&self) -> bool {
        {
            let mut state = self.realtime().state();
            state.closed = true;
            for source in [Source::Mic, Source::Speaker] {
                self.invalidate_locked(&mut state, source);
            }
        }
        let mic = self.drain_realtime(Source::Mic);
        let speaker = self.drain_realtime(Source::Speaker);
        mic && speaker
    }

    /// `_noteRealtimePause`.
    pub(crate) fn note_realtime_pause(&self, source: Source, data: &Value) {
        let paused = data.get("reason").and_then(Value::as_str) == Some("settings_pause");
        let mut state = self.realtime().state();
        state.paused[index(source)] = paused;
        state.refused[index(source)] = false;
    }

    /// `_refuseResumeAfterAsrStop`: Settings stopped the bundled server; closing Settings
    /// does not start it again.
    fn refuse_resume_after_asr_stop(&self) {
        let mut state = self.realtime().state();
        if state.settings["server"] != "bundled" {
            return;
        }
        for i in 0..2 {
            state.refused[i] |= state.paused[i];
        }
    }

    /// `_publishRealtimeToggle`: shows the realtime state on the main switch; `reason` says why
    /// a session stopped that nobody asked to stop.
    pub(crate) fn publish_realtime_toggle(&self, source: Source, reason: Option<String>) {
        let i = index(source);
        if !self.realtime_toggles() && !self.realtime().toggle().shown[i] {
            return;
        }
        let dir = direction(source);
        {
            let mut toggle = self.realtime().toggle();
            let active = Self::realtime_active(&self.realtime().state(), source);
            if active != toggle.shown[i] {
                toggle.shown[i] = active;
                match reason.filter(|_| !active) {
                    Some(reason) => self.notify_error(&format!("/set/enable/transcription_{dir}"), not_ready(source, &reason)),
                    None => {
                        let state = if active { "enable" } else { "disable" };
                        self.run(200, &format!("/set/{state}/transcription_{dir}"), json!(active));
                    }
                }
            }
        }
        self.release_asr_server();
    }

    /// `_realtimeEnded`: a session's delivery stopped; if it was still wanted, it failed.
    fn realtime_ended(self: &Arc<Self>, source: Source, generation: u64) {
        if !self.realtime_toggles() {
            return;
        }
        let i = index(source);
        let (wanted, code) = {
            let state = self.realtime().state();
            let wanted = state.generation[i] == generation && state.requested[i];
            let code = state.errors[i].clone().or_else(|| state.owners[i].as_ref().and_then(|o| o.session.error()));
            (wanted, code)
        };
        if wanted {
            self.transcription().revoke(source);
        }
        self.publish_realtime_toggle(source, wanted.then(|| code.unwrap_or_else(|| "realtime_session_failed".into())));
    }

    /// `_releaseAsrServer`: stops a bundled ASR server a switch started once neither uses it.
    fn release_asr_server(&self) {
        let mut toggle = self.realtime().toggle();
        let Some(owned) = toggle.asr_owned else { return };
        if toggle.starting > 0 {
            return;
        }
        {
            let state = self.realtime().state();
            if [Source::Mic, Source::Speaker].iter().any(|s| Self::realtime_active(&state, *s)) {
                return;
            }
        }
        toggle.asr_owned = None;
        self.speech_servers().hub().stop(Profile::Asr, Some(owned), None);
    }

    fn realtime_start_current(&self, source: Source, expected: u64) -> bool {
        let state = self.realtime().state();
        !state.closed && state.generation[index(source)] == expected
    }

    /// `_awaitAsrServer`: starts the bundled server when allowed and waits until it is ready.
    fn await_asr_server(&self, source: Source, expected: u64, start: bool) -> Option<String> {
        if !self.realtime_start_current(source, expected) {
            return Some("realtime_stale_start".into());
        }
        let row = self.speech_servers().state()["asr"].clone();
        if row["state"] == "stopping" {
            return Some("speech_server_busy".into());
        }
        let mut run = row["generation"].as_u64().unwrap_or(0);
        let up = matches!(row["state"].as_str(), Some("ready" | "preparing"));
        if !up && !start {
            return Some("speech_server_autostart_off".into());
        }
        if !up {
            let profile = &self.config().get("SPEECH_SERVER_SETTINGS")["profiles"]["asr"];
            if profile["model"].as_str().unwrap_or("").trim().is_empty() {
                return Some("realtime_asr_model_missing".into());
            }
            if profile["vad_model"].as_str().unwrap_or("").trim().is_empty() {
                return Some("realtime_vad_model_missing".into());
            }
            let Ok(options) = self.speech_servers().start_options(self, Profile::Asr) else {
                return Some("speech_server_model_invalid".into());
            };
            let mut toggle = self.realtime().toggle();
            if let Err(code) = self.speech_servers().hub().start(Profile::Asr, options, run) {
                return Some(if code == vrct_speech_server::codes::BUSY { "speech_server_busy" } else { "speech_server_start_failed" }.into());
            }
            run += 1;
            toggle.asr_owned = Some(run);
        }
        let deadline = Instant::now() + ASR_SERVER_WAIT;
        loop {
            if !self.realtime_start_current(source, expected) {
                return Some("realtime_stale_start".into());
            }
            let row = self.speech_servers().state()["asr"].clone();
            if row["state"] == "failed" {
                let code = row["error_code"].as_str().unwrap_or("");
                return Some(if ASR_START_FAILURES.contains(&code) { code } else { "speech_server_start_failed" }.into());
            }
            if row["generation"].as_u64() != Some(run) || matches!(row["state"].as_str(), Some("stopped" | "stopping")) {
                return Some("speech_server_not_ready".into());
            }
            if row["state"] == "ready" {
                return None;
            }
            if Instant::now() >= deadline {
                return Some("speech_server_start_timeout".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// `_prepareRealtimeToggle`: checks a switch ON against the settings and the server.
    fn prepare_realtime_toggle(&self, source: Source, expected: u64) -> Result<Options, String> {
        let settings = {
            let state = self.realtime().state();
            if state.closed || state.generation[index(source)] != expected {
                return Err("realtime_stale_start".into());
            }
            state.settings.clone()
        };
        let platform = (self.services().transcription_capture)(self.config().environment());
        // Fail before loading a model for a missing device.
        let endpoint = match pinned_endpoint(&settings, source) {
            Ok(Some(endpoint)) => endpoint,
            Ok(None) => platform.default_endpoint(source)?,
            Err(code) => return Err(code.into()),
        };
        if self.carries_own_voice(&endpoint.name) {
            return Err("realtime_endpoint_feedback".into());
        }
        if !self.realtime_start_current(source, expected) {
            return Err("realtime_stale_start".into());
        }
        let base_url = if settings["server"] == "bundled" {
            if let Some(code) = self.await_asr_server(source, expected, settings["start_server"] != false) {
                return Err(code);
            }
            self.speech_servers().hub().binding(Profile::Asr).map_err(|_| "speech_server_not_ready".to_string())?
        } else {
            settings["base_url"].as_str().unwrap_or("").to_string()
        };
        if !self.realtime_start_current(source, expected) {
            return Err("realtime_stale_start".into());
        }
        let models = speechcpp::local_url(&base_url)
            .and_then(|base| speechcpp::survey(&self.services().translation_transport, &base, Duration::from_secs(5)).ok())
            .map(|(models, _)| models)
            .ok_or("realtime_models_unavailable")?;
        if !self.realtime_start_current(source, expected) {
            return Err("realtime_stale_start".into());
        }
        let wanted = settings["model"].as_str().unwrap_or("");
        let mut chosen = models.iter().find(|m| m.id == wanted).cloned();
        if chosen.is_none() && settings["server"] == "bundled" && models.len() == 1 {
            // The bundled server loads exactly one recognizer.
            chosen = models.first().cloned();
        }
        let Some(chosen) = chosen else {
            return Err(if wanted.is_empty() { "realtime_model_required" } else { "realtime_model_unavailable" }.into());
        };
        let language = settings[source.as_str()]["language"].as_str().unwrap_or("auto").to_string();
        if !speechcpp::language_supported(&chosen, &language) {
            return Err(if language == "auto" { "realtime_language_auto_unsupported" } else { "realtime_language_unsupported" }.into());
        }
        Ok(Options { base_url, model: chosen.id, language, vocabulary: speechcpp::merged_terms(&settings["vocabulary"]) })
    }

    /// `_enableRealtimeToggle`.
    pub(crate) fn enable_realtime_toggle(self: &Arc<Self>, source: Source, data: &Value) -> Reply {
        let i = index(source);
        let refused_resume = {
            let mut state = self.realtime().state();
            let resume = data.get("reason").and_then(Value::as_str) == Some("settings_resume");
            let refused = resume && state.refused[i];
            state.paused[i] = false;
            state.refused[i] = false;
            refused
        };
        if refused_resume {
            self.publish_realtime_toggle(source, None);
            return ok(json!(false));
        }
        let (expected, active) = {
            let state = self.realtime().state();
            let expected = match data.get("_realtime_generation") {
                None => state.generation[i],
                Some(value) => match value.as_u64() {
                    Some(generation) => generation,
                    None => return Reply::error(not_ready(source, "realtime_start_invalid")),
                },
            };
            if state.closed || expected != state.generation[i] {
                return Reply::error(not_ready(source, "realtime_stale_start"));
            }
            (expected, Self::realtime_active(&state, source))
        };
        if !active {
            self.realtime().toggle().starting += 1;
            let code = match self.prepare_realtime_toggle(source, expected) {
                Ok(options) => self.start_realtime_session(source, expected, Some(options)).err(),
                Err(code) => Some(code),
            };
            self.realtime().toggle().starting -= 1;
            self.release_asr_server();
            if let Some(code) = code {
                self.publish_realtime_toggle(source, None);
                return Reply::error(not_ready(source, &code));
            }
        }
        let (active, code) = {
            let state = self.realtime().state();
            let code = state.errors[i].clone().or_else(|| state.owners[i].as_ref().and_then(|o| o.session.error()));
            (Self::realtime_active(&state, source), code)
        };
        self.publish_realtime_toggle(source, None);
        if active {
            ok(json!(true))
        } else {
            Reply::error(not_ready(source, &code.unwrap_or_else(|| "realtime_session_failed".into())))
        }
    }

    /// `_disableRealtimeToggle`.
    pub(crate) fn disable_realtime_toggle(self: &Arc<Self>, source: Source) -> Reply {
        self.invalidate_locked(&mut self.realtime().state(), source);
        self.publish_realtime_toggle(source, None);
        ok(json!(false))
    }

    /// `startRealtimeASR`.
    fn start_realtime(self: &Arc<Self>, data: &Value) -> Reply {
        let Ok(source) = source_of(data) else { return refused(400, "realtime_start_invalid") };
        let Some(expected) = data.get("_realtime_generation").and_then(Value::as_u64) else {
            return refused(400, "realtime_start_invalid");
        };
        let result = match self.start_realtime_session(source, expected, None) {
            Ok(()) => ok(self.realtime_state()),
            Err(code) => refused(if is_bad_request(&code) { 400 } else { 409 }, &code),
        };
        self.publish_realtime_toggle(source, None);
        result
    }

    /// `_startRealtime`: `Err` is the code of the 409 (or 400) answer.
    fn start_realtime_session(self: &Arc<Self>, source: Source, expected: u64, prepared: Option<Options>) -> Result<(), String> {
        let i = index(source);
        let lifecycle = self.audio_devices().lock_source(source);
        let precheck = |state: &State| -> Result<(), String> {
            if state.closed || expected != state.generation[i] {
                return Err("realtime_stale_start".into());
            }
            if state.requested[i] && state.owners[i].as_ref().is_none_or(|o| !matches!(o.session.state(), "closed" | "failed")) {
                return Err("realtime_already_started".into());
            }
            Ok(())
        };
        let follow = {
            let state = self.realtime().state();
            precheck(&state)?;
            let row = &state.settings[source.as_str()];
            row["endpoint"].is_null() && row["follow_default"] != false
        };
        let platform = (self.services().transcription_capture)(self.config().environment());
        let default = if follow { Some(platform.default_endpoint(source)?) } else { None };
        let (generation, options, endpoint, detect, language) = {
            let mut state = self.realtime().state();
            precheck(&state)?;
            let endpoint = match pinned_endpoint(&state.settings, source) {
                Ok(Some(endpoint)) => endpoint,
                Ok(None) => default.clone().ok_or("realtime_endpoint_required")?,
                Err(code) => return Err(code.into()),
            };
            if self.carries_own_voice(&endpoint.name) {
                return Err("realtime_endpoint_feedback".into());
            }
            let mut options = match prepared {
                Some(options) => options,
                None => session_options(&state.settings, source)?,
            };
            let mut server_run = None;
            if state.settings["server"] == "bundled" {
                let hub = self.speech_servers().hub();
                server_run = hub.current_run(Profile::Asr);
                options.base_url = hub.binding(Profile::Asr).map_err(|_| "speech_server_not_ready".to_string())?;
                if server_run.is_none() || hub.current_run(Profile::Asr) != server_run {
                    return Err("speech_server_not_ready".into());
                }
            }
            if speechcpp::local_url(&options.base_url).is_none() {
                return Err("realtime_base_url_invalid".into());
            }
            let detect = options.language == "auto";
            let language = if detect {
                self.realtime_fallback_language(source)
            } else {
                Some(Self::realtime_language(&options.language).ok_or("realtime_translation_language_unsupported")?)
            };
            if source == Source::Mic {
                // A terminal owner's clean-up may run after this ownership advance: its speech
                // goes before it turns stale.
                self.cancel_mic_voice();
            }
            state.generation[i] += 1;
            let generation = state.generation[i];
            state.requested[i] = true;
            state.server_runs[i] = server_run.map(|run| (generation, run));
            state.errors[i] = None;
            (generation, options, endpoint, detect, language)
        };
        let fail_start = |code: &str| -> String {
            let mut state = self.realtime().state();
            if state.generation[i] == generation {
                self.transcription().revoke(source);
                self.invalidate_locked(&mut state, source);
                state.errors[i] = Some(code.to_string());
            }
            code.to_string()
        };
        if !self.drain_realtime(source) {
            return Err(fail_start("realtime_previous_owner_busy"));
        }
        {
            let state = self.realtime().state();
            if state.closed || !state.requested[i] || state.generation[i] != generation {
                return Err("realtime_stale_start".into());
            }
        }
        // The recorder stops: realtime takes the source.
        let (transcript_key, energy_key) = flags(source);
        let _ = self.config().set(transcript_key, json!(false));
        let _ = self.config().set(energy_key, json!(false));
        self.run(200, &format!("/set/disable/check_{}_threshold", source.as_str()), json!(false));
        if !self.transcription().stop_legacy(source) {
            return Err(fail_start("realtime_legacy_stop_failed"));
        }
        if !self.realtime_toggles() {
            self.run(200, &format!("/set/disable/transcription_{}", direction(source)), json!(false));
        }
        drop(lifecycle);

        let mut state = self.realtime().state();
        if state.closed || state.generation[i] != generation {
            return Err("realtime_stale_start".into());
        }
        let session = Session::new(
            source,
            options,
            endpoint,
            platform,
            self.services().translation_transport.clone(),
        );
        let delivery = self.realtime_delivery(source, generation, &session, detect, language);
        let id = self.realtime().owners.fetch_add(1, Ordering::SeqCst);
        state.owners[i] = Some(Owner { id, session: session.clone(), delivery: delivery.clone() });
        drop(state);
        if session.start().is_err() || delivery.start().is_err() {
            return Err(fail_start("realtime_start_failed"));
        }
        Ok(())
    }

    /// The delivery of a session: captions to the UI and the VR large log, finals through the
    /// message pipeline (`publish`, `process`, `admit`, `clear_overlay`, `error` of
    /// `_startRealtime`).
    fn realtime_delivery(
        self: &Arc<Self>,
        source: Source,
        generation: u64,
        session: &Session,
        detect: bool,
        language: Option<String>,
    ) -> Delivery {
        let weak = Arc::downgrade(self);
        let current = {
            let weak = weak.clone();
            Arc::new(move || {
                weak.upgrade().is_some_and(|core| {
                    let state = core.realtime().state();
                    !state.closed && state.requested[index(source)] && state.generation[index(source)] == generation
                })
            })
        };
        let admit = {
            let (weak, current, session) = (weak.clone(), current.clone(), session.clone());
            Arc::new(move |update: &Update| -> Admission {
                let core = weak.upgrade();
                let admitted: Arc<dyn Fn() -> bool + Send + Sync> = match &core {
                    Some(core) => {
                        let guard = core.transcription().publication_guard(source);
                        let held = Arc::downgrade(core);
                        Arc::new(move || guard() && !(source == Source::Mic && held.upgrade().is_some_and(|c| c.mic_held_back())))
                    }
                    None => Arc::new(|| false),
                };
                let spoken = if detect && !update.language.is_empty() {
                    Self::realtime_language(&update.language).or_else(|| language.clone())
                } else {
                    language.clone()
                };
                let publish = {
                    let (weak, current, admitted, session, spoken) =
                        (weak.clone(), current.clone(), admitted.clone(), session.clone(), spoken.clone());
                    Arc::new(move |payload: Value| -> bool {
                        let Some(core) = weak.upgrade() else { return false };
                        core.publish_caption(source, generation, payload, &*current, &*admitted, &session, spoken.as_deref())
                    })
                };
                // The voice settings when the final arrived (`snapshot_voice`): its speech is
                // refused if they change before the translation is done.
                let voice_snapshot = if source == Source::Mic { core.as_ref().and_then(|core| core.mic_voice_snapshot()) } else { None };
                let process = {
                    let (weak, current, admitted, spoken) = (weak.clone(), current.clone(), admitted.clone(), spoken.clone());
                    let voice_snapshot = std::sync::Mutex::new(voice_snapshot);
                    Arc::new(move |update: &Update, valid: vrct_transcription::realtime::delivery::Current| -> Result<Option<Value>, ()> {
                        let Some(core) = weak.upgrade() else { return Ok(None) };
                        if !(current() && valid() && admitted()) {
                            return Ok(None);
                        }
                        let (current, admitted) = (current.clone(), admitted.clone());
                        let guard: super::messages::Guard = Arc::new(move || current() && valid() && admitted());
                        let id = format!("{}:{}", update.namespace, update.item_id);
                        if source == Source::Mic {
                            let mic_voice = voice_snapshot.lock().unwrap().take().map(|snapshot| super::messages::MicVoice {
                                snapshot,
                                update: speech_update(update),
                            });
                            return Ok(core.process_realtime_mic(&update.text, spoken.as_deref(), Some(id), Some(guard), mic_voice));
                        }
                        Ok(core.process_message(spec(source), &update.text, spoken.as_deref(), Some(id), None, Some(guard)))
                    })
                };
                Admission { publish, process, admitted }
            })
        };
        let on_error = {
            let weak = weak.clone();
            Arc::new(move |code: &str| {
                if let Some(core) = weak.upgrade() {
                    let mut state = core.realtime().state();
                    if state.generation[index(source)] == generation {
                        state.errors[index(source)] = Some(code.to_string());
                    }
                }
            })
        };
        let on_stopped = {
            let (weak, session) = (weak.clone(), session.clone());
            Box::new(move || {
                let Some(core) = weak.upgrade() else { return };
                if let Some(namespace) = session.namespace() {
                    core.discard_overlay_captions(source.as_str(), &namespace);
                }
                core.realtime_ended(source, generation);
            })
        };
        Delivery::new(session.clone(), admit, on_error, on_stopped)
    }

    /// `publish` of `_startRealtime`: a caption row to the UI and the VR large log.
    #[allow(clippy::too_many_arguments)]
    fn publish_caption(
        &self,
        source: Source,
        generation: u64,
        payload: Value,
        current: &(dyn Fn() -> bool + Send + Sync),
        admitted: &(dyn Fn() -> bool + Send + Sync),
        session: &Session,
        spoken: Option<&str>,
    ) -> bool {
        let mut shown_payload = payload.clone();
        shown_payload["generation"] = json!(generation);
        if payload["state"] == "outcome" {
            // Settling a shown row outlives mute, stop and expiry.
            self.run(200, "/run/realtime_caption", shown_payload);
            return true;
        }
        let valid = || current() && admitted();
        if !valid() {
            return false;
        }
        self.run(200, "/run/realtime_caption", shown_payload);
        if self.config().get_bool("OVERLAY_LARGE_LOG") {
            let namespace = payload["namespace"].as_str().unwrap_or("");
            let state = payload["state"].as_str().unwrap_or("");
            let expires = payload["expires_ns"].as_u64().unwrap_or(0);
            let overlay_current = || {
                valid()
                    && self.config().get_bool("OVERLAY_LARGE_LOG")
                    && session.is_current(namespace)
                    && (state == "discarded"
                        || vrct_transcription::realtime::delivery::monotonic_ns(Instant::now()) < expires)
            };
            let message = self.caption_message(source, &payload, spoken);
            self.show_overlay_caption(
                source.as_str(),
                namespace,
                payload["item_id"].as_str().unwrap_or(""),
                state,
                payload["revision"].as_u64().unwrap_or(0),
                &message,
                &overlay_current,
            );
        }
        true
    }

    /// The VR large log's view of a caption (`publishRealtimeCaptionOverlay`).
    fn caption_message(&self, source: Source, payload: &Value, spoken: Option<&str>) -> super::overlay::OverlayMessage {
        let config = self.config();
        let tab = config.get_str("SELECTED_TAB_NO");
        // The destinations of the direction: the targets for the microphone, the own languages
        // for the speaker.
        let key = if source == Source::Mic { "SELECTED_TARGET_LANGUAGES" } else { "SELECTED_YOUR_LANGUAGES" };
        let destinations = config.get(key)[&tab].clone();
        let target_languages = destinations
            .as_object()
            .into_iter()
            .flat_map(|o| o.values())
            .filter(|slot| slot["enable"] == true)
            .filter_map(|slot| slot["language"].as_str().map(str::to_string))
            .collect();
        let rows = payload["translations"].as_array().cloned().unwrap_or_default();
        let original = payload.get("original").cloned().unwrap_or_else(|| json!({ "message": payload["text"], "transliteration": [] }));
        super::overlay::OverlayMessage {
            received: source == Source::Speaker,
            small_log: false,
            message: original["message"].as_str().unwrap_or("").to_string(),
            source_language: spoken.map(str::to_string),
            translations: rows.iter().map(|row| row["message"].as_str().unwrap_or("").to_string()).collect(),
            target_languages,
            transliteration_message: original["transliteration"].clone(),
            transliteration_translation: Value::Array(rows.iter().map(|row| row["transliteration"].clone()).collect()),
        }
    }

    /// The end of the bundled ASR server (`_speechServerEnded` for "asr"): sessions that used
    /// that run stop; a crash is told on the switch.
    pub(crate) fn asr_server_ended(self: &Arc<Self>, run: Option<u64>, stopped: bool) {
        if stopped {
            self.refuse_resume_after_asr_stop();
        }
        let Some(run) = run else { return };
        let affected: Vec<Source> = {
            let mut state = self.realtime().state();
            let mut affected = Vec::new();
            for source in [Source::Mic, Source::Speaker] {
                let i = index(source);
                if state.requested[i] && state.server_runs[i] == Some((state.generation[i], run)) {
                    affected.push(source);
                    self.invalidate_locked(&mut state, source);
                }
            }
            affected
        };
        if affected.is_empty() {
            return;
        }
        let row = self.speech_servers().state()["asr"].clone();
        let reason = (row["state"] == "failed")
            .then(|| row["error_code"].as_str().unwrap_or("speech_server_start_failed").to_string());
        for source in affected {
            self.publish_realtime_toggle(source, reason.clone());
        }
    }
}

/// `_realtimeNotReady`: `details.reason` names the missing piece.
fn not_ready(source: Source, reason: &str) -> ErrorReply {
    let code = if source == Source::Mic { "TRANSCRIPTION_SEND_NOT_READY" } else { "TRANSCRIPTION_RECEIVE_NOT_READY" };
    ErrorReply::new(code, json!(false)).details(json!({ "reason": reason }))
}

/// The codes `_startRealtime` answered with 400 (a `ValueError` of the settings).
fn is_bad_request(code: &str) -> bool {
    matches!(
        code,
        "realtime_endpoint_required"
            | "realtime_endpoint_feedback"
            | "realtime_endpoint_invalid"
            | "realtime_model_invalid"
            | "realtime_translation_language_unsupported"
            | "realtime_base_url_invalid"
    )
}

pub(crate) fn add(b: &mut Builder<'_>) {
    let weak = Arc::downgrade(b.core);
    b.core.speech_servers().on_end(Arc::new(move |ended| {
        if ended.profile == Profile::Asr
            && let Some(core) = weak.upgrade()
        {
            core.asr_server_ended(ended.run, ended.stopped);
        }
    }));
    b.with("/get/data/realtime_asr_settings", OPEN, |core, _| core.get_realtime_settings());
    b.with("/set/data/realtime_asr_settings", OPEN, |core, data| core.set_realtime_settings(data));
    b.with("/get/data/realtime_asr_endpoints", OPEN, |core, data| core.realtime_endpoints(data));
    b.with("/get/data/realtime_asr_models", OPEN, |core, _| core.realtime_models());
    b.with("/get/data/realtime_asr_state", OPEN, |core, _| ok(core.realtime_state()));
    b.with("/run/start_realtime_asr", OPEN, |core, data| core.start_realtime(data));
    // Answered as it arrives (`IMMEDIATE_ENDPOINTS`).
    b.with("/run/stop_realtime_asr", OPEN, |core, data| core.stop_realtime(data));
}

/// A realtime final as speech sees it (`TranscriptUpdate`), on speech's clock.
fn speech_update(update: &Update) -> vrct_tts::message_hook::TranscriptUpdate {
    let now = vrct_tts::clock::monotonic_ns();
    let age = update.received.map_or(0, |at| i64::try_from(at.elapsed().as_nanos()).unwrap_or(i64::MAX));
    vrct_tts::message_hook::TranscriptUpdate {
        source: update.source.to_string(),
        is_final: update.is_final,
        state: update.state.to_string(),
        namespace: update.namespace.clone(),
        item_id: update.item_id.clone(),
        text: update.text.clone(),
        revision: i64::try_from(update.revision).unwrap_or(i64::MAX),
        received_ns: now.saturating_sub(age),
    }
}
