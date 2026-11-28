//! Speech through the core with a real speech.cpp server and a real output: the start delay,
//! speech one message after another, a stop, a mute and the end of the server (#279). It replaces
//! `tools/live_tts_acceptance.py`, which ran the Python bus; the VRChat window of that tool is not
//! here.
//!
//! Windows, to a device:
//!
//! cargo run --release --locked --manifest-path native/core/Cargo.toml --example live_speech --
//!     --app-dir <extracted package> --state-dir <empty folder> --model <Irodori-TTS GGUF>
//!     --output "Steam Streaming Speakers" [--device auto] [--samples 3]
//!
//! Linux, on the managed route of a private PipeWire graph:
//!
//! cargo run --release --locked --features pipewire --manifest-path native/core/Cargo.toml
//!     --example live_speech -- --app-dir <extracted package>/usr/lib/astarot
//!     --state-dir <empty folder> --model <Irodori-TTS GGUF> --route managed --private-pipewire
//!
//! The core runs in this process as the application runs it, with the bundled speech.cpp of
//! `--app-dir`. On the device route it speaks to the first output whose label contains
//! `--output`. On the managed route (Linux) it speaks into `astarot.managed.tts`, and the virtual
//! microphone `astarot.managed.source` is recorded with `pw-cat` to see when speech is heard there
//! and when it falls silent (`*_to_silence_ms`: the start of 2 s of silence, as the Python tool
//! measured it; its budget for the end of the server was 100 ms at p95 and 250 ms at most).
//! `--private-pipewire` starts its own PipeWire daemon with the managed route of
//! `config/pipewire/90-astarot-managed.conf` and WirePlumber's policy in a temporary folder, so that
//! the user's own graph is not touched; it needs `pipewire`, `wireplumber`, `pw-cat` and `pw-dump`.
//! Set `VRCT_TELEMETRY=off`. The chat box is not sent to VRChat. Prints one JSON line per case;
//! no text, audio, path or device name is printed.

use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use astarot_core::config::{Environment, Platform};
use astarot_core::{Backend, Options, Sink};

const BRIEF: &str = "了解です。";
const SHORT: &str = "こんにちは。音声の接続テストです。";
const LONG: &str = "これは音声を途中で止めるための接続試験です。マイクの出力と停止後の無音を確認しています。\
これは音声を途中で止めるための接続試験です。マイクの出力と停止後の無音を確認しています。\
これは音声を途中で止めるための接続試験です。マイクの出力と停止後の無音を確認しています。";

struct Run {
    backend: Backend,
}

impl Run {
    fn call(&self, endpoint: &str, data: Value) -> Value {
        let reply = self.backend.dispatcher().call(Some(endpoint), &data);
        json!({ "status": reply.status, "result": reply.result })
    }

    fn ok(&self, endpoint: &str, data: Value) -> Value {
        let answer = self.call(endpoint, data);
        assert_eq!(
            answer["status"], 200,
            "{endpoint} answered {} {}",
            answer["status"], answer["result"]["error_code"]
        );
        answer["result"].clone()
    }

    fn status(&self) -> Value {
        self.ok("/get/data/voice_status", Value::Null)
    }

    /// The managed route's gate as the OS reports it (`observed_muted`).
    fn route(&self) -> Value {
        self.ok("/get/data/voice_route", Value::Null)
    }

    /// Waits until the gate reports `muted`.
    fn gate(&self, muted: bool) {
        let started = Instant::now();
        while self.route()["observed_muted"] != muted {
            assert!(started.elapsed() < Duration::from_secs(5), "the gate did not report muted = {muted}: {}", self.route());
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    /// Waits until `done` holds, polling every 2 ms; the time it took.
    fn wait(&self, what: &str, limit: Duration, done: impl Fn(&Value) -> bool) -> Duration {
        let started = Instant::now();
        loop {
            if done(&self.status()) {
                return started.elapsed();
            }
            assert!(
                started.elapsed() < limit,
                "{what} did not happen within {limit:?}"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    /// Sends a typed message; how long the request took.
    fn send(&self, id: &str, message: &str) -> Duration {
        let started = Instant::now();
        self.ok(
            "/run/send_message_box",
            json!({ "id": id, "message": message }),
        );
        started.elapsed()
    }

    /// Waits until the bus is idle with `count` more messages spoken, failed or dropped (a
    /// message that waited longer than 5 s expires); the codes of the failures.
    fn finish(&self, what: &str, count: u64, limit: Duration) -> Vec<String> {
        let before = self.status();
        let done = |s: &Value| {
            ["completed", "errors", "dropped"]
                .iter()
                .map(|k| s[k].as_u64().unwrap_or(0) - before[k].as_u64().unwrap_or(0))
                .sum::<u64>()
        };
        self.wait(what, limit, |s| {
            done(s) >= count && s["active"] == false && s["queued"] == 0
        });
        let after = self.status();
        let failed = after["errors"].as_u64().unwrap_or(0) - before["errors"].as_u64().unwrap_or(0);
        (0..failed)
            .map(|_| after["last_error"].as_str().unwrap_or("unknown").to_owned())
            .collect()
    }
}

fn ms(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1000.0 * 10.0).round() / 10.0
}

/// The virtual microphone as it is heard: one entry per 10 ms read, with whether it held sound.
#[derive(Clone, Default)]
struct Capture {
    history: std::sync::Arc<std::sync::Mutex<Vec<(Instant, bool)>>>,
}

impl Capture {
    /// Records `target` (a node name) with `pw-cat` until this process ends.
    fn start(target: &str) -> (Capture, std::process::Child) {
        use std::io::Read;
        let mut child = std::process::Command::new("pw-cat")
            .args(["--record", "--raw", "--format", "s16", "--rate", "48000", "--channels", "1", "--latency", "10ms"])
            .args(["--target", target, "--properties", "{ node.dont-fallback=true node.dont-reconnect=true }", "-"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("pw-cat starts");
        let mut stdout = child.stdout.take().unwrap();
        let capture = Capture::default();
        let history = capture.history.clone();
        std::thread::spawn(move || {
            let mut block = [0u8; 960];
            while stdout.read_exact(&mut block).is_ok() {
                let loud = block.as_chunks::<2>().0.iter().any(|b| i16::from_le_bytes(*b) != 0);
                history.lock().unwrap().push((Instant::now(), loud));
            }
        });
        (capture, child)
    }

    /// The first read with sound since `since`.
    fn heard_since(&self, since: Instant) -> Option<Instant> {
        self.history.lock().unwrap().iter().find(|(t, loud)| *t >= since && *loud).map(|(t, _)| *t)
    }

    /// Whether a read in the last `window` held sound.
    fn loud_within(&self, window: Duration) -> bool {
        let now = Instant::now();
        self.history.lock().unwrap().iter().rev().take_while(|(t, _)| now.duration_since(*t) <= window).any(|(_, loud)| *loud)
    }

    /// The start of the silence that has lasted 2 s up to the last read and began after `since`
    /// (`ToneObservation.settled` of the Python tool): reads come without a gap over 100 ms.
    fn silent_since(&self, since: Instant) -> Option<Instant> {
        let history = self.history.lock().unwrap();
        let &(end, _) = history.last()?;
        if end.elapsed() > Duration::from_millis(200) {
            return None;
        }
        let (mut start, mut previous) = (None, end);
        for &(t, loud) in history.iter().rev() {
            if t < since || previous.duration_since(t) > Duration::from_millis(100) || loud {
                break;
            }
            start = Some(t);
            previous = t;
        }
        start.filter(|s| end.duration_since(*s) >= Duration::from_secs(2))
    }

    /// Waits for [`Capture::silent_since`]; the time from `since` to the silence.
    fn silence_after(&self, since: Instant) -> Duration {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            if let Some(start) = self.silent_since(since) {
                return start.duration_since(since);
            }
            assert!(Instant::now() < deadline, "the virtual microphone did not fall silent");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn loud_reads(&self) -> usize {
        self.history.lock().unwrap().iter().filter(|(_, loud)| *loud).count()
    }
}

/// A PipeWire daemon of its own with the managed route, and WirePlumber's policy on it, in a
/// temporary folder (`private_graph` of `tools/voice_acceptance.py`). Both end with it.
#[cfg(target_os = "linux")]
struct PrivateGraph {
    dir: PathBuf,
    children: Vec<std::process::Child>,
}

#[cfg(target_os = "linux")]
impl PrivateGraph {
    const DAEMON: &str = r#"
context.properties = {
    core.daemon = true
    core.name = vrct-live-speech
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

    /// Starts the graph and points this process (and the helpers the core starts) at it. Call
    /// it before any other thread starts: it sets environment variables.
    fn start() -> PrivateGraph {
        let managed = include_str!("../../../config/pipewire/90-astarot-managed.conf").trim();
        let managed = managed.strip_prefix("context.modules = [").and_then(|m| m.strip_suffix(']')).expect("a modules fragment");
        let dir = std::env::temp_dir().join(format!("vrct-live-speech-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("the graph folder can be made");
        let config = dir.join("daemon.conf");
        std::fs::write(&config, Self::DAEMON.replace("MANAGED", managed)).expect("the graph's settings can be written");
        // SAFETY: called first thing in `main`, before any other thread exists.
        unsafe {
            std::env::set_var("PIPEWIRE_RUNTIME_DIR", &dir);
            std::env::set_var("PIPEWIRE_REMOTE", "vrct-live-speech");
        }
        let private = [("XDG_STATE_HOME", dir.join("state")), ("XDG_CONFIG_HOME", dir.join("config"))];
        let mut graph = PrivateGraph { dir: dir.clone(), children: Vec::new() };
        let daemon = std::process::Command::new("pipewire")
            .arg("-c")
            .arg(&config)
            .envs(private.clone())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("pipewire starts");
        graph.children.push(daemon);
        graph.wait("the private PipeWire", || dir.join("vrct-live-speech").exists());
        // WirePlumber's own policy files, not the user's.
        let binary = which("wireplumber").canonicalize().expect("wireplumber");
        let prefix = binary.parent().and_then(|p| p.parent()).expect("an installation prefix").to_path_buf();
        let data = prefix.join("share/wireplumber");
        let modules = std::iter::once(prefix.join("lib/wireplumber-0.5"))
            .chain(std::fs::read_dir(prefix.join("lib")).into_iter().flatten().flatten().map(|e| e.path().join("wireplumber-0.5")))
            .find(|p| p.is_dir())
            .expect("WirePlumber's modules");
        let policy = std::process::Command::new(binary)
            .args(["--profile", "policy"])
            .envs(private)
            .env("WIREPLUMBER_CONFIG_DIR", &data)
            .env("WIREPLUMBER_DATA_DIR", &data)
            .env("WIREPLUMBER_MODULE_DIR", modules)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("wireplumber starts");
        let pid = policy.id();
        graph.children.push(policy);
        // The policy links the managed TTS and VC outputs to the mix once it runs.
        graph.wait("WirePlumber's links on the private graph", || {
            let Ok(dump) = std::process::Command::new("pw-dump").output() else { return false };
            let objects: Vec<Value> = serde_json::from_slice(&dump.stdout).unwrap_or_default();
            let client = objects.iter().any(|o| o["info"]["props"]["application.process.id"].to_string().trim_matches('"') == pid.to_string());
            let links = objects.iter().filter(|o| o["type"] == "PipeWire:Interface:Link").count();
            client && links >= 2
        });
        graph
    }

    fn wait(&mut self, what: &str, done: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !done() {
            assert!(Instant::now() < deadline, "{what} did not come up");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

#[cfg(target_os = "linux")]
impl Drop for PrivateGraph {
    fn drop(&mut self) {
        for child in self.children.iter_mut().rev() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[cfg(target_os = "linux")]
fn which(name: &str) -> PathBuf {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .map(|dir| dir.join(name))
        .find(|p| p.is_file())
        .unwrap_or_else(|| panic!("{name} is not on PATH"))
}

/// Ends the process `pid` at once, as a crash would.
fn kill(pid: u32) -> bool {
    let command = if cfg!(windows) {
        std::process::Command::new("taskkill").args(["/PID", &pid.to_string(), "/F"]).output()
    } else {
        std::process::Command::new("kill").args(["-KILL", &pid.to_string()]).output()
    };
    command.is_ok_and(|o| o.status.success())
}

/// Whether the process `pid` still runs (a Linux zombie no longer does).
fn running(pid: u32) -> bool {
    if cfg!(windows) {
        let filter = format!("PID eq {pid}");
        std::process::Command::new("tasklist")
            .args(["/FI", &filter, "/NH", "/FO", "CSV"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&format!("\"{pid}\"")))
            .unwrap_or(true)
    } else {
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .is_ok_and(|stat| stat.rsplit(')').next().is_some_and(|rest| !rest.trim_start().starts_with('Z')))
    }
}

fn main() {
    let (mut app_dir, mut state_dir, mut model, mut output) = (None, None, None, None);
    let mut device = "auto".to_owned();
    let mut route = if cfg!(windows) { "device" } else { "managed" }.to_owned();
    let mut private = false;
    let mut samples = 3usize;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| panic!("{arg} needs a value"));
        match arg.as_str() {
            "--app-dir" => app_dir = Some(PathBuf::from(value())),
            "--state-dir" => state_dir = Some(PathBuf::from(value())),
            "--model" => model = Some(PathBuf::from(value())),
            "--output" => output = Some(value()),
            "--device" => device = value(),
            "--route" => route = value(),
            "--private-pipewire" => private = true,
            "--samples" => samples = value().parse().expect("--samples takes a number"),
            other => panic!("unknown argument {other}"),
        }
    }
    assert!(route == "device" || (route == "managed" && cfg!(target_os = "linux")), "--route is device, or managed on Linux");
    let managed = route == "managed";
    assert!(managed || output.is_some(), "--output is required on the device route");
    assert!(!private || managed, "--private-pipewire goes with --route managed");
    // First, before any thread: it points this process at the private graph.
    #[cfg(target_os = "linux")]
    let _graph = private.then(PrivateGraph::start);
    let app_dir = app_dir.expect("--app-dir is required");
    let state_dir = state_dir.expect("--state-dir is required");
    let model = model
        .expect("--model is required")
        .canonicalize()
        .expect("the model exists");
    assert!((1..=30).contains(&samples), "1..30 samples");
    std::fs::create_dir_all(&state_dir).expect("the state folder can be made");

    // The chat box stays here: no OSC to VRChat and no OSCQuery on the network.
    let row = |model: &str| json!({ "model": model, "vad_model": "", "diarization_model": "", "voice_file": "", "device": device, "low_latency": false });
    let config = json!({
        "SEND_MESSAGE_TO_VRC": false,
        "OSC_IP_ADDRESS": "127.0.0.2",
        "SPEECH_SERVER_SETTINGS": { "version": 1, "profiles": { "japanese": row(model.to_str().unwrap()), "multilingual": row(""), "asr": row("") } },
    });
    std::fs::write(
        state_dir.join("config.json"),
        serde_json::to_vec_pretty(&config).unwrap(),
    )
    .expect("the settings can be written");

    let environment = Environment {
        version: "0.0.0".into(),
        state_dir: state_dir.clone(),
        app_dir,
        data_dir: state_dir.clone(),
        platform: Platform::current(),
        compute_devices: vec![Environment::cpu_device()],
        devices: None,
        websocket_token: None,
    };
    let (done, ready) = mpsc::channel();
    let sink = Sink {
        line: std::sync::Arc::new(move |line: String| {
            if line.contains("\"/run/initialization_complete\"") {
                let _ = done.send(());
            }
        }),
        exit: std::sync::Arc::new(|_| {}),
    };
    let run = Run {
        backend: Backend::start(Options::new(environment), sink),
    };
    // The UI feeds the watchdog from the start; without it the core stops itself.
    let core = run.backend.core().clone();
    std::thread::spawn(move || {
        loop {
            core.feed_watchdog();
            std::thread::sleep(Duration::from_secs(2));
        }
    });
    ready
        .recv_timeout(Duration::from_secs(180))
        .expect("start-up ends within 180 s");

    let settings = if managed {
        json!({ "mode": "original", "routing": "managed", "japanese_server": "bundled" })
    } else {
        let output = output.unwrap();
        let devices = run.ok("/get/data/voice_output_devices", Value::Null);
        let chosen = devices["devices"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|d| d["label"].as_str().is_some_and(|l| l.contains(&output)))
            .expect("an output with that label")
            .clone();
        json!({ "mode": "original", "output_device": chosen["id"], "japanese_server": "bundled" })
    };
    let saved = run.call("/set/data/voice_settings", settings);
    assert_eq!(
        saved["status"], 200,
        "the voice settings were refused: {}",
        saved["result"]["error_code"]
    );
    // The managed route opens its gate (the virtual microphone starts muted).
    let capture = managed.then(|| {
        // The route prepares itself (the gate helper finds the managed nodes) after the save.
        let started = Instant::now();
        while run.route()["ready"] != true {
            let route = run.route();
            assert!(started.elapsed() < Duration::from_secs(10), "the managed route is not ready: {}", route["error"]);
            std::thread::sleep(Duration::from_millis(10));
        }
        let before = run.route();
        run.ok("/run/resume_voice", Value::Null);
        run.gate(false);
        let route = run.route();
        println!("{}", json!({ "case": "route", "managed": route["managed"], "muted_at_start": before["observed_muted"], "ready": route["ready"] }));
        Capture::start(astarot_audio_routing::graph::MANAGED_SOURCE)
    });
    let capture = capture.map(|(capture, child)| {
        std::mem::forget(child);
        capture
    });
    if let Some(capture) = &capture {
        std::thread::sleep(Duration::from_millis(500));
        let silent = capture.silence_after(Instant::now() - Duration::from_millis(400));
        println!("{}", json!({ "case": "capture", "reads": capture.history.lock().unwrap().len(), "silent_before_speech_ms": ms(silent) }));
    }

    // The process of the server the core starts, to end it while it speaks; never another one.
    let listener: std::sync::Arc<std::sync::Mutex<Option<u32>>> = Default::default();
    let heard = listener.clone();
    run.backend
        .core()
        .speech_servers()
        .on_listener(std::sync::Arc::new(move |_, listening| {
            *heard.lock().unwrap() = listening.map(|(_, pid)| pid)
        }));

    // ON starts the bundled server and waits until it is ready.
    let started = Instant::now();
    let generation = run.status()["tts_generation"].clone();
    let on = run.call("/run/enable_tts", json!({ "generation": generation }));
    assert_eq!(
        on["status"], 200,
        "TTS did not turn on: {}",
        on["result"]["error_code"]
    );
    println!(
        "{}",
        json!({ "case": "enable", "server_ready_ms": ms(started.elapsed()) })
    );

    // The start delay: from the message to its first audible write (the bus's own measure),
    // from the request to the core until then, and until the virtual microphone carries it.
    for index in 1..=samples {
        // The microphone is silent first (2 s), so that the end of the last message is not
        // taken for this one.
        if let Some(capture) = &capture {
            capture.silence_after(Instant::now());
        }
        let previous = run.status()["last_first_write_ms"].clone();
        let sent = Instant::now();
        let request = run.send(&format!("p-{index}"), SHORT);
        // The bus keeps the last value until the next first write.
        run.wait("the first audio", Duration::from_secs(20), |s| {
            s["last_first_write_ms"].is_number() && s["last_first_write_ms"] != previous
        });
        let first = sent.elapsed();
        let bus = run.status()["last_first_write_ms"].as_f64();
        let failures = run.finish("the speech", 1, Duration::from_secs(30));
        let heard = capture.as_ref().and_then(|c| c.heard_since(sent)).map(|t| ms(t.duration_since(sent)));
        let case = json!({ "case": "start", "sample": index, "first_write_ms": bus, "request_ms": ms(request), "send_to_first_write_seen_ms": ms(first), "send_to_microphone_ms": heard, "whole_ms": ms(sent.elapsed()), "failures": failures });
        println!("{case}");
    }

    // One after another: three messages sent at once. A message that waits longer than 5 s
    // in the queue expires (as in Python), so short ones all speak and longer ones may not.
    for (name, text) in [("order_brief", BRIEF), ("order_short", SHORT)] {
        let before = run.status();
        let sent = Instant::now();
        for index in 1..=3 {
            run.send(&format!("{name}-{index}"), text);
        }
        let failures = run.finish("three messages", 3, Duration::from_secs(60));
        let after = run.status();
        let delta =
            |key: &str| after[key].as_u64().unwrap_or(0) - before[key].as_u64().unwrap_or(0);
        let order = json!({ "case": name, "messages": 3, "completed": delta("completed"), "dropped": delta("dropped"), "expired": delta("expired"), "errors": delta("errors"), "cancelled": delta("cancelled"), "whole_ms": ms(sent.elapsed()), "failures": failures });
        println!("{order}");
    }

    // A long message that is being heard: on the managed route, until the microphone carries it.
    let speak_long = |id: &str, also: Option<&str>| {
        let previous = run.status()["last_first_write_ms"].clone();
        let sent = Instant::now();
        run.send(id, LONG);
        if let Some(also) = also {
            run.send(also, SHORT);
        }
        run.wait("the long speech", Duration::from_secs(20), |s| {
            s["active"] == true && s["last_first_write_ms"] != previous && (also.is_none() || s["queued"] == 1)
        });
        std::thread::sleep(Duration::from_millis(800));
        if let Some(capture) = &capture {
            assert!(capture.heard_since(sent).is_some() && capture.loud_within(Duration::from_millis(100)), "the long speech is not heard");
        }
    };

    // A stop while speaking: from the request until nothing plays, with one more waiting.
    let before = run.status();
    speak_long("c-1", Some("c-2"));
    let stopping = Instant::now();
    run.ok("/run/stop_voice", Value::Null);
    let answered = stopping.elapsed();
    let idle = run.wait("the stop", Duration::from_secs(5), |s| s["active"] == false);
    let silence = capture.as_ref().map(|c| ms(c.silence_after(stopping)));
    let after = run.status();
    let delta = |key: &str| after[key].as_u64().unwrap_or(0) - before[key].as_u64().unwrap_or(0);
    // A stop is not a mute: the gate stays open.
    let stop = json!({ "case": "stop", "answer_ms": ms(answered), "stop_to_idle_ms": ms(idle), "stop_to_silence_ms": silence, "cancelled": delta("cancelled"), "dropped": delta("dropped"), "completed": delta("completed"), "queued": after["queued"], "tts_enabled": after["tts_enabled"], "gate_muted_after": run.route()["observed_muted"] });
    println!("{stop}");

    // The next message after the stop still speaks.
    let sent = Instant::now();
    run.send("a-1", SHORT);
    let failures = run.finish("speech after the stop", 1, Duration::from_secs(30));
    let heard = capture.as_ref().map(|c| c.heard_since(sent).is_some());
    println!("{}", json!({ "case": "after_stop", "failures": failures, "heard_on_microphone": heard }));

    // A mute while speaking (the managed route's gate): the speech ends, the microphone falls
    // silent and stays so for a message sent while muted; a resume speaks again.
    if let Some(capture) = &capture {
        let before = run.status();
        speak_long("m-1", None);
        let muting = Instant::now();
        let route = run.ok("/run/mute_voice", Value::Null);
        let answered = muting.elapsed();
        let silence = capture.silence_after(muting);
        let idle = run.wait("the muted bus", Duration::from_secs(5), |s| s["active"] == false && s["muted"] == true);
        run.gate(true);
        let held = capture.loud_reads();
        let accepted = run.status()["accepted"].clone();
        run.send("m-2", SHORT);
        std::thread::sleep(Duration::from_secs(3));
        let after = run.status();
        let delta = |key: &str| after[key].as_u64().unwrap_or(0) - before[key].as_u64().unwrap_or(0);
        println!(
            "{}",
            json!({ "case": "mute", "answer_ms": ms(answered), "mute_to_idle_ms": ms(idle), "mute_to_silence_ms": ms(silence), "requested_muted": route["requested_muted"], "gate_muted": run.route()["observed_muted"], "cancelled": delta("cancelled"), "spoken_while_muted": after["accepted"] != accepted, "heard_while_muted": capture.loud_reads() != held })
        );
        run.ok("/run/resume_voice", Value::Null);
        run.gate(false);
        run.wait("the unmuted bus", Duration::from_secs(5), |s| s["muted"] == false);
        let sent = Instant::now();
        run.send("m-3", SHORT);
        let failures = run.finish("speech after the resume", 1, Duration::from_secs(30));
        println!("{}", json!({ "case": "after_resume", "failures": failures, "heard_on_microphone": capture.heard_since(sent).is_some() }));
    }

    // The server ends while it speaks: the speech ends with it, without waiting for a timeout.
    let before = run.status();
    speak_long("x-1", None);
    let pid = listener.lock().unwrap().expect("the core's server listens");
    let ending = Instant::now();
    // When the core hears the run's end, and when the process is gone.
    let heard = {
        let listener = listener.clone();
        std::thread::spawn(move || {
            while listener.lock().unwrap().is_some() && ending.elapsed() < Duration::from_secs(15) {
                std::thread::sleep(Duration::from_millis(1));
            }
            ending.elapsed()
        })
    };
    let gone = std::thread::spawn(move || {
        while ending.elapsed() < Duration::from_secs(15) && running(pid) {
            std::thread::sleep(Duration::from_millis(1));
        }
        ending.elapsed()
    });
    let killed = kill(pid);
    let kill_returned = ending.elapsed();
    run.wait(
        "the end of the speech with the server",
        Duration::from_secs(15),
        |s| s["active"] == false,
    );
    let idle = ending.elapsed();
    let at_idle = run.status();
    let silence = capture.as_ref().map(|c| ms(c.silence_after(ending)));
    let (heard, gone) = (heard.join().unwrap(), gone.join().unwrap());
    std::thread::sleep(Duration::from_millis(500));
    let after = run.status();
    let delta = |key: &str| after[key].as_u64().unwrap_or(0) - before[key].as_u64().unwrap_or(0);
    println!(
        "{}",
        json!({ "case": "server_end", "killed": killed, "kill_returned_ms": ms(kill_returned), "process_gone_ms": ms(gone), "end_heard_ms": ms(heard), "kill_to_idle_ms": ms(idle), "kill_to_silence_ms": silence, "errors": delta("errors"), "cancelled": delta("cancelled"), "error_at_idle": at_idle["last_error"], "tts_enabled_after_500ms": after["tts_enabled"] })
    );

    run.ok("/run/disable_tts", Value::Null);
    let stopped = run.backend.kill_and_wait(Duration::from_secs(10));
    println!("{}", json!({ "case": "end", "stopped_cleanly": stopped }));
}
