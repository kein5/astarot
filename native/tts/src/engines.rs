//! Clients for the speech engines a user installs and runs (ADR-008): VOICEVOX and the
//! engines that keep its API (SHAREVOX, AivisSpeech), and COEIROINK v2.
//!
//! The Rust counterpart of [`external_engine.py`], [`voicevox_tts.py`], [`coeiroink_tts.py`] and
//! [`engines.py`]. An engine answers a whole WAV per request, so the text is split into
//! sentences and each sentence is synthesized and played in turn, the next one while the
//! current one plays. Only loopback URLs are used, an engine is never started or installed
//! by the app, and errors carry safe codes only: no text, audio or response body.
//!
//! [`external_engine.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/tts/external_engine.py
//! [`voicevox_tts.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/tts/voicevox_tts.py
//! [`coeiroink_tts.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/tts/coeiroink_tts.py
//! [`engines.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/tts/engines.py

use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use crate::cancel::CancelToken;
use crate::error::{SpeechError, TtsError};
use crate::events::{valid_rate, AudioFrame};
use crate::http::{self, HttpError};
use crate::model_options::SynthesisOptions;
use crate::playback::Frames;
use crate::scheduler::{EngineFactory, Synthesizer};
use crate::settings::{local_url, AudioQueryScales, CoeiroinkParams, EngineVoice, SettingsError, SpeechRequest};

/// On the project's test PC a 32-character sentence took about 4 s in VOICEVOX 0.26.1 and
/// 2.4 s in COEIROINK 2.13.0. Microphone speech must start within 5 s, so long sentences
/// are also split at commas.
pub const MAX_PIECE: usize = 40;
pub const MAX_TEXT: usize = 4000;
const FRAME_SECONDS: f64 = 0.2;
const MAX_AUDIO_SECONDS: u64 = 60;
/// Sentences synthesized ahead of the one playing.
const PREFETCH: usize = 1;
const VERSION_LIMIT: usize = 4096;
const QUERY_LIMIT: usize = 4 * 1024 * 1024;
const WAV_LIMIT: usize = 64 * 1024 * 1024;
const NOT_READY: &str = "tts_engine_not_ready";
/// VOICEVOX styles that read text; singing styles need other APIs.
const TALK_STYLES: [&str; 2] = ["talk", "streaming_talk"];

/// Which API an engine speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineApi {
    /// VOICEVOX ENGINE: `voicevox`, `sharevox`, `aivis`.
    Voicevox,
    /// COEIROINK v2: `coeiroink`.
    Coeiroink,
}

impl EngineApi {
    /// The API of a saved engine name; `None` for speech.cpp or an unknown name.
    pub fn of(engine: &str) -> Option<Self> {
        match engine {
            "voicevox" | "sharevox" | "aivis" => Some(EngineApi::Voicevox),
            "coeiroink" => Some(EngineApi::Coeiroink),
            _ => None,
        }
    }
}

/// One voice an engine offers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceRow {
    pub id: String,
    pub speaker: String,
    pub style: String,
}

/// Sentences, and sentences longer than [`MAX_PIECE`] characters cut at commas where possible.
pub fn split_text(text: &str) -> Vec<String> {
    let mut pieces = Vec::new();
    for sentence in sentences(text) {
        let sentence = sentence.trim();
        if sentence.is_empty() {
            continue;
        }
        if sentence.chars().count() <= MAX_PIECE {
            pieces.push(sentence.to_owned());
            continue;
        }
        let mut current = String::new();
        for part in split_after(sentence, &['、', '，', ',']) {
            if !current.is_empty() && current.chars().count() + part.chars().count() > MAX_PIECE {
                pieces.push(current.trim().to_owned());
                current.clear();
            }
            current.push_str(part);
        }
        if !current.trim().is_empty() {
            pieces.push(current.trim().to_owned());
        }
    }
    pieces.into_iter().filter(|piece| !piece.is_empty()).collect()
}

/// `re.split(r'(?<=[。！？!?．])|\n+', text)`: after each sentence end, and at runs of newlines.
fn sentences(text: &str) -> Vec<&str> {
    let mut result = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((index, c)) = chars.next() {
        if c == '\n' {
            result.push(&text[start..index]);
            let mut end = index + 1;
            while let Some(&(next, '\n')) = chars.peek() {
                end = next + 1;
                chars.next();
            }
            start = end;
        } else if matches!(c, '。' | '！' | '？' | '!' | '?' | '．') {
            let end = index + c.len_utf8();
            result.push(&text[start..end]);
            start = end;
        }
    }
    result.push(&text[start..]);
    result
}

/// Split after each of `marks`, keeping them (`re.split(r'(?<=[、，,])', ...)`).
fn split_after<'a>(text: &'a str, marks: &[char]) -> Vec<&'a str> {
    let mut result = Vec::new();
    let mut start = 0;
    for (index, c) in text.char_indices() {
        if marks.contains(&c) {
            let end = index + c.len_utf8();
            result.push(&text[start..end]);
            start = end;
        }
    }
    result.push(&text[start..]);
    result
}

/// 16-bit PCM from a WAV in memory: `(pcm, rate, channels)`.
pub fn read_wav(data: &[u8]) -> Result<(Vec<u8>, u32, u16), SpeechError> {
    let invalid = || SpeechError::new("invalid_wav");
    if data.len() < 12 || &data[..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return Err(invalid());
    }
    let mut position = 12;
    let mut format: Option<(u16, u16, u32, u16)> = None;
    while position + 8 <= data.len() {
        let id = &data[position..position + 4];
        let size = u32::from_le_bytes(data[position + 4..position + 8].try_into().expect("four bytes")) as usize;
        let body = position + 8;
        match id {
            b"fmt " => {
                let chunk = data.get(body..body + size).ok_or_else(invalid)?;
                if chunk.len() < 16 {
                    return Err(invalid());
                }
                let word = |at: usize| u16::from_le_bytes([chunk[at], chunk[at + 1]]);
                let mut tag = word(0);
                if tag == 0xFFFE && chunk.len() >= 26 {
                    // WAVE_FORMAT_EXTENSIBLE: the sub-format's first two bytes are its tag.
                    tag = word(24);
                }
                if tag != 1 {
                    return Err(SpeechError::new("unsupported_wav"));
                }
                let rate = u32::from_le_bytes(chunk[4..8].try_into().expect("four bytes"));
                format = Some((tag, word(2), rate, word(14)));
            }
            b"data" => {
                let (_, channels, rate, bits) = format.ok_or_else(invalid)?;
                if bits != 16 || !matches!(channels, 1 | 2) {
                    return Err(SpeechError::new("unsupported_wav"));
                }
                if !valid_rate(rate) {
                    return Err(SpeechError::new("invalid_sample_rate"));
                }
                // A data chunk longer than the file is read to the end, as `wave` does.
                let end = body.saturating_add(size).min(data.len());
                let frame = 2 * channels as usize;
                let pcm = &data[body..end];
                let whole = pcm.len() / frame * frame;
                return Ok((pcm[..whole].to_vec(), rate, channels));
            }
            _ => {}
        }
        // Chunks are padded to an even size.
        position = body.saturating_add(size).saturating_add(size % 2);
    }
    Err(invalid())
}

/// The frames of about 0.2 s of a WAV. `budget` is the samples still allowed for the
/// message (`None` until the first WAV gives its rate); it shrinks.
fn wav_frames(data: &[u8], budget: &mut Option<u64>) -> Result<Vec<AudioFrame>, SpeechError> {
    let (pcm, rate, channels) = read_wav(data)?;
    let frame_bytes = 2 * channels as usize;
    let samples = (pcm.len() / frame_bytes) as u64;
    if samples == 0 {
        return Err(SpeechError::new("empty_pcm"));
    }
    let allowed = budget.get_or_insert(u64::from(rate) * MAX_AUDIO_SECONDS);
    if samples > *allowed {
        return Err(SpeechError::new("audio_duration_limit"));
    }
    *allowed -= samples;
    let step = ((f64::from(rate) * FRAME_SECONDS) as usize).max(1) * frame_bytes;
    pcm.chunks(step).map(|chunk| AudioFrame::new(chunk.to_vec(), rate, channels).map_err(|_| SpeechError::new("invalid_wav"))).collect()
}

/// The engine's id for `voice`: by id when the names still match, otherwise by names.
pub fn find_voice(voices: &[VoiceRow], voice: &EngineVoice) -> Result<String, SpeechError> {
    if voice.id.is_empty() {
        return Err(SpeechError::new("tts_engine_voice_unset"));
    }
    let by_id = voices.iter().find(|row| row.id == voice.id);
    if let Some(row) = by_id.filter(|row| voice.speaker.is_empty() || (row.speaker == voice.speaker && row.style == voice.style)) {
        return Ok(row.id.clone());
    }
    match voices.iter().find(|row| row.speaker == voice.speaker && row.style == voice.style) {
        Some(row) if !voice.speaker.is_empty() => Ok(row.id.clone()),
        _ => Err(SpeechError::new("tts_engine_voice_missing")),
    }
}

/// `urllib.parse.quote_plus`.
fn quote_plus(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'-' | b'~' => out.push(byte as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// `[0-9A-Fa-f-]{1,64}:[0-9]{1,9}`, COEIROINK's speaker UUID and style id.
fn coeiroink_voice(id: &str) -> Option<(&str, u64)> {
    let (speaker, style) = id.split_once(':')?;
    let speaker_ok = (1..=64).contains(&speaker.len()) && speaker.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-');
    let style_ok = (1..=9).contains(&style.len()) && style.bytes().all(|b| b.is_ascii_digit());
    (speaker_ok && style_ok).then(|| (speaker, style.parse().expect("nine digits fit")))
}

/// HTTP to one engine. One request at a time; cancellation shuts the socket.
#[derive(Debug, Clone)]
pub struct EngineClient {
    api: EngineApi,
    host: String,
    port: u16,
    timeout: Duration,
    synthesis_timeout: Duration,
}

impl EngineClient {
    /// A client for `engine` (`voicevox`, `sharevox`, `aivis`, `coeiroink`) at a local URL.
    pub fn new(engine: &str, base_url: &str) -> Result<Self, SettingsError> {
        Self::with_timeouts(engine, base_url, Duration::from_secs(2), Duration::from_secs(30))
    }

    pub fn with_timeouts(engine: &str, base_url: &str, timeout: Duration, synthesis_timeout: Duration) -> Result<Self, SettingsError> {
        let api = EngineApi::of(engine).ok_or(SettingsError("Unknown speech engine"))?;
        let base_url = local_url(base_url)?;
        let authority = base_url.trim_start_matches("http://");
        let (host, port) = authority.rsplit_once(':').expect("local_url always has a port");
        Ok(Self { api, host: host.trim_start_matches('[').trim_end_matches(']').to_owned(), port: port.parse().expect("local_url ports are valid"), timeout, synthesis_timeout })
    }

    pub fn api(&self) -> EngineApi {
        self.api
    }

    #[allow(clippy::too_many_arguments)]
    fn request(
        &self,
        method: &str,
        path: &str,
        token: &CancelToken,
        body: Option<&[u8]>,
        limit: usize,
        error_code: &'static str,
        timeout: Option<Duration>,
        expect: Option<&str>,
    ) -> Result<Vec<u8>, SpeechError> {
        // A timeout, a refused connection or a broken answer: the step's code, never the OS's.
        let fail = |token: &CancelToken, _: HttpError| -> SpeechError {
            match token.check() {
                Err(cancelled) => cancelled,
                Ok(()) => SpeechError::new(error_code),
            }
        };
        token.check()?;
        let mut connection = http::connect(&self.host, self.port, self.timeout).map_err(|e| fail(token, e))?;
        let interrupter = connection.interrupter();
        token.register(move || interrupter.interrupt());
        token.check()?;
        connection.send(method, path, body.map(|body| ("application/json", body))).map_err(|e| fail(token, e))?;
        connection.set_timeout(Some(timeout.unwrap_or(self.timeout)));
        let mut response = connection.response().map_err(|e| fail(token, e))?;
        let data = response.read_body(limit).map_err(|e| fail(token, e))?;
        token.check()?;
        if response.status != 200 {
            return Err(SpeechError::http_status(response.status));
        }
        let data = data.ok_or(SpeechError::new("response_too_large"))?;
        if let Some(expect) = expect {
            let kind = response.header("content-type").unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
            if kind != expect {
                return Err(SpeechError::new(error_code));
            }
        }
        Ok(data)
    }

    fn get_json(&self, path: &str, token: &CancelToken, limit: usize) -> Result<Value, SpeechError> {
        let data = self.request("GET", path, token, None, limit, NOT_READY, None, None)?;
        serde_json::from_slice(&data).map_err(|_| SpeechError::new(NOT_READY))
    }

    /// The engine's version: whether it runs. Never synthesizes anything.
    pub fn check_health(&self, token: Option<&CancelToken>) -> Result<String, SpeechError> {
        let fallback = CancelToken::new();
        let token = token.unwrap_or(&fallback);
        let version = match self.api {
            EngineApi::Voicevox => self.get_json("/version", token, VERSION_LIMIT)?,
            EngineApi::Coeiroink => self.get_json("/v1/engine_info", token, VERSION_LIMIT)?.get("version").cloned().unwrap_or(Value::Null),
        };
        match version {
            Value::String(version) => Ok(version),
            _ => Err(SpeechError::new(NOT_READY)),
        }
    }

    /// The voices that read text.
    pub fn list_voices(&self, token: Option<&CancelToken>) -> Result<Vec<VoiceRow>, SpeechError> {
        let fallback = CancelToken::new();
        let token = token.unwrap_or(&fallback);
        let mut voices = Vec::new();
        match self.api {
            EngineApi::Voicevox => {
                let speakers = self.get_json("/speakers", token, QUERY_LIMIT)?;
                let speakers = speakers.as_array().ok_or(SpeechError::new(NOT_READY))?;
                for speaker in speakers {
                    let Some(name) = speaker.get("name").and_then(Value::as_str) else { continue };
                    for style in speaker.get("styles").and_then(Value::as_array).into_iter().flatten() {
                        let id = style.get("id").filter(|id| id.is_i64() || id.is_u64()).map(Value::to_string);
                        let style_name = style.get("name").and_then(Value::as_str);
                        let kind = style.get("type").map_or(Some("talk"), Value::as_str);
                        if let (Some(id), Some(style_name), Some(kind)) = (id, style_name, kind)
                            && TALK_STYLES.contains(&kind)
                        {
                            voices.push(VoiceRow { id, speaker: name.to_owned(), style: style_name.to_owned() });
                        }
                    }
                }
            }
            EngineApi::Coeiroink => {
                let speakers = self.get_json("/v1/speakers_path_variant", token, QUERY_LIMIT)?;
                let speakers = speakers.as_array().ok_or(SpeechError::new(NOT_READY))?;
                for speaker in speakers {
                    let (Some(name), Some(uuid)) = (speaker.get("speakerName").and_then(Value::as_str), speaker.get("speakerUuid").and_then(Value::as_str)) else { continue };
                    for style in speaker.get("styles").and_then(Value::as_array).into_iter().flatten() {
                        let id = style.get("styleId").filter(|id| id.is_i64() || id.is_u64()).map(Value::to_string);
                        if let (Some(id), Some(style_name)) = (id, style.get("styleName").and_then(Value::as_str)) {
                            let voice_id = format!("{uuid}:{id}");
                            if coeiroink_voice(&voice_id).is_some() {
                                voices.push(VoiceRow { id: voice_id, speaker: name.to_owned(), style: style_name.to_owned() });
                            }
                        }
                    }
                }
            }
        }
        Ok(voices)
    }

    /// One sentence as a WAV.
    fn synthesize_piece(&self, text: &str, voice_id: &str, token: &CancelToken, reading: &Reading) -> Result<Vec<u8>, SpeechError> {
        let timeout = Some(self.synthesis_timeout);
        match self.api {
            EngineApi::Voicevox => {
                let path = format!("/audio_query?text={}&speaker={}", quote_plus(text), quote_plus(voice_id));
                let query = self.request("POST", &path, token, None, QUERY_LIMIT, "tts_engine_query_failed", timeout, Some("application/json"))?;
                let query = with_scales(query, &reading.audio_query)?;
                let path = format!("/synthesis?speaker={}", quote_plus(voice_id));
                self.request("POST", &path, token, Some(&query), WAV_LIMIT, "tts_engine_synthesis_failed", timeout, Some("audio/wav"))
            }
            EngineApi::Coeiroink => {
                let params = &reading.coeiroink;
                let (speaker, style) = coeiroink_voice(voice_id).ok_or(SpeechError::new("tts_engine_voice_missing"))?;
                let body = json!({
                    "speedScale": params.speed, "volumeScale": params.volume, "pitchScale": params.pitch, "intonationScale": params.intonation,
                    "prePhonemeLength": params.pre_phoneme, "postPhonemeLength": params.post_phoneme, "outputSamplingRate": params.sampling_rate,
                    "speakerUuid": speaker, "styleId": style, "text": text,
                });
                let body = serde_json::to_vec(&body).expect("a JSON value serializes");
                self.request("POST", "/v1/synthesis", token, Some(&body), WAV_LIMIT, "tts_engine_synthesis_failed", timeout, Some("audio/wav"))
            }
        }
    }

    /// Sentence by sentence. The next sentence is synthesized while this one plays.
    /// The engine reads with its default parameters; see [`Self::synthesize_stream_with`].
    pub fn synthesize_stream(&self, text: &str, voice: &EngineVoice, language: &str, token: &CancelToken) -> Result<Frames, SpeechError> {
        self.synthesize_stream_with(text, voice, language, token, &Reading::default())
    }

    /// As [`Self::synthesize_stream`], with how the engine reads: each API uses its own part of `reading`.
    pub fn synthesize_stream_with(&self, text: &str, voice: &EngineVoice, language: &str, token: &CancelToken, reading: &Reading) -> Result<Frames, SpeechError> {
        let params = *reading;
        if language != "ja" {
            return Err(SpeechError::new("tts_engine_language"));
        }
        if text.trim().is_empty() || text.chars().count() > MAX_TEXT {
            return Err(SpeechError::new("invalid_text"));
        }
        let voice_id = find_voice(&self.list_voices(Some(token))?, voice)?;
        let pieces = split_text(text);
        if pieces.is_empty() {
            return Err(SpeechError::new("invalid_text"));
        }
        // `inner` stops the prefetch when the message is cancelled or playback ends early.
        let inner = CancelToken::new();
        let stopper = inner.clone();
        token.register(move || stopper.cancel());
        let (sender, receiver) = sync_channel::<Item>(PREFETCH);
        let client = self.clone();
        let producer = inner.clone();
        thread::Builder::new()
            .name("astarot-engine-prefetch".into())
            .spawn(move || {
                for piece in pieces {
                    match client.synthesize_piece(&piece, &voice_id, &producer, &params) {
                        Ok(wav) => {
                            if !put(&sender, Item::Wav(wav), &producer) {
                                return;
                            }
                        }
                        Err(error) => {
                            put(&sender, Item::Error(error), &producer);
                            return;
                        }
                    }
                }
                put(&sender, Item::End, &producer);
            })
            .map_err(|_| SpeechError::new("tts_engine_synthesis_failed"))?;
        Ok(Box::new(EngineFrames { receiver, token: token.clone(), inner, pending: Vec::new(), budget: None, done: false }))
    }
}

enum Item {
    Wav(Vec<u8>),
    Error(SpeechError),
    End,
}

/// Hand one item over, waiting while the reader is behind. False once cancelled.
fn put(sender: &SyncSender<Item>, mut item: Item, token: &CancelToken) -> bool {
    loop {
        if token.is_set() {
            return false;
        }
        match sender.try_send(item) {
            Ok(()) => return true,
            Err(TrySendError::Full(back)) => {
                item = back;
                token.wait(Duration::from_millis(50));
            }
            Err(TrySendError::Disconnected(_)) => return false,
        }
    }
}

struct EngineFrames {
    receiver: Receiver<Item>,
    token: CancelToken,
    inner: CancelToken,
    pending: Vec<AudioFrame>,
    budget: Option<u64>,
    done: bool,
}

impl EngineFrames {
    fn fail(&mut self, error: SpeechError) -> Option<Result<AudioFrame, SpeechError>> {
        self.done = true;
        self.inner.cancel();
        Some(Err(error))
    }
}

impl Iterator for EngineFrames {
    type Item = Result<AudioFrame, SpeechError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        loop {
            if let Err(error) = self.token.check() {
                return self.fail(error);
            }
            if !self.pending.is_empty() {
                return Some(Ok(self.pending.remove(0)));
            }
            match self.receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(Item::Wav(wav)) => match wav_frames(&wav, &mut self.budget) {
                    Ok(frames) => self.pending = frames,
                    Err(error) => return self.fail(error),
                },
                Ok(Item::Error(error)) => {
                    if let Err(cancelled) = self.token.check() {
                        return self.fail(cancelled);
                    }
                    return self.fail(error);
                }
                Ok(Item::End) => {
                    self.done = true;
                    self.inner.cancel();
                    return None;
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return self.fail(SpeechError::new("tts_engine_synthesis_failed")),
            }
        }
    }
}

impl Drop for EngineFrames {
    fn drop(&mut self) {
        self.inner.cancel();
    }
}

impl Synthesizer for EngineClient {
    fn synthesize_stream(&self, request: &SpeechRequest, token: &CancelToken, _options: &SynthesisOptions) -> Result<Frames, TtsError> {
        let voice = request.engine_voice.as_ref().ok_or(SpeechError::new("tts_engine_voice_unset"))?;
        let reading = Reading { coeiroink: request.coeiroink.unwrap_or_default(), audio_query: request.audio_query.unwrap_or_default() };
        Ok(EngineClient::synthesize_stream_with(self, &request.text, voice, request.language, token, &reading)?)
    }
}

/// How an installed engine reads one message. Each API uses its own part: COEIROINK the values
/// of its `/v1/synthesis`, an engine with the VOICEVOX API the Scale fields of its AudioQuery.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Reading {
    pub coeiroink: CoeiroinkParams,
    pub audio_query: AudioQueryScales,
}

/// The engine's AudioQuery with the Scale fields that were set away from their defaults.
/// Nothing else in it is changed (ADR-008 5.2: AivisSpeech may fail on a query edited further),
/// and a query with every Scale at its default goes back byte for byte.
fn with_scales(query: Vec<u8>, scales: &AudioQueryScales) -> Result<Vec<u8>, SpeechError> {
    let changed = scales.changed();
    if changed.is_empty() {
        return Ok(query);
    }
    let failed = || SpeechError::new("tts_engine_query_failed");
    let mut value: Value = serde_json::from_slice(&query).map_err(|_| failed())?;
    let object = value.as_object_mut().ok_or_else(failed)?;
    for (field, number) in changed {
        object.insert(field.to_owned(), json!(number));
    }
    Ok(serde_json::to_vec(&value).expect("a JSON value serializes"))
}

/// The factory the speech bus uses for Japanese read by an installed engine.
pub fn engine_factory() -> EngineFactory {
    Arc::new(|engine: &str, url: &str| -> Result<Box<dyn Synthesizer>, TtsError> { Ok(Box::new(EngineClient::new(engine, url)?)) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_cut_into_sentences_and_long_ones_at_commas() {
        assert_eq!(split_text("こんにちは。元気？\n\nはい!"), vec!["こんにちは。", "元気？", "はい!"]);
        let long = "あ".repeat(30) + "、" + &"い".repeat(30) + "。";
        assert_eq!(split_text(&long), vec!["あ".repeat(30) + "、", "い".repeat(30) + "。"]);
        assert!(split_text("  \n ").is_empty());
    }

    #[test]
    fn query_strings_are_quoted_as_urllib_does() {
        assert_eq!(quote_plus("a b&c=あ"), "a+b%26c%3D%E3%81%82");
    }

    fn wav(rate: u32, channels: u16, bits: u16, pcm: &[u8]) -> Vec<u8> {
        let mut data = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        data.extend(16u32.to_le_bytes());
        data.extend(1u16.to_le_bytes());
        data.extend(channels.to_le_bytes());
        data.extend(rate.to_le_bytes());
        data.extend((rate * u32::from(channels) * 2).to_le_bytes());
        data.extend((channels * 2).to_le_bytes());
        data.extend(bits.to_le_bytes());
        data.extend(b"data");
        data.extend((pcm.len() as u32).to_le_bytes());
        data.extend(pcm);
        data
    }

    #[test]
    fn wavs_become_frames_within_the_duration_budget() {
        let mut budget = None;
        let frames = wav_frames(&wav(24000, 1, 16, &[1, 0].repeat(24000)), &mut budget).unwrap();
        assert_eq!(frames.len(), 5, "0.2 s frames");
        assert_eq!(budget, Some(24000 * 60 - 24000));
        assert_eq!(wav_frames(&wav(24000, 1, 8, &[1, 0]), &mut None).unwrap_err().code(), "unsupported_wav");
        assert_eq!(wav_frames(b"nope", &mut None).unwrap_err().code(), "invalid_wav");
        assert_eq!(wav_frames(&wav(24000, 1, 16, &[]), &mut None).unwrap_err().code(), "empty_pcm");
        assert_eq!(wav_frames(&wav(24000, 1, 16, &[1, 0]), &mut Some(0)).unwrap_err().code(), "audio_duration_limit");
    }

    #[test]
    fn a_saved_voice_is_found_by_id_then_by_name() {
        let voices = vec![VoiceRow { id: "3".into(), speaker: "A".into(), style: "x".into() }, VoiceRow { id: "8".into(), speaker: "B".into(), style: "y".into() }];
        let voice = |id: &str, speaker: &str, style: &str| EngineVoice { id: id.into(), speaker: speaker.into(), style: style.into() };
        assert_eq!(find_voice(&voices, &voice("3", "A", "x")).unwrap(), "3");
        assert_eq!(find_voice(&voices, &voice("3", "", "")).unwrap(), "3");
        assert_eq!(find_voice(&voices, &voice("3", "B", "y")).unwrap(), "8", "the names moved to another id");
        assert_eq!(find_voice(&voices, &voice("9", "C", "z")).unwrap_err().code(), "tts_engine_voice_missing");
        assert_eq!(find_voice(&voices, &voice("", "A", "x")).unwrap_err().code(), "tts_engine_voice_unset");
    }
}
