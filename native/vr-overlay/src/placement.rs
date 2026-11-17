//! Limits on where the launcher may be left, and moving a wrist window to the other hand.
use super::layout::round4;
use super::math::{self, Tracker};

/// How far from its wrist base the launcher may be left (m).
pub const LAUNCHER_REACH_M: f64 = 0.15;
/// The launcher's stored width (`ui_scaling`) may be in this range.
pub const LAUNCHER_WIDTH_RANGE_M: (f64, f64) = (0.12, 1.0);

/// A stored overlay position: the offset from its tracker's base, rotations in degrees.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placement {
    pub x_pos: f64,
    pub y_pos: f64,
    pub z_pos: f64,
    pub x_rotation: f64,
    pub y_rotation: f64,
    pub z_rotation: f64,
    pub ui_scaling: f64,
    pub tracker: Tracker,
}

impl Placement {
    pub fn position(&self) -> [f64; 6] {
        [self.x_pos, self.y_pos, self.z_pos, self.x_rotation, self.y_rotation, self.z_rotation]
    }

    fn offset_m(&self) -> f64 {
        math::norm([self.x_pos, self.y_pos, self.z_pos])
    }
}

/// Whether the launcher is too far from the wrist, or too small or large, to be found again
/// (`launcherOutOfReach`).
pub fn launcher_out_of_reach(launcher: &Placement) -> bool {
    let (low, high) = LAUNCHER_WIDTH_RANGE_M;
    !(launcher.offset_m() <= LAUNCHER_REACH_M && low <= launcher.ui_scaling && launcher.ui_scaling <= high)
}

/// The launcher pulled back along its own direction onto the reach limit, and its width kept
/// in range (`launcherNearestInReach`). Rotations and the hand stay; positions round to 0.1 mm.
pub fn launcher_nearest_in_reach(launcher: &Placement) -> Placement {
    let distance = launcher.offset_m();
    let shrink = if distance > LAUNCHER_REACH_M { LAUNCHER_REACH_M / distance } else { 1.0 };
    let (low, high) = LAUNCHER_WIDTH_RANGE_M;
    Placement {
        x_pos: round4(launcher.x_pos * shrink),
        y_pos: round4(launcher.y_pos * shrink),
        z_pos: round4(launcher.z_pos * shrink),
        ui_scaling: launcher.ui_scaling.max(low).min(high),
        ..*launcher
    }
}

/// A wrist window's position for the other hand (`mirrorHandPosition`). The two hand bases
/// mirror each other in x, so x and the rotations about y and z change sign. Anything that is
/// not the left hand moves to the left hand, as the Python overlay does.
pub fn mirror_hand_position(placement: &Placement) -> Placement {
    Placement {
        x_pos: -placement.x_pos,
        y_rotation: -placement.y_rotation,
        z_rotation: -placement.z_rotation,
        tracker: if placement.tracker == Tracker::LeftHand { Tracker::RightHand } else { Tracker::LeftHand },
        ..*placement
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launcher(x: f64, ui_scaling: f64) -> Placement {
        Placement {
            x_pos: x,
            y_pos: 0.0,
            z_pos: 0.0,
            x_rotation: 1.0,
            y_rotation: 2.0,
            z_rotation: 3.0,
            ui_scaling,
            tracker: Tracker::LeftHand,
        }
    }

    #[test]
    fn launcher_is_pulled_back_within_reach() {
        let far = launcher(0.3, 2.0);
        assert!(launcher_out_of_reach(&far));
        let near = launcher_nearest_in_reach(&far);
        assert_eq!((near.x_pos, near.ui_scaling, near.x_rotation), (0.15, 1.0, 1.0));
        assert!(!launcher_out_of_reach(&near));
    }

    #[test]
    fn mirroring_twice_returns_the_position() {
        let left = launcher(0.05, 0.3);
        let right = mirror_hand_position(&left);
        assert_eq!(right.tracker, Tracker::RightHand);
        assert_eq!(mirror_hand_position(&right), left);
    }

    #[test]
    fn mirrored_wrist_windows_sit_at_the_mirrored_place() {
        let left = launcher(0.05, 0.3);
        let right = mirror_hand_position(&left);
        let a = math::relative_pose(left.tracker, left.position());
        let b = math::relative_pose(right.tracker, right.position());
        assert!((a[0][3] + b[0][3]).abs() < 1e-12 && (a[1][3] - b[1][3]).abs() < 1e-12);
    }
}
