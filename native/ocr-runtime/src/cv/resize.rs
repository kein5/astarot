//! 8-bit image resizing with the arithmetic of OpenCV 4.10's `cv::resize`.
//!
//! The reference pipeline (RapidOCR on `opencv-python-headless` 4.10.0.84) resizes with
//! `INTER_LINEAR` (the default) and `INTER_AREA`. For 8-bit pixels OpenCV computes both
//! in fixed point or with a fixed operation order, so they can be reproduced bit for bit:
//!
//! - bilinear: 11-bit weights, a horizontal pass into `i32` and the vertical pass
//!   `((b0 * (s0 >> 4)) >> 16) + ((b1 * (s1 >> 4)) >> 16) + 2) >> 2`;
//! - an exact 2× reduction on both axes is computed as the area average, as OpenCV does;
//! - area: per-axis decimation tables with `f32` weights, rounded half to even.
//!
//! IPP is not used by OpenCV for these cases (it is not bit-exact for 8-bit linear and
//! area resizing), so the generic code is the reference.

use super::{cv_round_f64, saturate_u8_from_i32};

const COEF_BITS: i32 = 11;
const COEF_SCALE: i32 = 1 << COEF_BITS;

/// Interpolation for [`resize`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interpolation {
    Linear,
    Area,
}

/// Resize an interleaved 8-bit image with `cn` channels to `dw`×`dh`.
pub fn resize(src: &[u8], sw: usize, sh: usize, cn: usize, dw: usize, dh: usize, interpolation: Interpolation) -> Vec<u8> {
    assert!(sw > 0 && sh > 0 && dw > 0 && dh > 0 && cn > 0, "resize needs non-empty sizes");
    assert_eq!(src.len(), sw * sh * cn, "resize: buffer does not match its size");
    if (dw, dh) == (sw, sh) {
        return src.to_vec();
    }
    let inv_scale_x = dw as f64 / sw as f64;
    let inv_scale_y = dh as f64 / sh as f64;
    let scale_x = 1.0 / inv_scale_x;
    let scale_y = 1.0 / inv_scale_y;
    let iscale_x = cv_round_f64(scale_x);
    let iscale_y = cv_round_f64(scale_y);
    let is_area_fast = (scale_x - iscale_x as f64).abs() < f64::EPSILON && (scale_y - iscale_y as f64).abs() < f64::EPSILON;

    let mut interpolation = interpolation;
    if interpolation == Interpolation::Linear && is_area_fast && iscale_x == 2 && iscale_y == 2 {
        interpolation = Interpolation::Area;
    }
    if interpolation == Interpolation::Area && scale_x >= 1.0 && scale_y >= 1.0 {
        if is_area_fast {
            return area_fast(src, sw, sh, cn, dw, dh, iscale_x as usize, iscale_y as usize);
        }
        return area(src, sw, sh, cn, dw, dh, scale_x, scale_y);
    }
    // Upscaling with INTER_AREA is emulated with bilinear-style weights.
    generic_linear(src, sw, sh, cn, dw, dh, scale_x, scale_y, inv_scale_x, inv_scale_y, interpolation == Interpolation::Area)
}

#[allow(clippy::too_many_arguments)]
fn generic_linear(src: &[u8], sw: usize, sh: usize, cn: usize, dw: usize, dh: usize, scale_x: f64, scale_y: f64, inv_scale_x: f64, inv_scale_y: f64, area_mode: bool) -> Vec<u8> {
    let (sw_i, sh_i) = (sw as i32, sh as i32);
    let mut xmin = 0usize;
    let mut xmax = dw;
    let mut xofs = vec![0usize; dw * cn];
    let mut ialpha = vec![0i16; dw * cn * 2];
    for dx in 0..dw {
        let (mut sx, mut fx);
        if !area_mode {
            fx = ((dx as f64 + 0.5) * scale_x - 0.5) as f32;
            sx = fx.floor() as i32;
            fx -= sx as f32;
        } else {
            sx = (dx as f64 * scale_x).floor() as i32;
            fx = ((dx + 1) as f64 - (sx + 1) as f64 * inv_scale_x) as f32;
            fx = if fx <= 0.0 { 0.0 } else { fx - fx.floor() };
        }
        if sx < 0 {
            xmin = dx + 1;
            fx = 0.0;
            sx = 0;
        }
        if sx + 1 >= sw_i {
            xmax = xmax.min(dx);
            if sx >= sw_i - 1 {
                fx = 0.0;
                sx = sw_i - 1;
            }
        }
        let cbuf = [1.0 - fx, fx];
        for k in 0..cn {
            xofs[dx * cn + k] = sx as usize * cn + k;
        }
        for k in 0..2 {
            ialpha[dx * cn * 2 + k] = saturate_i16(cbuf[k] * COEF_SCALE as f32);
        }
        for k in 2..cn * 2 {
            ialpha[dx * cn * 2 + k] = ialpha[dx * cn * 2 + k - 2];
        }
    }
    let _ = xmin;
    let mut yofs = vec![0i32; dh];
    let mut ibeta = vec![0i16; dh * 2];
    for dy in 0..dh {
        let (sy, mut fy);
        if !area_mode {
            fy = ((dy as f64 + 0.5) * scale_y - 0.5) as f32;
            sy = fy.floor() as i32;
            fy -= sy as f32;
        } else {
            sy = (dy as f64 * scale_y).floor() as i32;
            fy = ((dy + 1) as f64 - (sy + 1) as f64 * inv_scale_y) as f32;
            fy = if fy <= 0.0 { 0.0 } else { fy - fy.floor() };
        }
        yofs[dy] = sy;
        ibeta[dy * 2] = saturate_i16((1.0 - fy) * COEF_SCALE as f32);
        ibeta[dy * 2 + 1] = saturate_i16(fy * COEF_SCALE as f32);
    }

    // resizeGeneric_ works on interleaved element columns.
    let width = dw * cn;
    let xmax = xmax * cn;
    let row_len = sw * cn;
    let hresize = |row: &[u8], out: &mut [i32]| {
        for dx in 0..xmax {
            let sx = xofs[dx];
            out[dx] = row[sx] as i32 * ialpha[dx * 2] as i32 + row[sx + cn] as i32 * ialpha[dx * 2 + 1] as i32;
        }
        for dx in xmax..width {
            out[dx] = row[xofs[dx]] as i32 * COEF_SCALE;
        }
    };
    let mut dst = vec![0u8; dw * dh * cn];
    let mut rows = [vec![0i32; width], vec![0i32; width]];
    let mut prev_sy = [-1i32, -1i32];
    for dy in 0..dh {
        let sy0 = yofs[dy];
        for k in 0..2 {
            let sy = clip(sy0 + k as i32, 0, sh_i);
            if prev_sy[k] == sy {
                continue;
            }
            if k == 0 && prev_sy[1] == sy {
                // OpenCV reuses an already filtered row instead of filtering it again.
                let (first, second) = rows.split_at_mut(1);
                first[0].copy_from_slice(&second[0]);
            } else {
                let start = sy as usize * row_len;
                hresize(&src[start..start + row_len], &mut rows[k]);
            }
            prev_sy[k] = sy;
        }
        let (b0, b1) = (ibeta[dy * 2] as i32, ibeta[dy * 2 + 1] as i32);
        let out = &mut dst[dy * width..(dy + 1) * width];
        for x in 0..width {
            let value = (((b0 * (rows[0][x] >> 4)) >> 16) + ((b1 * (rows[1][x] >> 4)) >> 16) + 2) >> 2;
            out[x] = value as u8;
        }
    }
    dst
}

fn clip(x: i32, a: i32, b: i32) -> i32 {
    if x >= a {
        if x < b {
            x
        } else {
            b - 1
        }
    } else {
        a
    }
}

fn saturate_i16(value: f32) -> i16 {
    let rounded = super::cv_round_f32(value);
    rounded.clamp(i16::MIN as i32, i16::MAX as i32) as i16
}

#[allow(clippy::too_many_arguments)]
fn area_fast(src: &[u8], sw: usize, sh: usize, cn: usize, dw: usize, dh: usize, scale_x: usize, scale_y: usize) -> Vec<u8> {
    let row_len = sw * cn;
    let swidth = sw * cn;
    let dwidth = dw * cn;
    let dwidth1 = (sw / scale_x) * cn;
    let area = scale_x * scale_y;
    let scale = 1.0f32 / area as f32;
    let mut ofs = Vec::with_capacity(area);
    for sy in 0..scale_y {
        for sx in 0..scale_x {
            ofs.push(sy * row_len + sx * cn);
        }
    }
    let mut xofs = vec![0usize; dwidth];
    for dx in 0..dw {
        let j = dx * cn;
        let sx = scale_x * j;
        for k in 0..cn {
            xofs[j + k] = sx + k;
        }
    }
    let fast_mode = scale_x == 2 && scale_y == 2 && (cn == 1 || cn == 3 || cn == 4);
    let mut dst = vec![0u8; dwidth * dh];
    for dy in 0..dh {
        let out = &mut dst[dy * dwidth..(dy + 1) * dwidth];
        let sy0 = dy * scale_y;
        let w = if sy0 + scale_y <= sh { dwidth1 } else { 0 };
        if sy0 >= sh {
            out.fill(0);
            continue;
        }
        let base = sy0 * row_len;
        let mut dx = 0;
        if fast_mode {
            let s = &src[base..];
            let next = &src[base + row_len..];
            while dx < w {
                // The left source pixel of destination element `dx` starts at
                // (dx / cn) * 2 * cn; the element sits at channel dx % cn.
                let left = (dx / cn) * 2 * cn + dx % cn;
                let right = left + cn;
                out[dx] = ((s[left] as u32 + s[right] as u32 + next[left] as u32 + next[right] as u32 + 2) >> 2) as u8;
                dx += 1;
            }
        } else {
            while dx < w {
                let s = base + xofs[dx];
                let sum: i32 = ofs.iter().map(|&o| src[s + o] as i32).sum();
                out[dx] = saturate_u8_from_f32(sum as f32 * scale);
                dx += 1;
            }
        }
        while dx < dwidth {
            let mut sum = 0i32;
            let mut count = 0i32;
            let sx0 = xofs[dx];
            if sx0 >= swidth {
                out[dx] = 0;
            }
            for sy in 0..scale_y {
                if sy0 + sy >= sh {
                    break;
                }
                let row = (sy0 + sy) * row_len + sx0;
                let mut sx = 0;
                while sx < scale_x * cn {
                    if sx0 + sx >= swidth {
                        break;
                    }
                    sum += src[row + sx] as i32;
                    count += 1;
                    sx += cn;
                }
            }
            out[dx] = saturate_u8_from_f32(sum as f32 / count as f32);
            dx += 1;
        }
    }
    dst
}

fn saturate_u8_from_f32(value: f32) -> u8 {
    saturate_u8_from_i32(super::cv_round_f32(value))
}

struct Decimate {
    si: usize,
    di: usize,
    alpha: f32,
}

fn area_tab(ssize: usize, dsize: usize, cn: usize, scale: f64) -> Vec<Decimate> {
    let mut tab = Vec::with_capacity(ssize * 2);
    for dx in 0..dsize {
        let fsx1 = dx as f64 * scale;
        let fsx2 = fsx1 + scale;
        let cell_width = scale.min(ssize as f64 - fsx1);
        let mut sx1 = fsx1.ceil() as i64;
        let mut sx2 = fsx2.floor() as i64;
        sx2 = sx2.min(ssize as i64 - 1);
        sx1 = sx1.min(sx2);
        if sx1 as f64 - fsx1 > 1e-3 {
            tab.push(Decimate { di: dx * cn, si: (sx1 - 1) as usize * cn, alpha: ((sx1 as f64 - fsx1) / cell_width) as f32 });
        }
        for sx in sx1..sx2 {
            tab.push(Decimate { di: dx * cn, si: sx as usize * cn, alpha: (1.0 / cell_width) as f32 });
        }
        if fsx2 - sx2 as f64 > 1e-3 {
            tab.push(Decimate { di: dx * cn, si: sx2 as usize * cn, alpha: ((fsx2 - sx2 as f64).min(1.0).min(cell_width) / cell_width) as f32 });
        }
    }
    tab
}

#[allow(clippy::too_many_arguments)]
fn area(src: &[u8], sw: usize, sh: usize, cn: usize, dw: usize, dh: usize, scale_x: f64, scale_y: f64) -> Vec<u8> {
    let xtab = area_tab(sw, dw, cn, scale_x);
    let ytab = area_tab(sh, dh, 1, scale_y);
    let width = dw * cn;
    let row_len = sw * cn;
    let mut dst = vec![0u8; width * dh];
    let mut buf = vec![0f32; width];
    let mut sum = vec![0f32; width];
    let mut prev_dy = ytab[0].di;
    let store = |sum: &[f32], dst: &mut [u8], dy: usize| {
        for (out, value) in dst[dy * width..(dy + 1) * width].iter_mut().zip(sum) {
            *out = saturate_u8_from_f32(*value);
        }
    };
    for entry in &ytab {
        let beta = entry.alpha;
        let dy = entry.di;
        let row = &src[entry.si * row_len..(entry.si + 1) * row_len];
        buf.fill(0.0);
        for x in &xtab {
            for c in 0..cn {
                buf[x.di + c] += row[x.si + c] as f32 * x.alpha;
            }
        }
        if dy != prev_dy {
            store(&sum, &mut dst, prev_dy);
            for (s, b) in sum.iter_mut().zip(&buf) {
                *s = beta * *b;
            }
            prev_dy = dy;
        } else {
            for (s, b) in sum.iter_mut().zip(&buf) {
                *s += beta * *b;
            }
        }
    }
    store(&sum, &mut dst, prev_dy);
    dst
}
