"""Offline contracts for the developer entry point; no product imports."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools/dev.py"


class DeveloperCLITests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), "developer entry point is missing")
        spec = importlib.util.spec_from_file_location("vox_dev_cli", SCRIPT)
        self.dev = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = self.dev
        spec.loader.exec_module(self.dev)
        self.tmp = tempfile.TemporaryDirectory(prefix="vox dev tests ")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "package.json").write_text('{"name":"vrct-vox"}')
        (self.root / "package-lock.json").write_text('{}')
        (self.root / "pyproject.toml").write_text('[project]\nname = "vrct-vox"\n')

    def call(self, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            code = self.dev.main(list(args), root=self.root)
        return code, output.getvalue()

    def test_doctor_reports_missing_environment_without_installing(self):
        with patch.dict(os.environ, {"PATH": ""}):
            code, output = self.call("doctor", "--scope", "voice", "--json")
        self.assertEqual(code, 2)
        report = json.loads(output)
        self.assertFalse(report["ok"])
        self.assertTrue(any(row["status"] == "missing" for row in report["checks"]))
        self.assertIn("setup --scope headless", output)
        self.assertFalse((self.root / "build").exists())

    def test_doctor_names_the_versions_pinned_in_mise_toml(self):
        (self.root / "mise.toml").write_text(
            '[tools]\nnode = "22.15.0"\nrust = { version = "1.100.0", profile = "minimal" }\n'
            'cocogitto = "7.0.0"\n', encoding="utf-8")
        self.assertEqual(self.dev.pinned_versions(self.root), {"node": "22.15.0", "cargo": "1.100.0", "cog": "7.0.0"})
        with patch.dict(os.environ, {"PATH": ""}):
            code, output = self.call("doctor", "--scope", "node", "--json")
        self.assertEqual(code, 2)
        self.assertIn("mise.toml pins 22.15.0", output)

    def test_doctor_runs_without_mise_toml(self):
        self.assertEqual(self.dev.pinned_versions(self.root), {})
        self.assertIsNone(self.dev.python_series(self.root))
        (self.root / "mise.toml").write_text("not = [toml", encoding="utf-8")
        self.assertEqual(self.dev.pinned_versions(self.root), {})
        self.assertIsNone(self.dev.python_series(self.root))

    def test_the_python_version_comes_from_mise_toml_alone(self):
        (self.root / "mise.toml").write_text('[tools]\npython = "3.14.10"\n', encoding="utf-8")
        self.assertEqual(self.dev.python_series(self.root), (3, 14))
        # A new owned environment asks uv for that version, never for a download.
        code, output = self.call("setup", "--scope", "headless", "--dry-run")
        self.assertEqual(code, 0, output)
        self.assertIn("venv --python 3.14 --no-python-downloads", output)
        # doctor holds the test environments to it.
        target = self.root / "build/dev/headless-venv"
        python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        python.parent.mkdir(parents=True)
        python.write_text("")
        with patch.object(self.dev, "probe", return_value=subprocess.CompletedProcess([], 0, "3.14.10", "")) as probe:
            self.call("doctor", "--scope", "voice", "--json")
        self.assertIn("sys.version_info[:2] == (3, 14)", probe.call_args.args[0][-1])

    def test_an_owned_environment_of_another_python_is_made_again(self):
        (self.root / "mise.toml").write_text('[tools]\npython = "3.14.10"\n', encoding="utf-8")
        target = self.root / "build/dev/headless-venv"
        python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        python.parent.mkdir(parents=True)
        python.write_text("")
        (target / self.dev.OWNER_FILE).write_text(self.dev.OWNER, encoding="utf8")
        (target / "pyvenv.cfg").write_text("home = x\nversion_info = 3.11.18\n", encoding="utf-8")
        code, output = self.call("setup", "--scope", "headless", "--dry-run")
        self.assertEqual(code, 0, output)
        self.assertIn("venv --python 3.14 --clear --no-python-downloads", output)
        # One made with the pinned Python is only synced.
        (target / "pyvenv.cfg").write_text("home = x\nversion_info = 3.14.10\n", encoding="utf-8")
        code, output = self.call("setup", "--scope", "headless", "--dry-run")
        self.assertEqual(code, 0, output)
        self.assertNotIn(" venv ", output)
        self.assertIn("pip sync", output)

    def test_browser_setup_refuses_a_venv_of_another_python(self):
        (self.root / "mise.toml").write_text('[tools]\npython = "3.14.10"\n', encoding="utf-8")
        with patch.object(self.dev, "probe", return_value=subprocess.CompletedProcess(
            [], 0, '{"venv":true,"version":[3,11]}', '')), \
                patch.object(self.dev, "execute", return_value=0) as execute:
            code, output = self.call("setup", "--scope", "browser", "--python", sys.executable)
        self.assertEqual(code, 2)
        self.assertIn("Python 3.14 virtual environment", output)
        execute.assert_not_called()

    def test_dry_setup_can_be_reviewed_before_tools_are_installed(self):
        with patch.dict(os.environ, {"PATH": ""}):
            code, output = self.call("setup", "--scope", "headless", "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("--only-group voice-test", output)
        self.assertIn("--python", output)
        self.assertFalse((self.root / "build").exists())

    def test_headless_syncs_an_exact_export_of_the_lock(self):
        # uv export emits the full transitive set (pytest's pluggy etc.), so the
        # owned environment can be synced to it exactly without re-resolving.
        code, output = self.call("setup", "--scope", "headless", "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("export --quiet --frozen", output)
        self.assertIn("pip sync", output)
        self.assertNotIn("--no-hashes", output)
        self.assertIn("check_python_lock.py", output)
        self.assertLess(output.index("check_python_lock.py"), output.index("export --quiet --frozen"))

    def test_setup_cannot_inherit_disabled_hash_verification(self):
        with patch.dict(os.environ, {"UV_NO_VERIFY_HASHES": "1"}):
            self.assertEqual(self.dev.child_environment()["UV_NO_VERIFY_HASHES"], "0")

    def test_children_run_with_onnx_runtime_usage_reports_off(self):
        # The onnxruntime wheel (1.32) sends usage events unless this is set (#574).
        with patch.dict(os.environ, {"ORT_DISABLE_TELEMETRY": "0"}):
            self.assertEqual(self.dev.child_environment()["ORT_DISABLE_TELEMETRY"], "1")

    def test_mise_exports_onnx_runtime_usage_reports_off(self):
        mise = tomllib.loads((ROOT / "mise.toml").read_text(encoding="utf-8"))
        self.assertEqual(mise["env"], {"ORT_DISABLE_TELEMETRY": "1"})

    def test_missing_python_dependency_is_a_prerequisite_error(self):
        target = self.root / "build/dev/headless-venv"
        python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        python.parent.mkdir(parents=True)
        python.write_text("")
        with patch.object(self.dev, "probe", return_value=subprocess.CompletedProcess(
            [], 1, '', 'PackageNotFoundError: pytest')):
            code, output = self.call("check", "--scope", "voice")
        self.assertEqual(code, 2)
        self.assertIn("setup --scope headless", output)

    def test_setup_refuses_unowned_environment_without_deleting_it(self):
        target = self.root / "build/dev/headless-venv"
        target.mkdir(parents=True)
        sentinel = target / "user-data"
        sentinel.write_bytes(b"keep me")
        code, output = self.call("setup", "--scope", "headless")
        self.assertEqual(code, 2)
        self.assertIn("owned", output)
        self.assertEqual(sentinel.read_bytes(), b"keep me")

    @unittest.skipIf(os.name == "nt", "symlinks require Windows privilege")
    def test_setup_refuses_symlinked_parent(self):
        external = self.root / "elsewhere"
        external.mkdir()
        (self.root / "build").symlink_to(external, target_is_directory=True)
        code, _ = self.call("setup", "--scope", "headless")
        self.assertEqual(code, 2)
        self.assertEqual(list(external.iterdir()), [])

    def test_node_scope_runs_the_installed_vitest(self):
        folder = self.root / "src-ui/area with spaces"
        folder.mkdir(parents=True)
        # Any one of the patterns in vitest.config.js counts as a test.
        for name in ("one.test.js", "future.test.mjs", "typed.test.ts"):
            (folder / name).write_text('')
            code, output = self.call("check", "--scope", "node", "--dry-run")
            self.assertEqual(code, 0, name)
            # Vitest finds the files itself; Node runs the local copy.
            self.assertIn("node_modules/vitest/vitest.mjs run", output)
            self.assertNotIn("npx", output)
            self.assertNotIn("npm ci", output)
            (folder / name).unlink()

    def test_node_scope_asks_for_setup_when_vitest_is_missing(self):
        (self.root / "src-ui").mkdir(parents=True)
        (self.root / "src-ui/one.test.js").write_text('')
        code, output = self.call("check", "--scope", "node")
        self.assertEqual(code, 2)
        self.assertIn("setup --scope ui", output)

    def test_node_scope_runs_the_i18n_gate_and_its_tests(self):
        (self.root / "src-ui").mkdir(parents=True)
        (self.root / "src-ui/one.test.js").write_text('')
        code, output = self.call("check", "--scope", "node", "--dry-run")
        self.assertEqual(code, 0)
        # The gate runs after the tests; Vitest runs the gate's own tests (vitest.config.js).
        self.assertLess(output.index("vitest.mjs run"), output.index("tools/i18n_gate/check.mjs"))
        config = (Path(__file__).resolve().parents[2] / "vitest.config.js").read_text(encoding="utf-8")
        self.assertIn("tools/i18n_gate/**/*.test.mjs", config)

    def test_ui_scope_runs_the_type_check_before_the_build(self):
        folder = self.root / "src-ui"
        folder.mkdir(parents=True)
        (folder / "one.test.js").write_text('')
        code, output = self.call("check", "--scope", "ui", "--dry-run")
        self.assertEqual(code, 0)
        self.assertLess(output.index("typecheck"), output.index("vite-build"))

    def test_node_scope_does_not_pass_when_no_tests_were_found(self):
        code, output = self.call("check", "--scope", "node", "--dry-run")
        self.assertEqual(code, 2)
        self.assertIn("No UI tests", output)

    def test_rust_check_uses_only_locked_cached_dependencies(self):
        code, output = self.call("check", "--scope", "rust", "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("--offline", output)
        self.assertIn("--locked", output)
        self.assertNotIn("cargo fetch", output)

    def test_browser_setup_adds_dependencies_to_explicit_existing_python(self):
        code, output = self.call("setup", "--scope", "browser", "--python",
            sys.executable, "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("--only-group voice-ui-test", output)
        self.assertIn("pip install", output)
        self.assertNotIn("pip sync", output)
        self.assertNotIn("--no-hashes", output)
        self.assertIn("check_python_lock.py", output)
        self.assertNotIn("--with-deps", output)

    def test_browser_setup_refuses_system_interpreter(self):
        with patch.object(self.dev, "probe", return_value=subprocess.CompletedProcess(
            [], 0, '{"venv":false,"version":[3,14]}', '')), \
                patch.object(self.dev, "execute", return_value=0):
            code, output = self.call("setup", "--scope", "browser", "--python", sys.executable)
        self.assertEqual(code, 2)
        self.assertIn("virtual environment", output)

    def test_browser_doctor_selects_browser_environment(self):
        target = self.root / "build/dev/browser-venv"
        python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        python.parent.mkdir(parents=True)
        python.write_text("")
        with patch.object(self.dev, "probe", return_value=subprocess.CompletedProcess(
            [], 0, '3.14.10\npytest 9.2.0\nplaywright 1.65.2', '')):
            code, output = self.call("doctor", "--scope", "browser", "--json")
        self.assertEqual(code, 0, output)

    def test_linux_tray_library_accepts_either_provider_but_not_neither(self):
        resources = self.root / "src-tauri/bin/_internal"
        resources.mkdir(parents=True)
        (resources / "resource").write_text("existing")
        for available in ("appindicator3-0.1", "ayatana-appindicator3-0.1", None):
            with self.subTest(available=available):
                def lookup(argv, root):
                    if "-vV" in argv:
                        return subprocess.CompletedProcess(argv, 0, "host: x86_64-unknown-linux-gnu\n", "")
                    if argv[0] == "pkg-config":
                        missing = argv[-1] in ("appindicator3-0.1", "ayatana-appindicator3-0.1") and argv[-1] != available
                        return subprocess.CompletedProcess(argv, int(missing), "", "")
                    return subprocess.CompletedProcess(argv, 0, "cargo 1.99.1", "")
                with patch.object(self.dev.sys, "platform", "linux"), \
                        patch.object(self.dev.shutil, "which", side_effect=lambda name: name), \
                        patch.object(self.dev, "probe", side_effect=lookup):
                    code, output = self.call("doctor", "--scope", "rust", "--json")
                self.assertEqual(code, 0 if available else 2, output)
                if available:
                    self.assertIn(available, output)

    def test_commits_requires_explicit_base_instead_of_scanning_old_history(self):
        code, output = self.call("check", "--scope", "commits", "--dry-run")
        self.assertEqual(code, 2)
        self.assertIn("--base", output)

    def test_unknown_base_is_not_treated_as_empty_success(self):
        code, _ = self.call("check", "--scope", "commits", "--base", "missing-base")
        self.assertEqual(code, 2)

    def test_tooling_does_not_inherit_live_acceptance_flags(self):
        test_dir = self.root / "tests/devtools"
        test_dir.mkdir(parents=True)
        (test_dir / "test_probe.py").write_text(
            'import os, unittest\n'
            'class Probe(unittest.TestCase):\n'
            ' def test_environment(self):\n'
            '  self.assertNotIn("VRCT_SEED_POC", os.environ)\n'
            '  self.assertNotIn("VRCT_TEST_NATIVE_GUI", os.environ)\n'
            '  self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")\n'
            '  self.assertNotIn("PYTEST_ADDOPTS", os.environ)\n',
            encoding="utf8",
        )
        with patch.dict(os.environ, {
            "VRCT_SEED_POC": "never-start", "VRCT_TEST_NATIVE_GUI": "1",
            "PYTEST_ADDOPTS": "--unwanted", "HF_HUB_OFFLINE": "0",
        }):
            code, _ = self.call("check", "--scope", "tooling")
        self.assertEqual(code, 0)

    def test_failure_stops_plan_and_propagates_nonzero_exit(self):
        marker = self.root / "must-not-exist"
        steps = [
            self.dev.Step("failure", [sys.executable, "-c", "raise SystemExit(7)"]),
            self.dev.Step("later", [sys.executable, "-c", f"open({str(marker)!r}, 'w').close()"]),
        ]
        with contextlib.redirect_stdout(io.StringIO()):
            code = self.dev.execute(steps, self.root, dry_run=False)
        self.assertEqual(code, 1)
        self.assertFalse(marker.exists())

    def test_child_receives_space_and_shell_characters_as_one_argument(self):
        value = "path with spaces;$(not-a-command)"
        step = self.dev.Step("argv", [sys.executable, "-c",
            "import sys; assert sys.argv[1] == 'path with spaces;$(not-a-command)'", value])
        with contextlib.redirect_stdout(io.StringIO()):
            code = self.dev.execute([step], self.root, dry_run=False)
        self.assertEqual(code, 0)

    def test_help_runs_without_site_packages(self):
        result = subprocess.run([sys.executable, "-S", str(SCRIPT), "--help"],
            capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertIn("doctor", result.stdout)
        self.assertIn("check", result.stdout)


if __name__ == "__main__":
    unittest.main()
