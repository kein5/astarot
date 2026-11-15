//! Creating the managed endpoints as OS-owned user services.
//!
//! Port of `src-python/models/audio_routing/managed_microphone.py`. The route is
//! three `pw-loopback` user services, so it survives the application and does not
//! depend on an AppImage mount. A route that already works (made by hand or by the
//! daemon configuration) is used as it is. Foreign, partial or duplicate routes and
//! unit files are never replaced, and nothing is installed for a private server.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

use crate::error::{Error, Result};
use crate::graph::{managed_ready, nodes, props, Graph};
use crate::process::{run, ProcessEnv};
use crate::sync::monotonic;

pub const OWNER: &str = "vrct-vox-service-v1";
pub const SERVICE_NAMES: [&str; 3] = ["vrct-managed-source.service", "vrct-managed-tts.service", "vrct-managed-vc.service"];
const PARTS: [&str; 3] = ["source", "tts", "vc"];

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
pub fn loopback_commands(binary: &str) -> Vec<(&'static str, Vec<String>)> {
    let common = || {
        vec![
            ("node.virtual", Value::Bool(true)),
            ("vrct.managed.route", "v1".into()),
            ("vrct.managed.owner", OWNER.into()),
            ("priority.session", (-100).into()),
            ("state.restore-props", Value::Bool(false)),
        ]
    };
    PARTS
        .iter()
        .zip(SERVICE_NAMES)
        .map(|(&part, service)| {
            let mut capture = common();
            capture.push(("media.class", "Audio/Sink".into()));
            capture.push(("node.name", if part == "source" { "vrct.managed.mix".to_owned() } else { format!("vrct.managed.{part}") }.into()));
            capture.push((
                "node.description",
                match part {
                    "source" => "VRCT Managed Virtual Microphone Input",
                    "tts" => "VRCT Managed TTS Input",
                    _ => "VRCT Managed VC Input",
                }
                .into(),
            ));
            let mut playback = common();
            if part == "source" {
                playback.extend([
                    ("media.class", "Audio/Source".into()),
                    ("node.name", "vrct.managed.source".into()),
                    ("node.description", "VRCT Managed Virtual Microphone".into()),
                    ("node.passive", Value::Bool(true)),
                    ("node.param.Props", serde_json::json!({"mute": true})),
                ]);
            } else {
                playback.extend([
                    ("node.name", format!("vrct.managed.{part}.output").into()),
                    ("target.object", "vrct.managed.mix".into()),
                    ("node.dont-fallback", Value::Bool(true)),
                    ("node.dont-reconnect", Value::Bool(true)),
                ]);
            }
            let args = vec![
                binary.to_owned(),
                "--name".into(),
                format!("vrct-managed-{part}"),
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

/// The unit files, by name.
pub fn service_units(binary: &str) -> Result<Vec<(&'static str, String)>> {
    let safe = binary.starts_with('/') && binary.len() > 1 && binary.bytes().all(|b| b.is_ascii_alphanumeric() || b"_./+-".contains(&b));
    if !safe {
        return Err(Error::runtime("managed_setup_tools_missing"));
    }
    Ok(loopback_commands(binary)
        .into_iter()
        .map(|(name, args)| {
            // JSON's ASCII quoting also quotes systemd's argv grammar; the fixed
            // arguments have no dollar or percent expansions.
            let command: Vec<String> = args.iter().map(|arg| quote(arg)).collect();
            let unit = format!(
                "# VRCT managed microphone v1; created by VRCT-VOX\n[Unit]\nDescription=VRCT managed audio endpoint\nAfter=pipewire.service wireplumber.service\n[Service]\nType=exec\nExecStart={}\nRestart=always\nRestartSec=2\nTimeoutStopSec=5\n[Install]\nWantedBy=default.target\n",
                command.join(" ")
            );
            (name, unit)
        })
        .collect())
}

/// Runs `systemctl --user <args>`; the standard output on success.
pub type Systemctl = Box<dyn Fn(&Path, &[&str]) -> Result<String> + Send + Sync>;
pub type Snapshot = Box<dyn Fn() -> Result<Graph> + Send + Sync>;

pub struct ManagedMicrophone {
    snapshot: Snapshot,
    pub env: ProcessEnv,
    pub timeout: Duration,
    systemctl: Systemctl,
}

fn real_systemctl(env: ProcessEnv) -> Systemctl {
    Box::new(move |binary, args| {
        let mut command = env.command(binary);
        command.arg("--user").args(args);
        run(command, Duration::from_secs(5)).map_err(|_| Error::runtime("managed_setup_service_failed"))
    })
}

impl ManagedMicrophone {
    pub fn new(snapshot: Snapshot, env: ProcessEnv) -> Self {
        let systemctl = real_systemctl(env.clone());
        Self { snapshot, env, timeout: Duration::from_secs(5), systemctl }
    }

    /// With a substitute for `systemctl` (tests).
    pub fn with_systemctl(snapshot: Snapshot, env: ProcessEnv, systemctl: Systemctl) -> Self {
        Self { snapshot, env, timeout: Duration::from_secs(5), systemctl }
    }

    /// An unreadable graph is an error, never "not ready": installing on a guess
    /// could duplicate a route.
    fn ready(&self) -> Result<bool> {
        Ok(managed_ready(&(self.snapshot)()?))
    }

    fn validate_units(&self, systemctl: &Path, directory: &Path, units: &[(&str, String)]) -> Result<()> {
        let conflict = || Error::runtime("managed_setup_conflict");
        for (name, content) in units {
            let path = directory.join(name);
            let link = path.symlink_metadata().is_ok_and(|m| m.file_type().is_symlink());
            if link || (path.exists() && fs::read_to_string(&path).map_err(|_| conflict())? != *content) {
                return Err(conflict());
            }
            let shown = (self.systemctl)(systemctl, &["show", "--property=LoadState", "--property=FragmentPath", "--property=DropInPaths", name])?;
            let property = |key: &str| shown.lines().find_map(|line| line.strip_prefix(key)?.strip_prefix('=')).map(str::to_owned);
            if !matches!(property("LoadState").as_deref(), Some("loaded" | "not-found")) {
                return Err(conflict());
            }
            let fragment = property("FragmentPath").unwrap_or_default();
            if !property("DropInPaths").unwrap_or_default().is_empty() || (!fragment.is_empty() && Path::new(&fragment) != path) {
                return Err(conflict());
            }
        }
        Ok(())
    }

    /// Make sure the managed route exists, installing the user services if needed.
    pub fn ensure(&self) -> Result<()> {
        if self.ready()? {
            return Ok(()); // Routes the daemon owns need neither systemd nor files.
        }
        // Never provision the host's manager for a private or test server.
        let runtime_dir = self.env.get("XDG_RUNTIME_DIR");
        if self.env.get("PIPEWIRE_REMOTE").as_deref().unwrap_or("pipewire-0") != "pipewire-0" || self.env.get("PIPEWIRE_RUNTIME_DIR").is_some_and(|dir| Some(dir) != runtime_dir) {
            return Err(Error::runtime("managed_setup_custom_remote"));
        }
        let (Some(systemctl), Some(binary)) = (self.env.which("systemctl"), self.env.which("pw-loopback")) else {
            return Err(Error::runtime("managed_setup_tools_missing"));
        };
        let runtime = PathBuf::from(runtime_dir.unwrap_or_default());
        if !runtime.is_absolute() || !runtime.is_dir() {
            return Err(Error::runtime("managed_setup_session_unavailable"));
        }
        let mut config = PathBuf::from(self.env.get("XDG_CONFIG_HOME").unwrap_or_default());
        if !config.is_absolute() {
            config = PathBuf::from(self.env.get("HOME").unwrap_or_default()).join(".config");
        }
        for base in [config.as_path(), Path::new("/etc")] {
            if base.join("pipewire/pipewire.conf.d/90-vrct-managed.conf").exists() {
                return Err(Error::runtime("managed_setup_manual_config_pending"));
            }
        }
        let directory = config.join("systemd/user");
        let units = service_units(binary.to_str().unwrap_or(""))?;
        let files = |_| Error::runtime("managed_setup_files_unavailable");
        let lock = OpenOptions::new().read(true).append(true).create(true).mode(0o600).custom_flags(libc::O_NOFOLLOW).open(runtime.join("vrct-managed-setup.lock")).map_err(files)?;
        let deadline = monotonic() + self.timeout.as_secs_f64();
        while unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            if monotonic() >= deadline {
                return Err(Error::runtime("managed_setup_busy"));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        // The lock is released when `lock` closes.
        let graph = (self.snapshot)()?;
        if managed_ready(&graph) {
            return Ok(());
        }
        let existing: Vec<&serde_json::Map<String, Value>> =
            nodes(&graph).filter_map(props).filter(|p| p.get("node.name").and_then(Value::as_str).is_some_and(|n| n.starts_with("vrct.managed."))).collect();
        let mut names: Vec<&str> = existing.iter().filter_map(|p| p.get("node.name").and_then(Value::as_str)).collect();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        // An interrupted install of ours may be completed; anything else is ambiguous.
        let foreign = existing.iter().any(|p| p.get("vrct.managed.owner").and_then(Value::as_str) != Some(OWNER));
        if names.len() != total || foreign || (!existing.is_empty() && !units.iter().all(|(name, _)| directory.join(name).is_file())) {
            return Err(Error::runtime("managed_setup_conflict"));
        }
        self.validate_units(&systemctl, &directory, &units)?;
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
        self.validate_units(&systemctl, &directory, &units)?;
        let mut enable = vec!["enable", "--now"];
        enable.extend(units.iter().map(|(name, _)| *name));
        (self.systemctl)(&systemctl, &enable)?;
        let deadline = monotonic() + self.timeout.as_secs_f64();
        loop {
            if self.ready().unwrap_or(false) {
                return Ok(());
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
