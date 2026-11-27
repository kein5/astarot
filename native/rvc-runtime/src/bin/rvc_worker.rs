//! `astarot-rvc-worker`: the application's live RVC voice conversion process.
//!
//! It speaks the application's live-VC pipe contract
//! (`native/voice-conversion/src/protocol.rs`, "VVC1"): one `ready` (or `failed`) packet
//! once the voice model is loaded, then one `output` packet for every `input` packet, each a
//! block of 48 kHz mono 16-bit audio. The block is `--block-ms` long (20 to 200 ms in steps
//! of 20; 80 ms, the external runtime's, when it is not given), and the `ready` packet says it
//! in `block_frames`. With `--block-ms auto`, the application's default, the worker chooses:
//! on a GPU the shortest of 40, 60, 80, 100, 120, 160 and 200 ms it converts in time with room
//! to spare (timed on a test tone before `ready`), on the CPU 40 ms. With `--block-cache <file>`
//! it keeps that choice there, by voice model and GPU, and uses it again on a later start
//! instead of timing the GPU, unless the application asked for the GPU to be timed again (the
//! user chose Automatic again; [`BlockCache`]). It opens no audio device, downloads nothing and never writes
//! audio, text or file paths anywhere but the output pipe (the block cache holds hashes and
//! lengths only).
//!
//! ONNX Runtime, the CUDA libraries and the two fixed networks come from the runtime
//! folder the application sets up after the user's consent (`--runtime`):
//!
//! ```text
//! <runtime>/lib/                         ONNX Runtime; on a PC with an NVIDIA GPU also its
//!                                        CUDA provider and the CUDA and cuDNN libraries
//! <runtime>/assets/hubert_base/          config.json, pytorch_model.bin
//! <runtime>/assets/rmvpe/rmvpe.onnx
//! ```
//!
//! On Windows, `--directml <dir>` names a second library folder: the DirectML build of
//! ONNX Runtime and `DirectML.dll`, which the application sets up after consent as well
//! (its "ONNX Runtime · DirectML" runtime, shared with the local translation). A process
//! loads one ONNX Runtime, so the worker picks the folder before it loads anything.
//!
//! Where it converts (`--device`, default `auto`):
//!
//! - `auto`: CUDA when the runtime has the CUDA provider and its libraries load; otherwise
//!   DirectML when a DirectML folder is there and DirectML would not run on an integrated
//!   GPU (too slow for real time); otherwise the CPU. A GPU that then cannot run the check
//!   graph leaves the CPU of the same library. On a PC with both, CUDA comes first, as
//!   before DirectML was offered.
//! - `cuda`, `directml`: that GPU or a `failed` packet, never the CPU.
//! - `cpu`: the CPU, with the runtime's own library.
//!
//! How it converts there:
//!
//! - **GPU** (CUDA or DirectML): every packet is converted before it is answered, as the
//!   external runtime did (one stream block per packet, 2 s of context), with a crossfade of
//!   half the block up to 20 ms.
//! - **CPU**: the CPU cannot convert such short blocks in real time, so the worker converts
//!   0.5 s blocks on a thread of its own and answers each packet at once from what that
//!   thread has finished, at a fixed delay that leaves a whole block's time for each
//!   block. Until the first converted audio is due, answers are silence (`vad_silence`).
//!   When more than half of the last blocks came too late or had to be dropped, the PC
//!   cannot keep up: the worker says so with a `failed` packet (`vc_capture_overrun`, as
//!   the owner reports a GPU that falls behind) and stops, instead of answering silence.
//!   Before `ready` it times the CPU on a test tone; a CPU that needs longer for a block
//!   than the block lasts cannot keep up from the start, and the worker does not start
//!   (`failed`, `vc_cpu_too_slow`).
//!
//! The `ready` packet names the device (`profile`: `low` for a GPU, CUDA or DirectML, `cpu`)
//! and the delay the worker adds between a sample coming in and its converted counterpart
//! going out (`latency_ms`), for the application to show.
//!
//! `--probe` only checks that the device can run (exit 0) and is what the setup's last
//! step runs.

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use astarot_rvc_runtime::audio::StreamResampler;
use astarot_rvc_runtime::{backend, Converter, Device, Error, FeatureExtractor, FeatureIndex, Layout, NoiseMode, Rmvpe, Stream, StreamOptions, Synthesizer, VoiceModel};
use serde_json::{Map, Value};

const RATE: u32 = 48_000;
const INPUT_RATE: u32 = 16_000;
const MAX_HEADER: usize = 2_048;
/// The packets of the external runtime this replaces, when `--block-ms` is not given.
const DEFAULT_BLOCK_MS: u32 = 80;
/// The longest packet's audio (200 ms).
const MAX_PCM_BYTES: usize = (RATE as usize / 1000) * 200 * 2;

/// The length of a session's packets (`--block-ms`): 20 to 200 ms in steps of 20, the
/// owner's 20 ms capture parts (`Block` of `protocol.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Packets {
    ms: u32,
}

impl Packets {
    fn of(ms: u32) -> Option<Self> {
        ((20..=200).contains(&ms) && ms.is_multiple_of(20)).then_some(Packets { ms })
    }

    /// 48 kHz samples per packet.
    fn frames(self) -> usize {
        (RATE as usize / 1000) * self.ms as usize
    }

    fn bytes(self) -> usize {
        self.frames() * 2
    }

    fn ns(self) -> u64 {
        u64::from(self.ms) * 1_000_000
    }

    /// 16 kHz samples per packet.
    fn input(self) -> usize {
        self.frames() / 3
    }

    /// GPU: one stream block per packet in 10 ms frames, a crossfade of half of it but at most
    /// [`GPU_CROSSFADE_LIMIT`], searched over 10 ms, and 2 s of context.
    fn gpu_layout(self) -> Layout {
        let block = self.ms as usize / 10;
        Layout { block, crossfade: (block / 2).clamp(1, GPU_CROSSFADE_LIMIT), search: 1, extra: 200 }
    }
}

/// GPU: the longest crossfade, in 10 ms frames (20 ms). The output comes later by the crossfade
/// and the search: at 80 ms, half the block (40 ms) and the search came to 50 ms, and this
/// comes to 30 ms. In a listening check of a synthesized voice converted with 20, 40 and 80 ms
/// blocks (#928, 2026-11-27), every 10 ms crossfade broke up at the joins and every one of 20 ms
/// or longer sounded fine (docs/voice-stack/rvc-low-latency-2026-11-20.md).
const GPU_CROSSFADE_LIMIT: usize = 2;

/// CPU: the only layout of the Phase 2 measurements in which every block of a CPU took
/// less time than it lasts (0.5 s blocks, 2.5 s of context; README, "Streaming").
const CPU_LAYOUT: Layout = Layout { block: 50, crossfade: 5, search: 1, extra: 250 };
/// Blocks of a test tone converted before `ready`, so the first real block does not pay
/// for the networks' first runs.
const WARMUP_BLOCKS: usize = 3;
/// ONNX Runtime CPU threads per session when the networks run on the GPU.
const GPU_INTRA_THREADS: usize = 1;
/// ONNX Runtime CPU threads per session when they run on the CPU: half the logical CPUs,
/// at least 2 and at most 6. On the test PC, busy with other work, 6 converted a 0.5 s block
/// fastest; 4 or 8 took a fifth longer, 12 twice and ONNX Runtime's default (every logical
/// CPU) more than three times as long (README, "Application worker"). Half leaves the
/// rest to VRChat and the other apps.
fn cpu_intra_threads() -> usize {
    let logical = std::thread::available_parallelism().map(|count| count.get()).unwrap_or(4);
    (logical / 2).clamp(2, 6)
}
/// CPU: blocks of input that may wait for conversion before the oldest is dropped, so a
/// PC that falls behind loses audio instead of adding delay without end.
const CPU_BACKLOG_BLOCKS: usize = 3;
/// CPU: blocks looked back on to tell a PC that cannot keep up (4 s at 0.5 s blocks).
const CPU_LATE_WINDOW: usize = 8;
/// CPU: blocks timed before `ready`, after one that settles the first runs. The fastest must
/// take less than the block lasts, or the PC cannot convert on the CPU in real time and the
/// worker does not start (`vc_cpu_too_slow`): such a PC would only answer silence and stop with
/// `vc_capture_overrun` a few seconds later (an Intel Core i7-1255U took 1.2 s for a 0.5 s
/// block, 2026-11-20).
const CPU_TIMED_BLOCKS: usize = 2;
/// `--block-ms auto` on a GPU: the packet lengths chosen from, shortest first (#531). The GPU is
/// timed on the shortest, and the shortest it converts in time with [`AUTO_HEADROOM`] is used;
/// the last when none is. A longer block delays the voice by as much again and leaves the GPU
/// idle longer, which lowers its clock, so the shortest that keeps up is the one wanted
/// (docs/voice-stack/rvc-low-latency-2026-11-20.md).
const AUTO_BLOCK_MS: [u32; 7] = [40, 60, 80, 100, 120, 160, 200];
/// The GPU's time for a block converted back to back, times this, must fit in the packet. At
/// the microphone's pace the round trip's p95 was 1.2 to 1.4 times that time (an RTX 3060 Ti
/// over Thunderbolt, CUDA and DirectML, 60 and 80 ms blocks, 2026-11-20).
const AUTO_HEADROOM: f64 = 1.4;
/// Blocks timed, after one that settles the networks' first runs.
const AUTO_TIMED_BLOCKS: usize = 3;
/// `--block-ms auto` on the CPU: packets of the application's earlier default. The CPU
/// converts 0.5 s blocks of its own whatever the packets.
const AUTO_CPU_PACKET_MS: u32 = 40;

#[cfg(target_os = "linux")]
const ORT_LIBRARY: &str = "libonnxruntime.so";
#[cfg(windows)]
const ORT_LIBRARY: &str = "onnxruntime.dll";
/// The CUDA provider; a runtime set up for the CPU has none.
#[cfg(target_os = "linux")]
const CUDA_PROVIDER: &str = "libonnxruntime_providers_cuda.so";
#[cfg(windows)]
const CUDA_PROVIDER: &str = "onnxruntime_providers_cuda.dll";
/// CUDA 13 and cuDNN 9, loaded from the runtime folder before ONNX Runtime's CUDA provider
/// needs them, so nothing depends on the system's library search path.
#[cfg(target_os = "linux")]
const GPU_LIBRARIES: &[&str] = &[
    "libcudart.so.13",
    "libcublasLt.so.13",
    "libcublas.so.13",
    "libcurand.so.10",
    "libnvrtc-builtins.so.13.4",
    "libnvrtc.so.13",
    "libcudnn.so.9",
    "libcudnn_graph.so.9",
    "libcudnn_ops.so.9",
    "libcudnn_heuristic.so.9",
    "libcudnn_cnn.so.9",
    "libcudnn_adv.so.9",
    "libcudnn_ext.so.9",
    "libcudnn_engines_precompiled.so.9",
    "libcudnn_engines_runtime_compiled.so.9",
    "libcudnn_engines_tensor_ir.so.9",
];
/// DirectML itself, beside the DirectML build of ONNX Runtime; loaded first, because the
/// loader does not look beside `onnxruntime.dll`.
const DIRECTML_LIBRARY: &str = "DirectML.dll";
#[cfg(windows)]
const GPU_LIBRARIES: &[&str] = &[
    "cudart64_13.dll",
    "cublasLt64_13.dll",
    "cublas64_13.dll",
    "curand64_10.dll",
    "nvrtc-builtins64_134.dll",
    "nvrtc64_130_0.dll",
    "cudnn64_9.dll",
    "cudnn_graph64_9.dll",
    "cudnn_ops64_9.dll",
    "cudnn_heuristic64_9.dll",
    "cudnn_cnn64_9.dll",
    "cudnn_adv64_9.dll",
    "cudnn_ext64_9.dll",
    "cudnn_engines_precompiled64_9.dll",
    "cudnn_engines_runtime_compiled64_9.dll",
    "cudnn_engines_tensor_ir64_9.dll",
];

/// Why the worker could not become ready: the codes of `protocol.WORKER_FAILURES`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Failure {
    GpuUnavailable,
    /// DirectML was asked for and cannot run: no DirectML folder, or no GPU it can use.
    DirectMlUnavailable,
    /// The conversion would run on the CPU, and the CPU cannot convert a block in the time
    /// the block lasts ([`CPU_TIMED_BLOCKS`]).
    CpuTooSlow,
    RuntimeIncomplete,
    ModelMissing,
    CheckpointIncomplete,
    IndexFailed,
    FormatInvalid,
}

impl Failure {
    fn code(self) -> &'static str {
        match self {
            Failure::GpuUnavailable => "vc_gpu_unavailable",
            Failure::DirectMlUnavailable => "vc_directml_unavailable",
            Failure::CpuTooSlow => "vc_cpu_too_slow",
            Failure::RuntimeIncomplete => "vc_runtime_incomplete",
            Failure::ModelMissing => "vc_model_missing",
            Failure::CheckpointIncomplete => "vc_checkpoint_incomplete",
            Failure::IndexFailed => "vc_index_failed",
            Failure::FormatInvalid => "vc_engine_format_invalid",
        }
    }
}

/// A protocol or conversion error after start: the worker stops, the owner reports it.
#[derive(Debug)]
struct Stop(&'static str);

/// The PC cannot convert in time; the one stop the worker tells the owner about.
const OVERRUN: &str = "vc_capture_overrun";

/// A packet's header and audio.
type Packet = (Map<String, Value>, Vec<u8>);

struct Arguments {
    runtime: PathBuf,
    /// The DirectML build of ONNX Runtime with `DirectML.dll` (`--directml`), when set up.
    directml: Option<PathBuf>,
    model: PathBuf,
    index: Option<PathBuf>,
    session: String,
    pitch: i32,
    index_rate: f32,
    device: Choice,
    threads: Option<usize>,
    highpass: bool,
    /// `None`: `--block-ms auto`, chosen when the device is known.
    packets: Option<Packets>,
    /// `--block-cache`: where `--block-ms auto` keeps the lengths it chose ([`BlockCache`]).
    block_cache: Option<PathBuf>,
}

/// What `--device` asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Choice {
    /// A GPU when one can be used (CUDA, then DirectML), otherwise the CPU.
    Auto,
    Cuda,
    DirectMl,
    Cpu,
}

fn choice(text: Option<&str>) -> Result<Choice, String> {
    match text {
        None | Some("auto") => Ok(Choice::Auto),
        Some("cuda") => Ok(Choice::Cuda),
        Some("directml") => Ok(Choice::DirectMl),
        Some("cpu") => Ok(Choice::Cpu),
        Some(_) => Err("`--device` must be auto, cuda, directml or cpu".into()),
    }
}

const USAGE: &str = "\
Usage: astarot-rvc-worker --runtime <dir> --model <voice.pth> --session <32 hex digits>
                       [--index <file.index>] [--pitch <-24..24>] [--index-rate <0..1>]
                       [--device auto|cuda|directml|cpu] [--directml <dir>] [--threads <n>]
                       [--highpass on|off] [--block-ms auto|<20..200, a multiple of 20>] [--block-cache <file>]
       astarot-rvc-worker --runtime <dir> --probe [--device cuda|directml|cpu|auto]
";

fn parse(mut values: HashMap<String, String>) -> Result<Arguments, String> {
    let mut take = |name: &str| values.remove(name);
    let runtime = take("runtime").map(PathBuf::from).ok_or("`--runtime` is required")?;
    let directml = take("directml").filter(|text| !text.is_empty()).map(PathBuf::from);
    let model = take("model").map(PathBuf::from).ok_or("`--model` is required")?;
    let session = take("session").ok_or("`--session` is required")?;
    if session.len() != 32 || !session.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err("`--session` must be 32 lower-case hex digits".into());
    }
    let index = take("index").filter(|text| !text.is_empty()).map(PathBuf::from);
    let pitch: i32 = take("pitch").map(|text| text.parse()).transpose().map_err(|_| "`--pitch` is not a whole number")?.unwrap_or(0);
    let index_rate: f32 = take("index-rate").map(|text| text.parse()).transpose().map_err(|_| "`--index-rate` is not a number")?.unwrap_or(0.0);
    if !(-24..=24).contains(&pitch) || !index_rate.is_finite() || !(0.0..=1.0).contains(&index_rate) || (index_rate > 0.0 && index.is_none()) {
        return Err("pitch or index rate out of range, or an index rate without an index".into());
    }
    let device = choice(take("device").as_deref())?;
    let threads = take("threads").map(|text| text.parse::<usize>()).transpose().map_err(|_| "`--threads` is not a whole number")?.filter(|&n| n > 0);
    // The input high-pass of the specification (on); off matches the earlier runtime.
    let highpass = match take("highpass").as_deref() {
        None | Some("on") => true,
        Some("off") => false,
        Some(_) => return Err("`--highpass` must be on or off".into()),
    };
    let packets = match take("block-ms").as_deref() {
        None => Some(Packets::of(DEFAULT_BLOCK_MS).expect("a valid default")),
        Some("auto") => None,
        Some(text) => Some(text.parse::<u32>().ok().and_then(Packets::of).ok_or("`--block-ms` must be auto, or 20 to 200 and a multiple of 20")?),
    };
    let block_cache = take("block-cache").filter(|text| !text.is_empty()).map(PathBuf::from);
    if let Some(unknown) = values.keys().next() {
        return Err(format!("unknown option `--{unknown}`"));
    }
    Ok(Arguments { runtime, directml, model, index, session, pitch, index_rate, device, threads, highpass, packets, block_cache })
}

fn options() -> Result<(HashMap<String, String>, bool), String> {
    let mut values = HashMap::new();
    let mut probe = false;
    let mut arguments = std::env::args().skip(1);
    while let Some(flag) = arguments.next() {
        if flag == "--probe" {
            probe = true;
            continue;
        }
        let name = flag.strip_prefix("--").ok_or_else(|| format!("unexpected argument `{flag}`"))?.to_string();
        let value = arguments.next().ok_or_else(|| format!("`{flag}` needs a value"))?;
        if values.insert(name, value).is_some() {
            return Err(format!("`{flag}` given twice"));
        }
    }
    Ok((values, probe))
}

/// Loads the GPU libraries from `<runtime>/lib`; false when one cannot be loaded.
fn load_gpu_libraries(lib: &Path) -> bool {
    // A library can need one listed after it; load what can be loaded until nothing
    // more can, so the list need not follow every dependency exactly.
    let mut pending: Vec<&str> = GPU_LIBRARIES.to_vec();
    while !pending.is_empty() {
        let before = pending.len();
        pending.retain(|name| ort::util::preload_dylib(lib.join(name)).is_err());
        if pending.len() == before {
            eprintln!("astarot-rvc-worker: {} GPU libraries could not be loaded from the runtime", pending.len());
            return false;
        }
    }
    true
}

/// The folder with the DirectML build of ONNX Runtime: `--directml`, else `<runtime>/lib`
/// when it is that build (the app's "ONNX Runtime · DirectML" runtime, which its setup probes
/// with this worker). Windows only.
fn directml_folder(lib: &Path, given: Option<&Path>) -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    given.map(Path::to_path_buf).or_else(|| lib.join(DIRECTML_LIBRARY).is_file().then(|| lib.to_path_buf()))
}

/// Which library folder to load and the device to try, before anything is loaded. CUDA needs
/// its libraries loaded first, so trying them is part of choosing.
fn plan(choice: Choice, lib: &Path, has_cuda: bool, directml: Option<&Path>, mut cuda_loads: impl FnMut() -> bool) -> Result<(PathBuf, Device), Failure> {
    Ok(match choice {
        Choice::Cpu => (lib.to_path_buf(), Device::Cpu),
        Choice::Cuda if !has_cuda => return Err(Failure::GpuUnavailable),
        Choice::Cuda if !cuda_loads() => return Err(Failure::RuntimeIncomplete),
        Choice::Cuda => (lib.to_path_buf(), Device::Cuda),
        Choice::DirectMl => (directml.ok_or(Failure::DirectMlUnavailable)?.to_path_buf(), Device::DirectMl),
        Choice::Auto if has_cuda && cuda_loads() => (lib.to_path_buf(), Device::Cuda),
        Choice::Auto => match directml {
            Some(folder) => (folder.to_path_buf(), Device::DirectMl),
            None => (lib.to_path_buf(), Device::Cpu),
        },
    })
}

/// Loads `DirectML.dll` from `folder` when it is there (the DirectML build of ONNX Runtime
/// needs it loaded first: the loader does not look beside `onnxruntime.dll`). False when it is
/// there and cannot be loaded.
fn preload_directml(folder: &Path) -> bool {
    let library = folder.join(DIRECTML_LIBRARY);
    !library.is_file() || ort::util::preload_dylib(&library).is_ok()
}

/// Whether `Auto` passes over DirectML for the GPU it would run on: an integrated one, which
/// cannot convert in real time (an Intel Iris Xe took about 240 ms for a 40 ms block,
/// 2026-11-20). A GPU ONNX Runtime does not describe is taken.
fn auto_skips_directml(adapter: Option<&backend::DirectMlAdapter>) -> bool {
    adapter.is_some_and(|adapter| adapter.discrete == Some(false))
}

#[cfg(windows)]
fn directml_on_integrated_gpu() -> bool {
    match backend::directml_adapters() {
        Ok(adapters) => auto_skips_directml(backend::preferred_adapter(&adapters)),
        Err(error) => {
            eprintln!("astarot-rvc-worker: the GPUs could not be listed: {error}");
            false
        }
    }
}

#[cfg(not(windows))]
fn directml_on_integrated_gpu() -> bool {
    false
}

/// Loads ONNX Runtime and decides where to convert ([`Choice`], [`plan`]): CUDA from
/// `<runtime>/lib` with the CUDA libraries, DirectML from the DirectML folder, the CPU from
/// either. Under `Auto`, a GPU whose check graph cannot run leaves the CPU of the same library,
/// and so does DirectML on an integrated GPU when `conversion` is set (a conversion is starting;
/// a probe only asks whether the device runs, for the translation too).
fn load_runtime(runtime: &Path, directml: Option<&Path>, choice: Choice, conversion: bool) -> Result<Device, Failure> {
    let lib = runtime.join("lib");
    let directml = directml_folder(&lib, directml);
    let (mut folder, mut device) = plan(choice, &lib, lib.join(CUDA_PROVIDER).is_file(), directml.as_deref(), || load_gpu_libraries(&lib))?;
    if !preload_directml(&folder) {
        eprintln!("astarot-rvc-worker: DirectML could not be loaded");
        if choice != Choice::Auto || device != Device::DirectMl || !preload_directml(&lib) {
            return Err(Failure::RuntimeIncomplete);
        }
        (folder, device) = (lib.clone(), Device::Cpu);
    }
    backend::load_runtime(&folder.join(ORT_LIBRARY)).map_err(|error| {
        eprintln!("astarot-rvc-worker: ONNX Runtime could not be loaded: {error}");
        Failure::RuntimeIncomplete
    })?;
    if conversion && choice == Choice::Auto && device == Device::DirectMl && directml_on_integrated_gpu() {
        eprintln!("astarot-rvc-worker: DirectML would run on an integrated GPU; converting on the CPU");
        device = Device::Cpu;
    }
    if device.is_gpu() {
        // Whether the GPU works at all, before any model: GPU errors from a real model's
        // session cannot be told apart from problems with the model.
        if let Err(error) = backend::check_device(device) {
            eprintln!("astarot-rvc-worker: GPU ({device:?}): {error}");
            match (choice, &error) {
                (Choice::Auto, Error::DeviceUnavailable(_)) => device = Device::Cpu,
                _ => return Err(classify(&error, device, Failure::RuntimeIncomplete)),
            }
        }
    }
    if device == Device::Cpu {
        backend::check_device(Device::Cpu).map_err(|error| {
            eprintln!("astarot-rvc-worker: CPU: {error}");
            Failure::RuntimeIncomplete
        })?;
    }
    Ok(device)
}

/// What a loading error says about what the user can do.
fn classify(error: &Error, device: Device, otherwise: Failure) -> Failure {
    match error {
        Error::DeviceUnavailable(_) if device == Device::DirectMl => Failure::DirectMlUnavailable,
        Error::DeviceUnavailable(_) => Failure::GpuUnavailable,
        Error::Io(_) => Failure::ModelMissing,
        _ => otherwise,
    }
}

/// Where and how the stream runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Profile {
    device: Device,
    layout: Layout,
    packets: Packets,
}

impl Profile {
    fn of(device: Device, packets: Packets) -> Self {
        Profile { device, layout: if device.is_gpu() { packets.gpu_layout() } else { CPU_LAYOUT }, packets }
    }

    /// Packets answered with silence before the first converted audio is due (CPU): the
    /// block being filled, a block's time for converting it, and one packet of margin.
    fn lead_packets(&self) -> usize {
        if self.device.is_gpu() {
            0
        } else {
            (2 * self.layout.block_samples()).div_ceil(self.packets.input()) + 1
        }
    }

    /// What the worker adds between a sample in and its converted counterpart out, in
    /// milliseconds: the stream's crossfade and search, the two rate conversions, and on
    /// the CPU the fixed lead. The owner's own buffering of a packet and the round trip are
    /// not included.
    fn latency_ms(&self, model_rate: u32) -> u64 {
        let layout = self.layout;
        let stream = ((layout.crossfade + layout.search) * 10) as f64;
        let rates = StreamResampler::new(RATE, INPUT_RATE).delay() as f64 * 1000.0 / RATE as f64 + StreamResampler::new(model_rate, RATE).delay() as f64 * 1000.0 / model_rate as f64;
        let lead = (self.lead_packets() * self.packets.input()) as f64 * 1000.0 / INPUT_RATE as f64;
        (stream + rates + lead).round() as u64
    }
}

fn load(arguments: &Arguments) -> Result<(Stream, Profile), Failure> {
    if !arguments.model.is_file() || arguments.index.as_ref().is_some_and(|index| !index.is_file()) {
        return Err(Failure::ModelMissing);
    }
    let assets = arguments.runtime.join("assets");
    let (hubert, rmvpe) = (assets.join("hubert_base"), assets.join("rmvpe").join("rmvpe.onnx"));
    if !hubert.join("pytorch_model.bin").is_file() || !hubert.join("config.json").is_file() || !rmvpe.is_file() {
        return Err(Failure::RuntimeIncomplete);
    }
    let device = load_runtime(&arguments.runtime, arguments.directml.as_deref(), arguments.device, true)?;
    // On the GPU the CPU side of a block is small; one thread per session kept the same
    // block times with a third less CPU and 8 threads instead of 77 (README, "Application
    // worker").
    backend::set_intra_threads(arguments.threads.or(Some(if device.is_gpu() { GPU_INTRA_THREADS } else { cpu_intra_threads() })));
    let log = |what: &str, error: &Error| eprintln!("astarot-rvc-worker: {what}: {error}");
    let model = VoiceModel::load(&arguments.model).map_err(|error| {
        log("voice model", &error);
        match error {
            Error::Unsupported { .. } => Failure::FormatInvalid,
            ref other => classify(other, device, Failure::CheckpointIncomplete),
        }
    })?;
    if ![32_000, 40_000, 48_000].contains(&model.config.sample_rate) {
        return Err(Failure::FormatInvalid);
    }
    // The index is only read when it is used, as before.
    let index = match (&arguments.index, arguments.index_rate > 0.0) {
        (Some(path), true) => {
            let index = FeatureIndex::load(path).map_err(|error| {
                log("index", &error);
                Failure::IndexFailed
            })?;
            if index.dim() != model.version.feature_dim() || index.len() < 8 {
                return Err(Failure::IndexFailed);
            }
            Some(index)
        }
        _ => None,
    };
    // The networks' sessions. The GPU first: the error that says the most comes from the first
    // session.
    let networks = |index: Option<FeatureIndex>| -> Result<Converter, Failure> {
        let synthesizer = Synthesizer::new(&model, device).map_err(|error| {
            log("synthesizer", &error);
            classify(&error, device, Failure::CheckpointIncomplete)
        })?;
        let features = FeatureExtractor::from_checkpoint(&hubert, device).map_err(|error| {
            log("feature extractor", &error);
            classify(&error, device, Failure::CheckpointIncomplete)
        })?;
        let pitch = Rmvpe::load(&rmvpe, device).map_err(|error| {
            log("pitch extractor", &error);
            classify(&error, device, Failure::RuntimeIncomplete)
        })?;
        Ok(Converter { features, pitch: Box::new(pitch), synthesizer, index, version: model.version })
    };
    let converter = networks(index)?;
    let stream_for = |converter: Converter, profile: Profile| {
        let options = StreamOptions { transpose: arguments.pitch, index_rate: arguments.index_rate, speaker: 0, noise: NoiseMode::Random, layout: profile.layout, highpass: arguments.highpass };
        Stream::new(converter, options).map_err(|error| {
            log("stream", &error);
            Failure::IndexFailed
        })
    };
    let conversion_failed = |error: Error| {
        log("conversion", &error);
        Failure::CheckpointIncomplete
    };
    let (stream, profile) = match arguments.packets {
        Some(packets) => {
            let profile = Profile::of(device, packets);
            (stream_for(converter, profile)?, profile)
        }
        None if device.is_gpu() => {
            // `--block-ms auto` (#531). The length chosen before for this voice model on this GPU
            // is used again without timing, unless the user chose Automatic again since.
            let cache = arguments.block_cache.as_deref().and_then(|path| BlockCache::for_start(path, arguments, device));
            if let Some(ms) = cache.as_ref().filter(|cache| !cache.timing_asked()).and_then(BlockCache::chosen) {
                eprintln!("astarot-rvc-worker: converting in {ms} ms blocks, chosen before for this voice model on this GPU");
                let profile = Profile::of(device, Packets::of(ms).expect("a valid block"));
                return finish(stream_for(converter, profile)?, profile);
            }
            // The GPU's time for a block of the shortest length, back to back, then the shortest
            // length it converts in time with room to spare.
            let first = Profile::of(device, Packets::of(AUTO_BLOCK_MS[0]).expect("a valid block"));
            let mut stream = stream_for(converter, first)?;
            let time = gpu_block_time(&mut stream).map_err(conversion_failed)?;
            let ms = auto_block_ms(time);
            eprintln!("astarot-rvc-worker: a {} ms block took {:.1} ms on the GPU; converting in {ms} ms blocks", AUTO_BLOCK_MS[0], time.as_secs_f64() * 1000.0);
            if let Some(cache) = &cache {
                // This start's entry is the new length; the request to time again is answered.
                if cache.remember(ms) {
                    cache.timed_again();
                }
            }
            if ms == AUTO_BLOCK_MS[0] {
                (stream, first)
            } else {
                // DirectML sessions that ran one block length are not given another: they
                // converted blocks of a second length four to six times slower than fresh ones.
                // CUDA's did not (about 3 s of loading saved).
                let converter = stream.into_converter();
                let converter = if device == Device::DirectMl {
                    let Converter { index, features, pitch, synthesizer, .. } = converter;
                    // The old sessions go before the new ones take the GPU's memory.
                    drop((features, pitch, synthesizer));
                    networks(index)?
                } else {
                    converter
                };
                let profile = Profile::of(device, Packets::of(ms).expect("a valid block"));
                (stream_for(converter, profile)?, profile)
            }
        }
        None => {
            // The CPU converts 0.5 s blocks of its own whatever the packets (`CPU_LAYOUT`).
            let profile = Profile::of(device, Packets::of(AUTO_CPU_PACKET_MS).expect("a valid block"));
            (stream_for(converter, profile)?, profile)
        }
    };
    finish(stream, profile)
}

/// The CPU's speed check before `ready`; a GPU's stream is ready as it is.
fn finish(mut stream: Stream, profile: Profile) -> Result<(Stream, Profile), Failure> {
    if profile.device == Device::Cpu {
        let fastest = cpu_block_time(&mut stream).map_err(|error| {
            eprintln!("astarot-rvc-worker: conversion: {error}");
            Failure::CheckpointIncomplete
        })?;
        if !cpu_keeps_up(fastest, profile.layout) {
            eprintln!("astarot-rvc-worker: a {} ms block took {} ms on the CPU", profile.layout.block * 10, fastest.as_millis());
            return Err(Failure::CpuTooSlow);
        }
    }
    Ok((stream, profile))
}

/// `--block-cache <file>`: the lengths `--block-ms auto` chose on a GPU, so that a later start
/// with the same voice model on the same GPU converts in the same length without timing the GPU
/// again (#531). An entry is found by a hash of the voice model (path, size and modification
/// time), the index when it is used, the device, the GPU's name, the ONNX Runtime library and
/// the CPU threads. The file holds only those hashes and the lengths: no path, model or GPU name.
/// A file that cannot be read or written only means the GPU is timed again.
///
/// The application asks for the GPU to be timed again by putting a file beside the cache with
/// its name and `.remeasure` (`rvc-block-lengths.remeasure`) when the user chooses Automatic
/// again. The next start that would use a kept length times the GPU instead, keeps the new
/// length for its own voice model and GPU, and removes that file; the other entries stay.
struct BlockCache {
    path: PathBuf,
    key: String,
}

/// The entries kept; past that the file starts again from the newest.
const BLOCK_CACHE_ENTRIES: usize = 64;
/// Changes when the choice changes (`AUTO_BLOCK_MS`, `AUTO_HEADROOM` or how the GPU is timed), so
/// lengths chosen another way are not used.
const BLOCK_CACHE_VERSION: u64 = 1;

impl BlockCache {
    /// The entry of this start, when the GPU can be told apart from another.
    fn for_start(path: &Path, arguments: &Arguments, device: Device) -> Option<Self> {
        Some(BlockCache { path: path.to_path_buf(), key: Self::key(&backend::gpu_name(device)?, arguments, device)? })
    }

    /// The entry's key: `None` when a file it depends on cannot be read.
    fn key(gpu: &str, arguments: &Arguments, device: Device) -> Option<String> {
        let stamp = |file: &Path| -> Option<String> {
            let meta = std::fs::metadata(file).ok()?;
            let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
            Some(format!("{}:{}:{modified}", file.display(), meta.len()))
        };
        let index = match (&arguments.index, arguments.index_rate > 0.0) {
            (Some(index), true) => stamp(index)?,
            _ => "-".into(),
        };
        let library = match device {
            Device::DirectMl => arguments.directml.as_deref().map(|dir| dir.join(ORT_LIBRARY)),
            _ => Some(arguments.runtime.join("lib").join(ORT_LIBRARY)),
        };
        let text = format!("{BLOCK_CACHE_VERSION}|{device:?}|{gpu}|{}|{index}|{}|{:?}", stamp(&arguments.model)?, library.as_deref().and_then(stamp).unwrap_or_default(), arguments.threads);
        Some(format!("{:016x}", fnv1a(text.as_bytes())))
    }

    fn entries(&self) -> Map<String, Value> {
        let read = std::fs::read(&self.path).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
        match read {
            Some(Value::Object(mut file)) if file.get("version") == Some(&Value::from(BLOCK_CACHE_VERSION)) => match file.remove("blocks") {
                Some(Value::Object(blocks)) => blocks,
                _ => Map::new(),
            },
            _ => Map::new(),
        }
    }

    /// The length chosen before, when it is one `--block-ms auto` chooses from.
    fn chosen(&self) -> Option<u32> {
        let ms = self.entries().get(&self.key)?.get("block_ms")?.as_u64()?;
        u32::try_from(ms).ok().filter(|ms| AUTO_BLOCK_MS.contains(ms))
    }

    /// The file that asks for the GPU to be timed again.
    fn timing_request(&self) -> PathBuf {
        self.path.with_extension("remeasure")
    }

    /// Whether the user asked for the GPU to be timed again (chose Automatic again).
    fn timing_asked(&self) -> bool {
        self.timing_request().exists()
    }

    /// The GPU was timed again and the new length kept: the request is answered.
    fn timed_again(&self) {
        if self.timing_asked() && std::fs::remove_file(self.timing_request()).is_err() {
            eprintln!("astarot-rvc-worker: the request to time the GPU again could not be removed");
        }
    }

    /// Keeps `ms` for this start's entry, written whole into a new file that then replaces the old.
    /// False when it could not be written.
    fn remember(&self, ms: u32) -> bool {
        let mut blocks = self.entries();
        if blocks.len() >= BLOCK_CACHE_ENTRIES && !blocks.contains_key(&self.key) {
            blocks.clear();
        }
        blocks.insert(self.key.clone(), Value::Object(object(&[("block_ms", ms.into())])));
        let file = object(&[("version", BLOCK_CACHE_VERSION.into()), ("blocks", Value::Object(blocks))]);
        let partial = self.path.with_extension("json.partial");
        let written = serde_json::to_vec_pretty(&Value::Object(file)).ok().is_some_and(|bytes| std::fs::write(&partial, bytes).is_ok()) && std::fs::rename(&partial, &self.path).is_ok();
        if !written {
            let _ = std::fs::remove_file(&partial);
            eprintln!("astarot-rvc-worker: the chosen block length could not be kept");
        }
        written
    }
}

/// FNV-1a, 64 bits: the same hash on every platform and in every version.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &byte| (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3))
}

/// A 220 Hz tone at -20 dB.
fn tone(count: usize, rate: u32) -> Vec<f32> {
    (0..count).map(|n| 0.1 * (n as f32 * 2.0 * std::f32::consts::PI * 220.0 / rate as f32).sin()).collect()
}

/// The CPU's time for one stream block: one block settles the networks' first runs, then the
/// fastest of [`CPU_TIMED_BLOCKS`]. The stream is reset afterwards.
fn cpu_block_time(stream: &mut Stream) -> Result<Duration, Error> {
    let block = tone(stream.options().layout.block_samples(), INPUT_RATE);
    stream.process(&block)?;
    let mut fastest = Duration::MAX;
    for _ in 0..CPU_TIMED_BLOCKS {
        let started = Instant::now();
        stream.process(&block)?;
        fastest = fastest.min(started.elapsed());
    }
    stream.reset();
    Ok(fastest)
}

/// Whether the CPU converts a block in less time than the block lasts.
fn cpu_keeps_up(block_time: Duration, layout: Layout) -> bool {
    block_time < Duration::from_millis(layout.block as u64 * 10)
}

/// The GPU's time for one packet's stream block, converted back to back: one block settles
/// the networks' first runs at this length, then the median of [`AUTO_TIMED_BLOCKS`]. The
/// stream is reset afterwards.
fn gpu_block_time(stream: &mut Stream) -> Result<Duration, Error> {
    let block = tone(stream.options().layout.block_samples(), INPUT_RATE);
    stream.process(&block)?;
    let mut times = Vec::with_capacity(AUTO_TIMED_BLOCKS);
    for _ in 0..AUTO_TIMED_BLOCKS {
        let started = Instant::now();
        stream.process(&block)?;
        times.push(started.elapsed());
    }
    stream.reset();
    times.sort();
    Ok(times[times.len() / 2])
}

/// Whether a GPU that converts a block back to back in `block_time` keeps up with packets of
/// this length at the microphone's pace: [`AUTO_HEADROOM`] times the time fits in the packet.
fn keeps_up_with_headroom(block_time: Duration, packets: Packets) -> bool {
    block_time.as_secs_f64() * AUTO_HEADROOM <= f64::from(packets.ms) / 1000.0
}

/// `--block-ms auto` on a GPU that converts the shortest block in `block_time`: the shortest of
/// [`AUTO_BLOCK_MS`] it keeps up with, the longest when none. A longer block's time is the
/// shortest one's: it takes little longer, as most of the work is the 2 s of context every block
/// carries (48 to 58 ms with CUDA and 38 to 53 ms with DirectML from 20 to 200 ms on one GPU).
fn auto_block_ms(block_time: Duration) -> u32 {
    let fits = |ms: &u32| keeps_up_with_headroom(block_time, Packets::of(*ms).expect("a valid block"));
    AUTO_BLOCK_MS.into_iter().find(fits).unwrap_or(AUTO_BLOCK_MS[AUTO_BLOCK_MS.len() - 1])
}

/// The stream with its rate conversions: 48 kHz in and out, 16 kHz and the model's rate
/// inside.
struct Live {
    stream: Stream,
    input: StreamResampler,
    output: StreamResampler,
    frames: usize,
}

impl Live {
    fn new(stream: Stream, packets: Packets) -> Self {
        let rate = stream.sample_rate();
        Live { stream, input: StreamResampler::new(RATE, INPUT_RATE), output: StreamResampler::new(rate, RATE), frames: packets.frames() }
    }

    fn reset(&mut self) {
        self.stream.reset();
        self.input.reset();
        self.output.reset();
    }

    /// One packet in, its converted packet out (GPU).
    fn convert(&mut self, samples: &[f32]) -> Result<Vec<f32>, Stop> {
        let low = self.input.process(samples);
        let output = convert_block(&mut self.stream, &mut self.output, &low)?;
        if output.len() != self.frames {
            return Err(Stop("vc_conversion_invalid"));
        }
        Ok(output)
    }
}

/// One stream block of 16 kHz input to 48 kHz output.
fn convert_block(stream: &mut Stream, output: &mut StreamResampler, low: &[f32]) -> Result<Vec<f32>, Stop> {
    let converted = stream.process(low).map_err(|error| {
        eprintln!("astarot-rvc-worker: conversion failed: {error}");
        Stop("vc_conversion_invalid")
    })?;
    let converted = output.process(&converted);
    if converted.iter().any(|sample| !sample.is_finite()) {
        return Err(Stop("vc_conversion_invalid"));
    }
    Ok(converted)
}

/// What the converting thread sends: converted audio at its place in the output (block
/// `n` starts at sample `n * block`), or the number of a block it dropped unconverted.
enum Converted {
    Block(u64, Vec<f32>),
    Dropped,
    Failed(Stop),
}

/// CPU: the converting thread. Takes 16 kHz input as it comes, converts whole blocks and
/// sends each with its number. When more than `CPU_BACKLOG_BLOCKS` wait, the oldest is
/// dropped unconverted; its number is skipped, so later blocks keep their place.
fn convert_in_background(mut stream: Stream, input: mpsc::Receiver<Vec<f32>>, output: mpsc::Sender<Converted>) {
    let block = stream.options().layout.block_samples();
    let mut resampler = StreamResampler::new(stream.sample_rate(), RATE);
    let mut pending: VecDeque<f32> = VecDeque::new();
    let mut number = 0u64;
    while let Ok(chunk) = input.recv() {
        pending.extend(chunk);
        while let Ok(chunk) = input.try_recv() {
            pending.extend(chunk);
        }
        while pending.len() >= CPU_BACKLOG_BLOCKS * block {
            pending.drain(..block);
            number += 1;
            if output.send(Converted::Dropped).is_err() {
                return;
            }
        }
        while pending.len() >= block {
            let low: Vec<f32> = pending.drain(..block).collect();
            let (message, failed) = match convert_block(&mut stream, &mut resampler, &low) {
                Ok(audio) => (Converted::Block(number, audio), false),
                Err(stop) => (Converted::Failed(stop), true),
            };
            if output.send(message).is_err() || failed {
                return;
            }
            number += 1;
            // Whatever arrived meanwhile counts toward the backlog before the next block.
            while let Ok(chunk) = input.try_recv() {
                pending.extend(chunk);
            }
            if pending.len() >= CPU_BACKLOG_BLOCKS * block {
                break;
            }
        }
    }
}

/// CPU: the answers to the packets, a fixed number of output samples after the input,
/// filled from what the converting thread has finished. Positions whose audio is not
/// there in time are silence; audio that comes later than its place is dropped.
struct Playout {
    lead_packets: usize,
    block: u64,
    /// 48 kHz samples per packet.
    frames: usize,
    packets: usize,
    /// Output position of `buffer[0]`; everything before it has been answered.
    start: u64,
    buffer: VecDeque<f32>,
}

impl Playout {
    fn new(lead_packets: usize, block: usize, frames: usize) -> Self {
        Playout { lead_packets, block: block as u64, frames, packets: 0, start: 0, buffer: VecDeque::new() }
    }

    /// Places a converted block; false when part of it came after its place was answered.
    fn add(&mut self, number: u64, audio: Vec<f32>) -> bool {
        let begin = number * self.block;
        // What has been answered already is gone.
        let answered = self.start.saturating_sub(begin) as usize;
        if answered >= audio.len() {
            return false;
        }
        let offset = (begin + answered as u64 - self.start) as usize;
        let audio = &audio[answered..];
        if self.buffer.len() < offset + audio.len() {
            self.buffer.resize(offset + audio.len(), 0.0);
        }
        for (slot, &sample) in self.buffer.range_mut(offset..offset + audio.len()).zip(audio) {
            *slot = sample;
        }
        answered == 0
    }

    /// The next packet's audio.
    fn next(&mut self) -> Vec<f32> {
        self.packets += 1;
        if self.packets <= self.lead_packets {
            return vec![0.0; self.frames];
        }
        let take = self.frames.min(self.buffer.len());
        let mut output: Vec<f32> = self.buffer.drain(..take).collect();
        output.resize(self.frames, 0.0);
        self.start += self.frames as u64;
        output
    }
}

fn encode(header: &Map<String, Value>, pcm: &[u8]) -> Vec<u8> {
    let mut header = header.clone();
    header.insert("pcm_bytes".into(), Value::from(pcm.len()));
    let text = serde_json::to_vec(&header).expect("a JSON object always serialises");
    let mut packet = Vec::with_capacity(8 + text.len() + pcm.len());
    packet.extend_from_slice(b"VVC1");
    packet.extend_from_slice(&(text.len() as u32).to_le_bytes());
    packet.extend_from_slice(&text);
    packet.extend_from_slice(pcm);
    packet
}

fn write_packet(output: &mut impl Write, header: &Map<String, Value>, pcm: &[u8]) -> Result<(), Stop> {
    output.write_all(&encode(header, pcm)).and_then(|_| output.flush()).map_err(|_| Stop("vc_worker_output_closed"))
}

fn object(pairs: &[(&str, Value)]) -> Map<String, Value> {
    pairs.iter().map(|(key, value)| (key.to_string(), value.clone())).collect()
}

/// Reads one packet. `Ok(None)` is a clean end of input.
fn read_packet(input: &mut impl Read) -> Result<Option<Packet>, Stop> {
    let mut prefix = [0u8; 8];
    match input.read_exact(&mut prefix) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(_) => return Err(Stop("vc_worker_eof")),
    }
    let length = u32::from_le_bytes(prefix[4..].try_into().unwrap()) as usize;
    if &prefix[..4] != b"VVC1" || !(1..=MAX_HEADER).contains(&length) {
        return Err(Stop("vc_packet_invalid"));
    }
    let mut text = vec![0u8; length];
    input.read_exact(&mut text).map_err(|_| Stop("vc_worker_eof"))?;
    let header: Map<String, Value> = serde_json::from_slice(&text).map_err(|_| Stop("vc_packet_invalid"))?;
    let size = header.get("pcm_bytes").and_then(Value::as_u64).ok_or(Stop("vc_packet_invalid"))? as usize;
    if size > MAX_PCM_BYTES || !size.is_multiple_of(2) {
        return Err(Stop("vc_packet_invalid"));
    }
    let mut pcm = vec![0u8; size];
    input.read_exact(&mut pcm).map_err(|_| Stop("vc_worker_eof"))?;
    Ok(Some((header, pcm)))
}

fn integer(header: &Map<String, Value>, key: &str) -> Option<u64> {
    header.get(key).and_then(Value::as_u64)
}

/// The same checks as `protocol.require_input`, except the age of the block, which the
/// owner checks against its own clock when the output arrives.
fn require_input(header: &Map<String, Value>, pcm: &[u8], session: &str, sequence: u64, packets: Packets) -> Result<(), Stop> {
    let start = integer(header, "start_ns").filter(|&start| start > 0 && start < 1 << 63);
    let valid = header.len() == 8
        && header.get("type") == Some(&Value::from("input"))
        && header.get("session") == Some(&Value::from(session))
        && integer(header, "sequence") == Some(sequence)
        && start.is_some()
        && integer(header, "end_ns") == start.map(|start| start + packets.ns())
        && integer(header, "rate") == Some(RATE as u64)
        && integer(header, "channels") == Some(1)
        && integer(header, "pcm_bytes") == Some(packets.bytes() as u64)
        && pcm.len() == packets.bytes();
    if valid {
        Ok(())
    } else {
        Err(Stop("vc_input_invalid"))
    }
}

fn to_samples(pcm: &[u8]) -> Vec<f32> {
    pcm.as_chunks::<2>().0.iter().map(|&pair| i16::from_le_bytes(pair) as f32 / 32_768.0).collect()
}

fn to_pcm(samples: &[f32]) -> Vec<u8> {
    samples.iter().flat_map(|sample| ((sample * 32_768.0).round().clamp(-32_768.0, 32_767.0) as i16).to_le_bytes()).collect()
}

/// How packets are answered. There is one for the worker's lifetime, so the sizes of
/// the two kinds do not matter.
#[allow(clippy::large_enum_variant)]
enum Answers {
    /// GPU: each packet converted before it is answered.
    Direct(Live),
    /// CPU: packets go to the converting thread; answers come from `Playout`.
    Background { input: StreamResampler, to_thread: mpsc::Sender<Vec<f32>>, from_thread: mpsc::Receiver<Converted>, playout: Playout, late: VecDeque<bool> },
}

impl Answers {
    fn new(mut live: Live, profile: Profile) -> Result<Self, Stop> {
        if profile.device.is_gpu() {
            let block = tone(profile.packets.frames(), RATE);
            for _ in 0..WARMUP_BLOCKS {
                live.convert(&block)?;
            }
            live.reset();
            return Ok(Answers::Direct(live));
        }
        // The CPU's first runs were settled when its speed was taken (`cpu_block_time`).
        let Live { stream, .. } = live;
        let (to_thread, thread_input) = mpsc::channel();
        let (thread_output, from_thread) = mpsc::channel();
        let output_block = profile.layout.block_samples() * 3;
        std::thread::spawn(move || convert_in_background(stream, thread_input, thread_output));
        Ok(Answers::Background { input: StreamResampler::new(RATE, INPUT_RATE), to_thread, from_thread, playout: Playout::new(profile.lead_packets(), output_block, profile.packets.frames()), late: VecDeque::new() })
    }

    fn convert(&mut self, samples: &[f32]) -> Result<Vec<f32>, Stop> {
        match self {
            Answers::Direct(live) => live.convert(samples),
            Answers::Background { input, to_thread, from_thread, playout, late } => {
                to_thread.send(input.process(samples)).map_err(|_| Stop("vc_conversion_invalid"))?;
                loop {
                    let on_time = match from_thread.try_recv() {
                        Ok(Converted::Block(number, audio)) => playout.add(number, audio),
                        Ok(Converted::Dropped) => false,
                        Ok(Converted::Failed(stop)) => return Err(stop),
                        Err(mpsc::TryRecvError::Empty) => break,
                        Err(mpsc::TryRecvError::Disconnected) => return Err(Stop("vc_conversion_invalid")),
                    };
                    late.push_back(!on_time);
                    if late.len() > CPU_LATE_WINDOW {
                        late.pop_front();
                    }
                    if late.iter().filter(|&&late| late).count() * 2 > CPU_LATE_WINDOW {
                        return Err(Stop(OVERRUN));
                    }
                }
                Ok(playout.next())
            }
        }
    }
}

fn serve(live: Live, profile: Profile, session: &str) -> Result<(), Stop> {
    let mut output = std::io::stdout().lock();
    let latency_ms = profile.latency_ms(live.stream.sample_rate());
    let mut answers = Answers::new(live, profile)?;
    // Reading blocks on its own thread lets the main thread give up on a silent owner,
    // as the Python worker did (10 s for the first block, 1 s after that).
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        loop {
            let packet = read_packet(&mut input);
            let end = !matches!(packet, Ok(Some(_)));
            if sender.send(packet).is_err() || end {
                return;
            }
        }
    });
    let ready = object(&[
        ("type", "ready".into()),
        ("protocol", 1.into()),
        ("session", session.into()),
        ("engine", "rvc".into()),
        ("profile", (if profile.device.is_gpu() { "low" } else { "cpu" }).into()),
        ("rate", RATE.into()),
        ("channels", 1.into()),
        ("block_frames", profile.packets.frames().into()),
        ("latency_ms", latency_ms.into()),
    ]);
    write_packet(&mut output, &ready, &[])?;
    let mut sequence = 0u64;
    loop {
        let wait = Duration::from_secs(if sequence == 0 { 10 } else { 1 });
        let (header, pcm) = match receiver.recv_timeout(wait) {
            Ok(Ok(Some(packet))) => packet,
            Ok(Ok(None)) => return Ok(()),
            Ok(Err(stop)) => return Err(stop),
            Err(mpsc::RecvTimeoutError::Timeout) => return Err(Stop("vc_worker_stalled")),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(Stop("vc_worker_eof")),
        };
        require_input(&header, &pcm, session, sequence, profile.packets)?;
        let converted = to_pcm(&answers.convert(&to_samples(&pcm))?);
        // The owner refuses an output identical to a non-silent input; say so first.
        if converted == pcm && pcm.iter().any(|&byte| byte != 0) {
            return Err(Stop("vc_passthrough_forbidden"));
        }
        // Exact silence is the CPU's lead or a block that came too late; converted audio is
        // never exactly zero.
        let state = if converted.iter().all(|&byte| byte == 0) { "vad_silence" } else { "converted" };
        let mut result = header.clone();
        result.insert("type".into(), "output".into());
        result.insert("state".into(), state.into());
        write_packet(&mut output, &result, &converted)?;
        sequence += 1;
    }
}

/// `--probe`: whether the runtime's libraries load and a session runs on the device
/// (`cuda`, the default, `directml`, `cpu`, or `auto`). The DirectML folder is the runtime's
/// own `lib/` when that holds the DirectML build. Exit 3 when the GPU cannot be used (with
/// `auto`: the CPU can, so conversion will run there), 4 when the runtime is incomplete.
fn probe(runtime: &Path, choice: Choice) -> ExitCode {
    match load_runtime(runtime, None, choice, false) {
        Ok(Device::Cpu) if choice == Choice::Auto => {
            eprintln!("astarot-rvc-worker: the GPU cannot be used; conversion will run on the CPU");
            ExitCode::from(3)
        }
        Ok(_) => ExitCode::SUCCESS,
        Err(failure) => {
            eprintln!("astarot-rvc-worker: {}", failure.code());
            ExitCode::from(if matches!(failure, Failure::GpuUnavailable | Failure::DirectMlUnavailable) { 3 } else { 4 })
        }
    }
}

fn main() -> ExitCode {
    // SAFETY: first thing in main, before any other thread starts.
    unsafe { astarot_onnx_runtime::disable_telemetry_for_process() };
    let (values, probing) = match options() {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("astarot-rvc-worker: {message}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    if probing {
        let device = match values.get("device").map(String::as_str) {
            None | Some("cuda") => Some(Choice::Cuda),
            Some("directml") => Some(Choice::DirectMl),
            Some("cpu") => Some(Choice::Cpu),
            Some("auto") => Some(Choice::Auto),
            Some(_) => None,
        };
        let expected = 1 + values.contains_key("device") as usize;
        return match (values.get("runtime"), device) {
            (Some(runtime), Some(device)) if values.len() == expected => probe(Path::new(runtime), device),
            _ => {
                eprintln!("{USAGE}");
                ExitCode::from(2)
            }
        };
    }
    let arguments = match parse(values) {
        Ok(arguments) => arguments,
        Err(message) => {
            eprintln!("astarot-rvc-worker: {message}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let (stream, profile) = match load(&arguments) {
        Ok(loaded) => loaded,
        Err(failure) => {
            // Say why before exiting; the owner shows the code instead of "the worker ended".
            let failed = object(&[("type", "failed".into()), ("protocol", 1.into()), ("session", arguments.session.as_str().into()), ("code", failure.code().into())]);
            let _ = write_packet(&mut std::io::stdout().lock(), &failed, &[]);
            return ExitCode::from(1);
        }
    };
    match serve(Live::new(stream, profile.packets), profile, &arguments.session) {
        Ok(()) => ExitCode::SUCCESS,
        Err(Stop(code)) => {
            eprintln!("astarot-rvc-worker: stopped: {code}");
            if code == OVERRUN {
                // Instead of the next answer: the owner stops with this code.
                let failed = object(&[("type", "failed".into()), ("protocol", 1.into()), ("session", arguments.session.as_str().into()), ("code", code.into())]);
                let _ = write_packet(&mut std::io::stdout().lock(), &failed, &[]);
            }
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(session: &str, sequence: u64, start: u64, packets: Packets) -> Map<String, Value> {
        object(&[
            ("type", "input".into()),
            ("session", session.into()),
            ("sequence", sequence.into()),
            ("start_ns", start.into()),
            ("end_ns", (start + packets.ns()).into()),
            ("rate", RATE.into()),
            ("channels", 1.into()),
            ("pcm_bytes", packets.bytes().into()),
        ])
    }

    #[test]
    fn packets_round_trip_and_inputs_are_checked() {
        let session = "0123456789abcdef0123456789abcdef";
        let packets = Packets::of(80).unwrap();
        let header = input(session, 3, 1_000, packets);
        let pcm = vec![1u8; packets.bytes()];
        let packet = encode(&header, &pcm);
        let (read, data) = read_packet(&mut &packet[..]).unwrap().unwrap();
        assert_eq!(read, header);
        assert_eq!(data, pcm);
        assert!(require_input(&read, &data, session, 3, packets).is_ok());
        assert!(require_input(&read, &data, session, 4, packets).is_err());
        assert!(require_input(&read, &data, "ffffffffffffffffffffffffffffffff", 3, packets).is_err());
        // A packet of another length than the session's.
        assert!(require_input(&read, &data, session, 3, Packets::of(40).unwrap()).is_err());
        let mut extra = read.clone();
        extra.insert("more".into(), 1.into());
        assert!(require_input(&extra, &data, session, 3, packets).is_err());
        let mut late = read.clone();
        late.insert("end_ns".into(), 2_000.into());
        assert!(require_input(&late, &data, session, 3, packets).is_err());
        assert!(read_packet(&mut &b""[..]).unwrap().is_none());
        assert!(read_packet(&mut &b"XXXX\x01\0\0\0{"[..]).is_err());
        // The longest packet is read; a longer one is refused.
        let longest = Packets::of(200).unwrap();
        assert_eq!(longest.bytes(), MAX_PCM_BYTES);
        let mut too_long = input(session, 0, 1_000, longest);
        too_long.insert("pcm_bytes".into(), (MAX_PCM_BYTES + 2).into());
        assert!(read_packet(&mut &encode(&too_long, &vec![0u8; MAX_PCM_BYTES + 2])[..]).is_err());
    }

    #[test]
    fn the_gpu_converts_one_stream_block_per_packet() {
        // 80 ms: the external runtime's layout but for the crossfade, 20 ms instead of 40 ms.
        assert_eq!(Packets::of(80).unwrap().gpu_layout(), Layout { block: 8, crossfade: 2, search: 1, extra: 200 });
        assert_eq!(Packets::of(40).unwrap().gpu_layout(), Layout { block: 4, crossfade: 2, search: 1, extra: 200 });
        assert_eq!(Packets::of(20).unwrap().gpu_layout(), Layout { block: 2, crossfade: 1, search: 1, extra: 200 });
        for ms in [20, 40, 80, 200] {
            let packets = Packets::of(ms).unwrap();
            // A packet's 16 kHz input is exactly one stream block.
            assert_eq!(packets.gpu_layout().block_samples(), packets.input(), "{ms}");
        }
        for ms in [0, 10, 30, 210] {
            assert!(Packets::of(ms).is_none(), "{ms}");
        }
    }

    #[test]
    fn the_gpu_crossfade_is_half_the_block_up_to_20_ms() {
        // (packet, crossfade, crossfade and search, `latency_ms` of `ready` at 48 kHz), in ms.
        // Below 40 ms, half the block is shorter than the limit and stays.
        let expected = [(20, 10, 20, 22), (40, 20, 30, 32), (60, 20, 30, 32), (80, 20, 30, 32), (120, 20, 30, 32), (200, 20, 30, 32)];
        for (ms, crossfade, behind, latency) in expected {
            let profile = Profile::of(Device::Cuda, Packets::of(ms).unwrap());
            assert_eq!(profile.layout.crossfade * 10, crossfade, "{ms} ms");
            // The stream's own delay is the block plus the crossfade and the search.
            assert_eq!((profile.layout.latency() * 1000.0).round() as u32, ms + behind, "{ms} ms");
            assert_eq!(profile.latency_ms(48_000), latency, "{ms} ms");
            assert_eq!(Profile::of(Device::DirectMl, Packets::of(ms).unwrap()).layout, profile.layout, "{ms} ms");
        }
        for ms in (20..=200).step_by(20) {
            let layout = Packets::of(ms).unwrap().gpu_layout();
            assert!((1..=GPU_CROSSFADE_LIMIT).contains(&layout.crossfade) && 2 * layout.crossfade <= layout.block, "{ms} ms");
        }
    }

    #[test]
    fn samples_convert_like_the_python_worker() {
        assert_eq!(to_pcm(&[0.0, 1.0, -1.0, 0.5, -2.0]), [0i16, 32_767, -32_768, 16_384, -32_768].iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>());
        assert_eq!(to_samples(&16_384i16.to_le_bytes()), vec![0.5]);
    }

    #[test]
    fn the_cpu_lead_leaves_a_block_of_time_for_each_block() {
        let packets = Packets::of(80).unwrap();
        let cpu = Profile::of(Device::Cpu, packets);
        let gpu = Profile::of(Device::Cuda, packets);
        assert_eq!(gpu.lead_packets(), 0);
        // 0.5 s blocks: 2 x 8000 samples / 1280 per packet, rounded up, plus one.
        assert_eq!(cpu.lead_packets(), 14);
        assert_eq!(gpu.latency_ms(48_000), 32);
        assert_eq!(cpu.latency_ms(40_000), 1183);
        // 40 ms packets: the GPU's crossfade is as long as at 80 ms; on the CPU the blocks stay 0.5 s.
        let short = Packets::of(40).unwrap();
        assert_eq!(Profile::of(Device::Cuda, short).latency_ms(48_000), 32);
        assert_eq!(Profile::of(Device::Cpu, short).lead_packets(), 26);
        assert_eq!(Profile::of(Device::Cpu, short).layout, CPU_LAYOUT);
        // DirectML converts like CUDA: one block per packet, no lead.
        let directml = Profile::of(Device::DirectMl, short);
        assert_eq!((directml.layout, directml.lead_packets(), directml.latency_ms(48_000)), (short.gpu_layout(), 0, 32));
    }

    #[test]
    fn the_library_and_device_are_chosen_before_anything_loads() {
        let lib = Path::new("/r/lib");
        let dml = Path::new("/d/lib");
        let cuda = |loads: bool| move || loads;
        let at = |folder: &Path, device: Device| Ok((folder.to_path_buf(), device));
        // The CPU always uses the runtime's own library.
        assert_eq!(plan(Choice::Cpu, lib, true, Some(dml), cuda(true)), at(lib, Device::Cpu));
        // CUDA: the provider and its libraries, or a failure, never another device.
        assert_eq!(plan(Choice::Cuda, lib, false, Some(dml), cuda(true)), Err(Failure::GpuUnavailable));
        assert_eq!(plan(Choice::Cuda, lib, true, Some(dml), cuda(false)), Err(Failure::RuntimeIncomplete));
        assert_eq!(plan(Choice::Cuda, lib, true, None, cuda(true)), at(lib, Device::Cuda));
        // DirectML: its own folder, or a failure.
        assert_eq!(plan(Choice::DirectMl, lib, true, None, cuda(true)), Err(Failure::DirectMlUnavailable));
        assert_eq!(plan(Choice::DirectMl, lib, true, Some(dml), cuda(true)), at(dml, Device::DirectMl));
        // Auto: CUDA first (as before DirectML), then DirectML, then the CPU.
        assert_eq!(plan(Choice::Auto, lib, true, Some(dml), cuda(true)), at(lib, Device::Cuda));
        assert_eq!(plan(Choice::Auto, lib, true, Some(dml), cuda(false)), at(dml, Device::DirectMl));
        assert_eq!(plan(Choice::Auto, lib, false, Some(dml), cuda(true)), at(dml, Device::DirectMl));
        assert_eq!(plan(Choice::Auto, lib, false, None, cuda(true)), at(lib, Device::Cpu));
        assert_eq!(plan(Choice::Auto, lib, true, None, cuda(false)), at(lib, Device::Cpu));
        // The CUDA libraries are only tried when CUDA may be used.
        let mut tried = false;
        let _ = plan(Choice::DirectMl, lib, true, Some(dml), || {
            tried = true;
            true
        });
        assert!(!tried);
    }

    #[test]
    fn the_directml_folder_is_the_one_given_or_the_runtimes_own_directml_build() {
        let dir = std::env::temp_dir().join(format!("astarot-rvc-worker-dml-{}", std::process::id()));
        let lib = dir.join("lib");
        std::fs::create_dir_all(&lib).unwrap();
        let given = Path::new("/d/lib");
        if cfg!(windows) {
            assert_eq!(directml_folder(&lib, Some(given)), Some(given.to_path_buf()));
            assert_eq!(directml_folder(&lib, None), None);
            // The app's DirectML runtime, as its setup probes it.
            std::fs::write(lib.join(DIRECTML_LIBRARY), b"").unwrap();
            assert_eq!(directml_folder(&lib, None), Some(lib.clone()));
            assert_eq!(directml_folder(&lib, Some(given)), Some(given.to_path_buf()));
        } else {
            std::fs::write(lib.join(DIRECTML_LIBRARY), b"").unwrap();
            assert_eq!(directml_folder(&lib, Some(given)), None);
            assert_eq!(directml_folder(&lib, None), None);
        }
        // A folder without DirectML needs nothing loaded first.
        assert!(preload_directml(&dir));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_cpu_that_cannot_convert_a_block_in_its_time_does_not_start() {
        // 0.5 s blocks on the CPU.
        assert!(cpu_keeps_up(Duration::from_millis(320), CPU_LAYOUT));
        assert!(cpu_keeps_up(Duration::from_millis(499), CPU_LAYOUT));
        assert!(!cpu_keeps_up(Duration::from_millis(500), CPU_LAYOUT));
        // An Intel Core i7-1255U (2026-11-20).
        assert!(!cpu_keeps_up(Duration::from_millis(1208), CPU_LAYOUT));
        assert_eq!(Failure::CpuTooSlow.code(), "vc_cpu_too_slow");
        // The test tone is the block it stands for.
        assert_eq!(tone(CPU_LAYOUT.block_samples(), INPUT_RATE).len(), 8_000);
    }

    #[test]
    fn auto_passes_over_directml_on_an_integrated_gpu_only() {
        let adapter = |name: &str, discrete: Option<bool>, index: Option<u32>| backend::DirectMlAdapter { name: name.into(), discrete, high_performance_index: index };
        // A laptop with both: DirectML's high-performance preference takes the discrete GPU.
        let both = [adapter("Intel(R) Iris(R) Xe Graphics", Some(false), Some(1)), adapter("NVIDIA GeForce RTX 3060 Ti", Some(true), Some(0))];
        assert_eq!(backend::preferred_adapter(&both).map(|a| a.name.as_str()), Some("NVIDIA GeForce RTX 3060 Ti"));
        assert!(!auto_skips_directml(backend::preferred_adapter(&both)));
        // Integrated only: auto converts on the CPU instead.
        let integrated = [adapter("Intel(R) Iris(R) Xe Graphics", Some(false), Some(0))];
        assert!(auto_skips_directml(backend::preferred_adapter(&integrated)));
        // A GPU ONNX Runtime does not describe, or no order: the first is taken and kept.
        let unknown = [adapter("GPU", None, None), adapter("Other", Some(false), None)];
        assert_eq!(backend::preferred_adapter(&unknown).map(|a| a.name.as_str()), Some("GPU"));
        assert!(!auto_skips_directml(backend::preferred_adapter(&unknown)));
        assert!(!auto_skips_directml(backend::preferred_adapter(&[])));
    }

    /// The GPUs of a DirectML build of ONNX Runtime on this PC (`ASTAROT_TEST_DIRECTML_LIB`: a
    /// folder with its `onnxruntime.dll` and `DirectML.dll`), as the worker judges them. Prints
    /// names and flags only.
    ///
    ///     ASTAROT_TEST_DIRECTML_LIB=<dir> cargo test --no-default-features --features worker --bin astarot-rvc-worker -- --ignored --nocapture directml_lists
    #[cfg(windows)]
    #[test]
    #[ignore = "needs the DirectML build of ONNX Runtime"]
    fn directml_lists_this_pcs_gpus() {
        let Some(folder) = std::env::var_os("ASTAROT_TEST_DIRECTML_LIB").map(PathBuf::from) else { return };
        assert!(preload_directml(&folder));
        backend::load_runtime(&folder.join(ORT_LIBRARY)).unwrap();
        let adapters = backend::directml_adapters().unwrap();
        for adapter in &adapters {
            println!("{adapter:?}");
        }
        assert!(!adapters.is_empty(), "the DirectML build lists its GPUs");
        println!("taken: {:?}; auto passes over it: {}", backend::preferred_adapter(&adapters), auto_skips_directml(backend::preferred_adapter(&adapters)));
    }

    #[test]
    fn a_gpu_that_cannot_run_says_which_gpu() {
        let unavailable = Error::DeviceUnavailable("no adapter".into());
        assert_eq!(classify(&unavailable, Device::DirectMl, Failure::RuntimeIncomplete), Failure::DirectMlUnavailable);
        assert_eq!(classify(&unavailable, Device::Cuda, Failure::RuntimeIncomplete), Failure::GpuUnavailable);
        assert_eq!(classify(&Error::Backend("x".into()), Device::DirectMl, Failure::CheckpointIncomplete), Failure::CheckpointIncomplete);
        assert_eq!(Failure::DirectMlUnavailable.code(), "vc_directml_unavailable");
    }

    #[test]
    fn playout_keeps_every_block_at_its_place() {
        const FRAMES: usize = 3_840;
        let silence = vec![0.0; FRAMES];
        let mut playout = Playout::new(2, 3 * FRAMES, FRAMES);
        // The lead, then a packet whose audio is not there yet: silence.
        for _ in 0..3 {
            assert_eq!(playout.next(), silence);
        }
        // Block 1 arrives before block 0; each lands at its own place. The first packet of
        // block 0 was answered already, so only the rest of it plays.
        assert!(playout.add(1, vec![2.0; 3 * FRAMES]));
        assert!(!playout.add(0, vec![1.0; 3 * FRAMES]));
        assert_eq!(playout.next(), vec![1.0; FRAMES]);
        assert_eq!(playout.next(), vec![1.0; FRAMES]);
        for _ in 0..3 {
            assert_eq!(playout.next(), vec![2.0; FRAMES]);
        }
        // Block 2 was dropped: silence at its place; block 3 still plays where it belongs.
        assert!(playout.add(3, vec![4.0; 3 * FRAMES]));
        for _ in 0..3 {
            assert_eq!(playout.next(), silence);
        }
        assert_eq!(playout.next(), vec![4.0; FRAMES]);
        // Audio that comes after its place was answered is dropped.
        assert!(!playout.add(1, vec![9.0; 3 * FRAMES]));
        assert_eq!(playout.next(), vec![4.0; FRAMES]);
    }

    #[test]
    fn arguments_are_checked_before_anything_loads() {
        let base = |extra: &[(&str, &str)]| {
            let mut values: HashMap<String, String> =
                [("runtime", "/r"), ("model", "/m.pth"), ("session", "0123456789abcdef0123456789abcdef")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
            values.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
            parse(values)
        };
        assert!(base(&[]).is_ok());
        assert!(base(&[("index-rate", "0.5")]).is_err());
        assert!(base(&[("index-rate", "0.5"), ("index", "/i.index")]).is_ok());
        assert!(base(&[("pitch", "25")]).is_err());
        assert!(base(&[("session", "XYZ")]).is_err());
        assert!(base(&[("unknown", "1")]).is_err());
        assert_eq!(base(&[]).unwrap().device, Choice::Auto);
        assert_eq!(base(&[("device", "cpu")]).unwrap().device, Choice::Cpu);
        assert_eq!(base(&[("device", "directml")]).unwrap().device, Choice::DirectMl);
        assert!(base(&[("device", "gpu")]).is_err());
        assert!(base(&[("device", "DirectML")]).is_err());
        assert_eq!(base(&[]).unwrap().directml, None);
        assert_eq!(base(&[("directml", "")]).unwrap().directml, None);
        assert_eq!(base(&[("directml", "/d/lib")]).unwrap().directml, Some(PathBuf::from("/d/lib")));
        assert_eq!(base(&[]).unwrap().packets, Packets::of(80), "the external runtime's packets");
        assert_eq!(base(&[("block-ms", "40")]).unwrap().packets, Packets::of(40));
        assert_eq!(base(&[("block-ms", "auto")]).unwrap().packets, None, "chosen once the device is known");
        for bad in ["30", "0", "220", "40.0", "-40", "x", "Auto"] {
            assert!(base(&[("block-ms", bad)]).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_automatic_block_is_the_shortest_the_gpu_converts_in_time_with_room_to_spare() {
        // The tried lengths are valid packets, shortest first.
        assert!(AUTO_BLOCK_MS.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(AUTO_BLOCK_MS.iter().all(|&ms| Packets::of(ms).is_some()));
        assert!(Packets::of(AUTO_CPU_PACKET_MS).is_some());
        let fits = |time_ms: u64, block_ms: u32| keeps_up_with_headroom(Duration::from_millis(time_ms), Packets::of(block_ms).unwrap());
        assert!(fits(28, 40) && !fits(29, 40), "1.4 times the time fits in the block");
        let chosen = |time_ms: u64| auto_block_ms(Duration::from_millis(time_ms));
        // An RTX 3060 Ti over Thunderbolt (2026-11-20), 40 ms blocks back to back: CUDA 50 to 55
        // ms, DirectML 37 to 43 ms. An RTX 4080 SUPER: 11 to 15 ms.
        assert_eq!(chosen(55), 80, "CUDA on the laptop");
        assert_eq!(chosen(37), 60, "DirectML on the laptop");
        assert_eq!(chosen(15), 40, "the desktop");
        // Between the steps, and a GPU that keeps up with none.
        assert_eq!((chosen(72), chosen(86), chosen(115), chosen(143), chosen(500)), (120, 160, 200, 200, 200));
    }

    #[test]
    fn a_chosen_block_is_kept_for_the_same_voice_model_on_the_same_gpu() {
        // FNV-1a's published values: the key is the same everywhere.
        assert_eq!((fnv1a(b""), fnv1a(b"a")), (0xcbf2_9ce4_8422_2325, 0xaf63_dc4c_8601_ec8c));
        let dir = std::env::temp_dir().join(format!("vrct-block-cache-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let model = dir.join("voice.pth");
        std::fs::write(&model, b"model").unwrap();
        let values: HashMap<String, String> =
            [("runtime", dir.to_str().unwrap()), ("model", model.to_str().unwrap()), ("session", "0123456789abcdef0123456789abcdef"), ("block-ms", "auto")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let arguments = parse(values).unwrap();
        let key = |gpu: &str, device: Device| BlockCache::key(gpu, &arguments, device).unwrap();
        let first = key("NVIDIA GeForce RTX 3060 Ti", Device::Cuda);
        assert_eq!(first.len(), 16);
        assert_eq!(first, key("NVIDIA GeForce RTX 3060 Ti", Device::Cuda), "the same start finds the same entry");
        assert_ne!(first, key("NVIDIA GeForce RTX 4080 SUPER", Device::Cuda), "another GPU");
        assert_ne!(first, key("NVIDIA GeForce RTX 3060 Ti", Device::DirectMl), "another device");
        // Kept, found again, and nothing but the hash and the length is written.
        let cache = BlockCache { path: dir.join("rvc-block-lengths.json"), key: first.clone() };
        assert_eq!(cache.chosen(), None);
        cache.remember(80);
        assert_eq!(cache.chosen(), Some(80));
        let written = std::fs::read_to_string(&cache.path).unwrap();
        assert!(!written.contains("voice") && !written.contains("NVIDIA") && written.contains(&first), "{written}");
        // Another GPU has an entry of its own; a length not chosen from is not used.
        let other = BlockCache { path: cache.path.clone(), key: key("NVIDIA GeForce RTX 4080 SUPER", Device::Cuda) };
        other.remember(40);
        assert_eq!((cache.chosen(), other.chosen()), (Some(80), Some(40)));
        // The user chose Automatic again: the next start times its GPU again, keeps the new
        // length for its own entry, and the request is gone; the other entry stays.
        assert!(!cache.timing_asked());
        std::fs::write(dir.join("rvc-block-lengths.remeasure"), b"").unwrap();
        assert!(cache.timing_asked() && other.timing_asked(), "whichever start comes next times again");
        assert!(cache.remember(60));
        cache.timed_again();
        assert!(!dir.join("rvc-block-lengths.remeasure").exists());
        assert_eq!((cache.chosen(), other.chosen()), (Some(60), Some(40)));
        assert!(!cache.timing_asked());
        cache.timed_again();
        std::fs::write(&cache.path, format!("{{\"version\": {BLOCK_CACHE_VERSION}, \"blocks\": {{\"{first}\": {{\"block_ms\": 30}}}}}}")).unwrap();
        assert_eq!(cache.chosen(), None);
        // A changed voice model is timed again.
        std::fs::write(&model, b"another model").unwrap();
        assert_ne!(first, key("NVIDIA GeForce RTX 3060 Ti", Device::Cuda));
        // A file of another version, or not JSON, is as no file.
        std::fs::write(&cache.path, b"not json").unwrap();
        assert_eq!(cache.chosen(), None);
        cache.remember(60);
        assert_eq!(cache.chosen(), Some(60));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
