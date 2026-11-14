//! Speech owns monitors through their drain, and stop silences them
//! (tests/voice/test_tts_playback_ownership.py).
//!
//! `Tee` stands in for the audio routing's `MonitorTee`: it queues offered
//! blocks, opens its device on its own thread and writes them there.

mod common;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use common::*;
use vrct_tts::playback::{Frames, Monitor};
use vrct_tts::scheduler::{BusOptions, MonitorFactory, MonitorRequest, Synthesizer};
use vrct_tts::settings::{SpeechRequest, VoiceSettings};
use vrct_tts::sync::Event;
use vrct_tts::{AudioFrame, CancelToken, Source, SpeechMessageEvent, SynthesisOptions, TtsError, VoiceEventBus};

type WriteHook = Arc<dyn Fn(usize) + Send + Sync>;
type CloseHook = Arc<dyn Fn(bool) + Send + Sync>;

/// The monitor's device: records writes; hooks can hold a write or the close.
#[derive(Clone, Default)]
struct Device {
    sink: Sink,
    on_write: Arc<Mutex<Option<WriteHook>>>,
    on_close: Arc<Mutex<Option<CloseHook>>>,
}

/// Opening the device waits for `release`.
#[derive(Clone)]
struct Opener {
    entered: Event,
    release: Event,
    device: Device,
}

struct TeeState {
    queue: VecDeque<Vec<u8>>,
    closed: Option<bool>,
}

struct Tee {
    state: Mutex<TeeState>,
    changed: std::sync::Condvar,
    token: CancelToken,
    finished: Event,
}

impl Tee {
    fn start(opener: Opener) -> Arc<Self> {
        let tee = Arc::new(Self { state: Mutex::new(TeeState { queue: VecDeque::new(), closed: None }), changed: std::sync::Condvar::new(), token: CancelToken::new(), finished: Event::new() });
        let worker = tee.clone();
        thread::spawn(move || {
            worker.run(opener);
            worker.finished.set();
        });
        tee
    }

    fn run(&self, opener: Opener) {
        opener.entered.set();
        assert!(opener.release.wait(Some(Duration::from_secs(5))));
        let device = opener.device;
        let mut sink = device.sink.clone();
        let mut drained = false;
        loop {
            let block = {
                let mut state = self.state.lock().unwrap();
                loop {
                    if self.token.is_set() {
                        break None;
                    }
                    if let Some(block) = state.queue.pop_front() {
                        break Some(block);
                    }
                    if let Some(drain) = state.closed {
                        drained = drain;
                        break None;
                    }
                    state = self.changed.wait_timeout(state, Duration::from_millis(10)).unwrap().0;
                }
            };
            let Some(block) = block else { break };
            if let Some(hook) = device.on_write.lock().unwrap().clone() {
                hook(sink.writes());
            }
            if vrct_tts::playback::OutputSink::write(&mut sink, &block, &self.token).is_err() {
                break;
            }
        }
        let drain = drained && !self.token.is_set();
        if let Some(hook) = device.on_close.lock().unwrap().clone() {
            hook(drain);
        }
        vrct_tts::playback::OutputSink::close(&mut sink, drain, &self.token).unwrap();
    }

    fn queued(&self) -> usize {
        self.state.lock().unwrap().queue.len()
    }
}

impl Monitor for Tee {
    fn offer(&self, pcm: &[u8], _rate: u32, _channels: u16) {
        let mut state = self.state.lock().unwrap();
        if state.closed.is_none() && !self.token.is_set() {
            state.queue.push_back(pcm.to_vec());
            self.changed.notify_all();
        }
    }

    fn close(&self, drain: bool) {
        let mut state = self.state.lock().unwrap();
        if !drain {
            self.token.cancel();
            state.queue.clear();
        }
        state.closed.get_or_insert(drain);
        self.changed.notify_all();
    }

    fn join(&self, timeout: Duration) -> bool {
        self.finished.wait(Some(timeout))
    }
}

struct Ten;

impl Synthesizer for Ten {
    fn synthesize_stream(&self, _: &SpeechRequest, _: &CancelToken, _: &SynthesisOptions) -> Result<Frames, TtsError> {
        // 100 ms: ten 10 ms blocks.
        Ok(Box::new(std::iter::once(Ok(AudioFrame::mono([1u8, 0].repeat(4800), 48000).unwrap()))))
    }
}

struct Playback {
    bus: VoiceEventBus,
    monitors: Arc<Mutex<Vec<Arc<Tee>>>>,
    openers: Arc<Mutex<Vec<Opener>>>,
    main: Sink,
    /// Held after creating the monitor, until `factory_release` is set.
    factory_hold: Arc<Mutex<Option<(Event, Event)>>>,
}

impl Playback {
    fn new() -> Self {
        let monitors: Arc<Mutex<Vec<Arc<Tee>>>> = Arc::default();
        let openers: Arc<Mutex<Vec<Opener>>> = Arc::default();
        let factory_hold: Arc<Mutex<Option<(Event, Event)>>> = Arc::default();
        let main = Sink::default();
        let factory: MonitorFactory = {
            let (monitors, openers, hold) = (monitors.clone(), openers.clone(), factory_hold.clone());
            Arc::new(move |request: MonitorRequest| -> Result<Arc<dyn Monitor>, TtsError> {
                assert_eq!((request.device.as_str(), request.volume, request.exclude.as_slice()), ("speakers", 100, ["cable".to_string()].as_slice()));
                let opener = Opener { entered: Event::new(), release: Event::new(), device: Device::default() };
                let monitor = Tee::start(opener.clone());
                openers.lock().unwrap().push(opener);
                monitors.lock().unwrap().push(monitor.clone());
                if let Some((entered, release)) = hold.lock().unwrap().clone() {
                    entered.set();
                    assert!(release.wait(Some(Duration::from_secs(5))));
                }
                Ok(monitor)
            })
        };
        let settings = VoiceSettings {
            mode: "original".into(),
            mic_mode: "translated".into(),
            direct_policy: "mix".into(),
            output_device: "cable".into(),
            monitor: "on".into(),
            monitor_device: "speakers".into(),
            ..Default::default()
        };
        let mut options = BusOptions::new(router(&main).0);
        options.provider_factory = Arc::new(|_: &str| -> Result<Box<dyn Synthesizer>, TtsError> { Ok(Box::new(Ten)) });
        options.monitor_factory = Some(factory);
        Self { bus: VoiceEventBus::new(settings, options), monitors, openers, main, factory_hold }
    }

    fn monitor(&self, index: usize) -> Arc<Tee> {
        self.monitors.lock().unwrap()[index].clone()
    }

    fn opener(&self, index: usize) -> Opener {
        self.openers.lock().unwrap()[index].clone()
    }

    fn finish_main(&self, count: u64) {
        until2(|| self.bus.status().completed == count && !self.bus.status().active);
    }

    fn stop(&self, action: &str) {
        match action {
            "stop" => self.bus.cancel(),
            "mute" => self.bus.set_muted(true),
            "disable" => assert!(self.bus.set_enabled(false, None)),
            "configure" => self.bus.configure((*self.bus.settings()).clone()),
            // The fake opener cannot finish until the test releases it.
            _ => assert!(!self.bus.close(Duration::from_millis(50))),
        }
    }
}

impl Drop for Playback {
    fn drop(&mut self) {
        for opener in self.openers.lock().unwrap().iter() {
            opener.release.set();
        }
        if let Some((_, release)) = self.factory_hold.lock().unwrap().as_ref() {
            release.set();
        }
        if !thread::panicking() {
            assert!(self.bus.close(Duration::from_secs(2)));
            assert!(self.monitors.lock().unwrap().iter().all(|monitor| monitor.join(Duration::ZERO)));
        }
    }
}

fn chat_event(id: &str) -> SpeechMessageEvent {
    chat(id)
}

const ACTIONS: [&str; 5] = ["stop", "mute", "disable", "configure", "close"];

#[test]
fn stop_cancels_all_monitors_after_main_completion() {
    for action in ACTIONS {
        let playback = Playback::new();
        for index in 0..3 {
            assert!(playback.bus.publish(chat_event(&index.to_string()), None, None));
            playback.finish_main(index + 1);
            assert!(playback.opener(index as usize).entered.wait(Some(Duration::from_secs(1))));
            assert!(playback.monitor(index as usize).queued() > 0);
        }
        let generation = playback.bus.generation();
        playback.stop(action);
        let status = playback.bus.status();
        assert_eq!(playback.bus.generation(), generation + 1);
        assert_eq!(status.dropped, 0);
        assert_eq!(status.muted, action == "mute");
        assert_eq!(status.tts_enabled, action != "disable");
        if action == "disable" {
            assert!(status.tts_stopping);
        }
        for index in 0..3 {
            let (monitor, opener) = (playback.monitor(index), playback.opener(index));
            assert!(monitor.token.is_set());
            assert_eq!(monitor.queued(), 0);
            opener.release.set();
            assert!(monitor.join(Duration::from_secs(1)));
            assert!(opener.device.sink.data.lock().unwrap().is_empty());
            assert_eq!(*opener.device.sink.closed.lock().unwrap(), vec![false]);
        }
        until2(|| playback.bus.monitor_count() == 0);
        assert!(!playback.bus.status().tts_stopping);
    }
}

#[test]
fn next_utterance_does_not_wait_and_finished_monitors_are_forgotten() {
    let playback = Playback::new();
    for index in 0..2 {
        assert!(playback.bus.publish(chat_event(&index.to_string()), None, None));
        playback.finish_main(index + 1);
        assert!(playback.opener(index as usize).entered.wait(Some(Duration::from_secs(1))));
    }
    assert_eq!(playback.main.writes(), 20);
    assert_eq!(playback.bus.monitor_count(), 2);
    assert!((0..2).all(|index| !playback.monitor(index).join(Duration::ZERO)));
    for index in 0..2 {
        let (monitor, opener) = (playback.monitor(index), playback.opener(index));
        opener.release.set();
        assert!(monitor.join(Duration::from_secs(1)));
        assert_eq!(opener.device.sink.bytes(), [1u8, 0].repeat(4800));
        assert_eq!(*opener.device.sink.closed.lock().unwrap(), vec![true]);
    }
    // No new publish, status, stop or close is needed to forget them.
    until2(|| playback.bus.monitor_count() == 0);
}

#[test]
fn stop_prevents_more_pcm_from_an_already_playing_monitor() {
    for action in ACTIONS {
        let playback = Playback::new();
        let (writing, release) = (Event::new(), Event::new());
        assert!(playback.bus.publish(chat_event("one"), None, None));
        playback.finish_main(1);
        let opener = playback.opener(0);
        assert!(opener.entered.wait(Some(Duration::from_secs(1))));
        let (hook_writing, hook_release) = (writing.clone(), release.clone());
        *opener.device.on_write.lock().unwrap() = Some(Arc::new(move |written| {
            if written > 0 {
                hook_writing.set();
                assert!(hook_release.wait(Some(Duration::from_secs(5))));
            }
        }));
        opener.release.set();
        assert!(writing.wait(Some(Duration::from_secs(1))));
        assert_eq!(opener.device.sink.writes(), 1);
        playback.stop(action);
        release.set();
        assert!(playback.monitor(0).join(Duration::from_secs(1)));
        assert_eq!(opener.device.sink.writes(), 1, "{action}");
        assert_eq!(*opener.device.sink.closed.lock().unwrap(), vec![false]);
        assert_eq!(playback.monitor(0).queued(), 0);
    }
}

#[test]
fn close_has_one_bound_and_keeps_ownership_until_monitors_exit() {
    let playback = Playback::new();
    for index in 0..3 {
        assert!(playback.bus.publish(chat_event(&index.to_string()), None, None));
        playback.finish_main(index + 1);
        assert!(playback.opener(index as usize).entered.wait(Some(Duration::from_secs(1))));
    }
    let started = Instant::now();
    assert!(!playback.bus.close(Duration::from_millis(50)));
    assert!(started.elapsed() < Duration::from_millis(500));
    assert_eq!(playback.bus.monitor_count(), 3);
    assert!((0..3).all(|index| playback.monitor(index).token.is_set() && !playback.monitor(index).join(Duration::ZERO)));
    for index in 0..3 {
        playback.opener(index).release.set();
    }
    assert!(playback.bus.close(Duration::from_secs(1)));
    assert_eq!(playback.bus.monitor_count(), 0);
    assert!((0..3).all(|index| playback.monitor(index).join(Duration::ZERO)));
    assert!((0..3).all(|index| playback.opener(index).device.sink.data.lock().unwrap().is_empty()));
}

#[test]
fn close_waits_for_monitor_device_cleanup() {
    let playback = Arc::new(Playback::new());
    let (draining, release) = (Event::new(), Event::new());
    assert!(playback.bus.publish(chat_event("one"), None, None));
    playback.finish_main(1);
    let opener = playback.opener(0);
    assert!(opener.entered.wait(Some(Duration::from_secs(1))));
    let (hook_draining, hook_release) = (draining.clone(), release.clone());
    *opener.device.on_close.lock().unwrap() = Some(Arc::new(move |drain| {
        assert!(drain);
        hook_draining.set();
        assert!(hook_release.wait(Some(Duration::from_secs(5))));
    }));
    opener.release.set();
    assert!(draining.wait(Some(Duration::from_secs(1))));
    let finished = Event::new();
    let closing = {
        let (playback, finished) = (playback.clone(), finished.clone());
        thread::spawn(move || {
            let closed = playback.bus.close(Duration::from_secs(1));
            finished.set();
            closed
        })
    };
    until2(|| playback.monitor(0).token.is_set());
    assert!(!finished.is_set());
    release.set();
    assert!(closing.join().unwrap());
    assert!(playback.monitor(0).join(Duration::ZERO));
    assert_eq!(playback.bus.monitor_count(), 0);
}

#[test]
fn monitor_created_during_stop_is_owned_and_cancelled() {
    for action in ACTIONS {
        let playback = Playback::new();
        let (entered, release) = (Event::new(), Event::new());
        *playback.factory_hold.lock().unwrap() = Some((entered.clone(), release.clone()));
        assert!(playback.bus.publish(chat_event("one"), None, None));
        assert!(entered.wait(Some(Duration::from_secs(1))));
        playback.stop(action);
        release.set();
        until2(|| !playback.bus.status().active);
        playback.opener(0).release.set();
        assert!(playback.monitor(0).join(Duration::from_secs(1)));
        until2(|| playback.bus.monitor_count() == 0);
        assert!(playback.monitor(0).token.is_set(), "{action}");
        assert!(playback.main.data.lock().unwrap().is_empty());
        assert!(playback.opener(0).device.sink.data.lock().unwrap().is_empty());
    }
}

#[test]
fn source_cancel_only_cancels_that_sources_draining_monitor() {
    let playback = Playback::new();
    assert!(playback.bus.publish(chat_event("chat"), None, None));
    playback.finish_main(1);
    let spoken = SpeechMessageEvent { translated_text: Some("訳文".into()), target_language: Some("Japanese".into()), ..mic("mic") };
    assert!(playback.bus.publish(spoken, None, None));
    playback.finish_main(2);
    assert!((0..2).all(|index| playback.opener(index).entered.wait(Some(Duration::from_secs(1)))));
    let generation = playback.bus.generation();
    playback.bus.cancel_source(&Source::Mic);
    assert_eq!(playback.bus.generation(), generation);
    assert_eq!(playback.bus.source_generation(&Source::Mic), 1);
    assert!(!playback.monitor(0).token.is_set() && playback.monitor(1).token.is_set());
    for index in 0..2 {
        playback.opener(index).release.set();
        assert!(playback.monitor(index).join(Duration::from_secs(1)));
    }
    assert!(!playback.opener(0).device.sink.data.lock().unwrap().is_empty());
    assert!(playback.opener(1).device.sink.data.lock().unwrap().is_empty());
}

#[test]
fn a_failing_monitor_is_a_notice_not_a_speech_error() {
    let main = Sink::default();
    let reports: Arc<Mutex<Vec<String>>> = Arc::default();
    let record = reports.clone();
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let mut options = BusOptions::new(router(&main).0);
    options.provider_factory = Arc::new(|_: &str| -> Result<Box<dyn Synthesizer>, TtsError> { Ok(Box::new(Ten)) });
    options.monitor_factory = Some(Arc::new(move |request: MonitorRequest| -> Result<Arc<dyn Monitor>, TtsError> {
        if counter.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(TtsError::Output);
        }
        (request.on_error)("monitor_device_lost");
        (request.on_ready)();
        Err(TtsError::Output)
    }));
    options.on_monitor_error = Some(Arc::new(move |code: &str| record.lock().unwrap().push(code.to_owned())));
    let settings = VoiceSettings { mode: "original".into(), output_device: "cable".into(), monitor: "on".into(), ..Default::default() };
    let bus = VoiceEventBus::new(settings, options);
    assert!(bus.publish(chat("one"), None, None));
    until2(|| bus.status().completed == 1);
    assert_eq!(bus.status().monitor_error.as_deref(), Some("monitor_output_error"));
    assert_eq!(main.writes(), 10);
    bus.configure((*bus.settings()).clone());
    assert_eq!(bus.status().monitor_error, None);
    assert!(bus.publish(chat("two"), None, None));
    until2(|| bus.status().completed == 2);
    assert_eq!(*reports.lock().unwrap(), vec!["monitor_output_error", "monitor_device_lost", "monitor_output_error"]);
    assert!(bus.close(Duration::from_secs(2)));
}

/// A monitor that reports from inside `close`, as a device failing to close
/// might, and keeps its device until `released`.
struct ReportingMonitor {
    on_error: Arc<dyn Fn(&str) + Send + Sync>,
    released: Event,
}

impl Monitor for ReportingMonitor {
    fn offer(&self, _pcm: &[u8], _rate: u32, _channels: u16) {}

    fn close(&self, drain: bool) {
        if !drain {
            (self.on_error)("monitor_output_error");
        }
    }

    fn join(&self, _timeout: Duration) -> bool {
        self.released.is_set()
    }
}

#[test]
fn a_monitor_may_report_while_it_is_being_silenced() {
    let released = Event::new();
    let reports: Arc<Mutex<Vec<String>>> = Arc::default();
    let mut options = BusOptions::new(router(&Sink::default()).0);
    options.provider_factory = Arc::new(|_: &str| -> Result<Box<dyn Synthesizer>, TtsError> { Ok(Box::new(Ten)) });
    let factory_released = released.clone();
    options.monitor_factory =
        Some(Arc::new(move |request: MonitorRequest| -> Result<Arc<dyn Monitor>, TtsError> { Ok(Arc::new(ReportingMonitor { on_error: request.on_error, released: factory_released.clone() })) }));
    let record = reports.clone();
    options.on_monitor_error = Some(Arc::new(move |code: &str| record.lock().unwrap().push(code.to_owned())));
    let settings = VoiceSettings { mode: "original".into(), output_device: "cable".into(), monitor: "on".into(), ..Default::default() };
    let bus = Arc::new(VoiceEventBus::new(settings, options));
    for (index, action) in ["cancel_source", "stop", "configure", "close"].into_iter().enumerate() {
        if action != "close" {
            assert!(bus.publish(chat_event(action), None, None));
            until2(|| bus.status().completed == index as u64 + 1 && !bus.status().active);
        }
        assert!(bus.monitor_count() > 0, "the monitor is still owned");
        let worker = {
            let bus = bus.clone();
            thread::spawn(move || match action {
                "cancel_source" => bus.cancel_source(&Source::Chat),
                "stop" => bus.cancel(),
                "configure" => bus.configure((*bus.settings()).clone()),
                _ => assert!(!bus.close(Duration::from_millis(50))),
            })
        };
        let started = Instant::now();
        while !worker.is_finished() {
            assert!(started.elapsed() < Duration::from_secs(2), "{action} blocked on the monitor's report");
            thread::sleep(Duration::from_millis(5));
        }
        worker.join().unwrap();
    }
    assert!(reports.lock().unwrap().len() >= 4);
    released.set();
    assert!(bus.close(Duration::from_secs(2)));
}
