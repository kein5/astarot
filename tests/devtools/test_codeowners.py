"""The code owners list (.github/CODEOWNERS) names files that exist, as plain paths.

The branch rulesets require a code owner's approval for the files in the list: what the project
publishes, ships and signs (#679). A listed path that no longer exists, after a file moves, would
leave the moved file without that review, so each path must exist: a file as written, a folder
with a trailing slash. The pull-request skill checks a branch's files against the list with a
plain match on these paths, so the list keeps to paths anchored at the root, without wildcards.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
CODEOWNERS = ROOT / ".github" / "CODEOWNERS"
# "/path @owner", one or more owners; no wildcards, ranges, negation or escapes in the path.
ENTRY = re.compile(r"^/[^\s*?\[\]!\\]+(?:\s+@[\w.-]+(?:/[\w.-]+)?)+$")


def entries():
    for number, line in enumerate(CODEOWNERS.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if line and not line.startswith("#"):
            yield number, line


class CodeOwnersTest(unittest.TestCase):
    def test_each_entry_is_a_plain_path_from_the_root_with_its_owners(self):
        for number, line in entries():
            with self.subTest(line=number):
                self.assertRegex(line, ENTRY)

    def test_each_path_exists_as_written(self):
        for number, line in entries():
            path = line.split()[0][1:]
            target = ROOT / path.rstrip("/")
            with self.subTest(line=number, path=path):
                if path.endswith("/"):
                    self.assertTrue(target.is_dir(), f"{path} is not a folder")
                else:
                    self.assertTrue(target.is_file(), f"{path} is not a file")

    def test_each_path_is_listed_once(self):
        paths = [line.split()[0] for _, line in entries()]
        self.assertEqual(sorted(set(paths)), sorted(paths))


if __name__ == "__main__":
    unittest.main()
