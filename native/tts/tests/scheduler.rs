//! The speech worker's queueing, interruption and expiry
//! (tests/voice/test_scheduler.py, test_spoken_scheduler.py, test_tts_toggle.py,
//! test_tts_model_options.py and test_speech_through_conversion.py).

mod common;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use common::*;
use vrct_tts::clock::monotonic_ns;
use vrct_tts::converted::ConvertedRouter;
use vrct_tts::playback::{FirstAudio, Frames, Monitor, OutputSink, SpeechRouter};
use vrct_tts::scheduler::{BusOptions, ProviderFactory, Synthesizer};
use vrct_tts::settings::{EngineVoice, SpeechRequest, VoiceSettings};
use vrct_tts::sync::Event;
use vrct_tts::{AudioFrame, CancelToken, Source, SpeechMessageEvent, SynthesisOptions, TtsError, VoiceEventBus};

type Speak = Arc<dyn Fn(&str, &CancelToken, &SynthesisOptions) -> Result<Frames, TtsError> + Send + Sync>;

struct FnSynth(Speak);

impl Synthesizer for FnSynth {
    fn synthesize_stream(&self, request: &SpeechRequest, token: &CancelToken, options: &SynthesisOptions) -> Result<Frames, TtsError> {
        (self.0)(&request.text, token, options)
    }
}

fn provider(speak: impl Fn(&str, &CancelToken, &SynthesisOptions) -> Result<Frames, TtsError> + Send + Sync + 'static) -> ProviderFactory {
    let speak: Speak = Arc::new(speak);
    Arc::new(move |_url: &str| -> Result<Box<dyn Synthesizer>, TtsError> { Ok(Box::new(FnSynth(speak.clone()))) })
}

fn frames(pcm: Vec<u8>) -> Frames {
    Box::new(std::iter::once(Ok(AudioFrame::mono(pcm, 48000).unwrap())))
}

/// Waits on the token, then yields one sample unless cancelled.
fn blocking(entered: Event) -> ProviderFactory {
    provider(move |_, token, _| {
        entered.set();
        token.wait(Duration::from_secs(2));
        token.check()?;
        Ok(frames(vec![1, 0]))
    })
}

fn original() -> VoiceSettings {
    VoiceSettings { mode: "original".into(), output_device: "cable".into(), ..Default::default() }
}

fn speech_settings() -> VoiceSettings {
    VoiceSettings { mic_mode: "translated".into(), direct_policy: "mix".into(), output_device: "cable".into(), ..Default::default() }
}

fn bus(settings: VoiceSettings, sink: &Sink, configure: impl FnOnce(&mut BusOptions)) -> VoiceEventBus {
    let mut options = BusOptions::new(router(sink).0);
    configure(&mut options);
    VoiceEventBus::new(settings, options)
}

fn ms(value: u64) -> Duration {
    Duration::from_millis(value)
}

fn close(bus: &VoiceEventBus) {
    assert!(bus.close(Duration::from_secs(3)));
}

#[test]
fn fake_http_to_explicit_output_once() {
    let server = PcmServer::start(ServerOptions { rate: Some("24000".into()), ..Default::default() });
    let sink = Sink::default();
    let (router, opens) = router(&sink);
    let settings = VoiceSettings { output_device: "virtual-cable".into(), japanese_url: server.url.clone(), ..original() };
    let bus = VoiceEventBus::new(settings, BusOptions::new(router));
    assert!(bus.publish(chat("one"), None, None));
    assert!(!bus.publish(chat("one"), None, None));
    until2(|| bus.status().completed == 1);
    assert_eq!(server.posts().len(), 1);
    assert_eq!(*opens.lock().unwrap(), vec![("virtual-cable".to_string(), 24000, 1)]);
    assert_eq!(sink.bytes(), [1, 0, 2, 0]);
    assert_eq!(*sink.closed.lock().unwrap(), vec![true]);
    let status = bus.status();
    assert!(status.last_first_write_ms.is_some());
    assert_eq!((status.duplicates, status.sample_rate), (1, Some(24000)));
    close(&bus);
}

#[test]
fn off_partial_and_remote_never_open_outputs() {
    let sink = Sink::default();
    let off = bus(VoiceSettings::default(), &sink, |_| {});
    assert!(!off.publish(chat("one"), None, None));
    assert!(!off.worker_started());
    off.configure(original());
    for source in ["mic", "speaker", "ocr"] {
        assert!(!off.publish(SpeechMessageEvent { source: Source::parse(source), ..chat(source) }, None, None));
    }
    assert!(!off.publish(SpeechMessageEvent { is_final: false, ..chat("partial") }, None, None));
    assert!(!off.publish(SpeechMessageEvent { original_text: " ".into(), ..chat("blank") }, None, None));
    assert!(!off.publish(SpeechMessageEvent { event_id: String::new(), ..chat("") }, None, None));
    assert!(!off.worker_started());
    close(&off);
}

#[test]
fn bounded_queue_cancel_and_old_generation() {
    let entered = Event::new();
    let bus = bus(original(), &Sink::default(), |o| o.provider_factory = blocking(entered.clone()));
    let old = bus.generation();
    assert!(bus.publish(chat("active"), None, None));
    assert!(entered.wait(Some(Duration::from_secs(1))));
    for i in 0..20 {
        bus.publish(chat(&i.to_string()), None, None);
    }
    let status = bus.status();
    assert_eq!((status.queued, status.dropped, status.expired), (4, 16, 0));
    bus.cancel();
    assert!(!bus.publish(chat("stale"), Some(old), None));
    until2(|| !bus.status().active);
    assert_eq!((bus.status().queued, bus.status().cancelled), (0, 1));
    close(&bus);
}

#[test]
fn expired_jobs_do_not_speak() {
    let sink = Sink::default();
    let bus = bus(original(), &sink, |o| o.provider_factory = provider(|_, _, _| Ok(frames(vec![1, 0]))));
    assert!(bus.publish(SpeechMessageEvent { timestamp_ns: monotonic_ns() - 6_000_000_000, ..chat("old") }, None, None));
    until2(|| bus.status().dropped == 1);
    assert_eq!((bus.status().completed, bus.status().expired), (0, 1));
    assert!(sink.data.lock().unwrap().is_empty());
    close(&bus);
}

#[test]
fn stopping_speech_is_not_reported_as_expired() {
    let entered = Event::new();
    let bus = bus(original(), &Sink::default(), |o| o.provider_factory = blocking(entered.clone()));
    bus.publish(chat("active"), None, None);
    assert!(entered.wait(Some(Duration::from_secs(1))));
    bus.publish(chat("waiting"), None, None);
    bus.cancel();
    until2(|| !bus.status().active);
    assert_eq!((bus.status().dropped, bus.status().expired), (1, 0));
    close(&bus);
}

#[test]
fn errors_are_private_and_worker_recovers() {
    let sink = Sink::default();
    let attempts = Arc::new(Mutex::new(0));
    let reports: Arc<Mutex<Vec<String>>> = Arc::default();
    let (counter, record) = (attempts.clone(), reports.clone());
    let bus = bus(original(), &sink, |o| {
        o.provider_factory = provider(move |_, _, _| {
            let mut count = counter.lock().unwrap();
            *count += 1;
            if *count == 1 {
                // Python: RuntimeError("secret spoken text / path / token").
                return Err(TtsError::Output);
            }
            Ok(frames(vec![1, 0]))
        });
        o.on_failure = Some(Arc::new(move |code: &str| record.lock().unwrap().push(code.to_owned())));
    });
    bus.publish(chat("first"), None, None);
    until2(|| bus.status().errors == 1);
    assert_eq!(bus.status().last_error.as_deref(), Some("audio_output_error"));
    assert_eq!(*reports.lock().unwrap(), vec!["audio_output_error"]);
    bus.publish(chat("second"), None, None);
    until2(|| bus.status().completed == 1);
    assert_eq!(bus.status().last_error, None);
    close(&bus);
}

#[test]
fn settings_errors_never_show_their_message() {
    // English without a multilingual server: a settings error, shown only by class.
    let bus = bus(original(), &Sink::default(), |_| {});
    bus.publish(SpeechMessageEvent { source_language: Some("English".into()), ..chat("en") }, None, None);
    until2(|| bus.status().errors == 1);
    assert_eq!(bus.status().last_error.as_deref(), Some("language_or_text_unavailable"));
    close(&bus);
}

#[test]
fn whole_request_deadline() {
    let release = Event::new();
    let gate = release.clone();
    let server = PcmServer::start(ServerOptions {
        before_chunk: Some(Arc::new(move |_| {
            gate.wait(Some(Duration::from_secs(1)));
        })),
        ..Default::default()
    });
    let settings = VoiceSettings { japanese_url: server.url.clone(), ..original() };
    let bus = bus(settings, &Sink::default(), |o| o.request_timeout = ms(50));
    bus.publish(chat("one"), None, None);
    until2(|| bus.status().errors == 1);
    assert_eq!(bus.status().last_error.as_deref(), Some("request_timeout"));
    release.set();
    close(&bus);
}

#[test]
fn real_timeout_still_cancels_its_own_utterance() {
    let tokens: Arc<Mutex<Vec<CancelToken>>> = Arc::default();
    let record = tokens.clone();
    let sink = Sink::default();
    let bus = bus(original(), &sink, |o| {
        o.request_timeout = ms(50);
        o.provider_factory = provider(move |_, token, _| {
            record.lock().unwrap().push(token.clone());
            token.wait(Duration::from_secs(2));
            token.check()?;
            Ok(frames(vec![1, 0]))
        });
    });
    assert!(bus.publish(chat("one"), None, None));
    until2(|| bus.status().errors == 1);
    assert_eq!(tokens.lock().unwrap()[0].reason(), "request_timeout");
    assert_eq!(bus.status().last_error.as_deref(), Some("request_timeout"));
    assert!(sink.data.lock().unwrap().is_empty());
    close(&bus);
}

#[test]
fn a_finished_utterances_timer_cannot_cancel_the_next() {
    let tokens: Arc<Mutex<Vec<CancelToken>>> = Arc::default();
    let (entered, release) = (Event::new(), Event::new());
    let (record, hook_entered, hook_release) = (tokens.clone(), entered.clone(), release.clone());
    let sink = Sink::default();
    let bus = bus(original(), &sink, |o| {
        o.request_timeout = ms(150);
        o.provider_factory = provider(move |_, token, _| {
            let count = {
                let mut tokens = record.lock().unwrap();
                tokens.push(token.clone());
                tokens.len()
            };
            if count == 2 {
                hook_entered.set();
                hook_release.wait(Some(Duration::from_secs(5)));
            }
            token.check()?;
            Ok(frames(vec![1, 0]))
        });
    });
    assert!(bus.publish(chat("first"), None, None));
    until2(|| bus.status().completed == 1);
    assert!(bus.publish(chat("second"), None, None));
    assert!(entered.wait(Some(Duration::from_secs(1))));
    thread::sleep(ms(100));
    let tokens_now = tokens.lock().unwrap().clone();
    assert!(!tokens_now[0].is_set() && !tokens_now[1].is_set());
    release.set();
    until2(|| bus.status().completed == 2);
    assert_eq!(bus.status().errors, 0);
    close(&bus);
}

fn mic_event(id: &str, text: &str) -> SpeechMessageEvent {
    SpeechMessageEvent { translated_text: Some(text.into()), ..mic(id) }
}

#[test]
fn final_mic_translation_is_spoken_once_and_remote_partial_missing_are_rejected() {
    let server = PcmServer::start(ServerOptions::default());
    let sink = Sink::default();
    let bus = bus(VoiceSettings { multilingual_url: server.url.clone(), ..speech_settings() }, &sink, |_| {});
    for rejected in [
        SpeechMessageEvent { is_final: false, ..mic("a") },
        SpeechMessageEvent { translated_text: None, ..mic("a") },
        SpeechMessageEvent { translated_text: Some(" ".into()), ..mic("a") },
        SpeechMessageEvent { source: Source::parse("speaker"), ..chat("x") },
        SpeechMessageEvent { source: Source::parse("ocr"), ..chat("x") },
        SpeechMessageEvent { source: Source::parse("remote"), ..chat("x") },
    ] {
        assert!(!bus.publish(rejected, None, None));
    }
    assert!(bus.publish(mic("session:utterance"), None, None));
    assert!(!bus.publish(SpeechMessageEvent { revision: 2, ..mic("session:utterance") }, None, None));
    until2(|| bus.status().completed == 1);
    assert_eq!(server.posts(), vec![("/v1/audio/speech".to_string(), serde_json::json!({"input": "Hello", "voice": "ryan", "language": "en", "response_format": "pcm"}))]);
    assert_eq!(sink.bytes(), [1, 0, 2, 0]);
    close(&bus);
}

#[test]
fn mic_stop_interrupts_http_and_rejects_old_generation_but_preserves_chat() {
    let (entered, release) = (Event::new(), Event::new());
    let (hook_entered, hook_release) = (entered.clone(), release.clone());
    let server = PcmServer::start(ServerOptions {
        before_chunk: Some(Arc::new(move |_| {
            if !hook_entered.is_set() {
                hook_entered.set();
                hook_release.wait(Some(Duration::from_secs(2)));
            }
        })),
        ..Default::default()
    });
    let sink = Sink::default();
    let settings = VoiceSettings { mode: "original".into(), multilingual_url: server.url.clone(), japanese_url: server.url.clone(), ..speech_settings() };
    let bus = bus(settings, &sink, |_| {});
    // A Japanese translation, so both requests legitimately share one server.
    let spoken = SpeechMessageEvent { target_language: Some("ja".into()), ..mic_event("session:utterance", "訳文") };
    let generation = bus.source_generation(&Source::Mic);
    assert!(bus.publish(spoken, None, Some(generation)));
    assert!(entered.wait(Some(Duration::from_secs(1))));
    assert!(bus.publish(chat("chat"), None, None));
    bus.cancel_source(&Source::Mic);
    assert!(!bus.publish(mic("late"), None, Some(generation)));
    until2(|| bus.status().completed == 1);
    let inputs: Vec<String> = server.posts().iter().map(|(_, body)| body["input"].as_str().unwrap().to_owned()).collect();
    assert_eq!(inputs, ["訳文", "こんにちは"]);
    assert_eq!(sink.bytes(), [1, 0, 2, 0]);
    assert_eq!(bus.status().cancelled, 1);
    release.set();
    close(&bus);
}

#[test]
fn mic_with_invalid_or_old_receipt_time_never_opens_output() {
    let sink = Sink::default();
    let bus = bus(VoiceSettings { multilingual_url: "http://127.0.0.1:8081".into(), ..speech_settings() }, &sink, |_| {});
    for stamp in [0, monotonic_ns() + 10_000_000_000] {
        assert!(!bus.publish(SpeechMessageEvent { timestamp_ns: stamp, ..mic(&stamp.to_string()) }, None, None));
    }
    bus.publish(SpeechMessageEvent { timestamp_ns: monotonic_ns() - 6_000_000_000, ..mic("old") }, None, None);
    until2(|| bus.status().dropped == 3);
    assert_eq!(bus.status().completed, 0);
    assert!(sink.data.lock().unwrap().is_empty());
    close(&bus);
}

#[test]
fn queued_chat_precedes_mic_and_overflow_evicts_oldest_mic() {
    for overflow in [false, true] {
        let (entered, release) = (Event::new(), Event::new());
        let spoken: Arc<Mutex<Vec<String>>> = Arc::default();
        let (record, hook_entered, hook_release) = (spoken.clone(), entered.clone(), release.clone());
        let settings = VoiceSettings { mode: "original".into(), multilingual_url: "http://localhost:8081".into(), ..speech_settings() };
        let bus = bus(settings, &Sink::default(), |o| {
            o.capacity = 2;
            o.provider_factory = provider(move |text, token, _| {
                record.lock().unwrap().push(text.to_owned());
                if text == "active" {
                    hook_entered.set();
                    assert!(hook_release.wait(Some(Duration::from_secs(2))));
                }
                token.check()?;
                Ok(frames(vec![1, 0]))
            });
        });
        assert!(bus.publish(mic_event("active", "active"), None, None));
        assert!(entered.wait(Some(Duration::from_secs(1))));
        assert!(bus.publish(mic_event("old", "old"), None, None));
        assert!(bus.publish(SpeechMessageEvent { source_language: Some("ja".into()), ..SpeechMessageEvent::new("chat", Source::Chat, "chat") }, None, None));
        if overflow {
            assert!(bus.publish(mic_event("new", "new"), None, None));
        }
        release.set();
        until2(|| bus.status().completed == 3);
        assert_eq!(*spoken.lock().unwrap(), ["active", "chat", if overflow { "new" } else { "old" }]);
        assert_eq!(bus.status().dropped, overflow as u64);
        close(&bus);
    }
}

#[test]
fn mic_cannot_evict_queued_chat_or_cancel_active_chat() {
    let (entered, release) = (Event::new(), Event::new());
    let spoken: Arc<Mutex<Vec<String>>> = Arc::default();
    let (record, hook_entered, hook_release) = (spoken.clone(), entered.clone(), release.clone());
    let settings = VoiceSettings { mode: "original".into(), multilingual_url: "http://localhost:8081".into(), ..speech_settings() };
    let bus = bus(settings, &Sink::default(), |o| {
        o.capacity = 2;
        o.provider_factory = provider(move |text, token, _| {
            if record.lock().unwrap().is_empty() {
                hook_entered.set();
                assert!(hook_release.wait(Some(Duration::from_secs(2))));
            }
            token.check()?;
            record.lock().unwrap().push(text.to_owned());
            Ok(frames(vec![1, 0]))
        });
    });
    for identity in ["active", "chat1", "chat2"] {
        assert!(bus.publish(SpeechMessageEvent { source_language: Some("ja".into()), ..SpeechMessageEvent::new(identity, Source::Chat, identity) }, None, None));
        assert!(entered.wait(Some(Duration::from_secs(1))));
    }
    assert!(!bus.publish(mic("session:utterance"), None, None));
    bus.cancel_source(&Source::Mic);
    release.set();
    until2(|| bus.status().completed == 3);
    assert_eq!(*spoken.lock().unwrap(), ["active", "chat1", "chat2"]);
    assert_eq!((bus.status().cancelled, bus.status().dropped), (0, 1));
    close(&bus);
}

#[test]
fn start_deadline_includes_inference_and_output_open() {
    for delay in ["headers", "pcm", "output"] {
        let (entered, release) = (Event::new(), Event::new());
        let stall: Arc<dyn Fn() + Send + Sync> = {
            let (entered, release) = (entered.clone(), release.clone());
            // The stall outlasts the wait below, so expiry happens while the
            // server (or the device) is still blocked; teardown releases it.
            Arc::new(move || {
                entered.set();
                release.wait(Some(Duration::from_secs(10)));
            })
        };
        let server = match delay {
            "headers" => PcmServer::start(ServerOptions { before_headers: Some(stall.clone()), ..Default::default() }),
            "pcm" => {
                let stall = stall.clone();
                PcmServer::start(ServerOptions { before_chunk: Some(Arc::new(move |_| stall())), ..Default::default() })
            }
            _ => PcmServer::start(ServerOptions::default()),
        };
        let sink = Sink::default();
        let output_stall = (delay == "output").then(|| stall.clone());
        let output_sink = sink.clone();
        let factory = move |_: &str, _: u32, _: u16| -> Result<Box<dyn OutputSink>, TtsError> {
            if let Some(stall) = &output_stall {
                stall();
            }
            Ok(Box::new(output_sink.clone()))
        };
        let mut options = BusOptions::new(Arc::new(vrct_tts::playback::AudioRouter::new(Arc::new(factory))));
        options.max_age = ms(150);
        let bus = VoiceEventBus::new(VoiceSettings { multilingual_url: server.url.clone(), ..speech_settings() }, options);
        assert!(bus.publish(mic("session:utterance"), None, None));
        assert!(entered.wait(Some(Duration::from_secs(1))));
        if delay == "output" {
            thread::sleep(ms(200));
            release.set();
        }
        until(|| bus.status().errors == 1, Duration::from_secs(3));
        assert_eq!(bus.status().last_error.as_deref(), Some("speech_expired"), "{delay}");
        assert!(sink.data.lock().unwrap().is_empty());
        release.set();
        close(&bus);
    }
}

#[test]
fn start_deadline_never_truncates_started_speech() {
    let server = PcmServer::start(ServerOptions {
        chunks: vec![vec![1, 0], vec![2, 0]],
        before_chunk: Some(Arc::new(|i| {
            if i == 1 {
                thread::sleep(ms(250));
            }
        })),
        ..Default::default()
    });
    let sink = Sink::default();
    let bus = bus(VoiceSettings { multilingual_url: server.url.clone(), ..speech_settings() }, &sink, |o| o.max_age = ms(150));
    assert!(bus.publish(mic("session:utterance"), None, None));
    until2(|| bus.status().completed == 1);
    assert_eq!(sink.bytes(), [1, 0, 2, 0]);
    assert_eq!(bus.status().errors, 0);
    close(&bus);
}

#[test]
fn silent_pcm_does_not_disable_start_deadline() {
    let release = Event::new();
    let gate = release.clone();
    let server = PcmServer::start(ServerOptions {
        chunks: vec![vec![0, 0], vec![1, 0]],
        before_chunk: Some(Arc::new(move |i| {
            if i == 1 {
                gate.wait(Some(Duration::from_secs(10)));
            }
        })),
        ..Default::default()
    });
    let sink = Sink::default();
    let bus = bus(VoiceSettings { multilingual_url: server.url.clone(), ..speech_settings() }, &sink, |o| o.max_age = ms(150));
    assert!(bus.publish(mic("session:utterance"), None, None));
    until(|| bus.status().errors == 1, Duration::from_secs(3));
    assert_eq!(bus.status().last_error.as_deref(), Some("speech_expired"));
    assert_eq!(sink.bytes(), [0, 0]);
    assert_eq!(bus.status().last_first_write_ms, None);
    release.set();
    close(&bus);
}

#[test]
fn disabled_bus_rejects_both_sources_until_explicit_enable() {
    let sink = Sink::default();
    let settings = VoiceSettings { mode: "original".into(), mic_mode: "translated".into(), output_device: "cable".into(), ..Default::default() };
    let bus = bus(settings, &sink, |o| {
        o.enabled = false;
        o.provider_factory = provider(|_, _, _| Ok(frames(vec![1, 0])));
    });
    let spoken_mic = |id: &str| SpeechMessageEvent { translated_text: Some("訳文".into()), target_language: Some("Japanese".into()), ..mic(id) };
    assert!(!bus.publish(chat("off-chat"), None, None));
    assert!(!bus.publish(spoken_mic("off-mic"), None, None));
    let old = bus.generation();
    assert!(bus.set_enabled(true, Some(old)));
    assert!(bus.publish(chat("on-chat"), None, None));
    assert!(bus.publish(spoken_mic("on-mic"), None, None));
    until2(|| bus.status().completed == 2);
    assert_eq!(sink.bytes(), [1, 0, 1, 0]);
    bus.set_enabled(false, None);
    bus.set_muted(true);
    bus.set_muted(false);
    bus.configure((*bus.settings()).clone());
    assert!(!bus.status().tts_enabled);
    assert!(!bus.publish(chat("still-off"), None, None));
    close(&bus);
}

#[test]
fn off_cancels_active_and_queue_and_invalidates_delayed_enable() {
    let (entered, release) = (Event::new(), Event::new());
    let (hook_entered, hook_release) = (entered.clone(), release.clone());
    let bus = bus(original(), &Sink::default(), |o| {
        o.provider_factory = provider(move |_, token, _| {
            hook_entered.set();
            hook_release.wait(Some(Duration::from_secs(2)));
            token.check()?;
            Ok(frames(vec![1, 0]))
        })
    });
    bus.publish(chat("active"), None, None);
    assert!(entered.wait(Some(Duration::from_secs(1))));
    bus.publish(chat("queued"), None, None);
    let old = bus.status().tts_generation;
    assert!(bus.set_enabled(false, None));
    assert_eq!(bus.status().queued, 0);
    assert!(bus.status().tts_stopping);
    assert!(!bus.set_enabled(true, Some(old)));
    let newer = bus.status().tts_generation;
    bus.set_enabled(false, None); // Repeated OFF still revokes queued enables.
    assert!(!bus.set_enabled(true, Some(newer)));
    assert!(bus.set_enabled(true, Some(bus.generation())));
    assert!(!bus.publish(chat("late-final"), Some(old), None));
    release.set();
    until2(|| !bus.status().active);
    assert!(!bus.status().tts_stopping);
    assert_eq!(bus.status().cancelled, 1);
    close(&bus);
}

#[test]
fn mute_invalidates_both_edges_and_blocks_enable() {
    let bus = bus(original(), &Sink::default(), |o| o.provider_factory = provider(|_, _, _| Ok(frames(vec![1, 0]))));
    let first = bus.generation();
    bus.set_muted(true);
    assert!(bus.status().muted);
    assert!(!bus.publish(chat("muted"), None, None));
    assert!(!bus.set_enabled(true, None));
    bus.set_muted(true); // No edge, no new generation.
    assert_eq!(bus.generation(), first + 1);
    bus.set_muted(false);
    assert_eq!(bus.generation(), first + 2);
    assert!(bus.publish(chat("unmuted"), Some(first + 2), None));
    until2(|| bus.status().completed == 1);
    close(&bus);
    assert!(!bus.set_enabled(true, None), "nothing re-enables a closed bus");
    assert!(bus.status().closed);
}

#[test]
fn status_observations_strictly_increase() {
    let bus = bus(original(), &Sink::default(), |_| {});
    let ids: Vec<i64> = (0..100).map(|_| bus.status().observation_id.parse().unwrap()).collect();
    assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
    let status = serde_json::to_value(bus.status()).unwrap();
    for key in [
        "accepted",
        "completed",
        "dropped",
        "expired",
        "duplicates",
        "cancelled",
        "errors",
        "last_error",
        "last_first_write_ms",
        "sample_rate",
        "monitor_error",
        "queued",
        "active",
        "mode",
        "closed",
        "muted",
        "tts_enabled",
        "tts_generation",
        "tts_stopping",
        "observation_id",
    ] {
        assert!(status.get(key).is_some(), "{key}");
    }
    close(&bus);
}

#[test]
fn mic_translation_uses_target_language_generation_options() {
    let card = serde_json::json!({"data": [{"id": "tts-test", "speech": {"task": "synthesis", "options": [
        {"name": "seed", "type": "int", "minimum": 0, "maximum": 9007199254740991u64}, {"name": "instructions", "type": "string"}]}}]});
    let server = PcmServer::start(ServerOptions { model_document: Arc::new(Mutex::new(card)), ..Default::default() });
    let settings = VoiceSettings {
        multilingual_url: server.url.clone(),
        japanese_seed: "1".into(),
        multilingual_seed: "2".into(),
        japanese_instructions: "日本語用".into(),
        multilingual_instructions: "English style".into(),
        ..speech_settings()
    };
    let bus = bus(settings, &Sink::default(), |_| {});
    assert!(bus.publish(SpeechMessageEvent { translated_text: Some("hello".into()), target_language: Some("English".into()), ..mic("mic") }, None, None));
    until2(|| bus.status().completed == 1);
    let body = &server.posts()[0].1;
    assert_eq!((body["seed"].as_u64(), body["instructions"].as_str(), body["input"].as_str()), (Some(2), Some("English style"), Some("hello")));
    close(&bus);
}

struct Played {
    played: Mutex<Vec<(usize, bool)>>,
    available: bool,
}

impl SpeechRouter for Played {
    fn play(&self, frames: Frames, _device: &str, _token: &CancelToken, first: FirstAudio<'_>, monitor: Option<Arc<dyn Monitor>>) -> Result<(), TtsError> {
        self.played.lock().unwrap().push((frames.count(), monitor.is_some()));
        first(1, 48000)?;
        Ok(())
    }
}

impl ConvertedRouter for Played {
    fn available(&self) -> bool {
        self.available
    }
}

fn run_conversion(conversion: &str, available: bool) -> (usize, usize, Vec<bool>) {
    let device = Arc::new(Played { played: Mutex::default(), available: true });
    let converted = Arc::new(Played { played: Mutex::default(), available });
    let hooks: Arc<Mutex<Vec<bool>>> = Arc::default();
    let record = hooks.clone();
    let mut options = BusOptions::new(device.clone());
    options.provider_factory = provider(|_, _, _| Ok(frames([1, 0].repeat(480))));
    options.converted_router = Some(converted.clone());
    options.on_first_audio = Some(Arc::new(move |_event: &SpeechMessageEvent, _at: i64, through: bool, _asked: i64| record.lock().unwrap().push(through)));
    let settings = VoiceSettings { japanese_server: "external".into(), conversion: conversion.into(), ..original() };
    let bus = VoiceEventBus::new(settings, options);
    assert!(bus.publish(chat("e1"), None, None));
    until2(|| bus.status().completed + bus.status().errors > 0);
    close(&bus);
    let device_count = device.played.lock().unwrap().len();
    let converted_played = converted.played.lock().unwrap().clone();
    assert!(converted_played.iter().all(|(_, monitor)| !monitor), "the conversion gets no speech monitor");
    let result = (device_count, converted_played.len(), hooks.lock().unwrap().clone());
    result
}

#[test]
fn tts_goes_through_the_conversion_only_when_asked_and_when_one_runs() {
    assert_eq!(run_conversion("on", true), (0, 1, vec![true]));
    assert_eq!(run_conversion("on", false), (1, 0, vec![false]));
    assert_eq!(run_conversion("off", true), (1, 0, vec![false]));
}

#[test]
fn a_panicking_first_audio_readout_never_stops_speech() {
    let sink = Sink::default();
    let bus = bus(original(), &sink, |o| {
        o.provider_factory = provider(|_, _, _| Ok(frames(vec![1, 0])));
        o.on_first_audio = Some(Arc::new(|_: &SpeechMessageEvent, _: i64, _: bool, _: i64| panic!("readout failure")));
    });
    assert!(bus.publish(chat("one"), None, None));
    until2(|| bus.status().completed == 1);
    assert_eq!(sink.bytes(), [1, 0]);
    close(&bus);
}

#[test]
fn the_first_audio_readout_tells_when_synthesis_was_asked_for() {
    let sink = Sink::default();
    let times: Arc<Mutex<Vec<(i64, i64, i64)>>> = Arc::default();
    let record = times.clone();
    let bus = bus(original(), &sink, |o| {
        o.provider_factory = provider(|_, _, _| {
            thread::sleep(Duration::from_millis(30));
            Ok(frames(vec![1, 0]))
        });
        o.on_first_audio = Some(Arc::new(move |event: &SpeechMessageEvent, at: i64, _: bool, asked: i64| record.lock().unwrap().push((event.timestamp_ns, asked, at))));
    });
    assert!(bus.publish(chat("one"), None, None));
    until2(|| bus.status().completed == 1);
    close(&bus);
    let times = times.lock().unwrap().clone();
    assert_eq!(times.len(), 1);
    let (published, asked, at) = times[0];
    assert!(published <= asked && asked <= at, "{times:?}");
    // The engine's 30 ms come after the request, so they count as synthesis.
    assert!(at - asked >= 25_000_000, "{times:?}");
}

#[test]
fn japanese_plays_through_the_engine_and_speechcpp_keeps_the_rest() {
    let used: Arc<Mutex<Vec<(String, String)>>> = Arc::default();
    let sink = Sink::default();
    let (speechcpp_used, engine_used) = (used.clone(), used.clone());
    let bus = bus(
        VoiceSettings {
            japanese_engine: "voicevox".into(),
            engine_voice_id: "3".into(),
            engine_voice_speaker: "ずんだもん".into(),
            engine_voice_style: "ノーマル".into(),
            japanese_seed: "7".into(),
            ..original()
        },
        &sink,
        |o| {
            o.provider_factory = Arc::new(move |url: &str| -> Result<Box<dyn Synthesizer>, TtsError> {
                speechcpp_used.lock().unwrap().push(("speechcpp".into(), url.into()));
                Ok(Box::new(FnSynth(Arc::new(|_, _, _| Ok(frames(vec![1, 0]))))))
            });
            o.engine_factory = Some(Arc::new(move |engine: &str, url: &str| -> Result<Box<dyn Synthesizer>, TtsError> {
                engine_used.lock().unwrap().push((engine.into(), url.into()));
                Ok(Box::new(EngineSynth))
            }));
        },
    );
    assert!(bus.publish(chat("ja"), None, None));
    until2(|| bus.status().completed == 1);
    close(&bus);
    assert_eq!(*used.lock().unwrap(), vec![("voicevox".to_string(), "http://127.0.0.1:50021".to_string())]);
    assert_eq!(sink.bytes(), [2, 0]);
}

struct EngineSynth;

impl Synthesizer for EngineSynth {
    fn synthesize_stream(&self, request: &SpeechRequest, _token: &CancelToken, options: &SynthesisOptions) -> Result<Frames, TtsError> {
        assert_eq!(request.engine_voice, Some(EngineVoice { id: "3".into(), speaker: "ずんだもん".into(), style: "ノーマル".into() }));
        assert_eq!(*options, SynthesisOptions::default(), "the seed is speech.cpp's");
        Ok(Box::new(std::iter::once(Ok(AudioFrame::mono(vec![2, 0], 24000).unwrap()))))
    }
}

#[test]
fn an_engine_without_a_client_or_voice_is_a_safe_error() {
    let bus = bus(VoiceSettings { japanese_engine: "voicevox".into(), engine_voice_id: "3".into(), ..original() }, &Sink::default(), |_| {});
    assert!(bus.publish(chat("one"), None, None));
    until2(|| bus.status().errors == 1);
    assert_eq!(bus.status().last_error.as_deref(), Some("language_or_text_unavailable"));
    bus.configure(VoiceSettings { japanese_engine: "coeiroink".into(), ..original() });
    assert!(bus.publish(chat("two"), None, None));
    until2(|| bus.status().errors == 2);
    assert_eq!(bus.status().last_error.as_deref(), Some("tts_engine_voice_unset"));
    close(&bus);
}

#[test]
fn a_panic_outside_an_utterance_leaves_the_bus_usable() {
    let sink = Sink::default();
    let attempts = Arc::new(Mutex::new(0));
    let counter = attempts.clone();
    let bus = bus(original(), &sink, |o| {
        o.provider_factory = provider(move |_, _, _| {
            let mut count = counter.lock().unwrap();
            *count += 1;
            if *count == 1 {
                return Err(TtsError::Output);
            }
            Ok(frames(vec![1, 0]))
        });
        // The failure report runs outside the utterance's own guard.
        o.on_failure = Some(Arc::new(|_: &str| panic!("report failure")));
    });
    assert!(bus.publish(chat("first"), None, None));
    until2(|| bus.status().errors == 1 && !bus.worker_started());
    assert!(!bus.status().active);
    assert!(bus.publish(chat("second"), None, None), "a new worker takes over");
    until2(|| bus.status().completed == 1);
    close(&bus);
}
