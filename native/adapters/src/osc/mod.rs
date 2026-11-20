//! OSC towards VRChat, and the local-only OSCQuery receive and discovery resources.
//!
//! The same contract as `src-python/models/osc/osc.py`:
//!
//! - Chatbox text goes to `/chatbox/input` as `[text, True, notification]`, typing to
//!   `/chatbox/typing` as `[flag]`, over UDP to the configured address and port (9000
//!   by default). Text is never logged.
//! - Receiving (and OSCQuery) runs only when VRChat is on this PC (`127.0.0.1` or
//!   `localhost`). A UDP server on 127.0.0.1 with an ephemeral port, an OSCQuery HTTP
//!   server on another, both advertised by mDNS as `ASTAROT:<nanoseconds>` with the
//!   address 127.0.0.1, and a browser for `_oscjson._tcp.local.`. The user can turn all
//!   of it off ([`OscHandler::set_osc_query_allowed`], #559); sending goes on.
//! - Received packets, bundle contents included, are applied on receipt on the one
//!   receive thread, whatever their time tag.
//! - A parameter value is asked of exactly one VRChat service: advertised with
//!   loopback addresses only, named `VRChat-Client[-|:<id>]`, and answering with a
//!   host info whose name, loopback OSC address, port and UDP transport match. Two
//!   such services, or none, give no value. Values are not coerced.
//! - Every lifecycle step is bounded: queries and stop wait at most 2 seconds; a
//!   cleanup that has not finished keeps its resources and blocks replacements.

pub mod mdns;
pub mod packet;
pub mod query;

use std::fmt;
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;

pub use packet::{decode_packet, pattern_matches, OscArg, OscMessage};

use crate::log;
use mdns::{DiscoveredService, Mdns};
use query::{get_json, ClientError, QueryService, OSCJSON_TYPE};

pub const OSC_QUERY_TIMEOUT: Duration = Duration::from_secs(2);
pub const OSC_STOP_TIMEOUT: Duration = Duration::from_secs(2);
pub const LOOPBACK: &str = "127.0.0.1";
pub const PARAMETER_MUTE_SELF: &str = "/avatar/parameters/MuteSelf";
pub const CHATBOX_TYPING: &str = "/chatbox/typing";
pub const CHATBOX_INPUT: &str = "/chatbox/input";
/// The name the receiver is advertised under, before `:<nanoseconds>`. Up to 0.5.x it was `VRCT`;
/// nothing keeps it, so it changed without a migration (ADR-014, 2.2).
pub const OSC_QUERY_SERVICE_NAME: &str = "ASTAROT";
const RECEIVE_POLL: Duration = Duration::from_millis(100);
/// socketserver's UDP packet size.
const MAX_PACKET: usize = 8192;

/// OSCQuery (receiving and advertising) runs only when VRChat is on this PC. A
/// destination on another machine, such as a standalone headset, is a choice the user
/// made in settings, not a failure.
pub fn uses_osc_query(ip_address: &str) -> bool {
    ip_address == LOOPBACK || ip_address == "localhost"
}

/// Called with the message's address and its arguments, on the receive thread.
pub type Target = Arc<dyn Fn(&str, &[OscArg]) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OscError {
    /// `request_stop` or `osc_server_stop` was called.
    ShutDown,
    /// The previous cleanup did not finish within 2 seconds (or failed); its resources
    /// are kept and nothing replaces them.
    CleanupIncomplete,
    /// Startup still held the lifecycle after 2 seconds.
    LifecycleBusy,
    Io(io::ErrorKind),
}

impl fmt::Display for OscError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ShutDown => f.write_str("OSC is shut down"),
            Self::CleanupIncomplete => f.write_str("OSC cleanup did not complete"),
            Self::LifecycleBusy => f.write_str("OSC startup still owns lifecycle resources"),
            Self::Io(kind) => write!(f, "OSC I/O failed: {kind}"),
        }
    }
}

impl std::error::Error for OscError {}

impl From<io::Error> for OscError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.kind())
    }
}

// ---------------------------------------------------------------- parts

struct UdpClient {
    socket: UdpSocket,
    target: SocketAddr,
}

impl UdpClient {
    fn new(ip: &str, port: u16) -> io::Result<Self> {
        let target = (ip, port)
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| io::Error::new(io::ErrorKind::AddrNotAvailable, "no address"))?;
        let bind: SocketAddr = match target {
            SocketAddr::V4(_) => (Ipv4Addr::UNSPECIFIED, 0).into(),
            SocketAddr::V6(_) => (std::net::Ipv6Addr::UNSPECIFIED, 0).into(),
        };
        let socket = UdpSocket::bind(bind)?;
        socket.set_nonblocking(true)?;
        Ok(Self { socket, target })
    }

    fn send(&self, message: &OscMessage) -> io::Result<()> {
        self.socket.send_to(&message.encode(), self.target).map(|_| ())
    }
}

struct Receiver {
    port: u16,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Receiver {
    fn start(targets: Vec<(String, Target)>) -> io::Result<Self> {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))?;
        socket.set_read_timeout(Some(RECEIVE_POLL))?;
        let port = socket.local_addr()?.port();
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let thread = thread::Builder::new().name("osc_receive".into()).spawn(move || {
            let mut buffer = vec![0u8; MAX_PACKET];
            while !stopping.load(Ordering::SeqCst) {
                let Ok((size, _)) = socket.recv_from(&mut buffer) else { continue };
                // A malformed packet is dropped whole.
                let Ok(messages) = decode_packet(&buffer[..size]) else { continue };
                for message in messages {
                    for (address, target) in &targets {
                        if pattern_matches(&message.address, address) {
                            let called = catch_unwind(AssertUnwindSafe(|| target(&message.address, &message.args)));
                            if called.is_err() {
                                log::line("OSC: a receive handler failed");
                            }
                        }
                    }
                }
            }
        })?;
        Ok(Self { port, stop, thread: Some(thread) })
    }

    fn close(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Where OSCQuery services are found: the mDNS [`Browser`], or a stand-in in tests.
pub trait Discovery: Send + Sync {
    fn discovered(&self) -> Vec<DiscoveredService>;
    fn ask_again(&self);
}

impl Discovery for Browser {
    fn discovered(&self) -> Vec<DiscoveredService> {
        Browser::discovered(self)
    }

    fn ask_again(&self) {
        Browser::ask_again(self)
    }
}

/// The discovery of `_oscjson._tcp.local.` services. It belongs to receive startup;
/// a query never creates it.
pub struct Browser {
    mdns: Mdns,
}

impl Browser {
    fn start() -> io::Result<Self> {
        let mdns = Mdns::start()?;
        mdns.browse(OSCJSON_TYPE);
        Ok(Self { mdns })
    }

    pub fn discovered(&self) -> Vec<DiscoveredService> {
        self.mdns.discovered(OSCJSON_TYPE)
    }

    /// Ask who offers OSCQuery right now. The browser asks only during its first
    /// seconds; after that it waits for services to announce themselves. VRChat
    /// announces once when it starts, and that single packet can be missed.
    pub fn ask_again(&self) {
        self.mdns.ask_again(OSCJSON_TYPE);
    }

    fn close(&self) {
        self.mdns.close();
    }
}

/// The instance name of a VRChat OSCQuery service on this PC, or `None`.
pub fn local_service_name(service: &DiscoveredService) -> Option<String> {
    if service.service_type != OSCJSON_TYPE {
        return None;
    }
    if service.addresses.is_empty() || !service.addresses.iter().all(Ipv4Addr::is_loopback) {
        return None;
    }
    let name = service.name.strip_suffix("._oscjson._tcp.local.")?;
    is_vrchat_client_name(name).then(|| name.to_string())
}

/// `VRChat-Client(?:[-:][A-Za-z0-9_-]+)?`, the whole name.
fn is_vrchat_client_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("VRChat-Client") else { return false };
    if rest.is_empty() {
        return true;
    }
    let mut chars = rest.chars();
    matches!(chars.next(), Some('-' | ':'))
        && !chars.as_str().is_empty()
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Python truthiness of a JSON value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HostInfo {
    pub name: Option<Value>,
    pub osc_ip: Option<Value>,
    pub osc_port: Option<Value>,
    pub osc_transport: Option<Value>,
}

/// What asking a service for its host info gave.
enum Host {
    Info(HostInfo),
    /// No host info: a status other than 200 or an empty answer.
    None,
    /// The answer was not JSON, or not an object (Python's ValueError/AttributeError).
    Malformed,
}

fn first_address(service: &DiscoveredService) -> IpAddr {
    IpAddr::V4(service.addresses[0])
}

fn ask_host_info(service: &DiscoveredService) -> Result<Host, QueryFailed> {
    match get_json(first_address(service), service.port, "/HOST_INFO") {
        Err(ClientError::Transport) => Err(QueryFailed),
        Err(ClientError::Json) => Ok(Host::Malformed),
        Ok(None) => Ok(Host::None),
        Ok(Some(value)) if !truthy(&value) => Ok(Host::None),
        Ok(Some(Value::Object(map))) => Ok(Host::Info(HostInfo {
            name: map.get("NAME").cloned(),
            osc_ip: map.get("OSC_IP").cloned(),
            osc_port: map.get("OSC_PORT").cloned(),
            osc_transport: map.get("OSC_TRANSPORT").cloned(),
        })),
        Ok(Some(_)) => Ok(Host::Malformed),
    }
}

fn host_matches(host: &HostInfo, name: &str, port: u16) -> bool {
    let name_ok = host.name.as_ref().and_then(Value::as_str) == Some(name);
    let ip_ok = host
        .osc_ip
        .as_ref()
        .and_then(Value::as_str)
        .and_then(|ip| ip.parse::<IpAddr>().ok())
        .is_some_and(|ip| ip.is_loopback());
    // Python's `==` between the JSON number and the port: 9000 and 9000.0 both match.
    let port_ok =
        host.osc_port.as_ref().filter(|v| v.is_number()).and_then(Value::as_f64).is_some_and(|p| p == port as f64);
    let transport_ok = host.osc_transport.as_ref().and_then(Value::as_str) == Some("UDP");
    name_ok && ip_ok && port_ok && transport_ok
}

/// A request to an OSCQuery service failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueryFailed;

/// The value of `address` from the one trusted local VRChat service whose host info
/// names the OSC destination `port`. `Err` when a request failed (the Python query
/// thread logged it and gave no value).
pub fn query_parameter_value(
    address: &str,
    browser: &dyn Discovery,
    cancel: &Cancel,
    port: u16,
) -> Result<Option<Value>, QueryFailed> {
    if cancel.is_set() {
        return Ok(None);
    }
    let mut services = browser.discovered();
    if services.is_empty() {
        // Allow initial mDNS discovery within the same two-second deadline.
        if cancel.wait(Duration::from_secs(1)) {
            return Ok(None);
        }
        services = browser.discovered();
    }
    let mut candidates = Vec::new();
    for service in services {
        let Some(name) = local_service_name(&service) else { continue };
        if cancel.is_set() {
            continue;
        }
        if let Host::Info(host) = ask_host_info(&service)? {
            if host_matches(&host, &name, port) {
                candidates.push(service);
            }
        }
    }
    // Ambiguous local identities cannot establish which client owns the mic.
    if candidates.len() != 1 || cancel.is_set() {
        return Ok(None);
    }
    let service = &candidates[0];
    match get_json(first_address(service), service.port, address) {
        Err(_) => Err(QueryFailed),
        Ok(None) => Ok(None),
        Ok(Some(value)) if !truthy(&value) => Ok(None),
        Ok(Some(Value::Object(map))) => Ok(match map.get("VALUE") {
            // Do not coerce OSCQuery values: "false" is not False.
            Some(Value::Array(values)) => values.first().cloned(),
            _ => None,
        }),
        Ok(Some(_)) => Err(QueryFailed),
    }
}

/// Whether a discovered local VRChat service answers with its host info. When none
/// does, discovery is asked again.
pub fn vrchat_presence(discovery: &dyn Discovery) -> bool {
    for service in discovery.discovered().iter().filter(|s| local_service_name(s).is_some()) {
        if let Ok(Host::Info(_)) = ask_host_info(service) {
            return true;
        }
    }
    discovery.ask_again();
    false
}

// ---------------------------------------------------------------- lifecycle

/// A cancellation flag that can be waited on.
pub struct Cancel {
    set: Mutex<bool>,
    changed: Condvar,
}

impl Cancel {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { set: Mutex::new(false), changed: Condvar::new() })
    }

    pub fn set(&self) {
        *self.set.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.changed.notify_all();
    }

    pub fn is_set(&self) -> bool {
        *self.set.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Wait up to `timeout`; true when cancelled.
    pub fn wait(&self, timeout: Duration) -> bool {
        let guard = self.set.lock().unwrap_or_else(|e| e.into_inner());
        let (guard, _) =
            self.changed.wait_timeout_while(guard, timeout, |set| !*set).unwrap_or_else(|e| e.into_inner());
        *guard
    }
}

/// The lifecycle lock: it can be waited for with a deadline.
struct Gate {
    busy: Mutex<bool>,
    changed: Condvar,
}

struct GateGuard<'a>(&'a Gate);

impl Drop for GateGuard<'_> {
    fn drop(&mut self) {
        *self.0.busy.lock().unwrap_or_else(|e| e.into_inner()) = false;
        self.0.changed.notify_one();
    }
}

impl Gate {
    fn acquire(&self, timeout: Option<Duration>) -> Option<GateGuard<'_>> {
        let deadline = timeout.map(|t| Instant::now() + t);
        let mut busy = self.busy.lock().unwrap_or_else(|e| e.into_inner());
        while *busy {
            match deadline {
                None => busy = self.changed.wait(busy).unwrap_or_else(|e| e.into_inner()),
                Some(deadline) => {
                    let left = deadline.saturating_duration_since(Instant::now());
                    if left.is_zero() {
                        return None;
                    }
                    busy = self.changed.wait_timeout(busy, left).unwrap_or_else(|e| e.into_inner()).0;
                }
            }
        }
        *busy = true;
        Some(GateGuard(self))
    }
}

/// The outcome of a cleanup run: `None` while it runs, then whether it failed.
type CleanupDone = Arc<(Mutex<Option<bool>>, Condvar)>;

#[derive(Default)]
struct Resources {
    receiver: Option<Receiver>,
    service: Option<QueryService>,
    browser: Option<Arc<Browser>>,
}

struct State {
    generation: u64,
    enabled: bool,
    /// The user lets OSCQuery run (#559). While false, nothing receives, advertises or browses,
    /// whatever the destination; sending goes on.
    query_allowed: bool,
    ip: String,
    port: u16,
    client: UdpClient,
    resources: Resources,
    targets: Vec<(String, Target)>,
    cleanup: Option<CleanupDone>,
    osc_server_port: Option<u16>,
    http_port: Option<u16>,
}

pub struct OscHandler {
    gate: Gate,
    state: Mutex<State>,
    shutdown: AtomicBool,
    query_cancel: Mutex<Arc<Cancel>>,
    query_running: Arc<AtomicBool>,
}

impl OscHandler {
    /// A sender for `ip:port` (VRChat listens on 127.0.0.1:9000 by default). Nothing
    /// receives until [`receive_osc_parameters`](Self::receive_osc_parameters).
    pub fn new(ip_address: &str, port: u16) -> io::Result<Self> {
        let client = UdpClient::new(ip_address, port)?;
        Ok(Self {
            gate: Gate { busy: Mutex::new(false), changed: Condvar::new() },
            state: Mutex::new(State {
                generation: 0,
                enabled: false,
                query_allowed: true,
                ip: ip_address.to_string(),
                port,
                client,
                resources: Resources::default(),
                targets: Vec::new(),
                cleanup: None,
                osc_server_port: None,
                http_port: None,
            }),
            shutdown: AtomicBool::new(false),
            query_cancel: Mutex::new(Cancel::new()),
            query_running: Arc::new(AtomicBool::new(false)),
        })
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn is_shut_down(&self) -> bool {
        self.shutdown.load(Ordering::SeqCst)
    }

    fn cancel_queries(&self) {
        self.query_cancel.lock().unwrap_or_else(|e| e.into_inner()).set();
    }

    pub fn is_osc_query_enabled(&self) -> bool {
        let _gate = self.gate.acquire(None);
        self.state().enabled && !self.is_shut_down()
    }

    pub fn osc_ip_address(&self) -> String {
        self.state().ip.clone()
    }

    pub fn osc_port(&self) -> u16 {
        self.state().port
    }

    /// The UDP port this app receives VRChat's OSC on, while receiving.
    pub fn osc_server_port(&self) -> Option<u16> {
        let state = self.state();
        state.resources.receiver.as_ref().and_then(|_| state.osc_server_port)
    }

    /// The port of this app's OSCQuery HTTP server, while receiving.
    pub fn http_port(&self) -> Option<u16> {
        let state = self.state();
        state.resources.service.as_ref().and_then(|_| state.http_port)
    }

    pub fn set_osc_ip_address(&self, ip_address: &str) -> Result<(), OscError> {
        let _gate = self.gate.acquire(None);
        let port = self.state().port;
        self.replace_locked(ip_address, port)
    }

    pub fn set_osc_port(&self, port: u16) -> Result<(), OscError> {
        let _gate = self.gate.acquire(None);
        let ip = self.state().ip.clone();
        self.replace_locked(&ip, port)
    }

    fn replace_locked(&self, ip: &str, port: u16) -> Result<(), OscError> {
        if self.is_shut_down() {
            return Err(OscError::ShutDown);
        }
        let client = UdpClient::new(ip, port)?;
        let previous_ip = self.state().ip.clone();
        self.stop_locked()?;
        if let Err(error) = self.start_locked(ip) {
            self.stop_locked()?;
            if self.start_locked(&previous_ip).is_err() {
                self.stop_locked()?;
                log::line("OSC: previous receiver could not be restored");
            }
            return Err(error);
        }
        let mut state = self.state();
        state.client = client;
        state.ip = ip.to_string();
        state.port = port;
        Ok(())
    }

    pub fn send_typing(&self, flag: bool) -> io::Result<()> {
        let _gate = self.gate.acquire(None);
        if self.is_shut_down() {
            return Ok(());
        }
        self.state().client.send(&OscMessage::new(CHATBOX_TYPING, vec![OscArg::Bool(flag)]))
    }

    /// Send `message` to the chatbox. `current` is asked under the lifecycle lock right
    /// before sending; a message it rejects is not sent. True when sent.
    pub fn send_message(
        &self,
        message: &str,
        notification: bool,
        current: Option<&dyn Fn() -> bool>,
    ) -> io::Result<bool> {
        if message.is_empty() {
            return Ok(false);
        }
        let _gate = self.gate.acquire(None);
        if self.is_shut_down() || !current.is_none_or(|current| current()) {
            return Ok(false);
        }
        self.state().client.send(&OscMessage::new(
            CHATBOX_INPUT,
            vec![OscArg::String(message.to_string()), OscArg::Bool(true), OscArg::Bool(notification)],
        ))?;
        Ok(true)
    }

    /// The value of `address` from the local VRChat, within 2 seconds, or `None`.
    pub fn get_osc_parameter_value(&self, address: &str) -> Option<Value> {
        let deadline = Instant::now() + OSC_QUERY_TIMEOUT;
        let (generation, browser, cancel, port) = {
            let _gate = self.gate.acquire(Some(OSC_QUERY_TIMEOUT))?;
            let state = self.state();
            if !state.enabled || self.is_shut_down() {
                return None;
            }
            let cancel = self.query_cancel.lock().unwrap_or_else(|e| e.into_inner()).clone();
            (state.generation, state.resources.browser.clone(), cancel, state.port)
        };
        if self.query_running.swap(true, Ordering::SeqCst) {
            log::line("OSCQuery: query got no value (previous query still running)");
            return None;
        }
        let (sender, outcome) = mpsc::channel();
        let running = self.query_running.clone();
        let address = address.to_string();
        let spawned = thread::Builder::new().name("osc_parameter_query".into()).spawn(move || {
            // Released however the query ends, a panic included.
            struct Release(Arc<AtomicBool>);
            impl Drop for Release {
                fn drop(&mut self) {
                    self.0.store(false, Ordering::SeqCst);
                }
            }
            let release = Release(running);
            let result = match &browser {
                // The browser belongs to receive startup. A query can never create it.
                None => Ok(None),
                Some(browser) => query_parameter_value(&address, browser.as_ref(), &cancel, port),
            };
            if result.is_err() {
                log::line("OSCQuery: parameter query failed");
            }
            drop(release);
            let _ = sender.send(result.ok().flatten());
        });
        if spawned.is_err() {
            self.query_running.store(false, Ordering::SeqCst);
            return None;
        }
        let left = deadline.saturating_duration_since(Instant::now());
        let Ok(value) = outcome.recv_timeout(left) else {
            log::line("OSCQuery: query timed out");
            return None;
        };
        if Instant::now() >= deadline {
            log::line("OSCQuery: query timed out");
            return None;
        }
        let current = self.query_cancel.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if generation != self.state().generation || current.is_set() {
            return None;
        }
        value
    }

    /// Whether a VRChat on this PC advertises OSC, which it does only while its OSC is
    /// enabled. `None` when that cannot be known: the destination is another machine,
    /// receiving could not start, or OSC is shut down.
    ///
    /// A discovered service is asked for its host info before it counts: a VRChat that
    /// was closed stays in discovery for a long time. When nothing answers, discovery
    /// is asked again, so a VRChat started after this app is found by the next call.
    /// Nothing is sent to VRChat's OSC port.
    pub fn local_vrchat_presence(&self) -> Option<bool> {
        let browser = {
            let _gate = self.gate.acquire(Some(OSC_QUERY_TIMEOUT))?;
            let state = self.state();
            if !state.enabled || self.is_shut_down() {
                return None;
            }
            state.resources.browser.clone()
        }?;
        Some(vrchat_presence(browser.as_ref()))
    }

    /// `MuteSelf` of the local VRChat, only when it is a real boolean.
    pub fn get_osc_parameter_mute_self(&self) -> Option<bool> {
        match self.get_osc_parameter_value(PARAMETER_MUTE_SELF) {
            Some(Value::Bool(value)) => Some(value),
            _ => None,
        }
    }

    /// The addresses to receive and their handlers. They apply from the next start.
    pub fn set_dict_filter_and_target(&self, targets: Vec<(String, Target)>) {
        let _gate = self.gate.acquire(None);
        self.state().targets = targets;
    }

    /// Start receiving (and OSCQuery) when VRChat is on this PC. Nothing happens when
    /// it already runs.
    pub fn receive_osc_parameters(&self) -> Result<(), OscError> {
        let _gate = self.gate.acquire(None);
        if self.is_shut_down() {
            return Err(OscError::ShutDown);
        }
        if self.state().enabled {
            return Ok(());
        }
        self.stop_locked()?;
        let ip = self.state().ip.clone();
        if let Err(error) = self.start_locked(&ip) {
            let _ = self.stop_locked();
            return Err(error);
        }
        Ok(())
    }

    /// Lets OSCQuery run or not, as the user chose (#559): receiving VRChat's parameters, the
    /// advertisement over mDNS and the discovery of VRChat. Turned off, everything of it closes
    /// (the services say goodbye) and nothing starts again, also when the destination changes;
    /// turned on, receiving starts again for the current destination with the targets last set.
    /// Sending to the chatbox is not affected. On failure to start, nothing is left running.
    pub fn set_osc_query_allowed(&self, allowed: bool) -> Result<(), OscError> {
        let _gate = self.gate.acquire(None);
        if self.is_shut_down() {
            return Err(OscError::ShutDown);
        }
        self.state().query_allowed = allowed;
        if !allowed {
            return self.stop_locked();
        }
        if self.state().enabled {
            return Ok(());
        }
        self.stop_locked()?;
        let ip = self.state().ip.clone();
        if let Err(error) = self.start_locked(&ip) {
            let _ = self.stop_locked();
            return Err(error);
        }
        Ok(())
    }

    /// Whether the user lets OSCQuery run ([`set_osc_query_allowed`](Self::set_osc_query_allowed)).
    pub fn is_osc_query_allowed(&self) -> bool {
        self.state().query_allowed
    }

    fn start_locked(&self, ip: &str) -> Result<(), OscError> {
        if self.is_shut_down() {
            return Err(OscError::ShutDown);
        }
        if !uses_osc_query(ip) || !self.state().query_allowed {
            return Ok(());
        }
        *self.query_cancel.lock().unwrap_or_else(|e| e.into_inner()) = Cancel::new();
        let targets = self.state().targets.clone();
        // Each resource is published as soon as it exists, so a failure further on
        // leaves it to the stop that follows.
        let receiver = Receiver::start(targets.clone())?;
        let osc_port = receiver.port;
        {
            let mut state = self.state();
            state.osc_server_port = Some(osc_port);
            state.resources.receiver = Some(receiver);
        }
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let service = QueryService::start(&format!("{OSC_QUERY_SERVICE_NAME}:{nanos}"), osc_port)?;
        for (address, _) in &targets {
            service.advertise_endpoint(address);
        }
        {
            let mut state = self.state();
            state.http_port = Some(service.http_port());
            state.resources.service = Some(service);
        }
        let browser = Browser::start()?;
        self.state().resources.browser = Some(Arc::new(browser));
        if self.is_shut_down() {
            return Err(OscError::ShutDown);
        }
        self.state().enabled = true;
        Ok(())
    }

    fn stop_locked(&self) -> Result<(), OscError> {
        let done = {
            let mut state = self.state();
            state.enabled = false;
            state.generation += 1;
            self.cancel_queries();
            if state.cleanup.is_none() {
                let resources = std::mem::take(&mut state.resources);
                let done: CleanupDone = Arc::new((Mutex::new(None), Condvar::new()));
                let finished = done.clone();
                let spawned = thread::Builder::new().name("osc_cleanup".into()).spawn(move || {
                    let failed = close_all(resources);
                    *finished.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(failed);
                    finished.1.notify_all();
                });
                if spawned.is_err() {
                    *done.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(true);
                }
                state.cleanup = Some(done);
            }
            state.cleanup.clone().expect("a cleanup was just published")
        };
        let outcome = {
            let guard = done.0.lock().unwrap_or_else(|e| e.into_inner());
            let (guard, _) = done
                .1
                .wait_timeout_while(guard, OSC_STOP_TIMEOUT, |outcome| outcome.is_none())
                .unwrap_or_else(|e| e.into_inner());
            *guard
        };
        if outcome != Some(false) {
            // Keep every owner and prohibit replacements until cleanup completes.
            return Err(OscError::CleanupIncomplete);
        }
        let mut state = self.state();
        state.cleanup = None;
        state.osc_server_port = None;
        state.http_port = None;
        Ok(())
    }

    /// Refuse everything from now on and cancel running queries, without waiting.
    pub fn request_stop(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        self.cancel_queries();
    }

    /// Shut down: stop receiving and close everything, waiting at most 2 seconds for
    /// startup to let go and 2 more for the cleanup.
    pub fn osc_server_stop(&self) -> Result<(), OscError> {
        self.request_stop();
        let Some(_gate) = self.gate.acquire(Some(OSC_STOP_TIMEOUT)) else {
            return Err(OscError::LifecycleBusy);
        };
        self.stop_locked()
    }
}

/// Close every owner in parallel; true when any of them failed.
fn close_all(resources: Resources) -> bool {
    let mut workers: Vec<JoinHandle<()>> = Vec::new();
    let mut failed = false;
    let Resources { receiver, service, browser } = resources;
    let mut spawn =
        |work: Box<dyn FnOnce() + Send>| match thread::Builder::new().name("osc_close_owner".into()).spawn(work) {
            Ok(worker) => workers.push(worker),
            Err(_) => failed = true,
        };
    if let Some(receiver) = receiver {
        spawn(Box::new(move || receiver.close()));
    }
    if let Some(service) = service {
        spawn(Box::new(move || service.close()));
    }
    if let Some(browser) = browser {
        spawn(Box::new(move || browser.close()));
    }
    for worker in workers {
        if worker.join().is_err() {
            failed = true;
        }
    }
    if failed {
        log::line("OSC: resource cleanup failed");
    }
    failed
}

impl Drop for OscHandler {
    fn drop(&mut self) {
        self.request_stop();
    }
}
