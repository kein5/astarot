//! Checks against the running PipeWire session. Ignored by default; run with
//! `cargo test --test pipewire_live -- --ignored` on a Linux desktop.
#![cfg(all(target_os = "linux", feature = "pipewire"))]
#![allow(clippy::type_complexity)]

use std::collections::BTreeMap;
use std::process::Command;

use serde_json::Value;
use vrct_audio_routing::graph::{self, kind, node_name, props, NODE};
use vrct_audio_routing::pipewire::read_graph;

fn summary(data: &[Value]) -> BTreeMap<String, (Option<Value>, Option<Value>, Vec<Value>)> {
    data.iter()
        .filter(|item| kind(item) == Some(NODE))
        .filter_map(|item| {
            let name = node_name(item)?.to_owned();
            let p = props(item)?;
            let mute: Vec<Value> = item["info"]["params"]["Props"].as_array().into_iter().flatten().filter_map(|p| p.get("mute").cloned()).collect();
            Some((name, (p.get("object.serial").cloned(), p.get("media.class").cloned(), mute)))
        })
        .collect()
}

#[test]
#[ignore = "needs a running PipeWire session"]
fn native_snapshot_agrees_with_pw_dump() {
    let native = read_graph(true, None).expect("graph").data.expect("data");
    let output = Command::new("pw-dump").output().expect("pw-dump");
    let dumped: Vec<Value> = serde_json::from_slice(&output.stdout).expect("json");
    let (ours, theirs) = (summary(&native), summary(&dumped));
    assert!(!ours.is_empty());
    for (name, value) in &theirs {
        if let Some(mine) = ours.get(name) {
            assert_eq!(mine, value, "{name}");
        }
    }
    // Nodes may come and go between the two reads, but not many.
    let missing = theirs.keys().filter(|name| !ours.contains_key(*name)).count();
    assert!(missing <= 2, "{missing} nodes missing");
    let cores: Vec<&Value> = native.iter().filter(|i| kind(i) == Some(graph::CORE)).collect();
    let dumped_cookie = dumped.iter().find(|i| kind(i) == Some(graph::CORE)).map(|i| i["info"]["cookie"].clone());
    assert_eq!(cores.len(), 1);
    assert_eq!(Some(cores[0]["info"]["cookie"].clone()), dumped_cookie);
    assert_eq!(graph::default_output(&native).ok(), graph::default_output(&dumped).ok());
    assert_eq!(graph::microphone_devices(&native), graph::microphone_devices(&dumped));
    // Another test may add its temporary sink between the two reads.
    let outputs = |data: &[Value]| graph::enumerate_outputs(data).unwrap().into_iter().filter(|o| !o.id.starts_with("vrct.test.")).collect::<Vec<_>>();
    assert_eq!(outputs(&native), outputs(&dumped));
}

/// A temporary silent sink, owned by a connection on its own thread. It disappears
/// when the returned sender is dropped.
fn null_sink(name: &str) -> std::sync::mpsc::Sender<()> {
    use pipewire as pw;
    let (stop, stopped) = std::sync::mpsc::channel::<()>();
    let (ready, started) = std::sync::mpsc::channel();
    let name = name.to_owned();
    std::thread::spawn(move || {
        pw::init();
        let mainloop = pw::main_loop::MainLoopRc::new(None).unwrap();
        let context = pw::context::ContextRc::new(&mainloop, None).unwrap();
        let core = context.connect_rc(None).unwrap();
        let _node: pw::node::Node = core
            .create_object(
                "adapter",
                &pw::properties::properties! {
                    "factory.name" => "support.null-audio-sink",
                    "node.name" => name.as_str(),
                    "media.class" => "Audio/Sink",
                    "audio.channels" => "1",
                    "object.linger" => "false",
                },
            )
            .unwrap();
        let mut announced = false;
        loop {
            mainloop.loop_().iterate(pw::loop_::Timeout::Finite(std::time::Duration::from_millis(10)));
            if !announced {
                announced = true;
                ready.send(()).unwrap();
            }
            if !matches!(stopped.try_recv(), Err(std::sync::mpsc::TryRecvError::Empty)) {
                break;
            }
        }
    });
    started.recv().unwrap();
    stop
}

fn wait_for_sink(name: &str) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        if let Ok(outputs) = vrct_audio_routing::pipewire::output::enumerate_outputs() {
            if outputs.iter().any(|o| o.id == name) {
                return;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    panic!("test sink did not appear");
}

#[test]
#[ignore = "needs a running PipeWire session"]
fn stream_plays_to_an_explicit_sink_and_reports_its_loss() {
    use vrct_audio_routing::pipewire::output::PipeWireOutput;
    use vrct_audio_routing::router::{CancelToken, Output};
    use vrct_audio_routing::Error;

    let missing = PipeWireOutput::open("vrct.test.absent", 24000, 1, None, "vrct.tts");
    assert_eq!(missing.err(), Some(Error::speech("output_missing")));

    let name = format!("vrct.test.sink.{}", std::process::id());
    let sink = null_sink(&name);
    wait_for_sink(&name);
    let token = CancelToken::default();
    let mut output = PipeWireOutput::open(&name, 24000, 1, None, "vrct.tts").expect("open");
    let silence = vec![0u8; 480];
    let started = std::time::Instant::now();
    for _ in 0..25 {
        output.write(&silence, &token).expect("write");
    }
    // 250 ms of audio through an 85 ms buffer: the writes waited for playback.
    assert!(started.elapsed() >= std::time::Duration::from_millis(100), "{:?}", started.elapsed());
    output.close(true, &token).expect("drain");

    let mut output = PipeWireOutput::open(&name, 24000, 1, None, "vrct.tts").expect("open");
    output.write(&silence, &token).expect("write");
    drop(sink);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    let error = loop {
        match output.write(&silence, &token) {
            Err(error) => break error,
            Ok(()) if std::time::Instant::now() < deadline => continue,
            Ok(()) => panic!("loss not reported"),
        }
    };
    assert_eq!(error, Error::speech("output_disconnected"));
    output.close(false, &token).unwrap();
}

#[test]
#[ignore = "needs a running PipeWire session"]
fn device_manager_lists_the_same_inputs_as_the_graph() {
    use std::sync::Arc;
    use vrct_audio_routing::manager::{platform_backend, DeviceManager};
    use vrct_audio_routing::report::StderrReporter;

    let manager = DeviceManager::new(platform_backend(Arc::new(StderrReporter)), Arc::new(StderrReporter));
    let data = read_graph(true, None).unwrap().data.unwrap();
    let (devices, default) = graph::microphone_devices(&data);
    let snapshot = manager.snapshot();
    if devices.is_empty() {
        assert_eq!(snapshot.mic_hosts(), ["NoHost"]);
        return;
    }
    let listed = snapshot.mics("PipeWire").expect("PipeWire host");
    assert_eq!(listed.iter().map(|d| d.name.clone()).collect::<Vec<_>>(), devices.iter().map(|d| d.name.clone()).collect::<Vec<_>>());
    assert!(listed.iter().all(|d| d.id.as_deref() == Some(format!("pipewire:{}", d.node_name.as_deref().unwrap()).as_str())));
    assert_eq!(snapshot.default_mic_device.device.node_name, default.unwrap().node_name);
}

#[test]
#[ignore = "needs a running PipeWire session"]
fn objects_that_come_and_go_leave_the_observation_fresh() {
    // Short-lived streams, as the gate helper's own while it mutes or resumes the managed
    // source: the observation may bind one just as it goes. Each read that asks for an
    // observation taken after it still gets one, while 30 streams come and go.
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;
    use vrct_audio_routing::pipewire::read_graph_data;
    use vrct_audio_routing::sync::monotonic;
    read_graph(true, None).expect("graph");
    let (stop, started) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicUsize::new(0)));
    let churn = {
        let (stop, started) = (stop.clone(), started.clone());
        std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                let _ = Command::new("pw-cat")
                    .args(["--playback", "--raw", "--rate", "48000", "--channels", "1", "-"])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
                started.fetch_add(1, Ordering::SeqCst);
            }
        })
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let (mut reads, mut failed) = (0, 0);
    while started.load(Ordering::SeqCst) < 30 && std::time::Instant::now() < deadline {
        reads += 1;
        if read_graph_data(true, Some(monotonic())).is_err() {
            failed += 1;
        }
    }
    stop.store(true, Ordering::SeqCst);
    churn.join().unwrap();
    let started = started.load(Ordering::SeqCst);
    assert!(started >= 30, "only {started} streams came and went");
    assert_eq!(failed, 0, "{failed} of {reads} reads found no fresh observation while {started} streams came and went");
}
