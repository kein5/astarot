//! What the core runs on in the integration tests: the stand-ins of the core's own tests
//! (`native/core/tests/common`), read from there so that both kinds of test use the same ones.
//! No audio device of the PC is listed or opened, no VR runtime or OCR runs, the key store is
//! in memory, and the translation and recognition providers never leave this PC.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use astarot_core::controller::Services;

/// How long the stand-ins wait for what they watch (`TIMEOUT` of the core's tests).
pub const TIMEOUT: Duration = Duration::from_secs(10);

#[allow(dead_code)]
#[path = "../../core/tests/common/fake_audio.rs"]
mod fake_audio;
#[allow(dead_code)]
#[path = "../../core/tests/common/fake_capture.rs"]
mod fake_capture;
#[allow(dead_code)]
#[path = "../../core/tests/common/fake_osc.rs"]
mod fake_osc;
#[allow(dead_code)]
#[path = "../../core/tests/common/fake_voice.rs"]
mod fake_voice;

/// The one audio output of the stand-ins: the speech goes there, as it would to a speaker.
pub const OUTPUT: &str = "Integration speaker";

/// The built-in translation models a test lists in `translation-models.json` of the settings
/// folder (a JSON list of weight ids) count as on the PC: the bridge has no ONNX Runtime, and a
/// test of the catalog's cards needs models to choose between (#1228). Without the file, none.
fn translation_models(state: &Path) -> Vec<String> {
    std::fs::read_to_string(state.join("translation-models.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn stand_ins(state: &Path) -> Services {
    let present = translation_models(state);
    let audio = fake_audio::FakeAudio::new();
    audio.set_outputs(Some(&[(OUTPUT, OUTPUT)]));
    let voice = fake_voice::FakeVoice::new();
    voice.set_outputs(&[OUTPUT]);
    Services {
        // OSC goes out through the real sender of the adapters crate, without mDNS.
        osc: fake_osc::factory(false).0,
        translation_transport: astarot_translation::http::loopback_only(),
        transcription_transport: astarot_translation::http::loopback_only(),
        translation_endpoints: astarot_translation::providers::Endpoints::all_at("http://provider.invalid"),
        transcription_endpoints: astarot_transcription::providers::Endpoints::all_at("http://provider.invalid"),
        audio: audio.platform(),
        vr: Arc::new(astarot_core::vr_overlay::runtime::fake::FakeVr::default()),
        vr_panel_surface: None,
        steamvr_poll: Duration::from_millis(200),
        transcription_capture: fake_capture::FakeCapture::new().factory(),
        voice: voice.platform(),
        secret_store: astarot_core::config::secrets::MemoryStore::new().system_source(),
        telemetry_forced_off: Arc::new(|| true),
        translation_weight_available: Arc::new(move |weight| present.iter().any(|listed| listed == weight)),
        ..Services::default()
    }
}
