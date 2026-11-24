"""tools/changelog.py: how commits are sorted, how CHANGELOG.md is written, and the release notes."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import changelog as cl  # noqa: E402

TITLES = cl.load_type_titles(ROOT / "cog.toml")
REPO = "https://github.com/kein5/VRCT-VOX"


def commit(type_, summary, scope=None, breaking=False, footers=(), id_="0123456789abcdef0123456789abcdef01234567"):
    return cl.Commit(id=id_, type=type_, scope=scope, summary=summary, breaking=breaking, footers=tuple(footers))


class ClassifyTest(unittest.TestCase):
    def check(self, item, expected):
        self.assertEqual(cl.classify(item), expected, item)

    def test_user_facing_types(self):
        self.check(commit("feat", "add a page"), ("user", "Features"))
        self.check(commit("fix", "keep the queue"), ("user", "Bug Fixes"))
        self.check(commit("perf", "start sooner"), ("user", "Performance"))
        self.check(commit("fix", "check the token", scope="security"), ("user", "Security"))

    def test_internal_types(self):
        self.check(commit("refactor", "split the module"), ("internal", "Refactoring"))
        self.check(commit("build", "bump tauri", scope="deps"), ("internal", "Dependencies"))
        self.check(commit("chore", "update uv.lock", scope="deps"), ("internal", "Dependencies"))
        self.check(commit("build", "pin the bundle"), ("internal", "Build & CI"))
        self.check(commit("ci", "cache uv"), ("internal", "Build & CI"))
        self.check(commit("test", "cover the queue"), ("internal", "Tests"))
        self.check(commit("docs", "explain the route"), ("internal", "Documentation"))
        self.check(commit("chore", "tidy"), ("internal", "Maintenance"))
        self.check(commit("style", "format"), ("internal", "Maintenance"))
        self.check(commit("revert", "undo the cache"), ("internal", "Maintenance"))

    def test_a_feature_or_fix_for_developers_stays_internal(self):
        self.check(commit("feat", "add developer checks", scope="dev"), ("internal", "Maintenance"))
        self.check(commit("fix", "retry the mirror", scope="ci"), ("internal", "Build & CI"))
        self.check(commit("fix", "stabilise the timer", scope="tests"), ("internal", "Tests"))
        self.check(commit("fix", "relock", scope="deps"), ("internal", "Dependencies"))

    def test_breaking_changes_come_first_whatever_the_type(self):
        self.check(commit("refactor", "rename the setting", breaking=True), ("user", "Breaking Changes"))
        self.check(commit("feat", "drop the old route", scope="dev", breaking=True), ("user", "Breaking Changes"))

    def test_the_changelog_footer_decides_when_the_type_does_not_say_enough(self):
        footer = lambda value: [("Changelog", value)]  # noqa: E731
        self.check(commit("docs", "add the own-model guide", footers=footer("user")), ("user", "Improvements"))
        self.check(commit("feat", "add a page", footers=footer("user")), ("user", "Features"))
        self.check(commit("chore", "update a vulnerable library", scope="deps", footers=footer("security")), ("user", "Security"))
        self.check(commit("feat", "add a debug switch", footers=footer("internal")), ("internal", "Maintenance"))
        self.check(commit("fix", "a typo in a test name", footers=footer("skip")), None)
        self.check(commit("refactor", "rename", breaking=True, footers=footer("internal")), ("internal", "Refactoring"))

    def test_release_commits_are_left_out(self):
        self.check(commit("chore", "version 0.2.0", scope="release"), None)


class ParseTest(unittest.TestCase):
    def test_reads_cog_json_with_the_titles_of_cog_toml(self):
        line = json.dumps({"id": "a" * 40, "type": "Bug Fixes", "scope": "api", "summary": "change the reply",
                           "breaking_change": True, "body": None,
                           "footers": [{"footer": {"token": "BREAKING CHANGE", "content": "read the new field."}},
                                       {"github_co_authored_by": {"user": "x", "username": None}}]})
        [item] = cl.parse_commits([line, ""], TITLES)
        self.assertEqual((item.type, item.scope, item.breaking), ("fix", "api", True))
        self.assertEqual(item.footers, (("BREAKING CHANGE", "read the new field."),))

    def test_skips_the_separator_cog_prints_between_releases(self):
        line = json.dumps({"id": "b" * 40, "type": "Features", "scope": None, "summary": "show", "footers": []})
        self.assertEqual(len(cl.parse_commits([line, "", "- - -", "", line.replace("b" * 40, "c" * 40)], TITLES)), 2)

    def test_every_title_in_cog_toml_is_distinct(self):
        self.assertEqual(len(TITLES), 11)
        self.assertEqual(TITLES["Features"], "feat")


class RenderTest(unittest.TestCase):
    def section(self, commits, **kwargs):
        return cl.render_section("0.2.0-beta.1", "2026-11-14", "v0.1.0", commits, repo_url=REPO, **kwargs)

    def test_user_facing_first_breaking_on_top_and_empty_headings_left_out(self):
        text = self.section([
            commit("test", "cover the queue", id_="1" * 40),
            commit("feat", "add a page", scope="site", id_="2" * 40),
            commit("fix", "change the reply", scope="api", breaking=True, id_="3" * 40,
                   footers=[("BREAKING CHANGE", "clients must read the new field.")]),
        ])
        self.assertEqual(text, "\n".join([
            "## [0.2.0-beta.1] - 2026-11-14",
            "",
            f"Changes since [v0.1.0]({REPO}/compare/v0.1.0...v0.2.0-beta.1).",
            "",
            "### User-facing Changes",
            "",
            "#### Breaking Changes",
            "",
            f"- **api:** Change the reply ([3333333]({REPO}/commit/{'3' * 40}))",
            "  - clients must read the new field.",
            "",
            "#### Features",
            "",
            f"- **site:** Add a page ([2222222]({REPO}/commit/{'2' * 40}))",
            "",
            "### Internal Changes",
            "",
            "#### Tests",
            "",
            f"- Cover the queue ([1111111]({REPO}/commit/{'1' * 40}))",
            "",
        ]))

    def test_the_same_change_twice_is_one_line_with_both_commits(self):
        text = self.section([commit("fix", "keep the queue", id_="a" * 40), commit("fix", "keep the queue", id_="b" * 40)])
        self.assertIn(f"- Keep the queue ([aaaaaaa]({REPO}/commit/{'a' * 40}), [bbbbbbb]({REPO}/commit/{'b' * 40}))", text)
        self.assertEqual(text.count("Keep the queue"), 1)

    def test_a_release_with_nothing_to_list_says_so(self):
        text = self.section([commit("chore", "version 0.2.0", scope="release")])
        self.assertIn("No changes to list.", text)
        self.assertNotIn("### User-facing Changes", text)

    def test_a_stable_release_names_the_pre_releases_it_includes(self):
        text = cl.render_section("0.2.0", "2026-12-01", "v0.2.0-beta.2", [], repo_url=REPO,
                                 included=["0.2.0-beta.1", "0.2.0-beta.2"])
        self.assertIn("This release includes the changes of 0.2.0-beta.1 and 0.2.0-beta.2, listed below.", text)


class UpdateTest(unittest.TestCase):
    SECTION = "## [0.2.0] - 2026-11-14\n\nChanges since v0.1.0.\n"

    def test_creates_the_file_with_its_header_and_the_link_to_older_releases(self):
        text = cl.update_changelog("", "0.2.0", self.SECTION)
        self.assertTrue(text.startswith("# Changelog\n"))
        self.assertIn("Only stable releases are listed", text)
        self.assertLess(text.index("## [0.2.0]"), text.index(cl.OLDER_HEADING))
        self.assertEqual(cl.update_changelog(text, "0.2.0", self.SECTION), text)

    def test_a_new_release_goes_above_the_previous_one(self):
        text = cl.update_changelog("", "0.2.0", self.SECTION)
        newer = self.SECTION.replace("0.2.0", "0.3.0")
        text = cl.update_changelog(text, "0.3.0", newer)
        self.assertLess(text.index("## [0.3.0]"), text.index("## [0.2.0]"))

    def test_a_different_section_for_a_written_release_needs_force(self):
        text = cl.update_changelog("", "0.2.0", self.SECTION)
        changed = self.SECTION + "\n- One more line\n"
        with self.assertRaises(cl.ChangelogError):
            cl.update_changelog(text, "0.2.0", changed)
        self.assertIn("One more line", cl.update_changelog(text, "0.2.0", changed, force=True))

    def test_reads_back_the_date(self):
        text = cl.update_changelog("", "0.2.0", self.SECTION)
        self.assertEqual(cl.section_date(text, "0.2.0"), "2026-11-14")
        self.assertIsNone(cl.section_date(text, "0.3.0"))

    def test_pre_releases_are_not_written(self):
        with self.assertRaises(cl.ChangelogError):
            cl.update_changelog("", "0.2.0-beta.1", self.SECTION.replace("0.2.0", "0.2.0-beta.1"))


class JapaneseVersionTest(unittest.TestCase):
    """The Japanese version after the English one (decision of 2026-11-24): a new stable release gets a
    frame of its Japanese section for a person to translate; a translation is never replaced."""

    def section(self, version="0.2.0", previous="v0.1.0", commits=()):
        return cl.render_section(version, "2026-11-14", previous, list(commits), repo_url=REPO)

    def test_a_new_file_holds_both_versions_and_the_frame_of_the_first_release(self):
        text = cl.update_changelog("", "0.2.0", self.section())
        self.assertIn("[日本語版](#変更履歴日本語版)", text.split("\n---\n")[0])
        self.assertLess(text.index(cl.OLDER_HEADING), text.index("\n---\n"))
        self.assertLess(text.index("\n---\n"), text.index(cl.JA_TITLE))
        self.assertLess(text.index("## 0.2.0（2026-11-14）"), text.index(cl.JA_OLDER_HEADING))
        self.assertEqual(cl.japanese_sections(text), ["0.2.0"])
        self.assertEqual([name for name, _, _ in cl.sections(text)], ["0.2.0"])

    def test_a_new_release_goes_above_the_previous_one_in_both_versions(self):
        text = cl.update_changelog("", "0.2.0", self.section())
        text = cl.update_changelog(text, "0.3.0", self.section("0.3.0", "v0.2.0"))
        self.assertEqual([name for name, _, _ in cl.sections(text)], ["0.3.0", "0.2.0"])
        self.assertEqual(cl.japanese_sections(text), ["0.3.0", "0.2.0"])

    def test_a_translated_section_is_never_replaced(self):
        text = cl.update_changelog("", "0.2.0", self.section(commits=[commit("fix", "keep the queue")]))
        translated = text.replace("- Keep the queue（", "- 待ち行列を保つ（").replace(cl.JA_FRAME_NOTE + "\n\n", "")
        changed = self.section(commits=[commit("fix", "keep the queue"), commit("feat", "add a page", id_="b" * 40)])
        text = cl.update_changelog(translated, "0.2.0", changed, force=True)
        self.assertIn("Add a page", text.split(cl.JA_TITLE)[0])
        japanese = text.split(cl.JA_TITLE)[1]
        self.assertIn("- 待ち行列を保つ（", japanese)
        self.assertNotIn("Add a page", japanese)

    def test_a_file_without_a_japanese_version_gets_no_frame(self):
        english_only = "# Changelog\n\n" + cl.OLDER
        text = cl.update_changelog(english_only, "0.2.0", self.section())
        self.assertNotIn(cl.JA_TITLE, text)
        self.assertEqual(cl.japanese_sections(text), [])

    def test_the_frame_puts_headings_and_fixed_sentences_in_japanese_and_keeps_the_links(self):
        section = cl.render_section("0.2.0", "2026-11-14", "v0.1.0", [
            commit("fix", "keep the queue", scope="ui", id_="a" * 40),
            commit("fix", "keep the queue", scope="ui", id_="b" * 40),
            commit("feat", "change the reply", scope="api", breaking=True,
                   footers=[("BREAKING CHANGE", "read the new field.")], id_="c" * 40),
            commit("test", "cover the queue", id_="d" * 40),
        ], repo_url=REPO, included=["0.2.0-beta.1", "0.2.0-beta.2"])
        frame = cl.japanese_frame(section)
        self.assertTrue(frame.startswith("## 0.2.0（2026-11-14）\n\n" + cl.JA_FRAME_NOTE + "\n"))
        self.assertIn(f"[v0.1.0]({REPO}/compare/v0.1.0...v0.2.0)からの変更です。", frame)
        self.assertIn("この版には0.2.0-beta.1、0.2.0-beta.2の変更も含まれます。", frame)
        for heading in ("### 利用者に関わる変更", "#### 互換性が変わる変更", "#### 不具合の修正", "### 内部の変更",
                        "#### 試験"):
            self.assertIn(heading + "\n", frame)
        self.assertIn(f"- **ui:** Keep the queue（[aaaaaaa]({REPO}/commit/{'a' * 40})、"
                      f"[bbbbbbb]({REPO}/commit/{'b' * 40})）", frame)
        self.assertIn("  - read the new field.", frame)
        self.assertIsNone(cl.SECTION.search(frame))

    def test_a_release_with_nothing_to_list_says_so_in_japanese(self):
        frame = cl.japanese_frame(self.section(commits=[commit("chore", "version 0.2.0", scope="release")]))
        self.assertIn("載せる変更はありません。", frame)

    def test_the_header_and_the_closing_sections_are_those_of_changelog_md(self):
        text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith(cl.HEADER))
        self.assertIn("\n" + cl.SEPARATOR + "\n\n" + cl.JA_HEADER, text)
        self.assertIn(cl.OLDER + "\n" + cl.SEPARATOR + "\n", text)
        self.assertTrue(text.endswith(cl.JA_OLDER))
        self.assertEqual(cl.japanese_sections(text), [name for name, _, _ in cl.sections(text)])


class ReleaseNotesTest(unittest.TestCase):
    def section(self, version, previous):
        return cl.render_section(version, "2026-11-14", previous, [
            commit("feat", "add a page", id_="2" * 40), commit("test", "cover", id_="1" * 40),
            commit("docs", "explain", id_="4" * 40)], repo_url=REPO)

    def test_notes_lead_with_what_users_weigh(self):
        notes = cl.release_notes(self.section("0.2.0", "v0.1.0"), "0.2.0", repo_url=REPO, checklist="- check the hashes")
        order = [notes.index(heading) for heading in
                 ("## Highlights", "## Breaking Changes", "## Upgrade Notes", "## Known Issues", "## Changes")]
        self.assertEqual(order, sorted(order))
        self.assertIn("None.", notes.split("## Breaking Changes")[1].split("##")[0])
        self.assertIn("Add a page", notes)
        self.assertNotIn("Cover", notes)
        self.assertIn("Internal changes: 2 (Tests 1, Documentation 1).", notes)
        self.assertIn("<!--\n- check the hashes\n-->", notes)

    def test_a_stable_release_points_to_the_changelog(self):
        notes = cl.release_notes(self.section("0.2.0", "v0.1.0"), "0.2.0", repo_url=REPO, checklist="")
        self.assertIn(f"{REPO}/blob/v0.2.0/CHANGELOG.md", notes)

    def test_a_pre_release_points_to_its_commits(self):
        notes = cl.release_notes(self.section("0.2.0-beta.1", "v0.1.0"), "0.2.0-beta.1", repo_url=REPO, checklist="")
        self.assertIn(f"{REPO}/compare/v0.1.0...v0.2.0-beta.1", notes)
        self.assertNotIn("CHANGELOG.md", notes)

    def test_no_notes_for_a_stable_release_without_its_section(self):
        with self.assertRaises(cl.ChangelogError):
            cl.section_text("# Changelog\n", "0.2.0")


class NotesScaffoldTest(unittest.TestCase):
    """docs/release-notes/<version>.md starts from the format of docs/release-notes/README.md."""

    def test_pull_requests_go_to_the_group_of_their_most_user_facing_commit(self):
        pulls = {"1" * 40: cl.PullRequest(12, "feat(ui): show the flow"), "2" * 40: cl.PullRequest(12, "feat(ui): show the flow"),
                 "3" * 40: cl.PullRequest(5, "docs: explain the route"),
                 "4" * 40: cl.PullRequest(30, "fix(api)!: change the reply"),
                 "6" * 40: cl.PullRequest(8, "chore(release): version 0.2.0")}
        entries = cl.notes_entries([
            commit("test", "cover the flow", id_="1" * 40), commit("feat", "show the flow", scope="ui", id_="2" * 40),
            commit("docs", "explain the route", id_="3" * 40),
            commit("fix", "change the reply", scope="api", breaking=True, id_="4" * 40),
            commit("fix", "keep the queue", scope="tts", id_="5" * 40),
            commit("chore", "version 0.2.0", scope="release", id_="6" * 40),
            commit("test", "rename a test", footers=[("Changelog", "skip")], id_="7" * 40),
        ], pulls)
        self.assertEqual(entries, [
            cl.NotesEntry("internal", "docs: explain the route", "#5"),
            cl.NotesEntry("user", "feat(ui): show the flow", "#12"),
            cl.NotesEntry("breaking", "fix(api)!: change the reply", "#30"),
            cl.NotesEntry("user", "fix(tts): keep the queue", "5555555"),
        ])

    def scaffold(self, entries=()):
        return cl.notes_scaffold("0.6.0", "2026-11-20", "v0.5.2", list(entries), repo_url=REPO)

    def test_the_scaffold_has_the_english_version_first_then_the_japanese_one(self):
        notes = self.scaffold()
        english, japanese = notes.split("\n---\n")
        body = english.split("-->", 1)[1].lstrip("\n")
        self.assertTrue(body.startswith("# ASTAROT 0.6.0\n\n[日本語版](#astarot-060日本語版)\n\nIn ASTAROT 0.6.0, "), body)
        self.assertTrue(japanese.lstrip("\n").startswith("# ASTAROT 0.6.0（日本語版）\n\nASTAROT 0.6.0では"), japanese)
        self.assertEqual(cl.heading_anchor("ASTAROT 0.6.0（日本語版）"), "astarot-060日本語版")
        # Apart from the two titles, every heading is ## and sits flat, as the format asks.
        self.assertEqual(re.findall(r"^#+ ", notes, re.M), ["# "] + ["## "] * 4 + ["# "] + ["## "] * 4)
        self.assertIn("from v0.5.2 to 0.6.0", english)
        self.assertIn("v0.5.2から0.6.0まで", english)

    def test_each_version_follows_the_order_of_the_format(self):
        notes = self.scaffold([
            cl.NotesEntry("internal", "docs: explain the route", "#5"),
            cl.NotesEntry("user", "feat(ui): show the flow", "#12"),
            cl.NotesEntry("breaking", "fix(api)!: change the reply", "#30"),
        ])
        english, japanese = notes.split("\n---\n")
        for part, texts in (
            (english, ("## (One emoji)", "## ⚠️ When you update", "## 🐞 Known issues", "## 🔧 Internal changes",
                       "- fix(api)!: change the reply (#30)", "- feat(ui): show the flow (#12)",
                       "- docs: explain the route (#5)", "All changes are in [CHANGELOG.md]")),
            (japanese, ("## （絵文字1つ）", "## ⚠️ 更新するときの注意", "## 🐞 既知の問題", "## 🔧 内部の変更",
                        "- fix(api)!: change the reply（#30）", "- feat(ui): show the flow（#12）",
                        "- docs: explain the route（#5）", "すべての変更は [CHANGELOG.md]")),
        ):
            order = [part.index(text) for text in texts]
            self.assertEqual(order, sorted(order))
            self.assertEqual(len(order), len(set(order)))
        self.assertIn(f"({REPO}/blob/main/CHANGELOG.md#060---2026-11-20).", english)
        self.assertTrue(notes.rstrip().endswith(f"({REPO}/blob/main/CHANGELOG.md#0602026-11-20) にあります。"))

    def test_a_release_without_pull_requests_says_so(self):
        notes = self.scaffold()
        self.assertIn("No pull requests merged after v0.5.2 were found", notes.split("## 🔧 Internal changes")[1])
        self.assertIn("見つかりませんでした", notes.split("## 🔧 内部の変更")[1])

    def test_the_changelog_links_reach_the_headings_github_makes(self):
        self.assertEqual(cl.changelog_anchor("0.5.1", "2026-11-18"), "051---2026-11-18")
        self.assertEqual(cl.changelog_anchor("1.10.0", "2027-01-02"), "1100---2027-01-02")
        self.assertEqual(cl.changelog_anchor_ja("0.5.1", "2026-11-18"), "0512026-11-18")
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertIn("\n## [0.5.1] - 2026-11-18\n", changelog)
        self.assertIn("\n## 0.5.1（2026-11-18）\n", changelog)
        # The notes written by hand before the scaffold link the same way.
        notes = (ROOT / "docs/release-notes/0.5.1.md").read_text(encoding="utf-8")
        self.assertIn("CHANGELOG.md#051---2026-11-18", notes)
        self.assertIn(f"[日本語版](#{cl.heading_anchor('ASTAROT 0.5.1（日本語版）')})", notes)


class VersionTest(unittest.TestCase):
    def test_accepts_the_release_channels_and_nothing_else(self):
        for good in ("0.1.0", "0.2.0-beta.1", "1.10.3-rc.2"):
            cl.require_version(good)
        for bad in ("v0.1.0", "0.1", "0.1.0-", "01.0.0", "0.1.0+build"):
            with self.assertRaises(cl.ChangelogError, msg=bad):
                cl.require_version(bad)


class CogCommandTest(unittest.TestCase):
    """mise on PATH without Cocogitto (a CI job that installs only Node) is no Cocogitto."""

    def which(self, cog=None):
        return lambda name: {"cog": cog, "mise": "/bin/mise"}.get(name)

    def test_cog_on_path_wins(self):
        with mock.patch.object(cl.shutil, "which", self.which(cog="/bin/cog")), \
                mock.patch.object(cl.subprocess, "run") as run:
            self.assertEqual(cl.cog_command(), ["cog"])
        run.assert_not_called()

    def test_mise_without_cocogitto_is_not_a_command(self):
        missing = subprocess.CompletedProcess([], 1, stdout="", stderr="cog is not a mise bin")
        with mock.patch.object(cl.shutil, "which", self.which()), \
                mock.patch.object(cl.subprocess, "run", return_value=missing):
            self.assertIsNone(cl.cog_command())

    def test_cocogitto_from_mise_runs_by_its_path(self):
        with tempfile.TemporaryDirectory() as folder:
            binary = Path(folder) / "cog"
            binary.write_text("")
            found = subprocess.CompletedProcess([], 0, stdout=f"{binary}\n", stderr="")
            with mock.patch.object(cl.shutil, "which", self.which()), \
                    mock.patch.object(cl.subprocess, "run", return_value=found) as run:
                self.assertEqual(cl.cog_command(), [str(binary)])
            self.assertEqual(run.call_args.args[0], ["/bin/mise", "which", "cog"])
            self.assertEqual(run.call_args.kwargs["cwd"], cl.ROOT)


@unittest.skipUnless(shutil.which("git") and cl.cog_command(), "needs git and Cocogitto")
class EndToEndTest(unittest.TestCase):
    """A small repository with real commits: a beta, then the stable release."""

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)

    def commit_files(self, *rows):
        for name, message in rows:
            (self.repo / name).write_text(name)
            self.git("add", name)
            self.git("commit", "-q", "-m", message)

    def set_version(self, version):
        (self.repo / "package.json").write_text(json.dumps({"version": version}))

    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.repo, ignore_errors=True)
        shutil.copy(ROOT / "cog.toml", self.repo)
        self.set_version("0.2.0-beta.1")
        self.git("init", "-q", "-b", "develop")
        self.git("config", "user.email", "t@example.invalid")
        self.git("config", "user.name", "tester")
        self.git("add", ".")
        self.git("commit", "-q", "-m", "chore: start")
        self.git("tag", "v0.1.0")
        self.commit_files(("a", "feat(ui): show the flow"), ("b", "test: cover the flow"))

    def run_tool(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "tools" / "changelog.py"), *args, "--root", str(self.repo)],
                              capture_output=True, text=True, encoding="utf-8")

    def test_a_beta_gets_notes_from_its_commits_and_no_changelog_section(self):
        write = self.run_tool("write")
        self.assertNotEqual(write.returncode, 0)
        self.assertIn("stable", write.stderr)
        self.assertFalse((self.repo / "CHANGELOG.md").exists())
        check = self.run_tool("check")
        self.assertEqual(check.returncode, 0, check.stderr)
        notes = self.run_tool("release-notes")
        self.assertEqual(notes.returncode, 0, notes.stderr)
        self.assertIn("Show the flow", notes.stdout)
        self.assertIn("compare/v0.1.0...v0.2.0-beta.1", notes.stdout)

    def test_the_stable_section_covers_its_betas_and_a_second_run_changes_nothing(self):
        self.git("tag", "v0.2.0-beta.1")
        self.commit_files(("c", "fix(api)!: change the reply\n\nBREAKING CHANGE: read the new field."))
        self.set_version("0.2.0")
        self.assertNotEqual(self.run_tool("check").returncode, 0)
        first = self.run_tool("write", "--date", "2026-11-14")
        self.assertEqual(first.returncode, 0, first.stderr)
        text = (self.repo / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertIn("## [0.2.0] - 2026-11-14", text)
        self.assertIn("compare/v0.1.0...v0.2.0", text)
        self.assertIn("This release includes the changes of 0.2.0-beta.1", text)
        self.assertIn("Show the flow", text)
        self.assertIn("## 0.2.0（2026-11-14）", text)
        self.assertIn("- **ui:** Show the flow（", text.split(cl.JA_TITLE)[1])
        self.assertLess(text.index("#### Breaking Changes"), text.index("#### Features"))
        self.assertLess(text.index("### User-facing Changes"), text.index("### Internal Changes"))
        again = self.run_tool("write", "--date", "2026-11-20")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual((self.repo / "CHANGELOG.md").read_text(encoding="utf-8"), text)
        self.assertEqual(self.run_tool("check").returncode, 0)
        notes = self.run_tool("release-notes")
        self.assertIn("blob/v0.2.0/CHANGELOG.md", notes.stdout)

    def test_the_output_is_utf8_on_a_console_that_is_not(self):
        # A Windows console's code page (cp1252 on the CI runners) cannot encode Japanese, which the
        # release notes carry; the tool writes UTF-8 whatever the console's encoding is.
        self.commit_files(("c", "fix(ui): keep the label 字幕 on one line"))
        env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
        notes = subprocess.run([sys.executable, str(ROOT / "tools" / "changelog.py"), "release-notes",
                                "--root", str(self.repo)], capture_output=True, env=env)
        self.assertEqual(notes.returncode, 0, notes.stderr.decode("utf-8", "replace"))
        self.assertIn("字幕", notes.stdout.decode("utf-8"))

    def test_refuses_a_version_that_is_already_tagged(self):
        self.set_version("0.2.0")
        self.git("tag", "v0.2.0")
        result = self.run_tool("write")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("v0.2.0", result.stderr)

    def merge_pull_request(self, number, branch, title, *rows):
        self.git("checkout", "-q", "-b", branch)
        self.commit_files(*rows)
        self.git("checkout", "-q", "develop")
        self.git("merge", "-q", "--no-ff", branch, "-m", f"Merge pull request #{number} from someone/{branch}", "-m", title)

    def test_the_notes_scaffold_lists_the_pull_requests_and_never_overwrites(self):
        self.merge_pull_request(12, "flow", "Show the flow in one place", ("c", "feat(ui): show the flow in one place"),
                                ("d", "test: cover the flow in one place"))
        self.merge_pull_request(14, "deps", "build(deps): update the tools", ("e", "build(deps): update the tools"))
        self.set_version("0.2.0")
        first = self.run_tool("scaffold-notes", "--date", "2026-11-14")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("no section for 0.2.0 yet", first.stderr)
        path = self.repo / "docs" / "release-notes" / "0.2.0.md"
        notes = path.read_text(encoding="utf-8")
        user, internal = notes.split("## 🔧 内部の変更")[1].split("<!-- 内部の変更だけ")
        # One line per pull request, under its most user-facing commit; its test commit is folded in.
        self.assertIn("- Show the flow in one place（#12）", user)
        self.assertNotIn("cover the flow in one place", notes)
        self.assertIn("- build(deps): update the tools（#14）", internal)
        # The commits made on develop itself have no pull request; their ids stand in.
        self.assertRegex(user, r"- feat\(ui\): show the flow（[0-9a-f]{7}）")
        self.assertRegex(internal, r"- test: cover the flow（[0-9a-f]{7}）")
        self.assertIn("CHANGELOG.md#020---2026-11-14", notes)
        path.write_text("written by hand\n", encoding="utf-8")
        again = self.run_tool("scaffold-notes")
        self.assertNotEqual(again.returncode, 0)
        self.assertIn("never overwritten", again.stderr)
        self.assertEqual(path.read_text(encoding="utf-8"), "written by hand\n")

    def test_the_notes_scaffold_is_for_stable_releases(self):
        result = self.run_tool("scaffold-notes")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pre-release", result.stderr)
        self.assertFalse((self.repo / "docs").exists())


if __name__ == "__main__":
    unittest.main()
