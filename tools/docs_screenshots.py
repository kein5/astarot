"""Regenerate the app screenshots used by the user documentation (site/).

    uv run --no-project --with pillow==13.0.0 python tools/docs_screenshots.py

Runs tests/integration/docsScreenshots.spec.ts in Chromium: the app's production screens on the
real core (native/browser-core-bridge, ADR-017), with the stand-in devices and services of the
integration tests and sample data for what they cannot make (another player's words, a VRChat
found, recent times). The desktop captions are drawn over a stand-in scene, and the VR panel's
flow window at its real size (tests/integration/app). It builds the core's host and the
integration page first, then writes WebP images to site/public/screenshots/{ja,en}/. Nothing in
the pictures comes from the PC that made them; the folder a download goes to is shown as a Linux
install's.

Needs the integration test environment: `python tools/dev.py setup --scope ui`, then
`setup --scope integration`. The pictures show the version in package.json; to document a
release, run it in a checkout of that release's tag and copy the images over.
"""

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "site" / "public" / "screenshots"
PLAYWRIGHT = "node_modules/@playwright/test/cli.js"
LANGS = ("ja", "en")


def run(command, **kwargs):
    print("+", " ".join(command), flush=True)
    return subprocess.run(command, cwd=ROOT, **kwargs).returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=OUTPUT, help="folder that gets ja/ and en/ (default: %(default)s)")
    parser.add_argument("--skip-build", action="store_true", help="use the core's host and the page already built")
    args = parser.parse_args()
    from PIL import Image  # Pillow, only to write WebP

    if not (ROOT / PLAYWRIGHT).is_file():
        print("Playwright is not installed: python tools/dev.py setup --scope ui, then --scope integration")
        return 2
    if not args.skip_build:
        steps = [
            ["cargo", "build", "--locked", "--manifest-path", "native/browser-core-bridge/Cargo.toml"],
            ["node", "node_modules/vite/bin/vite.js", "build", "--config", "tests/integration/vite.config.ts", "--logLevel", "warn"],
        ]
        for step in steps:
            if run(step) != 0:
                return 1
    with tempfile.TemporaryDirectory(prefix="astarot-docs-shots-") as pictures:
        env = dict(os.environ, ASTAROT_DOCS_SCREENSHOTS=pictures)
        test = ["node", PLAYWRIGHT, "test", "--config", "tests/integration/playwright.config.ts",
                "docsScreenshots", "--project", "chromium", "--workers", "1"]
        if run(test, env=env) != 0:
            return 1
        total = 0
        for lang in LANGS:
            target = args.output / lang
            target.mkdir(parents=True, exist_ok=True)
            for png in sorted(Path(pictures, lang).glob("*.png")):
                webp = target / f"{png.stem}.webp"
                Image.open(png).save(webp, "WEBP", quality=82, method=6)
                total += webp.stat().st_size
        print(f"wrote {args.output} ({total / 1024:.0f} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
