//! A small blocking HTTP/1.1 client for the provider APIs.
//!
//! One request per connection (`Connection: close`), no redirects, no cookies. Plain HTTP is
//! allowed only to a local address (as `models/network_policy.py` allows it); everything else
//! goes over TLS with the Mozilla roots. No proxy is used, except by [`system_proxy`], which
//! speech recognition uses ([`crate::proxy`]). Errors carry a fixed kind, never the URL, a header
//! or a body: the URL of a provider may carry a key in Python's SDKs, and the bodies carry the
//! user's text.
//!
//! A request given a [`Cancel`] ends within about 20 ms of its cancel, whether it is connecting
//! or waiting for the answer (decision 81 in `docs/voice-stack/core-integration.md`).

use crate::proxy::Proxy;
use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, StreamOwned};
use std::io::{self, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, mpsc};
use std::time::{Duration, Instant};

/// The most a response body may have. A model list or a translation is far smaller.
const MAX_BODY: usize = 16 * 1024 * 1024;

/// How often a cancellable wait looks at its [`Cancel`].
const POLL: Duration = Duration::from_millis(20);

/// Stops the requests and connections it is given, as the `CancelToken` that Python's
/// `SpeechCppASR._request` registered its socket with: a connection being made is given up, and a
/// read waiting for the peer ends, within about 20 ms. Clones share it; a cancel is final.
///
/// Reads wait in slices of 20 ms and look at the cancel between them, as `native/tts/src/http.rs`
/// does, instead of relying on a socket shut down from another thread to wake them: Winsock does
/// not promise that. The standard library has no connection that can be given up, so a
/// connection is made on a thread of its own; one that is given up ends there by its own timeout,
/// and is closed if it is made.
#[derive(Clone, Debug, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn new() -> Cancel {
        Cancel::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    /// Runs `work` on a thread of its own and waits for it; `None` when this is cancelled first,
    /// or when no thread could be started. What `work` gives after a cancel is dropped there.
    fn run<T: Send + 'static>(&self, work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        if self.is_cancelled() {
            return None;
        }
        let (sender, receiver) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("cancellable-connect".into())
            .spawn(move || {
                let _ = sender.send(work());
            })
            .ok()?;
        loop {
            match receiver.recv_timeout(POLL) {
                Ok(value) => return Some(value),
                Err(mpsc::RecvTimeoutError::Timeout) if !self.is_cancelled() => {}
                Err(_) => return None,
            }
        }
    }

    /// [`TcpStream::connect_timeout`], given up when cancelled (then `ConnectionAborted`).
    pub fn connect(&self, address: SocketAddr, timeout: Duration) -> io::Result<TcpStream> {
        self.run(move || TcpStream::connect_timeout(&address, timeout)).unwrap_or_else(|| Err(cancelled()))
    }
}

/// The error of a read or a connection a [`Cancel`] ended.
fn cancelled() -> io::Error {
    io::Error::new(io::ErrorKind::ConnectionAborted, "cancelled")
}

/// A connected TCP stream whose reads a [`Cancel`] can end. With a cancel, each read waits at
/// most `limit`, in slices of 20 ms, and fails with `ConnectionAborted` once cancelled; the
/// stream must stay blocking then. Without one it reads as the stream does, with the stream's
/// own read timeout. Writes are the stream's.
#[derive(Debug)]
pub struct Watched {
    stream: TcpStream,
    cancel: Option<Cancel>,
    limit: Option<Duration>,
}

impl Watched {
    /// `limit` is how long one read may wait; `None` waits without end.
    pub fn new(stream: TcpStream, cancel: Option<Cancel>, limit: Option<Duration>) -> Watched {
        Watched { stream, cancel, limit }
    }

    /// From now on the reads are the stream's own, with `limit` as its read timeout: the cancel
    /// no longer ends them.
    pub fn release(&mut self) -> io::Result<()> {
        self.cancel = None;
        self.stream.set_read_timeout(self.limit)
    }
}

impl std::ops::Deref for Watched {
    type Target = TcpStream;

    fn deref(&self) -> &TcpStream {
        &self.stream
    }
}

impl std::ops::DerefMut for Watched {
    fn deref_mut(&mut self) -> &mut TcpStream {
        &mut self.stream
    }
}

impl Read for Watched {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let Some(cancel) = &self.cancel else { return self.stream.read(buf) };
        let deadline = self.limit.map(|limit| Instant::now() + limit);
        loop {
            if cancel.is_cancelled() {
                return Err(cancelled());
            }
            let wait = match deadline {
                None => POLL,
                Some(deadline) => {
                    let left = deadline.saturating_duration_since(Instant::now());
                    if left.is_zero() {
                        return Err(io::ErrorKind::TimedOut.into());
                    }
                    left.min(POLL)
                }
            };
            self.stream.set_read_timeout(Some(wait))?;
            match self.stream.read(buf) {
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut | io::ErrorKind::Interrupted
                    ) => {}
                other => return other,
            }
        }
    }
}

impl Write for Watched {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.stream.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.stream.flush()
    }
}

/// How long each step may take.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Timeouts {
    pub connect: Duration,
    /// Each read (not the whole answer): a peer that keeps sending keeps the request alive,
    /// as httpx's read timeout does.
    pub read: Duration,
    pub write: Duration,
}

impl Timeouts {
    pub const fn all(seconds: f64) -> Timeouts {
        let d = Duration::from_millis((seconds * 1000.0) as u64);
        Timeouts { connect: d, read: d, write: d }
    }
}

/// Why a request failed. Nothing of the request is in it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HttpError {
    /// The URL could not be used (scheme, host, plain HTTP to a public host).
    Url,
    /// Nothing answered: the connection was refused or no address was found.
    Unreachable,
    Timeout,
    /// The connection broke or TLS failed.
    Io,
    /// The answer was not HTTP, or too large.
    Protocol,
    /// The request's [`Cancel`] ended it.
    Cancelled,
}

impl HttpError {
    pub fn code(self) -> &'static str {
        match self {
            HttpError::Url => "url_refused",
            HttpError::Unreachable => "unreachable",
            HttpError::Timeout => "timeout",
            HttpError::Io => "connection_failed",
            HttpError::Protocol => "protocol_error",
            HttpError::Cancelled => "cancelled",
        }
    }
}

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for HttpError {}

fn from_io(error: &io::Error) -> HttpError {
    match error.kind() {
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => HttpError::Timeout,
        _ => HttpError::Io,
    }
}

/// An answer: the status, the headers (names in lower case) and the body (chunks joined).
#[derive(Clone, Debug, Default)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    /// An answer without headers.
    pub fn new(status: u16, body: Vec<u8>) -> Response {
        Response { status, headers: Vec::new(), body }
    }

    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn json(&self) -> Option<serde_json::Value> {
        serde_json::from_slice(&self.body).ok()
    }

    /// The first header of that name (any case).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// The parts of an absolute URL.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Url {
    pub tls: bool,
    pub host: String,
    pub port: u16,
    /// The path and query, starting with `/`.
    pub target: String,
}

/// Whether an address is this PC or the LAN: loopback (`127.0.0.0/8`, `::1`), the private IPv4
/// ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`,
/// `fe80::/10`) and IPv6 unique local addresses (`fc00::/7`).
pub fn is_local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            o[0] == 127
                || o[0] == 10
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 169 && o[1] == 254)
        }
        IpAddr::V6(v6) => {
            let s = v6.segments();
            v6.is_loopback() || (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80
        }
    }
}

/// A multicast DNS name of the LAN (`name.local`, RFC 6762): one or more labels of letters,
/// digits and hyphens before `.local`.
fn is_mdns_name(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    let host = host.trim_end_matches('.');
    let Some(name) = host.strip_suffix(".local") else { return false };
    !name.is_empty()
        && name.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

/// Whether a host is this PC or the LAN (`network_policy.is_local_host`, plus `.local` names):
/// `localhost`, an address of [`is_local_ip`], or a `.local` name. Plain HTTP goes only to these.
/// A `.local` name is checked again when it is looked up: [`send`] connects over plain HTTP only
/// to the addresses of [`is_local_ip`].
pub fn is_local_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.to_ascii_lowercase().trim_end_matches('.') == "localhost" {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(ip) => is_local_ip(ip),
        Err(_) => is_mdns_name(host),
    }
}

impl Url {
    /// Parses `http(s)://host[:port][/path][?query]`. User info and fragments are refused, and
    /// plain HTTP only goes to a local host.
    pub fn parse(text: &str) -> Result<Url, HttpError> {
        let (scheme, rest) = text.split_once("://").ok_or(HttpError::Url)?;
        let tls = match scheme.to_ascii_lowercase().as_str() {
            "https" => true,
            "http" => false,
            _ => return Err(HttpError::Url),
        };
        if rest.contains('#') || rest.contains('\\') {
            return Err(HttpError::Url);
        }
        let end = rest.find(['/', '?']).unwrap_or(rest.len());
        let (authority, target) = rest.split_at(end);
        if authority.is_empty() || authority.contains('@') {
            return Err(HttpError::Url);
        }
        let (host, port) = if let Some(bracketed) = authority.strip_prefix('[') {
            let (host, after) = bracketed.split_once(']').ok_or(HttpError::Url)?;
            (host.to_string(), after.strip_prefix(':'))
        } else {
            match authority.rsplit_once(':') {
                Some((host, port)) => (host.to_string(), Some(port)),
                None => (authority.to_string(), None),
            }
        };
        let port = match port {
            None | Some("") => {
                if tls {
                    443
                } else {
                    80
                }
            }
            Some(text) => text.parse::<u16>().ok().filter(|p| *p != 0).ok_or(HttpError::Url)?,
        };
        if host.is_empty() || (!tls && !is_local_host(&host)) {
            return Err(HttpError::Url);
        }
        let target = if target.starts_with('?') { format!("/{target}") } else { target.to_string() };
        let target = if target.is_empty() { "/".to_string() } else { target };
        Ok(Url { tls, host, port, target })
    }

    fn host_header(&self) -> String {
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        let default = if self.tls { 443 } else { 80 };
        if self.port == default {
            host
        } else {
            format!("{host}:{}", self.port)
        }
    }
}

/// A request to send.
pub struct Request<'a> {
    pub method: &'a str,
    pub url: &'a str,
    pub headers: Vec<(&'a str, String)>,
    pub body: Option<Vec<u8>>,
    /// Ends the request when it is cancelled ([`HttpError::Cancelled`]); without one, the
    /// request runs until its answer or its timeouts.
    pub cancel: Option<Cancel>,
}

impl<'a> Request<'a> {
    pub fn get(url: &'a str) -> Request<'a> {
        Request { method: "GET", url, headers: Vec::new(), body: None, cancel: None }
    }

    pub fn post_json(url: &'a str, body: &serde_json::Value) -> Request<'a> {
        Request {
            method: "POST",
            url,
            headers: vec![("Content-Type", "application/json".to_string())],
            body: Some(serde_json::to_vec(body).unwrap_or_default()),
            cancel: None,
        }
    }

    pub fn header(mut self, name: &'a str, value: impl Into<String>) -> Request<'a> {
        self.headers.push((name, value.into()));
        self
    }

    /// The request ends when `cancel` is cancelled.
    pub fn cancellable(mut self, cancel: &Cancel) -> Request<'a> {
        self.cancel = Some(cancel.clone());
        self
    }
}

fn tls_config() -> Arc<ClientConfig> {
    static CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let roots = rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
            let config = ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions()
                .expect("the ring provider supports TLS 1.2 and 1.3")
                .with_root_certificates(roots)
                .with_no_client_auth();
            Arc::new(config)
        })
        .clone()
}

enum Stream {
    Plain(Watched),
    Tls(Box<StreamOwned<ClientConnection, Watched>>),
}

impl Read for Stream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Stream::Plain(s) => s.read(buf),
            Stream::Tls(s) => match s.read(buf) {
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => Ok(0),
                other => other,
            },
        }
    }
}

impl Write for Stream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Stream::Plain(s) => s.write(buf),
            Stream::Tls(s) => s.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            Stream::Plain(s) => s.flush(),
            Stream::Tls(s) => s.flush(),
        }
    }
}

/// Looks the host up and connects to the first of its addresses that answers within `wait`.
fn open(url: &Url, wait: Duration) -> Result<TcpStream, HttpError> {
    let addresses = (url.host.as_str(), url.port).to_socket_addrs().map_err(|_| HttpError::Unreachable)?;
    // Plain HTTP stays on this PC and the LAN even when a name (`localhost`, `.local`) is looked
    // up to somewhere else.
    let addresses: Vec<_> = addresses.filter(|a| url.tls || is_local_ip(a.ip())).collect();
    if addresses.is_empty() && !url.tls {
        return Err(HttpError::Url);
    }
    // A refused connection and one that timed out both mean nothing answered (requests'
    // ConnectTimeout is a ConnectionError too). Windows answers a closed loopback port only
    // after its retries, so a short wait ends as a timeout there.
    addresses
        .into_iter()
        .find_map(|address| TcpStream::connect_timeout(&address, wait).ok())
        .ok_or(HttpError::Unreachable)
}

/// Looks a proxy up and connects to the first of its addresses that answers within `wait`. A
/// proxy may be anywhere: only the `CONNECT` line goes to it in the clear.
fn open_proxy(host: &str, port: u16, wait: Duration) -> Result<TcpStream, HttpError> {
    let addresses = (host, port).to_socket_addrs().map_err(|_| HttpError::Unreachable)?;
    addresses.into_iter().find_map(|address| TcpStream::connect_timeout(&address, wait).ok()).ok_or(HttpError::Unreachable)
}

/// Asks the proxy for a tunnel to the URL's host (`CONNECT`); anything but a 2xx answer (a 407
/// for a refused authorization) fails the request.
fn tunnel(stream: &mut Watched, url: &Url, authorization: Option<&str>) -> Result<(), HttpError> {
    let target = if url.host.contains(':') { format!("[{}]:{}", url.host, url.port) } else { format!("{}:{}", url.host, url.port) };
    let mut head = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\nUser-Agent: VRCT-VOX\r\n");
    if let Some(authorization) = authorization {
        if authorization.contains(['\r', '\n']) {
            return Err(HttpError::Url);
        }
        head.push_str(&format!("Proxy-Authorization: {authorization}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).map_err(|e| from_io(&e))?;
    stream.flush().map_err(|e| from_io(&e))?;
    // Byte by byte, so that nothing of the tunnel is read as the answer's.
    let mut answer = Vec::new();
    let mut byte = [0u8; 1];
    while !answer.ends_with(b"\r\n\r\n") {
        if answer.len() > 16 * 1024 || stream.read(&mut byte).map_err(|e| from_io(&e))? == 0 {
            return Err(HttpError::Protocol);
        }
        answer.push(byte[0]);
    }
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut response = httparse::Response::new(&mut headers);
    match response.parse(&answer) {
        Ok(httparse::Status::Complete(_)) if response.code.is_some_and(|code| (200..300).contains(&code)) => Ok(()),
        Ok(httparse::Status::Complete(_)) => Err(HttpError::Io),
        _ => Err(HttpError::Protocol),
    }
}

fn connect(url: &Url, timeouts: Timeouts, cancel: Option<&Cancel>, proxy: Option<&Proxy>) -> Result<Stream, HttpError> {
    let (open, authorization): (Box<dyn FnOnce() -> Result<TcpStream, HttpError> + Send>, _) = match proxy {
        None => {
            let target = url.clone();
            (Box::new(move || open(&target, timeouts.connect)), None)
        }
        // Only HTTPS goes through a proxy: plain HTTP stays on this PC and the LAN.
        Some(Proxy::Http { host, port, authorization }) if url.tls => {
            let (host, port) = (host.clone(), *port);
            (Box::new(move || open_proxy(&host, port, timeouts.connect)), authorization.as_deref())
        }
        Some(_) => return Err(HttpError::Io),
    };
    let tcp = match cancel {
        None => open()?,
        // The look-up and the connection both block: both run where a cancel can leave them.
        Some(cancel) => match cancel.run(open) {
            Some(result) => result?,
            None if cancel.is_cancelled() => return Err(HttpError::Cancelled),
            None => return Err(HttpError::Io),
        },
    };
    tcp.set_read_timeout(Some(timeouts.read)).map_err(|e| from_io(&e))?;
    tcp.set_write_timeout(Some(timeouts.write)).map_err(|e| from_io(&e))?;
    let _ = tcp.set_nodelay(true);
    let mut tcp = Watched::new(tcp, cancel.cloned(), Some(timeouts.read));
    if proxy.is_some() {
        tunnel(&mut tcp, url, authorization)?;
    }
    if !url.tls {
        return Ok(Stream::Plain(tcp));
    }
    let name = ServerName::try_from(url.host.clone()).map_err(|_| HttpError::Url)?;
    let connection = ClientConnection::new(tls_config(), name).map_err(|_| HttpError::Io)?;
    Ok(Stream::Tls(Box::new(StreamOwned::new(connection, tcp))))
}

/// Sends one request and reads the whole answer. A request whose [`Cancel`] is cancelled fails
/// with [`HttpError::Cancelled`], unless its whole answer was already read.
pub fn send(request: &Request<'_>, timeouts: Timeouts) -> Result<Response, HttpError> {
    send_through(request, timeouts, None)
}

/// [`send`] through `proxy` (an HTTPS request only; a plain one with a proxy fails, as does an
/// [`Proxy::Unsupported`] one).
pub fn send_through(request: &Request<'_>, timeouts: Timeouts, proxy: Option<&Proxy>) -> Result<Response, HttpError> {
    let cancelled = || request.cancel.as_ref().is_some_and(Cancel::is_cancelled);
    if cancelled() {
        return Err(HttpError::Cancelled);
    }
    match exchange(request, timeouts, proxy) {
        Err(_) if cancelled() => Err(HttpError::Cancelled),
        other => other,
    }
}

fn exchange(request: &Request<'_>, timeouts: Timeouts, proxy: Option<&Proxy>) -> Result<Response, HttpError> {
    let url = Url::parse(request.url)?;
    let mut stream = connect(&url, timeouts, request.cancel.as_ref(), proxy)?;
    let mut head = format!("{} {} HTTP/1.1\r\nHost: {}\r\n", request.method, url.target, url.host_header());
    head.push_str("User-Agent: VRCT-VOX\r\nAccept: application/json\r\nConnection: close\r\n");
    for (name, value) in &request.headers {
        if value.contains(['\r', '\n']) {
            return Err(HttpError::Url);
        }
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    if let Some(body) = &request.body {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    } else if request.method != "GET" {
        head.push_str("Content-Length: 0\r\n");
    }
    head.push_str("\r\n");
    let mut bytes = head.into_bytes();
    if let Some(body) = &request.body {
        bytes.extend_from_slice(body);
    }
    stream.write_all(&bytes).map_err(|e| from_io(&e))?;
    stream.flush().map_err(|e| from_io(&e))?;
    read_response(&mut stream)
}

fn read_response(stream: &mut impl Read) -> Result<Response, HttpError> {
    let mut data = Vec::new();
    let mut buffer = [0u8; 16 * 1024];
    // The head first.
    let mut need_more = true;
    let (status, head_length, framing, headers) = loop {
        // After an interim answer the final one may already be here, read in the same go: the
        // server can have sent it and closed, so parse before reading again.
        if need_more {
            let read = stream.read(&mut buffer).map_err(|e| from_io(&e))?;
            if read == 0 {
                return Err(HttpError::Protocol);
            }
            data.extend_from_slice(&buffer[..read]);
        }
        need_more = true;
        let mut headers = [httparse::EMPTY_HEADER; 64];
        let mut response = httparse::Response::new(&mut headers);
        match response.parse(&data) {
            Ok(httparse::Status::Complete(length)) => {
                let status = response.code.ok_or(HttpError::Protocol)?;
                let find = |name: &str| {
                    response
                        .headers
                        .iter()
                        .find(|h| h.name.eq_ignore_ascii_case(name))
                        .map(|h| String::from_utf8_lossy(h.value).trim().to_string())
                };
                let framing = if find("transfer-encoding").is_some_and(|v| v.to_ascii_lowercase().contains("chunked")) {
                    Framing::Chunked
                } else if let Some(length) = find("content-length") {
                    Framing::Length(length.parse().map_err(|_| HttpError::Protocol)?)
                } else {
                    Framing::Close
                };
                // An interim answer (100 Continue) is skipped.
                if status == 100 {
                    data.drain(..length);
                    need_more = data.is_empty();
                    continue;
                }
                let headers = response
                    .headers
                    .iter()
                    .map(|h| (h.name.to_ascii_lowercase(), String::from_utf8_lossy(h.value).trim().to_string()))
                    .collect::<Vec<_>>();
                break (status, length, framing, headers);
            }
            Ok(httparse::Status::Partial) if data.len() < 64 * 1024 => continue,
            _ => return Err(HttpError::Protocol),
        }
    };
    let mut body: Vec<u8> = data.split_off(head_length);
    // Chunks seen whole so far: each read looks only at what is new.
    let mut scanned = 0;
    let mut complete = |body: &[u8]| match framing {
        Framing::Length(length) => body.len() >= length,
        Framing::Chunked => chunked_done(body, &mut scanned),
        Framing::Close => false,
    };
    while !complete(&body) {
        if body.len() > MAX_BODY {
            return Err(HttpError::Protocol);
        }
        let read = stream.read(&mut buffer).map_err(|e| from_io(&e))?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&buffer[..read]);
    }
    let body = match framing {
        Framing::Length(length) if body.len() >= length => body[..length].to_vec(),
        Framing::Length(_) => return Err(HttpError::Io),
        Framing::Chunked => dechunk(&body).ok_or(HttpError::Io)?,
        Framing::Close => body,
    };
    Ok(Response { status, headers, body })
}

#[derive(Clone, Copy)]
enum Framing {
    Length(usize),
    Chunked,
    Close,
}

/// The longest chunk-size line accepted (a size and its extensions).
const MAX_CHUNK_LINE: usize = 4096;

/// Whether reading a chunked body can stop: its last chunk is here, or it is broken (then
/// [`dechunk`] refuses it). `at` is where the first chunk not yet seen whole starts; it moves on
/// as chunks complete, so a long body is not scanned again on every read.
fn chunked_done(data: &[u8], at: &mut usize) -> bool {
    loop {
        let rest = &data[*at..];
        let Some(line_end) = rest[..rest.len().min(MAX_CHUNK_LINE)].windows(2).position(|w| w == b"\r\n") else {
            return rest.len() >= MAX_CHUNK_LINE;
        };
        let size = std::str::from_utf8(&rest[..line_end]).ok().and_then(|text| usize::from_str_radix(text.split(';').next()?.trim(), 16).ok());
        let Some(size) = size else { return true };
        if size == 0 {
            return true;
        }
        let Some(end) = size.checked_add(line_end + 4) else { return true };
        if rest.len() < end {
            return false;
        }
        *at += end;
    }
}

/// The body of a complete chunked transfer; `None` while it is incomplete.
fn dechunk(mut data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let line_end = data.windows(2).position(|w| w == b"\r\n")?;
        let size_text = std::str::from_utf8(&data[..line_end]).ok()?;
        let size = usize::from_str_radix(size_text.split(';').next()?.trim(), 16).ok()?;
        data = &data[line_end + 2..];
        if size == 0 {
            return Some(out);
        }
        // A size near usize::MAX (a broken or hostile server) must not wrap around.
        let end = size.checked_add(2)?;
        if data.len() < end {
            return None;
        }
        out.extend_from_slice(data.get(..size)?);
        data = data.get(end..)?;
    }
}

/// Sends a request: [`direct`] in the app, a stand-in in tests.
pub type Transport = Arc<dyn Fn(&Request<'_>, Timeouts) -> Result<Response, HttpError> + Send + Sync>;

/// The network as it is.
pub fn direct() -> Transport {
    Arc::new(send)
}

/// The network through the proxy the environment or Windows' Internet Settings name, read for
/// each request; this PC, the LAN and the hosts the settings leave out go straight
/// ([`crate::proxy`], decision 15 (4)). Speech recognition's engines use it.
pub fn system_proxy() -> Transport {
    Arc::new(|request, timeouts| {
        let proxy = Url::parse(request.url).ok().filter(|url| url.tls).and_then(|url| crate::proxy::Settings::current().proxy_for(&url.host, url.port));
        send_through(request, timeouts, proxy.as_ref())
    })
}

/// Only loopback addresses; anything else fails as if nothing answered, without a lookup. For
/// tests, so that a saved key never reaches a real provider. Each read and write may take at
/// least 2 seconds, so that a busy test machine does not miss the 0.2 seconds a local server has
/// to answer; connecting keeps its time, so a closed port fails as fast as in the app.
pub fn loopback_only() -> Transport {
    Arc::new(|request, timeouts| {
        let floor = Duration::from_secs(2);
        let timeouts = Timeouts {
            connect: timeouts.connect,
            read: timeouts.read.max(floor),
            write: timeouts.write.max(floor),
        };
        let url = Url::parse(request.url)?;
        let loopback = url.host == "localhost" || url.host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback());
        if !loopback {
            return Err(HttpError::Unreachable);
        }
        send(request, timeouts)
    })
}

/// A deadline over several requests (`DiscoveryScope`): each request gets at most what is left.
#[derive(Clone, Copy, Debug)]
pub struct Deadline(Instant);

impl Deadline {
    pub fn after(duration: Duration) -> Deadline {
        Deadline(Instant::now() + duration)
    }

    /// The timeouts of the next request, cut to what is left; `Err` when nothing is.
    pub fn cut(&self, timeouts: Timeouts) -> Result<Timeouts, HttpError> {
        let left = self.0.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(HttpError::Timeout);
        }
        Ok(Timeouts {
            connect: timeouts.connect.min(left),
            read: timeouts.read.min(left),
            write: timeouts.write.min(left),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_follow_the_network_policy() {
        let url = Url::parse("https://api.openai.com/v1/models").unwrap();
        assert_eq!(
            (url.tls, url.host.as_str(), url.port, url.target.as_str()),
            (true, "api.openai.com", 443, "/v1/models")
        );
        let local = Url::parse("http://127.0.0.1:1234/v1").unwrap();
        assert_eq!((local.tls, local.port, local.target.as_str()), (false, 1234, "/v1"));
        assert_eq!(Url::parse("http://[::1]:8080").unwrap().host, "::1");
        assert_eq!(Url::parse("http://example.com/v1"), Err(HttpError::Url));
        assert_eq!(Url::parse("https://user:pw@example.com/"), Err(HttpError::Url));
        assert_eq!(Url::parse("ftp://example.com/"), Err(HttpError::Url));
        assert_eq!(Url::parse("https://example.com:0/"), Err(HttpError::Url));
        assert_eq!(Url::parse("https://example.com/#x"), Err(HttpError::Url));
    }

    #[test]
    fn the_lan_is_private_ranges_link_local_unique_local_and_local_names() {
        for local in [
            "localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.1.1", "::1",
            "[fd12::1]", "fe80::1", "studio.local", "Studio-PC.local.", "a.b.local",
        ] {
            assert!(is_local_host(local), "{local}");
        }
        for public in [
            "example.com", "172.32.0.1", "100.64.0.1", "8.8.8.8", "2001:db8::1", "local", ".local", "-x.local", "a..local",
            "evil.local.example.com", "a_b.local",
        ] {
            assert!(!is_local_host(public), "{public}");
        }
        assert!(Url::parse("http://studio.local:1234/v1").is_ok());
    }

    #[test]
    fn chunked_bodies_are_joined() {
        assert_eq!(dechunk(b"3\r\nabc\r\n2;x=y\r\nde\r\n0\r\n\r\n").unwrap(), b"abcde");
        assert!(dechunk(b"3\r\nab").is_none());
    }

    #[test]
    fn a_chunk_size_that_would_overflow_is_refused_without_a_panic() {
        assert!(dechunk(b"ffffffffffffffff\r\nabc\r\n0\r\n\r\n").is_none());
        assert!(dechunk(b"fffffffffffffffe\r\nabc\r\n0\r\n\r\n").is_none());
    }

    #[test]
    fn a_response_is_read_by_its_length() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nokEXTRA";
        let response = read_response(&mut &raw[..]).unwrap();
        assert_eq!((response.status, response.body.as_slice()), (200, &b"ok"[..]));
        let short = b"HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nok";
        assert_eq!(read_response(&mut &short[..]).unwrap_err(), HttpError::Io);
    }

    #[test]
    fn a_final_answer_read_together_with_100_continue_is_kept() {
        // #470: the final answer behind the interim one was dropped, and the closed connection
        // then failed the request.
        let raw = b"HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok";
        let response = read_response(&mut &raw[..]).unwrap();
        assert_eq!((response.status, response.body.as_slice()), (200, &b"ok"[..]));
        // Read in pieces, as before.
        let response = read_response(&mut Trickle(&raw[..], 5)).unwrap();
        assert_eq!((response.status, response.body.as_slice()), (200, &b"ok"[..]));
    }

    /// Hands out at most `.1` bytes per read.
    struct Trickle<'a>(&'a [u8], usize);

    impl Read for Trickle<'_> {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let count = self.0.len().min(self.1).min(buf.len());
            buf[..count].copy_from_slice(&self.0[..count]);
            self.0 = &self.0[count..];
            Ok(count)
        }
    }

    /// A server on a loopback port that takes connections and holds them open without a word.
    fn silent() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}/v1/models", listener.local_addr().unwrap().port());
        std::thread::spawn(move || {
            let mut held = Vec::new();
            for stream in listener.incoming().flatten() {
                held.push(stream);
            }
        });
        url
    }

    /// Cancels `cancel` after `delay`; the thread gives the instant it did.
    fn cancel_after(cancel: &Cancel, delay: Duration) -> std::thread::JoinHandle<Instant> {
        let cancel = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            let at = Instant::now();
            cancel.cancel();
            at
        })
    }

    #[test]
    fn a_cancel_ends_a_request_whose_answer_never_comes() {
        // Decision 81: Python shut the socket of a list request down when its session stopped.
        let url = silent();
        let cancel = Cancel::new();
        let timer = cancel_after(&cancel, Duration::from_millis(100));
        let result = send(&Request::get(&url).cancellable(&cancel), Timeouts::all(5.0));
        let ended = Instant::now();
        let cancelled_at = timer.join().unwrap();
        assert_eq!(result.unwrap_err(), HttpError::Cancelled);
        let late = ended.saturating_duration_since(cancelled_at);
        assert!(late < Duration::from_millis(100), "ended {late:?} after the cancel");

        // A request cancelled before it starts sends nothing.
        let started = Instant::now();
        assert_eq!(send(&Request::get(&url).cancellable(&cancel), Timeouts::all(5.0)).unwrap_err(), HttpError::Cancelled);
        assert!(started.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn a_cancel_gives_up_a_connection_being_made() {
        // A peer that never answers the connection (Windows' closed loopback port, a host that
        // drops it) holds `connect_timeout` until its timeout; a cancel leaves it there.
        let cancel = Cancel::new();
        let timer = cancel_after(&cancel, Duration::from_millis(50));
        let given = cancel.run(|| {
            std::thread::sleep(Duration::from_secs(2));
            7
        });
        let ended = Instant::now();
        let cancelled_at = timer.join().unwrap();
        assert_eq!(given, None);
        let late = ended.saturating_duration_since(cancelled_at);
        assert!(late < Duration::from_millis(100), "ended {late:?} after the cancel");
        // Once cancelled, nothing more is tried.
        let refused = cancel.connect(SocketAddr::from(([127, 0, 0, 1], 9)), Duration::from_secs(1)).unwrap_err();
        assert_eq!(refused.kind(), io::ErrorKind::ConnectionAborted);
        // What ends before any cancel is given.
        assert_eq!(Cancel::new().run(|| 7), Some(7));
    }

    #[test]
    fn a_cancel_gives_up_a_connection_to_a_closed_loopback_port() {
        // Windows answers a closed loopback port only after its retries (a speech.cpp that is
        // not listening yet, or any more); Linux refuses it at once. Either way the request ends
        // soon after the cancel instead of waiting out the connection's timeout.
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let url = format!("http://127.0.0.1:{port}/v1/models");
        let cancel = Cancel::new();
        let timer = cancel_after(&cancel, Duration::from_millis(50));
        let started = Instant::now();
        let result = send(&Request::get(&url).cancellable(&cancel), Timeouts::all(5.0));
        let waited = started.elapsed();
        timer.join().unwrap();
        assert!(matches!(result, Err(HttpError::Cancelled | HttpError::Unreachable)), "{result:?}");
        assert!(waited < Duration::from_millis(500), "{waited:?}");
    }

    #[test]
    fn a_request_that_may_be_cancelled_still_waits_for_a_slow_answer_up_to_its_read_timeout() {
        // An answer that comes in pieces over several slices of 20 ms is read whole.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}/v1/models", listener.local_addr().unwrap().port());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut head = [0u8; 1024];
            let _ = stream.read(&mut head);
            std::thread::sleep(Duration::from_millis(150));
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n").unwrap();
            std::thread::sleep(Duration::from_millis(80));
            stream.write_all(b"ok").unwrap();
        });
        let cancel = Cancel::new();
        let response = send(&Request::get(&url).cancellable(&cancel), Timeouts::all(5.0)).unwrap();
        assert_eq!((response.status, response.body.as_slice()), (200, &b"ok"[..]));

        // Each read still waits at most the read timeout.
        let timeouts = Timeouts { connect: Duration::from_secs(1), read: Duration::from_millis(200), write: Duration::from_secs(1) };
        let started = Instant::now();
        assert_eq!(send(&Request::get(&silent()).cancellable(&cancel), timeouts).unwrap_err(), HttpError::Timeout);
        let waited = started.elapsed();
        assert!(waited >= Duration::from_millis(190) && waited < Duration::from_secs(1), "{waited:?}");
    }

    /// A proxy on this PC that answers a `CONNECT` with `status`, then keeps what came through
    /// the tunnel: the head it got and the first bytes after it.
    fn proxy_answering(status: &'static str) -> (u16, std::sync::mpsc::Receiver<(String, Vec<u8>)>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut head = Vec::new();
            let mut byte = [0u8; 1];
            while !head.ends_with(b"\r\n\r\n") && stream.read(&mut byte).unwrap_or(0) == 1 {
                head.push(byte[0]);
            }
            stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\n\r\n").as_bytes()).unwrap();
            let mut after = [0u8; 5];
            let read = stream.read(&mut after).unwrap_or(0);
            let _ = sender.send((String::from_utf8_lossy(&head).into_owned(), after[..read].to_vec()));
        });
        (port, receiver)
    }

    #[test]
    fn https_goes_through_a_proxy_tunnel_with_its_authorization() {
        let timeouts = Timeouts::all(5.0);
        let request = Request::get("https://api.example.com/v1/models");
        let proxy = |port, authorization: Option<&str>| Proxy::Http {
            host: "127.0.0.1".into(),
            port,
            authorization: authorization.map(str::to_string),
        };
        // A refused authorization fails the request.
        let (port, seen) = proxy_answering("407 Proxy Authentication Required");
        let failed = send_through(&request, timeouts, Some(&proxy(port, Some("Basic dXNlcjpwdw=="))));
        assert_eq!(failed.unwrap_err(), HttpError::Io);
        let (head, _) = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(head.starts_with("CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n"), "{head}");
        assert!(head.contains("\r\nProxy-Authorization: Basic dXNlcjpwdw==\r\n"), "{head}");
        // An open tunnel carries the TLS handshake with the host itself (a record of type 22).
        let (port, seen) = proxy_answering("200 Connection established");
        assert_eq!(send_through(&request, timeouts, Some(&proxy(port, None))).unwrap_err(), HttpError::Io);
        let (head, after) = seen.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(!head.contains("Proxy-Authorization"), "{head}");
        assert_eq!(after.first(), Some(&22), "{after:?}");
        // A proxy it cannot use fails the request; plain HTTP never goes through one.
        assert_eq!(send_through(&request, timeouts, Some(&Proxy::Unsupported)).unwrap_err(), HttpError::Io);
        assert_eq!(send_through(&Request::get("http://127.0.0.1:9/"), timeouts, Some(&proxy(9, None))).unwrap_err(), HttpError::Io);
    }

    #[test]
    fn a_chunked_body_is_followed_without_scanning_it_again() {
        let mut raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
        let mut expected: Vec<u8> = Vec::new();
        for number in 0..500u32 {
            let chunk = format!("piece {number};");
            raw.extend(format!("{:x}\r\n{chunk}\r\n", chunk.len()).as_bytes());
            expected.extend(chunk.as_bytes());
        }
        raw.extend(b"0\r\n\r\nNEXT");
        for step in [1, 7, 16 * 1024] {
            let response = read_response(&mut Trickle(&raw, step)).unwrap();
            assert_eq!(response.body, expected, "{step}");
        }
        // The scan moves past whole chunks only, and stops at a broken size line.
        let mut at = 0;
        assert!(!chunked_done(b"3\r\nabc\r\n2\r\nd", &mut at));
        assert_eq!(at, 8);
        assert!(chunked_done(b"3\r\nabc\r\nzz\r\n", &mut 0));
        assert!(chunked_done(&vec![b'1'; MAX_CHUNK_LINE], &mut 0));
        assert!(!chunked_done(b"3", &mut 0));
    }
}
