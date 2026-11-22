//! ONNX Runtime sessions for the three networks: content features (HuBERT), pitch
//! salience (RMVPE) and the synthesizer.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use ort::environment::Environment;
use ort::session::Session;
use ort::value::Tensor;

use crate::error::{Error, Result};
use crate::f0::{self, F0Estimator, MelSpectrogram};
use crate::model::{Version, VoiceModel};
use crate::noise::{self, Generator};
use crate::synth::{self, io};

/// Where the graphs run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Device {
    #[default]
    Cpu,
    /// CUDA, falling back to the CPU for operators it lacks. Needs the `cuda` feature and
    /// an ONNX Runtime build with the CUDA provider.
    ///
    /// If the CUDA provider cannot start (no NVIDIA driver or GPU, missing CUDA or cuDNN
    /// libraries), loading fails with [`Error::DeviceUnavailable`] instead of running on
    /// the CPU. ONNX Runtime's own behaviour would be to fall back silently.
    Cuda,
    /// DirectML (Windows; NVIDIA, AMD and Intel GPUs), falling back to the CPU for operators
    /// it lacks. Needs the DirectML build of ONNX Runtime, loaded after `DirectML.dll`.
    ///
    /// The GPU is the one DirectML ranks highest for performance, so a laptop's discrete GPU
    /// is taken over its integrated one. If DirectML cannot start, loading fails with
    /// [`Error::DeviceUnavailable`], as for CUDA.
    DirectMl,
}

impl Device {
    /// Whether the graphs run on a GPU.
    pub fn is_gpu(self) -> bool {
        self != Device::Cpu
    }
}

fn backend(error: impl std::fmt::Display) -> Error {
    Error::Backend(error.to_string())
}

/// Threads of each session's intra-operator pool; 0 leaves ONNX Runtime's default.
static INTRA_THREADS: AtomicUsize = AtomicUsize::new(0);

/// The process's ONNX Runtime environment (`astarot-onnx-runtime`), made on first use. The
/// worker's tools stop ONNX Runtime's usage reports first thing
/// (`astarot_onnx_runtime::disable_telemetry_for_process`); the app sets the variable for the worker
/// it starts as well.
fn environment() -> Result<&'static Environment> {
    astarot_onnx_runtime::environment().map_err(|error| match error {
        astarot_onnx_runtime::Error::Unavailable(message) => Error::Backend(message),
        other => backend(other),
    })
}

/// Loads ONNX Runtime from `library` (`libonnxruntime.so`, `onnxruntime.dll`) instead of
/// looking it up (`ORT_DYLIB_PATH` is ignored). Call before anything else of this crate; a
/// second call, or a call after a network was loaded, returns an error and changes nothing.
#[cfg(feature = "load-dynamic")]
pub fn load_runtime(library: &Path) -> Result<()> {
    astarot_onnx_runtime::load(library).map_err(|error| match error {
        astarot_onnx_runtime::Error::Unavailable(message) => Error::Backend(message),
        astarot_onnx_runtime::Error::AlreadyLoaded => Error::invalid("ONNX Runtime was already loaded"),
    })
}

/// Limits the CPU threads each network's session uses within one operator (ONNX
/// Runtime's intra-operator pool). `None` keeps ONNX Runtime's default, one thread per
/// physical core, which ignores the process's CPU affinity. Applies to sessions created
/// afterwards.
pub fn set_intra_threads(threads: Option<usize>) {
    INTRA_THREADS.store(threads.unwrap_or(0), Ordering::Relaxed);
}

enum Source<'a> {
    File(&'a Path),
    Memory(&'a [u8]),
}

fn session(source: Source, device: Device) -> Result<Session> {
    let mut builder = Session::builder(environment()?).map_err(backend)?;
    let threads = INTRA_THREADS.load(Ordering::Relaxed);
    if threads > 0 {
        builder = builder.with_intra_threads(threads).map_err(backend)?;
    }
    match device {
        Device::Cpu => {}
        Device::Cuda => {
            #[cfg(feature = "cuda")]
            {
                // error_on_failure: a provider that cannot start is an error, not the CPU.
                builder = builder.with_execution_providers([ort::ep::CUDA::default().build().error_on_failure()]).map_err(|error| Error::DeviceUnavailable(error.to_string()))?;
            }
            #[cfg(not(feature = "cuda"))]
            return Err(Error::invalid("this build has no CUDA support (enable the `cuda` feature)"));
        }
        Device::DirectMl => {
            #[cfg(windows)]
            {
                use ort::ep::directml::{DeviceFilter, PerformancePreference};
                // DirectML needs both off (ONNX Runtime's DirectML documentation).
                builder = builder.with_memory_pattern(false).map_err(backend)?.with_parallel_execution(false).map_err(backend)?;
                let provider = ort::ep::DirectML::default().with_device_filter(DeviceFilter::Gpu).with_performance_preference(PerformancePreference::HighPerformance);
                builder = builder.with_execution_providers([provider.build().error_on_failure()]).map_err(|error| Error::DeviceUnavailable(error.to_string()))?;
            }
            #[cfg(not(windows))]
            return Err(Error::DeviceUnavailable("DirectML exists on Windows only".into()));
        }
    }
    match source {
        Source::File(path) => builder.commit_from_file(path).map_err(backend),
        Source::Memory(bytes) => builder.commit_from_memory(bytes).map_err(backend),
    }
}

/// Creates and runs a one-operator graph on `device`: whether the device can be used at
/// all, without loading any model. A GPU that cannot be used gives
/// [`Error::DeviceUnavailable`].
pub fn check_device(device: Device) -> Result<()> {
    let mut graph = crate::onnx::Graph::new();
    let x = graph.input_f32("x", &[crate::onnx::Dim::Fixed(1), crate::onnx::Dim::Fixed(4)]);
    let one = graph.scalar(1.0);
    let y = graph.add(&x, &one);
    graph.output_f32("y", &y, &[crate::onnx::Dim::Fixed(1), crate::onnx::Dim::Fixed(4)]);
    // The graph is valid, so on the GPU any failure to create or run it is the device's.
    let unavailable = |error: Error| match (device.is_gpu(), error) {
        (true, Error::Backend(message)) => Error::DeviceUnavailable(message),
        (_, error) => error,
    };
    let mut session = session(Source::Memory(&graph.into_model()), device).map_err(unavailable)?;
    let input = Tensor::from_array(([1usize, 4], vec![0.0f32; 4])).map_err(backend)?;
    let outputs = session.run(ort::inputs!["x" => input]).map_err(|error| unavailable(backend(error)))?;
    let (_, data) = first_output(&outputs, "y")?;
    if data != [1.0; 4] {
        return Err(Error::Backend("the device returned a wrong result".into()));
    }
    Ok(())
}

/// A GPU DirectML can use, as ONNX Runtime's device discovery describes it (its metadata keys
/// `Description`, `Discrete` and `DxgiHighPerformanceIndex`). A value it does not give is `None`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DirectMlAdapter {
    pub name: String,
    /// False for an integrated GPU (one that shares the system's memory).
    pub discrete: Option<bool>,
    /// The place in DXGI's high-performance order; 0 is the GPU DirectML's high-performance
    /// preference takes.
    pub high_performance_index: Option<u32>,
}

/// The GPU [`Device::DirectMl`] runs on: the first in the high-performance order, else the
/// first listed.
pub fn preferred_adapter(adapters: &[DirectMlAdapter]) -> Option<&DirectMlAdapter> {
    adapters.iter().filter(|adapter| adapter.high_performance_index.is_some()).min_by_key(|adapter| adapter.high_performance_index).or(adapters.first())
}

/// The GPUs of the loaded ONNX Runtime's DirectML provider. Empty when the library is not the
/// DirectML build. Loads ONNX Runtime if it is not loaded yet.
#[cfg(windows)]
pub fn directml_adapters() -> Result<Vec<DirectMlAdapter>> {
    use std::ffi::CStr;

    use ort::AsPointer;
    use ort::memory::DeviceType;

    let api = ort::api();
    let mut adapters = Vec::new();
    for device in environment()?.devices() {
        let hardware = device.hardware_device();
        if device.ep().ok() != Some("DmlExecutionProvider") || hardware.ty() != DeviceType::GPU {
            continue;
        }
        // SAFETY: the device and its metadata live as long as the environment, which is never
        // released; a key ONNX Runtime does not set gives a null pointer.
        let metadata = unsafe { (api.HardwareDevice_Metadata)(hardware.ptr()) };
        let value = |key: &CStr| -> Option<String> {
            if metadata.is_null() {
                return None;
            }
            let text = unsafe { (api.GetKeyValue)(metadata, key.as_ptr()) };
            (!text.is_null()).then(|| unsafe { CStr::from_ptr(text) }.to_string_lossy().into_owned())
        };
        adapters.push(DirectMlAdapter {
            name: value(c"Description").unwrap_or_default(),
            discrete: value(c"Discrete").and_then(|text| match text.as_str() {
                "1" => Some(true),
                "0" => Some(false),
                _ => None,
            }),
            high_performance_index: value(c"DxgiHighPerformanceIndex").and_then(|text| text.parse().ok()),
        });
    }
    Ok(adapters)
}

/// The name of the GPU a device converts on, to tell one GPU from another (#531): CUDA's
/// device 0, the one ONNX Runtime's CUDA provider uses, from the NVIDIA driver; for DirectML
/// the [`preferred_adapter`]. `None` for the CPU or when the name cannot be read.
pub fn gpu_name(device: Device) -> Option<String> {
    match device {
        Device::Cpu => None,
        Device::Cuda => cuda_device_name(),
        #[cfg(windows)]
        Device::DirectMl => directml_adapters().ok().and_then(|adapters| preferred_adapter(&adapters).map(|adapter| adapter.name.clone())).filter(|name| !name.is_empty()),
        #[cfg(not(windows))]
        Device::DirectMl => None,
    }
}

/// CUDA device 0's name from the driver library (`cuDeviceGetName`).
fn cuda_device_name() -> Option<String> {
    #[cfg(windows)]
    const DRIVER: &str = "nvcuda.dll";
    #[cfg(not(windows))]
    const DRIVER: &str = "libcuda.so.1";
    type Init = unsafe extern "C" fn(u32) -> i32;
    type DeviceGet = unsafe extern "C" fn(*mut i32, i32) -> i32;
    type DeviceGetName = unsafe extern "C" fn(*mut std::ffi::c_char, i32, i32) -> i32;
    // SAFETY: the driver's documented C functions with their documented signatures; the name
    // is written into a buffer of the length given and read up to its terminating zero.
    unsafe {
        let driver = libloading::Library::new(DRIVER).ok()?;
        let init: libloading::Symbol<Init> = driver.get(b"cuInit\0").ok()?;
        let device_get: libloading::Symbol<DeviceGet> = driver.get(b"cuDeviceGet\0").ok()?;
        let device_get_name: libloading::Symbol<DeviceGetName> = driver.get(b"cuDeviceGetName\0").ok()?;
        let mut device = 0i32;
        let mut name = [0 as std::ffi::c_char; 256];
        if init(0) != 0 || device_get(&mut device, 0) != 0 || device_get_name(name.as_mut_ptr(), name.len() as i32, device) != 0 {
            return None;
        }
        let name = std::ffi::CStr::from_ptr(name.as_ptr()).to_string_lossy().into_owned();
        (!name.is_empty()).then_some(name)
    }
}

fn first_output(outputs: &ort::session::SessionOutputs, name: &str) -> Result<(Vec<usize>, Vec<f32>)> {
    let value = outputs.get(name).ok_or_else(|| Error::Backend(format!("the graph has no output named {name}")))?;
    let (shape, data) = value.try_extract_tensor::<f32>().map_err(backend)?;
    Ok((shape.iter().map(|&d| d as usize).collect(), data.to_vec()))
}

/// Content features from 16 kHz audio at 50 frames per second.
///
/// The graph takes `audio` `[1, samples]` and gives `features_v2` (last layer, 768 wide)
/// and `features_v1` (ninth layer through the final projection, 256 wide). It is built
/// from the Transformers-format checkpoint folder ([`FeatureExtractor::from_checkpoint`],
/// see [`crate::hubert`]) or read from a graph exported by
/// `reference/export_hubert_onnx.py` ([`FeatureExtractor::load`]).
pub struct FeatureExtractor {
    session: Session,
}

/// Fewer samples than this give the network no frame at all.
pub const MIN_FEATURE_SAMPLES: usize = 400;

impl FeatureExtractor {
    /// Reads an exported graph file.
    pub fn load(path: &Path, device: Device) -> Result<Self> {
        Self::from_session(session(Source::File(path), device)?)
    }

    /// Builds the graph from a `hubert_base` checkpoint folder (`config.json` and
    /// `pytorch_model.bin`).
    pub fn from_checkpoint(folder: &Path, device: Device) -> Result<Self> {
        let graph = crate::hubert::HubertCheckpoint::load(folder)?.build_graph()?;
        Self::from_session(session(Source::Memory(&graph), device)?)
    }

    fn from_session(session: Session) -> Result<Self> {
        for name in ["features_v1", "features_v2"] {
            if !session.outputs().iter().any(|output| output.name() == name) {
                return Err(Error::format("feature extractor", format!("the graph has no `{name}` output")));
            }
        }
        Ok(FeatureExtractor { session })
    }

    /// Row-major `[frames][version.feature_dim()]`. The audio is used as it is; the
    /// checkpoint's preprocessing configuration asks for no normalisation.
    pub fn extract(&mut self, audio: &[f32], version: Version) -> Result<Vec<f32>> {
        let (width, data) = self.extract_any_width(audio, version)?;
        if width != version.feature_dim() {
            return Err(Error::Backend("feature extractor returned an unexpected width".into()));
        }
        Ok(data)
    }

    /// As [`FeatureExtractor::extract`], for graphs of another width (test checkpoints):
    /// the width of the `version`'s output and the row-major features.
    pub fn extract_any_width(&mut self, audio: &[f32], version: Version) -> Result<(usize, Vec<f32>)> {
        if audio.len() < MIN_FEATURE_SAMPLES {
            return Err(Error::invalid("audio is too short for feature extraction"));
        }
        let input = Tensor::from_array(([1, audio.len()], audio.to_vec())).map_err(backend)?;
        let outputs = self.session.run(ort::inputs!["audio" => input]).map_err(backend)?;
        let name = match version {
            Version::V1 => "features_v1",
            Version::V2 => "features_v2",
        };
        let (shape, data) = first_output(&outputs, name)?;
        Ok((shape.last().copied().unwrap_or(0), data))
    }
}

/// RMVPE: log-mel spectrogram in, per-frame salience over 360 pitch bins out.
pub struct Rmvpe {
    session: Session,
    mel: MelSpectrogram,
    input: String,
    output: String,
    /// Peak salience below this marks a frame unvoiced.
    pub threshold: f32,
}

impl Rmvpe {
    pub fn load(path: &Path, device: Device) -> Result<Self> {
        let session = session(Source::File(path), device)?;
        let name = |outlets: &[ort::value::Outlet]| outlets.first().map(|outlet| outlet.name().to_string()).ok_or_else(|| Error::format("pitch extractor", "the graph has no inputs or outputs"));
        let (input, output) = (name(session.inputs())?, name(session.outputs())?);
        Ok(Rmvpe { session, mel: MelSpectrogram::new(), input, output, threshold: 0.03 })
    }
}

impl F0Estimator for Rmvpe {
    fn estimate(&mut self, audio: &[f32]) -> Result<Vec<f32>> {
        let (mel, frames) = self.mel.compute(audio);
        let padded = f0::padded_frames(frames);
        let bands = mel.len() / frames;
        let mut input = vec![0.0f32; bands * padded];
        for band in 0..bands {
            input[band * padded..band * padded + frames].copy_from_slice(&mel[band * frames..(band + 1) * frames]);
        }
        let input = Tensor::from_array(([1, bands, padded], input)).map_err(backend)?;
        let outputs = self.session.run(ort::inputs![self.input.as_str() => input]).map_err(backend)?;
        let (shape, salience) = first_output(&outputs, &self.output)?;
        if shape.last() != Some(&f0::SALIENCE_BINS) || salience.len() < frames * f0::SALIENCE_BINS {
            return Err(Error::Backend("pitch extractor returned an unexpected shape".into()));
        }
        Ok(f0::decode_salience(&salience[..frames * f0::SALIENCE_BINS], self.threshold))
    }
}

/// Frames of flow context kept before a streaming window (specification section 9.3:
/// `flow_head = max(skip_head - 24, 0)`).
pub const FLOW_CONTEXT: usize = 24;

/// A voice model ready to synthesize.
pub struct Synthesizer {
    session: Session,
    feature_dim: usize,
    inter_channels: usize,
    samples_per_frame: usize,
    sample_rate: u32,
    speakers: usize,
    f0: bool,
}

impl Synthesizer {
    pub fn new(model: &VoiceModel, device: Device) -> Result<Self> {
        let graph = synth::build_graph(model)?;
        Ok(Synthesizer {
            session: session(Source::Memory(&graph), device)?,
            feature_dim: model.version.feature_dim(),
            inter_channels: model.config.inter_channels,
            samples_per_frame: model.config.samples_per_frame(),
            sample_rate: model.config.sample_rate,
            speakers: model.config.spk_embed_dim,
            f0: model.f0,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn samples_per_frame(&self) -> usize {
        self.samples_per_frame
    }

    pub fn uses_pitch(&self) -> bool {
        self.f0
    }

    /// Synthesizes `frames * samples_per_frame` samples from 100 fps features
    /// (`[frames][feature_dim]`) and, for pitch-enabled models, the two pitch tracks.
    /// The generator supplies the prior noise first and the excitation noise second.
    pub fn synthesize(&mut self, features: &[f32], pitch: Option<(&[i64], &[f32])>, speaker: usize, generator: &mut Generator) -> Result<Vec<f32>> {
        let frames = features.len() / self.feature_dim;
        self.synthesize_window(features, pitch, speaker, generator, 0, frames)
    }

    /// The window form of specification section 9.3, for streaming: the first `skip_head`
    /// frames are left context only, and `return_length * samples_per_frame` samples are
    /// produced for the frames after them.
    ///
    /// The prior encoder sees all frames; the flow starts `FLOW_CONTEXT` frames before
    /// `skip_head` (or at the first frame), so it has some context of its own, and the
    /// pitch tracks are taken from `skip_head` on.
    pub fn synthesize_window(&mut self, features: &[f32], pitch: Option<(&[i64], &[f32])>, speaker: usize, generator: &mut Generator, skip_head: usize, return_length: usize) -> Result<Vec<f32>> {
        let frames = features.len() / self.feature_dim;
        if frames == 0 || features.len() != frames * self.feature_dim {
            return Err(Error::invalid("features are empty or not a whole number of frames"));
        }
        if return_length == 0 || skip_head + return_length > frames {
            return Err(Error::invalid("the window to synthesize does not lie within the features"));
        }
        if speaker >= self.speakers {
            return Err(Error::invalid(format!("speaker {speaker} does not exist (the model has {})", self.speakers)));
        }
        let flow_start = skip_head.saturating_sub(FLOW_CONTEXT);
        let decode_start = skip_head - flow_start;
        let flow_frames = frames - flow_start;
        let noise = generator.normals(flow_frames * self.inter_channels);
        let index = |value: usize| Tensor::from_array(([1usize], vec![value as i64])).map_err(backend);
        let mut inputs = ort::inputs![
            io::FEATURES => Tensor::from_array(([1, frames, self.feature_dim], features.to_vec())).map_err(backend)?,
            io::NOISE => Tensor::from_array(([1, flow_frames, self.inter_channels], noise)).map_err(backend)?,
            io::SPEAKER => Tensor::from_array(([1usize], vec![speaker as i64])).map_err(backend)?,
            io::FLOW_START => index(flow_start)?,
            io::DECODE_START => index(decode_start)?,
            io::DECODE_END => index(decode_start + return_length)?,
        ];
        match (self.f0, pitch) {
            (true, Some((coarse, continuous))) => {
                if coarse.len() != frames || continuous.len() != frames {
                    return Err(Error::invalid("pitch tracks do not match the number of feature frames"));
                }
                if coarse.iter().any(|value| !(0..256).contains(value)) {
                    return Err(Error::invalid("quantised pitch out of range"));
                }
                let decoded = &continuous[skip_head..skip_head + return_length];
                let excitation = noise::excitation(decoded, self.samples_per_frame, self.sample_rate, generator);
                inputs.push((io::PITCH.into(), Tensor::from_array(([1, frames], coarse.to_vec())).map_err(backend)?.into()));
                inputs.push((io::EXCITATION.into(), Tensor::from_array(([1, 1, excitation.len()], excitation)).map_err(backend)?.into()));
            }
            (true, None) => return Err(Error::invalid("this model needs pitch")),
            (false, _) => {}
        }
        let outputs = self.session.run(inputs).map_err(backend)?;
        Ok(first_output(&outputs, io::AUDIO)?.1)
    }
}
