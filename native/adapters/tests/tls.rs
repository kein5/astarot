//! Mirrors the module tests of [`src-python/test/test_websocket_tls.py`] for [`tls.py`].
//!
//! [`src-python/test/test_websocket_tls.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/test/test_websocket_tls.py
//! [`tls.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/websocket/tls.py

mod common;

use vrct_adapters::tls::{listener_config, requires_tls, server_config, TlsSettingsError, MAX_PEM_BYTES};

#[test]
fn only_loopback_addresses_listen_without_tls() {
    for (host, needed) in [
        ("127.0.0.1", false),
        ("127.5.6.7", false),
        ("0.0.0.0", true),
        ("192.168.1.20", true),
        ("10.0.0.5", true),
        ("::1", true),
        ("localhost", true),
        ("", true),
        ("not an address", true),
    ] {
        assert_eq!(requires_tls(host), needed, "{host}");
    }
}

#[test]
fn a_certificate_and_its_key_make_a_server_config() {
    let dir = common::temp_dir("tls-pair");
    let cert = common::make_certificate(&dir, "127.0.0.1", "server");
    assert!(server_config(&cert.cert_file, &cert.key_file).is_ok());
}

#[test]
fn one_file_holding_both_the_certificate_and_the_key_works() {
    let dir = common::temp_dir("tls-combined");
    let cert = common::make_certificate(&dir, "127.0.0.1", "server");
    let both = dir.join("both.pem");
    std::fs::write(&both, format!("{}{}", cert.cert_pem, cert.key_pem)).unwrap();
    let both = both.to_string_lossy().into_owned();
    assert!(server_config(&both, &both).is_ok());
}

#[test]
fn unusable_certificates_and_keys_are_refused_with_a_reason_only() {
    let dir = common::temp_dir("tls-unusable");
    let cert = common::make_certificate(&dir, "127.0.0.1", "server");
    let other = common::make_certificate(&dir, "127.0.0.1", "other");
    let empty = dir.join("empty.pem");
    std::fs::write(&empty, b"").unwrap();
    let large = dir.join("large.pem");
    std::fs::write(&large, vec![b'a'; (MAX_PEM_BYTES + 1) as usize]).unwrap();
    let garbage = dir.join("garbage.pem");
    std::fs::write(&garbage, b"not a certificate").unwrap();
    let missing = dir.join("missing.pem");
    let path = |p: &std::path::Path| p.to_string_lossy().into_owned();

    let cases = [
        ("".to_string(), cert.key_file.clone(), TlsSettingsError::Missing),
        ("   ".to_string(), cert.key_file.clone(), TlsSettingsError::Missing),
        (cert.cert_file.clone(), "".to_string(), TlsSettingsError::Missing),
        (path(&missing), cert.key_file.clone(), TlsSettingsError::Unreadable),
        (path(&dir), cert.key_file.clone(), TlsSettingsError::NotAFile),
        (path(&empty), cert.key_file.clone(), TlsSettingsError::Size),
        (path(&large), cert.key_file.clone(), TlsSettingsError::Size),
        (path(&garbage), cert.key_file.clone(), TlsSettingsError::LoadFailed),
        (cert.cert_file.clone(), path(&garbage), TlsSettingsError::LoadFailed),
        // The key of another certificate does not match.
        (cert.cert_file.clone(), other.key_file.clone(), TlsSettingsError::LoadFailed),
        // A key in place of the certificate.
        (cert.key_file.clone(), cert.key_file.clone(), TlsSettingsError::LoadFailed),
    ];
    for (cert_file, key_file, reason) in cases {
        let error = server_config(&cert_file, &key_file).err().unwrap();
        assert_eq!(error, reason, "{cert_file} / {key_file}");
        // The reason never quotes a path or contents.
        let shown = error.to_string();
        assert!(["missing", "unreadable", "not_a_file", "size", "load_failed"].contains(&shown.as_str()));
    }
}

#[test]
fn a_key_with_a_passphrase_fails_at_once() {
    let dir = common::temp_dir("tls-passphrase");
    let cert = common::make_certificate(&dir, "127.0.0.1", "server");
    let encrypted = dir.join("encrypted-key.pem");
    std::fs::write(
        &encrypted,
        "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIGbMFcGCSqGSIb3DQEFDTBKMCkGCSqGSIb3DQEFDDAcBAiXZ2sQ0Vb0OQICCAAw\n-----END ENCRYPTED PRIVATE KEY-----\n",
    )
    .unwrap();
    let started = std::time::Instant::now();
    let error = server_config(&cert.cert_file, &encrypted.to_string_lossy()).err().unwrap();
    assert_eq!(error, TlsSettingsError::LoadFailed);
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
}

#[test]
fn loopback_listeners_get_no_config() {
    for host in ["127.0.0.1", "127.0.0.2"] {
        assert!(listener_config(host, "", "").unwrap().is_none());
    }
}

#[test]
fn listeners_beyond_this_pc_need_a_usable_certificate() {
    let dir = common::temp_dir("tls-listener");
    let cert = common::make_certificate(&dir, "127.0.0.1", "server");
    assert_eq!(listener_config("0.0.0.0", "", "").err(), Some(TlsSettingsError::Missing));
    assert_eq!(listener_config("192.168.1.20", &cert.cert_file, "").err(), Some(TlsSettingsError::Missing));
    assert!(listener_config("192.168.1.20", &cert.cert_file, &cert.key_file).unwrap().is_some());
}
