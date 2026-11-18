"""The UI's TypeScript files keep their types honest.

`tsc` checks the TypeScript files strictly (ADR-010), but `any`, a double cast through
`unknown` or a `@ts-...` comment switch the check off where they stand. A file that moves
from JavaScript is typed for real, not quietened, so these do not appear (Issue #544).

A use that cannot go yet is listed in ALLOWED with its count. The test fails when the
count grows and also when it shrinks, so the list is lowered as soon as a use goes.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src-ui"

# path (relative to the repository) -> uses that remain
ALLOWED = {}

DIRECTIVE = re.compile(r"@ts-(?:ignore|nocheck|expect-error)\b")
LINE_COMMENT = re.compile(r"(?<![:\\])//[^\n]*")
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
LOOSE_TYPES = [
    re.compile(r":\s*any\b"),               # value: any, (): any
    re.compile(r"\bas\s+any\b"),            # x as any
    re.compile(r"[<,]\s*any\s*[>,\[]"),     # Promise<any>, Record<string, any>
    re.compile(r"\bany\s*\[\]"),            # any[]
    re.compile(r"=\s*any\s*[;\n]"),         # type T = any
    re.compile(r"\bas\s+unknown\s+as\b"),   # x as unknown as T
]


def typescript_files():
    for pattern in ("*.ts", "*.tsx"):
        for path in SOURCE.rglob(pattern):
            if "node_modules" not in path.parts:
                yield path


def loose_uses(text):
    count = len(DIRECTIVE.findall(text))
    code = LINE_COMMENT.sub("", BLOCK_COMMENT.sub("", text))
    return count + sum(len(pattern.findall(code)) for pattern in LOOSE_TYPES)


class TypeScriptStrictnessTests(unittest.TestCase):
    def test_typescript_files_are_typed_without_escape_hatches(self):
        found = {}
        for path in typescript_files():
            uses = loose_uses(path.read_text(encoding="utf-8"))
            if uses:
                found[path.relative_to(ROOT).as_posix()] = uses
        self.assertEqual(found, ALLOWED)

    def test_patterns_catch_the_usual_forms(self):
        for text in ("let a: any;", "x as any", "Promise<any>", "Record<string, any>", "any[]",
                     "type T = any;\n", "x as unknown as T", "// @ts-ignore\nx", "/* @ts-expect-error */"):
            with self.subTest(text=text):
                self.assertGreater(loose_uses(text), 0)

    def test_words_in_comments_and_unknown_types_are_not_counted(self):
        for text in ("// for any cable that did not fit", "/* any other value */", "let a: unknown;",
                     "const url = \"https://example.test/any\";", "x as unknown;", "anything: string"):
            with self.subTest(text=text):
                self.assertEqual(loose_uses(text), 0)


if __name__ == "__main__":
    unittest.main()
