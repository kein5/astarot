//! One explicit microphone, or the monitor of one speaker, through a native PipeWire capture
//! stream, as 48 kHz mono s16le (decision 11 in `docs/voice-stack/core-integration.md`, and
//! realtime recognition since decision 2 of #733).
//!
//! Python captured it with the `vrct-asr-capture` helper (`PipeWireCapture` of
//! `capture_pipewire.py`); here it is a stream of the app, as the outputs are (`output.rs`). The
//! stream runs on its own thread with its own connection, targets the source's serial once the
//! graph confirmed its identity, and is never moved, reconnected or fallen back to another
//! input. A failure is told once, by the helper's codes (`asr_capture_*`): no audio within 5 s
//! of the start, a gap of 2 s after it, or the stream ending. Nothing of the audio is logged.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use pipewire as pw;
use pw::loop_::Timeout;
use pw::spa;

use crate::error::{Error, Result};
use crate::graph::{self, Endpoint};
use crate::sync::Worker;
use crate::windows_route::{Capture, CaptureCallbacks};

pub const RATE: u32 = 48000;
/// A 20 ms quantum, the part the conversion cuts the microphone into.
const LATENCY_FRAMES: u32 = 960;
/// The first audio may take this long (`asr_capture_start_timeout`).
pub const START_TIMEOUT: Duration = Duration::from_secs(5);
/// A gap this long after it ends the capture (`asr_capture_stalled`; Python's `_FRAME_TIMEOUT_NS`).
pub const STALL_TIMEOUT: Duration = Duration::from_secs(2);

pub struct PipeWireCapture {
    source: Endpoint,
    node_name: String,
    callbacks: Option<CaptureCallbacks>,
    quit: Arc<AtomicBool>,
    worker: Option<Worker>,
    /// The stream's thread ended within the stop's wait.
    released: bool,
}

impl PipeWireCapture {
    /// A capture of `source` that starts on [`Capture::start`]; `node_name` names its stream. A
    /// source of class `Audio/Sink` (a speaker) is captured from its monitor
    /// (`stream.capture.sink`, as `vrct-asr-capture` did).
    pub fn new(source: Endpoint, node_name: &str, callbacks: CaptureCallbacks) -> Self {
        Self {
            source,
            node_name: node_name.to_owned(),
            callbacks: Some(callbacks),
            quit: Arc::new(AtomicBool::new(false)),
            worker: None,
            released: true,
        }
    }
}

impl Capture for PipeWireCapture {
    fn start(&mut self) -> Result<()> {
        let callbacks = self.callbacks.take().ok_or_else(|| Error::runtime("asr_capture_single_use"))?;
        // The source must still be the node it was chosen as.
        let data = crate::pipewire::read_graph_data(true, None).map_err(|_| Error::runtime("asr_capture_endpoint_missing"))?;
        match graph::endpoint(&data, &self.source.name, &self.source.media_class) {
            Ok(found) if found == self.source => {}
            Ok(_) => return Err(Error::runtime("asr_capture_endpoint_changed")),
            Err(_) => return Err(Error::runtime("asr_capture_endpoint_missing")),
        }
        let (ready, started) = mpsc::channel();
        let (quit, target, node_name) = (self.quit.clone(), self.source.serial.to_string(), self.node_name.clone());
        let monitor = self.source.media_class == "Audio/Sink";
        let worker = Worker::spawn("vrct-pipewire-capture", move || run(&quit, &target, monitor, &node_name, callbacks, &ready))
            .map_err(|_| Error::runtime("asr_capture_stream_create_failed"))?;
        match started.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(())) => {
                self.worker = Some(worker);
                Ok(())
            }
            Ok(Err(error)) => {
                worker.join(Duration::from_millis(500));
                Err(error)
            }
            Err(_) => {
                self.quit.store(true, Ordering::SeqCst);
                worker.join(Duration::from_millis(500));
                Err(Error::runtime("asr_capture_stream_create_failed"))
            }
        }
    }

    fn request_stop(&self) {
        self.quit.store(true, Ordering::SeqCst);
    }

    fn stop(&mut self) {
        self.request_stop();
        if let Some(worker) = self.worker.take() {
            self.released = worker.join(Duration::from_millis(500));
        }
    }

    fn released(&self) -> bool {
        self.released
    }
}

impl Drop for PipeWireCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

/// What the stream's callbacks saw, on the stream's own thread.
#[derive(Default)]
struct Seen {
    heard: Option<Instant>,
    connected: bool,
    ended: bool,
    /// `on_audio` asked to stop.
    refused: bool,
}

fn run(quit: &AtomicBool, target: &str, monitor: bool, node_name: &str, callbacks: CaptureCallbacks, ready: &mpsc::Sender<Result<()>>) {
    let callbacks = Rc::new(RefCell::new(callbacks));
    let mut told = false;
    let result = stream(quit, target, monitor, node_name, &callbacks, ready, &mut told);
    if let Err(error) = result {
        if told {
            (callbacks.borrow_mut().on_error)(&error.code);
        } else {
            let _ = ready.send(Err(error));
        }
    }
}

/// Runs the stream until it is stopped or fails; `told` is set once the start was answered.
fn stream(
    quit: &AtomicBool,
    target: &str,
    monitor: bool,
    node_name: &str,
    callbacks: &Rc<RefCell<CaptureCallbacks>>,
    ready: &mpsc::Sender<Result<()>>,
    told: &mut bool,
) -> Result<()> {
    let unavailable = |_| Error::runtime("asr_capture_stream_create_failed");
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None).map_err(unavailable)?;
    let context = pw::context::ContextRc::new(&mainloop, None).map_err(unavailable)?;
    let core = context.connect_rc(None).map_err(unavailable)?;
    let mut properties = pw::properties::properties! {
        *pw::keys::MEDIA_TYPE => "Audio",
        *pw::keys::MEDIA_CATEGORY => "Capture",
        *pw::keys::NODE_NAME => node_name,
        "target.object" => target,
        *pw::keys::NODE_LATENCY => format!("{LATENCY_FRAMES}/{RATE}"),
        "node.dont-fallback" => "true",
        "node.dont-reconnect" => "true",
        "node.dont-move" => "true",
    };
    if monitor {
        properties.insert(*pw::keys::STREAM_CAPTURE_SINK, "true");
    }
    let stream = pw::stream::StreamRc::new(core, node_name, properties).map_err(unavailable)?;
    let seen = Rc::new(RefCell::new(Seen::default()));
    let (heard, changed, delivering) = (seen.clone(), seen.clone(), callbacks.clone());
    let _listener = stream
        .add_local_listener_with_user_data(())
        .process(move |stream, _| {
            let Some(mut buffer) = stream.dequeue_buffer() else { return };
            let Some(data) = buffer.datas_mut().first_mut() else { return };
            let (offset, size) = (data.chunk().offset() as usize, data.chunk().size() as usize);
            let Some(slice) = data.data() else { return };
            let end = offset.saturating_add(size).min(slice.len());
            let bytes = &slice[offset.min(end)..end];
            // Whole samples only.
            let bytes = &bytes[..bytes.len() / 2 * 2];
            heard.borrow_mut().heard = Some(Instant::now());
            if !bytes.is_empty() && !(delivering.borrow_mut().on_audio)(bytes) {
                heard.borrow_mut().refused = true;
            }
        })
        .state_changed(move |_, _, _, new| {
            let mut seen = changed.borrow_mut();
            match new {
                pw::stream::StreamState::Streaming | pw::stream::StreamState::Paused => seen.connected = true,
                pw::stream::StreamState::Error(_) => seen.ended = true,
                pw::stream::StreamState::Unconnected => seen.ended |= seen.connected,
                pw::stream::StreamState::Connecting => {}
            }
        })
        .register()
        .map_err(unavailable)?;

    let mut info = spa::param::audio::AudioInfoRaw::new();
    info.set_format(spa::param::audio::AudioFormat::S16LE);
    info.set_rate(RATE);
    info.set_channels(1);
    let mut position = [0; spa::param::audio::MAX_CHANNELS];
    position[0] = spa::sys::SPA_AUDIO_CHANNEL_MONO;
    info.set_position(position);
    let bytes = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(spa::pod::Object { type_: spa::sys::SPA_TYPE_OBJECT_Format, id: spa::sys::SPA_PARAM_EnumFormat, properties: info.into() }),
    )
    .map_err(|_| Error::runtime("asr_capture_format_invalid"))?
    .0
    .into_inner();
    let mut params = [spa::pod::Pod::from_bytes(&bytes).ok_or_else(|| Error::runtime("asr_capture_format_invalid"))?];
    stream
        .connect(spa::utils::Direction::Input, None, pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS, &mut params)
        .map_err(|_| Error::runtime("asr_capture_stream_connect_failed"))?;
    let _ = ready.send(Ok(()));
    *told = true;

    let opened = Instant::now();
    let result = loop {
        if quit.load(Ordering::SeqCst) {
            break Ok(());
        }
        {
            let seen = seen.borrow();
            if seen.refused {
                break Ok(());
            }
            if seen.ended {
                break Err(Error::runtime("asr_capture_stream_disconnected"));
            }
            match seen.heard {
                None if opened.elapsed() >= START_TIMEOUT => break Err(Error::runtime("asr_capture_start_timeout")),
                Some(heard) if heard.elapsed() >= STALL_TIMEOUT => break Err(Error::runtime("asr_capture_stalled")),
                _ => {}
            }
        }
        if mainloop.loop_().iterate(Timeout::Finite(Duration::from_millis(10))) < 0 {
            break Err(Error::runtime("asr_capture_core_error"));
        }
    };
    let _ = stream.disconnect();
    result
}
