//! A short sample converted by an RVC worker of its own, for the voice audition of the RVC
//! catalog (#415).
//!
//! The worker is started first, since loading its networks takes seconds; the sample is made
//! meanwhile. Once the worker is ready, the sample goes to it in blocks at the pace it plays, as
//! a microphone's would, and each checked answer goes to the caller's output. A silent tail lets
//! the worker's own delay play out. Nothing is kept, and the worker ends with the audition. No
//! microphone, managed route or output device is touched here: the caller writes the answers.

use std::thread;
use std::time::Duration;

use serde_json::json;
use astarot_audio_routing::sync::monotonic_ns;

use crate::process::PreparedRvc;
use crate::protocol::{self as p, ProtocolError};
use crate::worker::WorkerPipe;

/// How long the worker may take to load its networks (and, on its first start with a model and
/// GPU, to time the GPU for its block, #531), as on the device route.
pub const READY_TIMEOUT: Duration = Duration::from_secs(astarot_audio_routing::windows_route::READY_TIMEOUT_S);
/// How long one block's answer may take. A block plays later than on the live route, so a slower
/// PC is heard converting rather than refused.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_AGE_NS: i64 = 2_000_000_000;
/// The longest sample: 10 seconds of 48 kHz mono s16le.
pub const MAX_SAMPLE_BYTES: usize = 10 * p::RATE as usize * 2;

/// Converts `sample` (48 kHz mono s16le, made by `make_sample` while the worker loads) and hands
/// each answer to `write` with its state (`converted` or `vad_silence`, which is silence).
/// `check` is asked often and ends the audition with its error. The worker has ended when this
/// returns.
pub fn convert_sample(
    prepared: &PreparedRvc,
    make_sample: &mut dyn FnMut() -> Result<Vec<u8>, String>,
    write: &mut dyn FnMut(&[u8], &'static str) -> Result<(), String>,
    check: &dyn Fn() -> Result<(), String>,
) -> Result<(), String> {
    check()?;
    let mut worker = WorkerPipe::start(&prepared.worker, &prepared.args, None).map_err(|_| "vc_worker_failed".to_owned())?;
    let result = converse(&worker, prepared, make_sample, write, check);
    let ended = worker.end();
    match result {
        Ok(()) if !ended => Err("vc_cleanup_failed".into()),
        other => other,
    }
}

fn converse(
    worker: &WorkerPipe,
    prepared: &PreparedRvc,
    make_sample: &mut dyn FnMut() -> Result<Vec<u8>, String>,
    write: &mut dyn FnMut(&[u8], &'static str) -> Result<(), String>,
    check: &dyn Fn() -> Result<(), String>,
) -> Result<(), String> {
    let mut sample = make_sample()?;
    if sample.len() > MAX_SAMPLE_BYTES {
        return Err("voice_audition_sample_invalid".into());
    }
    check()?;
    let mut checked = || check().map_err(ProtocolError);
    let (info, pcm) = worker.read(READY_TIMEOUT, &mut checked).map_err(|e| e.0)?;
    let block = prepared.block.or_else(|| p::ready_block(&info)).unwrap_or_default();
    let (_, latency) = p::require_ready(&info, &pcm, &prepared.session, "rvc", block).map_err(|e| e.0)?;
    with_tail(&mut sample, latency.unwrap_or(0), block);
    let begun = monotonic_ns() as i64;
    let mut previous = 0;
    for (sequence, chunk) in sample.chunks(block.pcm_bytes()).enumerate() {
        // Handed over once it would have been captured, as the live route's blocks are.
        let due = begun + (sequence as i64 + 1) * block.ns();
        loop {
            check()?;
            let left = due - monotonic_ns() as i64;
            if left <= 0 {
                break;
            }
            thread::sleep(Duration::from_nanos(left.min(5_000_000) as u64));
        }
        let start = (monotonic_ns() as i64 - block.ns()).max(previous + 1);
        previous = start;
        let mut info = p::input_info(&prepared.session, sequence as u64, start, block).map_err(|e| e.0)?;
        worker.send(p::encode_packet(&info, chunk).map_err(|e| e.0)?).map_err(|e| e.0)?;
        let (answer, converted) = worker.read(ANSWER_TIMEOUT, &mut checked).map_err(|e| e.0)?;
        info.insert("pcm_bytes".into(), json!(block.pcm_bytes()));
        let state = p::require_output(&answer, &converted, &info, chunk, monotonic_ns() as i64, MAX_AGE_NS, block).map_err(|e| e.0)?;
        check()?;
        write(&converted, state)?;
    }
    Ok(())
}

/// Silence after the sample for the worker's delay and one block more, then whole blocks. An odd
/// byte at the end, half a sample, is dropped.
fn with_tail(sample: &mut Vec<u8>, latency_ms: i64, block: p::Block) {
    sample.truncate(sample.len() & !1);
    let frames = sample.len() / 2 + usize::try_from(latency_ms.clamp(0, p::MAX_LATENCY_MS)).unwrap_or(0) * (p::RATE as usize / 1000) + block.frames();
    let blocks = frames.div_ceil(block.frames());
    sample.resize(blocks * block.pcm_bytes(), 0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sample_ends_in_whole_blocks_after_the_workers_delay() {
        let block = p::Block::from_ms(80).unwrap();
        // 100 ms of sound, 52 ms of delay and a block: 232 ms, so three blocks.
        let mut sample = vec![1u8; 4800 * 2];
        with_tail(&mut sample, 52, block);
        assert_eq!(sample.len(), 3 * block.pcm_bytes());
        assert!(sample[4800 * 2..].iter().all(|&b| b == 0), "the tail is silence");
        // Half a sample at the end is dropped, not joined to the silence.
        let mut odd = vec![1u8; 3];
        with_tail(&mut odd, 0, block);
        assert_eq!((odd.len(), odd[2]), (2 * block.pcm_bytes(), 0));
    }
}
