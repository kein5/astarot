"""Copy speech.cpp's own model catalog into the app; never fetch a model.

    python tools/speechcpp_models.py --speech <speech executable>   # rewrite the snapshot
    python tools/speechcpp_models.py --json <saved output>          # the same from `speech models --json`
    python tools/speechcpp_models.py --check                        # fail if the snapshot is not this file's render

The download catalog offers speech.cpp's models at the revisions, sizes and SHA-256 that
speech.cpp's own catalog pins (`speech models --json`). This tool writes them, as speech.cpp
answers them, to src-python/models/model_downloads/speechcpp_models.py, so the app holds no
second, hand-typed copy. Run it with the speech.cpp release the app bundles
(tools/speechcpp_bundle.py VERSION); it refuses any other. The executable is started with an
empty, temporary model folder, so it reads no model and fetches nothing.

Only what does not depend on the PC is kept: each file's URL is the pinned Hugging Face URL the
download catalog derives itself, and the local path and "fetched" are dropped.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'src-python/models/model_downloads/speechcpp_models.py'
MANIFEST = ROOT / 'docs/voice-stack/speechcpp-bundle-artifacts.json'
HEADER = '''"""speech.cpp's model catalog (`speech models --json`), as tools/speechcpp_models.py wrote it.

Generated: do not edit. Run the tool again with the bundled speech.cpp release instead.
The value is JSON as well as Python, so native/ops reads the same text.
"""
SNAPSHOT = '''


def _require(condition, what):
    if not condition:
        raise ValueError(f'speechcpp_models_{what}')


def _hex(value, length):
    return isinstance(value, str) and re.fullmatch(f'[0-9a-f]{{{length}}}', value) is not None


def _words(value):
    return isinstance(value, list) and all(isinstance(item, str) and re.fullmatch('[a-z]{2,3}', item) for item in value)


def normalize(data, version):
    """The PC-independent part of `speech models --json`, refused unless it is well formed."""
    _require(isinstance(data, dict) and data.get('version') == version, 'version')
    models = []
    for model in data.get('models') or ():
        name, files = model.get('name'), model.get('files')
        _require(isinstance(name, str) and re.fullmatch(r'[a-z0-9][a-z0-9_.-]*', name), 'name')
        _require(isinstance(model.get('repository'), str)
                 and re.fullmatch(r'[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+', model['repository']), 'repository')
        _require(_hex(model.get('revision'), 40), 'revision')
        _require(isinstance(model.get('task'), str) and _words(model.get('languages'))
                 and _words(model.get('start')), 'languages')
        _require(isinstance(files, list) and files, 'files')
        rows = []
        for item in files:
            _require(isinstance(item.get('type'), str) and re.fullmatch('[a-z0-9_]+', item['type'])
                     and isinstance(item.get('file'), str)
                     and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', item['file']) and '..' not in item['file']
                     and type(item.get('size')) is int and item['size'] > 0 and _hex(item.get('sha256'), 64), 'file')
            rows.append({'type': item['type'], 'file': item['file'], 'size': item['size'], 'sha256': item['sha256']})
        _require(model.get('type') in [row['type'] for row in rows], 'type')
        models.append({'name': name, 'repository': model['repository'], 'revision': model['revision'],
                       'task': model['task'], 'languages': model['languages'], 'start': model['start'],
                       'type': model['type'], 'files': rows})
    _require(models and len({m['name'] for m in models}) == len(models), 'models')
    return {'version': version, 'models': models}


def render(snapshot):
    # No true, false or null anywhere, so the literal reads the same as Python and as JSON.
    text = json.dumps(snapshot, ensure_ascii=True, indent=1)
    _require(not re.search(r'\b(true|false|null)\b', text), 'literal')
    return HEADER + text + '\n'


def bundled_version():
    return json.loads(MANIFEST.read_text(encoding='utf-8'))['version']


def from_speech(executable):
    with tempfile.TemporaryDirectory() as empty:
        environment = dict(os.environ, SPEECH_MODEL_DIR=empty)
        output = subprocess.run([str(executable), 'models', '--json'], env=environment, check=True,
                                capture_output=True, timeout=30).stdout
    return json.loads(output)


def current():
    namespace = {}
    exec(compile(OUTPUT.read_text(encoding='utf-8'), str(OUTPUT), 'exec'), namespace)
    return namespace['SNAPSHOT']


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--speech', type=Path, help='the speech executable of the bundled release')
    source.add_argument('--json', type=Path, help='a saved `speech models --json` output')
    source.add_argument('--check', action='store_true', help='fail if the snapshot file is not rendered by this tool')
    args = parser.parse_args(argv)
    version = bundled_version()
    if args.check:
        snapshot = current()
        if OUTPUT.read_text(encoding='utf-8') != render(normalize(snapshot, version)):
            print(f'{OUTPUT} is not what tools/speechcpp_models.py writes for speech.cpp {version}', file=sys.stderr)
            return 1
        return 0
    data = from_speech(args.speech) if args.speech else json.loads(args.json.read_text(encoding='utf-8'))
    OUTPUT.write_text(render(normalize(data, version)), encoding='utf-8', newline='\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
