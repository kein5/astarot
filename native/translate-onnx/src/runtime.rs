//! The ONNX Runtime library, loaded once for the process.
//!
//! With `load-dynamic` (the default, and the only form the app uses) the library is found the
//! way chat reading finds it (`native/ocr-runtime`): `ORT_DYLIB_PATH`, else `onnxruntime.dll`
//! (`libonnxruntime.so`) beside the executable, else by name. `ort` keeps the first library a
//! process loads, so chat reading and translation always share one; which execution providers
//! exist depends on that library (the CPU build, the DirectML build, the CUDA build, ...).
//!
//! `ort` also allows only one environment per process. In the app, chat reading makes it and
//! translation uses it ([`share`]): two crates each building their own left the second one
//! without ONNX Runtime for the whole run (issue #509). The comparison command and the tests,
//! which run translation alone, build their own here.

use std::path::PathBuf;
use std::sync::OnceLock;

use ort::environment::Environment;

use crate::accelerate::Provider;
use crate::{codes, Error, Result};

/// The environment and library of the process, from whoever made them (in the app,
/// `ocr_runtime::engine`).
#[derive(Clone, Copy)]
pub struct Shared {
    /// The process's one environment, made on first use.
    pub environment: fn() -> std::result::Result<&'static Environment, String>,
    /// The library that environment loads.
    pub library_path: fn() -> PathBuf,
}

static SHARED: OnceLock<Shared> = OnceLock::new();

/// Uses `shared` instead of an environment of this crate's own. Call once, before translation
/// is first used; a later call changes nothing.
pub fn share(shared: Shared) {
    let _ = SHARED.set(shared);
}

/// The file name of the library on this platform.
pub fn library_name() -> String {
    format!("{}onnxruntime{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX)
}

/// The library to load: the shared one ([`share`]), else `ORT_DYLIB_PATH` when set, else the
/// bare name (which `ort` resolves beside the executable first).
pub fn library_path() -> PathBuf {
    if let Some(shared) = SHARED.get() {
        return (shared.library_path)();
    }
    std::env::var_os("ORT_DYLIB_PATH").filter(|path| !path.is_empty()).map(PathBuf::from).unwrap_or_else(|| library_name().into())
}

/// Whether a library is where [`library_path`] points without searching the system: the
/// given file, or the file beside the executable. Cheap; loads nothing.
pub fn library_present() -> bool {
    let path = library_path();
    if path.is_absolute() {
        return path.is_file();
    }
    std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(&path))).is_some_and(|p| p.is_file())
}

#[cfg(feature = "load-dynamic")]
fn builder() -> std::result::Result<ort::environment::EnvironmentBuilder, ()> {
    ort::init_from(library_path()).map_err(|_| ())
}

#[cfg(not(feature = "load-dynamic"))]
fn builder() -> std::result::Result<ort::environment::EnvironmentBuilder, ()> {
    Ok(ort::init())
}

/// The process's ONNX Runtime environment: the shared one, or one of this crate's own, made on
/// first use.
pub(crate) fn environment() -> Result<&'static Environment> {
    if let Some(shared) = SHARED.get() {
        return (shared.environment)().map_err(|_| Error::new(codes::RUNTIME_MISSING));
    }
    static ENVIRONMENT: OnceLock<std::result::Result<Environment, ()>> = OnceLock::new();
    ENVIRONMENT
        .get_or_init(|| builder()?.with_name("vrct-translate").build().map_err(|_| ()))
        .as_ref()
        .map_err(|_| Error::new(codes::RUNTIME_MISSING))
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
