//! Audio devices in memory, in place of WASAPI and PipeWire: lists the test sets, change events
//! the test sends, and virtual cables that pass (or do not pass) the test tone. Nothing touches a
//! real device.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use astarot_audio_routing::Error;
use astarot_audio_routing::graph::OutputOption;
use astarot_audio_routing::identity::Device;
use astarot_audio_routing::manager::{DeviceBackend, Topology, Watch};
use astarot_audio_routing::naming::output_identity;
use astarot_audio_routing::platform::AudioPlatform;
use astarot_audio_routing::report::Reporter;
use astarot_audio_routing::router::{Output, PlaybackToken};
use astarot_audio_routing::snapshot::{DefaultMic, Host, RawLists};
use astarot_audio_routing::tracker::{Flow, MeterFactory, MeterSource};
use astarot_audio_routing::virtual_mic::{CableDevices, CablePair, LevelInput, pair_cables};

pub const WASAPI: &str = "Windows WASAPI";

type Handler = Arc<dyn Fn(Topology) + Send + Sync>;

#[derive(Default)]
struct Inner {
    lists: Mutex<Option<RawLists>>,
    handler: Mutex<Option<Handler>>,
    watching: AtomicBool,
    /// How many times the devices were listed: once per pass of the device monitor.
    listed: AtomicU64,
    /// The cables offered; `None`: the check is not offered (Linux).
    cables: Mutex<Option<CableSetup>>,
    /// The speech outputs; `Some(None)`: listing them fails.
    outputs: Mutex<Option<Option<Vec<OutputOption>>>>,
}

#[derive(Clone, Default)]
pub struct CableSetup {
    pub outputs: Vec<String>,
    pub inputs: Vec<String>,
    /// Listing the devices fails.
    pub unreadable: bool,
    /// The level the recording end passes on (0: the cable is muted).
    pub amplitude: i16,
    pub output_fails: bool,
    pub input_fails: bool,
    /// Each read takes this long.
    pub read_delay: Duration,
}

/// The fake devices; clone it to keep a handle after giving it to [`super::Setup`].
#[derive(Clone, Default)]
pub struct FakeAudio(Arc<Inner>);

impl FakeAudio {
    /// No devices and no cables.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with(lists: RawLists) -> Self {
        let fake = Self::new();
        fake.set(lists);
        fake
    }

    pub fn set(&self, lists: RawLists) {
        *self.0.lists.lock().unwrap() = Some(lists);
    }

    /// The speech outputs as `(id, label)`; `None`: listing them fails.
    pub fn set_outputs(&self, outputs: Option<&[(&str, &str)]>) {
        let rows = outputs.map(|rows| rows.iter().map(|(id, label)| OutputOption { id: (*id).into(), label: (*label).into() }).collect());
        *self.0.outputs.lock().unwrap() = Some(rows);
    }

    pub fn set_cables(&self, cables: Option<CableSetup>) {
        *self.0.cables.lock().unwrap() = cables;
    }

    /// Whether the device monitor has registered for changes (and not let go).
    pub fn watching(&self) -> bool {
        self.0.watching.load(Ordering::SeqCst)
    }

    pub fn wait_watching(&self) {
        let deadline = Instant::now() + super::TIMEOUT;
        while !self.watching() {
            assert!(Instant::now() < deadline, "the device monitor did not start watching");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// An OS change notification.
    pub fn event(&self, topology: Topology) {
        self.wait_watching();
        let handler = self.0.handler.lock().unwrap().clone().expect("watching");
        handler(topology);
    }

    /// Waits until the device monitor has run every callback of the passes it started before
    /// this call, so that nothing of an earlier change can still arrive.
    ///
    /// The monitor runs one pass at a time: it lists the devices, then runs the callbacks of what
    /// changed. A pass that lists the devices after a notification sent here therefore means the
    /// pass before it is over. Two rounds are needed: the first ends the pass under way, the second
    /// ends the pass the first notification started. Nothing has changed for those passes, except
    /// that the first pass after start-up compares with empty lists and reports every list once.
    pub fn settle(&self) {
        for _ in 0..2 {
            let before = self.0.listed.load(Ordering::SeqCst);
            self.event(Topology::DefaultChanged);
            let deadline = Instant::now() + super::TIMEOUT;
            while self.0.listed.load(Ordering::SeqCst) == before {
                assert!(Instant::now() < deadline, "the device monitor did not list the devices again");
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }

    pub fn platform(&self) -> Arc<dyn AudioPlatform> {
        Arc::new(self.clone())
    }
}

/// A microphone row as WASAPI lists it.
pub fn mic(index: i64, name: &str, native: &str) -> Device {
    Device {
        index,
        name: name.into(),
        host_api: Some("2".into()),
        default_sample_rate: Some(48000.0),
        max_input_channels: Some(2),
        is_loopback: Some(false),
        endpoint_id: Some(native.into()),
        ..Device::default()
    }
}

/// A speaker's loopback row as WASAPI lists it.
pub fn speaker(index: i64, name: &str, native: &str) -> Device {
    Device { name: format!("{name} [Loopback]"), is_loopback: Some(true), ..mic(index, "", native) }
}

/// Lists under the WASAPI host. The defaults name a native ID.
pub fn windows(mics: &[(&str, &str)], default_mic: Option<&str>, speakers: &[(&str, &str)], default_speaker: Option<&str>) -> RawLists {
    let mics: Vec<Device> = mics.iter().enumerate().map(|(i, (name, native))| mic(i as i64, name, native)).collect();
    let speakers: Vec<Device> = speakers.iter().enumerate().map(|(i, (name, native))| speaker(i as i64, name, native)).collect();
    let find = |rows: &[Device], native: Option<&str>| native.and_then(|n| rows.iter().find(|d| d.endpoint_id.as_deref() == Some(n)).cloned());
    RawLists {
        default_mic_device: find(&mics, default_mic).map_or_else(DefaultMic::none, |device| DefaultMic { host: Host { index: 2, name: WASAPI.into() }, device }),
        default_speaker_device: find(&speakers, default_speaker).unwrap_or_else(Device::no_device),
        mic_devices: if mics.is_empty() { Vec::new() } else { vec![(WASAPI.into(), mics)] },
        speaker_devices: speakers,
    }
}

pub fn wasapi_id(name: &str) -> String {
    output_identity(WASAPI, name)
}

struct Registered(Arc<Inner>);

impl Watch for Registered {}

impl Drop for Registered {
    fn drop(&mut self) {
        self.0.watching.store(false, Ordering::SeqCst);
        *self.0.handler.lock().unwrap() = None;
    }
}

struct NoMeters;

impl MeterFactory for NoMeters {
    fn available(&self) -> bool {
        false
    }
    fn open(&self, _: Flow) -> Option<Box<dyn MeterSource>> {
        None
    }
}

impl DeviceBackend for FakeAudio {
    fn enumerate(&self) -> RawLists {
        let lists = self.0.lists.lock().unwrap().clone().unwrap_or_else(RawLists::none);
        self.0.listed.fetch_add(1, Ordering::SeqCst);
        lists
    }

    fn endpoint_ids(&self) -> HashMap<String, Vec<String>> {
        HashMap::new()
    }

    fn watch(&self, notify: Arc<dyn Fn(Topology) + Send + Sync>) -> Option<Box<dyn Watch>> {
        *self.0.handler.lock().unwrap() = Some(notify);
        self.0.watching.store(true, Ordering::SeqCst);
        Some(Box::new(Registered(Arc::clone(&self.0))))
    }

    fn meters(&self) -> Arc<dyn MeterFactory> {
        Arc::new(NoMeters)
    }
}

impl AudioPlatform for FakeAudio {
    fn backend(&self, _: Arc<dyn Reporter>) -> Arc<dyn DeviceBackend> {
        Arc::new(self.clone())
    }

    fn outputs(&self, _: &[String]) -> Result<Vec<OutputOption>, Error> {
        match self.0.outputs.lock().unwrap().clone() {
            None => Ok(Vec::new()),
            Some(Some(rows)) => Ok(rows),
            Some(None) => Err(Error::speech("audio_devices_unavailable")),
        }
    }

    fn cables(&self) -> Option<Arc<dyn CableDevices>> {
        self.0.cables.lock().unwrap().is_some().then(|| Arc::new(self.clone()) as Arc<dyn CableDevices>)
    }
}

impl FakeAudio {
    fn setup(&self) -> CableSetup {
        self.0.cables.lock().unwrap().clone().unwrap_or_default()
    }
}

struct Tone;

impl Output for Tone {
    fn write(&mut self, _: &[u8], token: &dyn PlaybackToken) -> Result<(), Error> {
        token.check()
    }
    fn close(&mut self, _: bool, _: &dyn PlaybackToken) -> Result<(), Error> {
        Ok(())
    }
}

struct Level {
    amplitude: i16,
    delay: Duration,
}

impl LevelInput for Level {
    fn read(&mut self) -> Vec<u8> {
        std::thread::sleep(self.delay);
        let sample = self.amplitude.to_le_bytes();
        sample.iter().copied().cycle().take(4800).collect()
    }
}

impl CableDevices for FakeAudio {
    fn find_cables(&self) -> Result<Vec<CablePair>, Error> {
        let setup = self.setup();
        if setup.unreadable {
            return Err(Error::runtime("wasapi_unavailable"));
        }
        Ok(pair_cables(&setup.outputs, &setup.inputs))
    }

    fn open_output(&self, _: &str) -> Result<Box<dyn Output>, Error> {
        if self.setup().output_fails {
            return Err(Error::runtime("endpoint_missing"));
        }
        Ok(Box::new(Tone))
    }

    fn open_input(&self, _: &str) -> Result<Box<dyn LevelInput>, Error> {
        let setup = self.setup();
        if setup.input_fails {
            return Err(Error::runtime("endpoint_missing"));
        }
        Ok(Box::new(Level { amplitude: setup.amplitude, delay: setup.read_delay }))
    }
}
