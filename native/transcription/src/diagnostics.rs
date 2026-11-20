//! Speech timing diagnostics (`utterance_diagnostics.py`, decision 15 in
//! `docs/voice-stack/core-integration.md`): counts and timings of each source's speech, summed
//! up in the log once a minute at most. No audio, text, item id, timer or thread: a source's
//! first event opens a window, and the first event 60 s or more later writes the window before it
//! and opens the next. Nothing is written for an idle minute, and nothing catches up.
//!
//! A line of detail (made by the caller, with numbers only) is written at once when one of its
//! stages is slow ([`SLOW_MS`]) or the caller says so; otherwise it only counts. Counts and the
//! largest value cover the whole window; the 50th and 95th percentiles (nearest rank) the last 256
//! values of a stage.

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// How long a window lasts.
pub const SUMMARY_INTERVAL_SECONDS: f64 = 60.0;
/// The values of a stage kept for its percentiles.
pub const SAMPLE_LIMIT: usize = 256;

/// What happened. The names are the log's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Event {
    SpeechStart,
    SpeechEnd,
    VadFinalize,
    VadSafetyFinalize,
    VadInterim,
    VadAccumulate,
    AudioChunk,
    AudioDrop,
    AsrSuccess,
    AsrFailure,
    AsrError,
    Message,
    MessageAborted,
    RealtimeFinal,
    RealtimeEmptyFinal,
    RealtimeDelivery,
    RealtimeProcessed,
}

impl Event {
    pub fn as_str(self) -> &'static str {
        match self {
            Event::SpeechStart => "speech_start",
            Event::SpeechEnd => "speech_end",
            Event::VadFinalize => "vad_finalize",
            Event::VadSafetyFinalize => "vad_safety_finalize",
            Event::VadInterim => "vad_interim",
            Event::VadAccumulate => "vad_accumulate",
            Event::AudioChunk => "audio_chunk",
            Event::AudioDrop => "audio_drop",
            Event::AsrSuccess => "asr_success",
            Event::AsrFailure => "asr_failure",
            Event::AsrError => "asr_error",
            Event::Message => "message",
            Event::MessageAborted => "message_aborted",
            Event::RealtimeFinal => "realtime_final",
            Event::RealtimeEmptyFinal => "realtime_empty_final",
            Event::RealtimeDelivery => "realtime_delivery",
            Event::RealtimeProcessed => "realtime_processed",
        }
    }
}

/// A timed stage, in milliseconds. The names are the log's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Stage {
    /// From the end of speech to when the VAD knew it.
    VadWait,
    /// The speech a VAD path has gathered for one utterance.
    VadBuffer,
    /// A phrase waiting for the transcriber.
    Queue,
    Asr,
    Translate,
    /// From the translation to the last output.
    Output,
    /// Recognition and the message pipeline (not the recording or the queue).
    Total,
    /// A realtime utterance, from its start to its final.
    RealtimePending,
    /// A realtime final waiting for the message pipeline.
    RealtimeQueue,
    RealtimeTranslate,
    /// A realtime final, from its receipt to the end of its delivery.
    RealtimeTotal,
    /// The length of a VAD segment.
    Segment,
}

impl Stage {
    pub const ALL: [Stage; 12] = [
        Stage::VadWait,
        Stage::VadBuffer,
        Stage::Queue,
        Stage::Asr,
        Stage::Translate,
        Stage::Output,
        Stage::Total,
        Stage::RealtimePending,
        Stage::RealtimeQueue,
        Stage::RealtimeTranslate,
        Stage::RealtimeTotal,
        Stage::Segment,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Stage::VadWait => "vad_wait_ms",
            Stage::VadBuffer => "vad_buffer_ms",
            Stage::Queue => "queue_ms",
            Stage::Asr => "asr_ms",
            Stage::Translate => "translate_ms",
            Stage::Output => "output_ms",
            Stage::Total => "total_ms",
            Stage::RealtimePending => "realtime_pending_ms",
            Stage::RealtimeQueue => "realtime_queue_ms",
            Stage::RealtimeTranslate => "realtime_translate_ms",
            Stage::RealtimeTotal => "realtime_total_ms",
            Stage::Segment => "segment_ms",
        }
    }
}

/// `SLOW_MS`: when a stage is slow enough for its detail to be written at once. Thresholds of the
/// diagnostics only; no deadline of the pipeline depends on them. The VAD wait is twice the
/// 768 ms hangover, the buffer the 15 s safety net, recognition and translation half a 10 s
/// timeout, the total both; realtime half the 15 s pending limit and of the 2 s delivery window.
/// A segment's length is never slow.
pub fn slow_ms(stage: Stage) -> Option<f64> {
    Some(match stage {
        Stage::VadWait => 1536.0,
        Stage::VadBuffer => 15000.0,
        Stage::Queue => 1000.0,
        Stage::Asr => 5000.0,
        Stage::Translate => 5000.0,
        Stage::Output => 1000.0,
        Stage::Total => 10000.0,
        Stage::RealtimePending => 7500.0,
        Stage::RealtimeQueue => 1000.0,
        Stage::RealtimeTranslate => 1000.0,
        Stage::RealtimeTotal => 2000.0,
        Stage::Segment => return None,
    })
}

/// The recognition threshold of [`slow_ms`], for the message pipeline's own check.
pub const SLOW_ASR_MS: f64 = 5000.0;

#[derive(Default)]
struct Samples {
    values: VecDeque<f64>,
    count: u64,
    maximum: f64,
}

impl Samples {
    fn add(&mut self, value: f64) {
        if self.values.len() == SAMPLE_LIMIT {
            self.values.pop_front();
        }
        self.values.push_back(value);
        self.count += 1;
        self.maximum = self.maximum.max(value);
    }

    fn summary(&self) -> String {
        let mut values: Vec<f64> = self.values.iter().copied().collect();
        values.sort_by(f64::total_cmp);
        let rank = |share: f64| values[((values.len() as f64 * share).ceil() as usize).max(1) - 1];
        format!(
            "n={},samples={},p50={:.1},p95={:.1},max={:.1}",
            self.count,
            values.len(),
            rank(0.50),
            rank(0.95),
            self.maximum
        )
    }
}

#[derive(Default)]
struct Window {
    started: Option<f64>,
    counts: BTreeMap<Event, u64>,
    stages: BTreeMap<Stage, Samples>,
    /// Phrases dropped in a row from a full queue.
    drops: u64,
}

/// A window taken out to be written.
struct Snapshot {
    source: &'static str,
    elapsed: f64,
    reason: &'static str,
    counts: BTreeMap<Event, u64>,
    stages: BTreeMap<Stage, Samples>,
    drops: u64,
}

type Clock = Arc<dyn Fn() -> f64 + Send + Sync>;
type Log = Arc<dyn Fn(&str) + Send + Sync>;

struct Inner {
    clock: Clock,
    log: Log,
    sources: [Mutex<Window>; 2],
}

/// The diagnostics of both sources; clones share them.
#[derive(Clone)]
pub struct Diagnostics(Arc<Inner>);

impl std::fmt::Debug for Diagnostics {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Diagnostics")
    }
}

/// The same diagnostics.
impl PartialEq for Diagnostics {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for Diagnostics {}

fn index(source: &str) -> Option<(usize, &'static str)> {
    match source {
        "mic" => Some((0, "mic")),
        "speaker" => Some((1, "speaker")),
        _ => None,
    }
}

impl Diagnostics {
    /// Writes to `log`, with the monotonic clock.
    pub fn new(log: Arc<dyn Fn(&str) + Send + Sync>) -> Diagnostics {
        let start = Instant::now();
        Diagnostics::with_clock(Arc::new(move || start.elapsed().as_secs_f64()), log)
    }

    /// `clock` gives seconds.
    pub fn with_clock(clock: Arc<dyn Fn() -> f64 + Send + Sync>, log: Arc<dyn Fn(&str) + Send + Sync>) -> Diagnostics {
        Diagnostics(Arc::new(Inner { clock, log, sources: [Mutex::default(), Mutex::default()] }))
    }

    fn window(&self, at: usize) -> std::sync::MutexGuard<'_, Window> {
        self.0.sources[at].lock().unwrap_or_else(|e| e.into_inner())
    }

    fn take(source: &'static str, window: &mut Window, now: f64, reason: &'static str) -> Option<Snapshot> {
        if window.counts.is_empty() {
            return None;
        }
        let snapshot = Snapshot {
            source,
            elapsed: now - window.started.unwrap_or(now),
            reason,
            counts: std::mem::take(&mut window.counts),
            stages: std::mem::take(&mut window.stages),
            drops: window.drops,
        };
        window.started = None;
        Some(snapshot)
    }

    /// Closes a window that is a minute old; opens one when none is open.
    fn roll(source: &'static str, window: &mut Window, now: f64) -> Option<Snapshot> {
        let snapshot = match window.started {
            Some(started) if now - started >= SUMMARY_INTERVAL_SECONDS => {
                Diagnostics::take(source, window, now, "interval")
            }
            _ => None,
        };
        if window.counts.is_empty() {
            window.started = Some(now);
        }
        snapshot
    }

    fn emit(&self, snapshot: Option<Snapshot>) {
        let Some(snapshot) = snapshot else { return };
        // Counters and stages sorted by name, as Python wrote them.
        let mut counters: Vec<String> =
            snapshot.counts.iter().map(|(event, count)| format!("{}={count}", event.as_str())).collect();
        counters.sort();
        let mut line = format!(
            "[utterance-summary][{}] reason={} window={:.1}s {} drop_run={}",
            snapshot.source,
            snapshot.reason,
            snapshot.elapsed,
            counters.join(" "),
            snapshot.drops
        );
        let mut stages: Vec<(&Stage, &Samples)> = snapshot.stages.iter().collect();
        stages.sort_by_key(|(stage, _)| stage.as_str());
        for (stage, samples) in stages {
            line.push_str(&format!(" {}({})", stage.as_str(), samples.summary()));
        }
        (self.0.log)(&line);
    }

    /// Counts `event` of `source` ("mic" or "speaker"; anything else is ignored) with the time of
    /// its stages. `detail` is written when a stage is slow or `immediate` is set; it must hold
    /// no text, audio or id.
    pub fn record(&self, source: &str, event: Event, stages: &[(Stage, f64)], detail: Option<String>, immediate: bool) {
        let Some((at, source)) = index(source) else { return };
        let stages: Vec<(Stage, f64)> =
            stages.iter().map(|&(stage, value)| (stage, if value > 0.0 { value } else { 0.0 })).collect();
        let snapshot = {
            let mut window = self.window(at);
            let snapshot = Diagnostics::roll(source, &mut window, (self.0.clock)());
            *window.counts.entry(event).or_default() += 1;
            for &(stage, value) in &stages {
                window.stages.entry(stage).or_default().add(value);
            }
            snapshot
        };
        if let Some(detail) = detail
            && (immediate || stages.iter().any(|&(stage, value)| slow_ms(stage).is_some_and(|slow| value >= slow)))
        {
            (self.0.log)(&detail);
        }
        self.emit(snapshot);
    }

    /// A phrase went into the recorder's queue; `dropped` when the oldest waiting one was
    /// dropped to make room. The first drop of a run is written at once, and the run's end
    /// when a phrase goes in again without one.
    pub fn queue_result(&self, source: &str, dropped: bool) {
        let Some((at, source)) = index(source) else { return };
        let (onset, recovered, snapshot) = {
            let mut window = self.window(at);
            if !dropped && window.drops == 0 {
                // A phrase that went in is no activity of its own.
                return;
            }
            let snapshot = Diagnostics::roll(source, &mut window, (self.0.clock)());
            if dropped {
                let onset = window.drops == 0;
                window.drops += 1;
                *window.counts.entry(Event::AudioDrop).or_default() += 1;
                (onset, 0, snapshot)
            } else {
                (false, std::mem::take(&mut window.drops), snapshot)
            }
        };
        if onset {
            (self.0.log)(&format!("audio_queue is full; dropped the oldest queued chunk to keep up [source={source}]"));
        }
        self.emit(snapshot);
        if recovered > 0 {
            (self.0.log)(&format!("[ASR-queue][{source}] recovered dropped={recovered} repeated={}", recovered - 1));
        }
    }

    /// Writes the open window of `source` (both when `None`) as it is, for `reason` ("stop",
    /// "shutdown"). A run of drops with no phrase after it is written as unconfirmed.
    pub fn flush(&self, source: Option<&str>, reason: &'static str) {
        let names: &[&str] = match source {
            Some(source) => &[source][..],
            None => &["mic", "speaker"][..],
        };
        for name in names {
            let Some((at, name)) = index(name) else { continue };
            let (snapshot, drops) = {
                let mut window = self.window(at);
                let snapshot = Diagnostics::take(name, &mut window, (self.0.clock)(), reason);
                (snapshot, std::mem::take(&mut window.drops))
            };
            self.emit(snapshot);
            if drops > 0 {
                // A stop without another phrase is no proof that the queue caught up.
                (self.0.log)(&format!(
                    "[ASR-queue][{name}] {reason} dropped={drops} repeated={} recovery=unconfirmed",
                    drops - 1
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Diagnostics on a clock the test sets (seconds, in thousandths), writing to a list.
    struct Setup {
        diagnostics: Diagnostics,
        now: Arc<AtomicU64>,
        logs: Arc<Mutex<Vec<String>>>,
    }

    impl Setup {
        fn new() -> Setup {
            let now = Arc::new(AtomicU64::new(0));
            let logs = Arc::new(Mutex::new(Vec::new()));
            let (clock, written) = (Arc::clone(&now), Arc::clone(&logs));
            let diagnostics = Diagnostics::with_clock(
                Arc::new(move || clock.load(Ordering::SeqCst) as f64 / 1000.0),
                Arc::new(move |line: &str| written.lock().unwrap().push(line.to_string())),
            );
            Setup { diagnostics, now, logs }
        }

        fn at(&self, seconds: f64) {
            self.now.store((seconds * 1000.0).round() as u64, Ordering::SeqCst);
        }

        fn logs(&self) -> Vec<String> {
            self.logs.lock().unwrap().clone()
        }
    }

    #[test]
    fn a_detail_is_written_at_once_from_the_moment_its_stage_is_slow() {
        let all = [
            Stage::VadWait, Stage::VadBuffer, Stage::Queue, Stage::Asr, Stage::Translate, Stage::Output, Stage::Total,
            Stage::RealtimePending, Stage::RealtimeQueue, Stage::RealtimeTranslate, Stage::RealtimeTotal,
        ];
        for stage in all {
            let slow = slow_ms(stage).unwrap_or_else(|| panic!("{} has a threshold", stage.as_str()));
            let setup = Setup::new();
            setup.diagnostics.record("mic", Event::AsrSuccess, &[(stage, slow - 0.5)], Some("just under".into()), false);
            assert!(setup.logs().is_empty(), "{}", stage.as_str());
            setup.diagnostics.record("mic", Event::AsrSuccess, &[(stage, slow)], Some("at the threshold".into()), false);
            assert_eq!(setup.logs(), ["at the threshold"], "{}", stage.as_str());
        }
        // A segment's length is never slow, however long.
        assert_eq!(slow_ms(Stage::Segment), None);
        let setup = Setup::new();
        setup.diagnostics.record("speaker", Event::AsrSuccess, &[(Stage::Segment, 1e9)], Some("long".into()), false);
        assert!(setup.logs().is_empty());
    }

    #[test]
    fn diagnostics_are_equal_only_to_their_clones_and_show_none_of_their_content() {
        let (one, other) = (Setup::new().diagnostics, Setup::new().diagnostics);
        assert_eq!(one, one.clone());
        assert_ne!(one, other);
        assert_eq!(format!("{one:?}"), "Diagnostics");
    }

    #[test]
    fn a_window_closes_at_the_first_event_a_minute_later_with_counts_and_percentiles() {
        // `test_lazy_interval_counts_percentiles_and_no_catch_up`.
        let setup = Setup::new();
        for value in 1..=100 {
            setup.diagnostics.record(
                "mic",
                Event::AsrSuccess,
                &[(Stage::Asr, f64::from(value))],
                Some("routine".into()),
                false,
            );
        }
        setup.at(59.999);
        assert!(setup.logs().is_empty());
        setup.at(60.0);
        setup.diagnostics.record("mic", Event::SpeechStart, &[], None, false);
        let logs = setup.logs();
        assert_eq!(logs.len(), 1);
        assert!(logs[0].contains("asr_success=100"), "{}", logs[0]);
        assert!(logs[0].contains("asr_ms(n=100,samples=100,p50=50.0,p95=95.0,max=100.0)"), "{}", logs[0]);
        setup.at(600.0);
        setup.diagnostics.record("mic", Event::SpeechStart, &[], None, false);
        let logs = setup.logs();
        assert_eq!(logs.len(), 2, "no catch-up for the idle minutes");
        assert!(logs[1].contains("speech_start=1"), "{}", logs[1]);
        assert!(logs[1].starts_with("[utterance-summary][mic] reason=interval window=540.0s "), "{}", logs[1]);
    }

    #[test]
    fn nothing_is_written_without_activity_and_a_flush_writes_once() {
        // `test_no_activity_no_reports_threads_or_timers`.
        let setup = Setup::new();
        for seconds in [0.0, 60.0, 6000.0] {
            setup.at(seconds);
            setup.diagnostics.queue_result("mic", false);
            setup.diagnostics.flush(None, "shutdown");
        }
        assert!(setup.logs().is_empty());
        setup.diagnostics.record("mic", Event::AsrSuccess, &[(Stage::Asr, 100.0)], None, false);
        setup.diagnostics.flush(Some("mic"), "stop");
        assert_eq!(setup.logs().len(), 1);
        setup.diagnostics.flush(Some("mic"), "stop");
        assert_eq!(setup.logs().len(), 1);
    }

    #[test]
    fn every_stage_writes_its_detail_from_its_threshold() {
        // `test_every_stage_threshold_retains_exact_detail`.
        let setup = Setup::new();
        for stage in Stage::ALL {
            setup.logs.lock().unwrap().clear();
            let Some(limit) = slow_ms(stage) else {
                setup.diagnostics.record("mic", Event::SpeechEnd, &[(stage, 1e9)], Some("never slow".into()), false);
                assert!(setup.logs().is_empty(), "{stage:?}");
                continue;
            };
            setup.diagnostics.record(
                "mic",
                Event::Message,
                &[(stage, limit - 1.0)],
                Some("detail below".into()),
                false,
            );
            assert!(setup.logs().is_empty(), "{stage:?}");
            setup.diagnostics.record(
                "mic",
                Event::Message,
                &[(stage, limit)],
                Some("original full detail".into()),
                false,
            );
            assert_eq!(setup.logs(), vec!["original full detail".to_string()], "{stage:?}");
        }
        setup.logs.lock().unwrap().clear();
        setup.diagnostics.record("mic", Event::AsrFailure, &[(Stage::Asr, 1.0)], Some("told at once".into()), true);
        assert_eq!(setup.logs(), vec!["told at once".to_string()]);
    }

    #[test]
    fn a_run_of_drops_is_told_at_its_start_counted_and_told_at_its_end() {
        // `test_drop_onset_interval_count_recovery_and_stop_without_recovery`.
        let setup = Setup::new();
        for _ in 0..10 {
            setup.diagnostics.queue_result("mic", true);
        }
        assert_eq!(
            setup.logs(),
            vec!["audio_queue is full; dropped the oldest queued chunk to keep up [source=mic]".to_string()]
        );
        setup.at(60.0);
        setup.diagnostics.queue_result("mic", true);
        let logs = setup.logs();
        assert!(logs[1].contains("audio_drop=10") && logs[1].contains("drop_run=10"), "{}", logs[1]);
        setup.diagnostics.queue_result("mic", false);
        assert_eq!(setup.logs().last().unwrap(), "[ASR-queue][mic] recovered dropped=11 repeated=10");
        let size = setup.logs().len();
        setup.diagnostics.queue_result("mic", false);
        assert_eq!(setup.logs().len(), size);
        setup.diagnostics.queue_result("mic", true);
        setup.diagnostics.queue_result("mic", true);
        setup.diagnostics.flush(Some("mic"), "stop");
        assert!(setup.logs().last().unwrap().contains("stop dropped=2 repeated=1 recovery=unconfirmed"));
        setup.diagnostics.flush(None, "shutdown");
        assert_eq!(setup.logs().len(), size + 3);
    }

    #[test]
    fn the_sources_are_counted_apart_and_their_samples_are_bounded() {
        // `test_sources_on_two_threads_are_independent_and_bounded` and
        // `test_window_max_includes_evicted_samples_and_keys_are_bounded`.
        let setup = Setup::new();
        // Pushed out of the samples, but still the window's largest.
        setup.diagnostics.record("mic", Event::AsrSuccess, &[(Stage::Asr, 9000.0)], None, false);
        let workers: Vec<_> = [("mic", 100.0), ("speaker", 200.0)]
            .into_iter()
            .map(|(source, value)| {
                let diagnostics = setup.diagnostics.clone();
                std::thread::spawn(move || {
                    for _ in 0..20000 {
                        diagnostics.record(source, Event::AsrSuccess, &[(Stage::Asr, value)], None, false);
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        setup.diagnostics.record("ocr", Event::AsrSuccess, &[(Stage::Asr, 1.0)], Some("ignored".into()), true);
        assert!(setup.logs().is_empty());
        setup.diagnostics.flush(None, "shutdown");
        let logs = setup.logs();
        assert_eq!(logs.len(), 2, "{logs:?}");
        assert!(logs[0].contains("[mic] reason=shutdown") && logs[0].contains("asr_success=20001"), "{}", logs[0]);
        assert!(logs[0].contains("asr_ms(n=20001,samples=256,p50=100.0,p95=100.0,max=9000.0)"), "{}", logs[0]);
        assert!(logs[1].contains("asr_ms(n=20000,samples=256,p50=200.0,p95=200.0,max=200.0)"), "{}", logs[1]);
    }

    #[test]
    fn a_recovery_at_the_minute_does_not_open_an_empty_window() {
        // `test_recovery_at_interval_does_not_start_an_empty_window`.
        let setup = Setup::new();
        setup.diagnostics.queue_result("mic", true);
        setup.at(60.0);
        setup.diagnostics.queue_result("mic", false);
        assert_eq!(setup.logs().len(), 3, "onset, the window, the recovery");
        setup.at(160.0);
        for _ in 0..2 {
            setup.diagnostics.record("mic", Event::AsrSuccess, &[(Stage::Asr, 100.0)], None, false);
        }
        assert_eq!(setup.logs().len(), 3);
        setup.at(220.0);
        setup.diagnostics.record("mic", Event::SpeechStart, &[], None, false);
        assert_eq!(setup.logs().len(), 4);
        assert!(setup.logs().last().unwrap().contains("window=60.0s asr_success=2"));
    }

    #[test]
    fn writers_and_flushes_of_one_source_lose_no_count() {
        // `test_same_source_concurrent_writers_and_flush_do_not_lose_counts`.
        let setup = Setup::new();
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let diagnostics = setup.diagnostics.clone();
                std::thread::spawn(move || {
                    for _ in 0..2000 {
                        diagnostics.record("mic", Event::SpeechStart, &[], None, false);
                    }
                })
            })
            .collect();
        for _ in 0..30 {
            setup.diagnostics.flush(Some("mic"), "stop");
        }
        for worker in workers {
            worker.join().unwrap();
        }
        setup.diagnostics.flush(Some("mic"), "stop");
        let total: u64 = setup
            .logs()
            .iter()
            .map(|row| {
                row.split("speech_start=").nth(1).unwrap().split_whitespace().next().unwrap().parse::<u64>().unwrap()
            })
            .sum();
        assert_eq!(total, 4000);
    }
}
