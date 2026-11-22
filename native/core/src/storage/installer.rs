//! Windows: the installer moved the install folder (ADR-014, 2.5).
//!
//! On Windows the settings and the models are in the install folder. Up to 0.5.0 its default was
//! `%LOCALAPPDATA%\VRCT-VOX`; the installer now renames that folder to `%LOCALAPPDATA%\ASTAROT`
//! once an update is in, and leaves a file in it ([`MOVED_FROM`]) that names the old folder. The
//! file is written before the rename, so it travels with the files.
//!
//! At its next start, before anything reads `config.json`, the app takes the file
//! ([`take_installer_move`]): the paths saved under the old folder are rewritten to the same place
//! in the folder the app runs from ([`super::relocate_saved_paths`]), and the file is removed.
//! When the paths cannot be rewritten now, the file stays and the next start tries again. A file
//! that names no usable folder is removed and nothing changes. Only result codes reach the log
//! ([`Taken::summary`]), never a path.

use super::{Move, relocate_saved_paths};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// The file the installer leaves in the install folder after it moved the folder.
pub const MOVED_FROM: &str = astarot_app_identity::INSTALLER_MOVED_FROM;

/// More than any path Windows takes (32,767 UTF-16 units, two bytes each): a bigger file is
/// not one the installer wrote.
const LARGEST: u64 = 65_536 + 2;

/// What the start did with the file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Paths saved under the old folder now lead to the new one.
    Rewritten,
    /// No saved path was under the old folder.
    Unchanged,
    /// The file named no folder to take paths from: it was not text, not one absolute path, or
    /// the folder the app runs from. Nothing was changed.
    Ignored,
    /// The paths could not be rewritten now (a file could not be read or written). The file
    /// stays, and the next start tries again.
    Failed,
}

impl Outcome {
    pub fn code(&self) -> &'static str {
        match self {
            Outcome::Rewritten => "rewritten",
            Outcome::Unchanged => "unchanged",
            Outcome::Ignored => "ignored",
            Outcome::Failed => "failed",
        }
    }
}

/// What [`take_installer_move`] did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Taken {
    pub outcome: Outcome,
    /// Whether the file is gone. It stays on purpose after [`Outcome::Failed`]; otherwise a file
    /// that could not be removed is taken again at the next start, where it changes nothing.
    pub removed: bool,
}

impl Taken {
    /// One part of the start-up log's line: codes only, never a path.
    pub fn summary(&self) -> String {
        let mut line = format!("installer_move={}", self.outcome.code());
        if !self.removed && self.outcome != Outcome::Failed {
            line.push_str(" installer_move_file=kept");
        }
        line
    }
}

/// Takes the file the installer left in `app_dir` after it moved the install folder there. The
/// files of `state_dir` that hold paths have those under the old folder rewritten to the same
/// place under `app_dir`, and the file is removed. `None` when there is no file.
///
/// Call it before anything reads `state_dir`: once at the start, as the folders are settled.
pub fn take_installer_move(app_dir: &Path, state_dir: &Path) -> Option<Taken> {
    let file = app_dir.join(MOVED_FROM);
    // Only a file is the installer's; a link or a folder with its name is left alone.
    if !fs::symlink_metadata(&file).is_ok_and(|meta| meta.is_file()) {
        return None;
    }
    let outcome = match read_moved_from(&file).filter(|from| !same_text(from, app_dir)) {
        None => Outcome::Ignored,
        Some(from) => match relocate_saved_paths(state_dir, &moves_for(&from, app_dir)) {
            Ok(true) => Outcome::Rewritten,
            Ok(false) => Outcome::Unchanged,
            Err(_) => return Some(Taken { outcome: Outcome::Failed, removed: false }),
        },
    };
    Some(Taken { outcome, removed: fs::remove_file(&file).is_ok() })
}

/// The folder the file names: one absolute path, in UTF-16 with its byte order mark (as the
/// installer writes it) or in UTF-8. `None` for anything else.
fn read_moved_from(file: &Path) -> Option<PathBuf> {
    let mut bytes = Vec::new();
    fs::File::open(file).ok()?.take(LARGEST + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > LARGEST {
        return None;
    }
    folder_named(&bytes)
}

fn folder_named(bytes: &[u8]) -> Option<PathBuf> {
    let text = match bytes.strip_prefix(&[0xFF, 0xFE]) {
        Some(utf16) => {
            if utf16.len() % 2 != 0 {
                return None;
            }
            let units: Vec<u16> = utf16.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
            String::from_utf16(&units).ok()?
        }
        None => String::from_utf8(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes).to_vec()).ok()?,
    };
    // The installer writes the path alone; an editor may add a line end, and a writer may end
    // the text with a NUL.
    let text = text.trim_end_matches(['\r', '\n', '\0']);
    if text.is_empty() || text.chars().any(char::is_control) || text.trim() != text {
        return None;
    }
    let path = Path::new(text);
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::CurDir | Component::ParentDir)) {
        return None;
    }
    // The same path without a separator at its end, which a saved path is compared up to.
    Some(path.components().collect())
}

/// Whether two paths are written the same way, as the saved paths are compared
/// ([`super::under_folder`]).
fn same_text(a: &Path, b: &Path) -> bool {
    match (a.to_str(), b.to_str()) {
        (Some(a), Some(b)) => super::under_folder(a, b).is_some_and(str::is_empty),
        _ => a == b,
    }
}

/// The moves of the old folder `from` to `app_dir`. The app built the paths it saved from where
/// it ran, which may be written another way than the installer wrote the folder (a short 8.3
/// name, or the profile folder through another path): when the old folder was next to where the
/// app runs now, as the installer moves it, the old name next to the app's folder, and next to
/// that folder's resolved path, moved too.
fn moves_for(from: &Path, app_dir: &Path) -> Vec<Move> {
    let mut moves = vec![Move { from: from.to_path_buf(), to: app_dir.to_path_buf() }];
    let (Some(old_parent), Some(name), Some(parent)) = (from.parent(), from.file_name(), app_dir.parent()) else {
        return moves;
    };
    let resolved = fs::canonicalize(parent).ok();
    if resolved.is_none() || resolved != fs::canonicalize(old_parent).ok() {
        // Not next to each other: nothing is guessed.
        return moves;
    }
    for parent in [Some(parent.to_path_buf()), resolved].into_iter().flatten() {
        let next = Move { from: parent.join(name), to: app_dir.to_path_buf() };
        if !moves.contains(&next) {
            moves.push(next);
        }
    }
    moves
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(text: &str) -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
        bytes
    }

    /// `rest` (names joined by `/`) under the root of this platform: `C:\` on Windows, as the
    /// installer writes it there, and `/` elsewhere.
    fn absolute(rest: &str) -> String {
        if cfg!(windows) { format!("C:\\{}", rest.replace('/', "\\")) } else { format!("/{rest}") }
    }

    #[test]
    fn the_installer_writes_utf16_and_utf8_is_read_too() {
        let (unicode, plain) = (absolute("Users/ユーザー 😀/AppData/Local/VRCT-VOX"), absolute("a/VRCT-VOX"));
        assert_eq!(folder_named(&utf16(&unicode)), Some(PathBuf::from(&unicode)));
        assert_eq!(folder_named(plain.as_bytes()), Some(PathBuf::from(&plain)));
        assert_eq!(folder_named(format!("\u{FEFF}{plain}\r\n").as_bytes()), Some(PathBuf::from(&plain)));
        assert_eq!(folder_named(format!("{plain}\0").as_bytes()), Some(PathBuf::from(&plain)));
        // A separator at the end is not part of the folder's name.
        assert_eq!(folder_named(absolute("a/VRCT-VOX/").as_bytes()), Some(PathBuf::from(&plain)));
    }

    #[test]
    fn anything_but_one_absolute_path_names_no_folder() {
        let plain = absolute("a/VRCT-VOX");
        let odd_utf16 = {
            let mut bytes = utf16(&plain);
            bytes.push(0);
            bytes
        };
        let texts = [
            format!("{plain}\n{}", absolute("b/other")),
            absolute("a/VRCT\0-VOX"),
            absolute("a/../VRCT-VOX"),
            format!(" {plain}"),
        ];
        let mut cases: Vec<&[u8]> = vec![
            &b""[..],
            b"\xFF\xFE",
            b"\r\n",
            b"   ",
            b"relative/VRCT-VOX",
            b"\xFF\xFE\x00\xD8",
            b"\xC3\x28",
            &odd_utf16,
        ];
        cases.extend(texts.iter().map(String::as_bytes));
        for bytes in cases {
            assert_eq!(folder_named(bytes), None, "{bytes:?}");
        }
    }

    #[test]
    fn the_old_name_beside_the_app_moves_only_when_the_old_folder_was_beside_it() {
        let dir = tempfile::tempdir().unwrap();
        let (old, app) = (dir.path().join("VRCT-VOX"), dir.path().join("ASTAROT"));
        fs::create_dir(&app).unwrap();
        let moves = moves_for(&old, &app);
        assert_eq!(moves[0], Move { from: old.clone(), to: app.clone() });
        assert!(moves.iter().all(|m| m.to == app && m.from.file_name() == old.file_name()));
        assert!(moves.contains(&Move { from: fs::canonicalize(dir.path()).unwrap().join("VRCT-VOX"), to: app.clone() }));
        // The old folder somewhere else: only the folder the file names.
        let elsewhere = dir.path().join("other").join("VRCT-VOX");
        assert_eq!(moves_for(&elsewhere, &app), vec![Move { from: elsewhere.clone(), to: app }]);
    }
}
