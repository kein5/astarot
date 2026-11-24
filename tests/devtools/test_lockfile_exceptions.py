"""What an exception in osv-scanner.toml rests on, checked in the lock files and manifests.

chrono (RUSTSEC-2026-0543) stays an exception after #879 only because Cargo keeps an unused
optional dependency in a lock file: no crate of this repository uses chrono, and the Tauri app's
lock file lists it as an optional dependency of serde_with that nothing turns on. These tests fail
when chrono comes back into the build, so that the exception does not hide it.

glob 13 and minimatch 10 (GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249) stay exceptions only while they
come, as development dependencies, through the one Storybook plugin that the component catalog does
not load. An exception covers the advisory wherever it appears, so these tests fail when a package
with the advisory comes in another way.
"""
import json
from pathlib import Path
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[2]
APP_LOCK = ROOT / "src-tauri/Cargo.lock"
NPM_LOCK = ROOT / "package-lock.json"
STORYBOOK_MAIN = ROOT / ".storybook/main.ts"
DOCGEN_PLUGIN = "node_modules/@joshwooding/vite-plugin-react-docgen-typescript"


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


def version(text):
    """A release's numbers, without a pre-release part: "13.0.7" is (13, 0, 7)."""
    return tuple(int(part) for part in text.split("-")[0].split("."))


def resolve(packages, path, name):
    """The entry of package-lock.json that `name` resolves to for the package at `path`: the nearest
    node_modules folder that has it, from the package's own up to the root's."""
    where = path
    while True:
        candidate = f"{where}/node_modules/{name}" if where else f"node_modules/{name}"
        if candidate in packages:
            return candidate
        if not where:
            return None
        cut = where.rfind("/node_modules/")
        where = where[:cut] if cut >= 0 else ""


def npm_dependents(packages, entry):
    """The packages of package-lock.json whose dependencies resolve to `entry`."""
    name = entry.rsplit("node_modules/", 1)[1]
    return {path for path, package in packages.items()
            if any(dependency == name and resolve(packages, path, dependency) == entry
                   for table in ("dependencies", "optionalDependencies", "peerDependencies")
                   for dependency in package.get(table, {}))}


class StorybookAdvisoriesStayUnusedTests(unittest.TestCase):
    # The first release of each that has the fix.
    FIXED = {"glob": (14, 0, 2), "minimatch": (11, 0, 1)}

    def setUp(self):
        self.packages = json.loads(NPM_LOCK.read_text(encoding="utf-8"))["packages"]

    def with_advisory(self, name):
        return {path for path, package in self.packages.items()
                if path.rsplit("node_modules/", 1)[-1] == name and version(package["version"]) < self.FIXED[name]}

    def test_glob_and_minimatch_with_the_advisories_come_only_through_the_docgen_plugin(self):
        globs = self.with_advisory("glob")
        for entry in globs:
            self.assertEqual(npm_dependents(self.packages, entry), {DOCGEN_PLUGIN}, entry)
        for entry in self.with_advisory("minimatch"):
            self.assertLessEqual(npm_dependents(self.packages, entry), globs, entry)
        for entry in {DOCGEN_PLUGIN} | globs | self.with_advisory("minimatch"):
            if entry in self.packages:
                self.assertTrue(self.packages[entry].get("dev"), f"{entry} is not a development dependency")

    def test_the_catalog_does_not_load_the_docgen_plugin(self):
        # @storybook/react-vite imports the plugin only for reactDocgen: "react-docgen-typescript".
        self.assertRegex(STORYBOOK_MAIN.read_text(encoding="utf-8"), r"\breactDocgen: false\b")


if __name__ == "__main__":
    unittest.main()
