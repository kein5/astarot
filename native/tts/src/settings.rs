//! Validated speech settings. Chat and microphone speech are separately opt-in.
//!
//! The saved format is the Python `VoiceSettings` dictionary: every field is a
//! string, unknown keys are rejected and missing keys take the defaults below.

use serde::Serialize;
use serde_json::{Map, Value};

use crate::error::TtsError;
use crate::events::{Source, SpeechMessageEvent};
use crate::model_options::{SynthesisOptions, SAFE_SEED_MAX};

/// A settings or request problem. The message is for developers only; it never
/// reaches status, logs or the UI, because a caller may have put input in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SettingsError(pub &'static str);

impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for SettingsError {}

impl From<SettingsError> for TtsError {
    fn from(error: SettingsError) -> Self {
        TtsError::Unavailable(error.0)
    }
}

/// Python's `str.isspace()`: Unicode White_Space plus the four ASCII separators.
pub(crate) fn py_is_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// Python's `str.strip()` emptiness test.
pub(crate) fn is_blank(value: &str) -> bool {
    value.chars().all(py_is_space)
}

/// Control characters other than line breaks and tabs, or DEL.
pub(crate) fn has_unsafe_control(value: &str) -> bool {
    value.chars().any(|c| ((c as u32) < 32 && !matches!(c, '\r' | '\n' | '\t')) || c as u32 == 127)
}

fn has_control(value: &str) -> bool {
    value.chars().any(|c| (c as u32) < 32)
}

/// Accept only a plain local HTTP server and return its canonical base URL,
/// `http://127.0.0.1:PORT` or `http://[::1]:PORT`.
///
/// This follows Python's `urllib.parse.urlsplit` for the inputs that matter:
/// leading control characters and spaces are ignored, tabs and line breaks are
/// removed, and a missing port is 80.
pub fn local_url(value: &str) -> Result<String, SettingsError> {
    const INVALID: SettingsError = SettingsError("Use http://127.0.0.1:PORT (local server only)");
    let cleaned: String = value.trim_start_matches(|c: char| (c as u32) <= 32).chars().filter(|c| !matches!(c, '\t' | '\r' | '\n')).collect();
    let (scheme, rest) = split_scheme(&cleaned).ok_or(INVALID)?;
    if scheme != "http" {
        return Err(INVALID);
    }
    let rest = rest.strip_prefix("//").ok_or(INVALID)?;
    let netloc_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (netloc, tail) = rest.split_at(netloc_end);
    let (tail, fragment) = tail.split_once('#').unwrap_or((tail, ""));
    let (path, query) = tail.split_once('?').unwrap_or((tail, ""));
    if !query.is_empty() || !fragment.is_empty() || !matches!(path, "" | "/") {
        return Err(INVALID);
    }
    if netloc.contains('[') != netloc.contains(']') {
        return Err(INVALID);
    }
    let (userinfo, hostinfo) = match netloc.rsplit_once('@') {
        Some((userinfo, hostinfo)) => (Some(userinfo), hostinfo),
        None => (None, netloc),
    };
    if let Some(userinfo) = userinfo {
        let (username, password) = userinfo.split_once(':').unwrap_or((userinfo, ""));
        if !username.is_empty() || !password.is_empty() {
            return Err(INVALID);
        }
    }
    let (hostname, port) = match hostinfo.split_once('[') {
        Some((_, bracketed)) => {
            let (hostname, after) = bracketed.split_once(']').unwrap_or((bracketed, ""));
            (hostname, after.split_once(':').map(|(_, port)| port).unwrap_or(""))
        }
        None => hostinfo.split_once(':').unwrap_or((hostinfo, "")),
    };
    let hostname = hostname.to_ascii_lowercase();
    if !matches!(hostname.as_str(), "127.0.0.1" | "localhost" | "::1") {
        return Err(INVALID);
    }
    let port: u32 = if port.is_empty() {
        80
    } else if port.bytes().all(|b| b.is_ascii_digit()) {
        port.parse().map_err(|_| SettingsError("Invalid port"))?
    } else {
        return Err(SettingsError("Invalid port"));
    };
    if !(1..=65535).contains(&port) {
        return Err(SettingsError("Invalid port"));
    }
    let host = if hostname == "::1" { "[::1]" } else { "127.0.0.1" };
    Ok(format!("http://{host}:{port}"))
}

fn split_scheme(url: &str) -> Option<(String, &str)> {
    let colon = url.find(':')?;
    let scheme = &url[..colon];
    let mut chars = scheme.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic() || !scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')) {
        return None;
    }
    Some((scheme.to_ascii_lowercase(), &url[colon + 1..]))
}

/// Explicit language selection; never guessed from a script, never `auto`.
const LANGUAGES: &[(&str, &str)] = &[
    ("Japanese", "ja"),
    ("English", "en"),
    ("Chinese", "zh"),
    ("Korean", "ko"),
    ("Chinese Simplified", "zh"),
    ("Chinese Traditional", "zh"),
    ("German", "de"),
    ("French", "fr"),
    ("Russian", "ru"),
    ("Portuguese", "pt"),
    ("Spanish", "es"),
    ("Italian", "it"),
];

/// The speech.cpp language tag for a UI language name or a tag.
pub fn language_tag(language: &str) -> Result<&'static str, SettingsError> {
    LANGUAGES.iter().find(|(name, tag)| *tag == language || *name == language).map(|(_, tag)| *tag).ok_or(SettingsError("Unsupported or unknown speech language"))
}

/// Which platform's rules apply. Windows has no managed route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Other,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(windows) {
            Platform::Windows
        } else {
            Platform::Other
        }
    }
}

/// Gives a running bundled server's base URL for a role.
pub type ServerResolver<'a> = &'a dyn Fn(&str) -> Result<String, TtsError>;

/// Engines that can read Japanese (ADR-008). The app only connects to an
/// installed engine on this PC; it never installs, starts or bundles one.
pub const ENGINES: &[&str] = &["speechcpp", "voicevox", "coeiroink", "aivis", "sharevox"];

/// The speech.cpp engine.
pub const SPEECHCPP: &str = "speechcpp";

/// `[0-9]{1,9}` or `[0-9A-Fa-f-]{1,64}:[0-9]{1,9}`: a style id, or a speaker UUID and style id.
pub fn valid_engine_voice_id(id: &str) -> bool {
    let digits = |part: &str| (1..=9).contains(&part.len()) && part.bytes().all(|b| b.is_ascii_digit());
    match id.split_once(':') {
        None => digits(id),
        Some((speaker, style)) => (1..=64).contains(&speaker.len()) && speaker.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') && digits(style),
    }
}

/// A voice saved for an installed engine: its id plus the names it had, to
/// find it again if an engine update changes the id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineVoice {
    pub id: String,
    pub speaker: String,
    pub style: String,
}

/// The sample rates COEIROINK's `outputSamplingRate` is offered with.
pub const COEIROINK_RATES: [u32; 4] = [16_000, 24_000, 44_100, 48_000];

/// How COEIROINK v2 reads (`/v1/synthesis`): every field is required by the engine.
/// The defaults are the values the app sent before they could be set.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CoeiroinkParams {
    pub speed: f64,
    pub volume: f64,
    pub pitch: f64,
    pub intonation: f64,
    /// Silence before and after the speech, in seconds.
    pub pre_phoneme: f64,
    pub post_phoneme: f64,
    pub sampling_rate: u32,
}

// Only built from validated, finite numbers.
impl Eq for CoeiroinkParams {}

impl Default for CoeiroinkParams {
    fn default() -> Self {
        Self { speed: 1.0, volume: 1.0, pitch: 0.0, intonation: 1.0, pre_phoneme: 0.1, post_phoneme: 0.1, sampling_rate: 24_000 }
    }
}

/// `(field, minimum, maximum)` of the saved COEIROINK numbers.
const COEIROINK_RANGES: [(&str, f64, f64); 6] = [
    ("coeiroink_speed", 0.5, 2.0),
    ("coeiroink_volume", 0.0, 2.0),
    ("coeiroink_pitch", -0.15, 0.15),
    ("coeiroink_intonation", 0.0, 2.0),
    ("coeiroink_pre_phoneme", 0.0, 1.5),
    ("coeiroink_post_phoneme", 0.0, 1.5),
];

/// The engines with the VOICEVOX API, whose reading is set with their AudioQuery's Scale fields.
pub const AUDIO_QUERY_ENGINES: [&str; 3] = ["voicevox", "aivis", "sharevox"];

/// How an engine with the VOICEVOX API reads: the Scale fields of its AudioQuery, the only part
/// of the query the app may change (ADR-008 5.2). The defaults are the engine's own, and a field
/// left at its default is not written, so a query whose fields are all at their defaults goes back
/// to the engine byte for byte, as before these could be set.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AudioQueryScales {
    pub speed: f64,
    pub volume: f64,
    pub pitch: f64,
    pub intonation: f64,
}

// Only built from validated, finite numbers.
impl Eq for AudioQueryScales {}

impl Default for AudioQueryScales {
    fn default() -> Self {
        Self { speed: 1.0, volume: 1.0, pitch: 0.0, intonation: 1.0 }
    }
}

impl AudioQueryScales {
    /// `(AudioQuery field, value)` of the fields set away from their default.
    pub fn changed(&self) -> Vec<(&'static str, f64)> {
        let defaults = Self::default();
        [("speedScale", self.speed, defaults.speed), ("volumeScale", self.volume, defaults.volume),
            ("pitchScale", self.pitch, defaults.pitch), ("intonationScale", self.intonation, defaults.intonation)]
            .into_iter()
            .filter(|(_, value, default)| value != default)
            .map(|(field, value, _)| (field, value))
            .collect()
    }
}

/// `(suffix, minimum, maximum)` of the saved Scale numbers, `<engine>_<suffix>` for each of
/// [`AUDIO_QUERY_ENGINES`]: the ranges of VOICEVOX's own sliders, which AivisSpeech and
/// SHAREVOX share.
const AUDIO_QUERY_RANGES: [(&str, f64, f64); 4] = [
    ("speed", 0.5, 2.0),
    ("volume", 0.0, 2.0),
    ("pitch", -0.15, 0.15),
    ("intonation", 0.0, 2.0),
];

/// A plain decimal such as `1`, `0.25` or `-0.05` within `min..=max`. No exponent, `inf` or
/// `NaN`: the text goes to the engine as a number.
fn decimal_in(text: &str, min: f64, max: f64) -> Option<f64> {
    let digits = text.strip_prefix('-').unwrap_or(text);
    let (whole, fraction) = digits.split_once('.').unwrap_or((digits, ""));
    let shape_ok = text.len() <= 16 && !whole.is_empty() && whole.bytes().all(|b| b.is_ascii_digit()) && fraction.bytes().all(|b| b.is_ascii_digit()) && (!digits.contains('.') || !fraction.is_empty());
    let value: f64 = text.parse().ok().filter(|_| shape_ok)?;
    (value.is_finite() && (min..=max).contains(&value)).then_some(value)
}

/// One speech request chosen from the settings for one message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeechRequest {
    pub url: String,
    /// The speech.cpp voice, or the installed engine's voice id.
    pub voice: String,
    pub language: &'static str,
    pub text: String,
    /// `speechcpp`, or the installed engine that reads this Japanese text.
    pub engine: &'static str,
    /// The saved voice, for an installed engine.
    pub engine_voice: Option<EngineVoice>,
    /// How COEIROINK reads, when it is the engine.
    pub coeiroink: Option<CoeiroinkParams>,
    /// How an engine with the VOICEVOX API reads, when one is the engine.
    pub audio_query: Option<AudioQueryScales>,
}

impl SpeechRequest {
    fn speechcpp(url: String, voice: &str, language: &'static str, text: String) -> Self {
        Self { url, voice: voice.to_owned(), language, text, engine: SPEECHCPP, engine_voice: None, coeiroink: None, audio_query: None }
    }
}

macro_rules! voice_settings {
    ($($field:ident = $default:literal,)*) => {
        #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
        pub struct VoiceSettings {
            $(pub $field: String,)*
        }

        impl Default for VoiceSettings {
            fn default() -> Self {
                Self { $($field: $default.to_owned(),)* }
            }
        }

        impl VoiceSettings {
            const FIELDS: &'static [&'static str] = &[$(stringify!($field),)*];

            fn set(&mut self, key: &str, value: String) {
                match key {
                    $(stringify!($field) => self.$field = value,)*
                    _ => unreachable!("checked against FIELDS"),
                }
            }
        }
    };
}

voice_settings! {
    mode = "off",                  // off | original | translated (chat only)
    mic_mode = "off",              // off | translated (Realtime microphone finals only)
    direct_policy = "suppress",    // suppress the managed direct voice | mix explicitly
    target_slot = "1",
    // external | bundled. New settings use the bundled server, so the default engine
    // ("AI voice (speech.cpp)") only needs its model (#566); saved choices are kept.
    japanese_server = "bundled",
    japanese_url = "http://127.0.0.1:8080",
    japanese_voice = "none",
    multilingual_url = "",
    multilingual_voice = "ryan",
    multilingual_server = "bundled",
    japanese_seed = "",
    multilingual_seed = "",
    japanese_instructions = "",
    multilingual_instructions = "",
    output_device = "",
    routing = "external",          // external | managed (Linux daemon-owned route)
    monitor = "off",               // off | on: an optional local copy of the speech
    monitor_device = "",           // "" is the OS default output
    monitor_volume = "100",        // 0-100 percent, attenuation only
    conversion = "off",            // off | on: speak through the running voice conversion (ADR-007)
    // Which engine reads Japanese, its URL, and the voice chosen in it (ADR-008).
    japanese_engine = "speechcpp", // speechcpp | voicevox | coeiroink | aivis | sharevox
    voicevox_url = "http://127.0.0.1:50021",
    coeiroink_url = "http://127.0.0.1:50032",
    aivis_url = "http://127.0.0.1:10101",
    sharevox_url = "http://127.0.0.1:50025",
    engine_voice_id = "",
    engine_voice_speaker = "",
    engine_voice_style = "",
    // How COEIROINK reads (`/v1/synthesis`), as plain decimals; see COEIROINK_RANGES.
    coeiroink_speed = "1.0",
    coeiroink_volume = "1.0",
    coeiroink_pitch = "0.0",
    coeiroink_intonation = "1.0",
    coeiroink_pre_phoneme = "0.1",
    coeiroink_post_phoneme = "0.1",
    coeiroink_sampling_rate = "24000", // one of COEIROINK_RATES
    // How the engines with the VOICEVOX API read (their AudioQuery's Scale fields), as plain
    // decimals, one set per engine; see AUDIO_QUERY_RANGES.
    voicevox_speed = "1.0",
    voicevox_volume = "1.0",
    voicevox_pitch = "0.0",
    voicevox_intonation = "1.0",
    aivis_speed = "1.0",
    aivis_volume = "1.0",
    aivis_pitch = "0.0",
    aivis_intonation = "1.0",
    sharevox_speed = "1.0",
    sharevox_volume = "1.0",
    sharevox_pitch = "0.0",
    sharevox_intonation = "1.0",
}

/// The managed route's TTS input (`astarot_audio_routing::graph::TTS_SINK`, which this crate does
/// not depend on; the tests hold the two to the route's prefix).
pub const MANAGED_TTS: &str = "astarot.managed.tts";

impl VoiceSettings {
    /// The output that carries speech: the managed route or the chosen device.
    pub fn playback_device(&self) -> &str {
        if self.routing == "managed" {
            MANAGED_TTS
        } else {
            &self.output_device
        }
    }

    /// `(device, volume)` when the monitor is enabled.
    pub fn monitor_choice(&self) -> Option<(&str, u8)> {
        (self.monitor == "on").then(|| (self.monitor_device.as_str(), self.monitor_volume.parse().unwrap_or(100)))
    }

    /// Validate a saved settings object with the current platform's rules.
    pub fn from_value(value: &Value) -> Result<Self, SettingsError> {
        Self::from_value_on(value, Platform::current())
    }

    pub fn from_value_on(value: &Value, platform: Platform) -> Result<Self, SettingsError> {
        let object = value.as_object().ok_or(SettingsError("Invalid voice settings"))?;
        if object.keys().any(|key| !Self::FIELDS.contains(&key.as_str())) {
            return Err(SettingsError("Invalid voice settings"));
        }
        let mut settings = Self::default();
        for (key, value) in object {
            let value = value.as_str().ok_or(SettingsError("Voice settings must be strings"))?;
            settings.set(key, value.to_owned());
        }
        settings.validate(platform)?;
        Ok(settings)
    }

    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("strings always serialize")
    }

    fn validate(&self, platform: Platform) -> Result<(), SettingsError> {
        for (seed, instruction) in [(&self.japanese_seed, &self.japanese_instructions), (&self.multilingual_seed, &self.multilingual_instructions)] {
            if !seed.is_empty() && (!(1..=16).contains(&seed.len()) || !seed.bytes().all(|b| b.is_ascii_digit()) || seed.parse::<u64>().map_or(true, |seed| seed > SAFE_SEED_MAX)) {
                return Err(SettingsError("Invalid seed"));
            }
            if instruction.chars().count() > 4000 || has_unsafe_control(instruction) {
                return Err(SettingsError("Invalid instructions"));
            }
        }
        if !matches!(self.mode.as_str(), "off" | "original" | "translated") || !matches!(self.target_slot.as_str(), "1" | "2" | "3") {
            return Err(SettingsError("Invalid speech mode or translation slot"));
        }
        if !matches!(self.mic_mode.as_str(), "off" | "translated") || !matches!(self.direct_policy.as_str(), "suppress" | "mix") {
            return Err(SettingsError("Invalid microphone speech mode or direct voice policy"));
        }
        if !matches!(self.routing.as_str(), "external" | "managed") {
            return Err(SettingsError("Invalid routing mode"));
        }
        // The conversion has one input: speech replaces the microphone, it cannot mix with it.
        if !matches!(self.conversion.as_str(), "off" | "on") || (self.conversion == "on" && self.direct_policy == "mix") {
            return Err(SettingsError("Invalid speech-through-conversion choice"));
        }
        if [&self.japanese_server, &self.multilingual_server].iter().any(|server| !matches!(server.as_str(), "external" | "bundled")) {
            return Err(SettingsError("Invalid speech server selection"));
        }
        local_url(&self.japanese_url)?;
        if !self.multilingual_url.is_empty() {
            local_url(&self.multilingual_url)?;
        }
        if !ENGINES.contains(&self.japanese_engine.as_str()) {
            return Err(SettingsError("Unknown speech engine"));
        }
        for url in [&self.voicevox_url, &self.coeiroink_url, &self.aivis_url, &self.sharevox_url] {
            local_url(url)?;
        }
        if !self.engine_voice_id.is_empty() && !valid_engine_voice_id(&self.engine_voice_id) {
            return Err(SettingsError("Invalid engine voice"));
        }
        for name in [&self.engine_voice_speaker, &self.engine_voice_style] {
            if name.chars().count() > 128 || name.chars().any(|c| (c as u32) < 32 || c as u32 == 127) {
                return Err(SettingsError("Invalid engine voice name"));
            }
        }
        if COEIROINK_RANGES.iter().any(|(field, min, max)| decimal_in(self.coeiroink_text(field), *min, *max).is_none())
            || !COEIROINK_RATES.iter().any(|rate| rate.to_string() == self.coeiroink_sampling_rate)
        {
            return Err(SettingsError("Invalid COEIROINK reading settings"));
        }
        if AUDIO_QUERY_ENGINES.iter().any(|engine| AUDIO_QUERY_RANGES.iter().any(|(name, min, max)| decimal_in(self.scale_text(engine, name), *min, *max).is_none())) {
            return Err(SettingsError("Invalid reading settings"));
        }
        for voice in [&self.japanese_voice, &self.multilingual_voice] {
            if is_blank(voice) || voice.chars().count() > 128 || has_control(voice) {
                return Err(SettingsError("Invalid voice name"));
            }
        }
        if self.output_device.chars().count() > 512 || has_control(&self.output_device) {
            return Err(SettingsError("Invalid output device"));
        }
        let volume_ok = (1..=3).contains(&self.monitor_volume.len()) && self.monitor_volume.bytes().all(|b| b.is_ascii_digit()) && self.monitor_volume.parse::<u32>().is_ok_and(|volume| volume <= 100);
        if !matches!(self.monitor.as_str(), "off" | "on") || self.monitor_device.chars().count() > 512 || has_control(&self.monitor_device) || !volume_ok {
            return Err(SettingsError("Invalid monitor output"));
        }
        // The monitor must never be (or feed) the virtual microphone itself.
        let monitor_device = self.monitor_device.as_str();
        if self.monitor == "on"
            && !monitor_device.is_empty()
            && (astarot_app_identity::audio_route::is_route_name(monitor_device) || monitor_device == self.playback_device())
        {
            return Err(SettingsError("Monitor output must differ from the virtual microphone output"));
        }
        if (self.mode != "off" || self.mic_mode != "off") && is_blank(self.playback_device()) {
            return Err(SettingsError("Select a virtual microphone output before enabling TTS"));
        }
        // Windows has no managed route: its output device silences the voice itself.
        if self.mic_mode != "off" && self.direct_policy == "suppress" && self.routing != "managed" && platform != Platform::Windows {
            return Err(SettingsError("Direct voice suppression requires managed routing"));
        }
        Ok(())
    }

    fn coeiroink_text(&self, field: &str) -> &str {
        match field {
            "coeiroink_speed" => &self.coeiroink_speed,
            "coeiroink_volume" => &self.coeiroink_volume,
            "coeiroink_pitch" => &self.coeiroink_pitch,
            "coeiroink_intonation" => &self.coeiroink_intonation,
            "coeiroink_pre_phoneme" => &self.coeiroink_pre_phoneme,
            _ => &self.coeiroink_post_phoneme,
        }
    }

    /// How COEIROINK reads. Validated settings always parse; anything else is the default.
    pub fn coeiroink_params(&self) -> CoeiroinkParams {
        let defaults = CoeiroinkParams::default();
        let number = |field: &str, fallback: f64| {
            let (_, min, max) = COEIROINK_RANGES.iter().find(|(name, _, _)| *name == field).expect("a listed field");
            decimal_in(self.coeiroink_text(field), *min, *max).unwrap_or(fallback)
        };
        CoeiroinkParams {
            speed: number("coeiroink_speed", defaults.speed),
            volume: number("coeiroink_volume", defaults.volume),
            pitch: number("coeiroink_pitch", defaults.pitch),
            intonation: number("coeiroink_intonation", defaults.intonation),
            pre_phoneme: number("coeiroink_pre_phoneme", defaults.pre_phoneme),
            post_phoneme: number("coeiroink_post_phoneme", defaults.post_phoneme),
            sampling_rate: self.coeiroink_sampling_rate.parse().ok().filter(|rate| COEIROINK_RATES.contains(rate)).unwrap_or(defaults.sampling_rate),
        }
    }

    /// The saved text of `<engine>_<name>`, one of the Scale numbers of [`AUDIO_QUERY_ENGINES`].
    fn scale_text(&self, engine: &str, name: &str) -> &str {
        match (engine, name) {
            ("voicevox", "speed") => &self.voicevox_speed,
            ("voicevox", "volume") => &self.voicevox_volume,
            ("voicevox", "pitch") => &self.voicevox_pitch,
            ("voicevox", _) => &self.voicevox_intonation,
            ("aivis", "speed") => &self.aivis_speed,
            ("aivis", "volume") => &self.aivis_volume,
            ("aivis", "pitch") => &self.aivis_pitch,
            ("aivis", _) => &self.aivis_intonation,
            (_, "speed") => &self.sharevox_speed,
            (_, "volume") => &self.sharevox_volume,
            (_, "pitch") => &self.sharevox_pitch,
            _ => &self.sharevox_intonation,
        }
    }

    /// How an engine with the VOICEVOX API (`voicevox`, `aivis`, `sharevox`) reads. Validated
    /// settings always parse; anything else is the default.
    pub fn audio_query_scales(&self, engine: &str) -> AudioQueryScales {
        let defaults = AudioQueryScales::default();
        let number = |name: &str, fallback: f64| {
            let (_, min, max) = AUDIO_QUERY_RANGES.iter().find(|(field, _, _)| *field == name).expect("a listed field");
            decimal_in(self.scale_text(engine, name), *min, *max).unwrap_or(fallback)
        };
        AudioQueryScales {
            speed: number("speed", defaults.speed),
            volume: number("volume", defaults.volume),
            pitch: number("pitch", defaults.pitch),
            intonation: number("intonation", defaults.intonation),
        }
    }

    /// The engine that reads `language`: an installed engine for Japanese, else speech.cpp.
    pub fn engine_for(&self, language: &str) -> Result<&'static str, SettingsError> {
        if language_tag(language)? != "ja" {
            return Ok(SPEECHCPP);
        }
        ENGINES.iter().copied().find(|engine| *engine == self.japanese_engine).ok_or(SettingsError("Unknown speech engine"))
    }

    /// Whether a role (`japanese` or `multilingual`) speaks through a speech.cpp server.
    pub fn uses_speechcpp(&self, role: &str) -> bool {
        role != "japanese" || self.japanese_engine == SPEECHCPP
    }

    /// The saved URL of an installed engine (`voicevox`, `coeiroink`, `aivis`, `sharevox`).
    pub fn engine_url(&self, engine: &str) -> &str {
        match engine {
            "voicevox" => &self.voicevox_url,
            "coeiroink" => &self.coeiroink_url,
            "aivis" => &self.aivis_url,
            _ => &self.sharevox_url,
        }
    }

    /// The seed and instructions for the server that speaks `language`.
    /// None for an installed engine: they are speech.cpp's.
    pub fn options_for(&self, language: &str) -> Result<SynthesisOptions, SettingsError> {
        let japanese = language_tag(language)? == "ja";
        if self.engine_for(language)? != SPEECHCPP {
            return Ok(SynthesisOptions::default());
        }
        let (seed, instructions) = if japanese { (&self.japanese_seed, &self.japanese_instructions) } else { (&self.multilingual_seed, &self.multilingual_instructions) };
        Ok(SynthesisOptions {
            // Validated: at most 16 ASCII digits and not above SAFE_SEED_MAX.
            seed: if seed.is_empty() { None } else { Some(seed.parse().map_err(|_| SettingsError("Invalid seed"))?) },
            instructions: if is_blank(instructions) { String::new() } else { instructions.clone() },
        })
    }

    /// The server, voice, language and text for one message.
    ///
    /// Never falls back to the other text: translated mode without a
    /// translation, or microphone speech without one, is an error.
    /// `resolve_server` gives a running bundled server's base URL for a role
    /// (`japanese` or `multilingual`).
    /// Where speech.cpp would speak a message of `source` in `language` (a UI language name or a
    /// tag): the server's base URL, the voice and the language tag, as [`Self::request_for`]
    /// chooses them, without a text. `None` where the mode speaks nothing for `source`, an
    /// installed engine speaks the language, or the server cannot be named.
    pub fn speechcpp_target(&self, source: &Source, language: &str, resolve_server: Option<ServerResolver<'_>>) -> Option<(String, String, &'static str)> {
        let speaks = if *source == Source::Mic { self.mic_mode == "translated" } else { self.mode != "off" };
        if !speaks {
            return None;
        }
        let language = language_tag(language).ok()?;
        if self.engine_for(language).ok()? != SPEECHCPP {
            return None;
        }
        let japanese = language == "ja";
        let (server, voice) = if japanese { (&self.japanese_server, &self.japanese_voice) } else { (&self.multilingual_server, &self.multilingual_voice) };
        let url = if server == "bundled" {
            local_url(&resolve_server?(if japanese { "japanese" } else { "multilingual" }).ok()?).ok()?
        } else if japanese {
            self.japanese_url.clone()
        } else if self.multilingual_url.is_empty() {
            return None;
        } else {
            self.multilingual_url.clone()
        };
        Some((url, voice.clone(), language))
    }

    pub fn request_for(&self, event: &SpeechMessageEvent, resolve_server: Option<ServerResolver<'_>>) -> Result<SpeechRequest, TtsError> {
        let (text, language) = if event.source == Source::Mic {
            if self.mic_mode != "translated" {
                return Err(SettingsError("Microphone speech is disabled").into());
            }
            (&event.translated_text, &event.target_language)
        } else if self.mode == "translated" {
            (&event.translated_text, &event.target_language)
        } else {
            (&Some(event.original_text.clone()), &event.source_language)
        };
        let text = match text {
            Some(text) if !is_blank(text) => text.clone(),
            _ => return Err(SettingsError("No text in the selected speech mode").into()),
        };
        let language = language_tag(language.as_deref().unwrap_or(""))?;
        let japanese = language == "ja";
        let engine = self.engine_for(language)?;
        if engine != SPEECHCPP {
            if self.engine_voice_id.is_empty() {
                // A safe code the user can act on.
                return Err(crate::error::SpeechError::new("tts_engine_voice_unset").into());
            }
            let voice = EngineVoice { id: self.engine_voice_id.clone(), speaker: self.engine_voice_speaker.clone(), style: self.engine_voice_style.clone() };
            let coeiroink = (engine == "coeiroink").then(|| self.coeiroink_params());
            let audio_query = AUDIO_QUERY_ENGINES.contains(&engine).then(|| self.audio_query_scales(engine));
            return Ok(SpeechRequest { url: local_url(self.engine_url(engine))?, voice: voice.id.clone(), language, text, engine, engine_voice: Some(voice), coeiroink, audio_query });
        }
        let (server, voice) = if japanese { (&self.japanese_server, &self.japanese_voice) } else { (&self.multilingual_server, &self.multilingual_voice) };
        if server == "bundled" {
            let resolve = resolve_server.ok_or(SettingsError("speech_server_not_ready"))?;
            let url = local_url(&resolve(if japanese { "japanese" } else { "multilingual" })?)?;
            return Ok(SpeechRequest::speechcpp(url, voice, language, text));
        }
        if japanese {
            return Ok(SpeechRequest::speechcpp(self.japanese_url.clone(), voice, language, text));
        }
        if self.multilingual_url.is_empty() {
            return Err(SettingsError("Configure a separate Qwen3-TTS server for this language").into());
        }
        if self.japanese_engine == SPEECHCPP && self.japanese_server == "external" && local_url(&self.multilingual_url)? == local_url(&self.japanese_url)? {
            return Err(SettingsError("Japanese and multilingual TTS require separate servers").into());
        }
        Ok(SpeechRequest::speechcpp(self.multilingual_url.clone(), voice, language, text))
    }
}

/// The saved form of valid settings, or `None` (Python's `normalize_settings`).
pub fn normalize_settings(value: &Value) -> Option<Map<String, Value>> {
    match VoiceSettings::from_value(value).ok()?.to_value() {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn chat(text: &str, language: &str) -> SpeechMessageEvent {
        SpeechMessageEvent { source_language: Some(language.into()), ..SpeechMessageEvent::new("1", Source::Chat, text) }
    }

    fn mic(translated: Option<&str>, target: &str) -> SpeechMessageEvent {
        SpeechMessageEvent {
            translated_text: translated.map(Into::into),
            source_language: Some("ja".into()),
            target_language: Some(target.into()),
            utterance_id: Some("session:utterance".into()),
            ..SpeechMessageEvent::new("session:utterance", Source::Mic, "こんにちは")
        }
    }

    fn settings(value: Value) -> VoiceSettings {
        VoiceSettings::from_value_on(&value, Platform::Other).unwrap()
    }

    #[test]
    fn local_only() {
        for url in [
            "http://example.com",
            "http://192.168.1.1:8080",
            "https://127.0.0.1",
            "http://user:pass@127.0.0.1",
            "http://127.0.0.1/a",
            "http://127.0.0.1?x=y",
            "http://0.0.0.0",
            "http://127.0.0.1:70000",
            "http://127.0.0.1:0",
            "http://127.0.0.1#fragment",
            "file:///tmp/audio",
            "127.0.0.1:8080",
            "http://127.0.0.1:８０",
            "http://[::1",
        ] {
            assert!(local_url(url).is_err(), "{url}");
        }
        assert_eq!(local_url("http://127.0.0.1:8080").unwrap(), "http://127.0.0.1:8080");
        assert_eq!(local_url("http://localhost").unwrap(), "http://127.0.0.1:80");
        assert_eq!(local_url("HTTP://LocalHost:9/").unwrap(), "http://127.0.0.1:9");
        assert_eq!(local_url("http://[::1]:8081").unwrap(), "http://[::1]:8081");
        assert_eq!(local_url(" http://127.0.0.1:80\n80").unwrap(), "http://127.0.0.1:8080");
        assert_eq!(local_url("http://127.0.0.1:").unwrap(), "http://127.0.0.1:80");
        assert_eq!(local_url("http://127.0.0.1?#").unwrap(), "http://127.0.0.1:80");
    }

    #[test]
    fn defaults_and_language_routing() {
        assert_eq!(settings(json!({})).mode, "off");
        // New settings start on the bundled server; a saved external server keeps its URL (#566).
        assert_eq!((VoiceSettings::default().japanese_server.as_str(), VoiceSettings::default().multilingual_server.as_str()), ("bundled", "bundled"));
        let original = settings(json!({"mode": "original", "output_device": "cable", "japanese_server": "external", "multilingual_server": "external"}));
        let ja = chat("こんにちは", "Japanese");
        let request = original.request_for(&ja, None).unwrap();
        assert_eq!((request.voice.as_str(), request.language), ("none", "ja"));
        let en = chat("hello", "English");
        assert!(matches!(original.request_for(&en, None), Err(TtsError::Unavailable(_))));
        let mut value = original.to_value();
        value["multilingual_url"] = json!("http://127.0.0.1:8081");
        let multilingual = settings(value.clone());
        assert_eq!(multilingual.request_for(&en, None).unwrap(), SpeechRequest::speechcpp("http://127.0.0.1:8081".into(), "ryan", "en", "hello".into()));
        value["mode"] = json!("translated");
        // No fallback to the original text.
        assert!(settings(value).request_for(&ja, None).is_err());
    }

    #[test]
    fn same_external_server_for_both_roles_is_rejected() {
        let both = settings(json!({"mode": "original", "output_device": "c", "japanese_server": "external",
            "multilingual_server": "external", "multilingual_url": "http://localhost:8080"}));
        assert_eq!(both.request_for(&chat("hi", "en"), None), Err(TtsError::Unavailable("Japanese and multilingual TTS require separate servers")));
    }

    #[test]
    fn bundled_server_is_resolved_and_must_be_local() {
        let bundled = settings(json!({"mode": "original", "output_device": "c", "japanese_server": "bundled"}));
        assert!(bundled.request_for(&chat("x", "ja"), None).is_err());
        let resolve = |role: &str| -> Result<String, TtsError> {
            assert_eq!(role, "japanese");
            Ok("http://localhost:9000".into())
        };
        assert_eq!(bundled.request_for(&chat("x", "ja"), Some(&resolve)).unwrap().url, "http://127.0.0.1:9000");
        let remote = |_: &str| -> Result<String, TtsError> { Ok("http://example.com".into()) };
        assert!(matches!(bundled.request_for(&chat("x", "ja"), Some(&remote)), Err(TtsError::Unavailable(_))));
        let stopped = |_: &str| -> Result<String, TtsError> { Err(crate::SpeechError::new("speech_server_not_ready").into()) };
        assert_eq!(bundled.request_for(&chat("x", "ja"), Some(&stopped)).unwrap_err().failure_code(), "speech_server_not_ready");
    }

    #[test]
    fn settings_validation() {
        for value in [
            json!({"mode": true}),
            json!({"mode": "original"}),
            json!({"target_slot": "4"}),
            json!({"japanese_url": "http://remote"}),
            json!({"japanese_voice": ""}),
            json!({"japanese_voice": "\u{3000}"}),
            json!({"output_device": "bad\n"}),
            json!({"unknown": 1}),
            json!(null),
            json!([]),
            json!({"routing": "other"}),
            json!({"monitor": "on", "monitor_device": "astarot.managed.x"}),
            json!({"monitor": "on", "monitor_device": "astarot.source-bridge.x.playback"}),
            json!({"monitor": "on", "monitor_device": "cable", "output_device": "cable"}),
            json!({"monitor_volume": "101"}),
            json!({"monitor_volume": "0100"}),
            json!({"monitor_volume": ""}),
            json!({"japanese_server": "remote"}),
        ] {
            assert!(VoiceSettings::from_value_on(&value, Platform::Other).is_err(), "{value}");
        }
        // The route of 0.6.0 and earlier, while its names are read (ADR-014, 2.11).
        for device in ["vrct.managed.x", "vrct.source-bridge.x.playback"] {
            let value = json!({"monitor": "on", "monitor_device": device});
            assert_eq!(VoiceSettings::from_value_on(&value, Platform::Other).is_err(), astarot_app_identity::audio_route::READS_LEGACY_NAMES, "{value}");
        }
    }

    #[test]
    fn speech_on_the_managed_route_goes_to_its_tts_input() {
        assert!(MANAGED_TTS.starts_with(astarot_app_identity::audio_route::NODE_PREFIX.current()));
        assert_eq!(MANAGED_TTS, "astarot.managed.tts");
        let settings = VoiceSettings::from_value_on(&json!({"routing": "managed"}), Platform::Other).unwrap();
        assert_eq!(settings.playback_device(), MANAGED_TTS);
    }

    #[test]
    fn mic_mode_is_independent_and_never_falls_back_to_original() {
        let mic_settings = settings(json!({"mic_mode": "translated", "routing": "managed", "multilingual_server": "external",
            "multilingual_url": "http://127.0.0.1:8081"}));
        assert_eq!(mic_settings.mode, "off");
        assert_eq!(mic_settings.direct_policy, "suppress");
        assert_eq!(settings(mic_settings.to_value()), mic_settings);
        assert_eq!(mic_settings.request_for(&mic(Some("Hello"), "en"), None).unwrap(), SpeechRequest::speechcpp("http://127.0.0.1:8081".into(), "ryan", "en", "Hello".into()));
        assert!(mic_settings.request_for(&mic(None, "en"), None).is_err());
        assert!(VoiceSettings::default().request_for(&mic(Some("Hello"), "en"), None).is_err());
    }

    #[test]
    fn mic_settings_require_valid_mode_and_explicit_routing() {
        for value in [
            json!({"mic_mode": "original"}),
            json!({"mic_mode": true}),
            json!({"direct_policy": "duck"}),
            json!({"mic_mode": "translated", "output_device": "cable"}),
            json!({"mic_mode": "translated", "direct_policy": "mix"}),
        ] {
            assert!(VoiceSettings::from_value_on(&value, Platform::Other).is_err(), "{value}");
        }
        // Windows has no managed route; its output device silences the direct voice.
        assert!(VoiceSettings::from_value_on(&json!({"mic_mode": "translated", "output_device": "cable"}), Platform::Windows).is_ok());
        let external = settings(json!({"mic_mode": "translated", "direct_policy": "mix", "output_device": "cable"}));
        assert_eq!(external.playback_device(), "cable");
    }

    #[test]
    fn conversion_is_off_by_default_and_cannot_mix_with_the_voice() {
        assert_eq!(VoiceSettings::default().conversion, "off");
        assert_eq!(settings(json!({"conversion": "on"})).conversion, "on");
        for bad in [json!({"conversion": "yes"}), json!({"conversion": "on", "direct_policy": "mix"})] {
            assert!(VoiceSettings::from_value_on(&bad, Platform::Other).is_err());
        }
    }

    #[test]
    fn invalid_seed_settings_rejected() {
        for bad in [json!("-1"), json!("1.5"), json!("1e2"), json!("9007199254740992"), json!(true), json!(42), json!("１２"), json!("1\u{0}")] {
            assert!(VoiceSettings::from_value_on(&json!({"japanese_seed": bad}), Platform::Other).is_err(), "{bad}");
        }
    }

    #[test]
    fn options_roundtrip_zero_maximum_and_language_selection() {
        let value = settings(json!({
            "japanese_seed": "0",
            "multilingual_seed": "9007199254740991",
            "japanese_instructions": "やさしく\n落ち着いて。",
            "multilingual_instructions": "Speak clearly.",
        }));
        assert_eq!(settings(value.to_value()), value);
        assert_eq!(value.options_for("Japanese").unwrap(), SynthesisOptions { seed: Some(0), instructions: "やさしく\n落ち着いて。".into() });
        assert_eq!(value.options_for("en").unwrap(), SynthesisOptions { seed: Some(9007199254740991), instructions: "Speak clearly.".into() });
        assert_eq!(VoiceSettings::default().options_for("ja").unwrap(), SynthesisOptions::default());
        assert!(VoiceSettings::default().options_for("auto").is_err());
    }

    #[test]
    fn invalid_instruction_rejected() {
        for bad in [json!("x".repeat(4001)), json!("\u{0}"), json!("private\u{1b}text"), json!("\u{7f}"), json!(true)] {
            assert!(VoiceSettings::from_value_on(&json!({"multilingual_instructions": bad}), Platform::Other).is_err());
        }
    }

    #[test]
    fn instruction_limit_and_newlines_are_preserved() {
        let value = "声\n".repeat(2000);
        assert_eq!(settings(json!({"japanese_instructions": value})).options_for("ja").unwrap().instructions, value);
        assert_eq!(settings(json!({"japanese_instructions": " \n"})).options_for("ja").unwrap().instructions, "");
    }

    #[test]
    fn engine_settings_default_to_speechcpp_and_keep_older_files_readable() {
        let value = settings(json!({"mode": "original", "output_device": "cable"}));
        assert_eq!((value.japanese_engine.as_str(), value.engine_voice_id.as_str()), ("speechcpp", ""));
        assert_eq!((value.voicevox_url.as_str(), value.coeiroink_url.as_str()), ("http://127.0.0.1:50021", "http://127.0.0.1:50032"));
    }

    #[test]
    fn japanese_goes_to_the_chosen_engine_and_other_languages_stay_on_speechcpp() {
        let value = settings(json!({"mode": "original", "output_device": "cable", "japanese_engine": "voicevox",
            "engine_voice_id": "3", "engine_voice_speaker": "ずんだもん", "engine_voice_style": "ノーマル",
            "japanese_seed": "7", "multilingual_server": "external", "multilingual_url": "http://localhost:8080"}));
        let request = value.request_for(&chat("こんにちは", "Japanese"), None).unwrap();
        assert_eq!((request.url.as_str(), request.language, request.engine), ("http://127.0.0.1:50021", "ja", "voicevox"));
        assert_eq!(request.engine_voice, Some(EngineVoice { id: "3".into(), speaker: "ずんだもん".into(), style: "ノーマル".into() }));
        assert_eq!((value.engine_for("Japanese").unwrap(), value.engine_for("English").unwrap()), ("voicevox", "speechcpp"));
        assert_eq!(value.options_for("Japanese").unwrap(), SynthesisOptions::default(), "the seed is speech.cpp's");
        // The Japanese speech.cpp URL is unused, so sharing it with the multilingual one is allowed.
        let english = value.request_for(&chat("hello", "English"), None).unwrap();
        assert_eq!(english, SpeechRequest::speechcpp("http://localhost:8080".into(), "ryan", "en", "hello".into()));
    }

    #[test]
    fn an_engine_without_a_chosen_voice_fails_with_a_code_the_ui_can_explain() {
        let value = settings(json!({"mode": "original", "output_device": "cable", "japanese_engine": "coeiroink"}));
        assert_eq!(value.request_for(&chat("x", "ja"), None).unwrap_err().failure_code(), "tts_engine_voice_unset");
    }

    #[test]
    fn engine_settings_are_validated() {
        for value in [
            json!({"japanese_engine": "unknown"}),
            json!({"japanese_engine": "multilingual"}),
            json!({"voicevox_url": "http://192.168.1.5:50021"}),
            json!({"coeiroink_url": "https://127.0.0.1:50032"}),
            json!({"aivis_url": "http://127.0.0.1:10101/path"}),
            json!({"engine_voice_id": "1 or 1"}),
            json!({"engine_voice_id": "x".repeat(80)}),
            json!({"engine_voice_id": "1234567890"}),
            json!({"engine_voice_speaker": "bad\nname"}),
            json!({"engine_voice_style": "y".repeat(200)}),
        ] {
            assert!(VoiceSettings::from_value_on(&value, Platform::Other).is_err(), "{value}");
        }
        for id in ["0", "123456789", "7ffcb7ce-00ec-4bdc-82cd-45a8889e43ff:0", "ABC-def:12"] {
            assert!(VoiceSettings::from_value_on(&json!({"engine_voice_id": id}), Platform::Other).is_ok(), "{id}");
        }
    }

    #[test]
    fn coeiroink_reading_settings_default_to_the_earlier_fixed_values_and_are_checked() {
        assert_eq!(VoiceSettings::default().coeiroink_params(), CoeiroinkParams::default());
        let value = settings(json!({"mode": "original", "output_device": "cable", "japanese_engine": "coeiroink", "engine_voice_id": "ab-12:0",
            "coeiroink_speed": "1.25", "coeiroink_volume": "0", "coeiroink_pitch": "-0.05", "coeiroink_intonation": "2",
            "coeiroink_pre_phoneme": "0.0", "coeiroink_post_phoneme": "1.5", "coeiroink_sampling_rate": "48000"}));
        let params = CoeiroinkParams { speed: 1.25, volume: 0.0, pitch: -0.05, intonation: 2.0, pre_phoneme: 0.0, post_phoneme: 1.5, sampling_rate: 48_000 };
        assert_eq!(value.coeiroink_params(), params);
        assert_eq!(value.request_for(&chat("x", "ja"), None).unwrap().coeiroink, Some(params));
        assert_eq!(settings(value.to_value()), value);
        // Other engines carry none.
        let voicevox = settings(json!({"mode": "original", "output_device": "cable", "japanese_engine": "voicevox", "engine_voice_id": "3"}));
        assert_eq!(voicevox.request_for(&chat("x", "ja"), None).unwrap().coeiroink, None);
        for (field, bad) in [
            ("coeiroink_speed", "0.4"), ("coeiroink_speed", "2.01"), ("coeiroink_speed", "1e0"), ("coeiroink_speed", "NaN"),
            ("coeiroink_speed", "inf"), ("coeiroink_speed", ""), ("coeiroink_speed", "1."), ("coeiroink_speed", ".5"), ("coeiroink_speed", "+1"),
            ("coeiroink_volume", "-0.1"), ("coeiroink_pitch", "0.2"), ("coeiroink_intonation", "2.5"),
            ("coeiroink_pre_phoneme", "1.6"), ("coeiroink_post_phoneme", "-1"),
            ("coeiroink_sampling_rate", "22050"), ("coeiroink_sampling_rate", "24000.0"), ("coeiroink_sampling_rate", ""),
        ] {
            assert!(VoiceSettings::from_value_on(&json!({ field: bad }), Platform::Other).is_err(), "{field}={bad}");
        }
    }

    #[test]
    fn each_voicevox_api_engine_has_its_own_scales_that_default_to_the_engines_own() {
        assert!(AudioQueryScales::default().changed().is_empty(), "a query at its defaults is not touched");
        for engine in AUDIO_QUERY_ENGINES {
            assert_eq!(VoiceSettings::default().audio_query_scales(engine), AudioQueryScales::default());
        }
        let value = settings(json!({"mode": "original", "output_device": "cable", "japanese_engine": "aivis", "engine_voice_id": "888753760",
            "aivis_speed": "1.25", "aivis_volume": "0", "aivis_pitch": "-0.05", "aivis_intonation": "2", "voicevox_speed": "0.5"}));
        let scales = AudioQueryScales { speed: 1.25, volume: 0.0, pitch: -0.05, intonation: 2.0 };
        assert_eq!(value.audio_query_scales("aivis"), scales);
        assert_eq!(value.audio_query_scales("voicevox"), AudioQueryScales { speed: 0.5, ..AudioQueryScales::default() }, "VOICEVOX keeps its own");
        assert_eq!(value.audio_query_scales("sharevox"), AudioQueryScales::default());
        let request = value.request_for(&chat("x", "ja"), None).unwrap();
        assert_eq!((request.audio_query, request.coeiroink), (Some(scales), None));
        assert_eq!(scales.changed(), [("speedScale", 1.25), ("volumeScale", 0.0), ("pitchScale", -0.05), ("intonationScale", 2.0)]);
        assert_eq!(AudioQueryScales { pitch: 0.1, ..AudioQueryScales::default() }.changed(), [("pitchScale", 0.1)], "only what was set");
        assert_eq!(settings(value.to_value()), value);
        // COEIROINK and speech.cpp carry none.
        let coeiroink = settings(json!({"mode": "original", "output_device": "cable", "japanese_engine": "coeiroink", "engine_voice_id": "ab-12:0"}));
        assert_eq!(coeiroink.request_for(&chat("x", "ja"), None).unwrap().audio_query, None);
        let speechcpp = settings(json!({"mode": "original", "output_device": "cable", "japanese_server": "external"}));
        assert_eq!(speechcpp.request_for(&chat("x", "ja"), None).unwrap().audio_query, None);
        for (field, bad) in [
            ("voicevox_speed", "0.4"), ("voicevox_speed", "2.01"), ("voicevox_speed", "1e0"), ("voicevox_speed", "NaN"), ("voicevox_speed", ""),
            ("aivis_volume", "-0.1"), ("aivis_volume", "2.5"), ("aivis_pitch", "0.2"), ("sharevox_pitch", "-0.16"),
            ("sharevox_intonation", "2.5"), ("sharevox_intonation", "+1"),
        ] {
            assert!(VoiceSettings::from_value_on(&json!({ field: bad }), Platform::Other).is_err(), "{field}={bad}");
        }
    }

    #[test]
    fn normalize_returns_the_saved_form_or_none() {
        let saved = normalize_settings(&json!({"mode": "original", "output_device": "cable"})).unwrap();
        assert_eq!(saved.len(), VoiceSettings::FIELDS.len());
        assert_eq!(saved["mode"], "original");
        assert!(normalize_settings(&json!({"mode": "loud"})).is_none());
    }
}
