//! Sends ASTAROT's usage events to ASTAROT's own receiver ([`client.py`]).
//!
//! Two events exist and the receiver takes no others: `app_started`, and `error` with its fixed
//! error code. Each carries the time (ISO 8601, UTC), the app's version, the OS and its
//! version, the display language, and the PC's CPU, memory and GPUs ([`super::hardware`]). No
//! text, audio, audio device or user names, paths or identifiers.
//!
//! [`build_event`] is the only place an event is put together: what the app shows the user as
//! "what is sent" and what is posted come from the same call, and differ only in the time.
//!
//! [`client.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/telemetry/client.py

use std::sync::Arc;
use std::time::Duration;

use jiff::Timestamp;
use rustls::ClientConfig;

use super::hardware::Hardware;
use crate::json::{Json, Object};
use crate::net;

/// The receiver (Cloudflare Workers).
pub const ENDPOINT: &str = "https://vrct-vox-telemetry.kei9d09.workers.dev/v1/events";
/// Marks a request as ASTAROT's. It is public and not a credential: it grants nothing but
/// posting these two events.
pub const INGEST_KEY: &str = "e77471acded45435be55c2fed04a05636e4eb00be5a277fb";
/// A developer's stand-in receiver on this PC. Only a loopback HTTP address is taken, so the
/// variable cannot send anyone's events to another host.
pub const ENDPOINT_OVERRIDE: &str = astarot_app_identity::env::TELEMETRY_URL;
pub const EVENTS: [&str; 2] = ["app_started", "error"];
/// The version of the event's shape. 1 had no "v" and no "hw".
pub const SCHEMA: u64 = 2;
pub const TIMEOUT: Duration = Duration::from_secs(5);
const ANSWER_LIMIT: usize = 4096;

#[derive(Clone, Debug, PartialEq)]
enum Scheme {
    Http,
    Https,
}

/// Where events go: HTTPS anywhere, or plain HTTP to a loopback address only.
#[derive(Clone, Debug, PartialEq)]
struct Target {
    scheme: Scheme,
    host: String,
    port: u16,
    path: String,
}

fn target(endpoint: &str) -> Option<Target> {
    if endpoint.is_empty() {
        return None;
    }
    let url = net::urlsplit(endpoint).ok()?;
    let port = url.port().ok()?;
    let user = url.username().is_some_and(|u| !u.is_empty());
    let password = url.password().is_some_and(|p| !p.is_empty());
    let host = url.hostname()?;
    if user || password || !url.query.is_empty() || !url.fragment.is_empty() || !url.path.starts_with('/') {
        return None;
    }
    match url.scheme.as_str() {
        "https" => Some(Target { scheme: Scheme::Https, host, port: port.unwrap_or(443), path: url.path }),
        "http" if is_loopback(&host) => Some(Target { scheme: Scheme::Http, host, port: port.unwrap_or(80), path: url.path }),
        _ => None,
    }
}

/// A literal loopback address (`ipaddress.ip_address(host).is_loopback`); a name is not one.
fn is_loopback(host: &str) -> bool {
    host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// The endpoint in use: the override when it is a loopback HTTP address, else [`ENDPOINT`].
pub fn endpoint_from_environment() -> String {
    match std::env::var(ENDPOINT_OVERRIDE) {
        Ok(value) if target(&value).is_some_and(|t| t.scheme == Scheme::Http) => value,
        _ => ENDPOINT.to_string(),
    }
}

/// The display language as the tag the receiver stores; anything else is English.
pub fn locale_tag(language: &str) -> &'static str {
    match language {
        "ja" => "ja-JP",
        _ => "en-US",
    }
}

/// `[\x20-\x7e]{1,64}`
fn printable(text: &str) -> bool {
    (1..=64).contains(&text.len()) && text.bytes().all(|b| (0x20..=0x7e).contains(&b))
}

/// `[A-Za-z0-9_.-]{1,64}`
pub fn valid_error_code(code: &str) -> bool {
    (1..=64).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
}

/// "Windows", "Linux" or "Other", and the OS version as Python's `platform` reports it.
pub fn os_and_version() -> (&'static str, Option<String>) {
    #[cfg(windows)]
    {
        ("Windows", windows_version())
    }
    #[cfg(target_os = "linux")]
    {
        ("Linux", linux_release())
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        ("Other", None)
    }
}

/// `platform.release()`: the kernel release of `uname`.
#[cfg(target_os = "linux")]
fn linux_release() -> Option<String> {
    let mut name: libc::utsname = unsafe { std::mem::zeroed() };
    if unsafe { libc::uname(&mut name) } != 0 {
        return None;
    }
    let release = unsafe { std::ffi::CStr::from_ptr(name.release.as_ptr()) };
    release.to_str().ok().map(str::to_string)
}

/// `platform.version()`: "major.minor.build".
#[cfg(windows)]
fn windows_version() -> Option<String> {
    use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;
    let mut info: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    if unsafe { RtlGetVersion(&mut info) } != 0 {
        return None;
    }
    Some(format!("{}.{}.{}", info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber))
}

/// What every event carries about where it came from.
pub fn system_properties(app_version: &str, language: &str, hardware: Option<&Hardware>) -> Object {
    let (os, version) = os_and_version();
    system_properties_for(app_version, language, hardware, os, version.as_deref())
}

pub(crate) fn system_properties_for(app_version: &str, language: &str, hardware: Option<&Hardware>, os: &str, os_version: Option<&str>) -> Object {
    let mut properties = Object::new()
        .with("app_version", if printable(app_version) { app_version } else { "unknown" })
        .with("os", os)
        .with("os_version", os_version.filter(|v| printable(v)).unwrap_or("unknown"))
        .with("locale", locale_tag(language));
    if let Some(hardware) = hardware.filter(|h| !h.is_empty()) {
        properties.insert("hw", hardware.to_json());
    }
    properties
}

/// The event as it is sent, or `None` for anything that is not one of the two. The timestamp
/// is ISO 8601 in UTC, to the second: the moment the event is put together.
pub fn build_event(name: &str, properties: &Object, error_code: Option<&str>, now: Option<Timestamp>) -> Option<Json> {
    if !EVENTS.contains(&name) {
        return None;
    }
    let stamp = now.unwrap_or_else(Timestamp::now).strftime("%Y-%m-%dT%H:%M:%SZ").to_string();
    let mut body = Object::new().with("event", name).with("v", SCHEMA).with("timestamp", stamp);
    for (key, value) in properties.iter() {
        body.insert(key, value.clone());
    }
    if name == "error" {
        let code = error_code.filter(|c| valid_error_code(c))?;
        body.insert("error_code", code);
    }
    Some(body.into())
}

/// One POST per event, never failing: a failure is only an event that was not sent.
pub struct IngestClient {
    target: Option<Target>,
    key: String,
    timeout: Duration,
    tls: Option<Arc<ClientConfig>>,
    properties: Option<Object>,
}

impl IngestClient {
    /// The client for the endpoint in use ([`endpoint_from_environment`]).
    pub fn new() -> Self {
        Self::with(&endpoint_from_environment(), INGEST_KEY, TIMEOUT)
    }

    pub fn with(endpoint: &str, key: &str, timeout: Duration) -> Self {
        IngestClient { target: target(endpoint), key: key.to_string(), timeout, tls: None, properties: None }
    }

    /// Builds the TLS settings on the caller's thread, before anything is sent.
    pub fn prepare(&mut self) {
        if self.target.as_ref().is_some_and(|t| t.scheme == Scheme::Https) && self.tls.is_none() {
            self.tls = Some(net::tls_config());
        }
    }

    /// Where events go, or `None` when nothing can be sent.
    pub fn endpoint(&self) -> Option<String> {
        let t = self.target.as_ref()?;
        let (scheme, default) = match t.scheme {
            Scheme::Https => ("https", 443),
            Scheme::Http => ("http", 80),
        };
        let host = if t.host.contains(':') { format!("[{}]", t.host) } else { t.host.clone() };
        let port = if t.port == default { String::new() } else { format!(":{}", t.port) };
        Some(format!("{scheme}://{host}{port}{}", t.path))
    }

    pub fn start(&mut self, app_version: &str, locale: &str, hardware: Option<&Hardware>) {
        self.properties = Some(system_properties(app_version, locale, hardware));
    }

    pub fn stop(&mut self) {
        self.properties = None;
    }

    pub fn started(&self) -> bool {
        self.properties.is_some()
    }

    /// The event as it is sent, or `None` before start, after stop, or for anything that is
    /// not one of the two events.
    pub fn event(&self, name: &str, error_code: Option<&str>) -> Option<Json> {
        build_event(name, self.properties.as_ref()?, error_code, None)
    }

    /// (the event as sent, whether the receiver accepted it); `(None, false)` when nothing was
    /// sent. Blocks for at most the time-out per network step.
    pub fn track(&self, name: &str, error_code: Option<&str>) -> (Option<Json>, bool) {
        let Some(body) = self.event(name, error_code) else { return (None, false) };
        if self.target.is_none() {
            return (None, false);
        }
        let accepted = self.post(&body);
        (Some(body), accepted)
    }

    /// A sender that can post without holding this client (the facade posts outside its lock).
    pub(crate) fn sender(&self) -> Option<Sender> {
        Some(Sender { target: self.target.clone()?, key: self.key.clone(), timeout: self.timeout, tls: self.tls.clone() })
    }

    fn post(&self, body: &Json) -> bool {
        self.sender().is_some_and(|s| s.post(body))
    }
}

impl Default for IngestClient {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) struct Sender {
    target: Target,
    key: String,
    timeout: Duration,
    tls: Option<Arc<ClientConfig>>,
}

impl Sender {
    /// Whether the receiver answered 200 `{"ok": true, "accepted": 1}`.
    pub fn post(&self, body: &Json) -> bool {
        let data = body.to_python_compact_ascii();
        let t = &self.target;
        let (tls, default) = match t.scheme {
            Scheme::Https => (Some(self.tls.clone().unwrap_or_else(net::tls_config)), 443),
            Scheme::Http => (None, 80),
        };
        let attempt = || -> std::io::Result<bool> {
            let (mut stream, _) = net::connect(&t.host, t.port, self.timeout, tls)?;
            let host = net::host_header(&t.host, t.port, default);
            let length = data.len().to_string();
            // http.client's own two headers, then ours: only what HTTP needs, the key and the name.
            let headers = [
                ("Host", host.as_str()),
                ("Accept-Encoding", "identity"),
                ("Content-Type", "application/json"),
                ("Content-Length", length.as_str()),
                ("X-Ingest-Key", self.key.as_str()),
                // The receiver does not read it (ADR-014, 8; checked against its source on 2026-11-20).
                ("User-Agent", "ASTAROT"),
            ];
            net::send_request(&mut stream, "POST", &t.path, &headers, data.as_bytes())?;
            let mut response = net::read_response(stream, "POST")?;
            let answer = response.body.read_up_to(ANSWER_LIMIT)?;
            if response.status != 200 {
                return Ok(false);
            }
            let Ok(reply) = serde_json::from_slice::<serde_json::Value>(&answer) else { return Ok(false) };
            // Python compared `accepted == 1`, which 1.0 and true also satisfy.
            let accepted = match reply.get("accepted") {
                Some(serde_json::Value::Bool(b)) => *b,
                Some(serde_json::Value::Number(n)) => n.as_f64() == Some(1.0),
                _ => false,
            };
            Ok(reply.get("ok") == Some(&serde_json::Value::Bool(true)) && accepted)
        };
        attempt().unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_go_over_https_or_to_this_pc_only() {
        for endpoint in [
            "",
            "http://example.com/v1/events",
            "http://localhost/v1/events",
            "ftp://127.0.0.1/v1/events",
            "https://user:secret@example.com/v1/events",
            "https://example.com/v1/events?key=1",
            "https://example.com",
            "not a url",
        ] {
            let client = IngestClient::with(endpoint, INGEST_KEY, TIMEOUT);
            assert_eq!(client.endpoint(), None, "{endpoint}");
        }
        assert_eq!(IngestClient::with(ENDPOINT, INGEST_KEY, TIMEOUT).endpoint().as_deref(), Some(ENDPOINT));
        assert_eq!(IngestClient::with("http://127.0.0.1:8799/v1/events", INGEST_KEY, TIMEOUT).endpoint().as_deref(), Some("http://127.0.0.1:8799/v1/events"));
        assert_eq!(IngestClient::with("http://[::1]:8799/v1", INGEST_KEY, TIMEOUT).endpoint().as_deref(), Some("http://[::1]:8799/v1"));
    }

    #[test]
    fn the_receiver_is_vrct_voxs_own_over_tls() {
        assert_eq!(ENDPOINT, "https://vrct-vox-telemetry.kei9d09.workers.dev/v1/events");
        assert!(INGEST_KEY.len() == 48 && INGEST_KEY.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
        let t = target(ENDPOINT).unwrap();
        assert_eq!((t.scheme, t.host.as_str(), t.port, t.path.as_str()), (Scheme::Https, "vrct-vox-telemetry.kei9d09.workers.dev", 443, "/v1/events"));
    }

    #[test]
    fn the_display_language_travels_as_one_of_its_tags() {
        assert_eq!(["en", "ja", "ko", "", "fr"].map(locale_tag), ["en-US", "ja-JP", "en-US", "en-US", "en-US"]);
        let properties = system_properties_for("0.1.0-beta.7", "ja", None, "Linux", Some("6.1.0"));
        assert_eq!(properties.keys().collect::<Vec<_>>(), ["app_version", "os", "os_version", "locale"]);
        assert_eq!(system_properties_for("バージョン", "ja", None, "Linux", None).get("app_version"), Some(&Json::from("unknown")));
        assert_eq!(system_properties_for("1.0", "ja", None, "Linux", Some("bad\u{7f}")).get("os_version"), Some(&Json::from("unknown")));
        assert!(system_properties_for("1.0", "ja", Some(&Hardware::default()), "Linux", None).get("hw").is_none());
    }

    #[test]
    fn once_a_day_means_the_day_of_the_events_timestamp() {
        let moment: Timestamp = "2026-11-14T08:30:05+09:00".parse().unwrap();
        let event = build_event("app_started", &system_properties("1.0", "ja", None), None, Some(moment)).unwrap();
        assert_eq!(event.get("timestamp"), Some(&Json::from("2026-11-13T23:30:05Z")));
    }

    #[test]
    fn anything_but_the_two_events_is_not_built() {
        let properties = system_properties("1.0", "en", None);
        for (name, code) in [
            ("error", None),
            ("error", Some("")),
            ("error", Some("has space")),
            ("error", Some("C:\\Users\\someone")),
            ("error", Some(&*"x".repeat(65))),
            ("message_sent", None),
            ("app_closed", None),
            ("", None),
        ] {
            assert_eq!(build_event(name, &properties, code, None), None, "{name} {code:?}");
        }
        let event = build_event("error", &properties, Some("speech_server.device-failed"), None).unwrap();
        assert_eq!(event.as_object().unwrap().keys().collect::<Vec<_>>(), ["event", "v", "timestamp", "app_version", "os", "os_version", "locale", "error_code"]);
        // The app_started event carries no error code even when one is passed.
        assert!(build_event("app_started", &properties, Some("X"), None).unwrap().get("error_code").is_none());
    }
}
