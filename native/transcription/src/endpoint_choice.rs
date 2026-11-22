//! Which PipeWire node realtime recognition captures on Linux (`_validate`, `_select` and
//! `default_endpoint` of [`capture_pipewire.py`]): never one of VRCT's own nodes, and for "follow
//! the default" the session's default or, when that is VRCT's own, the configured default.
//!
//! The graph is a list in the shape `pw-dump` prints. Nothing here reads PipeWire, so the
//! choice is tested on every platform; the helper (`helper.rs`, Linux) reads the graph and
//! calls it.
//!
//! [`capture_pipewire.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/capture_pipewire.py
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use crate::capture::{Source, media_class};
use serde_json::Value;
use vrct_audio_routing::graph::{self, Endpoint};

/// The marker the `vrct-asr-capture` helper of 0.5.x put on its streams. The capture of the core
/// names its streams instead ([`graph::asr_capture_stream`]).
const LEGACY_CAPTURE_MARKER: &str = "vrct.asr.capture";
/// The longest node name the helper takes, in bytes (`_validate`).
const MAX_NAME_BYTES: usize = 512;

/// A name the helper is never started for: one of VRCT's own nodes, or a name with a NUL or
/// longer than 512 bytes (`asr_capture_endpoint_invalid` in `_validate`).
pub(crate) fn refused_name(name: &str) -> bool {
    name.contains('\0') || name.len() > MAX_NAME_BYTES || graph::is_own_name(name)
}

/// `_select`: the node named `name`, if it is an input (`Source::Mic`) or output of the PC that
/// is not one of VRCT's own. A node that is VRCT's own or a name the helper cannot take is
/// refused with `asr_capture_endpoint_invalid` or `asr_capture_feedback_endpoint`; a node that
/// is missing or not of the kind asked for, with the graph's own code.
pub(crate) fn select(graph: &[Value], name: &str, source: Source) -> Result<Endpoint, String> {
    let endpoint = graph::endpoint(graph, name, media_class(source)).map_err(|e| e.code)?;
    if refused_name(name) {
        return Err("asr_capture_endpoint_invalid".into());
    }
    let node = graph::node(graph, name).map_err(|e| e.code)?;
    let props = graph::props(node);
    if props.is_some_and(|p| graph::has_route_marker(p) || p.contains_key(LEGACY_CAPTURE_MARKER)) {
        return Err("asr_capture_feedback_endpoint".into());
    }
    Ok(endpoint)
}

/// `default_endpoint`: the session's default input or output in the graph. When it is one of
/// VRCT's own nodes (the managed route can make its mix the default output), the configured
/// default is used instead: capturing VRCT's output would recognise its own speech. When only
/// VRCT's nodes are defaults the answer is `realtime_default_endpoint_feedback`; when there is no
/// usable default, `realtime_default_endpoint_missing`.
pub(crate) fn default_endpoint(graph: &[Value], source: Source) -> Result<Endpoint, String> {
    let kind = if source == Source::Mic { "source" } else { "sink" };
    let mut entries = std::collections::HashMap::new();
    for item in graph.iter() {
        if graph::kind(item) == Some(graph::METADATA) && item["props"]["metadata.name"] == "default" {
            for row in item["metadata"].as_array().into_iter().flatten() {
                if row["subject"] == 0
                    && let Some(key) = row["key"].as_str()
                {
                    entries.insert(key.to_string(), row["value"].clone());
                }
            }
        }
    }
    let mut blocked = false;
    for key in [format!("default.audio.{kind}"), format!("default.configured.audio.{kind}")] {
        let Some(mut value) = entries.get(&key).cloned() else { continue };
        // PipeWire gives the value as JSON text; a dump may give it parsed.
        if let Some(text) = value.as_str() {
            value = serde_json::from_str(text).unwrap_or(Value::Null);
        }
        let Some(name) = value["name"].as_str().filter(|n| !n.is_empty()) else { continue };
        match select(graph, name, source) {
            Ok(endpoint) => return Ok(endpoint),
            Err(code) if code == "asr_capture_endpoint_invalid" || code == "asr_capture_feedback_endpoint" => blocked = true,
            Err(_) => continue,
        }
    }
    Err(if blocked { "realtime_default_endpoint_feedback" } else { "realtime_default_endpoint_missing" }.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A graph with headphones, VRCT's mix and a microphone (`graph` of
    /// `tests/voice/test_realtime_language.py`). The default sink is `sink`; the configured
    /// default, `configured`.
    fn pipewire(sink: &str, configured: Option<&str>, extra: &[(&str, &str)]) -> Vec<Value> {
        let mut graph = vec![json!({ "type": "PipeWire:Interface:Core", "info": { "cookie": 7 } })];
        let named = [("alsa_output.headphones", "Audio/Sink"), ("astarot.managed.mix", "Audio/Sink"), ("alsa_input.mic", "Audio/Source")];
        for (name, media) in named.iter().chain(extra) {
            let serial = 40 + graph.len();
            graph.push(json!({ "type": "PipeWire:Interface:Node", "info": { "props": {
                "node.name": name, "media.class": media, "object.serial": serial } } }));
        }
        let mut metadata = vec![
            json!({ "subject": 0, "key": "default.audio.sink", "value": { "name": sink } }),
            // PipeWire's own form: the value as JSON text.
            json!({ "subject": 0, "key": "default.audio.source", "value": json!({ "name": "alsa_input.mic" }).to_string() }),
        ];
        if let Some(configured) = configured {
            metadata.push(json!({ "subject": 0, "key": "default.configured.audio.sink", "value": { "name": configured } }));
        }
        graph.push(json!({ "type": "PipeWire:Interface:Metadata", "props": { "metadata.name": "default" }, "metadata": metadata }));
        graph
    }

    fn name(result: Result<Endpoint, String>) -> String {
        match result {
            Ok(endpoint) => {
                assert_eq!(endpoint.cookie, 7);
                endpoint.name
            }
            Err(code) => code,
        }
    }

    /// Whether the names of 0.6.0 and earlier are read: the route's ones are when a node of
    /// them counts as the app's own.
    fn app_identity_reads_legacy() -> bool {
        graph::is_own_name("vrct.managed.mix")
    }

    #[test]
    fn the_default_output_is_one_pinned_node_that_is_not_vrcts_own() {
        let cases: [(Vec<Value>, &str); 6] = [
            (pipewire("alsa_output.headphones", None, &[]), "alsa_output.headphones"),
            // The managed route made its mix the default: the user's configured output is used.
            (pipewire("astarot.managed.mix", Some("alsa_output.headphones"), &[]), "alsa_output.headphones"),
            (pipewire("astarot.managed.mix", None, &[]), "realtime_default_endpoint_feedback"),
            (pipewire("astarot.managed.mix", Some("bluez_output.gone"), &[]), "realtime_default_endpoint_feedback"),
            (pipewire("bluez_output.gone", None, &[]), "realtime_default_endpoint_missing"),
            (Vec::new(), "realtime_default_endpoint_missing"),
        ];
        for (graph, want) in cases {
            assert_eq!(name(default_endpoint(&graph, Source::Speaker)), want);
        }
        let sink = default_endpoint(&pipewire("alsa_output.headphones", None, &[]), Source::Speaker).unwrap();
        assert_eq!(sink.media_class, "Audio/Sink");
    }

    #[test]
    fn the_default_input_is_read_from_the_metadatas_json_text() {
        let mic = default_endpoint(&pipewire("alsa_output.headphones", None, &[]), Source::Mic).unwrap();
        assert_eq!((mic.name.as_str(), mic.media_class.as_str()), ("alsa_input.mic", "Audio/Source"));
    }

    #[test]
    fn a_node_vrct_made_or_a_name_the_helper_cannot_take_is_refused() {
        let long = format!("alsa_output.{}", "x".repeat(MAX_NAME_BYTES));
        let graph = pipewire("x", None, &[
            ("astarot.asr.capture.mic", "Audio/Source"),
            ("vrct.asr.capture.mic", "Audio/Source"),
            ("vrct.managed.mix", "Audio/Sink"),
            ("bad\0name", "Audio/Sink"),
            (long.as_str(), "Audio/Sink"),
        ]);
        for (node, source) in [("astarot.managed.mix", Source::Speaker), ("astarot.asr.capture.mic", Source::Mic), ("bad\0name", Source::Speaker), (long.as_str(), Source::Speaker)] {
            assert_eq!(select(&graph, node, source).unwrap_err(), "asr_capture_endpoint_invalid", "{node:?}");
        }
        // The names of 0.6.0 and earlier, while they are read (ADR-014, 2.11).
        if app_identity_reads_legacy() {
            for (node, source) in [("vrct.managed.mix", Source::Speaker), ("vrct.asr.capture.mic", Source::Mic)] {
                assert_eq!(select(&graph, node, source).unwrap_err(), "asr_capture_endpoint_invalid", "{node:?}");
            }
        }
        // A node the app marked as its own, under another name.
        let mut markers = vec!["astarot.managed.route", "astarot.source.bridge", "vrct.asr.capture"];
        if app_identity_reads_legacy() {
            markers.extend(["vrct.managed.route", "vrct.source.bridge"]);
        }
        for marker in markers {
            let mut marked = pipewire("x", None, &[("loopback.sink", "Audio/Sink")]);
            for item in marked.iter_mut() {
                if item["info"]["props"]["node.name"] == "loopback.sink" {
                    item["info"]["props"][marker] = json!("v1");
                }
            }
            assert_eq!(select(&marked, "loopback.sink", Source::Speaker).unwrap_err(), "asr_capture_feedback_endpoint", "{marker}");
        }
        // A node of the other kind, or none, keeps the graph's code.
        assert_eq!(select(&graph, "alsa_input.mic", Source::Speaker).unwrap_err(), "source_bridge_endpoint_invalid");
        assert_eq!(select(&graph, "gone", Source::Speaker).unwrap_err(), "source_bridge_endpoint_missing_or_ambiguous");
        // A default that is a name the helper cannot take counts as VRCT's own (Python too).
        let mut nul_default = graph.clone();
        let metadata = nul_default.last_mut().unwrap();
        metadata["metadata"][0]["value"] = json!({ "name": "bad\0name" });
        assert_eq!(name(default_endpoint(&nul_default, Source::Speaker)), "realtime_default_endpoint_feedback");
    }
}
