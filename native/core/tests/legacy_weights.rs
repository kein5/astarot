//! The Python backend's CTranslate2 weights are removed only when the core runs as the default
//! backend (#285, decided: retired), and only the folders the Python backend made.

mod common;

use common::{Setup, Ui};
use std::path::Path;
use std::time::{Duration, Instant};
use vrct_core::controller::legacy_weights::{self, FOLDERS};

fn weights(data: &Path) -> std::path::PathBuf {
    data.join("weights").join("ctranslate2")
}

fn stage(data: &Path) {
    for name in FOLDERS {
        let folder = weights(data).join(name);
        std::fs::create_dir_all(folder.join("tokenizer")).unwrap();
        std::fs::write(folder.join("model.bin"), b"weights").unwrap();
    }
}

fn start(dir: &Path, retire: bool) -> Ui {
    let mut setup = Setup { dir: Some(dir.to_path_buf()), ..Setup::default() };
    setup.services.retire_legacy_translation_weights = retire;
    Ui::with(setup)
}

fn wait_until(what: &str, done: impl Fn() -> bool) {
    let deadline = Instant::now() + common::TIMEOUT;
    while !done() {
        assert!(Instant::now() < deadline, "{what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn while_the_python_sidecar_is_the_default_the_weights_stay() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    stage(&data);
    let ui = start(dir.path(), false);
    ui.ready();
    std::thread::sleep(Duration::from_millis(500));
    ui.stop();
    assert_eq!(legacy_weights::present(&data).len(), FOLDERS.len(), "a development run of the core keeps them");
}

#[test]
fn as_the_default_backend_the_core_removes_them_after_start_up_and_nothing_else() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    stage(&data);
    // Something the Python backend did not make, next to the weights and elsewhere.
    std::fs::write(weights(&data).join("notes.txt"), b"mine").unwrap();
    std::fs::create_dir_all(data.join("weights").join("other")).unwrap();
    let ui = start(dir.path(), true);
    ui.ready();
    wait_until("the weights were removed", || legacy_weights::present(&data).is_empty());
    assert!(weights(&data).join("notes.txt").exists(), "an unknown file is kept");
    assert!(data.join("weights").join("other").exists());
    ui.stop();
}

#[test]
fn the_folder_goes_too_when_nothing_else_is_in_it() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    stage(&data);
    let ui = start(dir.path(), true);
    ui.ready();
    wait_until("the ctranslate2 folder was removed", || !weights(&data).exists());
    assert!(data.join("weights").exists());
    ui.stop();
}

#[cfg(unix)]
#[test]
fn a_link_is_never_followed() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let outside = dir.path().join("outside");
    std::fs::create_dir_all(outside.join("m2m100_418M-ct2-int8")).unwrap();
    std::fs::write(outside.join("m2m100_418M-ct2-int8").join("model.bin"), b"keep").unwrap();
    std::fs::create_dir_all(data.join("weights")).unwrap();
    // The ctranslate2 folder itself is a link: nothing behind it is touched.
    std::os::unix::fs::symlink(&outside, weights(&data)).unwrap();
    assert!(legacy_weights::present(&data).is_empty());
    assert_eq!(legacy_weights::remove(&data), legacy_weights::Removed::default());
    // A weight folder that is a link is not one of the folders either.
    std::fs::remove_file(weights(&data)).unwrap();
    std::fs::create_dir_all(weights(&data)).unwrap();
    std::os::unix::fs::symlink(outside.join("m2m100_418M-ct2-int8"), weights(&data).join("m2m100_418M-ct2-int8")).unwrap();
    assert!(legacy_weights::present(&data).is_empty());
    legacy_weights::remove(&data);
    assert!(outside.join("m2m100_418M-ct2-int8").join("model.bin").exists());
}
