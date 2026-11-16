"""RVC: the bundled Rust worker (vrct-rvc-worker) with a runtime set up after consent.

The worker speaks the same pipe contract as before (protocol.py). It loads ONNX Runtime,
the CUDA libraries and the two fixed networks from the runtime folder; the voice model
and index are the user's files, read only.
"""
import os
from pathlib import Path
import subprocess
import sys
from threading import get_native_id

from runtime_paths import resource_root, voice_worker_env
from models.owned_child import launch_owned
from .process import VCProcess
from .settings import start_options

ROOT = resource_root()
HELPER = ROOT / 'build/vrct-vc-worker'
ORT_LIBRARY = 'onnxruntime.dll' if sys.platform == 'win32' else 'libonnxruntime.so'
# What the worker reads from the runtime folder besides lib/.
ASSETS = ('hubert_base/config.json', 'hubert_base/pytorch_model.bin', 'rmvpe/rmvpe.onnx')


def worker_binary():
    """Built into build/ next to the other voice helpers (tools/build_rvc_worker.py)."""
    return ROOT / 'build' / ('vrct-rvc-worker.exe' if sys.platform == 'win32' else 'vrct-rvc-worker')


def runtime_complete(runtime):
    """The files the worker refuses to start without. A runtime of the earlier Python
    kind (venv, engine) has none of lib/ and must be set up again."""
    runtime = Path(runtime)
    return ((runtime / 'lib' / ORT_LIBRARY).is_file()
            and all((runtime / 'assets' / name).is_file() for name in ASSETS))


def _arguments(runtime, options, session):
    return ['--runtime', str(runtime), '--model', options['model'], '--session', session,
            '--index', options['index'], '--pitch', str(options['pitch']),
            '--index-rate', str(options['index_rate'])]


def _launch(runtime, options, session):
    if sys.platform == 'win32':
        # A kill-on-close job holds the worker's lifetime.
        return launch_owned([str(worker_binary()), *_arguments(runtime, options, session)],
                            env=voice_worker_env(), cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, realtime=True)
    # The Linux helper ties the worker to this thread and builds the same arguments.
    owner = os.pidfd_open(get_native_id(), os.O_EXCL)
    try:
        return subprocess.Popen([str(HELPER), str(os.getpid()), str(owner), str(worker_binary()), 'rvc-native',
            str(runtime), options['model'], session, options['index'], str(options['pitch']),
            str(options['index_rate'])], env=voice_worker_env(), cwd=ROOT, pass_fds=(owner,),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
    finally:
        os.close(owner)


class RVCProcess(VCProcess):
    def __init__(self, options, monitor=None, output=None):
        self.options = start_options('converted', options)
        if self.options.get('engine') != 'rvc':
            raise ValueError('vc_options_invalid')
        if not worker_binary().is_file():
            raise ValueError('vc_engine_unavailable')
        self.runtime = Path(options['runtime']).expanduser().resolve()
        for key in ('model', 'index'):
            if self.options[key]:
                path = Path(self.options[key]).expanduser().resolve()
                if not path.is_file():
                    raise ValueError('vc_runtime_missing')
                self.options[key] = str(path)
        if not runtime_complete(self.runtime):
            raise ValueError('vc_runtime_missing')
        super().__init__(engine='rvc', monitor=monitor, output=output)

    def _launch_worker(self):
        return _launch(self.runtime, self.options, self._session)
