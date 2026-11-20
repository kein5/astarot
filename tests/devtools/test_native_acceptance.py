"""tools/native_acceptance.py decides what to run from the build and the flags at hand."""
from pathlib import Path
from types import SimpleNamespace
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import native_acceptance as subject  # noqa: E402


def args(**changes):
    values = dict(appimage=Path("/candidates/app.AppImage"), app=None, copy=Path("/out/candidate.AppImage"),
                  driver=Path("/driver"), only=None)
    values.update(changes)
    return SimpleNamespace(**values)


def by_name(rows):
    return {name: (tests, env, reason) for name, tests, env, reason in rows}


ALL = {"ocr": "/m/ocr", "--vrchat": True}


def test_vrchat_is_not_started_unless_asked():
    """Without the flag and the OCR models only the app's own groups run; the round trip says what it lacks."""
    rows = by_name(subject.plan(args(), {}))
    assert [name for name, row in rows.items() if row[2] is None] == ["appimage", "ui"]
    assert rows["vrchat"][2] == "missing: --vrchat, ocr"


def test_a_packaged_build_runs_the_image_itself():
    rows = by_name(subject.plan(args(), ALL))
    assert rows["appimage"][1]["ASTAROT_TEST_APPIMAGE"] == "/candidates/app.AppImage"
    for name in ("ui", "vrchat"):
        env = rows[name][1]
        assert env["ASTAROT_TEST_APP"] == "/out/candidate.AppImage" and env["APPIMAGE_EXTRACT_AND_RUN"] == "1", name
    assert all(reason is None for _, _, reason in rows.values())


def test_a_development_build_is_not_treated_as_an_image():
    rows = by_name(subject.plan(args(appimage=None, app=Path("/dev/vrct-vox"), copy=None), ALL))
    assert rows["appimage"][2] == "needs --appimage"
    env = rows["ui"][1]
    assert env["ASTAROT_TEST_APP"] == "/dev/vrct-vox" and "ASTAROT_TEST_APPIMAGE" not in env


def test_only_limits_the_run_and_every_test_file_exists():
    rows = subject.plan(args(only=["vrchat"]), ALL)
    assert [name for name, *_ in rows] == ["vrchat"]
    for tests, *_ in subject.groups().values():
        for test in tests:
            assert (ROOT / "tests/platform" / test).is_file(), test
