//! Folders the user asks to open: the settings and log folders (`openFilepathConfigFile`,
//! `openFilepathLogs`).
//!
//! Up to 0.5 this also counted and removed, on request, the Whisper weights 0.2 and earlier
//! downloaded (`/get/data/old_whisper_weights`, `/run/delete_old_whisper_weights`). That screen
//! went in 0.6.0 (#288); the folder `<data>/weights/whisper` is no longer looked at.

use super::routes::{Builder, OPEN};
use super::{Core, ok_true};
use crate::protocol::Reply;
use std::path::Path;

/// Shows a folder in the system's file manager.
fn open_folder(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(not(windows))]
    let program = "xdg-open";
    let mut child = std::process::Command::new(program).arg(path).spawn()?;
    // Waited for on a thread of its own: a child nobody waits for stays a zombie on Linux until
    // the app ends, one more for every click.
    let _ = std::thread::Builder::new().name("open_folder_wait".into()).spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

impl Core {
    fn open_folder_reply(&self, path: &Path) -> Reply {
        match open_folder(path) {
            Ok(()) => ok_true(),
            // Python let a failed start raise: 500.
            Err(_) => Reply::status(500, "Internal error"),
        }
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/run/open_filepath_config_file", OPEN, |core, _| core.open_folder_reply(&core.config().environment().state_dir));
    b.with("/run/open_filepath_logs", OPEN, |core, _| core.open_folder_reply(&core.config().environment().state_dir.join("logs")));
}
