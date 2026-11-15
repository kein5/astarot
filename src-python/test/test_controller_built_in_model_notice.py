"""The startup notice about missing built-in models is for the engines in use."""
from types import SimpleNamespace

import pytest

import controller as controller_module
from controller import Controller


@pytest.mark.parametrize("translation,transcription,ctranslate2,missing", [
    # A fresh install: the default translator is the built-in one, nothing downloaded.
    ("CTranslate2", None, False, True),
    # The translation model is there and transcription uses Google: nothing in use is missing.
    ("CTranslate2", "Google", True, False),
    # External services for both: the built-in models are not used.
    ("DeepL_API", "Google", False, False),
    ("DeepL_API", None, False, False),
    # The local speech recognition is speech.cpp (#288): its models are pointed at by the main
    # screen's setup list and Settings, never by this notice.
    ("DeepL_API", "SpeechCpp", False, False),
    ("CTranslate2", "SpeechCpp", True, False),
    ("CTranslate2", "SpeechCpp", False, True),
])
def test_only_a_model_the_selected_engines_need_counts_as_missing(
        monkeypatch, translation, transcription, ctranslate2, missing):
    monkeypatch.setattr(controller_module, "config", SimpleNamespace(
        SELECTED_TAB_NO="2",
        # Another tab still on the default must not bring the notice back.
        SELECTED_TRANSLATION_ENGINES={"1": "CTranslate2", "2": translation, "3": "CTranslate2"},
        SELECTED_TRANSCRIPTION_ENGINE=transcription,
    ))
    assert Controller._missingBuiltInModelInUse(ctranslate2) is missing
