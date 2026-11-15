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


def speech_model(id):
    """What speech.cpp's catalog says of an entry (its name, type, languages), or None."""
    row = _SPEECH.get(id)
    return None if row is None else dict(row, languages=list(row['languages']), start=list(row['start']))
