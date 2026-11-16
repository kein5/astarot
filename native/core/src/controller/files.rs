//! Files and folders the user asks about: the Whisper weights older versions downloaded
//! (`models/transcription/old_whisper_weights.py`), and opening the settings and log folders
//! (`openFilepathConfigFile`, `openFilepathLogs`).
//!
//! The old Whisper weights are looked at and removed only when the UI asks. Only the folders
//! the app created are touched, `<data>/weights/whisper/<name>` for the names below; a link or
//! a junction is never followed, and anything else under `whisper` is left alone.

use super::legacy_weights::plain_directory;
use super::routes::{Builder, OPEN};
use super::{Core, ok, ok_true};
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

/// The weight types the removed engine could download, each in a folder of that name.
pub const WHISPER_WEIGHT_NAMES: [&str; 9] =
    ["tiny", "base", "small", "medium", "large-v1", "large-v2", "large-v3", "large-v3-turbo-int8", "large-v3-turbo"];

fn whisper_folder(data_dir: &Path) -> Option<PathBuf> {
    let path = data_dir.join("weights").join("whisper");
    plain_directory(&path).then_some(path)
}

/// The bytes of the regular files under `path`, without following any link.
fn folder_bytes(path: &Path) -> u64 {
    let mut total = 0;
    let mut pending = vec![path.to_path_buf()];
    while let Some(folder) = pending.pop() {
        let Ok(entries) = fs::read_dir(&folder) else { continue };
        for entry in entries.flatten() {
            let Ok(info) = fs::symlink_metadata(entry.path()) else { continue };
            if info.file_type().is_file() {
                total += info.len();
            } else if plain_directory(&entry.path()) {
                pending.push(entry.path());
            }
        }
    }
    total
}

fn present(data_dir: &Path) -> Vec<(&'static str, PathBuf)> {
    let Some(whisper) = whisper_folder(data_dir) else { return Vec::new() };
    WHISPER_WEIGHT_NAMES.iter().map(|name| (*name, whisper.join(name))).filter(|(_, path)| plain_directory(path)).collect()
}

/// `oldWhisperWeights`: `{"total_bytes": int, "folders": [weight type, ...]}`.
pub fn old_whisper_weights(data_dir: &Path) -> Value {
    let present = present(data_dir);
    let total: u64 = present.iter().map(|(_, path)| folder_bytes(path)).sum();
    json!({ "total_bytes": total, "folders": present.iter().map(|(name, _)| *name).collect::<Vec<_>>() })
}

/// `deleteOldWhisperWeights`: what remains, plus `freed_bytes` and the folders that could not
/// be removed (`failed`, for example a file another program holds open).
pub fn delete_old_whisper_weights(data_dir: &Path) -> Value {
    let before = old_whisper_weights(data_dir)["total_bytes"].as_u64().unwrap_or(0);
    let mut failed = Vec::new();
    for (name, path) in present(data_dir) {
        // Checked again right before removing: the folder may have been replaced by a link.
        if !plain_directory(&path) {
            continue;
        }
        // remove_dir_all removes a link it meets inside the folder, never what it points to.
        if fs::remove_dir_all(&path).is_err() {
            failed.push(name);
        }
    }
    if let Some(whisper) = whisper_folder(data_dir) {
        // Only when nothing else is left in it.
        let _ = fs::remove_dir(whisper);
    }
    let remaining = old_whisper_weights(data_dir);
    let after = remaining["total_bytes"].as_u64().unwrap_or(0);
    json!({
        "total_bytes": remaining["total_bytes"],
        "folders": remaining["folders"],
        "freed_bytes": before.saturating_sub(after),
        "failed": failed,
    })
}

/// Shows a folder in the system's file manager.
fn open_folder(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(not(windows))]
    let program = "xdg-open";
    std::process::Command::new(program).arg(path).spawn().map(|_| ())
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
    b.with("/get/data/old_whisper_weights", OPEN, |core, _| ok(old_whisper_weights(&core.config().environment().data_dir)));
    b.with("/run/delete_old_whisper_weights", OPEN, |core, _| {
        let result = delete_old_whisper_weights(&core.config().environment().data_dir);
        let counts = json!({
            "freed_bytes": result["freed_bytes"],
            "remaining": result["folders"].as_array().map_or(0, Vec::len),
            "failed": result["failed"].as_array().map_or(0, Vec::len),
        });
        core.log().step("Deleted old Whisper weights", Some(&counts));
        ok(result)
    });
    b.with("/run/open_filepath_config_file", OPEN, |core, _| core.open_folder_reply(&core.config().environment().state_dir));
    b.with("/run/open_filepath_logs", OPEN, |core, _| core.open_folder_reply(&core.config().environment().state_dir.join("logs")));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_known_folders_are_counted_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        let whisper = dir.path().join("weights").join("whisper");
        fs::create_dir_all(whisper.join("small").join("inner")).unwrap();
        fs::write(whisper.join("small").join("model.bin"), vec![0u8; 10]).unwrap();
        fs::write(whisper.join("small").join("inner").join("x.bin"), vec![0u8; 5]).unwrap();
        fs::create_dir_all(whisper.join("mine")).unwrap();
        fs::write(whisper.join("mine").join("keep.txt"), b"keep").unwrap();

        assert_eq!(old_whisper_weights(dir.path()), json!({ "total_bytes": 15, "folders": ["small"] }));
        let result = delete_old_whisper_weights(dir.path());
        assert_eq!(result, json!({ "total_bytes": 0, "folders": [], "freed_bytes": 15, "failed": [] }));
        assert!(whisper.join("mine").join("keep.txt").exists(), "an unknown folder stays");
        assert!(!whisper.join("small").exists());
    }

    fn link_dir(target: &Path, link: &Path) -> std::io::Result<()> {
        #[cfg(windows)]
        return std::os::windows::fs::symlink_dir(target, link);
        #[cfg(unix)]
        return std::os::unix::fs::symlink(target, link);
    }

    #[test]
    fn a_link_is_neither_counted_nor_followed() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = dir.path().join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(elsewhere.join("precious.bin"), vec![0u8; 7]).unwrap();
        let whisper = dir.path().join("weights").join("whisper");
        fs::create_dir_all(whisper.join("tiny")).unwrap();
        if link_dir(&elsewhere, &whisper.join("base")).is_err() || link_dir(&elsewhere, &whisper.join("tiny").join("inner")).is_err() {
            // Windows without the right to make symbolic links: nothing to check here.
            eprintln!("symbolic links are not available; skipped");
            return;
        }
        assert_eq!(old_whisper_weights(dir.path()), json!({ "total_bytes": 0, "folders": ["tiny"] }));
        delete_old_whisper_weights(dir.path());
        assert!(elsewhere.join("precious.bin").exists(), "what a link points to stays");
    }

    #[test]
    fn nothing_there_is_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(old_whisper_weights(dir.path()), json!({ "total_bytes": 0, "folders": [] }));
        assert_eq!(delete_old_whisper_weights(dir.path())["freed_bytes"], json!(0));
    }
}
