"""tools/rust_licenses.py: which crates a build lists, where their texts come from, and what it writes."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import rust_licenses as rl  # noqa: E402
import app_resources  # noqa: E402

NORMAL, BUILD, DEV = [{"kind": None, "target": None}], [{"kind": "build", "target": None}], [{"kind": "dev", "target": None}]


def package(folder, name, version="1.0.0", license_="MIT", files=("LICENSE",), source="registry"):
    path = Path(folder) / f"{name}-{version}"
    path.mkdir(parents=True, exist_ok=True)
    (path / "Cargo.toml").write_text("[package]\n")
    for file in files:
        (path / file).write_text(f"{name} {file}\n")
    return {"id": f"{name} {version}", "name": name, "version": version, "license": license_,
            "license_file": None, "repository": None, "manifest_path": str(path / "Cargo.toml"),
            "source": None if source is None else f"{source}+https://github.com/rust-lang/crates.io-index"}


def meta(root, packages, edges):
    """edges: {id: [(dep id, dep_kinds)]}"""
    nodes = [{"id": item["id"], "deps": [{"pkg": dep, "dep_kinds": kinds} for dep, kinds in edges.get(item["id"], [])]}
             for item in packages]
    return {"packages": packages, "resolve": {"root": root, "nodes": nodes}}


class ShippedPackagesTest(unittest.TestCase):
    def test_follows_normal_dependencies_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = package(tmp, "app", source=None)
            lib, macro, inner = package(tmp, "lib"), package(tmp, "macro"), package(tmp, "inner")
            builder, tester = package(tmp, "cc"), package(tmp, "tester")
            data = meta(app["id"], [app, lib, macro, inner, builder, tester], {
                app["id"]: [(lib["id"], NORMAL), (macro["id"], NORMAL), (builder["id"], BUILD), (tester["id"], DEV)],
                lib["id"]: [(inner["id"], NORMAL)],
            })
            names = {item["name"] for item in rl.shipped_packages(data)}
            self.assertEqual(names, {"app", "lib", "macro", "inner"})

    def test_a_dependency_used_both_ways_is_listed(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, both = package(tmp, "app", source=None), package(tmp, "both")
            data = meta(app["id"], [app, both], {app["id"]: [(both["id"], BUILD + NORMAL)]})
            self.assertEqual({item["name"] for item in rl.shipped_packages(data)}, {"app", "both"})


class CollectTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)

    def load_for(self, graphs):
        def load(manifest, target, features, *, offline, cargo):
            return graphs[manifest]
        return load

    def test_merges_the_executables_and_keeps_own_code_without_texts(self):
        app, worker = package(self.folder, "app", source=None), package(self.folder, "worker", source=None)
        shared = package(self.folder, "shared", files=("LICENSE-MIT", "LICENSE-APACHE", "README.md"))
        graphs = {"src-tauri/Cargo.toml": meta(app["id"], [app, shared], {app["id"]: [(shared["id"], NORMAL)]}),
                  "native/rvc-runtime/Cargo.toml": meta(worker["id"], [worker, shared],
                                                        {worker["id"]: [(shared["id"], NORMAL)]})}
        crates = rl.collect("x86_64-pc-windows-msvc", load=self.load_for(graphs))
        self.assertEqual(crates[("shared", "1.0.0")]["binaries"], ["astarot", "astarot-rvc-worker"])
        self.assertEqual(set(crates[("shared", "1.0.0")]["files"]), {"LICENSE-MIT", "LICENSE-APACHE"})
        self.assertTrue(crates[("app", "1.0.0")]["local"])
        self.assertEqual(crates[("app", "1.0.0")]["files"], {})

    def test_a_crate_without_texts_uses_its_reviewed_supplement(self):
        app = package(self.folder, "app", source=None)
        bare = package(self.folder, "dwrote", version="0.11.5", license_="MPL-2.0", files=())
        graph = meta(app["id"], [app, bare], {app["id"]: [(bare["id"], NORMAL)]})
        crates = rl.collect("x86_64-pc-windows-msvc", load=self.load_for(
            {"src-tauri/Cargo.toml": graph, "native/rvc-runtime/Cargo.toml": meta(app["id"], [app], {})}))
        files = crates[("dwrote", "0.11.5")]["files"]
        self.assertEqual(files, {"LICENSE": rl.SUPPLEMENTS / "dwrote-0.11.5/LICENSE"})

    def test_a_crate_without_texts_or_supplement_stops_the_build(self):
        app = package(self.folder, "app", source=None)
        bare = package(self.folder, "unreviewed", version="9.9.9", files=())
        graph = meta(app["id"], [app, bare], {app["id"]: [(bare["id"], NORMAL)]})
        with self.assertRaises(SystemExit) as raised:
            rl.collect("x86_64-pc-windows-msvc", load=self.load_for(
                {"src-tauri/Cargo.toml": graph, "native/rvc-runtime/Cargo.toml": meta(app["id"], [app], {})}))
        self.assertIn("unreviewed 9.9.9", str(raised.exception))


class WriteTest(unittest.TestCase):
    def test_writes_the_texts_and_an_index_that_checks_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = package(tmp, "shared")
            crates = {("shared", "1.0.0"): {"name": "shared", "version": "1.0.0", "license": "MIT", "repository": None,
                                            "local": False, "binaries": ["astarot"],
                                            "files": {"LICENSE": Path(source["manifest_path"]).parent / "LICENSE"}},
                      ("app", "0.0.0"): {"name": "app", "version": "0.0.0", "license": None, "repository": None,
                                         "local": True, "binaries": ["astarot"], "files": {}}}
            output = Path(tmp) / "out"
            rl.write(output, crates, "x86_64-unknown-linux-gnu")
            self.assertEqual((output / "shared-1.0.0/LICENSE").read_text(), "shared LICENSE\n")
            self.assertFalse((output / "app-0.0.0").exists())
            self.assertIn("| app | 0.0.0 | VRCT-VOX | astarot |", (output / "README.md").read_text(encoding="utf-8"))
            self.assertEqual(rl.missing_files(output), [])
            (output / "shared-1.0.0/LICENSE").unlink()
            self.assertEqual(rl.missing_files(output), ["shared-1.0.0/LICENSE"])
            # Writing again replaces its own folder.
            rl.write(output, crates, "x86_64-unknown-linux-gnu")
            self.assertEqual(rl.missing_files(output), [])

    def test_the_list_carries_the_attribution_of_a_crate_in_the_build(self):
        row = {"name": "webpki-roots", "version": "1.0.11", "license": "CDLA-Permissive-2.0", "local": False,
               "binaries": ["astarot"], "files": ["webpki-roots-1.0.11/LICENSE"]}
        self.assertIn("Common CA Database (CCADB)", rl.readme([row], "x86_64-pc-windows-msvc"))
        other = dict(row, name="shared", license="MIT")
        self.assertNotIn("## Attributions", rl.readme([other], "x86_64-pc-windows-msvc"))

    def test_refuses_to_replace_a_folder_it_did_not_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "keep.txt").write_text("mine")
            with self.assertRaises(SystemExit):
                rl.write(tmp, {}, "x86_64-unknown-linux-gnu")
            self.assertTrue((Path(tmp) / "keep.txt").is_file())

    def test_an_empty_folder_is_missing_its_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(rl.missing_files(tmp), ["crates.json"])


class SupplementsTest(unittest.TestCase):
    def test_every_supplement_has_its_texts_and_sources(self):
        record = json.loads((rl.SUPPLEMENTS / "supplements.json").read_text(encoding="utf-8"))["crates"]
        folders = {path.name for path in rl.SUPPLEMENTS.iterdir() if path.is_dir()}
        self.assertEqual(folders, set(record))
        for key, entry in record.items():
            self.assertTrue(entry["license"], key)
            on_disk = {path.name for path in (rl.SUPPLEMENTS / key).iterdir()}
            self.assertEqual(on_disk, set(entry["files"]), key)
            for name, url in entry["files"].items():
                self.assertTrue(url.startswith("https://"), (key, name))
                self.assertGreater((rl.SUPPLEMENTS / key / name).stat().st_size, 500, (key, name))


class NoticeTest(unittest.TestCase):
    # What NOTICE.md must say for each crate in rl.ATTRIBUTIONS.
    NOTICE_PHRASES = {"webpki-roots": "Common CA Database (CCADB)"}

    def test_notice_carries_the_attributions_of_the_locked_crates(self):
        self.assertEqual(set(self.NOTICE_PHRASES), set(rl.ATTRIBUTIONS))
        notice = (ROOT / "NOTICE.md").read_text(encoding="utf-8")
        locks = "".join((ROOT / manifest).with_name("Cargo.lock").read_text(encoding="utf-8")
                        for _, manifest, _ in rl.SHIPPED)
        locked = [name for name in rl.ATTRIBUTIONS if f'name = "{name}"\n' in locks]
        self.assertTrue(locked, "no crate in ATTRIBUTIONS is locked any more; review the list")
        for name in locked:
            self.assertIn(self.NOTICE_PHRASES[name], notice, name)


class AppResourcesTest(unittest.TestCase):
    def test_the_package_carries_the_collected_texts(self):
        with tempfile.TemporaryDirectory() as tmp:
            rust = Path(tmp) / "build/licenses/rust"
            (rust / "shared-1.0.0").mkdir(parents=True)
            (rust / "crates.json").write_text("{}")
            (rust / "shared-1.0.0/LICENSE").write_text("x")
            for platform in ("windows", "linux"):
                pairs = {(Path(source).name, target) for source, target in
                         app_resources.pairs(platform, Path(tmp) / "build", ROOT)}
                self.assertIn(("crates.json", "licenses/rust/crates.json"), pairs)
                self.assertIn(("LICENSE", "licenses/rust/shared-1.0.0/LICENSE"), pairs)
                self.assertIn("licenses/rust/crates.json", app_resources.required(platform))

if __name__ == "__main__":
    unittest.main()
