//! Which row a saved device choice means, and what to open when it means none.
//!
//! Port of the selection rules of `src-python/controller.py` (`_selectedAudioDevice`,
//! `_audioTarget` and the host lookup of `_publishAudioDeviceLocked`), plus the move of
//! choices saved under Windows hosts that are no longer listed (see [`migrate_mic`]).
//! The functions are pure: the caller passes the snapshot and the saved values.

use crate::identity::{capture_key, device_id, resolve_device, Device, NO_HOST};
use crate::naming::same_output;
use crate::snapshot::DeviceSnapshot;

/// A microphone or the speaker loopback.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Source {
    Mic,
    Speaker,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Mic => "mic",
            Source::Speaker => "speaker",
        }
    }
}

/// What the settings hold for one source.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Saved {
    /// `SELECTED_MIC_HOST`; ignored for the speaker.
    pub host: String,
    /// `SELECTED_MIC_DEVICE` or `SELECTED_SPEAKER_DEVICE`.
    pub name: String,
    /// `SELECTED_MIC_DEVICE_ID` or `SELECTED_SPEAKER_DEVICE_ID`.
    pub id: String,
    /// `AUTO_MIC_SELECT` or `AUTO_SPEAKER_SELECT`.
    pub auto: bool,
}

/// Every row of a source, with the host a microphone row is listed under.
pub fn rows(snapshot: &DeviceSnapshot, source: Source) -> Vec<(Option<&str>, &Device)> {
    match source {
        Source::Mic => snapshot.mic_devices.iter().flat_map(|(host, devices)| devices.iter().map(move |d| (Some(host.as_str()), d))).collect(),
        Source::Speaker => snapshot.speaker_devices.iter().map(|d| (None, d)).collect(),
    }
}

/// The rows the choice is made among: the microphones of the saved host, or every speaker.
pub fn candidates(snapshot: &DeviceSnapshot, source: Source, host: &str) -> Vec<Device> {
    rows(snapshot, source).into_iter().filter(|(h, _)| source == Source::Speaker || *h == Some(host)).map(|(_, d)| d.clone()).collect()
}

/// The row the saved choice names, if exactly one does (`_selectedAudioDevice`).
pub fn selected(snapshot: &DeviceSnapshot, source: Source, saved: &Saved) -> Option<Device> {
    let devices = candidates(snapshot, source, &saved.host);
    resolve_device(&devices, &saved.id, Some(&saved.name)).cloned()
}

/// What to open (`_audioTarget`): the saved choice unless Auto Select follows the OS
/// default, then the default, then the first row. `None` when nothing is listed, or when
/// an old name-only choice matches two rows and Auto Select is off (no guessing which).
pub fn target(snapshot: &DeviceSnapshot, source: Source, saved: &Saved, follow_default: bool) -> Option<Device> {
    if let Some(chosen) = selected(snapshot, source, saved).filter(|_| !(saved.auto && follow_default)) {
        return Some(chosen);
    }
    let available: Vec<Device> = rows(snapshot, source).into_iter().map(|(_, d)| d).filter(|d| !d.is_no_device()).cloned().collect();
    if !saved.auto && saved.id.is_empty() && available.iter().filter(|d| d.name == saved.name).count() > 1 {
        return None;
    }
    let default = match source {
        Source::Mic => &snapshot.default_mic_device.device,
        Source::Speaker => &snapshot.default_speaker_device,
    };
    resolve_device(&available, device_id(Some(default)), Some(&default.name)).cloned().or_else(|| available.first().cloned())
}

/// The host a microphone row is listed under (`NoHost` for none).
pub fn host_of(snapshot: &DeviceSnapshot, device: Option<&Device>) -> String {
    let Some(device) = device else { return NO_HOST.to_owned() };
    let key = capture_key(Some(device));
    rows(snapshot, Source::Mic).into_iter().find(|(_, row)| capture_key(Some(row)) == key).and_then(|(host, _)| host.map(str::to_owned)).unwrap_or_else(|| NO_HOST.to_owned())
}

/// Whether an empty choice must keep the saved name: no identity was saved and two rows
/// carry the name, so it is not known which one was meant.
pub fn ambiguous(snapshot: &DeviceSnapshot, source: Source, device: Option<&Device>, saved: &Saved) -> bool {
    device.is_none() && saved.id.is_empty() && rows(snapshot, source).into_iter().filter(|(_, d)| d.name == saved.name).count() > 1
}

/// The native endpoint inside an identity `<source>:<host>:<native>`.
fn native_part<'a>(id: &'a str, source: Source, host: &str) -> Option<&'a str> {
    let rest = id.strip_prefix(source.as_str())?.strip_prefix(':')?;
    if let Some(native) = rest.strip_prefix(host).and_then(|r| r.strip_prefix(':')) {
        return Some(native).filter(|n| !n.is_empty());
    }
    rest.split_once(':').map(|(_, native)| native).filter(|n| !n.is_empty())
}

/// A microphone choice saved under a host that is not listed any more.
///
/// The Python backend listed every microphone under each PortAudio host (MME,
/// DirectSound, WASAPI, WDM-KS); this crate lists WASAPI only. A choice saved under
/// another host is moved to the one row that is the same device: the row with the same
/// native endpoint ID, or, when the saved identity carried none (a slot identity or no
/// identity), the one row with the same name (MME cuts names at 31 characters).
/// `None` when the saved host is listed, nothing is listed, or no single row matches.
pub fn migrate_mic(snapshot: &DeviceSnapshot, saved: &Saved) -> Option<(String, Device)> {
    if saved.host.is_empty() || saved.host == NO_HOST || snapshot.mics(&saved.host).is_some() {
        return None;
    }
    let all: Vec<(Option<&str>, &Device)> = rows(snapshot, Source::Mic).into_iter().filter(|(_, d)| !d.is_no_device()).collect();
    if all.is_empty() {
        return None;
    }
    let matches: Vec<&(Option<&str>, &Device)> = match native_part(&saved.id, Source::Mic, &saved.host) {
        Some(native) => all.iter().filter(|(_, d)| d.endpoint_id.as_deref() == Some(native)).collect(),
        None if saved.id.is_empty() || saved.id.starts_with("pa:") => {
            if saved.name.is_empty() || saved.name == crate::identity::NO_DEVICE {
                return None;
            }
            all.iter().filter(|(_, d)| same_output(&saved.name, &d.name)).collect()
        }
        None => return None,
    };
    match matches.as_slice() {
        [(Some(host), device)] => Some(((*host).to_owned(), (*device).clone())),
        _ => None,
    }
}

/// A speaker identity saved under another host label (`speaker:<host>:<native>`) that
/// does not match as it is: the one row with the same native endpoint ID.
pub fn migrate_speaker(snapshot: &DeviceSnapshot, saved: &Saved) -> Option<Device> {
    if saved.id.is_empty() || resolve_device(&snapshot.speaker_devices, &saved.id, None).is_some() {
        return None;
    }
    let native = native_part(&saved.id, Source::Speaker, "")?;
    let matches: Vec<&Device> = snapshot.speaker_devices.iter().filter(|d| d.endpoint_id.as_deref() == Some(native)).collect();
    (matches.len() == 1).then(|| matches[0].clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{DefaultMic, Host};

    fn row(name: &str, host: &str, source: &str, native: &str) -> Device {
        Device { name: name.into(), index: 0, endpoint_id: Some(native.into()), id: Some(format!("{source}:{host}:{native}")), ..Device::default() }
    }

    fn snapshot() -> DeviceSnapshot {
        let mics = vec![row("Mic A", "Windows WASAPI", "mic", "{a}"), row("CABLE Output (VB-Audio Virtual Cable)", "Windows WASAPI", "mic", "{c}")];
        let speakers = vec![row("Speakers [Loopback]", "2", "speaker", "{s}")];
        DeviceSnapshot {
            default_mic_device: DefaultMic { host: Host { index: 2, name: "Windows WASAPI".into() }, device: mics[1].clone() },
            mic_devices: vec![("Windows WASAPI".into(), mics)],
            default_speaker_device: speakers[0].clone(),
            speaker_devices: speakers,
        }
    }

    fn saved(host: &str, name: &str, id: &str, auto: bool) -> Saved {
        Saved { host: host.into(), name: name.into(), id: id.into(), auto }
    }

    #[test]
    fn the_saved_choice_wins_unless_auto_select_follows_the_default() {
        let s = snapshot();
        let choice = saved("Windows WASAPI", "Mic A", "mic:Windows WASAPI:{a}", false);
        assert_eq!(target(&s, Source::Mic, &choice, true).unwrap().name, "Mic A");
        let auto = Saved { auto: true, ..choice.clone() };
        assert_eq!(target(&s, Source::Mic, &auto, true).unwrap().name, "CABLE Output (VB-Audio Virtual Cable)");
        assert_eq!(target(&s, Source::Mic, &auto, false).unwrap().name, "Mic A");
        let gone = saved("Windows WASAPI", "Gone", "mic:Windows WASAPI:{gone}", false);
        assert_eq!(target(&s, Source::Mic, &gone, true).unwrap().name, "CABLE Output (VB-Audio Virtual Cable)", "the default replaces a missing device");
    }

    #[test]
    fn mme_choices_move_to_the_same_wasapi_device() {
        let s = snapshot();
        let by_id = migrate_mic(&s, &saved("MME", "Mic A", "mic:MME:{a}", false)).unwrap();
        assert_eq!((by_id.0.as_str(), by_id.1.name.as_str()), ("Windows WASAPI", "Mic A"));
        let cut: String = "CABLE Output (VB-Audio Virtual Cable)".chars().take(31).collect();
        let by_name = migrate_mic(&s, &saved("MME", &cut, "", false)).unwrap();
        assert_eq!(by_name.1.id.as_deref(), Some("mic:Windows WASAPI:{c}"));
        let slot = migrate_mic(&s, &saved("Windows DirectSound", "Mic A", "pa:x:0:mic:Windows DirectSound:3", false)).unwrap();
        assert_eq!(slot.1.name, "Mic A");
        assert_eq!(migrate_mic(&s, &saved("MME", "Mic A", "mic:MME:{other}", false)), None, "a native ID that is gone is not guessed by name");
        assert_eq!(migrate_mic(&s, &saved("Windows WASAPI", "Mic A", "", false)), None, "a listed host is not moved");
        assert_eq!(migrate_mic(&s, &saved("NoHost", "NoDevice", "", false)), None);
    }

    #[test]
    fn speaker_ids_under_another_host_label_move_by_native_id() {
        let s = snapshot();
        assert_eq!(migrate_speaker(&s, &saved("", "Speakers [Loopback]", "speaker:2:{s}", true)), None, "already matches");
        assert_eq!(migrate_speaker(&s, &saved("", "Speakers [Loopback]", "speaker:11:{s}", true)).unwrap().id.as_deref(), Some("speaker:2:{s}"));
        assert_eq!(migrate_speaker(&s, &saved("", "Speakers [Loopback]", "speaker:11:{x}", true)), None);
    }

    #[test]
    fn an_ambiguous_old_name_is_not_guessed() {
        let mut s = snapshot();
        s.mic_devices[0].1.push(row("Mic A", "Windows WASAPI", "mic", "{a2}"));
        let old = saved("Windows WASAPI", "Mic A", "", false);
        assert_eq!(target(&s, Source::Mic, &old, true), None);
        assert!(ambiguous(&s, Source::Mic, None, &old));
        assert_eq!(host_of(&s, Some(&s.mic_devices[0].1[1])), "Windows WASAPI");
        assert_eq!(host_of(&s, None), "NoHost");
    }
}
