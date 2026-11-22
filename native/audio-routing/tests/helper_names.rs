//! The C helpers spell the route's names themselves. They ship with the app, so they act on the
//! names this build writes and on no other (ADR-014, 2.8). The private-graph tests run them; this
//! one reads their sources, so it also runs where PipeWire does not.

use astarot_audio_routing::graph::{bridge_stream, BRIDGE_PROPERTY, MANAGED_SOURCE, ROUTE_PROPERTY, VC_SINK};

#[test]
fn the_voice_gate_names_the_route_as_this_build_does() {
    let source = include_str!("../../voice-gate/main.c");
    for name in [MANAGED_SOURCE, VC_SINK, ROUTE_PROPERTY, BRIDGE_PROPERTY] {
        assert!(source.contains(&format!("\"{name}\"")), "{name}");
    }
    assert!(source.contains(&format!("\"{}\"", bridge_stream("%s", "playback"))));
    assert!(!source.to_ascii_lowercase().contains("vrct"));
}

#[test]
fn the_screen_capture_names_its_stream_astarot() {
    let source = include_str!("../../screen-capture/main.c");
    assert!(source.contains("\"astarot.screen-capture\""));
    assert!(!source.to_ascii_lowercase().contains("vrct"));
}
