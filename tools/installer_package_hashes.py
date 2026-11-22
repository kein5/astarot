"""Build the expected package hash into the Windows installer.

The installer downloads VRCT-VOX.zip from the release it came from. With the hash of that file
built in, it refuses a package that was replaced on the release page, even when its .sha256 file
was replaced with it. release.yml builds the ZIP first, then:

    python tools/installer_package_hashes.py write --package VRCT-VOX.zip
    (bundle the installer with ASTAROT_REQUIRE_PACKAGE_HASHES=1)
    python tools/installer_package_hashes.py check --package VRCT-VOX.zip

`--package` takes the ZIP (hashed here) or a .sha256 file (its first word).
`write` creates src-tauri/nsis/package-hashes.nsh, which src-tauri/nsis/template.nsi includes;
`check` compares that file with the package that is about to be released.

Until 0.5 there was a second package, VRCT-VOX_cuda.zip, with the same files since 0.5.0. It is
no longer built (#288); the installer reads its GPU choice (/EDITION=gpu) as VRCT-VOX.zip.
"""
import argparse
import hashlib
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
INCLUDE = ROOT / "src-tauri" / "nsis" / "package-hashes.nsh"
HEX = re.compile(r"[0-9a-f]{64}")
NAME = "PACKAGE_SHA256"


def digest(path):
    """The SHA-256 of a package, or the hash written in a .sha256 file."""
    path = Path(path)
    if path.suffix == ".sha256":
        words = path.read_text(encoding="ascii").split()
        value = words[0].lower() if words else ""
    else:
        hasher = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1 << 20), b""):
                hasher.update(block)
        value = hasher.hexdigest()
    if not HEX.fullmatch(value):
        raise ValueError(f"{path.name}: not a SHA-256 hash")
    return value


def render(value):
    return ("; Written by tools/installer_package_hashes.py for one release build. Do not commit.\n"
            f'!define {NAME} "{value}"\n')


def parse(text):
    found = re.findall(rf'^!define {NAME} "([0-9a-f]{{64}})"$', text, re.M)
    return found[0] if len(found) == 1 else None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("command", choices=("write", "check"))
    parser.add_argument("--package", required=True, help="VRCT-VOX.zip or its .sha256 file")
    parser.add_argument("--include", type=Path, default=INCLUDE, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        value = digest(args.package)
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    if args.command == "write":
        args.include.write_text(render(value), encoding="ascii", newline="\n")
        print(f"wrote {args.include.name}: {value}")
        return 0
    try:
        built = parse(args.include.read_text(encoding="ascii"))
    except OSError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    if built != value:
        print(f"error: the installer has {built} built in, the package is {value}", file=sys.stderr)
        return 1
    print("the installer's built-in hash matches the package")
    return 0


if __name__ == "__main__":
    sys.exit(main())
