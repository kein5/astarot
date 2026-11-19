"""The manual's record of the speech model checks says what the model cards say (#566).

site/*/guide/models.md lists every speech model of the download catalog with the GPU it was
checked on, or as pending, and quotes the scope the cards show. The cards read the same
record (models/model_downloads/guidance.py; native/ops compares the Rust copy with it) and
the words in locales/*.yml, so a new model, a new check or a reworded scope shows up here.
"""
import re
from pathlib import Path

import pytest
import yaml

from models.model_downloads.catalog import CATALOG
from models.model_downloads.guidance import model_guidance

ROOT = Path(__file__).resolve().parents[2]
HEADINGS = {"ja": "### 動作確認の記録", "en": "### Execution checks"}
SPEECH_TARGETS = ("japanese", "multilingual")


def downloads_text(lang):
    with open(ROOT / "locales" / f"{lang}.yml", encoding="utf-8") as stream:
        return yaml.safe_load(stream)["model_downloads"]


def record(lang):
    """{model name: cell} of the first table under the heading, and the section's text."""
    text = (ROOT / "site" / lang / "guide" / "models.md").read_text(encoding="utf-8")
    assert HEADINGS[lang] in text, HEADINGS[lang]
    section = text.split(HEADINGS[lang], 1)[1].split("\n#", 1)[0]
    rows = [line for line in section.splitlines() if line.startswith("|")][2:]
    cells = [[cell.strip() for cell in row.strip().strip("|").split("|")] for row in rows]
    assert all(len(row) == 2 for row in cells), cells
    return dict(cells), section


def speech_models():
    return [model for model in CATALOG if model.target in SPEECH_TARGETS]


@pytest.mark.parametrize("lang", HEADINGS)
def test_every_speech_model_is_listed_with_the_gpu_it_was_checked_on(lang):
    rows, _ = record(lang)
    pending = downloads_text(lang)["validation_pending"]
    assert set(rows) == {model.name for model in speech_models()}
    for model in speech_models():
        validation = model_guidance(model.id)["validation"]
        cell = rows[model.name]
        if validation["state"] == "passed":
            assert cell == validation["device"], model.id
        else:
            # The card's sentence, without its closing words ("です。", ".").
            assert cell and pending.startswith(cell), (model.id, cell)


@pytest.mark.parametrize("lang", HEADINGS)
def test_the_checked_scope_is_quoted_as_the_cards_say_it(lang):
    _, section = record(lang)
    texts = downloads_text(lang)
    scopes = {model_guidance(model.id)["validation"]["scope"] for model in speech_models()} - {None}
    assert scopes
    for scope in scopes:
        assert texts[f"scope_{scope}"] in section, scope
    # Only what the cards say: no other scope sentence of the cards is in the section.
    others = [key for key in texts if re.fullmatch(r"scope_\w+", key) and key[len("scope_"):] not in scopes]
    for key in others:
        assert texts[key] not in section, key
