"""The contract of the readings (transliteration, issue #277), held against the Python code.

`native/translation/tests/contract/transliteration.json` lists texts and kana. This test
records, from `models/transliteration/` with SudachiPy and the full SudachiDict, the morphemes
of each text, the readings `Transliterator.analyze` made of them and `katakana_to_hepburn` of
each kana, and compares them with the file. The Rust readings are held to the same records by
`native/translation/tests/transliteration_contract.rs`, so the file stays the specification once
the Python code is gone.

Record again with `VRCT_TRANSLATION_CONTRACT_WRITE=1`.
"""

import json
import os
from importlib import metadata
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
CONTRACT = REPO / "native" / "translation" / "tests" / "contract" / "transliteration.json"
WRITE = os.environ.get("VRCT_TRANSLATION_CONTRACT_WRITE") == "1"


def _load():
    with open(CONTRACT, encoding="utf-8") as fp:
        return json.load(fp)


def _row(item):
    return [item["orig"], item["kana"], item["hira"], item["hepburn"]]


@pytest.fixture(scope="module")
def transliterator():
    try:
        from models.transliteration.transliteration_transliterator import Transliterator
        return Transliterator()
    except Exception as error:  # pragma: no cover - only where SudachiDict full is missing
        pytest.skip(f"SudachiPy with SudachiDict full is not installed: {type(error).__name__}")


def record(transliterator):
    from models.transliteration.transliteration_kana_to_hepburn import katakana_to_hepburn

    document = _load()
    sentences = []
    for entry in document["sentences"]:
        text = entry["text"]
        tokens = transliterator.tokenizer_obj.tokenize(text, transliterator.mode)
        morphemes = [[t.surface(), t.reading_form(), (t.part_of_speech() or [""])[0]] for t in tokens]
        sentences.append({
            "text": text,
            "morphemes": morphemes,
            "readings": [_row(item) for item in transliterator.analyze(text, use_macron=False)],
            "readings_macron": [_row(item) for item in transliterator.analyze(text, use_macron=True)],
        })
    hepburn = [[row[0], katakana_to_hepburn(row[0], use_macron=False), katakana_to_hepburn(row[0], use_macron=True)]
               for row in document["hepburn"]]
    dictionary = {
        "name": "SudachiDict full",
        "version": metadata.version("sudachidict_full"),
        "analyzer": f"SudachiPy {metadata.version('SudachiPy')}",
        "split_mode": "C",
    }
    return document, {"dictionary": dictionary, "sentences": sentences, "hepburn": hepburn}


def _write(document):
    """One sentence and one kana per line, so that a change shows as the lines it touches."""
    lines = ["{"]
    keys = list(document)
    for at, key in enumerate(keys):
        value = document[key]
        comma = "," if at < len(keys) - 1 else ""
        if key in ("sentences", "hepburn"):
            rows = [json.dumps(item, ensure_ascii=False) for item in value]
            lines.append(f"  {json.dumps(key)}: [")
            lines.extend(f"    {row}{',' if i < len(rows) - 1 else ''}" for i, row in enumerate(rows))
            lines.append(f"  ]{comma}")
        else:
            text = json.dumps(value, ensure_ascii=False, indent=2).replace("\n", "\n  ")
            lines.append(f"  {json.dumps(key)}: {text}{comma}")
    lines.append("}")
    with open(CONTRACT, "w", encoding="utf-8", newline="\n") as fp:
        fp.write("\n".join(lines) + "\n")


def test_the_python_readings_keep_the_contract(transliterator):
    document, recorded = record(transliterator)
    if WRITE:
        document.update(recorded)
        _write(document)
        return
    assert recorded["dictionary"] == document["dictionary"], "another SudachiDict; record again"
    for want, got in zip(document["sentences"], recorded["sentences"]):
        assert got == want, want["text"]
    assert recorded["hepburn"] == document["hepburn"]


def test_the_pipeline_keeps_only_the_readings_asked_for(transliterator):
    """`convertMessageToTransliteration` keeps orig and the asked readings, in that order."""
    from model import Model

    model = object.__new__(Model)
    model._inited = True
    model.transliterator = transliterator
    entries = model.convertMessageToTransliteration("東京に行く", hiragana=False, romaji=True)
    assert [list(entry) for entry in entries] == [["orig", "hepburn"]] * len(entries)
    assert model.convertMessageToTransliteration("東京", hiragana=False, romaji=False) == []
