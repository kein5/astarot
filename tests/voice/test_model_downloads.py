"""No network, Torch, model loading or audio: exercise the real file transaction."""

from dataclasses import replace
import hashlib
import io
from pathlib import Path
from threading import Event
import time

import pytest


@pytest.fixture
def setup(tmp_path):
    assert (
        Path(__file__).resolve().parents[2]
        / "src-python/models/model_downloads/manager.py"
    ).is_file(), "download manager not implemented"
    from models.model_downloads.catalog import Artifact, Model
    from models.model_downloads.manager import Downloads

    content = b"GGUF" + b"example tensor bytes" * 4
    artifact = Artifact(
        "model.gguf", len(content), hashlib.sha256(content).hexdigest(), "model"
    )
    entry = Model(
        "test-model",
        "japanese",
        "Test",
        "Author",
        "author/model",
        "a" * 40,
        "MIT",
        ("https://huggingface.co/author/model/blob/" + "a" * 40 + "/LICENSE",),
        "irodori",
        (artifact,),
    )
    opened = []

    def transport(url):
        opened.append(url)
        return io.BytesIO(content)

    manager = Downloads(
        tmp_path / "models", catalog=(entry,), transport=transport, reserve_bytes=0
    )
    yield manager, entry, content, opened
    manager.close()


def finish(manager):
    end = time.monotonic() + 3
    while time.monotonic() < end:
        state = manager.state()["jobs"].get("test-model", {})
        if state.get("phase") in ("ready", "failed", "cancelled", "applied"):
            return state
        time.sleep(0.005)
    raise AssertionError(manager.state())


def start(manager, **overrides):
    return manager.start(
        {
            "id": "test-model",
            "consent": True,
            "catalog_version": manager.catalog_version,
            **overrides,
        }
    )


@pytest.mark.parametrize("consent", [False, 1, "yes", None])
def test_explicit_consent_before_any_files_or_network(setup, consent):
    m, _, _, opened = setup
    assert m.state()["jobs"] == {} and m.catalog()["models"]
    with pytest.raises(ValueError, match="consent_required"):
        start(m, consent=consent)
    assert not opened and not m.root.exists()


@pytest.mark.parametrize(
    "overrides",
    [
        {"id": "../outside"},
        {"catalog_version": "stale"},
        {"url": "https://elsewhere/model"},
    ],
)
def test_only_fixed_catalog_requests_are_accepted(setup, overrides):
    m, _, _, opened = setup
    with pytest.raises(ValueError):
        start(m, **overrides)
    assert not opened


@pytest.mark.parametrize(
    "license, restrictions",
    [
        ("CC-BY-NC-4.0", ["non_commercial"]),
        ("CC-BY-NC-SA-4.0", ["non_commercial"]),
        ("CC BY-NC-ND 4.0", ["non_commercial"]),
        ("Creative Commons Attribution-NonCommercial 4.0", ["non_commercial"]),
        ("MIT + Apache-2.0", []),
        ("CC BY 4.0", []),
        ("CC0-1.0", []),
        ("Gemmatic-1.0", []),
        ("Gemma Terms of Use + MIT + Apache-2.0", ["gemma_terms"]),
        ("gemma", ["gemma_terms"]),
        ("Gemma Terms of Use + CC-BY-NC-4.0", ["non_commercial", "gemma_terms"]),
    ],
)
def test_restrictions_come_from_the_license(license, restrictions):
    from models.model_downloads.catalog import license_restrictions

    assert license_restrictions(license) == restrictions


def test_only_irodori_large_of_the_shipped_entries_carries_the_gemma_terms():
    """The same answer as native/ops catalog.rs (decision 4 of the LLM runtime plan)."""
    from models.model_downloads.catalog import CATALOG, license_restrictions

    restricted = {m.id: license_restrictions(m.license) for m in CATALOG if license_restrictions(m.license)}
    assert restricted == {"irodori-v4-large-q8": ["gemma_terms"]}


def test_a_non_commercial_entry_starts_only_with_its_acknowledgement(setup, tmp_path):
    """The same cases as native/ops manager_tests.rs."""
    from models.model_downloads.manager import Downloads

    m, entry, content, opened = setup
    assert m.catalog()["models"][0]["restrictions"] == []
    for acknowledged in (["non_commercial"], ["other"], None):
        with pytest.raises(ValueError, match="download_request_invalid"):
            start(m, acknowledged=acknowledged)
    restricted = replace(entry, license="CC-BY-NC-4.0")
    nc = Downloads(
        tmp_path / "nc",
        catalog=(restricted,),
        transport=lambda url: opened.append(url) or io.BytesIO(content),
        reserve_bytes=0,
    )
    try:
        assert nc.catalog()["models"][0]["restrictions"] == ["non_commercial"]
        for overrides, code in (
            ({}, "model_download_restriction_unacknowledged"),
            ({"acknowledged": []}, "model_download_restriction_unacknowledged"),
            ({"acknowledged": ["non_commercial"], "consent": False}, "consent_required"),
            ({"acknowledged": ["non_commercial", "non_commercial"]}, "download_request_invalid"),
            ({"acknowledged": ["non_commercial", "gemma_terms"]}, "download_request_invalid"),
            ({"acknowledged": "non_commercial"}, "download_request_invalid"),
        ):
            with pytest.raises(ValueError, match=code):
                start(nc, **overrides)
        assert not opened and not nc.root.exists()
        start(nc, acknowledged=["non_commercial"])
        assert finish(nc)["phase"] == "ready"
    finally:
        nc.close()
    start(m, acknowledged=[])
    assert finish(m)["phase"] == "ready"


def test_verified_completion_does_not_apply_or_load_and_can_be_applied_explicitly(
    setup,
):
    m, entry, content, opened = setup
    start(m)
    job = finish(m)
    assert job["phase"] == "ready" and job["received_bytes"] == len(content)
    target = Path(job["paths"]["model"])
    assert target.read_bytes() == content
    assert opened == [
        f"https://huggingface.co/{entry.repo}/resolve/{entry.revision}/model.gguf"
    ]
    applied = []
    m.apply(entry.id, job["job_id"], lambda e, paths: applied.append(paths))
    assert applied == [{"model": str(target)}]
    assert m.state()["jobs"][entry.id]["phase"] == "applied"


def test_state_reports_files_downloaded_in_an_earlier_run(setup, tmp_path):
    """After a restart there is no job, but the catalog page still shows the model as downloaded."""
    from models.model_downloads.manager import Downloads

    m, entry, content, opened = setup
    assert m.state()["downloaded"] == {}
    start(m)
    job = finish(m)
    assert m.state()["downloaded"] == {entry.id: job["paths"]}
    m.close()

    restarted = Downloads(m.root, catalog=(entry,), transport=lambda url: None, reserve_bytes=0)
    try:
        state = restarted.state()
        assert state["jobs"] == {} and state["downloaded"] == {entry.id: job["paths"]}
        # A file of the wrong size, or a folder in its place, is not reported (no hashing here).
        model = Path(job["paths"]["model"])
        model.write_bytes(content + b"x")
        assert restarted.state()["downloaded"] == {}
        model.unlink()
        model.mkdir()
        assert restarted.state()["downloaded"] == {}
    finally:
        restarted.close()
    assert opened == [opened[0]]


def test_download_finishes_under_a_japanese_windows_locale(setup, monkeypatch):
    """Catalog text has "·", which cp932 cannot write: every download failed at the very end."""
    m, entry, _, _ = setup
    m.entries[entry.id] = replace(entry, name="PP-OCRv6 small · Japanese")
    locale_default = Path.write_text

    def write_text(self, data, encoding=None, errors=None, newline=None):
        return locale_default(self, data, encoding=encoding or "cp932", errors=errors, newline=newline)

    monkeypatch.setattr(Path, "write_text", write_text)
    start(m)
    job = finish(m)
    assert job["phase"] == "ready", job
    receipt = Path(job["paths"]["model"]).with_name("receipt.json")
    assert "·" in receipt.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "data,code",
    [
        (b"GGUFwrong", "size_mismatch"),
        (b"x" * 200, "size_mismatch"),
        (None, "hash_mismatch"),
    ],
)
def test_incomplete_oversized_or_corrupt_download_never_publishes(setup, data, code):
    m, _, content, _ = setup
    m.transport = lambda _: io.BytesIO(
        data if data is not None else b"x" * len(content)
    )
    start(m)
    job = finish(m)
    assert job["phase"] == "failed" and job["error_code"] == code
    assert not job["paths"] and not list(m.root.rglob("*.gguf"))
    assert not list(m.root.glob(".partial-*"))


def test_cancel_keeps_no_partial_path_and_old_job_cannot_cancel_retry(setup):
    m, entry, content, _ = setup
    entered, release = Event(), Event()

    class Slow(io.BytesIO):
        def read(self, n=-1):
            entered.set()
            assert release.wait(2)
            return super().read(n)

    m.transport = lambda _: Slow(content)
    start(m)
    assert entered.wait(1)
    job = m.state()["jobs"][entry.id]
    m.cancel(entry.id, job["job_id"])
    release.set()
    assert finish(m)["phase"] == "cancelled"
    assert not list(m.root.rglob("*.gguf"))
    m.transport = lambda _: io.BytesIO(content)
    start(m)
    retry = finish(m)
    assert retry["phase"] == "ready"
    with pytest.raises(ValueError, match="stale_job"):
        m.cancel(entry.id, job["job_id"])
    assert m.state()["jobs"][entry.id]["job_id"] == retry["job_id"]


def test_disk_preflight_fails_without_network(setup, monkeypatch):
    import shutil

    m, _, _, opened = setup
    monkeypatch.setattr(
        shutil, "disk_usage", lambda _: type("Usage", (), {"free": 0})()
    )
    start(m)
    job = finish(m)
    assert job["phase"] == "failed" and job["error_code"] == "insufficient_space"
    assert not opened


def test_disk_full_during_write_leaves_no_selectable_file(setup, monkeypatch):
    import errno
    import os

    m, _, _, _ = setup
    calls = 0
    real = os.fsync

    def full(fd):
        nonlocal calls
        calls += 1
        if calls > 1:
            raise OSError(errno.ENOSPC, "full")
        return real(fd)

    monkeypatch.setattr(os, "fsync", full)
    start(m)
    job = finish(m)
    assert job["phase"] == "failed" and job["error_code"] == "insufficient_space"
    assert not job["paths"] and not list(m.root.rglob("*.gguf"))


def test_network_failure_removes_staging_and_preserves_unrelated_files(setup):
    m, _, _, _ = setup
    m.root.mkdir()
    unrelated = m.root / "user.pth"
    unrelated.write_bytes(b"user model")

    def fail(_):
        raise OSError("network private details")

    m.transport = fail
    start(m)
    job = finish(m)
    assert job["phase"] == "failed" and job["error_code"] == "download_failed"
    assert unrelated.read_bytes() == b"user model"
    assert not list(m.root.glob(".partial-*"))


def test_complete_cache_is_reverified_and_a_damaged_one_is_downloaded_again(setup):
    m, _, content, opened = setup
    start(m)
    path = Path(finish(m)["paths"]["model"])
    start(m)
    assert finish(m)["phase"] == "ready" and len(opened) == 1
    # Truncated, same size with other bytes, and gone: each is downloaded again in place.
    for n, damage in enumerate((b"bad cache", b"x" * len(content), None)):
        if damage is None:
            path.unlink()
        else:
            path.write_bytes(damage)
        start(m)
        job = finish(m)
        assert job["phase"] == "ready", job
        assert Path(job["paths"]["model"]) == path and path.read_bytes() == content
        assert len(opened) == n + 2
        assert not list(m.root.glob(".partial-*"))


def test_a_damaged_cache_holding_anything_else_is_kept_and_fails(setup):
    m, _, _, opened = setup
    start(m)
    path = Path(finish(m)["paths"]["model"])
    path.write_bytes(b"bad cache")
    (path.parent / "notes.txt").write_bytes(b"mine")
    start(m)
    job = finish(m)
    assert (job["phase"], job["error_code"]) == ("failed", "size_mismatch")
    assert path.read_bytes() == b"bad cache"
    assert (path.parent / "notes.txt").read_bytes() == b"mine"
    (path.parent / "notes.txt").unlink()
    # No marker (placed by hand): kept as well.
    (path.parent / "owner.json").unlink()
    start(m)
    assert finish(m)["error_code"] == "size_mismatch"
    assert path.read_bytes() == b"bad cache" and len(opened) == 1


def test_a_damaged_cache_whose_staging_name_is_taken_is_kept(setup):
    import json

    m, _, _, _ = setup
    start(m)
    path = Path(finish(m)["paths"]["model"])
    path.write_bytes(b"bad cache")
    name = json.loads((path.parent / "owner.json").read_text())["directory"]
    (m.root / name).mkdir()
    (m.root / name / "keep").write_bytes(b"keep")
    start(m)
    assert finish(m)["error_code"] == "size_mismatch"
    assert path.read_bytes() == b"bad cache"
    assert (m.root / name / "keep").read_bytes() == b"keep"


def test_a_damaged_cache_moved_aside_by_a_run_that_stopped_is_removed_by_the_next(setup):
    import json

    m, _, content, _ = setup
    start(m)
    path = Path(finish(m)["paths"]["model"])
    path.write_bytes(b"bad cache")
    name = json.loads((path.parent / "owner.json").read_text())["directory"]
    path.parent.rename(m.root / name)
    assert m.state()["downloaded"] == {}
    start(m)
    assert finish(m)["phase"] == "ready" and path.read_bytes() == content
    assert not list(m.root.glob(".partial-*"))


def test_restart_right_after_ready_waits_for_the_finishing_worker(setup, monkeypatch):
    from models.model_downloads import manager as module

    m, _, _, opened = setup
    release, close = Event(), module.RootLease.close

    def slow_close(lease):
        release.wait(3)
        close(lease)

    monkeypatch.setattr(module.RootLease, "close", slow_close)
    start(m)
    assert finish(m)["phase"] == "ready"
    start(m)
    release.set()
    assert finish(m)["phase"] == "ready" and len(opened) == 1


def test_symlink_destination_cannot_overwrite_outside_file(setup, tmp_path):
    m, entry, _, opened = setup
    outside = tmp_path / "outside"
    outside.mkdir()
    outside.joinpath("model.gguf").write_bytes(b"do not change")
    m.root.mkdir()
    (m.root / entry.id).symlink_to(outside, target_is_directory=True)
    start(m)
    assert finish(m)["phase"] == "failed"
    assert (
        outside.joinpath("model.gguf").read_bytes() == b"do not change" and not opened
    )


def test_tampered_file_cannot_be_applied(setup):
    m, entry, _, _ = setup
    start(m)
    job = finish(m)
    Path(job["paths"]["model"]).write_bytes(b"changed")
    with pytest.raises(ValueError):
        m.apply(entry.id, job["job_id"], lambda *_: pytest.fail("applied corrupt data"))


def test_failed_setting_application_keeps_download_available(setup):
    m, entry, _, _ = setup
    start(m)
    job = finish(m)

    def refuse(*_):
        raise ValueError("settings_changed")

    with pytest.raises(ValueError, match="settings_changed"):
        m.apply(entry.id, job["job_id"], refuse)
    assert m.state()["jobs"][entry.id]["phase"] == "ready"


def test_close_prohibits_future_network_or_apply(setup):
    m, _, _, opened = setup
    assert m.close()
    with pytest.raises(ValueError, match="downloads_closed"):
        start(m)
    assert not opened


def test_unexpected_stream_error_is_a_failure_not_a_stuck_job(setup):
    from http.client import IncompleteRead

    m, _, _, _ = setup

    def fail(_):
        raise IncompleteRead(b"part", 20)

    m.transport = fail
    start(m)
    assert finish(m)["phase"] == "failed"


def test_cancel_aborts_a_blocked_body_and_never_publishes(setup):
    m, entry, _, _ = setup
    entered, aborted = Event(), Event()

    class Body(io.BytesIO):
        def read(self, n=-1):
            entered.set()
            aborted.wait(2)
            return b""

        def abort(self):
            aborted.set()

    m.transport = lambda _: Body()
    start(m)
    assert entered.wait(1)
    job = m.state()["jobs"][entry.id]
    m.cancel(entry.id, job["job_id"])
    assert aborted.wait(0.2)
    assert finish(m)["phase"] == "cancelled"
    assert m.close() and not list(m.root.glob(".partial-*"))


def test_multi_file_bundle_failure_never_publishes_first_file(setup):
    m, entry, content, _ = setup
    other = replace(entry.artifacts[0], filename="features.index", role="index")
    m.entries[entry.id] = replace(entry, artifacts=entry.artifacts + (other,))
    m.transport = lambda url: io.BytesIO(
        content if url.endswith(".gguf") else b"bad second file"
    )
    start(m)
    assert finish(m)["phase"] == "failed"
    assert not list(m.root.rglob("model.gguf"))


def test_catalog_contains_pinned_artifacts_and_no_private_model():
    assert (
        Path(__file__).resolve().parents[2]
        / "src-python/models/model_downloads/catalog.py"
    ).exists()
    from models.model_downloads.catalog import CATALOG, validate_catalog

    validate_catalog(CATALOG)
    assert {m.target for m in CATALOG} == {"japanese", "multilingual", "asr", "vad", "diarization", "rvc", "ocr"}
    assert "Mia" not in repr(CATALOG)
    for m in CATALOG:
        pins = {m.revision, *(a.remote[1] for a in m.artifacts if a.remote)}
        assert m.licenses and all(
            any("/" + pin + "/" in url for pin in pins)
            or url.startswith(
                ("https://creativecommons.org/", "https://www.apache.org/licenses/")
            )
            for url in m.licenses
        )
        assert m.artifacts and all(a.size > 0 for a in m.artifacts)



ASR_NAMES = ["qwen3-asr-0.6b", "qwen3-asr-1.7b", "reazonspeech-v2", "parakeet-tdt_ctc-0.6b-ja",
             "parakeet-tdt-0.6b-v3", "haas-ja-v1.0", "nemotron-3.5-transcribe"]


def test_every_file_of_each_offered_recognizer_comes_from_speechcpp_catalog():
    # No pin is typed here or in catalog.py: each entry is a file speech.cpp's catalog names.
    from models.model_downloads.catalog import CATALOG, SPEECH_FIELDS
    from models.model_downloads.speechcpp_asr import OFFERS, speech_model
    from models.model_downloads.speechcpp_models import SNAPSHOT

    assert [offer["name"] for offer in OFFERS] == ASR_NAMES
    speech = {m["name"]: m for m in SNAPSHOT["models"]}
    rows = [m for m in CATALOG if m.target == "asr"]
    expected = [(name, file["type"]) for name in ASR_NAMES
                for file in sorted(speech[name]["files"], key=lambda f: f["type"] != speech[name]["type"])]
    assert [(speech_model(m.id)["name"], speech_model(m.id)["type"]) for m in rows] == expected
    for m in rows:
        info, offer = speech_model(m.id), next(o for o in OFFERS if o["name"] == speech_model(m.id)["name"])
        model = speech[info["name"]]
        file = next(f for f in model["files"] if f["type"] == info["type"])
        assert (m.repo, m.revision) == (model["repository"], model["revision"])
        assert [(a.filename, a.size, a.sha256, a.role, a.remote) for a in m.artifacts] == [
            (file["file"], file["size"], file["sha256"], "model", ())]
        assert (m.license, m.notice, m.provider) == (offer["license"], offer["notice"], offer["provider"])
        assert info["languages"] == model["languages"] and info["default"] == (file["type"] == model["type"])
        assert m.name == f"{offer['label']} · {file['type'].upper()}"
    assert SPEECH_FIELDS["asr"] == ("asr", "model")
    assert speech_model("silero-vad-v62") is None and speech_model("irodori-v41-f16") is None


def test_recognizer_ids_keep_the_folders_of_earlier_downloads():
    from models.model_downloads.catalog import CATALOG

    rows = {m.id: m for m in CATALOG if m.target == "asr"}
    haas, qwen = rows["haas-ja-q8"], rows["qwen3-asr-06b-q8"]
    assert (haas.repo, haas.revision, haas.license, haas.notice) == (
        "sakasegawa/Haas-ja-v1.0-GGUF", "6b965d5007ba780585de51549d57a8c1c0d67c7e", "Apache-2.0", "haas")
    assert [(a.filename, a.size, a.sha256) for a in haas.artifacts] == [(
        "Haas-616M-ja-v1.0-Q8_0.gguf", 656381472, "cd5f60b2f1c411404b83fca4a65e3ce30a26d9e951b6a346529e65f22758afeb")]
    assert haas.licenses == (
        "https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/blob/6b965d5007ba780585de51549d57a8c1c0d67c7e/README.md",
        "https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/blob/6b965d5007ba780585de51549d57a8c1c0d67c7e/LICENSE")
    assert qwen.licenses == (
        "https://huggingface.co/sakasegawa/Qwen3-ASR-0.6B-GGUF/blob/ee78f8709547f39bea3b924a16c72403826cac92/README.md",
        "https://www.apache.org/licenses/LICENSE-2.0")
    assert {"haas-ja-f16", "haas-ja-q4", "qwen3-asr-17b-q8", "reazonspeech-v2-q8", "parakeet-tdt-ctc-06b-ja-q8",
            "parakeet-tdt-06b-v3-f16", "nemotron-35-transcribe-iq4nl"} <= set(rows)


def test_offered_recognizers_carry_only_permissive_reviewed_licenses():
    # docs/voice-stack/licensing.md and licenses/speechcpp-models/NOTICE.md hold the review.
    from models.model_downloads.catalog import CATALOG

    licenses = {m.license for m in CATALOG if m.target == "asr"}
    assert licenses == {"Apache-2.0", "CC BY 4.0", "OpenMDW-1.1"}
    for m in CATALOG:
        if m.license == "CC BY 4.0" and m.target == "asr":
            assert "https://creativecommons.org/licenses/by/4.0/" in m.licenses
        if m.license == "OpenMDW-1.1":
            assert any(url.endswith("/LICENSE") or url.endswith("/LICENSE.OpenMDW-1.1") for url in m.licenses)
    notice = (Path(__file__).resolve().parents[2] / "licenses/speechcpp-models/NOTICE.md").read_text(encoding="utf-8")
    for m in CATALOG:
        if m.target == "asr":
            assert m.repo in notice and m.revision in notice, m.id


def test_speechcpp_snapshot_is_the_bundled_release_and_the_tools_render():
    import json
    import subprocess
    import sys
    from models.model_downloads.speechcpp_models import SNAPSHOT

    root = Path(__file__).resolve().parents[2]
    bundle = json.loads((root / "docs/voice-stack/speechcpp-bundle-artifacts.json").read_text(encoding="utf-8"))
    assert SNAPSHOT["version"] == bundle["version"]
    check = subprocess.run([sys.executable, str(root / "tools/speechcpp_models.py"), "--check"],
                           capture_output=True, text=True)
    assert check.returncode == 0, check.stderr
    # The VAD and diarization entries are speech.cpp's files for those names as well.
    from models.model_downloads.catalog import CATALOG
    speech = {m["name"]: m for m in SNAPSHOT["models"]}
    for id, name in (("silero-vad-v62", "silero-vad"), ("nemotron-3-diarization-q8", "nemotron-3-diarization")):
        entry = next(m for m in CATALOG if m.id == id)
        file = next(f for f in speech[name]["files"] if f["type"] == speech[name]["type"])
        assert (entry.repo, entry.revision) == (speech[name]["repository"], speech[name]["revision"])
        assert (entry.artifacts[0].filename, entry.artifacts[0].size, entry.artifacts[0].sha256) == (
            file["file"], file["size"], file["sha256"])


def test_each_speechcpp_entry_carries_what_a_user_compares_before_choosing():
    # Display name and size are the row's name and total_bytes; the rest is its profile.
    import yaml
    from models.model_downloads.catalog import CATALOG
    from models.model_downloads.speechcpp_asr import PROFILES, model_profile, speech_model
    from models.model_downloads.speechcpp_models import SNAPSHOT

    root = Path(__file__).resolve().parents[2]
    summaries = [yaml.safe_load((root / "locales" / name).read_text(encoding="utf-8"))["model_downloads"]["summary"]
                 for name in ("en.yml", "ja.yml")]
    speech = {m["name"]: m for m in SNAPSHOT["models"]}
    for m in CATALOG:
        profile = model_profile(m.id)
        if m.target not in ("asr", "vad", "diarization", "japanese", "multilingual"):
            assert profile is None, m.id
            continue
        assert set(profile) == {"summary", "languages", "recommended_for", "memory_bytes", "memory_measured_on",
                                "tier", "cpu", "gpu"}
        assert all(profile["summary"] in table and table[profile["summary"]] for table in summaries), m.id
        assert profile["cpu"] in ("practical", "slow", "impractical", "unverified")
        assert profile["gpu"] in ("recommended", "not_needed")
        if m.target in ("japanese", "multilingual"):
            # Speech models: a memory figure for every pinned file, and a GPU (measured on a CPU).
            assert profile["memory_bytes"] > m.artifacts[0].size * 0.9 and profile["memory_measured_on"], m.id
            assert (profile["cpu"], profile["gpu"]) == ("impractical", "recommended"), m.id
            continue
        if m.target != "asr":
            continue
        info = speech_model(m.id)
        # Every file of a recognizer has the peak memory its model card measured, and a tier from it.
        assert profile["memory_bytes"] > m.artifacts[0].size * 0.9 and profile["memory_measured_on"], m.id
        assert profile["tier"] == ("light" if profile["memory_bytes"] <= 1.5 * 2**30
                                   else "medium" if profile["memory_bytes"] <= 4 * 2**30 else "heavy")
        assert profile["languages"] == speech[info["name"]]["languages"]
        # speech.cpp's suggestion per language, on the file it fetches for the name only.
        assert profile["recommended_for"] == (speech[info["name"]]["start"] if info["default"] else [])
    rows = {m.id: model_profile(m.id) for m in CATALOG}
    targets = {m.id: m.target for m in CATALOG}

    def picks(kinds, lang):
        return [id for id, p in rows.items() if p and targets[id] in kinds and lang in p["recommended_for"]]

    assert {lang: picks(("asr",), lang) for lang in ("ja", "en", "uk")} == {
        "ja": ["reazonspeech-v2-q8"], "en": ["qwen3-asr-06b-q8"], "uk": ["parakeet-tdt-06b-v3-f16"]}
    # Speech: the files the app preselects, Irodori for Japanese and Qwen3-TTS for the others.
    assert {lang: picks(("japanese", "multilingual"), lang) for lang in ("ja", "en", "ko")} == {
        "ja": ["irodori-v41-f16"], "en": ["qwen3-06b-q8"], "ko": ["qwen3-06b-q8"]}
    assert rows["irodori-v4-large-q8"]["recommended_for"] == [] and rows["irodori-v4-large-q8"]["tier"] == "medium"
    assert rows["irodori-v41-q8"]["recommended_for"] == [] and rows["irodori-v41-q8"]["summary"] == "irodori_mf"
    assert rows["nemotron-35-transcribe-iq4nl"]["tier"] == "heavy" and rows["silero-vad-v62"]["gpu"] == "not_needed"
    # Only the model VRCT-VOX ran on a CPU says how it runs there; the rest is not claimed.
    assert [name for name, p in PROFILES.items() if p["cpu"] == "slow"] == ["qwen3-asr-0.6b"]

def test_vad_is_pinned_to_speechcpp_catalog():
    # Revisions, sizes and SHA-256 match speech.cpp 0.10.0's `speech models --json`
    # and the Hugging Face LFS metadata of these exact revisions.
    from models.model_downloads.catalog import CATALOG, CATALOG_VERSION, SPEECH_FIELDS

    rows = {m.id: m for m in CATALOG}
    qwen, vad = rows["qwen3-asr-06b-q8"], rows["silero-vad-v62"]
    assert (qwen.repo, qwen.revision, qwen.license, qwen.notice) == (
        "sakasegawa/Qwen3-ASR-0.6B-GGUF", "ee78f8709547f39bea3b924a16c72403826cac92", "Apache-2.0", "qwen_asr")
    assert [(a.filename, a.size, a.sha256, a.role) for a in qwen.artifacts] == [(
        "Qwen3-ASR-0.6B-Q8_0.gguf", 841502336,
        "416e10c15b4a3d9002bd337d18fc450233fdf68502b6e10d1379d2789838afd0", "model")]
    assert (vad.target, vad.repo, vad.revision, vad.license, vad.notice) == (
        "vad", "sakasegawa/silero-vad-GGUF", "7fcb7aa2a70c312f8579fc987b3e1cdecf9321ca", "MIT", "silero")
    assert [(a.filename, a.size, a.sha256, a.role) for a in vad.artifacts] == [(
        "silero-vad-309K-v6.2-F32.gguf", 1238624,
        "2fc312514e5fc4fa4ffd02b25c76a4853fa4130e8fb9777d01502183b01238cb", "model")]
    assert any(url.endswith("/LICENSE") for url in vad.licenses)
    assert SPEECH_FIELDS["vad"] == ("asr", "vad_model") and SPEECH_FIELDS["asr"] == ("asr", "model")
    # Reviewed entries changed (the recognizers on 2026-11-16): stale consent must fail.
    assert CATALOG_VERSION not in ("2026-10-31.1", "2026-11-13.1")


def test_diarization_model_is_pinned_and_goes_to_its_own_field_of_the_asr_profile():
    # Revision, size and SHA-256 are the Hugging Face LFS metadata of this exact revision, read on
    # 2026-11-13; the file is the one speech.cpp 0.10.0 fetches for nemotron-3-diarization.
    from models.model_downloads.catalog import CATALOG, CATALOG_VERSION, SPEECH_FIELDS

    rows = [m for m in CATALOG if m.target == "diarization"]
    assert [m.id for m in rows] == ["nemotron-3-diarization-q8"]
    model = rows[0]
    assert (model.repo, model.revision, model.license, model.notice) == (
        "sakasegawa/Nemotron-3-Diarization-GGUF", "9096d41cb78bba7ac882b96d453e25239eac692b",
        "OpenMDW-1.1", "nemotron_diarization")
    assert [(a.filename, a.size, a.sha256, a.role) for a in model.artifacts] == [(
        "Nemotron-3-Diarization-99M-Q8_0.gguf", 106179488,
        "336df6350dce2ea5ff06aa6e2b249d331a859ced13305fbb45c44bdb3c0abe20", "model")]
    # OpenMDW asks that the agreement goes with the model: the review links to the copy in the repository.
    assert any(url.endswith("/LICENSE.OpenMDW-1.1") for url in model.licenses)
    # It never replaces the recognizer or the detector.
    assert SPEECH_FIELDS["diarization"] == ("asr", "diarization_model")
    assert CATALOG_VERSION not in ("2026-10-31.1", "2026-11-01.7")

@pytest.mark.parametrize(
    "url",
    [
        "http://huggingface.co/x",
        "https://huggingface.co.evil/x",
        "https://localhost/x",
        "https://user:pass@huggingface.co/x",
        "https://huggingface.co:444/x",
        "http://us.aws.cdn.hf.co/x",
        "https://us.aws.cdn.hf.co.evil/x",
        "https://other.aws.cdn.hf.co/x",
        "https://evil@us.aws.cdn.hf.co/x",
    ],
)
def test_transport_rejects_unapproved_redirects(url):
    assert (
        Path(__file__).resolve().parents[2]
        / "src-python/models/model_downloads/transport.py"
    ).exists()
    from models.model_downloads.transport import validate_url

    with pytest.raises(ValueError):
        validate_url(url)


def test_transport_accepts_exact_observed_hf_delivery_host():
    from urllib.request import Request
    from models.model_downloads.transport import PublicRedirect

    request = Request("https://huggingface.co/owner/model/resolve/fixed/file.gguf")
    target = "https://us.aws.cdn.hf.co/bridge/file?test=nonsecret"
    redirected = PublicRedirect().redirect_request(
        request, None, 302, "Found", {}, target
    )
    assert redirected.full_url == target


def test_memory_variants_have_independent_pinned_artifacts_and_guidance(tmp_path):
    from models.model_downloads.manager import Downloads

    catalog = Downloads(tmp_path / "models").catalog()
    models = {row["id"]: row for row in catalog["models"]}
    assert (
        models["irodori-v41-q8"]["artifacts"][0]["sha256"]
        == "2d161b0bbcd74f906f6b07e03d031075f8ae916db1b8bd4daf16cb37b451086a"
    )
    assert (
        models["qwen3-06b-q5"]["artifacts"][0]["sha256"]
        == "4bb9ba9e822ab614798c416c7f0187994f349be41221966fa911aca24f237930"
    )
    assert models["irodori-v41-q8"]["guidance"]["reference_memory_bytes"] == 1590000000
    assert models["qwen3-06b-q5"]["guidance"]["reference_memory_bytes"] == 990000000
    assert (
        models["irodori-v41-f16"]["guidance"]["reference_memory_bytes"]
        > models["irodori-v41-q8"]["guidance"]["reference_memory_bytes"]
    )
    assert models["rvc-saisho"]["guidance"]["reference_memory_bytes"] is None


def test_speechcpp_tts_models_are_pinned_to_speechcpp_catalog(tmp_path):
    # Revisions, sizes and SHA-256 match `speech models --json` of speech.cpp 0.10.0 and 0.11.0: the file it
    # fetches for irodori-tts-mf, irodori-tts, irodori-tts-large, qwen3-tts-0.6b and qwen3-tts-1.7b.
    from models.model_downloads.catalog import CATALOG, CATALOG_VERSION, SPEECH_FIELDS
    from models.model_downloads.manager import Downloads

    rows = {m.id: m for m in CATALOG}
    # The entries that were there first stay first, so the preselected choice does not change.
    assert [m.id for m in CATALOG if m.target == "japanese"] == [
        "irodori-v41-f16", "irodori-v41-q8", "irodori-v41-small-f16", "irodori-v4-large-q8"]
    assert [m.id for m in CATALOG if m.target == "multilingual"] == [
        "qwen3-06b-q8", "qwen3-06b-q5", "qwen3-17b-q8"]
    pinned = {
        "irodori-v41-small-f16": ("sakasegawa/Irodori-TTS-v4.1-Small-GGUF", "66fe2cde1973fd44e7202fbe36df722103958188",
                                  "Irodori-TTS-859M-v4.1-F16.gguf", 1905903936,
                                  "f334932bdf166579bada0a3c8bdabb7199af85682fdcefb6f1cb7e444f5c75b3"),
        "irodori-v4-large-q8": ("sakasegawa/Irodori-TTS-v4-Large-GGUF", "79cae5947a97e941c62912749e1387c8b35ec16b",
                                "Irodori-TTS-3.4B-v4-Q8_0.gguf", 3875154272,
                                "836a2deda5115e4400d25674612ff30d704a358d0b16cf96a3eb510dc416bc4e"),
        "qwen3-17b-q8": ("sakasegawa/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF", "a72e6c6575d67652488cdffc1c863215a9899978",
                         "Qwen3-TTS-12Hz-1.7B-CustomVoice-Q8_0.gguf", 2287780352,
                         "1bc0ef69547c003507b6536639a6080c8856382f4d0963b15d4475528330592d"),
    }
    for id, (repo, revision, filename, size, sha256) in pinned.items():
        model = rows[id]
        assert (model.repo, model.revision) == (repo, revision)
        assert [(a.filename, a.size, a.sha256, a.role) for a in model.artifacts] == [(filename, size, sha256, "model")]
    # Large's text encoder is Gemma's: the review names those terms and links them.
    large = rows["irodori-v4-large-q8"]
    assert large.notice == "irodori_large" and large.license.startswith("Gemma Terms of Use")
    assert any(url.endswith("/GEMMA_TERMS_OF_USE.md") for url in large.licenses)
    assert any(url.endswith("/GEMMA_PROHIBITED_USE_POLICY.md") for url in large.licenses)
    assert (rows["irodori-v41-small-f16"].license, rows["qwen3-17b-q8"].license) == ("MIT + Apache-2.0", "Apache-2.0")
    # drama-3 (Fish Audio Community License) is not offered.
    assert not any("drama" in m.id or "drama" in m.repo.lower() for m in CATALOG)
    assert SPEECH_FIELDS["japanese"] == ("japanese", "model") and SPEECH_FIELDS["multilingual"] == ("multilingual", "model")
    assert CATALOG_VERSION not in ("2026-11-13.1", "2026-11-16.1")
    # New entries are never recommended over the checked ones: their check is pending.
    models = {row["id"]: row for row in Downloads(tmp_path / "models").catalog()["models"]}
    for id in pinned:
        assert models[id]["guidance"]["validation"]["state"] == "pending"
    assert models["irodori-v4-large-q8"]["guidance"]["tier"] == "large"
    # The review dialog, the guidance and the choice line read these keys.
    root = Path(__file__).resolve().parents[2]
    for locale in ("en.yml", "ja.yml"):
        text = (root / "locales" / locale).read_text(encoding="utf-8")
        for key in ("notice_irodori_large", "tier_large", "choice_japanese", "choice_multilingual"):
            assert f"\n    {key}: " in text, (locale, key)
