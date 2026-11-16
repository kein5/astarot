//! The VR page's atlas: one webview draws every VR window side by side, the overlay
//! photographs it once and each SteamVR overlay shows one region of the picture.
//!
//! This is the one place the arrangement is computed. The React page reads the same
//! numbers (`src-ui/views/vr/vr_layout.json` holds the default) and the Linux offscreen
//! surface starts at the default atlas size; tests check both agree with this module.
use super::math::{self, Mat34, Mat4, Vec3};

/// Width of the launcher band in logical px (seven buttons and their separators).
pub const LAUNCHER_WIDTH_PX: u32 = 880;
/// The width the stored launcher `ui_scaling` refers to. Saved values predate a 72 px mark
/// that was removed, so the stored metres-per-band stay meaningful by converting with this.
pub const LAUNCHER_SAVED_WIDTH_PX: u32 = 952;
pub const PANEL_DEFAULT_SIZE: (u32, u32) = (900, 700);
pub const PANEL_SIZE_RANGE: ((u32, u32), (u32, u32)) = ((600, 400), (1400, 1000));
/// The toolbar's real size does not follow the log's scale (64 px buttons are about 28 mm).
pub const TOOLBAR_M_PER_PX: f64 = 0.4 / 900.0;
pub const TOOLBAR_GAP_M: f64 = 0.012;
/// Rounded corners of each region in logical px.
pub const PANEL_CORNER_RADIUS_PX: u32 = 24;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Region {
    /// The log window.
    Panel,
    Launcher,
    /// The language or VR settings window; one at a time, opened near the launcher.
    Popup,
    /// The bar under the log; follows the log and is not stored.
    Toolbar,
    Tooltip,
}

impl Region {
    pub const ALL: [Region; 5] = [Region::Panel, Region::Launcher, Region::Popup, Region::Toolbar, Region::Tooltip];

    /// The key the settings and the VR page use.
    pub fn key(self) -> &'static str {
        match self {
            Self::Panel => "panel",
            Self::Launcher => "launcher",
            Self::Popup => "popup",
            Self::Toolbar => "toolbar",
            Self::Tooltip => "tooltip",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|region| region.key() == key)
    }
}

const fn max(a: u32, b: u32) -> u32 {
    if a > b {
        a
    } else {
        b
    }
}

/// The arrangement at the default log size.
pub const DEFAULT: VrLayout = VrLayout::for_panel(PANEL_DEFAULT_SIZE.0, PANEL_DEFAULT_SIZE.1);

/// A rectangle in logical px: x, y, width, height.
pub type Rect = (u32, u32, u32, u32);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VrLayout {
    pub atlas: (u32, u32),
    pub panel: Rect,
    pub launcher: Rect,
    pub popup: Rect,
    pub toolbar: Rect,
    pub tooltip: Rect,
}

impl VrLayout {
    /// The arrangement for a log of `width` x `height` (`computeVrLayout`). The launcher sits
    /// under the log; the popup, toolbar and tooltip form a column right of the log, which does
    /// not move left when the log shrinks below its default size.
    pub const fn for_panel(width: u32, height: u32) -> Self {
        let right_x = max(max(width, PANEL_DEFAULT_SIZE.0), LAUNCHER_WIDTH_PX + 10) + 8;
        Self {
            atlas: (right_x + 720, max(height + 8 + 128, 880)),
            panel: (0, 0, width, height),
            launcher: (10, height + 8, LAUNCHER_WIDTH_PX, 128),
            popup: (right_x, 0, 720, 640),
            toolbar: (right_x, 656, 720, 96),
            tooltip: (right_x, 760, 360, 120),
        }
    }

    pub const fn default_layout() -> Self {
        DEFAULT
    }

    /// The largest log; the VR page's texture is made big enough for it.
    pub const fn max_layout() -> Self {
        Self::for_panel(PANEL_SIZE_RANGE.1 .0, PANEL_SIZE_RANGE.1 .1)
    }

    pub fn region(&self, region: Region) -> Rect {
        match region {
            Region::Panel => self.panel,
            Region::Launcher => self.launcher,
            Region::Popup => self.popup,
            Region::Toolbar => self.toolbar,
            Region::Tooltip => self.tooltip,
        }
    }

    /// The region on a captured picture, which can be larger than logical px under DPI
    /// scaling: (x0, y0, x1, y1), rounded half to even as Python's `round` (`regionRect`).
    pub fn region_rect(&self, region: Region, image_width: u32) -> (i64, i64, i64, i64) {
        let scale = f64::from(image_width) / f64::from(self.atlas.0);
        let (x, y, w, h) = self.region(region);
        let at = |value: u32| round_half_even(f64::from(value) * scale);
        (at(x), at(y), at(x + w), at(y + h))
    }

    /// `setOverlayTextureBounds` as (uMin, uMax, vMin, vMax). In the OpenGL texture row `y` from
    /// the top is `v = 1 - y / H`; vMin is the top edge of the shown region (`regionBounds`).
    pub fn region_bounds(&self, region: Region) -> (f64, f64, f64, f64) {
        let (aw, ah) = (f64::from(self.atlas.0), f64::from(self.atlas.1));
        let (x, y, w, h) = self.region(region);
        let (x, y, w, h) = (f64::from(x), f64::from(y), f64::from(w), f64::from(h));
        (x / aw, (x + w) / aw, 1.0 - y / ah, 1.0 - (y + h) / ah)
    }
}

/// Keeps a requested log size in its range, rounded half to even (`clampPanelSize`).
pub fn clamp_panel_size(width: f64, height: f64) -> (u32, u32) {
    let ((min_w, min_h), (max_w, max_h)) = PANEL_SIZE_RANGE;
    let clamp = |value: f64, low: u32, high: u32| round_half_even(value.max(f64::from(low)).min(f64::from(high))) as u32;
    (clamp(width, min_w, max_w), clamp(height, min_h, max_h))
}

/// Python's `round(value)`: to the nearest integer, ties to even.
pub fn round_half_even(value: f64) -> i64 {
    value.round_ties_even() as i64
}

/// Python's `round(value, 4)` for the stored positions (ties to even on the scaled value).
pub fn round4(value: f64) -> f64 {
    (value * 1e4).round_ties_even() / 1e4
}

/// `computeOverlayIntersection`'s UV as a pixel of an overlay image (`uvToPixel`). The origin is
/// the bottom left, and v is measured in widths from the centre (as measured on hardware).
pub fn uv_to_pixel(u: f64, v: f64, width: u32, height: u32) -> (i64, i64) {
    let (w, h) = (f64::from(width), f64::from(height));
    let x = u * w;
    let y = h / 2.0 - (v - 0.5) * w;
    let clamp = |value: f64, side: u32| (value as i64).max(0).min(i64::from(side) - 1);
    (clamp(x, width), clamp(y, height))
}

/// The width in metres of a region's overlay (`regionWidthM`). `ui_scaling` is the stored width
/// of that window; the toolbar has a fixed size and ignores it.
pub fn region_width_m(region: Region, ui_scaling: f64) -> f64 {
    match region {
        Region::Toolbar => f64::from(VrLayout::default_layout().toolbar.2) * TOOLBAR_M_PER_PX,
        Region::Launcher => ui_scaling * f64::from(LAUNCHER_WIDTH_PX) / f64::from(LAUNCHER_SAVED_WIDTH_PX),
        _ => ui_scaling,
    }
}

/// Where a laser hit `point` (world space) lands on the captured picture (`regionPixel`).
/// The overlay's centre is its origin, x to the right and y up. SteamVR's UV is not used,
/// because it changes meaning when an overlay shows only part of its texture.
pub fn region_pixel(
    layout: &VrLayout,
    region: Region,
    ui_scaling: f64,
    image_width: u32,
    overlay_pose: &Mat4,
    point: Vec3,
) -> Option<(i64, i64)> {
    let local = math::transform_point(&math::inverse(overlay_pose)?, point);
    let (_, _, region_w, region_h) = layout.region(region);
    let width_m = region_width_m(region, ui_scaling);
    let height_m = width_m * f64::from(region_h) / f64::from(region_w);
    let fx = (local[0] / width_m + 0.5).clamp(0.0, 1.0);
    let fy = (0.5 - local[1] / height_m).clamp(0.0, 1.0);
    let (x0, y0, x1, y1) = layout.region_rect(region, image_width);
    Some((
        (x0 + (fx * (x1 - x0) as f64) as i64).min(x1 - 1),
        (y0 + (fy * (y1 - y0) as f64) as i64).min(y1 - 1),
    ))
}

/// The toolbar's pose relative to the log's tracker: under the log with a small gap
/// (`placeToolbar`). `panel_ui_scaling` is the log's stored width in metres.
pub fn toolbar_relative(layout: &VrLayout, panel_relative: &Mat34, panel_ui_scaling: f64) -> Mat34 {
    let (_, _, panel_w, panel_h) = layout.panel;
    let (_, _, bar_w, bar_h) = layout.toolbar;
    let panel_height_m = panel_ui_scaling * f64::from(panel_h) / f64::from(panel_w);
    let bar_height_m = region_width_m(Region::Toolbar, 0.0) * f64::from(bar_h) / f64::from(bar_w);
    let mut offset = math::IDENTITY;
    offset[1][3] = -(panel_height_m / 2.0 + TOOLBAR_GAP_M + bar_height_m / 2.0);
    math::to_mat34(&math::mul(&math::to_homogeneous(panel_relative), &offset))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_layout_matches_the_vr_page() {
        let page: serde_json::Value =
            serde_json::from_str(include_str!("../../../src-ui/views/vr/vr_layout.json")).unwrap();
        let layout = VrLayout::default_layout();
        assert_eq!(page["atlas"], serde_json::json!([layout.atlas.0, layout.atlas.1]));
        let regions = page["regions"].as_object().unwrap();
        assert_eq!(regions.len(), Region::ALL.len());
        for region in Region::ALL {
            let (x, y, w, h) = layout.region(region);
            assert_eq!(regions[region.key()], serde_json::json!([x, y, w, h]), "{}", region.key());
        }
    }

    #[test]
    fn small_logs_keep_the_right_column() {
        let small = VrLayout::for_panel(600, 400);
        assert_eq!(small.popup.0, VrLayout::default_layout().popup.0);
        assert_eq!(small.atlas.1, 880);
        let large = VrLayout::max_layout();
        assert_eq!(large.atlas, (2128, 1136));
    }

    #[test]
    fn panel_size_is_clamped_and_rounded_like_python() {
        assert_eq!(clamp_panel_size(10.0, 5000.0), (600, 1000));
        assert_eq!(clamp_panel_size(700.5, 501.5), (700, 502));
    }

    #[test]
    fn uv_is_clamped_to_the_image() {
        assert_eq!(uv_to_pixel(-1.0, 3.0, 100, 50), (0, 0));
        assert_eq!(uv_to_pixel(2.0, -3.0, 100, 50), (99, 49));
    }

    #[test]
    fn region_names_round_trip() {
        for region in Region::ALL {
            assert_eq!(Region::from_key(region.key()), Some(region));
        }
    }
}
