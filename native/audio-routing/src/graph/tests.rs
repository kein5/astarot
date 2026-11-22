use serde_json::json;

use super::*;

fn node(id: u64, name: &str, media: &str, serial: Value, extra: Value) -> Value {
    let mut props = json!({"node.name": name, "media.class": media, "object.serial": serial});
    if let (Some(props), Some(extra)) = (props.as_object_mut(), extra.as_object()) {
        props.extend(extra.clone());
    }
    json!({"type": NODE, "id": id, "info": {"props": props, "params": {"Props": [{"mute": true}]}}})
}

fn graph() -> Graph {
    vec![
        json!({"type": CORE, "info": {"cookie": 42}}),
        node(10, "external.source", "Audio/Source", json!(110), json!({})),
        node(11, VC_SINK, "Audio/Sink", json!(111), json!({"astarot.managed.route": "v1"})),
    ]
}

#[test]
fn selection_rejects_unsafe_or_ambiguous_source() {
    let ok = select_source(&graph(), "external.source").unwrap();
    assert_eq!(ok, Endpoint { cookie: 42, serial: 110, name: "external.source".into(), media_class: "Audio/Source".into() });
    for fault in ["absent", "duplicate", "class", "feedback", "cookie", "serial", "marked", "legacy_feedback", "legacy_marked"] {
        if fault.starts_with("legacy") && !audio_route::READS_LEGACY_NAMES {
            continue;
        }
        let mut data = graph();
        let mut name = "external.source".to_owned();
        match fault {
            "absent" => {
                data.remove(1);
            }
            "duplicate" => data.push(data[1].clone()),
            "class" => data[1]["info"]["props"]["media.class"] = json!("Audio/Sink"),
            "feedback" => {
                name = MANAGED_SOURCE.into();
                data[1]["info"]["props"]["node.name"] = json!(name);
            }
            "cookie" => data[0]["info"]["cookie"] = json!(true),
            "serial" => data[1]["info"]["props"]["object.serial"] = json!("110"),
            // A route or a bridge of 0.6.0 and earlier feeds a virtual microphone too (ADR-014, 2.11).
            "legacy_feedback" => {
                name = "vrct.managed.source".into();
                data[1]["info"]["props"]["node.name"] = json!(name);
            }
            "legacy_marked" => data[1]["info"]["props"]["vrct.source.bridge"] = json!("v1"),
            _ => data[1]["info"]["props"]["astarot.source.bridge"] = json!("v1"),
        }
        assert!(select_source(&data, &name).is_err(), "{fault}");
    }
}

#[test]
fn ipc_identity_keeps_64_bit_serials_and_refuses_lookalikes() {
    let source = Endpoint { cookie: u32::MAX, serial: u64::MAX, name: "mic".into(), media_class: "Audio/Source".into() };
    let id = SourceId::from(&source).to_json();
    assert_eq!(id["serial"], json!("18446744073709551615"));
    assert_eq!(parse_source(&id).unwrap(), source);
    let bad = [
        json!({"cookie": "1", "serial": "2", "name": "mic"}),
        json!({"cookie": "01", "serial": "2", "name": "mic", "media_class": "Audio/Source"}),
        json!({"cookie": "4294967296", "serial": "2", "name": "mic", "media_class": "Audio/Source"}),
        json!({"cookie": 1, "serial": "2", "name": "mic", "media_class": "Audio/Source"}),
        json!({"cookie": "1", "serial": "2", "name": "astarot.managed.source", "media_class": "Audio/Source"}),
        json!({"cookie": "1", "serial": "2", "name": "astarot.source-bridge.tag.playback", "media_class": "Audio/Source"}),
        json!({"cookie": "1", "serial": "2", "name": "mic", "media_class": "Audio/Sink"}),
        json!({"cookie": "1", "serial": "2", "name": "", "media_class": "Audio/Source"}),
    ];
    for value in bad {
        assert_eq!(parse_source(&value).unwrap_err(), Error::value("source_bridge_source_invalid"), "{value}");
    }
}

fn with_default(mut data: Graph, entries: Value) -> Graph {
    data.push(json!({"type": METADATA, "props": {"metadata.name": "default"}, "metadata": entries}));
    data
}

#[test]
fn microphone_list_skips_virtual_inputs_and_follows_the_real_default() {
    let mut data = graph();
    data.push(node(12, "usb.mic", "Audio/Source", json!(112), json!({"node.description": "Headset"})));
    data.push(node(13, "usb.mic2", "Audio/Source", json!(113), json!({"node.description": "Headset"})));
    data.push(node(14, MANAGED_SOURCE, "Audio/Source", json!(114), json!({"astarot.managed.route": "v1"})));
    let data = with_default(
        data,
        json!([{"subject": 0, "key": "default.audio.source", "value": {"name": MANAGED_SOURCE}}, {"subject": 0, "key": "default.configured.audio.source", "value": "{\"name\": \"usb.mic2\"}"}]),
    );
    let (devices, default) = microphone_devices(&data);
    let names: Vec<&str> = devices.iter().map(|d| d.name.as_str()).collect();
    assert_eq!(names, ["external.source", "Headset (usb.mic)", "Headset (usb.mic2)"]);
    assert_eq!(default.unwrap().node_name.as_deref(), Some("usb.mic2"));
    let (_, first) = microphone_devices(&graph());
    assert_eq!(first.unwrap().node_name.as_deref(), Some("external.source"));
    assert_eq!(microphone_devices(&[]), (vec![], None));
}

#[test]
fn default_output_reads_subject_zero_and_falls_back_to_configured() {
    let data = with_default(
        graph(),
        json!([{"subject": 5, "key": "default.audio.sink", "value": {"name": "other"}}, {"subject": 0, "key": "default.configured.audio.sink", "value": "{\"name\":\"speakers\"}"}]),
    );
    assert_eq!(default_output(&data).unwrap(), "speakers");
    assert_eq!(default_output(&graph()).unwrap_err(), Error::speech("output_missing"));
}

#[test]
fn outputs_are_sinks_by_node_name() {
    let mut data = graph();
    data.push(node(15, "alsa.out", "Audio/Sink", json!(115), json!({"node.description": "Speakers"})));
    let outputs = enumerate_outputs(&data).unwrap();
    assert_eq!(outputs, [OutputOption { id: VC_SINK.into(), label: VC_SINK.into() }, OutputOption { id: "alsa.out".into(), label: "Speakers".into() }]);
}

fn managed() -> Graph {
    let mut data = vec![json!({"type": CORE, "info": {"cookie": 7}})];
    for (i, (name, media)) in REQUIRED.iter().enumerate() {
        data.push(node(20 + i as u64, name, media, json!(200 + i as u64), json!({"astarot.managed.route": "v1"})));
    }
    data
}

#[test]
fn managed_route_requires_every_endpoint_exactly_once() {
    assert_eq!(parse_managed(&managed(), false).unwrap(), GateState { identity: (7, 200), muted: true });
    assert_eq!(parse_managed(&managed(), true).unwrap(), GateState { identity: (7, 202), muted: true });
    assert!(managed_ready(&managed()));
    let faults: [fn(&mut Graph); 6] = [
        |g| {
            g.remove(2);
        },
        |g| g.push(g[1].clone()),
        |g| g[1]["info"]["props"]["astarot.managed.route"] = json!("v2"),
        |g| g[1]["info"]["params"]["Props"] = json!([{"mute": true}, {"mute": false}]),
        |g| g[1]["info"]["params"]["Props"] = json!([{"mute": 1}]),
        |g| g.push(json!({"type": CORE, "info": {"cookie": 8}})),
    ];
    for fault in faults {
        let mut data = managed();
        fault(&mut data);
        assert_eq!(parse_managed(&data, false).unwrap_err(), Error::runtime("managed_endpoint_missing_or_invalid"));
    }
}

fn bridged(fault: &str) -> Graph {
    let mut data = graph();
    for (id, suffix, media, serial) in [(20, "capture", "Stream/Input/Audio", 120), (21, "playback", "Stream/Output/Audio", 121)] {
        data.push(node(id, &format!("astarot.source-bridge.tag.{suffix}"), media, json!(serial), json!({"astarot.source.bridge": "v1", "client.id": 30})));
    }
    for (a, b) in [(10, 20), (21, 11)] {
        data.push(json!({"type": LINK, "info": {"output-node-id": a, "input-node-id": b, "state": "active"}}));
    }
    match fault {
        "missing_link" => {
            data.pop();
        }
        "wrong_link" => data[6]["info"]["input-node-id"] = json!(99),
        "extra_link" => data.push(json!({"type": LINK, "info": {"output-node-id": 99, "input-node-id": 20, "state": "active"}})),
        "owner" => data[4]["info"]["props"]["client.id"] = json!(999),
        "state" => data[5]["info"]["state"] = json!("error"),
        _ => {}
    }
    data.push(json!({"id": 30, "type": CLIENT, "info": {"props": {"pipewire.sec.pid": 1234}}}));
    data
}

#[test]
fn bridge_links_need_complete_owned_links() {
    let source = select_source(&graph(), "external.source").unwrap();
    let sink = vc_sink(&graph()).unwrap();
    let playback = bridge_links(&bridged(""), &source, &sink, "tag", 1234, true).unwrap();
    assert_eq!(playback.serial, 121);
    assert_eq!(bridge_links(&bridged(""), &source, &sink, "tag", 1234, false).unwrap_err(), Error::runtime("source_bridge_mute_unconfirmed"));
    assert_eq!(bridge_links(&bridged(""), &source, &sink, "tag", 99, true).unwrap_err(), Error::runtime("source_bridge_stream_owner_invalid"));
    for (fault, code) in [
        ("missing_link", "source_bridge_links_missing"),
        ("wrong_link", "source_bridge_links_invalid"),
        ("extra_link", "source_bridge_links_invalid"),
        ("owner", "source_bridge_stream_owner_invalid"),
        ("state", "source_bridge_links_invalid"),
    ] {
        assert_eq!(bridge_links(&bridged(fault), &source, &sink, "tag", 1234, true).unwrap_err(), Error::runtime(code), "{fault}");
    }
    let mut replaced = bridged("");
    replaced[1]["info"]["props"]["object.serial"] = json!(999);
    assert_eq!(bridge_links(&replaced, &source, &sink, "tag", 1234, true).unwrap_err(), Error::runtime("source_bridge_endpoint_changed"));
}

#[test]
fn the_route_names_begin_with_its_prefix() {
    let prefix = audio_route::NODE_PREFIX.current();
    assert_eq!(prefix, "astarot.managed.");
    for name in [MANAGED_SOURCE, TTS_SINK, VC_SINK, MIX_SINK] {
        assert!(name.starts_with(prefix), "{name}");
        assert!(is_virtual_name(name), "{name}");
    }
    assert_eq!(ROUTE_PROPERTY, "astarot.managed.route");
    assert_eq!(BRIDGE_PROPERTY, "astarot.source.bridge");
    assert_eq!(bridge_stream("0123", "playback"), "astarot.source-bridge.0123.playback");
    // A route of 0.6.0 and earlier is not this route: its marker does not count.
    let mut data = managed();
    for item in data.iter_mut().skip(1) {
        let props = item["info"]["props"].as_object_mut().unwrap();
        props.remove("astarot.managed.route");
        props.insert("vrct.managed.route".into(), json!("v1"));
    }
    assert!(!managed_ready(&data));
}
