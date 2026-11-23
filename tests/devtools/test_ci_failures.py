"""tools/ci_failures.py: the weekly count of CI failures per workflow and job."""
from datetime import date
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools import ci_failures  # noqa: E402


def run(id, name, event="pull_request", branch="feature", conclusion="success", attempt=1):
    return {"id": id, "name": name, "event": event, "head_branch": branch, "conclusion": conclusion, "run_attempt": attempt}


def job(name, attempt, conclusion):
    return {"name": name, "run_attempt": attempt, "conclusion": conclusion}


class CountTests(unittest.TestCase):
    def test_only_develops_pushes_and_pull_requests_are_counted(self):
        self.assertTrue(ci_failures.counted(run(1, "w", "push", "develop")))
        self.assertTrue(ci_failures.counted(run(2, "w", "pull_request")))
        self.assertFalse(ci_failures.counted(run(3, "w", "push", "feature")))
        self.assertFalse(ci_failures.counted(run(4, "w", "schedule", "develop")))

    def test_a_failure_that_passed_when_run_again_is_told_apart(self):
        runs = [
            run(1, "voice", conclusion="success", attempt=2),
            run(2, "voice", conclusion="failure"),
            run(3, "voice"),
        ]
        jobs = {
            1: [job("core (windows)", 1, "failure"), job("headless", 1, "success"), job("core (windows)", 2, "success")],
            2: [job("core (windows)", 1, "failure"), job("headless", 1, "failure")],
        }
        asked = []

        def jobs_of(r):
            asked.append(r["id"])
            return jobs[r["id"]]

        table, totals = ci_failures.tally(runs, jobs_of)
        self.assertEqual(asked, [1, 2], "a run that passed on its only try is not asked for its jobs")
        self.assertEqual(dict(table[("voice", "core (windows)")]), {"failed": 2, "passed_again": 1})
        self.assertEqual(dict(table[("voice", "headless")]), {"failed": 1})
        self.assertEqual(dict(totals), {"runs": 3, "tries": 4, "failed_tries": 2})

    def test_the_table_lists_the_most_failing_job_first(self):
        table = {("w", "a"): {"failed": 1, "passed_again": 0}, ("w", "b"): {"failed": 3, "passed_again": 2}}
        lines = ci_failures.markdown(table, {"runs": 9, "tries": 10, "failed_tries": 4}, date(2026, 11, 17), date(2026, 11, 23))
        self.assertEqual(lines[0], "## CI failures from 2026-11-17 to 2026-11-23")
        rows = [line for line in lines if line.startswith("| w |")]
        self.assertEqual(rows, ["| w | b | 3 | 2 |", "| w | a | 1 | 0 |"])

    def test_a_week_without_failures_says_so(self):
        lines = ci_failures.markdown({}, {"runs": 2, "tries": 2, "failed_tries": 0}, date(2026, 11, 17), date(2026, 11, 23))
        self.assertIn("No job failed.", lines)

    def test_every_page_of_a_day_is_read(self):
        pages = {1: [{"id": i} for i in range(100)], 2: [{"id": 100}]}
        asked = []

        def fetch(path):
            page = int(path.rsplit("page=", 1)[1])
            asked.append(path)
            return {"workflow_runs": pages[page]}

        self.assertEqual(len(ci_failures.runs_of_day(date(2026, 11, 22), "o/r", fetch)), 101)
        self.assertIn("created=2026-11-22", asked[0])


if __name__ == "__main__":
    unittest.main()
