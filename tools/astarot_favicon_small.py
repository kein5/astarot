"""Build the 16 px ASTAROT favicon (the optical size variant) and the favicon.ico set.

At 16 px the master symbol (symbol-light.svg) has lines about half a pixel wide,
and the star, the bubble and the three dots run together. The small variant is
drawn again on the 16 px grid with the same structure:

- the ring, then the hexagram inside it with a one pixel gap;
- every white line of the hexagram, and the ring, one pixel wide;
- the six dark triangles in the star's points all the same shape and size;
- the bubble inside the central hexagon, clear of its lines; only the tail
  reaches into the lower left line, as in the master;
- no three dots: they cannot be drawn in a bubble four pixels wide.

The horizontal lines sit on pixel edges, so they stay sharp at 16 px.

Outputs, all in docs/brand/astarot/ unless noted:

- favicon-16.svg: the variant itself, on a 16 x 16 view box.
- favicon-16.png: the variant at 16 px.
- favicon.ico: 16 px from the variant, 32 and 48 px from favicon-32.png and
  favicon-48.png, which keep the master geometry.
- site/public/manual/brand/favicon.ico: a copy for the manual's pages.

    uv run --no-project --with pillow==13.0.0 python tools/astarot_favicon_small.py [--check]

--check builds every file in memory, compares it with the committed one and
writes nothing. The exit code is 1 when a file differs.
"""

from __future__ import annotations

import argparse
import io
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "docs" / "brand" / "astarot"
SITE_BRAND = ROOT / "site" / "public" / "manual" / "brand"

PLUM = "#261633"
SIZE = 16  # the grid, in pixels
CENTER = (8.0, 8.0)
RING_OUTER = 8.0
LINE = 1.0  # every line: the ring and the hexagram
STAR_RADIUS = 6.0  # star tip to centre; leaves one pixel between the tips and the ring
BUBBLE = (2.0, 1.85)  # ellipse radii; the central hexagon's lines leave a circle of radius 2
BUBBLE_TAIL = ((118.0, 168.0), (6.35, 10.45))  # where the tail leaves the ellipse (degrees, y down), its tip
ICO_SIZES = (16, 32, 48)
SUPERSAMPLE = 64  # the PNG is drawn at 64 x and averaged down


def star_points() -> list[tuple[float, float]]:
    """The hexagram's outline: tips (even indices) and the central hexagon's corners (odd)."""
    cx, cy = CENTER
    points = []
    for k in range(12):
        angle = math.radians(-90 + 30 * k)
        radius = STAR_RADIUS if k % 2 == 0 else STAR_RADIUS / math.sqrt(3)
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def holes() -> list[list[tuple[float, float]]]:
    """The dark triangle in each point: the point less one line along its two outer sides."""
    points = star_points()
    out = []
    for k in range(0, 12, 2):
        tip, left, right = points[k], points[k - 1], points[(k + 1) % 12]
        mid = ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2)
        length = math.dist(tip, mid)
        axis = ((mid[0] - tip[0]) / length, (mid[1] - tip[1]) / length)
        # Moving both outer sides in by LINE moves the tip 2 * LINE along the axis
        # and the base corners LINE / sin 60 along the base.
        apex = (tip[0] + axis[0] * 2 * LINE, tip[1] + axis[1] * 2 * LINE)
        base = math.dist(left, right)
        step = LINE / math.sin(math.radians(60))
        unit = ((right[0] - left[0]) / base, (right[1] - left[1]) / base)
        out.append([apex,
                    (right[0] - unit[0] * step, right[1] - unit[1] * step),
                    (left[0] + unit[0] * step, left[1] + unit[1] * step)])
    return out


def bubble_point(degrees: float) -> tuple[float, float]:
    angle = math.radians(degrees)
    return (CENTER[0] + BUBBLE[0] * math.cos(angle), CENTER[1] + BUBBLE[1] * math.sin(angle))


def bubble_outline(steps: int = 720) -> list[tuple[float, float]]:
    """The bubble as a polygon: the ellipse the long way round, then the tail."""
    (tail_end, tail_start), tip = BUBBLE_TAIL
    span = 360 - (tail_start - tail_end)
    arc = [bubble_point(tail_end - span * i / steps) for i in range(steps + 1)]
    return [*arc, tip]


def fmt(value: float) -> str:
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def path_data() -> str:
    cx, cy = CENTER
    parts = []
    for radius in (RING_OUTER, RING_OUTER - LINE):
        parts.append(f"M {fmt(cx + radius)} {fmt(cy)} A {fmt(radius)} {fmt(radius)} 0 1 0 {fmt(cx - radius)} {fmt(cy)} "
                     f"A {fmt(radius)} {fmt(radius)} 0 1 0 {fmt(cx + radius)} {fmt(cy)} Z")
    for polygon in (star_points(), *holes()):
        parts.append("M " + " L ".join(f"{fmt(x)} {fmt(y)}" for x, y in polygon) + " Z")
    (tail_end, tail_start), tip = BUBBLE_TAIL
    start, end = bubble_point(tail_end), bubble_point(tail_start)
    parts.append(f"M {fmt(start[0])} {fmt(start[1])} A {fmt(BUBBLE[0])} {fmt(BUBBLE[1])} 0 1 0 {fmt(end[0])} {fmt(end[1])} "
                 f"L {fmt(tip[0])} {fmt(tip[1])} Z")
    return " ".join(parts)


def svg() -> bytes:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}" '
            'role="img" aria-labelledby="title desc"><title id="title">ASTAROT favicon, 16 px</title>'
            '<desc id="desc">Optical size variant of the ASTAROT symbol for 16 px: circular hexagram with one pixel '
            'lines and an empty speech bubble. Built by tools/astarot_favicon_small.py.</desc>'
            f'<path d="{path_data()}" fill="{PLUM}" fill-rule="evenodd"/></svg>\n').encode("utf-8")


def png_16():
    """The variant at 16 px: drawn SUPERSAMPLE times larger and averaged, so each pixel holds its coverage."""
    from PIL import Image, ImageDraw

    scale = SIZE * SUPERSAMPLE
    mask = Image.new("L", (scale, scale), 0)
    draw = ImageDraw.Draw(mask)

    def polygon(points, fill):
        # Pillow puts integer coordinates on pixel centres.
        draw.polygon([(x * SUPERSAMPLE - 0.5, y * SUPERSAMPLE - 0.5) for x, y in points], fill=fill)

    def circle(radius, steps=1440):
        cx, cy = CENTER
        return [(cx + radius * math.cos(2 * math.pi * i / steps), cy + radius * math.sin(2 * math.pi * i / steps))
                for i in range(steps)]

    # The shapes nest, so painting them in order gives the even-odd fill of the SVG.
    polygon(circle(RING_OUTER), 255)
    polygon(circle(RING_OUTER - LINE), 0)
    polygon(star_points(), 255)
    for hole in holes():
        polygon(hole, 0)
    polygon(bubble_outline(), 0)

    alpha = mask.resize((SIZE, SIZE), Image.Resampling.BOX)
    plum = tuple(int(PLUM[i:i + 2], 16) for i in (1, 3, 5))
    image = Image.new("RGBA", (SIZE, SIZE), (*plum, 0))
    image.putalpha(alpha)
    return image


def encode_png(image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def ico(small) -> bytes:
    from PIL import Image

    larger = []
    for size in ICO_SIZES[1:]:
        image = Image.open(BRAND / f"favicon-{size}.png").convert("RGBA")
        if image.size != (size, size):
            raise SystemExit(f"favicon-{size}.png is {image.size}")
        larger.append(image)
    # Pillow leaves out sizes larger than the image it saves, so the largest one carries the
    # others; each size is taken as it is from append_images, never scaled.
    buffer = io.BytesIO()
    larger[-1].save(buffer, format="ICO", sizes=[(s, s) for s in ICO_SIZES], append_images=[small, *larger[:-1]])
    return buffer.getvalue()


def files() -> dict[Path, bytes]:
    small = png_16()
    icon = ico(small)
    return {
        BRAND / "favicon-16.svg": svg(),
        BRAND / "favicon-16.png": encode_png(small),
        BRAND / "favicon.ico": icon,
        SITE_BRAND / "favicon.ico": icon,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="compare with the committed files and write nothing")
    args = parser.parse_args()
    built = files()
    if args.check:
        stale = [path for path, data in built.items() if not path.is_file() or path.read_bytes() != data]
        for path in stale:
            print(f"differs: {path.relative_to(ROOT).as_posix()}")
        return 1 if stale else 0
    for path, data in built.items():
        path.write_bytes(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
