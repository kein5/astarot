//! TLS for the WebSocket and OBS servers when they listen beyond this PC (SEC-01).
//!
//! The same rules as [`src-python/models/websocket/tls.py`]. On a loopback IPv4 address
//! (127.0.0.0/8) nothing leaves the PC, so both servers stay plain `ws://` and `http://`.
//! Any other address needs a certificate and key that the user chose: the WebSocket
//! server then speaks `wss://` and OBS `https://`. Without a usable certificate the
//! servers do not listen there at all.
//!
//! [`src-python/models/websocket/tls.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/websocket/tls.py

use std::fmt;
use std::fs;
use std::net::Ipv4Addr;
use std::sync::Arc;

use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::ServerConfig;

/// A certificate chain and key in PEM are a few KB. A cap keeps a mistyped path to a
/// large file (or a device) from being read whole.
pub const MAX_PEM_BYTES: u64 = 1024 * 1024;

/// Why the certificate or key cannot be used. It never holds a path or file contents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsSettingsError {
    Missing,
    Unreadable,
    NotAFile,
    Size,
    LoadFailed,
}

impl TlsSettingsError {
    /// The reason string of the Python implementation (`TlsSettingsError.REASONS`).
    pub fn reason(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Unreadable => "unreadable",
            Self::NotAFile => "not_a_file",
            Self::Size => "size",
            Self::LoadFailed => "load_failed",
        }
    }
}

impl fmt::Display for TlsSettingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.reason())
    }
}

impl std::error::Error for TlsSettingsError {}

/// Only loopback IPv4 addresses may listen without TLS. Anything unparsable counts as
/// remote, as does every IPv6 address (the Python implementation parses IPv4 only).
pub fn requires_tls(host: &str) -> bool {
    match host.parse::<Ipv4Addr>() {
        Ok(address) => !address.is_loopback(),
        Err(_) => true,
    }
}

fn check_file(path: &str) -> Result<(), TlsSettingsError> {
    if path.trim().is_empty() {
        return Err(TlsSettingsError::Missing);
    }
    let info = fs::metadata(path).map_err(|_| TlsSettingsError::Unreadable)?;
    if !info.is_file() {
        return Err(TlsSettingsError::NotAFile);
    }
    if info.len() == 0 || info.len() > MAX_PEM_BYTES {
        return Err(TlsSettingsError::Size);
    }
    Ok(())
}

fn read_capped(path: &str) -> Result<Vec<u8>, TlsSettingsError> {
    use std::io::Read;
    let file = fs::File::open(path).map_err(|_| TlsSettingsError::LoadFailed)?;
    let mut bytes = Vec::new();
    file.take(MAX_PEM_BYTES + 1).read_to_end(&mut bytes).map_err(|_| TlsSettingsError::LoadFailed)?;
    if bytes.len() as u64 > MAX_PEM_BYTES {
        return Err(TlsSettingsError::Size);
    }
    Ok(bytes)
}

/// A TLS 1.2+ server configuration for this certificate chain and key (both PEM; one
/// file holding both is allowed). A key with a passphrase is not supported and fails
/// as `load_failed`; nothing ever waits for a typed passphrase.
pub fn server_config(cert_file: &str, key_file: &str) -> Result<Arc<ServerConfig>, TlsSettingsError> {
    check_file(cert_file)?;
    check_file(key_file)?;
    let cert_pem = read_capped(cert_file)?;
    let key_pem = read_capped(key_file)?;
    let chain: Vec<CertificateDer<'static>> = CertificateDer::pem_slice_iter(&cert_pem)
        .collect::<Result<_, _>>()
        .map_err(|_| TlsSettingsError::LoadFailed)?;
    if chain.is_empty() {
        return Err(TlsSettingsError::LoadFailed);
    }
    let key = PrivateKeyDer::from_pem_slice(&key_pem).map_err(|_| TlsSettingsError::LoadFailed)?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    // TLS 1.2 and 1.3 are the only versions rustls speaks: the same floor as Python's
    // `minimum_version = TLSv1_2`.
    let config = ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
        .map_err(|_| TlsSettingsError::LoadFailed)?
        .with_no_client_auth()
        .with_single_cert(chain, key)
        .map_err(|_| TlsSettingsError::LoadFailed)?;
    Ok(Arc::new(config))
}

/// The configuration a listener on `host` must use: `None` on loopback, else a loaded
/// certificate. Fails when `host` is beyond this PC and the certificate cannot be used,
/// so no caller can open a plain listener there.
pub fn listener_config(
    host: &str,
    cert_file: &str,
    key_file: &str,
) -> Result<Option<Arc<ServerConfig>>, TlsSettingsError> {
    if !requires_tls(host) {
        return Ok(None);
    }
    server_config(cert_file, key_file).map(Some)
}
