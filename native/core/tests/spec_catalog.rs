//! What the core answers, pushes and keeps, for the reference tables of the specification
//! (`docs/spec/reference/`, CT-05 in `docs/spec/contracts.md`).
//!
//! `tools/spec_catalog.py` writes the tables from `tools/spec_core_catalog.json` (with the UI's
//! side and the checks written in `config/schema.rs`), so that it never builds or runs the core.
//! This test makes that file from the core itself and fails when the committed one differs:
//!
//! ```sh
//! VRCT_SPEC_CATALOG_WRITE=1 cargo test --manifest-path native/core/Cargo.toml --test spec_catalog
//! python tools/spec_catalog.py --write
//! ```
//!
//! The settings' defaults are those of a fixed environment, so that the file is the same on every
//! PC: the paths are placeholders, the version is the app's own (`package.json`; the tables put
//! it in), and the only compute device is the CPU.

mod common;

use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use vrct_core::config::{Config, Environment, Platform, schema};
use vrct_core::controller::{Core, RUN_MAPPING, Services};
use vrct_core::dispatch::IMMEDIATE_ENDPOINTS;

const FILE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tools/spec_core_catalog.json");

/// The placeholders of the paths a PC decides.
const APP_DIR: &str = "<app>";
const DATA_DIR: &str = "<data>";
const STATE_DIR: &str = "<state>";

fn environment() -> Environment {
    Environment {
        version: "<version>".into(),
        state_dir: PathBuf::from(STATE_DIR),
        app_dir: PathBuf::from(APP_DIR),
        data_dir: PathBuf::from(DATA_DIR),
        // The settings the tables list are those of Windows, where most users are.
        platform: Platform::Windows,
        compute_devices: vec![Environment::cpu_device()],
        devices: None,
        websocket_token: Some("<token>".into()),
    }
}

fn endpoints() -> Vec<Value> {
    let dir = tempfile::tempdir().unwrap();
    // Only the routes are listed; the keys stay in memory, never in the PC's credential store.
    let config = Config::open_with(
        common::environment(dir.path(), Platform::current()),
        vrct_core::config::secrets::MemoryStore::new(),
    );
    struct Quiet;
    impl vrct_core::dispatch::Output for Quiet {
        fn answer(&self, _: u16, _: Option<&str>, _: &Value) {}
        fn received(&self, _: &str, _: &Value) {}
        fn note(&self, _: &str) {}
    }
    let core = Core::new(config, std::sync::Arc::new(vrct_core::log::Log::disabled()), std::sync::Arc::new(Quiet), Services::default());
    let routes = vrct_core::controller::routes(&core);
    routes
        .endpoints()
        .map(|endpoint| {
            let route = routes.get(endpoint).unwrap();
            json!({ "endpoint": endpoint, "wait_for_init": route.wait_for_init, "immediate": IMMEDIATE_ENDPOINTS.contains(&endpoint) })
        })
        .collect()
}

/// A path default with `/` between its parts on every system.
fn portable(value: Value) -> Value {
    match value {
        Value::String(text) if [APP_DIR, DATA_DIR, STATE_DIR].iter().any(|dir| text.starts_with(dir)) => json!(text.replace('\\', "/")),
        other => other,
    }
}

fn config() -> Vec<Value> {
    let defaults = schema::defaults(&environment());
    schema::keys()
        .iter()
        .map(|key| {
            let kind = if key.readonly {
                "readonly"
            } else if !key.serialize {
                "runtime"
            } else if key.immediate {
                "immediate"
            } else {
                "saved"
            };
            json!({ "key": key.name, "kind": kind, "default": portable(defaults.get(key.name).cloned().unwrap_or(Value::Null)) })
        })
        .collect()
}

fn catalog() -> Value {
    json!({
        "_comment": "Written by native/core/tests/spec_catalog.rs from the core; tools/spec_catalog.py makes docs/spec/reference/ from it. Do not edit by hand.",
        "endpoints": endpoints(),
        "notifications": RUN_MAPPING.iter().map(|(name, endpoint)| json!({ "name": name, "endpoint": endpoint })).collect::<Vec<_>>(),
        "sensitive_markers": vrct_core::log::SENSITIVE_ENDPOINT_MARKERS,
        "errors": vrct_core::errors::codes().iter().map(|info| json!({
            "code": info.code,
            "category": info.category.as_str(),
            "message": info.message,
            "severity": info.severity.as_str(),
            "user_action_required": info.user_action_required,
        })).collect::<Vec<_>>(),
        "config": config(),
    })
}

#[test]
fn the_committed_catalog_is_the_core_s() {
    let text = serde_json::to_string_pretty(&catalog()).unwrap() + "\n";
    let path = Path::new(FILE);
    if std::env::var_os("VRCT_SPEC_CATALOG_WRITE").is_some() {
        std::fs::write(path, &text).unwrap();
        return;
    }
    let committed = std::fs::read_to_string(path).unwrap_or_default().replace("\r\n", "\n");
    assert!(
        committed == text,
        "tools/spec_core_catalog.json is not the core's; run `VRCT_SPEC_CATALOG_WRITE=1 cargo test --test spec_catalog` \
         in native/core, then `python tools/spec_catalog.py --write`"
    );
}
