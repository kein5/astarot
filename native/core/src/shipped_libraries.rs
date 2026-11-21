//! The ONNX Runtime and OpenVR client libraries the app loads (issue #509).
//!
//! Chat reading and local translation load ONNX Runtime at run time, and the VR overlay and the
//! chat reading's headset view load the OpenVR client library. Until 0.4 both came with the
//! Python backend; since 0.5.0 the packages ship them on their own (tools/runtime_libraries.py),
//! in `_internal/onnxruntime` and `_internal/openvr`, found like the other shipped files
//! ([`crate::resources`]). Without this, Windows loaded its own older `onnxruntime.dll` from
//! System32, which cannot read the chat reading's model, and the overlay found no OpenVR at all.
//!
//! The packages ship the CPU build of ONNX Runtime only. The GPU builds are fetched when the user
//! asks for them, with their consent (decision 2 (c) of docs/voice-stack/core-integration.md):
//! the CUDA build where an NVIDIA driver is, and the DirectML build on Windows. They are set up
//! like the voice conversion runtimes, under `<settings>/vc_runtimes`
//! (`vrct_voice_conversion::runtime`). The CUDA build also comes with the RVC GPU runtime. When
//! the saved translation device needs one of them and it is set up, the app loads it instead of
//! the shipped one, at start: a process loads one ONNX Runtime library, and chat reading uses
//! the same one.
//!
//! The variables that name a library (`ORT_DYLIB_PATH`, `ASTAROT_OPENVR_API` or
//! `VRCT_OPENVR_API`) still win.
//!
//! Chat reading and translation take the ONNX Runtime library and its one environment from
//! `vrct-onnx-runtime`, so they always share them (`ort` allows one environment per process).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde_json::Value;
use vrct_voice_conversion::runtime::{self as runtimes, InstalledLibraries, Target};

/// ONNX Runtime 1.31.0, the official CPU build, inside `_internal`.
pub const ONNX_RUNTIME: &str = if cfg!(windows) { "onnxruntime/onnxruntime.dll" } else { "onnxruntime/libonnxruntime.so" };
/// The OpenVR client library 2.12.14 (the function tables the core uses), inside `_internal`.
pub const OPENVR: &str = if cfg!(windows) { "openvr/libopenvr_api_64.dll" } else { "openvr/libopenvr_api_64.so" };
/// Where the runtimes the user set up live, inside the settings folder.
pub const RUNTIMES_FOLDER: &str = "vc_runtimes";

/// Stops ONNX Runtime's own usage reports to Microsoft for the app and the processes it starts,
/// such as the voice conversion worker (issue #518). They are not the app's opt-in telemetry and
/// never depend on its consent setting.
///
/// # Safety
///
/// Changes the process environment: call at the start of the app, before other threads run.
pub unsafe fn disable_onnx_runtime_telemetry() {
    unsafe { vrct_onnx_runtime::disable_telemetry_for_process() };
}

/// A GPU build of ONNX Runtime the user set up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GpuBuild {
    /// The device it brings, as the settings name it: `cuda` or `directml`.
    pub device: &'static str,
    /// Its ONNX Runtime library.
    pub library: PathBuf,
    /// The libraries to load before it: NVIDIA's for the CUDA build, DirectML for the DirectML
    /// build. The system's loader does not look for them beside the library.
    pub dependencies: Vec<PathBuf>,
}

/// The GPU builds set up and checked under `<state_dir>/vc_runtimes`: the CUDA build (the app's
/// own runtime, else the RVC GPU runtime's copy of the same files), then the DirectML build.
pub fn gpu_builds(state_dir: &Path) -> Vec<GpuBuild> {
    let Some(target) = Target::current() else { return Vec::new() };
    let root = state_dir.join(RUNTIMES_FOLDER);
    let build = |device, found: InstalledLibraries| GpuBuild {
        device,
        library: found.lib.join(runtimes::onnx_runtime_library(target)),
        dependencies: runtimes::dependencies(&found.runtime).iter().map(|name| found.lib.join(name)).collect(),
    };
    let mut builds = Vec::new();
    if let Some(found) = runtimes::cuda_libraries(&root, target).into_iter().next() {
        builds.push(build("cuda", found));
    }
    if target == Target::Windows
        && let Some(found) = runtimes::directml_libraries(&root)
    {
        builds.push(build("directml", found));
    }
    builds
}

/// The device the saved settings run the local translation on, as `config.json` holds it. The
/// settings are checked later, against the devices of the library loaded here.
fn saved_device(state_dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(state_dir.join("config.json")).ok()?;
    let saved: Value = serde_json::from_str(&text).ok()?;
    saved.get("SELECTED_TRANSLATION_COMPUTE_DEVICE")?.get("device")?.as_str().map(str::to_owned)
}

/// What a start loads.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Choice {
    /// The ONNX Runtime library and those to load before it; none when nothing was found.
    onnx_runtime: Option<(PathBuf, Vec<PathBuf>)>,
    /// The GPU build it is, if it is one.
    gpu: Option<&'static str>,
    openvr: Option<PathBuf>,
    /// A line for the log.
    line: String,
}

/// The GPU build the saved translation device needs, when the user set it up; else the shipped
/// CPU build.
fn choose(app_dir: &Path, state_dir: &Path) -> Choice {
    let wanted = saved_device(state_dir);
    let gpu = wanted.and_then(|device| gpu_builds(state_dir).into_iter().find(|build| build.device == device));
    let shipped = crate::resources::locate(app_dir, ONNX_RUNTIME);
    let (onnx_runtime, onnx_state) = match &gpu {
        Some(build) => (Some((build.library.clone(), build.dependencies.clone())), format!("the {} build set up for translation", build.device)),
        None if shipped.is_file() => (Some((shipped, Vec::new())), "shipped".to_string()),
        None => (None, "not shipped".to_string()),
    };
    let openvr = Some(crate::resources::locate(app_dir, OPENVR)).filter(|path| path.is_file());
    let openvr_state = if openvr.is_some() { "shipped" } else { "not shipped" };
    Choice {
        onnx_runtime,
        gpu: gpu.map(|build| build.device),
        openvr,
        line: format!("Libraries: ONNX Runtime {onnx_state}, OpenVR {openvr_state}"),
    }
}

static CHOSEN: OnceLock<Choice> = OnceLock::new();

/// Points chat reading, translation and OpenVR at their libraries ([`choose`]). Returns a line
/// for the log. The first call decides for the whole process, as ONNX Runtime is loaded once;
/// later calls return the same line. Call before any of them is used, and before the
/// translation's compute devices are listed ([`onnx_runtime_library`]).
pub fn use_libraries(app_dir: &Path, state_dir: &Path) -> String {
    CHOSEN
        .get_or_init(|| {
            // A runtime repair stopped part way gets its earlier libraries back before they are
            // looked for (#517), not only when the voice area starts.
            runtimes::recover_libraries(&state_dir.join(RUNTIMES_FOLDER));
            let choice = choose(app_dir, state_dir);
            if let Some((library, dependencies)) = &choice.onnx_runtime {
                vrct_onnx_runtime::use_library_with(library.clone(), dependencies.clone());
            }
            if let Some(openvr) = &choice.openvr {
                vrct_openvr_client::use_library(openvr.clone());
            }
            choice
        })
        .line
        .clone()
}

/// The ONNX Runtime library the start pointed this process at and those loaded before it: what a
/// repair of the runtime that holds them cannot replace on Windows while the app runs (#880).
/// Empty before [`use_libraries`].
pub fn loaded_onnx_runtime() -> Vec<PathBuf> {
    CHOSEN
        .get()
        .and_then(|choice| choice.onnx_runtime.as_ref())
        .map(|(library, dependencies)| std::iter::once(library.clone()).chain(dependencies.iter().cloned()).collect())
        .unwrap_or_default()
}

/// The ONNX Runtime library the process loads, as the start decided it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OnnxRuntimeLibrary {
    /// The CPU build the packages ship.
    Shipped,
    /// A GPU build the user set up: `cuda` or `directml`.
    Gpu(&'static str),
    /// Another library: `ORT_DYLIB_PATH`, the one beside the executable, or none
    /// ([`use_libraries`] not called, or nothing found).
    Other,
}

/// Which library [`use_libraries`] pointed ONNX Runtime at. `ORT_DYLIB_PATH` wins over it.
pub fn onnx_runtime_library() -> OnnxRuntimeLibrary {
    if std::env::var_os(vrct_onnx_runtime::LIBRARY_VARIABLE).is_some_and(|path| !path.is_empty()) {
        return OnnxRuntimeLibrary::Other;
    }
    match CHOSEN.get() {
        Some(Choice { gpu: Some(device), .. }) => OnnxRuntimeLibrary::Gpu(device),
        Some(Choice { onnx_runtime: Some(_), .. }) => OnnxRuntimeLibrary::Shipped,
        _ => OnnxRuntimeLibrary::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_libraries_are_inside_the_shipped_folder() {
        for relative in [ONNX_RUNTIME, OPENVR] {
            assert!(!Path::new(relative).is_absolute() && !relative.contains(".."), "{relative}");
        }
        assert!(ONNX_RUNTIME.ends_with(std::env::consts::DLL_SUFFIX));
        assert!(OPENVR.ends_with(std::env::consts::DLL_SUFFIX));
    }

    #[test]
    fn missing_libraries_are_reported() {
        let dir = tempfile::tempdir().unwrap();
        let choice = choose(dir.path(), dir.path());
        assert_eq!(choice.line, "Libraries: ONNX Runtime not shipped, OpenVR not shipped");
        assert_eq!((choice.onnx_runtime, choice.gpu, choice.openvr), (None, None, None));
    }

    /// A runtime folder as a finished setup leaves it: every library and network, and the
    /// receipt.
    fn set_up(state_dir: &Path, runtime: &runtimes::Runtime) {
        let folder = state_dir.join(RUNTIMES_FOLDER).join(runtime.id);
        std::fs::create_dir_all(folder.join("lib")).unwrap();
        for library in &runtime.libraries {
            for (_, name) in &library.members {
                std::fs::write(folder.join("lib").join(name), b"").unwrap();
            }
        }
        for asset in &runtime.assets {
            let path = folder.join("assets").join(&asset.path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"").unwrap();
        }
        let receipt = serde_json::json!({ "version": runtimes::version_of(runtime), "id": runtime.id });
        std::fs::write(folder.join("receipt.json"), receipt.to_string()).unwrap();
    }

    fn save_device(state_dir: &Path, device: &str) {
        let saved = serde_json::json!({ "SELECTED_TRANSLATION_COMPUTE_DEVICE": { "device": device, "device_index": 0, "device_name": device } });
        std::fs::write(state_dir.join("config.json"), saved.to_string()).unwrap();
    }

    #[test]
    fn the_saved_device_picks_a_gpu_build_only_when_it_is_set_up() {
        let Some(target) = Target::current() else { return };
        let app = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(app.path().join("_internal").join("onnxruntime")).unwrap();
        let shipped = app.path().join("_internal").join(ONNX_RUNTIME);
        std::fs::write(&shipped, b"").unwrap();
        let state = tempfile::tempdir().unwrap();

        // Nothing saved, or CUDA saved without its build: the shipped CPU build.
        let choice = choose(app.path(), state.path());
        assert_eq!((choice.onnx_runtime, choice.gpu), (Some((shipped.clone(), Vec::new())), None));
        assert_eq!(choice.line, "Libraries: ONNX Runtime shipped, OpenVR not shipped");
        save_device(state.path(), "cuda");
        assert_eq!(choose(app.path(), state.path()).gpu, None);
        // A folder without its receipt is not a setup.
        let cuda = runtimes::onnx_cuda_runtime(target);
        set_up(state.path(), &cuda);
        std::fs::remove_file(state.path().join(RUNTIMES_FOLDER).join(runtimes::ONNX_CUDA).join("receipt.json")).unwrap();
        assert!(gpu_builds(state.path()).is_empty());

        set_up(state.path(), &cuda);
        let choice = choose(app.path(), state.path());
        let lib = state.path().join(RUNTIMES_FOLDER).join(runtimes::ONNX_CUDA).join("lib");
        let (library, dependencies) = choice.onnx_runtime.unwrap();
        assert_eq!(library, lib.join(runtimes::onnx_runtime_library(target)));
        assert_eq!(dependencies, runtimes::dependencies(&cuda).iter().map(|name| lib.join(name)).collect::<Vec<_>>());
        assert!(!dependencies.is_empty());
        assert_eq!(choice.gpu, Some("cuda"));
        assert_eq!(choice.line, "Libraries: ONNX Runtime the cuda build set up for translation, OpenVR not shipped");

        // The CPU saved: the shipped build, although the CUDA build is there.
        save_device(state.path(), "cpu");
        assert_eq!(choose(app.path(), state.path()).gpu, None);

        if target == Target::Windows {
            let directml = runtimes::onnx_directml_runtime();
            set_up(state.path(), &directml);
            save_device(state.path(), "directml");
            let choice = choose(app.path(), state.path());
            let lib = state.path().join(RUNTIMES_FOLDER).join(runtimes::ONNX_DIRECTML).join("lib");
            assert_eq!(choice.onnx_runtime, Some((lib.join("onnxruntime.dll"), vec![lib.join("DirectML.dll")])));
            assert_eq!(choice.gpu, Some("directml"));
            assert_eq!(gpu_builds(state.path()).iter().map(|build| build.device).collect::<Vec<_>>(), ["cuda", "directml"]);
        }
    }

    #[test]
    fn the_rvc_gpu_runtime_serves_as_the_cuda_build() {
        let Some(target) = Target::current() else { return };
        let state = tempfile::tempdir().unwrap();
        let rvc = runtimes::rvc_runtime(target, true);
        set_up(state.path(), &rvc);
        let builds = gpu_builds(state.path());
        let lib = state.path().join(RUNTIMES_FOLDER).join("rvc").join("lib");
        assert_eq!(builds.len(), 1);
        assert_eq!(builds[0].device, "cuda");
        assert_eq!(builds[0].library, lib.join(runtimes::onnx_runtime_library(target)));
        // The RVC CPU runtime brings no GPU build.
        let state = tempfile::tempdir().unwrap();
        set_up(state.path(), &runtimes::rvc_runtime(target, false));
        assert!(gpu_builds(state.path()).is_empty());
    }

    #[test]
    fn an_unreadable_settings_file_keeps_the_shipped_build() {
        let state = tempfile::tempdir().unwrap();
        std::fs::write(state.path().join("config.json"), b"{ not json").unwrap();
        assert_eq!(saved_device(state.path()), None);
        std::fs::write(state.path().join("config.json"), br#"{"SELECTED_TRANSLATION_COMPUTE_DEVICE": "cuda"}"#).unwrap();
        assert_eq!(saved_device(state.path()), None);
        save_device(state.path(), "directml");
        assert_eq!(saved_device(state.path()).as_deref(), Some("directml"));
    }
}
