"""Counts the CI failures of the last days, per workflow and job (the CI audit of 2026-11-22, item 7).

    python3 -m tools.ci_failures --days 7

It reads the workflow runs of develop's pushes and of pull requests through `gh api`, and for each
run that failed or was run again, the jobs of every try. It writes a Markdown table to stdout and
to the job summary ($GITHUB_STEP_SUMMARY): per workflow and job, how many tries failed, and how
many of those passed when the same run was run again (a sign of a flaky test or a passing outage,
not of a broken change). It reads no logs; what failed inside a job is in its own log.
"""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
import os
import subprocess
import sys

REPOSITORY = "kein5/astarot"


def api(path):
    result = subprocess.run(["gh", "api", path], capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(result.stdout)


def runs_of_day(day, repository=REPOSITORY, fetch=api):
    """The runs created on `day` (a date), every page."""
    runs, page = [], 1
    while True:
        found = fetch(f"repos/{repository}/actions/runs?created={day.isoformat()}&per_page=100&page={page}")["workflow_runs"]
        runs += found
        if len(found) < 100:
            return runs
        page += 1


def counted(run):
    """develop's pushes and pull requests; not the scheduled, released or dispatched runs."""
    return (run["event"] == "push" and run["head_branch"] == "develop") or run["event"] == "pull_request"


def tally(runs, jobs_of):
    """{(workflow, job): Counter(failed=, passed_again=)} and Counter(runs=, tries=, failed_tries=).

    `jobs_of(run)` gives the jobs of every try of a run that failed or was run again. A try failed
    when one of its jobs failed; a failed job passed again when a later try of the same run has a
    job of that name that passed."""
    table, totals = {}, Counter()
    for run in runs:
        tries = run.get("run_attempt") or 1
        totals["runs"] += 1
        totals["tries"] += tries
        if run.get("conclusion") != "failure" and tries == 1:
            continue
        jobs = jobs_of(run)
        failed_tries = {job["run_attempt"] for job in jobs if job["conclusion"] == "failure"}
        totals["failed_tries"] += len(failed_tries)
        for job in jobs:
            if job["conclusion"] != "failure":
                continue
            row = table.setdefault((run["name"], job["name"]), Counter())
            row["failed"] += 1
            if any(other["name"] == job["name"] and other["run_attempt"] > job["run_attempt"]
                   and other["conclusion"] == "success" for other in jobs):
                row["passed_again"] += 1
    return table, totals


def markdown(table, totals, since, until):
    lines = [f"## CI failures from {since:%Y-%m-%d} to {until:%Y-%m-%d}", "",
             f"develop's pushes and pull requests: {totals['runs']} runs, {totals['tries']} tries, "
             f"{totals['failed_tries']} failed tries.", ""]
    if not table:
        return lines + ["No job failed.", ""]
    lines += ["| Workflow | Job | Failed tries | Passed when run again |", "|---|---|---:|---:|"]
    for (workflow, job), row in sorted(table.items(), key=lambda item: (-item[1]["failed"], item[0])):
        lines.append(f"| {workflow} | {job} | {row['failed']} | {row['passed_again']} |")
    return lines + ["", "A job that passed when run again failed for a passing reason: a flaky test "
                    "(issue #861 lists the known ones) or an outage. Find what failed in the job's log.", ""]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args(argv)
    until = datetime.now(timezone.utc).date()
    since = until - timedelta(days=args.days - 1)
    runs = [run for offset in range(args.days) for run in runs_of_day(since + timedelta(days=offset)) if counted(run)]

    def jobs_of(run):
        return api(f"repos/{REPOSITORY}/actions/runs/{run['id']}/jobs?filter=all&per_page=100")["jobs"]

    text = "\n".join(markdown(*tally(runs, jobs_of), since, until)) + "\n"
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
