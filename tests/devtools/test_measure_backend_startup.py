"""tools/measure_backend_startup.py: the size split of the 0.4.0 sidecar package and of a package
without the sidecar, and which backends each one starts. No backend is started here."""
import argparse
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import measure_backend_startup as mbs  # noqa: E402


def write(root: Path, name: str, size: int) -> None:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)


class SizeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.package = Path(self.temp.name) / "pkg"

    def tearDown(self):
        self.temp.cleanup()

    def test_the_sidecar_package_keeps_its_old_report(self):
        for name, size in [("vrct-vox.exe", 10), ("vrct-vox-sidecar.exe", 20), ("_internal/build/speechcpp/speech.exe", 30),
                           ("_internal/sudachi/system.dic", 40), ("_internal/silero.onnx", 5), ("_internal/fonts/a.ttf", 6),
                           ("_internal/python311.dll", 7), ("weights/w.bin", 8)]:
            write(self.package, name, size)
        self.assertTrue(mbs.has_sidecar(self.package))
        report = mbs.size_report(self.package, None)
        self.assertEqual(list(report), ["package_bytes", "parts", "largest_in_internal"])
        self.assertEqual(report["parts"], {"app_exe": 10, "sidecar_exe": 20, "speechcpp": 30, "dictionaries": 40,
                                           "bundled_models": 5, "fonts": 6, "python_runtime": 7, "other_folders": 8})
        self.assertEqual(report["package_bytes"], 126)

    def test_a_package_without_the_sidecar_is_split_by_the_new_layout(self):
        for name, size in [("vrct-vox.exe", 10), ("onnxruntime.dll", 11), ("DirectML.dll", 12),
                           ("_internal/build/speechcpp/speech.exe", 30), ("_internal/build/speechcpp/notices/a.txt", 1),
                           ("_internal/build/astarot-rvc-worker.exe", 13), ("_internal/licenses/VRCT/LICENSE", 2),
                           ("_internal/licenses/rust/crates.json", 3), ("_internal/fonts/a.otf", 6),
                           ("_internal/build/other.bin", 4), ("weights/w.bin", 8)]:
            write(self.package, name, size)
        zip_path = Path(self.temp.name) / "VRCT-VOX.zip"
        zip_path.write_bytes(b"z" * 9)
        self.assertFalse(mbs.has_sidecar(self.package))
        report = mbs.core_size_report(self.package, zip_path)
        self.assertEqual(report["layout"], "core")
        self.assertEqual(report["parts"], {"app_exe": 10, "onnx_runtime": 23, "speechcpp": 31, "rvc_worker": 13,
                                           "licenses": 5, "fonts": 6, "other_internal": 4, "other_top_level": 0,
                                           "other_folders": 8})
        self.assertEqual(report["package_bytes"], 100)
        self.assertEqual(report["zip_bytes"], 9)
        self.assertNotIn("warnings", report)

    def test_python_files_left_in_a_package_without_the_sidecar_are_warned_about(self):
        for name in ("vrct-vox.exe", "_internal/base_library.zip", "_internal/python311.dll", "_internal/x/_ssl.pyd",
                     "_internal/build/speechcpp/speech.exe"):
            write(self.package, name, 1)
        warnings = mbs.core_size_report(self.package, None)["warnings"]
        self.assertEqual(len(warnings), 3, warnings)
        self.assertTrue(all("Python runtime file" in w for w in warnings))


class StartupTests(unittest.TestCase):
    def run_measure(self, package: Path, work: Path):
        args = argparse.Namespace(package=package, core_example=Path("startup_time.exe"), work=work, runs=2,
                                  zip=None, skip_startup=False)
        with mock.patch.object(mbs, "sidecar_runs", return_value=[2.0, 1.0]) as sidecar, \
                mock.patch.object(mbs, "core_runs", return_value=[0.5, 0.25]) as core:
            report = mbs.measure(args, argparse.ArgumentParser())
        return report, sidecar, core

    def test_only_the_core_starts_when_there_is_no_sidecar(self):
        with tempfile.TemporaryDirectory() as temp:
            package = Path(temp) / "pkg"
            write(package, "vrct-vox.exe", 1)
            report, sidecar, core = self.run_measure(package, Path(temp) / "work")
        sidecar.assert_not_called()
        core.assert_called_once()
        self.assertEqual(list(report["startup_seconds"]), ["core"])
        self.assertEqual(report["startup_seconds"]["core"]["first"], 0.5)

    def test_the_sidecar_package_starts_both_sidecar_first(self):
        with tempfile.TemporaryDirectory() as temp:
            package = Path(temp) / "pkg"
            write(package, "vrct-vox.exe", 1)
            write(package, "vrct-vox-sidecar.exe", 1)
            write(package, "_internal/python311.dll", 1)
            report, sidecar, core = self.run_measure(package, Path(temp) / "work")
        sidecar.assert_called_once()
        self.assertEqual(list(report["startup_seconds"]), ["sidecar", "core"])
        self.assertNotIn("layout", report["size"])


if __name__ == "__main__":
    unittest.main()
