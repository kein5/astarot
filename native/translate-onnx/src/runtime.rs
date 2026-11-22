//! The ONNX Runtime library of the process and the execution providers it was built with.
//!
//! The library and the environment come from `astarot-onnx-runtime`, which chat reading
//! (`native/ocr-runtime`) uses too: `ort` keeps the first library a process loads and allows one
//! environment per process, so the two always share them (issue #509). With `load-dynamic` (the
//! default, and the only form the app uses) the library is `ORT_DYLIB_PATH`, else the one the
//! app ships, else `onnxruntime.dll` (`libonnxruntime.so`) by name. Which execution providers
//! exist depends on that library (the CPU build, the DirectML build, the CUDA build, ...).

use ort::environment::Environment;

use crate::accelerate::Provider;
use crate::{codes, Error, Result};

/// The process's ONNX Runtime environment, made on first use.
pub(crate) fn environment() -> Result<&'static Environment> {
    astarot_onnx_runtime::environment().map_err(|_| Error::new(codes::RUNTIME_MISSING))
}

/// Whether the loaded library was built with a provider.
fn has(provider: Provider) -> bool {
    use ort::ep::ExecutionProvider;
    let found = match provider {
        Provider::Cpu => ort::ep::CPU::is_available(),
        #[cfg(windows)]
        Provider::DirectMl => ort::ep::DirectML::is_available(),
        #[cfg(not(windows))]
        Provider::DirectMl => Ok(false),
        Provider::Cuda => ort::ep::CUDA::is_available(),
        Provider::TensorRt => ort::ep::TensorRT::is_available(),
        Provider::OpenVino => ort::ep::OpenVINO::is_available(),
        Provider::MiGraphX => ort::ep::MIGraphX::is_available(),
        Provider::WebGpu => ort::ep::WebGPU::is_available(),
    };
    found.unwrap_or(false)
}

/// The providers the loaded library was built with, loading it if needed. Being built with a
/// provider does not mean the PC has the device; a session that cannot start falls back to the
/// CPU ([`crate::accelerate::open_with_fallback`]).
pub fn available_providers() -> Result<Vec<Provider>> {
    environment()?;
    Ok(Provider::ALL.into_iter().filter(|p| p.built_in() && has(*p)).collect())
}
