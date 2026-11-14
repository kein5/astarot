//! Text line recognition: RapidOCR 3.9.2's `TextRecognizer` (resize, normalise, pad,
//! CTC greedy decoding) around the PP-OCR recognition network.

use crate::cv::Interpolation;
use crate::image::BgrImage;
use crate::numeric::{np_mean, np_round, py_round};

pub const REC_HEIGHT: usize = 48;
pub const REC_WIDTH: usize = 320;
pub const REC_BATCH: usize = 6;

/// `resize_norm_img`: one line resized to height 48, scaled to [-1, 1] and padded with
/// zeros to `int(48 * max_wh_ratio)` columns. Returns the `[3, 48, width]` planes.
pub fn resize_norm(img: &BgrImage, max_wh_ratio: f64) -> (Vec<f32>, usize) {
    let img_width = (REC_HEIGHT as f64 * max_wh_ratio) as usize;
    let ratio = img.width as f64 / img.height as f64;
    let wanted = (REC_HEIGHT as f64 * ratio).ceil();
    let resized_w = if wanted > img_width as f64 { img_width } else { wanted as usize };
    let mut out = vec![0f32; 3 * REC_HEIGHT * img_width];
    if resized_w == 0 {
        return (out, img_width);
    }
    let resized = img.resize(resized_w, REC_HEIGHT, Interpolation::Linear);
    let plane = REC_HEIGHT * img_width;
    for y in 0..REC_HEIGHT {
        for x in 0..resized_w {
            let i = (y * resized_w + x) * 3;
            for c in 0..3 {
                // float32: v / 255, - 0.5, / 0.5
                let v = resized.data[i + c] as f32 / 255.0;
                out[c * plane + y * img_width + x] = (v - 0.5) / 0.5;
            }
        }
    }
    (out, img_width)
}

/// The recogniser's characters as `CTCLabelDecode` holds them: "blank" first, then the
/// dictionary, then a space.
pub fn ctc_characters(dictionary: &[String]) -> Vec<String> {
    let mut characters = Vec::with_capacity(dictionary.len() + 2);
    characters.push("blank".to_string());
    characters.extend(dictionary.iter().cloned());
    characters.push(" ".to_string());
    characters
}

/// Greedy CTC decoding of one line's `[steps][classes]` probabilities: text and score
/// (`np.mean` of the per-character maxima, each rounded with Python's `round(x, 5)`,
/// then rounded again with `np.round(..., 5)`).
pub fn ctc_decode(probs: &[f32], steps: usize, classes: usize, characters: &[String]) -> (String, f64) {
    let mut text = String::new();
    let mut confidences = Vec::new();
    let mut previous: Option<usize> = None;
    for t in 0..steps {
        let row = &probs[t * classes..(t + 1) * classes];
        // argmax keeps the first maximum, max is the value itself.
        let (mut index, mut best) = (0usize, row[0]);
        for (i, &v) in row.iter().enumerate().skip(1) {
            if v > best {
                best = v;
                index = i;
            }
        }
        let keep = previous != Some(index) && index != 0;
        previous = Some(index);
        if keep {
            if let Some(c) = characters.get(index) {
                text.push_str(c);
            }
            confidences.push(py_round(best as f64, 5));
        }
    }
    if confidences.is_empty() {
        confidences.push(0.0);
    }
    (text, np_round(np_mean(&confidences), 5))
}

/// `bidi.get_display` (python-bidi 0.6.11): every paragraph reordered for display.
pub fn bidi_display(text: &str) -> String {
    let info = unicode_bidi::BidiInfo::new(text, None);
    let mut out = String::with_capacity(text.len());
    for paragraph in &info.paragraphs {
        out.push_str(&info.reorder_line(paragraph, paragraph.range.clone()));
    }
    out
}
