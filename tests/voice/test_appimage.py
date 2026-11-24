"""Exercise packaging boundaries, not merely generated launcher text."""
import json
import hashlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile

import pytest

pytestmark = pytest.mark.skipif(sys.platform != 'linux', reason='Linux AppImage launchers')


@pytest.mark.parametrize('library_path', [None, '', '/host/libs with spaces'])
@pytest.mark.parametrize('host_data', [None, '/host/share'])
def test_launcher_keeps_the_host_environment_beside_the_gui_one(tmp_path, library_path, host_data):
    """The backend runs inside the GUI process; programs it starts can restore the host values."""
    from tools.build_appimage import install_launchers
    appdir = tmp_path / 'bundle with spaces.AppDir'
    (appdir / 'usr/bin').mkdir(parents=True)
    (appdir / 'usr/lib/astarot').mkdir(parents=True)
    # linuxdeploy's GUI launcher, renamed to AppRun.gui: report what the GUI process sees.
    report = ('import json,os,sys; print(json.dumps({"args": sys.argv[1:], "cwd": os.getcwd(), '
              '"ld": os.environ.get("LD_LIBRARY_PATH"), "xdg": os.environ.get("XDG_DATA_DIRS"), '
              '"host": {k: v for k, v in os.environ.items() if k.startswith("ASTAROT_APPIMAGE_HOST_")}}))')
    (appdir / 'AppRun').write_text(f'#!{sys.executable}\n{report}\n')
    (appdir / 'AppRun').chmod(0o755)
    (appdir / 'astarot.png').write_bytes(b'icon')
    install_launchers(appdir)
    assert (appdir / '.DirIcon').read_bytes() == b'icon'
    assert not (appdir / 'usr/bin/vrct-vox-sidecar').exists(), 'no backend runs beside the GUI'
    env = dict(os.environ, APPDIR='/wrong')
    env.pop('XDG_DATA_DIRS', None)
    if host_data is not None:
        env['XDG_DATA_DIRS'] = host_data
    env.pop('LD_LIBRARY_PATH', None)
    if library_path is not None:
        env['LD_LIBRARY_PATH'] = library_path
    result = subprocess.run([str(appdir / 'AppRun'), 'two words', '$(not a command)', ''],
                            env=env, cwd=tmp_path, check=True, text=True, capture_output=True)
    seen = json.loads(result.stdout)
    assert seen['args'] == ['two words', '$(not a command)', '']
    assert seen['cwd'] == str((appdir / 'usr').resolve())
    assert seen['ld'].startswith(str((appdir / 'usr/lib').resolve()))
    host = seen['host']
    assert (host['ASTAROT_APPIMAGE_HOST_LD_LIBRARY_PATH_SET'], host['ASTAROT_APPIMAGE_HOST_LD_LIBRARY_PATH']) == \
        ('x' if library_path is not None else '', library_path or '')
    assert (host['ASTAROT_APPIMAGE_HOST_XDG_DATA_DIRS_SET'], host['ASTAROT_APPIMAGE_HOST_XDG_DATA_DIRS']) == \
        ('x' if host_data is not None else '', host_data or '')


ROOT = Path(__file__).resolve().parents[2]
HOST_RECORD = 'ASTAROT_APPIMAGE_HOST_'


def launchers(tmp_path, report):
    """An AppDir with the real AppRun and xdg-open, and linuxdeploy's launcher replaced by `report`."""
    from tools.build_appimage import install_launchers
    appdir = tmp_path / 'App with spaces.AppDir'
    (appdir / 'usr/bin').mkdir(parents=True)
    (appdir / 'usr/lib/astarot').mkdir(parents=True)
    (appdir / 'AppRun').write_text(f'#!{sys.executable}\n{report}\n')
    (appdir / 'AppRun').chmod(0o755)
    (appdir / 'astarot.png').write_bytes(b'icon')
    install_launchers(appdir)
    return appdir


def test_a_restart_keeps_the_record_it_was_given(tmp_path):
    """After an in-app update the app starts its image again with the GUI's environment (#1016).
    The record of the first start stays; a name without a record is recorded as before."""
    report = ('import json,os; print(json.dumps({k: v for k, v in os.environ.items() '
              f'if k.startswith("{HOST_RECORD}")}}))')
    appdir = launchers(tmp_path, report)
    env = {k: v for k, v in os.environ.items() if not k.startswith(HOST_RECORD)}
    # What the first start's GUI had: its own libraries and GDK_BACKEND, and the record of the host,
    # which had neither. GTK_THEME has no record yet.
    env.update({'LD_LIBRARY_PATH': '/tmp/.mount_old/usr/lib', 'GDK_BACKEND': 'x11', 'GTK_THEME': 'Host:dark',
                f'{HOST_RECORD}LD_LIBRARY_PATH_SET': '', f'{HOST_RECORD}LD_LIBRARY_PATH': '',
                f'{HOST_RECORD}GDK_BACKEND_SET': '', f'{HOST_RECORD}GDK_BACKEND': ''})
    host = json.loads(subprocess.run([str(appdir / 'AppRun')], env=env, check=True, text=True,
                                     capture_output=True).stdout)
    assert (host[f'{HOST_RECORD}LD_LIBRARY_PATH_SET'], host[f'{HOST_RECORD}LD_LIBRARY_PATH']) == ('', '')
    assert (host[f'{HOST_RECORD}GDK_BACKEND_SET'], host[f'{HOST_RECORD}GDK_BACKEND']) == ('', '')
    assert (host[f'{HOST_RECORD}GTK_THEME_SET'], host[f'{HOST_RECORD}GTK_THEME']) == ('x', 'Host:dark')


def host_xdg_open(tmp_path):
    """A stand-in for the host's xdg-open that reports what it was started with."""
    folder = tmp_path / 'host bin'
    folder.mkdir()
    report = ('import json,os,sys; print(json.dumps({"args": sys.argv[1:], "env": {k: os.environ.get(k) for k in '
              '("LD_LIBRARY_PATH", "PATH", "GDK_BACKEND", "GTK_THEME", "XDG_DATA_DIRS")}}))')
    (folder / 'xdg-open').write_text(f'#!{sys.executable}\n{report}\n')
    (folder / 'xdg-open').chmod(0o755)
    # The wrapper finds itself with readlink; nothing else of the host is on these PATHs.
    (folder / 'readlink').symlink_to(subprocess.run(['sh', '-c', 'command -v readlink'], check=True, text=True,
                                                    capture_output=True).stdout.strip())
    return folder


def test_the_opener_s_xdg_open_runs_the_host_s_with_the_host_environment(tmp_path):
    """The URL opener starts usr/bin/xdg-open, first in the GUI's PATH (#1016). It gives the browser
    the host's environment back from AppRun's record, then runs the host's xdg-open."""
    appdir = launchers(tmp_path, 'pass')
    host = host_xdg_open(tmp_path)
    env = {'PATH': f'{appdir}/usr/bin:{host}', 'LD_LIBRARY_PATH': f'{appdir}/usr/lib', 'GDK_BACKEND': 'x11',
           'GTK_THEME': 'Adwaita:light', 'XDG_DATA_DIRS': f'{appdir}/usr/share:/usr/share',
           f'{HOST_RECORD}PATH_SET': 'x', f'{HOST_RECORD}PATH': str(host),
           f'{HOST_RECORD}LD_LIBRARY_PATH_SET': '', f'{HOST_RECORD}LD_LIBRARY_PATH': '',
           f'{HOST_RECORD}GDK_BACKEND_SET': '', f'{HOST_RECORD}GDK_BACKEND': '',
           f'{HOST_RECORD}GTK_THEME_SET': 'x', f'{HOST_RECORD}GTK_THEME': 'Breeze',
           f'{HOST_RECORD}XDG_DATA_DIRS_SET': 'x', f'{HOST_RECORD}XDG_DATA_DIRS': '/usr/share'}
    seen = json.loads(subprocess.run([str(appdir / 'usr/bin/xdg-open'), 'https://example.invalid/a b', ''],
                                     env=env, check=True, text=True, capture_output=True).stdout)
    assert seen == {'args': ['https://example.invalid/a b', ''],
                    'env': {'LD_LIBRARY_PATH': None, 'PATH': str(host), 'GDK_BACKEND': None,
                            'GTK_THEME': 'Breeze', 'XDG_DATA_DIRS': '/usr/share'}}


def test_the_opener_s_xdg_open_without_a_record_changes_nothing_and_skips_itself(tmp_path):
    appdir = launchers(tmp_path, 'pass')
    host = host_xdg_open(tmp_path)
    env = {'PATH': f'{appdir}/usr/bin:{host}', 'GDK_BACKEND': 'x11'}
    seen = json.loads(subprocess.run([str(appdir / 'usr/bin/xdg-open'), 'https://example.invalid/'],
                                     env=env, check=True, text=True, capture_output=True).stdout)
    assert seen['env']['GDK_BACKEND'] == 'x11' and seen['env']['PATH'] == env['PATH']
    # Only itself on the PATH: it stops with xdg-open's own code for a missing tool.
    (host / 'xdg-open').unlink()
    result = subprocess.run([str(appdir / 'usr/bin/xdg-open'), 'https://example.invalid/'],
                            env=env, text=True, capture_output=True, timeout=10)
    assert result.returncode == 3 and 'no xdg-open' in result.stderr


def test_the_opener_s_xdg_open_gives_back_the_names_apprun_keeps():
    def names(path):
        line = next(line for line in path.read_text(encoding='utf-8').splitlines() if line.startswith('for name in '))
        return line.removeprefix('for name in ').removesuffix('; do').split()

    assert names(ROOT / 'packaging/appimage/xdg-open') == names(ROOT / 'packaging/appimage/AppRun')


@pytest.mark.parametrize(('host', 'daemon', 'gui'), [
    ({}, 'fcitx5', {'GTK_IM_MODULE': 'xim', 'XMODIFIERS': '@im=fcitx'}),
    ({'GTK_IM_MODULE': 'fcitx'}, 'fcitx5', {'GTK_IM_MODULE': 'xim', 'XMODIFIERS': '@im=fcitx'}),
    ({}, 'ibus-daemon', {'GTK_IM_MODULE': 'xim', 'XMODIFIERS': '@im=ibus'}),
    ({'XMODIFIERS': '@im=custom'}, 'fcitx5', {'GTK_IM_MODULE': 'xim', 'XMODIFIERS': '@im=custom'}),
    ({'GTK_IM_MODULE': 'simple'}, 'fcitx5', {'GTK_IM_MODULE': 'simple', 'XMODIFIERS': '@im=fcitx'}),
    ({}, None, {}),
])
def test_gui_reaches_host_input_method_over_xim(tmp_path, host, daemon, gui):
    from tools.build_appimage import install_launchers
    appdir = tmp_path / 'App.AppDir'
    (appdir / 'usr/bin').mkdir(parents=True)
    (appdir / 'usr/lib/astarot').mkdir(parents=True)
    report = 'import json,os,sys; print(json.dumps({k: os.environ[k] for k in ("GTK_IM_MODULE", "XMODIFIERS") if k in os.environ}))'
    (appdir / 'AppRun').write_text(f'#!{sys.executable}\n{report}\n')
    (appdir / 'AppRun').chmod(0o755)
    (appdir / 'astarot.png').write_bytes(b'icon')
    install_launchers(appdir)
    # A stand-in pgrep reports which input method daemon is running.
    tools = tmp_path / 'bin'
    tools.mkdir()
    (tools / 'pgrep').write_text(f'#!/bin/sh\ntest "$2" = "{daemon}"\n')
    (tools / 'pgrep').chmod(0o755)
    env = {k: v for k, v in os.environ.items() if k not in ('GTK_IM_MODULE', 'XMODIFIERS')}
    env.update(host, PATH=f'{tools}:{env["PATH"]}')
    lines = subprocess.run([str(appdir / 'AppRun')], env=env, check=True, text=True,
                           capture_output=True).stdout.splitlines()
    assert [json.loads(line) for line in lines] == [gui]


def test_directory_links_require_explicit_appdir_mode(tmp_path):
    from tools.linux_package import check_tree
    (tmp_path / 'lib').mkdir()
    (tmp_path / 'lib/library.so').write_bytes(b'library')
    (tmp_path / 'lib64').symlink_to('lib', target_is_directory=True)
    with pytest.raises(ValueError):
        check_tree(tmp_path)
    check_tree(tmp_path, allow_directory_links=True)


@pytest.mark.parametrize('target', ['../outside', 'missing', 'cycle'])
def test_appdir_mode_still_rejects_outside_broken_or_cyclic_links(tmp_path, target):
    from tools.linux_package import check_tree
    root = tmp_path / 'AppDir'
    root.mkdir()
    (tmp_path / 'outside').mkdir()
    (root / 'cycle').symlink_to(target, target_is_directory=True)
    with pytest.raises(ValueError):
        check_tree(root, allow_directory_links=True)


def test_runtime_comparison_allows_only_embedded_digest(tmp_path):
    from tools.build_appimage import verify_runtime
    runtime = tmp_path / 'runtime'
    image = tmp_path / 'program.AppImage'
    runtime.write_bytes(b'\x7fELF' + bytes(96))
    data = bytearray(runtime.read_bytes())
    data[64:80] = b'0123456789abcdef'
    image.write_bytes(data + b'hsqs payload')
    verify_runtime(image, runtime, digest_offset=64)
    data[20] = 1  # Executable prefix corruption is never a metadata exception.
    image.write_bytes(data + b'hsqs payload')
    with pytest.raises(ValueError, match='runtime'):
        verify_runtime(image, runtime, digest_offset=64)


def test_short_runtime_and_missing_squashfs_are_rejected(tmp_path):
    from tools.build_appimage import verify_runtime
    runtime, image = tmp_path / 'runtime', tmp_path / 'image'
    runtime.write_bytes(bytes(100))
    for data in (bytes(40), bytes(100) + b'nope'):
        image.write_bytes(data)
        with pytest.raises(ValueError):
            verify_runtime(image, runtime, digest_offset=64)


def test_wrong_tool_hash_is_rejected_before_execution(tmp_path):
    from tools.build_appimage import verify_tools
    manifest = json.loads((Path(__file__).resolve().parents[2] / 'docs/voice-stack/appimage-tools.json').read_text())
    for row in manifest['tools']:
        (tmp_path / row['name']).write_bytes(b'corrupt')
    with pytest.raises(ValueError, match='tool'):
        verify_tools(tmp_path)


@pytest.mark.parametrize('corruption', [None, 'hash', 'link'])
def test_pinned_archive_extracts_only_verified_tool(tmp_path, monkeypatch, corruption):
    from tools import build_appimage
    payload = b'fixed binary'
    archive = tmp_path / 'tool.tar.gz'
    with tarfile.open(archive, 'w:gz') as output:
        member = tarfile.TarInfo('./bin/tool')
        member.size = len(payload)
        if corruption == 'link':
            member.type, member.linkname, member.size = tarfile.SYMTYPE, '/host/executable', 0
        output.addfile(member, io.BytesIO(payload))
        extra = tarfile.TarInfo('../unrequested')
        extra.size = 4
        output.addfile(extra, io.BytesIO(b'omit'))
    manifest = tmp_path / 'tools.json'
    manifest.write_text(json.dumps({'tools': [{
        'name': archive.name, 'size': archive.stat().st_size,
        'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'extract': {'name': 'tool', 'member': './bin/tool', 'size': len(payload),
                    'sha256': hashlib.sha256(payload).hexdigest() if corruption != 'hash' else '0' * 64}
    }]}))
    monkeypatch.setattr(build_appimage, 'MANIFEST', manifest)
    if corruption:
        with pytest.raises(ValueError, match='tool'):
            build_appimage.verify_tools(tmp_path)
        assert not (tmp_path / 'tool').exists()
    else:
        assert build_appimage.verify_tools(tmp_path)['tool'].read_bytes() == payload
        (tmp_path / 'tool').write_bytes(b'corrupt')
        with pytest.raises(ValueError, match='tool'):
            build_appimage.verify_tools(tmp_path)
    assert not (tmp_path.parent / 'unrequested').exists()


def test_backend_payload_is_copied_without_rewriting(tmp_path):
    from tools.build_appimage import install_payload
    candidate, appdir = tmp_path / 'candidate', tmp_path / 'AppDir'
    (candidate / '_internal/build/speechcpp').mkdir(parents=True)
    (candidate / 'astarot').write_bytes(b'gui')
    (candidate / '_internal/build/speechcpp/speech').write_bytes(b'exact pinned engine')
    (candidate / '_internal/lib.so').symlink_to('build/speechcpp/speech')
    install_payload(candidate, appdir)
    target = appdir / 'usr/lib/astarot'
    assert (target / '_internal/build/speechcpp/speech').read_bytes() == b'exact pinned engine'
    assert (target / '_internal/lib.so').is_symlink()
    assert not (target / 'astarot').exists(), 'do not include a duplicate unpatched GUI'
    assert (candidate / '_internal/build/speechcpp/speech').read_bytes() == b'exact pinned engine'


def test_webdriver_matches_only_payload_of_launched_appimage(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / 'platform'))
    from native_webdriver import matches_launched_app
    image = '/tmp/My App.AppImage'
    executable = '/tmp/.mount_test/usr/bin/astarot'
    env = {'APPIMAGE': image, 'APPDIR': '/tmp/.mount_test'}
    assert matches_launched_app(executable, env, image, appimage=True)
    assert not matches_launched_app(image, {}, image, appimage=True), 'extract runtime waits for GUI exit'
    assert not matches_launched_app(executable, dict(env, APPIMAGE='/tmp/other.AppImage'), image, appimage=True)
    assert not matches_launched_app('/tmp/unrelated/astarot', env, image, appimage=True)
    # The executable's name up to 0.6.x is not the payload of an image built from 0.7.0.
    assert not matches_launched_app('/tmp/.mount_test/usr/bin/vrct-vox', env, image, appimage=True)
    assert not matches_launched_app(executable, {}, image, appimage=True)
    assert matches_launched_app('/tmp/app/astarot', {}, '/tmp/app/astarot')
