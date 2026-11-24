mod common;

use common::{Setup, Ui};
use serde_json::json;

#[test]
fn the_experiment_requires_fresh_consent_for_the_selected_destination() {
    let ui = Ui::with(Setup::default());
    let catalog = ui.ok("/get/data/talk_ai_catalog", None);
    assert_eq!(catalog[0]["vision"], true);
    let consent = json!({
        "provider": "openai",
        "destination": catalog[0]["destination"],
        "consent": { "audio": true }
    });
    assert_eq!(
        ui.request("/set/enable/talk_ai", Some(consent.clone()))["result"]["error_code"],
        "talk_disabled"
    );
    ui.ok(
        "/set/data/experimental_features",
        Some(json!({ "talk_ai": true })),
    );
    for invalid in [
        json!(null),
        json!({ "provider": "openai", "destination": "wss://other.invalid", "consent": { "audio": true } }),
    ] {
        assert_eq!(
            ui.request("/set/enable/talk_ai", Some(invalid))["result"]["error_code"],
            "talk_consent_required"
        );
    }
    assert_eq!(
        ui.request("/set/enable/talk_ai", Some(consent))["result"]["error_code"],
        "talk_key_required"
    );
    assert_eq!(ui.ok("/get/data/talk_ai_status", None)["phase"], "idle");
    ui.stop();
}

#[test]
fn the_key_stays_in_the_credential_store_and_the_api_returns_presence_only() {
    let ui = Ui::with(Setup::default());
    let key = "test-credential-never-log";
    let configured = json!({ "configured": true, "stored": true });
    assert_eq!(
        ui.ok("/set/data/talk_ai_auth_key", Some(json!(key))),
        configured
    );
    assert_eq!(ui.ok("/get/data/talk_ai_auth_key", None), configured);
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.kept_key("TALK_AI", "openai"), key);
    assert!(!ui.saved().to_string().contains(key));
    ui.stop();
}

#[test]
fn the_local_catalog_address_rejects_public_hosts_and_inline_keys() {
    let ui = Ui::with(Setup::default());
    for url in [
        "ws://8.8.8.8/v1/realtime",
        "wss://example.com/v1/realtime",
        "ws://localhost/v1/realtime?key=example",
    ] {
        assert_eq!(
            ui.request("/set/data/talk_ai_local_url", Some(json!(url)))["result"]["error_code"],
            "talk_settings_invalid"
        );
    }
    let url = "ws://192.168.1.12:8000/v1/realtime";
    ui.ok("/set/data/talk_ai_local_url", Some(json!(url)));
    assert_eq!(
        ui.ok("/get/data/talk_ai_catalog", None)[1]["destination"],
        url
    );
    ui.stop();
}
