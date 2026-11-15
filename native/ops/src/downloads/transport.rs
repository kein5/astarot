//! Public HTTPS only; never attach user credentials or execute downloaded content
//! (`transport.py`).

use std::collections::HashMap;
use std::io::{self, Read};
use std::time::Duration;

use super::Error;
use crate::net::{self, Abort};

pub const HOSTS: [&str; 6] = ["huggingface.co", "cdn-lfs.huggingface.co", "cdn-lfs-us-1.hf.co", "cdn-lfs-eu-1.hf.co", "cas-bridge.xethub.hf.co", "us.aws.cdn.hf.co"];
pub const USER_AGENT: &str = "VRCT-VOX-model-download/1";
pub const TIMEOUT: Duration = Duration::from_secs(15);
/// As `PublicRedirect.max_redirections`.
const MAX_REDIRECTIONS: usize = 5;
/// As `HTTPRedirectHandler.max_repeats`: the same target this often is a loop.
const MAX_REPEATS: usize = 4;

/// `https` on port 443 of one of `hosts`, with no user information, no fragment and no control
/// characters. Anything else: `download_url_rejected`. A port that is not a number fails as
/// Python's did (`download_failed` in a job).
pub fn validate_url(url: &str, hosts: &[&str]) -> Result<(), Error> {
    const REJECTED: Error = Error::Code("download_url_rejected");
    let parts = net::urlsplit(url).map_err(|_| Error::Other("invalid url".into()))?;
    let port = parts.port().map_err(|_| Error::Other("invalid port".into()))?;
    let host_ok = parts.hostname().is_some_and(|h| hosts.contains(&h.as_str()));
    if parts.scheme != "https"
        || !host_ok
        || !matches!(port, None | Some(443))
        || parts.username().is_some()
        || parts.password().is_some()
        || !parts.fragment.is_empty()
        || url.chars().any(|c| (c as u32) < 32)
    {
        return Err(REJECTED);
    }
    Ok(())
}

/// A response body being downloaded. `read` returns what is available, up to the buffer.
pub trait Body: Read + Send {
    /// A handle that stops a read blocked on this body from another thread, if it has one.
    fn aborter(&self) -> Option<Aborter> {
        None
    }
}

/// Stops a blocked body read.
#[derive(Clone)]
pub struct Aborter(std::sync::Arc<dyn Fn() + Send + Sync>);

impl Aborter {
    pub fn new(abort: impl Fn() + Send + Sync + 'static) -> Self {
        Aborter(std::sync::Arc::new(abort))
    }

    pub fn abort(&self) {
        (self.0)()
    }
}

/// Opens an artifact URL. The manager calls it on its worker thread.
pub trait Transport: Send + Sync {
    fn open(&self, url: &str) -> Result<Box<dyn Body>, Error>;
}

impl<F> Transport for F
where
    F: Fn(&str) -> Result<Box<dyn Body>, Error> + Send + Sync,
{
    fn open(&self, url: &str) -> Result<Box<dyn Body>, Error> {
        self(url)
    }
}

impl Body for io::Cursor<Vec<u8>> {}

/// A body read from a live connection.
pub struct PublicResponse {
    body: net::Body,
    abort: Abort,
}

impl Read for PublicResponse {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.body.read(buf)
    }
}

impl Body for PublicResponse {
    fn aborter(&self) -> Option<Aborter> {
        let abort = self.abort.clone();
        Some(Aborter::new(move || abort.abort()))
    }
}

/// The production transport: the fixed hosts over HTTPS, no proxy, redirects checked one by one.
pub struct Public {
    pub timeout: Duration,
    pub hosts: Vec<String>,
}

impl Default for Public {
    fn default() -> Self {
        Public { timeout: TIMEOUT, hosts: HOSTS.iter().map(|h| h.to_string()).collect() }
    }
}

impl Transport for Public {
    fn open(&self, url: &str) -> Result<Box<dyn Body>, Error> {
        let hosts: Vec<&str> = self.hosts.iter().map(String::as_str).collect();
        Ok(Box::new(open_public(url, self.timeout, &hosts)?))
    }
}

/// GETs `url` and returns the body of a 200 answer, following at most five redirects, each to
/// a URL [`validate_url`] accepts. Another 2xx: `download_http_error`. A redirect elsewhere:
/// `download_url_rejected`. An HTTP error, a redirect loop or a broken redirect fails as
/// `urllib`'s `HTTPError` did (`download_failed` in a job).
pub fn open_public(url: &str, timeout: Duration, hosts: &[&str]) -> Result<PublicResponse, Error> {
    open_via(url, hosts, &|host: &str, port: u16| net::connect(host, port, timeout, Some(net::tls_config())))
}

type Connect<'a> = &'a dyn Fn(&str, u16) -> io::Result<(net::Stream, Abort)>;

/// [`open_public`] over a given way of connecting (the tests route it to a loopback server).
pub(crate) fn open_via(url: &str, hosts: &[&str], connect: Connect) -> Result<PublicResponse, Error> {
    validate_url(url, hosts)?;
    let mut current = url.to_string();
    let mut visited: HashMap<String, usize> = HashMap::new();
    loop {
        let parts = net::urlsplit(&current).map_err(|_| Error::Other("invalid url".into()))?;
        let host = parts.hostname().unwrap_or_default();
        let port = parts.port().ok().flatten().unwrap_or(443);
        let (mut stream, abort) = connect(&host, port).map_err(Error::Io)?;
        // urllib's headers, in urllib's order.
        let headers = [("Host", parts.hostinfo()), ("User-Agent", USER_AGENT), ("Accept-Encoding", "identity"), ("Connection", "close")];
        net::send_request(&mut stream, "GET", &parts.selector(), &headers, b"").map_err(Error::Io)?;
        let response = net::read_response(stream, "GET").map_err(Error::Io)?;
        match response.status {
            200 => return Ok(PublicResponse { body: response.body, abort }),
            201..=299 => return Err(Error::Code("download_http_error")),
            301 | 302 | 303 | 307 | 308 => {
                let location = response.header("location").or_else(|| response.header("uri")).ok_or_else(|| Error::Other("redirect without location".into()))?;
                let joined = net::urljoin(&current, location).map_err(|_| Error::Other("invalid redirect".into()))?;
                let mut target = net::urlsplit(&joined).map_err(|_| Error::Other("invalid redirect".into()))?;
                if !["http", "https", "ftp", ""].contains(&target.scheme.as_str()) {
                    return Err(Error::Other("redirect to another scheme".into()));
                }
                if target.path.is_empty() && !target.netloc.is_empty() {
                    target.path = "/".into();
                }
                let next = net::quote_redirect(&target.unsplit()).ok_or_else(|| Error::Other("redirect not latin-1".into()))?;
                validate_url(&next, hosts)?;
                // urllib checks from the second redirect on, before counting this one.
                let seen = visited.get(&next).copied().unwrap_or(0);
                if !visited.is_empty() && (seen >= MAX_REPEATS || visited.len() >= MAX_REDIRECTIONS) {
                    return Err(Error::Other("redirect loop".into()));
                }
                *visited.entry(next.clone()).or_insert(0) += 1;
                current = next;
            }
            _ => return Err(Error::Other(format!("http error {}", response.status))),
        }
    }
}

/// Whether huggingface.co answers a HEAD with 200: no body, credentials, proxy or redirect.
pub fn probe_download_host(timeout: Duration) -> bool {
    let probe = || -> io::Result<bool> {
        let (mut stream, _) = net::connect("huggingface.co", 443, timeout, Some(net::tls_config()))?;
        let headers = [("Host", "huggingface.co"), ("User-Agent", USER_AGENT), ("Accept-Encoding", "identity"), ("Connection", "close")];
        net::send_request(&mut stream, "HEAD", "/", &headers, b"")?;
        Ok(net::read_response(stream, "HEAD")?.status == 200)
    };
    probe().unwrap_or(false)
}

/// A plain-HTTP body from a loopback test server: the production path refuses HTTP and local
/// hosts, so tests inject at the transport boundary, as the Python tests did.
#[cfg(test)]
pub(crate) fn open_loopback(url: &str) -> io::Result<PublicResponse> {
    let parts = net::urlsplit(url).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    let host = parts.hostname().unwrap_or_default();
    let port = parts.port().ok().flatten().unwrap_or(80);
    let (mut stream, abort) = net::connect(&host, port, TIMEOUT, None)?;
    let headers = [("Host", parts.hostinfo()), ("User-Agent", USER_AGENT), ("Accept-Encoding", "identity"), ("Connection", "close")];
    net::send_request(&mut stream, "GET", &parts.selector(), &headers, b"")?;
    Ok(PublicResponse { body: net::read_response(stream, "GET")?.body, abort })
}
