//! An engine whose start-up check fails is handled as Python's `Controller.init` handles it
//! (#285, decided: no kept selections for engines the core cannot run yet). Here every check
//! that asks a service fails: the providers cannot be reached (tests stay on loopback). Google and
//! speech.cpp are not probed, as in Python: real requests show whether they work.

mod common;

use common::{Setup, Ui};
use serde_json::{Value, json};

fn saved() -> Value {
    json!({
        "AUTH_KEYS": {
            "DeepL_API": "deepl-key:fx", "Plamo_API": "plamo-key", "Gemini_API": "gemini-key", "OpenAI_API": "openai-key",
            "OpenAI_Compatible": "compatible-key", "Groq_API": "groq-key", "OpenRouter_API": "openrouter-key",
        },
        "TRANSCRIPTION_AUTH_KEYS": { "Groq_Whisper": "gw", "OpenAI_Whisper": "ow", "Custom_Whisper": "cw", "Deepgram": "dg" },
        "LMSTUDIO_URL": "http://127.0.0.1:1234/v1",
        "TRANSCRIPTION_CUSTOM_URL": "http://127.0.0.1:9000/v1",
        "SELECTED_LMSTUDIO_MODEL": "local-model",
        "SELECTED_OPENAI_COMPATIBLE_MODEL": "compatible-model",
        "SELECTED_OLLAMA_MODEL": "llama",
        "SELECTED_GROQ_WHISPER_MODEL": "whisper-large-v3",
        "SELECTED_OPENAI_WHISPER_MODEL": "whisper-1",
        "SELECTED_CUSTOM_WHISPER_MODEL": "custom-whisper",
        "SELECTED_DEEPGRAM_MODEL": "nova-3",
        "SELECTED_PLAMO_MODEL": "plamo-2.0-prime",
        "SELECTED_GEMINI_MODEL": "gemini-2.5-flash",
        "SELECTED_OPENAI_MODEL": "gpt-4.1-mini",
        "SELECTED_GROQ_MODEL": "llama-3.3-70b",
        "SELECTED_OPENROUTER_MODEL": "openrouter-model",
    })
}

#[test]
fn a_failed_check_clears_the_models_found_on_a_server_and_keeps_every_key() {
    let ui = Ui::with(Setup { saved: Some(saved()), ..Setup::default() });
    let snapshot = ui.ready();
    // The engines that list their models from a server forget the list and the selection.
    for name in ["groq_whisper", "openai_whisper", "custom_whisper", "deepgram", "openai_compatible"] {
        assert!(snapshot.get(format!("/get/data/selected_{name}_model")).is_some(), "{name} is answered");
        assert_eq!(snapshot[format!("/get/data/selected_{name}_model")], Value::Null, "{name}");
        assert_eq!(snapshot[format!("/get/data/selectable_{name}_model_list")], json!([]), "{name}");
    }
    // None of them is offered; Google and speech.cpp are.
    assert_eq!(snapshot["/get/data/selectable_transcription_engines"], json!(["Google", "SpeechCpp"]));

    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    // A failed check cannot tell a refused key from a network that is down: the keys stay.
    assert_eq!(ui.kept_keys("AUTH_KEYS"), saved()["AUTH_KEYS"]);
    assert_eq!(ui.kept_keys("TRANSCRIPTION_AUTH_KEYS"), saved()["TRANSCRIPTION_AUTH_KEYS"]);
    assert_eq!(file["LMSTUDIO_URL"], "http://127.0.0.1:1234/v1");
    assert_eq!(file["TRANSCRIPTION_CUSTOM_URL"], "http://127.0.0.1:9000/v1");
    // The cleared selections are saved as Python saved them.
    for key in [
        "SELECTED_LMSTUDIO_MODEL", "SELECTED_OPENAI_COMPATIBLE_MODEL", "SELECTED_OLLAMA_MODEL", "SELECTED_GROQ_WHISPER_MODEL",
        "SELECTED_OPENAI_WHISPER_MODEL", "SELECTED_CUSTOM_WHISPER_MODEL", "SELECTED_DEEPGRAM_MODEL",
    ] {
        assert_eq!(file[key], Value::Null, "{key}");
    }
    // The other engines keep their selection, as Python did when their check failed.
    assert_eq!(file["SELECTED_PLAMO_MODEL"], "plamo-2.0-prime");
    assert_eq!(file["SELECTED_GEMINI_MODEL"], "gemini-2.5-flash");
    assert_eq!(file["SELECTED_OPENAI_MODEL"], "gpt-4.1-mini");
    assert_eq!(file["SELECTED_GROQ_MODEL"], "llama-3.3-70b");
    assert_eq!(file["SELECTED_OPENROUTER_MODEL"], "openrouter-model");
    ui.stop();
}
