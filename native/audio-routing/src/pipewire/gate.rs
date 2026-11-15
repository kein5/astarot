//! The managed route's mute, read from the graph and changed by a native helper.
//!
//! Port of `PipeWireGate` in `src-python/models/audio_routing/pipewire_gate.py`.
//! Every change goes through `vrct-voice-gate`, which acts only on the node with the
//! expected core cookie and serial, so a replaced endpoint is never changed by name.
//! A change counts only when a graph captured after the helper returned shows it.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::error::{Error, Result};
use crate::graph::{parse_managed, GateState, Graph};
use crate::graph_source::Subscription;
use crate::process::{run, ProcessEnv};
use crate::sync::{lock, monotonic, Event};
use crate::voice_route::{Gate, GatePair};

pub type GraphReader = Arc<dyn Fn(Option<f64>) -> Result<Arc<Graph>> + Send + Sync>;

pub struct PipeWireGate {
    helper: PathBuf,
    env: ProcessEnv,
    reader: GraphReader,
    observer: Mutex<Option<Subscription>>,
}

impl PipeWireGate {
    /// `helper` is `<resources>/build/vrct-voice-gate`.
    pub fn new(helper: PathBuf, env: ProcessEnv) -> Self {
        let reader: GraphReader = Arc::new(|after| crate::pipewire::read_graph_data(true, after).map_err(|_| Error::runtime("managed_graph_unavailable")));
        Self::with_reader(helper, env, reader)
    }

    pub fn with_reader(helper: PathBuf, env: ProcessEnv, reader: GraphReader) -> Self {
        Self { helper, env, reader, observer: Mutex::new(None) }
    }

    pub fn inspect(&self, after: Option<f64>) -> Result<GateState> {
        parse_managed(&(self.reader)(after)?, false)
    }

    fn pair(&self, after: Option<f64>) -> Result<GatePair> {
        let graph = (self.reader)(after)?;
        Ok(GatePair { source: parse_managed(&graph, false)?, direct: parse_managed(&graph, true)? })
    }

    fn helper(&self, args: &[String]) -> Result<()> {
        if !self.helper.is_file() {
            return Err(Error::runtime("voice_gate_helper_missing"));
        }
        let mut command = self.env.command(&self.helper);
        command.args(args);
        run(command, Duration::from_millis(2500)).map(|_| ()).map_err(|_| Error::runtime("gate_identity_or_control_failed"))
    }

    fn change(&self, muted: bool, identity: (u64, u64), direct: bool) -> Result<GateState> {
        let mut args = vec![identity.0.to_string(), identity.1.to_string(), if muted { "1" } else { "0" }.to_owned()];
        if direct {
            args.push("vc".into());
        }
        self.helper(&args)?;
        let after = Some(monotonic());
        let state = if direct { self.pair(after)?.direct } else { self.inspect(after)? };
        if state.identity != identity {
            return Err(Error::runtime("managed_endpoint_changed"));
        }
        if state.muted != muted {
            return Err(Error::runtime("gate_change_unconfirmed"));
        }
        Ok(state)
    }
}

impl Gate for PipeWireGate {
    fn observe(&self, enabled: bool, wake: &Arc<Event>) -> Result<()> {
        let mut observer = lock(&self.observer);
        if enabled && observer.is_none() {
            *observer = Some(crate::pipewire::graph_source().subscribe(Some(wake.clone())).map_err(|_| Error::runtime("managed_graph_unavailable"))?);
        } else if !enabled {
            *observer = None;
        }
        Ok(())
    }

    fn close_observer(&self) {
        *lock(&self.observer) = None;
    }

    fn prepare(&self) -> Result<()> {
        let reader = self.reader.clone();
        let snapshot = Box::new(move || reader(None).map(|graph| (*graph).clone()));
        crate::pipewire::managed::ManagedMicrophone::new(snapshot, self.env.clone()).ensure()
    }

    fn inspect_pair(&self) -> Result<GatePair> {
        self.pair(None)
    }

    fn set_muted(&self, muted: bool, identity: (u64, u64)) -> Result<GateState> {
        self.change(muted, identity, false)
    }

    fn set_direct_muted(&self, muted: bool, identity: (u64, u64)) -> Result<GateState> {
        self.change(muted, identity, true)
    }

    fn resume(&self, identity: (u64, u64), direct_identity: (u64, u64), suppress_direct: bool) -> Result<GatePair> {
        if identity.0 != direct_identity.0 {
            return Err(Error::runtime("direct_gate_identity_changed"));
        }
        self.helper(&[identity.0.to_string(), identity.1.to_string(), "0".into(), "guard-direct".into(), direct_identity.1.to_string(), if suppress_direct { "1" } else { "0" }.to_owned()])?;
        let pair = self.pair(Some(monotonic()))?;
        if pair.source.identity != identity || pair.source.muted {
            return Err(Error::runtime("gate_change_unconfirmed"));
        }
        if pair.direct.identity != direct_identity || pair.direct.muted != suppress_direct {
            return Err(Error::runtime("direct_gate_change_unconfirmed"));
        }
        Ok(pair)
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use serde_json::json;

    use super::*;

    fn managed(source_muted: bool, direct_muted: bool) -> Graph {
        let node = |name: &str, media: &str, serial: u64, muted: bool| json!({"type": "PipeWire:Interface:Node", "info": {"props": {"node.name": name, "media.class": media, "object.serial": serial, "vrct.managed.route": "v1"}, "params": {"Props": [{"mute": muted}]}}});
        vec![
            json!({"type": "PipeWire:Interface:Core", "info": {"cookie": 42}}),
            node("vrct.managed.source", "Audio/Source", 15, source_muted),
            node("vrct.managed.tts", "Audio/Sink", 16, false),
            node("vrct.managed.mix", "Audio/Sink", 17, false),
            node("vrct.managed.vc", "Audio/Sink", 18, direct_muted),
        ]
    }

    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A helper that records its arguments and exits with `status`.
    fn helper(name: &str, status: i32) -> (Scratch, PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("vrct-gate-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (script, log) = (dir.join("vrct-voice-gate"), dir.join("args"));
        std::fs::write(&script, format!("#!/bin/sh\necho \"$@\" >> '{}'\nexit {status}\n", log.display())).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        (Scratch(dir), script, log)
    }

    fn gate(script: PathBuf, graph: Arc<Mutex<Graph>>, afters: Arc<Mutex<Vec<Option<f64>>>>) -> PipeWireGate {
        PipeWireGate::with_reader(
            script,
            ProcessEnv::default(),
            Arc::new(move |after| {
                lock(&afters).push(after);
                Ok(Arc::new(lock(&graph).clone()))
            }),
        )
    }

    #[test]
    fn a_change_counts_only_when_a_later_graph_shows_it() {
        let (_scratch, script, log) = helper("confirm", 0);
        let graph = Arc::new(Mutex::new(managed(false, false)));
        let afters = Arc::new(Mutex::new(Vec::new()));
        let gate = gate(script, graph.clone(), afters.clone());
        // The helper "worked" but the graph still shows the old state.
        assert_eq!(gate.set_muted(true, (42, 15)).unwrap_err(), Error::runtime("gate_change_unconfirmed"));
        *lock(&graph) = managed(true, false);
        let before = monotonic();
        assert_eq!(gate.set_muted(true, (42, 15)).unwrap(), GateState { identity: (42, 15), muted: true });
        assert!(lock(&afters).last().unwrap().unwrap() >= before);
        assert_eq!(gate.set_muted(true, (42, 99)).unwrap_err(), Error::runtime("managed_endpoint_changed"));
        *lock(&graph) = managed(true, true);
        assert!(gate.set_direct_muted(true, (42, 18)).unwrap().muted);
        *lock(&graph) = managed(false, true);
        let pair = gate.resume((42, 15), (42, 18), true).unwrap();
        assert!(!pair.source.muted && pair.direct.muted);
        assert_eq!(gate.resume((42, 15), (43, 18), true).unwrap_err(), Error::runtime("direct_gate_identity_changed"));
        let calls = std::fs::read_to_string(log).unwrap();
        assert_eq!(calls.lines().collect::<Vec<_>>(), ["42 15 1", "42 15 1", "42 99 1", "42 18 1 vc", "42 15 0 guard-direct 18 1"]);
    }

    #[test]
    fn helper_failure_or_absence_is_a_control_failure() {
        let (_scratch, script, _) = helper("fail", 3);
        let graph = Arc::new(Mutex::new(managed(true, true)));
        let failing = gate(script.clone(), graph.clone(), Arc::new(Mutex::new(Vec::new())));
        assert_eq!(failing.set_muted(true, (42, 15)).unwrap_err(), Error::runtime("gate_identity_or_control_failed"));
        let missing = gate(script.with_file_name("absent"), graph, Arc::new(Mutex::new(Vec::new())));
        assert_eq!(missing.set_muted(true, (42, 15)).unwrap_err(), Error::runtime("voice_gate_helper_missing"));
    }
}
