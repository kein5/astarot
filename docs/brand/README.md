# ASTAROT brand assets

The ASTAROT brand set is in `astarot/`. [ADR-011](../adr/adr-011-astarot-brand-and-multimodal-accessibility.md) records the name, the subtitle, the symbol and the colors. [`astarot/typography-and-lockup.md`](astarot/typography-and-lockup.md) gives the typeface and the rules for setting the wordmark with the subtitle.

## Files

| File in `astarot/` | Use |
| --- | --- |
| `symbol-light.svg` | The master of the symbol: a ring, a hexagram and a speech bubble with three dots, in Dark Plum. The other SVGs reuse its path. |
| `symbol-dark.svg`, `symbol-black.svg` | The symbol in white for dark backgrounds, and in near-black (`#151515`) for one-color use. |
| `wordmark-reference-outline.svg` | The `ASTAROT` wordmark, outlined from Outfit Bold. The logos use it. |
| `wordmark-alt-traced.svg` | A trace of the wordmark in the original reference image, kept for comparison. Nothing uses it. |
| `logo-horizontal-light.svg`, `logo-horizontal-dark.svg` | The symbol, the wordmark and the subtitle on one line, for light and dark backgrounds. |
| `logo-vertical-light.svg`, `logo-vertical-dark.svg` | The symbol above the wordmark, with the subtitle on two lines. |
| `app-icon.svg`, `app-icon.ico`, `icon-<size>.png` | The app icon: the white symbol on a Dark Plum tile. The PNGs are 16 to 1024 px. |
| `favicon.svg`, `favicon-<size>.png` | The favicon: the symbol in Dark Plum without a tile. The PNGs are 16 to 64 px. |
| `brand-board.svg` | One sheet with the logos, the icon, the favicon, the colors and the typeface. |

The PNG files are rendered from the SVG files. No tool in this repository renders them; after changing an SVG, render its PNG again at the same pixel size.

The wordmark is outlined, so it looks the same without fonts. The subtitle in the logos and the brand board is SVG text in Outfit, which shows correctly only where Outfit is installed. The Outfit license and its use are recorded in `licenses/outfit/`.

## Colors

| Color | Hex | Use |
| --- | --- | --- |
| Dark Plum | `#261633` | The symbol and the wordmark on light backgrounds, the app icon tile |
| Lilac | `#A47AF5` | Small accents |
| Off-White | `#FAFAFC` | Light backgrounds |
| White | `#FFFFFF` | The symbol and the wordmark on dark backgrounds |

## Where the set is used

- **The app.** `tools/astarot_app_assets.py` builds the Tauri icons in `src-tauri/icons/` and the in-app SVGs in `src-ui/views/assets/brand/` from this set. The AppImage and the Linux packages take their desktop icon from `src-tauri/icons/128x128@2x.png` at build time.
- **The READMEs.** They show the horizontal logo (`astarot/logo-horizontal-light.png` and `-dark.png`) and switch between them with `prefers-color-scheme`. They use the PNG files because an SVG shown as an image sets the subtitle in another font unless the viewer has Outfit installed.
- **The user manual.** `site/public/manual/brand/` holds copies of `app-icon.svg` and `favicon.svg`, and WebP wordmarks for the manual's home page. Copy the SVGs again after changing them.

## Regenerating

After changing `symbol-light.svg`, the wordmark or the lockup, rebuild the wordmark, the logos and the brand board:

```sh
uv run --no-project --with fonttools==4.68.0 --with skia-pathops==0.9.2 \
    python tools/astarot_brand_from_reference.py --font <Outfit Bold .ttf>
```

The tool's docstring names the font file and its SHA-256. The tool does not write the symbol, icon or favicon files, or any PNG.

After changing the symbol, the wordmark, the app icon or its PNGs, rebuild the app's icons and in-app SVGs:

```sh
uv run --no-project --with pillow==13.0.0 python tools/astarot_app_assets.py
```

Add `--check` to either command to compare with the committed files without writing. `tests/devtools/test_astarot_app_assets.py` checks that the app's files match this set.
