//! The endpoints the core answers are those of the specification
//! (`docs/spec/reference/ipc-endpoints.md`, written from the core by `tests/spec_catalog.rs` and
//! `tools/spec_catalog.py`): none is missing or left over, each waits for start-up exactly when
//! the specification says so, and the immediate ones skip the queue. The endpoints retired with
//! the Python backend are listed in `docs/voice-stack/core-integration.md`; none of them is wired.

mod common;

use std::collections::BTreeSet;
use astarot_core::controller::{Core, Services};
use astarot_core::dispatch::{IMMEDIATE_ENDPOINTS, Routes};

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
                waits: cells[2] == "待つ",
                immediate: cells[4].contains("即時"),
            }
        })
        .collect()
}

fn routes() -> Routes {
    let dir = tempfile::tempdir().unwrap();
    // Only the routes are listed; the keys stay in memory, never in the PC's credential store.
    let config = astarot_core::config::Config::open_with(
        common::environment(dir.path(), astarot_core::config::Platform::current()),
        astarot_core::config::secrets::MemoryStore::new(),
    );
    struct Quiet;
    impl astarot_core::dispatch::Output for Quiet {
        fn answer(&self, _: u16, _: Option<&str>, _: &serde_json::Value) {}
        fn received(&self, _: &str, _: &serde_json::Value) {}
        fn note(&self, _: &str) {}
    }
    let core = Core::new(config, std::sync::Arc::new(astarot_core::log::Log::disabled()), std::sync::Arc::new(Quiet), Services::default());
    astarot_core::controller::routes(&core)
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

/// `VR_PANEL_RELAY_PATHS` as the UI writes it (`src-ui/logics/common/vrPanelWire.ts`): path
/// strings and `toggle("name")` pairs.
fn ui_vr_panel_list() -> BTreeSet<String> {
    let text = include_str!("../../../src-ui/logics/common/vrPanelWire.ts");
    let block = text.split("export const VR_PANEL_RELAY_PATHS = new Set<string>([").nth(1).unwrap().split("]);").next().unwrap();
    let mut paths = BTreeSet::new();
    for line in block.lines() {
        let line = line.split("//").next().unwrap();
        for (i, piece) in line.split('"').enumerate().filter(|(i, _)| i % 2 == 1) {
            let before = line.split('"').nth(i - 1).unwrap_or("");
            if before.trim_end().ends_with("toggle(") {
                paths.insert(format!("/set/enable/{piece}"));
                paths.insert(format!("/set/disable/{piece}"));
            } else if piece.starts_with('/') {
                paths.insert(piece.to_string());
            }
        }
    }
    paths
}

#[test]
fn the_vr_panel_list_is_the_uis_and_every_entry_is_wired() {
    let ui = ui_vr_panel_list();
    assert!(ui.len() > 60, "the UI's list was not read: {ui:?}");
    let core: BTreeSet<String> = astarot_core::dispatch::vr_panel_endpoints().into_iter().collect();
    assert_eq!(core, ui, "native/core/src/dispatch.rs and src-ui/logics/common/vrPanelWire.ts list the same requests");
    let routes = routes();
    for endpoint in &core {
        assert!(routes.contains(endpoint), "{endpoint} is relayed for the VR panel but not wired");
    }
}

/// The endpoints whose answers `src-ui/logics/useReceiveRoutes.ts` hands to a hook
/// (`{ endpoint: "/...", ... }`).
fn ui_received_endpoints() -> BTreeSet<String> {
    let text = include_str!("../../../src-ui/logics/useReceiveRoutes.ts");
    text.split("endpoint: \"").skip(1).map(|rest| rest.split('"').next().unwrap().to_string()).filter(|e| e.starts_with('/')).collect()
}

/// The voice endpoints (speech settings and status, the managed route, mute, direct voice, the
/// voice audition): the UI hands the answer of each one the core serves to the voice hooks, and
/// receives none the core does not serve. Until 0.6.0 tests/voice/test_headless_and_ui_contract.py
/// held the UI to the Python backend's list.
#[test]
fn the_ui_receives_the_answer_of_every_voice_endpoint_the_core_serves() {
    let voice = |endpoint: &str| endpoint.contains("voice");
    let ui: BTreeSet<String> = ui_received_endpoints().into_iter().filter(|e| voice(e)).collect();
    assert!(ui.len() > 10, "the UI's routes were not read: {ui:?}");
    let core: BTreeSet<String> = routes().endpoints().filter(|e| voice(e)).map(str::to_string).collect();
    assert_eq!(
        core.difference(&ui).collect::<Vec<_>>(),
        Vec::<&String>::new(),
        "the core serves these voice endpoints, but src-ui/logics/useReceiveRoutes.ts drops their answers"
    );
    assert_eq!(
        ui.difference(&core).collect::<Vec<_>>(),
        Vec::<&String>::new(),
        "src-ui/logics/useReceiveRoutes.ts waits for these voice endpoints, but the core does not serve them"
    );
}

#[test]
fn the_specification_lists_what_is_wired_and_none_of_the_retired() {
    let spec: BTreeSet<String> = spec().into_iter().map(|s| s.endpoint).collect();
    let wired: BTreeSet<String> = routes().endpoints().map(str::to_string).collect();
    assert_eq!(
        spec.symmetric_difference(&wired).collect::<Vec<_>>(),
        Vec::<&String>::new(),
        "docs/spec/reference/ipc-endpoints.md is not the core's; write it again (tests/spec_catalog.rs)"
    );
    let retired = listed("retired-endpoints");
    assert!(!retired.is_empty(), "the retired endpoints were not read");
    assert!(retired.is_disjoint(&wired), "a retired endpoint is wired: {:?}", retired.intersection(&wired).collect::<Vec<_>>());
    assert_eq!(listed("remaining-endpoints"), BTreeSet::new(), "docs/voice-stack/core-integration.md lists endpoints left to wire");
}
