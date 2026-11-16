"""Record what the Python VR overlay computes, for the Rust port to be checked against.

Run from the repository root with the app's Python (NumPy, Pillow and openvr installed):

    python native/vr-overlay/tests/vr_overlay_reference/dump_reference.py

It writes reference.json next to this file. The Rust tests (native/vr-overlay/src/reference_tests.rs)
replay every case, and src-python/test/test_overlay_rust_reference.py checks that the file still
matches the Python implementation. Inputs are fixed (seeded), so the file only changes when the
Python overlay does. No SteamVR is needed: only the overlay's calculations run.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[4]
OUTPUT = Path(__file__).with_name("reference.json")
if str(ROOT / "src-python") not in sys.path:
    sys.path.insert(0, str(ROOT / "src-python"))

import numpy as np  # noqa: E402

from models.overlay import overlay as o  # noqa: E402
from models.overlay import overlay_tooltip as t  # noqa: E402
from models.overlay import overlay_utils as u  # noqa: E402

POSITION_KEYS = ("x_pos", "y_pos", "z_pos", "x_rotation", "y_rotation", "z_rotation")
REGIONS = (o.PANEL, o.LAUNCHER, o.POPUP, o.TOOLBAR, o.TOOLTIP)


def plain(value):
    """NumPy values as JSON-ready Python values."""
    if isinstance(value, np.ndarray):
        return [plain(v) for v in value.tolist()]
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    return value


def layout_json(layout):
    return {"atlas": list(layout["atlas"]), "regions": {k: list(v) for k, v in layout["regions"].items()}}


class Inputs:
    def __init__(self, seed: int = 282):
        self.rng = np.random.RandomState(seed)

    def angles(self):
        return [float(v) for v in self.rng.uniform(-180.0, 180.0, 3)]

    def pose(self, spread: float = 1.5) -> np.ndarray:
        pose = np.eye(4)
        pose[:3, :3] = u.euler_to_rotation_matrix(self.angles())
        pose[:3, 3] = self.rng.uniform(-spread, spread, 3)
        return pose

    def point(self, spread: float = 1.5):
        return self.rng.uniform(-spread, spread, 3)

    def position(self):
        return [float(v) for v in self.rng.uniform(-0.5, 0.5, 3)] + self.angles()


def layout_cases():
    sizes = [(900, 700), (600, 400), (1400, 1000), (750, 999), (1200, 450), (601, 401)]
    layouts = [{"panel": list(size), "layout": layout_json(o.computeVrLayout(*size))} for size in sizes]
    clamps = [[w, h, list(o.clampPanelSize(w, h))] for w, h in
              [(10.0, 5000.0), (700.5, 501.5), (701.5, 502.5), (1399.4, 999.6), (900.0, 700.0), (-3.0, 0.0)]]
    rects, bounds = [], []
    for size in sizes:
        layout = o.computeVrLayout(*size)
        for width in (layout["atlas"][0], round(layout["atlas"][0] * 1.25), round(layout["atlas"][0] * 1.5), 1000, 3257):
            for region in REGIONS:
                rects.append({"panel": list(size), "region": region, "image_width": width,
                              "rect": list(o.regionRect(region, (width, 1), layout))})
        for region in REGIONS:
            bounds.append({"panel": list(size), "region": region, "bounds": list(o.regionBounds(region, layout))})
    uv = [[u_, v_, w, h, list(o.uvToPixel(u_, v_, w, h))] for u_, v_, w, h in
          [(0.0, 0.0, 100, 50), (0.5, 0.5, 900, 700), (1.0, 1.0, 900, 700), (-1.0, 3.0, 100, 50),
           (2.0, -3.0, 100, 50), (0.25, 0.6, 880, 128), (0.999, 0.001, 720, 96)]]
    return {"layouts": layouts, "clamp_panel_size": clamps, "region_rect": rects, "region_bounds": bounds, "uv_to_pixel": uv}


def math_cases(inputs: Inputs):
    euler = [{"angles": a, "matrix": plain(u.euler_to_rotation_matrix(a))} for a in [inputs.angles() for _ in range(8)]]
    bases = {"HMD": plain(o.getHMDBaseMatrix()), "LeftHand": plain(o.getLeftHandBaseMatrix()),
             "RightHand": plain(o.getRightHandBaseMatrix())}
    transforms, positions = [], []
    for tracker in ("HMD", "LeftHand", "RightHand", "Playspace"):
        base = np.hstack([np.eye(3), np.zeros((3, 1))]) if tracker == "Playspace" else np.array(bases[tracker])
        for position in [inputs.position() for _ in range(4)] + [[0.1, -0.2, 0.5, 30.0, 90.0, 10.0]]:
            x, y, z, rx, ry, rz = position
            relative = u.transform_matrix(base, (x, y, -z), (rx, ry, rz))
            transforms.append({"tracker": tracker, "position": position, "relative": plain(relative)})
            positions.append({"tracker": tracker, "relative": plain(relative),
                              "position": plain(u.matrix_to_position(base, relative))})
    return {"euler": euler, "bases": bases, "transform": transforms, "matrix_to_position": positions}


def pose_cases(inputs: Inputs):
    hits = []
    for _ in range(24):
        ray, plane = inputs.pose(), inputs.pose()
        hit = o.rayPlaneHit(ray, plane)
        hits.append({"ray": plain(ray), "plane": plain(plane),
                     "hit": None if hit is None else {"x": hit[0], "y": hit[1], "point": plain(hit[2]), "distance": hit[3]}})
    # A plane straight ahead of the ray, and one parallel to it.
    ahead = np.eye(4)
    ahead[2, 3] = -2.0
    side = np.eye(4)
    side[:3, :3] = u.euler_to_rotation_matrix((0.0, 90.0, 0.0))
    for plane in (ahead, side):
        hit = o.rayPlaneHit(np.eye(4), plane)
        hits.append({"ray": plain(np.eye(4)), "plane": plain(plane),
                     "hit": None if hit is None else {"x": hit[0], "y": hit[1], "point": plain(hit[2]), "distance": hit[3]}})
    tilts = [{"degrees": d, "matrix": plain(o.laserTilt(d))} for d in (0.0, 12.0, -30.0, 37.4)]
    facing = []
    for index in range(10):
        position, target = inputs.point(), inputs.point()
        up = None if index % 2 else inputs.point()
        facing.append({"position": plain(position), "target": plain(target), "up": plain(up),
                       "pose": plain(o.popupPoseFacing(position, target, up))})
    # Degenerate: target at the position, and up along the facing direction.
    facing.append({"position": [0.0, 0.0, 0.0], "target": [0.0, 0.0, 0.0], "up": None,
                   "pose": plain(o.popupPoseFacing(np.zeros(3), np.zeros(3)))})
    facing.append({"position": [0.0, 0.0, 0.0], "target": [0.0, 1.0, 0.0], "up": None,
                   "pose": plain(o.popupPoseFacing(np.zeros(3), np.array([0.0, 1.0, 0.0])))})
    heads = [inputs.pose() for _ in range(10)]
    down = np.eye(4)
    down[:3, :3] = u.euler_to_rotation_matrix((-90.0, 0.0, 0.0))
    heads.append(down)
    spheres = []
    for head in heads:
        point = inputs.point()
        radius = float(inputs.rng.uniform(0.2, 3.0))
        spheres.append({"point": plain(point), "head": plain(head), "radius": radius,
                        "pose": plain(o.poseOnSphere(point, head, radius))})
    spheres.append({"point": plain(heads[0][:3, 3]), "head": plain(heads[0]), "radius": 1.0,
                    "pose": plain(o.poseOnSphere(heads[0][:3, 3].copy(), heads[0], 1.0))})
    radii = [[b, s, n, o.sphereRadius(b, s, n)] for b, s, n in
             [(1.0, 0.4, 0.5), (1.0, 0.01, 0.5), (0.1, 0.4, 0.2), (0.1, 0.4, 0.8), (3.0, 0.5, 0.7), (3.0, 0.5, 0.2), (2.0, 0.3, 0.9)]]
    views = []
    for head in heads:
        for _ in range(4):
            position = head[:3, 3] + inputs.point(2.2)
            for was_out in (False, True):
                views.append({"head": plain(head), "position": plain(position), "was_out": was_out,
                              "out": o.isOutOfView(head, position, was_out)})
    recalls = [{"head": plain(head), "pose": plain(o.recallPose(head))} for head in heads]
    quaternions = []
    for _ in range(8):
        m = u.euler_to_rotation_matrix(inputs.angles())
        q = o._quaternionOf(m)
        quaternions.append({"matrix": plain(m), "quaternion": plain(q), "back": plain(o._matrixOf(q))})
    for angles in ((180.0, 0.0, 0.0), (0.0, 180.0, 0.0), (0.0, 0.0, 180.0), (0.0, 0.0, 0.0)):
        m = u.euler_to_rotation_matrix(angles)
        q = o._quaternionOf(m)
        quaternions.append({"matrix": plain(m), "quaternion": plain(q), "back": plain(o._matrixOf(q))})
    fronts = [{"head": plain(head), "pose": plain(o.introFrontPose(head))} for head in heads]
    flights = []
    for _ in range(6):
        front, target = inputs.pose(), inputs.pose()
        for progress in (0.0, 0.3, 0.75, 1.0):
            flights.append({"front": plain(front), "target": plain(target), "progress": progress,
                            "pose": plain(o.introFlightPose(front, target, progress))})
    near = heads[1].copy()
    near[:3, 3] += 0.1
    opposite = heads[2].copy()
    opposite[:3, :3] = opposite[:3, :3] @ u.euler_to_rotation_matrix((0.0, 179.0, 0.0))
    # Close rotations take the linear branch (2 degrees) or slerp just past it (5 degrees).
    slight, past = heads[3].copy(), heads[3].copy()
    slight[:3, :3] = slight[:3, :3] @ u.euler_to_rotation_matrix((0.0, 2.0, 0.0))
    past[:3, :3] = past[:3, :3] @ u.euler_to_rotation_matrix((0.0, 5.0, 0.0))
    for front, target in ((heads[1], near), (heads[2], opposite), (heads[3], slight), (heads[3], past)):
        # Not halfway: there a normalised blend and slerp give the same rotation.
        flights.append({"front": plain(front), "target": plain(target), "progress": 0.3,
                        "pose": plain(o.introFlightPose(front, target, 0.3))})
    stick = lambda x, y: SimpleNamespace(rAxis=[SimpleNamespace(x=x, y=y)])  # noqa: E731
    sticks = [None, (0.0, 1.0), (0.0, -1.0), (0.4, 0.6), (0.1, 0.4), (-0.2, 0.9), (0.0, -0.8)]
    push_pull = []
    for distance in (0.1, 0.25, 1.0, 2.5, 3.0):
        for s in sticks:
            push_pull.append({"distance": distance, "stick": s, "dt": 0.05,
                              "result": o.pushPullDistance(distance, None if s is None else stick(*s), 0.05)})
    push_pull_pose = []
    for s in sticks:
        hand_to_overlay = inputs.pose(0.8)
        push_pull_pose.append({"pose": plain(hand_to_overlay), "stick": s, "dt": 0.1,
                               "result": plain(o.pushPull(hand_to_overlay, None if s is None else stick(*s), 0.1))})
    looks = []
    for head in heads:
        for _ in range(4):
            launcher = inputs.pose()
            launcher[:3, 3] = head[:3, 3] + inputs.point(0.6)
            for face, gaze in ((45.0, 40.0), (55.0, 45.0), (170.0, 170.0)):
                looks.append({"launcher": plain(launcher), "head": plain(head), "face_deg": face, "gaze_deg": gaze,
                              "visible": o.launcherLooksVisible(launcher, head, face, gaze)})
    return {"ray_plane_hit": hits, "laser_tilt": tilts, "pose_facing": facing, "pose_on_sphere": spheres,
            "sphere_radius": radii, "is_out_of_view": views, "recall_pose": recalls, "quaternion": quaternions,
            "intro_front_pose": fronts, "intro_flight_pose": flights, "push_pull_distance": push_pull,
            "push_pull": push_pull_pose, "launcher_looks_visible": looks}


def placement_cases(inputs: Inputs):
    launchers = []
    for x, y, z, scaling in [(0.0, 0.0, 0.0, 0.3), (0.3, 0.0, 0.0, 2.0), (0.1, 0.1, 0.05, 0.11), (0.05, -0.02, 0.1, 0.5),
                             (-0.2, 0.3, -0.1, 0.12), (0.12345678, 0.2, 0.0, 1.0)]:
        settings = {"x_pos": x, "y_pos": y, "z_pos": z, "ui_scaling": scaling}
        launchers.append({"settings": settings, "out_of_reach": o.launcherOutOfReach(settings),
                          "nearest": o.launcherNearestInReach(settings)})
    mirrors = []
    for tracker in ("LeftHand", "RightHand", "HMD"):
        position = dict(zip(POSITION_KEYS, inputs.position()), tracker=tracker)
        mirrors.append({"position": position, "mirrored": o.mirrorHandPosition(position)})
    return {"launcher_reach": launchers, "mirror_hand_position": mirrors}


def bare_overlay(settings):
    overlay = o.Overlay(settings)
    overlay.initialized = True
    overlay.overlay = MagicMock()
    overlay.overlay_system = MagicMock()
    return overlay


def region_cases(inputs: Inputs):
    widths, pixels, toolbars = [], [], []
    for size in ((900, 700), (1400, 1000), (600, 400)):
        layout = o.computeVrLayout(*size)
        for region in REGIONS:
            settings = {region: {"ui_scaling": float(inputs.rng.uniform(0.1, 2.0))}}
            overlay = bare_overlay(settings)
            overlay.layout = layout
            widths.append({"region": region, "ui_scaling": settings[region]["ui_scaling"],
                           "width_m": overlay.regionWidthM(region)})
            for image_width in (layout["atlas"][0], round(layout["atlas"][0] * 1.5)):
                overlay.panel_image_size = (image_width, 1)
                pose = inputs.pose()
                for _ in range(3):
                    local = np.array([*inputs.rng.uniform(-0.7, 0.7, 2) * settings[region]["ui_scaling"], 0.0, 1.0])
                    point = (pose @ local)[:3]
                    results = SimpleNamespace(vPoint=SimpleNamespace(v=list(point)))
                    pixels.append({"panel": list(size), "region": region, "ui_scaling": settings[region]["ui_scaling"],
                                   "image_width": image_width, "pose": plain(pose), "point": plain(point),
                                   "pixel": list(overlay.regionPixel(region, results, pose))})
        overlay = bare_overlay({o.PANEL: {"ui_scaling": float(inputs.rng.uniform(0.3, 1.5))}})
        overlay.layout = layout
        overlay.toolbar_handle = 5
        relative = inputs.pose()[:3, :]
        overlay.placeToolbar(7, relative)
        toolbars.append({"panel": list(size), "panel_ui_scaling": overlay.settings[o.PANEL]["ui_scaling"],
                         "panel_relative": plain(relative), "toolbar_relative": plain(overlay.toolbar_relative)})
    return {"region_width_m": widths, "region_pixel": pixels, "toolbar_relative": toolbars}


def fade_cases():
    cases = []
    for display, fadeout, opacity in ((6.0, 2.0, 1.0), (3.0, 0.5, 0.6), (0.0, 1.0, 0.8), (5.0, 0.0, 0.7)):
        settings = {"small": {"display_duration": display, "fadeout_duration": fadeout, "opacity": opacity}}
        overlay = bare_overlay(settings)
        overlay.handle = {"small": 3}
        overlay.lastUpdate["small"] = 100.0
        calls = []
        overlay.submitOverlay = lambda method, handle, *args: calls.append(args[0])  # noqa: B023
        for now in (100.0, 104.0, 100.0 + display, 100.0 + display + fadeout / 2, 100.0 + display + fadeout, 200.0):
            with patch.object(o.time, "monotonic", return_value=now):
                overlay.evaluateOpacityFade("small")
            cases.append({"display": display, "fadeout": fadeout, "opacity": opacity, "now": now,
                          "ratio": overlay.fadeRatio["small"], "alpha": calls[-1],
                          "visible": overlay.isVisible("small")})
    return cases


def toolbar_cases():
    """One run of the toolbar: each step's inputs and what the Python overlay did."""
    script = [(0.0, True, True), (0.1, True, True), (0.31, True, True), (0.4, True, True), (0.5, False, True),
              (0.6, True, True), (1.0, False, True), (2.9, False, True), (3.01, False, True), (3.1, False, True),
              (3.2, False, True), (3.4, True, True), (3.75, True, True), (3.8, True, False), (3.9, True, True),
              (4.25, True, True), (4.3, False, True), (6.4, False, True), (6.5, False, True), (6.8, False, True)]
    overlay = bare_overlay({o.PANEL: {"ui_scaling": 0.9, "tracker": "Playspace"}})
    overlay.toolbar_handle = 9
    overlay.vr_panel_enabled = True
    calls = []
    overlay.submitOverlay = lambda method, handle, *args: calls.append([method, *[float(a) for a in args]])
    overlay.placeToolbar = lambda *args: None
    overlay.getTracker = lambda tracker: (None, 0)
    overlay.panelRelative = lambda: None
    overlay.resetTooltipEpoch = lambda notify=True: calls.append(["resetTooltipEpoch"])
    steps = []
    for now, pointing, shown in script:
        calls.clear()
        if shown:
            overlay.vr_windows_hidden.discard(o.PANEL)
        else:
            overlay.vr_windows_hidden.add(o.PANEL)
        overlay.updateToolbarVisibility(now, pointing)
        overlay.updateToolbarFade(now)
        steps.append({"now": now, "pointing": pointing, "log_shown": shown, "calls": list(calls),
                      "visible": overlay.toolbar_visible, "alpha": overlay.toolbar_alpha})
    return steps


def launcher_cases():
    """Runs of the launcher with scripted views: (now, within show angles, within hide angles, held, forced)."""
    runs = []
    scripts = {
        "auto_hide": [(10.0, True, True, False, False), (10.03, True, True, False, False), (10.05, True, True, False, False),
                      (10.1, True, True, False, False), (10.2, True, True, False, False), (10.26, True, True, False, False),
                      (10.4, False, True, False, False), (10.5, False, False, False, False), (10.7, False, False, False, False),
                      (10.85, False, False, False, False), (10.9, False, False, True, False), (11.5, False, False, True, False),
                      (11.6, None, None, False, False), (11.7, False, False, False, True), (11.8, False, False, False, True),
                      (12.5, False, False, False, False), (12.9, False, False, False, False), (13.0, True, False, False, False)],
        "always": [(1.0, False, False, False, False), (1.05, False, False, False, False), (1.5, True, True, False, False)],
    }
    for name, script in scripts.items():
        overlay = bare_overlay({o.LAUNCHER: {"opacity": 1.0, "fadeout_duration": 0}})
        overlay.handle = {o.LAUNCHER: 11}
        overlay.launcher_auto_hide = name == "auto_hide"
        overlay.launcher_shown = not overlay.launcher_auto_hide
        overlay.launcher_alpha = 1.0 if overlay.launcher_shown else 0.0
        overlay.launcher_interactive = overlay.launcher_shown
        resets = []
        overlay.resetTooltipEpoch = lambda notify=True: resets.append(1)  # noqa: B023
        overlay.overlayWorldPose = lambda size, poseOf: np.eye(4)
        steps = []
        for now, show, hide, held, forced in script:
            resets.clear()
            overlay.launcher_pointed = held
            overlay.launcher_return = {} if forced else None
            pose = None if show is None else np.eye(4)
            looks = lambda launcher, head, face, gaze: show if face == o._LAUNCHER_FACE_DEG else hide  # noqa: E731, B023
            with patch.object(o, "launcherLooksVisible", looks):
                overlay.updateLauncherVisibility(lambda index: pose, now)  # noqa: B023
            steps.append({"now": now, "within_show": show, "within_hide": hide, "held": held, "forced": forced,
                          "shown": overlay.launcher_shown, "alpha": overlay.launcher_alpha,
                          "interactive": overlay.launcher_interactive, "reset_tooltip": bool(resets)})
        runs.append({"auto_hide": overlay.launcher_auto_hide, "steps": steps})
    return runs


def tooltip_cases():
    shown = {"epoch": 3, "revision": 7, "visible": True, "region": "launcher",
             "button": [10, 20, 64, 64], "size": [360, 40], "arrow_x": 42.5}
    payloads = [
        shown, dict(shown, mode="focus"), dict(shown, region="toolbar", button=[656, 0, 64, 96]),
        {"epoch": 1, "revision": 1, "visible": False}, {"epoch": (1 << 48) - 1, "revision": (1 << 32) - 1, "visible": False},
        [], {"epoch": 0, "revision": 1, "visible": False}, {"epoch": True, "revision": 1, "visible": False},
        {"epoch": 1.0, "revision": 1, "visible": False}, {"epoch": 1 << 48, "revision": 1, "visible": False},
        {"epoch": 1, "revision": 1 << 32, "visible": False}, {"epoch": 1, "revision": 1, "visible": 1},
        {"epoch": 1, "revision": 1, "visible": False, "mode": "hover"}, dict(shown, extra=1), dict(shown, mode=None),
        dict(shown, mode="click"), dict(shown, region="panel"), dict(shown, button=[0, 0, 0, 10]),
        dict(shown, button=[0, 0, 10]), dict(shown, button=[0, 0, True, 10]), dict(shown, button=[0, 0, 1e7, 10]),
        dict(shown, button=[820, 0, 64, 64]), dict(shown, region="toolbar", button=[0, 0, 64, 97]),
        dict(shown, size=[361, 40]), dict(shown, size=[360, 0.5]), dict(shown, size=[360, 104]), dict(shown, size=[360.0, 1]),
        dict(shown, arrow_x=349), dict(shown, arrow_x=12), dict(shown, arrow_x="20"), {k: v for k, v in shown.items() if k != "arrow_x"},
    ]
    validation = []
    for payload in payloads:
        try:
            validation.append({"payload": payload, "result": t.validate_tooltip(payload), "error": None})
        except ValueError as error:
            validation.append({"payload": payload, "result": None, "error": str(error)})
    markers = []
    layout = o.DEFAULT_LAYOUT
    state = t.validate_tooltip(shown)
    for scale in (1.0, 1.5):
        width, height = round(layout["atlas"][0] * scale), round(layout["atlas"][1] * scale)
        x, y, _, _ = layout["regions"]["tooltip"]
        bits = (state["epoch"] << 32) | state["revision"]
        pixels = np.zeros((height, width, 4), dtype=np.uint8)
        cells = []
        for index in range(80):
            if (bits >> (79 - index)) & 1:
                px, py = round((x + index * 4 + 2) * scale), round((y + 4) * scale)
                pixels[py, px, :3] = 255
                cells.append([px, py])
        for revision in (state["revision"], state["revision"] + 1):
            markers.append({"width": width, "height": height, "white": cells, "epoch": state["epoch"], "revision": revision,
                            "matches": t.marker_matches(pixels, layout, dict(state, revision=revision))})
    return {"validation": validation, "marker": markers}


def build():
    inputs = Inputs()
    return plain({
        "generator": "native/vr-overlay/tests/vr_overlay_reference/dump_reference.py",
        "layout": layout_cases(),
        "math": math_cases(inputs),
        "pose": pose_cases(inputs),
        "placement": placement_cases(inputs),
        "region": region_cases(inputs),
        "fade": fade_cases(),
        "toolbar": toolbar_cases(),
        "launcher": launcher_cases(),
        "tooltip": tooltip_cases(),
    })


def main():
    OUTPUT.write_text(json.dumps(build(), indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
