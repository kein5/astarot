//! The Linux folders of 0.5.x moving to their ASTAROT names (ADR-014, 2.4), on a made-up home
//! folder laid out as 0.5.x leaves it.
#![cfg(unix)]

use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use vrct_core::storage::CONFIG_COPY;
use vrct_core::storage::linux::{Location, Others, Outcome, RECORD, Settled, settle};

struct Home {
    dir: tempfile::TempDir,
}

impl Home {
    fn new() -> Self {
        let home = Home { dir: tempfile::tempdir().unwrap() };
        fs::create_dir_all(home.config_home()).unwrap();
        fs::create_dir_all(home.data_home()).unwrap();
        home
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }

    fn config_home(&self) -> PathBuf {
        self.path().join(".config")
    }

    fn data_home(&self) -> PathBuf {
        self.path().join(".local/share")
    }

    fn old_config(&self) -> PathBuf {
        self.config_home().join("vrct-vox")
    }

    fn new_config(&self) -> PathBuf {
        self.config_home().join("astarot")
    }

    fn old_data(&self) -> PathBuf {
        self.data_home().join("vrct-vox")
    }

    fn new_data(&self) -> PathBuf {
        self.data_home().join("astarot")
    }

    fn settings(&self) -> Location {
        Location::Default { legacy: self.old_config(), current: self.new_config() }
    }

    fn data(&self) -> Location {
        Location::Default { legacy: self.old_data(), current: self.new_data() }
    }

    fn settle(&self, others: Others) -> Settled {
        settle(self.settings(), self.data(), || others)
    }

    /// A model the user keeps outside the app's folders.
    fn outside(&self) -> PathBuf {
        self.path().join("voices/mine.index")
    }

    /// What 0.5.x leaves: settings that name a downloaded model, the RVC runtime and a model
    /// outside, a registered model, a translation catalog entry in the data folder, the key
    /// file, logs, and the data folder's models.
    fn lay_out_0_5(&self) {
        let (config, data) = (self.old_config(), self.old_data());
        let model = config.join("downloaded_models/qwen3-asr-06b-q8/rev/Qwen3-ASR-0.6B-Q8_0.gguf");
        let rvc = config.join("downloaded_models/rvc-saisho/rev/model.pth");
        for file in [&model, &rvc] {
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, b"GGUF").unwrap();
            fs::write(file.with_file_name("owner.json"), r#"{"product": "VRCT-VOX-model-download-v1"}"#).unwrap();
        }
        fs::create_dir_all(config.join("vc_runtimes/rvc/lib")).unwrap();
        fs::create_dir_all(config.join("logs")).unwrap();
        fs::write(config.join("logs/process.log"), "").unwrap();
        fs::write(config.join("secrets.json"), r#"{"store_id": "0123456789abcdef"}"#).unwrap();
        let settings = json!({
            "UI_LANGUAGE": "ja",
            "AUTH_KEYS": {"DeepL_API": null},
            "SPEECH_SERVER_SETTINGS": {"version": 1, "profiles": {"asr": {"model": model.to_str()}}},
            "DIRECT_VOICE_SETTINGS": {
                "rvc_model": rvc.to_str(),
                "rvc_index": self.outside().to_str(),
                "rvc_runtime": config.join("vc_runtimes/rvc").to_str(),
            },
        });
        fs::write(config.join("config.json"), vrct_core::config::to_python_json(&settings)).unwrap();
        let registered = json!({"version": 1, "models": [
            {"id": "u1", "files": {"model": {"path": model.to_str(), "size": 4, "mtime_ns": 1}}},
            {"id": "u2", "files": {"model": {"path": self.outside().to_str(), "size": 4, "mtime_ns": 1}}},
        ]});
        fs::write(config.join("user_models.json"), serde_json::to_string_pretty(&registered).unwrap()).unwrap();
        let translation = data.join("translation-models/custom-m2m");
        fs::create_dir_all(&translation).unwrap();
        fs::write(translation.join("model.onnx"), b"onnx").unwrap();
        let catalog = json!({"version": 1, "entries": [{"id": "tr-1", "group": "engine", "folder": translation.to_str()}]});
        fs::write(config.join("translation_catalog.json"), serde_json::to_string_pretty(&catalog).unwrap()).unwrap();
        fs::create_dir_all(data.join("weights/ctranslate2")).unwrap();
        fs::write(data.join("telemetry_state.json"), "{}").unwrap();
    }
}

fn read(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn record(folder: &Path) -> Value {
    read(&folder.join(RECORD))
}

#[test]
fn the_0_5_folders_move_and_the_saved_paths_follow() {
    let home = Home::new();
    home.lay_out_0_5();
    let settled = home.settle(Others::None);
    assert_eq!((settled.settings, settled.data), (Outcome::Moved, Outcome::Moved));
    assert_eq!((settled.state_dir.as_path(), settled.data_dir.as_path()), (home.new_config().as_path(), home.new_data().as_path()));
    assert_eq!(settled.paths, Some("rewritten"));

    // The files moved, not copied, and the old names are links to the new folders.
    for (old, new) in [(home.old_config(), home.new_config()), (home.old_data(), home.new_data())] {
        assert!(fs::symlink_metadata(&new).unwrap().is_dir());
        assert_eq!(fs::read_link(&old).unwrap(), Path::new("astarot"));
        assert_eq!(record(&new), json!({"version": 1, "state": "done", "from": old.to_str()}));
    }
    let new = home.new_config();
    assert_eq!(fs::read(new.join("downloaded_models/rvc-saisho/rev/model.pth")).unwrap(), b"GGUF");
    assert!(home.new_data().join("weights/ctranslate2").is_dir());

    // Paths under the old folders now name the new ones; the one outside stays.
    let settings = read(&new.join("config.json"));
    let model = new.join("downloaded_models/qwen3-asr-06b-q8/rev/Qwen3-ASR-0.6B-Q8_0.gguf");
    assert_eq!(settings["SPEECH_SERVER_SETTINGS"]["profiles"]["asr"]["model"], json!(model.to_str()));
    assert_eq!(settings["DIRECT_VOICE_SETTINGS"]["rvc_model"], json!(new.join("downloaded_models/rvc-saisho/rev/model.pth").to_str()));
    assert_eq!(settings["DIRECT_VOICE_SETTINGS"]["rvc_runtime"], json!(new.join("vc_runtimes/rvc").to_str()));
    assert_eq!(settings["DIRECT_VOICE_SETTINGS"]["rvc_index"], json!(home.outside().to_str()));
    assert_eq!(settings["UI_LANGUAGE"], json!("ja"));
    let registered = read(&new.join("user_models.json"));
    assert_eq!(registered["models"][0]["files"]["model"]["path"], json!(model.to_str()));
    assert_eq!(registered["models"][1]["files"]["model"]["path"], json!(home.outside().to_str()));
    let catalog = read(&new.join("translation_catalog.json"));
    assert_eq!(catalog["entries"][0]["folder"], json!(home.new_data().join("translation-models/custom-m2m").to_str()));
    // What config.json held before, to put back by hand.
    let copy = read(&new.join(CONFIG_COPY));
    assert_eq!(copy["DIRECT_VOICE_SETTINGS"]["rvc_model"], json!(home.old_config().join("downloaded_models/rvc-saisho/rev/model.pth").to_str()));
    assert_eq!(copy.get("AUTH_KEYS"), None);

    // 0.5.x, back again, reads the same files through the old name.
    assert_eq!(fs::read(home.old_config().join("config.json")).unwrap(), fs::read(new.join("config.json")).unwrap());
    assert!(home.old_config().join("downloaded_models/rvc-saisho/rev/model.pth").is_file());

    // The log line holds codes only.
    assert_eq!(settled.summary(), "settings=moved data=moved paths=rewritten");
}

#[test]
fn the_next_start_does_nothing() {
    let home = Home::new();
    home.lay_out_0_5();
    home.settle(Others::None);
    let config = home.new_config().join("config.json");
    let before = (fs::read(&config).unwrap(), fs::metadata(&config).unwrap().modified().unwrap());
    let settled = settle(home.settings(), home.data(), || panic!("nothing is moved, nothing is asked"));
    assert_eq!((settled.settings, settled.data, settled.paths), (Outcome::InPlace, Outcome::InPlace, None));
    assert_eq!((fs::read(&config).unwrap(), fs::metadata(&config).unwrap().modified().unwrap()), before);
    assert_eq!(settled.summary(), "settings=in_place data=in_place");
}

#[test]
fn a_running_app_keeps_the_old_folders_until_the_next_start() {
    for (others, reason) in [(Others::Running, "app_running"), (Others::Unknown, "instance_check_unavailable")] {
        let home = Home::new();
        home.lay_out_0_5();
        let config = fs::read(home.old_config().join("config.json")).unwrap();
        let settled = home.settle(others);
        assert_eq!((settled.settings, settled.data), (Outcome::Kept(reason), Outcome::Kept(reason)));
        assert_eq!((settled.state_dir.clone(), settled.data_dir.clone()), (home.old_config(), home.old_data()));
        assert!(!home.new_config().exists() && !home.new_data().exists());
        assert!(fs::symlink_metadata(home.old_config()).unwrap().is_dir());
        assert!(!home.old_config().join(RECORD).exists());
        assert_eq!(fs::read(home.old_config().join("config.json")).unwrap(), config);
        assert_eq!(settled.summary(), format!("settings=kept_old:{reason} data=kept_old:{reason}"));
        // Once it has stopped, the next start moves them.
        let settled = home.settle(Others::None);
        assert_eq!((settled.settings, settled.data), (Outcome::Moved, Outcome::Moved));
    }
}

#[test]
fn a_move_that_stopped_after_the_rename_is_finished_at_the_next_start() {
    let home = Home::new();
    home.lay_out_0_5();
    // What a start that ended right after its rename leaves: the record travelled with the files,
    // there is no link, and the paths still name the old folder.
    for (old, new) in [(home.old_config(), home.new_config()), (home.old_data(), home.new_data())] {
        fs::write(old.join(RECORD), json!({"version": 1, "state": "moving", "from": old.to_str()}).to_string()).unwrap();
        fs::rename(&old, &new).unwrap();
    }
    let settled = settle(home.settings(), home.data(), || panic!("a move under way is not asked again"));
    assert_eq!((settled.settings, settled.data, settled.paths), (Outcome::Finished, Outcome::Finished, Some("rewritten")));
    assert_eq!(fs::read_link(home.old_config()).unwrap(), Path::new("astarot"));
    assert_eq!(record(&home.new_config())["state"], json!("done"));
    let rvc = read(&home.new_config().join("config.json"))["DIRECT_VOICE_SETTINGS"]["rvc_model"].clone();
    assert_eq!(rvc, json!(home.new_config().join("downloaded_models/rvc-saisho/rev/model.pth").to_str()));
}

#[test]
fn a_new_folder_the_app_did_not_make_is_not_used_while_the_old_one_is_there() {
    let home = Home::new();
    home.lay_out_0_5();
    fs::create_dir_all(home.new_config()).unwrap();
    fs::write(home.new_config().join("notes.txt"), "someone else's").unwrap();
    let settled = home.settle(Others::None);
    assert_eq!(settled.settings, Outcome::Kept("new_folder_not_ours"));
    assert_eq!(settled.state_dir, home.old_config());
    assert_eq!(fs::read_dir(home.new_config()).unwrap().count(), 1, "nothing written into it");
    assert!(fs::symlink_metadata(home.old_config()).unwrap().is_dir());
    // The data folder moves on its own; the settings left where they are name it through its link.
    assert_eq!(settled.data, Outcome::Moved);
    assert_eq!(settled.paths, Some("rewritten"));
    let catalog = read(&home.old_config().join("translation_catalog.json"));
    assert_eq!(catalog["entries"][0]["folder"], json!(home.new_data().join("translation-models/custom-m2m").to_str()));
}

#[test]
fn after_a_move_a_new_old_folder_is_left_alone() {
    let home = Home::new();
    home.lay_out_0_5();
    home.settle(Others::None);
    // Someone removed the link and ran 0.5.x, which made a fresh folder under the old name.
    fs::remove_file(home.old_config()).unwrap();
    fs::create_dir(home.old_config()).unwrap();
    fs::write(home.old_config().join("config.json"), "{}").unwrap();
    let settled = home.settle(Others::None);
    assert_eq!((settled.settings, settled.state_dir.clone()), (Outcome::InPlace, home.new_config()));
    assert_eq!(fs::read_to_string(home.old_config().join("config.json")).unwrap(), "{}");
    assert!(fs::symlink_metadata(home.old_config()).unwrap().is_dir());
}

#[test]
fn a_link_removed_after_the_move_is_made_again() {
    let home = Home::new();
    home.lay_out_0_5();
    home.settle(Others::None);
    fs::remove_file(home.old_data()).unwrap();
    assert_eq!(home.settle(Others::None).data, Outcome::InPlace);
    assert_eq!(fs::read_link(home.old_data()).unwrap(), Path::new("astarot"));
}

#[test]
fn with_neither_folder_the_new_ones_are_made() {
    let home = Home::new();
    let settled = settle(home.settings(), home.data(), || panic!("nothing to move"));
    assert_eq!((settled.settings, settled.data, settled.paths), (Outcome::Created, Outcome::Created, None));
    for (old, new) in [(home.old_config(), home.new_config()), (home.old_data(), home.new_data())] {
        assert_eq!(record(&new), json!({"version": 1, "state": "created"}));
        assert!(fs::symlink_metadata(&old).is_err(), "no old name is made");
    }
    // 0.5.x run in between makes its own folders; the new ones stay in use.
    fs::create_dir_all(home.old_config()).unwrap();
    let settled = home.settle(Others::None);
    assert_eq!((settled.settings, settled.state_dir), (Outcome::InPlace, home.new_config()));
}

#[test]
fn a_new_folder_alone_is_taken_as_the_apps() {
    let home = Home::new();
    fs::create_dir_all(home.new_config()).unwrap();
    let settled = home.settle(Others::None);
    assert_eq!((settled.settings, settled.state_dir), (Outcome::InPlace, home.new_config()));
    assert_eq!(record(&home.new_config())["state"], json!("created"));
}

#[test]
fn a_folder_named_by_a_variable_is_used_as_it_is() {
    let home = Home::new();
    home.lay_out_0_5();
    let given = home.path().join("given");
    fs::create_dir_all(&given).unwrap();
    let catalog = json!({"version": 1, "entries": [{"folder": home.old_data().join("translation-models/custom-m2m").to_str()}]});
    fs::write(given.join("translation_catalog.json"), catalog.to_string()).unwrap();
    let settled = settle(Location::Given(given.clone()), home.data(), || Others::None);
    assert_eq!((settled.settings, settled.data), (Outcome::Given, Outcome::Moved));
    assert_eq!(settled.state_dir, given);
    assert!(!given.join(RECORD).exists());
    // The default settings folder is not the one in use: it is not touched.
    assert!(fs::symlink_metadata(home.old_config()).unwrap().is_dir());
    assert!(!home.new_config().exists());
    // The settings in use follow the data folder.
    assert_eq!(read(&given.join("translation_catalog.json"))["entries"][0]["folder"], json!(home.new_data().join("translation-models/custom-m2m").to_str()));
}

#[test]
fn a_folder_that_cannot_be_renamed_is_used_where_it_is() {
    use std::os::unix::fs::PermissionsExt;
    let home = Home::new();
    home.lay_out_0_5();
    // A parent folder the user cannot write to (root could, so this checks nothing as root).
    fs::set_permissions(home.config_home(), fs::Permissions::from_mode(0o555)).unwrap();
    if fs::write(home.config_home().join("probe"), "").is_ok() {
        fs::set_permissions(home.config_home(), fs::Permissions::from_mode(0o755)).unwrap();
        return;
    }
    let settled = home.settle(Others::None);
    fs::set_permissions(home.config_home(), fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(settled.settings, Outcome::Kept("permission_denied"));
    assert_eq!(settled.state_dir, home.old_config());
    assert!(!home.old_config().join(RECORD).exists(), "the record of the move that did not happen is gone");
    assert_eq!(settled.data, Outcome::Moved);
}

#[test]
fn an_old_folder_that_is_a_link_moves_as_a_link() {
    let home = Home::new();
    // The user keeps the settings on another disk and linked them in.
    let elsewhere = home.path().join("disk/vrct-vox");
    fs::create_dir_all(elsewhere.join("downloaded_models")).unwrap();
    fs::write(elsewhere.join("downloaded_models/m.gguf"), b"GGUF").unwrap();
    let settings = json!({"A": home.old_config().join("downloaded_models/m.gguf").to_str(), "B": elsewhere.join("downloaded_models/m.gguf").to_str()});
    fs::write(elsewhere.join("config.json"), settings.to_string()).unwrap();
    std::os::unix::fs::symlink(&elsewhere, home.old_config()).unwrap();
    let settled = home.settle(Others::None);
    assert_eq!(settled.settings, Outcome::Moved);
    // The link moved; what it points to stayed where it is.
    assert_eq!(fs::read_link(home.new_config()).unwrap(), elsewhere);
    assert_eq!(fs::read_link(home.old_config()).unwrap(), Path::new("astarot"));
    assert!(elsewhere.join("downloaded_models/m.gguf").is_file());
    let saved = read(&home.new_config().join("config.json"));
    assert_eq!(saved["A"], json!(home.new_config().join("downloaded_models/m.gguf").to_str()));
    assert_eq!(saved["B"], json!(elsewhere.join("downloaded_models/m.gguf").to_str()), "the disk's own path still holds");
}

/// The single-instance names on a session bus of its own: `dbus-run-session -- cargo test
/// --test storage_linux -- --ignored`. CI runs it on Linux.
#[test]
#[cfg(target_os = "linux")]
#[ignore = "needs a session bus of its own (dbus-run-session)"]
fn a_single_instance_name_on_the_bus_is_another_app() {
    use vrct_core::storage::linux::other_instance;
    assert_eq!(other_instance(), Others::None);
    for id in ["io.github.kein5.vrct-vox", "io.github.kein5.astarot"] {
        let name = format!("{id}.SingleInstance");
        let held = zbus::blocking::connection::Builder::session().unwrap().name(name.as_str()).unwrap().build().unwrap();
        assert_eq!(other_instance(), Others::Running, "{name}");
        drop(held);
        // The bus lets the name go once the connection closes.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while other_instance() != Others::None && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(other_instance(), Others::None);
    }
}
