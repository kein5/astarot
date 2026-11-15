#!/usr/bin/env python3
"""Record what cv2, pyclipper and Shapely return for random inputs (tests/cv_conformance.rs).

Run with the reference environment's Python (setup_reference.py):

    $REF/venv/bin/python native/ocr-runtime/reference/dump_cv_cases.py

Writes $REF/fixtures/cv/<operation>.json. Inputs are random pictures and shapes from a
fixed seed; nothing here reads a real screen, model or recording.
"""
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import pyclipper
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parent))
from setup_reference import reference_dir  # noqa: E402

RNG = np.random.default_rng(20261115)


def image(h, w, cn=3):
    """Smooth gradients plus noise, so interpolation errors would show."""
    yy, xx = np.mgrid[0:h, 0:w]
    base = (np.sin(xx / max(w, 1) * RNG.uniform(1, 9)) + np.cos(yy / max(h, 1) * RNG.uniform(1, 9))) * 60 + 128
    planes = [base + RNG.integers(-40, 40, (h, w)) for _ in range(cn)]
    return np.clip(np.stack(planes, axis=-1), 0, 255).astype(np.uint8)


def blobs(h, w):
    mask = np.zeros((h, w), np.uint8)
    for _ in range(RNG.integers(1, 12)):
        x, y = int(RNG.integers(-5, w)), int(RNG.integers(-5, h))
        bw, bh = int(RNG.integers(1, max(2, w // 2))), int(RNG.integers(1, max(2, h // 3)))
        if RNG.random() < 0.6:
            mask[max(0, y):y + bh, max(0, x):x + bw] = 1
        else:
            cv2.ellipse(mask, (x, y), (bw // 2 + 1, bh // 2 + 1), float(RNG.uniform(0, 180)), 0, 360, 1, -1)
    if RNG.random() < 0.5:  # holes and specks
        mask[RNG.random((h, w)) < 0.03] ^= 1
    return mask


def b64(array):
    import base64
    return base64.b64encode(np.ascontiguousarray(array).tobytes()).decode()


def resize_cases():
    cases = []
    sizes = [((37, 53), (106, 74)), ((40, 64), (32, 20)), ((100, 160), (80, 50)), ((48, 31), (31, 48)),
             ((720, 1280), (640, 352)), ((5, 7), (3, 1)), ((9, 9), (288, 320)), ((64, 64), (64, 64))]
    for _ in range(40):
        h, w = int(RNG.integers(1, 300)), int(RNG.integers(1, 300))
        sizes.append(((h, w), (int(RNG.integers(1, 400)), int(RNG.integers(1, 400)))))
    for (h, w), (dw, dh) in sizes:
        for cn in (1, 3):
            src = image(h, w, cn)
            for name, flag in (('linear', cv2.INTER_LINEAR), ('area', cv2.INTER_AREA)):
                out = cv2.resize(src, (dw, dh), interpolation=flag)
                cases.append({'interpolation': name, 'cn': cn, 'w': w, 'h': h, 'dw': dw, 'dh': dh,
                              'src': b64(src), 'dst': b64(out)})
    return cases


def contour_cases():
    cases = []
    for _ in range(150):
        h, w = int(RNG.integers(1, 120)), int(RNG.integers(1, 160))
        mask = blobs(h, w)
        contours, _ = cv2.findContours((mask * 255).astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        cases.append({'w': w, 'h': h, 'mask': b64(mask), 'contours': [c.reshape(-1, 2).tolist() for c in contours]})
    return cases


def rect_cases():
    cases = []
    for _ in range(600):
        kind = RNG.integers(0, 3)
        if kind == 0:
            pts = RNG.integers(0, 300, (int(RNG.integers(1, 40)), 2))
        elif kind == 1:  # nearly axis-aligned text lines
            x0, y0 = RNG.integers(0, 200, 2)
            w, h = RNG.integers(1, 200), RNG.integers(1, 40)
            pts = np.array([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]) + RNG.integers(-1, 2, (4, 2))
        else:
            mask = blobs(int(RNG.integers(4, 60)), int(RNG.integers(4, 90)))
            contours, _ = cv2.findContours((mask * 255).astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue
            pts = contours[0].reshape(-1, 2)
        pts = pts.astype(np.int32).reshape(-1, 1, 2)
        hull = cv2.convexHull(pts, clockwise=False, returnPoints=True).reshape(-1, 2)
        rect = cv2.minAreaRect(pts)
        box = cv2.boxPoints(rect)
        cases.append({'points': pts.reshape(-1, 2).tolist(), 'hull': hull.tolist(),
                      'rect': [rect[0][0], rect[0][1], rect[1][0], rect[1][1], rect[2]], 'box': box.tolist()})
    return cases


def fill_cases():
    cases = []
    for _ in range(400):
        h, w = int(RNG.integers(1, 60)), int(RNG.integers(1, 90))
        quad = RNG.uniform(-8, max(w, h) + 8, (4, 2)).astype(np.float32)
        if RNG.random() < 0.5:  # mostly what box_score_fast gets: an almost upright box
            x0, y0 = RNG.uniform(-3, w, 2)
            bw, bh = RNG.uniform(0, w), RNG.uniform(0, h)
            quad = np.array([[x0, y0], [x0 + bw, y0 + RNG.uniform(-2, 2)], [x0 + bw, y0 + bh], [x0, y0 + bh]], np.float32)
        poly = quad.astype(np.int32)
        mask = np.zeros((h, w), np.uint8)
        cv2.fillPoly(mask, poly.reshape(1, -1, 2), 1)
        cases.append({'w': w, 'h': h, 'poly': poly.tolist(), 'mask': b64(mask)})
    return cases


def warp_cases():
    cases = []
    for _ in range(120):
        h, w = int(RNG.integers(4, 160)), int(RNG.integers(4, 220))
        src = image(h, w, 3)
        x0, y0 = RNG.uniform(-2, w * 0.7), RNG.uniform(-2, h * 0.7)
        bw, bh = RNG.uniform(3, w), RNG.uniform(3, h)
        tilt = RNG.uniform(-3, 3) if RNG.random() < 0.4 else 0.0
        quad = np.array([[x0, y0], [x0 + bw, y0 + tilt], [x0 + bw, y0 + bh + tilt], [x0, y0 + bh]], np.float32)
        if RNG.random() < 0.5:
            quad = np.round(quad)
        quad = quad.astype(np.float32)
        cw = int(max(np.linalg.norm(quad[0] - quad[1]), np.linalg.norm(quad[2] - quad[3])))
        ch = int(max(np.linalg.norm(quad[0] - quad[3]), np.linalg.norm(quad[1] - quad[2])))
        if cw <= 0 or ch <= 0:
            continue
        dst_pts = np.array([[0, 0], [cw, 0], [cw, ch], [0, ch]], np.float32)
        m = cv2.getPerspectiveTransform(quad, dst_pts)
        out = cv2.warpPerspective(src, m, (cw, ch), borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_CUBIC)
        cases.append({'w': w, 'h': h, 'src': b64(src), 'quad': quad.tolist(), 'dw': cw, 'dh': ch,
                      'm': m.reshape(-1).tolist(), 'dst': b64(out)})
    return cases


def unclip_cases():
    cases = []
    while len(cases) < 1500:
        if RNG.random() < 0.5:
            pts = RNG.integers(0, 300, (int(RNG.integers(3, 30)), 1, 2)).astype(np.int32)
        else:
            x0, y0 = RNG.integers(0, 200, 2)
            w, h = RNG.integers(3, 250), RNG.integers(3, 50)
            pts = np.array([[[x0, y0]], [[x0 + w, y0]], [[x0 + w, y0 + h]], [[x0, y0 + h]]], np.int32)
        rect = cv2.minAreaRect(pts)
        if min(rect[1]) < 3:
            continue
        p = sorted(list(cv2.boxPoints(rect)), key=lambda x: x[0])
        i1, i4 = (0, 1) if p[1][1] > p[0][1] else (1, 0)
        i2, i3 = (2, 3) if p[3][1] > p[2][1] else (3, 2)
        box = np.array([p[i1], p[i2], p[i3], p[i4]])
        poly = Polygon(box)
        distance = poly.area * 1.6 / poly.length
        offset = pyclipper.PyclipperOffset()
        offset.AddPath(box, pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
        cases.append({'box': box.tolist(), 'area': poly.area, 'length': poly.length, 'distance': distance,
                      'expanded': offset.Execute(distance)})
    return cases


def main():
    out = reference_dir() / 'fixtures' / 'cv'
    out.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(1)
    for name, make in (('resize', resize_cases), ('contours', contour_cases), ('rect', rect_cases),
                       ('fill', fill_cases), ('warp', warp_cases), ('unclip', unclip_cases)):
        cases = make()
        (out / f'{name}.json').write_text(json.dumps({'opencv': cv2.__version__, 'cases': cases}))
        print(f'{name}: {len(cases)} cases')
    print(f'written to {out}')


if __name__ == '__main__':
    os.environ.setdefault('OMP_NUM_THREADS', '1')
    main()
