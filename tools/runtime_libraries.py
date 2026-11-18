"""The ONNX Runtime and OpenVR libraries the app ships in `_internal` (issue #509).

Chat reading and local translation load ONNX Runtime at run time, and the VR overlay and the
chat reading's headset view load the OpenVR client library. Until 0.4 both came with the Python
backend; since 0.5.0 they ship on their own, in the versions 0.4 shipped:

- ONNX Runtime 1.31.0, the official CPU build: the same archives the RVC runtime setup uses
  (`ORT_VERSION` in native/voice-conversion/src/runtime.rs).
- The OpenVR client library 2.12.14, from the pyopenvr 2.12.1401 wheel pinned in uv.lock. The
  core's function tables are those of this SDK (native/vr-overlay/src/openvr.rs,
  native/ocr-runtime/src/capture/openvr.rs), checked against the wheel's own tables
  (native/openvr-client/reference/dump_reference.py; rerun it when the wheel changes).

    python tools/runtime_libraries.py --platform windows --download --output build

The archives are kept in `build/runtime-libraries` and checked by size and SHA-256 before
anything is read from them; only the files listed below are taken out. The libraries go to
`build/onnxruntime` and `build/openvr`, their license texts to `build/licenses/onnxruntime` and
`build/licenses/openvr`; tools/app_resources.py stages them into `_internal`, where the core
finds them (native/core/src/shipped_libraries.rs).
"""
import argparse
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import sys
import tarfile
import tempfile
import time
from urllib.request import urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'build/runtime-libraries'
ORT_VERSION = '1.31.0'
ORT_RELEASE = f'https://github.com/microsoft/onnxruntime/releases/download/v{ORT_VERSION}/'
OPENVR_WHEEL = ('https://files.pythonhosted.org/packages/46/a2/e6cb89bd1803ffe70a25c20121ad8bb533fa1f1334ce7f0f7585d35e5096/'
                'openvr-2.12.1401-py3-none-any.whl')

# Each archive: where it comes from, its exact size and SHA-256, and {member: path under build/}.
ARCHIVES = {
    'onnxruntime-windows': {
        'url': ORT_RELEASE + f'onnxruntime-win-x64-{ORT_VERSION}.zip',
        'name': f'onnxruntime-win-x64-{ORT_VERSION}.zip',
        'size': 82887349,
        'sha256': '3958d8a44984160692c1b4ffd0de3cb48f8c39f9d34bb31e433db06e30b82195',
        'files': {
            f'onnxruntime-win-x64-{ORT_VERSION}/lib/onnxruntime.dll': 'onnxruntime/onnxruntime.dll',
            f'onnxruntime-win-x64-{ORT_VERSION}/lib/onnxruntime_providers_shared.dll': 'onnxruntime/onnxruntime_providers_shared.dll',
            f'onnxruntime-win-x64-{ORT_VERSION}/LICENSE': 'licenses/onnxruntime/LICENSE',
            f'onnxruntime-win-x64-{ORT_VERSION}/ThirdPartyNotices.txt': 'licenses/onnxruntime/ThirdPartyNotices.txt',
        },
    },
    'onnxruntime-linux': {
        'url': ORT_RELEASE + f'onnxruntime-linux-x64-{ORT_VERSION}.tgz',
        'name': f'onnxruntime-linux-x64-{ORT_VERSION}.tgz',
        'size': 11408003,
        'sha256': 'cc5c72baf5ae5c8238a6841f0897227be2d02826b9cf98eaf02fdefaeeb03a57',
        'files': {
            # The real file, not the archive's symlinks: the core loads it by its full path.
            f'onnxruntime-linux-x64-{ORT_VERSION}/lib/libonnxruntime.so.{ORT_VERSION}': 'onnxruntime/libonnxruntime.so',
            f'onnxruntime-linux-x64-{ORT_VERSION}/lib/libonnxruntime_providers_shared.so': 'onnxruntime/libonnxruntime_providers_shared.so',
            f'onnxruntime-linux-x64-{ORT_VERSION}/LICENSE': 'licenses/onnxruntime/LICENSE',
            f'onnxruntime-linux-x64-{ORT_VERSION}/ThirdPartyNotices.txt': 'licenses/onnxruntime/ThirdPartyNotices.txt',
        },
    },
    'openvr-windows': {
        'url': OPENVR_WHEEL,
        'name': 'openvr-2.12.1401-py3-none-any.whl',
        'size': 1965222,
        'sha256': 'ef761cef3162843a8025a7812d5e244fd94ab3a992ca8f5ef0d1b0188ad56cb3',
        'files': {
            'openvr/libopenvr_api_64.dll': 'openvr/libopenvr_api_64.dll',
            'openvr-2.12.1401.dist-info/licenses/LICENSE': 'licenses/openvr/pyopenvr-LICENSE',
        },
    },
    'openvr-linux': {
        'url': OPENVR_WHEEL,
        'name': 'openvr-2.12.1401-py3-none-any.whl',
        'size': 1965222,
        'sha256': 'ef761cef3162843a8025a7812d5e244fd94ab3a992ca8f5ef0d1b0188ad56cb3',
        'files': {
            'openvr/libopenvr_api_64.so': 'openvr/libopenvr_api_64.so',
            'openvr-2.12.1401.dist-info/licenses/LICENSE': 'licenses/openvr/pyopenvr-LICENSE',
        },
    },
    # The library is Valve's; the wheel's license is the Python wrapper's. Valve's own text for
    # the same SDK release, read as it is (not an archive).
    'openvr-license': {
        'url': 'https://raw.githubusercontent.com/ValveSoftware/openvr/v2.12.14/LICENSE',
        'name': 'openvr-v2.12.14-LICENSE',
        'size': 1488,
        'sha256': 'f56ff606104d4ef18e617921a75c73ad73b5a1a1d70c69590c29de16919e04ad',
        'raw': True,
        'files': {'LICENSE': 'licenses/openvr/LICENSE'},
    },
}
PLATFORMS = {'windows': ('onnxruntime-windows', 'openvr-windows', 'openvr-license'),
             'linux': ('onnxruntime-linux', 'openvr-linux', 'openvr-license')}
DOWNLOAD_SECONDS = 600


def shipped(platform):
    """The paths under build/ (and so under `_internal`) that `stage` writes for `platform`."""
    return [path for key in PLATFORMS[platform] for path in ARCHIVES[key]['files'].values()]


def _read_verified(path, archive):
    """The archive's bytes, read once and checked; nothing is read from the file again."""
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError(f'Not a regular file: {path}')
    data = path.read_bytes()
    if len(data) != archive['size'] or hashlib.sha256(data).hexdigest() != archive['sha256']:
        raise ValueError(f'{path.name} does not match its pinned size and SHA-256')
    return data


def fetch(archive, cache=CACHE, *, opener=urlopen):
    """Downloads `archive` into `cache` unless a verified copy is there; returns its path."""
    cache = Path(cache)
    destination = cache / archive['name']
    if destination.exists():
        _read_verified(destination, archive)
        return destination
    cache.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=cache, suffix='.part', delete=False) as out:
            temporary = Path(out.name)
            total, deadline = 0, time.monotonic() + DOWNLOAD_SECONDS
            with opener(archive['url'], timeout=30) as response:
                while block := response.read(1024 * 1024):
                    total += len(block)
                    if total > archive['size'] or time.monotonic() > deadline:
                        raise ValueError(f'{archive["name"]}: download too large or too slow')
                    out.write(block)
        _read_verified(temporary, archive)
        os.replace(temporary, destination)
        temporary = None
        return destination
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _members(data, archive):
    """{member name: bytes} of the regular files in a verified zip or tar.gz archive."""
    name = archive['name']
    if archive.get('raw'):
        return {next(iter(archive['files'])): data}
    files = {}
    if name.endswith(('.zip', '.whl')):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for info in archive.infolist():
                if not info.is_dir():
                    files[info.filename] = archive.read(info)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            for info in archive.getmembers():
                if info.isfile():
                    files[info.name] = archive.extractfile(info).read()
    return files


def stage(platform, build, cache=CACHE, *, download=False, opener=urlopen):
    """Writes the libraries and license texts of `platform` under `build`; returns their paths."""
    build = Path(build)
    written = []
    for key in PLATFORMS[platform]:
        archive = ARCHIVES[key]
        path = Path(cache) / archive['name']
        if download:
            path = fetch(archive, cache, opener=opener)
        elif not path.exists():
            raise FileNotFoundError(f'{path} is missing; run tools/runtime_libraries.py --download')
        members = _members(_read_verified(path, archive), archive)
        for member, target in archive['files'].items():
            if member not in members:
                raise ValueError(f'{archive["name"]} has no {member}')
            relative = PurePosixPath(target)
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError(f'Unsafe target: {target}')
            out = build / relative
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(members[member])
            if out.suffix == '.so' and os.name != 'nt':
                out.chmod(0o755)
            written.append(target)
    return written


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--platform', choices=sorted(PLATFORMS), required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'build', help='the build folder (default: build)')
    parser.add_argument('--cache', type=Path, default=CACHE, help='where the pinned archives are kept')
    parser.add_argument('--download', action='store_true', help='fetch a pinned archive that is not cached yet')
    args = parser.parse_args(argv)
    for path in stage(args.platform, args.output, args.cache, download=args.download):
        print(path)
    return 0


if __name__ == '__main__':
    sys.exit(main())
