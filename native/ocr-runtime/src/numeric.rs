//! The few Python and NumPy behaviours the reference results depend on.

/// Python's `str.isspace()` for one character (bidirectional class WS, B or S, or
/// category Zs). Differs from `char::is_whitespace` in U+001C–U+001F.
pub fn py_isspace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0b}' | '\u{0c}' | '\r' | '\u{1c}' | '\u{1d}' | '\u{1e}' | '\u{1f}' | ' ' | '\u{85}' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}'
    )
}

/// Python's `str.strip()` without arguments.
pub fn py_strip(text: &str) -> &str {
    text.trim_matches(py_isspace)
}

/// Python's `round(x, ndigits)`: correctly rounded to `ndigits` decimals (half to even
/// on the exact binary value), read back as a double.
pub fn py_round(x: f64, ndigits: usize) -> f64 {
    if !x.is_finite() {
        return x;
    }
    // Rust formats the exact decimal expansion and rounds it half to even, as dtoa does.
    format!("{x:.ndigits$}").parse().unwrap_or(x)
}

/// NumPy's pairwise summation of `float32` (`pairwise_sum_FLOAT`): the same blocks as
/// for doubles, with `float` accumulators.
pub fn pairwise_sum_f32(a: &[f32]) -> f32 {
    let n = a.len();
    if n < 8 {
        let mut res = -0.0f32;
        for &v in a {
            res += v;
        }
        res
    } else if n <= 128 {
        let mut r = [0f32; 8];
        r.copy_from_slice(&a[..8]);
        let mut i = 8;
        while i < n - (n % 8) {
            for j in 0..8 {
                r[j] += a[i + j];
            }
            i += 8;
        }
        let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        while i < n {
            res += a[i];
            i += 1;
        }
        res
    } else {
        let mut n2 = n / 2;
        n2 -= n2 % 8;
        pairwise_sum_f32(&a[..n2]) + pairwise_sum_f32(&a[n2..])
    }
}

/// NumPy's pairwise summation of `float64` (`pairwise_sum_DOUBLE`, block size 128).
fn pairwise_sum(a: &[f64]) -> f64 {
    let n = a.len();
    if n < 8 {
        let mut res = -0.0;
        for &v in a {
            res += v;
        }
        res
    } else if n <= 128 {
        let mut r = [0f64; 8];
        r.copy_from_slice(&a[..8]);
        let mut i = 8;
        while i < n - (n % 8) {
            for j in 0..8 {
                r[j] += a[i + j];
            }
            i += 8;
        }
        let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        while i < n {
            res += a[i];
            i += 1;
        }
        res
    } else {
        let mut n2 = n / 2;
        n2 -= n2 % 8;
        pairwise_sum(&a[..n2]) + pairwise_sum(&a[n2..])
    }
}

/// `np.mean` of a 1-D `float64` array: the pairwise sum over all of it, divided by the
/// count.
pub fn np_mean(a: &[f64]) -> f64 {
    if a.is_empty() {
        return f64::NAN;
    }
    pairwise_sum(a) / a.len() as f64
}

/// `np.round(x, decimals)` for a `float64` scalar: `rint(x * 10**d) / 10**d`.
pub fn np_round(x: f64, decimals: i32) -> f64 {
    let f = 10f64.powi(decimals);
    (x * f).round_ties_even() / f
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_matches_python() {
        assert_eq!(py_strip("\u{1c} a b\u{3000}"), "a b");
        assert_eq!(py_strip("\u{200b}x"), "\u{200b}x");
    }

    #[test]
    fn round_is_correctly_rounded() {
        assert_eq!(py_round(0.123455, 5), 0.12345); // 0.123455 is just below the half
        assert_eq!(py_round(2.675, 2), 2.67);
        assert_eq!(py_round(0.5, 0), 0.0);
    }
}
