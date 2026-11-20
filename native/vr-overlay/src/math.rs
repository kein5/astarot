//! Small fixed-size linear algebra for overlay poses.
//!
//! SteamVR hands poses as 3x4 matrices (rotation and translation, row major); the overlay
//! works on them as 4x4 homogeneous matrices. Everything is `f64` and computed in the same
//! order as the Python implementation ([`overlay_utils.py`]), so the two agree to rounding.
//!
//! [`overlay_utils.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/overlay/overlay_utils.py
pub type Vec3 = [f64; 3];
pub type Mat3 = [[f64; 3]; 3];
pub type Mat34 = [[f64; 4]; 3];
pub type Mat4 = [[f64; 4]; 4];

pub const IDENTITY: Mat4 = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
];

pub fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub fn scale(a: Vec3, factor: f64) -> Vec3 {
    [a[0] * factor, a[1] * factor, a[2] * factor]
}

pub fn neg(a: Vec3) -> Vec3 {
    [-a[0], -a[1], -a[2]]
}

pub fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/// The Euclidean length, accumulated as NumPy's `norm` does for three values.
pub fn norm(a: Vec3) -> f64 {
    dot(a, a).sqrt()
}

/// Column `index` of the rotation part (0 = x axis, 1 = y, 2 = z).
pub fn axis(m: &Mat4, index: usize) -> Vec3 {
    [m[0][index], m[1][index], m[2][index]]
}

pub fn translation(m: &Mat4) -> Vec3 {
    axis(m, 3)
}

pub fn set_axis(m: &mut Mat4, index: usize, value: Vec3) {
    for row in 0..3 {
        m[row][index] = value[row];
    }
}

pub fn mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [[0.0; 4]; 4];
    for (i, row) in out.iter_mut().enumerate() {
        for (j, cell) in row.iter_mut().enumerate() {
            *cell = (0..4).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    out
}

pub fn mul3(a: &Mat3, b: &Mat3) -> Mat3 {
    let mut out = [[0.0; 3]; 3];
    for (i, row) in out.iter_mut().enumerate() {
        for (j, cell) in row.iter_mut().enumerate() {
            *cell = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    out
}

/// `m @ [p, 1]`, dropping the homogeneous coordinate.
pub fn transform_point(m: &Mat4, p: Vec3) -> Vec3 {
    let mut out = [0.0; 3];
    for (row, value) in out.iter_mut().enumerate() {
        *value = m[row][0] * p[0] + m[row][1] * p[1] + m[row][2] * p[2] + m[row][3];
    }
    out
}

pub fn to_homogeneous(m: &Mat34) -> Mat4 {
    [m[0], m[1], m[2], [0.0, 0.0, 0.0, 1.0]]
}

pub fn to_mat34(m: &Mat4) -> Mat34 {
    [m[0], m[1], m[2]]
}

/// The inverse of a general 4x4 matrix (Gauss-Jordan with partial pivoting).
/// `None` when the matrix is singular.
pub fn inverse(m: &Mat4) -> Option<Mat4> {
    let mut a = *m;
    let mut inv = IDENTITY;
    for col in 0..4 {
        let pivot = (col..4).max_by(|&x, &y| a[x][col].abs().total_cmp(&a[y][col].abs()))?;
        if a[pivot][col].abs() < 1e-300 {
            return None;
        }
        a.swap(col, pivot);
        inv.swap(col, pivot);
        let p = a[col][col];
        for j in 0..4 {
            a[col][j] /= p;
            inv[col][j] /= p;
        }
        for row in 0..4 {
            if row != col {
                let factor = a[row][col];
                if factor != 0.0 {
                    for j in 0..4 {
                        a[row][j] -= factor * a[col][j];
                        inv[row][j] -= factor * inv[col][j];
                    }
                }
            }
        }
    }
    Some(inv)
}

fn radians(degrees: f64) -> f64 {
    std::f64::consts::PI / 180.0 * degrees
}

/// Rotation about x, then y, then z (`Rz @ Ry @ Rx`), angles in degrees.
pub fn euler_to_rotation_matrix(angles: Vec3) -> Mat3 {
    let (phi, theta, psi) = (
        angles[0] * std::f64::consts::PI / 180.0,
        angles[1] * std::f64::consts::PI / 180.0,
        angles[2] * std::f64::consts::PI / 180.0,
    );
    let rx = [[1.0, 0.0, 0.0], [0.0, phi.cos(), -phi.sin()], [0.0, phi.sin(), phi.cos()]];
    let ry = [[theta.cos(), 0.0, theta.sin()], [0.0, 1.0, 0.0], [-theta.sin(), 0.0, theta.cos()]];
    let rz = [[psi.cos(), -psi.sin(), 0.0], [psi.sin(), psi.cos(), 0.0], [0.0, 0.0, 1.0]];
    mul3(&rz, &mul3(&ry, &rx))
}

fn rotation_x(angle: f64) -> Mat3 {
    let (c, s) = (radians(angle).cos(), radians(angle).sin());
    [[1.0, 0.0, 0.0], [0.0, c, -s], [0.0, s, c]]
}

fn rotation_y(angle: f64) -> Mat3 {
    let (c, s) = (radians(angle).cos(), radians(angle).sin());
    [[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]]
}

fn rotation_z(angle: f64) -> Mat3 {
    let (c, s) = (radians(angle).cos(), radians(angle).sin());
    [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]]
}

/// The pose `base @ (translate(translation) with rotation Rz @ Ry @ Rx)`, rotation in degrees.
///
/// The overlay settings are stored as (x, y, z, x°, y°, z°) and applied with the translation
/// `(x, y, -z)` (`Overlay.updatePosition`).
pub fn transform_matrix(base: &Mat34, translation: Vec3, rotation: Vec3) -> Mat34 {
    let r = mul3(&rotation_z(rotation[2]), &mul3(&rotation_y(rotation[1]), &rotation_x(rotation[0])));
    let mut t = IDENTITY;
    for i in 0..3 {
        t[i][..3].copy_from_slice(&r[i]);
        t[i][3] = translation[i];
    }
    to_mat34(&mul(&to_homogeneous(base), &t))
}

/// The settings position (x, y, z, x°, y°, z°) for which `transform_matrix(base, (x, y, -z),
/// (x°, y°, z°))` gives `relative`. At gimbal lock the x rotation folds into z.
pub fn matrix_to_position(base: &Mat34, relative: &Mat34) -> Option<[f64; 6]> {
    let h = mul(&inverse(&to_homogeneous(base))?, &to_homogeneous(relative));
    let sy = -h[2][0];
    let (x_rot, y_rot, z_rot) = if sy.abs() < 0.999999 {
        (h[2][1].atan2(h[2][2]), sy.asin(), h[1][0].atan2(h[0][0]))
    } else {
        (0.0, std::f64::consts::FRAC_PI_2 * sign(sy), (-h[0][1]).atan2(h[1][1]))
    };
    Some([h[0][3], h[1][3], -h[2][3], x_rot.to_degrees(), y_rot.to_degrees(), z_rot.to_degrees()])
}

/// NumPy's `sign`: -1, 0 or 1.
fn sign(value: f64) -> f64 {
    if value > 0.0 {
        1.0
    } else if value < 0.0 {
        -1.0
    } else {
        0.0
    }
}

/// The base pose of a tracker: rotation from the angles, and a translation scaled by `z_pos`
/// (`getBaseMatrix`).
pub fn base_matrix(position: [f64; 6]) -> Mat34 {
    let [x, y, z, rx, ry, rz] = position;
    let r = euler_to_rotation_matrix([rx, ry, rz]);
    [[r[0][0], r[0][1], r[0][2], x * z], [r[1][0], r[1][1], r[1][2], y * z], [r[2][0], r[2][1], r[2][2], -z]]
}

/// What an overlay follows. The settings store the names below.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tracker {
    Hmd,
    LeftHand,
    RightHand,
    /// Fixed in the SteamVR play space.
    Playspace,
}

impl Tracker {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "HMD" => Some(Self::Hmd),
            "LeftHand" => Some(Self::LeftHand),
            "RightHand" => Some(Self::RightHand),
            "Playspace" => Some(Self::Playspace),
            _ => None,
        }
    }

    /// As the overlay reads a stored tracker: anything it does not know follows the head.
    pub fn from_setting(name: &str) -> Self {
        Self::from_name(name).unwrap_or(Self::Hmd)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Hmd => "HMD",
            Self::LeftHand => "LeftHand",
            Self::RightHand => "RightHand",
            Self::Playspace => "Playspace",
        }
    }

    /// The pose the stored position is measured from. The play space has no offset.
    pub fn base(self) -> Mat34 {
        match self {
            Self::Hmd => base_matrix([0.0, -0.4, 1.0, 0.0, 0.0, 0.0]),
            Self::LeftHand => base_matrix([0.3, 0.1, -0.31, -65.0, 165.0, 115.0]),
            Self::RightHand => base_matrix([-0.3, 0.1, -0.31, -65.0, -165.0, -115.0]),
            Self::Playspace => to_mat34(&IDENTITY),
        }
    }
}

/// Where an overlay sits relative to its tracker, from the stored settings (`panelRelative`).
pub fn relative_pose(tracker: Tracker, position: [f64; 6]) -> Mat34 {
    let [x, y, z, rx, ry, rz] = position;
    transform_matrix(&tracker.base(), [x, y, -z], [rx, ry, rz])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn inverse_undoes_a_pose() {
        let pose = to_homogeneous(&Tracker::LeftHand.base());
        let product = mul(&pose, &inverse(&pose).unwrap());
        for i in 0..4 {
            for j in 0..4 {
                assert!(close(product[i][j], IDENTITY[i][j]));
            }
        }
        assert!(inverse(&[[0.0; 4]; 4]).is_none());
    }

    #[test]
    fn position_round_trips_through_the_matrix() {
        for tracker in [Tracker::Hmd, Tracker::LeftHand, Tracker::RightHand, Tracker::Playspace] {
            let position = [0.05, -0.12, 0.4, 10.0, -35.0, 80.0];
            let relative = relative_pose(tracker, position);
            let back = matrix_to_position(&tracker.base(), &relative).unwrap();
            for (a, b) in back.iter().zip(position) {
                assert!(close(*a, b), "{tracker:?}: {back:?}");
            }
        }
    }

    #[test]
    fn gimbal_lock_folds_x_into_z() {
        let relative = relative_pose(Tracker::Playspace, [0.0, 0.0, 1.0, 30.0, 90.0, 0.0]);
        let back = matrix_to_position(&Tracker::Playspace.base(), &relative).unwrap();
        assert!(close(back[3], 0.0) && close(back[4], 90.0));
    }

    #[test]
    fn tracker_names_round_trip() {
        for name in ["HMD", "LeftHand", "RightHand", "Playspace"] {
            assert_eq!(Tracker::from_name(name).unwrap().name(), name);
        }
        assert_eq!(Tracker::from_name("hmd"), None);
    }
}
