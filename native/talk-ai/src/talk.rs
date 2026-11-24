//! One conversation with a service, on a thread of its own.
//!
//! The thread owns the WebSocket: it sends what the app hands over and reads the service's events
//! between sends, each read waiting at most 20 ms. What the conversation decides
//! ([`crate::conversation`]) it carries out: events go out, and what the app needs to hear goes to
//! the app's callback, on this thread. The app's audio and pictures wait in a bounded queue and
//! are dropped when it is full or before the session is ready; what the app says about playback
//! and turns is never dropped.
//!
//! Only the [`Talk`] holds the right to stop its conversation. Stopping or dropping it ends the
//! thread within about 20 ms, also while it connects.

use crate::connection::{self, Network, OpenError, Service, Socket};
use crate::conversation::{Conversation, Effect, Event, Input};
use crate::protocol::{self, ServerEvent, SessionSettings};
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tungstenite::Message;
use astarot_translation::http::Cancel;

/// How long one read waits before the thread sends what came meanwhile.
pub(crate) const POLL: Duration = Duration::from_millis(20);
/// Audio and pictures waiting to be sent: 64 parts of 20 ms are 1.3 s.
const MEDIA_QUEUE: usize = 64;

/// How a conversation connects and keeps its pictures.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Options {
    pub network: Network,
    /// How long connecting, each handshake and taking the settings may take.
    pub wait: Duration,
    /// How many of the latest pictures stay in the conversation (at least 1); older ones are
    /// taken out, so that a long conversation does not carry every picture it was shown.
    pub keep_images: usize,
}

impl Default for Options {
    fn default() -> Options {
        Options { network: Network::SystemProxy, wait: Duration::from_secs(10), keep_images: 1 }
    }
}

/// Why a conversation failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Open(OpenError),
    /// The settings were not taken in time.
    SessionTimeout,
    /// The service refused the settings.
    SessionRefused,
    /// The service ended the conversation (for one, at its longest time).
    ServerClosed,
    /// The connection broke.
    ConnectionLost,
}

impl Failure {
    pub fn code(self) -> &'static str {
        match self {
            Failure::Open(error) => error.code(),
            Failure::SessionTimeout => "talk_session_timeout",
            Failure::SessionRefused => "talk_session_refused",
            Failure::ServerClosed => "talk_server_closed",
            Failure::ConnectionLost => "talk_connection_lost",
        }
    }
}

/// How a conversation ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Closed {
    /// The app stopped it.
    Stopped,
    Failed(Failure),
}

/// What the app hears, on the conversation's thread. [`Update::Closed`] comes once, last.
#[derive(Clone, Debug, PartialEq)]
pub enum Update {
    Event(Event),
    Closed(Closed),
}

pub type OnUpdate = Box<dyn FnMut(Update) + Send>;

pub(crate) enum Media {
    Audio(Vec<u8>),
    Image(Vec<u8>),
}

pub(crate) enum Control {
    Played { item_id: String, ms: u64 },
    Interrupt,
    EndTurn,
}

/// The right to stop a conversation.
struct Stop(Cancel);

impl Stop {
    fn stop(&self) {
        self.0.cancel();
    }
}

/// A conversation with a service.
pub struct Talk {
    media: SyncSender<Media>,
    control: Sender<Control>,
    stop: Stop,
    worker: Option<JoinHandle<()>>,
}

impl Talk {
    /// Connects and opens the conversation. `on_update` hears [`Event::Ready`] once the settings
    /// were taken, and [`Update::Closed`] when it ends.
    pub fn start(service: Service, settings: SessionSettings, options: Options, on_update: OnUpdate) -> Talk {
        Self::spawn(move |media, control, cancel| run(service, settings, options, media, control, cancel, on_update))
    }

    pub(crate) fn spawn(run: impl FnOnce(Receiver<Media>, Receiver<Control>, Cancel) + Send + 'static) -> Talk {
        let (media, media_inbox) = mpsc::sync_channel(MEDIA_QUEUE);
        let (control, control_inbox) = mpsc::channel();
        let cancel = Cancel::new();
        let stop = Stop(cancel.clone());
        // A thread that cannot be made leaves a conversation that takes nothing and never opens.
        let worker = std::thread::Builder::new()
            .name("talk-ai".into())
            .spawn(move || run(media_inbox, control_inbox, cancel))
            .ok();
        Talk { media, control, stop, worker }
    }

    /// The user's audio: 16-bit PCM, mono, little-endian, 24 kHz. `false` when it was dropped (a
    /// full queue, or the conversation ended).
    pub fn send_audio(&self, pcm: Vec<u8>) -> bool {
        self.media.try_send(Media::Audio(pcm)).is_ok()
    }

    /// A picture of what the user sees, as JPEG. It joins the conversation without asking for an
    /// answer. `false` when it was dropped.
    pub fn send_image(&self, jpeg: Vec<u8>) -> bool {
        self.media.try_send(Media::Image(jpeg)).is_ok()
    }

    /// How far the app played an item's audio, from its start.
    pub fn played(&self, item_id: &str, ms: u64) {
        let _ = self.control.send(Control::Played { item_id: item_id.to_string(), ms });
    }

    /// Stops the answer: [`Event::StopPlayback`] follows when some of it was not heard yet.
    pub fn interrupt(&self) {
        let _ = self.control.send(Control::Interrupt);
    }

    /// The user's turn ends: the service answers what it heard ([`protocol::Turns::Manual`]).
    pub fn end_turn(&self) {
        let _ = self.control.send(Control::EndTurn);
    }

    /// Ends the conversation and waits up to `timeout` for its thread. `true` when it ended.
    pub fn stop(mut self, timeout: Duration) -> bool {
        self.stop.stop();
        let Some(worker) = self.worker.take() else { return true };
        let deadline = Instant::now() + timeout;
        while !worker.is_finished() {
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        worker.join().is_ok()
    }
}

impl Drop for Talk {
    fn drop(&mut self) {
        self.stop.stop();
    }
}

fn run(service: Service, settings: SessionSettings, options: Options, media: Receiver<Media>, control: Receiver<Control>, cancel: Cancel, mut on_update: OnUpdate) {
    let closed = match connection::open(&service, options.network, options.wait, POLL, &cancel) {
        Ok(socket) => Session { socket, conversation: Conversation::new(settings), images: VecDeque::new(), image_count: 0, options, opened: Instant::now() }.serve(&media, &control, &cancel, &mut on_update),
        Err(_) if cancel.is_cancelled() => Closed::Stopped,
        Err(error) => Closed::Failed(Failure::Open(error)),
    };
    on_update(Update::Closed(closed));
}

struct Session {
    socket: Socket,
    conversation: Conversation,
    /// The pictures in the conversation, oldest first.
    images: VecDeque<String>,
    image_count: u64,
    options: Options,
    opened: Instant,
}

impl Session {
    fn serve(mut self, media: &Receiver<Media>, control: &Receiver<Control>, cancel: &Cancel, on_update: &mut OnUpdate) -> Closed {
        match self.exchange(media, control, cancel, on_update) {
            Ok(()) => {
                let _ = self.socket.close(None);
                let _ = self.socket.flush();
                Closed::Stopped
            }
            Err(_) if cancel.is_cancelled() => Closed::Stopped,
            Err(failure) => Closed::Failed(failure),
        }
    }

    /// Sends and reads until the app stops (`Ok`) or the conversation fails.
    fn exchange(&mut self, media: &Receiver<Media>, control: &Receiver<Control>, cancel: &Cancel, on_update: &mut OnUpdate) -> Result<(), Failure> {
        loop {
            if cancel.is_cancelled() {
                return Ok(());
            }
            self.take_control(control, on_update)?;
            while let Ok(item) = media.try_recv() {
                if !self.conversation.ready() {
                    continue;
                }
                match item {
                    Media::Audio(pcm) => self.send(&protocol::append_audio(&pcm))?,
                    Media::Image(jpeg) => self.send_image(&jpeg)?,
                }
            }
            match self.socket.read() {
                Ok(Message::Text(text)) => {
                    // An event that cannot be read is left; the conversation goes on.
                    if let Ok(event) = protocol::parse(text.as_str()) {
                        // What the app said before the event came counts first: how far an answer
                        // played decides where the user's speech cuts it.
                        self.take_control(control, on_update)?;
                        let opening = !self.conversation.ready();
                        let refused = opening && matches!(event, ServerEvent::Error { .. });
                        let effects = self.conversation.step(Input::Server(event));
                        self.apply(effects, on_update)?;
                        if refused {
                            return Err(Failure::SessionRefused);
                        }
                    }
                }
                Ok(Message::Close(_)) => return Err(Failure::ServerClosed),
                Ok(_) => {}
                Err(tungstenite::Error::Io(error)) if matches!(error.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => {}
                Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => return Err(Failure::ServerClosed),
                Err(_) => return Err(Failure::ConnectionLost),
            }
            if !self.conversation.ready() && self.opened.elapsed() >= self.options.wait {
                return Err(Failure::SessionTimeout);
            }
            // Pongs to the service's pings go out with the next write; when nothing was sent,
            // they go now.
            match self.socket.flush() {
                Ok(()) => {}
                Err(tungstenite::Error::Io(error)) if matches!(error.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => {}
                Err(_) => return Err(Failure::ConnectionLost),
            }
        }
    }

    /// Carries out what the app said about playback and turns.
    fn take_control(&mut self, control: &Receiver<Control>, on_update: &mut OnUpdate) -> Result<(), Failure> {
        while let Ok(command) = control.try_recv() {
            let input = match command {
                Control::Played { item_id, ms } => Input::Played { item_id, ms },
                Control::Interrupt => Input::Interrupt,
                Control::EndTurn => Input::EndTurn,
            };
            let effects = self.conversation.step(input);
            self.apply(effects, on_update)?;
        }
        Ok(())
    }

    fn apply(&mut self, effects: Vec<Effect>, on_update: &mut OnUpdate) -> Result<(), Failure> {
        for effect in effects {
            match effect {
                Effect::Send(event) => self.send(&event)?,
                Effect::Tell(event) => on_update(Update::Event(event)),
            }
        }
        Ok(())
    }

    fn send(&mut self, event: &Value) -> Result<(), Failure> {
        self.socket.send(Message::text(event.to_string())).map_err(|_| Failure::ConnectionLost)
    }

    fn send_image(&mut self, jpeg: &[u8]) -> Result<(), Failure> {
        self.image_count += 1;
        let id = format!("img_{}", self.image_count);
        self.send(&protocol::image(&id, jpeg))?;
        self.images.push_back(id);
        while self.images.len() > self.options.keep_images.max(1) {
            let Some(old) = self.images.pop_front() else { break };
            self.send(&protocol::delete_item(&old))?;
        }
        Ok(())
    }
}
