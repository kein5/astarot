//! Helpers shared by the integration tests. Certificates are made at test time; no key
//! is committed.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// A fresh empty folder under the target directory, removed by nobody: cargo cleans it.
pub fn temp_dir(name: &str) -> PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "vrct-adapters-{}-{}-{}",
        name,
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub struct Certificate {
    pub cert_file: String,
    pub key_file: String,
    pub cert_pem: String,
    pub key_pem: String,
    pub der: Vec<u8>,
}

/// Write `<name>.pem` and `<name>-key.pem` for `ip` into `folder`.
pub fn make_certificate(folder: &Path, ip: &str, name: &str) -> Certificate {
    let made = rcgen::generate_simple_self_signed(vec![ip.to_string()]).unwrap();
    let cert_pem = made.cert.pem();
    let key_pem = made.key_pair.serialize_pem();
    let cert_file = folder.join(format!("{name}.pem"));
    let key_file = folder.join(format!("{name}-key.pem"));
    std::fs::write(&cert_file, &cert_pem).unwrap();
    std::fs::write(&key_file, &key_pem).unwrap();
    Certificate {
        cert_file: cert_file.to_string_lossy().into_owned(),
        key_file: key_file.to_string_lossy().into_owned(),
        cert_pem,
        key_pem,
        der: made.cert.der().to_vec(),
    }
}

/// A client configuration that trusts exactly this certificate.
pub fn client_config(certificate: &Certificate) -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(rustls::pki_types::CertificateDer::from(certificate.der.clone())).unwrap();
    Arc::new(
        rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}
