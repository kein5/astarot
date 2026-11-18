//! Settings across versions (#560): a version that is started after a newer one, and then the newer
//! one again, must not have lost the newer one's settings on the way.

use serde_json::{Map, Value, json};
use std::path::Path;
use vrct_core::config::secrets::MemoryStore;
use vrct_core::config::{Config, Environment, Platform, RETIRED_KEYS};

fn environment(dir: &Path) -> Environment {
    Environment {
        version: "0.0.0".into(),
        state_dir: dir.to_path_buf(),
        app_dir: dir.join("app"),
        data_dir: dir.join("data"),
        platform: Platform::current(),
        compute_devices: vec![Environment::cpu_device()],
        devices: None,
        websocket_token: Some("token".into()),
    }
}

fn read(dir: &Path) -> Map<String, Value> {
    serde_json::from_str(&std::fs::read_to_string(dir.join("config.json")).unwrap()).unwrap()
}

/// Makes the file the owner's only, as the app writes it: on Unix a file others may read is
/// written again at start, which these tests do not want.
fn owner_only(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[test]
fn a_setting_this_version_does_not_know_is_written_back_as_it_was() {
    let dir = tempfile::tempdir().unwrap();
    let newer = json!({ "kind": "added later", "list": [1, 2.5, null], "nested": { "on": true } });
    std::fs::write(
        dir.path().join("config.json"),
        serde_json::to_string(&json!({
            "UI_LANGUAGE": "ja",
            "SETTING_OF_A_NEWER_VERSION": newer,
            "WHISPER_WEIGHT_TYPE": "base",
            "VERSION": "9.9.9",
        }))
        .unwrap(),
    )
    .unwrap();
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    // It is not used ...
    assert_eq!(config.get("SETTING_OF_A_NEWER_VERSION"), Value::Null);
    assert_eq!(config.get("UI_LANGUAGE"), "ja");
    let saved = read(dir.path());
    // ... but it stays in the file, after the keys this version writes.
    assert_eq!(saved["SETTING_OF_A_NEWER_VERSION"], newer);
    assert_eq!(saved.keys().last().map(String::as_str), Some("SETTING_OF_A_NEWER_VERSION"));
    // A key an earlier version saved and this one retired goes, and so does a fixed value.
    assert!(RETIRED_KEYS.contains(&"WHISPER_WEIGHT_TYPE"));
    assert!(!saved.contains_key("WHISPER_WEIGHT_TYPE"));
    assert!(!saved.contains_key("VERSION"));

    // A change made in this version keeps it too.
    config.set("UI_LANGUAGE", json!("en")).unwrap();
    config.save_now();
    let saved = read(dir.path());
    assert_eq!(saved["UI_LANGUAGE"], "en");
    assert_eq!(saved["SETTING_OF_A_NEWER_VERSION"], newer);
    config.close();
    drop(config);

    // And the next start keeps it again.
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    assert_eq!(read(dir.path())["SETTING_OF_A_NEWER_VERSION"], newer);
    config.close();
}

#[test]
fn a_start_that_changes_nothing_leaves_the_file_alone() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    // The first start writes every setting.
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    config.close();
    drop(config);
    let written = read(dir.path());
    assert!(!written.is_empty());

    // The same settings in another layout (as another version may write them, the keys in
    // another order): the next start has nothing to change, so it does not write.
    let mut reordered: Vec<(String, Value)> = written.clone().into_iter().collect();
    reordered.reverse();
    let compact = serde_json::to_string(&Value::Object(reordered.into_iter().collect())).unwrap();
    std::fs::write(&path, &compact).unwrap();
    owner_only(&path);
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), compact, "the file was written at start");
    config.close();
    drop(config);

    // A start that changes something writes it.
    let mut older = written.clone();
    older.shift_remove("USAGE_PRESETS");
    std::fs::write(&path, serde_json::to_string(&older).unwrap()).unwrap();
    owner_only(&path);
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    assert_eq!(read(dir.path())["USAGE_PRESETS"], json!(["all"]), "the migration was saved");
    config.close();
}

#[cfg(unix)]
#[test]
fn a_file_others_may_read_is_written_at_start_for_the_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    config.close();
    drop(config);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    let config = Config::open_with(environment(dir.path()), MemoryStore::new());
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    config.close();
}
