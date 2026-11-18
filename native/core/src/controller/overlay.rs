//! The VR overlays: the small and the large subtitle log, the VR panel and its launcher
//! (`controller.py`: `syncOverlayRunning`, the overlay switches and settings, `sendTextOverlay`,
//! the VR panel's endpoints and the overlay's callbacks; `model.py`'s overlay part).
//!
//! The overlay itself is `native/vr-overlay`. It is made with the routes, as Python made it
//! with the model, and runs while a subtitle log or the VR panel is on. Its thread waits for
//! SteamVR: turning an overlay on without SteamVR answers on and connects once SteamVR runs.
//!
//! The message pipeline shows messages through [`Core::show_overlay_message`] and the realtime
//! captions through [`Core::show_overlay_caption`] and [`Core::discard_overlay_captions`].

use super::routes::{Builder, OPEN, WAIT};
use super::settings::switch;
use super::{Core, error, ok, ok_true, python_float, python_round};
use crate::config::schema::default_launcher;
use crate::errors::ErrorReply;
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::sync::{Arc, Weak};
use vrct_vr_overlay::engine::{self, Event, Options, Overlay, PANEL_ANCHORS, Surface, WindowSettings};
use vrct_vr_overlay::fonts::{FontLibrary, valid_family_name};
use vrct_vr_overlay::placement;
use vrct_vr_overlay::subtitle::{CaptionId, CaptionState, Direction, LargePicture, Reading, Subtitle, Subtitles, Translation};
use vrct_vr_overlay::tooltip::validate_tooltip;

/// The log window's default size and the range a corner drag allows (logical px).
const PANEL_DEFAULT_SIZE: (i64, i64) = (900, 700);
const PANEL_SIZE_RANGE: ((f64, f64), (f64, f64)) = ((600.0, 400.0), (1400.0, 1000.0));
/// The large log's overlay is a quarter of its stored width (`Model.init`).
const LARGE_LOG_SCALE: f64 = 0.25;

/// `clampPanelSize`: Python's `round` sends a tie to the even number.
fn clamp_panel_size(width: f64, height: f64) -> (i64, i64) {
    let ((min_w, min_h), (max_w, max_h)) = PANEL_SIZE_RANGE;
    (width.clamp(min_w, max_w).round_ties_even() as i64, height.clamp(min_h, max_h).round_ties_even() as i64)
}

/// `mirrorHandPosition`: the same place on the other hand (the hands mirror along x).
fn mirror_hand(position: &Value) -> Value {
    let mut mirrored = position.clone();
    for key in ["x_pos", "y_rotation", "z_rotation"] {
        let negated = match &position[key] {
            Value::Number(n) if n.is_f64() => n.as_f64().map(|f| json!(-f)),
            Value::Number(n) => n.as_i64().map(|i| json!(-i)),
            _ => None,
        };
        if let Some(value) = negated {
            mirrored[key] = value;
        }
    }
    mirrored["tracker"] = json!(if position["tracker"] == "LeftHand" { "RightHand" } else { "LeftHand" });
    mirrored
}

/// The subtitle fonts: the system's. No font is bundled; the family chosen in the settings
/// (`OVERLAY_FONT_FAMILY`) comes first (decision 6 in `docs/voice-stack/core-integration.md`).
pub fn default_fonts(_environment: &crate::config::Environment) -> Arc<FontLibrary> {
    Arc::new(FontLibrary::new(Vec::new()))
}

/// The overlay and the subtitle pictures.
pub(crate) struct VrOverlay {
    engine: Overlay,
    subtitles: Subtitles,
    supported: bool,
}

/// One message for the logs, as the message pipeline has it (what Python's `small_overlay` and
/// `large_overlay` sinks passed to `createOverlayImage*`).
// Shown by the message pipeline, which is wired separately.
#[allow(dead_code)]
#[derive(Clone, Debug, Default)]
pub(crate) struct OverlayMessage {
    /// Shown on the right (sent: microphone, chat) or the left (received: speaker, OCR).
    pub received: bool,
    /// Whether the message may go to the small log too (`overlay_small_log`: the speaker only).
    pub small_log: bool,
    pub message: String,
    /// The original's language (`snapshot.source_language`).
    pub source_language: Option<String>,
    pub translations: Vec<String>,
    /// The enabled target languages, in order (`language_payload(destinations)` read as a list).
    pub target_languages: Vec<String>,
    /// The original's readings: a list of `{"orig", "hira", "hepburn"}`.
    pub transliteration_message: Value,
    /// Each translation's readings: a list of such lists.
    pub transliteration_translation: Value,
    /// Who spoke a realtime caption of the game audio, by the speech server's labels (#447).
    pub speakers: Vec<String>,
}

#[allow(dead_code)]
impl OverlayMessage {
    /// What the logs show. Only the translations when `only_translated`.
    fn subtitle(&self, only_translated: bool) -> Subtitle {
        let readings = |i: usize| self.transliteration_translation.get(i).map(Reading::list).unwrap_or_default();
        Subtitle {
            original: (!only_translated).then(|| self.message.clone()),
            language: if only_translated { None } else { self.source_language.clone() },
            readings: Reading::list(&self.transliteration_message),
            translations: self
                .translations
                .iter()
                .zip(&self.target_languages)
                .enumerate()
                .map(|(i, (text, language))| Translation { text: text.clone(), language: language.clone(), readings: readings(i) })
                .collect(),
            speakers: self.speakers.clone(),
        }
    }
}

fn settings_of(config: &crate::config::Config) -> [WindowSettings; 5] {
    let mut large = WindowSettings::from_json(&config.get("OVERLAY_LARGE_LOG_SETTINGS"));
    large.ui_scaling *= LARGE_LOG_SCALE;
    [
        WindowSettings::from_json(&config.get("OVERLAY_SMALL_LOG_SETTINGS")),
        large,
        WindowSettings::from_json(&config.get("OVERLAY_VR_PANEL_SETTINGS")),
        WindowSettings::from_json(&config.get("OVERLAY_VR_LAUNCHER_SETTINGS")),
        WindowSettings::from_json(&json!({
            "x_pos": 0.0, "y_pos": 0.0, "z_pos": 0.0, "x_rotation": 0.0, "y_rotation": 0.0, "z_rotation": 0.0,
            "display_duration": 5, "fadeout_duration": 0, "opacity": 1.0, "ui_scaling": 0.36, "tracker": "Playspace",
        })),
    ]
}

impl Core {
    fn vr(&self) -> Option<&VrOverlay> {
        self.vr.get()
    }

    /// Makes the overlay with the saved settings (`Model.init`). A launcher saved out of reach
    /// is first pulled back near the wrist.
    fn make_overlay(core: &Arc<Core>) {
        let config = core.config();
        let launcher = config.get("OVERLAY_VR_LAUNCHER_SETTINGS");
        let placement = WindowSettings::from_json(&launcher);
        let current = placement::Placement {
            x_pos: placement.position[0],
            y_pos: placement.position[1],
            z_pos: placement.position[2],
            x_rotation: placement.position[3],
            y_rotation: placement.position[4],
            z_rotation: placement.position[5],
            ui_scaling: placement.ui_scaling,
            tracker: vrct_vr_overlay::math::Tracker::from_setting(&placement.tracker),
        };
        if placement::launcher_out_of_reach(&current) {
            core.step("overlay: the saved launcher was out of reach; it moves near the wrist");
            let near = placement::launcher_nearest_in_reach(&current);
            let mut moved = launcher.clone();
            for (key, value) in [("x_pos", near.x_pos), ("y_pos", near.y_pos), ("z_pos", near.z_pos), ("ui_scaling", near.ui_scaling)] {
                moved[key] = json!(value);
            }
            let _ = config.set("OVERLAY_VR_LAUNCHER_SETTINGS", moved);
        }
        let services = core.services();
        let surface = services.vr_panel_surface.clone();
        let supported = surface.as_ref().is_some_and(|s| s.available());
        let weak: Weak<Core> = Arc::downgrade(core);
        let log = Arc::clone(core.log());
        let engine = Overlay::new(Options {
            vr: Arc::clone(&services.vr),
            surface,
            settings: settings_of(config),
            launcher_defaults: WindowSettings::from_json(&default_launcher()),
            events: Arc::new(move |event| {
                if let Some(core) = weak.upgrade() {
                    core.on_overlay_event(event);
                }
            }),
            log: Arc::new(move |text| log.step(text, None)),
            steamvr_poll: services.steamvr_poll,
        });
        let fonts = (services.overlay_fonts)(config.environment());
        let subtitles = Subtitles::new(fonts, Arc::new(vrct_vr_overlay::subtitle::local_time));
        // A saved family that is gone draws with the automatic fonts; the setting stays.
        subtitles.renderer.set_font_family(Some(&config.get_str("OVERLAY_FONT_FAMILY")));
        let _ = core.vr.set(VrOverlay { engine, subtitles, supported });
    }

    /// `/set/data/overlay_font_family`: a family on this system, or "" for automatic. The
    /// subtitles drawn after use it.
    fn set_overlay_font_family(&self, data: &Value) -> Reply {
        let current = || self.config().get("OVERLAY_FONT_FAMILY");
        let Some(family) = data.as_str().map(str::trim) else {
            return error("VALIDATION_CONFIG_VALUE_INVALID", current());
        };
        if !family.is_empty() && !valid_family_name(family) {
            return error("VALIDATION_CONFIG_VALUE_INVALID", current());
        }
        if let Some(vr) = self.vr()
            && !family.is_empty()
            && !vr.subtitles.renderer.library().has_family(family)
        {
            return error("OVERLAY_FONT_NOT_FOUND", current());
        }
        if self.config().set("OVERLAY_FONT_FAMILY", json!(family)).is_err() {
            return error("VALIDATION_CONFIG_VALUE_INVALID", current());
        }
        if let Some(vr) = self.vr() {
            vr.subtitles.renderer.set_font_family(Some(family));
        }
        ok(current())
    }

    /// `/get/data/overlay_font_missing_languages`: the languages no font on this system can
    /// draw (their text would be left out of the subtitles), for a notice in the settings.
    fn overlay_font_missing_languages(&self) -> Value {
        let missing = self.vr().map(|vr| vr.subtitles.renderer.library().missing_languages()).unwrap_or_default();
        json!(missing)
    }

    /// What the VR page learns when the overlay is made: the layout and the launcher's
    /// animation state (`setOverlayLayoutCallback`, `setOverlayLauncherIntroCallback`).
    pub(crate) fn announce_overlay(&self) {
        if let Some(vr) = self.vr() {
            self.notify("vr_panel_layout", vr.engine.vr_layout());
            self.notify("vr_panel_launcher_intro", json!("idle"));
        }
    }

    fn vr_panel_supported(&self) -> bool {
        self.vr().is_some_and(|vr| vr.supported)
    }

    /// Runs the overlay while a log or the VR panel is on and stops it otherwise
    /// (`syncOverlayRunning`). The VR panel counts only where it can run.
    pub(crate) fn sync_overlay_running(&self) -> bool {
        let Some(vr) = self.vr() else { return true };
        let config = self.config();
        let vr_panel = config.get_bool("OVERLAY_VR_PANEL") && vr.supported;
        vr.engine.set_vr_panel_enabled(vr_panel);
        vr.engine.set_panel_locked(config.get_bool("OVERLAY_VR_PANEL_LOCKED"));
        vr.engine.set_launcher_auto_hide(config.get_bool("OVERLAY_VR_LAUNCHER_AUTO_HIDE"));
        if config.get_bool("OVERLAY_SMALL_LOG") || config.get_bool("OVERLAY_LARGE_LOG") || vr_panel {
            vr.engine.start()
        } else {
            vr.engine.shutdown();
            true
        }
    }

    pub(crate) fn stop_overlay(&self) {
        if let Some(vr) = self.vr() {
            vr.engine.shutdown();
        }
    }

    fn enable_log(&self, key: &str) -> Reply {
        if !self.config().get_bool(key) {
            let _ = self.config().set(key, json!(true));
            if !self.sync_overlay_running() || !self.config().get_bool(key) {
                let _ = self.config().set(key, json!(false));
                return error("OVERLAY_RUNTIME_FAILED", json!(false));
            }
        }
        ok(self.config().get(key))
    }

    fn disable_log(&self, key: &str, surface: Surface) -> Reply {
        if self.config().get_bool(key) {
            let _ = self.config().set(key, json!(false));
            if let Some(vr) = self.vr() {
                vr.engine.clear_image(surface);
            }
            self.sync_overlay_running();
        }
        ok(self.config().get(key))
    }

    fn enable_vr_panel(&self) -> Reply {
        if !self.vr_panel_supported() {
            return error("OVERLAY_VR_PANEL_UNSUPPORTED", json!(false));
        }
        self.enable_log("OVERLAY_VR_PANEL")
    }

    fn disable_vr_panel(&self) -> Reply {
        if self.config().get_bool("OVERLAY_VR_PANEL") {
            let _ = self.config().set("OVERLAY_VR_PANEL", json!(false));
            self.sync_overlay_running();
        }
        ok(self.config().get("OVERLAY_VR_PANEL"))
    }

    /// Hands a log's stored settings to the running overlay (`updateOverlay*LogSettings`).
    fn apply_log_settings(&self, surface: Surface) {
        let Some(vr) = self.vr() else { return };
        let (key, scale) = if surface == Surface::Small { ("OVERLAY_SMALL_LOG_SETTINGS", 1.0) } else { ("OVERLAY_LARGE_LOG_SETTINGS", LARGE_LOG_SCALE) };
        let mut settings = WindowSettings::from_json(&self.config().get(key));
        settings.ui_scaling *= scale;
        vr.engine.set_window(surface, settings);
    }

    fn set_log_settings(&self, key: &'static str, surface: Surface, data: &Value) -> Reply {
        match self.config().set(key, data.clone()) {
            Ok(value) => {
                self.apply_log_settings(surface);
                ok(value)
            }
            Err(_) => error("VALIDATION_CONFIG_VALUE_INVALID", self.config().get(key)),
        }
    }

    /// `getVrPanelLayout`: the overlay's layout and tooltip generation; before the overlay is
    /// made, the layout of the saved log size and generation 0.
    fn vr_panel_layout(&self) -> Value {
        if let Some(vr) = self.vr() {
            return vr.engine.vr_layout();
        }
        let settings = self.config().get("OVERLAY_VR_PANEL_SETTINGS");
        let size = |key: &str, default: i64| python_float(&settings[key]).unwrap_or(default as f64);
        let (width, height) = clamp_panel_size(size("width", PANEL_DEFAULT_SIZE.0), size("height", PANEL_DEFAULT_SIZE.1));
        engine::layout_json(&vrct_vr_overlay::layout::VrLayout::for_panel(width as u32, height as u32), 0)
    }

    fn set_vr_panel_opacity(&self, data: &Value) -> Reply {
        let current = || self.config().get("OVERLAY_VR_PANEL_SETTINGS")["opacity"].clone();
        let opacity = match python_float(data) {
            Some(value) if (0.2..=1.0).contains(&value) => value,
            _ => return error("VALIDATION_CONFIG_VALUE_INVALID", current()),
        };
        {
            let _guard = self.vr_window_lock.lock().unwrap();
            let mut settings = self.config().get("OVERLAY_VR_PANEL_SETTINGS");
            settings["opacity"] = json!(python_round(opacity, 2));
            if self.config().set("OVERLAY_VR_PANEL_SETTINGS", settings).is_err() {
                return Reply::status(500, "Internal error");
            }
        }
        if let Some(vr) = self.vr() {
            vr.engine.set_panel_opacity(current().as_f64().unwrap_or(1.0));
        }
        ok(current())
    }

    fn set_vr_launcher_hand(&self, data: &Value) -> Reply {
        let tracker = || self.config().get("OVERLAY_VR_LAUNCHER_SETTINGS")["tracker"].clone();
        let hand = match data.as_str() {
            Some(hand @ ("LeftHand" | "RightHand")) => hand,
            _ => return error("VALIDATION_CONFIG_VALUE_INVALID", tracker()),
        };
        let changed = {
            let _guard = self.vr_window_lock.lock().unwrap();
            let current = self.config().get("OVERLAY_VR_LAUNCHER_SETTINGS");
            let changed = current["tracker"] != hand;
            if changed {
                let mut moved = mirror_hand(&current);
                moved["tracker"] = json!(hand);
                if self.config().set("OVERLAY_VR_LAUNCHER_SETTINGS", moved).is_err() {
                    return Reply::status(500, "Internal error");
                }
            }
            changed
        };
        if changed && let Some(vr) = self.vr() {
            vr.engine.set_window(Surface::Launcher, WindowSettings::from_json(&self.config().get("OVERLAY_VR_LAUNCHER_SETTINGS")));
        }
        ok(tracker())
    }

    fn reset_vr_launcher(&self) -> Reply {
        {
            let _guard = self.vr_window_lock.lock().unwrap();
            if self.config().set("OVERLAY_VR_LAUNCHER_SETTINGS", default_launcher()).is_err() {
                return Reply::status(500, "Internal error");
            }
        }
        if let Some(vr) = self.vr() {
            vr.engine.request_launcher_reset(false);
        }
        self.notify("overlay_vr_launcher_hand", self.config().get("OVERLAY_VR_LAUNCHER_SETTINGS")["tracker"].clone());
        ok_true()
    }

    fn set_vr_panel_anchor(&self, data: &Value) -> Reply {
        let anchor = data.as_str().filter(|a| PANEL_ANCHORS.contains(a));
        let Some(anchor) = anchor else {
            return error("VALIDATION_CONFIG_VALUE_INVALID", self.config().get("OVERLAY_VR_PANEL_SETTINGS")["tracker"].clone());
        };
        if let Some(vr) = self.vr() {
            vr.engine.request_anchor(anchor);
        }
        ok(data.clone())
    }

    /// `setVrPanelWindows`: the page alone sends it; anything but `true` is closed.
    fn set_vr_panel_windows(&self, data: &Value) -> Reply {
        let open = |key: &str| data.get(key).and_then(Value::as_bool) == Some(true);
        let (log, popup) = (open("log"), open("popup"));
        if let Some(vr) = self.vr() {
            vr.engine.set_vr_windows(log, popup);
        }
        ok(json!({ "log": log, "popup": popup }))
    }

    fn set_vr_panel_tooltip(&self, data: &Value) -> Reply {
        let Ok(tooltip) = validate_tooltip(data) else {
            return error("VALIDATION_CONFIG_VALUE_INVALID", Value::Null);
        };
        if let Some(vr) = self.vr() {
            vr.engine.set_tooltip(tooltip);
        }
        ok(data.clone())
    }

    /// `setVrPanelLayoutRendered`: two integers, the log size the page drew.
    fn set_vr_panel_layout_rendered(&self, data: &Value) -> Reply {
        let sizes: Option<Vec<i64>> = data.as_array().filter(|list| list.len() == 2).and_then(|list| list.iter().map(Value::as_i64).collect());
        let Some(sizes) = sizes else {
            return error("VALIDATION_CONFIG_VALUE_INVALID", Value::Null);
        };
        if let Some(vr) = self.vr() {
            let side = |v: i64| u32::try_from(v).unwrap_or(0);
            vr.engine.set_layout_rendered((side(sizes[0]), side(sizes[1])));
        }
        ok(data.clone())
    }

    /// `sendTextOverlay`: the settings' sample text on the logs that are on.
    fn send_text_overlay(&self, data: &Value) -> Reply {
        let Some(vr) = self.vr() else { return ok(data.clone()) };
        let text = match data {
            Value::String(text) => text.clone(),
            Value::Null => String::new(),
            other => other.to_string(),
        };
        let config = self.config();
        if config.get_bool("OVERLAY_SMALL_LOG") && vr.engine.initialized() {
            let token = vr.engine.publication_token(Surface::Small);
            if let Ok(picture) = vr.subtitles.renderer.small_sample(&text) {
                let current = || config.get_bool("OVERLAY_SMALL_LOG");
                if current() && vr.engine.publication_current(Surface::Small, token) {
                    let _ = vr.engine.update_image(Surface::Small, &picture.pixels, picture.width, picture.height, token, &current);
                }
            }
        }
        if config.get_bool("OVERLAY_LARGE_LOG") && vr.engine.initialized() {
            let token = vr.engine.publication_token(Surface::Large);
            if let Ok(picture) = vr.subtitles.renderer.large_sample(&text, &vrct_vr_overlay::subtitle::local_time()) {
                let current = || config.get_bool("OVERLAY_LARGE_LOG");
                if current() && vr.engine.publication_current(Surface::Large, token) {
                    let _ = vr.engine.update_image(Surface::Large, &picture.pixels, picture.width, picture.height, token, &current);
                }
            }
        }
        ok(data.clone())
    }

    fn publish_large(&self, vr: &VrOverlay, picture: &LargePicture, current: &dyn Fn() -> bool) -> bool {
        self.try_publish_large(vr, picture, current).unwrap_or(false)
    }

    /// [`Self::publish_large`] that says when the upload failed (`Err`), not only cancelled.
    fn try_publish_large(&self, vr: &VrOverlay, picture: &LargePicture, current: &dyn Fn() -> bool) -> Result<bool, ()> {
        let token = vr.engine.publication_token(Surface::Large);
        let current = || current() && self.config().get_bool("OVERLAY_LARGE_LOG");
        if !current() {
            return Ok(false);
        }
        let canvas = &picture.canvas;
        match vr.engine.update_image(Surface::Large, &canvas.pixels, canvas.width, canvas.height, token, &current) {
            Ok(shown) => Ok(shown),
            Err(_) => {
                self.step("overlay: showing the large log failed");
                Err(())
            }
        }
    }

    /// Shows a sent, received or read message on the logs that are on (the message pipeline's
    /// `small_overlay` and `large_overlay` sinks). `current` says whether the message is still
    /// wanted (it turns false when the pipeline was cancelled). Returns when it was shown or
    /// dropped; a large log not shown keeps the message out of its history.
    #[allow(dead_code)]
    pub(crate) fn show_overlay_message(&self, message: &OverlayMessage, current: &dyn Fn() -> bool) {
        let _ = self.show_overlay_logs(message, true, true, current);
    }

    /// One log's sink of the message pipeline (`small_overlay` or `large_overlay` in
    /// `_processMessage`): the pipeline decides per log whether the message goes there. `Err`
    /// when the picture could not be made or shown (the sink raised in Python), so that the
    /// pipeline reports `MESSAGE_OUTPUT_FAILED` for that log.
    pub(crate) fn show_overlay_log(&self, small: bool, message: &OverlayMessage, current: &dyn Fn() -> bool) -> Result<(), ()> {
        self.show_overlay_logs(message, small, !small, current)
    }

    fn show_overlay_logs(&self, message: &OverlayMessage, small: bool, large: bool, current: &dyn Fn() -> bool) -> Result<(), ()> {
        let Some(vr) = self.vr() else { return Ok(()) };
        let config = self.config();
        let only_translated = config.get_bool("OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES");
        if only_translated && message.translations.is_empty() {
            return Ok(());
        }
        let mut failed = false;
        let subtitle = message.subtitle(only_translated);
        if small && message.small_log && config.get_bool("OVERLAY_SMALL_LOG") && vr.engine.initialized() {
            let token = vr.engine.publication_token(Surface::Small);
            match vr.subtitles.renderer.small_log(&subtitle) {
                Ok(picture) => {
                    let still = || current() && config.get_bool("OVERLAY_SMALL_LOG");
                    if still() && vr.engine.update_image(Surface::Small, &picture.pixels, picture.width, picture.height, token, &still).is_err() {
                        self.step("overlay: showing the small log failed");
                        failed = true;
                    }
                }
                Err(_) => {
                    self.step("overlay: the small log's picture is too large");
                    failed = true;
                }
            }
        }
        if large && config.get_bool("OVERLAY_LARGE_LOG") && vr.engine.initialized() && current() {
            let direction = if message.received { Direction::Receive } else { Direction::Send };
            let upload_failed = std::cell::Cell::new(false);
            let published = vr.subtitles.publish_message(direction, subtitle, &mut |picture| {
                self.try_publish_large(vr, picture, current).unwrap_or_else(|()| {
                    upload_failed.set(true);
                    false
                })
            });
            if published.is_err() {
                self.step("overlay: the large log's picture is too large");
                failed = true;
            }
            failed |= upload_failed.get();
        }
        if failed { Err(()) } else { Ok(()) }
    }

    /// Adds or updates a realtime caption in the large log (`publishRealtimeCaptionOverlay`).
    /// `source` is "mic" or "speaker"; `state` "partial", "final", "translated" or "discarded".
    /// `Err` when the caption was refused or its picture could not be shown (Python raised, and
    /// the caption's `overlay_large` sink reported `MESSAGE_OUTPUT_FAILED`); the history then
    /// stays as it was shown.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn show_overlay_caption(
        &self,
        source: &str,
        namespace: &str,
        item: &str,
        state: &str,
        revision: u64,
        message: &OverlayMessage,
        current: &dyn Fn() -> bool,
    ) -> Result<(), ()> {
        let Some(vr) = self.vr() else { return Ok(()) };
        let config = self.config();
        if !(config.get_bool("OVERLAY_LARGE_LOG") && vr.engine.initialized() && current()) {
            return Ok(());
        }
        let only_translated = config.get_bool("OVERLAY_SHOW_ONLY_TRANSLATED_MESSAGES");
        let Some(state) = CaptionState::parse(state) else {
            self.step("overlay: a caption update was refused");
            return Err(());
        };
        if only_translated && message.translations.is_empty() && state != CaptionState::Discarded {
            return Ok(());
        }
        let id: CaptionId = (source.to_string(), namespace.to_string(), item.to_string());
        let direction = if source == "mic" { Direction::Send } else { Direction::Receive };
        let subtitle = message.subtitle(only_translated);
        let upload_failed = std::cell::Cell::new(false);
        let result = vr.subtitles.publish_caption(id, state, revision, direction, subtitle, &mut |picture| {
            self.try_publish_large(vr, picture, current).unwrap_or_else(|()| {
                upload_failed.set(true);
                false
            })
        });
        if result.is_err() {
            self.step("overlay: a caption update was refused");
            return Err(());
        }
        if upload_failed.get() { Err(()) } else { Ok(()) }
    }

    /// The names the user gave the voices of a realtime session (#447): the large log draws
    /// them in place of the labels, also on the captions it shows already.
    pub(crate) fn name_overlay_speakers(&self, namespace: &str, names: Vec<(String, String)>) {
        let Some(vr) = self.vr() else { return };
        vr.subtitles.set_speaker_names(namespace, names, &mut |picture| self.publish_large(vr, picture, &|| true));
    }

    /// Drops the captions still being recognised for a source's namespace
    /// (`clearRealtimeCaptionOverlay`).
    pub(crate) fn discard_overlay_captions(&self, source: &str, namespace: &str) {
        let Some(vr) = self.vr() else { return };
        vr.subtitles.discard_captions(source, namespace, &mut |picture| self.publish_large(vr, picture, &|| true));
    }

    /// What the overlay's thread reports (`_onOverlayFailure`, `_onVrPanelLayout`,
    /// `_onVrPanelLogOutOfView`, `_onVrPanelLauncherIntro`, `_onOverlayPositionChanged`,
    /// `_onVrPanelPointer`).
    fn on_overlay_event(&self, event: Event) {
        match event {
            Event::Failure(reason) => {
                let config = self.config();
                if reason == "runtime" {
                    let _ = config.set("OVERLAY_SMALL_LOG", json!(false));
                    let _ = config.set("OVERLAY_LARGE_LOG", json!(false));
                }
                let _ = config.set("OVERLAY_VR_PANEL", json!(false));
                if let Some(vr) = self.vr() {
                    vr.engine.set_vr_panel_enabled(false);
                    if !(config.get_bool("OVERLAY_SMALL_LOG") || config.get_bool("OVERLAY_LARGE_LOG")) {
                        vr.engine.shutdown();
                    }
                }
                let error = ErrorReply::new("OVERLAY_RUNTIME_FAILED", json!({ "reason": reason }));
                self.run(400, super::run_endpoint("message_output_error"), error.into_body());
            }
            Event::Layout(layout) => self.notify("vr_panel_layout", layout),
            Event::PanelOutOfView(out) => self.notify("vr_panel_log_out_of_view", json!(out)),
            Event::LauncherIntro(state) => self.notify("vr_panel_launcher_intro", json!(state)),
            Event::Position(surface, position) => self.on_overlay_position(surface, position),
            // `_onVrPanelPointer`: the hover position on the VR page, or null off it.
            Event::Pointer(xy) => self.notify("vr_panel_pointer", xy.map_or(Value::Null, |(x, y)| json!({ "x": x, "y": y }))),
        }
    }

    fn on_overlay_position(&self, surface: Surface, mut position: Value) {
        let clamp = |value: f64| python_round(value.clamp(0.4, 2.0), 2);
        let merge = |key: &str, position: &Value| {
            let mut settings = self.config().get(key);
            if let (Some(settings), Some(position)) = (settings.as_object_mut(), position.as_object()) {
                for (k, v) in position {
                    settings.insert(k.clone(), v.clone());
                }
            }
            let _ = self.config().set(key, settings);
        };
        match surface {
            Surface::Small | Surface::Large => {
                let (key, scale, name) = if surface == Surface::Small {
                    ("OVERLAY_SMALL_LOG_SETTINGS", 1.0, "overlay_small_log_settings")
                } else {
                    ("OVERLAY_LARGE_LOG_SETTINGS", LARGE_LOG_SCALE, "overlay_large_log_settings")
                };
                let scaling = position["ui_scaling"].as_f64().unwrap_or(1.0) / scale;
                position["ui_scaling"] = json!(clamp(scaling));
                merge(key, &position);
                self.apply_log_settings(surface);
                self.notify(name, self.config().get(key));
            }
            Surface::Panel => {
                {
                    let _guard = self.vr_window_lock.lock().unwrap();
                    merge("OVERLAY_VR_PANEL_SETTINGS", &position);
                }
                self.notify("overlay_vr_panel_anchor", position["tracker"].clone());
            }
            Surface::Launcher => {
                let _guard = self.vr_window_lock.lock().unwrap();
                merge("OVERLAY_VR_LAUNCHER_SETTINGS", &position);
            }
            Surface::Popup => {}
        }
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    let core = b.core;
    Core::make_overlay(core);
    b.with("/run/send_text_overlay", OPEN, |core, data| core.send_text_overlay(data));
    b.with("/set/enable/overlay_small_log", OPEN, |core, _| core.enable_log("OVERLAY_SMALL_LOG"));
    b.with("/set/disable/overlay_small_log", OPEN, |core, _| core.disable_log("OVERLAY_SMALL_LOG", Surface::Small));
    b.with("/run/vr_panel_tooltip", WAIT, |core, data| core.set_vr_panel_tooltip(data));
    b.with("/run/vr_panel_windows", WAIT, |core, data| core.set_vr_panel_windows(data));
    b.with("/run/vr_panel_recall_log", WAIT, |core, _| {
        if let Some(vr) = core.vr() {
            vr.engine.request_recall();
        }
        ok_true()
    });
    b.with("/run/vr_launcher_reset", WAIT, |core, _| core.reset_vr_launcher());
    b.with("/get/data/vr_panel_layout", OPEN, |core, _| ok(core.vr_panel_layout()));
    b.with("/run/vr_panel_layout_rendered", OPEN, |core, data| core.set_vr_panel_layout_rendered(data));
    b.with("/set/data/overlay_vr_panel_anchor", OPEN, |core, data| core.set_vr_panel_anchor(data));
    b.with("/set/data/overlay_vr_launcher_hand", OPEN, |core, data| core.set_vr_launcher_hand(data));
    for (name, on) in [("enable", true), ("disable", false)] {
        b.with(&format!("/set/{name}/overlay_vr_launcher_auto_hide"), OPEN, move |core, data| {
            let reply = switch(core, "OVERLAY_VR_LAUNCHER_AUTO_HIDE", on)(data);
            if let Some(vr) = core.vr() {
                vr.engine.set_launcher_auto_hide(on);
            }
            reply
        });
        b.with(&format!("/set/{name}/overlay_vr_panel_locked"), OPEN, move |core, data| {
            let reply = switch(core, "OVERLAY_VR_PANEL_LOCKED", on)(data);
            if let Some(vr) = core.vr() {
                vr.engine.set_panel_locked(on);
            }
            reply
        });
    }
    b.with("/set/data/overlay_vr_panel_opacity", OPEN, |core, data| core.set_vr_panel_opacity(data));
    b.with("/set/data/overlay_small_log_settings", OPEN, |core, data| core.set_log_settings("OVERLAY_SMALL_LOG_SETTINGS", Surface::Small, data));
    b.with("/set/enable/overlay_vr_panel", OPEN, |core, _| core.enable_vr_panel());
    b.with("/set/disable/overlay_vr_panel", OPEN, |core, _| core.disable_vr_panel());
    b.with("/set/enable/overlay_large_log", OPEN, |core, _| core.enable_log("OVERLAY_LARGE_LOG"));
    b.with("/set/disable/overlay_large_log", OPEN, |core, _| core.disable_log("OVERLAY_LARGE_LOG", Surface::Large));
    b.with("/set/data/overlay_large_log_settings", OPEN, |core, data| core.set_log_settings("OVERLAY_LARGE_LOG_SETTINGS", Surface::Large, data));
    b.get("/get/data/overlay_font_family", OPEN, "OVERLAY_FONT_FAMILY");
    b.with("/set/data/overlay_font_family", OPEN, |core, data| core.set_overlay_font_family(data));
    b.with("/get/data/overlay_font_missing_languages", OPEN, |core, _| ok(core.overlay_font_missing_languages()));
}

#[cfg(test)]
mod tests {
    use super::{OverlayMessage, clamp_panel_size, mirror_hand};
    use serde_json::json;

    #[test]
    fn the_size_is_clamped_and_rounded_like_python() {
        assert_eq!(clamp_panel_size(100.0, 5000.0), (600, 1000));
        assert_eq!(clamp_panel_size(650.5, 401.5), (650, 402));
    }

    #[test]
    fn the_other_hand_mirrors_x_and_the_y_and_z_rotations() {
        let left = json!({"x_pos": 0.0641, "y_pos": -0.0416, "y_rotation": -22.0338, "z_rotation": -17.1646, "x_rotation": 9.3648, "tracker": "LeftHand"});
        let right = mirror_hand(&left);
        assert_eq!(right["x_pos"], json!(-0.0641));
        assert_eq!(right["y_pos"], json!(-0.0416));
        assert_eq!(right["y_rotation"], json!(22.0338));
        assert_eq!(right["z_rotation"], json!(17.1646));
        assert_eq!(right["x_rotation"], json!(9.3648));
        assert_eq!(right["tracker"], json!("RightHand"));
    }

    #[test]
    fn a_message_pairs_translations_with_their_languages_and_readings() {
        let message = OverlayMessage {
            message: "こんにちは".into(),
            source_language: Some("Japanese".into()),
            translations: vec!["Hello".into(), "Hola".into()],
            target_languages: vec!["English".into()],
            transliteration_message: json!([{"orig": "こんにちは", "hira": "こんにちは", "hepburn": "konnichiha"}]),
            transliteration_translation: json!([[{"orig": "Hello", "hira": "", "hepburn": ""}]]),
            ..OverlayMessage::default()
        };
        let all = message.subtitle(false);
        assert_eq!(all.original.as_deref(), Some("こんにちは"));
        assert_eq!(all.translations.len(), 1, "zip stops at the shorter list");
        assert_eq!(all.translations[0].readings.len(), 1);
        assert_eq!(all.readings[0].hepburn, "konnichiha");
        let only = message.subtitle(true);
        assert_eq!((only.original, only.language), (None, None));
    }
}
