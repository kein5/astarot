"""Security boundaries of the workflows: pinned external code, inputs kept out of scripts, and
the permissions and secrets each workflow may use. The Python backend's boundaries tested here
(the folder-opening command and the network probe) went with it in 0.6.0 (#285); the core's are
in native/core/tests.
"""
import json
from pathlib import Path
import re

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
# Workflow file -> the one job that signs build provenance for the release candidates.
ATTESTING_JOBS = {"build-linux.yml": "candidate", "release.yml": "candidate"}


@pytest.mark.parametrize("workflow", sorted((ROOT / ".github/workflows").glob("*.yml")), ids=lambda p: p.name)
def test_workflows_pin_external_code_and_keep_inputs_out_of_scripts(workflow):
    document = yaml.load(workflow.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    if workflow.name == "prepare-release.yml":
        assert set(document["on"]) == {"workflow_dispatch"}
        assert document["permissions"] == {"contents": "read", "actions": "read"}
        assert set(document["jobs"]) == {"draft"}
        draft = document["jobs"]["draft"]
        assert draft["permissions"] == {"contents": "write", "actions": "read", "attestations": "read"}
        assert "github.repository == 'kein5/astarot'" in draft["if"]
        assert "github.ref == 'refs/heads/develop'" in draft["if"]
        commands = "\n".join(step.get("run", "") for step in draft["steps"])
        assert "tools.prepare_release" in commands
        assert "'--draft'" in commands
        assert "release', 'edit'" not in commands
        # The updater signing key (issue #330) reaches one step, which signs the verified files
        # for this version and writes latest.json, and nothing else.
        signing = [step for step in draft["steps"] if "TAURI_SIGNING_PRIVATE_KEY" in step.get("env", {})]
        assert len(signing) == 1
        assert "--app-version" in signing[0]["run"]
        assert "tools.updater_manifest" in signing[0]["run"]
        assert "--require-verification" in signing[0]["run"]
    elif workflow.name == "pages.yml":
        # Deploying to GitHub Pages needs pages:write and id-token:write. Only the
        # deploy job gets them, only on develop in this repository, never for a PR.
        assert document["permissions"] == {"contents": "read"}
        assert set(document["jobs"]) == {"build", "deploy"}
        assert "permissions" not in document["jobs"]["build"]
        deploy = document["jobs"]["deploy"]
        assert deploy["permissions"] == {"pages": "write", "id-token": "write"}
        assert "github.repository == 'kein5/astarot'" in deploy["if"]
        assert "github.ref == 'refs/heads/develop'" in deploy["if"]
        assert "github.event_name != 'pull_request'" in deploy["if"]
        assert all("run" not in step for step in deploy["steps"])
    elif workflow.name == "release-draft-auto.yml":
        # Issue #417: after a release merge it starts the candidate workflows and prepare-release.yml,
        # which keeps every check. It may start workflows; it cannot write the repository or publish.
        assert set(document["on"]) == {"pull_request", "workflow_dispatch"}
        assert document["on"]["pull_request"] == {"types": ["closed"], "branches": ["main"]}
        assert document["permissions"] == {"contents": "read"}
        assert set(document["jobs"]) == {"draft"}
        job = document["jobs"]["draft"]
        assert job["permissions"] == {"contents": "read", "actions": "write"}
        for condition in ("github.repository == 'kein5/astarot'", "github.event.pull_request.merged == true",
                          "startsWith(github.event.pull_request.head.ref, 'release/')",
                          "github.event.pull_request.head.repo.full_name == github.repository",
                          "github.ref == 'refs/heads/main'", "github.ref == 'refs/heads/develop'"):
            assert condition in job["if"], condition
        commands = "\n".join(step.get("run", "") for step in job["steps"])
        assert "tools.release_automation draft" in commands
        assert "gh release" not in commands and "gh pr" not in commands
    elif workflow.name == "release-back-merge.yml":
        # Issue #417: a published stable release opens the pull request from main back into develop.
        # It creates that branch and the pull request, and merges nothing.
        assert set(document["on"]) == {"release"}
        assert document["on"]["release"] == {"types": ["published"]}
        assert document["permissions"] == {"contents": "read"}
        assert set(document["jobs"]) == {"back-merge"}
        job = document["jobs"]["back-merge"]
        assert job["permissions"] == {"contents": "write", "pull-requests": "write"}
        assert "github.repository == 'kein5/astarot'" in job["if"]
        assert "github.event.release.prerelease == false" in job["if"]
        commands = "\n".join(step.get("run", "") for step in job["steps"])
        assert "tools.release_automation back-merge" in commands
        assert "gh pr merge" not in commands and "git push" not in commands
    elif workflow.name == "update-channels.yml":
        # Issue #466: a published release points the beta update channel at the newest release. It
        # writes one file on the branch updater-channels through the API, and publishes nothing.
        assert set(document["on"]) == {"release", "workflow_dispatch"}
        assert document["on"]["release"] == {"types": ["published"]}
        assert document["permissions"] == {"contents": "read"}
        assert set(document["jobs"]) == {"beta"}
        job = document["jobs"]["beta"]
        assert job["permissions"] == {"contents": "write"}
        assert "github.repository == 'kein5/astarot'" in job["if"]
        commands = "\n".join(step.get("run", "") for step in job["steps"])
        assert commands.strip() == "python3 -m tools.update_channels beta"
        assert all(step.get("with", {}).get("persist-credentials") == "false"
                   for step in job["steps"] if step.get("uses", "").startswith("actions/checkout@"))
    elif workflow.name == "publish-badges.yml":
        # Publishes shields.io endpoint JSON files on the `badges` branch after voice-tests.yml
        # completes on develop. It runs from develop's copy, never on pull requests, and writes
        # only through tools.test_badges publish.
        assert set(document["on"]) == {"workflow_run", "workflow_dispatch"}
        assert document["on"]["workflow_run"] == {"workflows": ["VRCT-VOX voice contracts (no models)"], "types": ["completed"]}
        assert document["permissions"] == {"contents": "read"}
        assert set(document["jobs"]) == {"publish"}
        job = document["jobs"]["publish"]
        assert job["permissions"] == {"actions": "read", "contents": "write"}
        for condition in ("github.repository == 'kein5/astarot'",
                          "github.event.workflow_run.event == 'push'",
                          "github.event.workflow_run.head_branch == 'develop'",
                          "github.event.workflow_run.head_repository.full_name == github.repository",
                          "github.ref == 'refs/heads/develop'"):
            assert condition in job["if"], condition
        commands = "\n".join(step.get("run", "") for step in job["steps"])
        assert "python3 -m tools.test_badges publish" in commands
        assert all(step.get("with", {}).get("persist-credentials") == "false"
                   for step in job["steps"] if step.get("uses", "").startswith("actions/checkout@"))
    elif workflow.name == "ci-failures.yml":
        # The weekly count of CI failures (the CI audit of 2026-11-22, item 7): it reads the runs
        # and their jobs, writes only its job summary, and runs no input of anyone's.
        assert set(document["on"]) == {"schedule", "workflow_dispatch"}
        assert document["permissions"] == {"contents": "read"}
        assert set(document["jobs"]) == {"count"}
        job = document["jobs"]["count"]
        assert job["permissions"] == {"contents": "read", "actions": "read"}
        assert "github.repository == 'kein5/astarot'" in job["if"]
        commands = "\n".join(step.get("run", "") for step in job["steps"])
        assert commands.strip() == "python3 -m tools.ci_failures --days 7"
        assert all(step.get("with", {}).get("persist-credentials") == "false"
                   for step in job["steps"] if step.get("uses", "").startswith("actions/checkout@"))
    elif workflow.name == "pipeline-latency.yml":
        # Issue #738: after voice-tests.yml it sends the pipeline's measured times to Bencher. It
        # runs from develop's copy of the file, never a pull request's, checks out nothing, and
        # sends only develop's pushes and this repository's pull requests. Its job may read the
        # measuring run's artifacts and write the Bencher check and comment, nothing else; the
        # Bencher key reaches the two sending steps, and the step that sees whether it is set.
        assert set(document["on"]) == {"workflow_run"}
        assert document["on"]["workflow_run"] == {"workflows": ["ASTAROT voice contracts (no models)"], "types": ["completed"]}
        assert document["permissions"] == {"contents": "read"}
        assert set(document["jobs"]) == {"send"}
        job = document["jobs"]["send"]
        assert job["permissions"] == {"actions": "read", "checks": "write", "pull-requests": "write"}
        for condition in ("github.repository == 'kein5/astarot'",
                          "github.event.workflow_run.head_repository.full_name == github.repository",
                          "github.event.workflow_run.head_branch == 'develop'"):
            assert condition in job["if"], condition
        assert all(not step.get("uses", "").startswith("actions/checkout@") for step in job["steps"])
        assert "secrets." not in json.dumps({key: value for key, value in job.items() if key != "steps"})
        keyed = [step for step in job["steps"] if "BENCHER_API_KEY" in step.get("env", {})]
        assert len(keyed) == 2
        assert all(step["run"].startswith("bencher run ") and "--error-on-alert" not in step["run"] for step in keyed)
    elif workflow.name == "bencher-measures.yml":
        # Issue #738: gives the two Bencher measures their units, by hand and on develop only. It
        # checks out nothing, and the Bencher key reaches one step, which runs bencher measure
        # commands and nothing else.
        assert set(document["on"]) == {"workflow_dispatch"}
        assert document["permissions"] == {"contents": "read"}
        assert set(document["jobs"]) == {"measures"}
        job = document["jobs"]["measures"]
        assert "permissions" not in job
        for condition in ("github.repository == 'kein5/astarot'", "github.ref == 'refs/heads/develop'"):
            assert condition in job["if"], condition
        assert all(not step.get("uses", "").startswith("actions/checkout@") for step in job["steps"])
        keyed = [step for step in job["steps"] if "BENCHER_API_KEY" in step.get("env", {})]
        assert len(keyed) == 1
        commands = [line.strip() for line in keyed[0]["run"].splitlines() if "bencher " in line]
        assert commands and all(re.search(r"(^|\s)bencher measure (view|update|create|list) ", command)
                                for command in commands), commands
    elif workflow.name in ATTESTING_JOBS:
        # The candidate job signs build provenance (second security audit SEC-04): only that job
        # gets id-token and attestations, and only a manual run uses them.
        assert document["permissions"] == {"contents": "read"}
        for name, job in document["jobs"].items():
            if name != ATTESTING_JOBS[workflow.name]:
                assert "permissions" not in job, name
                continue
            assert job["permissions"] == {"contents": "read", "id-token": "write", "attestations": "write"}
            attest = [step for step in job["steps"] if step.get("uses", "").startswith("actions/attest-build-provenance@")]
            assert len(attest) == 1
            assert attest[0]["if"] == "github.event_name == 'workflow_dispatch'"
            assert attest[0]["with"]["subject-path"].endswith("release-candidate/*")
            # A cache may serve pull request runs only: a manual run builds the release
            # candidate, and it builds without caches.
            for step in job["steps"]:
                if re.match(r"(actions/cache|Swatinem/rust-cache)(/[\w-]+)?@", step.get("uses", "")):
                    assert step.get("if") == "github.event_name == 'pull_request'", step.get("name", step["uses"])
    else:
        assert document["permissions"] == {"contents": "read"}
        assert all("permissions" not in job for job in document["jobs"].values())
    for job in document["jobs"].values():
        for step in job.get("steps", []):
            if "uses" in step and not step["uses"].startswith("./"):
                assert re.fullmatch(r"[\w-]+/[\w./-]+@[0-9a-f]{40}", step["uses"]), step["uses"]
            assert "${{" not in step.get("run", ""), step.get("name", workflow.name)
            # Repository secrets: only the updater signing step of the release draft and its check of
            # immutable releases (issue #1018) use any, and the Bencher key the steps of
            # pipeline-latency.yml that send with it and the one step of bencher-measures.yml.
            if "secrets." in json.dumps(step):
                assert workflow.name in ("prepare-release.yml", "pipeline-latency.yml", "bencher-measures.yml"), step.get("name")
                if workflow.name == "prepare-release.yml" and "IMMUTABLE_RELEASES_READ_TOKEN" in json.dumps(step):
                    # The settings token reads one setting, in a step that runs nothing else.
                    assert step["env"] == {"GH_TOKEN": "${{ secrets.IMMUTABLE_RELEASES_READ_TOKEN }}"}
                    assert step["run"].strip() == "python -m tools.prepare_release immutable-releases"
                    assert "secrets." not in json.dumps({key: value for key, value in step.items() if key != "env"})
                elif workflow.name == "prepare-release.yml":
                    assert set(step["env"]) == {"TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"}
                else:
                    assert set(re.findall(r"secrets\.\w+", json.dumps(step))) == {"secrets.BENCHER_API_KEY"}, step.get("name")
                    assert "secrets." not in json.dumps({key: value for key, value in step.items() if key != "env"})
