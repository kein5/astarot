//! VRCT-VOX's own chatbox detector (`ocr_bubble_detector.py`, `ocr_chatbox_detector.py`).
//!
//! A YOLOX-Tiny trained on VRCT-VOX's own frames (tools/chatbox_lab), MIT, loaded only
//! from its hash-verified download. The upstream VRCT detector
//! (`chatbox_yolox_tiny.onnx`) must never run in VRCT-VOX: only the catalog file name
//! is accepted, and there is no fallback lookup.
//!
//! Decoding (grid and strides) is inside the exported graph; here are the letterbox,
//! the threshold, non-maximum suppression and the mapping back to frame pixels.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;

use crate::cv::Interpolation;
use crate::detection::{BBox, Candidate};
use crate::engine::{io_names, run};
use crate::error::{Error, Result};
use crate::failure::Log;
use crate::image::BgrImage;
use crate::models::{is_installed, resolve_artifact, DETECTOR_FILE_NAME, DETECTOR_MODEL_ID};

/// The longest side is scaled to this, as in training. Bubbles can be 1 % of the
/// screen; at 640 the validation set lost 4 of 20 (1280: 1 of 20).
pub const DEFAULT_IMAGE_SIZE: usize = 1280;
/// Measured on the chatbox_lab validation split: 39 of 41 chatboxes, 1 extra.
pub const DETECTOR_CONFIDENCE: f32 = 0.7;
pub const DEFAULT_NMS_IOU: f32 = 0.65;
/// YOLOX's letterbox colour.
pub const PAD_COLOR: u8 = 114;
/// The FPN strides are 8/16/32, so the input sides must be multiples of 32.
pub const SIZE_MULTIPLE: usize = 32;
/// The upstream detector's file name, which is never loaded.
pub const UPSTREAM_FILE_NAME: &str = "chatbox_yolox_tiny.onnx";

/// Indices of the boxes kept, strongest first (`nonMaxSuppression`).
///
/// `boxes` are `(x0, y0, x1, y1)`. Equal scores are visited in reverse index order, as
/// NumPy's `argsort()[::-1]` does for a stable sort.
pub fn non_max_suppression(boxes: &[[f32; 4]], scores: &[f32], threshold: f32) -> Vec<usize> {
    let mut order: Vec<usize> = (0..scores.len()).collect();
    order.sort_by(|&a, &b| scores[a].partial_cmp(&scores[b]).unwrap_or(std::cmp::Ordering::Equal));
    order.reverse();
    let areas: Vec<f32> = boxes.iter().map(|b| (b[2] - b[0]) * (b[3] - b[1])).collect();
    let mut keep = Vec::new();
    while let Some((&current, rest)) = order.split_first() {
        keep.push(current);
        let c = boxes[current];
        order = rest
            .iter()
            .copied()
            .filter(|&r| {
                let b = boxes[r];
                let x0 = c[0].max(b[0]);
                let y0 = c[1].max(b[1]);
                let x1 = c[2].min(b[2]);
                let y1 = c[3].min(b[3]);
                let overlap = (x1 - x0).max(0.0) * (y1 - y0).max(0.0);
                let union = areas[current] + areas[r] - overlap;
                overlap / union.max(1e-6) <= threshold
            })
            .collect();
    }
    keep
}

/// True only for our detector's file name outside the directories where the upstream
/// detector was shipped (`isAllowedModelPath`).
pub fn is_allowed_model_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return false };
    if name != DETECTOR_FILE_NAME || name.eq_ignore_ascii_case(UPSTREAM_FILE_NAME) {
        return false;
    }
    let directory = path.parent().map(|d| d.canonicalize().unwrap_or_else(|_| d.to_path_buf()));
    !bundled_directories().iter().any(|bundled| Some(bundled) == directory.as_ref())
}

/// Where the upstream detector was shipped beside a frozen Python build.
fn bundled_directories() -> Vec<PathBuf> {
    let Ok(exe) = std::env::current_exe() else { return Vec::new() };
    let Some(dir) = exe.parent() else { return Vec::new() };
    [dir.join("_internal").join("ocr_onnx"), dir.join("ocr_onnx")].into_iter().map(|d| d.canonicalize().unwrap_or(d)).collect()
}

/// The detector: one candidate per detected chatbox, strongest first.
pub struct ChatboxDetector {
    pub model_path: PathBuf,
    pub image_size: usize,
    pub confidence: f32,
    pub crop_padding: i64,
    pub nms_iou: f32,
    threads: usize,
    session: Option<(Session, (String, String))>,
}

impl ChatboxDetector {
    /// Refuses anything but the verified download's file name.
    pub fn new(model_path: PathBuf, threads: usize) -> Result<ChatboxDetector> {
        if !is_allowed_model_path(&model_path) {
            return Err(Error::invalid("only the verified VRCT-VOX chatbox detector may be loaded"));
        }
        Ok(ChatboxDetector { model_path, image_size: DEFAULT_IMAGE_SIZE, confidence: DETECTOR_CONFIDENCE, crop_padding: 4, nms_iou: DEFAULT_NMS_IOU, threads, session: None })
    }

    /// The model file is there (checked again before the first detection).
    pub fn is_available(&self) -> bool {
        self.model_path.is_file()
    }

    /// Load the graph (once). The pipeline calls this when reading starts.
    pub fn load_model(&mut self) -> Result<()> {
        if self.session.is_some() {
            return Ok(());
        }
        let builder = Session::builder(crate::engine::environment()?).map_err(|e| Error::Backend(e.to_string()))?;
        let builder = builder.with_log_level(ort::logging::LogLevel::Error).map_err(|e| Error::Backend(e.to_string()))?;
        let builder = builder.with_optimization_level(GraphOptimizationLevel::All).map_err(|e| Error::Backend(e.to_string()))?;
        let builder = builder.with_intra_threads(self.threads.max(1)).map_err(|e| Error::Backend(e.to_string()))?;
        let mut builder = builder.with_inter_threads(1).map_err(|e| Error::Backend(e.to_string()))?;
        let session = builder.commit_from_file(&self.model_path).map_err(|e| Error::Backend(e.to_string()))?;
        let io = io_names(&session)?;
        self.session = Some((session, io));
        Ok(())
    }

    /// YOLOX's preprocessing: BGR, 0..255, padded at the bottom right to a canvas of the
    /// scaled frame rounded up to multiples of 32 (not a square: the window may have any
    /// shape). Returns the `[1, 3, h, w]` tensor, its size and the scale.
    pub fn letterbox(&self, frame: &BgrImage) -> (Vec<f32>, usize, usize, f64) {
        let (h, w) = (frame.height as f64, frame.width as f64);
        let scale = (self.image_size as f64 / w).min(self.image_size as f64 / h);
        let nw = ((w * scale) as usize).max(1);
        let nh = ((h * scale) as usize).max(1);
        let resized = frame.resize(nw, nh, Interpolation::Linear);
        let canvas_w = nw.div_ceil(SIZE_MULTIPLE) * SIZE_MULTIPLE;
        let canvas_h = nh.div_ceil(SIZE_MULTIPLE) * SIZE_MULTIPLE;
        let plane = canvas_w * canvas_h;
        let mut tensor = vec![PAD_COLOR as f32; 3 * plane];
        for y in 0..nh {
            for x in 0..nw {
                let i = (y * nw + x) * 3;
                for c in 0..3 {
                    tensor[c * plane + y * canvas_w + x] = resized.data[i + c] as f32;
                }
            }
        }
        (tensor, canvas_h, canvas_w, scale)
    }

    /// `[(bbox, crop)]` sorted by confidence; an error is a failed inference, which the
    /// pipeline treats differently from "no chatbox".
    pub fn detect(&mut self, frame: &BgrImage) -> Result<Vec<Candidate>> {
        if !self.is_available() || frame.is_empty() {
            return Ok(Vec::new());
        }
        self.load_model()?;
        let (tensor, ch, cw, scale) = self.letterbox(frame);
        let (session, io) = self.session.as_mut().expect("loaded above");
        let (_shape, outputs) = run(session, io, [1, 3, ch, cw], tensor)?;
        // (1, anchors, 6) = cx, cy, w, h, objectness, class score (one class).
        let mut boxes = Vec::new();
        let mut scores = Vec::new();
        for p in outputs.as_chunks::<6>().0 {
            let score = p[4] * p[5];
            if score >= self.confidence {
                let (half_w, half_h) = (p[2] / 2.0, p[3] / 2.0);
                boxes.push([p[0] - half_w, p[1] - half_h, p[0] + half_w, p[1] + half_h]);
                scores.push(score);
            }
        }
        let (w, h) = (frame.width as i64, frame.height as i64);
        let pad = self.crop_padding.max(0);
        let mut results = Vec::new();
        for index in non_max_suppression(&boxes, &scores, self.nms_iou) {
            let b = boxes[index];
            let back = |v: f32| (v as f64 / scale).round_ties_even() as i64;
            let (x0, y0) = ((back(b[0]) - pad).max(0), (back(b[1]) - pad).max(0));
            let (x1, y1) = ((back(b[2]) + pad).min(w), (back(b[3]) + pad).min(h));
            if x1 - x0 < 2 || y1 - y0 < 2 {
                continue;
            }
            let bbox: BBox = (x0, y0, x1 - x0, y1 - y0);
            results.push((bbox, frame.crop(x0 as usize, y0 as usize, (x1 - x0) as usize, (y1 - y0) as usize)));
        }
        Ok(results)
    }
}

/// The download is complete (sizes only; the hash is checked when it is used).
pub fn is_detector_installed(root: &Path) -> bool {
    is_installed(root, DETECTOR_MODEL_ID)
}

/// Our detector from the verified download, or `None` (not downloaded, or changed).
pub fn build_chatbox_detector(root: &Path, threads: usize, log: &Arc<dyn Log>) -> Option<ChatboxDetector> {
    match resolve_artifact(root, DETECTOR_MODEL_ID, "detector") {
        Ok(path) => match ChatboxDetector::new(path, threads) {
            Ok(detector) => Some(detector),
            Err(error) => {
                log.error(&format!("OCR: {error}"));
                log.info("OCR: the chatbox detector download does not match the catalog; reading without it");
                None
            }
        },
        Err(Error::ModelsMissing(_)) => None,
        Err(error) => {
            log.error(&format!("OCR: {error}"));
            log.info("OCR: the chatbox detector download does not match the catalog; reading without it");
            None
        }
    }
}
