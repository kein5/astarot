//! The providers against a stand-in server on a loopback port: key checks, model lists,
//! translation, failures and retries. Each provider is called through its own module.

use vrct_translation::fake::FakeProviders;
use vrct_translation::http::{self, HttpError, Transport};
use vrct_translation::prompt::HistoryItem;
use vrct_translation::providers::{
    deepl, gemini, google_cloud, groq, lmstudio, ollama, openai, openai_compatible, openrouter, papago, plamo, Endpoints,
    Error, Translation,
};

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
    let base = deepl::base_url(&endpoints.deepl, &endpoints.deepl_free, "good:fx");
    assert!(base.ends_with("/deepl-free"));
    deepl::check(&net(), base, "good:fx").unwrap();
    let check = &fake.seen_under("/deepl-free")[0];
    assert_eq!(check.body["text"][0], " ");
    assert_eq!(check.body["target_lang"], "EN-US");

    assert_eq!(deepl::translate(&net(), base, "good:fx", "こんにちは", "ja", "en-US").unwrap(), "deepl-free:EN-US:こんにちは");
    let sent = fake.seen_under("/deepl-free").pop().unwrap();
    assert_eq!(sent.body["source_lang"], "JA");

    assert_eq!(deepl::check(&net(), base, "bad:fx").unwrap_err(), Error::Status(403));
}

#[test]
fn openai_lists_its_models_with_the_key() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/openai/v1", "sk-good").models("/openai/v1", &["whisper-1", "gpt-4o-mini", "gpt-4o", "o3"]);
    assert_eq!(openai::models(&net(), &endpoints.openai, "sk-good").unwrap(), ["gpt-4o", "gpt-4o-mini"]);
    assert_eq!(fake.seen_under("/openai/v1")[0].header("authorization"), Some("Bearer sk-good"));
    assert_eq!(openai::models(&net(), &endpoints.openai, "sk-bad").unwrap_err(), Error::Status(401));
    fake.models("/openai/v1", &["whisper-1"]);
    assert_eq!(openai::models(&net(), &endpoints.openai, "sk-good").unwrap(), Vec::<String>::new());
}

#[test]
fn openrouter_checks_its_key_before_listing() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/openrouter/v1", "or-key").models("/openrouter/v1", &["b/model", "a/model", "x/whisper"]);
    openrouter::check(&net(), &endpoints.openrouter, "or-key").unwrap();
    assert_eq!(openrouter::models(&net(), &endpoints.openrouter, "or-key").unwrap(), ["a/model", "b/model"]);
    let paths: Vec<String> = fake.seen().into_iter().map(|s| s.path).collect();
    assert_eq!(paths, ["/openrouter/v1/auth/key", "/openrouter/v1/models"]);
    let supported = languages();
    assert_eq!(
        openrouter::translate(&net(), &endpoints.openrouter, "or-key", "a/model", &ask("文", &supported, &[])).unwrap(),
        "openrouter/v1:English:文"
    );
}

#[test]
fn plamo_sends_its_prompt_and_the_history() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/plamo/v1", "plamo-key").models("/plamo/v1", &["plamo-2.0-prime"]);
    assert_eq!(plamo::models(&net(), &endpoints.plamo, "plamo-key").unwrap(), ["plamo-2.0-prime"]);
    let supported = languages();
    let history = vec![HistoryItem { source: "mic".into(), text: "前の話".into(), time: "09:05".into() }];
    let translated =
        plamo::translate(&net(), &endpoints.plamo, "plamo-key", "plamo-2.0-prime", &ask("こんにちは", &supported, &history))
            .unwrap();
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
    fake.key("/groq/v1", "gsk-key").models("/groq/v1", &["llama", "whisper-large"]).truncate("/groq/v1", true);
    assert_eq!(groq::models(&net(), &endpoints.groq, "gsk-key").unwrap(), ["llama"]);
    let supported = languages();
    assert_eq!(groq::translate(&net(), &endpoints.groq, "gsk-key", "llama", &ask("文", &supported, &[])).unwrap(), "");
    fake.key("/gemini", "gemini-key").models("/gemini", &["gemini-2.5-flash", "gemini-tts"]).truncate("/gemini", true);
    assert_eq!(gemini::models(&net(), &endpoints.gemini, "gemini-key").unwrap(), ["gemini-2.5-flash"]);
    let ask_gemini = || gemini::translate(&net(), &endpoints.gemini, "gemini-key", "gemini-2.5-flash", &ask("文", &supported, &[]));
    assert_eq!(ask_gemini().unwrap(), "");
    fake.truncate("/gemini", false);
    assert_eq!(ask_gemini().unwrap(), "gemini:English:文");
    let sent = fake.seen_under("/gemini/v1beta/models/gemini-2.5-flash:generateContent").pop().unwrap();
    assert_eq!(sent.header("x-goog-api-key"), Some("gemini-key"));
}

#[test]
fn a_cloud_provider_tries_once_more_and_a_local_one_does_not() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/openai/v1", "sk-good").models("/openai/v1", &["gpt-4o"]);
    fake.fail("/openai/v1", 503);
    let supported = languages();
    let ask_openai = || openai::translate(&net(), &endpoints.openai, "sk-good", "gpt-4o", &ask("文", &supported, &[]));
    assert_eq!(ask_openai().unwrap_err(), Error::Status(503));
    assert_eq!(fake.seen_under("/openai/v1/chat").len(), 2);
    fake.fail("/openai/v1", 400);
    let _ = ask_openai();
    assert_eq!(fake.seen_under("/openai/v1/chat").len(), 3, "a refused request is not repeated");

    let base = fake.url_of("/ollama");
    fake.models("/ollama", &["qwen", "llama"]);
    assert!(ollama::check(&net(), &base).is_ok());
    assert_eq!(ollama::models(&net(), &base), ["llama", "qwen"]);
    assert_eq!(ollama::translate(&net(), &base, "qwen", &ask("文", &supported, &[])).unwrap(), "ollama:English:文");
    fake.fail("/ollama", 500);
    assert_eq!(ollama::translate(&net(), &base, "qwen", &ask("文", &supported, &[])).unwrap_err(), Error::Status(500));
    assert_eq!(fake.seen_under("/ollama/api/chat").len(), 2, "one success and one failure, no retry");
}

#[test]
fn a_local_server_that_is_not_running_answers_nothing() {
    let port = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    let base = format!("http://127.0.0.1:{port}/v1");
    let error = lmstudio::check(&net(), &base).unwrap_err();
    assert!(error.nothing_answered(), "{error:?}");
    assert_eq!(lmstudio::models(&net(), &base), Vec::<String>::new());
    assert_eq!(ollama::models(&net(), &format!("http://127.0.0.1:{port}")), Vec::<String>::new());
    // A public host over plain HTTP is refused before connecting.
    assert_eq!(lmstudio::check(&http::direct(), "http://example.com/v1").unwrap_err(), Error::Http(HttpError::Url));
    assert_eq!(ollama::check(&http::direct(), "http://example.com:11434").unwrap_err(), Error::Http(HttpError::Url));
}

#[test]
fn lm_studio_and_the_compatible_endpoint_use_the_chosen_url() {
    let fake = FakeProviders::start();
    fake.models("/lmstudio/v1", &["b-model", "a-model"]);
    let base = fake.url_of("/lmstudio/v1");
    lmstudio::check(&net(), &base).unwrap();
    assert_eq!(lmstudio::models(&net(), &base), ["a-model", "b-model"]);
    let supported = languages();
    assert_eq!(lmstudio::translate(&net(), &base, "a-model", &ask("文", &supported, &[])).unwrap(), "lmstudio/v1:English:文");
    assert_eq!(fake.seen_under("/lmstudio/v1/chat").pop().unwrap().header("authorization"), Some("Bearer lmstudio"));

    fake.key("/compatible/v1", "c-key").models("/compatible/v1", &["mistral", "bge-rerank"]);
    let base = format!("{}/", fake.url_of("/compatible/v1"));
    assert_eq!(openai_compatible::models(&net(), &base, "c-key").unwrap(), ["mistral"]);
    // A server on this PC gets one try only, like LM Studio.
    fake.fail("/compatible/v1", 503);
    let _ = openai_compatible::translate(&net(), &base, "c-key", "mistral", &ask("文", &supported, &[]));
    assert_eq!(fake.seen_under("/compatible/v1/chat").len(), 1);
}

#[test]
fn google_cloud_checks_the_key_and_translates_plain_text() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/google-cloud", "AIza-good");
    google_cloud::check(&net(), &endpoints.google_cloud, "AIza-good").unwrap();
    let check = fake.seen_under("/google-cloud").pop().unwrap();
    assert_eq!((check.method.as_str(), check.path.as_str()), ("GET", "/google-cloud/language/translate/v2/languages"));
    assert_eq!(check.header("x-goog-api-key"), Some("AIza-good"));
    assert_eq!(google_cloud::check(&net(), &endpoints.google_cloud, "AIza-bad").unwrap_err(), Error::Status(400));

    let translated = google_cloud::translate(&net(), &endpoints.google_cloud, "AIza-good", "こんにちは", "ja", "en").unwrap();
    assert_eq!(translated, "google-cloud:en:こんにちは");
    let sent = fake.seen_under("/google-cloud/language/translate/v2").pop().unwrap();
    assert_eq!(sent.body["source"], "ja");
    assert_eq!(sent.body["format"], "text");
    assert!(!sent.path.contains("key="), "the key is never in the URL");

    fake.fail("/google-cloud", 503);
    let before = fake.seen_under("/google-cloud").len();
    let _ = google_cloud::translate(&net(), &endpoints.google_cloud, "AIza-good", "文", "ja", "en");
    assert_eq!(fake.seen_under("/google-cloud").len() - before, 2, "one retry");
}

#[test]
fn papago_checks_the_pair_of_values_without_translating() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/papago", "cid:secret");
    papago::check(&net(), &endpoints.papago, "cid", "secret").unwrap();
    let check = fake.seen_under("/papago").pop().unwrap();
    assert_eq!(check.body["text"], "");
    assert_eq!(check.header("x-ncp-apigw-api-key-id"), Some("cid"));
    assert_eq!(check.header("x-ncp-apigw-api-key"), Some("secret"));
    assert_eq!(papago::check(&net(), &endpoints.papago, "cid", "wrong").unwrap_err(), Error::Status(401));

    assert_eq!(papago::translate(&net(), &endpoints.papago, "cid", "secret", "안녕", "ko", "ja").unwrap(), "papago:ja:안녕");
    let before = fake.seen_under("/papago").len();
    assert_eq!(
        papago::translate(&net(), &endpoints.papago, "cid", "secret", "hola", "es", "ja").unwrap_err(),
        Error::UnsupportedPair
    );
    assert_eq!(fake.seen_under("/papago").len(), before, "an unsupported pair is not sent");
}
