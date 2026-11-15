"""The Windows installer has the SHA-256 of both release packages built in.

Real installs live in tests/installer/windows_update_scenarios.py (CI only): the installer's own
version is checked against the built-in hash, and a package replaced with its .sha256 is refused.
The build order in release.yml is checked in tests/voice/test_installer_build_order.py.
"""

import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import installer_package_hashes as tool  # noqa: E402

TEMPLATE = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")


class ToolTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.cpu = self.folder / "VRCT-VOX.zip"
        self.cpu.write_bytes(b"cpu package")
        self.gpu = self.folder / "VRCT-VOX_cuda.zip"
        self.gpu.write_bytes(b"cuda package")
        self.include = self.folder / "package-hashes.nsh"

    def run_tool(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = tool.main([*args, "--include", str(self.include)])
        return code, out.getvalue() + err.getvalue()

    def test_write_builds_in_the_package_hashes_and_check_accepts_them(self):
        sidecar = self.folder / "VRCT-VOX_cuda.zip.sha256"
        sidecar.write_text(hashlib.sha256(b"cuda package").hexdigest(), encoding="ascii")
        self.assertEqual(self.run_tool("write", "--cpu", str(self.cpu), "--gpu", str(sidecar))[0], 0)
        text = self.include.read_text(encoding="ascii")
        self.assertIn(f'!define PACKAGE_SHA256_CPU "{hashlib.sha256(b"cpu package").hexdigest()}"', text)
        self.assertIn(f'!define PACKAGE_SHA256_GPU "{hashlib.sha256(b"cuda package").hexdigest()}"', text)
        self.assertNotIn("\r", text)
        code, output = self.run_tool("check", "--cpu", str(self.cpu), "--gpu", str(self.gpu))
        self.assertEqual(code, 0, output)

    def test_check_refuses_a_package_that_is_not_the_one_built_in(self):
        self.run_tool("write", "--cpu", str(self.cpu), "--gpu", str(self.gpu))
        self.gpu.write_bytes(b"rebuilt cuda package")
        code, output = self.run_tool("check", "--cpu", str(self.cpu), "--gpu", str(self.gpu))
        self.assertEqual(code, 1)
        self.assertIn("GPU", output)
        self.assertNotIn("CPU", output.split("error:", 1)[1])

    def test_a_bad_checksum_file_or_a_missing_include_stops_with_an_error(self):
        bad = self.folder / "bad.sha256"
        for content in ("", "not a hash", "A" * 64 + "Z"):
            bad.write_text(content, encoding="ascii")
            self.assertEqual(self.run_tool("write", "--cpu", str(self.cpu), "--gpu", str(bad))[0], 2, content)
        self.assertFalse(self.include.exists())
        self.assertEqual(self.run_tool("check", "--cpu", str(self.cpu), "--gpu", str(self.gpu))[0], 2)
        self.assertEqual(self.run_tool("write", "--cpu", str(self.folder / "missing.zip"), "--gpu", str(self.gpu))[0], 2)

    def test_uppercase_checksum_files_are_read_in_the_installer_s_lowercase(self):
        sidecar = self.folder / "upper.sha256"
        sidecar.write_text(hashlib.sha256(b"cuda package").hexdigest().upper() + "  VRCT-VOX_cuda.zip\n", encoding="ascii")
        self.assertEqual(tool.digest(sidecar), hashlib.sha256(b"cuda package").hexdigest())


class TemplateTests(unittest.TestCase):
    def test_a_release_build_cannot_leave_the_hashes_out(self):
        head = TEMPLATE.split('Name "${PRODUCTNAME}"', 1)[0]
        required = head.split('!if "$%VRCT_REQUIRE_PACKAGE_HASHES%" == "1"', 1)[1].split("!else", 1)[0]
        self.assertIn('!include "..\\..\\..\\..\\nsis\\package-hashes.nsh"', required)
        self.assertNotIn("/NONFATAL", required)
        for name in ("PACKAGE_SHA256_CPU", "PACKAGE_SHA256_GPU"):
            self.assertIn(f"!ifndef {name}\n    !error", required)

    def test_own_version_uses_the_built_in_hash_before_any_checksum_download(self):
        built_in = TEMPLATE.index('StrCpy $expected_package_hash "${PACKAGE_SHA256_CPU}"')
        download = TEMPLATE.index('NScurl::http GET "$cmder_dl.sha256"')
        self.assertLess(built_in, download)
        branch = TEMPLATE[TEMPLATE.rindex("!ifdef PACKAGE_SHA256_CPU", 0, built_in):download]
        self.assertIn('${If} $effective_version == "${VERSION}"', branch)
        self.assertIn('StrCpy $expected_package_hash "${PACKAGE_SHA256_GPU}"', branch)
        self.assertIn("Goto package_hash_ready", branch)
        # The same comparison that refuses a mismatching download covers both sources.
        self.assertIn("${If} $actual_package_hash != $expected_package_hash", TEMPLATE[download:])

    def test_no_checksum_file_is_deleted_when_none_was_downloaded(self):
        for line in TEMPLATE.splitlines():
            if 'Delete "$package_hash_path"' in line and "$package_hash_path !=" not in line:
                # Only the download branch, after the path was set, deletes unconditionally.
                self.assertGreater(TEMPLATE.index(line), TEMPLATE.index('StrCpy $package_hash_path "$TEMP\\$file_name.sha256"'))

    def test_the_hash_file_is_never_committed(self):
        self.assertIn("src-tauri/nsis/package-hashes.nsh", (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines())


if __name__ == "__main__":
    unittest.main()
