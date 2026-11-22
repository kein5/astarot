"""What an exception in osv-scanner.toml rests on, checked in the lock files and manifests.

chrono (RUSTSEC-2026-0543) stays an exception after #879 only because Cargo keeps an unused
optional dependency in a lock file: no crate of this repository uses chrono, and the Tauri app's
lock file lists it as an optional dependency of serde_with that nothing turns on. These tests fail
when chrono comes back into the build, so that the exception does not hide it.
"""
from pathlib import Path
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[2]
APP_LOCK = ROOT / "src-tauri/Cargo.lock"


def lock_files():
    return sorted(path for path in [APP_LOCK, *ROOT.glob("native/*/Cargo.lock")] if path.is_file())


def manifests():
    return sorted(path for path in [ROOT / "src-tauri/Cargo.toml", *ROOT.glob("native/*/Cargo.toml")] if path.is_file())


def packages(lock):
    return tomllib.loads(lock.read_text(encoding="utf-8")).get("package", [])


def dependents(lock, name):
    """The packages of a lock file that depend on `name`."""
    return {package["name"] for package in packages(lock)
            if any(dependency.split(" ")[0] == name for dependency in package.get("dependencies", []))}


def asked_for(manifest):
    """Every crate a manifest names as a dependency, and every feature it turns on."""
    names = set()

    def tables(node):
        for key, value in node.items():
            if not isinstance(value, dict):
                continue
            if key in ("dependencies", "dev-dependencies", "build-dependencies"):
                yield value
            else:
                yield from tables(value)

    data = tomllib.loads(manifest.read_text(encoding="utf-8"))
    for table in tables(data):
        for crate, spec in table.items():
            names.add(crate)
            if isinstance(spec, dict):
                names.update(spec.get("features", []))
    for features in data.get("features", {}).values():
        names.update(features)
    return names


class ChronoStaysOutTests(unittest.TestCase):
    def test_only_the_apps_lock_file_lists_chrono_and_only_for_serde_with(self):
        self.assertTrue(lock_files())
        for lock in lock_files():
            with self.subTest(lock=str(lock.relative_to(ROOT))):
                if lock == APP_LOCK:
                    self.assertLessEqual(dependents(lock, "chrono"), {"serde_with"})
                else:
                    self.assertNotIn("chrono", {package["name"] for package in packages(lock)})

    def test_no_manifest_asks_for_chrono(self):
        # Neither as a dependency nor through a feature that turns it on (serde_with's
        # chrono_0_4, for one).
        for manifest in manifests():
            with self.subTest(manifest=str(manifest.relative_to(ROOT))):
                self.assertEqual({name for name in asked_for(manifest) if "chrono" in name}, set())


if __name__ == "__main__":
    unittest.main()
