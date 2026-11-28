"""tools/mutation_changed.py: what it mutates for a change, and how (#550, Phase 3)."""
from pathlib import Path
import sys
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import mutation_changed as subject  # noqa: E402


class MutationChangedTests(unittest.TestCase):
    def setUp(self):
        self.include, self.exclude = subject.config_patterns(subject.MUTATOR_CONFIG.read_text(encoding="utf-8"))

    def test_the_ui_sources_are_those_mutator_config_takes(self):
        self.assertIn("src-ui/logics/**/*.ts", self.include)
        self.assertIn("src-ui/views/**/*.tsx", self.include)
        changed = [
            "src-ui/logics/voice/modelCatalog.ts",
            "src-ui/views/kit/Button.tsx",
            "src-ui/views/kit/Button.css.ts",
            "src-ui/views/kit/kit.test.ts",
            "src-ui/logics/test/hookHarness.ts",
            "src-ui/logics/_test_data.ts",
            "src-ui/inertAttribute.d.ts",
            "src-ui/views/app/App.module.scss",
            "tools/dev.py",
            "native/ops/src/downloads/catalog.rs",
        ]
        self.assertEqual(subject.ui_sources(changed, self.include, self.exclude),
                         ["src-ui/logics/voice/modelCatalog.ts", "src-ui/views/kit/Button.tsx"])

    def test_a_rust_crate_counts_when_its_sources_changed(self):
        changed = ["native/ops/src/downloads/catalog.rs", "native/ops/tests/downloads.rs", "native/core/src/voice_settings.rs",
                   "native/core/Cargo.toml", "src-tauri/src/lib.rs", "native/browser-core-bridge/src/main.rs"]
        self.assertEqual(subject.rust_crates(changed), ["native/ops", "native/core"])

    def test_the_core_runs_in_place_with_its_unit_tests_and_the_others_in_parallel(self):
        diff = Path("change.diff")
        self.assertEqual(subject.rust_command("native/core", diff, None),
                         ["cargo", "mutants", "--in-diff", "change.diff", "--cargo-arg=--locked", "--in-place", "--", "--lib"])
        self.assertEqual(subject.rust_command("native/ops", diff, None)[-2:], ["-j", "4"])
        self.assertEqual(subject.rust_command("native/ops", diff, 2)[-2:], ["-j", "2"])

    def test_parallel_cargo_mutants_runs_build_in_their_own_target_directories(self):
        base = {"CARGO_TARGET_DIR": "/tmp/shared-target", "PATH": "/bin"}
        diff = Path("change.diff")
        parallel = subject.run_env(subject.rust_command("native/ops", diff, None), base)
        self.assertNotIn("CARGO_TARGET_DIR", parallel)
        self.assertEqual(parallel["PROPTEST_DISABLE_FAILURE_PERSISTENCE"], "1")
        self.assertEqual(parallel["PATH"], "/bin")
        in_place = subject.run_env(subject.rust_command("native/core", diff, None), base)
        self.assertEqual(in_place["CARGO_TARGET_DIR"], "/tmp/shared-target")
        ui = subject.run_env(subject.ui_command("abc123", None), base)
        self.assertEqual(ui["CARGO_TARGET_DIR"], "/tmp/shared-target")
        self.assertEqual(base, {"CARGO_TARGET_DIR": "/tmp/shared-target", "PATH": "/bin"})

    def test_the_ui_runs_only_the_mutants_in_the_diff(self):
        self.assertEqual(subject.ui_command("abc123", None), ["npm", "run", "test:mutation", "--", "--since", "abc123"])
        self.assertEqual(subject.ui_command("abc123", 8)[-2:], ["-j", "8"])

    def test_braces_expand_into_one_glob_each(self):
        self.assertEqual(subject.expand_braces("src/**/*.{ts,tsx}"), ["src/**/*.ts", "src/**/*.tsx"])
        self.assertEqual(subject.expand_braces("src/a.ts"), ["src/a.ts"])

    def test_mise_runs_it(self):
        tasks = tomllib.loads((ROOT / "mise.toml").read_text(encoding="utf-8"))["tasks"]
        self.assertEqual(tasks["mutation:changed"]["run"], "python tools/mutation_changed.py")


if __name__ == "__main__":
    unittest.main()
