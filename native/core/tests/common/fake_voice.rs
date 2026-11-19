//! Speech outputs, microphones, the managed route's gate and the RVC worker's downloads in
//! memory, in place of the PC's: nothing touches a real device or the network. The RVC
//! worker is the small `fake-rvc-worker` program of this package.

use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use vrct_audio_routing::graph::{Endpoint, GateState, Source, SourceId};
use vrct_audio_routing::managed_vc::ManagedVcDevices;
use vrct_audio_routing::monitor::MonitorFactory;
use vrct_audio_routing::router::{Output, PlaybackToken};
use vrct_audio_routing::voice_route::{Gate, GatePair};
use vrct_audio_routing::windows_route::{Capture, CaptureCallbacks, RouteDevices};
use vrct_audio_routing::{Error, Result};
use vrct_core::controller::voice::VoicePlatform;
use vrct_ops::downloads::transport::{Body, Transport};
use vrct_voice_conversion::runtime::{Runtime, Target};
use vrct_voice_conversion::{DirectBackend, Health};

/// What one output received: the device, its format and the bytes written.
#[derive(Clone, Debug, Default)]
pub struct Played {
    pub device: String,
    pub rate: u32,
    pub channels: u16,
    pub bytes: Vec<u8>,
    pub closed: bool,
}

#[derive(Default)]
struct Inner {
    sources: Mutex<Option<Vec<Source>>>,
    default_mic: Mutex<Option<String>>,
    outputs: Mutex<Vec<String>>,
    played: Mutex<Vec<Arc<Mutex<Played>>>>,
    output_fails: AtomicBool,
    gate: Arc<FakeGate>,
    worker: Mutex<PathBuf>,
    files: Mutex<HashMap<String, Vec<u8>>>,
    fetched: Mutex<Vec<String>>,
    nvidia: AtomicBool,
    no_target: AtomicBool,
    passthrough: Mutex<Vec<Option<String>>>,
    captures: Mutex<usize>,
    entries: Mutex<Option<Vec<Runtime>>>,
    /// No capture for a conversion on the managed route (a Linux build without PipeWire).
    no_managed_vc: AtomicBool,
    /// The monitor's device does not open.
    monitor_fails: AtomicBool,
    /// A capture fails to start with this code.
    capture_fails: Mutex<Option<String>>,
}

/// The fake; clone it to keep a handle after giving it to [`super::Setup`].
#[derive(Clone, Default)]
pub struct FakeVoice(Arc<Inner>);

impl FakeVoice {
    pub fn new() -> Self {
        let fake = Self::default();
        *fake.0.worker.lock().unwrap() = PathBuf::from(env!("CARGO_BIN_EXE_fake-rvc-worker"));
        fake
    }

    pub fn platform(&self) -> Arc<dyn VoicePlatform> {
        Arc::new(self.clone())
    }

    /// Microphones as WASAPI lists them (`None`: the list cannot be read).
    pub fn set_sources(&self, names: Option<&[&str]>) {
        *self.0.sources.lock().unwrap() = names.map(|names| names.iter().map(|name| source(name)).collect());
    }

    pub fn set_default_mic(&self, name: Option<&str>) {
        *self.0.default_mic.lock().unwrap() = name.map(wasapi);
    }

    /// The outputs the device route sees.
    pub fn set_outputs(&self, outputs: &[&str]) {
        *self.0.outputs.lock().unwrap() = outputs.iter().map(|s| s.to_string()).collect();
    }

    pub fn fail_outputs(&self, fail: bool) {
        self.0.output_fails.store(fail, Ordering::SeqCst);
    }

    pub fn played(&self) -> Vec<Played> {
        self.0.played.lock().unwrap().iter().map(|p| p.lock().unwrap().clone()).collect()
    }

    pub fn gate(&self) -> Arc<FakeGate> {
        self.0.gate.clone()
    }

    /// A file the runtime setup can fetch.
    pub fn serve(&self, url: &str, data: Vec<u8>) {
        self.0.files.lock().unwrap().insert(url.to_owned(), data);
    }

    pub fn fetched(&self) -> Vec<String> {
        self.0.fetched.lock().unwrap().clone()
    }

    pub fn set_nvidia(&self, present: bool) {
        self.0.nvidia.store(present, Ordering::SeqCst);
    }

    /// What the runtime setup offers, in place of the pinned runtime (before the start).
    pub fn set_runtime(&self, runtime: Runtime) {
        *self.0.entries.lock().unwrap() = Some(vec![runtime]);
    }

    pub fn passthrough_starts(&self) -> Vec<Option<String>> {
        self.0.passthrough.lock().unwrap().clone()
    }

    /// Captures fail to start with `code` (`None`: they start).
    pub fn fail_capture(&self, code: Option<&str>) {
        *self.0.capture_fails.lock().unwrap() = code.map(str::to_owned);
    }

    pub fn fail_monitor(&self, fail: bool) {
        self.0.monitor_fails.store(fail, Ordering::SeqCst);
    }

    pub fn set_managed_vc(&self, available: bool) {
        self.0.no_managed_vc.store(!available, Ordering::SeqCst);
    }

    pub fn captures(&self) -> usize {
        *self.0.captures.lock().unwrap()
    }
}

/// A WASAPI identity.
pub fn wasapi(name: &str) -> String {
    format!("Windows WASAPI: {name}")
}

/// A microphone as WASAPI lists it: its identity is the endpoint's name.
pub fn source(name: &str) -> Source {
    let identity = wasapi(name);
    let endpoint = Endpoint { cookie: vrct_audio_routing::naming::crc32(identity.as_bytes()), serial: 0, name: identity, media_class: "Audio/Source".into() };
    Source { id: SourceId::from(&endpoint), label: name.into() }
}

struct Recorder {
    played: Arc<Mutex<Played>>,
}

impl Output for Recorder {
    fn write(&mut self, pcm: &[u8], token: &dyn PlaybackToken) -> Result<()> {
        token.check()?;
        self.played.lock().unwrap().bytes.extend_from_slice(pcm);
        // At about the pace of a device, so that a stop can come while speech plays.
        std::thread::sleep(Duration::from_millis(1));
        Ok(())
    }
    fn close(&mut self, _: bool, _: &dyn PlaybackToken) -> Result<()> {
        self.played.lock().unwrap().closed = true;
        Ok(())
    }
}

impl FakeVoice {
    fn open(&self, device: &str, rate: u32, channels: u16) -> Result<Box<dyn Output>> {
        if self.0.output_fails.load(Ordering::SeqCst) {
            return Err(Error::speech("output_missing"));
        }
        let played = Arc::new(Mutex::new(Played { device: device.into(), rate, channels, ..Played::default() }));
        self.0.played.lock().unwrap().push(played.clone());
        Ok(Box::new(Recorder { played }))
    }
}

/// The managed route's OS gate in memory.
#[derive(Default)]
pub struct FakeGate {
    pub source_muted: Mutex<bool>,
    pub direct_muted: Mutex<bool>,
    pub fail: AtomicBool,
}

impl FakeGate {
    fn check(&self) -> Result<()> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(Error::runtime("managed_endpoint_missing_or_invalid"));
        }
        Ok(())
    }
    fn pair(&self) -> GatePair {
        GatePair { source: GateState { identity: (1, 1), muted: *self.source_muted.lock().unwrap() }, direct: GateState { identity: (1, 2), muted: *self.direct_muted.lock().unwrap() } }
    }
}

impl Gate for FakeGate {
    fn inspect_pair(&self) -> Result<GatePair> {
        self.check()?;
        Ok(self.pair())
    }
    fn set_muted(&self, muted: bool, _: (u64, u64)) -> Result<GateState> {
        self.check()?;
        *self.source_muted.lock().unwrap() = muted;
        Ok(self.pair().source)
    }
    fn set_direct_muted(&self, muted: bool, _: (u64, u64)) -> Result<GateState> {
        self.check()?;
        *self.direct_muted.lock().unwrap() = muted;
        Ok(self.pair().direct)
    }
    fn resume(&self, _: (u64, u64), _: (u64, u64), suppress_direct: bool) -> Result<GatePair> {
        self.check()?;
        *self.source_muted.lock().unwrap() = false;
        *self.direct_muted.lock().unwrap() = suppress_direct;
        Ok(self.pair())
    }
}

/// A microphone that gives 10 ms of a quiet tone every 10 ms until stopped.
struct ToneCapture {
    /// Its start fails with this code.
    fails: Option<String>,
    callbacks: Option<CaptureCallbacks>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Capture for ToneCapture {
    fn start(&mut self) -> Result<()> {
        if let Some(code) = &self.fails {
            return Err(Error::runtime(code));
        }
        let mut callbacks = self.callbacks.take().ok_or_else(|| Error::runtime("vc_capture_failed"))?;
        let stop = self.stop.clone();
        self.thread = Some(std::thread::spawn(move || {
            let block: Vec<u8> = (0..480).flat_map(|i: i32| (((i % 48) - 24) as i16 * 100).to_le_bytes()).collect();
            while !stop.load(Ordering::SeqCst) {
                if !(callbacks.on_audio)(&block) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }));
        Ok(())
    }
    fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
    fn stop(&mut self) {
        self.request_stop();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl RouteDevices for FakeVoice {
    fn outputs(&self, _: &[String]) -> Result<Vec<String>> {
        Ok(self.0.outputs.lock().unwrap().clone())
    }
    fn open_output(&self, device: &str) -> Result<Box<dyn Output>> {
        self.open(device, 48000, 1)
    }
    fn capture(&self, _: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture> {
        *self.0.captures.lock().unwrap() += 1;
        let fails = self.0.capture_fails.lock().unwrap().clone();
        Box::new(ToneCapture { fails, callbacks: Some(callbacks), stop: Arc::new(AtomicBool::new(false)), thread: None })
    }
}

/// The managed VC input a Linux conversion plays into.
pub const MANAGED_VC: &str = "vrct.managed.vc";

impl ManagedVcDevices for FakeVoice {
    fn bind(&self, _: &Endpoint, _: bool) -> Result<Endpoint> {
        Ok(Endpoint { cookie: 1, serial: 2, name: MANAGED_VC.into(), media_class: "Audio/Sink".into() })
    }
    fn open_output(&self, sink: &Endpoint) -> Result<Box<dyn Output>> {
        self.open(&sink.name, 48000, 1)
    }
    fn capture(&self, source: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture> {
        RouteDevices::capture(self, source, callbacks)
    }
}

/// The Linux passthrough as a record of its starts.
struct FakeBridge {
    requested: AtomicBool,
}

impl DirectBackend for FakeBridge {
    fn start(&self, _: Endpoint) -> std::result::Result<(), String> {
        self.requested.store(true, Ordering::SeqCst);
        Ok(())
    }
    fn stop(&self) {
        self.requested.store(false, Ordering::SeqCst);
    }
    fn close(&self, _: Duration) -> bool {
        self.stop();
        true
    }
    fn health(&self) -> Health {
        let requested = self.requested.load(Ordering::SeqCst);
        Health { requested, active: requested, ..Health::default() }
    }
    fn set_monitor_muted(&self, _: bool) {}
}

struct Served(Cursor<Vec<u8>>);

impl std::io::Read for Served {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        self.0.read(buffer)
    }
}

impl Body for Served {}

impl Transport for FakeVoice {
    fn open(&self, url: &str) -> std::result::Result<Box<dyn Body>, vrct_ops::downloads::Error> {
        self.0.fetched.lock().unwrap().push(url.to_owned());
        let data = self.0.files.lock().unwrap().get(url).cloned().ok_or_else(|| vrct_ops::downloads::Error::Other("not served".into()))?;
        Ok(Box::new(Served(Cursor::new(data))))
    }
}

impl VoicePlatform for FakeVoice {
    fn direct_sources(&self) -> Result<Vec<Source>> {
        self.0.sources.lock().unwrap().clone().ok_or_else(|| Error::runtime("wasapi_unavailable"))
    }
    fn default_microphone(&self) -> Option<String> {
        self.0.default_mic.lock().unwrap().clone()
    }
    fn speech_output(&self, device: &str, rate: u32, channels: u16) -> Result<Box<dyn Output>> {
        if device.is_empty() {
            return Err(Error::speech("output_not_selected"));
        }
        self.open(device, rate, channels)
    }
    fn monitor_output(&self) -> MonitorFactory {
        let fake = self.clone();
        Arc::new(move |device: &str, rate: u32, channels: u16, _: &[String]| {
            if fake.0.monitor_fails.load(Ordering::SeqCst) {
                return Err(Error::speech("output_missing"));
            }
            fake.open(&format!("monitor:{device}"), rate, channels)
        })
    }
    fn gate(&self, _: &Path) -> Arc<dyn Gate> {
        self.0.gate.clone()
    }
    fn passthrough(&self, _: &Path, output: Option<&str>) -> std::result::Result<Box<dyn DirectBackend>, String> {
        self.0.passthrough.lock().unwrap().push(output.map(str::to_owned));
        match output {
            Some(output) => Ok(Box::new(vrct_audio_routing::windows_route::WindowsBridge::new(output, Arc::new(self.clone()), vrct_audio_routing::report::reporter()))),
            None => Ok(Box::new(FakeBridge { requested: AtomicBool::new(false) })),
        }
    }
    fn route_devices(&self) -> Option<Arc<dyn RouteDevices>> {
        Some(Arc::new(self.clone()))
    }
    fn managed_vc_devices(&self) -> Option<Arc<dyn ManagedVcDevices>> {
        (!self.0.no_managed_vc.load(Ordering::SeqCst)).then(|| Arc::new(self.clone()) as Arc<dyn ManagedVcDevices>)
    }
    fn rvc_worker(&self, _: &Path) -> PathBuf {
        self.0.worker.lock().unwrap().clone()
    }
    fn runtime_transport(&self) -> Arc<dyn Transport> {
        Arc::new(self.clone())
    }
    fn nvidia_driver(&self) -> bool {
        self.0.nvidia.load(Ordering::SeqCst)
    }
    fn runtime_target(&self) -> Option<Target> {
        if self.0.no_target.load(Ordering::SeqCst) { None } else { Some(Target::Windows) }
    }
    fn runtime_entries(&self) -> Option<Vec<Runtime>> {
        self.0.entries.lock().unwrap().clone()
    }
}
