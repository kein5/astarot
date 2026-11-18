//! The Rust catalog answers what the Python module answers, byte for byte where bytes are
//! written: tests/data/python_reference.json comes from reference/dump_reference.py, and
//! tests/voice/test_native_ops_reference.py fails when it no longer matches catalog.py.
//!
//! The local translation's entries (`data/translation_models.json`) exist only here: Python
//! never had them, so they are left out of the comparison and checked in `catalog.rs`.

use std::path::Path;

use vrct_ops::downloads::catalog::{self, artifact_url, speech_field, Model, TARGETS, TRANSLATION_TARGET};
use vrct_ops::downloads::Downloads;
use vrct_ops::json::{Json, Object};

fn reference() -> Json {
    let text = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/python_reference.json")).unwrap();
    Json::parse(&text).unwrap()
}

/// The entries Python has too.
fn python_entries() -> Vec<Model> {
    catalog::catalog().into_iter().filter(|m| m.target != TRANSLATION_TARGET).collect()
}

fn without_destination(models: &Json) -> Vec<Json> {
    models
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m.get("target").and_then(Json::as_str) != Some(TRANSLATION_TARGET))
        .map(|m| {
            let mut m = m.as_object().unwrap().clone();
            m.remove("destination");
            Json::Object(m)
        })
        .collect()
}

#[test]
fn the_catalog_is_the_python_catalog_key_for_key() {
    let reference = reference();
    let root = reference.get("root").unwrap().as_str().unwrap();
    let ours = Downloads::new(root).unwrap().catalog();
    let theirs = reference.get("catalog").unwrap();
    assert_eq!(ours.get("catalog_version"), theirs.get("catalog_version"));
    let (our_models, their_models) = (without_destination(ours.get("models").unwrap()), without_destination(theirs.get("models").unwrap()));
    assert_eq!(our_models.len(), their_models.len());
    // Same entries, same order, same keys in the same order, same values.
    for (a, b) in our_models.iter().zip(their_models) {
        assert_eq!(*a, b, "{}", a.get("id").unwrap().as_str().unwrap());
    }
    if cfg!(unix) && catalog::translation_models().is_empty() {
        assert_eq!(ours, *theirs);
    }
}

#[test]
fn urls_receipts_and_markers_are_what_python_writes() {
    let reference = reference();
    for model in python_entries() {
        let urls: Vec<Json> = model.artifacts.iter().map(|a| Json::from(artifact_url(&model, a))).collect();
        assert_eq!(Json::from(urls), *reference.get("urls").unwrap().get(&model.id).unwrap(), "{}", model.id);
        let receipt = Json::from_serialize(&model).to_python_indented();
        assert_eq!(Json::from(receipt), *reference.get("receipts").unwrap().get(&model.id).unwrap(), "{}", model.id);
    }
    let dir = tempfile::tempdir().unwrap();
    let staging = dir.path().join(format!(".partial-{}", "0".repeat(32)));
    std::fs::create_dir(&staging).unwrap();
    for model in python_entries() {
        let _ = std::fs::remove_file(staging.join("owner.json"));
        vrct_ops::downloads::staging::mark_owned(&staging, &model).unwrap();
        let written = std::fs::read_to_string(staging.join("owner.json")).unwrap();
        assert_eq!(Json::from(written), *reference.get("owners").unwrap().get(&model.id).unwrap(), "{}", model.id);
    }
}

#[test]
fn targets_and_speech_fields_are_python_s() {
    let reference = reference();
    let targets: Vec<Json> = TARGETS.iter().map(|t| Json::from(*t)).collect();
    assert_eq!(Json::from(targets), *reference.get("targets").unwrap());
    let fields = reference.get("speech_fields").unwrap().as_object().unwrap();
    let mut ours = Object::new();
    for target in TARGETS {
        if let Some((profile, field)) = speech_field(target) {
            ours.insert(target, vec![Json::from(profile), Json::from(field)]);
        }
    }
    assert_eq!(ours, *fields);
}

#[test]
fn the_catalog_holds_only_reviewed_public_artifacts() {
    let entries = catalog::catalog();
    let targets: std::collections::BTreeSet<&str> = entries.iter().map(|m| m.target.as_str()).filter(|t| *t != TRANSLATION_TARGET).collect();
    assert_eq!(targets, TARGETS.into_iter().collect());
    assert!(!format!("{entries:?}").contains("Mia"));
    for m in &entries {
        let mut pins = vec![m.revision.clone()];
        pins.extend(m.artifacts.iter().filter_map(|a| a.remote.as_ref().map(|r| r.revision.clone())));
        assert!(!m.licenses.is_empty());
        for url in &m.licenses {
            let pinned = pins.iter().any(|p| url.contains(&format!("/{p}/")));
            assert!(pinned || url.starts_with("https://creativecommons.org/") || url.starts_with("https://www.apache.org/licenses/"), "{url}");
        }
        assert!(!m.artifacts.is_empty() && m.artifacts.iter().all(|a| a.size > 0));
    }
}
