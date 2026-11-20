//! Ports of `tests/voice/test_source_bridge.py`, with a substitute system.

use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Instant;

use serde_json::{json, Value};

use super::*;

fn node(id: u64, name: &str, media: &str, serial: u64, extra: Value) -> Value {
    let mut props = json!({"node.name": name, "media.class": media, "object.serial": serial});
    props.as_object_mut().unwrap().extend(extra.as_object().cloned().unwrap_or_default());
    json!({"type": "PipeWire:Interface:Node", "id": id, "info": {"props": props, "params": {"Props": [{"mute": true}]}}})
}

fn graph() -> Graph {
    vec![
        json!({"type": "PipeWire:Interface:Core", "info": {"cookie": 42}}),
        node(10, "external.source", "Audio/Source", 110, json!({})),
        node(11, "vrct.managed.vc", "Audio/Sink", 111, json!({"vrct.managed.route": "v1"})),
    ]
}

struct FakeChild {
    pid: u32,
    code: Arc<AtomicI32>,
}

const RUNNING: i32 = i32::MIN;

impl BridgeChild for FakeChild {
    fn pid(&self) -> u32 {
        self.pid
    }
    fn poll(&mut self) -> Option<i32> {
        let code = self.code.load(Ordering::SeqCst);
        (code != RUNNING).then_some(code)
    }
    fn terminate(&mut self) {
        let _ = self.code.compare_exchange(RUNNING, -15, Ordering::SeqCst, Ordering::SeqCst);
    }
    fn reap(&mut self) {
        self.terminate();
    }
}

#[derive(Default)]
struct Data {
    graph: Graph,
    children: Vec<Arc<AtomicI32>>,
    unmutes: Vec<String>,
    query_error: bool,
    fault: Option<&'static str>,
    block_at: Option<&'static str>,
}

struct Fake {
    data: Mutex<Data>,
    enter: Event,
    release: Event,
}

impl Fake {
    fn new() -> Arc<Self> {
        Arc::new(Self { data: Mutex::new(Data { graph: graph(), ..Data::default() }), enter: Event::new(), release: Event::new() })
    }
    fn block(&self, at: &str) {
        if lock(&self.data).block_at == Some(at) {
            self.enter.set();
            assert!(self.release.wait(Duration::from_secs(3)));
        }
    }
    fn with<R>(&self, f: impl FnOnce(&mut Data) -> R) -> R {
        f(&mut lock(&self.data))
    }
    fn child_ended(&self, index: usize) -> bool {
        self.with(|d| d.children[index].load(Ordering::SeqCst) != RUNNING)
    }
}

impl BridgeSystem for Fake {
    fn read_graph(&self, _: Option<f64>) -> Result<Arc<Graph>> {
        let data = lock(&self.data);
        if data.query_error {
            return Err(Error::runtime("source_bridge_graph_unavailable"));
        }
        Ok(Arc::new(data.graph.clone()))
    }
    fn subscribe(&self, _: Arc<Event>) -> Result<Box<dyn Any + Send>> {
        Ok(Box::new(()))
    }
    fn launch(&self, _: &Endpoint, _: &Endpoint, tag: &str) -> Result<Box<dyn BridgeChild>> {
        self.block("launch");
        let mut data = lock(&self.data);
        let code = Arc::new(AtomicI32::new(RUNNING));
        let pid = 1234 + data.children.len() as u32;
        data.children.push(code.clone());
        data.graph.truncate(3);
        for (id, suffix, media, serial) in [(20, "capture", "Stream/Input/Audio", 120), (21, "playback", "Stream/Output/Audio", 121)] {
            data.graph.push(node(id, &format!("vrct.source-bridge.{tag}.{suffix}"), media, serial, json!({"vrct.source.bridge": "v1", "client.id": 30})));
        }
        for (a, b) in [(10, 20), (21, 11)] {
            data.graph.push(json!({"type": "PipeWire:Interface:Link", "info": {"output-node-id": a, "input-node-id": b, "state": "active"}}));
        }
        match data.fault {
            Some("missing_link") => {
                data.graph.pop();
            }
            Some("wrong_link") => {
                let last = data.graph.len() - 1;
                data.graph[last]["info"]["input-node-id"] = json!(99);
            }
            Some("extra_link") => data.graph.push(json!({"type": "PipeWire:Interface:Link", "info": {"output-node-id": 99, "input-node-id": 20, "state": "active"}})),
            Some("owner") => data.graph[4]["info"]["props"]["client.id"] = json!(999),
            _ => {}
        }
        data.graph.push(json!({"id": 30, "type": "PipeWire:Interface:Client", "info": {"props": {"pipewire.sec.pid": pid}}}));
        Ok(Box::new(FakeChild { pid, code }))
    }
    fn unmute(&self, _: &Endpoint, tag: &str) -> Result<()> {
        self.block("unmute");
        let mut data = lock(&self.data);
        data.unmutes.push(tag.to_owned());
        data.graph[4]["info"]["params"]["Props"][0]["mute"] = json!(false);
        Ok(())
    }
    fn start_timeout(&self) -> f64 {
        0.06
    }
    fn monitor_interval(&self) -> Duration {
        Duration::from_millis(5)
    }
}

fn until(predicate: impl Fn() -> bool) {
    let end = Instant::now() + Duration::from_secs(2);
    while Instant::now() < end {
        if predicate() {
            return;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    panic!("condition did not become true");
}

fn system() -> (Arc<Fake>, SourceBridge, Endpoint) {
    let fake = Fake::new();
    let selected = select_source(&graph(), "external.source").unwrap();
    (fake.clone(), SourceBridge::new(fake), selected)
}

#[test]
fn health_distinguishes_stop_request_from_completed_cleanup() {
    let (fake, bridge, selected) = system();
    fake.with(|d| d.block_at = Some("launch"));
    bridge.start(Some(selected), None).unwrap();
    assert!(fake.enter.wait(Duration::from_secs(1)));
    bridge.stop();
    assert!(bridge.health().stopping);
    assert!(!bridge.health().requested);
    fake.release.set();
    assert!(bridge.close(Duration::from_secs(3)));
    assert!(!bridge.health().stopping);
}

#[test]
fn default_and_configuration_never_open_audio() {
    let (fake, bridge, selected) = system();
    let initial = bridge.health();
    assert!(initial.observation_id.parse::<u64>().unwrap() > 0);
    assert!(!initial.requested && !initial.active && !initial.pending && initial.source.is_none() && initial.error.is_none() && initial.generation == 0 && !initial.stopping);
    bridge.configure(selected).unwrap();
    assert!(fake.with(|d| d.children.is_empty() && d.unmutes.is_empty()));
    bridge.start(None, None).unwrap();
    until(|| bridge.health().active);
    assert_eq!(fake.with(|d| (d.children.len(), d.unmutes.len())), (1, 1));
    assert!(!bridge.health().conversion_verified);
    bridge.start(None, None).unwrap();
    assert_eq!(fake.with(|d| d.children.len()), 1);
    bridge.stop();
    assert!(!bridge.health().requested && !bridge.health().active);
    until(|| fake.child_ended(0));
    assert!(bridge.close(Duration::from_secs(3)));
}

#[test]
fn never_unmute_before_complete_owned_links() {
    for fault in ["missing_link", "wrong_link", "extra_link", "owner"] {
        let (fake, bridge, selected) = system();
        fake.with(|d| d.fault = Some(fault));
        bridge.configure(selected).unwrap();
        bridge.start(None, None).unwrap();
        until(|| bridge.health().error.is_some());
        assert!(!bridge.health().active && fake.with(|d| d.unmutes.is_empty()), "{fault}");
        until(|| fake.child_ended(0));
        assert!(bridge.close(Duration::from_secs(3)));
    }
}

#[test]
fn active_route_closes_on_loss_and_never_auto_resumes() {
    for fault in ["epoch", "source_serial", "sink_serial", "missing_source", "link", "query", "process", "mute"] {
        let (fake, bridge, selected) = system();
        bridge.configure(selected.clone()).unwrap();
        bridge.start(None, None).unwrap();
        until(|| bridge.health().active);
        fake.with(|d| match fault {
            "epoch" => d.graph[0]["info"]["cookie"] = json!(43),
            "source_serial" => d.graph[1]["info"]["props"]["object.serial"] = json!(999),
            "sink_serial" => d.graph[2]["info"]["props"]["object.serial"] = json!(999),
            "missing_source" => {
                d.graph.remove(1);
            }
            "link" => {
                let index = d.graph.len() - 2;
                d.graph.remove(index);
            }
            "query" => d.query_error = true,
            "process" => d.children[0].store(1, Ordering::SeqCst),
            _ => d.graph[4]["info"]["params"]["Props"][0]["mute"] = json!(true),
        });
        until(|| bridge.health().error.is_some());
        until(|| fake.child_ended(0));
        assert!(!bridge.health().requested && !bridge.health().active, "{fault}");
        assert!(bridge.close(Duration::from_secs(3)));
        fake.with(|d| {
            d.graph = graph();
            d.query_error = false;
        });
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(fake.with(|d| d.children.len()), 1, "{fault} resumed by itself");
        bridge.configure(selected).unwrap();
        bridge.start(None, None).unwrap();
        until(|| bridge.health().active);
        assert_eq!(fake.with(|d| d.children.len()), 2);
        bridge.close(Duration::from_secs(3));
    }
}

#[test]
fn stop_invalidates_blocked_work_and_blocks_overlap() {
    for at in ["launch", "unmute"] {
        let (fake, bridge, selected) = system();
        bridge.configure(selected).unwrap();
        fake.with(|d| d.block_at = Some(at));
        bridge.start(None, None).unwrap();
        assert!(fake.enter.wait(Duration::from_secs(1)));
        let before = Instant::now();
        bridge.stop();
        assert!(before.elapsed() < Duration::from_millis(100));
        assert_eq!(bridge.start(None, None).unwrap_err(), Error::runtime("source_bridge_stopping"));
        if at == "unmute" {
            assert!(fake.child_ended(0));
        }
        fake.release.set();
        assert!(bridge.close(Duration::from_secs(3)));
        assert!(!bridge.health().active && bridge.health().error.is_none());
        let old_tags = fake.with(|d| d.unmutes.clone());
        if at == "launch" {
            assert!(old_tags.is_empty());
        }
        fake.with(|d| d.block_at = None);
        fake.enter.clear();
        bridge.start(None, None).unwrap();
        until(|| bridge.health().active);
        let latest = fake.with(|d| d.unmutes.last().unwrap().clone());
        assert!(!old_tags.contains(&latest));
        bridge.close(Duration::from_secs(3));
    }
}

#[test]
fn reselected_source_is_rejected_before_launch() {
    let (fake, bridge, selected) = system();
    bridge.configure(selected).unwrap();
    fake.with(|d| d.graph[1]["info"]["props"]["object.serial"] = json!(111_000));
    bridge.start(None, None).unwrap();
    until(|| bridge.health().error.is_some());
    assert_eq!(bridge.health().error.as_deref(), Some("source_bridge_source_changed"));
    assert!(fake.with(|d| d.children.is_empty()));
    assert!(bridge.close(Duration::from_secs(3)));
}

#[test]
fn launch_arguments_pin_serials_and_start_muted() {
    let source = Endpoint { cookie: 42, serial: 110, name: "external.source".into(), media_class: "Audio/Source".into() };
    let sink = Endpoint { cookie: 42, serial: 111, name: "vrct.managed.vc".into(), media_class: "Audio/Sink".into() };
    let args = launch_arguments("/opt/build/astarot-source-bridge", 7, &source, &sink, &"a".repeat(32));
    assert!(args[0].ends_with("astarot-source-bridge"));
    assert_eq!(args[2], "7");
    let value = |flag: &str| args[args.iter().position(|a| a == flag).unwrap() + 1].clone();
    let (capture, playback) = (value("--capture-props"), value("--playback-props"));
    assert!(capture.contains("target.object=110") && playback.contains("target.object=111"));
    assert!(playback.contains("node.param.Props={mute=true}"));
    for props in [capture, playback] {
        for required in ["node.dont-fallback=true", "node.dont-reconnect=true", "node.dont-move=true", "node.linger=false"] {
            assert!(props.contains(required));
        }
    }
}
