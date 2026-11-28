//! Gemini Live's native audio and JPEG WebSocket protocol. The public entry point sends the
//! credential only to the Gemini Developer API. The server handles turn detection and barge-in.

use crate::connection::{self, Key, Network, Socket};
use crate::conversation::Event;
use crate::protocol::Status;
use crate::talk::{Closed, Control, Failure, Media, OnUpdate, POLL, Talk, Update};
use astarot_translation::http::Cancel;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};
use tungstenite::{Error, Message};

const URL: &str = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

/// The model and optional persona settings for a Gemini Live session.
pub struct Settings {
    pub model: String,
    pub instructions: String,
    pub voice: Option<String>,
}

/// Opens a Gemini Live session with automatic voice activity detection. Local interruption
/// stops playback until the end of the current answer. Gemini tracks server-side barge-in
/// itself, so playback positions and manually ending a turn have no effect.
pub fn start(key: Key, settings: Settings, on_update: OnUpdate) -> Talk {
    start_at(
        URL.into(),
        Network::SystemProxy,
        Duration::from_secs(10),
        key,
        settings,
        on_update,
    )
}

fn start_at(
    url: String,
    network: Network,
    wait: Duration,
    key: Key,
    settings: Settings,
    mut on_update: OnUpdate,
) -> Talk {
    Talk::spawn(move |media, control, cancel| {
        let result = connection::open_gemini(&url, key, network, wait, POLL, &cancel)
            .map_err(Failure::Open)
            .and_then(|socket| {
                Exchange {
                    socket,
                    media,
                    control,
                    cancel: &cancel,
                    notify: &mut on_update,
                }
                .run(settings, wait)
            });
        on_update(Update::Closed(match result {
            _ if cancel.is_cancelled() => Closed::Stopped,
            Ok(()) => Closed::Stopped,
            Err(failure) => Closed::Failed(failure),
        }));
    })
}

struct Exchange<'a> {
    socket: Socket,
    media: Receiver<Media>,
    control: Receiver<Control>,
    cancel: &'a Cancel,
    notify: &'a mut OnUpdate,
}

impl Exchange<'_> {
    fn run(mut self, settings: Settings, wait: Duration) -> Result<(), Failure> {
        self.send(setup(settings))?;
        let opened = Instant::now();
        let mut ready = false;
        let mut suppress_audio = false;
        let mut answering = false;
        let mut turn = 0_u64;
        while !self.cancel.is_cancelled() {
            for command in self.control.try_iter().take(64) {
                if matches!(command, Control::Interrupt) && ready {
                    suppress_audio |= answering;
                    (self.notify)(Update::Event(Event::StopPlayback));
                }
            }
            for _ in 0..8 {
                if self.cancel.is_cancelled() {
                    return Ok(());
                }
                let Ok(media) = self.media.try_recv() else {
                    break;
                };
                if ready {
                    self.send(realtime_input(media))?;
                }
            }

            let message = match self.socket.read() {
                Ok(Message::Text(text)) => serde_json::from_str::<Value>(text.as_str()).ok(),
                Ok(Message::Binary(bytes)) => serde_json::from_slice::<Value>(&bytes).ok(),
                Ok(Message::Close(_)) | Err(Error::ConnectionClosed | Error::AlreadyClosed) => {
                    return Err(if ready {
                        Failure::ServerClosed
                    } else {
                        Failure::SessionRefused
                    });
                }
                Ok(_) => None,
                Err(Error::Io(error))
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ) =>
                {
                    None
                }
                Err(_) => return Err(Failure::ConnectionLost),
            };
            if let Some(message) = message {
                if message.get("goAway").is_some() {
                    return Err(Failure::ServerClosed);
                }
                if message.get("error").is_some() {
                    if !ready {
                        return Err(Failure::SessionRefused);
                    }
                    (self.notify)(Update::Event(Event::ServiceError { code: None }));
                }
                if !ready && message.get("setupComplete").is_some() {
                    ready = true;
                    (self.notify)(Update::Event(Event::Ready));
                }
                if ready && let Some(content) = message.get("serverContent") {
                    let interrupted = content["interrupted"].as_bool() == Some(true);
                    if interrupted {
                        suppress_audio = true;
                        (self.notify)(Update::Event(Event::StopPlayback));
                    }
                    if !suppress_audio && let Some(parts) = content["modelTurn"]["parts"].as_array()
                    {
                        for part in parts {
                            if let Some(pcm) = decode_audio(&part["inlineData"]) {
                                answering = true;
                                (self.notify)(Update::Event(Event::Audio {
                                    item_id: format!("gemini_{turn}"),
                                    pcm,
                                }));
                            }
                        }
                    }
                    if content["turnComplete"].as_bool() == Some(true) {
                        let status = if suppress_audio {
                            Status::Cancelled
                        } else {
                            Status::Completed
                        };
                        (self.notify)(Update::Event(Event::AnswerDone { status }));
                        turn += 1;
                        suppress_audio = false;
                        answering = false;
                    }
                }
            }
            if !ready && opened.elapsed() >= wait {
                return Err(Failure::SessionTimeout);
            }
            self.socket.flush().map_err(|_| Failure::ConnectionLost)?;
        }
        let _ = self.socket.close(None);
        Ok(())
    }

    fn send(&mut self, value: Value) -> Result<(), Failure> {
        self.socket
            .send(Message::text(value.to_string()))
            .map_err(|_| Failure::ConnectionLost)
    }
}

fn setup(settings: Settings) -> Value {
    let model = if settings.model.starts_with("models/") {
        settings.model
    } else {
        format!("models/{}", settings.model)
    };
    let mut setup = json!({
        "model": model,
        "generationConfig": { "responseModalities": ["AUDIO"] }
    });
    if !settings.instructions.is_empty() {
        setup["systemInstruction"] = json!({ "parts": [{ "text": settings.instructions }] });
    }
    if let Some(voice) = settings.voice {
        setup["generationConfig"]["speechConfig"] = json!({
            "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": voice } }
        });
    }
    json!({ "setup": setup })
}

fn realtime_input(media: Media) -> Value {
    match media {
        Media::Audio(pcm) => {
            json!({ "realtimeInput": { "audio": { "mimeType": "audio/pcm;rate=24000", "data": STANDARD.encode(pcm) } } })
        }
        Media::Image(jpeg) => {
            json!({ "realtimeInput": { "video": { "mimeType": "image/jpeg", "data": STANDARD.encode(jpeg) } } })
        }
    }
}

fn decode_audio(blob: &Value) -> Option<Vec<u8>> {
    let mut mime = blob["mimeType"].as_str()?.split(';').map(str::trim);
    if mime.next()? != "audio/pcm" || !mime.any(|parameter| parameter == "rate=24000") {
        return None;
    }
    let pcm = STANDARD.decode(blob["data"].as_str()?).ok()?;
    (!pcm.is_empty() && pcm.len().is_multiple_of(2)).then_some(pcm)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use tungstenite::handshake::server::{Request, Response};

    #[test]
    fn exchanges_media_after_setup_and_stops_playback_on_barge_in() {
        let listen = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("ws://{}", listen.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let stream = listen.accept().unwrap().0;
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut socket =
                tungstenite::accept_hdr(stream, |request: &Request, response: Response| {
                    assert_eq!(request.headers()["x-goog-api-key"], "test-key");
                    assert!(request.headers().get("authorization").is_none());
                    assert!(request.uri().query().is_none());
                    Ok(response)
                })
                .unwrap();
            let read = |socket: &mut tungstenite::WebSocket<_>| {
                let message = socket.read().unwrap();
                serde_json::from_str::<Value>(message.to_text().unwrap()).unwrap()
            };
            let setup = read(&mut socket);
            assert_eq!(setup["setup"]["model"], "models/test-model");
            assert_eq!(
                setup["setup"]["generationConfig"]["responseModalities"],
                json!(["AUDIO"])
            );
            socket
                .send(Message::binary(br#"{"setupComplete":{}}"#.to_vec()))
                .unwrap();
            let audio = read(&mut socket);
            assert_eq!(
                audio["realtimeInput"]["audio"],
                json!({"mimeType":"audio/pcm;rate=24000","data":"AQI="})
            );
            let image = read(&mut socket);
            assert_eq!(
                image["realtimeInput"]["video"],
                json!({"mimeType":"image/jpeg","data":"AwQ="})
            );
            socket.send(Message::text(json!({"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"BQY="}}]}}}).to_string())).unwrap();
            socket
                .send(Message::text(
                    r#"{"serverContent":{"interrupted":true,"turnComplete":true}}"#,
                ))
                .unwrap();
            assert!(matches!(
                socket.read(),
                Ok(Message::Close(_))
                    | Err(Error::Protocol(
                        tungstenite::error::ProtocolError::ResetWithoutClosingHandshake
                    ))
            ));
        });
        let (tx, rx) = mpsc::channel();
        let wait = Duration::from_secs(3);
        let talk = start_at(
            url,
            Network::LoopbackOnly,
            wait,
            Key::new("test-key"),
            Settings {
                model: "test-model".into(),
                instructions: String::new(),
                voice: None,
            },
            Box::new(move |update| tx.send(update).unwrap()),
        );
        assert_eq!(rx.recv_timeout(wait).unwrap(), Update::Event(Event::Ready));
        assert!(talk.send_audio(vec![1, 2]));
        assert!(talk.send_image(vec![3, 4]));
        assert_eq!(
            rx.recv_timeout(wait).unwrap(),
            Update::Event(Event::Audio {
                item_id: "gemini_0".into(),
                pcm: vec![5, 6]
            })
        );
        assert_eq!(
            rx.recv_timeout(wait).unwrap(),
            Update::Event(Event::StopPlayback)
        );
        assert_eq!(
            rx.recv_timeout(wait).unwrap(),
            Update::Event(Event::AnswerDone {
                status: Status::Cancelled
            })
        );
        assert!(talk.stop(wait));
        assert_eq!(
            rx.recv_timeout(wait).unwrap(),
            Update::Closed(Closed::Stopped)
        );
        server.join().unwrap();
    }
}
