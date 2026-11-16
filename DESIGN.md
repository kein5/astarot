---
name: VRCT-VOX Dark Studio
description: A quiet navy workspace for conversation and voice control.
colors:
  primary: "#2865dc"
  primary-hover: "#3470e8"
  focus: "#a9ccff"
  canvas: "#111b2c"
  rail: "#0d1625"
  surface: "#18253b"
  border: "#344662"
  text: "#edf3ff"
  secondary-text: "#adbed6"
  description-text: "#8d9fb9"
  state-active: "#80acff"
  state-warning: "#cb944f"
  state-failed: "#f08a85"
  readout-rule: "#5b92ff"
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
    textColor: "#ffffff"
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

The user chose a complete redesign in deep navy and blue on 2026-10-30. Conversation and audio control take precedence over visual effects. Keep familiar chat, settings and native window controls in the existing React/CSS-module application.

**Key Characteristics:**
- A deep rail separates navigation from the conversation workspace.
- Blue identifies primary actions, selected navigation and keyboard focus.
- Shared forms make TTS, RVC and model downloads feel part of the same application.

## Colors

Use the canvas for conversation and settings, the deeper rail for navigation, and raised surfaces for fields. Borders separate working regions without heavy cards. Amber and red retain warning/error meanings; enable state is also expressed by labels and switch position.

## Typography

Keep the user's configured UI font, scaling and log-font preferences. Local Noto/system fallbacks support Japanese without remote font requests. Section headings give long forms a readable hierarchy; technical paths wrap inside their containers.

## Layout

The regular main rail is 240px and the settings rail is 208px. At the existing 800px scaling-aware breakpoint, main navigation uses a 72px icon rail; its toggle can temporarily expand the rail to reach the language controls without changing the saved compact preference. The expanded rail lies over the conversation, which keeps its width, and closes with Escape (focus returns to the toggle) or a press outside it. Returning to a wide window clears that temporary expansion. The rail is a column: the logo, a scrolling part, and the settings button at its foot; the scrolling part shows a visible thumb whenever it has more below. In the wide rail, the language settings put their heading and the three presets on one row, and each language is a small heading over a field-like button, so one target language and the translator fit without scrolling at 1280×720. The translator choice opens under its button inside the rail, opaque and as tall as its engines, and the rail scrolls to it. A switch that is on carries a blue tint on its row and a blue icon, in both rails; the icon rail also names each switch in a tooltip and shows the selected language pair under the switches, which opens the rail when pressed. A switch that is off and still misses its setup (a model, the speech source, the voice route) is greyed out and does nothing when pressed; its tooltip says what is missing and where to provide it, and in the wide rail a quiet button under it opens that place. A switch that is on is never greyed out, so it can always be turned off. The VR launcher's function buttons follow the same blocks: greyed out with an amber warning mark, with what is missing and where in the PC settings to provide it in the button's tooltip, which shows even when the VR tooltips are turned off. Settings use a 56px rail that expands for keyboard focus or hover; focus from a click does not keep it open after the pointer leaves. Small windows scroll rather than dropping controls.

A feature is named by what it does, with its short technical name in brackets: テキスト読み上げ（TTS） / Text to speech (TTS), ボイスチェンジャー（RVC） / Voice changer (RVC), 音声認識（ASR） / Speech recognition (ASR), チャット読み取り（OCR） / Chat reading (OCR). The main switch, its settings page, its hotkey and the user guide use the same name. Where the name does not fit on one line, it breaks before the bracket (`splitFeatureLabel`), never inside a word; the rail keeps its width. A sentence that sends the user somewhere quotes the full name; other sentences may use the short name.

The main top bar leads with the stop actions (stop TTS, mute), in the same place at every window size. The window and VRChat toggles (always on top, VRChat microphone mute sync, subtitle overlay) open from one quick settings button on the right, which says how many of them are on; a toggle that cannot be used says why under its row. Under the toggles a readout says in words whether a VRChat with OSC enabled is seen on this PC, with the step that turns OSC on when it is not; the VRChat settings page opens with the same readout. When the conversation column is narrower than 64rem the bar draws its shortest words and the quick settings button keeps only its icon; accessible names and tooltips stay the full words. The column's width decides, not the window's, so the 240px rail and the UI size are accounted for (container queries on the column; rem follows the UI size). The stop actions never shrink below their words. The quick settings panel is sized by the column and scrolls inside itself when the column is short.

The conversation occupies the largest region. In a very wide window the log and the composer keep a measure of at most 120rem, centred in the column; the send button stays square (at most 10rem) at the composer's foot. A short column (under 36rem, which includes the 200px minimum window) gives its height to the log: the top bar, the logo row and the language selector's bar are 4.4rem, the margins are thinner and the composer keeps one line; the inputs and outputs panel then lies over the conversation instead of pushing it out. In taller columns that panel takes at most 60% and shrinks before the log does. An empty state explains where to type; in the main window it also lists the models the selected engines still need, each with a button that opens the step that provides it (the download review, or the speech recognition settings where the local speech recognition models are set), and a one-line hint for enabling OSC in VRChat while messages are sent there. The composer has a blue send action. Settings have a conventional back button, search and aligned sections. Field labels stack below 700px. Dialogs constrain their width to the viewport and keep explicit consent visible.

Notices (toasts) do not cover controls. On the main page they appear at the top of the conversation, under the top bar and beside the rail, so the switches, the settings button and the composer stay reachable while a notice is up. In settings they appear at the bottom of the content column, clear of the save bar and the rail. A notice that is already showing moves with the page. Only a window too narrow to hold a readable notice beside the rail lets it slide over the rail.

## Roles in settings

Settings pages use four roles, and each must be recognizable without reading it. The user approved these on 2026-11-01.

| Role | Look | Use |
|---|---|---|
| Category heading | 2rem / 600, text color, 40px above and 16px below, hairline to the right; the first heading on a page sits right under the top bar | One per page section (TTS, RVC, Mic) |
| Subheading | 1.5rem / 600, secondary text, 24px above and 8px below, no frame | Groups inside a section (Monitor, Japanese TTS voice) |
| Item label | 1.4rem / 500, text color, wraps | The name of one setting |
| General description | 1.2rem / 400, description text, at most two lines visible; the rest goes in a "詳細" disclosure | What a setting does, true on every PC |
| Environment readout | 1.3rem / 500, tabular numbers, surface background, 3px left rule, 8px radius | What this PC and this session report now: GPU and memory, server state, download progress, model support |

A readout states its condition in words; its color repeats the words (active blue, warning amber, failed red) and never replaces them. Frames are kept for real units, such as one server or engine; groups inside a section are separated by space and a subheading, not by nested borders. One-time setup (model files, servers, downloads) sits in one folded "モデルとサーバー" section per page with a one-line status. On the translation page, and for the cloud engines on the speech recognition page, each provider is one such fold whose line says whether it can be used; the provider in use stays open. A page opens on the choice that decides what else on it applies: speech recognition starts with the engine. Each switch on the main page has a settings page of the same name; chat reading has its own page, and the VRChat page ends with a button that opens it. Numbers that are set once, if ever (how speech is cut into messages), sit in a fold whose line shows the values in use.

The settings top bar, like the main one, always offers the stop actions: stop TTS (clears the queue) and mute VRCT's voice output. They are quiet until there is something to stop. Its save bar is the one place to save: text fields register their edits there instead of carrying their own save buttons, and Enter still saves the field being edited. The bar shows the state and a count; the changed rows carry a short blue rule on their left, and the names are in the bar's tooltip and its screen-reader list.

## Elevation & Depth

Group controls with spacing, alignment and quiet borders. A dim backdrop identifies modal scope. Avoid decorative elevation in routine forms.

## Shapes

Controls have gently curved edges; the composer has a slightly larger radius. Preserve user window-corner preferences.

## Components

Native buttons carry actions and accessible names. Focus rings remain visible, native checkbox state remains recognizable, and select menus use the dark scheme. Settings transfer focus into their navigation and back to the settings trigger. Transitions are short (about 120 ms) and disabled under reduced-motion preferences; a pressed control changes color at once, without a transition. An action that waits on the engine shows its pending state as soon as it is pressed and ignores repeat presses until it settles.

Motion uses the tokens in `variables.css`: `--vox_motion_fast` (120 ms), `--vox_motion` (220 ms), `--vox_ease`, and `--vox_ease_settle`, which overshoots by at most 2%. It shows where something comes from or that it worked, never decoration:

- A dropdown's list drops from its field and settles, with its first rows following one another. On engines that can style a select's list (WebView2), the forms' native selects open the same way and still open below the field when it fits; WebKitGTK keeps its system list.
- Work that ends in success (a model download, a runtime setup, a server start) has a mark before its readout's words: an arc that spins while it runs, then a blue disc with a check that draws itself if it finished while the page was open.
- A path field that takes files can have a drop place above it (`FileDropZone`). It wakes while files are dragged over the window, lifts under the pointer, and on a drop fills the fields and says what went where. The fields stay the way to type a path, and the save bar stays the way to save.

There is no splash screen. While the engine starts, the main page is drawn at its real layout but is inert and busy: values the engine has not sent yet are flat placeholders of their own size (`[data-skeleton]`, `--vox_skeleton`), so nothing moves when they arrive. Their pulse is slow and faint and stops under reduced motion. The first screen's setup list says how far the start has come and which models it is fetching. A failed start is a dialog over that page with the reason, the next step, a retry and a quit action; it is not modal, so the title bar stays usable.

Quick Chat and the VR panel inherit shared colors without changing input/audio contracts. TTS/RVC/download forms share field, action and status styling. A persistent saved compact-mode preference remains separate from the temporary narrow-window layout.

## The user guide (site/)

The guide is a reading surface in the same Dark Studio, chosen on 2026-11-15 after an impeccable and unslop audit found it read as stock VitePress. The world owns the frame, and the reading column stays calm: about 40 Japanese characters a line, the reader's own fonts (no web font, VitePress's Inter removed), real contrast.

- The signature is the route strip at the top of each voice and text feature page and each audio-route page: the steps voice or text passes through, with this page's step lit. Blue lanes are what you send, purple lanes what comes back, as in the how-it-works diagram. A page names its route in front matter (`route: tts`); the routes are in `site/.vitepress/theme/routes.ts`.
- Section headings are the settings' category heading: the title with a hairline running to the right, no rule above.
- Callouts, "what you need" lines (`{.needs}`) and folds sit on the raised surface with a hairline all round. State color lives in the title and a tint of the border, amber for warnings and red for danger; no thick side stripe.
- A short list of features is `{.feature-rows}`: the name, which is the link, in its own column and one line of what it does.
- The product name on the home page is solid text at the largest size; buttons use the control radius (8px), not pills.
- Under it, each feature sits beside a short loop of its route (`showcase` in the home page's front matter). The loops are rendered with Remotion from `site/motion` into `site/public/motion/<lang>/`: one worked example per feature, the diagram growing one part at a time as the signal reaches it, held long enough to read, then leaving so the loop starts empty. A loop plays only while it is on screen; with reduced motion the page shows the finished scene as a still. The text beside a loop carries the meaning; the loop never says anything the text does not.

## Do's and Don'ts

- Do preserve model consent, dirty-form guards, independent switches and stop/mute behavior.
- Do check Japanese labels, long paths, keyboard navigation and narrow windows using production components.
- Do retain the distinction between configured, pending, active and failed states.
- Don't introduce remote fonts or a new UI framework for this redesign.
- Don't imply connection, model readiness or microphone activity through decorative indicators.
