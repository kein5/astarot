//! The proxy that speech recognition's requests to the internet go through (decision 15 (4) in
//! `docs/voice-stack/core-integration.md`). Python's requests and httpx found it with
//! `urllib.request.getproxies`: the `*_proxy` environment variables, or, when none of them is
//! set, the user's Internet Settings on Windows. A host of this PC or the LAN never goes through
//! it (`network_policy.api_http_client` turned `trust_env` off for them). Translation does not
//! use it: whether it should is item 18, not decided.
//!
//! Only an HTTP proxy can be used: HTTPS goes through it with `CONNECT`, with
//! `Proxy-Authorization: Basic` from the user info of the proxy's URL. An `https://` or SOCKS
//! proxy fails the request (Python could use an `https://` one).
//!
//! The settings are read again for each request, as requests read them.

use crate::http::is_local_host;
use std::collections::BTreeMap;
use std::net::IpAddr;

/// A proxy to go through.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Proxy {
    /// `http://[user:password@]host[:port]` (port 80 when none is given).
    Http {
        host: String,
        port: u16,
        /// The value of `Proxy-Authorization` (`Basic ...`), from the user info.
        authorization: Option<String>,
    },
    /// A proxy this client cannot use (`https://`, `socks5://`, ...) or cannot read: the
    /// request fails instead of going around it.
    Unsupported,
}

/// What the proxy settings say.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Settings {
    /// The proxy of HTTPS: `https_proxy`, else `all_proxy` (the registry's `https=`).
    https: Option<String>,
    bypass: Bypass,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
enum Bypass {
    #[default]
    Nothing,
    /// `no_proxy`: `*`, names (the name and the names under it), addresses and address ranges.
    Environment(Vec<String>),
    /// `ProxyOverride`: `<local>` (a name without a dot) and wildcard patterns.
    Registry(Vec<String>),
}

impl Settings {
    /// The settings now: the environment, else on Windows the Internet Settings.
    pub fn current() -> Settings {
        let variables = std::env::vars_os().filter_map(|(name, value)| Some((name.into_string().ok()?, value.into_string().ok()?)));
        match Settings::from_environment(variables) {
            Some(settings) => settings,
            None => registry().unwrap_or_default(),
        }
    }

    /// `getproxies_environment`: every `*_proxy` variable with a value, the lower-case names
    /// winning (an empty lower-case one removes the other). `None` when there is none, which is
    /// when Windows looks in the registry.
    pub fn from_environment(variables: impl IntoIterator<Item = (String, String)>) -> Option<Settings> {
        let variables: Vec<(String, String)> = variables.into_iter().collect();
        let mut proxies = BTreeMap::new();
        for (name, value) in &variables {
            let lower = name.to_ascii_lowercase();
            if let Some(scheme) = lower.strip_suffix("_proxy").filter(|_| !value.is_empty()) {
                proxies.insert(scheme.to_string(), value.clone());
            }
        }
        for (name, value) in &variables {
            if let Some(scheme) = name.strip_suffix("_proxy").filter(|_| name.to_ascii_lowercase() == *name) {
                if value.is_empty() {
                    proxies.remove(scheme);
                } else {
                    proxies.insert(scheme.to_string(), value.clone());
                }
            }
        }
        if proxies.is_empty() {
            return None;
        }
        let bypass = proxies
            .get("no")
            .map(|list| list.split(',').map(|entry| entry.trim().to_string()).filter(|entry| !entry.is_empty()).collect())
            .unwrap_or_default();
        Some(Settings { https: proxies.get("https").or_else(|| proxies.get("all")).cloned(), bypass: Bypass::Environment(bypass) })
    }

    /// `getproxies_registry` and `proxy_bypass_registry`, from `ProxyServer` and
    /// `ProxyOverride` of a user whose `ProxyEnable` is on.
    pub fn from_registry(server: &str, exceptions: Option<&str>) -> Settings {
        let server = server.trim();
        let mut proxies = BTreeMap::new();
        let entries: Vec<(String, String)> = if server.contains(['=', ';']) {
            server
                .split(';')
                .filter_map(|entry| entry.split_once('='))
                .map(|(scheme, address)| (scheme.trim().to_ascii_lowercase(), address.trim().to_string()))
                .collect()
        } else {
            // One setting for every protocol.
            ["http", "https", "ftp"].iter().map(|scheme| (scheme.to_string(), server.to_string())).collect()
        };
        for (scheme, address) in entries {
            if address.is_empty() {
                continue;
            }
            let address = if address.contains("://") {
                address
            } else if scheme == "socks" {
                format!("socks://{address}")
            } else {
                // Windows proxies are HTTP unless they say otherwise.
                format!("http://{address}")
            };
            proxies.insert(scheme, address);
        }
        // A SOCKS proxy serves HTTPS when nothing else does (SOCKS4 by Windows' default).
        let https = proxies.get("https").cloned().or_else(|| proxies.get("socks").map(|socks| socks.replacen("socks://", "socks4://", 1)));
        let bypass = exceptions
            .map(|list| list.split(';').map(|entry| entry.trim().to_string()).filter(|entry| !entry.is_empty()).collect())
            .unwrap_or_default();
        Settings { https, bypass: Bypass::Registry(bypass) }
    }

    /// The proxy for an HTTPS request to `host` and `port`; `None` goes straight there.
    pub fn proxy_for(&self, host: &str, port: u16) -> Option<Proxy> {
        let host = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
        if is_local_host(&host) || self.bypassed(&host, port) {
            return None;
        }
        self.https.as_deref().map(parse)
    }

    fn bypassed(&self, host: &str, port: u16) -> bool {
        match &self.bypass {
            Bypass::Nothing => false,
            Bypass::Environment(entries) => entries.iter().any(|entry| environment_match(entry, host, port)),
            Bypass::Registry(entries) => entries.iter().any(|entry| registry_match(entry, host)),
        }
    }
}

/// An entry of `no_proxy` (`proxy_bypass_environment`, with the addresses and ranges requests
/// added): `*`; an address, or a range like `10.0.0.0/8`, for a host given as an address; a
/// name, with or without a leading `.` or `*`, for that name and the names under it; any of them
/// with `:port` for that port only.
fn environment_match(entry: &str, host: &str, port: u16) -> bool {
    let entry = entry.to_ascii_lowercase();
    if entry == "*" {
        return true;
    }
    if let Ok(address) = host.parse::<IpAddr>() {
        if let Some((network, bits)) = entry.split_once('/') {
            return in_range(address, network, bits);
        }
        let entry = entry.trim_start_matches('[');
        let entry = entry.split_once("]:").map_or(entry.trim_end_matches(']'), |(address, _)| address);
        return entry.parse::<IpAddr>().is_ok_and(|entry| entry == address);
    }
    let (name, wanted_port) = match entry.rsplit_once(':') {
        Some((name, wanted)) if wanted.parse::<u16>().is_ok() => (name, wanted.parse::<u16>().ok()),
        _ => (entry.as_str(), None),
    };
    if wanted_port.is_some_and(|wanted| wanted != port) {
        return false;
    }
    let name = name.trim_start_matches('*').trim_start_matches('.');
    !name.is_empty() && (host == name || host.ends_with(&format!(".{name}")))
}

fn in_range(address: IpAddr, network: &str, bits: &str) -> bool {
    let (Ok(network), Ok(bits)) = (network.parse::<IpAddr>(), bits.parse::<u32>()) else { return false };
    match (address, network) {
        (IpAddr::V4(address), IpAddr::V4(network)) if bits <= 32 => {
            let mask = if bits == 0 { 0 } else { u32::MAX << (32 - bits) };
            u32::from(address) & mask == u32::from(network) & mask
        }
        (IpAddr::V6(address), IpAddr::V6(network)) if bits <= 128 => {
            let mask = if bits == 0 { 0 } else { u128::MAX << (128 - bits) };
            u128::from(address) & mask == u128::from(network) & mask
        }
        _ => false,
    }
}

/// An entry of `ProxyOverride`: `<local>` for a name without a dot, else a pattern where `*` is
/// any run of characters and `?` one, matched against the whole host in any case.
fn registry_match(entry: &str, host: &str) -> bool {
    if entry.eq_ignore_ascii_case("<local>") {
        return !host.contains('.');
    }
    wildcard(entry.to_ascii_lowercase().as_bytes(), host.as_bytes())
}

fn wildcard(pattern: &[u8], text: &[u8]) -> bool {
    match pattern.split_first() {
        None => text.is_empty(),
        Some((b'*', rest)) => (0..=text.len()).any(|skip| wildcard(rest, &text[skip..])),
        Some((&wanted, rest)) => {
            text.split_first().is_some_and(|(&got, others)| (wanted == b'?' || wanted == got) && wildcard(rest, others))
        }
    }
}

/// Reads a proxy URL: `http://[user:password@]host[:port][/]`, or the same without `http://`.
pub fn parse(text: &str) -> Proxy {
    let text = text.trim();
    let rest = match text.split_once("://") {
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("http") => rest,
        Some(_) => return Proxy::Unsupported,
        None => text,
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let (user_info, address) = match authority.rsplit_once('@') {
        Some((user_info, address)) => (Some(user_info), address),
        None => (None, authority),
    };
    let (host, port) = if let Some(bracketed) = address.strip_prefix('[') {
        let Some((host, after)) = bracketed.split_once(']') else { return Proxy::Unsupported };
        match after.strip_prefix(':') {
            Some(port) => (host, port.parse::<u16>().ok()),
            None if after.is_empty() => (host, Some(80)),
            None => return Proxy::Unsupported,
        }
    } else {
        match address.rsplit_once(':') {
            Some((host, port)) => (host, port.parse::<u16>().ok()),
            None => (address, Some(80)),
        }
    };
    let (Some(port), false) = (port.filter(|port| *port != 0), host.is_empty()) else { return Proxy::Unsupported };
    let authorization = user_info.map(|user_info| {
        let (user, password) = user_info.split_once(':').unwrap_or((user_info, ""));
        format!("Basic {}", base64(format!("{}:{}", percent_decoded(user), percent_decoded(password)).as_bytes()))
    });
    Proxy::Http { host: host.to_string(), port, authorization }
}

/// `%XX` escapes turned back into bytes; anything else as it is.
fn percent_decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let escaped = (bytes[at] == b'%')
            .then(|| bytes.get(at + 1..at + 3))
            .flatten()
            .and_then(|hex| u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok());
        match escaped {
            Some(byte) => {
                out.push(byte);
                at += 3;
            }
            None => {
                out.push(bytes[at]);
                at += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = chunk.iter().enumerate().fold(0u32, |value, (i, &byte)| value | u32::from(byte) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(TABLE[(value >> (18 - 6 * i) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// `ProxyServer` and `ProxyOverride` of the user's Internet Settings, while `ProxyEnable` is on.
#[cfg(windows)]
fn registry() -> Option<Settings> {
    use std::ffi::c_void;
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_DWORD, RRF_RT_REG_SZ, RegGetValueW};

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings");
    let text = |name: &str| -> Option<String> {
        let name = wide(name);
        let mut size = 0u32;
        // SAFETY: the key and the name are NUL-terminated; a null buffer asks for the size.
        let status = unsafe {
            RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), &mut size)
        };
        if status != 0 || size == 0 {
            return None;
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        // SAFETY: the buffer holds `size` bytes.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buffer.as_mut_ptr().cast::<c_void>(),
                &mut size,
            )
        };
        if status != 0 {
            return None;
        }
        let end = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..end]))
    };
    let name = wide("ProxyEnable");
    let mut enabled = 0u32;
    let mut size = 4u32;
    // SAFETY: a DWORD (or 4 bytes of binary) into a u32.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_DWORD,
            std::ptr::null_mut(),
            (&mut enabled as *mut u32).cast::<c_void>(),
            &mut size,
        )
    };
    if status != 0 || enabled == 0 {
        return None;
    }
    let server = text("ProxyServer")?;
    Some(Settings::from_registry(&server, text("ProxyOverride").as_deref()))
}

#[cfg(not(windows))]
fn registry() -> Option<Settings> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment(pairs: &[(&str, &str)]) -> Option<Settings> {
        Settings::from_environment(pairs.iter().map(|(name, value)| (name.to_string(), value.to_string())))
    }

    fn http(host: &str, port: u16) -> Option<Proxy> {
        Some(Proxy::Http { host: host.into(), port, authorization: None })
    }

    #[test]
    fn the_environment_is_read_as_urllib_read_it() {
        // Nothing set: Windows then looks in the registry.
        assert_eq!(environment(&[("PATH", "/usr/bin")]), None);
        assert_eq!(environment(&[("HTTPS_PROXY", "")]), None);
        let upper = environment(&[("HTTPS_PROXY", "http://upper:8080")]).unwrap();
        assert_eq!(upper.proxy_for("api.openai.com", 443), http("upper", 8080));
        // The lower-case name wins, and an empty one removes the other.
        let both = environment(&[("HTTPS_PROXY", "http://upper:8080"), ("https_proxy", "lower:3128")]).unwrap();
        assert_eq!(both.proxy_for("api.openai.com", 443), http("lower", 3128));
        let removed = environment(&[("HTTPS_PROXY", "http://upper:8080"), ("https_proxy", ""), ("ALL_PROXY", "all:1")]).unwrap();
        assert_eq!(removed.proxy_for("api.openai.com", 443), http("all", 1));
        // HTTP_PROXY alone is not for HTTPS, and keeps the registry out.
        let plain = environment(&[("HTTP_PROXY", "http://plain:80")]).unwrap();
        assert_eq!(plain.proxy_for("api.openai.com", 443), None);
        let only_no_proxy = environment(&[("NO_PROXY", "example.com")]).unwrap();
        assert_eq!(only_no_proxy.proxy_for("api.openai.com", 443), None);
    }

    #[test]
    fn this_pc_the_lan_and_no_proxy_go_straight() {
        let settings = environment(&[
            ("HTTPS_PROXY", "http://proxy:8080"),
            ("NO_PROXY", " .internal.example, deepgram.com:443, 203.0.113.0/24, 198.51.100.7,api.groq.com:8443"),
        ])
        .unwrap();
        for host in ["localhost", "127.0.0.1", "192.168.1.20", "[::1]", "studio.local"] {
            assert_eq!(settings.proxy_for(host, 443), None, "{host}");
        }
        for (host, port) in [
            ("internal.example", 443),
            ("asr.internal.example", 443),
            ("api.deepgram.com", 443),
            ("203.0.113.9", 443),
            ("198.51.100.7", 443),
            ("api.groq.com", 8443),
        ] {
            assert_eq!(settings.proxy_for(host, port), None, "{host}:{port}");
        }
        for (host, port) in [("api.openai.com", 443), ("notinternal.example", 443), ("api.groq.com", 443), ("203.0.114.1", 443)] {
            assert_eq!(settings.proxy_for(host, port), http("proxy", 8080), "{host}:{port}");
        }
        let everything = environment(&[("HTTPS_PROXY", "http://proxy:8080"), ("no_proxy", "*")]).unwrap();
        assert_eq!(everything.proxy_for("api.openai.com", 443), None);
    }

    #[test]
    fn the_internet_settings_are_read_as_urllib_read_them() {
        let one = Settings::from_registry("proxy.corp:8080", Some("<local>;*.corp.example;10.*"));
        assert_eq!(one.proxy_for("api.openai.com", 443), http("proxy.corp", 8080));
        for host in ["intranet", "files.corp.example", "FILES.CORP.EXAMPLE", "10.1.2.3"] {
            assert_eq!(one.proxy_for(host, 443), None, "{host}");
        }
        assert_eq!(one.proxy_for("corp.example.com", 443), http("proxy.corp", 8080));
        let each = Settings::from_registry("http=web:80;https=secure:443", None);
        assert_eq!(each.proxy_for("api.openai.com", 443), http("secure", 443));
        let web_only = Settings::from_registry("http=web:80", None);
        assert_eq!(web_only.proxy_for("api.openai.com", 443), None);
        // SOCKS serves HTTPS when nothing else does; this client cannot use it.
        let socks = Settings::from_registry("socks=socks.corp:1080", None);
        assert_eq!(socks.proxy_for("api.openai.com", 443), Some(Proxy::Unsupported));
    }

    #[test]
    fn proxy_urls_give_the_address_and_the_authorization() {
        assert_eq!(parse("http://proxy:3128"), Proxy::Http { host: "proxy".into(), port: 3128, authorization: None });
        assert_eq!(parse("proxy.corp"), Proxy::Http { host: "proxy.corp".into(), port: 80, authorization: None });
        assert_eq!(parse("HTTP://[fd00::1]:8080/"), Proxy::Http { host: "fd00::1".into(), port: 8080, authorization: None });
        assert_eq!(
            parse("http://user:p%40ss%3Aword@proxy:8080"),
            Proxy::Http { host: "proxy".into(), port: 8080, authorization: Some(format!("Basic {}", base64(b"user:p@ss:word"))) }
        );
        assert_eq!(base64(b"user:p@ss:word"), "dXNlcjpwQHNzOndvcmQ=");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(base64(b"abc"), "YWJj");
        for unusable in ["https://proxy:443", "socks5://proxy:1080", "socks4://proxy:1080", "http://:8080", "http://proxy:0", "http://proxy:x"] {
            assert_eq!(parse(unusable), Proxy::Unsupported, "{unusable}");
        }
    }
}
