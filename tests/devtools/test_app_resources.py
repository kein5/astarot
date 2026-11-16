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
    (build / "speechcpp/notices").mkdir(parents=True)
    (build / f"speechcpp/speech{exe}").write_bytes(b"engine")
    (build / "speechcpp/bundle.json").write_text("{}")
    (build / "speechcpp/notices/LICENSE.txt").write_text("notice")
    (build / f"vrct-rvc-worker{exe}").write_bytes(b"worker")
    (build / "licenses/rust").mkdir(parents=True)
    (build / "licenses/rust/crates.json").write_text("[]")
    if platform == "linux":
        for name in app_resources.LINUX_HELPERS:
            (build / name).write_bytes(b"helper")
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

    def test_a_missing_engine_is_reported(self):
        build = self.base / "build"
        build.mkdir()
        absent = app_resources.stage(self.output, "windows", build, ROOT)
        self.assertIn("build/speechcpp/speech.exe", absent)
        self.assertIn("build/vrct-rvc-worker.exe", absent)
        self.assertEqual(app_resources.main(["--platform", "windows", "check", str(self.output)]), 1)


if __name__ == "__main__":
    unittest.main()
