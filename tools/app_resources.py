"""The files the app ships in its `_internal` folder, now that no Python backend is frozen.

The Rust core and the app find them with native/core/src/resources.rs: `_internal` beside the
binary, or `usr/lib/vrct-vox/_internal` in the Linux packages. The folder keeps the name of the
PyInstaller resources, so the Windows installer's update step, which replaces `_internal` as a
whole, also removes the Python runtime of an older version.

    python tools/app_resources.py stage --output src-tauri/bin/_internal
    python tools/app_resources.py check src-tauri/bin/_internal
    python tools/app_resources.py stage --allow-missing    # development: tauri dev needs the folder

`stage` copies from the build folder (build/speechcpp from speechcpp_bundle.py, the RVC worker
from build_rvc_worker.py, the Rust license texts from rust_licenses.py, the Linux helpers from
build_voice_gate.py) and the repository (LICENSE, NOTICE.md, the NScurl notices). It downloads
nothing. `check` lists what a package needs and is missing.
"""
import argparse
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]

# Linux helper programs (build_voice_gate.py) the backend and the app start; staged when present.
LINUX_HELPERS = ('vrct-voice-gate', 'vrct-source-bridge', 'vrct-vc-worker', 'vrct-asr-capture', 'vrct-screen-capture')


def _exe(name, platform):
    return f'{name}.exe' if platform == 'windows' else name


def required(platform):
    """The paths inside `_internal` a package of `platform` cannot do without."""
    names = [f'build/speechcpp/{_exe("speech", platform)}', 'build/speechcpp/bundle.json',
             f'build/{_exe("vrct-rvc-worker", platform)}',
             'licenses/VRCT/LICENSE', 'licenses/VRCT/NOTICE.md', 'licenses/rust/crates.json']
    if platform == 'windows':
        names.append('licenses/nscurl/LICENSE.md')
    else:
        names += [f'build/{name}' for name in LINUX_HELPERS]
    return names


def pairs(platform, build=ROOT / 'build', root=ROOT):
    """(source file, path inside `_internal`) for everything `stage` copies."""
    build, root = Path(build), Path(root)
    result = [(root / 'LICENSE', 'licenses/VRCT/LICENSE'), (root / 'NOTICE.md', 'licenses/VRCT/NOTICE.md')]
    rust = build / 'licenses/rust'
    if rust.is_dir():
        result += [(file, f'licenses/rust/{file.relative_to(rust).as_posix()}')
                   for file in sorted(rust.rglob('*')) if file.is_file()]
    bundle = build / 'speechcpp'
    if bundle.is_dir():
        result += [(file, f'build/speechcpp/{file.name}') for file in sorted(bundle.iterdir()) if file.is_file()]
        notices = bundle / 'notices'
        if notices.is_dir():
            result += [(file, f'build/speechcpp/notices/{file.name}') for file in sorted(notices.iterdir()) if file.is_file()]
    helpers = ['vrct-rvc-worker'] + (list(LINUX_HELPERS) if platform == 'linux' else [])
    for name in helpers:
        file = build / _exe(name, platform)
        if file.is_file():
            result.append((file, f'build/{file.name}'))
    if platform == 'windows':
        nscurl = root / 'src-tauri/nsis/licenses/nscurl'
        result += [(file, f'licenses/nscurl/{file.name}') for file in sorted(nscurl.iterdir()) if file.is_file()]
    else:
        pipewire = root / 'config/pipewire'
        if pipewire.is_dir():
            result += [(file, f'config/pipewire/{file.relative_to(pipewire).as_posix()}')
                       for file in sorted(pipewire.rglob('*')) if file.is_file()]
    return result


def missing(internal, platform):
    internal = Path(internal)
    return [name for name in required(platform) if not (internal / name).is_file()]


def stage(output, platform, build=ROOT / 'build', root=ROOT):
    """Replaces `output` with the staged files and returns what is still missing."""
    output = Path(output)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for source, name in pairs(platform, build, root):
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return missing(output, platform)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--platform', choices=('windows', 'linux'),
                        default='windows' if sys.platform == 'win32' else 'linux')
    commands = parser.add_subparsers(dest='command', required=True)
    staging = commands.add_parser('stage', help='copy the shipped files into a fresh folder')
    staging.add_argument('--output', type=Path, default=ROOT / 'src-tauri/bin/_internal')
    staging.add_argument('--build-dir', type=Path, default=ROOT / 'build')
    staging.add_argument('--allow-missing', action='store_true',
                         help='development: report what is missing but succeed (a debug build reads build/ in the checkout)')
    checking = commands.add_parser('check', help='list what a staged folder lacks')
    checking.add_argument('internal', type=Path)
    args = parser.parse_args(argv)
    if args.command == 'stage':
        absent = stage(args.output, args.platform, args.build_dir)
    else:
        absent = missing(args.internal, args.platform)
    if absent:
        print(f'Missing from {args.platform} _internal: {", ".join(absent)}', file=sys.stderr)
        return 0 if getattr(args, 'allow_missing', False) else 1
    print(f'{args.platform} _internal complete')
    return 0


if __name__ == '__main__':
    sys.exit(main())
