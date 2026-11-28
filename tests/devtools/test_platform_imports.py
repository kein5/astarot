"""The desktop tests in tests/platform import what exists (issue #811).

Those tests need a built app, a display and often a flag, so CI skips most of them, and a test
that imports a helper another change removed fails only when someone runs it by hand. Three did
after #285 removed the Python backend. This reads every file there without running it: each
`from <module> import <name>` of a module in tests/platform or in tools must name something that
module defines at its top level, and a module the tests import from there must exist.
"""
import ast
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def top_level_names(path):
    """What `from <module> import <name>` can take from `path`: its definitions and imports,
    also those under a module-level if, try or with."""
    names = set()

    def visit(body):
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(node.name)
            elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for target in targets:
                    for element in (target.elts if isinstance(target, (ast.Tuple, ast.List)) else [target]):
                        if isinstance(element, ast.Name):
                            names.add(element.id)
            elif isinstance(node, ast.ImportFrom):
                names.update(alias.asname or alias.name for alias in node.names)
            elif isinstance(node, ast.Import):
                names.update((alias.asname or alias.name).split(".")[0] for alias in node.names)
            elif isinstance(node, (ast.If, ast.Try, ast.With)):
                visit(node.body)
                visit(getattr(node, "orelse", []))
                visit(getattr(node, "finalbody", []))
                for handler in getattr(node, "handlers", []):
                    visit(handler.body)

    visit(ast.parse(path.read_text(encoding="utf-8"), filename=str(path)).body)
    return names


def problems(platform, tools):
    """Imports in `platform`'s files that do not resolve, as "<file>:<line>: <what>"."""
    modules = {path.stem: path for path in platform.glob("*.py")}
    modules.update({f"tools.{path.stem}": path for path in tools.glob("*.py")})
    defined = {}
    found = []
    for path in sorted(platform.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), filename=str(path))):
            if isinstance(node, ast.ImportFrom) and node.module == "tools" and not node.level:
                # `from tools import <module>` takes a module, not a name defined in one.
                wanted = [(f"tools.{alias.name}", None) for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                wanted = [(node.module, alias.name) for alias in node.names]
            elif isinstance(node, ast.Import):
                wanted = [(alias.name, None) for alias in node.names]
            else:
                continue
            for module, name in wanted:
                if module not in modules:
                    # A third-party or standard module is not this test's to check. A module named
                    # like the tests' own helpers that is not there is.
                    if module.startswith(("test_", "native_", "tools.")):
                        found.append((path.name, node.lineno, f"no module {module}"))
                    continue
                if name is None or name == "*":
                    continue
                if module not in defined:
                    defined[module] = top_level_names(modules[module])
                if name not in defined[module]:
                    found.append((path.name, node.lineno, f"{module} has no {name}"))
    return [f"{name}:{line}: {what}" for name, line, what in sorted(found)]


class PlatformImportTests(unittest.TestCase):
    def test_every_import_in_the_desktop_tests_resolves(self):
        self.assertEqual(problems(ROOT / "tests/platform", ROOT / "tools"), [])

    def test_an_import_of_a_removed_helper_is_found(self):
        with tempfile.TemporaryDirectory() as folder:
            platform, tools = Path(folder, "platform"), Path(folder, "tools")
            platform.mkdir()
            tools.mkdir()
            (platform / "native_helper.py").write_text(
                "import os\nKEPT = 1\nif os.name:\n    def guarded():\n        pass\n\n\ndef helper():\n    pass\n",
                encoding="utf-8")
            (tools / "private_tool.py").write_text("def start():\n    pass\n", encoding="utf-8")
            (platform / "test_thing.py").write_text(
                "import pytest\n"
                "from native_helper import helper, KEPT, guarded\n"
                "from tools.private_tool import start\n"
                "from tools import private_tool\n\n\n"
                "def test_one():\n"
                "    from native_helper import gone\n"
                "    from test_removed_module import anything\n"
                "    from tools.private_tool import stopped\n"
                "    from tools import removed_tool\n",
                encoding="utf-8")
            self.assertEqual(problems(platform, tools), [
                "test_thing.py:8: native_helper has no gone",
                "test_thing.py:9: no module test_removed_module",
                "test_thing.py:10: tools.private_tool has no stopped",
                "test_thing.py:11: no module tools.removed_tool",
            ])


if __name__ == "__main__":
    unittest.main()
