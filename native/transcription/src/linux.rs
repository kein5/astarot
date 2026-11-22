//! Linux capture for realtime recognition (decision 2 of #733): one PipeWire node through the
//! capture stream of `vrct-audio-routing` (`pipewire::capture::PipeWireCapture`), the same
//! capture the voice conversion uses. Python started the `vrct-asr-capture` helper for it
//! ([`capture_pipewire.py`]); the checks of the endpoint before it starts are that helper's, and
//! so are the failure codes (`asr_capture_*`).
//!
//! Without the `pipewire` feature nothing is listed and nothing opens.
//!
//! [`capture_pipewire.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/capture_pipewire.py

use crate::capture::{Capture, OnAudio, OnError, Source, media_class};
use crate::endpoint_choice;
use vrct_audio_routing::graph::Endpoint;

#[cfg(feature = "pipewire")]
fn read_graph() -> Result<std::sync::Arc<vrct_audio_routing::graph::Graph>, String> {
    vrct_audio_routing::pipewire::read_graph_data(true, None).map_err(|_| "realtime_graph_unavailable".to_string())
}

#[cfg(not(feature = "pipewire"))]
fn read_graph() -> Result<std::sync::Arc<vrct_audio_routing::graph::Graph>, String> {
    Err("realtime_graph_unavailable".into())
}

/// `enumerate_endpoints`: explicit microphone sources or speaker sinks.
pub fn endpoints(source: Source) -> Result<Vec<(Endpoint, String)>, String> {
    let graph = read_graph()?;
    let mut rows = Vec::new();
    for item in vrct_audio_routing::graph::nodes(&graph) {
        let Some(name) = vrct_audio_routing::graph::node_name(item) else { continue };
        let Ok(endpoint) = endpoint_choice::select(&graph, name, source) else { continue };
        let label = vrct_audio_routing::graph::props(item)
            .and_then(|p| p.get("node.description"))
            .and_then(|v| v.as_str())
            .filter(|l| !l.is_empty())
            .unwrap_or(name)
            .to_string();
        rows.push((endpoint, label));
    }
    Ok(rows)
}

/// `default_endpoint`: the session's default, or its configured one when the default is VRCT's
/// (the choice is [`endpoint_choice::default_endpoint`]).
pub fn default_endpoint(source: Source) -> Result<Endpoint, String> {
    let graph = read_graph().map_err(|_| "realtime_default_endpoint_missing".to_string())?;
    endpoint_choice::default_endpoint(&graph, source)
}

/// Opens `endpoint` for `source` once the graph confirms it is still the node it was chosen as,
/// and waits for its first audio ([`crate::capture::start_until_audio`]). A microphone is read
/// from its source node, a speaker from its sink's monitor.
pub fn open(endpoint: &Endpoint, source: Source, on_audio: OnAudio, on_error: OnError) -> Result<Box<dyn Capture>, String> {
    if endpoint.media_class != media_class(source) || endpoint_choice::refused_name(&endpoint.name) {
        return Err("asr_capture_endpoint_invalid".into());
    }
    let graph = read_graph().map_err(|_| "asr_capture_endpoint_changed".to_string())?;
    if endpoint_choice::select(&graph, &endpoint.name, source).ok().as_ref() != Some(endpoint) {
        return Err("asr_capture_endpoint_changed".into());
    }
    #[cfg(feature = "pipewire")]
    {
        // The stream's name is one `endpoint_choice` never offers as an endpoint.
        let (endpoint, name) = (endpoint.clone(), vrct_audio_routing::graph::asr_capture_stream(source.as_str()));
        crate::capture::start_until_audio(
            move |callbacks| Box::new(vrct_audio_routing::pipewire::capture::PipeWireCapture::new(endpoint, &name, callbacks)),
            on_audio,
            on_error,
            crate::capture::FIRST_AUDIO_WAIT,
        )
    }
    #[cfg(not(feature = "pipewire"))]
    {
        let _ = (on_audio, on_error);
        Err("asr_capture_stream_create_failed".into())
    }
}
