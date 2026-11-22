//! The ONNX Runtime library and environment of a VRCT-VOX process, shared by chat reading
//! (`native/ocr-runtime`), local translation (`native/translate-onnx`) and the RVC worker
//! (`native/rvc-runtime`).
//!
//! `ort` keeps the first library a process loads and allows one environment per process. When
//! chat reading and translation each built their own, the second one was left without ONNX
//! Runtime for the whole run (issue #509). Every crate therefore takes the library and the
//! environment from here, and only this crate makes an environment.
//!
//! With `load-dynamic` (the default, and the form the app and the RVC worker use) the library is
//! found in this order:
//!
//! 1. `ORT_DYLIB_PATH`, when set and not empty;
//! 2. the library the app ships ([`use_library`], `_internal/onnxruntime`);
//! 3. `onnxruntime.dll` (`libonnxruntime.so`) by name, which `ort` looks for beside the
//!    executable first and then as the system does.
//!
//! [`load`] instead loads exactly the given file, as the RVC worker does with the runtime it was
//! given. Which execution providers exist depends on the library that is loaded (the CPU build,
//! the CUDA build, the DirectML build, ...).
//!
//! Nothing here logs. An error carries ONNX Runtime's message, never model input or output.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use ort::environment::{Environment, EnvironmentBuilder};

/// The name the environment is made with (it appears in ONNX Runtime's own log lines only).
pub const ENVIRONMENT_NAME: &str = "astarot";
/// The variable that names the library to load; it wins over everything else.
pub const LIBRARY_VARIABLE: &str = "ORT_DYLIB_PATH";
/// The variable that stops ONNX Runtime's usage reports before its environment exists.
pub const DISABLE_TELEMETRY_VARIABLE: &str = "ORT_DISABLE_TELEMETRY";

/// Why ONNX Runtime cannot be used.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// The library could not be loaded or the environment could not be made. ONNX Runtime's
    /// message, kept for logs; it names no model input or output.
    Unavailable(String),
    /// [`load`] was called after the environment had been made (by [`load`] or by
    /// [`environment`]): the process keeps the library it loaded first.
    AlreadyLoaded,
}

impl std::fmt::Display for Error {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Unavailable(message) => write!(formatter, "ONNX Runtime is unavailable: {message}"),
            Error::AlreadyLoaded => formatter.write_str("ONNX Runtime was already loaded"),
        }
    }
}

impl std::error::Error for Error {}

/// Stops ONNX Runtime's usage reports for this process and the processes it starts (issue #518).
///
/// The official Linux build (1.31) sets up its uploader when the library makes its first
/// environment: it writes a `deviceid` and an event store under `~/.cache/Microsoft/DeveloperTools`
/// and sends a `ProcessInfo` event to Microsoft. Only `ORT_DISABLE_TELEMETRY` stops that; the
/// environment option (`with_telemetry(false)`, which the environment here also sets) comes too
/// late for the first event and the files. The Windows build writes ETW events instead and
/// honours only the option. These reports are not the app's opt-in telemetry and never depend on
/// its consent setting.
///
/// # Safety
///
/// Changes the process environment: call at the start of `main`, before other threads run.
pub unsafe fn disable_telemetry_for_process() {
    unsafe { std::env::set_var(DISABLE_TELEMETRY_VARIABLE, "1") };
}

/// The file name of the library on this platform.
pub fn library_name() -> String {
    format!("{}onnxruntime{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX)
}

static SHIPPED_LIBRARY: OnceLock<PathBuf> = OnceLock::new();
static DEPENDENCIES: OnceLock<Vec<PathBuf>> = OnceLock::new();

/// The library the app ships (`_internal/onnxruntime`), used when `ORT_DYLIB_PATH` is not set.
/// Call once, before ONNX Runtime is first used; a later call changes nothing.
pub fn use_library(path: PathBuf) {
    use_library_with(path, Vec::new());
}

/// As [`use_library`], for a library that needs others loaded before it: the CUDA build of ONNX
/// Runtime needs NVIDIA's libraries, the DirectML build needs `DirectML.dll`, and the system's
/// loader does not look for them beside the library. They are loaded first when this library is
/// the one loaded (not when `ORT_DYLIB_PATH` names another). One that cannot be loaded leaves
/// ONNX Runtime itself usable on the CPU; the provider that needed it then fails to start.
pub fn use_library_with(path: PathBuf, dependencies: Vec<PathBuf>) {
    if SHIPPED_LIBRARY.set(path).is_ok() {
        let _ = DEPENDENCIES.set(dependencies);
    }
}

/// The libraries to load before ONNX Runtime: those of [`use_library_with`], unless the variable
/// names the library.
#[cfg_attr(not(feature = "load-dynamic"), allow(dead_code))]
fn dependencies_to_load(variable: Option<OsString>) -> Vec<PathBuf> {
    if variable.is_some_and(|path| !path.is_empty()) {
        Vec::new()
    } else {
        DEPENDENCIES.get().cloned().unwrap_or_default()
    }
}

/// Loads each library that can be loaded, again until nothing more can (one may need another
/// listed after it). Returns those that could not be loaded.
#[cfg(feature = "load-dynamic")]
fn preload(mut pending: Vec<PathBuf>) -> Vec<PathBuf> {
    while !pending.is_empty() {
        let before = pending.len();
        pending.retain(|path| ort::util::preload_dylib(path).is_err());
        if pending.len() == before {
            break;
        }
    }
    pending
}

static NOT_PRELOADED: OnceLock<usize> = OnceLock::new();

/// How many of the libraries of [`use_library_with`] could not be loaded before ONNX Runtime
/// (`None` before ONNX Runtime was loaded), for the log.
pub fn dependencies_missing() -> Option<usize> {
    NOT_PRELOADED.get().copied()
}

/// The library [`environment`] loads: `ORT_DYLIB_PATH`, else the shipped one ([`use_library`]),
/// else the bare name.
pub fn library_path() -> PathBuf {
    resolve(std::env::var_os(LIBRARY_VARIABLE), SHIPPED_LIBRARY.get().cloned())
}

/// [`library_path`] from its inputs.
fn resolve(variable: Option<OsString>, shipped: Option<PathBuf>) -> PathBuf {
    variable.filter(|path| !path.is_empty()).map(PathBuf::from).or(shipped).unwrap_or_else(|| library_name().into())
}

/// Whether a library is where [`library_path`] points without searching the system: the given
/// file, or the file beside the executable. Cheap; loads nothing.
pub fn library_present() -> bool {
    let executable_dir = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf));
    present(&library_path(), executable_dir.as_deref())
}

/// [`library_present`] from its inputs.
fn present(path: &Path, executable_dir: Option<&Path>) -> bool {
    if path.is_absolute() {
        return path.is_file();
    }
    executable_dir.is_some_and(|dir| dir.join(path).is_file())
}

static ENVIRONMENT: OnceLock<std::result::Result<Environment, String>> = OnceLock::new();

/// Makes the process's environment from `builder`: named, with ONNX Runtime's telemetry off.
fn make(builder: std::result::Result<EnvironmentBuilder, String>) -> std::result::Result<Environment, String> {
    builder?.with_name(ENVIRONMENT_NAME).with_telemetry(false).build().map_err(|error| error.to_string())
}

/// With `load-dynamic`, the library is loaded here so that a missing one is an error value rather
/// than a panic on first use.
#[cfg(feature = "load-dynamic")]
fn default_builder() -> std::result::Result<EnvironmentBuilder, String> {
    let missing = preload(dependencies_to_load(std::env::var_os(LIBRARY_VARIABLE)));
    let _ = NOT_PRELOADED.set(missing.len());
    ort::init_from(library_path()).map_err(|error| error.to_string())
}

/// Without `load-dynamic`, the crate using this one links ONNX Runtime (`ort/download-binaries`).
#[cfg(not(feature = "load-dynamic"))]
fn default_builder() -> std::result::Result<EnvironmentBuilder, String> {
    Ok(ort::init())
}

/// The process's one ONNX Runtime environment, made on first use from [`library_path`]. A
/// failure is kept: the process does not try another library later.
pub fn environment() -> Result<&'static Environment, Error> {
    ENVIRONMENT.get_or_init(|| make(default_builder())).as_ref().map_err(|message| Error::Unavailable(message.clone()))
}

/// Whether ONNX Runtime can be used in this process, loading it if needed. With a linked build
/// this is always true; a dynamically loaded library may be missing.
pub fn is_available() -> bool {
    environment().is_ok()
}

/// Loads exactly `library` (ignoring `ORT_DYLIB_PATH` and [`use_library`]) and makes the
/// environment from it. Call before anything uses ONNX Runtime: once the environment exists, this
/// returns [`Error::AlreadyLoaded`] and changes nothing.
#[cfg(feature = "load-dynamic")]
pub fn load(library: &Path) -> Result<(), Error> {
    let mut fresh = false;
    let result = ENVIRONMENT.get_or_init(|| {
        fresh = true;
        make(ort::init_from(library).map_err(|error| error.to_string()))
    });
    match (fresh, result) {
        (true, Ok(_)) => Ok(()),
        (true, Err(message)) => Err(Error::Unavailable(message.clone())),
        (false, _) => Err(Error::AlreadyLoaded),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_variable_wins_then_the_shipped_library_then_the_name() {
        let shipped = PathBuf::from("/app/_internal/onnxruntime").join(library_name());
        assert_eq!(resolve(Some("/opt/ort/custom".into()), Some(shipped.clone())), PathBuf::from("/opt/ort/custom"));
        assert_eq!(resolve(Some("".into()), Some(shipped.clone())), shipped);
        assert_eq!(resolve(None, Some(shipped.clone())), shipped);
        assert_eq!(resolve(None, None), PathBuf::from(library_name()));
        assert_eq!(resolve(Some("".into()), None), PathBuf::from(library_name()));
    }

    #[test]
    fn the_variable_also_leaves_out_the_chosen_librarys_dependencies() {
        // Nothing chosen in this test process: no dependencies either way.
        assert!(dependencies_to_load(None).is_empty());
        assert!(dependencies_to_load(Some("/opt/ort/custom".into())).is_empty());
    }

    #[test]
    fn the_library_name_is_the_platform_one() {
        let name = library_name();
        if cfg!(windows) {
            assert_eq!(name, "onnxruntime.dll");
        } else if cfg!(target_os = "macos") {
            assert_eq!(name, "libonnxruntime.dylib");
        } else {
            assert_eq!(name, "libonnxruntime.so");
        }
    }

    #[test]
    fn presence_looks_at_the_file_or_beside_the_executable_only() {
        let dir = std::env::temp_dir().join(format!("vrct-onnx-runtime-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(library_name());
        assert!(!present(&file, None));
        assert!(!present(Path::new(&library_name()), Some(&dir)));
        std::fs::write(&file, b"").unwrap();
        assert!(present(&file, None));
        assert!(present(Path::new(&library_name()), Some(&dir)));
        // A bare name is never searched for on the system.
        assert!(!present(Path::new(&library_name()), None));
        // A folder is not a library.
        assert!(!present(&dir, None));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn errors_say_what_happened() {
        assert_eq!(Error::AlreadyLoaded.to_string(), "ONNX Runtime was already loaded");
        assert_eq!(Error::Unavailable("not found".into()).to_string(), "ONNX Runtime is unavailable: not found");
    }
}
