//! Model resolution: the catalog table, the character lists and the file checks.

mod common;

use std::path::{Path, PathBuf};

use common::{fixture, reference_dir};
use ocr_runtime::languages::{resolve_model_spec, selectable_languages, BASE_MODEL_ID};
use ocr_runtime::models::{characters, is_installed, missing_models, resolve_artifact, resolve_model_files, CATALOG, DETECTOR_FILE_NAME, DETECTOR_MODEL_ID};
use ocr_runtime::Error;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The Rust table must repeat the OCR block of the download catalog exactly.
#[test]
fn catalog_matches_the_download_catalog() {
    let catalog = repo_root().join("src-python/models/model_downloads/catalog.py");
    let script = format!(
        "import importlib.util, json\n\
         s = importlib.util.spec_from_file_location('c', r'{}')\n\
         m = importlib.util.module_from_spec(s); s.loader.exec_module(m)\n\
         print(json.dumps([[e.id, e.revision, [[a.filename, a.size, a.sha256, a.role] for a in e.artifacts]] for e in m.CATALOG if e.target == 'ocr']))\n\
         print(json.dumps([m.DETECTOR_MODEL_ID, m.DETECTOR_FILE_NAME]))",
        catalog.display()
    );
    let output = match std::process::Command::new("python3").args(["-I", "-c", &script]).output() {
        Ok(output) if output.status.success() => output,
        _ => {
            eprintln!("SKIPPED: python3 could not read catalog.py");
            return;
        }
    };
    let text = String::from_utf8(output.stdout).unwrap();
    let mut lines = text.lines();
    let entries: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
    let mine: Vec<serde_json::Value> =
        CATALOG.iter().map(|e| serde_json::json!([e.id, e.revision, e.artifacts.iter().map(|a| serde_json::json!([a.filename, a.size, a.sha256, a.role])).collect::<Vec<_>>()])).collect();
    assert_eq!(serde_json::Value::Array(mine), entries);
    let detector: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
    assert_eq!(detector, serde_json::json!([DETECTOR_MODEL_ID, DETECTOR_FILE_NAME]));
}

/// The character lists read from inference.yml match what PyYAML gave the Python code.
#[test]
fn characters_match_pyyaml() {
    let Some(lists) = fixture("engine/characters.json") else { return };
    let root = reference_dir().join("downloaded_models");
    for (model_id, expected) in lists.as_object().unwrap() {
        let path = resolve_artifact(&root, model_id, "dict").unwrap();
        let found = characters(&path).unwrap();
        let expected: Vec<String> = expected.as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).collect();
        assert_eq!(found.len(), expected.len(), "{model_id}");
        assert!(found == expected, "{model_id}: the character lists differ");
    }
    println!("METRIC characters: {} lists identical", lists.as_object().unwrap().len());
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ocr-runtime-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn missing_and_invalid_downloads_are_reported() {
    let root = scratch("models");
    let spec = resolve_model_spec("Korean").unwrap();
    assert_eq!(missing_models(&root, &spec), vec![BASE_MODEL_ID.to_string(), "ppocrv5-korean".to_string()]);
    match resolve_model_files(Some(&root), &spec) {
        Err(Error::ModelsMissing(ids)) => assert_eq!(ids, vec![BASE_MODEL_ID.to_string(), "ppocrv5-korean".to_string()]),
        other => panic!("expected ModelsMissing, got {other:?}"),
    }
    match resolve_model_files(None, &spec) {
        Err(Error::ModelsMissing(ids)) => assert_eq!(ids.len(), 2),
        other => panic!("expected ModelsMissing, got {other:?}"),
    }

    // Files of the right size but different content are invalid, not missing.
    let entry = CATALOG.iter().find(|e| e.id == DETECTOR_MODEL_ID).unwrap();
    let dir = root.join(entry.id).join(entry.revision);
    std::fs::create_dir_all(&dir).unwrap();
    let artifact = entry.artifacts[0];
    std::fs::write(dir.join(artifact.filename), vec![0u8; artifact.size as usize]).unwrap();
    assert!(is_installed(&root, DETECTOR_MODEL_ID));
    assert!(matches!(resolve_artifact(&root, DETECTOR_MODEL_ID, "detector"), Err(Error::ModelsInvalid(_))));
    // Truncated: not installed.
    std::fs::write(dir.join(artifact.filename), b"short").unwrap();
    assert!(!is_installed(&root, DETECTOR_MODEL_ID));
    assert!(matches!(resolve_artifact(&root, DETECTOR_MODEL_ID, "detector"), Err(Error::ModelsMissing(_))));
    #[cfg(unix)]
    {
        // A symbolic link in place of the file does not count as a download.
        let target = root.join("elsewhere.onnx");
        std::fs::write(&target, vec![0u8; artifact.size as usize]).unwrap();
        std::fs::remove_file(dir.join(artifact.filename)).unwrap();
        std::os::unix::fs::symlink(&target, dir.join(artifact.filename)).unwrap();
        assert!(!is_installed(&root, DETECTOR_MODEL_ID));
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn character_lists_refuse_what_they_cannot_read_exactly() {
    let root = scratch("yaml");
    let write = |body: &str| {
        let path = root.join("rec.yml");
        std::fs::write(&path, body).unwrap();
        path
    };
    let ok = write("Global:\n  model_name: x\nPostProcess:\n  name: CTCLabelDecode\n  character_dict:\n  - a\n  - ''''\n  - '#'\n  - ~\n  - 0\nOther: 1\n");
    assert_eq!(characters(&ok).unwrap(), vec!["a", "'", "#", "None", "0"]);
    assert!(matches!(characters(&write("PostProcess:\n  character_dict:\n  - yes\n")), Err(Error::ModelsInvalid(_))));
    assert!(matches!(characters(&write("PostProcess:\n  character_dict:\n  - \"a\"\n")), Err(Error::ModelsInvalid(_))));
    assert!(matches!(characters(&write("PostProcess:\n  name: x\n")), Err(Error::ModelsInvalid(_))));
    let _ = std::fs::remove_dir_all(&root);
}

/// Ported from src-python/test/test_ocr_languages.py.
#[test]
fn languages_map_to_models() {
    assert_eq!(selectable_languages(), vec!["auto", "Arabic", "Hindi", "Korean", "Russian", "Thai", "Ukrainian"]);
    let auto = resolve_model_spec("auto").unwrap();
    assert_eq!(auto.model_ids(), vec![BASE_MODEL_ID]);
    assert_eq!(auto.label(), "PP-OCRv6/small/default");
    for covered in ["Japanese", "English", "Chinese Simplified", "Chinese Traditional", "German", "Indonesian"] {
        assert_eq!(resolve_model_spec(covered), Some(auto), "{covered}");
    }
    assert_eq!(resolve_model_spec("Russian"), resolve_model_spec("Ukrainian"));
    let arabic = resolve_model_spec("Arabic").unwrap();
    assert!(arabic.right_to_left());
    assert!(!auto.right_to_left());
    assert_eq!(arabic.model_ids(), vec![BASE_MODEL_ID, "ppocrv5-arabic"]);
    assert_eq!(resolve_model_spec("Hindi").unwrap().label(), "PP-OCRv5/mobile/devanagari");
    assert_eq!(resolve_model_spec(""), None);
    assert_eq!(resolve_model_spec("Klingon"), None);
}
