//! `speech devices --json`: the one child process this crate starts, owned until it is reaped.

use std::io::{self, Read};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// Output beyond this is not a device list (`hardware_invalid`); it is read and dropped.
pub(crate) const OUTPUT_LIMIT: usize = 65536;
const POLL: Duration = Duration::from_millis(5);

/// A started child whose stdout is collected on its own thread. It may be signalled from
/// another thread while its owner waits for it.
pub(crate) struct Owned {
    child: Mutex<Child>,
    output: Mutex<Option<thread::JoinHandle<Vec<u8>>>>,
}

pub(crate) enum Waited {
    Exited(ExitStatus, Vec<u8>),
    TimedOut,
}

/// Starts `<binary> devices --json` without stdin or stderr, with the update check and
/// colours turned off. On Windows it gets no console window.
pub(crate) fn devices_command(binary: &Path) -> Command {
    let mut command = Command::new(binary);
    // Under the AppImage, the host's environment rather than the GUI's (#924, item 22).
    astarot_app_identity::appimage::restore_host_environment(&mut command);
    command.args(["devices", "--json"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).env("SPEECH_NO_UPDATE_CHECK", "1").env("NO_COLOR", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

impl Owned {
    pub fn spawn(mut command: Command) -> io::Result<Arc<Owned>> {
        let mut child = command.spawn()?;
        let stdout = child.stdout.take();
        let output = thread::Builder::new().name("speech-devices-output".into()).spawn(move || {
            let mut kept = Vec::new();
            if let Some(mut stdout) = stdout {
                let mut chunk = [0u8; 8192];
                while let Ok(n) = stdout.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    let room = (OUTPUT_LIMIT + 1).saturating_sub(kept.len());
                    kept.extend_from_slice(&chunk[..n.min(room)]);
                }
            }
            kept
        })?;
        Ok(Arc::new(Owned { child: Mutex::new(child), output: Mutex::new(Some(output)) }))
    }

    /// Waits for the child to exit, at most `timeout`; on time-out it is killed and reaped.
    pub fn wait(&self, timeout: Duration) -> io::Result<Waited> {
        let deadline = Instant::now() + timeout;
        loop {
            let status = self.child.lock().unwrap().try_wait()?;
            if let Some(status) = status {
                let output = self.output.lock().unwrap().take().map(|t| t.join().unwrap_or_default()).unwrap_or_default();
                return Ok(Waited::Exited(status, output));
            }
            if Instant::now() >= deadline {
                self.kill_and_reap(Duration::from_secs(1));
                return Ok(Waited::TimedOut);
            }
            thread::sleep(POLL);
        }
    }

    pub fn running(&self) -> bool {
        matches!(self.child.lock().unwrap().try_wait(), Ok(None))
    }

    /// Asks the child to stop (SIGTERM; on Windows this ends it).
    pub fn terminate(&self) {
        let mut child = self.child.lock().unwrap();
        // Only a child not yet reaped is signalled, so its id cannot have been reused.
        if let Ok(None) = child.try_wait() {
            #[cfg(unix)]
            unsafe {
                libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
            }
            #[cfg(not(unix))]
            {
                let _ = child.kill();
            }
        }
    }

    pub fn kill(&self) {
        let mut child = self.child.lock().unwrap();
        if let Ok(None) = child.try_wait() {
            let _ = child.kill();
        }
    }

    pub fn kill_and_reap(&self, within: Duration) {
        self.kill();
        let deadline = Instant::now() + within;
        while self.running() && Instant::now() < deadline {
            thread::sleep(POLL);
        }
    }
}
