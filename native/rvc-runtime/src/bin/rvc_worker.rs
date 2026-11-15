//! `vrct-rvc-worker`: the application's live RVC voice conversion process.
//!
//! It speaks the application's fixed live-VC pipe contract
//! (`src-python/models/voice_conversion/protocol.py`, "VVC1"): one `ready` (or `failed`)
//! packet once the voice model is loaded, then one `output` packet for every `input`
//! packet, 80 ms of 48 kHz mono 16-bit audio each. It opens no audio device, downloads
//! nothing and never writes audio, text or file paths anywhere but the output pipe.
//!
//! ONNX Runtime, the CUDA libraries and the two fixed networks come from the runtime
//! folder the application sets up after the user's consent (`--runtime`):
//!
//! ```text
//! <runtime>/lib/                         ONNX Runtime with its CUDA provider, CUDA, cuDNN
//! <runtime>/assets/hubert_base/          config.json, pytorch_model.bin
//! <runtime>/assets/rmvpe/rmvpe.onnx
//! ```
//!
//! `--probe` only checks that the GPU can be used (exit 0) and is what the setup's last
//! step runs.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::mpsc;
use std::time::Duration;

use rvc_runtime::audio::StreamResampler;
use rvc_runtime::{backend, Converter, Device, Error, FeatureExtractor, FeatureIndex, Layout, NoiseMode, Rmvpe, Stream, StreamOptions, Synthesizer, VoiceModel};
use serde_json::{Map, Value};

const RATE: u32 = 48_000;
const FRAMES: usize = 3_840;
const PCM_BYTES: usize = FRAMES * 2;
const BLOCK_NS: u64 = 80_000_000;
const INPUT_RATE: u32 = 16_000;
const MAX_HEADER: usize = 2_048;
/// The layout of the external runtime this replaces, in 10 ms frames: 80 ms blocks,
/// a 40 ms crossfade searched over 10 ms, and 2 s of context.
const LAYOUT: Layout = Layout { block: 8, crossfade: 4, search: 1, extra: 200 };
/// Blocks of a test tone converted before `ready`, so the first real block does not pay
/// for the networks' first runs.
const WARMUP_BLOCKS: usize = 3;
/// ONNX Runtime CPU threads per session when the networks run on the GPU.
const GPU_INTRA_THREADS: usize = 1;

#[cfg(target_os = "linux")]
const ORT_LIBRARY: &str = "libonnxruntime.so";
#[cfg(windows)]
const ORT_LIBRARY: &str = "onnxruntime.dll";
/// CUDA and cuDNN, loaded from the runtime folder before ONNX Runtime's CUDA provider
/// needs them, so nothing depends on the system's library search path.
#[cfg(target_os = "linux")]
const GPU_LIBRARIES: &[&str] = &[
    "libcudart.so.12",
    "libcublasLt.so.12",
    "libcublas.so.12",
    "libcurand.so.10",
    "libnvrtc-builtins.so.12.8",
    "libnvrtc.so.12",
    "libcudnn.so.9",
    "libcudnn_graph.so.9",
    "libcudnn_ops.so.9",
    "libcudnn_heuristic.so.9",
    "libcudnn_cnn.so.9",
    "libcudnn_adv.so.9",
    "libcudnn_engines_precompiled.so.9",
    "libcudnn_engines_runtime_compiled.so.9",
];
#[cfg(windows)]
const GPU_LIBRARIES: &[&str] = &[
    "cudart64_12.dll",
    "cublasLt64_12.dll",
    "cublas64_12.dll",
    "curand64_10.dll",
    "nvrtc-builtins64_128.dll",
    "nvrtc64_120_0.dll",
    "cudnn64_9.dll",
    "cudnn_graph64_9.dll",
    "cudnn_ops64_9.dll",
    "cudnn_heuristic64_9.dll",
    "cudnn_cnn64_9.dll",
    "cudnn_adv64_9.dll",
    "cudnn_engines_precompiled64_9.dll",
    "cudnn_engines_runtime_compiled64_9.dll",
];

/// Why the worker could not become ready: the codes of `protocol.WORKER_FAILURES`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Failure {
    GpuUnavailable,
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

/// A packet's header and audio.
type Packet = (Map<String, Value>, Vec<u8>);

struct Arguments {
    runtime: PathBuf,
    model: PathBuf,
    index: Option<PathBuf>,
    session: String,
    pitch: i32,
    index_rate: f32,
    device: Device,
    threads: Option<usize>,
    highpass: bool,
}

const USAGE: &str = "\
Usage: vrct-rvc-worker --runtime <dir> --model <voice.pth> --session <32 hex digits>
                       [--index <file.index>] [--pitch <-24..24>] [--index-rate <0..1>]
                       [--device cuda|cpu] [--threads <n>] [--highpass on|off]
       vrct-rvc-worker --runtime <dir> --probe
";

fn parse(mut values: HashMap<String, String>) -> Result<Arguments, String> {
    let mut take = |name: &str| values.remove(name);
    let runtime = take("runtime").map(PathBuf::from).ok_or("`--runtime` is required")?;
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
    let device = match take("device").as_deref() {
        None | Some("cuda") => Device::Cuda,
        Some("cpu") => Device::Cpu,
        Some(_) => return Err("`--device` must be cuda or cpu".into()),
    };
    let threads = take("threads").map(|text| text.parse::<usize>()).transpose().map_err(|_| "`--threads` is not a whole number")?.filter(|&n| n > 0);
    // The input high-pass of the specification (on); off matches the earlier runtime.
    let highpass = match take("highpass").as_deref() {
        None | Some("on") => true,
        Some("off") => false,
        Some(_) => return Err("`--highpass` must be on or off".into()),
    };
    if let Some(unknown) = values.keys().next() {
        return Err(format!("unknown option `--{unknown}`"));
    }
    Ok(Arguments { runtime, model, index, session, pitch, index_rate, device, threads, highpass })
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

/// Loads ONNX Runtime and the GPU libraries from `<runtime>/lib`.
fn load_runtime(runtime: &Path, device: Device) -> Result<(), Failure> {
    let lib = runtime.join("lib");
    if device == Device::Cuda {
        // A library can need one listed after it; load what can be loaded until nothing
        // more can, so the list need not follow every dependency exactly.
        let mut pending: Vec<&str> = GPU_LIBRARIES.to_vec();
        while !pending.is_empty() {
            let before = pending.len();
            pending.retain(|name| ort::util::preload_dylib(lib.join(name)).is_err());
            if pending.len() == before {
                eprintln!("vrct-rvc-worker: {} GPU libraries could not be loaded from the runtime", pending.len());
                return Err(Failure::RuntimeIncomplete);
            }
        }
    }
    backend::load_runtime(&lib.join(ORT_LIBRARY)).map_err(|error| {
        eprintln!("vrct-rvc-worker: ONNX Runtime could not be loaded: {error}");
        Failure::RuntimeIncomplete
    })
}

/// What a loading error says about what the user can do.
fn classify(error: &Error, otherwise: Failure) -> Failure {
    match error {
        Error::DeviceUnavailable(_) => Failure::GpuUnavailable,
        Error::Io(_) => Failure::ModelMissing,
        _ => otherwise,
    }
}

fn load(arguments: &Arguments) -> Result<Stream, Failure> {
    if !arguments.model.is_file() || arguments.index.as_ref().is_some_and(|index| !index.is_file()) {
        return Err(Failure::ModelMissing);
    }
    let assets = arguments.runtime.join("assets");
    let (hubert, rmvpe) = (assets.join("hubert_base"), assets.join("rmvpe").join("rmvpe.onnx"));
    if !hubert.join("pytorch_model.bin").is_file() || !hubert.join("config.json").is_file() || !rmvpe.is_file() {
        return Err(Failure::RuntimeIncomplete);
    }
    load_runtime(&arguments.runtime, arguments.device)?;
    // On the GPU the CPU side of a block is small; one thread per session kept the same
    // block times with a third less CPU and 8 threads instead of 77 (README, "Application
    // worker"). On the CPU ONNX Runtime's default stands.
    backend::set_intra_threads(arguments.threads.or((arguments.device == Device::Cuda).then_some(GPU_INTRA_THREADS)));
    // Whether the GPU works at all, before any model: CUDA errors from a real model's
    // session cannot be told apart from problems with the model.
    backend::check_device(arguments.device).map_err(|error| {
        eprintln!("vrct-rvc-worker: device: {error}");
        classify(&error, Failure::RuntimeIncomplete)
    })?;
    let log = |what: &str, error: &Error| eprintln!("vrct-rvc-worker: {what}: {error}");
    let model = VoiceModel::load(&arguments.model).map_err(|error| {
        log("voice model", &error);
        match error {
            Error::Unsupported { .. } => Failure::FormatInvalid,
            ref other => classify(other, Failure::CheckpointIncomplete),
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
    // The GPU first: the error that says the most comes from the first session.
    let synthesizer = Synthesizer::new(&model, arguments.device).map_err(|error| {
        log("synthesizer", &error);
        classify(&error, Failure::CheckpointIncomplete)
    })?;
    let features = FeatureExtractor::from_checkpoint(&hubert, arguments.device).map_err(|error| {
        log("feature extractor", &error);
        classify(&error, Failure::CheckpointIncomplete)
    })?;
    let pitch = Rmvpe::load(&rmvpe, arguments.device).map_err(|error| {
        log("pitch extractor", &error);
        classify(&error, Failure::RuntimeIncomplete)
    })?;
    let converter = Converter { features, pitch: Box::new(pitch), synthesizer, index, version: model.version };
    let options = StreamOptions { transpose: arguments.pitch, index_rate: arguments.index_rate, speaker: 0, noise: NoiseMode::Random, layout: LAYOUT, highpass: arguments.highpass };
    Stream::new(converter, options).map_err(|error| {
        log("stream", &error);
        Failure::IndexFailed
    })
}

/// The stream with its rate conversions: 48 kHz in and out, 16 kHz and the model's rate
/// inside.
struct Live {
    stream: Stream,
    input: StreamResampler,
    output: StreamResampler,
}

impl Live {
    fn new(stream: Stream) -> Self {
        let rate = stream.sample_rate();
        Live { stream, input: StreamResampler::new(RATE, INPUT_RATE), output: StreamResampler::new(rate, RATE) }
    }

    fn reset(&mut self) {
        self.stream.reset();
        self.input.reset();
        self.output.reset();
    }

    fn convert(&mut self, samples: &[f32]) -> Result<Vec<f32>, Stop> {
        let low = self.input.process(samples);
        let converted = self.stream.process(&low).map_err(|error| {
            eprintln!("vrct-rvc-worker: conversion failed: {error}");
            Stop("vc_conversion_invalid")
        })?;
        let output = self.output.process(&converted);
        if output.len() != FRAMES || output.iter().any(|sample| !sample.is_finite()) {
            return Err(Stop("vc_conversion_invalid"));
        }
        Ok(output)
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
    if size > PCM_BYTES || !size.is_multiple_of(2) {
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
fn require_input(header: &Map<String, Value>, pcm: &[u8], session: &str, sequence: u64) -> Result<(), Stop> {
    let start = integer(header, "start_ns").filter(|&start| start > 0 && start < 1 << 63);
    let valid = header.len() == 8
        && header.get("type") == Some(&Value::from("input"))
        && header.get("session") == Some(&Value::from(session))
        && integer(header, "sequence") == Some(sequence)
        && start.is_some()
        && integer(header, "end_ns") == start.map(|start| start + BLOCK_NS)
        && integer(header, "rate") == Some(RATE as u64)
        && integer(header, "channels") == Some(1)
        && integer(header, "pcm_bytes") == Some(PCM_BYTES as u64)
        && pcm.len() == PCM_BYTES;
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

fn serve(mut live: Live, session: &str) -> Result<(), Stop> {
    let mut output = std::io::stdout().lock();
    // A 220 Hz tone at -20 dB.
    let tone: Vec<f32> = (0..FRAMES).map(|n| 0.1 * (n as f32 * 2.0 * std::f32::consts::PI * 220.0 / RATE as f32).sin()).collect();
    for _ in 0..WARMUP_BLOCKS {
        live.convert(&tone)?;
    }
    live.reset();
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
        ("profile", "low".into()),
        ("rate", RATE.into()),
        ("channels", 1.into()),
        ("block_frames", FRAMES.into()),
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
        require_input(&header, &pcm, session, sequence)?;
        let converted = to_pcm(&live.convert(&to_samples(&pcm))?);
        // The owner refuses an output identical to a non-silent input; say so first.
        if converted == pcm && pcm.iter().any(|&byte| byte != 0) {
            return Err(Stop("vc_passthrough_forbidden"));
        }
        let mut result = header.clone();
        result.insert("type".into(), "output".into());
        result.insert("state".into(), "converted".into());
        write_packet(&mut output, &result, &converted)?;
        sequence += 1;
    }
}

/// `--probe`: whether a CUDA session can be created and run with the runtime's libraries.
fn probe(runtime: &Path) -> ExitCode {
    if let Err(failure) = load_runtime(runtime, Device::Cuda) {
        eprintln!("vrct-rvc-worker: {}", failure.code());
        return ExitCode::from(4);
    }
    match backend::check_device(Device::Cuda) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("vrct-rvc-worker: {error}");
            ExitCode::from(if matches!(error, Error::DeviceUnavailable(_)) { 3 } else { 4 })
        }
    }
}

fn main() -> ExitCode {
    let (values, probing) = match options() {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("vrct-rvc-worker: {message}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    if probing {
        return match values.get("runtime") {
            Some(runtime) if values.len() == 1 => probe(Path::new(runtime)),
            _ => {
                eprintln!("{USAGE}");
                ExitCode::from(2)
            }
        };
    }
    let arguments = match parse(values) {
        Ok(arguments) => arguments,
        Err(message) => {
            eprintln!("vrct-rvc-worker: {message}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let stream = match load(&arguments) {
        Ok(stream) => stream,
        Err(failure) => {
            // Say why before exiting; the owner shows the code instead of "the worker ended".
            let failed = object(&[("type", "failed".into()), ("protocol", 1.into()), ("session", arguments.session.as_str().into()), ("code", failure.code().into())]);
            let _ = write_packet(&mut std::io::stdout().lock(), &failed, &[]);
            return ExitCode::from(1);
        }
    };
    match serve(Live::new(stream), &arguments.session) {
        Ok(()) => ExitCode::SUCCESS,
        Err(Stop(code)) => {
            eprintln!("vrct-rvc-worker: stopped: {code}");
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(session: &str, sequence: u64, start: u64) -> Map<String, Value> {
        object(&[
            ("type", "input".into()),
            ("session", session.into()),
            ("sequence", sequence.into()),
            ("start_ns", start.into()),
            ("end_ns", (start + BLOCK_NS).into()),
            ("rate", RATE.into()),
            ("channels", 1.into()),
            ("pcm_bytes", PCM_BYTES.into()),
        ])
    }

    #[test]
    fn packets_round_trip_and_inputs_are_checked() {
        let session = "0123456789abcdef0123456789abcdef";
        let header = input(session, 3, 1_000);
        let pcm = vec![1u8; PCM_BYTES];
        let packet = encode(&header, &pcm);
        let (read, data) = read_packet(&mut &packet[..]).unwrap().unwrap();
        assert_eq!(read, header);
        assert_eq!(data, pcm);
        assert!(require_input(&read, &data, session, 3).is_ok());
        assert!(require_input(&read, &data, session, 4).is_err());
        assert!(require_input(&read, &data, "ffffffffffffffffffffffffffffffff", 3).is_err());
        let mut extra = read.clone();
        extra.insert("more".into(), 1.into());
        assert!(require_input(&extra, &data, session, 3).is_err());
        let mut late = read.clone();
        late.insert("end_ns".into(), 2_000.into());
        assert!(require_input(&late, &data, session, 3).is_err());
        assert!(read_packet(&mut &b""[..]).unwrap().is_none());
        assert!(read_packet(&mut &b"XXXX\x01\0\0\0{"[..]).is_err());
    }

    #[test]
    fn samples_convert_like_the_python_worker() {
        assert_eq!(to_pcm(&[0.0, 1.0, -1.0, 0.5, -2.0]), [0i16, 32_767, -32_768, 16_384, -32_768].iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>());
        assert_eq!(to_samples(&16_384i16.to_le_bytes()), vec![0.5]);
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
    }
}
