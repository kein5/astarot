//! Which API URLs the user may save ([`src-python/models/network_policy.py`]).
//!
//! The check is local: no DNS and no request. Plain HTTP is allowed only to this PC and the LAN
//! ([`is_local_host`]: `localhost`, loopback, the private IPv4 ranges, link-local, IPv6 unique
//! local addresses and `.local` names); everything else needs HTTPS. A URL may not carry user
//! info, a fragment, a backslash, port 0 or a query parameter whose name looks like a secret.
//! When it connects, the HTTP client of `astarot_translation` also refuses plain HTTP to a name
//! that resolves outside this PC and the LAN.
//!
//! [`src-python/models/network_policy.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/network_policy.py

/// The saved URLs checked when the settings are read.
pub const CUSTOM_URL_KEYS: [&str; 4] = ["LMSTUDIO_URL", "OLLAMA_URL", "OPENAI_COMPATIBLE_URL", "TRANSCRIPTION_CUSTOM_URL"];

/// The rule of the HTTP client, so that a URL saved here is one it will use.
pub fn is_local_host(host: &str) -> bool {
    astarot_translation::http::is_local_host(host)
}

/// The parts of a URL as `urllib.parse.urlsplit` gives them.
struct Split<'a> {
    scheme: String,
    netloc: &'a str,
    query: &'a str,
    fragment: &'a str,
}

fn urlsplit(url: &str) -> Option<Split<'_>> {
    let colon = url.find(':')?;
    let scheme = &url[..colon];
    let valid_scheme = scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    if !valid_scheme {
        return None;
    }
    let rest = &url[colon + 1..];
    let (netloc, after) = match rest.strip_prefix("//") {
        Some(rest) => {
            let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
            (&rest[..end], &rest[end..])
        }
        None => ("", rest),
    };
    if netloc.contains('[') != netloc.contains(']') {
        return None;
    }
    let (after, fragment) = after.split_once('#').unwrap_or((after, ""));
    let (_, query) = after.split_once('?').unwrap_or((after, ""));
    Some(Split { scheme: scheme.to_ascii_lowercase(), netloc, query, fragment })
}

/// `hostname` and `port` of a netloc without user info; `Err` where Python raises.
fn host_and_port(hostinfo: &str) -> Result<(String, Option<u32>), ()> {
    let (host, port) = if let Some(bracketed) = hostinfo.strip_prefix('[') {
        let (host, after) = bracketed.split_once(']').ok_or(())?;
        (host, after.strip_prefix(':'))
    } else {
        match hostinfo.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (hostinfo, None),
        }
    };
    let port = match port {
        None | Some("") => None,
        Some(text) => {
            if !text.chars().all(|c| c.is_ascii_digit()) {
                return Err(());
            }
            let value: u32 = text.parse().map_err(|_| ())?;
            if value > 65535 {
                return Err(());
            }
            Some(value)
        }
    };
    Ok((host.to_lowercase(), port))
}

fn percent_decode(text: &str) -> String {
    let bytes = text.replace('+', " ").into_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(byte) = hex {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

const SECRET_WORDS: [&str; 7] = ["key", "token", "secret", "password", "auth", "credential", "signature"];

/// `validate_api_url`. `allow_empty` accepts `""` (no URL saved).
pub fn validate_api_url(url: &str, allow_empty: bool) -> Result<(), &'static str> {
    const INVALID: &str = "endpoint_url_invalid";
    if allow_empty && url.is_empty() {
        return Ok(());
    }
    if url.is_empty() || url.chars().any(|c| c.is_whitespace() || (c as u32) < 32) {
        return Err(INVALID);
    }
    let parts = urlsplit(url).ok_or(INVALID)?;
    if parts.scheme != "http" && parts.scheme != "https" {
        return Err(INVALID);
    }
    if parts.netloc.contains('@') || !parts.fragment.is_empty() || url.contains('\\') {
        return Err(INVALID);
    }
    let (host, port) = host_and_port(parts.netloc).map_err(|_| INVALID)?;
    if host.is_empty() || port == Some(0) {
        return Err(INVALID);
    }
    if parts.scheme == "http" && !is_local_host(&host) {
        return Err(INVALID);
    }
    for field in parts.query.split('&').filter(|f| !f.is_empty()) {
        let key = percent_decode(field.split_once('=').map_or(field, |(k, _)| k));
        let normalized: String = key.to_lowercase().chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect();
        if SECRET_WORDS.iter().any(|word| normalized.contains(word)) || normalized == "sig" || normalized == "code" {
            return Err(INVALID);
        }
    }
    Ok(())
}

/// Whether a URL points at the user's own machine (`localhost` or a loopback address). A check
/// sent there leaves nothing on the network, so the start-up may run it for every engine (#457).
pub fn is_loopback_url(url: &str) -> bool {
    let Some(parts) = urlsplit(url) else { return false };
    let Ok((host, _)) = host_and_port(parts.netloc) else { return false };
    let host = host.trim_end_matches('.');
    if host == "localhost" {
        return true;
    }
    host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// `valid_saved_api_url`: a URL that may stay in the settings, or `""`.
pub fn valid_saved_api_url(value: &serde_json::Value) -> bool {
    value.as_str().is_some_and(|url| validate_api_url(url, true).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_the_python_rules() {
        for ok in [
            "", "https://api.openai.com/v1", "http://127.0.0.1:1234/v1", "http://localhost:11434", "http://192.168.1.20:1234/v1",
            "http://[::1]:8080/v1", "https://api.example.com/v1?model=x", "http://LOCALHOST./v1", "http://10.1.2.3",
            "http://studio.local:1234/v1", "http://[fd00::5]:11434", "http://169.254.10.2:8080",
        ] {
            assert!(validate_api_url(ok, true).is_ok(), "{ok}");
        }
        for bad in [
            "http://example.com/v1", "https://user:pw@api.example.com/v1", "https://api.example.com/v1?api_key=x",
            "https://api.example.com/v1#frag", "ftp://x", "https://api.example.com:0/v1", "https://a b", "https://a\\b",
            "https://api.example.com/v1?Access-Token=1", "https://x/?sig=1", "https://x/?code=1", "https:///v1",
            "https://[::1/v1", "https://api.example.com:99999/", "https://api.example.com:12a/", "http://172.32.0.1",
            "http://100.64.0.1:11434", "http://studio.local.example.com/v1", "http://[2001:db8::1]:1234",
        ] {
            assert!(validate_api_url(bad, true).is_err(), "{bad}");
        }
        assert!(validate_api_url("", false).is_err());
    }

    #[test]
    fn tells_a_loopback_url() {
        for local in ["http://127.0.0.1:1234/v1", "http://localhost:11434", "http://LOCALHOST./v1", "http://[::1]:8080/v1", "http://127.8.0.1"] {
            assert!(is_loopback_url(local), "{local}");
        }
        for remote in ["http://192.168.1.20:1234/v1", "https://api.openai.com/v1", "http://studio.local:1234", "", "localhost"] {
            assert!(!is_loopback_url(remote), "{remote}");
        }
    }
}
