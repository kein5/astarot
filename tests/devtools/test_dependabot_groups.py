"""The npm groups of .github/dependabot.yml (the CI audit of 2026-11-22, item 6): the packages
whose major versions move together are grouped before the group of every minor and patch update,
and each package a group names exactly is one the project uses. Read without a YAML library, as
the tooling tests use the standard library only."""
import fnmatch
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


def items(found):
    """The items of a flow list `[a, "b"]` that `found` matched, unquoted."""
    return [item.strip().strip('"') for item in found.group(1).split(",")] if found else []


def npm_groups():
    """[(name, patterns, update types)] of the npm entry, in their order."""
    text = (ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")
    entry = re.search(r"- package-ecosystem: npm\n(.*?)(?=\n  - package-ecosystem:|\Z)", text, re.S).group(1)
    groups = []
    for name, body in re.findall(r"^      ([\w-]+):\n((?:        .*\n)+)", entry + "\n", re.M):
        patterns = re.search(r"patterns: \[(.*?)\]", body)
        types = re.search(r"update-types: \[(.*?)\]", body)
        groups.append((name, items(patterns), items(types)))
    return groups


class DependabotGroupTests(unittest.TestCase):
    def setUp(self):
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.packages = {*package.get("dependencies", {}), *package.get("devDependencies", {})}
        self.groups = npm_groups()

    def test_the_packages_that_move_together_have_their_majors_grouped(self):
        names = [name for name, _, _ in self.groups]
        self.assertEqual(names[-1], "npm-minor-and-patch", "the coupled groups come first; an update goes to the first match")
        for together in (["@types/react", "@types/react-dom"], ["i18next", "react-i18next"], ["@babel/parser", "@babel/types"],
                         ["storybook", "@storybook/react-vite"]):
            homes = set()
            for package in together:
                for name, patterns, types in self.groups:
                    if types == ["major"] and any(fnmatch.fnmatchcase(package, p) for p in patterns):
                        homes.add(name)
                        break
            self.assertEqual(len(homes), 1, f"{together} are not in one major group: {homes}")

    def test_every_package_a_group_names_is_used(self):
        for name, patterns, _ in self.groups:
            for pattern in patterns:
                if "*" in pattern:
                    self.assertTrue(any(fnmatch.fnmatchcase(p, pattern) for p in self.packages), f"{name}: {pattern} matches nothing")
                else:
                    self.assertIn(pattern, self.packages, f"{name}: {pattern} is not in package.json")


if __name__ == "__main__":
    unittest.main()
