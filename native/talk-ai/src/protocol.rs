//! The OpenAI Realtime events this crate sends and reads, by their GA names, as plain values.
//!
//! OpenAI and vLLM-Omni (`/v1/realtime`, turn-based) take the same events. Where they differ,
//! the events here are the ones both accept: the model goes in the URL, not in the settings, and
//! the instructions go with each answer this crate asks for as well as with the session.
//!
//! Audio is 16-bit PCM, mono, little-endian, at 24 kHz, both ways: the only PCM either service
//! takes. Pictures go as JPEG data URLs.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};

/// The sample rate of the audio both ways.
pub const RATE: u32 = 24_000;
/// Bytes of audio in one millisecond (16-bit mono at 24 kHz).
pub const BYTES_PER_MS: u64 = 48;

/// Who says that the user has finished speaking.
#[derive(Clone, Debug, PartialEq)]
pub enum Turns {
    /// The service hears where the user stops (server VAD) and answers by itself. Speech that
    /// starts during an answer cancels it on the service's side.
    ServerVad { threshold: f32, prefix_padding_ms: u32, silence_duration_ms: u32 },
    /// The app says so ([`commit`] and [`create_response`]). vLLM-Omni's default.
    Manual,
}

impl Turns {
    /// OpenAI's defaults for server VAD.
    pub fn server_vad() -> Turns {
        Turns::ServerVad { threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 }
    }
}

/// What the session is set up with.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionSettings {
    /// What the model is told to be and do. Empty: the service's own.
    pub instructions: String,
    /// The voice of the answers, by the service's name for it; `None` keeps the service's.
    pub voice: Option<String>,
    pub turns: Turns,
}

/// `session.update` with the settings: audio in and out, the voice and the turns.
pub fn session_update(settings: &SessionSettings) -> Value {
    let format = json!({ "type": "audio/pcm", "rate": RATE });
    let turn_detection = match &settings.turns {
        Turns::ServerVad { threshold, prefix_padding_ms, silence_duration_ms } => json!({
            "type": "server_vad",
            "threshold": threshold,
            "prefix_padding_ms": prefix_padding_ms,
            "silence_duration_ms": silence_duration_ms,
            "create_response": true,
            "interrupt_response": true,
        }),
        Turns::Manual => Value::Null,
    };
    let mut output = json!({ "format": format });
    if let Some(voice) = &settings.voice {
        output["voice"] = json!(voice);
    }
    json!({
        "type": "session.update",
        "session": {
            "type": "realtime",
            "instructions": settings.instructions,
            "output_modalities": ["audio"],
            "audio": { "input": { "format": format, "turn_detection": turn_detection }, "output": output },
        },
    })
}

/// `input_audio_buffer.append` with PCM (an even number of bytes).
pub fn append_audio(pcm: &[u8]) -> Value {
    json!({ "type": "input_audio_buffer.append", "audio": STANDARD.encode(pcm) })
}

/// `input_audio_buffer.commit`: the user's turn ends with the audio sent so far.
pub fn commit() -> Value {
    json!({ "type": "input_audio_buffer.commit" })
}

/// `response.create`, with the instructions again: vLLM-Omni reads them only from here.
pub fn create_response(instructions: &str) -> Value {
    if instructions.is_empty() {
        return json!({ "type": "response.create" });
    }
    json!({ "type": "response.create", "response": { "instructions": instructions } })
}

/// `response.cancel`: the answer being made stops.
pub fn cancel_response() -> Value {
    json!({ "type": "response.cancel" })
}

/// `conversation.item.truncate`: the answer's item keeps only what was heard of it, so that the
/// model does not go on as if the rest had been said.
pub fn truncate(item_id: &str, audio_end_ms: u64) -> Value {
    json!({ "type": "conversation.item.truncate", "item_id": item_id, "content_index": 0, "audio_end_ms": audio_end_ms })
}

/// `conversation.item.create` with one picture from the user, as a JPEG data URL. It joins the
/// conversation without asking for an answer.
pub fn image(item_id: &str, jpeg: &[u8]) -> Value {
    image_with_detail(item_id, jpeg, None)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageDetail {
    Low,
    High,
    Auto,
}

pub fn image_with_detail(item_id: &str, jpeg: &[u8], detail: Option<ImageDetail>) -> Value {
    let mut event = json!({
        "type": "conversation.item.create",
        "item": {
            "id": item_id,
            "type": "message",
            "role": "user",
            "content": [{ "type": "input_image", "image_url": format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)) }],
        },
    });
    if let Some(detail) = detail {
        event["item"]["content"][0]["detail"] = json!(match detail {
            ImageDetail::Low => "low",
            ImageDetail::High => "high",
            ImageDetail::Auto => "auto",
        });
    }
    event
}

/// `conversation.item.delete`: an item leaves the conversation.
pub fn delete_item(item_id: &str) -> Value {
    json!({ "type": "conversation.item.delete", "item_id": item_id })
}

/// How an answer ended (`response.done`'s `response.status`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Completed,
    Cancelled,
    /// Cut short, for one by the most tokens it may have.
    Incomplete,
    Failed,
    /// A status this crate does not know.
    Other,
}

impl Status {
    fn parse(text: &str) -> Status {
        match text {
            "completed" => Status::Completed,
            "cancelled" => Status::Cancelled,
            "incomplete" => Status::Incomplete,
            "failed" => Status::Failed,
            _ => Status::Other,
        }
    }
}

/// An event from the service, with only what this crate uses of it.
#[derive(Clone, Debug, PartialEq)]
pub enum ServerEvent {
    SessionCreated,
    /// The settings were taken.
    SessionUpdated,
    /// The service heard the user start speaking (server VAD only).
    SpeechStarted,
    SpeechStopped,
    ResponseCreated { response_id: String },
    /// Part of an answer's audio (`response.output_audio.delta`).
    Audio { response_id: String, item_id: String, pcm: Vec<u8> },
    /// What the answer says, as it is spoken (`response.output_audio_transcript.delta`).
    Transcript { item_id: String, text: String },
    ResponseDone { response_id: String, status: Status },
    /// The service refused something. Only the code is kept: the message can quote what was
    /// sent.
    Error { code: Option<String> },
    /// Any other event; it is read and left.
    Other,
}

/// Why an event could not be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParseError {
    NotJson,
    NoType,
    /// Audio that is not base64 of whole 16-bit samples.
    BadAudio,
}

impl ParseError {
    pub fn code(self) -> &'static str {
        match self {
            ParseError::NotJson => "talk_event_not_json",
            ParseError::NoType => "talk_event_without_type",
            ParseError::BadAudio => "talk_event_bad_audio",
        }
    }
}

/// A service's error code when it looks like one (letters, digits, `_`, `.` and `-`, at most 64);
/// anything else is dropped rather than passed on.
fn error_code(value: &Value) -> Option<String> {
    let code = value.as_str()?;
    let fits = !code.is_empty() && code.len() <= 64 && code.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b));
    fits.then(|| code.to_string())
}

/// Reads one event.
pub fn parse(text: &str) -> Result<ServerEvent, ParseError> {
    let event: Value = serde_json::from_str(text).map_err(|_| ParseError::NotJson)?;
    let kind = event["type"].as_str().ok_or(ParseError::NoType)?;
    let text = |key: &str| event[key].as_str().unwrap_or_default().to_string();
    Ok(match kind {
        "session.created" => ServerEvent::SessionCreated,
        "session.updated" => ServerEvent::SessionUpdated,
        "input_audio_buffer.speech_started" => ServerEvent::SpeechStarted,
        "input_audio_buffer.speech_stopped" => ServerEvent::SpeechStopped,
        "response.created" => ServerEvent::ResponseCreated { response_id: event["response"]["id"].as_str().unwrap_or_default().to_string() },
        "response.output_audio.delta" => {
            let pcm = STANDARD.decode(event["delta"].as_str().unwrap_or_default()).map_err(|_| ParseError::BadAudio)?;
            if pcm.len() % 2 != 0 {
                return Err(ParseError::BadAudio);
            }
            ServerEvent::Audio { response_id: text("response_id"), item_id: text("item_id"), pcm }
        }
        "response.output_audio_transcript.delta" => ServerEvent::Transcript { item_id: text("item_id"), text: text("delta") },
        "response.done" => ServerEvent::ResponseDone {
            response_id: event["response"]["id"].as_str().unwrap_or_default().to_string(),
            status: Status::parse(event["response"]["status"].as_str().unwrap_or_default()),
        },
        "error" => ServerEvent::Error { code: error_code(&event["error"]["code"]) },
        _ => ServerEvent::Other,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn settings(turns: Turns) -> SessionSettings {
        SessionSettings { instructions: "Be brief.".into(), voice: Some("marin".into()), turns }
    }

    #[test]
    fn the_settings_ask_for_24_khz_pcm_both_ways_and_the_turns_asked_for() {
        let update = session_update(&settings(Turns::server_vad()));
        assert_eq!(update["type"], "session.update");
        let session = &update["session"];
        assert_eq!(session["type"], "realtime");
        assert_eq!(session["output_modalities"], json!(["audio"]));
        assert_eq!(session["audio"]["input"]["format"], json!({ "type": "audio/pcm", "rate": 24000 }));
        assert_eq!(session["audio"]["output"]["format"], json!({ "type": "audio/pcm", "rate": 24000 }));
        assert_eq!(session["audio"]["output"]["voice"], "marin");
        let turns = &session["audio"]["input"]["turn_detection"];
        assert_eq!((turns["type"].as_str(), turns["silence_duration_ms"].as_u64()), (Some("server_vad"), Some(500)));
        assert_eq!((turns["create_response"].as_bool(), turns["interrupt_response"].as_bool()), (Some(true), Some(true)));
        assert!(session.get("model").is_none(), "the model goes in the URL");

        let manual = session_update(&SessionSettings { voice: None, ..settings(Turns::Manual) });
        assert!(manual["session"]["audio"]["input"]["turn_detection"].is_null(), "the app ends the turns");
        assert!(manual["session"]["audio"]["output"].get("voice").is_none(), "the service's own voice");
    }

    #[test]
    fn audio_and_pictures_go_as_base64() {
        assert_eq!(append_audio(&[1, 0, 255, 127]), json!({ "type": "input_audio_buffer.append", "audio": "AQD/fw==" }));
        let picture = image("img_1", &[0xff, 0xd8, 0xff]);
        assert_eq!(picture["item"]["id"], "img_1");
        assert_eq!(picture["item"]["role"], "user");
        assert_eq!(picture["item"]["content"][0], json!({ "type": "input_image", "image_url": "data:image/jpeg;base64,/9j/" }));
        assert_eq!(delete_item("img_1"), json!({ "type": "conversation.item.delete", "item_id": "img_1" }));
    }

    #[test]
    fn an_answer_is_asked_for_with_the_instructions_and_cut_where_it_was_heard() {
        assert_eq!(create_response("Be brief."), json!({ "type": "response.create", "response": { "instructions": "Be brief." } }));
        assert_eq!(create_response(""), json!({ "type": "response.create" }));
        assert_eq!(truncate("item_9", 1234), json!({ "type": "conversation.item.truncate", "item_id": "item_9", "content_index": 0, "audio_end_ms": 1234 }));
        assert_eq!(cancel_response(), json!({ "type": "response.cancel" }));
        assert_eq!(commit(), json!({ "type": "input_audio_buffer.commit" }));
    }

    #[test]
    fn the_events_used_are_read_and_the_rest_left() {
        let audio = parse(r#"{"type":"response.output_audio.delta","response_id":"resp_1","item_id":"item_1","output_index":0,"content_index":0,"delta":"AQD/fw=="}"#);
        assert_eq!(audio, Ok(ServerEvent::Audio { response_id: "resp_1".into(), item_id: "item_1".into(), pcm: vec![1, 0, 255, 127] }));
        assert_eq!(parse(r#"{"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}"#), Ok(ServerEvent::ResponseCreated { response_id: "resp_1".into() }));
        assert_eq!(
            parse(r#"{"type":"response.done","response":{"id":"resp_1","status":"cancelled","status_details":{"reason":"turn_detected"}}}"#),
            Ok(ServerEvent::ResponseDone { response_id: "resp_1".into(), status: Status::Cancelled })
        );
        assert_eq!(parse(r#"{"type":"input_audio_buffer.speech_started","audio_start_ms":100,"item_id":"item_2"}"#), Ok(ServerEvent::SpeechStarted));
        assert_eq!(parse(r#"{"type":"rate_limits.updated","rate_limits":[]}"#), Ok(ServerEvent::Other));
        assert_eq!(parse(r#"{"type":"response.output_audio_transcript.delta","item_id":"item_1","delta":"Hi"}"#), Ok(ServerEvent::Transcript { item_id: "item_1".into(), text: "Hi".into() }));
    }

    #[test]
    fn an_error_keeps_its_code_and_never_its_message() {
        let error = r#"{"type":"error","error":{"type":"invalid_request_error","code":"invalid_api_key","message":"Incorrect API key provided: sk-abc","param":null}}"#;
        assert_eq!(parse(error), Ok(ServerEvent::Error { code: Some("invalid_api_key".into()) }));
        let odd = r#"{"type":"error","error":{"code":"has spaces: and text"}}"#;
        assert_eq!(parse(odd), Ok(ServerEvent::Error { code: None }));
        // vLLM-Omni's refusal of an unusable endpoint puts the error as a string.
        assert_eq!(parse(r#"{"type":"error","error":"Realtime API is not available","code":"unsupported"}"#), Ok(ServerEvent::Error { code: None }));
    }

    #[test]
    fn broken_events_are_refused_by_kind() {
        assert_eq!(parse("not json"), Err(ParseError::NotJson));
        assert_eq!(parse(r#"{"no":"type"}"#), Err(ParseError::NoType));
        assert_eq!(parse(r#"{"type":"response.output_audio.delta","delta":"%%%"}"#), Err(ParseError::BadAudio));
        assert_eq!(parse(r#"{"type":"response.output_audio.delta","delta":"AQD/"}"#), Err(ParseError::BadAudio), "three bytes are not whole samples");
    }

    proptest! {
        #[test]
        fn no_text_makes_the_reading_panic(text in ".{0,200}") {
            let _ = parse(&text);
        }

        #[test]
        fn any_audio_comes_back_as_it_was_sent(samples in proptest::collection::vec(any::<i16>(), 0..512)) {
            let pcm: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
            let sent = append_audio(&pcm);
            let delta = json!({ "type": "response.output_audio.delta", "response_id": "r", "item_id": "i", "delta": sent["audio"] });
            prop_assert_eq!(parse(&delta.to_string()), Ok(ServerEvent::Audio { response_id: "r".into(), item_id: "i".into(), pcm }));
        }
    }
}
