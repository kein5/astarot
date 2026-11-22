//! Capture identity, kept separate from a device's human-readable label.
//!
//! Port of [`src-python/audio_device_identity.py`]. The rules:
//!
//! - The placeholder row named `NoDevice` has no identity.
//! - A saved identity matches only the row with that identity. A saved name (from
//!   settings written before identities existed) migrates only when exactly one row
//!   carries it, and an identity that is present but missing never falls back to the
//!   name.
//! - Two snapshots describe the same capture only when every field of the
//!   [`CaptureKey`] agrees. A changed slot, sample rate, channel count, native ID or
//!   topology generation makes it a different capture even under the same label.
//!
//! [`src-python/audio_device_identity.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/audio_device_identity.py

/// The name of the placeholder row shown when there is no device.
pub const NO_DEVICE: &str = "NoDevice";
/// The name of the placeholder host shown when there is no device.
pub const NO_HOST: &str = "NoHost";

/// One row of a device list.
///
/// The optional fields mirror the keys a row may or may not carry in the Python
/// backend; `None` is an absent key.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Device {
    /// Position in the list it came from; `-1` for the placeholder.
    pub index: i64,
    pub name: String,
    /// The host the row was listed under, as text (a PortAudio host index on Windows).
    pub host_api: Option<String>,
    pub default_sample_rate: Option<f64>,
    pub max_input_channels: Option<i64>,
    pub is_loopback: Option<bool>,
    /// PipeWire node name of a Linux input.
    pub node_name: Option<String>,
    /// PipeWire object serial of a Linux input.
    pub object_serial: Option<u64>,
    /// The OS's own ID for the endpoint (a Windows endpoint ID string).
    pub endpoint_id: Option<String>,
    /// The identity given by [`crate::snapshot`]; `None` until identified.
    pub id: Option<String>,
    /// Topology generation and object serial at identification.
    pub incarnation: Option<(u64, Option<u64>)>,
}

impl Device {
    /// The placeholder row.
    pub fn no_device() -> Self {
        Self { index: -1, name: NO_DEVICE.to_owned(), ..Self::default() }
    }

    pub fn is_no_device(&self) -> bool {
        self.name == NO_DEVICE
    }
}

/// The identity of a row, or `""` for the placeholder or an unidentified row.
pub fn device_id(device: Option<&Device>) -> &str {
    match device {
        Some(device) if !device.is_no_device() => device.id.as_deref().unwrap_or(""),
        _ => "",
    }
}

/// Everything that decides whether two rows are the same open capture.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureKey {
    id: String,
    name: String,
    host_api: Option<String>,
    index: i64,
    incarnation: Option<(u64, Option<u64>)>,
    default_sample_rate: Option<u64>,
    max_input_channels: Option<i64>,
    is_loopback: Option<bool>,
    node_name: Option<String>,
    object_serial: Option<u64>,
}

/// `None` for the placeholder or no row.
pub fn capture_key(device: Option<&Device>) -> Option<CaptureKey> {
    let device = device.filter(|device| !device.is_no_device())?;
    Some(CaptureKey {
        id: device_id(Some(device)).to_owned(),
        name: device.name.clone(),
        host_api: device.host_api.clone(),
        index: device.index,
        incarnation: device.incarnation,
        // Compared exactly, as Python compares floats in a tuple.
        default_sample_rate: device.default_sample_rate.map(f64::to_bits),
        max_input_channels: device.max_input_channels,
        is_loopback: device.is_loopback,
        node_name: device.node_name.clone(),
        object_serial: device.object_serial,
    })
}

/// The row a saved selection refers to.
///
/// With an identity, only that identity matches. Without one, a legacy name matches
/// only when exactly one row has it. More than one match is no match.
pub fn resolve_device<'a>(devices: &'a [Device], endpoint_id: &str, name: Option<&str>) -> Option<&'a Device> {
    let mut matches = devices.iter().filter(|device| if !endpoint_id.is_empty() { device_id(Some(device)) == endpoint_id } else { name.is_some_and(|name| name != NO_DEVICE && device.name == name) });
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

/// One choice in a device menu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceOption {
    pub id: String,
    pub label: String,
}

pub fn device_options(devices: &[Device]) -> Vec<DeviceOption> {
    devices.iter().map(|device| DeviceOption { id: device_id(Some(device)).to_owned(), label: device.name.clone() }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str, id: &str) -> Device {
        Device { name: name.into(), id: Some(id.into()), ..Device::default() }
    }

    #[test]
    fn placeholder_has_no_identity() {
        assert_eq!(device_id(Some(&Device { id: Some("x".into()), ..Device::no_device() })), "");
        assert_eq!(device_id(None), "");
        assert_eq!(capture_key(Some(&Device::no_device())), None);
        assert_eq!(capture_key(None), None);
    }

    #[test]
    fn identity_matches_only_itself_and_names_migrate_only_when_unique() {
        let devices = [row("USB mic", "a"), row("USB mic", "b"), row("Other", "c")];
        assert_eq!(resolve_device(&devices, "b", None), Some(&devices[1]));
        assert_eq!(resolve_device(&devices, "", Some("USB mic")), None);
        assert_eq!(resolve_device(&devices[..1], "", Some("USB mic")), Some(&devices[0]));
        assert_eq!(resolve_device(&devices, "missing", Some("Other")), None);
        assert_eq!(resolve_device(&[Device::no_device()], "", Some(NO_DEVICE)), None);
    }

    #[test]
    fn capture_key_tells_apart_a_changed_format_under_one_label() {
        let one = Device { name: "USB mic".into(), default_sample_rate: Some(48000.0), ..Device::default() };
        let other = Device { default_sample_rate: Some(16000.0), ..one.clone() };
        assert_ne!(capture_key(Some(&one)), capture_key(Some(&other)));
        assert_eq!(capture_key(Some(&one)), capture_key(Some(&one.clone())));
    }

    #[test]
    fn options_carry_identity_and_label() {
        assert_eq!(device_options(&[row("A", "id-a")]), vec![DeviceOption { id: "id-a".into(), label: "A".into() }]);
    }
}
