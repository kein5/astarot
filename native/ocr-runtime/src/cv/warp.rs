//! `cv::getPerspectiveTransform` and `cv::warpPerspective(..., INTER_CUBIC,
//! BORDER_REPLICATE)` of OpenCV 4.10 for 8-bit images.
//!
//! The transform is solved by LU decomposition with partial pivoting (`DECOMP_LU`) and
//! inverted with the explicit 3×3 formula, both in `f64`. The warp maps destination
//! pixels in 32-pixel blocks to 1/32-pixel source positions and interpolates with
//! OpenCV's 15-bit bicubic weight table, so the result matches `cv2` exactly.

use super::{cv_round_f64, saturate_u8_from_i32};

const INTER_BITS: i32 = 5;
const INTER_TAB_SIZE: i32 = 1 << INTER_BITS;
const REMAP_COEF_BITS: i32 = 15;
const REMAP_COEF_SCALE: i32 = 1 << REMAP_COEF_BITS;

#[allow(clippy::needless_range_loop)] // written like OpenCV's loops, to keep the operation order
/// Solve `a · x = b` in place (OpenCV's `LUImpl` with `DBL_EPSILON * 100`).
fn lu_solve(a: &mut [[f64; 8]; 8], b: &mut [f64; 8]) -> bool {
    let m = 8;
    let eps = f64::EPSILON * 100.0;
    for i in 0..m {
        let mut k = i;
        for j in i + 1..m {
            if a[j][i].abs() > a[k][i].abs() {
                k = j;
            }
        }
        if a[k][i].abs() < eps {
            return false;
        }
        if k != i {
            for j in i..m {
                let t = a[i][j];
                a[i][j] = a[k][j];
                a[k][j] = t;
            }
            b.swap(i, k);
        }
        let d = -1.0 / a[i][i];
        for j in i + 1..m {
            let alpha = a[j][i] * d;
            for k in i + 1..m {
                a[j][k] += alpha * a[i][k];
            }
            b[j] += alpha * b[i];
        }
    }
    for i in (0..m).rev() {
        let mut s = b[i];
        for k in i + 1..m {
            s -= a[i][k] * b[k];
        }
        b[i] = s / a[i][i];
    }
    true
}

/// The 3×3 matrix mapping `src[i]` to `dst[i]`, row-major.
pub fn perspective_transform(src: &[(f32, f32); 4], dst: &[(f32, f32); 4]) -> [f64; 9] {
    let mut a = [[0f64; 8]; 8];
    let mut b = [0f64; 8];
    for i in 0..4 {
        let (sx, sy) = src[i];
        let (dx, dy) = dst[i];
        a[i][0] = sx as f64;
        a[i + 4][3] = sx as f64;
        a[i][1] = sy as f64;
        a[i + 4][4] = sy as f64;
        a[i][2] = 1.0;
        a[i + 4][5] = 1.0;
        // `-src[i].x*dst[i].x` is computed in float before it is stored as a double.
        a[i][6] = (-sx * dx) as f64;
        a[i][7] = (-sy * dx) as f64;
        a[i + 4][6] = (-sx * dy) as f64;
        a[i + 4][7] = (-sy * dy) as f64;
        b[i] = dx as f64;
        b[i + 4] = dy as f64;
    }
    let mut m = [0f64; 9];
    if lu_solve(&mut a, &mut b) {
        m[..8].copy_from_slice(&b);
    }
    // A singular system leaves OpenCV's output zeroed, with the last element set to 1.
    m[8] = 1.0;
    m
}

/// `cv::invert(M, DECOMP_LU)` for a 3×3 matrix; the zero matrix when it is singular.
fn invert3(s: &[f64; 9]) -> [f64; 9] {
    let at = |r: usize, c: usize| s[r * 3 + c];
    let d = at(0, 0) * (at(1, 1) * at(2, 2) - at(1, 2) * at(2, 1)) - at(0, 1) * (at(1, 0) * at(2, 2) - at(1, 2) * at(2, 0)) + at(0, 2) * (at(1, 0) * at(2, 1) - at(1, 1) * at(2, 0));
    if d == 0.0 {
        // cv::invert leaves dst zeroed when it reports failure.
        return [0.0; 9];
    }
    let d = 1.0 / d;
    [
        (at(1, 1) * at(2, 2) - at(1, 2) * at(2, 1)) * d,
        (at(0, 2) * at(2, 1) - at(0, 1) * at(2, 2)) * d,
        (at(0, 1) * at(1, 2) - at(0, 2) * at(1, 1)) * d,
        (at(1, 2) * at(2, 0) - at(1, 0) * at(2, 2)) * d,
        (at(0, 0) * at(2, 2) - at(0, 2) * at(2, 0)) * d,
        (at(0, 2) * at(1, 0) - at(0, 0) * at(1, 2)) * d,
        (at(1, 0) * at(2, 1) - at(1, 1) * at(2, 0)) * d,
        (at(0, 1) * at(2, 0) - at(0, 0) * at(2, 1)) * d,
        (at(0, 0) * at(1, 1) - at(0, 1) * at(1, 0)) * d,
    ]
}

fn interpolate_cubic(x: f32) -> [f32; 4] {
    const A: f32 = -0.75;
    let c0 = ((A * (x + 1.0) - 5.0 * A) * (x + 1.0) + 8.0 * A) * (x + 1.0) - 4.0 * A;
    let c1 = ((A + 2.0) * x - (A + 3.0)) * x * x + 1.0;
    let c2 = ((A + 2.0) * (1.0 - x) - (A + 3.0)) * (1.0 - x) * (1.0 - x) + 1.0;
    let c3 = 1.0 - c0 - c1 - c2;
    [c0, c1, c2, c3]
}

/// OpenCV's fixed-point bicubic table: 32×32 sub-pixel positions × 4×4 weights.
fn bicubic_table() -> &'static [[i16; 16]] {
    static TABLE: std::sync::OnceLock<Vec<[i16; 16]>> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let scale = 1.0f32 / INTER_TAB_SIZE as f32;
        let tab1d: Vec<[f32; 4]> = (0..INTER_TAB_SIZE).map(|i| interpolate_cubic(i as f32 * scale)).collect();
        let mut table = Vec::with_capacity((INTER_TAB_SIZE * INTER_TAB_SIZE) as usize);
        for i in 0..INTER_TAB_SIZE as usize {
            for j in 0..INTER_TAB_SIZE as usize {
                let mut itab = [0i16; 16];
                let mut isum = 0i32;
                for k1 in 0..4 {
                    let vy = tab1d[i][k1];
                    for k2 in 0..4 {
                        let v = vy * tab1d[j][k2];
                        let value = cv_round_f64((v * REMAP_COEF_SCALE as f32) as f64).clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                        itab[k1 * 4 + k2] = value;
                        isum += value as i32;
                    }
                }
                if isum != REMAP_COEF_SCALE {
                    let diff = isum - REMAP_COEF_SCALE;
                    let (mut mk1, mut mk2, mut big1, mut big2) = (2usize, 2usize, 2usize, 2usize);
                    for k1 in 2..4 {
                        for k2 in 2..4 {
                            if itab[k1 * 4 + k2] < itab[mk1 * 4 + mk2] {
                                mk1 = k1;
                                mk2 = k2;
                            } else if itab[k1 * 4 + k2] > itab[big1 * 4 + big2] {
                                big1 = k1;
                                big2 = k2;
                            }
                        }
                    }
                    if diff < 0 {
                        itab[big1 * 4 + big2] = (itab[big1 * 4 + big2] as i32 - diff) as i16;
                    } else {
                        itab[mk1 * 4 + mk2] = (itab[mk1 * 4 + mk2] as i32 - diff) as i16;
                    }
                }
                table.push(itab);
            }
        }
        table
    })
}

/// `cv::warpPerspective(src, M, (dw, dh), flags=INTER_CUBIC, borderMode=BORDER_REPLICATE)`
/// for an interleaved 8-bit image with `cn` channels; `m` maps source to destination.
pub fn warp_perspective_cubic_replicate(src: &[u8], sw: usize, sh: usize, cn: usize, m: &[f64; 9], dw: usize, dh: usize) -> Vec<u8> {
    assert_eq!(src.len(), sw * sh * cn);
    let mut dst = vec![0u8; dw * dh * cn];
    if dw == 0 || dh == 0 {
        return dst;
    }
    let m = invert3(m);
    let table = bicubic_table();
    const BLOCK: usize = 32;
    let mut bh0 = (BLOCK / 2).min(dh);
    let bw0 = (BLOCK * BLOCK / bh0).min(dw);
    bh0 = (BLOCK * BLOCK / bw0).min(dh);
    let width1 = sw.saturating_sub(3) as u32;
    let height1 = sh.saturating_sub(3) as u32;
    let sstep = sw * cn;
    let clamp_x = |x: i32| x.clamp(0, sw as i32 - 1) as usize;
    let clamp_y = |y: i32| y.clamp(0, sh as i32 - 1) as usize;

    let mut y = 0;
    while y < dh {
        let bh = bh0.min(dh - y);
        let mut x = 0;
        while x < dw {
            let bw = bw0.min(dw - x);
            for y1 in 0..bh {
                let yy = (y + y1) as f64;
                let x0 = m[0] * x as f64 + m[1] * yy + m[2];
                let y0 = m[3] * x as f64 + m[4] * yy + m[5];
                let w0 = m[6] * x as f64 + m[7] * yy + m[8];
                for x1 in 0..bw {
                    let w = w0 + m[6] * x1 as f64;
                    let w = if w != 0.0 { INTER_TAB_SIZE as f64 / w } else { 0.0 };
                    let fx = ((x0 + m[0] * x1 as f64) * w).clamp(i32::MIN as f64, i32::MAX as f64);
                    let fy = ((y0 + m[3] * x1 as f64) * w).clamp(i32::MIN as f64, i32::MAX as f64);
                    let ix = cv_round_f64(fx);
                    let iy = cv_round_f64(fy);
                    let sx_full = (ix >> INTER_BITS).clamp(i16::MIN as i32, i16::MAX as i32);
                    let sy_full = (iy >> INTER_BITS).clamp(i16::MIN as i32, i16::MAX as i32);
                    let alpha = ((iy & (INTER_TAB_SIZE - 1)) * INTER_TAB_SIZE + (ix & (INTER_TAB_SIZE - 1))) as usize;
                    let weights = &table[alpha];
                    let sx = sx_full - 1;
                    let sy = sy_full - 1;
                    let out = ((y + y1) * dw + x + x1) * cn;
                    if (sx as u32) < width1 && (sy as u32) < height1 {
                        let base = sy as usize * sstep + sx as usize * cn;
                        for k in 0..cn {
                            let mut sum = 0i32;
                            for r in 0..4 {
                                let row = base + r * sstep + k;
                                for c in 0..4 {
                                    sum += src[row + c * cn] as i32 * weights[r * 4 + c] as i32;
                                }
                            }
                            dst[out + k] = saturate_u8_from_i32((sum + (1 << (REMAP_COEF_BITS - 1))) >> REMAP_COEF_BITS);
                        }
                    } else {
                        // BORDER_REPLICATE: clamp every tap into the image. The border value
                        // (zero) cancels out of OpenCV's `cv + Σ (S - cv) · w` form.
                        let xs: [usize; 4] = std::array::from_fn(|i| clamp_x(sx + i as i32) * cn);
                        let ys: [usize; 4] = std::array::from_fn(|i| clamp_y(sy + i as i32));
                        for k in 0..cn {
                            let mut sum = 0i32;
                            for r in 0..4 {
                                let row = ys[r] * sstep + k;
                                for c in 0..4 {
                                    sum += src[row + xs[c]] as i32 * weights[r * 4 + c] as i32;
                                }
                            }
                            dst[out + k] = saturate_u8_from_i32((sum + (1 << (REMAP_COEF_BITS - 1))) >> REMAP_COEF_BITS);
                        }
                    }
                }
            }
            x += bw0;
        }
        y += bh0;
    }
    dst
}
