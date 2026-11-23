"""The Windows installer has the SHA-256 of the release package built in.

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
        self.package = self.folder / "VRCT-VOX.zip"
        self.package.write_bytes(b"package")
        self.include = self.folder / "package-hashes.nsh"

    def run_tool(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = tool.main([*args, "--include", str(self.include)])
        return code, out.getvalue() + err.getvalue()

    def test_write_builds_in_the_package_hash_and_check_accepts_it(self):
        self.assertEqual(self.run_tool("write", "--package", str(self.package))[0], 0)
        text = self.include.read_text(encoding="ascii")
        self.assertIn(f'!define PACKAGE_SHA256 "{hashlib.sha256(b"package").hexdigest()}"', text)
        self.assertNotIn("CPU", text)
        self.assertNotIn("GPU", text)
        self.assertNotIn("\r", text)
        code, output = self.run_tool("check", "--package", str(self.package))
        self.assertEqual(code, 0, output)

    def test_a_checksum_file_gives_the_same_hash(self):
        sidecar = self.folder / "VRCT-VOX.zip.sha256"
        sidecar.write_text(hashlib.sha256(b"package").hexdigest(), encoding="ascii")
        self.assertEqual(self.run_tool("write", "--package", str(sidecar))[0], 0)
        self.assertEqual(self.run_tool("check", "--package", str(self.package))[0], 0)

    def test_check_refuses_a_package_that_is_not_the_one_built_in(self):
        self.run_tool("write", "--package", str(self.package))
        self.package.write_bytes(b"rebuilt package")
        code, output = self.run_tool("check", "--package", str(self.package))
        self.assertEqual(code, 1)
        self.assertIn(hashlib.sha256(b"rebuilt package").hexdigest(), output)

    def test_a_bad_checksum_file_or_a_missing_include_stops_with_an_error(self):
        bad = self.folder / "bad.sha256"
        for content in ("", "not a hash", "A" * 64 + "Z"):
            bad.write_text(content, encoding="ascii")
            self.assertEqual(self.run_tool("write", "--package", str(bad))[0], 2, content)
        self.assertFalse(self.include.exists())
        self.assertEqual(self.run_tool("check", "--package", str(self.package))[0], 2)
        self.assertEqual(self.run_tool("write", "--package", str(self.folder / "missing.zip"))[0], 2)

    def test_an_include_of_the_two_packages_up_to_0_5_is_refused(self):
        value = hashlib.sha256(b"package").hexdigest()
        self.include.write_text(f'!define PACKAGE_SHA256_CPU "{value}"\n!define PACKAGE_SHA256_GPU "{value}"\n',
                                encoding="ascii")
        self.assertEqual(self.run_tool("check", "--package", str(self.package))[0], 1)

    def test_uppercase_checksum_files_are_read_in_the_installer_s_lowercase(self):
        sidecar = self.folder / "upper.sha256"
        sidecar.write_text(hashlib.sha256(b"package").hexdigest().upper() + "  VRCT-VOX.zip\n", encoding="ascii")
        self.assertEqual(tool.digest(sidecar), hashlib.sha256(b"package").hexdigest())


class TemplateTests(unittest.TestCase):
    def test_a_release_build_cannot_leave_the_hash_out(self):
        head = TEMPLATE.split('Name "${PRODUCTNAME}"', 1)[0]
        required = head.split('!if "$%ASTAROT_REQUIRE_PACKAGE_HASHES%" == "1"', 1)[1].split("!else", 1)[0]
        self.assertIn('!include "..\\..\\..\\..\\nsis\\package-hashes.nsh"', required)
        self.assertNotIn("/NONFATAL", required)
        self.assertIn("!ifndef PACKAGE_SHA256\n    !error", required)

    def test_own_version_uses_the_built_in_hash_before_any_checksum_download(self):
        built_in = TEMPLATE.index('StrCpy $expected_package_hash "${PACKAGE_SHA256}"')
        download = TEMPLATE.index('NScurl::http GET "$cmder_dl.sha256"')
        self.assertLess(built_in, download)
        branch = TEMPLATE[TEMPLATE.rindex("!ifdef PACKAGE_SHA256", 0, built_in):download]
        self.assertIn('${If} $effective_version == "${VERSION}"', branch)
        self.assertIn("Goto package_hash_ready", branch)
        # The same comparison that refuses a mismatching download covers both sources.
        self.assertIn("${If} $actual_package_hash != $expected_package_hash", TEMPLATE[download:])

    def test_there_is_one_package_and_no_edition_page(self):
        # Up to 0.5 a page chose the CPU or the GPU (CUDA) package; #288 dropped the CUDA package.
        self.assertNotIn("VRCT-VOX_cuda.zip\"", TEMPLATE)
        self.assertNotIn("PageChooseEdition", TEMPLATE)
        self.assertNotIn("$SelectedEdition", TEMPLATE)
        self.assertNotIn("PACKAGE_SHA256_GPU", TEMPLATE)
        self.assertEqual(TEMPLATE.count("!define SOFTWARE_DOWNLOAD_FILENAME "), 1)
        self.assertIn('StrCpy $file_name "${SOFTWARE_DOWNLOAD_FILENAME}"', TEMPLATE)

    def test_no_checksum_file_is_deleted_when_none_was_downloaded(self):
        for line in TEMPLATE.splitlines():
            if 'Delete "$package_hash_path"' in line and "$package_hash_path !=" not in line:
                # Only the download branch, after the path was set, deletes unconditionally.
                self.assertGreater(TEMPLATE.index(line), TEMPLATE.index('StrCpy $package_hash_path "$download_dir\\$file_name.sha256"'))

    def test_the_hash_file_is_never_committed(self):
        self.assertIn("src-tauri/nsis/package-hashes.nsh", (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines())


if __name__ == "__main__":
    unittest.main()
