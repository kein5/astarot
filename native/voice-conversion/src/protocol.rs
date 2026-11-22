//! The fixed live voice conversion pipe contract, "VVC1" ([`protocol.py`]).
//!
//! A packet is `b"VVC1"`, the length of a JSON header as a little-endian u32, the header, then
//! `pcm_bytes` of 48 kHz mono s16le audio. The worker answers `ready` (or `failed` with a fixed
//! code), then one `output` packet for every `input` packet. Nothing the worker writes is shown
//! beyond these codes.
//!
//! Every block of a session has the same length, a [`Block`]: the owner chooses it (the RVC
//! worker's `--block-ms`) and the worker's `ready` packet confirms it in `block_frames`, or the
//! owner leaves it to the RVC worker (`--block-ms auto`) and takes it from `ready`.
//!
//! [`protocol.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/voice_conversion/protocol.py

use std::io::Read;

use serde_json::{json, Map, Value};

pub const RATE: u32 = 48000;

/// The length of the audio blocks of one session.
///
/// A whole number of the owner's 20 ms capture parts (`process::PART`) from 20 ms to 200 ms
/// (`BLOCK_MS`), so that the parts fill a block exactly and the RVC worker's stream, which
/// counts in 10 ms frames, has a block and a crossfade of at least one frame each.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    ms: u32,
}

/// The block lengths a session may have, in ms, in steps of [`BLOCK_STEP_MS`].
pub const BLOCK_MS: std::ops::RangeInclusive<u32> = 20..=200;
pub const BLOCK_STEP_MS: u32 = 20;
/// The block of the external runtime the RVC worker replaced, and of Seed-VC.
pub const LEGACY_BLOCK_MS: u32 = 80;
/// The audio of the longest block: the most one packet may carry.
pub const MAX_PCM_BYTES: usize = (RATE as usize / 1000) * 200 * 2;

impl Block {
    /// A block of `ms`, or `None` when the length is not one a session may have.
    pub fn from_ms(ms: u32) -> Option<Self> {
        (BLOCK_MS.contains(&ms) && ms.is_multiple_of(BLOCK_STEP_MS)).then_some(Block { ms })
    }

    pub fn ms(self) -> u32 {
        self.ms
    }

    /// 48 kHz samples per block.
    pub fn frames(self) -> usize {
        (RATE as usize / 1000) * self.ms as usize
    }

    pub fn pcm_bytes(self) -> usize {
        self.frames() * 2
    }

    pub fn ns(self) -> i64 {
        i64::from(self.ms) * 1_000_000
    }
}

impl Default for Block {
    fn default() -> Self {
        Block { ms: LEGACY_BLOCK_MS }
    }
}
/// How old a block may be when it is written. Python chose by OS; the device route is the
/// Windows one: Windows reads its clock in 16 ms ticks and schedules GPU work with more jitter,
/// and that route drops a late block before sending it, so this only catches a stalled worker.
pub const MAX_AGE_NS: i64 = if cfg!(windows) { DEVICE_MAX_AGE_NS } else { MANAGED_MAX_AGE_NS };
pub const DEVICE_MAX_AGE_NS: i64 = 1_000_000_000;
pub const MANAGED_MAX_AGE_NS: i64 = 160_000_000;
const MAGIC: &[u8; 4] = b"VVC1";
const HEADER_LIMIT: usize = 2048;
/// RVC converts on a GPU (`low`, as before; CUDA or DirectML) or on the CPU (`cpu`, with a
/// larger delay).
pub const RVC_PROFILES: [&str; 2] = ["low", "cpu"];
pub const MAX_LATENCY_MS: i64 = 10_000;

/// Why a worker could not become ready, from a fixed list.
pub const WORKER_FAILURES: [&str; 9] = [
    "vc_gpu_unavailable",
    "vc_directml_unavailable",
    "vc_cpu_too_slow",
    "vc_model_missing",
    "vc_runtime_version_unsupported",
    "vc_checkpoint_incomplete",
    "vc_index_failed",
    "vc_engine_format_invalid",
    "vc_runtime_incomplete",
];

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
pub fn ready_info(session_id: &str, engine: &str, profile: &str, latency_ms: i64, block: Block) -> Result<Info> {
    if !matches!(engine, "seed-vc" | "rvc") {
        return Err(ProtocolError::new("vc_engine_invalid"));
    }
    let mut info = object(json!({"type": "ready", "protocol": 1, "session": session(session_id)?, "engine": engine, "profile": "low", "rate": RATE, "channels": 1, "block_frames": block.frames()}));
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
pub fn input_info(session_id: &str, sequence: u64, start_ns: i64, block: Block) -> Result<Info> {
    if sequence >= 1 << 63 || start_ns <= 0 || start_ns > i64::MAX - block.ns() {
        return Err(ProtocolError::new("vc_input_invalid"));
    }
    Ok(object(json!({"type": "input", "session": session(session_id)?, "sequence": sequence, "start_ns": start_ns, "end_ns": start_ns + block.ns(), "rate": RATE, "channels": 1})))
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

/// The block a worker chose (`--block-ms auto`, #531): its `ready` packet's `block_frames`,
/// when that is a whole block a session may have. [`require_ready`] checks the rest.
pub fn ready_block(info: &Info) -> Option<Block> {
    let frames = info.get("block_frames").filter(|value| value.is_u64())?.as_u64()?;
    let per_ms = u64::from(RATE / 1000);
    if !frames.is_multiple_of(per_ms) {
        return None;
    }
    Block::from_ms(u32::try_from(frames / per_ms).ok()?)
}

/// The worker's ready packet, or its failure. Returns where it converts (`gpu`, `cpu`, or
/// `None` for an engine that does not say) and its delay in ms. A worker that would use
/// another block than the owner's is refused.
pub fn require_ready(info: &Info, pcm: &[u8], session_id: &str, engine: &str, block: Block) -> Result<(Option<&'static str>, Option<i64>)> {
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
        let expected = ready_info(session_id, engine, profile, latency, block).map_err(|_| invalid())?;
        if !same(info, &with_pcm(expected, 0)) {
            return Err(invalid());
        }
        return Ok((Some(if profile == "low" { "gpu" } else { "cpu" }), Some(latency)));
    }
    if !same(info, &with_pcm(ready_info(session_id, engine, "low", 0, block)?, 0)) {
        return Err(invalid());
    }
    Ok((None, None))
}

pub fn require_fresh(end_ns: i64, now_ns: i64, max_age_ns: i64) -> Result<()> {
    if end_ns <= 0 || end_ns > now_ns || now_ns - end_ns > max_age_ns {
        return Err(ProtocolError::new("vc_block_expired"));
    }
    Ok(())
}

fn integer(info: &Info, key: &str) -> Option<i64> {
    info.get(key).filter(|v| v.is_i64() || v.is_u64()).and_then(Value::as_i64)
}

pub fn require_input(info: &Info, pcm: &[u8], session_id: &str, sequence: u64, now_ns: i64, max_age_ns: i64, block: Block) -> Result<()> {
    let invalid = || ProtocolError::new("vc_input_invalid");
    let start = integer(info, "start_ns").ok_or_else(invalid)?;
    let expected = with_pcm(input_info(session_id, sequence, start, block)?, block.pcm_bytes());
    if pcm.len() != block.pcm_bytes() || !same(info, &expected) {
        return Err(invalid());
    }
    require_fresh(start + block.ns(), now_ns, max_age_ns)
}

/// The worker's answer to `source`. Returns `converted` or `vad_silence`.
pub fn require_output(info: &Info, pcm: &[u8], source: &Info, original: &[u8], now_ns: i64, max_age_ns: i64, block: Block) -> Result<&'static str> {
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
    require_input(source, original, session_id, sequence, now_ns, max_age_ns, block)?;
    let state = match info.get("state").and_then(Value::as_str) {
        Some("converted") => "converted",
        Some("vad_silence") => "vad_silence",
        _ => return Err(ProtocolError::new("vc_output_invalid")),
    };
    let mut expected = source.clone();
    expected.insert("type".into(), json!("output"));
    expected.insert("state".into(), json!(state));
    if pcm.len() != block.pcm_bytes() || !same(info, &expected) {
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
    if pcm.len() > MAX_PCM_BYTES || !pcm.len().is_multiple_of(2) {
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
    if size > MAX_PCM_BYTES || !size.is_multiple_of(2) {
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
        let block = Block::default();
        let info = input_info(SESSION, 0, 1_000, block).unwrap();
        let packet = encode_packet(&info, &vec![1u8; block.pcm_bytes()]).unwrap();
        let (read, pcm) = read_packet(&mut &packet[..]).unwrap();
        assert_eq!(pcm.len(), block.pcm_bytes());
        assert_eq!(read["pcm_bytes"], block.pcm_bytes());
        assert_eq!(read_packet(&mut &packet[..10]).unwrap_err().code(), "vc_worker_eof");
        let mut bad = packet.clone();
        bad[0] = b'X';
        assert_eq!(read_packet(&mut &bad[..]).unwrap_err().code(), "vc_packet_invalid");
        let duplicate = br#"{"a":1,"a":2,"pcm_bytes":0}"#;
        let mut wire = b"VVC1".to_vec();
        wire.extend((duplicate.len() as u32).to_le_bytes());
        wire.extend(duplicate);
        assert_eq!(read_packet(&mut &wire[..]).unwrap_err().code(), "vc_packet_invalid", "a duplicate key");
        // The longest block fits a packet; more does not.
        assert!(encode_packet(&info, &vec![0u8; MAX_PCM_BYTES]).is_ok());
        assert!(encode_packet(&info, &vec![0u8; MAX_PCM_BYTES + 2]).is_err());
    }

    #[test]
    fn a_block_is_a_whole_number_of_capture_parts_from_20_to_200_ms() {
        assert_eq!(Block::default().ms(), 80);
        assert_eq!(Block::default().frames(), 3840);
        let short = Block::from_ms(40).unwrap();
        assert_eq!((short.frames(), short.pcm_bytes(), short.ns()), (1920, 3840, 40_000_000));
        assert_eq!(Block::from_ms(200).unwrap().pcm_bytes(), MAX_PCM_BYTES);
        for ms in [20, 60, 100, 200] {
            assert!(Block::from_ms(ms).is_some(), "{ms}");
        }
        for ms in [0, 10, 30, 50, 90, 210, 220] {
            assert!(Block::from_ms(ms).is_none(), "{ms}");
        }
    }

    #[test]
    fn ready_and_failed_packets_are_checked_exactly() {
        let block = Block::from_ms(40).unwrap();
        let ready = with_pcm(ready_info(SESSION, "rvc", "cpu", 1182, block).unwrap(), 0);
        assert_eq!(ready["block_frames"], 1920);
        assert_eq!(require_ready(&ready, &[], SESSION, "rvc", block).unwrap(), (Some("cpu"), Some(1182)));
        // A worker that would use another block than the owner's.
        assert_eq!(require_ready(&ready, &[], SESSION, "rvc", Block::default()).unwrap_err().code(), "vc_ready_invalid");
        let mut wrong = ready.clone();
        wrong.insert("latency_ms".into(), json!(1182.0));
        assert_eq!(require_ready(&wrong, &[], SESSION, "rvc", block).unwrap_err().code(), "vc_ready_invalid");
        let failed = with_pcm(failed_info(SESSION, "vc_gpu_unavailable").unwrap(), 0);
        assert_eq!(require_ready(&failed, &[], SESSION, "rvc", block).unwrap_err().code(), "vc_gpu_unavailable");
        let mut other = failed.clone();
        other.insert("code".into(), json!("anything"));
        assert_eq!(require_ready(&other, &[], SESSION, "rvc", block).unwrap_err().code(), "vc_ready_invalid");
    }

    #[test]
    fn an_output_must_answer_its_block_and_never_pass_it_through() {
        for block in [Block::default(), Block::from_ms(40).unwrap()] {
            let bytes = block.pcm_bytes();
            let now = 10_000_000_000;
            let source = with_pcm(input_info(SESSION, 4, now - block.ns() - 1, block).unwrap(), bytes);
            let original = vec![3u8; bytes];
            let mut output = source.clone();
            output.insert("type".into(), json!("output"));
            output.insert("state".into(), json!("converted"));
            assert_eq!(require_output(&output, &vec![5u8; bytes], &source, &original, now, MAX_AGE_NS, block).unwrap(), "converted");
            assert_eq!(require_output(&output, &vec![5u8; bytes + 2], &source, &original, now, MAX_AGE_NS, block).unwrap_err().code(), "vc_output_invalid");
            assert_eq!(require_output(&output, &original, &source, &original, now, MAX_AGE_NS, block).unwrap_err().code(), "vc_passthrough_forbidden");
            output.insert("state".into(), json!("vad_silence"));
            assert_eq!(require_output(&output, &vec![5u8; bytes], &source, &original, now, MAX_AGE_NS, block).unwrap_err().code(), "vc_silence_invalid");
            assert_eq!(require_output(&output, &vec![0u8; bytes], &source, &original, now + MAX_AGE_NS + 10, MAX_AGE_NS, block).unwrap_err().code(), "vc_block_expired");
            let overrun = with_pcm(failed_info(SESSION, "vc_capture_overrun").unwrap(), 0);
            assert_eq!(require_output(&overrun, &[], &source, &original, now, MAX_AGE_NS, block).unwrap_err().code(), "vc_capture_overrun");
        }
    }

    #[test]
    fn a_worker_may_say_why_it_cannot_start_only_with_a_listed_code() {
        // `test_vc_protocol.py`: `a_worker_can_say_why_it_cannot_start` and
        // `only_a_listed_reason_is_trusted`.
        let block = Block::default();
        for code in WORKER_FAILURES {
            let failed = with_pcm(failed_info(SESSION, code).unwrap(), 0);
            assert_eq!(require_ready(&failed, &[], SESSION, "rvc", block).unwrap_err().code(), code);
        }
        // A run failure is not a reason not to start; an unlisted code is not trusted.
        let overrun = with_pcm(failed_info(SESSION, "vc_capture_overrun").unwrap(), 0);
        assert_eq!(require_ready(&overrun, &[], SESSION, "rvc", block).unwrap_err().code(), "vc_ready_invalid");
        assert_eq!(failed_info(SESSION, "failed_info").unwrap_err().code(), "vc_ready_invalid");
        let failed = with_pcm(failed_info(SESSION, "vc_model_missing").unwrap(), 0);
        let variants: [(&str, Value); 4] =
            [("session", json!("f".repeat(32))), ("protocol", json!(2)), ("extra", json!(1)), ("code", json!("vc_model_missing "))];
        for (key, value) in variants {
            let mut changed = failed.clone();
            changed.insert(key.into(), value);
            assert_eq!(require_ready(&changed, &[], SESSION, "rvc", block).unwrap_err().code(), "vc_ready_invalid", "{key}");
        }
        // A failure carries no audio.
        assert_eq!(require_ready(&failed, &[0, 0], SESSION, "rvc", block).unwrap_err().code(), "vc_ready_invalid");
    }

    #[test]
    fn a_ready_packet_must_match_the_fixed_contract() {
        // `ready_must_match_fixed_contract`.
        let block = Block::default();
        let ready = with_pcm(ready_info(SESSION, "rvc", "low", 120, block).unwrap(), 0);
        assert_eq!(require_ready(&ready, &[], SESSION, "rvc", block).unwrap(), (Some("gpu"), Some(120)));
        let cases: [(&str, Value); 10] = [
            ("session", json!("f".repeat(32))),
            ("engine", json!("seed-vc")),
            ("protocol", json!(2)),
            ("rate", json!(44100)),
            ("channels", json!(2)),
            ("profile", json!("npu")),
            ("latency_ms", json!(MAX_LATENCY_MS + 1)),
            ("latency_ms", json!(-1)),
            ("block_frames", json!(block.frames() + 1)),
            ("extra", json!(true)),
        ];
        for (key, value) in cases {
            let mut changed = ready.clone();
            changed.insert(key.into(), value.clone());
            assert_eq!(require_ready(&changed, &[], SESSION, "rvc", block).unwrap_err().code(), "vc_ready_invalid", "{key} {value}");
        }
        let mut missing = ready.clone();
        missing.remove("latency_ms");
        assert_eq!(require_ready(&missing, &[], SESSION, "rvc", block).unwrap_err().code(), "vc_ready_invalid");
        // A ready packet carries no audio, and the engine is one the owner knows.
        assert_eq!(require_ready(&ready, &[0, 0], SESSION, "rvc", block).unwrap_err().code(), "vc_ready_invalid");
        assert_eq!(ready_info(SESSION, "other", "low", 0, block).unwrap_err().code(), "vc_engine_invalid");
        assert_eq!(ready_info("not-a-session", "rvc", "low", 0, block).unwrap_err().code(), "vc_session_invalid");
        // The CPU profile is the CPU.
        let cpu = with_pcm(ready_info(SESSION, "rvc", "cpu", MAX_LATENCY_MS, block).unwrap(), 0);
        assert_eq!(require_ready(&cpu, &[], SESSION, "rvc", block).unwrap(), (Some("cpu"), Some(MAX_LATENCY_MS)));
    }

    #[test]
    fn a_block_the_worker_chose_is_read_from_its_ready_packet() {
        // `--block-ms auto` (#531): the owner takes the block from `ready`, then checks the
        // packet against it like a block it chose.
        for ms in [40, 60, 80, 100, 120, 160, 200] {
            let block = Block::from_ms(ms).unwrap();
            let ready = with_pcm(ready_info(SESSION, "rvc", "low", 52, block).unwrap(), 0);
            assert_eq!(ready_block(&ready), Some(block), "{ms}");
            assert!(require_ready(&ready, &[], SESSION, "rvc", ready_block(&ready).unwrap()).is_ok());
        }
        // Only a whole block a session may have.
        let ready = with_pcm(ready_info(SESSION, "rvc", "low", 52, Block::default()).unwrap(), 0);
        for frames in [json!(48 * 30), json!(48 * 220), json!(48 * 40 + 1), json!(0), json!(-1920), json!(1920.0), json!("1920"), Value::Null] {
            let mut changed = ready.clone();
            changed.insert("block_frames".into(), frames.clone());
            assert_eq!(ready_block(&changed), None, "{frames}");
        }
        // A failure has no block; it still says why it failed.
        let failed = with_pcm(failed_info(SESSION, "vc_gpu_unavailable").unwrap(), 0);
        assert_eq!(ready_block(&failed), None);
        assert_eq!(require_ready(&failed, &[], SESSION, "rvc", Block::default()).unwrap_err().code(), "vc_gpu_unavailable");
    }

    #[test]
    fn an_output_that_does_not_answer_its_block_cannot_reach_audio() {
        // `mismatched_output_cannot_reach_audio`, `vad_silence_is_zero`, and blocks from the
        // future or too old (`expired_or_future_blocks`).
        let block = Block::default();
        let bytes = block.pcm_bytes();
        let now = 10_000_000_000;
        let source = with_pcm(input_info(SESSION, 4, now - block.ns() - 1, block).unwrap(), bytes);
        let original = vec![3u8; bytes];
        let converted = vec![5u8; bytes];
        let mut output = source.clone();
        output.insert("type".into(), json!("output"));
        output.insert("state".into(), json!("converted"));
        let cases: [(&str, Value); 10] = [
            ("session", json!("f".repeat(32))),
            ("sequence", json!(5)),
            ("start_ns", json!(now - block.ns())),
            ("end_ns", json!(now)),
            ("rate", json!(44100)),
            ("channels", json!(2)),
            ("type", json!("input")),
            ("state", json!("passthrough")),
            ("sequence", json!(4.0)),
            ("extra", json!(1)),
        ];
        for (key, value) in cases {
            let mut changed = output.clone();
            changed.insert(key.into(), value.clone());
            assert_eq!(require_output(&changed, &converted, &source, &original, now, MAX_AGE_NS, block).unwrap_err().code(), "vc_output_invalid", "{key} {value}");
        }
        let mut missing = output.clone();
        missing.remove("end_ns");
        assert_eq!(require_output(&missing, &converted, &source, &original, now, MAX_AGE_NS, block).unwrap_err().code(), "vc_output_invalid");
        // Silence the worker found is zeros, and accepted as such.
        let mut silence = output.clone();
        silence.insert("state".into(), json!("vad_silence"));
        assert_eq!(require_output(&silence, &vec![0u8; bytes], &source, &original, now, MAX_AGE_NS, block).unwrap(), "vad_silence");
        // A block that ends after now, or that is older than allowed, is refused.
        let future = with_pcm(input_info(SESSION, 4, now, block).unwrap(), bytes);
        let mut answer = future.clone();
        answer.insert("type".into(), json!("output"));
        answer.insert("state".into(), json!("converted"));
        assert_eq!(require_output(&answer, &converted, &future, &original, now, MAX_AGE_NS, block).unwrap_err().code(), "vc_block_expired");
        assert_eq!(require_fresh(now - MAX_AGE_NS - 1, now, MAX_AGE_NS).unwrap_err().code(), "vc_block_expired");
        assert!(require_fresh(now - MAX_AGE_NS, now, MAX_AGE_NS).is_ok());
        // A silent microphone's block may come back as it was: there is nothing to pass through.
        let quiet = vec![0u8; bytes];
        assert_eq!(require_output(&output, &quiet, &source, &quiet, now, MAX_AGE_NS, block).unwrap(), "converted");
        // A worker failure while it runs is told only with a listed code.
        let unlisted = with_pcm(object(json!({"type": "failed", "protocol": 1, "session": SESSION, "code": "vc_model_missing"})), 0);
        assert_eq!(require_output(&unlisted, &[], &source, &original, now, MAX_AGE_NS, block).unwrap_err().code(), "vc_output_invalid");
    }

    #[test]
    fn framing_that_is_cut_short_or_malformed_is_refused() {
        // `invalid_framing_or_eof` and `declared_pcm_is_bounded`.
        let block = Block::default();
        let info = input_info(SESSION, 0, 1_000, block).unwrap();
        let packet = encode_packet(&info, &vec![1u8; block.pcm_bytes()]).unwrap();
        assert_eq!(read_packet(&mut &packet[..0]).unwrap_err().code(), "vc_worker_eof");
        assert_eq!(read_packet(&mut &packet[..6]).unwrap_err().code(), "vc_worker_eof");
        assert_eq!(read_packet(&mut &packet[..packet.len() - 1]).unwrap_err().code(), "vc_worker_eof");
        let wire = |header: &[u8], length: u32| {
            let mut wire = b"VVC1".to_vec();
            wire.extend(length.to_le_bytes());
            wire.extend(header);
            wire
        };
        // A header of no length, one over the limit, one that is not a JSON object, and one
        // without `pcm_bytes` or with an odd or too large one.
        assert_eq!(read_packet(&mut &wire(b"", 0)[..]).unwrap_err().code(), "vc_packet_invalid");
        assert_eq!(read_packet(&mut &wire(b"{}", (HEADER_LIMIT + 1) as u32)[..]).unwrap_err().code(), "vc_packet_invalid");
        for header in [&b"[1]"[..], b"{\"pcm_bytes\":", b"{}", b"{\"pcm_bytes\":3}", b"{\"pcm_bytes\":-2}", b"{\"pcm_bytes\":2.0}"] {
            assert_eq!(read_packet(&mut &wire(header, header.len() as u32)[..]).unwrap_err().code(), "vc_packet_invalid", "{}", String::from_utf8_lossy(header));
        }
        let large = format!("{{\"pcm_bytes\":{}}}", MAX_PCM_BYTES + 2);
        assert_eq!(read_packet(&mut &wire(large.as_bytes(), large.len() as u32)[..]).unwrap_err().code(), "vc_packet_invalid");
        // Odd audio is not written either.
        assert_eq!(encode_packet(&info, &[0u8; 3]).unwrap_err().code(), "vc_packet_invalid");
    }
}
