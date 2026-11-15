//! Ports of `tests/voice/test_managed_microphone.py`. Only `systemctl` and the graph
//! are substitutes; files are real, in a scratch directory.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use serde_json::json;

use super::*;
use crate::graph::parse_managed;
use crate::sync::lock;

fn complete_graph() -> Graph {
    let node = |id: u64, name: &str, media: &str, serial: u64, muted: bool| json!({"type": "PipeWire:Interface:Node", "id": id, "info": {"props": {"node.name": name, "media.class": media, "object.serial": serial, "vrct.managed.route": "v1"}, "params": {"Props": [{"mute": muted}]}}});
    vec![
        json!({"type": "PipeWire:Interface:Core", "info": {"cookie": 7}}),
        node(1, "vrct.managed.source", "Audio/Source", 15, true),
        node(2, "vrct.managed.tts", "Audio/Sink", 16, false),
        node(3, "vrct.managed.mix", "Audio/Sink", 17, false),
        node(4, "vrct.managed.vc", "Audio/Sink", 18, false),
    ]
}

#[derive(Default)]
struct Machine {
    graph: Graph,
    started: BTreeSet<String>,
    calls: Vec<Vec<String>>,
    broken: Option<&'static str>,
    not_ready: bool,
    fragments: BTreeMap<String, String>,
    dropins: BTreeMap<String, String>,
}

struct Fixture {
    root: PathBuf,
    state: Arc<Mutex<Machine>>,
    setup: ManagedMicrophone,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn fixture(name: &str) -> Fixture {
    let root = std::env::temp_dir().join(format!("vrct-managed-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let bin = root.join("bin");
    fs::create_dir_all(&bin).unwrap();
    fs::create_dir_all(root.join("run")).unwrap();
    for tool in ["systemctl", "pw-loopback"] {
        let path = bin.join(tool);
        fs::write(&path, "#!/bin/sh\nexit 1\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let state = Arc::new(Mutex::new(Machine::default()));
    let (graph_state, run_state, units) = (state.clone(), state.clone(), root.join("config/systemd/user"));
    let systemctl: Systemctl = Box::new(move |_, args| {
        let mut machine = lock(&run_state);
        machine.calls.push(args.iter().map(|a| a.to_string()).collect());
        let verb = args[0];
        if machine.broken == Some(verb) {
            return Err(Error::runtime("managed_setup_service_failed"));
        }
        match verb {
            "show" => {
                let name = args[args.len() - 1];
                Ok(format!(
                    "LoadState={}\nFragmentPath={}\nDropInPaths={}",
                    if machine.fragments.contains_key(name) { "loaded" } else { "not-found" },
                    machine.fragments.get(name).cloned().unwrap_or_default(),
                    machine.dropins.get(name).cloned().unwrap_or_default()
                ))
            }
            "daemon-reload" => {
                for entry in fs::read_dir(&units).into_iter().flatten().flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.ends_with(".service") {
                        machine.fragments.insert(name, entry.path().to_string_lossy().into_owned());
                    }
                }
                Ok(String::new())
            }
            "enable" => {
                assert!(args.contains(&"--now"));
                machine.started.extend(args.iter().filter(|a| a.ends_with(".service")).map(|a| a.to_string()));
                if machine.started.len() == 3 && !machine.not_ready {
                    machine.graph = complete_graph();
                }
                Ok(String::new())
            }
            other => panic!("unexpected host operation {other}"),
        }
    });
    let env = ProcessEnv::from_pairs([("XDG_CONFIG_HOME", root.join("config").into_os_string()), ("XDG_RUNTIME_DIR", root.join("run").into_os_string()), ("PATH", bin.into_os_string())]);
    let mut setup = ManagedMicrophone::with_systemctl(Box::new(move || Ok(lock(&graph_state).graph.clone())), env, systemctl);
    setup.timeout = Duration::from_millis(30);
    Fixture { root, state, setup }
}

fn unit_dir(f: &Fixture) -> PathBuf {
    f.root.join("config/systemd/user")
}

fn unit_files(f: &Fixture) -> BTreeMap<String, Vec<u8>> {
    fs::read_dir(unit_dir(f)).into_iter().flatten().flatten().map(|e| (e.file_name().to_string_lossy().into_owned(), fs::read(e.path()).unwrap())).collect()
}

#[test]
fn unit_files_are_byte_identical_to_the_python_ones() {
    let expected: BTreeMap<String, String> = serde_json::from_str(include_str!("../../../tests/data/managed_units.json")).unwrap();
    let units: BTreeMap<String, String> = service_units("/usr/bin/pw-loopback").unwrap().into_iter().map(|(k, v)| (k.to_owned(), v)).collect();
    assert_eq!(units, expected);
    assert!(service_units("relative/pw-loopback").is_err());
    assert!(service_units("/usr/bin/pw loopback").is_err());
}

#[test]
fn existing_manual_graph_is_reused_without_install_or_service_calls() {
    let f = fixture("manual");
    lock(&f.state).graph = complete_graph();
    f.setup.ensure().unwrap();
    assert!(lock(&f.state).calls.is_empty());
    assert!(!f.root.join("config").exists());
}

#[test]
fn empty_host_creates_muted_persistent_route_and_reuses_it() {
    let f = fixture("empty");
    f.setup.ensure().unwrap();
    assert_eq!(lock(&f.state).started.len(), 3);
    let before = unit_files(&f);
    assert_eq!(before.len(), 3);
    assert!(parse_managed(&lock(&f.state).graph, false).unwrap().muted);
    let calls = lock(&f.state).calls.len();
    f.setup.ensure().unwrap();
    assert_eq!(lock(&f.state).calls.len(), calls);
    assert_eq!(unit_files(&f), before);
}

#[test]
fn foreign_or_ambiguous_graph_is_not_replaced() {
    for fault in ["partial", "wrong_marker", "duplicate"] {
        let f = fixture(fault);
        {
            let mut machine = lock(&f.state);
            machine.graph = complete_graph();
            match fault {
                "partial" => {
                    machine.graph.pop();
                }
                "wrong_marker" => machine.graph[1]["info"]["props"]["vrct.managed.route"] = json!("other"),
                _ => {
                    let copy = machine.graph[1].clone();
                    machine.graph.push(copy);
                }
            }
        }
        assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime("managed_setup_conflict"), "{fault}");
        assert!(lock(&f.state).started.is_empty());
        assert!(!unit_dir(&f).exists());
    }
}

#[test]
fn foreign_service_configuration_is_preserved() {
    let name = "vrct-managed-source.service";
    for kind in ["file", "symlink", "manager", "dropin"] {
        let f = fixture(kind);
        fs::create_dir_all(unit_dir(&f)).unwrap();
        let path = unit_dir(&f).join(name);
        match kind {
            "file" => fs::write(&path, "user content").unwrap(),
            "symlink" => std::os::unix::fs::symlink("/dev/null", &path).unwrap(),
            "manager" => {
                lock(&f.state).fragments.insert(name.into(), format!("/etc/systemd/user/{name}"));
            }
            _ => {
                lock(&f.state).dropins.insert(name.into(), format!("/etc/systemd/user/{name}.d/override.conf"));
            }
        }
        assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime("managed_setup_conflict"), "{kind}");
        assert!(lock(&f.state).started.is_empty());
        if kind == "file" {
            assert_eq!(fs::read_to_string(&path).unwrap(), "user content");
        }
        if kind == "symlink" {
            assert!(path.symlink_metadata().unwrap().file_type().is_symlink());
        }
    }
}

#[test]
fn os_failure_never_reports_ready() {
    for verb in ["show", "daemon-reload", "enable"] {
        let f = fixture(verb);
        lock(&f.state).broken = Some(verb);
        assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime("managed_setup_service_failed"), "{verb}");
        assert!(lock(&f.state).graph.is_empty());
    }
}

#[test]
fn service_start_success_without_endpoints_is_a_failure() {
    let f = fixture("not-ready");
    lock(&f.state).not_ready = true;
    assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime("managed_setup_timeout"));
}

#[test]
fn failed_start_can_be_retried_without_replacing_units() {
    let f = fixture("retry");
    lock(&f.state).broken = Some("enable");
    assert!(f.setup.ensure().is_err());
    let before = unit_files(&f);
    lock(&f.state).broken = None;
    f.setup.ensure().unwrap();
    assert!(!lock(&f.state).graph.is_empty());
    assert_eq!(unit_files(&f), before);
}

#[test]
fn missing_tools_and_custom_remote_do_not_modify_host() {
    let mut f = fixture("tools");
    f.setup.env.set("PATH", "/nonexistent");
    assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime("managed_setup_tools_missing"));
    assert!(lock(&f.state).calls.is_empty());
    f.setup.env.set("PIPEWIRE_REMOTE", "private-test");
    assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime("managed_setup_custom_remote"));
    assert!(!f.root.join("config").exists());
}

#[test]
fn saved_manual_route_is_not_duplicated_before_daemon_loads_it() {
    let f = fixture("pending");
    let manual = f.root.join("config/pipewire/pipewire.conf.d/90-vrct-managed.conf");
    fs::create_dir_all(manual.parent().unwrap()).unwrap();
    fs::write(&manual, "existing daemon configuration").unwrap();
    assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime("managed_setup_manual_config_pending"));
    assert!(lock(&f.state).calls.is_empty());
    assert_eq!(fs::read_to_string(&manual).unwrap(), "existing daemon configuration");
}

#[test]
fn concurrent_preparation_installs_only_one_route() {
    let mut f = fixture("concurrent");
    f.setup.timeout = Duration::from_secs(5);
    std::thread::scope(|scope| {
        let calls: Vec<_> = (0..2).map(|_| scope.spawn(|| f.setup.ensure())).collect();
        for call in calls {
            call.join().unwrap().unwrap();
        }
    });
    assert_eq!(lock(&f.state).calls.iter().filter(|c| c[0] == "enable").count(), 1);
    assert_eq!(unit_files(&f).len(), 3);
}

#[test]
fn partial_owned_route_can_be_completed_without_removing_endpoint() {
    let f = fixture("partial-owned");
    f.setup.ensure().unwrap();
    {
        let mut machine = lock(&f.state);
        machine.graph.pop();
        for item in machine.graph.iter_mut().filter(|i| i["type"] == "PipeWire:Interface:Node") {
            item["info"]["props"]["vrct.managed.owner"] = json!(OWNER);
        }
        machine.started.clear();
    }
    f.setup.ensure().unwrap();
    assert_eq!(lock(&f.state).graph.len(), 5);
}

#[test]
fn unreadable_graph_installs_nothing() {
    let f = fixture("unreadable");
    let setup = ManagedMicrophone::with_systemctl(Box::new(|| Err(Error::runtime("managed_graph_unavailable"))), f.setup.env.clone(), Box::new(|_, _| panic!("no service call")));
    assert_eq!(setup.ensure().unwrap_err(), Error::runtime("managed_graph_unavailable"));
    assert!(!f.root.join("config").exists());
}
