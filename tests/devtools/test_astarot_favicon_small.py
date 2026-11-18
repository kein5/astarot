"""The 16 px ASTAROT favicon keeps the symbol's rules (tools/astarot_favicon_small.py)."""
import importlib.util
import io
import math
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("astarot_favicon_small", ROOT / "tools/astarot_favicon_small.py")
favicon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(favicon)

try:
    import PIL  # noqa: F401
except ImportError:
    PIL = None


def line_distance(point, a, b):
    """Signed distance from point to the line through a and b (positive on the left of a -> b, y down)."""
    (px, py), (ax, ay), (bx, by) = point, a, b
    return ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / math.dist(a, b)


def sides(polygon):
    return [math.dist(polygon[i], polygon[(i + 1) % len(polygon)]) for i in range(len(polygon))]


class AstarotFaviconSmallTests(unittest.TestCase):
    def test_lines_are_one_width(self):
        # The ring and every line of the hexagram are LINE wide. Each point's dark triangle
        # is the point less one line along its two outer sides.
        points = favicon.star_points()
        for index, hole in enumerate(favicon.holes()):
            tip, left, right = points[2 * index], points[2 * index - 1], points[(2 * index + 1) % 12]
            with self.subTest(point=index):
                # The hole's apex and its corner on each side lie one line inside the star's outer sides.
                self.assertAlmostEqual(abs(line_distance(hole[0], tip, right)), favicon.LINE)
                self.assertAlmostEqual(abs(line_distance(hole[0], tip, left)), favicon.LINE)
                self.assertAlmostEqual(abs(line_distance(hole[1], tip, right)), favicon.LINE)
                self.assertAlmostEqual(abs(line_distance(hole[2], tip, left)), favicon.LINE)
                # Its base lies on the other triangle's outer side.
                self.assertAlmostEqual(line_distance(hole[1], left, right), 0)
                self.assertAlmostEqual(line_distance(hole[2], left, right), 0)
        self.assertEqual(favicon.LINE, 1.0, "lines narrower than a pixel blur at 16 px")

    def test_dark_triangles_are_one_shape_and_size(self):
        lengths = [sides(hole) for hole in favicon.holes()]
        self.assertEqual(len(lengths), 6)
        for each in lengths:
            for length in each:
                self.assertAlmostEqual(length, lengths[0][0])
        self.assertGreater(lengths[0][0], 1.0, "a triangle under a pixel would vanish")

    def test_star_keeps_clear_of_the_ring(self):
        self.assertLess(favicon.STAR_RADIUS, favicon.RING_OUTER - favicon.LINE)

    def test_horizontal_lines_sit_on_pixel_edges(self):
        ys = sorted({round(y, 9) for x, y in favicon.star_points()})
        for y in ys:
            if y not in (min(ys), max(ys), favicon.CENTER[1]):
                self.assertEqual(y, int(y))

    def test_bubble_sits_inside_the_central_hexagon(self):
        # The hexagon's corners are the odd outline points; its lines run LINE inside its sides.
        # Only the tail may reach into a line.
        corners = favicon.star_points()[1::2]
        apothem = favicon.STAR_RADIUS / math.sqrt(3) * math.cos(math.radians(30))
        rx, ry = favicon.BUBBLE
        for k in range(6):
            a, b = corners[k], corners[(k + 1) % 6]
            normal = math.atan2((a[1] + b[1]) / 2 - favicon.CENTER[1], (a[0] + b[0]) / 2 - favicon.CENTER[0])
            reach = math.hypot(rx * math.cos(normal), ry * math.sin(normal))
            with self.subTest(side=k):
                self.assertLessEqual(reach, apothem - favicon.LINE + 1e-9)
        # The tail stays inside the hexagon, so it never joins a dark triangle.
        tip = favicon.BUBBLE_TAIL[1]
        for k in range(6):
            a, b = corners[k], corners[(k + 1) % 6]
            with self.subTest(tail_side=k):
                self.assertGreater(line_distance(tip, a, b) * math.copysign(1, line_distance(favicon.CENTER, a, b)), 0.25)

    def test_variant_has_no_dots(self):
        # Ring (2), star, six triangles, bubble.
        self.assertEqual(favicon.path_data().count("M "), 10)

    def test_svg_is_built_by_the_tool(self):
        self.assertEqual((favicon.BRAND / "favicon-16.svg").read_bytes(), favicon.svg(),
                         "run tools/astarot_favicon_small.py")

    @unittest.skipIf(PIL is None, "Pillow is not installed")
    def test_png_and_ico_are_built_by_the_tool(self):
        for path, data in favicon.files().items():
            with self.subTest(path=path.relative_to(ROOT).as_posix()):
                self.assertTrue(favicon.matches(path, data), "run tools/astarot_favicon_small.py")

    @unittest.skipIf(PIL is None, "Pillow is not installed")
    def test_check_compares_pixels_not_compressed_bytes(self):
        # zlib builds differ between machines, so the same pixels can come back as other bytes.
        from PIL import Image

        def recompressed(data):
            # The same ICO with every PNG frame stored without compression.
            count = int.from_bytes(data[4:6], "little")
            entries = [data[6 + 16 * i:22 + 16 * i] for i in range(count)]
            frames = []
            for entry in entries:
                length, offset = int.from_bytes(entry[8:12], "little"), int.from_bytes(entry[12:16], "little")
                out = io.BytesIO()
                Image.open(io.BytesIO(data[offset:offset + length])).save(out, format="PNG", compress_level=0)
                frames.append(out.getvalue())
            head, offset = bytearray(data[:6]), 6 + 16 * count
            for entry, frame in zip(entries, frames):
                head += entry[:8] + len(frame).to_bytes(4, "little") + offset.to_bytes(4, "little")
                offset += len(frame)
            return bytes(head) + b"".join(frames)

        built = favicon.files()
        icon = built[favicon.BRAND_ICO]
        other = recompressed(icon)
        self.assertNotEqual(other, icon)
        self.assertEqual(favicon.pixels(other), favicon.pixels(icon))
        self.assertEqual([size for size, _ in favicon.pixels(icon)[1]], [(s, s) for s in favicon.ICO_SIZES])

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "favicon.ico"
            path.write_bytes(other)
            self.assertTrue(favicon.matches(path, icon))
            small = favicon.png_16()
            small.putpixel((0, 0), (0, 0, 0, 255))
            path.write_bytes(favicon.ico(small))
            self.assertFalse(favicon.matches(path, icon), "a changed pixel must count as a difference")
            path = Path(folder) / "favicon-16.svg"
            path.write_bytes(built[favicon.BRAND / "favicon-16.svg"].replace(b"16 px", b"16px"))
            self.assertFalse(favicon.matches(path, built[favicon.BRAND / "favicon-16.svg"]))

    def test_manual_uses_the_ico(self):
        config = (ROOT / "site/.vitepress/config.mts").read_text(encoding="utf-8")
        self.assertIn("manual/brand/favicon.ico", config)
        self.assertNotIn("manual/brand/favicon.svg", config,
                         "browsers prefer an SVG icon at every size and would skip the 16 px variant")
        self.assertEqual((favicon.SITE_BRAND / "favicon.ico").read_bytes(), (favicon.BRAND / "favicon.ico").read_bytes())


if __name__ == "__main__":
    unittest.main()
