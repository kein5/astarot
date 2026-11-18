//! Where a model runs (the ONNX Runtime execution provider), which quantization variant runs
//! there, and the fallback to the CPU when a provider cannot start.
//!
//! The rules are plain data and functions so that they can be tested without ONNX Runtime:
//! [`support`] is the variant × provider matrix, [`compute_types`] the settings values each
//! provider offers, [`choose_variant`] the variant a compute type selects, and
//! [`open_with_fallback`] the CPU fallback that is always reported, never silent.

use crate::{codes, Error, Result};

/// An ONNX Runtime execution provider this crate can ask for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Provider {
    Cpu,
    /// DirectX 12 on Windows: NVIDIA, AMD and Intel GPUs in one build. Microsoft keeps it in
    /// sustained engineering (fixes only).
    DirectMl,
    /// NVIDIA, Windows and Linux. Needs the CUDA and cuDNN libraries.
    Cuda,
    /// NVIDIA through TensorRT. Builds an engine per input shape; not offered as a device.
    TensorRt,
    /// Intel CPUs, GPUs and NPUs. Needs Intel's ONNX Runtime build and the OpenVINO runtime.
    OpenVino,
    /// AMD GPUs on Linux with ROCm (the ROCm provider left ONNX Runtime in 1.23).
    MiGraphX,
    /// WebGPU through Dawn (Direct3D 12 or Vulkan). New in ONNX Runtime; a plugin package.
    WebGpu,
}

impl Provider {
    pub const ALL: [Provider; 7] = [
        Provider::Cpu,
        Provider::DirectMl,
        Provider::Cuda,
        Provider::TensorRt,
        Provider::OpenVino,
        Provider::MiGraphX,
        Provider::WebGpu,
    ];

    /// The name the settings keep (`SELECTED_TRANSLATION_COMPUTE_DEVICE.device`).
    pub fn name(self) -> &'static str {
        match self {
            Provider::Cpu => "cpu",
            Provider::DirectMl => "directml",
            Provider::Cuda => "cuda",
            Provider::TensorRt => "tensorrt",
            Provider::OpenVino => "openvino",
            Provider::MiGraphX => "migraphx",
            Provider::WebGpu => "webgpu",
        }
    }

    pub fn from_name(name: &str) -> Option<Provider> {
        Provider::ALL.into_iter().find(|p| p.name() == name)
    }

    /// The name ONNX Runtime lists it by (`GetAvailableProviders`).
    pub fn ort_name(self) -> &'static str {
        match self {
            Provider::Cpu => "CPUExecutionProvider",
            Provider::DirectMl => "DmlExecutionProvider",
            Provider::Cuda => "CUDAExecutionProvider",
            Provider::TensorRt => "TensorrtExecutionProvider",
            Provider::OpenVino => "OpenVINOExecutionProvider",
            Provider::MiGraphX => "MIGraphXExecutionProvider",
            Provider::WebGpu => "WebGpuExecutionProvider",
        }
    }

    /// What the device list shows. Not translated: these are product names.
    pub fn label(self) -> &'static str {
        match self {
            Provider::Cpu => "cpu",
            Provider::DirectMl => "GPU (DirectML)",
            Provider::Cuda => "NVIDIA GPU (CUDA)",
            Provider::TensorRt => "NVIDIA GPU (TensorRT)",
            Provider::OpenVino => "Intel GPU (OpenVINO)",
            Provider::MiGraphX => "AMD GPU (MIGraphX)",
            Provider::WebGpu => "GPU (WebGPU)",
        }
    }

    /// Whether this build can ask ONNX Runtime for it at all (DirectML is Windows only).
    pub fn built_in(self) -> bool {
        match self {
            Provider::DirectMl => cfg!(windows),
            _ => true,
        }
    }

    /// The providers offered as a compute device, in the order the list shows them. TensorRT
    /// is left out: it compiles an engine for each input shape, which the growing key/value
    /// cache of the decoder changes at every step.
    pub fn offered(self) -> bool {
        self.built_in() && self != Provider::TensorRt
    }
}

/// A provider and the device index it is given (DXGI adapter for DirectML, CUDA device, ...).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Accelerator {
    pub provider: Provider,
    pub device: u32,
}

impl Accelerator {
    pub const CPU: Accelerator = Accelerator { provider: Provider::Cpu, device: 0 };

    pub fn new(provider: Provider, device: u32) -> Accelerator {
        Accelerator { provider, device }
    }
}

/// The quantization of a model folder (`manifest.json`'s `variant`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Variant {
    Float32,
    Float16,
    /// Dynamic int8 quantization of the MatMul weights (`MatMulInteger` and
    /// `DynamicQuantizeLinear`); activations stay float.
    Int8,
    /// int4 weights only, blocks of 32 (`MatMulNBits`); activations stay float.
    Int4,
}

impl Variant {
    pub const ALL: [Variant; 4] = [Variant::Float32, Variant::Float16, Variant::Int8, Variant::Int4];

    pub fn name(self) -> &'static str {
        match self {
            Variant::Float32 => "float32",
            Variant::Float16 => "float16",
            Variant::Int8 => "int8",
            Variant::Int4 => "int4",
        }
    }

    pub fn from_name(name: &str) -> Option<Variant> {
        Variant::ALL.into_iter().find(|v| v.name() == name)
    }
}

/// Whether a variant runs on a provider.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Support {
    /// Measured with real models (CPU only so far).
    Works,
    /// Expected to work from ONNX Runtime's kernels, not run with a real model yet. Offered.
    Untested,
    /// Not offered: the provider lacks the kernels (ONNX Runtime would move those nodes to
    /// the CPU or refuse the graph), or nothing has been checked at all.
    No,
}

/// The variant × provider matrix. Kept in step with the table in
/// `docs/voice-stack/core-integration.md` ("判断が要ること" 34).
pub fn support(variant: Variant, provider: Provider) -> Support {
    use Provider::*;
    use Support::*;
    use Variant::*;
    match (provider, variant) {
        (Cpu, Float32 | Int8) => Works,
        // MatMulNBits has a CPU kernel; quality and speed not measured.
        (Cpu, Int4) => Untested,
        // The CPU provider has few float16 kernels: most nodes would run through casts.
        (Cpu, Float16) => No,
        (DirectMl | Cuda | OpenVino | MiGraphX | WebGpu, Float32 | Float16) => Untested,
        // MatMulNBits has CUDA kernels.
        (Cuda, Int4) => Untested,
        // Offered since 2026-11-19 (decision 75 in docs/voice-stack/core-integration.md): a tiny
        // model gave the CPU's ids on DirectML with both. ONNX Runtime runs any of their
        // operators DirectML lacks on the CPU, quietly; which ones and how fast is not measured.
        (DirectMl, Int8 | Int4) => Untested,
        // Dynamic int8 (MatMulInteger, DynamicQuantizeLinear) and int4 on the other GPU
        // providers are partly or not implemented; not offered until measured.
        (Cuda | OpenVino | MiGraphX | WebGpu, Int8 | Int4) => No,
        (TensorRt, _) => No,
    }
}

/// The compute types a provider offers in the settings, `auto` first. The CPU keeps the
/// values it always listed (`int8_float32` is the same variant as `int8`).
pub fn compute_types(provider: Provider) -> Vec<&'static str> {
    let mut types = vec!["auto"];
    if provider == Provider::Cpu {
        types.extend(["float32", "int8", "int8_float32"]);
    } else {
        types.extend(Variant::ALL.into_iter().filter(|v| support(*v, provider) != Support::No).map(Variant::name));
    }
    if provider == Provider::Cpu && support(Variant::Int4, provider) != Support::No {
        types.push("int4");
    }
    types
}

/// The variants a compute type asks for, best first. `auto` prefers the small fast variant on
/// the CPU (int8) and float16 on a GPU. `None` for a value no provider knows.
pub fn variant_preference(compute_type: &str, provider: Provider) -> Option<Vec<Variant>> {
    let ordered = match compute_type {
        "auto" if provider == Provider::Cpu => vec![Variant::Int8, Variant::Float32, Variant::Int4],
        "auto" => vec![Variant::Float16, Variant::Float32, Variant::Int4, Variant::Int8],
        "int8" | "int8_float32" => vec![Variant::Int8],
        other => vec![Variant::from_name(other)?],
    };
    Some(ordered.into_iter().filter(|v| support(*v, provider) != Support::No).collect())
}

/// The variant to load among those installed, or `None` when none fits.
pub fn choose_variant(compute_type: &str, provider: Provider, installed: &[Variant]) -> Option<Variant> {
    variant_preference(compute_type, provider)?.into_iter().find(|v| installed.contains(v))
}

/// The provider failed to start and the model runs on the CPU instead.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fallback {
    pub requested: Accelerator,
    /// Why, as one of [`codes`].
    pub code: &'static str,
}

/// What [`open_with_fallback`] opened, where, and whether it had to fall back.
#[derive(Debug)]
pub struct Opened<T> {
    pub value: T,
    pub used: Accelerator,
    pub fallback: Option<Fallback>,
}

/// Opens with the requested accelerator, else with the CPU. A fallback is returned to the
/// caller, who reports it; a failure on the CPU is the error.
pub fn open_with_fallback<T>(requested: Accelerator, mut open: impl FnMut(Accelerator) -> Result<T>) -> Result<Opened<T>> {
    if requested.provider == Provider::Cpu {
        return Ok(Opened { value: open(Accelerator::CPU)?, used: Accelerator::CPU, fallback: None });
    }
    let first = if requested.provider.built_in() { open(requested) } else { Err(Error::new(codes::PROVIDER_UNAVAILABLE)) };
    match first {
        Ok(value) => Ok(Opened { value, used: requested, fallback: None }),
        // The model itself cannot change by moving to the CPU.
        Err(error) if matches!(error.code, codes::BUNDLE_INVALID | codes::BUNDLE_MODIFIED) => Err(error),
        Err(error) => {
            let value = open(Accelerator::CPU)?;
            Ok(Opened { value, used: Accelerator::CPU, fallback: Some(Fallback { requested, code: error.code }) })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip() {
        for provider in Provider::ALL {
            assert_eq!(Provider::from_name(provider.name()), Some(provider));
        }
        for variant in Variant::ALL {
            assert_eq!(Variant::from_name(variant.name()), Some(variant));
        }
        assert_eq!(Provider::from_name("rocm"), None);
        assert_eq!(Variant::from_name("int8_float16"), None);
    }

    #[test]
    fn the_cpu_keeps_its_saved_compute_types() {
        assert_eq!(compute_types(Provider::Cpu), ["auto", "float32", "int8", "int8_float32", "int4"]);
        assert_eq!(compute_types(Provider::DirectMl), ["auto", "float32", "float16", "int8", "int4"]);
        assert_eq!(compute_types(Provider::Cuda), ["auto", "float32", "float16", "int4"]);
        assert_eq!(compute_types(Provider::OpenVino), ["auto", "float32", "float16"]);
        assert_eq!(compute_types(Provider::TensorRt), ["auto"]);
    }

    #[test]
    fn a_compute_type_chooses_an_installed_variant() {
        let all = Variant::ALL;
        assert_eq!(choose_variant("auto", Provider::Cpu, &all), Some(Variant::Int8));
        assert_eq!(choose_variant("auto", Provider::Cpu, &[Variant::Float32, Variant::Float16]), Some(Variant::Float32));
        assert_eq!(choose_variant("auto", Provider::DirectMl, &all), Some(Variant::Float16));
        // DirectML takes a float variant first and runs a quantized one when that is all there is.
        assert_eq!(choose_variant("auto", Provider::DirectMl, &[Variant::Int8, Variant::Float32]), Some(Variant::Float32));
        assert_eq!(choose_variant("auto", Provider::DirectMl, &[Variant::Int8]), Some(Variant::Int8));
        assert_eq!(choose_variant("auto", Provider::DirectMl, &[Variant::Int4, Variant::Int8]), Some(Variant::Int4));
        assert_eq!(choose_variant("int8", Provider::DirectMl, &all), Some(Variant::Int8));
        assert_eq!(choose_variant("int4", Provider::DirectMl, &all), Some(Variant::Int4));
        // Other GPUs never run the int8 folder, even when it is the only one.
        assert_eq!(choose_variant("auto", Provider::OpenVino, &[Variant::Int8]), None);
        assert_eq!(choose_variant("auto", Provider::Cuda, &[Variant::Int8]), None);
        assert_eq!(choose_variant("int8_float32", Provider::Cpu, &all), Some(Variant::Int8));
        assert_eq!(choose_variant("float16", Provider::Cpu, &all), None);
        assert_eq!(choose_variant("int4", Provider::Cuda, &[Variant::Int4]), Some(Variant::Int4));
        assert_eq!(choose_variant("float32", Provider::Cpu, &[Variant::Int8]), None);
        assert_eq!(choose_variant("bfloat16", Provider::Cpu, &all), None);
    }

    #[test]
    fn every_offered_compute_type_selects_something_on_its_provider() {
        for provider in Provider::ALL {
            for compute_type in compute_types(provider) {
                assert!(variant_preference(compute_type, provider).is_some(), "{provider:?} {compute_type}");
            }
        }
    }

    fn fake(fails: &'static [Provider], code: &'static str) -> impl FnMut(Accelerator) -> Result<Accelerator> {
        move |at| if fails.contains(&at.provider) { Err(Error::new(code)) } else { Ok(at) }
    }

    #[test]
    fn a_provider_that_starts_is_used() {
        let gpu = Accelerator::new(Provider::Cuda, 1);
        let opened = open_with_fallback(gpu, fake(&[], codes::RUNTIME_FAILED)).unwrap();
        assert_eq!((opened.value, opened.used, opened.fallback), (gpu, gpu, None));
    }

    #[test]
    fn a_provider_that_fails_falls_back_to_the_cpu_and_says_so() {
        let gpu = Accelerator::new(Provider::OpenVino, 0);
        let mut tried = Vec::new();
        let opened = open_with_fallback(gpu, |at| {
            tried.push(at.provider);
            fake(&[Provider::OpenVino], codes::PROVIDER_UNAVAILABLE)(at)
        })
        .unwrap();
        assert_eq!(tried, [Provider::OpenVino, Provider::Cpu]);
        assert_eq!(opened.used, Accelerator::CPU);
        assert_eq!(opened.fallback, Some(Fallback { requested: gpu, code: codes::PROVIDER_UNAVAILABLE }));
    }

    #[test]
    fn a_broken_model_does_not_fall_back_and_the_cpu_failure_is_the_error() {
        let gpu = Accelerator::new(Provider::Cuda, 0);
        let error = open_with_fallback(gpu, fake(&[Provider::Cuda], codes::BUNDLE_INVALID)).unwrap_err();
        assert_eq!(error.code, codes::BUNDLE_INVALID);
        let error = open_with_fallback(gpu, fake(&[Provider::Cuda, Provider::Cpu], codes::RUNTIME_MISSING)).unwrap_err();
        assert_eq!(error.code, codes::RUNTIME_MISSING);
        let error = open_with_fallback(Accelerator::CPU, fake(&[Provider::Cpu], codes::RUNTIME_FAILED)).unwrap_err();
        assert_eq!(error.code, codes::RUNTIME_FAILED);
    }

    #[test]
    fn a_provider_this_platform_lacks_is_not_tried() {
        if cfg!(windows) {
            return;
        }
        let mut tried = Vec::new();
        let opened = open_with_fallback(Accelerator::new(Provider::DirectMl, 0), |at| {
            tried.push(at.provider);
            Ok(())
        })
        .unwrap();
        assert_eq!(tried, [Provider::Cpu]);
        assert_eq!(opened.fallback.unwrap().code, codes::PROVIDER_UNAVAILABLE);
    }
}
