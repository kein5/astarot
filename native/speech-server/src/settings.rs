//! The saved model choices. They never record that a server should be running.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::{codes, Code};

/// A server of the app. `AsrListening` is Listening's recognition server, started only when
/// Listening has a model of its own (#1242): it has no settings of its own, and runs the `asr`
/// profile's settings with Listening's model ([`start_options`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Profile {
    Japanese,
    Multilingual,
    Asr,
    AsrListening,
}

impl Profile {
    pub const ALL: [Profile; 4] = [Profile::Japanese, Profile::Multilingual, Profile::Asr, Profile::AsrListening];
    /// The profiles of the settings file, one row each.
    pub const SETTINGS: [Profile; 3] = [Profile::Japanese, Profile::Multilingual, Profile::Asr];

    pub fn name(self) -> &'static str {
        match self {
            Profile::Japanese => "japanese",
            Profile::Multilingual => "multilingual",
            Profile::Asr => "asr",
            Profile::AsrListening => "asr_listening",
        }
    }

    /// A recognition server (and not a speech one): Mic input's and Listening's.
    pub fn recognizes(self) -> bool {
        matches!(self, Profile::Asr | Profile::AsrListening)
    }

    /// The settings row a server runs: Listening's server runs the `asr` one.
    pub fn settings_row(self) -> Profile {
        if self == Profile::AsrListening { Profile::Asr } else { self }
    }

    pub fn from_name(name: &str) -> Result<Profile, Code> {
        Profile::ALL.into_iter().find(|profile| profile.name() == name).ok_or(codes::PROFILE_INVALID)
    }

    pub(crate) fn index(self) -> usize {
        self as usize
    }
}

/// One profile's choices. `diarization_model` is optional and for `asr` only. So is
/// `listening_model`, the recognition model of Listening (the speaker source, #1242): empty, Listening
/// takes `model`, the one Mic input takes, from the same server, as settings saved before it did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileSettings {
    pub model: String,
    pub vad_model: String,
    pub diarization_model: String,
    pub listening_model: String,
    pub voice_file: String,
    pub device: String,
    pub low_latency: bool,
}

impl Default for ProfileSettings {
    fn default() -> Self {
        ProfileSettings {
            model: String::new(),
            vad_model: String::new(),
            diarization_model: String::new(),
            listening_model: String::new(),
            voice_file: String::new(),
            device: "auto".into(),
            low_latency: false,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Settings {
    profiles: [ProfileSettings; 3],
}

impl ProfileSettings {
    /// The recognition model of Listening: its own, or Mic input's when it has none (#1242).
    pub fn listening_model(&self) -> &str {
        if self.listening_model.is_empty() { &self.model } else { &self.listening_model }
    }

    /// Whether Listening has a recognition model of its own, another file than Mic input's, which a
    /// second server loads (#1242). The same file, or none of its own, is one server for both.
    pub fn listening_apart(&self) -> bool {
        !self.listening_model.is_empty() && self.listening_model != self.model
    }
}

impl Settings {
    /// A server's settings row: Listening's server reads the `asr` one.
    pub fn profile(&self, profile: Profile) -> &ProfileSettings {
        &self.profiles[profile.settings_row().index()]
    }

    /// The form the settings file holds.
    pub fn to_json(&self) -> Value {
        let mut profiles = Map::new();
        for profile in Profile::SETTINGS {
            let row = self.profile(profile);
            let mut item = Map::new();
            item.insert("model".into(), row.model.clone().into());
            item.insert("vad_model".into(), row.vad_model.clone().into());
            item.insert("diarization_model".into(), row.diarization_model.clone().into());
            item.insert("listening_model".into(), row.listening_model.clone().into());
            item.insert("voice_file".into(), row.voice_file.clone().into());
            item.insert("device".into(), row.device.clone().into());
            item.insert("low_latency".into(), row.low_latency.into());
            profiles.insert(profile.name().into(), Value::Object(item));
        }
        let mut root = Map::new();
        root.insert("version".into(), 1.into());
        root.insert("profiles".into(), Value::Object(profiles));
        Value::Object(root)
    }
}

/// What a start passes to the server: the settings of one profile, files checked.
pub type StartOptions = ProfileSettings;

/// `auto`, `cpu`, `gpu`, or one of the names `speech devices` prints (Vulkan0..Vulkan99).
pub fn device_allowed(device: &str) -> bool {
    matches!(device, "auto" | "cpu" | "gpu") || is_named_gpu(device)
}

pub fn is_named_gpu(device: &str) -> bool {
    device
        .strip_prefix("Vulkan")
        .is_some_and(|digits| (1..=2).contains(&digits.len()) && digits.bytes().all(|byte| byte.is_ascii_digit()))
}

const KEYS: [&str; 7] = ["model", "vad_model", "diarization_model", "listening_model", "voice_file", "device", "low_latency"];

fn text(row: &Map<String, Value>, key: &str, default: &str) -> Result<String, Code> {
    match row.get(key) {
        None => Ok(default.to_owned()),
        Some(Value::String(value)) if value.chars().count() <= 4096 && !value.chars().any(|c| (c as u32) < 32) => {
            Ok(value.clone())
        }
        Some(_) => Err(codes::SETTINGS_INVALID),
    }
}

pub fn normalize_settings(value: &Value) -> Result<Settings, Code> {
    let invalid = codes::SETTINGS_INVALID;
    let root = value.as_object().ok_or(invalid)?;
    if root.keys().any(|key| key != "version" && key != "profiles") {
        return Err(invalid);
    }
    // An integer 1 only: `true` and `1.0` are other types.
    if let Some(version) = root.get("version") {
        if !(version.is_u64() && version.as_u64() == Some(1)) {
            return Err(invalid);
        }
    }
    let empty = Map::new();
    let given = match root.get("profiles") {
        None => &empty,
        Some(Value::Object(given)) => given,
        Some(_) => return Err(invalid),
    };
    if given.keys().any(|key| !Profile::SETTINGS.iter().any(|profile| profile.name() == key)) {
        return Err(invalid);
    }
    let mut result = Settings::default();
    for profile in Profile::SETTINGS {
        let row = match given.get(profile.name()) {
            None => &empty,
            Some(Value::Object(row)) => row,
            Some(_) => return Err(invalid),
        };
        if row.keys().any(|key| !KEYS.contains(&key.as_str())) {
            return Err(invalid);
        }
        let low_latency = match row.get("low_latency") {
            None => false,
            Some(Value::Bool(value)) => *value,
            Some(_) => return Err(invalid),
        };
        let item = ProfileSettings {
            model: text(row, "model", "")?,
            vad_model: text(row, "vad_model", "")?,
            diarization_model: text(row, "diarization_model", "")?,
            listening_model: text(row, "listening_model", "")?,
            voice_file: text(row, "voice_file", "")?,
            device: text(row, "device", "auto")?,
            low_latency,
        };
        let misplaced = if profile == Profile::Asr {
            !item.voice_file.is_empty()
        } else {
            !item.vad_model.is_empty() || !item.diarization_model.is_empty() || !item.listening_model.is_empty()
        };
        if (low_latency && profile != Profile::Japanese) || !device_allowed(&item.device) || misplaced {
            return Err(invalid);
        }
        result.profiles[profile.index()] = item;
    }
    Ok(result)
}

fn expand_user(value: &str) -> PathBuf {
    if value == "~" || value.starts_with("~/") || (cfg!(windows) && value.starts_with("~\\")) {
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
        if let Some(home) = home.filter(|home| !home.is_empty()) {
            return Path::new(&home).join(value[1..].trim_start_matches(['/', '\\']));
        }
    }
    PathBuf::from(value)
}

/// The resolved path of an existing regular `.gguf` file that begins with the GGUF magic.
fn gguf(value: &str) -> Result<String, Code> {
    let checked = || -> Option<String> {
        if value.is_empty() {
            return None;
        }
        let path = std::fs::canonicalize(expand_user(value)).ok()?;
        let named = path.extension().is_some_and(|suffix| suffix.eq_ignore_ascii_case("gguf"));
        if !named || !path.metadata().ok()?.is_file() {
            return None;
        }
        let mut magic = [0u8; 4];
        File::open(&path).ok()?.read_exact(&mut magic).ok()?;
        if &magic != b"GGUF" {
            return None;
        }
        path.into_os_string().into_string().ok()
    };
    checked().ok_or(codes::MODEL_INVALID)
}

/// The options to start `profile` with, or the code of what is wrong with its files.
///
/// The recognition servers share the `asr` profile's VAD and device. While Listening has a model
/// of its own (#1242), Mic input's server loads `model` and Listening's loads `listening_model`;
/// the diarization model, which only Listening asks for, goes with Listening's. Otherwise Mic
/// input's server is the one for both, with the diarization model, and Listening's has no model
/// to start (`speech_server_model_invalid`).
pub fn start_options(settings: &Value, profile: Profile) -> Result<StartOptions, Code> {
    let mut row = normalize_settings(settings)?.profile(profile).clone();
    if profile.recognizes() {
        let apart = row.listening_apart();
        if profile == Profile::AsrListening {
            if !apart {
                return Err(codes::MODEL_INVALID);
            }
            row.model = std::mem::take(&mut row.listening_model);
        } else {
            row.listening_model.clear();
            if apart {
                row.diarization_model.clear();
            }
        }
        row.model = gguf(&row.model)?;
        row.vad_model = gguf(&row.vad_model)?;
        if !row.diarization_model.is_empty() {
            row.diarization_model = gguf(&row.diarization_model)?;
        }
    } else {
        row.model = gguf(&row.model)?;
        if !row.voice_file.is_empty() {
            row.voice_file = gguf(&row.voice_file)?;
        }
    }
    Ok(row)
}
