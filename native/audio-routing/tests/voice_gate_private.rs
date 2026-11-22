//! The real `astarot-voice-gate` on a private PipeWire graph (decision 89 in
//! `docs/voice-stack/core-integration.md`): the C helper refuses, by itself, a node whose
//! identity is not the one it was given, and a resume whose direct branch is not as expected.
//! `pipewire/gate.rs` tests the Rust side with a fake helper; this is the helper's own part, as
//! `tests/voice/test_spoken_route_native.py` checked it in Python.
//!
//! Ignored by default: it starts `pipewire` and `wireplumber` of its own and builds the helper
//! with `cc` and libpipewire's development files. The Linux CI runs it
//! (`cargo test --test voice_gate_private -- --ignored`). The user's own graph is not touched.
#![cfg(all(target_os = "linux", feature = "pipewire"))]

mod private_graph;

use std::process::Command;
use std::time::Duration;

use private_graph::{PrivateGraph, build_helper};
use vrct_audio_routing::pipewire::gate::PipeWireGate;
use vrct_audio_routing::process::ProcessEnv;
use vrct_audio_routing::sync::monotonic;
use vrct_audio_routing::voice_route::Gate;

/// Runs the helper as the gate would, and says whether it succeeded.
fn helper(binary: &std::path::Path, args: &[String]) -> bool {
    let mut child = Command::new(binary).args(args).spawn().expect("the helper starts");
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child.try_wait().expect("the helper's status") {
            return status.success();
        }
        assert!(std::time::Instant::now() < deadline, "the helper did not end within 3 s");
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Both cases share one graph: the environment that points at it is the process's.
#[test]
#[ignore = "starts a private PipeWire and WirePlumber and builds astarot-voice-gate; the Linux CI runs it"]
fn the_gate_helper_refuses_what_it_was_not_given() {
    let graph = PrivateGraph::start("vrct-gate-test");
    let binary = build_helper("voice-gate", &graph.dir);
    let gate = PipeWireGate::new(binary.clone(), ProcessEnv::default());

    // `test_direct_gate_targets_only_bound_vc_sink`: the VC input is muted only by its own
    // cookie and serial, and only through the `vc` selector.
    let pair = gate.inspect_pair().expect("the managed route is in the graph");
    let direct = pair.direct.identity;
    assert!(gate.set_direct_muted(true, direct).expect("the VC input mutes").muted);
    assert!(gate.inspect(None).expect("the source").muted, "the main source is muted from its start, on its own");
    for (cookie, serial, selector) in [(direct.0 + 1, direct.1, "vc"), (direct.0, direct.1 + 1, "vc"), (direct.0, direct.1, "vrct.managed.tts")] {
        let args = [cookie.to_string(), serial.to_string(), "0".into(), selector.into()];
        assert!(!helper(&binary, &args), "the helper unmuted with {args:?}");
        let state = gate.inspect(Some(monotonic())).expect("the source");
        assert!(state.muted, "{args:?} changed the main source");
        assert!(gate.inspect_pair().expect("the pair").direct.muted, "{args:?} changed the VC input");
    }
    assert!(!gate.set_direct_muted(false, direct).expect("the VC input unmutes").muted);
    assert!(gate.inspect(None).expect("the source").muted, "the main source stayed muted");

    // `test_native_resume_checks_direct_identity_and_suppression`: a resume opens the main
    // source only when the VC input is the expected node in the expected state.
    let pair = gate.inspect_pair().expect("the pair");
    let (cookie, serial) = pair.source.identity;
    let direct = pair.direct.identity;
    gate.set_direct_muted(true, direct).expect("the VC input mutes");
    for (expected_serial, suppressed, opens) in [(direct.1 + 1, true, false), (direct.1, false, false), (direct.1, true, true)] {
        let args = [
            cookie.to_string(),
            serial.to_string(),
            "0".into(),
            "guard-direct".into(),
            expected_serial.to_string(),
            if suppressed { "1" } else { "0" }.into(),
        ];
        assert_eq!(helper(&binary, &args), opens, "{args:?}");
        assert_eq!(gate.inspect(Some(monotonic())).expect("the source").muted, !opens, "{args:?}");
    }
    gate.set_muted(true, (cookie, serial)).expect("the main source mutes again");
}
