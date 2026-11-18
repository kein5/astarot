import ast
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def test_headless_cli_does_not_import_windows_or_heavy_model_runtime():
    code = """
import runpy, sys
sys.argv = ['voice_cli.py', '--help']
try:
    runpy.run_path('tools/voice_cli.py', run_name='__main__')
except SystemExit as exc:
    assert exc.code == 0
for name in ('pyaudiowpatch', 'pycaw', 'windows_capture', 'model', 'config', 'torch', 'numpy'):
    assert name not in sys.modules, name
"""
    result = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, result.stderr
    assert "speak" in result.stdout


def test_voice_endpoints_exist_on_both_sides():
    tree = ast.parse((ROOT / "src-python/mainloop.py").read_text(encoding="utf-8"))
    backend = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)
               and ("/voice_" in n.value or n.value in {"/run/stop_voice", "/run/mute_voice", "/run/resume_voice"})}
    routes = (ROOT / "src-ui/logics/useReceiveRoutes.js").read_text(encoding="utf-8")
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
