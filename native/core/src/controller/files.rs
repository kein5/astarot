//! Folders the user asks to open: the settings and log folders (`openFilepathConfigFile`,
//! `openFilepathLogs`), and the folder the term dictionary is written out to (#792).
//!
//! Up to 0.5 this also counted and removed, on request, the Whisper weights 0.2 and earlier
//! downloaded (`/get/data/old_whisper_weights`, `/run/delete_old_whisper_weights`). That screen
//! went in 0.6.0 (#288); the folder `<data>/weights/whisper` is no longer looked at.

use super::routes::{Builder, OPEN};
use super::{Core, ok, ok_true};
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// Where the term dictionary is written out: a folder of its own beside the settings.
fn exports_dir(core: &Core) -> PathBuf {
    core.config().environment().state_dir.join("exports")
}

/// Shows a folder in the system's file manager.
fn open_folder(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(not(windows))]
    let program = "xdg-open";
    let mut command = std::process::Command::new(program);
    // Under the AppImage, the file manager gets the host's environment, not the GUI's (#924, item 22).
    astarot_app_identity::appimage::restore_host_environment(&mut command);
    let mut child = command.arg(path).spawn()?;
    // Waited for on a thread of its own: a child nobody waits for stays a zombie on Linux until
    // the app ends, one more for every click.
    let _ = std::thread::Builder::new().name("open_folder_wait".into()).spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

impl Core {
    /// `/run/export_vocabulary` (#792): the dictionary the settings page shows, written out as a
    /// file the page reads back (`voice_settings::vocabulary_file`). What is written is checked as
    /// a saved dictionary is; the answer names the file. Nothing of it reaches the log: the
    /// endpoint's name holds "vocabulary".
    fn export_vocabulary(&self, data: &Value) -> Reply {
        let Ok(vocabulary) = crate::voice_settings::normalize_vocabulary(Some(data)) else {
            // As a refused setting is answered (`realtime_asr.rs`): the code the settings page reads.
            return Reply::status(400, json!({ "error_code": "realtime_vocabulary_invalid" }));
        };
        let dir = exports_dir(self);
        let name = crate::local_time::vocabulary_export_name(&crate::local_time::now());
        let written = std::fs::create_dir_all(&dir)
            .and_then(|()| std::fs::write(dir.join(&name), crate::voice_settings::vocabulary_file(&vocabulary)));
        match written {
            Ok(()) => ok(json!({ "file": name })),
            Err(_) => Reply::status(500, "Internal error"),
        }
    }

    fn open_folder_reply(&self, path: &Path) -> Reply {
        match open_folder(path) {
            Ok(()) => ok_true(),
            // Python let a failed start raise: 500.
            Err(_) => Reply::status(500, "Internal error"),
        }
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.get("/get/data/path_config", OPEN, "PATH_CONFIG");
    b.with("/run/open_filepath_config_file", OPEN, |core, _| core.open_folder_reply(&core.config().environment().state_dir));
    b.with("/run/open_filepath_logs", OPEN, |core, _| core.open_folder_reply(&core.conversation_log_directory()));
    b.with("/run/export_vocabulary", OPEN, |core, data| core.export_vocabulary(data));
    // The folder is made when it is asked for before anything was written out.
    b.with("/run/open_filepath_vocabulary_exports", OPEN, |core, _| {
        let dir = exports_dir(core);
        let _ = std::fs::create_dir_all(&dir);
        core.open_folder_reply(&dir)
    });
}
