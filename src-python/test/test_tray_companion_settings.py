"""The tray companion's own settings (experimental feature tray_companion): the screen edge its
hexagram hides at, and the monitor it shows on (src-tauri/src/companion.rs)."""
import unittest

from config import config
from controller import Controller
from errors import ErrorCode


class TrayCompanionSettingsTests(unittest.TestCase):
    def setUp(self) -> None:
        for name in ("TRAY_COMPANION_EDGE", "TRAY_COMPANION_MONITOR"):
            self.addCleanup(setattr, config, f"_{name}", getattr(config, name))
        self.controller = Controller.__new__(Controller)

    def refused(self, response: dict) -> None:
        self.assertEqual(response["status"], 400)
        self.assertEqual(response["result"]["error_code"], ErrorCode.VALIDATION_CONFIG_VALUE_INVALID.value)

    def test_the_edge_is_one_of_the_four(self) -> None:
        for edge in ("right", "left", "top", "bottom"):
            with self.subTest(edge=edge):
                self.assertEqual(self.controller.setTrayCompanionEdge(edge), {"status": 200, "result": edge})
        self.refused(self.controller.setTrayCompanionEdge("middle"))
        self.assertEqual(config.TRAY_COMPANION_EDGE, "bottom")

    def test_the_monitor_is_a_name_or_empty_for_the_primary_one(self) -> None:
        for name in ("", "\\\\.\\DISPLAY2", "HDMI-1"):
            with self.subTest(name=name):
                self.assertEqual(self.controller.setTrayCompanionMonitor(name), {"status": 200, "result": name})
        for bad in ("a\nb", "x" * 257, 2):
            with self.subTest(bad=bad):
                self.refused(self.controller.setTrayCompanionMonitor(bad))
        self.assertEqual(config.TRAY_COMPANION_MONITOR, "HDMI-1")
        self.assertEqual(self.controller.getTrayCompanionMonitor(None), {"status": 200, "result": "HDMI-1"})


if __name__ == "__main__":
    unittest.main()
