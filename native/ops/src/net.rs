//! A small HTTP/1.1 client over TCP or TLS, and the URL handling of Python's `urllib.parse`.
//!
//! Model downloads and usage events each send one kind of request to a fixed kind of host.
//! A client of our own gives what the Python code relied on and a general client does not
//! offer together: the socket can be shut down from another thread to stop a stalled body
//! at once (cancelling a download), every redirect target is checked before it is followed,
//! no proxy is ever used, and the request carries exactly the headers the Python code sent.
//!
//! Certificates are checked against the Mozilla roots of `webpki-roots`, the store the app's
//! `tauri-plugin-http` already uses.

use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, StreamOwned};

/// `urllib.parse.urlsplit`, with the parts `hostname`, `port`, `username` and `password`
/// derive from the network location.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Split {
    pub scheme: String,
    pub netloc: String,
    pub path: String,
    pub query: String,
    pub fragment: String,
}

/// A port that is not a number from 0 to 65535 (Python raises `ValueError` reading it).
#[derive(Debug, PartialEq)]
pub(crate) struct BadPort;

/// A network location that Python refuses to split (an unbalanced `[` or `]`).
#[derive(Debug, PartialEq)]
pub(crate) struct BadUrl;

const UNSAFE_BYTES: [char; 3] = ['\t', '\r', '\n'];

pub(crate) fn urlsplit(url: &str) -> Result<Split, BadUrl> {
    // Leading C0 controls and spaces go, and tabs and line breaks anywhere (WHATWG, as Python).
    let trimmed = url.trim_start_matches(|c: char| c <= ' ');
    let mut rest: String = trimmed.chars().filter(|c| !UNSAFE_BYTES.contains(c)).collect();
    let mut scheme = String::new();
    if let Some(colon) = rest.find(':') {
        let candidate = &rest[..colon];
        let mut chars = candidate.chars();
        if chars.next().is_some_and(|c| c.is_ascii_alphabetic()) && chars.all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) {
            scheme = candidate.to_ascii_lowercase();
            rest = rest[colon + 1..].to_string();
        }
    }
    let mut netloc = String::new();
    if let Some(after) = rest.strip_prefix("//") {
        let end = after.find(['/', '?', '#']).unwrap_or(after.len());
        netloc = after[..end].to_string();
        rest = after[end..].to_string();
        if netloc.contains('[') != netloc.contains(']') {
            return Err(BadUrl);
        }
    }
    let mut fragment = String::new();
    if let Some(hash) = rest.find('#') {
        fragment = rest[hash + 1..].to_string();
        rest.truncate(hash);
    }
    let mut query = String::new();
    if let Some(mark) = rest.find('?') {
        query = rest[mark + 1..].to_string();
        rest.truncate(mark);
    }
    Ok(Split { scheme, netloc, path: rest, query, fragment })
}

impl Split {
    fn userinfo(&self) -> Option<&str> {
        self.netloc.rfind('@').map(|at| &self.netloc[..at])
    }

    /// The network location without the user information: what goes in the Host header.
    pub fn hostinfo(&self) -> &str {
        self.netloc.rfind('@').map_or(self.netloc.as_str(), |at| &self.netloc[at + 1..])
    }

    pub fn username(&self) -> Option<&str> {
        self.userinfo().map(|info| info.split_once(':').map_or(info, |(user, _)| user))
    }

    pub fn password(&self) -> Option<&str> {
        self.userinfo().and_then(|info| info.split_once(':').map(|(_, password)| password))
    }

    fn host_and_port(&self) -> (&str, &str) {
        let hostinfo = self.hostinfo();
        if let Some(inside) = hostinfo.strip_prefix('[') {
            let (host, after) = inside.split_once(']').unwrap_or((inside, ""));
            (host, after.split_once(':').map_or("", |(_, port)| port))
        } else {
            hostinfo.split_once(':').unwrap_or((hostinfo, ""))
        }
    }

    /// Lowercase, without brackets; `None` when empty.
    pub fn hostname(&self) -> Option<String> {
        let (host, _) = self.host_and_port();
        (!host.is_empty()).then(|| host.to_lowercase())
    }

    pub fn port(&self) -> Result<Option<u16>, BadPort> {
        let (_, port) = self.host_and_port();
        if port.is_empty() {
            return Ok(None);
        }
        if !port.bytes().all(|b| b.is_ascii_digit()) {
            return Err(BadPort);
        }
        port.parse::<u32>().ok().filter(|p| *p <= 65535).map(|p| Some(p as u16)).ok_or(BadPort)
    }

    /// The request target: the path (or `/`) and the query, never the fragment.
    pub fn selector(&self) -> String {
        let path = if self.path.is_empty() { "/" } else { self.path.as_str() };
        if self.query.is_empty() {
            path.to_string()
        } else {
            format!("{path}?{}", self.query)
        }
    }

    pub fn unsplit(&self) -> String {
        let mut url = String::new();
        if !self.scheme.is_empty() {
            url.push_str(&self.scheme);
            url.push(':');
        }
        if !self.netloc.is_empty() || self.scheme == "https" || self.scheme == "http" {
            url.push_str("//");
            url.push_str(&self.netloc);
        }
        url.push_str(&self.path);
        if !self.query.is_empty() {
            url.push('?');
            url.push_str(&self.query);
        }
        if !self.fragment.is_empty() {
            url.push('#');
            url.push_str(&self.fragment);
        }
        url
    }
}

/// `urllib.parse.quote(text, safe)`: UTF-8 bytes outside letters, digits, `_.-~` and `safe`
/// as `%XX`.
pub(crate) fn quote(text: &str, safe: &str) -> String {
    quote_bytes(text.as_bytes(), safe)
}

fn quote_bytes(bytes: &[u8], safe: &str) -> String {
    let mut out = String::with_capacity(bytes.len());
    for &b in bytes {
        if b.is_ascii_alphanumeric() || b"_.-~".contains(&b) || (b.is_ascii() && safe.as_bytes().contains(&b)) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// What `urllib` does to a redirect target before following it: quote it as Latin-1 with every
/// ASCII punctuation mark left alone. A character beyond Latin-1 cannot be encoded (Python
/// raises `UnicodeEncodeError`).
pub(crate) fn quote_redirect(url: &str) -> Option<String> {
    const PUNCTUATION: &str = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    let bytes = url.chars().map(|c| u8::try_from(u32::from(c)).ok()).collect::<Option<Vec<u8>>>()?;
    Some(quote_bytes(&bytes, PUNCTUATION))
}

/// `urllib.parse.urljoin` for the forms a redirect takes.
pub(crate) fn urljoin(base: &str, reference: &str) -> Result<String, BadUrl> {
    if reference.is_empty() {
        return Ok(base.to_string());
    }
    let b = urlsplit(base)?;
    let r = urlsplit(reference)?;
    if !r.scheme.is_empty() && r.scheme != b.scheme {
        return Ok(reference.to_string());
    }
    let scheme = b.scheme.clone();
    if !r.netloc.is_empty() {
        return Ok(Split { scheme, path: remove_dot_segments(&r.path), ..r }.unsplit());
    }
    let (path, query) = if r.path.is_empty() {
        (b.path.clone(), if r.query.is_empty() { b.query.clone() } else { r.query.clone() })
    } else if r.path.starts_with('/') {
        (remove_dot_segments(&r.path), r.query.clone())
    } else {
        let directory = b.path.rfind('/').map_or("", |slash| &b.path[..=slash]);
        let merged = if directory.is_empty() && !b.netloc.is_empty() { format!("/{}", r.path) } else { format!("{directory}{}", r.path) };
        (remove_dot_segments(&merged), r.query.clone())
    };
    Ok(Split { scheme, netloc: b.netloc, path, query, fragment: r.fragment }.unsplit())
}

fn remove_dot_segments(path: &str) -> String {
    if !path.split('/').any(|segment| segment == "." || segment == "..") {
        return path.to_string();
    }
    let segments: Vec<&str> = path.split('/').collect();
    let mut out: Vec<&str> = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        let last = index + 1 == segments.len();
        match *segment {
            "." => {
                if last {
                    out.push("");
                }
            }
            ".." => {
                if out.len() > 1 {
                    out.pop();
                }
                if last {
                    out.push("");
                }
            }
            other => out.push(other),
        }
    }
    let joined = out.join("/");
    if path.starts_with('/') && !joined.starts_with('/') {
        format!("/{joined}")
    } else {
        joined
    }
}

/// The TLS settings for every connection: TLS 1.2 or 1.3, the Mozilla roots, no client
/// certificate, HTTP/1.1 only.
pub(crate) fn tls_config() -> Arc<ClientConfig> {
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

pub(crate) enum Stream {
    Plain(TcpStream),
    Tls(Box<StreamOwned<ClientConnection, TcpStream>>),
}

impl Read for Stream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Stream::Plain(s) => s.read(buf),
            Stream::Tls(s) => match s.read(buf) {
                // A peer that closes without close_notify ends the body like plain TCP does;
                // the framing (Content-Length, chunks) decides whether it was complete.
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

/// Shuts the connection's socket down from any thread: a read blocked on it returns at once.
#[derive(Clone)]
pub(crate) struct Abort(Arc<TcpStream>);

impl Abort {
    pub fn abort(&self) {
        let _ = self.0.shutdown(Shutdown::Both);
    }
}

/// Connects to `host:port` (each address in turn, as Python's `create_connection` does), with
/// `timeout` for connecting and for every read and write after it.
pub(crate) fn connect(host: &str, port: u16, timeout: Duration, tls: Option<Arc<ClientConfig>>) -> io::Result<(Stream, Abort)> {
    let mut last = io::Error::new(io::ErrorKind::NotFound, "no address");
    let mut tcp = None;
    for address in (host, port).to_socket_addrs()? {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(stream) => {
                tcp = Some(stream);
                break;
            }
            Err(error) => last = error,
        }
    }
    let tcp = tcp.ok_or(last)?;
    tcp.set_read_timeout(Some(timeout))?;
    tcp.set_write_timeout(Some(timeout))?;
    let abort = Abort(Arc::new(tcp.try_clone()?));
    let stream = match tls {
        None => Stream::Plain(tcp),
        Some(config) => {
            let name = ServerName::try_from(host.to_string()).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "server name"))?;
            let connection = ClientConnection::new(config, name).map_err(io::Error::other)?;
            let mut stream = StreamOwned::new(connection, tcp);
            // Handshake now, so a certificate problem is a connection failure.
            while stream.conn.is_handshaking() {
                stream.conn.complete_io(&mut stream.sock)?;
            }
            Stream::Tls(Box::new(stream))
        }
    };
    Ok((stream, abort))
}

/// The Host header value for a host and port, as `http.client` writes it.
pub(crate) fn host_header(host: &str, port: u16, default_port: u16) -> String {
    let host = if host.contains(':') { format!("[{host}]") } else { host.to_string() };
    if port == default_port {
        host
    } else {
        format!("{host}:{port}")
    }
}

/// Writes a request with the headers exactly as given, in that order.
pub(crate) fn send_request(stream: &mut Stream, method: &str, target: &str, headers: &[(&str, &str)], body: &[u8]) -> io::Result<()> {
    let mut head = format!("{method} {target} HTTP/1.1\r\n");
    for (name, value) in headers {
        head.push_str(name);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    }
    head.push_str("\r\n");
    let mut data = head.into_bytes();
    data.extend_from_slice(body);
    stream.write_all(&data)?;
    stream.flush()
}

const MAX_HEAD: usize = 64 * 1024;
const MAX_HEADERS: usize = 100;

pub(crate) struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Body,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// Reads the status line and headers, skipping interim (1xx) responses.
pub(crate) fn read_response(mut stream: Stream, method: &str) -> io::Result<Response> {
    let mut buffer = Vec::new();
    loop {
        let (status, headers, consumed) = loop {
            let mut storage = [httparse::EMPTY_HEADER; MAX_HEADERS];
            let mut parsed = httparse::Response::new(&mut storage);
            match parsed.parse(&buffer).map_err(|_| invalid("response head"))? {
                httparse::Status::Complete(consumed) => {
                    let status = parsed.code.ok_or_else(|| invalid("status"))?;
                    let headers = parsed.headers.iter().map(|h| (h.name.to_string(), String::from_utf8_lossy(h.value).into_owned())).collect::<Vec<_>>();
                    break (status, headers, consumed);
                }
                httparse::Status::Partial => {
                    if buffer.len() > MAX_HEAD {
                        return Err(invalid("response head too long"));
                    }
                    let mut chunk = [0u8; 8192];
                    let n = stream.read(&mut chunk)?;
                    if n == 0 {
                        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "no response"));
                    }
                    buffer.extend_from_slice(&chunk[..n]);
                }
            }
        };
        buffer.drain(..consumed);
        if (100..200).contains(&status) && status != 101 {
            continue;
        }
        let find = |name: &str| headers.iter().rev().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.clone());
        let framing = if method == "HEAD" || status == 204 || status == 304 {
            Framing::Length(0)
        } else if find("transfer-encoding").is_some_and(|v| v.to_ascii_lowercase().contains("chunked")) {
            Framing::Chunked(ChunkState::Size)
        } else if let Some(length) = find("content-length").and_then(|v| v.trim().parse::<u64>().ok()) {
            Framing::Length(length)
        } else {
            Framing::UntilClose
        };
        return Ok(Response { status, headers, body: Body { stream, buffer, framing } });
    }
}

fn invalid(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, what.to_string())
}

enum Framing {
    Length(u64),
    Chunked(ChunkState),
    UntilClose,
}

#[derive(Clone, Copy)]
enum ChunkState {
    Size,
    Data(u64),
    DataEnd,
    Done,
}

/// A response body. Each `read` returns what one read of the connection gives (Python's
/// `read1`), so a slow trickle never holds a whole buffer's worth back.
pub(crate) struct Body {
    stream: Stream,
    buffer: Vec<u8>,
    framing: Framing,
}

impl Body {
    fn raw_read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if !self.buffer.is_empty() {
            let n = buf.len().min(self.buffer.len());
            buf[..n].copy_from_slice(&self.buffer[..n]);
            self.buffer.drain(..n);
            return Ok(n);
        }
        self.stream.read(buf)
    }

    fn read_line(&mut self) -> io::Result<String> {
        let mut line = Vec::new();
        loop {
            let mut byte = [0u8; 1];
            if self.raw_read(&mut byte)? == 0 {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "incomplete chunked body"));
            }
            if byte[0] == b'\n' {
                break;
            }
            line.push(byte[0]);
            if line.len() > MAX_HEAD {
                return Err(invalid("chunk line too long"));
            }
        }
        Ok(String::from_utf8_lossy(&line).trim_end_matches('\r').to_string())
    }

    /// Reads up to `limit` bytes, waiting for more until the body ends or the limit is reached
    /// (Python's `read(amt)`).
    pub fn read_up_to(&mut self, limit: usize) -> io::Result<Vec<u8>> {
        let mut out = Vec::new();
        let mut chunk = vec![0u8; limit.clamp(1, 8192)];
        while out.len() < limit {
            let want = (limit - out.len()).min(chunk.len());
            let n = self.read(&mut chunk[..want])?;
            if n == 0 {
                break;
            }
            out.extend_from_slice(&chunk[..n]);
        }
        Ok(out)
    }
}

impl Read for Body {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        match self.framing {
            Framing::Length(0) => Ok(0),
            Framing::Length(left) => {
                let want = buf.len().min(usize::try_from(left).unwrap_or(usize::MAX));
                let n = self.raw_read(&mut buf[..want])?;
                // A connection that ends early ends the body; the caller compares the length.
                self.framing = Framing::Length(if n == 0 { 0 } else { left - n as u64 });
                Ok(n)
            }
            Framing::UntilClose => self.raw_read(buf),
            Framing::Chunked(state) => match state {
                ChunkState::Done => Ok(0),
                ChunkState::Size => {
                    let line = self.read_line()?;
                    let size = line.split(';').next().unwrap_or("").trim();
                    let size = u64::from_str_radix(size, 16).map_err(|_| invalid("chunk size"))?;
                    if size == 0 {
                        // Trailers end with an empty line.
                        while !self.read_line()?.is_empty() {}
                        self.framing = Framing::Chunked(ChunkState::Done);
                        return Ok(0);
                    }
                    self.framing = Framing::Chunked(ChunkState::Data(size));
                    self.read(buf)
                }
                ChunkState::Data(left) => {
                    let want = buf.len().min(usize::try_from(left).unwrap_or(usize::MAX));
                    let n = self.raw_read(&mut buf[..want])?;
                    if n == 0 {
                        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "incomplete chunked body"));
                    }
                    let left = left - n as u64;
                    self.framing = Framing::Chunked(if left == 0 { ChunkState::DataEnd } else { ChunkState::Data(left) });
                    Ok(n)
                }
                ChunkState::DataEnd => {
                    self.read_line()?;
                    self.framing = Framing::Chunked(ChunkState::Size);
                    self.read(buf)
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_like_python() {
        let s = urlsplit("HTTPS://User:Pw@HuggingFace.co:443/a/b?x=1#frag").unwrap();
        assert_eq!((s.scheme.as_str(), s.netloc.as_str(), s.path.as_str(), s.query.as_str(), s.fragment.as_str()), ("https", "User:Pw@HuggingFace.co:443", "/a/b", "x=1", "frag"));
        assert_eq!((s.username(), s.password(), s.hostname().as_deref(), s.port()), (Some("User"), Some("Pw"), Some("huggingface.co"), Ok(Some(443))));
        let at = urlsplit("https://@huggingface.co/x").unwrap();
        assert_eq!((at.username(), at.password()), (Some(""), None));
        assert_eq!(urlsplit("https://h:99999/").unwrap().port(), Err(BadPort));
        assert_eq!(urlsplit("https://h:x/").unwrap().port(), Err(BadPort));
        assert_eq!(urlsplit("https://h:/").unwrap().port(), Ok(None));
        let v6 = urlsplit("http://[::1]:8080/v1").unwrap();
        assert_eq!((v6.hostname().as_deref(), v6.port()), (Some("::1"), Ok(Some(8080))));
        assert_eq!(urlsplit("http://[::1/v1"), Err(BadUrl));
        let bare = urlsplit("not a url").unwrap();
        assert_eq!((bare.scheme.as_str(), bare.hostname()), ("", None));
        // Tabs and line breaks are removed anywhere, leading spaces and controls dropped.
        assert_eq!(urlsplit(" \x01https://h\n.co/x").unwrap().netloc, "h.co");
    }

    #[test]
    fn joins_and_quotes_redirects_like_urllib() {
        let base = "https://huggingface.co/owner/model/resolve/rev/file.gguf";
        assert_eq!(urljoin(base, "https://us.aws.cdn.hf.co/x?a=b").unwrap(), "https://us.aws.cdn.hf.co/x?a=b");
        assert_eq!(urljoin(base, "/api/resolve-cache/models/x?y=1").unwrap(), "https://huggingface.co/api/resolve-cache/models/x?y=1");
        assert_eq!(urljoin(base, "//cdn-lfs.huggingface.co/p").unwrap(), "https://cdn-lfs.huggingface.co/p");
        assert_eq!(urljoin(base, "other.gguf").unwrap(), "https://huggingface.co/owner/model/resolve/rev/other.gguf");
        assert_eq!(urljoin(base, "../x").unwrap(), "https://huggingface.co/owner/model/resolve/x");
        assert_eq!(quote_redirect("https://h/a b?c=ü").unwrap(), "https://h/a%20b?c=%FC");
        assert_eq!(quote_redirect("https://h/日本"), None);
        assert_eq!(quote("dir/rec file.onnx", "/"), "dir/rec%20file.onnx");
    }
}
