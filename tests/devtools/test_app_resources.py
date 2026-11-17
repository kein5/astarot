"""tools/app_resources.py: the files the packages ship in `_internal` without a Python backend."""
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import app_resources  # noqa: E402


def _build(base, platform):
    build = base / "build"
    exe = ".exe" if platform == "windows" else ""
    for bundle in app_resources.SPEECH_BUNDLES[platform]:
        (build / bundle / "notices").mkdir(parents=True)
        (build / bundle / f"speech{exe}").write_bytes(b"engine")
        (build / bundle / "bundle.json").write_text("{}")
        (build / bundle / "notices/LICENSE.txt").write_text("notice")
    (build / f"vrct-rvc-worker{exe}").write_bytes(b"worker")
    (build / "licenses/rust").mkdir(parents=True)
    (build / "licenses/rust/crates.json").write_text("[]")
    if platform == "linux":
        for name in app_resources.LINUX_HELPERS:
            (build / name).write_bytes(b"helper")
    for name in app_resources.runtime_libraries(platform):
        (build / name).parent.mkdir(parents=True, exist_ok=True)
        (build / name).write_bytes(b"library")
    return build


class AppResourcesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.output = self.base / "_internal"

    def test_windows_staging_has_everything_a_package_needs(self):
        (self.output / "stale").mkdir(parents=True)
        self.assertEqual(app_resources.stage(self.output, "windows", _build(self.base, "windows"), ROOT), [])
        self.assertFalse((self.output / "stale").exists(), "the folder is replaced, not merged")
        for name in app_resources.required("windows"):
            self.assertTrue((self.output / name).is_file(), name)
        self.assertTrue((self.output / "build/speechcpp/notices/LICENSE.txt").is_file())
        names = {path.relative_to(self.output).as_posix() for path in self.output.rglob("*") if path.is_file()}
        self.assertFalse([name for name in names if name.endswith((".pyd", ".pyc", ".py")) or "python" in name.lower()])

    def test_linux_staging_adds_the_helpers(self):
        self.assertEqual(app_resources.stage(self.output, "linux", _build(self.base, "linux"), ROOT), [])
        for name in app_resources.LINUX_HELPERS:
            self.assertTrue((self.output / "build" / name).is_file(), name)
        self.assertFalse((self.output / "licenses/nscurl").exists())

    def test_linux_ships_both_engine_builds_and_windows_the_vulkan_build_only(self):
        self.assertEqual(app_resources.stage(self.output, "linux", _build(self.base, "linux"), ROOT), [])
        for bundle in ("speechcpp", "speechcpp-cpu"):
            self.assertTrue((self.output / "build" / bundle / "notices/LICENSE.txt").is_file(), bundle)
        self.assertIn("build/speechcpp-cpu/speech", app_resources.required("linux"))
        self.assertFalse([name for name in app_resources.required("windows") if "speechcpp-cpu" in name])
        # A CPU build left in a Windows build folder is not shipped.
        build = _build(self.base / "windows", "windows")
        (build / "speechcpp-cpu").mkdir()
        (build / "speechcpp-cpu/speech.exe").write_bytes(b"engine")
        output = self.base / "windows_internal"
        app_resources.stage(output, "windows", build, ROOT)
        self.assertFalse((output / "build/speechcpp-cpu").exists())

    def test_a_linux_package_without_the_cpu_build_is_incomplete(self):
        build = _build(self.base, "linux")
        for file in (build / "speechcpp-cpu").rglob("*"):
            if file.is_file():
                file.unlink()
        absent = app_resources.stage(self.output, "linux", build, ROOT)
        self.assertEqual(absent, ["build/speechcpp-cpu/speech", "build/speechcpp-cpu/bundle.json"])

    def test_onnx_runtime_and_openvr_ship_where_the_core_looks(self):
        # native/core/src/shipped_libraries.rs; 0.5.0-beta.4 shipped neither (issue #509).
        self.assertIn("onnxruntime/onnxruntime.dll", app_resources.required("windows"))
        self.assertIn("openvr/libopenvr_api_64.dll", app_resources.required("windows"))
        self.assertIn("onnxruntime/libonnxruntime.so", app_resources.required("linux"))
        self.assertIn("openvr/libopenvr_api_64.so", app_resources.required("linux"))
        core = (ROOT / "native/core/src/shipped_libraries.rs").read_text(encoding="utf-8")
        for name in ("onnxruntime/onnxruntime.dll", "onnxruntime/libonnxruntime.so",
                     "openvr/libopenvr_api_64.dll", "openvr/libopenvr_api_64.so"):
            self.assertIn(f'"{name}"', core)
        build = _build(self.base, "windows")
        (build / "onnxruntime/onnxruntime.dll").unlink()
        (build / "openvr/libopenvr_api_64.dll").unlink()
        absent = app_resources.stage(self.output, "windows", build, ROOT)
        self.assertEqual(absent, ["onnxruntime/onnxruntime.dll", "openvr/libopenvr_api_64.dll"])

    def test_a_missing_engine_is_reported(self):
        build = self.base / "build"
        build.mkdir()
        absent = app_resources.stage(self.output, "windows", build, ROOT)
        self.assertIn("build/speechcpp/speech.exe", absent)
        self.assertIn("build/vrct-rvc-worker.exe", absent)
        self.assertEqual(app_resources.main(["--platform", "windows", "check", str(self.output)]), 1)


if __name__ == "__main__":
    unittest.main()
