"""The thresholds develop's Bencher send keeps (#738, docs/voice-stack/pipeline-latency-tracking.md).

Only latency-p50 alerts (decided 2026-11-21): latency-p95 is still sent and drawn, but one hiccup
of a runner makes it jump, and 21 of its first 22 alerts were single jumps. The developer CLI's
tests use the standard library only, so the step is read from the workflow's text.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
STEP = "- name: Send develop's times and keep its thresholds"


def develop_send():
    text = (ROOT / ".github/workflows/pipeline-latency.yml").read_text(encoding="utf-8")
    start = text.index(STEP)
    end = text.find("- name:", start + len(STEP))
    return text[start:end if end != -1 else None]


class BencherThresholdTests(unittest.TestCase):
    def test_develop_keeps_a_threshold_on_the_median_only(self):
        step = develop_send()
        self.assertIn("bencher run --branch develop", step)
        self.assertEqual(re.findall(r"--threshold-measure\s+(\S+)", step), ["latency-p50"])
        # Without the reset, the threshold latency-p95 had would stay on develop.
        self.assertIn("--thresholds-reset", step)


if __name__ == "__main__":
    unittest.main()
