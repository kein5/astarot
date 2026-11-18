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

use super::{checked, join, json_of, Access, Api, Error, Provider, Translation, DISCOVERY, MACHINE_TRANSLATION};
use crate::http::{Request, Timeouts, Transport};
use serde_json::json;

pub const BASE_URL: &str = "https://translation.googleapis.com";

pub struct GoogleCloud;

impl Api for GoogleCloud {
    const PROVIDER: Provider = Provider::GoogleCloud;
    const ENGINE: &'static str = "Google_Cloud_API";
    const MODELS: bool = false;
    const TRANSLATE_WAIT: Timeouts = MACHINE_TRANSLATION;

    /// Checks a key with the language list.
    fn reach(transport: &Transport, a: &Access<'_>) -> Result<(), Error> {
        let url = join(a.base, "/language/translate/v2/languages");
        let request = Request::get(&url).header("x-goog-api-key", a.key);
        checked(transport(&request, DISCOVERY)?)?;
        Ok(())
    }

    fn translate(transport: &Transport, a: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        let url = join(a.base, "/language/translate/v2");
        let body = json!({ "q": [t.text], "source": t.source, "target": t.target, "format": "text" });
        Self::attempt(transport, a.base, |send, wait| {
            let request = Request::post_json(&url, &body).header("x-goog-api-key", a.key);
            let answer = json_of(&checked(send(&request, wait)?)?)?;
            answer["data"]["translations"][0]["translatedText"].as_str().map(str::to_string).ok_or(Error::Answer)
        })
    }
}
