"""Lists the tests of a cargo-nextest JUnit report that passed only on a retry, or failed on
every try.

    python tools/ci/nextest_flaky_summary.py native/core/target/nextest/ci/junit.xml

The core-integration job runs native/core's tests under nextest's ci profile, which retries the
tests it names (native/core/.config/nextest.toml; none since issue #861 was settled). A pass on a
retry is still a failure of the first try, so this writes each one to the job summary
($GITHUB_STEP_SUMMARY) and shows it as a warning on the run. It never fails the job: the test run
itself does that.
"""
import os
import sys
import xml.etree.ElementTree as ElementTree


def outcomes(report):
    """(retried, failed): the tests that passed after failing, and those that failed on the last
    try, each as (name, tries, first failure's message)."""
    retried, failed = [], []
    for case in ElementTree.parse(report).getroot().iter("testcase"):
        name = f"{case.get('classname', '')} {case.get('name', '')}".strip()
        flaky = case.findall("flakyFailure")
        reruns = case.findall("rerunFailure")
        final = case.find("failure")
        if final is None:
            final = case.find("error")
        if final is not None:
            first = (reruns + [final])[0]
            failed.append((name, len(reruns) + 1, first.get("message", "")))
        elif flaky:
            retried.append((name, len(flaky) + 1, flaky[0].get("message", "")))
    return retried, failed


def summary(retried, failed):
    lines = ["## Tests that passed only on a retry", ""]
    if not retried and not failed:
        return lines + ["Every test passed on its first try.", ""]
    if retried:
        lines += ["| Test | Passed on try | First failure |", "|---|---:|---|"]
        lines += [f"| `{name}` | {tries} | {message.replace('|', '/')} |" for name, tries, message in retried]
        lines.append("")
    if failed:
        lines += [f"{len(failed)} test(s) failed on every try; the test step above lists them.", ""]
    return lines


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        return 2
    report = argv[1]
    if not os.path.isfile(report):
        print(f"No JUnit report at {report}: the tests did not run.")
        return 0
    retried, failed = outcomes(report)
    for name, tries, _ in retried:
        print(f"::warning title=Passed on a retry::{name} passed on try {tries}")
    text = "\n".join(summary(retried, failed)) + "\n"
    print(text)
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if target:
        with open(target, "a", encoding="utf-8") as out:
            out.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
