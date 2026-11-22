//! The translation engines through the IPC surface (#277): keys checked with the provider,
//! model choices, LM Studio and Ollama, the OpenAI-compatible endpoint, the start-up check, the
//! local model's weight and licence, and turning translation on. The behaviours are those of
//! [`controller.py`] (`_setTranslationEngineAuthKey`, `_setTranslationEngineModel`,
//! `_checkTranslationEngineConnection`, `setDeeplAuthKey`, `_setEndpointCredential`,
//! `setTranslatorLMStudioURL`, `setCtranslate2WeightType`, `setEnableTranslation`, `init`).
//!
//! Every provider is a stand-in on a loopback port (`astarot_translation::fake`); nothing leaves
//! this PC. The local model is a stand-in too.
//!
//! [`controller.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/controller.py

mod common;

use common::{error_code, Setup, Ui};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use astarot_core::controller::translation::{LocalError, LocalSetup, LocalTranslation};
use astarot_core::controller::Services;
use astarot_translation::fake::FakeProviders;
use astarot_translation::http;
use astarot_translation::providers::Endpoints;

/// A local model that loads as told and translates to `local:<target>:<text>`.
#[derive(Default)]
pub struct FakeLocal {
    pub fails_with: Mutex<Option<LocalError>>,
    pub loaded: Mutex<Option<LocalSetup>>,
    pub loads: Mutex<usize>,
    /// A target language whose translation panics (a bug in an engine).
    pub panics_for: Mutex<Option<String>>,
    /// What every translation answers instead of `local:<target>:<text>`.
    pub answer: Mutex<Option<Result<String, LocalError>>>,
    /// How long each translation takes.
    pub delay: Mutex<Option<std::time::Duration>>,
    pub translations: Mutex<usize>,
}

impl LocalTranslation for FakeLocal {
    fn load(&self, setup: &LocalSetup) -> Result<(), LocalError> {
        *self.loads.lock().unwrap() += 1;
        *self.loaded.lock().unwrap() = None;
        if let Some(error) = self.fails_with.lock().unwrap().clone() {
            return Err(error);
        }
        *self.loaded.lock().unwrap() = Some(setup.clone());
        Ok(())
    }

    fn loaded(&self) -> Option<LocalSetup> {
        self.loaded.lock().unwrap().clone()
    }

    fn translate(&self, text: &str, _source: &str, target: &str) -> Result<String, LocalError> {
        if self.panics_for.lock().unwrap().as_deref() == Some(target) {
            panic!("a bug in the translation engine");
        }
        *self.translations.lock().unwrap() += 1;
        let delay = *self.delay.lock().unwrap();
        if let Some(delay) = delay {
            std::thread::sleep(delay);
        }
        if let Some(answer) = self.answer.lock().unwrap().clone() {
            return answer;
        }
        Ok(format!("local:{target}:{text}"))
    }
}

fn services(fake: &FakeProviders, local: Arc<FakeLocal>) -> Services {
    Services {
        osc: common::fake_osc::factory(false).0,
        translation_transport: http::loopback_only(),
        translation_endpoints: Endpoints::all_at(&fake.url()),
        local_translation: Arc::new(move |_| local.clone() as Arc<dyn LocalTranslation>),
        secret_store: common::shared_vault().system_source(),
        ..Services::default()
    }
}

fn start(fake: &FakeProviders, saved: Value) -> (Ui, Arc<FakeLocal>) {
    let local = Arc::new(FakeLocal::default());
    let ui = Ui::with(Setup { saved: Some(saved), services: services(fake, Arc::clone(&local)), ..Setup::default() });
    ui.ready();
    (ui, local)
}

fn refused(ui: &Ui, endpoint: &str, data: Value) -> (String, Value) {
    let answer = ui.request(endpoint, Some(data));
    assert_eq!(answer["status"], 400, "{endpoint}: {answer}");
    (error_code(&answer).to_string(), answer["result"]["data"].clone())
}

fn process_log(ui: &Ui) -> String {
    std::fs::read_to_string(ui.dir.join("logs").join("process.log")).unwrap_or_default()
}

fn openai_key() -> String {
    format!("sk-{}", "k".repeat(170))
}

#[test]
fn a_deepl_key_is_saved_only_when_deepl_accepts_it() {
    let fake = FakeProviders::start();
    let good = format!("{}:fx", "d".repeat(36));
    fake.key("/deepl-free", &good);
    let (ui, _) = start(&fake, json!({}));

    assert_eq!(refused(&ui, "/set/data/deepl_auth_key", json!("short")), ("AUTH_DEEPL_LENGTH".into(), Value::Null));
    let mark = ui.send("/set/data/deepl_auth_key", Some(json!(good)));
    let answer = ui.wait_endpoint(mark, "/set/data/deepl_auth_key");
    assert_eq!(answer["status"], 200, "{answer}");
    let engines = ui.wait_endpoint(mark, "/run/translation_engines");
    assert!(engines["result"].as_array().unwrap().contains(&json!("DeepL_API")), "{engines}");
    // The key went to the free API's translate endpoint in a header.
    let check = fake.seen_under("/deepl-free").pop().unwrap();
    assert_eq!(check.header("authorization"), Some(format!("DeepL-Auth-Key {good}").as_str()));

    // A key DeepL refuses keeps the saved one.
    let refused_key = format!("{}:fx", "x".repeat(36));
    assert_eq!(refused(&ui, "/set/data/deepl_auth_key", json!(refused_key)), ("AUTH_DEEPL_FAILED".into(), json!(good)));

    ui.ok("/run/shutdown", None);
    assert_eq!(ui.kept_key("AUTH_KEYS", "DeepL_API"), json!(good));
    let log = process_log(&ui);
    assert!(!log.contains(&good) && !log.contains(&refused_key), "a key reached the log");
    ui.stop();
}

#[test]
fn a_provider_key_brings_its_models_and_a_model_must_be_one_it_lists() {
    let fake = FakeProviders::start();
    let key = openai_key();
    fake.key("/openai/v1", &key).models("/openai/v1", &["gpt-4o-mini", "gpt-4o", "whisper-1"]);
    let (ui, _) = start(&fake, json!({ "SELECTED_OPENAI_MODEL": "gpt-4o-mini" }));

    // The format is checked before anything is sent.
    assert_eq!(refused(&ui, "/set/data/openai_auth_key", json!("sk-short")).0, "AUTH_OPENAI_INVALID");
    assert!(fake.seen_under("/openai").is_empty());

    let mark = ui.send("/set/data/openai_auth_key", Some(json!(key)));
    assert_eq!(ui.wait_endpoint(mark, "/set/data/openai_auth_key")["status"], 200);
    assert_eq!(ui.wait_endpoint(mark, "/run/selectable_openai_model_list")["result"], json!(["gpt-4o", "gpt-4o-mini"]));
    assert_eq!(
        ui.wait_endpoint(mark, "/run/selected_openai_model")["result"],
        "gpt-4o-mini",
        "the saved choice is kept"
    );

    assert_eq!(ui.ok("/set/data/selected_openai_model", Some(json!("gpt-4o"))), "gpt-4o");
    assert_eq!(
        refused(&ui, "/set/data/selected_openai_model", json!("whisper-1")),
        ("MODEL_OPENAI_INVALID".into(), json!("gpt-4o"))
    );

    // A key the provider refuses changes nothing.
    let other = format!("sk-{}", "z".repeat(170));
    assert_eq!(refused(&ui, "/set/data/openai_auth_key", json!(other)), ("AUTH_OPENAI_FAILED".into(), json!(key)));
    // A provider without a live client cannot choose a model.
    assert_eq!(
        refused(&ui, "/set/data/selected_groq_model", json!("llama")),
        ("MODEL_GROQ_INVALID".into(), Value::Null)
    );

    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    assert_eq!(ui.kept_key("AUTH_KEYS", "OpenAI_API"), json!(key));
    assert_eq!(file["SELECTED_OPENAI_MODEL"], "gpt-4o");
    assert!(!process_log(&ui).contains(&key));
    ui.stop();
}

#[test]
fn lm_studio_and_ollama_are_connected_and_lost_with_their_models() {
    let fake = FakeProviders::start();
    fake.models("/lmstudio/v1", &["qwen", "llama"]).models("/ollama", &["gemma3"]);
    let (ui, _) = start(&fake, json!({}));
    assert_eq!(ui.ok("/get/data/connected_lmstudio", None), false);

    let url = fake.url_of("/lmstudio/v1");
    let mark = ui.send("/set/data/lmstudio_url", Some(json!(url)));
    let answer = ui.wait_endpoint(mark, "/set/data/lmstudio_url");
    assert_eq!(answer["result"], json!(url));
    assert_eq!(ui.wait_endpoint(mark, "/run/selectable_lmstudio_model_list")["result"], json!(["llama", "qwen"]));
    assert_eq!(ui.wait_endpoint(mark, "/run/selected_lmstudio_model")["result"], "llama");
    assert_eq!(ui.ok("/get/data/connected_lmstudio", None), true);
    assert_eq!(ui.ok("/get/data/selectable_lmstudio_model_list", None), json!(["llama", "qwen"]));
    assert_eq!(ui.ok("/set/data/selected_lmstudio_model", Some(json!("qwen"))), "qwen");

    // The server goes away: the check fails and the models are forgotten.
    fake.down("/lmstudio/v1", true);
    let mark = ui.send("/run/lmstudio_connection", None);
    let answer = ui.wait_endpoint(mark, "/run/lmstudio_connection");
    assert_eq!((error_code(&answer), &answer["result"]["data"]), ("CONNECTION_LMSTUDIO_FAILED", &json!(false)));
    assert_eq!(ui.wait_endpoint(mark, "/run/selectable_lmstudio_model_list")["result"], json!([]));
    assert_eq!(ui.wait_endpoint(mark, "/run/selected_lmstudio_model")["result"], Value::Null);
    assert_eq!(ui.ok("/get/data/connected_lmstudio", None), false);
    // A public address over plain HTTP is refused before anything is sent.
    assert_eq!(
        refused(&ui, "/set/data/lmstudio_url", json!("http://example.com/v1")).0,
        "CONNECTION_LMSTUDIO_URL_INVALID"
    );

    // Ollama: the address Python always used, until the user chooses another (core only).
    assert_eq!(ui.ok("/get/data/ollama_url", None), "http://localhost:11434");
    for public in ["http://example.com:11434", "http://100.64.0.1:11434", "ftp://192.168.1.2/"] {
        assert_eq!(
            refused(&ui, "/set/data/ollama_url", json!(public)),
            ("CONNECTION_OLLAMA_URL_INVALID".into(), json!("http://localhost:11434")),
            "{public}"
        );
    }
    let url = fake.url_of("/ollama");
    let mark = ui.send("/set/data/ollama_url", Some(json!(format!(" {url} "))));
    assert_eq!(ui.wait_endpoint(mark, "/set/data/ollama_url")["result"], json!(url));
    assert_eq!(ui.wait_endpoint(mark, "/run/selected_ollama_model")["result"], "gemma3");
    let mark = ui.send("/run/ollama_connection", None);
    assert_eq!(ui.wait_endpoint(mark, "/run/ollama_connection")["result"], true);
    assert_eq!(ui.ok("/get/data/connected_ollama", None), true);
    // A server without a model counts as failed.
    fake.models("/ollama", &[]);
    assert_eq!(refused(&ui, "/run/ollama_connection", Value::Null), ("CONNECTION_OLLAMA_FAILED".into(), json!(false)));
    // An address where nothing answers is not saved.
    let closed = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    assert_eq!(
        refused(&ui, "/set/data/ollama_url", json!(format!("http://127.0.0.1:{closed}"))),
        ("CONNECTION_OLLAMA_URL_INVALID".into(), json!(url))
    );
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["OLLAMA_URL"], json!(url));
    ui.stop();
}

#[test]
fn a_saved_ollama_url_is_checked_at_start_up_and_a_public_one_is_dropped() {
    let fake = FakeProviders::start();
    fake.models("/ollama", &["qwen"]);
    let (ui, _) = start(&fake, json!({ "OLLAMA_URL": fake.url_of("/ollama"), "SELECTED_OLLAMA_MODEL": "qwen" }));
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/connected_ollama"], true);
    assert_eq!(snapshot["/get/data/selected_ollama_model"], "qwen");
    ui.stop();

    // Plain HTTP to a public host is not kept from a hand-edited file, and the UI is told.
    let (ui, _) = start(&fake, json!({ "OLLAMA_URL": "http://ollama.example.com:11434" }));
    assert_eq!(ui.ready()["/get/data/ollama_url"], "");
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["OLLAMA_URL"], "");
    ui.stop();
}

#[test]
fn a_google_cloud_key_is_saved_only_when_google_accepts_it() {
    let fake = FakeProviders::start();
    let key = format!("AIza{}", "g".repeat(35));
    fake.key("/google-cloud", &key);
    let (ui, _) = start(&fake, json!({}));

    for bad in ["", "  ", "two words"] {
        assert_eq!(refused(&ui, "/set/data/google_cloud_auth_key", json!(bad)), ("AUTH_GOOGLE_CLOUD_INVALID".into(), Value::Null));
    }
    assert!(fake.seen_under("/google-cloud").is_empty(), "nothing is sent for a malformed key");
    let mark = ui.send("/set/data/google_cloud_auth_key", Some(json!(format!(" {key} "))));
    assert_eq!(ui.wait_endpoint(mark, "/set/data/google_cloud_auth_key")["result"], json!(key));
    let engines = ui.wait_endpoint(mark, "/run/translation_engines");
    assert!(engines["result"].as_array().unwrap().contains(&json!("Google_Cloud_API")), "{engines}");
    let check = fake.seen_under("/google-cloud").pop().unwrap();
    assert_eq!(check.header("x-goog-api-key"), Some(key.as_str()));
    assert!(!check.path.contains(&key), "the key is not in the URL");

    let other = format!("AIza{}", "x".repeat(35));
    assert_eq!(refused(&ui, "/set/data/google_cloud_auth_key", json!(other)), ("AUTH_GOOGLE_CLOUD_FAILED".into(), json!(key)));
    assert_eq!(ui.ok("/get/data/google_cloud_auth_key", None), json!(key));

    ui.ok("/run/shutdown", None);
    assert_eq!(ui.kept_key("AUTH_KEYS", "Google_Cloud_API"), json!(key));
    let log = process_log(&ui);
    assert!(!log.contains(&key) && !log.contains(&other), "a key reached the log");
    ui.stop();

    // At the next start the saved key keeps the engine selectable (no tab uses it, so it is not
    // contacted, #457); deleting it takes the engine away.
    let (ui, _) = start(&fake, json!({ "AUTH_KEYS": { "Google_Cloud_API": key } }));
    let snapshot = ui.ready();
    assert!(snapshot["/get/data/selectable_translation_engines"].as_array().unwrap().contains(&json!("Google_Cloud_API")));
    assert_eq!(ui.ok("/delete/data/google_cloud_auth_key", None), Value::Null);
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.kept_key("AUTH_KEYS", "Google_Cloud_API"), Value::Null);
    ui.stop();
}

#[test]
fn papago_needs_the_client_id_before_the_secret_and_checks_them_together() {
    let fake = FakeProviders::start();
    fake.key("/papago", "client-1:secret-1");
    let (ui, _) = start(&fake, json!({}));

    // No Client ID yet: the secret cannot be checked.
    assert_eq!(refused(&ui, "/set/data/papago_auth_key", json!("secret-1")), ("AUTH_PAPAGO_INVALID".into(), Value::Null));
    assert_eq!(refused(&ui, "/set/data/papago_client_id", json!(" ")), ("AUTH_PAPAGO_INVALID".into(), json!("")));
    assert_eq!(ui.ok("/set/data/papago_client_id", Some(json!(" client-1 "))), "client-1");
    assert_eq!(refused(&ui, "/set/data/papago_auth_key", json!("wrong")), ("AUTH_PAPAGO_FAILED".into(), Value::Null));

    let mark = ui.send("/set/data/papago_auth_key", Some(json!("secret-1")));
    assert_eq!(ui.wait_endpoint(mark, "/set/data/papago_auth_key")["result"], "secret-1");
    let engines = ui.wait_endpoint(mark, "/run/translation_engines");
    assert!(engines["result"].as_array().unwrap().contains(&json!("Papago_API")), "{engines}");
    // The check translates nothing.
    assert_eq!(fake.seen_under("/papago").pop().unwrap().body["text"], "");

    // A new Client ID needs the secret again.
    assert_eq!(
        refused(&ui, "/set/data/papago_client_id", json!("client-2")),
        ("CREDENTIAL_REENTRY_REQUIRED".into(), json!("client-1"))
    );
    assert_eq!(ui.ok("/delete/data/papago_auth_key", None), Value::Null);
    assert_eq!(ui.ok("/set/data/papago_client_id", Some(json!("client-2"))), "client-2");

    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    // The Client ID is half of the Papago credentials: kept in the key store, not in config.json.
    assert!(file.get("PAPAGO_CLIENT_ID").is_none());
    let store = ui.backend.core().config().secret_store();
    assert_eq!(store.read("PAPAGO_CLIENT_ID").expect("the store answers").as_deref(), Some("client-2"));
    assert_eq!(ui.kept_key("AUTH_KEYS", "Papago_API"), Value::Null);
    let log = process_log(&ui);
    assert!(!log.contains("secret-1") && !log.contains("client-1"), "a credential reached the log");
    ui.stop();
}

#[test]
fn the_compatible_endpoint_checks_its_url_and_key_together() {
    let fake = FakeProviders::start();
    fake.key("/compatible/v1", "c-key").models("/compatible/v1", &["mistral", "bge-rerank"]);
    let (ui, _) = start(&fake, json!({}));
    let url = fake.url_of("/compatible/v1");

    let shape = refused(&ui, "/set/data/openai_compatible_auth_key_and_url", json!({ "url": url }));
    assert_eq!(shape.0, "AUTH_OPENAI_COMPATIBLE_FAILED");
    let bad_url = refused(
        &ui,
        "/set/data/openai_compatible_auth_key_and_url",
        json!({ "url": "http://example.com/v1", "auth_key": "c-key" }),
    );
    assert_eq!(bad_url, ("CONNECTION_OPENAI_COMPATIBLE_URL_INVALID".into(), json!("https://api.openai.com/v1")));
    let wrong =
        refused(&ui, "/set/data/openai_compatible_auth_key_and_url", json!({ "url": url, "auth_key": "wrong" }));
    assert_eq!(wrong, ("AUTH_OPENAI_COMPATIBLE_FAILED".into(), Value::Null));

    let mark = ui.send(
        "/set/data/openai_compatible_auth_key_and_url",
        Some(json!({ "url": format!(" {url} "), "auth_key": " c-key " })),
    );
    let answer = ui.wait_endpoint(mark, "/set/data/openai_compatible_auth_key_and_url");
    assert_eq!(answer["result"], json!({ "url": url, "auth_key": "c-key" }));
    assert_eq!(ui.wait_endpoint(mark, "/run/selectable_openai_compatible_model_list")["result"], json!(["mistral"]));
    assert_eq!(ui.ok("/set/data/selected_openai_compatible_model", Some(json!("mistral"))), "mistral");

    // A key alone goes to the saved URL; an empty one is refused before sending.
    assert_eq!(refused(&ui, "/set/data/openai_compatible_auth_key", json!("  ")).0, "AUTH_OPENAI_COMPATIBLE_INVALID");
    assert_eq!(ui.ok("/set/data/openai_compatible_auth_key", Some(json!("c-key"))), "c-key");

    // No key: the URL is saved and the key, its models and the engine go.
    let mark = ui.send("/set/data/openai_compatible_auth_key_and_url", Some(json!({ "url": url, "auth_key": null })));
    assert_eq!(
        ui.wait_endpoint(mark, "/set/data/openai_compatible_auth_key_and_url")["result"],
        json!({ "url": url, "auth_key": null })
    );
    assert_eq!(ui.wait_endpoint(mark, "/run/selectable_openai_compatible_model_list")["result"], json!([]));
    ui.ok("/run/shutdown", None);
    let file = ui.saved();
    assert_eq!(file["OPENAI_COMPATIBLE_URL"], json!(url));
    assert_eq!(ui.kept_key("AUTH_KEYS", "OpenAI_Compatible"), Value::Null);
    ui.stop();
}

#[test]
fn start_up_checks_each_saved_key_a_tab_uses_and_keeps_the_ones_it_cannot_confirm() {
    let fake = FakeProviders::start();
    let gemini = "g".repeat(39);
    fake.key("/gemini", &gemini).models("/gemini", &["gemini-2.5-flash", "gemini-2.5-pro"]);
    fake.models("/lmstudio/v1", &["local-model"]);
    let groq = format!("gsk{}", "q".repeat(40));
    let saved = json!({
        "AUTH_KEYS": { "Gemini_API": gemini, "Groq_API": groq },
        "SELECTED_TRANSLATION_ENGINES": { "1": "CTranslate2", "2": "Gemini_API", "3": "Groq_API" },
        "SELECTED_GEMINI_MODEL": "gemini-2.5-pro",
        "SELECTED_GROQ_MODEL": "llama-3.3-70b",
        "LMSTUDIO_URL": fake.url_of("/lmstudio/v1"),
    });
    let (ui, _) = start(&fake, saved);
    let snapshot = ui.ready();
    assert_eq!(snapshot["/get/data/selectable_gemini_model_list"], json!(["gemini-2.5-flash", "gemini-2.5-pro"]));
    assert_eq!(snapshot["/get/data/selected_gemini_model"], "gemini-2.5-pro");
    assert_eq!(snapshot["/get/data/connected_lmstudio"], true);
    assert_eq!(snapshot["/get/data/selected_lmstudio_model"], "local-model");
    // Groq refused the key (the stand-in knows no key): it stays, and so does its model.
    assert_eq!(snapshot["/get/data/selected_groq_model"], "llama-3.3-70b");
    let offered = snapshot["/get/data/selectable_translation_engines"].as_array().unwrap().clone();
    assert!(offered.contains(&json!("Gemini_API")) && offered.contains(&json!("LMStudio")), "{offered:?}");
    assert!(!offered.contains(&json!("Groq_API")) && !offered.contains(&json!("Google")), "{offered:?}");
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.kept_key("AUTH_KEYS", "Groq_API"), json!(groq));
    assert!(!process_log(&ui).contains(&gemini));
    ui.stop();
}

#[test]
fn start_up_contacts_no_engine_that_no_tab_uses_and_checks_one_when_it_is_selected() {
    // #457: a saved key alone does not send anything at start-up.
    let fake = FakeProviders::start();
    let gemini = "g".repeat(39);
    fake.key("/gemini", &gemini).models("/gemini", &["gemini-2.5-flash", "gemini-2.5-pro"]);
    let groq = format!("gsk{}", "q".repeat(40));
    let saved = json!({
        "AUTH_KEYS": { "Gemini_API": gemini, "Groq_API": groq },
        "SELECTED_GEMINI_MODEL": "gemini-2.5-pro",
    });
    let (ui, _) = start(&fake, saved);
    let snapshot = ui.ready();
    assert!(fake.seen_under("/gemini").is_empty() && fake.seen_under("/groq").is_empty(), "an unused engine was contacted");
    let offered = snapshot["/get/data/selectable_translation_engines"].as_array().unwrap().clone();
    assert!(offered.contains(&json!("Gemini_API")) && offered.contains(&json!("Groq_API")), "{offered:?}");
    assert_eq!(snapshot["/get/data/selectable_gemini_model_list"], json!([]));

    // Selected: checked now, with its models.
    let mut engines = ui.ok("/get/data/selected_translation_engines", None);
    engines["1"] = json!("Gemini_API");
    let mark = ui.send("/set/data/selected_translation_engines", Some(engines.clone()));
    assert_eq!(ui.wait_endpoint(mark, "/set/data/selected_translation_engines")["result"]["1"], "Gemini_API");
    assert_eq!(ui.wait_endpoint(mark, "/run/selectable_gemini_model_list")["result"], json!(["gemini-2.5-flash", "gemini-2.5-pro"]));
    assert_eq!(ui.ok("/get/data/selected_gemini_model", None), "gemini-2.5-pro");
    assert!(!fake.seen_under("/gemini").is_empty());

    // A key the service refuses: the engine is no longer offered, and the tab falls back.
    engines["1"] = json!("Groq_API");
    assert_eq!(ui.ok("/set/data/selected_translation_engines", Some(engines))["1"], "CTranslate2");
    let offered = ui.ok("/get/data/selectable_translation_engines", None);
    assert!(!offered.as_array().unwrap().contains(&json!("Groq_API")), "{offered}");
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.kept_key("AUTH_KEYS", "Groq_API"), json!(groq), "the key is kept");
    ui.stop();
}

#[test]
fn the_web_translators_no_build_can_run_are_not_engines() {    // Upstream VRCT's Google, Bing and Papago module is licensed for the official VRCT only.
    let fake = FakeProviders::start();
    let (ui, _) = start(&fake, json!({ "SELECTED_TRANSLATION_ENGINES": { "1": "Google", "2": "Papago", "3": "CTranslate2" } }));
    let snapshot = ui.ready();
    // A tab saved with one of them reads as the default engine.
    assert_eq!(snapshot["/get/data/selected_translation_engines"], json!({ "1": "CTranslate2", "2": "CTranslate2", "3": "CTranslate2" }));
    let offered = snapshot["/get/data/selectable_translation_engines"].as_array().unwrap().clone();
    for web in ["Google", "Bing", "Papago"] {
        assert!(!offered.contains(&json!(web)), "{offered:?}");
    }
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["SELECTED_TRANSLATION_ENGINES"]["1"], "CTranslate2");
    ui.stop();
}

#[test]
fn a_non_commercial_weight_needs_the_users_confirmation() {
    let fake = FakeProviders::start();
    let (ui, _) = start(&fake, json!({}));
    let nllb = "nllb-200-distilled-600M-ct2-int8";
    assert_eq!(
        refused(&ui, "/set/data/selected_ctranslate2_weight_type", json!(nllb)),
        (
            "WEIGHT_CTRANSLATE2_LICENSE_CONSENT_REQUIRED".into(),
            json!({ "weight_type": nllb, "selected": "m2m100_418M-ct2-int8" })
        )
    );
    let accepted = json!({ "weight_type": nllb, "accept_non_commercial_license": true });
    assert_eq!(ui.ok("/set/data/selected_ctranslate2_weight_type", Some(accepted)), nllb);
    // Keeping the selected one needs no confirmation.
    assert_eq!(ui.ok("/set/data/selected_ctranslate2_weight_type", Some(json!(nllb))), nllb);
    assert_eq!(
        ui.ok("/set/data/selected_ctranslate2_weight_type", Some(json!("m2m100_1.2B-ct2-int8"))),
        "m2m100_1.2B-ct2-int8"
    );
    assert_eq!(ui.request("/set/data/selected_ctranslate2_weight_type", Some(json!("unknown")))["status"], 500);
    ui.ok("/run/shutdown", None);
    assert_eq!(ui.saved()["CTRANSLATE2_LICENSE_NOTICE_SHOWN"], true);
    ui.stop();
}

#[test]
fn turning_translation_on_loads_the_local_model_or_says_why_it_cannot() {
    let fake = FakeProviders::start();
    let (ui, local) = start(&fake, json!({}));

    *local.fails_with.lock().unwrap() = Some(LocalError::Missing);
    assert_eq!(
        refused(&ui, "/set/enable/translation", Value::Null),
        ("TRANSLATION_MODEL_MISSING".into(), json!(false))
    );
    *local.fails_with.lock().unwrap() = Some(LocalError::LoadFailed);
    assert_eq!(
        refused(&ui, "/set/enable/translation", Value::Null),
        ("TRANSLATION_MODEL_LOAD_FAILED".into(), json!(false))
    );

    *local.fails_with.lock().unwrap() = Some(LocalError::OutOfMemory("CUDA out of memory".into()));
    let mark = ui.send("/set/enable/translation", None);
    assert_eq!(ui.wait_endpoint(mark, "/set/enable/translation")["result"], false);
    let vram = ui.wait_endpoint(mark, "/run/error_translation_enable_vram_overflow");
    assert_eq!((vram["status"].as_u64(), error_code(&vram)), (Some(400), "TRANSLATION_VRAM_ENABLE"));
    assert_eq!(error_code(&ui.wait_endpoint(mark, "/run/enable_translation")), "TRANSLATION_DISABLED_VRAM");

    *local.fails_with.lock().unwrap() = None;
    assert_eq!(ui.ok("/set/enable/translation", None), true);
    let loads = *local.loads.lock().unwrap();
    assert_eq!(local.loaded().unwrap().weight, "m2m100_418M-ct2-int8");
    // Off and on again with the same settings: no new load.
    assert_eq!(ui.ok("/set/disable/translation", None), false);
    assert_eq!(ui.ok("/set/enable/translation", None), true);
    assert_eq!(*local.loads.lock().unwrap(), loads);
    ui.stop();
}

#[test]
fn a_translation_thread_that_ends_abnormally_fails_that_message_and_keeps_translation_on() {
    // #394: with several targets, a thread that panicked was taken for the GPU running out of
    // memory, and translation was turned off.
    let fake = FakeProviders::start();
    let (ui, local) = start(&fake, json!({}));
    assert_eq!(ui.ok("/set/enable/translation", None), true);
    let mut target = ui.ok("/get/data/selected_target_languages", None);
    target["1"]["2"] = json!({ "language": "Korean", "country": "South Korea", "enable": true });
    ui.ok("/set/data/selected_target_languages", Some(target));
    let first = ui.ok("/run/send_message_box", Some(json!({ "id": "m1", "message": "hello" })));
    let codes: Vec<String> = first["translations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["message"].as_str().unwrap().split(':').nth(1).unwrap_or("").to_string())
        .collect();
    assert_eq!(codes.len(), 2, "{first}");

    // The second destination's engine panics.
    *local.panics_for.lock().unwrap() = Some(codes[1].clone());
    let mark = ui.lines().len();
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m2", "message": "hello" })));
    assert_eq!(answer["translations"][0]["message"], format!("local:{}:hello", codes[0]));
    assert_eq!(answer["translations"][1]["message"], "hello", "that destination gets the original text");
    // Reported as a failed translation of this message, not as the GPU's memory.
    assert_eq!(error_code(&ui.wait_endpoint(mark, "/run/error_translation_engine")), "TRANSLATION_ENGINE_LIMIT");
    assert!(ui.on(mark, "/run/error_translation_chat_vram_overflow").is_empty());
    assert!(ui.on(mark, "/run/enable_translation").is_empty());

    // Translation stayed on: the next message translates again.
    *local.panics_for.lock().unwrap() = None;
    let again = ui.ok("/run/send_message_box", Some(json!({ "id": "m3", "message": "hello" })));
    assert_eq!(again["translations"][1]["message"], format!("local:{}:hello", codes[1]));
    ui.stop();
}

#[test]
fn a_connected_provider_turns_translation_on_without_the_local_model() {
    let fake = FakeProviders::start();
    let key = format!("{}:fx", "d".repeat(36));
    fake.key("/deepl-free", &key);
    let (ui, local) = start(&fake, json!({ "AUTH_KEYS": { "DeepL_API": key } }));
    *local.fails_with.lock().unwrap() = Some(LocalError::Missing);
    let mut engines = ui.ok("/get/data/selected_translation_engines", None);
    engines["1"] = json!("DeepL_API");
    assert_eq!(ui.ok("/set/data/selected_translation_engines", Some(engines))["1"], "DeepL_API");
    assert_eq!(ui.ok("/set/enable/translation", None), true);
    assert_eq!(*local.loads.lock().unwrap(), 0);
    ui.stop();
}

/// DeepL selected and translation on, with the local model loaded behind it.
fn deepl_with_local_behind(fake: &FakeProviders) -> (Ui, Arc<FakeLocal>) {
    let key = format!("{}:fx", "d".repeat(36));
    fake.key("/deepl-free", &key);
    let (ui, local) = start(fake, json!({ "AUTH_KEYS": { "DeepL_API": key } }));
    // The local model loads with translation on its own engine.
    assert_eq!(ui.ok("/set/enable/translation", None), true);
    let setup = local.loaded().expect("the local model is loaded");
    let mut engines = ui.ok("/get/data/selected_translation_engines", None);
    engines["1"] = json!("DeepL_API");
    assert_eq!(ui.ok("/set/data/selected_translation_engines", Some(engines))["1"], "DeepL_API");
    *local.loaded.lock().unwrap() = Some(setup);
    (ui, local)
}

#[test]
fn the_fallback_waits_for_a_loaded_model_only() {
    // [`test_model_translate_fallback_no_wait.py`].
    //
    // [`test_model_translate_fallback_no_wait.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_model_translate_fallback_no_wait.py
    let fake = FakeProviders::start();
    let (ui, local) = deepl_with_local_behind(&fake);
    // A refusal DeepL does not try again, so that only the local model's waits are timed (a
    // retried failure would add the DeepL SDK's one-second backoff).
    fake.fail("/deepl-free", 400);
    *local.answer.lock().unwrap() = Some(Err(LocalError::Failed));

    // A loaded model that fails is tried 20 times, 100 ms apart.
    let started = std::time::Instant::now();
    let mark = ui.lines().len();
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m1", "message": "hello" })));
    assert!(started.elapsed() >= std::time::Duration::from_millis(1900), "{:?}", started.elapsed());
    assert_eq!(*local.translations.lock().unwrap(), 20);
    assert_eq!(answer["translations"][0]["message"], "hello", "the original goes out");
    assert_eq!(error_code(&ui.wait_endpoint(mark, "/run/error_translation_engine")), "TRANSLATION_ENGINE_LIMIT");

    // Without a loaded model there is nothing to wait for: one look, no sleep.
    *local.loaded.lock().unwrap() = None;
    *local.translations.lock().unwrap() = 0;
    let started = std::time::Instant::now();
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m2", "message": "hello again" })));
    assert!(started.elapsed() < std::time::Duration::from_millis(1500), "{:?}", started.elapsed());
    assert_eq!(*local.translations.lock().unwrap(), 0, "a model that is not there is not asked");
    assert_eq!(answer["translations"][0]["message"], "hello again");
    ui.stop();
}

#[test]
fn a_language_no_engine_has_is_sent_as_it_is_without_a_failure() {
    // [`test_model_get_translate_unsupported_language.py`], [`test_translation_unsupported_language.py`].
    //
    // [`test_model_get_translate_unsupported_language.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_model_get_translate_unsupported_language.py
    // [`test_translation_unsupported_language.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_translation_unsupported_language.py
    let fake = FakeProviders::start();
    let (ui, local) = deepl_with_local_behind(&fake);
    // DeepL has no Arabic.
    let mut your = ui.ok("/get/data/selected_your_languages", None);
    your["1"]["1"]["language"] = json!("Arabic");
    your["1"]["1"]["country"] = json!("Egypt");
    assert_eq!(ui.ok("/set/data/selected_your_languages", Some(your))["1"]["1"]["language"], "Arabic");
    let before = fake.seen_under("/deepl-free/v2/translate").len();

    // The local model translates what DeepL cannot: a translation, not a failure.
    let mark = ui.lines().len();
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m1", "message": "مرحبا" })));
    assert!(answer["translations"][0]["message"].as_str().unwrap().starts_with("local:"), "{answer}");
    assert_eq!(fake.seen_under("/deepl-free/v2/translate").len(), before, "DeepL is not asked");

    // Neither has the pair: the original goes out, and nothing failed.
    *local.answer.lock().unwrap() = Some(Err(LocalError::Unsupported));
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m2", "message": "مرحبا" })));
    assert_eq!(answer["translations"][0]["message"], "مرحبا");
    // An empty translation is a failure like any other.
    *local.answer.lock().unwrap() = Some(Ok("  ".into()));
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m3", "message": "مرحبا بكم" })));
    assert_eq!(answer["translations"][0]["message"], "مرحبا بكم");
    let engine_errors = ui.on(mark, "/run/error_translation_engine");
    assert_eq!(engine_errors.len(), 1, "only the empty translation failed: {engine_errors:?}");
    assert!(ui.on(mark, "/run/selected_translation_engines").len() <= 1);
    ui.stop();
}

#[test]
fn swapping_exchanges_the_first_languages_of_the_tab_only() {
    // `swapYourLanguageAndTargetLanguage`: the own language and the first target change places in
    // the selected tab; the other targets and the other tabs stay, and both lists come back.
    let fake = FakeProviders::start();
    let (ui, _local) = deepl_with_local_behind(&fake);
    let mut your = ui.ok("/get/data/selected_your_languages", None);
    your["1"]["1"] = json!({ "language": "Japanese", "country": "Japan", "enable": true });
    ui.ok("/set/data/selected_your_languages", Some(your));
    let mut target = ui.ok("/get/data/selected_target_languages", None);
    target["1"]["1"] = json!({ "language": "English", "country": "United States", "enable": true });
    target["1"]["2"] = json!({ "language": "Korean", "country": "South Korea", "enable": true });
    ui.ok("/set/data/selected_target_languages", Some(target));
    let (your_before, target_before) = (ui.ok("/get/data/selected_your_languages", None), ui.ok("/get/data/selected_target_languages", None));

    let swapped = ui.ok("/run/swap_your_language_and_target_language", None);
    assert_eq!(swapped["your"]["1"]["1"], target_before["1"]["1"]);
    assert_eq!(swapped["target"]["1"]["1"], your_before["1"]["1"]);
    assert_eq!(swapped["target"]["1"]["2"], target_before["1"]["2"], "the other targets stay");
    for tab in ["2", "3"] {
        assert_eq!((&swapped["your"][tab], &swapped["target"][tab]), (&your_before[tab], &target_before[tab]), "tab {tab} stays");
    }
    assert_eq!(ui.ok("/get/data/selected_your_languages", None), swapped["your"], "it is kept");
    assert_eq!(ui.ok("/get/data/selected_target_languages", None), swapped["target"]);
    // A message now goes the other way.
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m1", "message": "hello" })));
    assert_eq!(answer["translations"][0]["message"], "deepl-free:JA:hello");

    // Swapping again gives back what there was.
    let back = ui.ok("/run/swap_your_language_and_target_language", None);
    assert_eq!((back["your"].clone(), back["target"].clone()), (your_before, target_before));
    ui.stop();
}

#[test]
fn the_same_language_on_both_sides_is_not_translated() {
    let fake = FakeProviders::start();
    let (ui, local) = deepl_with_local_behind(&fake);
    let mut target = ui.ok("/get/data/selected_target_languages", None);
    let your = ui.ok("/get/data/selected_your_languages", None);
    target["1"]["1"]["language"] = your["1"]["1"]["language"].clone();
    target["1"]["1"]["country"] = your["1"]["1"]["country"].clone();
    ui.ok("/set/data/selected_target_languages", Some(target));
    let before = (fake.seen_under("/deepl-free/v2/translate").len(), *local.translations.lock().unwrap());
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m1", "message": "そのまま" })));
    assert_eq!(answer["translations"][0]["message"], "そのまま");
    assert_eq!((fake.seen_under("/deepl-free/v2/translate").len(), *local.translations.lock().unwrap()), before);
    ui.stop();
}

#[test]
fn several_destinations_translate_at_the_same_time_and_keep_their_slots() {
    // [`test_model_input_translate_parallel.py`].
    // An online provider: the local model is one model and translates one text at a time.
    //
    // [`test_model_input_translate_parallel.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_model_input_translate_parallel.py
    let fake = FakeProviders::start();
    let (ui, _local) = deepl_with_local_behind(&fake);
    let mut target = ui.ok("/get/data/selected_target_languages", None);
    target["1"]["1"] = json!({ "language": "English", "country": "United States", "enable": true });
    target["1"]["2"] = json!({ "language": "Korean", "country": "South Korea", "enable": true });
    target["1"]["3"] = json!({ "language": "French", "country": "France", "enable": true });
    ui.ok("/set/data/selected_target_languages", Some(target));

    // Three in a row would take three times as long.
    let delay = std::time::Duration::from_millis(1000);
    fake.reply(move |_, _, _| {
        std::thread::sleep(delay);
        None
    });
    let started = std::time::Instant::now();
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m1", "message": "hello" })));
    assert!(started.elapsed() < delay * 2, "the destinations waited for each other: {:?}", started.elapsed());
    let texts: Vec<&str> =
        answer["translations"].as_array().unwrap().iter().map(|t| t["message"].as_str().unwrap()).collect();
    assert_eq!(texts, ["deepl-free:EN-US:hello", "deepl-free:KO:hello", "deepl-free:FR:hello"], "each stays in its slot");

    // No destination on: nothing to translate.
    let mut target = ui.ok("/get/data/selected_target_languages", None);
    for slot in ["1", "2", "3"] {
        target["1"][slot]["enable"] = json!(false);
    }
    ui.ok("/set/data/selected_target_languages", Some(target));
    let answer = ui.ok("/run/send_message_box", Some(json!({ "id": "m2", "message": "hello" })));
    assert_eq!(answer["translations"], json!([]));
    ui.stop();
}
