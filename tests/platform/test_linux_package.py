"""Opt-in real relocated/read-only Linux package acceptance, no model download."""
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from tools.linux_package import check_tree, inspect_tar, inventory  # noqa: E402

pytestmark = pytest.mark.skipif(
    sys.platform != 'linux' or not os.environ.get('ASTAROT_TEST_LINUX_ARCHIVE'),
    reason='requires built Linux candidate archive',
)


@pytest.fixture
def installation(tmp_path, monkeypatch):
    archive = Path(os.environ['ASTAROT_TEST_LINUX_ARCHIVE']).resolve()
    inspect_tar(archive)
    location = tmp_path / 'relocated install with spaces'
    location.mkdir()
    with tarfile.open(archive) as src:
        src.extractall(location, filter='data')
    roots = list(location.iterdir())
    assert len(roots) == 1
    root = roots[0]
    check_tree(root, require_runtime=True)
    from tools.speechcpp_bundle import verify_bundle
    # Both engine builds: the Vulkan build and the CPU build, each pinned.
    assert verify_bundle(root / '_internal/build/speechcpp')['variant'] == 'linux-x64-vulkan'
    assert verify_bundle(root / '_internal/build/speechcpp-cpu')['variant'] == 'linux-x64-cpu'
    paths = [root, *root.rglob('*')]
    for path in paths:
        if not path.is_symlink():
            path.chmod(path.stat().st_mode & ~0o222)
    assert not os.access(root, os.W_OK), 'run package acceptance as an unprivileged user'
    before = inventory(root)
    monkeypatch.setenv('ASTAROT_TEST_APP', str(root / 'astarot'))
    try:
        yield root
        assert inventory(root) == before, 'installation mutated during acceptance'
    finally:
        for path in paths:
            if not path.is_symlink():
                path.chmod(path.stat().st_mode | stat.S_IWUSR)


def test_no_python_backend_and_the_bundled_engines_start(installation, tmp_path):
    # The app runs the backend core in its own process (#285); nothing frozen ships beside it.
    assert not (installation / 'vrct-vox-sidecar').exists()
    assert not (installation / '_internal/base_library.zip').exists()
    assert not list(installation.rglob('libpython*'))
    for folder in ('speechcpp', 'speechcpp-cpu'):
        result = subprocess.run([str(installation / '_internal/build' / folder / 'speech'), '--help'],
                                capture_output=True, timeout=10, cwd=tmp_path)
        assert result.returncode == 0, (folder, result.stderr)


@pytest.mark.skipif(os.environ.get('ASTAROT_TEST_NATIVE_GUI') != '1', reason='requires WebKit driver/display')
def test_relocated_native_gui(installation, tmp_path):
    from test_native_ui import test_model_free_native_app_renders_text_input_without_fatal_warning
    test_model_free_native_app_renders_text_input_without_fatal_warning(tmp_path)


@pytest.mark.skipif(os.environ.get('ASTAROT_TEST_NATIVE_GUI') != '1', reason='requires WebKit driver/display')
def test_relocated_desktop_captions(installation, tmp_path):
    from test_native_ui import test_desktop_captions_are_an_unmanaged_window_above_the_others
    test_desktop_captions_are_an_unmanaged_window_above_the_others(tmp_path)


@pytest.mark.skipif(os.environ.get('ASTAROT_TEST_NATIVE_GUI') != '1', reason='requires WebKit driver/display')
@pytest.mark.skipif(os.environ.get('ASTAROT_TEST_NATIVE_ROUTE') != '1', reason='opt-in private PipeWire/WirePlumber 0.5 graph')
def test_relocated_managed_route_restart_muted(installation, tmp_path):
    from test_native_ui import test_native_managed_route_unmutes_and_is_muted_again_after_a_restart
    test_native_managed_route_unmutes_and_is_muted_again_after_a_restart(tmp_path)
