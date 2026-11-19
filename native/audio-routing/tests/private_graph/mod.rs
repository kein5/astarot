//! A PipeWire daemon of its own with the managed route, and WirePlumber's policy on it, in a
//! temporary folder (`private_graph` of `tools/voice_acceptance.py`). The user's own graph is
//! not touched. It needs `pipewire`, `wireplumber` 0.5 and `pw-dump`; the Linux CI builds them
//! into a prefix of their own (`tools/ci/setup_pipewire.sh`).
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use vrct_audio_routing::pipewire::output::PipeWireOutput;
use vrct_audio_routing::router::{CancelToken, Output};

const DAEMON: &str = r#"
context.properties = {
    core.daemon = true
    core.name = NAME
    default.clock.rate = 48000
    default.clock.quantum = 256
}
context.spa-libs = {
    audio.convert.* = audioconvert/libspa-audioconvert
    support.* = support/libspa-support
}
context.modules = [
    { name = libpipewire-module-rt flags = [ ifexists nofail ] }
    { name = libpipewire-module-protocol-native }
    { name = libpipewire-module-metadata }
    { name = libpipewire-module-spa-node-factory }
    { name = libpipewire-module-client-node }
    { name = libpipewire-module-access }
    { name = libpipewire-module-adapter }
    { name = libpipewire-module-link-factory }
    MANAGED
]
context.objects = [
    { factory = spa-node-factory args = {
        factory.name = support.node.driver
        node.name = Dummy-Driver
        node.group = pipewire.dummy
        priority.driver = 20000
    } }
]
"#;

pub struct PrivateGraph {
    pub dir: PathBuf,
    children: Vec<Child>,
}

impl PrivateGraph {
    /// Starts the graph and points this process, and every process it starts, at it. Call it
    /// before anything connects to PipeWire, and only once per test binary: it sets environment
    /// variables.
    pub fn start(name: &str) -> PrivateGraph {
        let managed = include_str!("../../../../config/pipewire/90-vrct-managed.conf").trim();
        let managed = managed.strip_prefix("context.modules = [").and_then(|m| m.strip_suffix(']')).expect("a modules fragment");
        let dir = std::env::temp_dir().join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("the graph folder can be made");
        let config = dir.join("daemon.conf");
        std::fs::write(&config, DAEMON.replace("NAME", name).replace("MANAGED", managed)).expect("the graph's settings can be written");
        // SAFETY: the test binary connects to PipeWire only after this, from this thread.
        unsafe {
            std::env::set_var("PIPEWIRE_RUNTIME_DIR", &dir);
            std::env::set_var("PIPEWIRE_REMOTE", name);
            std::env::set_var("XDG_STATE_HOME", dir.join("state"));
            std::env::set_var("XDG_CONFIG_HOME", dir.join("config"));
        }
        let mut graph = PrivateGraph { dir: dir.clone(), children: Vec::new() };
        let daemon = Command::new("pipewire")
            .arg("-c")
            .arg(&config)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("pipewire starts");
        graph.children.push(daemon);
        let socket = dir.join(name);
        wait("the private PipeWire", || socket.exists());
        // WirePlumber's own policy files beside its binary, not the user's.
        let binary = which("wireplumber").canonicalize().expect("wireplumber");
        let prefix = binary.parent().and_then(Path::parent).expect("an installation prefix").to_path_buf();
        let data = prefix.join("share/wireplumber");
        let modules = std::iter::once(prefix.join("lib/wireplumber-0.5"))
            .chain(std::fs::read_dir(prefix.join("lib")).into_iter().flatten().flatten().map(|e| e.path().join("wireplumber-0.5")))
            .find(|p| p.is_dir())
            .expect("WirePlumber's modules");
        let policy = Command::new(binary)
            .args(["--profile", "policy"])
            .env("WIREPLUMBER_CONFIG_DIR", &data)
            .env("WIREPLUMBER_DATA_DIR", &data)
            .env("WIREPLUMBER_MODULE_DIR", modules)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("wireplumber starts");
        let pid = policy.id().to_string();
        graph.children.push(policy);
        // The policy links the managed TTS and VC outputs to the mix once it runs.
        wait("WirePlumber's links on the private graph", || {
            let objects = dump();
            let client = objects.iter().any(|o| o["info"]["props"]["application.process.id"].to_string().trim_matches('"') == pid);
            let links = objects.iter().filter(|o| o["type"] == "PipeWire:Interface:Link").count();
            client && links >= 2
        });
        graph
    }
}

impl Drop for PrivateGraph {
    fn drop(&mut self) {
        for child in self.children.iter_mut().rev() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The graph as `pw-dump` gives it.
pub fn dump() -> Vec<Value> {
    Command::new("pw-dump").output().ok().and_then(|o| serde_json::from_slice(&o.stdout).ok()).unwrap_or_default()
}

/// Waits up to 10 s for `done`.
pub fn wait(what: &str, done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !done() {
        assert!(Instant::now() < deadline, "{what} did not come up");
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub fn which(name: &str) -> PathBuf {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .map(|dir| dir.join(name))
        .find(|p| p.is_file())
        .unwrap_or_else(|| panic!("{name} is not on PATH"))
}

/// Builds a native helper (`native/<name>/main.c`) with libpipewire into `dir`, as
/// `tools/build_voice_gate.py` builds it for the app.
pub fn build_helper(name: &str, dir: &Path) -> PathBuf {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let flags = Command::new("pkg-config").args(["--cflags", "--libs", "libpipewire-0.3"]).output().expect("pkg-config");
    assert!(flags.status.success(), "libpipewire-0.3 is not found by pkg-config");
    let flags = String::from_utf8(flags.stdout).expect("pkg-config's flags");
    let binary = dir.join(format!("vrct-{name}"));
    let built = Command::new("cc")
        .args(["-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror"])
        .arg(root.join("native").join(name).join("main.c"))
        .arg("-o")
        .arg(&binary)
        .args(flags.split_whitespace())
        .status()
        .expect("cc");
    assert!(built.success(), "vrct-{name} does not build");
    binary
}

/// A virtual microphone: what is played into `<name>.sink` comes out of `<name>.source`
/// (`loopback` of `tools/voice_acceptance.py`).
pub fn microphone(name: &str) -> Child {
    let child = Command::new("pw-loopback")
        .args(["--name", name, "--channels", "1", "--channel-map", "MONO"])
        .arg("--capture-props")
        .arg(format!("media.class=Audio/Sink node.name={name}.sink node.virtual=true"))
        .arg("--playback-props")
        .arg(format!("media.class=Audio/Source node.name={name}.source node.virtual=true node.passive=true"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("pw-loopback starts");
    let source = format!("{name}.source");
    wait("the virtual microphone", || {
        dump().iter().any(|o| o["info"]["props"]["node.name"] == source.as_str() && o["info"]["props"]["media.class"] == "Audio/Source")
    });
    child
}

/// Plays a 440 Hz tone into `sink` until the returned flag is set.
pub fn tone(sink: &str) -> Arc<AtomicBool> {
    let stop = Arc::new(AtomicBool::new(false));
    let (stopping, sink) = (stop.clone(), sink.to_owned());
    std::thread::spawn(move || {
        let mut output = PipeWireOutput::open(&sink, 48000, 1, None, "vrct.test.tone").expect("the tone plays");
        let token = CancelToken::new(None);
        let mut phase = 0usize;
        while !stopping.load(Ordering::SeqCst) {
            let block: Vec<u8> = (0..960)
                .map(|i| {
                    let t = (phase + i) as f64 / 48000.0;
                    ((t * 440.0 * std::f64::consts::TAU).sin() * 8000.0) as i16
                })
                .flat_map(i16::to_le_bytes)
                .collect();
            phase += 960;
            if output.write(&block, &token).is_err() {
                break;
            }
        }
        let _ = output.close(false, &token);
    });
    stop
}
