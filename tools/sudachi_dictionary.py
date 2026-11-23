"""Fetch the SudachiDict system dictionary the readings (hiragana and romaji) use.

The Rust core analyzes text with sudachi.rs and reads `_internal/build/sudachi/system.dic`
(native/core/src/controller/messages.rs, decision 3 in docs/voice-stack/core-integration.md).
This tool downloads the official SudachiDict release at a fixed version, checks its size and
SHA-256, and writes the dictionary with its license texts to build/sudachi, where
tools/app_resources.py stages it. It runs when a package is built (bat/build.bat,
tools/build_linux.py); the app never downloads it. A folder that already holds the same edition,
checked, is kept.

    python tools/sudachi_dictionary.py fetch
    python tools/sudachi_dictionary.py check build/sudachi

The editions hold the same analysis with fewer words: full is what the Python backend used, and
the edition the packages ship (SHIPPED_EDITION).
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
from urllib.request import urlopen
import zipfile

try:
    from .download_retry import retrying
except ImportError:
    from download_retry import retrying

ROOT = Path(__file__).resolve().parents[1]
VERSION = '20250825'
BASE = 'https://d2ej7fkh96fzlu.cloudfront.net/sudachidict'
# The official archives (WAP Tokushima Laboratory of AI and NLP), checked on 2026-11-16. The
# dictionaries in them are byte for byte the ones of the sudachidict_* 20250825 Python packages.
EDITIONS = {
    'full': dict(archive_size=126591740, archive_sha256='7ce16d45e9ff0ccb70a3c8ba70346240ef246e6ad499cfab033fc2c1da4d19b4',
                 size=359725440, sha256='08eac653b59c4ad579e38fcf64ce338fd3edab87c28a1ad97449f5fe2a9bcf87'),
    'core': dict(archive_size=72154227, archive_sha256='382ba07b032c15e347d005ba6d9725aebf87dc2d6ca2c290861d01f337a6763a',
                 size=217171677, sha256='d28ffc33b196e5c2ca731e8147fd1ef47d35ba79928ef9f0871962859d70ac23'),
    'small': dict(archive_size=41767390, archive_sha256='ad5b87afba5dc8a41791e47a538d0c5522546469529a6e632ea0986873cd2776',
                  size=122948127, sha256='e076bd69700771ea57b7d88c0bb63e1e8cce939be198710ee09e9d2887774ebb'),
}
NOTICES = ('LEGAL', 'LICENSE-2.0.txt')
MANIFEST = 'dictionary.json'
# The edition the packages ship: decision 3 in docs/voice-stack/core-integration.md (2026-11-21,
# issue #924). full keeps the readings 0.4 gave; core reads English words as they are written.
SHIPPED_EDITION = 'full'


def url(edition):
    return f'{BASE}/{archive_name(edition)}'


def archive_name(edition):
    """The official archive's file name, under which a build may keep it."""
    return f'sudachi-dictionary-{VERSION}-{edition}.zip'


def _digest(stream):
    digest, size = hashlib.sha256(), 0
    for block in iter(lambda: stream.read(1 << 20), b''):
        digest.update(block)
        size += len(block)
    return size, digest.hexdigest()


def download_archive(edition, destination, *, opener=urlopen):
    """Downloads the archive of `edition` to `destination` and checks it."""
    expected = EDITIONS[edition]

    def attempt():
        with opener(url(edition), timeout=60) as response, open(destination, 'wb') as file:
            shutil.copyfileobj(response, file, 1 << 20)

    retrying(attempt, url(edition).rsplit('/', 1)[-1])
    with open(destination, 'rb') as file:
        size, sha256 = _digest(file)
    if (size, sha256) != (expected['archive_size'], expected['archive_sha256']):
        raise SystemExit(f'{url(edition)}: got {size} bytes, SHA-256 {sha256}; expected '
                         f"{expected['archive_size']} bytes, {expected['archive_sha256']}")


def stage(archive, edition, output):
    """Writes system.dic, the license texts and dictionary.json of `edition` to `output`."""
    expected = EDITIONS[edition]
    folder = f'sudachi-dictionary-{VERSION}'
    output = Path(output)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    with zipfile.ZipFile(archive) as bundle:
        members = {f'{folder}/system_{edition}.dic': 'system.dic', **{f'{folder}/{name}': name for name in NOTICES}}
        for member, name in members.items():
            with bundle.open(member) as source, open(output / name, 'wb') as target:
                shutil.copyfileobj(source, target, 1 << 20)
    with open(output / 'system.dic', 'rb') as file:
        size, sha256 = _digest(file)
    if (size, sha256) != (expected['size'], expected['sha256']):
        shutil.rmtree(output)
        raise SystemExit(f'system_{edition}.dic: got {size} bytes, SHA-256 {sha256}')
    record = dict(name='SudachiDict', edition=edition, version=VERSION, license='Apache-2.0',
                  url=url(edition), size=size, sha256=sha256)
    (output / MANIFEST).write_text(json.dumps(record, indent=1) + '\n', encoding='utf-8')
    return record


def ensure(edition, output, *, archive=None, download=True, opener=urlopen):
    """Makes `output` hold `edition`, checked, and returns its record. A folder that already holds
    it is kept. Otherwise the dictionary is staged from `archive`, which is downloaded there first
    when it is missing and `download` allows it (a temporary file when `archive` is None)."""
    output = Path(output)
    if not check(output):
        record = json.loads((output / MANIFEST).read_text(encoding='utf-8'))
        if record.get('edition') == edition:
            return record
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(archive) if archive is not None else Path(tmp) / archive_name(edition)
        if not source.is_file():
            if not download:
                raise SystemExit(f'{source}: missing (the SudachiDict {edition} archive)')
            source.parent.mkdir(parents=True, exist_ok=True)
            download_archive(edition, source, opener=opener)
        return stage(source, edition, output)


def check(folder):
    """What a staged folder lacks or got wrong; empty when it is complete."""
    folder = Path(folder)
    manifest = folder / MANIFEST
    if not manifest.is_file():
        return [MANIFEST]
    record = json.loads(manifest.read_text(encoding='utf-8'))
    problems = [name for name in ('system.dic', *NOTICES) if not (folder / name).is_file()]
    if not problems:
        with open(folder / 'system.dic', 'rb') as file:
            if _digest(file) != (record['size'], record['sha256']):
                problems.append('system.dic (size or SHA-256)')
    expected = EDITIONS.get(record.get('edition'))
    if expected is None or (expected['size'], expected['sha256']) != (record['size'], record['sha256']):
        problems.append(f'{MANIFEST} (not a pinned edition)')
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    fetching = commands.add_parser('fetch', help='download and stage a pinned edition')
    fetching.add_argument('--edition', choices=sorted(EDITIONS), default=SHIPPED_EDITION)
    fetching.add_argument('--output', type=Path, default=ROOT / 'build/sudachi')
    fetching.add_argument('--archive', type=Path,
                          help='an archive downloaded before (checked the same way), or where to keep the download')
    checking = commands.add_parser('check', help='check a staged folder')
    checking.add_argument('folder', type=Path, nargs='?', default=ROOT / 'build/sudachi')
    args = parser.parse_args(argv)
    if args.command == 'check':
        problems = check(args.folder)
        if problems:
            print(f'{args.folder}: {", ".join(problems)}', file=sys.stderr)
            return 1
        print(f'{args.folder} complete')
        return 0
    record = ensure(args.edition, args.output, archive=args.archive)
    print(f"SudachiDict {record['version']} {record['edition']} ({record['size']} bytes) in {args.output}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
