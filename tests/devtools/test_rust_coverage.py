"""tools/rust_coverage.py: the table it reports (decision 1 of #871: numbers, not a threshold)."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import rust_coverage as subject  # noqa: E402


def measured(lines, functions, regions, failed=False):
    part = lambda covered, count: {"covered": covered, "count": count}  # noqa: E731
    return {"totals": {"lines": part(*lines), "functions": part(*functions), "regions": part(*regions)}, "tests_failed": failed}


class RustCoverageTableTests(unittest.TestCase):
    def test_each_crate_and_the_total_of_those_measured(self):
        text = subject.table({
            "native/ops": measured((90, 100), (9, 10), (45, 50)),
            "native/tts": measured((30, 100), (1, 10), (5, 50), failed=True),
            "native/audio-routing": {"error": "not measured (build or run failed)"},
        })
        rows = [line for line in text.splitlines() if line.startswith("| `") or line.startswith("| Total")]
        self.assertEqual(rows, [
            "| `ops` | 90.0% | 90.0% | 90.0% | 10 |  |",
            "| `tts` | 30.0% | 10.0% | 10.0% | 70 | a test failed |",
            "| `audio-routing` | — | — | — | — | not measured (build or run failed) |",
            "| Total | 60.0% | 50.0% | 50.0% | 80 | |",
        ])

    def test_a_crate_without_code_counts_as_no_percentage(self):
        self.assertEqual(subject.percent({"covered": 0, "count": 0}), "—")

    def test_every_crate_of_the_development_cli_is_measured(self):
        # The same list check --scope rust tests, with the two crates CI added for #871.
        self.assertIn("native/ocr-runtime", subject.NATIVE_CRATES)
        self.assertIn("native/rvc-runtime", subject.NATIVE_CRATES)
        for crate in subject.NATIVE_CRATES:
            self.assertTrue((ROOT / crate / "Cargo.toml").is_file(), crate)


if __name__ == "__main__":
    unittest.main()
