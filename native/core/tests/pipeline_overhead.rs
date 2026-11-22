//! The time the voice pipeline adds of its own (#738), from a final of realtime recognition to
//! the chatbox and to audible speech, with translation and translated speech on. Every engine
//! is a stand-in that answers at once: the realtime recognition server (`common::fake_asr`),
//! DeepL (`vrct_translation::fake`) and a speech.cpp TTS server whose speech starts with the
//! silence speech.cpp's does (`common::fake_tts`). What is left is the core's: its threads and
//! queues, its requests on 127.0.0.1, and the silence it skips at the start of speech.
//!
//! It is not the time a user waits: recognition, translation and synthesis on real models take
//! most of that, and `examples/pipeline_latency.rs` measures it. This one runs on any CI runner,
//! so a change to the core that slows the pipeline shows in the pull request.
//!
//! It runs only when asked:
//!
//! ```sh
//! ASTAROT_PIPELINE_BMF=pipeline.json cargo test --locked --manifest-path native/core/Cargo.toml \
//!     --test pipeline_overhead -- --ignored --nocapture
//! ```
//!
//! The percentiles go to the file `ASTAROT_PIPELINE_BMF` names, in Bencher Metric Format
//! (`bmf`). CI measures in `voice-tests.yml` and sends them to Bencher in
//! `pipeline-latency.yml`. It fails only when an utterance does not reach both outputs. Only
//! times are printed, never a message.

mod bmf;
mod common;

use common::fake_asr::FakeAsr;
use common::fake_capture::FakeCapture;
use common::fake_tts::FakeTts;
use common::fake_voice::FakeVoice;
use common::{Setup, Ui};
use serde_json::json;
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vrct_adapters::osc::decode_packet;
use vrct_audio_routing::router::{Output, PlaybackToken};
use vrct_core::config::Platform;
use vrct_core::controller::voice::VoicePlatform;
use vrct_transcription::capture::Source;

const OUTPUT: &str = "pipeline-overhead";
/// Utterances that warm the pipeline up; they are not counted.
const WARM_UP: usize = 3;
/// Utterances measured.
const UTTERANCES: usize = 40;
/// How long an utterance may take to reach both outputs.
const DELIVERY: Duration = Duration::from_secs(10);
/// The benchmarks on Bencher.
const TO_CHATBOX: &str = "core: final to chatbox";
const TO_VOICE: &str = "core: final to audible speech";

// ---------------------------------------------------------------------------------------------
// The speech output: when speech becomes audible

/// When each speech became audible: its first write with a sample above 64, the threshold of
/// `pipeline_latency` and `vrct_tts::onset`. The device takes the audio in real time.
#[derive(Clone, Default)]
struct Speaker {
    audible: Arc<Mutex<Vec<Instant>>>,
    closed: Arc<AtomicUsize>,
}

struct Playback {
    speaker: Speaker,
    bytes_per_second: f64,
    opened: Instant,
    played: f64,
    heard: bool,
}

impl Output for Playback {
    fn write(&mut self, pcm: &[u8], token: &dyn PlaybackToken) -> vrct_audio_routing::Result<()> {
        token.check()?;
        if !self.heard && pcm.as_chunks::<2>().0.iter().any(|s| i16::from_le_bytes(*s).unsigned_abs() > 64) {
            self.heard = true;
            self.speaker.audible.lock().unwrap().push(Instant::now());
        }
        // A device takes the audio in real time and buffers 40 ms ahead.
        self.played += pcm.len() as f64 / self.bytes_per_second;
        let ahead = self.played - self.opened.elapsed().as_secs_f64() - 0.040;
        if ahead > 0.0 {
            std::thread::sleep(Duration::from_secs_f64(ahead));
        }
        Ok(())
    }

    fn close(&mut self, _: bool, _: &dyn PlaybackToken) -> vrct_audio_routing::Result<()> {
        self.speaker.closed.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

/// The fake's voice platform, with speech to the [`Speaker`].
struct Voice {
    fake: FakeVoice,
    speaker: Speaker,
}

impl VoicePlatform for Voice {
    fn direct_sources(&self) -> vrct_audio_routing::Result<Vec<vrct_audio_routing::graph::Source>> {
        self.fake.direct_sources()
    }
    fn default_microphone(&self) -> Option<String> {
        self.fake.default_microphone()
    }
    fn speech_output(&self, device: &str, rate: u32, channels: u16) -> vrct_audio_routing::Result<Box<dyn Output>> {
        assert_eq!(device, OUTPUT, "speech went to another output");
        let bytes_per_second = f64::from(rate) * f64::from(channels) * 2.0;
        Ok(Box::new(Playback { speaker: self.speaker.clone(), bytes_per_second, opened: Instant::now(), played: 0.0, heard: false }))
    }
    fn monitor_output(&self) -> vrct_audio_routing::monitor::MonitorFactory {
        self.fake.monitor_output()
    }
    fn gate(&self, app_dir: &Path) -> Arc<dyn vrct_audio_routing::voice_route::Gate> {
        VoicePlatform::gate(&self.fake, app_dir)
    }
    fn passthrough(&self, app_dir: &Path, output: Option<&str>) -> Result<Box<dyn vrct_voice_conversion::DirectBackend>, String> {
        self.fake.passthrough(app_dir, output)
    }
    fn route_devices(&self) -> Option<Arc<dyn vrct_audio_routing::windows_route::RouteDevices>> {
        self.fake.route_devices()
    }
    fn managed_vc_devices(&self) -> Option<Arc<dyn vrct_audio_routing::managed_vc::ManagedVcDevices>> {
        self.fake.managed_vc_devices()
    }
    fn rvc_worker(&self, app_dir: &Path) -> PathBuf {
        self.fake.rvc_worker(app_dir)
    }
    fn runtime_transport(&self) -> Arc<dyn vrct_ops::downloads::transport::Transport> {
        self.fake.runtime_transport()
    }
    fn nvidia_driver(&self) -> bool {
        self.fake.nvidia_driver()
    }
    fn runtime_target(&self) -> Option<vrct_voice_conversion::runtime::Target> {
        self.fake.runtime_target()
    }
    fn runtime_entries(&self) -> Option<Vec<vrct_voice_conversion::runtime::Runtime>> {
        self.fake.runtime_entries()
    }
}

// ---------------------------------------------------------------------------------------------
// The chatbox

/// When each chatbox message arrived on `socket`.
fn chatbox(socket: UdpSocket) -> Arc<Mutex<Vec<Instant>>> {
    let arrived: Arc<Mutex<Vec<Instant>>> = Arc::default();
    let seen = Arc::clone(&arrived);
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while let Ok(size) = socket.recv(&mut buffer) {
            let at = Instant::now();
            let messages = decode_packet(&buffer[..size]).unwrap_or_default();
            if messages.iter().any(|m| m.address == "/chatbox/input") {
                seen.lock().unwrap().push(at);
            }
        }
    });
    arrived
}

fn ms(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1e4).round() / 10.0
}

#[test]
#[ignore = "a measurement; CI runs it for Bencher (voice-tests.yml)"]
fn the_core_s_own_time_from_a_final_to_the_chatbox_and_to_audible_speech() {
    let asr = FakeAsr::start();
    // An utterance comes only when the test asks for one.
    asr.behaviour.realtime_after.store(0, Ordering::SeqCst);
    let capture = FakeCapture::new();
    capture.add_endpoint(Source::Mic, "alsa.mic", "USB Mic");
    capture.set_default(Source::Mic, Some("alsa.mic"));
    let providers = vrct_translation::fake::FakeProviders::start();
    let key = format!("{}:fx", "d".repeat(36));
    providers.key("/deepl-free", &key);
    // The translation is spoken by the multilingual server; Japanese needs a server of its own.
    let (japanese, english) = (FakeTts::speechcpp(0.2), FakeTts::speechcpp(0.2));
    // speech.cpp's Qwen3-TTS starts each speech with about 0.42 s below the audible threshold
    // (docs/voice-stack/pipeline-latency-2026-11-18.md); the core skips it.
    english.set_leading_silence(0.42);
    let socket = UdpSocket::bind(("127.0.0.2", 0)).unwrap();
    let saved = json!({
        "AUTH_KEYS": { "DeepL_API": key },
        "OSC_IP_ADDRESS": "127.0.0.2",
        "OSC_PORT": socket.local_addr().unwrap().port(),
        "REALTIME_ASR_SETTINGS": {
            "version": 1, "server": "external", "start_server": true, "base_url": asr.base(), "model": "haas-ja",
            "mic": { "language": "ja", "endpoint": null, "follow_default": true },
            "speaker": { "language": "ja", "endpoint": null, "follow_default": true },
            "vocabulary": { "builtin": true, "terms": [] },
        },
    });
    let speaker = Speaker::default();
    // Linux: the main switch runs realtime recognition.
    let mut setup = Setup { saved: Some(saved), platform: Platform::Linux, ..Setup::default() };
    setup.services.transcription_capture = capture.factory();
    setup.services.translation_endpoints = vrct_translation::providers::Endpoints::all_at(&providers.url());
    setup.services.voice = Arc::new(Voice { fake: FakeVoice::new(), speaker: speaker.clone() });
    let ui = Ui::with(setup);
    ui.ready();

    // Translation through DeepL, and the translation spoken.
    let mut engines = ui.ok("/get/data/selected_translation_engines", None);
    engines["1"] = json!("DeepL_API");
    ui.ok("/set/data/selected_translation_engines", Some(engines));
    assert_eq!(ui.ok("/set/enable/translation", None), true);
    let voice = json!({
        "mode": "translated", "mic_mode": "translated", "direct_policy": "mix", "routing": "external", "output_device": OUTPUT,
        "japanese_server": "external", "japanese_url": japanese.url, "multilingual_server": "external", "multilingual_url": english.url,
    });
    let answer = ui.request("/set/data/voice_settings", Some(voice));
    assert_eq!(answer["status"], 200, "{answer}");
    let generation = ui.ok("/get/data/voice_status", None)["tts_generation"].clone();
    assert_eq!(ui.ok("/run/enable_tts", Some(json!({ "generation": generation })))["tts_enabled"], true);
    let arrived = chatbox(socket);
    assert_eq!(ui.ok("/set/enable/transcription_send", None), true);
    common::net::eventually("the microphone streams to the server", || asr.appends.load(Ordering::SeqCst) > 0);

    let (mut to_chatbox, mut to_voice) = (Vec::new(), Vec::new());
    for n in 0..WARM_UP + UTTERANCES {
        // A new text each time: nothing is answered from a cache.
        *asr.behaviour.text.lock().unwrap() = format!("発話{n}");
        asr.behaviour.realtime_announce.fetch_add(1, Ordering::SeqCst);
        let deadline = Instant::now() + DELIVERY;
        loop {
            let announced = asr.behaviour.realtime_announced.lock().unwrap().get(n).copied();
            let chat = arrived.lock().unwrap().get(n).copied();
            let audible = speaker.audible.lock().unwrap().get(n).copied();
            let closed = speaker.closed.load(Ordering::SeqCst) > n;
            if let (Some(announced), Some(chat), Some(audible), true) = (announced, chat, audible, closed) {
                if n >= WARM_UP {
                    to_chatbox.push(ms(chat.saturating_duration_since(announced)));
                    to_voice.push(ms(audible.saturating_duration_since(announced)));
                }
                break;
            }
            assert!(
                Instant::now() < deadline,
                "utterance {n} did not arrive within {DELIVERY:?}: announced {}, chatbox {}, audible {}, closed {closed}",
                announced.is_some(),
                chat.is_some(),
                audible.is_some()
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    ui.stop();

    let benchmarks: [(&str, &[f64]); 2] = [(TO_CHATBOX, &to_chatbox), (TO_VOICE, &to_voice)];
    for (name, values) in benchmarks {
        eprintln!("[pipeline] {name}: n={} p50={} ms p95={} ms", values.len(), bmf::percentile(values, 50.0), bmf::percentile(values, 95.0));
    }
    if let Some(path) = std::env::var_os("ASTAROT_PIPELINE_BMF") {
        bmf::write(Path::new(&path), &benchmarks);
    }
}
