//! NAVER Cloud Platform Papago Translation, with the user's Client ID and Client Secret. New in
//! the core. It is not the old NAVER Developers Papago API, nor the web translator of upstream
//! VRCT.
//!
//! - Reference: <https://api.ncloud-docs.com/docs/en/ai-naver-papagonmt-translation> (request,
//!   languages and pairs, 5,000 characters per call) and
//!   <https://api.ncloud-docs.com/docs/en/ai-naver-papagonmt> (error codes);
//!   <https://api.ncloud-docs.com/docs/en/common-naverapi-naverapi> (gateway errors: 401 code
//!   200 "Authentication Failed", 401 code 210 "Permission Denied").
//! - `POST /nmt/v1/translation` with `source`, `target` and `text` as JSON. The Client ID goes in
//!   `X-NCP-APIGW-API-KEY-ID` and the secret in `X-NCP-APIGW-API-KEY`.
//! - A key is checked without translating anything: a request with an empty text. The API
//!   gateway checks the credentials first and answers 401 (or 429 when the application has no
//!   Papago) for a refused pair; credentials it lets through reach Papago, which refuses the
//!   empty text with a 400 and its own `N2MT…` code. So 200, or 400 with an `N2MT` code, counts
//!   as accepted. This has not been tried against the real service.
//! - Only some pairs translate directly ([`supports`]); the others count as unsupported, and the
//!   core then falls back as for any engine without the languages.

use super::{checked, join, json_of, retry_once, Error, DISCOVERY, MACHINE_TRANSLATION};
use crate::http::{Request, Transport};
use serde_json::{json, Value};

pub const BASE_URL: &str = "https://papago.apigw.ntruss.com";

/// The pairs Papago translates, both ways (the "Supported language pairs" of the reference).
const PAIRS: &[(&str, &[&str])] = &[
    ("ko", &["en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "fr", "es", "ru", "de", "it"]),
    ("en", &["ja", "zh-CN", "zh-TW", "vi", "th", "id", "fr", "es", "ru", "de"]),
    ("ja", &["zh-CN", "zh-TW", "vi", "th", "id", "fr"]),
    ("zh-CN", &["zh-TW"]),
];

/// Whether Papago translates from `source` to `target` (codes of the language table).
pub fn supports(source: &str, target: &str) -> bool {
    PAIRS.iter().any(|(one, others)| {
        (*one == source && others.contains(&target)) || (*one == target && others.contains(&source))
    })
}

fn request<'a>(url: &'a str, client_id: &str, secret: &str, body: &Value) -> Request<'a> {
    Request::post_json(url, body)
        .header("X-NCP-APIGW-API-KEY-ID", client_id)
        .header("X-NCP-APIGW-API-KEY", secret)
}

/// Papago's own error code (`N2MT…`) in an answer, in either shape the references show.
fn papago_code(body: &Value) -> Option<&str> {
    body["error"]["errorCode"].as_str().or_else(|| body["errorCode"].as_str())
}

/// Checks a Client ID and secret.
pub fn check(transport: &Transport, base: &str, client_id: &str, secret: &str) -> Result<(), Error> {
    let url = join(base, "/nmt/v1/translation");
    let body = json!({ "source": "ko", "target": "en", "text": "" });
    let response = transport(&request(&url, client_id, secret, &body), DISCOVERY)?;
    let reached_papago =
        response.status == 400 && response.json().as_ref().and_then(papago_code).is_some_and(|c| c.starts_with("N2MT"));
    if response.ok() || reached_papago { Ok(()) } else { Err(Error::Status(response.status)) }
}

/// Translates one text; codes as the language table gives them.
pub fn translate(
    transport: &Transport,
    base: &str,
    client_id: &str,
    secret: &str,
    text: &str,
    source: &str,
    target: &str,
) -> Result<String, Error> {
    if !supports(source, target) {
        return Err(Error::UnsupportedPair);
    }
    let url = join(base, "/nmt/v1/translation");
    let body = json!({ "source": source, "target": target, "text": text });
    retry_once(|| {
        let answer = json_of(&checked(transport(&request(&url, client_id, secret, &body), MACHINE_TRANSLATION)?)?)?;
        answer["message"]["result"]["translatedText"].as_str().map(str::to_string).ok_or(Error::Answer)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_listed_pairs_translate() {
        assert!(supports("ja", "ko") && supports("ko", "ja"));
        assert!(supports("en", "de") && supports("zh-TW", "zh-CN"));
        assert!(!supports("en", "it"), "Italian only with Korean");
        assert!(!supports("ja", "es"));
        assert!(!supports("ja", "ja"));
    }
}
