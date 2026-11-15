"""Consent-gated setup of a voice conversion runtime (Windows, Linux x86-64).

Two kinds, both fetched from pinned sources after consent and never imported here:

- RVC ("native"): ONNX Runtime with its CUDA provider, the CUDA and cuDNN libraries it
  needs, and the two fixed networks. The bundled Rust worker (vrct-rvc-worker) runs them.
- Seed-VC ("python"): a Python environment set up by a pinned uv over hash-locked
  requirements, and the engine's source.

A failed or cancelled setup keeps each finished step and continues from there.
"""
from dataclasses import asdict, dataclass
import errno
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
from threading import Event, RLock, Thread
import time
from urllib.parse import quote, urlsplit
from uuid import uuid4
import zipfile

from models.model_downloads.staging import RootLease
from models.model_downloads.transport import HOSTS, open_public
from models.owned_child import launch_owned
from runtime_paths import external_process_env

CHUNK = 1024 * 1024
ACTIVE = ('queued', 'tools', 'python', 'packages', 'engine', 'libraries', 'assets', 'verifying', 'cancelling')
STEPS = ('tools', 'python', 'packages', 'engine', 'assets', 'verifying')
NATIVE_STEPS = ('libraries', 'assets', 'verifying')
# The step that failed says what the user can do about it.
STEP_ERRORS = {'tools': 'vc_runtime_tools_failed', 'python': 'vc_runtime_python_failed',
               'packages': 'vc_runtime_packages_failed', 'engine': 'vc_runtime_source_failed',
               'libraries': 'vc_runtime_libraries_failed',
               'assets': 'vc_runtime_assets_failed', 'verifying': 'vc_runtime_gpu_unusable'}



@dataclass(frozen=True)
class Tool:
    """One platform's uv release file."""
    url: str
    size: int
    sha256: str
    member: str  # uv inside the archive.


UV_VERSION = '0.13.7'
UV_RELEASE = f'https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/'
# The hashes are the ones the release publishes next to each file.
UV = {'win32': Tool(UV_RELEASE + 'uv-x86_64-pc-windows-msvc.zip', 15236317,
                    '0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021', 'uv.exe'),
      'linux': Tool(UV_RELEASE + 'uv-x86_64-unknown-linux-gnu.tar.gz', 16671812,
                    'c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83',
                    'uv-x86_64-unknown-linux-gnu/uv')}
# GitHub serves releases and source archives from these hosts. uv itself fetches Python
# and packages, and checks them against what it pins and the lock files.
# The NVIDIA libraries come from their PyPI wheels.
SOURCE_HOSTS = HOSTS | {'github.com', 'codeload.github.com', 'objects.githubusercontent.com',
                        'release-assets.githubusercontent.com', 'files.pythonhosted.org'}
SOURCE_LIMIT = 64 * 1024 * 1024
# What an engine archive may hold before anything is unpacked (security audit SEC-04). The
# pinned Seed-VC archive is far below: 111 entries and 27 MB, and no file compresses more
# than 21 times.
SOURCE_MAX_ENTRIES = 4096
SOURCE_MAX_BYTES = 256 * 1024 * 1024
SOURCE_MAX_RATIO = 200
CUDA_INDEX = 'https://download.pytorch.org/whl/cu128'
CUDA_CHECK = 'import sys, torch; sys.exit(0 if torch.cuda.is_available() else 3)'
RVC_REPO, RVC_REVISION = 'lj1995/VoiceConversionWebUI', 'e6d0c1a17da07c33557852f9dfa2bd44cc75737d'
SEED_COMMIT = '58d0ca372cc76f60a798d9f84611f053f9029f3a'
SEED_DIGEST = '106613138abf328fd382ba211709675399f11e76f720abfd4ab54eb2bac2b755'  # After the patch.
SEED_MANIFEST = 'docs/voice-stack/seed-vc-poc-artifacts.json'
SEED_SOURCE = f'https://github.com/jiaheguo521/seed-vc-realtime/archive/{SEED_COMMIT}.zip'
# tree_digest of every unpacked file (after the patch), per archive (SEC-04). source_digest
# covers only the .py files the worker checks again at start. GitHub does not promise that an
# archive keeps the same bytes, so the files are pinned rather than the archive: it is unpacked
# into staging within the limits above and installed only if every file matches. Kept out of
# Runtime so that an installed runtime keeps its version.
SOURCE_TREE_DIGESTS = {
    SEED_SOURCE: '7f1e4b14885d607135c7203408d339d6d4cb2f97ab8935b3af07895f74cd9b1e',
}
HUNK = re.compile(r'@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@')
# The NVIDIA kernel driver publishes this while it is loaded; nouveau does not.
LINUX_DRIVER = Path('/proc/driver/nvidia/version')


def target():
    """The platform a runtime can be set up for, or ''. The Linux locks name x86-64 wheels."""
    if sys.platform == 'win32':
        return 'win32'
    return 'linux' if sys.platform == 'linux' and platform.machine() == 'x86_64' else ''


def runtime_python(folder):
    """The same file seed_process.runtime_python starts."""
    return folder / ('venv/Scripts/python.exe' if target() == 'win32' else 'venv/bin/python')


def worker_file(path):
    # Importing the process stack waits until a setup page needs it, not app start.
    from .seed_process import worker_root
    return worker_root() / path


def native_worker():
    """The bundled RVC worker that runs a native runtime."""
    from .rvc_process import worker_binary
    return worker_binary()


class Cancelled(Exception):
    pass


@dataclass(frozen=True)
class Asset:
    url: str
    path: str  # Under the runtime's assets folder.
    size: int
    sha256: str = ''
    blob: str = ''  # Git blob id, for small files whose source lists no SHA-256.


@dataclass(frozen=True)
class Runtime:
    id: str
    name: str
    python: str
    locks: tuple  # (path under the worker root, package index or '').
    source_url: str
    source_digest: str
    patch: str  # Path under the worker root, or ''.
    assets: tuple
    license: str
    licenses: tuple
    notice: str
    download_bytes: int
    disk_bytes: int
    kind: str = 'python'  # or 'native': libraries and assets for the bundled worker
    libraries: tuple = ()  # Library rows, native only


@dataclass(frozen=True)
class Library:
    """A pinned archive (zip, wheel or .tgz) and the files taken from it into lib/."""
    url: str
    size: int
    sha256: str
    members: tuple  # (path inside the archive, file name under lib/)


def steps_of(runtime):
    return NATIVE_STEPS if runtime.kind == 'native' else STEPS


def hf_url(repo, revision, path):
    return f'https://huggingface.co/{repo}/resolve/{revision}/{quote(path, safe="/")}'


# What differs by platform for Seed-VC: the lock files, then the download and free space
# shown before consent. The sizes are rounded up from one measured setup on each platform.
SEED_PLATFORM = {
    'win32': ((('integrations/seed_vc/requirements-windows.lock', ''),), 5_000_000_000, 14_000_000_000),
    'linux': ((('integrations/seed_vc/requirements.lock', ''),), 6_400_000_000, 18_000_000_000)}

# RVC: ONNX Runtime from Microsoft's release and the NVIDIA libraries from their PyPI wheels,
# CUDA 12, the same CUDA and cuDNN versions the previous PyTorch runtime used (so the NVIDIA
# driver it needs is unchanged). Only the files the CUDA provider loads are kept.
ORT_VERSION = '1.31.0'
ORT_RELEASE = f'https://github.com/microsoft/onnxruntime/releases/download/v{ORT_VERSION}/'
PYPI = 'https://files.pythonhosted.org/packages/'


def _wheel(path, size, sha256, folder, names):
    return Library(PYPI + path, size, sha256, tuple((f'nvidia/{folder}/{name}', name.rsplit('/', 1)[-1]) for name in names))


CUDNN_LINUX = ('lib/libcudnn.so.9', 'lib/libcudnn_adv.so.9', 'lib/libcudnn_cnn.so.9',
               'lib/libcudnn_engines_precompiled.so.9', 'lib/libcudnn_engines_runtime_compiled.so.9',
               'lib/libcudnn_graph.so.9', 'lib/libcudnn_heuristic.so.9', 'lib/libcudnn_ops.so.9')
CUDNN_WINDOWS = ('bin/cudnn64_9.dll', 'bin/cudnn_adv64_9.dll', 'bin/cudnn_cnn64_9.dll',
                 'bin/cudnn_engines_precompiled64_9.dll', 'bin/cudnn_engines_runtime_compiled64_9.dll',
                 'bin/cudnn_graph64_9.dll', 'bin/cudnn_heuristic64_9.dll', 'bin/cudnn_ops64_9.dll')
# The hashes are the ones GitHub and PyPI publish for each file.
RVC_LIBRARIES = {
    'linux': (
        Library(ORT_RELEASE + f'onnxruntime-linux-x64-gpu_cuda12-{ORT_VERSION}.tgz', 450228883,
                '62d3af5269af2143b5d37494337573f1ffb8885f3ad7477ae0cb1cc79c8dedfd',
                tuple((f'onnxruntime-linux-x64-gpu_cuda12-{ORT_VERSION}/lib/{source}', name) for source, name in (
                    (f'libonnxruntime.so.{ORT_VERSION}', 'libonnxruntime.so'),
                    ('libonnxruntime_providers_cuda.so', 'libonnxruntime_providers_cuda.so'),
                    ('libonnxruntime_providers_shared.so', 'libonnxruntime_providers_shared.so')))),
        _wheel('0d/9b/a997b638fcd068ad6e4d53b8551a7d30fe8b404d6f1804abf1df69838932/nvidia_cuda_runtime_cu12-12.8.90-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl',
               954765, 'adade8dcbd0edf427b7204d480d6066d33902cab2a4707dcfc48a2d0fd44ab90', 'cuda_runtime', ('lib/libcudart.so.12',)),
        _wheel('dc/61/e24b560ab2e2eaeb3c839129175fb330dfcfc29e5203196e5541a4c44682/nvidia_cublas_cu12-12.8.4.1-py3-none-manylinux_2_27_x86_64.whl',
               594346921, '8ac4e771d5a348c551b2a426eda6193c19aa630236b418086020df5ba9667142', 'cublas', ('lib/libcublas.so.12', 'lib/libcublasLt.so.12')),
        _wheel('fb/aa/6584b56dc84ebe9cf93226a5cde4d99080c8e90ab40f0c27bda7a0f29aa1/nvidia_curand_cu12-10.3.9.90-py3-none-manylinux_2_27_x86_64.whl',
               63619976, 'b32331d4f4df5d6eefa0554c565b626c7216f87a06a4f56fab27c3b68a830ec9', 'curand', ('lib/libcurand.so.10',)),
        _wheel('05/6b/32f747947df2da6994e999492ab306a903659555dddc0fbdeb9d71f75e52/nvidia_cuda_nvrtc_cu12-12.8.93-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl',
               88040029, 'a7756528852ef889772a84c6cd89d41dfa74667e24cca16bb31f8f061e3e9994', 'cuda_nvrtc', ('lib/libnvrtc.so.12', 'lib/libnvrtc-builtins.so.12.8')),
        _wheel('c5/41/65225d42fba06fb3dd3972485ea258e7dd07a40d6e01c95da6766ad87354/nvidia_cudnn_cu12-9.19.0.56-py3-none-manylinux_2_27_x86_64.whl',
               657906812, 'ac6ad90a075bb33a94f2b4cf4622eac13dd4dc65cf6dd9c7572a318516a36625', 'cudnn', CUDNN_LINUX)),
    'win32': (
        Library(ORT_RELEASE + f'onnxruntime-win-x64-gpu_cuda12-{ORT_VERSION}.zip', 392994831,
                'fa79097fa478961cbd31c297671ac169eb0d3f1dfdc9e8481e091850f8c4810b',
                tuple((f'onnxruntime-win-x64-gpu_cuda12-{ORT_VERSION}/lib/{name}', name) for name in (
                    'onnxruntime.dll', 'onnxruntime_providers_cuda.dll', 'onnxruntime_providers_shared.dll'))),
        _wheel('30/a5/a515b7600ad361ea14bfa13fb4d6687abf500adc270f19e89849c0590492/nvidia_cuda_runtime_cu12-12.8.90-py3-none-win_amd64.whl',
               944318, 'c0c6027f01505bfed6c3b21ec546f69c687689aad5f1a377554bc6ca4aa993a8', 'cuda_runtime', ('bin/cudart64_12.dll',)),
        _wheel('70/61/7d7b3c70186fb651d0fbd35b01dbfc8e755f69fd58f817f3d0f642df20c3/nvidia_cublas_cu12-12.8.4.1-py3-none-win_amd64.whl',
               567544208, '47e9b82132fa8d2b4944e708049229601448aaad7e6f296f630f2d1a32de35af', 'cublas', ('bin/cublas64_12.dll', 'bin/cublasLt64_12.dll')),
        _wheel('b9/75/70c05b2f3ed5be3bb30b7102b6eb78e100da4bbf6944fd6725c012831cab/nvidia_curand_cu12-10.3.9.90-py3-none-win_amd64.whl',
               62765309, 'f149a8ca457277da854f89cf282d6ef43176861926c7ac85b2a0fbd237c587ec', 'curand', ('bin/curand64_10.dll',)),
        _wheel('45/51/52a3d84baa2136cc8df15500ad731d74d3a1114d4c123e043cb608d4a32b/nvidia_cuda_nvrtc_cu12-12.8.93-py3-none-win_amd64.whl',
               73586838, '7a4b6b2904850fe78e0bd179c4b655c404d4bb799ef03ddc60804247099ae909', 'cuda_nvrtc', ('bin/nvrtc64_120_0.dll', 'bin/nvrtc-builtins64_128.dll')),
        _wheel('a7/a5/48f07449fc9c6cc146dcafe6149fa5d69630137d2ec5b7d9e09f255fadd7/nvidia_cudnn_cu12-9.19.0.56-py3-none-win_amd64.whl',
               644003014, 'cec70596b9ce878fab83810c3f5a2e606d35f510e5fee579759e4cbc68a23750', 'cudnn', CUDNN_WINDOWS))}
# Unpacked libraries and networks, plus the largest archive while it is unpacked, rounded up.
RVC_DISK = {'linux': 4_200_000_000, 'win32': 3_800_000_000}
# Only what the worker reads: the HuBERT checkpoint (its graph is built from these two files)
# and the RMVPE network as ONNX, from the same pinned revision as before.
RVC_ASSETS = (
    Asset(hf_url(RVC_REPO, RVC_REVISION, 'hubert_base/config.json'), 'hubert_base/config.json', 1492,
          '0346950779dfb7f9316fa74ed846e2b8a22a08eedfdc5387b73f327cb1a4a7cf'),
    Asset(hf_url(RVC_REPO, RVC_REVISION, 'hubert_base/pytorch_model.bin'), 'hubert_base/pytorch_model.bin', 189206711,
          'cc8c20f4b90a520757260197a3ff2505705a7adbd20ad9eeaa4e1a9b38442ef5'),
    Asset(hf_url(RVC_REPO, RVC_REVISION, 'rmvpe.onnx'), 'rmvpe/rmvpe.onnx', 361688443,
          '5370e71ac80af8b4b7c793d27efd51fd8bf962de3a7ede0766dac0befa3660fd'))


def rvc_runtime():
    libraries = RVC_LIBRARIES[target()]
    return Runtime(
        'rvc', 'RVC', '', (), '', '', '', RVC_ASSETS,
        'MIT, NVIDIA CUDA/cuDNN EULA',
        (f'https://github.com/microsoft/onnxruntime/blob/v{ORT_VERSION}/LICENSE',
         f'https://huggingface.co/{RVC_REPO}', 'https://docs.nvidia.com/cuda/eula/index.html',
         'https://docs.nvidia.com/deeplearning/cudnn/backend/latest/reference/eula.html'),
        'rvc', sum(item.size for item in libraries) + sum(asset.size for asset in RVC_ASSETS),
        RVC_DISK[target()], kind='native', libraries=libraries)


def seed_assets(manifest):
    """The reviewed Seed-VC files, in the layout its offline loader reads."""
    rows = []
    for item in manifest['files']:
        lfs = item.get('lfs') or {}
        rows.append(Asset(hf_url(item['repo'], item['revision'], item['rfilename']),
                          f"{item['repo']}/{item['revision']}/{item['rfilename']}", item['size'],
                          lfs.get('sha256', ''), '' if lfs else item['blobId']))
    return tuple(rows)


def seed_runtime():
    manifest = json.loads(worker_file(SEED_MANIFEST).read_text(encoding='utf-8'))
    locks, download, disk = SEED_PLATFORM[target()]
    return Runtime(
        'seed-vc', 'Seed-VC', '3.11', locks, SEED_SOURCE, SEED_DIGEST,
        'integrations/seed_vc/offline-loader.patch', seed_assets(manifest),
        'GPL-3.0, Apache-2.0, BSD-3-Clause, NVIDIA CUDA EULA',
        (f'https://github.com/jiaheguo521/seed-vc-realtime/blob/{SEED_COMMIT}/LICENSE',
         'https://huggingface.co/Plachta/Seed-VC', 'https://huggingface.co/funasr/fsmn-vad',
         'https://huggingface.co/funasr/campplus', 'https://huggingface.co/FunAudioLLM/CosyVoice-300M',
         'https://huggingface.co/facebook/wav2vec2-xls-r-300m', 'https://github.com/pytorch/pytorch/blob/main/LICENSE',
         'https://docs.nvidia.com/cuda/eula/index.html'),
        'seed', download, disk)


def runtimes():
    """What this platform can set up."""
    if not target():
        return ()
    return (rvc_runtime(), seed_runtime())


def source_digest(root):
    """Every Python file of an engine source in one hash (the Seed-VC worker checks it again)."""
    root = Path(root)
    digest = hashlib.sha256()
    for name in sorted(file.relative_to(root).as_posix() for file in root.rglob('*.py')):
        digest.update(name.encode() + b'\0' + hashlib.sha256((root / name).read_bytes()).digest())
    return digest.hexdigest()


def tree_digest(root):
    """source_digest over every file, not only the .py files (SEC-04)."""
    root = Path(root)
    digest = hashlib.sha256()
    for name in sorted(file.relative_to(root).as_posix() for file in root.rglob('*') if file.is_file()):
        digest.update(name.encode() + b'\0' + hashlib.sha256((root / name).read_bytes()).digest())
    return digest.hexdigest()


@lru_cache(maxsize=None)
def version_of(runtime):
    """Changes with anything the user consented to or that changes the install."""
    if runtime.kind == 'native':
        return hashlib.sha256(json.dumps(asdict(runtime), sort_keys=True).encode()).hexdigest()[:16]
    digest = hashlib.sha256(json.dumps([asdict(runtime), UV_VERSION, UV[target()].sha256], sort_keys=True).encode())
    for path, _ in runtime.locks:
        digest.update(hashlib.sha256(worker_file(path).read_bytes()).digest())
    return digest.hexdigest()[:16]


def nvidia_driver():
    """CUDA needs this driver; it is present with any NVIDIA GPU.

    Only a file is looked for. The runtime answers for itself once it is installed.
    """
    if target() == 'win32':
        return (Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/nvcuda.dll').is_file()
    return LINUX_DRIVER.is_file()


class _Group(subprocess.Popen):
    """uv and whatever it starts, such as a package's build, stopped together."""
    def kill(self):
        if self.poll() is None:
            os.killpg(self.pid, signal.SIGKILL)


def launch_group(args, *, stdin=None, stdout=None, stderr=None, env=None, cwd=None):
    """Linux: a child that ends with this process, as the Windows job object promises.

    The helper that owns the audio workers starts fixed programs only, so uv gets the
    kernel's parent-death signal instead. It follows the thread that started the child,
    which is the setup thread that also waits for it.
    """
    import ctypes
    prctl = ctypes.CDLL(None, use_errno=True).prctl
    prctl.argtypes = (ctypes.c_int,) + (ctypes.c_ulong,) * 4
    parent, death_signal, kill = os.getpid(), 1, int(signal.SIGKILL)  # PR_SET_PDEATHSIG

    def tie():
        # Between fork and exec. The parent may already be gone by now.
        if prctl(death_signal, kill, 0, 0, 0) != 0 or os.getppid() != parent:
            os._exit(127)

    return _Group(args, stdin=stdin, stdout=stdout, stderr=stderr, env=env, cwd=cwd,
                  start_new_session=True, preexec_fn=tie)


def launch(args, **options):
    return (launch_owned if target() == 'win32' else launch_group)(args, **options)


def source_entries(source):
    """The files of a GitHub archive, checked before anything is written (SEC-04).

    One top folder; relative paths without '..', drive letters, backslashes or control
    characters; no two names that differ only in case (they collide on Windows); regular
    files and folders only; no encryption; and the count, unpacked size and compression ratio
    within SOURCE_MAX_*. Returns (entry, path parts under the top folder) for each file.
    """
    entries = source.infolist()
    if len(entries) > SOURCE_MAX_ENTRIES:
        raise ValueError('source_too_large')
    files, names, top, total = [], set(), None, 0
    for entry in entries:
        name = entry.filename
        parts = PurePosixPath(name).parts
        if (not parts or name.startswith('/') or '..' in parts
                or re.search(r'[:\\\x00-\x1f\x7f]', name)):
            raise ValueError('source_path_unsafe')
        if top is None:
            top = parts[0]
        if parts[0] != top:
            raise ValueError('source_path_unsafe')
        key = '/'.join(parts).casefold()
        if key in names:
            raise ValueError('source_path_unsafe')
        names.add(key)
        kind = (entry.external_attr >> 16) & 0o170000
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or entry.flag_bits & 0x1:
            raise ValueError('source_entry_type')
        if entry.is_dir() or len(parts) == 1:
            continue
        total += entry.file_size
        if total > SOURCE_MAX_BYTES or entry.file_size > SOURCE_MAX_RATIO * max(entry.compress_size, 1):
            raise ValueError('source_too_large')
        files.append((entry, parts[1:]))
    return files


def unpack_source(archive, target):
    """A GitHub archive without its one top folder, after source_entries accepts all of it."""
    with zipfile.ZipFile(archive) as source:
        for entry, parts in source_entries(source):
            path = target.joinpath(*parts)
            path.parent.mkdir(parents=True, exist_ok=True)
            # zipfile reads no more than the entry's size and checks its CRC.
            with source.open(entry) as reader, path.open('wb') as writer:
                shutil.copyfileobj(reader, writer)


def unpack_members(archive, members, target):
    """Only the named regular files of a pinned archive, flat into target (zip, wheel or .tgz).

    The archive's hash is checked before this runs; a name that is missing or not a regular
    file refuses the whole archive.
    """
    def write(reader, name):
        if not re.fullmatch(r'[A-Za-z0-9_.+-]+', name):
            raise ValueError('source_path_unsafe')
        part = target / (name + '.part')
        with part.open('wb') as writer:
            shutil.copyfileobj(reader, writer)
        os.replace(part, target / name)

    target.mkdir(parents=True, exist_ok=True)
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as source:
            for member, name in members:
                try:
                    entry = source.getinfo(member)
                except KeyError:
                    raise ValueError('source_entry_type') from None
                kind = (entry.external_attr >> 16) & 0o170000
                if entry.is_dir() or kind not in (0, stat.S_IFREG) or entry.flag_bits & 0x1:
                    raise ValueError('source_entry_type')
                with source.open(entry) as reader:
                    write(reader, name)
        return
    with tarfile.open(archive, 'r:gz') as source:
        for member, name in members:
            try:
                entry = source.getmember(member)
            except KeyError:
                raise ValueError('source_entry_type') from None
            if not entry.isreg():
                raise ValueError('source_entry_type')
            with source.extractfile(entry) as reader:
                write(reader, name)


def apply_patch(root, text):
    """A unified diff whose context must match exactly. A Windows PC has no patch tool."""
    rows = text.split('\n')
    index = 0
    while index < len(rows):
        if not rows[index].startswith('+++ b/'):
            index += 1
            continue
        path = root / rows[index][6:].strip()
        data = path.read_bytes().decode('utf-8')
        newline = '\r\n' if '\r\n' in data else '\n'
        lines = data.split(newline)
        index += 1
        moved = 0
        while index < len(rows) and (match := HUNK.match(rows[index])):
            at = int(match[1]) - 1 + moved
            index += 1
            while index < len(rows) and rows[index][:1] in (' ', '+', '-', '\\'):
                kind, line = rows[index][:1], rows[index][1:]
                index += 1
                if kind == '\\':
                    continue
                if kind == '+':
                    lines.insert(at, line)
                    at, moved = at + 1, moved + 1
                    continue
                if at >= len(lines) or lines[at] != line:
                    raise ValueError('patch_mismatch')
                if kind == '-':
                    del lines[at]
                    moved -= 1
                else:
                    at += 1
        path.write_bytes(newline.join(lines).encode('utf-8'))


def _new_digest(size, sha256, blob):
    if blob and not sha256:
        return hashlib.sha1(f'blob {size}\0'.encode(), usedforsecurity=False)
    return hashlib.sha256()


def _file_digest(path, asset, check):
    digest = _new_digest(asset.size, asset.sha256, asset.blob)
    with path.open('rb') as stream:
        while block := stream.read(CHUNK):
            check()
            digest.update(block)
    return digest.hexdigest()


class RuntimeSetup:
    def __init__(self, root, *, transport=open_public, launcher=launch, entries=None, gpu_check=nvidia_driver):
        self.root = Path(root).expanduser().absolute()
        self._entries = None if entries is None else {runtime.id: runtime for runtime in entries}
        self.transport, self.launcher, self.gpu_check = transport, launcher, gpu_check
        self.lock = RLock()
        self.closing = Event()
        self.closed = False
        self.jobs = {}
        self.thread = self.cancel_event = self.response = self.child = None

    @property
    def entries(self):
        # Reading these needs the worker's files, so it waits until a setup page opens.
        if self._entries is None:
            self._entries = {runtime.id: runtime for runtime in runtimes()}
        return self._entries

    def folder(self, runtime):
        return self.root / runtime.id

    def _installed(self, runtime):
        folder = self.folder(runtime)
        try:
            receipt = json.loads((folder / 'receipt.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return False
        if not isinstance(receipt, dict) or receipt.get('version') != version_of(runtime):
            return False
        # What the worker refuses to start without, so a damaged runtime can be set up again.
        if runtime.kind == 'native':
            return (all((folder / 'lib' / name).is_file() for item in runtime.libraries for _, name in item.members)
                    and all((folder / 'assets' / asset.path).is_file() for asset in runtime.assets))
        return (runtime_python(folder).is_file()
                and (folder / 'engine').is_dir() and (folder / 'assets').is_dir())

    def catalog(self):
        rows = []
        gpu = self.gpu_check() if self.entries else False
        for runtime in self.entries.values():
            rows.append(dict(id=runtime.id, name=runtime.name, version=version_of(runtime), license=runtime.license,
                             licenses=list(runtime.licenses), notice=runtime.notice, download_bytes=runtime.download_bytes,
                             disk_bytes=runtime.disk_bytes, destination=str(self.folder(runtime)), gpu_ready=gpu))
        return {'runtimes': rows}

    def state(self):
        with self.lock:
            return {'observation_id': str(time.monotonic_ns()), 'jobs': {key: dict(job) for key, job in self.jobs.items()},
                    'installed': {runtime.id: str(self.folder(runtime)) for runtime in self.entries.values()
                                  if self._installed(runtime)}}

    def start(self, request):
        if not isinstance(request, dict) or set(request) != {'id', 'consent', 'version'}:
            raise ValueError('vc_runtime_request_invalid')
        if request['consent'] is not True:
            raise ValueError('consent_required')
        runtime = self.entries.get(request['id']) if isinstance(request['id'], str) else None
        if runtime is None or request['version'] != version_of(runtime):
            raise ValueError('vc_runtime_changed')
        with self.lock:
            if self.closed or self.closing.is_set():
                raise ValueError('vc_runtime_closed')
            if any(job['phase'] in ACTIVE for job in self.jobs.values()):
                raise ValueError('vc_runtime_busy')
            event = Event()
            self.jobs[runtime.id] = dict(job_id=uuid4().hex, phase='queued', step=0, steps=len(steps_of(runtime)), received_bytes=0,
                                         total_bytes=0, error_code=None, path=None)
            self.cancel_event = event
            self.thread = Thread(target=self._install, args=(runtime, event, self.thread), daemon=True, name='vc-runtime-setup')
            self.thread.start()
            return self.state()

    def cancel(self, id, job_id):
        with self.lock:
            job = self.jobs.get(id)
            if job is None or job['job_id'] != job_id:
                raise ValueError('stale_job')
            if job['phase'] in ACTIVE:
                self.cancel_event.set()
                job['phase'] = 'cancelling'
                self._interrupt()
            return self.state()

    def _interrupt(self):
        if self.response is not None and hasattr(self.response, 'abort'):
            self.response.abort()
        if self.child is not None:
            self.child.kill()

    def _checkpoint(self, event):
        if event.is_set() or self.closing.is_set():
            raise Cancelled()

    def _fetch(self, url, target, event, job=None, *, size=None, sha256='', blob='', limit=None):
        part = target.with_name(target.name + '.part')
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = _new_digest(size, sha256, blob)
        received = 0
        with self.transport(url, hosts=SOURCE_HOSTS) as response, part.open('wb') as output:
            with self.lock:
                self.response = response
                self._checkpoint(event)
            while block := response.read(CHUNK):
                self._checkpoint(event)
                received += len(block)
                if received > (size if size is not None else limit):
                    raise ValueError('size_mismatch')
                output.write(block)
                digest.update(block)
                if job is not None:
                    with self.lock:
                        job['received_bytes'] += len(block)
        with self.lock:
            self.response = None
        if (size is not None and received != size) or digest.hexdigest() != (sha256 or blob or digest.hexdigest()):
            part.unlink(missing_ok=True)
            raise ValueError('hash_mismatch')
        os.replace(part, target)

    def _uv(self):
        return self.root / f'.uv-{UV_VERSION}' / ('uv.exe' if target() == 'win32' else 'uv')

    def _run(self, runtime, event, args):
        folder = self.folder(runtime)
        env = external_process_env()
        env.pop('VIRTUAL_ENV', None)
        env.update(UV_CACHE_DIR=str(folder / '.cache'), UV_PYTHON_INSTALL_DIR=str(folder / 'python'), UV_NO_PROGRESS='1')
        with (folder / 'setup.log').open('ab') as log:
            child = self.launcher([str(value) for value in args], stdin=subprocess.DEVNULL, stdout=log,
                                  stderr=subprocess.STDOUT, env=env, cwd=str(folder))
            with self.lock:
                self.child = child
            try:
                while True:
                    try:
                        code = child.wait(.2)
                        break
                    except subprocess.TimeoutExpired:
                        if event.is_set() or self.closing.is_set():
                            child.kill()
                            child.wait()
                            raise Cancelled() from None
            finally:
                with self.lock:
                    self.child = None
        self._checkpoint(event)
        if code:
            raise ValueError('step_failed')

    def _tools(self, runtime, event, job):
        uv, tool = self._uv(), UV[target()]
        if uv.is_file():
            return
        packed = tool.url.endswith('.zip')
        archive, part = uv.with_name('uv.zip' if packed else 'uv.tar.gz'), uv.with_name('uv.part')
        self._fetch(tool.url, archive, event, size=tool.size, sha256=tool.sha256)
        if packed:
            with zipfile.ZipFile(archive) as source:
                part.write_bytes(source.read(tool.member))
        else:
            with tarfile.open(archive, 'r:gz') as source, source.extractfile(tool.member) as reader:
                part.write_bytes(reader.read())
            part.chmod(0o700)  # Only this user runs it.
        os.replace(part, uv)
        archive.unlink()

    def _python(self, runtime, event, job):
        self._run(runtime, event, [self._uv(), 'venv', '--no-config', '--managed-python', '--clear',
                                   '--python', runtime.python, self.folder(runtime) / 'venv'])

    def _packages(self, runtime, event, job):
        python = runtime_python(self.folder(runtime))
        for path, index in runtime.locks:
            args = [self._uv(), 'pip', 'install', '--no-config', '--python', python, '--require-hashes']
            self._run(runtime, event, args + (['--index-url', index] if index else []) + ['-r', worker_file(path)])

    def _engine(self, runtime, event, job):
        folder = self.folder(runtime)
        archive, staging, target = folder / 'engine.zip', folder / 'engine.part', folder / 'engine'
        expected = SOURCE_TREE_DIGESTS.get(runtime.source_url)
        if not expected:
            raise ValueError('source_unpinned')
        shutil.rmtree(staging, ignore_errors=True)
        self._fetch(runtime.source_url, archive, event, limit=SOURCE_LIMIT)
        try:
            unpack_source(archive, staging)
            if runtime.patch:
                apply_patch(staging, worker_file(runtime.patch).read_text(encoding='utf-8'))
            # Every file, then the .py files the worker checks again (SEC-04).
            if tree_digest(staging) != expected or source_digest(staging) != runtime.source_digest:
                raise ValueError('hash_mismatch')
        except Exception:
            # Nothing of a refused archive stays on disk.
            shutil.rmtree(staging, ignore_errors=True)
            archive.unlink(missing_ok=True)
            raise
        shutil.rmtree(target, ignore_errors=True)
        os.replace(staging, target)
        archive.unlink()

    def _libraries(self, runtime, event, job):
        """Each pinned archive in turn: fetched, checked, its files taken, then deleted, so
        only one archive is on disk at a time. A resumed setup skips finished archives."""
        folder = self.folder(runtime)
        staging, target, downloads = folder / 'lib.part', folder / 'lib', folder / 'downloads'
        record = staging / '.archives.json'
        with self.lock:
            job['total_bytes'] = sum(item.size for item in runtime.libraries)
        staging.mkdir(parents=True, exist_ok=True)
        try:
            done = json.loads(record.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            done = []
        if not isinstance(done, list):
            done = []
        for item in runtime.libraries:
            self._checkpoint(event)
            if item.sha256 in done:
                with self.lock:
                    job['received_bytes'] += item.size
                continue
            archive = downloads / PurePosixPath(urlsplit(item.url).path).name
            asset = Asset(item.url, '', item.size, item.sha256)
            if (archive.is_file() and archive.stat().st_size == item.size
                    and _file_digest(archive, asset, lambda: self._checkpoint(event)) == item.sha256):
                with self.lock:
                    job['received_bytes'] += item.size
            else:
                self._fetch(item.url, archive, event, job, size=item.size, sha256=item.sha256)
            unpack_members(archive, item.members, staging)
            archive.unlink()
            done.append(item.sha256)
            record.write_text(json.dumps(done), encoding='utf-8')
        record.unlink()
        shutil.rmtree(target, ignore_errors=True)
        os.replace(staging, target)
        shutil.rmtree(downloads, ignore_errors=True)

    def _assets(self, runtime, event, job):
        with self.lock:
            job['total_bytes'] = sum(asset.size for asset in runtime.assets)
        for asset in runtime.assets:
            target = self.folder(runtime) / 'assets' / asset.path
            if (target.is_file() and target.stat().st_size == asset.size
                    and _file_digest(target, asset, lambda: self._checkpoint(event)) == (asset.sha256 or asset.blob)):
                with self.lock:
                    job['received_bytes'] += asset.size
                continue
            self._fetch(asset.url, target, event, job, size=asset.size, sha256=asset.sha256, blob=asset.blob)

    def _verifying(self, runtime, event, job):
        if runtime.kind == 'native':
            # The worker loads the libraries and runs one operation on the GPU.
            self._run(runtime, event, [native_worker(), '--runtime', self.folder(runtime), '--probe'])
            return
        self._run(runtime, event, [runtime_python(self.folder(runtime)), '-c', CUDA_CHECK])

    def _install(self, runtime, event, previous=None):
        if previous is not None:
            previous.join()
        job = self.jobs[runtime.id]
        folder = self.folder(runtime)
        marker = folder / '.steps.json'
        version = version_of(runtime)
        lease = RootLease(self.root)
        terminal, step = None, steps_of(runtime)[0]
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            lease.acquire()
            folder.mkdir(exist_ok=True)
            if runtime.kind != 'native':
                self._uv().parent.mkdir(exist_ok=True)
            try:
                finished = json.loads(marker.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                finished = {}
            if not isinstance(finished, dict) or finished.get('version') != version:
                finished = {'version': version, 'steps': []}
            if not finished['steps'] and shutil.disk_usage(self.root).free < runtime.disk_bytes:
                raise OSError(errno.ENOSPC, 'space')
            for number, step in enumerate(steps_of(runtime), 1):
                self._checkpoint(event)
                with self.lock:
                    if job['phase'] != 'cancelling':
                        job.update(phase=step, step=number, received_bytes=0, total_bytes=0)
                if step in finished['steps']:
                    continue
                getattr(self, '_' + step)(runtime, event, job)
                finished['steps'].append(step)
                marker.write_text(json.dumps(finished), encoding='utf-8')
            self._checkpoint(event)
            (folder / 'receipt.json').write_text(json.dumps({'version': version, 'id': runtime.id}), encoding='utf-8')
            # Steps resume a setup, not a finished runtime: a repair must run them again.
            marker.unlink(missing_ok=True)
            shutil.rmtree(folder / '.cache', ignore_errors=True)
            terminal = dict(phase='ready', path=str(folder), error_code=None)
        except Cancelled:
            terminal = dict(phase='cancelled')
        except Exception as error:
            code = STEP_ERRORS[step]
            if str(error) == 'download_busy':
                code = 'vc_runtime_busy'
            elif isinstance(error, OSError) and error.errno == errno.ENOSPC:
                code = 'vc_runtime_space'
            terminal = (dict(phase='cancelled') if event.is_set() or self.closing.is_set()
                        else dict(phase='failed', error_code=code))
        finally:
            lease.close()
            with self.lock:
                self.response = self.child = None
                job.update(terminal or dict(phase='failed', error_code='vc_runtime_failed'))

    def request_close(self):
        """Signal cancellation without waiting for a worker."""
        self.closing.set()
        event = self.cancel_event
        if event is not None:
            event.set()

    def close(self, timeout=2):
        deadline = time.monotonic() + max(0, timeout)
        self.request_close()
        if not self.lock.acquire(timeout=max(0, timeout)):
            return False
        try:
            self.closed = True
            self._interrupt()
            thread = self.thread
        finally:
            self.lock.release()
        if thread is not None:
            thread.join(max(0, deadline - time.monotonic()))
        return thread is None or not thread.is_alive()
