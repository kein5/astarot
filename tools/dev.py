#!/usr/bin/env python3
"""VRCT-VOX developer commands. Python 3.11+, standard library only.

doctor/check never install dependencies or enable native/model/audio tests.
setup is the explicit dependency installation boundary; it does not install
system tools, register hooks, download models, or start the application.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tomllib


ROOT = Path(__file__).resolve().parents[1]
SCOPES = ("quick", "tooling", "node", "ui", "voice", "lint", "rust", "workflows", "crates", "links", "hooks", "vulns",
          "secrets", "commits", "all")
GROUPS = {"quick": ("tooling", "node", "lint"),
          "all": ("tooling", "node", "ui", "voice", "lint", "rust", "workflows", "crates", "links", "hooks")}
# Rust crates outside the Tauri app, each with its own Cargo.lock and tests.
NATIVE_CRATES = ("native/app-identity", "native/speech-server", "native/ops", "native/audio-routing", "native/adapters", "native/translation",
                 "native/transcription", "native/openvr-client", "native/onnx-runtime", "native/vr-overlay", "native/voice-conversion",
                 "native/translate-onnx", "native/tts", "native/core")
# Every Cargo workspace with a lock file of its own: the Tauri app, the crates above, and the two
# whose tests check --scope rust does not run yet (#812). cargo-deny reads them all.
CARGO_WORKSPACES = ("src-tauri", *NATIVE_CRATES, "native/ocr-runtime", "native/rvc-runtime")
# cargo-deny's lints for a shared deny.toml: a license, exception or source one workspace has no
# use for is not a mistake.
DENY_UNUSED = ("license-not-encountered", "license-exception-not-encountered", "unmatched-source")
# The lock files osv-scanner reads, named so that it never wanders into node_modules or target/.
# tools/translation_onnx/requirements.txt is left out: it pins a local torch build (+cpu) that
# osv-scanner cannot resolve, and nothing from it ships.
OSV_LOCKFILES = ("uv.lock", "package-lock.json", "site/package-lock.json", "site/motion/package-lock.json",
                 *(f"{workspace}/Cargo.lock" for workspace in CARGO_WORKSPACES))
SETUP_SCOPES = ("headless", "ui", "browser", "rust", "resources")
OWNER_FILE = ".vrct-vox-dev-env"
OWNER = "VRCT-VOX developer environment v1\n"
# Plain unit tests that live in tests/platform next to the helpers they test; the rest of
# that folder needs a desktop, a driver or real devices and runs only when asked.
PLATFORM_UNIT_TESTS = (
    # The teardown of the GUI tests' driver, on throwaway processes (Linux only).
    "tests/platform/test_native_driver_teardown.py",
    "tests/platform/test_display_power_guard.py",
)
LINT_PATHS = [
    "tests/voice", "tools/private_pipewire.py", "tools/build_voice_gate.py",
    "tools/check_voice_distribution.py", "tools/release_candidate.py", "tools/native_acceptance.py",
    "tools/prepare_release.py", "tools/release_automation.py", "tools/changelog.py", "tools/dev.py", "tools/build_linux.py",
    "tools/check_python_lock.py", "tools/rust_licenses.py", "tools/app_resources.py",
    "tools/adr_catalog.py", "tools/rvc_worker_bench.py", "tests/devtools",
]


class DevError(Exception):
    """Missing prerequisite or unsafe/invalid command request (exit 2)."""


@dataclass
class Step:
    name: str
    argv: list[str]


def child_environment():
    # Live acceptance switches and asset paths must not opt a headless check in: the app's own
    # variables under their ASTAROT names and the VRCT names of 0.5.x alike.
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("ASTAROT_", "VRCT_")) and key not in (
               "PYTEST_ADDOPTS", "PYTEST_PLUGINS", "PYTHONPATH", "PYTHONHOME")}
    # ORT_DISABLE_TELEMETRY: the onnxruntime wheel (1.32) otherwise writes a device id under
    # ~/.cache/Microsoft and sends usage events when a test creates a session (#574).
    env.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", ORT_DISABLE_TELEMETRY="1",
               TRANSFORMERS_OFFLINE="1", SPEECH_NO_UPDATE_CHECK="1",
               CARGO_NET_OFFLINE="true", RUSTUP_AUTO_INSTALL="0",
               PYTEST_DISABLE_PLUGIN_AUTOLOAD="1", UV_NO_VERIFY_HASHES="0")
    return env


def probe(argv, root):
    try:
        return subprocess.run(argv, cwd=root, env=child_environment(),
                              capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DevError(f"Cannot run {argv[0]}: {exc}") from exc


def execute(steps, root, *, dry_run):
    for step in steps:
        display = subprocess.list2cmdline(step.argv) if os.name == "nt" else shlex.join(step.argv)
        print(f"[{step.name}] {display}", flush=True)
        if dry_run:
            continue
        argv = step.argv.copy()
        executable = shutil.which(argv[0])
        if executable is None:
            raise DevError(f"Missing executable: {argv[0]}. Run doctor for this scope.")
        argv[0] = executable
        try:
            # npm.cmd needs cmd.exe on Windows. It only receives our fixed args;
            # user paths/test names are always passed to native python/node/cog.
            result = subprocess.run(argv, cwd=root, env=child_environment(), check=False)
        except OSError as exc:
            raise DevError(f"Cannot run {argv[0]}: {exc}") from exc
        if result.returncode:
            print(f"FAILED: {step.name} (child exit {result.returncode}).", flush=True)
            return 1
    print("Plan only; nothing installed or checked." if dry_run else "Selected commands passed.")
    return 0


def env_python(directory):
    return directory / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def env_series(directory):
    """(major, minor) of the Python a virtual environment was made with, from its pyvenv.cfg."""
    try:
        text = (directory / "pyvenv.cfg").read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    match = re.search(r"^\s*version(?:_info)?\s*=\s*(\d+)\.(\d+)", text, re.M)
    return (int(match[1]), int(match[2])) if match else None


def choose_python(root, explicit=None, *, profile="headless"):
    if explicit:
        candidate = Path(explicit).expanduser()
        if not candidate.is_absolute():
            candidate = root / candidate
        return str(candidate.absolute())
    candidates = [env_python(root / f"build/dev/{profile}-venv"), env_python(root / ".venv")]
    return str(next((p for p in candidates if p.is_file()), candidates[0]))


def reject_links(path, root):
    for part in (path, *path.parents):
        if part == root:
            break
        if part.is_symlink():
            raise DevError(f"Refusing symlink in setup destination: {part}")


def setup_resources(args, root):
    # tauri.conf.json bundles src-tauri/bin/_internal; tauri dev and cargo check need the folder.
    # A debug build reads speech.cpp and the helpers from build/ in the checkout itself.
    return execute([Step("development _internal", [sys.executable, str(root / "tools/app_resources.py"),
        "stage", "--allow-missing"])], root, dry_run=args.dry_run)



def scopes(args):
    return GROUPS.get(args.scope, (args.scope,))


def checks_plan(args, root):
    steps = []
    selected = scopes(args)
    for scope in selected:
        python = choose_python(root, args.python)
        if scope == "tooling":
            steps.append(Step("developer CLI tests", [sys.executable, "-m", "unittest",
                "discover", "-s", "tests/devtools", "-v"]))
        elif scope in ("node", "ui"):
            if scope == "ui" and "node" in selected:
                pass
            else:
                # vitest.config.js lists the same patterns (plus the i18n gate's own tests in
                # tools/i18n_gate); this guard keeps a moved or renamed tree from passing as an
                # empty run.
                if not any(p for pattern in ("*.test.js", "*.test.mjs", "*.test.ts")
                           for p in (root / "src-ui").rglob(pattern)):
                    raise DevError("No UI tests found under src-ui; refusing an empty check.")
                # The installed Vitest, run by Node directly: no npx lookup and no download.
                vitest = root / "node_modules/vitest/vitest.mjs"
                if not args.dry_run and not vitest.is_file():
                    raise DevError("Vitest is not installed. Run: python tools/dev.py setup --scope ui")
                steps.append(Step("UI tests (Vitest)", ["node", vitest.relative_to(root).as_posix(), "run"]))
                # Issue #515: en/ja keys and {{variables}} agree, every key the UI names exists,
                # and no new text is written straight into the UI.
                steps.append(Step("i18n gate", ["node", "--disable-warning=ExperimentalWarning",
                    "tools/i18n_gate/check.mjs"]))
            if scope == "ui":
                steps.append(Step("TypeScript", ["npm", "--ignore-scripts", "run", "typecheck"]))
                steps.append(Step("Vite build", ["npm", "--ignore-scripts", "run", "vite-build"]))
        elif scope == "voice":
            steps.append(Step("voice pytest", [python, "-m", "pytest", "-c", "tests/voice/pytest.ini", "tests/voice",
                *PLATFORM_UNIT_TESTS, "-q"]))
        elif scope == "lint":
            steps.append(Step("Ruff", [python, "-m", "ruff", "check", *LINT_PATHS]))
        elif scope == "rust":
            steps.append(Step("Cargo check", ["cargo", "check", "--locked", "--offline",
                "--manifest-path", "src-tauri/Cargo.toml"]))
            for crate in NATIVE_CRATES:
                # cargo-nextest runs each test in a process of its own; it does not run doctests,
                # so a crate with a library runs them with cargo test --doc as before.
                steps.append(Step(f"Cargo nextest {crate}", ["cargo", "nextest", "run", "--locked", "--offline",
                    "--manifest-path", f"{crate}/Cargo.toml", "--no-tests", "pass"]))
                if (root / crate / "src/lib.rs").is_file():
                    steps.append(Step(f"Cargo doctests {crate}", ["cargo", "test", "--doc", "--locked", "--offline",
                        "--manifest-path", f"{crate}/Cargo.toml"]))
        elif scope == "workflows":
            # actionlint: syntax, expressions and types. Its shellcheck and pyflakes passes stay off:
            # mise.toml pins neither, so they would change with whatever the PC has. zizmor:
            # security problems, with the exceptions in .github/zizmor.yml; without GH_TOKEN it
            # skips the audits that ask GitHub (impostor commits, known vulnerable actions).
            steps.append(Step("actionlint", ["actionlint", "-shellcheck=", "-pyflakes="]))
            steps.append(Step("zizmor", ["zizmor", *(["--format", "github"]
                if os.environ.get("GITHUB_ACTIONS") == "true" else []), "."]))
        elif scope == "crates":
            # Licenses, banned crates and sources, as deny.toml allows them (the license ledger,
            # docs/voice-stack/licensing.md). Known vulnerabilities are osv-scanner's.
            for crate in CARGO_WORKSPACES:
                steps.append(Step(f"cargo-deny {crate}", ["cargo-deny", "--frozen", "--manifest-path",
                    f"{crate}/Cargo.toml", "--config", "deny.toml", "check",
                    *(flag for lint in DENY_UNUSED for flag in ("-A", lint)), "licenses", "bans", "sources"]))
        elif scope == "links":
            # Links between the repository's Markdown files and to their headings, as lychee.toml
            # sets them. Offline: a site that is down never fails it; root-relative links ("/...")
            # resolve from the repository's root.
            steps.append(Step("lychee", ["lychee", "--offline", "--no-progress", "--root-dir", str(root.resolve()), "."]))
        elif scope == "hooks":
            # hk.pkl, the Git hooks' settings, as hk reads them. The first run downloads hk's
            # settings package of the pinned version from its GitHub release.
            steps.append(Step("hk validate", ["hk", "validate"]))
        elif scope == "vulns":
            # Known vulnerabilities (osv.dev) of every lock file: this asks osv.dev over the network.
            # Exceptions go in osv-scanner.toml with a reason.
            lockfiles = [name for name in OSV_LOCKFILES if args.dry_run or (root / name).is_file()]
            steps.append(Step("osv-scanner", ["osv-scanner", "scan", "source",
                *(flag for name in lockfiles for flag in ("--lockfile", name))]))
        elif scope == "secrets":
            # Keys and tokens in the commits after --base, as gitleaks finds them with
            # .gitleaks.toml and .gitleaksignore. --redact keeps a found value out of the output.
            steps.append(Step("secrets in new commits", ["gitleaks", "git", "--redact", "--no-banner",
                "--log-opts", f"{commit_base(args, root, 'secrets')}..HEAD", "."]))
        elif scope == "commits":
            steps.append(Step("new commits", ["cog", "check", f"{commit_base(args, root, 'commits')}..HEAD"]))
    return steps


def commit_base(args, root, scope):
    """The merge base of --base and HEAD; in a dry run, --base as given (resolved when it runs)."""
    if not args.base or args.base.startswith("-"):
        raise DevError(f"{scope} requires --base REF (for example origin/develop); old history is not rewritten.")
    if args.dry_run:
        return args.base
    base = probe(["git", "rev-parse", "--verify", "--end-of-options", args.base + "^{commit}"], root)
    if base.returncode:
        raise DevError("Cannot resolve --base locally. Fetch the intended base explicitly before checking.")
    ancestor = probe(["git", "merge-base", base.stdout.strip(), "HEAD"], root)
    if ancestor.returncode:
        raise DevError("No merge base with HEAD; inspect the local history/shallow checkout.")
    return ancestor.stdout.strip()


def mise_versions(root):
    """Tool versions pinned in mise.toml, keyed by mise's tool name; empty without the file."""
    try:
        tools = tomllib.loads((root / "mise.toml").read_text(encoding="utf-8")).get("tools", {})
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError):
        return {}
    versions = {}
    for name, value in tools.items() if isinstance(tools, dict) else ():
        version = value.get("version") if isinstance(value, dict) else value
        if isinstance(version, str):
            versions[name] = version
    return versions


def pinned_versions(root):
    """Tool versions pinned in mise.toml, keyed by the name doctor looks up on PATH."""
    tools = mise_versions(root)
    return {command: tools[name] for name, command in
            (("node", "node"), ("cocogitto", "cog"), ("rust", "cargo"), ("uv", "uv"),
             ("actionlint", "actionlint"), ("zizmor", "zizmor"), ("cargo-deny", "cargo-deny"),
             ("cargo-nextest", "cargo-nextest"), ("osv-scanner", "osv-scanner"), ("gitleaks", "gitleaks"),
             ("lychee", "lychee"), ("hk", "hk"))
            if name in tools}


def python_series(root):
    """(major, minor) of the Python mise.toml pins, which every test environment uses; None without a pin."""
    match = re.match(r"(\d+)\.(\d+)(?:\.|$)", mise_versions(root).get("python", ""))
    return (int(match[1]), int(match[2])) if match else None


def doctor(args, root, *, preflight=False):
    rows = []

    def row(name, status, detail, remedy=""):
        rows.append(dict(name=name, status=status, detail=detail, remedy=remedy))

    def tool(name, expected=None):
        path = shutil.which(name)
        if not path:
            row(name, "missing", "Not on PATH",
                f"mise install (mise.toml pins {expected}); see docs/development.md." if expected
                else "Install the tool explicitly; see docs/development.md.")
            return
        result = probe([path, "--version"], root)
        value = (result.stdout or result.stderr).strip().splitlines()
        version = value[0] if value else "No version output"
        compatible = result.returncode == 0
        if name == "node":
            match = re.match(r"v(\d+)\.", version)
            compatible = compatible and bool(match) and int(match[1]) >= 22
        if name == "cog":
            compatible = compatible and version.startswith("cog 7.")
        row(name, "ok" if compatible else "missing", version,
            f"Pinned in mise.toml: {expected} (mise install)" if expected else "")

    row("Python CLI", "ok", sys.version.split()[0])
    selected = scopes(args)
    needed_tools = set()
    if any(s in selected for s in ("node", "ui")):
        needed_tools.add("node")
        if not (root / "node_modules").is_dir():
            row("UI packages", "missing", "node_modules is absent", "python tools/dev.py setup --scope ui")
    if "ui" in selected:
        needed_tools.add("npm")
    if "rust" in selected:
        needed_tools.update(("cargo", "cargo-nextest"))
        resources = root / "src-tauri/bin/_internal"
        row("Tauri resources", "ok" if resources.is_dir() and not resources.is_symlink() else "missing",
            str(resources), "python tools/dev.py setup --scope resources stages what build/ has.")
        if sys.platform == "linux":
            if not shutil.which("pkg-config"):
                row("native libraries", "missing", "pkg-config not found", "See Linux prerequisites in docs/development.md.")
            else:
                for alternatives in (("webkit2gtk-4.1",),
                                     ("ayatana-appindicator3-0.1", "appindicator3-0.1"),
                                     ("openssl",),
                                     # native/audio-routing binds libpipewire (headers and libclang).
                                     ("libpipewire-0.3",)):
                    found = next((library for library in alternatives
                        if probe(["pkg-config", "--exists", library], root).returncode == 0), None)
                    row(" or ".join(alternatives), "ok" if found else "missing",
                        f"pkg-config found {found}" if found else "No supported provider found",
                        "Install native prerequisites explicitly; setup does not install system packages.")
    if "commits" in selected:
        needed_tools.update(("cog", "git"))
    if "workflows" in selected:
        needed_tools.update(("actionlint", "zizmor"))
    if "crates" in selected:
        needed_tools.update(("cargo", "cargo-deny"))
    if "links" in selected:
        needed_tools.add("lychee")
    if "hooks" in selected:
        needed_tools.add("hk")
    if "vulns" in selected:
        needed_tools.add("osv-scanner")
    if "secrets" in selected:
        needed_tools.update(("gitleaks", "git"))
    pinned = pinned_versions(root)
    for tool_name in sorted(needed_tools):
        tool(tool_name, pinned.get(tool_name))
    python_scopes = set(selected) & {"voice", "lint", "browser"}
    series = python_series(root)
    for scope in sorted(python_scopes):
        python = choose_python(root, args.python, profile="browser" if scope == "browser" else "headless")
        remedy_scope = "browser" if scope == "browser" else "headless"
        remedy = f"python tools/dev.py setup --scope {remedy_scope} (or pass --python /path/to/python)"
        if not Path(python).is_file():
            row(scope, "missing", f"Python environment missing: {python}", remedy)
            continue
        packages = {"voice": ["pytest", "PyYAML", "numpy", "psutil", "pillow", "tqdm", "python-osc", "openvr"],
            "lint": ["ruff"],
            "browser": ["pytest", "playwright", "python-osc"]}[scope]
        script = "import sys, importlib.metadata as m; print(sys.version); " + "; ".join(
            f"print({p!r}, m.version({p!r}))" for p in packages)
        if scope != "lint" and series:
            script += (f"; assert sys.version_info[:2] == {series!r}, "
                       f"'Use Python {series[0]}.{series[1]} (mise.toml) for the test/runtime environment'")
        result = probe([python, "-c", script], root)
        row(scope, "ok" if result.returncode == 0 else "missing",
            result.stdout.strip() if result.returncode == 0 else f"Missing dependency in {python}: {result.stderr.strip().splitlines()[-1:]}", remedy)
    ok = all(r["status"] != "missing" for r in rows)
    if preflight:
        for r in rows:
            if r["status"] == "missing":
                print(f"[MISSING] {r['name']}: {r['detail']}\n  {r['remedy']}")
    elif args.json:
        print(json.dumps({"ok": ok, "scope": args.scope, "checks": rows}, ensure_ascii=False, indent=2))
    else:
        for r in rows:
            print(f"[{r['status'].upper()}] {r['name']}: {r['detail']}")
            if r["remedy"]:
                print(f"  {r['remedy']}")
        print("Doctor only; no dependencies installed or application started.")
    return 0 if ok else 2


def owned_environment(target, root):
    for path in (target, *target.parents):
        if path == root:
            break
        if path.is_symlink():
            raise DevError(f"Refusing symlink in setup destination: {path}")
    if target.exists():
        marker = target / OWNER_FILE
        if not target.is_dir() or not marker.is_file() or marker.read_text() != OWNER:
            raise DevError(f"Environment is not owned by dev.py: {target}. Preserve it and choose an explicit existing Python for browser dependencies.")
        if not env_python(target).is_file():
            raise DevError(f"Owned environment is incomplete: {target}. Inspect it before recreating it manually.")


def setup(args, root):
    if args.python and args.scope != "browser":
        raise DevError("setup --python is supported only with --scope browser (additive install). Other scopes use owned environments.")
    if args.scope == "resources":
        return setup_resources(args, root)
    if args.scope == "ui":
        return execute([Step("locked UI packages", ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund",
            *(["--offline"] if args.offline else [])])], root, dry_run=args.dry_run)
    if args.scope == "rust":
        # execute normally enforces Cargo offline. Dependency acquisition is
        # explicit here, so use Cargo's per-command override, never in check.
        return execute([Step(f"locked Rust dependencies {manifest}", ["cargo", "--config",
            f"net.offline={'true' if args.offline else 'false'}", "fetch", "--locked",
            "--manifest-path", f"{manifest}/Cargo.toml"])
            for manifest in CARGO_WORKSPACES], root, dry_run=args.dry_run)
    uv = ["uv", *(["--offline"] if args.offline else [])]
    # Every scope installs an exact subset of uv.lock (pyproject.toml groups).
    groups = {"headless": ["--only-group", "voice-test"], "browser": ["--only-group", "voice-ui-test"]}[args.scope]
    requirement = f"build/dev/{args.scope}-requirements.txt"
    target = root / f"build/dev/{args.scope}-venv"
    python = choose_python(root, args.python) if args.python else str(env_python(target))
    # The Python mise.toml pins; uv finds it on PATH and never fetches one of its own.
    series = python_series(root)
    label = f"Python {series[0]}.{series[1]}" if series else "Python"
    if args.python:
        if not args.dry_run and not Path(python).is_file():
            raise DevError(f"Existing Python not found: {python}")
        if not args.dry_run:
            result = probe([python, "-c", "import sys,json; print(json.dumps({'venv': sys.prefix != sys.base_prefix, 'version': list(sys.version_info[:2])}))"], root)
            try:
                info = json.loads(result.stdout) if result.returncode == 0 else {}
            except ValueError:
                info = {}
            if not info.get("venv") or (series and info.get("version") != list(series)):
                raise DevError(f"Browser dependencies require an existing {label} virtual environment; system Python is never modified.")
    else:
        owned_environment(target, root)
        # An owned environment from an earlier pin cannot take the lock's wheels: make it again.
        stale = bool(series) and target.exists() and env_series(target) != series
        if not target.exists() or stale:
            version = ["--python", f"{series[0]}.{series[1]}"] if series else []
            step = Step(f"isolated {label} environment", [*uv, "venv", *version, *(["--clear"] if stale else []),
                "--no-python-downloads", str(target)])
            result = execute([step], root, dry_run=args.dry_run)
            if result:
                return result
            if not args.dry_run:
                (target / OWNER_FILE).write_text(OWNER, encoding="utf8")
    # The export is a complete transitive set. Owned environments are synced
    # to it exactly; an explicit existing environment only gains packages.
    method = "install" if args.python else "sync"
    return execute([
        Step("verify Python lock", [sys.executable, str(root / "tools/check_python_lock.py"), str(root / "uv.lock")]),
        Step("locked requirements", [*uv, "export", "--quiet", "--frozen", "--no-header",
            "--no-annotate", "--format", "requirements-txt", "--no-emit-project", *groups,
            "--output-file", requirement]),
        Step("Python dependencies", [*uv, "pip", method, "--python", python,
            *([] if method == "sync" else ["-r"]), requirement]),
    ], root, dry_run=args.dry_run)


def parser():
    result = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  python tools/dev.py doctor\n  python tools/dev.py setup --scope headless\n  python tools/dev.py check --scope voice --python .venv/bin/python\n  python tools/dev.py check --scope commits --base origin/develop")
    commands = result.add_subparsers(dest="command", required=True)
    for command in ("doctor", "check"):
        sub = commands.add_parser(command, help="Inspect local prerequisites" if command == "doctor" else "Run selected model-free checks")
        sub.add_argument("--scope", choices=(*SCOPES, "browser") if command == "doctor" else SCOPES,
                         default="quick", help="quick = tooling + node + lint; all also runs ui, voice, Rust, workflows, crates, links and hooks (default: quick)")
        sub.add_argument("--python", help="Existing environment's Python executable; never installs packages")
        if command == "doctor":
            sub.add_argument("--json", action="store_true", help="Machine-readable diagnostics; missing prerequisites exit 2")
        else:
            sub.add_argument("--base", help="Local Git ref for the commits and secrets scopes; uses its merge base with HEAD")
            sub.add_argument("--dry-run", action="store_true", help="Print commands without executing them")
    sub = commands.add_parser("setup", help="Explicitly install development dependencies (no system installs)")
    sub.add_argument("--scope", choices=SETUP_SCOPES, default="headless")
    sub.add_argument("--python", help="Existing Python for additive browser dependencies only")
    sub.add_argument("--offline", action="store_true", help="Require populated dependency caches")
    sub.add_argument("--dry-run", action="store_true", help="Print commands without changing anything")
    return result


def main(argv=None, *, root=ROOT):
    args = parser().parse_args(argv)
    try:
        if args.command == "doctor":
            return doctor(args, root)
        if args.command == "setup":
            return setup(args, root)
        steps = checks_plan(args, root)
        if not args.dry_run and doctor(args, root, preflight=True):
            return 2
        return execute(steps, root, dry_run=args.dry_run)
    except (DevError, OSError) as exc:
        if getattr(args, "json", False):
            print(json.dumps({"ok": False, "error": str(exc)}))
        else:
            print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
