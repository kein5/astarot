//! The tooltip over the launcher and the toolbar ([`overlay_tooltip.py`]).
//!
//! The VR page draws the tooltip into its own region of the atlas, with a row of black and
//! white cells that spell the request's epoch and revision. The overlay shows the tooltip only
//! once a captured picture carries the marker of the request it last accepted, so a stale
//! picture never shows a tooltip for another button.
//!
//! [`overlay_tooltip.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay_tooltip.py
use serde_json::{Map, Value};

use super::layout::{round_half_even, VrLayout, LAUNCHER_WIDTH_PX};

pub const TOOLTIP_WIDTH_PX: f64 = 360.0;
pub const TOOLTIP_HEIGHT_RANGE_PX: (f64, f64) = (1.0, 104.0);
pub const ARROW_RANGE_PX: (f64, f64) = (12.0, 348.0);
const MAX_EPOCH: u64 = (1 << 48) - 1;
const MAX_REVISION: u64 = (1 << 32) - 1;
const MARKER_BITS: u32 = 80;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TooltipParent {
    Launcher,
    Toolbar,
}

impl TooltipParent {
    /// The parent region's size in logical px.
    fn size(self) -> (f64, f64) {
        match self {
            Self::Launcher => (f64::from(LAUNCHER_WIDTH_PX), 128.0),
            Self::Toolbar => (720.0, 96.0),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TooltipMode {
    Hover,
    Focus,
}

/// Where a shown tooltip points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TooltipShape {
    pub region: TooltipParent,
    pub mode: TooltipMode,
    /// The button, in the parent's logical px: x, y, width, height.
    pub button: [f64; 4],
    /// The tooltip's own size: width (always 360) and height.
    pub size: [f64; 2],
    /// The arrow's x within the tooltip.
    pub arrow_x: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tooltip {
    pub epoch: u64,
    pub revision: u64,
    /// `None` when the request hides the tooltip.
    pub shown: Option<TooltipShape>,
}

impl Tooltip {
    /// The 80 bits the VR page draws: the epoch above the revision.
    pub fn marker_bits(&self) -> u128 {
        (u128::from(self.epoch) << 32) | u128::from(self.revision)
    }
}

/// A plain JSON integer (not a boolean, not written with a fraction or exponent).
fn integer(value: Option<&Value>, limit: u64) -> Option<u64> {
    // serde_json keeps numbers written with a fraction or exponent as floats, which have no u64.
    let parsed = value?.as_u64()?;
    (1..=limit).contains(&parsed).then_some(parsed)
}

fn finite_number(value: &Value) -> Option<f64> {
    let number = value.as_f64()?;
    (number.is_finite() && (-1e6..=1e6).contains(&number)).then_some(number)
}

fn numbers<const N: usize>(value: Option<&Value>) -> Option<[f64; N]> {
    let list = value?.as_array()?;
    if list.len() != N {
        return None;
    }
    let mut out = [0.0; N];
    for (slot, item) in out.iter_mut().zip(list) {
        *slot = finite_number(item)?;
    }
    Some(out)
}

/// Checks a tooltip request from the VR page (`validate_tooltip`). The error names the first
/// field found wrong, as the Python overlay words it.
pub fn validate_tooltip(data: &Value) -> Result<Tooltip, &'static str> {
    let object: &Map<String, Value> = data.as_object().ok_or("tooltip must be an object")?;
    let epoch = integer(object.get("epoch"), MAX_EPOCH).ok_or("epoch")?;
    let revision = integer(object.get("revision"), MAX_REVISION).ok_or("revision")?;
    let visible = object.get("visible").and_then(Value::as_bool).ok_or("visible")?;
    if !visible {
        if object.len() != 3 {
            return Err("hidden payload");
        }
        return Ok(Tooltip { epoch, revision, shown: None });
    }
    const KNOWN: [&str; 8] = ["epoch", "revision", "visible", "region", "button", "size", "arrow_x", "mode"];
    if object.keys().any(|key| !KNOWN.contains(&key.as_str())) {
        return Err("unknown field");
    }
    let region = match object.get("region").and_then(Value::as_str) {
        Some("launcher") => Some(TooltipParent::Launcher),
        Some("toolbar") => Some(TooltipParent::Toolbar),
        _ => None,
    };
    let mode = match object.get("mode") {
        None => Some(TooltipMode::Hover),
        Some(value) => match value.as_str() {
            Some("hover") => Some(TooltipMode::Hover),
            Some("focus") => Some(TooltipMode::Focus),
            _ => None,
        },
    };
    let (Some(region), Some(mode)) = (region, mode) else {
        return Err("region or mode");
    };
    let button = numbers::<4>(object.get("button")).ok_or("button")?;
    let size = numbers::<2>(object.get("size")).ok_or("size")?;
    let [x, y, w, h] = button;
    let (parent_w, parent_h) = region.size();
    if x < 0.0 || y < 0.0 || w <= 0.0 || h <= 0.0 || x + w > parent_w || y + h > parent_h {
        return Err("button bounds");
    }
    if size[0] != TOOLTIP_WIDTH_PX || !(TOOLTIP_HEIGHT_RANGE_PX.0..=TOOLTIP_HEIGHT_RANGE_PX.1).contains(&size[1]) {
        return Err("size bounds");
    }
    let arrow_x = object
        .get("arrow_x")
        .and_then(finite_number)
        .filter(|arrow| (ARROW_RANGE_PX.0..=ARROW_RANGE_PX.1).contains(arrow))
        .ok_or("arrow_x")?;
    Ok(Tooltip { epoch, revision, shown: Some(TooltipShape { region, mode, button, size, arrow_x }) })
}

/// A captured picture, top row first, `channels` bytes per pixel (the first three are colour).
pub struct Picture<'a> {
    pub pixels: &'a [u8],
    pub width: u32,
    pub height: u32,
    pub channels: usize,
}

impl Picture<'_> {
    fn colour(&self, x: i64, y: i64) -> Option<&[u8]> {
        if x < 0 || y < 0 || x >= i64::from(self.width) || y >= i64::from(self.height) {
            return None;
        }
        let start = (y as usize * self.width as usize + x as usize) * self.channels;
        self.pixels.get(start..start + 3)
    }
}

/// Whether the picture's tooltip region carries `tooltip`'s marker (`marker_matches`): 80 cells
/// of 4x8 logical px, most significant bit first, white for 1 and black for 0, read at each
/// cell's centre.
pub fn marker_matches(picture: &Picture, layout: &VrLayout, tooltip: &Tooltip) -> bool {
    let scale = f64::from(picture.width) / f64::from(layout.atlas.0);
    let (x, y, _, _) = layout.tooltip;
    let bits = tooltip.marker_bits();
    (0..MARKER_BITS).all(|index| {
        let px = round_half_even((f64::from(x) + f64::from(index) * 4.0 + 2.0) * scale);
        let py = round_half_even((f64::from(y) + 4.0) * scale);
        let Some(colour) = picture.colour(px, py) else {
            return false;
        };
        if (bits >> (MARKER_BITS - 1 - index)) & 1 == 1 {
            colour.iter().all(|&value| value >= 224)
        } else {
            colour.iter().all(|&value| value <= 31)
        }
    })
}

/// The parts of the tooltip that show on the overlay, on a picture `image_width` px wide: a
/// rounded body and the arrow under it (`tooltip_mask`). The marker row above stays hidden.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TooltipMask {
    /// x0, y0, x1, y1 inclusive.
    pub body: (i64, i64, i64, i64),
    pub radius: i64,
    pub arrow: [(i64, i64); 3],
}

pub fn tooltip_mask(layout: &VrLayout, shape: &TooltipShape, image_width: u32) -> TooltipMask {
    let scale = f64::from(image_width) / f64::from(layout.atlas.0);
    let at = |value: f64| round_half_even(value * scale);
    let x = f64::from(layout.tooltip.0);
    let y = f64::from(layout.tooltip.1) + 8.0;
    let [w, h] = shape.size;
    let arrow = shape.arrow_x;
    TooltipMask {
        body: (at(x), at(y), at(x + w) - 1, at(y + h) - 1),
        radius: at(12.0),
        arrow: [(at(x + arrow - 6.0), at(y + h - 1.0)), (at(x + arrow + 6.0), at(y + h - 1.0)), (at(x + arrow), at(y + h + 6.0) - 1)],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn shown() -> Value {
        json!({"epoch": 3, "revision": 7, "visible": true, "region": "launcher",
               "button": [10, 20, 64, 64], "size": [360, 40], "arrow_x": 42.5})
    }

    #[test]
    fn accepts_shown_and_hidden_requests() {
        let tooltip = validate_tooltip(&shown()).unwrap();
        let shape = tooltip.shown.unwrap();
        assert_eq!((shape.region, shape.mode, shape.arrow_x), (TooltipParent::Launcher, TooltipMode::Hover, 42.5));
        let hidden = validate_tooltip(&json!({"epoch": 1, "revision": 1, "visible": false})).unwrap();
        assert!(hidden.shown.is_none());
    }

    #[test]
    fn rejects_what_python_rejects() {
        let cases = [
            (json!([]), "tooltip must be an object"),
            (json!({"epoch": 0, "revision": 1, "visible": false}), "epoch"),
            (json!({"epoch": true, "revision": 1, "visible": false}), "epoch"),
            (json!({"epoch": 1.0, "revision": 1, "visible": false}), "epoch"),
            (json!({"epoch": 1, "revision": 4294967296u64, "visible": false}), "revision"),
            (json!({"epoch": 1, "revision": 1, "visible": 1}), "visible"),
            (json!({"epoch": 1, "revision": 1, "visible": false, "mode": "hover"}), "hidden payload"),
        ];
        for (value, error) in cases {
            assert_eq!(validate_tooltip(&value), Err(error), "{value}");
        }
        let with = |key: &str, value: Value| {
            let mut data = shown();
            data[key] = value;
            validate_tooltip(&data)
        };
        assert_eq!(with("extra", json!(1)), Err("unknown field"));
        assert_eq!(with("mode", Value::Null), Err("region or mode"));
        assert_eq!(with("button", json!([0, 0, 0, 10])), Err("button bounds"));
        assert_eq!(with("button", json!([0, 0, true, 10])), Err("button"));
        assert_eq!(with("size", json!([361, 40])), Err("size bounds"));
        assert_eq!(with("arrow_x", json!(349)), Err("arrow_x"));
    }

    #[test]
    fn reads_the_marker_it_expects() {
        let layout = VrLayout::default_layout();
        let tooltip = validate_tooltip(&shown()).unwrap();
        let (width, height) = layout.atlas;
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let (x, y, _, _) = layout.tooltip;
        for index in 0..MARKER_BITS {
            if (tooltip.marker_bits() >> (MARKER_BITS - 1 - index)) & 1 == 1 {
                let start = (((y + 4) * width + x + index * 4 + 2) * 4) as usize;
                pixels[start..start + 3].fill(255);
            }
        }
        let picture = Picture { pixels: &pixels, width, height, channels: 4 };
        assert!(marker_matches(&picture, &layout, &tooltip));
        let other = Tooltip { revision: 8, ..tooltip };
        assert!(!marker_matches(&picture, &layout, &other));
    }
}
