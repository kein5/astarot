"""Build the bundled RVC worker (native/rvc-runtime, vrct-rvc-worker) into build/.

The worker loads ONNX Runtime and the CUDA libraries at run time from the runtime folder
the user sets up after consent (src-python/models/voice_conversion/runtime_setup.py), so
this build downloads no ONNX Runtime and links none.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CRATE = ROOT / 'native/rvc-runtime'
NAME = 'vrct-rvc-worker' + ('.exe' if sys.platform == 'win32' else '')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'build')
    parser.add_argument('--target-dir', type=Path, help='cargo target directory (default: the crate\'s)')
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args(argv)
    target = (args.target_dir or CRATE / 'target').resolve()
    command = ['cargo', 'build', '--release', '--locked', '--manifest-path', str(CRATE / 'Cargo.toml'),
               '--no-default-features', '--features', 'worker', '--bin', 'vrct-rvc-worker',
               '--target-dir', str(target), *(['--offline'] if args.offline else [])]
    print('+ ' + ' '.join(command), flush=True)
    subprocess.run(command, check=True, env=dict(os.environ))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    destination = args.output_dir / NAME
    shutil.copy2(target / 'release' / NAME, destination)
    print(destination)


if __name__ == '__main__':
    main()
