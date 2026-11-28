"""Runs the mutation tests on what a branch changed (Issue #550, Phase 3).

    python tools/mutation_changed.py                          # against origin/develop
    python tools/mutation_changed.py --base astarot/develop   # the same branch under another remote
    python tools/mutation_changed.py --dry-run                # say what would run
    python tools/mutation_changed.py --ui-only                # or --rust-only

Mutation tests are not run in CI (#862, #871); a change to the logic is checked by hand, on what it
changed. The change is the diff from the merge base of --base and HEAD to the working tree, so
uncommitted edits count too; a new file counts once it is added to git (git add), as git diff
shows it from then on.

- UI: mutator's --since runs and reports only the mutants inside that diff, among the sources
  mutator.config.mjs takes. The score it prints is the changed code's.
- Rust: cargo-mutants --in-diff, crate by crate, for the crates of tools/dev.py (NATIVE_CRATES)
  whose src/ changed. native/core is mutated in place, one mutant at a time, with its unit tests
  only (docs/development.md says why).

Survivors do not fail it: each is read, to tell a missing test from an equivalent mutant
(docs/development.md). It fails when a tool could not run, for one because the tests fail before
anything is mutated.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from dev import NATIVE_CRATES  # noqa: E402

MUTATOR_CONFIG = ROOT / "mutator.config.mjs"
# The crate that cannot be copied to a scratch directory (relative paths to its sibling crates
# differ between its dependencies and its test dependencies): it is mutated in place.
IN_PLACE = "native/core"
RUST_JOBS = 4
# cargo-mutants' exit codes that mean it ran: everything caught, mutants missed, or timeouts.
CARGO_MUTANTS_RAN = (0, 2, 3)


def expand_braces(pattern: str) -> list[str]:
    """src/**/*.{ts,tsx} -> src/**/*.ts, src/**/*.tsx (one brace group, as the config writes them)."""
    match = re.search(r"\{([^{}]*)\}", pattern)
    if not match:
        return [pattern]
    return [pattern[:match.start()] + choice + pattern[match.end():] for choice in match.group(1).split(",")]


def config_patterns(text: str) -> tuple[list[str], list[str]]:
    """mutator.config.mjs's include and exclude globs, braces expanded."""
    def strings(key: str) -> list[str]:
        found = re.search(rf"\b{key}:\s*\[(.*?)\]", text, re.DOTALL)
        if not found:
            raise SystemExit(f"{MUTATOR_CONFIG.name}: no {key} list")
        body = "\n".join(line.split("//", 1)[0] for line in found.group(1).splitlines())
        return [expanded for value in re.findall(r'"([^"]+)"', body) for expanded in expand_braces(value)]
    return strings("include"), strings("exclude")


def ui_sources(files: list[str], include: list[str], exclude: list[str]) -> list[str]:
    """The changed files mutator mutates."""
    def matches(file: str, patterns: list[str]) -> bool:
        return any(PurePosixPath(file).full_match(pattern) for pattern in patterns)
    return [file for file in files if matches(file, include) and not matches(file, exclude)]


def rust_crates(files: list[str]) -> list[str]:
    """The crates whose sources (src/**/*.rs) changed, in tools/dev.py's order."""
    return [crate for crate in NATIVE_CRATES if any(file.startswith(f"{crate}/src/") and file.endswith(".rs") for file in files)]


def ui_command(since: str, jobs: int | None) -> list[str]:
    return ["npm", "run", "test:mutation", "--", "--since", since, *(["-j", str(jobs)] if jobs else [])]


def rust_command(crate: str, diff: Path, jobs: int | None) -> list[str]:
    command = ["cargo", "mutants", "--in-diff", str(diff), "--cargo-arg=--locked"]
    if crate == IN_PLACE:
        # In place, one at a time; its unit tests only.
        return [*command, "--in-place", "--", "--lib"]
    return [*command, "-j", str(jobs or RUST_JOBS)]


def run_env(argv: list[str], base: dict[str, str]) -> dict[str, str]:
    """The environment of a mutation run."""
    # Inputs that a mutant made fail are of no use to keep (docs/development.md).
    env = {**base, "PROPTEST_DISABLE_FAILURE_PERSISTENCE": "1"}
    # cargo-mutants builds each parallel run in its own copy of the crate, with the target
    # directory of that copy. A CARGO_TARGET_DIR passed down would make the copies share one, and
    # a run could test another mutant's build. In place, one at a time, it may stay.
    if argv[:2] == ["cargo", "mutants"] and "--in-place" not in argv:
        env.pop("CARGO_TARGET_DIR", None)
    return env


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8").stdout


def run(argv: list[str], cwd: Path, ran: tuple[int, ...]) -> bool:
    print(f"$ (cd {cwd.relative_to(ROOT).as_posix() or '.'}) {subprocess.list2cmdline(argv) if os.name == 'nt' else ' '.join(argv)}", flush=True)
    executable = shutil.which(argv[0])
    if executable is None:
        print(f"missing: {argv[0]} (mise install)", flush=True)
        return False
    code = subprocess.run([executable, *argv[1:]], cwd=cwd, env=run_env(argv, dict(os.environ)), check=False).returncode
    if code not in ran:
        print(f"FAILED: exit {code}", flush=True)
        return False
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="origin/develop", help="the branch the change goes to (default: origin/develop)")
    side = parser.add_mutually_exclusive_group()
    side.add_argument("--ui-only", action="store_true")
    side.add_argument("--rust-only", action="store_true")
    parser.add_argument("-j", "--jobs", type=int, help="parallel runs (mutator: half the CPUs; cargo-mutants: 4)")
    parser.add_argument("--dry-run", action="store_true", help="print what would run")
    args = parser.parse_args(argv)
    try:
        since = git("merge-base", args.base, "HEAD").strip()
    except subprocess.CalledProcessError:
        print(f"No merge base with {args.base}. Name the branch the change goes to: --base <remote>/develop.", file=sys.stderr)
        return 1
    files = git("diff", "--name-only", "--diff-filter=ACMR", since).split()
    include, exclude = config_patterns(MUTATOR_CONFIG.read_text(encoding="utf-8"))
    ui = [] if args.rust_only else ui_sources(files, include, exclude)
    crates = [] if args.ui_only else rust_crates(files)
    print(f"since {since[:12]} ({args.base}): {len(ui)} UI source(s), {len(crates)} Rust crate(s)")
    for file in ui:
        print(f"  {file}")
    for crate in crates:
        print(f"  {crate}")
    if not ui and not crates:
        print("Nothing to mutate: no changed source that the mutation tests take.")
        return 0
    ok = True
    if ui:
        command = ui_command(since, args.jobs)
        if args.dry_run:
            print("$ " + " ".join(command))
        else:
            ok = run(command, ROOT, (0,)) and ok
    with tempfile.TemporaryDirectory(prefix="mutation-changed-") as scratch:
        for crate in crates:
            diff = Path(scratch) / (crate.replace("/", "_") + ".diff")
            diff.write_text(git("diff", since, f"--relative={crate}", "--", f"{crate}/src"), encoding="utf-8")
            command = rust_command(crate, diff, args.jobs)
            if args.dry_run:
                print(f"$ (cd {crate}) " + " ".join(command))
            else:
                ok = run(command, ROOT / crate, CARGO_MUTANTS_RAN) and ok
    if not args.dry_run:
        print("Results: .mutator/report/ (UI), <crate>/mutants.out/ (Rust). Read each survivor (docs/development.md).")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
