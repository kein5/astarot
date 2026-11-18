"""tools/release_automation.py: the release draft after a release merge, the back-merge after publishing.

GitHub is replaced by a recording fake; nothing is started, created or merged for real."""
import datetime

import pytest

from tools import release_automation as ra

REPO = "kein5/astarot"
SHA = "a" * 40
OTHER = "b" * 40
NOW = datetime.datetime(2026, 11, 20, 12, 0, tzinfo=datetime.timezone.utc)


def stamp(days_ago=0):
    return (NOW - datetime.timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


class FakeGitHub:
    def __init__(self, heads=None):
        self.heads = heads or {"main": SHA, "develop": OTHER}
        self.runs = {"build-linux.yml": [], "release.yml": [], "prepare-release.yml": []}
        self.outcomes = {}  # workflow -> conclusion of the runs it starts; None never finishes
        self.dispatched = []
        self.tags = set()
        self.compare = {"main": "identical", "develop": "diverged"}
        self.pulls = []
        self.refs = []
        self.created_refs = []
        self.opened = []
        self.refuse_pull_requests = False
        self.next_id = 1000
        self.calls = []

    def run(self, workflow, branch="main", commit=SHA, status="completed", conclusion="success", days_ago=0):
        self.next_id += 1
        run = {"id": self.next_id, "status": status, "conclusion": conclusion if status == "completed" else None,
               "event": "workflow_dispatch", "head_branch": branch, "head_sha": commit, "created_at": stamp(days_ago),
               "path": f".github/workflows/{workflow}", "repository": {"full_name": REPO},
               "head_repository": {"full_name": REPO}, "html_url": f"https://github.com/{REPO}/actions/runs/{self.next_id}",
               "workflow": workflow}
        self.runs[workflow].append(run)
        return run

    def api(self, path, *fields, method="GET"):
        self.calls.append((method, path, fields))
        prefix = f"repos/{REPO}/"
        assert path.startswith(prefix), path
        path = path[len(prefix):]
        if path.startswith("actions/workflows/"):
            workflow = path.split("/")[2]
            return {"workflow_runs": [dict(run) for run in self.runs[workflow]]}
        if path.startswith("actions/runs/"):
            run = next(run for runs in self.runs.values() for run in runs if run["id"] == int(path.split("/")[2]))
            outcome = self.outcomes.get(run["workflow"], "success")
            if run["status"] != "completed" and outcome is not None:
                run.update(status="completed", conclusion=outcome)
            return dict(run)
        if path.startswith("branches/"):
            return {"commit": {"sha": self.heads[path.split("/", 1)[1]]}}
        if path.startswith("commits/"):
            return {"sha": SHA}
        if path.startswith("compare/"):
            return {"status": self.compare[path.split("/")[1].split("...")[0]]}
        if path.startswith("pulls?"):
            return self.pulls
        if path.startswith("git/matching-refs/"):
            return self.refs
        if path == "git/refs" and method == "POST":
            self.created_refs.append(dict(fields))
            return {}
        raise AssertionError(path)

    def dispatch(self, workflow, branch, inputs=()):
        self.dispatched.append((workflow, branch, dict(inputs)))
        self.run(workflow, branch, self.heads[branch], status="queued")

    def require_unused_tag(self, version):
        if version in self.tags:
            raise ValueError("Release tag already exists")

    def open_pull_request(self, base, head, title, body):
        if self.refuse_pull_requests:
            raise ra.ReleaseAutomationError("gh pr create failed: GitHub Actions is not permitted to create pull requests")
        self.opened.append({"base": base, "head": head, "title": title, "body": body})
        return f"https://github.com/{REPO}/pull/700"


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def run_draft(github, branch="main", commit=SHA, version="0.6.0", **kwargs):
    clock = Clock()
    lines = []
    result = ra.draft(github, branch, commit, version, clock=clock, sleep=clock.sleep, now=NOW, report=lines.append, **kwargs)
    return result, lines


def test_a_merged_release_builds_both_candidates_then_starts_the_draft():
    github = FakeGitHub()
    result, lines = run_draft(github)
    assert [(workflow, branch) for workflow, branch, _ in github.dispatched] == [
        ("build-linux.yml", "main"), ("release.yml", "main"), ("prepare-release.yml", "main")]
    linux, windows = github.runs["build-linux.yml"][0], github.runs["release.yml"][0]
    assert github.dispatched[2][2] == {"linux_run": str(linux["id"]), "windows_run": str(windows["id"])}
    assert result["conclusion"] == "success"
    # The draft is left for a maintainer, who checks the tag and the commit before publishing.
    assert "confirm that its tag is v0.6.0 and that it targets " + SHA in lines[-1]


def test_successful_candidates_at_the_commit_are_used_as_they_are():
    github = FakeGitHub()
    linux = github.run("build-linux.yml", days_ago=1)
    windows = github.run("release.yml")
    run_draft(github)
    assert github.dispatched == [("prepare-release.yml", "main",
                                  {"linux_run": str(linux["id"]), "windows_run": str(windows["id"])})]


def test_a_running_candidate_is_waited_for_and_not_started_again():
    github = FakeGitHub()
    running = github.run("release.yml", status="in_progress")
    run_draft(github)
    assert [workflow for workflow, _, _ in github.dispatched] == ["build-linux.yml", "prepare-release.yml"]
    assert github.dispatched[1][2]["windows_run"] == str(running["id"])


def test_failed_runs_and_runs_whose_files_may_have_expired_are_not_used():
    github = FakeGitHub()
    github.run("build-linux.yml", conclusion="failure")
    github.run("release.yml", days_ago=8)
    run_draft(github)
    assert [workflow for workflow, _, _ in github.dispatched] == ["build-linux.yml", "release.yml", "prepare-release.yml"]


def test_runs_of_another_commit_or_branch_are_not_used():
    github = FakeGitHub()
    github.run("build-linux.yml", commit=OTHER)
    github.run("release.yml", branch="develop")
    run_draft(github)
    assert [workflow for workflow, _, _ in github.dispatched] == ["build-linux.yml", "release.yml", "prepare-release.yml"]


def test_a_failed_candidate_stops_before_the_draft():
    github = FakeGitHub()
    github.outcomes["release.yml"] = "failure"
    with pytest.raises(ra.ReleaseAutomationError, match="ended as failure"):
        run_draft(github)
    assert "prepare-release.yml" not in [workflow for workflow, _, _ in github.dispatched]


def test_a_candidate_that_does_not_finish_in_time_stops_before_the_draft():
    github = FakeGitHub()
    github.outcomes["build-linux.yml"] = None
    with pytest.raises(ra.ReleaseAutomationError, match="did not finish in time"):
        run_draft(github, wait_seconds=600)
    assert "prepare-release.yml" not in [workflow for workflow, _, _ in github.dispatched]


def test_a_branch_that_moved_on_starts_nothing():
    """A dispatched run builds the branch's head; it would not be the merged commit."""
    github = FakeGitHub(heads={"main": OTHER})
    with pytest.raises(ra.ReleaseAutomationError, match="by hand"):
        run_draft(github)
    assert github.dispatched == []


@pytest.mark.parametrize("branch,version", [("main", "0.6.0-beta.1"), ("develop", "0.6.0"), ("feature/x", "0.6.0")])
def test_the_version_must_fit_the_branch(branch, version):
    github = FakeGitHub()
    with pytest.raises(ValueError):
        run_draft(github, branch=branch, version=version)
    assert github.calls == [] and github.dispatched == []


def test_an_existing_tag_starts_nothing():
    github = FakeGitHub()
    github.tags.add("0.6.0")
    with pytest.raises(ValueError, match="already exists"):
        run_draft(github)
    assert github.dispatched == []


def test_a_beta_from_develop_takes_the_same_path():
    github = FakeGitHub(heads={"develop": SHA})
    run_draft(github, branch="develop", version="0.6.0-beta.1")
    assert {branch for _, branch, _ in github.dispatched} == {"develop"}


def test_a_draft_already_prepared_at_the_commit_is_not_made_twice():
    github = FakeGitHub()
    done = github.run("prepare-release.yml")
    result, lines = run_draft(github)
    assert result["id"] == done["id"]
    assert github.dispatched == []
    assert "already prepared" in lines[-1]


def test_a_draft_being_prepared_is_waited_for():
    github = FakeGitHub()
    running = github.run("prepare-release.yml", status="in_progress")
    result, _ = run_draft(github)
    assert result["id"] == running["id"] and result["conclusion"] == "success"
    assert github.dispatched == []


def back_merge(github, tag="v0.6.0"):
    lines = []
    return ra.back_merge(github, tag, report=lines.append), lines


def test_a_published_release_opens_a_pull_request_into_develop():
    github = FakeGitHub()
    address, _ = back_merge(github)
    assert github.created_refs == [{"ref": "refs/heads/chore/merge-main-back-0.6.0", "sha": SHA}]
    [pull] = github.opened
    assert (pull["base"], pull["head"]) == ("develop", "chore/merge-main-back-0.6.0")
    assert pull["title"] == "chore(release): merge main (0.6.0) back into develop"
    assert SHA in pull["body"] and "閉じて開き直す" in pull["body"]
    assert address.endswith("/pull/700")


def test_a_beta_needs_no_back_merge():
    github = FakeGitHub()
    assert back_merge(github, "v0.6.0-beta.1")[0] is None
    assert github.calls == [] and github.opened == []


def test_nothing_to_merge_back_when_develop_has_the_release():
    github = FakeGitHub()
    github.compare["develop"] = "behind"
    assert back_merge(github)[0] is None
    assert github.created_refs == [] and github.opened == []


def test_a_release_that_is_not_on_main_stops():
    github = FakeGitHub()
    github.compare["main"] = "diverged"
    with pytest.raises(ra.ReleaseAutomationError, match="not on main"):
        back_merge(github)
    assert github.created_refs == [] and github.opened == []


def test_an_open_back_merge_pull_request_is_not_opened_again():
    github = FakeGitHub()
    github.pulls = [{"html_url": f"https://github.com/{REPO}/pull/650"}]
    assert back_merge(github)[0].endswith("/pull/650")
    assert github.created_refs == [] and github.opened == []


def test_an_existing_branch_is_kept_as_it_is():
    github = FakeGitHub()
    github.refs = [{"ref": "refs/heads/chore/merge-main-back-0.6.0"}]
    back_merge(github)
    assert github.created_refs == []
    assert len(github.opened) == 1


def test_when_actions_may_not_open_pull_requests_the_branch_and_a_link_are_left():
    github = FakeGitHub()
    github.refuse_pull_requests = True
    with pytest.raises(ra.ReleaseAutomationError) as error:
        back_merge(github)
    assert f"https://github.com/{REPO}/compare/develop...chore/merge-main-back-0.6.0?expand=1" in str(error.value)
    assert len(github.created_refs) == 1


def test_nothing_here_merges_or_publishes():
    """Publishing and merging stay with a maintainer."""
    source = (ra.ROOT / "tools" / "release_automation.py").read_text(encoding="utf-8")
    for command in ('"merge"', "pr merge", "release edit", "--draft=false", "/merges"):
        assert command not in source
