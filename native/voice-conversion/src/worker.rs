//! The RVC worker process (`vrct-rvc-worker`, `rvc_process.py`) and its pipes.
//!
//! Reads and writes run on threads of their own, so that a stalled worker never blocks the
//! owner: the owner waits on a channel with a deadline, and a stop ends the child, which
//! ends both threads.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use crate::child::{self, Owned};
use crate::protocol::{read_packet, Info, ProtocolError};

/// What the worker reads from the runtime folder besides `lib/`.
pub const ASSETS: [&str; 3] = ["hubert_base/config.json", "hubert_base/pytorch_model.bin", "rmvpe/rmvpe.onnx"];

/// ONNX Runtime's library in a runtime's `lib/`.
pub fn ort_library() -> &'static str {
    if cfg!(windows) {
        "onnxruntime.dll"
    } else {
        "libonnxruntime.so"
    }
}

/// The worker's file name in the shipped `build/` folder.
pub fn worker_name() -> &'static str {
    if cfg!(windows) {
        "vrct-rvc-worker.exe"
    } else {
        "vrct-rvc-worker"
    }
}

/// The files the worker refuses to start without. A runtime of the earlier Python kind
/// (venv, engine) has none of `lib/` and must be set up again.
pub fn runtime_complete(runtime: &Path) -> bool {
    runtime.join("lib").join(ort_library()).is_file() && ASSETS.iter().all(|name| runtime.join("assets").join(name).is_file())
}

/// One conversion's choices, checked (`RVCProcess`).
#[derive(Debug, Clone, PartialEq)]
pub struct RvcOptions {
    pub runtime: PathBuf,
    pub model: PathBuf,
    /// Empty: no index.
    pub index: String,
    pub pitch: i64,
    pub index_rate: f64,
    /// `auto`, `cuda`, `directml` or `cpu` (the worker's `--device`).
    pub device: String,
    /// The `lib/` of the app's DirectML runtime (the DirectML build of ONNX Runtime and
    /// `DirectML.dll`) when it is set up: the worker's `--directml`. The owner finds it; a start
    /// never names it.
    pub directml: Option<PathBuf>,
    /// CPU threads per network; 0 lets the worker choose.
    pub threads: u32,
    /// The causal input high-pass (`--highpass on|off`).
    pub highpass: bool,
    /// The length of the blocks the microphone is cut into and converted in, in ms
    /// (`--block-ms`; [`crate::protocol::Block`]), or [`AUTO_BLOCK_MS`]: the worker chooses.
    pub block_ms: u32,
}

/// What the worker's `--device` takes. `directml` runs on Windows with the DirectML runtime.
pub const DEVICES: [&str; 4] = ["auto", "cuda", "directml", "cpu"];
/// The most CPU threads per network a start may ask for.
pub const MAX_THREADS: u32 = 64;
/// A start's `block_ms` that leaves the block to the worker (`--block-ms auto`, #531): on a
/// GPU the shortest it converts in time with room to spare, timed before `ready`, which then
/// says the block. A fixed 40 ms block took longer to convert than it lasts on a slower GPU (an
/// RTX 3060 Ti over Thunderbolt) and was dropped block after block.
pub const AUTO_BLOCK_MS: u32 = 0;
/// The block of a start that does not choose one: the worker's choice (decided 2026-11-20).
pub const DEFAULT_BLOCK_MS: u32 = AUTO_BLOCK_MS;

/// Python's `str()` of the index rate: `0` for an int, `0.5`, `1.0` for floats.
pub fn rate_text(rate: f64, was_integer: bool) -> String {
    if was_integer {
        format!("{}", rate as i64)
    } else if rate.fract() == 0.0 {
        format!("{rate:.1}")
    } else {
        format!("{rate}")
    }
}

/// The worker's arguments.
pub fn arguments(options: &RvcOptions, rate_text: &str, session: &str) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--runtime".into(),
        options.runtime.to_string_lossy().into_owned(),
        "--model".into(),
        options.model.to_string_lossy().into_owned(),
        "--session".into(),
        session.into(),
        "--index".into(),
        options.index.clone(),
        "--pitch".into(),
        options.pitch.to_string(),
        "--index-rate".into(),
        rate_text.into(),
        "--block-ms".into(),
        if options.block_ms == AUTO_BLOCK_MS { "auto".into() } else { options.block_ms.to_string() },
        "--device".into(),
        options.device.clone(),
        "--highpass".into(),
        (if options.highpass { "on" } else { "off" }).into(),
    ];
    // Without `--threads` the worker picks the count for the device it ends up on.
    if options.threads > 0 {
        args.extend(["--threads".into(), options.threads.to_string()]);
    }
    // Given whenever it is set up: `auto` may convert there too.
    if let Some(directml) = &options.directml {
        args.extend(["--directml".into(), directml.to_string_lossy().into_owned()]);
    }
    args
}

type Packet = Result<(Info, Vec<u8>), ProtocolError>;

/// A started worker with its pipes.
pub struct WorkerPipe {
    owned: Owned,
    packets: Receiver<Packet>,
    writes: Option<Sender<Vec<u8>>>,
    write_failed: Arc<AtomicBool>,
}

impl WorkerPipe {
    /// Start `binary` with `args`. Its error stream is not kept: it could hold paths.
    pub fn start(binary: &Path, args: &[String], cwd: Option<&Path>) -> std::io::Result<Self> {
        let mut command = Command::new(binary);
        command.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        let mut owned = child::spawn(command)?;
        let mut stdout = owned.child.stdout.take().expect("piped");
        let mut stdin = owned.child.stdin.take().expect("piped");
        let (packet_sender, packets) = channel();
        thread::Builder::new().name("vrct-vc-read".into()).spawn(move || loop {
            let packet = read_packet(&mut stdout);
            let failed = packet.is_err();
            if packet_sender.send(packet).is_err() || failed {
                return;
            }
        })?;
        let (writes, write_queue) = channel::<Vec<u8>>();
        let write_failed = Arc::new(AtomicBool::new(false));
        let failed = write_failed.clone();
        thread::Builder::new().name("vrct-vc-write".into()).spawn(move || {
            while let Ok(bytes) = write_queue.recv() {
                if stdin.write_all(&bytes).and_then(|()| stdin.flush()).is_err() {
                    failed.store(true, Ordering::SeqCst);
                    return;
                }
            }
            // The queue closed: dropping stdin is the worker's end of input.
        })?;
        Ok(Self { owned, packets, writes: Some(writes), write_failed })
    }

    /// The next packet within `timeout`, calling `check` about every 20 ms.
    pub fn read(&self, timeout: Duration, check: &mut dyn FnMut() -> Result<(), ProtocolError>) -> Result<(Info, Vec<u8>), ProtocolError> {
        let deadline = Instant::now() + timeout;
        loop {
            check()?;
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(ProtocolError::new("vc_worker_stalled"));
            }
            match self.packets.recv_timeout(remaining.min(Duration::from_millis(20))) {
                Ok(packet) => {
                    check()?;
                    return packet;
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return Err(ProtocolError::new("vc_worker_eof")),
            }
        }
    }

    /// Queue bytes for the worker. Never waits for the pipe.
    pub fn send(&self, bytes: Vec<u8>) -> Result<(), ProtocolError> {
        if self.write_failed.load(Ordering::SeqCst) {
            return Err(ProtocolError::new("vc_worker_eof"));
        }
        match &self.writes {
            Some(writes) if writes.send(bytes).is_ok() => Ok(()),
            _ => Err(ProtocolError::new("vc_worker_eof")),
        }
    }

    /// Whether the worker has ended.
    pub fn exited(&mut self) -> bool {
        !matches!(self.owned.child.try_wait(), Ok(None))
    }

    /// End the worker: close its input, then terminate and kill. False when its end could not
    /// be confirmed.
    pub fn end(&mut self) -> bool {
        self.writes = None;
        child::end(&mut self.owned.child, Duration::from_millis(500))
    }
}

impl Drop for WorkerPipe {
    fn drop(&mut self) {
        self.end();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::rvc_options;
    use serde_json::json;

    fn base() -> serde_json::Value {
        json!({ "engine": "rvc", "runtime": "/r", "model": "/v.pth", "index": "", "pitch": 2, "index_rate": 0 })
    }

    #[test]
    fn older_starts_without_the_worker_choices_keep_the_workers_defaults() {
        let (options, rate) = rvc_options(&base()).unwrap();
        assert_eq!((options.device.as_str(), options.threads, options.highpass), ("auto", 0, true));
        let args = arguments(&options, &rate, "s");
        assert_eq!(args[args.len() - 4..], ["--device", "auto", "--highpass", "on"], "no --threads: the worker picks");
        // The block is always passed: the worker's choice unless the start chose one (#531).
        assert_eq!(args[args.len() - 6..args.len() - 4], ["--block-ms", "auto"]);
        let mut zero = base();
        zero["block_ms"] = json!(0);
        let (options, rate) = rvc_options(&zero).unwrap();
        assert_eq!(options.block_ms, AUTO_BLOCK_MS, "0 asks for the worker's choice");
        assert!(arguments(&options, &rate, "s").windows(2).any(|pair| pair == ["--block-ms", "auto"]));
    }

    #[test]
    fn the_worker_choices_reach_its_arguments() {
        let mut value = base();
        value["device"] = json!("cpu");
        value["threads"] = json!(6);
        value["highpass"] = json!(false);
        value["block_ms"] = json!(80);
        let (options, rate) = rvc_options(&value).unwrap();
        let args = arguments(&options, &rate, "s");
        assert_eq!(args[args.len() - 8..], ["--block-ms", "80", "--device", "cpu", "--highpass", "off", "--threads", "6"]);
    }

    #[test]
    fn the_directml_runtime_reaches_the_worker_when_the_owner_found_it() {
        let mut value = base();
        value["device"] = json!("directml");
        let (mut options, rate) = rvc_options(&value).unwrap();
        assert_eq!((options.device.as_str(), options.directml.as_deref()), ("directml", None), "a start never names the folder");
        assert!(!arguments(&options, &rate, "s").contains(&"--directml".to_string()));
        options.directml = Some(PathBuf::from("/state/vc_runtimes/onnxruntime-directml/lib"));
        let args = arguments(&options, &rate, "s");
        assert_eq!(args[args.len() - 2..], ["--directml", "/state/vc_runtimes/onnxruntime-directml/lib"]);
        // A start cannot sneak the folder in.
        let mut sneaky = base();
        sneaky["directml"] = json!("/elsewhere");
        assert_eq!(rvc_options(&sneaky).unwrap_err(), "vc_options_invalid");
    }

    #[test]
    fn bad_worker_choices_are_refused() {
        for (key, bad) in [("device", json!("gpu")), ("device", json!(null)), ("device", json!("DirectML")), ("threads", json!(-1)), ("threads", json!(65)), ("threads", json!(1.5)),
            ("highpass", json!("on")), ("other", json!(1)), ("block_ms", json!(30)), ("block_ms", json!(-40)), ("block_ms", json!(220)),
            ("block_ms", json!(40.0)), ("block_ms", json!(0.0)), ("block_ms", json!("40")), ("block_ms", json!("auto")), ("block_ms", json!(null))]
        {
            let mut value = base();
            value[key] = bad.clone();
            assert_eq!(rvc_options(&value).unwrap_err(), "vc_options_invalid", "{key}={bad}");
        }
        let mut missing = base();
        missing.as_object_mut().unwrap().remove("pitch");
        assert!(rvc_options(&missing).is_err());
    }
}
