import json
from pathlib import Path
import shutil
import subprocess

import pytest

from tools import release_candidate
from tools.release_candidate import stage, verify
from tools.prepare_release import check_run, main as prepare_release_main, prepare, release_channel, require_immutable_releases, require_unused_tag

SHA = "a" * 40
VERSION = "3.6.0-beta.1"


@pytest.fixture
def candidate(tmp_path):
    assets = []
    for name in (
        "ASTAROT.zip",
        f"ASTAROT_{VERSION}_x64-setup.exe",
    ):
        path = tmp_path / name
        path.write_bytes(b"inspected synthetic output")
        assets.append(path)
    output = tmp_path / "candidate"
    stage(output, assets, "windows", SHA, VERSION)
    return output


def test_stage_alias_and_verify(candidate):
    result = verify(candidate, "windows", SHA, VERSION)
    assert "ASTAROT_setup.exe" in {entry["name"] for entry in result["assets"]}
    for entry in result["assets"]:
        assert (candidate / (entry["name"] + ".sha256")).read_bytes() == entry[
            "sha256"
        ].encode("ascii")


def test_prepare_preserves_installer_checksums(candidate, tmp_path, monkeypatch):
    run = dict(
        conclusion="success",
        status="completed",
        event="workflow_dispatch",
        head_branch="develop",
        head_sha=SHA,
        path=".github/workflows/release.yml",
        repository={"full_name": "kein5/astarot"},
        head_repository={"full_name": "kein5/astarot"},
    )
    monkeypatch.setattr(subprocess, "check_output", lambda *a, **kw: json.dumps(run))

    def download(argv, **_kwargs):
        if argv[:3] == ["gh", "attestation", "verify"]:
            return
        shutil.copytree(candidate, argv[argv.index("--dir") + 1])

    monkeypatch.setattr(subprocess, "run", download)
    payload = prepare(tmp_path / "draft", {"windows": "123"}, SHA, VERSION, "develop")
    for name in ("ASTAROT.zip", "ASTAROT_setup.exe"):
        assert (payload / (name + ".sha256")).read_bytes() == (
            candidate / (name + ".sha256")
        ).read_bytes()
        assert len((payload / (name + ".sha256")).read_bytes()) == 64


def _draft(candidate, tmp_path, monkeypatch, attestation):
    run = dict(
        conclusion="success", status="completed", event="workflow_dispatch", head_branch="develop",
        head_sha=SHA, path=".github/workflows/release.yml",
        repository={"full_name": "kein5/astarot"}, head_repository={"full_name": "kein5/astarot"},
    )
    monkeypatch.setattr(subprocess, "check_output", lambda *a, **kw: json.dumps(run))
    checked = []

    def fake_run(argv, **kwargs):
        if argv[:3] == ["gh", "attestation", "verify"]:
            checked.append(argv)
            attestation(argv)
            return
        shutil.copytree(candidate, argv[argv.index("--dir") + 1])

    monkeypatch.setattr(subprocess, "run", fake_run)
    return checked, lambda: prepare(tmp_path / "draft", {"windows": "123"}, SHA, VERSION, "develop")


def test_every_candidate_file_needs_provenance_from_its_workflow_and_commit(candidate, tmp_path, monkeypatch):
    """Second security audit SEC-04: signed build provenance, not only checksums."""
    checked, run_prepare = _draft(candidate, tmp_path, monkeypatch, lambda argv: None)
    payload = run_prepare()
    files = sorted(path.name for path in candidate.iterdir())
    assert sorted(Path(argv[3]).name for argv in checked) == files
    for argv in checked:
        options = dict(zip(argv[4::2], argv[5::2]))
        assert options["--repo"] == "kein5/astarot"
        assert options["--signer-workflow"] == "kein5/astarot/.github/workflows/release.yml"
        assert options["--source-digest"] == SHA
        assert options["--source-ref"] == "refs/heads/develop"
        assert "--deny-self-hosted-runners" in argv
    assert (payload / "ASTAROT.zip").is_file()


def test_a_file_without_valid_provenance_stops_the_draft(candidate, tmp_path, monkeypatch):
    def refuse(argv):
        if argv[3].endswith("ASTAROT_setup.exe"):
            raise subprocess.CalledProcessError(1, argv, stderr="no attestations found")

    _, run_prepare = _draft(candidate, tmp_path, monkeypatch, refuse)
    with pytest.raises(subprocess.CalledProcessError):
        run_prepare()
    assert not any((tmp_path / "draft" / "payload").iterdir())

def test_a_windows_candidate_has_no_cuda_package(tmp_path):
    # Up to 0.5 the candidate also carried VRCT-VOX_cuda.zip; one package now serves every PC.
    assets = []
    for name in ("ASTAROT.zip", "ASTAROT_cuda.zip", f"ASTAROT_{VERSION}_x64-setup.exe"):
        path = tmp_path / name
        path.write_bytes(b"inspected synthetic output")
        assets.append(path)
    with pytest.raises(ValueError, match="the ZIP and the stable setup asset"):
        stage(tmp_path / "out", assets, "windows", SHA, VERSION)


def test_checksum_newline_is_rejected(candidate):
    path = candidate / "ASTAROT.zip.sha256"
    path.write_bytes(path.read_bytes() + b"\n")
    with pytest.raises(ValueError, match="sidecar"):
        verify(candidate, "windows", SHA, VERSION)


@pytest.mark.parametrize(
    "kind", ["absent", "lightweight", "annotated", "error", "malformed"]
)
def test_existing_tags_or_lookup_failure_never_mean_tag_absent(kind, monkeypatch):
    def lookup(argv, **_kwargs):
        assert "--paginate" in argv and "--slurp" in argv
        if kind == "error":
            raise subprocess.CalledProcessError(1, argv, stderr="HTTP 404")
        if kind == "malformed":
            return "{}"
        if kind == "absent":
            return "[[]]"
        return json.dumps(
            [
                [
                    {
                        "ref": "refs/tags/v" + VERSION,
                        "object": {
                            "type": "tag" if kind == "annotated" else "commit",
                            "sha": "b" * 40,
                        },
                    }
                ]
            ]
        )

    monkeypatch.setattr(subprocess, "check_output", lookup)
    if kind == "absent":
        require_unused_tag(VERSION)
    else:
        with pytest.raises((ValueError, subprocess.CalledProcessError)):
            require_unused_tag(VERSION)


def answering(returncode, stdout="", stderr=""):
    """A stand-in for subprocess.run that records the command and gives one answer."""
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, returncode, stdout, stderr)

    run.calls = calls
    return run


def test_immutable_releases_on_lets_the_draft_go_ahead(monkeypatch):
    # Issue #1018: the draft is made only while published releases cannot be changed.
    monkeypatch.setenv("GH_TOKEN", "settings-token")
    run = answering(0, json.dumps({"enabled": True, "enforced_by_owner": False}))
    require_immutable_releases(run)
    assert run.calls == [["gh", "api", "repos/kein5/astarot/immutable-releases"]]


@pytest.mark.parametrize(
    ("returncode", "stdout", "stderr", "said"),
    [
        (1, "", "gh: Not Found (HTTP 404)", "off for this repository, or the token cannot read"),
        (0, json.dumps({"enabled": False, "enforced_by_owner": False}), "", "off for this repository"),
        (0, json.dumps([]), "", "off for this repository"),
        (1, "", "gh: Bad credentials (HTTP 401)", "Could not read"),
    ],
)
def test_immutable_releases_off_or_unreadable_stops_the_draft(monkeypatch, returncode, stdout, stderr, said):
    monkeypatch.setenv("GH_TOKEN", "settings-token")
    with pytest.raises(ValueError, match=said):
        require_immutable_releases(answering(returncode, stdout, stderr))


def test_immutable_releases_check_needs_its_token(monkeypatch):
    monkeypatch.delenv("GH_TOKEN", raising=False)
    run = answering(0, json.dumps({"enabled": True}))
    with pytest.raises(ValueError, match="IMMUTABLE_RELEASES_READ_TOKEN"):
        require_immutable_releases(run)
    assert run.calls == [], "nothing is asked without the token"


def test_immutable_releases_is_its_own_command(monkeypatch, capsys):
    # prepare-release.yml runs it as its own step, the only one that gets the settings token.
    monkeypatch.setenv("GH_TOKEN", "settings-token")
    monkeypatch.setattr(subprocess, "run", answering(0, json.dumps({"enabled": True})))
    prepare_release_main(["immutable-releases"])
    assert "Immutable releases are on" in capsys.readouterr().out


@pytest.mark.parametrize(
    "mutation",
    ["bytes", "commit", "version", "repository", "path", "extra", "checksums"],
)
def test_rejects_modified_or_misidentified_candidate(candidate, mutation):
    path = candidate / "candidate-manifest.json"
    data = json.loads(path.read_text())
    if mutation == "bytes":
        (candidate / "ASTAROT.zip").write_bytes(b"tampered")
    elif mutation in ("commit", "version", "repository"):
        data[mutation] = "unexpected"
    elif mutation == "path":
        data["assets"][0]["name"] = "../ASTAROT.zip"
    elif mutation == "extra":
        (candidate / "private.log").write_text("must not publish")
    elif mutation == "checksums":
        (candidate / "SHA256SUMS").write_text("incorrect")
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        verify(candidate, "windows", SHA, VERSION)


def _linux_assets(tmp_path, suffixes, version=VERSION):
    assets = []
    for suffix in suffixes:
        path = tmp_path / f"ASTAROT-{version}-linux-x64-{suffix}"
        path.write_bytes(b"candidate")
        assets.append(path)
    return assets


def test_linux_candidate_carries_archive_appimage_deb_and_rpm(tmp_path):
    assets = _linux_assets(tmp_path, ("release.tar.gz", "release.AppImage",
                                      "release.deb", "release.rpm"))
    stage(tmp_path / "out", assets, "linux", SHA, VERSION)
    names = {entry["name"] for entry in verify(tmp_path / "out", "linux", SHA, VERSION)["assets"]}
    assert {name.rsplit(".", 1)[-1] for name in names} == {"gz", "AppImage", "deb", "rpm"}


def test_linux_candidate_without_its_packages_is_refused(tmp_path):
    assets = _linux_assets(tmp_path, ("release.tar.gz", "release.AppImage"))
    with pytest.raises(ValueError, match="deb and rpm"):
        stage(tmp_path / "out", assets, "linux", SHA, VERSION)


def test_linux_packages_of_one_engine_build_are_refused(tmp_path):
    # Until 0.4 each engine build had packages of its own; one package now carries both.
    assets = _linux_assets(tmp_path, ("vulkan-release.tar.gz", "vulkan-release.AppImage",
                                      "vulkan-release.deb", "vulkan-release.rpm"))
    with pytest.raises(ValueError, match="deb and rpm"):
        stage(tmp_path / "out", assets, "linux", SHA, VERSION)


def test_linux_candidate_needs_one_of_each_format(tmp_path):
    assets = _linux_assets(tmp_path, ("vulkan-release.tar.gz", "vulkan-release.AppImage",
                                      "vulkan-release.deb", "cpu-release.deb"))
    with pytest.raises(ValueError):
        stage(tmp_path / "out", assets, "linux", SHA, VERSION)


@pytest.mark.parametrize(
    "mutation",
    [None, "event", "conclusion", "head_sha", "head_branch", "path", "head_repository"],
)
def test_release_draft_only_accepts_successful_canonical_manual_builds(mutation):
    run = dict(
        conclusion="success",
        status="completed",
        event="workflow_dispatch",
        head_branch="develop",
        head_sha=SHA,
        path=".github/workflows/build-linux.yml",
        repository={"full_name": "kein5/astarot"},
        head_repository={"full_name": "kein5/astarot"},
    )
    if mutation is None:
        check_run(run, "linux", SHA, "develop")
    else:
        run[mutation] = (
            {"full_name": "someone/fork"}
            if mutation == "head_repository"
            else "untrusted"
        )
        with pytest.raises(ValueError):
            check_run(run, "linux", SHA, "develop")


@pytest.mark.parametrize("branch,version,channel", [
    ("main", "0.1.0", "stable"),
    ("main", "12.0.3", "stable"),
    ("develop", "0.2.0-beta.1", "beta"),
    ("develop", "1.0.0-beta.12", "beta"),
])
def test_main_releases_stable_and_develop_releases_betas(branch, version, channel):
    assert release_channel(branch, version) == channel


@pytest.mark.parametrize("branch,version", [
    ("main", "0.1.0-beta.1"),      # A beta must not be published from main.
    ("develop", "0.1.0"),          # A stable version must not come from develop.
    ("develop", "0.1.0-rc.1"),
    ("develop", "0.1.0-beta.0"),
    ("main", "01.0.0"),
    ("feature/x", "0.1.0"),
])
def test_branch_and_version_must_agree(branch, version):
    with pytest.raises(ValueError):
        release_channel(branch, version)


def test_candidate_from_another_branch_is_rejected():
    run = dict(conclusion="success", status="completed", event="workflow_dispatch",
               head_branch="develop", head_sha=SHA, path=".github/workflows/build-linux.yml",
               repository={"full_name": "kein5/astarot"}, head_repository={"full_name": "kein5/astarot"})
    with pytest.raises(ValueError):
        check_run(run, "linux", SHA, "main")


# ADR-014, 2.10: releases before 0.8.0 carry each file again under its name up to 0.6.x.
COPY_VERSION = "0.7.0-beta.1"


def _windows_assets(tmp_path, version):
    assets = []
    for name in ("ASTAROT.zip", f"ASTAROT_{version}_x64-setup.exe"):
        path = tmp_path / name
        path.write_bytes(name.encode() * 8)
        assets.append(path)
    return assets


def test_a_release_before_0_8_carries_copies_under_the_names_up_to_0_6(tmp_path):
    out = tmp_path / "out"
    manifest = stage(out, _windows_assets(tmp_path, COPY_VERSION), "windows", SHA, COPY_VERSION)
    names = {entry["name"] for entry in manifest["assets"]}
    assert names == {"ASTAROT.zip", "ASTAROT_setup.exe", "VRCT-VOX.zip", "VRCT-VOX_setup.exe"}
    for copy, name in (("VRCT-VOX.zip", "ASTAROT.zip"), ("VRCT-VOX_setup.exe", "ASTAROT_setup.exe")):
        assert (out / copy).read_bytes() == (out / name).read_bytes()
        assert (out / (copy + ".sha256")).read_bytes() == (out / (name + ".sha256")).read_bytes()
    sums = (out / "SHA256SUMS").read_text().splitlines()
    assert [line.split("  ")[1] for line in sums] == sorted(names)
    assert {entry["name"] for entry in verify(out, "windows", SHA, COPY_VERSION)["assets"]} == names


def test_the_linux_files_have_their_copies_too(tmp_path):
    assets = _linux_assets(tmp_path, ("release.tar.gz", "release.AppImage", "release.deb", "release.rpm"),
                           version=COPY_VERSION)
    out = tmp_path / "out"
    stage(out, assets, "linux", SHA, COPY_VERSION)
    names = {entry["name"] for entry in verify(out, "linux", SHA, COPY_VERSION)["assets"]}
    assert names == {f"{prefix}-{COPY_VERSION}-linux-x64-release{suffix}" for prefix in ("ASTAROT", "VRCT-VOX")
                     for suffix in (".tar.gz", ".AppImage", ".deb", ".rpm")}


def test_a_copy_that_differs_from_its_file_is_refused(tmp_path):
    out = tmp_path / "out"
    stage(out, _windows_assets(tmp_path, COPY_VERSION), "windows", SHA, COPY_VERSION)
    # Replaced consistently: the file, its .sha256, the manifest and SHA256SUMS all agree.
    copy = out / "VRCT-VOX.zip"
    copy.unlink()
    copy.write_bytes(b"something else")
    digest = release_candidate.digest(copy)
    (out / "VRCT-VOX.zip.sha256").write_text(digest, encoding="ascii")
    manifest = json.loads((out / "candidate-manifest.json").read_text())
    for entry in manifest["assets"]:
        if entry["name"] == "VRCT-VOX.zip":
            entry.update(sha256=digest, size=copy.stat().st_size)
    (out / "candidate-manifest.json").write_text(json.dumps(manifest))
    (out / "SHA256SUMS").write_text("".join(f"{e['sha256']}  {e['name']}\n" for e in manifest["assets"]))
    with pytest.raises(ValueError, match="differs"):
        verify(out, "windows", SHA, COPY_VERSION)


def test_the_build_outputs_are_the_new_names_only(tmp_path):
    # The copies are made by the stage step; a build output under an old name is refused.
    assets = _windows_assets(tmp_path, COPY_VERSION)
    old = tmp_path / "VRCT-VOX.zip"
    old.write_bytes(b"old")
    with pytest.raises(ValueError, match="the ZIP and the stable setup asset"):
        stage(tmp_path / "out", [*assets, old], "windows", SHA, COPY_VERSION)
    with pytest.raises(ValueError, match="the ZIP and the stable setup asset"):
        stage(tmp_path / "out2", [old, assets[1]], "windows", SHA, COPY_VERSION)


@pytest.mark.parametrize("version,kept", [("0.7.0-beta.1", True), ("0.7.0", True), ("0.7.12", True),
                                          ("0.8.0-beta.1", False), ("0.8.0", False), ("1.0.0", False)])
def test_the_copies_stop_with_0_8_0(version, kept):
    assert release_candidate.LEGACY_COPIES_UNTIL == (0, 8, 0)
    assert release_candidate.keeps_legacy_copies(version) is kept
    copies = release_candidate.legacy_copies("windows", version)
    assert copies == ({"VRCT-VOX.zip": "ASTAROT.zip", "VRCT-VOX_setup.exe": "ASTAROT_setup.exe"} if kept else {})


def test_the_draft_downloads_the_artifacts_the_candidate_workflows_upload():
    # ADR-014, 2.2: the candidates' artifacts are named ASTAROT-…; prepare_release.py asks for them
    # by name, so the two have to change together.
    import yaml

    root = Path(__file__).resolve().parents[2]
    source = (root / "tools/prepare_release.py").read_text(encoding="utf-8")
    for workflow, artifact in (("build-linux.yml", "ASTAROT-linux-x86_64-candidate"),
                               ("release.yml", "ASTAROT-windows-candidate")):
        jobs = yaml.load((root / ".github/workflows" / workflow).read_text(encoding="utf-8"),
                         Loader=yaml.BaseLoader)["jobs"]
        uploads = [step["with"]["name"] for job in jobs.values() for step in job.get("steps", [])
                   if "upload-artifact" in step.get("uses", "") and step["with"]["name"].endswith("-candidate")]
        assert uploads == [artifact], (workflow, uploads)
        assert f'"{artifact}"' in source
