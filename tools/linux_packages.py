"""Build .deb and .rpm packages from a checked Linux candidate directory (ASTAROT/).

    python tools/linux_packages.py --candidate build/linux/candidate/ASTAROT --output-dir build/linux/artifacts

The packages hold the same files as the release tar.gz. They install them read-only under
/opt/astarot, add the command /usr/bin/astarot, a desktop entry, an icon and the license notices,
and declare what the tar.gz needs from the host: glibc, GTK 3 and WebKitGTK 4.1 (with what they pull
in). The app runs the backend core in its own process and links the host's libpipewire, which is
required; _internal holds no Python runtime. One package carries both speech.cpp builds: the
Vulkan build loads libvulkan.so.1 from the system, not from _internal, and the CPU build needs no
Vulkan at all, so the Vulkan loader is recommended, not required (decision 48 in
docs/voice-stack/core-integration.md): without it the GPU choices are unavailable and "auto" runs
on the CPU build. The PipeWire tools are recommended: managed audio routing runs them, and so
are the Mesa Vulkan drivers. The lowest glibc comes from the candidate's build-manifest.json.
Settings and models stay in the user's XDG folders.

The package is astarot from 0.7.0. It replaces vrct-vox, the package up to 0.6.x, which put the
same files under /opt/vrct-vox (ADR-014, 2.7): the deb conflicts with, replaces and provides it, and
the rpm obsoletes and provides it, so that installing the file of a new version removes the old
package and the app list shows ASTAROT once. The command of 0.6.x, /usr/bin/vrct-vox, stays as a
second command for a while (LEGACY_COMMAND_UNTIL).

`package-manager` beside the binary names the package format, so the app knows that updates
come from the package manager and never replaces itself (self-update, 0.3.0).
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
NAME = 'astarot'
PREFIX = Path('opt/astarot')
# The package up to 0.6.x, which this one replaces.
LEGACY_NAME = 'vrct-vox'
# The command up to 0.6.x starts the same executable in the packages before this version, and
# goes from this one on (ADR-014, 8.2 and 2.11). The period is decided here only.
LEGACY_COMMAND = 'vrct-vox'
LEGACY_COMMAND_UNTIL = (0, 8, 0)
SUMMARY = 'Speech recognition, speech, voice conversion and translated chat for VRChat'
# The display name. NAME, PREFIX and the file names are the lower-case identifier (ADR-014, 2.2).
DISPLAY_NAME = 'ASTAROT'
DESCRIPTION = (f'{DISPLAY_NAME} translates and speaks your chat and voice in VRChat, with speech '
               'recognition, text to speech, voice conversion and chat reading.')
MAINTAINER = f'{DISPLAY_NAME} maintainers <https://github.com/kein5/astarot/issues>'
HOMEPAGE = 'https://github.com/kein5/astarot'
# Debian and Fedora names of what the tar.gz needs from the host.
# The app links libpipewire-0.3.so.0 itself (the core's audio devices, #285), so the library is
# required; the PipeWire tools stay recommended.
DEB_DEPENDS = ['libwebkit2gtk-4.1-0', 'libgtk-3-0t64 | libgtk-3-0', 'libpipewire-0.3-0t64 | libpipewire-0.3-0']
DEB_RECOMMENDS = ['pipewire-bin']
RPM_REQUIRES = ['webkit2gtk4.1', 'gtk3', 'pipewire-libs']
RPM_RECOMMENDS = ['pipewire-utils']
# The Vulkan build's loader and a driver for the GPU; both recommended, since the CPU build in
# the same package runs without them.
VULKAN = {'deb': ('libvulkan1', 'mesa-vulkan-drivers'), 'rpm': ('vulkan-loader', 'mesa-vulkan-drivers')}
# The candidate's build-manifest.json: one package per architecture with both speech.cpp builds.
PACKAGE_VARIANT = 'linux-x64'
SPEECH_BUILDS = ['linux-x64-cpu', 'linux-x64-vulkan']
# /usr/bin/astarot, the command the desktop entry starts (Exec=astarot, as in the AppImage), and
# while it stays, /usr/bin/vrct-vox, the command up to 0.6.x, start the same executable.
WRAPPER = '#!/bin/sh\nexec /opt/astarot/astarot "$@"\n'
VERSION = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(beta\.[1-9][0-9]*))?')


def package_version(version):
    """1.2.3-beta.4 -> 1.2.3~beta.4: dpkg and rpm sort a tilde before the release itself."""
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError('Expected a version X.Y.Z or X.Y.Z-beta.N')
    return version.replace('-', '~', 1)


def keeps_legacy_command(version):
    """Whether the packages of `version` still carry /usr/bin/vrct-vox. A prerelease goes with its
    release: 0.8.0-beta.1 drops it as 0.8.0 does."""
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError('Expected a version X.Y.Z or X.Y.Z-beta.N')
    return tuple(int(part) for part in match.groups()[:3]) < LEGACY_COMMAND_UNTIL


def commands(version):
    """The commands in /usr/bin, each a copy of WRAPPER."""
    return [NAME, *([LEGACY_COMMAND] if keeps_legacy_command(version) else [])]


def build_facts(candidate):
    """(version, variant, lowest glibc) from the candidate's build-manifest.json."""
    manifest = json.loads((Path(candidate) / 'build-manifest.json').read_text(encoding='utf-8'))
    glibc = [tuple(int(part) for part in value.removeprefix('GLIBC_').split('.'))
             for row in manifest['files'] for value in row.get('elf_versions', ())
             if re.fullmatch(r'GLIBC_[0-9]+(?:\.[0-9]+)+', value)]
    if not glibc:
        raise ValueError('The candidate records no glibc requirement')
    if manifest.get('variant') != PACKAGE_VARIANT or sorted(manifest.get('speech_builds') or ()) != SPEECH_BUILDS:
        raise ValueError('Expected a candidate with both speech.cpp builds')
    return manifest['version'], manifest['variant'], '.'.join(map(str, max(glibc)))


def requirements(kind, variant, glibc):
    """(required, recommended) package names."""
    if variant != PACKAGE_VARIANT:
        raise ValueError('Unknown package variant')
    if kind == 'deb':
        required, recommended = [f'libc6 (>= {glibc})', *DEB_DEPENDS], [*DEB_RECOMMENDS]
    else:
        required, recommended = [f'glibc >= {glibc}', *RPM_REQUIRES], [*RPM_RECOMMENDS]
    recommended += VULKAN[kind]
    return required, recommended


def _link_or_copy(source, destination):
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)
    return destination


def stage(candidate, root, kind):
    """The installed tree under `root`: /opt/astarot and the files /usr needs."""
    candidate, root = Path(candidate), Path(root)
    if not (candidate / 'astarot').is_file() or not (candidate / 'build-manifest.json').is_file():
        raise ValueError('Not a Linux candidate directory')
    # Hard links, not copies: the runner's disk is nearly full with the tar.gz and the AppImage.
    shutil.copytree(candidate, root / PREFIX, symlinks=True, copy_function=_link_or_copy)
    (root / PREFIX / 'package-manager').write_text(kind + '\n', encoding='ascii')
    version, _, _ = build_facts(candidate)
    files = {f'usr/bin/{command}': (WRAPPER.encode(), 0o755) for command in commands(version)}
    files.update({
        f'usr/share/applications/{NAME}.desktop': ((ROOT / f'packaging/appimage/{NAME}.desktop').read_bytes(), 0o644),
        f'usr/share/icons/hicolor/256x256/apps/{NAME}.png': ((ROOT / 'src-tauri/icons/128x128@2x.png').read_bytes(), 0o644),
        f'usr/share/doc/{NAME}/copyright': ((ROOT / 'LICENSE').read_bytes(), 0o644),
        f'usr/share/doc/{NAME}/NOTICE.md': ((ROOT / 'NOTICE.md').read_bytes(), 0o644),
    })
    for relative, (data, mode) in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(mode)
    for path in [root, *root.rglob('*')]:
        if path.is_dir() and not path.is_symlink():
            path.chmod(0o755)
    return root


def installed_kib(root):
    return sum(path.lstat().st_size for path in Path(root).rglob('*') if not path.is_dir()) // 1024 + 1


def deb_control(version, variant, glibc, size_kib):
    required, recommended = requirements('deb', variant, glibc)
    return '\n'.join([
        f'Package: {NAME}',
        f'Version: {package_version(version)}',
        'Architecture: amd64',
        f'Maintainer: {MAINTAINER}',
        f'Installed-Size: {size_kib}',
        f'Depends: {", ".join(required)}',
        f'Recommends: {", ".join(recommended)}',
        # The package up to 0.6.x goes when this one comes in; nothing else installs that name.
        f'Conflicts: {LEGACY_NAME}',
        f'Replaces: {LEGACY_NAME}',
        f'Provides: {LEGACY_NAME}',
        'Section: sound',
        'Priority: optional',
        f'Homepage: {HOMEPAGE}',
        f'Description: {SUMMARY}',
        f' {DESCRIPTION}',
        '',
    ])


def rpm_spec(version, variant, glibc, staged):
    required, recommended = requirements('rpm', variant, glibc)
    requires = '\n'.join([*(f'Requires: {row}' for row in required),
                          *(f'Recommends: {row}' for row in recommended)])
    # Versioned, as Fedora's guidelines ask, so that the package does not obsolete itself.
    release = f'{package_version(version)}-1'
    replaced = f'Obsoletes: {LEGACY_NAME} < {release}\nProvides: {LEGACY_NAME} = {release}'
    files = '\n'.join(f'/usr/bin/{command}' for command in commands(version))
    return f"""# Prebuilt files from a checked candidate: nothing is compiled, stripped or rewritten here.
%global debug_package %{{nil}}
%global __os_install_post %{{nil}}
%global _build_id_links none
Name: {NAME}
Version: {package_version(version)}
Release: 1
Summary: {SUMMARY}
License: MIT AND LicenseRef-VRCT-VOX-bundled
URL: {HOMEPAGE}
ExclusiveArch: x86_64
AutoReqProv: no
{requires}
{replaced}

%description
{DESCRIPTION}
The bundled components and their licenses are listed in /usr/share/doc/astarot/NOTICE.md.

%install
mkdir -p %{{buildroot}}
cp -al '{staged}/.' %{{buildroot}}/

%files
/opt/astarot
{files}
/usr/share/applications/astarot.desktop
/usr/share/icons/hicolor/256x256/apps/astarot.png
%license /usr/share/doc/astarot/copyright
%doc /usr/share/doc/astarot/NOTICE.md
"""


def run(argv, **options):
    subprocess.run([str(value) for value in argv], check=True, **options)


def build_deb(candidate, output, work):
    version, variant, glibc = build_facts(candidate)
    root = stage(candidate, Path(work) / 'deb', 'deb')
    (root / 'DEBIAN').mkdir()
    (root / 'DEBIAN/control').write_text(deb_control(version, variant, glibc, installed_kib(root)), encoding='utf-8')
    run(['dpkg-deb', '--root-owner-group', '-Zxz', '--build', root, output])
    return output


def build_rpm(candidate, output, work):
    version, variant, glibc = build_facts(candidate)
    work = Path(work)
    staged = stage(candidate, work / 'rpm-root', 'rpm')
    top = work / 'rpmbuild'
    (top / 'SPECS').mkdir(parents=True)
    spec = top / f'SPECS/{NAME}.spec'
    spec.write_text(rpm_spec(version, variant, glibc, staged.resolve()), encoding='utf-8')
    run(['rpmbuild', '-bb', '--define', f'_topdir {top.resolve()}', '--target', 'x86_64', spec])
    built = list((top / 'RPMS/x86_64').glob(f'{NAME}-*.x86_64.rpm'))
    if len(built) != 1:
        raise RuntimeError('rpmbuild did not produce exactly one package')
    shutil.move(built[0], output)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--formats', default='deb,rpm')
    args = parser.parse_args()
    version, variant, _ = build_facts(args.candidate)
    stem = f'VRCT-VOX-{version}-{variant}-release'
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for kind in args.formats.split(','):
        builder = {'deb': build_deb, 'rpm': build_rpm}[kind]
        # Beside the candidate, so that hard links stay on one file system.
        with tempfile.TemporaryDirectory(prefix=f'vrct-{kind}-', dir=args.candidate.resolve().parent) as work:
            path = builder(args.candidate, args.output_dir / f'{stem}.{kind}', work)
        print(f'Unpublished {kind}: {path.resolve()}')


if __name__ == '__main__':
    main()
