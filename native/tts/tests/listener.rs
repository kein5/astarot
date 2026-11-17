//! A stopped listener must interrupt playback even with unread HTTP PCM
//! (tests/voice/test_tts_listener_failure.py, src-python/test/test_tts_listener_monitor.py).

mod common;

use std::io;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use common::*;
use vrct_tts::listener::{listener_missing, Address, ListenerMonitors, Probe, ProcessExit};
use vrct_tts::playback::{AudioRouter, OutputSink};
use vrct_tts::scheduler::BusOptions;
use vrct_tts::settings::VoiceSettings;
use vrct_tts::sync::Event;
use vrct_tts::{CancelToken, PcmStream, Source, SpeechCppTts, SpeechMessageEvent, SynthesisOptions, TtsError, VoiceEventBus};

/// Four seconds at 48 kHz.
fn pcm() -> Vec<u8> {
    [1u8, 0].repeat(48000 * 4)
}

fn millis(ms: u64) -> Duration {
    Duration::from_millis(ms)
}

fn stream(client: &SpeechCppTts, token: &CancelToken) -> PcmStream {
    client.synthesize_stream("test", "none", "ja", token, &SynthesisOptions::default())
}

fn rest(first: Vec<u8>, stream: PcmStream) -> Vec<u8> {
    let mut all = first;
    for frame in stream {
        all.extend_from_slice(frame.unwrap().pcm());
    }
    all
}

/// A probe that counts calls and otherwise behaves as the default one.
fn counting_probe() -> (Probe, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    (
        Arc::new(move |address: &Address, stopped: &Event| {
            counter.fetch_add(1, Ordering::SeqCst);
            listener_missing(address, stopped)
        }),
        calls,
    )
}

fn isolated(url: &str) -> (SpeechCppTts, ListenerMonitors, Arc<AtomicUsize>) {
    let registry = ListenerMonitors::new();
    let (probe, calls) = counting_probe();
    (SpeechCppTts::new(url).unwrap().with_listener(registry.clone(), probe), registry, calls)
}

#[test]
fn listener_loss_cancels_without_consuming_buffered_pcm() {
    for host in ["127.0.0.1", "::1"] {
        let mut server = BufferedServer::start_on(host, pcm());
        let token = CancelToken::new();
        let mut active = stream(&SpeechCppTts::new(server.url()).unwrap(), &token);
        assert!(!active.next().unwrap().unwrap().pcm().is_empty());
        assert!(server.sent.wait(Some(Duration::from_secs(1))), "four seconds queued, one frame consumed");
        server.server.stop();
        assert!(token.wait(millis(500)), "server loss was hidden behind unread PCM ({host})");
        assert_eq!(token.reason(), "server_unavailable");
        assert_eq!(active.next().unwrap().unwrap_err().code(), "server_unavailable");
    }
}

struct SlowOutput {
    writing: Event,
    closed: Arc<Mutex<Vec<bool>>>,
}

impl OutputSink for SlowOutput {
    fn write(&mut self, _pcm: &[u8], token: &CancelToken) -> Result<(), TtsError> {
        self.writing.set();
        token.wait(millis(20));
        token.check()?;
        Ok(())
    }

    fn close(&mut self, drain: bool, _token: &CancelToken) -> Result<(), TtsError> {
        self.closed.lock().unwrap().push(drain);
        Ok(())
    }
}

#[test]
fn server_loss_aborts_real_scheduler_output_instead_of_draining() {
    let writing = Event::new();
    let closed: Arc<Mutex<Vec<bool>>> = Arc::default();
    let (factory_writing, factory_closed) = (writing.clone(), closed.clone());
    let factory = move |_: &str, _: u32, _: u16| -> Result<Box<dyn OutputSink>, TtsError> { Ok(Box::new(SlowOutput { writing: factory_writing.clone(), closed: factory_closed.clone() })) };
    let mut server = BufferedServer::start(pcm());
    let settings = VoiceSettings { mode: "original".into(), output_device: "test".into(), japanese_url: server.url().to_owned(), ..Default::default() };
    let bus = VoiceEventBus::new(settings, BusOptions::new(Arc::new(AudioRouter::new(Arc::new(factory)))));
    let event = SpeechMessageEvent { source_language: Some("ja".into()), ..SpeechMessageEvent::new("fault", Source::Chat, "test") };
    assert!(bus.publish(event, None, None));
    assert!(writing.wait(Some(Duration::from_secs(1))) && server.sent.wait(Some(Duration::from_secs(1))));
    server.server.stop();
    let deadline = Instant::now() + millis(500);
    while bus.status().active && Instant::now() < deadline {
        thread::sleep(millis(5));
    }
    let state = bus.status();
    assert!(!state.active, "playback continued draining the dead server");
    assert_eq!((state.errors, state.cancelled), (1, 0));
    assert_eq!(state.last_error.as_deref(), Some("server_unavailable"));
    assert_eq!(*closed.lock().unwrap(), vec![false]);
    assert!(bus.close(Duration::from_secs(3)));
}

#[test]
fn slow_consumer_does_not_truncate_healthy_server_audio() {
    let server = BufferedServer::start(pcm());
    let token = CancelToken::new();
    let client = SpeechCppTts::with_timeouts(server.url(), millis(50), Duration::from_secs(10)).unwrap();
    let mut active = stream(&client, &token);
    let first = active.next().unwrap().unwrap().pcm().to_vec();
    assert!(server.sent.wait(Some(Duration::from_secs(1))));
    assert!(!token.wait(millis(300)), "a playback wait is not an HTTP stall");
    server.finish.set();
    assert_eq!(rest(first, active), pcm());
    assert!(!token.is_set());
}

#[test]
fn failed_server_does_not_cancel_an_independent_request() {
    let mut first = BufferedServer::start(pcm());
    let second = BufferedServer::start(pcm());
    let (token_a, token_b) = (CancelToken::new(), CancelToken::new());
    let mut stream_a = stream(&SpeechCppTts::new(first.url()).unwrap(), &token_a);
    let mut stream_b = stream(&SpeechCppTts::new(second.url()).unwrap(), &token_b);
    assert!(stream_a.next().unwrap().is_ok());
    let first_b = stream_b.next().unwrap().unwrap().pcm().to_vec();
    assert!(first.sent.wait(Some(Duration::from_secs(1))) && second.sent.wait(Some(Duration::from_secs(1))));
    first.server.stop();
    assert!(token_a.wait(millis(500)));
    assert!(!token_b.wait(millis(150)));
    second.finish.set();
    assert_eq!(rest(first_b, stream_b), pcm());
}

#[test]
fn inconclusive_probe_does_not_cancel_valid_audio() {
    let server = BufferedServer::start(pcm());
    let attempted = Event::new();
    let flag = attempted.clone();
    // Only the extra probe is faked; the speech connection and PCM are real.
    let probe: Probe = Arc::new(move |_: &Address, _: &Event| {
        flag.set();
        false
    });
    let client = SpeechCppTts::new(server.url()).unwrap().with_listener(ListenerMonitors::new(), probe);
    let token = CancelToken::new();
    let mut active = stream(&client, &token);
    let first = active.next().unwrap().unwrap().pcm().to_vec();
    assert!(server.sent.wait(Some(Duration::from_secs(1))));
    assert!(attempted.wait(Some(millis(500))));
    assert!(!token.wait(millis(100)));
    server.finish.set();
    assert_eq!(rest(first, active), pcm());
}

#[test]
fn request_end_releases_monitor_and_prevents_late_cancellation() {
    for ending in ["closed", "complete", "cancelled"] {
        let mut server = BufferedServer::start(pcm());
        let (client, registry, _) = isolated(server.url());
        let token = CancelToken::new();
        let mut active = stream(&client, &token);
        assert!(active.next().unwrap().is_ok());
        assert!(server.sent.wait(Some(Duration::from_secs(1))));
        let monitor = registry.external(&("127.0.0.1".into(), server.server.port)).unwrap();
        match ending {
            "complete" => {
                server.finish.set();
                for frame in active.by_ref() {
                    frame.unwrap();
                }
            }
            "cancelled" => {
                token.cancel();
                assert_eq!(active.next().unwrap().unwrap_err().code(), "cancelled");
            }
            _ => {}
        }
        active.close();
        server.server.stop();
        if ending == "cancelled" {
            assert_eq!(token.reason(), "cancelled");
        } else {
            assert!(!token.wait(millis(150)), "an ended request was cancelled by a stale monitor ({ending})");
        }
        until2(|| monitor.finished() && registry.external_count() == 0);
    }
}

#[test]
fn chunk_timeout_keeps_diagnostic_and_releases_monitor() {
    let release = Event::new();
    let gate = release.clone();
    let server = PcmServer::start(ServerOptions {
        chunks: vec![vec![1, 0], vec![2, 0]],
        before_chunk: Some(Arc::new(move |i| {
            if i == 1 {
                gate.wait(Some(Duration::from_secs(2)));
            }
        })),
        ..Default::default()
    });
    let registry = ListenerMonitors::new();
    let (probe, _) = counting_probe();
    let client = SpeechCppTts::with_timeouts(&server.url, millis(50), Duration::from_secs(2)).unwrap().with_listener(registry.clone(), probe);
    let token = CancelToken::new();
    let mut active = stream(&client, &token);
    assert!(active.next().unwrap().is_ok());
    assert_eq!(active.next().unwrap().unwrap_err().code(), "transport_error");
    assert!(!token.is_set());
    until2(|| registry.external_count() == 0);
    release.set();
}

/// A server process the app started: `wait` blocks until `exit`.
struct FakeProcess {
    exited: Event,
    waiting: Event,
    waits: AtomicUsize,
}

impl FakeProcess {
    fn new() -> Arc<Self> {
        Arc::new(Self { exited: Event::new(), waiting: Event::new(), waits: AtomicUsize::new(0) })
    }
}

impl ProcessExit for FakeProcess {
    fn wait(&self) -> io::Result<()> {
        self.waits.fetch_add(1, Ordering::SeqCst);
        self.waiting.set();
        assert!(self.exited.wait(Some(Duration::from_secs(5))));
        Ok(())
    }
}

#[test]
fn owned_exit_interrupts_suspended_streams_without_connects() {
    for concurrent in [1, 2] {
        let server = BufferedServer::start(pcm());
        let (client, registry, probes) = isolated(server.url());
        let process = FakeProcess::new();
        let address: Address = ("127.0.0.1".into(), server.server.port);
        let owner = registry.own(address, process.clone());
        let tokens: Vec<CancelToken> = (0..concurrent).map(|_| CancelToken::new()).collect();
        let other = CancelToken::new();
        let mut streams: Vec<PcmStream> = tokens.iter().map(|token| stream(&client, token)).collect();
        assert!(process.waiting.wait(Some(millis(500))));
        for active in &mut streams {
            assert!(active.next().unwrap().is_ok());
        }
        process.exited.set();
        for (token, active) in tokens.iter().zip(&mut streams) {
            assert!(token.wait(millis(200)));
            assert_eq!(token.reason(), "server_unavailable");
            assert_eq!(active.next().unwrap().unwrap_err().code(), "server_unavailable");
        }
        assert!(!other.is_set());
        assert_eq!(process.waits.load(Ordering::SeqCst), 1, "one blocking wait, no polling");
        assert_eq!(probes.load(Ordering::SeqCst), 0);
        assert_eq!(registry.external_count(), 0);
        drop(streams);
        assert!(owner.join(millis(500)));
        assert_eq!(owner.watch_count(), 0);
    }
}

#[test]
fn owned_exit_before_first_pcm_and_port_reuse_keep_process_identity() {
    let registry = ListenerMonitors::new();
    let (first, second) = (FakeProcess::new(), FakeProcess::new());
    let port = Arc::new(Mutex::new(0u16));
    let replaced = Event::new();
    let hook = {
        let (registry, first, second, port, replaced) = (registry.clone(), first.clone(), second.clone(), port.clone(), replaced.clone());
        move || {
            // After the request connected: the old process exits and a new one takes the port.
            let address: Address = ("127.0.0.1".into(), *port.lock().unwrap());
            let old = registry.owned(&address).unwrap();
            first.exited.set();
            assert!(old.join(millis(500)));
            registry.own(address, second.clone());
            registry.forget(&old); // Late cleanup must not remove the replacement.
            replaced.set();
        }
    };
    let server = PcmServer::start(ServerOptions { before_headers: Some(Arc::new(hook)), ..Default::default() });
    *port.lock().unwrap() = server.port;
    let address: Address = ("127.0.0.1".into(), server.port);
    registry.own(address.clone(), first.clone());
    let (probe, probes) = counting_probe();
    let client = SpeechCppTts::new(&server.url).unwrap().with_listener(registry.clone(), probe);
    let token = CancelToken::new();
    let mut active = stream(&client, &token);
    assert_eq!(active.next().unwrap().unwrap_err().code(), "server_unavailable");
    assert!(replaced.is_set());
    assert!(registry.owned(&address).is_some());
    assert_eq!(probes.load(Ordering::SeqCst), 0);
    second.exited.set();
}

#[test]
fn owned_request_end_detaches_without_waiting_for_process() {
    for ending in ["close", "complete", "cancel"] {
        let server = BufferedServer::start(pcm());
        let (client, registry, probes) = isolated(server.url());
        let process = FakeProcess::new();
        let owner = registry.own(("127.0.0.1".into(), server.server.port), process.clone());
        let token = CancelToken::new();
        let mut active = stream(&client, &token);
        assert!(active.next().unwrap().is_ok());
        assert_eq!(owner.watch_count(), 1);
        match ending {
            "complete" => {
                server.finish.set();
                for frame in active.by_ref() {
                    frame.unwrap();
                }
            }
            "cancel" => token.cancel(),
            _ => {}
        }
        let started = Instant::now();
        active.close();
        assert!(started.elapsed() < millis(200));
        assert_eq!(owner.watch_count(), 0);
        assert!(!owner.finished(), "the process waiter belongs to the server, not the request");
        process.exited.set();
        assert!(owner.join(millis(500)));
        assert_eq!(token.is_set(), ending == "cancel", "{ending}");
        assert_eq!(probes.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn shared_probe_cancels_only_confirmed_address() {
    for refused in [true, false] {
        let (a, b) = (BufferedServer::start(pcm()), BufferedServer::start(pcm()));
        let registry = ListenerMonitors::new();
        let attempted = Event::new();
        let confirmed: Address = ("127.0.0.1".into(), a.server.port);
        let probe: Probe = {
            let (attempted, confirmed) = (attempted.clone(), confirmed.clone());
            Arc::new(move |address: &Address, _: &Event| {
                if *address == confirmed {
                    attempted.set();
                    return refused;
                }
                false
            })
        };
        let client_a = SpeechCppTts::new(a.url()).unwrap().with_listener(registry.clone(), probe.clone());
        let client_b = SpeechCppTts::new(b.url()).unwrap().with_listener(registry.clone(), probe);
        let tokens = [CancelToken::new(), CancelToken::new(), CancelToken::new()];
        let mut streams = [stream(&client_a, &tokens[0]), stream(&client_a, &tokens[1]), stream(&client_b, &tokens[2])];
        for active in &mut streams {
            assert!(active.next().unwrap().is_ok());
        }
        assert_eq!(registry.external(&confirmed).unwrap().watch_count(), 2);
        assert!(attempted.wait(Some(millis(500))));
        if refused {
            assert!(tokens[0].wait(millis(200)) && tokens[1].wait(millis(200)));
            assert!(tokens[..2].iter().all(|token| token.reason() == "server_unavailable"));
        } else {
            assert!(!tokens[0].wait(millis(60)) && !tokens[1].is_set());
        }
        assert!(!tokens[2].is_set());
        drop(streams);
        until2(|| registry.external_count() == 0);
    }
}

#[test]
fn external_monitor_stops_only_after_last_subscription() {
    // A subscription whose stop flag is set is covered by a_stopped_subscription_never_cancels.
    for ending in ["close", "complete", "cancel"] {
        let server = BufferedServer::start(pcm());
        let (client, registry, _) = isolated(server.url());
        let tokens = [CancelToken::new(), CancelToken::new()];
        let mut first = stream(&client, &tokens[0]);
        let mut second = stream(&client, &tokens[1]);
        assert!(first.next().unwrap().is_ok() && second.next().unwrap().is_ok());
        let monitor = registry.external(&("127.0.0.1".into(), server.server.port)).unwrap();
        first.close();
        assert!(!monitor.finished() && monitor.watch_count() == 1);
        match ending {
            "complete" => {
                server.finish.set();
                for frame in second.by_ref() {
                    frame.unwrap();
                }
            }
            "cancel" => tokens[1].cancel(),
            _ => second.close(),
        }
        assert!(monitor.join(millis(300)), "{ending}");
        assert_eq!(registry.external_count(), 0);
        assert!(!tokens[0].is_set());
        assert_eq!(tokens[1].is_set(), ending == "cancel");
        second.close();
    }
}

#[test]
fn stop_during_probe_prevents_late_cancellation_and_overlapping_probes() {
    let registry = ListenerMonitors::new();
    let (entered, release, second_entered, second_release) = (Event::new(), Event::new(), Event::new(), Event::new());
    let calls = Arc::new(AtomicUsize::new(0));
    let probe: Probe = {
        let (entered, release, second_entered, second_release, calls) = (entered.clone(), release.clone(), second_entered.clone(), second_release.clone(), calls.clone());
        Arc::new(move |_: &Address, _: &Event| {
            if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                entered.set();
                assert!(release.wait(Some(Duration::from_secs(1))));
                return true; // Refused.
            }
            second_entered.set();
            assert!(second_release.wait(Some(Duration::from_secs(1))));
            false // Timed out: inconclusive.
        })
    };
    let address: Address = ("127.0.0.1".into(), 9);
    let (old_token, new_token) = (CancelToken::new(), CancelToken::new());
    let old = registry.watch(&address, &old_token, Event::new(), probe.clone(), None);
    assert!(entered.wait(Some(millis(500))));
    old.close();
    let new = registry.watch(&address, &new_token, Event::new(), probe, None);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    // The new request joins the monitor whose probe is in flight (`new._monitor is old._monitor`).
    assert_eq!(registry.external_count(), 1);
    assert_eq!(old.monitor().watch_count(), 1, "the new request started another monitor");
    release.set();
    assert!(second_entered.wait(Some(millis(500))));
    // A new request must not receive the old request's in-flight observation.
    assert!(!old_token.is_set() && !new_token.is_set());
    old.close();
    new.close();
    second_release.set();
    old.join();
    assert!(!old_token.is_set() && !new_token.is_set());
    until2(|| registry.external_count() == 0);
}

#[test]
fn a_stopped_subscription_never_cancels() {
    let registry = ListenerMonitors::new();
    let token = CancelToken::new();
    let stopped = Event::new();
    let probe: Probe = Arc::new(|_: &Address, _: &Event| true);
    stopped.set();
    let watch = registry.watch(&("127.0.0.1".into(), 9), &token, stopped, probe, None);
    until2(|| registry.external_count() == 0);
    assert!(!token.is_set());
    watch.close();
}

#[test]
fn the_last_subscriptions_stop_flag_ends_the_monitor_without_cancelling() {
    // The `stopped` ending of `test_external_monitor_stops_only_after_last_subscription`: the
    // first request has gone, then the last one's own stop flag is set while its server is gone.
    let registry = ListenerMonitors::new();
    let address: Address = ("127.0.0.1".into(), 9);
    let gone = Arc::new(AtomicBool::new(false));
    let probe: Probe = {
        let gone = gone.clone();
        Arc::new(move |_: &Address, _: &Event| gone.load(Ordering::SeqCst))
    };
    let tokens = [CancelToken::new(), CancelToken::new()];
    let stops = [Event::new(), Event::new()];
    let first = registry.watch(&address, &tokens[0], stops[0].clone(), probe.clone(), None);
    let second = registry.watch(&address, &tokens[1], stops[1].clone(), probe, None);
    let monitor = registry.external(&address).unwrap();
    first.close();
    assert!(!monitor.finished() && monitor.watch_count() == 1);
    stops[1].set();
    gone.store(true, Ordering::SeqCst);
    assert!(monitor.join(millis(300)), "the monitor outlived its last subscription");
    assert_eq!(registry.external_count(), 0);
    assert!(!tokens[0].is_set() && !tokens[1].is_set(), "a stopped subscription was cancelled");
    second.close();
}

#[test]
fn the_default_probe_is_inconclusive_for_a_live_listener() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address: Address = ("127.0.0.1".into(), listener.local_addr().unwrap().port());
    assert!(!listener_missing(&address, &Event::new()));
    drop(listener);
    assert!(listener_missing(&address, &Event::new()));
}
