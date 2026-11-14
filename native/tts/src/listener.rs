//! Notice a speech server that went away while its PCM is still being played.
//!
//! Playback reads HTTP at the pace of the output, so a dead server can hide
//! behind seconds of buffered PCM. After the first PCM of a request, the
//! request subscribes to a monitor for its server's address:
//!
//! - A server this app started ("owned") is watched by one thread that blocks
//!   on the process's exit. No connections are made.
//! - Any other server ("external") is probed by one shared thread per address
//!   every 20 ms. Only a refused connection (or, on Windows, a listener table
//!   that proves the port is not listening) counts as gone. A timeout or other
//!   failure is inconclusive and leaves the ordinary HTTP deadlines in charge.
//!
//! A gone server cancels its subscribers with `server_unavailable`. No PCM is
//! read here, and no addresses of peers or process details are kept.

use std::collections::{HashMap, HashSet};
use std::io;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread::{self, ThreadId};
use std::time::{Duration, Instant};

use crate::cancel::CancelToken;
use crate::sync::{lock, Event};

/// A host (`127.0.0.1`, `::1` or `localhost`) and port.
pub type Address = (String, u16);

/// Whether the listener at an address is proven gone. The `Event` is set when
/// the caller no longer needs the answer; a probe should then return `false`.
pub type Probe = Arc<dyn Fn(&Address, &Event) -> bool + Send + Sync>;

/// A started server process. `wait` blocks until it exits.
pub trait ProcessExit: Send + Sync {
    /// Return `Ok` once the process has exited. An error is not evidence of
    /// exit; the monitor then stops watching and HTTP deadlines still apply.
    fn wait(&self) -> io::Result<()>;
}

struct MonitorState {
    watches: Vec<Arc<WatchShared>>,
    exited: bool,
}

struct MonitorCore {
    address: Address,
    owned: bool,
    probe: Option<Probe>,
    state: Mutex<MonitorState>,
    stopped: Event,
    finished: Event,
    thread: Mutex<Option<ThreadId>>,
}

/// One monitor: an owned process's exit waiter or an external address prober.
#[derive(Clone)]
pub struct ListenerMonitor(Arc<MonitorCore>);

impl ListenerMonitor {
    pub fn address(&self) -> &Address {
        &self.0.address
    }

    /// Current subscriptions.
    pub fn watch_count(&self) -> usize {
        lock(&self.0.state).watches.len()
    }

    /// Whether the monitor's thread has returned.
    pub fn finished(&self) -> bool {
        self.0.finished.is_set()
    }

    /// Wait up to `timeout` for the monitor's thread to return.
    pub fn join(&self, timeout: Duration) -> bool {
        self.0.finished.wait(Some(timeout))
    }

    fn same(&self, other: &ListenerMonitor) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

struct WatchShared {
    token: CancelToken,
    stopped: Event,
    /// Serializes cancellation with `close`: after `close` returns, this
    /// subscription never cancels its token.
    gate: Mutex<()>,
    closed: AtomicBool,
    id: u64,
}

/// One request's subscription.
pub struct ListenerWatch {
    shared: Arc<WatchShared>,
    monitor: ListenerMonitor,
    registry: Arc<RegistryInner>,
}

impl ListenerWatch {
    /// Stop watching. Never waits for the monitor's thread or process.
    pub fn close(&self) {
        let _gate = lock(&self.shared.gate);
        detach(&self.registry, &self.monitor, &self.shared);
    }

    pub fn monitor(&self) -> &ListenerMonitor {
        &self.monitor
    }

    /// The request's own stop flag.
    pub fn stopped(&self) -> &Event {
        &self.shared.stopped
    }

    /// Give an external prober that is stopping a moment to return.
    /// An owned process waiter belongs to the server, never to a request.
    pub fn join(&self) {
        let core = &self.monitor.0;
        if !core.owned && core.stopped.is_set() && *lock(&core.thread) != Some(thread::current().id()) {
            core.finished.wait(Some(Duration::from_millis(200)));
        }
    }
}

fn detach(registry: &Arc<RegistryInner>, monitor: &ListenerMonitor, watch: &Arc<WatchShared>) {
    watch.closed.store(true, Ordering::SeqCst);
    let _registry = lock(&registry.maps);
    let mut state = lock(&monitor.0.state);
    state.watches.retain(|w| w.id != watch.id);
    if state.watches.is_empty() {
        monitor.0.stopped.set();
    }
}

fn unavailable(watch: &WatchShared) {
    let _gate = lock(&watch.gate);
    if !watch.closed.load(Ordering::SeqCst) && !watch.stopped.is_set() {
        // Runs the token's closers on this thread; they detach without the gate.
        watch.token.cancel_with("server_unavailable");
    }
}

struct Maps {
    owners: HashMap<Address, ListenerMonitor>,
    external: HashMap<Address, ListenerMonitor>,
}

struct RegistryInner {
    maps: Mutex<Maps>,
    next_id: AtomicU64,
}

/// Process-exit subscriptions and one bounded probe thread per external address.
#[derive(Clone)]
pub struct ListenerMonitors(Arc<RegistryInner>);

impl Default for ListenerMonitors {
    fn default() -> Self {
        Self::new()
    }
}

/// The process-wide registry used by default.
pub fn listener_monitors() -> &'static ListenerMonitors {
    static REGISTRY: OnceLock<ListenerMonitors> = OnceLock::new();
    REGISTRY.get_or_init(ListenerMonitors::new)
}

impl ListenerMonitors {
    pub fn new() -> Self {
        Self(Arc::new(RegistryInner { maps: Mutex::new(Maps { owners: HashMap::new(), external: HashMap::new() }), next_id: AtomicU64::new(1) }))
    }

    fn core(address: Address, owned: bool, probe: Option<Probe>) -> ListenerMonitor {
        ListenerMonitor(Arc::new(MonitorCore {
            address,
            owned,
            probe,
            state: Mutex::new(MonitorState { watches: Vec::new(), exited: false }),
            stopped: Event::new(),
            finished: Event::new(),
            thread: Mutex::new(None),
        }))
    }

    /// Register a server process this app started on `address`. Requests to
    /// that address made from now on are cancelled when it exits.
    pub fn own(&self, address: Address, process: Arc<dyn ProcessExit>) -> ListenerMonitor {
        let monitor = Self::core(address.clone(), true, None);
        let mut maps = lock(&self.0.maps);
        maps.owners.insert(address, monitor.clone());
        let registry = self.0.clone();
        let waiter = monitor.clone();
        let handle = thread::Builder::new()
            .name("vrct-speech-exit".into())
            .spawn(move || {
                *lock(&waiter.0.thread) = Some(thread::current().id());
                if process.wait().is_ok() {
                    let watches = {
                        let _maps = lock(&registry.maps);
                        let mut state = lock(&waiter.0.state);
                        state.exited = true;
                        state.watches.clone()
                    };
                    for watch in watches {
                        unavailable(&watch);
                    }
                }
                waiter.0.finished.set();
            })
            .expect("spawn the speech server exit waiter");
        drop(handle);
        monitor
    }

    /// Forget an owned monitor, unless a newer one replaced it.
    pub fn forget(&self, monitor: &ListenerMonitor) {
        let mut maps = lock(&self.0.maps);
        if maps.owners.get(&monitor.0.address).is_some_and(|current| current.same(monitor)) {
            maps.owners.remove(&monitor.0.address);
        }
    }

    /// The owned monitor for an address, if this app started its server.
    pub fn owned(&self, address: &Address) -> Option<ListenerMonitor> {
        lock(&self.0.maps).owners.get(address).cloned()
    }

    /// The running external prober for an address.
    pub fn external(&self, address: &Address) -> Option<ListenerMonitor> {
        lock(&self.0.maps).external.get(address).cloned()
    }

    pub fn external_count(&self) -> usize {
        lock(&self.0.maps).external.len()
    }

    /// Subscribe `token` to the server at `address`.
    ///
    /// `owner` is the owned monitor captured before the request connected:
    /// a restarted server can reuse the port, and a request belongs to the
    /// process it was sent to. `stopped` ends the subscription's effect.
    pub fn watch(&self, address: &Address, token: &CancelToken, stopped: Event, probe: Probe, owner: Option<ListenerMonitor>) -> ListenerWatch {
        let shared = Arc::new(WatchShared { token: token.clone(), stopped, gate: Mutex::new(()), closed: AtomicBool::new(false), id: self.0.next_id.fetch_add(1, Ordering::Relaxed) });
        let (monitor, exited) = {
            let mut maps = lock(&self.0.maps);
            let (monitor, start) = match owner.or_else(|| maps.external.get(address).cloned()) {
                Some(monitor) => (monitor, false),
                None => {
                    let monitor = Self::core(address.clone(), false, Some(probe));
                    maps.external.insert(address.clone(), monitor.clone());
                    (monitor, true)
                }
            };
            let exited = {
                let mut state = lock(&monitor.0.state);
                state.watches.push(shared.clone());
                state.exited
            };
            monitor.0.stopped.clear();
            if start {
                let registry = self.0.clone();
                let prober = monitor.clone();
                thread::Builder::new().name("vrct-vox-listener".into()).spawn(move || run_external(registry, prober)).expect("spawn the speech listener monitor");
            }
            (monitor, exited)
        };
        let watch = ListenerWatch { shared: shared.clone(), monitor: monitor.clone(), registry: self.0.clone() };
        let registry = self.0.clone();
        let detach_monitor = monitor;
        token.register(move || detach(&registry, &detach_monitor, &shared));
        if exited {
            unavailable(&watch.shared);
        }
        watch
    }
}

fn run_external(registry: Arc<RegistryInner>, monitor: ListenerMonitor) {
    let core = &monitor.0;
    *lock(&core.thread) = Some(thread::current().id());
    let probe = core.probe.clone().expect("external monitors have a probe");
    loop {
        core.stopped.wait(Some(Duration::from_millis(20)));
        let watches = lock(&core.state).watches.clone();
        for watch in watches {
            if watch.stopped.is_set() || watch.token.is_set() {
                let _gate = lock(&watch.gate);
                detach(&registry, &monitor, &watch);
            }
        }
        let watches = {
            let mut maps = lock(&registry.maps);
            let state = lock(&core.state);
            if state.watches.is_empty() {
                if maps.external.get(&core.address).is_some_and(|current| current.same(&monitor)) {
                    maps.external.remove(&core.address);
                }
                drop(state);
                drop(maps);
                core.finished.set();
                return;
            }
            core.stopped.clear();
            state.watches.clone()
        };
        if probe(&core.address, &core.stopped) {
            // New subscribers must not inherit an observation made before
            // their request. Each cancellation is serialized with close().
            for watch in watches {
                unavailable(&watch);
            }
        }
    }
}

fn resolve(address: &Address) -> Vec<SocketAddr> {
    (address.0.as_str(), address.1).to_socket_addrs().map(Iterator::collect).unwrap_or_default()
}

/// The default probe: a refused localhost connection, or on Windows a
/// listener table without the port.
///
/// This is not a health check. A timeout or another connect failure does not
/// prove the server died; the request's own deadlines still apply.
pub fn listener_missing(address: &Address, stopped: &Event) -> bool {
    #[cfg(windows)]
    {
        listener_missing_with(address, stopped, Some(windows_listener_table()))
    }
    #[cfg(not(windows))]
    {
        listener_missing_with(address, stopped, None)
    }
}

/// [`listener_missing`] with an explicit listener table (Windows' or a test's).
pub fn listener_missing_with(address: &Address, stopped: &Event, table: Option<&ListenerTableProbe>) -> bool {
    if let Some(table) = table {
        if let Some(missing) = table_listener_missing(address, stopped, table) {
            return missing && !stopped.is_set();
        }
    }
    if stopped.is_set() {
        return false;
    }
    let mut refused = false;
    for socket in resolve(address) {
        match TcpStream::connect_timeout(&socket, Duration::from_millis(100)) {
            Ok(_) => return false,
            Err(error) => refused = error.kind() == io::ErrorKind::ConnectionRefused,
        }
    }
    // A busy listener, local resource pressure and so on are inconclusive.
    refused && !stopped.is_set()
}

/// Rows of local listening endpoints: `(ip, port)`.
pub type ListenerRows = Arc<HashSet<(String, u16)>>;

/// Whether a listener table proves `address` has no listener.
/// `None` when the table could not be read in time.
///
/// Winsock may retry a refused connect beyond the short probe timeout, so on
/// Windows a successful table query establishes absence without a connect.
pub fn table_listener_missing(address: &Address, stopped: &Event, table: &ListenerTableProbe) -> Option<bool> {
    let (host, port) = (address.0.as_str(), address.1);
    let mut addresses: Vec<&str> = if host == "::1" { vec!["::1", "::"] } else { vec!["127.0.0.1", "0.0.0.0", "::"] };
    if host == "localhost" {
        addresses.push("::1");
    }
    let listening = |rows: &ListenerRows| rows.iter().any(|(ip, local)| *local == port && addresses.contains(&ip.as_str()));
    let started = table.now();
    let mut rows = table.read(stopped, 0.05, None)?;
    if !listening(&rows) {
        // A newly opened listener can be absent from another address's
        // cached snapshot. Confirm absence with a query begun during this probe.
        let timeout = (0.05 - (table.now() - started)).max(0.0);
        rows = table.read(stopped, timeout, Some(started))?;
    }
    Some(!listening(&rows))
}

type Query = Arc<dyn Fn() -> Option<HashSet<(String, u16)>> + Send + Sync>;
type Clock = Arc<dyn Fn() -> f64 + Send + Sync>;

struct TableState {
    requested: u64,
    completed: u64,
    result: Option<ListenerRows>,
    result_at: Option<f64>,
    started_at: Option<f64>,
    inflight: Option<u64>,
    worker: bool,
    closed: bool,
}

struct TableInner {
    query: Query,
    clock: Clock,
    freshness: f64,
    state: Mutex<TableState>,
    changed: Condvar,
    finished: Event,
}

/// One shared worker isolates a potentially slow native listener query.
///
/// A hung query occupies at most this one thread; later readers time out and
/// fall back to the TCP probe and the request deadlines. Readers reuse a
/// result whose query began within `freshness` seconds.
#[derive(Clone)]
pub struct ListenerTableProbe(Arc<TableInner>);

fn seconds_since_start() -> f64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() + 1.0
}

impl ListenerTableProbe {
    pub fn new(query: impl Fn() -> Option<HashSet<(String, u16)>> + Send + Sync + 'static, freshness: f64) -> Self {
        Self::with_clock(query, freshness, seconds_since_start)
    }

    /// With a clock in seconds, for tests.
    pub fn with_clock(query: impl Fn() -> Option<HashSet<(String, u16)>> + Send + Sync + 'static, freshness: f64, clock: impl Fn() -> f64 + Send + Sync + 'static) -> Self {
        Self(Arc::new(TableInner {
            query: Arc::new(query),
            clock: Arc::new(clock),
            freshness,
            state: Mutex::new(TableState { requested: 0, completed: 0, result: None, result_at: None, started_at: None, inflight: None, worker: false, closed: false }),
            changed: Condvar::new(),
            finished: Event::new(),
        }))
    }

    fn now(&self) -> f64 {
        (self.0.clock)()
    }

    /// Reuse fresh rows, or require an observation begun after `not_before`.
    /// `None` when the query failed, timed out, was stopped or the probe closed.
    pub fn read(&self, stopped: &Event, timeout: f64, not_before: Option<f64>) -> Option<ListenerRows> {
        let deadline = Instant::now() + Duration::from_secs_f64(timeout.max(0.0));
        let mut state = lock(&self.0.state);
        if state.closed || stopped.is_set() {
            return None;
        }
        let now = self.now();
        let fresh_after = not_before.unwrap_or(now - self.0.freshness);
        // Zero freshness never reuses. An observation required to begin at
        // not_before must begin after it: one stamped with the same clock tick
        // may have started earlier.
        let reusable = not_before.is_some() || self.0.freshness > 0.0;
        let fresh = |at: Option<f64>| at.is_some_and(|at| if not_before.is_some() { at > fresh_after } else { at >= fresh_after });
        if reusable && state.result.is_some() && fresh(state.result_at) {
            return state.result.clone();
        }
        let ticket = match state.inflight {
            Some(inflight) if fresh(state.started_at) => inflight,
            _ => {
                state.requested += 1;
                state.requested
            }
        };
        if !state.worker {
            state.worker = true;
            let inner = self.0.clone();
            thread::Builder::new().name("vrct-listener-table".into()).spawn(move || table_worker(inner)).expect("spawn the listener table worker");
        }
        self.0.changed.notify_all();
        while !state.closed && !stopped.is_set() {
            if state.completed >= ticket {
                return state.result.clone();
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            state = self.0.changed.wait_timeout(state, remaining.min(Duration::from_millis(10))).unwrap_or_else(|p| p.into_inner()).0;
        }
        None
    }

    /// Stop the worker. Returns whether it exited within `timeout`; a native
    /// call still running is reported, never claimed finished.
    pub fn close(&self, timeout: Duration) -> bool {
        let worker = {
            let mut state = lock(&self.0.state);
            state.closed = true;
            self.0.changed.notify_all();
            state.worker
        };
        !worker || self.0.finished.wait(Some(timeout))
    }

    /// Whether the worker thread has been started.
    pub fn has_worker(&self) -> bool {
        lock(&self.0.state).worker
    }
}

fn table_worker(inner: Arc<TableInner>) {
    loop {
        let ticket = {
            let mut state = lock(&inner.state);
            while !state.closed && state.requested <= state.completed {
                state = inner.changed.wait(state).unwrap_or_else(|p| p.into_inner());
            }
            if state.closed {
                break;
            }
            state.inflight = Some(state.requested);
            state.started_at = Some((inner.clock)());
            state.requested
        };
        let query = inner.query.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| query())).ok().flatten();
        let mut state = lock(&inner.state);
        state.result = result.map(Arc::new);
        state.completed = ticket;
        // Age from the query's START: a slow native call must not renew stale
        // evidence for later readers merely because it just returned.
        state.result_at = state.started_at;
        state.inflight = None;
        inner.changed.notify_all();
    }
    inner.finished.set();
}

/// Windows' shared table probe (20 ms freshness), reading the TCP tables.
#[cfg(windows)]
pub fn windows_listener_table() -> &'static ListenerTableProbe {
    static TABLE: OnceLock<ListenerTableProbe> = OnceLock::new();
    TABLE.get_or_init(|| ListenerTableProbe::new(windows_table::query, 0.02))
}

#[cfg(windows)]
mod windows_table {
    //! Local listening endpoints from `GetExtendedTcpTable`.
    use std::collections::HashSet;
    use std::net::{Ipv4Addr, Ipv6Addr};

    use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR};
    use windows_sys::Win32::NetworkManagement::IpHelper::{GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_ALL};
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};

    const MIB_TCP_STATE_LISTEN: u32 = 2;

    /// A listening row. Some Windows systems report a listening socket's state
    /// as 0 (seen on Windows 11 build 26220). Such a row without a remote peer
    /// may be listening; counting it only makes absence harder to prove.
    fn listening(state: u32, remote_port: u32) -> bool {
        state == MIB_TCP_STATE_LISTEN || (!(1..=12).contains(&state) && remote_port & 0xffff == 0)
    }

    fn port(value: u32) -> u16 {
        u16::from_be(value as u16)
    }

    fn table(family: u16) -> Option<Vec<u8>> {
        let mut size = 0u32;
        for _ in 0..4 {
            let mut buffer = vec![0u8; size as usize];
            // SAFETY: the buffer is `size` bytes; the call writes at most that and updates `size`.
            let status = unsafe { GetExtendedTcpTable(if buffer.is_empty() { std::ptr::null_mut() } else { buffer.as_mut_ptr().cast() }, &mut size, 0, family as u32, TCP_TABLE_OWNER_PID_ALL, 0) };
            if status == NO_ERROR {
                buffer.truncate(size as usize);
                return Some(buffer);
            }
            if status != ERROR_INSUFFICIENT_BUFFER {
                return None;
            }
            size += 4096;
        }
        None
    }

    fn rows<T: Copy>(buffer: &[u8]) -> Vec<T> {
        if buffer.len() < 4 {
            return Vec::new();
        }
        let count = u32::from_ne_bytes(buffer[..4].try_into().unwrap()) as usize;
        let offset = std::mem::align_of::<T>().max(4);
        (0..count)
            .filter_map(|index| {
                let start = offset + index * std::mem::size_of::<T>();
                let end = start + std::mem::size_of::<T>();
                // SAFETY: bounds are checked; read_unaligned copies plain old data.
                (end <= buffer.len()).then(|| unsafe { std::ptr::read_unaligned(buffer[start..].as_ptr().cast::<T>()) })
            })
            .collect()
    }

    /// Keep only local listening endpoints, never remote peers or process data.
    pub(super) fn query() -> Option<HashSet<(String, u16)>> {
        let mut endpoints = HashSet::new();
        for row in rows::<MIB_TCPROW_OWNER_PID>(&table(AF_INET)?) {
            if listening(row.dwState, row.dwRemotePort) {
                endpoints.insert((Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes()).to_string(), port(row.dwLocalPort)));
            }
        }
        for row in rows::<MIB_TCP6ROW_OWNER_PID>(&table(AF_INET6)?) {
            if listening(row.dwState, row.dwRemotePort) {
                endpoints.insert((Ipv6Addr::from(row.ucLocalAddr).to_string(), port(row.dwLocalPort)));
            }
        }
        Some(endpoints)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn rows(items: &[(&str, u16)]) -> HashSet<(String, u16)> {
        items.iter().map(|(ip, port)| (ip.to_string(), *port)).collect()
    }

    #[test]
    fn stalled_query_is_bounded_shared_and_does_not_reuse_stale_result() {
        let (entered, release, next_entered, next_release) = (Event::new(), Event::new(), Event::new(), Event::new());
        let calls = Arc::new(AtomicUsize::new(0));
        let probe = {
            let (entered, release, next_entered, next_release, calls) = (entered.clone(), release.clone(), next_entered.clone(), next_release.clone(), calls.clone());
            ListenerTableProbe::new(
                move || {
                    if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                        entered.set();
                        release.wait(Some(Duration::from_secs(2)));
                        return Some(rows(&[("old", 1)]));
                    }
                    next_entered.set();
                    next_release.wait(Some(Duration::from_secs(2)));
                    Some(rows(&[("fresh", 1)]))
                },
                0.02,
            )
        };
        let started = Instant::now();
        assert!(probe.read(&Event::new(), 0.03, None).is_none());
        assert!(entered.is_set());
        for _ in 0..3 {
            assert!(probe.read(&Event::new(), 0.02, None).is_none());
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(started.elapsed() < Duration::from_millis(300));
        let reader = probe.clone();
        let waiter = thread::spawn(move || reader.read(&Event::new(), 0.5, None));
        release.set();
        assert!(next_entered.wait(Some(Duration::from_millis(200))));
        assert!(!waiter.is_finished(), "completion of the old request is not current evidence");
        next_release.set();
        assert_eq!(*waiter.join().unwrap().unwrap(), rows(&[("fresh", 1)]));
        assert!(probe.close(Duration::from_millis(500)));
    }

    #[test]
    fn stop_does_not_wait_for_os_query() {
        let (entered, release) = (Event::new(), Event::new());
        let probe = {
            let (entered, release) = (entered.clone(), release.clone());
            ListenerTableProbe::new(
                move || {
                    entered.set();
                    release.wait(Some(Duration::from_secs(2)));
                    Some(HashSet::new())
                },
                0.02,
            )
        };
        let stopped = Event::new();
        let reader = probe.clone();
        let reader_stop = stopped.clone();
        let waiter = thread::spawn(move || reader.read(&reader_stop, 1.0, None));
        assert!(entered.wait(Some(Duration::from_millis(200))));
        stopped.set();
        let begun = Instant::now();
        assert!(waiter.join().unwrap().is_none());
        assert!(begun.elapsed() < Duration::from_millis(200));
        assert!(!probe.close(Duration::from_millis(20)), "an unreaped native call is reported");
        release.set();
        assert!(probe.close(Duration::from_millis(500)));
    }

    #[test]
    fn query_failure_is_inconclusive_and_retryable() {
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        let probe = ListenerTableProbe::new(move || (counter.fetch_add(1, Ordering::SeqCst) > 0).then(HashSet::new), 0.02);
        assert!(probe.read(&Event::new(), 0.05, None).is_none());
        assert_eq!(*probe.read(&Event::new(), 0.05, None).unwrap(), HashSet::new());
        assert!(probe.close(Duration::from_millis(500)));
    }

    fn fake_clock() -> (Arc<Mutex<f64>>, impl Fn() -> f64 + Send + Sync + Clone + 'static) {
        let clock = Arc::new(Mutex::new(10.0));
        let reader = clock.clone();
        (clock, move || *lock(&reader))
    }

    #[test]
    fn table_cache_is_shared_expires_and_coalesces_inflight() {
        let (clock, now) = fake_clock();
        let (entered, release) = (Event::new(), Event::new());
        let calls = Arc::new(AtomicUsize::new(0));
        let probe = {
            let (entered, release, calls) = (entered.clone(), release.clone(), calls.clone());
            ListenerTableProbe::with_clock(
                move || {
                    calls.fetch_add(1, Ordering::SeqCst);
                    entered.set();
                    release.wait(Some(Duration::from_secs(1)));
                    Some(rows(&[("127.0.0.1", 8080)]))
                },
                0.02,
                now,
            )
        };
        let first = {
            let probe = probe.clone();
            thread::spawn(move || probe.read(&Event::new(), 0.05 * 20.0, None))
        };
        assert!(entered.wait(Some(Duration::from_millis(500))));
        let second = {
            let probe = probe.clone();
            thread::spawn(move || probe.read(&Event::new(), 0.05 * 20.0, None))
        };
        thread::sleep(Duration::from_millis(20));
        release.set();
        assert!(first.join().unwrap().is_some() && second.join().unwrap().is_some());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let address: Address = ("127.0.0.1".into(), 8080);
        *lock(&clock) += 0.019;
        assert_eq!(table_listener_missing(&address, &Event::new(), &probe), Some(false));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        *lock(&clock) += 0.002;
        assert_eq!(table_listener_missing(&address, &Event::new(), &probe), Some(false));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let stopped = Event::new();
        stopped.set();
        assert!(probe.read(&stopped, 0.05, None).is_none());
        assert!(probe.close(Duration::from_millis(500)));
    }

    #[test]
    fn cached_absence_cannot_cancel_a_new_listener() {
        let listening = Arc::new(Mutex::new(HashSet::new()));
        let calls = Arc::new(AtomicUsize::new(0));
        let probe = {
            let (listening, calls) = (listening.clone(), calls.clone());
            ListenerTableProbe::new(
                move || {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Some(lock(&listening).clone())
                },
                0.02,
            )
        };
        assert_eq!(*probe.read(&Event::new(), 0.05, None).unwrap(), HashSet::new());
        lock(&listening).insert(("127.0.0.1".to_string(), 8080));
        assert_eq!(table_listener_missing(&("127.0.0.1".into(), 8080), &Event::new(), &probe), Some(false));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(probe.close(Duration::from_millis(500)));
    }

    #[test]
    fn slow_table_completion_does_not_extend_cache_freshness() {
        let (clock, now) = fake_clock();
        let calls = Arc::new(AtomicUsize::new(0));
        let probe = {
            let (clock, calls) = (clock.clone(), calls.clone());
            ListenerTableProbe::with_clock(
                move || {
                    calls.fetch_add(1, Ordering::SeqCst);
                    *lock(&clock) += 0.03;
                    Some(rows(&[("127.0.0.1", 8080)]))
                },
                0.02,
                now,
            )
        };
        assert!(probe.read(&Event::new(), 0.05, None).is_some());
        assert!(probe.read(&Event::new(), 0.05, None).is_some());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(probe.close(Duration::from_millis(500)));
    }

    #[test]
    fn listener_table_requires_exact_address_and_port() {
        for (host, listener_ip) in [("127.0.0.1", "127.0.0.1"), ("127.0.0.1", "0.0.0.0"), ("127.0.0.1", "::"), ("::1", "::1"), ("::1", "::"), ("localhost", "127.0.0.1"), ("localhost", "::1")] {
            let table = Arc::new(Mutex::new(rows(&[(listener_ip, 1234)])));
            let reader = table.clone();
            let probe = ListenerTableProbe::new(move || Some(lock(&reader).clone()), 0.0);
            assert_eq!(table_listener_missing(&(host.into(), 1234), &Event::new(), &probe), Some(false), "{host} {listener_ip}");
            assert_eq!(table_listener_missing(&(host.into(), 1235), &Event::new(), &probe), Some(true));
            *lock(&table) = rows(&[("192.0.2.1", 1234)]);
            assert_eq!(table_listener_missing(&(host.into(), 1234), &Event::new(), &probe), Some(true));
            assert!(probe.close(Duration::from_millis(500)));
        }
    }

    #[test]
    fn absence_confirmation_shares_the_original_deadline() {
        let (clock, now) = fake_clock();
        let calls = Arc::new(AtomicUsize::new(0));
        let probe = {
            let (clock, calls) = (clock.clone(), calls.clone());
            ListenerTableProbe::with_clock(
                move || {
                    let call = calls.fetch_add(1, Ordering::SeqCst);
                    *lock(&clock) += 0.04;
                    if call == 0 {
                        Some(HashSet::new())
                    } else {
                        // The confirmation would succeed, but its budget is spent.
                        thread::sleep(Duration::from_millis(30));
                        Some(HashSet::new())
                    }
                },
                0.02,
                now,
            )
        };
        let started = Instant::now();
        assert_eq!(table_listener_missing(&("127.0.0.1".into(), 1), &Event::new(), &probe), None);
        assert!(started.elapsed() < Duration::from_millis(200));
        assert!(probe.close(Duration::from_millis(500)));
    }

    #[test]
    fn failed_table_falls_back_to_connect_and_stop_skips_it() {
        let probe = ListenerTableProbe::new(|| None, 0.02);
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address: Address = ("127.0.0.1".into(), listener.local_addr().unwrap().port());
        assert!(!listener_missing_with(&address, &Event::new(), Some(&probe)));
        drop(listener);
        assert!(listener_missing_with(&address, &Event::new(), Some(&probe)));
        let stopped = Event::new();
        stopped.set();
        assert!(!listener_missing_with(&address, &stopped, Some(&probe)));
        assert!(probe.close(Duration::from_millis(500)));
    }
}
