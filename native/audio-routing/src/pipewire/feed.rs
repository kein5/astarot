//! Forward graph observations to the isolated voice conversion process.
//!
//! Port of [`src-python/models/audio_routing/pipewire_graph_pipe.py`]. The parent sends
//! each new observation through a pipe as one frame: a header of sequence (u64),
//! capture time (f64) and length (u32), big-endian, then the JSON of the Core
//! objects and the nodes the child cares about (duplicates included, so the child's
//! checks still see ambiguity). An empty body means "unavailable". The child accepts
//! a frame only while it is younger than one second; it never runs a dump itself.
//!
//! [`src-python/models/audio_routing/pipewire_graph_pipe.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/pipewire_graph_pipe.py

use std::collections::BTreeSet;
use std::io::{ErrorKind, Read, Write};
use std::os::fd::{AsRawFd, OwnedFd};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde_json::Value;

use crate::graph::{kind, node_name, Graph, CORE, NODE};
use crate::graph_source::{GraphSource, GraphUnavailable, Observation, INTERVAL, MAX_AGE, MAX_BYTES};
use crate::sync::{lock, monotonic, Event, Worker};

pub const HEADER: usize = 20;
/// The variable that tells the child which descriptor to read.
pub const ENV: &str = "VRCT_PIPEWIRE_GRAPH_FD";

pub fn encode(sequence: u64, captured: f64, body: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(HEADER + body.len());
    frame.extend(sequence.to_be_bytes());
    frame.extend(captured.to_be_bytes());
    frame.extend((body.len() as u32).to_be_bytes());
    frame.extend(body);
    frame
}

pub fn decode_header(header: &[u8; HEADER]) -> (u64, f64, u32) {
    let sequence = u64::from_be_bytes(header[..8].try_into().unwrap_or_default());
    let captured = f64::from_be_bytes(header[8..16].try_into().unwrap_or_default());
    let size = u32::from_be_bytes(header[16..].try_into().unwrap_or_default());
    (sequence, captured, size)
}

/// The Core objects and the named nodes, in graph order.
pub fn filter(graph: &[Value], names: &BTreeSet<String>) -> Graph {
    graph.iter().filter(|item| kind(item) == Some(CORE) || (kind(item) == Some(NODE) && node_name(item).is_some_and(|name| names.contains(name)))).cloned().collect()
}

fn poll(fd: &OwnedFd, events: i16, timeout_ms: i32) -> bool {
    let mut entry = libc::pollfd { fd: fd.as_raw_fd(), events, revents: 0 };
    unsafe { libc::poll(&mut entry, 1, timeout_ms) > 0 }
}

fn set_nonblocking(fd: &OwnedFd) {
    unsafe {
        let flags = libc::fcntl(fd.as_raw_fd(), libc::F_GETFL);
        libc::fcntl(fd.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK);
    }
}

/// The parent's side.
pub struct GraphFeed {
    stop: Arc<Event>,
    worker: Worker,
}

impl GraphFeed {
    /// Feed `writer` (the write end of a pipe) from `source`.
    pub fn start(source: Arc<GraphSource>, names: BTreeSet<String>, writer: OwnedFd) -> Result<Self, GraphUnavailable> {
        let wake = Arc::new(Event::new());
        let user = source.subscribe(Some(wake.clone()))?;
        set_nonblocking(&writer);
        let stop = Arc::new(Event::new());
        let halt = stop.clone();
        let worker = Worker::spawn("astarot-graph-feed", move || {
            let _user = user;
            let mut file = std::fs::File::from(writer);
            let _ = source.read(true, None);
            let mut last: Option<u64> = None;
            let mut body = Vec::new();
            while !halt.is_set() {
                wake.clear();
                let value = match source.read(false, None) {
                    Ok(value) => {
                        if last != Some(value.sequence) {
                            body = serde_json::to_vec(&filter(value.data.as_deref().map(Vec::as_slice).unwrap_or_default(), &names)).unwrap_or_default();
                            last = Some(value.sequence);
                        }
                        value
                    }
                    Err(_) => {
                        body.clear();
                        last = None;
                        source.observation()
                    }
                };
                let frame = encode(value.sequence, value.captured, &body);
                let mut pending = frame.as_slice();
                // Finish this frame under backpressure, then take the latest one;
                // only the receiver decides whether it is fresh.
                while !pending.is_empty() && !halt.is_set() {
                    let fd = unsafe { std::os::fd::BorrowedFd::borrow_raw(file.as_raw_fd()) };
                    let ready = {
                        let mut entry = libc::pollfd { fd: fd.as_raw_fd(), events: libc::POLLOUT, revents: 0 };
                        unsafe { libc::poll(&mut entry, 1, 20) > 0 }
                    };
                    if !ready {
                        continue;
                    }
                    match file.write(pending) {
                        Ok(n) => pending = &pending[n..],
                        Err(error) if error.kind() == ErrorKind::WouldBlock => continue,
                        Err(_) => return,
                    }
                }
                wake.wait(Duration::from_secs_f64(INTERVAL));
            }
        })
        .map_err(|_| GraphUnavailable)?;
        Ok(Self { stop, worker })
    }

    pub fn close(&self) -> bool {
        self.stop.set();
        self.worker.join(Duration::from_secs_f64(MAX_AGE + INTERVAL + 0.1))
    }
}

impl Drop for GraphFeed {
    fn drop(&mut self) {
        self.close();
    }
}

struct RemoteState {
    observation: Observation,
    alive: bool,
}

/// The child's side: observations received from the parent.
pub struct RemoteGraph {
    state: Arc<(Mutex<RemoteState>, Condvar)>,
    stop: Arc<AtomicBool>,
    worker: Option<Worker>,
}

fn read_exact(fd: &OwnedFd, file: &mut std::fs::File, size: usize, stop: &AtomicBool) -> Result<Vec<u8>, GraphUnavailable> {
    let mut result = vec![0; size];
    let mut filled = 0;
    let deadline = monotonic() + MAX_AGE;
    while filled < size {
        if stop.load(Ordering::SeqCst) || monotonic() >= deadline {
            return Err(GraphUnavailable);
        }
        if !poll(fd, libc::POLLIN, 20) {
            continue;
        }
        match file.read(&mut result[filled..]) {
            Ok(0) => return Err(GraphUnavailable),
            Ok(n) => filled += n,
            Err(error) if error.kind() == ErrorKind::WouldBlock => continue,
            Err(_) => return Err(GraphUnavailable),
        }
    }
    Ok(result)
}

impl RemoteGraph {
    /// Start draining `reader` (the read end) at once, before any request arrives.
    pub fn start(reader: OwnedFd) -> Result<Self, GraphUnavailable> {
        set_nonblocking(&reader);
        let state = Arc::new((Mutex::new(RemoteState { observation: Observation { sequence: 0, captured: 0.0, data: None }, alive: true }), Condvar::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (shared, halt) = (state.clone(), stop.clone());
        let worker = Worker::spawn("astarot-graph-receiver", move || {
            let mut file = std::fs::File::from(reader.try_clone().expect("descriptor"));
            let mut previous = 0u64;
            let result = (|| -> Result<(), GraphUnavailable> {
                loop {
                    let header: [u8; HEADER] = read_exact(&reader, &mut file, HEADER, &halt)?.try_into().map_err(|_| GraphUnavailable)?;
                    let (sequence, captured, size) = decode_header(&header);
                    if sequence < previous || size as usize > MAX_BYTES {
                        return Err(GraphUnavailable);
                    }
                    previous = sequence;
                    let wire = read_exact(&reader, &mut file, size as usize, &halt)?;
                    if !(0.0..MAX_AGE).contains(&(monotonic() - captured)) {
                        continue;
                    }
                    let data = if wire.is_empty() {
                        None
                    } else {
                        let value: Value = serde_json::from_slice(&wire).map_err(|_| GraphUnavailable)?;
                        match value {
                            Value::Array(items) if items.iter().all(Value::is_object) => Some(Arc::new(items)),
                            _ => return Err(GraphUnavailable),
                        }
                    };
                    let mut current = lock(&shared.0);
                    if (0.0..MAX_AGE).contains(&(monotonic() - captured)) {
                        current.observation = Observation { sequence, captured, data };
                        shared.1.notify_all();
                    }
                }
            })();
            let _ = result;
            let mut current = lock(&shared.0);
            current.alive = false;
            current.observation = Observation { sequence: current.observation.sequence + 1, captured: monotonic(), data: None };
            shared.1.notify_all();
        })
        .map_err(|_| GraphUnavailable)?;
        Ok(Self { state, stop, worker: Some(worker) })
    }

    /// The current observation, waiting up to a second for the first one; with
    /// `after`, one captured at or after that time.
    pub fn read(&self, wait: bool, after: Option<f64>) -> Result<Observation, GraphUnavailable> {
        let deadline = monotonic() + MAX_AGE;
        let mut state = lock(&self.state.0);
        loop {
            let value = &state.observation;
            let fresh = state.alive && value.data.is_some() && (0.0..MAX_AGE).contains(&(monotonic() - value.captured));
            if fresh && after.is_none_or(|after| value.captured >= after) {
                return Ok(value.clone());
            }
            if !fresh && (value.data.is_some() || value.captured > 0.0) {
                return Err(GraphUnavailable);
            }
            let remaining = deadline - monotonic();
            if !wait || !state.alive || remaining <= 0.0 {
                return Err(GraphUnavailable);
            }
            state = self.state.1.wait_timeout(state, Duration::from_secs_f64(remaining.min(0.05))).unwrap_or_else(|e| e.into_inner()).0;
        }
    }

    pub fn close(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            worker.join(Duration::from_secs_f64(MAX_AGE + INTERVAL));
        }
    }
}

impl Drop for RemoteGraph {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use std::os::fd::FromRawFd;

    use serde_json::json;

    use super::*;
    use crate::graph_source::Snapshotter;

    fn pipe() -> (OwnedFd, OwnedFd) {
        let mut fds = [0; 2];
        assert_eq!(unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) }, 0);
        unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) }
    }

    struct Fixed;
    impl Snapshotter for Fixed {
        fn snapshot(&mut self, _: f64, _: &Event) -> Result<Graph, GraphUnavailable> {
            let node = |name: &str| json!({"type": NODE, "info": {"props": {"node.name": name}}});
            Ok(vec![json!({"type": CORE, "info": {"cookie": 42}}), node("vrct.managed.vc"), node("vrct.managed.vc"), node("alsa.out")])
        }
    }

    #[test]
    fn child_reads_the_parents_observation_with_its_sequence_and_capture_time() {
        let source = GraphSource::new(Arc::new(|| Ok(Box::new(Fixed) as Box<dyn Snapshotter>)));
        let (reader, writer) = pipe();
        let names = BTreeSet::from(["vrct.managed.vc".to_owned()]);
        let feed = GraphFeed::start(source.clone(), names, writer).unwrap();
        let remote = RemoteGraph::start(reader).unwrap();
        let received = remote.read(true, None).unwrap();
        let data = received.data.clone().unwrap();
        // Duplicates stay: the child's own checks must see the ambiguity.
        assert_eq!(data.len(), 3);
        assert!(data.iter().all(|item| node_name(item) != Some("alsa.out")));
        let local = source.observation();
        assert!(received.sequence <= local.sequence && received.captured <= local.captured);
        let barrier = monotonic();
        assert!(remote.read(true, Some(barrier)).unwrap().captured >= barrier);
        assert!(feed.close());
    }

    #[test]
    fn stale_or_malformed_frames_are_refused() {
        let (reader, writer) = pipe();
        let mut file = std::fs::File::from(writer);
        file.write_all(&encode(1, monotonic() - 5.0, b"[]")).unwrap();
        let remote = RemoteGraph::start(reader).unwrap();
        assert!(remote.read(false, None).is_err());
        file.write_all(&encode(2, monotonic(), b"[{\"type\": \"PipeWire:Interface:Core\"}]")).unwrap();
        assert!(remote.read(true, None).is_ok());
        file.write_all(&encode(1, monotonic(), b"[]")).unwrap();
        let deadline = monotonic() + 2.0;
        while remote.read(false, None).is_ok() && monotonic() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(remote.read(false, None).is_err(), "a sequence going back ends the feed");
    }

    #[test]
    fn header_round_trips() {
        let frame = encode(7, 1.5, b"xy");
        let header: [u8; HEADER] = frame[..HEADER].try_into().unwrap();
        assert_eq!(decode_header(&header), (7, 1.5, 2));
        assert_eq!(&frame[HEADER..], b"xy");
    }
}
