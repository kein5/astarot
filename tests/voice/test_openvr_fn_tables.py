"""The Rust crates' copy of pyopenvr's function tables must stay what pyopenvr has.

native/vr-overlay and native/ocr-runtime call the OpenVR function tables by position and check
each position in their tests against native/openvr-client/tests/data/pyopenvr_fn_tables.json
(#610: a wrong position crashed the app). This test makes sure that file is what the pinned
pyopenvr has today, so a change of pyopenvr without a new file fails here. It was
src-python/test/test_openvr_fn_tables.py until the Python backend went in 0.6.0 (#285).
"""
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[2]


def test_the_reference_file_is_what_pyopenvr_has():
    script = runpy.run_path(str(ROOT / "native/openvr-client/reference/dump_reference.py"))
    current = script["OUTPUT"].read_text(encoding="utf-8")
    assert current == script["render"](), (
        "native/openvr-client/tests/data/pyopenvr_fn_tables.json is out of date: run "
        "python native/openvr-client/reference/dump_reference.py, then run cargo test for "
        "native/vr-overlay and native/ocr-runtime")
