"""The tools name the text encoding they read and write.

Without one, Python uses the system locale: cp932 on Japanese Windows, cp1252 on an English
one. The Python backend once wrote a model receipt that way and raised UnicodeEncodeError on
the "·" of every catalog entry, only on Japanese Windows and only after the whole download had
finished. The backend is gone (0.6.0); the tools that build, check and release the app read and
write manifests, logs and package.json on the same PCs.
"""
import ast
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tools"
PATH_TEXT_METHODS = {"read_text", "write_text"}
# Modules whose open() reads archives, not text: tarfile.open(..., mode='r:gz').
ARCHIVE_MODULES = {"tarfile"}


def is_binary(mode):
    return isinstance(mode, ast.Constant) and isinstance(mode.value, str) and "b" in mode.value


def has_keyword(call, name):
    return any(keyword.arg == name or keyword.arg is None for keyword in call.keywords)


def text_call_without_encoding(call):
    """A read_text/write_text/open call that falls back to the system locale."""
    function = call.func
    if isinstance(function, ast.Attribute) and function.attr in PATH_TEXT_METHODS:
        # read_text(encoding, errors), write_text(data, encoding, errors)
        positional = 1 if function.attr == "read_text" else 2
        return len(call.args) < positional and not has_keyword(call, "encoding")
    is_builtin = isinstance(function, ast.Name) and function.id == "open"
    is_method = isinstance(function, ast.Attribute) and function.attr == "open"
    if not (is_builtin or is_method):
        return False
    if is_method and isinstance(function.value, ast.Name) and function.value.id in ARCHIVE_MODULES:
        return False
    mode_index = 1 if is_builtin else 0
    mode = call.args[mode_index] if len(call.args) > mode_index else next(
        (keyword.value for keyword in call.keywords if keyword.arg == "mode"), None)
    # Path.open('w') names a mode. Other .open methods (urllib, os.open, webbrowser) do not.
    if is_method and not (isinstance(mode, ast.Constant) and isinstance(mode.value, str)):
        return False
    if is_binary(mode):
        return False
    encoding_index = 3 if is_builtin else 2
    return len(call.args) <= encoding_index and not has_keyword(call, "encoding")


def offenders():
    found = []
    for path in sorted(SOURCE.rglob("*.py")):
        relative = path.relative_to(ROOT).as_posix()
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=relative)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and text_call_without_encoding(node):
                found.append(f"{relative}:{node.lineno}")
    return found


class TextEncodingPolicyTests(unittest.TestCase):
    def test_the_tools_name_an_encoding_for_text(self):
        self.assertEqual(offenders(), [])

    def test_the_check_recognises_each_form(self):
        def flagged(source):
            return text_call_without_encoding(ast.parse(source, mode="eval").body)

        for source in ("path.read_text()", "path.read_text(errors='replace')", "path.write_text(text)",
                       "open(path)", "open(path, 'w')", "path.open('w')", "path.open(mode='x')"):
            self.assertTrue(flagged(source), source)
        for source in ("path.read_text(encoding='utf-8')", "path.read_text('utf-8')",
                       "path.write_text(text, encoding='utf-8')", "open(path, 'rb')",
                       "open(path, 'w', encoding='utf-8')", "path.open('xb')",
                       "path.open('w', encoding='utf-8')", "os.open(path, flags)",
                       "tarfile.open(fileobj=data, mode='r:gz')"):
            self.assertFalse(flagged(source), source)


if __name__ == "__main__":
    unittest.main()
