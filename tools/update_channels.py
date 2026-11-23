"""Keep the beta channel's latest.json where the update Worker serves it (issue #466).

    python -m tools.update_channels beta [--dry-run]

The app's beta channel asks the project's Worker for /beta/latest.json. The Worker forwards that
to beta/latest.json on the branch updater-channels of this repository (raw.githubusercontent.com),
as it forwards /latest.json to the latest stable release. This step writes that file: the
latest.json of the newest published release, a beta or a stable one, from the release list. A
stable release published for an older line (a fix of 0.5 while 0.6 betas are out) is not newer
than the newest beta, so it leaves the file as it is.

It runs when a release is published (.github/workflows/update-channels.yml), and by hand once to
start the branch. It changes only that branch, and writes nothing when the file is already the one
it would write. A latest.json whose version is not its release's, or whose files are not that
release's downloads, is refused, as the app refuses one.
"""

import argparse
import base64
import json
import re
import subprocess
import sys
import urllib.request

from tools.download_retry import retrying
from tools.release_candidate import REPOSITORY

BRANCH = "updater-channels"
BETA_PATH = "beta/latest.json"
MANIFEST = "latest.json"
# The app's own list is the newest 30 (src-tauri/src/app_update.rs, RELEASES_API).
RELEASES = 30
_VERSION = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$")


class UpdateChannelsError(Exception):
    pass


def version_key(tag):
    """The order of a `vX.Y.Z[-pre]` tag as semver orders it, or None for any other tag: a
    release after its prereleases, numeric identifiers by value and before the others."""
    match = _VERSION.match(tag)
    if not match:
        return None
    major, minor, patch, pre = match.groups()
    core = (int(major), int(minor), int(patch))
    if pre is None:
        return (core, 1, ())
    identifiers = tuple((0, int(part), "") if part.isdigit() else (1, 0, part) for part in pre.split("."))
    return (core, 0, identifiers)


def download_prefix(tag, repository=REPOSITORY):
    return f"https://github.com/{repository}/releases/download/{tag}/"


def newest_with_manifest(releases, repository=REPOSITORY):
    """The newest published release, beta or stable, with the project's latest.json:
    (tag, the latest.json's URL), or None. The app's beta check chose it so before (#466)."""
    found = []
    for release in releases:
        tag = release.get("tag_name", "")
        key = version_key(tag)
        if release.get("draft") or key is None:
            continue
        url = download_prefix(tag, repository) + MANIFEST
        if any(asset.get("name") == MANIFEST and asset.get("browser_download_url") == url for asset in release.get("assets", [])):
            found.append((key, tag, url))
    if not found:
        return None
    _, tag, url = max(found)
    return tag, url


def checked_manifest(text, tag, repository=REPOSITORY):
    """latest.json as it is read, if it is the release's: its version is the tag's, and every file
    it names is that release's download. Raises UpdateChannelsError otherwise."""
    try:
        manifest = json.loads(text)
    except ValueError as error:
        raise UpdateChannelsError(f"{tag}: latest.json is not JSON: {error}") from None
    if not isinstance(manifest, dict) or str(manifest.get("version", "")).removeprefix("v") != tag.removeprefix("v"):
        raise UpdateChannelsError(f"{tag}: latest.json names another version")
    platforms = manifest.get("platforms")
    if not isinstance(platforms, dict) or not platforms:
        raise UpdateChannelsError(f"{tag}: latest.json names no platform")
    prefix = download_prefix(tag, repository)
    for name, platform in platforms.items():
        url = platform.get("url", "") if isinstance(platform, dict) else ""
        if not url.startswith(prefix):
            raise UpdateChannelsError(f"{tag}: the file of {name} is not one of the release's downloads")
    return manifest


class GitHub:
    """The GitHub calls this step makes, through the gh CLI with the job's token (GH_TOKEN)."""

    def api(self, path, body=None, method="GET", missing_ok=False):
        command = ["gh", "api", path, "--method", method]
        if body is not None:
            command += ["--input", "-"]
        result = subprocess.run(command, input=json.dumps(body) if body is not None else None,
                                capture_output=True, text=True, encoding="utf-8")
        if result.returncode != 0:
            if missing_ok and "HTTP 404" in result.stderr:
                return None
            raise UpdateChannelsError(f"gh api {method} {path} failed: {result.stderr.strip()}")
        return json.loads(result.stdout) if result.stdout.strip() else None

    def download(self, url):
        def attempt():
            with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310 - a release download
                return response.read().decode("utf-8")

        return retrying(attempt, url)


def current_text(github, repository=REPOSITORY):
    """The branch's head commit and beta/latest.json as it stands there, or (None, None)."""
    ref = github.api(f"repos/{repository}/git/ref/heads/{BRANCH}", missing_ok=True)
    if ref is None:
        return None, None
    head = ref["object"]["sha"]
    content = github.api(f"repos/{repository}/contents/{BETA_PATH}?ref={head}", missing_ok=True)
    if content is None:
        return head, None
    blob = github.api(f"repos/{repository}/git/blobs/{content['sha']}")
    return head, base64.b64decode(blob["content"]).decode("utf-8")


def publish(github, text, tag, repository=REPOSITORY):
    """Writes `text` as beta/latest.json on the branch, starting the branch if there is none.
    Answers whether it wrote anything."""
    head, current = current_text(github, repository)
    if current == text:
        return False
    base_tree = None
    if head is not None:
        base_tree = github.api(f"repos/{repository}/git/commits/{head}")["tree"]["sha"]
    blob = github.api(f"repos/{repository}/git/blobs", {"content": text, "encoding": "utf-8"}, method="POST")
    tree_body = {"tree": [{"path": BETA_PATH, "mode": "100644", "type": "blob", "sha": blob["sha"]}]}
    if base_tree is not None:
        tree_body["base_tree"] = base_tree
    tree = github.api(f"repos/{repository}/git/trees", tree_body, method="POST")
    commit = github.api(f"repos/{repository}/git/commits", {
        "message": f"Point the beta channel at {tag} [skip ci]",
        "tree": tree["sha"],
        "parents": [head] if head is not None else [],
    }, method="POST")
    if head is None:
        github.api(f"repos/{repository}/git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]}, method="POST")
    else:
        github.api(f"repos/{repository}/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": False}, method="PATCH")
    return True


def beta(github, dry_run=False, repository=REPOSITORY):
    releases = github.api(f"repos/{repository}/releases?per_page={RELEASES}")
    chosen = newest_with_manifest(releases, repository)
    if chosen is None:
        raise UpdateChannelsError("no published release has latest.json")
    tag, url = chosen
    text = github.download(url)
    checked_manifest(text, tag, repository)
    if dry_run:
        print(f"The beta channel would point at {tag}.")
        return False
    wrote = publish(github, text, tag, repository)
    print(f"The beta channel points at {tag}" + ("." if wrote else "; it already did."))
    return wrote


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    beta_parser = commands.add_parser("beta", help="point the beta channel at the newest release")
    beta_parser.add_argument("--dry-run", action="store_true", help="say which release, write nothing")
    args = parser.parse_args(argv)
    try:
        beta(GitHub(), dry_run=args.dry_run)
    except UpdateChannelsError as error:
        print(f"update_channels: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
