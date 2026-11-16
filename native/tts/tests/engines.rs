//! The installed engines' clients (ADR-008) against fake engines on loopback: the Rust side of
//! `tests/voice/test_external_speech_engines.py` (the clients).

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use vrct_tts::engines::{EngineApi, EngineClient, VoiceRow};
use vrct_tts::settings::EngineVoice;
use vrct_tts::CancelToken;

type Seen = Arc<Mutex<Vec<(String, String, Vec<u8>)>>>;
type Route = Arc<dyn Fn(&str, &str, &[u8]) -> (u16, &'static str, Vec<u8>) + Send + Sync>;

/// A fake engine: answers each request with `route(method, path, body)` and records it.
fn serve(route: Route) -> (String, Seen) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen: Seen = Arc::default();
    let record = seen.clone();
    thread::spawn(move || {
        for socket in listener.incoming() {
            let Ok(socket) = socket else { return };
            let (route, record) = (route.clone(), record.clone());
            thread::spawn(move || {
                let mut reader = BufReader::new(socket.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    return;
                }
                let mut parts = line.split_whitespace();
                let (method, path) = (parts.next().unwrap_or("").to_owned(), parts.next().unwrap_or("").to_owned());
                let mut length = 0;
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header.trim().is_empty() {
                        break;
                    }
                    if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let (status, kind, reply) = route(&method, &path, &body);
                record.lock().unwrap().push((method, path, body));
                let mut socket = socket;
                let head = format!("HTTP/1.1 {status} X\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", reply.len());
                let _ = socket.write_all(head.as_bytes());
                let _ = socket.write_all(&reply);
            });
        }
    });
    (format!("http://127.0.0.1:{port}"), seen)
}

fn wav(samples: usize) -> Vec<u8> {
    let pcm: Vec<u8> = (0..samples).flat_map(|i| ((i % 100) as i16 + 1).to_le_bytes()).collect();
    let mut data = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
    for part in [&16u32.to_le_bytes()[..], &1u16.to_le_bytes(), &1u16.to_le_bytes(), &24000u32.to_le_bytes(), &48000u32.to_le_bytes(), &2u16.to_le_bytes(), &16u16.to_le_bytes(), b"data", &(pcm.len() as u32).to_le_bytes()] {
        data.extend_from_slice(part);
    }
    data.extend(pcm);
    data
}

fn voicevox() -> Route {
    Arc::new(|method, path, _body| match (method, path.split('?').next().unwrap()) {
        ("GET", "/version") => (200, "application/json", br#""0.26.1""#.to_vec()),
        ("GET", "/speakers") => (
            200,
            "application/json",
            serde_json::to_vec(&json!([
                {"name": "四国めたん", "styles": [{"id": 2, "name": "ノーマル"}, {"id": 6, "name": "歌", "type": "sing"}]},
                {"name": "ずんだもん", "styles": [{"id": 3, "name": "ノーマル", "type": "talk"}]},
                {"styles": [{"id": 9, "name": "名前なし"}]},
            ]))
            .unwrap(),
        ),
        ("POST", "/audio_query") => (200, "application/json", br#"{"accent_phrases":[]}"#.to_vec()),
        ("POST", "/synthesis") => (200, "audio/wav", wav(2400)),
        _ => (404, "text/plain", Vec::new()),
    })
}

#[test]
fn voicevox_lists_talking_styles_and_reads_sentence_by_sentence() {
    let (url, seen) = serve(voicevox());
    let client = EngineClient::new("aivis", &url).unwrap();
    assert_eq!(client.api(), EngineApi::Voicevox);
    assert_eq!(client.check_health(None).unwrap(), "0.26.1");
    let voices = client.list_voices(None).unwrap();
    assert_eq!(
        voices,
        vec![
            VoiceRow { id: "2".into(), speaker: "四国めたん".into(), style: "ノーマル".into() },
            VoiceRow { id: "3".into(), speaker: "ずんだもん".into(), style: "ノーマル".into() },
        ],
        "singing styles and nameless speakers are left out"
    );
    let token = CancelToken::new();
    let voice = EngineVoice { id: "3".into(), speaker: "ずんだもん".into(), style: "ノーマル".into() };
    let frames: Vec<_> = client.synthesize_stream("こんにちは。元気？", &voice, "ja", &token).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(frames.len(), 2, "one 0.1 s WAV per sentence, each one frame");
    assert!(frames.iter().all(|f| f.sample_rate() == 24000 && f.channels() == 1));
    let seen = seen.lock().unwrap();
    let synthesis: Vec<_> = seen.iter().filter(|(_, path, _)| path.starts_with("/synthesis")).collect();
    assert_eq!(synthesis.len(), 2);
    assert_eq!(synthesis[0].1, "/synthesis?speaker=3");
    assert_eq!(synthesis[0].2, br#"{"accent_phrases":[]}"#, "the query goes back unchanged");
    assert!(seen.iter().any(|(_, path, _)| path.starts_with("/audio_query?text=%E3%81%93")));
}

#[test]
fn coeiroink_sends_its_synthesis_parameters() {
    let route: Route = Arc::new(|method, path, _| match (method, path) {
        ("GET", "/v1/engine_info") => (200, "application/json", br#"{"version":"2.13.0"}"#.to_vec()),
        ("GET", "/v1/speakers_path_variant") => (
            200,
            "application/json",
            serde_json::to_vec(&json!([{"speakerName": "つくよみちゃん", "speakerUuid": "3c37646f-3881", "styles": [{"styleId": 0, "styleName": "れいせい"}]}])).unwrap(),
        ),
        ("POST", "/v1/synthesis") => (200, "audio/wav; charset=binary", wav(480)),
        _ => (404, "text/plain", Vec::new()),
    });
    let (url, seen) = serve(route);
    let client = EngineClient::new("coeiroink", &url).unwrap();
    assert_eq!(client.check_health(None).unwrap(), "2.13.0");
    let voice = EngineVoice { id: "3c37646f-3881:0".into(), speaker: "つくよみちゃん".into(), style: "れいせい".into() };
    let frames: Vec<_> = client.synthesize_stream("やあ", &voice, "ja", &CancelToken::new()).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(frames.len(), 1);
    let seen = seen.lock().unwrap();
    let body: Value = serde_json::from_slice(&seen.iter().find(|(_, path, _)| path == "/v1/synthesis").unwrap().2).unwrap();
    assert_eq!(body["speakerUuid"], "3c37646f-3881");
    assert_eq!(body["styleId"], 0);
    assert_eq!(body["outputSamplingRate"], 24000);
}

#[test]
fn failures_are_safe_codes() {
    let (url, _) = serve(Arc::new(|_, path, _| match path {
        "/version" => (200, "application/json", b"42".to_vec()),
        "/speakers" => (200, "application/json", b"[]".to_vec()),
        _ => (503, "text/plain", b"secret body".to_vec()),
    }));
    let client = EngineClient::new("voicevox", &url).unwrap();
    assert_eq!(client.check_health(None).unwrap_err().code(), "tts_engine_not_ready", "a version that is not text");
    let voice = EngineVoice { id: "1".into(), speaker: String::new(), style: String::new() };
    let error = client.synthesize_stream("あ", &voice, "ja", &CancelToken::new()).err().unwrap();
    assert_eq!(error.code(), "tts_engine_voice_missing");
    assert_eq!(client.synthesize_stream("hi", &voice, "en", &CancelToken::new()).err().unwrap().code(), "tts_engine_language");
    // Nothing listens: not ready, never an OS message.
    let closed = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let client = EngineClient::with_timeouts("voicevox", &format!("http://127.0.0.1:{closed}"), Duration::from_millis(300), Duration::from_secs(1)).unwrap();
    assert_eq!(client.check_health(None).unwrap_err().code(), "tts_engine_not_ready");
    assert!(EngineClient::new("speechcpp", &url).is_err());
    assert!(EngineClient::new("voicevox", "http://example.com:50021").is_err(), "local servers only");
}

#[test]
fn a_cancelled_message_stops_reading() {
    let (url, _) = serve(voicevox());
    let client = EngineClient::new("voicevox", &url).unwrap();
    let token = CancelToken::new();
    let voice = EngineVoice { id: "2".into(), speaker: String::new(), style: String::new() };
    let mut frames = client.synthesize_stream("一。二。三。", &voice, "ja", &token).unwrap();
    assert!(frames.next().unwrap().is_ok());
    token.cancel();
    assert_eq!(frames.next().unwrap().unwrap_err().code(), "cancelled");
    assert!(frames.next().is_none());
}
