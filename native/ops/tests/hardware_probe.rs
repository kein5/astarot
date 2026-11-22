//! Read-only hardware inspection; every child is an owned stand-in for speech.cpp
//! (tests/fixture/fake_speech_devices.rs), never the real one, and no model is loaded.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use astarot_ops::downloads::hardware::HardwareProbe;
use astarot_ops::json::Json;
use astarot_ops::telemetry::hardware;

/// The stand-in under a name that selects its behaviour. All copies are made once, before any
/// test starts a child: a copy still open for writing while another thread forks would be
/// inherited by that child, and executing it would fail with "text file busy".
fn fake(mode: &str) -> PathBuf {
    static DIR: OnceLock<tempfile::TempDir> = OnceLock::new();
    let dir = DIR.get_or_init(|| {
        let dir = tempfile::tempdir().unwrap();
        for mode in ["ok", "sleep", "invalid", "fail", "stubborn"] {
            std::fs::copy(env!("CARGO_BIN_EXE_fake-speech-devices"), path_of(dir.path(), mode)).unwrap();
        }
        dir
    });
    path_of(dir.path(), mode)
}

fn path_of(dir: &Path, mode: &str) -> PathBuf {
    dir.join(format!("speech-{mode}{}", std::env::consts::EXE_SUFFIX))
}

fn probe(path: PathBuf, timeout: Duration, calls: Arc<AtomicUsize>) -> HardwareProbe {
    HardwareProbe::new(
        Arc::new(move || {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(path.clone())
        }),
        timeout,
    )
}

fn wait_done(probe: &HardwareProbe) -> Json {
    let end = Instant::now() + Duration::from_secs(5);
    while Instant::now() < end {
        let state = probe.state();
        if state.get("phase").and_then(Json::as_str) != Some("probing") {
            return state;
        }
        thread::sleep(Duration::from_millis(5));
    }
    panic!("probe did not finish");
}

#[test]
fn refresh_is_async_fixed_command_and_never_loads_model() {
    let calls = Arc::new(AtomicUsize::new(0));
    let probe = probe(fake("ok"), Duration::from_secs(5), calls.clone());
    assert_eq!(probe.state().get("phase").and_then(Json::as_str), Some("unknown"));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let began = Instant::now();
    probe.refresh().unwrap();
    assert!(began.elapsed() < Duration::from_millis(100));
    // A request while one runs does not start another.
    probe.refresh().unwrap();
    let state = wait_done(&probe);
    assert_eq!(state.get("phase").and_then(Json::as_str), Some("ready"));
    let devices = state.get("devices").unwrap().as_array().unwrap();
    assert_eq!(devices[1].get("memory_free"), Some(&Json::from(3u64 << 30)));
    assert_eq!(devices[0].get("memory_total"), Some(&Json::Null));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(matches!(state.get("measured_at_ms"), Some(Json::Number(n)) if n.as_u64().unwrap() > 0));
    assert!(probe.close(Duration::from_secs(2)));
}

#[test]
fn bad_or_stalled_probe_is_not_cpu_only_or_ready() {
    for (mode, error, timeout) in [("sleep", "hardware_timeout", 100), ("invalid", "hardware_invalid", 5000), ("fail", "hardware_failed", 5000)] {
        let probe = probe(fake(mode), Duration::from_millis(timeout), Arc::new(AtomicUsize::new(0)));
        probe.refresh().unwrap();
        let state = wait_done(&probe);
        assert_eq!(state.get("phase").and_then(Json::as_str), Some("failed"), "{mode}");
        assert_eq!(state.get("error_code").and_then(Json::as_str), Some(error), "{mode}");
        assert_eq!(state.get("devices").unwrap().as_array().unwrap().len(), 0);
        assert!(probe.close(Duration::from_secs(2)));
    }
    let missing = HardwareProbe::new(Arc::new(|| Err("speech_bundle_missing_or_invalid".to_string())), Duration::from_secs(1));
    missing.refresh().unwrap();
    assert_eq!(wait_done(&missing).get("error_code").and_then(Json::as_str), Some("hardware_unavailable"));
}

#[test]
fn close_reaps_only_owned_probe_and_cannot_restart() {
    let probe = probe(fake("sleep"), Duration::from_secs(30), Arc::new(AtomicUsize::new(0)));
    probe.refresh().unwrap();
    let end = Instant::now() + Duration::from_secs(2);
    while !probe.child_running() && Instant::now() < end {
        thread::sleep(Duration::from_millis(5));
    }
    assert!(probe.child_running());
    assert!(probe.close(Duration::from_secs(10)));
    assert!(!probe.child_running());
    assert_eq!(probe.state().get("phase").and_then(Json::as_str), Some("closed"));
    assert_eq!(probe.refresh().unwrap_err(), "hardware_closed");
}

#[cfg(unix)]
#[test]
fn shutdown_escalates_if_owned_probe_ignores_termination() {
    let path = fake("stubborn");
    let ready = path.with_extension("ready");
    let probe = probe(path, Duration::from_secs(3), Arc::new(AtomicUsize::new(0)));
    probe.refresh().unwrap();
    let end = Instant::now() + Duration::from_secs(2);
    while !ready.exists() && Instant::now() < end {
        thread::sleep(Duration::from_millis(5));
    }
    assert!(ready.exists());
    assert!(probe.close(Duration::from_millis(500)));
    assert!(!probe.child_running());
}

#[test]
fn telemetry_reads_the_same_list_and_gives_up_quietly() {
    let rows = hardware::devices(&fake("ok"), Duration::from_secs(5)).unwrap();
    assert_eq!(rows.iter().map(|r| r.kind.as_str()).collect::<Vec<_>>(), ["cpu", "gpu"]);
    let summary = hardware::collect(Some(&fake("ok")), Duration::from_secs(5));
    assert_eq!(summary.cpu.as_deref(), Some("host CPU"));
    assert_eq!(summary.ram_gb, None);
    let gpus = summary.gpus.unwrap();
    assert_eq!((gpus[0].name.as_str(), gpus[0].kind.as_str(), gpus[0].vram_gb), ("test GPU", "gpu", Some(8)));
    // A stalled or broken speech.cpp leaves only what the system itself tells.
    let stalled = hardware::collect(Some(&fake("sleep")), Duration::from_millis(100));
    assert!(stalled.cpu.is_none() && stalled.gpus.is_none());
    assert!(hardware::collect(Some(&fake("fail")), Duration::from_secs(5)).gpus.is_none());
}
