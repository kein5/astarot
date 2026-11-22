//! The providers against a stand-in server on a loopback port: key checks, model lists,
//! translation, failures and retries. Each provider is called through its type ([`Api`]).

use astarot_translation::fake::FakeProviders;
use astarot_translation::http::{self, HttpError, Transport};
use astarot_translation::prompt::HistoryItem;
use astarot_translation::providers::{
    deepl, Access, Api, DeepL, Endpoints, Error, Gemini, GoogleCloud, Groq, LmStudio, Ollama, OpenAi, OpenAiCompatible,
    OpenRouter, Papago, Plamo, Provider, Translation,
};

fn net() -> Transport {
    http::loopback_only()
}

fn languages() -> Vec<String> {
    vec!["Japanese".into(), "English".into()]
}

/// A machine translation: codes, no prompt.
fn plain<'a>(text: &'a str, source: &'a str, target: &'a str) -> Translation<'a> {
    Translation { text, source, target, supported_languages: &[], history: &[], glossary: &[], temperature: None, instructions: "" }
}

fn ask<'a>(text: &'a str, supported: &'a [String], history: &'a [HistoryItem]) -> Translation<'a> {
    Translation { text, source: "Japanese", target: "English", supported_languages: supported, history, glossary: &[], temperature: None, instructions: "" }
}

#[test]
fn deepl_checks_the_key_and_translates_with_upper_case_codes() {
    let fake = FakeProviders::start();
    fake.key("/deepl-free", "good:fx");
    let endpoints = Endpoints::all_at(&fake.url());
    let base = deepl::base_url(&endpoints.deepl, &endpoints.deepl_free, "good:fx");
    assert!(base.ends_with("/deepl-free"));
    DeepL::check(&net(), &Access::at(base).key("good:fx")).unwrap();
    let check = &fake.seen_under("/deepl-free")[0];
    assert_eq!(check.body["text"][0], " ");
    assert_eq!(check.body["target_lang"], "EN-US");

    let ask_deepl =
        Translation { text: "こんにちは", source: "ja", target: "en-US", supported_languages: &[], history: &[], glossary: &[], temperature: None, instructions: "" };
    assert_eq!(
        DeepL::translate(&net(), &Access::at(base).key("good:fx"), &ask_deepl).unwrap(),
        "deepl-free:EN-US:こんにちは"
    );
    let sent = fake.seen_under("/deepl-free").pop().unwrap();
    assert_eq!(sent.body["source_lang"], "JA");

    assert_eq!(DeepL::check(&net(), &Access::at(base).key("bad:fx")).unwrap_err(), Error::Status(403));
}

#[test]
fn openai_lists_its_models_with_the_key() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/openai/v1", "sk-good").models("/openai/v1", &["whisper-1", "gpt-4o-mini", "gpt-4o", "o3"]);
    assert_eq!(OpenAi::list(&net(), &Access::at(&endpoints.openai).key("sk-good")).unwrap(), ["gpt-4o", "gpt-4o-mini"]);
    assert_eq!(fake.seen_under("/openai/v1")[0].header("authorization"), Some("Bearer sk-good"));
    assert_eq!(OpenAi::list(&net(), &Access::at(&endpoints.openai).key("sk-bad")).unwrap_err(), Error::Status(401));
    fake.models("/openai/v1", &["whisper-1"]);
    assert_eq!(OpenAi::list(&net(), &Access::at(&endpoints.openai).key("sk-good")).unwrap(), Vec::<String>::new());
}

#[test]
fn openrouter_checks_its_key_before_listing() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/openrouter/v1", "or-key").models("/openrouter/v1", &["b/model", "a/model", "x/whisper"]);
    OpenRouter::reach(&net(), &Access::at(&endpoints.openrouter).key("or-key")).unwrap();
    assert_eq!(
        OpenRouter::list(&net(), &Access::at(&endpoints.openrouter).key("or-key")).unwrap(),
        ["a/model", "b/model"]
    );
    let paths: Vec<String> = fake.seen().into_iter().map(|s| s.path).collect();
    assert_eq!(paths, ["/openrouter/v1/auth/key", "/openrouter/v1/models"]);
    let supported = languages();
    assert_eq!(
        OpenRouter::translate(
            &net(),
            &Access::at(&endpoints.openrouter).key("or-key").model("a/model"),
            &ask("文", &supported, &[])
        )
        .unwrap(),
        "openrouter/v1:English:文"
    );
}

#[test]
fn plamo_sends_its_prompt_and_the_history() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/plamo/v1", "plamo-key").models("/plamo/v1", &["plamo-2.0-prime"]);
    assert_eq!(Plamo::list(&net(), &Access::at(&endpoints.plamo).key("plamo-key")).unwrap(), ["plamo-2.0-prime"]);
    let supported = languages();
    let history = vec![HistoryItem { source: "mic".into(), text: "前の話".into(), time: "09:05".into() }];
    let translated = Plamo::translate(
        &net(),
        &Access::at(&endpoints.plamo).key("plamo-key").model("plamo-2.0-prime"),
        &ask("こんにちは", &supported, &history),
    )
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
    assert_eq!(Groq::list(&net(), &Access::at(&endpoints.groq).key("gsk-key")).unwrap(), ["llama"]);
    let supported = languages();
    assert_eq!(
        Groq::translate(
            &net(),
            &Access::at(&endpoints.groq).key("gsk-key").model("llama"),
            &ask("文", &supported, &[])
        )
        .unwrap(),
        ""
    );
    fake.key("/gemini", "gemini-key").models("/gemini", &["gemini-2.5-flash", "gemini-tts"]).truncate("/gemini", true);
    assert_eq!(Gemini::list(&net(), &Access::at(&endpoints.gemini).key("gemini-key")).unwrap(), ["gemini-2.5-flash"]);
    let ask_gemini = || {
        let access = Access::at(&endpoints.gemini).key("gemini-key").model("gemini-2.5-flash");
        Gemini::translate(&net(), &access, &ask("文", &supported, &[]))
    };
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
    let ask_openai = || {
        OpenAi::translate(
            &net(),
            &Access::at(&endpoints.openai).key("sk-good").model("gpt-4o"),
            &ask("文", &supported, &[]),
        )
    };
    assert_eq!(ask_openai().unwrap_err(), Error::Status(503));
    assert_eq!(fake.seen_under("/openai/v1/chat").len(), 2);
    fake.fail("/openai/v1", 400);
    let _ = ask_openai();
    assert_eq!(fake.seen_under("/openai/v1/chat").len(), 3, "a refused request is not repeated");

    let base = fake.url_of("/ollama");
    fake.models("/ollama", &["qwen", "llama"]);
    assert!(Ollama::reach(&net(), &Access::at(&base)).is_ok());
    assert_eq!(Ollama::models(&net(), &Access::at(&base)), ["llama", "qwen"]);
    assert_eq!(
        Ollama::translate(&net(), &Access::at(&base).model("qwen"), &ask("文", &supported, &[])).unwrap(),
        "ollama:English:文"
    );
    fake.fail("/ollama", 500);
    assert_eq!(
        Ollama::translate(&net(), &Access::at(&base).model("qwen"), &ask("文", &supported, &[])).unwrap_err(),
        Error::Status(500)
    );
    assert_eq!(fake.seen_under("/ollama/api/chat").len(), 2, "one success and one failure, no retry");
}

#[test]
fn a_local_server_that_is_not_running_answers_nothing() {
    let port = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    let base = format!("http://127.0.0.1:{port}/v1");
    let error = LmStudio::reach(&net(), &Access::at(&base)).unwrap_err();
    assert!(error.nothing_answered(), "{error:?}");
    assert_eq!(LmStudio::models(&net(), &Access::at(&base)), Vec::<String>::new());
    assert_eq!(Ollama::models(&net(), &Access::at(&format!("http://127.0.0.1:{port}"))), Vec::<String>::new());
    // A public host over plain HTTP is refused before connecting.
    assert_eq!(
        LmStudio::reach(&http::direct(), &Access::at("http://example.com/v1")).unwrap_err(),
        Error::Http(HttpError::Url)
    );
    assert_eq!(
        Ollama::reach(&http::direct(), &Access::at("http://example.com:11434")).unwrap_err(),
        Error::Http(HttpError::Url)
    );
}

#[test]
fn lm_studio_and_the_compatible_endpoint_use_the_chosen_url() {
    let fake = FakeProviders::start();
    fake.models("/lmstudio/v1", &["b-model", "a-model"]);
    let base = fake.url_of("/lmstudio/v1");
    LmStudio::reach(&net(), &Access::at(&base)).unwrap();
    assert_eq!(LmStudio::models(&net(), &Access::at(&base)), ["a-model", "b-model"]);
    let supported = languages();
    assert_eq!(
        LmStudio::translate(&net(), &Access::at(&base).model("a-model"), &ask("文", &supported, &[])).unwrap(),
        "lmstudio/v1:English:文"
    );
    assert_eq!(fake.seen_under("/lmstudio/v1/chat").pop().unwrap().header("authorization"), Some("Bearer lmstudio"));

    fake.key("/compatible/v1", "c-key").models("/compatible/v1", &["mistral", "bge-rerank"]);
    let base = format!("{}/", fake.url_of("/compatible/v1"));
    assert_eq!(OpenAiCompatible::list(&net(), &Access::at(&base).key("c-key")).unwrap(), ["mistral"]);
    // A server on this PC gets one try only, like LM Studio.
    fake.fail("/compatible/v1", 503);
    let _ = OpenAiCompatible::translate(
        &net(),
        &Access::at(&base).key("c-key").model("mistral"),
        &ask("文", &supported, &[]),
    );
    assert_eq!(fake.seen_under("/compatible/v1/chat").len(), 1);
}

#[test]
fn google_cloud_checks_the_key_and_translates_plain_text() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/google-cloud", "AIza-good");
    GoogleCloud::check(&net(), &Access::at(&endpoints.google_cloud).key("AIza-good")).unwrap();
    let check = fake.seen_under("/google-cloud").pop().unwrap();
    assert_eq!((check.method.as_str(), check.path.as_str()), ("GET", "/google-cloud/language/translate/v2/languages"));
    assert_eq!(check.header("x-goog-api-key"), Some("AIza-good"));
    assert_eq!(
        GoogleCloud::check(&net(), &Access::at(&endpoints.google_cloud).key("AIza-bad")).unwrap_err(),
        Error::Status(400)
    );

    let translated = GoogleCloud::translate(
        &net(),
        &Access::at(&endpoints.google_cloud).key("AIza-good"),
        &plain("こんにちは", "ja", "en"),
    )
    .unwrap();
    assert_eq!(translated, "google-cloud:en:こんにちは");
    let sent = fake.seen_under("/google-cloud/language/translate/v2").pop().unwrap();
    assert_eq!(sent.body["source"], "ja");
    assert_eq!(sent.body["format"], "text");
    assert!(!sent.path.contains("key="), "the key is never in the URL");

    fake.fail("/google-cloud", 503);
    let before = fake.seen_under("/google-cloud").len();
    let _ =
        GoogleCloud::translate(&net(), &Access::at(&endpoints.google_cloud).key("AIza-good"), &plain("文", "ja", "en"));
    assert_eq!(fake.seen_under("/google-cloud").len() - before, 2, "one retry");
}

#[test]
fn papago_checks_the_pair_of_values_without_translating() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/papago", "cid:secret");
    Papago::check(&net(), &Access::at(&endpoints.papago).client_id("cid").key("secret")).unwrap();
    let check = fake.seen_under("/papago").pop().unwrap();
    assert_eq!(check.body["text"], "");
    assert_eq!(check.header("x-ncp-apigw-api-key-id"), Some("cid"));
    assert_eq!(check.header("x-ncp-apigw-api-key"), Some("secret"));
    assert_eq!(
        Papago::check(&net(), &Access::at(&endpoints.papago).client_id("cid").key("wrong")).unwrap_err(),
        Error::Status(401)
    );

    assert_eq!(
        Papago::translate(
            &net(),
            &Access::at(&endpoints.papago).client_id("cid").key("secret"),
            &plain("안녕", "ko", "ja")
        )
        .unwrap(),
        "papago:ja:안녕"
    );
    let before = fake.seen_under("/papago").len();
    assert_eq!(
        Papago::translate(
            &net(),
            &Access::at(&endpoints.papago).client_id("cid").key("secret"),
            &plain("hola", "es", "ja")
        )
        .unwrap_err(),
        Error::UnsupportedPair
    );
    assert_eq!(fake.seen_under("/papago").len(), before, "an unsupported pair is not sent");
}

/// A stand-in network that answers every request with `answer` and counts the requests.
fn canned(answer: serde_json::Value) -> (Transport, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let count = std::sync::Arc::new(AtomicUsize::new(0));
    let seen = count.clone();
    let transport: Transport = std::sync::Arc::new(move |_request, _timeouts| {
        seen.fetch_add(1, Ordering::SeqCst);
        Ok(http::Response::new(200, serde_json::to_vec(&answer).unwrap()))
    });
    (transport, count)
}

#[test]
fn only_openai_and_the_compatible_endpoint_read_incomplete_details() {
    // A Responses API answer (gpt-5-pro has only that API) cut by the output limit.
    let answer = serde_json::json!({
        "status": "incomplete",
        "incomplete_details": { "reason": "max_output_tokens" },
        "output": [{ "type": "message", "content": [{ "type": "output_text", "text": "訳" }] }],
    });
    let (net, _) = canned(answer);
    let supported = languages();
    let request = ask("文", &supported, &[]);
    let access = Access::at("https://api.example.com/v1").key("k").model("gpt-5-pro");
    assert_eq!(OpenAi::translate(&net, &access, &request).unwrap(), "");
    assert_eq!(OpenAiCompatible::translate(&net, &access, &request).unwrap(), "");
    assert_eq!(Groq::translate(&net, &access, &request).unwrap(), "訳");
    assert_eq!(OpenRouter::translate(&net, &access, &request).unwrap(), "訳");
    assert_eq!(Plamo::translate(&net, &access, &request).unwrap(), "訳");
    assert_eq!(LmStudio::translate(&net, &access, &request).unwrap(), "訳");

    // Chat Completions has no incomplete_details: one that comes anyway is not read.
    let answer = serde_json::json!({
        "choices": [{ "message": { "content": "訳" }, "finish_reason": "stop" }],
        "incomplete_details": { "reason": "max_output_tokens" },
    });
    let (net, _) = canned(answer);
    let access = Access::at("https://api.example.com/v1").key("k").model("gpt-4o");
    assert_eq!(OpenAi::translate(&net, &access, &request).unwrap(), "訳");
}

#[test]
fn a_chat_provider_without_a_model_sends_nothing() {
    let (net, count) = canned(serde_json::json!({}));
    let supported = languages();
    let request = ask("文", &supported, &[]);
    let access = Access::at("https://api.example.com/v1").key("k");
    for provider in [Provider::Plamo, Provider::Gemini, Provider::OpenAi, Provider::Groq, Provider::OpenRouter] {
        assert_eq!(provider.translate(&net, &access, &request).unwrap_err(), Error::UnknownModel);
    }
    let local = Access::at("http://127.0.0.1:1/v1");
    for provider in [Provider::OpenAiCompatible, Provider::LmStudio, Provider::Ollama] {
        assert_eq!(provider.translate(&net, &local, &request).unwrap_err(), Error::UnknownModel);
    }
    assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn the_runtime_name_calls_the_same_code_as_the_type() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/openrouter/v1", "or-key").models("/openrouter/v1", &["b/model", "a/model"]);
    let access = Access::at(&endpoints.openrouter).key("or-key");
    assert_eq!(Provider::OpenRouter.check(&net(), &access).unwrap(), ["a/model", "b/model"]);
    // A check asks `/auth/key` first; asking the models again does not.
    assert_eq!(Provider::OpenRouter.models(&net(), &access), ["a/model", "b/model"]);
    let paths: Vec<String> = fake.seen().into_iter().map(|s| s.path).collect();
    assert_eq!(paths, ["/openrouter/v1/auth/key", "/openrouter/v1/models", "/openrouter/v1/models"]);
    // A machine translation API has no models to ask for.
    assert_eq!(Provider::DeepL.models(&net(), &Access::at(&endpoints.deepl).key("k")), Vec::<String>::new());
    assert_eq!(fake.seen().len(), 3);
}

/// The temperature and the instructions the user chose for the AI providers (#392): sent when
/// chosen, and nothing of them otherwise, so the requests stay the ones recorded from Python.
#[test]
fn the_ai_providers_send_the_temperature_and_the_instructions_the_user_chose() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    let supported = languages();
    let chosen = |t: Translation<'static>| Translation { temperature: Some(0.2), instructions: " Keep VRChat terms in English. ", ..t };
    let system = |body: &serde_json::Value| body["messages"][0]["content"].as_str().unwrap().to_string();

    fake.key("/openai/v1", "sk-good").models("/openai/v1", &["gpt-4o"]);
    let openai = Access::at(&endpoints.openai).key("sk-good").model("gpt-4o");
    OpenAi::translate(&net(), &openai, &chosen(ask("文", &[], &[]))).unwrap();
    let sent = fake.seen_under("/openai/v1/chat").pop().unwrap();
    assert_eq!(sent.body["temperature"], 0.2);
    let prompt = system(&sent.body);
    assert!(prompt.contains("Additional instructions from the user.") && prompt.contains("\nKeep VRChat terms in English.\n"), "{prompt}");
    assert!(prompt.find("Return ONLY the translated text").unwrap() < prompt.find("Keep VRChat").unwrap(), "the rules come first");
    OpenAi::translate(&net(), &openai, &ask("文", &supported, &[])).unwrap();
    let sent = fake.seen_under("/openai/v1/chat").pop().unwrap();
    assert!(sent.body.get("temperature").is_none(), "a temperature was sent unasked");
    assert!(!system(&sent.body).contains("Additional instructions"));

    fake.key("/gemini", "gemini-key").models("/gemini", &["gemini-2.5-flash"]);
    let gemini = Access::at(&endpoints.gemini).key("gemini-key").model("gemini-2.5-flash");
    Gemini::translate(&net(), &gemini, &chosen(ask("文", &[], &[]))).unwrap();
    let sent = fake.seen_under("/gemini").pop().unwrap();
    assert_eq!(sent.body["generationConfig"]["temperature"], 0.2);
    assert!(sent.body["systemInstruction"]["parts"][0]["text"].as_str().unwrap().contains("Keep VRChat terms"));
    Gemini::translate(&net(), &gemini, &ask("文", &supported, &[])).unwrap();
    assert_eq!(fake.seen_under("/gemini").pop().unwrap().body["generationConfig"]["temperature"], 0.7, "LangChain's");

    fake.models("/ollama", &["qwen"]);
    let base = fake.url_of("/ollama");
    Ollama::translate(&net(), &Access::at(&base).model("qwen"), &chosen(ask("文", &[], &[]))).unwrap();
    let sent = fake.seen_under("/ollama/api/chat").pop().unwrap();
    assert_eq!(sent.body["options"], serde_json::json!({ "temperature": 0.2 }));
    assert!(system(&sent.body).contains("Keep VRChat terms"));
}

/// A model that takes no temperature of its choosing (OpenAI's reasoning models) refuses the
/// request: it is asked again without one, as before the setting (#392).
#[test]
fn a_model_that_refuses_a_temperature_is_asked_again_without_one() {
    let fake = FakeProviders::start();
    let endpoints = Endpoints::all_at(&fake.url());
    fake.key("/openai/v1", "sk-good").models("/openai/v1", &["gpt-5"]).refuse_temperature("/openai/v1", true);
    let openai = Access::at(&endpoints.openai).key("sk-good").model("gpt-5");
    let asked = Translation { temperature: Some(0.2), ..ask("文", &[], &[]) };
    assert_eq!(OpenAi::translate(&net(), &openai, &asked).unwrap(), "openai/v1:English:文");
    let sent = fake.seen_under("/openai/v1/chat");
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].body["temperature"], 0.2);
    assert!(sent[1].body.get("temperature").is_none());

    // Without a temperature, a refusal is a refusal: it is not sent again.
    fake.fail("/openai/v1", 400);
    assert_eq!(OpenAi::translate(&net(), &openai, &ask("文", &[], &[])).unwrap_err(), Error::Status(400));
    assert_eq!(fake.seen_under("/openai/v1/chat").len(), 3);
}
