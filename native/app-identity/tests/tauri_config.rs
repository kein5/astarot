//! `src-tauri/tauri.conf.json` names the app ID and the executable for the Tauri build, which
//! cannot read them from this crate. The two must stay the same: the desktop file the app
//! writes for the portals carries the app ID and the executable's window class.

use std::path::Path;

/// The string value of the first `"key": "..."` in `text`.
fn string_value<'a>(text: &'a str, key: &str) -> &'a str {
    let quoted = format!("\"{key}\"");
    let after = &text[text.find(&quoted).unwrap_or_else(|| panic!("{key} in tauri.conf.json")) + quoted.len()..];
    let value = after.trim_start().strip_prefix(':').expect("a colon after the key").trim_start();
    let value = value.strip_prefix('"').expect("a string value");
    &value[..value.find('"').expect("the end of the string")]
}

fn tauri_config() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/tauri.conf.json");
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[test]
fn the_tauri_build_uses_the_app_id_written_here() {
    assert_eq!(string_value(&tauri_config(), "identifier"), app_identity::APP_ID.current());
}

#[test]
fn the_tauri_build_names_the_executable_written_here() {
    assert_eq!(string_value(&tauri_config(), "mainBinaryName"), app_identity::EXECUTABLE.current());
}

#[test]
fn the_uninstaller_also_removes_the_data_of_the_old_app_id() {
    // ADR-014, 2.5: "delete the app data" takes the WebView folders of both app IDs.
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/nsis/template.nsi");
    let template = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let old = format!("!define OLDBUNDLEID \"{}\"", app_identity::APP_ID.legacy);
    assert!(template.lines().any(|line| line == old), "{old}");
    for folder in ["$APPDATA", "$LOCALAPPDATA"] {
        for id in ["BUNDLEID", "OLDBUNDLEID"] {
            let line = format!("RmDir /r \"{folder}\\${{{id}}}\"");
            assert!(template.lines().any(|l| l.trim() == line), "{line}");
        }
    }
}
