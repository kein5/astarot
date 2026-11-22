//! Speech on the managed route of Linux from end to end, on a private PipeWire graph (#746,
//! decision 2): typed chat is spoken by a speech.cpp server, played into the managed TTS input
//! and heard on the managed microphone (`astarot.managed.source`) exactly once; a stop, a mute, the
//! switch turned off and a server that fails leave the microphone silent; a server started again
//! replays nothing old; and the microphone is muted again when the core stops.
//!
//! Until 0.6.0 `tests/platform/test_native_voice.py` checked this through the app's window with
//! the Python backend's PipeWire parts. Here the core is driven over the connection the UI uses
//! (`common::Ui`), with its own voice platform ([`NativeVoice`]): the real speech output, the
//! real `astarot-voice-gate` (`build/`, from `python tools/build_voice_gate.py`) and the real
//! managed route. The speech server is the fake one (`common::fake_tts`): a tone, no model. The
//! microphone is read with the PipeWire capture of `vrct-audio-routing`; nothing of the audio
//! is kept or logged.
//!
//! Ignored by default, and built only with the `pipewire` feature: it starts `pipewire`,
//! `wireplumber` and `pw-loopback` of its own. Run it with
//! `cargo test --features pipewire --test spoken_route_live -- --ignored`. The user's own graph
//! is not touched.
#![cfg(all(target_os = "linux", feature = "pipewire"))]

mod common;
#[path = "../../audio-routing/tests/private_graph/mod.rs"]
mod private_graph;

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::fake_tts::FakeTts;
use common::{Setup, Ui, error_code};
use private_graph::{PrivateGraph, dump, wait};
use serde_json::{Value, json};
use vrct_audio_routing::graph::{self, MANAGED_SOURCE};
use vrct_audio_routing::pipewire::capture::PipeWireCapture;
use vrct_audio_routing::pipewire::read_graph_data;
use vrct_audio_routing::windows_route::{Capture, CaptureCallbacks};
use vrct_core::config::Platform;
use vrct_core::controller::voice::NativeVoice;

/// 20 ms of the microphone's 48 kHz mono s16le.
const PIECE: usize = 960 * 2;
/// A piece is sound when a sample reaches this; the fake server's tone reaches about 6000.
const SOUND: i16 = 1000;
/// Silence this long ends a burst of sound, and counts as "stopped".
const QUIET: Duration = Duration::from_millis(600);
/// How soon a stop, a mute or a failed server must silence the microphone (as in 0.5.x).
const SILENCED_WITHIN: Duration = Duration::from_millis(500);
/// The short speech the fake server answers, in seconds.
const SHORT: f64 = 0.6;

/// The managed microphone, 20 ms at a time: when each piece arrived and whether it was sound,
/// and the capture's errors.
#[derive(Clone, Default)]
struct Heard(Arc<Mutex<Vec<(Instant, bool)>>>, Arc<Mutex<Vec<String>>>);

impl Heard {
    fn record(&self, pcm: &[u8]) {
        let now = Instant::now();
        let mut pieces = self.0.lock().unwrap();
        for piece in pcm.chunks(PIECE) {
            let loud = piece.as_chunks::<2>().0.iter().any(|s| i16::from_le_bytes(*s).unsigned_abs() >= SOUND.unsigned_abs());
            pieces.push((now, loud));
        }
    }

    fn since(&self, from: Instant) -> Vec<(Instant, bool)> {
        let errors = self.1.lock().unwrap().clone();
        assert!(errors.is_empty(), "the managed microphone's capture failed: {errors:?}");
        self.0.lock().unwrap().iter().filter(|(at, _)| *at >= from).copied().collect()
    }

    /// When sound was first heard after `from`; it must come within `within`.
    fn sound_after(&self, from: Instant, within: Duration, what: &str) -> Instant {
        let deadline = Instant::now() + within;
        loop {
            if let Some((at, _)) = self.since(from).into_iter().find(|(_, loud)| *loud) {
                return at;
            }
            assert!(Instant::now() < deadline, "{what}: no sound on the managed microphone within {within:?}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// When the microphone went quiet after `from` for good (for [`QUIET`]): the end of the
    /// last sound before that quiet, or `from` when there was none.
    fn quiet_after(&self, from: Instant, what: &str) -> Instant {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let pieces = self.since(from);
            let last_sound = pieces.iter().rev().find(|(_, loud)| *loud).map(|(at, _)| *at);
            let heard_until = pieces.last().map(|(at, _)| *at);
            let quiet_from = last_sound.unwrap_or(from);
            if heard_until.is_some_and(|until| until.duration_since(quiet_from) >= QUIET) {
                return quiet_from;
            }
            assert!(Instant::now() < deadline, "{what}: the managed microphone did not go quiet");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// The bursts of sound between `from` and `to`, each as its length.
    fn bursts(&self, from: Instant, to: Instant) -> Vec<Duration> {
        let mut bursts: Vec<(Instant, Instant)> = Vec::new();
        for (at, loud) in self.since(from).into_iter().filter(|(at, _)| *at <= to) {
            if !loud {
                continue;
            }
            match bursts.last_mut() {
                Some((_, end)) if at.duration_since(*end) < Duration::from_millis(200) => *end = at,
                _ => bursts.push((at, at)),
            }
        }
        bursts.into_iter().map(|(start, end)| end.duration_since(start)).collect()
    }

    /// Nothing is heard for `long` from now.
    fn stays_quiet(&self, long: Duration, what: &str) {
        let from = Instant::now();
        std::thread::sleep(long);
        assert_eq!(self.bursts(from, Instant::now()), Vec::<Duration>::new(), "{what}: the managed microphone was not silent");
    }
}

/// Whether the managed microphone is muted in the graph, as the gate left it.
fn muted() -> bool {
    graph::parse_managed(&dump(), false).expect("the managed route is in the graph once").muted
}

struct Run {
    ui: Ui,
    server: FakeTts,
    heard: Heard,
    _capture: Box<dyn Capture>,
}

impl Run {
    fn status(&self) -> Value {
        self.ui.ok("/get/data/voice_status", None)
    }

    fn enable(&self) -> Value {
        let generation = self.status()["tts_generation"].clone();
        self.ui.request("/run/enable_tts", Some(json!({ "generation": generation })))
    }

    fn route(&self) -> Value {
        self.ui.ok("/get/data/voice_route", None)
    }

    /// Sends typed chat and says when.
    fn send(&self, id: &str) -> Instant {
        let sent = Instant::now();
        // The words are the test's own; the core logs none of them.
        self.ui.ok("/run/send_message_box", Some(json!({ "id": id, "message": "テストの発話" })));
        sent
    }

    /// The chat is heard once, about as long as the server spoke, and then nothing more.
    fn heard_once(&self, id: &str) {
        let sent = self.send(id);
        let first = self.heard.sound_after(sent, Duration::from_secs(5), id);
        let quiet = self.heard.quiet_after(first, id);
        std::thread::sleep(Duration::from_secs(1));
        let bursts = self.heard.bursts(sent, Instant::now());
        assert_eq!(bursts.len(), 1, "{id}: heard {bursts:?}");
        let spoken = Duration::from_secs_f64(SHORT);
        assert!(bursts[0] + Duration::from_millis(150) >= spoken && bursts[0] <= spoken + Duration::from_millis(250), "{id}: heard {bursts:?} for {spoken:?}");
        assert!(quiet > first);
        // Times only: nothing of the audio or the words is printed.
        eprintln!("{id}: sound {:?} after sending, heard for {:?}", first.duration_since(sent), bursts[0]);
    }

    /// Long speech is cut by `act`: the microphone is quiet within [`SILENCED_WITHIN`].
    fn cut_by(&self, id: &str, act: impl FnOnce()) {
        self.server.set_seconds(4.0);
        let sent = self.send(id);
        let first = self.heard.sound_after(sent, Duration::from_secs(5), id);
        std::thread::sleep(Duration::from_millis(300).saturating_sub(first.elapsed()));
        let acted = Instant::now();
        act();
        let quiet = self.heard.quiet_after(acted, id);
        let took = quiet.saturating_duration_since(acted);
        assert!(took < SILENCED_WITHIN, "{id}: the managed microphone went quiet {took:?} after the action");
        eprintln!("{id}: quiet {took:?} after the action");
        self.server.set_seconds(SHORT);
    }
}

#[test]
#[ignore = "starts a private PipeWire, WirePlumber and pw-loopback, and needs build/astarot-voice-gate; run it with --features pipewire"]
fn chat_is_spoken_once_into_the_managed_microphone_and_every_stop_silences_it() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
    assert!(root.join("build/astarot-voice-gate").is_file(), "build/astarot-voice-gate is missing; run `python tools/build_voice_gate.py`");
    vrct_core::resources::use_development_checkout(root);
    let _graph = PrivateGraph::start("vrct-spoken-live");
    wait("the managed route", || graph::parse_managed(&dump(), false).is_ok());

    // The managed microphone, read as a recording app would.
    let heard = Heard::default();
    let data = read_graph_data(true, None).expect("the graph");
    let source = graph::endpoint(&data, MANAGED_SOURCE, "Audio/Source").expect("the managed microphone");
    let (recorder, failures) = (heard.clone(), heard.1.clone());
    let callbacks = CaptureCallbacks {
        on_audio: Box::new(move |pcm: &[u8]| {
            recorder.record(pcm);
            true
        }),
        on_error: Box::new(move |code: &str| failures.lock().unwrap().push(code.to_owned())),
    };
    let mut capture: Box<dyn Capture> = Box::new(PipeWireCapture::new(source, "vrct.test.listener", callbacks));
    capture.start().expect("the managed microphone is captured");

    let mut setup = Setup { saved: Some(json!({})), platform: Platform::Linux, ..Setup::default() };
    setup.services.voice = Arc::new(NativeVoice);
    let ui = Ui::with(setup);
    ui.ready();
    let server = FakeTts::speechcpp(SHORT);
    server.set_pace(Duration::from_millis(15));
    let run = Run { ui, server, heard, _capture: capture };

    // The managed route starts muted, and stays so until resumed.
    let settings = json!({ "routing": "managed", "mode": "original", "japanese_server": "external", "japanese_url": run.server.url });
    let saved = run.ui.request("/set/data/voice_settings", Some(settings));
    assert_eq!(saved["status"], 200, "{saved}");
    common::net::eventually("the managed route is ready", || run.route()["ready"] == true);
    assert!(muted(), "the managed microphone was not muted before a resume");
    assert_eq!(error_code(&run.enable()), "voice_route_muted");
    run.send("muted-before-resume");
    run.heard.stays_quiet(Duration::from_millis(1500), "before the resume");

    run.ui.ok("/run/resume_voice", None);
    common::net::eventually("the gate opens", || run.route()["observed_muted"] == false);
    assert!(!muted(), "the managed microphone stayed muted after a resume");
    assert_eq!(run.enable()["status"], 200);
    run.heard_once("normal");

    // A stop cuts the speech; the switch stays on and the next chat speaks.
    run.cut_by("stop", || {
        run.ui.ok("/run/stop_voice", None);
    });
    assert_eq!(run.status()["tts_enabled"], true);
    run.heard_once("after-stop");

    // A mute cuts it, and chat sent while muted stays silent.
    run.cut_by("mute", || {
        run.ui.ok("/run/mute_voice", None);
    });
    common::net::eventually("the gate closes", || muted());
    run.send("while-muted");
    run.heard.stays_quiet(Duration::from_millis(1500), "while muted");
    run.ui.ok("/run/resume_voice", None);
    common::net::eventually("the gate opens again", || run.route()["observed_muted"] == false);

    // Off keeps typed chat silent; on again speaks it once.
    run.ui.ok("/run/disable_tts", None);
    run.send("while-off");
    run.heard.stays_quiet(Duration::from_millis(1500), "while off");
    assert_eq!(run.enable()["status"], 200);
    run.heard_once("on-again");

    // A server that fails mid-speech silences the microphone and is reported.
    run.cut_by("server-failure", || run.server.kill());
    common::net::eventually("the failure is reported", || !run.status()["last_error"].is_null());
    run.send("server-down");
    run.heard.stays_quiet(Duration::from_millis(1500), "while the server is down");
    // Started again, it replays nothing old; the next chat speaks once.
    run.server.revive();
    run.heard.stays_quiet(Duration::from_millis(1500), "after the server came back");
    if run.status()["tts_enabled"] != true {
        assert_eq!(run.enable()["status"], 200);
    }
    run.heard_once("after-restart");

    // The core's stop mutes the managed microphone again.
    let Run { ui, heard, _capture, .. } = run;
    ui.stop();
    common::net::eventually("the managed microphone is muted at exit", muted);
    heard.stays_quiet(Duration::from_millis(1000), "after the core stopped");
    drop(_capture);
}
