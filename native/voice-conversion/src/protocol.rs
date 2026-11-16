//! The fixed live voice conversion pipe contract, "VVC1" (`protocol.py`).
//!
//! A packet is `b"VVC1"`, the length of a JSON header as a little-endian u32, the header, then
//! `pcm_bytes` of 48 kHz mono s16le audio. The worker answers `ready` (or `failed` with a fixed
//! code), then one `output` packet for every `input` packet. Nothing the worker writes is shown
//! beyond these codes.

use std::io::Read;

use serde_json::{json, Map, Value};

pub const RATE: u32 = 48000;
pub const FRAMES: usize = 3840;
pub const PCM_BYTES: usize = FRAMES * 2;
pub const BLOCK_NS: i64 = 80_000_000;
/// Windows reads its clock in 16 ms ticks and schedules GPU work with more jitter. Its route
/// drops a late block before sending it, so this only catches a stalled worker.
pub const MAX_AGE_NS: i64 = if cfg!(windows) { 1_000_000_000 } else { 160_000_000 };
const MAGIC: &[u8; 4] = b"VVC1";
const HEADER_LIMIT: usize = 2048;
/// RVC converts on the GPU (`low`, as before) or on the CPU (`cpu`, with a larger delay).
pub const RVC_PROFILES: [&str; 2] = ["low", "cpu"];
pub const MAX_LATENCY_MS: i64 = 10_000;

/// Why a worker could not become ready, from a fixed list.
pub const WORKER_FAILURES: [&str; 7] =
    ["vc_gpu_unavailable", "vc_model_missing", "vc_runtime_version_unsupported", "vc_checkpoint_incomplete", "vc_index_failed", "vc_engine_format_invalid", "vc_runtime_incomplete"];

/// Why a running worker stops instead of answering a block.
pub const RUN_FAILURES: [&str; 1] = ["vc_capture_overrun"];

pub type Info = Map<String, Value>;

/// A fixed diagnostic code, without worker output or private paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolError(pub String);

impl ProtocolError {
    pub fn new(code: &str) -> Self {
        Self(code.to_owned())
    }

    pub fn code(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ProtocolError {}

type Result<T> = std::result::Result<T, ProtocolError>;

fn session(value: &str) -> Result<&str> {
    if value.len() == 32 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        Ok(value)
    } else {
        Err(ProtocolError::new("vc_session_invalid"))
    }
}

/// Same keys, and each value of the same JSON type and equal (`_same`).
fn same(actual: &Info, expected: &Info) -> bool {
    actual.len() == expected.len() && expected.iter().all(|(key, value)| actual.get(key).is_some_and(|other| same_value(other, value)))
}

fn same_value(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        // An integer is not a float, and a float is not an integer (Python's `type(...) is`).
        (Value::Number(a), Value::Number(b)) => (a.is_f64() == b.is_f64()) && a == b,
        _ => actual == expected,
    }
}

fn object(value: Value) -> Info {
    match value {
        Value::Object(map) => map,
        _ => unreachable!("built from an object"),
    }
}

/// The worker's `ready` packet. RVC's also says where it converts and the delay it adds.
pub fn ready_info(session_id: &str, engine: &str, profile: &str, latency_ms: i64) -> Result<Info> {
    if !matches!(engine, "seed-vc" | "rvc") {
        return Err(ProtocolError::new("vc_engine_invalid"));
    }
    let mut info = object(json!({"type": "ready", "protocol": 1, "session": session(session_id)?, "engine": engine, "profile": "low", "rate": RATE, "channels": 1, "block_frames": FRAMES}));
    if engine == "rvc" {
        if !RVC_PROFILES.contains(&profile) || !(0..=MAX_LATENCY_MS).contains(&latency_ms) {
            return Err(ProtocolError::new("vc_ready_invalid"));
        }
        info.insert("profile".into(), json!(profile));
        info.insert("latency_ms".into(), json!(latency_ms));
    }
    Ok(info)
}

/// One block of microphone audio for the worker.
pub fn input_info(session_id: &str, sequence: u64, start_ns: i64) -> Result<Info> {
    if sequence >= 1 << 63 || start_ns <= 0 || start_ns > i64::MAX - BLOCK_NS {
        return Err(ProtocolError::new("vc_input_invalid"));
    }
    Ok(object(json!({"type": "input", "session": session(session_id)?, "sequence": sequence, "start_ns": start_ns, "end_ns": start_ns + BLOCK_NS, "rate": RATE, "channels": 1})))
}

pub fn failed_info(session_id: &str, code: &str) -> Result<Info> {
    if !WORKER_FAILURES.contains(&code) && !RUN_FAILURES.contains(&code) {
        return Err(ProtocolError::new("vc_ready_invalid"));
    }
    Ok(object(json!({"type": "failed", "protocol": 1, "session": session(session_id)?, "code": code})))
}

fn with_pcm(mut info: Info, pcm_bytes: usize) -> Info {
    info.insert("pcm_bytes".into(), json!(pcm_bytes));
    info
}

/// The worker's ready packet, or its failure. Returns where it converts (`gpu`, `cpu`, or
/// `None` for an engine that does not say) and its delay in ms.
pub fn require_ready(info: &Info, pcm: &[u8], session_id: &str, engine: &str) -> Result<(Option<&'static str>, Option<i64>)> {
    let invalid = || ProtocolError::new("vc_ready_invalid");
    if info.get("type").and_then(Value::as_str) == Some("failed") {
        let code = info.get("code").and_then(Value::as_str).unwrap_or("");
        if pcm.is_empty() && WORKER_FAILURES.contains(&code) && same(info, &with_pcm(failed_info(session_id, code)?, 0)) {
            return Err(ProtocolError::new(code));
        }
        return Err(invalid());
    }
    if !pcm.is_empty() {
        return Err(invalid());
    }
    if engine == "rvc" {
        let profile = info.get("profile").and_then(Value::as_str).ok_or_else(invalid)?;
        let latency = info.get("latency_ms").filter(|v| v.is_i64() || v.is_u64()).and_then(Value::as_i64).ok_or_else(invalid)?;
        let expected = ready_info(session_id, engine, profile, latency).map_err(|_| invalid())?;
        if !same(info, &with_pcm(expected, 0)) {
            return Err(invalid());
        }
        return Ok((Some(if profile == "low" { "gpu" } else { "cpu" }), Some(latency)));
    }
    if !same(info, &with_pcm(ready_info(session_id, engine, "low", 0)?, 0)) {
        return Err(invalid());
    }
    Ok((None, None))
}

pub fn require_fresh(end_ns: i64, now_ns: i64) -> Result<()> {
    if end_ns <= 0 || end_ns > now_ns || now_ns - end_ns > MAX_AGE_NS {
        return Err(ProtocolError::new("vc_block_expired"));
    }
    Ok(())
}

fn integer(info: &Info, key: &str) -> Option<i64> {
    info.get(key).filter(|v| v.is_i64() || v.is_u64()).and_then(Value::as_i64)
}

pub fn require_input(info: &Info, pcm: &[u8], session_id: &str, sequence: u64, now_ns: i64) -> Result<()> {
    let invalid = || ProtocolError::new("vc_input_invalid");
    let start = integer(info, "start_ns").ok_or_else(invalid)?;
    let expected = with_pcm(input_info(session_id, sequence, start)?, PCM_BYTES);
    if pcm.len() != PCM_BYTES || !same(info, &expected) {
        return Err(invalid());
    }
    require_fresh(start + BLOCK_NS, now_ns)
}

/// The worker's answer to `source`. Returns `converted` or `vad_silence`.
pub fn require_output(info: &Info, pcm: &[u8], source: &Info, original: &[u8], now_ns: i64) -> Result<&'static str> {
    let session_id = source.get("session").and_then(Value::as_str).unwrap_or("");
    if info.get("type").and_then(Value::as_str) == Some("failed") {
        let code = info.get("code").and_then(Value::as_str).unwrap_or("");
        let expected = with_pcm(object(json!({"type": "failed", "protocol": 1, "session": session(session_id)?, "code": code})), 0);
        if pcm.is_empty() && RUN_FAILURES.contains(&code) && same(info, &expected) {
            return Err(ProtocolError::new(code));
        }
        return Err(ProtocolError::new("vc_output_invalid"));
    }
    let sequence = source.get("sequence").and_then(Value::as_u64).ok_or_else(|| ProtocolError::new("vc_input_invalid"))?;
    require_input(source, original, session_id, sequence, now_ns)?;
    let state = match info.get("state").and_then(Value::as_str) {
        Some("converted") => "converted",
        Some("vad_silence") => "vad_silence",
        _ => return Err(ProtocolError::new("vc_output_invalid")),
    };
    let mut expected = source.clone();
    expected.insert("type".into(), json!("output"));
    expected.insert("state".into(), json!(state));
    if pcm.len() != PCM_BYTES || !same(info, &expected) {
        return Err(ProtocolError::new("vc_output_invalid"));
    }
    if state == "vad_silence" && pcm.iter().any(|&b| b != 0) {
        return Err(ProtocolError::new("vc_silence_invalid"));
    }
    if original.iter().any(|&b| b != 0) && pcm == original {
        return Err(ProtocolError::new("vc_passthrough_forbidden"));
    }
    Ok(state)
}

/// One packet on the wire.
pub fn encode_packet(info: &Info, pcm: &[u8]) -> Result<Vec<u8>> {
    let invalid = || ProtocolError::new("vc_packet_invalid");
    if pcm.len() > PCM_BYTES || !pcm.len().is_multiple_of(2) {
        return Err(invalid());
    }
    let header = serde_json::to_vec(&Value::Object(with_pcm(info.clone(), pcm.len()))).map_err(|_| invalid())?;
    if header.len() > HEADER_LIMIT {
        return Err(invalid());
    }
    let mut packet = Vec::with_capacity(8 + header.len() + pcm.len());
    packet.extend_from_slice(MAGIC);
    packet.extend_from_slice(&(header.len() as u32).to_le_bytes());
    packet.extend_from_slice(&header);
    packet.extend_from_slice(pcm);
    Ok(packet)
}

/// Read one packet, blocking. A closed stream is `vc_worker_eof`.
pub fn read_packet(reader: &mut dyn Read) -> Result<(Info, Vec<u8>)> {
    let mut read_exact = |size: usize| -> Result<Vec<u8>> {
        let mut buffer = vec![0; size];
        let mut filled = 0;
        while filled < size {
            match reader.read(&mut buffer[filled..]) {
                Ok(0) => return Err(ProtocolError::new("vc_worker_eof")),
                Ok(count) => filled += count,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(ProtocolError::new("vc_worker_eof")),
            }
        }
        Ok(buffer)
    };
    let prefix = read_exact(8)?;
    let length = u32::from_le_bytes(prefix[4..8].try_into().expect("four bytes")) as usize;
    if &prefix[..4] != MAGIC || !(1..=HEADER_LIMIT).contains(&length) {
        return Err(ProtocolError::new("vc_packet_invalid"));
    }
    let header = read_exact(length)?;
    let info = parse_header(&header).ok_or_else(|| ProtocolError::new("vc_packet_invalid"))?;
    let size = info.get("pcm_bytes").filter(|v| v.is_u64()).and_then(Value::as_u64).ok_or_else(|| ProtocolError::new("vc_packet_invalid"))? as usize;
    if size > PCM_BYTES || !size.is_multiple_of(2) {
        return Err(ProtocolError::new("vc_packet_invalid"));
    }
    Ok((info, read_exact(size)?))
}

/// A JSON object without duplicate keys (`_object`).
fn parse_header(bytes: &[u8]) -> Option<Info> {
    let text = std::str::from_utf8(bytes).ok()?;
    let value: Value = serde_json::from_str(text).ok()?;
    let object = value.as_object()?.clone();
    // serde_json keeps the last of duplicate keys; count the keys of the top level to refuse them.
    if top_level_keys(text)? != object.len() {
        return None;
    }
    Some(object)
}

/// The number of keys of a JSON object's top level, or `None` when it is not one.
fn top_level_keys(text: &str) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    let mut keys = 0;
    let mut expect_key = false;
    for c in text.chars() {
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => {
                if depth == 1 && expect_key {
                    keys += 1;
                    expect_key = false;
                }
                in_string = true;
            }
            '{' | '[' => {
                depth += 1;
                if depth == 1 && c == '{' {
                    expect_key = true;
                }
            }
            '}' | ']' => depth -= 1,
            ',' if depth == 1 => expect_key = true,
            _ => {}
        }
    }
    Some(keys)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn packets_round_trip_and_refuse_what_the_contract_does_not_allow() {
        let info = input_info(SESSION, 0, 1_000).unwrap();
        let packet = encode_packet(&info, &[1u8; PCM_BYTES]).unwrap();
        let (read, pcm) = read_packet(&mut &packet[..]).unwrap();
        assert_eq!(pcm.len(), PCM_BYTES);
        assert_eq!(read["pcm_bytes"], PCM_BYTES);
        assert_eq!(read_packet(&mut &packet[..10]).unwrap_err().code(), "vc_worker_eof");
        let mut bad = packet.clone();
        bad[0] = b'X';
        assert_eq!(read_packet(&mut &bad[..]).unwrap_err().code(), "vc_packet_invalid");
        let duplicate = br#"{"a":1,"a":2,"pcm_bytes":0}"#;
        let mut wire = b"VVC1".to_vec();
        wire.extend((duplicate.len() as u32).to_le_bytes());
        wire.extend(duplicate);
        assert_eq!(read_packet(&mut &wire[..]).unwrap_err().code(), "vc_packet_invalid", "a duplicate key");
        assert!(encode_packet(&info, &[0u8; PCM_BYTES + 2]).is_err());
    }

    #[test]
    fn ready_and_failed_packets_are_checked_exactly() {
        let ready = with_pcm(ready_info(SESSION, "rvc", "cpu", 1182).unwrap(), 0);
        assert_eq!(require_ready(&ready, &[], SESSION, "rvc").unwrap(), (Some("cpu"), Some(1182)));
        let mut wrong = ready.clone();
        wrong.insert("latency_ms".into(), json!(1182.0));
        assert_eq!(require_ready(&wrong, &[], SESSION, "rvc").unwrap_err().code(), "vc_ready_invalid");
        let failed = with_pcm(failed_info(SESSION, "vc_gpu_unavailable").unwrap(), 0);
        assert_eq!(require_ready(&failed, &[], SESSION, "rvc").unwrap_err().code(), "vc_gpu_unavailable");
        let mut other = failed.clone();
        other.insert("code".into(), json!("anything"));
        assert_eq!(require_ready(&other, &[], SESSION, "rvc").unwrap_err().code(), "vc_ready_invalid");
    }

    #[test]
    fn an_output_must_answer_its_block_and_never_pass_it_through() {
        let now = 10_000_000_000;
        let source = with_pcm(input_info(SESSION, 4, now - BLOCK_NS - 1).unwrap(), PCM_BYTES);
        let original = vec![3u8; PCM_BYTES];
        let mut output = source.clone();
        output.insert("type".into(), json!("output"));
        output.insert("state".into(), json!("converted"));
        assert_eq!(require_output(&output, &[5u8; PCM_BYTES], &source, &original, now).unwrap(), "converted");
        assert_eq!(require_output(&output, &original, &source, &original, now).unwrap_err().code(), "vc_passthrough_forbidden");
        output.insert("state".into(), json!("vad_silence"));
        assert_eq!(require_output(&output, &[5u8; PCM_BYTES], &source, &original, now).unwrap_err().code(), "vc_silence_invalid");
        assert_eq!(require_output(&output, &[0u8; PCM_BYTES], &source, &original, now + MAX_AGE_NS + 10).unwrap_err().code(), "vc_block_expired");
        let overrun = with_pcm(failed_info(SESSION, "vc_capture_overrun").unwrap(), 0);
        assert_eq!(require_output(&overrun, &[], &source, &original, now).unwrap_err().code(), "vc_capture_overrun");
    }
}
