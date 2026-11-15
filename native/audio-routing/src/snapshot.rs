//! Device list snapshots and the identities given to their rows.
//!
//! Port of `DeviceManager._identifiedSnapshot` and `_trackedSpeakerDevice` in
//! `src-python/device_manager.py`. A snapshot is replaced as a whole, so a reader
//! never sees the new microphone list next to the old default.

use std::collections::HashMap;

use crate::identity::{Device, NO_HOST};

/// The suffix PortAudio gives a speaker's loopback twin. Speaker rows carry it.
pub const LOOPBACK_SUFFIX: &str = " [Loopback]";

/// A host a microphone row is listed under.
#[derive(Debug, Clone, PartialEq)]
pub struct Host {
    pub index: i64,
    pub name: String,
}

impl Host {
    pub fn no_host() -> Self {
        Self { index: -1, name: NO_HOST.to_owned() }
    }
}

/// The OS default microphone and the host its row belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct DefaultMic {
    pub host: Host,
    pub device: Device,
}

impl DefaultMic {
    pub fn none() -> Self {
        Self { host: Host::no_host(), device: Device::no_device() }
    }
}

/// Microphones grouped by host, in listing order.
pub type MicDevices = Vec<(String, Vec<Device>)>;

/// The four lists, swapped together.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceSnapshot {
    pub mic_devices: MicDevices,
    pub default_mic_device: DefaultMic,
    pub speaker_devices: Vec<Device>,
    pub default_speaker_device: Device,
}

impl DeviceSnapshot {
    /// What is shown before the first enumeration or when there are no devices.
    pub fn empty() -> Self {
        Self {
            mic_devices: vec![(NO_HOST.to_owned(), vec![Device::no_device()])],
            default_mic_device: DefaultMic::none(),
            speaker_devices: vec![Device::no_device()],
            default_speaker_device: Device::no_device(),
        }
    }

    pub fn mic_hosts(&self) -> Vec<&str> {
        self.mic_devices.iter().map(|(host, _)| host.as_str()).collect()
    }

    pub fn mics(&self, host: &str) -> Option<&[Device]> {
        self.mic_devices.iter().find(|(name, _)| name == host).map(|(_, devices)| devices.as_slice())
    }
}

/// The endpoint the speaker peak tracker last chose.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackedEndpoint {
    pub id: String,
    pub name: String,
}

/// Unidentified lists as an enumeration produced them.
#[derive(Debug, Clone, PartialEq)]
pub struct RawLists {
    pub mic_devices: MicDevices,
    pub default_mic_device: DefaultMic,
    pub speaker_devices: Vec<Device>,
    pub default_speaker_device: Device,
}

impl RawLists {
    /// Empty lists, which identify to the placeholders.
    pub fn none() -> Self {
        Self { mic_devices: Vec::new(), default_mic_device: DefaultMic::none(), speaker_devices: Vec::new(), default_speaker_device: Device::no_device() }
    }
}

/// What identities depend on besides the rows themselves.
#[derive(Debug, Clone)]
pub struct IdentityContext<'a> {
    /// Random per manager: slot identities never survive a restart.
    pub namespace: &'a str,
    /// Counts topology events: slot identities never survive a replacement.
    pub generation: u64,
    /// Native endpoint IDs by friendly name, for rows that carry none.
    pub endpoint_ids: &'a HashMap<String, Vec<String>>,
    /// Set while Auto Speaker Select follows the peak tracker.
    pub tracked_speaker: Option<&'a TrackedEndpoint>,
}

/// The host label speakers are identified under when a row names none.
const DEFAULT_SPEAKER_HOST: &str = "WASAPI";

/// Give every row its identity and build the snapshot.
pub fn identify(lists: RawLists, context: &IdentityContext<'_>) -> DeviceSnapshot {
    let mut counts: HashMap<(&str, String, String), usize> = HashMap::new();
    for (host, devices) in &lists.mic_devices {
        for device in devices {
            *counts.entry(("mic", host.clone(), device.name.clone())).or_default() += 1;
        }
    }
    for device in &lists.speaker_devices {
        *counts.entry(("speaker", speaker_host(device), device.name.clone())).or_default() += 1;
    }
    let one = |device: &Device, host: &str, source: &'static str| identify_one(device, host, source, &counts, context);

    let mic_devices: MicDevices = lists.mic_devices.iter().map(|(host, devices)| (host.clone(), devices.iter().map(|d| one(d, host, "mic")).collect())).collect();
    let speakers: Vec<Device> = lists.speaker_devices.iter().map(|d| one(d, &speaker_host(d), "speaker")).collect();
    let mic_host = lists.default_mic_device.host.clone();
    let default_mic_device = DefaultMic { device: one(&lists.default_mic_device.device, &mic_host.name, "mic"), host: mic_host };
    let mut default_speaker_device = one(&lists.default_speaker_device, &speaker_host(&lists.default_speaker_device), "speaker");
    if let Some(tracked) = context.tracked_speaker {
        if let Some(device) = tracked_speaker_device(&speakers, tracked) {
            default_speaker_device = device.clone();
        }
    }
    DeviceSnapshot { mic_devices, default_mic_device, speaker_devices: speakers, default_speaker_device }
}

fn speaker_host(device: &Device) -> String {
    device.host_api.clone().unwrap_or_else(|| DEFAULT_SPEAKER_HOST.to_owned())
}

fn identify_one(device: &Device, host: &str, source: &str, counts: &HashMap<(&str, String, String), usize>, context: &IdentityContext<'_>) -> Device {
    let mut device = device.clone();
    if device.is_no_device() {
        return device;
    }
    let mut native = device.endpoint_id.clone().filter(|id| !id.is_empty());
    let label = device.name.strip_suffix(LOOPBACK_SUFFIX).unwrap_or(&device.name);
    let mapped = context.endpoint_ids.get(label).map(Vec::as_slice).unwrap_or_default();
    let count = counts.get(&(source_key(source), host.to_owned(), device.name.clone())).copied().unwrap_or(0);
    if native.is_none() && mapped.len() == 1 && count == 1 {
        native = Some(mapped[0].clone());
        device.endpoint_id = native.clone();
    }
    let identity = if let Some(native) = native {
        format!("{source}:{host}:{native}")
    } else if let Some(node) = device.node_name.as_ref().filter(|node| !node.is_empty()) {
        format!("pipewire:{node}")
    } else {
        // Slot-only rows: never persistently equate a reused slot with an old endpoint.
        format!("pa:{}:{}:{source}:{host}:{}", context.namespace, context.generation, device.index)
    };
    device.id = Some(identity);
    device.incarnation = Some((context.generation, device.object_serial));
    device
}

fn source_key(source: &str) -> &'static str {
    if source == "mic" {
        "mic"
    } else {
        "speaker"
    }
}

/// The speaker row of the endpoint the peak tracker chose, when exactly one matches.
///
/// The native ID decides. Only rows without one may match by name.
pub fn tracked_speaker_device<'a>(devices: &'a [Device], endpoint: &TrackedEndpoint) -> Option<&'a Device> {
    let by_id: Vec<&Device> = devices.iter().filter(|d| d.endpoint_id.as_deref() == Some(endpoint.id.as_str())).collect();
    let matches = if by_id.is_empty() {
        let loopback = format!("{}{LOOPBACK_SUFFIX}", endpoint.name);
        devices.iter().filter(|d| d.endpoint_id.is_none() && d.name == loopback).collect()
    } else {
        by_id
    };
    (matches.len() == 1).then(|| matches[0])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{device_id, resolve_device};

    fn context(endpoints: &HashMap<String, Vec<String>>) -> IdentityContext<'_> {
        IdentityContext { namespace: "ns", generation: 0, endpoint_ids: endpoints, tracked_speaker: None }
    }

    fn mic(name: &str, index: i64, endpoint: Option<&str>) -> Device {
        Device { name: name.into(), index, endpoint_id: endpoint.map(Into::into), ..Device::default() }
    }

    fn lists(mics: Vec<Device>, default: Device) -> RawLists {
        RawLists {
            mic_devices: vec![("WASAPI".into(), mics)],
            default_mic_device: DefaultMic { host: Host { index: 0, name: "WASAPI".into() }, device: default },
            speaker_devices: vec![],
            default_speaker_device: Device::no_device(),
        }
    }

    #[test]
    fn duplicates_keep_native_ids_and_only_unambiguous_legacy_selection_migrates() {
        let endpoints = HashMap::new();
        let devices = vec![mic("USB mic", 1, Some("a")), mic("USB mic", 6, Some("b"))];
        let snapshot = identify(lists(devices.clone(), devices[1].clone()), &context(&endpoints));
        let listed = snapshot.mics("WASAPI").unwrap();
        assert_eq!(device_id(Some(&listed[0])), "mic:WASAPI:a");
        assert_ne!(device_id(Some(&listed[0])), device_id(Some(&listed[1])));
        assert_eq!(resolve_device(listed, device_id(Some(&listed[1])), None), Some(&listed[1]));
        assert_eq!(resolve_device(listed, "", Some("USB mic")), None);
        assert_eq!(resolve_device(&listed[..1], "", Some("USB mic")), Some(&listed[0]));
        assert_eq!(resolve_device(listed, "missing", Some("USB mic")), None);
    }

    #[test]
    fn slot_only_identity_changes_with_generation_and_namespace() {
        let endpoints = HashMap::new();
        let device = mic("USB mic", 1, None);
        let first = identify(lists(vec![device.clone()], device.clone()), &context(&endpoints));
        let replaced = identify(lists(vec![device.clone()], device.clone()), &IdentityContext { generation: 1, ..context(&endpoints) });
        let restarted = identify(lists(vec![device.clone()], device), &IdentityContext { namespace: "other", ..context(&endpoints) });
        let id = |s: &DeviceSnapshot| device_id(Some(&s.mics("WASAPI").unwrap()[0])).to_owned();
        assert_eq!(id(&first), "pa:ns:0:mic:WASAPI:1");
        assert_ne!(id(&first), id(&replaced));
        assert_ne!(id(&first), id(&restarted));
    }

    #[test]
    fn friendly_name_ids_map_only_unique_labels() {
        let endpoints = HashMap::from([("USB mic".to_owned(), vec!["native".to_owned()]), ("Twin".to_owned(), vec!["x".to_owned(), "y".to_owned()])]);
        let snapshot = identify(lists(vec![mic("USB mic", 1, None), mic("Twin", 2, None)], Device::no_device()), &context(&endpoints));
        let listed = snapshot.mics("WASAPI").unwrap();
        assert_eq!(listed[0].endpoint_id.as_deref(), Some("native"));
        assert_eq!(listed[1].endpoint_id, None);
        // The same label twice under one host is ambiguous even with one mapping.
        let twice = identify(lists(vec![mic("USB mic", 1, None), mic("USB mic", 2, None)], Device::no_device()), &context(&endpoints));
        assert!(twice.mics("WASAPI").unwrap().iter().all(|d| d.endpoint_id.is_none()));
    }

    #[test]
    fn pipewire_rows_are_identified_by_node_name() {
        let endpoints = HashMap::new();
        let row = Device { name: "Headset".into(), node_name: Some("alsa_input.usb".into()), object_serial: Some(77), ..Device::default() };
        let snapshot = identify(lists(vec![row.clone()], row), &context(&endpoints));
        let listed = &snapshot.mics("WASAPI").unwrap()[0];
        assert_eq!(listed.id.as_deref(), Some("pipewire:alsa_input.usb"));
        assert_eq!(listed.incarnation, Some((0, Some(77))));
    }

    #[test]
    fn speaker_rows_use_their_host_label() {
        let endpoints = HashMap::new();
        let speaker = Device { name: "Speakers [Loopback]".into(), host_api: Some("2".into()), endpoint_id: Some("{e}".into()), ..Device::default() };
        let raw = RawLists { speaker_devices: vec![speaker.clone()], default_speaker_device: speaker, ..RawLists::none() };
        let snapshot = identify(raw, &context(&endpoints));
        assert_eq!(snapshot.speaker_devices[0].id.as_deref(), Some("speaker:2:{e}"));
        assert_eq!(snapshot.default_speaker_device.id.as_deref(), Some("speaker:2:{e}"));
    }

    #[test]
    fn tracked_speaker_prefers_native_id_and_falls_back_to_unique_name() {
        let rows = [
            Device { name: "USB Audio [Loopback]".into(), endpoint_id: Some("a".into()), ..Device::default() },
            Device { name: "USB Audio [Loopback]".into(), endpoint_id: Some("b".into()), ..Device::default() },
            Device { name: "Legacy [Loopback]".into(), ..Device::default() },
        ];
        let pick = |id: &str, name: &str| tracked_speaker_device(&rows, &TrackedEndpoint { id: id.into(), name: name.into() }).cloned();
        assert_eq!(pick("b", "USB Audio").unwrap().endpoint_id.as_deref(), Some("b"));
        assert_eq!(pick("zz", "Legacy").unwrap().name, "Legacy [Loopback]");
        assert_eq!(pick("zz", "USB Audio"), None);
    }
}
