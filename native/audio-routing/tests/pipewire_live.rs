//! Checks against the running PipeWire session. Ignored by default; run with
//! `cargo test --test pipewire_live -- --ignored` on a Linux desktop.
#![cfg(target_os = "linux")]

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
    assert_eq!(graph::enumerate_outputs(&native), graph::enumerate_outputs(&dumped));
}
