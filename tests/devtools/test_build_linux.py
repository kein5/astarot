"""Linux build contracts and the uv.lock verifier; never install or build packages."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools import app_resources

from tools import build_linux
from tools import runtime_libraries
from tools.check_python_lock import validate_lock


SHA256 = 'a' * 64
COMMIT = 'b' * 40
INDEX_PACKAGE = f'''
[[package]]
name = "example"
version = "1.2.3"
source = {{ registry = "https://pypi.org/simple" }}
sdist = {{ url = "https://example.invalid/example-1.2.3.tar.gz", hash = "sha256:{SHA256}" }}
wheels = [{{ url = "https://example.invalid/example-1.2.3-py3-none-any.whl", hash = "sha256:{SHA256}" }}]
'''
GIT_PACKAGE = f'''
[[package]]
name = "git-example"
version = "2.0.0"
source = {{ git = "https://example.invalid/source?rev={COMMIT}#{COMMIT}" }}
'''
PROJECT = '''
[[package]]
name = "vrct-vox"
version = "0.1.0"
source = { virtual = "." }
'''
# The two pinned speech.cpp archives a Linux package ships (stage_bundle is replaced in the tests).
MANIFEST = {'assets': {'linux-x64-vulkan': {'name': 'vulkan.zip'}, 'linux-x64-cpu': {'name': 'cpu.zip'}}}
ARCHIVES = {'linux-x64-vulkan': Path('vulkan.zip'), 'linux-x64-cpu': Path('cpu.zip')}


class LinuxDependencyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='vox build hashes ')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.lock = self.root / 'uv.lock'
        self.write_lock(INDEX_PACKAGE + GIT_PACKAGE + PROJECT)

    def write_lock(self, packages):
        self.lock.write_text('version = 1\nrevision = 5\nrequires-python = "==3.14.*"\n' + packages,
                             encoding='utf-8')

    def test_valid_archives_git_and_uninstalled_root_are_accepted(self):
        validate_lock(self.lock)

    def test_repository_lock_is_verifiable(self):
        validate_lock(build_linux.ROOT / 'uv.lock')

    def test_git_requires_full_sha_in_both_requested_and_resolved_revision(self):
        for requested, resolved in (
            ('main', COMMIT), (COMMIT[:7], COMMIT), (COMMIT, COMMIT[:7]),
            (COMMIT, 'main'), (COMMIT, 'c' * 40), ('g' * 40, 'g' * 40),
        ):
            with self.subTest(requested=requested, resolved=resolved):
                self.write_lock(GIT_PACKAGE.replace(f'rev={COMMIT}#{COMMIT}', f'rev={requested}#{resolved}'))
                with self.assertRaisesRegex(ValueError, 'git-example.*full 40-character commit SHA'):
                    validate_lock(self.lock)

    def test_git_tag_or_branch_is_rejected_even_with_resolved_commit(self):
        for query in ('tag=v2', 'branch=main', ''):
            with self.subTest(query=query):
                self.write_lock(GIT_PACKAGE.replace(f'rev={COMMIT}', query))
                with self.assertRaisesRegex(ValueError, 'full 40-character commit SHA'):
                    validate_lock(self.lock)

    def test_non_vcs_package_without_any_archive_hash_is_rejected(self):
        self.write_lock(INDEX_PACKAGE.replace(f', hash = "sha256:{SHA256}"', ''))
        with self.assertRaisesRegex(ValueError, 'example 1.2.3.*missing or invalid SHA-256'):
            validate_lock(self.lock)

    def test_every_archive_needs_a_valid_hash_even_when_another_has_one(self):
        for checksum in ('', 'sha256:1234', 'sha256:' + 'g' * 64, 'md5:' + 'a' * 32):
            with self.subTest(checksum=checksum):
                self.write_lock(INDEX_PACKAGE.replace(f'sha256:{SHA256}', checksum, 1))
                with self.assertRaisesRegex(ValueError, 'example-1.2.3.tar.gz'):
                    validate_lock(self.lock)

    def test_non_vcs_package_without_artifacts_is_rejected(self):
        self.write_lock(INDEX_PACKAGE.split('sdist =')[0])
        with self.assertRaisesRegex(ValueError, 'non-VCS package has no hashed archives'):
            validate_lock(self.lock)

    def test_local_sources_cannot_bypass_hash_validation(self):
        for source in ('{ directory = "../local" }', '{ editable = "../local" }',
                       '{ virtual = "." }', '{ path = "local.whl" }'):
            with self.subTest(source=source):
                self.write_lock(INDEX_PACKAGE.replace('{ registry = "https://pypi.org/simple" }', source))
                with self.assertRaisesRegex(ValueError, 'unsupported non-VCS source'):
                    validate_lock(self.lock)

    def test_direct_archive_url_still_requires_hashes(self):
        package = INDEX_PACKAGE.replace('registry = "https://pypi.org/simple"',
                                        'url = "https://example.invalid/example-1.2.3.tar.gz"')
        self.write_lock(package)
        validate_lock(self.lock)
        self.write_lock(package.replace(f', hash = "sha256:{SHA256}"', ''))
        with self.assertRaisesRegex(ValueError, 'missing or invalid SHA-256'):
            validate_lock(self.lock)

    def test_validator_cli_reports_bad_lock_and_exits_nonzero(self):
        self.write_lock(GIT_PACKAGE.replace(COMMIT, 'main'))
        result = subprocess.run([sys.executable, '-S', str(build_linux.ROOT / 'tools/check_python_lock.py'),
                                 str(self.lock)], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Python dependency verification failed:', result.stderr)
        self.assertIn('git-example', result.stderr)


class LinuxWorkspaceTests(unittest.TestCase):
    def test_the_workspace_copies_every_crate_the_app_links_by_path(self):
        import re
        root = Path(build_linux.ROOT)
        needed, pending = set(), [root / 'src-tauri' / 'Cargo.toml']
        while pending:
            manifest = pending.pop()
            for path in re.findall(r'path\s*=\s*"\.\./([^"]+)"', manifest.read_text(encoding='utf-8')):
                crate = (manifest.parent / '..' / path).resolve()
                if crate.parent.name == 'native' and crate.name not in needed:
                    needed.add(crate.name)
                    pending.append(crate / 'Cargo.toml')
        self.assertEqual(set(build_linux.APP_CRATES), needed)

    def test_the_workspace_copies_every_file_a_crate_includes_from_outside_itself(self):
        import re
        root = Path(build_linux.ROOT)
        outside = set()
        for name in build_linux.APP_CRATES:
            crate = root / 'native' / name
            for source in (crate / 'src').rglob('*.rs'):
                for path in re.findall(r'include_(?:str|bytes)!\(\s*"([^"]+)"', source.read_text(encoding='utf-8')):
                    target = (source.parent / path).resolve()
                    if not target.is_relative_to(crate.resolve()):
                        self.assertTrue(target.is_file(), path)
                        outside.add(target.relative_to(root.resolve()).as_posix())
        self.assertEqual(set(build_linux.CRATE_INPUTS), outside)


class LinuxStagingTests(unittest.TestCase):
    """The candidate is the app and its _internal folder; nothing of the Python backend."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='vox linux staging ')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        # ONNX Runtime and OpenVR come from pinned downloads (tools/runtime_libraries.py, its own
        # tests); here they are stand-ins, so that no test needs the archives or the network.
        libraries = patch.object(build_linux, 'stage_runtime_libraries', side_effect=self.fake_runtime_libraries)
        self.runtime_libraries = libraries.start()
        self.addCleanup(libraries.stop)

    @staticmethod
    def fake_runtime_libraries(platform, build, *, download=False):
        names = runtime_libraries.shipped(platform)
        for name in names:
            (build / name).parent.mkdir(parents=True, exist_ok=True)
            (build / name).write_bytes(b'library')
        return names

    def fake_run(self, argv, **_):
        names = [str(value) for value in argv]
        output = Path(names[names.index('--output-dir') + 1]) if '--output-dir' in names else None
        if names[1].endswith('build_voice_gate.py'):
            for name in app_resources.LINUX_HELPERS:
                (output / name).write_bytes(b'helper')
        elif names[1].endswith('build_rvc_worker.py'):
            (output / 'astarot-rvc-worker').write_bytes(b'worker')
        elif names[1].endswith('rust_licenses.py'):
            licenses = Path(names[names.index('--output') + 1])
            licenses.mkdir(parents=True)
            (licenses / 'crates.json').write_text('[]')
            (licenses / 'README.md').write_text('crates')
        else:
            self.fail(f'unexpected command {names}')

    @staticmethod
    def fake_bundle(archive, output, asset):
        (output / 'notices').mkdir(parents=True)
        (output / 'speech').write_bytes(b'engine')
        (output / 'bundle.json').write_text('{}')
        (output / 'notices/LICENSE').write_text('MIT')

    def test_internal_holds_the_engine_helpers_and_notices_only(self):
        with patch.object(build_linux, 'run', side_effect=self.fake_run), \
                patch.object(build_linux, 'load_manifest', return_value=MANIFEST), \
                patch.object(build_linux, 'stage_bundle', side_effect=self.fake_bundle), \
                patch.object(build_linux, 'verify_bundle'):
            internal = build_linux.stage_internal(self.work, ARCHIVES)
        names = {path.relative_to(internal).as_posix() for path in internal.rglob('*') if path.is_file()}
        self.assertLessEqual(set(app_resources.required('linux')), names)
        # Both engine builds, each with its own pinned bundle and notices.
        for folder in ('speechcpp', 'speechcpp-cpu'):
            self.assertIn(f'build/{folder}/notices/LICENSE', names)
            self.assertIn(f'build/{folder}/bundle.json', names)
        self.assertTrue({f'docs/{name}' for name in build_linux.SHIPPED_DOCS} <= names)
        self.assertTrue(any(name.startswith('config/pipewire/') for name in names))
        for forbidden in ('licenses/python', 'integrations', 'src-python', 'python-environment.json', 'rapidocr'):
            self.assertFalse(any(name.startswith(forbidden) for name in names), forbidden)

    def test_both_engine_builds_are_staged_from_their_pinned_archives(self):
        staged = []

        def record(archive, output, asset):
            staged.append((archive.name, output.name, asset['name']))
            self.fake_bundle(archive, output, asset)
        with patch.object(build_linux, 'run', side_effect=self.fake_run), \
                patch.object(build_linux, 'load_manifest', return_value=MANIFEST), \
                patch.object(build_linux, 'stage_bundle', side_effect=record), \
                patch.object(build_linux, 'verify_bundle'):
            build_linux.stage_internal(self.work, build_linux.speech_archives(MANIFEST, Path('/archives')))
        self.assertEqual(staged, [('vulkan.zip', 'speechcpp', 'vulkan.zip'), ('cpu.zip', 'speechcpp-cpu', 'cpu.zip')])

    def test_a_missing_helper_stops_the_build(self):
        def without_gate(argv, **options):
            self.fake_run(argv, **options)
            gate = self.work / 'build/astarot-voice-gate'
            if gate.exists():
                gate.unlink()
        with patch.object(build_linux, 'run', side_effect=without_gate), \
                patch.object(build_linux, 'load_manifest', return_value=MANIFEST), \
                patch.object(build_linux, 'stage_bundle', side_effect=self.fake_bundle), \
                patch.object(build_linux, 'verify_bundle'):
            with self.assertRaisesRegex(ValueError, 'astarot-voice-gate'):
                build_linux.stage_internal(self.work, ARCHIVES)

    def test_the_tauri_workspace_ships_no_sidecar(self):
        source = (Path(build_linux.ROOT) / 'tools/build_linux.py').read_text(encoding='utf-8')
        self.assertNotIn('PyInstaller', source)
        self.assertNotIn('vrct-vox-sidecar', source)
        self.assertIn("pop('externalBin', None)", source)


if __name__ == '__main__':
    unittest.main()
