"""Baseline numbers for the move from the Python sidecar to the Rust core (#285).

Two measurements of an extracted Windows package (the folder that holds vrct-vox.exe):

- size: the package on disk, split into the parts the move keeps or drops
- startup: seconds from starting a backend to its /run/initialization_complete, for the
  Python sidecar (vrct-vox-sidecar.exe, a child process as the app starts it) and for the core
  (native/core/examples/startup_time.rs, which calls Backend::start inside its own process
  with the app's Environment, as the app does)

A package without vrct-vox-sidecar.exe (0.5.0 and later, the layout of tools/app_resources.py)
is measured the same way without the sidecar: the size report splits it into the app, ONNX
Runtime beside it, speech.cpp, the RVC worker, licenses, fonts and the rest of _internal, and
warns about Python runtime files left in it; only the core is started. The real app is never
started (it needs a display and a WebView).

Each backend gets its own empty settings folder. The settings turn off what would reach the
network or the user's devices at start-up: model downloads, update checks, usage events,
OSC to VRChat. Nothing is downloaded and no request is sent.

    python tools/measure_backend_startup.py --package <dir> --core-example <startup_time.exe> \
        --work <empty folder> --runs 5 [--zip <VRCT-VOX.zip>]

Prints a JSON report. Only times and sizes are printed; no setting, log line or message.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

INIT = '"/run/initialization_complete"'
MODEL_SUFFIXES = {".onnx", ".bin", ".gguf", ".safetensors", ".pt", ".pth", ".ort"}

# Settings that keep start-up local: no download, no update check, no usage events, no OSC
# to VRChat (and so no mDNS on every interface).
QUIET_SETTINGS = {
    "AUTO_DOWNLOAD_MODELS": False,
    "CHECK_SOFTWARE_UPDATES": False,
    "ENABLE_TELEMETRY": False,
    "TELEMETRY_NOTICE": 1,
    "SEND_MESSAGE_TO_VRC": False,
    "OSC_IP_ADDRESS": "127.0.0.2",
    "VRC_MIC_MUTE_SYNC": False,
}


def folder_bytes(path: Path) -> int:
    total = 0
    for current, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += (Path(current) / name).lstat().st_size
            except OSError:
                pass
    return total


def size_report(package: Path, archive: Path | None) -> dict:
    internal = package / "_internal"
    parts = {
        "app_exe": 0,            # vrct-vox.exe and other top-level files of the app
        "sidecar_exe": 0,        # vrct-vox-sidecar.exe
        "speechcpp": 0,          # _internal/build: the speech.cpp bundle the core also starts
        "dictionaries": 0,       # *.dic (Sudachi, for the kana and romaji conversion)
        "bundled_models": 0,     # model files inside _internal
        "fonts": 0,              # *.ttf, *.otf
        "python_runtime": 0,     # everything else in _internal: interpreter and libraries
        "other_folders": 0,      # top-level folders besides _internal (downloaded weights...)
    }
    for entry in package.iterdir():
        if entry.is_file():
            parts["sidecar_exe" if entry.name.startswith("vrct-vox-sidecar") else "app_exe"] += entry.stat().st_size
        elif entry.name != "_internal":
            parts["other_folders"] += folder_bytes(entry)
    for current, _dirs, files in os.walk(internal):
        here = Path(current)
        in_build = here == internal / "build" or (internal / "build") in here.parents
        for name in files:
            path = here / name
            size = path.lstat().st_size
            suffix = path.suffix.lower()
            if in_build:
                parts["speechcpp"] += size
            elif suffix == ".dic":
                parts["dictionaries"] += size
            elif suffix in MODEL_SUFFIXES:
                parts["bundled_models"] += size
            elif suffix in (".ttf", ".otf"):
                parts["fonts"] += size
            else:
                parts["python_runtime"] += size
    report = {"package_bytes": sum(parts.values()), "parts": parts}
    return _finish(report, internal, archive)


def _finish(report: dict, internal: Path, archive: Path | None) -> dict:
    entries = internal.iterdir() if internal.is_dir() else []
    largest = sorted(((folder_bytes(p) if p.is_dir() else p.stat().st_size, p.name) for p in entries), reverse=True)
    report["largest_in_internal"] = [{"name": name, "bytes": size} for size, name in largest[:10]]
    if archive is not None:
        report["zip_bytes"] = archive.stat().st_size
    return report


SIDECAR = "vrct-vox-sidecar.exe"
APP_EXE = ("vrct-vox.exe", "vrct-vox")
ONNX_RUNTIME = ("onnxruntime", "directml")
RVC_WORKER = ("astarot-rvc-worker.exe", "astarot-rvc-worker")


def has_sidecar(package: Path) -> bool:
    """The 0.4.0 layout ships the Python sidecar beside the app; 0.5.0 does not."""
    return (package / SIDECAR).is_file()


def is_python_leftover(path: Path) -> bool:
    """Files of a frozen Python runtime, which a package without the sidecar must not carry."""
    name = path.name.lower()
    return (path.suffix.lower() in (".pyd", ".pyc", ".pyz") or name == "base_library.zip"
            or (name.startswith("python3") and name.endswith((".dll", ".so")) or name.startswith("libpython3")))


def core_size_report(package: Path, archive: Path | None) -> dict:
    """Sizes of a package without the Python sidecar (the layout of tools/app_resources.py)."""
    internal = package / "_internal"
    parts = {
        "app_exe": 0,            # vrct-vox.exe: the app and the core
        "onnx_runtime": 0,       # onnxruntime*.dll / DirectML.dll beside the app, when linked dynamically
        "speechcpp": 0,          # _internal/build/speechcpp
        "rvc_worker": 0,         # _internal/build/astarot-rvc-worker.exe
        "licenses": 0,           # _internal/licenses
        "fonts": 0,              # *.ttf, *.otf anywhere
        "other_internal": 0,     # anything else in _internal
        "other_top_level": 0,    # other top-level files besides the app
        "other_folders": 0,      # top-level folders besides _internal (downloaded weights...)
    }
    leftovers = []

    def font(path: Path) -> bool:
        return path.suffix.lower() in (".ttf", ".otf")

    for entry in package.iterdir():
        if entry.is_file():
            name = entry.name.lower()
            size = entry.stat().st_size
            if font(entry):
                parts["fonts"] += size
            elif name in APP_EXE:
                parts["app_exe"] += size
            elif name.startswith(ONNX_RUNTIME) and (name.endswith((".dll", ".so")) or ".so." in name):
                parts["onnx_runtime"] += size
            else:
                parts["other_top_level"] += size
            if is_python_leftover(entry):
                leftovers.append(entry.name)
        elif entry.name != "_internal":
            parts["other_folders"] += folder_bytes(entry)
    for current, _dirs, files in os.walk(internal):
        here = Path(current)
        relative = here.relative_to(internal).parts
        for name in files:
            path = here / name
            size = path.lstat().st_size
            if is_python_leftover(path):
                leftovers.append(path.relative_to(package).as_posix())
            if font(path):
                parts["fonts"] += size
            elif relative[:2] == ("build", "speechcpp"):
                parts["speechcpp"] += size
            elif relative == ("build",) and name.lower() in RVC_WORKER:
                parts["rvc_worker"] += size
            elif relative[:1] == ("licenses",):
                parts["licenses"] += size
            else:
                parts["other_internal"] += size
    report = {"layout": "core", "package_bytes": sum(parts.values()), "parts": parts}
    if leftovers:
        report["warnings"] = [f"Python runtime file in a package without the sidecar: {name}" for name in sorted(leftovers)]
    return _finish(report, internal, archive)


def settings_folder(work: Path, name: str) -> Path:
    folder = work / name
    folder.mkdir(parents=True, exist_ok=False)
    (folder / "config.json").write_text(json.dumps(QUIET_SETTINGS), encoding="utf-8")
    return folder


def hidden() -> dict:
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NO_WINDOW}
    return {}


def stop(process: subprocess.Popen) -> None:
    if process.poll() is None:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True, **hidden())
        else:
            process.kill()
    process.wait(timeout=30)


def sidecar_runs(package: Path, work: Path, runs: int) -> list[float]:
    config = settings_folder(work, "sidecar")
    env = dict(os.environ, VRCT_CONFIG_DIR=str(config), VRCT_TELEMETRY="off")
    times = []
    for _ in range(runs):
        started = time.perf_counter()
        process = subprocess.Popen([str(package / "vrct-vox-sidecar.exe")], cwd=package, env=env,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   text=True, encoding="utf-8", errors="replace", **hidden())
        try:
            for line in process.stdout:
                if INIT in line:
                    times.append(time.perf_counter() - started)
                    break
            else:
                raise RuntimeError("the sidecar ended before start-up ended")
        finally:
            stop(process)
        time.sleep(2)
    return times


def core_runs(example: Path, package: Path, work: Path, runs: int) -> list[float]:
    config = settings_folder(work, "core")
    env = dict(os.environ, VRCT_TELEMETRY="off")
    result = subprocess.run([str(example), "--app-dir", str(package), "--config-dir", str(config), "--runs", str(runs)],
                            env=env, capture_output=True, text=True, timeout=180 * runs, check=True, **hidden())
    return [json.loads(line)["seconds"] for line in result.stdout.splitlines() if line.startswith("{")]


def summary(times: list[float]) -> dict:
    return {
        "runs": [round(t, 3) for t in times],
        "first": round(times[0], 3),
        "median_after_first": round(statistics.median(times[1:]), 3) if len(times) > 1 else None,
        "min": round(min(times), 3),
        "max": round(max(times), 3),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--core-example", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True, help="an empty folder for the settings of the runs")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--zip", type=Path)
    parser.add_argument("--skip-startup", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(measure(args, parser), indent=2))
    return 0


def measure(args, parser) -> dict:
    sidecar = has_sidecar(args.package)
    report = {"size": size_report(args.package, args.zip) if sidecar else core_size_report(args.package, args.zip)}
    if not args.skip_startup:
        args.work.mkdir(parents=True, exist_ok=True)
        if any(args.work.iterdir()):
            parser.error("--work must be empty")
        if sidecar:
            # The sidecar first: its first run reads the package from disk cold, as a first launch does.
            report["startup_seconds"] = {
                "sidecar": summary(sidecar_runs(args.package, args.work, args.runs)),
                "core": summary(core_runs(args.core_example, args.package, args.work, args.runs)),
            }
        else:
            # No sidecar to start. The core's first run is now the cold one. The real app is not
            # started: it opens windows and a WebView, which this headless measurement avoids.
            report["startup_seconds"] = {
                "core": summary(core_runs(args.core_example, args.package, args.work, args.runs)),
            }
    return report


if __name__ == "__main__":
    sys.exit(main())
