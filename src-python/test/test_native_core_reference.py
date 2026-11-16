"""The Rust core's reference of how the Python backend reads saved settings must stay current.

native/core/tests/config_reference.rs checks that the Rust core writes back what the Python
backend writes for each saved config.json in native/core/reference/dump_reference.py. This test
runs the Python backend's settings on those files again and fails when config.py, the language
tables or a settings normalizer changed without the reference being written again. It starts one
Python process per case and platform, so it takes about a minute. No network, device or model.
"""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def test_the_core_reference_is_what_the_python_backend_does_today():
    script = ROOT / "native" / "core" / "reference" / "dump_reference.py"
    result = subprocess.run([sys.executable, str(script), "--check"], capture_output=True, text=True,
                            encoding="utf-8", timeout=600)
    assert result.returncode == 0, (
        "native/core reference data is out of date: run python native/core/reference/dump_reference.py, "
        "then update native/core until cargo test passes\n" + result.stderr[-2000:])
