//! A diagnostic failure must never become a speech failure
//! (tests/voice/test_voice_trace.py). The environment is process-wide, so the
//! cases run one at a time.

mod common;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::*;
use serde_json::Value;
use astarot_tts::clock::monotonic_ns;
use astarot_tts::playback::{AudioRouter, OutputSink};
use astarot_tts::scheduler::BusOptions;
use astarot_tts::settings::VoiceSettings;
use astarot_tts::{CancelToken, Source, SpeechMessageEvent, TtsError, VoiceEventBus, VoiceStatus};

static ENVIRONMENT: Mutex<()> = Mutex::new(());

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("astarot-tts-trace-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[derive(Clone)]
struct ObservedSink {
    path: PathBuf,
    behavior: &'static str,
    first_write_ns: Arc<Mutex<Option<i64>>>,
    closed_ns: Arc<Mutex<Option<i64>>>,
}

impl ObservedSink {
    fn new(path: &Path, behavior: &'static str) -> Self {
        Self { path: path.to_owned(), behavior, first_write_ns: Arc::default(), closed_ns: Arc::default() }
    }
}

impl OutputSink for ObservedSink {
    fn write(&mut self, pcm: &[u8], token: &CancelToken) -> Result<(), TtsError> {
        assert!(!self.path.exists(), "trace IO must happen after playback");
        match self.behavior {
            "error" => return Err(TtsError::Output),
            "cancel" => {
                token.cancel();
                token.check()?;
            }
            _ => {}
        }
        let mut first = self.first_write_ns.lock().unwrap();
        if pcm.iter().any(|&b| b != 0) && first.is_none() {
            *first = Some(monotonic_ns());
        }
        Ok(())
    }

    fn close(&mut self, _drain: bool, _token: &CancelToken) -> Result<(), TtsError> {
        assert!(!self.path.exists(), "trace IO must happen after close");
        *self.closed_ns.lock().unwrap() = Some(monotonic_ns());
        Ok(())
    }
}

fn run_message(url: &str, sink: &ObservedSink, event_id: &str) -> (SpeechMessageEvent, VoiceStatus) {
    let output = sink.clone();
    let factory = move |_: &str, _: u32, _: u16| -> Result<Box<dyn OutputSink>, TtsError> { Ok(Box::new(output.clone())) };
    let settings = VoiceSettings { mode: "original".into(), output_device: "test".into(), japanese_url: url.to_owned(), ..external() };
    let bus = VoiceEventBus::new(settings, BusOptions::new(Arc::new(AudioRouter::new(Arc::new(factory)))));
    let event = SpeechMessageEvent { source_language: Some("ja".into()), ..SpeechMessageEvent::new(event_id, Source::Chat, "PRIVATE TEXT") };
    assert!(bus.publish(event.clone(), None, None));
    until2(|| {
        let status = bus.status();
        status.completed + status.cancelled + status.errors == 1
    });
    assert!(bus.close(Duration::from_secs(3)));
    (event, bus.status())
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[test]
fn trace_cases() {
    let _environment = ENVIRONMENT.lock().unwrap();
    opt_in_trace_records_first_nonzero_write_after_playback();
    trace_disabled_by_default();
    trace_does_not_record_arbitrary_event_id();
    bad_trace_destination_leaves_worker_healthy();
    // SAFETY: this binary's only test holds ENVIRONMENT; other threads read the environment only through std.
    unsafe { std::env::remove_var("ASTAROT_VOICE_TRACE") };
}

fn opt_in_trace_records_first_nonzero_write_after_playback() {
    let mut silent_then_tone = vec![0u8; 960];
    silent_then_tone.extend([1u8, 0].repeat(960));
    for (behavior, pcm, outcome) in
        [("normal", silent_then_tone, "completed"), ("normal", vec![0u8; 960], "completed"), ("cancel", [1u8, 0].repeat(960), "cancelled"), ("error", [1u8, 0].repeat(960), "error")]
    {
        let dir = scratch(&format!("{behavior}-{outcome}-{}", pcm.len()));
        let path = dir.join("trace.jsonl");
        // SAFETY: called from trace_cases, which holds ENVIRONMENT.
        unsafe { std::env::set_var("ASTAROT_VOICE_TRACE", &path) };
        let sink = ObservedSink::new(&path, behavior);
        let server = PcmServer::start(ServerOptions { chunks: vec![pcm], ..Default::default() });
        let (event, _) = run_message(&server.url, &sink, &uuid());
        assert_eq!(server.posts().len(), 1);
        assert!(path.exists(), "opt-in trace missing");
        let text = std::fs::read_to_string(&path).unwrap();
        let rows: Vec<Value> = text.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(rows.len(), 1);
        let row = rows[0].as_object().unwrap();
        let mut keys: Vec<&str> = row.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["event_id", "first_write_ns", "outcome", "sample_rate", "schema", "started_ns"]);
        assert_eq!((row["schema"].as_i64(), row["event_id"].as_str()), (Some(1), Some(event.event_id.as_str())));
        assert_eq!((row["started_ns"].as_i64(), row["outcome"].as_str()), (Some(event.timestamp_ns), Some(outcome)));
        match *sink.first_write_ns.lock().unwrap() {
            None => assert!(row["first_write_ns"].is_null() && row["sample_rate"].is_null()),
            Some(first) => {
                let recorded = row["first_write_ns"].as_i64().unwrap();
                assert!(first <= recorded && recorded <= sink.closed_ns.lock().unwrap().unwrap());
                assert_eq!(row["sample_rate"].as_u64(), Some(48000));
            }
        }
        assert!(!text.contains("PRIVATE") && !text.contains(&server.url));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}

fn trace_disabled_by_default() {
    // SAFETY: called from trace_cases, which holds ENVIRONMENT.
    unsafe { std::env::remove_var("ASTAROT_VOICE_TRACE") };
    let dir = scratch("disabled");
    let path = dir.join("trace.jsonl");
    let server = PcmServer::start(ServerOptions::default());
    let (_, status) = run_message(&server.url, &ObservedSink::new(&path, "normal"), &uuid());
    assert!(status.completed == 1 && !path.exists());
    let _ = std::fs::remove_dir_all(dir);
}

fn trace_does_not_record_arbitrary_event_id() {
    let dir = scratch("arbitrary");
    let path = dir.join("trace.jsonl");
    // SAFETY: called from trace_cases, which holds ENVIRONMENT.
    unsafe { std::env::set_var("ASTAROT_VOICE_TRACE", &path) };
    let server = PcmServer::start(ServerOptions::default());
    run_message(&server.url, &ObservedSink::new(&path, "normal"), "PRIVATE USER SUPPLIED ID");
    let text = std::fs::read_to_string(&path).expect("opt-in trace missing");
    assert!(serde_json::from_str::<Value>(&text).unwrap()["event_id"].is_null());
    assert!(!text.contains("PRIVATE"));
    let _ = std::fs::remove_dir_all(dir);
}

fn bad_trace_destination_leaves_worker_healthy() {
    for target in ["directory", "missing_parent", "full", "fifo"] {
        let dir = scratch(target);
        let mut path = dir.join("trace");
        match target {
            "directory" => std::fs::create_dir(&path).unwrap(),
            "missing_parent" => path = path.join("missing").join("trace"),
            "full" => std::fs::File::create(&path).unwrap().set_len(8 * 1024 * 1024).unwrap(),
            _ => {
                if !cfg!(unix) || !std::process::Command::new("mkfifo").arg(&path).status().is_ok_and(|s| s.success()) {
                    continue; // A FIFO is a Unix failure mode.
                }
            }
        }
        // SAFETY: called from trace_cases, which holds ENVIRONMENT.
        unsafe { std::env::set_var("ASTAROT_VOICE_TRACE", &path) };
        // The sentinel differs from the invalid destination; playback may proceed.
        let server = PcmServer::start(ServerOptions::default());
        let (_, status) = run_message(&server.url, &ObservedSink::new(&dir.join("absent"), "normal"), &uuid());
        assert!(status.completed == 1 && status.errors == 0, "{target}");
        if target == "full" {
            assert_eq!(std::fs::metadata(&path).unwrap().len(), 8 * 1024 * 1024);
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
