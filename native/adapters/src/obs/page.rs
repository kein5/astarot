//! The overlay page OBS loads as a browser source, byte for byte the page of
//! `_build_overlay_html` in `models/obs/obs_browser_source_server.py`.

use super::settings::NumericSetting;

const TEMPLATE: &str = include_str!("page.html");

/// The values the page is built from, read from the app's settings for each request.
/// Out-of-range numbers are clamped and malformed colours replaced, as in Python.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObsPageSettings {
    /// `WEBSOCKET_PORT`, as saved.
    pub websocket_port: i64,
    pub max_messages: i64,
    pub display_duration: i64,
    pub fadeout_duration: i64,
    pub font_size: i64,
    pub font_color: String,
    pub font_outline_thickness: i64,
    pub font_outline_color: String,
}

impl Default for ObsPageSettings {
    /// The fallbacks the Python page used for settings that were missing.
    fn default() -> Self {
        Self {
            websocket_port: 2231,
            max_messages: 14,
            display_duration: 60,
            fadeout_duration: 12,
            font_size: 40,
            font_color: "#FFFFFF".into(),
            font_outline_thickness: 3,
            font_outline_color: "#000000".into(),
        }
    }
}

fn clamp(value: i64, (minimum, maximum): (i64, i64)) -> i64 {
    value.clamp(minimum, maximum)
}

fn hex_color(value: &str, fallback: &str) -> String {
    let value = value.trim();
    let valid = value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|b| b.is_ascii_hexdigit());
    if valid {
        value.to_string()
    } else {
        fallback.to_string()
    }
}

fn numeric_ranges_json() -> String {
    // json.dumps of the Python dict: insertion order, ", " and ": " separators.
    let entry = |name: &str, setting: NumericSetting| {
        let (minimum, maximum) = setting.range();
        format!("\"{name}\": [{minimum}, {maximum}]")
    };
    format!(
        "{{{}}}",
        [
            entry("maxMessages", NumericSetting::MaxMessages),
            entry("displayDuration", NumericSetting::DisplayDuration),
            entry("fadeoutDuration", NumericSetting::FadeoutDuration),
            entry("fontSize", NumericSetting::FontSize),
            entry("outlineThickness", NumericSetting::FontOutlineThickness),
        ]
        .join(", ")
    )
}

/// The page with `ws_token` embedded. The token is only ever one the app made
/// (URL-safe base64), so it cannot break out of the JavaScript string.
pub fn build_overlay_html(settings: &ObsPageSettings, ws_token: &str) -> String {
    let value = |name: &str| -> String {
        match name {
            "WS_PORT" => clamp(settings.websocket_port, (1, 65535)).to_string(),
            "WS_TOKEN" => ws_token.to_string(),
            "MAX_MESSAGES" => clamp(settings.max_messages, NumericSetting::MaxMessages.range()).to_string(),
            "DISPLAY_DURATION" => clamp(settings.display_duration, NumericSetting::DisplayDuration.range()).to_string(),
            "FADEOUT_DURATION" => clamp(settings.fadeout_duration, NumericSetting::FadeoutDuration.range()).to_string(),
            "FONT_SIZE" => clamp(settings.font_size, NumericSetting::FontSize.range()).to_string(),
            "FONT_COLOR" => hex_color(&settings.font_color, "#FFFFFF"),
            "OUTLINE_THICKNESS" => {
                clamp(settings.font_outline_thickness, NumericSetting::FontOutlineThickness.range()).to_string()
            }
            "OUTLINE_COLOR" => hex_color(&settings.font_outline_color, "#000000"),
            "NUMERIC_RANGES" => numeric_ranges_json(),
            other => unreachable!("unknown page placeholder {other}"),
        }
    };
    // One pass over the template, so nothing substituted is read as a placeholder.
    let mut page = String::with_capacity(TEMPLATE.len() + 256);
    let mut rest = TEMPLATE;
    while let Some(start) = rest.find("@@") {
        page.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after.find("@@").expect("placeholders are closed");
        page.push_str(&value(&after[..end]));
        rest = &after[end + 2..];
    }
    page.push_str(rest);
    page
}
