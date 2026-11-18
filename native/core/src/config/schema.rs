//! Every setting: its default, whether it is saved, and the check a new value must pass
//! (`ManagedProperty` and `ValidatedProperty` in `src-python/config.py`).
//!
//! The order of [`keys`] is the order of the Python class, which is the order of `config.json`.

use super::{Ctx, Environment, Platform};
use crate::languages;
use crate::net_policy::valid_saved_api_url;
use crate::voice_settings;
use serde_json::{Map, Value, json};
use std::sync::Arc;

/// A check: the value to store, or `None` to refuse the value.
pub type Check = Arc<dyn Fn(&Value, &Ctx) -> Option<Value> + Send + Sync>;

pub struct Key {
    pub name: &'static str,
    /// Written to `config.json` and read from it.
    pub serialize: bool,
    /// Fixed for the run; never set.
    pub readonly: bool,
    /// Saved at once instead of 2 s after the last change.
    pub immediate: bool,
    pub check: Option<Check>,
}

#[derive(Clone, Copy, PartialEq)]
enum Ty {
    Bool,
    Int,
    Num,
    Str,
    Dict,
    List,
}

fn type_ok(ty: Ty, value: &Value) -> bool {
    match ty {
        Ty::Bool => value.is_boolean(),
        Ty::Int => value.is_i64() || value.is_u64(),
        Ty::Num => value.is_number(),
        Ty::Str => value.is_string(),
        Ty::Dict => value.is_object(),
        Ty::List => value.is_array(),
    }
}

/// `ManagedProperty`: a type, `None` only when allowed, then the `allowed` test.
fn managed(ty: Ty, allow_none: bool, allowed: impl Fn(&Value, &Ctx) -> bool + Send + Sync + 'static) -> Check {
    Arc::new(move |value, ctx| {
        if value.is_null() {
            return (allow_none && allowed(value, ctx)).then(Value::default);
        }
        (type_ok(ty, value) && allowed(value, ctx)).then(|| value.clone())
    })
}

fn plain(ty: Ty) -> Check {
    managed(ty, false, |_, _| true)
}

fn int_in(low: i64, high: i64) -> Check {
    managed(Ty::Int, false, move |v, _| v.as_i64().is_some_and(|v| (low..=high).contains(&v)))
}

fn num_in(low: f64, high: f64) -> Check {
    managed(Ty::Num, false, move |v, _| v.as_f64().is_some_and(|v| v.is_finite() && v >= low && v <= high))
}

fn one_of(list: &'static str) -> Check {
    managed(Ty::Str, false, move |v, ctx| ctx.list(list).iter().any(|item| item == v))
}

fn validated(f: impl Fn(&Value, &Ctx) -> Option<Value> + Send + Sync + 'static) -> Check {
    Arc::new(f)
}

fn key(name: &'static str, check: Check) -> Key {
    Key { name, serialize: true, readonly: false, immediate: false, check: Some(check) }
}

fn runtime(name: &'static str, check: Check) -> Key {
    Key { name, serialize: false, readonly: false, immediate: false, check: Some(check) }
}

fn immediate(name: &'static str, check: Check) -> Key {
    Key { name, serialize: true, readonly: false, immediate: true, check: Some(check) }
}

fn readonly(name: &'static str) -> Key {
    Key { name, serialize: false, readonly: true, immediate: false, check: None }
}

/// An RVC block a conversion may use: 20 to 200 ms in steps of 20 (`protocol::Block`).
pub fn is_valid_rvc_block_ms(value: &Value) -> bool {
    value.is_u64() && value.as_u64().and_then(|ms| u32::try_from(ms).ok()).and_then(vrct_voice_conversion::protocol::Block::from_ms).is_some()
}

pub fn is_valid_port(value: &Value) -> bool {
    value.as_i64().is_some_and(|port| value.is_i64() && (1..=65535).contains(&port))
}

/// IPv4 only, not 0.0.0.0 (`isValidWebSocketHost`).
pub fn is_valid_websocket_host(value: &Value) -> bool {
    value.as_str().and_then(|host| host.parse::<std::net::Ipv4Addr>().ok()).is_some_and(|ip| !ip.is_unspecified())
}

fn float(value: &Value) -> Value {
    json!(value.as_f64().unwrap_or(0.0))
}

fn is_int(value: &Value) -> bool {
    value.is_i64() || value.is_u64()
}

fn same_keys(value: &Map<String, Value>, current: &Value) -> bool {
    current.as_object().is_some_and(|current| value.len() == current.len() && value.keys().all(|k| current.contains_key(k)))
}

/// The small and large VR log captions (`_overlay_small_validator`, `_overlay_large_validator`).
fn overlay_log(name: &'static str) -> Check {
    validated(move |value, ctx| {
        let value = value.as_object()?;
        let current = ctx.get(name);
        if !same_keys(value, &current) {
            return None;
        }
        let mut new = current.as_object()?.clone();
        for (key, v) in value {
            match key.as_str() {
                "tracker" if matches!(v.as_str(), Some("HMD" | "LeftHand" | "RightHand")) => {
                    new.insert(key.clone(), v.clone());
                }
                "x_pos" | "y_pos" | "z_pos" | "x_rotation" | "y_rotation" | "z_rotation" | "opacity" | "ui_scaling"
                    if v.is_number() =>
                {
                    new.insert(key.clone(), float(v));
                }
                "display_duration" | "fadeout_duration" if is_int(v) => {
                    new.insert(key.clone(), v.clone());
                }
                _ => {}
            }
        }
        Some(Value::Object(new))
    })
}

/// The VR UI windows, moved by hand in VR (`_validate_overlay_vr_window`). Missing keys keep
/// their value; unknown keys refuse the whole value.
fn overlay_vr_window(name: &'static str) -> Check {
    validated(move |value, ctx| {
        let value = value.as_object()?;
        let current = ctx.get(name);
        let mut new = current.as_object()?.clone();
        if value.keys().any(|k| !new.contains_key(k)) {
            return None;
        }
        for (key, v) in value {
            match key.as_str() {
                "tracker" if matches!(v.as_str(), Some("HMD" | "LeftHand" | "RightHand" | "Playspace")) => {
                    new.insert(key.clone(), v.clone());
                }
                "x_pos" | "y_pos" | "z_pos" | "x_rotation" | "y_rotation" | "z_rotation" | "opacity" | "ui_scaling"
                    if v.is_number() =>
                {
                    new.insert(key.clone(), float(v));
                }
                "display_duration" | "fadeout_duration" | "width" | "height" if is_int(v) => {
                    new.insert(key.clone(), v.clone());
                }
                _ => {}
            }
        }
        Some(Value::Object(new))
    })
}

fn overlay_desktop() -> Check {
    validated(|value, ctx| {
        let value = value.as_object()?;
        let current = ctx.get("OVERLAY_DESKTOP_SETTINGS");
        if !same_keys(value, &current) {
            return None;
        }
        let mut new = current.as_object()?.clone();
        for (key, v) in value {
            if v.is_boolean() {
                return None;
            }
            let ok = match key.as_str() {
                "position" => matches!(v.as_str(), Some("bottom" | "top")),
                "font_size" => is_int(v) && v.as_i64().is_some_and(|n| (16..=72).contains(&n)),
                "display_duration" => is_int(v) && v.as_i64().is_some_and(|n| (1..=60).contains(&n)),
                "opacity" => v.as_f64().is_some_and(|n| (0.0..=1.0).contains(&n)),
                _ => false,
            };
            if ok {
                new.insert(key.clone(), if key == "opacity" { float(v) } else { v.clone() });
            }
        }
        Some(Value::Object(new))
    })
}

/// `_overlay_desktop_placement_validator`: where the caption window was dragged, as whole
/// physical pixels within ±100000, or both null for the band of the position setting.
fn overlay_desktop_placement() -> Check {
    validated(|value, _| {
        let value = value.as_object()?;
        if value.len() != 2 {
            return None;
        }
        let (x, y) = (value.get("x")?, value.get("y")?);
        if x.is_null() && y.is_null() {
            return Some(json!({ "x": null, "y": null }));
        }
        let place = |v: &Value| v.as_i64().filter(|n| is_int(v) && (-100_000..=100_000).contains(n));
        Some(json!({ "x": place(x)?, "y": place(y)? }))
    })
}

fn io_flow_overlay() -> Check {
    validated(|value, ctx| {
        let value = value.as_object()?;
        if !same_keys(value, &ctx.get("IO_FLOW_OVERLAY_SETTINGS")) {
            return None;
        }
        let desktop = value.get("desktop")?.as_bool()?;
        let count = value.get("count").filter(|c| is_int(c))?.as_i64()?;
        (1..=3).contains(&count).then(|| json!({ "desktop": desktop, "count": count }))
    })
}

/// `validateDictStructure` against the message format parts.
fn message_format() -> Check {
    fn parts_ok(value: &Value) -> bool {
        let Some(object) = value.as_object() else { return false };
        let keys_ok = |o: &Map<String, Value>, keys: &[&str]| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k));
        if !keys_ok(object, &["message", "separator", "translation", "translation_first"]) {
            return false;
        }
        let strings = |o: &Value, keys: &[&str]| {
            o.as_object().is_some_and(|o| keys_ok(o, keys) && keys.iter().all(|k| o[*k].is_string()))
        };
        strings(&object["message"], &["prefix", "suffix"])
            && object["separator"].is_string()
            && strings(&object["translation"], &["prefix", "separator", "suffix"])
            && object["translation_first"].is_boolean()
    }
    validated(|value, _| parts_ok(value).then(|| value.clone()))
}

fn word_filter() -> Check {
    validated(|value, _| {
        let items = value.as_array()?;
        let mut seen = std::collections::HashSet::new();
        Some(Value::Array(
            items.iter().filter_map(Value::as_str).filter(|s| seen.insert(s.to_string())).map(|s| json!(s)).collect(),
        ))
    })
}

fn translation_engines_check() -> Check {
    validated(|value, ctx| {
        let value = value.as_object()?;
        let old = ctx.get("SELECTED_TRANSLATION_ENGINES");
        let tabs = ctx.list("SELECTABLE_TAB_NO_LIST");
        if !ctx.loading && (value.len() != tabs.len() || tabs.iter().any(|t| !value.contains_key(t.as_str().unwrap_or("")))
            || value.values().any(|v| !v.is_string()))
        {
            return None;
        }
        let engines = ctx.list("SELECTABLE_TRANSLATION_ENGINE_LIST");
        let mut new = Map::new();
        for tab in tabs.iter().filter_map(Value::as_str) {
            let given = value.get(tab).filter(|v| v.is_string() && engines.contains(v));
            new.insert(tab.to_string(), given.cloned().unwrap_or_else(|| old[tab].clone()));
        }
        Some(Value::Object(new))
    })
}

fn languages_check(name: &'static str, slots: &'static str) -> Check {
    validated(move |value, ctx| {
        let value = value.as_object()?;
        let tabs: Vec<String> = ctx.list("SELECTABLE_TAB_NO_LIST").iter().filter_map(|v| v.as_str().map(str::to_string)).collect();
        let slots: Vec<String> = if slots == "your" {
            vec!["1".into()]
        } else {
            ctx.list("SELECTED_TAB_TARGET_LANGUAGES_NO_LIST").iter().filter_map(|v| v.as_str().map(str::to_string)).collect()
        };
        let fields_ok = |entry: &Value| {
            entry.as_object().is_some_and(|e| e.len() == 3 && ["language", "country", "enable"].iter().all(|f| e.contains_key(*f)))
        };
        if !ctx.loading {
            if value.len() != tabs.len() || tabs.iter().any(|t| !value.contains_key(t)) {
                return None;
            }
            for tab in &tabs {
                let entries = value[tab].as_object()?;
                if entries.len() != slots.len() || slots.iter().any(|s| !entries.contains_key(s)) {
                    return None;
                }
                if entries.values().any(|e| !fields_ok(e)) {
                    return None;
                }
            }
        }
        let mut new = ctx.get(name);
        for tab in &tabs {
            let Some(entries) = value.get(tab).and_then(Value::as_object) else { continue };
            for slot in &slots {
                let Some(entry) = entries.get(slot).filter(|e| fields_ok(e)) else { continue };
                let (language, country, enable) = (&entry["language"], &entry["country"], &entry["enable"]);
                let known = matches!((language.as_str(), country.as_str()), (Some(l), Some(c)) if languages::known_language(l, c));
                if known && enable.is_boolean() {
                    new[tab.as_str()][slot.as_str()] = entry.clone();
                }
            }
        }
        Some(new)
    })
}

/// A compute device of the list, matched by device, index and name (`_compute_device_validator`).
pub fn compute_device(value: &Value, ctx: &Ctx) -> Option<Value> {
    let value = value.as_object()?;
    ctx.list("SELECTABLE_COMPUTE_DEVICE_LIST").iter().find(|device| {
        ["device", "device_index", "device_name"].iter().all(|key| {
            let (a, b) = (value.get(*key), device.get(*key));
            matches!((a, b), (Some(a), Some(b)) if a == b && a.is_string() == b.is_string() && is_int(a) == is_int(b))
        })
    }).cloned()
}

fn compute_type() -> Check {
    validated(|value, ctx| {
        value.as_str()?;
        let mut device = ctx.get("SELECTED_TRANSLATION_COMPUTE_DEVICE");
        if ctx.loading {
            let saved = ctx.saved.get("SELECTED_TRANSLATION_COMPUTE_DEVICE").cloned().unwrap_or_else(|| device.clone());
            if let Some(found) = compute_device(&saved, ctx) {
                device = found;
            }
        }
        device.get("compute_types").and_then(Value::as_array).is_some_and(|types| types.contains(value)).then(|| value.clone())
    })
}

fn asr_timeout(source: &'static str, kind: &'static str) -> Check {
    managed(Ty::Int, false, move |value, ctx| {
        let Some(value) = value.as_i64() else { return false };
        if !(0..=30).contains(&value) {
            return false;
        }
        let other_key = format!("{source}_{}_TIMEOUT", if kind == "RECORD" { "PHRASE" } else { "RECORD" });
        let mut other = ctx.get(&other_key).as_i64().unwrap_or(0);
        if ctx.loading {
            if let Some(saved) = ctx.saved.get(&other_key).filter(|s| is_int(s)).and_then(Value::as_i64) {
                if (0..=30).contains(&saved) {
                    other = saved;
                }
            }
        }
        if kind == "RECORD" { value <= other } else { value >= other }
    })
}

fn device_choice(placeholder: &'static str, kind: DeviceKind) -> Check {
    validated(move |value, ctx| {
        let name = value.as_str()?;
        if name == placeholder || ctx.loading {
            // While reading config.json the devices are not listed yet; the saved choice is kept
            // and checked once they are (`_keepSavedDeviceUntilListed`).
            return Some(value.clone());
        }
        let devices = ctx.env.devices.as_ref()?;
        let listed = match kind {
            DeviceKind::MicHost => devices.mic_hosts().iter().any(|h| h == name),
            DeviceKind::Mic => {
                let host = ctx.get("SELECTED_MIC_HOST");
                devices.mic_devices(host.as_str().unwrap_or("")).iter().any(|d| d == name)
            }
            DeviceKind::Speaker => devices.speaker_devices().iter().any(|d| d == name),
        };
        listed.then(|| value.clone())
    })
}

#[derive(Clone, Copy)]
enum DeviceKind {
    MicHost,
    Mic,
    Speaker,
}

fn in_populated(list: &'static str) -> Check {
    managed(Ty::Str, true, move |value, ctx| {
        let list = ctx.list(list);
        list.is_empty() || value.is_null() || list.contains(value)
    })
}

fn credentials(name: &'static str) -> Check {
    validated(move |value, ctx| {
        let value = value.as_object()?;
        let current = ctx.get(name);
        let mut new = Map::new();
        for (key, old) in current.as_object()? {
            let given = value.get(key).filter(|v| v.is_string() || v.is_null());
            new.insert(key.clone(), given.unwrap_or(old).clone());
        }
        Some(Value::Object(new))
    })
}

fn hotkeys() -> Check {
    validated(|value, ctx| {
        let value = value.as_object()?;
        let current = ctx.get("HOTKEYS");
        let mut new = current.as_object()?.clone();
        if value.keys().any(|k| !new.contains_key(k)) {
            return None;
        }
        for (key, v) in value {
            if v.is_array() || v.is_null() {
                new.insert(key.clone(), v.clone());
            }
        }
        Some(Value::Object(new))
    })
}

/// Experimental features the user turns on one by one (`src-python/models/experimental_features.py`,
/// Issue #361). The Python backend and the UI list the same ids; a backend test keeps them equal.
pub const EXPERIMENTAL_FEATURE_IDS: &[&str] = &["tray_companion"];

fn experimental_features_default() -> Value {
    Value::Object(EXPERIMENTAL_FEATURE_IDS.iter().map(|id| (id.to_string(), Value::Bool(false))).collect())
}

/// `experimental_features.normalize`: a feature left out keeps its value, an unlisted id is
/// dropped (a saved file may still name a feature that graduated), and a value that is not a
/// bool refuses the whole request.
fn normalize_experimental_features(ids: &[&str], value: &Value, current: &Value) -> Option<Value> {
    let value = value.as_object()?;
    let mut new = Map::new();
    for id in ids {
        let enabled = match value.get(*id) {
            Some(given) => given.as_bool()?,
            None => current.get(*id).and_then(Value::as_bool) == Some(true),
        };
        new.insert(id.to_string(), Value::Bool(enabled));
    }
    Some(Value::Object(new))
}

fn experimental_features() -> Check {
    validated(|value, ctx| {
        normalize_experimental_features(EXPERIMENTAL_FEATURE_IDS, value, &ctx.get("EXPERIMENTAL_FEATURES"))
    })
}

/// The usage presets the user can pick at the top of the settings menu (#554). Each shows the
/// features one way of using the app needs, in the settings menu and among the main switches;
/// "all" shows every feature. The UI keeps what each one shows (`src-ui/logics/configs/usagePresets.ts`).
pub const USAGE_PRESET_IDS: &[&str] = &["basic", "nonverbal", "multilingual", "voice_changer", "all"];

/// Several presets can be picked; the menu and the switches show what any of them shows. The
/// value is kept in the order above, each id once. An id this version does not know is left
/// out (a later version may have one more), and a list with none it knows is refused.
fn usage_presets() -> Check {
    validated(|value, _| {
        let given = value.as_array()?;
        let mut ids = Vec::with_capacity(given.len());
        for item in given {
            ids.push(item.as_str()?);
        }
        let picked: Vec<Value> = USAGE_PRESET_IDS.iter().filter(|id| ids.contains(id)).map(|id| json!(id)).collect();
        (!picked.is_empty()).then_some(Value::Array(picked))
    })
}

fn main_window_geometry() -> Check {
    validated(|value, ctx| {
        let value = value.as_object()?;
        let current = ctx.get("MAIN_WINDOW_GEOMETRY");
        if !same_keys(value, &current) {
            return None;
        }
        let mut new = Map::new();
        for (key, v) in value {
            new.insert(key.clone(), if is_int(v) { v.clone() } else { current[key.as_str()].clone() });
        }
        Some(Value::Object(new))
    })
}

const OCR_REGION_MIN_SIDE: f64 = 0.02;

fn ocr_region(value: &Value, _: &Ctx) -> bool {
    let Some(region) = value.as_object() else { return false };
    if region.len() != 4 || !["x", "y", "width", "height"].iter().all(|k| region.contains_key(*k)) {
        return false;
    }
    let get = |k: &str| region[k].as_f64().filter(|v| v.is_finite());
    let (Some(x), Some(y), Some(w), Some(h)) = (get("x"), get("y"), get("width"), get("height")) else { return false };
    let eps = 1e-6;
    x >= 0.0 && y >= 0.0 && w >= OCR_REGION_MIN_SIDE - eps && h >= OCR_REGION_MIN_SIDE - eps && x + w <= 1.0 + eps && y + h <= 1.0 + eps
}

fn tts_settings(value: &Value, ctx: &Ctx) -> Option<Value> {
    let platform = match ctx.env.platform {
        Platform::Windows => vrct_tts::settings::Platform::Windows,
        Platform::Linux => vrct_tts::settings::Platform::Other,
    };
    let settings = vrct_tts::settings::VoiceSettings::from_value_on(value, platform).ok()?;
    Some(settings.to_value())
}

/// The settings, in the order of `config.json`.
pub fn keys() -> Vec<Key> {
    let b = || plain(Ty::Bool);
    vec![
        readonly("VERSION"),
        readonly("PATH_LOCAL"),
        readonly("PATH_DATA"),
        readonly("PATH_CONFIG"),
        readonly("PATH_LOGS"),
        readonly("GITHUB_URL"),
        readonly("GITHUB_RELEASES_LIST_URL"),
        readonly("MIN_SUPPORTED_VERSION"),
        readonly("SELECTABLE_RELEASE_CHANNEL_LIST"),
        readonly("MAX_MIC_THRESHOLD"),
        readonly("MAX_SPEAKER_THRESHOLD"),
        readonly("WATCHDOG_TIMEOUT"),
        readonly("WATCHDOG_INTERVAL"),
        readonly("SELECTABLE_TAB_NO_LIST"),
        readonly("SELECTED_TAB_TARGET_LANGUAGES_NO_LIST"),
        readonly("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST"),
        readonly("SELECTABLE_TRANSLATION_ENGINE_LIST"),
        readonly("SELECTABLE_TRANSCRIPTION_ENGINE_LIST"),
        readonly("SELECTABLE_UI_LANGUAGE_LIST"),
        readonly("SELECTABLE_OCR_SOURCE_LANGUAGE_LIST"),
        readonly("COMPUTE_MODE"),
        readonly("SELECTABLE_COMPUTE_DEVICE_LIST"),
        readonly("SEND_MESSAGE_BUTTON_TYPE_LIST"),
        readonly("TRAY_COMPANION_EDGE_LIST"),
        runtime("ENABLE_TRANSLATION", b()),
        runtime("ENABLE_TRANSCRIPTION_SEND", b()),
        runtime("ENABLE_TRANSCRIPTION_RECEIVE", b()),
        runtime("ENABLE_OCR_CAPTURE", b()),
        key("ENABLE_FOREGROUND", b()),
        runtime("ENABLE_CHECK_ENERGY_SEND", b()),
        runtime("ENABLE_CHECK_ENERGY_RECEIVE", b()),
        runtime("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT", plain(Ty::Dict)),
        runtime("SELECTABLE_TRANSLATION_ENGINE_STATUS", plain(Ty::Dict)),
        runtime("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS", plain(Ty::Dict)),
        runtime("SELECTABLE_PLAMO_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_GEMINI_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_OPENAI_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_GROQ_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_OPENROUTER_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_LMSTUDIO_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_OLLAMA_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_GROQ_WHISPER_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_OPENAI_WHISPER_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_CUSTOM_WHISPER_MODEL_LIST", plain(Ty::List)),
        runtime("SELECTABLE_DEEPGRAM_MODEL_LIST", plain(Ty::List)),
        runtime("DEEPGRAM_MODEL_LANGUAGES", plain(Ty::Dict)),
        key("CONVERT_MESSAGE_TO_ROMAJI", b()),
        key("CONVERT_MESSAGE_TO_HIRAGANA", b()),
        key("MAIN_WINDOW_SIDEBAR_COMPACT_MODE", b()),
        key("TRANSPARENCY", plain(Ty::Int)),
        key("UI_SCALING", plain(Ty::Int)),
        key("TEXTBOX_UI_SCALING", plain(Ty::Int)),
        immediate("MESSAGE_BOX_RATIO", plain(Ty::Num)),
        key("SEND_MESSAGE_BUTTON_TYPE", one_of("SEND_MESSAGE_BUTTON_TYPE_LIST")),
        key("SHOW_RESEND_BUTTON", b()),
        key("FONT_FAMILY", plain(Ty::Str)),
        key("UI_LANGUAGE", one_of("SELECTABLE_UI_LANGUAGE_LIST")),
        immediate("MAIN_WINDOW_GEOMETRY", main_window_geometry()),
        key("MIC_THRESHOLD", managed(Ty::Int, false, |v, ctx| {
            v.as_i64().is_some_and(|v| v >= 0 && v <= ctx.get("MAX_MIC_THRESHOLD").as_i64().unwrap_or(0))
        })),
        key("MIC_AUTOMATIC_THRESHOLD", b()),
        key("MIC_RECORD_TIMEOUT", asr_timeout("MIC", "RECORD")),
        key("MIC_PHRASE_TIMEOUT", asr_timeout("MIC", "PHRASE")),
        key("MIC_MAX_PHRASES", int_in(0, 30)),
        key("MIC_AVG_LOGPROB", num_in(-2.0, 0.0)),
        key("MIC_NO_SPEECH_PROB", num_in(0.0, 1.0)),
        immediate("HOTKEYS", hotkeys()),
        immediate("EXPERIMENTAL_FEATURES", experimental_features()),
        // What the settings menu and the main switches show (#554). It changes no feature.
        immediate("USAGE_PRESETS", usage_presets()),
        // The screen edge the tray companion's hexagram hides at (src-tauri/src/companion.rs).
        key("TRAY_COMPANION_EDGE", one_of("TRAY_COMPANION_EDGE_LIST")),
        // The monitor it shows on, by the system's name for it; empty for the primary monitor.
        key("TRAY_COMPANION_MONITOR", managed(Ty::Str, false, |v, _| {
            v.as_str().is_some_and(|s| s.chars().count() <= 256 && !s.chars().any(char::is_control))
        })),
        key("SPEAKER_THRESHOLD", managed(Ty::Int, false, |v, ctx| {
            v.as_i64().is_some_and(|v| v >= 0 && v <= ctx.get("MAX_SPEAKER_THRESHOLD").as_i64().unwrap_or(0))
        })),
        key("SPEAKER_AUTOMATIC_THRESHOLD", b()),
        key("SPEAKER_RECORD_TIMEOUT", asr_timeout("SPEAKER", "RECORD")),
        key("SPEAKER_PHRASE_TIMEOUT", asr_timeout("SPEAKER", "PHRASE")),
        key("SPEAKER_MAX_PHRASES", int_in(0, 60)),
        key("SPEAKER_AVG_LOGPROB", num_in(-2.0, 0.0)),
        key("SPEAKER_NO_SPEECH_PROB", num_in(0.0, 1.0)),
        key("MIC_ENABLE_VAD", b()),
        key("SPEAKER_ENABLE_VAD", b()),
        key("AUTH_KEYS", credentials("AUTH_KEYS")),
        key("LMSTUDIO_URL", managed(Ty::Str, false, |v, _| valid_saved_api_url(v))),
        // Core only (#277): where Ollama runs (Python always used localhost:11434), and the
        // Client ID of Papago (its secret is in AUTH_KEYS).
        key("OLLAMA_URL", managed(Ty::Str, false, |v, _| valid_saved_api_url(v))),
        key("PAPAGO_CLIENT_ID", managed(Ty::Str, false, |v, _| v.as_str().is_some_and(|s| s.chars().count() <= 256 && !s.chars().any(char::is_control)))),
        key("OPENAI_COMPATIBLE_URL", managed(Ty::Str, false, |v, _| valid_saved_api_url(v))),
        key("TRANSCRIPTION_AUTH_KEYS", credentials("TRANSCRIPTION_AUTH_KEYS")),
        key("TRANSCRIPTION_CUSTOM_URL", managed(Ty::Str, false, |v, _| valid_saved_api_url(v))),
        key("OVERLAY_SMALL_LOG_SETTINGS", overlay_log("OVERLAY_SMALL_LOG_SETTINGS")),
        key("OVERLAY_LARGE_LOG_SETTINGS", overlay_log("OVERLAY_LARGE_LOG_SETTINGS")),
        key("OVERLAY_DESKTOP_SETTINGS", overlay_desktop()),
        key("OVERLAY_DESKTOP_PLACEMENT", overlay_desktop_placement()),
        key("IO_FLOW_OVERLAY_SETTINGS", io_flow_overlay()),
        key("OVERLAY_VR_PANEL_SETTINGS", overlay_vr_window("OVERLAY_VR_PANEL_SETTINGS")),
        key("OVERLAY_VR_LAUNCHER_SETTINGS", overlay_vr_window("OVERLAY_VR_LAUNCHER_SETTINGS")),
        key("SEND_MESSAGE_FORMAT_PARTS", message_format()),
        key("RECEIVED_MESSAGE_FORMAT_PARTS", message_format()),
        key("VOICE_SETTINGS", validated(tts_settings)),
        key("DIRECT_VOICE_SETTINGS", validated(|v, _| voice_settings::load_direct(v))),
        // Core only (#531): the block, in ms, that an RVC conversion cuts the microphone into
        // and converts. A key of its own: an older version that reads DIRECT_VOICE_SETTINGS
        // refuses a field it does not know, and would reset the model and index with it.
        key("RVC_BLOCK_MS", managed(Ty::Int, false, |v, _| is_valid_rvc_block_ms(v))),
        key("REALTIME_ASR_SETTINGS", validated(|v, _| voice_settings::normalize_realtime(v).ok())),
        key("SPEECH_SERVER_SETTINGS", validated(|v, _| vrct_speech_server::settings::normalize_settings(v).ok().map(|s| s.to_json()))),
        key("WEBSOCKET_SERVER", b()),
        key("OSC_IP_ADDRESS", plain(Ty::Str)),
        key("OSC_PORT", managed(Ty::Int, false, |v, _| is_valid_port(v))),
        // Core only (#559): OSCQuery (receiving VRChat's parameters, the mDNS advertisement and
        // the discovery of VRChat) runs; off, messages are still sent.
        key("OSC_QUERY", b()),
        key("AUTO_CLEAR_MESSAGE_BOX", b()),
        // Whether the app looks for a new version at start (#343; the UI reads it).
        key("CHECK_SOFTWARE_UPDATES", b()),
        key("SEND_ONLY_TRANSLATED_MESSAGES", b()),
        key("OVERLAY_SMALL_LOG", b()),
        key("OVERLAY_LARGE_LOG", b()),
        key("OVERLAY_DESKTOP", b()),
        key("OVERLAY_VR_PANEL", b()),
        key("OVERLAY_VR_PANEL_LOCKED", b()),
        key("OVERLAY_VR_PANEL_FONT_SIZE", plain(Ty::Int)),
        key("OVERLAY_VR_LAUNCHER_AUTO_HIDE", b()),
        key("OVERLAY_VR_TOOLTIP", b()),
        // Core only: the subtitles' font family on this system; "" is automatic (no font is bundled).
        key("OVERLAY_FONT_FAMILY", managed(Ty::Str, false, |v, _| v.as_str().is_some_and(|s| s.is_empty() || vrct_vr_overlay::fonts::valid_family_name(s)))),
        key("OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES", b()),
        key("SEND_MESSAGE_TO_VRC", b()),
        key("SEND_RECEIVED_MESSAGE_TO_VRC", b()),
        key("LOGGER_FEATURE", b()),
        key("VRC_MIC_MUTE_SYNC", b()),
        key("NOTIFICATION_VRC_SFX", b()),
        key("WEBSOCKET_HOST", managed(Ty::Str, false, |v, _| is_valid_websocket_host(v))),
        key("WEBSOCKET_PORT", managed(Ty::Int, false, |v, _| is_valid_port(v))),
        key("WEBSOCKET_AUTH_TOKEN", managed(Ty::Str, false, |v, _| v.as_str().is_some_and(|s| !s.trim().is_empty()))),
        key("WEBSOCKET_TLS_CERT_FILE", plain(Ty::Str)),
        key("WEBSOCKET_TLS_KEY_FILE", plain(Ty::Str)),
        key("OBS_BROWSER_SOURCE", b()),
        key("OBS_BROWSER_SOURCE_PORT", managed(Ty::Int, false, |v, _| is_valid_port(v))),
        key("OBS_BROWSER_SOURCE_MAX_MESSAGES", obs_numeric("MAX_MESSAGES")),
        key("OBS_BROWSER_SOURCE_DISPLAY_DURATION", obs_numeric("DISPLAY_DURATION")),
        key("OBS_BROWSER_SOURCE_FADEOUT_DURATION", obs_numeric("FADEOUT_DURATION")),
        key("OBS_BROWSER_SOURCE_FONT_SIZE", obs_numeric("FONT_SIZE")),
        key("OBS_BROWSER_SOURCE_FONT_COLOR", plain(Ty::Str)),
        key("OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS", obs_numeric("FONT_OUTLINE_THICKNESS")),
        key("OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR", plain(Ty::Str)),
        key("ENABLE_TELEMETRY", b()),
        immediate("TELEMETRY_NOTICE", int_in(0, 1000)),
        key("AUTO_DOWNLOAD_MODELS", b()),
        immediate("LEGACY_MODEL_DOWNLOAD_CONSENTS", managed(Ty::Dict, false, |v, _| {
            v.as_object().is_some_and(|o| o.values().all(Value::is_string))
        })),
        key("SELECTED_TAB_NO", one_of("SELECTABLE_TAB_NO_LIST")),
        key("SELECTED_TRANSCRIPTION_ENGINE", managed(Ty::Str, true, |v, ctx| {
            v.is_null() || ctx.list("SELECTABLE_TRANSCRIPTION_ENGINE_LIST").contains(v)
        })),
        key("SELECTED_RELEASE_CHANNEL", one_of("SELECTABLE_RELEASE_CHANNEL_LIST")),
        key("CTRANSLATE2_WEIGHT_TYPE", one_of("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST")),
        key("CTRANSLATE2_LICENSE_NOTICE_SHOWN", b()),
        key("LOCAL_ASR_MIGRATION", int_in(0, super::LOCAL_ASR_MIGRATION_LATEST)),
        key("LOCAL_ASR_NOTICE_PENDING", b()),
        key("VIRTUAL_MIC_NOTICE_PENDING", b()),
        key("FIRST_RUN_SETUP_PENDING", b()),
        key("SELECTED_PLAMO_MODEL", in_populated("SELECTABLE_PLAMO_MODEL_LIST")),
        key("SELECTED_GEMINI_MODEL", in_populated("SELECTABLE_GEMINI_MODEL_LIST")),
        key("SELECTED_OPENAI_MODEL", in_populated("SELECTABLE_OPENAI_MODEL_LIST")),
        key("SELECTED_GROQ_MODEL", in_populated("SELECTABLE_GROQ_MODEL_LIST")),
        key("SELECTED_OPENROUTER_MODEL", in_populated("SELECTABLE_OPENROUTER_MODEL_LIST")),
        key("SELECTED_LMSTUDIO_MODEL", in_populated("SELECTABLE_LMSTUDIO_MODEL_LIST")),
        key("SELECTED_OPENAI_COMPATIBLE_MODEL", in_populated("SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST")),
        key("SELECTED_OLLAMA_MODEL", in_populated("SELECTABLE_OLLAMA_MODEL_LIST")),
        key("SELECTED_GROQ_WHISPER_MODEL", in_populated("SELECTABLE_GROQ_WHISPER_MODEL_LIST")),
        key("SELECTED_OPENAI_WHISPER_MODEL", in_populated("SELECTABLE_OPENAI_WHISPER_MODEL_LIST")),
        key("SELECTED_CUSTOM_WHISPER_MODEL", in_populated("SELECTABLE_CUSTOM_WHISPER_MODEL_LIST")),
        key("SELECTED_DEEPGRAM_MODEL", in_populated("SELECTABLE_DEEPGRAM_MODEL_LIST")),
        key("MIC_WORD_FILTER", word_filter()),
        key("SELECTED_TRANSLATION_ENGINES", translation_engines_check()),
        key("SELECTED_YOUR_LANGUAGES", languages_check("SELECTED_YOUR_LANGUAGES", "your")),
        key("SELECTED_TARGET_LANGUAGES", languages_check("SELECTED_TARGET_LANGUAGES", "target")),
        key("SELECTED_TRANSLATION_COMPUTE_TYPE", compute_type()),
        key("AUTO_MIC_SELECT", b()),
        key("AUTO_SPEAKER_SELECT", b()),
        key("SELECTED_MIC_HOST", device_choice("NoHost", DeviceKind::MicHost)),
        key("SELECTED_MIC_DEVICE", device_choice("NoDevice", DeviceKind::Mic)),
        key("SELECTED_MIC_DEVICE_ID", validated(|v, _| v.is_string().then(|| v.clone()))),
        key("SELECTED_SPEAKER_DEVICE_ID", validated(|v, _| v.is_string().then(|| v.clone()))),
        key("SELECTED_SPEAKER_DEVICE", device_choice("NoDevice", DeviceKind::Speaker)),
        key("SELECTED_TRANSLATION_COMPUTE_DEVICE", validated(compute_device)),
        key("ENABLE_CLIPBOARD", b()),
        key("OCR_SOURCE_LANGUAGE", one_of("SELECTABLE_OCR_SOURCE_LANGUAGE_LIST")),
        key("OCR_WINDOW_TITLE", managed(Ty::Str, false, |v, _| v.as_str().is_some_and(|s| !s.is_empty()))),
        key("OCR_POLL_INTERVAL_MS", int_in(100, 5000)),
        key("OCR_MIN_CONFIDENCE", num_in(0.1, 0.99)),
        key("OCR_BUBBLE_MIN_TEXT_LENGTH", int_in(1, 50)),
        key("OCR_CAPTURE_REGION", managed(Ty::Dict, false, ocr_region)),
        key("OCR_VR_CAPTURE_REGION", managed(Ty::Dict, false, ocr_region)),
        key("OCR_CHATBOX_FILTER", b()),
        key("OCR_USE_CHATBOX_DETECTOR", b()),
        immediate("OCR_PORTAL_RESTORE_TOKEN", managed(Ty::Str, false, |v, _| {
            v.as_str().is_some_and(|s| s.chars().count() <= 512 && !s.chars().any(|c| (c as u32) < 32 || c as u32 == 127))
        })),
    ]
}

fn obs_numeric(name: &'static str) -> Check {
    use vrct_adapters::obs::settings::{NumericSetting, is_valid_numeric_setting};
    let setting = NumericSetting::from_name(name).expect("a known OBS setting");
    managed(Ty::Int, false, move |v, _| v.as_i64().is_some_and(|v| is_valid_numeric_setting(setting, v)))
}

/// The values of a fresh start (`init_config`), before `config.json` is read.
pub fn defaults(env: &Environment) -> Map<String, Value> {
    let tabs = json!(["1", "2", "3"]);
    let engines = languages::translation_engines();
    let transcription_engines = languages::transcription_engines();
    let compute = Value::Array(env.compute_devices.clone());
    let compute_mode = if env.compute_devices.iter().any(|d| d["device"] == "cuda") { "cuda" } else { "cpu" };
    let target_slot = |slot: &str| json!({ "language": "English", "country": "United States", "enable": slot == "1" });
    let mut your = Map::new();
    let mut target = Map::new();
    let mut selected_engines = Map::new();
    for tab in ["1", "2", "3"] {
        your.insert(tab.into(), json!({ "1": { "language": "Japanese", "country": "Japan", "enable": true } }));
        target.insert(tab.into(), json!({ "1": target_slot("1"), "2": target_slot("2"), "3": target_slot("3") }));
        selected_engines.insert(tab.into(), json!("CTranslate2"));
    }
    // The built-in weights, then the models the user added (`custom:<folder>`).
    let weights = crate::controller::translation::weight_ids(env);
    let weight_dict: Map<String, Value> = weights.iter().map(|w| (w.clone(), json!(false))).collect();
    let engine_status: Map<String, Value> = engines.iter().map(|e| (e.clone(), json!(false))).collect();
    let transcription_status: Map<String, Value> = transcription_engines.iter().map(|e| (e.clone(), json!(false))).collect();
    let overlay = |tracker: &str| json!({
        "x_pos": 0.0, "y_pos": 0.0, "z_pos": 0.0, "x_rotation": 0.0, "y_rotation": 0.0, "z_rotation": 0.0,
        "display_duration": 5, "fadeout_duration": 2, "opacity": 1.0, "ui_scaling": 1.0, "tracker": tracker,
    });
    let format_parts = json!({
        "message": { "prefix": "", "suffix": "" }, "separator": "\n",
        "translation": { "prefix": "", "separator": "\n", "suffix": "" }, "translation_first": false,
    });
    let voice = tts_settings(&json!({}), &Ctx::empty(env)).unwrap_or_else(|| json!({}));
    let speech = vrct_speech_server::settings::normalize_settings(&json!({})).map(|s| s.to_json()).unwrap_or_default();
    let realtime = voice_settings::normalize_realtime(&json!({})).unwrap_or_default();
    let entries: Vec<(&str, Value)> = vec![
        ("VERSION", json!(env.version)),
        ("PATH_LOCAL", json!(env.app_dir.to_string_lossy())),
        ("PATH_DATA", json!(env.data_dir.to_string_lossy())),
        ("PATH_CONFIG", json!(env.state_dir.join("config.json").to_string_lossy())),
        ("PATH_LOGS", json!(env.state_dir.join("logs").to_string_lossy())),
        ("GITHUB_URL", json!("https://api.github.com/repos/kein5/astarot/releases/latest")),
        ("GITHUB_RELEASES_LIST_URL", json!("https://api.github.com/repos/kein5/astarot/releases")),
        ("MIN_SUPPORTED_VERSION", json!("0.1.0")),
        ("SELECTABLE_RELEASE_CHANNEL_LIST", json!(["stable", "beta"])),
        ("MAX_MIC_THRESHOLD", json!(2000)),
        ("MAX_SPEAKER_THRESHOLD", json!(2000)),
        ("WATCHDOG_TIMEOUT", json!(60)),
        ("WATCHDOG_INTERVAL", json!(20)),
        ("SELECTABLE_TAB_NO_LIST", tabs.clone()),
        ("SELECTED_TAB_TARGET_LANGUAGES_NO_LIST", tabs),
        ("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST", json!(weights)),
        ("SELECTABLE_TRANSLATION_ENGINE_LIST", json!(engines)),
        ("SELECTABLE_TRANSCRIPTION_ENGINE_LIST", json!(transcription_engines)),
        ("SELECTABLE_UI_LANGUAGE_LIST", json!(["en", "ja"])),
        ("SELECTABLE_OCR_SOURCE_LANGUAGE_LIST", json!(languages::OCR_SOURCE_LANGUAGES)),
        ("COMPUTE_MODE", json!(compute_mode)),
        ("SELECTABLE_COMPUTE_DEVICE_LIST", compute.clone()),
        ("SEND_MESSAGE_BUTTON_TYPE_LIST", json!(["show", "hide", "show_and_disable_enter_key"])),
        ("TRAY_COMPANION_EDGE_LIST", json!(["right", "left", "top", "bottom"])),
        ("ENABLE_TRANSLATION", json!(false)),
        ("ENABLE_TRANSCRIPTION_SEND", json!(false)),
        ("ENABLE_TRANSCRIPTION_RECEIVE", json!(false)),
        ("ENABLE_OCR_CAPTURE", json!(false)),
        ("ENABLE_FOREGROUND", json!(false)),
        ("ENABLE_CHECK_ENERGY_SEND", json!(false)),
        ("ENABLE_CHECK_ENERGY_RECEIVE", json!(false)),
        ("SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT", Value::Object(weight_dict)),
        ("SELECTABLE_TRANSLATION_ENGINE_STATUS", Value::Object(engine_status)),
        ("SELECTABLE_TRANSCRIPTION_ENGINE_STATUS", Value::Object(transcription_status)),
        ("SELECTABLE_PLAMO_MODEL_LIST", json!([])),
        ("SELECTABLE_GEMINI_MODEL_LIST", json!([])),
        ("SELECTABLE_OPENAI_MODEL_LIST", json!([])),
        ("SELECTABLE_GROQ_MODEL_LIST", json!([])),
        ("SELECTABLE_OPENROUTER_MODEL_LIST", json!([])),
        ("SELECTABLE_LMSTUDIO_MODEL_LIST", json!([])),
        ("SELECTABLE_OPENAI_COMPATIBLE_MODEL_LIST", json!([])),
        ("SELECTABLE_OLLAMA_MODEL_LIST", json!([])),
        ("SELECTABLE_GROQ_WHISPER_MODEL_LIST", json!([])),
        ("SELECTABLE_OPENAI_WHISPER_MODEL_LIST", json!([])),
        ("SELECTABLE_CUSTOM_WHISPER_MODEL_LIST", json!([])),
        ("SELECTABLE_DEEPGRAM_MODEL_LIST", json!([])),
        ("DEEPGRAM_MODEL_LANGUAGES", json!({})),
        ("CONVERT_MESSAGE_TO_ROMAJI", json!(false)),
        ("CONVERT_MESSAGE_TO_HIRAGANA", json!(false)),
        ("MAIN_WINDOW_SIDEBAR_COMPACT_MODE", json!(false)),
        ("TRANSPARENCY", json!(100)),
        ("UI_SCALING", json!(100)),
        ("TEXTBOX_UI_SCALING", json!(100)),
        ("MESSAGE_BOX_RATIO", json!(10)),
        ("SEND_MESSAGE_BUTTON_TYPE", json!("show")),
        ("SHOW_RESEND_BUTTON", json!(false)),
        ("FONT_FAMILY", json!("Yu Gothic UI")),
        ("UI_LANGUAGE", json!("en")),
        ("MAIN_WINDOW_GEOMETRY", json!({ "x_pos": 0, "y_pos": 0, "width": 870, "height": 654 })),
        ("MIC_THRESHOLD", json!(300)),
        ("MIC_AUTOMATIC_THRESHOLD", json!(false)),
        ("MIC_RECORD_TIMEOUT", json!(3)),
        ("MIC_PHRASE_TIMEOUT", json!(3)),
        ("MIC_MAX_PHRASES", json!(10)),
        ("MIC_AVG_LOGPROB", json!(-0.8)),
        ("MIC_NO_SPEECH_PROB", json!(0.6)),
        ("HOTKEYS", json!({
            "open_quick_chat": null, "toggle_vrct_visibility": null, "toggle_translation": null,
            "toggle_transcription_send": null, "toggle_transcription_receive": null, "stop_voice": null,
            "toggle_voice_mute": null, "toggle_tts": null, "toggle_rvc": null,
        })),
        ("EXPERIMENTAL_FEATURES", experimental_features_default()),
        // A new install starts with the basic features; an update shows all (Config::migrate_usage_presets).
        ("USAGE_PRESETS", json!(["basic"])),
        ("TRAY_COMPANION_EDGE", json!("right")),
        ("TRAY_COMPANION_MONITOR", json!("")),
        ("SPEAKER_THRESHOLD", json!(300)),
        ("SPEAKER_AUTOMATIC_THRESHOLD", json!(false)),
        ("SPEAKER_RECORD_TIMEOUT", json!(3)),
        ("SPEAKER_PHRASE_TIMEOUT", json!(3)),
        ("SPEAKER_MAX_PHRASES", json!(10)),
        ("SPEAKER_AVG_LOGPROB", json!(-0.8)),
        ("SPEAKER_NO_SPEECH_PROB", json!(0.6)),
        ("MIC_ENABLE_VAD", json!(false)),
        ("SPEAKER_ENABLE_VAD", json!(false)),
        ("AUTH_KEYS", json!({
            "DeepL_API": null, "Plamo_API": null, "Gemini_API": null, "OpenAI_API": null,
            "OpenAI_Compatible": null, "Groq_API": null, "OpenRouter_API": null,
            "Google_Cloud_API": null, "Papago_API": null,
        })),
        ("LMSTUDIO_URL", json!("http://127.0.0.1:1234/v1")),
        ("OLLAMA_URL", json!("http://localhost:11434")),
        ("PAPAGO_CLIENT_ID", json!("")),
        ("OPENAI_COMPATIBLE_URL", json!("https://api.openai.com/v1")),
        ("TRANSCRIPTION_AUTH_KEYS", json!({ "Groq_Whisper": null, "OpenAI_Whisper": null, "Custom_Whisper": null, "Deepgram": null })),
        ("TRANSCRIPTION_CUSTOM_URL", json!("")),
        ("OVERLAY_SMALL_LOG_SETTINGS", overlay("HMD")),
        ("OVERLAY_LARGE_LOG_SETTINGS", overlay("LeftHand")),
        ("OVERLAY_DESKTOP_SETTINGS", json!({ "position": "bottom", "font_size": 28, "display_duration": 6, "opacity": 0.6 })),
        ("OVERLAY_DESKTOP_PLACEMENT", json!({ "x": null, "y": null })),
        ("IO_FLOW_OVERLAY_SETTINGS", json!({ "desktop": false, "count": 1 })),
        ("OVERLAY_VR_PANEL_SETTINGS", json!({
            "width": 900, "height": 700, "x_pos": 0.5209, "y_pos": 0.6442, "z_pos": -0.9509,
            "x_rotation": 95.0133, "y_rotation": 44.0232, "z_rotation": 42.6138,
            "display_duration": 5, "fadeout_duration": 0, "opacity": 1.0, "ui_scaling": 0.4, "tracker": "Playspace",
        })),
        ("OVERLAY_VR_LAUNCHER_SETTINGS", default_launcher()),
        ("SEND_MESSAGE_FORMAT_PARTS", format_parts.clone()),
        ("RECEIVED_MESSAGE_FORMAT_PARTS", format_parts),
        ("VOICE_SETTINGS", voice),
        ("DIRECT_VOICE_SETTINGS", voice_settings::default_direct()),
        ("RVC_BLOCK_MS", json!(vrct_voice_conversion::worker::DEFAULT_BLOCK_MS)),
        ("REALTIME_ASR_SETTINGS", realtime),
        ("SPEECH_SERVER_SETTINGS", speech),
        ("WEBSOCKET_SERVER", json!(false)),
        ("OSC_IP_ADDRESS", json!("127.0.0.1")),
        ("OSC_PORT", json!(9000)),
        ("OSC_QUERY", json!(true)),
        ("AUTO_CLEAR_MESSAGE_BOX", json!(true)),
        ("CHECK_SOFTWARE_UPDATES", json!(true)),
        ("SEND_ONLY_TRANSLATED_MESSAGES", json!(false)),
        ("OVERLAY_SMALL_LOG", json!(false)),
        ("OVERLAY_LARGE_LOG", json!(false)),
        ("OVERLAY_DESKTOP", json!(false)),
        ("OVERLAY_VR_PANEL", json!(false)),
        ("OVERLAY_VR_PANEL_LOCKED", json!(false)),
        ("OVERLAY_VR_PANEL_FONT_SIZE", json!(17)),
        ("OVERLAY_VR_LAUNCHER_AUTO_HIDE", json!(true)),
        ("OVERLAY_VR_TOOLTIP", json!(true)),
        ("OVERLAY_FONT_FAMILY", json!("")),
        ("OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES", json!(false)),
        ("SEND_MESSAGE_TO_VRC", json!(true)),
        ("SEND_RECEIVED_MESSAGE_TO_VRC", json!(false)),
        ("LOGGER_FEATURE", json!(false)),
        ("VRC_MIC_MUTE_SYNC", json!(false)),
        ("NOTIFICATION_VRC_SFX", json!(true)),
        ("WEBSOCKET_HOST", json!("127.0.0.1")),
        ("WEBSOCKET_PORT", json!(2231)),
        ("WEBSOCKET_AUTH_TOKEN", json!(env.websocket_token.clone().unwrap_or_else(super::new_token))),
        ("WEBSOCKET_TLS_CERT_FILE", json!("")),
        ("WEBSOCKET_TLS_KEY_FILE", json!("")),
        ("OBS_BROWSER_SOURCE", json!(false)),
        ("OBS_BROWSER_SOURCE_PORT", json!(2232)),
        ("OBS_BROWSER_SOURCE_MAX_MESSAGES", json!(14)),
        ("OBS_BROWSER_SOURCE_DISPLAY_DURATION", json!(60)),
        ("OBS_BROWSER_SOURCE_FADEOUT_DURATION", json!(12)),
        ("OBS_BROWSER_SOURCE_FONT_SIZE", json!(40)),
        ("OBS_BROWSER_SOURCE_FONT_COLOR", json!("#FFFFFF")),
        ("OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS", json!(3)),
        ("OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR", json!("#000000")),
        ("ENABLE_TELEMETRY", json!(true)),
        ("TELEMETRY_NOTICE", json!(0)),
        ("AUTO_DOWNLOAD_MODELS", json!(false)),
        ("LEGACY_MODEL_DOWNLOAD_CONSENTS", json!({})),
        ("SELECTED_TAB_NO", json!("1")),
        ("SELECTED_TRANSCRIPTION_ENGINE", Value::Null),
        ("SELECTED_RELEASE_CHANNEL", json!("stable")),
        ("CTRANSLATE2_WEIGHT_TYPE", json!(languages::DEFAULT_TRANSLATION_WEIGHT)),
        ("CTRANSLATE2_LICENSE_NOTICE_SHOWN", json!(false)),
        ("LOCAL_ASR_MIGRATION", json!(super::LOCAL_ASR_MIGRATION_LATEST)),
        ("LOCAL_ASR_NOTICE_PENDING", json!(false)),
        ("VIRTUAL_MIC_NOTICE_PENDING", json!(true)),
        ("FIRST_RUN_SETUP_PENDING", json!(true)),
        ("SELECTED_PLAMO_MODEL", Value::Null),
        ("SELECTED_GEMINI_MODEL", Value::Null),
        ("SELECTED_OPENAI_MODEL", Value::Null),
        ("SELECTED_GROQ_MODEL", Value::Null),
        ("SELECTED_OPENROUTER_MODEL", Value::Null),
        ("SELECTED_LMSTUDIO_MODEL", Value::Null),
        ("SELECTED_OPENAI_COMPATIBLE_MODEL", Value::Null),
        ("SELECTED_OLLAMA_MODEL", Value::Null),
        ("SELECTED_GROQ_WHISPER_MODEL", Value::Null),
        ("SELECTED_OPENAI_WHISPER_MODEL", Value::Null),
        ("SELECTED_CUSTOM_WHISPER_MODEL", Value::Null),
        ("SELECTED_DEEPGRAM_MODEL", Value::Null),
        ("MIC_WORD_FILTER", json!([])),
        ("SELECTED_TRANSLATION_ENGINES", Value::Object(selected_engines)),
        ("SELECTED_YOUR_LANGUAGES", Value::Object(your)),
        ("SELECTED_TARGET_LANGUAGES", Value::Object(target)),
        ("SELECTED_TRANSLATION_COMPUTE_TYPE", json!("auto")),
        ("AUTO_MIC_SELECT", json!(true)),
        ("AUTO_SPEAKER_SELECT", json!(true)),
        ("SELECTED_MIC_HOST", json!("NoHost")),
        ("SELECTED_MIC_DEVICE", json!("NoDevice")),
        ("SELECTED_MIC_DEVICE_ID", json!("")),
        ("SELECTED_SPEAKER_DEVICE_ID", json!("")),
        ("SELECTED_SPEAKER_DEVICE", json!("NoDevice")),
        ("SELECTED_TRANSLATION_COMPUTE_DEVICE", compute.get(0).cloned().unwrap_or(Value::Null)),
        ("ENABLE_CLIPBOARD", json!(false)),
        ("OCR_SOURCE_LANGUAGE", json!("auto")),
        ("OCR_WINDOW_TITLE", json!("VRChat")),
        ("OCR_POLL_INTERVAL_MS", json!(750)),
        ("OCR_MIN_CONFIDENCE", json!(0.85)),
        ("OCR_BUBBLE_MIN_TEXT_LENGTH", json!(2)),
        ("OCR_CAPTURE_REGION", json!({ "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0 })),
        ("OCR_VR_CAPTURE_REGION", json!({ "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0 })),
        ("OCR_CHATBOX_FILTER", json!(true)),
        ("OCR_USE_CHATBOX_DETECTOR", json!(true)),
        ("OCR_PORTAL_RESTORE_TOKEN", json!("")),
    ];
    entries.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
}

/// Where "reset the launcher" puts the wrist band (`DEFAULT_OVERLAY_VR_LAUNCHER_SETTINGS`).
pub fn default_launcher() -> Value {
    json!({
        "x_pos": 0.0641, "y_pos": -0.0416, "z_pos": -0.0063,
        "x_rotation": 9.3648, "y_rotation": -22.0338, "z_rotation": -17.1646,
        "display_duration": 5, "fadeout_duration": 0, "opacity": 1.0, "ui_scaling": 0.1984, "tracker": "LeftHand",
    })
}

#[cfg(test)]
mod tests {
    use super::normalize_experimental_features;
    use serde_json::json;

    // The real list is empty until a feature graduates, so these list made-up ones.
    const IDS: &[&str] = &["first_trial", "second_trial"];

    #[test]
    fn a_feature_left_out_keeps_its_value_and_an_unlisted_one_is_dropped() {
        let current = json!({ "first_trial": true, "second_trial": false });
        let new = normalize_experimental_features(IDS, &json!({ "second_trial": true, "graduated": true }), &current);
        assert_eq!(new, Some(json!({ "first_trial": true, "second_trial": true })));
        let fresh = normalize_experimental_features(IDS, &json!({}), &serde_json::Value::Null);
        assert_eq!(fresh, Some(json!({ "first_trial": false, "second_trial": false })));
    }

    #[test]
    fn a_value_that_is_not_a_bool_refuses_the_request() {
        for bad in [json!({ "first_trial": 1 }), json!({ "first_trial": "true" }), json!({ "first_trial": null }), json!("x"), json!([])] {
            assert_eq!(normalize_experimental_features(IDS, &bad, &json!({})), None, "{bad}");
        }
    }
}
