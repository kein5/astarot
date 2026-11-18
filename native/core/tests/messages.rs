//! The message pipeline through the IPC surface: `/run/send_message_box` end to end to the
//! chatbox (a UDP socket on 127.0.0.2), the WebSocket clients and the conversation log, with
//! translation off and on, a failing provider, readings, and the recognised text the other
//! areas hand over (`Core::deliver_transcription`). The behaviours are those of
//! `src-python/test/test_controller_message_pipeline.py` and `test_message_snapshot_and_sinks.py`.

mod common;

use common::net::{free_port, read_text, websocket};
use common::{error_code, Setup, Ui};
use serde_json::{json, Value};
use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vrct_adapters::osc::{decode_packet, OscArg};
use vrct_core::controller::messages::{OverlayLog, OverlayMessage, Recognized, Source, SpeechStage, SpokenMessage};
use vrct_core::controller::translation::{LocalError, LocalSetup, LocalTranslation};
use vrct_core::controller::Services;
use vrct_translation::fake::FakeProviders;
use vrct_translation::http;
use vrct_translation::providers::Endpoints;
use vrct_translation::transliteration::{Morpheme, Tokenizer, Unavailable};

const VRCHAT: &str = "127.0.0.2";

/// Readings for the few texts the tests send.
struct Dictionary;

impl Tokenizer for Dictionary {
    fn tokenize(&self, text: &str) -> Result<Vec<Morpheme>, Unavailable> {
        let m = |s: &str, r: &str, p: &str| Morpheme { surface: s.into(), reading: r.into(), part_of_speech: p.into() };
        Ok(match text {
            "日本語です" => vec![m("日本語", "ニホンゴ", "名詞"), m("です", "デス", "助動詞")],
            other => vec![m(other, other, "名詞")],
        })
    }
}

/// A local model that is never there.
struct NoModel;

impl LocalTranslation for NoModel {
    fn load(&self, _setup: &LocalSetup) -> Result<(), LocalError> {
        Err(LocalError::Missing)
    }
    fn loaded(&self) -> Option<LocalSetup> {
        None
    }
    fn translate(&self, _: &str, _: &str, _: &str) -> Result<String, LocalError> {
        Err(LocalError::Failed)
    }
}

struct Run {
    ui: Ui,
    fake: FakeProviders,
    chatbox: UdpSocket,
    websocket_port: u16,
    clipboard: Arc<Mutex<Vec<String>>>,
}

fn deepl_key() -> String {
    format!("{}:fx", "d".repeat(36))
}

fn start(saved: Value, tokenizer: Option<Arc<dyn Tokenizer>>) -> Run {
    start_in(saved, tokenizer, None)
}

/// `dir` holds the settings and the app's folder (`app/`); a fresh one when `None`.
fn start_in(saved: Value, tokenizer: Option<Arc<dyn Tokenizer>>, dir: Option<std::path::PathBuf>) -> Run {
    let fake = FakeProviders::start();
    fake.key("/deepl-free", &deepl_key());
    let chatbox = UdpSocket::bind((VRCHAT, 0)).unwrap();
    let websocket_port = free_port();
    let mut saved = saved;
    let object = saved.as_object_mut().unwrap();
    object.insert("OSC_IP_ADDRESS".into(), json!(VRCHAT));
    object.insert("OSC_PORT".into(), json!(chatbox.local_addr().unwrap().port()));
    object.insert("WEBSOCKET_SERVER".into(), json!(true));
    object.insert("WEBSOCKET_PORT".into(), json!(websocket_port));
    object.entry("AUTH_KEYS").or_insert(json!({ "DeepL_API": deepl_key() }));
    let clipboard = Arc::new(Mutex::new(Vec::new()));
    let copied = Arc::clone(&clipboard);
    let mut services = Services {
        osc: common::fake_osc::factory(false).0,
        translation_transport: http::loopback_only(),
        translation_endpoints: Endpoints::all_at(&fake.url()),
        local_translation: Arc::new(|_| Arc::new(NoModel) as Arc<dyn LocalTranslation>),
        clipboard: Arc::new(move |text| {
            copied.lock().unwrap().push(text.to_string());
            true
        }),
        secret_store: common::shared_vault().system_source(),
        ..Services::default()
    };
    if let Some(tokenizer) = tokenizer {
        services.transliteration = Arc::new(move |_| Arc::clone(&tokenizer));
    }
    let ui = Ui::with(Setup { saved: Some(saved), services, dir, ..Setup::default() });
    ui.ready();
    Run { ui, fake, chatbox, websocket_port, clipboard }
}

impl Run {
    /// The next chatbox text VRChat receives.
    fn chatbox_text(&self, wait: Duration) -> Option<String> {
        self.chatbox.set_read_timeout(Some(wait)).unwrap();
        let mut buffer = [0u8; 4096];
        loop {
            let (size, _) = self.chatbox.recv_from(&mut buffer).ok()?;
            for message in decode_packet(&buffer[..size]).unwrap() {
                if let ("/chatbox/input", Some(OscArg::String(text))) = (message.address.as_str(), message.args.first()) {
                    return Some(text.clone());
                }
            }
        }
    }

    fn chat(&self, id: &str, text: &str) -> Value {
        self.ui.ok("/run/send_message_box", Some(json!({ "id": id, "message": text })))
    }

    /// Turns translation on through DeepL (the local model is not there).
    fn translate_with_deepl(&self) {
        let mut engines = self.ui.ok("/get/data/selected_translation_engines", None);
        engines["1"] = json!("DeepL_API");
        self.ui.ok("/set/data/selected_translation_engines", Some(engines));
        assert_eq!(self.ui.ok("/set/enable/translation", None), true);
    }

    fn logs(&self) -> Vec<(String, String)> {
        let mut found = Vec::new();
        for entry in std::fs::read_dir(self.ui.dir.join("logs")).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            found.push((name, std::fs::read_to_string(entry.path()).unwrap_or_default()));
        }
        found
    }

    fn conversation_log(&self) -> String {
        self.logs().into_iter().filter(|(name, _)| name.starts_with("20")).map(|(_, text)| text).collect()
    }

    fn process_log(&self) -> String {
        self.logs().into_iter().filter(|(name, _)| name == "process.log").map(|(_, text)| text).collect()
    }
}

#[test]
fn a_typed_message_reaches_the_chatbox_websocket_and_log_untranslated() {
    let run = start(json!({ "LOGGER_FEATURE": true }), None);
    let (status, stream) = websocket("127.0.0.1", run.websocket_port, Some("test-token"));
    assert_eq!(status, 101);
    let mut stream = stream.unwrap();

    let result = run.chat("m-1", "こんにちは");
    assert_eq!(
        result,
        json!({ "id": "m-1", "original": { "message": "こんにちは", "transliteration": [] }, "translations": [] })
    );
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("こんにちは"));
    let frame: Value = serde_json::from_str(&read_text(&mut stream, Duration::from_secs(5)).unwrap()).unwrap();
    assert_eq!(frame["type"], "CHAT");
    assert_eq!(frame["message"], "こんにちは");
    assert_eq!(frame["translation"], json!([]));
    assert_eq!(frame["src_languages"]["1"]["language"], "Japanese");
    assert!(run.conversation_log().contains(" - log - INFO - [CHAT] こんにちは\n"), "{}", run.conversation_log());
    // The diagnostic log has neither the text nor anything of it.
    assert!(!run.process_log().contains("こんにちは"));

    // An empty message goes nowhere.
    let empty = run.chat("m-2", "");
    assert_eq!(empty["translations"], json!([]));
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none());
    // A request without the message answers 500, as Python's KeyError did.
    assert_eq!(run.ui.request("/run/send_message_box", Some(json!({ "id": "x" })))["status"], 500);
    run.ui.stop();
}

#[test]
fn a_translated_message_follows_the_format_and_the_only_translated_switch() {
    let run = start(json!({}), None);
    run.translate_with_deepl();
    let result = run.chat("m-1", "こんにちは");
    assert_eq!(result["translations"], json!([{ "message": "deepl-free:EN-US:こんにちは", "transliteration": [] }]));
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("こんにちは\ndeepl-free:EN-US:こんにちは"));
    let sent = run.fake.seen_under("/deepl-free/v2/translate").pop().unwrap();
    assert_eq!((sent.body["source_lang"].as_str(), sent.body["target_lang"].as_str()), (Some("JA"), Some("EN-US")));

    run.ui.ok("/set/enable/send_only_translated_messages", None);
    run.chat("m-2", "さようなら");
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("deepl-free:EN-US:さようなら"));

    // VRChat off: no chatbox, and the result says why.
    run.ui.ok("/set/disable/send_message_to_vrc", None);
    let result = run.chat("m-3", "またね");
    assert_eq!(result["delivery_reason"], "vrchat_off");
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none());
    assert!(!run.process_log().contains("deepl-free:EN-US"), "a translation reached the log");
    run.ui.stop();
}

#[test]
fn the_official_apis_translate_a_message_with_the_users_keys() {
    let run = start(json!({}), None);
    let google = format!("AIza{}", "k".repeat(35));
    run.fake.key("/google-cloud", &google).key("/papago", "client-1:secret-1");
    let use_engine = |engine: &str| {
        let mut engines = run.ui.ok("/get/data/selected_translation_engines", None);
        engines["1"] = json!(engine);
        assert_eq!(run.ui.ok("/set/data/selected_translation_engines", Some(engines))["1"], engine);
    };

    assert_eq!(run.ui.ok("/set/data/google_cloud_auth_key", Some(json!(google))), json!(google));
    use_engine("Google_Cloud_API");
    assert_eq!(run.ui.ok("/set/enable/translation", None), true);
    let result = run.chat("m-1", "こんにちは");
    assert_eq!(result["translations"], json!([{ "message": "google-cloud:en:こんにちは", "transliteration": [] }]));
    let sent = run.fake.seen_under("/google-cloud/language/translate/v2").pop().unwrap();
    assert_eq!((sent.body["source"].as_str(), sent.body["format"].as_str()), (Some("ja"), Some("text")));

    assert_eq!(run.ui.ok("/set/data/papago_client_id", Some(json!("client-1"))), "client-1");
    assert_eq!(run.ui.ok("/set/data/papago_auth_key", Some(json!("secret-1"))), "secret-1");
    use_engine("Papago_API");
    let result = run.chat("m-2", "こんにちは");
    assert_eq!(result["translations"], json!([{ "message": "papago:en:こんにちは", "transliteration": [] }]));
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("こんにちは\ngoogle-cloud:en:こんにちは"));

    let log = run.process_log();
    assert!(!log.contains(&google) && !log.contains("secret-1") && !log.contains("こんにちは"), "the log has a key or text");
    run.ui.stop();
}

#[test]
fn a_failing_provider_falls_back_reports_and_sends_the_original() {
    let run = start(json!({}), None);
    run.translate_with_deepl();
    run.fake.fail("/deepl-free", 503);
    let before = run.fake.seen_under("/deepl-free/v2/translate").len();
    let mark = run.ui.send("/run/send_message_box", Some(json!({ "id": "m-1", "message": "こんにちは" })));
    let answer = run.ui.wait_endpoint(mark, "/run/send_message_box");
    assert_eq!(answer["result"]["translations"][0]["message"], "こんにちは", "the original stands in");
    let engines = run.ui.wait_endpoint(mark, "/run/selected_translation_engines");
    assert_eq!(engines["result"]["1"], "CTranslate2");
    let error = run.ui.wait_endpoint(mark, "/run/error_translation_engine");
    assert_eq!((error["status"].as_u64(), error_code(&error)), (Some(400), "TRANSLATION_ENGINE_LIMIT"));
    // One retry, then the local model, which is not there.
    assert_eq!(run.fake.seen_under("/deepl-free/v2/translate").len() - before, 2);
    run.ui.stop();
}

#[test]
fn readings_are_added_for_japanese_and_left_out_without_a_dictionary() {
    let run = start(
        json!({ "CONVERT_MESSAGE_TO_HIRAGANA": true, "CONVERT_MESSAGE_TO_ROMAJI": true }),
        Some(Arc::new(Dictionary)),
    );
    let result = run.chat("m-1", "日本語です");
    assert_eq!(
        result["original"]["transliteration"],
        json!([
            { "orig": "日本語", "hira": "にほんご", "hepburn": "nihongo" },
            { "orig": "です", "hira": "です", "hepburn": "desu" },
        ])
    );
    run.ui.stop();

    let run = start(json!({ "CONVERT_MESSAGE_TO_HIRAGANA": true }), None);
    let result = run.chat("m-1", "日本語です");
    assert_eq!(result["original"]["transliteration"], json!([]));
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("日本語です"), "the message still goes out");
    assert!(run.process_log().contains("Transliteration: no dictionary (no dictionary at "));
    run.ui.stop();
}

#[test]
fn a_damaged_dictionary_beside_the_app_leaves_the_readings_out() {
    let dir = tempfile::tempdir().unwrap();
    let shipped = dir.path().join("app/_internal").join(vrct_core::controller::messages::READINGS_DICTIONARY);
    std::fs::create_dir_all(shipped.parent().unwrap()).unwrap();
    std::fs::write(&shipped, b"cut off").unwrap();
    let run = start_in(json!({ "CONVERT_MESSAGE_TO_ROMAJI": true }), None, Some(dir.path().to_path_buf()));
    let result = run.chat("m-1", "日本語です");
    assert_eq!(result["original"]["transliteration"], json!([]));
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("日本語です"), "the message still goes out");
    let result = run.chat("m-2", "東京");
    assert_eq!(result["original"]["transliteration"], json!([]));
    let log = run.process_log();
    assert_eq!(log.matches("Transliteration: no dictionary (cannot read ").count(), 1, "noted once");
    assert!(!log.contains("日本語です") && !log.contains("東京"), "no text in the log");
    run.ui.stop();
}

#[test]
fn recognised_speech_is_filtered_deduplicated_and_pushed() {
    let run = start(json!({ "MIC_WORD_FILTER": ["spam"], "ENABLE_CLIPBOARD": true }), None);
    let core = run.ui.backend.core().clone();
    let heard =
        |text: &str| Recognized { text: text.into(), language: Some("Japanese".into()), ..Recognized::default() };

    // The microphone is off: nothing goes out.
    let mark = run.ui.lines().len();
    core.deliver_transcription(Source::Mic, heard("こんにちは"), None);
    assert!(run.ui.on(mark, "/run/transcription_send_mic_message").is_empty());
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none());

    core.config().set("ENABLE_TRANSCRIPTION_SEND", json!(true)).unwrap();
    let mark = run.ui.lines().len();
    core.deliver_transcription(Source::Mic, heard("おはよう"), None);
    let pushed = run.ui.wait_endpoint(mark, "/run/transcription_send_mic_message");
    assert_eq!(
        pushed["result"],
        json!({ "original": { "message": "おはよう", "transliteration": [] }, "translations": [] })
    );
    assert_eq!(run.chatbox_text(Duration::from_secs(5)).as_deref(), Some("おはよう"));
    assert_eq!(run.clipboard.lock().unwrap().as_slice(), ["おはよう"]);
    // The same text again is a repeat.
    core.deliver_transcription(Source::Mic, heard("おはよう"), None);
    assert_eq!(run.ui.on(mark, "/run/transcription_send_mic_message").len(), 1);
    // The word filter stops a message and says so.
    let mark = run.ui.lines().len();
    core.deliver_transcription(Source::Mic, heard("this is SPAM"), None);
    assert_eq!(
        run.ui.wait_endpoint(mark, "/run/word_filter")["result"]["message"],
        "Detected by word filter: this is SPAM"
    );
    assert!(run.ui.on(mark, "/run/transcription_send_mic_message").is_empty());

    // OCR reads the other party: never to the chatbox, marked as OCR.
    core.config().set("ENABLE_OCR_CAPTURE", json!(true)).unwrap();
    let mark = run.ui.lines().len();
    let read =
        Recognized { text: "hello".into(), language: None, id: Some("transcription-ocr-7".into()), asr_ms: None };
    assert!(core.deliver_transcription(Source::Ocr, read, None));
    let pushed = run.ui.wait_endpoint(mark, "/run/transcription_ocr_message");
    assert_eq!(pushed["result"]["id"], "transcription-ocr-7");
    assert_eq!(pushed["result"]["source"], "ocr");
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none());

    // Speech from the speaker reaches the chatbox only when the user asked for it.
    core.config().set("ENABLE_TRANSCRIPTION_RECEIVE", json!(true)).unwrap();
    let mark = run.ui.lines().len();
    core.deliver_transcription(Source::Speaker, heard("やあ"), None);
    run.ui.wait_endpoint(mark, "/run/transcription_receive_speaker_message");
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none());
    // A guard that says no stops the publication.
    let mark = run.ui.lines().len();
    let stopped: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(|| false);
    assert!(!core.deliver_transcription(Source::Speaker, heard("べつの"), Some(stopped)));
    assert!(run.ui.on(mark, "/run/transcription_receive_speaker_message").is_empty());
    run.ui.stop();
}

#[test]
fn the_overlay_and_speech_hooks_get_each_message_and_a_failure_is_reported() {
    let run = start(json!({ "OVERLAY_LARGE_LOG": true }), None);
    let overlays: Arc<Mutex<Vec<OverlayMessage>>> = Arc::default();
    let spoken: Arc<Mutex<Vec<SpokenMessage>>> = Arc::default();
    let (o, s) = (Arc::clone(&overlays), Arc::clone(&spoken));
    run.ui.backend.core().set_message_hooks(
        Some(Arc::new(move |event: &OverlayMessage| {
            o.lock().unwrap().push(event.clone());
            Err(())
        })),
        Some(Arc::new(move |event: &SpokenMessage| {
            s.lock().unwrap().push(event.clone());
            Ok(())
        })),
    );
    run.translate_with_deepl();
    let mark = run.ui.send("/run/send_message_box", Some(json!({ "id": "m-1", "message": "こんにちは" })));
    let answer = run.ui.wait_endpoint(mark, "/run/send_message_box");
    assert_eq!(
        answer["result"]["output_failures"],
        json!([{ "output": "overlay_large", "error_code": "MESSAGE_OUTPUT_FAILED" }])
    );
    let failure = run.ui.wait_endpoint(mark, "/run/message_output_error");
    assert_eq!(
        failure["result"]["data"],
        json!({ "id": "m-1", "source": "chat", "output": "overlay_large", "error_code": "MESSAGE_OUTPUT_FAILED" })
    );
    // The chatbox still got it.
    assert!(run.chatbox_text(Duration::from_secs(5)).is_some());

    let overlay = overlays.lock().unwrap()[0].clone();
    assert_eq!((overlay.log, overlay.direction), (OverlayLog::Large, "send"));
    assert_eq!(overlay.translations, ["deepl-free:EN-US:こんにちは"]);
    let spoken = spoken.lock().unwrap().clone();
    assert_eq!(spoken.iter().map(|s| s.stage).collect::<Vec<_>>(), [SpeechStage::Original, SpeechStage::Translated]);
    assert_eq!(spoken[1].translations, ["deepl-free:EN-US:こんにちは"]);
    assert_eq!(spoken[1].provenance, ["translated"]);
    run.ui.stop();
}

#[test]
fn the_chat_providers_get_the_recent_conversation() {
    let run = start(json!({}), None);
    let key = format!("gsk{}", "q".repeat(40));
    run.fake.key("/groq/v1", &key).models("/groq/v1", &["llama"]);
    assert_eq!(run.ui.ok("/set/data/groq_auth_key", Some(json!(key))), json!(key));
    let mut engines = run.ui.ok("/get/data/selected_translation_engines", None);
    engines["1"] = json!("Groq_API");
    run.ui.ok("/set/data/selected_translation_engines", Some(engines));
    assert_eq!(run.ui.ok("/set/enable/translation", None), true);

    run.chat("m-1", "最初の話");
    run.chat("m-2", "次の話");
    let sent = run.fake.seen_under("/groq/v1/chat").pop().unwrap();
    let system = sent.body["messages"][0]["content"].as_str().unwrap();
    assert!(system.contains("][chat] 最初の話\n"), "{system}");
    assert!(!system.contains("次の話"), "the message itself is not history");
    // A new destination starts a new history.
    run.ui.ok("/set/disable/translation", None);
    run.ui.ok("/set/enable/translation", None);
    run.chat("m-3", "三つ目");
    let sent = run.fake.seen_under("/groq/v1/chat").pop().unwrap();
    assert!(!sent.body["messages"][0]["content"].as_str().unwrap().contains("最初の話"));
    run.ui.stop();
}

#[test]
fn a_message_still_being_translated_at_shutdown_goes_nowhere() {
    // `test_message_delivery_revocation.py` (`shutdown_revokes_all_sources_before_cleanup`,
    // `shutdown_closes_new_message_admission`).
    let run = start(json!({ "LOGGER_FEATURE": true }), None);
    let (status, stream) = websocket("127.0.0.1", run.websocket_port, Some("test-token"));
    assert_eq!(status, 101);
    let mut stream = stream.unwrap();
    run.translate_with_deepl();
    let (release, held) = std::sync::mpsc::channel::<()>();
    let held = Mutex::new(held);
    run.fake.reply(move |_, _, _| {
        let _ = held.lock().unwrap().recv_timeout(Duration::from_secs(10));
        None
    });
    let before = run.fake.seen_under("/deepl-free/v2/translate").len();
    let mark = run.ui.send("/run/send_message_box", Some(json!({ "id": "m-1", "message": "まだ訳している" })));
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while run.fake.seen_under("/deepl-free/v2/translate").len() == before {
        assert!(std::time::Instant::now() < deadline, "the translation never started");
        std::thread::sleep(Duration::from_millis(10));
    }
    run.ui.send("/run/shutdown", None);
    std::thread::sleep(Duration::from_millis(200));
    release.send(()).unwrap();

    let answer = run.ui.wait_endpoint(mark, "/run/send_message_box");
    assert_eq!(answer["result"], Value::Null, "{answer}");
    assert!(run.chatbox_text(Duration::from_millis(500)).is_none(), "the chatbox got it");
    assert!(read_text(&mut stream, Duration::from_millis(300)).is_none(), "WebSocket got it");
    assert!(!run.conversation_log().contains("まだ訳している"), "the conversation log got it");
    // A message after shutdown is not taken.
    assert_eq!(run.ui.request("/run/send_message_box", Some(json!({ "id": "m-2", "message": "後から" })))["result"], Value::Null);
    assert!(run.chatbox_text(Duration::from_millis(300)).is_none());
    run.ui.stop();
}

#[test]
fn the_conversation_history_starts_again_when_the_translation_goes_elsewhere() {
    // `test_translation_history_destination.py`.
    let run = start(json!({}), None);
    let key = format!("gsk{}", "q".repeat(40));
    run.fake.key("/groq/v1", &key).models("/groq/v1", &["llama"]);
    assert_eq!(run.ui.ok("/set/data/groq_auth_key", Some(json!(key))), json!(key));
    let groq = |run: &Run| {
        let mut engines = run.ui.ok("/get/data/selected_translation_engines", None);
        engines["1"] = json!("Groq_API");
        run.ui.ok("/set/data/selected_translation_engines", Some(engines));
    };
    groq(&run);
    assert_eq!(run.ui.ok("/set/enable/translation", None), true);
    let history = |run: &Run| -> String {
        let sent = run.fake.seen_under("/groq/v1/chat").pop().unwrap();
        sent.body["messages"][0]["content"].as_str().unwrap().to_string()
    };

    run.chat("m-1", "一つ目");
    // Saving the same engine again keeps the history.
    groq(&run);
    run.chat("m-2", "二つ目");
    assert!(history(&run).contains("][chat] 一つ目\n"), "{}", history(&run));

    // Another engine and back: the history went with the other engine's turn.
    let mut engines = run.ui.ok("/get/data/selected_translation_engines", None);
    engines["1"] = json!("DeepL_API");
    run.ui.ok("/set/data/selected_translation_engines", Some(engines));
    groq(&run);
    run.chat("m-3", "三つ目");
    let after_switch = history(&run);
    assert!(!after_switch.contains("一つ目") && !after_switch.contains("二つ目"), "{after_switch}");

    // Another tab and back: the same.
    run.chat("m-4", "四つ目");
    assert!(history(&run).contains("][chat] 三つ目\n"), "{}", history(&run));
    run.ui.ok("/set/data/selected_tab_no", Some(json!("2")));
    run.ui.ok("/set/data/selected_tab_no", Some(json!("1")));
    run.chat("m-5", "五つ目");
    let after_tab = history(&run);
    assert!(!after_tab.contains("三つ目") && !after_tab.contains("四つ目"), "{after_tab}");
    // The history never reaches the diagnostic log.
    assert!(!run.process_log().contains("つ目"));
    run.ui.stop();
}

#[test]
fn the_conversation_log_is_written_only_while_it_is_on() {
    // `test_conversation_logger.py` through the endpoints.
    let run = start(json!({}), None);
    run.chat("m-1", "記録しない");
    assert_eq!(run.ui.ok("/set/enable/logger_feature", None), true);
    run.chat("m-2", "記録する");
    assert_eq!(run.ui.ok("/set/disable/logger_feature", None), false);
    run.chat("m-3", "また記録しない");
    let log = run.conversation_log();
    assert!(log.contains("[CHAT] 記録する\n"), "{log}");
    assert!(!log.contains("記録しない"), "{log}");
    // On again: a new file of its own.
    std::thread::sleep(Duration::from_millis(1100));
    assert_eq!(run.ui.ok("/set/enable/logger_feature", None), true);
    run.chat("m-4", "二度目");
    let files: Vec<String> =
        run.logs().into_iter().filter(|(name, _)| name.starts_with("20")).map(|(_, text)| text).collect();
    assert_eq!(files.len(), 2, "{files:?}");
    assert!(files.iter().any(|text| text.contains("二度目") && !text.contains("記録する")), "{files:?}");
    run.ui.stop();
}
