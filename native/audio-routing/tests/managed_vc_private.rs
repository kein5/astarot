//! The devices of a conversion on the managed route (decision 11 in
//! `docs/voice-stack/core-integration.md`) on a private PipeWire graph: the binding to the
//! managed VC input, the capture of the microphone and the output into the VC input.
//!
//! Ignored by default: it starts `pipewire`, `wireplumber` and `pw-loopback` of its own. The
//! Linux CI runs it (`cargo test --test managed_vc_private -- --ignored`). The user's own graph
//! is not touched.
#![cfg(all(target_os = "linux", feature = "pipewire"))]

mod private_graph;

use std::sync::atomic::Ordering;
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

use private_graph::{dump, microphone, tone, wait, PrivateGraph};
use vrct_audio_routing::graph::{self, Endpoint};
use vrct_audio_routing::managed_vc::{ManagedVcDevices, PipeWireVcDevices};
use vrct_audio_routing::pipewire::read_graph_data;
use vrct_audio_routing::router::CancelToken;
use vrct_audio_routing::windows_route::CaptureCallbacks;

const MIC: &str = "vrct.test.mic";

/// A capture's audio and its one error.
fn callbacks() -> (CaptureCallbacks, Receiver<Vec<u8>>, Receiver<String>) {
    let (audio, heard) = channel();
    let (error, failed) = channel();
    let callbacks = CaptureCallbacks {
        on_audio: Box::new(move |pcm: &[u8]| audio.send(pcm.to_vec()).is_ok()),
        on_error: Box::new(move |code: &str| {
            let _ = error.send(code.to_owned());
        }),
    };
    (callbacks, heard, failed)
}

fn rms(pcm: &[u8]) -> f64 {
    let samples: Vec<f64> = pcm.as_chunks::<2>().0.iter().map(|s| f64::from(i16::from_le_bytes(*s))).collect();
    (samples.iter().map(|s| s * s).sum::<f64>() / samples.len().max(1) as f64).sqrt()
}

/// One graph for every case: the environment that points at it is the process's.
#[test]
#[ignore = "starts a private PipeWire, WirePlumber and pw-loopback; the Linux CI runs it"]
fn a_conversion_captures_its_microphone_and_plays_into_the_managed_vc_input() {
    let _graph = PrivateGraph::start("vrct-vc-test");
    let mut loopback = microphone(MIC);
    let data = read_graph_data(true, None).expect("the graph");
    let source = graph::endpoint(&data, &format!("{MIC}.source"), "Audio/Source").expect("the virtual microphone");
    let devices = PipeWireVcDevices::new();

    // The binding: the managed VC input, while the microphone is the one chosen.
    let sink = devices.bind(&source, true).expect("the binding");
    assert_eq!(sink.name, graph::VC_SINK);
    assert_eq!(devices.bind(&source, false).expect("the binding from the observation"), sink);
    let moved = Endpoint { serial: source.serial + 1000, ..source.clone() };
    assert_eq!(devices.bind(&moved, true).unwrap_err().code, "vc_source_changed");
    let managed = graph::endpoint(&data, graph::MANAGED_SOURCE, "Audio/Source").expect("the managed microphone");
    assert_eq!(devices.bind(&managed, true).unwrap_err().code, "source_bridge_feedback_source", "the route's own microphone would feed back");

    // A microphone that is no longer the node it was chosen as is not captured.
    let (refused, _, _) = callbacks();
    assert_eq!(devices.capture(&moved, refused).start().unwrap_err().code, "asr_capture_endpoint_changed");

    // The capture hears what the microphone gives, at 48 kHz mono s16le.
    let playing = tone(&format!("{MIC}.sink"));
    let (callbacks, heard, failed) = callbacks();
    let mut capture = devices.capture(&source, callbacks);
    capture.start().expect("the capture starts");
    let started = Instant::now();
    let mut pcm = Vec::new();
    while started.elapsed() < Duration::from_secs(4) && rms(&pcm[pcm.len().saturating_sub(9600)..]) < 1000.0 {
        if let Ok(block) = heard.recv_timeout(Duration::from_millis(100)) {
            pcm.extend(block);
        }
    }
    assert!(rms(&pcm[pcm.len().saturating_sub(9600)..]) >= 1000.0, "the tone was not heard ({} bytes)", pcm.len());
    let counted = Instant::now();
    let mut second = 0;
    while counted.elapsed() < Duration::from_secs(1) {
        if let Ok(block) = heard.recv_timeout(Duration::from_millis(100)) {
            second += block.len();
        }
    }
    assert!((76_800..=115_200).contains(&second), "{second} bytes in a second, not 96 000");
    assert!(failed.try_recv().is_err());

    // The converted voice goes into the managed VC input, held to its identity.
    let mut output = devices.open_output(&sink).expect("the output opens");
    let token = CancelToken::new(None);
    output.write(&vec![0u8; 19_200], &token).expect("the output takes audio");
    wait("the output's link into the VC input", || {
        let objects = dump();
        let id = |name: &str| objects.iter().find(|o| o["info"]["props"]["node.name"] == name).and_then(|o| o["id"].as_u64());
        let (Some(from), Some(to)) = (id("astarot.vc"), id(graph::VC_SINK)) else { return false };
        objects.iter().any(|o| o["type"] == graph::LINK && o["info"]["output-node-id"] == from && o["info"]["input-node-id"] == to)
    });
    let _ = output.close(false, &token);

    // Losing the microphone ends the capture with a code, once.
    playing.store(true, Ordering::SeqCst);
    let _ = loopback.kill();
    let _ = loopback.wait();
    let code = failed.recv_timeout(Duration::from_secs(4)).expect("the loss is told");
    assert!(["asr_capture_stream_disconnected", "asr_capture_stalled"].contains(&code.as_str()), "{code}");
    capture.stop();
    assert!(failed.try_recv().is_err(), "told twice");
}
