//! Text line detection: RapidOCR 3.9.2's `TextDetector` (DB pre- and post-processing)
//! around the PP-OCR detection network.

use crate::cv::{self, contours, draw, geometry, Interpolation};
use crate::image::BgrImage;
use crate::unclip;

/// A quadrilateral, clockwise from the top-left corner, in `f32` like RapidOCR's arrays.
pub type Quad = [(f32, f32); 4];

#[derive(Debug, Clone)]
pub struct DetConfig {
    pub limit_side_len: usize,
    /// "min" (scale up so that the shorter side reaches the limit) or "max".
    pub limit_type_min: bool,
    pub mean: [f64; 3],
    pub std: [f64; 3],
    pub thresh: f32,
    pub box_thresh: f64,
    pub max_candidates: usize,
    pub unclip_ratio: f64,
    pub use_dilation: bool,
}

impl Default for DetConfig {
    /// What ASTAROT passes: a 320 px shorter side and the ImageNet normalisation from
    /// PaddleOCR's `inference.yml`; RapidOCR's defaults for the rest.
    fn default() -> Self {
        DetConfig {
            limit_side_len: 320,
            limit_type_min: true,
            mean: [0.485, 0.456, 0.406],
            std: [0.229, 0.224, 0.225],
            thresh: 0.3,
            box_thresh: 0.5,
            max_candidates: 1000,
            unclip_ratio: 1.6,
            use_dilation: true,
        }
    }
}

/// The network input `[1, 3, h, w]`, or `None` when the picture rounds to nothing.
pub fn preprocess(img: &BgrImage, config: &DetConfig) -> Option<(Vec<f32>, usize, usize)> {
    let (h, w) = (img.height, img.width);
    let limit = config.limit_side_len as f64;
    let ratio = if config.limit_type_min {
        if (h.min(w) as f64) < limit {
            if h < w {
                limit / h as f64
            } else {
                limit / w as f64
            }
        } else {
            1.0
        }
    } else if (h.max(w) as f64) > limit {
        if h > w {
            limit / h as f64
        } else {
            limit / w as f64
        }
    } else {
        1.0
    };
    let resize_h = round_to_32((h as f64 * ratio) as i64);
    let resize_w = round_to_32((w as f64 * ratio) as i64);
    if resize_h <= 0 || resize_w <= 0 {
        return None;
    }
    let (rw, rh) = (resize_w as usize, resize_h as usize);
    let resized = img.resize(rw, rh, Interpolation::Linear);
    let scale = (1.0f64 / 255.0) as f32;
    let plane = rw * rh;
    let mut tensor = vec![0f32; 3 * plane];
    for (i, px) in resized.data.as_chunks::<3>().0.iter().enumerate() {
        for c in 0..3 {
            // float32 * float32, then float64 for the mean and std, then back to float32.
            let v = px[c] as f32 * scale;
            tensor[c * plane + i] = ((v as f64 - config.mean[c]) / config.std[c]) as f32;
        }
    }
    Some((tensor, rh, rw))
}

/// `int(round(x / 32) * 32)` with Python's half-to-even `round`.
pub(crate) fn round_to_32(x: i64) -> i64 {
    ((x as f64 / 32.0).round_ties_even() * 32.0) as i64
}

/// Corner points of the minimum-area rectangle (top-left, top-right, bottom-right,
/// bottom-left as RapidOCR's `get_mini_boxes` picks them) and its shorter side.
fn mini_box(points: &[(i32, i32)]) -> (Quad, f32) {
    let rect = geometry::min_area_rect(points);
    let mut pts = geometry::box_points(&rect).to_vec();
    // Python's sorted(): stable, by x.
    pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let (i1, i4) = if pts[1].1 > pts[0].1 { (0, 1) } else { (1, 0) };
    let (i2, i3) = if pts[3].1 > pts[2].1 { (2, 3) } else { (3, 2) };
    ([pts[i1], pts[i2], pts[i3], pts[i4]], rect.size.0.min(rect.size.1))
}

/// `box_score_fast`: mean probability inside the box.
fn box_score_fast(pred: &[f32], w: usize, h: usize, quad: &Quad) -> f64 {
    let clip = |v: f32, hi: usize| (v as i32).clamp(0, hi as i32 - 1);
    let xs = quad.iter().map(|p| p.0);
    let ys = quad.iter().map(|p| p.1);
    let xmin = clip(xs.clone().fold(f32::INFINITY, f32::min).floor(), w);
    let xmax = clip(xs.fold(f32::NEG_INFINITY, f32::max).ceil(), w);
    let ymin = clip(ys.clone().fold(f32::INFINITY, f32::min).floor(), h);
    let ymax = clip(ys.fold(f32::NEG_INFINITY, f32::max).ceil(), h);
    let mw = (xmax - xmin + 1) as usize;
    let mh = (ymax - ymin + 1) as usize;
    let mut mask = vec![0u8; mw * mh];
    let poly: Vec<(i32, i32)> = quad.iter().map(|p| ((p.0 - xmin as f32) as i32, (p.1 - ymin as f32) as i32)).collect();
    draw::fill_poly(&mut mask, mw, mh, &poly, 1);
    let mut roi = Vec::with_capacity(mw * mh);
    for y in ymin as usize..=ymax as usize {
        roi.extend_from_slice(&pred[y * w + xmin as usize..=y * w + xmax as usize]);
    }
    cv::mean_masked(&roi, &mask)
}

fn unclip(quad: &Quad, ratio: f64) -> Vec<(i32, i32)> {
    let points: Vec<(f64, f64)> = quad.iter().map(|p| (p.0 as f64, p.1 as f64)).collect();
    let distance = unclip::polygon_area(&points) * ratio / unclip::polygon_length(&points);
    // pyclipper turns each coordinate into an integer by truncation.
    let path: Vec<(i64, i64)> = quad.iter().map(|p| (p.0 as i64, p.1 as i64)).collect();
    unclip::offset_round(&path, distance).into_iter().map(|(x, y)| (x as i32, y as i32)).collect()
}

/// `order_points_clockwise`: top-left, top-right, bottom-right, bottom-left.
fn order_points_clockwise(pts: &[(f32, f32); 4]) -> Quad {
    // np.argsort on four values runs an insertion sort, which keeps ties in order.
    let mut order = [0usize, 1, 2, 3];
    order.sort_by(|&a, &b| pts[a].0.partial_cmp(&pts[b].0).unwrap_or(std::cmp::Ordering::Equal));
    let mut left = [pts[order[0]], pts[order[1]]];
    let mut right = [pts[order[2]], pts[order[3]]];
    if left[1].1 < left[0].1 {
        left.swap(0, 1);
    }
    if right[1].1 < right[0].1 {
        right.swap(0, 1);
    }
    [left[0], right[0], right[1], left[1]]
}

fn norm(a: (f32, f32), b: (f32, f32)) -> f32 {
    let (dx, dy) = (a.0 - b.0, a.1 - b.1);
    (dx * dx + dy * dy).sqrt()
}

/// DB post-processing of the probability map `pred` (`map_h`×`map_w`) for a picture of
/// `src_w`×`src_h`: boxes in picture coordinates and their scores, sorted top to bottom
/// and then left to right like RapidOCR's `sorted_boxes`.
pub fn postprocess(pred: &[f32], map_w: usize, map_h: usize, src_w: usize, src_h: usize, config: &DetConfig) -> (Vec<Quad>, Vec<f64>) {
    let segmentation: Vec<u8> = pred.iter().map(|&p| u8::from(p > config.thresh)).collect();
    let mask = if config.use_dilation { cv::dilate_2x2(&segmentation, map_w, map_h) } else { segmentation };
    let found = contours::find_contours_list_simple(&mask, map_w, map_h);
    let mut boxes: Vec<[(i32, i32); 4]> = Vec::new();
    let mut scores = Vec::new();
    for contour in found.iter().take(config.max_candidates) {
        let (points, sside) = mini_box(contour);
        if sside < 3.0 {
            continue;
        }
        let score = box_score_fast(pred, map_w, map_h, &points);
        if config.box_thresh > score {
            continue;
        }
        let expanded = unclip(&points, config.unclip_ratio);
        if expanded.is_empty() {
            continue;
        }
        let (quad, sside) = mini_box(&expanded);
        if sside < 5.0 {
            continue;
        }
        let scale = |v: f32, size: usize, dest: usize| -> i32 {
            // float32 arithmetic, np.round (half to even), np.clip, then astype(int32).
            let value = (v / size as f32 * dest as f32).round_ties_even();
            value.clamp(0.0, dest as f32) as i32
        };
        let mut out = [(0i32, 0i32); 4];
        for (o, p) in out.iter_mut().zip(quad) {
            *o = (scale(p.0, map_w, src_w), scale(p.1, map_h, src_h));
        }
        boxes.push(out);
        scores.push(score);
    }

    // filter_det_res
    let mut kept: Vec<Quad> = Vec::new();
    let mut kept_scores = Vec::new();
    for (b, score) in boxes.iter().zip(scores) {
        let pts = [(b[0].0 as f32, b[0].1 as f32), (b[1].0 as f32, b[1].1 as f32), (b[2].0 as f32, b[2].1 as f32), (b[3].0 as f32, b[3].1 as f32)];
        let mut quad = order_points_clockwise(&pts);
        for p in quad.iter_mut() {
            p.0 = (p.0.max(0.0).min(src_w as f32 - 1.0) as i32) as f32;
            p.1 = (p.1.max(0.0).min(src_h as f32 - 1.0) as i32) as f32;
        }
        let rect_width = norm(quad[0], quad[1]) as i32;
        let rect_height = norm(quad[0], quad[3]) as i32;
        if rect_width <= 3 || rect_height <= 3 {
            continue;
        }
        kept.push(quad);
        kept_scores.push(score);
    }
    sort_boxes(kept, kept_scores)
}

/// RapidOCR's `sorted_boxes`: stable by the first corner's y, then lines 10 px apart
/// sorted by x. Scores stay in detection order, as RapidOCR leaves them.
fn sort_boxes(boxes: Vec<Quad>, scores: Vec<f64>) -> (Vec<Quad>, Vec<f64>) {
    if boxes.is_empty() {
        return (boxes, scores);
    }
    let mut by_y: Vec<usize> = (0..boxes.len()).collect();
    by_y.sort_by(|&a, &b| boxes[a][0].1.partial_cmp(&boxes[b][0].1).unwrap_or(std::cmp::Ordering::Equal));
    let mut line = 0i64;
    let mut line_ids = vec![0i64; by_y.len()];
    for i in 1..by_y.len() {
        let dy = boxes[by_y[i]][0].1 - boxes[by_y[i - 1]][0].1;
        if dy >= 10.0 {
            line += 1;
        }
        line_ids[i] = line;
    }
    let mut order: Vec<usize> = (0..by_y.len()).collect();
    order.sort_by(|&a, &b| line_ids[a].cmp(&line_ids[b]).then(boxes[by_y[a]][0].0.partial_cmp(&boxes[by_y[b]][0].0).unwrap_or(std::cmp::Ordering::Equal)));
    (order.iter().map(|&i| boxes[by_y[i]]).collect(), scores)
}
