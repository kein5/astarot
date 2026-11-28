//! Windows output identities and the virtual-cable rules.
//!
//! Port of the pure parts of [`src-python/models/audio_routing/devices_windows.py`].
//! An output identity is the JSON text `["<host>", "<device name>"]`, exactly as
//! Python's `json.dumps([host, name], ensure_ascii=False)` writes it, because saved
//! settings hold it.
//!
//! [`src-python/models/audio_routing/devices_windows.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/audio_routing/devices_windows.py

/// Drivers that connect a playback device straight to a recording device.
const CABLE_DRIVERS: [&str; 4] = ["cable", "virtual", "steam streaming", "voicemeeter"];
/// Streams a headset's audio. Its microphone is the headset's, not a loop of its speakers.
const HEADSET_DRIVERS: [&str; 1] = ["virtual desktop"];
/// A cable that also brings a headset's microphone to the PC (#1399). Steam Link plays
/// the headset's microphone, as Remote Play plays the client's, into this cable's playback
/// end, so its recording end is the person's own voice. It is still a cable: audio that
/// ASTAROT plays into it comes back out, and that stays refused (`carries_own_voice`).
const HEADSET_MICROPHONE_CABLES: [&str; 1] = ["steam streaming microphone"];
/// MME cuts device names at this many characters.
pub const MME_NAME_LIMIT: usize = 31;
/// PortAudio's name for the WASAPI host.
pub const WASAPI_HOST: &str = "Windows WASAPI";

/// The identity of a device listed under `host`.
pub fn output_identity(host: &str, name: &str) -> String {
    let quote = |text: &str| serde_json::to_string(text).unwrap_or_default();
    format!("[{}, {}]", quote(host), quote(name))
}

/// The device name inside an identity, or the text itself if it is not one.
pub fn device_name(identity: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(identity) {
        Ok(serde_json::Value::Array(items)) if items.len() == 2 => match &items[1] {
            serde_json::Value::String(name) => name.clone(),
            other => other.to_string(),
        },
        _ => identity.to_owned(),
    }
}

/// The host inside an identity, if it is one.
pub fn device_host(identity: &str) -> Option<String> {
    match serde_json::from_str::<serde_json::Value>(identity) {
        Ok(serde_json::Value::Array(items)) if items.len() == 2 => items[0].as_str().map(str::to_owned),
        _ => None,
    }
}

/// The driver name in a device name's last parentheses, lowercased. A name that MME
/// cut off before the closing parenthesis still counts.
fn driver(name: &str) -> String {
    let trimmed = name.trim_end();
    let Some(open) = trimmed.rfind('(') else { return String::new() };
    let rest = &trimmed[open + 1..];
    let inner = rest.strip_suffix(')').unwrap_or(rest);
    if inner.contains(['(', ')']) {
        return String::new();
    }
    inner.trim().to_lowercase()
}

fn cable_driver(driver: &str) -> bool {
    CABLE_DRIVERS.iter().any(|word| driver.contains(word)) && !HEADSET_DRIVERS.iter().any(|word| driver.contains(word))
}

/// Whether audio written to one device comes back out of the other: the two ends of
/// one virtual cable. A sound card's microphone and speakers share a driver name too,
/// so only known virtual drivers count.
pub fn same_virtual_cable(first: &str, second: &str) -> bool {
    let (one, other) = (driver(&device_name(first)), driver(&device_name(second)));
    !one.is_empty() && !other.is_empty() && (one.starts_with(&other) || other.starts_with(&one)) && cable_driver(&one)
}

pub fn is_virtual_cable(identity: &str) -> bool {
    cable_driver(&driver(&device_name(identity)))
}

/// Whether the OS default microphone is refused before any output is known. A cable there
/// usually carries what is played into it, often ASTAROT's own speech. A cable that brings
/// a headset's microphone is the person's voice, so it is taken, and the check against the
/// voice output (`carries_own_voice`) still refuses it when the voice plays into it.
pub fn refused_as_default_microphone(identity: &str) -> bool {
    let driver = driver(&device_name(identity));
    cable_driver(&driver) && !HEADSET_MICROPHONE_CABLES.iter().any(|word| driver.contains(word))
}

/// Whether two names or identities are one device, whichever host lists them.
pub fn same_output(first: &str, second: &str) -> bool {
    let (a, b) = (device_name(first), device_name(second));
    let (short, long) = if b.chars().count() < a.chars().count() { (b, a) } else { (a, b) };
    short == long || (short.chars().count() == MME_NAME_LIMIT && long.starts_with(&short))
}

/// Whether this endpoint is the cable that carries the voice. Only a cable counts:
/// captioning other players from the headphones one listens on is a normal setup.
pub fn carries_own_voice(endpoint: &str, output: &str) -> bool {
    !output.is_empty() && is_virtual_cable(output) && (same_output(endpoint, output) || same_virtual_cable(endpoint, output))
}

/// A stable 32-bit cookie for a Windows identity (`zlib.crc32` of its UTF-8 bytes).
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_text_matches_python_json_dumps() {
        assert_eq!(output_identity("Windows WASAPI", "Speakers (Realtek)"), r#"["Windows WASAPI", "Speakers (Realtek)"]"#);
        assert_eq!(output_identity("MME", "ヘッドホン \"x\"\\"), r#"["MME", "ヘッドホン \"x\"\\"]"#);
        assert_eq!(device_name(&output_identity("MME", "A")), "A");
        assert_eq!(device_name("plain"), "plain");
        assert_eq!(device_host(&output_identity("MME", "A")).as_deref(), Some("MME"));
    }

    #[test]
    fn only_two_ends_of_one_virtual_cable_count_as_feedback() {
        let cases = [
            ("CABLE Output (VB-Audio Virtual Cable)", "CABLE Input (VB-Audio Virtual Cable)", true),
            ("CABLE Output (VB-Audio Virtual Cable)", "CABLE Input (VB-Audio Virtual C", true),
            ("Microphone (Realtek Audio)", "Speakers (Realtek Audio)", false),
            ("CABLE Output (VB-Audio Virtual Cable)", "Speakers (Realtek Audio)", false),
            ("Microphone", "Speakers", false),
            ("VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)", "VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)", true),
        ];
        for (first, second, expected) in cases {
            assert_eq!(same_virtual_cable(first, second), expected, "{first} / {second}");
            assert_eq!(same_virtual_cable(&output_identity("Windows WASAPI", first), second), expected);
        }
    }

    #[test]
    fn a_headset_streamed_to_the_pc_keeps_its_own_microphone() {
        assert!(!is_virtual_cable("Microphone (Virtual Desktop Audio)"));
        assert!(is_virtual_cable("CABLE Output (VB-Audio Virtual Cable)"));
        assert!(is_virtual_cable("Headset (Steam Streaming Microphone)"));
    }

    #[test]
    fn the_default_microphone_takes_a_steam_link_headset_but_refuses_other_cables() {
        // #1399: Steam Link brings the headset's microphone through Steam's microphone cable.
        let headset = ["Microphone (Steam Streaming Microphone)", "Headset (Steam Streaming Microphone)", "マイク (Steam Streaming Microphone)"];
        let cables = [
            "CABLE Output (VB-Audio Virtual Cable)",
            "CABLE-A Output (VB-Audio Cable A)",
            "VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)",
            "VoiceMeeter Aux Output (VB-Audio VoiceMeeter AUX VAIO)",
            // Steam's other cable carries the PC's own sound, not a microphone.
            "Microphone (Steam Streaming Speakers)",
        ];
        let hardware = ["Microphone (Realtek Audio)", "Microphone (Virtual Desktop Audio)", "Microphone", ""];
        for name in headset {
            assert!(is_virtual_cable(name), "{name} stays a cable for the feedback checks");
            assert!(!refused_as_default_microphone(name), "{name}");
            assert!(!refused_as_default_microphone(&output_identity(WASAPI_HOST, name)), "{name}");
        }
        for name in cables {
            assert!(refused_as_default_microphone(name), "{name}");
            assert!(refused_as_default_microphone(&output_identity(WASAPI_HOST, name)), "{name}");
        }
        for name in hardware {
            assert!(!refused_as_default_microphone(name), "{name}");
        }
        // The exception only narrows the cable rule: nothing that is not a cable is refused.
        for name in headset.iter().chain(&cables).chain(&hardware) {
            assert!(!refused_as_default_microphone(name) || is_virtual_cable(name), "{name}");
        }
    }

    #[test]
    fn the_voice_played_into_steams_microphone_cable_is_still_feedback() {
        let headset = "Microphone (Steam Streaming Microphone)";
        let into_the_same_cable = output_identity(WASAPI_HOST, "Speakers (Steam Streaming Microphone)");
        assert!(carries_own_voice(headset, &into_the_same_cable), "captions refuse it");
        assert!(same_virtual_cable(headset, &into_the_same_cable), "voice conversion refuses it");
        for elsewhere in ["Speakers (Steam Streaming Speakers)", "CABLE Input (VB-Audio Virtual Cable)", "Headphones (Realtek Audio)"] {
            let output = output_identity(WASAPI_HOST, elsewhere);
            assert!(!carries_own_voice(headset, &output), "{elsewhere}");
            assert!(!same_virtual_cable(headset, &output), "{elsewhere}");
        }
    }

    #[test]
    fn one_device_is_recognised_across_hosts() {
        let long = "CABLE Input (VB-Audio Virtual Cable)";
        let cut: String = long.chars().take(MME_NAME_LIMIT).collect();
        assert!(same_output(&output_identity("Windows WASAPI", long), &output_identity("MME", &cut)));
        assert!(same_output(long, long));
        assert!(!same_output(long, "CABLE Input (VB-Audio"));
        assert!(!same_output("Speakers (Realtek)", "Headphones (Realtek)"));
    }

    #[test]
    fn captions_refuse_only_the_cable_that_carries_the_voice() {
        let voice = output_identity("Windows WASAPI", "CABLE Input (VB-Audio Virtual Cable)");
        assert!(carries_own_voice("CABLE Output (VB-Audio Virtual Cable)", &voice));
        assert!(carries_own_voice(&voice, &voice));
        assert!(!carries_own_voice("Speakers (Realtek)", &voice));
        assert!(!carries_own_voice("", ""));
        let headphones = output_identity("Windows WASAPI", "Headphones (Realtek)");
        assert!(!carries_own_voice(&headphones, &headphones));
    }

    #[test]
    fn crc32_matches_zlib() {
        assert_eq!(crc32(b""), 0);
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }
}
