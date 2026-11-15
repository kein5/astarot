"""What a person choosing a model compares: plain words, languages, hardware, the default pick.

The data is the JSON text of DATA below. native/ops reads it from this file as well, so both
answer the same, and it is code, so the packaged backend has it. The catalog row already has the
rest: the model's name (`name`), provider, license, download size (`total_bytes`) and the
memory example (`guidance`). The UI words live in locales/ under `model_catalog`:

- title, summary: keys of `model_catalog.title.*` and `model_catalog.summary.*`. A title is
  shared by the files of one model; `variant` tells them apart (`model_catalog.variant.*`).
- languages: BCP 47 tags the model reads, speaks or recognizes. A script alone is `und-<Script>`
  (`und-Latn`); `*` means it does not depend on the language.
- device: `gpu` (practical only on a GPU), `gpu_preferred` (runs on the CPU, later) or `cpu`.
- recommended: the model a first-time user should take for its use. At most one per target,
  except chat reading, whose recognizer and detector are both needed. The memory advice of
  the TTS page may still suggest the compact file of the same model.

Basis for `device` (docs/voice-stack/model-downloads.md, "選ぶための情報"): TTS measured on an
i7-1255U CPU on 2026-11-16; ASR, diarization and RVC from the Windows reports.
"""
from copy import deepcopy
import json

DATA = r'''
{
 "version": 1,
 "models": {
  "irodori-v41-f16": {"title": "irodori_mf", "summary": "irodori_mf", "variant": "standard", "languages": ["ja"], "device": "gpu", "recommended": true},
  "irodori-v41-q8": {"title": "irodori_mf", "summary": "irodori_mf", "variant": "compact", "languages": ["ja"], "device": "gpu", "recommended": false},
  "irodori-v41-small-f16": {"title": "irodori_small", "summary": "irodori_small", "variant": "standard", "languages": ["ja"], "device": "gpu", "recommended": false},
  "irodori-v4-large-q8": {"title": "irodori_large", "summary": "irodori_large", "variant": "standard", "languages": ["ja"], "device": "gpu", "recommended": false},
  "qwen3-06b-q8": {"title": "qwen3_tts_06b", "summary": "qwen3_tts_06b", "variant": "standard", "languages": ["de", "en", "es", "fr", "it", "ja", "ko", "pt", "ru", "zh"], "device": "gpu", "recommended": true},
  "qwen3-06b-q5": {"title": "qwen3_tts_06b", "summary": "qwen3_tts_06b", "variant": "compact", "languages": ["de", "en", "es", "fr", "it", "ja", "ko", "pt", "ru", "zh"], "device": "gpu", "recommended": false},
  "qwen3-17b-q8": {"title": "qwen3_tts_17b", "summary": "qwen3_tts_17b", "variant": "standard", "languages": ["de", "en", "es", "fr", "it", "ja", "ko", "pt", "ru", "zh"], "device": "gpu", "recommended": false},
  "rvc-saisho": {"title": "rvc_saisho", "summary": "rvc_saisho", "variant": "standard", "languages": ["*"], "device": "gpu_preferred", "recommended": true},
  "haas-ja-q8": {"title": "haas_ja", "summary": "haas_ja", "variant": "standard", "languages": ["ja"], "device": "gpu_preferred", "recommended": true},
  "qwen3-asr-06b-q8": {"title": "qwen3_asr_06b", "summary": "qwen3_asr_06b", "variant": "standard", "languages": ["ar", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fil", "fr", "hi", "hu", "id", "it", "ja", "ko", "mk", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "vi", "yue", "zh"], "device": "gpu_preferred", "recommended": false},
  "silero-vad-v62": {"title": "silero_vad", "summary": "silero_vad", "variant": "standard", "languages": ["*"], "device": "cpu", "recommended": true},
  "nemotron-3-diarization-q8": {"title": "nemotron_diarization", "summary": "nemotron_diarization", "variant": "standard", "languages": ["*"], "device": "gpu", "recommended": false},
  "ppocrv6-small": {"title": "ppocr_v6_small", "summary": "ppocr_v6_small", "variant": "standard", "languages": ["ja", "en", "zh", "und-Latn"], "device": "cpu", "recommended": true},
  "ppocrv5-korean": {"title": "ppocr_v5_korean", "summary": "ppocr_v5_script", "variant": "standard", "languages": ["ko"], "device": "cpu", "recommended": false},
  "ppocrv5-cyrillic": {"title": "ppocr_v5_cyrillic", "summary": "ppocr_v5_script", "variant": "standard", "languages": ["und-Cyrl"], "device": "cpu", "recommended": false},
  "ppocrv5-thai": {"title": "ppocr_v5_thai", "summary": "ppocr_v5_script", "variant": "standard", "languages": ["th"], "device": "cpu", "recommended": false},
  "ppocrv5-arabic": {"title": "ppocr_v5_arabic", "summary": "ppocr_v5_script", "variant": "standard", "languages": ["und-Arab"], "device": "cpu", "recommended": false},
  "ppocrv5-devanagari": {"title": "ppocr_v5_devanagari", "summary": "ppocr_v5_script", "variant": "standard", "languages": ["und-Deva"], "device": "cpu", "recommended": false},
  "vrct-vox-chatbox-detector": {"title": "chatbox_detector", "summary": "chatbox_detector", "variant": "standard", "languages": ["*"], "device": "cpu", "recommended": true}
 }
}
'''
INFO = json.loads(DATA)
DEVICES = ('gpu', 'gpu_preferred', 'cpu')
VARIANTS = ('standard', 'compact')


def model_info(id):
    """The entry for a catalog id, or None for one nobody described yet."""
    return deepcopy(INFO['models'].get(id))
