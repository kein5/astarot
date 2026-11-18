#!/usr/bin/env python3
"""Check the architecture decision records in docs/adr/ and regenerate their index table.

Every ADR is docs/adr/adr-NNN-<slug>.md and starts with a front matter block whose fields
are defined in docs/adr/README.md. The index table in that README is generated from them:

    python tools/adr_catalog.py --write   # regenerate the index table
    python tools/adr_catalog.py --check   # exit 1 on any problem below

--check reports duplicate or malformed numbers, missing or unknown fields, values outside
the allowed sets, references to ADRs that do not exist, evidence paths that do not exist,
relative links in docs/adr/ (or into it, from any Markdown file) whose file is missing,
links that still point at the old locations in docs/voice-stack/, and a stale index.

The front matter uses a small subset of YAML (plain or double-quoted scalars, block or
empty lists), so it is read with the standard library and stays valid YAML. Messages are
ASCII so that a Windows console prints them.
"""

from __future__ import annotations

import argparse
import datetime
import os
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
ADR_DIR = PurePosixPath("docs/adr")
LEGACY_DIR = PurePosixPath("docs/voice-stack")
LEGACY_INDEX = LEGACY_DIR / "decisions.md"
NON_ADR_FILES = {"README.md", "TEMPLATE.md"}
START = "<!-- adr-index:start -->"
END = "<!-- adr-index:end -->"
NOTE = "<!-- 自動生成。手で編集しない。`python tools/adr_catalog.py --write`で更新する。 -->"

FILE_NAME = re.compile(r"adr-(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md")
HEADING = re.compile(r"# ADR[- ]?(\d+)\s*[:：]\s*(.+)")
ADR_REF = re.compile(r"ADR-(\d{3})")

STATUS = {"proposed": "提案", "accepted": "採用", "rejected": "不採用", "superseded": "置き換え済み",
          "deprecated": "廃止"}
IMPLEMENTATION = {"pending": "未着手", "partial": "一部", "implemented": "実装済み", "not_applicable": "対象外",
                  "unknown": "未確認"}
VALIDITY = {"current": "有効", "implementation_changed": "実装の方式が変わった", "replaced": "置き換えられた",
            "unknown": "未確認"}
ERA = {"python-sidecar": "Python のサイドカー", "rust-core": "Rust の中核"}

REQUIRED = ("date", "status", "era", "validity", "implementation_status")
OPTIONAL = ("validity_note", "superseded_by", "implementation_checked", "implementation_note", "evidence")
LISTS = {"superseded_by", "evidence"}


class Adr:
    """One record: its number, path, title (from the heading) and front matter fields."""

    def __init__(self, number: int, path: PurePosixPath):
        self.number = number
        self.path = path
        self.title = ""
        self.meta: dict = {}


# --- front matter --------------------------------------------------------------------------

PLAIN_START = re.compile(r"""[-?:,\[\]{}#&*!|>'"%@`]""")


def scalar(raw: str, where: str, errors: list[str]) -> str:
    """One scalar of the subset: plain (no ': ', ' #', no YAML indicator first) or double-quoted."""
    if raw.startswith('"'):
        if len(raw) < 2 or not raw.endswith('"') or re.search(r'(?<!\\)"', raw[1:-1]) or re.search(r'\\[^"\\]', raw):
            errors.append(f"{where}: a quoted value may only escape \\\" and \\\\")
            return raw
        return raw[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    if PLAIN_START.match(raw) or ": " in raw or " #" in raw or raw.endswith(":"):
        errors.append(f"{where}: quote the value with double quotes (it has ': ', ' #' or a YAML indicator)")
    return raw


def front_matter(text: str, name: str, errors: list[str]) -> tuple[dict, list[str]]:
    """The fields of the leading '---' block and the lines after it."""
    lines = text.split("\n")
    if not lines or lines[0] != "---":
        errors.append(f"{name}: the file must start with a '---' front matter block")
        return {}, lines
    try:
        end = lines.index("---", 1)
    except ValueError:
        errors.append(f"{name}: the front matter block has no closing '---'")
        return {}, lines
    meta: dict = {}
    key = None
    for number, line in enumerate(lines[1:end], 2):
        where = f"{name}:{number}"
        item = re.fullmatch(r"  - (.+)", line)
        if item:
            if key is None or not isinstance(meta.get(key), list):
                errors.append(f"{where}: a list item must follow a 'key:' line with no value")
                continue
            meta[key].append(scalar(item.group(1).strip(), where, errors))
            continue
        pair = re.fullmatch(r"([a-z_]+):(?: (.*))?", line)
        if not pair:
            errors.append(f"{where}: expected 'key: value', 'key:' or '  - item'")
            key = None
            continue
        key, raw = pair.group(1), (pair.group(2) or "").strip()
        if key in meta:
            errors.append(f"{where}: '{key}' is given twice")
        if raw == "":
            meta[key] = []
        elif raw == "[]":
            meta[key] = []
        elif raw.startswith("["):
            errors.append(f"{where}: write the list of '{key}' as '  - item' lines")
            meta[key] = []
        else:
            meta[key] = scalar(raw, where, errors)
    return meta, lines[end + 1:]


def is_date(value: object) -> bool:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return False
    return True


# --- collecting and validating ---------------------------------------------------------------

def collect(root: Path, errors: list[str]) -> dict[int, Adr]:
    adrs: dict[int, Adr] = {}
    directory = root / ADR_DIR
    if not directory.is_dir():
        errors.append(f"{ADR_DIR} does not exist")
        return adrs
    for path in sorted(directory.iterdir()):
        if path.name in NON_ADR_FILES or path.is_dir():
            continue
        relative = ADR_DIR / path.name
        match = FILE_NAME.fullmatch(path.name)
        if not match:
            errors.append(f"{relative}: ADR files are named adr-NNN-<lowercase-words>.md")
            continue
        number = int(match.group(1))
        if number in adrs:
            errors.append(f"{relative}: ADR {number:03d} is already {adrs[number].path}")
            continue
        adr = Adr(number, relative)
        text = path.read_text(encoding="utf-8")
        adr.meta, body = front_matter(text, str(relative), errors)
        heading = next((line for line in body if line.strip()), "")
        title = HEADING.fullmatch(heading)
        if not title:
            errors.append(f"{relative}: the first line after the front matter must be '# ADR-{number:03d}: <title>'")
        elif int(title.group(1)) != number:
            errors.append(f"{relative}: the heading says ADR {title.group(1)}, the file name says {number:03d}")
        else:
            adr.title = title.group(2).strip()
        adrs[number] = adr
    if not adrs:
        errors.append(f"{ADR_DIR} has no ADR files")
    return adrs


def validate(root: Path, adrs: dict[int, Adr], errors: list[str]) -> None:
    for adr in adrs.values():
        meta, name = adr.meta, adr.path
        if not meta:
            continue
        for key in meta:
            if key not in REQUIRED and key not in OPTIONAL:
                errors.append(f"{name}: unknown field '{key}'")
        for key in REQUIRED:
            if key not in meta:
                errors.append(f"{name}: missing field '{key}'")
        for key in meta:
            if (key in LISTS) != isinstance(meta[key], list):
                errors.append(f"{name}: '{key}' must be {'a list' if key in LISTS else 'a single value'}")
        if any(key not in meta or isinstance(meta[key], list) for key in REQUIRED):
            continue
        for key, allowed in (("status", STATUS), ("era", ERA), ("validity", VALIDITY),
                             ("implementation_status", IMPLEMENTATION)):
            if meta[key] not in allowed:
                errors.append(f"{name}: {key} '{meta[key]}' is not one of {', '.join(allowed)}")
        for key in ("date", "implementation_checked"):
            if key in meta and not is_date(meta[key]):
                errors.append(f"{name}: {key} must be a date (YYYY-MM-DD)")

        replaced = meta["validity"] == "replaced" or meta["status"] == "superseded"
        successors = meta.get("superseded_by", [])
        if meta["status"] == "superseded" and meta["validity"] != "replaced":
            errors.append(f"{name}: a superseded ADR has validity 'replaced'")
        if replaced and not successors:
            errors.append(f"{name}: superseded_by must name the ADR that replaced it")
        if successors and not replaced:
            errors.append(f"{name}: superseded_by is only for status 'superseded' or validity 'replaced'")
        for successor in successors if isinstance(successors, list) else []:
            ref = ADR_REF.fullmatch(successor)
            if not ref:
                errors.append(f"{name}: superseded_by entries are written ADR-NNN, not '{successor}'")
            elif int(ref.group(1)) not in adrs:
                errors.append(f"{name}: superseded_by names {successor}, which does not exist")
            elif int(ref.group(1)) == adr.number:
                errors.append(f"{name}: an ADR cannot replace itself")
        if meta["validity"] in ("implementation_changed", "replaced") and not meta.get("validity_note"):
            errors.append(f"{name}: validity '{meta['validity']}' needs a validity_note saying what changed")

        status = meta["implementation_status"]
        if status in ("pending", "partial", "implemented") and "implementation_checked" not in meta:
            errors.append(f"{name}: implementation_status '{status}' needs implementation_checked")
        if status == "partial" and not meta.get("implementation_note"):
            errors.append(f"{name}: implementation_status 'partial' needs an implementation_note saying what is left")
        evidence = meta.get("evidence", [])
        if (meta["validity"] != "unknown" or status != "unknown") and not evidence:
            errors.append(f"{name}: evidence must list the files that back validity and implementation_status")
        for entry in evidence if isinstance(evidence, list) else []:
            if "#" in entry or entry.startswith("/") or ".." in PurePosixPath(entry).parts:
                errors.append(f"{name}: evidence '{entry}' must be a plain repository path")
            elif not (root / entry).exists():
                errors.append(f"{name}: evidence '{entry}' does not exist")


# --- links ---------------------------------------------------------------------------------

FENCE = re.compile(r"\s*(```|~~~)")
LINK = re.compile(r"\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\)")
SKIPPED_DIRS = {".git", "node_modules", "build", "target", "dist", ".venv", ".venv_linux"}


def markdown_files(root: Path) -> list[PurePosixPath]:
    try:
        run = subprocess.run(["git", "-C", str(root), "ls-files", "-z", "--cached", "--others",
                              "--exclude-standard", "*.md"], capture_output=True, text=True, check=True,
                             encoding="utf-8")
        names = [name for name in run.stdout.split("\0") if name]
        if names:
            return sorted({PurePosixPath(name) for name in names if (root / name).is_file()})
    except (OSError, subprocess.CalledProcessError):
        pass
    found = []
    for directory, subdirs, files in os.walk(root):
        subdirs[:] = [d for d in subdirs if d not in SKIPPED_DIRS]
        for name in files:
            if name.endswith(".md"):
                found.append(PurePosixPath(Path(directory, name).relative_to(root).as_posix()))
    return sorted(found)


def links(text: str):
    """(line number, target) of the inline links outside code."""
    fenced = False
    for number, line in enumerate(text.split("\n"), 1):
        if FENCE.match(line):
            fenced = not fenced
            continue
        if fenced:
            continue
        for match in LINK.finditer(re.sub(r"`[^`]*`", "", line)):
            yield number, match.group(1)


def is_legacy(target: PurePosixPath) -> bool:
    return target == LEGACY_INDEX or (target.parent == LEGACY_DIR and FILE_NAME.fullmatch(target.name) is not None)


def check_links(root: Path, errors: list[str]) -> None:
    for source in markdown_files(root):
        text = (root / source).read_text(encoding="utf-8", errors="replace")
        legacy_source = is_legacy(source)
        for number, target in links(text):
            if re.match(r"[A-Za-z][A-Za-z0-9+.-]*:", target) or target.startswith(("#", "/")):
                continue
            path = target.split("#", 1)[0].split("?", 1)[0]
            if not path:
                continue
            resolved = PurePosixPath(os.path.normpath(os.path.join(str(source.parent), path)).replace(os.sep, "/"))
            where = f"{source}:{number}"
            inside = source.parent == ADR_DIR or resolved.parent == ADR_DIR
            if inside and not (root / resolved).exists():
                errors.append(f"{where}: link to {resolved}, which does not exist")
            if is_legacy(resolved) and not legacy_source:
                errors.append(f"{where}: link to the old location {resolved}; link to {ADR_DIR}/ instead")


def check_legacy_pointers(root: Path, adrs: dict[int, Adr], errors: list[str]) -> None:
    """Each page left at an old location points at its record in docs/adr/."""
    names = {adr.path.name for adr in adrs.values()}
    for path in sorted((root / LEGACY_DIR).glob("adr-*.md")):
        relative = LEGACY_DIR / path.name
        if path.name not in names:
            errors.append(f"{relative}: no ADR with this file name in {ADR_DIR}/")
        elif f"](../adr/{path.name})" not in path.read_text(encoding="utf-8"):
            errors.append(f"{relative}: the page at the old location must link to ../adr/{path.name}")
    index = root / LEGACY_INDEX
    if index.exists() and "](../adr/README.md)" not in index.read_text(encoding="utf-8"):
        errors.append(f"{LEGACY_INDEX}: must link to ../adr/README.md")


# --- index ---------------------------------------------------------------------------------

def cell(value: str) -> str:
    return re.sub(r"\s+", " ", value).replace("|", "\\|").strip()


def index_table(adrs: dict[int, Adr]) -> str:
    rows = ["| ADR | 題名 | 日付 | 状態 | 実装 | 有効性 | 時代 |", "|---|---|---|---|---|---|---|"]
    for number in sorted(adrs):
        adr = adrs[number]
        meta = adr.meta
        validity = VALIDITY.get(meta.get("validity", ""), "")
        successors = [s for s in meta.get("superseded_by", []) if ADR_REF.fullmatch(s) and int(s[4:]) in adrs]
        if successors:
            validity += "（" + "、".join(f"[{s}]({adrs[int(s[4:])].path.name})" for s in successors) + "）"
        rows.append("| " + " | ".join([
            f"[{number:03d}]({adr.path.name})", cell(adr.title), meta.get("date", ""),
            STATUS.get(meta.get("status", ""), ""), IMPLEMENTATION.get(meta.get("implementation_status", ""), ""),
            validity, ERA.get(meta.get("era", ""), ""),
        ]) + " |")
    return "\n".join([START, NOTE, "", *rows, "", END])


def split_index(readme: str) -> tuple[str, str, str] | None:
    if readme.count(START) != 1 or readme.count(END) != 1 or readme.index(START) > readme.index(END):
        return None
    head, rest = readme.split(START, 1)
    current, tail = rest.split(END, 1)
    return head, START + current + END, tail


def check(root: Path) -> list[str]:
    errors: list[str] = []
    adrs = collect(root, errors)
    validate(root, adrs, errors)
    check_links(root, errors)
    check_legacy_pointers(root, adrs, errors)
    template = root / ADR_DIR / "TEMPLATE.md"
    if template.exists():
        meta, _ = front_matter(template.read_text(encoding="utf-8"), f"{ADR_DIR}/TEMPLATE.md", errors)
        errors += [f"{ADR_DIR}/TEMPLATE.md: unknown field '{key}'" for key in meta if key not in REQUIRED + OPTIONAL]
        errors += [f"{ADR_DIR}/TEMPLATE.md: missing field '{key}'" for key in REQUIRED if key not in meta]
    readme = root / ADR_DIR / "README.md"
    parts = split_index(readme.read_text(encoding="utf-8")) if readme.exists() else None
    if parts is None:
        errors.append(f"{ADR_DIR}/README.md must hold exactly one {START} ... {END} block")
    elif parts[1] != index_table(adrs):
        errors.append(f"{ADR_DIR}/README.md: the index is out of date; run python tools/adr_catalog.py --write")
    return errors


def write(root: Path) -> bool:
    """Replace the index block of docs/adr/README.md; False when the block is missing."""
    errors: list[str] = []
    adrs = collect(root, errors)
    readme = root / ADR_DIR / "README.md"
    parts = split_index(readme.read_text(encoding="utf-8")) if readme.exists() else None
    if parts is None:
        return False
    with open(readme, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(parts[0] + index_table(adrs) + parts[2])
    return True


def main(argv: list[str] | None = None, root: Path = ROOT) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="regenerate the index table in docs/adr/README.md")
    mode.add_argument("--check", action="store_true", help="exit 1 when an ADR, a link or the index has a problem")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="backslashreplace")
    if args.write:
        if not write(root):
            print(f"{ADR_DIR}/README.md must hold exactly one {START} ... {END} block")
            return 1
        print(f"wrote the index in {ADR_DIR}/README.md")
    errors = check(root)
    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
