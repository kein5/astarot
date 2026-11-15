//! The local WebSocket server that pushes the conversation to the OBS page and other
//! clients.
//!
//! The same contract as `src-python/models/websocket/websocket_server.py`:
//!
//! - A client must give the token in the query (`/?token=...`). Without the right one
//!   the handshake is refused with `403 Forbidden` before any WebSocket traffic. A web
//!   page in a browser on the same PC can open `ws://127.0.0.1:...` directly (WebSocket
//!   has no same-origin rule), and the token is what keeps it out.
//! - The server only pushes text. What clients send is read only to enforce limits
//!   (64 KiB a message; 10 messages and 128 KiB a second on average with bursts of 20
//!   and 256 KiB). A client over the budget is closed with 1008.
//! - Output is admitted up to 128 messages and 4 MiB in flight, 256 KiB a message. A
//!   client that holds more than 1 MiB unsent is cut off; the others lose nothing.
//! - A ping every 20 seconds; no pong within 20 seconds cuts the client off.
//! - With a TLS configuration (listening beyond this PC, see [`crate::tls`]) the server
//!   speaks `wss://`. A TLS handshake must finish within 10 seconds.
//!
//! A new token closes every connection made with the old one.

use std::collections::HashMap;
use std::fmt;
use std::io;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use rustls::ServerConfig;
use subtle::ConstantTimeEq;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpSocket, TcpStream};
use tokio::sync::{mpsc, watch, Notify};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{header, StatusCode};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;

use crate::log;

/// What a client may send in one message; nothing reads it (OWASP suggests 64 KB or less).
pub const MAX_INCOMING_MESSAGE_SIZE: usize = 64 * 1024;
pub const INCOMING_MESSAGES_PER_SECOND: f64 = 10.0;
pub const INCOMING_MESSAGE_BURST: u32 = 20;
pub const INCOMING_BYTES_PER_SECOND: f64 = 128.0 * 1024.0;
pub const INCOMING_BYTE_BURST: usize = 256 * 1024;
/// UTF-8 bytes of one outgoing message.
pub const MAX_OUTGOING_MESSAGE_SIZE: usize = 256 * 1024;
pub const MAX_PENDING_MESSAGES: usize = 128;
pub const MAX_PENDING_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_CLIENT_BUFFER_BYTES: usize = 1024 * 1024;
const FRAME_OVERHEAD_BYTES: usize = 14;
pub const PING_INTERVAL: Duration = Duration::from_secs(20);
pub const PING_TIMEOUT: Duration = Duration::from_secs(20);
pub const TLS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// The opening handshake (after TLS) has the same budget as the Python library's default.
const OPEN_TIMEOUT: Duration = Duration::from_secs(10);
const POLICY_CLOSE_TIMEOUT: Duration = Duration::from_secs(2);
const STOP_JOIN_TIMEOUT: Duration = Duration::from_secs(2);
/// How long a stopping server lets clients receive its close frame (1001) before the
/// connections are cut.
const CLOSE_GRACE: Duration = Duration::from_millis(500);
const LISTEN_BACKLOG: u32 = 100;
const FORBIDDEN_BODY: &str = "Forbidden: invalid or missing token\n";

/// A connected client, as the message handler sees it.
pub type ClientId = u64;

/// What a client sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Incoming {
    Text(String),
    Binary(Vec<u8>),
}

type Handler = Arc<dyn Fn(ClientId, Incoming) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartError {
    /// No token, or a blank one.
    TokenRequired,
    /// The previous attempt is still stopping.
    StillStopping,
    /// The server did not listen before the deadline; it never listens later.
    Timeout,
    /// `stop()` cancelled the attempt.
    Cancelled,
    /// Binding or listening failed (for example, the port is taken).
    Io(io::ErrorKind),
    /// The worker thread could not be created.
    Thread,
}

impl fmt::Display for StartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TokenRequired => f.write_str("WebSocket authentication token is required"),
            Self::StillStopping => f.write_str("WebSocket server is still stopping"),
            Self::Timeout => f.write_str("WebSocket server startup timed out"),
            Self::Cancelled => f.write_str("WebSocket server startup was cancelled"),
            Self::Io(kind) => write!(f, "WebSocket server could not listen: {kind}"),
            Self::Thread => f.write_str("WebSocket server thread could not start"),
        }
    }
}

impl std::error::Error for StartError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendError {
    /// The message is over [`MAX_OUTGOING_MESSAGE_SIZE`].
    TooLarge,
    /// More than [`MAX_PENDING_MESSAGES`] or [`MAX_PENDING_BYTES`] are in flight. The
    /// caller reports it; nothing is dropped silently and nothing waits.
    QueueFull,
}

impl fmt::Display for SendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLarge => f.write_str("WebSocket message exceeds the output limit"),
            Self::QueueFull => f.write_str("WebSocket output queue is full"),
        }
    }
}

impl std::error::Error for SendError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenRequired;

impl fmt::Display for TokenRequired {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("WebSocket authentication token is required")
    }
}

impl std::error::Error for TokenRequired {}

/// Token buckets for what one client sends: messages and bytes (SEC-06).
pub struct IncomingBudget {
    last: Instant,
    messages: f64,
    bytes: f64,
}

impl IncomingBudget {
    pub fn new(now: Instant) -> Self {
        Self { last: now, messages: INCOMING_MESSAGE_BURST as f64, bytes: INCOMING_BYTE_BURST as f64 }
    }

    pub fn admit(&mut self, size: usize, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.last = now;
        self.messages = (INCOMING_MESSAGE_BURST as f64).min(self.messages + elapsed * INCOMING_MESSAGES_PER_SECOND);
        self.bytes = (INCOMING_BYTE_BURST as f64).min(self.bytes + elapsed * INCOMING_BYTES_PER_SECOND);
        // The tolerance keeps rounding in the clock arithmetic from refusing a client
        // that sends at exactly the allowed rate.
        if self.messages < 1.0 - 1e-6 || self.bytes < size as f64 - 1e-3 {
            return false;
        }
        self.messages = (self.messages - 1.0).max(0.0);
        self.bytes = (self.bytes - size as f64).max(0.0);
        true
    }
}

enum Outgoing {
    Text(Arc<str>, usize),
    Ping,
    Close(CloseCode, &'static str),
}

struct Client {
    tx: mpsc::UnboundedSender<Outgoing>,
    queued: Arc<AtomicUsize>,
    kill: Arc<Notify>,
}

#[derive(Default)]
struct Clients {
    next: AtomicU64,
    map: Mutex<HashMap<ClientId, Client>>,
}

impl Clients {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<ClientId, Client>> {
        self.map.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn evict_all(&self) {
        for (_, client) in self.lock().drain() {
            client.kill.notify_one();
        }
    }
}

#[derive(Default)]
struct RunState {
    ready: bool,
    running: bool,
    cancelled: bool,
    done: bool,
    error: Option<StartError>,
    pending_messages: usize,
    pending_bytes: usize,
    sender: Option<mpsc::UnboundedSender<(Arc<str>, usize)>>,
    local_addrs: Vec<SocketAddr>,
}

/// One start attempt. Its resources belong to it, including after a bounded join expires.
pub struct Run {
    deadline: Instant,
    state: Mutex<RunState>,
    changed: Condvar,
    cancel: watch::Sender<bool>,
}

impl Run {
    fn lock(&self) -> std::sync::MutexGuard<'_, RunState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn release(&self, size: usize) {
        let mut state = self.lock();
        state.pending_messages -= 1;
        state.pending_bytes -= size;
    }

    fn cancel(&self) {
        let mut state = self.lock();
        state.cancelled = true;
        state.running = false;
        state.ready = true;
        state.sender = None;
        self.cancel.send_replace(true);
        self.changed.notify_all();
    }

    fn join(&self, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        let mut state = self.lock();
        while !state.done {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return;
            }
            state = self.changed.wait_timeout(state, left).unwrap_or_else(|e| e.into_inner()).0;
        }
    }
}

struct Shared {
    keepalive: Mutex<(Duration, Duration)>,
    token: RwLock<Option<String>>,
    handler: RwLock<Option<Handler>>,
    clients: Clients,
}

pub struct WebSocketServer {
    host: String,
    port: u16,
    tls: Option<Arc<ServerConfig>>,
    shared: Arc<Shared>,
    lifecycle: Mutex<()>,
    run: Mutex<Option<Arc<Run>>>,
}

impl WebSocketServer {
    /// A server for `host:port`. A non-empty token is required to start. With `tls`
    /// it listens as `wss://` (required beyond this PC; see [`crate::tls`]).
    pub fn new(host: &str, port: u16, token: Option<String>, tls: Option<Arc<ServerConfig>>) -> Self {
        Self {
            host: host.to_string(),
            port,
            tls,
            shared: Arc::new(Shared {
                keepalive: Mutex::new((PING_INTERVAL, PING_TIMEOUT)),
                token: RwLock::new(token),
                handler: RwLock::new(None),
                clients: Clients::default(),
            }),
            lifecycle: Mutex::new(()),
            run: Mutex::new(None),
        }
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    fn current_run(&self) -> Option<Arc<Run>> {
        self.run.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn is_running(&self) -> bool {
        self.current_run().is_some_and(|run| {
            let state = run.lock();
            state.running && !state.cancelled
        })
    }

    pub fn is_stopped(&self) -> bool {
        self.current_run().is_none_or(|run| run.lock().done)
    }

    /// The addresses the running server listens on (the real port when `port` was 0).
    pub fn local_addrs(&self) -> Vec<SocketAddr> {
        self.current_run().map(|run| run.lock().local_addrs.clone()).unwrap_or_default()
    }

    /// How many clients are connected.
    pub fn client_count(&self) -> usize {
        self.shared.clients.lock().len()
    }

    /// Accept only `token` from now on and close every connection made with the old one.
    /// A client that still has the old token is refused when it reconnects.
    pub fn set_token(&self, token: &str) -> Result<(), TokenRequired> {
        if token.trim().is_empty() {
            return Err(TokenRequired);
        }
        *self.shared.token.write().unwrap_or_else(|e| e.into_inner()) = Some(token.to_string());
        self.shared.clients.evict_all();
        Ok(())
    }

    /// Change the ping interval and the pong deadline for connections made after this
    /// call. The defaults are 20 and 20 seconds; tests use shorter ones.
    pub fn set_keepalive(&self, interval: Duration, timeout: Duration) {
        *self.shared.keepalive.lock().unwrap_or_else(|e| e.into_inner()) = (interval, timeout);
    }

    /// Call `handler` with what a client sends. It runs off the server's loop, one
    /// message at a time for each client. Without a handler, messages are dropped on
    /// the loop. The limits apply either way.
    pub fn set_message_handler(&self, handler: impl Fn(ClientId, Incoming) + Send + Sync + 'static) {
        *self.shared.handler.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(handler));
    }

    /// Queue `message` for every connected client. Before start and after stop it does
    /// nothing.
    pub fn send(&self, message: &str) -> Result<(), SendError> {
        let size = message.len();
        if size > MAX_OUTGOING_MESSAGE_SIZE {
            return Err(SendError::TooLarge);
        }
        let Some(run) = self.current_run() else { return Ok(()) };
        let mut state = run.lock();
        if !state.running || state.cancelled {
            return Ok(());
        }
        if state.pending_messages >= MAX_PENDING_MESSAGES || state.pending_bytes + size > MAX_PENDING_BYTES {
            return Err(SendError::QueueFull);
        }
        let Some(sender) = state.sender.clone() else { return Ok(()) };
        state.pending_messages += 1;
        state.pending_bytes += size;
        if sender.send((Arc::from(message), size)).is_err() {
            state.pending_messages -= 1;
            state.pending_bytes -= size;
        }
        Ok(())
    }

    /// The same as [`send`](Self::send).
    pub fn broadcast(&self, message: &str) -> Result<(), SendError> {
        self.send(message)
    }

    /// Launch an attempt without waiting, so that `stop()` can cancel it. Concurrent
    /// calls share one attempt.
    pub fn begin_start(&self, timeout: Duration) -> Result<Arc<Run>, StartError> {
        let has_token =
            self.shared.token.read().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|t| !t.trim().is_empty());
        if !has_token {
            return Err(StartError::TokenRequired);
        }
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        if !self.is_stopped() {
            let run = self.current_run().expect("a run that is not stopped exists");
            if run.lock().cancelled {
                return Err(StartError::StillStopping);
            }
            return Ok(run);
        }
        let (cancel, cancelled) = watch::channel(false);
        let run = Arc::new(Run {
            deadline: Instant::now() + timeout,
            state: Mutex::new(RunState::default()),
            changed: Condvar::new(),
            cancel,
        });
        *self.run.lock().unwrap_or_else(|e| e.into_inner()) = Some(run.clone());
        let worker = Worker {
            host: self.host.clone(),
            port: self.port,
            tls: self.tls.clone(),
            shared: self.shared.clone(),
            run: run.clone(),
        };
        let spawned = thread::Builder::new().name("websocket_server".into()).spawn(move || worker.run(cancelled));
        if spawned.is_err() {
            let mut state = run.lock();
            state.done = true;
            state.ready = true;
            state.error = Some(StartError::Thread);
            run.changed.notify_all();
            return Err(StartError::Thread);
        }
        Ok(run)
    }

    /// Wait for this exact attempt, never a later start's result.
    pub fn wait_started(&self, run: &Arc<Run>) -> Result<(), StartError> {
        let outcome = {
            let mut state = run.lock();
            loop {
                if state.ready {
                    break if let Some(error) = state.error.clone() {
                        Err(error)
                    } else if state.cancelled || !state.running {
                        Err(StartError::Cancelled)
                    } else {
                        Ok(())
                    };
                }
                let left = run.deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    break Err(StartError::Timeout);
                }
                state = run.changed.wait_timeout(state, left).unwrap_or_else(|e| e.into_inner()).0;
            }
        };
        if outcome.is_err() {
            stop_run(run);
        }
        outcome
    }

    pub fn start(&self, timeout: Duration) -> Result<(), StartError> {
        let run = self.begin_start(timeout)?;
        self.wait_started(&run)
    }

    /// Stop the server and close every connection. Waits up to 2 seconds for the worker.
    pub fn stop(&self) {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(run) = self.current_run() {
            stop_run(&run);
        }
    }
}

impl Drop for WebSocketServer {
    fn drop(&mut self) {
        if let Some(run) = self.current_run() {
            run.cancel();
        }
    }
}

fn stop_run(run: &Arc<Run>) {
    run.cancel();
    run.join(STOP_JOIN_TIMEOUT);
}

struct Worker {
    host: String,
    port: u16,
    tls: Option<Arc<ServerConfig>>,
    shared: Arc<Shared>,
    run: Arc<Run>,
}

impl Worker {
    fn run(self, cancelled: watch::Receiver<bool>) {
        let run = self.run.clone();
        let shared = self.shared.clone();
        let result = tokio::runtime::Builder::new_current_thread().enable_all().build();
        match result {
            Ok(runtime) => {
                let outcome = runtime.block_on(self.serve(cancelled));
                if let Err(error) = outcome {
                    run.lock().error = Some(error);
                }
                // Dropping the runtime cancels every connection task and closes sockets.
                runtime.shutdown_timeout(Duration::from_millis(200));
            }
            Err(error) => run.lock().error = Some(StartError::Io(error.kind())),
        }
        shared.clients.evict_all();
        let mut state = run.lock();
        state.running = false;
        state.ready = true;
        state.done = true;
        state.sender = None;
        run.changed.notify_all();
    }

    fn past_deadline(&self, cancelled: &watch::Receiver<bool>) -> bool {
        *cancelled.borrow() || Instant::now() >= self.run.deadline
    }

    /// Bind every address of the host without listening yet.
    async fn bind(&self) -> Result<Vec<TcpSocket>, StartError> {
        let addresses: Vec<SocketAddr> = match self.host.parse::<std::net::IpAddr>() {
            Ok(ip) => vec![SocketAddr::new(ip, self.port)],
            Err(_) => tokio::net::lookup_host((self.host.as_str(), self.port))
                .await
                .map_err(|e| StartError::Io(e.kind()))?
                .collect(),
        };
        if addresses.is_empty() {
            return Err(StartError::Io(io::ErrorKind::AddrNotAvailable));
        }
        let mut sockets = Vec::new();
        for address in addresses {
            let socket = if address.is_ipv4() { TcpSocket::new_v4() } else { TcpSocket::new_v6() }
                .map_err(|e| StartError::Io(e.kind()))?;
            // The same as Python's asyncio servers: reuse an address in TIME_WAIT on
            // Unix; Windows keeps its exclusive default.
            #[cfg(unix)]
            socket.set_reuseaddr(true).map_err(|e| StartError::Io(e.kind()))?;
            socket.bind(address).map_err(|e| StartError::Io(e.kind()))?;
            sockets.push(socket);
        }
        Ok(sockets)
    }

    async fn serve(self, mut cancelled: watch::Receiver<bool>) -> Result<(), StartError> {
        if *cancelled.borrow() {
            return Ok(());
        }
        // Bind without listening, then check the deadline and cancellation before the
        // listen call. A late bind never starts accepting clients.
        let probe = cancelled.clone();
        let listeners = tokio::select! {
            bound = self.bind_checked(&probe) => bound?,
            _ = cancelled.wait_for(|c| *c) => return Ok(()),
        };
        let (sender, mut queue) = mpsc::unbounded_channel();
        {
            let mut state = self.run.lock();
            if state.cancelled || Instant::now() >= self.run.deadline {
                return Err(StartError::Timeout);
            }
            state.local_addrs = listeners.iter().filter_map(|l| l.local_addr().ok()).collect();
            state.sender = Some(sender);
            state.running = true;
            state.ready = true;
            self.run.changed.notify_all();
        }
        let acceptor = self.tls.clone().map(tokio_rustls::TlsAcceptor::from);
        let (accepted_tx, mut accepted) = mpsc::unbounded_channel::<TcpStream>();
        for listener in listeners {
            let accepted_tx = accepted_tx.clone();
            tokio::spawn(async move {
                loop {
                    match listener.accept().await {
                        Ok((stream, _)) => {
                            if accepted_tx.send(stream).is_err() {
                                return;
                            }
                        }
                        Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
                    }
                }
            });
        }
        drop(accepted_tx);
        loop {
            tokio::select! {
                _ = cancelled.wait_for(|c| *c) => break,
                Some(stream) = accepted.recv() => {
                    let shared = self.shared.clone();
                    let acceptor = acceptor.clone();
                    tokio::spawn(async move {
                        let _ = stream.set_nodelay(true);
                        match acceptor {
                            Some(acceptor) => {
                                // A client that never finishes the TLS handshake is dropped.
                                if let Ok(Ok(stream)) =
                                    tokio::time::timeout(TLS_HANDSHAKE_TIMEOUT, acceptor.accept(stream)).await
                                {
                                    connection(shared, stream).await;
                                }
                            }
                            None => connection(shared, stream).await,
                        }
                    });
                }
                Some((message, size)) = queue.recv() => {
                    self.fan_out(&message, size);
                    self.run.release(size);
                    // Let keepalive, receive and stop run even while producers keep the
                    // queue full.
                    tokio::task::yield_now().await;
                }
            }
        }
        // Closing: tell every client the server is going away (1001), give them a
        // moment, then cut what is left.
        let clients: Vec<_> = self.shared.clients.lock().drain().map(|(_, c)| c).collect();
        for client in &clients {
            let _ = client.tx.send(Outgoing::Close(CloseCode::Away, ""));
        }
        tokio::time::sleep(if clients.is_empty() { Duration::ZERO } else { CLOSE_GRACE }).await;
        for client in clients {
            client.kill.notify_one();
        }
        // Release whatever was admitted but not sent.
        queue.close();
        while let Ok((_, size)) = queue.try_recv() {
            self.run.release(size);
        }
        Ok(())
    }

    async fn bind_checked(&self, cancelled: &watch::Receiver<bool>) -> Result<Vec<TcpListener>, StartError> {
        let sockets = self.bind().await?;
        // Listen only when the attempt is still current: a late bind never accepts.
        if self.past_deadline(cancelled) {
            return Err(StartError::Timeout);
        }
        sockets
            .into_iter()
            .map(|s| s.listen(LISTEN_BACKLOG))
            .collect::<io::Result<_>>()
            .map_err(|e| StartError::Io(e.kind()))
    }

    fn fan_out(&self, message: &Arc<str>, size: usize) {
        let cost = size + FRAME_OVERHEAD_BYTES;
        let mut clients = self.shared.clients.lock();
        let mut evicted = Vec::new();
        for (id, client) in clients.iter() {
            // Evict only this client; healthy clients lose no admitted messages and
            // never wait for another client's drain.
            if client.queued.load(Ordering::SeqCst) + cost > MAX_CLIENT_BUFFER_BYTES {
                evicted.push(*id);
                continue;
            }
            client.queued.fetch_add(cost, Ordering::SeqCst);
            if client.tx.send(Outgoing::Text(message.clone(), cost)).is_err() {
                evicted.push(*id);
            }
        }
        for id in evicted {
            if let Some(client) = clients.remove(&id) {
                client.kill.notify_one();
            }
        }
    }
}

/// `?token=...` the way Python's `parse_qs` reads it: `&`-separated pairs, `+` as a
/// space, percent escapes, blank values dropped, the first value wins.
fn query_token(uri: &str) -> Option<String> {
    let query = uri.split_once('?')?.1;
    let query = query.split('#').next().unwrap_or("");
    for pair in query.split('&') {
        // Python skips a pair without `=` when blank values are not kept.
        let Some((name, value)) = pair.split_once('=') else { continue };
        if percent_decode(name) == "token" {
            let value = percent_decode(value);
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

pub(crate) fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => out.push(b' '),
            b'%' if index + 2 < bytes.len() => {
                let hex =
                    std::str::from_utf8(&bytes[index + 1..index + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(byte) => {
                        out.push(byte);
                        index += 3;
                        continue;
                    }
                    None => out.push(b'%'),
                }
            }
            byte => out.push(byte),
        }
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub(crate) fn tokens_match(supplied: &str, expected: &str) -> bool {
    supplied.as_bytes().ct_eq(expected.as_bytes()).into()
}

fn forbidden() -> ErrorResponse {
    let mut response = ErrorResponse::new(Some(FORBIDDEN_BODY.to_string()));
    *response.status_mut() = StatusCode::FORBIDDEN;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, header::HeaderValue::from_static("text/plain; charset=utf-8"));
    headers.insert(header::CONNECTION, header::HeaderValue::from_static("close"));
    headers.insert(header::CONTENT_LENGTH, header::HeaderValue::from(FORBIDDEN_BODY.len()));
    response
}

async fn connection<S>(shared: Arc<Shared>, stream: S)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let check = shared.clone();
    let accepted_with = Arc::new(Mutex::new(None::<String>));
    let remember = accepted_with.clone();
    #[allow(clippy::result_large_err)] // The library's callback type fixes the error type.
    let authenticate = move |request: &Request, response: Response| -> Result<Response, ErrorResponse> {
        let expected = check.token.read().unwrap_or_else(|e| e.into_inner()).clone();
        let supplied = request.uri().path_and_query().map(|p| p.as_str()).and_then(query_token);
        match (expected, supplied) {
            (Some(expected), Some(supplied)) if !expected.trim().is_empty() && tokens_match(&supplied, &expected) => {
                *remember.lock().unwrap_or_else(|e| e.into_inner()) = Some(expected);
                Ok(response)
            }
            _ => Err(forbidden()),
        }
    };
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_INCOMING_MESSAGE_SIZE))
        .max_frame_size(Some(MAX_INCOMING_MESSAGE_SIZE));
    let handshake = tokio_tungstenite::accept_hdr_async_with_config(stream, authenticate, Some(config));
    let Ok(Ok(socket)) = tokio::time::timeout(OPEN_TIMEOUT, handshake).await else { return };

    let id = shared.clients.next.fetch_add(1, Ordering::SeqCst);
    let (tx, mut rx) = mpsc::unbounded_channel::<Outgoing>();
    let queued = Arc::new(AtomicUsize::new(0));
    let kill = Arc::new(Notify::new());
    {
        let mut clients = shared.clients.lock();
        // A token that changed during the handshake shuts this client out too. The
        // check runs under the clients lock, which set_token's eviction also takes.
        let current = shared.token.read().unwrap_or_else(|e| e.into_inner()).clone();
        if current != *accepted_with.lock().unwrap_or_else(|e| e.into_inner()) {
            return;
        }
        clients.insert(id, Client { tx: tx.clone(), queued: queued.clone(), kill: kill.clone() });
    }

    let (mut sink, mut stream) = socket.split();
    let writer_queued = queued.clone();
    let writer = async move {
        while let Some(outgoing) = rx.recv().await {
            let result = match outgoing {
                Outgoing::Text(text, cost) => {
                    let sent = sink.send(Message::text(text.as_ref())).await;
                    writer_queued.fetch_sub(cost, Ordering::SeqCst);
                    sent
                }
                Outgoing::Ping => sink.send(Message::Ping(Default::default())).await,
                Outgoing::Close(code, reason) => {
                    let _ = sink.send(Message::Close(Some(CloseFrame { code, reason: reason.into() }))).await;
                    // Wait for the peer's close (the reader ends) or the cutoff.
                    std::future::pending::<()>().await;
                    Ok(())
                }
            };
            if result.is_err() {
                return;
            }
        }
    };

    let reader_tx = tx.clone();
    let reader_shared = shared.clone();
    let reader = async move {
        let (ping_interval, ping_timeout) = *reader_shared.keepalive.lock().unwrap_or_else(|e| e.into_inner());
        let mut budget = IncomingBudget::new(Instant::now());
        let mut ping_due = tokio::time::Instant::now() + ping_interval;
        let mut awaiting_pong = false;
        loop {
            let next = tokio::select! {
                next = stream.next() => next,
                _ = tokio::time::sleep_until(ping_due) => {
                    if awaiting_pong {
                        // No pong in time, including the time the ping waited to drain.
                        return;
                    }
                    if reader_tx.send(Outgoing::Ping).is_err() {
                        return;
                    }
                    awaiting_pong = true;
                    ping_due = tokio::time::Instant::now() + ping_timeout;
                    continue;
                }
            };
            let message = match next {
                Some(Ok(message)) => message,
                Some(Err(tokio_tungstenite::tungstenite::Error::Capacity(_))) => {
                    // Over 64 KiB: close with 1009 like the Python library did.
                    let _ = reader_tx.send(Outgoing::Close(CloseCode::Size, "message too big"));
                    let _ = tokio::time::timeout(POLICY_CLOSE_TIMEOUT, drain(&mut stream)).await;
                    return;
                }
                _ => return,
            };
            let incoming = match message {
                Message::Text(text) => Incoming::Text(text.as_str().to_string()),
                Message::Binary(bytes) => Incoming::Binary(bytes.to_vec()),
                Message::Pong(_) => {
                    if awaiting_pong {
                        awaiting_pong = false;
                        ping_due = tokio::time::Instant::now() + ping_interval;
                    }
                    continue;
                }
                Message::Close(_) => return,
                _ => continue,
            };
            let size = match &incoming {
                Incoming::Text(text) => text.len(),
                Incoming::Binary(bytes) => bytes.len(),
            };
            if !budget.admit(size, Instant::now()) {
                reader_shared.clients.lock().remove(&id);
                log::line("WebSocket client sent more than the incoming limit; closing it");
                let _ = reader_tx.send(Outgoing::Close(CloseCode::Policy, "incoming message limit"));
                let _ = tokio::time::timeout(POLICY_CLOSE_TIMEOUT, drain(&mut stream)).await;
                return;
            }
            let handler = reader_shared.handler.read().unwrap_or_else(|e| e.into_inner()).clone();
            if let Some(handler) = handler {
                let dispatched = tokio::task::spawn_blocking(move || handler(id, incoming)).await;
                if dispatched.is_err() {
                    log::line("WebSocket message handler failed");
                }
            }
        }
    };

    tokio::select! {
        _ = writer => {}
        _ = reader => {}
        _ = kill.notified() => {}
    }
    shared.clients.lock().remove(&id);
    // Dropping both halves cuts the connection without waiting for its buffers.
}

async fn drain<S>(stream: &mut S)
where
    S: futures_util::Stream + Unpin,
{
    while stream.next().await.is_some() {}
}
