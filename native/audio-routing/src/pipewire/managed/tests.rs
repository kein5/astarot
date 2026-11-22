//! Ports of `tests/voice/test_managed_microphone.py`, and the move of the route to its ASTAROT
//! names (ADR-014, 2.8). Only `systemctl` and the graph are substitutes; files are real, in a
//! scratch directory.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use serde_json::json;

use super::*;
use crate::graph::{parse_managed, CORE};
use crate::sync::lock;

fn route_nodes(names: &Names, owned: bool) -> Graph {
    let node = |id: u64, part: &str, media: &str, serial: u64, muted: bool| {
        let mut props = json!({"node.name": format!("{}{part}", names.node), "media.class": media, "object.serial": serial, names.route_property: "v1"});
        if owned {
            props[names.owner_property] = json!(names.owner);
        }
        json!({"type": "PipeWire:Interface:Node", "id": id, "info": {"props": props, "params": {"Props": [{"mute": muted}]}}})
    };
    let base = if *names == Names::CURRENT { 0 } else { 10 };
    vec![
        node(base + 1, "source", "Audio/Source", base + 15, true),
        node(base + 2, "tts", "Audio/Sink", base + 16, false),
        node(base + 3, "mix", "Audio/Sink", base + 17, false),
        node(base + 4, "vc", "Audio/Sink", base + 18, false),
    ]
}

fn core() -> Value {
    json!({"type": CORE, "info": {"cookie": 7}})
}

/// The route as a hand-placed configuration makes it: no owner marker.
fn complete_graph() -> Graph {
    let mut graph = vec![core()];
    graph.extend(route_nodes(&Names::CURRENT, false));
    graph
}

/// The route of 0.6.0 and earlier, running from its units.
fn legacy_graph() -> Graph {
    let mut graph = vec![core()];
    graph.extend(route_nodes(&Names::LEGACY, true));
    graph
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
    retired: Arc<Mutex<usize>>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn fixture(name: &str) -> Fixture {
    let root = std::env::temp_dir().join(format!("astarot-managed-{}-{name}", std::process::id()));
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
        let services = || args.iter().filter(|a| a.ends_with(".service")).map(|a| a.to_string());
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
                machine.fragments.retain(|_, path| Path::new(path).exists() || !path.contains("/config/systemd/user/"));
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
                machine.started.extend(services());
                if machine.started.len() == 3 && !machine.not_ready {
                    let others: Vec<Value> = machine.graph.iter().filter(|i| i["type"] != CORE).cloned().collect();
                    machine.graph = complete_graph();
                    machine.graph.extend(others.into_iter().filter(|i| i["info"]["props"]["node.name"].as_str().is_some_and(|n| !n.starts_with(Names::CURRENT.node))));
                }
                Ok(String::new())
            }
            "disable" => {
                assert!(args.contains(&"--now"));
                // Stopping the old units takes their nodes away.
                let stopped: Vec<String> = services().collect();
                assert!(stopped.iter().all(|s| Names::LEGACY.services.contains(&s.as_str())), "{stopped:?}");
                machine.graph.retain(|i| !i["info"]["props"]["node.name"].as_str().is_some_and(|n| n.starts_with(Names::LEGACY.node)));
                Ok(String::new())
            }
            other => panic!("unexpected host operation {other}"),
        }
    });
    let env = ProcessEnv::from_pairs([("XDG_CONFIG_HOME", root.join("config").into_os_string()), ("XDG_RUNTIME_DIR", root.join("run").into_os_string()), ("PATH", bin.into_os_string())]);
    let retired = Arc::new(Mutex::new(0));
    let told = retired.clone();
    let mut setup =
        ManagedMicrophone::with_systemctl(Box::new(move || Ok(lock(&graph_state).graph.clone())), env, systemctl).on_retired(Box::new(move || *lock(&told) += 1));
    setup.timeout = Duration::from_millis(30);
    // The period of the old names is the build's; these tests say which they mean.
    setup.reads_legacy = true;
    setup.retires_legacy = true;
    Fixture { root, state, setup, retired }
}

fn unit_dir(f: &Fixture) -> PathBuf {
    f.root.join("config/systemd/user")
}

fn unit_files(f: &Fixture) -> BTreeMap<String, Vec<u8>> {
    // A link reads as where it points: it may point nowhere.
    let read = |path: PathBuf| fs::read_link(&path).map(|target| target.into_os_string().into_encoded_bytes()).or_else(|_| fs::read(&path)).unwrap();
    fs::read_dir(unit_dir(f)).into_iter().flatten().flatten().map(|e| (e.file_name().to_string_lossy().into_owned(), read(e.path()))).collect()
}

/// The units the core of 0.6.0 wrote, loaded and running, for `pw-loopback` at `binary`.
fn place_legacy_units(f: &Fixture, binary: &str) {
    fs::create_dir_all(unit_dir(f)).unwrap();
    let mut machine = lock(&f.state);
    for (name, content) in service_units(&Names::LEGACY, binary).unwrap() {
        let path = unit_dir(f).join(name);
        fs::write(&path, content).unwrap();
        machine.fragments.insert(name.into(), path.to_string_lossy().into_owned());
    }
    machine.graph = legacy_graph();
}

fn verbs(f: &Fixture) -> Vec<String> {
    lock(&f.state).calls.iter().map(|c| c[0].clone()).filter(|v| v != "show").collect()
}

#[test]
fn unit_files_are_byte_identical_to_what_each_version_wrote() {
    // 0.6.0 and earlier, and the Python backend before them, wrote these; the core still
    // writes them to the byte to tell its own old units.
    for (names, fixture) in [(Names::LEGACY, include_str!("../../../tests/data/managed_units_vrct.json")), (Names::CURRENT, include_str!("../../../tests/data/managed_units_astarot.json"))] {
        let expected: BTreeMap<String, String> = serde_json::from_str(fixture).unwrap();
        let units: BTreeMap<String, String> = service_units(&names, "/usr/bin/pw-loopback").unwrap().into_iter().map(|(k, v)| (k.to_owned(), v)).collect();
        assert_eq!(units, expected);
        assert!(service_units(&names, "relative/pw-loopback").is_err());
        assert!(service_units(&names, "/usr/bin/pw loopback").is_err());
    }
}

#[test]
fn the_new_units_differ_from_the_old_by_the_names_alone() {
    for ((old_name, old), (new_name, new)) in service_units(&Names::LEGACY, "/usr/bin/pw-loopback").unwrap().into_iter().zip(service_units(&Names::CURRENT, "/usr/bin/pw-loopback").unwrap()) {
        assert_eq!(old_name.replace("vrct-", "astarot-"), new_name);
        let renamed = old
            .replace("VRCT-VOX", "ASTAROT")
            .replace("vrct-vox-service-v1", "astarot-service-v1")
            .replace("VRCT", "ASTAROT")
            .replace("vrct.managed.", "astarot.managed.")
            .replace("vrct-managed-", "astarot-managed-");
        assert_eq!(renamed, new);
        assert!(new.contains("ASTAROT Managed Virtual Microphone") || !new_name.contains("source"));
        assert!(!new.to_ascii_lowercase().contains("vrct"), "{new}");
    }
    assert_eq!(SERVICE_NAMES, ["astarot-managed-source.service", "astarot-managed-tts.service", "astarot-managed-vc.service"]);
    assert_eq!(OWNER, "astarot-service-v1");
    for names in [Names::CURRENT, Names::LEGACY] {
        for (service, part) in names.services.iter().zip(PARTS) {
            assert_eq!(*service, format!("{}{part}.service", names.unit));
        }
    }
}

#[test]
fn existing_manual_graph_is_reused_without_install_or_service_calls() {
    let f = fixture("manual");
    lock(&f.state).graph = complete_graph();
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Ready);
    assert!(lock(&f.state).calls.is_empty());
    assert!(!f.root.join("config").exists());
}

#[test]
fn empty_host_creates_muted_persistent_route_and_reuses_it() {
    let f = fixture("empty");
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Created);
    assert_eq!(lock(&f.state).started.len(), 3);
    let before = unit_files(&f);
    assert_eq!(before.keys().map(String::as_str).collect::<Vec<_>>(), SERVICE_NAMES);
    assert!(parse_managed(&lock(&f.state).graph, false).unwrap().muted);
    let calls = lock(&f.state).calls.len();
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Ready);
    assert_eq!(lock(&f.state).calls.len(), calls);
    assert_eq!(unit_files(&f), before);
    assert_eq!(*lock(&f.retired), 0, "nothing old was there");
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
                "wrong_marker" => machine.graph[1]["info"]["props"]["astarot.managed.route"] = json!("other"),
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
    let name = "astarot-managed-source.service";
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
    // Under the new name it waits for the daemon; under the old one it makes the old route,
    // which has to be replaced by hand (ADR-014, 2.8).
    for (file, code) in [("90-astarot-managed.conf", "managed_setup_manual_config_pending"), ("90-vrct-managed.conf", "managed_setup_manual_config_legacy")] {
        let f = fixture(file);
        let manual = f.root.join("config/pipewire/pipewire.conf.d").join(file);
        fs::create_dir_all(manual.parent().unwrap()).unwrap();
        fs::write(&manual, "existing daemon configuration").unwrap();
        if file.contains("vrct") {
            // The daemon loaded it: the old route is there, made by hand.
            let mut graph = vec![core()];
            graph.extend(route_nodes(&Names::LEGACY, false));
            lock(&f.state).graph = graph;
        }
        assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime(code), "{file}");
        assert!(lock(&f.state).calls.is_empty(), "{file}");
        assert_eq!(fs::read_to_string(&manual).unwrap(), "existing daemon configuration");
        assert!(!unit_dir(&f).exists(), "{file}");
    }
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
            item["info"]["props"]["astarot.managed.owner"] = json!(OWNER);
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

// ------------------------------------------------------------------ the old names (ADR-014, 2.8)

#[test]
fn the_old_units_are_retired_and_the_route_is_made_under_the_new_names() {
    let f = fixture("retire");
    // The old units name the pw-loopback found when they were made, which need not be today's.
    place_legacy_units(&f, "/usr/bin/pw-loopback");
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Created);
    assert_eq!(*lock(&f.retired), 1);
    assert_eq!(unit_files(&f).keys().map(String::as_str).collect::<Vec<_>>(), SERVICE_NAMES, "only the new units are left");
    let machine = lock(&f.state);
    let disabled: Vec<&Vec<String>> = machine.calls.iter().filter(|c| c[0] == "disable").collect();
    assert_eq!(disabled, [&["disable", "--now", "vrct-managed-source.service", "vrct-managed-tts.service", "vrct-managed-vc.service"].map(String::from).to_vec()]);
    // Stopped before anything new is made, so that one virtual microphone is there at a time.
    drop(machine);
    assert_eq!(verbs(&f), ["disable", "daemon-reload", "enable"]);
    let machine = lock(&f.state);
    assert_eq!(nodes_of(&machine.graph, &Names::LEGACY), Nodes::None);
    // The new microphone starts muted: nothing is heard until the user unmutes it.
    assert!(parse_managed(&machine.graph, false).unwrap().muted);
    assert!(!machine.fragments.keys().any(|name| name.starts_with("vrct-")), "systemd forgot the old units");
}

#[test]
fn the_old_units_are_retired_beside_a_working_route() {
    // A route of the new names already works (a downgrade made the old units again, say).
    let f = fixture("retire-ready");
    place_legacy_units(&f, "/bin/pw-loopback");
    {
        let mut machine = lock(&f.state);
        let legacy = std::mem::take(&mut machine.graph);
        machine.graph = complete_graph();
        machine.graph.extend(legacy.into_iter().skip(1));
    }
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Ready);
    assert_eq!(*lock(&f.retired), 1);
    assert!(unit_files(&f).is_empty(), "the old units are gone and nothing new was written");
    assert_eq!(verbs(&f), ["disable", "daemon-reload"]);
    assert!(managed_ready(&lock(&f.state).graph));
}

#[test]
fn old_units_that_are_not_the_cores_are_kept_and_no_second_microphone_is_made() {
    for kind in ["edited", "owner", "dropin", "symlink", "elsewhere", "one_of_three"] {
        let f = fixture(&format!("theirs-{kind}"));
        place_legacy_units(&f, "/usr/bin/pw-loopback");
        let path = unit_dir(&f).join("vrct-managed-tts.service");
        match kind {
            "edited" => fs::write(&path, fs::read_to_string(&path).unwrap().replace("RestartSec=2", "RestartSec=9")).unwrap(),
            // Same unit, another owner: not what the core wrote.
            "owner" => fs::write(&path, fs::read_to_string(&path).unwrap().replace("vrct-vox-service-v1", "my-service")).unwrap(),
            "dropin" => {
                lock(&f.state).dropins.insert("vrct-managed-tts.service".into(), "/home/u/.config/systemd/user/vrct-managed-tts.service.d/x.conf".into());
            }
            "symlink" => {
                fs::remove_file(&path).unwrap();
                std::os::unix::fs::symlink("/etc/systemd/user/vrct-managed-tts.service", &path).unwrap();
            }
            "elsewhere" => {
                fs::remove_file(&path).unwrap();
                lock(&f.state).fragments.insert("vrct-managed-tts.service".into(), "/etc/systemd/user/vrct-managed-tts.service".into());
            }
            _ => {
                // Only one of the three is the user's: the core leaves all three.
                fs::remove_file(unit_dir(&f).join("vrct-managed-source.service")).unwrap();
                fs::write(&path, "user content").unwrap();
            }
        }
        let before = unit_files(&f);
        assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime("managed_setup_conflict"), "{kind}");
        assert_eq!(unit_files(&f), before, "{kind}");
        assert_eq!(verbs(&f), Vec::<String>::new(), "{kind}: nothing stopped, nothing made");
        assert_eq!(*lock(&f.retired), 0, "{kind}");
    }
}

#[test]
fn old_units_that_are_the_users_stay_beside_a_working_route() {
    let f = fixture("theirs-ready");
    place_legacy_units(&f, "/usr/bin/pw-loopback");
    let path = unit_dir(&f).join("vrct-managed-vc.service");
    fs::write(&path, "user content").unwrap();
    lock(&f.state).graph = complete_graph();
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Ready);
    assert_eq!(fs::read_to_string(&path).unwrap(), "user content");
    assert_eq!(verbs(&f), Vec::<String>::new());
    assert_eq!(*lock(&f.retired), 0);
}

#[test]
fn an_old_route_made_by_hand_keeps_the_new_one_from_being_made() {
    // Nodes of the old names without the core's owner, from a configuration under another name.
    let f = fixture("old-by-hand");
    let mut graph = vec![core()];
    graph.extend(route_nodes(&Names::LEGACY, false));
    lock(&f.state).graph = graph;
    assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime("managed_setup_conflict"));
    assert!(!unit_dir(&f).exists());
    // The nodes of the core's old units are not in the way: they go when the units stop.
    let f = fixture("old-nodes-ours");
    lock(&f.state).graph = legacy_graph();
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Created);
}

#[test]
fn a_failed_retirement_is_retried_and_tells_once_the_units_stopped() {
    let f = fixture("retire-retry");
    place_legacy_units(&f, "/usr/bin/pw-loopback");
    lock(&f.state).broken = Some("disable");
    assert_eq!(f.setup.ensure().unwrap_err(), Error::runtime("managed_setup_service_failed"));
    assert_eq!(*lock(&f.retired), 0, "the old microphone still runs");
    assert_eq!(unit_files(&f).len(), 3);
    assert!(unit_files(&f).keys().all(|name| name.starts_with("vrct-")));
    lock(&f.state).broken = None;
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Created);
    assert_eq!(*lock(&f.retired), 1);
    // Retiring is done once: the next preparation finds nothing old.
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Ready);
    assert_eq!(*lock(&f.retired), 1);
}

#[test]
fn once_the_old_names_are_no_longer_read_the_core_still_retires_its_old_units() {
    // Decided on 2026-11-23: retiring the units the old core wrote has no end, so an install that
    // skips the versions that read the old names still loses the old microphone.
    let mut f = fixture("period");
    f.setup.reads_legacy = false;
    place_legacy_units(&f, "/usr/bin/pw-loopback");
    let manual = f.root.join("config/pipewire/pipewire.conf.d/90-vrct-managed.conf");
    fs::create_dir_all(manual.parent().unwrap()).unwrap();
    fs::write(&manual, "old").unwrap();
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Created, "the old hand-placed configuration is not read");
    assert_eq!(*lock(&f.retired), 1);
    assert_eq!(unit_files(&f).len(), 3);
    assert!(unit_files(&f).keys().all(|name| name.starts_with("astarot-")), "{:?}", unit_files(&f).keys());
}

#[test]
fn with_neither_reading_nor_retiring_nothing_of_the_old_names_is_touched() {
    let mut f = fixture("period-off");
    f.setup.reads_legacy = false;
    f.setup.retires_legacy = false;
    place_legacy_units(&f, "/usr/bin/pw-loopback");
    let manual = f.root.join("config/pipewire/pipewire.conf.d/90-vrct-managed.conf");
    fs::create_dir_all(manual.parent().unwrap()).unwrap();
    fs::write(&manual, "old").unwrap();
    assert_eq!(f.setup.ensure().unwrap(), Prepared::Created);
    assert_eq!(*lock(&f.retired), 0);
    assert_eq!(unit_files(&f).len(), 6, "the old units are left alone");
    assert!(!verbs(&f).contains(&"disable".to_owned()));
}

// ------------------------------------------------------------------ the decisions alone

fn first() -> Look {
    Look { ready: false, custom_remote: false, tools: true, session: true, legacy_files: false, manual: None }
}

#[test]
fn the_first_look_uses_a_working_route_unless_old_units_may_run_beside_it() {
    let ready = Look { ready: true, ..first() };
    assert_eq!(look(&ready), Ok(false));
    assert_eq!(look(&Look { legacy_files: true, ..ready }), Ok(true));
    // What cannot retire anything uses the route as it is.
    for cannot in [Look { custom_remote: true, ..ready }, Look { tools: false, ..ready }, Look { session: false, ..ready }] {
        assert_eq!(look(&Look { legacy_files: true, ..cannot }), Ok(false), "{cannot:?}");
    }
    // A hand-placed configuration does not stop retiring beside a working route.
    assert_eq!(look(&Look { legacy_files: true, manual: Some(Manual::Legacy), ..ready }), Ok(true));
    assert_eq!(look(&first()), Ok(true));
    assert_eq!(look(&Look { custom_remote: true, ..first() }), Err("managed_setup_custom_remote"));
    assert_eq!(look(&Look { tools: false, ..first() }), Err("managed_setup_tools_missing"));
    assert_eq!(look(&Look { session: false, ..first() }), Err("managed_setup_session_unavailable"));
    assert_eq!(look(&Look { manual: Some(Manual::Current), ..first() }), Err("managed_setup_manual_config_pending"));
    assert_eq!(look(&Look { manual: Some(Manual::Legacy), legacy_files: true, ..first() }), Err("managed_setup_manual_config_legacy"));
}

fn survey() -> Survey {
    Survey { ready: false, nodes: Nodes::None, units: [Unit::Absent; 3], legacy_nodes: Nodes::None, legacy_units: [Unit::Absent; 3] }
}

#[test]
fn the_decision_retires_only_the_cores_old_units_and_never_makes_a_second_microphone() {
    let install = Ok(Plan::Prepare { retire: false, install: true });
    let conflict = Err("managed_setup_conflict");
    assert_eq!(decide(&survey()), install);
    assert_eq!(decide(&Survey { legacy_units: [Unit::Ours; 3], legacy_nodes: Nodes::Ours, ..survey() }), Ok(Plan::Prepare { retire: true, install: true }));
    // Two of three left by an interrupted retirement are still the core's.
    assert_eq!(decide(&Survey { legacy_units: [Unit::Absent, Unit::Ours, Unit::Ours], ..survey() }), Ok(Plan::Prepare { retire: true, install: true }));
    assert_eq!(decide(&Survey { legacy_units: [Unit::Ours, Unit::Foreign, Unit::Ours], ..survey() }), conflict);
    assert_eq!(decide(&Survey { legacy_nodes: Nodes::Foreign, ..survey() }), conflict);
    // The nodes of the core's old units may linger a moment after they stop.
    assert_eq!(decide(&Survey { legacy_nodes: Nodes::Ours, ..survey() }), install);
    let ready = Survey { ready: true, ..survey() };
    assert_eq!(decide(&ready), Ok(Plan::Use));
    assert_eq!(decide(&Survey { legacy_units: [Unit::Ours; 3], ..ready }), Ok(Plan::Prepare { retire: true, install: false }));
    assert_eq!(decide(&Survey { legacy_units: [Unit::Foreign, Unit::Ours, Unit::Ours], ..ready }), Ok(Plan::Use));
    assert_eq!(decide(&Survey { legacy_nodes: Nodes::Foreign, units: [Unit::Foreign; 3], ..ready }), Ok(Plan::Use));
    // The current names, as before the move.
    assert_eq!(decide(&Survey { nodes: Nodes::Foreign, ..survey() }), conflict);
    assert_eq!(decide(&Survey { nodes: Nodes::Ours, ..survey() }), conflict);
    assert_eq!(decide(&Survey { nodes: Nodes::Ours, units: [Unit::Ours; 3], ..survey() }), install);
    assert_eq!(decide(&Survey { units: [Unit::Ours, Unit::Foreign, Unit::Absent], ..survey() }), conflict);
}

#[test]
fn a_unit_is_the_cores_only_as_written_and_loaded_from_its_own_file() {
    let path = Path::new("/home/u/.config/systemd/user/vrct-managed-tts.service");
    let shown = |load: &str, fragment: &str, dropins: &str| format!("LoadState={load}\nFragmentPath={fragment}\nDropInPaths={dropins}");
    let text = UnitFile::Text("unit".into());
    let here = path.to_str().unwrap();
    assert_eq!(classify(&text, Some("unit"), &shown("loaded", here, ""), path), Unit::Ours);
    assert_eq!(classify(&text, Some("unit"), &shown("not-found", "", ""), path), Unit::Ours);
    assert_eq!(classify(&UnitFile::Missing, None, &shown("not-found", "", ""), path), Unit::Absent);
    assert_eq!(classify(&text, Some("other"), &shown("loaded", here, ""), path), Unit::Foreign);
    assert_eq!(classify(&text, None, &shown("loaded", here, ""), path), Unit::Foreign);
    assert_eq!(classify(&UnitFile::Other, Some("unit"), &shown("loaded", here, ""), path), Unit::Foreign);
    assert_eq!(classify(&text, Some("unit"), &shown("masked", here, ""), path), Unit::Foreign);
    assert_eq!(classify(&text, Some("unit"), &shown("loaded", here, "/x.d/y.conf"), path), Unit::Foreign);
    assert_eq!(classify(&UnitFile::Missing, None, &shown("loaded", "/etc/systemd/user/vrct-managed-tts.service", ""), path), Unit::Foreign);
    // The binary is read from the file; anything else must match what the core wrote.
    let old = service_units(&Names::LEGACY, "/opt/pipewire/bin/pw-loopback").unwrap();
    assert_eq!(written_unit(&Names::LEGACY, 1, &old[1].1).as_deref(), Some(old[1].1.as_str()));
    assert_ne!(written_unit(&Names::LEGACY, 2, &old[1].1).as_deref(), Some(old[1].1.as_str()), "another unit's content");
    assert_eq!(written_unit(&Names::LEGACY, 0, "ExecStart=\"relative\" x"), None);
    assert_eq!(written_unit(&Names::LEGACY, 0, "no command"), None);
}

#[test]
fn a_hand_placed_configuration_is_found_under_either_name_while_the_old_one_is_read() {
    let root = std::env::temp_dir().join(format!("astarot-managed-manual-{}", std::process::id()));
    let (user, system) = (root.join("user"), root.join("system"));
    let place = |base: &Path, name: &str| {
        let dir = base.join("pipewire/pipewire.conf.d");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(name), "").unwrap();
    };
    let bases = [user.as_path(), system.as_path()];
    assert_eq!(manual_config(&bases, true), None);
    place(&system, "90-astarot-managed.conf");
    assert_eq!(manual_config(&bases, true), Some(Manual::Current));
    place(&user, "90-vrct-managed.conf");
    assert_eq!(manual_config(&bases, true), Some(Manual::Legacy), "the old one has to go in any case");
    assert_eq!(manual_config(&bases, false), Some(Manual::Current));
    let _ = fs::remove_dir_all(&root);
}
