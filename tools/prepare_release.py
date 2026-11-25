"""Download successful manual candidates at this commit; prepare a release draft."""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import quote

from tools.release_candidate import REPOSITORY, ROOT, needs_sidecar, verify

WORKFLOWS = {"linux": "build-linux.yml", "windows": "release.yml"}
# main publishes stable releases; develop publishes betas (GitHub prereleases).
CHANNELS = {
    "main": ("stable", r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"),
    "develop": ("beta", r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-beta\.[1-9][0-9]*"),
}


def release_channel(branch, version):
    """The channel of a release from `branch`; its version must match it."""
    if branch not in CHANNELS:
        raise ValueError("Releases are made only from main (stable) or develop (beta)")
    channel, pattern = CHANNELS[branch]
    if not isinstance(version, str) or not re.fullmatch(pattern, version):
        raise ValueError(
            "main releases need a version X.Y.Z and develop releases X.Y.Z-beta.N"
        )
    return channel


def check_run(run, platform, commit, branch):
    expected = dict(
        conclusion="success",
        status="completed",
        event="workflow_dispatch",
        head_branch=branch,
        head_sha=commit,
        path=f".github/workflows/{WORKFLOWS[platform]}",
    )
    if any(run.get(key) != value for key, value in expected.items()):
        raise ValueError(
            "Candidate must be a successful manual build of the release branch at the requested commit"
        )
    if any(
        run.get(key, {}).get("full_name") != REPOSITORY
        for key in ("repository", "head_repository")
    ):
        raise ValueError("Candidate must originate in the canonical repository")


def verify_provenance(directory, platform, commit, branch):
    """Every file of a candidate must carry a signed build provenance attestation (second security
    audit SEC-04): made by this platform's candidate workflow in this repository, from this commit
    of the release branch, on a GitHub-hosted runner. The SHA-256 files alone cannot show that,
    because whoever could replace an asset could replace its checksum too.
    """
    workflow = f"{REPOSITORY}/.github/workflows/{WORKFLOWS[platform]}"
    for path in sorted(path for path in directory.iterdir() if path.is_file()):
        subprocess.run(
            [
                "gh", "attestation", "verify", str(path),
                "--repo", REPOSITORY,
                "--signer-workflow", workflow,
                "--source-digest", commit,
                "--source-ref", f"refs/heads/{branch}",
                "--deny-self-hosted-runners",
                "--format", "json",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )


def prepare(output, run_ids, commit, version, branch):
    # Never execute downloaded code. Only allowlisted files from verified runs
    # are copied to the draft payload; candidate integrity is a hard failure.
    release_channel(branch, version)
    output.mkdir(parents=True, exist_ok=False)
    payload = output / "payload"
    payload.mkdir()
    for platform, run_id in run_ids.items():
        if not re.fullmatch(r"[1-9][0-9]*", run_id):
            raise ValueError("A numeric workflow run ID is required")
        raw = subprocess.check_output(
            ["gh", "api", f"repos/{REPOSITORY}/actions/runs/{run_id}"], text=True
        )
        run = json.loads(raw)
        check_run(run, platform, commit, branch)
        directory = output / platform
        artifact = (
            # The candidate workflows' artifacts (VRCT-VOX-… up to 0.6.x; ADR-014, 2.2).
            "ASTAROT-linux-x86_64-candidate"
            if platform == "linux"
            else "ASTAROT-windows-candidate"
        )
        subprocess.run(
            [
                "gh",
                "run",
                "download",
                run_id,
                "--repo",
                REPOSITORY,
                "--name",
                artifact,
                "--dir",
                str(directory),
            ],
            check=True,
        )
        manifest = verify(directory, platform, commit, version)
        verify_provenance(directory, platform, commit, branch)
        for entry in manifest["assets"]:
            destination = payload / entry["name"]
            if destination.exists():
                raise ValueError("Overlapping candidate names")
            shutil.copyfile(directory / entry["name"], destination)
            if needs_sidecar(platform, entry["name"]):
                shutil.copyfile(
                    directory / (entry["name"] + ".sha256"),
                    payload / (entry["name"] + ".sha256"),
                )
        shutil.copyfile(
            directory / "candidate-manifest.json",
            payload / f"candidate-{platform}.json",
        )
        shutil.copyfile(directory / "SHA256SUMS", payload / f"SHA256SUMS-{platform}")
    return payload


def require_unused_tag(version):
    """Reject existing tags, including annotated tags, without changing any ref."""
    endpoint = f"repos/{REPOSITORY}/git/matching-refs/tags/" + quote(
        "v" + version, safe=""
    )
    # Successful empty matches are the only absence signal. HTTP, permission,
    # authentication and network errors all propagate as failures.
    pages = json.loads(
        subprocess.check_output(
            ["gh", "api", endpoint, "--paginate", "--slurp"], text=True
        )
    )
    if (
        not isinstance(pages, list)
        or not pages
        or any(not isinstance(page, list) for page in pages)
    ):
        raise ValueError("Unexpected GitHub tag lookup response")
    for page in pages:
        for ref in page:
            if not isinstance(ref, dict) or not isinstance(ref.get("ref"), str):
                raise ValueError("Unexpected GitHub tag record")
            if ref["ref"] == "refs/tags/v" + version:
                raise ValueError(
                    "Release tag already exists; choose a new version instead of retargeting it"
                )


# A fine-grained token that can only read this repository's administration settings (issue #1018).
# Whether immutable releases are on can be read only with admin read access, which a workflow's
# GITHUB_TOKEN cannot be given. prepare-release.yml passes this secret to the one step that checks.
SETTINGS_TOKEN_SECRET = "IMMUTABLE_RELEASES_READ_TOKEN"


def require_immutable_releases(run=None):
    """Stop unless GitHub's immutable releases are on for this repository (issue #1018).

    The Windows installer checks another version's package (/VERSION) only against the .sha256
    file next to it on the same release page; immutable releases are what keep both from being
    replaced once a release is published. The API answers 404 when the setting is off, and also
    when the token cannot read it, so both stop here with the same message."""
    if not os.environ.get("GH_TOKEN"):
        raise ValueError(
            f"GH_TOKEN is empty: give this step the {SETTINGS_TOKEN_SECRET} secret "
            "(a fine-grained token with Administration: read on this repository)"
        )
    result = (run or subprocess.run)(
        ["gh", "api", f"repos/{REPOSITORY}/immutable-releases"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        if "HTTP 404" in result.stderr:
            raise ValueError(
                "Immutable releases are off for this repository, or the token cannot read the "
                f"setting ({SETTINGS_TOKEN_SECRET}); turn them on before making a draft (issue #1018)"
            )
        raise ValueError("Could not read whether immutable releases are on: " + result.stderr.strip())
    state = json.loads(result.stdout)
    if not isinstance(state, dict) or state.get("enabled") is not True:
        raise ValueError("Immutable releases are off for this repository; turn them on before making a draft (issue #1018)")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    # Its own step in prepare-release.yml, the only one that gets the settings token.
    if argv == ["immutable-releases"]:
        require_immutable_releases()
        print("Immutable releases are on")
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--linux-run", required=True)
    parser.add_argument("--windows-run", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--branch", required=True, choices=sorted(CHANNELS))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    payload = prepare(
        args.output,
        {"linux": args.linux_run, "windows": args.windows_run},
        args.commit,
        version,
        args.branch,
    )
    print(f"Verified draft assets: {payload}")


if __name__ == "__main__":
    main()
