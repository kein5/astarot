"""The retries of native/core's tests in CI: a test native/core/.config/nextest.toml retries
exists (none since issue #861 was settled), and tools/ci/nextest_flaky_summary.py reports a pass on
a retry."""
import importlib.util
import io
import os
from pathlib import Path
import re
import tempfile
import tomllib
import unittest
from contextlib import redirect_stdout
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "native/core/.config/nextest.toml"
SCRIPT = ROOT / "tools/ci/nextest_flaky_summary.py"

REPORT = """<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="nextest-run" tests="3" failures="1">
  <testsuite name="astarot-core::vr_overlay" tests="3">
    <testcase name="steady" classname="astarot-core::vr_overlay"/>
    <testcase name="sometimes" classname="astarot-core::vr_overlay">
      <flakyFailure message="no /run/send_message_box within 10s | first">output</flakyFailure>
    </testcase>
    <testcase name="always" classname="astarot-core::voice">
      <failure message="third">output</failure>
      <rerunFailure message="first">output</rerunFailure>
      <rerunFailure message="second">output</rerunFailure>
    </testcase>
  </testsuite>
</testsuites>
"""


def load_script():
    spec = importlib.util.spec_from_file_location("nextest_flaky_summary", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def retried_tests():
    """(binary, test) for each test the ci profile retries."""
    config = tomllib.loads(CONFIG.read_text(encoding="utf-8"))
    pairs = []
    for override in config["profile"]["ci"].get("overrides", []):
        if override.get("retries"):
            for binary, tests in re.findall(r"binary\(=(\w+)\)\s*&\s*\(?((?:[^()]|\([^()]*\))*)", override["filter"]):
                pairs += [(binary, name) for name in re.findall(r"test\(=(\w+)\)", tests)]
    return pairs


class RetryListTests(unittest.TestCase):
    def test_every_retried_test_exists(self):
        for binary, name in retried_tests():
            source = ROOT / f"native/core/tests/{binary}.rs"
            self.assertTrue(source.is_file(), f"no test binary {binary}")
            self.assertRegex(source.read_text(encoding="utf-8"), rf"\bfn {name}\(\)", f"{binary}: no test {name}")

    def test_retries_stay_in_the_ci_profile(self):
        # Local runs (python tools/dev.py check --scope rust) use the default profile and see
        # every failure on its first try.
        config = tomllib.loads(CONFIG.read_text(encoding="utf-8"))
        self.assertNotIn("retries", config.get("profile", {}).get("default", {}))
        self.assertFalse(config.get("profile", {}).get("default", {}).get("overrides"))

    def test_the_core_integration_job_runs_the_ci_profile_and_reports_retries(self):
        workflow = (ROOT / ".github/workflows/voice-tests.yml").read_text(encoding="utf-8")
        self.assertIn("cargo nextest run --locked --manifest-path native/core/Cargo.toml --profile ci", workflow)
        self.assertIn("tools/ci/nextest_flaky_summary.py native/core/target/nextest/ci/junit.xml", workflow)


class SummaryTests(unittest.TestCase):
    def setUp(self):
        self.script = load_script()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        self.report = self.folder / "junit.xml"
        self.report.write_text(REPORT, encoding="utf-8")

    def test_a_pass_on_a_retry_and_a_test_that_always_failed_are_told_apart(self):
        retried, failed = self.script.outcomes(self.report)
        self.assertEqual(retried, [("astarot-core::vr_overlay sometimes", 2, "no /run/send_message_box within 10s | first")])
        self.assertEqual(failed, [("astarot-core::voice always", 3, "first")])

    def test_the_summary_and_the_warning_name_the_retried_test(self):
        summary = self.folder / "summary.md"
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}), redirect_stdout(out):
            self.assertEqual(self.script.main(["x", str(self.report)]), 0)
        self.assertIn("::warning title=Passed on a retry::astarot-core::vr_overlay sometimes passed on try 2", out.getvalue())
        written = summary.read_text(encoding="utf-8")
        self.assertIn("| `astarot-core::vr_overlay sometimes` | 2 | no /run/send_message_box within 10s / first |", written)
        self.assertIn("1 test(s) failed on every try", written)

    def test_a_missing_report_never_fails_the_job(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(self.script.main(["x", str(self.folder / "none.xml")]), 0)
        self.assertIn("No JUnit report", out.getvalue())


if __name__ == "__main__":
    unittest.main()
