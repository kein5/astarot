//! Realtime recognition's Linux capture on a private PipeWire graph (decision 2 of #733): the
//! PipeWire capture of `astarot-audio-routing` in place of the `vrct-asr-capture` helper of 0.5.x. The
//! endpoints are listed, a microphone is read from its source and a speaker from its sink's
//! monitor, a node that is no longer the one chosen is refused, and a capture that loses its node
//! tells it once.
//!
//! Ignored by default, and built only with the `pipewire` feature: it starts `pipewire`,
//! `wireplumber` and `pw-loopback` of its own. The Linux CI runs it
//! (`cargo test --features pipewire --test pipewire_capture_private -- --ignored`). The user's
//! own graph is not touched.
#![cfg(all(target_os = "linux", feature = "pipewire"))]

#[path = "../../audio-routing/tests/private_graph/mod.rs"]
mod private_graph;

use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use private_graph::{PrivateGraph, microphone, tone};
use astarot_audio_routing::graph::Endpoint;
use astarot_transcription::capture::{Capture, CapturePlatform, NativeCapture, OnAudio, OnError, Source, Target};

/// What a capture heard: samples, rate and channels.
type Heard = Receiver<(Vec<i16>, u32, u16)>;

/// Starts a capture of `endpoint`; what it hears and the codes it tells.
fn open(endpoint: &Endpoint, source: Source) -> (Result<Box<dyn Capture>, String>, Heard, Receiver<String>) {
    let (heard, audio) = channel();
    let (told, codes) = channel();
    let on_audio: OnAudio = Box::new(move |samples: &[i16], rate: u32, channels: u16, _: Option<Duration>| {
        heard.send((samples.to_vec(), rate, channels)).is_ok()
    });
    let on_error: OnError = Box::new(move |code: &str| {
        let _ = told.send(code.to_owned());
    });
    let started = NativeCapture::new().open(source, &Target::Endpoint(endpoint.clone()), Duration::from_secs(5), on_audio, on_error);
    (started, audio, codes)
}

/// Waits up to 4 s for a 100 ms stretch louder than a quiet room.
fn loud(audio: &Heard) {
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut recent: Vec<i16> = Vec::new();
    loop {
        assert!(Instant::now() < deadline, "the tone was not heard");
        let Ok((samples, rate, channels)) = audio.recv_timeout(Duration::from_millis(100)) else { continue };
        assert_eq!((rate, channels), (48000, 1));
        recent.extend(samples);
        let keep = recent.len().saturating_sub(4800);
        recent.drain(..keep);
        let rms = (recent.iter().map(|s| f64::from(*s).powi(2)).sum::<f64>() / recent.len().max(1) as f64).sqrt();
        if recent.len() == 4800 && rms > 1000.0 {
            return;
        }
    }
}

fn listed(source: Source, name: &str) -> Endpoint {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let rows = NativeCapture::new().endpoints(source).expect("the endpoints");
        if let Some((endpoint, _)) = rows.into_iter().find(|(endpoint, _)| endpoint.name == name) {
            return endpoint;
        }
        assert!(Instant::now() < deadline, "{name} is not listed");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// One graph for every case: the environment that points at it is the process's.
#[test]
#[ignore = "starts a private PipeWire, WirePlumber and pw-loopback; run it with --features pipewire"]
fn realtime_recognition_captures_a_microphone_and_a_speaker_through_pipewire() {
    let _graph = PrivateGraph::start("vrct-asr-test");
    // A microphone: what is played into its sink comes out of its source.
    let mut mic = microphone("vrct.test.mic");
    let mic_tone = tone("vrct.test.mic.sink");
    let source = listed(Source::Mic, "vrct.test.mic.source");
    let (started, audio, codes) = open(&source, Source::Mic);
    let mut capture = started.expect("the microphone opens");
    loud(&audio);

    // A speaker: its sink is read from the monitor (the same loopback's sink, as a speaker).
    let speaker = listed(Source::Speaker, "vrct.test.mic.sink");
    let (started, speaker_audio, speaker_codes) = open(&speaker, Source::Speaker);
    let mut speaker_capture = started.expect("the speaker opens");
    loud(&speaker_audio);
    assert!(speaker_capture.stop(), "the speaker's capture was not released");
    assert!(speaker_codes.try_recv().is_err());

    // A node that is no longer the one chosen is not captured.
    let moved = Endpoint { serial: source.serial + 1000, ..source.clone() };
    let (refused, _, refused_codes) = open(&moved, Source::Mic);
    assert_eq!(refused.err().as_deref(), Some("asr_capture_endpoint_changed"));
    assert!(refused_codes.try_recv().is_err());

    // Losing the microphone is told once.
    mic_tone.store(true, Ordering::SeqCst);
    let _ = mic.kill();
    let _ = mic.wait();
    let code = codes.recv_timeout(Duration::from_secs(4)).expect("the loss is told");
    assert!(["asr_capture_stream_disconnected", "asr_capture_stalled"].contains(&code.as_str()), "{code}");
    assert!(capture.stop());
    assert!(codes.try_recv().is_err(), "told twice");
}
