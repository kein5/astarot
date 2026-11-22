//! The bounded failure log on its own (test_ocr_failure_backoff.py, TestTextOnlyReader).

use std::sync::{Arc, Mutex};

use astarot_ocr_runtime::failure::{read_or_empty, Clock, Failure, FailureLog, Log};

#[derive(Default)]
struct FakeClock(Mutex<f64>);
impl Clock for FakeClock {
    fn now(&self) -> f64 {
        *self.0.lock().unwrap()
    }
}

#[derive(Default)]
struct Logs {
    errors: Mutex<Vec<String>>,
    infos: Mutex<Vec<String>>,
}
impl Log for Logs {
    fn error(&self, message: &str) {
        self.errors.lock().unwrap().push(message.into());
    }
    fn info(&self, message: &str) {
        self.infos.lock().unwrap().push(message.into());
    }
}

fn rig() -> (Arc<FakeClock>, Arc<Logs>, FailureLog) {
    let clock = Arc::new(FakeClock::default());
    let logs = Arc::new(Logs::default());
    let log = FailureLog::new("OCR engine", logs.clone(), clock.clone());
    (clock, logs, log)
}

fn broken() -> Result<Vec<String>, Failure> {
    Err(Failure::new("RuntimeError", "broken reader"))
}

#[test]
fn repeated_reader_failures_are_summarized_and_recovery_is_logged_once() {
    let (clock, logs, mut log) = rig();
    for tick in 0..81 {
        *clock.0.lock().unwrap() = 100.0 + tick as f64 * 0.75;
        for _ in 0..6 {
            assert!(read_or_empty(broken, &mut log).is_empty());
        }
    }
    assert_eq!(logs.errors.lock().unwrap().len(), 1);
    assert!(logs.errors.lock().unwrap()[0].contains("RuntimeError: broken reader"));
    let infos = logs.infos.lock().unwrap().clone();
    assert_eq!(infos.iter().filter(|m| m.contains("suppressed")).count(), 1);
    assert!(infos[0].contains("suppressed 480 repeated failures"));
    for _ in 0..2 {
        assert!(read_or_empty(|| Ok(Vec::<String>::new()), &mut log).is_empty());
    }
    assert_eq!(logs.infos.lock().unwrap().iter().filter(|m| m.contains("recovered")).count(), 1);
    read_or_empty(broken, &mut log);
    assert_eq!(logs.errors.lock().unwrap().len(), 2);
}

#[test]
fn a_new_kind_or_message_logs_a_fresh_error() {
    let (_clock, logs, mut log) = rig();
    for failure in [Failure::new("RuntimeError", "one"), Failure::new("RuntimeError", "one"), Failure::new("RuntimeError", "two"), Failure::new("ValueError", "two")] {
        assert!(read_or_empty(|| Err::<Vec<String>, _>(failure.clone()), &mut log).is_empty());
    }
    let errors = logs.errors.lock().unwrap();
    assert_eq!(errors.len(), 3);
    assert!(errors[2].contains("ValueError: two"));
}
