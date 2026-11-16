//! Multicast DNS for OSCQuery: advertising this app's services and finding VRChat's.
//!
//! The Python implementation used python-zeroconf with its defaults, and this module
//! keeps what VRChat could observe of it:
//!
//! - One socket on `0.0.0.0:5353` joins 224.0.0.251 on every IPv4 address of the PC,
//!   loopback included; one more socket per address (bound to it, port 5353) sends.
//! - Services are announced on every interface with the address `127.0.0.1`, also on
//!   the LAN interfaces (a library that publishes only addresses in an interface's
//!   subnet would drop it there, and VRChat could no longer resolve the service).
//! - PTR and TXT records live 4500 seconds, SRV and A records 120 seconds; a goodbye
//!   repeats the records with TTL 0.
//! - Browsing asks at once, then after 1, 2, 4, ... seconds up to an hour, and again
//!   whenever asked to.
//!
//! Names are compared without regard to ASCII case, as DNS does.

use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use socket2::{Domain, Protocol, Socket, Type};

pub const MDNS_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);
pub const MDNS_PORT: u16 = 5353;
pub const HOST_TTL: u32 = 120;
pub const OTHER_TTL: u32 = 4500;
const TYPE_A: u16 = 1;
const TYPE_PTR: u16 = 12;
const TYPE_TXT: u16 = 16;
const TYPE_SRV: u16 = 33;
const TYPE_ANY: u16 = 255;
const CLASS_IN: u16 = 1;
const CACHE_FLUSH: u16 = 0x8000;
const FLAGS_RESPONSE: u16 = 0x8400; // QR and AA
const TICK: Duration = Duration::from_millis(100);
const ANNOUNCE_GAPS: [Duration; 3] = [Duration::ZERO, Duration::from_millis(225), Duration::from_millis(225)];
const GOODBYE_GAP: Duration = Duration::from_millis(125);
const BROWSE_FIRST: Duration = Duration::from_secs(1);
const BROWSE_LIMIT: Duration = Duration::from_secs(3600);
const MAX_PACKET: usize = 9000;
const RESOLVE_FIRST: Duration = Duration::from_secs(1);
const RESOLVE_LIMIT: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------- DNS messages

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Question {
    pub name: String,
    pub qtype: u16,
    /// The class with the unicast-response bit.
    pub qclass: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RData {
    A(Ipv4Addr),
    Ptr(String),
    Srv { priority: u16, weight: u16, port: u16, target: String },
    Txt(Vec<u8>),
    Other(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Record {
    pub name: String,
    pub rtype: u16,
    /// The class with the cache-flush bit.
    pub class: u16,
    pub ttl: u32,
    pub data: RData,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Message {
    pub id: u16,
    pub flags: u16,
    pub questions: Vec<Question>,
    pub answers: Vec<Record>,
    pub authorities: Vec<Record>,
    pub additionals: Vec<Record>,
}

impl Message {
    pub fn is_response(&self) -> bool {
        self.flags & 0x8000 != 0
    }
}

fn write_name(out: &mut Vec<u8>, name: &str) {
    for label in name.trim_end_matches('.').split('.').filter(|l| !l.is_empty()) {
        let bytes = label.as_bytes();
        let len = bytes.len().min(63);
        out.push(len as u8);
        out.extend_from_slice(&bytes[..len]);
    }
    out.push(0);
}

fn write_record(out: &mut Vec<u8>, record: &Record) {
    write_name(out, &record.name);
    out.extend_from_slice(&record.rtype.to_be_bytes());
    out.extend_from_slice(&record.class.to_be_bytes());
    out.extend_from_slice(&record.ttl.to_be_bytes());
    let mut data = Vec::new();
    match &record.data {
        RData::A(address) => data.extend_from_slice(&address.octets()),
        RData::Ptr(name) => write_name(&mut data, name),
        RData::Srv { priority, weight, port, target } => {
            data.extend_from_slice(&priority.to_be_bytes());
            data.extend_from_slice(&weight.to_be_bytes());
            data.extend_from_slice(&port.to_be_bytes());
            write_name(&mut data, target);
        }
        RData::Txt(bytes) | RData::Other(bytes) => data.extend_from_slice(bytes),
    }
    out.extend_from_slice(&(data.len() as u16).to_be_bytes());
    out.extend_from_slice(&data);
}

pub fn encode(message: &Message) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&message.id.to_be_bytes());
    out.extend_from_slice(&message.flags.to_be_bytes());
    for count in [message.questions.len(), message.answers.len(), message.authorities.len(), message.additionals.len()]
    {
        out.extend_from_slice(&(count as u16).to_be_bytes());
    }
    for question in &message.questions {
        write_name(&mut out, &question.name);
        out.extend_from_slice(&question.qtype.to_be_bytes());
        out.extend_from_slice(&question.qclass.to_be_bytes());
    }
    for record in message.answers.iter().chain(&message.authorities).chain(&message.additionals) {
        write_record(&mut out, record);
    }
    out
}

struct Decoder<'a> {
    data: &'a [u8],
    at: usize,
}

impl Decoder<'_> {
    fn u16(&mut self) -> Option<u16> {
        let bytes = self.data.get(self.at..self.at + 2)?;
        self.at += 2;
        Some(u16::from_be_bytes([bytes[0], bytes[1]]))
    }

    fn u32(&mut self) -> Option<u32> {
        let bytes = self.data.get(self.at..self.at + 4)?;
        self.at += 4;
        Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn name(&mut self) -> Option<String> {
        let mut labels: Vec<String> = Vec::new();
        let mut at = self.at;
        let mut jumped = false;
        for _ in 0..128 {
            let len = *self.data.get(at)? as usize;
            if len == 0 {
                if !jumped {
                    self.at = at + 1;
                }
                let mut name = labels.join(".");
                name.push('.');
                return Some(name);
            }
            if len & 0xC0 == 0xC0 {
                let low = *self.data.get(at + 1)? as usize;
                if !jumped {
                    self.at = at + 2;
                }
                jumped = true;
                at = ((len & 0x3F) << 8) | low;
                continue;
            }
            if len & 0xC0 != 0 {
                return None;
            }
            let label = self.data.get(at + 1..at + 1 + len)?;
            labels.push(String::from_utf8_lossy(label).into_owned());
            at += 1 + len;
        }
        None
    }

    fn record(&mut self) -> Option<Record> {
        let name = self.name()?;
        let rtype = self.u16()?;
        let class = self.u16()?;
        let ttl = self.u32()?;
        let len = self.u16()? as usize;
        let end = self.at.checked_add(len)?;
        if end > self.data.len() {
            return None;
        }
        let data = match rtype {
            TYPE_A if len == 4 => {
                let b = &self.data[self.at..end];
                RData::A(Ipv4Addr::new(b[0], b[1], b[2], b[3]))
            }
            TYPE_PTR => RData::Ptr(self.name()?),
            TYPE_SRV => {
                let priority = self.u16()?;
                let weight = self.u16()?;
                let port = self.u16()?;
                RData::Srv { priority, weight, port, target: self.name()? }
            }
            TYPE_TXT => RData::Txt(self.data[self.at..end].to_vec()),
            _ => RData::Other(self.data[self.at..end].to_vec()),
        };
        self.at = end;
        Some(Record { name, rtype, class, ttl, data })
    }
}

pub fn decode(data: &[u8]) -> Option<Message> {
    let mut decoder = Decoder { data, at: 0 };
    let id = decoder.u16()?;
    let flags = decoder.u16()?;
    let counts = [decoder.u16()?, decoder.u16()?, decoder.u16()?, decoder.u16()?];
    let mut message = Message { id, flags, ..Default::default() };
    for _ in 0..counts[0] {
        let name = decoder.name()?;
        message.questions.push(Question { name, qtype: decoder.u16()?, qclass: decoder.u16()? });
    }
    for (count, list) in [
        (counts[1], &mut message.answers),
        (counts[2], &mut message.authorities),
        (counts[3], &mut message.additionals),
    ] {
        for _ in 0..count {
            list.push(decoder.record()?);
        }
    }
    Some(message)
}

fn same(a: &str, b: &str) -> bool {
    a.trim_end_matches('.').eq_ignore_ascii_case(b.trim_end_matches('.'))
}

// ---------------------------------------------------------------- services

/// A service to advertise, as python-zeroconf's `ServiceInfo` was built by tinyoscquery.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceSpec {
    /// `_oscjson._tcp.local.`
    pub service_type: String,
    /// `<instance>.<type>`
    pub instance: String,
    /// The SRV target.
    pub host: String,
    pub port: u16,
    /// TXT entries, `key=value`.
    pub txt: Vec<String>,
    pub address: Ipv4Addr,
}

impl ServiceSpec {
    fn records(&self, ttl_scale: u32) -> Vec<Record> {
        let mut txt = Vec::new();
        for entry in &self.txt {
            let bytes = entry.as_bytes();
            let len = bytes.len().min(255);
            txt.push(len as u8);
            txt.extend_from_slice(&bytes[..len]);
        }
        if txt.is_empty() {
            txt.push(0);
        }
        vec![
            Record {
                name: self.service_type.clone(),
                rtype: TYPE_PTR,
                class: CLASS_IN,
                ttl: OTHER_TTL * ttl_scale,
                data: RData::Ptr(self.instance.clone()),
            },
            Record {
                name: self.instance.clone(),
                rtype: TYPE_SRV,
                class: CLASS_IN | CACHE_FLUSH,
                ttl: HOST_TTL * ttl_scale,
                data: RData::Srv { priority: 0, weight: 0, port: self.port, target: self.host.clone() },
            },
            Record {
                name: self.instance.clone(),
                rtype: TYPE_TXT,
                class: CLASS_IN | CACHE_FLUSH,
                ttl: OTHER_TTL * ttl_scale,
                data: RData::Txt(txt),
            },
            Record {
                name: self.host.clone(),
                rtype: TYPE_A,
                class: CLASS_IN | CACHE_FLUSH,
                ttl: HOST_TTL * ttl_scale,
                data: RData::A(self.address),
            },
        ]
    }
}

/// A service another program advertises, as far as it is resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredService {
    /// The full instance name, `<instance>.<type>`.
    pub name: String,
    pub service_type: String,
    pub port: u16,
    /// The IPv4 addresses of the SRV target (python-zeroconf's `addresses`).
    pub addresses: Vec<Ipv4Addr>,
}

struct Cached {
    record: Record,
    expires: Instant,
}

struct Browse {
    service_type: String,
    next: Instant,
    interval: Duration,
}

struct Pending {
    due: Instant,
    message: Message,
}

#[derive(Default)]
struct State {
    services: Vec<ServiceSpec>,
    browsing: Vec<Browse>,
    cache: Vec<Cached>,
    pending: Vec<Pending>,
    /// When each resolving question was last asked, and how often: asked again after
    /// 1, 2, 4, ... seconds up to a minute, so an unresolvable service does not make
    /// every response on the network trigger a query.
    asked: Vec<(Question, Instant, u32)>,
}

impl State {
    fn add(&mut self, record: Record, now: Instant, flushed: &mut Vec<(String, u16)>) {
        if record.class & CACHE_FLUSH != 0 {
            let key = (record.name.to_ascii_lowercase(), record.rtype);
            if !flushed.contains(&key) {
                self.cache.retain(|c| !(c.record.rtype == key.1 && same(&c.record.name, &key.0)));
                flushed.push(key);
            }
        }
        self.cache.retain(|c| {
            !(c.record.rtype == record.rtype && same(&c.record.name, &record.name) && c.record.data == record.data)
        });
        if record.ttl > 0 {
            let expires = now + Duration::from_secs(record.ttl as u64);
            self.cache.push(Cached { record, expires });
        }
    }

    fn lookup(&self, name: &str, rtype: u16) -> impl Iterator<Item = &Record> + use<'_> {
        let name = name.to_string();
        self.cache.iter().map(|c| &c.record).filter(move |r| r.rtype == rtype && same(&r.name, &name))
    }

    fn discovered(&self, service_type: &str) -> Vec<DiscoveredService> {
        let mut found: Vec<DiscoveredService> = Vec::new();
        for ptr in self.lookup(service_type, TYPE_PTR) {
            let RData::Ptr(instance) = &ptr.data else { continue };
            if found.iter().any(|f| same(&f.name, instance)) {
                continue;
            }
            let Some((port, target)) = self.lookup(instance, TYPE_SRV).find_map(|r| match &r.data {
                RData::Srv { port, target, .. } => Some((*port, target.clone())),
                _ => None,
            }) else {
                continue;
            };
            let addresses: Vec<Ipv4Addr> = self
                .lookup(&target, TYPE_A)
                .filter_map(|r| match r.data {
                    RData::A(address) => Some(address),
                    _ => None,
                })
                .collect();
            found.push(DiscoveredService { name: instance.clone(), service_type: ptr.name.clone(), port, addresses });
        }
        found
    }

    /// The records this side answers `question` with: answers and additionals.
    fn answer(&self, question: &Question) -> (Vec<Record>, Vec<Record>) {
        let mut answers = Vec::new();
        let mut additionals = Vec::new();
        for service in &self.services {
            let records = service.records(1);
            let (ptr, srv, txt, a) = (&records[0], &records[1], &records[2], &records[3]);
            let wants = |t: u16| question.qtype == t || question.qtype == TYPE_ANY;
            if wants(TYPE_PTR) && same(&question.name, &service.service_type) {
                answers.push(ptr.clone());
                additionals.extend([srv.clone(), txt.clone(), a.clone()]);
            }
            if wants(TYPE_PTR) && same(&question.name, "_services._dns-sd._udp.local.") {
                answers.push(Record {
                    name: "_services._dns-sd._udp.local.".into(),
                    rtype: TYPE_PTR,
                    class: CLASS_IN,
                    ttl: OTHER_TTL,
                    data: RData::Ptr(service.service_type.clone()),
                });
            }
            if same(&question.name, &service.instance) {
                if wants(TYPE_SRV) {
                    answers.push(srv.clone());
                    additionals.push(a.clone());
                }
                if wants(TYPE_TXT) {
                    answers.push(txt.clone());
                }
            }
            if wants(TYPE_A) && same(&question.name, &service.host) {
                answers.push(a.clone());
            }
        }
        (answers, additionals)
    }
}

struct Sockets {
    listen: UdpSocket,
    /// One sending socket for each IPv4 address of the PC.
    respond: Vec<(Ipv4Addr, UdpSocket)>,
}

fn mdns_socket(bind: Ipv4Addr) -> io::Result<Socket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    #[cfg(all(unix, not(any(target_os = "solaris", target_os = "illumos"))))]
    socket.set_reuse_port(true)?;
    socket.bind(&SocketAddr::V4(SocketAddrV4::new(bind, MDNS_PORT)).into())?;
    Ok(socket)
}

fn local_ipv4_addresses() -> Vec<Ipv4Addr> {
    let mut addresses: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            IpAddr::V4(address) => Some(address),
            IpAddr::V6(_) => None,
        })
        .collect();
    addresses.sort();
    addresses.dedup();
    addresses
}

impl Sockets {
    fn open() -> io::Result<Self> {
        let listen = mdns_socket(Ipv4Addr::UNSPECIFIED)?;
        let mut respond = Vec::new();
        for address in local_ipv4_addresses() {
            // An interface that cannot join or send is skipped, as python-zeroconf does.
            if listen.join_multicast_v4(&MDNS_GROUP, &address).is_err() {
                continue;
            }
            let Ok(socket) = mdns_socket(address) else { continue };
            let configured = socket.set_multicast_if_v4(&address).is_ok()
                && socket.set_multicast_ttl_v4(255).is_ok()
                && socket.set_multicast_loop_v4(true).is_ok()
                && socket.set_read_timeout(Some(TICK)).is_ok();
            if configured {
                respond.push((address, socket.into()));
            }
        }
        listen.set_read_timeout(Some(TICK))?;
        Ok(Self { listen: listen.into(), respond })
    }

    fn multicast(&self, message: &Message) {
        let bytes = encode(message);
        let group = SocketAddr::V4(SocketAddrV4::new(MDNS_GROUP, MDNS_PORT));
        for (_, socket) in &self.respond {
            let _ = socket.send_to(&bytes, group);
        }
    }
}

struct Shared {
    sockets: Sockets,
    state: Mutex<State>,
    stopping: AtomicBool,
}

impl Shared {
    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn handle(&self, bytes: &[u8], from: SocketAddr, via: &UdpSocket) {
        let Some(message) = decode(bytes) else { return };
        if message.is_response() {
            self.learn(&message);
        } else {
            self.respond(&message, from, via);
        }
    }

    fn learn(&self, message: &Message) {
        let now = Instant::now();
        let mut state = self.state();
        let mut flushed = Vec::new();
        for record in message.answers.iter().chain(&message.additionals) {
            state.add(record.clone(), now, &mut flushed);
        }
        // A service seen by its PTR but not resolved yet: ask for the rest, as
        // python-zeroconf's listener does through get_service_info.
        let mut questions = Vec::new();
        let browsed: Vec<String> = state.browsing.iter().map(|b| b.service_type.clone()).collect();
        for service_type in &browsed {
            for ptr in state.lookup(service_type, TYPE_PTR) {
                let RData::Ptr(instance) = &ptr.data else { continue };
                let srv = state.lookup(instance, TYPE_SRV).find_map(|r| match &r.data {
                    RData::Srv { target, .. } => Some(target.clone()),
                    _ => None,
                });
                match srv {
                    None => {
                        questions.push(Question { name: instance.clone(), qtype: TYPE_SRV, qclass: CLASS_IN });
                        questions.push(Question { name: instance.clone(), qtype: TYPE_TXT, qclass: CLASS_IN });
                    }
                    Some(target) if state.lookup(&target, TYPE_A).next().is_none() => {
                        questions.push(Question { name: target, qtype: TYPE_A, qclass: CLASS_IN });
                    }
                    Some(_) => {}
                }
            }
        }
        questions.dedup();
        questions.retain(|question| match state.asked.iter_mut().find(|(asked, _, _)| asked == question) {
            Some((_, last, count)) => {
                let wait = RESOLVE_FIRST * 2u32.saturating_pow((*count).min(6));
                if now.saturating_duration_since(*last) < wait.min(RESOLVE_LIMIT) {
                    return false;
                }
                *last = now;
                *count += 1;
                true
            }
            None => {
                state.asked.push((question.clone(), now, 0));
                true
            }
        });
        drop(state);
        if !questions.is_empty() {
            self.sockets.multicast(&Message { questions, ..Default::default() });
        }
    }

    fn respond(&self, query: &Message, from: SocketAddr, via: &UdpSocket) {
        let state = self.state();
        let mut answers = Vec::new();
        let mut additionals = Vec::new();
        for question in &query.questions {
            let (a, b) = state.answer(question);
            answers.extend(a);
            additionals.extend(b);
        }
        drop(state);
        // Known answers the asker already holds (with more than half their TTL) are
        // not repeated (RFC 6762, 7.1).
        answers.retain(|answer| {
            !query.answers.iter().any(|known| {
                known.rtype == answer.rtype
                    && same(&known.name, &answer.name)
                    && known.data == answer.data
                    && known.ttl >= answer.ttl / 2
            })
        });
        if answers.is_empty() {
            return;
        }
        additionals.retain(|record| !answers.contains(record));
        additionals.dedup();
        if from.port() != MDNS_PORT {
            // A legacy unicast query: answer it directly, echoing the question, with
            // TTLs of at most 10 seconds (RFC 6762, 6.7).
            let cap = |mut r: Record| {
                r.ttl = r.ttl.min(10);
                r.class &= !CACHE_FLUSH;
                r
            };
            let reply = Message {
                id: query.id,
                flags: FLAGS_RESPONSE,
                questions: query.questions.clone(),
                answers: answers.into_iter().map(cap).collect(),
                authorities: Vec::new(),
                additionals: additionals.into_iter().map(cap).collect(),
            };
            let _ = via.send_to(&encode(&reply), from);
            return;
        }
        self.sockets.multicast(&Message { flags: FLAGS_RESPONSE, answers, additionals, ..Default::default() });
    }

    fn tick(&self) {
        let now = Instant::now();
        let mut due = Vec::new();
        {
            let mut state = self.state();
            state.cache.retain(|c| c.expires > now);
            state.asked.retain(|(_, last, _)| now.saturating_duration_since(*last) < BROWSE_LIMIT);
            let mut index = 0;
            while index < state.pending.len() {
                if state.pending[index].due <= now {
                    due.push(state.pending.remove(index).message);
                } else {
                    index += 1;
                }
            }
            for browse in &mut state.browsing {
                if browse.next <= now {
                    due.push(ptr_query(&browse.service_type));
                    browse.next = now + browse.interval;
                    browse.interval = (browse.interval * 2).min(BROWSE_LIMIT);
                }
            }
        }
        for message in due {
            self.sockets.multicast(&message);
        }
    }
}

fn ptr_query(service_type: &str) -> Message {
    Message {
        questions: vec![Question { name: service_type.to_string(), qtype: TYPE_PTR, qclass: CLASS_IN }],
        ..Default::default()
    }
}

/// One mDNS endpoint: the equivalent of one python-zeroconf `Zeroconf` instance.
pub struct Mdns {
    shared: Arc<Shared>,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

impl Mdns {
    /// Open the sockets and start listening. Fails when port 5353 cannot be bound.
    pub fn start() -> io::Result<Self> {
        let sockets = Sockets::open()?;
        let shared =
            Arc::new(Shared { sockets, state: Mutex::new(State::default()), stopping: AtomicBool::new(false) });
        let mut threads = Vec::new();
        let count = 1 + shared.sockets.respond.len();
        for index in 0..count {
            let receiving = shared.clone();
            let spawned = thread::Builder::new().name("mdns_receive".into()).spawn(move || {
                let shared = receiving;
                let socket = if index == 0 { &shared.sockets.listen } else { &shared.sockets.respond[index - 1].1 };
                let mut buffer = vec![0u8; MAX_PACKET];
                while !shared.stopping.load(Ordering::SeqCst) {
                    if let Ok((size, from)) = socket.recv_from(&mut buffer) {
                        shared.handle(&buffer[..size], from, socket);
                    }
                }
            });
            match spawned {
                Ok(thread) => threads.push(thread),
                Err(error) => {
                    shared.stopping.store(true, Ordering::SeqCst);
                    for thread in threads {
                        let _ = thread.join();
                    }
                    return Err(error);
                }
            }
        }
        let timer = shared.clone();
        let spawned = thread::Builder::new().name("mdns_timer".into()).spawn(move || {
            while !timer.stopping.load(Ordering::SeqCst) {
                timer.tick();
                thread::sleep(TICK);
            }
        });
        match spawned {
            Ok(thread) => threads.push(thread),
            Err(error) => {
                shared.stopping.store(true, Ordering::SeqCst);
                for thread in threads {
                    let _ = thread.join();
                }
                return Err(error);
            }
        }
        Ok(Self { shared, threads: Mutex::new(threads) })
    }

    /// Advertise `service` and announce it three times.
    pub fn register(&self, service: ServiceSpec) {
        let announcement = Message { flags: FLAGS_RESPONSE, answers: service.records(1), ..Default::default() };
        let mut state = self.shared.state();
        state.services.push(service);
        let mut due = Instant::now();
        for gap in ANNOUNCE_GAPS {
            due += gap;
            state.pending.push(Pending { due, message: announcement.clone() });
        }
        drop(state);
        self.shared.tick();
    }

    /// Withdraw every service, sending each goodbye three times, 125 ms apart.
    pub fn unregister_all(&self) {
        let services = {
            let mut state = self.shared.state();
            // Announcements still waiting would advertise the services again after the
            // goodbye, and every cache would keep them for their full TTL.
            state.pending.clear();
            std::mem::take(&mut state.services)
        };
        if services.is_empty() {
            return;
        }
        let goodbye = Message {
            flags: FLAGS_RESPONSE,
            answers: services.iter().flat_map(|s| s.records(0)).collect(),
            ..Default::default()
        };
        for round in 0..3 {
            if round > 0 {
                thread::sleep(GOODBYE_GAP);
            }
            self.shared.sockets.multicast(&goodbye);
        }
    }

    /// Look for services of `service_type` from now on.
    pub fn browse(&self, service_type: &str) {
        let mut state = self.shared.state();
        if state.browsing.iter().any(|b| same(&b.service_type, service_type)) {
            return;
        }
        state.browsing.push(Browse {
            service_type: service_type.to_string(),
            next: Instant::now(),
            interval: BROWSE_FIRST,
        });
        drop(state);
        self.shared.tick();
    }

    /// Ask now who offers `service_type`; answers reach the cache like any other.
    pub fn ask_again(&self, service_type: &str) {
        self.shared.sockets.multicast(&ptr_query(service_type));
    }

    /// The services of `service_type` that are known and resolved to a port.
    pub fn discovered(&self, service_type: &str) -> Vec<DiscoveredService> {
        self.shared.state().discovered(service_type)
    }

    /// Stop the threads (after a goodbye for registered services). The sockets close
    /// when the last owner lets go.
    pub fn close(&self) {
        self.unregister_all();
        self.shutdown();
    }

    fn shutdown(&self) {
        self.shared.stopping.store(true, Ordering::SeqCst);
        let threads = std::mem::take(&mut *self.threads.lock().unwrap_or_else(|e| e.into_inner()));
        for thread in threads {
            let _ = thread.join();
        }
    }
}

impl Drop for Mdns {
    fn drop(&mut self) {
        self.shutdown();
    }
}
