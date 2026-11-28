//! The managed route on a private PipeWire graph with the real `astarot-voice-gate`, heard through
//! the managed microphone (`test_private_direct_suppression_keeps_tts_audible_and_requires_resume`
//! of `tests/voice/test_spoken_route_native.py`, decision 1 of #732): a tone stands for the
//! converted voice in the VC input (440 Hz) and another for speech in the TTS input (880 Hz).
//!
//! - Suppressing the direct voice keeps speech audible and silences the VC input; without it
//!   both are heard. Changing the policy mutes the route until the next resume.
//! - A change of the VC input's mute from outside the route revokes the open microphone: the
//!   route mutes and stays silent.
//!
//! Ignored by default: it starts `pipewire` and `wireplumber` of its own and builds the helper
//! with `cc` and libpipewire's development files. The Linux CI runs it
//! (`cargo test --test direct_suppression_private -- --ignored`). The user's own graph is not
//! touched.
#![cfg(all(target_os = "linux", feature = "pipewire"))]

mod private_graph;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use private_graph::{PrivateGraph, build_helper, tone_to};
use astarot_audio_routing::graph::{self, Endpoint};
use astarot_audio_routing::mute_state::MuteState;
use astarot_audio_routing::pipewire::capture::PipeWireCapture;
use astarot_audio_routing::pipewire::gate::PipeWireGate;
use astarot_audio_routing::pipewire::read_graph_data;
use astarot_audio_routing::process::ProcessEnv;
use astarot_audio_routing::voice_route::{Gate, MuteBus, RouteOptions, VoiceRoute};
use astarot_audio_routing::windows_route::{Capture, CaptureCallbacks};

const RATE: f64 = 48000.0;
/// 20 ms frames, as Python's observer read them.
const FRAME: usize = 960;
const VC_TONE: f64 = 440.0;
const TTS_TONE: f64 = 880.0;

/// The speech bus's side of the mute.
#[derive(Default)]
struct Bus(AtomicBool);

impl MuteBus for Bus {
    fn set_muted(&self, muted: bool) {
        self.0.store(muted, Ordering::SeqCst);
    }
}

/// One frame: when it was read, the tones in it, and whether it held anything but silence.
struct Frame {
    at: Instant,
    tones: Vec<f64>,
    nonzero: bool,
}

/// What the managed microphone gave, frame by frame (`ToneObservation`).
#[derive(Default)]
struct Heard {
    pending: Vec<i16>,
    frames: VecDeque<Frame>,
}

impl Heard {
    fn feed(&mut self, pcm: &[u8]) {
        self.pending.extend(pcm.as_chunks::<2>().0.iter().map(|s| i16::from_le_bytes(*s)));
        while self.pending.len() >= FRAME {
            let samples: Vec<i16> = self.pending.drain(..FRAME).collect();
            let tones = [VC_TONE, TTS_TONE].into_iter().filter(|f| amplitude(&samples, *f) > 400.0).collect();
            let nonzero = samples.iter().any(|s| s.unsigned_abs() > 64);
            if self.frames.len() == 1000 {
                self.frames.pop_front();
            }
            self.frames.push_back(Frame { at: Instant::now(), tones, nonzero });
        }
    }

    /// The first frame since `since` of a run that has held for 2 s up to the latest frame, with
    /// no gap over 100 ms: `present` heard, `absent` not, and nothing at all when `silent`.
    fn settled(&self, since: Instant, present: &[f64], absent: &[f64], silent: bool) -> Option<Instant> {
        let last = self.frames.back()?;
        if last.at.elapsed() > Duration::from_millis(200) {
            return None;
        }
        let (end, mut previous, mut start) = (last.at, last.at, None);
        for frame in self.frames.iter().rev() {
            let fits = present.iter().all(|f| frame.tones.contains(f))
                && !absent.iter().any(|f| frame.tones.contains(f))
                && !(silent && frame.nonzero);
            if frame.at < since || previous.duration_since(frame.at) > Duration::from_millis(100) || !fits {
                break;
            }
            start = Some(frame.at);
            previous = frame.at;
        }
        start.filter(|start| end.duration_since(*start) >= Duration::from_secs(2))
    }
}

/// The tone's amplitude in a Hann-windowed frame.
fn amplitude(samples: &[i16], frequency: f64) -> f64 {
    let n = samples.len() as f64;
    let (mut real, mut imaginary, mut weights) = (0.0, 0.0, 0.0);
    for (i, sample) in samples.iter().enumerate() {
        let window = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / (n - 1.0)).cos();
        let angle = std::f64::consts::TAU * frequency * i as f64 / RATE;
        real += f64::from(*sample) * window * angle.cos();
        imaginary += f64::from(*sample) * window * angle.sin();
        weights += window;
    }
    2.0 * real.hypot(imaginary) / weights
}

/// Waits up to 6 s for [`Heard::settled`] (`settled` of `tools/voice_b_poc.py`).
fn settled(heard: &Mutex<Heard>, since: Instant, what: &str, present: &[f64], absent: &[f64], silent: bool) -> Instant {
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        if let Some(start) = heard.lock().unwrap().settled(since, present, absent, silent) {
            return start;
        }
        assert!(Instant::now() < deadline, "{what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Waits until the route has confirmed what it was last asked.
fn confirmed(route: &VoiceRoute) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let status = route.status();
        if status.ready && !status.pending {
            return;
        }
        assert!(Instant::now() < deadline, "the route did not confirm: {status:?}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn node(name: &str, media_class: &str) -> Endpoint {
    let data = read_graph_data(true, None).expect("the graph");
    graph::endpoint(&data, name, media_class).unwrap_or_else(|_| panic!("{name} is in the graph"))
}

/// One graph for every step: the environment that points at it is the process's.
#[test]
#[ignore = "starts a private PipeWire and WirePlumber and builds astarot-voice-gate; the Linux CI runs it"]
fn suppressing_the_direct_voice_keeps_speech_audible_and_a_drift_mutes_the_route() {
    let graph = PrivateGraph::start("vrct-route-test");
    let helper = build_helper("voice-gate", &graph.dir);
    let gate = Arc::new(PipeWireGate::new(helper, ProcessEnv::default()));
    let bus = Arc::new(Bus::default());
    let store = Arc::new(MuteState::new(graph.dir.join("mute.json")));
    let route = VoiceRoute::new(bus.clone(), gate.clone(), store, RouteOptions::default());
    route.configure(true, Duration::from_secs(5), true).expect("the managed route");
    confirmed(&route);

    let playing = [tone_to(&node(graph::VC_SINK, "Audio/Sink"), VC_TONE), tone_to(&node(graph::TTS_SINK, "Audio/Sink"), TTS_TONE)];
    let heard = Arc::new(Mutex::new(Heard::default()));
    let (feeding, failure) = (heard.clone(), Arc::new(Mutex::new(None::<String>)));
    let failed = failure.clone();
    let mut capture = PipeWireCapture::new(
        node(graph::MANAGED_SOURCE, "Audio/Source"),
        "vrct.test.capture",
        CaptureCallbacks {
            on_audio: Box::new(move |pcm: &[u8]| {
                feeding.lock().unwrap().feed(pcm);
                true
            }),
            on_error: Box::new(move |code: &str| *failed.lock().unwrap() = Some(code.to_owned())),
        },
    );
    capture.start().expect("the managed microphone is captured");

    for (suppress, present, absent) in [(true, &[TTS_TONE][..], &[VC_TONE][..]), (false, &[VC_TONE, TTS_TONE][..], &[][..])] {
        // A new policy mutes the route until a resume.
        route.configure(true, Duration::from_secs(5), suppress).expect("the policy");
        confirmed(&route);
        settled(&heard, Instant::now(), "the policy's change was not silent", &[], &[], true);
        let resumed = Instant::now();
        route.resume().expect("the resume");
        confirmed(&route);
        settled(&heard, resumed, "the wrong branch was heard", present, absent, false);
        assert_eq!(gate.inspect_pair().expect("the pair").direct.muted, suppress);
    }

    // A change of the VC input's mute from outside revokes the open microphone.
    let direct = gate.inspect_pair().expect("the pair").direct.identity;
    gate.set_direct_muted(true, direct).expect("the VC input mutes");
    let deadline = Instant::now() + Duration::from_secs(5);
    while !route.status().requested_muted {
        assert!(Instant::now() < deadline, "the drift did not revoke the route");
        std::thread::sleep(Duration::from_millis(10));
    }
    confirmed(&route);
    settled(&heard, Instant::now(), "the drift was not silent", &[], &[], true);
    assert!(!gate.inspect_pair().expect("the pair").direct.muted, "the route left the VC input muted");
    assert!(gate.inspect(None).expect("the source").muted && bus.0.load(Ordering::SeqCst));
    assert_eq!(*failure.lock().unwrap(), None, "the capture failed");

    capture.stop();
    for flag in playing {
        flag.store(true, Ordering::SeqCst);
    }
    assert!(route.close(Duration::from_secs(5)));
}
