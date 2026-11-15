//! The endpoints the core answers are those of the specification
//! (`docs/spec/reference/ipc-endpoints.md`): none is invented, each waits for start-up exactly
//! when the specification says so, and the immediate ones skip the queue. The ones not wired
//! yet are listed in `docs/voice-stack/core-integration.md`; this test fails when that list
//! and the core disagree, so the list stays the true state of the migration.

mod common;

use std::collections::BTreeSet;
use vrct_core::controller::{Core, Services};
use vrct_core::dispatch::{IMMEDIATE_ENDPOINTS, Routes};

struct Spec {
    endpoint: String,
    waits: bool,
    immediate: bool,
}

fn spec() -> Vec<Spec> {
    let text = include_str!("../../../docs/spec/reference/ipc-endpoints.md");
    let requests = text.split("## 要求").nth(1).unwrap().split("\n## ").next().unwrap();
    requests
        .lines()
        .filter(|line| line.starts_with("| `/"))
        .map(|line| {
            let cells: Vec<&str> = line.trim_matches('|').split(" | ").map(str::trim).collect();
            Spec {
                endpoint: cells[0].trim_matches('`').to_string(),
                waits: cells[3] == "待つ",
                immediate: cells[5].contains("即時"),
            }
        })
        .collect()
}

fn routes() -> Routes {
    let dir = tempfile::tempdir().unwrap();
    let config = vrct_core::config::Config::open(common::environment(dir.path(), vrct_core::config::Platform::current()));
    struct Quiet;
    impl vrct_core::dispatch::Output for Quiet {
        fn answer(&self, _: u16, _: Option<&str>, _: &serde_json::Value) {}
        fn received(&self, _: &str, _: &serde_json::Value) {}
        fn note(&self, _: &str) {}
    }
    let core = Core::new(config, std::sync::Arc::new(vrct_core::log::Log::disabled()), std::sync::Arc::new(Quiet), Services::default());
    vrct_core::controller::routes(&core)
}

/// The endpoints listed between `<!-- {name}:begin -->` and `<!-- {name}:end -->` in the
/// migration document: those still to wire, and those retired with the Python backend.
fn listed(name: &str) -> BTreeSet<String> {
    let text = include_str!("../../../docs/voice-stack/core-integration.md");
    let section = text.split(&format!("<!-- {name}:begin -->")).nth(1).unwrap().split(&format!("<!-- {name}:end -->")).next().unwrap();
    section
        .split('`')
        .skip(1)
        .step_by(2)
        .filter(|item| item.starts_with('/'))
        .map(str::to_string)
        .collect()
}

#[test]
fn every_endpoint_is_specified_and_waits_as_specified() {
    let spec = spec();
    assert!(spec.len() > 400, "the specification lists the requests");
    let routes = routes();
    for endpoint in routes.endpoints() {
        let entry = spec.iter().find(|s| s.endpoint == endpoint).unwrap_or_else(|| panic!("{endpoint} is not in the specification"));
        assert_eq!(routes.get(endpoint).unwrap().wait_for_init, entry.waits, "{endpoint}: waiting for start-up");
        assert_eq!(IMMEDIATE_ENDPOINTS.contains(&endpoint), entry.immediate, "{endpoint}: skipping the queue");
    }
    for entry in spec.iter().filter(|s| s.immediate) {
        assert!(IMMEDIATE_ENDPOINTS.contains(&entry.endpoint.as_str()), "{} skips the queue", entry.endpoint);
    }
}

#[test]
fn the_remaining_endpoints_are_listed_in_the_migration_document() {
    let spec: BTreeSet<String> = spec().into_iter().map(|s| s.endpoint).collect();
    let routes = routes();
    let wired: BTreeSet<String> = routes.endpoints().map(str::to_string).collect();
    let remaining: BTreeSet<String> = spec.difference(&wired).cloned().collect();
    let retired = listed("retired-endpoints");
    assert!(retired.is_disjoint(&wired), "a retired endpoint is wired: {:?}", retired.intersection(&wired).collect::<Vec<_>>());
    let listed: BTreeSet<String> = listed("remaining-endpoints").union(&retired).cloned().collect();
    let missing: Vec<_> = remaining.difference(&listed).collect();
    let stale: Vec<_> = listed.difference(&remaining).collect();
    assert!(
        missing.is_empty() && stale.is_empty(),
        "docs/voice-stack/core-integration.md is out of date.\nNot listed but not wired: {missing:?}\nListed but wired (or not in the specification): {stale:?}"
    );
}
