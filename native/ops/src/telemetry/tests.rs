//! Usage events as the receiver takes them, against a stand-in that keeps the receiver's rules
//! (`tests/voice/test_telemetry_client.py` and `src-python/test/test_telemetry.py`).
//!
//! The receiver's contract: POST /v1/events with X-Ingest-Key; only "app_started" and "error"
//! are taken, and "error" needs error_code matching [A-Za-z0-9_.-]{1,64}. It answers 200
//! {"ok": true, "accepted": N}, 401 without the key. Nothing here leaves the PC, and nothing
//! asks the real hardware.

use std::net::TcpListener;
use std::sync::Mutex;

use super::client::{valid_error_code, INGEST_KEY, TIMEOUT};
use super::hardware::Gpu;
use super::*;
use crate::testing::{answer, serve, Server};

struct Receiver {
    server: Server,
    accepted: Arc<Mutex<Vec<Json>>>,
}

impl Receiver {
    fn new(delay: Duration) -> Receiver {
        let accepted = Arc::new(Mutex::new(Vec::new()));
        let taken = accepted.clone();
        let server = serve(move |request, stream| {
            thread::sleep(delay);
            if request.path != "/v1/events" {
                return answer(stream, 404, &[], br#"{"ok": false}"#);
            }
            if request.header("X-Ingest-Key") != Some(INGEST_KEY) {
                return answer(stream, 401, &[], br#"{"ok": false, "error": "unauthorized"}"#);
            }
            let Ok(event) = Json::parse_slice(&request.body) else { return answer(stream, 400, &[], br#"{"ok": false}"#) };
            let ok = match event.get("event").and_then(Json::as_str) {
                Some("app_started") => true,
                Some("error") => event.get("error_code").and_then(Json::as_str).is_some_and(valid_error_code),
                _ => false,
            };
            if ok {
                taken.lock().unwrap().push(event);
            }
            answer(stream, 200, &[], format!(r#"{{"ok": true, "accepted": {}}}"#, u8::from(ok)).as_bytes());
        });
        Receiver { server, accepted }
    }

    fn url(&self) -> String {
        self.server.url("/v1/events")
    }

    fn accepted(&self) -> Vec<Json> {
        self.accepted.lock().unwrap().clone()
    }
}

fn hardware() -> Hardware {
    Hardware {
        cpu: Some("12th Gen Intel(R) Core(TM) i7-1255U".into()),
        cores: Some(12),
        ram_gb: Some(32),
        gpus: Some(vec![
            Gpu { name: "Intel(R) Iris(R) Xe Graphics".into(), kind: "igpu".into(), vram_gb: Some(16), driver: Some("32.0.101.7085".into()) },
            Gpu { name: "NVIDIA GeForce RTX 3060 Ti".into(), kind: "gpu".into(), vram_gb: Some(8), driver: Some("32.0.16.2124".into()) },
        ]),
    }
}

fn started(url: &str, key: &str, timeout: Duration, hw: Option<&Hardware>) -> IngestClient {
    let mut client = IngestClient::with(url, key, timeout);
    client.start("0.1.0-beta.7", "ja", hw);
    client
}

const BASE: [&str; 7] = ["event", "v", "timestamp", "app_version", "os", "os_version", "locale"];

fn keys(event: &Json) -> Vec<&str> {
    event.as_object().unwrap().keys().collect()
}

fn closed_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

#[test]
fn the_app_started_event_carries_where_it_came_from_and_nothing_else() {
    let target = Receiver::new(Duration::ZERO);
    let client = started(&target.url(), INGEST_KEY, TIMEOUT, Some(&hardware()));
    let (body, taken) = client.track("app_started", None);
    assert!(taken);
    let requests = target.server.requests();
    let request = &requests[0];
    let event = Json::parse_slice(&request.body).unwrap();
    // What track() hands back for the record is what went out, key order included.
    assert_eq!(body.unwrap(), event);
    assert_eq!((request.method.as_str(), request.path.as_str()), ("POST", "/v1/events"));
    assert_eq!(keys(&event), [&BASE[..], &["hw"]].concat());
    assert_eq!(event.get("event"), Some(&Json::from("app_started")));
    assert_eq!(event.get("app_version"), Some(&Json::from("0.1.0-beta.7")));
    assert_eq!(event.get("locale"), Some(&Json::from("ja-JP")));
    assert_eq!(event.get("v"), Some(&Json::from(2u64)));
    assert_eq!(event.get("hw"), Some(&hardware().to_json()));
    let stamp = event.get("timestamp").unwrap().as_str().unwrap();
    let sent_at = chrono::NaiveDateTime::parse_from_str(stamp, "%Y-%m-%dT%H:%M:%SZ").unwrap().and_utc();
    assert!((chrono::Utc::now() - sent_at).num_seconds().abs() < 60);
    // No cookie, credential or identifier: only what HTTP needs, the key and the app's name,
    // exactly as http.client sent them.
    let headers: Vec<(&str, &str)> = request.headers.iter().map(|(n, v)| (n.as_str(), v.as_str())).collect();
    let length = request.body.len().to_string();
    let host = format!("127.0.0.1:{}", target.server.port);
    assert_eq!(
        headers,
        [("Host", host.as_str()), ("Accept-Encoding", "identity"), ("Content-Type", "application/json"), ("Content-Length", length.as_str()), ("X-Ingest-Key", INGEST_KEY), ("User-Agent", "VRCT-VOX")]
    );
    // json.dumps(ensure_ascii=True, separators=(",", ":")).
    assert!(request.body.is_ascii() && !request.body.windows(2).any(|w| w == b", " || w == b": "));
    assert_eq!(target.accepted(), [event]);
}

#[test]
fn an_error_event_is_its_fixed_code_and_the_same_surroundings() {
    let target = Receiver::new(Duration::ZERO);
    let client = started(&target.url(), INGEST_KEY, TIMEOUT, None);
    assert!(client.track("error", Some("VRAM_ERROR")).1);
    let event = &target.accepted()[0];
    // Without hardware to name, the event simply has no "hw".
    assert_eq!(keys(event), [&BASE[..], &["error_code"]].concat());
    assert_eq!(event.get("error_code"), Some(&Json::from("VRAM_ERROR")));
}

#[test]
fn anything_but_the_two_events_is_not_sent_at_all() {
    let target = Receiver::new(Duration::ZERO);
    let client = started(&target.url(), INGEST_KEY, TIMEOUT, None);
    for (name, code) in [("error", None), ("error", Some("")), ("error", Some("has space")), ("error", Some("x".repeat(65).as_str())), ("message_sent", None), ("", None)] {
        assert_eq!(client.track(name, code), (None, false));
    }
    assert!(target.server.requests().is_empty());
}

#[test]
fn nothing_is_sent_before_start_or_after_stop() {
    let target = Receiver::new(Duration::ZERO);
    let mut client = IngestClient::with(&target.url(), INGEST_KEY, TIMEOUT);
    assert_eq!(client.track("app_started", None), (None, false));
    client.start("1.0", "en", None);
    client.stop();
    assert_eq!(client.track("app_started", None), (None, false));
    assert!(target.server.requests().is_empty());
}

#[test]
fn a_receiver_that_refuses_fails_or_stalls_only_means_the_event_was_not_sent() {
    let refused = Receiver::new(Duration::ZERO);
    assert!(!started(&refused.url(), "wrong", TIMEOUT, None).track("app_started", None).1);
    assert_eq!(refused.server.requests().len(), 1);
    assert!(refused.accepted().is_empty());
    let slow = Receiver::new(Duration::from_secs(3));
    let began = Instant::now();
    assert!(!started(&slow.url(), INGEST_KEY, Duration::from_millis(300), None).track("app_started", None).1);
    assert!(began.elapsed() < Duration::from_secs(2));
    // The event that did not arrive is still handed back, so the record can say so.
    let (body, taken) = started(&format!("http://127.0.0.1:{}/v1/events", closed_port()), INGEST_KEY, Duration::from_secs(1), None).track("app_started", None);
    assert!(!taken && body.unwrap().get("event") == Some(&Json::from("app_started")));
}

fn telemetry_for(url: &str, hw: Option<Hardware>, delay: Duration) -> Telemetry {
    let telemetry = Telemetry::new(IngestClient::with(url, INGEST_KEY, TIMEOUT));
    telemetry.set_hardware_source(Arc::new(move || {
        thread::sleep(delay);
        hw.clone()
    }));
    telemetry
}

fn seen(target: &Receiver) -> Vec<(String, Option<String>, String)> {
    target
        .accepted()
        .iter()
        .map(|e| {
            let text = |k: &str| e.get(k).and_then(Json::as_str).map(str::to_string);
            (text("event").unwrap(), text("error_code"), text("locale").unwrap())
        })
        .collect()
}

#[test]
fn the_whole_module_sends_once_a_day_and_nothing_when_off() {
    let target = Receiver::new(Duration::ZERO);
    let dir = tempfile::tempdir().unwrap();
    let storage = dir.path().join("telemetry_state.json");
    let telemetry = telemetry_for(&target.url(), Some(hardware()), Duration::ZERO);
    telemetry.init(true, "0.1.0-beta.7", Some(&storage), "ja");
    telemetry.track_error("VRAM_ERROR");
    telemetry.track_error("VRAM_ERROR");
    assert!(telemetry.settle(Duration::from_secs(8)));
    assert_eq!(seen(&target), [("app_started".into(), None, "ja-JP".into()), ("error".into(), Some("VRAM_ERROR".into()), "ja-JP".into())]);
    // Both carry the same hardware: an error can be set against the PCs that started.
    assert!(target.accepted().iter().all(|e| e.get("hw") == Some(&hardware().to_json())));
    telemetry.shutdown();
    // The same day, another start: nothing new.
    let again = telemetry_for(&target.url(), Some(hardware()), Duration::ZERO);
    again.init(true, "0.1.0-beta.7", Some(&storage), "ja");
    again.track_error("VRAM_ERROR");
    assert!(again.settle(Duration::from_secs(8)));
    assert_eq!(seen(&target).len(), 2);
    again.shutdown();
    // Turned off: nothing, whatever happens.
    let off = telemetry_for(&target.url(), Some(hardware()), Duration::ZERO);
    off.init(false, "0.1.0-beta.7", Some(&dir.path().join("other.json")), "ja");
    off.track_error("DEVICE_NO_MIC");
    assert!(off.settle(Duration::from_secs(8)));
    assert_eq!(seen(&target).len(), 2);
    assert!(!off.is_enabled());
}

#[test]
fn a_second_init_only_switches_and_sends_app_started_once() {
    let target = Receiver::new(Duration::ZERO);
    let dir = tempfile::tempdir().unwrap();
    let telemetry = telemetry_for(&target.url(), None, Duration::ZERO);
    telemetry.init(true, "1.0", Some(&dir.path().join("s.json")), "en");
    telemetry.init(true, "1.0", Some(&dir.path().join("s.json")), "en");
    assert!(telemetry.settle(Duration::from_secs(8)));
    assert_eq!(seen(&target).len(), 1);
    telemetry.init(false, "1.0", None, "en");
    assert!(!telemetry.is_enabled());
    telemetry.track_error("X");
    assert!(telemetry.settle(Duration::from_secs(8)));
    assert_eq!(seen(&target).len(), 1);
    telemetry.shutdown();
}

#[test]
fn starting_does_not_wait_for_the_hardware_or_the_network() {
    let target = Receiver::new(Duration::from_secs(1));
    let dir = tempfile::tempdir().unwrap();
    let telemetry = telemetry_for(&target.url(), Some(hardware()), Duration::from_millis(500));
    let began = Instant::now();
    telemetry.init(true, "0.1.0-beta.7", Some(&dir.path().join("state.json")), "ja");
    // An error right away, before the hardware is known: it waits for it instead of going without.
    telemetry.track_error("VRAM_ERROR");
    assert!(began.elapsed() < Duration::from_millis(400));
    assert!(telemetry.settle(Duration::from_secs(8)));
    let events: Vec<(String, bool)> = target.accepted().iter().map(|e| (e.get("event").unwrap().as_str().unwrap().to_string(), e.get("hw") == Some(&hardware().to_json()))).collect();
    assert_eq!(events, [("app_started".to_string(), true), ("error".to_string(), true)]);
    telemetry.shutdown();
}

fn timeless(event: &Json) -> Object {
    let mut object = event.as_object().unwrap().clone();
    object.remove("timestamp");
    object
}

#[test]
fn what_the_user_is_shown_is_what_is_sent_and_what_was_sent_is_kept() {
    let target = Receiver::new(Duration::ZERO);
    let dir = tempfile::tempdir().unwrap();
    let storage = dir.path().join("telemetry_state.json");
    let telemetry = telemetry_for(&target.url(), Some(hardware()), Duration::ZERO);
    telemetry.state().set_storage_path(&storage);
    // Before anything is sent, and without sending anything by asking.
    let shown = telemetry.preview("0.1.0-beta.7", "ja");
    assert!(target.server.requests().is_empty());
    assert_eq!(keys(&shown), ["endpoint", "app_started", "sent"]);
    assert_eq!(shown.get("sent"), Some(&Json::Array(vec![])));
    assert_eq!(shown.get("endpoint"), Some(&Json::from(target.url())));
    telemetry.init(true, "0.1.0-beta.7", Some(&storage), "ja");
    telemetry.track_error("speech_server_out_of_memory");
    assert!(telemetry.settle(Duration::from_secs(8)));
    let accepted = target.accepted();
    let (started_event, error_event) = (&accepted[0], &accepted[1]);
    let shown_event = shown.get("app_started").unwrap();
    // Field for field what the notice showed; only the time is the moment of sending.
    assert_eq!(keys(shown_event), keys(started_event));
    assert_eq!(timeless(shown_event), timeless(started_event));
    let stamp = |e: &Json| e.get("timestamp").unwrap().as_str().unwrap().to_string();
    assert!(stamp(shown_event) <= stamp(started_event) && stamp(started_event) <= stamp(error_event));
    let expected_error = timeless(started_event).with("event", "error").with("error_code", "speech_server_out_of_memory");
    assert!(timeless(error_event).same_as(&expected_error));
    let sent = telemetry.preview("0.1.0-beta.7", "ja").get("sent").unwrap().clone();
    let rows = sent.as_array().unwrap();
    // The record is the event exactly as it went out, time and key order included.
    assert_eq!(
        rows.iter().map(|r| (r.get("body").unwrap().clone(), r.get("accepted").unwrap().clone())).collect::<Vec<_>>(),
        [(started_event.clone(), Json::Bool(true)), (error_event.clone(), Json::Bool(true))]
    );
    telemetry.shutdown();
    // The record outlives the app, and a later start reads it back.
    let later = telemetry_for(&target.url(), None, Duration::ZERO);
    later.state().set_storage_path(&storage);
    assert_eq!(later.preview("0.1.0-beta.7", "ja").get("sent"), Some(&sent));
}

#[test]
fn an_event_that_did_not_arrive_is_recorded_as_such() {
    let dir = tempfile::tempdir().unwrap();
    let telemetry = telemetry_for(&format!("http://127.0.0.1:{}/v1/events", closed_port()), None, Duration::ZERO);
    telemetry.init(true, "0.1.0-beta.7", Some(&dir.path().join("state.json")), "ja");
    assert!(telemetry.settle(Duration::from_secs(15)));
    let sent = telemetry.state().sent();
    assert_eq!(sent.len(), 1);
    assert!(!sent[0].accepted && sent[0].body.get("event") == Some(&Json::from("app_started")));
    // Tried is counted as sent for the day, as before.
    assert!(!telemetry.state().should_send_app_started_today());
    telemetry.shutdown();
}

#[test]
fn after_it_is_stopped_an_error_is_neither_sent_nor_counted_as_sent() {
    let target = Receiver::new(Duration::ZERO);
    let dir = tempfile::tempdir().unwrap();
    let telemetry = telemetry_for(&target.url(), None, Duration::ZERO);
    telemetry.init(true, "0.1.0-beta.7", Some(&dir.path().join("state.json")), "ja");
    assert!(telemetry.settle(Duration::from_secs(8)));
    telemetry.shutdown();
    telemetry.track_error("VRAM_ERROR");
    assert!(!telemetry.is_enabled() && telemetry.state().should_send_error_today("VRAM_ERROR"));
    assert_eq!(seen(&target).len(), 1);
}

#[test]
fn shutdown_does_not_wait_for_a_stalled_receiver_beyond_its_limit() {
    let target = Receiver::new(Duration::from_secs(30));
    let dir = tempfile::tempdir().unwrap();
    let telemetry = Telemetry::new(IngestClient::with(&target.url(), INGEST_KEY, Duration::from_secs(30)));
    telemetry.init(true, "1.0", Some(&dir.path().join("state.json")), "en");
    let end = Instant::now() + Duration::from_secs(2);
    while target.server.requests().is_empty() && Instant::now() < end {
        thread::sleep(Duration::from_millis(5));
    }
    let began = Instant::now();
    telemetry.shutdown();
    assert!(began.elapsed() < STOP_WAIT + Duration::from_secs(1));
    // The post in flight is never recorded once stopped.
    assert!(telemetry.state().sent().is_empty());
}

#[test]
fn the_debug_state_names_the_record() {
    let dir = tempfile::tempdir().unwrap();
    let telemetry = Telemetry::new(IngestClient::with("", INGEST_KEY, TIMEOUT));
    let path = dir.path().join("s.json");
    telemetry.init(true, "1.0", Some(&path), "en");
    let state = telemetry.debug_state();
    assert_eq!(keys(&state), ["enabled", "storage_path", "last_app_started_date", "errors_sent"]);
    assert_eq!(state.get("storage_path"), Some(&Json::from(path.to_string_lossy().into_owned())));
    // Without an endpoint nothing is posted, and the preview says where: nowhere.
    assert_eq!(telemetry.preview("1.0", "en").get("endpoint"), Some(&Json::Null));
    telemetry.shutdown();
}
