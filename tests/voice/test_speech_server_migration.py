"""The speech server a saved file never chose (#566).

New settings speak through the bundled server. Before that a missing choice meant the
external server, so a saved file whose speech settings name no server keeps the external
one; a new install stays on the bundled one. The Rust core does the same
(native/core/tests/config_versions.rs).
"""
import json
from pathlib import Path

import pytest

JAPANESE_URL = "http://127.0.0.1:8080"


def start(path, saved):
    """Load the real Config from `path`, writing `saved` there first (None: no file; str: raw text)."""
    from config import Config
    if isinstance(saved, str):
        path.write_text(saved, encoding="utf-8")
    elif saved is not None:
        path.write_text(json.dumps(saved), encoding="utf-8")
    config = object.__new__(Config)
    config.init_config()
    config._PATH_CONFIG = str(path)
    config.load_config()
    return config


def stop(config):
    timer = getattr(config, "_timer", None)
    if timer:
        timer.cancel()


def servers(voice):
    return voice["japanese_server"], voice["multilingual_server"]


@pytest.mark.parametrize("saved", [None, {}, "{not json"], ids=["no file", "empty", "unreadable"])
def test_a_new_install_starts_on_the_bundled_server(tmp_path, saved):
    path = tmp_path / "config.json"
    config = start(path, saved)
    try:
        assert servers(config.VOICE_SETTINGS) == ("bundled", "bundled")
        assert servers(json.loads(path.read_text(encoding="utf-8"))["VOICE_SETTINGS"]) == ("bundled", "bundled")
    finally:
        stop(config)


@pytest.mark.parametrize("saved,expected", [
    # Written before the speech settings existed: the older default was the external server.
    ({"UI_LANGUAGE": "ja"}, ("external", "external")),
    ({"VOICE_SETTINGS": "not settings"}, ("external", "external")),
    # A URL without a server choice keeps reaching that URL.
    ({"VOICE_SETTINGS": {"mode": "original", "output_device": "cable", "japanese_url": "http://127.0.0.1:50080"}},
     ("external", "external")),
    # Each role is decided on its own; a saved choice is never changed.
    ({"VOICE_SETTINGS": {"japanese_server": "bundled"}}, ("bundled", "external")),
    ({"VOICE_SETTINGS": {"japanese_server": "external", "multilingual_server": "bundled"}}, ("external", "bundled")),
], ids=["no speech settings", "unusable speech settings", "url only", "japanese chosen", "both chosen"])
def test_a_saved_file_without_a_server_choice_keeps_the_external_server(tmp_path, saved, expected):
    path = tmp_path / "config.json"
    config = start(path, saved)
    try:
        assert servers(config.VOICE_SETTINGS) == expected
        written = json.loads(path.read_text(encoding="utf-8"))["VOICE_SETTINGS"]
        assert servers(written) == expected
        voice = saved.get("VOICE_SETTINGS")
        if isinstance(voice, dict):
            # The rest of the saved settings is kept as it was.
            for key, value in voice.items():
                assert written[key] == value
        else:
            assert written["japanese_url"] == JAPANESE_URL
    finally:
        stop(config)


def test_a_choice_saved_by_this_version_is_kept_on_the_next_start(tmp_path):
    path = tmp_path / "config.json"
    config = start(path, None)
    try:
        config.VOICE_SETTINGS = {**config.VOICE_SETTINGS, "multilingual_server": "external"}
        config.saveConfigToFile()
    finally:
        stop(config)
    again = start(path, json.loads(Path(path).read_text(encoding="utf-8")))
    try:
        assert servers(again.VOICE_SETTINGS) == ("bundled", "external")
    finally:
        stop(again)
