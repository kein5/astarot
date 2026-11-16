"""The app's ASTAROT icons and in-app logos match docs/brand/astarot (tools/astarot_app_assets.py)."""
import importlib.util
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("astarot_app_assets", ROOT / "tools/astarot_app_assets.py")
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class AstarotAppAssetsTests(unittest.TestCase):
    def test_in_app_svgs_are_built_from_the_brand_paths(self):
        # Without Pillow: the SVGs and the copied icons only read and compare files.
        for path, data in assets.svgs().items():
            with self.subTest(path=path.name):
                self.assertEqual(path.read_bytes(), data, "run tools/astarot_app_assets.py")
                self.assertNotIn("style=", data.decode("utf-8"), "the app's CSP refuses style attributes")

    def test_icons_of_the_brand_set_are_copied_unchanged(self):
        for name, source in assets.COPIED.items():
            with self.subTest(name=name):
                self.assertEqual((assets.ICONS / name).read_bytes(), (assets.BRAND / source).read_bytes())

    def test_tauri_bundles_only_icons_this_tool_writes(self):
        conf = (ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8")
        bundled = re.findall(r'"icons/([^"]+)"', conf)
        written = set(assets.COPIED) | set(assets.SCALED) | {"icon.icns"}
        self.assertTrue(bundled)
        self.assertLessEqual(set(bundled), written)


if __name__ == "__main__":
    unittest.main()
