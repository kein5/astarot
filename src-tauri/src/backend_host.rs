//! Runs the Rust backend core (`native/core`) inside the application process (Issue #285).
//!
//! The UI talks to it the way it talked to the Python sidecar before 0.5.0: it writes request
//! lines and reads answer and notification lines (`docs/spec/ipc-protocol.md`). Only the main
//! window may start, write to or stop it, as only the main window could spawn the sidecar. The
//! lines reach the UI through a channel, in order; the end of a run is sent as its exit code.
//!
//! The core is the only backend: the packages carry no Python
//! (`docs/voice-stack/core-integration.md`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use vrct_core::config::{Environment, Platform};
use vrct_core::{Backend, Options, Sink};

#[derive(Default)]
pub struct BackendHost {
    session: Mutex<Option<(String, Backend)>>,
}

/// How long the stop before an update may take. The graceful stop saves the settings first and
/// then stops the servers; past this the run is ended anyway, which still saves the settings.
pub const UPDATE_STOP_LIMIT: Duration = Duration::from_secs(10);

impl BackendHost {
    /// Stops the run when the application ends.
    pub fn shutdown(&self) {
        if let Some((_, backend)) = self.session.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
            backend.kill();
        }
    }

    /// Stops the run the way `/run/shutdown` does and waits for it, up to `limit`: for an exit
    /// that skips RunEvent::Exit (the Windows updater).
    pub fn stop_and_wait(&self, why: &str, limit: Duration) {
        let Some((_, backend)) = self.session.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() else {
            return;
        };
        backend.escalate(why);
        if backend.wait(limit).is_none() {
            backend.kill();
            let _ = backend.wait(Duration::from_secs(3));
        }
    }
}

fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("backend_forbidden".into()) }
}

/// Where settings, logs and models live: the same folders the Python sidecar used, so that a
/// user's settings carry over (`runtime_paths.py`, `config.py`).
/// Where the settings live (config.json), as the backend finds it.
pub(crate) fn state_dir(executable: &Path) -> PathBuf {
    environment(executable, String::new()).state_dir
}

fn environment(executable: &Path, version: String) -> Environment {
    let app_dir = executable.parent().map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let linux_bundle = cfg!(target_os = "linux") && option_env!("VRCT_LINUX_BUNDLE") == Some("1");
    let xdg = |variable: &str, override_variable: &str, fallback: &str| {
        if let Some(dir) = std::env::var_os(override_variable).filter(|v| !v.is_empty()) {
            return PathBuf::from(dir);
        }
        let base = std::env::var_os(variable).map(PathBuf::from).filter(|p| p.is_absolute());
        base.unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(fallback)).join("vrct-vox")
    };
    let configured = std::env::var_os("VRCT_CONFIG_DIR").filter(|v| !v.is_empty()).map(PathBuf::from);
    let state_dir = configured.unwrap_or_else(|| {
        if linux_bundle { xdg("XDG_CONFIG_HOME", "VRCT_CONFIG_DIR", ".config") } else { app_dir.clone() }
    });
    let data_dir = if linux_bundle { xdg("XDG_DATA_HOME", "VRCT_DATA_DIR", ".local/share") } else { app_dir.clone() };
    Environment {
        version,
        state_dir,
        app_dir,
        data_dir,
        platform: Platform::current(),
        // The CPU, and the GPU execution providers of the ONNX Runtime library beside the app
        // (none loaded when no library is there).
        compute_devices: vrct_core::controller::translation::compute_devices(),
        devices: None,
        websocket_token: None,
    }
}

/// The Rust core is the app's backend; the Python sidecar's local translation is gone with it,
/// so the core retires the CTranslate2 weights that backend downloaded (decision 5).
pub const CORE_IS_DEFAULT: bool = true;

/// Starts a run for the UI session `session`. Its lines go to `lines`, its end to `exit`.
#[tauri::command]
pub fn backend_start(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    host: tauri::State<'_, BackendHost>,
    session: String,
    lines: Channel<String>,
    exit: Channel<i32>,
) -> Result<(), String> {
    main_only(&window)?;
    let mut current = host.session.lock().unwrap();
    if let Some((_, previous)) = current.take() {
        // The UI starts again only after a failed run; that run must not keep its ports.
        previous.kill();
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let sink = Sink {
        line: std::sync::Arc::new(move |line| {
            let _ = lines.send(line);
        }),
        exit: std::sync::Arc::new(move |code| {
            let _ = exit.send(code);
        }),
    };
    let mut options = Options::new(environment(&executable, app.package_info().version.to_string()));
    options.services.retire_legacy_translation_weights = CORE_IS_DEFAULT;
    // The update endpoints use the update page's updater (app_update.rs; decision 20).
    options.services.software_updates = std::sync::Arc::new(crate::app_update::CoreUpdates::new(app.clone()));
    if cfg!(debug_assertions) {
        // A development build runs from src-tauri/target; the files a package ships in
        // `_internal` (build/speechcpp, the helper programs) are staged in the checkout's build/.
        vrct_core::resources::use_development_checkout(Path::new(env!("CARGO_MANIFEST_DIR")).join(".."));
    }
    let backend = Backend::start(options, sink);
    *current = Some((session, backend));
    Ok(())
}

fn with_session<T>(host: &BackendHost, session: &str, action: impl FnOnce(&Backend) -> T) -> Result<T, String> {
    let current = host.session.lock().unwrap();
    match current.as_ref() {
        Some((id, backend)) if id == session => Ok(action(backend)),
        _ => Err("backend_session_ended".into()),
    }
}

/// One request line of the session.
#[tauri::command]
pub fn backend_write(window: tauri::WebviewWindow, host: tauri::State<'_, BackendHost>, session: String, line: String) -> Result<(), String> {
    main_only(&window)?;
    with_session(&host, &session, |backend| backend.write_line(&line))
}

/// Ends the session's run, as killing the sidecar did.
#[tauri::command]
pub fn backend_kill(window: tauri::WebviewWindow, host: tauri::State<'_, BackendHost>, session: String) -> Result<(), String> {
    main_only(&window)?;
    let mut current = host.session.lock().unwrap();
    match current.take() {
        Some((id, backend)) if id == session => {
            backend.kill();
            Ok(())
        }
        other => {
            *current = other;
            Ok(())
        }
    }
}
