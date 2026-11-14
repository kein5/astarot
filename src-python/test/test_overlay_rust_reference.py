"""The Rust port of the VR overlay (src-tauri/src/vr_overlay/) is checked against values recorded
from this Python overlay. When the Python overlay changes, those values must be recorded again:

    python src-tauri/tests/vr_overlay_reference/dump_reference.py

and the Rust port changed to match (issue #282).
"""

import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "src-tauri/tests/vr_overlay_reference/dump_reference.py"


def _load_dump():
    spec = importlib.util.spec_from_file_location("vr_overlay_dump_reference", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _differences(recorded, current, path="$"):
    """Where the two disagree. Floats may differ in the last bits between machines (BLAS)."""
    if isinstance(recorded, bool) or isinstance(current, bool):
        return [] if recorded is current else [path]
    if isinstance(recorded, (int, float)) and isinstance(current, (int, float)):
        return [] if math.isclose(recorded, current, rel_tol=1e-12, abs_tol=1e-12) else [path]
    if isinstance(recorded, list) and isinstance(current, list):
        if len(recorded) != len(current):
            return [f"{path} (length)"]
        return [d for index, (a, b) in enumerate(zip(recorded, current)) for d in _differences(a, b, f"{path}[{index}]")]
    if isinstance(recorded, dict) and isinstance(current, dict):
        if recorded.keys() != current.keys():
            return [f"{path} (keys)"]
        return [d for key in recorded for d in _differences(recorded[key], current[key], f"{path}.{key}")]
    return [] if recorded == current else [path]


def test_recorded_values_still_match_the_python_overlay():
    dump = _load_dump()
    recorded = json.loads(dump.OUTPUT.read_text(encoding="utf-8"))
    current = json.loads(json.dumps(dump.build()))
    differences = _differences(recorded, current)
    assert not differences, f"record again with {SCRIPT.relative_to(ROOT)}: {differences[:5]}"


def test_the_comparison_notices_a_change():
    assert _differences({"a": [1.0, True]}, {"a": [1.0 + 1e-6, True]}) == ["$.a[0]"]
    assert _differences({"a": True}, {"a": 1}) == ["$.a"]
    assert _differences([1, 2], [1]) == ["$ (length)"]
