"""Tests for tools/test_badges.py: shields.io endpoint JSON builders and branch publication."""
from __future__ import annotations

import base64
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from tools import test_badges as subject  # noqa: E402


class FakeGitHub:
    def __init__(self, initial_blobs: dict[str, str] | None = None):
        self.calls: list[tuple[str, str, dict | None]] = []
        self.blobs = dict(initial_blobs or {})
        self.head = "deadbeef" if initial_blobs is not None else None
        self.next_id = 1

    def api(self, path, body=None, method="GET", missing_ok=False):
        self.calls.append((method, path, body))
        if method == "GET" and path.endswith("/git/ref/heads/badges"):
            if self.head is None:
                return None
            return {"object": {"sha": self.head}}
        if method == "GET" and "/contents/" in path:
            file_path = path.split("/contents/", 1)[1].split("?", 1)[0]
            if file_path not in self.blobs:
                return None
            return {"sha": f"blob-{file_path}"}
        if method == "GET" and "/git/blobs/blob-" in path:
            file_path = path.split("/git/blobs/blob-", 1)[1]
            encoded = base64.b64encode(self.blobs[file_path].encode("utf-8")).decode("ascii")
            return {"content": encoded}
        if method == "GET" and "/git/commits/" in path:
            return {"tree": {"sha": "tree-base"}}
        if method == "POST" and path.endswith("/git/blobs"):
            sha = f"new-blob-{self.next_id}"
            self.next_id += 1
            return {"sha": sha}
        if method == "POST" and path.endswith("/git/trees"):
            return {"sha": "new-tree"}
        if method == "POST" and path.endswith("/git/commits"):
            return {"sha": "new-commit"}
        if method in ("POST", "PATCH") and "/git/refs" in path:
            self.head = body["sha"]
            return {"ref": "refs/heads/badges"}
        raise AssertionError(f"unexpected call: {method} {path}")


class TestBadgesTests(unittest.TestCase):
    def test_ui_metrics_splits_logics_unit_and_views_integration(self):
        cov = {"total": {"lines": {"total": 1000, "covered": 832, "pct": 83.22}}}
        vitest = {
            "testResults": [
                {
                    "name": "/repo/src-ui/logics/common/meterValue.test.ts",
                    "status": "passed",
                    "assertionResults": [{"status": "passed"}, {"status": "passed"}],
                },
                {
                    "name": "C:\\repo\\src-ui\\views\\vr\\VrPanel.test.ts",
                    "status": "failed",
                    "assertionResults": [{"status": "passed"}, {"status": "failed"}],
                },
                {
                    "name": "/repo/tools/i18n_gate/i18n_gate.test.mjs",
                    "status": "passed",
                    "assertionResults": [{"status": "passed"}],
                },
            ]
        }
        badge, split = subject.parse_ui_metrics(cov, vitest)
        self.assertEqual(badge, {
            "schemaVersion": 1,
            "label": "UI line coverage",
            "message": "83.2%",
            "color": "brightgreen",
        })
        self.assertTrue(split["unit"]["passed"])
        self.assertEqual(split["unit"]["tests"], 2)
        self.assertFalse(split["integration"]["passed"])
        self.assertEqual(split["integration"]["failed"], 1)
        self.assertEqual(split["other"]["files"], 1)

    def test_rust_coverage_badge_uses_total_lines(self):
        raw = {
            "crates": {
                "native/core": {"totals": {"lines": {"covered": 900, "count": 1000}}},
                "native/broken": {"error": "not measured"},
            },
            "total": {"lines": {"covered": 799, "count": 1000}},
        }
        badge, summary = subject.parse_rust_coverage(raw)
        self.assertEqual(badge, {
            "schemaVersion": 1,
            "label": "Rust line coverage",
            "message": "79.9%",
            "color": "green",
        })
        self.assertEqual(summary["measured_crates"], 1)

    def test_nextest_junit_splits_unit_and_integration(self):
        xml = """<testsuites>
            <testsuite name="astarot-core" tests="10" failures="0" errors="0"/>
            <testsuite name="astarot-core::voice_settings" tests="5" failures="1" errors="0"/>
        </testsuites>"""
        split = subject.parse_nextest_junit(xml)
        self.assertTrue(split["unit"]["passed"])
        self.assertEqual(split["unit"]["tests"], 10)
        self.assertFalse(split["integration"]["passed"])
        self.assertEqual(split["integration"]["failed"], 1)

    def test_combine_status_reflects_src_tauri_and_ui_split(self):
        ui_split = {
            "unit": {"passed": True, "files": 126, "tests": 1224, "failed": 0},
            "integration": {"passed": False, "files": 143, "tests": 950, "failed": 1},
        }
        jobs = {
            "headless (ubuntu-latest)": "failure",
            "core-integration (ubuntu-latest)": "success",
            "crates (ubuntu-latest)": "success",
        }
        unit_badge, int_badge, _ = subject.combine_status(ui_split, jobs, src_tauri_passed=True)
        self.assertEqual(unit_badge["message"], "passing")
        self.assertEqual(int_badge["message"], "failing")

        unit_badge2, int_badge2, _ = subject.combine_status(ui_split, jobs, src_tauri_passed=False)
        self.assertEqual(unit_badge2["message"], "failing")
        self.assertEqual(int_badge2["message"], "failing")

    def test_publish_files_creates_branch_and_skips_unchanged(self):
        files = {"coverage-ui.json": '{"schemaVersion": 1}\n'}
        gh_new = FakeGitHub(initial_blobs=None)
        self.assertTrue(subject.publish_files(gh_new, files, "init badges"))
        self.assertTrue(any(m == "POST" and p.endswith("/git/refs") for m, p, _ in gh_new.calls))

        gh_same = FakeGitHub(initial_blobs=files)
        self.assertFalse(subject.publish_files(gh_same, files, "no-op"))
        self.assertFalse(any(m in ("POST", "PATCH") for m, _, _ in gh_same.calls))

    def test_checked_in_rust_mutation_badge_matches_schema(self):
        path = ROOT / "docs/testing/badges/mutation-rust.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(data["schemaVersion"], 1)
        self.assertIn("core", data["label"].lower())
        self.assertEqual(data["message"], "96.0%")


if __name__ == "__main__":
    unittest.main()
