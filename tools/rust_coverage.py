"""Measures the coverage of each Rust crate with cargo-llvm-cov and prints it as a table (#550).

    python tools/rust_coverage.py                          # every crate of tools/dev.py
    python tools/rust_coverage.py --crate native/ops       # one crate (repeatable)
    python tools/rust_coverage.py --summary "$GITHUB_STEP_SUMMARY"

Each crate is measured with its own tests (`cargo llvm-cov --summary-only --json`), so code its
callers' tests reach counts for them only. A failing test does not stop the measurement
(`--ignore-run-fail`); its crate is marked in the table. A crate that cannot be built or measured
is listed as such and the others go on. The numbers are reported, never held to a threshold: the
CI job shows them and does not fail on them (decision 1 of #871). The source files' test modules
count too, so added tests also add lines. docs/development.md tells how to read and run it.

It needs cargo-llvm-cov (mise.toml) and rustup's llvm-tools component.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from dev import NATIVE_CRATES  # noqa: E402

KINDS = ("lines", "functions", "regions")


def measure(crate: str, out: Path) -> dict:
    """{"totals": ..., "tests_failed": bool} for one crate, or {"error": reason}."""
    report = out / (crate.replace("/", "_") + ".json")
    command = ["cargo", "llvm-cov", "--locked", "--manifest-path", str(ROOT / crate / "Cargo.toml"),
               "--ignore-run-fail", "--summary-only", "--json", "--output-path", str(report)]
    run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if run.returncode != 0 or not report.is_file():
        return {"error": "not measured (build or run failed)"}
    try:
        totals = json.loads(report.read_text(encoding="utf-8"))["data"][0]["totals"]
    except (ValueError, KeyError, IndexError):
        return {"error": "not measured (unreadable report)"}
    failed = "test result: FAILED" in run.stdout + run.stderr
    return {"totals": {kind: totals[kind] for kind in KINDS}, "tests_failed": failed}


def percent(part: dict) -> str:
    return f"{100 * part['covered'] / part['count']:.1f}%" if part["count"] else "—"


def aggregate(results: dict[str, dict]) -> dict[str, dict[str, int]]:
    total = {kind: {"covered": 0, "count": 0} for kind in KINDS}
    for result in results.values():
        if "error" in result:
            continue
        totals = result["totals"]
        for kind in KINDS:
            total[kind]["covered"] += totals[kind]["covered"]
            total[kind]["count"] += totals[kind]["count"]
    return total


def table(results: dict[str, dict]) -> str:
    """A Markdown table of `crate -> measure()`, with the total of the measured crates."""
    lines = ["| Crate | Lines | Functions | Regions | Lines not run | Note |", "|---|---:|---:|---:|---:|---|"]
    for crate, result in results.items():
        name = f"`{crate.removeprefix('native/')}`"
        if "error" in result:
            lines.append(f"| {name} | — | — | — | — | {result['error']} |")
            continue
        totals = result["totals"]
        missed = totals["lines"]["count"] - totals["lines"]["covered"]
        note = "a test failed" if result["tests_failed"] else ""
        lines.append(f"| {name} | {percent(totals['lines'])} | {percent(totals['functions'])} | {percent(totals['regions'])} | {missed} | {note} |")
    total = aggregate(results)
    missed = total["lines"]["count"] - total["lines"]["covered"]
    lines.append(f"| Total | {percent(total['lines'])} | {percent(total['functions'])} | {percent(total['regions'])} | {missed} | |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--crate", action="append", help="a crate folder (native/<name>); default: every crate")
    parser.add_argument("--summary", type=Path, help="also append the table to this file (GITHUB_STEP_SUMMARY)")
    parser.add_argument("--json", type=Path, help="also write the measured totals as JSON")
    args = parser.parse_args(argv)
    crates = args.crate or list(NATIVE_CRATES)
    unknown = [crate for crate in crates if not (ROOT / crate / "Cargo.toml").is_file()]
    if unknown:
        parser.error(f"not a crate: {', '.join(unknown)}")
    with tempfile.TemporaryDirectory() as out:
        results = {}
        for crate in crates:
            print(f"[coverage] {crate}", file=sys.stderr, flush=True)
            results[crate] = measure(crate, Path(out))
    text = "## Rust coverage\n\nEach crate with its own tests (cargo-llvm-cov). Reported, not a threshold.\n\n" + table(results)
    print(text)
    if args.summary:
        with args.summary.open("a", encoding="utf-8") as summary:
            summary.write(text)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        payload = {"crates": results, "total": aggregate(results)}
        args.json.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
