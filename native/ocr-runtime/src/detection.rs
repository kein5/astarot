//! Finding chat bubbles without a detector model (`ocr_detection.py`).
//!
//! 1. Region: only the configured part of each view (window or headset) is read.
//! 2. Text lines: PP-OCR's own text detector finds the lines.
//! 3. Bubbles: VRChat centres a chatbox's lines and spaces them tightly, so lines that
//!    overlap horizontally and sit less than about half a line apart belong together.
//! 4. Style: a chatbox is light, neutral glyphs on a dark translucent panel; other text
//!    is world text (signs, panels, posters) and is dropped unless the filter is off.
//!
//! Shape heuristics only ever filter what PP-OCR read as text; they never propose
//! regions (a colour/contour bubble finder was disproven on real frames upstream).

use std::collections::BTreeMap;

use crate::cv::Interpolation;
use crate::engine::Word;
use crate::image::BgrImage;

/// `(x, y, w, h)` in pixels.
pub type BBox = (i64, i64, i64, i64);
/// `(x, y, width, height)`, each 0..1.
pub type Region = (f64, f64, f64, f64);

pub const FULL_REGION: Region = (0.0, 0.0, 1.0, 1.0);
/// Smallest region side, relative. Anything smaller cannot hold a readable line.
pub const MIN_REGION_SIDE: f64 = 0.02;
/// Longest side handed to PP-OCR. 2560 keeps small chatbox text above the recogniser's
/// 48 px line height; a 4K window at full size takes over a second per tick on a CPU.
pub const MAX_READ_SIDE: usize = 2560;

pub const LINE_GAP_RATIO: f64 = 0.6;
pub const MIN_HORIZONTAL_OVERLAP: f64 = 0.3;

/// Style check thresholds (0..255 luminance), measured on rendered chatbox panels: the
/// panel is near-black at ~80 % opacity, so even over a white world it stays below ~90.
pub const PANEL_MAX_LUMA: f64 = 110.0;
pub const GLYPH_MIN_LUMA: f64 = 165.0;
pub const MIN_CONTRAST: f64 = 90.0;
/// Glyphs are white; a larger mean channel spread is coloured world text.
pub const GLYPH_MAX_CHROMA: f64 = 60.0;

/// A region as the settings hold it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RegionValue {
    Values([f64; 4]),
    /// Anything that is not four numbers.
    Invalid,
}

/// Clamp a region into the frame; invalid input reads the whole frame.
pub fn normalize_region(region: RegionValue) -> Region {
    let RegionValue::Values([x, y, w, h]) = region else {
        return FULL_REGION;
    };
    if ![x, y, w, h].iter().all(|v| v.is_finite()) {
        return FULL_REGION;
    }
    let x = x.clamp(0.0, 1.0 - MIN_REGION_SIDE);
    let y = y.clamp(0.0, 1.0 - MIN_REGION_SIDE);
    let w = w.max(MIN_REGION_SIDE).min(1.0 - x);
    let h = h.max(MIN_REGION_SIDE).min(1.0 - y);
    (x, y, w, h)
}

fn py_round(value: f64) -> i64 {
    // Python's round() on a float: half to even.
    value.round_ties_even() as i64
}

/// The region in pixels of a `width`×`height` frame, at least one pixel.
pub fn region_pixels(region: Region, width: usize, height: usize) -> BBox {
    let (x, y, w, h) = normalize_region(RegionValue::Values([region.0, region.1, region.2, region.3]));
    let (wf, hf) = (width as f64, height as f64);
    let (x0, y0) = (py_round(x * wf), py_round(y * hf));
    let (x1, y1) = (py_round((x + w) * wf), py_round((y + h) * hf));
    let x1 = (x0 + 1).max((width as i64).min(x1));
    let y1 = (y0 + 1).max((height as i64).min(y1));
    (x0, y0, x1 - x0, y1 - y0)
}

/// Which view a frame came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Surface {
    Window,
    Vr,
}

/// A candidate: where it is in the frame, and the pixels to read.
pub type Candidate = (BBox, BgrImage);

/// The configured part of the frame as one candidate (`RegionCandidates`).
///
/// One crop may hold several bubbles and world text, so the pipeline groups and
/// filters its lines afterwards (`splits_bubbles`).
#[derive(Debug, Clone)]
pub struct RegionCandidates {
    window: Region,
    vr: Region,
    pub max_side: usize,
}

impl Default for RegionCandidates {
    fn default() -> Self {
        RegionCandidates::new(RegionValue::Values([0.0, 0.0, 1.0, 1.0]))
    }
}

impl RegionCandidates {
    pub fn new(region: RegionValue) -> Self {
        RegionCandidates { window: normalize_region(region), vr: FULL_REGION, max_side: MAX_READ_SIDE }
    }

    /// The region of the view the latest frame came from (the window when unknown).
    pub fn region(&self, source: Option<Surface>) -> Region {
        match source {
            Some(Surface::Vr) => self.vr,
            _ => self.window,
        }
    }

    /// Compatibility: a single region always edits the desktop window's.
    pub fn set_region(&mut self, region: RegionValue) {
        self.window = normalize_region(region);
    }

    pub fn set_source_regions(&mut self, window: RegionValue, vr: RegionValue) {
        self.window = normalize_region(window);
        self.vr = normalize_region(vr);
    }

    pub fn detect(&self, frame: &BgrImage, source: Option<Surface>) -> Vec<Candidate> {
        if frame.is_empty() {
            return Vec::new();
        }
        let (x, y, w, h) = region_pixels(self.region(source), frame.width, frame.height);
        let mut crop = frame.crop(x as usize, y as usize, w as usize, h as usize);
        if crop.is_empty() {
            return Vec::new();
        }
        let longest = crop.width.max(crop.height);
        if longest > self.max_side {
            let scale = self.max_side as f64 / longest as f64;
            let nw = ((crop.width as f64 * scale) as usize).max(1);
            let nh = ((crop.height as f64 * scale) as usize).max(1);
            crop = crop.resize(nw, nh, Interpolation::Area);
        }
        vec![((x, y, w, h), crop)]
    }
}

/// `(left, top, right, bottom)` of a line with a usable box.
fn line_box(word: &Word) -> Option<(f64, f64, f64, f64)> {
    let (left, right, top, bottom) = word.bounds?;
    if right <= left || bottom <= top {
        return None;
    }
    Some((left, top, right, bottom))
}

fn same_bubble(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    let ((al, at, ar, ab), (bl, bt, br, bb)) = (a, b);
    let height = (ab - at).min(bb - bt);
    let gap = (bt - ab).max(at - bb).max(0.0);
    if gap > LINE_GAP_RATIO * height {
        return false;
    }
    let overlap = ar.min(br) - al.max(bl);
    overlap > MIN_HORIZONTAL_OVERLAP * (ar - al).min(br - bl)
}

/// Group lines into bubbles, top to bottom; lines without a box stay alone.
pub fn group_lines(lines: &[Word]) -> Vec<Vec<Word>> {
    let boxes: Vec<Option<(f64, f64, f64, f64)>> = lines.iter().map(line_box).collect();
    let mut parent: Vec<usize> = (0..lines.len()).collect();
    fn find(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for i in 0..lines.len() {
        for j in i + 1..lines.len() {
            if let (Some(a), Some(b)) = (boxes[i], boxes[j]) {
                if same_bubble(a, b) {
                    let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
                    parent[ri] = rj;
                }
            }
        }
    }
    // Groups keyed by their root, in order of first appearance (dict insertion order).
    let mut order: Vec<usize> = Vec::new();
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for index in 0..lines.len() {
        let root = find(&mut parent, index);
        if !groups.contains_key(&root) {
            order.push(root);
        }
        groups.entry(root).or_default().push(index);
    }
    let top = |indices: &[usize]| indices.iter().filter_map(|&i| boxes[i]).map(|b| b.1).fold(f64::INFINITY, f64::min);
    let mut ordered: Vec<Vec<usize>> = order.into_iter().map(|root| groups.remove(&root).unwrap()).collect();
    ordered.sort_by(|a, b| top(a).partial_cmp(&top(b)).unwrap_or(std::cmp::Ordering::Equal).then(a[0].cmp(&b[0])));
    ordered
        .into_iter()
        .map(|mut indices| {
            indices.sort_by(|&a, &b| {
                let ya = boxes[a].map_or(0.0, |r| r.1);
                let yb = boxes[b].map_or(0.0, |r| r.1);
                ya.partial_cmp(&yb).unwrap_or(std::cmp::Ordering::Equal).then(a.cmp(&b))
            });
            indices.into_iter().map(|i| lines[i].clone()).collect()
        })
        .collect()
}

/// The bounds of a block's lines in pixels, `None` when no line has a box.
pub fn block_bounds(block: &[Word]) -> Option<BBox> {
    let boxes: Vec<_> = block.iter().filter_map(line_box).collect();
    if boxes.is_empty() {
        return None;
    }
    let left = boxes.iter().map(|b| b.0).fold(f64::INFINITY, f64::min);
    let top = boxes.iter().map(|b| b.1).fold(f64::INFINITY, f64::min);
    let right = boxes.iter().map(|b| b.2).fold(f64::NEG_INFINITY, f64::max);
    let bottom = boxes.iter().map(|b| b.3).fold(f64::NEG_INFINITY, f64::max);
    Some((left as i64, top as i64, (right - left).ceil() as i64, (bottom - top).ceil() as i64))
}

/// Otsu's threshold over 8-bit values (the luma is truncated like `astype(np.uint8)`).
fn otsu(values: &[f32]) -> f64 {
    let mut histogram = [0f64; 256];
    for &v in values {
        histogram[(v as i64).clamp(0, 255) as u8 as usize] += 1.0;
    }
    let total: f64 = histogram.iter().sum();
    if total == 0.0 {
        return 128.0;
    }
    let mut weight = [0f64; 256];
    let mut mean = [0f64; 256];
    let (mut w, mut m) = (0.0, 0.0);
    for level in 0..256 {
        w += histogram[level];
        m += histogram[level] * level as f64;
        weight[level] = w;
        mean[level] = m;
    }
    let mut best = (0usize, f64::NEG_INFINITY);
    for level in 0..256 {
        let between = (mean[255] * weight[level] - mean[level] * total).powi(2) / (weight[level] * (total - weight[level])).max(1e-9);
        if between > best.1 {
            best = (level, between);
        }
    }
    best.0 as f64
}

/// True when the block's lines are light, neutral glyphs on a dark panel.
pub fn looks_like_chatbox(crop: &BgrImage, block: &[Word]) -> bool {
    if crop.is_empty() {
        return false;
    }
    let (width, height) = (crop.width as i64, crop.height as i64);
    let mut pixels: Vec<[f32; 3]> = Vec::new();
    for line in block {
        let Some(b) = line_box(line) else { continue };
        let (x0, y0) = ((b.0 as i64).max(0), (b.1 as i64).max(0));
        let (x1, y1) = (width.min(b.2.ceil() as i64), height.min(b.3.ceil() as i64));
        if x1 - x0 >= 2 && y1 - y0 >= 2 {
            for y in y0..y1 {
                for x in x0..x1 {
                    let p = crop.pixel(x as usize, y as usize);
                    pixels.push([p[0] as f32, p[1] as f32, p[2] as f32]);
                }
            }
        }
    }
    if pixels.is_empty() {
        return false;
    }
    // `bgr @ (0.114, 0.587, 0.299)` in float32. NumPy hands this to OpenBLAS's sgemv,
    // which on FMA-capable CPUs computes this fused chain (its last bit is CPU-dependent).
    let luma: Vec<f32> = pixels.iter().map(|p| p[2].mul_add(0.299f32, p[1].mul_add(0.587f32, p[0] * 0.114f32))).collect();
    let threshold = otsu(&luma) as f32;
    let bright: Vec<usize> = (0..luma.len()).filter(|&i| luma[i] > threshold).collect();
    let dark_count = luma.len() - bright.len();
    // Glyph strokes cover well under half of a line's box; the panel is the rest.
    if bright.is_empty() || dark_count == 0 || bright.len() as f64 / luma.len() as f64 > 0.6 {
        return false;
    }
    let glyph = mean_f32(bright.iter().map(|&i| luma[i]));
    let panel = mean_f32((0..luma.len()).filter(|&i| luma[i] <= threshold).map(|i| luma[i]));
    let chroma = mean_f32(bright.iter().map(|&i| {
        let p = pixels[i];
        p[0].max(p[1]).max(p[2]) - p[0].min(p[1]).min(p[2])
    }));
    panel <= PANEL_MAX_LUMA && glyph >= GLYPH_MIN_LUMA && glyph - panel >= MIN_CONTRAST && chroma <= GLYPH_MAX_CHROMA
}

/// `np.mean` of a float32 array: float32 pairwise summation, then `float32(sum / n)`
/// (NumPy divides the float32 scalar by the count in double precision).
fn mean_f32(values: impl Iterator<Item = f32>) -> f64 {
    let values: Vec<f32> = values.collect();
    if values.is_empty() {
        return f64::NAN;
    }
    ((crate::numeric::pairwise_sum_f32(&values) as f64 / values.len() as f64) as f32) as f64
}
