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
//!   Joining and sending on the loopback interface alone is not enough: VRChat and this
//!   app then do not find each other (#559, checked with VRChat in desktop mode on
//!   Windows).
//! - Nothing goes beyond the PC (#559). The services' only address is `127.0.0.1`, so
//!   other machines could never use them; they could only learn that the app runs.
//!   Packets go out with IP TTL 0 ([`MULTICAST_TTL`]): the OS hands them to this PC's
//!   own members of the group, VRChat included, and does not send them on the network.
//!   Packets that did not come from this PC are ignored, so another machine's query
//!   gets no answer and its records are not learnt. python-zeroconf sent with TTL 255,
//!   as RFC 6762 asks; VRChat and python-zeroconf both take packets with TTL 0.
//! - PTR and TXT records live 4500 seconds, SRV and A records 120 seconds; a goodbye
//!   repeats the records with TTL 0.
//! - Browsing asks at once, then after 1, 2, 4, ... seconds up to an hour, and again
//!   whenever asked to.
//!
//! On Windows nothing is received on port 5353 (#442). Windows Defender Firewall asks whether
//! to let a program receive from the network the first time it receives on an address other
//! than loopback, once for each program path, so every new folder of the app asked again. There
//! each interface gets a socket on `0.0.0.0` with a port the OS picks, which only sends and
//! hears what is sent back to it:
//!
//! - Services are announced again every [`REANNOUNCE_EVERY`] instead of answering queries,
//!   so VRChat finds them when it starts after the app. VRChat's mDNS (MeaMod.DNS) takes an
//!   answer whatever port it came from.
//! - Questions go from the OS-picked port, which makes them legacy unicast queries: VRChat
//!   answers them to that port (RFC 6762, 6.7), with TTLs of at most 10 seconds. Browsing
//!   therefore asks at least every [`BROWSE_UNHEARD_LIMIT`].
//! - Two programs that both only send, such as two of these, do not find each other.
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
/// The IP time-to-live of every packet sent. 0 keeps multicast on this PC: it is looped back
/// to the PC's own members of the group and never put on the network (RFC 1112; Linux drops
/// such a packet after its local copy, and Windows did not send it in a test, #559).
pub const MULTICAST_TTL: u32 = 0;
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
/// How many records the cache keeps. VRChat's OSCQuery services on one LAN need a few dozen.
const MAX_CACHE: usize = 1024;
/// How many resolving questions are remembered for their back-off.
const MAX_ASKED: usize = 256;
const RESOLVE_FIRST: Duration = Duration::from_secs(1);
const RESOLVE_LIMIT: Duration = Duration::from_secs(60);
/// Without a socket on port 5353 (Windows, #442): how often registered services are announced
/// again, so VRChat started later finds them.
pub const REANNOUNCE_EVERY: Duration = Duration::from_secs(5);
/// Without a socket on port 5353: the longest wait between browsing questions. Legacy unicast
/// answers live at most 10 seconds, and the answers to others' questions are not heard.
pub const BROWSE_UNHEARD_LIMIT: Duration = Duration::from_secs(5);
/// Whether this build receives on port 5353 (all but Windows, #442).
pub const LISTENS_ON_MDNS_PORT: bool = !cfg!(windows);

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
    /// Without a socket on port 5353: when the services were last announced.
    announced: Option<Instant>,
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
            // A record is kept at most as long as this side's longest TTL, and the cache holds
            // at most MAX_CACHE of them: the soonest to expire goes first. Every addition and
            // every tick walks the cache, so a LAN that answers with many records must not
            // make it grow without end.
            let expires = now + Duration::from_secs(u64::from(record.ttl.min(OTHER_TTL)));
            self.cache.push(Cached { record, expires });
            while self.cache.len() > MAX_CACHE {
                let soonest = self.cache.iter().enumerate().min_by_key(|(_, c)| c.expires).map(|(i, _)| i);
                if let Some(index) = soonest {
                    self.cache.swap_remove(index);
                }
            }
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
    /// `0.0.0.0:5353`, joined on every address; `None` where nothing is received on port 5353
    /// ([`LISTENS_ON_MDNS_PORT`]).
    listen: Option<UdpSocket>,
    /// One sending socket for each IPv4 address of the PC: on that address and port 5353, or,
    /// without the listening socket, on `0.0.0.0` and a port the OS picks.
    respond: Vec<(Ipv4Addr, UdpSocket)>,
    /// The PC's IPv4 addresses, and when they were read: what a packet from this PC comes from.
    own: Mutex<(Instant, Vec<Ipv4Addr>)>,
}

/// How often an unknown sender makes the PC's addresses be read again: an address can change
/// while the app runs (a new lease, a VPN), and a flood from the network must not cost a
/// lookup for every packet.
const OWN_ADDRESSES_REFRESH: Duration = Duration::from_secs(5);

/// Whether `from` is this PC: a loopback address, or one of `own`.
fn sent_by_this_pc(from: &SocketAddr, own: &[Ipv4Addr]) -> bool {
    match from.ip() {
        IpAddr::V4(address) => address.is_loopback() || own.contains(&address),
        IpAddr::V6(address) => address.is_loopback(),
    }
}

fn mdns_socket(bind: Ipv4Addr) -> io::Result<Socket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    #[cfg(all(unix, not(any(target_os = "solaris", target_os = "illumos"))))]
    socket.set_reuse_port(true)?;
    socket.bind(&SocketAddr::V4(SocketAddrV4::new(bind, MDNS_PORT)).into())?;
    Ok(socket)
}

/// The socket that sends through `address`, set up so that its packets stay on this PC; `None`
/// when that cannot be set up (a socket that would send beyond the PC is not used). With
/// `on_mdns_port` it is bound to `address` and port 5353; without, to `0.0.0.0` and a port the
/// OS picks, which receives nothing but what is sent to it (no firewall question, #442).
fn sending_socket(address: Ipv4Addr, on_mdns_port: bool) -> Option<UdpSocket> {
    let socket = if on_mdns_port {
        mdns_socket(address).ok()?
    } else {
        let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)).ok()?;
        socket.bind(&SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)).into()).ok()?;
        socket
    };
    let configured = socket.set_multicast_if_v4(&address).is_ok()
        && socket.set_multicast_ttl_v4(MULTICAST_TTL).is_ok()
        && socket.set_multicast_loop_v4(true).is_ok()
        && socket.set_read_timeout(Some(TICK)).is_ok();
    configured.then(|| socket.into())
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
        let own = local_ipv4_addresses();
        if !LISTENS_ON_MDNS_PORT {
            let respond: Vec<(Ipv4Addr, UdpSocket)> =
                own.iter().filter_map(|&address| Some((address, sending_socket(address, false)?))).collect();
            if respond.is_empty() {
                return Err(io::Error::new(io::ErrorKind::AddrNotAvailable, "no interface can send mDNS"));
            }
            return Ok(Self { listen: None, respond, own: Mutex::new((Instant::now(), own)) });
        }
        let listen = mdns_socket(Ipv4Addr::UNSPECIFIED)?;
        let mut respond = Vec::new();
        for &address in &own {
            // An interface that cannot join or send is skipped, as python-zeroconf does.
            if listen.join_multicast_v4(&MDNS_GROUP, &address).is_err() {
                continue;
            }
            if let Some(socket) = sending_socket(address, true) {
                respond.push((address, socket));
            }
        }
        listen.set_read_timeout(Some(TICK))?;
        Ok(Self { listen: Some(listen.into()), respond, own: Mutex::new((Instant::now(), own)) })
    }

    /// Whether `from` is this PC. An unknown sender reads the PC's addresses again, at most
    /// once every [`OWN_ADDRESSES_REFRESH`].
    fn is_this_pc(&self, from: &SocketAddr) -> bool {
        let mut own = self.own.lock().unwrap_or_else(|e| e.into_inner());
        if sent_by_this_pc(from, &own.1) {
            return true;
        }
        if own.0.elapsed() < OWN_ADDRESSES_REFRESH {
            return false;
        }
        *own = (Instant::now(), local_ipv4_addresses());
        sent_by_this_pc(from, &own.1)
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
        // Another machine's query is not answered and its records are not learnt (#559).
        if !self.sockets.is_this_pc(&from) {
            return;
        }
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
                if state.asked.len() >= MAX_ASKED {
                    // The question asked longest ago makes room.
                    if let Some(oldest) =
                        state.asked.iter().enumerate().min_by_key(|(_, (_, last, _))| *last).map(|(i, _)| i)
                    {
                        state.asked.swap_remove(oldest);
                    }
                }
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
        // Without a socket on port 5353 others' questions and announcements are not heard (#442).
        let unheard = self.sockets.listen.is_none();
        {
            let mut state = self.state();
            if unheard
                && !state.services.is_empty()
                && state.announced.is_none_or(|last| now.saturating_duration_since(last) >= REANNOUNCE_EVERY)
            {
                due.push(Message {
                    flags: FLAGS_RESPONSE,
                    answers: state.services.iter().flat_map(|s| s.records(1)).collect(),
                    ..Default::default()
                });
                state.announced = Some(now);
            }
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
                    browse.interval =
                        (browse.interval * 2).min(if unheard { BROWSE_UNHEARD_LIMIT } else { BROWSE_LIMIT });
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
    /// Open the sockets and start listening. Fails when port 5353 cannot be bound (where it is
    /// listened on), or when no interface can send.
    pub fn start() -> io::Result<Self> {
        let sockets = Sockets::open()?;
        let shared =
            Arc::new(Shared { sockets, state: Mutex::new(State::default()), stopping: AtomicBool::new(false) });
        let mut threads = Vec::new();
        // The listening socket, when there is one, then each sending socket.
        let listening = usize::from(shared.sockets.listen.is_some());
        let count = listening + shared.sockets.respond.len();
        for index in 0..count {
            let receiving = shared.clone();
            let spawned = thread::Builder::new().name("mdns_receive".into()).spawn(move || {
                let shared = receiving;
                let socket = match (&shared.sockets.listen, index) {
                    (Some(listen), 0) => listen,
                    _ => &shared.sockets.respond[index - listening].1,
                };
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
        // The repeated announcements of all services start after these.
        state.announced = Some(due);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn a_record(index: u32, ttl: u32) -> Record {
        Record {
            name: format!("host-{index}.local."),
            rtype: TYPE_A,
            class: CLASS_IN,
            ttl,
            data: RData::A(Ipv4Addr::from(index)),
        }
    }

    #[test]
    fn the_cache_is_bounded_and_keeps_no_record_longer_than_its_own_longest_ttl() {
        // #428: every record of the LAN was kept, with its TTL, without a limit.
        let mut state = State::default();
        let now = Instant::now();
        state.add(a_record(0, u32::MAX), now, &mut Vec::new());
        assert!(state.cache[0].expires <= now + Duration::from_secs(u64::from(OTHER_TTL)));
        for index in 1..(MAX_CACHE as u32 + 500) {
            state.add(a_record(index, 120 + index), now, &mut Vec::new());
        }
        assert_eq!(state.cache.len(), MAX_CACHE);
        // The soonest to expire went first; the latest records are kept.
        assert!(state.lookup(&format!("host-{}.local.", MAX_CACHE as u32 + 499), TYPE_A).next().is_some());
        assert!(state.lookup("host-1.local.", TYPE_A).next().is_none());
    }

    #[test]
    fn only_this_pc_counts_as_a_sender() {
        let own = [Ipv4Addr::new(192, 168, 1, 20)];
        let from = |ip: IpAddr| SocketAddr::new(ip, MDNS_PORT);
        assert!(sent_by_this_pc(&from(Ipv4Addr::LOCALHOST.into()), &own));
        assert!(sent_by_this_pc(&from(Ipv4Addr::new(127, 0, 0, 2).into()), &own));
        assert!(sent_by_this_pc(&from(own[0].into()), &own));
        assert!(sent_by_this_pc(&from(std::net::Ipv6Addr::LOCALHOST.into()), &own));
        assert!(!sent_by_this_pc(&from(Ipv4Addr::new(192, 168, 1, 21).into()), &own));
        assert!(!sent_by_this_pc(&from(Ipv4Addr::new(10, 0, 0, 1).into()), &[]));
    }

    /// An endpoint whose sockets are on loopback only: these tests open nothing on the network
    /// (and so raise no firewall question on Windows).
    fn shared_on_loopback() -> Shared {
        shared_with(Some(UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap()))
    }

    fn shared_with(listen: Option<UdpSocket>) -> Shared {
        let sockets = Sockets { listen, respond: Vec::new(), own: Mutex::new((Instant::now(), Vec::new())) };
        Shared { sockets, state: Mutex::new(State::default()), stopping: AtomicBool::new(false) }
    }

    #[test]
    fn every_packet_sent_stays_on_this_pc() {
        // #559: the announcements went out on every network the PC was on. Both kinds of sending
        // socket (#442).
        for on_mdns_port in [true, false] {
            let Some(socket) = sending_socket(Ipv4Addr::LOCALHOST, on_mdns_port) else {
                eprintln!("mDNS is not available here; skipped");
                return;
            };
            assert_eq!(socket.multicast_ttl_v4().unwrap(), MULTICAST_TTL);
            assert!(socket.multicast_loop_v4().unwrap(), "this PC's own members still hear it");
        }
    }

    #[test]
    fn without_the_mdns_port_a_socket_only_sends_from_a_port_the_os_picked() {
        // #442: Windows asks about a program that receives on an address other than loopback; a
        // socket on 0.0.0.0 with a port the OS picks is not asked about.
        let socket = sending_socket(Ipv4Addr::LOCALHOST, false).expect("a sending socket");
        let address = socket.local_addr().unwrap();
        assert!(address.ip().is_unspecified());
        assert_ne!(address.port(), MDNS_PORT);
        assert_eq!(LISTENS_ON_MDNS_PORT, !cfg!(windows));
    }

    #[test]
    fn without_the_mdns_port_services_are_announced_again_and_browsing_asks_often() {
        // #442: neither VRChat's question nor its announcements are heard there.
        let spec = ServiceSpec {
            service_type: "_oscjson._tcp.local.".into(),
            instance: "VRCT:test._oscjson._tcp.local.".into(),
            host: "VRCT:test.oscjson.local.".into(),
            port: 4321,
            txt: vec![],
            address: Ipv4Addr::LOCALHOST,
        };
        for (listen, announces, limit) in [
            (None, true, BROWSE_UNHEARD_LIMIT),
            (Some(UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap()), false, BROWSE_LIMIT),
        ] {
            let shared = shared_with(listen);
            {
                let mut state = shared.state();
                state.services.push(spec.clone());
                state.announced = Some(Instant::now() - REANNOUNCE_EVERY);
                state.browsing.push(Browse {
                    service_type: spec.service_type.clone(),
                    next: Instant::now(),
                    interval: Duration::from_secs(4),
                });
            }
            shared.tick();
            let state = shared.state();
            let announced_now = state.announced.is_some_and(|last| last.elapsed() < Duration::from_secs(1));
            assert_eq!(announced_now, announces);
            assert_eq!(state.browsing[0].interval, Duration::from_secs(8).min(limit));
        }
    }

    #[test]
    fn a_packet_from_another_machine_is_ignored() {
        let shared = shared_on_loopback();
        let answer = encode(&Message { flags: FLAGS_RESPONSE, answers: vec![a_record(7, 120)], ..Default::default() });
        let via = shared.sockets.listen.as_ref().unwrap();
        // TEST-NET-1 (RFC 5737) is never one of the PC's own addresses.
        shared.handle(&answer, SocketAddr::new(Ipv4Addr::new(192, 0, 2, 7).into(), MDNS_PORT), via);
        assert!(shared.state().cache.is_empty(), "a record from the network was learnt");
        shared.handle(&answer, SocketAddr::new(Ipv4Addr::LOCALHOST.into(), MDNS_PORT), via);
        assert_eq!(shared.state().cache.len(), 1);
    }

    #[test]
    fn a_query_from_this_pc_is_still_answered() {
        let shared = shared_on_loopback();
        shared.state().services.push(ServiceSpec {
            service_type: "_oscjson._tcp.local.".into(),
            instance: "VRCT:test._oscjson._tcp.local.".into(),
            host: "VRCT:test.oscjson.local.".into(),
            port: 4321,
            txt: vec!["txtvers=1".into()],
            address: Ipv4Addr::LOCALHOST,
        });
        // A legacy unicast query (not from port 5353) is answered on the asker's own socket.
        let asker = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        asker.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let query = encode(&ptr_query("_oscjson._tcp.local."));
        shared.handle(&query, asker.local_addr().unwrap(), shared.sockets.listen.as_ref().unwrap());
        let mut buffer = [0u8; MAX_PACKET];
        let (size, _) = asker.recv_from(&mut buffer).expect("an answer");
        let reply = decode(&buffer[..size]).unwrap();
        assert_eq!(reply.answers[0].data, RData::Ptr("VRCT:test._oscjson._tcp.local.".into()));
    }
}
