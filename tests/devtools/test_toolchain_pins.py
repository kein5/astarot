"""mise.toml is the one place the development toolchain versions are pinned (issue #332)."""
from pathlib import Path
import re
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[2]
# The checks of the repository (workflows, crates, secrets, vulnerabilities, links, hooks) and the
# migration and release helpers, pinned with the toolchains.
CHECK_TOOLS = ("actionlint", "zizmor", "cargo-deny", "cargo-nextest", "gitleaks", "osv-scanner", "lychee", "hk",
               "ast-grep", "syft")
# Built from crates.io with cargo (#550): mise.lock pins the version, and Cargo checks the crates.
CARGO_TOOLS = ("cargo:cargo-llvm-cov", "cargo:cargo-mutants")
TOOLS = ("node", "rust", "python", "uv", "cocogitto", "biome", *CHECK_TOOLS, *CARGO_TOOLS)
# Downloaded archives mise.lock checks by SHA-256. Rust comes through rustup, and the cargo tools
# are built from source, so neither has an archive checksum in the lock.
LOCKED_ARCHIVES = ("node", "python", "uv", "cocogitto", "biome", *CHECK_TOOLS)
PLATFORMS = ("linux-x64", "windows-x64")


def pinned():
    tools = tomllib.loads((ROOT / "mise.toml").read_text(encoding="utf-8"))["tools"]
    return {name: (value["version"] if isinstance(value, dict) else value) for name, value in tools.items()}


def ci_files():
    github = ROOT / ".github"
    return sorted([*github.glob("workflows/*.yml"), *github.glob("actions/*/action.yml")])


class ToolchainPinTests(unittest.TestCase):
    def test_every_tool_has_an_exact_version(self):
        versions = pinned()
        for name in TOOLS:
            self.assertRegex(versions.get(name, ""), r"^\d+\.\d+\.\d+$", f"{name} in mise.toml")

    def test_python_satisfies_pyproject(self):
        requires = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]["requires-python"]
        major, minor = pinned()["python"].split(".")[:2]
        self.assertEqual(requires, f"=={major}.{minor}.*")

    def test_uv_is_never_handed_a_python_version_of_its_own(self):
        # uv takes the interpreter mise put on PATH (UV_PYTHON_PREFERENCE=only-system); a literal
        # `--python 3.x` in a workflow, a task or a script would be a second place to update.
        scripts = [*ci_files(), ROOT / "mise.toml", *ROOT.glob("bat/*.bat"), ROOT / "tools/dev.py"]
        for path in scripts:
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"--python[ =]\"?\d", path.relative_to(ROOT))

    def test_the_separate_environments_use_the_same_python(self):
        # Environments with locks of their own (the RVC reference, the translation export, the
        # chatbox lab) run on the minor version mise.toml pins too.
        minor = pinned()["python"].split(".")[1]
        for name in ("native/rvc-runtime/reference/requirements.in", "tools/translation_onnx/requirements.txt",
                     "tools/translation_onnx/README.md", "tools/chatbox_lab/README.md"):
            text = (ROOT / name).read_text(encoding="utf-8")
            for found in re.findall(r"(?:Python |--python(?:-version)?[ =])3\.(\d+)", text):
                self.assertEqual(found, minor, f"{name} names Python 3.{found}")
        # The reference setup lets uv pick the version requires-python names.
        for name in ("native/rvc-runtime/reference/setup_reference.py",):
            self.assertNotRegex((ROOT / name).read_text(encoding="utf-8"), r"'--python', '\d", name)

    def test_rust_is_not_older_than_the_crates_require(self):
        major_minor = tuple(int(part) for part in pinned()["rust"].split(".")[:2])
        manifests = [ROOT / "src-tauri/Cargo.toml", *ROOT.glob("native/*/Cargo.toml"), *ROOT.glob("utils/*/Cargo.toml")]
        for manifest in sorted(path for path in manifests if path.is_file()):
            match = re.search(r'^rust-version\s*=\s*"(\d+)\.(\d+)', manifest.read_text(encoding="utf-8"), re.M)
            if match:
                self.assertGreaterEqual(major_minor, (int(match[1]), int(match[2])), manifest)

    def test_no_second_version_file(self):
        for name in ("rust-toolchain", "rust-toolchain.toml", ".nvmrc", ".node-version",
                     ".python-version", ".tool-versions"):
            self.assertFalse((ROOT / name).exists(), f"{name} would pin a version outside mise.toml")

    def test_lock_matches_the_pins_on_both_platforms(self):
        lock = tomllib.loads((ROOT / "mise.lock").read_text(encoding="utf-8"))["tools"]
        versions = pinned()
        for name in TOOLS:
            entries = lock.get(name, [])
            self.assertEqual([entry["version"] for entry in entries], [versions[name]], f"mise.lock {name}")
            if name in LOCKED_ARCHIVES:
                for platform in PLATFORMS:
                    checksum = entries[0].get(f"platforms.{platform}", {}).get("checksum", "")
                    self.assertRegex(checksum, r"^sha256:[0-9a-f]{64}$", f"{name} {platform}")

    def test_nextest_comes_from_its_own_releases(self):
        # mise's registry has no cargo-nextest; the alias names the project's GitHub releases.
        config = tomllib.loads((ROOT / "mise.toml").read_text(encoding="utf-8"))
        self.assertEqual(config["tool_alias"]["cargo-nextest"], "github:nextest-rs/nextest")
        lock = tomllib.loads((ROOT / "mise.lock").read_text(encoding="utf-8"))["tools"]
        self.assertEqual(lock["cargo-nextest"][0]["backend"], "github:nextest-rs/nextest")

    def test_ci_installs_the_toolchains_through_mise(self):
        uses_mise = False
        for path in ci_files():
            text = path.read_text(encoding="utf-8")
            for retired in ("actions/setup-node", "actions/setup-python", "astral-sh/setup-uv",
                            "dtolnay/rust-toolchain", "node-version:", "python-version:",
                            "cargo install cocogitto"):
                self.assertNotIn(retired, text, f"{path.relative_to(ROOT)} sets a version outside mise.toml")
            uses_mise = uses_mise or "jdx/mise-action@" in text
        self.assertTrue(uses_mise)

    def test_mise_action_is_pinned_to_a_commit(self):
        for path in ci_files():
            for ref in re.findall(r"jdx/mise-action@(\S+)", path.read_text(encoding="utf-8")):
                self.assertRegex(ref, r"^[0-9a-f]{40}$", path.relative_to(ROOT))


if __name__ == "__main__":
    unittest.main()
