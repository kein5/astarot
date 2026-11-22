//! The folders that hold the settings and the models, when they move (ADR-014, 2.4).
//!
//! 0.6.0 renames the Linux folders from `vrct-vox` to `astarot` ([`linux`]), and the Windows
//! installer moves its installation folder (ADR-014, 2.5; [`installer`]). Either way the files
//! keep their place inside the folder, but what the app saved as an absolute path under the old
//! folder must now point into the new one. [`relocate_saved_paths`] rewrites those paths in the
//! files that hold them ([`FILES_WITH_PATHS`]). Only a path that is a moved folder or under one
//! changes: a path anywhere else (a model the user keeps outside the app's folders) stays as it
//! is, and nothing is guessed from the end of a path. Paths are compared as the OS compares them:
//! on Windows without case and with either separator.

use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub mod installer;
#[cfg(unix)]
pub mod linux;

/// The files beside `config.json` that may hold absolute paths: the settings (the speech server
/// profiles' models, RVC's model, index and runtime), the models the user registered, and the
/// folders of the translation catalog's entries.
pub const FILES_WITH_PATHS: [&str; 3] = ["config.json", "user_models.json", "translation_catalog.json"];

/// What `config.json` held before its paths were rewritten, so that it can be put back by hand
/// (as the earlier `config.json.before-migration-<step>`). An existing copy is kept: it is the
/// older one.
pub const CONFIG_COPY: &str = "config.json.before-migration-storage";

/// A folder whose files are now somewhere else: what was under `from` is under `to`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Move {
    pub from: PathBuf,
    pub to: PathBuf,
}

/// `path` with the folder of the first move it is in replaced, or `None` when it is in none.
/// The text is compared as it was saved, up to a separator: `/a/vrct-vox-old` is not under
/// `/a/vrct-vox`.
fn moved_path(path: &str, moves: &[Move]) -> Option<String> {
    moves.iter().find_map(|m| {
        let (from, to) = (m.from.to_str()?, m.to.to_str()?);
        let rest = under_folder(path, from)?;
        Some(format!("{to}{rest}"))
    })
}

/// What follows `folder` in `path`, when `path` is that folder (the empty rest) or under it (a
/// rest that starts with a separator). Compared as the OS compares names ([`under_folder_as`]).
fn under_folder<'a>(path: &'a str, folder: &str) -> Option<&'a str> {
    under_folder_as(path, folder, cfg!(windows))
}

/// [`under_folder`]: on Windows without case (`C:\Users\U\AppData\Local\VRCT-VOX` and
/// `c:\users\u\appdata\local\vrct-vox` are one folder) and with either separator; elsewhere as
/// written.
fn under_folder_as<'a>(path: &'a str, folder: &str, windows: bool) -> Option<&'a str> {
    let separator = |c: char| c == '/' || (windows && c == '\\');
    if folder.is_empty() {
        return None;
    }
    let rest = if windows {
        let mut chars = path.char_indices();
        let mut end = 0;
        for wanted in folder.chars() {
            let (at, found) = chars.next()?;
            let same = found == wanted || (separator(found) && separator(wanted)) || found.to_lowercase().eq(wanted.to_lowercase());
            if !same {
                return None;
            }
            end = at + found.len_utf8();
        }
        &path[end..]
    } else {
        path.strip_prefix(folder)?
    };
    (rest.is_empty() || rest.starts_with(separator)).then_some(rest)
}

/// Rewrites every string in `value` that is a path under a moved folder. Answers whether
/// anything changed. Keys are names, never paths, and stay.
fn rewrite(value: &mut Value, moves: &[Move]) -> bool {
    match value {
        Value::String(text) => match moved_path(text, moves) {
            Some(path) => {
                *text = path;
                true
            }
            None => false,
        },
        Value::Array(items) => items.iter_mut().fold(false, |changed, item| rewrite(item, moves) | changed),
        Value::Object(map) => map.values_mut().fold(false, |changed, item| rewrite(item, moves) | changed),
        _ => false,
    }
}

/// Rewrites, in the files of `state_dir` that hold paths ([`FILES_WITH_PATHS`]), every path under
/// a folder of `moves` to the same place under where it went. Answers whether any file changed.
///
/// A file that is missing, or is not JSON, is left as it is: its reader reports it. `config.json`
/// is copied first ([`CONFIG_COPY`], without the API keys an older version kept in it) and then
/// written as the settings always are; it is not rewritten when the copy cannot be made. The
/// other files are written as their owners write them, through a temporary file and a rename.
/// Running it again changes nothing more, so a start that stopped half way can do it again.
pub fn relocate_saved_paths(state_dir: &Path, moves: &[Move]) -> io::Result<bool> {
    let mut changed = false;
    for name in FILES_WITH_PATHS {
        let path = state_dir.join(name);
        let text = match fs::read(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        let Ok(saved) = serde_json::from_slice::<Value>(&text) else { continue };
        let mut value = saved.clone();
        if !rewrite(&mut value, moves) {
            continue;
        }
        if name == "config.json" {
            keep_config_copy(state_dir, saved)?;
            crate::config::write_config(&path, &value)?;
        } else {
            let text = serde_json::to_string_pretty(&value).expect("plain JSON");
            write_replacing(&path, text.as_bytes())?;
        }
        changed = true;
    }
    Ok(changed)
}

/// Writes [`CONFIG_COPY`] with what `config.json` held, unless a copy is there already.
fn keep_config_copy(state_dir: &Path, mut saved: Value) -> io::Result<()> {
    if let Some(map) = saved.as_object_mut() {
        // The keys move to their own store; a copy would keep them in plain text.
        map.retain(|key, _| !crate::config::secrets::SECRET_SETTINGS.contains(&key.as_str()));
    }
    let path = state_dir.join(CONFIG_COPY);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = match options.open(&path) {
        Ok(file) => file,
        // Only a file is a copy; anything else in its place is not.
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return if fs::symlink_metadata(&path)?.is_file() { Ok(()) } else { Err(error) };
        }
        Err(error) => return Err(error),
    };
    let written = file.write_all(crate::config::to_python_json(&saved).as_bytes()).and_then(|()| file.sync_all());
    if written.is_err() {
        // A partial copy is not one: the next start makes it again.
        drop(file);
        let _ = fs::remove_file(&path);
    }
    written
}

/// Replaces `path` with `bytes` through a new temporary file in the same folder, flushed before
/// the rename, so that a reader never sees half a file.
pub(crate) fn write_replacing(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let folder = path.parent().unwrap_or(Path::new("."));
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temporary = folder.join(format!(".{name}.{}.tmp", crate::config::random_suffix()));
    let written = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    match written {
        Ok(()) => {
            #[cfg(unix)]
            if let Ok(folder) = fs::File::open(folder) {
                let _ = folder.sync_all();
            }
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn moves(from: &Path, to: &Path) -> Vec<Move> {
        vec![Move { from: from.to_path_buf(), to: to.to_path_buf() }]
    }

    #[test]
    fn only_the_folder_and_what_is_under_it_move() {
        let (from, to) = (Path::new("/home/u/.config/vrct-vox"), Path::new("/home/u/.config/astarot"));
        let m = moves(from, to);
        let under = from.join("downloaded_models").join("a.gguf");
        assert_eq!(moved_path(under.to_str().unwrap(), &m), Some(to.join("downloaded_models").join("a.gguf").to_str().unwrap().to_owned()));
        assert_eq!(moved_path(from.to_str().unwrap(), &m), Some(to.to_str().unwrap().to_owned()));
        for other in ["/home/u/.config/vrct-vox-other/a", "/home/u/.config/vrct-voxx", "/home/u/models/a.pth", "relative/vrct-vox", "", "vrct-vox"] {
            assert_eq!(moved_path(other, &m), None, "{other}");
        }
    }

    #[test]
    fn windows_compares_without_case_and_with_either_separator() {
        let folder = r"C:\Users\Ü\AppData\Local\VRCT-VOX";
        for (path, rest) in [
            (r"C:\Users\Ü\AppData\Local\VRCT-VOX", ""),
            (r"c:\users\ü\appdata\local\vrct-vox\weights\m.bin", r"\weights\m.bin"),
            ("C:/Users/Ü/AppData/Local/VRCT-VOX/downloaded_models/a", "/downloaded_models/a"),
        ] {
            assert_eq!(under_folder_as(path, folder, true), Some(rest), "{path}");
        }
        for path in [r"C:\Users\Ü\AppData\Local\VRCT-VOX-old\a", r"C:\Users\Ü\AppData\Local\VRCT", r"D:\Users\Ü\AppData\Local\VRCT-VOX", ""] {
            assert_eq!(under_folder_as(path, folder, true), None, "{path}");
        }
        assert_eq!(under_folder_as("anything", "", true), None);
        // Elsewhere a name with another case is another folder, and \ is no separator.
        assert_eq!(under_folder_as("/a/VRCT-VOX/m", "/a/vrct-vox", false), None);
        assert_eq!(under_folder_as("/a/vrct-vox\\m", "/a/vrct-vox", false), None);
        assert_eq!(under_folder_as("/a/vrct-vox/m", "/a/vrct-vox", false), Some("/m"));
    }

    #[test]
    fn the_first_move_that_holds_the_path_wins() {
        let m = vec![
            Move { from: PathBuf::from("/c/vrct-vox"), to: PathBuf::from("/c/astarot") },
            Move { from: PathBuf::from("/d/vrct-vox"), to: PathBuf::from("/d/astarot") },
        ];
        assert_eq!(moved_path("/d/vrct-vox/translation-models/m", &m).as_deref(), Some("/d/astarot/translation-models/m"));
        assert_eq!(moved_path("/c/vrct-vox/vc_runtimes/rvc", &m).as_deref(), Some("/c/astarot/vc_runtimes/rvc"));
    }

    #[test]
    fn every_string_in_the_document_is_looked_at_and_keys_are_not() {
        let m = moves(Path::new("/c/vrct-vox"), Path::new("/c/astarot"));
        let mut value = json!({
            "/c/vrct-vox/key": "/c/vrct-vox/value",
            "list": ["/c/vrct-vox/a", 1, null, true, {"deep": "/c/vrct-vox/b"}],
            "other": "/elsewhere/vrct-vox/c",
        });
        assert!(rewrite(&mut value, &m));
        assert_eq!(value, json!({
            "/c/vrct-vox/key": "/c/astarot/value",
            "list": ["/c/astarot/a", 1, null, true, {"deep": "/c/astarot/b"}],
            "other": "/elsewhere/vrct-vox/c",
        }));
        assert!(!rewrite(&mut value, &m), "a second pass finds nothing");
    }

    #[test]
    fn the_files_with_paths_are_rewritten_with_a_copy_of_the_settings() {
        let dir = tempfile::tempdir().unwrap();
        let (from, to) = (dir.path().join("vrct-vox"), dir.path().join("astarot"));
        let state = &to;
        fs::create_dir(state).unwrap();
        let model = from.join("downloaded_models").join("m.gguf");
        let outside = dir.path().join("mine").join("voice.pth");
        let config = json!({
            "DIRECT_VOICE_SETTINGS": {"rvc_model": model.to_str(), "rvc_index": outside.to_str()},
            "AUTH_KEYS": {"DeepL_API": "secret"},
            "UI_LANGUAGE": "ja",
        });
        fs::write(state.join("config.json"), crate::config::to_python_json(&config)).unwrap();
        let models = json!({"version": 1, "models": [{"files": {"model": {"path": model.to_str(), "size": 1, "mtime_ns": 2}}}]});
        fs::write(state.join("user_models.json"), serde_json::to_string_pretty(&models).unwrap()).unwrap();
        fs::write(state.join("translation_catalog.json"), "not JSON").unwrap();

        assert!(relocate_saved_paths(state, &moves(&from, &to)).unwrap());
        let read = |name: &str| serde_json::from_slice::<Value>(&fs::read(state.join(name)).unwrap()).unwrap();
        let moved = to.join("downloaded_models").join("m.gguf");
        assert_eq!(read("config.json")["DIRECT_VOICE_SETTINGS"]["rvc_model"], json!(moved.to_str()));
        assert_eq!(read("config.json")["DIRECT_VOICE_SETTINGS"]["rvc_index"], json!(outside.to_str()));
        assert_eq!(read("user_models.json")["models"][0]["files"]["model"]["path"], json!(moved.to_str()));
        assert_eq!(read("user_models.json")["models"][0]["files"]["model"]["mtime_ns"], json!(2));
        assert_eq!(fs::read_to_string(state.join("translation_catalog.json")).unwrap(), "not JSON");
        // The copy holds what the file held, without the keys.
        let copy = read(CONFIG_COPY);
        assert_eq!(copy["DIRECT_VOICE_SETTINGS"]["rvc_model"], json!(model.to_str()));
        assert_eq!(copy.get("AUTH_KEYS"), None);
        assert_eq!(copy["UI_LANGUAGE"], json!("ja"));

        // Again: nothing left to change, and the first copy stays.
        let before = fs::read(state.join("config.json")).unwrap();
        assert!(!relocate_saved_paths(state, &moves(&from, &to)).unwrap());
        assert_eq!(fs::read(state.join("config.json")).unwrap(), before);
        assert_eq!(read(CONFIG_COPY)["DIRECT_VOICE_SETTINGS"]["rvc_model"], json!(model.to_str()));
    }

    #[test]
    fn nothing_is_written_where_no_path_moves() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("config.json"), "{\n    \"UI_LANGUAGE\": \"en\"\n}").unwrap();
        assert!(!relocate_saved_paths(dir.path(), &moves(Path::new("/x/vrct-vox"), Path::new("/x/astarot"))).unwrap());
        assert!(!dir.path().join(CONFIG_COPY).exists());
        assert!(!dir.path().join("user_models.json").exists());
    }

    #[test]
    fn the_settings_are_not_rewritten_without_their_copy() {
        let dir = tempfile::tempdir().unwrap();
        let text = "{\n    \"RVC\": \"/x/vrct-vox/m.pth\"\n}";
        fs::write(dir.path().join("config.json"), text).unwrap();
        // Something that is not a file holds the copy's name.
        fs::create_dir(dir.path().join(CONFIG_COPY)).unwrap();
        assert!(relocate_saved_paths(dir.path(), &moves(Path::new("/x/vrct-vox"), Path::new("/x/astarot"))).is_err());
        assert_eq!(fs::read_to_string(dir.path().join("config.json")).unwrap(), text);
    }
}
