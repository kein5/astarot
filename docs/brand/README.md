# ASTAROT brand assets

[日本語版](#astarotのブランド素材日本語版)

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
| `favicon.svg`, `favicon-<size>.png` | The favicon: the symbol in Dark Plum without a tile. The PNGs are 32 to 64 px. |
| `favicon-16.svg`, `favicon-16.png` | The favicon drawn again for 16 px, with one-pixel lines and no dots in the bubble (see [Regenerating](#regenerating)). |
| `favicon.ico` | The favicon at 16 px from `favicon-16.png`, and at 32 and 48 px from `favicon-32.png` and `favicon-48.png`. The user manual's pages use it. |
| `brand-board.svg` | One sheet with the logos, the icon, the favicon, the colors and the typeface. |

The symbols, the logos and the brand board also come as PNG files with the same names. The PNG files are rendered from the SVG files. No tool in this repository renders them; after changing an SVG, render its PNG again at the same pixel size.

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
- **The user guide.** `site/public/favicon.png` is a copy of `favicon-32.png`, `site/public/favicon-16.png` of `favicon-16.png`, and `site/public/apple-touch-icon.png` of `icon-128.png` (the app icon, for home screens). Every page of the guide links both favicons, the 16 px one with its size, and the browser takes the one that fits its tab (`site/rspress.config.ts`). Copy them again after changing the set.
- **The user manual.** `site/public/manual/brand/` holds copies of `app-icon.svg` and `favicon.ico`, and WebP wordmarks that the manual's home page showed. The manual's pages now send readers to the guide and use the guide's favicons; the ICO stays where it was. The wordmarks wait for the merged home page (`docs/design/site-redesign`). Copy `app-icon.svg` again after changing it; `tools/astarot_favicon_small.py` writes the copy of `favicon.ico`.

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

The 16 px ASTAROT favicon is its own drawing, not the symbol scaled down: `astarot/favicon-16.svg` is drawn on the 16 px grid with one-pixel lines and no dots in the bubble (ADR-011, 3.1). `tools/astarot_favicon_small.py` builds it with `favicon-16.png` and `favicon.ico` (16 px from this variant, 32 and 48 px from `favicon-32.png` and `favicon-48.png`) and copies the ICO to `site/public/manual/brand/`. Run it after changing its drawing or `favicon-32.png` or `favicon-48.png`:

```sh
uv run --no-project --with pillow==13.0.0 python tools/astarot_favicon_small.py
```

Its `--check` compares the SVG byte for byte and the PNG and the ICO by their pixels, because zlib builds compress the same pixels to different bytes. `tests/devtools/test_astarot_favicon_small.py` runs the same comparison.

---

# ASTAROTのブランド素材（日本語版）

ASTAROTのブランドの素材一式は`astarot/`にあります。[ADR-011](../adr/adr-011-astarot-brand-and-multimodal-accessibility.md)は名前、サブタイトル、シンボル、色を記録しています。書体と、ワードマークとサブタイトルの組み方の決まりは[`astarot/typography-and-lockup.md`](astarot/typography-and-lockup.md)にあります。

## ファイル

| `astarot/`のファイル | 用途 |
| --- | --- |
| `symbol-light.svg` | シンボルの正本です。円環、六芒星、3つの点が入った吹き出しをDark Plumで描いています。ほかのSVGもこのファイルと同じパスを使います。 |
| `symbol-dark.svg`、`symbol-black.svg` | 暗い背景に置く白のシンボルと、1色で使うときの黒に近い色（`#151515`）のシンボルです。 |
| `wordmark-reference-outline.svg` | Outfit Boldの輪郭をパス化した`ASTAROT`のワードマークです。ロゴはこれを使います。 |
| `wordmark-alt-traced.svg` | 元の参照画像にあるワードマークをトレースしたものです。比べるために残しています。どこでも使っていません。 |
| `logo-horizontal-light.svg`、`logo-horizontal-dark.svg` | シンボル、ワードマーク、サブタイトルを1行に並べた横ロゴです。明るい背景用と暗い背景用があります。 |
| `logo-vertical-light.svg`、`logo-vertical-dark.svg` | シンボルをワードマークの上に置き、サブタイトルを2行にした縦ロゴです。 |
| `app-icon.svg`、`app-icon.ico`、`icon-<size>.png` | アプリのアイコンです。Dark Plumのタイルに白のシンボルを置いています。PNGは16〜1024 pxです。 |
| `favicon.svg`、`favicon-<size>.png` | faviconです。Dark Plumのシンボルをタイルなしで描いています。PNGは32〜64 pxです。 |
| `favicon-16.svg`、`favicon-16.png` | 16 px用に描き直したfaviconです。線は1ピクセルで、吹き出しに点を入れていません（[素材の作り直し](#素材の作り直し)を参照）。 |
| `favicon.ico` | 16 pxは`favicon-16.png`から、32 pxと48 pxは`favicon-32.png`と`favicon-48.png`から作ったfaviconです。マニュアルのページがこれを使います。 |
| `brand-board.svg` | ロゴ、アイコン、favicon、色、書体を1枚にまとめたブランドボードです。 |

シンボル、ロゴ、ブランドボードには同じ名前のPNGファイルもあります。PNGファイルはSVGファイルから書き出したものです。このリポジトリにはPNGを書き出す道具がありません。SVGを変えたら、そのPNGを同じピクセルの大きさで書き出し直します。

ワードマークはパス化してあるので、フォントがなくても同じ見た目になります。ロゴとブランドボードのサブタイトルはOutfitを指定したSVGのテキストで、Outfitが入っている環境でだけ正しく表示されます。Outfitのライセンスと使い道は`licenses/outfit/`に記録しています。

## 色

| 色 | 16進数 | 用途 |
| --- | --- | --- |
| Dark Plum | `#261633` | 明るい背景に置くシンボルとワードマーク、アプリのアイコンのタイル |
| Lilac | `#A47AF5` | 小さな差し色 |
| Off-White | `#FAFAFC` | 明るい背景 |
| White | `#FFFFFF` | 暗い背景に置くシンボルとワードマーク |

## 素材を使っている場所

- アプリ：`tools/astarot_app_assets.py`はこの素材から`src-tauri/icons/`のTauriのアイコンと、`src-ui/views/assets/brand/`のアプリ内のSVGを作ります。AppImageとLinuxのパッケージはビルドのときに`src-tauri/icons/128x128@2x.png`をデスクトップのアイコンとして取り込みます。
- README：横ロゴ（`astarot/logo-horizontal-light.png`と`-dark.png`）を表示し、`prefers-color-scheme`で2つを切り替えます。PNGファイルを使うのは、画像として表示したSVGでは見る人がOutfitを入れていないとサブタイトルが別の書体で組まれるためです。
- 利用者向けのガイド：`site/public/favicon.png`は`favicon-32.png`の、`site/public/favicon-16.png`は`favicon-16.png`の、`site/public/apple-touch-icon.png`は`icon-128.png`（ホーム画面に置くアプリのアイコン）の写しです。ガイドのどのページにも2つのfaviconへのリンクがあり、16 pxのほうには大きさを添えています。ブラウザーはタブに合うほうを使います（`site/rspress.config.ts`）。素材を変えたら、もう一度写します。
- 利用者向けのマニュアル：`site/public/manual/brand/`には`app-icon.svg`と`favicon.ico`の写しと、マニュアルのトップのページが表示していたWebPのワードマークがあります。いまマニュアルのページは読み手をガイドへ案内し、ガイドのfaviconを使います。ICOは元の場所に残しています。ワードマークは統合したトップのページ（`docs/design/site-redesign`）待ちです。`app-icon.svg`を変えたら、もう一度写します。`favicon.ico`の写しは`tools/astarot_favicon_small.py`が書き出します。

## 素材の作り直し

`symbol-light.svg`、ワードマーク、ロックアップのどれかを変えたら、次のコマンドでワードマーク、ロゴ、ブランドボードを作り直します。

```sh
uv run --no-project --with fonttools==4.68.0 --with skia-pathops==0.9.2 \
    python tools/astarot_brand_from_reference.py --font <Outfit Bold .ttf>
```

使うフォントのファイルとそのSHA-256はツールのdocstringに書いてあります。このツールはシンボル、アイコン、faviconのファイルを書き出しません。PNGも書き出しません。

シンボル、ワードマーク、アプリのアイコン、そのPNGのどれかを変えたら、次のコマンドでアプリのアイコンとアプリ内のSVGを作り直します。

```sh
uv run --no-project --with pillow==13.0.0 python tools/astarot_app_assets.py
```

どちらのコマンドも`--check`を付けると、何も書き出さずにコミット済みのファイルと比べます。`tests/devtools/test_astarot_app_assets.py`はアプリのファイルがこの素材と一致するかを確かめます。

16 pxのASTAROTのfaviconはシンボルを縮めたものではなく別に描いたものです。`astarot/favicon-16.svg`は16 pxの格子の上に1ピクセルの線で描き、吹き出しに点を入れていません（ADR-011の3.1）。`tools/astarot_favicon_small.py`はこのSVGと`favicon-16.png`と`favicon.ico`を作ります（ICOには16 pxにこのfaviconを、32 pxと48 pxに`favicon-32.png`と`favicon-48.png`を入れます）。そのうえで、ICOを`site/public/manual/brand/`へ写します。16 pxのfaviconの描き方、`favicon-32.png`、`favicon-48.png`のどれかを変えたら、次のコマンドを実行します。

```sh
uv run --no-project --with pillow==13.0.0 python tools/astarot_favicon_small.py
```

このツールの`--check`はSVGをバイト単位で比べます。PNGとICOは、zlibのビルドによって同じ画素でも圧縮したバイト列が変わるので、画素で比べます。`tests/devtools/test_astarot_favicon_small.py`も同じ比べ方をします。
