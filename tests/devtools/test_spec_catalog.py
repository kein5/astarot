"""The functional specification's reference tables match the code."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools/spec_catalog.py"


def load_catalog():
    spec = importlib.util.spec_from_file_location("spec_catalog_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_into(module, out):
    printed = io.StringIO()
    with mock.patch.object(module, "OUT", out), mock.patch.object(sys, "argv", ["spec_catalog.py", "--write"]), \
            contextlib.redirect_stdout(printed):
        code = module.main()
    return code, printed.getvalue()


class SpecCatalogTests(unittest.TestCase):
    def test_reference_tables_are_current(self):
        run = subprocess.run([sys.executable, str(SCRIPT), "--check"], cwd=ROOT,
                             capture_output=True, text=True, timeout=60)
        self.assertEqual(run.returncode, 0, run.stderr or run.stdout)

    def test_every_table_lists_entries(self):
        reference = ROOT / "docs/spec/reference"
        for name, heading in (("ipc-endpoints.md", "## 要求"), ("error-codes.md", "## コード"),
                              ("config-keys.md", "## config.jsonに保存するキー")):
            text = (reference / name).read_text(encoding="utf-8")
            self.assertIn(heading, text, name)
            self.assertGreater(text.count("\n| `"), 10, name)

    def test_every_key_of_the_core_has_its_check_read(self):
        module = load_catalog()
        checks = module.schema_checks()
        keys = [entry["key"] for entry in module.core_catalog()["config"]]
        self.assertGreater(len(keys), 150)
        self.assertEqual(sorted(set(keys) - set(checks)), [])

    def test_the_checks_of_common_forms_are_put_in_words(self):
        module = load_catalog()
        cases = {
            "": "",
            "b()": "bool",
            "plain(Ty::Num)": "number",
            "int_in(0, 30)": "int（0〜30）",
            'one_of("TRAY_COMPANION_EDGE_LIST")': "str（`TRAY_COMPANION_EDGE_LIST`のどれか）",
            "managed(Ty::Str, false, |v, _| valid_saved_api_url(v))": "str、検証 `valid_saved_api_url`",
            "managed(Ty::Str, true, |v, ctx| { ctx.list(x).contains(v) })": "str か null、独自の検証",
            "managed(Ty::Dict, false, ocr_region)": "dict、検証 `ocr_region`",
            "validated(|v, _| voice_settings::load_direct(v))": "検証 `voice_settings::load_direct`",
            'overlay_log("OVERLAY_SMALL_LOG_SETTINGS")': "検証 `overlay_log`",
        }
        for expression, words in cases.items():
            self.assertEqual(module.describe_check(expression), words, expression)

    def test_write_uses_lf_and_skips_current_tables(self):
        module = load_catalog()
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "reference"
            code, printed = write_into(module, out)
            self.assertEqual(code, 0)
            self.assertEqual(printed.count("wrote "), len(module.CATALOGS))
            for name in module.CATALOGS:
                self.assertNotIn(b"\r\n", (out / name).read_bytes(), name)

            # A second run with nothing changed leaves the files alone.
            code, printed = write_into(module, out)
            self.assertEqual((code, printed), (0, ""))

            # A stale table is rewritten; the others are not touched.
            stale = out / "config-keys.md"
            stale.write_text("old\n", encoding="utf-8")
            code, printed = write_into(module, out)
            self.assertEqual(code, 0)
            self.assertEqual(printed.strip(), f"wrote {stale}")
            self.assertEqual(stale.read_text(encoding="utf-8"), module.CATALOGS["config-keys.md"]())


if __name__ == "__main__":
    unittest.main()
