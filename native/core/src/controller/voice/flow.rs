//! Where the user's own voice and typed chat go with the current settings (`io_flow.py`), and
//! how long each of those inputs took to reach each output (`io_trace.py`).
//!
//! The flow panel and its overlays draw both. Nothing here is logged (`/run/io_trace` is never
//! written to `process.log`) and nothing leaves the PC.

use serde_json::{Map, Value, json};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

/// What [`describe`] reads: the controller gathers it.
pub(crate) struct FlowState {
    pub mic_on: bool,
    pub realtime: bool,
    pub engine: Value,
    pub translation: bool,
    pub source_language: Value,
    pub targets: Vec<Value>,
    pub speech_language: Value,
    pub send_to_vrc: bool,
    pub only_translated: bool,
    pub desktop: bool,
    pub large_log: bool,
    pub clipboard: bool,
    pub websocket: bool,
    pub voice: Value,
    pub tts_enabled: bool,
    pub muted: bool,
    /// `off`, `passthrough` or `converted`.
    pub direct_mode: String,
    pub direct_active: bool,
    pub direct_engine: Option<String>,
    pub round_trip_ms: Option<i64>,
}

fn output(name: &str, on: bool, reason: &str, detail: &[(&str, Value)]) -> Value {
    let mut row = Map::new();
    row.insert("id".into(), json!(name));
    row.insert("on".into(), json!(on));
    row.insert("reason".into(), if on { Value::Null } else { json!(reason) });
    for (key, value) in detail {
        row.insert((*key).into(), value.clone());
    }
    Value::Object(row)
}

fn chatbox(state: &FlowState) -> Value {
    if !state.send_to_vrc {
        return output("chatbox", false, "vrchat_off", &[]);
    }
    let content = if !state.translation {
        "original"
    } else if state.only_translated {
        "translation"
    } else {
        "both"
    };
    output("chatbox", true, "", &[("content", json!(content))])
}

/// Why speech cannot play at all right now, whatever the input.
fn speech_block(state: &FlowState) -> Option<&'static str> {
    if state.muted {
        Some("muted")
    } else if !state.tts_enabled {
        Some("tts_off")
    } else {
        None
    }
}

/// Through the conversion only while it runs (ADR-007); otherwise the TTS output device.
fn speech_path(state: &FlowState) -> &'static str {
    if state.voice["conversion"] == "on" && state.direct_mode == "converted" && state.direct_active { "converted" } else { "device" }
}

fn translation(state: &FlowState) -> Value {
    json!({ "on": state.translation, "source": state.source_language, "targets": if state.translation { state.targets.clone() } else { Vec::new() } })
}

fn voice(state: &FlowState) -> Value {
    let reason = if state.voice["mic_mode"] != "translated" {
        Some("mic_speech_off")
    } else if !state.translation {
        Some("translation_off")
    } else if !state.realtime {
        Some("not_realtime")
    } else {
        speech_block(state)
    };
    let speaking = reason.is_none();
    let live = if state.muted {
        "muted"
    } else if state.direct_mode == "off" || !state.direct_active {
        // VRCT-VOX does not carry the voice; VRChat reads the microphone itself.
        "vrchat_mic"
    } else {
        state.direct_mode.as_str()
    };
    let during_speech = if speaking && matches!(live, "converted" | "passthrough") { state.voice.get("direct_policy").cloned().unwrap_or(json!("suppress")) } else { Value::Null };
    let outputs = vec![
        chatbox(state),
        output(
            "speech",
            speaking,
            reason.unwrap_or(""),
            &[("path", if speaking { json!(speech_path(state)) } else { Value::Null }), ("language", if speaking { state.speech_language.clone() } else { Value::Null })],
        ),
        output("live_voice", live != "muted", "muted", &[("carried", json!(live)), ("engine", json!(state.direct_engine)), ("during_speech", during_speech)]),
        output("desktop_caption", state.desktop, "setting_off", &[]),
        output("vr_log", state.large_log, "setting_off", &[]),
        output("clipboard", state.clipboard, "setting_off", &[]),
        output("websocket", state.websocket, "setting_off", &[]),
    ];
    json!({
        "on": state.mic_on,
        "recognition": { "realtime": state.realtime, "engine": if state.realtime { Value::Null } else { state.engine.clone() } },
        "translation": translation(state),
        "outputs": outputs,
    })
}

fn chat(state: &FlowState) -> Value {
    let mode = state.voice.get("mode").and_then(Value::as_str).unwrap_or("off");
    let reason = if mode == "off" {
        Some("chat_speech_off")
    } else if mode == "translated" && !state.translation {
        Some("translation_off")
    } else {
        speech_block(state)
    };
    let speaking = reason.is_none();
    let language = if mode == "translated" { state.speech_language.clone() } else { state.source_language.clone() };
    let outputs = vec![
        chatbox(state),
        output(
            "speech",
            speaking,
            reason.unwrap_or(""),
            &[
                ("path", if speaking { json!(speech_path(state)) } else { Value::Null }),
                ("content", if speaking { json!(mode) } else { Value::Null }),
                ("language", if speaking { language } else { Value::Null }),
            ],
        ),
        output("desktop_caption", state.desktop, "setting_off", &[]),
        output("vr_log", state.large_log, "setting_off", &[]),
        output("websocket", state.websocket, "setting_off", &[]),
    ];
    json!({ "on": true, "translation": translation(state), "outputs": outputs })
}

pub(crate) fn describe(state: &FlowState) -> Value {
    json!({ "voice": voice(state), "chat": chat(state), "conversion_round_trip_ms": state.round_trip_ms })
}

const TEXT_LIMIT: usize = 200;
const KEEP: usize = 32;

fn ms(ns: i64) -> i64 {
    ((ns as f64) / 1e6).round().max(0.0) as i64
}

fn cut(text: &str) -> String {
    text.chars().take(TEXT_LIMIT).collect()
}

/// One message's trace (`IoTrace`).
pub(crate) struct IoTrace {
    id: String,
    source: &'static str,
    text: String,
    origin: &'static str,
    origin_ns: i64,
    inner: Mutex<TraceInner>,
}

#[derive(Default)]
struct TraceInner {
    translation: String,
    stages: Map<String, Value>,
    outputs: Map<String, Value>,
    published: bool,
}

impl IoTrace {
    pub fn stage(&self, name: &str, value_ms: Option<f64>) {
        if let Some(value) = value_ms {
            self.inner.lock().unwrap().stages.insert(name.into(), json!(value.round().max(0.0) as i64));
        }
    }

    pub fn output(&self, name: &str, state: &str, at_ns: Option<i64>, detail: &[(&str, Value)]) {
        let mut row = Map::new();
        row.insert("state".into(), json!(state));
        row.insert("at_ms".into(), at_ns.map_or(Value::Null, |at| json!(ms(at - self.origin_ns))));
        for (key, value) in detail {
            row.insert((*key).into(), value.clone());
        }
        self.inner.lock().unwrap().outputs.insert(name.into(), Value::Object(row));
    }

    pub fn speech_queued(&self, accepted: bool) {
        let mut inner = self.inner.lock().unwrap();
        if inner.outputs.get("speech").and_then(|s| s.get("state")).and_then(Value::as_str) != Some("playing") {
            inner.outputs.insert("speech".into(), json!({ "state": if accepted { "queued" } else { "not_spoken" }, "at_ms": null }));
        }
    }

    pub fn set_translation(&self, text: &str) {
        self.inner.lock().unwrap().translation = text.to_owned();
    }

    fn to_json(&self) -> Value {
        let inner = self.inner.lock().unwrap();
        json!({
            "id": self.id, "input": self.source, "text": self.text, "translation": cut(&inner.translation),
            "origin": self.origin, "stages": inner.stages.clone(), "outputs": inner.outputs.clone(),
        })
    }
}

/// The recent traces, so that speech starting later can add its time to its message.
pub(crate) struct IoTraces {
    emit: Arc<dyn Fn(Value) + Send + Sync>,
    traces: Mutex<VecDeque<Arc<IoTrace>>>,
}

impl IoTraces {
    pub fn new(emit: Arc<dyn Fn(Value) + Send + Sync>) -> Self {
        Self { emit, traces: Mutex::new(VecDeque::new()) }
    }

    pub fn begin(&self, id: &str, source: &'static str, text: &str, origin: &'static str, origin_ns: i64) -> Arc<IoTrace> {
        let trace = Arc::new(IoTrace { id: id.to_owned(), source, text: cut(text), origin, origin_ns, inner: Mutex::default() });
        let mut traces = self.traces.lock().unwrap();
        traces.retain(|t| t.id != trace.id);
        traces.push_back(trace.clone());
        while traces.len() > KEEP {
            traces.pop_front();
        }
        trace
    }

    pub fn get(&self, id: &str) -> Option<Arc<IoTrace>> {
        self.traces.lock().unwrap().iter().find(|t| t.id == id).cloned()
    }

    pub fn publish(&self, trace: &IoTrace) {
        let payload = {
            let traces = self.traces.lock().unwrap();
            trace.inner.lock().unwrap().published = true;
            drop(traces);
            trace.to_json()
        };
        (self.emit)(payload);
    }

    /// The first audio of a message's speech was written (or sent to the conversion).
    pub fn speech_started(&self, id: &str, timestamp_ns: i64, converted: bool, conversion_ms: Option<i64>) -> bool {
        let traces = self.traces.lock().unwrap();
        let Some(trace) = traces.iter().find(|t| t.id == id).cloned() else { return false };
        let mut detail = vec![("converted", json!(converted))];
        if converted && let Some(conversion) = conversion_ms {
            detail.push(("conversion_ms", json!(conversion)));
        }
        trace.output("speech", "playing", Some(timestamp_ns), &detail);
        let published = trace.inner.lock().unwrap().published;
        drop(traces);
        if published {
            (self.emit)(trace.to_json());
        }
        true
    }
}
