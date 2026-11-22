"""tools/native_acceptance.py decides what to run from the build and the flags at hand."""
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import native_acceptance as subject  # noqa: E402

# The plan writes paths into the environment as the OS spells them.
IMAGE, COPY, DEV = Path("/candidates/app.AppImage"), Path("/out/candidate.AppImage"), Path("/dev/vrct-vox")
ALL = {"ocr": "/m/ocr", "--vrchat": True, "kde": True, "xdotool": "/usr/bin/xdotool",
       "managed_route": True, "pw-record": "/usr/bin/pw-record"}


def args(**changes):
    values = dict(appimage=IMAGE, app=None, copy=COPY, driver=Path("/driver"), only=None)
    values.update(changes)
    return SimpleNamespace(**values)


def by_name(rows):
    return {name: (tests, env, reason) for name, tests, env, reason in rows}


class NativeAcceptancePlanTests(unittest.TestCase):
    def test_vrchat_is_not_started_unless_asked(self):
        """Without the flag and the OCR models only the app's own groups run; the round trip says what it lacks."""
        rows = by_name(subject.plan(args(), {}))
        self.assertEqual([name for name, row in rows.items() if row[2] is None], ["appimage", "ui"])
        self.assertEqual(rows["vrchat"][2], "missing: --vrchat, ocr")
        # The voice round trip also needs the PC's managed route; it never sets one up.
        self.assertEqual(rows["vrchat-voice"][2], "missing: --vrchat, ocr, managed_route, pw-record")
        # Quick Chat's group needs KDE and xdotool; without them it is skipped, not failed.
        self.assertEqual(rows["quick_chat"][2], "missing: kde, xdotool")

    def test_a_packaged_build_runs_the_image_itself(self):
        rows = by_name(subject.plan(args(), ALL))
        self.assertEqual(rows["appimage"][1]["ASTAROT_TEST_APPIMAGE"], str(IMAGE))
        for name in ("ui", "vrchat", "vrchat-voice", "quick_chat"):
            env = rows[name][1]
            self.assertEqual(env["ASTAROT_TEST_APP"], str(COPY), name)
            self.assertEqual(env["APPIMAGE_EXTRACT_AND_RUN"], "1", name)
        self.assertEqual(rows["quick_chat"][1]["ASTAROT_TEST_NATIVE_QUICK_CHAT"], "1")
        self.assertTrue(all(reason is None for _, _, reason in rows.values()))

    def test_a_development_build_is_not_treated_as_an_image(self):
        rows = by_name(subject.plan(args(appimage=None, app=DEV, copy=None), ALL))
        self.assertEqual(rows["appimage"][2], "needs --appimage")
        env = rows["ui"][1]
        self.assertEqual(env["ASTAROT_TEST_APP"], str(DEV))
        self.assertNotIn("ASTAROT_TEST_APPIMAGE", env)

    def test_only_limits_the_run_and_every_test_file_exists(self):
        rows = subject.plan(args(only=["vrchat"]), ALL)
        self.assertEqual([name for name, *_ in rows], ["vrchat"])
        for tests, *_ in subject.groups().values():
            for test in tests:
                self.assertTrue((ROOT / "tests/platform" / test).is_file(), test)


if __name__ == "__main__":
    unittest.main()
