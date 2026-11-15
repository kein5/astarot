"""Write what the Python backend does with saved settings, for the Rust core's tests to compare.

    python native/core/reference/dump_reference.py            # rewrite the files below
    python native/core/reference/dump_reference.py --check    # fail if one is out of date

- tests/data/python_config_reference.json: for each saved config.json in CASES, on Windows and
  on Linux, the file the Python backend writes back right after start-up (load, migrate, save),
  and what it noticed (an unreadable file moved aside, URLs it dropped, the local ASR notice).
- data/translation_languages.json and data/transcription_languages.json: the language tables
  the settings are checked against (languages.yml and transcription_languages.py).

Every case runs in its own Python process, with the audio devices and the compute devices
replaced by fixed values, so that nothing of the PC that wrote the files ends up in them.
Nothing here opens the network, a device or a model. tests/voice/test_native_core_reference.py
runs --check.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
CRATE = Path(__file__).resolve().parents[1]
OUTPUT = CRATE / "tests" / "data" / "python_config_reference.json"
TRANSLATION_LANGUAGES = CRATE / "data" / "translation_languages.json"
TRANSCRIPTION_LANGUAGES = CRATE / "data" / "transcription_languages.json"
VERSION = "0.4.0-beta.1"
TOKEN = "fixed-websocket-token-for-the-reference"
# What the CTranslate2 CPU build answers on every supported PC (int8 needs no AVX-512).
CPU_DEVICE = {"device": "cpu", "device_index": 0, "device_name": "cpu",
              "compute_types": ["auto", "float32", "int8", "int8_float32"]}

LANG = {"language": "Japanese", "country": "Japan", "enable": True}

# name -> the saved config.json: a JSON value, or {"raw": text} for a file that is not JSON,
# or None for no file at all.
CASES = {
    "no_file": None,
    "empty_object": {},
    "ui_language_only": {"UI_LANGUAGE": "ja"},
    "retired_ui_language": {"UI_LANGUAGE": "ko", "TRANSPARENCY": 80},
    "not_json": {"raw": "{\"UI_LANGUAGE\": \"ja\","},
    "json_list": {"raw": "[1, 2, 3]"},
    "not_utf8": {"raw_bytes": "ff fe 00 7b"},
    "retired_whisper_engine": {"SELECTED_TRANSCRIPTION_ENGINE": "Whisper", "LOCAL_ASR_MIGRATION": 1},
    "retired_whisper_engine_no_step": {"SELECTED_TRANSCRIPTION_ENGINE": "Whisper"},
    "bundled_realtime_server_step_0": {"REALTIME_ASR_SETTINGS": {"server": "bundled"}, "LOCAL_ASR_MIGRATION": 0},
    "bundled_realtime_server_done": {"REALTIME_ASR_SETTINGS": {"server": "bundled"}, "LOCAL_ASR_MIGRATION": 2,
                                     "SELECTED_TRANSCRIPTION_ENGINE": "Google"},
    "migration_step_out_of_range": {"LOCAL_ASR_MIGRATION": 7, "SELECTED_TRANSCRIPTION_ENGINE": "Whisper"},
    "invalid_saved_urls": {"LMSTUDIO_URL": "http://example.com/v1", "OPENAI_COMPATIBLE_URL": "https://user:pw@api.example.com/v1",
                           "TRANSCRIPTION_CUSTOM_URL": "https://api.example.com/v1?api_key=x"},
    "valid_saved_urls": {"LMSTUDIO_URL": "http://192.168.1.20:1234/v1", "OPENAI_COMPATIBLE_URL": "https://api.example.com/v1",
                         "TRANSCRIPTION_CUSTOM_URL": "http://localhost:9000/v1"},
    "old_hotkeys": {"HOTKEYS": {"toggle_vrct_visibility": ["Ctrl", "F1"], "toggle_translation": None}},
    "hotkeys_unknown_action": {"HOTKEYS": {"toggle_translation": ["F2"], "launch_rockets": ["F3"]}},
    "hotkeys_bad_value": {"HOTKEYS": {"toggle_translation": "F2", "stop_voice": ["F4"]}},
    "unknown_and_readonly_keys": {"VERSION": "9.9.9", "ENABLE_TRANSLATION": True, "SOME_OLD_KEY": 1,
                                  "SELECTABLE_TAB_NO_LIST": ["9"], "PATH_LOGS": "/tmp/x"},
    "wrong_types": {"TRANSPARENCY": "100", "UI_SCALING": 90.0, "MIC_THRESHOLD": 5000, "OSC_PORT": True,
                    "SEND_MESSAGE_TO_VRC": 1, "FONT_FAMILY": None, "MESSAGE_BOX_RATIO": 12.5,
                    "SPEAKER_THRESHOLD": 1999, "OSC_IP_ADDRESS": "10.0.0.5"},
    "numbers_at_bounds": {"MIC_AVG_LOGPROB": -2, "MIC_NO_SPEECH_PROB": 1, "SPEAKER_AVG_LOGPROB": 0.5,
                          "MIC_MAX_PHRASES": 30, "SPEAKER_MAX_PHRASES": 61, "OCR_MIN_CONFIDENCE": 0.99,
                          "OCR_POLL_INTERVAL_MS": 99, "OCR_BUBBLE_MIN_TEXT_LENGTH": 50, "TELEMETRY_NOTICE": 1},
    "asr_timeouts_saved_order": {"MIC_RECORD_TIMEOUT": 5, "MIC_PHRASE_TIMEOUT": 8, "SPEAKER_RECORD_TIMEOUT": 9,
                                 "SPEAKER_PHRASE_TIMEOUT": 4},
    "overlay_settings_partial": {"OVERLAY_SMALL_LOG_SETTINGS": {"x_pos": 1.0},
                                 "OVERLAY_LARGE_LOG_SETTINGS": {"x_pos": 1, "y_pos": 2.5, "z_pos": 0, "x_rotation": 0,
                                                                "y_rotation": 0, "z_rotation": 0, "display_duration": 7,
                                                                "fadeout_duration": 1.5, "opacity": 1, "ui_scaling": 2,
                                                                "tracker": "Elbow"},
                                 "OVERLAY_DESKTOP_SETTINGS": {"position": "top", "font_size": 100, "display_duration": 10,
                                                              "opacity": 0.3},
                                 "OVERLAY_DESKTOP_PLACEMENT": {"x": -1700, "y": 640},
                                 "IO_FLOW_OVERLAY_SETTINGS": {"desktop": True, "count": 4},
                                 "OVERLAY_VR_PANEL_SETTINGS": {"width": 1000, "tracker": "Playspace", "x_pos": 1},
                                 "OVERLAY_VR_LAUNCHER_SETTINGS": {"tracker": "RightHand", "unknown": 1}},
    "languages_damaged": {
        "SELECTED_TAB_NO": "2",
        "SELECTED_TRANSLATION_ENGINES": {"1": "DeepL_API", "2": "NoSuchEngine", "4": "CTranslate2"},
        "SELECTED_YOUR_LANGUAGES": {"1": {"1": {"language": "English", "country": "United States", "enable": True}},
                                    "2": {"1": {"language": "Klingon", "country": "Qo'noS", "enable": True}},
                                    "3": "broken"},
        "SELECTED_TARGET_LANGUAGES": {"1": {"1": {"language": "French", "country": "France", "enable": True},
                                            "2": {"language": "German", "country": "Germany", "enable": "yes"}}},
    },
    "compute_type_before_device": {"SELECTED_TRANSLATION_COMPUTE_TYPE": "int8",
                                   "SELECTED_TRANSLATION_COMPUTE_DEVICE": {"device": "cpu", "device_index": 0, "device_name": "cpu",
                                                                           "compute_types": ["auto"]}},
    "compute_device_unknown": {"SELECTED_TRANSLATION_COMPUTE_DEVICE": {"device": "cuda", "device_index": 0, "device_name": "RTX"},
                               "SELECTED_TRANSLATION_COMPUTE_TYPE": "float16"},
    "websocket_and_obs": {"WEBSOCKET_HOST": "0.0.0.0", "WEBSOCKET_PORT": 70000, "WEBSOCKET_AUTH_TOKEN": "  ",
                          "OBS_BROWSER_SOURCE_PORT": 8080, "OBS_BROWSER_SOURCE_FONT_SIZE": 0,
                          "OBS_BROWSER_SOURCE_MAX_MESSAGES": 30, "OBS_BROWSER_SOURCE_FONT_COLOR": "red"},
    "websocket_token_kept": {"WEBSOCKET_AUTH_TOKEN": "a-token-saved-by-an-older-version", "WEBSOCKET_HOST": "192.168.1.2"},
    "auth_keys": {"AUTH_KEYS": {"DeepL_API": "abc:fx", "Gemini_API": 5, "Removed_API": "x"},
                  "TRANSCRIPTION_AUTH_KEYS": {"Deepgram": "dg"}, "SELECTED_GEMINI_MODEL": "gemini-x",
                  "SELECTED_DEEPGRAM_MODEL": None},
    "ctranslate2_weights": {"CTRANSLATE2_WEIGHT_TYPE": "nllb-200-distilled-600M-ct2-int8", "CTRANSLATE2_LICENSE_NOTICE_SHOWN": False},
    "ctranslate2_unknown_weight": {"CTRANSLATE2_WEIGHT_TYPE": "large"},
    "message_formats": {"SEND_MESSAGE_FORMAT_PARTS": {"message": {"prefix": "[", "suffix": "]"}, "separator": " ",
                                                      "translation": {"prefix": "(", "separator": "/", "suffix": ")"},
                                                      "translation_first": True},
                        "RECEIVED_MESSAGE_FORMAT_PARTS": {"message": {"prefix": "["}, "separator": " "}},
    "word_filter": {"MIC_WORD_FILTER": ["a", "b", "a", 3, None, "c"]},
    "ocr_regions": {"OCR_CAPTURE_REGION": {"x": 0.1, "y": 0.2, "width": 0.5, "height": 0.5},
                    "OCR_SOURCE_LANGUAGE": "ja", "OCR_WINDOW_TITLE": "", "OCR_PORTAL_RESTORE_TOKEN": "abc\u0001"},
    "ocr_region_out_of_window": {"OCR_CAPTURE_REGION": {"x": 0.9, "y": 0.0, "width": 0.5, "height": 0.5},
                                 "OCR_VR_CAPTURE_REGION": {"x": 0.0, "y": 0.0, "width": 0.01, "height": 0.5}},
    "voice_settings_old": {"VOICE_SETTINGS": {"mode": "original"}, "DIRECT_VOICE_SETTINGS": {"mode": "passthrough"},
                           "SPEECH_SERVER_SETTINGS": {"version": 1}, "REALTIME_ASR_SETTINGS": {"version": 1}},
    "voice_settings_invalid": {"VOICE_SETTINGS": {"mode": "shout"}, "DIRECT_VOICE_SETTINGS": {"mode": "x"},
                               "SPEECH_SERVER_SETTINGS": {"version": 2}, "REALTIME_ASR_SETTINGS": {"server": "cloud"}},
    "realtime_settings_full": {"REALTIME_ASR_SETTINGS": {
        "version": 1, "server": "external", "start_server": False, "base_url": "http://localhost:8080",
        "model": "qwen3-asr", "vocabulary": {"builtin": False, "terms": ["VRChat=ぶいあーるちゃっと", "vrchat", " Avatar  Name "]},
        "mic": {"language": "en", "endpoint": None, "follow_default": False},
        "speaker": {"language": "auto"}}},
    "rvc_settings": {"DIRECT_VOICE_SETTINGS": {"mode": "converted", "engine": "rvc", "rvc_model": "a.pth",
                                               "rvc_pitch": 3, "rvc_index_rate": 0.5}},
    "telemetry_old": {"ENABLE_TELEMETRY": False},
    "release_channel": {"SELECTED_RELEASE_CHANNEL": "stable"},
    "legacy_consents": {"LEGACY_MODEL_DOWNLOAD_CONSENTS": {"ctranslate2:m2m100_418M-ct2-int8": "sha"},
                        "AUTO_DOWNLOAD_MODELS": True},
    "legacy_consents_bad": {"LEGACY_MODEL_DOWNLOAD_CONSENTS": {"a": 1}},
    "devices_saved": {"SELECTED_MIC_HOST": "Windows WASAPI", "SELECTED_MIC_DEVICE": "Mic (USB)",
                      "SELECTED_SPEAKER_DEVICE": "Speakers", "SELECTED_MIC_DEVICE_ID": "{0.0.1}",
                      "SELECTED_SPEAKER_DEVICE_ID": 5, "AUTO_MIC_SELECT": False},
    "main_window_geometry": {"MAIN_WINDOW_GEOMETRY": {"x_pos": 10, "y_pos": "20", "width": 900, "height": 700.0}},
    "main_window_geometry_bad": {"MAIN_WINDOW_GEOMETRY": {"x_pos": 10}},
    "selected_models": {"SELECTED_PLAMO_MODEL": "plamo-2.0-prime", "SELECTED_OPENAI_MODEL": 3,
                        "SELECTED_TRANSCRIPTION_ENGINE": None},
    "unicode_values": {"FONT_FAMILY": "游ゴシック 😀", "OCR_WINDOW_TITLE": "VRChat é"},
}

# The full file a fresh start writes, read again: nothing may change.
ROUND_TRIP = "round_trip_of_no_file"


def _child(case_dir, platform):
    """In the child process: start the Python Config on case_dir and print what it did."""
    sys.path.insert(0, str(ROOT / "src-python"))
    import types

    fake_devices = types.ModuleType("device_manager")

    class _Devices:
        def getDefaultMicDevice(self):
            return {"host": {"name": "NoHost"}, "device": {"name": "NoDevice"}}

        def getDefaultSpeakerDevice(self):
            return {"device": {"name": "NoDevice"}}

        def getMicDevices(self):
            return {"NoHost": [{"name": "NoDevice"}]}

        def getSpeakerDevices(self):
            return [{"name": "NoDevice"}]

    fake_devices.device_manager = _Devices()
    sys.modules["device_manager"] = fake_devices
    import utils
    utils.getComputeDeviceList = lambda: [dict(CPU_DEVICE, compute_types=list(CPU_DEVICE["compute_types"]))]
    import secrets
    secrets.token_urlsafe = lambda n=None: TOKEN
    scratch = tempfile.mkdtemp()
    os.environ["VRCT_CONFIG_DIR"] = scratch
    import config as config_module

    sys.platform = platform
    os.environ["VRCT_CONFIG_DIR"] = case_dir
    config_module.Config._instance = None
    instance = config_module.Config()
    path = Path(case_dir) / "config.json"
    saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    backups = sorted(name.split(".unreadable-")[0] for name in os.listdir(case_dir) if ".unreadable-" in name)
    print(json.dumps({
        "saved": saved,
        "unreadable_backup": backups,
        "invalid_saved_api_urls": list(getattr(instance, "INVALID_SAVED_API_URLS", [])),
        "local_asr_notice_pending": instance.LOCAL_ASR_NOTICE_PENDING,
        "selectable_transcription_engines": list(instance.SELECTABLE_TRANSCRIPTION_ENGINE_LIST),
        "selectable_translation_engines": list(instance.SELECTABLE_TRANSLATION_ENGINE_LIST),
        "selectable_ocr_source_languages": list(instance.SELECTABLE_OCR_SOURCE_LANGUAGE_LIST),
        "selectable_ctranslate2_weight_types": list(instance.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_LIST),
    }, ensure_ascii=False))


def _languages():
    sys.path.insert(0, str(ROOT / "src-python"))
    from models.translation.translation_languages import loadTranslationLanguages
    from models.transcription.transcription_languages import transcription_lang
    translation = loadTranslationLanguages(str(ROOT / "src-python"), force=True)
    return translation, transcription_lang


def _run_case(name, saved, platform):
    with tempfile.TemporaryDirectory() as case_dir:
        path = Path(case_dir) / "config.json"
        if isinstance(saved, dict) and "raw" in saved:
            path.write_text(saved["raw"], encoding="utf-8")
        elif isinstance(saved, dict) and "raw_bytes" in saved:
            path.write_bytes(bytes.fromhex(saved["raw_bytes"]))
        elif saved is not None:
            path.write_text(json.dumps(saved, ensure_ascii=False, indent=4), encoding="utf-8")
        result = subprocess.run([sys.executable, "-I", __file__, "--child", case_dir, platform],
                                capture_output=True, text=True, encoding="utf-8", timeout=120)
        if result.returncode != 0:
            raise SystemExit(f"{name} ({platform}) failed:\n{result.stderr}")
        return json.loads(result.stdout.strip().splitlines()[-1])


LISTS = ("selectable_transcription_engines", "selectable_translation_engines",
         "selectable_ocr_source_languages", "selectable_ctranslate2_weight_types")


def _changes(saved, defaults):
    """The keys whose saved value differs from a fresh start's, in the saved file's order."""
    return {key: value for key, value in saved.items() if key not in defaults or defaults[key] != value}


def reference():
    platforms = {}
    for platform in ("win32", "linux"):
        fresh = _run_case("no_file", None, platform)
        defaults = fresh["saved"]
        results = {}
        for name, saved in [*CASES.items(), (ROUND_TRIP, defaults)]:
            result = fresh if name == "no_file" else _run_case(name, saved, platform)
            assert all(result[key] == fresh[key] for key in LISTS), name
            results[name] = {
                "changed": _changes(result["saved"], defaults),
                "missing": [key for key in defaults if key not in result["saved"]],
                "order_kept": list(result["saved"]) == list(defaults),
                "unreadable_backup": result["unreadable_backup"],
                "invalid_saved_api_urls": result["invalid_saved_api_urls"],
                "local_asr_notice_pending": result["local_asr_notice_pending"],
            }
        platforms[platform] = {"defaults": defaults, "lists": {key: fresh[key] for key in LISTS}, "cases": results}
    inputs = dict(CASES)
    inputs[ROUND_TRIP] = "the file no_file saved"
    return {"version": VERSION, "websocket_token": TOKEN, "cpu_device": CPU_DEVICE, "inputs": inputs,
            "platforms": platforms}


def _dump(value):
    return json.dumps(value, ensure_ascii=False, indent=1) + "\n"


def render():
    translation, transcription = _languages()
    return {OUTPUT: _dump(reference()), TRANSLATION_LANGUAGES: _dump(translation),
            TRANSCRIPTION_LANGUAGES: _dump(transcription)}


def main(argv):
    if argv[1:2] == ["--child"]:
        sys.stdout.reconfigure(encoding="utf-8")
        _child(argv[2], argv[3])
        return 0
    files = render()
    if argv[1:] == ["--check"]:
        stale = [path for path, text in files.items()
                 if not path.exists() or path.read_text(encoding="utf-8") != text]
        for path in stale:
            print(f"{path} is out of date: run python native/core/reference/dump_reference.py", file=sys.stderr)
        return 1 if stale else 0
    if argv[1:]:
        print(__doc__, file=sys.stderr)
        return 2
    for path, text in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
