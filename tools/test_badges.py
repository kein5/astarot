"""Generate and publish shields.io endpoint JSON files for README badges.

CI auto-updated badges (UI line coverage, Rust line coverage, unit tests, integration tests) are
written to the dedicated `badges` branch through the GitHub Git Data API, keeping `develop` free of
automated commits. Milestone badges (Rust mutation score, future UI mutation score, real-machine
E2E status) live in `docs/testing/badges/` on `develop` so changes are reviewed in pull requests.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

from tools.release_candidate import REPOSITORY

BRANCH = "badges"
SCHEMA_VERSION = 1


class TestBadgesError(Exception):
    pass


def coverage_color(percent: float) -> str:
    if percent >= 80.0:
        return "brightgreen"
    if percent >= 60.0:
        return "green"
    if percent >= 40.0:
        return "yellowgreen"
    if percent >= 20.0:
        return "yellow"
    return "orange"


def endpoint_badge(label: str, message: str, color: str) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "label": label,
        "message": message,
        "color": color,
    }


def status_badge(label: str, passed: bool) -> dict:
    return endpoint_badge(label, "passing" if passed else "failing", "brightgreen" if passed else "red")


def coverage_badge(label: str, pct: float) -> dict:
    return endpoint_badge(label, f"{pct:.1f}%", coverage_color(pct))


def _normalize_path(path: str) -> str:
    return path.replace("\\", "/")


def parse_ui_metrics(coverage_summary: dict, vitest_results: dict) -> tuple[dict, dict]:
    """Return (coverage_badge_dict, split_status_dict) from Vitest coverage and JSON results."""
    lines = coverage_summary.get("total", {}).get("lines")
    if not isinstance(lines, dict) or "pct" not in lines:
        raise TestBadgesError("coverage-summary.json is missing total.lines.pct")
    pct = float(lines["pct"])
    cov_badge = coverage_badge("UI line coverage", pct)

    unit = {"passed": True, "files": 0, "tests": 0, "failed": 0}
    integration = {"passed": True, "files": 0, "tests": 0, "failed": 0}
    other = {"passed": True, "files": 0, "tests": 0, "failed": 0}

    for suite in vitest_results.get("testResults", []):
        name = _normalize_path(str(suite.get("name", "")))
        assertions = suite.get("assertionResults", [])
        failed = sum(1 for item in assertions if item.get("status") == "failed")
        suite_failed = suite.get("status") == "failed" or failed > 0
        if "/src-ui/logics/" in name or name.startswith("src-ui/logics/"):
            bucket = unit
        elif "/src-ui/views/" in name or name.startswith("src-ui/views/"):
            bucket = integration
        else:
            bucket = other
        bucket["files"] += 1
        bucket["tests"] += len(assertions)
        bucket["failed"] += failed
        if suite_failed:
            bucket["passed"] = False

    if unit["files"] == 0 or integration["files"] == 0:
        raise TestBadgesError("vitest-results.json did not contain both src-ui/logics and src-ui/views suites")

    split = {
        "lines": {
            "covered": int(lines.get("covered", 0)),
            "total": int(lines.get("total", 0)),
            "pct": round(pct, 2),
        },
        "unit": unit,
        "integration": integration,
        "other": other,
    }
    return cov_badge, split


def parse_rust_coverage(raw: dict) -> tuple[dict, dict]:
    """Return (coverage_badge_dict, summary_dict) from tools/rust_coverage.py --json output."""
    lines = raw.get("total", {}).get("lines")
    if not isinstance(lines, dict) or not lines.get("count"):
        raise TestBadgesError("rust coverage JSON is missing non-zero total.lines.count")
    covered = int(lines["covered"])
    count = int(lines["count"])
    pct = 100.0 * covered / count
    badge = coverage_badge("Rust line coverage", pct)
    measured_crates = sum(1 for item in raw.get("crates", {}).values() if isinstance(item, dict) and "error" not in item)
    summary = {
        "covered": covered,
        "count": count,
        "pct": round(pct, 2),
        "measured_crates": measured_crates,
    }
    return badge, summary


def parse_nextest_junit(xml_text: str) -> dict[str, dict[str, int | bool]]:
    """Split cargo-nextest JUnit XML suites into unit (crate lib/bin) vs integration (crate::test)."""
    root = ET.fromstring(xml_text)
    unit = {"passed": True, "tests": 0, "failed": 0}
    integration = {"passed": True, "tests": 0, "failed": 0}
    for suite in root.findall(".//testsuite"):
        name = suite.attrib.get("name", "")
        tests = int(suite.attrib.get("tests", "0"))
        failures = int(suite.attrib.get("failures", "0")) + int(suite.attrib.get("errors", "0"))
        bucket = integration if "::" in name else unit
        bucket["tests"] += tests
        bucket["failed"] += failures
        if failures > 0:
            bucket["passed"] = False
    return {"unit": unit, "integration": integration}


def combine_status(
    ui_split: dict | None,
    job_conclusions: dict[str, str],
    junit_splits: list[dict] | None = None,
    src_tauri_passed: bool | None = None,
) -> tuple[dict, dict, dict]:
    """Compute (tests_unit_badge, tests_integration_badge, detail_dict)."""
    unit_ok = True
    integration_ok = True
    reasons: list[str] = []

    if ui_split is None:
        unit_ok = False
        integration_ok = False
        reasons.append("missing UI metrics")
    else:
        if not ui_split["unit"]["passed"]:
            unit_ok = False
            reasons.append("UI logics Vitest failed")
        if not ui_split["integration"]["passed"]:
            integration_ok = False
            reasons.append("UI views Vitest failed")

    if junit_splits:
        for split in junit_splits:
            if not split["unit"]["passed"]:
                unit_ok = False
                reasons.append("native/core unit tests failed")
            if not split["integration"]["passed"]:
                integration_ok = False
                reasons.append("native/core integration tests failed")

    # Headless Linux runs PipeWire integration tests in addition to UI/tooling; core-integration
    # and crates run both Rust unit and Rust integration tests across Linux and Windows.
    for job_name, conclusion in sorted(job_conclusions.items()):
        if conclusion == "success":
            continue
        lower = job_name.lower()
        if lower.startswith("headless"):
            if ui_split is None or (ui_split["unit"]["passed"] and ui_split["integration"]["passed"]):
                integration_ok = False
                reasons.append(f"{job_name}: {conclusion}")
        elif lower.startswith("core-integration") or lower.startswith("crates"):
            # If JUnit already identified a specific failure side and only one side failed, still
            # mark both failing when another crate or build step inside the job may have failed.
            unit_ok = False
            integration_ok = False
            reasons.append(f"{job_name}: {conclusion}")

    if src_tauri_passed is False:
        unit_ok = False
        reasons.append("src-tauri unit tests failed")

    detail = {
        "unit_passed": unit_ok,
        "integration_passed": integration_ok,
        "jobs": job_conclusions,
        "src_tauri_passed": src_tauri_passed,
        "reasons": reasons,
    }
    return status_badge("unit tests", unit_ok), status_badge("integration tests", integration_ok), detail


class GitHub:
    """GitHub API calls through gh CLI using GH_TOKEN."""

    def api(self, path: str, body: dict | None = None, method: str = "GET", missing_ok: bool = False):
        command = ["gh", "api", path, "--method", method]
        if body is not None:
            command += ["--input", "-"]
        result = subprocess.run(
            command,
            input=json.dumps(body) if body is not None else None,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if result.returncode != 0:
            if missing_ok and "HTTP 404" in result.stderr:
                return None
            raise TestBadgesError(f"gh api {method} {path} failed: {result.stderr.strip()}")
        return json.loads(result.stdout) if result.stdout.strip() else None


def _current_blobs(github: GitHub, paths: list[str], repository: str = REPOSITORY) -> tuple[str | None, dict[str, str]]:
    ref = github.api(f"repos/{repository}/git/ref/heads/{BRANCH}", missing_ok=True)
    if ref is None:
        return None, {}
    head = ref["object"]["sha"]
    existing: dict[str, str] = {}
    for path in paths:
        content = github.api(f"repos/{repository}/contents/{path}?ref={head}", missing_ok=True)
        if content is None:
            continue
        blob = github.api(f"repos/{repository}/git/blobs/{content['sha']}")
        existing[path] = base64.b64decode(blob["content"]).decode("utf-8")
    return head, existing


def publish_files(
    github: GitHub,
    files: dict[str, str],
    commit_message: str,
    repository: str = REPOSITORY,
    dry_run: bool = False,
) -> bool:
    """Write `files` (path -> UTF-8 text) atomically to `badges` branch. Returns True if written."""
    head, existing = _current_blobs(github, sorted(files), repository)
    if existing == files and head is not None:
        return False
    if dry_run:
        return True
    base_tree = None
    if head is not None:
        base_tree = github.api(f"repos/{repository}/git/commits/{head}")["tree"]["sha"]
    tree_entries = []
    for path, text in sorted(files.items()):
        blob = github.api(f"repos/{repository}/git/blobs", {"content": text, "encoding": "utf-8"}, method="POST")
        tree_entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    tree_body: dict = {"tree": tree_entries}
    if base_tree is not None:
        tree_body["base_tree"] = base_tree
    tree = github.api(f"repos/{repository}/git/trees", tree_body, method="POST")
    commit = github.api(
        f"repos/{repository}/git/commits",
        {
            "message": commit_message,
            "tree": tree["sha"],
            "parents": [head] if head is not None else [],
        },
        method="POST",
    )
    if head is None:
        github.api(f"repos/{repository}/git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]}, method="POST")
    else:
        github.api(f"repos/{repository}/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": False}, method="PATCH")
    return True


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _cmd_ui(args: argparse.Namespace) -> int:
    cov = json.loads(Path(args.coverage).read_text(encoding="utf-8"))
    vitest = json.loads(Path(args.vitest).read_text(encoding="utf-8"))
    badge, split = parse_ui_metrics(cov, vitest)
    out = Path(args.out)
    _write_json(out / "coverage-ui.json", badge)
    _write_json(out / "ui-split.json", split)
    return 0


def _cmd_rust_coverage(args: argparse.Namespace) -> int:
    raw = json.loads(Path(args.input).read_text(encoding="utf-8"))
    badge, summary = parse_rust_coverage(raw)
    out = Path(args.out)
    _write_json(out / "coverage-rust.json", badge)
    _write_json(out / "rust-coverage-summary.json", summary)
    return 0


def _latest_src_tauri_passed(github: GitHub, repository: str) -> bool | None:
    runs = github.api(
        f"repos/{repository}/actions/workflows/app-tests-windows.yml/runs?branch=develop&status=completed&per_page=1",
        missing_ok=True,
    )
    if not runs or not runs.get("workflow_runs"):
        return None
    conclusion = runs["workflow_runs"][0].get("conclusion")
    if conclusion == "success":
        return True
    if conclusion in ("failure", "timed_out"):
        return False
    return None


def _cmd_publish(args: argparse.Namespace) -> int:
    github = GitHub()
    repo = args.repository
    run_id = args.run_id
    artifacts_dir = Path(args.artifacts_dir)

    jobs_resp = github.api(f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=50")
    job_conclusions = {
        job["name"]: str(job.get("conclusion") or job.get("status") or "unknown")
        for job in jobs_resp.get("jobs", [])
    }

    ui_badge_path = artifacts_dir / "badge-ui" / "coverage-ui.json"
    ui_split_path = artifacts_dir / "badge-ui" / "ui-split.json"
    rust_cov_badge_path = artifacts_dir / "badge-rust-coverage" / "coverage-rust.json"
    rust_cov_summary_path = artifacts_dir / "badge-rust-coverage" / "rust-coverage-summary.json"

    ui_split = json.loads(ui_split_path.read_text(encoding="utf-8")) if ui_split_path.is_file() else None
    junit_splits = []
    for junit_file in sorted(artifacts_dir.glob("core-tests-junit-*/junit.xml")):
        junit_splits.append(parse_nextest_junit(junit_file.read_text(encoding="utf-8")))

    src_tauri_passed = _latest_src_tauri_passed(github, repo)
    unit_badge, integration_badge, status_detail = combine_status(
        ui_split, job_conclusions, junit_splits=junit_splits, src_tauri_passed=src_tauri_passed
    )

    files: dict[str, str] = {
        "tests-unit.json": json.dumps(unit_badge, indent=2, ensure_ascii=False) + "\n",
        "tests-integration.json": json.dumps(integration_badge, indent=2, ensure_ascii=False) + "\n",
    }
    if ui_badge_path.is_file():
        files["coverage-ui.json"] = ui_badge_path.read_text(encoding="utf-8")
    if rust_cov_badge_path.is_file():
        files["coverage-rust.json"] = rust_cov_badge_path.read_text(encoding="utf-8")

    metadata = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commit": args.commit,
        "workflow_run_id": int(run_id),
        "workflow_run_url": f"https://github.com/{repo}/actions/runs/{run_id}",
        "ui": ui_split,
        "rust_coverage": (
            json.loads(rust_cov_summary_path.read_text(encoding="utf-8"))
            if rust_cov_summary_path.is_file()
            else None
        ),
        "status": status_detail,
    }
    files["metadata.json"] = json.dumps(metadata, indent=2, ensure_ascii=False) + "\n"

    short_sha = args.commit[:9] if args.commit else str(run_id)
    wrote = publish_files(github, files, f"Update CI badges for {short_sha} [skip ci]", repository=repo, dry_run=args.dry_run)
    print(f"test_badges: {'would write' if args.dry_run else ('wrote' if wrote else 'unchanged')} {len(files)} file(s) on {BRANCH}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_ui = sub.add_parser("ui", help="build UI line coverage badge and unit/integration split from Vitest output")
    p_ui.add_argument("--coverage", required=True)
    p_ui.add_argument("--vitest", required=True)
    p_ui.add_argument("--out", required=True)

    p_rc = sub.add_parser("rust-coverage", help="build Rust line coverage badge from tools/rust_coverage.py --json")
    p_rc.add_argument("--input", required=True)
    p_rc.add_argument("--out", required=True)

    p_pub = sub.add_parser("publish", help="publish CI badge JSON files to the badges branch")
    p_pub.add_argument("--run-id", required=True)
    p_pub.add_argument("--commit", default="")
    p_pub.add_argument("--artifacts-dir", required=True)
    p_pub.add_argument("--repository", default=REPOSITORY)
    p_pub.add_argument("--dry-run", action="store_true")

    args = parser.parse_args(argv)
    try:
        if args.command == "ui":
            return _cmd_ui(args)
        if args.command == "rust-coverage":
            return _cmd_rust_coverage(args)
        if args.command == "publish":
            return _cmd_publish(args)
    except TestBadgesError as error:
        print(f"test_badges: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
