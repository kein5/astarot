//! The OpenCV operations the reference pipeline uses, reimplemented with the same
//! arithmetic (OpenCV 4.10.0, Apache-2.0).
//!
//! Each function follows the generic (non-IPP, non-OpenCL) code path that
//! `opencv-python-headless` 4.10.0.84 takes for the inputs the OCR pipeline gives it, so
//! the results match bit for bit where OpenCV itself is deterministic. The conformance
//! tests compare every function against `cv2` on recorded inputs.

pub mod contours;
pub mod draw;
pub mod geometry;
pub mod resize;
pub mod warp;

pub use resize::{resize, Interpolation};

/// `cvRound` for doubles: round half to even, saturated to `i32`.
pub fn cv_round_f64(value: f64) -> i32 {
    let rounded = value.round_ties_even();
    if rounded.is_nan() {
        return i32::MIN;
    }
    rounded.clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

/// `cvRound` for floats.
pub fn cv_round_f32(value: f32) -> i32 {
    cv_round_f64(value as f64)
}

pub fn saturate_u8_from_i32(value: i32) -> u8 {
    value.clamp(0, 255) as u8
}

/// `cv::dilate` with the 2×2 kernel of ones (anchor at its centre, (1, 1)) on a 0/1 map.
///
/// Every output pixel is the maximum over itself, its left, upper and upper-left
/// neighbours; outside pixels never win (OpenCV pads dilation with the minimum).
pub fn dilate_2x2(src: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut out = vec![0u8; src.len()];
    for y in 0..height {
        for x in 0..width {
            let mut value = src[y * width + x];
            if x > 0 {
                value = value.max(src[y * width + x - 1]);
            }
            if y > 0 {
                value = value.max(src[(y - 1) * width + x]);
                if x > 0 {
                    value = value.max(src[(y - 1) * width + x - 1]);
                }
            }
            out[y * width + x] = value;
        }
    }
    out
}

/// `cv::mean(src, mask)[0]` for a single-channel `f32` map: the sum over masked pixels
/// in `f64`, row by row, divided by their count.
pub fn mean_masked(src: &[f32], mask: &[u8]) -> f64 {
    let mut sum = 0.0f64;
    let mut count = 0usize;
    for (value, m) in src.iter().zip(mask) {
        if *m != 0 {
            sum += *value as f64;
            count += 1;
        }
    }
    if count == 0 {
        0.0
    } else {
        sum * (1.0 / count as f64)
    }
}
