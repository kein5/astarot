#!/usr/bin/env python3
"""Stage inspected build outputs and verify them before draft-release upload."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil

REPOSITORY = "kein5/astarot"
ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?")


def identity(commit, version):
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or not VERSION.fullmatch(version):
        raise ValueError("A full commit SHA and a single semantic version are required")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


# The release files are named ASTAROT from 0.7.0 and were VRCT-VOX up to 0.6.x (ADR-014, 2.10).
PREFIX = "ASTAROT"
LEGACY_PREFIX = "VRCT-VOX"
WINDOWS_PACKAGE = f"{PREFIX}.zip"
WINDOWS_INSTALLER = f"{PREFIX}_setup.exe"
LINUX_FORMATS = (".tar.gz", ".AppImage", ".deb", ".rpm")
# Releases before this version also carry each file under its name up to 0.6.x: the same bytes,
# with its .sha256 and its line in SHA256SUMS, so that links such as
# releases/latest/download/VRCT-VOX_setup.exe keep working. latest.json names only the new
# files (tools/updater_manifest.py). This is the one place that decides how long.
LEGACY_COPIES_UNTIL = (0, 8, 0)


def linux_stem(version):
    return f"{PREFIX}-{version}-linux-x64-release"


def release_files(platform, version):
    """The files a candidate of `platform` builds, under their names."""
    if platform == "windows":
        # One package for every PC (#288); up to 0.5 there was a CUDA package as well.
        return {WINDOWS_PACKAGE, WINDOWS_INSTALLER}
    if platform == "linux":
        # One package per architecture carries both speech.cpp builds (CPU and Vulkan), so the
        # names no longer name an engine variant.
        return {linux_stem(version) + suffix for suffix in LINUX_FORMATS}
    raise ValueError("Unsupported candidate platform")


def keeps_legacy_copies(version):
    """Whether a release of `version` carries the copies. A prerelease goes with its release:
    0.8.0-beta.1 carries none, as 0.8.0 does not."""
    core = re.match(r"([0-9]+)\.([0-9]+)\.([0-9]+)", version)
    if not core:
        raise ValueError("A semantic version is required")
    return tuple(int(part) for part in core.groups()) < LEGACY_COPIES_UNTIL


def legacy_copies(platform, version):
    """{name up to 0.6.x: the release file it copies}, empty once the copies stop."""
    if not keeps_legacy_copies(version):
        return {}
    return {
        LEGACY_PREFIX + name.removeprefix(PREFIX): name
        for name in release_files(platform, version)
    }


def _incomplete(platform):
    if platform == "windows":
        return ValueError(
            "Windows candidate must include the ZIP and the stable setup asset"
            " (and, while the version carries them, their copies under the names up to 0.6.x)"
        )
    return ValueError(
        "Linux candidate must include the versioned archive, AppImage, deb and rpm"
        " (and, while the version carries them, their copies under the names up to 0.6.x)"
    )


def names(platform, version, files):
    """The release files, and their copies while the version carries them."""
    expected = release_files(platform, version) | set(legacy_copies(platform, version))
    if set(files) != expected:
        raise _incomplete(platform)


def _copy(source, destination):
    """A hard link where it can be: a copy is the same bytes, and the Linux files are large."""
    try:
        os.link(source, destination)
    except OSError:
        shutil.copyfile(source, destination)


def stage(output, assets, platform, commit, version):
    identity(commit, version)
    mapping = {}
    for asset in assets:
        if asset.is_symlink() or not asset.is_file() or asset.stat().st_size == 0:
            raise ValueError(f"Not a regular nonempty build output: {asset.name}")
        # Tauri names the installer after the version; the release keeps one stable name.
        name = (
            WINDOWS_INSTALLER
            if platform == "windows"
            and asset.name == f"{PREFIX}_{version}_x64-setup.exe"
            else asset.name
        )
        if name in mapping:
            raise ValueError("Duplicate candidate asset")
        mapping[name] = asset
    # The build outputs are the release files themselves; the copies are made here.
    if set(mapping) != release_files(platform, version):
        raise _incomplete(platform)
    output.mkdir(parents=True, exist_ok=False)
    entries = []
    for name, source in sorted(mapping.items()):
        destination = output / name
        shutil.copyfile(source, destination)
        entries.append(
            dict(name=name, size=destination.stat().st_size, sha256=digest(destination))
        )
        # NSIS reads exactly 64 ASCII bytes, without a trailing newline.
        (output / (name + ".sha256")).write_text(
            entries[-1]["sha256"], encoding="ascii"
        )
    sources = {entry["name"]: entry for entry in entries}
    for copy, name in legacy_copies(platform, version).items():
        _copy(output / name, output / copy)
        entries.append(dict(sources[name], name=copy))
        (output / (copy + ".sha256")).write_text(sources[name]["sha256"], encoding="ascii")
    entries.sort(key=lambda entry: entry["name"])
    manifest = dict(
        schema=1,
        repository=REPOSITORY,
        platform=platform,
        commit=commit,
        version=version,
        assets=entries,
    )
    (output / "candidate-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    (output / "SHA256SUMS").write_text(
        "".join(f"{entry['sha256']}  {entry['name']}\n" for entry in entries),
        encoding="ascii",
    )
    return manifest


def verify(directory, platform, commit, version):
    identity(commit, version)
    manifest = json.loads(
        (directory / "candidate-manifest.json").read_text(encoding="utf-8")
    )
    for key, expected in dict(
        schema=1,
        repository=REPOSITORY,
        platform=platform,
        commit=commit,
        version=version,
    ).items():
        if manifest.get(key) != expected:
            raise ValueError(f"Candidate {key} mismatch")
    entries = manifest["assets"]
    filenames = [entry["name"] for entry in entries]
    if len(set(filenames)) != len(filenames) or any(
        Path(name).name != name or "/" in name or "\\" in name for name in filenames
    ):
        raise ValueError("Unsafe or duplicate candidate filenames")
    names(platform, version, filenames)
    by_name = {entry["name"]: entry for entry in entries}
    for copy, name in legacy_copies(platform, version).items():
        if by_name[copy]["sha256"] != by_name[name]["sha256"] or by_name[copy]["size"] != by_name[name]["size"]:
            raise ValueError(f"A copy under the name up to 0.6.x differs from its file: {copy}")
    if {path.name for path in directory.iterdir()} != set(filenames) | {
        name + ".sha256" for name in filenames
    } | {
        "candidate-manifest.json",
        "SHA256SUMS",
    }:
        raise ValueError("Unexpected candidate files")
    for entry in entries:
        path = directory / entry["name"]
        if (
            path.is_symlink()
            or not path.is_file()
            or path.stat().st_size <= 0
            or path.stat().st_size != entry["size"]
            or digest(path) != entry["sha256"]
        ):
            raise ValueError(f"Candidate checksum mismatch: {entry['name']}")
        checksum = directory / (entry["name"] + ".sha256")
        if checksum.is_symlink() or checksum.read_bytes() != entry["sha256"].encode(
            "ascii"
        ):
            raise ValueError(f"Installer checksum sidecar mismatch: {entry['name']}")
    expected_sums = "".join(
        f"{entry['sha256']}  {entry['name']}\n" for entry in entries
    )
    if (directory / "SHA256SUMS").read_text(encoding="ascii") != expected_sums:
        raise ValueError("Checksum list mismatch")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["stage", "verify"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--platform", choices=["linux", "windows"], required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--version")
    parser.add_argument("--asset", type=Path, action="append", default=[])
    args = parser.parse_args()
    version = args.version or json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    if args.command == "stage":
        result = stage(args.directory, args.asset, args.platform, args.commit, version)
    else:
        result = verify(args.directory, args.platform, args.commit, version)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
