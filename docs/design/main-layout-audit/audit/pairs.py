"""Side-by-side before/after WebP images for the layout revision record.

    python pairs.py <AUDIT_OUT before> <AUDIT_OUT after> <out dir> <shot name>...

A shot name is a file in shots/ without .png, such as ja-in-use-1280x720.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

before, after, out = (Path(p) for p in sys.argv[1:4])
names = sys.argv[4:]
out.mkdir(parents=True, exist_ok=True)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 18)
except OSError:
    font = ImageFont.load_default(18)
GAP, HEAD = 16, 32
for name in names:
    a = Image.open(before / "shots" / f"{name}.png").convert("RGB")
    b = Image.open(after / "shots" / f"{name}.png").convert("RGB")
    w, h = a.width + GAP + b.width, HEAD + max(a.height, b.height)
    img = Image.new("RGB", (w, h), (8, 13, 22))
    img.paste(a, (0, HEAD))
    img.paste(b, (a.width + GAP, HEAD))
    d = ImageDraw.Draw(img)
    d.text((4, 5), "before", fill=(173, 190, 214), font=font)
    d.text((a.width + GAP + 4, 5), "after", fill=(128, 172, 255), font=font)
    scale = min(1.0, 2000 / w)
    if scale < 1:
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    img.save(out / f"{name}.webp", "WEBP", quality=82, method=6)
    print(name, img.size, (out / f"{name}.webp").stat().st_size)
