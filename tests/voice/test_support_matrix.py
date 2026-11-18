"""The platform support matrix (site/*/guide/support.md) stays in step with what CI builds and tests.

The matrix lists every package the release workflows produce, names the clean systems the
Linux packages are installed on, and keeps the Japanese and English pages the same shape, so
that a change to the release targets or to one language shows up here (Issue #516).
"""
import re
from pathlib import Path

import pytest
import yaml

from tools import release_candidate

ROOT = Path(__file__).resolve().parents[2]
PAGES = {lang: ROOT / "site" / lang / "guide" / "support.md" for lang in ("ja", "en")}
LEDGER = "docs/voice-stack/platform-verification.md"
LINUX_FORMATS = {"tar.gz": ".tar.gz", "AppImage": ".AppImage", "deb": ".deb", "rpm": ".rpm"}
DISTRIBUTIONS = {"ubuntu": "Ubuntu", "debian": "Debian", "fedora": "Fedora"}


def tables(text):
    """Each Markdown table as a list of rows (header first, separator dropped), cells stripped."""
    found, current = [], []
    for line in text.splitlines() + [""]:
        if line.startswith("|"):
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if not all(re.fullmatch(r":?-+:?", cell) for cell in cells):
                current.append(cells)
        elif current:
            found.append(current)
            current = []
    return found


def package_table(lang):
    """The "systems and packages" table: the only one whose header has five columns."""
    matches = [table for table in tables(PAGES[lang].read_text(encoding="utf-8")) if len(table[0]) == 5]
    assert len(matches) == 1, lang
    return matches[0][1:]


def is_windows(row):
    return row[0].startswith("Windows") and "ARM64" not in row[0]


def is_linux(row):
    return not row[0].startswith(("Windows", "macOS")) and "ARM64" not in row[0]


def test_both_languages_have_the_same_tables():
    shapes = {
        lang: [(len(table), len(table[0])) for table in tables(path.read_text(encoding="utf-8"))]
        for lang, path in PAGES.items()
    }
    assert shapes["ja"] == shapes["en"]


@pytest.mark.parametrize("lang", PAGES)
def test_the_windows_rows_name_every_windows_release_file(lang):
    shipped = {
        name
        for row in package_table(lang)
        if is_windows(row)
        for name in re.findall(r"`([^`]+\.(?:exe|zip))`", row[1])
    }
    # Raises unless the names are exactly the files a Windows release candidate carries.
    release_candidate.names("windows", "0.0.0", shipped)


@pytest.mark.parametrize("lang", PAGES)
def test_the_linux_rows_name_every_linux_package(lang):
    formats = {
        word
        for row in package_table(lang)
        if is_linux(row)
        for word in re.split(r"[、,]\s*|\s+", row[1])
        if word in LINUX_FORMATS
    }
    stem = "VRCT-VOX-0.0.0-linux-x64-release"
    release_candidate.names("linux", "0.0.0", {stem + LINUX_FORMATS[word] for word in formats})


def ci_systems():
    workflow = (ROOT / ".github/workflows/build-linux.yml").read_text(encoding="utf-8")
    images = {
        f"{DISTRIBUTIONS[name]} {version}"
        for name, version in re.findall(r"\b(ubuntu|debian|fedora):([0-9.]+)@sha256:", workflow)
    }
    runner = yaml.load(workflow, Loader=yaml.BaseLoader)["jobs"]["candidate"]["runs-on"]
    match = re.fullmatch(r"ubuntu-([0-9.]+)", runner)
    assert match, runner
    return images, f"Ubuntu {match.group(1)}"


@pytest.mark.parametrize("lang", PAGES)
def test_the_package_rows_name_the_systems_ci_uses(lang):
    images, runner = ci_systems()
    assert images, "build-linux.yml no longer installs the packages in pinned containers"
    rows = package_table(lang)
    systems = " ".join(row[0] for row in rows)
    for image in images:
        assert image in systems, image
    # The tar.gz and AppImage acceptance runs on the runner itself.
    tested = [row for row in rows if row[1] in ("AppImage", "tar.gz")]
    assert len(tested) == 2 and all(runner in row[3] for row in tested), runner


@pytest.mark.parametrize("lang", PAGES)
def test_the_page_is_in_the_sidebar_and_points_at_the_ledger(lang):
    assert (ROOT / LEDGER).is_file()
    assert LEDGER in PAGES[lang].read_text(encoding="utf-8")
    config = (ROOT / "site/.vitepress/config.mts").read_text(encoding="utf-8")
    assert f"link: '/{lang}/guide/support'" in config
