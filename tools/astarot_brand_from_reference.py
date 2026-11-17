"""Build the ASTAROT wordmark, logos and brand board from Outfit Bold.

The wordmark is the outline of the real Outfit Bold glyphs
(docs/brand/astarot/typography-and-lockup.md): fontTools removes the
overlapping contours, the word is scaled to an ink height of 130 units and
tracked to an ink width of 888 units, and the outline is written as an SVG
path. The logos and the brand board place that wordmark next to the symbol.

The symbol is read from docs/brand/astarot/symbol-light.svg, the master of the
uniform geometry. This tool never writes the symbol, icon or favicon files, and
it does not render PNG files.

Font: Outfit Bold (weight 700) as Google Fonts serves it, Version 1.100:
    https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4deyO4a0Fg.ttf
    SHA-256 cc3235ab6d698be85a2735d1fd59ba8f73b144cb763c00aaf173b68f0471a9c7
The static Outfit-Bold.ttf of the upstream repository has slightly different
outlines and does not reproduce the committed wordmark.

fontTools and skia-pathops are not dependencies of the app. Run with:
    uv run --no-project --with fonttools==4.68.0 --with skia-pathops==0.9.2 \
        python tools/astarot_brand_from_reference.py --font <Outfit Bold .ttf> [--check]

--check builds the files in memory, compares them with docs/brand/astarot/ and
writes nothing. The exit code is 1 when a file differs.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "docs" / "brand" / "astarot"
FONT_SHA256 = "cc3235ab6d698be85a2735d1fd59ba8f73b144cb763c00aaf173b68f0471a9c7"

WORD = "ASTAROT"
INK_HEIGHT = 130.0  # the word's ink, overshoot included ("cap height 130" in typography-and-lockup.md)
INK_WIDTH = 888.0
BOX = (int(INK_WIDTH) + 1, int(INK_HEIGHT) + 1)  # 889 x 131
SYMBOL_SIZE = 320  # viewBox of symbol-light.svg

PLUM = "#261633"
LILAC = "#A47AF5"
CANVAS = "#FAFAFC"
WHITE = "#FFFFFF"
BOARD_MUTED = "#777082"
# Subtitle of the dark horizontal logo: the hue of the light logo's #766B80 at 67 % lightness.
# Contrast 6.8:1 on Dark Plum and 7.6:1 on #0D1117, so the white wordmark stays the lead.
HORIZONTAL_DARK_SUBTITLE = "#ABA0B5"
SUBTITLE = "Speech, Translation, Accessibility, Revoicing &amp; OCR Toolkit"
SUBTITLE_LINES = ("Speech, Translation, Accessibility,", "Revoicing &amp; OCR Toolkit")
BOARD_STACKED_LINES = ("Speech, Translation,", "Accessibility, Revoicing &amp; OCR Toolkit")  # the approved stacked-logo line break
HERO_DX, HERO_DY = 155, 67  # the brand board's hero = the horizontal logo's lockup moved by this
SYMBOL_INK = (294.0, 300.0)  # ink width and height of the symbol path in its own units
SYMBOL_INK_ORIGIN = (12.5, 9.5)  # the path's own translate() in symbol-light.svg
PANEL_MID = 622  # the brand board's middle row: the artwork of all four panels is centred on this
PANEL_INK = 160  # ink height of the 64 px favicon, the monochrome pair and the stacked symbol
PANEL_LABEL_Y = 757  # baseline of the labels under the favicons and the monochrome pair
FAVICON_LABEL_W = 46  # a favicon column is never narrower than its label ("16 px" at 18 px)
FAVICON_GAP = 44
MONO_GAP = 36
STACKED_DY = 0.5  # moves the stacked logo so that its ink is centred on PANEL_MID
DEFAULT_DESC ="ASTAROT circular hexagram and speech bubble"


def wordmark_path(font_path: Path) -> str:
    """The outline of WORD in Outfit Bold, in a BOX-sized coordinate space."""
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
    from fontTools.ttLib.removeOverlaps import removeOverlaps

    font = TTFont(font_path)
    removeOverlaps(font)  # overlapping contours would leave holes under fill-rule="evenodd"
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    names = [cmap[ord(letter)] for letter in WORD]

    bounds = {}
    for name in set(names):
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        bounds[name] = pen.bounds
    y_min = min(box[1] for box in bounds.values())
    y_max = max(box[3] for box in bounds.values())
    scale = INK_HEIGHT / (y_max - y_min)

    # Ink width with the font's own advances (no kerning), from the first letter's left ink
    # edge to the last letter's right ink edge; the tracking spreads the rest over the gaps.
    first_left = bounds[names[0]][0]
    advances = sum(glyphs[name].width for name in names[:-1])
    natural = (advances + bounds[names[-1]][2] - first_left) * scale
    tracking = (INK_WIDTH - natural) / (len(names) - 1)

    parts = []
    pen_x = 0.0
    for name in names:
        svg = SVGPathPen(None)
        glyphs[name].draw(TransformPen(svg, (scale, 0, 0, -scale, pen_x - first_left * scale, y_max * scale)))
        parts.append(svg.getCommands())
        pen_x += glyphs[name].width * scale + tracking
    return " ".join(parts)


def symbol_element() -> str:
    """The shared symbol <path> of the uniform master, copied as it is."""
    text = (BRAND / "symbol-light.svg").read_text(encoding="utf-8")
    found = re.findall(r'<path d="[^"]+"[^>]*/>', text)
    if len(found) != 1:
        raise SystemExit("symbol-light.svg: expected exactly one <path>")
    return found[0]


def svg_root(body: str, width: int, height: int, title: str, desc: str = DEFAULT_DESC) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">'
        f'<title id="title">{title}</title><desc id="desc">{desc}</desc>{body}</svg>'
    )


class Parts:
    def __init__(self, symbol: str, wordmark: str):
        self.symbol = symbol
        self.wordmark = f'<path d="{wordmark}" fill="currentColor" fill-rule="evenodd"/>'

    def mark(self, x: float, y: float, size: float, color: str) -> str:
        scale = size / SYMBOL_SIZE
        return f'<g style="color:{color}" transform="translate({x:.3f},{y:.3f}) scale({scale:.6f})">{self.symbol}</g>'

    def word(self, x: float, y: float, width: float, color: str) -> str:
        scale = width / BOX[0]
        return f'<g style="color:{color}" transform="translate({x:.3f},{y:.3f}) scale({scale:.6f})">{self.wordmark}</g>'


def wordmark_svg(parts: Parts) -> str:
    return svg_root(f'<g style="color:{PLUM}">{parts.wordmark}</g>', *BOX, title="ASTAROT reference wordmark outline")


def horizontal(parts: Parts, dark: bool) -> str:
    ink = WHITE if dark else PLUM
    sub = HORIZONTAL_DARK_SUBTITLE if dark else "#766B80"
    # One-line lockup: wordmark ink width = subtitle ink width x 1.0047 (typography-and-lockup.md).
    # The subtitle names Outfit Bold explicitly, and no line is drawn under it.
    body = (
        parts.mark(35, 35, 275, ink)
        + f'<rect x="330" y="55" width="3" height="235" rx="1.5" fill="{LILAC}"/>'
        + parts.word(370, 70, 955, ink)
        + f'<text x="369.3" y="290" font-family="Outfit, Inter, DejaVu Sans, sans-serif" font-size="35.8" fill="{sub}" font-weight="700">{SUBTITLE}</text>'
    )
    return svg_root(body, 1400, 360, title="ASTAROT horizontal logo",
                    desc="User-approved circular hexagram, Outfit wordmark and fixed subtitle.")


def vertical(parts: Parts, dark: bool) -> str:
    ink = WHITE if dark else PLUM
    sub = "#E1D6E8" if dark else "#766B80"
    width, word_width = 780, 625
    body = parts.mark(207, 32, 370, ink) + parts.word((width - word_width) / 2, 443, word_width, ink)
    for y, line in zip((600, 635), SUBTITLE_LINES):
        body += (f'<text x="390" y="{y}" fill="{sub}" font-family="Outfit,Inter,DejaVu Sans,sans-serif" '
                 f'font-size="23" text-anchor="middle">{line}</text>')
    return svg_root(body, width, 700, title="ASTAROT vertical logo")


def text(x, y, value, size=26, color=None, weight="500", anchor=None):
    anchor_attr = f'text-anchor="{anchor}"' if anchor else ""
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{color or PLUM}" font-weight="{weight}" '
            f'font-family="Inter, Outfit, Noto Sans,sans-serif" {anchor_attr} >{value}</text>')


def lockup_text(x, y, value, size, anchor=None):
    """Subtitle of a lockup on the board: the light logos' subtitle colour, in Outfit Bold."""
    anchor_attr = f' text-anchor="{anchor}"' if anchor else ""
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="#766B80" font-weight="700" '
            f'font-family="Outfit, Inter, DejaVu Sans, sans-serif"{anchor_attr}>{value}</text>')


def centred_mark(parts: Parts, cx: float, cy: float, ink_height: float, color: str) -> str:
    """The symbol scaled to an ink height of ink_height, with its ink box centred on (cx, cy)."""
    size = ink_height * SYMBOL_SIZE / SYMBOL_INK[1]
    scale = size / SYMBOL_SIZE
    x = cx - (SYMBOL_INK_ORIGIN[0] + SYMBOL_INK[0] / 2) * scale
    y = cy - (SYMBOL_INK_ORIGIN[1] + SYMBOL_INK[1] / 2) * scale
    return parts.mark(x, y, size, color)


def rule(x1, y1, x2, y2):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#E3DDE9" stroke-width="2"/>'


def board(parts: Parts) -> str:
    width, height = 1680, 1080
    muted = BOARD_MUTED
    s = [f'<rect width="{width}" height="{height}" fill="{CANVAS}"/>']
    s += [f'<rect x="45" y="24" width="8" height="34" rx="2" fill="{LILAC}"/>',
          text(73, 50, "ASTAROT — BRAND IDENTITY", 25, weight="700"),
          text(width - 45, 50, "UNIFORM GEOMETRY  |  v3", 19, color=muted, anchor="end"),
          rule(40, 75, 1640, 75)]
    # Hero lockup: the horizontal logo's lockup at the same size, without the lilac line under
    # the subtitle, moved by (HERO_DX, HERO_DY) so that it is centred on the board. The
    # subtitle (Outfit Bold) has the wordmark's ink width / 1.0047 and the same left ink edge.
    dx, dy = HERO_DX, HERO_DY
    s += [parts.mark(35 + dx, 35 + dy, 275, PLUM),
          f'<rect x="{330 + dx}" y="{55 + dy}" width="3" height="235" rx="1.5" fill="{LILAC}"/>',
          parts.word(370 + dx, 70 + dy, 955, PLUM),
          lockup_text(round(369.3 + dx, 1), 290 + dy, SUBTITLE, 35.8),
          rule(40, 404, 1640, 404)]
    for x, heading in ((45, "APP ICON"), (425, "FAVICON"), (830, "MONOCHROME"), (1230, "STACKED LOGO")):
        s.append(text(x, 454, heading, 22, weight="700"))
    for x in (407, 814, 1216):
        s.append(rule(x, 432, x, 781))
    # The four panels share one level: their artwork is centred on PANEL_MID, the 64 px
    # favicon, the monochrome pair and the stacked logo's symbol are all PANEL_INK high,
    # and the labels share one baseline at the bottom of the band.
    mid, ink_h, label_y = PANEL_MID, PANEL_INK, PANEL_LABEL_Y
    s += [f'<rect x="81" y="{mid - 136.5}" width="273" height="273" rx="55" fill="{PLUM}"/>',
          parts.mark(95, mid - 122.5, 245, WHITE)]
    # Favicons at 4:2:1 for 64, 32 and 16 px, centred in their panel with equal gaps. A
    # column is as wide as its symbol ink or its label, whichever is wider.
    fav = [(ink_h, "64 px"), (ink_h / 2, "32 px"), (ink_h / 4, "16 px")]
    cols = [max(h * SYMBOL_INK[0] / SYMBOL_INK[1], FAVICON_LABEL_W) for h, _ in fav]
    left = (407 + 814) / 2 - (sum(cols) + FAVICON_GAP * (len(cols) - 1)) / 2
    for (h, label), col in zip(fav, cols):
        cx = left + col / 2
        s += [centred_mark(parts, cx, mid, h, PLUM), text(round(cx, 1), label_y, label, 18, color=muted, anchor="middle")]
        left += col + FAVICON_GAP
    # Monochrome: a light symbol and a dark tile of the same height, centred in their panel.
    light_w = ink_h * SYMBOL_INK[0] / SYMBOL_INK[1]
    mono_left = (814 + 1216) / 2 - (light_w + MONO_GAP + ink_h) / 2
    tile_x = mono_left + light_w + MONO_GAP
    s += [centred_mark(parts, mono_left + light_w / 2, mid, ink_h, "#222222"),
          f'<rect x="{tile_x:g}" y="{mid - ink_h / 2:g}" width="{ink_h:g}" height="{ink_h:g}" rx="{ink_h / 5:g}" fill="{PLUM}"/>',
          centred_mark(parts, tile_x + ink_h / 2, mid, ink_h * 0.83, WHITE),
          text((814 + 1216) / 2, label_y, "Light / dark", 18, color=muted, anchor="middle")]
    # Stacked logo in the approved reference balance, set in Outfit: symbol ink 160 px high,
    # wordmark ink 1.78 times that wide, the subtitle broken after "Translation," so that its
    # second line is about 1.24 times as wide as the wordmark. The whole block is moved by
    # STACKED_DY so that it is centred on PANEL_MID like the app icon.
    dy = STACKED_DY
    s += [parts.mark(1342.9, 480.9 + dy, 170.67, PLUM), parts.word(1285.6, 657.1 + dy, 285.1, PLUM),
          lockup_text(1428, 726 + dy, BOARD_STACKED_LINES[0], 20.7, anchor="middle"),
          lockup_text(1428, 752 + dy, BOARD_STACKED_LINES[1], 20.7, anchor="middle"),
          rule(40, 802, 1640, 802)]
    s.append(text(48, 850, "BRAND COLORS", 22, weight="700"))
    for x, name, color in ((55, "Dark Plum", PLUM), (235, "Lilac", LILAC), (415, "Off-white", CANVAS)):
        s += [f'<rect x="{x}" y="876" width="126" height="72" rx="15" fill="{color}" stroke="#CFC4D6"/>',
              text(x, 983, name, 19), text(x, 1007, color, 16, color=muted)]
    s += [rule(620, 829, 620, 1033), text(654, 852, "TYPOGRAPHY", 22, weight="700"),
          text(655, 918, "Outfit  —  Bold 700", 29, weight="700"),
          text(655, 971, "Brand: ASTAROT  |  UI: Zen Kaku Gothic New", 17, color=muted)]
    s += [rule(1250, 829, 1250, 1033), text(1280, 854, "SYMBOL RULE", 21, weight="700"),
          text(1280, 906, "One uniform master", 22),
          text(1280, 946, "No gap, halo or ornaments", 17, color=muted),
          text(1280, 981, "All assets share geometry", 17, color=muted)]
    return svg_root("".join(s), width, height, title="ASTAROT canonical brand board",
                    desc="All symbols share the uniform vector geometry of the canonical master.")


def build(font_path: Path) -> dict[str, str]:
    parts = Parts(symbol_element(), wordmark_path(font_path))
    files = {
        "wordmark-reference-outline.svg": wordmark_svg(parts),
        "logo-horizontal-light.svg": horizontal(parts, dark=False),
        "logo-horizontal-dark.svg": horizontal(parts, dark=True),
        "logo-vertical-light.svg": vertical(parts, dark=False),
        "logo-vertical-dark.svg": vertical(parts, dark=True),
        "brand-board.svg": board(parts),
    }
    for name, svg in files.items():
        if name != "wordmark-reference-outline.svg" and parts.symbol not in svg:
            raise SystemExit(f"{name}: the shared symbol path is missing")
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--font", type=Path, required=True, help="Outfit Bold .ttf (see the module docstring)")
    parser.add_argument("--check", action="store_true", help="compare with docs/brand/astarot/ and write nothing")
    parser.add_argument("--allow-other-font", action="store_true",
                        help="use a font whose SHA-256 differs from the pinned one")
    args = parser.parse_args(argv)

    digest = hashlib.sha256(args.font.read_bytes()).hexdigest()
    if digest != FONT_SHA256 and not args.allow_other_font:
        print(f"{args.font}: SHA-256 {digest} is not the pinned Outfit Bold ({FONT_SHA256}).", file=sys.stderr)
        print("Pass --allow-other-font to build from it anyway.", file=sys.stderr)
        return 2

    files = build(args.font)
    differing = []
    for name, svg in files.items():
        target = BRAND / name
        if args.check:
            same = target.is_file() and target.read_text(encoding="utf-8") == svg
            print(f"{'same' if same else 'DIFFERS'}  {name}")
            if not same:
                differing.append(name)
        else:
            target.write_text(svg, encoding="utf-8", newline="")
            print(f"wrote  {name}")
    return 1 if differing else 0


if __name__ == "__main__":
    sys.exit(main())
