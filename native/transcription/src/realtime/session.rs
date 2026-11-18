//! One realtime recognition session (`realtime_session.py`, `speechcpp_realtime.py`,
//! `realtime_audio.py`): the capture of one endpoint, streamed to a speech.cpp server over its
//! Realtime WebSocket, with the caption updates waiting in a bounded mailbox.
//!
//! One thread owns the connection: it sends the audio as it comes (48 kHz frames converted to
//! 24 kHz blocks of 20 ms) and reads the server's events between sends. Audio older than
//! 250 ms, a mailbox of more than 32 updates, a server that does not finish an utterance in
//! 15 s (120 s for the first one, while a GPU builds its kernels), a capture that fails or a
//! microphone that delivers nothing (5 s after it opened, 2 s after its last audio) end the
//! session with a fixed code. Nothing here logs audio or text.

use super::events::{Events, Update};
use crate::capture::{Capture, CapturePlatform, FrameBuilder, Source, Target};
use crate::pcm::{self, Resampler};
use crate::speechcpp;
use crate::terms::Dictionary;
use serde_json::{Value, json};
use std::collections::{HashMap, VecDeque};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tungstenite::protocol::WebSocketConfig;
use tungstenite::{Message, WebSocket};
use vrct_audio_routing::graph::Endpoint;
use vrct_translation::http::Transport;

pub const RATE: u32 = 24000;
const MAX_AGE: Duration = Duration::from_millis(250);
const PENDING_TIMEOUT: Duration = Duration::from_secs(15);
const FIRST_RESULT_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_EVENT: usize = 1024 * 1024;
const MAILBOX: usize = 32;
/// Windows can hold a microphone's open until the user answers its question.
const CAPTURE_OPEN_TIMEOUT: Duration = Duration::from_secs(120);
/// A microphone that delivers nothing this long after it opened, or this long after its last
/// audio, has stopped (`_START_TIMEOUT_S` and `_STALL_NS` of `capture_windows.py`, and the
/// same limits of the Linux helper). A speaker's loopback is filled with silence instead.
const FIRST_AUDIO_TIMEOUT: Duration = Duration::from_secs(5);
const STALL_TIMEOUT: Duration = Duration::from_secs(2);

/// What a session asks of the server (`SessionOptions`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Options {
    pub base_url: String,
    pub model: String,
    /// A code, or "auto".
    pub language: String,
    /// The merged vocabulary terms.
    pub vocabulary: Vec<String>,
    /// The silence that ends an utterance (`server_vad`'s `silence_duration_ms`); `None` is
    /// [`DEFAULT_SILENCE_MS`].
    pub silence_duration_ms: Option<u32>,
}

/// The silence that ends an utterance unless the settings choose another: speech.cpp's and
/// OpenAI's default.
pub const DEFAULT_SILENCE_MS: u32 = 500;
/// The padding speech.cpp keeps on either side of an utterance by default (`prefix_padding_ms`).
const MAX_PADDING_MS: u32 = 300;

/// `server_vad` with the silence that ends an utterance and a padding of at most half of it.
///
/// speech.cpp gives an utterance once no other can start within twice its padding of its end
/// (its record "a detection of audio given a piece at a time gives speech_detect()'s regions,
/// each once it is certain"). With its defaults, 500 ms of silence and 300 ms of padding, that
/// is 600 ms after the speech, not 500 (#556). With the padding at most half the silence the
/// utterance comes when the silence has lasted, and the silence alone still decides where
/// utterances are cut.
pub fn turn_detection(silence_duration_ms: Option<u32>) -> Value {
    let silence = silence_duration_ms.unwrap_or(DEFAULT_SILENCE_MS);
    json!({ "type": "server_vad", "silence_duration_ms": silence, "prefix_padding_ms": (silence / 2).min(MAX_PADDING_MS) })
}

#[derive(Clone, Debug)]
struct Status {
    state: &'static str,
    error: Option<String>,
    namespace: Option<String>,
}

struct Ingress {
    frames: VecDeque<(Vec<i16>, Instant)>,
    samples: usize,
    reason: Option<&'static str>,
}

struct Inner {
    source: Source,
    options: Options,
    endpoint: Endpoint,
    platform: Arc<dyn CapturePlatform>,
    transport: Transport,
    status: Mutex<Status>,
    stop: AtomicBool,
    updates: Mutex<VecDeque<Update>>,
    arrived: Condvar,
    ingress: Mutex<Ingress>,
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
    finished: AtomicBool,
}

/// A single-use session. Clone it to share.
#[derive(Clone)]
pub struct Session {
    inner: Arc<Inner>,
}

/// The failure code of a session error (`_failure_code`).
#[derive(Debug)]
enum Failure {
    /// A fixed code the state reports as it is.
    Session(&'static str),
    /// A transport failure: `realtime_asr_timeout` for the deadlines, else
    /// `realtime_session_failed`.
    Realtime(&'static str),
    Stopped,
}

impl Failure {
    fn code(&self) -> &'static str {
        match self {
            Failure::Session(code) => code,
            Failure::Realtime("utterance_timeout" | "commit_ack_timeout") => "realtime_asr_timeout",
            _ => "realtime_session_failed",
        }
    }
}

static NAMESPACES: AtomicU64 = AtomicU64::new(0);

fn namespace() -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let count = NAMESPACES.fetch_add(1, Ordering::SeqCst);
    format!("{:016x}{:08x}{:08x}", nanos as u64, std::process::id(), count as u32)
}

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub(crate) fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(BASE64[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn percent(text: &str) -> String {
    text.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

pub(crate) type Socket = WebSocket<TcpStream>;

/// Opens `/v1/realtime` of a speech.cpp server on this computer, with `model` as the query when
/// one is named (the server's recognition model otherwise). Reads wait at most 2 s.
pub(crate) fn open_socket(base_url: &str, model: Option<&str>) -> Option<Socket> {
    let base = base_url.trim_end_matches('/');
    let url = vrct_translation::http::Url::parse(base).ok()?;
    let address = (url.host.trim_start_matches('[').trim_end_matches(']'), url.port).to_socket_addrs().ok()?.next()?;
    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(2)).ok()?;
    let _ = stream.set_nodelay(true);
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(1))).ok()?;
    let mut target = format!("{}/v1/realtime", base.replacen("http://", "ws://", 1));
    if let Some(model) = model {
        target.push_str(&format!("?model={}", percent(model)));
    }
    let config = WebSocketConfig::default().max_message_size(Some(MAX_EVENT)).max_frame_size(Some(MAX_EVENT));
    tungstenite::client::client_with_config(target, stream, Some(config)).ok().map(|(socket, _)| socket)
}

impl Session {
    pub fn new(
        source: Source,
        options: Options,
        endpoint: Endpoint,
        platform: Arc<dyn CapturePlatform>,
        transport: Transport,
    ) -> Session {
        Session {
            inner: Arc::new(Inner {
                source,
                options,
                endpoint,
                platform,
                transport,
                status: Mutex::new(Status { state: "idle", error: None, namespace: None }),
                stop: AtomicBool::new(false),
                updates: Mutex::new(VecDeque::new()),
                arrived: Condvar::new(),
                ingress: Mutex::new(Ingress { frames: VecDeque::new(), samples: 0, reason: None }),
                thread: Mutex::new(None),
                finished: AtomicBool::new(false),
            }),
        }
    }

    pub fn source(&self) -> Source {
        self.inner.source
    }

    fn status(&self) -> std::sync::MutexGuard<'_, Status> {
        self.inner.status.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `{source, state, namespace, error_code}`.
    pub fn health(&self) -> Value {
        let status = self.status().clone();
        json!({
            "source": self.inner.source.as_str(),
            "state": status.state,
            "namespace": status.namespace,
            "error_code": status.error,
        })
    }

    pub fn state(&self) -> &'static str {
        self.status().state
    }

    pub fn error(&self) -> Option<String> {
        self.status().error.clone()
    }

    pub fn namespace(&self) -> Option<String> {
        self.status().namespace.clone()
    }

    /// Whether updates of `namespace` may still be shown.
    pub fn is_current(&self, namespace: &str) -> bool {
        let status = self.status();
        !self.inner.stop.load(Ordering::SeqCst) && status.state == "ready" && status.namespace.as_deref() == Some(namespace)
    }

    /// Starts the session's thread; it never waits for the server or the device.
    pub fn start(&self) -> Result<(), &'static str> {
        let mut thread = self.inner.thread.lock().unwrap_or_else(|e| e.into_inner());
        if thread.is_some() || self.inner.stop.load(Ordering::SeqCst) {
            return Err("realtime_session_single_use");
        }
        self.status().state = "starting";
        let session = self.clone();
        *thread = Some(
            std::thread::Builder::new()
                .name(format!("realtime-{}", self.inner.source.as_str()))
                .spawn(move || session.main())
                .map_err(|_| "realtime_start_failed")?,
        );
        Ok(())
    }

    /// Invalidates the output now; [`close`](Self::close) waits for the resources.
    pub fn request_stop(&self) {
        self.inner.stop.store(true, Ordering::SeqCst);
        self.inner.updates.lock().unwrap_or_else(|e| e.into_inner()).clear();
        {
            let mut status = self.status();
            if !matches!(status.state, "failed" | "closed") {
                let started = self.inner.thread.lock().unwrap_or_else(|e| e.into_inner()).is_some();
                status.state = if started && !self.inner.finished.load(Ordering::SeqCst) { "stopping" } else { "closed" };
            }
        }
        self.close_ingress("stopped");
        self.inner.arrived.notify_all();
    }

    /// Stops and waits up to `timeout` for the thread; false when it still runs.
    pub fn close(&self, timeout: Duration) -> bool {
        self.request_stop();
        let deadline = Instant::now() + timeout;
        while !self.inner.finished.load(Ordering::SeqCst) {
            if self.inner.thread.lock().unwrap_or_else(|e| e.into_inner()).is_none() {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        true
    }

    /// The next update of the current connection, waiting up to `timeout`.
    pub fn pop_update(&self, timeout: Duration) -> Option<Update> {
        if self.inner.stop.load(Ordering::SeqCst) {
            return None;
        }
        let mut updates = self.inner.updates.lock().unwrap_or_else(|e| e.into_inner());
        if updates.is_empty() {
            updates = self.inner.arrived.wait_timeout(updates, timeout).unwrap_or_else(|e| e.into_inner()).0;
        }
        let update = updates.pop_front()?;
        drop(updates);
        self.is_current(&update.namespace).then_some(update)
    }

    fn fail(&self, code: &str) {
        {
            let mut status = self.status();
            status.error = Some(code.to_string());
            status.state = "failed";
        }
        self.request_stop();
    }

    fn close_ingress(&self, reason: &'static str) {
        let mut ingress = self.inner.ingress.lock().unwrap_or_else(|e| e.into_inner());
        if ingress.reason.is_none() {
            ingress.reason = Some(reason);
        }
        ingress.frames.clear();
        ingress.samples = 0;
    }

    /// A 48 kHz mono frame from the capture (`RealtimeIngress.push`).
    fn push(&self, frame: Vec<i16>, heard: Instant) -> bool {
        let mut ingress = self.inner.ingress.lock().unwrap_or_else(|e| e.into_inner());
        if ingress.reason.is_some() {
            return false;
        }
        if heard.elapsed() > MAX_AGE {
            ingress.reason = Some("invalid_capture");
            return false;
        }
        if ingress.frames.len() >= 20 || ingress.samples + frame.len() > 48000 / 5 {
            ingress.reason = Some("input_overflow");
            ingress.frames.clear();
            return false;
        }
        ingress.samples += frame.len();
        ingress.frames.push_back((frame, heard));
        true
    }

    fn main(&self) {
        let result = self.serve();
        if let Err(failure) = &result
            && !matches!(failure, Failure::Stopped)
            && !self.inner.stop.load(Ordering::SeqCst)
        {
            self.fail(failure.code());
            crate::report_failure("realtime", failure.code());
        }
        self.inner.stop.store(true, Ordering::SeqCst);
        self.inner.updates.lock().unwrap_or_else(|e| e.into_inner()).clear();
        {
            let mut status = self.status();
            if status.state != "failed" {
                status.state = "closed";
            }
        }
        self.inner.finished.store(true, Ordering::SeqCst);
        self.inner.arrived.notify_all();
    }

    fn stopped(&self) -> bool {
        self.inner.stop.load(Ordering::SeqCst)
    }

    /// `_preflight`: the request options and whether to ask who speaks.
    fn preflight(&self) -> Result<(serde_json::Map<String, Value>, bool), Failure> {
        let (models, diarizes) = speechcpp::survey(&self.inner.transport, &self.inner.options.base_url, Duration::from_secs(5))
            .map_err(|_| Failure::Realtime("preflight_failed"))?;
        let Some(model) = models.iter().find(|m| m.id == self.inner.options.model) else {
            return Err(Failure::Session("realtime_model_unavailable"));
        };
        if !speechcpp::language_supported(model, &self.inner.options.language) {
            return Err(Failure::Session(if self.inner.options.language == "auto" {
                "realtime_language_auto_unsupported"
            } else {
                "realtime_language_unsupported"
            }));
        }
        let options = speechcpp::request_options(&model.options, &self.inner.options.vocabulary);
        Ok((options, diarizes && self.inner.source == Source::Speaker))
    }

    fn settings(&self, options: &serde_json::Map<String, Value>, diarization: bool) -> Value {
        let mut transcription = json!({ "model": self.inner.options.model, "language": self.inner.options.language });
        for (key, value) in options {
            transcription[key] = value.clone();
        }
        let mut audio = json!({
            "format": { "type": "audio/pcm", "rate": RATE },
            "transcription": transcription,
            "turn_detection": turn_detection(self.inner.options.silence_duration_ms),
            "noise_reduction": null,
        });
        if diarization {
            audio["diarization"] = json!({});
        }
        json!({ "type": "transcription", "audio": { "input": audio } })
    }

    /// `_check_config`: the server took the session as it was asked for.
    fn check_config(&self, event: &Value, options: &serde_json::Map<String, Value>, diarization: bool) -> Result<(), Failure> {
        let audio = &event["session"]["audio"]["input"];
        let diarization_ok = if diarization {
            audio.get("diarization") == Some(&json!({}))
        } else {
            audio.get("diarization").is_none_or(Value::is_null)
        };
        if !(self.base_matches(event, options) && diarization_ok && audio["turn_detection"]["type"] == "server_vad") {
            return Err(Failure::Realtime("configuration_rejected"));
        }
        Ok(())
    }

    fn base_matches(&self, event: &Value, options: &serde_json::Map<String, Value>) -> bool {
        let audio = &event["session"]["audio"]["input"];
        let transcription = &audio["transcription"];
        event["type"] == "session.updated"
            && event["session"]["type"] == "transcription"
            && audio["format"] == json!({ "type": "audio/pcm", "rate": RATE })
            && transcription["model"] == self.inner.options.model.as_str()
            && transcription["language"] == self.inner.options.language.as_str()
            && options.iter().all(|(key, value)| transcription.get(key) == Some(value))
            && audio.get("noise_reduction").is_none_or(Value::is_null)
    }

    fn decode(message: Message) -> Result<Option<Value>, Failure> {
        let text = match message {
            Message::Text(text) => text,
            Message::Close(_) => return Err(Failure::Realtime("stream_failed")),
            _ => return Ok(None),
        };
        if text.len() > MAX_EVENT {
            return Err(Failure::Realtime("invalid_event"));
        }
        let value: Value = serde_json::from_str(text.as_str()).map_err(|_| Failure::Realtime("invalid_event"))?;
        if !value.is_object() || !value["type"].is_string() {
            return Err(Failure::Realtime("invalid_event"));
        }
        if value["type"] == "error" {
            return Err(Failure::Realtime("server_error"));
        }
        Ok(Some(value))
    }

    fn receive(socket: &mut Socket) -> Result<Option<Value>, Failure> {
        match socket.read() {
            Ok(message) => Self::decode(message),
            Err(tungstenite::Error::Io(error))
                if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) =>
            {
                Ok(None)
            }
            Err(_) => Err(Failure::Realtime("stream_failed")),
        }
    }

    fn connect(&self) -> Result<Socket, Failure> {
        open_socket(&self.inner.options.base_url, Some(&self.inner.options.model)).ok_or(Failure::Realtime("connection_failed"))
    }

    fn recv_setup(socket: &mut Socket, deadline: Instant) -> Result<Value, Failure> {
        loop {
            if Instant::now() >= deadline {
                return Err(Failure::Realtime("connection_failed"));
            }
            if let Some(event) = Self::receive(socket)? {
                return Ok(event);
            }
        }
    }

    fn serve(&self) -> Result<(), Failure> {
        let (options, diarization) = self.preflight()?;
        if self.stopped() {
            return Err(Failure::Stopped);
        }
        let namespace = namespace();
        let mut events = Events::new(self.inner.source.as_str(), namespace.clone());
        self.status().namespace = Some(namespace);
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut socket = self.connect()?;
        let created = Self::recv_setup(&mut socket, deadline)?;
        if created["type"] != "session.created" {
            return Err(Failure::Realtime("session_not_created"));
        }
        let update = json!({ "type": "session.update", "session": self.settings(&options, diarization) });
        socket.send(Message::text(update.to_string())).map_err(|_| Failure::Realtime("send_failed"))?;
        let answer = Self::recv_setup(&mut socket, deadline)?;
        self.check_config(&answer, &options, diarization)?;
        if self.stopped() {
            let _ = socket.close(None);
            return Err(Failure::Stopped);
        }
        let result = self.stream(&mut socket, &mut events, &options, diarization);
        events.close();
        let _ = socket.close(None);
        let _ = socket.flush();
        result
    }

    fn open_capture(&self) -> Result<Box<dyn Capture>, Failure> {
        let builder = Arc::new(Mutex::new(None::<FrameBuilder>));
        let feeding = self.clone();
        let on_audio = Box::new(move |samples: &[i16], rate: u32, channels: u16| {
            let received = Instant::now();
            let mut builder = builder.lock().unwrap_or_else(|e| e.into_inner());
            let frames = builder.get_or_insert_with(|| FrameBuilder::new(rate, usize::from(channels))).feed(samples, received);
            for (frame, heard) in frames {
                if feeding.stopped() || !feeding.push(frame, heard) {
                    return false;
                }
            }
            true
        });
        let failing = self.clone();
        let on_error = Box::new(move |_code: &str| {
            if !failing.stopped() {
                failing.fail("realtime_capture_failed");
                crate::report_failure("realtime", "realtime_capture_failed");
            }
        });
        self.inner
            .platform
            .open(self.inner.source, &Target::Endpoint(self.inner.endpoint.clone()), CAPTURE_OPEN_TIMEOUT, on_audio, on_error)
            .map_err(|_| Failure::Session("realtime_capture_failed"))
    }

    fn stream(
        &self,
        socket: &mut Socket,
        events: &mut Events,
        options: &serde_json::Map<String, Value>,
        diarization: bool,
    ) -> Result<(), Failure> {
        socket.get_mut().set_read_timeout(Some(Duration::from_millis(10))).map_err(|_| Failure::Realtime("stream_failed"))?;
        // The vocabulary also puts right what the model wrote (#446): partials and finals alike.
        let terms = Dictionary::new(&self.inner.options.vocabulary);
        let mut capture = self.open_capture()?;
        let result = (|| {
            if self.stopped() {
                return Err(Failure::Stopped);
            }
            {
                let mut status = self.status();
                if status.state != "starting" {
                    return Err(Failure::Stopped);
                }
                status.state = "ready";
            }
            let mut resampler = Resampler::new(48000, RATE);
            let mut pending_since: HashMap<String, Instant> = HashMap::new();
            let mut first_result_seen = false;
            let opened = Instant::now();
            let mut last_audio: Option<Instant> = None;
            while !self.stopped() {
                // Audio first: it must not wait behind the server's events.
                let frames: Vec<(Vec<i16>, Instant)> = {
                    let mut ingress = self.inner.ingress.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(reason) = ingress.reason {
                        if reason == "stopped" {
                            return Err(Failure::Stopped);
                        }
                        return Err(Failure::Realtime("input_failed"));
                    }
                    ingress.samples = 0;
                    ingress.frames.drain(..).collect()
                };
                if let Some((_, heard)) = frames.last() {
                    last_audio = Some(*heard);
                } else if self.inner.source == Source::Mic {
                    let silent = match last_audio {
                        Some(heard) => heard.elapsed() >= STALL_TIMEOUT,
                        None => opened.elapsed() >= FIRST_AUDIO_TIMEOUT,
                    };
                    if silent {
                        return Err(Failure::Session("realtime_capture_failed"));
                    }
                }
                for (frame, heard) in frames {
                    if heard.elapsed() > MAX_AGE {
                        return Err(Failure::Realtime("stale_capture"));
                    }
                    let converted = pcm::to_i16(&resampler.process(&pcm::to_f32(&frame)));
                    for block in converted.chunks(480) {
                        let message = json!({ "type": "input_audio_buffer.append", "audio": base64(&pcm::bytes(block)) });
                        socket.send(Message::text(message.to_string())).map_err(|_| Failure::Realtime("send_failed"))?;
                    }
                }
                let limit = if first_result_seen { PENDING_TIMEOUT } else { FIRST_RESULT_TIMEOUT };
                if pending_since.values().any(|since| since.elapsed() > limit) {
                    return Err(Failure::Realtime("utterance_timeout"));
                }
                let Some(event) = Self::receive(socket)? else { continue };
                if event["type"] == "session.updated" {
                    self.check_config(&event, options, diarization)?;
                }
                let updates = events.accept(&event).map_err(|_| Failure::Realtime("invalid_event"))?;
                let mut first_result = false;
                for mut update in updates {
                    if update.is_final {
                        first_result |= !first_result_seen;
                    }
                    update.text = terms.corrected(&update.text);
                    update.received = Some(Instant::now());
                    let mut mailbox = self.inner.updates.lock().unwrap_or_else(|e| e.into_inner());
                    if self.stopped() {
                        return Err(Failure::Stopped);
                    }
                    if mailbox.len() >= MAILBOX {
                        return Err(Failure::Session("realtime_updates_overflow"));
                    }
                    mailbox.push_back(update);
                    drop(mailbox);
                    self.inner.arrived.notify_all();
                }
                let now = Instant::now();
                // Items queued behind the first result waited for the same kernels.
                pending_since = events
                    .pending_ids()
                    .into_iter()
                    .map(|item| {
                        let since = if first_result { now } else { *pending_since.get(&item).unwrap_or(&now) };
                        (item, since)
                    })
                    .collect();
                first_result_seen |= first_result;
            }
            Err(Failure::Stopped)
        })();
        self.close_ingress("stopped");
        if !capture.stop() && !self.stopped() {
            self.fail("realtime_capture_stop_failed");
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    // The ingress between the capture and the connection, after
    // `src-python/test/test_realtime_ingress_wait.py`.

    struct NoDevice;

    impl CapturePlatform for NoDevice {
        fn open(&self, _: Source, _: &Target, _: Duration, _: crate::capture::OnAudio, _: crate::capture::OnError) -> Result<Box<dyn Capture>, String> {
            Err("asr_capture_endpoint_missing".into())
        }
        fn endpoints(&self, _: Source) -> Result<Vec<(Endpoint, String)>, String> {
            Ok(Vec::new())
        }
        fn default_endpoint(&self, _: Source) -> Result<Endpoint, String> {
            Err("realtime_default_endpoint_missing".into())
        }
    }

    fn session() -> Session {
        let options = Options {
            base_url: "http://127.0.0.1:9".into(),
            model: "m".into(),
            language: "ja".into(),
            vocabulary: Vec::new(),
            silence_duration_ms: None,
        };
        let endpoint = Endpoint { cookie: 1, serial: 1, name: "mic".into(), media_class: "Audio/Source".into() };
        Session::new(Source::Mic, options, endpoint, Arc::new(NoDevice), vrct_translation::http::direct())
    }

    fn refused_for(session: &Session) -> Option<&'static str> {
        session.inner.ingress.lock().unwrap().reason
    }

    #[test]
    fn the_ingress_holds_at_most_200_ms_or_20_frames() {
        let ten_ms_frames = session();
        for _ in 0..10 {
            assert!(ten_ms_frames.push(vec![0; 960], Instant::now()));
        }
        assert!(!ten_ms_frames.push(vec![0; 960], Instant::now()), "an 11th frame of 20 ms is past 200 ms");
        assert_eq!(refused_for(&ten_ms_frames), Some("input_overflow"));
        assert!(ten_ms_frames.inner.ingress.lock().unwrap().frames.is_empty(), "an overflow drops what waited");
        assert!(!ten_ms_frames.push(vec![0; 10], Instant::now()), "and refuses everything after");

        let small = session();
        for _ in 0..20 {
            assert!(small.push(vec![0; 10], Instant::now()));
        }
        assert!(!small.push(vec![0; 10], Instant::now()));
        assert_eq!(refused_for(&small), Some("input_overflow"));
    }

    #[test]
    fn the_ingress_refuses_audio_heard_more_than_250_ms_ago() {
        let stale = session();
        let heard = Instant::now().checked_sub(Duration::from_millis(300)).expect("the clock runs");
        assert!(!stale.push(vec![0; 960], heard));
        assert_eq!(refused_for(&stale), Some("invalid_capture"));
    }

    #[test]
    fn a_stopped_session_takes_no_audio_and_cannot_start_again() {
        let stopped = session();
        assert!(stopped.push(vec![0; 960], Instant::now()));
        stopped.request_stop();
        assert!(!stopped.push(vec![0; 960], Instant::now()));
        assert_eq!(refused_for(&stopped), Some("stopped"));
        assert!(stopped.inner.ingress.lock().unwrap().frames.is_empty(), "the stop dropped what waited");
        assert_eq!(stopped.start(), Err("realtime_session_single_use"));
        assert_eq!(stopped.state(), "closed");
    }

    #[test]
    fn the_padding_is_at_most_half_the_silence_so_the_utterance_comes_when_it_has_lasted() {
        let sent = |silence| {
            let value = turn_detection(silence);
            (value["silence_duration_ms"].as_u64().unwrap(), value["prefix_padding_ms"].as_u64().unwrap())
        };
        assert_eq!(turn_detection(None)["type"], "server_vad");
        assert_eq!(sent(None), (500, 250));
        assert_eq!(sent(Some(300)), (300, 150));
        assert_eq!(sent(Some(100)), (100, 50));
        // Never more than speech.cpp's own 300 ms.
        assert_eq!(sent(Some(1000)), (1000, 300));
    }
}
