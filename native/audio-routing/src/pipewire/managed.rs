//! Creating the managed endpoints as OS-owned user services.
//!
//! Port of [`src-python/models/audio_routing/managed_microphone.py`]. The route is
//! three `pw-loopback` user services, so it survives the application and does not
//! depend on an AppImage mount. A route that already works (made by hand or by the
//! daemon configuration) is used as it is. Foreign, partial or duplicate routes and
//! unit files are never replaced, and nothing is installed for a private server.
//!
//! The route took ASTAROT names in place of the VRCT ones (ADR-014, 2.8). The units the core of
//! 0.6.0 and earlier made under the old names keep their virtual microphone alive, so the core
//! retires them ([`audio_route::RETIRES_LEGACY_UNITS`], with no end): it stops, disables and
//! removes a unit only when its name, its owner marker and its whole content are what that core
//! wrote, and systemd loads that very file without drop-ins. Any other unit under an old name is
//! the user's. It stays, and while the new route is missing it is reported as
//! `managed_setup_conflict`, because a new route beside it would be a second virtual microphone.
//! While the old names are read ([`audio_route::READS_LEGACY_NAMES`]), old nodes that are not the
//! core's are reported the same way, and a hand-placed configuration under either name stops the
//! automatic setup.
//!
//! What to do is decided by [`look`] (before the lock, from files and the graph) and [`decide`]
//! (under the lock, from a [`Survey`] that also asks systemd), so the tests drive every case.
//!
//! [`src-python/models/audio_routing/managed_microphone.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/managed_microphone.py

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::time::Duration;

use app_identity::audio_route;
use serde_json::Value;

use crate::error::{Error, Result};
use crate::graph::{managed_ready, nodes, props, Graph};
use crate::process::{run, ProcessEnv};
use crate::sync::monotonic;

/// The names one version of the core gives the route and its units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Names {
    /// The first part of the node names: `<node>source`, `<node>tts`, `<node>vc`, `<node>mix`.
    pub node: &'static str,
    pub route_property: &'static str,
    pub owner_property: &'static str,
    /// The owner marker, on the nodes and so in the unit files.
    pub owner: &'static str,
    /// The first words of the node descriptions.
    pub description: &'static str,
    /// The first part of the units' names and of the loopbacks' `--name`.
    pub unit: &'static str,
    pub header: &'static str,
    pub unit_description: &'static str,
    /// The units, in the order of [`PARTS`].
    pub services: [&'static str; 3],
}

impl Names {
    /// The names this build writes.
    pub const CURRENT: Names = Names {
        node: audio_route::NODE_PREFIX.current(),
        route_property: audio_route::ROUTE_PROPERTY.current(),
        owner_property: audio_route::OWNER_PROPERTY.current(),
        owner: audio_route::OWNER.current(),
        description: audio_route::DESCRIPTION_PREFIX.current(),
        unit: audio_route::UNIT_PREFIX.current(),
        header: audio_route::UNIT_HEADER.current(),
        unit_description: audio_route::UNIT_DESCRIPTION.current(),
        services: ["astarot-managed-source.service", "astarot-managed-tts.service", "astarot-managed-vc.service"],
    };

    /// The names the core of 0.6.0 and earlier (and the Python backend before it) wrote.
    pub const LEGACY: Names = Names {
        node: audio_route::NODE_PREFIX.other(),
        route_property: audio_route::ROUTE_PROPERTY.other(),
        owner_property: audio_route::OWNER_PROPERTY.other(),
        owner: audio_route::OWNER.other(),
        description: audio_route::DESCRIPTION_PREFIX.other(),
        unit: audio_route::UNIT_PREFIX.other(),
        header: audio_route::UNIT_HEADER.other(),
        unit_description: audio_route::UNIT_DESCRIPTION.other(),
        services: ["vrct-managed-source.service", "vrct-managed-tts.service", "vrct-managed-vc.service"],
    };

    fn node_name(&self, suffix: &str) -> String {
        format!("{}{suffix}", self.node)
    }
}

pub const OWNER: &str = Names::CURRENT.owner;
pub const SERVICE_NAMES: [&str; 3] = Names::CURRENT.services;
pub const PARTS: [&str; 3] = ["source", "tts", "vc"];

/// Python `json.dumps` of an object with keys in the given order: `", "` and `": "`
/// separators, ASCII only. (A `serde_json::Map` would sort the keys.)
fn dumps(pairs: &[(&str, Value)]) -> String {
    let items: Vec<String> = pairs.iter().map(|(k, v)| format!("{}: {}", quote(k), dumps_value(v))).collect();
    format!("{{{}}}", items.join(", "))
}

fn dumps_value(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let pairs: Vec<(&str, Value)> = map.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
            dumps(&pairs)
        }
        Value::String(text) => quote(text),
        other => other.to_string(),
    }
}

fn quote(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || (c as u32) > 0x7f => {
                let mut units = [0u16; 2];
                for unit in c.encode_utf16(&mut units) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The fixed `pw-loopback` command of each service.
pub fn loopback_commands(names: &Names, binary: &str) -> Vec<(&'static str, Vec<String>)> {
    let common = || {
        vec![
            ("node.virtual", Value::Bool(true)),
            (names.route_property, "v1".into()),
            (names.owner_property, names.owner.into()),
            ("priority.session", (-100).into()),
            ("state.restore-props", Value::Bool(false)),
        ]
    };
    PARTS
        .iter()
        .zip(names.services)
        .map(|(&part, service)| {
            let mut capture = common();
            capture.push(("media.class", "Audio/Sink".into()));
            capture.push(("node.name", names.node_name(if part == "source" { "mix" } else { part }).into()));
            let input = match part {
                "source" => "Virtual Microphone Input",
                "tts" => "TTS Input",
                _ => "VC Input",
            };
            capture.push(("node.description", format!("{} {input}", names.description).into()));
            let mut playback = common();
            if part == "source" {
                playback.extend([
                    ("media.class", "Audio/Source".into()),
                    ("node.name", names.node_name("source").into()),
                    ("node.description", format!("{} Virtual Microphone", names.description).into()),
                    ("node.passive", Value::Bool(true)),
                    ("node.param.Props", serde_json::json!({"mute": true})),
                ]);
            } else {
                playback.extend([
                    ("node.name", names.node_name(&format!("{part}.output")).into()),
                    ("target.object", names.node_name("mix").into()),
                    ("node.dont-fallback", Value::Bool(true)),
                    ("node.dont-reconnect", Value::Bool(true)),
                ]);
            }
            let args = vec![
                binary.to_owned(),
                "--name".into(),
                format!("{}{part}", names.unit),
                "--channels".into(),
                "1".into(),
                "--channel-map".into(),
                "MONO".into(),
                "--capture-props".into(),
                dumps(&capture),
                "--playback-props".into(),
                dumps(&playback),
            ];
            (service, args)
        })
        .collect()
}

/// A path to `pw-loopback` that a unit file may name as it is.
fn safe_binary(binary: &str) -> bool {
    binary.starts_with('/') && binary.len() > 1 && binary.bytes().all(|b| b.is_ascii_alphanumeric() || b"_./+-".contains(&b))
}

/// The unit files, by name.
pub fn service_units(names: &Names, binary: &str) -> Result<Vec<(&'static str, String)>> {
    if !safe_binary(binary) {
        return Err(Error::runtime("managed_setup_tools_missing"));
    }
    Ok(loopback_commands(names, binary)
        .into_iter()
        .map(|(name, args)| {
            // JSON's ASCII quoting also quotes systemd's argv grammar; the fixed
            // arguments have no dollar or percent expansions.
            let command: Vec<String> = args.iter().map(|arg| quote(arg)).collect();
            let unit = format!(
                "{}\n[Unit]\nDescription={}\nAfter=pipewire.service wireplumber.service\n[Service]\nType=exec\nExecStart={}\nRestart=always\nRestartSec=2\nTimeoutStopSec=5\n[Install]\nWantedBy=default.target\n",
                names.header,
                names.unit_description,
                command.join(" ")
            );
            (name, unit)
        })
        .collect())
}

/// What a unit file of `names` holds when it is the core's: the file it wrote for the
/// `pw-loopback` its `ExecStart` names. That path is taken from the file, since the binary may
/// have been found elsewhere when the unit was made; the rest must match to the byte.
fn written_unit(names: &Names, index: usize, text: &str) -> Option<String> {
    let line = text.lines().find_map(|line| line.strip_prefix("ExecStart=\""))?;
    let binary = &line[..line.find('"')?];
    service_units(names, binary).ok()?.into_iter().nth(index).map(|(_, unit)| unit)
}

/// What is under one unit name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unit {
    /// No file, and systemd has nothing else under the name.
    Absent,
    /// The file the core writes, which systemd loads (or has yet to load) without drop-ins.
    Ours,
    /// Anything else: a changed file, a link, a unit in another folder, a drop-in, a mask.
    Foreign,
}

/// A unit file as found in the user's unit folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UnitFile {
    Missing,
    /// A link, a folder or an unreadable file.
    Other,
    Text(String),
}

impl UnitFile {
    fn read(path: &Path) -> UnitFile {
        match path.symlink_metadata() {
            Err(_) => UnitFile::Missing,
            Ok(meta) if !meta.file_type().is_file() => UnitFile::Other,
            Ok(_) => fs::read_to_string(path).map_or(UnitFile::Other, UnitFile::Text),
        }
    }
}

/// How one unit name stands: its file at `path`, the content the core writes there (`None`
/// when it cannot tell), and `systemctl show` of its `LoadState`, `FragmentPath` and
/// `DropInPaths`.
pub fn classify(file: &UnitFile, expected: Option<&str>, shown: &str, path: &Path) -> Unit {
    let property = |key: &str| shown.lines().find_map(|line| line.strip_prefix(key)?.strip_prefix('='));
    let fragment = property("FragmentPath").unwrap_or_default();
    if !matches!(property("LoadState"), Some("loaded" | "not-found"))
        || !property("DropInPaths").unwrap_or_default().is_empty()
        || (!fragment.is_empty() && Path::new(fragment) != path)
    {
        return Unit::Foreign;
    }
    match file {
        UnitFile::Missing => Unit::Absent,
        UnitFile::Text(text) if expected == Some(text.as_str()) => Unit::Ours,
        _ => Unit::Foreign,
    }
}

/// The route's nodes in the graph under one spelling, apart from a whole route.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Nodes {
    None,
    /// Each named once and marked with the core's owner: what its units make, perhaps partly.
    Ours,
    /// A node twice, or one without the core's owner marker (a hand-placed route, say).
    Foreign,
}

/// The nodes of `graph` whose names begin with the route's prefix in `names`.
pub fn nodes_of(graph: &Graph, names: &Names) -> Nodes {
    let existing: Vec<&serde_json::Map<String, Value>> =
        nodes(graph).filter_map(props).filter(|p| p.get("node.name").and_then(Value::as_str).is_some_and(|n| n.starts_with(names.node))).collect();
    if existing.is_empty() {
        return Nodes::None;
    }
    let mut seen: Vec<&str> = existing.iter().filter_map(|p| p.get("node.name").and_then(Value::as_str)).collect();
    let total = seen.len();
    seen.sort_unstable();
    seen.dedup();
    let foreign = existing.iter().any(|p| p.get(names.owner_property).and_then(Value::as_str) != Some(names.owner));
    if seen.len() != total || foreign {
        Nodes::Foreign
    } else {
        Nodes::Ours
    }
}

/// A configuration the user placed in `pipewire.conf.d` to make the route by hand.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Manual {
    /// Under the current name: the daemon has yet to load it.
    Current,
    /// Under the name of 0.6.0 and earlier: it makes the route under the old names.
    Legacy,
}

impl Manual {
    /// The code a preparation refuses with while it is there and the route is not.
    pub fn code(self) -> &'static str {
        match self {
            Manual::Current => "managed_setup_manual_config_pending",
            Manual::Legacy => "managed_setup_manual_config_legacy",
        }
    }
}

/// The hand-placed configuration under one of `bases` (`$XDG_CONFIG_HOME` and `/etc`), the
/// old name first, since that one has to go in any case.
pub fn manual_config(bases: &[&Path], legacy: bool) -> Option<Manual> {
    let placed = |name: &str| bases.iter().any(|base| base.join("pipewire/pipewire.conf.d").join(name).exists());
    if legacy && placed(audio_route::MANUAL_CONFIG.other()) {
        return Some(Manual::Legacy);
    }
    placed(audio_route::MANUAL_CONFIG.current()).then_some(Manual::Current)
}

/// What a preparation can tell before it takes the lock and asks systemd.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Look {
    /// The whole route under the current names.
    pub ready: bool,
    /// A PipeWire server other than the session's (a private or test one).
    pub custom_remote: bool,
    /// `systemctl` and `pw-loopback` are there.
    pub tools: bool,
    /// `$XDG_RUNTIME_DIR` is a folder.
    pub session: bool,
    /// A file under a unit name of the old route is in the user's unit folder.
    pub legacy_files: bool,
    pub manual: Option<Manual>,
}

/// Whether a preparation goes on to the lock and the [`Survey`]; `false` uses the route as it is.
pub fn look(first: &Look) -> std::result::Result<bool, &'static str> {
    // A working route is used as it is, unless units of the old route may still run beside it
    // and the core can retire them. Nothing of the host's is touched for a private server.
    if first.ready && (first.custom_remote || !first.legacy_files || !first.tools || !first.session) {
        return Ok(false);
    }
    if first.custom_remote {
        return Err("managed_setup_custom_remote");
    }
    if !first.tools {
        return Err("managed_setup_tools_missing");
    }
    if !first.session {
        return Err("managed_setup_session_unavailable");
    }
    match first.manual {
        Some(manual) if !first.ready => Err(manual.code()),
        _ => Ok(true),
    }
}

/// What a preparation found under the lock.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Survey {
    /// The whole route under the current names, each node once.
    pub ready: bool,
    pub nodes: Nodes,
    pub units: [Unit; 3],
    /// The old route's nodes, `None` once the old names are not read, and its units, `Absent`
    /// once they are not retired.
    pub legacy_nodes: Nodes,
    pub legacy_units: [Unit; 3],
}

/// What a preparation does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plan {
    /// The route works and no unit of the old names is the core's.
    Use,
    /// Retire the core's units of the old names, then (with `install`) make sure the route's
    /// units exist and run.
    Prepare { retire: bool, install: bool },
}

/// The plan for `survey`, or the code it is refused with.
pub fn decide(survey: &Survey) -> std::result::Result<Plan, &'static str> {
    let conflict = "managed_setup_conflict";
    // One unit of the old route that is the user's keeps all three: they belong together.
    let theirs = survey.legacy_units.contains(&Unit::Foreign);
    let retire = !theirs && survey.legacy_units.contains(&Unit::Ours);
    if survey.ready {
        return Ok(if retire { Plan::Prepare { retire, install: false } } else { Plan::Use });
    }
    // Beside an old route that is not the core's, a new one would be a second microphone.
    if theirs || survey.legacy_nodes == Nodes::Foreign {
        return Err(conflict);
    }
    // An interrupted install of ours may be completed; anything else is ambiguous.
    match survey.nodes {
        Nodes::Foreign => return Err(conflict),
        Nodes::Ours if survey.units.contains(&Unit::Absent) => return Err(conflict),
        _ => {}
    }
    if survey.units.contains(&Unit::Foreign) {
        return Err(conflict);
    }
    Ok(Plan::Prepare { retire, install: true })
}

/// What a preparation did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prepared {
    /// The route was there; the core made nothing (it may have retired old units).
    Ready,
    /// The core wrote or completed the route's units and started them.
    Created,
}

/// Runs `systemctl --user <args>`; the standard output on success.
pub type Systemctl = Box<dyn Fn(&Path, &[&str]) -> Result<String> + Send + Sync>;
pub type Snapshot = Box<dyn Fn() -> Result<Graph> + Send + Sync>;
/// Told when the units of the old route have stopped: the virtual microphone VRChat had
/// chosen is gone, and the user has to choose the new one there (ADR-014, 2.8).
pub type Retired = Box<dyn Fn() + Send + Sync>;

pub struct ManagedMicrophone {
    snapshot: Snapshot,
    pub env: ProcessEnv,
    pub timeout: Duration,
    /// Whether the old names are read ([`audio_route::READS_LEGACY_NAMES`]; tests turn it off).
    pub reads_legacy: bool,
    /// Whether the units of the old route are retired ([`audio_route::RETIRES_LEGACY_UNITS`]).
    pub retires_legacy: bool,
    systemctl: Systemctl,
    retired: Option<Retired>,
}

fn real_systemctl(env: ProcessEnv) -> Systemctl {
    Box::new(move |binary, args| {
        let mut command = env.command(binary);
        command.arg("--user").args(args);
        run(command, Duration::from_secs(5)).map_err(|_| Error::runtime("managed_setup_service_failed"))
    })
}

const SHOW: [&str; 4] = ["show", "--property=LoadState", "--property=FragmentPath", "--property=DropInPaths"];

impl ManagedMicrophone {
    pub fn new(snapshot: Snapshot, env: ProcessEnv) -> Self {
        let systemctl = real_systemctl(env.clone());
        Self::with_systemctl(snapshot, env, systemctl)
    }

    /// With a substitute for `systemctl` (tests).
    pub fn with_systemctl(snapshot: Snapshot, env: ProcessEnv, systemctl: Systemctl) -> Self {
        Self {
            snapshot,
            env,
            timeout: Duration::from_secs(5),
            reads_legacy: audio_route::READS_LEGACY_NAMES,
            retires_legacy: audio_route::RETIRES_LEGACY_UNITS,
            systemctl,
            retired: None,
        }
    }

    /// Tells `retired` each time the units of the old route stop.
    pub fn on_retired(mut self, retired: Retired) -> Self {
        self.retired = Some(retired);
        self
    }

    /// An unreadable graph is an error, never "not ready": installing on a guess
    /// could duplicate a route.
    fn ready(&self) -> Result<bool> {
        Ok(managed_ready(&(self.snapshot)()?))
    }

    fn config_home(&self) -> PathBuf {
        let config = PathBuf::from(self.env.get("XDG_CONFIG_HOME").unwrap_or_default());
        if config.is_absolute() {
            config
        } else {
            PathBuf::from(self.env.get("HOME").unwrap_or_default()).join(".config")
        }
    }

    /// The units of `names` in `directory`, with the content the core writes for each.
    fn units(&self, systemctl: &Path, directory: &Path, names: &Names, expected: impl Fn(usize, &UnitFile) -> Option<String>) -> Result<[Unit; 3]> {
        let mut units = [Unit::Absent; 3];
        for (index, &name) in names.services.iter().enumerate() {
            let path = directory.join(name);
            let file = UnitFile::read(&path);
            let mut show = SHOW.to_vec();
            show.push(name);
            let shown = (self.systemctl)(systemctl, &show)?;
            units[index] = classify(&file, expected(index, &file).as_deref(), &shown, &path);
        }
        Ok(units)
    }

    fn survey(&self, graph: &Graph, systemctl: &Path, directory: &Path, current: &[(&str, String)]) -> Result<Survey> {
        let units = self.units(systemctl, directory, &Names::CURRENT, |index, _| current.get(index).map(|(_, unit)| unit.clone()))?;
        let legacy_units = if self.retires_legacy {
            let legacy = |index, file: &UnitFile| match file {
                UnitFile::Text(text) => written_unit(&Names::LEGACY, index, text),
                _ => None,
            };
            self.units(systemctl, directory, &Names::LEGACY, legacy)?
        } else {
            [Unit::Absent; 3]
        };
        let legacy_nodes = if self.reads_legacy { nodes_of(graph, &Names::LEGACY) } else { Nodes::None };
        Ok(Survey { ready: managed_ready(graph), nodes: nodes_of(graph, &Names::CURRENT), units, legacy_nodes, legacy_units })
    }

    /// Stops, disables and removes the core's units of the old route.
    fn retire(&self, systemctl: &Path, directory: &Path, units: &[Unit; 3]) -> Result<()> {
        let ours: Vec<(usize, &str)> = Names::LEGACY.services.into_iter().enumerate().filter(|(index, _)| units[*index] == Unit::Ours).collect();
        let mut disable = vec!["disable", "--now"];
        disable.extend(ours.iter().map(|(_, name)| *name));
        (self.systemctl)(systemctl, &disable)?;
        if let Some(retired) = &self.retired {
            retired();
        }
        for (index, name) in ours {
            let path = directory.join(name);
            // Only while it still holds what the core wrote: an edit since the survey is the user's.
            if let UnitFile::Text(text) = UnitFile::read(&path)
                && written_unit(&Names::LEGACY, index, &text).as_deref() == Some(text.as_str())
            {
                fs::remove_file(&path).map_err(|_| Error::runtime("managed_setup_files_unavailable"))?;
            }
        }
        Ok(())
    }

    /// Make sure the managed route exists, installing the user services if needed and retiring
    /// the core's units of the old route.
    pub fn ensure(&self) -> Result<Prepared> {
        let graph = (self.snapshot)()?;
        let runtime_dir = self.env.get("XDG_RUNTIME_DIR");
        let runtime = PathBuf::from(runtime_dir.clone().unwrap_or_default());
        let config = self.config_home();
        let directory = config.join("systemd/user");
        let tools = (self.env.which("systemctl"), self.env.which("pw-loopback"));
        let first = Look {
            ready: managed_ready(&graph),
            // Never provision the host's manager for a private or test server.
            custom_remote: self.env.get("PIPEWIRE_REMOTE").as_deref().unwrap_or("pipewire-0") != "pipewire-0"
                || self.env.get("PIPEWIRE_RUNTIME_DIR").is_some_and(|dir| Some(dir) != runtime_dir),
            tools: tools.0.is_some() && tools.1.is_some(),
            session: runtime.is_absolute() && runtime.is_dir(),
            legacy_files: self.retires_legacy && Names::LEGACY.services.iter().any(|name| directory.join(name).symlink_metadata().is_ok()),
            manual: manual_config(&[config.as_path(), Path::new("/etc")], self.reads_legacy),
        };
        if !look(&first).map_err(Error::runtime)? {
            return Ok(Prepared::Ready); // Routes the daemon owns need neither systemd nor files.
        }
        let (Some(systemctl), Some(binary)) = tools else {
            return Err(Error::runtime("managed_setup_tools_missing"));
        };
        let units = service_units(&Names::CURRENT, binary.to_str().unwrap_or(""))?;
        let files = |_| Error::runtime("managed_setup_files_unavailable");
        let lock = OpenOptions::new()
            .read(true)
            .append(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(runtime.join(audio_route::SETUP_LOCK.current()))
            .map_err(files)?;
        let deadline = monotonic() + self.timeout.as_secs_f64();
        while unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            if monotonic() >= deadline {
                return Err(Error::runtime("managed_setup_busy"));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        // The lock is released when `lock` closes.
        let graph = (self.snapshot)()?;
        if managed_ready(&graph) && !first.legacy_files {
            return Ok(Prepared::Ready);
        }
        let survey = self.survey(&graph, &systemctl, &directory, &units)?;
        let Plan::Prepare { retire, install } = decide(&survey).map_err(Error::runtime)? else {
            return Ok(Prepared::Ready);
        };
        if retire {
            self.retire(&systemctl, &directory, &survey.legacy_units)?;
        }
        if !install {
            (self.systemctl)(&systemctl, &["daemon-reload"])?;
            return Ok(Prepared::Ready);
        }
        fs::create_dir_all(&directory).map_err(files)?;
        for (name, content) in &units {
            let path = directory.join(name);
            if !path.exists() {
                // Exclusive creation never overwrites an administrator's or user's file.
                let mut file = OpenOptions::new().write(true).create_new(true).open(&path).map_err(files)?;
                file.write_all(content.as_bytes()).map_err(files)?;
                file.sync_all().map_err(files)?;
            }
        }
        (self.systemctl)(&systemctl, &["daemon-reload"])?;
        let written = self.units(&systemctl, &directory, &Names::CURRENT, |index, _| units.get(index).map(|(_, unit)| unit.clone()))?;
        if written != [Unit::Ours; 3] {
            return Err(Error::runtime("managed_setup_conflict"));
        }
        let mut enable = vec!["enable", "--now"];
        enable.extend(units.iter().map(|(name, _)| *name));
        (self.systemctl)(&systemctl, &enable)?;
        let deadline = monotonic() + self.timeout.as_secs_f64();
        loop {
            if self.ready().unwrap_or(false) {
                return Ok(Prepared::Created);
            }
            if monotonic() >= deadline {
                return Err(Error::runtime("managed_setup_timeout"));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(test)]
mod tests;
