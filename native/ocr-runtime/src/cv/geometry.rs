//! `cv::convexHull`, `cv::minAreaRect` and `cv::boxPoints` of OpenCV 4.10 for integer
//! points, with the same `f32`/`f64` operation order (no fused multiply-add, as in the
//! SSE baseline build OpenCV ships).

/// `cv::RotatedRect`: centre, size (width, height) and angle in degrees.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RotatedRect {
    pub center: (f32, f32),
    pub size: (f32, f32),
    pub angle: f32,
}

fn sign_i64(value: i64) -> i32 {
    (value > 0) as i32 - (value < 0) as i32
}

/// Sklansky's scan over `array[start..=end]` (or backwards), as in OpenCV.
fn sklansky(array: &[(i32, i32)], start: isize, end: isize, stack: &mut [isize], nsign: i32, sign2: i32) -> usize {
    let incr: isize = if end > start { 1 } else { -1 };
    let mut pprev = start;
    let mut pcur = pprev + incr;
    let mut pnext = pcur + incr;
    let mut stacksize: usize = 3;
    let at = |i: isize| array[i as usize];
    if start == end || at(start) == at(end) {
        stack[0] = start;
        return 1;
    }
    stack[0] = pprev;
    stack[1] = pcur;
    stack[2] = pnext;
    let end = end + incr;
    while pnext != end {
        let cury = at(pcur).1;
        let nexty = at(pnext).1;
        let by = nexty - cury;
        if sign_i64(by as i64) != nsign {
            let ax = at(pcur).0 - at(pprev).0;
            let bx = at(pnext).0 - at(pcur).0;
            let ay = cury - at(pprev).1;
            let convexity = ay as i64 * bx as i64 - ax as i64 * by as i64;
            if sign_i64(convexity) == sign2 && (ax != 0 || ay != 0) {
                pprev = pcur;
                pcur = pnext;
                pnext += incr;
                stack[stacksize] = pnext;
                stacksize += 1;
            } else if pprev == start {
                pcur = pnext;
                stack[1] = pcur;
                pnext += incr;
                stack[2] = pnext;
            } else {
                stack[stacksize - 2] = pnext;
                pcur = pprev;
                pprev = stack[stacksize - 4];
                stacksize -= 1;
            }
        } else {
            pnext += incr;
            stack[stacksize - 1] = pnext;
        }
    }
    stacksize - 1
}

/// `cv::convexHull(points, clockwise=false, returnPoints=true)` for integer points.
pub fn convex_hull(points: &[(i32, i32)]) -> Vec<(i32, i32)> {
    let total = points.len();
    if total == 0 {
        return Vec::new();
    }
    // Sorted by x, then y, then original position (OpenCV compares pointers).
    let mut order: Vec<usize> = (0..total).collect();
    order.sort_by(|&a, &b| points[a].0.cmp(&points[b].0).then(points[a].1.cmp(&points[b].1)).then(a.cmp(&b)));
    let sorted: Vec<(i32, i32)> = order.iter().map(|&i| points[i]).collect();
    let (mut miny_ind, mut maxy_ind) = (0usize, 0usize);
    for i in 1..total {
        let y = sorted[i].1;
        if sorted[miny_ind].1 > y {
            miny_ind = i;
        }
        if sorted[maxy_ind].1 < y {
            maxy_ind = i;
        }
    }
    let mut stack = vec![0isize; total + 2];
    let mut hullbuf: Vec<usize> = Vec::with_capacity(total);
    if sorted[0] == sorted[total - 1] {
        hullbuf.push(order[0]);
    } else {
        let tl_count = sklansky(&sorted, 0, maxy_ind as isize, &mut stack, -1, 1);
        let tl_stack: Vec<isize> = stack[..tl_count].to_vec();
        let tr_count = sklansky(&sorted, total as isize - 1, maxy_ind as isize, &mut stack[tl_count..], -1, -1);
        let tr_stack: Vec<isize> = stack[tl_count..tl_count + tr_count].to_vec();
        // Counter-clockwise: the two halves are swapped.
        let (tl_stack, tl_count, tr_stack, tr_count) = (tr_stack, tr_count, tl_stack, tl_count);
        for &index in tl_stack.iter().take(tl_count.saturating_sub(1)) {
            hullbuf.push(order[index as usize]);
        }
        let mut i = tr_count as isize - 1;
        while i > 0 {
            hullbuf.push(order[tr_stack[i as usize] as usize]);
            i -= 1;
        }
        let stop_idx: isize = if tr_count > 2 {
            tr_stack[1]
        } else if tl_count > 2 {
            tl_stack[tl_count - 2]
        } else {
            -1
        };

        let mut bl_count = sklansky(&sorted, 0, miny_ind as isize, &mut stack, 1, -1);
        let bl_stack: Vec<isize> = stack[..bl_count].to_vec();
        let mut br_count = sklansky(&sorted, total as isize - 1, miny_ind as isize, &mut stack[bl_count..], 1, 1);
        let br_stack: Vec<isize> = stack[bl_count..bl_count + br_count].to_vec();
        if stop_idx >= 0 {
            let check_idx: isize = if bl_count > 2 {
                bl_stack[1]
            } else if bl_count + br_count > 2 {
                br_stack[2 - bl_count]
            } else {
                -1
            };
            if check_idx == stop_idx || (check_idx >= 0 && sorted[check_idx as usize] == sorted[stop_idx as usize]) {
                bl_count = bl_count.min(2);
                br_count = br_count.min(2);
            }
        }
        for &index in bl_stack.iter().take(bl_count.saturating_sub(1)) {
            hullbuf.push(order[index as usize]);
        }
        let mut i = br_count as isize - 1;
        while i > 0 {
            hullbuf.push(order[br_stack[i as usize] as usize]);
            i -= 1;
        }

        // OpenCV rotates the hull so that it starts at the lowest input index when the
        // indices are a rotated monotonic sequence.
        let nout = hullbuf.len();
        if nout >= 3 {
            let (mut min_idx, mut max_idx, mut lt) = (0usize, 0usize, 0usize);
            let mut i = 1;
            while i < nout {
                let idx = hullbuf[i];
                lt += usize::from(hullbuf[i - 1] < idx);
                if lt > 1 && lt + 2 <= i {
                    break;
                }
                if idx < hullbuf[min_idx] {
                    min_idx = i;
                }
                if idx > hullbuf[max_idx] {
                    max_idx = i;
                }
                i += 1;
            }
            let mmdist = max_idx.abs_diff(min_idx);
            if (mmdist == 1 || mmdist == nout - 1) && (lt <= 1 || lt + 2 >= nout) {
                let ascending = (max_idx + 1) % nout == min_idx;
                let i0 = if ascending { min_idx } else { max_idx };
                let mut j = i0;
                if i0 > 0 {
                    let mut rotated = vec![0usize; nout];
                    let mut i = 0;
                    while i < nout {
                        let curr_idx = hullbuf[j];
                        rotated[i] = curr_idx;
                        let next_j = if j + 1 < nout { j + 1 } else { 0 };
                        let next_idx = hullbuf[next_j];
                        if i < nout - 1 && (ascending != (curr_idx < next_idx)) {
                            break;
                        }
                        j = next_j;
                        i += 1;
                    }
                    if i == nout {
                        hullbuf = rotated;
                    }
                }
            }
        }
    }
    hullbuf.iter().map(|&i| points[i]).collect()
}

fn first_vec_is_right(v1: (f32, f32), v2: (f32, f32)) -> bool {
    // rotate90CW(v1) = (v1.y, -v1.x)
    let tmp = (v1.1, -v1.0);
    tmp.0 * v2.0 + tmp.1 * v2.1 < 0.0
}

/// Rotating calipers in CALIPERS_MINAREARECT mode: corner, and the two side vectors.
fn rotating_calipers(points: &[(f32, f32)]) -> [f32; 6] {
    let n = points.len();
    let mut minarea = f32::MAX;
    let mut vect = vec![(0f32, 0f32); n];
    let mut inv_len = vec![0f32; n];
    let (mut left, mut bottom, mut right, mut top) = (0usize, 0usize, 0usize, 0usize);
    let mut pt0 = points[0];
    let (mut left_x, mut right_x, mut top_y, mut bottom_y) = (pt0.0, pt0.0, pt0.1, pt0.1);
    for i in 0..n {
        if pt0.0 < left_x {
            left_x = pt0.0;
            left = i;
        }
        if pt0.0 > right_x {
            right_x = pt0.0;
            right = i;
        }
        if pt0.1 > top_y {
            top_y = pt0.1;
            top = i;
        }
        if pt0.1 < bottom_y {
            bottom_y = pt0.1;
            bottom = i;
        }
        let pt = points[if i + 1 < n { i + 1 } else { 0 }];
        let dx = (pt.0 - pt0.0) as f64;
        let dy = (pt.1 - pt0.1) as f64;
        vect[i] = (dx as f32, dy as f32);
        inv_len[i] = (1.0 / (dx * dx + dy * dy).sqrt()) as f32;
        pt0 = pt;
    }
    // OpenCV checks the hull's orientation here (an assertion only); the caliper base
    // vector is set from the first edge in the loop below.
    let (mut base_a, mut base_b);
    let mut seq = [bottom, right, top, left];
    let mut best = (0usize, 0f32, 0f32, 0f32, 0f32, 0usize);
    for _ in 0..n {
        let rot = [vect[seq[0]], (vect[seq[1]].1, -vect[seq[1]].0), (-vect[seq[2]].0, -vect[seq[2]].1), (-vect[seq[3]].1, vect[seq[3]].0)];
        let mut main_element = 0usize;
        for i in 1..4 {
            if first_vec_is_right(rot[i], rot[main_element]) {
                main_element = i;
            }
        }
        let pindex = seq[main_element];
        let lead_x = vect[pindex].0 * inv_len[pindex];
        let lead_y = vect[pindex].1 * inv_len[pindex];
        match main_element {
            0 => {
                base_a = lead_x;
                base_b = lead_y;
            }
            1 => {
                base_a = lead_y;
                base_b = -lead_x;
            }
            2 => {
                base_a = -lead_x;
                base_b = -lead_y;
            }
            _ => {
                base_a = -lead_y;
                base_b = lead_x;
            }
        }
        seq[main_element] += 1;
        if seq[main_element] == n {
            seq[main_element] = 0;
        }
        let dx = points[seq[1]].0 - points[seq[3]].0;
        let dy = points[seq[1]].1 - points[seq[3]].1;
        let width = dx * base_a + dy * base_b;
        let dx = points[seq[2]].0 - points[seq[0]].0;
        let dy = points[seq[2]].1 - points[seq[0]].1;
        let height = -dx * base_b + dy * base_a;
        let area = width * height;
        if area <= minarea {
            minarea = area;
            best = (seq[3], base_a, width, base_b, height, seq[0]);
        }
    }
    let (left_index, a1, width, b1, height, bottom_index) = best;
    let (a2, b2) = (-b1, a1);
    let c1 = a1 * points[left_index].0 + points[left_index].1 * b1;
    let c2 = a2 * points[bottom_index].0 + points[bottom_index].1 * b2;
    let idet = 1.0f32 / (a1 * b2 - a2 * b1);
    let px = (c1 * b2 - c2 * b1) * idet;
    let py = (a1 * c2 - a2 * c1) * idet;
    [px, py, a1 * width, b1 * width, a2 * height, b2 * height]
}

/// `cv::minAreaRect` of integer points.
pub fn min_area_rect(points: &[(i32, i32)]) -> RotatedRect {
    let hull: Vec<(f32, f32)> = convex_hull(points).into_iter().map(|(x, y)| (x as f32, y as f32)).collect();
    let n = hull.len();
    let mut rect = RotatedRect { center: (0.0, 0.0), size: (0.0, 0.0), angle: 0.0 };
    if n > 2 {
        let out = rotating_calipers(&hull);
        rect.center.0 = out[0] + (out[2] + out[4]) * 0.5;
        rect.center.1 = out[1] + (out[3] + out[5]) * 0.5;
        rect.size.0 = ((out[2] as f64) * out[2] as f64 + (out[3] as f64) * out[3] as f64).sqrt() as f32;
        rect.size.1 = ((out[4] as f64) * out[4] as f64 + (out[5] as f64) * out[5] as f64).sqrt() as f32;
        rect.angle = (out[3] as f64).atan2(out[2] as f64) as f32;
    } else if n == 2 {
        rect.center.0 = (hull[0].0 + hull[1].0) * 0.5;
        rect.center.1 = (hull[0].1 + hull[1].1) * 0.5;
        let dx = (hull[1].0 - hull[0].0) as f64;
        let dy = (hull[1].1 - hull[0].1) as f64;
        rect.size.0 = (dx * dx + dy * dy).sqrt() as f32;
        rect.size.1 = 0.0;
        rect.angle = dy.atan2(dx) as f32;
    } else if n == 1 {
        rect.center = hull[0];
    }
    rect.angle = ((rect.angle * 180.0) as f64 / std::f64::consts::PI) as f32;
    rect
}

/// `cv::boxPoints` (RotatedRect::points).
pub fn box_points(rect: &RotatedRect) -> [(f32, f32); 4] {
    let angle = rect.angle as f64 * std::f64::consts::PI / 180.0;
    let b = (angle.cos() as f32) * 0.5;
    let a = (angle.sin() as f32) * 0.5;
    let (cx, cy) = rect.center;
    let (w, h) = rect.size;
    let p0 = (cx - a * h - b * w, cy + b * h - a * w);
    let p1 = (cx + a * h - b * w, cy - b * h - a * w);
    let p2 = (2.0 * cx - p0.0, 2.0 * cy - p0.1);
    let p3 = (2.0 * cx - p1.0, 2.0 * cy - p1.1);
    [p0, p1, p2, p3]
}
