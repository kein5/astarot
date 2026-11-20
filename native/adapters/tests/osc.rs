//! Mirrors `src-python/test/test_osc_*.py` and `test_model_osc_mute_sync.py` (the parts
//! about `osc.py`): wire format, trust in the local VRChat, receive and lifecycle.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, UdpSocket};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use vrct_adapters::osc::mdns::{self, DiscoveredService, Mdns, ServiceSpec};
use vrct_adapters::osc::query::{get_json, host_info_json, Node, QueryService, OSCJSON_TYPE};
use vrct_adapters::osc::{
    decode_packet, local_service_name, pattern_matches, query_parameter_value, uses_osc_query, vrchat_presence, Cancel,
    Discovery, OscArg, OscError, OscHandler, OscMessage, QueryFailed, Target,
};

fn hex(bytes: &str) -> Vec<u8> {
    (0..bytes.len()).step_by(2).map(|i| u8::from_str_radix(&bytes[i..i + 2], 16).unwrap()).collect()
}

// ---------------------------------------------------------------- wire format

#[test]
fn messages_are_the_bytes_python_osc_sends() {
    // Built by python-osc's OscMessageBuilder.
    let input = OscMessage::new(
        "/chatbox/input",
        vec![OscArg::String("こんにちは".into()), OscArg::Bool(true), OscArg::Bool(false)],
    );
    assert_eq!(input.encode(), hex("2f63686174626f782f696e70757400002c73544600000000e38193e38293e381abe381a1e381af00"));
    assert_eq!(
        OscMessage::new("/chatbox/typing", vec![OscArg::Bool(false)]).encode(),
        hex("2f63686174626f782f747970696e67002c460000")
    );
    let mixed =
        OscMessage::new("/avatar/parameters/MuteSelf", vec![OscArg::Bool(true), OscArg::Int(3), OscArg::Float(0.5)]);
    assert_eq!(
        mixed.encode(),
        hex("2f6176617461722f706172616d65746572732f4d75746553656c66002c54696600000000000000033f000000")
    );
    assert_eq!(decode_packet(&mixed.encode()).unwrap(), vec![mixed]);
}

fn bundle(time_tag: u64, contents: &[Vec<u8>]) -> Vec<u8> {
    let mut out = b"#bundle\0".to_vec();
    out.extend_from_slice(&time_tag.to_be_bytes());
    for content in contents {
        out.extend_from_slice(&(content.len() as i32).to_be_bytes());
        out.extend_from_slice(content);
    }
    out
}

#[test]
fn bundles_are_unpacked_in_order_whatever_their_time_tag() {
    let first = OscMessage::new("/mute", vec![OscArg::Bool(true)]);
    let second = OscMessage::new("/mute", vec![OscArg::Bool(false)]);
    let inner = bundle(u64::MAX, &[second.encode()]);
    let outer = bundle(u64::MAX - 1, &[first.encode(), inner]);
    assert_eq!(decode_packet(&outer).unwrap(), vec![first, second]);
}

#[test]
fn malformed_packets_are_refused_whole() {
    let good = OscMessage::new("/mute", vec![OscArg::Int(1)]).encode();
    for bad in [
        b"".to_vec(),
        b"no slash\0\0\0\0".to_vec(),
        good[..good.len() - 1].to_vec(),
        bundle(1, &[good.clone(), b"garbage".to_vec()]),
        [b"/x\0\0,z\0\0".as_slice()].concat(),
    ] {
        assert!(decode_packet(&bad).is_err(), "{bad:?}");
    }
    // Blobs, arrays and the wider types decode too.
    let wide = OscMessage::new(
        "/wide",
        vec![
            OscArg::Blob(vec![1, 2, 3]),
            OscArg::Array(vec![OscArg::Int(1), OscArg::String("a".into())]),
            OscArg::Int64(-5),
            OscArg::Double(1.25),
            OscArg::Nil,
        ],
    );
    assert_eq!(decode_packet(&wide.encode()).unwrap(), vec![wide]);
}

#[test]
fn arrays_nested_deeper_than_bundles_may_are_refused_without_recursing() {
    // #428: thousands of `[` in one type tag string recursed until the stack overflowed.
    let nested = |depth: usize| (0..depth).fold(vec![OscArg::Int(1)], |inner, _| vec![OscArg::Array(inner)]);
    let ok = OscMessage::new("/deep", nested(16));
    assert_eq!(decode_packet(&ok.encode()).unwrap(), vec![ok]);
    assert!(decode_packet(&OscMessage::new("/deep", nested(17)).encode()).is_err());
    let mut hostile = b"/x\0\0,".to_vec();
    hostile.extend(std::iter::repeat_n(b'[', 200_000));
    hostile.extend(std::iter::repeat_n(b']', 200_000));
    hostile.push(0);
    while hostile.len() % 4 != 0 {
        hostile.push(0);
    }
    assert!(decode_packet(&hostile).is_err());
}

#[test]
fn address_patterns_match_like_osc() {
    for (pattern, address, matches) in [
        ("/avatar/parameters/MuteSelf", "/avatar/parameters/MuteSelf", true),
        ("/avatar/parameters/MuteSelf", "/avatar/parameters/MuteSel", false),
        ("/avatar/parameters/*", "/avatar/parameters/MuteSelf", true),
        ("/avatar/*", "/avatar/parameters/MuteSelf", false),
        ("/avatar/parameters/Mute????", "/avatar/parameters/MuteSelf", true),
        ("/avatar/parameters/[LM]uteSelf", "/avatar/parameters/MuteSelf", true),
        ("/avatar/parameters/[!M]uteSelf", "/avatar/parameters/MuteSelf", false),
        ("/avatar/parameters/[A-N]uteSelf", "/avatar/parameters/MuteSelf", true),
        ("/avatar/{change,parameters}/MuteSelf", "/avatar/parameters/MuteSelf", true),
        ("/avatar/{change,other}", "/avatar/change", true),
    ] {
        assert_eq!(pattern_matches(pattern, address), matches, "{pattern} vs {address}");
    }
}

// ---------------------------------------------------------------- OSCQuery JSON

#[test]
fn the_tree_and_host_info_are_the_json_tinyoscquery_served() {
    let mut root = Node::root();
    assert_eq!(root.to_json(), r#"{"FULL_PATH": "/", "DESCRIPTION": "root node"}"#);
    root.advertise("/avatar/parameters/MuteSelf");
    root.advertise("/avatar/change");
    assert_eq!(
        root.to_json(),
        r#"{"CONTENTS": {"avatar": {"CONTENTS": {"parameters": {"CONTENTS": {"MuteSelf": {"FULL_PATH": "/avatar/parameters/MuteSelf", "ACCESS": 3}}, "FULL_PATH": "/avatar/parameters"}, "change": {"FULL_PATH": "/avatar/change", "ACCESS": 3}}, "FULL_PATH": "/avatar"}}, "FULL_PATH": "/", "DESCRIPTION": "root node"}"#
    );
    assert_eq!(
        root.find("/avatar").unwrap().to_json(),
        r#"{"CONTENTS": {"parameters": {"CONTENTS": {"MuteSelf": {"FULL_PATH": "/avatar/parameters/MuteSelf", "ACCESS": 3}}, "FULL_PATH": "/avatar/parameters"}, "change": {"FULL_PATH": "/avatar/change", "ACCESS": 3}}, "FULL_PATH": "/avatar"}"#
    );
    assert_eq!(
        host_info_json("VRCT:123", 54321),
        r#"{"NAME": "VRCT:123", "OSC_IP": "127.0.0.1", "OSC_PORT": 54321, "OSC_TRANSPORT": "UDP", "EXTENSIONS": {"ACCESS": true, "CLIPMODE": false, "RANGE": true, "TYPE": true, "VALUE": true}}"#
    );
}

#[test]
fn the_dns_messages_round_trip() {
    let message = mdns::Message {
        id: 0,
        flags: 0x8400,
        questions: vec![mdns::Question { name: "_oscjson._tcp.local.".into(), qtype: 12, qclass: 1 }],
        answers: vec![
            mdns::Record {
                name: "_oscjson._tcp.local.".into(),
                rtype: 12,
                class: 1,
                ttl: 4500,
                data: mdns::RData::Ptr("VRChat-Client-AB12._oscjson._tcp.local.".into()),
            },
            mdns::Record {
                name: "VRChat-Client-AB12._oscjson._tcp.local.".into(),
                rtype: 33,
                class: 0x8001,
                ttl: 120,
                data: mdns::RData::Srv { priority: 0, weight: 0, port: 4321, target: "host.local.".into() },
            },
        ],
        authorities: vec![],
        additionals: vec![mdns::Record {
            name: "host.local.".into(),
            rtype: 1,
            class: 0x8001,
            ttl: 120,
            data: mdns::RData::A(Ipv4Addr::LOCALHOST),
        }],
    };
    assert_eq!(mdns::decode(&mdns::encode(&message)), Some(message));
    // A compressed name (a pointer back to offset 12) is read too.
    let mut packet = mdns::encode(&mdns::Message {
        questions: vec![mdns::Question { name: "_oscjson._tcp.local.".into(), qtype: 12, qclass: 1 }],
        ..Default::default()
    });
    packet[7] = 1; // one answer
    packet.extend_from_slice(&[0xC0, 12, 0, 12, 0, 1, 0, 0, 0, 10, 0, 2, 0xC0, 12]);
    let decoded = mdns::decode(&packet).unwrap();
    assert_eq!(decoded.answers[0].name, "_oscjson._tcp.local.");
    assert_eq!(decoded.answers[0].data, mdns::RData::Ptr("_oscjson._tcp.local.".into()));
    // A pointer loop is refused, not followed forever.
    let mut looped = packet.clone();
    let at = looped.len() - 2;
    looped[at + 1] = at as u8;
    assert!(mdns::decode(&looped).is_none());
}

// ---------------------------------------------------------------- trust

fn local_service(name: &str, addresses: Vec<Ipv4Addr>, port: u16) -> DiscoveredService {
    DiscoveredService {
        name: format!("{name}._oscjson._tcp.local."),
        service_type: OSCJSON_TYPE.into(),
        port,
        addresses,
    }
}

#[test]
fn nonlocal_or_spoofed_services_are_not_vrchat() {
    let ok = local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST], 1);
    assert_eq!(local_service_name(&ok).as_deref(), Some("VRChat-Client-test"));
    for name in ["VRChat-Client", "VRChat-Client:AB_c-1", "VRChat-Client-A"] {
        assert!(local_service_name(&local_service(name, vec![Ipv4Addr::LOCALHOST], 1)).is_some(), "{name}");
    }
    for service in [
        local_service("VRChat-Client-test", vec![Ipv4Addr::new(192, 168, 1, 5)], 1),
        local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST, Ipv4Addr::new(192, 168, 1, 5)], 1),
        local_service("fake-VRChat-Client", vec![Ipv4Addr::LOCALHOST], 1),
        local_service("VRChat-ClientSpoof", vec![Ipv4Addr::LOCALHOST], 1),
        local_service("VRChat-Client-", vec![Ipv4Addr::LOCALHOST], 1),
        local_service("VRChat-Client-a.b", vec![Ipv4Addr::LOCALHOST], 1),
        local_service("VRChat-Client", vec![], 1),
        DiscoveredService { service_type: "_osc._udp.local.".into(), ..ok.clone() },
    ] {
        assert_eq!(local_service_name(&service), None, "{service:?}");
    }
}

/// A stand-in for VRChat's OSCQuery HTTP server: answers by path, counts requests.
struct FakeVrchat {
    port: u16,
    requests: Arc<AtomicUsize>,
}

fn fake_vrchat(answers: HashMap<&'static str, (u16, String)>) -> FakeVrchat {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let requests = Arc::new(AtomicUsize::new(0));
    let counter = requests.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            counter.fetch_add(1, Ordering::SeqCst);
            let mut head = Vec::new();
            let mut byte = [0u8; 1];
            while !head.ends_with(b"\r\n\r\n") {
                if stream.read(&mut byte).unwrap_or(0) == 0 {
                    break;
                }
                head.push(byte[0]);
            }
            let line = String::from_utf8_lossy(&head).lines().next().unwrap_or("").to_string();
            let path = line.split(' ').nth(1).unwrap_or("").to_string();
            let (status, body) = answers.get(path.as_str()).cloned().unwrap_or((404, String::new()));
            let _ = write!(
                stream,
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
        }
    });
    FakeVrchat { port, requests }
}

fn host(name: &str, ip: &str, port: Value, transport: &str) -> String {
    json!({"NAME": name, "OSC_IP": ip, "OSC_PORT": port, "OSC_TRANSPORT": transport}).to_string()
}

struct Fixed(Vec<DiscoveredService>, AtomicUsize);

impl Discovery for Fixed {
    fn discovered(&self) -> Vec<DiscoveredService> {
        self.0.clone()
    }
    fn ask_again(&self) {
        self.1.fetch_add(1, Ordering::SeqCst);
    }
}

fn fixed(services: Vec<DiscoveredService>) -> Fixed {
    Fixed(services, AtomicUsize::new(0))
}

fn vrchat_answers(host_info: String, value: &str) -> HashMap<&'static str, (u16, String)> {
    HashMap::from([
        ("/HOST_INFO", (200, host_info)),
        (
            "/avatar/parameters/MuteSelf",
            (200, format!(r#"{{"FULL_PATH": "/avatar/parameters/MuteSelf", "VALUE": {value}}}"#)),
        ),
    ])
}

const MUTE: &str = "/avatar/parameters/MuteSelf";

#[test]
fn the_one_matching_local_vrchat_gives_the_raw_value() {
    let vrchat = fake_vrchat(vrchat_answers(host("VRChat-Client-test", "127.0.0.1", json!(9000), "UDP"), "[true]"));
    let discovery = fixed(vec![local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST], vrchat.port)]);
    let cancel = Cancel::new();
    assert_eq!(query_parameter_value(MUTE, &discovery, &cancel, 9000), Ok(Some(json!(true))));
    // A float port that equals the destination also matches, as Python's == does.
    let float = fake_vrchat(vrchat_answers(host("VRChat-Client-test", "127.0.0.1", json!(9000.0), "UDP"), "[false]"));
    let discovery = fixed(vec![local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST], float.port)]);
    assert_eq!(query_parameter_value(MUTE, &discovery, &cancel, 9000), Ok(Some(json!(false))));
    // Values are not coerced: "false" stays a string.
    let text = fake_vrchat(vrchat_answers(host("VRChat-Client-test", "127.0.0.1", json!(9000), "UDP"), r#"["false"]"#));
    let discovery = fixed(vec![local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST], text.port)]);
    assert_eq!(query_parameter_value(MUTE, &discovery, &cancel, 9000), Ok(Some(json!("false"))));
    for value in ["[]", "null", r#""x""#, "{}"] {
        let other = fake_vrchat(vrchat_answers(host("VRChat-Client-test", "127.0.0.1", json!(9000), "UDP"), value));
        let discovery = fixed(vec![local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST], other.port)]);
        assert_eq!(query_parameter_value(MUTE, &discovery, &cancel, 9000), Ok(None), "{value}");
    }
}

#[test]
fn the_host_identity_must_match_the_local_service_and_destination() {
    for info in [
        host("VRChat-Client-other", "127.0.0.1", json!(9000), "UDP"),
        host("VRChat-Client-test", "192.168.1.5", json!(9000), "UDP"),
        host("VRChat-Client-test", "127.0.0.1", json!(9001), "UDP"),
        host("VRChat-Client-test", "127.0.0.1", json!("9000"), "UDP"),
        host("VRChat-Client-test", "127.0.0.1", json!(9000), "TCP"),
        "[1, 2]".to_string(),
        "not json".to_string(),
    ] {
        let vrchat = fake_vrchat(vrchat_answers(info.clone(), "[true]"));
        let discovery = fixed(vec![local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST], vrchat.port)]);
        assert_eq!(query_parameter_value(MUTE, &discovery, &Cancel::new(), 9000), Ok(None), "{info}");
    }
}

#[test]
fn spoofed_services_are_ignored_before_any_request() {
    let vrchat = fake_vrchat(vrchat_answers(host("VRChat-Client-test", "127.0.0.1", json!(9000), "UDP"), "[true]"));
    let discovery = fixed(vec![
        local_service("VRChat-Client-test", vec![Ipv4Addr::new(192, 168, 1, 5)], vrchat.port),
        local_service("fake-VRChat-Client", vec![Ipv4Addr::LOCALHOST], vrchat.port),
    ]);
    assert_eq!(query_parameter_value(MUTE, &discovery, &Cancel::new(), 9000), Ok(None));
    assert_eq!(vrchat.requests.load(Ordering::SeqCst), 0);
}

#[test]
fn ambiguous_local_services_cannot_authorize_an_unmute() {
    let a = fake_vrchat(vrchat_answers(host("VRChat-Client-a", "127.0.0.1", json!(9000), "UDP"), "[false]"));
    let b = fake_vrchat(vrchat_answers(host("VRChat-Client-b", "127.0.0.1", json!(9000), "UDP"), "[false]"));
    let discovery = fixed(vec![
        local_service("VRChat-Client-a", vec![Ipv4Addr::LOCALHOST], a.port),
        local_service("VRChat-Client-b", vec![Ipv4Addr::LOCALHOST], b.port),
    ]);
    assert_eq!(query_parameter_value(MUTE, &discovery, &Cancel::new(), 9000), Ok(None));
}

#[test]
fn an_unreachable_service_fails_the_query() {
    let closed = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let discovery = fixed(vec![local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST], port)]);
    assert_eq!(query_parameter_value(MUTE, &discovery, &Cancel::new(), 9000), Err(QueryFailed));
}

#[test]
fn a_cancelled_query_asks_nothing() {
    let vrchat = fake_vrchat(vrchat_answers(host("VRChat-Client-test", "127.0.0.1", json!(9000), "UDP"), "[true]"));
    let discovery = fixed(vec![local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST], vrchat.port)]);
    let cancel = Cancel::new();
    cancel.set();
    assert_eq!(query_parameter_value(MUTE, &discovery, &cancel, 9000), Ok(None));
    assert_eq!(vrchat.requests.load(Ordering::SeqCst), 0);
}

#[test]
fn redirects_are_not_followed() {
    let vrchat = fake_vrchat(HashMap::from([("/HOST_INFO", (302, String::new()))]));
    assert_eq!(get_json(Ipv4Addr::LOCALHOST.into(), vrchat.port, "/HOST_INFO"), Ok(None));
}

#[test]
fn presence_needs_a_local_vrchat_that_answers_and_asks_again_otherwise() {
    let vrchat = fake_vrchat(vrchat_answers(host("VRChat-Client-test", "127.0.0.1", json!(9000), "UDP"), "[true]"));
    let found = fixed(vec![local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST], vrchat.port)]);
    assert!(vrchat_presence(&found));
    assert_eq!(found.1.load(Ordering::SeqCst), 0);
    let closed = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let gone = closed.local_addr().unwrap().port();
    drop(closed);
    for discovery in [
        fixed(vec![]),
        fixed(vec![local_service("Other-App", vec![Ipv4Addr::LOCALHOST], vrchat.port)]),
        // A VRChat that was closed stays in discovery but does not answer.
        fixed(vec![local_service("VRChat-Client-test", vec![Ipv4Addr::LOCALHOST], gone)]),
    ] {
        assert!(!vrchat_presence(&discovery));
        assert_eq!(discovery.1.load(Ordering::SeqCst), 1);
    }
}

// ---------------------------------------------------------------- the handler

fn udp_listener() -> (UdpSocket, u16) {
    let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let port = socket.local_addr().unwrap().port();
    (socket, port)
}

fn receive(socket: &UdpSocket) -> Vec<OscMessage> {
    let mut buffer = [0u8; 2048];
    let (size, _) = socket.recv_from(&mut buffer).unwrap();
    decode_packet(&buffer[..size]).unwrap()
}

#[test]
fn chatbox_text_and_typing_reach_the_destination() {
    let (socket, port) = udp_listener();
    let handler = OscHandler::new("127.0.0.1", port).unwrap();
    assert!(handler.send_message("hello", true, None).unwrap());
    assert_eq!(
        receive(&socket),
        vec![OscMessage::new(
            "/chatbox/input",
            vec![OscArg::String("hello".into()), OscArg::Bool(true), OscArg::Bool(true)]
        )]
    );
    handler.send_typing(true).unwrap();
    assert_eq!(receive(&socket), vec![OscMessage::new("/chatbox/typing", vec![OscArg::Bool(true)])]);
    // Empty text and a stale message are not sent.
    assert!(!handler.send_message("", true, None).unwrap());
    assert!(!handler.send_message("stale", true, Some(&|| false)).unwrap());
    assert!(handler.send_message("current", false, Some(&|| true)).unwrap());
    assert_eq!(receive(&socket)[0].args[0], OscArg::String("current".into()));
    handler.osc_server_stop().unwrap();
    assert!(!handler.send_message("after stop", true, None).unwrap());
}

#[test]
fn a_destination_on_another_machine_does_not_receive() {
    assert!(uses_osc_query("127.0.0.1") && uses_osc_query("localhost"));
    assert!(!uses_osc_query("192.168.1.20") && !uses_osc_query("127.0.0.2"));
    let handler = OscHandler::new("192.168.1.20", 9000).unwrap();
    handler.receive_osc_parameters().unwrap();
    assert!(!handler.is_osc_query_enabled());
    assert_eq!(handler.local_vrchat_presence(), None);
    assert_eq!(handler.get_osc_parameter_mute_self(), None);
    handler.osc_server_stop().unwrap();
}

fn mdns_available() -> bool {
    match Mdns::start() {
        Ok(mdns) => {
            mdns.close();
            true
        }
        Err(error) => {
            eprintln!("mDNS is not available here ({error}); skipped");
            false
        }
    }
}

fn wait_until(mut condition: impl FnMut() -> bool, timeout: Duration) -> bool {
    let end = Instant::now() + timeout;
    while Instant::now() < end {
        if condition() {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    condition()
}

#[test]
fn receiving_applies_packets_and_bundles_on_one_thread_and_serves_oscquery() {
    if !mdns_available() {
        return;
    }
    let handler = OscHandler::new("127.0.0.1", 9000).unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let threads = Arc::new(Mutex::new(Vec::new()));
    let (sink, names) = (seen.clone(), threads.clone());
    let target: Target = Arc::new(move |address, args| {
        sink.lock().unwrap().push((address.to_string(), args.to_vec()));
        names.lock().unwrap().push(thread::current().id());
    });
    handler.set_dict_filter_and_target(vec![
        ("/avatar/parameters/MuteSelf".to_string(), target.clone()),
        ("/avatar/change".to_string(), target),
    ]);
    handler.receive_osc_parameters().unwrap();
    assert!(handler.is_osc_query_enabled());
    let osc_port = handler.osc_server_port().unwrap();
    let sender = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let mute = |value| OscMessage::new("/avatar/parameters/MuteSelf", vec![OscArg::Bool(value)]).encode();
    // A bundle far in the future does not delay the later packet.
    sender.send_to(&bundle(u64::MAX, &[mute(true)]), (Ipv4Addr::LOCALHOST, osc_port)).unwrap();
    sender.send_to(&mute(false), (Ipv4Addr::LOCALHOST, osc_port)).unwrap();
    sender.send_to(&OscMessage::new("/other", vec![]).encode(), (Ipv4Addr::LOCALHOST, osc_port)).unwrap();
    sender.send_to(b"garbage", (Ipv4Addr::LOCALHOST, osc_port)).unwrap();
    sender
        .send_to(
            &OscMessage::new("/avatar/change", vec![OscArg::String("avtr_x".into())]).encode(),
            (Ipv4Addr::LOCALHOST, osc_port),
        )
        .unwrap();
    assert!(wait_until(|| seen.lock().unwrap().len() == 3, Duration::from_secs(2)));
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen[0], ("/avatar/parameters/MuteSelf".to_string(), vec![OscArg::Bool(true)]));
    assert_eq!(seen[1], ("/avatar/parameters/MuteSelf".to_string(), vec![OscArg::Bool(false)]));
    assert_eq!(seen[2].0, "/avatar/change");
    let threads = threads.lock().unwrap();
    assert!(threads.iter().all(|t| *t == threads[0]));
    assert_ne!(threads[0], thread::current().id());

    // The OSCQuery service answers with the advertised tree and host info.
    let http = handler.http_port().unwrap();
    let info = get_json(Ipv4Addr::LOCALHOST.into(), http, "/HOST_INFO").unwrap().unwrap();
    assert_eq!(info["OSC_PORT"], json!(osc_port));
    assert_eq!(info["OSC_IP"], json!("127.0.0.1"));
    assert!(info["NAME"].as_str().unwrap().starts_with("VRCT:"));
    let node = get_json(Ipv4Addr::LOCALHOST.into(), http, "/avatar/parameters/MuteSelf").unwrap().unwrap();
    assert_eq!(node, json!({"FULL_PATH": "/avatar/parameters/MuteSelf", "ACCESS": 3}));
    assert_eq!(get_json(Ipv4Addr::LOCALHOST.into(), http, "/nothing"), Ok(None));

    // Receiving again while it runs changes nothing.
    handler.receive_osc_parameters().unwrap();
    assert_eq!(handler.osc_server_port(), Some(osc_port));
    handler.osc_server_stop().unwrap();
    assert!(!handler.is_osc_query_enabled());
    assert_eq!(handler.receive_osc_parameters(), Err(OscError::ShutDown));
    assert!(get_json(Ipv4Addr::LOCALHOST.into(), http, "/HOST_INFO").is_err());
}

#[test]
fn the_oscquery_http_server_has_an_absolute_request_deadline() {
    if !mdns_available() {
        return;
    }
    let service = QueryService::start("VRCT:deadline-test", 1).unwrap();
    let port = service.http_port();
    let mut dripping = std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
    let started = Instant::now();
    let mut cut = false;
    while started.elapsed() < Duration::from_secs(5) {
        thread::sleep(Duration::from_millis(200));
        if dripping.write_all(b"X").is_err() {
            cut = true;
            break;
        }
    }
    assert!(cut, "the server cut the dripping client");
    assert!(started.elapsed() < Duration::from_secs(4));
    // And it serves the next request.
    assert!(get_json(Ipv4Addr::LOCALHOST.into(), port, "/HOST_INFO").unwrap().is_some());
    service.close();
}

#[test]
fn the_oscquery_http_server_answers_only_requests_by_address() {
    // #459: a page that rebinds its own name to 127.0.0.1 sends that name in `Host`.
    if !mdns_available() {
        return;
    }
    let service = QueryService::start("VRCT:host-test", 1).unwrap();
    let port = service.http_port();
    let ask = |host: Option<&str>| {
        let mut stream = std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        let host = host.map(|h| format!("Host: {h}\r\n")).unwrap_or_default();
        write!(stream, "GET /HOST_INFO HTTP/1.1\r\n{host}Connection: close\r\n\r\n").unwrap();
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply);
        reply.split_whitespace().nth(1).unwrap_or("").to_string()
    };
    for allowed in [Some(format!("127.0.0.1:{port}")), Some("localhost".into()), Some(format!("[::1]:{port}")), None] {
        assert_eq!(ask(allowed.as_deref()), "200", "{allowed:?}");
    }
    for refused in ["rebind.example.com", "evil.test:80", ""] {
        assert_eq!(ask(Some(refused)), "403", "{refused}");
    }
    service.close();
}

#[test]
fn changing_the_destination_moves_the_receiver_and_a_failure_keeps_the_old_one() {
    if !mdns_available() {
        return;
    }
    let (socket, port) = udp_listener();
    let handler = OscHandler::new("127.0.0.1", port).unwrap();
    handler.receive_osc_parameters().unwrap();
    let first = handler.osc_server_port().unwrap();
    // A new port restarts the one receiver.
    let (other, other_port) = udp_listener();
    handler.set_osc_port(other_port).unwrap();
    assert!(handler.is_osc_query_enabled());
    assert_ne!(handler.osc_server_port(), Some(first));
    handler.send_typing(false).unwrap();
    assert_eq!(receive(&other).len(), 1);
    // Another machine: no receiver.
    handler.set_osc_ip_address("192.0.2.10").unwrap();
    assert!(!handler.is_osc_query_enabled());
    assert_eq!(handler.osc_server_port(), None);
    // Back to this PC: the receiver binds loopback again.
    handler.set_osc_ip_address("127.0.0.1").unwrap();
    assert!(handler.is_osc_query_enabled());
    // A destination that does not resolve is refused and the old one stays.
    assert!(handler.set_osc_ip_address("no-such-host.invalid").is_err());
    assert_eq!(handler.osc_ip_address(), "127.0.0.1");
    assert_eq!(handler.osc_port(), other_port);
    handler.send_typing(true).unwrap();
    assert_eq!(receive(&other)[0].args, vec![OscArg::Bool(true)]);
    handler.osc_server_stop().unwrap();
    drop(socket);
}

#[test]
fn a_local_vrchat_found_over_mdns_gives_mute_and_presence() {
    if !mdns_available() {
        return;
    }
    let (_socket, port) = udp_listener();
    let name = format!("VRChat-Client-T{}", std::process::id());
    let vrchat = fake_vrchat(vrchat_answers(host(&name, "127.0.0.1", json!(port), "UDP"), "[true]"));
    // VRChat's advertisement, with the address 127.0.0.1 as VRChat publishes it.
    let advertiser = Mdns::start().unwrap();
    advertiser.register(ServiceSpec {
        service_type: OSCJSON_TYPE.into(),
        instance: format!("{name}.{OSCJSON_TYPE}"),
        host: format!("{name}.oscjson.local."),
        port: vrchat.port,
        txt: vec!["txtvers=1".into()],
        address: Ipv4Addr::LOCALHOST,
    });
    let handler = OscHandler::new("127.0.0.1", port).unwrap();
    handler.receive_osc_parameters().unwrap();
    assert!(wait_until(|| handler.local_vrchat_presence() == Some(true), Duration::from_secs(5)));
    assert_eq!(handler.get_osc_parameter_mute_self(), Some(true));
    // Withdrawn: the service leaves discovery.
    advertiser.close();
    assert!(wait_until(|| handler.local_vrchat_presence() == Some(false), Duration::from_secs(5)));
    handler.osc_server_stop().unwrap();
    assert_eq!(handler.local_vrchat_presence(), None);
}

#[test]
fn oscquery_turned_off_receives_and_announces_nothing_while_sending_goes_on() {
    // #559: the user can turn OSCQuery off; messages still go to VRChat.
    if !mdns_available() {
        return;
    }
    let observer = Mdns::start().unwrap();
    observer.browse(OSCJSON_TYPE);
    let ours = || observer.discovered(OSCJSON_TYPE).iter().any(|s| s.name.starts_with("VRCT:"));
    let (socket, port) = udp_listener();
    let handler = OscHandler::new("127.0.0.1", port).unwrap();
    handler.set_osc_query_allowed(false).unwrap();
    assert!(!handler.is_osc_query_allowed());
    handler.receive_osc_parameters().unwrap();
    assert!(!handler.is_osc_query_enabled());
    assert_eq!((handler.osc_server_port(), handler.http_port()), (None, None));
    assert_eq!(handler.local_vrchat_presence(), None, "VRChat cannot be checked");
    assert_eq!(handler.get_osc_parameter_mute_self(), None);
    assert!(handler.send_message("hello", false, None).unwrap());
    assert_eq!(receive(&socket)[0].address, "/chatbox/input");
    // Setting the destination again (which restarts receiving) does not start it either.
    handler.set_osc_ip_address("127.0.0.1").unwrap();
    assert!(!handler.is_osc_query_enabled());
    thread::sleep(Duration::from_millis(500));
    assert!(!ours(), "announced while off");

    // On: receiving, the HTTP server and the advertisement start for the destination.
    handler.set_osc_query_allowed(true).unwrap();
    assert!(handler.is_osc_query_enabled());
    let http = handler.http_port().unwrap();
    assert!(get_json(Ipv4Addr::LOCALHOST.into(), http, "/HOST_INFO").unwrap().is_some());
    assert!(wait_until(ours, Duration::from_secs(5)), "not announced once on");
    handler.set_osc_query_allowed(true).unwrap();
    assert_eq!(handler.http_port(), Some(http), "on twice changes nothing");

    // Off again: everything closes and the advertisement is withdrawn; sending goes on.
    handler.set_osc_query_allowed(false).unwrap();
    assert!(!handler.is_osc_query_enabled());
    assert!(get_json(Ipv4Addr::LOCALHOST.into(), http, "/HOST_INFO").is_err());
    assert!(wait_until(|| !ours(), Duration::from_secs(5)), "still announced once off");
    handler.send_typing(true).unwrap();
    assert_eq!(receive(&socket)[0].address, "/chatbox/typing");

    handler.osc_server_stop().unwrap();
    assert_eq!(handler.set_osc_query_allowed(true), Err(OscError::ShutDown));
    observer.close();
}

#[test]
fn a_service_withdrawn_right_after_registering_is_not_announced_again() {
    if !mdns_available() {
        return;
    }
    let name = format!("Withdrawn-T{}", std::process::id());
    let instance = format!("{name}.{OSCJSON_TYPE}");
    let observer = Mdns::start().unwrap();
    observer.browse(OSCJSON_TYPE);
    let advertiser = Mdns::start().unwrap();
    advertiser.register(ServiceSpec {
        service_type: OSCJSON_TYPE.into(),
        instance: instance.clone(),
        host: format!("{name}.oscjson.local."),
        port: 1,
        txt: vec!["txtvers=1".into()],
        address: Ipv4Addr::LOCALHOST,
    });
    // Withdrawn while its later announcements (225 and 450 ms after registering) are
    // still due; the advertiser keeps running past them.
    advertiser.unregister_all();
    thread::sleep(Duration::from_secs(1));
    assert!(
        observer.discovered(OSCJSON_TYPE).iter().all(|service| service.name != instance),
        "an announcement after the goodbye brought the service back"
    );
    advertiser.close();
    observer.close();
}

#[test]
fn nothing_logged_holds_the_text() {
    let lines = Arc::new(Mutex::new(Vec::<&'static str>::new()));
    let sink = lines.clone();
    vrct_adapters::log::set_sink(move |line| sink.lock().unwrap().push(line));
    let (_socket, port) = udp_listener();
    let handler = OscHandler::new("127.0.0.1", port).unwrap();
    handler.send_message("private words", true, None).unwrap();
    handler.osc_server_stop().unwrap();
    assert!(lines.lock().unwrap().iter().all(|line| !line.contains("private words")));
}

#[test]
fn a_pattern_with_many_wildcards_is_decided_quickly() {
    let pattern = format!("/avatar/parameters/{}z", "*".repeat(60));
    let started = Instant::now();
    assert!(!pattern_matches(&pattern, "/avatar/parameters/MuteSelf"));
    assert!(pattern_matches(&format!("/avatar/parameters/{}f", "*".repeat(60)), "/avatar/parameters/MuteSelf"));
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[test]
fn a_chunked_reply_cut_after_a_chunk_is_read_without_failing() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut head = [0u8; 1024];
        let _ = stream.read(&mut head);
        stream.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n{\"a\":").unwrap();
        thread::sleep(Duration::from_millis(100));
        stream.write_all(b"\r\n2\r\n1}\r\n0\r\n\r\n").unwrap();
    });
    assert_eq!(get_json(Ipv4Addr::LOCALHOST.into(), port, "/x"), Ok(Some(json!({"a": 1}))));
}
