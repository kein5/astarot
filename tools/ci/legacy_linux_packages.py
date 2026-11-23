"""Build stand-ins of the deb and rpm up to 0.6.x (the package vrct-vox) for the CI's check that the
package of this version replaces them (ADR-014, 2.7).

    python3 tools/ci/legacy_linux_packages.py --output-dir build/linux/legacy

tools/ci/check_linux_package.sh installs a stand-in before the package of this version. A stand-in
has the paths the package up to 0.6.x installed, with a small script in place of the app: the same
package name and files, none of the app. Keep it out of build/linux/artifacts, whose packages are
the release candidate's.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
import linux_packages  # noqa: E402

NAME = linux_packages.LEGACY_NAME
# Below every 0.7.0 package (0.7.0~beta.1 sorts after 0.6.99).
VERSION = '0.6.99'
DESKTOP = ('[Desktop Entry]\nType=Application\nName=ASTAROT\nExec=vrct-vox\nIcon=vrct-vox\n'
           'Terminal=false\nCategories=AudioVideo;Audio;\nStartupWMClass=vrct-vox\n')


def files(kind):
    """What the package up to 0.6.x installed, by path: (content, mode)."""
    return {
        'opt/vrct-vox/vrct-vox': (b'#!/bin/sh\necho "stand-in of vrct-vox up to 0.6.x"\n', 0o755),
        'opt/vrct-vox/package-manager': (f'{kind}\n'.encode(), 0o644),
        'usr/bin/vrct-vox': (b'#!/bin/sh\nexec /opt/vrct-vox/vrct-vox "$@"\n', 0o755),
        'usr/share/applications/vrct-vox.desktop': (DESKTOP.encode(), 0o644),
        'usr/share/icons/hicolor/256x256/apps/vrct-vox.png': ((ROOT / 'src-tauri/icons/128x128@2x.png').read_bytes(), 0o644),
        'usr/share/doc/vrct-vox/copyright': ((ROOT / 'LICENSE').read_bytes(), 0o644),
    }


def stage(root, kind):
    root = Path(root)
    for relative, (data, mode) in files(kind).items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(mode)
    for path in [root, *root.rglob('*')]:
        if path.is_dir():
            path.chmod(0o755)
    return root


def stand_in_version(candidate_version):
    """Use an older fixture while the development branch still declares 0.6.x."""
    if candidate_version.startswith("0.6."):
        return "0.5.99"
    return VERSION


def deb_control(version=VERSION):
    return '\n'.join([
        f'Package: {NAME}',
        f'Version: {version}',
        'Architecture: amd64',
        f'Maintainer: {linux_packages.MAINTAINER}',
        'Section: sound',
        'Priority: optional',
        'Description: Stand-in of the ASTAROT package up to 0.6.x',
        ' Only for checking that the package of this version replaces it.',
        '',
    ])


def rpm_spec(staged, version=VERSION):
    # As the spec up to 0.6.x listed them: the folder under /opt as a whole, so that removing the
    # package removes the folder too.
    paths = '\n'.join(['/opt/vrct-vox', *('/' + relative for relative in files('rpm') if not relative.startswith('opt/'))])
    return f"""%global debug_package %{{nil}}
%global __os_install_post %{{nil}}
%global _build_id_links none
Name: {NAME}
Version: {version}
Release: 1
Summary: Stand-in of the ASTAROT package up to 0.6.x
License: MIT
ExclusiveArch: x86_64
AutoReqProv: no

%description
Only for checking that the package of this version replaces it.

%install
mkdir -p %{{buildroot}}
cp -a '{staged}/.' %{{buildroot}}/

%files
{paths}
"""


def build(output_dir, kind, version=VERSION):
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f'{NAME}.{kind}'
    with tempfile.TemporaryDirectory(prefix=f'legacy-{kind}-') as work:
        work = Path(work)
        staged = stage(work / 'root', kind)
        if kind == 'deb':
            (staged / 'DEBIAN').mkdir()
            (staged / 'DEBIAN/control').write_text(deb_control(version), encoding='utf-8')
            subprocess.run(['dpkg-deb', '--root-owner-group', '-Zxz', '--build', str(staged), str(output)], check=True)
        else:
            top = work / 'rpmbuild'
            (top / 'SPECS').mkdir(parents=True)
            spec = top / 'SPECS' / f'{NAME}.spec'
            spec.write_text(rpm_spec(staged.resolve(), version), encoding='utf-8')
            subprocess.run(['rpmbuild', '-bb', '--define', f'_topdir {top.resolve()}', '--target', 'x86_64', str(spec)],
                           check=True)
            built = list((top / 'RPMS/x86_64').glob(f'{NAME}-*.x86_64.rpm'))
            if len(built) != 1:
                raise RuntimeError('rpmbuild did not produce exactly one package')
            shutil.move(built[0], output)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--formats', default='deb,rpm')
    args = parser.parse_args()
    candidate_version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    version = stand_in_version(candidate_version)
    for kind in args.formats.split(','):
        print(f'Stand-in {kind}: {build(args.output_dir, kind, version)}')


if __name__ == '__main__':
    main()
