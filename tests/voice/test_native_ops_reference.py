"""The Rust crate's copy of the download catalog must not drift from catalog.py.

native/ops/tests/catalog_reference.rs compares the Rust catalog with
native/ops/tests/data/python_reference.json. This test makes sure that file is what the
Python module answers today, so a change to catalog.py without the same change in
native/ops/src/downloads/catalog.rs fails here or there. No network, no model.
"""
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[2]


def test_the_reference_file_is_what_the_python_catalog_answers():
    script = runpy.run_path(str(ROOT / "native/ops/reference/dump_reference.py"))
    current = script["OUTPUT"].read_text(encoding="utf-8")
    assert current == script["render"](), (
        "native/ops/tests/data/python_reference.json is out of date: run "
        "python native/ops/reference/dump_reference.py, then update "
        "native/ops/src/downloads/catalog.rs until cargo test passes")
