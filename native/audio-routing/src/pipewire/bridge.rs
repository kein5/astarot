//! Explicit Linux source forwarding. Route health is not proof of voice conversion.
//!
//! Port of `src-python/models/audio_routing/source_bridge.py`. PCM stays inside the
//! `astarot-source-bridge` helper (a `pw-loopback` with ownership checks). The thread
//! that starts it owns its lifetime: the helper watches that thread through a pidfd
//! and ends with it. The playback stream starts muted and is unmuted only after both
//! streams are proven to be the helper's and linked exactly source → bridge → VC
//! input. Any later loss ends the route; it never resumes by itself.

use std::any::Any;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::error::{Error, Kind, Result};
use crate::graph::{bridge_links, parse_source, select_source, vc_sink, Endpoint, Graph, SourceId};
use crate::process::{run, ProcessEnv};
use crate::sync::{lock, monotonic, monotonic_ns, Event, Worker};

pub const START_TIMEOUT: f64 = 3.0;
pub const MONITOR_INTERVAL: Duration = Duration::from_millis(100);

/// A started helper.
pub trait BridgeChild: Send {
    /// The audio process, as the server authenticates its streams.
    fn pid(&self) -> u32;
    /// `Some(status)` once it ended.
    fn poll(&mut self) -> Option<i32>;
    fn terminate(&mut self);
    /// Terminate, then kill if it has not ended within half a second.
    fn reap(&mut self);
}

/// What the bridge needs from the system.
pub trait BridgeSystem: Send + Sync {
    fn read_graph(&self, after: Option<f64>) -> Result<Arc<Graph>>;
    /// Wake `wake` on every graph observation until the returned value is dropped.
    fn subscribe(&self, wake: Arc<Event>) -> Result<Box<dyn Any + Send>>;
    fn launch(&self, source: &Endpoint, sink: &Endpoint, tag: &str) -> Result<Box<dyn BridgeChild>>;
    fn unmute(&self, endpoint: &Endpoint, tag: &str) -> Result<()>;
    fn linux(&self) -> bool {
        true
    }
    fn start_timeout(&self) -> f64 {
        START_TIMEOUT
    }
    fn monitor_interval(&self) -> Duration {
        MONITOR_INTERVAL
    }
}

/// The bridge's state as `health()` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceHealth {
    pub requested: bool,
    pub active: bool,
    pub pending: bool,
    pub error: Option<String>,
    pub generation: u64,
    pub conversion_verified: bool,
    pub source: Option<SourceId>,
    pub stopping: bool,
    pub observation_id: String,
}

type SharedChild = Arc<Mutex<Option<Box<dyn BridgeChild>>>>;

struct Run {
    generation: u64,
    source: Endpoint,
    tag: String,
    stop: Arc<Event>,
    wake: Arc<Event>,
    child: SharedChild,
    worker: Option<Worker>,
}

struct State {
    source: Option<Endpoint>,
    run: Option<Run>,
    observation: u64,
    requested: bool,
    active: bool,
    pending: bool,
    error: Option<String>,
    generation: u64,
}

pub struct SourceBridge {
    system: Arc<dyn BridgeSystem>,
    state: Arc<Mutex<State>>,
}

fn new_tag() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    (0..2)
        .map(|salt| {
            let mut hasher = RandomState::new().build_hasher();
            hasher.write_u64(salt);
            hasher.write_u64(monotonic_ns());
            format!("{:016x}", hasher.finish())
        })
        .collect()
}

fn signal(child: &SharedChild) {
    if let Some(child) = lock(child).as_mut() {
        if child.poll().is_none() {
            child.terminate();
        }
    }
}

impl SourceBridge {
    pub fn new(system: Arc<dyn BridgeSystem>) -> Self {
        Self { system, state: Arc::new(Mutex::new(State { source: None, run: None, observation: 0, requested: false, active: false, pending: false, error: None, generation: 0 })) }
    }

    pub fn health(&self) -> SourceHealth {
        let mut state = lock(&self.state);
        state.observation = monotonic_ns().max(state.observation + 1);
        let alive = state.run.as_ref().and_then(|run| run.worker.as_ref()).is_some_and(Worker::is_alive);
        SourceHealth {
            requested: state.requested,
            active: state.active,
            pending: state.pending,
            error: state.error.clone(),
            generation: state.generation,
            conversion_verified: false,
            source: state.source.as_ref().map(SourceId::from),
            stopping: alive && !state.requested,
            observation_id: state.observation.to_string(),
        }
    }

    fn stop_locked(state: &mut State) -> Option<SharedChild> {
        state.requested = false;
        state.active = false;
        state.pending = false;
        state.generation += 1;
        let run = state.run.as_ref()?;
        run.stop.set();
        run.wake.set();
        Some(run.child.clone())
    }

    /// Choose the input; stops a running route.
    pub fn configure(&self, source: Endpoint) -> Result<()> {
        if source.media_class != "Audio/Source" {
            return Err(Error::value("source_bridge_source_required"));
        }
        let child = {
            let mut state = lock(&self.state);
            let child = Self::stop_locked(&mut state);
            state.source = Some(source);
            state.error = None;
            child
        };
        if let Some(child) = child {
            signal(&child);
        }
        Ok(())
    }

    pub fn start(&self, source: Option<Endpoint>, expected_generation: Option<u64>) -> Result<()> {
        if !self.system.linux() {
            return Err(Error::runtime("source_bridge_linux_only"));
        }
        if let Some(source) = &source {
            parse_source(&SourceId::from(source).to_json())?;
        }
        let mut state = lock(&self.state);
        if expected_generation.is_some_and(|generation| generation != state.generation) {
            return Err(Error::runtime("source_bridge_stale_start"));
        }
        if state.requested {
            if source.is_some() && source != state.source {
                return Err(Error::runtime("source_bridge_already_running"));
            }
            return Ok(());
        }
        if state.run.as_ref().and_then(|run| run.worker.as_ref()).is_some_and(Worker::is_alive) {
            return Err(Error::runtime("source_bridge_stopping"));
        }
        if let Some(source) = source {
            state.source = Some(source);
        }
        let Some(selected) = state.source.clone() else {
            return Err(Error::runtime("source_bridge_source_required"));
        };
        state.requested = true;
        state.active = false;
        state.pending = true;
        state.error = None;
        state.generation += 1;
        let run = Run { generation: state.generation, source: selected, tag: new_tag(), stop: Arc::new(Event::new()), wake: Arc::new(Event::new()), child: Arc::new(Mutex::new(None)), worker: None };
        let context = Context {
            system: self.system.clone(),
            state: self.state.clone(),
            generation: run.generation,
            source: run.source.clone(),
            tag: run.tag.clone(),
            stop: run.stop.clone(),
            wake: run.wake.clone(),
            child: run.child.clone(),
        };
        let worker = Worker::spawn("VRCT source bridge", move || context.work()).map_err(|_| Error::runtime("source_bridge_control_failed"))?;
        state.run = Some(Run { worker: Some(worker), ..run });
        Ok(())
    }

    pub fn stop(&self) {
        let child = Self::stop_locked(&mut lock(&self.state));
        if let Some(child) = child {
            signal(&child);
        }
    }

    /// Stop and report whether the bridge thread ended within `timeout`.
    pub fn close(&self, timeout: Duration) -> bool {
        self.stop();
        let worker = lock(&self.state).run.as_ref().and_then(|run| run.worker.clone());
        worker.is_none_or(|worker| worker.join(timeout))
    }
}

struct Context {
    system: Arc<dyn BridgeSystem>,
    state: Arc<Mutex<State>>,
    generation: u64,
    source: Endpoint,
    tag: String,
    stop: Arc<Event>,
    wake: Arc<Event>,
    child: SharedChild,
}

impl Context {
    fn update(&self, change: impl FnOnce(&mut State)) {
        let mut state = lock(&self.state);
        if state.generation == self.generation && !self.stop.is_set() {
            change(&mut state);
        }
    }

    fn child_ended(&self) -> bool {
        lock(&self.child).as_mut().is_some_and(|child| child.poll().is_some())
    }

    fn work(&self) {
        let mut observer = None;
        let result = self.run(&mut observer);
        if let Err(error) = result {
            // No subprocess output or paths reach the UI.
            let code = if error.kind == Kind::Runtime && error.code.starts_with("source_bridge_") { error.code } else { "source_bridge_control_failed".to_owned() };
            self.update(|state| {
                state.requested = false;
                state.active = false;
                state.pending = false;
                state.error = Some(code);
            });
        }
        if let Some(child) = lock(&self.child).as_mut() {
            child.reap();
        }
        self.update(|state| {
            state.requested = false;
            state.active = false;
            state.pending = false;
        });
        drop(observer);
    }

    fn run(&self, observer: &mut Option<Box<dyn Any + Send>>) -> Result<()> {
        *observer = Some(self.system.subscribe(self.wake.clone()).map_err(|_| Error::runtime("source_bridge_graph_unavailable"))?);
        let graph = self.system.read_graph(None)?;
        if select_source(&graph, &self.source.name)? != self.source {
            return Err(Error::runtime("source_bridge_source_changed"));
        }
        let sink = vc_sink(&graph)?;
        if self.stop.is_set() {
            return Ok(());
        }
        let child = self.system.launch(&self.source, &sink, &self.tag)?;
        let pid = child.pid();
        *lock(&self.child) = Some(child);
        if self.stop.is_set() {
            return Ok(());
        }
        let deadline = monotonic() + self.system.start_timeout();
        let output = loop {
            if self.stop.is_set() {
                return Ok(());
            }
            if self.child_ended() {
                return Err(Error::runtime("source_bridge_process_exited"));
            }
            let graph = self.system.read_graph(None)?;
            // A replaced endpoint never becomes acceptable by waiting longer.
            if select_source(&graph, &self.source.name)? != self.source || vc_sink(&graph)? != sink {
                return Err(Error::runtime("source_bridge_endpoint_changed"));
            }
            match bridge_links(&graph, &self.source, &sink, &self.tag, pid, true) {
                Ok(output) => break output,
                Err(error) if monotonic() >= deadline => return Err(error),
                Err(_) => {
                    self.wake.wait(self.system.monitor_interval());
                    self.wake.clear();
                }
            }
        };
        if self.stop.is_set() {
            return Ok(());
        }
        self.system.unmute(&output, &self.tag)?;
        let mut after = Some(monotonic());
        while !self.stop.is_set() {
            if self.child_ended() {
                return Err(Error::runtime("source_bridge_process_exited"));
            }
            bridge_links(&self.system.read_graph(after.take())?, &self.source, &sink, &self.tag, pid, false)?;
            self.update(|state| {
                state.active = true;
                state.pending = false;
            });
            self.wake.wait(self.system.monitor_interval());
            self.wake.clear();
        }
        Ok(())
    }
}

/// The helpers built next to the application, and the shared graph observation.
pub struct PipeWireBridgeSystem {
    pub build: PathBuf,
    pub env: ProcessEnv,
}

struct HelperChild {
    supervisor: Child,
    audio_pid: u32,
}

impl BridgeChild for HelperChild {
    fn pid(&self) -> u32 {
        self.audio_pid
    }
    fn poll(&mut self) -> Option<i32> {
        self.supervisor.try_wait().ok().flatten().map(|status| status.code().unwrap_or(-1))
    }
    fn terminate(&mut self) {
        unsafe { libc::kill(self.supervisor.id() as libc::pid_t, libc::SIGTERM) };
    }
    fn reap(&mut self) {
        if self.poll().is_none() {
            self.terminate();
        }
        let deadline = monotonic() + 0.5;
        while self.poll().is_none() && monotonic() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        if self.poll().is_none() {
            let _ = self.supervisor.kill();
        }
        let _ = self.supervisor.wait();
    }
}

/// The audio process ID the supervisor reports on its first line.
fn audio_pid(child: &mut Child) -> Result<u32> {
    let failed = || Error::runtime("source_bridge_launch_failed");
    let mut stdout = child.stdout.take().ok_or_else(failed)?;
    let (sent, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut reply = [0u8; 64];
        let mut length = 0;
        while length < reply.len() {
            match stdout.read(&mut reply[length..]) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    length += n;
                    if reply[..length].ends_with(b"\n") {
                        break;
                    }
                }
            }
        }
        let _ = sent.send(reply[..length].to_vec());
    });
    let reply = received.recv_timeout(Duration::from_secs(2)).map_err(|_| Error::runtime("source_bridge_launch_timeout"))?;
    let digits = reply.strip_suffix(b"\n").filter(|d| !d.is_empty() && d.iter().all(u8::is_ascii_digit)).ok_or_else(failed)?;
    let pid: u32 = std::str::from_utf8(digits).ok().and_then(|d| d.parse().ok()).ok_or_else(failed)?;
    if pid <= 1 || pid == child.id() {
        return Err(failed());
    }
    Ok(pid)
}

/// The helper's arguments; `owner_fd` is the pidfd of the launching thread.
pub fn launch_arguments(binary: &str, owner_fd: i32, source: &Endpoint, sink: &Endpoint, tag: &str) -> Vec<String> {
    let common = "vrct.source.bridge=v1 node.dont-fallback=true node.dont-reconnect=true node.dont-move=true node.linger=false state.restore-props=false";
    vec![
        binary.to_owned(),
        std::process::id().to_string(),
        owner_fd.to_string(),
        "--channels".into(),
        "1".into(),
        "--channel-map".into(),
        "MONO".into(),
        "--latency".into(),
        "10ms".into(),
        "--capture-props".into(),
        format!("{common} node.name=vrct.source-bridge.{tag}.capture media.class=Stream/Input/Audio target.object={}", source.serial),
        "--playback-props".into(),
        format!("{common} node.name=vrct.source-bridge.{tag}.playback media.class=Stream/Output/Audio target.object={} node.param.Props={{mute=true}}", sink.serial),
    ]
}

impl BridgeSystem for PipeWireBridgeSystem {
    fn read_graph(&self, after: Option<f64>) -> Result<Arc<Graph>> {
        crate::pipewire::read_graph_data(true, after).map_err(|_| Error::runtime("source_bridge_graph_unavailable"))
    }

    fn subscribe(&self, wake: Arc<Event>) -> Result<Box<dyn Any + Send>> {
        Ok(Box::new(crate::pipewire::graph_source().subscribe(Some(wake)).map_err(|_| Error::runtime("source_bridge_graph_unavailable"))?))
    }

    fn launch(&self, source: &Endpoint, sink: &Endpoint, tag: &str) -> Result<Box<dyn BridgeChild>> {
        // Linux >= 6.9: a pidfd of this (non-leader) thread, exclusive so the TID
        // cannot be reused while the helper watches it.
        const PIDFD_THREAD: libc::c_int = libc::O_EXCL;
        let owner = unsafe { libc::syscall(libc::SYS_pidfd_open, libc::gettid(), PIDFD_THREAD) };
        if owner < 0 {
            return Err(Error::runtime("source_bridge_thread_watch_unavailable"));
        }
        let owner = owner as libc::c_int;
        let binary = self.build.join("astarot-source-bridge");
        let args = launch_arguments(&binary.to_string_lossy(), owner, source, sink, tag);
        let mut command = self.env.command(&binary);
        command.args(&args[1..]).stdout(Stdio::piped());
        unsafe {
            use std::os::unix::process::CommandExt;
            // Pass exactly this descriptor to the helper.
            command.pre_exec(move || {
                if libc::fcntl(owner, libc::F_SETFD, 0) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let spawned = command.spawn();
        unsafe { libc::close(owner) };
        let mut supervisor = spawned.map_err(|_| Error::runtime("source_bridge_launch_failed"))?;
        match audio_pid(&mut supervisor) {
            Ok(audio_pid) => Ok(Box::new(HelperChild { supervisor, audio_pid })),
            Err(error) => {
                let mut child = HelperChild { supervisor, audio_pid: 0 };
                child.reap();
                Err(error)
            }
        }
    }

    fn unmute(&self, endpoint: &Endpoint, tag: &str) -> Result<()> {
        let mut command = self.env.command(self.build.join("astarot-voice-gate"));
        command.args([endpoint.cookie.to_string(), endpoint.serial.to_string(), "0".into(), tag.to_owned()]);
        run(command, Duration::from_millis(2500)).map(|_| ()).map_err(|_| Error::runtime("source_bridge_gate_failed"))
    }
}

#[cfg(test)]
mod tests;
