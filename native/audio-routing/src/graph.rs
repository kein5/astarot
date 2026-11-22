//! Reading a PipeWire graph: endpoints, defaults, the managed route and its links.
//!
//! A graph is a list of objects in the shape `pw-dump` prints. The native observer in
//! `pipewire::observer` builds the same shape from registry events, so the checks
//! here are the Python checks of [`source_bridge.py`], [`pipewire_gate.py`],
//! [`devices_pipewire.py`] and `device_manager._linuxMicDevices`, applied to the same
//! data. Every check that Python makes with `type(x) is int` refuses booleans and
//! strings here too.
//!
//! [`source_bridge.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/source_bridge.py
//! [`pipewire_gate.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/pipewire_gate.py
//! [`devices_pipewire.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/devices_pipewire.py

use serde_json::Value;

use crate::error::{Error, Result};
use crate::identity::Device;

pub type Graph = Vec<Value>;

pub const NODE: &str = "PipeWire:Interface:Node";
pub const CORE: &str = "PipeWire:Interface:Core";
pub const LINK: &str = "PipeWire:Interface:Link";
pub const CLIENT: &str = "PipeWire:Interface:Client";
pub const METADATA: &str = "PipeWire:Interface:Metadata";

/// The managed virtual microphone VRChat records from.
pub const MANAGED_SOURCE: &str = "vrct.managed.source";
pub const TTS_SINK: &str = "vrct.managed.tts";
pub const VC_SINK: &str = "vrct.managed.vc";
pub const MIX_SINK: &str = "vrct.managed.mix";
/// Node name prefixes of endpoints that feed the virtual microphone.
pub const VIRTUAL_PREFIXES: [&str; 2] = ["vrct.managed.", "vrct.source-bridge."];
/// The device page host of PipeWire inputs.
pub const PIPEWIRE_MIC_HOST: &str = "PipeWire";

pub fn kind(item: &Value) -> Option<&str> {
    item.get("type").and_then(Value::as_str)
}

/// `info.props` of an object, if it has them.
pub fn props(item: &Value) -> Option<&serde_json::Map<String, Value>> {
    item.get("info")?.get("props")?.as_object()
}

fn prop<'a>(item: &'a Value, key: &str) -> Option<&'a Value> {
    props(item)?.get(key)
}

fn prop_str<'a>(item: &'a Value, key: &str) -> Option<&'a str> {
    prop(item, key)?.as_str()
}

/// A Python `int` (not `bool`) in range.
fn as_int(value: &Value) -> Option<u64> {
    if value.is_boolean() {
        return None;
    }
    value.as_u64()
}

pub fn nodes(graph: &[Value]) -> impl Iterator<Item = &Value> {
    graph.iter().filter(|item| kind(item) == Some(NODE))
}

pub fn node_name(item: &Value) -> Option<&str> {
    prop_str(item, "node.name")
}

/// Whether `name` starts with a virtual microphone prefix.
pub fn is_virtual_name(name: &str) -> bool {
    VIRTUAL_PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

/// The one node named `name`.
pub fn node<'a>(graph: &'a [Value], name: &str) -> Result<&'a Value> {
    let mut matches = nodes(graph).filter(|item| node_name(item) == Some(name));
    match (matches.next(), matches.next()) {
        (Some(item), None) => Ok(item),
        _ => Err(Error::runtime("source_bridge_endpoint_missing_or_ambiguous")),
    }
}

/// A node bound to one server instance: the core cookie and the node's serial.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Endpoint {
    pub cookie: u32,
    pub serial: u64,
    pub name: String,
    pub media_class: String,
}

/// The endpoint of the node named `name`, which must have `media_class`.
pub fn endpoint(graph: &[Value], name: &str, media_class: &str) -> Result<Endpoint> {
    let cores: Vec<&Value> = graph.iter().filter(|item| kind(item) == Some(CORE)).filter_map(|item| item.get("info")?.get("cookie")).collect();
    let item = node(graph, name)?;
    let invalid = || Error::runtime("source_bridge_endpoint_invalid");
    let cookie = match cores.as_slice() {
        [cookie] => as_int(cookie).filter(|&c| c <= u64::from(u32::MAX)).ok_or_else(invalid)? as u32,
        _ => return Err(invalid()),
    };
    let serial = prop(item, "object.serial").and_then(as_int).ok_or_else(invalid)?;
    if prop_str(item, "media.class") != Some(media_class) {
        return Err(invalid());
    }
    Ok(Endpoint { cookie, serial, name: name.to_owned(), media_class: media_class.to_owned() })
}

/// The input named `name`, refusing anything that feeds the virtual microphone.
pub fn select_source(graph: &[Value], name: &str) -> Result<Endpoint> {
    let source = endpoint(graph, name, "Audio/Source")?;
    let item = node(graph, name)?;
    let marked = props(item).is_some_and(|p| p.contains_key("vrct.managed.route") || p.contains_key("vrct.source.bridge"));
    if is_virtual_name(name) || marked {
        return Err(Error::runtime("source_bridge_feedback_source"));
    }
    Ok(source)
}

/// The managed VC input the bridge plays into.
pub fn vc_sink(graph: &[Value]) -> Result<Endpoint> {
    let sink = endpoint(graph, VC_SINK, "Audio/Sink")?;
    if prop_str(node(graph, VC_SINK)?, "vrct.managed.route") != Some("v1") {
        return Err(Error::runtime("source_bridge_sink_invalid"));
    }
    Ok(sink)
}

/// An endpoint as it crosses the IPC boundary: numbers as decimal text, so that
/// 64-bit serials survive JavaScript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceId {
    pub cookie: String,
    pub serial: String,
    pub name: String,
    pub media_class: String,
}

impl From<&Endpoint> for SourceId {
    fn from(endpoint: &Endpoint) -> Self {
        Self { cookie: endpoint.cookie.to_string(), serial: endpoint.serial.to_string(), name: endpoint.name.clone(), media_class: endpoint.media_class.clone() }
    }
}

impl SourceId {
    /// The four fields as a JSON object.
    pub fn to_json(&self) -> Value {
        serde_json::json!({"cookie": self.cookie, "serial": self.serial, "name": self.name, "media_class": self.media_class})
    }
}

fn decimal(text: &Value, bits: u32) -> Option<u64> {
    let text = text.as_str()?;
    if !(1..=20).contains(&text.len()) || !text.bytes().all(|b| b.is_ascii_digit()) || (text.len() > 1 && text.starts_with('0')) {
        return None;
    }
    let value: u128 = text.parse().ok()?;
    (value < 1u128 << bits).then_some(value as u64)
}

/// Validate an IPC source identity.
pub fn parse_source(value: &Value) -> Result<Endpoint> {
    let invalid = || Error::value("source_bridge_source_invalid");
    let object = value.as_object().ok_or_else(invalid)?;
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    if keys != ["cookie", "media_class", "name", "serial"] {
        return Err(invalid());
    }
    let cookie = decimal(&object["cookie"], 32).ok_or_else(invalid)? as u32;
    let serial = decimal(&object["serial"], 64).ok_or_else(invalid)?;
    let name = object["name"].as_str().ok_or_else(invalid)?;
    if name.is_empty() || name.contains('\0') || is_virtual_name(name) || object["media_class"].as_str() != Some("Audio/Source") {
        return Err(invalid());
    }
    Ok(Endpoint { cookie, serial, name: name.to_owned(), media_class: "Audio/Source".to_owned() })
}

/// One selectable input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Source {
    pub id: SourceId,
    pub label: String,
}

/// Every input that may be forwarded or converted: real, unambiguous, not virtual.
pub fn sources(graph: &[Value]) -> Vec<Source> {
    let mut result = Vec::new();
    for item in nodes(graph) {
        let Some(name) = node_name(item) else { continue };
        if prop_str(item, "media.class") != Some("Audio/Source") {
            continue;
        }
        let Ok(source) = select_source(graph, name) else { continue };
        let id = SourceId::from(&source);
        if parse_source(&id.to_json()).is_err() {
            continue;
        }
        let label = prop_str(item, "node.description").filter(|d| !d.is_empty()).unwrap_or(name);
        result.push(Source { id, label: label.to_owned() });
    }
    result
}

/// Device page names; a description shared by several inputs gets its node name.
pub fn microphone_names(sources: &[Source]) -> Vec<String> {
    sources.iter().map(|item| if sources.iter().filter(|other| other.label == item.label).count() == 1 { item.label.clone() } else { format!("{} ({})", item.label, item.id.name) }).collect()
}

/// The `default` metadata entries whose value names a node, by key.
fn default_names(graph: &[Value], subject_zero_only: bool) -> Vec<(String, String)> {
    let mut result = Vec::new();
    for item in graph {
        if kind(item) != Some(METADATA) || item.get("props").and_then(|p| p.get("metadata.name")).and_then(Value::as_str) != Some("default") {
            continue;
        }
        for entry in item.get("metadata").and_then(Value::as_array).into_iter().flatten() {
            if subject_zero_only && entry.get("subject").and_then(as_int) != Some(0) {
                continue;
            }
            let Some(key) = entry.get("key").and_then(Value::as_str) else { continue };
            let parsed;
            let value = match entry.get("value") {
                Some(Value::String(text)) => match serde_json::from_str::<Value>(text) {
                    Ok(value) => {
                        parsed = value;
                        &parsed
                    }
                    Err(_) => continue,
                },
                Some(value) => value,
                None => continue,
            };
            if let Some(name) = value.get("name").and_then(Value::as_str) {
                result.push((key.to_owned(), name.to_owned()));
            }
        }
    }
    result
}

fn default_for(entries: &[(String, String)], key: &str) -> Option<String> {
    // Later entries overwrite earlier ones, as in a Python dict.
    entries.iter().rev().find(|(k, _)| k == key).map(|(_, name)| name.clone())
}

/// The device page list on Linux: inputs, and the one to show as default.
///
/// PipeWire's default may be the managed virtual microphone itself, so the
/// configured default and then the first real input are the fallbacks.
pub fn microphone_devices(graph: &[Value]) -> (Vec<Device>, Option<Device>) {
    let found = sources(graph);
    let devices: Vec<Device> =
        found.iter().zip(microphone_names(&found)).enumerate().map(|(index, (item, name))| Device { index: index as i64, name, node_name: Some(item.id.name.clone()), ..Device::default() }).collect();
    let defaults = default_names(graph, false);
    for key in ["default.audio.source", "default.configured.audio.source"] {
        let wanted = default_for(&defaults, key);
        if let Some(device) = devices.iter().find(|d| wanted.is_some() && d.node_name == wanted) {
            return (devices.clone(), Some(device.clone()));
        }
    }
    let first = devices.first().cloned();
    (devices, first)
}

/// The session's default sink name. For the monitor only: speech never uses a default.
pub fn default_output(graph: &[Value]) -> Result<String> {
    let defaults = default_names(graph, true);
    for key in ["default.audio.sink", "default.configured.audio.sink"] {
        if let Some(name) = default_for(&defaults, key).filter(|n| !n.is_empty()) {
            return Ok(name);
        }
    }
    Err(Error::speech("output_missing"))
}

/// One output choice: the sink's node name and its description.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputOption {
    pub id: String,
    pub label: String,
}

/// Every sink, by node name.
pub fn enumerate_outputs(graph: &[Value]) -> Result<Vec<OutputOption>> {
    let mut result = Vec::new();
    for item in graph {
        if prop_str(item, "media.class") != Some("Audio/Sink") {
            continue;
        }
        let name = node_name(item).ok_or_else(|| Error::speech("pipewire_unavailable"))?;
        let label = prop_str(item, "node.description").unwrap_or(name);
        result.push(OutputOption { id: name.to_owned(), label: label.to_owned() });
    }
    Ok(result)
}

/// The mute state of one managed node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GateState {
    /// (core cookie, node serial)
    pub identity: (u64, u64),
    pub muted: bool,
}

const REQUIRED: [(&str, &str); 4] = [(MANAGED_SOURCE, "Audio/Source"), (TTS_SINK, "Audio/Sink"), (VC_SINK, "Audio/Sink"), (MIX_SINK, "Audio/Sink")];

/// The managed source (or with `direct`, the VC input) and its mute, when the whole
/// managed route is present exactly once.
pub fn parse_managed(graph: &[Value], direct: bool) -> Result<GateState> {
    parse_managed_inner(graph, direct).ok_or_else(|| Error::runtime("managed_endpoint_missing_or_invalid"))
}

fn parse_managed_inner(graph: &[Value], direct: bool) -> Option<GateState> {
    let mut cores = Vec::new();
    let mut found: Vec<(&str, &Value)> = Vec::new();
    for item in graph {
        let kind = item.get("type")?.as_str();
        if kind == Some(CORE) {
            cores.push(item.get("info")?.get("cookie")?);
            continue;
        }
        if kind != Some(NODE) {
            continue;
        }
        let item_props = item.get("info")?.get("props")?;
        let Some(name) = item_props.get("node.name").and_then(Value::as_str) else { continue };
        let Some(&(_, media)) = REQUIRED.iter().find(|(required, _)| *required == name) else { continue };
        if found.iter().any(|(seen, _)| *seen == name)
            || item_props.get("media.class").and_then(Value::as_str) != Some(media)
            || item_props.get("vrct.managed.route").and_then(Value::as_str) != Some("v1")
        {
            return None;
        }
        found.push((name, item.get("info")?));
    }
    if found.len() != REQUIRED.len() || cores.len() != 1 {
        return None;
    }
    let wanted = if direct { VC_SINK } else { MANAGED_SOURCE };
    let info = found.iter().find(|(name, _)| *name == wanted)?.1;
    let muted: Vec<&Value> = info.get("params")?.get("Props")?.as_array()?.iter().filter_map(|p| p.get("mute")).collect();
    let serial = as_int(info.get("props")?.get("object.serial")?)?;
    let cookie = as_int(cores[0])?;
    match muted.as_slice() {
        [Value::Bool(muted)] => Some(GateState { identity: (cookie, serial), muted: *muted }),
        _ => None,
    }
}

/// Whether the graph holds the whole managed route.
pub fn managed_ready(graph: &[Value]) -> bool {
    parse_managed(graph, false).is_ok() && parse_managed(graph, true).is_ok()
}

/// Check the bridge's two streams and their links; returns the playback endpoint.
///
/// Extra input or output links are refused, not just a missing pair. A stream
/// counts as the bridge's only when its client's server-authenticated PID is the
/// bridge process.
pub fn bridge_links(graph: &[Value], source: &Endpoint, sink: &Endpoint, tag: &str, pid: u32, muted: bool) -> Result<Endpoint> {
    if select_source(graph, &source.name)? != *source || vc_sink(graph)? != *sink {
        return Err(Error::runtime("source_bridge_endpoint_changed"));
    }
    let mut streams = Vec::new();
    for (suffix, media) in [("capture", "Stream/Input/Audio"), ("playback", "Stream/Output/Audio")] {
        let name = format!("vrct.source-bridge.{tag}.{suffix}");
        let stream = endpoint(graph, &name, media)?;
        let item = node(graph, &name)?;
        let client_id = prop(item, "client.id");
        let clients: Vec<&Value> = graph.iter().filter(|c| kind(c) == Some(CLIENT) && c.get("id").is_some() && c.get("id") == client_id).collect();
        let owned = match clients.as_slice() {
            [client] => prop(client, "pipewire.sec.pid").and_then(as_int) == Some(u64::from(pid)),
            _ => false,
        };
        if prop_str(item, "vrct.source.bridge") != Some("v1") || !owned {
            return Err(Error::runtime("source_bridge_stream_owner_invalid"));
        }
        streams.push((item, stream));
    }
    let id = |item: &Value| item.get("id").cloned().unwrap_or(Value::Null);
    let (capture, playback) = (id(streams[0].0), id(streams[1].0));
    let expected = [(id(node(graph, &source.name)?), capture.clone()), (playback.clone(), id(node(graph, &sink.name)?))];
    let mut observed: Vec<(Value, Value)> = Vec::new();
    for item in graph.iter().filter(|item| kind(item) == Some(LINK)) {
        let info = item.get("info").ok_or_else(|| Error::runtime("source_bridge_links_invalid"))?;
        let pair = (info.get("output-node-id").cloned().unwrap_or(Value::Null), info.get("input-node-id").cloned().unwrap_or(Value::Null));
        if pair.0 == capture || pair.1 == capture || pair.0 == playback || pair.1 == playback {
            let state = info.get("state").and_then(Value::as_str);
            if !expected.contains(&pair) || !matches!(state, Some("active" | "paused")) {
                return Err(Error::runtime("source_bridge_links_invalid"));
            }
            if !observed.contains(&pair) {
                observed.push(pair);
            }
        }
    }
    if observed.len() != expected.len() {
        return Err(Error::runtime("source_bridge_links_missing"));
    }
    let values: Vec<&Value> =
        streams[1].0.get("info").and_then(|i| i.get("params")).and_then(|p| p.get("Props")).and_then(Value::as_array).into_iter().flatten().filter_map(|p| p.get("mute")).collect();
    if values.len() != 1 || values[0] != &Value::Bool(muted) {
        return Err(Error::runtime("source_bridge_mute_unconfirmed"));
    }
    Ok(streams.remove(1).1)
}

#[cfg(test)]
mod tests;
