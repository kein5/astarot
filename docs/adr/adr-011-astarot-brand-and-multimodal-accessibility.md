---
date: 2026-11-16
status: accepted
era: python-sidecar
validity: current
validity_note: 12 節は追記案（レビュー待ち）として書かれたままで、採否の記録はない。
implementation_status: partial
implementation_checked: 2026-11-23
implementation_note: アプリの表示名は ASTAROT に移した（tauri.conf.json の productName）。識別子の移行（P2）は ADR-014 で決め、0.6.0 から順に移している。アプリ ID と実行ファイル名は vrct-vox のまま。
evidence:
  - src-tauri/tauri.conf.json
  - docs/voice-stack/project-rename.md
---
# ADR-011: The ASTAROT name, a unified brand and multimodal accessibility as product policy

[日本語版](#adr-011-astarot-の名称ブランド統一マルチモーダルアクセシビリティの製品方針日本語版)

Status: **Accepted (product policy and brand specification). Assets regenerated. Display migration (P1): the app's display is implemented on develop; the documents and the site are in progress. Identifier migration (P2): not started.**
Date: 2026-11-16
Reference: `docs/brand/astarot/symbol-light.svg` (the canonical symbol, rebuilt with uniform geometry)
Related: `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`, `docs/brand/README.md`, `docs/voice-stack/project-rename.md`, `docs/adr/adr-010-frontend-stack.md`, `docs/adr/README.md`

## 1. Background and purpose

The current project, `kein5/VRCT-VOX`, is a desktop app that supports conversation by voice and text in VRChat and similar places. It combines speech recognition (ASR), text to speech (TTS), voice conversion (RVC and others), OCR, translation, captions and more, and in particular supports users who interact without using their voice.

In the future it will expand into a **multimodal accessibility toolkit** that includes sign language translation, audio guides, haptic feedback and more. It moves from the old, voice-centered name to a name that can express the product's philosophy, and unifies the icon, the logo and the text. Migrating the existing code, features, settings and user data is a separate step.

## 2. Decision: name and description

- The official brand name is `ASTAROT`, written in all capitals and pronounced アスタロト ("asutaroto").
- The official recursive acronym is **Astarot's Speech, Translation, Accessibility, Revoicing & OCR Toolkit**.
- The official subtitle is **Speech, Translation, Accessibility, Revoicing & OCR Toolkit**. The README, the web, the app's About and the brand images use the same wording and symbols.
- The optional tagline for communication is `Communication Beyond Voice.` It is not used as a replacement for the official subtitle.
- The name comes from a GNU-style recursive acronym that refers to ASTAROT itself. It does call to mind Astaroth from mythology and demonology, but it does not stand for any religious or supernatural function.

| Letter | Expansion | Meaning and scope |
| --- | --- | --- |
| A | Astarot's | Recursive self-reference |
| S | Speech | ASR, TTS, captions, voice guidance |
| T | Translation | Translation between languages, sign language conversion in the future |
| A | Accessibility | Choice of input and output, help with use |
| R | Revoicing | Voice conversion, RVC and others |
| O | OCR | Recognition of text and visual information |
| T | Toolkit | An extensible set of integrated tools |

Design principle: do not make "getting the user to speak" the goal; let users **choose how they express themselves and how they receive**.

## 3. Decision: logo, icon and typography

### 3.1 Main symbol (final; the uniform version is canonical)

**The canonical symbol is the shared `path` in `docs/brand/astarot/symbol-light.svg` (the uniform version).**
On 2026-11-15 the user named the "App Icon" at the lower right of `reference-brand-guide.png` as the canonical composition and rejected the earlier icon with a different shape. The reference image shows `ASTAROT`, a ring, a hexagram made of two overlapping equilateral triangles, and a speech bubble with three dots in the center that touches the lines of the hexagram. Afterwards the symbol was rebuilt with uniform geometry while keeping this composition, and on 2026-11-16 this uniform version became canonical.

- Vector technical master: the shared `path` in `symbol-light.svg`. It is not a trace of the reference image but a shape redrawn with uniform geometry. The white lines of the hexagram all have the same width (11 units), and the 6 black triangles inside are all congruent. The placement of the ring, the speech bubble and the three dots follows the composition of the reference image.
- Precedence for the shape: the shared SVG `path` > size-specific outputs such as PNG/ICO. The reference image is used to check the composition, not as the standard for the details of the shape.
- Must be followed strictly: do not separate the star and the speech bubble where they touch. Do not create a white halo, a gap or a separate background around the speech bubble. Do not transform the position or proportions of the ring, the hexagram, the speech bubble or the three dots independently of one another.
- New images for the brand sheet are not the generated reference images but **derived assets drawn by combining the shared SVG silhouette above with the outline of the logotype**.

1. Treat the **outer ring, the hexagram of two equilateral triangles, the central speech bubble and the three dots inside it** as one symbol. The outer ring stands for unity, the hexagram for linking different kinds of information, the speech bubble for communication, and the three dots for conversation and continuing dialogue.
2. **Do not put an intentional gap, a white halo or a separate outline between the hexagram and the speech bubble.** The reference form is a single shape in which the speech bubble touches or overlaps the lines of the star directly.
3. The standard logo adds no decoration (radio-wave arcs, horns, wings, planets, patterns, separate small stars, extra dots). Being simple, clear and distinguishable at small sizes comes first.
4. The horizontal logo, the vertical logo, the app icon and the favicon are **derived from the same SVG master**, with the same composition and the same shapes of the ring, hexagram and speech bubble. Background colors and line-width corrections for small sizes are allowed.
5. **For favicons from 16 to 48 px, optically corrected versions** may be used. Only the radius of the dots and the line width may increase. The number of points of the star, the position of the speech bubble and the relation between the ring and the star must not change.
   - The 16 px optically corrected version is `favicon-16.svg` (added on 2026-11-18; the exception that leaves out the dots is awaiting approval). It is redrawn on a 16 px grid, with every line of the ring and the hexagram at 1 px. The 6 black triangles inside stay congruent. The body of the speech bubble fits inside the central hexagon, and only its tail may cross the lines. A speech bubble 4 px wide has no room for the three dots, so this version alone leaves them out. At 32 px and 48 px, the normal symbol is used as it is.
6. The shared SVG of the uniform version is both the canonical version and the master for implementation, and PNG/ICO/ICNS files are derivatives. The reference PNG stays as a reference for the composition. Do not give the logo needless shadows, gradients or fine decoration. Provide a monochrome version.

### 3.2 Typesetting

| Use | Specification |
| --- | --- |
| Logotype | `ASTAROT`, **Outfit Bold (700)**, all capitals, letter spacing of about 7.26 units per gap at a cap height of 130 units (about `0.04em`) |
| English UI and headings | Outfit Medium / SemiBold |
| Japanese UI | Zen Kaku Gothic New as the first choice, keeping the fallbacks and the existing users' font settings |
| Code and logs | A monospace font the user can set. The brand typeface is not forced |
| Subtitle | Keep the official English text above word for word. On narrow screens, wrap it, or leave it out and use the icon alone |

**The wordmark path is the actual Outfit Bold (700) font converted to outlines.** It is not a trace of the reference image. `wordmark-reference-outline.svg` and the horizontal and vertical logos use this outline. The typeface for the logotype and for English UI and headings changed from Space Grotesk to Outfit on 2026-11-16. What section 11 says about Space Grotesk is a record from before that change.
How the wordmark is made, and the size requirements for setting the wordmark with the subtitle (the lockup), are in `docs/brand/astarot/typography-and-lockup.md`.
The outline of `ASTAROT` traced from the reference image and cleaned up is kept in `wordmark-alt-traced.svg` as a separate alternative for comparison. It is not used in the logo.
The small body text and subtitle in the PNGs may be rendered in a substitute typeface, depending on the environment.

To show the subtitle and other text in Outfit, the app bundles the Outfit font files (SIL Open Font License 1.1). The bundling is done in the P1 UI work. The license is recorded in `NOTICE.md` and `licenses/outfit/`.
If font files are embedded in assets, verify the license, the distribution and broken display separately. **Remote fonts are not loaded automatically.** Do not replace the repository's existing UI font settings on your own.

### 3.3 Color tokens

| Role | Color | Use |
| --- | --- | --- |
| Primary / Dark Plum | `#261633` | Logo text, symbol, app background |
| Accent / Lilac | `#A47AF5` | Limited emphasis, selected states and similar |
| Canvas / Off-White | `#FAFAFC` | Brand materials, light backgrounds |
| Logo on dark | `#FFFFFF` or `#FAFAFC` | Inverted display on a plum background |

Never express a state by color alone; combine it with text, shape and focus indicators. Evaluate the contrast of text and controls on the screens concerned. The colors are a **decision on the brand's direction**. They do not call for replacing the whole UI in the current `DESIGN.md` at once.

### 3.4 Asset management

Location: `docs/brand/astarot/`. The canonical symbol is the uniform version, `symbol-light.svg`. The reference images for the composition (`reference-brand-guide.png` and its crop, `reference-mark-crop.png`) were removed from the repository on 2026-11-17, after the lockup on the brand board was matched to their balance. `tools/astarot_brand_from_reference.py` builds the wordmark from Outfit Bold, sets it with the symbol from `symbol-light.svg`, and generates the SVGs of the wordmark, the horizontal and vertical logos and the brand board. With `--check`, it writes nothing and checks whether the current files match. It does not generate the symbol, icon or favicon files, or the PNGs. The fonts it uses and how to run it are written at the top of the tool. The shared path shape in `symbol-light.svg` is the SVG technical master, and `app-icon.svg`, `favicon.svg`, `symbol-dark.svg`, `logo-horizontal-light.svg`, `logo-horizontal-dark.svg`, `logo-vertical-light.svg` and `logo-vertical-dark.svg` use **the same path**. Each PNG and preview is a derivative.

Only the 16 px optically corrected version, `favicon-16.svg`, does not use the shared path. `tools/astarot_favicon_small.py` draws it from geometry and also makes `favicon-16.png` and `favicon.ico`. `favicon.ico` holds this version at 16 px, and `favicon-32.png` and `favicon-48.png` at 32 px and 48 px. The manual's pages use this ICO as their favicon. The reason is that with an SVG favicon, browsers shrink the SVG for the 16 px tab as well. With `--check`, it writes nothing and checks whether the current files match.

The `VRCT-VOX` icons, logos and feature glyphs that were directly under `docs/brand/`, and their generator `tools/brand_assets.py`, were not to be overwritten until the migration was approved. Because the app and the README had moved to the ASTAROT assets, these files were removed from the repository on 2026-11-18. The current list of assets and how to generate them are in `docs/brand/README.md`.

## 4. Definition and boundaries of the product's features

- The initial scope is conversation support centered on VRChat users. Keep the existing UX around ASR, TTS, RVC, OCR, translation and captions, and in the brand's description, group them as Speech / Translation / Revoicing / OCR / Accessibility.
- **Accessibility is a cross-cutting requirement, not one item in the feature list.** It includes keyboard operation, visible focus, readable Japanese text, zooming in and out, reduced motion, input and output that do not use the voice, protection against mistaken operation, and ways of notification that the user can choose.
- Future candidates (not implemented, not promised): sign language recognition and translation, audio guidance or audio description for video and UI, haptic notifications and feedback, and two-way conversion between sight, text, sound and touch. Adopting any of them needs its own requirements, user validation and design decision for each feature.
- **Accessibility needs differ widely from person to person.** Do not make any particular sensory channel mandatory. Do not play speech automatically, turn on the microphone, capture or send video, or download models against the user's will.
- Model licenses, the limits on redistributing OCR weights, external connections for translation and voice conversion, data protection and the user's prior consent follow the existing policies and separate ADRs.

## 5. Roadmap: a staged migration

| Stage | Main work | Completion condition |
| --- | --- | --- |
| **P0 Brand master (this ADR)** | Decide the name, philosophy, logo specification, SVG/PNG masters and placement rules | The canonical text and images are approved, and the legibility and contrast at each size are reviewed |
| **P1 Display brand migration (the app's display is implemented; the documents and the site are in progress)** | Unify About, the README, help, the documentation, what the app visibly shows and the images on ASTAROT | An audit for mixing with the old brand, keeping the upstream attribution, UI tests and package verification |
| **P2 Internal identifier migration (separate ADR required)** | A migration plan for the Tauri app ID, executable, settings paths, OS integration, model download information, audio routing identifiers and others | Carried out after verification of settings carry-over from (or coexistence with) old versions, of upgrade and rollback, and on Windows/Linux |
| **P3 Foundation work (future)** | Abstract the features as loosely coupled modalities/providers, and shape the UX of converting between inputs and outputs | No regressions in the existing voice, OCR and translation features; consent, stopping and audio routes work consistently |
| **P4 Accessibility expansion (research candidates)** | Evaluate sign language, audio guides, haptics and others one by one for need and safety | Only features that pass user testing and the checks on privacy, performance, supported devices and model rights are adopted |

**No release date or completion is guaranteed for P1 to P4.** Detailed technology choices are made in later ADRs and issues. Adopting P0 is not a reason to implement P2 to P4 ahead of time.

## 6. Strong constraints on the migration

1. The current identifiers in `docs/voice-stack/project-rename.md` (for example `vrct-vox`, `vrct-vox-sidecar`, `io.github.kein5.vrct-vox`, `VRCT_*`, the XDG settings and data locations, virtual microphone and service names) are **not changed without a migration plan**.
2. Rebranding work does not remove the rights notices of upstream VRCT, the MIT license or the notice duties for derivative works. It does not let the app be mistaken for the original product.
3. Protect the backend's IPC/OSC contracts, the audio routes, mute and immediate stop, consent to model downloads, independent control of TTS and RVC, translation, captions and compatibility with existing settings.
4. A design change must not turn on new features without permission. Visual accessibility and the legality and safety of features are verified separately.
5. In P0, do not rewrite the adopted specifications in the existing `PRODUCT.md`, `DESIGN.md` and `docs/brand/`. When P1 starts, state the differences from the plan, and reflect them formally in `AGENTS.md` and the spec catalog too.
6. Before public release or distribution, check for possible conflicts with third-party trademarks or similar services over the brand name, the logo, the mythological name and so on. This ADR does not replace checking for trademark permission.

## 7. Alternatives and reasons for the choice

- Keep `VRCT-VOX`: clear to existing users, but strongly associated with the upstream project, and the name keeps the product tied to voice as it expands beyond voice.
- Candidates in the `Vox` family (TransVox, OmniVox, VoxBox and others): easy to read as voice products, but the overlap with existing voice-related products and brands stands out. They also say little about the intent to expand to modalities other than voice.
- Japanese-leaning coinages such as `Shaberator`: friendly, but ASTAROT does better on consistency across languages and as a general name for a platform.
- **ASTAROT**: easy to pronounce, a recursive acronym of 7 letters that can cover the current features and future Accessibility, and the basis for a recognizable brand built as one with the symbol. Its distinctiveness for trademarks and search still has to be checked separately.

## 8. Acceptance criteria (brand master)

**Image-based acceptance gate**: a person compares the uniform symbol side by side with `reference-brand-guide.png` and `reference-mark-crop.png` and confirms that the composition (the star touching the speech bubble, the ring, the three dots, the proportions) is kept. Line widths and the shape of the triangles are judged against the uniform SVG.

**Mechanical checks**: confirm that the shared path is identical in every SVG. The repository has no tool yet that generates the uniform symbol. The wordmark, logos and brand board can be checked against the current files with `tools/astarot_brand_from_reference.py --check`. When checking generated files, review legibility from the minimum of 16 px up to large sizes.

- `ASTAROT` is written correctly in the main images and SVGs.
- The official subtitle matches `Speech, Translation, Accessibility, Revoicing & OCR Toolkit` (`&amp;` in HTML/SVG becomes `&` after rendering).
- The symbol in the normal logo, the inverted logo, the app icon and the favicon uses the same ring, the same hexagram, the same touching speech bubble and the same three dots. The exception is the 16 px optically corrected version, which leaves out the three dots (item 5 of section 3.1).
- Evaluate by eye that the symbol is recognizable at 16/32/64/128/512 px, and that lines and dots do not touch and run together when scaled down. Apply optical correction if needed, without changing the unified motif.
- The logotype specifies Outfit Bold (700) and is displayed with a licensed font that can be used in the actual distribution environment, or with glyphs converted to outlines.
- Single-color versions for light and dark exist. Meaning does not depend on the accent color alone.
- Existing users' data, settings and audio routes are not changed. Creating brand images alone does not migrate features or identifiers.

## 9. Consequences and handover to the implementation work

This ADR is **a decision on product policy and brand**. The identifiers of the current build stay `VRCT-VOX`, and this ADR does not mean that the product's migration to ASTAROT is complete. After the masters are registered in `docs/brand/astarot/`, create the P1 implementation issue and the P2 migration ADR separately. Using the new brand in the OSS documents and distributions goes ahead after trademarks, fonts and the licenses of images and models are checked.

## 10. 2026-11-16: rebuild based on the reference image (record)

The earlier delivered package, drawn with independent geometry, was rejected because the shape of its icon differed from the approved image.
This regenerated package includes the image the user attached as `reference-brand-guide.png`, and the outlines of the main symbol and the wordmark were extracted from it. The generator code verifies that the same main symbol outline is present in every SVG. The display typeface that was checked is the outline in the reference image, and no claim is made that it is the outline of an actual font.

This update is **not a commit to the repository**. If it is adopted, check the differences from the existing ADR-011 and bring it in through the usual process, such as a PR. The icons and identifiers of the old VRCT-VOX are not changed automatically.

## 11. 2026-11-16: replacement with the uniform version (record)

The traced version from section 10 was replaced with a set rebuilt with uniform geometry. In the traced version, the line widths and the shapes of the triangles varied. In the uniform version, every white line of the hexagram is 11 units wide, and the 6 black triangles inside are all congruent. The wordmark was replaced with the outlines of the actual Space Grotesk Bold font. The wordmark made from a trace of the reference image is kept as `wordmark-alt-traced.svg`.

`reference-brand-guide.png` and `reference-mark-crop.png` were kept as references for the composition. The statement in section 10 that "no claim is made that it is the outline of an actual font" is a record about the traced version.

## 12. 2026-11-16, proposed addition: bring the migration of the display name, documents, site and repository name forward to 0.5.0

Status: **proposed addition (awaiting review)**. If it is adopted, remove "proposed addition", and correct the table in section 5 and section 9 to match.

### Decision (proposed)

- From 0.5.0, the product's display name is ASTAROT. Of P1 in section 5, the documentation, the README, the GitHub Pages site and the release notes template come into the scope of 0.5.0.
- Changing the GitHub repository name from `kein5/VRCT-VOX` to an ASTAROT name also comes into the scope of 0.5.0. This item was not written in any stage of the table in section 5. The name changes at the 0.5.0 release. 0.4.0 ships under the current name, so the name does not change before then.
- The text shown on the app's screens moves as part of the UI renewal work.
- Internal identifiers (package names, executable names, where settings and data are stored, the `VRCT_*` environment variables, the app ID, the file names of release artifacts and so on) stay in P2 as before and are handled in a separate ADR. The constraint in item 1 of section 6 does not change.

### Reasons (proposed)

- If the display name, documents, site and repository name move at different times, users cannot tell that it is the same product. Move them together in one version.
- The URL the updater checks for stable versions has been changed to the project's Worker URL. This URL does not contain the repository name, so changing the name does not break the update path from 0.4.x. Beta versions and the URLs of release artifacts are reached through GitHub's redirect after the rename.

### Consequences (proposed)

- The inventory of places where the display name appears is in [astarot-rename-inventory.md](../voice-stack/astarot-rename-inventory.md).
- The order, effects and check items for changing the repository name are in [repository-rename.md](../voice-stack/repository-rename.md).
- Changing the name changes the GitHub Pages URL. GitHub does not redirect the old URL. Help links in 0.4.x apps will stop opening, so decide how to handle that before changing the name.
- After the name changes, do not create a repository named `kein5/VRCT-VOX` again. Doing so stops GitHub's redirect and breaks updates and installation for 0.4.x.
- Following item 5 of section 6, reflect the change in `PRODUCT.md`, `DESIGN.md`, `AGENTS.md` and the spec catalog when P1 starts.

---

# ADR-011: ASTAROT の名称、ブランド統一、マルチモーダル・アクセシビリティの製品方針（日本語版）

Status: **採用（製品方針・ブランド仕様）／素材再生成済み・表示の移行（P1）はアプリの表示を develop に実装済みで、文書とサイトは作業中・識別子の移行（P2）は未着手**
Date: 2026-11-16
Reference: `docs/brand/astarot/symbol-light.svg`（均一な幾何で作り直したシンボルの正本）
Related: `PRODUCT.md`、`DESIGN.md`、`AGENTS.md`、`docs/brand/README.md`、`docs/voice-stack/project-rename.md`、`docs/adr/adr-010-frontend-stack.md`、`docs/adr/README.md`

## 1. 背景と目的

現行プロジェクト `kein5/VRCT-VOX` は、VRChat 等で音声・文字による会話を支援するデスクトップアプリである。音声認識（ASR）、音声合成（TTS）、声質変換（RVC 等）、OCR、翻訳、字幕等を統合し、特に声を使わず交流するユーザーを支援する。

将来、手話の翻訳、音声ガイド、触覚フィードバックなどを含む **マルチモーダル・アクセシビリティ・ツールキット** へ拡張する。音声中心の旧称から製品理念を表現できる名称を採用し、アイコン、ロゴ、テキストを統一する。既存コード・機能・設定・利用者データの移行は別工程とする。

## 2. 決定：名称と説明文

- **正式ブランド名**：`ASTAROT`（表記は全大文字、読みは「アスタロト」）。
- **正式な再帰的頭字語**：**Astarot's Speech, Translation, Accessibility, Revoicing & OCR Toolkit**。
- **正式サブタイトル**：**Speech, Translation, Accessibility, Revoicing & OCR Toolkit**。README、Web、アプリの About、ブランド画像で文言と記号を一致させる。
- **任意のコミュニケーション用タグライン**：`Communication Beyond Voice.`。正式サブタイトルの置換として使わない。
- 由来は ASTAROT を自己参照する GNU 型の再帰的頭字語。神話・悪魔学のアスタロトを想起させる命名ではあるが、宗教的・超自然的な機能を意味しない。

| 文字 | 展開 | 意味・対象 |
| --- | --- | --- |
| A | Astarot's | 再帰的自己参照 |
| S | Speech | ASR、TTS、字幕、音声案内 |
| T | Translation | 言語間翻訳、将来の手話変換 |
| A | Accessibility | 入出力の選択、利用支援 |
| R | Revoicing | 音声変換、RVC 等 |
| O | OCR | 文字・視覚情報の認識 |
| T | Toolkit | 拡張可能な統合ツール群 |

**設計原則：**「話させる」ことを目的化せず、利用者が **伝える方法・受け取る方法を選べる** ようにする。

## 3. 決定：ロゴ、アイコン、タイポグラフィー

### 3.1 主要シンボル（確定・均一版が正本）

**シンボルの正本は `docs/brand/astarot/symbol-light.svg` の共通 `path`（均一版）。**
ユーザーは2026-11-15に `reference-brand-guide.png` の右下にある「App Icon」を正本の構図と指定し、以前の別形状のアイコンを不採用とした。参照画像には `ASTAROT`、円環、二つの重なる正三角形からなる六芒星、六芒星の線と接する中央の三点入り吹き出しが描かれている。その後、この構図を保ったままシンボルを均一な幾何で作り直し、2026-11-16にこの均一版を正本とした。

- **ベクター技術原版**：`symbol-light.svg` に含まれる共通の `path`。参照画像のトレースではなく、均一な幾何で描き直した形状である。六芒星の白いラインはすべて同じ太さ（11単位）で、中の黒い三角形6つはすべて合同である。円環、吹き出し、三点の配置は参照画像の構図に合わせている。
- **形状の優先順位**：共通SVGの `path` > PNG/ICOなどのサイズ別出力。参照画像は構図の確認に使い、形状の細部の基準にはしない。
- **厳守**：星と吹き出しの接触部を切り離さない。吹き出しを取り囲む白いハロー・隙間や別の背景を作らない。円環、六芒星、吹き出し、三点の位置と比率を独立変形しない。
- ブランドシートの新しい画像は、参考生成画像ではなく、**上記の共有SVGシルエットとロゴタイプ輪郭を組み合わせて描画した派生アセット**とする。



1. **外側の円環、二つの正三角形による六芒星、中央の吹き出し、内部の三点**を一つのシンボルとして扱う。外円は一体性、六芒星は異なる情報の連携、吹き出しはコミュニケーション、三点は会話・継続的対話を表す。
2. **六芒星と吹き出しの間に意図的な隙間・白いハロー・独立した縁取りを設けない。** 吹き出しが星の線に直接接する／重なる、一体化した形を基準形とする。
3. 装飾の追加（電波アーク、角、翼、惑星、模様、独立した小さな星、余分な点）は標準ロゴでは行わない。単純明快で、小サイズでも区別できることを優先する。
4. 横長ロゴ、縦長ロゴ、アプリアイコン、favicon は **同一 SVG 原版から派生**させ、構図・円環・六芒星・吹き出しの形状を揃える。背景色や小サイズの線幅補正は許容する。
5. **16–48 px の favicon は光学補正版**を使用できる。点の半径・線幅のみ増やしてよい。星の頂点数、吹き出しの位置、円環と星の関係を変えてはならない。
   - 16 px の光学補正版は `favicon-16.svg` とする（2026-11-18 追加。点を省く例外は承認待ち）。16 px の格子で描き直し、円環と六芒星の線をすべて 1 px にそろえる。中の黒い三角形 6 つは合同のままにする。吹き出しの本体は中央の六角形の内側に収め、線にかかってよいのは尾だけとする。幅 4 px の吹き出しには三点が描けないため、この版だけは三点を省く。32 px と 48 px は通常のシンボルのまま使う。
6. 均一版の共有SVGを正本かつ実装用原版とし、PNG/ICO/ICNS を派生物とする。参照PNGは構図の参照として残す。ロゴに不要な影、グラデーション、細かい装飾を付けない。モノクロ版を用意する。

### 3.2 文字組

| 用途 | 仕様 |
| --- | --- |
| ロゴタイプ | `ASTAROT`、**Outfit Bold (700)**、大文字、字間はキャップハイト 130 単位で字間あたり約 7.26 単位（約 `0.04em`） |
| 英語 UI／見出し | Outfit Medium / SemiBold |
| 日本語 UI | Zen Kaku Gothic New を第一候補とし、フォールバックと既存ユーザーの書体設定を維持する |
| コード・ログ | 設定可能な等幅フォント。ブランド用書体を強制しない |
| サブタイトル | 上記の正式英文を一字一句維持し、狭い画面では折り返しまたは省略してアイコンだけを用いる |

**Wordmark のパスは Outfit Bold (700) の実フォントの輪郭をアウトライン化したものである。** 参照画像のトレースではない。`wordmark-reference-outline.svg` と横長・縦長のロゴはこのアウトラインを使う。ロゴタイプと英語 UI・見出しの書体は 2026-11-16 に Space Grotesk から Outfit に変えた。11節の Space Grotesk の記述は、変える前の記録である。
ワードマークの作り方と、ワードマークとサブタイトルを組むときのサイズの要件（ロックアップ）は `docs/brand/astarot/typography-and-lockup.md` にある。
参照画像に描かれた `ASTAROT` の輪郭をトレースして整えたものは、比較用の別案として `wordmark-alt-traced.svg` に残す。ロゴには使わない。
PNGの小さな本文・サブタイトルは利用環境に応じて代替書体でレンダリングされうる。

サブタイトルなどを Outfit で表示するため、Outfit のフォントファイル（SIL Open Font License 1.1）をアプリに同梱する。同梱の実装は P1 の UI の作業で行う。ライセンスは `NOTICE.md` と `licenses/outfit/` に記録した。
フォントファイルをアセットに埋め込む場合はライセンス・配布物・表示崩れを別途検証する。**リモートフォントの自動読み込みはしない。** リポジトリの既存 UI フォント設定を勝手に置換しない。

### 3.3 カラートークン

| ロール | カラー | 用途 |
| --- | --- | --- |
| Primary / Dark Plum | `#261633` | ロゴ文字、シンボル、アプリ背景 |
| Accent / Lilac | `#A47AF5` | 限定的な強調、選択状態など |
| Canvas / Off-White | `#FAFAFC` | ブランド資料・ライト背景 |
| Dark 上のロゴ | `#FFFFFF` または `#FAFAFC` | プラム背景への反転表示 |

常に色だけで状態を表現せず、文字・形・フォーカス表示を組み合わせる。テキスト・コントロールのコントラストを対象画面で評価する。色は **ブランド方向の決定**であり、現行 `DESIGN.md` の UI 全体の一括置換を指示しない。

### 3.4 アセット管理

配置先：`docs/brand/astarot/`。シンボルの正本は均一版の `symbol-light.svg`。構図の参照画像（`reference-brand-guide.png` とその切り抜きの `reference-mark-crop.png`）は、ブランドボードのロックアップをそのバランスに合わせたあと、2026-11-17 にリポジトリから削除した。`tools/astarot_brand_from_reference.py` は、Outfit Bold からワードマークを作り、`symbol-light.svg` のシンボルと組んで、ワードマーク、横長・縦長のロゴ、ブランドボードの SVG を生成する。`--check` を付けると、何も書かずに現在のファイルと一致するかを確かめる。シンボル、アイコン、favicon のファイルと PNG は生成しない。使うフォントと実行の方法はツールの先頭に書いてある。`symbol-light.svg` の共有パス形状を SVG の技術原版とし、`app-icon.svg`、`favicon.svg`、`symbol-dark.svg`、`logo-horizontal-light.svg`、`logo-horizontal-dark.svg`、`logo-vertical-light.svg`、`logo-vertical-dark.svg` に**同一パス**を用いる。各 PNG・プレビューは派生物とする。

16 px の光学補正版 `favicon-16.svg` だけは共有パスを使わない。`tools/astarot_favicon_small.py` が幾何から描き、`favicon-16.png` と `favicon.ico` も作る。`favicon.ico` には、16 px にこの版を、32 px と 48 px に `favicon-32.png` と `favicon-48.png` を入れる。マニュアルのページはこの ICO を favicon にする。SVG の favicon を置くと、ブラウザーは 16 px のタブにも SVG を縮小して使うためである。`--check` を付けると、何も書かずに現在のファイルと一致するかを確かめる。

`docs/brand/` 直下にあった `VRCT-VOX` のアイコン、ロゴ、機能グリフと生成ツール `tools/brand_assets.py` は、移行の承認まで上書きしないことにしていた。アプリと README の表示が ASTAROT の素材に移ったので、2026-11-18 にリポジトリから削除した。いまの素材の一覧と生成の手順は `docs/brand/README.md` にある。

## 4. 製品機能の定義と境界

- **初期の対象**：VRChat 利用者を中心とした会話支援。既存の ASR/TTS/RVC/OCR/翻訳/字幕関連の UX を維持し、これらをブランド説明上は Speech / Translation / Revoicing / OCR / Accessibility に整理する。
- **Accessibility は機能一覧の一項目でなく横断的な要求**：キーボード操作、視認可能なフォーカス、可読な日本語テキスト、拡大・縮小、reduced motion、音声を使わない入力と出力、誤操作防止、ユーザーが選択できる通知手段を含む。
- **将来の候補（未実装・未確約）**：手話認識・翻訳、映像や UI の音声ガイダンス／音声解説、触覚通知とフィードバック、視覚・文字・音声・触覚の双方向変換。採用には各機能の独立した要件定義・利用者検証・設計判断を必要とする。
- **アクセシビリティは個人差が大きい**。特定の感覚手段を必須にしない。ユーザーの意思に反する自動音声出力、マイク有効化、映像の取得・送信、モデルのダウンロードを行わない。
- モデルのライセンス、OCR 重みの再配布制約、翻訳・音声変換の外部接続、データ保護、利用者の事前同意は既存ポリシーと別 ADR に従う。

## 5. ロードマップ：段階的な移行

| 段階 | 主な作業 | 完了条件 |
| --- | --- | --- |
| **P0 ブランド原版（本 ADR）** | 名称・理念・ロゴ仕様・SVG/PNG 原版・配置ルールを決定 | 文言と画像の正本を承認し、各サイズの視認性・コントラストをレビュー |
| **P1 表示ブランド移行（アプリの表示は実装済み。文書とサイトは作業中）** | About、README、ヘルプ、ドキュメント、アプリの可視表示、画像を ASTAROT に統一 | 旧ブランドとの混在を監査、上流帰属を保持、UI テストとパッケージ検証 |
| **P2 内部識別子移行（別 ADR 必須）** | Tauri app ID、実行ファイル、設定パス、OS 統合、モデル取得情報、音声ルーティング識別子等の移行計画 | 旧版からの設定引継ぎ／同居・アップグレード・ロールバック・Windows/Linux 検証後に実施 |
| **P3 基盤の整備（将来）** | 機能を疎結合のモダリティ／プロバイダとして抽象化し、入出力変換の UX を整える | 既存の音声・OCR・翻訳の機能回帰なし、同意・停止・音声経路が一貫して機能 |
| **P4 Accessibility 拡張（研究候補）** | 手話、音声ガイド、触覚などを必要性と安全性で個別評価 | 利用者テスト、プライバシー・性能・対応デバイス・モデル権利をクリアした機能のみ採用 |

**P1〜P4 に公開時期や実装完了を保証しない。** 詳細な技術選定は後続 ADR／Issue で決める。P0 の採用を理由に P2〜P4 の実装を先行させない。

## 6. 移行上の強い制約

1. `docs/voice-stack/project-rename.md` の現行識別子（例：`vrct-vox`、`vrct-vox-sidecar`、`io.github.kein5.vrct-vox`、`VRCT_*`、XDG 設定・データ保存先、仮想マイク・サービス名等）は **移行計画なしに変更しない**。
2. リブランド作業は上流 VRCT の権利表示、MIT ライセンスおよび派生物の表示義務を消さない。本家製品と誤認させない。
3. バックエンドの IPC/OSC 契約、音声経路、ミュートと即時停止、モデル取得の同意、TTS と RVC の独立制御、翻訳、字幕、既存設定の互換性を守る。
4. デザイン変更が新機能の無断有効化を伴ってはならない。視覚的なアクセシビリティと、機能の適法性・安全性は別々に検証する。
5. P0 では既存 `PRODUCT.md`、`DESIGN.md`、`docs/brand/` の採用済み仕様を書き換えない。P1 着手時に計画との差分を明示し、`AGENTS.md` と仕様カタログにも正式に反映する。
6. ブランド名・ロゴ・神話名称等に関する第三者の商標／類似サービスとの競合可能性について、外部公開・配布前に確認する。この ADR は商標使用許諾の確認に代わるものではない。

## 7. 代替案と採用理由

- `VRCT-VOX` 維持：既存ユーザーには分かりやすいが、上流プロジェクトへの連想が強く、音声以外への製品拡張に名前が従属する。
- `Vox` 系候補（TransVox、OmniVox、VoxBox 等）：音声製品だと伝わりやすいが、先行する音声関連製品・ブランドとの重複が目立つ。声以外のモダリティへの拡張意図も弱い。
- `Shaberator` 等の日本語寄り造語：親しみやすいが、多言語での一貫性と汎用的な基盤名としては ASTAROT が優れる。
- **ASTAROT**：発音しやすく、7文字の再帰的頭字語で現行機能と将来の Accessibility を包含でき、シンボルと一体の識別可能なブランドを構築できる。ただし商標・検索上の独自性は別途確認する。

## 8. 受け入れ基準（ブランド原版）

**画像ベースの受け入れゲート**：均一版のシンボルを `reference-brand-guide.png` と `reference-mark-crop.png` に並べて人が比較し、構図（星と吹き出しの接触、円環、三点、比率）が保たれていることを確認する。線の太さと三角形の形は均一版のSVGを基準にする。

**機械的検証**：共通パスが全SVGで同一であることを確かめる。均一版のシンボルを生成するツールはリポジトリにまだない。ワードマーク、ロゴ、ブランドボードは `tools/astarot_brand_from_reference.py --check` で現在のファイルと一致するかを確かめられる。生成ファイルを検査する際は最小16pxから大サイズまで視認性をレビューする。

- 主要画像・SVG に `ASTAROT` の文字列が正しく表記される。
- 正式サブタイトルが `Speech, Translation, Accessibility, Revoicing & OCR Toolkit` と一致する（HTML/SVG 内の `&amp;` はレンダリング後 `&` となる）。
- 通常ロゴ・反転ロゴ・アプリアイコン・favicon のシンボルは同じ円環、同じ六芒星、同じ接する吹き出し、同じ三点を用いる。例外は 16 px の光学補正版で、三点を省く（3.1 節の 5）。
- 16/32/64/128/512px でシンボルが認識でき、縮小時に線・点が接触して潰れないことを目視で評価する。必要なら光学補正し、統一モチーフは変えない。
- ロゴタイプは Outfit Bold (700) を指定し、実配布環境で使用可能なライセンス済みフォントまたはアウトライン化済み字形で表示する。
- ライト・ダークの単色版を備える。アクセント色だけに意味を依存しない。
- 既存ユーザーのデータ・設定・音声経路を変更しない。ブランド画像作成のみで機能や識別子を移行しない。

## 9. 帰結と実装作業への引き継ぎ

この ADR は **製品方針とブランドの決定**。現行ビルドの識別子は `VRCT-VOX` のままであり、ASTAROT への製品移行が完了したことは意味しない。原版を `docs/brand/astarot/` に登録後、P1 の実装 Issue、P2 の移行 ADR を別途作る。OSS 文書と配布物での新ブランド利用は、商標、フォント、画像・モデルのライセンス確認後に進める。


## 10. 2026-11-16 参照画像に基づく作り直し（記録）

前回の独立した幾何学描画による納品パッケージは、承認画像とアイコンの形状が異なっていたため不採用。
今回の再生成パッケージではユーザー添付画像を `reference-brand-guide.png` として同梱し、そこから主シンボル輪郭・Wordmark輪郭を抽出した。同じ主シンボル輪郭が全SVGに存在することを生成コードで検証している。確認済みの表示書体は参照画像内のアウトラインであり、実フォントのアウトラインであるとの主張はしない。

この更新は**リポジトリへのコミットではない**。採用時は既存ADR-011との差分を確認し、PRなどの通常の手順で取り込む。旧VRCT-VOXのアイコン・識別子は自動で変更しない。

## 11. 2026-11-16 均一版への差し替え（記録）

10節のトレース版を、均一な幾何で作り直した一式に差し替えた。トレース版では線の太さと三角形の形にばらつきがあった。均一版では六芒星の白いラインがすべて11単位の太さで、中の黒い三角形6つがすべて合同である。Wordmark は Space Grotesk Bold の実フォントのアウトラインに替えた。参照画像のトレースから作った Wordmark は `wordmark-alt-traced.svg` として残している。

`reference-brand-guide.png` と `reference-mark-crop.png` は構図の参照として残した。10節の「実フォントのアウトラインであるとの主張はしない」という記述は、トレース版についての記録である。

## 12. 2026-11-16 追記案：表示名、文書、サイト、リポジトリ名の移行を 0.5.0 に前倒しする

状態：**追記案（レビュー待ち）**。採用されたら「追記案」を外し、5節の表と 9節を合わせて直す。

### 決定（案）

- 0.5.0 から製品の表示名を ASTAROT にする。5節の P1 のうち、ドキュメント、README、GitHub Pages のサイト、リリースノートの型を 0.5.0 の範囲に入れる。
- GitHub のリポジトリ名を `kein5/VRCT-VOX` から ASTAROT の名前に変えることも、0.5.0 の範囲に入れる。この項目は 5節の表のどの段階にも書いていなかった。名前を変えるのは 0.5.0 のリリースのときとする。0.4.0 は現行の名前で出すので、それまでは変えない。
- アプリの画面の表示文言は、UI 刷新の作業の中で移す。
- 内部識別子（パッケージ名、実行名、設定とデータの保存先、`VRCT_*` 環境変数、アプリ ID、配布物のファイル名など）は、これまでどおり P2 とし、別の ADR で扱う。6節1項の制約は変えない。

### 理由（案）

- 表示名、文書、サイト、リポジトリ名がばらばらに移ると、利用者が同じ製品だと分からなくなる。1つの版でそろえて移す。
- updater の安定版の確認先は、プロジェクトの Worker の URL に変えてある。この URL にはリポジトリ名が入っていないので、名前を変えても 0.4.x からの更新の経路は切れない。ベータ版と配布物の URL は、GitHub の改名の転送で届く。

### 帰結（案）

- 表示名が出てくる場所の棚卸しは [astarot-rename-inventory.md](../voice-stack/astarot-rename-inventory.md) にある。
- リポジトリ名の変更の順序、影響、確認の項目は [repository-rename.md](../voice-stack/repository-rename.md) にある。
- 名前を変えると、GitHub Pages の URL が変わる。古い URL は GitHub が転送しない。0.4.x のアプリのヘルプのリンクが開けなくなるので、扱いを決めてから名前を変える。
- 名前を変えた後、`kein5/VRCT-VOX` という名前のリポジトリを作り直さない。作ると、GitHub の転送が止まり、0.4.x の更新とインストールが切れる。
- 6節5項に従い、P1 を始めるときに `PRODUCT.md`、`DESIGN.md`、`AGENTS.md`、仕様のカタログに反映する。
