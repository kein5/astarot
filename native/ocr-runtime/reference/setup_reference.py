#!/usr/bin/env python3
"""Prepare the reference environment the conformance tests compare against.

Everything lands outside the repository (default: ~/.cache/vrct-vox/ocr-reference,
override with OCR_REFERENCE_DIR). Nothing here is shipped with the application.

  downloaded_models/  the OCR catalog entries, in the layout the application uses
                      (<id>/<revision>/<file>), fetched at the catalog's pinned
                      revision and checked against its size and SHA-256
  venv/               the application's Python (requires-python in pyproject.toml,
                      the version mise.toml pins) with its own pins of RapidOCR,
                      ONNX Runtime and OpenCV, installed with the hashes in uv.lock

The models are the same consented downloads the application offers (Apache-2.0
PaddleOCR exports; the chatbox detector is VRCT-VOX's own, MIT). Running this
script is the consent for this local copy. Standard library only; needs `uv`.
"""
import argparse
import hashlib
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = REPO_ROOT / 'src-python' / 'models' / 'model_downloads' / 'catalog.py'
# What the reference pipeline imports: RapidOCR and the dependencies the application
# lists for it, plus Pillow and PyYAML. Versions and hashes come from uv.lock.
PACKAGES = (
    'rapidocr', 'onnxruntime', 'opencv-python-headless', 'numpy', 'omegaconf', 'antlr4-python3-runtime',
    'colorlog', 'pyclipper', 'shapely', 'pillow', 'pyyaml', 'six', 'tqdm', 'requests', 'certifi',
    'charset-normalizer', 'idna', 'urllib3', 'flatbuffers', 'packaging', 'protobuf', 'python-bidi',
)


def reference_dir():
    override = os.environ.get('OCR_REFERENCE_DIR')
    if override:
        return Path(override)
    cache = os.environ.get('XDG_CACHE_HOME') or str(Path.home() / '.cache')
    return Path(cache) / 'vrct-vox' / 'ocr-reference'


def load_catalog():
    spec = importlib.util.spec_from_file_location('vrct_catalog', CATALOG_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as reader:
        for block in iter(lambda: reader.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def fetch(url, target, size, digest):
    if target.exists() and target.stat().st_size == size and sha256(target) == digest:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + '.part')
    print(f'fetch {target.parent.parent.name}/{target.name} ({size} bytes)', flush=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'ocr-reference-setup'})
    with urllib.request.urlopen(request) as reader, open(part, 'wb') as writer:
        shutil.copyfileobj(reader, writer, 1 << 20)
    found = sha256(part)
    if part.stat().st_size != size or found != digest:
        part.unlink()
        raise SystemExit(f'{target.name}: expected {size} bytes / {digest}, got {found}')
    part.replace(target)


def models(root, catalog, ids):
    for model in catalog.CATALOG:
        if model.target != 'ocr' or (ids and model.id not in ids):
            continue
        for artifact in model.artifacts:
            target = root / 'downloaded_models' / model.id / model.revision / artifact.filename
            fetch(catalog.artifact_url(model, artifact), target, artifact.size, artifact.sha256)


def requirements():
    """The hash-pinned lines of uv.lock for PACKAGES, as a requirements file."""
    exported = subprocess.run(
        ['uv', 'export', '--frozen', '--no-emit-project', '--no-dev', '--format', 'requirements-txt'],
        cwd=REPO_ROOT, check=True, capture_output=True, text=True).stdout
    lines, keep = [], False
    for line in exported.splitlines():
        if line and not line[0].isspace() and not line.startswith('#'):
            keep = line.split('==')[0].strip().lower() in PACKAGES
        if keep:
            lines.append(line)
    found = {line.split('==')[0].lower() for line in lines if line and not line[0].isspace()}
    missing = set(PACKAGES) - found
    if missing:
        raise SystemExit(f'not in uv.lock: {", ".join(sorted(missing))}')
    return '\n'.join(lines) + '\n'


def venv(root):
    python = root / 'venv' / 'bin' / 'python'
    marker = root / 'venv' / '.ready'
    wanted = requirements()
    if marker.exists() and marker.read_text() == wanted:
        return python
    uv = shutil.which('uv')
    if not uv:
        raise SystemExit('uv is required to create the reference environment')
    # Run from the repository so uv picks the Python that pyproject.toml's requires-python names:
    # uv.lock holds wheels for that version only.
    subprocess.run([uv, 'venv', '--clear', str(root / 'venv')], cwd=REPO_ROOT, check=True)
    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False) as handle:
        handle.write(wanted)
    try:
        # --no-deps: RapidOCR asks for opencv-python, which the application replaces with the headless build.
        subprocess.run([uv, 'pip', 'install', '--python', str(python), '--no-deps', '--require-hashes', '-r', handle.name],
                       check=True)
    finally:
        os.unlink(handle.name)
    marker.write_text(wanted)
    return python


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--model', action='append', default=[],
                        help='catalog id to fetch (repeatable); default: every OCR entry')
    args = parser.parse_args()
    root = reference_dir()
    root.mkdir(parents=True, exist_ok=True)
    models(root, load_catalog(), set(args.model))
    python = venv(root)
    print(f'reference directory: {root}')
    print(f'reference python:    {python}')


if __name__ == '__main__':
    sys.exit(main())
