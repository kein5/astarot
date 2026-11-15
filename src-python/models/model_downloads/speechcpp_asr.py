"""Recognition models offered from speech.cpp's own catalog (speechcpp_models.SNAPSHOT).

speech.cpp's catalog is the source of the repository, revision, languages and every quantized
file with its size and SHA-256: each file of an offered name becomes one catalog entry, the file
speech.cpp fetches for the bare name first. OFFERS adds only what speech.cpp does not say: which
names VRCT-VOX offers, and the license review of each (docs/voice-stack/licensing.md,
licenses/speechcpp-models/NOTICE.md). A license link is a path in the pinned repository or a
fixed URL. Keep OFFERS JSON as well as Python: native/ops reads the same text.
"""
import re

from .speechcpp_models import SNAPSHOT

OFFERS = [
 {"name": "qwen3-asr-0.6b", "label": "Qwen3-ASR 0.6B", "provider": "Qwen / sakasegawa", "license": "Apache-2.0",
  "licenses": ["README.md", "https://www.apache.org/licenses/LICENSE-2.0"], "notice": "qwen_asr"},
 {"name": "qwen3-asr-1.7b", "label": "Qwen3-ASR 1.7B", "provider": "Qwen / sakasegawa", "license": "Apache-2.0",
  "licenses": ["README.md", "https://www.apache.org/licenses/LICENSE-2.0"], "notice": "qwen_asr"},
 {"name": "reazonspeech-v2", "label": "ReazonSpeech v2", "provider": "Reazon Research / sakasegawa",
  "license": "Apache-2.0", "licenses": ["README.md", "https://www.apache.org/licenses/LICENSE-2.0"],
  "notice": "reazonspeech"},
 {"name": "parakeet-tdt_ctc-0.6b-ja", "label": "Parakeet TDT-CTC 0.6B ja", "provider": "NVIDIA / sakasegawa",
  "license": "CC BY 4.0", "licenses": ["README.md", "https://creativecommons.org/licenses/by/4.0/"],
  "notice": "parakeet_ja"},
 {"name": "parakeet-tdt-0.6b-v3", "label": "Parakeet TDT 0.6B v3", "provider": "NVIDIA / sakasegawa",
  "license": "CC BY 4.0", "licenses": ["README.md", "https://creativecommons.org/licenses/by/4.0/"],
  "notice": "parakeet_v3"},
 {"name": "haas-ja-v1.0", "label": "Haas-ja v1.0", "provider": "Third Intelligence / sakasegawa",
  "license": "Apache-2.0", "licenses": ["README.md", "LICENSE"], "notice": "haas"},
 {"name": "nemotron-3.5-transcribe", "label": "Nemotron 3.5 Transcribe 30B-A4B", "provider": "NVIDIA / sakasegawa",
  "license": "OpenMDW-1.1", "licenses": ["README.md", "LICENSE"], "notice": "nemotron_asr"}
]

# What a user compares before choosing (catalog row "profile"). Not in speech.cpp's catalog:
# - summary: the key of a short plain description, model_downloads.summary.<key> in locales/.
# - memory: peak memory per file type, as the model card at the pinned revision measured it
#   (README.md, "Memory"), on memory_measured_on. GB there are decimal, GiB binary.
# - cpu: "slow" when VRCT-VOX measured it on a CPU and it runs, seconds behind (see
#   docs/voice-stack/model-downloads.md, 2026-11-16), "practical" when speech.cpp itself runs it
#   on the CPU, "impractical" when it was measured on a CPU and the voice breaks up or starts
#   many seconds late (the speech models, i7-1255U, 2026-11-16), "unverified" otherwise.
#   gpu: "recommended" or "not_needed".
# Keys are speech.cpp names; the VAD and diarization entries are pinned in catalog.py by id.
# The speech (TTS) entries are pinned in catalog.py too, several files of a name each under its
# own id: "ids" maps the file type to that id. Their "recommended_for" replaces speech.cpp's
# start languages, since VRCT-VOX reads Japanese with Irodori and other languages with Qwen3-TTS
# (the japanese and multilingual profiles); like start, it is on the file speech.cpp fetches.
PROFILES = {
 "qwen3-asr-0.6b": {"summary": "qwen3_asr_06b", "memory_measured_on": "Apple M5 (Metal)", "cpu": "slow",
  "gpu": "recommended", "memory": {"q8_0": 1000000000, "q6_k": 840000000, "q5_k": 750000000, "q4_k": 670000000}},
 "qwen3-asr-1.7b": {"summary": "qwen3_asr_17b", "memory_measured_on": "Apple M5 (Metal)", "cpu": "unverified",
  "gpu": "recommended", "memory": {"q8_0": 2340000000, "q6_k": 1850000000, "q5_k": 1580000000, "q4_k": 1320000000}},
 "reazonspeech-v2": {"summary": "reazonspeech", "memory_measured_on": "Apple M5 (Metal)", "cpu": "unverified",
  "gpu": "recommended", "memory": {"f16": 1380000000, "q8_0": 790000000, "q6_k": 640000000, "q5_k": 560000000,
                                   "q4_k": 480000000}},
 "parakeet-tdt_ctc-0.6b-ja": {"summary": "parakeet_ja", "memory_measured_on": "Apple M5 (Metal)", "cpu": "unverified",
  "gpu": "recommended", "memory": {"f16": 1350000000, "q8_0": 770000000, "q6_k": 620000000, "q5_k": 530000000,
                                   "q4_k": 460000000}},
 "parakeet-tdt-0.6b-v3": {"summary": "parakeet_v3", "memory_measured_on": "Apple M5 (Metal)", "cpu": "unverified",
  "gpu": "recommended", "memory": {"f16": 1370000000, "q8_0": 780000000, "q6_k": 630000000, "q5_k": 540000000,
                                   "q4_k": 470000000}},
 "haas-ja-v1.0": {"summary": "haas", "memory_measured_on": "Apple M5 (Metal)", "cpu": "unverified",
  "gpu": "recommended", "memory": {"f16": 1385126953, "q8_0": 794568950, "q6_k": 654982513, "q5_k": 569083167,
                                   "q4_k": 493921239}},
 "nemotron-3.5-transcribe": {"summary": "nemotron_asr", "memory_measured_on": "NVIDIA H100 (Vulkan)", "cpu": "unverified",
  "gpu": "recommended", "memory": {"iq4_nl": 19756849562, "q8_0": 35862976922, "f16": 66142496358}},
 "silero-vad": {"summary": "silero_vad", "id": "silero-vad-v62", "cpu": "practical", "gpu": "not_needed"},
 "nemotron-3-diarization": {"summary": "nemotron_diarization", "id": "nemotron-3-diarization-q8", "cpu": "unverified",
  "gpu": "recommended"},
 "irodori-tts-mf": {"summary": "irodori_mf", "ids": {"f16": "irodori-v41-f16", "q8_0": "irodori-v41-q8"},
  "recommended_for": ["ja"], "memory_measured_on": "Apple M5 (Metal)", "cpu": "impractical", "gpu": "recommended",
  "memory": {"f16": 2040000000, "q8_0": 1330000000}},
 "irodori-tts": {"summary": "irodori_small", "ids": {"f16": "irodori-v41-small-f16"}, "recommended_for": [],
  "memory_measured_on": "Apple M5 (Metal)", "cpu": "impractical", "gpu": "recommended", "memory": {"f16": 2030000000}},
 "irodori-tts-large": {"summary": "irodori_large", "ids": {"q8_0": "irodori-v4-large-q8"}, "recommended_for": [],
  "memory_measured_on": "Apple M5 (Metal)", "cpu": "impractical", "gpu": "recommended", "memory": {"q8_0": 4123168604}},
 "qwen3-tts-0.6b": {"summary": "qwen3_tts_06b", "ids": {"q8_0": "qwen3-06b-q8", "q5_k": "qwen3-06b-q5"},
  "recommended_for": ["de", "en", "es", "fr", "it", "ko", "pt", "ru", "zh"], "memory_measured_on": "Apple M5 (Metal)",
  "cpu": "impractical", "gpu": "recommended", "memory": {"q8_0": 1370000000, "q5_k": 1030000000}},
 "qwen3-tts-1.7b": {"summary": "qwen3_tts_17b", "ids": {"q8_0": "qwen3-17b-q8"}, "recommended_for": [],
  "memory_measured_on": "Apple M5 (Metal)", "cpu": "impractical", "gpu": "recommended", "memory": {"q8_0": 2440000000}}
}
# Sizes of the profile's "tier", from the measured peak memory (bytes): light up to 1.5 GiB,
# medium up to 4 GiB, heavy above.
TIERS = [["light", 1610612736], ["medium", 4294967296]]

# The id prefix of a name whose entry existed before this table ("haas-ja-q8"), so a download
# made then is found again in <root>/<id>/<revision>/. Other names derive it (qwen3-asr-06b).
ID_PREFIXES = {"haas-ja-v1.0": "haas-ja"}


def _slug(text):
    return re.sub('[^a-z0-9]+', '-', text.lower().replace('.', '')).strip('-')


def type_slug(kind):
    """q8_0 -> q8, q5_k -> q5, f16 -> f16, iq4_nl -> iq4nl."""
    return kind[:2] if re.fullmatch(r'q[0-9]_[0k]', kind) else re.sub('[^a-z0-9]', '', kind)


def entry_id(name, kind):
    return f'{ID_PREFIXES.get(name) or _slug(name)}-{type_slug(kind)}'


def _models():
    by_name = {model['name']: model for model in SNAPSHOT['models']}
    for offer in OFFERS:
        model = by_name.get(offer['name'])
        if model is None or model['task'] != 'recognition':
            raise ValueError('catalog_invalid')
        yield offer, model


def _license_url(model, link):
    return link if link.startswith('https://') else \
        f"https://huggingface.co/{model['repository']}/blob/{model['revision']}/{link}"


def entries():
    """One reviewed entry per file: dicts with the fields of catalog.Model, the file as `artifact`."""
    rows = []
    for offer, model in _models():
        for file in sorted(model['files'], key=lambda file: file['type'] != model['type']):
            rows.append(dict(
                id=entry_id(model['name'], file['type']), target='asr',
                name=f"{offer['label']} · {file['type'].upper()}", provider=offer['provider'],
                repo=model['repository'], revision=model['revision'], license=offer['license'],
                licenses=tuple(_license_url(model, link) for link in offer['licenses']), notice=offer['notice'],
                artifact=dict(filename=file['file'], size=file['size'], sha256=file['sha256'], role='model')))
    return rows


def _speech_rows():
    rows = {}
    for offer, model in _models():
        for file in model['files']:
            rows[entry_id(model['name'], file['type'])] = dict(
                name=model['name'], label=offer['label'], type=file['type'], default=file['type'] == model['type'],
                languages=list(model['languages']), start=list(model['start']), version=SNAPSHOT['version'])
    return rows


_SPEECH = _speech_rows()


def _tier(memory):
    if memory is None:
        return None
    return next((name for name, limit in TIERS if memory <= limit), 'heavy')


def _profile_rows():
    by_name = {model['name']: model for model in SNAPSHOT['models']}
    rows = {}
    for name, profile in PROFILES.items():
        model = by_name.get(name)
        if model is None:
            raise ValueError('catalog_invalid')
        ids = profile.get('ids')
        files = [file for file in model['files'] if (file['type'] in ids if ids is not None else
                                                     profile.get('id') is None or file['type'] == model['type'])]
        if ids is not None and len(files) != len(ids):
            raise ValueError('catalog_invalid')
        start = profile.get('recommended_for', model['start'])
        for file in files:
            id = ids[file['type']] if ids is not None else profile.get('id') or entry_id(name, file['type'])
            memory = profile.get('memory', {}).get(file['type'])
            rows[id] = dict(
                summary=profile['summary'], languages=list(model['languages']),
                # The languages this model is suggested for first, on the file speech.cpp fetches.
                recommended_for=list(start) if file['type'] == model['type'] else [],
                memory_bytes=memory, memory_measured_on=profile.get('memory_measured_on') if memory else None,
                tier=_tier(memory), cpu=profile['cpu'], gpu=profile['gpu'])
    return rows


_PROFILES = _profile_rows()


def model_profile(id):
    """What a user compares before choosing an entry, or None for entries outside speech.cpp."""
    row = _PROFILES.get(id)
    return None if row is None else dict(row, languages=list(row['languages']),
                                         recommended_for=list(row['recommended_for']))


def speech_model(id):
    """What speech.cpp's catalog says of an entry (its name, type, languages), or None."""
    row = _SPEECH.get(id)
    return None if row is None else dict(row, languages=list(row['languages']), start=list(row['start']))
