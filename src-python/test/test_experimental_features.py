"""Experimental features (Issue #361): every one is off until the user turns it on.

The list of features is empty until one graduates from the experimental branch, so these tests
register made-up ids for their own run. The last test keeps the backend's list, the UI's and the
Rust core's equal.
"""
import re
import unittest
from pathlib import Path
from unittest.mock import patch

from config import config
from controller import Controller
from errors import ErrorCode
from models import experimental_features

ROOT = Path(__file__).resolve().parents[2]
UI_REGISTRY = ROOT / "src-ui" / "logics" / "configs" / "experimentalFeatures.js"
RUST_SCHEMA = ROOT / "native" / "core" / "src" / "config" / "schema.rs"

FAKE_IDS = ("first_trial", "second_trial")


class NormalizeTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.object(experimental_features, "FEATURE_IDS", FAKE_IDS)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_every_feature_is_off_by_default(self) -> None:
        self.assertEqual(experimental_features.defaults(), {"first_trial": False, "second_trial": False})

    def test_a_feature_left_out_keeps_its_value(self) -> None:
        current = {"first_trial": True, "second_trial": False}
        self.assertEqual(experimental_features.normalize({"second_trial": True}, current),
                         {"first_trial": True, "second_trial": True})

    def test_an_unknown_id_is_dropped(self) -> None:
        # A saved file may still name a feature that graduated or was removed.
        result = experimental_features.normalize({"graduated_long_ago": True, "first_trial": True}, {})
        self.assertEqual(result, {"first_trial": True, "second_trial": False})

    def test_a_value_that_is_not_a_bool_refuses_the_request(self) -> None:
        for value in (1, "true", None, [True]):
            with self.subTest(value=value):
                self.assertIsNone(experimental_features.normalize({"first_trial": value}, {}))

    def test_something_that_is_not_a_dict_is_refused(self) -> None:
        for value in (None, [], "first_trial", True):
            with self.subTest(value=value):
                self.assertIsNone(experimental_features.normalize(value, {}))

    def test_is_enabled_needs_a_listed_feature_set_to_true(self) -> None:
        values = {"first_trial": True, "second_trial": False, "unlisted": True}
        self.assertTrue(experimental_features.is_enabled(values, "first_trial"))
        self.assertFalse(experimental_features.is_enabled(values, "second_trial"))
        self.assertFalse(experimental_features.is_enabled(values, "unlisted"))
        self.assertFalse(experimental_features.is_enabled({}, "first_trial"))


class EndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.object(experimental_features, "FEATURE_IDS", FAKE_IDS)
        patcher.start()
        self.addCleanup(patcher.stop)
        self._original = config.EXPERIMENTAL_FEATURES
        self.addCleanup(setattr, config, "_EXPERIMENTAL_FEATURES", self._original)
        config.EXPERIMENTAL_FEATURES = {"first_trial": False, "second_trial": False}
        self.controller = Controller.__new__(Controller)

    def test_turning_one_feature_on_answers_every_feature(self) -> None:
        response = self.controller.setExperimentalFeatures({"first_trial": True})
        self.assertEqual(response, {"status": 200, "result": {"first_trial": True, "second_trial": False}})
        self.assertEqual(config.EXPERIMENTAL_FEATURES, {"first_trial": True, "second_trial": False})

    def test_a_bad_value_is_refused_and_nothing_changes(self) -> None:
        response = self.controller.setExperimentalFeatures({"first_trial": "on"})
        self.assertEqual(response["status"], 400)
        self.assertEqual(response["result"]["error_code"], ErrorCode.VALIDATION_CONFIG_VALUE_INVALID.value)
        self.assertEqual(config.EXPERIMENTAL_FEATURES, {"first_trial": False, "second_trial": False})

    def test_the_getter_answers_the_stored_values(self) -> None:
        config.EXPERIMENTAL_FEATURES = {"second_trial": True}
        self.assertEqual(self.controller.getExperimentalFeatures(None),
                         {"status": 200, "result": {"first_trial": False, "second_trial": True}})


def _quoted_ids(block: str) -> list[str]:
    block = re.sub(r"//[^\n]*", "", block)
    return re.findall(r'"([a-z0-9_]+)"', block)


class RegistryParityTests(unittest.TestCase):
    def test_the_backend_the_ui_and_the_rust_core_list_the_same_features(self) -> None:
        ui = UI_REGISTRY.read_text(encoding="utf-8")
        ui_block = ui.split("export const EXPERIMENTAL_FEATURES = Object.freeze([", 1)[1].split("]);", 1)[0]
        ui_ids = re.findall(r'\bid:\s*"([a-z0-9_]+)"', re.sub(r"//[^\n]*", "", ui_block))

        rust = RUST_SCHEMA.read_text(encoding="utf-8")
        rust_block = rust.split("pub const EXPERIMENTAL_FEATURE_IDS: &[&str] = &[", 1)[1].split("];", 1)[0]

        self.assertEqual(ui_ids, list(experimental_features.FEATURE_IDS))
        self.assertEqual(_quoted_ids(rust_block), list(experimental_features.FEATURE_IDS))

    def test_ids_are_unique_snake_case(self) -> None:
        ids = experimental_features.FEATURE_IDS
        self.assertEqual(len(ids), len(set(ids)))
        for feature_id in ids:
            self.assertRegex(feature_id, r"^[a-z][a-z0-9_]*$")


if __name__ == "__main__":
    unittest.main()
