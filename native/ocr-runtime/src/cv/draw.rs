//! `cv::fillPoly` of OpenCV 4.10 for one polygon on a single-channel 8-bit image with
//! `LINE_8`, no sub-pixel shift and no offset.
//!
//! OpenCV first draws every edge with an 8-connected line, then fills the inside with an
//! active-edge scanline in 16.16 fixed point. Both are reproduced here.

const XY_SHIFT: i32 = 16;
const XY_ONE: i64 = 1 << XY_SHIFT;

/// `cv::clipLine` on `[0, width) × [0, height)`; false when the line is fully outside.
fn clip_line(width: i64, height: i64, p1: &mut (i64, i64), p2: &mut (i64, i64)) -> bool {
    let right = width - 1;
    let bottom = height - 1;
    if width <= 0 || height <= 0 {
        return false;
    }
    let code = |x: i64, y: i64| -> i32 { (x < 0) as i32 + (x > right) as i32 * 2 + (y < 0) as i32 * 4 + (y > bottom) as i32 * 8 };
    let mut c1 = code(p1.0, p1.1);
    let mut c2 = code(p2.0, p2.1);
    if (c1 & c2) == 0 && (c1 | c2) != 0 {
        if c1 & 12 != 0 {
            let a = if c1 < 8 { 0 } else { bottom };
            p1.0 += ((a - p1.1) as f64 * (p2.0 - p1.0) as f64 / (p2.1 - p1.1) as f64) as i64;
            p1.1 = a;
            c1 = (p1.0 < 0) as i32 + (p1.0 > right) as i32 * 2;
        }
        if c2 & 12 != 0 {
            let a = if c2 < 8 { 0 } else { bottom };
            p2.0 += ((a - p2.1) as f64 * (p2.0 - p1.0) as f64 / (p2.1 - p1.1) as f64) as i64;
            p2.1 = a;
            c2 = (p2.0 < 0) as i32 + (p2.0 > right) as i32 * 2;
        }
        if (c1 & c2) == 0 && (c1 | c2) != 0 {
            if c1 != 0 {
                let a = if c1 == 1 { 0 } else { right };
                p1.1 += ((a - p1.0) as f64 * (p2.1 - p1.1) as f64 / (p2.0 - p1.0) as f64) as i64;
                p1.0 = a;
                c1 = 0;
            }
            if c2 != 0 {
                let a = if c2 == 1 { 0 } else { right };
                p2.1 += ((a - p2.0) as f64 * (p2.1 - p1.1) as f64 / (p2.0 - p1.0) as f64) as i64;
                p2.0 = a;
                c2 = 0;
            }
        }
    }
    (c1 | c2) == 0
}

/// `Line(img, p1, p2, color, 8)`: an 8-connected line through `cv::LineIterator`
/// (left to right).
fn line(img: &mut [u8], width: usize, height: usize, p1: (i64, i64), p2: (i64, i64), color: u8) {
    let (mut p1, mut p2) = (p1, p2);
    let outside = |p: (i64, i64)| p.0 < 0 || p.0 >= width as i64 || p.1 < 0 || p.1 >= height as i64;
    if (outside(p1) || outside(p2)) && !clip_line(width as i64, height as i64, &mut p1, &mut p2) {
        return;
    }
    // Points are passed through `int` by the iterator.
    let (mut x1, mut y1) = (p1.0 as i32, p1.1 as i32);
    let (x2, y2) = (p2.0 as i32, p2.1 as i32);
    let mut dx = x2 - x1;
    let mut dy = y2 - y1;
    let mut delta_x = 1i32;
    let mut delta_y = 1i32;
    if dx < 0 {
        // leftToRight
        dx = -dx;
        dy = -dy;
        x1 = x2;
        y1 = y2;
    }
    if dy < 0 {
        dy = -dy;
        delta_y = -1;
    }
    let vert = dy > dx;
    if vert {
        std::mem::swap(&mut dx, &mut dy);
        std::mem::swap(&mut delta_x, &mut delta_y);
    }
    let mut err = dx - (dy + dy);
    let plus_delta = dx + dx;
    let minus_delta = -(dy + dy);
    let (mut minus_shift, mut plus_shift, mut minus_step, mut plus_step) = (delta_x, 0, 0, delta_y);
    let count = dx + 1;
    if vert {
        std::mem::swap(&mut plus_step, &mut plus_shift);
        std::mem::swap(&mut minus_step, &mut minus_shift);
    }
    let (mut x, mut y) = (x1, y1);
    for _ in 0..count {
        img[y as usize * width + x as usize] = color;
        let mask = if err < 0 { -1 } else { 0 };
        err += minus_delta + (plus_delta & mask);
        x += minus_shift + (plus_shift & mask);
        y += minus_step + (plus_step & mask);
    }
}

#[derive(Clone, Copy)]
struct PolyEdge {
    y0: i32,
    y1: i32,
    x: i64,
    dx: i64,
    next: usize,
}

const NONE: usize = usize::MAX;

/// Fill the polygon `points` with `color`.
pub fn fill_poly(img: &mut [u8], width: usize, height: usize, points: &[(i32, i32)], color: u8) {
    let count = points.len();
    if count == 0 {
        return;
    }
    let mut edges: Vec<PolyEdge> = Vec::with_capacity(count + 1);
    // CollectPolyEdges with shift 0: x in 16.16 fixed point, y in pixels.
    let fixed = |p: (i32, i32)| ((p.0 as i64) << XY_SHIFT, p.1 as i64);
    let mut pt0 = fixed(points[count - 1]);
    for &point in points {
        let pt1 = fixed(point);
        let (mut pt0c, mut pt1c) = (pt0, pt1);
        let mut t0 = ((pt0.0 + (XY_ONE >> 1)) >> XY_SHIFT, pt0.1);
        let mut t1 = ((pt1.0 + (XY_ONE >> 1)) >> XY_SHIFT, pt1.1);
        line(img, width, height, t0, t1, color);
        let outside = |t: (i64, i64)| (t.0 as u64) >= width as u64 || (t.1 as u64) >= height as u64;
        if outside(t0) || outside(t1) {
            clip_line(width as i64, height as i64, &mut t0, &mut t1);
            if t0.1 != t1.1 {
                pt0c.1 = t0.1;
                pt1c.1 = t1.1;
                pt0c.0 = t0.0 << XY_SHIFT;
                pt1c.0 = t1.0 << XY_SHIFT;
            }
        } else {
            pt0c.0 += XY_ONE >> 1;
            pt1c.0 += XY_ONE >> 1;
        }
        if pt0.1 != pt1.1 {
            let dx = (pt1c.0 - pt0c.0) / (pt1c.1 - pt0c.1);
            let edge = if pt0.1 < pt1.1 {
                PolyEdge { y0: pt0.1 as i32, y1: pt1.1 as i32, x: pt0c.0 + (pt0.1 - pt0c.1) * dx, dx, next: NONE }
            } else {
                PolyEdge { y0: pt1.1 as i32, y1: pt0.1 as i32, x: pt1c.0 + (pt1.1 - pt1c.1) * dx, dx, next: NONE }
            };
            edges.push(edge);
        }
        pt0 = pt1;
    }
    fill_edge_collection(img, width, height, edges, color);
}

fn fill_edge_collection(img: &mut [u8], width: usize, height: usize, mut edges: Vec<PolyEdge>, color: u8) {
    let total = edges.len();
    if total < 2 {
        return;
    }
    let (mut y_max, mut y_min) = (i32::MIN, i32::MAX);
    let (mut x_max, mut x_min) = (-1i64, i64::MAX);
    for e in &edges {
        let x1 = e.x + (e.y1 - e.y0) as i64 * e.dx;
        y_min = y_min.min(e.y0);
        y_max = y_max.max(e.y1);
        x_min = x_min.min(e.x).min(x1);
        x_max = x_max.max(e.x).max(x1);
    }
    if y_max < 0 || y_min >= height as i32 || x_max < 0 || x_min >= ((width as i64) << XY_SHIFT) {
        return;
    }
    edges.sort_by(|e1, e2| {
        if e1.y0 != e2.y0 {
            e1.y0.cmp(&e2.y0)
        } else if e1.x != e2.x {
            e1.x.cmp(&e2.x)
        } else {
            e1.dx.cmp(&e2.dx)
        }
    });
    // Sentinel after the sorted edges, and the list head `tmp` at index total + 1.
    edges.push(PolyEdge { y0: i32::MAX, y1: 0, x: 0, dx: 0, next: NONE });
    let tmp = edges.len();
    edges.push(PolyEdge { y0: 0, y1: 0, x: 0, dx: 0, next: NONE });
    let mut i = 0usize;
    let y_max = y_max.min(height as i32);
    let mut y = edges[0].y0;
    while y < y_max {
        let mut draw = false;
        let clipline = y < 0;
        let mut prelast = tmp;
        let mut last = edges[tmp].next;
        loop {
            if !(last != NONE || edges[i].y0 == y) {
                break;
            }
            if last != NONE && edges[last].y1 == y {
                // exclude the edge once y reaches its lower end
                edges[prelast].next = edges[last].next;
                last = edges[last].next;
                continue;
            }
            let keep_prelast = prelast;
            if last != NONE && (edges[i].y0 > y || edges[last].x < edges[i].x) {
                prelast = last;
                last = edges[last].next;
            } else if i < total {
                // insert the next edge into the active list
                edges[prelast].next = i;
                edges[i].next = last;
                prelast = i;
                i += 1;
            } else {
                break;
            }
            if draw {
                if !clipline {
                    let (x1, x2) = if edges[keep_prelast].x > edges[prelast].x {
                        ((edges[prelast].x >> XY_SHIFT) as i32, (edges[keep_prelast].x >> XY_SHIFT) as i32)
                    } else {
                        ((edges[keep_prelast].x >> XY_SHIFT) as i32, (edges[prelast].x >> XY_SHIFT) as i32)
                    };
                    if x1 < width as i32 && x2 >= 0 {
                        let x1 = x1.max(0) as usize;
                        let x2 = x2.min(width as i32 - 1) as usize;
                        let row = y as usize * width;
                        img[row + x1..=row + x2].fill(color);
                    }
                }
                let dx = edges[keep_prelast].dx;
                edges[keep_prelast].x += dx;
                let dx = edges[prelast].dx;
                edges[prelast].x += dx;
            }
            draw = !draw;
        }

        // sort the active edges by x (bubble sort)
        let mut keep_prelast = NONE;
        loop {
            let mut prelast = tmp;
            let mut last = edges[tmp].next;
            let mut last_exchange = NONE;
            while last != keep_prelast && edges[last].next != NONE {
                let te = edges[last].next;
                if edges[last].x > edges[te].x {
                    edges[prelast].next = te;
                    edges[last].next = edges[te].next;
                    edges[te].next = last;
                    prelast = te;
                    last_exchange = prelast;
                } else {
                    prelast = last;
                    last = te;
                }
            }
            if last_exchange == NONE {
                break;
            }
            keep_prelast = last_exchange;
            if keep_prelast == edges[tmp].next || keep_prelast == tmp {
                break;
            }
        }
        y += 1;
    }
}
