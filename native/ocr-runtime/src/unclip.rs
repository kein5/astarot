//! Growing a detected text box ("unclip"), as RapidOCR does with Shapely and pyclipper.
//!
//! RapidOCR offsets the box by `area * ratio / perimeter` (Shapely 2.1.2 on GEOS 3.13.1)
//! with a round-joined `ClipperOffset` (Clipper 6.4.2 through pyclipper 1.4.0, arc
//! tolerance 0.25, Boost Software License). The offset is reproduced here; Clipper then
//! unions the single polygon with itself, which only drops repeated and collinear
//! vertices and starts the ring so that it ends at the top-most (then right-most)
//! vertex. That normalisation was established by comparing against pyclipper.

// Clipper writes pi out as 3.141592653589793238, which is this double.
const PI: f64 = std::f64::consts::PI;
const TWO_PI: f64 = PI * 2.0;
const ARC_TOLERANCE: f64 = 0.25;

/// GEOS `Area::ofRingSigned` over the closed ring of `points`, made absolute.
pub fn polygon_area(points: &[(f64, f64)]) -> f64 {
    let mut ring: Vec<(f64, f64)> = points.to_vec();
    ring.push(points[0]);
    let n = ring.len();
    if n < 3 {
        return 0.0;
    }
    let x0 = ring[0].0;
    let mut p1 = ring[0];
    let mut p2 = (ring[1].0 - x0, ring[1].1);
    let mut sum = 0.0;
    for i in 1..n - 1 {
        let p0y = p1.1;
        p1 = p2;
        p2 = (ring[i + 1].0 - x0, ring[i + 1].1);
        sum += p1.0 * (p0y - p2.1);
    }
    (sum / 2.0).abs()
}

/// GEOS `Length::ofLine` over the closed ring of `points`.
pub fn polygon_length(points: &[(f64, f64)]) -> f64 {
    let mut len = 0.0;
    let (mut x0, mut y0) = points[0];
    for &(x1, y1) in points.iter().skip(1).chain(std::iter::once(&points[0])) {
        let (dx, dy) = (x1 - x0, y1 - y0);
        len += (dx * dx + dy * dy).sqrt();
        x0 = x1;
        y0 = y1;
    }
    len
}

/// Clipper's `Round`: half away from zero.
fn round(value: f64) -> i64 {
    if value < 0.0 {
        (value - 0.5) as i64
    } else {
        (value + 0.5) as i64
    }
}

fn area(poly: &[(i64, i64)]) -> f64 {
    let size = poly.len();
    if size < 3 {
        return 0.0;
    }
    let mut a = 0.0;
    let mut j = size - 1;
    for i in 0..size {
        a += (poly[j].0 as f64 + poly[i].0 as f64) * (poly[j].1 as f64 - poly[i].1 as f64);
        j = i;
    }
    -a * 0.5
}

fn unit_normal(p1: (i64, i64), p2: (i64, i64)) -> (f64, f64) {
    if p1 == p2 {
        return (0.0, 0.0);
    }
    let mut dx = (p2.0 - p1.0) as f64;
    let mut dy = (p2.1 - p1.1) as f64;
    let f = 1.0 / (dx * dx + dy * dy).sqrt();
    dx *= f;
    dy *= f;
    (dy, -dx)
}

/// `ClipperOffset(JT_ROUND, ET_CLOSEDPOLYGON).Execute(delta)` for one polygon with a
/// positive `delta`. Returns no points when Clipper would return nothing.
pub fn offset_round(path: &[(i64, i64)], delta: f64) -> Vec<(i64, i64)> {
    // AddPath: drop a repeated closing point and consecutive duplicates.
    if path.is_empty() {
        return Vec::new();
    }
    let mut high = path.len() - 1;
    while high > 0 && path[0] == path[high] {
        high -= 1;
    }
    let mut contour = vec![path[0]];
    for &point in &path[1..=high] {
        if *contour.last().unwrap() != point {
            contour.push(point);
        }
    }
    if contour.len() < 3 {
        return Vec::new();
    }
    // FixOrientations: a single closed polygon is made positive.
    if area(&contour) < 0.0 {
        contour.reverse();
    }
    if delta.is_nan() || delta < 1e-20 {
        // Not reached by the OCR pipeline (its distance is always well above zero).
        return clean(contour);
    }
    let y = if ARC_TOLERANCE > delta.abs() * ARC_TOLERANCE { delta.abs() * ARC_TOLERANCE } else { ARC_TOLERANCE };
    let mut steps = PI / (1.0 - y / delta.abs()).acos();
    if steps > delta.abs() * PI {
        steps = delta.abs() * PI;
    }
    let sin = (TWO_PI / steps).sin();
    let cos = (TWO_PI / steps).cos();
    let steps_per_rad = steps / TWO_PI;

    let src = contour;
    let len = src.len();
    let mut normals: Vec<(f64, f64)> = (0..len - 1).map(|j| unit_normal(src[j], src[j + 1])).collect();
    normals.push(unit_normal(src[len - 1], src[0]));
    let mut dest: Vec<(i64, i64)> = Vec::new();
    let at = |j: usize, n: (f64, f64)| (round(src[j].0 as f64 + n.0 * delta), round(src[j].1 as f64 + n.1 * delta));
    let mut k = len - 1;
    for j in 0..len {
        let (nk, nj) = (normals[k], normals[j]);
        let mut sin_a = nk.0 * nj.1 - nj.0 * nk.1;
        if (sin_a * delta).abs() < 1.0 {
            let cos_a = nk.0 * nj.0 + nj.1 * nk.1;
            if cos_a > 0.0 {
                dest.push(at(j, nk));
                k = j;
                continue;
            }
        } else {
            sin_a = sin_a.clamp(-1.0, 1.0);
        }
        if sin_a * delta < 0.0 {
            dest.push(at(j, nk));
            dest.push(src[j]);
            dest.push(at(j, nj));
        } else {
            // DoRound
            let a = sin_a.atan2(nk.0 * nj.0 + nk.1 * nj.1);
            let steps = (round(steps_per_rad * a.abs()) as i32).max(1);
            let (mut x, mut y) = nk;
            for _ in 0..steps {
                dest.push((round(src[j].0 as f64 + x * delta), round(src[j].1 as f64 + y * delta)));
                let x2 = x;
                x = x * cos - sin * y;
                y = x2 * sin + y * cos;
            }
            dest.push(at(j, nj));
        }
        k = j;
    }
    clean(dest)
}

/// What Clipper's union leaves of one convex ring: no repeated or collinear vertices,
/// same orientation, ending at the vertex with the smallest y (then largest x).
fn clean(mut ring: Vec<(i64, i64)>) -> Vec<(i64, i64)> {
    ring.dedup();
    while ring.len() > 1 && ring.first() == ring.last() {
        ring.pop();
    }
    loop {
        let n = ring.len();
        if n < 3 {
            return Vec::new();
        }
        let collinear = (0..n).find(|&i| {
            let a = ring[(i + n - 1) % n];
            let b = ring[i];
            let c = ring[(i + 1) % n];
            (b.0 - a.0) as i128 * (c.1 - b.1) as i128 - (b.1 - a.1) as i128 * (c.0 - b.0) as i128 == 0
        });
        match collinear {
            Some(i) => {
                ring.remove(i);
            }
            None => break,
        }
    }
    let last = (0..ring.len()).min_by(|&a, &b| ring[a].1.cmp(&ring[b].1).then(ring[b].0.cmp(&ring[a].0))).unwrap();
    let n = ring.len();
    ring.rotate_left((last + 1) % n);
    ring
}
