"""Release steps that follow a maintainer's action, so that no one has to start them by hand.

    python -m tools.release_automation draft --branch main --commit <sha>
    python -m tools.release_automation back-merge --tag v0.6.0

draft runs when a release pull request is merged into main (.github/workflows/release-draft-auto.yml),
and by hand on main or develop. It reuses or starts the manual Linux and Windows candidate builds at
the commit, waits for them, then starts "Prepare verified ASTAROT release draft" with their run IDs.
That workflow still checks the runs, every hash and the build provenance, and makes a draft only.

back-merge runs when a stable release is published (.github/workflows/release-back-merge.yml). It
creates chore/merge-main-back-<version> at the release's commit and opens a pull request from it
into develop. It never merges; conflicts are resolved on that branch.

Publishing a draft, and the checks on real PCs before it, stay with a maintainer.
"""

import argparse
import datetime
import json
import os
import subprocess
import sys
import time
from urllib.parse import quote

from tools import prepare_release
from tools.prepare_release import WORKFLOWS, check_run, release_channel
from tools.release_candidate import REPOSITORY, ROOT

DRAFT_WORKFLOW = "prepare-release.yml"
# The candidate workflows keep their files for 7 days (retention-days); an older run cannot be used.
REUSABLE_FOR = datetime.timedelta(days=6)
POLL_SECONDS = 60
# A dispatched run is listed by the API a few seconds after the dispatch.
APPEAR_SECONDS = 300
BACK_MERGE_BASE = "develop"


class ReleaseAutomationError(Exception):
    pass


class GitHub:
    """The GitHub calls these steps make, through the gh CLI with the job's token (GH_TOKEN)."""

    def api(self, path, *fields, method="GET"):
        command = ["gh", "api", path]
        if method != "GET":
            command += ["--method", method]
        for name, value in fields:
            command += ["-f", f"{name}={value}"]
        output = subprocess.check_output(command, text=True, encoding="utf-8")
        return json.loads(output) if output.strip() else None

    def dispatch(self, workflow, branch, inputs=()):
        command = ["gh", "workflow", "run", workflow, "--repo", REPOSITORY, "--ref", branch]
        for name, value in inputs:
            command += ["-f", f"{name}={value}"]
        subprocess.run(command, check=True)

    def require_unused_tag(self, version):
        prepare_release.require_unused_tag(version)

    def open_pull_request(self, base, head, title, body):
        result = subprocess.run(["gh", "pr", "create", "--repo", REPOSITORY, "--base", base, "--head", head,
                                 "--title", title, "--body", body],
                                capture_output=True, text=True, encoding="utf-8")
        if result.returncode != 0:
            raise ReleaseAutomationError(f"gh pr create failed: {result.stderr.strip()}")
        return result.stdout.strip()


def describe(run):
    return f"run {run['id']} ({run.get('html_url', 'no address')})"


def created(run):
    return datetime.datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))


def manual_runs(github, workflow, branch, commit):
    """The manual runs of a workflow on a branch at a commit, newest first."""
    path = (f"repos/{REPOSITORY}/actions/workflows/{workflow}/runs?event=workflow_dispatch"
            f"&branch={quote(branch, safe='')}&head_sha={commit}&per_page=30")
    runs = (github.api(path) or {}).get("workflow_runs") or []
    # The query filters again here: only a manual run of this branch at this commit counts.
    runs = [run for run in runs if run.get("event") == "workflow_dispatch" and run.get("head_branch") == branch
            and run.get("head_sha") == commit]
    return sorted(runs, key=lambda run: run["created_at"], reverse=True)


def usable_run(runs, now):
    """A successful run to use, else one still running to wait for, else None. A run that failed or
    was cancelled is never used, and a run whose files may have expired is left alone."""
    fresh = [run for run in runs if now - created(run) < REUSABLE_FOR]
    done = next((run for run in fresh if run.get("status") == "completed" and run.get("conclusion") == "success"), None)
    return done or next((run for run in fresh if run.get("status") != "completed"), None)


def start_run(github, workflow, branch, commit, inputs=(), *, clock, sleep):
    """Starts a workflow on the branch and returns its run. The branch must still be at the commit:
    a dispatched run builds the branch's head, whatever commit that is."""
    head = github.api(f"repos/{REPOSITORY}/branches/{quote(branch, safe='')}")["commit"]["sha"]
    if head != commit:
        raise ReleaseAutomationError(
            f"{branch} is at {head[:12]}, not {commit[:12]}, so {workflow} would run on another commit; "
            f"start the runs for {commit[:12]} by hand (docs/voice-stack/release-candidates.md)")
    known = {run["id"] for run in manual_runs(github, workflow, branch, commit)}
    github.dispatch(workflow, branch, inputs)
    deadline = clock() + APPEAR_SECONDS
    while True:
        new = [run for run in manual_runs(github, workflow, branch, commit) if run["id"] not in known]
        if new:
            return new[0]
        if clock() >= deadline:
            raise ReleaseAutomationError(f"the {workflow} run started on {branch} did not appear for {commit[:12]}")
        sleep(10)


def wait_for(github, run, deadline, *, clock, sleep):
    """Polls a run until it completes; anything but success stops here."""
    while run.get("status") != "completed":
        if clock() >= deadline:
            raise ReleaseAutomationError(f"{describe(run)} did not finish in time")
        sleep(POLL_SECONDS)
        run = github.api(f"repos/{REPOSITORY}/actions/runs/{run['id']}")
    if run.get("conclusion") != "success":
        raise ReleaseAutomationError(f"{describe(run)} ended as {run.get('conclusion')}; nothing after it was started")
    return run


def draft(github, branch, commit, version, *, clock=time.monotonic, sleep=time.sleep, now=None,
          wait_seconds=300 * 60, report=print):
    """Gets the candidates at the commit built, then the draft prepared. Returns the draft's run."""
    release_channel(branch, version)  # ValueError: main makes X.Y.Z, develop X.Y.Z-beta.N
    github.require_unused_tag(version)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    deadline = clock() + wait_seconds
    report(f"Release draft for v{version} from {branch} at {commit}")
    prepared = usable_run(manual_runs(github, DRAFT_WORKFLOW, branch, commit), now)
    if prepared and prepared.get("status") == "completed":
        report(f"- The draft was already prepared at this commit by {describe(prepared)}; nothing was started.")
        return prepared
    if prepared is None:
        runs = {}
        for platform, workflow in WORKFLOWS.items():
            run = usable_run(manual_runs(github, workflow, branch, commit), now)
            if run is None:
                run = start_run(github, workflow, branch, commit, clock=clock, sleep=sleep)
                report(f"- Started the {platform} candidate: {describe(run)}")
            else:
                report(f"- Using the {platform} candidate: {describe(run)}")
            runs[platform] = run
        for platform, run in runs.items():
            runs[platform] = wait_for(github, run, deadline, clock=clock, sleep=sleep)
            # The same check the draft workflow makes, before it is started.
            check_run(runs[platform], platform, commit, branch)
        inputs = (("linux_run", str(runs["linux"]["id"])), ("windows_run", str(runs["windows"]["id"])))
        prepared = start_run(github, DRAFT_WORKFLOW, branch, commit, inputs, clock=clock, sleep=sleep)
        report(f"- Started the draft: {describe(prepared)}")
    prepared = wait_for(github, prepared, clock() + 30 * 60, clock=clock, sleep=sleep)
    report(f"- The draft of v{version} is ready on the Releases page. It stays a draft until a maintainer "
           f"publishes it. Before that, confirm that its tag is v{version} and that it targets {commit}, put the "
           "release notes in its body, and run the checks on real PCs (docs/voice-stack/release-candidates.md).")
    return prepared


BACK_MERGE_BODY = """## Summary / 概要

{tag}の公開のあとに`main`を`develop`へ戻すPRです。リリースの公開をきっかけに自動で開きました。自動ではマージしません。

- 戻すコミット: {commit}（{tag}）
- 競合したら、このブランチ`{branch}`の上で解いてください。`develop`の版を先に次の`-beta.N`へ進めていたときは、版の行は`develop`の側を残します（[配布候補とリリース下書き](https://github.com/{repository}/blob/develop/docs/voice-stack/release-candidates.md)）。
- 統合はマージコミットで行います。

## Verification / 確認したこと

このPRはGitHub Actionsのトークンで開いたので、PRのチェックは自動では始まりません。一度閉じて開き直すか、競合を解いたコミットをpushするとチェックが始まります。
"""


def back_merge(github, tag, *, report=print):
    """Opens the pull request that merges a published stable release back into develop. Returns its
    address, or None when there is nothing to merge back."""
    version = tag[1:] if tag.startswith("v") else ""
    try:
        release_channel("main", version)
    except ValueError:
        report(f"{tag} is not a stable release; a beta comes from develop and needs no back-merge.")
        return None
    commit = github.api(f"repos/{REPOSITORY}/commits/{quote(tag, safe='')}")["sha"]

    def contains(branch):
        status = github.api(f"repos/{REPOSITORY}/compare/{quote(branch, safe='')}...{commit}")["status"]
        return status in ("behind", "identical")

    if not contains("main"):
        raise ReleaseAutomationError(f"{tag} ({commit[:12]}) is not on main; merge it back by hand if it should be")
    if contains(BACK_MERGE_BASE):
        report(f"{BACK_MERGE_BASE} already contains {tag} ({commit[:12]}); no pull request is needed.")
        return None
    branch = f"chore/merge-main-back-{version}"
    owner = REPOSITORY.split("/")[0]
    pulls = github.api(f"repos/{REPOSITORY}/pulls?state=open&base={BACK_MERGE_BASE}&head={owner}:{quote(branch, safe='')}")
    if pulls:
        report(f"The back-merge pull request is already open: {pulls[0]['html_url']}")
        return pulls[0]["html_url"]
    refs = github.api(f"repos/{REPOSITORY}/git/matching-refs/heads/{quote(branch, safe='/')}") or []
    if any(ref.get("ref") == f"refs/heads/{branch}" for ref in refs):
        # The branch is kept as it is: it may already hold a resolved conflict.
        report(f"Using the existing branch {branch}.")
    else:
        github.api(f"repos/{REPOSITORY}/git/refs", ("ref", f"refs/heads/{branch}"), ("sha", commit), method="POST")
        report(f"Created {branch} at {commit}.")
    title = f"chore(release): merge main ({version}) back into develop"
    body = BACK_MERGE_BODY.format(tag=tag, commit=commit, branch=branch, repository=REPOSITORY)
    try:
        address = github.open_pull_request(BACK_MERGE_BASE, branch, title, body)
    except ReleaseAutomationError as error:
        link = f"https://github.com/{REPOSITORY}/compare/{BACK_MERGE_BASE}...{branch}?expand=1"
        raise ReleaseAutomationError(
            f"{error}. The branch {branch} is ready: open the pull request from {link}, or allow GitHub Actions "
            "to create pull requests in the repository settings and run this job again") from None
    report(f"Opened the back-merge pull request: {address}. Its checks start once it is closed and reopened "
           "or a commit is pushed to it.")
    return address


def summary_writer():
    """Prints each line and adds it to the job summary when the job has one."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")

    def report(line):
        print(line, flush=True)
        if path:
            with open(path, "a", encoding="utf-8") as summary:
                summary.write(line + "\n")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    start = commands.add_parser("draft", help="get the candidates built and the release draft prepared")
    start.add_argument("--branch", required=True, choices=sorted(prepare_release.CHANNELS))
    start.add_argument("--commit", required=True)
    start.add_argument("--wait-minutes", type=int, default=300, help="how long to wait for the candidates")
    back = commands.add_parser("back-merge", help="open the pull request from main back into develop")
    back.add_argument("--tag", required=True)
    args = parser.parse_args(argv)
    report = summary_writer()
    try:
        if args.command == "draft":
            version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
            draft(GitHub(), args.branch, args.commit, version, wait_seconds=args.wait_minutes * 60, report=report)
        else:
            back_merge(GitHub(), args.tag, report=report)
    except (ReleaseAutomationError, ValueError, subprocess.CalledProcessError) as error:
        print(f"::error::{error}", flush=True)
        report(f"Stopped: {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
