//! Ports of `tests/voice/test_audio_router.py` and `tests/voice/test_monitor_output.py`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde_json::json;

use super::*;
use crate::monitor::{check_monitor_target, parse_monitor, scale_pcm, MonitorOptions, MonitorTee};

#[derive(Default)]
struct Log {
    data: Vec<Vec<u8>>,
    closed: Vec<bool>,
    opened: Vec<(String, u32, u16)>,
}

struct Sink {
    log: Arc<Mutex<Log>>,
    fail_after: Option<usize>,
    gate: Option<Arc<Event>>,
    on_write: Option<Box<dyn Fn(&[u8]) + Send>>,
}

impl Sink {
    fn new(log: &Arc<Mutex<Log>>) -> Self {
        Self { log: log.clone(), fail_after: None, gate: None, on_write: None }
    }
}

impl Output for Sink {
    fn write(&mut self, pcm: &[u8], token: &dyn PlaybackToken) -> Result<()> {
        token.check()?;
        if let Some(gate) = &self.gate {
            while !gate.wait(Duration::from_millis(10)) {
                token.check()?;
            }
        }
        if self.fail_after.is_some_and(|limit| lock(&self.log).data.len() >= limit) {
            return Err(Error::speech("output_disconnected"));
        }
        lock(&self.log).data.push(pcm.to_vec());
        if let Some(on_write) = &self.on_write {
            on_write(pcm);
        }
        Ok(())
    }
    fn close(&mut self, drain: bool, _: &dyn PlaybackToken) -> Result<()> {
        lock(&self.log).closed.push(drain);
        Ok(())
    }
}

fn router_with(make: impl Fn() -> Sink + Send + Sync + 'static, log: &Arc<Mutex<Log>>) -> AudioRouter {
    let log = log.clone();
    AudioRouter::new(Box::new(move |device, rate, channels| {
        lock(&log).opened.push((device.to_owned(), rate, channels));
        Ok(Box::new(make()) as Box<dyn Output>)
    }))
}

fn frame(pcm: Vec<u8>, rate: u32, channels: u16) -> Result<Frame> {
    Ok(Frame { pcm, sample_rate: rate, channels })
}

#[test]
fn router_preserves_format_and_bounds_writes() {
    for (rate, channels) in [(24000, 1), (44100, 1), (48000, 1), (48000, 2)] {
        let log = Arc::new(Mutex::new(Log::default()));
        let sink_log = log.clone();
        let router = router_with(move || Sink::new(&sink_log), &log);
        let pcm: Vec<u8> = [1u8, 0].repeat(rate as usize * channels as usize);
        let mut first = 0;
        router.play([frame(pcm.clone(), rate, channels)], "cable", &CancelToken::default(), |_, _| first += 1, None).unwrap();
        let log = lock(&log);
        assert_eq!(log.opened, [("cable".to_owned(), rate, channels)]);
        assert_eq!(log.data.concat(), pcm);
        assert!(log.data.iter().all(|c| c.len() <= rate as usize / 100 * 2 * channels as usize));
        assert_eq!(first, 1);
        assert_eq!(log.closed, [true]);
    }
}

#[test]
fn cancel_discards_rest_and_releases_output() {
    let token = Arc::new(CancelToken::default());
    let log = Arc::new(Mutex::new(Log::default()));
    let (sink_log, cancel) = (log.clone(), token.clone());
    let router = router_with(
        move || {
            let cancel = cancel.clone();
            Sink { on_write: Some(Box::new(move |_| cancel.cancel())), ..Sink::new(&sink_log) }
        },
        &log,
    );
    let error = router.play([frame([1, 0].repeat(48000), 48000, 1)], "cable", token.as_ref(), |_, _| {}, None).unwrap_err();
    assert_eq!(error, Error::speech("cancelled"));
    assert_eq!(lock(&log).data.len(), 1);
    assert_eq!(lock(&log).closed, [false]);
}

#[test]
fn silence_does_not_count_as_first_audio() {
    let log = Arc::new(Mutex::new(Log::default()));
    let sink_log = log.clone();
    let mut first = 0;
    router_with(move || Sink::new(&sink_log), &log).play([frame(vec![0; 960], 48000, 1)], "cable", &CancelToken::default(), |_, _| first += 1, None).unwrap();
    assert_eq!(first, 0);
}

#[test]
fn first_nonzero_write_remains_subject_to_deadline_while_waiting() {
    let clock = Arc::new(Mutex::new(1.0));
    let time = clock.clone();
    let token = CancelToken::with_clock(Some(2.0), Arc::new(move || *lock(&time)));
    let log = Arc::new(Mutex::new(Log::default()));
    let (sink_log, late) = (log.clone(), clock.clone());
    let router = router_with(
        move || {
            let late = late.clone();
            Sink {
                on_write: Some(Box::new(move |pcm| {
                    if pcm.iter().any(|&b| b != 0) {
                        *lock(&late) = 2.1;
                    }
                })),
                ..Sink::new(&sink_log)
            }
        },
        &log,
    );
    let mut pcm = vec![0; 960];
    pcm.extend([1, 0].repeat(480));
    let error = router.play([frame(pcm, 48000, 1)], "test", &token, |_, _| {}, None).unwrap_err();
    assert_eq!(error, Error::speech("speech_expired"));
    assert_eq!(lock(&log).closed, [false]);
}

#[test]
fn nonblocking_write_commits_start_only_for_written_audio() {
    let clock = Arc::new(Mutex::new(1.0));
    let time = clock.clone();
    let token = CancelToken::with_clock(Some(2.0), Arc::new(move || *lock(&time)));
    assert_eq!(token.commit_audio_write(&[1, 0], &mut || Ok(2)).unwrap().unwrap(), 2);
    *lock(&clock) = 3.0;
    assert!(token.check().is_ok());
    for (pcm, result) in [(vec![1u8, 0], Err(std::io::ErrorKind::WouldBlock.into())), (vec![0, 0], Ok(2))] {
        *lock(&clock) = 1.0;
        let time = clock.clone();
        let token = CancelToken::with_clock(Some(2.0), Arc::new(move || *lock(&time)));
        let mut result = Some(result);
        let _ = token.commit_audio_write(&pcm, &mut || result.take().unwrap_or(Ok(0)));
        *lock(&clock) = 2.1;
        assert_eq!(token.check().unwrap_err(), Error::speech("speech_expired"));
    }
    let token = CancelToken::default();
    assert_eq!(token.commit_audio_write(&[1, 0], &mut || Ok(3)).unwrap_err(), Error::speech("output_write_invalid"));
}

#[test]
fn format_change_and_write_failure_release_device() {
    let log = Arc::new(Mutex::new(Log::default()));
    let sink_log = log.clone();
    let router = router_with(move || Sink::new(&sink_log), &log);
    let error = router.play([frame(vec![1, 0], 48000, 1), frame(vec![1, 0], 24000, 1)], "cable", &CancelToken::default(), |_, _| {}, None).unwrap_err();
    assert_eq!(error, Error::speech("format_changed"));
    assert_eq!(lock(&log).closed, [false]);
    let failing_log = log.clone();
    let router = router_with(move || Sink { fail_after: Some(0), ..Sink::new(&failing_log) }, &log);
    assert!(router.play([frame(vec![1, 0], 48000, 1)], "cable", &CancelToken::default(), |_, _| {}, None).is_err());
    assert_eq!(lock(&log).closed.len(), 2);
}

#[test]
fn empty_device_is_never_the_default() {
    assert_eq!(open_output("", 48000, 1).err().unwrap(), Error::speech("output_not_selected"));
}

fn monitor_with(sink: impl Fn() -> Sink + Send + Sync + 'static, volume: u8, max_buffer_ms: usize) -> MonitorTee {
    MonitorTee::new("speakers", volume, MonitorOptions { factory: Arc::new(move |_, _, _, _| Ok(Box::new(sink()) as Box<dyn Output>)), max_buffer_ms, ..MonitorOptions::default() })
}

fn pcm(seconds: f64, rate: usize) -> Vec<u8> {
    (0..(rate as f64 * seconds) as usize * 2).map(|i| ((i * 7 + 1) % 256) as u8).collect()
}

fn play(main: &Arc<Mutex<Log>>, monitor: &MonitorTee, data: Vec<u8>, token: &CancelToken) -> Result<()> {
    let sink_log = main.clone();
    router_with(move || Sink::new(&sink_log), main).play([frame(data, 24000, 1)], "cable", token, |_, _| {}, Some(monitor))
}

#[test]
fn monitor_gets_exactly_the_frames_sent_to_the_virtual_microphone() {
    let (main, heard) = (Arc::new(Mutex::new(Log::default())), Arc::new(Mutex::new(Log::default())));
    let sink_log = heard.clone();
    let monitor = monitor_with(move || Sink::new(&sink_log), 100, 500);
    let data = pcm(0.2, 24000);
    play(&main, &monitor, data.clone(), &CancelToken::default()).unwrap();
    assert!(monitor.join(Duration::from_secs(2)));
    assert_eq!(lock(&heard).data, lock(&main).data);
    assert_eq!(lock(&heard).closed, [true]);
}

#[test]
fn monitor_failures_never_affect_main_output() {
    let main = Arc::new(Mutex::new(Log::default()));
    let errors = Arc::new(Mutex::new(Vec::new()));
    let seen = errors.clone();
    let monitor = MonitorTee::new(
        "gone",
        100,
        MonitorOptions {
            factory: Arc::new(|_, _, _, _| Err(Error::speech("output_missing"))),
            on_error: Some(Arc::new(move |code: &str| lock(&seen).push(code.to_owned()))),
            ..MonitorOptions::default()
        },
    );
    let data = pcm(0.2, 24000);
    play(&main, &monitor, data.clone(), &CancelToken::default()).unwrap();
    assert!(monitor.join(Duration::from_secs(2)));
    assert_eq!(lock(&main).data.concat(), data);
    assert_eq!(monitor.error().as_deref(), Some("monitor_output_missing"));
    assert_eq!(*lock(&errors), ["monitor_output_missing"]);

    let heard = Arc::new(Mutex::new(Log::default()));
    let sink_log = heard.clone();
    let unplugged = monitor_with(move || Sink { fail_after: Some(2), ..Sink::new(&sink_log) }, 100, 500);
    let main = Arc::new(Mutex::new(Log::default()));
    play(&main, &unplugged, data.clone(), &CancelToken::default()).unwrap();
    assert!(unplugged.join(Duration::from_secs(2)));
    assert_eq!(lock(&main).data.concat(), data);
    assert_eq!(unplugged.error().as_deref(), Some("monitor_output_disconnected"));
}

#[test]
fn stalled_monitor_adds_no_wait_and_stays_bounded() {
    let gate = Arc::new(Event::new());
    let (main, heard) = (Arc::new(Mutex::new(Log::default())), Arc::new(Mutex::new(Log::default())));
    let (sink_log, held) = (heard.clone(), gate.clone());
    let monitor = monitor_with(move || Sink { gate: Some(held.clone()), ..Sink::new(&sink_log) }, 100, 100);
    let data = pcm(2.0, 24000);
    let started = Instant::now();
    play(&main, &monitor, data.clone(), &CancelToken::default()).unwrap();
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(lock(&main).data.concat(), data);
    assert!(monitor.dropped() > 0 && monitor.queued() <= 24000 * 2 / 10);
    gate.set();
    assert!(monitor.join(Duration::from_secs(2)));
}

#[test]
fn cancelled_speech_stops_the_monitor_without_draining() {
    let gate = Arc::new(Event::new());
    let token = Arc::new(CancelToken::default());
    let heard = Arc::new(Mutex::new(Log::default()));
    let (sink_log, held) = (heard.clone(), gate.clone());
    let monitor = monitor_with(move || Sink { gate: Some(held.clone()), ..Sink::new(&sink_log) }, 100, 500);
    let main = Arc::new(Mutex::new(Log::default()));
    let (sink_log, cancel) = (main.clone(), token.clone());
    let router = router_with(
        move || {
            let cancel = cancel.clone();
            Sink { on_write: Some(Box::new(move |_| cancel.cancel())), ..Sink::new(&sink_log) }
        },
        &main,
    );
    let error = router.play([frame(pcm(0.2, 24000), 24000, 1)], "cable", token.as_ref(), |_, _| {}, Some(&monitor)).unwrap_err();
    assert_eq!(error, Error::speech("cancelled"));
    assert!(monitor.join(Duration::from_secs(2)));
    let heard = lock(&heard);
    assert!(heard.closed.is_empty() || heard.closed == [false]);
    assert!(heard.data.is_empty() && monitor.error().is_none());
}

#[test]
fn monitor_token_is_separate_from_the_main_start_deadline() {
    let main_token = CancelToken::new(Some(f64::MAX));
    let saw_main = Arc::new(AtomicBool::new(false));
    let main_address = &main_token as *const CancelToken as usize;
    struct Recorder(Arc<AtomicBool>, usize);
    impl Output for Recorder {
        fn write(&mut self, _: &[u8], token: &dyn PlaybackToken) -> Result<()> {
            if (token as *const dyn PlaybackToken).cast::<()>() as usize == self.1 {
                self.0.store(true, Ordering::SeqCst);
            }
            Ok(())
        }
        fn close(&mut self, _: bool, _: &dyn PlaybackToken) -> Result<()> {
            Ok(())
        }
    }
    let flag = saw_main.clone();
    let monitor =
        MonitorTee::new("speakers", 100, MonitorOptions { factory: Arc::new(move |_, _, _, _| Ok(Box::new(Recorder(flag.clone(), main_address)) as Box<dyn Output>)), ..MonitorOptions::default() });
    play(&Arc::new(Mutex::new(Log::default())), &monitor, pcm(0.05, 24000), &main_token).unwrap();
    assert!(monitor.join(Duration::from_secs(2)));
    assert!(!saw_main.load(Ordering::SeqCst));
}

#[test]
fn volume_scales_monitor_copy_only() {
    let mut data = 1000i16.to_le_bytes().repeat(240);
    data.extend((-1000i16).to_le_bytes().repeat(240));
    let (main, heard) = (Arc::new(Mutex::new(Log::default())), Arc::new(Mutex::new(Log::default())));
    let sink_log = heard.clone();
    let monitor = monitor_with(move || Sink::new(&sink_log), 50, 500);
    play(&main, &monitor, data.clone(), &CancelToken::default()).unwrap();
    assert!(monitor.join(Duration::from_secs(2)));
    assert_eq!(lock(&main).data.concat(), data);
    assert_eq!(lock(&heard).data.concat(), scale_pcm(&data, 50));
    assert_eq!(scale_pcm(&data, 50)[..2], 500i16.to_le_bytes());
    assert_eq!(scale_pcm(&data, 50)[data.len() - 2..], (-500i16).to_le_bytes());
    assert_eq!(scale_pcm(&data, 100), data);
    assert!(scale_pcm(&data, 0).iter().all(|&b| b == 0));
    assert_eq!(scale_pcm(&(-3i16).to_le_bytes(), 50), (-1i16).to_le_bytes());
}

#[test]
fn monitor_never_targets_the_virtual_microphone() {
    let exclude = vec!["cable".to_owned()];
    for target in ["vrct.managed.mix", "vrct.managed.tts", "vrct.source-bridge.x.playback", "cable", ""] {
        assert!(check_monitor_target(target, &exclude).is_err(), "{target}");
    }
    assert_eq!(check_monitor_target("alsa_output.headphones", &exclude).unwrap(), "alsa_output.headphones");
}

#[test]
fn monitor_settings_validate() {
    assert_eq!(parse_monitor(&json!(null)).unwrap(), None);
    assert_eq!(parse_monitor(&json!({"device": "", "volume": 40})).unwrap().unwrap().volume, 40);
    for bad in [
        json!({"device": "", "volume": 101}),
        json!({"device": "", "volume": true}),
        json!({"device": "", "volume": "40"}),
        json!({"device": "a\nb", "volume": 4}),
        json!({"device": "vrct.managed.mix", "volume": 4}),
        json!({"device": "", "volume": 4, "x": 1}),
        json!({"device": "x".repeat(513), "volume": 4}),
        json!([]),
    ] {
        assert_eq!(parse_monitor(&bad).unwrap_err(), Error::value("vc_monitor_invalid"), "{bad}");
    }
}

#[test]
fn a_stop_while_the_monitor_opens_its_device_plays_nothing_there() {
    // `test_tts_playback_ownership.py` (`stop_cancels_all_monitors`, with the real tee): speech is
    // stopped while the monitor is still opening its device. Once the device opens, nothing
    // queued before the stop plays, and the device closes without draining.
    let (opening, entered) = (Arc::new(Event::new()), Arc::new(Event::new()));
    let heard = Arc::new(Mutex::new(Log::default()));
    let (sink_log, held, seen) = (heard.clone(), opening.clone(), entered.clone());
    let monitor = MonitorTee::new(
        "speakers",
        100,
        MonitorOptions {
            factory: Arc::new(move |_, _, _, _| {
                seen.set();
                held.wait(Duration::from_secs(2));
                Ok(Box::new(Sink::new(&sink_log)) as Box<dyn Output>)
            }),
            max_buffer_ms: 500,
            ..MonitorOptions::default()
        },
    );
    monitor.offer(&pcm(0.1, 24000), 24000, 1);
    assert!(entered.wait(Duration::from_secs(1)), "the monitor never opened its device");
    monitor.close(false);
    assert_eq!(monitor.queued(), 0);
    opening.set();
    assert!(monitor.join(Duration::from_secs(2)));
    let heard = lock(&heard);
    assert!(heard.data.is_empty(), "audio from before the stop played");
    assert!(heard.closed.is_empty() || heard.closed == [false], "{:?}", heard.closed);
    assert!(monitor.error().is_none());
}

#[test]
fn a_stop_after_the_monitor_played_a_block_plays_no_more() {
    // `stop_prevents_more_pcm` with the real tee: one block has played, the next waits for the
    // device; the stop ends it there, without draining.
    let gate = Arc::new(Event::new());
    gate.set();
    let wrote = Arc::new(Event::new());
    let heard = Arc::new(Mutex::new(Log::default()));
    let (sink_log, held, written) = (heard.clone(), gate.clone(), wrote.clone());
    let monitor = monitor_with(
        move || {
            let (closing, written) = (held.clone(), written.clone());
            Sink {
                gate: Some(held.clone()),
                on_write: Some(Box::new(move |_| {
                    closing.clear();
                    written.set();
                })),
                ..Sink::new(&sink_log)
            }
        },
        100,
        500,
    );
    monitor.offer(&pcm(0.05, 24000), 24000, 1);
    assert!(wrote.wait(Duration::from_secs(1)), "the first block never played");
    monitor.offer(&pcm(0.05, 24000), 24000, 1);
    std::thread::sleep(Duration::from_millis(50));
    monitor.close(false);
    assert!(monitor.join(Duration::from_secs(2)));
    let heard = lock(&heard);
    assert_eq!(heard.data.len(), 1, "a block played after the stop");
    assert_eq!(heard.closed, [false]);
    assert!(monitor.error().is_none());
}
