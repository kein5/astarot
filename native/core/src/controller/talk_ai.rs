//! Settings and consent for an on-demand conversation with an external service (ADR-018).

use super::routes::{Builder, OPEN};
use super::{Core, ok};
use crate::config::Kept;
use crate::protocol::Reply;
use astarot_talk_ai::{Closed, Event, Key, Options, Service, SessionSettings, Talk, Turns, Update};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

mod audio;
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

const SECRET: &str = "TALK_AI/openai";
const OPENAI_URL: &str = "wss://api.openai.com/v1/realtime";
const OPENAI_MODEL: &str = "gpt-realtime";

/// Validate a local endpoint without resolving names. The web transport repeats the LAN check
/// at connection time for plaintext connections.
pub(crate) fn valid_local_url(url: &str) -> bool {
    let Some((scheme, rest)) = url.split_once("://") else {
        return false;
    };
    let scheme = match scheme {
        "ws" => "http",
        "wss" => "https",
        _ => return false,
    };
    let http = format!("{scheme}://{rest}");
    if rest.contains(['?', '#']) || crate::net_policy::validate_api_url(&http, false).is_err() {
        return false;
    }
    astarot_translation::http::Url::parse(&http)
        .is_ok_and(|url| crate::net_policy::is_local_host(&url.host))
}

#[derive(Default)]
pub(super) struct Session {
    talk: Option<Arc<Talk>>,
    state: Option<Arc<Mutex<State>>>,
}

struct State {
    id: u64,
    local: bool,
    audio: Option<Arc<audio::Audio>>,
    phase: &'static str,
    error: Option<&'static str>,
}

impl Session {
    pub(super) fn stop(&mut self) {
        if let Some(talk) = self.talk.take() {
            talk.cancel();
        }
        if let Some(state) = self.state.take() {
            state.lock().unwrap().stop_audio();
        }
    }

    fn status(&self) -> Value {
        self.state.as_ref().map_or_else(
            || json!({ "session_id": null, "phase": "idle", "error": null, "sending_audio": false, "sending_screen": false }),
            |state| state.lock().unwrap().status(),
        )
    }
}

impl State {
    fn status(&self) -> Value {
        json!({
            "session_id": self.id,
            "phase": self.phase,
            "error": self.error,
            "sending_audio": self.audio.as_ref().is_some_and(|audio| audio.sending()),
            "sending_screen": false
        })
    }

    fn stop_audio(&mut self) {
        if let Some(audio) = self.audio.take() {
            audio.stop();
        }
    }
}

impl Session {
    pub(super) fn owns_microphone(&self) -> bool {
        self.state
            .as_ref()
            .is_some_and(|state| state.lock().unwrap().audio.is_some())
    }
}

impl Core {
    pub(super) fn stop_talk_ai(&self) {
        self.talk_ai.lock().unwrap().stop();
    }
}

fn invalid(code: &str) -> Reply {
    Reply::status(400, json!({ "error_code": code }))
}

fn enabled(core: &Core) -> bool {
    core.config().get("EXPERIMENTAL_FEATURES")["talk_ai"].as_bool() == Some(true)
}

fn start(core: &Arc<Core>, data: &Value) -> Reply {
    let mut session = core.talk_ai.lock().unwrap();
    if core.shutdown_requested() || !enabled(core) {
        return Reply::conflict("talk_disabled");
    }
    if session
        .state
        .as_ref()
        .is_some_and(|s| matches!(s.lock().unwrap().phase, "connecting" | "ready"))
    {
        return Reply::conflict("talk_already_running");
    }

    let provider = core.config().get("TALK_AI_PROVIDER");
    let local = provider == "vllm_omni";
    let url = if local {
        core.config().get("TALK_AI_LOCAL_URL")
    } else {
        json!(OPENAI_URL)
    };
    // Consent is tied to the actual destination and is supplied anew for every start.
    if data["provider"] != provider
        || data["destination"] != url
        || data["consent"]["audio"].as_bool() != Some(true)
    {
        return invalid("talk_consent_required");
    }
    let key = if local {
        None
    } else {
        match core.config().secret(SECRET) {
            Ok(Some(key)) => Some(Key::new(key)),
            Ok(None) => return Reply::conflict("talk_key_required"),
            Err(_) => return Reply::conflict("talk_credential_unavailable"),
        }
    };
    session.stop();
    let state = Arc::new(Mutex::new(State {
        id: NEXT_SESSION.fetch_add(1, Ordering::Relaxed),
        local,
        audio: None,
        phase: "connecting",
        error: None,
    }));
    let on_update = Arc::clone(&state);
    let notifier = Arc::downgrade(core);
    let service = Service {
        url: url.as_str().unwrap_or_default().to_owned(),
        model: (!local).then(|| OPENAI_MODEL.to_owned()),
        key,
    };
    let settings = SessionSettings {
        instructions: String::new(),
        voice: None,
        turns: if local {
            Turns::Manual
        } else {
            Turns::server_vad()
        },
    };
    session.talk = Some(Arc::new(Talk::start(
        service,
        settings,
        Options::default(),
        Box::new(move |update| {
            let report = matches!(update, Update::Event(Event::Ready) | Update::Closed(_));
            let mut state = on_update.lock().unwrap();
            match update {
                Update::Event(Event::Ready) => state.phase = "ready",
                Update::Event(Event::StopPlayback) => {
                    if let Some(audio) = &state.audio {
                        audio.interrupt();
                    }
                }
                Update::Event(Event::Audio { item_id, pcm }) => {
                    if let Some(audio) = &state.audio {
                        audio.push(item_id, pcm);
                    }
                }
                Update::Closed(closed) => {
                    state.stop_audio();
                    if state.phase != "failed" {
                        match closed {
                            Closed::Failed(error) => {
                                state.phase = "failed";
                                state.error = Some(error.code());
                            }
                            Closed::Stopped => state.phase = "idle",
                        }
                    }
                }
                _ => {}
            }
            if report {
                let status = state.status();
                drop(state);
                if let Some(core) = notifier.upgrade() {
                    core.notify("talk_ai_status", status);
                }
            }
        }),
    )));
    session.state = Some(state);
    ok(session.status())
}

fn store(core: &Core, key: &str, data: &Value) -> Reply {
    let mut session = core.talk_ai.lock().unwrap();
    match core.config().set(key, data.clone()) {
        Ok(value) => {
            session.stop();
            ok(value)
        }
        Err(_) => invalid("talk_settings_invalid"),
    }
}

fn set_key(core: &Core, data: &Value) -> Reply {
    let mut session = core.talk_ai.lock().unwrap();
    if data.is_null() {
        session.stop();
        core.config().forget_secret(SECRET);
        return ok(json!({ "configured": false }));
    }
    let Some(key) = data.as_str().map(str::trim).filter(|key| {
        !key.is_empty() && key.len() <= 4096 && key.bytes().all(|byte| byte.is_ascii_graphic())
    }) else {
        return invalid("talk_key_invalid");
    };
    session.stop();
    let kept = core.config().keep_secret(SECRET, key, Box::new(|| {}));
    ok(json!({ "configured": true, "stored": matches!(kept, Kept::Stored) }))
}

pub(super) fn add(b: &mut Builder<'_>) {
    b.with("/get/data/talk_ai_catalog", OPEN, |core, _| ok(json!([
        { "id": "openai", "name": "OpenAI Realtime", "vision": true, "cloud": true, "destination": OPENAI_URL },
        { "id": "vllm_omni", "name": "vLLM-Omni", "vision": false, "cloud": false, "destination": core.config().get("TALK_AI_LOCAL_URL"),
          "recommended_model": "Qwen3-Omni", "minimum_gpu_memory_gib": 24, "recommended_gpu_memory_gib": 32 }
    ])));
    b.get("/get/data/talk_ai_provider", OPEN, "TALK_AI_PROVIDER");
    b.get("/get/data/talk_ai_local_url", OPEN, "TALK_AI_LOCAL_URL");
    b.with("/set/data/talk_ai_provider", OPEN, |core, data| {
        store(core, "TALK_AI_PROVIDER", data)
    });
    b.with("/set/data/talk_ai_local_url", OPEN, |core, data| {
        store(core, "TALK_AI_LOCAL_URL", data)
    });
    b.with("/get/data/talk_ai_auth_key", OPEN, |core, _| match core.config().secret(SECRET) {
        Ok(key) => ok(json!({ "configured": key.is_some(), "stored": key.is_some() && !core.config().secret_in_memory(SECRET) })),
        Err(_) => Reply::conflict("talk_credential_unavailable"),
    });
    b.with("/set/data/talk_ai_auth_key", OPEN, |core, data| {
        set_key(core, data)
    });
    b.with("/get/data/talk_ai_status", OPEN, |core, _| {
        ok(core.talk_ai.lock().unwrap().status())
    });
    b.with("/set/enable/talk_ai_audio", OPEN, audio::start);
    b.with("/set/data/talk_ai_interrupt", OPEN, |core, data| {
        audio::control(core, data, false)
    });
    b.with("/set/data/talk_ai_end_turn", OPEN, |core, data| {
        audio::control(core, data, true)
    });
    b.with("/set/enable/talk_ai", OPEN, |core, data| start(core, data));
    b.with("/set/disable/talk_ai", OPEN, |core, _| {
        core.stop_talk_ai();
        ok(core.talk_ai.lock().unwrap().status())
    });
}
