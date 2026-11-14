//! Replays what the Python overlay computed (`tests/vr_overlay_reference/reference.json`,
//! written by `dump_reference.py`) through the Rust port. Floats agree within 1e-9; integers,
//! booleans and the order of effects agree exactly.
use serde_json::Value;

use super::layout::{self, Region, VrLayout};
use super::math::{self, Mat3, Mat34, Mat4, Tracker, Vec3};
use super::placement::{self, Placement};
use super::pose;
use super::timing::{self, Launcher, LauncherTick, LauncherView, Toolbar, ToolbarEffect};
use super::tooltip::{self, Picture, TooltipMode, TooltipParent};

const TOLERANCE: f64 = 1e-9;

fn reference() -> Value {
    serde_json::from_str(include_str!("../../tests/vr_overlay_reference/reference.json")).unwrap()
}

fn cases<'a>(value: &'a Value, path: &[&str]) -> &'a Vec<Value> {
    let mut node = value;
    for key in path {
        node = &node[*key];
    }
    let list = node.as_array().unwrap_or_else(|| panic!("{path:?} is not a list"));
    assert!(!list.is_empty(), "{path:?} is empty");
    list
}

fn f(value: &Value) -> f64 {
    value.as_f64().unwrap_or_else(|| panic!("{value} is not a number"))
}

fn u(value: &Value) -> u32 {
    value.as_u64().unwrap() as u32
}

fn i(value: &Value) -> i64 {
    value.as_i64().unwrap()
}

fn vec3(value: &Value) -> Vec3 {
    [f(&value[0]), f(&value[1]), f(&value[2])]
}

fn rows<const R: usize, const C: usize>(value: &Value) -> [[f64; C]; R] {
    std::array::from_fn(|r| std::array::from_fn(|c| f(&value[r][c])))
}

fn mat4(value: &Value) -> Mat4 {
    rows::<4, 4>(value)
}

fn mat34(value: &Value) -> Mat34 {
    rows::<3, 4>(value)
}

fn mat3(value: &Value) -> Mat3 {
    rows::<3, 3>(value)
}

fn close(actual: f64, expected: f64, what: &str) {
    assert!((actual - expected).abs() <= TOLERANCE, "{what}: {actual} != {expected}");
}

fn close_all<'a>(actual: impl IntoIterator<Item = &'a f64>, expected: impl IntoIterator<Item = f64>, what: &str) {
    for (a, e) in actual.into_iter().zip(expected) {
        close(*a, e, what);
    }
}

fn flat(value: &Value) -> Vec<f64> {
    match value {
        Value::Array(items) => items.iter().flat_map(flat).collect(),
        other => vec![f(other)],
    }
}

fn close_matrix<const R: usize, const C: usize>(actual: &[[f64; C]; R], expected: &Value, what: &str) {
    let expected = flat(expected);
    assert_eq!(expected.len(), R * C, "{what}: shape");
    close_all(actual.iter().flatten(), expected, what);
}

fn region(value: &Value) -> Region {
    Region::from_key(value.as_str().unwrap()).unwrap()
}

fn panel_layout(case: &Value) -> VrLayout {
    VrLayout::for_panel(u(&case["panel"][0]), u(&case["panel"][1]))
}

#[test]
fn layouts_match_python() {
    let data = reference();
    for case in cases(&data, &["layout", "layouts"]) {
        let layout = panel_layout(case);
        let expected = &case["layout"];
        assert_eq!(serde_json::json!([layout.atlas.0, layout.atlas.1]), expected["atlas"]);
        for region in Region::ALL {
            let (x, y, w, h) = layout.region(region);
            assert_eq!(serde_json::json!([x, y, w, h]), expected["regions"][region.key()], "{case}");
        }
    }
    for case in cases(&data, &["layout", "clamp_panel_size"]) {
        let (w, h) = layout::clamp_panel_size(f(&case[0]), f(&case[1]));
        assert_eq!(serde_json::json!([w, h]), case[2], "{case}");
    }
    for case in cases(&data, &["layout", "region_rect"]) {
        let (x0, y0, x1, y1) = panel_layout(case).region_rect(region(&case["region"]), u(&case["image_width"]));
        assert_eq!(serde_json::json!([x0, y0, x1, y1]), case["rect"], "{case}");
    }
    for case in cases(&data, &["layout", "region_bounds"]) {
        let (a, b, c, d) = panel_layout(case).region_bounds(region(&case["region"]));
        close_all(&[a, b, c, d], flat(&case["bounds"]), "region_bounds");
    }
    for case in cases(&data, &["layout", "uv_to_pixel"]) {
        let (x, y) = layout::uv_to_pixel(f(&case[0]), f(&case[1]), u(&case[2]), u(&case[3]));
        assert_eq!(serde_json::json!([x, y]), case[4], "{case}");
    }
}

#[test]
fn matrices_match_python() {
    let data = reference();
    for case in cases(&data, &["math", "euler"]) {
        close_matrix(&math::euler_to_rotation_matrix(vec3(&case["angles"])), &case["matrix"], "euler");
    }
    for name in ["HMD", "LeftHand", "RightHand"] {
        close_matrix(&Tracker::from_setting(name).base(), &data["math"]["bases"][name], name);
    }
    for case in cases(&data, &["math", "transform"]) {
        let position: [f64; 6] = std::array::from_fn(|index| f(&case["position"][index]));
        let tracker = Tracker::from_setting(case["tracker"].as_str().unwrap());
        close_matrix(&math::relative_pose(tracker, position), &case["relative"], "transform");
    }
    for case in cases(&data, &["math", "matrix_to_position"]) {
        let tracker = Tracker::from_setting(case["tracker"].as_str().unwrap());
        let position = math::matrix_to_position(&tracker.base(), &mat34(&case["relative"])).unwrap();
        close_all(&position, flat(&case["position"]), "matrix_to_position");
    }
}

#[test]
fn poses_match_python() {
    let data = reference();
    for case in cases(&data, &["pose", "ray_plane_hit"]) {
        let hit = pose::ray_plane_hit(&mat4(&case["ray"]), &mat4(&case["plane"]));
        match (&hit, &case["hit"]) {
            (None, Value::Null) => {}
            (Some(hit), expected @ Value::Object(_)) => {
                close(hit.x, f(&expected["x"]), "hit x");
                close(hit.y, f(&expected["y"]), "hit y");
                close(hit.distance, f(&expected["distance"]), "hit distance");
                close_all(&hit.point, flat(&expected["point"]), "hit point");
            }
            _ => panic!("ray_plane_hit: {hit:?} against {}", case["hit"]),
        }
    }
    for case in cases(&data, &["pose", "laser_tilt"]) {
        close_matrix(&pose::laser_tilt(f(&case["degrees"])), &case["matrix"], "laser_tilt");
    }
    for case in cases(&data, &["pose", "pose_facing"]) {
        let up = (!case["up"].is_null()).then(|| vec3(&case["up"]));
        let facing = pose::pose_facing(vec3(&case["position"]), vec3(&case["target"]), up);
        close_matrix(&facing, &case["pose"], "pose_facing");
    }
    for case in cases(&data, &["pose", "pose_on_sphere"]) {
        let sphere = pose::pose_on_sphere(vec3(&case["point"]), &mat4(&case["head"]), f(&case["radius"]));
        close_matrix(&sphere, &case["pose"], "pose_on_sphere");
    }
    for case in cases(&data, &["pose", "sphere_radius"]) {
        close(pose::sphere_radius(f(&case[0]), f(&case[1]), f(&case[2])), f(&case[3]), "sphere_radius");
    }
    for case in cases(&data, &["pose", "is_out_of_view"]) {
        let out = pose::is_out_of_view(&mat4(&case["head"]), vec3(&case["position"]), case["was_out"].as_bool().unwrap());
        assert_eq!(out, case["out"].as_bool().unwrap(), "is_out_of_view");
    }
    for case in cases(&data, &["pose", "recall_pose"]) {
        close_matrix(&pose::recall_pose(&mat4(&case["head"])), &case["pose"], "recall_pose");
    }
    for case in cases(&data, &["pose", "quaternion"]) {
        let q = pose::quaternion_of(&mat3(&case["matrix"]));
        close_all(&q, flat(&case["quaternion"]), "quaternion");
        close_matrix(&pose::matrix_of(q), &case["back"], "matrix_of");
    }
    for case in cases(&data, &["pose", "intro_front_pose"]) {
        close_matrix(&pose::intro_front_pose(&mat4(&case["head"])), &case["pose"], "intro_front_pose");
    }
    for case in cases(&data, &["pose", "intro_flight_pose"]) {
        let flight = pose::intro_flight_pose(&mat4(&case["front"]), &mat4(&case["target"]), f(&case["progress"]));
        close_matrix(&flight, &case["pose"], "intro_flight_pose");
    }
    let stick = |value: &Value| (!value.is_null()).then(|| (f(&value[0]), f(&value[1])));
    for case in cases(&data, &["pose", "push_pull_distance"]) {
        let distance = pose::push_pull_distance(f(&case["distance"]), stick(&case["stick"]), f(&case["dt"]));
        close(distance, f(&case["result"]), "push_pull_distance");
    }
    for case in cases(&data, &["pose", "push_pull"]) {
        let moved = pose::push_pull(&mat4(&case["pose"]), stick(&case["stick"]), f(&case["dt"]));
        close_matrix(&moved, &case["result"], "push_pull");
    }
    for case in cases(&data, &["pose", "launcher_looks_visible"]) {
        let visible = pose::launcher_looks_visible(
            &mat4(&case["launcher"]),
            &mat4(&case["head"]),
            f(&case["face_deg"]),
            f(&case["gaze_deg"]),
        );
        assert_eq!(visible, case["visible"].as_bool().unwrap(), "launcher_looks_visible");
    }
}

fn placement_of(settings: &Value) -> Placement {
    let number = |key: &str| settings.get(key).map_or(0.0, f);
    Placement {
        x_pos: number("x_pos"),
        y_pos: number("y_pos"),
        z_pos: number("z_pos"),
        x_rotation: number("x_rotation"),
        y_rotation: number("y_rotation"),
        z_rotation: number("z_rotation"),
        ui_scaling: number("ui_scaling"),
        tracker: Tracker::from_setting(settings.get("tracker").and_then(Value::as_str).unwrap_or("LeftHand")),
    }
}

#[test]
fn placements_match_python() {
    let data = reference();
    for case in cases(&data, &["placement", "launcher_reach"]) {
        let launcher = placement_of(&case["settings"]);
        assert_eq!(placement::launcher_out_of_reach(&launcher), case["out_of_reach"].as_bool().unwrap(), "{case}");
        let near = placement::launcher_nearest_in_reach(&launcher);
        let expected = &case["nearest"];
        // Rounded to 0.1 mm as Python rounds; equal to the last digit.
        assert_eq!((near.x_pos, near.y_pos, near.z_pos), (f(&expected["x_pos"]), f(&expected["y_pos"]), f(&expected["z_pos"])));
        close(near.ui_scaling, f(&expected["ui_scaling"]), "ui_scaling");
    }
    for case in cases(&data, &["placement", "mirror_hand_position"]) {
        let mirrored = placement::mirror_hand_position(&placement_of(&case["position"]));
        let expected = placement_of(&case["mirrored"]);
        assert_eq!(mirrored.tracker.name(), case["mirrored"]["tracker"].as_str().unwrap());
        close_all(&mirrored.position(), expected.position(), "mirror_hand_position");
    }
}

#[test]
fn regions_match_python() {
    let data = reference();
    for case in cases(&data, &["region", "region_width_m"]) {
        let width = layout::region_width_m(region(&case["region"]), f(&case["ui_scaling"]));
        close(width, f(&case["width_m"]), "region_width_m");
    }
    for case in cases(&data, &["region", "region_pixel"]) {
        let pixel = layout::region_pixel(
            &panel_layout(case),
            region(&case["region"]),
            f(&case["ui_scaling"]),
            u(&case["image_width"]),
            &mat4(&case["pose"]),
            vec3(&case["point"]),
        )
        .unwrap();
        assert_eq!(serde_json::json!([pixel.0, pixel.1]), case["pixel"], "{case}");
    }
    for case in cases(&data, &["region", "toolbar_relative"]) {
        let relative = layout::toolbar_relative(&panel_layout(case), &mat34(&case["panel_relative"]), f(&case["panel_ui_scaling"]));
        close_matrix(&relative, &case["toolbar_relative"], "toolbar_relative");
    }
}

#[test]
fn fades_match_python() {
    let data = reference();
    for case in cases(&data, &["fade"]) {
        let ratio = timing::fade_ratio(f(&case["now"]), 100.0, f(&case["display"]), f(&case["fadeout"]));
        close(ratio, f(&case["ratio"]), "fade ratio");
        close(ratio * f(&case["opacity"]), f(&case["alpha"]), "fade alpha");
        assert_eq!(timing::subtitle_visible(f(&case["fadeout"]), ratio), case["visible"].as_bool().unwrap());
    }
}

/// The Python overlay's calls for one toolbar effect.
fn toolbar_calls(effect: &ToolbarEffect) -> Vec<Value> {
    use serde_json::json;
    match effect {
        ToolbarEffect::Show(alpha) => vec![json!(["setOverlayAlpha", alpha]), json!(["showOverlay"])],
        ToolbarEffect::Alpha(alpha) => vec![json!(["setOverlayAlpha", alpha])],
        ToolbarEffect::Hide => vec![json!(["hideOverlay"])],
        ToolbarEffect::ResetTooltip => vec![json!(["resetTooltipEpoch"])],
    }
}

#[test]
fn toolbar_matches_python() {
    let data = reference();
    let mut bar = Toolbar::default();
    for step in cases(&data, &["toolbar"]) {
        let now = f(&step["now"]);
        let mut effects = bar.update(now, step["pointing"].as_bool().unwrap(), step["log_shown"].as_bool().unwrap(), true);
        effects.extend(bar.fade(now));
        let calls: Vec<Value> = effects.iter().flat_map(toolbar_calls).collect();
        let expected = step["calls"].as_array().unwrap();
        assert_eq!(calls.len(), expected.len(), "at {now}: {calls:?} against {expected:?}");
        for (call, expected) in calls.iter().zip(expected) {
            assert_eq!(call[0], expected[0], "at {now}");
            if let Some(alpha) = expected.get(1) {
                close(f(&call[1]), f(alpha), "toolbar alpha");
            }
        }
        assert_eq!(bar.visible, step["visible"].as_bool().unwrap(), "at {now}");
        close(bar.alpha, f(&step["alpha"]), "toolbar alpha");
    }
}

#[test]
fn launcher_matches_python() {
    let data = reference();
    for run in cases(&data, &["launcher"]) {
        let mut launcher = Launcher::new(run["auto_hide"].as_bool().unwrap());
        launcher.start(true);
        for step in cases(run, &["steps"]) {
            let forced = step["forced"].as_bool().unwrap();
            let tick = LauncherTick {
                now: f(&step["now"]),
                view: LauncherView { within_show: step["within_show"].as_bool(), within_hide: step["within_hide"].as_bool() },
                held: step["held"].as_bool().unwrap(),
                forced,
                idle: !forced,
            };
            let reset = launcher.update(tick);
            assert_eq!(launcher.shown, step["shown"].as_bool().unwrap(), "{step}");
            assert_eq!(launcher.interactive, step["interactive"].as_bool().unwrap(), "{step}");
            assert_eq!(reset, step["reset_tooltip"].as_bool().unwrap(), "{step}");
            close(launcher.alpha, f(&step["alpha"]), "launcher alpha");
        }
    }
}

#[test]
fn tooltips_match_python() {
    let data = reference();
    for case in cases(&data, &["tooltip", "validation"]) {
        let result = tooltip::validate_tooltip(&case["payload"]);
        match (&result, &case["error"]) {
            (Err(error), Value::String(expected)) => assert_eq!(error, expected, "{case}"),
            (Ok(tooltip), Value::Null) => {
                let expected = &case["result"];
                assert_eq!(tooltip.epoch, expected["epoch"].as_u64().unwrap());
                assert_eq!(tooltip.revision, expected["revision"].as_u64().unwrap());
                assert_eq!(tooltip.shown.is_some(), expected["visible"].as_bool().unwrap());
                if let Some(shape) = tooltip.shown {
                    let parent = match shape.region {
                        TooltipParent::Launcher => "launcher",
                        TooltipParent::Toolbar => "toolbar",
                    };
                    let mode = match shape.mode {
                        TooltipMode::Hover => "hover",
                        TooltipMode::Focus => "focus",
                    };
                    assert_eq!((parent, mode), (expected["region"].as_str().unwrap(), expected["mode"].as_str().unwrap()));
                    close_all(&shape.button, flat(&expected["button"]), "button");
                    close_all(&shape.size, flat(&expected["size"]), "size");
                    close(shape.arrow_x, f(&expected["arrow_x"]), "arrow_x");
                }
            }
            _ => panic!("validate_tooltip: {result:?} against {case}"),
        }
    }
    let layout = VrLayout::default_layout();
    for case in cases(&data, &["tooltip", "marker"]) {
        let (width, height) = (u(&case["width"]), u(&case["height"]));
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        for cell in case["white"].as_array().unwrap() {
            let start = ((i(&cell[1]) as usize) * width as usize + i(&cell[0]) as usize) * 4;
            pixels[start..start + 3].fill(255);
        }
        let picture = Picture { pixels: &pixels, width, height, channels: 4 };
        let request = tooltip::Tooltip {
            epoch: case["epoch"].as_u64().unwrap(),
            revision: case["revision"].as_u64().unwrap(),
            shown: None,
        };
        assert_eq!(tooltip::marker_matches(&picture, &layout, &request), case["matches"].as_bool().unwrap());
    }
}
