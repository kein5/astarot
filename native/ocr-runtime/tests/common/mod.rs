//! Shared helpers for the conformance tests: where the reference fixtures live and how
//! to read them.
#![allow(dead_code)]

use std::path::PathBuf;

/// The reference directory prepared by `reference/setup_reference.py`.
pub fn reference_dir() -> PathBuf {
    if let Some(path) = std::env::var_os("OCR_REFERENCE_DIR") {
        return PathBuf::from(path);
    }
    let cache = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".cache"));
    cache.join("vrct-vox").join("ocr-reference")
}

/// A fixture file under `fixtures/`, or `None` (with a notice) when it has not been
/// generated. Set `OCR_REQUIRE_REFERENCE=1` to make a missing fixture a failure.
pub fn fixture(relative: &str) -> Option<serde_json::Value> {
    let path = reference_dir().join("fixtures").join(relative);
    if path.is_file() {
        return Some(serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap());
    }
    if std::env::var_os("OCR_REQUIRE_REFERENCE").is_some() {
        panic!("reference fixture `{relative}` is missing; see native/ocr-runtime/README.md");
    }
    eprintln!("SKIPPED: reference fixture `{relative}` is missing (see native/ocr-runtime/README.md)");
    None
}

pub fn b64(value: &serde_json::Value) -> Vec<u8> {
    let text = value.as_str().expect("base64 string");
    let digit = |c: u8| -> u32 {
        match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => panic!("bad base64"),
        }
    };
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    for chunk in text.as_bytes().chunks(4) {
        let pad = chunk.iter().filter(|&&c| c == b'=').count();
        let mut v = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            v |= if c == b'=' { 0 } else { digit(c) } << (18 - 6 * i);
        }
        let bytes = [(v >> 16) as u8, (v >> 8) as u8, v as u8];
        out.extend_from_slice(&bytes[..3 - pad]);
    }
    out
}

pub fn usize_of(value: &serde_json::Value) -> usize {
    value.as_u64().expect("unsigned integer") as usize
}

pub fn points(value: &serde_json::Value) -> Vec<(i32, i32)> {
    value.as_array().unwrap().iter().map(|p| (p[0].as_i64().unwrap() as i32, p[1].as_i64().unwrap() as i32)).collect()
}

pub fn fpoints(value: &serde_json::Value) -> Vec<(f32, f32)> {
    value.as_array().unwrap().iter().map(|p| (p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32)).collect()
}
