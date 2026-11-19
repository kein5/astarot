//! One owned llama.cpp server (`llama-server`) that runs a translation LLM such as
//! TranslateGemma (ADR-015, stage 3 of docs/voice-stack/translation-llm-runtime-plan.md).
//!
//! It is owned the way a speech.cpp server is ([`crate::server`]): a separate process on the
//! numeric loopback address, port 0 (the port is read from the line the server prints when it
//! listens), checked with `/health`, stopped with the app, and watched until it ends. The
//! executable is not bundled: the app fetches it after the user's consent
//! (`vrct_voice_conversion::runtime::llamacpp_runtime`).
//!
//! The device is named the way the speech.cpp servers name theirs: `cpu`, `auto`, `gpu` or a
//! Vulkan device (`Vulkan1`). `auto` and `gpu` take the GPU speech.cpp would take
//! ([`crate::devices::preferred_gpu`]), found in llama.cpp's own list by its name and
//! description, so that both servers use the same GPU even where the two number them apart.
//!
//! Each start has its own API key (`LLAMA_API_KEY`, never on the command line): the server
//! answers others on the PC only at `/health`. Nothing here logs or returns what the server
//! prints, the model's path, the key or any text; a failure is one of the fixed [`codes`].

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{JoinHandle, ThreadId};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::child;
use crate::devices::{not_a_compute_gpu, preferred_gpu, Environment};
use crate::http::{request, Body};
use crate::server::State;
use crate::settings::is_named_gpu;
use crate::Code;

/// The fixed codes of a llama.cpp server.
pub mod codes {
    pub const LAUNCH_FAILED: &str = "llama_server_launch_failed";
    pub const START_TIMEOUT: &str = "llama_server_start_timeout";
    pub const READINESS: &str = "llama_server_readiness";
    pub const PROTOCOL: &str = "llama_server_protocol";
    pub const EXITED: &str = "llama_server_exited";
    /// The model file could not be read as a model.
    pub const MODEL_INVALID: &str = "llama_server_model_invalid";
    pub const OUT_OF_MEMORY: &str = "llama_server_out_of_memory";
    /// The device asked for is not one the server lists.
    pub const DEVICE_MISSING: &str = "llama_server_device_missing";
    pub const CLEANUP_UNCONFIRMED: &str = "llama_server_cleanup_unconfirmed";
    pub const SINGLE_USE: &str = "llama_server_single_use";
}

/// How long a server may take from its start to its first answer: it reads the whole model
/// (about 3 GB for TranslateGemma 4B in 4 bits) before it listens.
pub const START_TIMEOUT: Duration = Duration::from_secs(300);
/// The context a translation needs: TranslateGemma takes 2K tokens of input.
pub const CONTEXT: u32 = 2048;
const LINE_LIMIT: usize = 65536;

/// Where the model runs: llama.cpp's device name (`Vulkan1`), or the CPU.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Device {
    Cpu,
    Gpu(String),
}

/// A GPU in what `llama-server --list-devices` prints.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listed {
    pub name: String,
    pub description: String,
}

/// The lines `  Vulkan0: NVIDIA GeForce RTX 3060 Ti (8238 MiB, 7460 MiB free)`.
pub fn parse_list(text: &str) -> Vec<Listed> {
    text.lines()
        .filter_map(|line| {
            let (name, rest) = line.trim().split_once(": ")?;
            if !is_named_gpu(name) {
                return None;
            }
            let description = rest.rsplit_once(" (").map_or(rest, |(description, _)| description).trim();
            Some(Listed { name: name.to_owned(), description: description.to_owned() })
        })
        .collect()
}

/// The GPUs `binary --list-devices` prints, or None when it did not run to its end.
pub fn list_devices(binary: &Path, environment: &Environment) -> Option<Vec<Listed>> {
    let mut command = crate::devices::command(binary, environment);
    command.arg("--list-devices").stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().ok()?;
    let readers: Vec<_> = [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
        .into_iter()
        .flatten()
        .map(|stream| {
            std::thread::spawn(move || {
                let mut data = Vec::new();
                let _ = stream.take(256 * 1024).read_to_end(&mut data);
                data
            })
        })
        .collect();
    let deadline = Instant::now() + Duration::from_secs(30);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let text: Vec<u8> = readers.into_iter().flat_map(|reader| reader.join().unwrap_or_default()).collect();
    status.filter(|status| status.success()).map(|_| parse_list(&String::from_utf8_lossy(&text)))
}

/// The device for a setting as the speech.cpp servers name it.
///
/// - `cpu`: the CPU.
/// - `Vulkan<N>`: that device of speech.cpp's list, found in llama.cpp's by name and description
///   (by description alone when the two number it apart). Missing: [`codes::DEVICE_MISSING`].
/// - `auto` and `gpu`: the GPU speech.cpp would choose ([`preferred_gpu`]: a separate GPU, the
///   one with the most memory), found the same way. Without one, `auto` is the CPU and `gpu`
///   fails. Without speech.cpp's list (`speech` None), the first GPU llama.cpp lists that can
///   compute; llama.cpp lists separate GPUs only when there are any.
///
/// `speech` is the rows of `speech devices --json`; `listed`, llama.cpp's own list.
pub fn choose_device(asked: &str, speech: Option<&[Value]>, listed: &[Listed]) -> Result<Device, Code> {
    let described = |name: &str| -> Option<String> {
        speech?.iter().find(|row| row.get("name").and_then(Value::as_str) == Some(name))?.get("description")?.as_str().map(str::to_owned)
    };
    // speech.cpp's device in llama.cpp's list.
    let found = |name: &str| -> Option<Device> {
        match described(name) {
            Some(description) => listed
                .iter()
                .find(|gpu| gpu.name == name && gpu.description == description)
                .or_else(|| listed.iter().find(|gpu| gpu.description == description))
                .map(|gpu| Device::Gpu(gpu.name.clone())),
            None if speech.is_none() => listed.iter().find(|gpu| gpu.name == name).map(|gpu| Device::Gpu(gpu.name.clone())),
            None => None,
        }
    };
    match asked {
        "cpu" => Ok(Device::Cpu),
        "auto" | "gpu" => {
            let chosen = match speech {
                Some(rows) => preferred_gpu(rows).and_then(|name| found(&name)),
                None => listed.iter().find(|gpu| !not_a_compute_gpu(&gpu.description)).map(|gpu| Device::Gpu(gpu.name.clone())),
            };
            match chosen {
                Some(device) => Ok(device),
                None if asked == "auto" => Ok(Device::Cpu),
                None => Err(codes::DEVICE_MISSING),
            }
        }
        name if is_named_gpu(name) => found(name).ok_or(codes::DEVICE_MISSING),
        _ => Err(codes::DEVICE_MISSING),
    }
}

/// What a server is started with.
#[derive(Clone, Debug)]
pub struct Options {
    pub binary: PathBuf,
    pub model: PathBuf,
    pub device: Device,
    /// Sent as `LLAMA_API_KEY`; every request but `/health` must carry it.
    pub api_key: String,
    pub environment: Environment,
    pub start_timeout: Duration,
}

/// What the owner is told when the server ends: None after a stop it asked for, else the code.
pub type OnEnd = Box<dyn Fn(Option<Code>) + Send + Sync>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Health {
    pub state: State,
    /// `http://127.0.0.1:<port>` while the server is ready.
    pub base_url: Option<String>,
    pub error_code: Option<Code>,
}

struct Shared {
    health: Health,
    started: bool,
    thread: Option<(ThreadId, JoinHandle<()>)>,
    child: Option<Arc<Mutex<Child>>>,
    cleanup_ok: bool,
}

struct Inner {
    options: Options,
    on_end: Option<OnEnd>,
    stop: AtomicBool,
    shared: Mutex<Shared>,
    changed: Condvar,
}

/// A llama.cpp server that is started at most once. A restart is a new `LlamaServer`.
pub struct LlamaServer {
    inner: Arc<Inner>,
}

impl LlamaServer {
    pub fn new(options: Options, on_end: Option<OnEnd>) -> LlamaServer {
        let health = Health { state: State::Stopped, base_url: None, error_code: None };
        LlamaServer {
            inner: Arc::new(Inner {
                options,
                on_end,
                stop: AtomicBool::new(false),
                shared: Mutex::new(Shared { health, started: false, thread: None, child: None, cleanup_ok: true }),
                changed: Condvar::new(),
            }),
        }
    }

    pub fn health(&self) -> Health {
        self.inner.shared.lock().unwrap().health.clone()
    }

    pub fn device(&self) -> &Device {
        &self.inner.options.device
    }

    pub fn start(&self) -> Result<(), Code> {
        let mut shared = self.inner.shared.lock().unwrap();
        if shared.started || self.inner.stop.load(Ordering::SeqCst) {
            return Err(codes::SINGLE_USE);
        }
        shared.started = true;
        shared.health.state = State::Preparing;
        let inner = self.inner.clone();
        match std::thread::Builder::new().name("vrct-llama-server".into()).spawn(move || inner.run()) {
            Ok(thread) => shared.thread = Some((thread.thread().id(), thread)),
            Err(_) => {
                shared.health = Health { state: State::Failed, base_url: None, error_code: Some(codes::LAUNCH_FAILED) };
                self.inner.changed.notify_all();
            }
        }
        Ok(())
    }

    /// Waits until the server is ready (its base URL) or has ended (its code).
    pub fn wait_ready(&self, timeout: Duration) -> Result<String, Code> {
        let shared = self.inner.shared.lock().unwrap();
        let (shared, _) = self
            .inner
            .changed
            .wait_timeout_while(shared, timeout, |shared| shared.health.state == State::Preparing)
            .unwrap();
        match (&shared.health.state, &shared.health.base_url) {
            (State::Ready, Some(url)) => Ok(url.clone()),
            (State::Preparing, _) => Err(codes::START_TIMEOUT),
            _ => Err(shared.health.error_code.unwrap_or(codes::EXITED)),
        }
    }

    /// Asks the server to end. It returns at once; `close` waits for the end.
    pub fn stop(&self) {
        let mut shared = self.inner.shared.lock().unwrap();
        self.inner.stop.store(true, Ordering::SeqCst);
        shared.health.base_url = None;
        if matches!(shared.health.state, State::Preparing | State::Ready) {
            shared.health.state = State::Stopping;
        }
        self.inner.changed.notify_all();
    }

    /// Stops and waits. True when the server's child is known to be gone.
    pub fn close(&self, timeout: Duration) -> bool {
        self.stop();
        let thread = {
            let shared = self.inner.shared.lock().unwrap();
            match &shared.thread {
                Some((id, _)) if *id == std::thread::current().id() => return false,
                _ => {}
            }
            let (mut shared, _) = self
                .inner
                .changed
                .wait_timeout_while(shared, timeout, |shared| shared.started && matches!(shared.health.state, State::Preparing | State::Ready | State::Stopping))
                .unwrap();
            if matches!(shared.health.state, State::Stopping) && shared.started {
                return false;
            }
            shared.thread.take()
        };
        if let Some((_, thread)) = thread {
            let _ = thread.join();
        }
        self.inner.shared.lock().unwrap().cleanup_ok
    }
}

impl Drop for LlamaServer {
    fn drop(&mut self) {
        // The child must not outlive its owner; the watch ends it.
        self.stop();
    }
}

/// `\x1b[...m` colour codes removed.
fn strip_ansi(line: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(line);
    let mut clean = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next();
            while chars.peek().is_some_and(|c| c.is_ascii_digit() || *c == ';') {
                chars.next();
            }
            if chars.peek() == Some(&'m') {
                chars.next();
                continue;
            }
        }
        clean.push(c);
    }
    clean.into_bytes()
}

/// The port in `... listening on http://127.0.0.1:<port>`, which ends the line.
fn ready_port(line: &[u8]) -> Option<Result<u16, Code>> {
    const MARK: &[u8] = b"listening on http://127.0.0.1:";
    let at = line.windows(MARK.len()).position(|window| window == MARK)?;
    let rest = &line[at + MARK.len()..];
    let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
    if digits == 0 || digits > 5 || rest[digits..].iter().any(|byte| !byte.is_ascii_whitespace()) {
        return None;
    }
    let port: u32 = std::str::from_utf8(&rest[..digits]).ok()?.parse().ok()?;
    Some(u16::try_from(port).ok().filter(|port| *port != 0).ok_or(codes::PROTOCOL))
}

/// What a failing server's line says, as one of the fixed codes. The line goes nowhere else.
fn failure(line: &[u8]) -> Option<Code> {
    let text = String::from_utf8_lossy(line).to_ascii_lowercase();
    if ["out of memory", "outofdevicememory", "failed to allocate", "unable to allocate"].iter().any(|mark| text.contains(mark)) {
        return Some(codes::OUT_OF_MEMORY);
    }
    if ["error loading model", "failed to load model"].iter().any(|mark| text.contains(mark)) {
        return Some(codes::MODEL_INVALID);
    }
    None
}

impl Inner {
    fn stopping(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    fn arguments(&self) -> Vec<String> {
        let options = &self.options;
        let mut args: Vec<String> = vec!["-m".into(), options.model.to_string_lossy().into_owned()];
        args.extend(["--host", "127.0.0.1", "--port", "0", "--no-webui", "--parallel", "1"].map(str::to_owned));
        args.extend(["--ctx-size".to_owned(), CONTEXT.to_string()]);
        match &options.device {
            Device::Cpu => args.extend(["--device", "none", "--n-gpu-layers", "0"].map(str::to_owned)),
            Device::Gpu(name) => args.extend(["--device".to_owned(), name.clone(), "--n-gpu-layers".to_owned(), "999".to_owned()]),
        }
        args
    }

    /// `/health` until it says ok: the server may listen before the model is in place.
    fn ready(&self, port: u16, deadline: Instant) -> Result<(), Code> {
        loop {
            if self.stopping() {
                return Ok(());
            }
            let left = deadline.checked_duration_since(Instant::now()).filter(|left| !left.is_zero()).ok_or(codes::START_TIMEOUT)?;
            let answer = request(port, "GET", "/health", None, Body::Keep(65536), Instant::now() + left.min(Duration::from_secs(2)), None).map_err(|_| codes::READINESS)?;
            match answer.status {
                200 if serde_json::from_slice::<Value>(&answer.body).ok() == Some(serde_json::json!({"status": "ok"})) => return Ok(()),
                // "Loading model".
                503 => std::thread::sleep(Duration::from_millis(200)),
                _ => return Err(codes::READINESS),
            }
        }
    }

    fn watch(self: &Arc<Self>) -> Result<(), Code> {
        let deadline = Instant::now() + self.options.start_timeout;
        let mut command = crate::devices::command(&self.options.binary, &self.options.environment);
        command.args(self.arguments()).env("LLAMA_API_KEY", &self.options.api_key);
        let mut owned = child::spawn(command).map_err(|_| codes::LAUNCH_FAILED)?;
        let stderr = owned.child.stderr.take();
        let child = Arc::new(Mutex::new(owned.child));
        self.shared.lock().unwrap().child = Some(child.clone());
        // The job (Windows) lives as long as this function keeps it.
        #[cfg(windows)]
        let _job = owned.job;

        // The pipe is read on its own thread: a read of it cannot be bounded in time.
        let (sender, receiver) = sync_channel::<Vec<u8>>(64);
        std::thread::Builder::new()
            .name("vrct-llama-output".into())
            .spawn(move || {
                let Some(mut stderr) = stderr else { return };
                let mut block = [0u8; 8192];
                while let Ok(read) = stderr.read(&mut block) {
                    if read == 0 || sender.send(block[..read].to_vec()).is_err() {
                        break;
                    }
                }
            })
            .map_err(|_| codes::LAUNCH_FAILED)?;

        let mut exit_error = codes::EXITED;
        let mut pending: Vec<u8> = Vec::new();
        let mut open = true;
        while !self.stopping() {
            let exited = child.lock().unwrap().try_wait().map_err(|_| codes::LAUNCH_FAILED)?.is_some();
            let ready = self.shared.lock().unwrap().health.state == State::Ready;
            if !exited && !ready && Instant::now() >= deadline {
                return Err(codes::START_TIMEOUT);
            }
            if exited {
                // What it wrote before it ended: a bounded amount, with its last partial line.
                let until = Instant::now() + Duration::from_millis(500);
                while open && pending.len() <= LINE_LIMIT {
                    match receiver.recv_timeout(until.saturating_duration_since(Instant::now())) {
                        Ok(data) => pending.extend(data),
                        Err(_) => break,
                    }
                }
                if !pending.is_empty() && !pending.ends_with(b"\n") {
                    pending.push(b'\n');
                }
            } else if open {
                match receiver.recv_timeout(Duration::from_millis(50)) {
                    Ok(data) => pending.extend(data),
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => open = false,
                }
            } else {
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }
            while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
                let mut line: Vec<u8> = pending.drain(..=end).collect();
                line.pop();
                if line.len() > LINE_LIMIT {
                    return Err(codes::PROTOCOL);
                }
                let mut line = strip_ansi(&line);
                while line.last() == Some(&b'\r') {
                    line.pop();
                }
                if let Some(code) = failure(&line) {
                    if exit_error != codes::OUT_OF_MEMORY {
                        exit_error = code;
                    }
                }
                if exited || self.shared.lock().unwrap().health.state == State::Ready {
                    continue;
                }
                if let Some(port) = ready_port(&line) {
                    let port = port?;
                    self.ready(port, deadline)?;
                    let mut shared = self.shared.lock().unwrap();
                    if !self.stopping() {
                        shared.health.state = State::Ready;
                        shared.health.base_url = Some(format!("http://127.0.0.1:{port}"));
                        self.changed.notify_all();
                    }
                }
            }
            if pending.len() > LINE_LIMIT {
                return Err(codes::PROTOCOL);
            }
            if exited {
                return Err(exit_error);
            }
        }
        Ok(())
    }

    fn run(self: Arc<Self>) {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.watch()));
        let mut failure = match outcome {
            Ok(result) => result.err(),
            Err(_) => Some(codes::LAUNCH_FAILED),
        };
        let child = self.shared.lock().unwrap().child.clone();
        let mut cleanup_ok = true;
        if let Some(child) = child {
            cleanup_ok = child::end(&mut child.lock().unwrap());
        }
        {
            let mut shared = self.shared.lock().unwrap();
            shared.cleanup_ok = cleanup_ok;
            if !cleanup_ok {
                failure = Some(codes::CLEANUP_UNCONFIRMED);
            } else if self.stopping() {
                failure = None;
            }
            shared.health = Health { state: if failure.is_some() { State::Failed } else { State::Stopped }, base_url: None, error_code: failure };
            self.changed.notify_all();
        }
        if let Some(hook) = &self.on_end {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| hook(failure)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_listening_line_gives_its_port_and_nothing_else_does() {
        assert_eq!(ready_port(b"0.00.096.112 I srv  server_on_li: listening on http://127.0.0.1:56576"), Some(Ok(56576)));
        assert_eq!(ready_port(b"main: listening on http://127.0.0.1:8080  "), Some(Ok(8080)));
        assert_eq!(ready_port(b"listening on http://127.0.0.1:0"), Some(Err(codes::PROTOCOL)));
        assert_eq!(ready_port(b"listening on http://127.0.0.1:70000"), Some(Err(codes::PROTOCOL)));
        assert_eq!(ready_port(b"listening on http://127.0.0.1:8080/v1"), None);
        assert_eq!(ready_port(b"listening on http://0.0.0.0:8080"), None);
        assert_eq!(ready_port(b"loading model 'listening on http://127.0.0.1:1x'"), None);
    }

    #[test]
    fn only_the_fixed_failures_are_named() {
        assert_eq!(failure(b"E llama_model_load: error loading model: llama_model_loader: failed to load model from /private/x.gguf"), Some(codes::MODEL_INVALID));
        assert_eq!(failure(b"E ggml_vulkan: Device memory allocation of size 1 failed: ErrorOutOfDeviceMemory"), Some(codes::OUT_OF_MEMORY));
        assert_eq!(failure(b"W srv  server_setup: security: no API key is set"), None);
        assert_eq!(strip_ansi(b"\x1b[31mE error loading model\x1b[0m"), b"E error loading model");
    }

    #[test]
    fn llama_cpp_list_of_devices_is_read() {
        let text = "Available devices:\n  Vulkan0: Intel(R) Iris(R) Xe Graphics (16296 MiB, 15527 MiB free)\n  Vulkan1: NVIDIA GeForce RTX 3060 Ti (8238 MiB, 7460 MiB free)\n";
        assert_eq!(
            parse_list(text),
            [
                Listed { name: "Vulkan0".into(), description: "Intel(R) Iris(R) Xe Graphics".into() },
                Listed { name: "Vulkan1".into(), description: "NVIDIA GeForce RTX 3060 Ti".into() }
            ]
        );
        assert!(parse_list("Available devices:\n").is_empty());
    }

    fn speech_rows() -> Vec<Value> {
        vec![
            json!({"name": "Vulkan0", "kind": "igpu", "description": "Intel(R) Iris(R) Xe Graphics", "memory_total": 17087397888u64}),
            json!({"name": "Vulkan1", "kind": "gpu", "description": "NVIDIA GeForce RTX 3060 Ti", "memory_total": 8638169088u64}),
        ]
    }

    fn listed(rows: &[(&str, &str)]) -> Vec<Listed> {
        rows.iter().map(|(name, description)| Listed { name: (*name).into(), description: (*description).into() }).collect()
    }

    #[test]
    fn the_device_is_the_one_speech_cpp_would_use() {
        let rows = speech_rows();
        let both = listed(&[("Vulkan0", "Intel(R) Iris(R) Xe Graphics"), ("Vulkan1", "NVIDIA GeForce RTX 3060 Ti")]);
        // auto and gpu: the separate GPU, not the integrated one with more shared memory.
        assert_eq!(choose_device("auto", Some(&rows), &both), Ok(Device::Gpu("Vulkan1".into())));
        assert_eq!(choose_device("gpu", Some(&rows), &both), Ok(Device::Gpu("Vulkan1".into())));
        assert_eq!(choose_device("cpu", Some(&rows), &both), Ok(Device::Cpu));
        assert_eq!(choose_device("Vulkan0", Some(&rows), &both), Ok(Device::Gpu("Vulkan0".into())));
        // llama.cpp lists only the separate GPU, under another number: found by its description.
        let only = listed(&[("Vulkan0", "NVIDIA GeForce RTX 3060 Ti")]);
        assert_eq!(choose_device("auto", Some(&rows), &only), Ok(Device::Gpu("Vulkan0".into())));
        assert_eq!(choose_device("Vulkan1", Some(&rows), &only), Ok(Device::Gpu("Vulkan0".into())));
        assert_eq!(choose_device("Vulkan0", Some(&rows), &only), Err(codes::DEVICE_MISSING));
        // No separate GPU: auto runs on the CPU, gpu fails as it does for speech.cpp.
        let integrated = vec![rows[0].clone()];
        assert_eq!(choose_device("auto", Some(&integrated), &both), Ok(Device::Cpu));
        assert_eq!(choose_device("gpu", Some(&integrated), &both), Err(codes::DEVICE_MISSING));
        // llama.cpp without Vulkan (the CPU build): auto is the CPU.
        assert_eq!(choose_device("auto", Some(&rows), &[]), Ok(Device::Cpu));
        assert_eq!(choose_device("Vulkan1", Some(&rows), &[]), Err(codes::DEVICE_MISSING));
        // Without speech.cpp's list: llama.cpp's first GPU that computes, or a named one.
        let software = listed(&[("Vulkan0", "llvmpipe (LLVM 17.0.6, 256 bits)"), ("Vulkan1", "AMD Radeon RX 7600")]);
        assert_eq!(choose_device("auto", None, &software), Ok(Device::Gpu("Vulkan1".into())));
        assert_eq!(choose_device("Vulkan0", None, &software), Ok(Device::Gpu("Vulkan0".into())));
        assert_eq!(choose_device("auto", None, &[]), Ok(Device::Cpu));
        assert_eq!(choose_device("Vulkan", None, &software), Err(codes::DEVICE_MISSING));
        assert_eq!(choose_device("cuda", None, &software), Err(codes::DEVICE_MISSING));
    }
}
