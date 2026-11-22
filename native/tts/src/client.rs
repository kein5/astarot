//! speech.cpp's documented PCM API; no SDK defaults or model downloads.
//!
//! `POST /v1/audio/speech` with `response_format: "pcm"` streams signed 16-bit
//! little-endian mono PCM, its rate in `X-Sample-Rate`. Frames are handed on as
//! soon as whole samples arrive, before the response completes.

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::cancel::CancelToken;
use crate::error::SpeechError;
use crate::events::{valid_rate, AudioFrame};
use crate::http::{self, Connection, HttpError, Response};
use crate::listener::{listener_missing, listener_monitors, Address, ListenerMonitors, ListenerWatch, Probe};
use crate::model_options::{parse_options, ModelOptions, SynthesisOptions, SAFE_SEED_MAX};
use crate::settings::{has_unsafe_control, is_blank, local_url, SettingsError};
use crate::sync::Event;

/// What [`SpeechCppTts::warm_up`] asks to speak, cut to six frames of Qwen3-TTS (80 ms each).
/// One frame was too little to raise the GPU's clocks: with the GPU at a middle power state
/// between utterances, the next speech's first sound came 137 ms after its request with it and
/// 138 ms without it, and 79 ms after six frames (#556, RTX 4080 SUPER).
const WARM_UP_TEXT: &str = "The speech server gets ready.";
const WARM_UP_SECONDS: f64 = 0.48;

#[derive(Clone)]
pub struct SpeechCppTts {
    base_url: String,
    host: String,
    port: u16,
    timeout: Duration,
    first_audio_timeout: Duration,
    monitors: ListenerMonitors,
    probe: Probe,
}

impl std::fmt::Debug for SpeechCppTts {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SpeechCppTts").field("base_url", &self.base_url).finish_non_exhaustive()
    }
}

impl SpeechCppTts {
    /// A client for a local server, with a 2 s connect and chunk timeout and a
    /// 10 s budget for the first audio (cold GPU kernels can take that long).
    pub fn new(base_url: &str) -> Result<Self, SettingsError> {
        Self::with_timeouts(base_url, Duration::from_secs(2), Duration::from_secs(10))
    }

    pub fn with_timeouts(base_url: &str, timeout: Duration, first_audio_timeout: Duration) -> Result<Self, SettingsError> {
        let base_url = local_url(base_url)?;
        let authority = base_url.trim_start_matches("http://");
        let (host, port) = authority.rsplit_once(':').expect("local_url always has a port");
        Ok(Self {
            host: host.trim_start_matches('[').trim_end_matches(']').to_owned(),
            port: port.parse().expect("local_url ports are valid"),
            base_url,
            timeout,
            first_audio_timeout,
            monitors: listener_monitors().clone(),
            probe: std::sync::Arc::new(listener_missing),
        })
    }

    /// Use another listener registry and probe (tests, or a second runtime).
    pub fn with_listener(mut self, monitors: ListenerMonitors, probe: Probe) -> Self {
        self.monitors = monitors;
        self.probe = probe;
        self
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn address(&self) -> Address {
        (self.host.clone(), self.port)
    }

    /// Asks for half a second of speech and drops it (#556). Between utterances the GPU falls to
    /// a power state with lower clocks, and the next speech's first frames are made about twice
    /// as slowly; a short synthesis made just before it raises the clocks. Nothing is played, and
    /// the text and voice go only into the request body.
    /// `token` stops it, as speech that starts meanwhile does: the server then ends it once the
    /// connection closes, so that the speech does not wait behind it.
    pub fn warm_up(&self, voice: &str, language: &str, token: &CancelToken) -> Result<(), SpeechError> {
        let failed = |_| SpeechError::new("transport_error");
        token.check()?;
        let mut connection = http::connect(&self.host, self.port, self.timeout).map_err(failed)?;
        let interrupter = connection.interrupter();
        token.register(move || interrupter.interrupt());
        token.check()?;
        connection.set_deadline(Some(Instant::now() + self.first_audio_timeout));
        let body = serde_json::json!({ "input": WARM_UP_TEXT, "voice": voice, "language": language, "response_format": "pcm", "max_seconds": WARM_UP_SECONDS });
        connection.send("POST", "/v1/audio/speech", Some(("application/json", body.to_string().as_bytes()))).map_err(failed)?;
        let mut response = connection.response().map_err(failed)?;
        if response.status != 200 {
            return Err(SpeechError::http_status(response.status));
        }
        while !response.read_some(4096).map_err(failed)?.is_empty() {}
        Ok(())
    }

    /// Bounded, local-only readiness probe; never loads or synthesizes a model.
    pub fn check_health(&self) -> Result<(), SpeechError> {
        let document = self.get_json("/health", 4096, &CancelToken::new(), "speech_server_not_ready")?;
        if document != serde_json::json!({"status": "ok"}) {
            return Err(SpeechError::new("speech_server_not_ready"));
        }
        Ok(())
    }

    /// The one synthesis model's options, from `/v1/models` (at most 64 KiB).
    pub fn get_model_options(&self, token: Option<&CancelToken>) -> Result<ModelOptions, SpeechError> {
        let fallback = CancelToken::new();
        let document = self.get_json("/v1/models", 65536, token.unwrap_or(&fallback), "tts_model_options_unavailable")?;
        parse_options(&document).map_err(|_| SpeechError::new("tts_model_options_unavailable"))
    }

    /// A GET whose whole exchange ends within the timeout. Any failure is
    /// `error_code`, unless the token was cancelled first.
    fn get_json(&self, path: &str, limit: usize, token: &CancelToken, error_code: &'static str) -> Result<Value, SpeechError> {
        let deadline = Instant::now() + self.timeout;
        let fail = |token: &CancelToken| -> SpeechError {
            match token.check() {
                Err(cancelled) => cancelled,
                Ok(()) => SpeechError::new(error_code),
            }
        };
        token.check()?;
        let mut connection = http::connect(&self.host, self.port, self.timeout).map_err(|_| fail(token))?;
        connection.set_deadline(Some(deadline));
        let interrupter = connection.interrupter();
        token.register(move || interrupter.interrupt());
        token.check()?;
        if Instant::now() >= deadline {
            return Err(SpeechError::new(error_code));
        }
        connection.send("GET", path, None).map_err(|_| fail(token))?;
        let mut response = connection.response().map_err(|_| fail(token))?;
        let body = response.read_body(limit).map_err(|_| fail(token))?;
        token.check()?;
        let body = match body {
            Some(body) if response.status == 200 => body,
            _ => return Err(SpeechError::new(error_code)),
        };
        serde_json::from_slice(&body).map_err(|_| SpeechError::new(error_code))
    }

    /// Start a speech request. Nothing is sent until the first frame is read,
    /// so the stream can be handed to an output that opens first.
    ///
    /// The text, voice and instructions go only into the request body.
    pub fn synthesize_stream(&self, text: &str, voice: &str, language: &str, token: &CancelToken, options: &SynthesisOptions) -> PcmStream {
        PcmStream {
            client: self.clone(),
            token: token.clone(),
            state: State::Pending(Box::new(Pending { text: text.to_owned(), voice: voice.to_owned(), language: language.to_owned(), options: options.clone() })),
        }
    }
}

struct Pending {
    text: String,
    voice: String,
    language: String,
    options: SynthesisOptions,
}

#[derive(Serialize)]
struct SpeechBody<'a> {
    input: &'a str,
    voice: &'a str,
    language: &'a str,
    response_format: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    seed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    instructions: Option<&'a str>,
}

struct Streaming {
    response: Response,
    rate: u32,
    pending: Vec<u8>,
    samples: u64,
    waiting_for_audio: bool,
    first_audio_deadline: Instant,
    owner: Option<crate::listener::ListenerMonitor>,
    watch_stopped: Event,
    watch: Option<ListenerWatch>,
}

enum State {
    Pending(Box<Pending>),
    Streaming(Box<Streaming>),
    Done,
}

/// Streamed speech: `AudioFrame`s of whole samples, then `None`.
///
/// Errors are safe codes: `invalid_text`, `http_<status>`, `expected_pcm`,
/// `invalid_sample_rate`, `first_audio_timeout`, `transport_error`,
/// `truncated_pcm`, `empty_pcm`, `truncated_http`, `audio_duration_limit`,
/// the option codes, or the token's reason once it is cancelled.
/// After an error or the end, the stream yields nothing more. Dropping it
/// closes the connection and ends the server watch.
pub struct PcmStream {
    client: SpeechCppTts,
    token: CancelToken,
    state: State,
}

impl PcmStream {
    /// Close the connection and stop watching the server. Idempotent.
    pub fn close(&mut self) {
        if let State::Streaming(streaming) = std::mem::replace(&mut self.state, State::Done) {
            finish(*streaming);
        }
        self.state = State::Done;
    }

    fn start(&mut self, pending: Pending) -> Result<Streaming, SpeechError> {
        let Pending { text, voice, language, options } = pending;
        let token = &self.token;
        let client = &self.client;
        if is_blank(&text) || text.chars().count() > 4000 {
            return Err(SpeechError::new("invalid_text"));
        }
        if options.seed.is_some_and(|seed| seed > SAFE_SEED_MAX) {
            return Err(SpeechError::new("invalid_seed"));
        }
        if options.instructions.chars().count() > 4000 || has_unsafe_control(&options.instructions) {
            return Err(SpeechError::new("invalid_instructions"));
        }
        let instructions = (!is_blank(&options.instructions)).then_some(options.instructions.as_str());
        if options.seed.is_some() || instructions.is_some() {
            let capability = client.get_model_options(Some(token))?;
            if let Some(seed) = options.seed {
                let limits = capability.seed.ok_or(SpeechError::new("tts_seed_unsupported"))?;
                if !(limits.minimum..=limits.maximum).contains(&seed) {
                    return Err(SpeechError::new("tts_seed_out_of_range"));
                }
            }
            if instructions.is_some() && !capability.instructions {
                return Err(SpeechError::new("tts_instructions_unsupported"));
            }
        }
        let transport = |error: HttpError, waiting: bool| -> SpeechError {
            if let Err(cancelled) = token.check() {
                return cancelled;
            }
            match error {
                HttpError::Timeout if waiting => SpeechError::new("first_audio_timeout"),
                _ => SpeechError::new("transport_error"),
            }
        };
        token.check()?;
        let address = client.address();
        // Capture the process generation before connecting, not after the first
        // PCM: a restarted server may already be using the same port.
        let owner = client.monitors.owned(&address);
        let mut connection: Connection = http::connect(&client.host, client.port, client.timeout).map_err(|e| transport(e, false))?;
        let interrupter = connection.interrupter();
        // Shutting down wakes the reader; the stream owns the final close.
        token.register(move || interrupter.interrupt());
        token.check()?;
        let body = serde_json::to_vec(&SpeechBody { input: &text, voice: &voice, language: &language, response_format: "pcm", seed: options.seed, instructions })
            .expect("strings and integers always serialize");
        connection.send("POST", "/v1/audio/speech", Some(("application/json", &body))).map_err(|e| transport(e, false))?;
        // Initial model work can include cold GPU kernels. Keep the connection
        // and later chunk stalls short, but allow a bounded first audio.
        let first_audio_deadline = Instant::now() + client.first_audio_timeout;
        connection.set_timeout(Some(client.first_audio_timeout));
        connection.set_deadline(Some(first_audio_deadline));
        let response = connection.response().map_err(|e| transport(e, true))?;
        if response.status != 200 {
            return Err(SpeechError::http_status(response.status));
        }
        let content_type = response.header("Content-Type").unwrap_or("");
        if !content_type.split(';').next().unwrap_or("").trim().eq_ignore_ascii_case("audio/pcm") {
            return Err(SpeechError::new("expected_pcm"));
        }
        let rate = response
            .header("X-Sample-Rate")
            .and_then(|rate| rate.trim().strip_prefix('+').unwrap_or(rate.trim()).parse::<u32>().ok())
            .filter(|rate| valid_rate(*rate))
            .ok_or(SpeechError::new("invalid_sample_rate"))?;
        Ok(Streaming { response, rate, pending: Vec::new(), samples: 0, waiting_for_audio: true, first_audio_deadline, owner, watch_stopped: Event::new(), watch: None })
    }

    fn next_frame(&mut self, streaming: &mut Streaming) -> Result<Option<AudioFrame>, SpeechError> {
        let token = &self.token;
        let transport = |error: HttpError, waiting: bool| -> SpeechError {
            if let Err(cancelled) = token.check() {
                return cancelled;
            }
            match error {
                HttpError::Timeout if waiting => SpeechError::new("first_audio_timeout"),
                _ => SpeechError::new("transport_error"),
            }
        };
        loop {
            token.check()?;
            if streaming.waiting_for_audio && Instant::now() >= streaming.first_audio_deadline {
                return Err(SpeechError::new("first_audio_timeout"));
            }
            let chunk = streaming.response.read_some(4096).map_err(|e| transport(e, streaming.waiting_for_audio))?;
            token.check()?;
            if chunk.is_empty() {
                if !streaming.pending.is_empty() {
                    return Err(SpeechError::new("truncated_pcm"));
                }
                if streaming.samples == 0 {
                    return Err(SpeechError::new("empty_pcm"));
                }
                if streaming.response.length_remaining().is_some_and(|remaining| remaining != 0) {
                    return Err(SpeechError::new("truncated_http"));
                }
                return Ok(None);
            }
            streaming.pending.extend_from_slice(&chunk);
            let complete = streaming.pending.len() / 2 * 2;
            if complete == 0 {
                continue;
            }
            if streaming.waiting_for_audio {
                streaming.waiting_for_audio = false;
                streaming.response.set_deadline(None);
                streaming.response.set_timeout(Some(self.client.timeout));
                // The consumer may next be suspended inside a slow output
                // write; do not wait for its next HTTP read to notice that the
                // server is no longer there.
                streaming.watch = Some(self.client.monitors.watch(&self.client.address(), token, streaming.watch_stopped.clone(), self.client.probe.clone(), streaming.owner.clone()));
                token.check()?;
            }
            streaming.samples += complete as u64 / 2;
            if streaming.samples > streaming.rate as u64 * 60 {
                return Err(SpeechError::new("audio_duration_limit"));
            }
            let rest = streaming.pending.split_off(complete);
            let pcm = std::mem::replace(&mut streaming.pending, rest);
            return Ok(Some(AudioFrame::mono(pcm, streaming.rate).expect("whole samples at a validated rate")));
        }
    }
}

fn finish(streaming: Streaming) {
    streaming.watch_stopped.set();
    if let Some(watch) = &streaming.watch {
        watch.close();
        watch.join();
    }
    // Dropping the response closes the connection.
}

impl Iterator for PcmStream {
    type Item = Result<AudioFrame, SpeechError>;

    fn next(&mut self) -> Option<Self::Item> {
        let mut streaming = match std::mem::replace(&mut self.state, State::Done) {
            State::Done => return None,
            State::Pending(pending) => match self.start(*pending) {
                Ok(streaming) => Box::new(streaming),
                Err(error) => return Some(Err(error)),
            },
            State::Streaming(streaming) => streaming,
        };
        match self.next_frame(&mut streaming) {
            Ok(Some(frame)) => {
                self.state = State::Streaming(streaming);
                Some(Ok(frame))
            }
            Ok(None) => {
                finish(*streaming);
                None
            }
            Err(error) => {
                finish(*streaming);
                Some(Err(error))
            }
        }
    }
}

impl Drop for PcmStream {
    fn drop(&mut self) {
        self.close();
    }
}
