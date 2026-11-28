"""The component map in docs/development.md is generated from its data file, and new Cargo packages show up
as warnings."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools/component_map.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("component_map_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    # dataclass looks the module up by name to read its annotations.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


TOOL = load_tool()

GUIDE = """# Guide

[日本語版](#ガイド日本語版)

Text.

## Component map

<!-- component-map:en:start -->
<!-- component-map:en:end -->

More English text.

---

# ガイド（日本語版）

## 構成図

<!-- component-map:ja:start -->
<!-- component-map:ja:end -->

日本語の続き。
"""

DATA = """
[system]
id = "astarot"
name = "ASTAROT"
repository = "kein5/astarot"

[[component]]
id = "alpha"
name = "Alpha"
kind = "internal"
role = "core"
role_ja = "中核"
path = "native/alpha"

[[component]]
id = "kit"
name = "Kit"
kind = "internal"
role = "UI kit"
role_ja = "UIのkit"
path = "src-ui/kit"

[[component]]
id = "outer"
name = "OUTER"
kind = "external"
role = "tool"
role_ja = "道具"
repository = "kein5/outer"
status = "design phase"
status_ja = "設計の段階"

[[relation]]
from = "astarot"
to = "outer"
line = "solid"

[[relation]]
from = "kit"
to = "outer"
line = "dashed"
label = "planned move"
label_ja = "移す予定"
"""


class ComponentMapRepositoryTests(unittest.TestCase):
    def test_repository_passes_the_check(self):
        run = subprocess.run([sys.executable, str(SCRIPT), "--check"], cwd=ROOT,
                             capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_every_entry_is_in_both_blocks(self):
        data = tomllib.loads((ROOT / TOOL.DATA).read_text(encoding="utf-8"))
        parts = TOOL.split_blocks((ROOT / TOOL.DOC).read_text(encoding="utf-8"), [])
        english, japanese = parts[1], parts[3]
        # The English block is in the English version of the guide, the Japanese block after the divider.
        self.assertIn("\n---\n\n# ASTAROTの開発（日本語版）", parts[2])
        for entry in data["component"]:
            with self.subTest(entry["id"]):
                self.assertIn(f'{entry["id"]}["<b>{entry["name"]}</b>', english)
                self.assertIn(f'{entry["id"]}["<b>{entry["name"]}</b>', japanese)
                self.assertIn(f'| {entry["name"]} |', english)
                self.assertIn(f'| {entry["role_ja"]} |', japanese)


class ComponentMapFixtureTests(unittest.TestCase):
    """A small repository; each test changes one thing and runs the tool on it."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "tools").mkdir()
        (self.root / "docs").mkdir()
        (self.root / "src-ui/kit").mkdir(parents=True)
        (self.root / TOOL.DOC).write_text(GUIDE, encoding="utf-8")
        self.package("native/alpha", "astarot-alpha")
        self.data(DATA)
        code, printed = self.run_tool("--write")
        self.assertEqual(code, 0, printed)
        self.assertIn("wrote the component map in docs/development.md", printed)

    def tearDown(self):
        self.temp.cleanup()

    def data(self, text):
        (self.root / TOOL.DATA).write_text(text, encoding="utf-8")

    def edit(self, old, new):
        text = (self.root / TOOL.DATA).read_text(encoding="utf-8")
        self.assertIn(old, text)
        self.data(text.replace(old, new, 1))

    def package(self, folder, name, extra=""):
        (self.root / folder).mkdir(parents=True, exist_ok=True)
        (self.root / folder / "Cargo.toml").write_text(f'[package]\nname = "{name}"\n{extra}', encoding="utf-8")

    def page(self):
        return (self.root / TOOL.DOC).read_text(encoding="utf-8")

    def blocks(self):
        parts = TOOL.split_blocks(self.page(), [])
        self.assertIsNotNone(parts)
        return parts

    def run_tool(self, mode):
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            code = TOOL.main([mode], root=self.root)
        return code, printed.getvalue()

    def assertFails(self, fragment):
        code, printed = self.run_tool("--check")
        self.assertEqual(code, 1, printed)
        self.assertIn(fragment, printed)

    def test_check_passes_on_a_current_page_and_write_keeps_it(self):
        self.assertEqual(self.run_tool("--check"), (0, ""))
        self.assertEqual(self.run_tool("--write"), (0, ""))

    def test_write_fills_only_the_two_blocks(self):
        before, english, between, japanese, after = self.blocks()
        outside = GUIDE.split("<!-- component-map:en:start -->")[0]
        self.assertEqual(before, outside)
        self.assertEqual(between, "\n\nMore English text.\n\n---\n\n# ガイド（日本語版）\n\n## 構成図\n\n")
        self.assertEqual(after, "\n\n日本語の続き。\n")
        self.assertNotIn(b"\r\n", (self.root / TOOL.DOC).read_bytes())
        self.assertTrue(english.startswith("<!-- component-map:en:start -->\n<!-- Generated by tools/component_map.py"))
        self.assertTrue(english.endswith("<!-- component-map:en:end -->"))
        self.assertIn("| Alpha | core | `native/alpha` |", english)
        self.assertIn("| OUTER | [kein5/outer](https://github.com/kein5/outer) | tool | design phase |", english)
        self.assertIn("| Kit | OUTER | dashed | planned move |", english)
        self.assertIn("### Inside ASTAROT", english)
        self.assertIn("| Alpha | 中核 | `native/alpha` |", japanese)
        self.assertIn("| OUTER | [kein5/outer](https://github.com/kein5/outer) | 道具 | 設計の段階 |", japanese)
        self.assertIn("| Kit | OUTER | 破線 | 移す予定 |", japanese)
        self.assertIn("### ASTAROTの中", japanese)
        self.assertEqual(self.page().count("```mermaid"), 2)

    def test_text_outside_the_blocks_is_kept_when_a_block_changes(self):
        page = self.page().replace("More English text.", "Edited English text.")
        (self.root / TOOL.DOC).write_text(page, encoding="utf-8")
        self.edit('role = "core"', 'role = "the core"')
        self.assertEqual(self.run_tool("--write")[0], 0)
        page = self.page()
        self.assertIn("Edited English text.", page)
        self.assertIn("| Alpha | the core |", page)

    def test_the_markers_must_each_be_there_once_and_in_order(self):
        good = self.page()
        cases = [
            (good.replace("<!-- component-map:ja:end -->", ""), "<!-- component-map:ja:end --> exactly once"),
            (good + "\n<!-- component-map:en:start -->\n", "<!-- component-map:en:start --> exactly once"),
            (good.replace("component-map:en:", "component-map:xx:").replace("component-map:ja:", "component-map:en:")
                 .replace("component-map:xx:", "component-map:ja:"), "the English block must come before"),
        ]
        for text, fragment in cases:
            with self.subTest(fragment):
                (self.root / TOOL.DOC).write_text(text, encoding="utf-8")
                self.assertFails(fragment)
                # --write does not touch a document whose markers are wrong.
                self.assertEqual(self.run_tool("--write")[0], 1)
                self.assertEqual(self.page(), text)
        (self.root / TOOL.DOC).unlink()
        self.assertFails("docs/development.md does not exist")

    def test_diagram_draws_the_system_the_components_and_the_lines(self):
        page = self.page()
        self.assertIn('  subgraph astarot["<b>ASTAROT</b> (kein5/astarot)"]\n'
                      '    alpha["<b>Alpha</b><br/>core"]\n'
                      '    kit["<b>Kit</b><br/>UI kit"]\n'
                      '  end\n'
                      '  outer["<b>OUTER</b><br/>kein5/outer<br/>tool (design phase)"]\n', page)
        self.assertIn("  astarot --- outer\n", page)
        self.assertIn('  kit -.-|"planned move"| outer\n', page)
        # Both versions draw the same diagram; only the accessible title and description differ.
        self.assertIn("  accTitle: ASTAROT component map\n", page)
        self.assertIn("  accTitle: ASTAROTの構成図\n", page)

    def test_internal_components_stack_in_rows_and_unlinked_repositories_go_below(self):
        extra = "".join(f'\n[[component]]\nid = "n{n}"\nname = "N{n}"\nkind = "internal"\nrole = "r"\n'
                        f'role_ja = "役"\npath = "native/n{n}"\n' for n in range(4))
        for n in range(4):
            (self.root / f"native/n{n}").mkdir(parents=True)
        self.edit("[[relation]]", extra + "\n[[relation]]")
        self.edit('from = "kit"', 'from = "alpha"')
        self.assertEqual(self.run_tool("--write")[0], 0)
        page = self.page()
        # alpha, kit, n0 / n1, n2, n3: each component sits above the one ROW places after it.
        for upper, lower in (("alpha", "n1"), ("kit", "n2"), ("n0", "n3")):
            self.assertIn(f"  {upper} ~~~ {lower}\n", page)
        # OUTER is linked from alpha now, so it needs no invisible link of its own.
        self.assertNotIn("~~~ outer", page)
        self.edit('from = "alpha"', 'from = "astarot"')
        self.assertEqual(self.run_tool("--write")[0], 0)
        self.assertIn("  n3 ~~~ outer\n", self.page())

    def test_a_stale_block_fails_until_written(self):
        self.edit('role = "core"', 'role = "the core"')
        self.assertFails("docs/development.md: the component map is out of date with tools/component_map.toml")
        self.assertEqual(self.run_tool("--write")[0], 0)
        self.assertIn("| Alpha | the core |", self.page())
        page = self.page().replace("| Alpha | the core |", "| Alpha | edited by hand |")
        (self.root / TOOL.DOC).write_text(page, encoding="utf-8")
        self.assertFails("out of date")

    def test_invalid_data_is_not_written(self):
        self.edit('kind = "external"', 'kind = "outside"')
        before = self.page()
        code, printed = self.run_tool("--write")
        self.assertEqual(code, 1)
        self.assertIn("kind must be one of internal, external", printed)
        self.assertEqual(self.page(), before)

    def test_text_that_would_break_the_diagram_or_a_table_is_escaped(self):
        self.edit('role = "tool"', 'role = "a \\"quoted\\" <tool> | & more"')
        self.assertEqual(self.run_tool("--write")[0], 0)
        page = self.page()
        self.assertIn("a #quot;quoted#quot; #lt;tool#gt; | #amp; more", page)
        self.assertIn('| a "quoted" &lt;tool&gt; \\| & more |', page)

    def test_a_cargo_package_without_an_entry_is_a_warning_not_a_failure(self):
        self.package("native/beta", "astarot-beta")
        self.package("src-tauri", "astarot")
        code, printed = self.run_tool("--check")
        self.assertEqual(code, 0, printed)
        self.assertIn("warning: the Cargo package astarot-beta (native/beta) has no entry", printed)
        self.assertIn("warning: the Cargo package astarot (src-tauri) has no entry", printed)
        self.assertNotIn("astarot-alpha", printed)

    def test_workspace_members_are_compared_too(self):
        (self.root / "Cargo.toml").write_text('[workspace]\nmembers = ["crates/*"]\n', encoding="utf-8")
        self.package("crates/gamma", "astarot-gamma")
        self.package("native/alpha", "astarot-alpha", '[workspace]\nmembers = ["inner"]\n')
        self.package("native/alpha/inner", "astarot-alpha-inner")
        code, printed = self.run_tool("--check")
        self.assertEqual(code, 0, printed)
        self.assertIn("astarot-gamma (crates/gamma)", printed)
        self.assertIn("astarot-alpha-inner (native/alpha/inner)", printed)
        # A manifest with only [workspace] is not a package.
        self.assertNotIn("(.)", printed)

    def test_an_unreadable_manifest_is_a_warning(self):
        (self.root / "native/broken").mkdir(parents=True)
        (self.root / "native/broken/Cargo.toml").write_text("[package\n", encoding="utf-8")
        code, printed = self.run_tool("--check")
        self.assertEqual(code, 0, printed)
        self.assertIn("warning: native/broken/Cargo.toml cannot be read as TOML", printed)

    def test_fields_are_checked(self):
        cases = [
            ('role_ja = "中核"\n', "", "component 1: missing 'role_ja'"),
            ('path = "native/alpha"', 'path = "native/missing"', "path native/missing is not a folder"),
            ('path = "native/alpha"', 'path = "../outside"', "path must be a plain folder path"),
            ('path = "src-ui/kit"', 'path = "src-ui/kit"\nrepository = "kein5/kit"',
             "an internal component has a path, not a repository"),
            ('repository = "kein5/outer"', 'repository = "outer"', "repository must be 'owner/name'"),
            ('repository = "kein5/outer"', 'repository = "kein5/outer"\npath = "src-ui/kit"',
             "an external component has a repository, not a path"),
            ('status_ja = "設計の段階"\n', "", "give 'status' and 'status_ja' together"),
            ('label_ja = "移す予定"\n', "", "give 'label' and 'label_ja' together"),
            ('id = "kit"', 'id = "alpha"', "id 'alpha' is used twice"),
            ('id = "kit"', 'id = "end"', "not a Mermaid keyword"),
            ('id = "kit"', 'id = "Kit-1"', "not a Mermaid keyword"),
            ('name = "Kit"', 'name = "Alpha"', "name 'Alpha' is used twice"),
            ('path = "src-ui/kit"', 'path = "native/alpha"', "path native/alpha is given twice"),
            ('to = "outer"\nline = "solid"', 'to = "nowhere"\nline = "solid"', "'to' names nowhere"),
            ('line = "dashed"', 'line = "dotted"', "line must be one of solid, dashed"),
            ('from = "astarot"', 'from = "outer"', "a relation joins two different entries"),
            ('role = "core"', 'role = " core"', "'role' must be one line of text"),
            ('role = "core"', 'role = 3', "'role' must be one line of text"),
            ('role = "core"', 'role = "core"\ncolour = "red"', "unknown field 'colour'"),
            ("[system]", "[extra]\n[system]", "unknown table 'extra'"),
            ("[system]", "[system", "cannot be read as TOML"),
        ]
        for old, new, fragment in cases:
            with self.subTest(fragment):
                self.data(DATA)
                self.edit(old, new)
                self.assertFails(fragment)

    def test_the_data_needs_a_system_and_an_internal_component(self):
        self.data('[[component]]\nid = "outer"\nname = "OUTER"\nkind = "external"\nrole = "tool"\n'
                  'role_ja = "道具"\nrepository = "kein5/outer"\n')
        code, printed = self.run_tool("--check")
        self.assertEqual(code, 1)
        self.assertIn("[system] is required", printed)
        self.assertIn("no internal component is listed", printed)
        (self.root / TOOL.DATA).unlink()
        self.assertFails("tools/component_map.toml does not exist")


if __name__ == "__main__":
    unittest.main()
