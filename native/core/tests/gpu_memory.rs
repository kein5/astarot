//! `/get/data/gpu_memory` (#448): the GPUs' memory for the flow panel, read in the background
//! only when asked. The reader here is a stand-in; no GPU of the PC is read.

mod common;

use common::{Setup, Ui};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use astarot_core::controller::Services;
use astarot_core::gpu_memory::{AppUsage, Gpu, Reader, UNSUPPORTED};

fn gpu() -> Gpu {
    Gpu {
        name: "Test GPU".into(),
        total: Some(8 << 30),
        used: Some(3 << 30),
        app: AppUsage { speech: 1 << 30, conversion: 512 << 20, other: 256 << 20 },
        app_shared: Some(0),
    }
}

fn start(reader: Reader) -> Ui {
    let setup = Setup::default();
    Ui::with(Setup { services: Services { gpu_memory: reader, ..setup.services }, ..Setup::default() })
}

fn until(what: &str, ui: &Ui, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let answer = ui.ok("/get/data/gpu_memory", None);
        if done(&answer) {
            return answer;
        }
        assert!(Instant::now() < deadline, "{what}: {answer}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn nothing_is_read_until_asked_and_a_slow_reading_holds_nothing_up() {
    let calls = Arc::new(AtomicUsize::new(0));
    let gate = Arc::new(Mutex::new(()));
    let held = gate.lock().unwrap();
    let (counted, waiting) = (calls.clone(), gate.clone());
    let ui = start(Arc::new(move || {
        counted.fetch_add(1, Ordering::SeqCst);
        drop(waiting.lock().unwrap());
        Ok(vec![gpu()])
    }));
    let snapshot = ui.ready();
    assert!(snapshot.get("/get/data/gpu_memory").is_none(), "not in the start-up snapshot");
    assert_eq!(calls.load(Ordering::SeqCst), 0, "the start-up reads no GPU");
    // The reading is held, yet the request is answered at once.
    let first = ui.ok("/get/data/gpu_memory", None);
    assert_eq!(first, json!({ "state": "measuring", "gpus": [], "age_ms": null }));
    assert_eq!(ui.ok("/get/data/gpu_memory", None)["state"], "measuring");
    drop(held);
    let ready = until("the reading arrives", &ui, |a| a["state"] == "ready");
    assert_eq!(
        ready["gpus"],
        json!([{ "name": "Test GPU", "total": 8u64 << 30, "used": 3u64 << 30, "app": { "speech": 1u64 << 30, "conversion": 512u64 << 20, "other": 256u64 << 20 }, "app_shared": 0 }])
    );
    // Asked again at once: the same reading, no second one.
    ui.ok("/get/data/gpu_memory", None);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    ui.stop();
}

#[test]
fn a_reading_is_repeated_only_when_it_is_due() {
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = calls.clone();
    let ui = start(Arc::new(move || {
        counted.fetch_add(1, Ordering::SeqCst);
        Ok(vec![gpu()])
    }));
    ui.ready();
    until("the first reading", &ui, |a| a["state"] == "ready");
    for _ in 0..10 {
        ui.ok("/get/data/gpu_memory", None);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1, "a recent reading is answered again");
    std::thread::sleep(Duration::from_millis(1600));
    until("a second reading", &ui, |_| calls.load(Ordering::SeqCst) == 2);
    ui.stop();
}

#[test]
fn unsupported_and_failed_readings_say_so_without_numbers() {
    let ui = start(Arc::new(|| Err(UNSUPPORTED)));
    ui.ready();
    let answer = until("the reading ends", &ui, |a| a["state"] != "measuring");
    assert_eq!((answer["state"].clone(), answer["gpus"].clone()), (json!("unsupported"), json!([])));
    ui.stop();

    let ui = start(Arc::new(|| panic!("a driver failure")));
    ui.ready();
    let answer = until("the reading ends", &ui, |a| a["state"] != "measuring");
    assert_eq!((answer["state"].clone(), answer["gpus"].clone()), (json!("failed"), json!([])));
    ui.stop();
}
