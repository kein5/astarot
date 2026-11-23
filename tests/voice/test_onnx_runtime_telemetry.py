"""ONNX Runtime never reports usage to Microsoft from the app or its tools (issue #518).

The official Linux build of ONNX Runtime 1.31 writes a `deviceid`, keeps an event store and
uploads events as soon as a process makes its first environment. Only the variable
`ORT_DISABLE_TELEMETRY`, set before the library is loaded, stops all of it; the environment
option `with_telemetry(false)` stops later events (and the Windows build's ETW events). Both
are required: every process that loads ONNX Runtime sets the variable first thing, and the
environment turns the option off.

Since #277 the library and the one environment of a process come from `native/onnx-runtime`;
the crates that run graphs take them from there and make none of their own.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / "native"

# The crate that loads the library and makes the environment, and the setter of the variable.
SHARED = "onnx-runtime"
SETTER = "astarot_onnx_runtime::disable_telemetry_for_process"
# The crates that run ONNX graphs through `ort`, with the library and environment of SHARED.
ORT_CRATES = ("ocr-runtime", "translate-onnx", "rvc-runtime")


def _sources(crate: str):
    return sorted((NATIVE / crate / "src").rglob("*.rs"))


def _first_statement(text: str, signature: str) -> str:
    body = text[text.index(signature):]
    code = re.sub(r"//[^\n]*", "", body[body.index("{") + 1:])
    return code.split(";", 1)[0]


def test_every_crate_using_ort_is_listed():
    users = sorted(path.parent.name for path in NATIVE.glob("*/Cargo.toml") if re.search(r"^ort\s*=", path.read_text(encoding="utf-8"), re.M))
    assert users == sorted((*ORT_CRATES, SHARED))


@pytest.mark.parametrize("crate", ORT_CRATES)
def test_every_crate_takes_the_environment_from_the_shared_crate(crate):
    manifest = (NATIVE / crate / "Cargo.toml").read_text(encoding="utf-8")
    assert re.search(r'^astarot-onnx-runtime\s*=\s*\{\s*path\s*=\s*"\.\./onnx-runtime"', manifest, re.M), crate
    for path in _sources(crate):
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"ort::init(?:_from)?\(|\.with_telemetry\(|EnvironmentBuilder", text), f"{path.relative_to(ROOT)} makes an environment of its own"


def test_only_the_shared_crate_turns_on_load_dynamic():
    # `ort` features are unified across a build; the shared crate decides from its own feature
    # whether the library is loaded at run time, so nobody else may switch `ort` over.
    for manifest in sorted(NATIVE.glob("*/Cargo.toml")):
        if manifest.parent.name != SHARED:
            assert '"ort/load-dynamic"' not in manifest.read_text(encoding="utf-8"), manifest.relative_to(ROOT)


def test_the_one_environment_turns_telemetry_off():
    text = (NATIVE / SHARED / "src" / "lib.rs").read_text(encoding="utf-8")
    builds = re.findall(r"with_name\([^;]*?\.build\(\)", text, re.S)
    assert builds, "no environment found in native/onnx-runtime; update this test"
    for build in builds:
        assert ".with_telemetry(false)" in build, build


@pytest.mark.parametrize("crate", ORT_CRATES)
def test_every_binary_sets_the_variable_first(crate):
    bins = sorted((NATIVE / crate / "src" / "bin").glob("*.rs"))
    assert bins, f"{crate}: no binaries found; update this test"
    for path in bins:
        first_statement = _first_statement(path.read_text(encoding="utf-8"), "fn main()")
        assert SETTER in first_statement, f"{path.relative_to(ROOT)} must call {SETTER} first"


def test_the_setter_sets_the_variable_onnx_runtime_reads():
    text = (NATIVE / SHARED / "src" / "lib.rs").read_text(encoding="utf-8")
    setter = re.search(r"pub unsafe fn disable_telemetry_for_process\(\) \{(.*?)\n\}", text, re.S)
    assert setter
    assert re.search(r'set_var\(DISABLE_TELEMETRY_VARIABLE, "1"\)', setter.group(1))
    assert 'DISABLE_TELEMETRY_VARIABLE: &str = "ORT_DISABLE_TELEMETRY"' in text


def test_the_app_sets_the_variable_before_anything_starts():
    text = (ROOT / "src-tauri" / "src" / "lib.rs").read_text(encoding="utf-8")
    first_statement = _first_statement(text, "pub fn run()")
    assert "astarot_core::shipped_libraries::disable_onnx_runtime_telemetry" in first_statement
    core = (NATIVE / "core" / "src" / "shipped_libraries.rs").read_text(encoding="utf-8")
    assert SETTER in core
