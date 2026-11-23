//! A conversation with a stand-in for the service on this PC, through the real WebSocket: the
//! handshake, the settings, audio and pictures both ways, cutting into an answer, the turns,
//! refusals and the end of a conversation.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tungstenite::Message;
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use astarot_talk_ai::{Closed, Event, Failure, Key, Network, OpenError, Options, Service, SessionSettings, Status, Talk, Turns, Update};

enum Script {
    Send(Value),
    Close,
}

/// The handshake's target and `Authorization` header.
type Handshake = Arc<Mutex<Option<(String, Option<String>)>>>;

/// The service: it accepts one connection, says `session.created`, keeps what the app sends and
/// says what the test tells it to.
struct FakeService {
    url: String,
    received: Arc<Mutex<Vec<Value>>>,
    handshake: Handshake,
    script: Sender<Script>,
    closed: Arc<AtomicBool>,
}

impl FakeService {
    /// `refuse` answers the handshake with that status instead of accepting it.
    // The refusal's type is tungstenite's.
    #[allow(clippy::result_large_err)]
    fn start(refuse: Option<u16>) -> FakeService {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("ws://127.0.0.1:{}/v1/realtime", listener.local_addr().unwrap().port());
        let (received, handshake, closed): (_, Handshake, _) = (Arc::new(Mutex::new(Vec::new())), Arc::new(Mutex::new(None)), Arc::new(AtomicBool::new(false)));
        let (script, scripted) = mpsc::channel::<Script>();
        let (r, h, c) = (received.clone(), handshake.clone(), closed.clone());
        std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else { return };
            let check = move |request: &Request, response: Response| -> Result<Response, ErrorResponse> {
                let authorization = request.headers().get("authorization").map(|value| value.to_str().unwrap().to_string());
                *h.lock().unwrap() = Some((request.uri().to_string(), authorization));
                match refuse {
                    Some(status) => Err(tungstenite::http::Response::builder().status(status).body(None).unwrap()),
                    None => Ok(response),
                }
            };
            let Ok(mut socket) = tungstenite::accept_hdr(stream, check) else { return };
            socket.get_mut().set_read_timeout(Some(Duration::from_millis(10))).unwrap();
            let _ = socket.send(Message::text(json!({ "type": "session.created", "session": { "id": "sess_1", "type": "realtime" } }).to_string()));
            loop {
                while let Ok(step) = scripted.try_recv() {
                    match step {
                        Script::Send(event) => {
                            let _ = socket.send(Message::text(event.to_string()));
                        }
                        Script::Close => {
                            let _ = socket.close(None);
                            let _ = socket.flush();
                            return;
                        }
                    }
                }
                match socket.read() {
                    Ok(Message::Text(text)) => r.lock().unwrap().push(serde_json::from_str(text.as_str()).unwrap()),
                    Ok(Message::Close(_)) => {
                        c.store(true, Ordering::SeqCst);
                        return;
                    }
                    Ok(_) => {}
                    Err(tungstenite::Error::Io(error)) if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                    Err(_) => {
                        c.store(true, Ordering::SeqCst);
                        return;
                    }
                }
            }
        });
        FakeService { url, received, handshake, script, closed }
    }

    fn say(&self, event: Value) {
        self.script.send(Script::Send(event)).unwrap();
    }

    /// The first event of this type the app sent after the `skip` first ones of that type.
    fn sent(&self, kind: &str, skip: usize) -> Value {
        let mut found = None;
        eventually(&format!("the app sends {kind}"), || {
            found = self.received.lock().unwrap().iter().filter(|e| e["type"] == kind).nth(skip).cloned();
            found.is_some()
        });
        found.unwrap()
    }

    fn kinds(&self) -> Vec<String> {
        self.received.lock().unwrap().iter().map(|e| e["type"].as_str().unwrap_or_default().to_string()).collect()
    }
}

fn eventually(what: &str, mut ok: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !ok() {
        assert!(Instant::now() < deadline, "{what} did not happen within 10 s");
        std::thread::sleep(Duration::from_millis(5));
    }
}

struct App {
    talk: Option<Talk>,
    updates: Arc<Mutex<Vec<Update>>>,
}

impl App {
    fn start(service: Service, turns: Turns, options: Options) -> App {
        let updates = Arc::new(Mutex::new(Vec::new()));
        let heard = updates.clone();
        let settings = SessionSettings { instructions: "Answer in Japanese.".into(), voice: Some("marin".into()), turns };
        let talk = Talk::start(service, settings, options, Box::new(move |update| heard.lock().unwrap().push(update)));
        App { talk: Some(talk), updates }
    }

    fn talk(&self) -> &Talk {
        self.talk.as_ref().unwrap()
    }

    fn heard(&self, what: &str, ok: impl Fn(&Update) -> bool) -> Update {
        let mut found = None;
        eventually(what, || {
            found = self.updates.lock().unwrap().iter().find(|u| ok(u)).cloned();
            found.is_some()
        });
        found.unwrap()
    }

    fn closed(&self) -> Closed {
        match self.heard("the conversation ends", |u| matches!(u, Update::Closed(_))) {
            Update::Closed(closed) => closed,
            _ => unreachable!(),
        }
    }
}

fn options(wait_ms: u64) -> Options {
    Options { network: Network::LoopbackOnly, wait: Duration::from_millis(wait_ms), keep_images: 1 }
}

fn service(fake: &FakeService) -> Service {
    Service { url: fake.url.clone(), model: Some("gpt-realtime".into()), key: Some(Key::new("sk-test-key")) }
}

/// A conversation whose settings were taken.
fn ready(turns: Turns) -> (FakeService, App) {
    let fake = FakeService::start(None);
    let app = App::start(service(&fake), turns, options(5000));
    fake.sent("session.update", 0);
    fake.say(json!({ "type": "session.updated", "session": {} }));
    app.heard("ready", |u| *u == Update::Event(Event::Ready));
    (fake, app)
}

fn pcm(ms: usize) -> Vec<u8> {
    (0..ms * 24).flat_map(|i| ((i % 100) as i16 * 100).to_le_bytes()).collect()
}

#[test]
fn the_settings_go_first_with_the_key_and_the_model_then_the_conversation_is_ready() {
    let (fake, _app) = ready(Turns::server_vad());
    let (target, authorization) = fake.handshake.lock().unwrap().clone().unwrap();
    assert_eq!(target, "/v1/realtime?model=gpt-realtime");
    assert_eq!(authorization.as_deref(), Some("Bearer sk-test-key"));
    let update = &fake.received.lock().unwrap()[0];
    assert_eq!(update["type"], "session.update", "the settings come before anything else");
    assert_eq!(update["session"]["audio"]["input"]["format"], json!({ "type": "audio/pcm", "rate": 24000 }));
    assert_eq!(update["session"]["instructions"], "Answer in Japanese.");
}

#[test]
fn audio_goes_as_base64_and_the_answer_s_audio_comes_back_as_pcm() {
    let (fake, app) = ready(Turns::server_vad());
    let spoken = pcm(20);
    assert!(app.talk().send_audio(spoken.clone()));
    let append = fake.sent("input_audio_buffer.append", 0);
    assert_eq!(STANDARD.decode(append["audio"].as_str().unwrap()).unwrap(), spoken);

    let answer = pcm(40);
    fake.say(json!({ "type": "response.created", "response": { "id": "resp_1", "status": "in_progress" } }));
    fake.say(json!({ "type": "response.output_audio.delta", "response_id": "resp_1", "item_id": "item_1", "output_index": 0, "content_index": 0, "delta": STANDARD.encode(&answer) }));
    fake.say(json!({ "type": "response.output_audio_transcript.delta", "response_id": "resp_1", "item_id": "item_1", "output_index": 0, "content_index": 0, "delta": "こんにちは" }));
    fake.say(json!({ "type": "response.done", "response": { "id": "resp_1", "status": "completed" } }));
    assert_eq!(app.heard("the answer's audio", |u| matches!(u, Update::Event(Event::Audio { .. }))), Update::Event(Event::Audio { item_id: "item_1".into(), pcm: answer }));
    app.heard("what it says", |u| *u == Update::Event(Event::Transcript { item_id: "item_1".into(), text: "こんにちは".into() }));
    app.heard("its end", |u| *u == Update::Event(Event::AnswerDone { status: Status::Completed }));
}

#[test]
fn speech_during_an_answer_stops_its_playback_and_cuts_it_where_it_was_heard() {
    let (fake, app) = ready(Turns::server_vad());
    fake.say(json!({ "type": "response.created", "response": { "id": "resp_1" } }));
    fake.say(json!({ "type": "response.output_audio.delta", "response_id": "resp_1", "item_id": "item_1", "delta": STANDARD.encode(pcm(500)) }));
    app.heard("the answer's audio", |u| matches!(u, Update::Event(Event::Audio { .. })));
    app.talk().played("item_1", 240);
    fake.say(json!({ "type": "input_audio_buffer.speech_started", "audio_start_ms": 1000, "item_id": "item_2" }));
    app.heard("the user speaks", |u| *u == Update::Event(Event::UserSpeaking));
    app.heard("playback stops", |u| *u == Update::Event(Event::StopPlayback));
    assert_eq!(fake.sent("conversation.item.truncate", 0), json!({ "type": "conversation.item.truncate", "item_id": "item_1", "content_index": 0, "audio_end_ms": 240 }));
    // The service cancelled the answer itself (server VAD).
    assert!(!fake.kinds().contains(&"response.cancel".to_string()));
}

#[test]
fn a_picture_joins_the_conversation_and_only_the_newest_stays() {
    let (fake, app) = ready(Turns::server_vad());
    assert!(app.talk().send_image(vec![0xff, 0xd8, 0xff, 0xe0]));
    let first = fake.sent("conversation.item.create", 0);
    assert_eq!(first["item"]["content"][0], json!({ "type": "input_image", "image_url": "data:image/jpeg;base64,/9j/4A==" }));
    assert!(app.talk().send_image(vec![0xff, 0xd8, 0xff, 0xe1]));
    let second = fake.sent("conversation.item.create", 1);
    assert_ne!(second["item"]["id"], first["item"]["id"]);
    assert_eq!(fake.sent("conversation.item.delete", 0), json!({ "type": "conversation.item.delete", "item_id": first["item"]["id"] }));
    assert!(!fake.kinds().contains(&"response.create".to_string()), "a picture asks for no answer");
}

#[test]
fn the_app_ends_the_turn_when_the_service_does_not() {
    let (fake, app) = ready(Turns::Manual);
    assert!(fake.received.lock().unwrap()[0]["session"]["audio"]["input"]["turn_detection"].is_null());
    app.talk().send_audio(pcm(20));
    fake.sent("input_audio_buffer.append", 0);
    app.talk().end_turn();
    fake.sent("input_audio_buffer.commit", 0);
    assert_eq!(fake.sent("response.create", 0)["response"]["instructions"], "Answer in Japanese.");
    let kinds = fake.kinds();
    let at = |kind: &str| kinds.iter().position(|k| k == kind).unwrap();
    assert!(at("input_audio_buffer.append") < at("input_audio_buffer.commit") && at("input_audio_buffer.commit") < at("response.create"));
}

#[test]
fn a_refused_key_ends_the_conversation_with_its_code() {
    let fake = FakeService::start(Some(401));
    let app = App::start(service(&fake), Turns::server_vad(), options(5000));
    let closed = app.closed();
    assert_eq!(closed, Closed::Failed(Failure::Open(OpenError::KeyRefused)));
    let Closed::Failed(failure) = closed else { unreachable!() };
    assert_eq!(failure.code(), "talk_key_refused");
}

#[test]
fn settings_that_are_never_taken_end_the_conversation_in_time() {
    let fake = FakeService::start(None);
    let app = App::start(service(&fake), Turns::server_vad(), options(300));
    fake.sent("session.update", 0);
    assert_eq!(app.closed(), Closed::Failed(Failure::SessionTimeout));
    assert!(!app.updates.lock().unwrap().contains(&Update::Event(Event::Ready)));
}

#[test]
fn refused_settings_end_the_conversation_with_the_service_s_code() {
    let fake = FakeService::start(None);
    let app = App::start(service(&fake), Turns::server_vad(), options(5000));
    fake.sent("session.update", 0);
    fake.say(json!({ "type": "error", "error": { "type": "invalid_request_error", "code": "invalid_value", "message": "Invalid voice", "param": "session.audio.output.voice" } }));
    app.heard("the refusal", |u| *u == Update::Event(Event::ServiceError { code: Some("invalid_value".into()) }));
    assert_eq!(app.closed(), Closed::Failed(Failure::SessionRefused));
}

#[test]
fn the_service_ending_the_conversation_is_told() {
    let (fake, app) = ready(Turns::server_vad());
    fake.script.send(Script::Close).unwrap();
    assert_eq!(app.closed(), Closed::Failed(Failure::ServerClosed));
}

#[test]
fn stopping_closes_the_socket_and_ends_the_conversation_at_once() {
    let (fake, mut app) = ready(Turns::server_vad());
    let started = Instant::now();
    assert!(app.talk.take().unwrap().stop(Duration::from_secs(5)));
    assert!(started.elapsed() < Duration::from_secs(1), "{:?}", started.elapsed());
    assert_eq!(app.closed(), Closed::Stopped);
    eventually("the service sees the close", || fake.closed.load(Ordering::SeqCst));
}

#[test]
fn stopping_while_nothing_answers_ends_at_once() {
    // A port that accepts the connection but never answers the handshake.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("ws://127.0.0.1:{}/v1/realtime", listener.local_addr().unwrap().port());
    let mut app = App::start(Service { url, model: None, key: None }, Turns::server_vad(), options(30_000));
    std::thread::sleep(Duration::from_millis(100));
    let started = Instant::now();
    assert!(app.talk.take().unwrap().stop(Duration::from_secs(5)));
    assert!(started.elapsed() < Duration::from_secs(1), "{:?}", started.elapsed());
    assert_eq!(app.closed(), Closed::Stopped);
    drop(listener);
}
