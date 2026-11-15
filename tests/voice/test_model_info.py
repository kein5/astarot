"""Every downloadable model carries what a first-time user compares to choose it."""
from collections import defaultdict
from pathlib import Path
import re

import yaml

ROOT = Path(__file__).resolve().parents[2]
KEYS = ["title", "summary", "variant", "languages", "device", "recommended"]


def locale(name):
    return yaml.safe_load((ROOT / "locales" / name).read_text(encoding="utf-8"))["model_catalog"]


def test_every_catalog_entry_is_described_with_valid_values():
    from models.model_downloads.catalog import CATALOG
    from models.model_downloads.model_info import DEVICES, INFO, VARIANTS

    assert INFO["version"] == 1
    ids = [m.id for m in CATALOG]
    # A new catalog entry needs its description too, and nothing describes a model that is gone.
    assert sorted(INFO["models"]) == sorted(ids)
    for id, info in INFO["models"].items():
        assert list(info) == KEYS, id
        assert info["variant"] in VARIANTS and info["device"] in DEVICES, id
        assert type(info["recommended"]) is bool, id
        languages = info["languages"]
        assert languages and len(set(languages)) == len(languages), id
        assert languages == ["*"] or all(
            re.fullmatch(r"[a-z]{2,3}|und-[A-Z][a-z]{3}", tag) for tag in languages), id


def test_one_default_pick_per_use():
    from models.model_downloads.catalog import CATALOG
    from models.model_downloads.model_info import model_info

    picks = defaultdict(list)
    for m in CATALOG:
        if model_info(m.id)["recommended"]:
            picks[m.target].append(m.id)
    # The models the app already preselects or needs. Speaker labels are optional, so none.
    assert dict(picks) == {
        "japanese": ["irodori-v41-f16"], "multilingual": ["qwen3-06b-q8"], "rvc": ["rvc-saisho"],
        "asr": ["haas-ja-q8"], "vad": ["silero-vad-v62"],
        "ocr": ["ppocrv6-small", "vrct-vox-chatbox-detector"]}
    # The first file of each TTS list is the default pick, so the preselected choice agrees.
    for target in ("japanese", "multilingual"):
        assert next(m.id for m in CATALOG if m.target == target) == picks[target][0]


def test_speech_models_need_a_gpu_and_restricted_terms_are_not_the_default():
    from models.model_downloads.model_info import model_info

    # Measured on an i7-1255U CPU (2026-11-16): Irodori MF 3-7 s to the first audio and about
    # 4x slower than real time; Qwen3-TTS 1.7B about 3x; Irodori Small 20-100 s.
    for id in ("irodori-v41-f16", "irodori-v41-q8", "irodori-v41-small-f16", "irodori-v4-large-q8",
               "qwen3-06b-q8", "qwen3-06b-q5", "qwen3-17b-q8"):
        assert model_info(id)["device"] == "gpu", id
    assert model_info("irodori-v4-large-q8")["recommended"] is False  # Gemma Terms of Use
    assert model_info("irodori-v41-q8")["variant"] == "compact"
    assert model_info("no-such-model") is None


def test_the_catalog_answer_carries_the_description(tmp_path):
    from models.model_downloads.manager import Downloads

    for row in Downloads(tmp_path / "models").catalog()["models"]:
        assert row["info"]["title"] and row["total_bytes"] > 0 and row["name"], row["id"]


def test_every_word_is_in_both_languages():
    from models.model_downloads.model_info import INFO

    for name in ("en.yml", "ja.yml"):
        words = locale(name)
        assert words["recommended"] and words["any_language"]
        for info in INFO["models"].values():
            assert words["title"][info["title"]] and words["summary"][info["summary"]], (name, info)
            assert words["variant"][info["variant"]], name
            assert words["device"][info["device"]] and words["device_help"][info["device"]], name
    # Same keys in both, so neither language misses a line.
    en, ja = locale("en.yml"), locale("ja.yml")
    for group in ("variant", "device", "device_help", "title", "summary"):
        assert set(en[group]) == set(ja[group]), group
