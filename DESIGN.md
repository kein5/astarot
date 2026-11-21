---
name: ASTAROT Dark Studio
description: A quiet dark plum workspace for conversation and voice control.
colors:
  primary: "#a47af5"
  primary-hover: "#b897f7"
  focus: "#d9c8fc"
  canvas: "#261633"
  rail: "#1c0f27"
  surface: "#332341"
  border: "#4e3d5d"
  field-border: "#877a94"
  text: "#fafafc"
  secondary-text: "#cfc4d6"
  description-text: "#aba0b5"
  state-active: "#b797f8"
  state-warning: "#d4a162"
  state-failed: "#e4938e"
  readout-rule: "#a47af5"
typography:
  body:
    fontFamily: "Configured UI font, Noto Sans, system-ui, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 400
    lineHeight: 1.5
  heading:
    fontFamily: "inherit"
    fontSize: "2rem"
    fontWeight: 600
  category-heading:
    fontSize: "2rem"
    fontWeight: 600
  subheading:
    fontSize: "1.5rem"
    fontWeight: 600
  item-label:
    fontSize: "1.4rem"
    fontWeight: 500
  description:
    fontSize: "1.2rem"
    fontWeight: 400
    lineHeight: 1.6
  body-large:
    fontSize: "1.6rem"
    fontWeight: 400
  title:
    fontSize: "1.8rem"
    fontWeight: 600
  readout:
    fontSize: "1.3rem"
    fontWeight: 500
    fontFeature: "tabular-nums"
  display:
    fontSize: "2.4rem"
    fontWeight: 650
  vr-small:
    fontSize: "16px"
  vr-body:
    fontSize: "19px"
  vr-title:
    fontSize: "22px"
  vr-symbol:
    fontSize: "26px"
  hexagram-small:
    fontSize: "12px"
  hexagram-menu:
    fontSize: "13px"
  hexagram-label:
    fontSize: "14px"
rounded:
  hairline: "2px"
  small: "4px"
  control: "8px"
  composer: "12px"
  dialog: "12px"
spacing:
  xsmall: "4px"
  small: "8px"
  medium: "16px"
  large: "24px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  env-readout:
    backgroundColor: "{colors.surface}"
    borderLeft: "3px solid {colors.readout-rule}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
    height: "40px"
---

## Overview

**Creative North Star: "Dark Studio"**

The user chose a complete redesign on 2026-10-30. Its navy palette gave way to the ASTAROT brand colors in dark plum and lilac on 2026-11-18. Conversation and audio control take precedence over visual effects. Keep familiar chat, settings and native window controls in the existing React/CSS-module application.

**Key Characteristics:**
- A deep rail separates navigation from the conversation workspace.
- Lilac identifies primary actions, selected navigation and keyboard focus.
- Shared forms make TTS, RVC and model downloads feel part of the same application.

## Principles

**The layout explains, not the text (#614).** What a part of the screen is, what it belongs to and what state it is in are shown by where it sits and by its shape, size, color and motion. A secondary label or a line of explanation is added only where the layout cannot carry the meaning. A longer explanation is not kept on screen: it goes in a tooltip that opens on mouse-over (and on keyboard focus), and its words stay in the control's accessible name or description.

This takes away no word that carries a meaning: a control keeps its name, a readout still states its condition in words, consent stays visible, and color never says something alone. New screens, the information architecture (#554) and the components (#452) start from this principle. Rules below that predate it, such as the visible first sentence of a general description, stay until the screens are reviewed against it.

A settings page reviewed against it wraps its rows in `HintDescriptions` (`_components/hint/Hint.tsx`). A general description is then a hint: a small question mark after the item label (or an option's name, or a heading), and the words in a tooltip that opens while the pointer is on the label and while the row has keyboard focus; a heading's mark takes focus itself. A setup fold's description (`SetupSection`'s `desc`) is the hint of its title, which opens while the fold's summary has keyboard focus too, and a checkbox drawn with its name beside it (`HintCheck`) carries its hint after the name. The words stay the control's accessible description. Where a row's field goes under its label (narrow content or window), the tooltip opens above the label so it does not cover the field. What must be seen before acting stays on screen: consent and license text before a download, a voice's credit terms, a warning, the value in use (`keepDescription`, `keep_desc`), what a disabled action waits for, and a state of this session, which is a readout. What leaves the PC, and what a switch changes beyond itself, is said in one sentence that stays on screen, and its details are the hint after that sentence, not after the label: the bubble opens under the sentence, so the sentence stays in view beside them (a row's `lead`; `Lead` by itself, whose mark takes focus, where no row carries it). The control is described by the sentence, then the details. Said this way: what the usage data sends, what an LLM engine is sent (once, at the head of the translation page's 「詳細設定」), that the app asks for a new version at each start, and that the tray companion makes the app start in the tray. The form that adds a translation API shows the whole text about the LLM engines, as it is read before the API is added. An action that the user starts keeps on screen only what is known before pressing: the GPU report says how long it takes, what it leaves alone and that nothing is sent by itself, and what it is for, how it measures and what its result holds are its heading's hint. A row is named by the thing it holds; what pressing its button does is the button's own name and tooltip (`ActionButton`'s `action_label`, opened by the pointer and by keyboard focus), not words in brackets in the row's name, as with the WebSocket and OBS addresses and their copy buttons. A note for those who use a feature is shown only while the feature is on: that the OBS address changed, while the OBS browser source is enabled. Reviewed so far: Device, Appearance, Hotkeys, VRChat, Captions and VR, Chat reading, Speech recognition, Text to speech, Voice changer, Advanced settings, Translation, Experimental features, Updates and About ASTAROT: every page of the settings. About ASTAROT holds no setting, so it has no rows to wrap; what it shows is what the app is, its relation to the upstream project, the people behind that project and the VRChat disclaimer, which are attribution and notices, not descriptions of a control.

## Colors

The palette comes from the three ASTAROT brand colors (`docs/brand/astarot/`): Dark Plum `#261633`, Lilac `#A47AF5` and Off-White `#FAFAFC`. Where the brand has a color that fits a role, the token takes that color as it is. Where it has none, the token is Dark Plum or Lilac with only its lightness changed: its OKLCH hue stays within 3° of that brand color's (Dark Plum 308°, Lilac 297°), and its chroma does not exceed the brand color's. So no derived color leans toward another hue or is more vivid than its source.

| Token | From the brand |
|---|---|
| `canvas` | Dark Plum |
| `rail` | Dark Plum, darker |
| `surface`, `border`, `field-border` | Dark Plum, lighter |
| `primary`, `readout-rule` | Lilac |
| `primary-hover`, `state-active`, `focus` | Lilac, lighter |
| `text` | Off-White |
| `secondary-text` | The grey that outlines the color swatches on the brand board |
| `description-text` | The subtitle of the dark horizontal logo |
| `state-warning`, `state-failed` | None; see below |

The grey and lilac steps that components use directly (`dark_*` and `primary_*` in `variables.css`) are derived the same way, the greys from Dark Plum and the lilacs from Lilac, and the greys get darker as their number grows. Only the brand's own values (Off-White and the secondary and description text greys) and plain white are taken as they are. `brandPalette.test.ts` checks every step.

Use the canvas for conversation and settings, the deeper rail for navigation, and raised surfaces for fields. Borders separate working regions without heavy cards. Enable state is also expressed by labels and switch position.

The brand has no warning or error colors. Warning and failed keep amber and red, the hues that carry their meaning, since a lilac or plum one would read as the active state. They take the OKLCH lightness of the active lilac (0.74) and a lower chroma (0.10), so the three readout states carry the same weight and Lilac stays the most vivid color.

Contrast (WCAG 2.x, measured on the canvas, the surface and the rail): text, secondary text, description text and the three state colors reach 4.5:1 or more; Lilac reaches 4.5:1 on the surface. Text on a Lilac fill is Dark Plum (5.4:1), because white on Lilac is only 3.1:1. A field's border (`field-border`, `--vox_field_border`) is also the only edge of an outlined control: a switch's track and the quiet and danger buttons. It reaches 3.5:1 against the surface, the field's own fill, and 3:1 against every ground a field sits on: the canvas, the rail, the dialogs and the language list (`dark_875`) and a switch's track (`dark_850`). The brand board's label grey (`#777082`) reached only 3.04:1 on the surface and 2.86:1 in a dialog, so the field border is Dark Plum made lighter instead. Hairlines between regions (`border`) may stay below 3:1. A color that misses these numbers is fixed by lightness within its hue, not by leaving the brand hue.

## Typography

Keep the user's configured UI font, scaling and log-font preferences. Local Noto/system fallbacks support Japanese without remote font requests. Section headings give long forms a readable hierarchy; technical paths wrap inside their containers.

Text in the app window takes the sizes in the front matter's `typography` (#568): 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2 and 2.4rem (the last only for the empty conversation's greeting). A size in between is moved to the nearest step, not added; small marks and tooltips use 1.2rem. Sizes relative to their parent (em, %) follow the parent, such as the log, whose base size the log font size setting replaces. The desktop caption overlay draws its captions at the size its user picks; its one fixed text, the size shown while the overlay is moved, takes a step in px (1.4rem is 14px), because that window does not follow the UI size. The tray companion's hexagram has steps of its own (below). `src-ui/views/app/fontSteps.test.ts` checks the app window and the caption overlay, in stylesheets and in vanilla-extract files (ADR-010) alike, sizes inside a `font` shorthand included.

The VR panel draws into the headset in pixels of its own, which the window's width in VR scales: at the default sizes a pixel is about 0.44 mm (the log window is 0.4 m wide for 900px, and the toolbar keeps that scale). It has four steps of its own, the front matter's `vr-*` (#568):

| Step | Use |
|---|---|
| 16px | Small text: the line under a name, notes and reasons, the settings' menu and section names, tooltips, marks such as L and R |
| 19px | Body: a row's name and value, the words on buttons |
| 22px | Window titles, and numbers read at a glance (presets, the steppers' and the toolbar's values) |
| 26px | Buttons that are only a symbol (−, +, A−, A＋, ›) |

Each step is about 1.17 times the one under it, so two steps differ at a glance; weight and color tell text of one step apart. 16px is the smallest: running text such as notes and tooltip help was already 16px, and only marks and short abbreviations were smaller. A size in between moves to the nearest step, not added. Left out are the log's text, which is the size picked with A−／A＋ (14 to 28px, 17px by default); the inputs and outputs window, which draws the desktop flow view (rem) 1.1 times larger; and the one-line and multi-line subtitle overlays, pictures that the native overlay draws at sizes of their own (`native/vr-overlay/src/subtitle.rs`). `src-ui/views/vr/fontSteps.test.ts` checks the VR panel.

The tray companion's hexagram (an experimental feature) is a small window at the screen's edge, drawn in px of its own that do not follow the UI size. It has three steps of its own, the front matter's `hexagram-*` (#568):

| Step | Use |
|---|---|
| 12px | The state beside a feature's name on its label (オン, オフ, 未準備), and the common settings' title |
| 13px | The common settings: their rows and buttons |
| 14px | A feature's name on its label |

The steps are the sizes the hexagram had when they were named. They are close to one another, so weight and opacity tell them apart as well: the name on a label is bold, the state beside it fainter. `src-ui/views/companion_handle/fontSteps.test.ts` checks the hexagram, in stylesheets and vanilla-extract files alike.

Each of the hexagram's triangles carries its feature's icon, the one the main window's switch has, upright while the hexagram turns (#536). A feature that is off has an Off-White triangle and icon. A feature that is on turns its triangle Lilac, every edge of the outline and a faint tint of the plate inside it (16%), and its icon Lilac too (4.2:1 against the tinted plate). Its outline is drawn over the hexagon in the middle and the neighbouring triangles, whose lines it shares, so that none of its edges shows their white. So that it does not rest on colour alone, the outline of that triangle is also thicker (4px instead of 2.4px). A docked label marks a feature that is on with Lilac too. `src-ui/views/companion_handle/CompanionHandle.test.ts` checks the icons.

Nothing inside a VR window opens a tooltip: the VR tooltip is drawn for the launcher and the toolbar only. So in the windows, what a control is and what it acts on are said by where it stands and by a mark, not by a line under its name (#614). The choice of the hand the launcher is on draws each hand as the toolbar does, the right one mirrored. A fold's summary is the values in use (the processing device and type; the speaker's record limit, phrase wait and queue). The language window's swap stands on the recipients' heading line, between your language above and recipient 1 below, the two it exchanges, between an up and a down arrow as on the main screen; its accessible name still names both. The recipients' rows are 64px tall so that three of them, the line under them and the translator stay in the window with the swap; every laser target stays at least 56px tall. A line stays under a name only for a state, a warning, the reason a control is unavailable, or what no placement can say (the switch that turns the tooltips off). On the launcher, a tooltip that carries what is said nowhere else shows even when the tooltips are turned off: a blocked switch's missing setup, and the log button's, which is the only place that says its long press recalls the log.

## Layout

The regular main rail is 240px and the settings rail is 208px. At the existing 800px scaling-aware breakpoint, main navigation uses a 72px icon rail; its toggle can temporarily expand the rail to reach the language controls without changing the saved compact preference. The expanded rail lies over the conversation, which keeps its width, and closes with Escape (focus returns to the toggle) or a press outside it. Returning to a wide window clears that temporary expansion. The rail is a column: the logo, a scrolling part, and the settings button at its foot; the scrolling part shows a visible thumb whenever it has more below. In the wide rail, the language settings put their heading and the three presets on one row, and each language is a small heading over a field-like button, so one target language and the translator fit without scrolling at 1280×720, also with all six switches shown (`test_one_target_language_and_the_translator_fit_the_rail_at_1280x720`). Between the two languages, the swap button says 「言語を入れ替え」 / "Switch languages" at rest, between an up and a down arrow, and is drawn as a button sized to its words (the raised surface and hairline of the plain buttons, 2.4rem tall), so it is recognised without pointing at it and does not read as a third field (#569). That the pair is translated both ways is said by each language, not by the swap button: a language field's tooltip and accessible description say what its language is for, both ways (「自分が話したり入力したりする言語です。相手の発言はこの言語に訳します。」 for yours, 「相手が話したり書いたりする言語です。自分の発言はこの言語に訳します。」 for theirs), and the language list shows the same words as one line under its search field, which they describe. The rail gets no line of its own for this, so it keeps its height. The translator choice opens under its button inside the rail, opaque and as tall as its engines, and the rail scrolls to it. A switch that is on carries a lilac tint on its row and a lilac icon, in both rails; the icon rail also names each switch in a tooltip and shows the selected language pair under the switches, which opens the rail when pressed. A switch that is off and still misses its setup (a model, the speech source, the voice route) is greyed out and does nothing when pressed; its tooltip says what is missing and where to provide it. In the wide rail each feature's icon is its own button beside the switch: it opens the place that provides a missing setup, otherwise the feature's settings (the translator list for translation), and its name and tooltip say where it goes. It is drawn as a button at rest (the raised surface and hairline border of the plain buttons), not only on hover or focus. Nothing is added under a switch, so the rail does not move when the engine's state arrives. When the engine is gone, every switch is greyed out for the one same reason, and the rail says it once (#766): an environment readout at the head of the switches, 「エンジンとの接続が切れました」 / "Engine disconnected", which the icon rail draws as a warning mark that takes keyboard focus, with the words as its name and its tooltip. No line is added under a switch for it, so no row grows and the words are announced once; each switch keeps them in its accessible name and its tooltip. Nothing is said while the engine is still starting. A switch that is on is never greyed out, so it can always be turned off. The uses picked in settings (usage presets, #554) choose which switches are in sight; a switch that is on or changing is in sight whatever is picked. The others are under a quiet 「ほかの機能（n）」 / "Other features (n)" row after the switches, an icon in the icon rail, which shows all six in their usual order and hides them again; showing them is not saved and changes no setting. The VR launcher's function buttons follow the same blocks: greyed out with an amber warning mark, with what is missing and where in the PC settings to provide it in the button's tooltip, which shows even when the VR tooltips are turned off. Settings use a 56px rail that expands for keyboard focus or hover; focus from a click does not keep it open after the pointer leaves. The settings menu groups its pages under four quiet headings, in the order a conversation uses them (#554): 会話の基本 / Conversation (translation, speech recognition, VRChat, captions and VR), 声と読み取り / Voice and reading (TTS, RVC, chat reading), 使い心地 / Ease of use (devices, design, hotkeys) and アプリ / App (updates, advanced, experimental, about). In the 56px rail a hairline stands where each heading is, so the tabs do not move when the rail expands; the groups keep their names for screen readers. Above the groups, 「用途」 / "Used for" is a button at rest that names the uses picked and opens, under it in the rail, a list of checkboxes, each with a line on what the use is for; several can be picked and the last one cannot be unpicked. The menu then shows the pages those uses need, and a group left without a page loses its heading. Design, hotkeys and the app's own pages are always in the menu, and so is the page open now, also when the search or a main page button opened it. The icon rail shows the button's icon and closes the list. Small windows scroll rather than dropping controls.

A feature is named by what it does, with its short technical name in brackets: テキスト読み上げ（TTS） / Text to speech (TTS), ボイスチェンジャー（RVC） / Voice changer (RVC), 音声認識（ASR） / Speech recognition (ASR), チャット読み取り（OCR） / Chat reading (OCR). The main switch, its settings page, its hotkey and the user guide use the same name. Where the name does not fit on one line, it breaks before the bracket (`splitFeatureLabel`), never inside a word; the rail keeps its width. In the wide rail a switch's name has room for nine full-width characters beside its toggle, with the rail's scrollbar drawn, so 「ボイスチェンジャー」 stays on one line also in a font whose kana are full width. The settings menu is the exception: each tab is one line, so all tabs are one height, and a feature's tab shows its name without the bracket, which stays in the tab's tooltip and accessible name and in the page's own heading. A sentence that sends the user somewhere quotes the full name; other sentences may use the short name.

The main top bar leads with the stop actions (stop TTS, mute), in the same place at every window size. The window and VRChat toggles (always on top, VRChat microphone mute sync, subtitle overlay) open from one quick settings button on the right, which says how many of them are on; a toggle that cannot be used says why under its row. Under the toggles a readout says in words whether a VRChat with OSC enabled is seen on this PC, with the step that turns OSC on when it is not; the VRChat settings page opens with the same readout. When the conversation column is narrower than 64rem the bar draws its shortest words and the quick settings button keeps only its icon; accessible names and tooltips stay the full words. The column's width decides, not the window's, so the 240px rail and the UI size are accounted for (container queries on the column; rem follows the UI size). The stop actions never shrink below their words. The quick settings panel is sized by the column and scrolls inside itself when the column is short. When a newer version is out, an update button stands before these buttons and opens the update page. That a version is out is a state, so it is shown, not announced in the bar (#766): the update icon carries a mark on its corner and the button says the short word with the version, 「更新 0.6.1」 / "Update 0.6.1"; the sentence 「新しいバージョンが出ました！」 / "New version is ready!" is its tooltip and its accessible description. A narrow bar keeps the icon and its mark, and the words stay the accessible name.

The conversation occupies the largest region. In a very wide window the log and the composer keep a measure of at most 120rem, centred in the column; the send button stays square (at most 10rem) at the composer's foot. A short column (under 36rem, which includes the 200px minimum window) gives its height to the log: the top bar, the logo row and the language selector's bar are 4.4rem, the margins are thinner and the composer keeps one line; the inputs and outputs panel then lies over the conversation instead of pushing it out. In taller columns that panel takes at most 60% and shrinks before the log does. What the panel shows and how its GPU memory is read are hints, not lines of the panel (#614): a question mark after the panel's title and after the readout's heading, with the settings' bubble, which opens while the pointer is on the heading and while the mark has keyboard focus. The title's bubble opens under it and the readout's above it at every width, because the panel clips what leaves it. An empty conversation shows a greeting, a heading alone: where to type is not said in words, because the composer under it says so by its place and its placeholder (#614). The greeting stands at a fixed distance from the top of the log, set by the window's height, so the list under it and the composer taking its saved height at startup never move it. An empty log is not scrolled to its end, so a list that grows past the log's height does not scroll the greeting up. In the main window the greeting keeps its room but is drawn only once the saved UI size, the saved language and the narrow layout they bring are in place (the last two are waited for at most a second), so it is first seen where and as it stays, and once drawn it is not hidden again; in the main window it also lists the models the selected engines still need, each with a button that opens the step that provides it (the download review, or the speech recognition settings where the local speech recognition models are set), and, under the list, one line on enabling OSC in VRChat. That line is a state, not standing help (#614): it stands only while the app finds no VRChat with OSC on, the condition under which the quick settings' readout shows the same step, and it goes away by itself when VRChat is found. While that is not known (not answered yet, OSCQuery off, messages going to another machine) or sending to VRChat is off, it is not drawn, so it never shows at startup only to go away. A line of that list says only what is missing; where to go is the name of its button, not a second sentence (#614). The composer has a lilac send action. Settings have a conventional back button, search and aligned sections. Field labels stack below 700px. Dialogs constrain their width to the viewport and keep explicit consent visible.

Notices (toasts) do not cover controls. On the main page they appear at the top of the conversation, under the top bar and beside the rail, so the switches, the settings button and the composer stay reachable while a notice is up. In settings they appear at the bottom of the content column, clear of the save bar and the rail. A notice that is already showing moves with the page. Only a window too narrow to hold a readable notice beside the rail lets it slide over the rail.

The main page's tooltips are the common `Tooltip` (`common_components/tooltip`), not `title` attributes, which only the pointer opens (#766): the rail, both top bars' stop and mute, the top bar's buttons, the send button and the title bar. A tooltip opens while the pointer is on its control and while the control has keyboard focus (not the focus a click leaves behind); a press, Escape, Enter or Space puts it away, so it never covers what the control opens. Its bubble has the app's one tooltip look and is drawn at the end of the page, placed in the window from the control's box: beside the rail for the rail's controls (a feature's icon too, level with its row, so the bubble does not cover the switch's name), under the bar for the top bar and the title bar, over the composer for the send button. It moves to another side when it does not fit and stays inside the window, so the scrolling rail and a narrow bar clip nothing of it and the layout does not move. A tooltip does not repeat words that are in sight on its control: the quick settings button has one only where a narrow bar hides its words, and the swap button, whose words are always shown, has none. The bubble is a picture of words the control already carries for screen readers, its name or a description that stays in the page (`aria-describedby`), and is not read itself. The title bar's three buttons show their names this way, so the close button says 「閉じる（トレイで動き続けます）」 / "Close (keeps running in the tray)" before it is pressed where closing keeps the app in the tray. The words of the log itself (speaker names, readings) still use `title`. `src-ui/views/app/main_page/mainTooltips.test.ts` keeps `title` attributes off these controls.

## Roles in settings

Settings pages use four roles, and each must be recognizable without reading it. The user approved these on 2026-11-01.

| Role | Look | Use |
|---|---|---|
| Category heading | 2rem / 600, text color, 40px above and 16px below, hairline to the right; the first heading on a page sits right under the top bar | One per page section (TTS, RVC, Mic) |
| Subheading | 1.5rem / 600, secondary text, 24px above and 8px below, no frame | Groups inside a section (Monitor, Japanese TTS voice) |
| Item label | 1.4rem / 500, text color, wraps | The name of one setting |
| General description | 1.2rem / 400, description text, its first sentence visible; the rest goes in a "詳細" disclosure. On a page reviewed against #614: a question mark after the label and a tooltip (see "Principles") | What a setting does, true on every PC |
| Environment readout | 1.3rem / 500, tabular numbers, surface background, 3px left rule, 8px radius | What this PC and this session report now: GPU and memory, server state, download progress, model support |

A readout states its condition in words; its color repeats the words (active lilac, warning amber, failed red) and never replaces them. Frames are kept for real units, such as one server or engine; groups inside a section are separated by space and a subheading, not by nested borders. One-time setup (model files, servers, downloads) sits in one folded "モデルとサーバー" section per page with a one-line status. On the translation page, and for the API engines on the speech recognition page, each provider is one such fold whose line says whether it can be used; the provider in use stays open. A page opens on the choice that decides what else on it applies: speech recognition starts with the engine. Its options are listed under the engine's two systems, 「お使いのPCで動かす（speech.cpp）」 / "On your PC (speech.cpp)" and 「API（クラウドや自分のサーバー）」 / "API (cloud or your own server)", and the page then shows the two systems in that order, each under a subheading: speech.cpp with its 「モデルとサーバー」, then the API providers' folds (#414), as the translation catalog groups what translates (#413). What the user added (a registered model, their own Whisper server) carries the catalogs' dashed badge; what the app provides carries none. Each switch on the main page has a settings page of the same name; chat reading has its own page, and the VRChat page ends with a button that opens it. Numbers that are set once, if ever (how speech is cut into messages), sit in a fold whose line shows the values in use. A page opens on what a first start needs (#554). What is set once to taste comes after that and after its 「モデルとサーバー」, in one 「詳細設定」 / "More settings" fold drawn like that fold, whose line shows a few values in use (on/off, counts, numbers). Groups inside a fold use subheadings, not category headings. A fold opens by itself only for something in use (the translation API a language preset uses), and can still be closed. A fold marks its line with the unsaved-row rule while a row inside it has unsaved edits. A setting has one place: another page that touches it has a row whose button names that page and opens it on the setting, with the folds around it opened, as a search result does. Such a button has one label that quotes the page's name as its tab has it and says what is done there, 「「デバイス」で音声経路を変更」 / "Change the audio route on the Device page", or 「「チャット読み取り（OCR）」を開く」 when the whole page is the reason to go; the tab's icon leads the words (#537). A button that only names the action reads as if it acted in place. The row's line then says what the setting does, not where it is set. On the captions and VR page (#568), 「一行」／「複数行」 in its 「詳細設定」 chooses which subtitle overlay the rows under it set, like a pair of tabs; each overlay is turned on by its own checkbox at the top of the page (#554). The position and rotation diagram is one row of the label and field columns: its name and description on the left, the 位置／回転 switch and the diagram centred in the field column; the row stacks when the page is narrower than 72rem, since the diagram's axis names reach out of its square. The sample text has its own row, with a plain button in the field column.

The settings top bar, like the main one, always offers the stop actions: stop TTS (clears the queue) and mute the app's voice output. They are quiet until there is something to stop. Its save bar is the one place to save: text fields register their edits there instead of carrying their own save buttons, and Enter still saves the field being edited. The bar shows the state and a count; the changed rows carry a short lilac rule on their left, and the names are in the bar's tooltip and its screen-reader list.

Settings save in two ways, chosen by the control, not by the page (#436). A form (typed fields, the voice, route and server forms) saves from the save bar. A single checkbox, choice or slider outside a form applies as soon as it changes, since there is nothing to type or review. A page without any form (design, captions and VR, hotkeys) says "このページの変更はすぐに反映されます" where the save bar would be, so the two are told apart before anything is changed. Opening a page never puts a change in the save bar, and saving one field never switches what a feature does: a choice like "use RVC for direct voice" is its own button next to the note that asks for it.

Mute has one name everywhere: 「ミュート」 / "Mute" on both top bars at every width, as the voice route row's label and in the hotkey 「ミュートの切り替え」 / "Mute or unmute". What it silences (TTS, or the whole virtual microphone) is in its tooltip and the row's description, not in its name. The row's buttons are 「ミュートする」 / "Mute now" and 「ミュートを解除」 / "Unmute", and notices that send users there quote 「ミュートを解除」.

Stop has one name too (#476): 「読み上げを停止」 / "Stop speech" on both top bars, the TTS page's status and the hotkey. Only the main top bar's narrowest layout shortens it to 「停止」 / "Stop"; its accessible name and tooltip stay the full words, and the tooltip adds that the queue is cleared.

## Elevation & Depth

Group controls with spacing, alignment and quiet borders. A dim backdrop identifies modal scope. Avoid decorative elevation in routine forms.

## Shapes

Controls have gently curved edges; the composer has a slightly larger radius. Preserve user window-corner preferences. Corners take the `rounded` steps (2, 4, 8 and 12px); the only other radius is a bar's or a track's round end (half its height), and the chat box preview's bubble, which imitates VRChat's.

## Components

Native buttons carry actions and accessible names. Focus rings remain visible, native checkbox state remains recognizable, and select menus use the dark scheme.

One control per job (#436, chosen from what most of the app already used):

- A setting on a settings page is turned on or off with a checkbox (`Checkbox`, `CheckboxContainer`). Inside a row of other controls, such as a device's "自動選択", the checkbox carries its name beside it (`show_label`). Switches (`role="switch"`) are for the main page's features, the VR panel and the tray companion's panel (an experimental feature), which turn a function on or off; the quick settings rows say オン／オフ in words, like their button's "すべてオフ".
- Where a checkbox sits (#473): a setting row outside a form puts it at the row's right end, flush with the fields' right edge (the box carries no inset there). Inside a form (the voice, server and speech recognition forms) it sits at the left with its name beside it (`checkLabel`), and its description follows under it.
- Where a button sits (#473, #478): a button that acts on the fields above it (refresh a list, start or stop a server, check a model, register, start the input) starts in the control column, where those fields start (`FormRow` actions, or `control_column`). A row that only leads elsewhere, such as the audio route on the TTS and RVC pages, is a `FormRow`: the label and what is in use on the left, the button in the control column (`PagePointer`, its button `PageLinkButton`, which looks the same on every page). Buttons never follow a sentence at the end of its line. On a card (one model or engine) the card's own action leads its row of actions, so it is in the same place on every card.
- Button looks (#474): a filled button is an action; the lilac one is the step a dialog or form exists for (start, save, consent). The outline (`quiet`) is the secondary action paired with a filled one, such as stop beside start; it is never used alone. A button that opens a review before a download is 「取得内容を確認」 / "Review download" and plain (not lilac) wherever it appears, since nothing downloads until the review's own button is pressed.
- Field widths (#567): every setting row, inside a form or not, has the same two columns, the label (1fr) and the field (1.6fr) with 1.6rem between them, so a field starts at the same place on every page; the row stacks below 42rem of content or a 700px window. A field whose value has no fixed length (a choice from a list, a URL, an API key, a path, a window title, a hotkey, a font) fills the field column, beside at most its own buttons (a hotkey's delete). A device's 「自動選択」 heads the field column, its box where the lists start, over the lists it chooses for, on the microphone and the speaker alike. A field for a short value of known length (a port, an IP address, a number, a threshold) keeps a short width, at most 14rem, from the column's start. A lone button starts in the field column, a checkbox ends it (#473), and a row of composed controls without a label (the message format, the word list) spans both columns. The shared row styles are in `src-ui/views/app/config_page/setting_section/setting_box/_templates/Templates.module.scss`.
- Every choice from a list is the forms' field: the raised surface, a hairline border, the control radius, 40px tall, and the list opens on the same surface. The older `DropdownMenu` draws the same field, so an empty one (no device found) still shows.
- A list of what was found, such as the first-run setup's 「いまの状態」 (#557), is shadcn/ui's Item list, and its layout tells what needs the user before any word is read. The findings that need the user come first, each a card of its own with the warning's amber rule on its left and its tint, a 2.4rem mark and the name at full strength (1.5rem / 600). The rest (ready, being checked, or neither) follow in one quiet frame with a hairline between rows, smaller (a 1.8rem mark, the name at 1.3rem) and in the secondary and description colors. With nothing to do there is no card at all. A row is a state mark, the item's name over what was found, and its action under those words, where they start; a button never follows the words on their line. The mark repeats the words and never replaces them: a lilac disc with a check (ready), an amber disc with "!" (the user has something to do, and the words say what), the readout's spinning arc (being checked), or a quiet ring (neither, such as a choice made elsewhere).
- A catalog of models or engines (the model catalogs on the speech recognition, text to speech and voice changer pages, the speech engines a user installs, the models the user registered, and the entries of the translation catalog) lays out each card so that what it is, its state and what it offers are read before its words (#614). The name and the state badge share the first line, the state at its end, in the same place on every card; what speaks for or against the model (recommended for, fits the memory, may be too heavy) is a line of badges under the name, then the model's one- or two-line summary and its warning. The file type and the facts (languages, size, hardware, provider and license) are one table whose terms take one width (14rem) on every card, so a value starts at the same place down the list; the file type, or its choice, is the table's first row. The actions come after them and start at the card's edge. A card in more than 80rem of content puts the file and the facts on its right and what the model is and what can be done on its left, so it is read across; a narrower one, such as in the translation review, keeps one column, and under 42rem of content its terms go over their values, as the forms' rows stack. The card in use has the active color on its frame and the lilac tint, as a switch that is on. A use's heading carries what the use is for and how to choose in it as its hint; what the GPU reading says for the use (a readout of this session), the voices' credit terms and the warnings stay on screen. The measured memory and where it was checked are the hint of the hardware term. A card without facts, such as an entry the app ships in the translation catalog, is its name's line alone, with its kind beside the name and the state at the line's end.

Words: English headings, labels and options use sentence case; only names and acronyms keep their capitals (VRChat, OBS Browser Source, API key). Text addressed to the user speaks of their PC as 「お使いのPC」 / "your PC", or leaves the PC out where it adds nothing; never 「このPC」 / "this PC" (#437). Japanese text writes 「メモリ」, not 「メモリー」 (#472), and 「オン」／「オフ」, not ON／OFF (#476). Japanese text puts no space between Japanese and a Latin word or name (「VRChatのチャットボックス」, 「APIキー」); a space stays before a unit (「120 ms」) and around a URL or file name that would otherwise run into the sentence. An English word inside Japanese text is translated unless it is a name: 「字幕オーバーレイ」, not 「Overlay」 (#476). A value the engine uses internally is shown in the screen's words (「CPU」, 「自動」), never as its raw id. What was tested is said in the user's words (which GPU, what is not checked yet), not as a test record (#472). Settings transfer focus into their navigation and back to the settings trigger. Transitions are short (about 120 ms) and disabled under reduced-motion preferences; a pressed control changes color at once, without a transition. An action that waits on the engine shows its pending state as soon as it is pressed and ignores repeat presses until it settles. A radio choice that waits reads as disabled (`aria-disabled`) but stays focusable, so the keyboard focus stays on the option just chosen. A choice whose options fall into kinds lists them under the kinds' names as one radio set: the arrow keys move through every kind and Tab stops once.

Motion uses the tokens in `variables.css`: `--vox_motion_fast` (120 ms), `--vox_motion` (220 ms), `--vox_ease`, and `--vox_ease_settle`, which overshoots by at most 2%. It shows where something comes from or that it worked, never decoration:

- A dropdown's list drops from its field and settles, with its first rows following one another. On engines that can style a select's list (WebView2), the forms' native selects open the same way and still open below the field when it fits; WebKitGTK keeps its system list.
- Work that ends in success (a model download, a runtime setup, a server start) has a mark before its readout's words: an arc that spins while it runs, then a lilac disc with a check that draws itself if it finished while the page was open.
- A path field that takes files can have a drop place above it (`FileDropZone`). It wakes while files are dragged over the window, lifts under the pointer, and on a drop fills the fields and says what went where. The fields stay the way to type a path, and the save bar stays the way to save.

There is no splash screen. While the engine starts, the main page is drawn at its real layout but is inert and busy: values the engine has not sent yet are flat placeholders of their own size (`[data-skeleton]`, `--vox_skeleton`), so nothing moves when they arrive. Their pulse is slow and faint and stops under reduced motion. The first screen's setup list says how far the start has come and which models it is fetching. A failed start is a dialog over that page with the reason, the next step, a retry and a quit action; it is not modal, so the title bar stays usable.

Quick Chat and the VR panel inherit shared colors without changing input/audio contracts. TTS/RVC/download forms share field, action and status styling. A persistent saved compact-mode preference remains separate from the temporary narrow-window layout.

Components are aligned with the components of [shadcn/ui](https://ui.shadcn.com/) as far as the rules in this file allow (2026-11-19). From its shadcn counterpart a component takes:

- its design: the parts it is made of, their props, and how its variants and sizes are cut and named;
- its look: spacing, sizes, borders, and how hover, focus, invalid, disabled and open states are drawn;
- its structure: one file per component with its parts as named exports, a `data-slot` attribute naming each part, and its variants in one recipe.

Where shadcn/ui offers a component on more than one base, the Radix one is read. [shadcn.io](https://www.shadcn.io/), the reference named before (#614), is a separate site built on shadcn/ui with the same tokens; its components can be read as examples, but shadcn/ui is the one aligned with.

What does not change: the styles are written in vanilla-extract, and Tailwind is not added. The colors are the ASTAROT palette above. Radix parts are used as they are, with the same primitives in the same arrangement. Nothing from shadcn is taken in as a dependency (no CLI, no `components.json`); its code is translated by these rules:

- Tailwind classes become `style()` in the component's `.css.ts`. A `cva()` becomes a `recipe()` from `@vanilla-extract/recipes` with the same variant names and defaults, and `cn()` becomes `clsx`.
- shadcn/ui's color tokens (`primary`, `muted`, `accent`, `border`, `input`, `ring` and the rest) stand for ASTAROT tokens; no shadcn color value is used. The app has only the dark scheme, so where shadcn/ui gives a `dark:` value, that value is the one read.
- A length is taken at its pixel size. Tailwind's rem is 16px and the app's is 10px, so `h-9` (36px) is `3.6rem` and `px-3` (12px) is `1.2rem`. A radius or a text size then moves to the nearest step of this file (`rounded`, `typography`).
- A part that passes a ref uses `forwardRef`, since the app is on React 18; shadcn/ui writes for React 19, which takes `ref` as a prop. Radix comes from its own `@radix-ui/react-*` package, as the app already has it.
- shadcn/ui's enter and exit animations (`animate-in`, `fade-in`, `zoom-in`) become keyframes on the motion tokens (`--vox_motion` and the rest), off under reduced motion.
- A Radix part that adds a `<style>` at run time needs the CSP step in `docs/development.md`.

Where a shadcn component and a rule in this file differ, such as the button looks (#474), a checkbox for a setting (#436), the 40px field or the focus ring, the rule here stays until it is changed on purpose. Components are compared with shadcn/ui one by one before any of them is changed (`docs/design/components/shadcn-alignment.md`), and a difference that needs a decision is decided there, not by the translation.

[OptiAxiom](https://github.com/optimizely-axiom/optiaxiom) stays the reference for what shadcn/ui, written in Tailwind, has no counterpart for: how the tokens are cut in vanilla-extract and how recipes and sprinkles are written.

Code is copied in only after its license is checked and recorded (`docs/voice-stack/licensing.md`). shadcn/ui is under the MIT license, so the first component aligned with it records shadcn/ui there and in `NOTICE.md`. shadcn.io names no license for its free components.

## The user guide (site/)

The guide is a reading surface in the same Dark Studio, chosen on 2026-11-15 after an impeccable and unslop audit found it read as stock VitePress. The world owns the frame, and the reading column stays calm: about 40 Japanese characters a line, the reader's own fonts (no web font; the theme's Inter is not used), real contrast.

- The signature is the route strip at the top of each voice and text feature page and each audio-route page: the steps voice or text passes through, with this page's step lit. Blue lanes are what you send, purple lanes what comes back, as in the how-it-works diagram. A page names its route in front matter (`route: tts`); the routes are in `site/theme/lib/routes.ts`.
- Section headings are the settings' category heading: the title with a hairline running to the right, no rule above.
- Callouts, "what you need" lines (`{.needs}`) and folds sit on the raised surface with a hairline all round. State color lives in the title and a tint of the border, amber for warnings and red for danger; no thick side stripe.
- A short list of features is `{.feature-rows}`: the name, which is the link, in its own column and one line of what it does.
- The product name on the home page is solid text at the largest size; buttons use the control radius (8px), not pills.
- Under it, each feature sits beside a short loop of its route (`showcase` in the home page's front matter). The loops are rendered with Remotion from `site/motion` into `site/public/motion/<lang>/`: one worked example per feature, the diagram growing one part at a time as the signal reaches it, held long enough to read, then leaving so the loop starts empty. A loop plays only while it is on screen; with reduced motion the page shows the finished scene as a still. The text beside a loop carries the meaning; the loop never says anything the text does not.

## Do's and Don'ts

- Do preserve model consent, dirty-form guards, independent switches and stop/mute behavior.
- Do check Japanese labels, long paths, keyboard navigation and narrow windows using production components.
- Do retain the distinction between configured, pending, active and failed states.
- Don't add a secondary label or an always-visible explanation where the layout can carry the meaning; a longer explanation goes in a tooltip (`Hint`).
- Don't introduce remote fonts or a new UI framework for this redesign.
- Don't imply connection, model readiness or microphone activity through decorative indicators.
