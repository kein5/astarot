//! The recognition engine and the languages (#278): the selected languages follow the engine
//! and Deepgram's model, the list of languages the UI offers follows them too, an engine that
//! cannot be used stays selected, and only an engine of the list can be chosen.
//!
//! The behaviours are those of [`src-python/test/test_controller_transcription_language_fallback.py`],
//! [`test_controller_update_transcription_engine.py`], [`test_model_transcription_language_support.py`]
//! and the choice in [`test_asr_engine_consent.py`]. The engines are `common::fake_asr` on 127.0.0.1;
//! its Deepgram lists the models a test gives it, with their languages.
//!
//! [`src-python/test/test_controller_transcription_language_fallback.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_controller_transcription_language_fallback.py
//! [`test_controller_update_transcription_engine.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_controller_update_transcription_engine.py
//! [`test_model_transcription_language_support.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_model_transcription_language_support.py
//! [`test_asr_engine_consent.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_asr_engine_consent.py

mod common;

use common::fake_asr::{FakeAsr, KEY};
use common::{Setup, Ui, error_code};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use vrct_core::config::Platform;
use vrct_core::controller::Services;

fn start(asr: &FakeAsr, saved: Value) -> Ui {
    let services = Services {
        transcription_endpoints: vrct_transcription::providers::Endpoints::all_at(&asr.base()),
        ..Setup::default().services
    };
    let ui = Ui::with(Setup { saved: Some(saved), services, platform: Platform::Windows, ..Setup::default() });
    ui.ready();
    ui
}

/// Keys the fake accepts, for Groq and Deepgram.
fn keys() -> Value {
    json!({ "Groq_Whisper": KEY, "OpenAI_Whisper": null, "Custom_Whisper": null, "Deepgram": KEY })
}

fn slot(language: &str, enable: bool) -> Value {
    let country = match language {
        "Japanese" => "Japan",
        "English" => "United States",
        "Korean" => "South Korea",
        other => panic!("no country for {other}"),
    };
    json!({ "language": language, "country": country, "enable": enable })
}

/// `SELECTED_YOUR_LANGUAGES` and `SELECTED_TARGET_LANGUAGES` of the three tabs: per tab the own
/// language and the three targets.
fn tabs(rows: [(Value, [Value; 3]); 3]) -> (Value, Value) {
    let (mut your, mut target) = (json!({}), json!({}));
    for (tab, (own, targets)) in rows.into_iter().enumerate() {
        let tab = (tab + 1).to_string();
        your[&tab] = json!({ "1": own });
        let [one, two, three] = targets;
        target[&tab] = json!({ "1": one, "2": two, "3": three });
    }
    (your, target)
}

/// The same own language and targets on every tab.
fn every_tab(own: Value, targets: [Value; 3]) -> (Value, Value) {
    tabs([(own.clone(), targets.clone()), (own.clone(), targets.clone()), (own, targets)])
}

fn saved(engine: &str, deepgram_model: &str, languages: (Value, Value)) -> Value {
    json!({
        "SELECTED_TRANSCRIPTION_ENGINE": engine,
        "TRANSCRIPTION_AUTH_KEYS": keys(),
        "SELECTED_DEEPGRAM_MODEL": deepgram_model,
        "SELECTED_YOUR_LANGUAGES": languages.0,
        "SELECTED_TARGET_LANGUAGES": languages.1,
    })
}

/// The language names of a `selectable_language_list`.
fn names(list: &Value) -> BTreeSet<String> {
    list.as_array().unwrap().iter().map(|e| e["language"].as_str().unwrap().to_string()).collect()
}

fn set(names: &[&str]) -> BTreeSet<String> {
    names.iter().map(|n| n.to_string()).collect()
}

fn language(map: &Value, tab: &str, slot: &str) -> String {
    map[tab][slot]["language"].as_str().unwrap().to_string()
}

#[test]
fn choosing_deepgram_resets_on_every_tab_a_language_its_model_cannot_hear() {
    let asr = FakeAsr::start();
    // nova-3 hears English and Japanese.
    let languages = tabs([
        // An enabled target it cannot hear goes; a disabled one is left alone.
        (slot("Japanese", true), [slot("Korean", true), slot("Korean", false), slot("English", false)]),
        // The own language goes to Japanese first,
        (slot("Korean", true), [slot("English", true), slot("English", false), slot("English", false)]),
        // and to English when Japanese is already a target.
        (slot("Korean", true), [slot("Japanese", true), slot("English", false), slot("English", false)]),
    ]);
    let ui = start(&asr, saved("Groq_Whisper", "nova-3", languages));
    // Groq hears every language of the table.
    assert!(names(&ui.ok("/get/data/selectable_language_list", None)).contains("Korean"));

    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/data/selected_transcription_engine", Some(json!("Deepgram"))), "Deepgram");
    let your = ui.wait_endpoint(mark, "/run/selected_your_languages")["result"].clone();
    let target = ui.wait_endpoint(mark, "/run/selected_target_languages")["result"].clone();
    assert_eq!(your["1"]["1"], slot("Japanese", true));
    assert_eq!(target["1"]["1"], slot("English", true));
    assert_eq!(target["1"]["2"], slot("Korean", false), "a disabled target is not touched");
    assert_eq!(your["2"]["1"], slot("Japanese", true));
    assert_eq!(your["3"]["1"], slot("English", true), "not the language of an enabled target");
    // The list now has only what the model hears.
    let list = ui.wait_endpoint(mark, "/run/selectable_language_list")["result"].clone();
    assert_eq!(names(&list), set(&["English", "Japanese"]));
    assert_eq!(names(&ui.ok("/get/data/selectable_language_list", None)), set(&["English", "Japanese"]));

    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    assert_eq!(file["SELECTED_YOUR_LANGUAGES"], your);
    assert_eq!(file["SELECTED_TARGET_LANGUAGES"], target);
    ui.stop();
}

#[test]
fn a_language_is_kept_when_everything_the_model_hears_is_taken() {
    let asr = FakeAsr::start();
    // Korean cannot be heard, but Japanese and English are both enabled targets.
    let languages = every_tab(slot("Korean", true), [slot("Japanese", true), slot("English", true), slot("English", false)]);
    let ui = start(&asr, saved("Groq_Whisper", "nova-3", languages.clone()));
    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/data/selected_transcription_engine", Some(json!("Deepgram"))), "Deepgram");
    assert!(ui.on(mark, "/run/selected_your_languages").is_empty(), "nothing was reset");
    assert_eq!(ui.ok("/get/data/selected_your_languages", None), languages.0);
    // The list is still told, with the kept language in it so that the UI can show it
    // (decision 74 (c); Python left it out).
    let list = ui.wait_endpoint(mark, "/run/selectable_language_list")["result"].clone();
    assert_eq!(names(&list), set(&["English", "Japanese", "Korean"]));
    // Once another language is chosen, the one the model cannot hear is no longer listed.
    let japanese = every_tab(slot("Japanese", true), [slot("English", true), slot("English", false), slot("English", false)]);
    ui.ok("/set/data/selected_your_languages", Some(japanese.0));
    assert_eq!(names(&ui.ok("/get/data/selectable_language_list", None)), set(&["English", "Japanese"]));
    ui.stop();
}

#[test]
fn an_engine_that_hears_every_language_leaves_the_languages_alone() {
    let asr = FakeAsr::start();
    let languages = every_tab(slot("Korean", true), [slot("English", true), slot("English", false), slot("English", false)]);
    let ui = start(&asr, saved("SpeechCpp", "nova-3", languages.clone()));
    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/data/selected_transcription_engine", Some(json!("Groq_Whisper"))), "Groq_Whisper");
    let list = ui.wait_endpoint(mark, "/run/selectable_language_list")["result"].clone();
    assert!(names(&list).contains("Korean"), "the whole table");
    assert!(ui.on(mark, "/run/selected_your_languages").is_empty());
    assert_eq!(ui.ok("/get/data/selected_your_languages", None), languages.0);

    // The same engine again changes nothing and tells nothing.
    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/data/selected_transcription_engine", Some(json!("Groq_Whisper"))), "Groq_Whisper");
    assert!(ui.on(mark, "/run/selectable_language_list").is_empty());
    ui.stop();
}

#[test]
fn deepgrams_model_sets_the_languages_only_while_deepgram_is_selected() {
    let asr = FakeAsr::start();
    *asr.behaviour.deepgram_models.lock().unwrap() = json!([
        { "name": "nova-3", "batch": true, "languages": ["en", "ja"] },
        { "name": "nova-2", "batch": true, "languages": ["en-US", "en"] },
        { "name": "enhanced", "batch": true, "languages": ["multi"] },
        // Streaming only: not offered.
        { "name": "flux", "batch": false, "languages": ["ja"] },
    ]);
    // No enabled target, so English is free for the own language.
    let languages = every_tab(slot("Japanese", true), [slot("English", false), slot("English", false), slot("English", false)]);
    let ui = start(&asr, saved("Deepgram", "nova-3", languages));
    assert_eq!(ui.ok("/get/data/selectable_deepgram_model_list", None), json!(["enhanced", "nova-2", "nova-3"]));
    assert_eq!(names(&ui.ok("/get/data/selectable_language_list", None)), set(&["English", "Japanese"]));

    // A model without Japanese: the own language moves to English on every tab.
    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/data/selected_deepgram_model", Some(json!("nova-2"))), "nova-2");
    let your = ui.wait_endpoint(mark, "/run/selected_your_languages")["result"].clone();
    for tab in ["1", "2", "3"] {
        assert_eq!(language(&your, tab, "1"), "English", "tab {tab}");
    }
    assert_eq!(names(&ui.wait_endpoint(mark, "/run/selectable_language_list")["result"]), set(&["English"]));

    // A model for every language ("multi"): the whole table, and nothing to reset.
    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/data/selected_deepgram_model", Some(json!("enhanced"))), "enhanced");
    assert!(names(&ui.wait_endpoint(mark, "/run/selectable_language_list")["result"]).contains("Korean"));
    assert!(ui.on(mark, "/run/selected_your_languages").is_empty());

    // A model the service does not offer for recorded speech is refused.
    let answer = ui.request("/set/data/selected_deepgram_model", Some(json!("flux")));
    assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "MODEL_TRANSCRIPTION_INVALID"));
    assert_eq!(answer["result"]["data"], "enhanced");

    // Another engine selected: a new model changes neither the list nor the languages.
    assert_eq!(ui.ok("/set/data/selected_transcription_engine", Some(json!("Groq_Whisper"))), "Groq_Whisper");
    let japanese = every_tab(slot("Japanese", true), [slot("English", false), slot("English", false), slot("English", false)]);
    ui.ok("/set/data/selected_your_languages", Some(japanese.0.clone()));
    let mark = ui.lines().len();
    assert_eq!(ui.ok("/set/data/selected_deepgram_model", Some(json!("nova-2"))), "nova-2");
    assert!(ui.on(mark, "/run/selectable_language_list").is_empty());
    assert!(ui.on(mark, "/run/selected_your_languages").is_empty());
    assert_eq!(ui.ok("/get/data/selected_your_languages", None), japanese.0);

    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["SELECTED_DEEPGRAM_MODEL"], "nova-2");
    ui.stop();
}

#[test]
fn an_engine_that_cannot_be_used_stays_selected() {
    // No key for Deepgram: it is not offered, but the saved choice stays (no other engine is
    // chosen for the user).
    let asr = FakeAsr::start();
    let mut file = saved("Deepgram", "nova-3", every_tab(slot("Japanese", true), [slot("English", true), slot("English", false), slot("English", false)]));
    file["TRANSCRIPTION_AUTH_KEYS"]["Deepgram"] = Value::Null;
    let ui = start(&asr, file);
    assert_eq!(ui.ok("/get/data/selected_transcription_engine", None), "Deepgram");
    let offered = ui.ok("/get/data/selectable_transcription_engines", None);
    assert!(!offered.as_array().unwrap().contains(&json!("Deepgram")), "{offered}");
    // Its model's languages are unknown, so the whole table is listed (decision 74 (b); Python
    // listed none).
    let listed = names(&ui.ok("/get/data/selectable_language_list", None));
    assert!(listed.contains("Korean") && listed.contains("Japanese"), "{listed:?}");
    ui.stop();

    // Its key deleted while it is selected: still selected, and its models are forgotten.
    let ui = start(&asr, saved("Deepgram", "nova-3", every_tab(slot("Japanese", true), [slot("English", true), slot("English", false), slot("English", false)])));
    assert_eq!(ui.ok("/get/data/selected_deepgram_model", None), "nova-3");
    let mark = ui.lines().len();
    assert_eq!(ui.ok("/delete/data/deepgram_auth_key", None), Value::Null);
    assert_eq!(ui.ok("/get/data/selected_transcription_engine", None), "Deepgram");
    assert_eq!(ui.wait_endpoint(mark, "/run/selectable_deepgram_model_list")["result"], json!([]));
    assert_eq!(ui.ok("/get/data/selected_deepgram_model", None), Value::Null);
    assert!(ui.on(mark, "/run/selected_your_languages").is_empty(), "the languages stay");
    // The model's languages are unknown now: the whole table, told again (decision 74 (b)).
    let told = names(&ui.wait_endpoint(mark, "/run/selectable_language_list")["result"]);
    assert!(told.contains("Korean"), "{told:?}");
    assert_eq!(names(&ui.ok("/get/data/selectable_language_list", None)), told);
    let offered = ui.ok("/get/data/selectable_transcription_engines", None);
    assert!(!offered.as_array().unwrap().contains(&json!("Deepgram")), "{offered}");
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["SELECTED_TRANSCRIPTION_ENGINE"], "Deepgram");
    ui.stop();
}

#[test]
fn only_an_engine_of_the_list_can_be_chosen() {
    let asr = FakeAsr::start();
    let ui = start(&asr, saved("Groq_Whisper", "nova-3", every_tab(slot("Japanese", true), [slot("English", true), slot("English", false), slot("English", false)])));
    let mark = ui.lines().len();
    // The retired engines, names that are not engines, and values that are not names.
    for value in [json!("Whisper"), json!("Google"), json!(""), json!("unselected"), json!("deepgram"), json!(1), json!(false), json!({}), Value::Null] {
        let answer = ui.request("/set/data/selected_transcription_engine", Some(value.clone()));
        assert_eq!((answer["status"].clone(), error_code(&answer)), (json!(400), "VALIDATION_CONFIG_VALUE_INVALID"), "{value}");
        assert_eq!(answer["result"]["data"], "Groq_Whisper", "{value}");
    }
    assert!(ui.on(mark, "/run/selectable_language_list").is_empty(), "nothing changed");
    assert_eq!(asr.requested("GET /deepgram/"), 0, "nothing was checked");
    // The list the UI offers has none of them.
    let mut offered: Vec<String> = serde_json::from_value(ui.ok("/get/data/selectable_transcription_engines", None)).unwrap();
    offered.sort();
    assert_eq!(offered, ["Deepgram", "Groq_Whisper", "SpeechCpp"]);
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["SELECTED_TRANSCRIPTION_ENGINE"], "Groq_Whisper");
    ui.stop();
}
