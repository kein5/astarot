//! The OpenCV, pyclipper and Shapely reimplementations against what the reference
//! libraries returned for the same random inputs (`reference/dump_cv_cases.py`).

mod common;

use common::{b64, fixture, fpoints, points, usize_of};
use astarot_ocr_runtime::cv::{self, contours, draw, geometry, warp, Interpolation};
use astarot_ocr_runtime::unclip;

#[test]
fn resize_matches_opencv() {
    let Some(data) = fixture("cv/resize.json") else { return };
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let (w, h, dw, dh, cn) = (usize_of(&case["w"]), usize_of(&case["h"]), usize_of(&case["dw"]), usize_of(&case["dh"]), usize_of(&case["cn"]));
        let interpolation = if case["interpolation"] == "area" { Interpolation::Area } else { Interpolation::Linear };
        let out = cv::resize(&b64(&case["src"]), w, h, cn, dw, dh, interpolation);
        let expected = b64(&case["dst"]);
        let differ = out.iter().zip(&expected).filter(|(a, b)| a != b).count();
        assert_eq!(differ, 0, "{interpolation:?} cn={cn} {w}x{h} -> {dw}x{dh}: {differ} of {} bytes differ", expected.len());
        checked += 1;
    }
    println!("METRIC resize: {checked} cases identical");
}

#[test]
fn contours_match_opencv() {
    let Some(data) = fixture("cv/contours.json") else { return };
    let mut total = 0;
    for (index, case) in data["cases"].as_array().unwrap().iter().enumerate() {
        let (w, h) = (usize_of(&case["w"]), usize_of(&case["h"]));
        let found = contours::find_contours_list_simple(&b64(&case["mask"]), w, h);
        let expected: Vec<Vec<(i32, i32)>> = case["contours"].as_array().unwrap().iter().map(points).collect();
        assert_eq!(found, expected, "case {index} ({w}x{h})");
        total += expected.len();
    }
    println!("METRIC contours: {total} contours identical, in the same order");
}

#[test]
fn hull_rect_and_box_points_match_opencv() {
    let Some(data) = fixture("cv/rect.json") else { return };
    let cases = data["cases"].as_array().unwrap();
    for (index, case) in cases.iter().enumerate() {
        let pts = points(&case["points"]);
        assert_eq!(geometry::convex_hull(&pts), points(&case["hull"]), "hull of case {index}");
        let rect = geometry::min_area_rect(&pts);
        let r: Vec<f32> = case["rect"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect();
        assert_eq!([rect.center.0, rect.center.1, rect.size.0, rect.size.1, rect.angle], [r[0], r[1], r[2], r[3], r[4]], "rect of case {index}");
        let corners = geometry::box_points(&rect).to_vec();
        assert_eq!(corners, fpoints(&case["box"]), "box points of case {index}");
    }
    println!("METRIC minAreaRect: {} cases identical (hull, rectangle, corners)", cases.len());
}

#[test]
fn fill_poly_matches_opencv() {
    let Some(data) = fixture("cv/fill.json") else { return };
    let cases = data["cases"].as_array().unwrap();
    for (index, case) in cases.iter().enumerate() {
        let (w, h) = (usize_of(&case["w"]), usize_of(&case["h"]));
        let mut mask = vec![0u8; w * h];
        draw::fill_poly(&mut mask, w, h, &points(&case["poly"]), 1);
        assert_eq!(mask, b64(&case["mask"]), "case {index}");
    }
    println!("METRIC fillPoly: {} cases identical", cases.len());
}

#[test]
fn warp_perspective_matches_opencv() {
    let Some(data) = fixture("cv/warp.json") else { return };
    let cases = data["cases"].as_array().unwrap();
    for (index, case) in cases.iter().enumerate() {
        let quad: Vec<(f32, f32)> = fpoints(&case["quad"]);
        let (w, h, dw, dh) = (usize_of(&case["w"]), usize_of(&case["h"]), usize_of(&case["dw"]), usize_of(&case["dh"]));
        let dst = [(0.0, 0.0), (dw as f32, 0.0), (dw as f32, dh as f32), (0.0, dh as f32)];
        let m = warp::perspective_transform(&[quad[0], quad[1], quad[2], quad[3]], &dst);
        let expected_m: Vec<f64> = case["m"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
        assert_eq!(m.to_vec(), expected_m, "transform of case {index}");
        let out = warp::warp_perspective_cubic_replicate(&b64(&case["src"]), w, h, 3, &m, dw, dh);
        let expected = b64(&case["dst"]);
        let differ = out.iter().zip(&expected).filter(|(a, b)| a != b).count();
        assert_eq!(differ, 0, "case {index}: {differ} of {} bytes differ", expected.len());
    }
    println!("METRIC warpPerspective: {} cases identical", cases.len());
}

#[test]
fn unclip_matches_shapely_and_pyclipper() {
    let Some(data) = fixture("cv/unclip.json") else { return };
    let cases = data["cases"].as_array().unwrap();
    for (index, case) in cases.iter().enumerate() {
        let quad = fpoints(&case["box"]);
        let pts: Vec<(f64, f64)> = quad.iter().map(|p| (p.0 as f64, p.1 as f64)).collect();
        assert_eq!(unclip::polygon_area(&pts), case["area"].as_f64().unwrap(), "area of case {index}");
        assert_eq!(unclip::polygon_length(&pts), case["length"].as_f64().unwrap(), "length of case {index}");
        let distance = case["distance"].as_f64().unwrap();
        let path: Vec<(i64, i64)> = quad.iter().map(|p| (p.0 as i64, p.1 as i64)).collect();
        let expanded = unclip::offset_round(&path, distance);
        let expected: Vec<Vec<(i64, i64)>> =
            case["expanded"].as_array().unwrap().iter().map(|poly| poly.as_array().unwrap().iter().map(|p| (p[0].as_i64().unwrap(), p[1].as_i64().unwrap())).collect()).collect();
        assert_eq!(expected.len(), 1, "case {index}: pyclipper returned {} polygons", expected.len());
        assert_eq!(expanded, expected[0], "offset of case {index}");
    }
    println!("METRIC unclip: {} cases identical (area, perimeter, offset polygon)", cases.len());
}
