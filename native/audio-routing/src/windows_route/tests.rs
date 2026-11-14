//! Ports of the route and bridge cases of `src-python/test/test_windows_voice_devices.py`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use super::*;
use crate::sync::Event;

#[derive(Default)]
struct Written(Mutex<Vec<Vec<u8>>>);

struct Recording {
    written: Arc<Written>,
    gate: Option<Arc<Event>>,
    fail: bool,
    closed: Arc<AtomicBool>,
}

impl Output for Recording {
    fn write(&mut self, pcm: &[u8], _: &dyn PlaybackToken) -> Result<()> {
        if let Some(gate) = &self.gate {
            gate.wait(Duration::from_secs(5));
        }
        if self.fail {
            return Err(Error::speech("output_disconnected"));
        }
        lock(&self.written.0).push(pcm.to_vec());
        Ok(())
    }
    fn close(&mut self, _: bool, _: &dyn PlaybackToken) -> Result<()> {
        self.closed.store(true, Ordering::SeqCst);
        Ok(())
    }
}

fn recording(gate: Option<Arc<Event>>, fail: bool) -> (Recording, Arc<Written>, Arc<AtomicBool>) {
    let (written, closed) = (Arc::new(Written::default()), Arc::new(AtomicBool::new(false)));
    (Recording { written: written.clone(), gate, fail, closed: closed.clone() }, written, closed)
}

fn until(predicate: impl Fn() -> bool) -> bool {
    let end = Instant::now() + Duration::from_secs(2);
    while Instant::now() < end {
        if predicate() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    predicate()
}

#[test]
fn queued_output_never_blocks_the_caller_and_keeps_the_newest() {
    let gate = Arc::new(Event::new());
    let (sink, written, _) = recording(Some(gate.clone()), false);
    let mut output = QueuedOutput::with(Box::new(sink), Arc::new(monotonic)).unwrap();
    let token = CancelToken::default();
    let started = Instant::now();
    for value in 0..40u8 {
        output.write(&[value], &token).unwrap();
    }
    assert!(started.elapsed() < Duration::from_millis(500));
    gate.set();
    assert!(until(|| output.queued() == 0 && lock(&written.0).last() == Some(&vec![39])));
    output.close(false, &token).unwrap();
}

#[test]
fn a_write_stuck_in_the_driver_is_left_alone_at_close() {
    let gate = Arc::new(Event::new());
    let (sink, _, closed) = recording(Some(gate.clone()), false);
    let mut output = QueuedOutput::with(Box::new(sink), Arc::new(monotonic)).unwrap();
    let token = CancelToken::default();
    output.write(&[0, 0], &token).unwrap();
    assert!(until(|| output.queued() == 0));
    output.close(true, &token).unwrap();
    assert!(!closed.load(Ordering::SeqCst));
    gate.set();
}

#[test]
fn a_failed_device_surfaces_on_the_next_write() {
    let (sink, _, _) = recording(None, true);
    let mut output = QueuedOutput::with(Box::new(sink), Arc::new(monotonic)).unwrap();
    let token = CancelToken::default();
    output.write(&[0, 0], &token).unwrap();
    assert!(until(|| output.is_failed()));
    assert_eq!(output.write(&[0, 0], &token).unwrap_err(), Error::speech("vc_output_failed"));
    output.close(false, &token).unwrap();
}

#[test]
fn converted_voice_reports_a_device_that_takes_nothing() {
    let gate = Arc::new(Event::new());
    let (sink, _, _) = recording(Some(gate.clone()), false);
    let now = Arc::new(Mutex::new(0.0));
    let time = now.clone();
    let mut output = QueuedOutput::with(Box::new(sink), Arc::new(move || *lock(&time))).unwrap();
    let token = CancelToken::default();
    output.write(&[0, 0], &token).unwrap();
    assert!(until(|| output.queued() == 0));
    for _ in 0..OUTPUT_QUEUE {
        output.write(&[0, 0], &token).unwrap();
    }
    *lock(&now) = OUTPUT_STALL_S + 1.0;
    assert_eq!(output.write(&[0, 0], &token).unwrap_err(), Error::speech("vc_output_failed"));
    gate.set();
}

struct NoCapture;
impl Capture for NoCapture {
    fn start(&mut self) -> Result<()> {
        Ok(())
    }
    fn request_stop(&self) {}
    fn stop(&mut self) {}
}

struct Devices {
    outputs: Vec<String>,
    output: Mutex<Option<Recording>>,
}

impl RouteDevices for Devices {
    fn outputs(&self, _: &[String]) -> Result<Vec<String>> {
        Ok(self.outputs.clone())
    }
    fn open_output(&self, _: &str) -> Result<Box<dyn Output>> {
        lock(&self.output).take().map(|o| Box::new(o) as Box<dyn Output>).ok_or_else(|| Error::speech("output_missing"))
    }
    fn capture(&self, _: &Endpoint, _: CaptureCallbacks) -> Box<dyn Capture> {
        Box::new(NoCapture)
    }
}

#[derive(Default)]
struct Failures(Mutex<Vec<String>>);
impl Reporter for Failures {
    fn log(&self, _: &str) {}
    fn report_failure(&self, feature: &str, code: &str) {
        lock(&self.0).push(format!("{feature}:{code}"));
    }
}

fn mic(name: &str) -> Endpoint {
    Endpoint { cookie: 1, serial: 0, name: name.into(), media_class: "Audio/Source".into() }
}

#[test]
fn bridge_writes_silence_while_muted_and_voice_after_resume() {
    let (sink, written, _) = recording(None, false);
    let devices = Arc::new(Devices { outputs: vec!["device".into()], output: Mutex::new(Some(sink)) });
    let bridge = WindowsBridge::new("device", devices, Arc::new(Failures::default()));
    bridge.set_monitor_muted(true);
    bridge.start(mic("mic")).unwrap();
    assert!(until(|| bridge.health().active));
    assert!(bridge.offer_audio(&[1, 2]));
    assert!(until(|| !lock(&written.0).is_empty()));
    assert_eq!(lock(&written.0)[0], [0, 0]);
    bridge.set_monitor_muted(false);
    assert!(bridge.offer_audio(&[1, 2]));
    assert!(until(|| lock(&written.0).len() >= 2));
    assert_eq!(lock(&written.0)[1], [1, 2]);
    assert!(bridge.close(Duration::from_secs(2)));
    let state = bridge.health();
    assert!(!state.requested && !state.active && state.error.is_none() && !state.stopping);
    assert_eq!(state.source.unwrap().name, "mic");
}

#[test]
fn bridge_reports_a_cable_looped_onto_itself() {
    let cable_in = r#"["Windows WASAPI", "CABLE Input (VB-Audio Virtual Cable)"]"#;
    let (sink, _, _) = recording(None, false);
    let failures = Arc::new(Failures::default());
    let devices = Arc::new(Devices { outputs: vec![cable_in.into()], output: Mutex::new(Some(sink)) });
    let bridge = WindowsBridge::new(cable_in, devices, failures.clone());
    bridge.start(mic(r#"["Windows WASAPI", "CABLE Output (VB-Audio Virtual Cable)"]"#)).unwrap();
    assert!(until(|| bridge.health().error.is_some()));
    assert_eq!(bridge.health().error.as_deref(), Some("vc_feedback_blocked"));
    assert!(bridge.close(Duration::from_secs(2)));
    assert_eq!(*lock(&failures.0), ["voice_conversion:vc_feedback_blocked"]);
    assert_eq!(bridge.start(mic("mic")).unwrap_err(), Error::runtime("source_bridge_stopping"));
}

#[test]
fn bridge_reports_a_missing_output() {
    let devices = Arc::new(Devices { outputs: vec![], output: Mutex::new(None) });
    let bridge = WindowsBridge::new("gone", devices, Arc::new(Failures::default()));
    bridge.start(mic("mic")).unwrap();
    assert!(until(|| bridge.health().error.is_some()));
    assert_eq!(bridge.health().error.as_deref(), Some("vc_output_missing"));
    assert!(bridge.close(Duration::from_secs(2)));
}

#[test]
fn bridge_rides_out_a_short_stall_and_keeps_the_newest_audio() {
    let devices = Arc::new(Devices { outputs: vec![], output: Mutex::new(None) });
    let bridge = WindowsBridge::new("out", devices, Arc::new(Failures::default()));
    for value in 0..(BRIDGE_QUEUE as u8 + 3) {
        assert!(bridge.offer_audio(&[value]));
    }
    assert!(bridge.health().error.is_none());
    assert_eq!(bridge.queued()[0], [3]);
}

#[test]
fn bridge_gives_up_on_a_device_that_takes_nothing() {
    let devices = Arc::new(Devices { outputs: vec![], output: Mutex::new(None) });
    let bridge = WindowsBridge::new("out", devices, Arc::new(Failures::default()));
    lock(&bridge.shared.state).requested = true;
    for value in 0..BRIDGE_QUEUE as u8 {
        assert!(bridge.offer_audio(&[value]));
    }
    let late = *lock(&bridge.shared.written) + OUTPUT_STALL_S + 1.0;
    bridge.set_clock(Arc::new(move || late));
    assert!(!bridge.offer_audio(b"late"));
    assert_eq!(bridge.health().error.as_deref(), Some("source_bridge_output_failed"));
}

#[test]
fn route_checks_the_pair_only_when_asked() {
    let cable_in = r#"["Windows WASAPI", "CABLE Input (VB-Audio Virtual Cable)"]"#;
    let devices = Arc::new(Devices { outputs: vec![cable_in.into()], output: Mutex::new(None) });
    let route = WindowsRoute::new(cable_in, devices);
    let cable_out = mic(r#"["Windows WASAPI", "CABLE Output (VB-Audio Virtual Cable)"]"#);
    assert_eq!(route.bind(&cable_out, true).unwrap_err(), Error::runtime("vc_feedback_blocked"));
    assert_eq!(route.bind(&cable_out, false).unwrap().name, cable_in);
}
