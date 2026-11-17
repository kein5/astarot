"""ONNX Runtime never reports usage to Microsoft from the app or its tools (issue #518).

The official Linux build of ONNX Runtime 1.31 writes a `deviceid`, keeps an event store and
uploads events as soon as a process makes its first environment. Only the variable
`ORT_DISABLE_TELEMETRY`, set before the library is loaded, stops all of it; the environment
option `with_telemetry(false)` stops later events (and the Windows build's ETW events). Both
are required: every process that loads ONNX Runtime sets the variable first thing, and every
environment turns the option off.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / "native"

# The crates that load ONNX Runtime through `ort`, and the setter their binaries call.
ORT_CRATES = {
    "ocr-runtime": "ocr_runtime::engine::disable_telemetry_for_process",
    "translate-onnx": "vrct_translate_onnx::runtime::disable_telemetry_for_process",
    "rvc-runtime": "rvc_runtime::backend::disable_telemetry_for_process",
}


def _sources(crate: str):
    return sorted((NATIVE / crate / "src").rglob("*.rs"))


def _environment_builds(text: str):
    """Each `ort::init()` / `ort::init_from(..)` / `builder()?` chain up to its `.build()`."""
    return re.findall(r"(?:ort::init(?:_from)?\(|builder\(\)\?|builder\.with_name)[^;]*?\.build\(\)", text, re.S)


def _first_statement(text: str, signature: str) -> str:
    body = text[text.index(signature):]
    code = re.sub(r"//[^\n]*", "", body[body.index("{") + 1:])
    return code.split(";", 1)[0]


def test_every_crate_using_ort_is_listed():
    users = sorted(path.parent.name for path in NATIVE.glob("*/Cargo.toml") if re.search(r"^ort\s*=", path.read_text(encoding="utf-8"), re.M))
    assert users == sorted(ORT_CRATES)


@pytest.mark.parametrize("crate", sorted(ORT_CRATES))
def test_every_environment_turns_telemetry_off(crate):
    builds = [build for path in _sources(crate) for build in _environment_builds(path.read_text(encoding="utf-8")) if "with_name" in build]
    assert builds, f"{crate}: no environment found; update this test"
    for build in builds:
        assert ".with_telemetry(false)" in build, f"{crate}: {build!r}"


@pytest.mark.parametrize("crate", sorted(ORT_CRATES))
def test_every_binary_sets_the_variable_first(crate):
    bins = sorted((NATIVE / crate / "src" / "bin").glob("*.rs"))
    assert bins, f"{crate}: no binaries found; update this test"
    for path in bins:
        first_statement = _first_statement(path.read_text(encoding="utf-8"), "fn main()")
        assert ORT_CRATES[crate] in first_statement,f"{path.relative_to(ROOT)} must call {ORT_CRATES[crate]} first"


def test_the_setters_set_the_variable_onnx_runtime_reads():
    for crate in ORT_CRATES:
        text = "".join(path.read_text(encoding="utf-8") for path in _sources(crate))
        setter = re.search(r"pub unsafe fn disable_telemetry_for_process\(\) \{(.*?)\n\}", text, re.S)
        assert setter, crate
        assert re.search(r'set_var\((?:"ORT_DISABLE_TELEMETRY"|DISABLE_TELEMETRY_VARIABLE), "1"\)', setter.group(1)), crate
    assert 'DISABLE_TELEMETRY_VARIABLE: &str = "ORT_DISABLE_TELEMETRY"' in (NATIVE / "ocr-runtime" / "src" / "engine.rs").read_text(encoding="utf-8")


def test_the_app_sets_the_variable_before_anything_starts():
    text = (ROOT / "src-tauri" / "src" / "lib.rs").read_text(encoding="utf-8")
    first_statement = _first_statement(text, "pub fn run()")
    assert "vrct_core::shipped_libraries::disable_onnx_runtime_telemetry" in first_statement
    core = (NATIVE / "core" / "src" / "shipped_libraries.rs").read_text(encoding="utf-8")
    assert "ocr_runtime::engine::disable_telemetry_for_process" in core
