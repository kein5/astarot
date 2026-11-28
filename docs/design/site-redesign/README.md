# Redesign proposal for the manual site

[日本語版](#マニュアルサイトの再設計の提案日本語版)

This is a design for reworking how the user-facing site (`site/`) is built. It merges the guide and the manual into one site, brings the look in line with the app's ASTAROT palette, and rebuilds the components after the design of shadcn/ui. The rework is split into 9 stages, not one large PR.

- Status: the approach is decided (2026-11-19). The overall direction, the order of the stages and S-01 to S-11 all went to option A, the one this document recommended ([Decisions made](#decisions-made)). Implementation proceeds in order from stage 1 of section 5. On 2026-11-20 it was decided to move the site's base from VitePress to Rspress (React) ([ADR-016](../../adr/adr-016-user-guide-site-on-rspress.md)). "Base" was added to the table of decisions, and sections 2, 3 and 5 were brought in line with Rspress. Moving the base was added as stage 2, so the earlier stages 2 to 8 became stages 3 to 9. Stage 2 went in with #761. On 2026-11-22 stage 3 (tokens) was implemented. Of the light values in 3.2, `primary-hover` became `#9c72ec`, one step lower in chroma, after a check was added. Rspress draws `--rp-c-brand` as text, so it was mapped to `state-active`, not `primary`.
- Basis: [the inventory](inventory.md). Problem numbers (P-01 and so on) are the inventory's numbers.
- Related: #371 (creating the manual), #554 (the app's information architecture), #680 (the policy of aligning components with shadcn/ui), #673 (updating the guide for 0.6.0), #690 (the site's Vite)

## What was already decided when the review began

- The base stays VitePress. The Japanese and English structure, search and the publishing to GitHub Pages stay in use. On 2026-11-20 it was decided to move the base to Rspress (React) (ADR-016). Keeping the Japanese and English structure, search and publishing to GitHub Pages does not change.
- The components are rebuilt as our own Vue components modeled on the design of shadcn/ui. shadcn-vue is not added. From 2026-11-20 the components are written in React.
- Colors use the ASTAROT brand tokens. The sources of truth are DESIGN.md and `docs/brand/`. The visual vocabulary matches the app's settings screen.
- A new model of the animated mascot (the devil penguin) has been finished in separate work. It goes into the site only after this design is settled. This document gives only the candidate places for it and the approach to building it in.

## The approach in brief

1. The guide and the manual become one. The guide pages (under `/ja/` and `/en/`) hold the source of truth for the text, and the layout of the manual's home page approved in #371 moves to the site's home page. `/manual/` becomes a redirect page (P-01, P-02, P-03, P-04).
2. URLs do not change. The page files stay where they are; only the sidebar and the navigation are rearranged. Every URL that released versions of the app open ([inventory](inventory.md#外から参照されているurl)) opens the same content.
3. The names of the sidebar groups match the groups of the app's settings menu (#554) (P-08).
4. DESIGN.md's tokens are the source of truth for color. Dark uses the same values as the app, and light uses values made by the same rule. The navy palette leaves the site (P-05).
5. Components are built in `site/.vitepress/theme/ui/`, with the same names and `data-slot` values as shadcn/ui's components. Components that come in pairs become one (P-06).
6. Every stage is merged in a state that can be published on its own, because changes merged into develop are published as they are.

## 1. Information architecture

### 1.1 Approach

- Each fact is written on one page only. The home page does not copy facts from other pages; it carries summaries and links (P-02).
- URLs and order are handled separately. URLs are referenced from outside, which makes them a promise, so they do not move. The order shown to readers is set by the sidebar.
- Pages are grouped in the app's words. A reader who compares the guide with the app's settings can look for a feature under the same group names.
- The pages a first-time reader goes through before sending a first message are kept short. Reference tables move to where they are read when they are needed.

### 1.2 Sidebar

| Group (English / Japanese) | Pages (in this order) | Current groups |
|---|---|---|
| Getting started / はじめに | What is ASTAROT, Install, First setup, Find what you want to do, How voice and text flow | Getting started, What you want to do |
| Conversation / 会話の基本 | Translation, Speech recognition (ASR) and realtime captions, Captions and VR, Quick Chat and hotkeys | Voice and text, Screens and integrations |
| Voice and reading / 声と読み取り | Text to speech (TTS), Voice changer (RVC), Chat reading (OCR) | Voice and text |
| Audio routes and other apps / 音声経路と連携 | Inputs and outputs, Windows audio route, Linux audio route, OBS and WebSocket | Screens and integrations, Setup and operation |
| Models / モデル | Model downloads, Use your own models | Setup and operation, What you want to do |
| Help and reference / 困ったときと資料 | Troubleshooting, System requirements, Platform support, Privacy, License and credits | Getting started, Setup and operation |

- "Conversation" and "Voice and reading" are names of groups in the app's settings menu (DESIGN.md's "Layout"). The app's "Conversation" also holds the VRChat page. The guide describes the OSC settings in "First setup", so this group does not include that page.
- In the app, the hotkey settings are in the "Ease of use" group. The guide's "Quick Chat and hotkeys" is mostly about the small window for sending text in the middle of a conversation, so it goes in "Conversation".
- The system requirements and platform support tables move to "Help and reference" and are linked from the top of "Install" and from the home page. A first-time reader can send a first message after three pages: "What is ASTAROT", "Install" and "First setup".
- "Use your own models" sits beside "Model downloads". Both are pages about preparing model files.
- The audio route pages sit beside "Inputs and outputs". This carries over the thinking of the manual's "Audio routes and VR" chapter.

### 1.3 Top bar

From left to right:

1. The ASTAROT icon and name (to the home page in the page's language)
2. Search (a button that opens the palette; `Ctrl`+`K` and `/` open it too)
3. "Install", "Find what you want to do", "Troubleshooting"
4. "Release notes" (to GitHub Releases, with a mark showing that it leads to another site)
5. The language menu (日本語, English)
6. GitHub

The download button goes at the top of the "Install" page as well as in the home page's hero (P-09). Both are the same component (`DownloadButton` in 2.3). On narrow screens, items 3 to 6 are gathered into Rspress's menu button.

### 1.4 Home page

The home pages at `/ja/` and `/en/` are laid out in this order.

| Order | Section | Content | Based on |
|---|---|---|---|
| 1 | Hero | The icon and wordmark, a two-sentence introduction, the download button, a button to "First setup", the rename note, the mascot | The manual's hero (#371), the guide's `HomeActions` |
| 2 | The app's screen | A screenshot of the main screen | The guide's `HomeShot` |
| 3 | Three steps | "Download and install", "Connect to VRChat", "Send something". The steps lead to "Install", "First setup" and "Translation" in turn | The manual's quick start |
| 4 | What it does | Five features. Each has a video, a two-sentence description and a link to its page | The guide's `HomeShowcase` |
| 5 | Contents | The sidebar's six groups as cards, with links to each page | The manual's contents of 10 chapters |
| 6 | Looking things up | Links to system requirements, platform support, troubleshooting, bug reports, release notes and privacy | The manual's "System requirements" and "Support" |

- Section 6 carries no version numbers or numeric conditions. Numbers are written only in "System requirements" and "Platform support". The system requirements and the list of seven file kinds that the manual's home page kept in `content.mjs` go away (P-02).
- The "Filter the chapters" box on the manual's home page goes away, because the site-wide search (the palette) searches the text as well (P-04).
- The manual's "five pillars" (a description for each word of the subtitle) and its "Your guide" and "Reading the callouts" sections leave the home page. The subtitle stays in the wordmark, and how to read the faces and callouts goes at the end of "What is ASTAROT" (S-05).

The language selection page at `/` keeps its current behavior; only its look moves to the new tokens.

### 1.5 Handling of `/manual/`

`/manual/` and the 10 chapter pages become redirect pages that send the reader to the matching guide page. GitHub Pages cannot set up server-side redirects, so the redirect pages are built as follows.

- Each has a `<link rel="canonical">` that points to the destination.
- A script in `<head>` picks the language the same way `/` does (`preferredLocale()` in `theme/locale.ts`) and moves there. When JavaScript does not run, a `<meta http-equiv="refresh">` inside `<noscript>` moves to the Japanese page. The current manual's HTML is in Japanese, so this sends the reader to a page in the same language.
- The body also carries a link to the destination.

| Manual path | Destination (under `/<language>/`) |
|---|---|
| `/manual/` | Home page |
| `/manual/introduction` | `guide/introduction` |
| `/manual/install` | `guide/install` |
| `/manual/screens` | `guide/how-it-works` |
| `/manual/translation` | `features/translation` |
| `/manual/speech` | `features/transcription` |
| `/manual/voice` | `features/tts` |
| `/manual/chat-reading` | `features/chat-reading` |
| `/manual/audio-and-vr` | `features/io-flow` |
| `/manual/models` | `guide/models` |
| `/manual/help` | `guide/troubleshooting` |

`tools/check_site_manual.mjs` is rewritten into a check that the redirect pages go to the destinations in the table above and that the destination pages are built in both Japanese and English. The redirect pages stay with no end date (S-08).

### 1.6 Page types

Pages fall into four types, and each type puts the same things at its start and at its end. The text is rewritten bit by bit in per-feature PRs; this table is the shape those PRs bring the pages to.

| Type | Pages | At the start | At the end |
|---|---|---|---|
| How-to | Install, First setup, Windows audio route, Linux audio route | What you need (`Alert`), the list of steps (`StepProgress`) | Pages to read next |
| Feature | The 9 pages in `features/` | The route strip (now on the 5 pages of the voice and text features), what you need | How to check when it does not work, related pages |
| Finding | Find what you want to do, Troubleshooting | An in-page table of contents | — |
| Reference | System requirements, Platform support, Privacy, License and credits | The date written and the version covered | — |

## 2. Components

### 2.1 Rules for building them

- They live in `site/theme/ui/`. As in shadcn/ui, one component is written in one `.tsx` file, and its parts are exported by name (`Card`, `CardHeader`, `CardTitle` and so on). shadcn/ui's React code is copied over, translated by the rules in DESIGN.md.
- The root element of each part carries a `data-slot` with the same name as in shadcn/ui (`card`, `card-header` and so on).
- Visual variants come in through the `variant` and `size` props. How the styles are written (CSS Modules, or vanilla-extract's `recipe()` as in the app) and whether the site shares components with the app's `src-ui/views/kit/` are decided in stage 4 (section 7 of ADR-016). Either way, colors, radii, spacing, text sizes and motion use only the tokens of section 3, and a check confirms that no component file holds a color value written directly.
- Keyboard handling (menus, tabs, tooltips, dialogs) is gathered into our own hooks. The starting point is `OsTabs`, `Term` and the menu handling that stage 2 carried over to React. Native elements (`<button>`, `<dialog>`, `<details>`) come first. No headless component library is added (S-09).
- The components' strings are gathered in `theme/i18n/ja.ts` and `theme/i18n/en.ts`, and a check confirms that the Japanese and English keys and interpolation variables match (P-12).
- CSS features that are Baseline Widely available are used as they are; newer ones are used only with `@supports` and a fallback. The UI rules of AGENTS.md apply to the site as well. The site opens in the reader's browser, so it is built on the assumption that it can be read in Chrome, Edge, Firefox and Safari.
- Translating shadcn/ui follows the rules in DESIGN.md's "Components". The site's 1 rem is 16 px, the same as Tailwind, so shadcn/ui's lengths can be read as they are (the app's 1 rem is 10 px). Colors do not take shadcn/ui's values; they are replaced with ASTAROT tokens through the mapping in 3.2. Where shadcn/ui and DESIGN.md differ (the roles of buttons, the focus ring), DESIGN.md is followed.
- The shadcn/ui section of NOTICE.md is written to cover "the app's components". The first PR that aligns the site's components adds that the site's components are covered too.

### 2.2 Base components (`theme/ui/`)

| Component | Role | shadcn/ui component it follows | What it replaces |
|---|---|---|---|
| `Button` | Buttons for actions and links. Variants `primary`, `plain`, `quiet`, `link`; sizes `sm`, `default`, `lg`, `icon`. Given `href`, it renders an `<a>` | Button. Renders by `href` in place of `asChild` | The buttons in the home page's hero (now `HomeActions`), the manual's `.secondary` and `.more` |
| `ButtonGroup` | Makes the main button and the button that opens a menu look like one pair | Button Group | The download button pair |
| `Badge` | A short status mark (recommended, experimental feature) | Badge | `.chip` in the manual's contents, "Recommended" in the menu |
| `Kbd` | Key names | Kbd, KbdGroup | How keys are written in the text, the `/` in the search box |
| `Card` | One unit of content in a frame | Card (Header, Title, Description, Action, Content, Footer) | The features and contents on the home page, the manual's related pages and previous and next chapters |
| `Item` | A row with a name, a one-line description and a destination | Item (Media, Content, Title, Description, Actions), ItemGroup | `{.feature-rows}`, the support list |
| `Alert` | Callouts in the text | Alert (Title, Description) | Markdown callouts (`:::`), `ManualCallout`, `{.needs}` |
| `Separator` | A dividing line | Separator | The line to the right of h2, separators in the bar |
| `Spinner` | A loading mark | Spinner | The download button's display while it checks |
| `DropdownMenu` | A menu that opens from a button | Dropdown Menu (Trigger, Content, Label, Group, Item, RadioGroup, RadioItem, Separator) | The two download menus, `ManualLangMenu`, `useMenu` |
| `Tabs` | Switches content in the same place | Tabs (List, Trigger, Content) | The switching in `OsTabs` |
| `Tooltip` | A short explanation of a term | Tooltip. Opening and closing on tap follows Popover | `Term`, `TermTooltip` |
| `Dialog` | A window that opens over the page | Dialog | Enlarged screenshots, the frame of the search palette |
| `InputGroup` | Puts an input and an icon or button in one frame | Input Group (Addon, Button, Input) | `CopyText`, the button that opens search |
| `Command` | The contents of the search palette | Command (Input, List, Empty, Group, Item, Shortcut) | The look of `LocalSearchBox` |
| `Empty` | What shows when there is nothing | Empty (Media, Title, Description, Content) | No search results, the 404 page |
| `Breadcrumb` | Which group a page is in | Breadcrumb | The manual's "Back to contents" |
| `Collapsible` | A fold (extra detail folded away) | Collapsible. Drawn with the native `<details>` | `::: details` |
| `Table` | Tables | Table. Styles Markdown tables | Tables in `.vp-doc` |

`Alert` comes in GitHub's five kinds (note, tip, important, warning, caution) plus the fold, and each kind gets a mascot face (S-06). How a callout is written in Markdown (keep the current `::: warning`, or move to GitHub's `> [!NOTE]` form) was not decided in S-06, so it is treated as a decision needed in the stage 4 PR. Whichever form is used, Markdown callouts are drawn with `Alert`.

### 2.3 Site components (`theme/components/`)

| Component | Built from | What it replaces |
|---|---|---|
| `DownloadButton` | `ButtonGroup`, `DropdownMenu`, `Badge`, `Spinner` | `DownloadButton.vue` and `ManualDownload.vue`. The menu lists, by OS, only the files in the latest release, with links to all versions and to the install steps. The manual's seven fixed slots go away (P-02) |
| `OsTabs` | `Tabs` and the OS choice shared across all pages (`os.ts`) | `OsTabs.vue`. It keeps the current approach of leaving both contents in the page so that search finds them |
| `Term` | `Tooltip` | `Term.vue`, `TermTooltip.vue` |
| `CopyText` | `InputGroup`, `Button` | `CopyText.vue` |
| `Callout` | `Alert` and a mascot face for each kind (S-06) | `ManualCallout.vue`, the custom blocks |
| `StepProgress` | Our own. shadcn/ui has no matching component | `StepProgress.vue`. Its colors and motion move to tokens |
| `RouteStrip` | Our own | `RouteStrip.vue`. It does not color by direction; it marks only this page's step in Lilac (S-04) |
| `FeatureShowcase` | `Card` and videos | `HomeShowcase.vue` |
| `QuickStart` | Numbered `Card`s | The manual's quick start |
| `ContentsGrid` | `Card`, `Item` | The manual's contents |
| `MascotStage` | Our own (section 4) | The mascot in the manual's hero |
| `ShotZoom` | `Dialog` | `zoom()` in `theme/index.ts` |
| `PagePager` | `Card`, following the previous and next links of shadcn/ui's Pagination | The theme's previous and next page links, the manual's previous and next chapters |

The "What it replaces" column gives the names of the Vue components as of 2026-11-19. Stage 2 first carries them over to React components with the same roles. Stages 4 and 5 rebuild them on top of the base components of 2.2.

### 2.4 Components of the Rspress default theme

The top bar, the sidebar, the in-page table of contents, the narrow-screen menu and the search screen keep using the components of Rspress's default theme, and tokens and a minimum of CSS match their look. Our own components go into the layout slots (`afterHeroActions`, `afterHero`, `beforeDocContent`, `bottom` and others). The shadcn/ui components they follow are these.

| Rspress component | shadcn/ui component it follows |
|---|---|
| `Nav` (the top bar) | Navigation Menu |
| `Sidebar` | Sidebar (Group, GroupLabel, Menu, the selected state of MenuButton) |
| `Outline` (the in-page table of contents) | The small size of Sidebar |
| `NavHamburger` (narrow screens) | Sheet |
| `SearchPanel` (the search screen) | Command, Empty |

Rspress components are not copied and modified (`rspress eject`), because a copy has to be brought back in line every time Rspress is upgraded. The copy of VitePress's search (`LocalSearchBox.vue`, P-11) goes away in stage 2.

## 3. Color and type tokens

### 3.1 Layers

Tokens are kept in three layers.

1. Brand colors: Dark Plum `#261633`, Lilac `#A47AF5`, Off-White `#FAFAFC`, White (`docs/brand/README.md`).
2. Role tokens: the names of DESIGN.md's `colors` with `--a-` in front (`--a-canvas`, `--a-surface` and so on). Components use this layer only. `--a-` is the prefix of the current manual's tokens.
3. Rspress variables (`--rp-c-*`): they take their values from the role tokens. Through this layer, the components of Rspress's default theme get the same palette.

The dark values are DESIGN.md's `colors` as they are. So that copying values from DESIGN.md cannot introduce mismatches, `tools/site_tokens.mjs` writes the dark values of `site/theme/tokens.css` from DESIGN.md's front matter, and the Pages workflow runs it with `--check` (S-02).

### 3.2 Color mapping

The light values are a proposal made by the rule in DESIGN.md's "Colors". Where the brand has a color that fits the role, it is used as it is; otherwise only the lightness of Dark Plum or Lilac changes (OKLCH hue within 3°, chroma no higher than the original's). The contrast values were calculated on 2026-11-19 and are against the canvas, the surface and the rail.

| DESIGN.md name | Site token | shadcn/ui role | Rspress variable (proposed) | Dark (DESIGN.md) | Light (proposed) |
|---|---|---|---|---|---|
| `canvas` | `--a-canvas` | `background` | `--rp-c-bg` | `#261633` | `#fafafc` (Off-White) |
| `rail` | `--a-rail` | `sidebar` | `--rp-c-bg-soft` | `#1c0f27` | `#f6f1fa` (Dark Plum, lightened) |
| `surface` | `--a-surface` | `card`, `popover` | `--rp-c-bg-mute` | `#332341` | `#ffffff` (White) |
| `border` | `--a-border` | `border` | `--rp-c-divider-light` | `#4e3d5d` | `#dfd7e8` (Dark Plum, lightened) |
| `field-border` | `--a-field-border` | `input` | `--rp-c-divider` | `#877a94` | `#887995` (3.62 to 4.03:1) |
| `text` | `--a-text` | `foreground` | `--rp-c-text-1` | `#fafafc` | `#261633` (Dark Plum, 15.17 to 16.87:1) |
| `secondary-text` | `--a-secondary-text` | — | `--rp-c-text-2` | `#cfc4d6` | `#544760` (7.72 to 8.58:1) |
| `description-text` | `--a-description-text` | `muted-foreground` | `--rp-c-text-3` | `#aba0b5` | `#6a5d75` (5.50 to 6.11:1) |
| `primary` | `--a-primary` | `primary` | `--rp-c-brand` | `#a47af5` | `#a47af5` (Lilac. 3.02:1 against the canvas) |
| (Text on Lilac) | `--a-on-primary` | `primary-foreground` | — | `#261633` | `#261633` (5.37:1) |
| `primary-hover` | `--a-primary-hover` | `primary`, darker | `--rp-c-brand-dark` | `#b897f7` | `#9c72ed` (Lilac, darkened. Text on it 4.85:1) |
| `state-active` | `--a-state-active`, `--a-link` | — | `--rp-c-link` | `#b797f8` (6.03 to 7.67:1) | `#7046b6` (Lilac, darkened, 5.83 to 6.48:1) |
| `focus` | `--a-focus` | `ring` | — | `#d9c8fc` | `#7e55c7` (4.71 to 5.24:1) |
| `state-warning` | `--a-state-warning` | — | — | `#d4a162` | `#865813` (5.52 to 6.14:1) |
| `state-failed` | `--a-state-failed` | `destructive` | — | `#e4938e` | `#944a47` (5.67 to 6.31:1) |
| `readout-rule` | `--a-readout-rule` | — | — | `#a47af5` | `#a47af5` |

- The link color (`--a-link`) takes the same value as `state-active` in both dark and light. DESIGN.md uses Lilac for primary actions, selected navigation and focus. A link is an action that picks a destination, so it belongs to the Lilac family.
- The light `primary-hover` gets darker, the opposite of dark. Lightening it would drop the button's contrast against the background it sits on below 3:1.
- The light `state-warning` and `state-failed` follow how DESIGN.md makes the dark ones: the same lightness as the light `state-active` (0.50) and a low chroma (0.10).
- Of the manual's current light values, `--a-link` (`#6a3fd2`) and `--a-trouble` (`#8a4a9e`) do not follow this rule ([inventory](inventory.md#3つの配色が並んでいる)). They are replaced with the values in the table above.
- The values are settled in stage 3, after the site gets a check (hue, chroma, contrast) on the same criteria as `brandPalette.test.js`.

Light and dark follow the OS setting, and there is a switch as well (S-01).

### 3.3 Typography

| Role | Current guide | Proposal | Relation to DESIGN.md |
|---|---|---|---|
| Typeface | The list of fonts on the reader's PC (`custom.css`) | Use the guide's current list everywhere. Outfit, the manual's heading font, is not used (S-07) | No web fonts are loaded (DESIGN.md's "Do's and Don'ts") |
| Body | 16 px | 16 px, line height 1.75 | The 1.6 rem step (`body-large`) |
| Small text (tables, callout body text) | 15 px | 15 px | The 1.5 rem step |
| Supporting text (captions, marks) | — | 12 px | The 1.2 rem step (`description`) |
| h3 | 18 px | 18 px | The 1.8 rem step (`title`) |
| h2 | 22 px | 24 px. The current thin line drawn to the right stays | The 2.4 rem step. 22 px falls between steps, so it moves to 24 px, which is easier to tell apart from h3's 18 px. The line takes the form of the settings' `category-heading` |
| h1 | 30 px | 30 px | Outside the app's scale. Kept as the heading of a reading surface |

Only headings larger than 24 px take sizes that are not on the app's scale (12, 13, 14, 15, 16, 18, 20, 24 px). The product name on the home page is shown with the icon and wordmark images, as in the manual's hero. The size of headings set in text is decided in stage 6b. A Japanese line stays at about 40 characters, as now (the text column is 640 px).

### 3.4 Radius, spacing and motion

| Kind | Proposal | Change from now |
|---|---|---|
| Radius | Steps of 2, 4, 8 and 12 px (DESIGN.md's `rounded`). Buttons and inputs 8 px, cards and dialogs 12 px, `Badge` 4 px | Radii that are not on the scale go away (the manual's 18 px, 14 px, 10 px, 7 px, 6 px and 5 px; the guide components' 14 px, 10 px, 7 px, 6 px and 5 px) |
| Spacing | Steps of 4, 8, 16, 24 and 40 px (DESIGN.md's `spacing`), plus 64 px and 96 px between sections of a page | — |
| Motion | 120 ms and 220 ms, `--a-ease` and `--a-ease-settle` (the same values as DESIGN.md's "Motion"). 0 ms with reduced motion | Brings the guide's 140 ms and 240 ms and the manual's 140 ms in line |
| Focus | A 2 px ring in `--a-focus`, drawn 2 px away | Removes the `#a9ccff` written directly in the guide's components |

## 4. Mascot

### 4.1 Candidate places

| Candidate | Motion | Recommended | Reason |
|---|---|---|---|
| M-1 The home page's hero (right side) | The animated model | Yes | The position approved in #371. It is the face of the site, and it does not get in the way of reading the text |
| M-2 Callouts in the text (`Callout`) | Still faces | Yes (S-06) | The current eight faces are used as marks for the kinds. The faces do not carry meaning on their own; the title's words name the kind |
| M-3 The 404 page and no search results (`Empty`) | A still face, or one short animation played once | Yes | These are the places where the reader is at a dead end. They do not get in the way of the text |
| M-4 The top of "Troubleshooting" | A still face | Depends | The "Dizzy" face fits. An image added at the top of the page pushes the start of the text down |
| M-5 A guide that is always in the corner of every page | The animated model | No | It covers text on narrow screens, and its motion catches the eye on every read |
| M-6 A happy face after the download button is pressed | One animation played once | No | The site does not know whether the download finished. DESIGN.md uses motion that shows success only when something has actually succeeded |

### 4.2 Approach to building it in

- It is drawn by one component, `MascotStage`. The built HTML contains a still image (one with the same role as the current `mascot-hero.webp`), and the first paint uses that image.
- The files needed to play the animated model (the runtime and the model) are loaded later, and only when all of the following hold.
  - Reduced motion (`prefers-reduced-motion`) is off
  - The mascot is on screen (`IntersectionObserver`)
  - The page's first paint has finished
- If it keeps moving for more than 5 seconds, it gets a button that stops it (WCAG 2.2 success criterion 2.2.2). The stopped state is saved.
- The motion carries no meaning. The words in the speech bubble are placed as HTML text, and the alternative text (`alt`) describes how the mascot looks, as now.
- It makes no sound.
- Placement starts with M-1. M-2 and M-3 use still faces, so they can go in at stage 4 without waiting for the animated model.

### 4.3 Formats and acceptance conditions

The animated model's format follows what the separate work delivers. The formats differ as follows.

| Format | Handling on the site | What to check |
|---|---|---|
| Video with transparency (WebM and MP4) | Needs no runtime. Plays the same way as the home page videos (`HomeShowcase`) | Support for transparency differs between browsers (Safari needs HEVC with transparency) |
| Rive (`.riv`) | The runtime is loaded later. State changes can switch the face | The runtime's size and license |
| Lottie (JSON) | The runtime is loaded later | The runtime's size and license |
| Live2D | Needs a dedicated SDK | The SDK's license and distribution terms |
| 3D (glTF or VRM) | Needs a rendering library such as three.js | The amount loaded and the load on the GPU |
| Image sequence | Needs no runtime | The amount of images |

Whatever the format, the following are checked before it is built in (S-10).

- A cap on the transfer size. The amount the hero loads first must not grow
- The licenses of the model and the runtime are recorded in `NOTICE.md` and `docs/voice-stack/licensing.md`
- If the assets were made with generative AI, the site shows what the tool requires (a credit, or a statement that they were made with AI)
- Where the originals of the assets live. The originals go in `docs/brand/astarot/mascot/`, and the site gets copies of the exported files (S-11). The current face images (`site/public/manual/mascot/`) also move to `site/public/mascot/` in the stage that turns the manual into redirect pages

## 5. Staged rollout

Each stage is one to three PRs. Every PR passes the build and the four Pages checks, and is merged in a state that can be published on its own.

| Stage | Content | Prerequisite | What changes when it is published |
|---|---|---|---|
| 0 | This proposal (documents only) | — | Nothing |
| 1 | Fix wording that breaks the rules (P-10). Also fix the old page names in `content.mjs` (#704) | None. Can run alongside the other stages | Text only |
| 2 | Moving the base (ADR-016). Replace VitePress with Rspress, keeping the Japanese and English URLs, section anchors, search and publishing to GitHub Pages. Pages that use components inside Markdown become `.mdx`, and the components of the pages and the home page are carried over to React. The search and heading link checks are adjusted to Rspress's output. Whether `/manual/` becomes redirects in this stage is decided in the stage 2 PR | None | The base. The look keeps the current components' shapes, on top of Rspress's theme |
| 3 | Tokens. `tokens.css` (dark and light), the `--rp-c-*` mapping, replacing colors with tokens, the palette check, updating DESIGN.md's "The user guide (site/)" | Stage 2 | From navy to Dark Plum. A light scheme that follows the OS setting, and the switch |
| 4 | Base components (`Button`, `Badge`, `Kbd`, `Card`, `Item`, `Alert`, `Separator`, `Spinner`, `Collapsible`, `Table`). Replace the look of the current components, and draw Markdown callouts with `Alert`. Put the still faces in M-2 and M-3 | Stage 3 | The look of callouts and buttons |
| 5 | Interactive components (`DropdownMenu`, `Tabs`, `Tooltip`, `Dialog`, `InputGroup`). Make `DownloadButton` one component, and rebuild `OsTabs`, `Term`, `CopyText`, `ShotZoom` and the language menu | Stage 4 | Menus, tabs, tooltips |
| 6 | Information architecture. 6a: the sidebar and the top bar (URLs do not change). 6b: merge the home pages. 6c: turn `/manual/` into redirect pages and remove the manual's components (there is no 6c if stage 2 made the redirects) | Stage 5 | The order and the home page. `/manual/` turns into redirects |
| 7 | Make the look of the search screen follow `Command` and `Empty` (style Rspress's `SearchPanel`) | Stage 4 | The look of search |
| 8 | Images and videos. Retake the screenshots in the Dark Plum app (`tools/docs_screenshots.py`), match `site/motion/src/theme.ts` to the tokens and export the videos again, and fix the colors of the How voice and text flow diagrams and of the route strip | Stage 3. The app's screens can be captured in Dark Plum | Images and videos |
| 9 | Building in the mascot (`MascotStage`, M-1) | Stage 6b. The animated model meets the conditions of 4.3 | The mascot on the home page moves |

- Stage 1 can ship without waiting for the other stages. It touches the same pages as #673, so it is merged after #673.
- From stage 3, the palette has the same source of truth as the app's. From stage 3 until stage 8, the screenshots and videos still show the navy app. The stages go in numeric order, and stage 8 is not moved up to right after stage 3 (decided on 2026-11-19; by the numbers at the time of the decision, stages 7 and 2).
- The information architecture of stage 6 is rearranged after the components are in place, so that the home page is rebuilt with the new components only once.
- Stage 2 removes VitePress, so the move to VitePress 2 (option B of #690) does not happen. Stages 3 to 7 are built to rely on layout slots and CSS variables, not on Rspress internals.

### What to check at each stage

- `npm run build` in `site/`, and the four checks of the Pages workflow
- From stage 3: the palette check (hue, chroma, contrast)
- From stage 4: the check that component files hold no color values written directly, and the check of the Japanese and English string keys
- In a browser: at widths of 360 px, 768 px and 1280 px, nothing overflows sideways. Menus, tabs, tooltips, dialogs and search work with the keyboard alone. Focus is visible. Motion stops with reduced motion. Both light and dark
- Browser engines: besides Chromium-based browsers and Firefox, WebKit-based ones (Safari) are checked too. Whatever cannot be checked locally is written as "not verified" in the PR

## Decisions made

On 2026-11-19, all of the following went to option A, the one this document recommended. The rejected options are kept for when the same question is considered again.

| Number | What was decided | Option chosen | Options rejected | Reason |
|---|---|---|---|---|
| Base | The site's base | Move to Rspress (React) (2026-11-20) | Keep VitePress and build the components in Vue | The app's UI and shadcn/ui are in React, so the components and what is learned about them are consolidated on React. Details in [ADR-016](../../adr/adr-016-user-guide-site-on-rspress.md) |
| Direction | How the review proceeds | Merge the guide and the manual, and rework the site in stages (8 stages when decided; on 2026-11-20 moving the base was added as stage 2, making 9) | Write the text in the manual's chapters and shrink the guide. Keep both and only match their look | The text is in the guide, and released versions of the app open guide URLs. The manual's English pages cannot be seen by search engines or by readers without JavaScript |
| Order | The order of the stages | As numbered in section 5. The images and videos stage is not moved up to right after the tokens stage (stages 7 and 2 by the numbers at the time of the decision, now stages 8 and 3) | Move the images and videos stage up to right after the tokens stage | Between the tokens stage and the images and videos stage, images of the navy app sit on Dark Plum pages. The images and videos stage needs the app's screens to be capturable in Dark Plum |
| S-01 | Handling of light and dark | Follow the OS setting, and add a switch as well | Dark only (the current guide). Follow the OS setting with no switch (the current manual) | The manual approved in #371 supports both light and dark. Readers can pick light when they read long text in a bright place. Dark uses the same values as the app, so in dark the look matches the app |
| S-02 | Whether to write the dark values from DESIGN.md | Write them with `tools/site_tokens.mjs` and run `--check` in CI | Copy them by hand | It keeps the site from being left with old values when the app's palette changes. The current state, still navy (P-05), is an example |
| S-03 | Sidebar groups (1.2) | Six groups matched to the names of the app's settings menu | Keep the current five and only fix the order | Readers can look things up by the same names as in the app |
| S-04 | What colors mean in the route strip and the diagrams | The strip does not color by direction and marks only this page's step in Lilac. The direction is given by the strip's name ("You to others"). The How voice and text flow diagrams use the same line colors as the app's "Inputs and outputs" diagram (voice, chat, speech) | Keep the colors by direction and only move them toward the brand | Lilac then means what is selected (this page), as in the app. The diagrams read in the same color vocabulary as the app's screen. The direction is already written in the strip's names, so dropping the color loses no meaning |
| S-05 | The manual home page's "five pillars" and its "Your guide" and "Reading the callouts" sections | Remove both from the home page. The subtitle stays in the wordmark, and how to read the faces and callouts goes at the end of "What is ASTAROT" | Keep them on the home page | The home page gets shorter and shows the contents and the feature introduction first. The five pillars overlap with the feature introduction |
| S-06 | Callout kinds and faces | GitHub's five kinds (note, tip, important, warning, caution) plus the fold. Each kind gets a face | The manual's six kinds (including "when it does not work"). No faces | They match the kinds VitePress can write in Markdown (the reason as of 2026-11-19; how to write them in Rspress is checked in stage 4). "When it does not work" can be handled by a section of the page types (1.6). How they are written in Markdown is not decided (2.2) |
| S-07 | Typeface for headings | The same typeface as the body | Outfit only on PCs that have it | The shape of headings no longer depends on the reader's PC. The brand typeface can be shown in the wordmark (an image) |
| S-08 | How long to keep the `/manual/` redirect pages | Keep them with no end date | Keep them until the next stable release, then remove them | Nothing in the repository links to `/manual/` (checked on 2026-11-19). But it has been public since 0.5.0, so readers may come from bookmarks or search engines. The redirect pages are small, and keeping them adds no work |
| S-09 | Whether to write the behavior of the interactive components ourselves | Our own composables (hooks in React) and native elements | Add a headless component library such as Reka UI | The site needs four interactions (menus, tabs, tooltips, dialogs), and the current code has a base for them. It adds no dependencies or license checks either |
| S-10 | Acceptance conditions for the animated mascot | The conditions of 4.3 (transfer size, licenses, the generative AI notice, where the originals live). The format is decided in stage 9 against these conditions, once the deliverable is known | — | As of 2026-11-19, the animated model's format cannot be told from this repository |
| S-11 | Where the originals of the mascot's assets live | `docs/brand/astarot/mascot/` | Only inside `site/` | Like the icon and the logo, they can be managed in one place as brand assets |

---

# マニュアルサイトの再設計の提案（日本語版）

利用者向けのサイト（`site/`）の作りを見直す設計です。ガイドとマニュアルを1つのサイトにまとめ、見た目をアプリと同じASTAROTの配色にそろえ、部品をshadcn/uiの設計にならって作り直します。作り替えは9段に分け、1つの大きなPRにはしません。

- 状態: 方針は決定済み（2026-11-19）。全体の方向、段の順序、S-01〜S-11は、すべてこの文書で推したA案に決まりました（[決まったこと](#決まったこと)）。実装は5章の段1から順に進めます。2026-11-20に、土台をVitePressからRspress（React）に替えると決まりました（[ADR-016](../../adr/adr-016-user-guide-site-on-rspress.md)）。決まったことの表に「土台」を足し、2章、3章、5章をRspressに合わせました。土台を替える段を段2として足したので、前の段2から段8は段3から段9になりました。段2は#761で入りました。2026-11-22に段3（トークン）を実装しました。3.2のライトの値のうち`primary-hover`は、検査を足して1段だけ彩度を下げた`#9c72ec`にしました。Rspressの`--rp-c-brand`は文字として描かれるので、`primary`ではなく`state-active`に割り当てました。
- 前提: [棚卸し](inventory.md)。問題の番号（P-01など）は棚卸しの番号です。
- 関係: #371（マニュアルの新設）、#554（アプリの情報設計）、#680（部品をshadcn/uiに寄せる方針）、#673（0.6.0に向けたガイドの更新）、#690（サイトのVite）

## 見直しを始めた時点で決まっていたこと

- 土台はVitePressのままにします。日英の構成、検索、GitHub Pagesへの公開の仕組みを使い続けます。2026-11-20に、土台はRspress（React）に替えると決まりました（ADR-016）。日英の構成、検索、GitHub Pagesへの公開を保つことは変わりません。
- 部品は、shadcn/uiの設計を参考にした自前のVueの部品で作り直します。shadcn-vueは入れません。2026-11-20からは、部品はReactで書きます。
- 色はASTAROTのブランドのトークンを使います。正本はDESIGN.mdと`docs/brand/`です。アプリの設定画面と見た目の言葉をそろえます。
- 動くマスコット（悪魔ペンギン）の新しいモデルは、別の作業で完成しています。サイトに組み込むのはこの設計が固まってからです。この文書には置き場の候補と組み込み方の方針だけを書きます。

## 方針の要点

1. ガイドとマニュアルを1つにします。本文の正本はガイドのページ（`/ja/`と`/en/`の下）にし、#371で承認したマニュアルのトップの構成をサイトのトップに移します。`/manual/`は転送のページにします（P-01、P-02、P-03、P-04）。
2. URLは変えません。ページのファイルの場所はそのままにし、サイドバーとナビゲーションだけを組み替えます。配布済みのアプリが開くURL（[棚卸し](inventory.md#外から参照されているurl)）はすべて同じ内容を開きます。
3. サイドバーのまとまりの名前を、アプリの設定のメニューのまとまり（#554）にそろえます（P-08）。
4. 色はDESIGN.mdのトークンを正本にします。ダークはアプリと同じ値にし、ライトは同じ規則で作った値にします。紺の配色はサイトから外します（P-05）。
5. 部品は`site/.vitepress/theme/ui/`に、shadcn/uiの部品と同じ名前と`data-slot`で作ります。2つずつある部品は1つにします（P-06）。
6. どの段も、その段だけで公開できる状態でマージします。developにマージした変更はそのまま公開されるためです。

## 1. 情報構成

### 1.1 方針

- 1つの事実は1つのページにだけ書きます。トップのページはほかのページの事実を写さず、要約とリンクを置きます（P-02）。
- URLと並び順を分けて扱います。URLは外から参照される約束なので動かしません。読み手に見せる並びはサイドバーで決めます。
- アプリと同じ言葉で並べます。アプリの設定と見比べる読み手が、同じまとまりの名前で機能を探せるようにします。
- 初めての読み手が最初のメッセージを送るまでのページを短くします。参考の表は、必要になったときに読む場所へ移します。

### 1.2 サイドバー

| まとまり（日本語／英語） | ページ（この順） | 今のまとまり |
|---|---|---|
| はじめに／Getting started | ASTAROTとは、インストール、最初の設定、やりたいことから探す、声と文字の流れ | はじめに、やりたいこと |
| 会話の基本／Conversation | 翻訳、音声認識（ASR）とリアルタイム字幕、字幕とVR、入力の小窓とホットキー | 声と文字の機能、画面と連携 |
| 声と読み取り／Voice and reading | テキスト読み上げ（TTS）、ボイスチェンジャー（RVC）、チャット読み取り（OCR） | 声と文字の機能 |
| 音声経路と連携／Audio routes and other apps | 入力と出力、Windowsの音声経路、Linuxの音声経路、OBSとWebSocket | 画面と連携、設定と運用 |
| モデル／Models | モデルの取得、自分のモデルを使う | 設定と運用、やりたいこと |
| 困ったときと資料／Help and reference | 困ったとき、動作環境と推奨スペック、対応環境と検証の範囲、プライバシー、ライセンスと謝辞 | はじめに、設定と運用 |

- 「会話の基本」「声と読み取り」は、アプリの設定のメニューのまとまりの名前です（DESIGN.mdの「Layout」）。アプリの「会話の基本」にはVRChatのページもあります。ガイドではOSCの設定を「最初の設定」に書いているので、このまとまりには入れません。
- アプリではホットキーの設定は「使い心地」のまとまりにあります。ガイドの「入力の小窓とホットキー」は、会話の途中で文章を送る小窓が中心なので、「会話の基本」に置きます。
- 動作環境と対応環境の表は「困ったときと資料」に移し、「インストール」の冒頭とトップからリンクします。初めての読み手は「ASTAROTとは」「インストール」「最初の設定」の3ページで、最初のメッセージを送れます。
- 「自分のモデルを使う」は「モデルの取得」と並べます。どちらもモデルのファイルを用意するページです。
- 音声経路のページは「入力と出力」と並べます。マニュアルの章「音声経路とVR」の考え方を引き継ぎます。

### 1.3 上部のバー

左から次の順に置きます。

1. ASTAROTのアイコンと名前（そのページの言語のトップへ）
2. 検索（パレットを開くボタン。`Ctrl`+`K`と`/`でも開く）
3. 「インストール」「やりたいことから探す」「困ったとき」
4. 「リリースノート」（GitHub Releasesへ。外のサイトへ移ることを印で示す）
5. 言語のメニュー（日本語、English）
6. GitHub

ダウンロードのボタンは、トップのヒーローに加えて「インストール」のページの冒頭にも置きます（P-09）。どちらも同じ部品（2.3の`DownloadButton`）です。狭い画面では、Rspressのメニューのボタンに3から6をまとめます。

### 1.4 トップのページ

`/ja/`と`/en/`のトップは、次の順に並べます。

| 順 | 節 | 中身 | 元にするもの |
|---|---|---|---|
| 1 | ヒーロー | アイコンとワードマーク、2文の紹介、ダウンロードのボタン、「最初の設定」へのボタン、改名の注記、マスコット | マニュアルのヒーロー（#371）、ガイドの`HomeActions` |
| 2 | アプリの画面 | メイン画面のスクリーンショット | ガイドの`HomeShot` |
| 3 | 3つの手順 | 「ダウンロードして入れる」「VRChatとつなぐ」「送ってみる」。各手順から「インストール」「最初の設定」「翻訳」へ | マニュアルのクイックスタート |
| 4 | できること | 5つの機能。各機能に動画、2文の説明、ページへのリンク | ガイドの`HomeShowcase` |
| 5 | 目次 | サイドバーの6つのまとまりをカードで並べ、各ページへのリンクを置く | マニュアルの10章の目次 |
| 6 | 調べたいとき | 動作環境、対応環境、困ったとき、不具合の報告、リリースノート、プライバシーへのリンク | マニュアルの「動作環境」と「サポート」 |

- 6の節には版の番号や条件の数字を書きません。数字は「動作環境と推奨スペック」と「対応環境と検証の範囲」にだけ書きます。マニュアルのトップが`content.mjs`に持っていた動作環境とファイルの7種類の一覧はなくします（P-02）。
- マニュアルのトップの「目次の絞り込み」はなくします。サイト全体の検索（パレット）が本文まで探せるためです（P-04）。
- マニュアルの「5つの柱」（サブタイトルの語ごとの説明）と「案内役とコールアウトの見かた」はトップから外します。サブタイトルはワードマークに残し、表情と囲みの見かたは「ASTAROTとは」の末尾に置きます（S-05）。

`/`の言語を選ぶページは今の動きのまま、見た目だけを新しいトークンにそろえます。

### 1.5 `/manual/`の扱い

`/manual/`と10章のページは、ガイドの対応するページへ移す転送のページにします。GitHub Pagesではサーバーの転送を設定できないので、転送のページは次のように作ります。

- 移る先を指す`<link rel="canonical">`を持ちます。
- `<head>`のスクリプトが、`/`と同じ決め方で言語を選んで移ります（`theme/locale.ts`の`preferredLocale()`）。JavaScriptが動かないときは、`<noscript>`の中の`<meta http-equiv="refresh">`で日本語のページへ移ります。今のマニュアルのHTMLが日本語なので、同じ言語のページへ移すことになります。
- 移る先へのリンクを本文にも置きます。

| マニュアルのパス | 移る先（`/<言語>/`の下） |
|---|---|
| `/manual/` | トップ |
| `/manual/introduction` | `guide/introduction` |
| `/manual/install` | `guide/install` |
| `/manual/screens` | `guide/how-it-works` |
| `/manual/translation` | `features/translation` |
| `/manual/speech` | `features/transcription` |
| `/manual/voice` | `features/tts` |
| `/manual/chat-reading` | `features/chat-reading` |
| `/manual/audio-and-vr` | `features/io-flow` |
| `/manual/models` | `guide/models` |
| `/manual/help` | `guide/troubleshooting` |

`tools/check_site_manual.mjs`は、転送のページが上の表の先へ移ること、移る先のページが日英ともにビルドされていることを確かめる検査に書き換えます。転送のページは期限を決めずに残します（S-08）。

### 1.6 ページの型

ページを4つの型に分け、型ごとに先頭と末尾に置くものをそろえます。本文の書き換えは機能ごとのPRで少しずつ進めます。この表は、そのときに合わせる形です。

| 型 | ページ | 先頭に置くもの | 末尾に置くもの |
|---|---|---|---|
| 手順 | インストール、最初の設定、Windowsの音声経路、Linuxの音声経路 | 必要なもの（`Alert`）、手順の一覧（`StepProgress`） | 次に読むページ |
| 機能 | `features/`の9ページ | 経路の帯（今は声と文字の機能の5ページにある）、必要なもの | うまくいかないときの確かめ方、関連するページ |
| 探す | やりたいことから探す、困ったとき | ページの中の目次 | — |
| 資料 | 動作環境と推奨スペック、対応環境と検証の範囲、プライバシー、ライセンスと謝辞 | 書いた日付と対象の版 | — |

## 2. 部品

### 2.1 作り方の決まり

- 置き場は`site/theme/ui/`です。shadcn/uiと同じく、1つの部品を1つの`.tsx`に書き、パーツを名前付きでexportします（`Card`、`CardHeader`、`CardTitle`など）。shadcn/uiのReactのコードを、DESIGN.mdの読み替えの規則で写します。
- 各パーツの根の要素に、shadcn/uiと同じ名前の`data-slot`を付けます（`card`、`card-header`など）。
- 見た目の種類は`variant`と`size`のpropsで受けます。スタイルの書き方（CSS Modulesか、アプリと同じvanilla-extractの`recipe()`か）と、アプリの`src-ui/views/kit/`の部品をサイトと共有するかは、段4で決めます（ADR-016の7）。どちらでも、色、角丸、余白、文字の大きさ、動きには3章のトークンだけを使い、部品のファイルに色の値を直接書いていないことを検査します。
- キーボードの操作（メニュー、タブ、吹き出し、ダイアログ）は自前のhookにまとめます。段2でReactに写した`OsTabs`、`Term`とメニューの操作を出発点にします。先にネイティブの要素（`<button>`、`<dialog>`、`<details>`）を使います。ヘッドレスの部品のライブラリは入れません（S-09）。
- 部品の文言は`theme/i18n/ja.ts`と`theme/i18n/en.ts`に集め、日英のキーと補間の変数がそろっていることを検査します（P-12）。
- CSSの機能は、Baseline Widely availableのものをそのまま使い、それより新しいものは`@supports`と代わりの表示を付けたときだけ使います。AGENTS.mdのUIの決まりをサイトにも当てはめます。サイトは読み手のブラウザで開くので、Chrome、Edge、Firefox、Safariで読めることを前提にします。
- shadcn/uiの読み替えは、DESIGN.mdの「Components」の規則に従います。サイトの1 remはTailwindと同じ16 pxなので、shadcn/uiの長さはそのまま読めます（アプリの1 remは10 pxです）。色はshadcn/uiの値を使わず、3.2の対応表でASTAROTのトークンに置き換えます。shadcn/uiとDESIGN.mdの規則が違うところ（ボタンの役割、フォーカスの輪）は、DESIGN.mdに従います。
- NOTICE.mdのshadcn/uiの節は「アプリの部品」を対象に書いています。サイトの部品を寄せる最初のPRで、サイトの部品も対象だと書き足します。

### 2.2 基本の部品（`theme/ui/`）

| 部品 | 役割 | 参考にするshadcn/uiの部品 | 置き換えるもの |
|---|---|---|---|
| `Button` | 操作とリンクのボタン。見た目は`primary`、`plain`、`quiet`、`link`、大きさは`sm`、`default`、`lg`、`icon`。`href`を渡すと`<a>`で描く | Button。`asChild`の代わりに`href`で描き分ける | トップのヒーローのボタン（今の`HomeActions`）、マニュアルの`.secondary`と`.more` |
| `ButtonGroup` | 主のボタンとメニューを開くボタンを1つの組に見せる | Button Group | ダウンロードのボタンの組 |
| `Badge` | 短い状態の印（おすすめ、実験的機能） | Badge | マニュアルの目次の`.chip`、メニューの「おすすめ」 |
| `Kbd` | キーの名前 | Kbd、KbdGroup | 本文のキーの書き方、検索窓の`/` |
| `Card` | 枠で囲んだ1つのまとまり | Card（Header、Title、Description、Action、Content、Footer） | トップの機能と目次、マニュアルの関連するページと前後の章 |
| `Item` | 名前、1行の説明、行き先を並べる行 | Item（Media、Content、Title、Description、Actions）、ItemGroup | `{.feature-rows}`、サポートの一覧 |
| `Alert` | 本文の囲み | Alert（Title、Description） | Markdownの囲み（`:::`）、`ManualCallout`、`{.needs}` |
| `Separator` | 区切りの線 | Separator | h2の右の線、バーの区切り |
| `Spinner` | 読み込み中の印 | Spinner | ダウンロードのボタンの確認中の表示 |
| `DropdownMenu` | ボタンから開くメニュー | Dropdown Menu（Trigger、Content、Label、Group、Item、RadioGroup、RadioItem、Separator） | 2つのダウンロードのメニュー、`ManualLangMenu`、`useMenu` |
| `Tabs` | 同じ場所で中身を切り替える | Tabs（List、Trigger、Content） | `OsTabs`の切り替え |
| `Tooltip` | 用語の短い説明 | Tooltip。タップで開閉する動きはPopoverにならう | `Term`、`TermTooltip` |
| `Dialog` | 画面の上に開く窓 | Dialog | スクリーンショットの拡大、検索のパレットの枠 |
| `InputGroup` | 入力欄とアイコンやボタンを1つの枠にまとめる | Input Group（Addon、Button、Input） | `CopyText`、検索を開くボタン |
| `Command` | 検索のパレットの中身 | Command（Input、List、Empty、Group、Item、Shortcut） | `LocalSearchBox`の見た目 |
| `Empty` | 何もないときの表示 | Empty（Media、Title、Description、Content） | 検索の結果がないとき、404のページ |
| `Breadcrumb` | ページがどのまとまりにあるか | Breadcrumb | マニュアルの「目次へ戻る」 |
| `Collapsible` | 畳んだ補足 | Collapsible。ネイティブの`<details>`で描く | `::: details` |
| `Table` | 表 | Table。Markdownの表にスタイルを当てる | `.vp-doc`の表 |

`Alert`の種類は、GitHubの5種類（note、tip、important、warning、caution）と畳んだ補足にし、種類ごとにマスコットの表情を付けます（S-06）。Markdownでの書き方（今の`::: warning`を使い続けるか、GitHubの`> [!NOTE]`の形にするか）はS-06では決めていないので、段4のPRで判断が要ることとして扱います。どちらの書き方でも、Markdownの囲みを`Alert`で描くようにします。

### 2.3 サイトの部品（`theme/components/`）

| 部品 | 組み立て | 置き換えるもの |
|---|---|---|
| `DownloadButton` | `ButtonGroup`、`DropdownMenu`、`Badge`、`Spinner` | `DownloadButton.vue`と`ManualDownload.vue`。メニューには最新のリリースにあるファイルだけをOSごとに並べ、すべての版とインストールの手順へのリンクを付けます。マニュアルの固定の7つの枠はなくします（P-02） |
| `OsTabs` | `Tabs`と、全ページで共有するOSの選択（`os.ts`） | `OsTabs.vue`。両方の中身をページに残し、検索で見つかるようにする今の作りを保ちます |
| `Term` | `Tooltip` | `Term.vue`、`TermTooltip.vue` |
| `CopyText` | `InputGroup`、`Button` | `CopyText.vue` |
| `Callout` | `Alert`と、種類ごとのマスコットの表情（S-06） | `ManualCallout.vue`、カスタムブロック |
| `StepProgress` | 自前。shadcn/uiに当たる部品はありません | `StepProgress.vue`。色と動きをトークンに替えます |
| `RouteStrip` | 自前 | `RouteStrip.vue`。方向で色分けせず、そのページの段だけをLilacで示します（S-04） |
| `FeatureShowcase` | `Card`と動画 | `HomeShowcase.vue` |
| `QuickStart` | 番号付きの`Card` | マニュアルのクイックスタート |
| `ContentsGrid` | `Card`、`Item` | マニュアルの目次 |
| `MascotStage` | 自前（4章） | マニュアルのヒーローのマスコット |
| `ShotZoom` | `Dialog` | `theme/index.ts`の`zoom()` |
| `PagePager` | `Card`。shadcn/uiのPaginationの前後のリンクの形にならう | テーマの前後のページのリンク、マニュアルの前後の章 |

表の「置き換えるもの」は、2026-11-19のVueの部品の名前です。段2では、これらをいったん同じ役割のReactの部品に写します。段4と段5で、2.2の基本の部品の上に作り直します。

### 2.4 Rspressの既定のテーマの部品

上部のバー、サイドバー、ページの中の目次、狭い画面のメニュー、検索の画面は、Rspressの既定のテーマの部品を使い続け、トークンと最小限のCSSで見た目を合わせます。自前の部品はレイアウトのスロット（`afterHeroActions`、`afterHero`、`beforeDocContent`、`bottom`など）に差し込みます。参考にするshadcn/uiの部品は次のとおりです。

| Rspressの部品 | 参考にするshadcn/uiの部品 |
|---|---|
| `Nav`（上部のバー） | Navigation Menu |
| `Sidebar` | Sidebar（Group、GroupLabel、Menu、MenuButtonの選んだ状態） |
| `Outline`（ページの中の目次） | Sidebarの小さい大きさ |
| `NavHamburger`（狭い画面） | Sheet |
| `SearchPanel`（検索の画面） | Command、Empty |

Rspressの部品を写して直す（`rspress eject`）ことはしません。写しはRspressを上げるたびに合わせ直す必要があるためです。VitePressの検索の写し（`LocalSearchBox.vue`、P-11）は段2でなくなります。

## 3. 色と文字のトークン

### 3.1 層

トークンは3つの層で持ちます。

1. ブランドの色: Dark Plum `#261633`、Lilac `#A47AF5`、Off-White `#FAFAFC`、White（`docs/brand/README.md`）。
2. 役割のトークン: DESIGN.mdの`colors`の名前に`--a-`を付けたもの（`--a-canvas`、`--a-surface`など）。部品はこの層だけを使います。`--a-`は今のマニュアルのトークンの接頭辞です。
3. Rspressの変数（`--rp-c-*`）: 役割のトークンから値を引きます。Rspressの既定のテーマの部品は、この層を通して同じ配色になります。

ダークの値は、DESIGN.mdの`colors`をそのまま使います。DESIGN.mdから値を写すときに食い違いが起きないように、`tools/site_tokens.mjs`でDESIGN.mdのfront matterから`site/theme/tokens.css`のダークの値を書き出し、`--check`をPagesのワークフローで実行します（S-02）。

### 3.2 色の対応表

ライトの値は、DESIGN.mdの「Colors」の規則で作った案です。ブランドに役割に合う色があればそのまま使い、なければDark PlumかLilacの明度だけを変えています（OKLCHの色相の差は3°以内、彩度は元の色以下）。コントラストは2026-11-19に計算した値で、地（canvas）、面（surface）、レール（rail）に対するものです。

| DESIGN.mdの名前 | サイトのトークン | shadcn/uiの役割 | Rspressの変数（案） | ダーク（DESIGN.md） | ライト（案） |
|---|---|---|---|---|---|
| `canvas` | `--a-canvas` | `background` | `--rp-c-bg` | `#261633` | `#fafafc`（Off-White） |
| `rail` | `--a-rail` | `sidebar` | `--rp-c-bg-soft` | `#1c0f27` | `#f6f1fa`（Dark Plumを明るく） |
| `surface` | `--a-surface` | `card`、`popover` | `--rp-c-bg-mute` | `#332341` | `#ffffff`（White） |
| `border` | `--a-border` | `border` | `--rp-c-divider-light` | `#4e3d5d` | `#dfd7e8`（Dark Plumを明るく） |
| `field-border` | `--a-field-border` | `input` | `--rp-c-divider` | `#877a94` | `#887995`（3.62〜4.03:1） |
| `text` | `--a-text` | `foreground` | `--rp-c-text-1` | `#fafafc` | `#261633`（Dark Plum、15.17〜16.87:1） |
| `secondary-text` | `--a-secondary-text` | — | `--rp-c-text-2` | `#cfc4d6` | `#544760`（7.72〜8.58:1） |
| `description-text` | `--a-description-text` | `muted-foreground` | `--rp-c-text-3` | `#aba0b5` | `#6a5d75`（5.50〜6.11:1） |
| `primary` | `--a-primary` | `primary` | `--rp-c-brand` | `#a47af5` | `#a47af5`（Lilac。地に対して3.02:1） |
| （Lilacの上の文字） | `--a-on-primary` | `primary-foreground` | — | `#261633` | `#261633`（5.37:1） |
| `primary-hover` | `--a-primary-hover` | `primary`を濃く | `--rp-c-brand-dark` | `#b897f7` | `#9c72ed`（Lilacを暗く。上の文字は4.85:1） |
| `state-active` | `--a-state-active`、`--a-link` | — | `--rp-c-link` | `#b797f8`（6.03〜7.67:1） | `#7046b6`（Lilacを暗く、5.83〜6.48:1） |
| `focus` | `--a-focus` | `ring` | — | `#d9c8fc` | `#7e55c7`（4.71〜5.24:1） |
| `state-warning` | `--a-state-warning` | — | — | `#d4a162` | `#865813`（5.52〜6.14:1） |
| `state-failed` | `--a-state-failed` | `destructive` | — | `#e4938e` | `#944a47`（5.67〜6.31:1） |
| `readout-rule` | `--a-readout-rule` | — | — | `#a47af5` | `#a47af5` |

- リンクの色（`--a-link`）は、ダークでもライトでも`state-active`と同じ値にします。DESIGN.mdはLilacを主な操作、選んだナビゲーション、フォーカスに使うとしています。リンクは行き先を選ぶ操作なので、Lilacの系統にします。
- ライトの`primary-hover`は、ダークと逆に暗くします。明るくするとボタンの地に対するコントラストが3:1を下回るためです。
- ライトの`state-warning`と`state-failed`は、DESIGN.mdのダークの作り方にならい、ライトの`state-active`と同じ明度（0.50）と低い彩度（0.10）にしました。
- マニュアルの今のライトの値のうち、`--a-link`（`#6a3fd2`）と`--a-trouble`（`#8a4a9e`）はこの規則に合いません（[棚卸し](inventory.md#3つの配色が並んでいる)）。上の表の値に置き換えます。
- 値は段3で、`brandPalette.test.js`と同じ基準の検査（色相、彩度、コントラスト）をサイトにも足してから確定します。

ライトとダークは、OSの設定に合わせ、切り替えのボタンも付けます（S-01）。

### 3.3 文字

| 役割 | 今のガイド | 提案 | DESIGN.mdとの対応 |
|---|---|---|---|
| 書体 | 読み手のPCの書体の並び（`custom.css`） | ガイドの今の並びに統一する。マニュアルの見出しのOutfitは使わない（S-07） | ウェブフォントを読み込まない（DESIGN.mdの「Do's and Don'ts」） |
| 本文 | 16 px | 16 px、行の高さ1.75 | 段の1.6 rem（`body-large`） |
| 小さい文字（表、注記の本文） | 15 px | 15 px | 段の1.5 rem |
| 補足の文字（キャプション、印） | — | 12 px | 段の1.2 rem（`description`） |
| h3 | 18 px | 18 px | 段の1.8 rem（`title`） |
| h2 | 22 px | 24 px。右へ細い線を引く今の形は残す | 段の2.4 rem。22 pxは段の間にあるので、h3の18 pxと見分けやすい24 pxへ移す。線は設定の`category-heading`の形 |
| h1 | 30 px | 30 px | アプリの段の外。読む面の見出しとして残す |

アプリの段（12、13、14、15、16、18、20、24 px）にない大きさは、24 pxより大きい見出しだけにします。トップの製品名は、マニュアルのヒーローと同じくアイコンとワードマークの画像で示します。文字で書く見出しの大きさは段6bで決めます。日本語の1行は今と同じく約40字（本文の列は640 px）にします。

### 3.4 角丸、余白、動き

| 種類 | 提案 | 今との違い |
|---|---|---|
| 角丸 | 2、4、8、12 pxの段（DESIGN.mdの`rounded`）。ボタンと入力欄は8 px、カードとダイアログは12 px、`Badge`は4 px | 段にない角丸（マニュアルの18 px、14 px、10 px、7 px、6 px、5 px、ガイドの部品の14 px、10 px、7 px、6 px、5 px）をなくす |
| 余白 | 4、8、16、24、40 pxの段（DESIGN.mdの`spacing`）に、ページの節の間の64 pxと96 pxを足す | — |
| 動き | 120 msと220 ms、`--a-ease`と`--a-ease-settle`（DESIGN.mdの「Motion」と同じ値）。動きを減らす設定では0 ms | ガイドの140 msと240 ms、マニュアルの140 msをそろえる |
| フォーカス | `--a-focus`の2 pxの輪を2 px離して描く | ガイドの部品に直接書いた`#a9ccff`をなくす |

## 4. マスコット

### 4.1 置き場の候補

| 候補 | 動き | 推すか | 理由 |
|---|---|---|---|
| M-1 トップのヒーロー（右側） | 動くモデル | 推す | #371で承認した位置です。サイトの顔になる場所で、本文を読むときの邪魔になりません |
| M-2 本文の囲み（`Callout`） | 止まった表情 | 推す（S-06） | 今の8つの表情を種類の印に使います。表情だけに意味を持たせず、題の言葉で種類を示します |
| M-3 404のページと、検索の結果がないとき（`Empty`） | 止まった表情か、一度だけの短い動き | 推す | 読み手が行き止まりにいるときの場所です。本文の邪魔になりません |
| M-4 「困ったとき」の冒頭 | 止まった表情 | 場合による | 「目がぐるぐる」の表情が合います。ページの先頭に画像を足すと、本文の始まりが下がります |
| M-5 全ページの隅に常にいる案内役 | 動くモデル | 推さない | 狭い画面で本文を隠し、読むたびに動きが目に入ります |
| M-6 ダウンロードを押したあとの喜ぶ表情 | 一度だけの動き | 推さない | サイトはダウンロードが終わったかを知りません。DESIGN.mdは、うまくいったことを示す動きを、実際にうまくいったときだけに使うとしています |

### 4.2 組み込み方の方針

- `MascotStage`という1つの部品で描きます。ビルドしたHTMLには止まった画像（今の`mascot-hero.webp`と同じ役割の画像）を入れ、最初の表示はその画像で済ませます。
- 動くモデルの再生に要るファイル（ランタイムとモデル）は、次の条件をすべて満たしたときだけ、あとから読み込みます。
  - 動きを減らす設定（`prefers-reduced-motion`）がオフ
  - マスコットが画面に入っている（`IntersectionObserver`）
  - ページの最初の表示が終わっている
- 5秒を超えて動き続けるなら、止めるボタンを付けます（WCAG 2.2の達成基準2.2.2）。止めた状態は保存します。
- 動きは意味を持たせません。吹き出しの言葉はHTMLの文字として置き、代わりのテキスト（`alt`）は今と同じくマスコットの姿を説明します。
- 音は出しません。
- 置き場はM-1から始めます。M-2とM-3は止まった表情なので、動くモデルを待たずに段4で入れられます。

### 4.3 形式と受け入れの条件

動くモデルの形式は、別の作業の成果物に合わせます。形式ごとの違いは次のとおりです。

| 形式 | サイトでの扱い | 確かめること |
|---|---|---|
| 透過付きの動画（WebMとMP4） | ランタイムが要りません。トップの動画（`HomeShowcase`）と同じ扱いで再生できます | 透過の対応はブラウザで違います（SafariはHEVCの透過が要ります） |
| Rive（`.riv`） | ランタイムをあとから読み込みます。状態の切り替えで表情を変えられます | ランタイムの大きさとライセンス |
| Lottie（JSON） | ランタイムをあとから読み込みます | ランタイムの大きさとライセンス |
| Live2D | 専用のSDKが要ります | SDKのライセンスと配布の条件 |
| 3D（glTFやVRM） | three.jsなどの描画のライブラリが要ります | 読み込む量とGPUへの負荷 |
| 連番の画像 | ランタイムが要りません | 画像の量 |

どの形式でも、組み込む前に次を確かめます（S-10）。

- 転送の量の上限。ヒーローで最初に読む量を増やさないこと
- モデルとランタイムのライセンスを`NOTICE.md`と`docs/voice-stack/licensing.md`に記録すること
- 生成AIで作った素材なら、その道具が求める表示（クレジットや、AIで作ったことの表示）をサイトに載せること
- 素材の正本を置く場所。`docs/brand/astarot/mascot/`に正本を置き、サイトには書き出したものを写します（S-11）。今の表情の画像（`site/public/manual/mascot/`）も、マニュアルを転送のページにする段で`site/public/mascot/`へ移します

## 5. 段階的な進め方

各段は1つから3つのPRにします。どのPRも、ビルドとPagesの4つの検査を通し、その段だけで公開できる状態でマージします。

| 段 | 中身 | 前提 | 公開される変化 |
|---|---|---|---|
| 0 | この提案（文書だけ） | — | なし |
| 1 | 規則に合わない言い方を直す（P-10）。`content.mjs`の古いページの名前も直す（#704） | なし。ほかの段と並べて進められる | 文章だけ |
| 2 | 土台の移行（ADR-016）。VitePressをRspressに替え、日英のURL、節のアンカー、検索、GitHub Pagesへの公開を保つ。Markdownの中で部品を使うページを`.mdx`にし、ページとトップの部品をReactに写す。検索と見出しのリンクの検査をRspressの出力に合わせる。`/manual/`をこの段で転送にするかは段2のPRで決める | なし | 土台。見た目は今の部品の形を保ったまま、Rspressのテーマの上に載る |
| 3 | トークン。`tokens.css`（ダークとライト）、`--rp-c-*`の割り当て、色をトークンに置き換える、配色の検査、DESIGN.mdの「The user guide (site/)」の更新 | 段2 | 紺からDark Plumへ。OSの設定に合わせたライトの表示と切り替えのボタン |
| 4 | 基本の部品（`Button`、`Badge`、`Kbd`、`Card`、`Item`、`Alert`、`Separator`、`Spinner`、`Collapsible`、`Table`）。今の部品の見た目を置き換え、Markdownの囲みを`Alert`で描く。止まった表情をM-2とM-3に置く | 段3 | 囲みとボタンの見た目 |
| 5 | 操作の部品（`DropdownMenu`、`Tabs`、`Tooltip`、`Dialog`、`InputGroup`）。`DownloadButton`を1つにし、`OsTabs`、`Term`、`CopyText`、`ShotZoom`、言語のメニューを作り直す | 段4 | メニュー、タブ、吹き出し |
| 6 | 情報構成。6aでサイドバーと上部のバー（URLは変えない）、6bでトップのページをまとめる、6cで`/manual/`を転送のページにしてマニュアルの部品を消す（段2で転送にしたときは6cはない） | 段5 | 並びとトップ。`/manual/`が転送に変わる |
| 7 | 検索の画面の見た目を`Command`と`Empty`にならわせる（Rspressの`SearchPanel`にスタイルを当てる） | 段4 | 検索の見た目 |
| 8 | 画像と動画。Dark Plumのアプリでスクリーンショットを撮り直し（`tools/docs_screenshots.py`）、`site/motion/src/theme.ts`をトークンに合わせて動画を書き出し直し、声と文字の流れの図と経路の帯の色を直す | 段3。アプリの画面がDark Plumで撮れること | 画像と動画 |
| 9 | マスコットの組み込み（`MascotStage`、M-1） | 段6b。動くモデルが4.3の条件を満たすこと | トップのマスコットが動く |

- 段1はほかの段を待たずに出せます。#673と同じページに触れるので、#673のあとにマージします。
- 段3で、配色の正本がアプリと同じになります。段3から段8までの間、スクリーンショットと動画は紺のアプリのままです。段は番号の順に進め、段8を段3のすぐあとには回しません（2026-11-19に決定。決めたときの番号では段7と段2）。
- 段6の情報構成は、部品がそろってから組み替えます。トップのページを新しい部品で一度だけ作り直すためです。
- 段2でVitePressを外すので、VitePress 2への移行（#690の案B）は行いません。段3から段7は、Rspressの内部ではなくレイアウトのスロットとCSSの変数に頼る作りにします。

### 各段で確かめること

- `site/`で`npm run build`と、Pagesのワークフローの4つの検査
- 段3以降: 配色の検査（色相、彩度、コントラスト）
- 段4以降: 部品のファイルに色の値を直接書いていないことの検査、日英の文言のキーの検査
- ブラウザでの確認: 幅360 px、768 px、1280 pxで、横にはみ出さないこと。キーボードだけでメニュー、タブ、吹き出し、ダイアログ、検索を操作できること。フォーカスが見えること。動きを減らす設定で動きが止まること。ライトとダークの両方
- ブラウザの種類: Chromium系とFirefoxに加えて、WebKit系（Safari）でも確かめます。手元で確かめられないものは、PRに「確かめていない」と書きます

## 決まったこと

2026-11-19に、次のことがすべてこの文書で推したA案に決まりました。退けた案は、あとで同じ問いを考え直すときのために残します。

| 番号 | 決めたこと | 決まった案 | 退けた案 | 理由 |
|---|---|---|---|---|
| 土台 | サイトの土台 | Rspress（React）に替える（2026-11-20） | VitePressのまま、Vueで部品を作る | アプリのUIとshadcn/uiがReactなので、部品と知見をReactに一本化します。詳しくは[ADR-016](../../adr/adr-016-user-guide-site-on-rspress.md) |
| 方向 | 見直しの進め方 | ガイドとマニュアルを1つにし、段に分けて作り替える（決めたときは8段。2026-11-20に土台の移行を段2として足し、9段にした） | マニュアルの章に本文を書いてガイドを減らす。両方を残して見た目だけそろえる | 本文があるのはガイドで、配布済みのアプリもガイドのURLを開きます。マニュアルは英語のページが検索エンジンとJavaScriptのない読み手に見えません |
| 順序 | 段の順序 | 5章の番号のとおり。画像と動画の段を、トークンの段のすぐあとには回さない（決めたときの番号では段7と段2、今は段8と段3） | 画像と動画の段をトークンの段のすぐあとに回す | トークンの段から画像と動画の段までの間は、紺のアプリの画像がDark Plumのページに載ります。画像と動画の段は、アプリの画面をDark Plumで撮れることが前提です |
| S-01 | ライトとダークの扱い | OSの設定に合わせ、切り替えのボタンも付ける | ダークだけ（今のガイド）。OSの設定に合わせ、ボタンは付けない（今のマニュアル） | #371で承認したマニュアルはライトとダークの両方に対応しています。読み手が明るい場所で長い文を読むときにライトを選べます。ダークはアプリと同じ値なので、アプリとの見た目はダークでそろいます |
| S-02 | ダークの値をDESIGN.mdから書き出すか | `tools/site_tokens.mjs`で書き出し、`--check`をCIで実行する | 手で写す | アプリの配色が変わったときに、サイトが古い値のまま残ることを防げます。紺のまま残った今の状態（P-05）がその例です |
| S-03 | サイドバーのまとまり（1.2） | アプリの設定のメニューの名前にそろえた6つ | 今の5つのまま並びだけ直す | アプリと同じ名前で探せます |
| S-04 | 経路の帯と図の色の意味 | 帯は方向で色分けせず、そのページの段だけをLilacで示す。方向は帯の名前（「自分から相手へ」）で示す。声と文字の流れの図は、アプリの「入力と出力」の図と同じ線の色（声、チャット、読み上げ）にする | 方向の色分けを残し、色だけをブランドに寄せる | Lilacは選んだもの（このページ）を示す色としてアプリと同じ意味になります。図はアプリの画面と同じ色の言葉で読めます。方向は今も帯の名前で書いてあるので、色を外しても意味は失われません |
| S-05 | マニュアルのトップの「5つの柱」と「案内役とコールアウトの見かた」 | どちらもトップから外す。サブタイトルはワードマークに残し、表情と囲みの見かたは「ASTAROTとは」の末尾に置く | トップに残す | トップを短くし、目次と機能の紹介を先に見せます。5つの柱は機能の紹介と内容が重なります |
| S-06 | 囲みの種類と表情 | GitHubの5種類（note、tip、important、warning、caution）と畳んだ補足。表情は種類ごとに付ける | マニュアルの6種類（うまくいかないときを含む）。表情を付けない | VitePressがMarkdownで書ける種類と一致します（2026-11-19の時点の理由。Rspressでの書き方は段4で確かめる）。「うまくいかないとき」はページの型（1.6）の節で扱えます。Markdownでの書き方は決めていません（2.2） |
| S-07 | 見出しの書体 | 本文と同じ書体 | Outfitが入っているPCだけOutfit | 読み手のPCによって見出しの形が変わらなくなります。ブランドの書体はワードマーク（画像）で示せます |
| S-08 | `/manual/`の転送のページをいつまで残すか | 期限を決めずに残す | 次の正式版まで残して消す | リポジトリの中に`/manual/`へのリンクはありません（2026-11-19に確認）。ただし0.5.0から公開しているので、ブックマークや検索エンジンから来る読み手がいる可能性があります。転送のページは小さく、残しても手間が増えません |
| S-09 | 操作の部品の振る舞いを自前で書くか | 自前のcomposable（Reactではhook）とネイティブの要素 | Reka UIなどのヘッドレスの部品を入れる | サイトに要る操作はメニュー、タブ、吹き出し、ダイアログの4つで、今のコードに土台があります。依存とライセンスの確認も増えません |
| S-10 | 動くマスコットの受け入れの条件 | 4.3の条件（転送の量、ライセンス、生成AIの表示、正本の場所）。形式は成果物が分かってから、段9でこの条件に照らして決める | — | 2026-11-19の時点で、動くモデルの形式がこのリポジトリから分かりません |
| S-11 | マスコットの素材の正本の場所 | `docs/brand/astarot/mascot/` | `site/`の中だけ | アイコンやロゴと同じく、ブランドの素材として1か所で管理できます |
