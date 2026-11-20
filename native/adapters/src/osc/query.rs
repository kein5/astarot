//! OSCQuery over HTTP: this app's own service (what tinyoscquery served) and the
//! client that asks VRChat's service for its host info and a parameter value.

use std::io::{self, Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::mdns::{Mdns, ServiceSpec};

/// Each HTTP request, served or sent, has this absolute deadline.
pub const HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
pub const OSCJSON_TYPE: &str = "_oscjson._tcp.local.";
pub const OSC_TYPE: &str = "_osc._udp.local.";
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const MAX_HEAD: usize = 64 * 1024;
const MAX_BODY: usize = 4 * 1024 * 1024;

/// Access of an advertised endpoint (tinyoscquery's `OSCAccess`).
pub const READWRITE_VALUE: u8 = 3;

/// A JSON string the way Python's `json.dumps` writes it (`ensure_ascii=True`).
pub fn python_json_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || (c as u32) > 0x7f => {
                let mut units = [0u16; 2];
                for unit in c.encode_utf16(&mut units) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A node of the OSCQuery tree, with tinyoscquery's JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    pub full_path: String,
    pub access: Option<u8>,
    pub description: Option<String>,
    /// `None` until the first child is added, as in tinyoscquery.
    pub contents: Option<Vec<Node>>,
}

impl Node {
    pub fn new(full_path: &str) -> Self {
        Self { full_path: full_path.to_string(), access: None, description: None, contents: None }
    }

    pub fn root() -> Self {
        Self { description: Some("root node".into()), ..Self::new("/") }
    }

    pub fn find(&self, full_path: &str) -> Option<&Node> {
        if self.full_path == full_path {
            return Some(self);
        }
        self.contents.as_ref()?.iter().find_map(|child| child.find(full_path))
    }

    fn find_mut(&mut self, full_path: &str) -> Option<&mut Node> {
        if self.full_path == full_path {
            return Some(self);
        }
        self.contents.as_mut()?.iter_mut().find_map(|child| child.find_mut(full_path))
    }

    /// `add_child_node`: missing parents are made on the way.
    pub fn add(&mut self, child: Node) {
        let Some((parent, _)) = child.full_path.rsplit_once('/') else { return };
        let parent = if parent.is_empty() { "/" } else { parent }.to_string();
        if self.find(&parent).is_none() {
            self.add(Node::new(&parent));
        }
        if let Some(parent) = self.find_mut(&parent) {
            parent.contents.get_or_insert_with(Vec::new).push(child);
        }
    }

    /// `advertise_endpoint(address, access=READWRITE_VALUE)` with no value.
    pub fn advertise(&mut self, address: &str) {
        self.add(Node { access: Some(READWRITE_VALUE), ..Node::new(address) });
    }

    /// tinyoscquery's JSON: CONTENTS, FULL_PATH, ACCESS, DESCRIPTION, in that order,
    /// leaving out what is unset.
    pub fn to_json(&self) -> String {
        let mut fields = Vec::new();
        if let Some(contents) = &self.contents {
            // A Python dict: a repeated key keeps its first place and its last value.
            let mut keys: Vec<(String, String)> = Vec::new();
            for child in contents {
                let key = child.full_path.rsplit('/').next().unwrap_or("").to_string();
                let value = child.to_json();
                match keys.iter_mut().find(|(k, _)| *k == key) {
                    Some(entry) => entry.1 = value,
                    None => keys.push((key, value)),
                }
            }
            let body: Vec<String> =
                keys.into_iter().map(|(k, v)| format!("{}: {}", python_json_string(&k), v)).collect();
            fields.push(format!("\"CONTENTS\": {{{}}}", body.join(", ")));
        }
        fields.push(format!("\"FULL_PATH\": {}", python_json_string(&self.full_path)));
        if let Some(access) = self.access {
            fields.push(format!("\"ACCESS\": {access}"));
        }
        if let Some(description) = &self.description {
            fields.push(format!("\"DESCRIPTION\": {}", python_json_string(description)));
        }
        format!("{{{}}}", fields.join(", "))
    }
}

/// tinyoscquery's host info for a UDP OSC server on loopback.
pub fn host_info_json(name: &str, osc_port: u16) -> String {
    format!(
        "{{\"NAME\": {}, \"OSC_IP\": \"127.0.0.1\", \"OSC_PORT\": {osc_port}, \"OSC_TRANSPORT\": \"UDP\", \
         \"EXTENSIONS\": {{\"ACCESS\": true, \"CLIPMODE\": false, \"RANGE\": true, \"TYPE\": true, \"VALUE\": true}}}}",
        python_json_string(name)
    )
}

/// Read a request head before `deadline`, never more than 64 KiB.
fn read_head(stream: &mut TcpStream, deadline: Instant, stopping: &AtomicBool) -> io::Result<Vec<u8>> {
    let mut head = Vec::new();
    let mut buffer = [0u8; 2048];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") && !head.windows(2).any(|w| w == b"\n\n") {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() || head.len() > MAX_HEAD || stopping.load(Ordering::SeqCst) {
            return Err(io::ErrorKind::TimedOut.into());
        }
        // Short reads, so that stopping the service does not wait for a slow peer.
        stream.set_read_timeout(Some(left.min(POLL_INTERVAL)))?;
        let read = match stream.read(&mut buffer) {
            Ok(read) => read,
            Err(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => continue,
            Err(e) => return Err(e),
        };
        if read == 0 {
            break;
        }
        head.extend_from_slice(&buffer[..read]);
    }
    Ok(head)
}

struct ServiceState {
    name: String,
    osc_port: u16,
    root: Node,
}

fn serve_one(mut stream: TcpStream, state: &RwLock<ServiceState>, stopping: &AtomicBool) {
    // An absolute deadline also stops a peer that drips partial headers.
    let deadline = Instant::now() + HTTP_REQUEST_TIMEOUT;
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_write_timeout(Some(HTTP_REQUEST_TIMEOUT));
    let Ok(head) = read_head(&mut stream, deadline, stopping) else {
        let _ = stream.shutdown(Shutdown::Both);
        return;
    };
    let text = String::from_utf8_lossy(&head);
    let line = text.lines().next().unwrap_or("");
    let words: Vec<&str> = line.split_whitespace().collect();
    let reply = match words.as_slice() {
        // A page in a browser can rebind its own name to 127.0.0.1 and read this service as
        // same-origin; its requests carry that name in `Host` (#459). VRChat and other OSCQuery
        // clients ask by address. A request without `Host` (HTTP/1.0) cannot come from a browser.
        ["GET", ..] if !host_allowed(request_header(&text, "host")) => Some((403, "Forbidden", String::new())),
        ["GET", path, ..] => {
            let state = state.read().unwrap_or_else(|e| e.into_inner());
            if path.contains("HOST_INFO") {
                Some((200, "OK", host_info_json(&state.name, state.osc_port)))
            } else {
                match state.root.find(path) {
                    Some(node) => Some((200, "OK", node.to_json())),
                    None => Some((404, "Not Found", "OSC Path not found".to_string())),
                }
            }
        }
        [] => None,
        _ => Some((501, "Not Implemented", String::new())),
    };
    if let Some((status, reason, body)) = reply {
        let response =
            format!("HTTP/1.0 {status} {reason}\r\nContent-type: text/json\r\nConnection: close\r\n\r\n{body}");
        let _ = stream.write_all(response.as_bytes());
    }
    let _ = stream.shutdown(Shutdown::Both);
}

/// The value of a request header, if present (the first one, case-insensitive name).
fn request_header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines()
        .skip(1)
        .take_while(|l| !l.trim().is_empty())
        .find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case(name)).map(|(_, v)| v.trim()))
}

/// No `Host`, or one that names an IP address or `localhost`, as the OBS browser source checks it.
fn host_allowed(host: Option<&str>) -> bool {
    host.is_none() || crate::obs::is_trusted_host_header(host)
}

/// This app's OSCQuery service: the HTTP server for its tree and host info, and its
/// two mDNS advertisements (`_oscjson._tcp` and `_osc._udp`) with the address 127.0.0.1.
pub struct QueryService {
    state: Arc<RwLock<ServiceState>>,
    http_port: u16,
    stopping: Arc<AtomicBool>,
    http_thread: Option<JoinHandle<()>>,
    mdns: Option<Mdns>,
}

impl QueryService {
    /// Serve and advertise `server_name` for the OSC server on `osc_port`. On failure
    /// everything acquired so far is closed before the error returns.
    pub fn start(server_name: &str, osc_port: u16) -> io::Result<Self> {
        let state = Arc::new(RwLock::new(ServiceState { name: server_name.to_string(), osc_port, root: Node::root() }));
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let http_port = listener.local_addr()?.port();
        let stopping = Arc::new(AtomicBool::new(false));
        let serving_state = state.clone();
        let serving_stop = stopping.clone();
        let http_thread = thread::Builder::new().name("osc_query_http".into()).spawn(move || {
            while !serving_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => serve_one(stream, &serving_state, &serving_stop),
                    Err(_) => thread::sleep(POLL_INTERVAL),
                }
            }
        })?;
        let mut service = Self { state, http_port, stopping, http_thread: Some(http_thread), mdns: None };
        let mdns = Mdns::start()?; // `service` is dropped (and its thread stopped) on error.
        mdns.register(ServiceSpec {
            service_type: OSCJSON_TYPE.into(),
            instance: format!("{server_name}.{OSCJSON_TYPE}"),
            host: format!("{server_name}.oscjson.local."),
            port: http_port,
            txt: vec!["txtvers=1".into()],
            address: Ipv4Addr::LOCALHOST,
        });
        mdns.register(ServiceSpec {
            service_type: OSC_TYPE.into(),
            instance: format!("{server_name}.{OSC_TYPE}"),
            host: format!("{server_name}.osc.local."),
            port: osc_port,
            txt: vec!["txtvers=1".into()],
            address: Ipv4Addr::LOCALHOST,
        });
        service.mdns = Some(mdns);
        Ok(service)
    }

    pub fn http_port(&self) -> u16 {
        self.http_port
    }

    pub fn advertise_endpoint(&self, address: &str) {
        self.state.write().unwrap_or_else(|e| e.into_inner()).root.advertise(address);
    }

    /// Withdraw the advertisements and stop the HTTP server.
    pub fn close(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.stopping.store(true, Ordering::SeqCst);
        if let Some(mdns) = self.mdns.take() {
            mdns.close();
        }
        if let Some(thread) = self.http_thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for QueryService {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ---------------------------------------------------------------- client

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientError {
    /// Connecting, sending or reading failed or took too long.
    Transport,
    /// The body was not JSON.
    Json,
}

/// `GET http://<ip>:<port><path>`, without proxies or redirects, within 2 seconds.
/// `Ok(None)` for any status other than 200.
pub fn get_json(ip: IpAddr, port: u16, path: &str) -> Result<Option<Value>, ClientError> {
    let deadline = Instant::now() + HTTP_REQUEST_TIMEOUT;
    let address = SocketAddr::new(ip, port);
    let mut stream = TcpStream::connect_timeout(&address, HTTP_REQUEST_TIMEOUT).map_err(|_| ClientError::Transport)?;
    let host = match ip {
        IpAddr::V4(v4) => format!("{v4}:{port}"),
        IpAddr::V6(v6) => format!("[{v6}]:{port}"),
    };
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: ASTAROT\r\nAccept: */*\r\nConnection: close\r\n\r\n"
    );
    stream.set_write_timeout(Some(HTTP_REQUEST_TIMEOUT)).map_err(|_| ClientError::Transport)?;
    stream.write_all(request.as_bytes()).map_err(|_| ClientError::Transport)?;
    let mut raw = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() || raw.len() > MAX_HEAD + MAX_BODY {
            return Err(ClientError::Transport);
        }
        stream.set_read_timeout(Some(left)).map_err(|_| ClientError::Transport)?;
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => raw.extend_from_slice(&buffer[..n]),
            Err(_) => return Err(ClientError::Transport),
        }
        if let Some(body) = complete_body(&raw) {
            return finish(&raw, body);
        }
    }
    let end = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or(ClientError::Transport)?;
    finish(&raw, raw[end + 4..].to_vec())
}

fn status(raw: &[u8]) -> Option<u16> {
    let line = raw.split(|&b| b == b'\n').next()?;
    std::str::from_utf8(line).ok()?.split_whitespace().nth(1)?.parse().ok()
}

fn finish(raw: &[u8], body: Vec<u8>) -> Result<Option<Value>, ClientError> {
    if status(raw).ok_or(ClientError::Transport)? != 200 {
        return Ok(None);
    }
    serde_json::from_slice(&body).map(Some).map_err(|_| ClientError::Json)
}

/// The body once the response is complete by its length or chunks.
fn complete_body(raw: &[u8]) -> Option<Vec<u8>> {
    let end = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&raw[..end]).to_ascii_lowercase();
    let body = &raw[end + 4..];
    let header = |name: &str| {
        head.lines()
            .skip(1)
            .find_map(|l| l.split_once(':').filter(|(k, _)| k.trim() == name).map(|(_, v)| v.trim().to_string()))
    };
    if header("transfer-encoding").is_some_and(|v| v.contains("chunked")) {
        let mut out = Vec::new();
        let mut at = 0;
        loop {
            let line_end = body.get(at..)?.windows(2).position(|w| w == b"\r\n")? + at;
            let size = std::str::from_utf8(&body[at..line_end]).ok()?.split(';').next()?.trim().to_string();
            let size = usize::from_str_radix(&size, 16).ok()?;
            at = line_end + 2;
            if size == 0 {
                return Some(out);
            }
            let end = at.checked_add(size)?;
            out.extend_from_slice(body.get(at..end)?);
            at = end.checked_add(2)?;
        }
    }
    let length: usize = header("content-length")?.parse().ok()?;
    (body.len() >= length).then(|| body[..length].to_vec())
}
