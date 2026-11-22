"""Where the developer shortcuts live (2026-11-21): the shortcuts to tools/dev.py are mise tasks
(mise.toml), and package.json keeps the scripts that need npm (Vite, Tauri, Vitest, the type
check, the app's dev, build and release chains). When both held them, they drifted: npm's
check:commits had no --base, and its scope checks were named test:* where mise's are check:*."""
import importlib.util
import json
from pathlib import Path
import re
import sys
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools/dev.py"


class DevShortcutsTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("vox_dev_shortcuts", SCRIPT)
        self.dev = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = self.dev
        spec.loader.exec_module(self.dev)
        self.tasks = tomllib.loads((ROOT / "mise.toml").read_text(encoding="utf-8"))["tasks"]
        self.scripts = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]

    def test_the_development_cli_is_reached_through_mise_only(self):
        through_npm = {name: script for name, script in self.scripts.items() if "tools/dev.py" in script}
        self.assertEqual(through_npm, {}, "tools/dev.py's shortcuts are mise tasks (docs/development.md)")

    def test_a_scope_task_is_named_after_its_scope(self):
        for name, task in self.tasks.items():
            run = task["run"]
            found = re.fullmatch(r"python tools/dev\.py (check|setup)(?: --scope (\S+))?(.*)", run)
            if not found:
                self.assertNotIn("tools/dev.py check", run, name)
                self.assertNotIn("tools/dev.py setup", run, name)
                continue
            command, scope, rest = found.groups()
            known = self.dev.SCOPES if command == "check" else self.dev.SETUP_SCOPES
            if scope is None:
                self.assertEqual((name, rest), (command, ""), "the command's default scope")
                continue
            self.assertIn(scope, known, name)
            self.assertEqual(name, f"{command}:{scope}", run)
            # A check of new commits compares them with develop as the clone fetched it; a later
            # --base on the command line takes its place.
            self.assertIn(rest, ("", " --base origin/develop"), name)
            if scope == "commits":
                self.assertEqual(rest, " --base origin/develop", "the commit check needs a base")

    def test_a_task_that_hands_over_to_npm_names_one_of_its_scripts(self):
        handed = {name: task["run"].split()[2] for name, task in self.tasks.items() if task["run"].startswith("npm run ")}
        self.assertTrue(handed, "build:windows and dev:web hand over to npm")
        for name, script in handed.items():
            self.assertIn(script, self.scripts, name)


if __name__ == "__main__":
    unittest.main()
