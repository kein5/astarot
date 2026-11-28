//! speech.cpp requests over real local HTTP (tests/voice/test_tts.py,
//! test_tts_model_options.py and the health checks of test_tts_toggle.py).

mod common;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use common::*;
use serde_json::{json, Value};
use astarot_tts::sync::Event;
use astarot_tts::{AudioFrame, CancelToken, SpeechCppTts, SpeechError, SynthesisOptions};

fn none() -> SynthesisOptions {
    SynthesisOptions::default()
}

fn collect(client: &SpeechCppTts, text: &str, token: &CancelToken, options: &SynthesisOptions) -> Result<Vec<AudioFrame>, SpeechError> {
    client.synthesize_stream(text, "none", "ja", token, options).collect()
}

fn speak(url: &str) -> Result<Vec<AudioFrame>, SpeechError> {
    collect(&SpeechCppTts::new(url).unwrap(), "x", &CancelToken::new(), &none())
}

fn millis(ms: u64) -> Duration {
    Duration::from_millis(ms)
}

#[test]
fn pcm_contract_and_odd_http_boundaries() {
    for connection_close in [false, true] {
        let headers = if connection_close { vec![("Connection".to_string(), "close".to_string())] } else { vec![] };
        let server = PcmServer::start(ServerOptions { headers, ..Default::default() });
        let frames = collect(&SpeechCppTts::new(&server.url).unwrap(), "こんにちは", &CancelToken::new(), &none()).unwrap();
        assert_eq!(frames.iter().flat_map(|f| f.pcm().to_vec()).collect::<Vec<_>>(), [1, 0, 2, 0]);
        assert!(frames.iter().all(|f| f.sample_rate() == 48000 && f.channels() == 1));
        assert_eq!(server.posts(), vec![("/v1/audio/speech".to_string(), json!({"input": "こんにちは", "voice": "none", "language": "ja", "response_format": "pcm"}))]);
    }
}

#[test]
fn audio_arrives_before_response_completes() {
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
    let mut stream = SpeechCppTts::new(&server.url).unwrap().synthesize_stream("x", "none", "ja", &CancelToken::new(), &none());
    assert_eq!(stream.next().unwrap().unwrap().pcm(), [1, 0]);
    assert!(!release.is_set());
    release.set();
    stream.close();
}

#[test]
fn protocol_errors() {
    let cases: Vec<(ServerOptions, &str)> = vec![
        (ServerOptions { status: 400, ..Default::default() }, "http_400"),
        (ServerOptions { status: 404, ..Default::default() }, "http_404"),
        (ServerOptions { status: 500, ..Default::default() }, "http_500"),
        (ServerOptions { status: 503, ..Default::default() }, "http_503"),
        (ServerOptions { content_type: "audio/wav".into(), ..Default::default() }, "expected_pcm"),
        (ServerOptions { rate: None, ..Default::default() }, "invalid_sample_rate"),
        (ServerOptions { rate: Some("0".into()), ..Default::default() }, "invalid_sample_rate"),
        (ServerOptions { rate: Some("bad".into()), ..Default::default() }, "invalid_sample_rate"),
        (ServerOptions { rate: Some("999999".into()), ..Default::default() }, "invalid_sample_rate"),
        (ServerOptions { chunks: vec![vec![1]], ..Default::default() }, "truncated_pcm"),
        (ServerOptions { chunks: vec![], ..Default::default() }, "empty_pcm"),
        (ServerOptions { status: 302, headers: vec![("Location".into(), "https://example.com".into())], ..Default::default() }, "http_302"),
        (ServerOptions { truncate: true, ..Default::default() }, "transport_error"),
    ];
    for (options, code) in cases {
        let server = PcmServer::start(options);
        let error = collect(&SpeechCppTts::new(&server.url).unwrap(), "secret", &CancelToken::new(), &none()).unwrap_err();
        assert_eq!(error.code(), code);
    }
}

#[test]
fn content_type_parameters_and_case_are_accepted() {
    let server = PcmServer::start(ServerOptions { content_type: "Audio/PCM; rate=48000".into(), ..Default::default() });
    assert!(speak(&server.url).is_ok());
}

#[test]
fn invalid_requests_never_post() {
    let server = PcmServer::start(ServerOptions::default());
    let client = SpeechCppTts::new(&server.url).unwrap();
    for (text, options, code) in [
        (" \n", none(), "invalid_text"),
        (&*"x".repeat(4001), none(), "invalid_text"),
        ("x", SynthesisOptions { seed: Some(9_007_199_254_740_992), ..none() }, "invalid_seed"),
        ("x", SynthesisOptions { instructions: "a\u{1b}".into(), ..none() }, "invalid_instructions"),
        ("x", SynthesisOptions { instructions: "x".repeat(4001), ..none() }, "invalid_instructions"),
    ] {
        assert_eq!(collect(&client, text, &CancelToken::new(), &options).unwrap_err().code(), code);
    }
    assert!(server.posts().is_empty());
}

#[test]
fn cancel_interrupts_a_stalled_response() {
    for delay_headers in [false, true] {
        let (arrived, release) = (Event::new(), Event::new());
        let wait: Arc<dyn Fn() + Send + Sync> = {
            let (arrived, release) = (arrived.clone(), release.clone());
            Arc::new(move || {
                arrived.set();
                release.wait(Some(Duration::from_secs(2)));
            })
        };
        let server = if delay_headers {
            PcmServer::start(ServerOptions { before_headers: Some(wait), ..Default::default() })
        } else {
            PcmServer::start(ServerOptions { before_chunk: Some(Arc::new(move |_| wait())), ..Default::default() })
        };
        let token = CancelToken::new();
        let (url, worker_token) = (server.url.clone(), token.clone());
        let worker = thread::spawn(move || collect(&SpeechCppTts::new(&url).unwrap(), "x", &worker_token, &none()));
        assert!(arrived.wait(Some(Duration::from_secs(1))));
        let started = Instant::now();
        token.cancel();
        let result = worker.join().unwrap();
        release.set();
        assert!(started.elapsed() < millis(500));
        assert_eq!(result.unwrap_err().code(), "cancelled");
    }
}

#[test]
fn initial_audio_timeout() {
    let release = Event::new();
    let gate = release.clone();
    let server = PcmServer::start(ServerOptions {
        before_chunk: Some(Arc::new(move |_| {
            gate.wait(Some(millis(500)));
        })),
        ..Default::default()
    });
    let client = SpeechCppTts::with_timeouts(&server.url, millis(50), millis(50)).unwrap();
    assert_eq!(collect(&client, "x", &CancelToken::new(), &none()).unwrap_err().code(), "first_audio_timeout");
    release.set();
}

#[test]
fn initial_inference_can_exceed_subsequent_read_timeout() {
    for delay_headers in [false, true] {
        let delay: Arc<dyn Fn() + Send + Sync> = Arc::new(|| thread::sleep(millis(80)));
        let server = if delay_headers {
            PcmServer::start(ServerOptions { before_headers: Some(delay), ..Default::default() })
        } else {
            PcmServer::start(ServerOptions {
                before_chunk: Some(Arc::new(move |i| {
                    if i == 0 {
                        delay();
                    }
                })),
                ..Default::default()
            })
        };
        let client = SpeechCppTts::with_timeouts(&server.url, millis(20), millis(500)).unwrap();
        let frames = collect(&client, "x", &CancelToken::new(), &none()).unwrap();
        assert_eq!(frames.iter().flat_map(|f| f.pcm().to_vec()).collect::<Vec<_>>(), [1, 0, 2, 0]);
    }
}

#[test]
fn read_timeout_is_short_again_after_first_pcm() {
    let release = Event::new();
    let gate = release.clone();
    let server = PcmServer::start(ServerOptions {
        chunks: vec![vec![1, 0], vec![2, 0]],
        before_chunk: Some(Arc::new(move |i| {
            if i > 0 {
                gate.wait(Some(Duration::from_secs(1)));
            } else {
                thread::sleep(millis(80));
            }
        })),
        ..Default::default()
    });
    let client = SpeechCppTts::with_timeouts(&server.url, millis(20), millis(500)).unwrap();
    let mut stream = client.synthesize_stream("x", "none", "ja", &CancelToken::new(), &none());
    assert_eq!(stream.next().unwrap().unwrap().pcm(), [1, 0]);
    let started = Instant::now();
    let error = stream.next().unwrap().unwrap_err();
    assert_eq!((error.code(), error.detail()), ("transport_error", Some("stalled")), "#861: a stream that stopped");
    assert!(started.elapsed() < millis(300));
    release.set();
}

#[test]
fn first_audio_budget_includes_header_wait() {
    let server = PcmServer::start(ServerOptions { before_headers: Some(Arc::new(|| thread::sleep(millis(40)))), before_chunk: Some(Arc::new(|_| thread::sleep(millis(40)))), ..Default::default() });
    let client = SpeechCppTts::with_timeouts(&server.url, Duration::from_secs(2), millis(60)).unwrap();
    assert_eq!(collect(&client, "x", &CancelToken::new(), &none()).unwrap_err().code(), "first_audio_timeout");
}

#[test]
fn a_transport_error_says_how_the_answer_failed() {
    // #861: a read of the speech that failed after it began keeps how it failed beside the code.
    let server = PcmServer::start(ServerOptions { truncate: true, ..Default::default() });
    let error = speak(&server.url).unwrap_err();
    assert_eq!((error.code(), error.detail()), ("transport_error", Some("ended_early")));
    let url = {
        let server = PcmServer::start(ServerOptions::default());
        server.url.clone()
    };
    let error = speak(&url).unwrap_err();
    assert_eq!((error.code(), error.detail()), ("transport_error", Some("socket")));
    // The detail is not part of what the error is.
    assert_eq!(error, astarot_tts::SpeechError::new("transport_error"));
}

#[test]
fn server_not_running() {
    let url = {
        let server = PcmServer::start(ServerOptions::default());
        server.url.clone()
    };
    assert_eq!(speak(&url).unwrap_err().code(), "transport_error");
}

#[test]
fn health_check_never_synthesizes() {
    let server = PcmServer::start(ServerOptions::default());
    SpeechCppTts::new(&server.url).unwrap().check_health().unwrap();
    assert!(server.posts().is_empty());
}

#[test]
fn health_failures_are_bounded_safe_codes() {
    for options in [
        ServerOptions { health_status: 503, ..Default::default() },
        ServerOptions { health_body: br#"{"status":"loading"}"#.to_vec(), ..Default::default() },
        ServerOptions { health_body: b"private path and transcript".to_vec(), ..Default::default() },
        ServerOptions { health_body: vec![b'x'; 5000], ..Default::default() },
    ] {
        let server = PcmServer::start(options);
        assert_eq!(SpeechCppTts::new(&server.url).unwrap().check_health().unwrap_err().code(), "speech_server_not_ready");
        assert!(server.posts().is_empty());
    }
}

fn card(seed: bool, instructions: bool, maximum: u64) -> Value {
    let mut options = vec![];
    if seed {
        options.push(json!({"name": "seed", "type": "int", "minimum": 0, "maximum": maximum}));
    }
    if instructions {
        options.push(json!({"name": "instructions", "type": "string"}));
    }
    json!({"data": [{"id": "tts-test", "speech": {"task": "synthesis", "options": options}}]})
}

const MAX: u64 = 9_007_199_254_740_991;

fn catalog(document: Value) -> (ServerOptions, Arc<Mutex<Vec<String>>>) {
    let gets: Arc<Mutex<Vec<String>>> = Arc::default();
    let record = gets.clone();
    let options = ServerOptions { model_document: Arc::new(Mutex::new(document)), before_get: Some(Arc::new(move |path| record.lock().unwrap().push(path.to_owned()))), ..Default::default() };
    (options, gets)
}

#[test]
fn post_sends_zero_and_instruction_separately_and_basic_mode_skips_catalog() {
    let (options, gets) = catalog(card(true, true, MAX));
    let server = PcmServer::start(options);
    let client = SpeechCppTts::new(&server.url).unwrap();
    collect(&client, "本文", &CancelToken::new(), &SynthesisOptions { seed: Some(0), instructions: "ゆっくり\n話す".into() }).unwrap();
    assert_eq!(
        server.posts(),
        vec![("/v1/audio/speech".to_string(), json!({"input": "本文", "voice": "none", "language": "ja", "response_format": "pcm", "seed": 0, "instructions": "ゆっくり\n話す"}))]
    );
    assert_eq!(*gets.lock().unwrap(), vec!["/v1/models"]);
    collect(&client, "次", &CancelToken::new(), &none()).unwrap();
    assert_eq!(gets.lock().unwrap().len(), 1);
    assert_eq!(server.posts().last().unwrap().1, json!({"input": "次", "voice": "none", "language": "ja", "response_format": "pcm"}));
}

#[test]
fn unsupported_or_unknown_options_never_post() {
    for (document, options, code) in [
        (card(true, false, MAX), SynthesisOptions { instructions: "private phrase".into(), ..none() }, "tts_instructions_unsupported"),
        (card(false, true, MAX), SynthesisOptions { seed: Some(1), ..none() }, "tts_seed_unsupported"),
        (card(true, true, 42), SynthesisOptions { seed: Some(43), ..none() }, "tts_seed_out_of_range"),
        (json!({"data": []}), SynthesisOptions { seed: Some(0), ..none() }, "tts_model_options_unavailable"),
    ] {
        let server = PcmServer::start(catalog(document).0);
        let error = collect(&SpeechCppTts::new(&server.url).unwrap(), "private text", &CancelToken::new(), &options).unwrap_err();
        assert_eq!(error.code(), code);
        assert!(server.posts().is_empty());
    }
}

#[test]
fn model_change_rechecks_capability_before_next_generation() {
    let (options, _) = catalog(card(true, true, MAX));
    let document = options.model_document.clone();
    let server = PcmServer::start(options);
    let client = SpeechCppTts::new(&server.url).unwrap();
    let softly = SynthesisOptions { instructions: "softly".into(), ..none() };
    collect(&client, "one", &CancelToken::new(), &softly).unwrap();
    *document.lock().unwrap() = card(true, false, MAX);
    assert_eq!(collect(&client, "two", &CancelToken::new(), &softly).unwrap_err().code(), "tts_instructions_unsupported");
    assert_eq!(server.posts().len(), 1);
}

#[test]
fn bounded_catalog_rejects_bad_documents() {
    for body in [b"not-json-private-path".to_vec(), vec![b'x'; 65537], br#"{"data":[{"id":"tts","speech":{"task":"synthesis","options":null}}]}"#.to_vec()] {
        let server = PcmServer::start(ServerOptions { models_body: Some(body), ..Default::default() });
        assert_eq!(SpeechCppTts::new(&server.url).unwrap().get_model_options(None).unwrap_err().code(), "tts_model_options_unavailable");
    }
}

#[test]
fn catalog_cancel_interrupts_before_audio() {
    let (entered, release) = (Event::new(), Event::new());
    let (hook_entered, hook_release) = (entered.clone(), release.clone());
    let (mut options, _) = catalog(card(true, true, MAX));
    options.before_get = Some(Arc::new(move |_| {
        hook_entered.set();
        hook_release.wait(Some(Duration::from_secs(2)));
    }));
    let server = PcmServer::start(options);
    let token = CancelToken::new();
    let (url, worker_token) = (server.url.clone(), token.clone());
    let worker = thread::spawn(move || collect(&SpeechCppTts::new(&url).unwrap(), "text", &worker_token, &SynthesisOptions { seed: Some(0), ..none() }));
    assert!(entered.wait(Some(Duration::from_secs(1))));
    let started = Instant::now();
    token.cancel();
    let result = worker.join().unwrap();
    assert!(started.elapsed() < millis(500));
    release.set();
    assert_eq!(result.unwrap_err().code(), "cancelled");
    assert!(server.posts().is_empty());
}

#[test]
fn catalog_timeout_is_safe_and_never_posts() {
    let (mut options, _) = catalog(card(true, true, MAX));
    options.before_get = Some(Arc::new(|_| thread::sleep(millis(150))));
    let server = PcmServer::start(options);
    let client = SpeechCppTts::with_timeouts(&server.url, millis(30), Duration::from_secs(10)).unwrap();
    let started = Instant::now();
    assert_eq!(client.get_model_options(None).unwrap_err().code(), "tts_model_options_unavailable");
    assert!(started.elapsed() < millis(140), "the whole exchange is bounded by the timeout");
    assert!(server.posts().is_empty());
}

#[test]
fn ambiguous_or_invalid_capability_is_not_treated_as_supported() {
    let mut document = card(true, true, MAX);
    let row = document["data"][0].clone();
    document["data"].as_array_mut().unwrap().push(row);
    let server = PcmServer::start(catalog(document).0);
    assert_eq!(SpeechCppTts::new(&server.url).unwrap().get_model_options(None).unwrap_err().code(), "tts_model_options_unavailable");
}

#[test]
fn model_options_are_read() {
    let server = PcmServer::start(catalog(card(true, true, MAX)).0);
    let options = SpeechCppTts::new(&server.url).unwrap().get_model_options(None).unwrap();
    // The card lists no voices: none, and the voice is typed as before (#1266).
    assert_eq!(serde_json::to_value(options).unwrap(), json!({"model": "tts-test", "seed": {"minimum": 0, "maximum": MAX}, "instructions": true, "voices": []}));
}
