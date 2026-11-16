//! Seed-VC in the direct voice settings (#391). Seed-VC ran on the Python backend and ended with
//! it (decision 10): the core refuses to save it, its default engine is RVC, and a Seed-VC
//! engine saved by an earlier version loads as RVC with the user's other settings kept. A
//! conversion the user had chosen with Seed-VC is reported once in the direct voice state.

mod common;

use common::net::eventually;
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};

fn start(direct: Option<Value>) -> Ui {
    let saved = direct.map(|direct| json!({ "DIRECT_VOICE_SETTINGS": direct }));
    let ui = Ui::with(Setup { saved, ..Setup::default() });
    ui.ready();
    ui
}

fn process_log(ui: &Ui) -> String {
    std::fs::read_to_string(ui.dir.join("logs").join("process.log")).unwrap_or_default()
}

#[test]
fn a_seed_vc_conversion_from_an_earlier_version_moves_to_rvc_and_says_so_once() {
    let ui = start(Some(json!({
        "mode": "converted", "engine": "seed-vc", "runtime": "/seed", "reference": "/voice.wav",
        "rvc_runtime": "/rvc", "rvc_model": "/voice.pth", "rvc_pitch": 3,
    })));
    let state = ui.ok("/get/data/direct_voice_state", None);
    let settings = &state["settings"];
    assert_eq!((settings["mode"].clone(), settings["engine"].clone()), (json!("converted"), json!("rvc")));
    // The rest is kept, Seed-VC's fields too: 0.4 can still read the file.
    assert_eq!((settings["rvc_model"].clone(), settings["rvc_pitch"].clone()), (json!("/voice.pth"), json!(3)));
    assert_eq!((settings["runtime"].clone(), settings["reference"].clone()), (json!("/seed"), json!("/voice.wav")));
    assert_eq!(state["notice"], "seed_vc_moved_to_rvc");
    eventually("the move is saved", || ui.saved()["DIRECT_VOICE_SETTINGS"]["engine"] == "rvc");
    assert!(process_log(&ui).contains("[voice] a saved Seed-VC conversion moved to RVC"));

    // Saving the settings again is the user's answer: the notice goes.
    let saved = ui.ok("/set/data/direct_voice_settings", Some(settings.clone()));
    assert!(saved.get("notice").is_none(), "{saved}");
    assert!(ui.ok("/get/data/direct_voice_state", None).get("notice").is_none());
    ui.stop();
}

#[test]
fn seed_vc_cannot_be_saved_and_the_saved_settings_come_back() {
    let ui = start(None);
    let before = ui.ok("/get/data/direct_voice_state", None)["settings"].clone();
    assert_eq!(before["engine"], "rvc", "RVC is the default engine");
    let answer = ui.request("/set/data/direct_voice_settings", Some(json!({ "mode": "converted", "engine": "seed-vc", "runtime": "/seed", "reference": "/voice.wav" })));
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "vc_engine_unavailable"));
    assert_eq!(answer["result"]["settings"], before, "the saved settings to roll back to");
    assert_eq!(ui.ok("/get/data/direct_voice_state", None)["settings"], before);
    // Any other unknown engine stays a malformed request.
    let answer = ui.request("/set/data/direct_voice_settings", Some(json!({ "engine": "other" })));
    assert_eq!(error_code(&answer), "vc_settings_invalid");
    ui.stop();
}

#[test]
fn python_s_default_seed_vc_moves_to_rvc_without_a_notice() {
    // Seed-VC was only Python's default while nothing was converted.
    let ui = start(Some(json!({ "mode": "passthrough", "engine": "seed-vc" })));
    let state = ui.ok("/get/data/direct_voice_state", None);
    assert_eq!((state["settings"]["mode"].clone(), state["settings"]["engine"].clone()), (json!("passthrough"), json!("rvc")));
    assert!(state.get("notice").is_none(), "{state}");
    ui.stop();
}
