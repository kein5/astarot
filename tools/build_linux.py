"""Build an unpublished Linux x86_64 tar.gz candidate: the app and its `_internal` folder.

The app runs the Rust backend core in its own process; no Python is frozen or shipped.
`_internal` holds what tools/app_resources.py lists for Linux: both pinned speech.cpp builds
(the Vulkan build in build/speechcpp, the CPU build in build/speechcpp-cpu; the user chooses in
the settings which one runs), the RVC worker, the audio and capture helpers, the PipeWire
configuration and the license texts. No models are fetched by this tool.
System dependencies are documented in docs/voice-stack/linux-build-pipeline.md.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

try:
    from .app_resources import stage as stage_resources
    from .linux_package import check_tree, inventory, normalize_modes, pack
    from .speechcpp_bundle import stage_bundle, fetch_archive, load_manifest, verify_bundle
    from .runtime_libraries import stage as stage_runtime_libraries
except ImportError:
    from app_resources import stage as stage_resources
    from linux_package import check_tree, inventory, normalize_modes, pack
    from speechcpp_bundle import stage_bundle, fetch_archive, load_manifest, verify_bundle
    from runtime_libraries import stage as stage_runtime_libraries

ROOT = Path(__file__).resolve().parents[1]


def prepare_work(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('dedicated build directory must not be a symlink')
    work = path.resolve()
    marker = work / '.vrct-linux-build'
    if work == ROOT or work in ROOT.parents or work.is_relative_to(ROOT / 'src-tauri'):
        raise ValueError('choose a dedicated build directory')
    if work.exists() and any(work.iterdir()) and (not marker.is_file() or marker.read_text() != 'VRCT-VOX Linux staging v1\n'):
        raise ValueError('refusing an existing nonempty directory: choose a dedicated build directory')
    work.mkdir(parents=True, exist_ok=True)
    marker.write_text('VRCT-VOX Linux staging v1\n')
    return work


def run(argv, *, cwd=ROOT, env=None):
    print('+ ' + ' '.join(map(str, argv)), flush=True)
    subprocess.run(list(map(str, argv)), cwd=cwd, env=env, check=True)


# The crates under native/ that src-tauri depends on by path: the backend core (#285) and the
# crates it uses. tests/devtools/test_build_linux.py keeps this list equal to the path
# dependencies of those Cargo.toml files.
# translate-onnx is an optional dependency of the core (feature onnx-translation, off), but Cargo
# reads its manifest to resolve the core, so it is copied too.
APP_CRATES = ('core', 'adapters', 'app-identity', 'audio-routing', 'ocr-runtime', 'onnx-runtime', 'openvr-client', 'ops', 'speech-server',
              'transcription', 'translation', 'translate-onnx', 'tts', 'voice-conversion', 'vr-overlay')
# Files outside those crates that they read at compile time (include_str!), at the same path in
# the workspace: native/vr-overlay checks its layout against the VR page's.
# tests/devtools/test_build_linux.py keeps this list equal to what the crates include.
CRATE_INPUTS = ('src-ui/views/vr/vr_layout.json',)


def tauri_workspace(work, internal):
    workspace = work / 'workspace'
    tauri = workspace / 'src-tauri'
    tauri.mkdir(parents=True, exist_ok=True)
    for name in ('Cargo.toml', 'Cargo.lock', 'build.rs', 'tauri.conf.json'):
        shutil.copyfile(ROOT / 'src-tauri' / name, tauri / name)
    for name in ('src', 'icons', 'capabilities'):
        if (tauri / name).exists():
            shutil.rmtree(tauri / name)
        shutil.copytree(ROOT / 'src-tauri' / name, tauri / name)
    # The app links the backend core and the crates it uses by path (src-tauri/Cargo.toml).
    for name in APP_CRATES:
        crate = workspace / 'native' / name
        if crate.exists():
            shutil.rmtree(crate)
        shutil.copytree(ROOT / 'native' / name, crate, ignore=shutil.ignore_patterns('target'))
    for name in CRATE_INPUTS:
        (workspace / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, workspace / name)
    shutil.copyfile(ROOT / 'LICENSE', workspace / 'LICENSE')
    (workspace / 'tools').mkdir(exist_ok=True)
    for name in ('check_voice_distribution.py', 'distribution_policy.py', 'linux_package.py'):
        shutil.copyfile(ROOT / 'tools' / name, workspace / 'tools' / name)
    if (workspace / 'dist').exists():
        shutil.rmtree(workspace / 'dist')
    shutil.copytree(ROOT / 'dist', workspace / 'dist')
    binary = tauri / 'bin'
    if binary.exists():
        shutil.rmtree(binary)
    binary.mkdir()
    # tauri.conf.json maps bin/_internal to the app's _internal folder.
    shutil.copytree(internal, binary / '_internal', symlinks=True)
    config = json.loads((tauri / 'tauri.conf.json').read_text())
    config['bundle']['targets'] = []
    # Nothing runs beside the app any more; a stale entry would name a missing binary.
    config['bundle'].pop('externalBin', None)
    config['bundle'].pop('windows', None)
    (tauri / 'tauri.conf.json').write_text(json.dumps(config, indent=2))
    return workspace




# Shipped in _internal/docs for users of the tar.gz, who have no installer to explain the setup.
SHIPPED_DOCS = ('local-setup-linux.md', 'licensing.md', 'linux-build-pipeline.md')

# Both speech.cpp builds ship in one package, each in its own folder of _internal/build
# (app_resources.SPEECH_BUNDLES): (pinned variant, folder).
SPEECH_BUILDS = (('linux-x64-vulkan', 'speechcpp'), ('linux-x64-cpu', 'speechcpp-cpu'))
# The package's own name part: one package per architecture, with both builds.
PACKAGE_VARIANT = 'linux-x64'


def speech_archives(manifest, directory):
    """{variant: path of its pinned archive in `directory`} for both builds."""
    return {variant: Path(directory) / manifest['assets'][variant]['name'] for variant, _ in SPEECH_BUILDS}


def stage_internal(work, archives, *, offline=False, download=False):
    """Builds the helpers and returns the staged `_internal` folder (tools/app_resources.py).

    `archives` maps each variant of SPEECH_BUILDS to its pinned speech.cpp archive."""
    build = work / 'build'
    if build.exists():
        shutil.rmtree(build)
    build.mkdir()
    run([sys.executable, ROOT / 'tools/build_voice_gate.py', '--output-dir', build])
    run([sys.executable, ROOT / 'tools/build_rvc_worker.py', '--output-dir', build,
         '--target-dir', work / 'cargo-rvc', *(['--offline'] if offline else [])])
    # The license texts of the Rust crates in vrct-vox and the worker (NOTICE.md).
    run([sys.executable, ROOT / 'tools/rust_licenses.py', '--output', build / 'licenses/rust',
         '--platform', 'linux', *(['--offline'] if offline else [])])
    manifest = load_manifest()
    for variant, folder in SPEECH_BUILDS:
        archive = archives[variant]
        if download and not archive.exists():
            fetch_archive(manifest['assets'][variant], archive)
        stage_bundle(archive, build / folder, manifest['assets'][variant])
        verify_bundle(build / folder)
    # ONNX Runtime and the OpenVR client library, pinned like the engine binaries (issue #509).
    stage_runtime_libraries('linux', build, download=download)
    internal = work / 'internal'
    missing = stage_resources(internal, 'linux', build=build)
    if missing:
        raise ValueError(f'Missing from the Linux _internal folder: {", ".join(missing)}')
    (internal / 'docs').mkdir()
    for name in SHIPPED_DOCS:
        shutil.copyfile(ROOT / 'docs/voice-stack' / name, internal / 'docs' / name)
    check_tree(internal)
    return internal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=Path, default=ROOT / 'build/linux')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'build/linux/artifacts')
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--speech-archive-dir', type=Path,
                        help='a folder holding both pinned speech.cpp archives under their release names')
    source.add_argument('--download-speech', action='store_true', help='fetch only the pinned engine binaries and runtime libraries, never weights')
    parser.add_argument('--profile', choices=('debug', 'release'), default='release')
    parser.add_argument('--resources-only', action='store_true',
                        help='stage and inspect _internal only; no distributable is produced')
    parser.add_argument('--offline', action='store_true', help='use cached npm/Cargo dependencies')
    parser.add_argument('--appimage', action='store_true', help='also package/inspect an AppImage candidate')
    parser.add_argument('--download-appimage-tools', action='store_true', help='fetch pinned build tools for --appimage')
    args = parser.parse_args()
    if sys.platform != 'linux' or platform.machine() not in ('x86_64', 'AMD64'):
        parser.error('Linux x86_64 required (no cross compilation)')
    if not (args.speech_archive_dir or args.download_speech):
        parser.error('--speech-archive-dir or explicit --download-speech is required')
    work = prepare_work(args.work_dir)
    archives = speech_archives(load_manifest(), args.speech_archive_dir.resolve() if args.speech_archive_dir else work)
    internal = stage_internal(work, archives, offline=args.offline, download=args.download_speech)
    if args.resources_only:
        print(f'Staged _internal ready: {internal}')
        return
    run(['npm', 'ci', '--ignore-scripts', *(['--offline'] if args.offline else [])])
    run(['npm', 'run', 'vite-build'])
    workspace = tauri_workspace(work, internal)
    env = dict(os.environ, VRCT_LINUX_BUNDLE='1', CARGO_TARGET_DIR=str(work / 'cargo'))
    env.setdefault('CARGO_BUILD_JOBS', '4')
    if args.offline:
        env['CARGO_NET_OFFLINE'] = 'true'
    # A debug candidate still embeds the production frontend, not a Vite URL.
    env['CARGO_PROFILE_DEV_DEBUG_ASSERTIONS'] = 'false'
    run([ROOT / 'node_modules/.bin/tauri', 'build', '--no-bundle',
         *(['--debug'] if args.profile == 'debug' else []), '--', '--locked'], cwd=workspace, env=env)
    candidate = work / 'candidate/VRCT-VOX'
    if candidate.exists():
        shutil.rmtree(candidate)
    candidate.mkdir(parents=True)
    shutil.copytree(internal, candidate / '_internal', symlinks=True)
    shutil.copy2(work / 'cargo' / args.profile / 'vrct-vox', candidate / 'vrct-vox')
    normalize_modes(candidate)
    check_tree(candidate, require_runtime=True)
    for _, folder in SPEECH_BUILDS:
        verify_bundle(candidate / '_internal/build' / folder)
    version = json.loads((ROOT / 'package.json').read_text())['version']
    report = {'schema': 1, 'version': version, 'profile': args.profile, 'variant': PACKAGE_VARIANT,
              'speech_builds': [variant for variant, _ in SPEECH_BUILDS],
              'platform': platform.platform(), 'libc': platform.libc_ver(),
              'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT)),
              'files': inventory(candidate),
              'limitations': ['Not a license clearance; review all native-library and dependency obligations before publication.',
                              'No Windows validation; Linux ABI requirements depend on the recorded build host.']}
    (candidate / 'build-manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    (candidate / 'build-manifest.json').chmod(0o644)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output_dir / f'VRCT-VOX-{version}-{PACKAGE_VARIANT}-{args.profile}.tar.gz'
    pack(candidate, output)
    shutil.copyfile(candidate / 'build-manifest.json', output.with_suffix('').with_suffix('.manifest.json'))
    print(f'Unpublished candidate: {output.resolve()}')
    if args.appimage:
        run([sys.executable, ROOT / 'tools/build_appimage.py', '--candidate', candidate,
             '--work-dir', work / 'appimage', '--tools-dir', work / 'appimage-tools',
             '--output-dir', args.output_dir,
             *(['--download-tools'] if args.download_appimage_tools else [])])


if __name__ == '__main__':
    main()
