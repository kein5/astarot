//! The OBS browser source: a small HTTP server that hands OBS the overlay page.
//!
//! The same contract as `src-python/models/obs/obs_browser_source_server.py`:
//!
//! - `GET /` and `GET /obs` with `?token=<token>` return the page, which embeds the
//!   WebSocket token. `GET /obs/connection` with `Authorization: Bearer <token>`
//!   returns `{"wsPort": <port>}` so the page can reconnect after a port change.
//!   Without the right token: `403 Forbidden`. Without a configured token, nothing
//!   is served.
//! - `GET /health` returns `ok` without a token.
//! - The `Host` header must be an IP literal or `localhost` (DNS rebinding).
//! - Responses carry `Cache-Control: no-store, max-age=0`, and the page and the
//!   metadata `Referrer-Policy: no-referrer`.
//! - At most 16 requests at a time, each with a total deadline of 5 seconds (which
//!   also covers the TLS handshake and a client that drips its headers).
//! - With a TLS configuration (listening beyond this PC) it speaks `https://`.
//!
//! Request URLs, tokens and the page are never logged.

pub mod page;
pub mod settings;

use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use rustls::ServerConfig;

pub use page::{build_overlay_html, ObsPageSettings};

use crate::log;
use crate::websocket::{percent_decode, tokens_match};

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
pub const MAX_HANDLERS: usize = 16;
pub const STOP_TIMEOUT: Duration = Duration::from_secs(2);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
/// How long a request's read or write waits before it tries again.
const WAIT_STEP: Duration = Duration::from_millis(10);
/// Python's `http.server` limits: a 64 KiB line and 100 headers.
const MAX_LINE: usize = 65536;
const MAX_HEADERS: usize = 100;

type SettingsSource = Arc<dyn Fn() -> ObsPageSettings + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenRequired;

impl std::fmt::Display for TokenRequired {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WebSocket authentication token is required")
    }
}

impl std::error::Error for TokenRequired {}

/// Accept only IP literals and `localhost` in the `Host` header.
///
/// The page embeds the WebSocket token. A web page can rebind its own domain name to
/// 127.0.0.1 (DNS rebinding) and then read this page as same-origin; such a request
/// carries that domain name in `Host`. OBS and LAN clients use an address or localhost.
pub fn is_trusted_host_header(value: Option<&str>) -> bool {
    let Some(value) = value else { return false };
    if value.is_empty() {
        return false;
    }
    let host = value.trim();
    let host = if host.starts_with('[') {
        host.find(']').map_or("", |end| &host[1..end])
    } else if host.matches(':').count() == 1 {
        host.split(':').next().unwrap_or("")
    } else {
        host
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    parse_python_ip(host)
}

/// `ipaddress.ip_address`: dotted-quad IPv4 (no leading zeros) or IPv6, with an
/// optional IPv6 scope.
fn parse_python_ip(host: &str) -> bool {
    if host.parse::<std::net::Ipv4Addr>().is_ok() {
        return true;
    }
    let (address, scope) = match host.split_once('%') {
        Some((address, scope)) => (address, Some(scope)),
        None => (host, None),
    };
    if scope.is_some_and(|s| s.is_empty() || s.contains('%')) {
        return false;
    }
    address.parse::<std::net::Ipv6Addr>().is_ok()
}

struct Handler {
    stream: TcpStream,
    deadline: Instant,
    cut: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
    worker: JoinHandle<()>,
}

impl Handler {
    /// End the request: its worker gives up at its next read.
    fn cut(&self) {
        self.cut.store(true, Ordering::SeqCst);
        Listening::interrupt(&self.stream);
    }
}

/// The request's socket, in non-blocking mode, so that a cut request ends promptly on
/// every platform: on Windows, shutting a socket down from another thread does not
/// wake a read blocked on it. (A socket timeout is no way out there either: after a
/// timed-out read or write, Windows leaves the socket in an undefined state.) A read
/// or write that cannot go on waits in short steps and fails after `timeout`.
struct Watched {
    stream: TcpStream,
    cut: Arc<AtomicBool>,
    timeout: Duration,
}

impl Watched {
    fn wait<T>(&self, mut attempt: impl FnMut(&TcpStream) -> io::Result<T>) -> io::Result<T> {
        let give_up = Instant::now() + self.timeout;
        loop {
            if self.cut.load(Ordering::SeqCst) {
                return Err(io::ErrorKind::ConnectionAborted.into());
            }
            match attempt(&self.stream) {
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    if Instant::now() >= give_up {
                        return Err(io::ErrorKind::TimedOut.into());
                    }
                    thread::sleep(WAIT_STEP);
                }
                result => return result,
            }
        }
    }
}

impl Read for Watched {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.wait(|mut stream| stream.read(buf))
    }
}

impl Write for Watched {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.wait(|mut stream| stream.write(buf))
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct Listening {
    stopping: AtomicBool,
    handlers: Mutex<HashMap<u64, Handler>>,
    local_addr: Option<SocketAddr>,
}

impl Listening {
    fn handlers(&self) -> std::sync::MutexGuard<'_, HashMap<u64, Handler>> {
        self.handlers.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn prune(handlers: &mut HashMap<u64, Handler>) {
        handlers.retain(|_, handler| !handler.done.load(Ordering::SeqCst));
    }

    fn has_handlers(&self) -> bool {
        let mut handlers = self.handlers();
        Self::prune(&mut handlers);
        !handlers.is_empty()
    }

    fn interrupt(stream: &TcpStream) {
        let _ = stream.shutdown(Shutdown::Both);
    }
}

#[derive(Default)]
struct State {
    listening: Option<Arc<Listening>>,
    thread: Option<JoinHandle<()>>,
    stopping: bool,
    stop_logged: bool,
}

struct Shared {
    request_timeout: Mutex<Duration>,
    token: RwLock<String>,
    settings: SettingsSource,
    tls: Option<Arc<ServerConfig>>,
}

pub struct ObsBrowserSourceServer {
    host: String,
    port: u16,
    shared: Arc<Shared>,
    state: Mutex<State>,
}

impl ObsBrowserSourceServer {
    /// A server for `host:port`. The page and the metadata are served only with
    /// `ws_token` (and never while it is empty). `settings` is read for each request.
    /// With `tls` it listens as `https://` (required beyond this PC).
    pub fn new(
        host: &str,
        port: u16,
        ws_token: &str,
        tls: Option<Arc<ServerConfig>>,
        settings: impl Fn() -> ObsPageSettings + Send + Sync + 'static,
    ) -> Self {
        Self {
            host: host.to_string(),
            port,
            shared: Arc::new(Shared {
                request_timeout: Mutex::new(REQUEST_TIMEOUT),
                token: RwLock::new(ws_token.to_string()),
                settings: Arc::new(settings),
                tls,
            }),
            state: Mutex::new(State::default()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn stopped(state: &State) -> bool {
        state.thread.as_ref().is_none_or(|t| t.is_finished())
            && state.listening.as_ref().is_none_or(|l| !l.has_handlers())
    }

    pub fn is_running(&self) -> bool {
        let state = self.lock();
        !state.stopping && state.thread.as_ref().is_some_and(|t| !t.is_finished())
    }

    pub fn is_stopped(&self) -> bool {
        Self::stopped(&self.lock())
    }

    /// The address it listens on (the real port when `port` was 0).
    pub fn local_addr(&self) -> Option<SocketAddr> {
        self.lock().listening.as_ref().and_then(|l| l.local_addr)
    }

    /// Change the per-read timeout and total deadline of later requests (5 seconds by
    /// default; tests use shorter ones).
    pub fn set_request_timeout(&self, timeout: Duration) {
        *self.shared.request_timeout.lock().unwrap_or_else(|e| e.into_inner()) = timeout;
    }

    /// Serve the page only for `token` from the next request on.
    pub fn set_token(&self, token: &str) -> Result<(), TokenRequired> {
        if token.trim().is_empty() {
            return Err(TokenRequired);
        }
        *self.shared.token.write().unwrap_or_else(|e| e.into_inner()) = token.to_string();
        Ok(())
    }

    /// Listen. Binding errors (a taken port, an address that is not this PC's) are
    /// returned. While a previous server is still stopping, nothing happens.
    pub fn start(&self) -> io::Result<()> {
        let mut state = self.lock();
        if !Self::stopped(&state) {
            return Ok(());
        }
        state.stopping = false;
        state.stop_logged = false;
        let listener = TcpListener::bind((self.host.as_str(), self.port))?;
        listener.set_nonblocking(true)?;
        let listening = Arc::new(Listening {
            stopping: AtomicBool::new(false),
            handlers: Mutex::new(HashMap::new()),
            local_addr: listener.local_addr().ok(),
        });
        let serving = listening.clone();
        let shared = self.shared.clone();
        let thread = thread::Builder::new()
            .name("obs_browser_source_server".into())
            .spawn(move || serve(listener, serving, shared))?;
        state.listening = Some(listening);
        state.thread = Some(thread);
        Ok(())
    }

    /// Stop listening and cut open requests. Waits up to 2 seconds; a server whose
    /// workers have not exited by then is kept (and `is_stopped` stays false) until
    /// they do.
    pub fn stop(&self) {
        let mut state = self.lock();
        let deadline = Instant::now() + STOP_TIMEOUT;
        state.stopping = true;
        if let Some(listening) = &state.listening {
            listening.stopping.store(true, Ordering::SeqCst);
            for handler in listening.handlers().values() {
                handler.cut();
            }
        }
        while !Self::stopped(&state) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        if !Self::stopped(&state) {
            if !state.stop_logged {
                state.stop_logged = true;
                log::line("OBS browser source: stop timed out; retaining server until the workers exit");
            }
            return;
        }
        if let Some(thread) = state.thread.take() {
            let _ = thread.join();
        }
        if let Some(listening) = state.listening.take() {
            for (_, handler) in listening.handlers().drain() {
                let _ = handler.worker.join();
            }
        }
    }
}

impl Drop for ObsBrowserSourceServer {
    fn drop(&mut self) {
        if let Some(listening) = &self.lock().listening {
            listening.stopping.store(true, Ordering::SeqCst);
        }
    }
}

fn serve(listener: TcpListener, listening: Arc<Listening>, shared: Arc<Shared>) {
    let next = AtomicU64::new(0);
    while !listening.stopping.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => admit(stream, &listening, &shared, next.fetch_add(1, Ordering::SeqCst)),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => thread::sleep(POLL_INTERVAL),
            Err(_) => thread::sleep(POLL_INTERVAL),
        }
        // A total deadline also covers clients that drip headers often enough to
        // avoid the socket's per-read timeout.
        let mut handlers = listening.handlers();
        Listening::prune(&mut handlers);
        let now = Instant::now();
        for handler in handlers.values() {
            if now >= handler.deadline {
                handler.cut();
            }
        }
    }
    let handlers = listening.handlers();
    for handler in handlers.values() {
        handler.cut();
    }
}

fn admit(stream: TcpStream, listening: &Arc<Listening>, shared: &Arc<Shared>, id: u64) {
    let mut handlers = listening.handlers();
    Listening::prune(&mut handlers);
    if listening.stopping.load(Ordering::SeqCst) || handlers.len() >= MAX_HANDLERS {
        Listening::interrupt(&stream);
        return;
    }
    let timeout = *shared.request_timeout.lock().unwrap_or_else(|e| e.into_inner());
    // Reads and writes wait in short steps (see `Watched`); the request's own timeout
    // still applies to each of them.
    let ready = stream.set_nonblocking(true).is_ok();
    let Ok(control) = stream.try_clone() else { return };
    if !ready {
        Listening::interrupt(&stream);
        return;
    }
    let cut = Arc::new(AtomicBool::new(false));
    let done = Arc::new(AtomicBool::new(false));
    let finished = done.clone();
    let shared = shared.clone();
    let watched = Watched { stream, cut: cut.clone(), timeout };
    let spawned = thread::Builder::new().name("obs_http_request".into()).spawn(move || {
        handle(watched, &shared);
        finished.store(true, Ordering::SeqCst);
    });
    match spawned {
        Ok(worker) => {
            handlers.insert(id, Handler { stream: control, deadline: Instant::now() + timeout, cut, done, worker });
        }
        Err(_) => Listening::interrupt(&control),
    }
}

fn handle(stream: Watched, shared: &Shared) {
    let result = match &shared.tls {
        Some(config) => match rustls::ServerConnection::new(config.clone()) {
            Ok(connection) => {
                // The handshake runs here, on the request's worker under its deadline,
                // so a client that stalls it cannot hold up the accept loop.
                let mut tls = rustls::StreamOwned::new(connection, stream);
                let handshake = (|| {
                    while tls.conn.is_handshaking() {
                        tls.conn.complete_io(&mut tls.sock)?;
                    }
                    Ok::<_, io::Error>(())
                })();
                match handshake {
                    Ok(()) => {
                        let outcome = respond(&mut tls, shared);
                        tls.conn.send_close_notify();
                        let _ = tls.flush();
                        outcome
                    }
                    Err(error) => Err(error),
                }
            }
            Err(_) => Err(io::Error::other("tls")),
        },
        None => {
            let mut stream = stream;
            respond(&mut stream, shared)
        }
    };
    if let Err(error) = result {
        // Plain disconnects and timeouts are routine; anything else is reported
        // without the request.
        if !matches!(
            error.kind(),
            io::ErrorKind::UnexpectedEof
                | io::ErrorKind::ConnectionReset
                | io::ErrorKind::ConnectionAborted
                | io::ErrorKind::BrokenPipe
                | io::ErrorKind::WouldBlock
                | io::ErrorKind::TimedOut
                | io::ErrorKind::NotConnected
        ) {
            log::line("OBS browser source: HTTP request failed");
        }
    }
}

struct Request {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
}

impl Request {
    /// The first header with this name, as Python's `headers.get` returns it.
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }
}

enum ReadError {
    Io(io::Error),
    Status(u16, &'static str),
}

fn read_line<R: BufRead>(reader: &mut R, status: u16, reason: &'static str) -> Result<Vec<u8>, ReadError> {
    let mut line = Vec::new();
    let read = reader.take((MAX_LINE + 1) as u64).read_until(b'\n', &mut line).map_err(ReadError::Io)?;
    if read > MAX_LINE {
        return Err(ReadError::Status(status, reason));
    }
    Ok(line)
}

fn read_request<R: Read>(stream: R) -> Result<Option<Request>, ReadError> {
    let mut reader = BufReader::new(stream);
    let line = read_line(&mut reader, 414, "Request-URI Too Long")?;
    if line.is_empty() {
        return Ok(None);
    }
    let line = String::from_utf8_lossy(&line);
    let line = line.trim_end_matches(['\r', '\n']);
    let words: Vec<&str> = line.split_whitespace().collect();
    let (method, target) = match words.as_slice() {
        [method, target, version] => {
            if !version.starts_with("HTTP/") {
                return Err(ReadError::Status(400, "Bad request version"));
            }
            (*method, *target)
        }
        [method, target] if *method == "GET" => (*method, *target),
        [] => return Ok(None),
        _ => return Err(ReadError::Status(400, "Bad request syntax")),
    };
    let mut headers = Vec::new();
    loop {
        let header = read_line(&mut reader, 431, "Line too long")?;
        if header.is_empty() || header == b"\r\n" || header == b"\n" {
            break;
        }
        if headers.len() >= MAX_HEADERS {
            return Err(ReadError::Status(431, "Too many headers"));
        }
        let header = String::from_utf8_lossy(&header);
        if let Some((name, value)) = header.split_once(':') {
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
    }
    Ok(Some(Request { method: method.to_string(), target: target.to_string(), headers }))
}

/// The path and query of a request target, the way `urllib.parse.urlparse` splits it.
fn split_target(target: &str) -> (&str, &str) {
    let target = target.split('#').next().unwrap_or("");
    let mut rest = target;
    // A scheme (`http:`) is removed, then a network location (`//host`).
    if let Some(colon) = rest.find(':') {
        let scheme = &rest[..colon];
        let mut chars = scheme.chars();
        if chars.next().is_some_and(|c| c.is_ascii_alphabetic())
            && chars.all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
        {
            rest = &rest[colon + 1..];
        }
    }
    if let Some(after) = rest.strip_prefix("//") {
        let end = after.find(['/', '?']).unwrap_or(after.len());
        rest = &after[end..];
    }
    match rest.split_once('?') {
        Some((path, query)) => (path, query),
        None => (rest, ""),
    }
}

/// The values of `token` in the query, keeping blank ones (`keep_blank_values=True`).
fn query_tokens(query: &str) -> Vec<String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (name, value) = match pair.split_once('=') {
                Some(pair) => pair,
                // Python keeps a name without `=` as a blank value.
                None if !pair.is_empty() => (pair, ""),
                None => return None,
            };
            (percent_decode(name) == "token").then(|| percent_decode(value))
        })
        .collect()
}

struct Reply {
    status: u16,
    reason: &'static str,
    headers: Vec<(&'static str, String)>,
    body: Vec<u8>,
}

impl Reply {
    fn new(status: u16, reason: &'static str) -> Self {
        Self { status, reason, headers: Vec::new(), body: Vec::new() }
    }

    fn header(mut self, name: &'static str, value: impl Into<String>) -> Self {
        self.headers.push((name, value.into()));
        self
    }

    fn body(mut self, body: Vec<u8>) -> Self {
        self.body = body;
        self
    }

    fn write<W: Write>(&self, out: &mut W) -> io::Result<()> {
        // HTTP/1.0 like Python's BaseHTTPRequestHandler: one request per connection.
        let mut head = format!("HTTP/1.0 {} {}\r\n", self.status, self.reason);
        for (name, value) in &self.headers {
            head.push_str(name);
            head.push_str(": ");
            head.push_str(value);
            head.push_str("\r\n");
        }
        head.push_str("\r\n");
        out.write_all(head.as_bytes())?;
        out.write_all(&self.body)?;
        out.flush()
    }
}

fn reply_for(request: &Request, shared: &Shared) -> Reply {
    if request.method != "GET" {
        let body = format!("Unsupported method ({:?})\n", request.method).into_bytes();
        return Reply::new(501, "Not Implemented")
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("Content-Length", body.len().to_string())
            .body(body);
    }
    if !is_trusted_host_header(request.header("Host")) {
        return Reply::new(403, "Forbidden").header("Content-Length", "0");
    }
    let (path, query) = split_target(&request.target);
    match path {
        "/" | "/obs" | "/obs/connection" => {
            let ws_token = shared.token.read().unwrap_or_else(|e| e.into_inner()).clone();
            let metadata = path == "/obs/connection";
            let authorization = request.header("Authorization").unwrap_or("");
            let tokens = if metadata {
                vec![authorization.strip_prefix("Bearer ").unwrap_or(authorization).to_string()]
            } else {
                query_tokens(query)
            };
            if ws_token.is_empty()
                || (metadata && !authorization.starts_with("Bearer "))
                || tokens.len() != 1
                || !tokens_match(&tokens[0], &ws_token)
            {
                let body = b"Forbidden\n".to_vec();
                return Reply::new(403, "Forbidden")
                    .header("Content-Type", "text/plain; charset=utf-8")
                    .header("Cache-Control", "no-store, max-age=0")
                    .header("Referrer-Policy", "no-referrer")
                    .header("Content-Length", body.len().to_string())
                    .body(body);
            }
            let settings = (shared.settings)();
            let (content_type, body) = if metadata {
                ("application/json", format!("{{\"wsPort\": {}}}", settings.websocket_port).into_bytes())
            } else {
                ("text/html; charset=utf-8", build_overlay_html(&settings, &ws_token).into_bytes())
            };
            Reply::new(200, "OK")
                .header("Content-Type", content_type)
                .header("Cache-Control", "no-store, max-age=0")
                .header("Referrer-Policy", "no-referrer")
                .header("Content-Length", body.len().to_string())
                .body(body)
        }
        "/health" => Reply::new(200, "OK")
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("Cache-Control", "no-store, max-age=0")
            .header("Content-Length", "2")
            .body(b"ok".to_vec()),
        _ => Reply::new(404, "Not Found"),
    }
}

fn respond<S: Read + Write>(stream: &mut S, shared: &Shared) -> io::Result<()> {
    let reply = match read_request(&mut *stream) {
        Ok(Some(request)) => reply_for(&request, shared),
        Ok(None) => return Ok(()),
        Err(ReadError::Io(error)) => return Err(error),
        Err(ReadError::Status(status, reason)) => Reply::new(status, reason).header("Content-Length", "0"),
    };
    reply.write(stream)
}
