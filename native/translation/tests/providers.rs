//! The providers against a stand-in server on a loopback port: key checks, model lists,
//! translation, failures and retries.

use vrct_translation::fake::FakeProviders;
use vrct_translation::http::{self, HttpError, Transport};
use vrct_translation::prompt::HistoryItem;
use vrct_translation::providers::{prepare, Client, Endpoints, Error, Provider, Translation};

fn net() -> Transport {
    http::loopback_only()
}

fn languages() -> Vec<String> {
    vec!["Japanese".into(), "English".into()]
}

fn ask<'a>(text: &'a str, supported: &'a [String], history: &'a [HistoryItem]) -> Translation<'a> {
    Translation { text, source: "Japanese", target: "English", supported_languages: supported, history }
}

#[test]
fn deepl_checks_the_key_and_translates_with_upper_case_codes() {
    let fake = FakeProviders::start();
    fake.key("/deepl-free", "good:fx");
    let endpoints = Endpoints::all_at(&fake.url());
    let base = endpoints.fixed(Provider::DeepL, "good:fx").unwrap();
    assert!(base.ends_with("/deepl-free"));
    let prepared = prepare(&net(), Provider::DeepL, &base, Some("good:fx"), None).unwrap();
    assert!(prepared.models.is_empty());
    let check = &fake.seen_under("/deepl-free")[0];
    assert_eq!(check.body["text"][0], " ");
    assert_eq!(check.body["target_lang"], "EN-US");

    let t =
        Translation { text: "こんにちは", source: "ja", target: "en-US", supported_languages: &[], history: &[] };
    assert_eq!(prepared.client.translate(&t).unwrap(), "deepl-free:EN-US:こんにちは");
    let sent = fake.seen_under("/deepl-free").pop().unwrap();
    assert_eq!(sent.body["source_lang"], "JA");

    let refused = prepare(&net(), Provider::DeepL, &base, Some("bad:fx"), None).unwrap_err();
    assert_eq!(refused, Error::Status(403));
}

#[test]
fn openai_style_providers_list_and_choose_models() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/openai/v1", "sk-good").models("/openai/v1", &["whisper-1", "gpt-4o-mini", "gpt-4o", "o3"]);
    let prepared = prepare(&net(), Provider::OpenAi, &endpoints.openai, Some("sk-good"), Some("gpt-4o-mini")).unwrap();
    assert_eq!(prepared.models, ["gpt-4o", "gpt-4o-mini"]);
    assert_eq!(prepared.selected.as_deref(), Some("gpt-4o-mini"));
    // The list from the key check is used: one request only.
    assert_eq!(fake.seen_under("/openai/v1").len(), 1);
    assert_eq!(fake.seen_under("/openai/v1")[0].header("authorization"), Some("Bearer sk-good"));

    // A saved model the provider no longer lists falls back to the first.
    let prepared = prepare(&net(), Provider::OpenAi, &endpoints.openai, Some("sk-good"), Some("gone")).unwrap();
    assert_eq!(prepared.selected.as_deref(), Some("gpt-4o"));

    assert_eq!(
        prepare(&net(), Provider::OpenAi, &endpoints.openai, Some("sk-bad"), None).unwrap_err(),
        Error::Status(401)
    );
    fake.models("/openai/v1", &["whisper-1"]);
    assert_eq!(
        prepare(&net(), Provider::OpenAi, &endpoints.openai, Some("sk-good"), None).unwrap_err(),
        Error::NoModels
    );
}

#[test]
fn openrouter_checks_its_key_before_listing() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/openrouter/v1", "or-key").models("/openrouter/v1", &["b/model", "a/model", "x/whisper"]);
    let prepared = prepare(&net(), Provider::OpenRouter, &endpoints.openrouter, Some("or-key"), None).unwrap();
    assert_eq!(prepared.models, ["a/model", "b/model"]);
    let paths: Vec<String> = fake.seen().into_iter().map(|s| s.path).collect();
    assert_eq!(paths, ["/openrouter/v1/auth/key", "/openrouter/v1/models"]);
}

#[test]
fn chat_providers_send_the_prompt_and_history() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/plamo/v1", "plamo-key").models("/plamo/v1", &["plamo-2.0-prime"]);
    let prepared = prepare(&net(), Provider::Plamo, &endpoints.plamo, Some("plamo-key"), None).unwrap();
    let supported = languages();
    let history = vec![HistoryItem { source: "mic".into(), text: "前の話".into(), time: "09:05".into() }];
    let translated = prepared.client.translate(&ask("こんにちは", &supported, &history)).unwrap();
    assert_eq!(translated, "plamo/v1:English:こんにちは");
    let sent = fake.seen_under("/plamo/v1/chat").pop().unwrap();
    assert_eq!(sent.body["model"], "plamo-2.0-prime");
    let system = sent.body["messages"][0]["content"].as_str().unwrap();
    assert!(system.starts_with("You are a translation assistant that uses the `plamo-translate` tool."));
    assert!(system.contains("['Japanese', 'English']"));
    assert!(system.ends_with("Conversation context (recent 5 messages):\n[09:05][mic] 前の話\n"));
    assert_eq!(sent.body["messages"][1]["content"], "こんにちは");
}

#[test]
fn a_reply_cut_by_the_length_limit_is_no_translation() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/groq/v1", "gsk-key").models("/groq/v1", &["llama"]).truncate("/groq/v1", true);
    let prepared = prepare(&net(), Provider::Groq, &endpoints.groq, Some("gsk-key"), None).unwrap();
    let supported = languages();
    assert_eq!(prepared.client.translate(&ask("文", &supported, &[])).unwrap(), "");
    fake.key("/gemini", "gemini-key").models("/gemini", &["gemini-2.5-flash", "gemini-tts"]).truncate("/gemini", true);
    let gemini = prepare(&net(), Provider::Gemini, &endpoints.gemini, Some("gemini-key"), None).unwrap();
    assert_eq!(gemini.models, ["gemini-2.5-flash"]);
    assert_eq!(gemini.client.translate(&ask("文", &supported, &[])).unwrap(), "");
    fake.truncate("/gemini", false);
    assert_eq!(gemini.client.translate(&ask("文", &supported, &[])).unwrap(), "gemini:English:文");
    let sent = fake.seen_under("/gemini/v1beta/models/gemini-2.5-flash:generateContent").pop().unwrap();
    assert_eq!(sent.header("x-goog-api-key"), Some("gemini-key"));
}

#[test]
fn a_cloud_provider_tries_once_more_and_a_local_one_does_not() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/openai/v1", "sk-good").models("/openai/v1", &["gpt-4o"]);
    let prepared = prepare(&net(), Provider::OpenAi, &endpoints.openai, Some("sk-good"), None).unwrap();
    fake.fail("/openai/v1", 503);
    let supported = languages();
    assert_eq!(prepared.client.translate(&ask("文", &supported, &[])).unwrap_err(), Error::Status(503));
    assert_eq!(fake.seen_under("/openai/v1/chat").len(), 2);
    fake.fail("/openai/v1", 400);
    let _ = prepared.client.translate(&ask("文", &supported, &[]));
    assert_eq!(fake.seen_under("/openai/v1/chat").len(), 3, "a refused request is not repeated");

    fake.models("/ollama", &["qwen", "llama"]);
    let mut ollama = Client::new(Provider::Ollama, endpoints.ollama.clone(), None, net());
    assert!(ollama.check().is_ok());
    let models = ollama.models().unwrap();
    assert_eq!(models, ["llama", "qwen"]);
    ollama.set_model("qwen", &models).unwrap();
    assert_eq!(ollama.translate(&ask("文", &supported, &[])).unwrap(), "ollama:English:文");
    fake.fail("/ollama", 500);
    assert_eq!(ollama.translate(&ask("文", &supported, &[])).unwrap_err(), Error::Status(500));
    assert_eq!(fake.seen_under("/ollama/api/chat").len(), 2, "one success and one failure, no retry");
}

#[test]
fn a_local_server_that_is_not_running_answers_nothing() {
    let port = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    let lmstudio = Client::new(Provider::LmStudio, format!("http://127.0.0.1:{port}/v1"), None, net());
    let error = lmstudio.check().unwrap_err();
    assert!(error.nothing_answered(), "{error:?}");
    assert_eq!(lmstudio.models().unwrap(), Vec::<String>::new());
    // A public host over plain HTTP is refused before connecting.
    let public = Client::new(Provider::LmStudio, "http://example.com/v1", None, http::direct());
    assert_eq!(public.check().unwrap_err(), Error::Http(HttpError::Url));
}

#[test]
fn lm_studio_and_the_compatible_endpoint_use_the_chosen_url() {
    let fake = FakeProviders::start();
    fake.models("/lmstudio/v1", &["b-model", "a-model"]);
    let prepared = prepare(&net(), Provider::LmStudio, &fake.url_of("/lmstudio/v1"), None, None).unwrap();
    assert_eq!(prepared.selected.as_deref(), Some("a-model"));
    let supported = languages();
    assert_eq!(prepared.client.translate(&ask("文", &supported, &[])).unwrap(), "lmstudio/v1:English:文");
    assert_eq!(fake.seen_under("/lmstudio/v1/chat").pop().unwrap().header("authorization"), Some("Bearer lmstudio"));

    fake.key("/compatible/v1", "c-key").models("/compatible/v1", &["mistral", "bge-rerank"]);
    let prepared = prepare(
        &net(),
        Provider::OpenAiCompatible,
        &format!("{}/", fake.url_of("/compatible/v1")),
        Some("c-key"),
        None,
    )
    .unwrap();
    assert_eq!(prepared.models, ["mistral"]);
}
