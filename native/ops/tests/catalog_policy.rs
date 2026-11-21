//! The catalog offers only artifacts that were reviewed and are public: every target has its
//! entries, no entry carries the Mia2026 voice, every entry names its licenses at a pinned
//! revision (or a fixed license text), and every file has a size. Until 0.6.0 this sat with the
//! comparison against the Python backend's catalog, which went with the backend (#746).

use vrct_ops::downloads::catalog::{self, TARGETS, TRANSLATION_TARGET};

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
