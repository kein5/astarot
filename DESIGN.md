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
  group: "12px"
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

[日本語版](#astarotのデザイン日本語版)

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

A settings page reviewed against it wraps its rows in `HintDescriptions` (`_components/hint/Hint.tsx`). A general description is then a hint: a small question mark after the item label (or an option's name, or a heading), and the words in a tooltip that opens while the pointer is on the label and while the row has keyboard focus; a heading's mark takes focus itself. A setup fold's description (`SetupSection`'s `desc`) is the hint of its title, which opens while the fold's summary has keyboard focus too, and a checkbox drawn with its name beside it (`HintCheck`) carries its hint after the name. The words stay the control's accessible description. Where a row's field goes under its label (narrow content or window), the tooltip opens above the label so it does not cover the field. A row whose field says what is wrong with it under the field opens its tooltip above the label too, so it does not cover the problem while the field keeps the focus. What must be seen before acting stays on screen: consent and license text before a download, a voice's credit terms, a warning, the value in use (`keepDescription`, `keep_desc`), what a disabled action waits for, and a state of this session, which is a readout. What leaves the PC, and what a switch changes beyond itself, is said in one sentence that stays on screen, and its details are the hint after that sentence, not after the label: the bubble opens under the sentence, so the sentence stays in view beside them (a row's `lead`; `Lead` by itself, whose mark takes focus, where no row carries it). The control is described by the sentence, then the details. Said this way: what the usage data sends, what an LLM engine is sent (at the head of the translation page's API part, and in the form that adds a translation API, where it is read before the API is added), that the app asks for a new version at each start, and that the tray companion makes the app start in the tray. The GPU report keeps what it is for, how it measures, what its result holds and what to know before pressing in its heading's hint. A row is named by the thing it holds; what pressing its button does is the button's own name and tooltip (`ActionButton`'s `action_label`, opened by the pointer and by keyboard focus), not words in brackets in the row's name, as with the WebSocket and OBS addresses and their copy buttons. A note for those who use a feature is shown only while the feature is on: that the OBS address changed, while the OBS browser source is enabled. Reviewed so far: Device, Appearance, Hotkeys, VRChat, Captions and VR, Chat reading, Speech recognition, Text to speech, Voice changer, Advanced settings, Translation, Experimental features, Updates and About ASTAROT: every page of the settings. About ASTAROT holds no setting, so it has no rows to wrap; what it shows is what the app is, its relation to the upstream project and thanks to it (the project's logo and links, without a list of people, #1222), and the VRChat disclaimer, which are attribution and notices, not descriptions of a control. The disclaimer is shown in the UI's language only; in a language other than English, its English original is in a fold under it (#1266).

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
| 12px | The state beside a feature's name on its label (オン, オフ, 未準備, 切り替え中…, 切り替えられませんでした), and the common settings' title |
| 13px | The common settings: their rows and buttons; the line the hexagram says the first time it comes out |
| 14px | A feature's name on its label |

The steps are the sizes the hexagram had when they were named. They are close to one another, so weight and opacity tell them apart as well: the name on a label is bold, the state beside it fainter. `src-ui/views/companion_handle/fontSteps.test.ts` checks the hexagram, in stylesheets and vanilla-extract files alike.

Each of the hexagram's triangles carries its feature's icon, the one the main window's switch has, upright while the hexagram turns (#536). A feature that is off has an Off-White triangle and icon. A feature that is on turns its triangle Lilac, every edge of the outline and a faint tint of the plate inside it (16%), and its icon Lilac too (4.2:1 against the tinted plate). Its outline is drawn over the hexagon in the middle and the neighbouring triangles, whose lines it shares, so that none of its edges shows their white. The outline is as wide whether the feature is on or off (2.4px; 3.2px while its label is docked out, white when it is off and Lilac when it is on): the maintainers chose colour alone here. Lilac and Off-White differ in lightness as well as in hue (3:1). A docked label marks a feature that is on with Lilac too. `src-ui/views/companion_handle/CompanionHandle.test.ts` checks the icons.

The hexagram answers every touch of the pointer, so that what happened is seen where the user looks (#536). A triangle under the pointer lights up at once, in its own colour (Off-White 20%, Lilac 34%), and its icon grows by a fifth, before its label docks out; pressed, it lights up more, switches its feature as its label does, and docks its label at once, without the rest that hovering takes, so that the label says what happened. A pressed label gives (95%). After a press on either, the label says 切り替え中… and neither can be pressed again until the main window answers, at most 4 seconds; the triangle is faint meanwhile. A request that could not be sent says 切り替えられませんでした for 3 seconds. A switch that turns on flashes Lilac in its triangle, one that turns off flashes Off-White, fading in 0.8 seconds to the colour it has then, and its icon grows and settles back; this shows a change made in the main window or by a hotkey too. With reduced motion, the flash, the growing icon and the giving label are left out; the colours and the words stay.

The first time the hexagram ever comes out, it says ホイールで回すと、ほかの3つが出ます for 5 seconds, in a pill with Lilac edges where the common settings open, so that the three triangles turned away are found (#536). It takes no pointer, and the wheel or a docked label ends it sooner. The main window keeps that it has been said (`TRAY_COMPANION_WHEEL_HINT_SHOWN`); until the main window has the setting, nothing is said. The pill uses the 13px step.

Nothing inside a VR window opens a tooltip: the VR tooltip is drawn for the launcher and the toolbar only. So in the windows, what a control is and what it acts on are said by where it stands and by a mark, not by a line under its name (#614). The choice of the hand the launcher is on draws each hand as the toolbar does, the right one mirrored. A fold's summary is the values in use (the processing device and type; the speaker's record limit, phrase wait and queue). The language window's swap stands on the recipients' heading line, between your language above and recipient 1 below, the two it exchanges, between an up and a down arrow as on the main screen; its accessible name still names both. The recipients' rows are 64px tall so that three of them, the line under them and the translator stay in the window with the swap; every laser target stays at least 56px tall. A line stays under a name only for a state, a warning, the reason a control is unavailable, or what no placement can say (the switch that turns the tooltips off). On the launcher, a tooltip that carries what is said nowhere else shows even when the tooltips are turned off: a blocked switch's missing setup, and the log button's, which is the only place that says its long press recalls the log.

## Layout

The regular main rail is 240px and the settings rail is 208px. At the existing 800px scaling-aware breakpoint, main navigation uses a 72px icon rail; its toggle can temporarily expand the rail to reach the language controls without changing the saved compact preference. The expanded rail lies over the conversation, which keeps its width, and closes with Escape (focus returns to the toggle) or a press outside it. Returning to a wide window clears that temporary expansion. The rail is a column: the logo, a scrolling part, and the settings button at its foot; the scrolling part shows a visible thumb whenever it has more below. The settings menu shows the same thumb when its pages go on below the window (#1266 ★7). In the wide rail, the language settings put their heading and the three presets on one row, and each language is a small heading over the kit's plain button at the compact size, with the language and an arrow centered (decided on 2026-11-25). Between the two languages, the swap button says 「言語を入れ替え」 / "Switch languages" at rest, between an up and a down arrow, and is the kit's plain button at the compact size, sized to its words, so it is recognised without pointing at it and does not read as a third field (#569). Removing and adding a target language are the kit's icon buttons. With the kit's sizes, at 1280×720 with all six switches shown, the rail scrolls to reach the translator (decided on 2026-11-24, #1123). That the pair is translated both ways is said by each language, not by the swap button: a language field's tooltip and accessible description say what its language is for, both ways (「自分が話したり入力したりする言語です。相手の発言はこの言語に訳します。」 for yours, 「相手が話したり書いたりする言語です。自分の発言はこの言語に訳します。」 for theirs), and the language list shows the same words as one line under its search field, which they describe. The rail gets no line of its own for this, so it keeps its height. The translator choice opens as an opaque popover beside the rail, anchored to its button and clamped to the window (closing with Escape, a press outside, or focus leaving it), so neither the rail nor the conversation moves (#1095). A switch that is on carries a lilac tint on its row and a lilac icon, in both rails; the icon rail also names each switch in a tooltip and shows the selected language pair under the switches, which opens the rail when pressed. A switch that is off and still misses its setup (a model, the speech source, the voice route) is greyed out and does nothing when pressed; its tooltip says what is missing and where to provide it. What the switches cannot see before they are pressed is fixed where they are, too (decided on 2026-11-26, #1225): a Mic input or Listening switch refused because speech recognition misses something opens a dialog with the actions that fix it, not a notice that names a settings page. Missing recognition models lead to the first-run setup; a language the model does not take is chosen there from the model's own languages, after which the switch turns on again; on the bundled server, a model that tells the language by itself is offered through the catalog's review and turns the switch on once it is applied. A download never starts without its review showing its size. Each dialog also opens the exact setting. In the wide rail each feature's icon is its own button beside the switch: it opens the place that provides a missing setup, otherwise the feature's settings (the translator list for translation), and its name and tooltip say where it goes. It is drawn as a button at rest (the raised surface and hairline border of the plain buttons), not only on hover or focus. Nothing is added under a switch, so the rail does not move when the engine's state arrives. When the engine is gone, every switch is greyed out for the one same reason, and the rail says it once (#766): an environment readout at the head of the switches, 「エンジンとの接続が切れました」 / "Engine disconnected", which the icon rail draws as a warning mark that takes keyboard focus, with the words as its name and its tooltip. No line is added under a switch for it, so no row grows and the words are announced once; each switch keeps them in its accessible name and its tooltip. Nothing is said while the engine is still starting. A switch that is on is never greyed out, so it can always be turned off. The uses picked in settings (usage presets, #554) choose which switches are in sight; a switch that is on or changing is in sight whatever is picked. The others are under a quiet 「ほかの機能（n）」 / "Other features (n)" row after the switches, an icon in the icon rail, which shows all six in their usual order and hides them again; showing them is not saved and changes no setting. The VR launcher's function buttons follow the same blocks: greyed out with an amber warning mark, with what is missing and where in the PC settings to provide it in the button's tooltip, which shows even when the VR tooltips are turned off. Settings use a 56px rail that expands for keyboard focus or hover; focus from a click does not keep it open after the pointer leaves. The settings menu groups its pages under four quiet headings, in the order a conversation uses them (#554): 会話の基本 / Conversation (translation, speech recognition, VRChat, captions and VR), 声と読み取り / Voice and reading (TTS, RVC, chat reading), 使い心地 / Ease of use (devices, design, hotkeys) and アプリ / App (updates, advanced, experimental, about). In the 56px rail a hairline stands where each heading is, so the tabs do not move when the rail expands; the groups keep their names for screen readers. Above the groups, 「用途」 / "Used for" is a button at rest that names the uses picked and opens, under it in the rail, a list of checkboxes, each with a line on what the use is for; several can be picked and the last one cannot be unpicked. The menu then shows the pages those uses need, and a group left without a page loses its heading. Design, hotkeys and the app's own pages are always in the menu, and so is the page open now, also when the search or a main page button opened it. The icon rail shows the button's icon and closes the list. Small windows scroll rather than dropping controls.

A feature is named by what it does, with its short technical name in brackets: テキスト読み上げ（TTS） / Text to speech (TTS), ボイスチェンジャー（RVC） / Voice changer (RVC), 音声認識（ASR） / Speech recognition (ASR), チャット読み取り（OCR） / Chat reading (OCR). The main switch, its settings page, its hotkey and the user guide use the same name. Where the name does not fit on one line, it breaks before the bracket (`splitFeatureLabel`), never inside a word; the rail keeps its width. In the wide rail a switch's name has room for nine full-width characters beside its toggle, with the rail's scrollbar drawn, so 「ボイスチェンジャー」 stays on one line also in a font whose kana are full width. The settings menu is the exception: each tab is one line, so all tabs are one height, and a feature's tab shows its name without the bracket, which stays in the tab's tooltip and accessible name and in the page's own heading. A sentence that sends the user somewhere quotes the full name; other sentences may use the short name.

The main top bar leads with the stop actions (stop TTS, mute), in the same place at every window size. The window and VRChat toggles (always on top, VRChat microphone mute sync, subtitle overlay) open from one quick settings button on the right, which says how many of them are on; a toggle that cannot be used says why under its row. Under the toggles a readout says in words whether a VRChat with OSC enabled is seen on this PC, with the step that turns OSC on when it is not; the VRChat settings page opens with the same readout. When the conversation column is narrower than 64rem the bar draws its shortest words and the quick settings button keeps only its icon; accessible names and tooltips stay the full words. The stop keeps 「読み上げを停止」 / "Stop speech", and mute its 「ミュート中」 / "Muted" badge, down to a 56rem column, so the default window (a 63rem column) says what the stop stops (#1314). The column's width decides, not the window's, so the 240px rail and the UI size are accounted for (container queries on the column; rem follows the UI size). The stop actions never shrink below their words. The quick settings panel is sized by the column and scrolls inside itself when the column is short. When a newer version is out, an update button stands before these buttons and opens the update page. That a version is out is a state, so it is shown, not announced in the bar (#766): the update icon carries a mark on its corner and the button says the short word with the version, 「更新 0.6.1」 / "Update 0.6.1"; the sentence 「新しいバージョンが出ました！」 / "New version is ready!" is its tooltip and its accessible description. A narrow bar keeps the icon and its mark, and the words stay the accessible name.

The conversation occupies the largest region. The log and the composer take the column's whole width at every window width, so they grow with the window, as the top bar does; they have no maximum width (decided on 2026-11-26, #1223). The send button stays square (at most 10rem) at the composer's foot. The log's font size has A− and A＋ at the composer's start, away from the send button, so a press meant for them never sends. They step the size along the marks of the settings' slider (10% at a time, from 40 to 200%), and each button's name, which its tooltip shows, says the size now (#1314). The panel that hangs over the log keeps the slider, inset so that its end marks stay inside it. A short column (under 36rem, which includes the 200px minimum window) gives its height to the log: the top bar, the logo row and the language selector's bar are 4.4rem, the margins are thinner and the composer keeps one line; the inputs and outputs panel then lies over the conversation instead of pushing it out. In taller columns that panel takes at most 60% and shrinks before the log does. What the panel shows and how its GPU memory is read are hints, not lines of the panel (#614): a question mark after the panel's title and after the readout's heading, with the settings' bubble, which opens while the pointer is on the heading and while the mark has keyboard focus. The title's bubble opens under it and the readout's above it at every width, because the panel clips what leaves it. An empty conversation shows a greeting, a heading alone: where to type is not said in words, because the composer under it says so by its place and its placeholder (#614). The greeting stands at a fixed distance from the top of the log, set by the window's height, so the list under it and the composer taking its saved height at startup never move it. An empty log is not scrolled to its end, so a list that grows past the log's height does not scroll the greeting up. In the main window the greeting keeps its room but is drawn only once the saved UI size, the saved language and the narrow layout they bring are in place (the last two are waited for at most a second), so it is first seen where and as it stays, and once drawn it is not hidden again; in the main window it also lists the models the selected engines still need, each with a button that opens the step that provides it (the download review, or the speech recognition settings where the local speech recognition models are set), and, under the list, one line on enabling OSC in VRChat. That line is a state, not standing help (#614): it stands only while the app finds no VRChat with OSC on, the condition under which the quick settings' readout shows the same step, and it goes away by itself when VRChat is found. While that is not known (not answered yet, OSCQuery off, messages going to another machine) or sending to VRChat is off, it is not drawn, so it never shows at startup only to go away. A line of that list says only what is missing; where to go is the name of its button, not a second sentence (#614). The composer has a lilac send action. Settings have a conventional back button, search and aligned sections. Field labels stack below 700px. Dialogs constrain their width to the viewport and keep explicit consent visible.

Notices (toasts) do not cover controls. On the main page they appear at the top of the conversation, under the top bar and beside the rail, so the switches, the settings button and the composer stay reachable while a notice is up. In settings they appear at the bottom of the content column, clear of the top bar and the rail. A notice that is already showing moves with the page. Only a window too narrow to hold a readable notice beside the rail lets it slide over the rail.

The main page's tooltips are the common `Tooltip` (`common_components/tooltip`), not `title` attributes, which only the pointer opens (#766): the rail, both top bars' stop and mute, the top bar's buttons, the send button and the title bar. A tooltip opens while the pointer is on its control and while the control has keyboard focus (not the focus a click leaves behind); a press, Escape, Enter or Space puts it away, so it never covers what the control opens. Its bubble has the app's one tooltip look and is drawn at the end of the page, placed in the window from the control's box: beside the rail for the rail's controls (a feature's icon too, level with its row, so the bubble does not cover the switch's name), under the bar for the top bar and the title bar, over the composer for the send button. It moves to another side when it does not fit and stays inside the window, so the scrolling rail and a narrow bar clip nothing of it and the layout does not move. A tooltip does not repeat words that are in sight on its control: the quick settings button has one only where a narrow bar hides its words, and the swap button, whose words are always shown, has none. The bubble is a picture of words the control already carries for screen readers, its name or a description that stays in the page (`aria-describedby`), and is not read itself. The title bar's three buttons show their names this way, so the close button says 「閉じる（トレイで動き続けます）」 / "Close (keeps running in the tray)" before it is pressed where closing keeps the app in the tray. The maximize button draws what pressing it does, as Windows does: a square while the window can be maximized, and the restore icon, two overlapping squares, while it is maximized; its name and tooltip, 「ウィンドウを最大化・元に戻す」 / "Maximize or restore window", are the same in both states (#1258). Beyond the main page, every element that takes focus gets this tooltip, not a `title` (D-21 of the shadcn/ui comparison): the settings menu, the voice sample buttons and the button that names the speakers in the log. The usage presets button of the narrow settings rail has neither: the rail widens as soon as the pointer or the focus reaches it, and shows the button's words. Only the readings of the log's words (ruby), which take no focus, still use `title`. `src-ui/views/app/main_page/mainTooltips.test.ts` keeps `title` attributes off these controls, and in every screen but the VR UI leaves `title` only on the readings.

The settings have a window of their own beside the main window (#1236). It is drawn as the main window is, with the app's title bar, which names it 「ASTAROTの設定」 / "ASTAROT Settings"; its close button closes only it and asks nothing, as the settings save by themselves (#1111). There is one at most: the settings button, a button that opens a setting, and the tray (its menu, its control panel, the hexagram's menu) open it, or bring it to the front at the page asked for. The main window stays in sight and usable beside it, and nothing pauses while the settings window is open (decided on 2026-11-26): the features keep running, Quick Chat opens, and the hotkeys work, except while the window shows the Hotkeys page, where the keys pressed are being recorded. The settings window has no "Go back"; its close button is the way out. When the engine's run ends, the settings window stays, its page out of reach under a warning readout that says the engine is disconnected, and it connects again when the main window starts the engine. It remembers its own place and size; the first time, it is centred on the main window's monitor at the main window's first size. In a browser (development, the integration tests) the settings stay a page of the main window, as before.

## Roles in settings

Settings pages use four roles, and each must be recognizable without reading it. The user approved these on 2026-11-01.

| Role | Look | Use |
|---|---|---|
| Category heading | 2rem / 600, text color, 40px above and 16px below, hairline to the right; the first heading on a page sits right under the top bar | One per page section (TTS, RVC, Mic) |
| Subheading | 1.5rem / 600, secondary text, 24px above and 8px below, no frame | Groups inside a section (Monitor, Japanese TTS voice) |
| Item label | 1.4rem / 500, text color, wraps | The name of one setting |
| General description | 1.2rem / 400, description text, its first sentence visible; the rest goes in a "詳細" disclosure. On a page reviewed against #614: a question mark after the label and a tooltip (see "Principles") | What a setting does, true on every PC |
| Environment readout | 1.3rem / 500, tabular numbers, surface background, 3px left rule, 8px radius | What this PC and this session report now: GPU and memory, server state, download progress, model support |

A readout states its condition in words; its color repeats the words (active lilac, warning amber, failed red) and never replaces them. Frames are kept for real units, such as one server or engine; groups inside a section are separated by space and a subheading, not by nested borders. One-time setup (model files, servers, downloads) sits in one folded "モデルとサーバー" section per page with a one-line status. Inside it, what a first start takes comes first (the runtime, the default models to download), and the paths of files of one's own come last, in a 「自分のモデル」 / "Your own model" fold with the link that explains them (#1266 ★5): on the speech recognition, text to speech and voice changer pages alike. On the translation page, and for the API engines on the speech recognition page, each provider is one such fold whose line says whether it can be used; the provider in use stays open. A page opens on the choice that decides what else on it applies: speech recognition starts with the engine. Its options are listed under the engine's two systems, 「お使いのPCで動かす（speech.cpp）」 / "On your PC (speech.cpp)" and 「API（クラウドや自分のサーバー）」 / "API (cloud or your own server)", and the page then shows the two systems in that order, each under a subheading: speech.cpp with its 「モデルとサーバー」, then the API providers' folds (#414), as the translation catalog groups what translates (#413). Translation starts the same way, with the engine of the language preset in use, the main screen's choice (#1266): 「お使いのPCで動かす」 / "On your PC" holds the model and its device, then the catalog's models; 「API（クラウドや自分のサーバー）」 holds the providers' folds, the servers the user runs among them, then the APIs the user added. Text to speech keeps the rows every reading needs first, then the ways to read, then 「お使いのPCで動かす（speech.cpp）」 and 「外部のサーバーとエンジン」 / "External servers and engines". What the user added (a registered model, their own Whisper server) carries the catalogs' dashed badge; what the app provides carries none. Each switch on the main page has a settings page of the same name; chat reading has its own page, and the VRChat page ends with a button that opens it. Numbers that are set once, if ever (how speech is cut into messages), sit in a fold whose line shows the values in use. A page opens on what a first start needs (#554). What is set once to taste comes after that and after its 「モデルとサーバー」, in one 「詳細設定」 / "More settings" fold drawn like that fold, whose line shows a few values in use (on/off, counts, numbers). Groups inside a fold use subheadings, not category headings. A fold opens by itself only for something in use (the translation API a language preset uses), or for setup that the page's feature cannot work without and that is not done yet, and can still be closed. What a page needs first is in sight without opening anything, and folds hold the details and advanced settings. A setup fold starts open, and opens when the setup becomes needed, while: speech recognition uses the bundled server and its models are not set; a voice of text to speech comes from the bundled server and has no model; the voice changer has no runtime, no model or no route for its voice; chat reading lacks a model of the chosen language (#1230). Optional parts stay folded, such as the chatbox detector's model and input forwarding in the voice changer's 「詳細設定」. A setting has one place: another page that touches it has a row whose button names that page and opens it on the setting, with the folds around it opened, as a search result does. Such a row comes after the page's own controls and its 「モデルとサーバー」, as the audio route does on the text to speech and voice changer pages; on the voice changer page, the monitor's row is in its 「詳細設定」 (#1230). Such a button has one label that quotes the page's name as its tab has it and says what is done there, 「「デバイス」で音声経路を変更」 / "Change the audio route on the Device page", or 「「チャット読み取り（OCR）」を開く」 when the whole page is the reason to go; the tab's icon leads the words (#537). A button that only names the action reads as if it acted in place. The row's line then says what the setting does, not where it is set. On the captions and VR page (#568), 「一行」／「複数行」 in its 「詳細設定」 chooses which subtitle overlay the rows under it set, like a pair of tabs; each overlay is turned on by its own switch at the top of the page (#554). The position and rotation diagram is one row of the label and field columns: its name and description on the left, the 位置／回転 switch and the diagram centred in the field column; the row stacks when the page is narrower than 72rem, since the diagram's axis names reach out of its square. The sample text has its own row, with a plain button in the field column.

The settings top bar, like the main one, always offers the stop actions: stop TTS (clears the queue) and mute the app's voice output. Stop is drawn at half strength until there is something to stop. Beside them, every settings page except About says 「このページの変更はすぐに反映されます」 / "Changes on this page apply at once", since every setting saves by itself (#1111). Its words take two lines at most in a box as high as the controls, so the muted badge that widens the mute button moves nothing (#1266 R-4).

What a category heading heads sits on one rounded ground of its own (`rounded.group`), framed by a quiet line, as one group of settings; the rows inside keep a quieter rule between them, and a row that stands on a page outside any section is such a group too (#1233). The settings pages draw their lines quieter than the rest of the app, from the theme's own tokens: the frame (and every border that uses the border color there, such as a fold's, a card's or a plain button's) is the border color mixed 62% with the canvas, the rule between rows 50%, and the ground lies half way between the canvas and the surface. Field outlines keep their contrast (see "Colors"). A group's content keeps the insets a fold gives what it holds, so its fields start and its controls end where they do in a fold.

Every setting saves by itself; there is no save button and no "saved" notice (#1111).

- A text field saves on Enter or when focus leaves it, once its check accepts the value. Escape puts the saved value back.
- An API key or another credential left empty keeps the saved one: only Enter on the empty field deletes it.
- Fields saved together save as one group when focus leaves the group and every field in it is accepted, or on Enter. These are the TLS certificate and key, an address and its key, and the voice, route, server and caption forms. A choice, a switch or a list edit in a group saves at once, and a slider when it is let go.
- A value a field refuses is never sent. What is wrong and what kind of value would do is said in words under the field, which is marked invalid. A refusal by the core is said there too, not as a notice.
- A field stays usable while a save waits, so focus stays where it was; an edit made meanwhile is saved once that save ends.
- Leaving a page with a refused or unsaved value drops it, and nothing asks first.

Opening a page never saves anything, and saving one field never switches what a feature does: a choice like "use RVC for direct voice" is its own button next to the note that asks for it (#436).

Mute has one name everywhere: 「ミュート」 / "Mute" on both top bars at every width, as the voice route row's label and in the hotkey 「ミュートの切り替え」 / "Mute or unmute". What it silences (TTS, or the whole virtual microphone) is in its tooltip and the row's description, not in its name. The row's buttons are 「ミュートする」 / "Mute now" and 「ミュートを解除」 / "Unmute", and notices that send users there quote 「ミュートを解除」.

Stop has one name too (#476): 「読み上げを停止」 / "Stop speech" on both top bars, the TTS page's status and the hotkey. Only the main top bar shortens it to 「停止」 / "Stop", and only in a column narrower than 56rem; its accessible name and tooltip stay the full words, and the tooltip adds that the queue is cleared.

## Elevation & Depth

Group controls with spacing, alignment and quiet borders. A dim backdrop identifies modal scope. Avoid decorative elevation in routine forms. One dialog is seen at a time: where a dialog opens another from inside it, as the translation review opens its model's review and consent, the first steps back, its dimming too, until the other closes (`Dialog`'s `stepsBack`).

## Shapes

Controls have gently curved edges; the composer has a slightly larger radius. Preserve user window-corner preferences. Corners take the `rounded` steps (2, 4, 8 and 12px); the only other radius is a bar's or a track's round end (half its height), and the chat box preview's bubble, which imitates VRChat's.

## Components

Native buttons carry actions and accessible names. Focus rings remain visible, native checkbox state remains recognizable, and select menus use the dark scheme.

One control per job (#436, chosen from what most of the app already used):

- A setting on a settings page is turned on or off with the kit's switch (`SettingSwitch`, `SwitchContainer`; K-02, decided on 2026-11-25, in place of the checkbox of #436). Inside a row of other controls, such as a device's "自動選択", the switch carries its name beside it (`show_label`). On the settings pages a checkbox is left only where the user confirms consent (a download, a license), and it stays a native input (D-16). Switches (`role="switch"`) also turn the main page's features, the VR panel and the tray companion's panel (an experimental feature) on or off; the quick settings rows say オン／オフ in words, like their button's "すべてオフ".
- Where an on/off control sits (#473, #1096): a setting row outside a form puts its switch at the row's right end, flush with every other control's right edge (the target around the switch has no space after it). Inside a form (the voice, server and speech recognition forms) it sits at the left with its name beside it (`checkLabel`), and its description follows under it.
- Where a button sits (#473, #478, #1096): a button that acts on the fields above it (refresh a list, start or stop a server, check a model, register, start the input) sits in the control column, aligned to the row's right end (`FormRow` actions, or `control_column`), and any note explaining a disabled action sits right-aligned under it in the same column. A row that only leads elsewhere, such as the audio route or monitor on the TTS and RVC pages, is a `FormRow`: the label and what is in use on the left, the button flush at the row's right end (`PagePointer`, its button `PageLinkButton`, which looks the same on every page). A lone action button on a setting row (`ActionButton`, `ActionButtonContainer`, `ConnectionCheckButtonContainer`) also sits flush at the row's right end. Buttons never follow a sentence at the end of its line. On a card (one model or engine) the card's own action leads its row of actions, so it is in the same place on every card.
- Button looks (#474): a filled button is an action; the lilac one is the step a dialog or form exists for (start, save, consent). The outline (`quiet`) is the secondary action paired with a filled one, such as stop beside start; it is never used alone. The stop actions' stop (both top bars and the TTS page) is the `danger` button, red words and no fill (decided on 2026-11-25); with nothing to stop it is drawn at half strength and keeps its tooltip, and a press is answered in its words (「止めています…」 / "Stopping…", then 「止めました」 / "Stopped"). Mute is a toggle that stays pressed, amber while pressed, and its words say so too. A button that opens a review before a download is 「取得内容を確認」 / "Review download" and plain (not lilac) wherever it appears, since nothing downloads until the review's own button is pressed.
- Room for what changes (#912): pressing a control, or an answer arriving, moves nothing around it. A form that adds or registers something (a model of the user's own, a translation engine or API) always keeps one line under its button for the problem a press may find, the height of one line of the problem's frame (its text, padding and border; `problem_slot`). The line is empty until then, so the button and the form stay where they are when the problem appears or goes; a longer problem still takes the lines it needs. Words that change with a state, such as a button's start and stop, a connection check's result or an engine card's state badge, take the width of the widest of them (`StableWords`, `common_components/stable_words`), and a shorter word sits in the middle of that width. A readout's sentence that changes with its state keeps the lines of its longest state in the same way and starts at the start of its line, such as an engine card's readout and the chatbox detector's line.
- Field widths (#567, #1096): every setting row, inside a form or not, has the same two columns, the label (1fr) and the field (1.6fr) with 1.6rem between them, and aligns its control's right edge on one vertical line at the row's right end across every page without exception (switches, lone buttons, inputs, dropdowns and selects, color inputs, radios, sliders, hotkeys and form actions); the row stacks below 42rem of content or a 700px window. A text field whose value has no fixed length (a URL, an API key, a path, a window title, a hotkey) fills the field column (so both edges align), beside at most its own buttons (a hotkey's delete). A dropdown or select keeps a compact width fitted to its content (`20rem` to `32rem`, capped at `100%` in narrow columns) flush at the row's right end instead of stretching across the whole column. A field for a short value of known length (a port, an IP address, a number, a color, a threshold) keeps its short width, at most 14rem, flush at the row's right end; standalone switches, radios and lone buttons sit flush at the row's right end too. A device's 「自動選択」 sits over the lists it chooses for, aligned with them at the row's right end on the microphone and the speaker alike. A row of composed controls without a label (the message format, the word list) spans both columns. The shared row styles are in `src-ui/views/app/config_page/setting_section/setting_box/_templates/Templates.css.ts`.
- Every choice from a list is the forms' field: the raised surface, a hairline border, the control radius, 40px tall, and the list opens on the same surface where the engine lets the page color it. The settings rows' select fields are the kit's `Select` too (D-14), so an empty one (no device found) still shows. A choice among many that is found by name, such as the translation engine (#1369), is the kit's `Combobox`: a button in the same field's look, as wide as its longest choice, that opens a panel with a search field over the choices and their group headings. The choices that cannot be chosen now stay in the list, at half strength.
- A list of what was found, such as the first-run setup's 「いまの状態」 (#557), is shadcn/ui's Item list, and its layout tells what needs the user before any word is read. The findings that need the user come first, each a card of its own with the warning's amber rule on its left and its tint, a 2.4rem mark and the name at full strength (1.5rem / 600). The rest (ready, being checked, or neither) follow in one quiet frame with a hairline between rows, smaller (a 1.8rem mark, the name at 1.3rem) and in the secondary and description colors. With nothing to do there is no card at all. A row is a state mark, the item's name over what was found, and its action under those words, where they start; a button never follows the words on their line. The mark repeats the words and never replaces them: a lilac disc with a check (ready), an amber disc with "!" (the user has something to do, and the words say what), the readout's spinning arc (being checked), or a quiet ring (neither, such as a choice made elsewhere).
- A catalog of models or engines (the model catalogs on the speech recognition, text to speech and voice changer pages, the speech engines a user installs, the models the user registered, and the entries of the translation catalog) lays out each card so that what it is, its state and what it offers are read before its words (#614). The name and the state badge share the first line, the state at its end, in the same place on every card; what speaks for or against the model (recommended for, fits the memory, may be too heavy) is a line of badges under the name, then the model's one- or two-line summary and its warning. The file type and the facts (languages, size, hardware, provider and license) are one table whose terms take one width (14rem) on every card, so a value starts at the same place down the list; the file type, or its choice, is the table's first row. The actions come after them and start at the card's edge. A card in more than 80rem of content puts the file and the facts on its right and what the model is and what can be done on its left, so it is read across; a narrower one, such as in the translation review, keeps one column, and under 42rem of content its terms go over their values, as the forms' rows stack. The card in use has the active color on its frame and the lilac tint, as a switch that is on. A use's heading carries what the use is for and how to choose in it as its hint; what the GPU reading says for the use (a readout of this session), the voices' credit terms and the warnings stay on screen. The measured memory and where it was checked are the hint of the hardware term. A card without facts, such as a model the app ships in the translation catalog, is its name's line alone, with a license that bars commercial use marked beside the name and the state at the line's end. A model's card is pressed anywhere for its main action, in every catalog (#1228, #1254): a model on the PC that is not in use is used, through the same license question as the model list for a translation model, and with its files checked and applied in one step for a speech model; a model not on the PC opens its download review, whose size, license and consent come first. The card in use, and one being downloaded or checked, has nothing to press. The main action's button stretches its hit area over the card, and the card's other controls (the file's choice, Cancel and Apply, the audition, Remove, the facts' fold, links and a hint's mark) sit above it and are pressed on their own. The keyboard and screen readers meet that one button, whose accessible name is its words followed by the model's name, 「取得内容を確認（Qwen3-ASR 0.6B）」 / "Review download (Qwen3-ASR 0.6B)". A model chosen in the list or on a card is read back into the cards (#1228).

Words: English headings, labels and options use sentence case; only names and acronyms keep their capitals (VRChat, OBS Browser Source, API key). Text addressed to the user speaks of their PC as 「お使いのPC」 / "your PC", or leaves the PC out where it adds nothing; never 「このPC」 / "this PC" (#437). Japanese text writes 「メモリ」, not 「メモリー」 (#472), and 「オン」／「オフ」, not ON／OFF (#476). Japanese text puts no space between Japanese and a Latin word or name (「VRChatのチャットボックス」, 「APIキー」); a space stays before a unit (「120 ms」) and around a URL or file name that would otherwise run into the sentence. An English word inside Japanese text is translated unless it is a name: 「字幕オーバーレイ」, not 「Overlay」 (#476). A value the engine uses internally is shown in the screen's words (「CPU」, 「自動」), never as its raw id. What was tested is said in the user's words (which GPU, what is not checked yet), not as a test record (#472). Settings transfer focus into their navigation and back to the settings trigger. Transitions are short (about 120 ms) and disabled under reduced-motion preferences; a pressed control changes color at once, without a transition. An action that waits on the engine shows its pending state as soon as it is pressed and ignores repeat presses until it settles. A radio choice that waits reads as disabled (`aria-disabled`) but stays focusable, so the keyboard focus stays on the option just chosen. A choice whose options fall into kinds lists them under the kinds' names as one radio set: the arrow keys move through every kind and Tab stops once. <!-- writing-exempt: quotes the form the rule rules out -->

Motion uses the tokens in `variables.css`: `--vox_motion_fast` (120 ms), `--vox_motion` (220 ms), `--vox_ease`, and `--vox_ease_settle`, which overshoots by at most 2%. It shows where something comes from, that it worked, or for a moment where to act next, never decoration:

- What opens over the page comes and goes through the kit's motion (`src-ui/views/kit/motion.ts`, on [Motion](https://motion.dev/); #1378), so a screen does not animate it on its own and does not import Motion. A modal dialog fades in (`--vox_motion_fast`) and rises 0.8rem into its place (`--vox_motion`) while its dimming fades in. It closes at once, so the focus goes back as it did before. A popover fades in from 0.4rem toward its button, on the side it opens on, and goes back the same way, quicker; while it goes, it takes no presses. The settings window's pages fade in where they are when they are first drawn, under the title bar the window opened with; the window closes at once. Only the motion is new: what takes the focus, how a surface closes and what screen readers meet stay as they were. With reduced motion nothing moves: these surfaces only fade, and opacity is the only thing that changes.
- On engines that can style a select's list (WebView2), the forms' native selects open their list from the field and let it settle, with its first rows following one another, and still open below the field when it fits; WebKitGTK keeps its system list. The kit's `Select`, which the settings rows use (D-14), opens the system's list on both engines.
- Work that ends in success (a model download, a runtime setup, a server start) has a mark before its readout's words: an arc that spins while it runs, then a lilac disc with a check that draws itself if it finished while the page was open.
- A path field that takes files can have a drop place above it (`FileDropZone`). It wakes while files are dragged over the window, lifts under the pointer, and on a drop fills the fields and says what went where. The fields stay the way to type a path, and a drop saves at once.
- A path field has a button beside it that picks the path on the user's PC (#1231). 「ファイルを選択」 / "Choose file" opens the system's file picker, which shows only the kinds of file the field takes when the field names them, and 「フォルダーを選択」 / "Choose folder" opens the folder picker; the button's accessible name also names the field. The field fills the field column beside the button, whose right edge is the row's; a column too narrow for both puts the button under the field, at the same edge. The picker opens in the folder of the field's path. A picked path fills the field as typing does and is saved when the field's form saves a typed one; a cancel changes nothing; a picker that cannot open is said under the field, which stays the way to type or paste a path. The conversation log destination keeps its row of buttons under its field (#1115), and its pick saves at once.
- The first-run setup leads to the switches of the features it prepared by their toggles, the part to press, not by their rows (#955): a ring of a Lilac gradient round the toggle (round the icon in the icon rail, where the toggle is hidden) blinks three times within five seconds, then stays until the switch is turned on. It does not blink under reduced motion, and it gives way to the focus ring while the switch has keyboard focus. The kit's switch inside it keeps its own look, so it still reads as off.

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
- A part that passes a ref takes it as one of the props, as shadcn/ui writes for React 19; `forwardRef` is not used. Radix comes from its own `@radix-ui/react-*` package, as the app already has it.
- shadcn/ui's enter and exit animations (`animate-in`, `fade-in`, `zoom-in`, `slide-in-from-*`) are played by the kit's motion (`src-ui/views/kit/motion.ts`) on the motion tokens, as a fade and a short slide; under reduced motion only the fade stays.
- A Radix part that adds a `<style>` at run time needs the CSP step in `docs/development.md`.

Where a shadcn component and a rule in this file differ, such as the button looks (#474), the 40px field or the focus ring, the rule here stays until it is changed on purpose. Components are compared with shadcn/ui one by one before any of them is changed (`docs/design/components/shadcn-alignment.md`), and a difference that needs a decision is decided there, not by the translation.

[OptiAxiom](https://github.com/optimizely-axiom/optiaxiom) stays the reference for what shadcn/ui, written in Tailwind, has no counterpart for: how the tokens are cut in vanilla-extract and how recipes and sprinkles are written.

Code is copied in only after its license is checked and recorded (`docs/voice-stack/licensing.md`). shadcn/ui is under the MIT license, so the first component aligned with it records shadcn/ui there and in `NOTICE.md`. shadcn.io names no license for its free components.

## The user guide (site/)

The guide is a reading surface in the same Dark Studio, chosen on 2026-11-15 after an impeccable and unslop audit found it read as stock VitePress. The world owns the frame, and the reading column stays calm: about 40 Japanese characters a line, the reader's own fonts (no web font; the theme's Inter is not used), real contrast.

- It wears the app's palette in a light and a dark scheme: Dark Plum, Lilac and Off-White ([site redesign](docs/design/site-redesign/README.md), 3). The dark values are this file's colors; `tools/site_tokens.mjs` writes them, with the light values made by the rule under "Colors", into `site/theme/tokens.css` as `--a-` role tokens, and the Pages workflow checks that file, the hue and chroma rule and the contrast. The guide's parts use only the role tokens. The reader's OS picks the scheme, and the top bar has a switch.
- Rspress draws its brand colour as text (the page you are on, a hover, a search match), so it takes `state-active`, the Lilac that reads as text in both schemes; the Lilac fill of a button is `primary`.
- The signature is the route strip at the top of each voice and text feature page and each audio-route page: the steps voice or text passes through, with this page's step lit in Lilac, the colour of what is chosen. The lanes are not coloured by direction; the lane's name says whether it carries what you send or what comes back. A page names its route in front matter (`route: tts`); the routes are in `site/theme/lib/routes.ts`. The how-it-works diagram and the home page's loops keep the blue and purple of the earlier palette until they are drawn again (stage 8 of the redesign).
- Section headings are the settings' category heading: the title with a hairline running to the right, no rule above.
- Callouts, "what you need" lines (`{.needs}`) and folds sit on the raised surface with a hairline all round. State color lives in the title and a tint of the border, amber for warnings and red for danger; no thick side stripe.
- A short list of features is `{.feature-rows}`: the name, which is the link, in its own column and one line of what it does.
- The product name on the home page is solid text at the largest size; buttons use the control radius (8px), not pills.
- Under it, each feature sits beside a short loop of its route (`showcase` in the home page's front matter). The loops are rendered with Remotion from `site/motion` into `site/public/motion/<lang>/`: one worked example per feature, the diagram growing one part at a time as the signal reaches it, held long enough to read, then leaving so the loop starts empty. A loop plays only while it is on screen; with reduced motion the page shows the finished scene as a still. The text beside a loop carries the meaning; the loop never says anything the text does not.

## Do's and Don'ts

- Do preserve model consent, independent switches and stop/mute behavior.
- Do check Japanese labels, long paths, keyboard navigation and narrow windows using production components.
- Do retain the distinction between configured, pending, active and failed states.
- Don't add a secondary label or an always-visible explanation where the layout can carry the meaning; a longer explanation goes in a tooltip (`Hint`).
- Don't introduce remote fonts or a new UI framework for this redesign.
- Don't imply connection, model readiness or microphone activity through decorative indicators.

---

# ASTAROTのデザイン（日本語版）

## デザインの方向

**目指す姿はDark Studio（暗いスタジオ）**

利用者は2026-10-30に全面的な作り直しを選びました。その紺の配色は2026-11-18にASTAROTのブランドの色であるダークプラムとライラックに替わりました。見た目の効果より会話と音声の操作を優先します。使い慣れたチャット、設定、ネイティブのウィンドウの操作は、ReactとCSSモジュールで作った既存のアプリの中に保ちます。

**主な特徴**
- 濃い色のレールでナビゲーションと会話の作業領域を分けます。
- ライラックは主な操作、選んでいるナビゲーション、キーボードのフォーカスを示します。
- TTS、RVC、モデルの取得は共通のフォームを使い、同じアプリの一部に見えるようにします。

## 原則

**説明するのは文字ではなく配置です（#614）。** 画面のある部分が何か、何に属するか、どの状態にあるかは、置く場所と、形、大きさ、色、動きで示します。補助のラベルや1行の説明は、配置では意味を伝えられないところにだけ足します。それより長い説明は画面に出したままにしません。マウスを重ねると（キーボードのフォーカスでも）開く吹き出しに入れ、その言葉は操作部品のアクセシブルな名前か説明に残します。

この原則で取り除く言葉のうち、意味を持つものは1つもありません。操作部品は名前を保ち、読み出しは状態をこれまでどおり言葉で示し、同意は見えるまま残り、色だけで何かを伝えることはありません。新しい画面、情報設計（#554）、部品（#452）はこの原則から始めます。この原則より前からある下の決まり（一般的な説明の最初の1文を見せる決まりなど）は、画面をこの原則で見直すまで残します。

この原則で見直した設定のページは行を`HintDescriptions`（`_components/hint/Hint.tsx`）で包みます。そのページでは、一般的な説明はヒントになります。項目名（または選択肢の名前や見出し）の後ろに小さな疑問符の印を付け、言葉は吹き出しに入れます。吹き出しは、ポインターがラベルの上にある間と、行がキーボードのフォーカスを持つ間に開きます。見出しの印は、印そのものがフォーカスを受けます。準備の折りたたみの説明（`SetupSection`の`desc`）はその題のヒントで、折りたたみの見出し（summary）がキーボードのフォーカスを持つ間にも開きます。名前を横に並べて描くチェックボックス（`HintCheck`）は、名前の後ろにヒントを付けます。言葉は操作部品のアクセシブルな説明として残ります。行の入力欄がラベルの下に回るところ（内容の幅かウィンドウが狭いとき）では、入力欄を覆わないように吹き出しをラベルの上に開きます。入力欄の下にその欄の誤りを出している行でも、欄にフォーカスがある間に誤りを覆わないように、吹き出しをラベルの上に開きます。操作の前に見る必要があるものは画面に残します。ダウンロードの前の同意とライセンスの文、声のクレジットの条件、警告、使用中の値（`keepDescription`、`keep_desc`）、使えない操作が何を待っているか、このセッションの状態（読み出しで示します）です。PCの外へ出ていくものと、スイッチがそれ自身のほかに変えるものは、画面に残す1文で伝えます。その詳しい内容はラベルの後ろではなくその文の後ろのヒントにします。吹き出しは文の下に開くので、文は詳しい内容と並んで見えたままです（行の`lead`。それを持つ行がないところでは単独の`Lead`を使い、その印がフォーカスを受けます）。操作部品の説明はその文、詳しい内容の順になります。この形で伝えているのは、利用状況のデータが送るもの、LLMのエンジンに送るもの（翻訳のページのAPIの区分の先頭と、翻訳のAPIを足すフォームの中。フォームではAPIを足す前に読まれます）、アプリが起動のたびに新しい版を問い合わせること、トレイのコンパニオンがアプリをトレイで起動させることです。GPUの報告は、何のためのものか、どう測るか、結果に何が入るか、押す前に知っておくことを見出しのヒントに入れています。行の名前はその行が持つものの名前にします。ボタンを押すと何が起きるかは、行の名前の括弧の中の言葉ではなくボタン自身の名前と吹き出しで示します（`ActionButton`の`action_label`。ポインターとキーボードのフォーカスで開きます）。WebSocketとOBSのアドレスと、そのコピーのボタンがこの形です。機能を使う人に向けた注意は、その機能がオンの間だけ出します。OBSのブラウザーソースが有効な間だけ、OBSのアドレスが変わったことを出すのがその例です。ここまでに見直したのは「デバイス」「デザイン」「ホットキー」「VRChat」「字幕とVR」「チャット読み取り（OCR）」「音声認識（ASR）」「テキスト読み上げ（TTS）」「ボイスチェンジャー（RVC）」「高度な設定」「翻訳」「実験的機能」「アップデート」「ASTAROTについて」で、設定のすべてのページです。「ASTAROTについて」には設定がないので、包む行もありません。このページが見せるのは、アプリが何か、上流のプロジェクトとの関係とそのプロジェクトへの謝辞（そのプロジェクトのロゴとリンク。人の一覧は出しません、#1222）、VRChatの免責事項です。これらは操作部品の説明ではなく帰属表示と告知です。免責事項はUIの言語の文だけを出し、英語以外の言語では、英語の原文をその下の開閉に入れます（#1266）。

## 色

配色はASTAROTのブランドの3色（`docs/brand/astarot/`）から作ります。Dark Plum `#261633`、Lilac `#A47AF5`、Off-White `#FAFAFC`です。ブランドに役割に合う色があれば、トークンはその色をそのまま使います。なければ、トークンはDark PlumかLilacの明度だけを変えた色にします。OKLCHの色相はそのブランドの色から3°以内（Dark Plumは308°、Lilacは297°）に収め、彩度はブランドの色を超えません。そのため、作った色がほかの色相に寄ったり、元の色より鮮やかになったりすることはありません。

| トークン | ブランドの元の色 |
|---|---|
| `canvas` | Dark Plum |
| `rail` | Dark Plumを暗くした色 |
| `surface`、`border`、`field-border` | Dark Plumを明るくした色 |
| `primary`、`readout-rule` | Lilac |
| `primary-hover`、`state-active`、`focus` | Lilacを明るくした色 |
| `text` | Off-White |
| `secondary-text` | ブランドボードで色見本を縁取っている灰色 |
| `description-text` | 暗い横長のロゴの副題 |
| `state-warning`、`state-failed` | なし（下を参照） |

部品が直接使う灰色とライラックの段（`variables.css`の`dark_*`と`primary_*`）も同じ方法で作ります。灰色はDark Plumから、ライラックはLilacから作り、灰色は番号が大きいほど暗くなります。そのまま使うのは、ブランド自身の値（Off-Whiteと、補助の文字と説明の文字の灰色）と純粋な白だけです。`brandPalette.test.ts`がすべての段を確かめます。

会話と設定には地（canvas）を、ナビゲーションにはより濃いレール（rail）を、入力欄には一段持ち上げた面（surface）を使います。作業の領域は重いカードではなく境界線で分けます。オンとオフの状態はラベルとスイッチの位置でも示します。

ブランドには警告とエラーの色がありません。警告と失敗にはその意味を伝える色相である琥珀色と赤を残します。ライラックやプラムの色にすると、動作中の状態に見えるためです。この2色はOKLCHの明度を動作中のライラックと同じ0.74にし、彩度をそれより低い0.10にします。そのため読み出しの3つの状態は同じ重さで見え、Lilacがいちばん鮮やかな色のままです。

コントラスト（WCAG 2.x。地、面、レールの上で測ります）は次のとおりです。文字、補助の文字、説明の文字、3つの状態の色は4.5:1以上です。Lilacは面の上で4.5:1に届きます。Lilacの塗りの上の文字はDark Plumにします（5.4:1）。Lilacの上の白は3.1:1にしかならないためです。入力欄の枠線（`field-border`、`--vox_field_border`）は、輪郭で描く操作部品の唯一の縁でもあります。スイッチのトラックと、quietとdangerのボタンがそれです。この枠線は入力欄自身の塗りである面に対して3.5:1、入力欄を置くすべての下地に対して3:1に届きます。その下地は、地、レール、ダイアログと言語の一覧（`dark_875`）、スイッチのトラック（`dark_850`）です。ブランドボードのラベルの灰色（`#777082`）は面の上で3.04:1、ダイアログの中で2.86:1にしか届きませんでした。そのため入力欄の枠線は代わりにDark Plumを明るくした色にしています。領域の間の細い線（`border`）は3:1未満のままで構いません。この数値に届かない色は、ブランドの色相を離れずにその色相の中で明度を変えて直します。

## 文字

利用者が設定したUIのフォント、拡大率、ログのフォントの設定を保ちます。ローカルのNotoとシステムのフォントへの代替で、リモートのフォントを読み込まずに日本語を表示します。長いフォームは区切りの見出しで階層を読み取りやすくし、技術的なパスは入れ物の中で折り返します。

アプリのウィンドウの文字はfront matterの`typography`にある大きさを使います（#568）。1.2、1.3、1.4、1.5、1.6、1.8、2、2.4remです（最後の2.4remは会話が空のときのあいさつだけに使います）。間の大きさは足さずにいちばん近い段へ移します。小さな印と吹き出しは1.2remを使います。親に対する大きさ（em、%）は親に従います。たとえばログでは、ログの文字の大きさの設定が基準の大きさを置き換えます。デスクトップの字幕オーバーレイは、利用者が選んだ大きさで字幕を描きます。そこで大きさが決まっている文字は、オーバーレイを動かしている間に出す大きさの表示だけです。このウィンドウはUIの大きさに従わないので、この文字はpxの段を使います（1.4remは14px）。トレイのコンパニオンの六芒星は独自の段を持ちます（下を参照）。`src-ui/views/app/fontSteps.test.ts`がアプリのウィンドウと字幕オーバーレイを確かめます。スタイルシートもvanilla-extractのファイル（ADR-010）も同じように読み、`font`の一括指定の中の大きさも含めます。

VR UIはヘッドセットの中へ独自のピクセルで描き、その大きさはVRの中のウィンドウの幅で変わります。既定の大きさでは1ピクセルが約0.44 mmです（ログのウィンドウは900pxで幅0.4 mになり、ツールバーも同じ比率を保ちます）。VR UIは独自の4つの段を持ちます。front matterの`vr-*`です（#568）。

| 段 | 使うところ |
|---|---|
| 16px | 小さい文字。名前の下の行、注記と理由、設定のメニューと区分の名前、吹き出し、LとRのような印 |
| 19px | 本文。行の名前と値、ボタンの言葉 |
| 22px | ウィンドウの題と、ひと目で読む数（プリセット、ステッパーとツールバーの値） |
| 26px | 記号だけのボタン（−、+、A−、A＋、›） |

各段は1つ下の段の約1.17倍なので、2つの段の違いはひと目で分かります。同じ段の文字どうしは太さと色で見分けます。16pxがいちばん小さい段です。注記や吹き出しの説明のような続いた文はもともと16pxで、それより小さかったのは印と短い略語だけでした。間の大きさは足さずにいちばん近い段へ移します。ログの文字、「入力と出力」のウィンドウ、一行と複数行の字幕オーバーレイは段から外します。ログの文字はA−／A＋で選んだ大きさです（14〜28px、既定は17px）。「入力と出力」のウィンドウはデスクトップの流れの表示（rem）を1.1倍に描きます。一行と複数行の字幕オーバーレイは、ネイティブのオーバーレイが独自の大きさで描く画像です（`native/vr-overlay/src/subtitle.rs`）。`src-ui/views/vr/fontSteps.test.ts`がVR UIを確かめます。

トレイのコンパニオンの六芒星（実験的機能）は画面の端の小さなウィンドウで、UIの大きさに従わない独自のpxで描きます。六芒星は独自の3つの段を持ちます。front matterの`hexagram-*`です（#568）。

| 段 | 使うところ |
|---|---|
| 12px | 札の上で機能の名前の横に出す状態（オン、オフ、未準備、切り替え中…、切り替えられませんでした）と、共通の設定の題 |
| 13px | 共通の設定の行とボタン。六芒星がはじめて出たときに出す1行 |
| 14px | 札の上の機能の名前 |

この3つの段は名前を付けたときに六芒星が使っていた大きさです。段どうしが近いので、太さと不透明度でも見分けます。札の上の名前は太字にし、その横の状態はそれより薄くします。`src-ui/views/companion_handle/fontSteps.test.ts`がスタイルシートとvanilla-extractのファイルの両方で六芒星を確かめます。

六芒星の三角形にはそれぞれの機能のアイコンを載せます。メインのウィンドウのスイッチと同じアイコンで、六芒星が回っても上を向いたままです（#536）。オフの機能は三角形とアイコンをOff-Whiteで描きます。オンの機能は三角形をLilacにします。輪郭の辺をすべてLilacにし、内側の板にLilacを薄く重ね（16%）、アイコンもLilacにします（色を重ねた板に対して4.2:1）。オンの機能の輪郭は、線を共有する中央の六角形と隣の三角形の上に描きます。そうすると、どの辺にも隣の白が見えません。輪郭の幅は、機能がオンでもオフでも同じです（2.4px。札が出ている間は3.2pxで、オフなら白、オンならLilacです）。ここでは色だけで区別することを、保守担当者が選びました。LilacとOff-Whiteは色相だけでなく明度も違います（3:1）。出ている札もオンの機能をLilacで示します。`src-ui/views/companion_handle/CompanionHandle.test.ts`がアイコンを確かめます。

六芒星はポインターが触れるたびに応え、起きたことを利用者が見ている場所で見せます（#536）。ポインターの下の三角形はすぐに自分の色で光り（Off-Whiteは20%、Lilacは34%）、札が出るより前にアイコンが5分の1だけ大きくなります。三角形を押すとさらに明るく光り、札を押したときと同じように機能を切り替えます。そのとき札はホバーのときの待ち時間なしにすぐ出します。札で起きたことを伝えるためです。押した札は少し縮みます（95%）。どちらを押したあとも、札は「切り替え中…」と出し、メインのウィンドウが答えるまで（長くて4秒）どちらも押せません。その間、三角形は薄くなります。送れなかった依頼は「切り替えられませんでした」と3秒間出します。オンになったスイッチは三角形をLilacで光らせ、オフになったスイッチはOff-Whiteで光らせます。光は0.8秒かけてそのときの色へ戻り、アイコンは大きくなってから元に戻ります。メインのウィンドウやホットキーで変えたときも、同じように見せます。動きを減らす設定では、光ること、アイコンが大きくなること、札が縮むことを省きます。色と言葉は残します。

六芒星がはじめて出たときは、共通の設定が開く場所に縁がLilacで両端の丸い枠を出し、「ホイールで回すと、ほかの3つが出ます」と5秒間示します。向こう側に回っている3つの三角形を見つけてもらうためです（#536）。この枠はポインターの操作を受けず、ホイールを回すか札が出ると早めに消えます。出したことはメインのウィンドウが覚えます（`TRAY_COMPANION_WHEEL_HINT_SHOWN`）。メインのウィンドウがこの設定を持つまでは何も出しません。この枠は13pxの段を使います。

VRのウィンドウの中では、どの部品も吹き出しを開きません。VRの吹き出しはランチャーとツールバーにだけ描きます。そのためウィンドウの中では、操作部品が何で、何に働くかを、名前の下の1行ではなく置く場所と印で伝えます（#614）。「ランチャーを付ける手」の選択はツールバーと同じようにそれぞれの手を描き、右手は左右を反転します。折りたたみの見出しには使用中の値を出します（処理デバイスと種類。スピーカーの録音の上限、区切り、待機）。言語のウィンドウの入れ替えのボタンは相手の見出しの行に置きます。入れ替える2つ、つまり上のあなたの言語と下の相手の1番に挟まれた位置で、メインの画面と同じく上向きと下向きの矢印の間に置きます。アクセシブルな名前はこれまでどおり両方の言語を挙げます。相手の行は高さ64pxにします。相手の3行、その下の1行、翻訳エンジンが、入れ替えのボタンと一緒にウィンドウに収まるようにするためです。レーザーで狙う的はどれも高さ56px以上を保ちます。名前の下に1行を残すのは、状態、警告、操作部品が使えない理由、どう配置しても伝えられないこと（吹き出しをオフにするスイッチ）のときだけです。ランチャーでは、ほかのどこにも書いていないことを伝える吹き出しは、吹き出しをオフにしていても出します。使えないスイッチに足りない準備の吹き出しと、ログのボタンの吹き出しです。ログのボタンの吹き出しは長押しでログを呼び戻せることを伝える唯一の場所です。

## レイアウト

通常のメインのレールは240px、設定のレールは208pxです。拡大率を考慮した既存の800pxの切り替え点では、メインのナビゲーションは72pxのアイコンのレールになります。その開閉ボタンでレールを一時的に広げると、保存したコンパクト表示の設定を変えずに言語の操作部品に届きます。広げたレールは会話の上に重なり、会話の幅は変わりません。レールはEscape（フォーカスは開閉ボタンへ戻ります）か、レールの外を押すと閉じます。広いウィンドウに戻ると、一時的に広げた状態を解きます。レールは縦の列で、ロゴ、スクロールする部分、足元の設定のボタンからなります。スクロールする部分は、下にまだ続きがあるときはいつも見えるつまみを出します。設定のメニューも、ページの一覧がウィンドウの下へ続くときは同じつまみを出します（#1266 ★7）。広いレールでは、言語の設定は見出しと3つのプリセットを1行に並べ、それぞれの言語は、kitのplainのボタン（compactの大きさ）の上に小さな見出しを置き、ボタンの中では言語と矢印を中央にそろえます（2026-11-25の決定）。2つの言語の間の入れ替えのボタンは、何もしていないときも上向きと下向きの矢印の間に「言語を入れ替え」と出し、言葉に合わせた大きさの、kitのplainのボタン（compactの大きさ）として描きます。そのため、ポインターを向けなくてもボタンだと分かり、3つ目の入力欄には見えません（#569）。相手の言語を減らすボタンと足すボタンは、kitのアイコンだけのボタンです。kitの大きさでは、1280×720で6つのスイッチをすべて出しているとき、翻訳エンジンにはレールをスクロールして届きます（2026-11-24の決定、#1123）。2つの言語を双方向に訳すことは、入れ替えのボタンではなくそれぞれの言語が伝えます。言語の欄の吹き出しとアクセシブルな説明は、その言語が何に使われるかを両方向について伝えます（あなたの言語は「自分が話したり入力したりする言語です。相手の発言はこの言語に訳します。」、相手の言語は「相手が話したり書いたりする言語です。自分の発言はこの言語に訳します。」）。言語の一覧は同じ言葉を、その言葉が説明する検索欄の下に1行で出します。レールにはこのための行を足さないので、レールの高さは変わりません。翻訳エンジンの選択はボタンに合わせてレールの横に不透明なポップオーバーとして開きます（ウィンドウの内側に収め、Escapeキーや外側の押下、フォーカスの移動で閉じます）。そのためレールの中身も会話領域も動きません（#1095）。オンのスイッチはどちらのレールでも行にライラックを薄く重ね、アイコンをライラックにします。アイコンのレールはそれぞれのスイッチの名前を吹き出しで示し、スイッチの下に選んでいる言語の組を出します。言語の組を押すとレールが開きます。オフで、まだ準備（モデル、音声の入力元、音声経路）が足りないスイッチは灰色にし、押しても何もしません。その吹き出しは何が足りず、どこで用意するかを伝えます。押すまでスイッチから分からないことも、その場で直せるようにします（2026-11-26の決定、#1225）。音声認識に足りないものがあってマイク入力や聞き取りのスイッチが断られたときは、設定の場所を示す通知ではなく、直すための操作を載せたダイアログを開きます。認識モデルがなければ最初のセットアップへ導きます。モデルが受け付けない言語なら、そのモデルの言語からその場で選び、選ぶとスイッチをもう一度オンにします。同梱サーバーでは、言語を自分で判定できるモデルをカタログの確認画面を通して勧め、適用するとスイッチをオンにします。ダウンロードは、大きさを示す確認画面を通さずには始めません。どのダイアログからも、その設定へ直接行けます。広いレールでは、それぞれの機能のアイコンがスイッチの横の独立したボタンです。足りない準備があればそれを用意する場所を、なければ機能の設定（翻訳では翻訳エンジンの一覧）を開きます。その名前と吹き出しが行き先を伝えます。このアイコンはホバーやフォーカスのときだけでなく、何もしていないときもボタンとして描きます（普通のボタンの持ち上げた面と細い枠線）。スイッチの下には何も足さないので、エンジンの状態が届いてもレールは動きません。エンジンがなくなると、どのスイッチも同じ1つの理由で灰色になり、レールはそれを1回だけ伝えます（#766）。スイッチの先頭にある環境の読み出し「エンジンとの接続が切れました」です。アイコンのレールはこれを、キーボードのフォーカスを受ける警告の印として描き、その言葉を印の名前と吹き出しにします。このためにスイッチの下へ行を足さないので、どの行も高くならず、スクリーンリーダーが言葉を読むのも1回です。それぞれのスイッチはその言葉をアクセシブルな名前と吹き出しに持ちます。エンジンが起動している途中は何も出しません。オンのスイッチは灰色にしないので、いつでもオフにできます。設定で選んだ用途（用途のプリセット、#554）が、どのスイッチを見えるところに出すかを決めます。オンのスイッチと切り替え中のスイッチは、何を選んでいても見えるところに出します。残りのスイッチはスイッチの後ろにある控えめな「ほかの機能（n）」の行（アイコンのレールではアイコン）の下にあります。この行は6つすべてをいつもの順で出し、もう一度押すと隠します。出したことは保存せず、設定も変えません。VRのランチャーの機能のボタンも同じ条件で使えなくなります。灰色にして琥珀色の警告の印を付け、何が足りず、PCの設定のどこで用意するかをボタンの吹き出しに入れます。この吹き出しはVRの吹き出しをオフにしていても出します。設定は56pxのレールを使い、レールはキーボードのフォーカスかホバーで広がります。押したことで付いたフォーカスでは、ポインターが離れたあとにレールを開いたままにしません。設定のメニューはページを4つの控えめな見出しの下に、会話で使う順にまとめます（#554）。「会話の基本」（翻訳、音声認識、VRChat、字幕とVR）、「声と読み取り」（TTS、RVC、チャット読み取り）、「使い心地」（デバイス、デザイン、ホットキー）、「アプリ」（アップデート、高度な設定、実験的機能、ASTAROTについて）です。56pxのレールでは見出しの場所に細い線を引くので、レールが広がってもタブは動きません。まとまりの名前はスクリーンリーダー向けに残します。まとまりの上の「用途」は、何もしていないときもボタンの形で、選んだ用途を挙げます。押すと、レールの中でその下にチェックボックスの一覧を開きます。どのチェックボックスにもその用途が何のためかを1行添えます。複数を選べ、最後の1つは外せません。メニューは選んだ用途に要るページを出し、ページが1つもなくなったまとまりは見出しも消します。デザイン、ホットキー、アプリ自身のページはいつもメニューにあります。いま開いているページも、検索やメインのページのボタンから開いたときを含めて、メニューに出します。アイコンのレールではこのボタンのアイコンを出し、一覧は閉じます。小さいウィンドウでは操作部品を省かずにスクロールします。

機能には何をするかを表す名前を付け、短い技術的な名前を括弧に入れます。「テキスト読み上げ（TTS）」「ボイスチェンジャー（RVC）」「音声認識（ASR）」「チャット読み取り（OCR）」です。メインのスイッチ、その設定のページ、そのホットキー、利用者向けマニュアルは同じ名前を使います。名前が1行に収まらないときは括弧の前で改行し（`splitFeatureLabel`）、語の途中では改行しません。レールの幅は変えません。広いレールではスクロールバーを描いた状態で、スイッチの名前にトグルの横の全角9文字分の幅があります。そのため、仮名が全角幅のフォントでも「ボイスチェンジャー」は1行に収まります。例外は設定のメニューです。タブはどれも1行なので、すべてのタブが同じ高さになります。機能のタブは括弧を除いた名前を出し、括弧の部分はタブの吹き出しとアクセシブルな名前と、ページ自身の見出しに残します。利用者をどこかへ案内する文は省略しない名前を引きます。それ以外の文では短い名前を使っても構いません。

メインの上のバーは停止の操作（読み上げの停止、ミュート）を先頭に置き、どのウィンドウの大きさでも同じ場所に出します。ウィンドウとVRChatの切り替え（最前面固定、VRCマイクミュート同期、字幕オーバーレイ）は、右にある1つの「クイック設定」のボタンから開きます。このボタンはそのうちいくつがオンかを示します。使えない切り替えは行の下に理由を出します。切り替えの下では、OSCを有効にしたVRChatがこのPCで見つかるかどうかを読み出しが言葉で伝え、見つからないときはOSCをオンにする手順を添えます。VRChatの設定のページも同じ読み出しで始まります。会話の列が64remより狭いときは、バーはいちばん短い言葉で描き、「クイック設定」のボタンはアイコンだけにします。アクセシブルな名前と吹き出しは省略しない言葉のままです。停止の「読み上げを停止」とミュートの「ミュート中」の印は、列が56remになるまで残すので、既定のウィンドウ（列は63rem）でも停止が何を止めるかが分かります（#1314）。決めるのはウィンドウの幅ではなく列の幅なので、240pxのレールとUIの大きさも勘定に入ります（列へのコンテナークエリ。remはUIの大きさに従います）。停止の操作は言葉が収まらない幅には縮めません。クイック設定のパネルは列に合わせた大きさで、列の高さが足りないときは中でスクロールします。新しい版が出ているときは、これらのボタンの前に更新のボタンを置き、押すとアップデートのページを開きます。版が出ていることは状態なので、バーで知らせるのではなく見て分かるように示します（#766）。更新のアイコンの角に印を付け、ボタンは版を添えた短い言葉「更新 0.6.1」を出します。「新しいバージョンが出ました！」の文はボタンの吹き出しとアクセシブルな説明にします。狭いバーではアイコンと印を残し、言葉はアクセシブルな名前に残します。 <!-- writing-exempt: 画面の文言（locales/ja.yml）を感嘆符ごと引いている -->

会話がいちばん大きな領域を占めます。ログと入力欄は、どのウィンドウの幅でも列の幅いっぱいを使うので、上のバーと同じくウィンドウに合わせて広がります。幅の上限は設けません（2026-11-26の決定、#1223）。送信のボタンは入力欄の下端で正方形のまま（最大10rem）にします。ログのフォントサイズは、入力欄の先頭の「A−」「A＋」で変えられます。送信のボタンから離すのは、押し間違えで送らないためです。大きさは設定のスライダーの目盛りに沿って10%ずつ（40〜200%）変わり、ボタンの名前（吹き出しにも出ます）が今の大きさを示します（#1314）。ログの上に下りるパネルのスライダーは、両端の目盛りがパネルに収まるように内側に寄せます。低い列（36rem未満。最小の200pxのウィンドウも含みます）では、高さをログに回します。上のバー、ロゴの行、言語の選択のバーは4.4remにし、余白を細くし、入力欄は1行にします。このとき「入力と出力」のパネルは会話を押し出さずに会話の上に重なります。それより高い列では、このパネルは最大60%を使い、ログより先に縮みます。パネルが何を見せるかと、GPUのメモリをどう読むかは、パネルの行ではなくヒントにします（#614）。パネルの題と読み出しの見出しの後ろに疑問符の印を付け、設定と同じ吹き出しを出します。吹き出しは、ポインターが見出しの上にある間と、印がキーボードのフォーカスを持つ間に開きます。パネルは外へはみ出したものを切り取るので、どの幅でも、題の吹き出しは題の下に、読み出しの吹き出しは見出しの上に開きます。会話が空のときは、見出しだけのあいさつを出します。どこに入力するかは言葉で伝えません。その下の入力欄が場所とプレースホルダーでそれを伝えるためです（#614）。あいさつはログの上端から一定の距離に置き、その距離はウィンドウの高さで決めます。そのため、その下の一覧も、起動時に保存した高さになる入力欄も、あいさつを動かしません。空のログは末尾までスクロールしないので、ログの高さを超えて伸びた一覧があいさつを上へスクロールさせることもありません。メインのウィンドウでは、あいさつは場所を確保したまま、保存したUIの大きさ、保存した言語、それらで決まる狭いときのレイアウトがそろってから描きます（後の2つは最大1秒待ちます）。そのため、あいさつははじめからそのままの場所と見た目で現れ、一度描いたら隠しません。メインのウィンドウのあいさつは、選んだエンジンにまだ足りないモデルも並べ、それぞれにそれを用意する手順を開くボタンを付けます（ダウンロードの確認か、ローカルの音声認識のモデルを設定する音声認識の設定）。一覧の下にはVRChatでOSCを有効にすることについての1行を出します。この1行はいつも出す説明ではなく状態です（#614）。OSCをオンにしたVRChatをアプリが見つけられない間だけ出します。これはクイック設定の読み出しが同じ手順を出す条件で、VRChatが見つかるとひとりでに消えます。それが分からない間（まだ応答がない、OSCQueryがオフ、メッセージを別のマシンへ送っている）と、VRChatへの送信がオフの間は描きません。そのため、起動時に出てすぐ消えることはありません。その一覧の行は何が足りないかだけを伝えます。どこへ行くかは2つ目の文ではなくボタンの名前で示します（#614）。入力欄にはライラックの送信の操作があります。設定には、よくある戻るボタン、検索、そろえた区分があります。700px未満では入力欄のラベルを入力欄の上に積みます。ダイアログは幅を表示領域に収め、明示の同意を見えるところに保ちます。

通知（トースト）は操作部品を覆いません。メインのページでは会話の上端で、上のバーの下、レールの横に出します。そのため、通知が出ている間もスイッチ、設定のボタン、入力欄に手が届きます。設定では上のバーとレールを避けて、内容の列の下端に出します。すでに出ている通知はページと一緒に動きます。読める大きさの通知をレールの横に置けないほど狭いウィンドウでだけ、通知がレールの上に重なります。

メインのページの吹き出しには共通の`Tooltip`（`common_components/tooltip`）を使います（#766）。ポインターでしか開かない`title`属性は使いません。対象はレール、両方の上のバーの停止とミュート、上のバーのボタン、送信のボタン、タイトルバーです。吹き出しは、ポインターが操作部品の上にある間と、操作部品がキーボードのフォーカスを持つ間に開きます（押したあとに残るフォーカスでは開きません）。押す、Escape、Enter、Spaceのどれかで閉じるので、操作部品が開くものを覆いません。吹き出しはアプリで1つだけの吹き出しの見た目を持ち、ページの末尾に描いて、操作部品の枠を基にウィンドウの中に置きます。レールの操作部品ならレールの横（機能のアイコンも行と同じ高さに置き、吹き出しがスイッチの名前を覆わないようにします）、上のバーとタイトルバーならバーの下、送信のボタンなら入力欄の上です。収まらないときはほかの側へ移り、ウィンドウの中にとどまります。そのため、スクロールするレールや狭いバーが吹き出しを切り取ることはなく、レイアウトも動きません。吹き出しは操作部品の上に見えている言葉を繰り返しません。「クイック設定」のボタンは狭いバーで言葉が隠れるときだけ吹き出しを持ち、言葉をいつも出している入れ替えのボタンは吹き出しを持ちません。吹き出しは、操作部品がスクリーンリーダー向けにすでに持っている言葉（名前か、ページに残る説明。`aria-describedby`）を見せる絵で、吹き出しそのものは読み上げません。タイトルバーの3つのボタンはこの形で名前を見せます。閉じてもアプリがトレイに残る環境では、閉じるボタンは押す前に「閉じる（トレイで動き続けます）」と示します。最大化のボタンは、Windowsと同じく押したときに起きることを絵で示します。最大化していないときは四角1つ、最大化しているときは元に戻すアイコン（重なった2つの四角）です。名前と吹き出しの「ウィンドウを最大化・元に戻す」は、どちらの状態でも同じです（#1258）。メインのページの外でも、フォーカスを受ける要素はすべて、`title`ではなくこの吹き出しを使います（shadcn/ui との照合の D-21）。設定のメニュー、声の試聴のボタン、ログで話者に名前を付けるボタンです。狭い設定のレールの使い方のプリセットのボタンは、どちらも持ちません。ポインターかフォーカスが届くとすぐにレールが広がり、ボタンの言葉が見えるからです。フォーカスを受けない、ログの言葉の読み（ルビ）だけが、これまでどおり`title`を使います。`src-ui/views/app/main_page/mainTooltips.test.ts`がこれらの操作部品に`title`属性が付かないことと、VR パネルを除くすべての画面で`title`が読みにだけ残ることを確かめます。

設定はメインのウィンドウの横に専用のウィンドウを持ちます（#1236）。メインのウィンドウと同じくアプリのタイトルバーで描き、タイトルバーには「ASTAROTの設定」と出します。閉じるボタンはこのウィンドウだけを閉じ、何も聞きません。設定は自動で保存されるからです（#1111）。ウィンドウは最大で1つです。設定のボタン、設定を開くボタン、トレイ（メニュー、コントロールパネル、六芒星のメニュー）がこのウィンドウを開くか、求められたページで手前に出します。メインのウィンドウはその横で見えたまま使えます。設定のウィンドウを開いている間も、何も止めません（2026-11-26 の決定）。機能は動いたままで、Quick Chat も開き、ホットキーも働きます。ただし、ホットキーのページを出している間はホットキーを止めます。そこで押すキーは記録するためのものだからです。設定のウィンドウには「戻る」がありません。閉じるボタンで閉じます。エンジンの実行が終わると、設定のウィンドウは残り、ページは操作できなくなります。その上に、エンジンとの接続が切れたことを警告の表示で示し、メインのウィンドウでエンジンが起動すると、またつながります。設定のウィンドウは自分の位置と大きさを覚えます。初めて開くときは、メインのウィンドウがあるモニターの中央に、メインのウィンドウの最初の大きさで開きます。ブラウザー（開発、結合テスト）では、設定はこれまでどおりメインのウィンドウの中のページです。

## 設定画面の役割

設定のページは4つの役割を使い、どれも読まずに見分けられなければなりません。利用者は2026-11-01にこの役割を承認しました。

| 役割 | 見た目 | 使うところ |
|---|---|---|
| 大見出し | 2rem / 600、文字の色、上に40px・下に16px、右へ細い線。ページの最初の見出しは上のバーのすぐ下に置く | ページの区分ごとに1つ（TTS、RVC、マイク） |
| 小見出し | 1.5rem / 600、補助の文字の色、上に24px・下に8px、枠なし | 区分の中のまとまり（モニター、日本語TTS） |
| 項目名 | 1.4rem / 500、文字の色、折り返す | 1つの設定の名前 |
| 一般的な説明 | 1.2rem / 400、説明の文字の色。最初の1文を見せ、残りは「詳細」の開閉に入れる。#614で見直したページでは、ラベルの後ろの疑問符の印と吹き出し（「原則」を参照） | 設定が何をするか。どのPCでも当てはまること |
| 環境の読み出し | 1.3rem / 500、等幅の数字、面の背景、左に3pxの線、角丸8px | このPCとこのセッションがいま報告すること。GPUとメモリ、サーバーの状態、ダウンロードの進み具合、モデルへの対応 |

読み出しは状態を言葉で伝えます。色は言葉を繰り返すだけで（動作中はライラック、警告は琥珀色、失敗は赤）、言葉の代わりにはしません。枠は1つのサーバーやエンジンのような実際のまとまりにだけ使います。区分の中のまとまりは入れ子の枠ではなく余白と小見出しで分けます。一度だけの準備（モデルのファイル、サーバー、ダウンロード）は、ページごとに1つの折りたたんだ「モデルとサーバー」の区分に入れ、状態を1行で示します。その中では、最初の起動で要るもの（実行環境、取得する既定のモデル）を先に置き、自分で用意したファイルのパスは最後の「自分のモデル」の折りたたみに、説明への案内と一緒に入れます（#1266 ★5）。音声認識、テキスト読み上げ、ボイスチェンジャーのページで同じです。翻訳のページと、音声認識のページのAPIのエンジンでは、提供元ごとにこの折りたたみを1つ置き、その行で使えるかどうかを伝えます。使用中の提供元は開いたままにします。ページはそのページのほかの部分のどれが当てはまるかを決める選択から始めます。音声認識のページはエンジンから始まります。エンジンの選択肢は「お使いのPCで動かす（speech.cpp）」と「API（クラウドや自分のサーバー）」の2つの系統の下に並べます。ページはそのあと、この2つの系統をこの順に、それぞれ小見出しの下に出します。まずspeech.cppとその「モデルとサーバー」、次にAPIの提供元の折りたたみです（#414）。翻訳のカタログが訳すものをまとめる形（#413）と同じです。翻訳のページも同じく、使用中の言語設定のエンジンから始めます。メイン画面と同じ選択です（#1266）。「お使いのPCで動かす」にはモデルと処理デバイス、次にカタログのモデルを入れます。「API（クラウドや自分のサーバー）」には提供元の折りたたみ（自分で動かすサーバーを含みます）、次に利用者が追加したAPIを入れます。テキスト読み上げのページは、どの読み上げにも要る行を先に置き、次に読み方、そのあと「お使いのPCで動かす（speech.cpp）」と「外部のサーバーとエンジン」を置きます。利用者が足したもの（登録したモデル、自分のWhisperのサーバー）には、カタログと同じ破線のバッジを付けます。アプリが用意したものには付けません。メインのページのスイッチにはそれぞれ同じ名前の設定のページがあります。チャット読み取りには専用のページがあり、VRChatのページの最後にはそれを開くボタンがあります。設定するとしても一度だけの数値（音声をメッセージに区切る方法）は、使用中の値を行に出す折りたたみに入れます。ページは最初の起動で要るものから始めます（#554）。好みに合わせて一度だけ設定するものは、その後ろと「モデルとサーバー」の後ろに置き、「モデルとサーバー」と同じ形で描く1つの「詳細設定」の折りたたみに入れます。その行には使用中の値をいくつか出します（オンとオフ、件数、数値）。折りたたみの中のまとまりには大見出しではなく小見出しを使います。折りたたみがひとりでに開くのは、使用中のものがあるとき（言語のプリセットが使う翻訳のAPI）と、ページの機能がそれなしでは動かない準備が済んでいないときだけで、どちらのときも閉じられます。ページで最初に要るものは、何も開かずに見えるようにし、折りたたみには細かい設定と上級の設定を入れます。準備の折りたたみは、次のときに開いた状態で始まり、準備が要るようになったときにも開きます。音声認識が同梱のサーバーを使い、そのモデルが設定されていないとき。テキスト読み上げの声が同梱のサーバーから出ていて、モデルがないとき。ボイスチェンジャーにランタイム、モデル、声を出す経路のどれかがないとき。チャット読み取りに、選んだ言語のモデルが足りないとき（#1230）。チャット欄の検出のモデルや、ボイスチェンジャーの「詳細設定」にある入力の転送のような省ける部分は、折りたたんだままにします。1つの設定の置き場所は1か所です。その設定に関わるほかのページには行を置き、その行のボタンが設定のあるページの名前を挙げます。ボタンを押すと、検索の結果と同じように、周りの折りたたみを開いた状態でその設定のところを開きます。この行は、そのページ自身の操作と「モデルとサーバー」の後ろに置きます。テキスト読み上げとボイスチェンジャーのページの音声経路がそうです。ボイスチェンジャーのページでは、モニターの行を「詳細設定」に入れます（#1230）。このボタンのラベルは1つで、タブにあるとおりのページの名前を引き、そこで何をするかを伝えます。「「デバイス」で音声経路を変更」のように書き、ページ全体が行く理由なら「「チャット読み取り（OCR）」を開く」と書きます。タブのアイコンを言葉の前に置きます（#537）。操作だけを名前にしたボタンはその場で動くように読めてしまいます。そのとき行の説明の1行は、どこで設定するかではなく設定が何をするかを伝えます。「字幕とVR」のページ（#568）では、「詳細設定」の中の「一行」／「複数行」が、その下の行がどちらの字幕オーバーレイを設定するかを2つのタブのように選びます。それぞれのオーバーレイはページの上部にある専用のスイッチでオンにします（#554）。位置と回転の図はラベルの列と入力欄の列からなる1つの行です。左に名前と説明を置き、入力欄の列の中央に「位置」／「回転」の切り替えと図を置きます。図の軸の名前が正方形の外へはみ出すので、ページが72remより狭いときはこの行を縦に積みます。サンプルの文には専用の行があり、入力欄の列に普通のボタンを置きます。

設定の上のバーもメインと同じく停止の操作をいつも出します。読み上げの停止（待ち行列を空にします）と、アプリの音声出力のミュートです。止めるものがないうちは、停止を半分の濃さで描きます。その横に、About を除くすべての設定のページで「このページの変更はすぐに反映されます」と出します。どの設定も自分で保存するためです（#1111）。この文は操作部品と同じ高さの箱に最大2行で収めます。ミュートの印でミュートのボタンが広がっても、何も動きません（#1266 R-4）。

大見出しの下にあるものは、1つの設定のグループとして、角丸（`rounded.group`）の専用の地に載せ、静かな線で囲みます。グループの中の行は、さらに静かな線で区切ります。どの区分にも入らずにページに1つで置かれた行も、同じグループにします（#1233）。設定のページは、アプリのほかの画面より静かに線を引き、色はテーマ自身のトークンから作ります。枠（折りたたみ、カード、普通のボタンのように、そこで罫線の色を使う線をすべて含む）は罫線の色を地の色と62%で混ぜた色、行の区切りは50%で混ぜた色、グループの地は地の色と面の色の中間です。入力欄の輪郭はコントラストを保ちます（「Colors」を参照）。グループの中身は折りたたみが中身に付けるのと同じ余白を持ち、入力欄の始まりと操作の右端は折りたたみの中と同じ位置にそろいます。

どの設定も自分で保存します。保存のボタンも「保存しました」の通知もありません（#1111）。

- 文字の入力欄は、Enterを押すか、欄からフォーカスが外れたときに、検査で受け付けた値を保存します。Escを押すと保存してある値に戻します。
- APIキーなどの認証情報は、空のまま欄を離れても保存してある値を残します。消すのは、空の欄でEnterを押したときだけです。
- 一緒に保存する欄は、フォーカスが組の外に出て、組の全部の欄が受け付けられる値のとき、またはEnterで、1つの組として保存します。TLSの証明書と秘密鍵、アドレスとそのキー、声、経路、サーバー、字幕のフォームが当たります。組の中の選択、スイッチ、一覧の変更はすぐに保存し、スライダーは離したときに保存します。
- 欄が断った値は送りません。何が違い、どんな値ならよいかを欄の下に言葉で出し、欄を正しくない印にします。中核に断られたときも、通知ではなくそこに出します。
- 保存を待つ間も欄は使えるので、フォーカスはその場に残ります。その間の変更は、待っている保存が終わってから保存します。
- 断られた値や保存していない値のままページを離れると、その値は捨て、先に何も聞きません。

ページを開いただけで何かが保存されることはなく、1つの入力欄を保存しただけで機能の動きが切り替わることもありません。「直接音声でRVCを使う」のような選択は、それを求める注記の横の専用のボタンにします（#436）。

ミュートはどこでも1つの名前です。両方の上のバーでどの幅でも「ミュート」、音声経路の行のラベルも「ミュート」で、ホットキーでは「ミュートの切り替え」です。何を消音するか（読み上げか、仮想マイク全体か）は、名前ではなく吹き出しと行の説明に入れます。行のボタンは「ミュートする」と「ミュートを解除」で、利用者をそこへ案内する通知は「ミュートを解除」を引きます。

停止も1つの名前です（#476）。両方の上のバー、TTSのページの状態、ホットキーで「読み上げを停止」です。メインの上のバーだけが、列が56remより狭いときに限って「停止」に縮めます。アクセシブルな名前と吹き出しは省略しない言葉のままで、吹き出しは待ち行列を空にすることも添えます。

## 高さと奥行き

操作部品は余白、整列、控えめな境界線でまとめます。暗くした背景でモーダルの範囲を示します。ふだんのフォームでは、飾りの浮き上がりを避けます。見えるダイアログは一度に1つです。翻訳の取得の確認がそのモデルの確認と同意を開くように、ダイアログがその中から別のダイアログを開くところでは、別のダイアログが閉じるまで、最初のダイアログを暗くした背景ごと隠します（`Dialog`の`stepsBack`）。

## 形

操作部品の角はゆるく丸め、入力欄の角丸は少し大きくします。利用者のウィンドウの角の設定を保ちます。角は`rounded`の段（2、4、8、12px）を使います。ほかの角丸はバーやトラックの丸い端（高さの半分）と、VRChatのものをまねたチャットボックスのプレビューの吹き出しだけです。

## 部品

ネイティブのボタンが操作とアクセシブルな名前を持ちます。フォーカスの輪は見えるままにし、ネイティブのチェックボックスの状態は見分けられるままにし、選択のメニューは暗い配色を使います。

1つの役目には1種類の操作部品を使います（#436。アプリの大部分がすでに使っていたものから選びました）。

- 設定のページの設定は、kit のスイッチ（`SettingSwitch`、`SwitchContainer`）でオンとオフを切り替えます（K-02。2026-11-25 に決まり、#436 のチェックボックスから変えました）。デバイスの「自動選択」のように、ほかの操作部品と並ぶ行の中では、スイッチの横に名前を付けます（`show_label`）。設定のページでチェックボックスを残すのは、利用者が同意を確かめるところ（ダウンロード、ライセンス）だけで、ネイティブの input のままにします（D-16）。スイッチ（`role="switch"`）は、機能をオンやオフにするメインのページの機能、VR UI、トレイのコンパニオンのパネル（実験的機能）にも使います。クイック設定の行はそのボタンの「すべてオフ」と同じく、オン／オフを言葉で示します。
- オンとオフの部品の置き場所（#473）：フォームの外の設定の行では、スイッチを行の右端に、入力欄の右端とそろえて置きます（そこではスイッチの後ろに余白を付けません）。フォーム（声、サーバー、音声認識のフォーム）の中では、左に置いて横に名前を付け（`checkLabel`）、説明をその下に続けます。
- ボタンの置き場所（#473、#478）：上の入力欄に働くボタン（一覧の更新、サーバーの開始や停止、モデルの確認、登録、入力の開始）は、それらの入力欄が始まる操作の列から始めます（`FormRow`のactions、または`control_column`）。TTSとRVCのページの音声経路のように、ほかの場所へ案内するだけの行は`FormRow`にします。左にラベルと使用中のものを、操作の列にボタンを置きます（`PagePointer`。ボタンはどのページでも同じ見た目の`PageLinkButton`）。ボタンを文の行末に続けて置くことはしません。カード（1つのモデルやエンジン）では、カード自身の操作を操作の並びの先頭に置き、どのカードでも同じ場所にします。
- ボタンの見た目（#474）：塗ったボタンは操作です。ライラックのボタンはダイアログやフォームの目的になる手順（開始、保存、同意）です。輪郭だけのボタン（`quiet`）は開始の横の停止のように、塗ったボタンと組になる副次の操作で、単独では使いません。停止の操作の停止（両方の上のバーとTTSのページ）は`danger`のボタンで、文字は赤く、塗りはありません（2026-11-25の決定）。止めるものがないときは半分の濃さで描き、吹き出しは残します。押したことには言葉で応えます（「止めています…」、続いて「止めました」）。ミュートは押したままになるトグルで、押している間は琥珀色にし、言葉でもそれを示します。ダウンロードの前に確認を開くボタンは、どこに出ても「取得内容を確認」で、普通の見た目（ライラックでない）にします。確認の画面のボタンを押すまでは何もダウンロードしないためです。
- 変わるものの場所（#912）：操作部品を押しても、応答が届いても、周りの何も動きません。何かを足したり登録したりするフォーム（利用者自身のモデル、翻訳エンジンやAPI）は、押したときに見つかるかもしれない問題のために、ボタンの下にいつも1行を空けておきます。高さは問題の枠の1行分（文字、内側の余白、枠線。`problem_slot`）です。その行は問題が出るまで空なので、問題が出たり消えたりしても、ボタンとフォームは動きません。それより長い問題は要るだけの行を使います。ボタンの開始と停止、接続の確認の結果、エンジンのカードの状態のバッジのように、状態で変わる言葉はいちばん広い言葉の幅を取り（`StableWords`、`common_components/stable_words`）、短い言葉はその幅の中央に置きます。エンジンのカードの読み出しや、チャットボックスの検出の行のように、状態で変わる読み出しの文も同じようにいちばん長い状態の行数を保ち、行の先頭から始めます。
- 入力欄の幅（#567）：フォームの中でも外でも、設定の行はどれも同じ2つの列を持ちます。ラベル（1fr）と入力欄（1.6fr）で、間は1.6remです。そのため、入力欄はどのページでも同じ場所から始まります。内容の幅が42rem未満か、ウィンドウが700px未満のときは、行を縦に積みます。値の長さが決まっていない入力欄（一覧からの選択、URL、APIキー、パス、ウィンドウの題、ホットキー、フォント）は入力欄の列いっぱいに広げ、横に置くのは自分のボタン（ホットキーの削除）までにします。デバイスの「自動選択」はマイクでもスピーカーでも入力欄の列の先頭に置き、スイッチを一覧の始まりにそろえて、それが選ぶ一覧の上に置きます。長さの分かっている短い値の入力欄（ポート、IPアドレス、数値、しきい値）は、列の始まりから最大14remの短い幅にします。単独のボタンは入力欄の列の始まりに、スイッチは列の終わりに置きます（#473）。ラベルのない、操作部品を組み合わせた行（メッセージの書式、単語の一覧）は両方の列にまたがります。共通の行のスタイルは`src-ui/views/app/config_page/setting_section/setting_box/_templates/Templates.css.ts`にあります。
- 一覧から選ぶものはどれもフォームの入力欄と同じ形にします。持ち上げた面、細い枠線、操作部品の角丸、高さ40pxで、一覧も、エンジンがページに色を付けさせるところでは同じ面の上に開きます。設定の行の選択欄も kit の `Select` なので（D-14）、空のとき（デバイスが見つからないとき）も表示されます。翻訳エンジンのように、多くの中から名前で探して選ぶものは kit の `Combobox` にします（#1369）。同じ入力欄の見た目のボタンで、幅はいちばん長い選択肢に合わせ、押すと選択肢とグループの見出しの上に検索欄のあるパネルが開きます。いま選べない選択肢は一覧に残し、半分の濃さで描きます。
- 初期設定の「いまの状態」（#557）のような、見つかったものの一覧はshadcn/uiのItemの一覧にします。その配置で、言葉を読む前に何に利用者の対応が要るかが分かるようにします。対応が要るものを先に置き、それぞれを独立したカードにします。カードには警告の琥珀色の線を左に引いて同じ色を薄く重ね、2.4remの印を付け、名前を濃く（1.5rem / 600）出します。残り（準備済み、確認中、どちらでもないもの）は、行の間に細い線を引いた1つの控えめな枠に続けて入れ、小さく（印は1.8rem、名前は1.3rem）、補助の文字と説明の文字の色で描きます。することがなければカードは1枚も出しません。行は状態の印、見つかったことの上に置いた項目の名前、その言葉の下に置く操作からなり、操作は言葉と同じ位置から始めます。ボタンを言葉の行末に続けて置くことはしません。印は言葉を繰り返すだけで、言葉の代わりにはしません。チェックの付いたライラックの円（準備済み）、「!」の付いた琥珀色の円（利用者にすることがあり、言葉がその内容を伝えます）、読み出しと同じ回る弧（確認中）、控えめな輪（どちらでもないもの。ほかの場所でした選択など）です。
- モデルやエンジンのカタログ（音声認識、テキスト読み上げ、ボイスチェンジャーのページのモデルのカタログ、利用者が入れる音声のエンジン、利用者が登録したモデル、翻訳のカタログの項目）は、言葉を読む前に、何か、どんな状態か、何ができるかが分かるようにそれぞれのカードを組みます（#614）。名前と状態のバッジは最初の行に並べ、状態は行の末尾に、どのカードでも同じ場所に置きます。そのモデルを選ぶ理由と避ける理由（何に勧めるか、メモリに収まる、重すぎるかもしれない）は名前の下のバッジの行にし、その後にモデルの1〜2行の要約と警告を続けます。ファイルの種類と事実（言語、大きさ、ハードウェア、提供元、ライセンス）は1つの表にし、項目名はどのカードでも同じ幅（14rem）を取ります。そのため、一覧を下へたどっても値は同じ場所から始まります。ファイルの種類かその選択は表の最初の行です。操作はその後に置き、カードの端から始めます。内容の幅が80remを超えるところのカードは、ファイルと事実を右に、モデルが何かと何ができるかを左に置き、横に読めるようにします。翻訳の確認の画面のように狭いところのカードは1列のままにし、内容の幅が42rem未満では、フォームの行を積むのと同じく項目名を値の上に置きます。使用中のカードはオンのスイッチと同じく、枠を動作中の色にし、ライラックを薄く重ねます。用途の見出しは、その用途が何のためか、その中でどう選ぶかをヒントに持ちます。GPUの読み取りがその用途について示すこと（このセッションの読み出し）、声のクレジットの条件、警告は画面に残します。測ったメモリと、どこで確かめたかは、ハードウェアの項目名のヒントにします。翻訳のカタログでアプリが同梱するモデルのように、事実を持たないカードは名前の行だけにし、商用利用を禁じるライセンスなら名前の横にその印を、行の末尾に状態を置きます。どのカタログでも、モデルのカードはどこを押してもカードの主な操作をします（#1228、#1254）。お使いのPCにあって使っていないモデルは、そのモデルを使います。翻訳のモデルはモデルの一覧と同じライセンスの確認を通り、音声のモデルはファイルを確かめて適用するところまでを一度に行います。お使いのPCにないモデルは取得内容の確認を開き、大きさ、ライセンス、同意を先に示します。使用中のカードと、取得中や確認済みのカードには押すものがありません。主な操作のボタンは押せる範囲をカード全体に広げ、カードのほかの操作（ファイルの選択、中止と適用、試聴、削除、事実の折りたたみ、リンク、ヒントの印）はその上に置いて、それぞれ単独で押せるようにします。キーボードとスクリーンリーダーにはそのボタン1つを示し、アクセシブルな名前はボタンの言葉の後にモデルの名前を続けます（「取得内容を確認（Qwen3-ASR 0.6B）」）。一覧やカードで選んだモデルは、カードにも反映します（#1228）。

言葉：英語の見出し、ラベル、選択肢は文の形の大文字の使い方（sentence case）にし、大文字を残すのは名前と略語だけです（VRChat、OBS Browser Source、API key）。利用者に向けた文では、利用者のPCを「お使いのPC」（英語では"your PC"）と呼ぶか、何も足さないところではPCに触れません。「このPC」（"this PC"）とは書きません（#437）。日本語の文では「メモリー」ではなく「メモリ」と書き（#472）、ON／OFFではなく「オン」／「オフ」と書きます（#476）。日本語の文では和文とラテン文字の語や名前の間を空けません（「VRChatのチャットボックス」、「APIキー」）。単位の前（「120 ms」）と、空けないと文とつながってしまうURLやファイル名の前後には空白を残します。日本語の文の中の英語の語は、名前でない限り訳します。「Overlay」ではなく「字幕オーバーレイ」です（#476）。エンジンが内部で使う値は生のIDのままではなく画面の言葉（「CPU」、「自動」）で示します。何を試したかは、試験の記録としてではなく利用者の言葉（どのGPUか、まだ確かめていないこと）で伝えます（#472）。設定はフォーカスを設定のナビゲーションへ移し、設定を開いた操作部品へ戻します。トランジションは短く（約120 ms）、動きを減らす設定ではなくします。押した操作部品はトランジションなしですぐに色を変えます。エンジンを待つ操作は、押したらすぐに待ちの状態を示し、結果が出るまで繰り返しの押下を受け付けません。待っているラジオの選択は使えない状態として読ませます（`aria-disabled`）が、フォーカスは受けられるままにします。そのため、キーボードのフォーカスは選んだばかりの選択肢にとどまります。選択肢がいくつかの種類に分かれる選択は、種類の名前の下に並べて1つのラジオのまとまりにします。矢印キーはすべての種類を通って動き、Tabは1回だけ止まります。 <!-- writing-exempt: 決まりが避ける表記を例として引いている -->

動きは`variables.css`のトークンを使います。`--vox_motion_fast`（120 ms）、`--vox_motion`（220 ms）、`--vox_ease`、最大2%行き過ぎる`--vox_ease_settle`です。動きは何かがどこから来たか、うまくいったこと、または少しの間だけ次に操作する場所を示すためのもので、飾りには使いません。

- ページの上に開くものは、キットの動き（`src-ui/views/kit/motion.ts`。[Motion](https://motion.dev/)を使います。#1378）で出入りします。画面がそれぞれに動かしたり、Motionをimportしたりはしません。モーダルダイアログは、フェードインしながら（`--vox_motion_fast`）0.8rem下から定位置へ上がり（`--vox_motion`）、背景を暗くする層も一緒にフェードインします。閉じるときはすぐに閉じるので、フォーカスはこれまでどおりに戻ります。ポップオーバーは、開く側でボタンの方へ0.4remずれたところからフェードインし、閉じるときは同じ向きへ少し速く戻ります。戻っていく間は押せません。設定のウィンドウのページは、最初に描かれたときに、ウィンドウが開いたときからあるタイトルバーの下で、その場でフェードインします。ウィンドウはすぐに閉じます。新しくなるのは動きだけです。何がフォーカスを受けるか、どう閉じるか、スクリーンリーダーに何が示されるかは変わりません。動きを減らす設定では何も動かしません。これらは不透明度だけを変えて出入りします。
- selectの一覧にスタイルを付けられるエンジン（WebView2）では、フォームのネイティブのselectの一覧は入力欄から下りてきて止まり、最初の数行が順に続きます。収まるときはこれまでどおり入力欄の下に開きます。WebKitGTKはシステムの一覧のままです。設定の行が使う kit の `Select`（D-14）は、どちらのエンジンでもシステムの一覧を開きます。
- 成功で終わる作業（モデルのダウンロード、実行環境の準備、サーバーの開始）は、読み出しの言葉の前に印を置きます。動いている間は回る弧で、終わるとチェックの付いたライラックの円になります。ページを開いている間に終わったときは、チェックが描かれていきます。
- ファイルを受け取るパスの入力欄は、その上にドロップする場所（`FileDropZone`）を持てます。この場所はファイルをウィンドウの上にドラッグしている間は受け付ける見た目になり、ポインターの下で浮き上がります。ドロップすると入力欄を埋めて、どれがどこに入ったかを伝えます。パスを打つ方法は入力欄のままで、ドロップするとすぐに保存します。
- パスの入力欄は、その横に、お使いのPCのパスを選ぶボタンを持ちます（#1231）。「ファイルを選択」はシステムのファイル選択を開き、欄が受け付ける種類を挙げているときはその種類のファイルだけを出します。「フォルダーを選択」はフォルダー選択を開きます。ボタンのアクセシブルネームは欄の名前も挙げます。欄はボタンの横で入力欄の列を埋め、ボタンの右端は行の右端にそろえます。列が狭くて両方が並ばないときは、ボタンを欄の下の同じ右端に置きます。選択画面は欄のパスのフォルダーで開きます。選んだパスは入力したときと同じように欄に入り、入力したパスを保存するときと同じときに保存されます。選択をやめた場合は何も変わりません。選択画面を開けなかったときは欄の下でそう伝え、欄はパスを入力したり貼り付けたりする手段のまま残ります。会話ログの保存先は、欄の下のボタンの並びをそのまま使い（#1115）、選んだフォルダーはすぐに保存します。
- 初期設定は、準備した機能のスイッチへ、行ではなく押す部品のトグルで案内します（#955）。トグルの周り（トグルを隠すアイコンの列では、アイコンの周り）にライラックのグラデーションの輪を描き、5 秒以内に 3 回点滅させたあと、スイッチをオンにするまでそのまま残します。動きを減らす設定では点滅させず、スイッチにキーボードのフォーカスがある間はフォーカスの輪だけを描きます。輪の中のキットのスイッチは見た目を変えないので、オフのままに見えます。

スプラッシュ画面はありません。エンジンが起動する間、メインのページは本来のレイアウトで描きますが、操作を受け付けず、処理中として扱います。エンジンがまだ送っていない値は、その値と同じ大きさの平らな仮の表示（`[data-skeleton]`、`--vox_skeleton`）にするので、値が届いても何も動きません。仮の表示の明滅はゆっくりで薄く、動きを減らす設定では止めます。最初の画面の準備の一覧は、起動がどこまで進んだかと、どのモデルを取得しているかを伝えます。起動に失敗したときは、そのページの上に、理由、次の手順、再試行と終了の操作を持つダイアログを出します。このダイアログはモーダルではないので、タイトルバーは使えるままです。

Quick ChatとVR UIは入力と音声の契約を変えずに共通の色を受け継ぎます。TTS、RVC、ダウンロードのフォームは、入力欄、操作、状態の見た目を共有します。保存して持ち続けるコンパクト表示の設定は、狭いウィンドウでの一時的なレイアウトとは別のままです。

部品はこのファイルの決まりが許す範囲で[shadcn/ui](https://ui.shadcn.com/)の部品にそろえます（2026-11-19）。部品はshadcnの対応する部品から次のものを取り入れます。

- 設計：部品を作るパーツ、そのprops、バリアントと大きさの分け方と名前
- 見た目：余白、大きさ、枠線と、ホバー、フォーカス、不正な値、使えない状態、開いた状態の描き方
- 構造：部品ごとに1つのファイルにしてパーツを名前付きのexportにすること、各パーツに名前を付ける`data-slot`属性、1つのrecipeにまとめたバリアント

shadcn/uiが1つの部品を、元にするライブラリを変えて複数用意しているときは、Radixのものを読みます。以前に参考として挙げた[shadcn.io](https://www.shadcn.io/)（#614）は、shadcn/uiの上に同じトークンで作った別のサイトです。その部品は例として読んで構いませんが、そろえる相手はshadcn/uiです。

変えないものもあります。スタイルはvanilla-extractで書き、Tailwindは足しません。色は上のASTAROTの配色です。Radixのパーツは同じプリミティブを同じ組み方でそのまま使います。shadcnからは何も依存として取り込みません（CLIも`components.json`も使いません）。shadcnのコードは次の決まりで書き換えます。

- Tailwindのクラスは部品の`.css.ts`の`style()`にします。`cva()`は同じバリアントの名前と既定値を持つ`@vanilla-extract/recipes`の`recipe()`にし、`cn()`は`clsx`にします。
- shadcn/uiの色のトークン（`primary`、`muted`、`accent`、`border`、`input`、`ring`など）は、ASTAROTのトークンを指すものとして読みます。shadcnの色の値は使いません。アプリには暗い配色しかないので、shadcn/uiが`dark:`の値を持つときは、その値を読みます。
- 長さはピクセルの大きさで取ります。Tailwindのremは16px、アプリのremは10pxなので、`h-9`（36px）は`3.6rem`、`px-3`（12px）は`1.2rem`です。角丸と文字の大きさは、そのあとでこのファイルのいちばん近い段（`rounded`、`typography`）へ移します。
- refを渡すパーツは、shadcn/uiがReact 19向けに書くとおり、refをpropsの1つとして受け取ります。`forwardRef`は使いません。Radixは、アプリがすでにそうしているとおり、それぞれの`@radix-ui/react-*`のパッケージから取ります。
- shadcn/uiの出入りのアニメーション（`animate-in`、`fade-in`、`zoom-in`、`slide-in-from-*`）は、キットの動き（`src-ui/views/kit/motion.ts`）が動きのトークンを使い、フェードと短いスライドとして再生します。動きを減らす設定では、フェードだけを残します。
- 実行時に`<style>`を足すRadixのパーツには、`docs/development.md`にあるCSPの手順が要ります。

ボタンの見た目（#474）、40pxの入力欄、フォーカスの輪のように、shadcnの部品とこのファイルの決まりが違うときは、意図して変えるまでこのファイルの決まりを残します。部品はどれかを変える前に1つずつshadcn/uiと比べ（`docs/design/components/shadcn-alignment.md`）、判断の要る違いは書き換えの作業ではなくそこで決めます。

Tailwindで書かれたshadcn/uiに対応するものがない点は、引き続き[OptiAxiom](https://github.com/optimizely-axiom/optiaxiom)を参考にします。vanilla-extractでのトークンの分け方と、recipeとsprinklesの書き方です。

コードはライセンスを確かめて記録してから写します（`docs/voice-stack/licensing.md`）。shadcn/uiはMITライセンスなので、shadcn/uiにそろえる最初の部品で、そこと`NOTICE.md`にshadcn/uiを記録します。shadcn.ioは無料の部品にライセンスを示していません。

## 利用者向けマニュアル（site/）

マニュアルは同じDark Studioの中の読むための面です。impeccableとunslopの監査で既定のままのVitePressに見えると分かったあと、2026-11-15にこの形を選びました。世界観は枠に任せ、読む列は落ち着いたままにします。1行は日本語で約40字、フォントは読み手のもの（Webフォントは使わず、テーマのInterも使いません）、十分なコントラストです。

- マニュアルはアプリの配色を明るい配色と暗い配色の両方で使います。Dark Plum、Lilac、Off-Whiteです（[サイトの作り直し](docs/design/site-redesign/README.md)の3）。暗い配色の値はこのファイルの色です。`tools/site_tokens.mjs`が、その値と「色」の決まりで作った明るい配色の値を、`--a-`の役割のトークンとして`site/theme/tokens.css`に書き出します。Pagesのワークフローがそのファイル、色相と彩度の決まり、コントラストを確かめます。マニュアルの部品は役割のトークンだけを使います。配色は読み手のOSが選び、上部のバーには切り替えのスイッチがあります。
- Rspressはブランドの色を文字として描く（いまいるページ、ホバー、検索で一致したところ）ので、どちらの配色でも文字として読めるLilacの`state-active`を使います。ボタンのLilacの塗りは`primary`です。
- マニュアルの特徴になる要素は、声と文字の機能のページと音声経路のページの上部にある経路の帯です。声や文字が通る段階を並べ、そのページの段階を、選んだものの色であるLilacで光らせます。レーンは向きで色分けしません。送るものを運ぶか、返ってくるものを運ぶかは、レーンの名前が伝えます。ページは自分の経路をfront matterで指定します（`route: tts`）。経路は`site/theme/lib/routes.ts`にあります。仕組みの図とホームページのループは、描き直すまで以前の配色の青と紫のままです（作り直しの段8）。
- 区切りの見出しは設定の大見出しと同じ形です。題の右へ細い線を引き、上には線を引きません。
- 注意の枠、「必要なもの」の行（`{.needs}`）、折りたたみは、持ち上げた面の上に置き、周りを細い線で囲みます。状態の色は題と枠線の色合いに出し、警告は琥珀色、危険は赤にします。太い横の帯は使いません。
- 機能の短い一覧は`{.feature-rows}`にします。リンクになる名前を独立した列に置き、何をするかを1行で書きます。
- ホームページの製品名は最大の大きさの単色の文字にします。ボタンは両端の丸い形ではなく操作部品の角丸（8px）を使います。
- その下では、それぞれの機能の横にその経路の短いループを置きます（ホームページのfront matterの`showcase`）。ループはRemotionで`site/motion`から`site/public/motion/<lang>/`へ書き出します。機能ごとに1つの具体例を描き、信号が届くにつれて図が1部分ずつ伸び、読めるだけの時間止まったあと消えて、ループは空の状態から始まります。ループは画面に見えている間だけ再生し、動きを減らす設定ではできあがった場面を静止画で見せます。意味を伝えるのはループの横の文で、ループは文にないことを伝えません。

## することとしないこと

- モデルの同意、独立したスイッチ、停止とミュートの振る舞いを保ちます。
- 日本語のラベル、長いパス、キーボードでの移動、狭いウィンドウを、製品の部品を使って確かめます。
- 設定済み、待ち、動作中、失敗の状態の区別を保ちます。
- 配置で意味を伝えられるところに、補助のラベルや常に見える説明を足しません。長い説明は吹き出し（`Hint`）に入れます。
- この作り直しのために、リモートのフォントや新しいUIフレームワークを入れません。
- 飾りの表示で、接続、モデルの準備、マイクの動作をほのめかしません。
