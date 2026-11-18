"""Recognition models offered from speech.cpp's own catalog (speechcpp_models.SNAPSHOT).

speech.cpp's catalog is the source of the repository, revision, languages and every quantized
file with its size and SHA-256: each file of an offered name becomes one catalog entry, the file
speech.cpp fetches for the bare name first. OFFERS adds only what speech.cpp does not say: which
names VRCT-VOX offers, and the license review of each (docs/voice-stack/licensing.md,
licenses/speechcpp-models/NOTICE.md). The data (OFFERS, PROFILES, TIERS, ID_PREFIXES) is
native/ops/data/speechcpp_asr.json, which native/ops compiles in; its fields are described in
native/ops/data/README.md.
"""
import json
from pathlib import Path
import re

from .speechcpp_models import SNAPSHOT

_DATA = json.loads((Path(__file__).resolve().parents[3] / 'native' / 'ops' / 'data' / 'speechcpp_asr.json')
                   .read_text(encoding='utf-8'))
OFFERS = _DATA['offers']
# What a user compares before choosing (catalog row "profile"), by speech.cpp name.
PROFILES = _DATA['profiles']
# Sizes of the profile's "tier", from the measured peak memory (bytes).
TIERS = _DATA['tiers']
# The id prefix of a name whose entry existed before this table ("haas-ja-q8").
ID_PREFIXES = _DATA['id_prefixes']


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
