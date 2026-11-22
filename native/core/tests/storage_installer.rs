//! The Windows installer moved the install folder from `VRCT-VOX` to `ASTAROT` and left a file
//! naming the old one (ADR-014, 2.5): the app's next start rewrites the paths saved under it and
//! removes the file. The folders are laid out as an install of 0.5.x keeps them: settings, logs
//! and models all in the install folder.

use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use astarot_core::storage::installer::{MOVED_FROM, Outcome, Taken, take_installer_move};
use astarot_core::storage::{CONFIG_COPY, FILES_WITH_PATHS};

struct Install {
    dir: tempfile::TempDir,
}

impl Install {
    /// An install moved by the installer: its files are in `ASTAROT`, and what it saved still
    /// names `VRCT-VOX`.
    fn moved() -> Self {
        let install = Install { dir: tempfile::tempdir().unwrap() };
        let (old, app) = (install.old(), install.app());
        fs::create_dir_all(app.join("downloaded_models").join("kotoba")).unwrap();
        fs::create_dir_all(app.join("weights")).unwrap();
        let config = json!({
            "UI_LANGUAGE": "ja",
            "SPEECH_SERVER_SETTINGS": {"version": 1, "profiles": [{"model": old.join("downloaded_models").join("kotoba").join("m.gguf")}]},
            "DIRECT_VOICE_SETTINGS": {"rvc_model": old.join("weights").join("voice.pth"), "rvc_index": install.outside().join("voice.index")},
            "AUTH_KEYS": {"DeepL_API": "secret-value"},
        });
        fs::write(app.join("config.json"), astarot_core::config::to_python_json(&config)).unwrap();
        let models = json!({"version": 1, "models": [{"id": "a", "files": {"model": {"path": old.join("weights").join("voice.pth"), "size": 1, "mtime_ns": 2}}}]});
        fs::write(app.join("user_models.json"), serde_json::to_string_pretty(&models).unwrap()).unwrap();
        let catalog = json!({"version": 1, "entries": [{"id": "e", "folder": install.outside().join("nllb")}]});
        fs::write(app.join("translation_catalog.json"), serde_json::to_string_pretty(&catalog).unwrap()).unwrap();
        install
    }

    fn old(&self) -> PathBuf {
        self.dir.path().join("VRCT-VOX")
    }

    fn app(&self) -> PathBuf {
        self.dir.path().join("ASTAROT")
    }

    /// Where a user keeps models of their own, outside the install.
    fn outside(&self) -> PathBuf {
        self.dir.path().join("my models")
    }

    fn file(&self) -> PathBuf {
        self.app().join(MOVED_FROM)
    }

    /// The file as the installer writes it: the old folder in UTF-16 after its byte order mark.
    fn leave_file(&self, folder: &Path) {
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend(folder.to_str().unwrap().encode_utf16().flat_map(u16::to_le_bytes));
        fs::write(self.file(), bytes).unwrap();
    }

    fn take(&self) -> Option<Taken> {
        take_installer_move(&self.app(), &self.app())
    }

    fn read(&self, name: &str) -> Value {
        serde_json::from_slice(&fs::read(self.app().join(name)).unwrap()).unwrap()
    }

    /// Every file in the install with its bytes, the handoff file aside.
    fn files(&self) -> Vec<(PathBuf, Vec<u8>)> {
        let mut files = Vec::new();
        let mut folders = vec![self.app()];
        while let Some(folder) = folders.pop() {
            for entry in fs::read_dir(folder).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    folders.push(path);
                } else if path != self.file() {
                    files.push((path.clone(), fs::read(&path).unwrap()));
                }
            }
        }
        files.sort();
        files
    }
}

fn s(path: PathBuf) -> Value {
    json!(path.to_str().unwrap())
}

#[test]
fn the_paths_saved_under_the_old_folder_follow_it_and_the_file_goes() {
    let install = Install::moved();
    install.leave_file(&install.old());
    let taken = install.take().unwrap();
    assert_eq!(taken, Taken { outcome: Outcome::Rewritten, removed: true });
    assert!(!install.file().exists());

    let (app, outside) = (install.app(), install.outside());
    let config = install.read("config.json");
    assert_eq!(config["SPEECH_SERVER_SETTINGS"]["profiles"][0]["model"], s(app.join("downloaded_models").join("kotoba").join("m.gguf")));
    assert_eq!(config["DIRECT_VOICE_SETTINGS"]["rvc_model"], s(app.join("weights").join("voice.pth")));
    // A model the user keeps elsewhere, and every other setting, stay as they were.
    assert_eq!(config["DIRECT_VOICE_SETTINGS"]["rvc_index"], s(outside.join("voice.index")));
    assert_eq!(config["UI_LANGUAGE"], json!("ja"));
    assert_eq!(config["SPEECH_SERVER_SETTINGS"]["version"], json!(1));
    assert_eq!(install.read("user_models.json")["models"][0]["files"]["model"]["path"], s(app.join("weights").join("voice.pth")));
    assert_eq!(install.read("user_models.json")["models"][0]["files"]["model"]["mtime_ns"], json!(2));
    assert_eq!(install.read("translation_catalog.json")["entries"][0]["folder"], s(outside.join("nllb")));

    // What config.json held is kept beside it, without the API keys.
    let copy = install.read(CONFIG_COPY);
    assert_eq!(copy["DIRECT_VOICE_SETTINGS"]["rvc_model"], s(install.old().join("weights").join("voice.pth")));
    assert_eq!(copy.get("AUTH_KEYS"), None);

    // The log line: result codes only.
    let line = taken.summary();
    assert_eq!(line, "installer_move=rewritten");
    assert!(!line.contains(install.dir.path().to_str().unwrap()));
}

#[test]
fn only_the_files_with_paths_change_and_the_next_start_does_nothing() {
    let install = Install::moved();
    fs::write(install.app().join("downloaded_models").join("kotoba").join("m.gguf"), b"model").unwrap();
    fs::write(install.app().join("process.log"), install.old().to_str().unwrap()).unwrap();
    let before = install.files();
    install.leave_file(&install.old());
    install.take().unwrap();
    let after = install.files();
    let changed: Vec<String> = before
        .iter()
        .filter(|(path, bytes)| after.iter().find(|(p, _)| p == path).map(|(_, b)| b) != Some(bytes))
        .map(|(path, _)| path.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(changed, ["config.json", "user_models.json"]);
    // The copy, and the lock every write of config.json takes.
    let added: Vec<_> = after.iter().filter(|(path, _)| !before.iter().any(|(p, _)| p == path)).map(|(p, _)| p.clone()).collect();
    let lock = install.app().join("config.json.lock");
    assert_eq!(added.iter().filter(|path| **path != lock).collect::<Vec<_>>(), [&install.app().join(CONFIG_COPY)]);
    assert!(FILES_WITH_PATHS.contains(&"translation_catalog.json"));

    // Nothing to take at the next start, and nothing changes.
    assert_eq!(install.take(), None);
    assert_eq!(install.files(), after);
}

#[test]
fn a_file_left_again_changes_nothing_more() {
    // A start that rewrote the paths but could not remove the file, or a second run of the
    // installer that left it again.
    let install = Install::moved();
    install.leave_file(&install.old());
    install.take().unwrap();
    let after = install.files();
    install.leave_file(&install.old());
    assert_eq!(install.take(), Some(Taken { outcome: Outcome::Unchanged, removed: true }));
    assert_eq!(install.files(), after);
    assert!(!install.file().exists());
}

#[test]
fn a_file_that_names_no_usable_folder_is_removed_and_nothing_changes() {
    let install = Install::moved();
    let before = install.files();
    let app = install.app();
    let leaves: Vec<Box<dyn Fn()>> = vec![
        Box::new(|| fs::write(install.file(), b"").unwrap()),
        Box::new(|| fs::write(install.file(), [0xFF, 0xFE]).unwrap()),
        Box::new(|| fs::write(install.file(), b"\xC3\x28 not text").unwrap()),
        Box::new(|| fs::write(install.file(), b"VRCT-VOX").unwrap()),
        Box::new(|| fs::write(install.file(), format!("{}\n{}", install.old().display(), install.outside().display())).unwrap()),
        // The folder the app runs from: there is nothing to move.
        Box::new(|| install.leave_file(&app)),
        // Far bigger than any path.
        Box::new(|| fs::write(install.file(), vec![b'/'; 200_000]).unwrap()),
    ];
    for (index, leave) in leaves.iter().enumerate() {
        leave();
        assert_eq!(install.take(), Some(Taken { outcome: Outcome::Ignored, removed: true }), "case {index}");
        assert!(!install.file().exists(), "case {index}");
        assert_eq!(install.files(), before, "case {index}");
    }
}

#[test]
fn without_the_file_nothing_is_taken() {
    let install = Install::moved();
    let before = install.files();
    assert_eq!(install.take(), None);
    // A folder with the file's name is not the installer's.
    fs::create_dir(install.file()).unwrap();
    assert_eq!(install.take(), None);
    assert!(install.file().is_dir());
    assert_eq!(install.files(), before);
}

#[cfg(unix)]
#[test]
fn paths_that_cannot_be_rewritten_now_keep_the_file_for_the_next_start() {
    use std::os::unix::fs::PermissionsExt;
    let install = Install::moved();
    install.leave_file(&install.old());
    let config = fs::read(install.app().join("config.json")).unwrap();
    // The copy of config.json cannot be made: config.json is not rewritten.
    fs::create_dir(install.app().join(CONFIG_COPY)).unwrap();
    let taken = install.take().unwrap();
    assert_eq!(taken, Taken { outcome: Outcome::Failed, removed: false });
    assert_eq!(taken.summary(), "installer_move=failed");
    assert!(install.file().is_file());
    assert_eq!(fs::read(install.app().join("config.json")).unwrap(), config);

    // The next start, once the copy can be made, finishes.
    fs::remove_dir(install.app().join(CONFIG_COPY)).unwrap();
    assert_eq!(install.take().unwrap().outcome, Outcome::Rewritten);
    assert!(!install.file().exists());

    // A folder the app may not read from is reported as such, too.
    let install = Install::moved();
    install.leave_file(&install.old());
    let models = install.app().join("user_models.json");
    fs::set_permissions(&models, fs::Permissions::from_mode(0o000)).unwrap();
    let unreadable = fs::read(&models).is_err();
    let taken = install.take().unwrap();
    fs::set_permissions(&models, fs::Permissions::from_mode(0o600)).unwrap();
    if unreadable {
        assert_eq!(taken.outcome, Outcome::Failed);
        assert!(install.file().is_file());
    }
}

#[test]
fn the_settings_of_a_folder_named_by_a_variable_follow_too() {
    // ASTAROT_CONFIG_DIR keeps the settings elsewhere; the models they name were in the install.
    let install = Install::moved();
    let state = install.dir.path().join("settings");
    fs::create_dir(&state).unwrap();
    fs::copy(install.app().join("config.json"), state.join("config.json")).unwrap();
    install.leave_file(&install.old());
    let taken = take_installer_move(&install.app(), &state).unwrap();
    assert_eq!(taken.outcome, Outcome::Rewritten);
    let config: Value = serde_json::from_slice(&fs::read(state.join("config.json")).unwrap()).unwrap();
    assert_eq!(config["DIRECT_VOICE_SETTINGS"]["rvc_model"], s(install.app().join("weights").join("voice.pth")));
    // The install's own copy of the settings is not the one in use, and stays.
    assert_eq!(install.read("config.json")["DIRECT_VOICE_SETTINGS"]["rvc_model"], s(install.old().join("weights").join("voice.pth")));
}

#[test]
fn a_file_that_cannot_be_removed_is_reported() {
    let taken = Taken { outcome: Outcome::Unchanged, removed: false };
    assert_eq!(taken.summary(), "installer_move=unchanged installer_move_file=kept");
    assert_eq!(Taken { outcome: Outcome::Ignored, removed: true }.summary(), "installer_move=ignored");
}
