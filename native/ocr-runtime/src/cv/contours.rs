//! `cv::findContours(image, RETR_LIST, CHAIN_APPROX_SIMPLE)` of OpenCV 4.10.
//!
//! OpenCV 4.10 traces borders with its rewritten scanner (`contours_new.cpp`, Suzuki and
//! Abe's border following). For `RETR_LIST` every contour is a child of the root, each
//! new one is put in front of the list, and the result is read back from the front: the
//! contours come out in reverse order of discovery. Points are reported where the chain
//! changes direction (`CHAIN_APPROX_SIMPLE`).

/// A contour point, in image coordinates.
pub type Point = (i32, i32);

const CHAIN: [(i32, i32); 8] = [(1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1)];
const MASK8_RIGHT: i8 = -128; // 0x80
const MASK8_NEW: i8 = 2;
const MASK8_BLACK: i8 = 1;

/// Contours of the non-zero pixels of a `width`×`height` 8-bit map.
pub fn find_contours_list_simple(mask: &[u8], width: usize, height: usize) -> Vec<Vec<Point>> {
    assert_eq!(mask.len(), width * height);
    // copyMakeBorder by one pixel, then threshold(0, 1): every non-zero pixel becomes 1.
    let w = width + 2;
    let h = height + 2;
    let mut image = vec![0i8; w * h];
    for y in 0..height {
        for x in 0..width {
            if mask[y * width + x] != 0 {
                image[(y + 1) * w + x + 1] = 1;
            }
        }
    }
    let step = w as isize;
    let delta = |s: i8| -> isize {
        let (dx, dy) = CHAIN[(s as usize) % 8];
        dx as isize + dy as isize * step
    };
    let offset = (-1i32, -1i32);
    let mut found: Vec<Vec<Point>> = Vec::new();

    let width_limit = w - 1;
    let height_limit = h - 1;
    for y in 1..height_limit {
        let mut prev: i32 = 0;
        let mut x = 1usize;
        while x < width_limit {
            // findNextX: the next pixel that differs from `prev`.
            let mut p: i32 = image[y * w + x] as i32;
            while x < width_limit && p == prev {
                x += 1;
                if x < width_limit {
                    p = image[y * w + x] as i32;
                }
            }
            if x >= width_limit {
                break;
            }
            // contourScan
            let mut is_hole = false;
            let mut start = false;
            if prev == 0 && p == 1 {
                start = true;
            } else if p == 0 && prev >= 1 {
                is_hole = true;
                start = true;
            }
            if start {
                let start_x = x - usize::from(is_hole);
                let origin = (start_x as i32 + offset.0, y as i32 + offset.1);
                let pts = fetch_contour(&mut image, start_x + y * w, origin, is_hole, &delta);
                found.push(pts);
                // The scan resumes right after the start pixel, with prev read again.
                x += 1;
                prev = image[y * w + x - 1] as i32;
                continue;
            }
            prev = p;
            x += 1;
        }
    }
    found.reverse();
    found
}

/// icvFetchContourEx for 8-bit images in a "simple" mode (RETR_LIST), nbd = MASK8_NEW.
fn fetch_contour(image: &mut [i8], start: usize, origin: Point, is_hole: bool, delta: &dyn Fn(i8) -> isize) -> Vec<Point> {
    let nbd = MASK8_NEW;
    let mut pts = Vec::new();
    let i0 = start as isize;
    let mut s_end: i8 = if is_hole { 0 } else { 4 };
    let mut s = s_end;
    let mut i1;
    loop {
        s = (s - 1) & 7;
        i1 = i0 + delta(s);
        if image[i1 as usize] != 0 || s == s_end {
            break;
        }
    }
    if s == s_end {
        image[i0 as usize] = nbd | MASK8_RIGHT;
        pts.push(origin);
        return pts;
    }
    let mut i3 = i0;
    let mut prev_s = s ^ 4;
    let mut pt = origin;
    loop {
        s_end = s;
        s = s.min(15);
        let mut i4 = i3;
        while s < 15 {
            s += 1;
            i4 = i3 + delta(s);
            if image[i4 as usize] != 0 {
                break;
            }
        }
        s &= 7;
        // "right" bound
        if ((s as i32 - 1) as u32) < (s_end as i32) as u32 {
            image[i3 as usize] = nbd | MASK8_RIGHT;
        } else if image[i3 as usize] == MASK8_BLACK {
            image[i3 as usize] = nbd;
        }
        if s != prev_s {
            pts.push(pt);
        }
        prev_s = s;
        pt.0 += CHAIN[s as usize].0;
        pt.1 += CHAIN[s as usize].1;
        if i4 == i0 && i3 == i1 {
            break;
        }
        i3 = i4;
        s = (s + 4) & 7;
    }
    pts
}
