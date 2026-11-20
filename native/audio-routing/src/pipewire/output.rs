//! Raw PCM to one explicit sink through a native PipeWire playback stream.
//!
//! Port of `PipeWireOutput` in `src-python/models/audio_routing/devices_pipewire.py`,
//! which ran `pw-cat`. The stream runs on its own thread with its own connection. It
//! is never moved, never reconnected and never falls back to another sink, so a lost
//! target ends playback with `output_disconnected` instead of playing elsewhere.
//! Writes go to a bounded buffer of about 85 ms, the size of the pipe to `pw-cat`.

use std::collections::VecDeque;
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use pipewire as pw;
use pw::loop_::Timeout;
use pw::spa;

use crate::error::{Error, Result};
use crate::graph;
use crate::router::{Output, PlaybackToken};
use crate::sync::{lock, monotonic, Worker};

/// How long one write may wait for room before the sink counts as stalled.
const WRITE_DEADLINE: f64 = 2.0;
/// How long a drain may take.
const DRAIN_DEADLINE: f64 = 2.0;
const BUFFER_MS: usize = 85;
const LATENCY_MS: u32 = 20;

#[derive(Default)]
struct Shared {
    buffer: VecDeque<u8>,
    capacity: usize,
    stride: usize,
    /// Frames per cycle when the stream does not say how many it wants.
    quantum: usize,
    disconnected: bool,
    failed: bool,
    connected: bool,
    drain: bool,
    flushed: bool,
    drained: bool,
    quit: bool,
}

struct State {
    shared: Mutex<Shared>,
    changed: Condvar,
}

pub struct PipeWireOutput {
    state: Arc<State>,
    worker: Option<Worker>,
}

/// Every sink, for the output menu.
pub fn enumerate_outputs() -> Result<Vec<graph::OutputOption>> {
    let data = crate::pipewire::read_graph_data(true, None).map_err(|_| Error::speech("pipewire_unavailable"))?;
    graph::enumerate_outputs(&data)
}

/// The session's default sink. For the monitor only.
pub fn default_output() -> Result<String> {
    let data = crate::pipewire::read_graph_data(true, None).map_err(|_| Error::speech("pipewire_unavailable"))?;
    graph::default_output(&data)
}

impl PipeWireOutput {
    /// Play to the sink named `device`. With `expected_identity` (cookie, serial), the
    /// sink must still be that object, and the stream targets its serial.
    pub fn open(device: &str, rate: u32, channels: u16, expected_identity: Option<(u32, u64)>, node_name: &str) -> Result<Self> {
        let target = match expected_identity {
            None => {
                if !enumerate_outputs()?.iter().any(|output| output.id == device) {
                    return Err(Error::speech("output_missing"));
                }
                device.to_owned()
            }
            Some(expected) => {
                let data = crate::pipewire::read_graph_data(true, None).map_err(|_| Error::runtime("source_bridge_graph_unavailable"))?;
                let endpoint = graph::endpoint(&data, device, "Audio/Sink")?;
                if (endpoint.cookie, endpoint.serial) != expected {
                    return Err(Error::speech("output_identity_changed"));
                }
                endpoint.serial.to_string()
            }
        };
        Self::connect(&target, rate, channels, node_name)
    }

    /// Play to `target` (a node name or serial) without looking it up first.
    pub fn connect(target: &str, rate: u32, channels: u16, node_name: &str) -> Result<Self> {
        if rate == 0 || channels == 0 {
            return Err(Error::speech("output_format_invalid"));
        }
        let stride = 2 * channels as usize;
        let per_second = rate as usize * stride;
        let capacity = (per_second * BUFFER_MS / 1000).max(4096) / stride * stride;
        let quantum = (rate * LATENCY_MS / 1000).max(1) as usize;
        let state = Arc::new(State { shared: Mutex::new(Shared { capacity, stride, quantum, ..Shared::default() }), changed: Condvar::new() });
        let (ready, started) = mpsc::channel();
        let (thread_state, target, node_name) = (state.clone(), target.to_owned(), node_name.to_owned());
        let worker = Worker::spawn("astarot-pipewire-output", move || {
            if let Err(error) = run(&thread_state, &target, rate, channels, &node_name, &ready) {
                let _ = ready.send(Err(error));
            }
            let mut shared = lock(&thread_state.shared);
            shared.disconnected = true;
            thread_state.changed.notify_all();
        })
        .map_err(|_| Error::speech("output_unavailable"))?;
        match started.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(())) => Ok(Self { state, worker: Some(worker) }),
            Ok(Err(error)) => Err(error),
            Err(_) => {
                lock(&state.shared).quit = true;
                Err(Error::speech("output_unavailable"))
            }
        }
    }

    fn stop(&mut self) {
        lock(&self.state.shared).quit = true;
        self.state.changed.notify_all();
        if let Some(worker) = self.worker.take() {
            worker.join(Duration::from_millis(500));
        }
    }
}

fn run(state: &Arc<State>, target: &str, rate: u32, channels: u16, node_name: &str, ready: &mpsc::Sender<Result<()>>) -> Result<()> {
    let unavailable = |_| Error::speech("pipewire_unavailable");
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None).map_err(unavailable)?;
    let context = pw::context::ContextRc::new(&mainloop, None).map_err(unavailable)?;
    let core = context.connect_rc(None).map_err(unavailable)?;
    let quantum = (rate * LATENCY_MS / 1000).max(1);
    let properties = pw::properties::properties! {
        *pw::keys::MEDIA_TYPE => "Audio",
        *pw::keys::MEDIA_CATEGORY => "Playback",
        *pw::keys::NODE_NAME => node_name,
        "target.object" => target,
        *pw::keys::NODE_LATENCY => format!("{quantum}/{rate}"),
        "node.dont-fallback" => "true",
        "node.dont-reconnect" => "true",
        "node.dont-move" => "true",
    };
    let stream = pw::stream::StreamRc::new(core, node_name, properties).map_err(unavailable)?;
    let (process_state, change_state, drain_state) = (state.clone(), state.clone(), state.clone());
    let _listener = stream
        .add_local_listener_with_user_data(())
        .process(move |stream, _| fill(stream, &process_state))
        .state_changed(move |_, _, _, new| {
            let mut shared = lock(&change_state.shared);
            match new {
                pw::stream::StreamState::Streaming | pw::stream::StreamState::Paused => shared.connected = true,
                pw::stream::StreamState::Error(_) => {
                    shared.failed = true;
                    shared.disconnected = true;
                }
                pw::stream::StreamState::Unconnected => shared.disconnected = true,
                pw::stream::StreamState::Connecting => {}
            }
            change_state.changed.notify_all();
        })
        .drained(move |_, _| {
            lock(&drain_state.shared).drained = true;
            drain_state.changed.notify_all();
        })
        .register()
        .map_err(unavailable)?;

    let mut info = spa::param::audio::AudioInfoRaw::new();
    info.set_format(spa::param::audio::AudioFormat::S16LE);
    info.set_rate(rate);
    info.set_channels(u32::from(channels));
    if channels == 1 {
        let mut position = [0; spa::param::audio::MAX_CHANNELS];
        position[0] = spa::sys::SPA_AUDIO_CHANNEL_MONO;
        info.set_position(position);
    }
    let bytes = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(spa::pod::Object { type_: spa::sys::SPA_TYPE_OBJECT_Format, id: spa::sys::SPA_PARAM_EnumFormat, properties: info.into() }),
    )
    .map_err(|_| Error::speech("output_format_invalid"))?
    .0
    .into_inner();
    let mut params = [spa::pod::Pod::from_bytes(&bytes).ok_or_else(|| Error::speech("output_format_invalid"))?];
    stream.connect(spa::utils::Direction::Output, None, pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS, &mut params).map_err(|_| Error::speech("output_missing"))?;
    let _ = ready.send(Ok(()));

    loop {
        {
            let mut shared = lock(&state.shared);
            if shared.quit {
                break;
            }
            if shared.drain && shared.buffer.is_empty() && !shared.flushed {
                shared.flushed = true;
                drop(shared);
                if stream.flush(true).is_err() {
                    lock(&state.shared).drained = true;
                }
            }
        }
        if mainloop.loop_().iterate(Timeout::Finite(Duration::from_millis(10))) < 0 {
            break;
        }
    }
    let _ = stream.disconnect();
    Ok(())
}

fn fill(stream: &pw::stream::Stream, state: &State) {
    let Some(mut buffer) = stream.dequeue_buffer() else { return };
    // Give the graph what this cycle asks for; a full buffer would play faster than time.
    let requested = buffer.requested() as usize;
    let datas = buffer.datas_mut();
    let Some(data) = datas.first_mut() else { return };
    let mut shared = lock(&state.shared);
    let stride = shared.stride;
    let written = match data.data() {
        Some(slice) => {
            let frames = if requested > 0 { requested } else { shared.quantum };
            let room = (slice.len() / stride).min(frames) * stride;
            let take = shared.buffer.len().min(room) / stride * stride;
            for (out, byte) in slice.iter_mut().zip(shared.buffer.drain(..take)) {
                *out = byte;
            }
            if take > 0 || shared.drain {
                // Nothing left while draining: an empty buffer lets the stream drain.
                take
            } else {
                // Starved: silence keeps the stream's clock running.
                slice[..room].fill(0);
                room
            }
        }
        None => 0,
    };
    state.changed.notify_all();
    drop(shared);
    let chunk = data.chunk_mut();
    *chunk.offset_mut() = 0;
    *chunk.stride_mut() = stride as i32;
    *chunk.size_mut() = written as u32;
}

impl Output for PipeWireOutput {
    fn write(&mut self, pcm: &[u8], token: &dyn PlaybackToken) -> Result<()> {
        let deadline = monotonic() + WRITE_DEADLINE;
        let mut pending = pcm;
        while !pending.is_empty() {
            token.check()?;
            let mut shared = lock(&self.state.shared);
            if shared.disconnected {
                return Err(Error::speech("output_disconnected"));
            }
            if monotonic() > deadline {
                return Err(Error::speech("output_stalled"));
            }
            let room = shared.capacity.saturating_sub(shared.buffer.len());
            if room == 0 {
                drop(self.state.changed.wait_timeout(shared, Duration::from_millis(20)).unwrap_or_else(|e| e.into_inner()));
                continue;
            }
            let count = room.min(pending.len());
            let buffer = &mut shared.buffer;
            let mut push = || {
                buffer.extend(&pending[..count]);
                Ok(count)
            };
            let written = token.commit_audio_write(pending, &mut push)?.map_err(|_| Error::speech("output_disconnected"))?;
            pending = &pending[written..];
        }
        Ok(())
    }

    fn close(&mut self, drain: bool, token: &dyn PlaybackToken) -> Result<()> {
        let result = (|| {
            if !drain {
                return Ok(());
            }
            {
                let mut shared = lock(&self.state.shared);
                shared.drain = true;
            }
            self.state.changed.notify_all();
            let deadline = monotonic() + DRAIN_DEADLINE;
            loop {
                if token.is_set() {
                    return Ok(());
                }
                let shared = lock(&self.state.shared);
                if shared.drained {
                    return Ok(());
                }
                if shared.failed || shared.disconnected {
                    return Err(Error::speech("output_failed"));
                }
                if monotonic() >= deadline {
                    return Err(Error::speech("output_drain_timeout"));
                }
                drop(self.state.changed.wait_timeout(shared, Duration::from_millis(10)).unwrap_or_else(|e| e.into_inner()));
            }
        })();
        self.stop();
        result
    }
}

impl Drop for PipeWireOutput {
    fn drop(&mut self) {
        self.stop();
    }
}
