//! Google Cloud Translation, Basic edition (v2), with the user's API key. New in the core; the
//! web translator of upstream VRCT is a different thing and is not used.
//!
//! - Reference: <https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate> and
//!   <https://docs.cloud.google.com/translate/docs/reference/rest/v2/languages>.
//! - The key goes in the `x-goog-api-key` header, never in the URL
//!   (<https://docs.cloud.google.com/docs/authentication/api-keys-use>).
//! - A key is checked with `GET /language/translate/v2/languages`, which translates nothing.
//! - Translation is `POST /language/translate/v2` with `q`, `source`, `target` and
//!   `format: "text"` (the default `html` would escape the reply), and one retry. The codes are
//!   those of the language table (`Google_Cloud_API`, the same codes as Google's list).
//! - The Advanced edition (v3) needs a service account or OAuth and is not used.

use super::{checked, join, json_of, retry_once, Error, DISCOVERY, MACHINE_TRANSLATION};
use crate::http::{Request, Transport};
use serde_json::json;

pub const BASE_URL: &str = "https://translation.googleapis.com";

/// Checks a key.
pub fn check(transport: &Transport, base: &str, key: &str) -> Result<(), Error> {
    let url = join(base, "/language/translate/v2/languages");
    let request = Request::get(&url).header("x-goog-api-key", key);
    checked(transport(&request, DISCOVERY)?)?;
    Ok(())
}

/// Translates one text; codes as the language table gives them.
pub fn translate(
    transport: &Transport,
    base: &str,
    key: &str,
    text: &str,
    source: &str,
    target: &str,
) -> Result<String, Error> {
    let url = join(base, "/language/translate/v2");
    let body = json!({ "q": [text], "source": source, "target": target, "format": "text" });
    retry_once(|| {
        let request = Request::post_json(&url, &body).header("x-goog-api-key", key);
        let answer = json_of(&checked(transport(&request, MACHINE_TRANSLATION)?)?)?;
        answer["data"]["translations"][0]["translatedText"].as_str().map(str::to_string).ok_or(Error::Answer)
    })
}
