//! The cloud engines of the recorder (`transcription_providers.py`,
//! `transcription_openai_compatible.py`, `transcription_deepgram.py`): the Google web speech
//! endpoint, the OpenAI-compatible transcription APIs (Groq, OpenAI, a custom server) and
//! Deepgram. Each recognises one utterance for each candidate language and the best text wins,
//! as `AudioTranscriber._finalizeAndTranscribe` chose it.
//!
//! Requests go through the HTTP client of `vrct-translation` (no proxy, no redirects, TLS with
//! the Mozilla roots); tests give a transport that only reaches this PC. Nothing here logs or
//! returns the audio, the text of a reply or a key.

use crate::Transcript;
use crate::pcm;
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use vrct_translation::http::{HttpError, Request, Response, Timeouts, Transport};

/// The address of the engines with a fixed one; tests point them at this PC.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoints {
    /// `speech_recognition`'s Google endpoint, upgraded to HTTPS as Python upgraded it.
    pub google: String,
    pub groq: String,
    pub openai: String,
    pub deepgram: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Endpoints {
            google: "https://www.google.com/speech-api/v2/recognize".into(),
            groq: "https://api.groq.com/openai/v1".into(),
            openai: "https://api.openai.com/v1".into(),
            deepgram: "https://api.deepgram.com/v1".into(),
        }
    }
}

impl Endpoints {
    /// Every engine at one local server (for tests): `{base}/google`, `{base}/groq/v1`, ...
    pub fn all_at(base: &str) -> Endpoints {
        let base = base.trim_end_matches('/');
        Endpoints {
            google: format!("{base}/google/recognize"),
            groq: format!("{base}/groq/v1"),
            openai: format!("{base}/openai/v1"),
            deepgram: format!("{base}/deepgram/v1"),
        }
    }
}

/// The key `speech_recognition` sends when none is given (its "generic key").
const GOOGLE_KEY: &str = "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw";
/// `GOOGLE_RECOGNIZE_TIMEOUT_SECONDS`.
const GOOGLE_TIMEOUT: Timeouts = Timeouts::all(10.0);
/// `_OPENAI_TIMEOUT` and `_HTTP_TIMEOUT`: 10 s to connect, 60 s to read and write.
const UPLOAD: Timeouts = Timeouts { connect: Duration::from_secs(10), read: Duration::from_secs(60), write: Duration::from_secs(60) };
/// `DISCOVERY_TIMEOUT`.
pub const DISCOVERY: Timeouts = Timeouts::all(3.0);
/// `TRANSCRIPTION_MODEL_KEYWORDS` and `TRANSCRIPTION_MODEL_EXCLUDED_KEYWORDS`.
const MODEL_KEYWORDS: [&str; 2] = ["whisper", "transcribe"];
const MODEL_EXCLUDED: [&str; 1] = ["diarize"];

/// Why an engine failed (`TranscriptionApiError`); the code the settings show.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApiError {
    Auth,
    RateLimited,
    Timeout,
    Server,
}

impl ApiError {
    pub fn code(self) -> &'static str {
        match self {
            ApiError::Auth => "TRANSCRIPTION_API_AUTH_FAILED",
            ApiError::RateLimited => "TRANSCRIPTION_API_RATE_LIMITED",
            ApiError::Timeout => "TRANSCRIPTION_API_TIMEOUT",
            ApiError::Server => "TRANSCRIPTION_API_SERVER_ERROR",
        }
    }

    fn of_status(status: u16) -> ApiError {
        match status {
            401 | 403 => ApiError::Auth,
            429 => ApiError::RateLimited,
            _ => ApiError::Server,
        }
    }

    fn of_http(error: HttpError) -> ApiError {
        if error == HttpError::Timeout { ApiError::Timeout } else { ApiError::Server }
    }
}

/// One candidate language, with its codes from the recognition language table.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    /// The name (`Japanese`).
    pub language: String,
    /// The table's `Google` column (`ja-JP`).
    pub google: String,
    /// The table's `Whisper` column (`ja`).
    pub whisper: String,
    /// The column of the selected engine (`Groq_Whisper`, ...); empty when it has none.
    pub engine: String,
}

/// A configured engine.
#[derive(Clone)]
pub enum Engine {
    Google { url: String },
    /// `Groq_Whisper`, `OpenAI_Whisper` or `Custom_Whisper`.
    Compatible { name: String, key: String, base_url: String, model: String },
    Deepgram { key: String, model: String, languages: Vec<String>, base_url: String },
}

impl std::fmt::Debug for Engine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never the key.
        match self {
            Engine::Google { .. } => f.write_str("Google"),
            Engine::Compatible { name, model, .. } => write!(f, "{name}({model})"),
            Engine::Deepgram { model, .. } => write!(f, "Deepgram({model})"),
        }
    }
}

impl Engine {
    pub fn name(&self) -> &str {
        match self {
            Engine::Google { .. } => "Google",
            Engine::Compatible { name, .. } => name,
            Engine::Deepgram { .. } => "Deepgram",
        }
    }
}

/// What one try with one candidate gave.
struct Attempt {
    text: String,
    confidence: f64,
    definitive: bool,
    detected: Option<String>,
}

/// The recognition failed for every candidate (`AudioPipelineError(ASR_ERROR)`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AsrFailed {
    /// The first engine error, for the log.
    pub error: ApiError,
}

/// An engine with the way to reach it.
#[derive(Clone)]
pub struct Recognizer {
    pub engine: Engine,
    transport: Transport,
}

fn multipart(boundary: &str, fields: &[(&str, String)], wav: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

fn boundary() -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("vrct{nanos:x}")
}

/// `transcriptionResponseFormat`: gpt-*-transcribe models take only `json`.
pub fn response_format(model: &str) -> &'static str {
    let name = model.to_lowercase();
    if name.contains("transcribe") && !name.contains("whisper") { "json" } else { "verbose_json" }
}

fn normalize_language(value: &str, table: &Value) -> Option<String> {
    let value = value.trim().to_lowercase().replace('_', "-");
    if value.is_empty() {
        return None;
    }
    if let Some(rows) = table.as_object() {
        for (language, countries) in rows {
            if value == language.to_lowercase() {
                return countries.as_object()?.values().next()?["Whisper"].as_str().map(str::to_string);
            }
        }
    }
    let value = match value.as_str() {
        "chinese" => "zh".to_string(),
        "cantonese" => "yue".to_string(),
        "tagalog" => "tl".to_string(),
        _ => value,
    };
    let (base, rest) = match value.split_once('-') {
        Some((base, rest)) => (base.to_string(), Some(rest.to_string())),
        None => (value.clone(), None),
    };
    let base = match base.as_str() {
        "cmn" => "zh".to_string(),
        "iw" => "he".to_string(),
        "fil" => "tl".to_string(),
        _ => base,
    };
    Some(match rest {
        Some(rest) => format!("{base}-{rest}"),
        None => base,
    })
}

/// `resolveDetectedLanguage`: the candidate a detected language names, if any.
pub fn resolve_detected(detected: Option<&str>, candidates: &[Candidate], table: &Value) -> Option<String> {
    let detected = detected?;
    let code = normalize_language(detected, table)?;
    for candidate in candidates {
        if detected.trim().to_lowercase() == candidate.language.to_lowercase()
            || Some(&code) == normalize_language(&candidate.google, table).as_ref()
        {
            return Some(candidate.language.clone());
        }
    }
    let parts: Vec<&str> = code.split('-').collect();
    if parts.len() > 1 {
        for candidate in candidates {
            let google = normalize_language(&candidate.google, table).unwrap_or_default();
            let other: Vec<&str> = google.split('-').collect();
            if parts[0] == other[0] && parts[1..].iter().all(|part| other[1..].contains(part)) {
                return Some(candidate.language.clone());
            }
        }
    }
    candidates.iter().find(|c| parts[0] == c.whisper).map(|c| c.language.clone())
}

/// `resolveDeepgramLanguageCode`: the code a Deepgram model lists for the candidate.
pub fn deepgram_code(candidate: &Candidate, model_languages: &[String]) -> Option<String> {
    let mut listed: Vec<(String, String)> = Vec::new();
    for code in model_languages.iter().filter(|c| !c.is_empty()) {
        if !listed.iter().any(|(lower, _)| *lower == code.to_lowercase()) {
            listed.push((code.to_lowercase(), code.clone()));
        }
    }
    if listed.is_empty() || listed.iter().any(|(lower, _)| lower == "multi") {
        return None;
    }
    if !candidate.google.is_empty()
        && let Some((_, code)) = listed.iter().find(|(lower, _)| *lower == candidate.google.to_lowercase())
    {
        return Some(code.clone());
    }
    if candidate.whisper.is_empty() {
        return None;
    }
    let base = candidate.whisper.split('-').next().unwrap_or("").to_lowercase();
    listed.iter().find(|(lower, _)| lower.split('-').next() == Some(base.as_str())).map(|(_, code)| code.clone())
}

impl Recognizer {
    pub fn new(engine: Engine, transport: Transport) -> Recognizer {
        Recognizer { engine, transport }
    }

    fn send(&self, request: &Request<'_>, timeouts: Timeouts) -> Result<Response, HttpError> {
        (self.transport)(request, timeouts)
    }

    /// Recognises one utterance of mono samples (`_finalizeAndTranscribe`): `Ok(None)` when
    /// nothing was understood, `Err` when an engine failed and nothing was understood.
    pub fn recognize(
        &self,
        mono: &[i16],
        rate: u32,
        candidates: &[Candidate],
        avg_logprob: f64,
        no_speech_prob: f64,
        table: &Value,
    ) -> Result<Option<Transcript>, AsrFailed> {
        let started = Instant::now();
        let force_language = candidates.len() == 1;
        let mut best: Option<(f64, String, Option<String>)> = None;
        let mut failure: Option<ApiError> = None;
        for candidate in candidates {
            let attempt = match &self.engine {
                Engine::Google { url } => self.google(url, mono, rate, candidate),
                Engine::Compatible { key, base_url, model, .. } => {
                    self.compatible(key, base_url, model, mono, rate, candidate, force_language, avg_logprob, no_speech_prob)
                }
                Engine::Deepgram { key, model, languages, base_url } => {
                    self.deepgram(key, base_url, model, languages, mono, rate, candidate, force_language)
                }
            };
            let attempt = match attempt {
                Ok(attempt) => attempt,
                Err(error) => {
                    failure = failure.or(Some(error));
                    continue;
                }
            };
            if !attempt.text.is_empty() && (attempt.definitive || attempt.confidence > best.as_ref().map_or(0.0, |b| b.0)) {
                let language = resolve_detected(attempt.detected.as_deref(), candidates, table);
                best = Some((attempt.confidence, attempt.text.clone(), language));
            }
            if attempt.definitive {
                break;
            }
        }
        let asr_ms = started.elapsed().as_millis() as u64;
        match (best, failure) {
            (Some((_, text, language)), _) => Ok(Some(Transcript { text, language, asr_ms })),
            (None, Some(error)) => Err(AsrFailed { error }),
            (None, None) => Ok(None),
        }
    }

    fn google(&self, url: &str, mono: &[i16], rate: u32, candidate: &Candidate) -> Result<Attempt, ApiError> {
        let (samples, rate) = if rate < 8000 { (pcm::ratecv(mono, rate, 8000), 8000) } else { (mono.to_vec(), rate) };
        let flac = pcm::flac(&samples, rate);
        let target = format!("{url}?client=chromium&lang={}&key={GOOGLE_KEY}&pFilter=0", percent(&candidate.google));
        let request = Request {
            method: "POST",
            url: &target,
            headers: vec![("Content-Type", format!("audio/x-flac; rate={rate}"))],
            body: Some(flac),
        };
        let response = self.send(&request, GOOGLE_TIMEOUT).map_err(ApiError::of_http)?;
        if response.status != 200 {
            return Err(ApiError::of_status(response.status));
        }
        let text = String::from_utf8_lossy(&response.body);
        let mut transcripts = Vec::new();
        let mut confidences = Vec::new();
        for line in text.split('\n').filter(|line| !line.is_empty()) {
            let block: Value = serde_json::from_str(line).map_err(|_| ApiError::Server)?;
            let Some(result) = block.get("result").and_then(Value::as_array) else { return Err(ApiError::Server) };
            let Some(first) = result.first() else { continue };
            // `"confidence" in candidate["alternative"]` looks in a list: the first wins.
            let Some(best) = first["alternative"].as_array().and_then(|a| a.first()) else { continue };
            let Some(transcript) = best["transcript"].as_str() else { continue };
            transcripts.push(transcript.to_string());
            confidences.push(best["confidence"].as_f64().unwrap_or(0.5));
        }
        if transcripts.is_empty() {
            return Ok(Attempt { text: String::new(), confidence: 0.0, definitive: false, detected: None });
        }
        let confidence = confidences.iter().sum::<f64>() / confidences.len() as f64;
        Ok(Attempt { text: transcripts.join(" "), confidence, definitive: false, detected: Some(candidate.google.clone()) })
    }

    #[allow(clippy::too_many_arguments)]
    fn compatible(
        &self,
        key: &str,
        base_url: &str,
        model: &str,
        mono: &[i16],
        rate: u32,
        candidate: &Candidate,
        force_language: bool,
        avg_logprob: f64,
        no_speech_prob: f64,
    ) -> Result<Attempt, ApiError> {
        let wav = pcm::wav(&pcm::ratecv(mono, rate, 16000), 16000, 1);
        let language = force_language.then(|| candidate.engine.clone()).filter(|code| !code.is_empty());
        let mut fields = vec![("model", model.to_string())];
        if let Some(language) = &language {
            fields.push(("language", language.clone()));
        }
        fields.push(("response_format", response_format(model).to_string()));
        fields.push(("temperature", "0.0".to_string()));
        let boundary = boundary();
        let url = format!("{}/audio/transcriptions", base_url.trim_end_matches('/'));
        let request = Request {
            method: "POST",
            url: &url,
            headers: vec![
                ("Authorization", format!("Bearer {key}")),
                ("Content-Type", format!("multipart/form-data; boundary={boundary}")),
            ],
            body: Some(multipart(&boundary, &fields, &wav)),
        };
        // The SDK tried twice more after a broken connection, 408, 409, 429 or 5xx.
        let mut tries = 0;
        let response = loop {
            tries += 1;
            let retry = match self.send(&request, UPLOAD) {
                Ok(response) if response.status == 200 => break response,
                Ok(response) => {
                    let status = response.status;
                    if !(matches!(status, 408 | 409 | 429) || status >= 500) || tries > 2 {
                        return Err(ApiError::of_status(status));
                    }
                    true
                }
                Err(error) => {
                    if error == HttpError::Url || tries > 2 {
                        return Err(ApiError::of_http(error));
                    }
                    true
                }
            };
            if retry {
                std::thread::sleep(Duration::from_millis(500 << (tries - 1)));
            }
        };
        let body = response.json().ok_or(ApiError::Server)?;
        let segments = body["segments"].as_array().filter(|s| !s.is_empty());
        let mut accepted = Vec::new();
        let mut text = String::new();
        if let Some(segments) = segments {
            for segment in segments {
                let logprob = segment["avg_logprob"].as_f64().unwrap_or(f64::NEG_INFINITY);
                let silence = segment["no_speech_prob"].as_f64().unwrap_or(1.0);
                if logprob < avg_logprob || silence > no_speech_prob {
                    continue;
                }
                text.push_str(segment["text"].as_str().unwrap_or(""));
                accepted.push(logprob);
            }
        } else {
            text = body["text"].as_str().unwrap_or("").to_string();
        }
        let text = text.trim().to_string();
        if text.is_empty() {
            return Ok(Attempt { text, confidence: 0.0, definitive: false, detected: None });
        }
        let confidence =
            if accepted.is_empty() { 0.5 } else { (accepted.iter().sum::<f64>() / accepted.len() as f64).exp() };
        let detected = language.or_else(|| body["language"].as_str().map(str::to_string));
        Ok(Attempt { text, confidence, definitive: true, detected })
    }

    #[allow(clippy::too_many_arguments)]
    fn deepgram(
        &self,
        key: &str,
        base_url: &str,
        model: &str,
        languages: &[String],
        mono: &[i16],
        rate: u32,
        candidate: &Candidate,
        force_language: bool,
    ) -> Result<Attempt, ApiError> {
        let wav = pcm::wav(&pcm::ratecv(mono, rate, 16000), 16000, 1);
        let code = if force_language { deepgram_code(candidate, languages) } else { None };
        let query = match &code {
            Some(code) => format!("model={}&language={}", percent(model), percent(code)),
            None => format!("model={}&detect_language=true", percent(model)),
        };
        let url = format!("{}/listen?{query}", base_url.trim_end_matches('/'));
        let request = Request {
            method: "POST",
            url: &url,
            headers: vec![("Authorization", format!("Token {key}")), ("Content-Type", "audio/wav".to_string())],
            body: Some(wav),
        };
        let response = self.send(&request, UPLOAD).map_err(ApiError::of_http)?;
        if response.status != 200 {
            return Err(ApiError::of_status(response.status));
        }
        let body = response.json().ok_or(ApiError::Server)?;
        let channel = &body["results"]["channels"][0];
        let alternative = &channel["alternatives"][0];
        let (Some(text), Some(confidence)) = (alternative["transcript"].as_str(), alternative["confidence"].as_f64())
        else {
            return Err(ApiError::Server);
        };
        if alternative["confidence"].is_boolean() || !(0.0..=1.0).contains(&confidence) {
            return Err(ApiError::Server);
        }
        if text.is_empty() {
            return Ok(Attempt { text: String::new(), confidence: 0.0, definitive: false, detected: None });
        }
        let detected = code.or_else(|| channel["detected_language"].as_str().map(str::to_string));
        Ok(Attempt { text: text.to_string(), confidence, definitive: true, detected })
    }
}

fn percent(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// A key check failed: the key was refused, or the service could not be asked.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CheckFailed;

/// `checkTranscriptionApiKey` and `getAvailableTranscriptionModels`: the models a key lists
/// at an OpenAI-compatible service. Groq and OpenAI keep only transcription models
/// (`filtered`); a custom server keeps all.
pub fn compatible_models(transport: &Transport, base_url: &str, key: &str, filtered: bool) -> Result<Vec<String>, CheckFailed> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let request = Request::get(&url).header("Authorization", format!("Bearer {key}"));
    let response = transport(&request, DISCOVERY).map_err(|_| CheckFailed)?;
    if !response.ok() {
        return Err(CheckFailed);
    }
    let body = response.json().ok_or(CheckFailed)?;
    let rows = body["data"].as_array().ok_or(CheckFailed)?;
    let mut models: Vec<String> = rows
        .iter()
        .filter_map(|row| row["id"].as_str().map(str::to_string))
        .filter(|id| {
            let lower = id.to_lowercase();
            !filtered
                || (MODEL_KEYWORDS.iter().any(|k| lower.contains(k)) && !MODEL_EXCLUDED.iter().any(|k| lower.contains(k)))
        })
        .collect();
    models.sort();
    Ok(models)
}

/// `checkDeepgramApiKey`: `/auth/token` answers 200 for a valid key.
pub fn deepgram_key_valid(transport: &Transport, base_url: &str, key: &str) -> bool {
    let url = format!("{}/auth/token", base_url.trim_end_matches('/'));
    let request = Request::get(&url).header("Authorization", format!("Token {key}"));
    transport(&request, DISCOVERY).is_ok_and(|response| response.status == 200)
}

/// `getAvailableDeepgramModelsDetailed`: the batch models and their languages, by name. An
/// unreadable list is empty.
pub fn deepgram_models(transport: &Transport, base_url: &str, key: &str) -> Vec<(String, Vec<String>)> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let request = Request::get(&url).header("Authorization", format!("Token {key}"));
    let Some(body) = transport(&request, DISCOVERY).ok().filter(|r| r.ok()).and_then(|r| r.json()) else {
        return Vec::new();
    };
    let mut models: Vec<(String, Vec<String>)> = Vec::new();
    for row in body["stt"].as_array().into_iter().flatten() {
        let Some(name) = row["name"].as_str().filter(|n| !n.is_empty()) else { continue };
        if row["batch"] != json!(true) || models.iter().any(|(listed, _)| listed == name) {
            continue;
        }
        let languages =
            row["languages"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
        models.push((name.to_string(), languages));
    }
    models.sort_by(|a, b| a.0.cmp(&b.0));
    models
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> Value {
        json!({
            "Japanese": { "Japan": { "Google": "ja-JP", "Whisper": "ja", "Groq_Whisper": "ja" } },
            "English": { "United States": { "Google": "en-US", "Whisper": "en" }, "United Kingdom": { "Google": "en-GB", "Whisper": "en" } },
            "Chinese Simplified": { "China": { "Google": "cmn-Hans-CN", "Whisper": "zh" } },
        })
    }

    fn candidate(language: &str, google: &str, whisper: &str) -> Candidate {
        Candidate { language: language.into(), google: google.into(), whisper: whisper.into(), engine: whisper.into() }
    }

    #[test]
    fn a_detected_language_is_matched_to_the_candidates() {
        let candidates = [candidate("Japanese", "ja-JP", "ja"), candidate("English", "en-GB", "en")];
        assert_eq!(resolve_detected(Some("japanese"), &candidates, &table()).as_deref(), Some("Japanese"));
        assert_eq!(resolve_detected(Some("en"), &candidates, &table()).as_deref(), Some("English"));
        assert_eq!(resolve_detected(Some("en-GB"), &candidates, &table()).as_deref(), Some("English"));
        assert_eq!(resolve_detected(Some("fr"), &candidates, &table()), None);
        assert_eq!(resolve_detected(None, &candidates, &table()), None);
        let chinese = [candidate("Chinese Simplified", "cmn-Hans-CN", "zh")];
        assert_eq!(resolve_detected(Some("zh"), &chinese, &table()).as_deref(), Some("Chinese Simplified"));
    }

    #[test]
    fn deepgram_codes_prefer_the_region() {
        let english = candidate("English", "en-GB", "en");
        let listed = |codes: &[&str]| codes.iter().map(|c| c.to_string()).collect::<Vec<_>>();
        assert_eq!(deepgram_code(&english, &listed(&["en-US", "en-GB"])).as_deref(), Some("en-GB"));
        assert_eq!(deepgram_code(&english, &listed(&["en"])).as_deref(), Some("en"));
        assert_eq!(deepgram_code(&english, &listed(&["multi", "en"])), None);
        assert_eq!(deepgram_code(&english, &[]), None);
    }

    #[test]
    fn response_formats_follow_the_model() {
        assert_eq!(response_format("gpt-4o-transcribe"), "json");
        assert_eq!(response_format("whisper-large-v3"), "verbose_json");
        assert_eq!(response_format("custom"), "verbose_json");
    }
}
