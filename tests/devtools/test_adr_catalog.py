"""The ADRs in docs/adr/ carry valid front matter, unique numbers, working links and a current index."""
import contextlib
import datetime
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools/adr_catalog.py"


def load_catalog():
    spec = importlib.util.spec_from_file_location("adr_catalog_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CATALOG = load_catalog()

FRONT = """---
date: 2026-11-01
status: accepted
era: rust-core
validity: current
implementation_status: implemented
implementation_checked: 2026-11-02
implementation_note: 実装した。
evidence:
  - docs/adr/{name}
---
"""


class AdrCatalogRepositoryTests(unittest.TestCase):
    def test_repository_passes_the_check(self):
        run = subprocess.run([sys.executable, str(SCRIPT), "--check"], cwd=ROOT,
                             capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_numbers_run_from_one_without_gaps(self):
        errors = []
        numbers = sorted(CATALOG.collect(ROOT, errors))
        self.assertEqual(errors, [])
        self.assertEqual(numbers, list(range(1, len(numbers) + 1)))

    def test_front_matter_reads_the_same_as_yaml(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML is not installed")
        for path in sorted((ROOT / "docs/adr").glob("*.md")):
            text = path.read_text(encoding="utf-8")
            if not text.startswith("---\n"):
                continue
            errors = []
            ours, _ = CATALOG.front_matter(text, path.name, errors)
            theirs = yaml.safe_load(text.split("---\n")[1])
            theirs = {key: value.isoformat() if isinstance(value, datetime.date) else value
                      for key, value in theirs.items()}
            with self.subTest(path.name):
                self.assertEqual(errors, [])
                self.assertEqual(ours, theirs)


class AdrCatalogFixtureTests(unittest.TestCase):
    """A small tree with two ADRs; each test breaks one thing and expects the check to say so."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "docs/adr").mkdir(parents=True)
        (self.root / "docs/voice-stack").mkdir(parents=True)
        self.adr(1, "first-choice", FRONT, "# ADR-001: 最初の判断\n\n[次](adr-002-second-choice.md)\n")
        self.adr(2, "second-choice", FRONT, "# ADR-002: 次の判断\n")
        self.readme("# ADR\n\n[一つ目](adr-001-first-choice.md)\n\n<!-- adr-index:start -->\n<!-- adr-index:end -->\n")
        self.assertTrue(CATALOG.write(self.root))
        self.assertEqual(self.errors(), [])

    def tearDown(self):
        self.temp.cleanup()

    def adr(self, number, slug, front, body):
        name = f"adr-{number:03d}-{slug}.md"
        (self.root / "docs/adr" / name).write_text(front.format(name=name) + body, encoding="utf-8")
        return name

    def readme(self, text):
        (self.root / "docs/adr/README.md").write_text(text, encoding="utf-8")

    def edit(self, name, old, new):
        path = self.root / "docs/adr" / name
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text)
        path.write_text(text.replace(old, new, 1), encoding="utf-8")

    def errors(self):
        return CATALOG.check(self.root)

    def assertReported(self, fragment):
        errors = self.errors()
        self.assertTrue(any(fragment in error for error in errors), errors)

    def test_index_lists_each_adr_with_its_labels(self):
        readme = (self.root / "docs/adr/README.md").read_text(encoding="utf-8")
        self.assertIn("| [001](adr-001-first-choice.md) | 最初の判断 | 2026-11-01 | 採用 | 実装済み | 有効 | Rust の中核 |",
                      readme)

    def test_stale_index_fails_until_written(self):
        self.edit("adr-002-second-choice.md", "status: accepted", "status: proposed")
        self.assertReported("index is out of date")
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(CATALOG.main(["--write"], root=self.root), 0)
        self.assertEqual(self.errors(), [])

    def test_duplicate_number(self):
        self.adr(2, "another-second", FRONT, "# ADR-002: 重複\n")
        self.assertReported("ADR 002 is already")

    def test_file_name_and_heading_must_agree(self):
        self.edit("adr-002-second-choice.md", "# ADR-002:", "# ADR-003:")
        self.assertReported("the heading says ADR 003")
        (self.root / "docs/adr/adr-4-short.md").write_text(FRONT + "# ADR-004: x\n", encoding="utf-8")
        self.assertReported("ADR files are named adr-NNN-")

    def test_the_authoring_guideline_is_not_an_adr(self):
        (self.root / "docs/adr/authoring.md").write_text("# ADR authoring guideline\n", encoding="utf-8")
        self.assertEqual(self.errors(), [])

    def test_missing_and_unknown_fields(self):
        self.edit("adr-001-first-choice.md", "era: rust-core\n", "")
        self.assertReported("missing field 'era'")
        self.edit("adr-001-first-choice.md", "status: accepted", "status: accepted\nstate: accepted")
        self.assertReported("unknown field 'state'")

    def test_values_outside_the_sets(self):
        for old, new, message in (("status: accepted", "status: approved", "status 'approved'"),
                                  ("validity: current", "validity: valid", "validity 'valid'"),
                                  ("implementation_status: implemented", "implementation_status: done",
                                   "implementation_status 'done'"),
                                  ("date: 2026-11-01", "date: 2026-13-01", "date must be a date")):
            with self.subTest(new):
                self.edit("adr-001-first-choice.md", old, new)
                self.assertReported(message)
                self.edit("adr-001-first-choice.md", new, old)

    def test_replaced_needs_an_existing_successor(self):
        self.edit("adr-001-first-choice.md", "validity: current", "validity: replaced")
        self.assertReported("needs a validity_note")
        self.assertReported("superseded_by must name the ADR")
        self.edit("adr-001-first-choice.md", "validity: replaced",
                  "validity: replaced\nvalidity_note: 後の判断が引き継いだ。\nsuperseded_by:\n  - ADR-009")
        self.assertReported("names ADR-009, which does not exist")
        self.edit("adr-001-first-choice.md", "ADR-009", "ADR-002")
        CATALOG.write(self.root)
        self.assertEqual(self.errors(), [])
        readme = (self.root / "docs/adr/README.md").read_text(encoding="utf-8")
        self.assertIn("| 置き換えられた（[ADR-002](adr-002-second-choice.md)） |", readme)

    def test_superseded_status_needs_replaced_validity(self):
        self.edit("adr-001-first-choice.md", "status: accepted", "status: superseded\nsuperseded_by:\n  - ADR-002")
        self.assertReported("a superseded ADR has validity 'replaced'")

    def test_accepted_alone_does_not_make_it_implemented(self):
        self.edit("adr-001-first-choice.md", "implementation_checked: 2026-11-02\n", "")
        self.assertReported("needs implementation_checked")
        self.edit("adr-001-first-choice.md", "implementation_status: implemented", "implementation_status: partial")
        self.edit("adr-001-first-choice.md", "implementation_note: 実装した。\n", "")
        self.assertReported("'partial' needs an implementation_note")

    def test_evidence_is_required_and_must_exist(self):
        self.edit("adr-001-first-choice.md", "  - docs/adr/adr-001-first-choice.md", "  - native/missing.rs")
        self.assertReported("evidence 'native/missing.rs' does not exist")
        self.edit("adr-001-first-choice.md", "evidence:\n  - native/missing.rs\n", "")
        self.assertReported("evidence must list the files")

    def test_unknown_everything_needs_no_evidence(self):
        self.edit("adr-001-first-choice.md", "validity: current", "validity: unknown")
        self.edit("adr-001-first-choice.md", "implementation_status: implemented\nimplementation_checked: 2026-11-02\n",
                  "implementation_status: unknown\n")
        self.edit("adr-001-first-choice.md", "evidence:\n  - docs/adr/adr-001-first-choice.md\n", "")
        CATALOG.write(self.root)
        self.assertEqual(self.errors(), [])

    def test_values_that_yaml_would_misread_must_be_quoted(self):
        self.edit("adr-001-first-choice.md", "implementation_note: 実装した。", "implementation_note: see issue #12")
        self.assertReported("quote the value")
        self.edit("adr-001-first-choice.md", "see issue #12", '"see issue #12"')
        self.assertEqual(self.errors(), [])

    def test_broken_links_in_and_into_the_directory(self):
        self.edit("adr-001-first-choice.md", "(adr-002-second-choice.md)", "(adr-003-missing.md)")
        self.assertReported("link to docs/adr/adr-003-missing.md, which does not exist")
        (self.root / "docs/guide.md").write_text("[ADR](adr/adr-007-gone.md)\n", encoding="utf-8")
        self.assertReported("docs/guide.md:1: link to docs/adr/adr-007-gone.md")

    def test_links_to_the_old_locations(self):
        (self.root / "docs/guide.md").write_text(
            "[old](voice-stack/adr-001-first-choice.md) [index](voice-stack/decisions.md) `voice-stack/decisions.md`\n",
            encoding="utf-8")
        errors = [error for error in self.errors() if "old location" in error]
        self.assertEqual(len(errors), 2, errors)

    def test_pages_at_the_old_locations_point_at_the_records(self):
        pointer = self.root / "docs/voice-stack/adr-001-first-choice.md"
        pointer.write_text("[ADR-001](../adr/adr-001-first-choice.md)\n", encoding="utf-8")
        self.assertEqual(self.errors(), [])
        pointer.write_text("moved\n", encoding="utf-8")
        self.assertReported("must link to ../adr/adr-001-first-choice.md")
        (self.root / "docs/voice-stack/adr-005-orphan.md").write_text("x\n", encoding="utf-8")
        self.assertReported("adr-005-orphan.md: no ADR with this file name")

    def test_template_front_matter_stays_valid(self):
        (self.root / "docs/adr/TEMPLATE.md").write_text("---\ndate: 2026-01-01\nstatus: proposed\n---\n# ADR-NNN: x\n",
                                                        encoding="utf-8")
        self.assertReported("TEMPLATE.md: missing field 'era'")

    def test_index_markers_are_required(self):
        self.readme("# ADR\n")
        self.assertReported("must hold exactly one")
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(CATALOG.main(["--write"], root=self.root), 1)


if __name__ == "__main__":
    unittest.main()
