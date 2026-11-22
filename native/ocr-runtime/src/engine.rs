//! The reading engine: what `RapidOCR(params)(crop)` and `readtext_bgr_or_raise` do in
//! the Python implementation, on ONNX Runtime.
//!
//! Steps (RapidOCR 3.9.2 with VRCT-VOX's parameters):
//! 1. keep the picture within 30..2000 px per side, in multiples of 32;
//! 2. pad short or very wide pictures with black rows;
//! 3. detect text lines (`det`), crop each with a perspective warp;
//! 4. recognise the lines in batches of six sorted by aspect ratio (`rec`);
//! 5. map boxes back, drop empty texts and scores below 0.5.
//!
//! The angle classifier is never used (VRChat's chatbox is never rotated).

use std::path::Path;

use ort::environment::Environment;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;

use crate::cv::{warp, Interpolation};
use crate::det::{self, round_to_32, DetConfig, Quad};
use crate::error::{Error, Result};
use crate::image::BgrImage;
use crate::numeric::py_strip;
use crate::rec::{self, REC_BATCH, REC_HEIGHT, REC_WIDTH};

/// How many threads ONNX Runtime may use for OCR: half the cores, at most four.
///
/// VRChat, SteamVR and the VR panels run on the same PC; using every core made the VR
/// panel's capture and laser handling hundreds of milliseconds late on hardware.
pub fn onnx_threads() -> usize {
    let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    (cpus / 2).clamp(1, 4)
}

fn backend(error: impl std::fmt::Display) -> Error {
    Error::Backend(error.to_string())
}

/// The process's ONNX Runtime environment, shared with local translation (`astarot-onnx-runtime`:
/// `ort` allows one per process), made on first use.
pub(crate) fn environment() -> Result<&'static Environment> {
    astarot_onnx_runtime::environment().map_err(backend)
}

/// Whether ONNX Runtime can be used in this process (`ocr_engine.isAvailable`). With the
/// statically linked build this is always true; a dynamically loaded library may be missing.
pub fn is_available() -> bool {
    astarot_onnx_runtime::is_available()
}

/// A CPU session with the options RapidOCR's ONNX Runtime engine sets: no memory arena,
/// every graph optimisation, `threads` intra-op threads and one inter-op thread. Its threads run
/// below normal on Windows ([`crate::priority::BelowNormalThreads`]).
pub(crate) fn session(path: &Path, threads: usize) -> Result<Session> {
    let builder = Session::builder(environment()?).map_err(backend)?;
    let builder = builder.with_log_level(ort::logging::LogLevel::Fatal).map_err(backend)?;
    let builder = builder.with_optimization_level(GraphOptimizationLevel::All).map_err(backend)?;
    let builder = builder.with_execution_providers([ort::ep::CPU::default().with_arena_allocator(false).build()]).map_err(backend)?;
    let builder = builder.with_intra_threads(threads.max(1)).map_err(backend)?;
    let builder = builder.with_inter_threads(1).map_err(backend)?;
    let mut builder = builder.with_thread_manager(crate::priority::BelowNormalThreads).map_err(backend)?;
    builder.commit_from_file(path).map_err(backend)
}

pub(crate) fn io_names(session: &Session) -> Result<(String, String)> {
    let input = session.inputs().first().map(|i| i.name().to_string());
    let output = session.outputs().first().map(|o| o.name().to_string());
    input.zip(output).ok_or_else(|| Error::format("ONNX model", "the graph has no inputs or outputs"))
}

pub(crate) fn run(session: &mut Session, io: &(String, String), shape: [usize; 4], data: Vec<f32>) -> Result<(Vec<usize>, Vec<f32>)> {
    let tensor = Tensor::from_array((shape, data)).map_err(backend)?;
    let outputs = session.run(ort::inputs![io.0.as_str() => tensor]).map_err(backend)?;
    let value = outputs.get(io.1.as_str()).ok_or_else(|| Error::Backend("the graph returned no output".into()))?;
    let (shape, data) = value.try_extract_tensor::<f32>().map_err(backend)?;
    Ok((shape.iter().map(|&d| d as usize).collect(), data.to_vec()))
}

/// RapidOCR's settings that VRCT-VOX leaves at their defaults, plus the thread count.
#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub det: DetConfig,
    pub threads: usize,
    /// Lines below this recognition score are dropped by the engine itself.
    pub text_score: f64,
    pub min_side_len: usize,
    pub max_side_len: usize,
    pub min_height: usize,
    pub width_height_ratio: f64,
}

impl Default for EngineConfig {
    fn default() -> Self {
        EngineConfig { det: DetConfig::default(), threads: onnx_threads(), text_score: 0.5, min_side_len: 30, max_side_len: 2000, min_height: 30, width_height_ratio: 8.0 }
    }
}

/// What RapidOCR returns: one box, text and score per line, top to bottom.
#[derive(Clone, Default)]
pub struct OcrOutput {
    pub boxes: Vec<Quad>,
    pub texts: Vec<String>,
    pub scores: Vec<f64>,
}

impl std::fmt::Debug for OcrOutput {
    // Never print recognised text.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "OcrOutput({} lines)", self.texts.len())
    }
}

/// One recognised line as the Python pipeline holds it (`readtext_bgr` items).
#[derive(Clone, PartialEq)]
pub struct Word {
    pub text: String,
    pub confidence: f64,
    /// `(left, right, top, bottom)` in the read picture's pixels, when the line has a box.
    pub bounds: Option<(f64, f64, f64, f64)>,
}

impl std::fmt::Debug for Word {
    // Never print recognised text.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Word({} chars, {:.3}, {:?})", self.text.chars().count(), self.confidence, self.bounds)
    }
}

pub struct Engine {
    det: Session,
    det_io: (String, String),
    rec: Session,
    rec_io: (String, String),
    characters: Vec<String>,
    right_to_left: bool,
    config: EngineConfig,
}

impl Engine {
    /// Load the detection and recognition graphs. `dictionary` is the recogniser's
    /// character list; `right_to_left` reorders Arabic-script lines for display, as
    /// RapidOCR does for its RTL languages.
    pub fn load(det_model: &Path, rec_model: &Path, dictionary: Vec<String>, right_to_left: bool, config: EngineConfig) -> Result<Engine> {
        let det = session(det_model, config.threads)?;
        let rec = session(rec_model, config.threads)?;
        let det_io = io_names(&det)?;
        let rec_io = io_names(&rec)?;
        Ok(Engine { det, det_io, rec, rec_io, characters: rec::ctc_characters(&dictionary), right_to_left, config })
    }

    /// `readtext_bgr_or_raise`: lines with a non-empty (stripped) text and at least
    /// `min_confidence`, with their bounds. An error is an inference failure; a picture
    /// without readable text gives an empty list.
    pub fn read(&mut self, img: &BgrImage, min_confidence: f64) -> Result<Vec<Word>> {
        if img.is_empty() {
            return Ok(Vec::new());
        }
        let output = self.run(img)?;
        let mut words = Vec::new();
        for (index, text) in output.texts.iter().enumerate() {
            let text = py_strip(text);
            if text.is_empty() {
                continue;
            }
            let confidence = output.scores.get(index).copied().unwrap_or(0.0);
            if confidence < min_confidence {
                continue;
            }
            let bounds = output.boxes.get(index).map(|quad| {
                let xs = quad.iter().map(|p| p.0 as f64);
                let ys = quad.iter().map(|p| p.1 as f64);
                (xs.clone().fold(f64::INFINITY, f64::min), xs.fold(f64::NEG_INFINITY, f64::max), ys.clone().fold(f64::INFINITY, f64::min), ys.fold(f64::NEG_INFINITY, f64::max))
            });
            words.push(Word { text: text.to_string(), confidence, bounds });
        }
        Ok(words)
    }

    /// RapidOCR's `__call__` for a BGR picture.
    pub fn run(&mut self, original: &BgrImage) -> Result<OcrOutput> {
        if original.is_empty() {
            return Ok(OcrOutput::default());
        }
        let (img, ratio_h, ratio_w) = self.within_bounds(original)?;
        let (img, pad_top) = self.vertical_padding(img);

        let Some((tensor, h, w)) = det::preprocess(&img, &self.config.det) else {
            return Ok(OcrOutput::default());
        };
        let (shape, pred) = run(&mut self.det, &self.det_io, [1, 3, h, w], tensor)?;
        if shape.len() != 4 || shape[0] != 1 || shape[1] != 1 {
            return Err(Error::Backend("the detection graph returned an unexpected shape".into()));
        }
        let (map_h, map_w) = (shape[2], shape[3]);
        let (boxes, _det_scores) = det::postprocess(&pred, map_w, map_h, img.width, img.height, &self.config.det);
        if boxes.is_empty() {
            return Ok(OcrOutput::default());
        }

        let crops: Vec<BgrImage> = boxes.iter().map(|quad| rotate_crop(&img, quad)).collect();
        let (texts, scores) = self.recognize(&crops)?;

        // build_final_output: undo the padding and the resize, clip to the picture, then
        // drop empty texts and low scores.
        let (ori_w, ori_h) = (original.width as f32, original.height as f32);
        let mut out = OcrOutput::default();
        for ((mut quad, text), score) in boxes.into_iter().zip(texts).zip(scores) {
            for p in quad.iter_mut() {
                p.1 -= pad_top as f32;
                p.0 *= ratio_w as f32;
                p.1 *= ratio_h as f32;
                p.0 = p.0.max(0.0).min(ori_w);
                p.1 = p.1.max(0.0).min(ori_h);
            }
            if py_strip(&text).is_empty() || score < self.config.text_score {
                continue;
            }
            out.boxes.push(quad);
            out.texts.push(text);
            out.scores.push(score);
        }
        Ok(out)
    }

    /// `resize_image_within_bounds`: returns the picture and the ratios back to the input
    /// (only the last resize's ratios, as RapidOCR keeps them).
    fn within_bounds(&self, img: &BgrImage) -> Result<(BgrImage, f64, f64)> {
        let mut current = img.clone();
        let (mut ratio_h, mut ratio_w) = (1.0, 1.0);
        let max_side = self.config.max_side_len as f64;
        let min_side = self.config.min_side_len as f64;
        if current.height.max(current.width) as f64 > max_side {
            let (h, w) = (current.height as f64, current.width as f64);
            let ratio = if h > w { max_side / h } else { max_side / w };
            (current, ratio_h, ratio_w) = resize_rounded(&current, ratio)?;
        }
        if (current.height.min(current.width) as f64) < min_side {
            let (h, w) = (current.height as f64, current.width as f64);
            let ratio = if h < w { min_side / h } else { min_side / w };
            (current, ratio_h, ratio_w) = resize_rounded(&current, ratio)?;
        }
        Ok((current, ratio_h, ratio_w))
    }

    /// `apply_vertical_padding`: black rows above and below a low or very wide picture.
    fn vertical_padding(&self, img: BgrImage) -> (BgrImage, usize) {
        let (h, w) = (img.height, img.width);
        let ratio = self.config.width_height_ratio;
        let use_limit_ratio = ratio != -1.0 && w as f64 / h as f64 > ratio;
        if h <= self.config.min_height || use_limit_ratio {
            let new_h = ((w as f64 / ratio) as i64).max(self.config.min_height as i64) * 2;
            let padding = ((new_h - h as i64).abs() as f64 / 2.0) as usize;
            return (img.pad_vertical(padding, padding), padding);
        }
        (img, 0)
    }

    /// `TextRecognizer.__call__`: texts and scores in the order of `crops`.
    fn recognize(&mut self, crops: &[BgrImage]) -> Result<(Vec<String>, Vec<f64>)> {
        let ratios: Vec<f64> = crops.iter().map(|c| c.width as f64 / c.height as f64).collect();
        // NumPy's argsort is not stable; ties only matter for which batch a line lands in.
        let mut order: Vec<usize> = (0..crops.len()).collect();
        order.sort_by(|&a, &b| ratios[a].partial_cmp(&ratios[b]).unwrap_or(std::cmp::Ordering::Equal));
        let mut texts = vec![String::new(); crops.len()];
        let mut scores = vec![0.0; crops.len()];
        for batch in order.chunks(REC_BATCH) {
            let mut max_ratio = REC_WIDTH as f64 / REC_HEIGHT as f64;
            for &i in batch {
                max_ratio = max_ratio.max(ratios[i]);
            }
            let mut data = Vec::new();
            let mut width = 0;
            for &i in batch {
                let (planes, w) = rec::resize_norm(&crops[i], max_ratio);
                width = w;
                data.extend_from_slice(&planes);
            }
            let (shape, probs) = run(&mut self.rec, &self.rec_io, [batch.len(), 3, REC_HEIGHT, width], data)?;
            if shape.len() != 3 || shape[0] != batch.len() {
                return Err(Error::Backend("the recognition graph returned an unexpected shape".into()));
            }
            let (steps, classes) = (shape[1], shape[2]);
            for (row, &i) in batch.iter().enumerate() {
                let line = &probs[row * steps * classes..(row + 1) * steps * classes];
                let (text, score) = rec::ctc_decode(line, steps, classes, &self.characters);
                texts[i] = if self.right_to_left { rec::bidi_display(&text) } else { text };
                scores[i] = score;
            }
        }
        Ok((texts, scores))
    }
}

/// `reduce_max_side` / `increase_min_side`: scale by `ratio`, round each side to a
/// multiple of 32 and report the ratios back.
fn resize_rounded(img: &BgrImage, ratio: f64) -> Result<(BgrImage, f64, f64)> {
    let (h, w) = (img.height, img.width);
    let resize_h = round_to_32((h as f64 * ratio) as i64);
    let resize_w = round_to_32((w as f64 * ratio) as i64);
    if resize_h <= 0 || resize_w <= 0 {
        // RapidOCR raises ResizeImgError here, which reaches the caller.
        return Err(Error::invalid("the picture is too small or too narrow to read"));
    }
    let resized = img.resize(resize_w as usize, resize_h as usize, Interpolation::Linear);
    Ok((resized, h as f64 / resize_h as f64, w as f64 / resize_w as f64))
}

/// `get_rotate_crop_image`: the quadrilateral warped upright; tall results are turned a
/// quarter counter-clockwise.
pub fn rotate_crop(img: &BgrImage, quad: &Quad) -> BgrImage {
    let norm = |a: (f32, f32), b: (f32, f32)| {
        let (dx, dy) = (a.0 - b.0, a.1 - b.1);
        (dx * dx + dy * dy).sqrt()
    };
    let width = norm(quad[0], quad[1]).max(norm(quad[2], quad[3])) as usize;
    let height = norm(quad[0], quad[3]).max(norm(quad[1], quad[2])) as usize;
    let dst = [(0.0, 0.0), (width as f32, 0.0), (width as f32, height as f32), (0.0, height as f32)];
    let m = warp::perspective_transform(quad, &dst);
    let data = warp::warp_perspective_cubic_replicate(&img.data, img.width, img.height, 3, &m, width, height);
    let crop = BgrImage { width, height, data };
    if crop.width > 0 && crop.height as f64 / crop.width as f64 >= 1.5 {
        crop.rot90()
    } else {
        crop
    }
}
