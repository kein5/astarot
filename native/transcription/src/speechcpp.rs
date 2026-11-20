//! What a speech.cpp server offers for recognition (`speechcpp_asr.py`), and the vocabulary a
//! realtime session sends it (`asr_vocabulary.py`, `vrchat_terms.py`).

use serde_json::{Value, json};
use std::sync::OnceLock;
use std::time::Duration;
use vrct_translation::http::{Cancel, HttpError, Request, Timeouts, Transport};

/// A recognition model the server lists (`RecognitionModel`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Model {
    pub id: String,
    pub languages: Vec<String>,
    pub accepts_language: bool,
    /// The language option defaults to "auto" and chooses among several languages.
    pub detects_language: bool,
    /// The request option names it takes (`keywords`, `prompt`, ...).
    pub options: Vec<String>,
}

impl Model {
    pub fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "languages": self.languages,
            "accepts_language": self.accepts_language,
            "detects_language": self.detects_language,
            "options": self.options,
        })
    }
}

/// `language_supported`: "auto" needs a model that detects.
pub fn language_supported(model: &Model, language: &str) -> bool {
    if language == "auto" { model.detects_language } else { model.languages.iter().any(|l| l == language) }
}

/// `local_url`: speech.cpp is reached on this PC only, over plain HTTP.
pub fn local_url(url: &str) -> Option<String> {
    let parsed = vrct_translation::http::Url::parse(url).ok()?;
    let host = parsed.host.trim_start_matches('[').trim_end_matches(']');
    let loopback =
        host.eq_ignore_ascii_case("localhost") || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback());
    (!parsed.tls && loopback).then(|| url.trim_end_matches('/').to_string())
}

/// `_detects`: the language option defaults to "auto" with several choices.
fn detects(options: &[Value]) -> bool {
    for option in options {
        if option["name"] == "language" {
            let choices: std::collections::BTreeSet<&str> =
                option["choices"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            return option["default"] == "auto" && option["choices"].is_array() && choices.len() > 1;
        }
    }
    false
}

/// `_survey`: the recognition models, and whether a diarization model runs on a GPU. Each step
/// of the request (connecting, writing, each read) waits at most `timeout`; `cancel` ends it
/// at once, as Python's `CancelToken` did. `Err` carries a fixed code (`cancelled`,
/// `transport_error`, `http_<status>`, `expected_json`, `response_too_large`, `invalid_json`,
/// `invalid_models`).
pub fn survey(
    transport: &Transport,
    base_url: &str,
    timeout: Duration,
    cancel: Option<&Cancel>,
) -> Result<(Vec<Model>, bool), String> {
    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
    let timeouts = Timeouts { connect: timeout, read: timeout, write: timeout };
    let mut request = Request::get(&url);
    if let Some(cancel) = cancel {
        request = request.cancellable(cancel);
    }
    let response = transport(&request, timeouts)
        .map_err(|error| if error == HttpError::Cancelled { "cancelled" } else { "transport_error" }.to_string())?;
    if response.status != 200 {
        return Err(format!("http_{}", response.status));
    }
    // As `_request`: only a JSON answer is read.
    let content_type = response.header("Content-Type").unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if content_type != "application/json" {
        return Err("expected_json".into());
    }
    if response.body.len() > 1024 * 1024 {
        return Err("response_too_large".into());
    }
    let body = response.json().ok_or("invalid_json")?;
    let rows = body["data"].as_array().ok_or("invalid_models")?;
    let mut models: Vec<Model> = Vec::new();
    let mut diarizes = false;
    for row in rows {
        let speech = row.get("speech").filter(|s| s.is_object()).ok_or("invalid_models")?;
        if speech["task"] != "recognition" {
            let device = speech["device"].as_str().map(|d| d.trim().to_lowercase());
            diarizes |= speech["task"] == "diarization" && device.is_some_and(|d| !d.is_empty() && d != "cpu");
            continue;
        }
        let name = row["id"].as_str().unwrap_or("");
        let languages = speech["languages"].as_array();
        let options = speech["options"].as_array();
        let valid = !name.trim().is_empty()
            && name.chars().count() <= 200
            && !name.chars().any(|c| (c as u32) < 32)
            && !models.iter().any(|m| m.id == name)
            && languages.is_some_and(|l| l.iter().all(Value::is_string))
            && options.is_some_and(|o| o.iter().all(Value::is_object));
        if !valid {
            return Err("invalid_models".into());
        }
        let options = options.expect("checked");
        models.push(Model {
            id: name.to_string(),
            languages: languages.expect("checked").iter().filter_map(Value::as_str).map(str::to_string).collect(),
            accepts_language: options.iter().any(|o| o["name"] == "language"),
            detects_language: detects(options),
            options: options.iter().filter_map(|o| o["name"].as_str().map(str::to_string)).collect(),
        });
    }
    Ok((models, diarizes))
}

// ------------------------------------------------------------------------------ vocabulary

pub const MAX_TERMS: usize = 150;
const MAX_PROMPT: usize = 300;
const PROMPT_PREFIX: &str = "VRChat用語: ";

/// The built-in VRChat vocabulary as it is kept: `data/vrchat_terms.txt`, embedded when the app
/// is built. Editing that file adds a term or puts its readings right (#792).
const VRCHAT_TERMS_TEXT: &str = include_str!("../data/vrchat_terms.txt");

/// The terms of a vocabulary file: one `written=reading,reading` a line, without the blank lines
/// and the comments (`#`), each line trimmed.
pub fn terms_in(text: &str) -> Vec<String> {
    text.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with('#')).map(str::to_string).collect()
}

/// `vrchat_terms`: the built-in VRChat vocabulary, reviewed by hand (`data/vrchat_terms.txt`).
pub fn vrchat_terms() -> &'static [String] {
    static TERMS: OnceLock<Vec<String>> = OnceLock::new();
    TERMS.get_or_init(|| terms_in(VRCHAT_TERMS_TEXT))
}

fn written_form(term: &str) -> &str {
    term.split_once('=').map_or(term, |(written, _)| written)
}

/// `merged_terms`: the user's terms (already normalized by the settings) first, then the
/// built-in ones, without a written form twice, at most [`MAX_TERMS`].
pub fn merged_terms(vocabulary: &Value) -> Vec<String> {
    let builtin = vocabulary["builtin"].as_bool().unwrap_or(true);
    let user = vocabulary["terms"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string);
    let built: &[String] = if builtin { vrchat_terms() } else { &[] };
    let mut seen: Vec<String> = Vec::new();
    let mut result = Vec::new();
    for term in user.chain(built.iter().cloned()) {
        let key = written_form(&term).to_lowercase();
        if !seen.contains(&key) && result.len() < MAX_TERMS {
            seen.push(key);
            result.push(term);
        }
    }
    result
}

/// `prompt_text`: whole written forms after a prefix, at most 300 characters.
pub fn prompt_text(terms: &[String]) -> String {
    let mut text = String::new();
    for term in terms {
        let candidate = if text.is_empty() {
            format!("{PROMPT_PREFIX}{}", written_form(term))
        } else {
            format!("{text}、{}", written_form(term))
        };
        if candidate.chars().count() > MAX_PROMPT {
            break;
        }
        text = candidate;
    }
    text
}

/// `request_options`: the transcription members for a model with these option names.
pub fn request_options(model_options: &[String], terms: &[String]) -> serde_json::Map<String, Value> {
    let mut options = serde_json::Map::new();
    if terms.is_empty() {
        return options;
    }
    if model_options.iter().any(|o| o == "keywords") {
        options.insert("keywords".into(), json!(terms));
    } else if model_options.iter().any(|o| o == "prompt") {
        options.insert("prompt".into(), json!(prompt_text(terms)));
    }
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_terms_come_first_and_the_cap_holds() {
        let terms = merged_terms(&json!({ "builtin": true, "terms": ["vrchat=ぶいちゃ", "猫"] }));
        assert_eq!(terms[0], "vrchat=ぶいちゃ");
        assert_eq!(terms[1], "猫");
        assert!(!terms.iter().any(|t| t.starts_with("VRChat=")), "the user's spelling wins");
        assert_eq!(merged_terms(&json!({ "builtin": false, "terms": [] })), Vec::<String>::new());
        let many: Vec<String> = (0..200).map(|i| format!("t{i}")).collect();
        assert_eq!(merged_terms(&json!({ "builtin": true, "terms": many })).len(), MAX_TERMS);
    }

    #[test]
    fn a_vocabulary_file_is_one_term_a_line_without_its_comments() {
        let text = "# The heading\n\nVRChat=ブイアールチャット,ブイチャ\n  ワールド  \n# Friends+=フレンズプラス\nお砂糖=おさとう\n";
        assert_eq!(terms_in(text), ["VRChat=ブイアールチャット,ブイチャ", "ワールド", "お砂糖=おさとう"]);
        assert!(terms_in("# only a comment\n\n").is_empty());
    }

    // #792: the built-in terms come from data/vrchat_terms.txt, and "Friends+" is read as players
    // say it. The rules of each line are checked against the settings' own (vrct-core's
    // voice_settings tests), which this crate cannot reach.
    #[test]
    fn the_built_in_terms_are_the_data_file() {
        let terms = vrchat_terms();
        assert_eq!(terms.len(), 50);
        assert_eq!(terms[0], "VRChat=ブイアールチャット,ブイチャ");
        assert!(terms.contains(&"Friends+=フレンドプラス,フレプラ".to_string()));
        assert!(!terms.iter().any(|t| t.contains("フレンズプラス")));
        let mut written: Vec<String> = terms.iter().map(|t| written_form(t).to_lowercase()).collect();
        written.sort();
        written.dedup();
        assert_eq!(written.len(), terms.len(), "no written form twice");
        assert!(terms.len() < MAX_TERMS, "room is left for the user's terms");
        assert_eq!(merged_terms(&json!({ "builtin": true, "terms": [] })), terms);
    }

    #[test]
    fn options_follow_what_the_model_takes() {
        let terms = vec!["VRChat=ブイチャ".to_string(), "集会".to_string()];
        assert_eq!(request_options(&["keywords".into()], &terms)["keywords"], json!(terms));
        assert_eq!(request_options(&["prompt".into()], &terms)["prompt"], "VRChat用語: VRChat、集会");
        assert!(request_options(&["language".into()], &terms).is_empty());
        assert!(request_options(&["keywords".into()], &[]).is_empty());
    }

    // The option shapes speech.cpp 0.10.0 lists for Qwen3-ASR-0.6B and Haas-ja v1.0
    // (`tests/voice/test_realtime_language.py`).
    fn qwen_language() -> Value {
        json!({ "name": "language", "type": "string", "required": false, "steers": true, "default": "auto", "choices": ["de", "en", "ja", "zh"] })
    }

    fn haas_language() -> Value {
        json!({ "name": "language", "type": "string", "required": false, "steers": false, "default": "auto", "choices": ["ja"] })
    }

    #[test]
    fn a_model_detects_when_its_language_defaults_to_auto_among_several() {
        let mut ja_default = qwen_language();
        ja_default["default"] = json!("ja");
        let cases = [
            (vec![qwen_language(), json!({ "name": "prompt", "default": "" })], true),
            // One choice: nothing to detect.
            (vec![haas_language(), json!({ "name": "keywords", "default": "" })], false),
            (vec![ja_default], false),
            (vec![json!({ "name": "language" })], false),
            (vec![], false),
        ];
        for (options, want) in cases {
            assert_eq!(detects(&options), want, "{options:?}");
        }
    }

    /// A transport that answers every request with `status`, `content_type` and `body`.
    fn answering(status: u16, content_type: &str, body: Value) -> Transport {
        let content_type = content_type.to_string();
        std::sync::Arc::new(move |request, _| {
            assert!(request.url.ends_with("/v1/models"), "{}", request.url);
            Ok(vrct_translation::http::Response {
                status,
                headers: vec![("Content-Type".to_string(), content_type.clone())],
                body: serde_json::to_vec(&body).unwrap(),
            })
        })
    }

    fn listed(body: Value) -> Result<(Vec<Model>, bool), String> {
        survey(&answering(200, "application/json; charset=utf-8", body), "http://127.0.0.1:8080/", Duration::from_secs(1), None)
    }

    #[test]
    fn the_list_has_the_recognisers_with_detection_and_drops_the_other_tasks() {
        let (models, diarizes) = listed(json!({ "data": [
            { "id": "Qwen3-ASR-0.6B", "speech": { "task": "recognition", "languages": ["de", "en", "ja", "zh"], "options": [qwen_language()] } },
            { "id": "Haas-616M-ja-v1.0", "speech": { "task": "recognition", "languages": ["ja"], "options": [haas_language(), { "name": "keywords" }] } },
            { "id": "silero-vad", "speech": { "task": "detection", "languages": [], "options": [] } },
        ] }))
        .unwrap();
        let rows: Vec<(&str, bool, bool)> = models.iter().map(|m| (m.id.as_str(), m.accepts_language, m.detects_language)).collect();
        assert_eq!(rows, [("Qwen3-ASR-0.6B", true, true), ("Haas-616M-ja-v1.0", true, false)]);
        assert_eq!(models[1].options, ["language", "keywords"]);
        assert!(!diarizes);
    }

    #[test]
    fn diarization_counts_only_on_a_gpu() {
        let recogniser = json!({ "id": "asr", "speech": { "task": "recognition", "languages": ["ja"], "options": [] } });
        for (device, want) in [(json!("Vulkan0"), true), (json!(" cuda0 "), true), (json!("CPU"), false), (json!(""), false), (Value::Null, false), (json!(7), false)] {
            let mut diarizer = json!({ "id": "nemotron", "speech": { "task": "diarization", "languages": [], "options": [] } });
            if !device.is_null() {
                diarizer["speech"]["device"] = device.clone();
            }
            let (models, diarizes) = listed(json!({ "data": [recogniser, diarizer] })).unwrap();
            assert_eq!((models.len(), diarizes), (1, want), "{device}");
        }
        // A detection model on a GPU is not a diarizer.
        let vad = json!({ "id": "vad", "speech": { "task": "detection", "device": "Vulkan0" } });
        assert!(!listed(json!({ "data": [recogniser, vad] })).unwrap().1);
    }

    #[test]
    fn a_list_that_is_not_one_is_refused_with_its_code() {
        let row = |id: Value, languages: Value, options: Value| json!({ "id": id, "speech": { "task": "recognition", "languages": languages, "options": options } });
        let bad = [
            json!({ "models": [] }),
            json!({ "data": [{ "id": "asr" }] }),
            json!({ "data": [row(json!(""), json!([]), json!([]))] }),
            json!({ "data": [row(json!("a\u{1}"), json!([]), json!([]))] }),
            json!({ "data": [row(json!("x".repeat(201)), json!([]), json!([]))] }),
            json!({ "data": [row(json!("asr"), json!([]), json!([])), row(json!("asr"), json!([]), json!([]))] }),
            json!({ "data": [row(json!("asr"), json!(["ja", 1]), json!([]))] }),
            json!({ "data": [row(json!("asr"), json!(["ja"]), json!(["language"]))] }),
            json!({ "data": [row(json!(3), json!(["ja"]), json!([]))] }),
        ];
        for body in bad {
            assert_eq!(listed(body.clone()).unwrap_err(), "invalid_models", "{body}");
        }
        let base = "http://127.0.0.1:8080";
        let second = Duration::from_secs(1);
        assert_eq!(survey(&answering(503, "application/json", json!({})), base, second, None).unwrap_err(), "http_503");
        // Only a JSON answer is read (`expected_json` in Python).
        assert_eq!(survey(&answering(200, "text/html", json!({ "data": [] })), base, second, None).unwrap_err(), "expected_json");
        assert_eq!(survey(&answering(200, "", json!({ "data": [] })), base, second, None).unwrap_err(), "expected_json");
        let large = json!({ "data": [], "padding": "x".repeat(1024 * 1024) });
        assert_eq!(survey(&answering(200, "application/json", large), base, second, None).unwrap_err(), "response_too_large");
        let broken: Transport = std::sync::Arc::new(|_, _| {
            Ok(vrct_translation::http::Response { status: 200, headers: vec![("content-type".into(), "application/json".into())], body: b"{".to_vec() })
        });
        assert_eq!(survey(&broken, base, second, None).unwrap_err(), "invalid_json");
        let unreachable: Transport = std::sync::Arc::new(|_, _| Err(vrct_translation::http::HttpError::Unreachable));
        assert_eq!(survey(&unreachable, base, second, None).unwrap_err(), "transport_error");
        assert_eq!(listed(json!({ "data": [] })).unwrap(), (Vec::new(), false));
    }

    #[test]
    fn a_cancel_ends_a_list_request_the_server_never_answers() {
        // Decision 81: a server that takes the connection and says nothing (one going away)
        // held the request for 5 s for each read; Python's `CancelToken` ended it at once.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        std::thread::spawn(move || {
            let mut held = Vec::new();
            for stream in listener.incoming().flatten() {
                held.push(stream);
            }
        });
        let cancel = Cancel::new();
        let cancelling = cancel.clone();
        let timer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            let at = std::time::Instant::now();
            cancelling.cancel();
            at
        });
        let listed = survey(&vrct_translation::http::direct(), &base, Duration::from_secs(5), Some(&cancel));
        let ended = std::time::Instant::now();
        assert_eq!(listed.unwrap_err(), "cancelled");
        let late = ended.saturating_duration_since(timer.join().unwrap());
        assert!(late < Duration::from_millis(100), "ended {late:?} after the cancel");
    }

    #[test]
    fn only_this_pc_over_plain_http() {
        assert_eq!(local_url("http://127.0.0.1:8080/").as_deref(), Some("http://127.0.0.1:8080"));
        assert_eq!(local_url("http://localhost:1"), Some("http://localhost:1".into()));
        assert_eq!(local_url("http://192.168.1.2:8080"), None);
        assert_eq!(local_url("https://127.0.0.1:8080"), None);
    }
}
