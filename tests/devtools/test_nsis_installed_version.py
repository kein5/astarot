"""Source contracts for the version the Windows installer records; real runs are in installer/."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")


def block(kind, name):
    return SOURCE.split(f"\n{kind} {name}\n", 1)[1].split(f"\n{kind}End", 1)[0]


def code_lines():
    """(line number, line) of the lines that are not comments."""
    return [(number, line) for number, line in enumerate(SOURCE.splitlines(), 1)
            if not line.lstrip().startswith((";", "#"))]


class InstalledVersionTests(unittest.TestCase):
    def test_the_apps_list_shows_the_version_installed(self):
        # /VERSION= installs another release than the installer's own (a rollback, say).
        install = block("Section", "Install")
        chosen = install.split("${If} $TargetVersion != \"\"", 1)[1].split("${EndIf}", 1)[0]
        self.assertIn("StrCpy $effective_version $TargetVersion", chosen)
        self.assertIn('WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "$effective_version"', install)
        self.assertNotIn('"DisplayVersion" "${VERSION}"', SOURCE)

    def test_the_reinstall_page_compares_the_version_to_install(self):
        page = block("Function", "PageReinstall")
        compare = page.split("compare_version:", 1)[1].split("Pop $R0", 1)[0]
        pinned, own = compare.split("${If} $TargetVersion != \"\"", 1)[1].split("${Else}", 1)
        self.assertIn("nsis_tauri_utils::SemverCompare $TargetVersion $R0", pinned)
        self.assertIn('nsis_tauri_utils::SemverCompare "${VERSION}" $R0', own.split("${EndIf}", 1)[0])


class NsisVariableTests(unittest.TestCase):
    def test_variables_are_declared_before_they_are_read(self):
        # makensis reads a variable named above its Var line as plain text (warning 6000) and
        # builds anyway, so a check such as ${If} $TargetVersion != "" is always true.
        # UILang: the language page reads it above its declaration, which predates this test.
        known = {"UILang"}
        lines = code_lines()
        declared = {}
        for number, line in lines:
            found = re.match(r"\s*Var\s+(?:/GLOBAL\s+)?([A-Za-z_][A-Za-z0-9_.]*)", line)
            if found:
                declared.setdefault(found[1], number)
        self.assertIn("TargetVersion", declared)
        for name, at in declared.items():
            if name in known:
                continue
            use = re.compile(r"\$" + re.escape(name) + r"(?![A-Za-z0-9_.])")
            first = next((number for number, line in lines if use.search(line)), at)
            with self.subTest(variable=name):
                self.assertGreaterEqual(first, at, f"${name} is used on line {first}, declared on line {at}")


if __name__ == "__main__":
    unittest.main()
