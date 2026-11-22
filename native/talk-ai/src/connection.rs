//! Opening the WebSocket to a conversation service.
//!
//! `wss://` goes over TLS with the Mozilla roots, through the system proxy when one is set;
//! `ws://` only to this PC and the LAN (vLLM-Omni on the user's own machine), as the translation
//! providers' requests do (`astarot_translation::http`). The key goes only in the `Authorization`
//! header. No error carries the URL, a header or a body.

use std::fmt;
use std::time::Duration;
use tungstenite::client::IntoClientRequest;
use tungstenite::http::HeaderValue;
use tungstenite::protocol::WebSocketConfig;
use tungstenite::{HandshakeError, WebSocket};
use astarot_translation::http::{self, Cancel, HttpError, Stream, Timeouts, Url};

/// The most one event from the service may hold: an answer's audio comes in small parts.
const MAX_EVENT: usize = 16 * 1024 * 1024;

/// A service's API key. It shows nowhere but in the `Authorization` header.
#[derive(Clone, PartialEq, Eq)]
pub struct Key(String);

impl Key {
    pub fn new(key: impl Into<String>) -> Key {
        Key(key.into())
    }
}

impl fmt::Debug for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Key(..)")
    }
}

/// Where the conversation goes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Service {
    /// `wss://api.openai.com/v1/realtime`, or `ws://<this PC or the LAN>:<port>/v1/realtime` for
    /// vLLM-Omni.
    pub url: String,
    /// Sent as `?model=`. `None` leaves it to the server: vLLM-Omni serves one model, and refuses
    /// a name that is not its own.
    pub model: Option<String>,
    /// Sent as `Authorization: Bearer`. vLLM-Omni may need none.
    pub key: Option<Key>,
}

/// How the connection reaches the service.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Network {
    /// Through the proxy the environment or Windows' Internet Settings name (`wss://` only).
    SystemProxy,
    /// Without a proxy.
    Direct,
    /// Only to this PC, without a look-up of any other name: for tests, so that no key reaches a
    /// real service.
    LoopbackOnly,
}

/// Why the connection could not be opened.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenError {
    /// Not a `ws://` or `wss://` URL, or `ws://` outside this PC and the LAN.
    Url,
    /// Nothing answered, or the proxy refused the tunnel.
    Unreachable,
    /// The service refused the key (401, 403).
    KeyRefused,
    /// No realtime endpoint at that path (404).
    NotFound,
    /// The service answered the handshake with another status, or not as a WebSocket.
    Refused,
    /// The connection broke or timed out during the handshake.
    Broken,
    Cancelled,
}

impl OpenError {
    pub fn code(self) -> &'static str {
        match self {
            OpenError::Url => "talk_url_invalid",
            OpenError::Unreachable => "talk_unreachable",
            OpenError::KeyRefused => "talk_key_refused",
            OpenError::NotFound => "talk_endpoint_not_found",
            OpenError::Refused => "talk_handshake_refused",
            OpenError::Broken => "talk_connection_broken",
            OpenError::Cancelled => "talk_cancelled",
        }
    }
}

pub type Socket = WebSocket<Stream>;

/// The URL as the HTTP client reads it (`ws` as `http`), and the WebSocket target with the model.
fn targets(service: &Service) -> Result<(Url, String), OpenError> {
    let (scheme, rest) = service.url.split_once("://").ok_or(OpenError::Url)?;
    let http_scheme = match scheme.to_ascii_lowercase().as_str() {
        "ws" => "http",
        "wss" => "https",
        _ => return Err(OpenError::Url),
    };
    let url = Url::parse(&format!("{http_scheme}://{rest}")).map_err(|_| OpenError::Url)?;
    let mut target = format!("{}://{}", scheme.to_ascii_lowercase(), rest);
    if let Some(model) = &service.model {
        target.push(if target.contains('?') { '&' } else { '?' });
        target.push_str("model=");
        target.push_str(&percent(model));
    }
    Ok((url, target))
}

fn percent(text: &str) -> String {
    text.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

fn is_loopback(host: &str) -> bool {
    host == "localhost" || host.trim_start_matches('[').trim_end_matches(']').parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Opens the WebSocket. Connecting, the TLS handshake and the WebSocket handshake each wait at
/// most `wait` for the service; `cancel` gives them up within about 20 ms. The socket's reads
/// then wait at most `poll`, so that a thread can read and send in turn.
pub fn open(service: &Service, network: Network, wait: Duration, poll: Duration, cancel: &Cancel) -> Result<Socket, OpenError> {
    let (url, target) = targets(service)?;
    if network == Network::LoopbackOnly && !is_loopback(&url.host) {
        return Err(OpenError::Unreachable);
    }
    let proxy = match network {
        Network::SystemProxy => http::system_proxy_for(&url),
        Network::Direct | Network::LoopbackOnly => None,
    };
    let timeouts = Timeouts { connect: wait, read: wait, write: wait };
    let stream = http::open_stream(&url, timeouts, Some(cancel), proxy.as_ref()).map_err(|error| match error {
        HttpError::Cancelled => OpenError::Cancelled,
        HttpError::Url => OpenError::Url,
        _ => OpenError::Unreachable,
    })?;
    let mut request = target.into_client_request().map_err(|_| OpenError::Url)?;
    if let Some(Key(key)) = &service.key {
        let mut value = HeaderValue::from_str(&format!("Bearer {key}")).map_err(|_| OpenError::KeyRefused)?;
        value.set_sensitive(true);
        request.headers_mut().insert("Authorization", value);
    }
    request.headers_mut().insert("User-Agent", HeaderValue::from_static("ASTAROT"));
    let config = WebSocketConfig::default().max_message_size(Some(MAX_EVENT)).max_frame_size(Some(MAX_EVENT));
    let (mut socket, _) = tungstenite::client::client_with_config(request, stream, Some(config)).map_err(|error| match error {
        _ if cancel.is_cancelled() => OpenError::Cancelled,
        HandshakeError::Failure(tungstenite::Error::Http(response)) => match response.status().as_u16() {
            401 | 403 => OpenError::KeyRefused,
            404 => OpenError::NotFound,
            _ => OpenError::Refused,
        },
        HandshakeError::Failure(tungstenite::Error::Io(_)) | HandshakeError::Interrupted(_) => OpenError::Broken,
        HandshakeError::Failure(_) => OpenError::Refused,
    })?;
    socket.get_mut().set_read_limit(Some(poll)).map_err(|_| OpenError::Broken)?;
    Ok(socket)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(url: &str, model: Option<&str>) -> Service {
        Service { url: url.into(), model: model.map(str::to_string), key: Some(Key::new("sk-secret")) }
    }

    #[test]
    fn the_model_goes_in_the_query_and_only_websocket_urls_are_taken() {
        let (url, target) = targets(&service("wss://api.openai.com/v1/realtime", Some("gpt-realtime"))).unwrap();
        assert!(url.tls);
        assert_eq!((url.host.as_str(), url.port), ("api.openai.com", 443));
        assert_eq!(target, "wss://api.openai.com/v1/realtime?model=gpt-realtime");
        let (url, target) = targets(&service("ws://192.168.1.20:8000/v1/realtime?duplex=0", Some("Qwen/Qwen3 Omni"))).unwrap();
        assert!(!url.tls);
        assert_eq!(target, "ws://192.168.1.20:8000/v1/realtime?duplex=0&model=Qwen%2FQwen3%20Omni");
        assert_eq!(targets(&service("https://api.openai.com/v1/realtime", None)).unwrap_err(), OpenError::Url);
        assert_eq!(targets(&service("api.openai.com", None)).unwrap_err(), OpenError::Url);
    }

    #[test]
    fn plain_websocket_stays_on_this_pc_and_the_lan() {
        let cancel = Cancel::new();
        let wait = Duration::from_millis(200);
        let outside = service("ws://8.8.8.8:80/v1/realtime", None);
        assert_eq!(open(&outside, Network::Direct, wait, wait, &cancel).err(), Some(OpenError::Url));
    }

    #[test]
    fn tests_never_reach_a_real_service() {
        let cancel = Cancel::new();
        let wait = Duration::from_millis(200);
        let real = service("wss://api.openai.com/v1/realtime", Some("gpt-realtime"));
        assert_eq!(open(&real, Network::LoopbackOnly, wait, wait, &cancel).err(), Some(OpenError::Unreachable));
    }

    #[test]
    fn the_key_shows_nowhere_but_in_its_header() {
        let shown = format!("{:?}", service("wss://api.openai.com/v1/realtime", None));
        assert!(!shown.contains("sk-secret"), "{shown}");
        assert!(shown.contains("Key(..)"));
    }
}
