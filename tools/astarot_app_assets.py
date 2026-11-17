"""Build the app's ASTAROT icons and in-app brand SVGs from docs/brand/astarot.

The shapes are not redrawn. The SVGs reuse the symbol path of symbol-light.svg
and the wordmark path of wordmark-reference-outline.svg (ADR-011 3.4), and the
icons are the PNG and ICO files of docs/brand/astarot. Sizes that the brand set
does not have (icon.icns, Square*Logo.png, StoreLogo.png) are scaled down from
icon-1024.png.

    uv run --no-project --with pillow==13.0.0 python tools/astarot_app_assets.py [--check]

--check builds every file in memory, compares it with the committed one and
writes nothing. The exit code is 1 when a file differs.
"""

from __future__ import annotations

import argparse
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "docs" / "brand" / "astarot"
UI = ROOT / "src-ui" / "views" / "assets" / "brand"
ICONS = ROOT / "src-tauri" / "icons"

# The symbol path is drawn in a 294 x 300 box (its outer ring), the wordmark in 889 x 131.
SYMBOL_W, SYMBOL_H = 294, 300
LOGO_GAP, WORD_SCALE = 70, 1.25
WHITE = "#FFFFFF"

# Tauri icon name -> the brand file it copies.
COPIED = {
    "32x32.png": "icon-32.png",
    "128x128.png": "icon-128.png",
    "128x128@2x.png": "icon-256.png",
    "icon.png": "icon-512.png",
    "icon.ico": "app-icon.ico",
}
# Tauri icon name -> pixel size scaled down from icon-1024.png.
SCALED = {"StoreLogo.png": 50, **{f"Square{n}x{n}Logo.png": n for n in (30, 44, 71, 89, 107, 142, 150, 284, 310)}}
ICNS_SIZES = (16, 32, 64, 128, 256, 512, 1024)


def only_path(svg: str) -> str:
    paths = re.findall(r'<path d="([^"]+)"', svg)
    if len(paths) != 1:
        raise SystemExit(f"expected one path, found {len(paths)}")
    return paths[0]


def note(source: str) -> str:
    return f"<!-- Built by tools/astarot_app_assets.py from docs/brand/astarot/{source}. -->"


def svgs() -> dict[Path, bytes]:
    symbol = only_path((BRAND / "symbol-light.svg").read_text(encoding="utf-8"))
    wordmark = only_path((BRAND / "wordmark-reference-outline.svg").read_text(encoding="utf-8"))
    for name in ("app-icon.svg", "symbol-dark.svg", "logo-horizontal-dark.svg"):
        if symbol not in (BRAND / name).read_text(encoding="utf-8"):
            raise SystemExit(f"{name} does not use the symbol path of symbol-light.svg")
    if wordmark not in (BRAND / "logo-horizontal-dark.svg").read_text(encoding="utf-8"):
        raise SystemExit("logo-horizontal-dark.svg does not use the wordmark of wordmark-reference-outline.svg")

    word_h = 130 * WORD_SCALE
    width = SYMBOL_W + LOGO_GAP + 888 * WORD_SCALE
    out = {
        # Filled with currentColor, for the main page's sidebar.
        UI / "symbol.svg": (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SYMBOL_W} {SYMBOL_H}">'
                            f'{note("symbol-light.svg")}<path d="{symbol}" fill="currentColor" fill-rule="evenodd"/></svg>\n'),
        UI / "wordmark.svg": ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 889 131">'
                              f'{note("wordmark-reference-outline.svg")}<path d="{wordmark}" fill="currentColor" fill-rule="evenodd"/></svg>\n'),
        # Symbol and wordmark in white for the dark UI (About page, VR panel intro).
        UI / "logo.svg": (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:g}" height="{SYMBOL_H}" '
                          f'viewBox="0 0 {width:g} {SYMBOL_H}" role="img" aria-labelledby="title">'
                          f'{note("symbol-light.svg and wordmark-reference-outline.svg")}<title id="title">ASTAROT</title>'
                          f'<path d="{symbol}" fill="{WHITE}" fill-rule="evenodd"/>'
                          f'<path d="{wordmark}" fill="{WHITE}" fill-rule="evenodd" '
                          f'transform="translate({SYMBOL_W + LOGO_GAP},{(SYMBOL_H - word_h) / 2:g}) scale({WORD_SCALE:g})"/></svg>\n'),
    }
    # The app icon as it is, except that the app's CSP audit refuses style attributes;
    # the color presentation attribute means the same.
    icon = (BRAND / "app-icon.svg").read_text(encoding="utf-8")
    styled = f'style="color:{WHITE}"'
    if icon.count(styled) != 1 or "style=" in icon.replace(styled, ""):
        raise SystemExit("app-icon.svg changed its style attributes; update this tool")
    out[UI / "icon-small.svg"] = icon.replace(styled, f'color="{WHITE}"')
    return {path: text.encode("utf-8") for path, text in out.items()}


def icons() -> dict[Path, bytes]:
    from PIL import Image

    out = {ICONS / name: (BRAND / source).read_bytes() for name, source in COPIED.items()}
    master = Image.open(BRAND / "icon-1024.png").convert("RGBA")
    if master.size != (1024, 1024):
        raise SystemExit(f"icon-1024.png is {master.size}")

    def png(image) -> bytes:
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()

    for name, size in SCALED.items():
        out[ICONS / name] = png(master.resize((size, size), Image.Resampling.LANCZOS))
    buffer = io.BytesIO()
    master.save(buffer, format="ICNS",
                append_images=[master.resize((s, s), Image.Resampling.LANCZOS) for s in ICNS_SIZES[:-1]])
    out[ICONS / "icon.icns"] = buffer.getvalue()
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="compare with the committed files and write nothing")
    args = parser.parse_args()
    files = {**svgs(), **icons()}
    if args.check:
        stale = [path for path, data in files.items() if not path.is_file() or path.read_bytes() != data]
        for path in stale:
            print(f"differs: {path.relative_to(ROOT).as_posix()}")
        return 1 if stale else 0
    for path, data in files.items():
        path.write_bytes(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
