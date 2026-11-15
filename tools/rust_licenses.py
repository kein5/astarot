"""Collect the license texts of the Rust crates built into VRCT-VOX's executables.

The builds put the result in `_internal/licenses/rust/` (NOTICE.md, "Rust crates in
VRCT-VOX builds"). For each shipped executable, `cargo metadata` resolves the lock file for
the build's target, and every crate reached through normal dependencies is listed: what is
compiled into the executable, and the procedural macros that generate code in it. Build
scripts' own dependencies and dev-dependencies are not listed; they do not end up in it.

Each crate's texts are the LICENSE, COPYING, NOTICE and similar files at the top of its
published package. A crate that publishes none needs a reviewed entry in
licenses/rust/supplements.json; without one this tool fails, so a new dependency cannot
ship without its license text. The crates of this repository (path dependencies) are
VRCT-VOX's own code under its LICENSE and get no folder.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SUPPLEMENTS = ROOT / 'licenses/rust'
TARGETS = {'win32': 'x86_64-pc-windows-msvc', 'linux': 'x86_64-unknown-linux-gnu'}
# (executable, manifest, the features its build uses). The Tauri app is built with its
# default features; the worker as tools/build_rvc_worker.py builds it.
SHIPPED = (
    ('vrct-vox', 'src-tauri/Cargo.toml', ()),
    ('vrct-rvc-worker', 'native/rvc-runtime/Cargo.toml', ('--no-default-features', '--features', 'worker')),
)
PREFIXES = ('LICENSE', 'LICENCE', 'COPYING', 'COPYRIGHT', 'NOTICE', 'UNLICENSE', 'AUTHORS')
MARKER = 'crates.json'


def metadata(manifest, target, features=(), *, offline=False, cargo='cargo'):
    command = [cargo, 'metadata', '--format-version', '1', '--locked', '--manifest-path', str(ROOT / manifest),
               '--filter-platform', target, *features, *(['--offline'] if offline else [])]
    # stderr stays on the console: a failure (a lock file out of date, no network) shows cargo's reason.
    return json.loads(subprocess.run(command, check=True, stdout=subprocess.PIPE, text=True, encoding='utf-8').stdout)


def shipped_packages(meta):
    """The packages reached from the root through normal dependencies, in id order."""
    packages = {package['id']: package for package in meta['packages']}
    nodes = {node['id']: node for node in meta['resolve']['nodes']}
    seen, stack = set(), [meta['resolve']['root']]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        for dep in nodes[current]['deps']:
            if any(kind['kind'] is None for kind in dep['dep_kinds']):
                stack.append(dep['pkg'])
    return [packages[ident] for ident in sorted(seen)]


def own_files(package):
    folder = Path(package['manifest_path']).parent
    files = {path.name: path for path in folder.iterdir()
             if path.is_file() and path.name.upper().startswith(PREFIXES)}
    if package.get('license_file'):
        path = (folder / package['license_file'])
        if path.is_file():
            files.setdefault(path.name, path)
    return files


def license_files(package, supplements):
    """{file name: path} for the package, from its own files or the reviewed supplement."""
    files = own_files(package)
    if files:
        return files
    key = f"{package['name']}-{package['version']}"
    if key not in supplements:
        raise LookupError(key)
    folder = SUPPLEMENTS / key
    return {name: folder / name for name in supplements[key]['files']}


def collect(target, *, offline=False, cargo='cargo', load=metadata):
    """{(name, version): entry} for every crate in the shipped executables for target."""
    supplements = json.loads((SUPPLEMENTS / 'supplements.json').read_text(encoding='utf-8'))['crates']
    crates, missing = {}, []
    for binary, manifest, features in SHIPPED:
        for package in shipped_packages(load(manifest, target, features, offline=offline, cargo=cargo)):
            key = (package['name'], package['version'])
            entry = crates.get(key)
            if entry is None:
                local = package['source'] is None
                entry = {'name': package['name'], 'version': package['version'], 'license': package['license'],
                         'repository': package.get('repository'), 'local': local, 'binaries': [], 'files': {}}
                if not local:
                    try:
                        entry['files'] = license_files(package, supplements)
                    except LookupError:
                        missing.append(f"{package['name']} {package['version']} ({package['license']})")
                crates[key] = entry
            if binary not in entry['binaries']:
                entry['binaries'].append(binary)
    if missing:
        raise SystemExit('No license text in the published package, and no entry in '
                         'licenses/rust/supplements.json:\n  ' + '\n  '.join(sorted(missing)))
    return crates


def write(output, crates, target):
    output = Path(output)
    if output.exists():
        if any(output.iterdir()) and not (output / MARKER).is_file():
            raise SystemExit(f'Refusing to replace {output}: not a folder this tool wrote')
        shutil.rmtree(output)
    output.mkdir(parents=True)
    rows = []
    for (name, version), entry in sorted(crates.items(), key=lambda item: (item[0][0].lower(), item[0][1])):
        folder = f'{name}-{version}'
        copied = []
        for file_name, source in sorted(entry['files'].items()):
            target_path = output / folder / file_name
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target_path)
            copied.append(f'{folder}/{file_name}')
        rows.append({'name': name, 'version': version, 'license': entry['license'], 'repository': entry['repository'],
                     'local': entry['local'], 'binaries': sorted(entry['binaries']), 'files': copied})
    (output / MARKER).write_text(json.dumps({'schema': 1, 'target': target, 'crates': rows},
                                            ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    (output / 'README.md').write_text(readme(rows, target), encoding='utf-8')
    return rows


def readme(rows, target):
    lines = [
        '# Rust crates in VRCT-VOX builds', '',
        f'The Rust crates compiled into this build\'s executables (target `{target}`), with the',
        'license texts each crate publishes. Each `<crate>-<version>/` folder holds those texts.',
        'Generated by `tools/rust_licenses.py` from the lock files; see NOTICE.md in `../VRCT/`.', '',
        'Crates marked "VRCT-VOX" are this project\'s own code, under `../VRCT/LICENSE`.',
        'The source code of every other crate is published on crates.io at the version listed',
        '(https://crates.io/crates/<crate>/<version>). That includes the crates under the',
        'Mozilla Public License 2.0, whose source code form is available there.', '',
        '| Crate | Version | License | Executables |', '|---|---|---|---|']
    for row in rows:
        license_text = 'VRCT-VOX' if row['local'] else (row['license'] or 'see the folder')
        lines.append(f"| {row['name']} | {row['version']} | {license_text} | {', '.join(row['binaries'])} |")
    return '\n'.join(lines) + '\n'


def missing_files(folder):
    """What a collected folder lacks: its index, or a text the index lists."""
    folder = Path(folder)
    index = folder / MARKER
    if not index.is_file() or not (folder / 'README.md').is_file():
        return [MARKER]
    rows = json.loads(index.read_text(encoding='utf-8'))['crates']
    gaps = [name for row in rows for name in row['files'] if not (folder / name).is_file()]
    gaps += [f"{row['name']}-{row['version']}" for row in rows if not row['local'] and not row['files']]
    return gaps


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--output', type=Path, required=True, help='folder to (re)write, e.g. build/licenses/rust')
    parser.add_argument('--platform', choices=sorted(TARGETS), default='win32' if sys.platform == 'win32' else 'linux')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--cargo', default='cargo')
    args = parser.parse_args(argv)
    target = TARGETS[args.platform]
    rows = write(args.output, collect(target, offline=args.offline, cargo=args.cargo), target)
    licenses = {}
    for row in rows:
        if not row['local']:
            licenses[row['license']] = licenses.get(row['license'], 0) + 1
    print(f'{len(rows)} crates for {target} in {args.output}')
    for name, count in sorted(licenses.items(), key=lambda item: -item[1]):
        print(f'  {count:4} {name}')


if __name__ == '__main__':
    main()
