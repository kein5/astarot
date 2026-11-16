//! DeepL API (`translation_translator.py`'s DeepL branch and `authenticationDeepLAuthKey`).
//!
//! A key ending in `:fx` belongs to the free API. A key is checked by translating `" "` to
//! `EN-US`. The codes are sent in capitals.

use super::{checked, join, json_of, retry_once, Error, DISCOVERY, MACHINE_TRANSLATION};
use crate::http::{Request, Transport};
use serde_json::json;

pub const BASE_URL: &str = "https://api.deepl.com";
pub const FREE_BASE_URL: &str = "https://api-free.deepl.com";

/// The address of a key: the free API for `:fx` keys.
pub fn base_url<'a>(paid: &'a str, free: &'a str, key: &str) -> &'a str {
    if key.ends_with(":fx") { free } else { paid }
}

fn request<'a>(url: &'a str, key: &str, body: &serde_json::Value) -> Request<'a> {
    Request::post_json(url, body).header("Authorization", format!("DeepL-Auth-Key {key}"))
}

/// Checks a key.
pub fn check(transport: &Transport, base: &str, key: &str) -> Result<(), Error> {
    let url = join(base, "/v2/translate");
    let body = json!({ "text": [" "], "target_lang": "EN-US" });
    checked(transport(&request(&url, key, &body), DISCOVERY)?)?;
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
    let url = join(base, "/v2/translate");
    let body = json!({ "text": [text], "source_lang": source.to_uppercase(), "target_lang": target.to_uppercase() });
    retry_once(|| {
        let response = checked(transport(&request(&url, key, &body), MACHINE_TRANSLATION)?)?;
        let body = json_of(&response)?;
        body["translations"][0]["text"].as_str().map(str::to_string).ok_or(Error::Answer)
    })
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
