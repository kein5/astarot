//! Runs the Rust backend core (`native/core`) inside the application process (Issue #285).
//!
//! The UI talks to it the way it talked to the Python sidecar before 0.5.0: it writes request
//! lines and reads answer and notification lines (`docs/spec/ipc-protocol.md`). Only the main
//! window may start or stop it, as only the main window could spawn the sidecar. The lines reach
//! the UI through a channel, in order; the end of a run is sent as its exit code.
//!
//! The settings window (#1236) joins the main window's run: it may attach its own channels,
//! which then get every line too, in the same order, and it may write requests. So both windows
//! read every answer, and a setting changed in one is changed in the other. When the run ends, the
//! settings window hears it and joins the next run the main window starts.
//!
//! The core is the only backend: the packages carry no Python
//! (`docs/voice-stack/core-integration.md`).

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::Manager;
use astarot_core::config::{Environment, Platform};
use astarot_core::dispatch::SETTINGS_WINDOW_ORIGIN;
use astarot_core::{Backend, Options, Sink};

#[derive(Default)]
pub struct BackendHost {
    session: Mutex<Option<(String, Backend)>>,
    // The run the settings window may join, and its channels while it has joined (#1236).
    joining: Mutex<Joining<Attached>>,
}

struct Attached {
    lines: Channel<String>,
    exit: Channel<i32>,
}

/// The settings window's part in the runs (#1236). A run that has ended stays the session until the
/// main window starts the next one; the settings window may not join it then, as it would read
/// nothing more and write to nothing. Every run's lines and end go to the channels that joined that
/// run, never to those of the next one: a run stopped late, after the next one started, says
/// nothing to it.
struct Joining<C> {
    // The session whose run is going.
    live: Option<String>,
    attached: Option<(String, C)>,
}

impl<C> Default for Joining<C> {
    fn default() -> Self {
        Self { live: None, attached: None }
    }
}

impl<C> Joining<C> {
    /// The run of `session` has started. Answers the channels of a run before it that are still
    /// attached: that run is over, and they hear its end.
    fn begin(&mut self, session: &str) -> Option<C> {
        self.live = Some(session.to_string());
        match self.attached.take() {
            Some((id, channels)) if id != session => Some(channels),
            other => {
                self.attached = other;
                None
            }
        }
    }

    /// The settings window joins the run that is going: answers its session.
    fn join(&mut self, channels: C) -> Result<String, String> {
        let Some(session) = self.live.clone() else {
            return Err("backend_not_running".into());
        };
        self.attached = Some((session.clone(), channels));
        Ok(session)
    }

    /// The channels that joined the run of `session`.
    fn of(&self, session: &str) -> Option<&C> {
        self.attached.as_ref().filter(|(id, _)| id == session).map(|(_, channels)| channels)
    }

    /// The run of `session` has ended: answers the channels that joined it, which hear its end.
    fn end(&mut self, session: &str) -> Option<C> {
        if self.live.as_deref() == Some(session) {
            self.live = None;
        }
        match self.attached.take() {
            Some((id, channels)) if id == session => Some(channels),
            other => {
                self.attached = other;
                None
            }
        }
    }

    fn detach(&mut self) {
        self.attached = None;
    }
}

/// How long the stop before an update may take. The graceful stop saves the settings first and
/// then stops the servers; past this the run is ended anyway, which still saves the settings.
pub const UPDATE_STOP_LIMIT: Duration = Duration::from_secs(10);
/// How long a new run waits for the failed one it replaces to stop. Past this it starts anyway,
/// as before.
const RETRY_STOP_LIMIT: Duration = Duration::from_secs(10);

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

/// The windows that may write requests: the main window, and the settings window (#1236).
fn writer(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" || window.label() == crate::settings_window::LABEL { Ok(()) } else { Err("backend_forbidden".into()) }
}

impl BackendHost {
    fn joining(&self) -> std::sync::MutexGuard<'_, Joining<Attached>> {
        self.joining.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The settings window went away: its channels get no more lines.
    pub fn detach(&self) {
        self.joining().detach();
    }
}

/// Where the settings live (config.json), as the backend finds it. Only the folders: the start-up
/// reads it before the window shows, and the compute devices would start ONNX Runtime (#425).
pub(crate) fn state_dir(executable: &Path) -> PathBuf {
    folders(executable).state_dir
}

/// Where settings, logs and models live: the same folders the Python sidecar used, so that a
/// user's settings carry over ([`runtime_paths.py`], [`config.py`]). They are settled once per process
/// ([`settle_folders`]), and every reader gets the same answer.
///
/// [`runtime_paths.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/runtime_paths.py
/// [`config.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/config.py
#[derive(Clone)]
struct Folders {
    state_dir: PathBuf,
    app_dir: PathBuf,
    data_dir: PathBuf,
}

static FOLDERS: OnceLock<Folders> = OnceLock::new();

/// Settles the folders at the start, before anything reads them, and answers the line for the
/// start-up log when the Linux packages' folders were looked at, or when the Windows installer
/// moved the install folder. On Linux the folders of 0.5.x move from `vrct-vox` to `astarot`
/// (ADR-014, 2.4; `astarot_core::storage::linux`), which first asks the session bus whether another
/// ASTAROT or VRCT-VOX runs: call it after the start has set its environment variables, as that
/// starts a thread. On Windows the paths saved under the folder the installer moved from are
/// rewritten (2.5; `astarot_core::storage::installer`).
pub(crate) fn settle_folders(executable: &Path) -> Option<String> {
    let mut line = None;
    FOLDERS.get_or_init(|| {
        let (folders, summary) = resolve(executable);
        line = summary;
        folders
    });
    line
}

fn folders(executable: &Path) -> Folders {
    FOLDERS.get_or_init(|| resolve(executable).0).clone()
}

fn resolve(executable: &Path) -> (Folders, Option<String>) {
    use astarot_app_identity::env::{CONFIG_DIR, DATA_DIR};
    let app_dir = executable.parent().map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    #[cfg(target_os = "linux")]
    if option_env!("ASTAROT_LINUX_BUNDLE") == Some("1") {
        use astarot_core::storage::linux::{Location, other_instance, settle};
        let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
        // ASTAROT_CONFIG_DIR and ASTAROT_DATA_DIR, or the VRCT_ names 0.5.x documented, name a
        // folder that is used as it is. Otherwise the XDG folder, under its old and new names.
        let location = |configured: astarot_app_identity::env::Variable, variable: &str, fallback: &str| match configured.value_os() {
            Some(dir) => Location::Given(PathBuf::from(dir)),
            None => {
                let base = std::env::var_os(variable).map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| home.join(fallback));
                let name = astarot_app_identity::LINUX_FOLDER;
                Location::Default { legacy: base.join(name.legacy), current: base.join(name.current()) }
            }
        };
        let settled = settle(location(CONFIG_DIR, "XDG_CONFIG_HOME", ".config"), location(DATA_DIR, "XDG_DATA_HOME", ".local/share"), other_instance);
        let line = settled.summary();
        return (Folders { state_dir: settled.state_dir, app_dir, data_dir: settled.data_dir }, Some(line));
    }
    let state_dir = CONFIG_DIR.value_os().map_or_else(|| app_dir.clone(), PathBuf::from);
    // Windows keeps the settings and models in the install folder. When the installer moved it
    // from VRCT-VOX to ASTAROT it left a file naming the old folder (ADR-014, 2.5): the paths
    // saved under the old folder are rewritten here, before anything reads the settings.
    let line = cfg!(windows)
        .then(|| astarot_core::storage::installer::take_installer_move(&app_dir, &state_dir))
        .flatten()
        .map(|taken| taken.summary());
    (Folders { state_dir, data_dir: app_dir.clone(), app_dir }, line)
}

fn environment(executable: &Path, version: String) -> Environment {
    let Folders { state_dir, app_dir, data_dir } = folders(executable);
    // The ONNX Runtime library first (the shipped CPU build, or the GPU build the user set up
    // for translation): the compute devices are its execution providers.
    astarot_core::shipped_libraries::use_libraries(&app_dir, &state_dir);
    // The CPU, the GPU provider of the library chosen, and the GPU builds set up that need a
    // restart.
    let compute_devices = astarot_core::controller::translation::compute_devices_for(&state_dir);
    Environment {
        version,
        state_dir,
        app_dir,
        data_dir,
        platform: Platform::current(),
        compute_devices,
        devices: None,
        websocket_token: None,
    }
}

/// The Rust core is the app's backend; the Python sidecar's local translation is gone with it,
/// so the core retires the CTranslate2 weights that backend downloaded (decision 5).
pub const CORE_IS_DEFAULT: bool = true;

/// One start at a time: a second one waits until the first has its run.
static STARTING: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());

/// Starts a run for the UI session `session`. Its lines go to `lines`, its end to `exit`.
///
/// Async, so that neither waiting for a failed run to stop (up to `RETRY_STOP_LIMIT`) nor the
/// start itself holds up the main thread, which every window, the tray and the hotkeys need
/// (Issues #456, #561). The start runs on a blocking worker thread. What it does before the run's
/// own threads take over uses no COM and nothing tied to its thread: ONNX Runtime's environment
/// and its list of execution providers (the compute devices), the log, `config.json` and the key
/// store (DPAPI and the credential store). Audio devices (WASAPI) are listed later, on the run's
/// threads, which set up their own COM. The tests and the example programs have always started
/// runs from threads without COM.
#[tauri::command]
pub async fn backend_start(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session: String,
    lines: Channel<String>,
    exit: Channel<i32>,
) -> Result<(), String> {
    main_only(&window)?;
    let _starting = STARTING.lock().await;
    let host = app.state::<BackendHost>();
    let previous = host.session.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
    let continue_logs = previous.is_some();
    if let Some((_, previous)) = previous {
        // The UI starts again only after a failed run; that run must not keep its ports, and its
        // last save must not overwrite the new run's settings, so its stop is waited for.
        tauri::async_runtime::spawn_blocking(move || {
            previous.kill_and_wait(RETRY_STOP_LIMIT);
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    let target = app.clone();
    // A start that panics answers as one that never reported back did on the main thread.
    tauri::async_runtime::spawn_blocking(move || start_run(&target, session, lines, exit, continue_logs))
        .await
        .unwrap_or_else(|_| Err("backend_start_failed".into()))
}

/// The start itself, on a blocking worker thread.
fn start_run(
    app: &tauri::AppHandle,
    session: String,
    lines: Channel<String>,
    exit: Channel<i32>,
    continue_logs: bool,
) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    // Every line to the main window, and to the settings window while it has joined this run (#1236).
    let line_app = app.clone();
    let exit_app = app.clone();
    let line_session = session.clone();
    let exit_session = session.clone();
    let sink = Sink {
        line: std::sync::Arc::new(move |line| {
            if let Some(attached) = line_app.state::<BackendHost>().joining().of(&line_session) {
                let _ = attached.lines.send(line.clone());
            }
            let _ = lines.send(line);
        }),
        exit: std::sync::Arc::new(move |code| {
            // The run is over for the settings window too: it hears the end, and joins the next
            // run when the main window starts one.
            let ended = exit_app.state::<BackendHost>().joining().end(&exit_session);
            if let Some(attached) = ended {
                let _ = attached.exit.send(code);
            }
            let _ = exit.send(code);
        }),
    };
    if cfg!(debug_assertions) {
        // A development build runs from src-tauri/target; the files a package ships in
        // `_internal` (build/speechcpp, the helper programs) are staged in the checkout's build/.
        // Before the environment, which looks for the ONNX Runtime library.
        astarot_core::resources::use_development_checkout(Path::new(env!("CARGO_MANIFEST_DIR")).join(".."));
    }
    let mut options = Options::new(environment(&executable, app.package_info().version.to_string()));
    // A run started again keeps the failed run's record in process.log.
    options.continue_logs = continue_logs;
    options.services.retire_legacy_translation_weights = CORE_IS_DEFAULT;
    // The update endpoints use the update page's updater (app_update.rs; decision 20).
    options.services.software_updates = std::sync::Arc::new(crate::app_update::CoreUpdates::new(app.clone()));
    #[cfg(target_os = "linux")]
    {
        options.services.talk_screen = std::sync::Arc::new(crate::portal_screencast::open_talk_screen);
    }
    let backend = Backend::start(options, sink);
    let host = app.state::<BackendHost>();
    let id = session.clone();
    *host.session.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((session, backend));
    // After the session, so that a settings window that joins it can write at once.
    let stale = host.joining().begin(&id);
    // A settings window still on the run this one replaced (its stop took too long to be heard)
    // hears that run's end. Then it may join this one.
    if let Some(attached) = stale {
        let _ = attached.exit.send(-1);
    }
    crate::settings_window::run_started(app);
    Ok(())
}

fn with_session<T>(host: &BackendHost, session: &str, action: impl FnOnce(&Backend) -> T) -> Result<T, String> {
    let current = host.session.lock().unwrap();
    match current.as_ref() {
        Some((id, backend)) if id == session => Ok(action(backend)),
        _ => Err("backend_session_ended".into()),
    }
}

/// One request line of the session, from the main window or the settings window. The settings
/// window's lines are named its own here, whatever the page wrote, so the core answers them so and
/// each window tells its answers from the other's (#1236).
#[tauri::command]
pub fn backend_write(window: tauri::WebviewWindow, host: tauri::State<'_, BackendHost>, session: String, line: String) -> Result<(), String> {
    writer(&window)?;
    let line = if window.label() == crate::settings_window::LABEL { with_origin(&line, SETTINGS_WINDOW_ORIGIN) } else { line };
    with_session(&host, &session, |backend| backend.write_line(&line))
}

/// The request line with its origin set to `origin`. A line that is not a JSON object is left as
/// it is: the core answers it as one it cannot read.
fn with_origin(line: &str, origin: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(serde_json::Value::Object(mut object)) => {
            object.insert("origin".into(), serde_json::Value::String(origin.into()));
            serde_json::Value::Object(object).to_string()
        }
        _ => line.to_string(),
    }
}

/// The settings window joins the run the main window started (#1236): from now on its channels
/// get every line and the run's end. Answers the session, which its requests name. A run that
/// is not there yet (the main window is still starting it), or that has ended, answers
/// `backend_not_running`: the settings window asks again, and joins the next run when it starts.
#[tauri::command]
pub fn backend_attach(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, BackendHost>,
    lines: Channel<String>,
    exit: Channel<i32>,
) -> Result<String, String> {
    if window.label() != crate::settings_window::LABEL {
        return Err("backend_forbidden".into());
    }
    host.joining().join(Attached { lines, exit })
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

#[cfg(test)]
mod tests {
    use super::{Joining, with_origin};
    use serde_json::{Value, json};

    #[test]
    fn the_settings_window_joins_only_a_run_that_is_going() {
        let mut joining = Joining::<&str>::default();
        // No run yet: the main window is still starting it.
        assert_eq!(joining.join("early"), Err("backend_not_running".into()));
        assert_eq!(joining.begin("a"), None);
        assert_eq!(joining.join("window"), Ok("a".into()));
        assert_eq!(joining.of("a"), Some(&"window"));
        // The run ends: the window hears it, and may not join the run that has ended.
        assert_eq!(joining.end("a"), Some("window"));
        assert_eq!(joining.of("a"), None);
        assert_eq!(joining.join("again"), Err("backend_not_running".into()));
        // The next run: the window joins it, and the first run's end, heard late, is not its.
        assert_eq!(joining.begin("b"), None);
        assert_eq!(joining.join("window"), Ok("b".into()));
        assert_eq!(joining.end("a"), None);
        assert_eq!(joining.of("a"), None);
        assert_eq!(joining.of("b"), Some(&"window"));
        // Closed, the window gets no more lines.
        joining.detach();
        assert_eq!(joining.of("b"), None);
    }

    #[test]
    fn a_run_started_over_a_window_still_on_the_last_one_ends_that_one_for_it() {
        let mut joining = Joining::<&str>::default();
        joining.begin("a");
        assert_eq!(joining.join("window"), Ok("a".into()));
        // The main window started again before the end of "a" was heard.
        assert_eq!(joining.begin("b"), Some("window"));
        assert_eq!(joining.of("a"), None);
        // The end of "a", heard after, ends nothing of "b".
        assert_eq!(joining.end("a"), None);
        assert_eq!(joining.join("window"), Ok("b".into()));
    }

    #[test]
    fn the_settings_windows_lines_are_named_its_own() {
        let named: Value = serde_json::from_str(&with_origin(r#"{"endpoint": "/get/data/ui_language"}"#, "settings")).unwrap();
        assert_eq!(named, json!({ "endpoint": "/get/data/ui_language", "origin": "settings" }));
        // Whatever the page wrote: it cannot pass as the VR panel's relay.
        let replaced: Value = serde_json::from_str(&with_origin(r#"{"endpoint": "/x", "origin": "vr_panel"}"#, "settings")).unwrap();
        assert_eq!(replaced["origin"], "settings");
        // A line the core cannot read stays as it is.
        assert_eq!(with_origin("not json", "settings"), "not json");
        assert_eq!(with_origin("[1]", "settings"), "[1]");
    }
}
