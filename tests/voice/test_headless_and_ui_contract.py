import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def test_voice_endpoints_exist_on_both_sides():
    # The Python backend's endpoints and notifications, as the specification keeps them.
    python = json.loads((ROOT / "tools/spec_python_baseline.json").read_text(encoding="utf-8"))
    names = [entry["endpoint"] for entry in python["endpoints"] + python["notifications"]]
    backend = {name for name in names if "/voice_" in name or name in {"/run/stop_voice", "/run/mute_voice", "/run/resume_voice"}}
    routes = (ROOT / "src-ui/logics/useReceiveRoutes.ts").read_text(encoding="utf-8")
    # Endpoints only the Rust core has (the voice audition of #415) are listed in
    # tools/spec_core_additions.json and have no counterpart in the Python backend.
    additions = json.loads((ROOT / "tools/spec_core_additions.json").read_text(encoding="utf-8"))
    core_only = {entry["endpoint"] for entry in additions["endpoints"]}
    frontend = set(re.findall(r'endpoint: "([^"]*(?:/voice_[^"/]+|/(?:stop|mute|resume)_voice))"', routes)) - core_only
    assert backend == frontend
    assert backend == {'/get/data/voice_settings', '/set/data/voice_settings', '/get/data/voice_status',
                       '/get/data/voice_output_devices', '/get/data/voice_route',
                       '/run/stop_voice', '/run/mute_voice', '/run/resume_voice'}


def test_ui_labels_have_japanese_and_english_translations():
    import yaml
    en = yaml.safe_load((ROOT / "locales/en.yml").read_text(encoding="utf-8"))["voice"]
    ja = yaml.safe_load((ROOT / "locales/ja.yml").read_text(encoding="utf-8"))["voice"]
    assert set(en) == set(ja)
    assert all(en.values()) and all(ja.values())
