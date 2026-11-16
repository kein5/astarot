//! Windows: endpoints through WASAPI and the MMDevice API.
//!
//! The Python backend reached WASAPI through PortAudio (PyAudioWPatch) and pycaw.
//! Here the same endpoints are read directly. Rows are listed under PortAudio's
//! WASAPI host name and carry the native endpoint ID, so a saved selection keeps the
//! identity Python gave it (`mic:Windows WASAPI:<endpoint id>`,
//! `speaker:<host index>:<endpoint id>`).

pub mod capture;
pub mod output;

use std::marker::PhantomData;
use std::sync::Arc;

use windows::core::{implement, PCWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{PROPERTYKEY, RPC_E_CHANGED_MODE};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    eCapture, eMultimedia, eRender, EDataFlow, ERole, IAudioClient, IMMDevice, IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, DEVICE_STATE,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToBSTR};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};

use crate::error::{Error, Result};
use crate::graph::Endpoint;
use crate::identity::Device;
use crate::manager::{DeviceBackend, Topology, Watch};
use crate::naming::{crc32, is_virtual_cable, output_identity, WASAPI_HOST};
use crate::report::Reporter;
use crate::snapshot::{DefaultMic, Host, RawLists, LOOPBACK_SUFFIX};
use crate::sync::audio_op_lock;
use crate::tracker::{EndpointFailed, Endpoints, Flow, MeterCache, MeterFactory, MeterSource, Reading};

/// PortAudio's index of the WASAPI host in PyAudioWPatch builds (MME, DirectSound,
/// WASAPI, WDM-KS). Speaker identities carry it, so it must stay the same.
pub const PORTAUDIO_WASAPI_INDEX: i64 = 2;

/// COM for the current thread, in the multithreaded apartment, until dropped.
pub struct Com {
    owned: bool,
    _thread_bound: PhantomData<*const ()>,
}

impl Com {
    pub fn init() -> Result<Self> {
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if result == RPC_E_CHANGED_MODE {
            // A single-threaded apartment is already set up here; use it as is.
            return Ok(Self { owned: false, _thread_bound: PhantomData });
        }
        if result.is_err() {
            return Err(Error::runtime("com_unavailable"));
        }
        Ok(Self { owned: true, _thread_bound: PhantomData })
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.owned {
            unsafe { CoUninitialize() };
        }
    }
}

/// Keeps the process's multithreaded apartment alive until dropped (`CoIncrementMTAUsage`).
/// Unlike [`Com`] it is not bound to a thread: an object opened on one thread and used and
/// dropped on another holds this, so the thread that opened it keeps its own COM balanced.
pub struct MtaUsage(windows::Win32::System::Com::CO_MTA_USAGE_COOKIE);

// The cookie may be released from any thread.
unsafe impl Send for MtaUsage {}

impl MtaUsage {
    pub fn new() -> Result<Self> {
        unsafe { windows::Win32::System::Com::CoIncrementMTAUsage() }.map(Self).map_err(|_| Error::runtime("com_unavailable"))
    }
}

impl Drop for MtaUsage {
    fn drop(&mut self) {
        let _ = unsafe { windows::Win32::System::Com::CoDecrementMTAUsage(self.0) };
    }
}

fn failed(_: windows::core::Error) -> Error {
    Error::runtime("wasapi_unavailable")
}

pub(crate) fn enumerator() -> Result<IMMDeviceEnumerator> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(failed)
}

pub(crate) fn endpoint_id(device: &IMMDevice) -> Result<String> {
    unsafe {
        let id = device.GetId().map_err(failed)?;
        let text = id.to_string().map_err(|_| Error::runtime("wasapi_unavailable"));
        CoTaskMemFree(Some(id.0 as *const _));
        text
    }
}

fn property(device: &IMMDevice, key: &PROPERTYKEY) -> Result<String> {
    unsafe {
        let store = device.OpenPropertyStore(STGM_READ).map_err(failed)?;
        let mut value = store.GetValue(key).map_err(failed)?;
        let text = PropVariantToBSTR(&value).map(|b| b.to_string()).map_err(failed);
        let _ = PropVariantClear(&mut value);
        text
    }
}

pub(crate) fn friendly_name(device: &IMMDevice) -> Result<String> {
    property(device, &PKEY_Device_FriendlyName)
}

/// The shared-mode mix format: (sample rate, channels).
fn mix_format(device: &IMMDevice) -> Result<(u32, u16)> {
    unsafe {
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(failed)?;
        let format = client.GetMixFormat().map_err(failed)?;
        let result = ((*format).nSamplesPerSec, (*format).nChannels);
        CoTaskMemFree(Some(format as *const _));
        Ok(result)
    }
}

/// Active endpoints of one direction, in the order Windows lists them.
pub(crate) fn endpoints(enumerator: &IMMDeviceEnumerator, flow: EDataFlow) -> Result<Vec<(String, IMMDevice)>> {
    unsafe {
        let collection = enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE).map_err(failed)?;
        let count = collection.GetCount().map_err(failed)?;
        let mut result = Vec::with_capacity(count as usize);
        for index in 0..count {
            let Ok(device) = collection.Item(index) else { continue };
            let Ok(id) = endpoint_id(&device) else { continue };
            result.push((id, device));
        }
        Ok(result)
    }
}

pub(crate) fn default_endpoint_id(enumerator: &IMMDeviceEnumerator, flow: EDataFlow, role: ERole) -> Option<String> {
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(flow, role) }.ok()?;
    endpoint_id(&device).ok()
}

/// Named rows of one direction: (endpoint id, friendly name, device).
pub(crate) fn named(enumerator: &IMMDeviceEnumerator, flow: EDataFlow) -> Result<Vec<(String, String, IMMDevice)>> {
    Ok(endpoints(enumerator, flow)?.into_iter().filter_map(|(id, device)| Some((id, friendly_name(&device).ok()?, device))).collect())
}

/// The device lists for the device manager.
pub struct WasapiBackend {
    reporter: Arc<dyn Reporter>,
}

impl WasapiBackend {
    pub fn new(reporter: Arc<dyn Reporter>) -> Self {
        Self { reporter }
    }

    fn lists(&self) -> Result<RawLists> {
        let _com = Com::init()?;
        let _lock = audio_op_lock().lock();
        let enumerator = enumerator()?;
        let host = PORTAUDIO_WASAPI_INDEX.to_string();
        let mut mics = Vec::new();
        for (index, (id, name, device)) in named(&enumerator, eCapture)?.into_iter().enumerate() {
            let format = mix_format(&device).ok();
            mics.push(Device {
                index: index as i64,
                name,
                host_api: Some(host.clone()),
                default_sample_rate: format.map(|f| f64::from(f.0)),
                max_input_channels: format.map(|f| i64::from(f.1)),
                is_loopback: Some(false),
                endpoint_id: Some(id),
                ..Device::default()
            });
        }
        let mut speakers = Vec::new();
        for (index, (id, name, device)) in named(&enumerator, eRender)?.into_iter().enumerate() {
            let format = mix_format(&device).ok();
            speakers.push(Device {
                index: index as i64,
                name: format!("{name}{LOOPBACK_SUFFIX}"),
                host_api: Some(host.clone()),
                default_sample_rate: format.map(|f| f64::from(f.0)),
                max_input_channels: format.map(|f| i64::from(f.1)),
                is_loopback: Some(true),
                endpoint_id: Some(id),
                ..Device::default()
            });
        }
        let default_mic = default_endpoint_id(&enumerator, eCapture, eMultimedia).and_then(|id| mics.iter().find(|d| d.endpoint_id.as_deref() == Some(id.as_str())).cloned());
        let default_speaker = default_endpoint_id(&enumerator, eRender, eMultimedia).and_then(|id| speakers.iter().find(|d| d.endpoint_id.as_deref() == Some(id.as_str())).cloned());
        let wasapi = Host { index: PORTAUDIO_WASAPI_INDEX, name: WASAPI_HOST.to_owned() };
        Ok(RawLists {
            mic_devices: if mics.is_empty() { Vec::new() } else { vec![(WASAPI_HOST.to_owned(), mics)] },
            default_mic_device: default_mic.map_or_else(DefaultMic::none, |device| DefaultMic { host: wasapi, device }),
            speaker_devices: speakers,
            default_speaker_device: default_speaker.unwrap_or_else(Device::no_device),
        })
    }
}

impl DeviceBackend for WasapiBackend {
    fn enumerate(&self) -> RawLists {
        self.lists().unwrap_or_else(|error| {
            self.reporter.error(&error.code);
            RawLists::none()
        })
    }

    fn watch(&self, notify: Arc<dyn Fn(Topology) + Send + Sync>) -> Option<Box<dyn Watch>> {
        let com = Com::init().ok()?;
        let enumerator = enumerator().ok()?;
        let client: IMMNotificationClient = NotificationClient { notify }.into();
        if unsafe { enumerator.RegisterEndpointNotificationCallback(&client) }.is_err() {
            self.reporter.error("endpoint_notification_unavailable");
            return None;
        }
        Some(Box::new(Registration { enumerator, client, _com: com }))
    }

    fn meters(&self) -> Arc<dyn MeterFactory> {
        Arc::new(WasapiMeters)
    }
}

/// Endpoint notifications, registered once for the life of the monitoring thread.
#[implement(IMMNotificationClient)]
struct NotificationClient {
    notify: Arc<dyn Fn(Topology) + Send + Sync>,
}

impl IMMNotificationClient_Impl for NotificationClient_Impl {
    fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> windows::core::Result<()> {
        (self.notify)(Topology::DeviceChanged);
        Ok(())
    }
    fn OnDeviceAdded(&self, _: &PCWSTR) -> windows::core::Result<()> {
        (self.notify)(Topology::DeviceChanged);
        Ok(())
    }
    fn OnDeviceRemoved(&self, _: &PCWSTR) -> windows::core::Result<()> {
        (self.notify)(Topology::DeviceChanged);
        Ok(())
    }
    fn OnDefaultDeviceChanged(&self, _: EDataFlow, _: ERole, _: &PCWSTR) -> windows::core::Result<()> {
        (self.notify)(Topology::DefaultChanged);
        Ok(())
    }
    // Property changes (volume among them) would poll far too often; default changes
    // arrive through OnDefaultDeviceChanged.
    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> windows::core::Result<()> {
        Ok(())
    }
}

struct Registration {
    enumerator: IMMDeviceEnumerator,
    client: IMMNotificationClient,
    _com: Com,
}

impl Watch for Registration {}

impl Drop for Registration {
    fn drop(&mut self) {
        let _ = unsafe { self.enumerator.UnregisterEndpointNotificationCallback(&self.client) };
    }
}

/// Peak meters for the speaker tracker.
pub struct WasapiMeters;

struct WasapiEndpoints {
    enumerator: IMMDeviceEnumerator,
    flow: EDataFlow,
}

impl Endpoints for WasapiEndpoints {
    type Device = IMMDevice;
    type Meter = IAudioMeterInformation;

    fn enumerate(&mut self) -> std::result::Result<Vec<(String, IMMDevice)>, EndpointFailed> {
        endpoints(&self.enumerator, self.flow).map_err(|_| EndpointFailed)
    }

    fn activate(&mut self, device: &IMMDevice) -> std::result::Result<(String, IAudioMeterInformation), EndpointFailed> {
        // An owned interface reference: the cached meter stays valid on this thread.
        let meter: IAudioMeterInformation = unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(|_| EndpointFailed)?;
        Ok((friendly_name(device).map_err(|_| EndpointFailed)?, meter))
    }

    fn peak(&mut self, meter: &IAudioMeterInformation) -> std::result::Result<f32, EndpointFailed> {
        unsafe { meter.GetPeakValue() }.map_err(|_| EndpointFailed)
    }
}

struct WasapiMeterSource {
    // Declared before the apartment: COM references are released before it ends.
    cache: MeterCache<WasapiEndpoints>,
    _com: Com,
}

impl MeterSource for WasapiMeterSource {
    fn poll(&mut self) -> Vec<Reading> {
        self.cache.poll()
    }
}

impl MeterFactory for WasapiMeters {
    fn available(&self) -> bool {
        true
    }

    fn open(&self, flow: Flow) -> Option<Box<dyn MeterSource>> {
        let com = Com::init().ok()?;
        let flow = match flow {
            Flow::Render => eRender,
            Flow::Capture => eCapture,
        };
        let enumerator = enumerator().ok()?;
        Some(Box::new(WasapiMeterSource { cache: MeterCache::new(WasapiEndpoints { enumerator, flow }), _com: com }))
    }
}

/// Whether `source` is `"mic"` (an input) or `"speaker"` (an output).
fn flow_of(source: &str) -> EDataFlow {
    if source == "mic" {
        eCapture
    } else {
        eRender
    }
}

/// A Windows endpoint in the shape the source bridge uses on Linux. A Windows device
/// has no graph identity, and its position moves when another device appears, so the
/// cookie is a hash of the identity text and the serial is zero.
pub fn endpoint_for(identity: &str, source: &str) -> Endpoint {
    Endpoint { cookie: crc32(identity.as_bytes()), serial: 0, name: identity.to_owned(), media_class: if source == "mic" { "Audio/Source" } else { "Audio/Sink" }.to_owned() }
}

/// One selectable WASAPI microphone or speaker.
pub struct EndpointRow {
    pub endpoint: Endpoint,
    pub label: String,
}

/// WASAPI microphones or speakers. Other hosts repeat the same hardware.
pub fn enumerate_endpoints(source: &str) -> Result<Vec<EndpointRow>> {
    let _com = Com::init()?;
    let _lock = audio_op_lock().lock();
    let enumerator = enumerator()?;
    Ok(named(&enumerator, flow_of(source))?.into_iter().map(|(_, name, _)| EndpointRow { endpoint: endpoint_for(&output_identity(WASAPI_HOST, &name), source), label: name }).collect())
}

/// The OS default microphone or speaker. A cable as the default microphone would
/// transcribe or convert VRCT-VOX's own speech, so it is refused.
pub fn default_endpoint(source: &str) -> Result<Endpoint> {
    let missing = || Error::value("realtime_default_endpoint_missing");
    let identity = {
        let _com = Com::init().map_err(|_| missing())?;
        let _lock = audio_op_lock().lock();
        let enumerator = enumerator().map_err(|_| missing())?;
        let device = unsafe { enumerator.GetDefaultAudioEndpoint(flow_of(source), eMultimedia) }.map_err(|_| missing())?;
        output_identity(WASAPI_HOST, &friendly_name(&device).map_err(|_| missing())?)
    };
    if source == "mic" && is_virtual_cable(&identity) {
        return Err(Error::value("realtime_default_endpoint_feedback"));
    }
    Ok(endpoint_for(&identity, source))
}

/// The one active endpoint of `flow` whose identity is `identity`.
pub(crate) fn find_by_identity(enumerator: &IMMDeviceEnumerator, flow: EDataFlow, identity: &str) -> Result<IMMDevice> {
    let mut matches: Vec<IMMDevice> = named(enumerator, flow)?.into_iter().filter(|(_, name, _)| output_identity(WASAPI_HOST, name) == identity).map(|(_, _, device)| device).collect();
    if matches.len() != 1 {
        return Err(Error::runtime("endpoint_missing"));
    }
    Ok(matches.remove(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_mta_usage_keeps_com_usable_from_other_threads_and_is_released_from_any() {
        // #428: an output held the opening thread's COM and was dropped on the writing thread,
        // which left the opening thread's initialization unbalanced.
        let usage = std::thread::spawn(|| MtaUsage::new().unwrap()).join().unwrap();
        // A thread that never initialized COM uses the apartment the cookie keeps alive.
        let made = std::thread::spawn(|| enumerator().is_ok()).join().unwrap();
        assert!(made);
        std::thread::spawn(move || drop(usage)).join().unwrap();
        // The thread that opens keeps its own COM balanced: it can enter another apartment.
        std::thread::spawn(|| {
            let com = Com::init().unwrap();
            let _usage = MtaUsage::new().unwrap();
            drop(com);
            let single = unsafe { windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_APARTMENTTHREADED) };
            assert!(single.is_ok(), "COM was left initialized on the opening thread: {single:?}");
            unsafe { CoUninitialize() };
        })
        .join()
        .unwrap();
    }
}