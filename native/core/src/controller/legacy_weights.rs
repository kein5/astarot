//! The CTranslate2 translation weights of the Python backend, retired with it (#285).
//!
//! The Rust core never reads them: its local translation runs on ONNX models. They are
//! removed once the core is the application's default backend, so that while the Python
//! sidecar is the default, its local translation keeps its weights. A development run with
//! `VRCT_BACKEND=core` leaves them alone too.
//!
//! Only the folders the Python backend created are touched:
//! `<data>/weights/ctranslate2/<name>` for the names below. A link or a junction is never
//! followed, whether it is one of those folders or `ctranslate2` itself, and anything else
//! under `ctranslate2` is left alone ([`models/transcription/old_whisper_weights.py`] keeps the
//! same rules for the old Whisper weights).
//!
//! [`models/transcription/old_whisper_weights.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/transcription/old_whisper_weights.py

use std::fs;
use std::path::{Path, PathBuf};

/// The folders of `ctranslate2_weights` (`directory_name`) and the two older folder names
/// (`_LEGACY_DIRECTORIES`) in [`models/translation/translation_utils.py`].
///
/// [`models/translation/translation_utils.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/translation/translation_utils.py
pub const FOLDERS: [&str; 7] = [
    "m2m100_418M-ct2-int8",
    "m2m100_1.2B-ct2-int8",
    "nllb-200-distilled-600M-ct2-int8",
    "nllb-200-distilled-1.3B-ct2-int8",
    "nllb-200-3.3B-ct2-int8",
    "m2m100_418M",
    "m2m100_12b",
];

/// A real directory: not a symbolic link, not a junction or another reparse point.
pub(crate) fn plain_directory(path: &Path) -> bool {
    let Ok(info) = fs::symlink_metadata(path) else { return false };
    if info.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if info.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return false;
        }
    }
    info.is_dir()
}

/// The legacy weight folders present under `data_dir`.
pub fn present(data_dir: &Path) -> Vec<PathBuf> {
    let base = data_dir.join("weights").join("ctranslate2");
    if !plain_directory(&base) {
        return Vec::new();
    }
    FOLDERS.iter().map(|name| base.join(name)).filter(|path| plain_directory(path)).collect()
}

/// What a removal did: folders removed, and those that could not be (a file held open).
#[derive(Debug, Default, PartialEq)]
pub struct Removed {
    pub removed: usize,
    pub failed: usize,
}

/// Removes the legacy weight folders, then `ctranslate2` itself if nothing else is left in it.
pub fn remove(data_dir: &Path) -> Removed {
    let mut result = Removed::default();
    for folder in present(data_dir) {
        // remove_dir_all does not follow links inside the folder: a link is removed, not entered.
        match fs::remove_dir_all(&folder) {
            Ok(()) => result.removed += 1,
            Err(_) => result.failed += 1,
        }
    }
    let base = data_dir.join("weights").join("ctranslate2");
    if plain_directory(&base) && fs::read_dir(&base).is_ok_and(|mut entries| entries.next().is_none()) {
        let _ = fs::remove_dir(&base);
    }
    result
}
