"""The beta channel's latest.json, which the update Worker serves (issue #466): which release it
names, what is refused, and what is written to the branch. Nothing here reaches the network."""

import base64
import json

import pytest

from tools import update_channels
from tools.update_channels import (
    BETA_PATH,
    BRANCH,
    UpdateChannelsError,
    beta,
    checked_manifest,
    newest_with_manifest,
    version_key,
)

REPO = "kein5/astarot"


def release(tag, draft=False, prerelease=None, url=None):
    url = url or f"https://github.com/{REPO}/releases/download/{tag}/latest.json"
    return {"tag_name": tag, "draft": draft, "prerelease": "-" in tag if prerelease is None else prerelease,
            "assets": [{"name": "latest.json", "browser_download_url": url}]}


def manifest(tag, url=None):
    version = tag.removeprefix("v")
    url = url or f"https://github.com/{REPO}/releases/download/{tag}/ASTAROT_setup.exe.zip"
    return json.dumps({"version": version, "platforms": {"windows-x86_64": {"url": url, "signature": "s"}}})


def test_versions_order_as_semver_orders_them():
    ordered = ["v0.5.2", "v0.6.0-beta.1", "v0.6.0-beta.2", "v0.6.0-beta.10", "v0.6.0-rc.1", "v0.6.0", "v0.6.1", "v0.10.0"]
    keys = [version_key(tag) for tag in ordered]
    assert keys == sorted(keys)
    for tag in ["0.6.0", "v0.6", "v0.6.0.1", "nightly", "v01.0.0", ""]:
        assert version_key(tag) is None, tag


def test_the_newest_release_with_a_manifest_is_named_beta_or_stable():
    releases = [release("v0.5.2"), release("v0.6.0-beta.2"), release("v0.6.0-beta.10"), release("v0.5.3")]
    assert newest_with_manifest(releases) == ("v0.6.0-beta.10", f"https://github.com/{REPO}/releases/download/v0.6.0-beta.10/latest.json")
    # A stable release newer than every beta is what the beta channel gets too.
    assert newest_with_manifest(releases + [release("v0.6.0")])[0] == "v0.6.0"


def test_drafts_other_tags_and_manifests_outside_the_releases_downloads_are_not_named():
    releases = [
        release("v0.5.2"),
        release("v0.7.0", draft=True),
        release("channel-beta"),
        release("v0.6.0", url="https://example.com/latest.json"),
        release("v0.6.1", url="https://github.com/someone-else/astarot/releases/download/v0.6.1/latest.json"),
        release("v0.6.2", url=f"https://github.com/{REPO}/releases/download/v0.6.0/latest.json"),
        {"tag_name": "v0.9.0", "draft": False, "assets": []},
    ]
    assert newest_with_manifest(releases)[0] == "v0.5.2"
    assert newest_with_manifest([]) is None


def test_only_the_releases_own_manifest_is_taken():
    assert checked_manifest(manifest("v0.6.0-beta.1"), "v0.6.0-beta.1")["version"] == "0.6.0-beta.1"
    for text in [
        "not json",
        json.dumps([]),
        manifest("v0.6.0-beta.2"),
        manifest("v0.6.0-beta.1", url="https://example.com/ASTAROT_setup.exe.zip"),
        manifest("v0.6.0-beta.1", url=f"https://github.com/{REPO}/releases/download/v0.5.2/ASTAROT_setup.exe.zip"),
        json.dumps({"version": "0.6.0-beta.1", "platforms": {}}),
    ]:
        with pytest.raises(UpdateChannelsError):
            checked_manifest(text, "v0.6.0-beta.1")


class FakeGitHub:
    """The branch as a dictionary of files, and the release list and its downloads."""

    def __init__(self, releases, downloads, files=None):
        self.releases, self.downloads = releases, downloads
        self.files = files  # None: no branch yet
        self.calls = []
        self.objects = {}

    def api(self, path, body=None, method="GET", missing_ok=False):
        self.calls.append((method, path))
        if path.startswith(f"repos/{REPO}/releases"):
            return self.releases
        if path == f"repos/{REPO}/git/ref/heads/{BRANCH}":
            return None if self.files is None else {"object": {"sha": "head"}}
        if path.startswith(f"repos/{REPO}/contents/{BETA_PATH}"):
            return {"sha": "current"} if self.files and BETA_PATH in self.files else None
        if path == f"repos/{REPO}/git/blobs/current":
            return {"content": base64.b64encode(self.files[BETA_PATH].encode()).decode()}
        if path == f"repos/{REPO}/git/commits/head":
            return {"tree": {"sha": "tree"}}
        if method == "POST" and path.endswith("/git/blobs"):
            self.objects["blob"] = body["content"]
            return {"sha": "blob"}
        if method == "POST" and path.endswith("/git/trees"):
            self.objects["tree"] = body
            return {"sha": "newtree"}
        if method == "POST" and path.endswith("/git/commits"):
            self.objects["commit"] = body
            return {"sha": "newcommit"}
        if path.endswith("/git/refs") or path.endswith(f"/git/refs/heads/{BRANCH}"):
            self.objects["ref"] = (method, body)
            self.files = {**(self.files or {}), BETA_PATH: self.objects["blob"]}
            return {}
        raise AssertionError(f"unexpected call {method} {path}")

    def download(self, url):
        return self.downloads[url]


def url_of(tag):
    return f"https://github.com/{REPO}/releases/download/{tag}/latest.json"


def test_the_first_run_starts_the_branch_with_the_newest_manifest():
    github = FakeGitHub([release("v0.6.0-beta.1"), release("v0.5.2")], {url_of("v0.6.0-beta.1"): manifest("v0.6.0-beta.1")})
    assert beta(github) is True
    assert github.objects["blob"] == manifest("v0.6.0-beta.1")
    assert "base_tree" not in github.objects["tree"]
    assert github.objects["tree"]["tree"][0]["path"] == BETA_PATH
    assert github.objects["commit"]["parents"] == []
    assert "[skip ci]" in github.objects["commit"]["message"]
    assert github.objects["ref"] == ("POST", {"ref": f"refs/heads/{BRANCH}", "sha": "newcommit"})


def test_a_newer_release_moves_the_branch_on_and_the_same_one_writes_nothing():
    github = FakeGitHub([release("v0.6.0-beta.2"), release("v0.6.0-beta.1")], {url_of("v0.6.0-beta.2"): manifest("v0.6.0-beta.2")},
                        files={BETA_PATH: manifest("v0.6.0-beta.1")})
    assert beta(github) is True
    assert github.objects["tree"]["base_tree"] == "tree"
    assert github.objects["commit"]["parents"] == ["head"]
    assert github.objects["ref"] == ("PATCH", {"sha": "newcommit", "force": False})
    # Run again: the file is already the one it would write.
    github.objects.clear()
    assert beta(github) is False
    assert github.objects == {}


def test_a_dry_run_and_a_refused_manifest_write_nothing():
    github = FakeGitHub([release("v0.6.0-beta.1")], {url_of("v0.6.0-beta.1"): manifest("v0.6.0-beta.1")})
    assert beta(github, dry_run=True) is False
    assert github.objects == {}
    wrong = FakeGitHub([release("v0.6.0-beta.1")], {url_of("v0.6.0-beta.1"): manifest("v0.6.0-beta.0")})
    with pytest.raises(UpdateChannelsError):
        beta(wrong)
    assert wrong.objects == {}
    with pytest.raises(UpdateChannelsError):
        beta(FakeGitHub([], {}))


def test_the_command_says_why_it_stopped(monkeypatch, capsys):
    monkeypatch.setattr(update_channels, "GitHub", lambda: FakeGitHub([], {}))
    assert update_channels.main(["beta"]) == 1
    assert "no published release has latest.json" in capsys.readouterr().err
