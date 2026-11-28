"""The bilingual documents carry an English and a Japanese version with matching headings (#1367)."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools/bilingual_docs.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("bilingual_docs_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


TOOL = load_tool()

GOOD = """# Guide

[日本語版](#ガイド日本語版)

Intro.

## 1. Start

Text.

### Run `tool`

Text.

## 🔧 Internal changes

```sh
# a comment, not a heading
```

---

# ガイド（日本語版）

はじめに。

## 1. 始める

本文。

### `tool` を流す

本文。

## 🔧 内部の変更
"""


class RepositoryTests(unittest.TestCase):
    def test_repository_passes_the_check(self):
        run = subprocess.run([sys.executable, str(SCRIPT), "--check"], cwd=ROOT,
                             capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


class AnchorTests(unittest.TestCase):
    def test_full_width_punctuation_goes_and_letters_stay(self):
        self.assertEqual(TOOL.anchor("ASTAROT 開発エージェント向けガイド（日本語版）"),
                         "astarot-開発エージェント向けガイド日本語版")

    def test_code_and_link_markup_go(self):
        self.assertEqual(TOOL.anchor("Run `tool` from [here](x.md)"), "run-tool-from-here")


class FixtureTests(unittest.TestCase):
    """A small tree with no listed files; each test writes one document and reads the findings."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        for name, value in (("EXEMPT", {}), ("SHIFTED", set()), ("PAIRS", {}), ("PENDING_SKILLS", ()),
                            ("JAPANESE_ONLY_SECTIONS", {})):
            patcher = mock.patch.object(TOOL, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def findings(self):
        return TOOL.check(self.root)

    def assertFinds(self, fragment):
        errors = self.findings()
        self.assertTrue(any(fragment in error for error in errors), f"{fragment!r} not in {errors}")

    def test_a_document_in_the_form_passes(self):
        self.write("docs/guide.md", GOOD)
        self.assertEqual(self.findings(), [])

    def test_files_outside_the_scope_are_not_read(self):
        self.write("site/en/page.md", "# Page\n")
        self.write("native/core/README.md", "# Core\n")
        self.assertEqual(self.findings(), [])

    def test_a_document_without_a_japanese_version_fails(self):
        self.write("NOTES.md", "# Notes\n\nOnly English.\n")
        self.assertFinds("NOTES.md:1: no Japanese version")

    def test_an_exempt_document_is_not_read(self):
        self.write("NOTICE.md", "# NOTICE\n\nLegal text.\n")
        with mock.patch.object(TOOL, "EXEMPT", {"NOTICE.md": "legal text"}):
            self.assertEqual(self.findings(), [])

    def test_the_divider_is_required(self):
        self.write("docs/guide.md", GOOD.replace("---\n\n# ガイド", "# ガイド"))
        self.assertFinds("put the divider before the Japanese title")

    def test_a_divider_right_under_text_is_a_heading_not_a_divider(self):
        self.write("docs/guide.md", GOOD.replace("```\n\n---\n", "```\ntext\n---\n"))
        self.assertFinds("put the divider before the Japanese title")

    def test_the_link_to_the_japanese_version_is_required(self):
        self.write("docs/guide.md", GOOD.replace("[日本語版](#ガイド日本語版)", "[日本語版](#wrong)"))
        self.assertFinds("link to the Japanese version under the English title: [日本語版](#ガイド日本語版)")

    def test_the_english_title_is_required(self):
        self.write("docs/guide.md", GOOD.replace("# Guide\n\n", "", 1))
        self.assertFinds("the English version starts without its title")

    def test_a_front_matter_name_stands_in_for_the_english_title(self):
        self.write("DESIGN.md", "---\nname: Studio\n---\n\n" + GOOD.replace("# Guide\n\n", "", 1))
        self.assertEqual(self.findings(), [])

    def test_no_english_version_at_all_fails(self):
        self.write("docs/guide.md", "---\n\n# ガイド（日本語版）\n\nはじめに。\n")
        self.assertFinds("no English version before the Japanese one")

    def test_an_english_version_written_in_japanese_fails(self):
        self.write("docs/guide.md", GOOD.replace("## 1. Start", "## 1. 始める"))
        self.assertFinds("the English version has a heading in Japanese: '1. 始める'")

    def test_a_japanese_version_without_japanese_fails(self):
        english_twice = GOOD.split("---\n")[0] + "---\n\n# ガイド（日本語版）\n\n" + GOOD.split("\n\n", 2)[2].split("---\n")[0]
        self.write("docs/guide.md", english_twice)
        self.assertFinds("the Japanese version contains no Japanese text")

    def test_a_heading_at_another_level_fails(self):
        self.write("docs/guide.md", GOOD.replace("### `tool` を流す", "## `tool` を流す"))
        self.assertFinds("level 3 in English but 2 in Japanese")

    def test_a_japanese_section_without_an_english_one_fails(self):
        self.write("docs/guide.md", GOOD + "\n## 日本語だけの節\n\n本文。\n")
        self.assertFinds("the Japanese heading '日本語だけの節' has no English heading to match; write the English section first")

    def test_an_english_section_without_a_japanese_one_fails(self):
        self.write("docs/guide.md", GOOD.replace("```sh", "## Only English\n\n```sh"))
        self.assertFinds("the English heading 'Only English' has no Japanese heading to match")

    def test_a_section_number_must_match(self):
        self.write("docs/guide.md", GOOD.replace("## 1. 始める", "## 2. 始める"))
        self.assertFinds("the Japanese heading does not start with the number '1.' of the English one")

    def test_a_longer_number_does_not_count_as_the_same(self):
        self.write("docs/guide.md", GOOD.replace("## 1. 始める", "## 10. 始める").replace("## 1. Start", "## 1 Start"))
        self.assertFinds("does not start with the number '1'")

    def test_a_number_inside_the_japanese_wording_alone_is_fine(self):
        self.write("docs/guide.md", GOOD.replace("## 1. Start", "## Start with 0.6.0").replace("## 1. 始める", "## 0.6.0 から始める"))
        self.assertEqual(self.findings(), [])

    def test_inline_code_must_match(self):
        self.write("docs/guide.md", GOOD.replace("### `tool` を流す", "### `other` を流す"))
        self.assertFinds("different inline code")

    def test_emoji_must_match(self):
        self.write("docs/guide.md", GOOD.replace("## 🔧 内部の変更", "## 🐞 内部の変更"))
        self.assertFinds("different emoji")

    def test_headings_in_code_fences_and_comments_do_not_count(self):
        self.write("docs/guide.md", GOOD.replace("Intro.", "Intro.\n\n~~~md\n## Example\n~~~\n\n<!--\n## Hidden\n-->"))
        self.assertEqual(self.findings(), [])

    def test_the_shifted_form_of_the_community_files(self):
        text = ("# Security policy\n\n[日本語版](#脆弱性の報告日本語)\n\n## Scope\n\nText.\n\n---\n\n"
                "## 脆弱性の報告（日本語）\n\n### 対象\n\n本文です。\n")
        self.write("SECURITY.md", text)
        self.assertFinds("no Japanese version")
        with mock.patch.object(TOOL, "SHIFTED", {"SECURITY.md"}):
            self.assertEqual(self.findings(), [])

    def test_a_pair_of_files(self):
        self.write("README.md", "[日本語](/docs/readmes/README.ja.md)\n\n## Features\n")
        self.write("docs/readmes/README.ja.md", "[English](/README.md)\n\n## できること\n")
        with mock.patch.object(TOOL, "PAIRS", {"README.md": "docs/readmes/README.ja.md"}):
            self.assertEqual(self.findings(), [])
            self.write("docs/readmes/README.ja.md", "## できること\n\n## 開発\n")
            errors = self.findings()
        self.assertIn("docs/readmes/README.ja.md:1: no link to README.md", errors)
        self.assertTrue(any("'開発' has no English heading" in error for error in errors), errors)

    def test_a_pending_skill_may_stay_japanese_until_it_is_converted(self):
        self.write("skills/demo/SKILL.md", "---\nname: demo\ndescription: 手順。\n---\n\n# 手順\n\n本文。\n")
        with mock.patch.object(TOOL, "PENDING_SKILLS", ("skills/demo/SKILL.md",)):
            self.assertEqual(self.findings(), [])
            self.write("skills/demo/SKILL.md", "---\nname: demo\ndescription: Steps. 手順。\n---\n\n" + GOOD)
            self.assertFinds("this skill is bilingual now; remove it from PENDING_SKILLS")
        self.assertEqual(self.findings(), [])

    def test_a_skill_description_starts_in_english(self):
        self.write("skills/demo/SKILL.md", "---\nname: demo\ndescription: 手順。Steps.\n---\n\n" + GOOD)
        self.assertFinds("skills/demo/SKILL.md:3: the description starts in Japanese")

    def test_a_skill_description_stays_within_the_limit(self):
        self.write("skills/demo/SKILL.md", "---\nname: demo\ndescription: " + "a" * 1025 + "\n---\n\n" + GOOD)
        self.assertFinds("the description has 1025 characters; the limit is 1024")

    def test_a_skill_description_avoids_yaml_syntax_unless_quoted(self):
        self.write("skills/demo/SKILL.md", "---\nname: demo\ndescription: Steps after a change: which.\n---\n\n" + GOOD)
        self.assertFinds("skills/demo/SKILL.md:3: the description holds ': ' or ' #'")
        self.write("skills/demo/SKILL.md", "---\nname: demo\ndescription: Steps for #1367 and #12.\n---\n\n" + GOOD)
        self.assertFinds("the description holds ': ' or ' #'")
        self.write("skills/demo/SKILL.md", "---\nname: demo\ndescription: \"Steps after a change: which.\"\n---\n\n" + GOOD)
        self.assertEqual(self.findings(), [])

    def test_a_folded_skill_description_is_read_whole(self):
        self.write("skills/demo/SKILL.md", "---\nname: demo\ndescription: >\n  Steps.\n  手順。\n---\n\n" + GOOD)
        self.assertEqual(self.findings(), [])

    def test_a_japanese_only_section_is_skipped_until_it_is_gone(self):
        self.write("docs/guide.md", GOOD + "\n## 日本語だけの節\n\n本文。\n")
        with mock.patch.object(TOOL, "JAPANESE_ONLY_SECTIONS", {"docs/guide.md": ("日本語だけの節",)}):
            self.assertEqual(self.findings(), [])
            self.write("docs/guide.md", GOOD)
            self.assertFinds("the Japanese-only section '日本語だけの節' is gone")

    def test_a_listed_file_that_does_not_exist_fails(self):
        with mock.patch.object(TOOL, "EXEMPT", {"GONE.md": "reason"}):
            self.assertFinds("GONE.md: listed in EXEMPT in tools/bilingual_docs.py but not found")

    def test_main_exits_one_and_prints_the_findings(self):
        self.write("NOTES.md", "# Notes\n")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(TOOL.main(["--check"], root=self.root), 1)
        self.assertIn("NOTES.md:1: no Japanese version", out.getvalue())
        self.write("NOTES.md", GOOD)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(TOOL.main(["--check"], root=self.root), 0)


if __name__ == "__main__":
    unittest.main()
