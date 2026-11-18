//! DeepL API (`translation_translator.py`'s DeepL branch and `authenticationDeepLAuthKey`).
//!
//! A key ending in `:fx` belongs to the free API. A key is checked by translating `" "` to
//! `EN-US`. The codes are sent in capitals. Every request asks for `show_billed_characters`, as
//! the DeepL SDK of the Python client did (the answer then also says how many characters were
//! billed; nothing reads it).

use super::{checked, join, json_of, Access, Api, Error, Provider, Translation, DISCOVERY, MACHINE_TRANSLATION};
use crate::http::{Request, Timeouts, Transport};
use serde_json::json;

pub struct DeepL;

pub const BASE_URL: &str = "https://api.deepl.com";
pub const FREE_BASE_URL: &str = "https://api-free.deepl.com";

/// The address of a key: the free API for `:fx` keys.
pub fn base_url<'a>(paid: &'a str, free: &'a str, key: &str) -> &'a str {
    if key.ends_with(":fx") {
        free
    } else {
        paid
    }
}

fn request<'a>(url: &'a str, key: &str, body: &serde_json::Value) -> Request<'a> {
    Request::post_json(url, body).header("Authorization", format!("DeepL-Auth-Key {key}"))
}

impl Api for DeepL {
    const PROVIDER: Provider = Provider::DeepL;
    const ENGINE: &'static str = "DeepL_API";
    const MODELS: bool = false;
    const TRANSLATE_WAIT: Timeouts = MACHINE_TRANSLATION;

    /// The DeepL SDK's rule: a connection that failed or timed out, 429 and 5xx (not 408 or 409).
    fn retry(error: Error) -> bool {
        error.retryable_with(|status| status == 429 || status >= 500)
    }

    /// Checks a key by translating `" "`.
    fn reach(transport: &Transport, a: &Access<'_>) -> Result<(), Error> {
        let url = join(a.base, "/v2/translate");
        let body = json!({ "target_lang": "EN-US", "text": [" "], "show_billed_characters": true });
        checked(transport(&request(&url, a.key, &body), DISCOVERY)?)?;
        Ok(())
    }

    fn translate(transport: &Transport, a: &Access<'_>, t: &Translation<'_>) -> Result<String, Error> {
        let url = join(a.base, "/v2/translate");
        let body = json!({
            "target_lang": t.target.to_uppercase(),
            "source_lang": t.source.to_uppercase(),
            "text": [t.text],
            "show_billed_characters": true,
        });
        Self::attempt(a.base, |wait| {
            let response = checked(transport(&request(&url, a.key, &body), wait)?)?;
            let body = json_of(&response)?;
            body["translations"][0]["text"].as_str().map(str::to_string).ok_or(Error::Answer)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_keys_go_to_the_free_api() {
        assert_eq!(base_url(BASE_URL, FREE_BASE_URL, "abc:fx"), "https://api-free.deepl.com");
        assert_eq!(base_url(BASE_URL, FREE_BASE_URL, "abc"), "https://api.deepl.com");
    }
}
