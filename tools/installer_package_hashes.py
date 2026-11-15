"""Build the expected package hashes into the Windows installer.

The installer downloads VRCT-VOX.zip or VRCT-VOX_cuda.zip from the release it came from. With
the hashes of those two files built in, it refuses a package that was replaced on the release
page, even when its .sha256 file was replaced with it. release.yml builds both ZIPs first, then:

    python tools/installer_package_hashes.py write --cpu VRCT-VOX.zip --gpu VRCT-VOX_cuda.zip.sha256
    (bundle the installer with VRCT_REQUIRE_PACKAGE_HASHES=1)
    python tools/installer_package_hashes.py check --cpu VRCT-VOX.zip --gpu VRCT-VOX_cuda.zip

`--cpu` and `--gpu` take a package (hashed here) or a .sha256 file (its first word).
`write` creates src-tauri/nsis/package-hashes.nsh, which src-tauri/nsis/template.nsi includes;
`check` compares that file with the packages that are about to be released.
"""
import argparse
import hashlib
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
INCLUDE = ROOT / "src-tauri" / "nsis" / "package-hashes.nsh"
HEX = re.compile(r"[0-9a-f]{64}")
NAMES = {"cpu": "PACKAGE_SHA256_CPU", "gpu": "PACKAGE_SHA256_GPU"}


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


def render(hashes):
    lines = ["; Written by tools/installer_package_hashes.py for one release build. Do not commit."]
    lines += [f'!define {NAMES[edition]} "{hashes[edition]}"' for edition in ("cpu", "gpu")]
    return "\n".join(lines) + "\n"


def parse(text):
    found = dict(re.findall(r'^!define (PACKAGE_SHA256_(?:CPU|GPU)) "([0-9a-f]{64})"$', text, re.M))
    return {edition: found.get(name) for edition, name in NAMES.items()}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("command", choices=("write", "check"))
    parser.add_argument("--cpu", required=True, help="VRCT-VOX.zip or its .sha256 file")
    parser.add_argument("--gpu", required=True, help="VRCT-VOX_cuda.zip or its .sha256 file")
    parser.add_argument("--include", type=Path, default=INCLUDE, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        hashes = {"cpu": digest(args.cpu), "gpu": digest(args.gpu)}
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    if args.command == "write":
        args.include.write_text(render(hashes), encoding="ascii", newline="\n")
        print(f"wrote {args.include.name}: CPU {hashes['cpu']}, GPU {hashes['gpu']}")
        return 0
    try:
        built = parse(args.include.read_text(encoding="ascii"))
    except OSError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    wrong = [edition for edition in ("cpu", "gpu") if built[edition] != hashes[edition]]
    for edition in wrong:
        print(f"error: the installer has {built[edition]} for {edition.upper()}, the package is {hashes[edition]}",
              file=sys.stderr)
    if not wrong:
        print("the installer's built-in hashes match both packages")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
