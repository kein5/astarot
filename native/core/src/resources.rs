//! Where the files shipped with the app are: speech.cpp, the helper programs, the license texts
//! (decision 7 in `docs/voice-stack/core-integration.md`).
//!
//! The packages keep them in a `_internal` folder, the name the Python sidecar's resources had,
//! so that the installer's update step, which swaps that folder as a whole, also takes away the
//! Python runtime of an older version:
//!
//! - beside the binary (the Windows installer and ZIP, the Linux tar.gz, the deb and rpm in
//!   `/opt/vrct-vox`):
//!   `<app>/_internal/build/speechcpp`
//! - in the AppImage, where the binary is `usr/bin/vrct-vox`:
//!   `usr/lib/vrct-vox/_internal/build/speechcpp`
//! - a development checkout keeps them in `build/` at its root; a debug build of the app names
//!   that root with [`use_development_checkout`].
//!
//! speech.cpp is bundled as one folder per build: `build/speechcpp` is the Vulkan build (the
//! only one on Windows), and the Linux packages add the CPU build in `build/speechcpp-cpu`
//! (decision 5 in `docs/voice-stack/core-integration.md`).
//!
//! Callers ask by the path inside the folder (`"build/speechcpp"`).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The folder of the shipped files beside the binary.
pub const FOLDER: &str = "_internal";

static DEVELOPMENT_CHECKOUT: OnceLock<PathBuf> = OnceLock::new();

/// A debug build of the app runs from `src-tauri/target`; its shipped files are staged in the
/// checkout's `build/` (`build/speechcpp`, `build/astarot-rvc-worker.exe`). Set once, before the
/// backend starts. Packaged builds never call it, and tests leave it unset.
pub fn use_development_checkout(root: PathBuf) {
    let _ = DEVELOPMENT_CHECKOUT.set(root);
}

/// The folders searched, in order.
pub fn folders(app_dir: &Path) -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if let Some(root) = DEVELOPMENT_CHECKOUT.get() {
        folders.push(root.clone());
    }
    folders.push(app_dir.join(FOLDER));
    if cfg!(target_os = "linux") {
        // The AppImage: usr/bin/vrct-vox with its files in usr/lib/vrct-vox.
        if let Some(prefix) = app_dir.parent() {
            folders.push(prefix.join("lib").join(app_identity::LINUX_PACKAGE.current()).join(FOLDER));
        }
    }
    folders
}

/// The shipped file or folder `relative` (`"build/speechcpp"`): the first that exists, or
/// `<app>/<relative>` when none does (a source checkout run from its root), so that the caller
/// reports the path it looked for.
pub fn locate(app_dir: &Path, relative: &str) -> PathBuf {
    folders(app_dir)
        .into_iter()
        .map(|folder| folder.join(relative))
        .find(|path| path.exists())
        .unwrap_or_else(|| app_dir.join(relative))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_folder_beside_the_binary_comes_first_and_a_checkout_is_the_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("app");
        std::fs::create_dir_all(app.join("build/speechcpp")).unwrap();
        assert_eq!(locate(&app, "build/speechcpp"), app.join("build/speechcpp"), "a checkout run from its root");
        std::fs::create_dir_all(app.join("_internal/build/speechcpp")).unwrap();
        assert_eq!(locate(&app, "build/speechcpp"), app.join("_internal/build/speechcpp"));
        assert_eq!(locate(&app, "build/missing"), app.join("build/missing"), "the path looked for");
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_packages_keep_the_files_under_lib() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("usr/bin");
        let shipped = dir.path().join("usr/lib/vrct-vox/_internal/build/speechcpp");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(&shipped).unwrap();
        assert_eq!(locate(&bin, "build/speechcpp"), shipped);
    }
}
