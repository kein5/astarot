"""tools/runtime_libraries.py: ONNX Runtime and the OpenVR client library for `_internal` (issue #509)."""
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import runtime_libraries  # noqa: E402


class RuntimeLibrariesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)

    def test_the_pins_are_those_of_the_rvc_runtime_and_uv_lock(self):
        rvc = (ROOT / "native/voice-conversion/src/runtime.rs").read_text(encoding="utf-8")
        self.assertIn(f'const ORT_VERSION: &str = "{runtime_libraries.ORT_VERSION}";', rvc)
        for key in ("onnxruntime-windows", "onnxruntime-linux"):
            archive = runtime_libraries.ARCHIVES[key]
            self.assertIn(f'{archive["size"]},', rvc.replace("\n", " ").replace("  ", " "), key)
            self.assertIn(archive["sha256"], rvc, key)
        lock = (ROOT / "uv.lock").read_text(encoding="utf-8")
        for key in ("openvr-windows", "openvr-linux"):
            archive = runtime_libraries.ARCHIVES[key]
            self.assertIn(f'{archive["url"]}", hash = "sha256:{archive["sha256"]}", size = {archive["size"]}', lock, key)

    def test_each_platform_ships_its_own_libraries_and_their_licenses(self):
        self.assertEqual(runtime_libraries.shipped("windows"), [
            "onnxruntime/onnxruntime.dll", "onnxruntime/onnxruntime_providers_shared.dll",
            "licenses/onnxruntime/LICENSE", "licenses/onnxruntime/ThirdPartyNotices.txt",
            "openvr/libopenvr_api_64.dll", "licenses/openvr/pyopenvr-LICENSE", "licenses/openvr/LICENSE"])
        self.assertEqual(runtime_libraries.shipped("linux"), [
            "onnxruntime/libonnxruntime.so", "onnxruntime/libonnxruntime_providers_shared.so",
            "licenses/onnxruntime/LICENSE", "licenses/onnxruntime/ThirdPartyNotices.txt",
            "openvr/libopenvr_api_64.so", "licenses/openvr/pyopenvr-LICENSE", "licenses/openvr/LICENSE"])

    def test_valves_license_is_kept_as_it_is_for_the_same_sdk_release(self):
        archive = runtime_libraries.ARCHIVES["openvr-license"]
        self.assertTrue(archive["url"].endswith("/ValveSoftware/openvr/v2.12.14/LICENSE"))
        data = b"Copyright (c) 2015, Valve Corporation"
        pinned = dict(archive, size=len(data), sha256=hashlib.sha256(data).hexdigest())
        self.assertEqual(runtime_libraries._members(data, pinned), {"LICENSE": data})

    def _wheel(self, extra=b""):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("openvr/libopenvr_api_64.dll", b"openvr" + extra)
            archive.writestr("openvr/libopenvr_api_32.dll", b"32-bit")
            archive.writestr("openvr-2.12.1401.dist-info/licenses/LICENSE", b"BSD-3-Clause")
        data = data.getvalue()
        return data, dict(runtime_libraries.ARCHIVES["openvr-windows"], url="https://example.invalid/w.whl",
                          size=len(data), sha256=hashlib.sha256(data).hexdigest())

    def test_only_the_listed_files_are_taken_from_a_verified_archive(self):
        data, archive = self._wheel()

        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        fetched = runtime_libraries.fetch(archive, self.base / "cache", opener=lambda url, timeout: Response(data))
        self.assertEqual(fetched.read_bytes(), data)
        files = runtime_libraries._members(runtime_libraries._read_verified(fetched, archive), archive)
        self.assertIn("openvr/libopenvr_api_32.dll", files)
        # A second fetch reuses the verified copy without downloading.
        self.assertEqual(runtime_libraries.fetch(archive, self.base / "cache", opener=None), fetched)

    def test_an_archive_that_does_not_match_its_pin_is_refused(self):
        data, archive = self._wheel()
        tampered, _ = self._wheel(extra=b"!")
        (self.base / "cache").mkdir()
        (self.base / "cache" / archive["name"]).write_bytes(tampered)
        with self.assertRaises(ValueError):
            runtime_libraries._read_verified(self.base / "cache" / archive["name"], archive)

    def test_staging_without_a_cached_archive_asks_for_the_download(self):
        with self.assertRaises(FileNotFoundError):
            runtime_libraries.stage("windows", self.base / "build", self.base / "empty-cache")


if __name__ == "__main__":
    unittest.main()
