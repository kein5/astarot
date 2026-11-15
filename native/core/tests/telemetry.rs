//! The usage events over the connection the UI uses (the controller side of
//! `tests/voice/test_telemetry_client.py` and `src-python/test/test_telemetry.py`).
//!
//! Every test has its own receiver on 127.0.0.1, so nothing leaves the PC; the hardware in the
//! events comes from the system alone (no speech.cpp is run).

mod common;

use common::{Setup, Ui};
use serde_json::{Value, json};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vrct_core::controller::Services;
use vrct_ops::telemetry::Telemetry;
use vrct_ops::telemetry::client::{INGEST_KEY, IngestClient};

/// A stand-in for the receiver: it keeps every event posted to it and accepts it.
struct Receiver {
    url: String,
    events: Arc<Mutex<Vec<Value>>>,
}

impl Receiver {
    fn start() -> Receiver {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}/v1/events", listener.local_addr().unwrap().port());
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&events);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let seen = Arc::clone(&seen);
                std::thread::spawn(move || handle(stream, &seen));
            }
        });
        Receiver { url, events }
    }

    fn events(&self) -> Vec<Value> {
        self.events.lock().unwrap().clone()
    }

    fn named(&self, name: &str) -> Vec<Value> {
        self.events().into_iter().filter(|e| e["event"] == name).collect()
    }

    fn wait_for(&self, what: &str, matches: impl Fn(&Value) -> bool) -> Value {
        let deadline = Instant::now() + common::TIMEOUT;
        loop {
            if let Some(event) = self.events().into_iter().find(|e| matches(e)) {
                return event;
            }
            assert!(Instant::now() < deadline, "no {what}; got {:?}", self.events());
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

fn handle(mut stream: TcpStream, seen: &Mutex<Vec<Value>>) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            break end;
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => buffer.extend_from_slice(&chunk[..n]),
        }
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).to_lowercase();
    let length = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
    let mut body = buffer[head_end + 4..].to_vec();
    while body.len() < length {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => body.extend_from_slice(&chunk[..n]),
        }
    }
    if let Ok(event) = serde_json::from_slice::<Value>(&body) {
        seen.lock().unwrap().push(event);
    }
    let answer = br#"{"ok": true, "accepted": 1}"#;
    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", answer.len());
    let _ = stream.write_all(answer);
}

struct Run {
    ui: Ui,
    receiver: Receiver,
}

fn start(saved: Value, forced_off: bool) -> Run {
    let receiver = Receiver::start();
    let url = receiver.url.clone();
    let forced = Arc::new(AtomicBool::new(forced_off));
    let services = Services {
        telemetry: Arc::new(move || Telemetry::new(IngestClient::with(&url, INGEST_KEY, Duration::from_secs(5)))),
        telemetry_forced_off: Arc::new(move || forced.load(Ordering::SeqCst)),
        speech_binary: Arc::new(|_| Err("no speech.cpp in the tests".into())),
        ..Services::default()
    };
    let ui = Ui::with(Setup { saved: Some(saved), services, ..Setup::default() });
    ui.ready();
    Run { ui, receiver }
}

/// Long enough for a send that was wrongly started to arrive.
fn settle() {
    std::thread::sleep(Duration::from_millis(400));
}

fn notice(ui: &Ui) -> Value {
    ui.ok("/get/data/telemetry_notice", None)
}

fn config(ui: &Ui, key: &str) -> Value {
    ui.backend.core().config().get(key)
}

/// Makes the backend report an error code, as any failing request does.
fn cause_error(ui: &Ui, endpoint: &str, code: &str) {
    let answer = ui.request(endpoint, Some(json!(-1)));
    assert_eq!(common::error_code(&answer), code, "{answer}");
}

#[test]
fn nothing_is_sent_until_the_user_has_answered_the_notice() {
    // On by default, and still nothing may be sent: the notice is pending.
    let run = start(json!({}), false);
    let ui = &run.ui;
    assert_eq!(notice(ui), json!({ "pending": true, "enabled": true }));
    // Turning the setting on is not consent (SEC-07).
    assert_eq!(ui.ok("/set/enable/telemetry", None), true);
    assert_eq!(notice(ui), json!({ "pending": true, "enabled": true }));
    cause_error(ui, "/set/data/mic_max_phrases", "VALIDATION_MIC_MAX_PHRASES");
    settle();
    assert!(run.receiver.events().is_empty(), "{:?}", run.receiver.events());
    run.ui.stop();

    // A settings file from before the notice carries "off" that nobody chose: it is asked all the same.
    let run = start(json!({ "ENABLE_TELEMETRY": false }), false);
    assert_eq!(notice(&run.ui), json!({ "pending": true, "enabled": false }));
    settle();
    assert!(run.receiver.events().is_empty());
    run.ui.stop();
}

#[test]
fn the_preview_shows_what_would_be_sent_without_sending_or_answering() {
    let run = start(json!({}), false);
    let ui = &run.ui;
    let preview = ui.ok("/get/data/telemetry_preview", None);
    assert_eq!(preview["endpoint"], run.receiver.url.as_str());
    let event = &preview["app_started"];
    assert_eq!((event["event"].clone(), event["app_version"].clone(), event["locale"].clone()), (json!("app_started"), json!(common::VERSION), json!("en-US")));
    assert!(event.get("error_code").is_none());
    assert_eq!(preview["sent"], json!([]));
    // Asking is not an answer to the notice and starts nothing.
    assert_eq!(notice(ui)["pending"], true);
    settle();
    assert!(run.receiver.events().is_empty());
    // It is not part of the start-up snapshot either.
    assert!(ui.ready().get("/get/data/telemetry_preview").is_none());
    run.ui.stop();
}

#[test]
fn answering_send_starts_sending_and_error_codes_reach_the_receiver() {
    for before in [true, false] {
        let run = start(json!({ "ENABLE_TELEMETRY": before }), false);
        let ui = &run.ui;
        assert_eq!(ui.ok("/set/data/telemetry_notice", Some(json!({ "send": true }))), json!({ "pending": false, "enabled": true }));
        let started = run.receiver.wait_for("app_started", |e| e["event"] == "app_started");
        let keys: Vec<&str> = started.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(&keys[..4], ["event", "v", "timestamp", "app_version"]);
        assert_eq!((started["app_version"].clone(), started["locale"].clone()), (json!(common::VERSION), json!("en-US")));
        // An error code the backend answers with is sent once a day.
        cause_error(ui, "/set/data/mic_threshold", "VALIDATION_MIC_THRESHOLD");
        cause_error(ui, "/set/data/mic_threshold", "VALIDATION_MIC_THRESHOLD");
        run.receiver.wait_for("the error", |e| e["event"] == "error" && e["error_code"] == "VALIDATION_MIC_THRESHOLD");
        settle();
        let errors = run.receiver.named("error").into_iter().filter(|e| e["error_code"] == "VALIDATION_MIC_THRESHOLD").count();
        assert_eq!(errors, 1);
        // What was sent is shown afterwards.
        let sent = ui.ok("/get/data/telemetry_preview", None)["sent"].clone();
        assert!(sent.as_array().unwrap().iter().any(|row| row["body"]["event"] == "app_started"), "{sent}");
        // The answer is saved at once.
        assert_eq!(ui.saved()["TELEMETRY_NOTICE"], 1);
        assert_eq!(config(ui, "ENABLE_TELEMETRY"), true);
        run.ui.stop();
    }
}

#[test]
fn answering_no_sends_nothing_and_is_kept() {
    for before in [true, false] {
        let run = start(json!({ "ENABLE_TELEMETRY": before }), false);
        let ui = &run.ui;
        assert_eq!(ui.ok("/set/data/telemetry_notice", Some(json!({ "send": false }))), json!({ "pending": false, "enabled": false }));
        settle();
        assert!(run.receiver.events().is_empty());
        assert_eq!(ui.saved()["TELEMETRY_NOTICE"], 1);
        assert_eq!(ui.ok("/get/data/telemetry", None), false);
        run.ui.stop();
    }
}

#[test]
fn an_answer_that_is_not_a_plain_yes_or_no_changes_nothing() {
    let run = start(json!({}), false);
    let ui = &run.ui;
    for data in [None, Some(json!({})), Some(json!({ "send": "yes" })), Some(json!({ "send": 1 })), Some(json!({ "send": true, "extra": 1 })), Some(json!([true])), Some(json!("true"))] {
        let answer = ui.request("/set/data/telemetry_notice", data.clone());
        assert_eq!((answer["status"].clone(), answer["result"].clone()), (json!(400), json!({ "error_code": "telemetry_notice_invalid" })), "{data:?}");
    }
    assert_eq!(config(ui, "TELEMETRY_NOTICE"), 0);
    assert_eq!(notice(ui), json!({ "pending": true, "enabled": true }));
    settle();
    assert!(run.receiver.events().is_empty());
    run.ui.stop();
}

#[test]
fn the_environment_can_turn_it_off_for_good_and_then_nothing_is_asked_either() {
    // VRCT_TELEMETRY=off, through the hook that reads it (its parsing is a unit test).
    let run = start(json!({ "ENABLE_TELEMETRY": true, "TELEMETRY_NOTICE": 1 }), true);
    let ui = &run.ui;
    assert_eq!(notice(ui)["pending"], false);
    // Even an answer of "send", or the switch in the settings, starts nothing.
    ui.ok("/set/data/telemetry_notice", Some(json!({ "send": true })));
    ui.ok("/set/enable/telemetry", None);
    cause_error(ui, "/set/data/speaker_max_phrases", "VALIDATION_SPEAKER_MAX_PHRASES");
    // The preview still answers.
    assert_eq!(ui.ok("/get/data/telemetry_preview", None)["app_started"]["event"], "app_started");
    settle();
    assert!(run.receiver.events().is_empty(), "{:?}", run.receiver.events());
    run.ui.stop();
}

#[test]
fn an_answered_notice_starts_sending_at_start_up() {
    let run = start(json!({ "ENABLE_TELEMETRY": true, "TELEMETRY_NOTICE": 1 }), false);
    run.receiver.wait_for("app_started", |e| e["event"] == "app_started");
    run.ui.stop();

    let run = start(json!({ "ENABLE_TELEMETRY": false, "TELEMETRY_NOTICE": 1 }), false);
    settle();
    assert!(run.receiver.events().is_empty());
    run.ui.stop();
}

#[test]
fn turning_it_off_answers_the_notice_and_afterwards_the_switch_works() {
    let run = start(json!({}), false);
    let ui = &run.ui;
    assert_eq!(ui.ok("/set/disable/telemetry", None), false);
    assert_eq!(notice(ui), json!({ "pending": false, "enabled": false }));
    settle();
    assert!(run.receiver.events().is_empty());
    assert_eq!(ui.ok("/set/enable/telemetry", None), true);
    run.receiver.wait_for("app_started", |e| e["event"] == "app_started");
    run.ui.stop();
}

#[test]
fn nothing_is_sent_after_shutdown() {
    let run = start(json!({ "ENABLE_TELEMETRY": true, "TELEMETRY_NOTICE": 1 }), false);
    let ui = &run.ui;
    run.receiver.wait_for("app_started", |e| e["event"] == "app_started");
    assert_eq!(ui.ok("/run/shutdown", None), true);
    cause_error(ui, "/set/data/speaker_threshold", "VALIDATION_SPEAKER_THRESHOLD");
    settle();
    assert!(run.receiver.events().iter().all(|e| e["error_code"] != "VALIDATION_SPEAKER_THRESHOLD"), "{:?}", run.receiver.events());
    run.ui.stop();
}
