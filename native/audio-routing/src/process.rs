//! Running the small native helpers and system tools.
//!
//! Their output is never logged or put into an error: only exit status counts.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The environment external processes get. The host application builds it the way
/// `runtime_paths.external_process_env()` does (without backend-only variables, with
/// the user's own library path); by default it is this process's environment, with the host's
/// values back under the AppImage (#924, item 22).
#[derive(Debug, Clone)]
pub struct ProcessEnv {
    pub vars: Vec<(OsString, OsString)>,
}

impl Default for ProcessEnv {
    fn default() -> Self {
        let mut env = Self { vars: std::env::vars_os().collect() };
        for (name, value) in astarot_app_identity::appimage::host_environment(|name| std::env::var(name).ok()) {
            match value {
                Some(value) => env.set(name, &value),
                None => env.vars.retain(|(key, _)| key != name),
            }
        }
        env
    }
}

impl ProcessEnv {
    pub fn from_pairs<K: Into<OsString>, V: Into<OsString>>(pairs: impl IntoIterator<Item = (K, V)>) -> Self {
        Self { vars: pairs.into_iter().map(|(k, v)| (k.into(), v.into())).collect() }
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.vars.iter().rev().find(|(k, _)| k == key).and_then(|(_, v)| v.to_str().map(str::to_owned))
    }

    pub fn set(&mut self, key: &str, value: &str) {
        self.vars.retain(|(k, _)| k != key);
        self.vars.push((key.into(), value.into()));
    }

    /// A command with exactly this environment, no input and no inherited output.
    pub fn command(&self, program: impl AsRef<Path>) -> Command {
        let mut command = Command::new(program.as_ref());
        command.env_clear().envs(self.vars.iter().map(|(k, v)| (k, v))).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        command
    }

    /// `shutil.which(name, path=PATH)`.
    pub fn which(&self, name: &str) -> Option<PathBuf> {
        let path = self.get("PATH")?;
        std::env::split_paths(&path).map(|dir| dir.join(name)).find(|candidate| is_executable(candidate))
    }
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// How a bounded run ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunError {
    /// Could not start.
    Spawn,
    /// Did not end in time; it was killed.
    Timeout,
    /// Ended with a failure status.
    Failed,
}

/// Run `command` to completion within `timeout`, capturing its standard output.
pub fn run(mut command: Command, timeout: Duration) -> Result<String, RunError> {
    command.stdout(Stdio::piped());
    let mut child = command.spawn().map_err(|_| RunError::Spawn)?;
    let stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut stdout) = stdout {
            use std::io::Read;
            let _ = stdout.read_to_string(&mut text);
        }
        text
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(RunError::Timeout);
            }
        }
    };
    let text = reader.join().unwrap_or_default();
    if status.success() {
        Ok(text)
    } else {
        Err(RunError::Failed)
    }
}
