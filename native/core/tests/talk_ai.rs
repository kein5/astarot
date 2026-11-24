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

#[test]
fn audio_waits_for_the_indicator_then_captures_and_plays_on_the_local_output() {
    use astarot_transcription::capture::Source;
    use common::{fake_capture::FakeCapture, fake_voice::FakeVoice};
    use serde_json::Value;
    use std::{
        net::TcpListener,
        thread,
        time::{Duration, Instant},
    };
    use tungstenite::Message;

    let listen = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = format!("ws://{}/v1/realtime", listen.local_addr().unwrap());
    let server = thread::spawn(move || {
        let stream = listen.accept().unwrap().0;
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut socket = tungstenite::accept(stream).unwrap();
        socket
            .send(Message::text(r#"{"type":"session.created","session":{}}"#))
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(socket.read().unwrap().to_text().unwrap()).unwrap()["type"],
            "session.update"
        );
        socket
            .send(Message::text(r#"{"type":"session.updated","session":{}}"#))
            .unwrap();
        let audio =
            serde_json::from_str::<Value>(socket.read().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(audio["type"], "input_audio_buffer.append");
        assert_eq!(
            audio["audio"].as_str().unwrap().len(),
            1280,
            "20 ms of 24 kHz PCM in base64"
        );
        socket.send(Message::text(r#"{"type":"response.output_audio.delta","response_id":"response","item_id":"answer","delta":"AQACAA=="}"#)).unwrap();
        while let Ok(message) = socket.read() {
            if message.is_close() {
                break;
            }
        }
    });

    let fake_capture = FakeCapture::new();
    fake_capture.add_endpoint(Source::Mic, "talk-mic", "Microphone");
    fake_capture.set_default(Source::Mic, Some("talk-mic"));
    let fake_voice = FakeVoice::new();
    let mut setup = Setup::default();
    setup.services.transcription_capture = fake_capture.factory();
    setup.services.voice = fake_voice.platform();
    let ui = Ui::with(setup);
    ui.ready();
    ui.ok(
        "/set/data/experimental_features",
        Some(json!({"talk_ai": true})),
    );
    ui.ok("/set/data/talk_ai_provider", Some(json!("vllm_omni")));
    ui.ok("/set/data/talk_ai_local_url", Some(json!(address)));
    let initial = ui.ok(
        "/set/enable/talk_ai",
        Some(json!({
            "provider": "vllm_omni", "destination": address, "consent": {"audio": true}
        })),
    );
    let session_id = initial["session_id"].clone();
    wait_until(|| ui.ok("/get/data/talk_ai_status", None)["phase"] == "ready");
    let blocked = ui.request(
        "/set/enable/talk_ai_audio",
        Some(json!({"session_id": session_id})),
    );
    assert_eq!(blocked["result"]["error_code"], "talk_indicator_required");
    assert!(fake_capture.opened().is_empty());
    ui.ok(
        "/set/enable/talk_ai_audio",
        Some(json!({"session_id": session_id, "indicator_visible": true})),
    );
    wait_until(|| {
        fake_voice
            .played()
            .iter()
            .any(|output| output.device == "monitor:" && output.bytes == [1, 0, 2, 0])
    });
    assert_eq!(
        ui.ok("/get/data/talk_ai_status", None)["sending_audio"],
        true
    );
    let blocked = ui.request("/set/enable/transcription_send", None);
    assert_eq!(blocked["result"]["error_code"], "talk_microphone_in_use");
    let blocked = ui.request(
        "/run/start_realtime_asr",
        Some(json!({"source": "mic", "_realtime_generation": 0})),
    );
    assert_eq!(blocked["result"]["error_code"], "talk_microphone_in_use");
    ui.ok("/set/disable/talk_ai", None);
    wait_until(|| fake_capture.running(Source::Mic) == 0);
    assert_eq!(
        ui.ok("/get/data/talk_ai_status", None)["sending_audio"],
        false
    );
    server.join().unwrap();
    ui.stop();

    fn wait_until(mut ready: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !ready() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
    }
}
