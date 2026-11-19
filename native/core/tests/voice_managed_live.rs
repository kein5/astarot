//! A conversion on the managed route from end to end (decision 11 in
//! `docs/voice-stack/core-integration.md`): a virtual microphone on a private PipeWire graph is
//! captured, converted by the stand-in worker (`fake-rvc-worker`) and played into the managed VC
//! input. The core's own tests check the same with fake devices (`voice.rs`).
//!
//! Ignored by default, and built only with the `pipewire` feature: it starts `pipewire`,
//! `wireplumber` and `pw-loopback` of its own. Run it with
//! `cargo test --features pipewire --test voice_managed_live -- --ignored`. The user's own graph
//! is not touched.
#![cfg(all(target_os = "linux", feature = "pipewire"))]

#[path = "../../audio-routing/tests/private_graph/mod.rs"]
mod private_graph;

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use private_graph::{PrivateGraph, dump, microphone, tone, wait};
use serde_json::json;
use vrct_audio_routing::graph;
use vrct_audio_routing::managed_vc::PipeWireVcDevices;
use vrct_audio_routing::pipewire::read_graph_data;
use vrct_voice_conversion::{ManagedRoute, VcProcess};

#[test]
#[ignore = "starts a private PipeWire, WirePlumber and pw-loopback; run it with --features pipewire"]
fn a_conversion_on_the_managed_route_plays_into_the_vc_input() {
    // The conversion's clock counts from its first reading. In the app it has run long before a
    // conversion starts; here the graph's start gives it that time.
    vrct_audio_routing::sync::monotonic_ns();
    let _graph = PrivateGraph::start("vrct-vc-live");
    let mut loopback = microphone("vrct.test.mic");
    let playing = tone("vrct.test.mic.sink");
    let data = read_graph_data(true, None).expect("the graph");
    let source = graph::endpoint(&data, "vrct.test.mic.source", "Audio/Source").expect("the virtual microphone");

    // A runtime folder the stand-in worker accepts, and a model it converts with.
    let files = tempfile::tempdir().unwrap();
    let runtime = files.path().join("rvc");
    std::fs::create_dir_all(runtime.join("lib")).unwrap();
    std::fs::write(runtime.join("lib").join(vrct_voice_conversion::worker::ort_library()), b"x").unwrap();
    for asset in vrct_voice_conversion::worker::ASSETS {
        let path = runtime.join("assets").join(asset);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }
    let model = files.path().join("voice.pth");
    std::fs::write(&model, "convert").unwrap();
    let options = json!({ "engine": "rvc", "runtime": runtime.to_str().unwrap(), "model": model.to_str().unwrap(), "index": "", "pitch": 0, "index_rate": 0 });

    let route = Arc::new(ManagedRoute::new(Arc::new(PipeWireVcDevices::new()), Arc::new(vrct_audio_routing::monitor::open_monitor_output)));
    let worker = Path::new(env!("CARGO_BIN_EXE_fake-rvc-worker"));
    let process = VcProcess::rvc(&options, worker, route, None).expect("the conversion is made");
    process.start(source).expect("the conversion starts");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let health = process.health();
        if health.conversion_verified && health.converted_blocks >= 25 {
            break;
        }
        assert!(Instant::now() < deadline, "the conversion did not run: {health:?}");
        assert!(health.error.is_none(), "{health:?}");
        std::thread::sleep(Duration::from_millis(50));
    }
    // What it converts is played into the managed VC input.
    wait("the conversion's link into the VC input", || {
        let objects = dump();
        let id = |name: &str| objects.iter().find(|o| o["info"]["props"]["node.name"] == name).and_then(|o| o["id"].as_u64());
        let (Some(from), Some(to)) = (id("vrct.vc"), id(graph::VC_SINK)) else { return false };
        objects.iter().any(|o| o["type"] == graph::LINK && o["info"]["output-node-id"] == from && o["info"]["input-node-id"] == to)
    });
    assert!(process.close(Duration::from_secs(5)), "the conversion did not stop");
    let health = process.health();
    assert!(!health.active && health.error.is_none(), "{health:?}");
    playing.store(true, Ordering::SeqCst);
    let _ = loopback.kill();
    let _ = loopback.wait();
}
