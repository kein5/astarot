"""The Windows VR overlay finds the VR panel by its exact window title."""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]


class VrPanelTitleTests(unittest.TestCase):
    def test_the_rust_overlay_looks_for_the_title_rust_gives_the_window(self):
        # Since 0.5.0 the overlay in native/vr-overlay finds the panel with FindWindowW.
        rust = (ROOT / "src-tauri/src/lib.rs").read_text(encoding="utf-8")
        rust_title = re.search(r'\.title\("([^"]+)"\)', rust[rust.index('"vr_panel"'):]).group(1)
        surface = (ROOT / "native/vr-overlay/src/surface.rs").read_text(encoding="utf-8")
        overlay_title = re.search(r'pub const VR_PANEL_TITLE: &str = "([^"]+)";', surface).group(1)
        self.assertEqual(overlay_title, rust_title)
        # The display name (Issue #535); the window is not shown, but it is the name tools list.
        self.assertTrue(rust_title.startswith("ASTAROT "))

    def test_document_title_matches_the_window(self):
        html = (ROOT / "src-ui/vr.html").read_text(encoding="utf-8")
        rust = (ROOT / "src-tauri/src/lib.rs").read_text(encoding="utf-8")
        rust_title = re.search(r'\.title\("([^"]+)"\)', rust[rust.index('"vr_panel"'):]).group(1)
        self.assertIn(f"<title>{rust_title}</title>", html)


if __name__ == "__main__":
    unittest.main()
