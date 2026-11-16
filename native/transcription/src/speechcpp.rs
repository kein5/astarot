//! What a speech.cpp server offers for recognition (`speechcpp_asr.py`), and the vocabulary a
//! realtime session sends it (`asr_vocabulary.py`, `vrchat_terms.py`).

use serde_json::{Value, json};
use std::time::Duration;
use vrct_translation::http::{Request, Timeouts, Transport};

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

/// `_survey`: the recognition models, and whether a diarization model runs on a GPU. `Err`
/// carries a fixed code (`transport_error`, `invalid_models`, `http_<status>`).
pub fn survey(transport: &Transport, base_url: &str, timeout: Duration) -> Result<(Vec<Model>, bool), String> {
    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
    let timeouts = Timeouts { connect: timeout, read: timeout, write: timeout };
    let response = transport(&Request::get(&url), timeouts).map_err(|_| "transport_error".to_string())?;
    if response.status != 200 {
        return Err(format!("http_{}", response.status));
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

/// `VRCHAT_TERMS`: the built-in VRChat vocabulary, reviewed by hand.
pub const VRCHAT_TERMS: &[&str] = &[
    "VRChat=ブイアールチャット,ブイチャ",
    "VRC=ブイアールシー",
    "インスタンス",
    "ワールド",
    "アバター",
    "ポータル",
    "ミラー",
    "フレンド",
    "フレンド申請=ふれんどしんせい",
    "ブロック",
    "ミュート",
    "ジョイン",
    "グループ",
    "Public=パブリック",
    "Friends+=フレンズプラス",
    "Invite+=インバイトプラス",
    "トラストランク",
    "Visitor=ビジター",
    "New User=ニューユーザー",
    "Known User=ノウンユーザー",
    "Trusted User=トラステッドユーザー",
    "Udon",
    "UdonSharp=ウドンシャープ",
    "VRChat SDK",
    "SDK=エスディーケー",
    "VCC=ブイシーシー",
    "Creator Companion=クリエイターコンパニオン",
    "Unity=ユニティ",
    "OSC=オーエスシー",
    "PhysBones=フィズボーン",
    "Expression Menu=エクスプレッションメニュー",
    "SteamVR=スチームブイアール",
    "Quest=クエスト",
    "PCVR=ピーシーブイアール",
    "Index=インデックス",
    "ベースステーション",
    "トラッカー",
    "フルトラ",
    "フルトラッキング",
    "BOOTH",
    "VRM=ブイアールエム",
    "Discord=ディスコード",
    "Vket=ブイケット",
    "集会=しゅうかい",
    "お砂糖=おさとう",
    "無言勢=むごんぜい",
    "Quest勢=くえすとぜい",
    "PC勢=ぴーしーぜい",
    "デスクトップ勢=ですくとっぷぜい",
    "改変=かいへん",
];

fn written_form(term: &str) -> &str {
    term.split_once('=').map_or(term, |(written, _)| written)
}

/// `merged_terms`: the user's terms (already normalized by the settings) first, then the
/// built-in ones, without a written form twice, at most [`MAX_TERMS`].
pub fn merged_terms(vocabulary: &Value) -> Vec<String> {
    let builtin = vocabulary["builtin"].as_bool().unwrap_or(true);
    let user = vocabulary["terms"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string);
    let built: Vec<String> = if builtin { VRCHAT_TERMS.iter().map(|t| t.to_string()).collect() } else { Vec::new() };
    let mut seen: Vec<String> = Vec::new();
    let mut result = Vec::new();
    for term in user.chain(built) {
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
    fn options_follow_what_the_model_takes() {
        let terms = vec!["VRChat=ブイチャ".to_string(), "集会".to_string()];
        assert_eq!(request_options(&["keywords".into()], &terms)["keywords"], json!(terms));
        assert_eq!(request_options(&["prompt".into()], &terms)["prompt"], "VRChat用語: VRChat、集会");
        assert!(request_options(&["language".into()], &terms).is_empty());
        assert!(request_options(&["keywords".into()], &[]).is_empty());
    }

    #[test]
    fn only_this_pc_over_plain_http() {
        assert_eq!(local_url("http://127.0.0.1:8080/").as_deref(), Some("http://127.0.0.1:8080"));
        assert_eq!(local_url("http://localhost:1"), Some("http://localhost:1".into()));
        assert_eq!(local_url("http://192.168.1.2:8080"), None);
        assert_eq!(local_url("https://127.0.0.1:8080"), None);
    }
}
