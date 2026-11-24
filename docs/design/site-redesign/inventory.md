# Inventory of the manual site (2026-11-19)

[日本語版](#マニュアルサイトの棚卸し2026-11-19日本語版)

This document records how the user-facing site (`site/`) is built today. It is the basis of the [redesign proposal](README.md). The inventory was made from the files on `develop` (`3d0acb57`). The site's code was not changed.

- Covered: the pages in `site/`, the theme in `site/.vitepress/`, the images and videos in `site/public/`, `site/motion/`
- Not covered: whether the text of the pages is right (whether the feature descriptions match the current app). The text is being updated in per-feature PRs (for example #673).

## How the site is published

| Item | Current setup |
|---|---|
| Base | VitePress 1.6.4. `vite` is pinned to 6.4.6 by `overrides` in `site/package.json`. Moving to Vite 8 while staying on VitePress 1.6.4 stops each page's `*.lean.js` from being output, and the JavaScript of the published pages stops working (#690) |
| Published at | `https://kein5.github.io/astarot/` (`base: '/astarot/'`, `cleanUrls: true`) |
| Publishing flow | `.github/workflows/pages.yml`. A PR that touches `site/` only builds and checks; a push to develop publishes |
| Checks after the build | `tools/check_site_search.mjs` (whether words inside Japanese sentences can be found by search), `tools/check_site_anchors.mjs` (whether links to headings find their headings), `tools/check_site_downloads.mjs` (whether release files are told apart correctly), `tools/check_site_manual.mjs` (the manual's Japanese and English strings, chapter pages and images) |
| Left out of the build | `site/motion/`. It is a Remotion project, left out of the build by `srcExclude`. Only the exported videos go in `site/public/motion/` |

Changes merged into develop are published as they are. So each stage of the redesign has to be in a state that can be published on its own before it is merged.

## Page structure

The site has three entry points.

| Path | Content | How it is built |
|---|---|---|
| `/` | A page for choosing the language | `site/index.md`. A script in `<head>` moves to `/ja/` or `/en/` by the saved language or the browser's language. Without JavaScript, it shows links to both languages and a link to GitHub Releases |
| `/ja/`, `/en/` | The guide's home page | VitePress's `home` layout. The hero, the download button, a screenshot of the main screen, five features with videos, a note on model downloads |
| `/ja/guide/*`, `/ja/features/*` (the same under `/en/`) | The guide's text | 23 pages per language. VitePress's `doc` layout, with the sidebar on the left and the in-page table of contents on the right |
| `/manual/` | Home of the ASTAROT User Manual | `layout: false`, `search: false`. It does not use the theme's frame; `ManualShell.vue` draws a frame of its own (#371, #372) |
| `/manual/<chapter>` | Chapters of the manual | 10 chapters. None has text yet; each shows only a "Coming soon" note and links to guide pages with the same content |

### The 23 guide pages

The sidebar is split into five groups (`sidebarJa()` and `sidebarEn()` in `site/.vitepress/config.mts`). The line counts are those of the Japanese pages. The English pages have the same structure.

| Group | Page | Lines | Components and syntax used |
|---|---|---|---|
| Getting started | What is ASTAROT (`guide/introduction`) | 30 | `{.feature-rows}` |
| | Install (`guide/install`) | 137 | `CopyText`×5, `Term`×2 |
| | System requirements (`guide/requirements`) | 97 | `Term`×2 |
| | Platform support (`guide/support`) | 88 | Tables |
| | First setup (`guide/first-setup`) | 79 | `StepProgress`, `CopyText`×2, images×2 |
| | How voice and text flow (`guide/how-it-works`) | 69 | `OsTabs`, diagrams (SVG)×2 |
| What you want to do | Find what you want to do (`guide/tasks`) | 109 | `[[toc]]`, `{.needs}`×8 |
| | Use your own models (`guide/custom-models`) | 144 | `Term` |
| Voice and text | Translation (`features/translation`) | 55 | Route strip |
| | Speech recognition (ASR) and realtime captions (`features/transcription`) | 130 | Route strip, images×2 |
| | Text to speech (TTS) (`features/tts`) | 105 | Route strip, `OsTabs`, `Term` |
| | Voice changer (RVC) (`features/voice-conversion`) | 109 | Route strip, `OsTabs` |
| | Chat reading (OCR) (`features/chat-reading`) | 69 | Route strip |
| Screens and integrations | Captions and VR (`features/vr`) | 59 | Images×3 |
| | Inputs and outputs (`features/io-flow`) | 72 | Images×3 |
| | Quick Chat and hotkeys (`features/quick-chat`) | 40 | Image |
| | OBS and WebSocket (`features/integrations`) | 47 | Images×2 |
| Setup and operation | Model downloads (`guide/models`) | 97 | `CopyText`×2 |
| | Windows audio route (`guide/windows-audio`) | 50 | Route strip |
| | Linux audio route (`guide/linux-audio`) | 47 | Route strip, `CopyText` |
| | Troubleshooting (`guide/troubleshooting`) | 98 | `CopyText`, `Term`×2 |
| | Privacy (`guide/privacy`) | 69 | Image |
| | License and credits (`guide/license`) | 29 | — |

Callouts use VitePress's custom blocks (`::: info`, `::: tip`, `::: warning`, `::: details`). Among the Japanese pages, 13 pages have them, with 8 `warning`, 6 `details`, 4 `info` and 1 `tip` in all. `danger` is not used. The top navigation has three items: "Guide", "Install" and "Troubleshooting".

### The 10 manual chapters

The list of chapters is `CHAPTERS` in `site/.vitepress/theme/manual/content.mjs`. Each chapter has links to guide pages. Nine chapters have the status `guide` (readable in the guide), and one, Screens and controls, has `pending` (coming soon).

| Chapter | Guide pages it links to |
|---|---|
| Getting to know ASTAROT | What is ASTAROT, System requirements, Platform support |
| Install and first setup | Install, First setup |
| Screens and controls (coming soon) | How voice and text flow, Quick Chat and hotkeys |
| Translation | Translation |
| Speech recognition and captions | Speech recognition (ASR) and realtime captions |
| Text to speech and revoicing | Text to speech (TTS), Voice changer (RVC) |
| Chat reading | Chat reading (OCR) |
| Audio routes and VR | Inputs and outputs, Windows audio route, Linux audio route, Captions and VR |
| Models and other apps | Model downloads, Use your own models, OBS and WebSocket |
| When something goes wrong | Troubleshooting, Privacy, License and credits |

The only guide page that no chapter links to is "Find what you want to do".

The manual's pages are built in Japanese, and after the script runs, it switches them to English in place (`manual/locale.ts`). The language is decided by `?lang=`, then the saved language, then the browser's language.

### URLs referenced from outside

The following URLs are opened by released versions of the app, the README or SUPPORT.md, or have been public for some time. Released versions of the app cannot be changed, so after the redesign the same URLs must still open the same content.

| URL (under `https://kein5.github.io/astarot`) | Referenced from |
|---|---|
| `/ja/`, `/en/` | The app (`vrct_document_home_url` in `src-ui/logics/ui_configs.ts`), SUPPORT.md |
| `/<language>/guide/troubleshooting` | The app (`vrct_document_url_chunk_faq`), SUPPORT.md |
| `/<language>/guide/first-setup` | The app (`vrct_document_url_chunk_ui_guide`) |
| `/<language>/guide/custom-models` and `#tts`, `#asr`, `#whisper-server`, `#rvc`, `#seed-vc`, `#translation` | The model fields in the app (`vrct_document_url_chunk_custom_models`) |
| `/<language>/guide/requirements`, `/<language>/guide/support` | README.md, `docs/readmes/README.ja.md` |
| `/manual/`, `/manual/<chapter>` | Nothing in the repository links to them. They have been public since 0.5.0 (#372), so readers may arrive from bookmarks or search engines |

The only external URLs the app can open are under `https://kein5.github.io/astarot/**` (`src-tauri/capabilities/vrct_capability.json`).

## Theme customization (`site/.vitepress`)

### Configuration (`config.mts`)

- The Japanese and English `locales`, the sidebar, the top navigation, the footer and the text of the 404 page
- Local search. `searchTokenize.mjs` cuts out words inside Japanese sentences, and the same cutting is used when the index is built and when a search runs
- Heading ids (`slugify.mjs`). It does not decompose the voicing marks (dakuten), so links to Japanese headings find them
- An override of how images are rendered. Every image on a page gets `data-zoom`, and pressing it shows the image enlarged
- `appearance: 'force-dark'`. Dark only; there is no light palette
- `transformPageData` changes the title and the favicon for the manual's pages only, and `transformHead` adds the language redirect script and `hreflang`
- A Vite alias swaps VitePress's `VPLocalSearchBox.vue` for our own `LocalSearchBox.vue`

### Theme (`theme/index.ts`)

It extends VitePress's default theme (`vitepress/theme-without-fonts`, the one without the bundled Inter) and inserts our own components into the layout slots.

| Slot | Component inserted |
|---|---|
| `home-hero-info-after` | `HomeActions` (the download button and one more button) |
| `home-hero-after` | `HomeShot` (a screenshot of the main screen) |
| `home-features-before` | `HomeShowcase` (five features with videos) |
| `doc-before` | `RouteStrip` (the route strip at the top of feature pages) |
| `layout-bottom` | `TermTooltip` (the tooltip shared by the `Term`s on a page) |

`StepProgress`, `OsTabs`, `CopyText`, `Term` and `ManualCallout` are registered as components that Markdown can use. Besides these, event handlers on the whole document take care of the dialog that shows images enlarged and of saving the language chosen in the navigation's language menu.

## Component list

The line counts are for the whole `.vue` file (script, template and style).

### Guide components

| Component | Lines | Role | Where it is used |
|---|---|---|---|
| `HomeActions.vue` | 52 | The row of buttons in the hero. Places `DownloadButton` beside VitePress's `VPButton` | Home page |
| `HomeShot.vue` | 14 | The screenshot under the hero | Home page |
| `HomeShowcase.vue` | 180 | Five features with videos. A video plays only while it is on screen, and with reduced motion a still image shows instead | Home page |
| `RouteStrip.vue` (and `routes.ts`) | 137 | Shows, at the top of a feature page, the route that voice and text take, and lights up that page's step. Draws "You to others" in blue and "Others to you" in purple | 7 pages |
| `components/DownloadButton.vue` | 502 | A button that picks the file for the reader's OS from the latest release, and a menu that lists all files, all versions and the source code | Home page |
| `components/StepProgress.vue` | 352 | Builds a list of steps from the numbered step headings, and on scrolling turns it into a thin bar that stays at the top | First setup |
| `components/OsTabs.vue` | 165 | Switches between steps that differ on Windows and Linux. The chosen OS is shared across all pages and saved | 3 pages |
| `components/CopyText.vue` | 148 | Adds a copy button to folders and addresses | 5 pages |
| `components/Term.vue`, `TermTooltip.vue` (and `tooltip.ts`) | 108, 127 | Gives terms a tooltip with a short explanation. It opens on mouse-over, on focus and on a tap | 5 pages |
| `components/LocalSearchBox.vue` | 1,019 | A search palette copied from VitePress 1.6.4's `VPLocalSearchBox.vue` and modified. With nothing typed, it lists the sidebar's pages | All pages |

### Manual components

| Component | Lines | Role |
|---|---|---|
| `manual/ManualShell.vue` | 309 | The manual's frame. The top bar (name, chapter filter, language, GitHub), the text and the footer |
| `manual/ManualHome.vue` | 828 | The home page. The hero and the mascot, three steps, the contents of 10 chapters, five pillars, the eight faces of the mascot guide and the legend of the callouts, system requirements and support |
| `manual/ManualChapter.vue` | 215 | Chapter pages. The coming-soon note, the related guide pages, the previous and next chapters |
| `manual/ManualCallout.vue` | 81 | Six kinds of callout (note, tip, important, caution, warning, when it does not work). Each kind gets a mascot face. Only the legend on the home page uses it; no text page does |
| `manual/ManualDownload.vue` | 342 | The download button and a menu that lists seven distribution formats in fixed slots |
| `manual/ManualLangMenu.vue` | 176 | The language menu. It switches the text without moving to another page |
| `manual/useMenu.ts` | 80 | Keyboard handling for menu buttons (arrows, Home, End, Esc) |
| `manual/content.mjs` | 486 | The manual's Japanese and English text and the list of chapters |

### Shared modules

`releases.mjs` (telling distribution files apart) and `latestRelease.ts` (fetching the latest release) are shared by the two download buttons. `locale.ts` (which language `/` opens) is shared by the guide and the manual.

## Color, type and motion today

### Three palettes side by side

| Place | Palette | Where it is defined |
|---|---|---|
| Guide (`/ja/`, `/en/`) | Navy and blue. The background is `#111b2c`, buttons `#2865dc`, links `#80acff`. Dark only | `--vp-c-*` and `--vox-*` in `theme/custom.css` |
| Manual (`/manual/`) | Dark Plum, Lilac, Off-White. Switches between light and dark by the OS setting | `--a-*` in `theme/manual/manual.css` |
| App | Dark Plum, Lilac, Off-White. Dark only | DESIGN.md's `colors`, `src-ui/views/app/_index_css/variables.css` |

The app's palette moved from navy to Dark Plum and Lilac on 2026-11-18 (DESIGN.md's "Overview"). The guide's palette was set on 2026-11-15 as "the same Dark Studio as the app" (DESIGN.md's "The user guide (site/)"), and it stayed navy after the app moved. The same navy is also in `site/motion/src/theme.ts` (the videos) and `site/public/diagrams/` (the How voice and text flow diagrams). The screenshots (`site/public/screenshots/`) were also taken of the navy screens.

By OKLCH hue, the guide's background and buttons are at about 261°, Dark Plum at 308° and Lilac at 297°.

The manual's light palette was not made by the rule in DESIGN.md's "Colors" (change only the lightness of a brand color, keep the hue within 3°, and keep the chroma no higher than the original color's). The results calculated on 2026-11-19 are these.

| Token | Value | Difference from the rule |
|---|---|---|
| `--a-link` (links, the important callout) | `#6a3fd2` | Its hue of 290.1° is 7° away from Lilac, and its chroma of 0.212 is above Lilac's 0.178. Its contrast against the background (`#fafafc`) is 6.19:1 |
| `--a-trouble` (the "when it does not work" callout) | `#8a4a9e` | Its hue of 317.6° is 9.5° away from Dark Plum |
| `--a-border` (the border of the search box) | `#e4ddee` | 1.27:1 against the background. DESIGN.md asks an input's border for 3.5:1 against the input's fill and 3:1 against the background it sits on |

The body text (`--a-text`, `--a-text-2`, `--a-text-3`) has at least 4.5:1 against both the background and `--a-bg-soft`.

### Typography

| Place | Body | Headings |
|---|---|---|
| Guide | Fonts on the reader's PC (the system UI font, Noto Sans JP, Hiragino, BIZ UDPGothic, Yu Gothic UI, Meiryo). 16 px | The same typeface as the body. h1 30 px, h2 22 px, h3 18 px. The product name on the home page is 52 px to 96 px |
| Manual | A different list that starts with `system-ui`. 16 px, line height 1.75 | Outfit, only on PCs that have it. Otherwise the same typeface as the body |
| App | The UI font the user chose. Eight steps from 1.2 rem to 2.4 rem (the app's 1 rem is 10 px) | Chosen from the same steps |

Neither loads web fonts. The guide's h2 (22 px) is a size that is not on the app's type scale (12, 13, 14, 15, 16, 18, 20, 24 px).

### Radius and motion

| Place | Radius | Motion duration |
|---|---|---|
| Guide | Mostly 8 px in `custom.css` (the app's `control`). Some components also use 10 px (5 places), 7 px, 6 px, 5 px and 14 px | 140 ms and 240 ms |
| Manual | Mostly 14 px (`--a-radius`). Also 18 px, 12 px, 10 px, 8 px, 7 px, 6 px, 5 px and fully rounded ends (999 px) | 140 ms |
| App | Steps of 2, 4, 8 and 12 px. Otherwise only the rounded ends of bars and tracks | 120 ms and 220 ms |

Some colors are written directly in component styles as well. The focus color `#a9ccff` is written 7 times in the guide's components.

## Problems in how information is laid out

The numbers are referenced from the [redesign proposal](README.md).

### P-01 The same content has two entry points and two tables of contents

The guide (23 pages in five sidebar groups) and the manual (10 chapters) list the same content under different tables of contents. The manual's chapters have no text; each one only links to guide pages. Readers cannot tell which one is the source of truth. The guide's top navigation does not lead to the manual, and the manual's footer calls the guide the "Previous guide". The text is in the guide.

### P-02 There are two home pages, and they hold facts twice

The home page at `/ja/` and the one at `/manual/` both have a download button and an introduction of the features. The manual's home page keeps its own copy, in `content.mjs`, of the system requirements (the OS conditions and the GPU conditions) and of the seven distribution formats for download. The same facts are also written in the guide's "Install" and "System requirements".

When a fact is held twice, only one copy gets fixed. For example, #673 brings 0.6.0's change to a single Windows package into the guide's pages, but does not change the seven slots in `content.mjs` (including "ZIP (CUDA)"). Also, `content.mjs` calls the "Captions and VR" page "VR and overlay". The app's settings page was renamed "Captions and VR" on 2026-11-18, and the guide's sidebar uses that name.

### P-03 There are two ways to switch the language

The guide has a separate URL per language (`/ja/…` and `/en/…`) and shows which pages correspond with `hreflang`. The manual builds Japanese HTML only and switches it to English with a script. So readers without JavaScript and search engines cannot see the English manual. The manual's pages have no `hreflang` either.

### P-04 There are two kinds of search

The guide's search is a palette over the text of all pages (VitePress's local search, which also handles words inside Japanese sentences). The manual's search box only filters chapter titles, summaries and keywords. The manual's pages are `search: false`, so the guide's search leaves them out too.

### P-05 The look matches neither the app nor the manual

As described in "Three palettes side by side". The guide is dark only, while the manual switches between light and dark by the OS setting. The screenshots, videos and diagrams are still navy as well.

### P-06 Components with the same role come in pairs

| Role | Guide | Manual |
|---|---|---|
| Download button | `DownloadButton.vue` (502 lines. Lists the latest release's files by OS, with links to all versions and the source code) | `ManualDownload.vue` (342 lines. Lists seven distribution formats in fixed slots, and shows "Not in this release" for the missing ones) |
| Language switching | The language menu in VitePress's navigation (moves to another URL) | `ManualLangMenu.vue` (switches in place) |
| Callouts | VitePress's custom blocks (colors changed in `custom.css`) | `ManualCallout.vue` (six kinds, with faces) |
| Keyboard handling for menus | Its own code inside `DownloadButton.vue` | `useMenu.ts` |

### P-07 The mascot is only on the manual's home page

The mascot (the devil penguin) appears only in the hero and in the mascot guide section of the manual's home page. The home page explains "Its face tells you what kind of note you are looking at", but no text uses the callouts with faces (`ManualCallout`). The mascot does not appear on the guide's pages.

### P-08 The sidebar groups differ from the app's settings, and First setup is far from the start

- "Getting started" has six pages, and the system requirements and platform support tables (which are read when looking something up) come before "First setup". A first-time reader goes through two reference tables before being able to send a message.
- "What you want to do" has only two pages. "Use your own models" is apart from "Model downloads" (in Setup and operation).
- "Setup and operation" lists models, audio routes, troubleshooting, privacy and the license. The audio route pages are also apart from "Inputs and outputs" (in Screens and integrations).
- The feature groups differ from the groups of the app's settings menu (Conversation, Voice and reading, Ease of use, App; DESIGN.md's "Layout", #554). A reader who compares the app with the guide has to look for the same feature under a different group.

### P-09 The top navigation leads to few places

The top navigation has only "Guide", "Install" and "Troubleshooting". The download button is only on the home page, and there is no link to the release notes.

### P-10 Some sentences break the rules for the words on screen

DESIGN.md's "Words" decides that the user's PC is written as 「お使いのPC」 ("your PC") or that the PC is left out (#437). As of 2026-11-19, wording that breaks this rule appears in 15 places on 7 Japanese pages and in 9 places on 5 English pages. The English "this computer" also points at the reader's PC from the writer's side; counting it, the English pages have 16 places on 8 pages.

### P-11 Some parts rely on VitePress internals

- `LocalSearchBox.vue` is a copy that imports internal files of VitePress 1.6.4 (`vitepress/dist/client/…`). In VitePress 2 the original file has changed by about 410 lines (#690), and the copy has to be brought back in line when VitePress is upgraded.
- `StepProgress.vue` reads the positions of `.VPNav` and `.VPLocalNav`, and `custom.css` overrides classes of the default theme such as `.VPSidebarItem` and `.VPHero`.

### P-12 The strings are scattered

The strings of the guide's components are split across `config.mts` (navigation, sidebar, search), the `WORDS` inside each component (`DownloadButton`, `CopyText`, `StepProgress`) and `routes.ts`. The check that the Japanese and English keys match exists only for the manual's `content.mjs` (`check_site_manual.mjs`).

---

# マニュアルサイトの棚卸し（2026-11-19）（日本語版）

利用者向けのサイト（`site/`）の今の作りを記録した文書です。[再設計の提案](README.md)の前提にします。棚卸しは`develop`（`3d0acb57`）のファイルから作りました。サイトのコードは変えていません。

- 対象: `site/`のページ、`site/.vitepress/`のテーマ、`site/public/`の画像と動画、`site/motion/`
- 対象外: ページの文章の正しさ（機能の説明が今のアプリと合っているか）。文章の更新は機能ごとのPRで進んでいます（例: #673）。

## 公開の仕組み

| 項目 | 今の作り |
|---|---|
| 土台 | VitePress 1.6.4。`vite`は`site/package.json`の`overrides`で6.4.6に固定しています。VitePress 1.6.4のままVite 8に上げると、各ページの`*.lean.js`が出力されず、公開したページのJavaScriptが動かなくなります（#690） |
| 公開先 | `https://kein5.github.io/astarot/`（`base: '/astarot/'`、`cleanUrls: true`） |
| 公開の流れ | `.github/workflows/pages.yml`。`site/`に触れるPRではビルドと検査だけを行い、developへのpushで公開します |
| ビルド後の検査 | `tools/check_site_search.mjs`（日本語の文中の語で検索できるか）、`tools/check_site_anchors.mjs`（見出しへのリンクが見出しを見つけるか）、`tools/check_site_downloads.mjs`（リリースのファイルを正しく読み分けるか）、`tools/check_site_manual.mjs`（マニュアルの日英の語、章のページ、画像） |
| ビルドの対象外 | `site/motion/`。Remotionのプロジェクトで、`srcExclude`でビルドから外しています。書き出した動画だけを`site/public/motion/`に置きます |

developにマージした変更は、そのまま公開されます。そのため、再設計の各段は、その段だけで公開できる状態にしてからマージする必要があります。

## ページの構成

サイトには入口が3つあります。

| パス | 中身 | 作り |
|---|---|---|
| `/` | 言語を選ぶページ | `site/index.md`。`<head>`のスクリプトが、保存した言語かブラウザの言語で`/ja/`か`/en/`へ移します。JavaScriptがないときは、両方の言語へのリンクとGitHub Releasesへのリンクを出します |
| `/ja/`、`/en/` | ガイドのトップ | VitePressの`home`のレイアウト。ヒーロー、ダウンロードのボタン、メイン画面のスクリーンショット、5つの機能と動画、モデルの取得の注記 |
| `/ja/guide/*`、`/ja/features/*`（`/en/`も同じ） | ガイドの本文 | 言語ごとに23ページ。VitePressの`doc`のレイアウトで、左にサイドバー、右にページ内の目次 |
| `/manual/` | ASTAROTユーザーマニュアルのトップ | `layout: false`、`search: false`。テーマの外枠を使わず、`ManualShell.vue`が自分の外枠を描きます（#371、#372） |
| `/manual/<章>` | マニュアルの章 | 10章。本文はまだなく、どの章も「準備中」の注記と、同じ内容のガイドのページへのリンクだけを出します |

### ガイドの23ページ

サイドバーは5つのまとまりに分かれています（`site/.vitepress/config.mts`の`sidebarJa()`と`sidebarEn()`）。行数は日本語のページのものです。英語のページも同じ構成です。

| まとまり | ページ | 行数 | 使っている部品と記法 |
|---|---|---|---|
| はじめに | ASTAROTとは（`guide/introduction`） | 30 | `{.feature-rows}` |
| | インストール（`guide/install`） | 137 | `CopyText`×5、`Term`×2 |
| | 動作環境と推奨スペック（`guide/requirements`） | 97 | `Term`×2 |
| | 対応環境と検証の範囲（`guide/support`） | 88 | 表 |
| | 最初の設定（`guide/first-setup`） | 79 | `StepProgress`、`CopyText`×2、画像×2 |
| | 声と文字の流れ（`guide/how-it-works`） | 69 | `OsTabs`、図（SVG）×2 |
| やりたいこと | やりたいことから探す（`guide/tasks`） | 109 | `[[toc]]`、`{.needs}`×8 |
| | 自分のモデルを使う（`guide/custom-models`） | 144 | `Term` |
| 声と文字の機能 | 翻訳（`features/translation`） | 55 | 経路の帯 |
| | 音声認識（ASR）とリアルタイム字幕（`features/transcription`） | 130 | 経路の帯、画像×2 |
| | テキスト読み上げ（TTS）（`features/tts`） | 105 | 経路の帯、`OsTabs`、`Term` |
| | ボイスチェンジャー（RVC）（`features/voice-conversion`） | 109 | 経路の帯、`OsTabs` |
| | チャット読み取り（OCR）（`features/chat-reading`） | 69 | 経路の帯 |
| 画面と連携 | 字幕とVR（`features/vr`） | 59 | 画像×3 |
| | 入力と出力（`features/io-flow`） | 72 | 画像×3 |
| | 入力の小窓とホットキー（`features/quick-chat`） | 40 | 画像 |
| | OBSとWebSocket（`features/integrations`） | 47 | 画像×2 |
| 設定と運用 | モデルの取得（`guide/models`） | 97 | `CopyText`×2 |
| | Windowsの音声経路（`guide/windows-audio`） | 50 | 経路の帯 |
| | Linuxの音声経路（`guide/linux-audio`） | 47 | 経路の帯、`CopyText` |
| | 困ったとき（`guide/troubleshooting`） | 98 | `CopyText`、`Term`×2 |
| | プライバシー（`guide/privacy`） | 69 | 画像 |
| | ライセンスと謝辞（`guide/license`） | 29 | — |

注記にはVitePressのカスタムブロック（`::: info`、`::: tip`、`::: warning`、`::: details`）を使っています。日本語のページでは13ページにあり、全体で`warning`が8個、`details`が6個、`info`が4個、`tip`が1個あります。`danger`は使っていません。上部のナビゲーションは「ガイド」「インストール」「困ったとき」の3つです。

### マニュアルの10章

章の一覧は`site/.vitepress/theme/manual/content.mjs`の`CHAPTERS`にあります。各章はガイドのページへのリンクを持ち、状態は`guide`（ガイドで読める）が9章、`pending`（準備中）が1章（画面と操作）です。

| 章 | リンクしているガイドのページ |
|---|---|
| はじめに | ASTAROTとは、動作環境と推奨スペック、対応環境と検証の範囲 |
| インストールと最初の設定 | インストール、最初の設定 |
| 画面と操作（準備中） | 声と文字の流れ、入力の小窓とホットキー |
| 翻訳 | 翻訳 |
| 音声認識と字幕 | 音声認識（ASR）とリアルタイム字幕 |
| 読み上げと声の変換 | テキスト読み上げ（TTS）、ボイスチェンジャー（RVC） |
| チャット読み取り | チャット読み取り（OCR） |
| 音声経路とVR | 入力と出力、Windowsの音声経路、Linuxの音声経路、字幕とVR |
| モデルとほかのアプリとの連携 | モデルの取得、自分のモデルを使う、OBSとWebSocket |
| 困ったときは | 困ったとき、プライバシー、ライセンスと謝辞 |

どの章からもリンクしていないガイドのページは「やりたいことから探す」だけです。

マニュアルのページは日本語でビルドし、スクリプトが動いたあとで、その場で英語に切り替えます（`manual/locale.ts`）。言語は`?lang=`、保存した言語、ブラウザの言語の順に決めます。

### 外から参照されているURL

次のURLは、配布済みのアプリ、README、SUPPORT.mdが開くか、公開してから時間がたっているものです。配布済みのアプリは書き換えられないので、再設計のあとも同じURLで同じ内容を開く必要があります。

| URL（`https://kein5.github.io/astarot`の下） | 参照しているところ |
|---|---|
| `/ja/`、`/en/` | アプリ（`src-ui/logics/ui_configs.ts`の`vrct_document_home_url`）、SUPPORT.md |
| `/<言語>/guide/troubleshooting` | アプリ（`vrct_document_url_chunk_faq`）、SUPPORT.md |
| `/<言語>/guide/first-setup` | アプリ（`vrct_document_url_chunk_ui_guide`） |
| `/<言語>/guide/custom-models`と`#tts`、`#asr`、`#whisper-server`、`#rvc`、`#seed-vc`、`#translation` | アプリの各モデルの欄（`vrct_document_url_chunk_custom_models`） |
| `/<言語>/guide/requirements`、`/<言語>/guide/support` | README.md、`docs/readmes/README.ja.md` |
| `/manual/`、`/manual/<章>` | リポジトリの中からのリンクはありません。0.5.0から公開しているので（#372）、ブックマークや検索エンジンから来る読み手がいる可能性があります |

アプリが外部のURLを開けるのは`https://kein5.github.io/astarot/**`だけです（`src-tauri/capabilities/vrct_capability.json`）。

## テーマのカスタマイズ（`site/.vitepress`）

### 設定（`config.mts`）

- 日英の`locales`、サイドバー、上部のナビゲーション、フッター、404ページの文言
- ローカル検索。`searchTokenize.mjs`で日本語の文中の語を切り出し、索引を作るときと検索するときに同じ切り方を使います
- 見出しのid（`slugify.mjs`）。濁点を分解しないので、日本語の見出しへのリンクが見つかります
- 画像の描画の上書き。ページの画像にはすべて`data-zoom`を付け、押すと大きく表示します
- `appearance: 'force-dark'`。ダークだけで、ライトの配色はありません
- `transformPageData`でマニュアルのページだけタイトルとfaviconを替え、`transformHead`で言語の転送のスクリプトと`hreflang`を足します
- Viteのaliasで、VitePressの`VPLocalSearchBox.vue`を自前の`LocalSearchBox.vue`に差し替えます

### テーマ（`theme/index.ts`）

VitePressの既定のテーマ（`vitepress/theme-without-fonts`。同梱のInterを外したもの）を広げ、レイアウトのスロットに自前の部品を差し込んでいます。

| スロット | 差し込む部品 |
|---|---|
| `home-hero-info-after` | `HomeActions`（ダウンロードのボタンともう1つのボタン） |
| `home-hero-after` | `HomeShot`（メイン画面のスクリーンショット） |
| `home-features-before` | `HomeShowcase`（5つの機能と動画） |
| `doc-before` | `RouteStrip`（機能のページの先頭の経路の帯） |
| `layout-bottom` | `TermTooltip`（ページの`Term`が共有する吹き出し） |

Markdownから使える部品として`StepProgress`、`OsTabs`、`CopyText`、`Term`、`ManualCallout`を登録しています。ほかに、画像を大きく表示するダイアログと、ナビゲーションの言語メニューで選んだ言語を保存する処理を、文書全体のイベントで受けています。

## 部品の一覧

行数は`.vue`のファイル全体（スクリプト、テンプレート、スタイル）です。

### ガイドの部品

| 部品 | 行数 | 役割 | 使っているところ |
|---|---|---|---|
| `HomeActions.vue` | 52 | ヒーローのボタンの列。`DownloadButton`とVitePressの`VPButton`を並べる | トップ |
| `HomeShot.vue` | 14 | ヒーローの下のスクリーンショット | トップ |
| `HomeShowcase.vue` | 180 | 5つの機能と動画。画面に入っている間だけ再生し、動きを減らす設定では静止画を出す | トップ |
| `RouteStrip.vue`（と`routes.ts`） | 137 | 機能のページの先頭に、声と文字が通る経路を出し、そのページの段を光らせる。「自分から相手へ」を青、「相手から自分へ」を紫で描く | 7ページ |
| `components/DownloadButton.vue` | 502 | OSに合うファイルを最新のリリースから選ぶボタンと、すべてのファイル、すべての版、ソースコードを並べたメニュー | トップ |
| `components/StepProgress.vue` | 352 | 番号付きの手順の見出しから手順の一覧を作り、スクロールすると細いバーにして上に残す | 最初の設定 |
| `components/OsTabs.vue` | 165 | WindowsとLinuxで違う手順を切り替える。選んだOSは全ページで共有し、保存する | 3ページ |
| `components/CopyText.vue` | 148 | フォルダーやアドレスにコピーのボタンを付ける | 5ページ |
| `components/Term.vue`、`TermTooltip.vue`（と`tooltip.ts`） | 108、127 | 用語に短い説明の吹き出しを付ける。マウス、フォーカス、タップで開く | 5ページ |
| `components/LocalSearchBox.vue` | 1,019 | VitePress 1.6.4の`VPLocalSearchBox.vue`を写して直した検索のパレット。何も入力していないときはサイドバーのページを並べる | 全ページ |

### マニュアルの部品

| 部品 | 行数 | 役割 |
|---|---|---|
| `manual/ManualShell.vue` | 309 | マニュアルの外枠。上のバー（名前、目次の絞り込み、言語、GitHub）、本文、フッター |
| `manual/ManualHome.vue` | 828 | トップ。ヒーローとマスコット、3つの手順、10章の目次、5つの柱、案内役の8つの表情とコールアウトの凡例、動作環境とサポート |
| `manual/ManualChapter.vue` | 215 | 章のページ。準備中の注記、関連するガイドのページ、前後の章 |
| `manual/ManualCallout.vue` | 81 | 6種類の囲み（補足、ヒント、大事、注意、警告、うまくいかないとき）。種類ごとにマスコットの表情を付ける。使っているのはトップの凡例だけで、本文のページでは使っていません |
| `manual/ManualDownload.vue` | 342 | ダウンロードのボタンと、7種類の配布形式を固定の枠で並べるメニュー |
| `manual/ManualLangMenu.vue` | 176 | 言語のメニュー。ページを移らずに文言を切り替える |
| `manual/useMenu.ts` | 80 | メニューのボタンのキーボード操作（矢印、Home、End、Esc） |
| `manual/content.mjs` | 486 | マニュアルの日英の文言と章の一覧 |

### 共有しているモジュール

`releases.mjs`（配布ファイルの読み分け）と`latestRelease.ts`（最新のリリースの取得）は、2つのダウンロードのボタンが共有しています。`locale.ts`（`/`が開く言語）はガイドとマニュアルが共有しています。

## 色、文字、動きの現状

### 3つの配色が並んでいる

| 場所 | 配色 | 定義しているところ |
|---|---|---|
| ガイド（`/ja/`、`/en/`） | 紺と青。地は`#111b2c`、ボタンは`#2865dc`、リンクは`#80acff`。ダークだけ | `theme/custom.css`の`--vp-c-*`と`--vox-*` |
| マニュアル（`/manual/`） | Dark Plum、Lilac、Off-White。OSの設定に合わせてライトとダークを切り替える | `theme/manual/manual.css`の`--a-*` |
| アプリ | Dark Plum、Lilac、Off-White。ダークだけ | DESIGN.mdの`colors`、`src-ui/views/app/_index_css/variables.css` |

アプリの配色は2026-11-18に紺からDark PlumとLilacに移りました（DESIGN.mdの「Overview」）。ガイドの配色は2026-11-15に「アプリと同じDark Studio」として決めたもので（DESIGN.mdの「The user guide (site/)」）、アプリが移ったあとも紺のままです。同じ紺は`site/motion/src/theme.ts`（動画）と`site/public/diagrams/`（声と文字の流れの図）にもあります。スクリーンショット（`site/public/screenshots/`）も紺の画面を撮ったものです。

OKLCHの色相で比べると、ガイドの地とボタンは約261°、Dark Plumは308°、Lilacは297°です。

マニュアルのライトの配色は、DESIGN.mdの「Colors」の規則（ブランドの色から明度だけを変え、色相の差は3°以内、彩度は元の色を超えない）で作ったものではありません。2026-11-19に計算した結果は次のとおりです。

| トークン | 値 | 規則との差 |
|---|---|---|
| `--a-link`（リンク、重要の囲み） | `#6a3fd2` | 色相290.1°でLilacから7°離れ、彩度0.212がLilacの0.178を超えます。地（`#fafafc`）に対するコントラストは6.19:1です |
| `--a-trouble`（うまくいかないときの囲み） | `#8a4a9e` | 色相317.6°でDark Plumから9.5°離れます |
| `--a-border`（検索欄の枠） | `#e4ddee` | 地に対して1.27:1です。DESIGN.mdは入力欄の枠に、欄の塗りに対して3.5:1、置かれた地に対して3:1を求めています |

本文の文字（`--a-text`、`--a-text-2`、`--a-text-3`）は、地と`--a-bg-soft`のどちらに対しても4.5:1以上あります。

### 文字

| 場所 | 本文 | 見出し |
|---|---|---|
| ガイド | 読み手のPCの書体（システムのUI書体、Noto Sans JP、ヒラギノ、BIZ UDPゴシック、Yu Gothic UI、メイリオ）。16 px | 本文と同じ書体。h1は30 px、h2は22 px、h3は18 px。トップの製品名は52 pxから96 px |
| マニュアル | `system-ui`から始まる別の並び。16 px、行の高さ1.75 | Outfitが入っているPCだけOutfit。入っていなければ本文と同じ書体 |
| アプリ | 利用者が選んだUI書体。1.2 remから2.4 remの8段（アプリの1 remは10 px） | 同じ段から選ぶ |

どちらもウェブフォントは読み込みません。ガイドのh2（22 px）は、アプリの文字の段（12、13、14、15、16、18、20、24 px）にない大きさです。

### 角丸と動き

| 場所 | 角丸 | 動きの時間 |
|---|---|---|
| ガイド | `custom.css`はおもに8 px（アプリの`control`）。部品の中には10 px（5か所）、7 px、6 px、5 px、14 pxもある | 140 msと240 ms |
| マニュアル | おもに14 px（`--a-radius`）。ほかに18 px、12 px、10 px、8 px、7 px、6 px、5 px、丸い端（999 px） | 140 ms |
| アプリ | 2、4、8、12 pxの段。ほかはバーや溝の丸い端だけ | 120 msと220 ms |

部品のスタイルに直接書いた色もあります。フォーカスの色`#a9ccff`は、ガイドの部品の中で7回書かれています。

## 情報の置き方の問題

番号は[再設計の提案](README.md)から参照します。

### P-01 同じ内容に入口と目次が2つある

ガイド（23ページ、サイドバーの5つのまとまり）とマニュアル（10章）が、同じ内容を別の目次で並べています。マニュアルの章には本文がなく、どの章もガイドのページへのリンクを置くだけです。読み手はどちらが正本か分かりません。ガイドの上部のナビゲーションからはマニュアルへ行けず、マニュアルのフッターはガイドを「以前のガイド」と呼んでいます。本文があるのはガイドのほうです。

### P-02 トップのページが2つあり、事実を二重に持っている

`/ja/`のトップと`/manual/`のトップは、どちらもダウンロードのボタンと機能の紹介を持っています。マニュアルのトップは、動作環境（OSの条件、GPUの条件）とダウンロードの7種類の配布形式を`content.mjs`に自分で持っています。同じ事実はガイドの「インストール」と「動作環境と推奨スペック」にも書かれています。

二重に持った事実は、片方だけが直されます。たとえば#673は0.6.0でWindowsの配布物を1つにする変更をガイドのページに反映しますが、`content.mjs`の7種類の枠（「ZIP（CUDA版）」を含む）は変えていません。また、`content.mjs`は「字幕とVR」のページを「VRとオーバーレイ」と呼んでいます。アプリの設定のページは2026-11-18に「字幕とVR」に改名され、ガイドのサイドバーはこの名前です。

### P-03 言語の切り替え方が2通りある

ガイドは言語ごとに別のURL（`/ja/…`と`/en/…`）を持ち、`hreflang`で対応を示します。マニュアルは日本語のHTMLだけをビルドし、スクリプトで英語に切り替えます。そのため、JavaScriptが動かない読み手と検索エンジンには英語のマニュアルが見えません。マニュアルのページには`hreflang`もありません。

### P-04 検索が2通りある

ガイドの検索は、全ページの本文を対象にしたパレットです（VitePressのローカル検索、日本語の文中の語にも対応）。マニュアルの検索窓は章の題、要約、キーワードだけを絞り込みます。マニュアルのページは`search: false`で、ガイドの検索の対象からも外れています。

### P-05 見た目がアプリともマニュアルともそろっていない

「3つの配色が並んでいる」のとおりです。ガイドはダークだけで、マニュアルはOSに合わせてライトとダークを切り替えます。スクリーンショット、動画、図も紺のままです。

### P-06 同じ役割の部品が2つずつある

| 役割 | ガイド | マニュアル |
|---|---|---|
| ダウンロードのボタン | `DownloadButton.vue`（502行。最新のリリースのファイルをOSごとに並べ、すべての版とソースコードへのリンクを付ける） | `ManualDownload.vue`（342行。7種類の配布形式を固定の枠で並べ、ないものは「この版にはありません」と出す） |
| 言語の切り替え | VitePressのナビゲーションの言語メニュー（別のURLへ移る） | `ManualLangMenu.vue`（その場で切り替える） |
| 囲み | VitePressのカスタムブロック（`custom.css`で色を変えている） | `ManualCallout.vue`（6種類、表情付き） |
| メニューのキーボード操作 | `DownloadButton.vue`の中に自前で持つ | `useMenu.ts` |

### P-07 マスコットがマニュアルのトップにしかいない

マスコット（悪魔ペンギン）はマニュアルのトップのヒーローと案内役の節にだけいます。トップで「表情を見ればその場面で何に気をつけるかが分かる」と説明していますが、表情付きの囲み（`ManualCallout`）を使っている本文はありません。ガイドのページにはマスコットが出てきません。

### P-08 サイドバーのまとまりがアプリの設定と違い、最初の設定までが遠い

- 「はじめに」に6ページあり、動作環境と対応環境の表（調べるときに読むもの）が「最初の設定」より前にあります。初めての読み手がメッセージを送れるまでに、間に参考の表を2つ挟みます。
- 「やりたいこと」は2ページだけです。「自分のモデルを使う」は「モデルの取得」（設定と運用）と離れています。
- 「設定と運用」に、モデル、音声経路、困ったとき、プライバシー、ライセンスが並んでいます。音声経路のページは「入力と出力」（画面と連携）とも離れています。
- 機能のまとまりは、アプリの設定のメニューのまとまり（会話の基本、声と読み取り、使い心地、アプリ。DESIGN.mdの「Layout」、#554）と違います。アプリとガイドを見比べる読み手は、同じ機能を別のまとまりで探すことになります。

### P-09 上部のナビゲーションから行けるところが少ない

上部のナビゲーションは「ガイド」「インストール」「困ったとき」だけです。ダウンロードのボタンはトップにしかなく、リリースノートへのリンクもありません。

### P-10 画面の言葉の規則に合わない文がある

DESIGN.mdの「Words」は、利用者のPCを「お使いのPC」と書くか、PCを省くと決めています（#437）。2026-11-19の時点で、この規則に合わない言い方が日本語のページでは7ページに15か所、英語のページでは5ページに9か所あります。英語の "this computer" も読み手のPCを書き手の側から指す言い方で、これを含めると英語は8ページに16か所です。

### P-11 VitePressの内部に頼っている部分がある

- `LocalSearchBox.vue`は、VitePress 1.6.4の内部のファイル（`vitepress/dist/client/…`）をimportする写しです。VitePress 2では元のファイルが約410行変わっていて（#690）、上げるときに合わせ直す必要があります。
- `StepProgress.vue`は`.VPNav`と`.VPLocalNav`の位置を読み、`custom.css`は`.VPSidebarItem`、`.VPHero`などの既定のテーマのクラスを上書きしています。

### P-12 文言の置き場所が散らばっている

ガイドの部品の文言は、`config.mts`（ナビゲーション、サイドバー、検索）、各部品の中の`WORDS`（`DownloadButton`、`CopyText`、`StepProgress`）、`routes.ts`に分かれています。日英のキーがそろっているかを確かめる検査は、マニュアルの`content.mjs`にだけあります（`check_site_manual.mjs`）。
