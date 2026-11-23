//! The request rules of `docs/spec/ipc-protocol.md` ("並行性とロック"), on the dispatcher with
//! handlers that block on purpose.

use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use astarot_core::dispatch::{Dispatcher, Output, Routes};
use astarot_core::protocol::{Reply, encode_data, request_line};

#[derive(Default)]
struct Lines(Mutex<Vec<(u16, Option<String>, Value, Instant)>>);

impl Output for Lines {
    fn answer(&self, status: u16, endpoint: Option<&str>, result: &Value) {
        self.0.lock().unwrap().push((status, endpoint.map(str::to_string), result.clone(), Instant::now()));
    }
    fn received(&self, _: &str, _: &Value) {}
    fn note(&self, _: &str) {}
}

impl Lines {
    fn wait(&self, count: usize) -> Vec<(u16, Option<String>, Value, Instant)> {
        let deadline = Instant::now() + Duration::from_secs(40);
        loop {
            let lines = self.0.lock().unwrap().clone();
            if lines.len() >= count || Instant::now() > deadline {
                return lines;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

fn dispatcher(routes: Routes) -> (Arc<Dispatcher>, Arc<Lines>) {
    let lines = Arc::new(Lines::default());
    let dispatcher = Dispatcher::new(routes, lines.clone(), None);
    dispatcher.start(3);
    (dispatcher, lines)
}

#[test]
fn an_unknown_endpoint_answers_404() {
    let (dispatcher, lines) = dispatcher(Routes::new());
    dispatcher.receive_line(&request_line("/get/data/nothing", None));
    let lines = lines.wait(1);
    assert_eq!((lines[0].0, lines[0].2.clone()), (404, json!("Invalid endpoint")));
    dispatcher.stop(Duration::from_secs(1));
}

#[test]
fn a_failed_typed_message_names_its_row_and_never_echoes_the_text() {
    let mut routes = Routes::new();
    routes.add("/run/send_message_box", false, |data| {
        if data["message"] == json!("panic") {
            panic!("handler failed on purpose");
        }
        Reply::ok(json!(true))
    });
    let (dispatcher, lines) = dispatcher(routes);
    dispatcher.receive_line(&request_line("/run/send_message_box", Some(&json!({ "id": "row-1", "message": "panic" }))));
    let lines = lines.wait(1);
    assert_eq!((lines[0].0, lines[0].2.clone()), (500, json!({ "message": "Internal error", "data": { "id": "row-1" } })));
    dispatcher.stop(Duration::from_secs(1));

    // Without an id there is nothing to name; the plain result stays.
    let (dispatcher, lines) = self::dispatcher(Routes::new());
    dispatcher.receive_line(&request_line("/run/send_message_box", Some(&json!({ "id": "row-2", "message": "secret" }))));
    dispatcher.receive_line(&request_line("/run/send_message_box", Some(&json!({ "message": "secret" }))));
    let lines = lines.wait(2);
    assert!(lines.iter().any(|line| line.2 == json!({ "message": "Invalid endpoint", "data": { "id": "row-2" } })));
    assert!(lines.iter().any(|line| line.2 == json!("Invalid endpoint")));
    assert!(lines.iter().all(|line| !line.2.to_string().contains("secret")));
    dispatcher.stop(Duration::from_secs(1));
}

#[test]
fn data_is_decoded_and_bad_data_becomes_an_empty_object() {
    let mut routes = Routes::new();
    routes.add("/set/data/echo", false, |data| Reply::ok(data.clone()));
    let (dispatcher, lines) = dispatcher(routes);
    dispatcher.receive_line(&request_line("/set/data/echo", Some(&json!({ "a": [1, "日本"] }))));
    dispatcher.receive_line(r#"{"endpoint": "/set/data/echo", "data": "not base64!"}"#);
    dispatcher.receive_line(r#"{"endpoint": "/set/data/echo"}"#);
    dispatcher.receive_line("not json");
    dispatcher.receive_line("");
    let lines = lines.wait(3);
    let results: Vec<Value> = lines.iter().map(|l| l.2.clone()).collect();
    assert!(results.contains(&json!({ "a": [1, "日本"] })));
    assert!(results.contains(&json!({})));
    assert!(results.contains(&Value::Null));
    assert_eq!(lines.len(), 3, "a malformed or empty line is skipped without an answer");
    dispatcher.stop(Duration::from_secs(1));
}

#[test]
fn requests_under_one_lock_run_in_order_and_others_run_beside_them() {
    let order = Arc::new(Mutex::new(Vec::new()));
    let mut routes = Routes::new();
    for name in ["/set/enable/x", "/set/disable/x"] {
        let order = Arc::clone(&order);
        routes.add(name, false, move |data| {
            order.lock().unwrap().push(data.clone());
            std::thread::sleep(Duration::from_millis(80));
            Reply::ok(data.clone())
        });
    }
    routes.add("/get/data/other", false, |_| Reply::ok(json!("other")));
    let (dispatcher, lines) = dispatcher(routes);
    for i in 0..4 {
        let endpoint = if i % 2 == 0 { "/set/enable/x" } else { "/set/disable/x" };
        dispatcher.receive_line(&request_line(endpoint, Some(&json!(i))));
    }
    dispatcher.receive_line(&request_line("/get/data/other", None));
    let lines = lines.wait(5);
    assert_eq!(*order.lock().unwrap(), vec![json!(0), json!(1), json!(2), json!(3)], "enable and disable share one lock");
    assert_eq!(lines[0].1.as_deref(), Some("/get/data/other"), "another lock does not wait behind them");
    dispatcher.stop(Duration::from_secs(1));
}

#[test]
fn a_stop_of_typing_never_overtakes_its_start() {
    // [`test_mainloop_typing_order.py`]: the start and the stop of the typing indicator share a
    // lock, held until the handler ends, and keep their order while start-up is not over.
    //
    // [`test_mainloop_typing_order.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_mainloop_typing_order.py
    let order = Arc::new(Mutex::new(Vec::new()));
    let mut routes = Routes::new();
    for (name, value) in [("/run/typing_message_box", true), ("/run/stop_typing_message_box", false)] {
        let order = Arc::clone(&order);
        routes.add(name, true, move |_| {
            if value {
                // A start that takes its time: a stop on another worker must wait for it.
                std::thread::sleep(Duration::from_millis(150));
            }
            order.lock().unwrap().push(value);
            Reply::ok(json!(true))
        });
    }
    routes.add("/get/data/other", false, |_| Reply::ok(json!("other")));
    let (dispatcher, lines) = dispatcher(routes);
    for _ in 0..2 {
        dispatcher.receive_line(&request_line("/run/typing_message_box", None));
        dispatcher.receive_line(&request_line("/run/stop_typing_message_box", None));
    }
    dispatcher.receive_line(&request_line("/get/data/other", None));
    std::thread::sleep(Duration::from_millis(300));
    assert!(order.lock().unwrap().is_empty(), "nothing ran before start-up ended");
    dispatcher.open();
    let lines = lines.wait(5);
    assert_eq!(*order.lock().unwrap(), [true, false, true, false]);
    assert_eq!(lines[0].1.as_deref(), Some("/get/data/other"));
    dispatcher.stop(Duration::from_secs(1));
}

#[test]
fn an_endpoint_waiting_for_start_up_is_served_when_it_ends() {
    let mut routes = Routes::new();
    routes.add("/run/send_message_box", true, |_| Reply::ok(json!("sent")));
    routes.add("/get/data/version", false, |_| Reply::ok(json!("1")));
    let (dispatcher, lines) = dispatcher(routes);
    dispatcher.receive_line(&request_line("/run/send_message_box", Some(&json!({}))));
    dispatcher.receive_line(&request_line("/get/data/version", None));
    std::thread::sleep(Duration::from_millis(300));
    let early = lines.0.lock().unwrap().clone();
    assert_eq!(early.len(), 1, "only the open endpoint answered before start-up ended");
    assert_eq!(early[0].1.as_deref(), Some("/get/data/version"));
    dispatcher.open();
    let lines = lines.wait(2);
    assert_eq!((lines[1].0, lines[1].2.clone()), (200, json!("sent")));
    dispatcher.stop(Duration::from_secs(1));
}

#[test]
fn a_request_that_waits_for_start_up_too_long_answers_423() {
    let mut routes = Routes::new();
    routes.add("/set/enable/translation", true, |_| Reply::ok(json!(true)));
    let (dispatcher, lines) = dispatcher(routes);
    let start = Instant::now();
    dispatcher.receive_line(&request_line("/set/enable/translation", None));
    let lines = lines.wait(1);
    assert_eq!((lines[0].0, lines[0].2.clone()), (423, json!("Locked endpoint")));
    let waited = lines[0].3 - start;
    assert!(waited >= Duration::from_secs(29) && waited < Duration::from_secs(36), "about 30 s: {waited:?}");
    dispatcher.stop(Duration::from_secs(1));
}

#[test]
fn a_request_kept_from_its_lock_too_long_answers_423_without_running() {
    let runs = Arc::new(AtomicUsize::new(0));
    let mut routes = Routes::new();
    let counter = Arc::clone(&runs);
    routes.add("/run/slow", false, move |data| {
        counter.fetch_add(1, Ordering::SeqCst);
        if data == &json!("first") {
            std::thread::sleep(Duration::from_secs(21));
        }
        Reply::ok(data.clone())
    });
    let (dispatcher, lines) = dispatcher(routes);
    let start = Instant::now();
    dispatcher.receive_line(&request_line("/run/slow", Some(&json!("first"))));
    dispatcher.receive_line(&request_line("/run/slow", Some(&json!("second"))));
    let lines = lines.wait(2);
    let busy = lines.iter().find(|l| l.0 == 423).expect("the second request gave up");
    assert_eq!(busy.2, json!("Locked endpoint (busy)"));
    let waited = busy.3 - start;
    assert!(waited >= Duration::from_secs(19) && waited < Duration::from_secs(21), "about 20 s: {waited:?}");
    assert_eq!(runs.load(Ordering::SeqCst), 1, "it never ran");
    dispatcher.stop(Duration::from_secs(1));
}

#[test]
fn a_stop_request_skips_a_busy_queue() {
    let mut routes = Routes::new();
    for name in ["/run/a", "/run/b", "/run/c", "/run/d"] {
        routes.add(name, false, |_| {
            std::thread::sleep(Duration::from_millis(1500));
            Reply::ok(json!(true))
        });
    }
    routes.add("/run/stop_voice", false, |_| Reply::ok(json!("stopped")));
    let (dispatcher, lines) = dispatcher(routes);
    for name in ["/run/a", "/run/b", "/run/c", "/run/d"] {
        dispatcher.receive_line(&request_line(name, None));
    }
    std::thread::sleep(Duration::from_millis(50));
    let start = Instant::now();
    dispatcher.receive_line(&request_line("/run/stop_voice", None));
    let lines = lines.wait(1);
    assert_eq!(lines[0].1.as_deref(), Some("/run/stop_voice"));
    assert!(lines[0].3 - start < Duration::from_millis(250), "answered at once while every worker was busy");
    dispatcher.stop(Duration::from_secs(3));
}

#[test]
fn the_vr_panel_may_use_only_its_endpoints() {
    let mut routes = Routes::new();
    routes.add("/set/data/selected_tab_no", false, |d| Reply::ok(d.clone()));
    routes.add("/set/data/deepl_auth_key", false, |d| Reply::ok(d.clone()));
    let (dispatcher, lines) = dispatcher(routes);
    let relayed = |endpoint: &str, origin: &str| {
        format!(r#"{{"endpoint": "{endpoint}", "data": "{}", "origin": "{origin}"}}"#, encode_data(&json!("2")))
    };
    dispatcher.receive_line(&relayed("/set/data/selected_tab_no", "vr_panel"));
    dispatcher.receive_line(&relayed("/set/data/deepl_auth_key", "vr_panel"));
    dispatcher.receive_line(&relayed("/set/data/selected_tab_no", "elsewhere"));
    let lines = lines.wait(3);
    let refused: Vec<_> = lines.iter().filter(|l| l.0 == 403).collect();
    assert_eq!(refused.len(), 2);
    assert!(refused.iter().all(|l| l.2 == json!({ "error_code": "vr_panel_request_refused" })));
    assert!(lines.iter().any(|l| l.0 == 200 && l.1.as_deref() == Some("/set/data/selected_tab_no")));
    dispatcher.stop(Duration::from_secs(1));
}

#[test]
fn a_failing_handler_answers_500_and_the_next_request_still_runs() {
    let mut routes = Routes::new();
    routes.add("/run/broken", false, |_| panic!("broken on purpose"));
    routes.add("/get/data/fine", false, |_| Reply::ok(json!(1)));
    let (dispatcher, lines) = dispatcher(routes);
    dispatcher.receive_line(&request_line("/run/broken", None));
    dispatcher.receive_line(&request_line("/get/data/fine", None));
    let lines = lines.wait(2);
    assert!(lines.iter().any(|l| l.0 == 500 && l.2 == json!("Internal error")));
    assert!(lines.iter().any(|l| l.0 == 200));
    dispatcher.stop(Duration::from_secs(1));
}
