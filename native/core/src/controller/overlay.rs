//! The VR overlay settings (`controller.py`: `setOverlaySmallLogSettings`,
//! `setOverlayLargeLogSettings`, `setOverlayVrPanelOpacity`, `setOverlayVrLauncherHand`,
//! `resetVrLauncher`, the lock and auto-hide switches, turning the overlays off, and
//! `getVrPanelLayout`).
//!
//! Python stored each value and then handed it to the running overlay, which did nothing while
//! none ran. The overlay itself is not wired to the core yet (#282): these endpoints store the
//! values the overlay reads when it starts, and the layout is the one Python computed while no
//! overlay ran. Turning an overlay on, moving the panel to another anchor and what the VR view
//! reports back wait for it.

use super::routes::{Builder, OPEN, WAIT};
use super::settings::{store, switch};
use super::{Core, error, ok, ok_true, python_float, python_round};
use crate::config::schema::default_launcher;
use crate::protocol::Reply;
use serde_json::{Value, json};

/// The log window's default size and the range a corner drag allows (logical px).
const PANEL_DEFAULT_SIZE: (i64, i64) = (900, 700);
const PANEL_SIZE_RANGE: ((f64, f64), (f64, f64)) = ((600.0, 400.0), (1400.0, 1000.0));
/// The launcher band's width (`LAUNCHER_WIDTH_PX` of `overlay_tooltip.py`).
const LAUNCHER_WIDTH_PX: i64 = 880;

/// `clampPanelSize`: Python's `round` sends a tie to the even number.
fn clamp_panel_size(width: f64, height: f64) -> (i64, i64) {
    let ((min_w, min_h), (max_w, max_h)) = PANEL_SIZE_RANGE;
    (width.clamp(min_w, max_w).round_ties_even() as i64, height.clamp(min_h, max_h).round_ties_even() as i64)
}

/// `computeVrLayout` in the form `vrLayoutToJson` sends: the captured VR view's size and the
/// region of each window. The log is at the top left, the launcher below it, the popup, the
/// toolbar and the tooltip in a column to its right.
fn vr_layout(width: i64, height: i64) -> Value {
    let right_x = width.max(PANEL_DEFAULT_SIZE.0).max(LAUNCHER_WIDTH_PX + 10) + 8;
    json!({
        "atlas": [right_x + 720, (height + 8 + 128).max(880)],
        "regions": {
            "panel": [0, 0, width, height],
            "launcher": [10, height + 8, LAUNCHER_WIDTH_PX, 128],
            "popup": [right_x, 0, 720, 640],
            "toolbar": [right_x, 656, 720, 96],
            "tooltip": [right_x, 760, 360, 120],
        },
    })
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

impl Core {
    /// `getVrPanelLayout` with no overlay running: the layout of the saved log size, and no
    /// tooltip drawn yet.
    fn vr_panel_layout(&self) -> Value {
        let settings = self.config().get("OVERLAY_VR_PANEL_SETTINGS");
        let size = |key: &str, default: i64| python_float(&settings[key]).unwrap_or(default as f64);
        let (width, height) = clamp_panel_size(size("width", PANEL_DEFAULT_SIZE.0), size("height", PANEL_DEFAULT_SIZE.1));
        let mut layout = vr_layout(width, height);
        layout["tooltip_epoch"] = json!(0);
        layout
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
        ok(current())
    }

    fn set_vr_launcher_hand(&self, data: &Value) -> Reply {
        let tracker = || self.config().get("OVERLAY_VR_LAUNCHER_SETTINGS")["tracker"].clone();
        let hand = match data.as_str() {
            Some(hand @ ("LeftHand" | "RightHand")) => hand,
            _ => return error("VALIDATION_CONFIG_VALUE_INVALID", tracker()),
        };
        let _guard = self.vr_window_lock.lock().unwrap();
        let current = self.config().get("OVERLAY_VR_LAUNCHER_SETTINGS");
        if current["tracker"] != hand {
            let mut moved = mirror_hand(&current);
            moved["tracker"] = json!(hand);
            if self.config().set("OVERLAY_VR_LAUNCHER_SETTINGS", moved).is_err() {
                return Reply::status(500, "Internal error");
            }
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
        self.notify("overlay_vr_launcher_hand", self.config().get("OVERLAY_VR_LAUNCHER_SETTINGS")["tracker"].clone());
        ok_true()
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    let core = b.core;
    b.with("/get/data/vr_panel_layout", OPEN, |core, _| ok(core.vr_panel_layout()));
    b.add("/set/data/overlay_small_log_settings", OPEN, store(core, "OVERLAY_SMALL_LOG_SETTINGS", "VALIDATION_CONFIG_VALUE_INVALID"));
    b.add("/set/data/overlay_large_log_settings", OPEN, store(core, "OVERLAY_LARGE_LOG_SETTINGS", "VALIDATION_CONFIG_VALUE_INVALID"));
    b.with("/set/data/overlay_vr_panel_opacity", OPEN, |core, data| core.set_vr_panel_opacity(data));
    b.with("/set/data/overlay_vr_launcher_hand", OPEN, |core, data| core.set_vr_launcher_hand(data));
    b.with("/run/vr_launcher_reset", WAIT, |core, _| core.reset_vr_launcher());
    for (name, key) in [("overlay_vr_panel_locked", "OVERLAY_VR_PANEL_LOCKED"), ("overlay_vr_launcher_auto_hide", "OVERLAY_VR_LAUNCHER_AUTO_HIDE")] {
        b.add(&format!("/set/enable/{name}"), OPEN, switch(core, key, true));
        b.add(&format!("/set/disable/{name}"), OPEN, switch(core, key, false));
    }
    // Turning an overlay off clears what it showed and stops it when nothing else needs it;
    // with no overlay running that leaves only the switch.
    for (name, key) in [("overlay_small_log", "OVERLAY_SMALL_LOG"), ("overlay_large_log", "OVERLAY_LARGE_LOG"), ("overlay_vr_panel", "OVERLAY_VR_PANEL")] {
        b.add(&format!("/set/disable/{name}"), OPEN, switch(core, key, false));
    }
}

#[cfg(test)]
mod tests {
    use super::{clamp_panel_size, mirror_hand, vr_layout};
    use serde_json::json;

    #[test]
    fn the_default_layout_is_the_one_the_vr_view_ships() {
        // src-ui/views/vr/vr_layout.json (not read from here: the Linux build copies only the
        // files a crate needs to build).
        let shipped = json!({
            "atlas": [1628, 880],
            "regions": {
                "panel": [0, 0, 900, 700],
                "launcher": [10, 708, 880, 128],
                "popup": [908, 0, 720, 640],
                "toolbar": [908, 656, 720, 96],
                "tooltip": [908, 760, 360, 120],
            },
        });
        assert_eq!(vr_layout(900, 700), shipped);
        // A large log moves the right column and grows the view.
        let large = vr_layout(1400, 1000);
        assert_eq!(large["atlas"], json!([2128, 1136]));
        assert_eq!(large["regions"]["popup"], json!([1408, 0, 720, 640]));
    }

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
}
