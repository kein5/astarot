//! A PipeWire graph snapshot through the native client API, in the shape of `pw-dump`.
//!
//! The connection binds every node, link and client and the `default` metadata, and
//! keeps their latest info, `Props` parameters and metadata entries. A snapshot ends
//! with core round trips: the first makes sure every event sent before the snapshot
//! began has been handled, and further ones collect the info of objects bound during
//! the previous trip. Only the fields the readers in `graph.rs` use are reproduced.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;
use std::time::Duration;

use pipewire as pw;
use pw::loop_::Timeout;
use pw::spa;
use pw::types::ObjectType;
use serde_json::{json, Map, Value};

use crate::graph::{Graph, CLIENT, CORE, LINK, METADATA, NODE};
use crate::graph_source::{GraphUnavailable, Snapshotter};
use crate::sync::{monotonic, Event};

/// A property value as `pw-dump` prints it: numbers, booleans and JSON containers
/// unquoted, everything else as a string.
pub fn prop_value(text: &str) -> Value {
    match text {
        "true" => return Value::Bool(true),
        "false" => return Value::Bool(false),
        _ => {}
    }
    let numeric = !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'-' | b'+' | b'.' | b'e' | b'E')) && text.bytes().any(|b| b.is_ascii_digit());
    if numeric {
        if let Ok(value) = text.parse::<i64>() {
            return json!(value);
        }
        if let Ok(value) = text.parse::<u64>() {
            return json!(value);
        }
        if let Ok(value) = text.parse::<f64>() {
            if value.is_finite() {
                return json!(value);
            }
        }
    }
    if text.starts_with(['{', '[']) {
        if let Ok(value) = serde_json::from_str::<Value>(text) {
            return value;
        }
    }
    Value::String(text.to_owned())
}

fn dict(props: Option<&spa::utils::dict::DictRef>) -> Map<String, Value> {
    props.map(|props| props.iter().map(|(k, v)| (k.to_owned(), prop_value(v))).collect()).unwrap_or_default()
}

/// The `Props` object of a parameter as `{"mute": bool}` when it carries a mute.
fn props_param(pod: &spa::pod::Pod) -> Value {
    use spa::pod::deserialize::PodDeserializer;
    use spa::pod::Value as PodValue;
    let mut out = Map::new();
    if let Ok((_, PodValue::Object(object))) = PodDeserializer::deserialize_any_from(pod.as_bytes()) {
        for property in object.properties {
            if property.key == spa::sys::SPA_PROP_mute {
                if let PodValue::Bool(muted) = property.value {
                    out.insert("mute".into(), Value::Bool(muted));
                }
            }
        }
    }
    Value::Object(out)
}

#[derive(Default)]
struct Objects {
    cookie: Option<u32>,
    items: BTreeMap<u32, Value>,
    /// Parameter `Props` entries by node and index.
    params: BTreeMap<u32, BTreeMap<u32, Value>>,
    /// Nodes that announced readable `Props` without any arriving yet.
    awaiting_params: BTreeMap<u32, bool>,
    /// Nodes whose params changed: the next `Props` they send replace those kept.
    params_changed: BTreeSet<u32>,
    /// Metadata entries: (subject, key) to (type, value).
    metadata: BTreeMap<u32, BTreeMap<(u32, String), (Option<String>, String)>>,
    bound_this_trip: bool,
}

impl Objects {
    /// A node's info said its params changed (`PW_NODE_CHANGE_MASK_PARAMS`).
    fn node_params_changed(&mut self, id: u32) {
        self.params_changed.insert(id);
    }

    /// A `Props` entry of a node, or its removal (`None`). After a change the subscription
    /// sends the node's `Props` again under indexes of its own (31 for a loopback's after a
    /// mute, where it first sent 0): the first entry after a change replaces those kept, as
    /// `pw-dump` replaces its list, so that an old mute does not stay beside the new one.
    fn props_param(&mut self, id: u32, index: u32, value: Option<Value>) {
        self.awaiting_params.remove(&id);
        if self.params_changed.remove(&id) {
            self.params.remove(&id);
        }
        let entries = self.params.entry(id).or_default();
        match value {
            Some(value) => {
                entries.insert(index, value);
            }
            None => {
                entries.remove(&index);
            }
        }
    }

    fn removed(&mut self, id: u32) {
        self.items.remove(&id);
        self.params.remove(&id);
        self.awaiting_params.remove(&id);
        self.params_changed.remove(&id);
        self.metadata.remove(&id);
    }
}

struct Bound {
    _proxy: Box<dyn std::any::Any>,
    _listener: Box<dyn std::any::Any>,
}

pub struct NativeSnapshotter {
    mainloop: pw::main_loop::MainLoopRc,
    _context: pw::context::ContextRc,
    core: pw::core::CoreRc,
    _registry: pw::registry::RegistryRc,
    _core_listener: pw::core::Listener,
    _registry_listener: pw::registry::Listener,
    objects: Rc<RefCell<Objects>>,
    bound: Rc<RefCell<BTreeMap<u32, Bound>>>,
    done: Rc<Cell<Option<i32>>>,
    failed: Rc<Cell<bool>>,
}

impl NativeSnapshotter {
    /// Connect to the session's PipeWire (honouring `PIPEWIRE_REMOTE`).
    pub fn connect() -> Result<Self, GraphUnavailable> {
        pw::init();
        let mainloop = pw::main_loop::MainLoopRc::new(None).map_err(|_| GraphUnavailable)?;
        let context = pw::context::ContextRc::new(&mainloop, None).map_err(|_| GraphUnavailable)?;
        let core = context.connect_rc(None).map_err(|_| GraphUnavailable)?;
        let registry = core.get_registry_rc().map_err(|_| GraphUnavailable)?;
        let objects = Rc::new(RefCell::new(Objects::default()));
        let bound: Rc<RefCell<BTreeMap<u32, Bound>>> = Rc::new(RefCell::new(BTreeMap::new()));
        let done = Rc::new(Cell::new(None));
        let failed = Rc::new(Cell::new(false));

        let core_listener = {
            let (objects, done, failed) = (objects.clone(), done.clone(), failed.clone());
            core.add_listener_local()
                .info(move |info| objects.borrow_mut().cookie = Some(info.cookie()))
                .done(move |id, seq| {
                    if id == pw::core::PW_ID_CORE {
                        done.set(Some(seq.seq()));
                    }
                })
                .error(move |id, _seq, res, _message| {
                    // The server's message may name objects; only the failure counts.
                    if connection_failed(id, res) {
                        failed.set(true);
                    }
                })
                .register()
        };

        let registry_listener = {
            let weak = registry.downgrade();
            let (objects, bound) = (objects.clone(), bound.clone());
            let removed_objects = objects.clone();
            let removed_bound = bound.clone();
            registry
                .add_listener_local()
                .global(move |global| {
                    let Some(registry) = weak.upgrade() else { return };
                    bind(&registry, global, &objects, &bound);
                })
                .global_remove(move |id| {
                    removed_bound.borrow_mut().remove(&id);
                    removed_objects.borrow_mut().removed(id);
                })
                .register()
        };

        Ok(Self { mainloop, _context: context, core, _registry: registry, _core_listener: core_listener, _registry_listener: registry_listener, objects, bound, done, failed })
    }

    fn round_trip(&self, deadline: f64, stop: &Event) -> Result<(), GraphUnavailable> {
        let pending = self.core.sync(0).map_err(|_| GraphUnavailable)?;
        loop {
            if self.failed.get() || stop.is_set() {
                return Err(GraphUnavailable);
            }
            if self.done.get() == Some(pending.seq()) {
                return Ok(());
            }
            let remaining = deadline - monotonic();
            if remaining <= 0.0 {
                return Err(GraphUnavailable);
            }
            // Short slices keep a stop request prompt.
            let slice = Duration::from_secs_f64(remaining.min(0.02));
            if self.mainloop.loop_().iterate(Timeout::Finite(slice)) < 0 {
                return Err(GraphUnavailable);
            }
        }
    }

    fn graph(&self) -> Graph {
        let objects = self.objects.borrow();
        let mut graph = Vec::with_capacity(objects.items.len() + 1);
        if let Some(cookie) = objects.cookie {
            graph.push(json!({"id": 0, "type": CORE, "info": {"cookie": cookie}}));
        }
        for (id, item) in &objects.items {
            let mut item = item.clone();
            if let Some(params) = objects.params.get(id) {
                item["info"]["params"] = json!({"Props": params.values().cloned().collect::<Vec<_>>()});
            }
            if let Some(entries) = objects.metadata.get(id) {
                let entries: Vec<Value> = entries
                    .iter()
                    .map(|((subject, key), (kind, value))| {
                        let value = if kind.as_deref() == Some("Spa:String:JSON") { prop_value(value) } else { Value::String(value.clone()) };
                        json!({"subject": subject, "key": key, "type": kind, "value": value})
                    })
                    .collect();
                item["metadata"] = Value::Array(entries);
            }
            graph.push(item);
        }
        graph
    }
}

/// Whether a core error ends the connection. An object that goes away while it is bound is
/// not one: the server answers the bind with "no global" on the proxy's id and the request
/// sent right after it (`subscribe_params`) with "unknown resource" on the core, both
/// `-ENOENT`. Short-lived clients and streams do this, such as the gate helper's own while it
/// mutes or resumes the managed source, as `pw-dump` would not have noticed.
fn connection_failed(id: u32, res: i32) -> bool {
    res == -libc::EPIPE || (id == pw::core::PW_ID_CORE && res != -libc::ENOENT)
}

fn bind(registry: &pw::registry::RegistryRc, global: &pw::registry::GlobalObject<&spa::utils::dict::DictRef>, objects: &Rc<RefCell<Objects>>, bound: &Rc<RefCell<BTreeMap<u32, Bound>>>) {
    let id = global.id;
    let global_props = dict(global.props);
    let entry = match global.type_ {
        ObjectType::Node => {
            let Ok(node) = registry.bind::<pw::node::Node, _>(global) else { return };
            let (info_objects, param_objects) = (objects.clone(), objects.clone());
            let listener = node
                .add_listener_local()
                .info(move |info| {
                    let mut objects = info_objects.borrow_mut();
                    let readable = info.params().iter().any(|p| p.id() == spa::param::ParamType::Props && p.flags().contains(spa::param::ParamInfoFlags::READ));
                    if readable && !objects.params.contains_key(&id) {
                        objects.awaiting_params.insert(id, true);
                    }
                    if info.change_mask().contains(pw::node::NodeChangeMask::PARAMS) {
                        objects.node_params_changed(id);
                    }
                    let item = objects.items.entry(id).or_insert_with(|| json!({"id": id, "type": NODE, "info": {}}));
                    // The server sends the properties only with a change to them: an event for
                    // the params alone (a mute) keeps them, as pw-dump does.
                    if info.change_mask().contains(pw::node::NodeChangeMask::PROPS) || item["info"].get("props").is_none() {
                        item["info"]["props"] = Value::Object(dict(info.props()));
                    }
                })
                .param(move |_seq, kind, index, _next, pod| {
                    if kind != spa::param::ParamType::Props {
                        return;
                    }
                    param_objects.borrow_mut().props_param(id, index, pod.map(props_param));
                })
                .register();
            node.subscribe_params(&[spa::param::ParamType::Props]);
            Bound { _proxy: Box::new(node), _listener: Box::new(listener) }
        }
        ObjectType::Link => {
            let Ok(link) = registry.bind::<pw::link::Link, _>(global) else { return };
            let objects = objects.clone();
            let listener = link
                .add_listener_local()
                .info(move |info| {
                    let state = match info.state() {
                        pw::link::LinkState::Error(_) => "error",
                        pw::link::LinkState::Unlinked => "unlinked",
                        pw::link::LinkState::Init => "init",
                        pw::link::LinkState::Negotiating => "negotiating",
                        pw::link::LinkState::Allocating => "allocating",
                        pw::link::LinkState::Paused => "paused",
                        pw::link::LinkState::Active => "active",
                    };
                    let mut objects = objects.borrow_mut();
                    // The properties come only with a change to them (a state change alone keeps them).
                    let props = match objects.items.get(&id).and_then(|item| item["info"].get("props")) {
                        Some(props) if !info.change_mask().contains(pw::link::LinkChangeMask::PROPS) => props.clone(),
                        _ => Value::Object(dict(info.props())),
                    };
                    let item = json!({"id": id, "type": LINK, "info": {"output-node-id": info.output_node_id(), "input-node-id": info.input_node_id(), "state": state, "props": props}});
                    objects.items.insert(id, item);
                })
                .register();
            Bound { _proxy: Box::new(link), _listener: Box::new(listener) }
        }
        ObjectType::Client => {
            let Ok(client) = registry.bind::<pw::client::Client, _>(global) else { return };
            let objects = objects.clone();
            let listener = client
                .add_listener_local()
                .info(move |info| {
                    let mut objects = objects.borrow_mut();
                    if info.change_mask().contains(pw::client::ClientChangeMask::PROPS) || !objects.items.contains_key(&id) {
                        let item = json!({"id": id, "type": CLIENT, "info": {"props": dict(info.props())}});
                        objects.items.insert(id, item);
                    }
                })
                .register();
            Bound { _proxy: Box::new(client), _listener: Box::new(listener) }
        }
        ObjectType::Metadata => {
            let Ok(metadata) = registry.bind::<pw::metadata::Metadata, _>(global) else { return };
            objects.borrow_mut().items.insert(id, json!({"id": id, "type": METADATA, "props": global_props}));
            let objects = objects.clone();
            let listener = metadata
                .add_listener_local()
                .property(move |subject, key, kind, value| {
                    let mut objects = objects.borrow_mut();
                    let entries = objects.metadata.entry(id).or_default();
                    match (key, value) {
                        (None, _) => entries.retain(|(s, _), _| *s != subject),
                        (Some(key), None) => {
                            entries.remove(&(subject, key.to_owned()));
                        }
                        (Some(key), Some(value)) => {
                            entries.insert((subject, key.to_owned()), (kind.map(str::to_owned), value.to_owned()));
                        }
                    }
                    0
                })
                .register();
            Bound { _proxy: Box::new(metadata), _listener: Box::new(listener) }
        }
        _ => return,
    };
    objects.borrow_mut().bound_this_trip = true;
    bound.borrow_mut().insert(id, entry);
}

impl Snapshotter for NativeSnapshotter {
    fn snapshot(&mut self, deadline: f64, stop: &Event) -> Result<Graph, GraphUnavailable> {
        // Bindings made during a trip report their info only after it; repeat until a
        // trip binds nothing new and no announced Props are outstanding.
        loop {
            self.objects.borrow_mut().bound_this_trip = false;
            self.round_trip(deadline, stop)?;
            let objects = self.objects.borrow();
            if !objects.bound_this_trip && objects.awaiting_params.is_empty() {
                break;
            }
        }
        let graph = self.graph();
        // The same limit as the JSON from pw-dump.
        if serde_json::to_vec(&graph).map_or(true, |wire| wire.len() > crate::graph_source::MAX_BYTES) {
            return Err(GraphUnavailable);
        }
        Ok(graph)
    }
}

impl Drop for NativeSnapshotter {
    fn drop(&mut self) {
        // Proxies before the connection.
        self.bound.borrow_mut().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn props_sent_again_after_a_change_replace_the_ones_kept() {
        let mut objects = Objects::default();
        let muted = |m: bool| Some(json!({ "mute": m }));
        // The first info carries every change, then the subscription sends Props at 0.
        objects.node_params_changed(23);
        objects.props_param(23, 0, muted(true));
        assert_eq!(objects.params[&23].values().cloned().collect::<Vec<_>>(), vec![json!({ "mute": true })]);
        // A mute changes the params; the subscription sends Props again at 31.
        objects.node_params_changed(23);
        objects.props_param(23, 31, muted(false));
        assert_eq!(objects.params[&23].values().cloned().collect::<Vec<_>>(), vec![json!({ "mute": false })]);
        // Several Props in one batch all stay.
        objects.node_params_changed(23);
        objects.props_param(23, 4, muted(true));
        objects.props_param(23, 5, Some(json!({ "volume": 1.0 })));
        assert_eq!(objects.params[&23].len(), 2);
        // A change of other params, with no Props after it, keeps the Props.
        objects.node_params_changed(23);
        assert_eq!(objects.params[&23].len(), 2);
        // A node that goes keeps nothing.
        objects.removed(23);
        assert!(!objects.params.contains_key(&23) && !objects.params_changed.contains(&23));
    }

    #[test]
    fn an_object_gone_while_it_is_bound_does_not_end_the_connection() {
        let core = pw::core::PW_ID_CORE;
        // "unknown resource 43 op:…" after "no global 90" for proxy 43.
        assert!(!connection_failed(core, -libc::ENOENT));
        assert!(!connection_failed(43, -libc::ENOENT));
        // A broken connection, or another error of the core, still does.
        assert!(connection_failed(core, -libc::EPIPE));
        assert!(connection_failed(43, -libc::EPIPE));
        assert!(connection_failed(core, -libc::EINVAL));
        assert!(!connection_failed(43, -libc::EINVAL));
    }

    #[test]
    fn props_are_typed_like_pw_dump() {
        assert_eq!(prop_value("123"), json!(123));
        assert_eq!(prop_value("-4"), json!(-4));
        assert_eq!(prop_value("18446744073709551615"), json!(u64::MAX));
        assert_eq!(prop_value("0.5"), json!(0.5));
        assert_eq!(prop_value("true"), json!(true));
        assert_eq!(prop_value("v1"), json!("v1"));
        assert_eq!(prop_value("{ \"name\": \"x\" }"), json!({"name": "x"}));
        assert_eq!(prop_value("{ mute=true }"), json!("{ mute=true }"));
        assert_eq!(prop_value("Audio/Source"), json!("Audio/Source"));
        assert_eq!(prop_value("1-2"), json!("1-2"));
        assert_eq!(prop_value(""), json!(""));
    }
}
