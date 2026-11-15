"""The move from the removed local Whisper engine to speech.cpp (#288).

A saved choice of Whisper moves to the speech.cpp engine once, with a notice that is
shown until the user closes it; old Whisper weights are reported and deleted only on
request. Settings run on the production definitions with fake dependencies.
"""
import json
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from errors import ErrorCode, VRCTError
from test_config_persistence_regressions import definitions, isolated, strict_json  # noqa: F401

SOURCE = Path(__file__).resolve().parents[1]


def load(isolated, monkeypatch, tmp_path, saved, platform="win32"):
    state = tmp_path / "state"
    state.mkdir(parents=True)
    if saved is not None:
        (state / "config.json").write_text(json.dumps(saved))
    monkeypatch.setenv("VRCT_CONFIG_DIR", str(state))
    monkeypatch.setitem(isolated.ns, "sys", SimpleNamespace(platform=platform))
    isolated.ns["errorLogging"].reset_mock()
    config = isolated.ns["Config"]()
    return config, state / "config.json"


REALTIME = {"server": "external", "base_url": "http://127.0.0.1:9000", "start_server": False}


@pytest.mark.parametrize("platform,server", [
    # On Windows, choosing Whisper meant recognizing on this PC: the bundled server takes over.
    ("win32", "bundled"),
    # The Linux switches always used the realtime server; that choice stays as it was.
    ("linux", "external"),
])
def test_a_saved_whisper_choice_moves_to_speech_cpp_and_asks_for_the_notice(isolated, monkeypatch, tmp_path,
                                                                            platform, server):
    saved = {"SELECTED_TRANSCRIPTION_ENGINE": "Whisper", "REALTIME_ASR_SETTINGS": REALTIME, "LOCAL_ASR_MIGRATION": 1,
             "WHISPER_WEIGHT_TYPE": "small", "SELECTED_TRANSCRIPTION_COMPUTE_TYPE": "int8",
             "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE": {"device": "cpu"}, "MIC_NO_REPEAT_NGRAM_SIZE": 3,
             "SPEAKER_NO_REPEAT_NGRAM_SIZE": 3, "MIC_AVG_LOGPROB": -0.5}
    config, path = load(isolated, monkeypatch, tmp_path, saved, platform)

    assert config.SELECTED_TRANSCRIPTION_ENGINE == "SpeechCpp"
    assert config.LOCAL_ASR_NOTICE_PENDING is True
    # The server choice changes, the rest of the realtime settings is kept.
    assert config.REALTIME_ASR_SETTINGS == {**REALTIME, "server": server}
    written = strict_json(path.read_text())
    assert written["SELECTED_TRANSCRIPTION_ENGINE"] == "SpeechCpp"
    assert written["LOCAL_ASR_NOTICE_PENDING"] is True
    assert written["LOCAL_ASR_MIGRATION"] == isolated.ns["LOCAL_ASR_MIGRATION_LATEST"] == 2
    assert written["REALTIME_ASR_SETTINGS"]["server"] == server
    # The removed settings are dropped; the cloud engines' threshold stays.
    for key in ("WHISPER_WEIGHT_TYPE", "SELECTED_TRANSCRIPTION_COMPUTE_TYPE", "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE",
                "MIC_NO_REPEAT_NGRAM_SIZE", "SPEAKER_NO_REPEAT_NGRAM_SIZE"):
        assert key not in written
    assert written["MIC_AVG_LOGPROB"] == -0.5
    # A retired choice is not a broken file: nothing is logged as an error.
    isolated.ns["errorLogging"].assert_not_called()


def test_a_whisper_choice_from_before_both_steps_selects_the_bundled_server_once(isolated, monkeypatch, tmp_path):
    saved = {"SELECTED_TRANSCRIPTION_ENGINE": "Whisper", "REALTIME_ASR_SETTINGS": {"server": "bundled"}}
    config, path = load(isolated, monkeypatch, tmp_path, saved)
    assert config.SELECTED_TRANSCRIPTION_ENGINE == "SpeechCpp"
    assert config.REALTIME_ASR_SETTINGS == {"server": "bundled"}
    assert config.LOCAL_ASR_NOTICE_PENDING is True
    assert strict_json(path.read_text())["LOCAL_ASR_MIGRATION"] == 2


@pytest.mark.parametrize("saved,engine,notice", [
    # Never on Whisper: no notice, nothing moves.
    ({"SELECTED_TRANSCRIPTION_ENGINE": "Google", "REALTIME_ASR_SETTINGS": REALTIME, "LOCAL_ASR_MIGRATION": 1}, "Google", False),
    ({"SELECTED_TRANSCRIPTION_ENGINE": "Google", "REALTIME_ASR_SETTINGS": REALTIME}, "Google", False),
    # Migrated already: a later choice and the user's own server stay, and so does an unread notice.
    ({"SELECTED_TRANSCRIPTION_ENGINE": "Google", "REALTIME_ASR_SETTINGS": REALTIME, "LOCAL_ASR_MIGRATION": 2,
      "LOCAL_ASR_NOTICE_PENDING": False}, "Google", False),
    ({"SELECTED_TRANSCRIPTION_ENGINE": "SpeechCpp", "REALTIME_ASR_SETTINGS": REALTIME, "LOCAL_ASR_MIGRATION": 2,
      "LOCAL_ASR_NOTICE_PENDING": True}, "SpeechCpp", True),
])
def test_settings_already_migrated_or_never_on_whisper_are_left_alone(isolated, monkeypatch, tmp_path, saved, engine, notice):
    config, path = load(isolated, monkeypatch, tmp_path, saved)
    assert config.SELECTED_TRANSCRIPTION_ENGINE == engine
    assert config.LOCAL_ASR_NOTICE_PENDING is notice
    assert config.REALTIME_ASR_SETTINGS == REALTIME
    assert strict_json(path.read_text())["LOCAL_ASR_NOTICE_PENDING"] is notice


@pytest.mark.parametrize("saved", [None, {}])
def test_a_new_install_has_no_notice_pending(isolated, monkeypatch, tmp_path, saved):
    config, _ = load(isolated, monkeypatch, tmp_path, saved)
    assert config.LOCAL_ASR_NOTICE_PENDING is False
    assert config.LOCAL_ASR_MIGRATION == 2
    assert config.SELECTED_TRANSCRIPTION_ENGINE is None


def test_whisper_is_not_an_engine_but_its_language_column_stays_for_the_cloud(isolated, monkeypatch, tmp_path):
    codes = {"Google": "ja-JP", "Whisper": "ja", "Groq_Whisper": "ja", "OpenAI_Whisper": "ja",
             "Custom_Whisper": "ja", "Deepgram": "ja"}
    monkeypatch.setitem(isolated.ns, "transcription_lang", {"Japanese": {"Japan": codes}})
    config, _ = load(isolated, monkeypatch, tmp_path, None)
    assert config.SELECTABLE_TRANSCRIPTION_ENGINE_LIST == [
        "Google", "SpeechCpp", "Groq_Whisper", "OpenAI_Whisper", "Custom_Whisper", "Deepgram"]
    with pytest.raises(isolated.ns["ConfigValidationError"]):
        config.SELECTED_TRANSCRIPTION_ENGINE = "Whisper"
    for key in ("WHISPER_WEIGHT_TYPE", "SELECTABLE_WHISPER_WEIGHT_TYPE_LIST", "SELECTABLE_WHISPER_WEIGHT_TYPE_DICT",
                "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE", "SELECTED_TRANSCRIPTION_COMPUTE_TYPE",
                "MIC_NO_REPEAT_NGRAM_SIZE", "SPEAKER_NO_REPEAT_NGRAM_SIZE"):
        assert not hasattr(type(config), key), key


def make_controller(config, model):
    namespace = dict(config=config, model=model, ErrorCode=ErrorCode, VRCTError=VRCTError,
                     errorLogging=Mock(), printLog=Mock())
    definitions("controller.py", namespace, class_methods={
        "getLocalAsrNotice", "setDisableLocalAsrNotice", "getOldWhisperWeights", "deleteOldWhisperWeights"})
    return namespace["Controller"](), namespace


def test_closing_the_notice_clears_it_for_good(isolated, monkeypatch, tmp_path):
    config, path = load(isolated, monkeypatch, tmp_path, {"SELECTED_TRANSCRIPTION_ENGINE": "Whisper"})
    controller, _ = make_controller(config, Mock())
    assert controller.getLocalAsrNotice() == {"status": 200, "result": True}
    assert controller.setDisableLocalAsrNotice() == {"status": 200, "result": False}
    assert controller.getLocalAsrNotice() == {"status": 200, "result": False}
    config.saveConfigToFile()
    assert strict_json(path.read_text())["LOCAL_ASR_NOTICE_PENDING"] is False
    # A restart does not bring it back.
    restarted, _ = load(isolated, monkeypatch, tmp_path / "again", json.loads(path.read_text()))
    assert restarted.LOCAL_ASR_NOTICE_PENDING is False
    assert restarted.SELECTED_TRANSCRIPTION_ENGINE == "SpeechCpp"


def test_the_weight_endpoints_answer_from_the_model_and_never_download():
    model = Mock()
    model.getOldWhisperWeights.return_value = {"total_bytes": 9, "folders": ["base"]}
    model.deleteOldWhisperWeights.return_value = {"total_bytes": 0, "folders": [], "freed_bytes": 9, "failed": []}
    controller, namespace = make_controller(SimpleNamespace(), model)
    assert controller.getOldWhisperWeights() == {"status": 200, "result": {"total_bytes": 9, "folders": ["base"]}}
    assert controller.deleteOldWhisperWeights()["result"]["freed_bytes"] == 9
    assert [call[0] for call in model.method_calls] == ["getOldWhisperWeights", "deleteOldWhisperWeights"]
    # The log says how much, never where.
    logged = str(namespace["printLog"].call_args_list)
    assert "freed_bytes" in logged and "/" not in logged.replace("'/'", "")


@pytest.mark.parametrize("method,code", [("getOldWhisperWeights", "old_whisper_weights_unreadable"),
                                         ("deleteOldWhisperWeights", "old_whisper_weights_delete_failed")])
def test_a_weight_endpoint_that_fails_answers_with_its_code(method, code):
    model = Mock(**{f"{method}.side_effect": OSError(13, "denied", "/home/someone/weights")})
    controller, namespace = make_controller(SimpleNamespace(), model)
    assert getattr(controller, method)() == {"status": 500, "result": {"error_code": code}}
    namespace["errorLogging"].assert_called_once_with()


def test_the_ipc_table_has_the_new_endpoints_and_none_of_the_removed_ones():
    text = (SOURCE / "mainloop.py").read_text(encoding="utf-8")
    start = text.index("mapping = {", text.index("run_mapping = {") + 1)
    endpoints = set(re.findall(r'^\s*"(/[a-z]+/[a-z_/]+)"\s*:', text[start:], re.M))
    assert {"/get/data/local_asr_notice", "/set/disable/local_asr_notice",
            "/get/data/old_whisper_weights", "/run/delete_old_whisper_weights"} <= endpoints
    removed = {"/get/data/selectable_whisper_weight_type_dict", "/get/data/selected_whisper_weight_type",
               "/set/data/selected_whisper_weight_type", "/get/data/selected_transcription_compute_type",
               "/set/data/selected_transcription_compute_type", "/get/data/selectable_transcription_compute_device_list",
               "/get/data/selected_transcription_compute_device", "/set/data/selected_transcription_compute_device",
               "/run/download_whisper_weight"}
    assert not removed & endpoints
    # The cloud engines still filter segments with these thresholds.
    assert {"/get/data/mic_avg_logprob", "/set/data/speaker_no_speech_prob"} <= endpoints
    for gone in ("whisper_weight_type", "download_whisper_weight", "downloaded_whisper_weight", "error_whisper_weight",
                 "transcription_mic_vram_overflow", "transcription_speaker_vram_overflow",
                 "selected_transcription_compute"):
        assert gone not in text
