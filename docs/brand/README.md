# VRCT-VOX brand assets

"Caption Console": a microphone with caption lines on a blue rounded square. VRCT-VOX does five things, ASR, TTS, RVC, OCR and translation. The large icon and the logos show a glyph for each of them.

| File | Use |
| --- | --- |
| `icon.svg` | App icon from 256 px. The dock shows the TTS, RVC, OCR and translation glyphs. |
| `icon-small.svg` | App icon up to 128 px: the microphone and two caption bars, without the dock. |
| `glyphs/*.svg` | The five function glyphs on a 24-unit grid with a 1.8-unit round stroke. They use `currentColor`. |
| `logo-<lang>-on-dark.svg`, `logo-<lang>-on-light.svg` | Logos with function labels in English (`en`) and Japanese (`ja`), the UI languages. Korean and Chinese logos were dropped with those UI languages in 0.2.0. They have a transparent background. |

The app itself shows ASTAROT: its icons (`src-tauri/icons`) and in-app logos (`src-ui/views/assets/brand/`) are built from `docs/brand/astarot/` by `tools/astarot_app_assets.py`. The READMEs show the horizontal ASTAROT logo (`astarot/logo-horizontal-light.png` and `-dark.png`) and switch between them with `prefers-color-scheme`. They use the PNG files: the SVG logos set the subtitle as text in Outfit, and an SVG shown as an image falls back to another font unless the viewer has Outfit installed.

All lettering is outlined, so the SVGs render the same without fonts. The Latin letters are drawn for this logo. The Japanese labels are outlines of Noto Sans CJK Bold (SIL Open Font License 1.1). The SVGs contain no embedded raster images or external references.

## Palette

| Role | Hex |
| --- | --- |
| Icon background | `#2056BC` |
| Icon mark | `#F5F5F7` |
| Caption bars, glyphs on dark | `#B9D8FF` |
| Dock | `#173A7C` |
| Glyphs on light | `#174899` |
| Text on light | `#13161C` |
| Text on dark | `#F5F5F7` |

## Regenerating

After changing `icon.svg`, `icon-small.svg`, the glyphs or the labels, run:

```sh
uv run --no-project --with fonttools python tools/brand_assets.py
```

This rewrites the logos in this folder. It needs `/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc`.

For the app's ASTAROT icons and in-app logos, run `uv run --no-project --with pillow==13.0.0 python tools/astarot_app_assets.py` (add `--check` to compare without writing). The AppImage desktop icon is copied from `src-tauri/icons/128x128@2x.png` at build time.

The 16 px ASTAROT favicon is its own drawing, not the symbol scaled down: `astarot/favicon-16.svg` is drawn on the 16 px grid with one-pixel lines and no dots in the bubble (ADR-011, 3.1). `tools/astarot_favicon_small.py` builds it with `favicon-16.png` and `favicon.ico` (16 px from this variant, 32 and 48 px from `favicon-32.png` and `favicon-48.png`) and copies the ICO to `site/public/manual/brand/`. Run it the same way as the tool above, with `--check` to compare without writing.
