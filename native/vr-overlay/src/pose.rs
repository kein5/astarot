//! Where windows go in the room: the laser's hit, windows that face the user, recalling the
//! log, the launcher's opening flight and the motions while a window is held.
//!
//! Poses are 4x4 world matrices whose rotation columns are the x, y and z axes. An overlay's
//! face is its +Z; a controller and the head look along their -Z.
use super::math::{self, Mat3, Mat34, Mat4, Vec3};

/// While held, the stick moves a window this fraction of its distance per second.
pub const PUSH_PULL_SPEED: f64 = 1.0;
/// The stick also reaches VRChat, so only a clear vertical push moves the window.
pub const PUSH_PULL_DEADZONE: f64 = 0.5;
pub const PUSH_PULL_DISTANCE_RANGE_M: (f64, f64) = (0.25, 2.5);
/// Hand travel (m) that doubles or halves a window while the trigger is held.
pub const SCALE_DOUBLING_M: f64 = 0.15;
/// Travel past which the pointer shows plus or minus.
pub const SCALE_ICON_THRESHOLD_M: f64 = 0.01;
pub const WIDTH_RANGE_M: (f64, f64) = (0.05, 3.0);
/// Smoothing of a held window, applied only while the hand moves slowly.
pub const GRAB_SMOOTH_TAU_SEC: f64 = 0.06;
pub const GRAB_SMOOTH_MAX_SPEED_M: f64 = 0.3;
/// The log counts as out of view past these (leaving, returning), so the launcher's button
/// does not flicker while the head sways at the border.
pub const RECALL_OUT_OF_VIEW_DEG: (f64, f64) = (60.0, 50.0);
pub const RECALL_OUT_OF_VIEW_DISTANCE_M: (f64, f64) = (3.0, 2.7);
pub const RECALL_DISTANCE_M: f64 = 0.7;
pub const RECALL_BELOW_EYE_M: f64 = 0.1;
/// Pitch range of a recalled log, up positive: looking down at the wrist still recalls it
/// into view.
pub const RECALL_PITCH_RANGE_DEG: (f64, f64) = (-45.0, 20.0);
/// Distance from the eyes of the launcher's opening position.
pub const INTRO_FRONT_DISTANCE_M: f64 = 0.7;
/// How far the laser points up from the controller tip.
pub const LASER_PITCH_UP_DEG: f64 = 12.0;

/// Rotation about the tip's x axis that points the laser `degrees` up (`laserTilt`).
pub fn laser_tilt(degrees: f64) -> Mat4 {
    let angle = degrees.to_radians();
    let mut tilt = math::IDENTITY;
    tilt[1][1] = angle.cos();
    tilt[1][2] = -angle.sin();
    tilt[2][1] = angle.sin();
    tilt[2][2] = angle.cos();
    tilt
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RayHit {
    /// Where the laser meets the plane, from the plane's centre (m, x right and y up).
    pub x: f64,
    pub y: f64,
    /// The same point in world space.
    pub point: Vec3,
    pub distance: f64,
}

/// The laser (the controller's -Z) against an overlay's plane (`rayPlaneHit`). Unlike SteamVR's
/// own test it also hits outside the overlay and on transparent corners, so corners can be
/// grabbed. `None` when the laser is parallel to the plane or points away.
pub fn ray_plane_hit(ray_pose: &Mat4, plane_pose: &Mat4) -> Option<RayHit> {
    let origin = math::translation(ray_pose);
    let direction = math::neg(math::axis(ray_pose, 2));
    let normal = math::axis(plane_pose, 2);
    let denom = math::dot(direction, normal);
    if denom.abs() < 1e-6 {
        return None;
    }
    let distance = math::dot(math::sub(math::translation(plane_pose), origin), normal) / denom;
    if distance <= 0.0 {
        return None;
    }
    let point = math::add(origin, math::scale(direction, distance));
    let local = math::transform_point(&math::inverse(plane_pose)?, point);
    Some(RayHit { x: local[0], y: local[1], point, distance })
}

fn normalized_or_self(v: Vec3) -> Vec3 {
    let length = math::norm(v);
    math::scale(v, 1.0 / if length == 0.0 { 1.0 } else { length })
}

/// A pose at `position` whose face (+Z) turns to `target`, with `up` as its up (the world's up
/// when `None`, so it does not tilt) (`popupPoseFacing`).
pub fn pose_facing(position: Vec3, target: Vec3, up: Option<Vec3>) -> Mat4 {
    let z = normalized_or_self(math::sub(target, position));
    let up = up.unwrap_or([0.0, 1.0, 0.0]);
    let mut x = math::cross(up, z);
    if math::norm(x) < 1e-6 {
        x = [1.0, 0.0, 0.0];
    }
    let x = math::scale(x, 1.0 / math::norm(x));
    let y = math::cross(z, x);
    let mut pose = math::IDENTITY;
    math::set_axis(&mut pose, 0, x);
    math::set_axis(&mut pose, 1, y);
    math::set_axis(&mut pose, 2, z);
    math::set_axis(&mut pose, 3, position);
    pose
}

/// At `position`, facing the head and upright for the person looking (`faceHead`).
pub fn face_head(position: Vec3, head: &Mat4) -> Mat4 {
    pose_facing(position, math::translation(head), Some(math::axis(head, 1)))
}

/// On the sphere of `radius` around the eyes, in the direction of `point`, facing the head
/// (`poseOnSphere`). A held window turns to the user rather than with the hand.
pub fn pose_on_sphere(point: Vec3, head: &Mat4, radius: f64) -> Mat4 {
    let head_pos = math::translation(head);
    let mut direction = math::sub(point, head_pos);
    let mut length = math::norm(direction);
    if length < 1e-6 {
        direction = math::neg(math::axis(head, 2));
        length = 1.0;
    }
    face_head(math::add(head_pos, math::scale(math::scale(direction, 1.0 / length), radius)), head)
}

/// The eye-to-window distance while held (`sphereRadius`). Reaching out or pulling in moves the
/// window by the same ratio. A window outside the range is not snapped into it on grab; it
/// only moves back towards the range.
pub fn sphere_radius(base: f64, hand_start: f64, hand_now: f64) -> f64 {
    let (low, high) = PUSH_PULL_DISTANCE_RANGE_M;
    (base * hand_now / hand_start.max(0.05)).max(low.min(base)).min(high.max(base))
}

/// Whether `position` is away from where the head looks, or too far (`isOutOfView`). With
/// `was_out` the inner thresholds decide when it comes back into view.
pub fn is_out_of_view(head: &Mat4, position: Vec3, was_out: bool) -> bool {
    let (degrees, limit) = if was_out {
        (RECALL_OUT_OF_VIEW_DEG.1, RECALL_OUT_OF_VIEW_DISTANCE_M.1)
    } else {
        (RECALL_OUT_OF_VIEW_DEG.0, RECALL_OUT_OF_VIEW_DISTANCE_M.0)
    };
    let direction = math::sub(position, math::translation(head));
    let distance = math::norm(direction);
    if distance > limit {
        return true;
    }
    if distance < 1e-6 {
        return false;
    }
    math::dot(math::scale(direction, 1.0 / distance), math::neg(math::axis(head, 2))) < degrees.to_radians().cos()
}

/// Ahead of the gaze, its pitch kept in `RECALL_PITCH_RANGE_DEG`, a little below the eyes and
/// facing the head (`recallPose`).
pub fn recall_pose(head: &Mat4) -> Mat4 {
    let head_pos = math::translation(head);
    let gaze = math::neg(math::axis(head, 2));
    let mut forward = gaze;
    forward[1] = 0.0;
    if math::norm(forward) < 1e-6 {
        // Looking straight up or down: the top of the head points forward.
        forward = math::axis(head, 1);
        forward[1] = 0.0;
    }
    let forward = normalized_or_self(forward);
    let (low, high) = RECALL_PITCH_RANGE_DEG;
    let pitch = gaze[1].clamp(-1.0, 1.0).asin().to_degrees().max(low).min(high).to_radians();
    let direction = math::add(math::scale(forward, pitch.cos()), [0.0, pitch.sin(), 0.0]);
    let position = math::sub(math::add(head_pos, math::scale(direction, RECALL_DISTANCE_M)), [0.0, RECALL_BELOW_EYE_M, 0.0]);
    face_head(position, head)
}

/// A rotation matrix as a unit quaternion (w, x, y, z).
pub fn quaternion_of(m: &Mat3) -> [f64; 4] {
    let trace = m[0][0] + m[1][1] + m[2][2];
    let q = if trace > 0.0 {
        let s = 2.0 * (trace + 1.0).sqrt();
        [0.25 * s, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s]
    } else {
        // The first largest diagonal entry, as NumPy's argmax picks it.
        let mut i = 0;
        for index in 1..3 {
            if m[index][index] > m[i][i] {
                i = index;
            }
        }
        let (j, k) = ((i + 1) % 3, (i + 2) % 3);
        let s = 2.0 * (m[i][i] - m[j][j] - m[k][k] + 1.0).sqrt();
        let mut q = [0.0; 4];
        q[0] = (m[k][j] - m[j][k]) / s;
        q[1 + i] = 0.25 * s;
        q[1 + j] = (m[j][i] + m[i][j]) / s;
        q[1 + k] = (m[k][i] + m[i][k]) / s;
        q
    };
    let length = q.iter().map(|v| v * v).sum::<f64>().sqrt();
    q.map(|v| v / length)
}

pub fn matrix_of(q: [f64; 4]) -> Mat3 {
    let [w, x, y, z] = q;
    [
        [1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - z * w), 2.0 * (x * z + y * w)],
        [2.0 * (x * y + z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - x * w)],
        [2.0 * (x * z - y * w), 2.0 * (y * z + x * w), 1.0 - 2.0 * (x * x + y * y)],
    ]
}

fn rotation(m: &Mat4) -> Mat3 {
    [[m[0][0], m[0][1], m[0][2]], [m[1][0], m[1][1], m[1][2]], [m[2][0], m[2][1], m[2][2]]]
}

/// Ahead of the gaze, pitch included, facing the head: where the launcher opens (`introFrontPose`).
pub fn intro_front_pose(head: &Mat4) -> Mat4 {
    let position = math::sub(math::translation(head), math::scale(math::axis(head, 2), INTRO_FRONT_DISTANCE_M));
    face_head(position, head)
}

/// `progress` (0 to 1) of the way from `front` to `target`: straight in position, slerp on the
/// shorter arc in rotation (`introFlightPose`). Blending matrices instead spins the launcher
/// at once when the two face nearly opposite ways.
pub fn intro_flight_pose(front: &Mat4, target: &Mat4, progress: f64) -> Mat4 {
    let a = quaternion_of(&rotation(front));
    let mut b = quaternion_of(&rotation(target));
    let mut dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    if dot < 0.0 {
        b = b.map(|v| -v);
        dot = -dot;
    }
    let q: [f64; 4] = if dot > 0.9995 {
        std::array::from_fn(|i| a[i] * (1.0 - progress) + b[i] * progress)
    } else {
        let theta = dot.acos();
        std::array::from_fn(|i| ((((1.0 - progress) * theta).sin() * a[i]) + ((progress * theta).sin() * b[i])) / theta.sin())
    };
    let length = q.iter().map(|v| v * v).sum::<f64>().sqrt();
    let r = matrix_of(q.map(|v| v / length));
    let mut pose = math::IDENTITY;
    for i in 0..3 {
        pose[i][..3].copy_from_slice(&r[i]);
        pose[i][3] = front[i][3] * (1.0 - progress) + target[i][3] * progress;
    }
    pose
}

/// The held window's distance after the stick's push (up, away) or pull (down)
/// (`pushPullDistance`). `stick` is the holding hand's (x, y); `None` when it is unknown. Only a
/// clearly vertical tilt counts, and outside the range the window only moves back towards it.
pub fn push_pull_distance(distance: f64, stick: Option<(f64, f64)>, dt: f64) -> f64 {
    let Some((x, y)) = stick else {
        return distance;
    };
    if y.abs() < PUSH_PULL_DEADZONE || y.abs() < 2.0 * x.abs() {
        return distance;
    }
    let (low, high) = PUSH_PULL_DISTANCE_RANGE_M;
    let moved = distance * (1.0 + y * PUSH_PULL_SPEED * dt);
    if y > 0.0 {
        moved.min(high.max(distance))
    } else {
        moved.max(low.min(distance))
    }
}

/// `hand_to_overlay` with its offset stretched by the stick (`pushPull`).
pub fn push_pull(hand_to_overlay: &Mat4, stick: Option<(f64, f64)>, dt: f64) -> Mat4 {
    let offset = math::translation(hand_to_overlay);
    let distance = math::norm(offset);
    if distance < 1e-6 {
        return *hand_to_overlay;
    }
    let mut result = *hand_to_overlay;
    math::set_axis(&mut result, 3, math::scale(math::scale(offset, 1.0 / distance), push_pull_distance(distance, stick, dt)));
    result
}

/// Whether the launcher's face (+Z) turns to the head within `face_deg` and sits within
/// `gaze_deg` of the gaze (`launcherLooksVisible`). Controllers differ in their axes, so the
/// launcher's own pose decides, not the hand's.
pub fn launcher_looks_visible(launcher: &Mat4, head: &Mat4, face_deg: f64, gaze_deg: f64) -> bool {
    let to_head = math::sub(math::translation(head), math::translation(launcher));
    let distance = math::norm(to_head);
    if distance < 1e-6 {
        return false;
    }
    let to_head = math::scale(to_head, 1.0 / distance);
    let face_cos = math::dot(math::axis(launcher, 2), to_head);
    let gaze_cos = math::dot(math::neg(math::axis(head, 2)), math::neg(to_head));
    face_cos >= face_deg.to_radians().cos() && gaze_cos >= gaze_deg.to_radians().cos()
}

/// The pointer's mark while scaling a held window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScaleIcon {
    Dot,
    Plus,
    Minus,
}

impl ScaleIcon {
    pub fn key(self) -> &'static str {
        match self {
            Self::Dot => "dot",
            Self::Plus => "plus",
            Self::Minus => "minus",
        }
    }
}

/// The width while the trigger is held on a held window: pushing the hand forward by
/// `SCALE_DOUBLING_M` doubles it (`updateGrabScale`). `pushed` is the hand's travel along its
/// forward at the start.
pub fn grab_scale(start_width: f64, pushed: f64) -> (f64, ScaleIcon) {
    let (low, high) = WIDTH_RANGE_M;
    let width = (start_width * 2f64.powf(pushed / SCALE_DOUBLING_M)).max(low).min(high);
    let icon = if pushed > SCALE_ICON_THRESHOLD_M {
        ScaleIcon::Plus
    } else if pushed < -SCALE_ICON_THRESHOLD_M {
        ScaleIcon::Minus
    } else {
        ScaleIcon::Dot
    };
    (width, icon)
}

/// Steadies a held window while the hand moves slowly, and follows at once when it moves
/// fast (`smoothGrab`). Works in the tracker's space, so a window on a hand does not lag.
#[derive(Clone, Debug, Default)]
pub struct GrabSmoother {
    smoothed: Option<Mat34>,
    previous_target: Option<Mat34>,
}

impl GrabSmoother {
    pub fn step(&mut self, target: &Mat34, dt: f64) -> Mat34 {
        let previous = self.smoothed;
        let previous_target = self.previous_target.replace(*target);
        let (Some(previous), Some(previous_target)) = (previous, previous_target) else {
            self.smoothed = Some(*target);
            return *target;
        };
        if dt <= 0.0 {
            self.smoothed = Some(*target);
            return *target;
        }
        // The speed is the hand's own motion; the smoothed position lags.
        let column = |m: &Mat34| [m[0][3], m[1][3], m[2][3]];
        let speed = math::norm(math::sub(column(target), column(&previous_target))) / dt;
        let alpha = if speed >= GRAB_SMOOTH_MAX_SPEED_M { 1.0 } else { 1.0 - (-dt / GRAB_SMOOTH_TAU_SEC).exp() };
        let mut smoothed = *target;
        for row in 0..3 {
            smoothed[row][3] = previous[row][3] + (target[row][3] - previous[row][3]) * alpha;
        }
        self.smoothed = Some(smoothed);
        smoothed
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head_at(position: Vec3) -> Mat4 {
        let mut head = math::IDENTITY;
        math::set_axis(&mut head, 3, position);
        head
    }

    #[test]
    fn laser_hits_a_plane_in_front_only() {
        let ray = math::IDENTITY;
        let mut plane = math::IDENTITY;
        plane[2][3] = -2.0;
        plane[0][3] = 0.5;
        let hit = ray_plane_hit(&ray, &plane).unwrap();
        assert!((hit.distance - 2.0).abs() < 1e-12 && (hit.x + 0.5).abs() < 1e-12);
        plane[2][3] = 2.0;
        assert!(ray_plane_hit(&ray, &plane).is_none());
    }

    #[test]
    fn a_window_faces_the_head() {
        let head = head_at([0.0, 1.6, 0.0]);
        let pose = recall_pose(&head);
        let to_head = math::sub(math::translation(&head), math::translation(&pose));
        assert!(math::dot(math::axis(&pose, 2), to_head) > 0.0);
        assert!(!is_out_of_view(&head, math::translation(&pose), false));
    }

    #[test]
    fn out_of_view_uses_hysteresis() {
        let head = head_at([0.0, 0.0, 0.0]);
        // 55 degrees off the gaze: in view when it was in view, out when it was out.
        let angle = 55f64.to_radians();
        let position = [angle.sin(), 0.0, -angle.cos()];
        assert!(!is_out_of_view(&head, position, false));
        assert!(is_out_of_view(&head, position, true));
    }

    #[test]
    fn flight_ends_at_the_target() {
        let front = intro_front_pose(&head_at([0.0, 1.6, 0.0]));
        let target = face_head([0.3, 1.0, -0.2], &head_at([0.0, 1.6, 0.0]));
        let end = intro_flight_pose(&front, &target, 1.0);
        for i in 0..3 {
            for j in 0..4 {
                assert!((end[i][j] - target[i][j]).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn stick_moves_only_on_a_clear_vertical_push() {
        assert_eq!(push_pull_distance(1.0, Some((0.4, 0.6)), 0.1), 1.0);
        assert!(push_pull_distance(1.0, Some((0.0, 1.0)), 0.1) > 1.0);
        assert_eq!(push_pull_distance(3.0, Some((0.0, 1.0)), 0.1), 3.0);
        assert_eq!(push_pull_distance(1.0, None, 0.1), 1.0);
    }

    #[test]
    fn smoothing_follows_fast_motion() {
        let mut smoother = GrabSmoother::default();
        let mut target = math::to_mat34(&math::IDENTITY);
        smoother.step(&target, 0.016);
        target[0][3] = 0.1; // 6 m/s
        assert_eq!(smoother.step(&target, 0.016)[0][3], 0.1);
        target[0][3] = 0.1001;
        assert!(smoother.step(&target, 0.016)[0][3] < 0.1001);
    }
}
