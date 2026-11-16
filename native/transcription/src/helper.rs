//! Linux capture through the `vrct-asr-capture` helper (`capture_pipewire.py`,
//! `capture_packets.py`). The helper reads one PipeWire node and writes stamped 48 kHz mono
//! packets on its standard output; it ends when the thread that started it ends (a pidfd of
//! that thread). Its standard error carries fixed codes only.

use crate::capture::{Capture, OnAudio, OnError, Source, media_class};
use std::io::Read;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vrct_audio_routing::graph::Endpoint;

/// VRCT's own nodes, never captured.
const EXCLUDED: [&str; 3] = ["vrct.managed.", "vrct.source-bridge.", "vrct.asr.capture."];
const HEADER: usize = 32;
const FRAME_BYTES: usize = 1920;
const MAX_AGE_NS: u64 = 250_000_000;
const FRAME_TIMEOUT: Duration = Duration::from_secs(2);

const NATIVE_ERRORS: &[&str] = &[
    "owner_gone", "stalled", "core_changed", "core_error", "stream_disconnected", "clock_changed", "latency_removed",
    "format_removed", "format_invalid", "latency_invalid", "latency_changed", "stream_identity_invalid",
    "clock_snapshot_inconsistent", "clock_position_missing", "clock_invalid", "buffer_corrupted", "discontinuity",
    "buffer_invalid", "timestamp_invalid", "stale_buffer", "pipe_blocked", "endpoint_changed", "unexpected_link",
    "endpoint_removed", "link_removed", "endpoint_missing", "stream_create_failed", "stream_connect_failed",
    "pipewire_version_unsupported",
];

fn native_code(line: &str) -> Option<String> {
    let code = line.strip_prefix("asr_capture_")?;
    NATIVE_ERRORS.contains(&code).then(|| line.to_string())
}

/// `CLOCK_MONOTONIC` in nanoseconds, the clock the helper stamps with.
fn monotonic_ns() -> u64 {
    let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
    now.tv_sec as u64 * 1_000_000_000 + now.tv_nsec as u64
}

/// `CapturePackets`: the helper's stream into 20 ms frames with the stamp of their first sample.
#[derive(Default)]
pub struct Packets {
    wire: Vec<u8>,
    pieces: std::collections::VecDeque<(Vec<u8>, u64)>,
    bytes: usize,
    sequence: u32,
    last_stamp: u64,
    last_cycle: u64,
}

impl Packets {
    pub fn feed(&mut self, data: &[u8], now_ns: u64) -> Result<Vec<(Vec<u8>, u64)>, &'static str> {
        self.wire.extend_from_slice(data);
        let mut out = Vec::new();
        while self.wire.len() >= HEADER {
            let word = |at: usize| u32::from_le_bytes(self.wire[at..at + 4].try_into().expect("4 bytes"));
            let long = |at: usize| u64::from_le_bytes(self.wire[at..at + 8].try_into().expect("8 bytes"));
            let (sequence, cycle, stamp, rate, frames) = (word(4), long(8), long(16), word(24), word(28));
            if &self.wire[..4] != b"VCA1"
                || sequence != self.sequence
                || rate != 48000
                || !(1..=960).contains(&frames)
                || !(0 < stamp && stamp <= cycle && cycle <= now_ns)
                || stamp <= self.last_stamp
                || cycle < self.last_cycle
            {
                return Err("invalid_capture_packet");
            }
            if now_ns - stamp > MAX_AGE_NS {
                return Err("stale_capture_packet");
            }
            let size = HEADER + frames as usize * 2;
            if self.wire.len() < size {
                break;
            }
            let pcm = self.wire[HEADER..size].to_vec();
            self.wire.drain(..size);
            self.sequence = self.sequence.wrapping_add(1);
            self.last_stamp = stamp;
            self.last_cycle = cycle;
            self.bytes += pcm.len();
            self.pieces.push_back((pcm, stamp));
            while self.bytes >= FRAME_BYTES {
                let first = self.pieces[0].1;
                if now_ns - first > MAX_AGE_NS {
                    return Err("stale_capture_packet");
                }
                let mut frame = Vec::with_capacity(FRAME_BYTES);
                while frame.len() < FRAME_BYTES {
                    let (piece, stamp) = self.pieces.pop_front().expect("enough bytes");
                    let take = (FRAME_BYTES - frame.len()).min(piece.len());
                    frame.extend_from_slice(&piece[..take]);
                    if take < piece.len() {
                        let later = stamp + (take as u64 / 2) * 1_000_000_000 / 48000;
                        self.pieces.push_front((piece[take..].to_vec(), later));
                    }
                }
                self.bytes -= FRAME_BYTES;
                out.push((frame, first));
            }
        }
        Ok(out)
    }
}

#[cfg(feature = "pipewire")]
fn read_graph() -> Result<std::sync::Arc<vrct_audio_routing::graph::Graph>, String> {
    vrct_audio_routing::pipewire::read_graph_data(true, None).map_err(|_| "realtime_graph_unavailable".to_string())
}

#[cfg(not(feature = "pipewire"))]
fn read_graph() -> Result<std::sync::Arc<vrct_audio_routing::graph::Graph>, String> {
    Err("realtime_graph_unavailable".into())
}

/// `_select`: an endpoint that is not one of VRCT's own.
fn select(graph: &[serde_json::Value], name: &str, source: Source) -> Result<Endpoint, String> {
    let endpoint = vrct_audio_routing::graph::endpoint(graph, name, media_class(source)).map_err(|e| e.code)?;
    if EXCLUDED.iter().any(|prefix| name.starts_with(prefix)) {
        return Err("asr_capture_endpoint_invalid".into());
    }
    let node = vrct_audio_routing::graph::node(graph, name).map_err(|e| e.code)?;
    let props = vrct_audio_routing::graph::props(node);
    if props.is_some_and(|p| ["vrct.managed.route", "vrct.source.bridge", "vrct.asr.capture"].iter().any(|k| p.contains_key(*k))) {
        return Err("asr_capture_feedback_endpoint".into());
    }
    Ok(endpoint)
}

/// `enumerate_endpoints`: explicit microphone sources or speaker sinks.
pub fn endpoints(source: Source) -> Result<Vec<(Endpoint, String)>, String> {
    let graph = read_graph()?;
    let mut rows = Vec::new();
    for item in vrct_audio_routing::graph::nodes(&graph) {
        let Some(name) = vrct_audio_routing::graph::node_name(item) else { continue };
        let Ok(endpoint) = select(&graph, name, source) else { continue };
        let label = vrct_audio_routing::graph::props(item)
            .and_then(|p| p.get("node.description"))
            .and_then(|v| v.as_str())
            .filter(|l| !l.is_empty())
            .unwrap_or(name)
            .to_string();
        rows.push((endpoint, label));
    }
    Ok(rows)
}

/// `default_endpoint`: the session's default, or its configured one when the default is VRCT's.
pub fn default_endpoint(source: Source) -> Result<Endpoint, String> {
    let graph = read_graph().map_err(|_| "realtime_default_endpoint_missing".to_string())?;
    let kind = if source == Source::Mic { "source" } else { "sink" };
    let mut entries = std::collections::HashMap::new();
    for item in graph.iter() {
        if vrct_audio_routing::graph::kind(item) == Some(vrct_audio_routing::graph::METADATA)
            && item["props"]["metadata.name"] == "default"
        {
            for row in item["metadata"].as_array().into_iter().flatten() {
                if row["subject"] == 0 {
                    if let Some(key) = row["key"].as_str() {
                        entries.insert(key.to_string(), row["value"].clone());
                    }
                }
            }
        }
    }
    let mut blocked = false;
    for key in [format!("default.audio.{kind}"), format!("default.configured.audio.{kind}")] {
        let Some(mut value) = entries.get(&key).cloned() else { continue };
        if let Some(text) = value.as_str() {
            value = serde_json::from_str(text).unwrap_or(serde_json::Value::Null);
        }
        let Some(name) = value["name"].as_str().filter(|n| !n.is_empty()) else { continue };
        match select(&graph, name, source) {
            Ok(endpoint) => return Ok(endpoint),
            Err(code) if code == "asr_capture_endpoint_invalid" || code == "asr_capture_feedback_endpoint" => blocked = true,
            Err(_) => continue,
        }
    }
    Err(if blocked { "realtime_default_endpoint_feedback" } else { "realtime_default_endpoint_missing" }.into())
}

pub struct HelperCapture {
    stop: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

fn pidfd_of_this_thread() -> Option<OwnedFd> {
    // PIDFD_THREAD is O_EXCL: the descriptor follows this thread, not the process.
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, libc::gettid(), libc::O_EXCL) };
    if fd < 0 {
        return None;
    }
    let fd = unsafe { OwnedFd::from_raw_fd(fd as i32) };
    // The helper inherits it.
    unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, 0) };
    Some(fd)
}

fn reap(child: &Mutex<Option<Child>>) {
    if let Some(mut child) = child.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl HelperCapture {
    pub fn open(
        helper: &Path,
        endpoint: &Endpoint,
        source: Source,
        mut on_audio: OnAudio,
        mut on_error: OnError,
    ) -> Result<HelperCapture, String> {
        if endpoint.media_class != media_class(source) || EXCLUDED.iter().any(|p| endpoint.name.starts_with(p)) {
            return Err("asr_capture_endpoint_invalid".into());
        }
        let graph = read_graph().map_err(|_| "asr_capture_endpoint_changed".to_string())?;
        if select(&graph, &endpoint.name, source).ok().as_ref() != Some(endpoint) {
            return Err("asr_capture_endpoint_changed".into());
        }
        let stop = Arc::new(AtomicBool::new(false));
        let child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let helper: PathBuf = helper.to_path_buf();
        let endpoint = endpoint.clone();
        let (flag, slot) = (stop.clone(), child.clone());
        let thread = std::thread::Builder::new()
            .name("vrct-asr-capture".into())
            .spawn(move || {
                let Some(fd) = pidfd_of_this_thread() else {
                    let _ = ready_tx.send(Err("asr_capture_failed".into()));
                    return;
                };
                let tag = format!("{:032x}", monotonic_ns() as u128 ^ (u128::from(std::process::id()) << 64));
                let spawned = Command::new(&helper)
                    .args([
                        std::process::id().to_string(),
                        fd.as_raw_fd().to_string(),
                        endpoint.cookie.to_string(),
                        endpoint.serial.to_string(),
                        endpoint.name.clone(),
                        source.as_str().to_string(),
                        tag,
                    ])
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn();
                drop(fd);
                let mut process = match spawned {
                    Ok(process) => process,
                    Err(_) => {
                        let _ = ready_tx.send(Err("asr_capture_helper_closed".into()));
                        return;
                    }
                };
                let mut stdout = process.stdout.take().expect("piped");
                let stderr = process.stderr.take().expect("piped");
                *slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(process);
                let diagnostics: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
                let heard = diagnostics.clone();
                std::thread::spawn(move || {
                    use std::io::BufRead;
                    for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
                        let line: String = line.chars().take(96).collect();
                        if let Some(code) = native_code(&line) {
                            heard.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert(code);
                        }
                    }
                });
                let raw = stdout.as_raw_fd();
                let mut decoder = Packets::default();
                let mut ready = Some(ready_tx);
                let mut last_frame: Option<Instant> = None;
                let mut buffer = [0u8; 4096];
                let failure: Option<String> = loop {
                    if flag.load(Ordering::SeqCst) {
                        break None;
                    }
                    if let Some(code) = diagnostics.lock().unwrap_or_else(|e| e.into_inner()).clone() {
                        break Some(code);
                    }
                    if last_frame.is_some_and(|t| t.elapsed() >= FRAME_TIMEOUT) {
                        break Some("asr_capture_stalled".into());
                    }
                    let mut poll = libc::pollfd { fd: raw, events: libc::POLLIN, revents: 0 };
                    if unsafe { libc::poll(&mut poll, 1, 50) } <= 0 {
                        continue;
                    }
                    let read = match stdout.read(&mut buffer) {
                        Ok(0) | Err(_) => break Some("asr_capture_helper_closed".into()),
                        Ok(read) => read,
                    };
                    let now = monotonic_ns();
                    let frames = match decoder.feed(&buffer[..read], now) {
                        Ok(frames) => frames,
                        Err(_) => break Some("asr_capture_failed".into()),
                    };
                    let mut closed = false;
                    // The frames are stamped again where they are received; they are fresh
                    // (the decoder refused anything older than 250 ms).
                    for (frame, _stamp) in frames {
                        if flag.load(Ordering::SeqCst) {
                            break;
                        }
                        last_frame = Some(Instant::now());
                        if !on_audio(&crate::pcm::samples(&frame), 48000, 1) {
                            closed = true;
                            break;
                        }
                        if let Some(ready) = ready.take() {
                            let _ = ready.send(Ok(()));
                        }
                    }
                    if closed {
                        break Some("asr_capture_consumer_closed".into());
                    }
                };
                let first = ready.take();
                if let Some(code) = failure.filter(|_| !flag.load(Ordering::SeqCst)) {
                    match first {
                        Some(ready) => {
                            let _ = ready.send(Err(code));
                        }
                        None => on_error(&code),
                    }
                }
                flag.store(true, Ordering::SeqCst);
                reap(&slot);
            })
            .map_err(|_| "asr_capture_failed".to_string())?;
        let capture = HelperCapture { stop, child, thread: Some(thread) };
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(capture),
            Ok(Err(code)) => Err(code),
            Err(_) => Err("asr_capture_start_timeout".into()),
        }
    }
}

impl Capture for HelperCapture {
    fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    fn stop(&mut self) -> bool {
        self.request_stop();
        reap(&self.child);
        match self.thread.take() {
            Some(thread) => {
                let deadline = Instant::now() + Duration::from_millis(500);
                while !thread.is_finished() && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(10));
                }
                thread.is_finished()
            }
            None => true,
        }
    }
}

impl Drop for HelperCapture {
    fn drop(&mut self) {
        self.request_stop();
        reap(&self.child);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(sequence: u32, stamp: u64, frames: u32) -> Vec<u8> {
        let mut out = b"VCA1".to_vec();
        out.extend(sequence.to_le_bytes());
        out.extend(stamp.to_le_bytes());
        out.extend(stamp.to_le_bytes());
        out.extend(48000u32.to_le_bytes());
        out.extend(frames.to_le_bytes());
        out.extend(vec![0u8; frames as usize * 2]);
        out
    }

    #[test]
    fn packets_become_20_ms_frames_and_a_gap_in_the_sequence_fails() {
        let mut packets = Packets::default();
        let now = 10_000_000_000;
        let first = packets.feed(&packet(0, now - 1000, 480), now).unwrap();
        assert!(first.is_empty());
        let frames = packets.feed(&packet(1, now - 500, 480), now).unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!((frames[0].0.len(), frames[0].1), (FRAME_BYTES, now - 1000));
        assert_eq!(packets.feed(&packet(3, now - 100, 10), now), Err("invalid_capture_packet"));
    }
}
