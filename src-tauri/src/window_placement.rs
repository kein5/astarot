//! Puts the main window where it was last saved before it is first shown.
//!
//! The main window is made hidden (tauri.conf.json, `visible: false`). The saved geometry
//! (`MAIN_WINDOW_GEOMETRY` in config.json) used to reach the window only once the backend had
//! started, through the UI: the window showed centred, then jumped to the saved place, or to the
//! top left on a first launch. Here it is read and applied before the window is shown, so the
//! window appears once, where it stays. The rules are the ones the UI used
//! (`src-ui/logics/common/useWindow.js`, `windowGeometry.ts`), except that a first launch is
//! centred on its monitor instead of put at the top left.

use serde_json::Value;
use std::path::Path;

/// The geometry the backend has until the window is moved or resized (MAIN_WINDOW_GEOMETRY's
/// default in `native/core/src/config/schema.rs`; `BUILT_IN_GEOMETRY` in `windowGeometry.ts`).
/// Its size is meant in CSS pixels; a saved one is in physical pixels.
pub const BUILT_IN: Geometry = Geometry { x: 0, y: 0, width: 870, height: 654 };

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A rectangle in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn contains(&self, x: i32, y: i32) -> bool {
        i64::from(x) >= i64::from(self.x)
            && i64::from(y) >= i64::from(self.y)
            && i64::from(x) < i64::from(self.x) + i64::from(self.width)
            && i64::from(y) < i64::from(self.y) + i64::from(self.height)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Monitor {
    pub bounds: Rect,
    pub work_area: Rect,
    pub scale: f64,
}

/// The saved geometry in `config.json`, or `None` when there is none to read. A value that is
/// not a whole number keeps the default's, as the backend's own check does.
pub fn saved(state_dir: &Path) -> Option<Geometry> {
    let text = std::fs::read_to_string(state_dir.join("config.json")).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    parse(value.get("MAIN_WINDOW_GEOMETRY")?)
}

fn parse(value: &Value) -> Option<Geometry> {
    let object = value.as_object()?;
    let number = |key: &str| -> Option<i64> {
        match object.get(key)? {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.trim().parse().ok(),
            _ => None,
        }
    };
    let width = number("width").and_then(|v| u32::try_from(v).ok()).filter(|v| *v > 0).unwrap_or(BUILT_IN.width);
    let height = number("height").and_then(|v| u32::try_from(v).ok()).filter(|v| *v > 0).unwrap_or(BUILT_IN.height);
    Some(Geometry {
        x: number("x_pos").and_then(|v| i32::try_from(v).ok()).unwrap_or(BUILT_IN.x),
        y: number("y_pos").and_then(|v| i32::try_from(v).ok()).unwrap_or(BUILT_IN.y),
        width,
        height,
    })
}

/// Where the window goes. `fallback` is the monitor used when the saved place is on none of
/// `monitors` (a monitor unplugged since) and on a first launch: the one the window is on.
/// `None` when no monitor is known; the window then stays where it was made.
pub fn place(saved: Option<Geometry>, monitors: &[Monitor], fallback: Option<Monitor>) -> Option<Geometry> {
    let first = saved.is_none_or(|geometry| geometry == BUILT_IN);
    let geometry = saved.unwrap_or(BUILT_IN);
    let monitor = if first {
        fallback.or_else(|| monitors.first().copied())?
    } else {
        monitors.iter().copied().find(|m| m.bounds.contains(geometry.x, geometry.y)).or(fallback).or_else(|| monitors.first().copied())?
    };
    // The first window keeps clear of the taskbar; a saved one keeps to the monitor's bounds.
    let area = if first { monitor.work_area } else { monitor.bounds };
    let scale = if first && monitor.scale > 1.0 { monitor.scale } else { 1.0 };
    let size = |value: u32, limit: u32| ((f64::from(value) * scale).round() as u32).min(limit).max(1);
    let width = size(geometry.width, area.width);
    let height = size(geometry.height, area.height);
    let clamp = |at: i32, length: u32, start: i32, span: u32| -> i32 {
        let end = i64::from(start) + i64::from(span) - i64::from(length);
        (i64::from(at).min(end).max(i64::from(start))) as i32
    };
    let (x, y) = if first {
        (
            area.x + (area.width.saturating_sub(width) / 2) as i32,
            area.y + (area.height.saturating_sub(height) / 2) as i32,
        )
    } else {
        (clamp(geometry.x, width, area.x, area.width), clamp(geometry.y, height, area.y, area.height))
    };
    Some(Geometry { x, y, width, height })
}

fn monitor(m: &tauri::Monitor) -> Monitor {
    let rect = |position: &tauri::PhysicalPosition<i32>, size: &tauri::PhysicalSize<u32>| Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let work = m.work_area();
    Monitor { bounds: rect(m.position(), m.size()), work_area: rect(&work.position, &work.size), scale: m.scale_factor() }
}

/// Moves and sizes the hidden main window to its saved place. Failures are logged; the window
/// then shows where it was made (centred).
pub fn apply(window: &tauri::WebviewWindow, state_dir: &Path) {
    let monitors: Vec<Monitor> = window.available_monitors().unwrap_or_default().iter().map(monitor).collect();
    let fallback = window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten());
    let Some(target) = place(saved(state_dir), &monitors, fallback.as_ref().map(monitor)) else {
        crate::startup_log("Main window placement: no monitor found; it opens centred");
        return;
    };
    if let Err(error) = window.set_size(tauri::PhysicalSize::new(target.width, target.height)) {
        crate::startup_log(&format!("Main window size failed: {error}"));
    }
    if let Err(error) = window.set_position(tauri::PhysicalPosition::new(target.x, target.y)) {
        crate::startup_log(&format!("Main window position failed: {error}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect { x, y, width, height }
    }
    const fn g(x: i32, y: i32, width: u32, height: u32) -> Geometry {
        Geometry { x, y, width, height }
    }
    const MAIN: Monitor = Monitor { bounds: rect(0, 0, 1920, 1080), work_area: rect(0, 0, 1920, 1040), scale: 1.0 };
    const RIGHT: Monitor = Monitor { bounds: rect(1920, 0, 1280, 800), work_area: rect(1920, 0, 1280, 760), scale: 1.25 };

    #[test]
    fn a_first_launch_is_centred_in_the_work_area_and_sized_in_css_pixels() {
        assert_eq!(place(None, &[MAIN], Some(MAIN)), Some(g(525, 193, 870, 654)));
        assert_eq!(place(Some(BUILT_IN), &[MAIN], Some(MAIN)), Some(g(525, 193, 870, 654)));
        // 870x654 CSS pixels are 1088x818 at 125%; the height stops at the taskbar.
        assert_eq!(place(None, &[MAIN, RIGHT], Some(RIGHT)), Some(g(1920 + 96, 0, 1088, 760)));
    }

    #[test]
    fn a_saved_geometry_is_restored_as_it_was() {
        assert_eq!(place(Some(g(40, 30, 870, 654)), &[MAIN, RIGHT], Some(MAIN)), Some(g(40, 30, 870, 654)));
        assert_eq!(place(Some(g(2000, 10, 700, 500)), &[MAIN, RIGHT], Some(MAIN)), Some(g(2000, 10, 700, 500)));
        // The top left of the monitor, once saved, is kept (it is not the built-in geometry).
        assert_eq!(place(Some(g(0, 0, 1088, 818)), &[MAIN], Some(MAIN)), Some(g(0, 0, 1088, 818)));
    }

    #[test]
    fn a_saved_place_off_every_monitor_comes_back_onto_one() {
        // The right monitor was unplugged: onto the one the window is on, inside its bounds.
        assert_eq!(place(Some(g(2500, 300, 870, 654)), &[MAIN], Some(MAIN)), Some(g(1920 - 870, 300, 870, 654)));
        assert_eq!(place(Some(g(-5000, -5000, 870, 654)), &[MAIN], Some(MAIN)), Some(g(0, 0, 870, 654)));
        // Hanging over the bottom right edge, and larger than the monitor.
        assert_eq!(place(Some(g(1500, 900, 870, 654)), &[MAIN], Some(MAIN)), Some(g(1050, 426, 870, 654)));
        assert_eq!(place(Some(g(10, 10, 4000, 3000)), &[MAIN], Some(MAIN)), Some(g(0, 0, 1920, 1080)));
    }

    #[test]
    fn without_a_monitor_the_window_stays_where_it_was_made() {
        assert_eq!(place(Some(g(40, 30, 870, 654)), &[], None), None);
        // Without the window's own monitor, the first one listed is used.
        assert_eq!(place(None, &[MAIN], None), Some(g(525, 193, 870, 654)));
    }

    #[test]
    fn the_built_in_geometry_is_the_backends_default() {
        let schema = include_str!("../../native/core/src/config/schema.rs");
        assert!(schema.contains(r#"("MAIN_WINDOW_GEOMETRY", json!({ "x_pos": 0, "y_pos": 0, "width": 870, "height": 654 }))"#));
        assert_eq!(BUILT_IN, g(0, 0, 870, 654));
    }

    #[test]
    fn the_saved_geometry_is_read_like_the_backend_reads_it() {
        assert_eq!(parse(&serde_json::json!({ "x_pos": 40, "y_pos": -20, "width": 900, "height": 700 })), Some(g(40, -20, 900, 700)));
        assert_eq!(parse(&serde_json::json!({ "x_pos": "40", "y_pos": "30", "width": "900", "height": "700" })), Some(g(40, 30, 900, 700)));
        assert_eq!(parse(&serde_json::json!({ "x_pos": 1.5, "y_pos": null, "width": 0, "height": "x" })), Some(BUILT_IN));
        assert_eq!(parse(&serde_json::json!([1, 2])), None);
        let dir = std::env::temp_dir().join(format!("vrct-window-placement-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(saved(&dir), None, "no config.json");
        std::fs::write(dir.join("config.json"), r#"{"MAIN_WINDOW_GEOMETRY":{"x_pos":5,"y_pos":6,"width":700,"height":500}}"#).unwrap();
        assert_eq!(saved(&dir), Some(g(5, 6, 700, 500)));
        std::fs::write(dir.join("config.json"), "not json").unwrap();
        assert_eq!(saved(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
