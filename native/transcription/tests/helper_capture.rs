//! The Linux capture through its helper process, with the stand-in `fake-asr-capture`
//! (decision 82 of `docs/voice-stack/core-integration.md`; Python's
//! `test_capture_diagnostics.py`). No PipeWire: [`HelperCapture::spawn`] starts the helper
//! for an endpoint without looking for it in the graph.
#![cfg(target_os = "linux")]

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vrct_audio_routing::graph::Endpoint;
use vrct_transcription::capture::{Capture, Source};
use vrct_transcription::helper::HelperCapture;

type Heard = Arc<Mutex<Vec<(usize, Option<Duration>)>>>;

/// Starts the stand-in told to do `behaviour`; what it delivered and the errors it reported.
fn start(behaviour: &str) -> (Result<HelperCapture, String>, Heard, Arc<Mutex<Vec<String>>>) {
    let helper = Path::new(env!("CARGO_BIN_EXE_fake-asr-capture"));
    let endpoint = Endpoint { cookie: 1, serial: 2, name: behaviour.to_string(), media_class: "Audio/Source".into() };
    let (heard, errors): (Heard, Arc<Mutex<Vec<String>>>) = Default::default();
    let (frames, failures) = (heard.clone(), errors.clone());
    let capture = HelperCapture::spawn(
        helper,
        &endpoint,
        Source::Mic,
        Box::new(move |samples: &[i16], rate, channels, captured_ago| {
            assert_eq!((rate, channels), (48000, 1));
            frames.lock().unwrap().push((samples.len(), captured_ago));
            true
        }),
        Box::new(move |code: &str| failures.lock().unwrap().push(code.to_string())),
    );
    (capture, heard, errors)
}

fn until(what: &str, limit: Duration, done: impl Fn() -> bool) {
    let deadline = Instant::now() + limit;
    while !done() {
        assert!(Instant::now() < deadline, "{what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_fixed_code_survives_noisy_fragmented_stderr_and_nothing_else_is_believed() {
    // `test_native_capture_fixed_error_survives_noisy_fragmented_stderr`: a long line of noise
    // that ends like a code is never believed, and a code written in two parts is. A failure
    // before the first audio is the start's answer only; Python also called `on_error`
    // (decision 82).
    for code in ["latency_changed", "clock_invalid", "pipewire_version_unsupported"] {
        let expected = format!("asr_capture_{code}");
        // The helper stays after its code: the code is the answer.
        let (capture, heard, errors) = start(&format!("noisy-wait:{code}"));
        assert_eq!(capture.err(), Some(expected.clone()));
        assert!(heard.lock().unwrap().is_empty() && errors.lock().unwrap().is_empty(), "{code}");
        // It ends right after its code: whether the code or the closed output is read first is
        // not settled (decision 72, reported only); either way, never the noise's.
        let (capture, _, errors) = start(&format!("noisy:{code}"));
        let answer = capture.err().expect("the start fails");
        assert!(answer == expected || answer == "asr_capture_helper_closed", "{answer}");
        assert!(errors.lock().unwrap().is_empty(), "{code}");
    }
    let (capture, _, errors) = start("noisy:none");
    assert_eq!(capture.err().as_deref(), Some("asr_capture_helper_closed"));
    assert!(errors.lock().unwrap().is_empty());
}

#[test]
fn a_helper_that_says_nothing_ends_the_start_after_its_deadline() {
    // `test_capture_start_timeout_reaps_silent_helper` (5 s here; Python's test shortened it).
    let started = Instant::now();
    let (capture, _, errors) = start("silent");
    assert_eq!(capture.err().as_deref(), Some("asr_capture_start_timeout"));
    assert!(started.elapsed() < Duration::from_secs(7));
    assert!(errors.lock().unwrap().is_empty());
}

#[test]
fn audio_that_stops_ends_the_capture_and_complete_frames_keep_it() {
    // `test_capture_post_start_deadline_requires_complete_frames`: after the first frame, 2 s
    // without another (nothing, or bytes that never complete a packet) end it as stalled;
    // silent frames that keep coming do not.
    for behaviour in ["idle", "partial"] {
        let (capture, heard, errors) = start(behaviour);
        let mut capture = capture.expect("the first frame came");
        until("the stall", Duration::from_secs(4), || !errors.lock().unwrap().is_empty());
        assert_eq!(*errors.lock().unwrap(), ["asr_capture_stalled"], "{behaviour}");
        assert_eq!(heard.lock().unwrap().len(), 1, "{behaviour}");
        assert!(capture.stop());
    }
    let (capture, heard, errors) = start("stream");
    let mut capture = capture.expect("the first frame came");
    std::thread::sleep(Duration::from_millis(2600));
    assert!(errors.lock().unwrap().is_empty());
    assert!(heard.lock().unwrap().len() > 50);
    assert!(heard.lock().unwrap().iter().all(|(samples, _)| *samples == 960));
    assert!(capture.stop());
}

#[test]
fn each_frame_says_how_long_ago_its_first_sample_was_captured() {
    // Decision 70: the helper's stamp goes with each frame, so that the receiver judges its age
    // from the capture, as Python did. Packets stamped 100 ms before they are written arrive at
    // least that old.
    let (capture, heard, _) = start("aged:100");
    let mut capture = capture.expect("the first frame came");
    until("frames", Duration::from_secs(2), || heard.lock().unwrap().len() >= 5);
    assert!(capture.stop());
    let ages: Vec<Option<Duration>> = heard.lock().unwrap().iter().map(|(_, ago)| *ago).collect();
    assert!(ages.iter().all(|ago| ago.is_some_and(|ago| ago >= Duration::from_millis(100) && ago < Duration::from_millis(250))), "{ages:?}");
}

#[test]
fn an_end_or_a_code_after_the_audio_is_told() {
    // After the first frame, the helper's end and its fixed codes reach `on_error`.
    for (behaviour, expected) in [("closed", "asr_capture_helper_closed"), ("fails:asr_capture_stream_disconnected", "asr_capture_stream_disconnected")] {
        let (capture, _, errors) = start(behaviour);
        let mut capture = capture.expect("the first frame came");
        until("the failure", Duration::from_secs(3), || !errors.lock().unwrap().is_empty());
        assert_eq!(*errors.lock().unwrap(), [expected], "{behaviour}");
        assert!(capture.stop());
    }
}
