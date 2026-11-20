"""Run the native GUI acceptance tests against a built app.

    python tools/native_acceptance.py --appimage path/to/VRCT-VOX.AppImage
    python tools/native_acceptance.py --app src-tauri/target/debug/vrct-vox --only ui
    python tools/native_acceptance.py --app ... --vrchat

These tests are not part of `dev.py check`: they open the real app on this desktop. Each group runs
in its own pytest process under tools/display_power_guard.py (a sleeping display stops drawing).

--vrchat starts the chatbox lab's two local VRChat clients (a hidden local instance), runs the
round trip, and stops the clients it started. It reads the chat with the OCR models in
VRCT_TEST_OCR_MODELS (default ~/.cache/vrct-vox-chatbox-lab/models); without them the group is
reported as skipped.

Until 0.6.0 this also fetched the models and runtimes of the voice, speech and recognition groups
with the Python backend's downloader and installer, and synthesized their input with its TTS. Those
groups drove the app's audio through the Python backend's PipeWire modules and went with it (#285).
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PLATFORM = "tests/platform/"


def groups():
    """name -> (tests, extra environment, needs, kind). kind: "any" or "packaged"."""
    on = "1"
    return {
        "appimage": (["test_appimage.py"], {"VRCT_TEST_APPIMAGE_FUSE": on, "VRCT_TEST_NATIVE_ROUTE": on}, [], "packaged"),
        "ui": (["test_native_ui.py", "test_native_tts_settings.py"], {"VRCT_TEST_NATIVE_ROUTE": on}, [], "any"),
        "vrchat": (["test_native_vrchat_roundtrip.py"], {"VRCT_TEST_NATIVE_VRCHAT_ROUNDTRIP": on}, ["--vrchat", "ocr"], "any"),
    }


def assets(args):
    """need -> path or flag for everything that exists now."""
    have = {}
    ocr = Path(os.environ.get("VRCT_TEST_OCR_MODELS", Path.home() / ".cache/vrct-vox-chatbox-lab/models"))
    have["ocr"] = ocr if ocr.is_dir() else None
    have["--vrchat"] = args.vrchat or None
    return {need: value for need, value in have.items() if value}


def plan(args, have):
    """[(name, tests, environment, skip reason or None)] for the chosen build. Pure: it starts nothing."""
    packaged = bool(args.appimage)
    rows = []
    for name, (tests, extra, needs, kind) in groups().items():
        if args.only and name not in args.only:
            continue
        missing = [need for need in needs if need not in have]
        reason = None
        if kind == "packaged" and not packaged:
            reason = "needs --appimage"
        elif missing:
            reason = "missing: " + ", ".join(missing)
        env = {"VRCT_TEST_NATIVE_GUI": "1", "VRCT_TEST_DRIVER": str(args.driver), **extra}
        if name == "appimage":
            env["VRCT_TEST_APPIMAGE"] = str(args.appimage)
        else:
            env["VRCT_TEST_APP"] = str(args.copy if packaged else args.app)
            if packaged:
                env.update(VRCT_TEST_APPIMAGE="1", APPIMAGE_EXTRACT_AND_RUN="1")
        rows.append((name, [PLATFORM + test for test in tests], env, reason))
    return rows


def counts(report):
    """(passed, failed, skipped) from a JUnit report, or None if pytest did not get that far."""
    try:
        suite = ET.parse(report).getroot()
    except (OSError, ET.ParseError):
        return None
    suite = suite if suite.tag == "testsuite" else suite.find("testsuite")
    tests, failed, skipped = (int(suite.get(key, 0)) for key in ("tests", "failures", "skipped"))
    failed += int(suite.get("errors", 0))
    return tests - failed - skipped, failed, skipped


def run_group(args, name, tests, env):
    out = args.output / name
    out.mkdir(parents=True, exist_ok=True)
    report = out / "junit.xml"
    command = ["python3", str(ROOT / "tools/display_power_guard.py"), "--", str(args.python), "-m", "pytest",
               "-c", "tests/voice/pytest.ini", *tests, "-q", "-rs", "--tb=short", f"--basetemp={out / 'tmp'}",
               f"--junitxml={report}"]
    with (out / "pytest.log").open("w") as log:
        code = subprocess.run(command, cwd=ROOT, env={**os.environ, **env}, stdout=log, stderr=subprocess.STDOUT,
                              timeout=args.timeout).returncode
    return code, counts(report)


class VRChat:
    """The chatbox lab's two local clients, started here unless they already run."""

    def __init__(self, args):
        self.args, self.started = args, False

    def __enter__(self):
        sys.path.insert(0, str(ROOT / "tests/platform"))
        import native_vrchat_lab as lab

        if not lab.ready():
            subprocess.run([sys.executable, str(ROOT / "tools/chatbox_lab/launch_clients.py"), "--clients", "2"],
                           cwd=ROOT, check=True, timeout=300)
            self.started = True
            deadline = time.monotonic() + 240
            while not lab.ready():
                if time.monotonic() > deadline:
                    raise SystemExit("the VRChat lab clients did not show their windows in time")
                time.sleep(3)
            time.sleep(20)  # both must have finished joining the world before a bubble can be seen
        return self

    def __exit__(self, *exc):
        if self.started:
            subprocess.run([sys.executable, str(ROOT / "tools/chatbox_lab/launch_clients.py"), "--stop"], cwd=ROOT, timeout=120)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    build = parser.add_mutually_exclusive_group(required=True)
    build.add_argument("--appimage", type=Path, help="a candidate or published AppImage")
    build.add_argument("--app", type=Path, help="a development build (src-tauri/target/debug/vrct-vox)")
    parser.add_argument("--only", action="append", choices=sorted(groups()), help="run only this group (repeatable)")
    parser.add_argument("--vrchat", action="store_true", help="start two local VRChat clients and run the round trip")
    parser.add_argument("--output", type=Path, default=ROOT / "build/native-acceptance")
    parser.add_argument("--python", type=Path, default=Path(sys.executable), help="the Python that runs pytest (default: this one)")
    parser.add_argument("--driver", type=Path, default=Path(os.environ.get("VRCT_TEST_DRIVER", ROOT / "tmp/tauri-driver/bin/tauri-driver")))
    parser.add_argument("--timeout", type=int, default=1800, help="seconds for one group")
    args = parser.parse_args(argv)
    build = (args.appimage or args.app).resolve()
    if not build.is_file():
        parser.error(f"not found: {build}")
    args.appimage, args.app = (build, None) if args.appimage else (None, build)
    shutil.rmtree(args.output, ignore_errors=True)
    args.output.mkdir(parents=True)
    args.copy = None
    if args.appimage:
        # The other groups run the image directly; keep the candidate itself read-only and untouched.
        args.copy = args.output / "candidate.AppImage"
        shutil.copyfile(args.appimage, args.copy)
        args.copy.chmod(0o755)
    have = assets(args)

    results, failed = [], False
    rows = plan(args, have)
    lab = VRChat(args) if any(name == "vrchat" and not reason for name, _, _, reason in rows) else None
    for name, tests, env, reason in rows:
        if reason:
            results.append({"group": name, "result": "skipped", "reason": reason})
            print(f"{name:10} skipped  {reason}", flush=True)
            continue
        started = time.monotonic()
        try:
            if name == "vrchat":
                with lab:
                    code, tally = run_group(args, name, tests, env)
            else:
                code, tally = run_group(args, name, tests, env)
        except subprocess.TimeoutExpired:
            code, tally = 1, None
        row = {"group": name, "result": "passed" if code == 0 else "failed", "seconds": round(time.monotonic() - started),
               "log": str(args.output / name / "pytest.log")}
        if tally:
            row.update(passed=tally[0], failed=tally[1], skipped=tally[2])
        failed |= code != 0
        results.append(row)
        detail = f"{tally[0]} passed, {tally[1]} failed, {tally[2]} skipped" if tally else "no report (see the log)"
        print(f"{name:10} {row['result']:8} {detail}  {row['seconds']} s", flush=True)
    summary = {"build": str(build), "packaged": bool(args.appimage), "groups": results}
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"report: {args.output / 'summary.json'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
