# Inventory of hand-built components: a list per screen

[日本語版](#手作りの部品の棚卸し-画面ごとの一覧日本語版)

This document lists, screen by screen, the places where a screen builds a control by hand from native elements or a `div` even though a shared component exists. It is groundwork for deciding the order of two pieces of work: replacing those controls with components aligned with shadcn/ui (new-york-v4), and moving the styles to vanilla-extract (#957). At the time of the inventory, no code was changed.

- Status: inventory (2026-11-23). How to carry out the replacement (H-01 to H-03) was decided on the same day, and the look of a replaced element (H-04) on 2026-11-24. The replacement started on 2026-11-24. When an element is replaced, write "replaced" in its row with the pull request number.
- App checked: develop (after #983 was merged, `7a4b684`)
- Related documents: [Component inventory: comparison with shadcn/ui](shadcn-alignment.md) (decision items D-xx), [Settings screen component experiment](README.md) (the kit and open questions K-xx), [ADR-010](../../adr/adr-010-frontend-stack.md)

## How to read this document

- **Shared components** are the ones in "List of shared components" below. They come in 3 layers: the kit aligned with shadcn/ui (`src-ui/views/kit/`), the app-wide `common_components`, and the settings' `_components` and `_templates`.
- **Hand-built** means that a screen does not use a shared component: it writes native elements (`<button>`, `<select>`, `<input>`, `<dialog>` and so on) or a `div role="button"` directly and styles them with the SCSS of that screen or of a nearby module.
- **Replacement** names a component that exists among the shared components now. An element that no shared component matches has "no shared component", and its replacement is given as its number (U-xx) in "Elements with no shared component" below.
- **Difficulty** has 3 levels.
  - Low: The shared component fits as it is. Any visual difference is small enough to need no decision.
  - Medium: A shared component exists, but the shape of the props, the tests and styles shared with other screens also need changes. The look changes, so the screen has to be checked.
  - High: The replacement is not settled until decision items (D-xx, K-xx) are decided. Or keyboard operation, the way waiting is shown or focus behavior changes.
- The VR UI, the subtitle overlay and the companion handle are outside the comparison with shadcn/ui ("Other components" in [the comparison document](shadcn-alignment.md)). This document only lists where their hand-built elements are. The VR UI, the companion handle, the error screen and the startup failure dialog are not replaced with shared components either. Within the VR UI only, the language window's filter and collapsible section are brought in line with the VR UI's components (H-03).
- The replacement goes component by component after the styles move to vanilla-extract (#957), as H-01 decided.

## List of shared components

### kit (`src-ui/views/kit/`)

Components aligned with shadcn/ui. The sample page (`src-ui/kit-lab.html`) shows all of them. From 2026-11-24 the app's screens use them too, in the rows marked "replaced" below (open question K-01; H-04).

| Component | What it is | shadcn/ui counterpart |
|---|---|---|
| `Button` | `tone` (primary, plain, quiet, danger) and `size` (regular, compact, icon) | Button |
| `TextField` | A native `<input>`, with `invalid` and `mono` | Input |
| `Select`, `SelectOption`, `SelectOptGroup` | Wraps a native `<select>` | NativeSelect |
| `Switch` | Radix UI's Switch | Switch |
| `Toggle`, `ToggleGroup`, `ToggleGroupItem` | Radix UI's Toggle and ToggleGroup: `tone` (accent, warning) and `size` (regular, compact, icon) (#1175) | Toggle, ToggleGroup |
| `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent` | Radix UI's Popover, never modal: `inset` (regular, tight) (#1175) | Popover |
| `Dialog`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription` | A native `<dialog>` (`showModal()`), opened and closed through `open` and `onOpenChange` | Dialog |
| `SettingGroup`, `SettingRow` | A group with a heading, and one row of name, description and control | Close to Field (D-34) |

### `common_components` (`src-ui/views/common_components/`)

| Component | What it is | Screens that use it |
|---|---|---|
| `Checkbox` | Hides the native input and draws a box | Many settings pages through the settings' `CheckboxContainer`; "Device" |
| `Tooltip` | A tooltip (not Radix, #766) | The main rail, the top bar, the title bar, the input field, stop and mute, the resend button |
| `ToggleSwitch` | A `div` switch that does not take focus | Only the main feature switches |
| `Empty`, `EmptyDescription` | "No results" | Settings search, the language list |
| `CircularProgress` | Circular progress | Download buttons, the updating indicator |
| `ResetButton`, `CloseButton` | Icon-only buttons | `ResetButton`: message formats and "Captions and VR"; `CloseButton`: notifications and the error screen |
| `MarqueeText` | Scrolling text | None (no screen uses it) |

### Settings components (`setting_box/_components/` and `_templates/`)

The settings components fall into 2 families.

- **The row family.** `DropdownMenuContainer`, `CheckboxContainer`, `SliderContainer`, `RadioButtonContainer`, `EntryWithSaveButtonContainer`, `ActionButtonContainer` and others in `_templates/Templates.tsx` put a name, a description and a control in one row. The components inside are `_DropdownMenu` (a custom combobox), `_Entry`, `Slider`, `RadioButton`, `ActionButton`, `ConnectionCheckButton`, `ColorEntryWithSaveButton`, `HotkeysEntry`, `AuthKey`, `WordFilter` and `MessageFormat`. "Appearance", "Device", "Captions and VR", "Hotkeys", "Advanced", "Experimental", "Updater", "Chat reading (OCR)" and "Other" use it, and so do parts of "Translation" and "Speech recognition (ASR)".
- **The form family.** `FormRow`, `SetupSection`, `Fold`, `Lead` and `Hint` build the frame and the descriptions, and the controls inside are native `<select>`, `<input>` and `<button>` elements written directly. The classes in `advanced_settings/VoiceSettings.module.scss` (`primary`, `quiet`, `actions`, `card`, `badge`, `progress`, `checkLabel`, `dialog_text` and others) draw them. It is a set of classes, not components. "Text to speech (TTS)", "Voice changer (RVC)", the audio routes in "Device", the catalog in "Translation", the realtime part of "Speech recognition (ASR)", model downloads and the OCR models use it.

In both families, the components are written with native elements, not with the kit (for example, `ActionButton` and `ConnectionCheckButton` contain a `<button>`).

Both families also use `Fold` (open and close, #820), `FormRow`, `SetupSection`, `AdvancedSection`, `PagePointer`, `EnvReadout`, `FileDropZone` and `ThresholdComponent` (a threshold built into the volume meter; outside the comparison under D-41).

### VR UI (`src-ui/views/vr/`)

Components used only in the VR UI: `VrWindow` (the window frame), `VrPickerList` (a list of choices), `VrSettingsRows` (switch rows, rows of choices, the `Disclosure` that opens and closes, the `Picker` for choices) and `VrTooltip` (passes the tooltip text to the Python side). The VR UI is a separate screen drawn in px steps, so it is outside the comparison.

## Points that affect every screen

Before the per-screen tables, these are the hand-built elements that every screen has in common. The per-screen tables do not repeat them.

| Element | Current state | Replacement | Difficulty | Complications |
|---|---|---|---|---|
| Buttons | No screen uses the kit's `Button`. Outside the kit, 78 files hold 198 `<button>` elements, drawn with the form's `primary` and `quiet` classes or with each module's SCSS | The kit's `Button` | High | The height stays 4rem (D-03) and the variants stay primary, plain, quiet and danger, with stop as danger (D-10), as decided on 2026-11-25. Icon-only buttons (the title bar, opening and closing the rail, `ActionButton`, `ResetButton`, `CloseButton`) move to `size="icon"`, but their sizes differ from place to place. Buttons that stay pressed (`aria-pressed`) are Toggle (U-03), not Button |
| Dialogs | 14 `<dialog>` elements are written screen by screen. Of these, 7 share the classes of `LegacyModelDownloadDialog.module.scss`, and the 3 download consent dialogs are drawn with the `dialog` rule of the form SCSS (`VoiceSettings.module.scss`) | The kit's `Dialog` and its parts | Medium | Under decision 3 of #764, a dialog is replaced with the part components the next time it is rebuilt. As decided on 2026-11-25, the base stays the native `<dialog>` (D-23), the button order stays as it is with no close button at the top right (D-24), and the screens take the kit's details (D-43). The shared SCSS cannot be removed until all 7 move together |
| Form select fields | 33 native `<select>` elements in 11 files, drawn with the form classes | The kit's `Select` | Medium | The row family uses its own `_DropdownMenu`, so there are 2 kinds of select field. D-14 decides which one to align on, and K-04 when to remove it. The rule that uses `appearance: base-select` in engines that support it (detected with `@supports`) is not in the kit's `Select`, so it has to be moved there |
| Form input fields | Native `<input>` elements for text, numbers, URLs and passwords | The kit's `TextField` | Medium | They differ from the row family's `_Entry` in horizontal padding and in how the disabled state looks (D-37). `FormRow` clones its child to pass `id` and `aria-describedby`, so check that the kit's `TextField` accepts them |
| Form checkboxes | 13 native checkboxes (`accent-color`) in 10 files. The form family's shared `HintCheck` is one of them | `Checkbox` from `common_components`. Settings that turn on and off become switches (K-02) | Medium | K-02 was decided on 2026-11-25 as proposed: switches for on and off, checkboxes only to confirm consent. The base stays the native input (D-16) |
| The native `title` attribute | Short names in the settings rail, usage presets, ruby and speaker names in the conversation log, model versions, the voice sample buttons | `Tooltip` from `common_components` | Low to medium | The ruby and the version labels are elements that do not take focus. `Tooltip` opens on focus and on hover, so how to handle elements that do not take focus has to be decided (D-21) |

## Screen by screen

### Main screen

| Location | Hand-built elements | Replacement | Difficulty | Complications |
|---|---|---|---|---|
| Language selection (`main_section/language_selector/LanguageSelector.tsx`, `LanguageSelectorTopBar.tsx`) | The filter `<input type="search">` (with only `data-slot="input"` added), the grid of language buttons, the back button | The filter field: the kit's `TextField`. The filter and the grid together: U-01. The back button: the kit's `Button` (the filter field and the back button replaced, #1178; the grid stays hand-built in the kit's tokens, focus ring and radius, D-36) | High | Enter selects the first match. The grid is two-dimensional, so it does not fit the arrow-key rules of a listbox. The VR UI's language window builds the same pattern separately |
| The button that opens the language window (`language_selector_open_button/LanguageSelectorOpenButton.tsx`) | A `<button>` with `aria-expanded` | The kit's `Button` (replaced, #1146; centered as the kit draws it, H-05) | Medium | What opens is not a popover but the language selection, which takes the place of the conversation area. The open and close relationship stays as it is |
| Swapping languages, and adding and removing target languages (`LanguageSwapButton.tsx`, `AddRemoveTargetLanguageButtons.tsx`) | `div role="button"` | The kit's `Button` (`size="icon"`) (replaced, #1123) | Low | Turning the `div` into a `button` needs no decision (the same reasoning as item 11 of "Differences that can be aligned without a decision" in the comparison document) |
| Translation engine selection (`TranslatorSelectorOpenButton.tsx`, `translator_selector/TranslatorSelector.tsx`) | The open button is a `div role="button"` with `aria-expanded`. Each engine in the opened list is a `div role="button"` with `aria-pressed` | The open button: the kit's `Button`. The opened list: U-04; choosing an engine: U-03 | High | Only one engine can be chosen, so radio behavior fits better than a group of `aria-pressed` buttons. Engines that cannot be used are taken out of the focus order |
| Preset switching (`preset_tab_selector/PresetTabSelector.tsx`) | 3 `div role="button"` elements with `aria-pressed` | U-03 | High | Item 11 of "Differences that can be aligned without a decision" in the comparison document (turning the `div` into a `button`) is not applied yet |
| Main feature switches (`main_function_switch/MainFunctionSwitch.tsx`) | The whole row is `role="switch"`, drawn inside with `ToggleSwitch`. The "Other features" and settings buttons | The kit's `Switch` (D-19); the buttons: the kit's `Button` | High | The pressable whole row, the way waiting is shown, the tooltip with the reason a feature cannot be used and the display in the compact rail have to be kept |
| Quick settings (`QuickSettingsMenu` in `top_bar/right_side_components/RightSideComponents.tsx`, `_buttons/OpenQuickSettingButton.tsx`) | Custom opening and closing (it closes on Esc, on a press outside and when focus leaves) and a `role="group"` panel. The items inside are `aria-pressed` buttons | The panel: U-04; the items: U-03 | High | The contents are a set of toggles, not a menu (`role="menu"`) (D-25) |
| The "Inputs and outputs" panel (the open button in `RightSideComponents.tsx`, `io_flow_panel/IoFlowPanel.tsx`) | An open button with `aria-expanded` and `aria-controls`, a close button | The kit's `Button` (replaced, #1122) | Low | The open and close relationship stays as it is |
| The update notice button (`RightSideComponents.tsx`) | `<button>` | The kit's `Button` (replaced, #1122) | Low | Its tooltip uses `Tooltip` |
| Rail controls (`sidebar_section/SidebarSection.tsx`, `open_settings/OpenSettings.tsx`, `sidebar_compact_mode_button/SidebarCompactModeButton.tsx`, `language_readout/LanguageReadout.tsx`, `engine_readout/EngineReadout.tsx`) | Icon-only `<button>` elements, and buttons that double as readouts | The kit's `Button` (`size="icon"`) (the icon-only buttons replaced, #1141). The readouts stay as they are | Medium | The tooltips use `Tooltip`. The rail's width (DESIGN.md, "Layout") sets their size |
| Conversation log (`log_box/message_container/MessageContainer.tsx`, `SpeakerNames.tsx`) | The speaker name button (`aria-expanded`) and the name field that opens in place (a native `<input>`, save and cancel `<button>` elements). The descriptions of ruby and speaker names use the native `title` | The field: the kit's `TextField`; the buttons: the kit's `Button`; the descriptions: `Tooltip` (the speaker name field and its buttons stay hand-built, H-06) | Medium | Ruby is an element inside the text, and one utterance can carry many. A tooltip on each one adds rendering work when the log is long |
| Resend button (`message_sub_menu_container/MessageSubMenuContainer.tsx`) | A `<button>` that resends on a long press | The kit's `Button` (stays hand-built, H-06) | Medium | Keep the long-press detection (pointer events) |
| Log display settings (`message_log_settings_container/MessageLogSettingsContainer.tsx`) | The open button is a `div role="button"` with `aria-expanded`. A panel that closes on Esc | The open button: the kit's `Button`; the panel: U-04 (the open button stays hand-built, H-06) | High | — |
| Input field (`message_input_box/MessageInputBox.tsx`) | `<textarea>`, the send `<button>` | The input field: U-06; send: the kit's `Button` (the send button stays hand-built, H-06) | High | The input field has a 12 px corner radius (DESIGN.md). Whether its growing height is written with `field-sizing` is D-13 |
| Empty state (`log_box/EmptyState.tsx`) | "Open setup" and the `<button>` elements that start features | The kit's `Button` (replaced, #1121) | Low | The comparison document marks the screen's layout as "keep" |
| Realtime controls (`realtime_controls/RealtimeControls.tsx`) | The stop `<button>` | The kit's `Button` (replaced, #1121) | Low | — |
| Stop and mute (`others/stop_actions/StopActions.tsx`) | The stop `<button>`, and the mute `<button>` with `aria-pressed` (amber when pressed) | Stop: the kit's `Button` (whether it is danger is D-10); mute: U-03 | High | Stop and mute stay separate controls (PRODUCT.md, DESIGN.md) |
| Title bar (`others/window_title_bar/WindowTitleBar.tsx`) | The minimize, maximize and close `<button>` elements | The kit's `Button` (`size="icon"`) | Medium | They overlap the area that moves the window. Their size matches the OS title bar |

### Settings screen (parts on every page)

| Location | Hand-built elements | Replacement | Difficulty | Complications |
|---|---|---|---|---|
| Top bar (`config_page/topbar/Topbar.tsx`) | The back `<button>`. The save bar, its buttons and its leave `<dialog>` went with #1111 | The kit's `Button` (replaced, #1173) | Low | Only the back button was left. Stop and mute in the same bar have their own row |
| Settings rail (`config_page/sidebar_section/SidebarSection.tsx`) | The page-switching `<button>` elements (`aria-current="page"`). The native `title` shown with short names | The buttons stay as they are (they are navigation, so not Tabs, D-35). The descriptions of short names: `Tooltip` (replaced, #1132) | Low | The rail widens on hover and focus, and the short names appear only when it is narrow |
| Usage presets (`sidebar_section/usage_presets/UsagePresetSelector.tsx`) | An open and close button with `aria-expanded`, the native `title` in the compact rail, native checkboxes | Open and close: `Fold` or Collapsible (D-26); descriptions: `Tooltip`; checkboxes: `Checkbox` | Medium | Keep the rule that the last one cannot be cleared (`last`) and the way waiting is shown |
| Settings search (`config_page/search_bar/SearchBar.tsx`) | A custom `role="combobox"` and its result list (`role="option"`), a clear button | U-02 | High | D-36, D-40 |

### Settings pages

Page names are the names the app shows (here in English).

| Page | Location | Hand-built elements | Replacement | Difficulty | Complications |
|---|---|---|---|---|---|
| Text to speech (TTS) | `advanced_settings/VoiceSettings.tsx` | 10 `<select>` elements, a text field (`<input>`), the monitor volume `<input type="range">`, the reload button | The kit's `Select`, the kit's `TextField`, the settings `Slider`, the kit's `Button` (the text fields and the reload and refresh buttons replaced, #1142; the selects wait for D-14) | Medium | The form saves by itself (#1111): a choice at once, typed text when focus leaves the form. Select fields wrapped in a `<label>` also carry an `aria-label`, so make the naming consistent when moving to the kit's `Select` |
|  | `tts/TtsEngine.tsx` | A number `<input type="number">`, 3 `<select>` elements, a URL field, the reset-to-default and check-again buttons | The kit's `TextField`, the kit's `Select`, the kit's `Button` (the number and URL fields and the buttons replaced, #1142; the selects wait for D-14) | Medium | Check that the number field's `min`, `max` and `step` can be passed through as they are |
|  | `tts/GenerationOptions.tsx` | `<select>`, the seed `<input>`, `<textarea>`, the button that checks the values that can be chosen | The kit's `Select`, the kit's `TextField`, U-06, the kit's `Button` (the seed field and the check button replaced, #1142; the select waits for D-14 and the textarea for U-06) | Medium | — |
|  | `tts/VirtualMicEntry.tsx`, `advanced_settings/StopVoiceButton.tsx` | The button that opens the guide, the stop button | The kit's `Button` (the guide's button replaced, #1142; the stop button waits for D-10, whether stop is danger) | Medium | The stop button has its own look while stopping and after stopping |
|  | `advanced_settings/SpeechServers.tsx` | The path `<input>`, `<select>`, the start, stop and reload buttons | The kit's `TextField`, the kit's `Select`, the kit's `Button` (the path fields and the buttons replaced, #1142; the select waits for D-14) | Medium | The "Speech recognition (ASR)" page uses the same component |
|  | `advanced_settings/ModelDownloads.tsx`, `EngineCatalog.tsx`, `UserModels.tsx`, `VoiceAudition.tsx`, `catalogLayout.tsx` | The memory headroom `<select>`, the version `<select>`, `<progress>`, the consent `<dialog>` and its checkbox, the name and path `<input>` elements, the delete confirmation inside a row, the native `title` of the sample buttons, the grid and list switch (`aria-pressed`) | The kit's `Select`, the kit's `TextField`, the kit's `Dialog`, the kit's `Button`, `Tooltip`. Progress: U-05; the switch: U-03; cards: U-09; the confirmation inside a row: U-10 | High | The cards have the same shape as those of the "Voice changer (RVC)" and OCR models and of the translation catalog. Cards and badges (Badge) are drawn with the form classes |
| Voice changer (RVC) | `advanced_settings/DirectVoiceSettings.tsx` | 3 `<select>` elements, number and text `<input>` elements, the high-pass filter checkbox, the choose, start, stop and save buttons | The kit's `Select`, the kit's `TextField`, a switch (K-02), the kit's `Button` (the number and path fields and the buttons replaced, #1143; the selects wait for D-14 and the checkbox for K-02) | Medium | The start button gives the reason it cannot be used through `aria-describedby` |
|  | `advanced_settings/VcRuntimeSetup.tsx` | `<progress>`, the consent `<dialog>` and its checkbox, the download and use buttons | The kit's `Dialog`, the kit's `Button`, U-05 (the download, use and cancel buttons replaced, #1143; the progress bar waits for U-05 and the dialog for D-23, D-24 and D-43) | Medium | The GPU runtime in "Translation" uses the same component |
| Device | `device/VoiceRouteSettings.tsx` | The audio route `<select>`, the mute and resume `<button>` elements | The kit's `Select`, the kit's `Button` (the buttons replaced, #1135; the select waits for D-14) | Medium | The other rows use the row family and `Checkbox` |
| Appearance | `appearance/ThemePicker.tsx` | Theme tiles (native `<input type="radio">` elements drawn as cards) | U-07 | High | The color fields use `ColorEntryWithSaveButton` |
| Translation | `translation/Translation.tsx` | The license confirmation `<dialog>` (with its own classes) and its checkbox, the button that opens the fields for adding an entry | The kit's `Dialog`, the kit's `Button` (the button that opens the fields replaced, #1169; the license dialog waits for D-23, D-24 and D-43, and its checkbox for D-16) | Medium | — |
|  | `translation/TranslationCatalog.tsx` | `<input>` elements for the name, folder, languages, URL, model and key, 3 `<select>` elements, the delete confirmation inside a row, the add and use buttons | The kit's `TextField`, the kit's `Select`, the kit's `Button`. Cards: U-09; the confirmation inside a row: U-10 (the fields and the buttons replaced, #1169; the selects wait for D-14, the cards for U-09 and the confirmation inside a row for U-10) | Medium | The key field keeps `type="password"` and `autoComplete="off"` |
| Speech recognition (ASR) | `transcription/RealtimeASRSettings.tsx` | 6 `<select>` elements, a URL field, the built-in vocabulary checkbox, the refresh, start and stop buttons | The kit's `Select`, the kit's `TextField`, a switch (K-02), the kit's `Button` | Medium | The form saves by itself, as the other pages' forms do (#1111): a choice at once, the address on Enter or when focus leaves the form |
|  | `transcription/VocabularyList.tsx`, `VocabularyFiles.tsx` | A list of rows with `<input>` fields for the spelling and the reading, a quiet button on each row, a hidden file `<input>` with import and export buttons | The kit's `TextField`, the kit's `Button`. The row list: U-11 (the fields and the buttons replaced, #1170; the row list waits for U-11) | Medium | Choosing a file this way differs from the shared `FileDropZone` (where you drop the file) |
|  | `transcription/AsrApiEntries.tsx` | The name, URL, model and key `<input>` elements of the form that adds an API, its protocol `<select>`, the cards' use and remove buttons, the delete confirmation inside a card | The kit's `TextField`, the kit's `Select`, the kit's `Button`. Cards: U-09; the confirmation inside a card: U-10 (the fields and the buttons replaced, #1170; the select waits for D-14, the cards for U-09 and the confirmation inside a card for U-10) | Medium | The same shape as the translation catalog's API form and cards (#414) |
| Captions and VR | `vr/Vr.tsx` | Switches for which settings are shown ("Single line" and "Multiple lines", "Position" and "Rotation"; each is 2 `div role="button"` elements with `aria-pressed`), the reset-to-default button, the test send button | The switches: U-03; the buttons: the kit's `Button` (the buttons replaced, #1172; the switches wait for U-03 and D-27) | High | The test send button keeps the width of its longer label, so that its width does not change when it is pressed (#912) |
| Hotkeys | `hotkeys/Hotkeys.tsx`, `_components/hotkeys_entry/HotkeysEntry.tsx` | The button that opens Quick Chat, the button that clears a hotkey | The kit's `Button` (replaced, #1131) | Low | The rest uses the row family |
| Advanced | `advanced_settings/AdvancedSettings.tsx`, `GpuCheck.tsx` | The `<dialog>` that confirms re-creating the connection key, the GPU check's start, stop, copy and report buttons, the log folder's choose and reset buttons | The kit's `Dialog`, the kit's `Button` (the GPU check's and the log folder's buttons replaced, #1170; the dialog waits for D-23, D-24 and D-43) | Medium | The GPU check's table corresponds to Table ("Other components" in the comparison document) |
| Experimental | `experimental_features/ExperimentalFeatures.tsx` | None (only the row family) | — | — | — |
| Updater | `updater/Updater.tsx` | The install and check `<button>` elements (with their own classes) | The kit's `Button` (replaced, #1129) | Low | — |
| Chat reading (OCR) | `ocr/OcrModels.tsx` | `<progress>`, the consent `<dialog>` and its checkbox, the download and cancel buttons | The kit's `Dialog`, the kit's `Button`, U-05 (the download and cancel buttons replaced, #1170; the dialog waits for D-23, D-24 and D-43, its checkbox for D-16 and the progress for U-05) | Medium | — |
|  | `ocr/OcrSharedWindow.tsx`, `OcrRegions.tsx`, `OcrStatus.tsx` | The share, stop sharing and reset `<button>` elements (the `resetButton` class, `aria-disabled`) | The kit's `Button` (replaced, #1133) | Medium | The share button uses `aria-disabled`, not `disabled`, so that focus stays on the button while the desktop's share confirmation is open (related to D-07) |
| Other (VRChat) | `vrchat/Vrchat.tsx`, `_components/word_filter/WordFilter.tsx`, `_components/message_format/MessageFormat.tsx` | The add and delete `<button>` elements of the word filter, the `div role="button"` that swaps parts of the message format | The kit's `Button` (replaced, #1127) | Low | Both are inside shared components. The word filter is on the "Speech recognition (ASR)" page, and the message format on this page |
| About ASTAROT | `about_vrct/AboutVrct.tsx` | Only images and links | — | — | Outside the comparison |

### Dialogs

Dialogs that open over a screen. Each one is a native `<dialog>` written on its own screen. The replacement is the kit's `Dialog` and its parts; as decision 3 of #764 says, they are replaced together the next time they are rebuilt. The difficulty of every one is "Medium", the same as the dialog row in "Points that affect every screen". The startup failure dialog is not replaced (H-03).

| Dialog | Location | Hand-built elements in the dialog | Complications |
|---|---|---|---|
| Setup | `_app_controllers/FirstRunSetupController.tsx` | `<select>`, 3 checkboxes, 2 `<progress>` elements, 12 `<button>` elements. The rows of "What was found" (in Item's shape, `data-slot` only) | The row shape is U-08. Its own `FirstRunSetupController.css.ts` is added to the shared dialog classes. Keep the rule that sets apart the rows that need action by placement and shape (DESIGN.md, "Components", #759) |
| Chat reading setup | `_app_controllers/OcrSetupController.tsx` | 2 `<button>` elements | The shared dialog classes |
| Usage data notice | `_app_controllers/TelemetryNoticeController.tsx` | 3 `<button>` elements | Its own SCSS is added to the shared dialog classes |
| Speech recognition consent | `_app_controllers/TranscriptionConsentController.tsx` | 3 `<button>` elements | The shared dialog classes |
| Virtual microphone guide | `_app_controllers/VirtualMicGuideController.tsx` | `<select>`, 5 `<button>` elements | The shared dialog classes |
| Legacy model download | `_components/download_models/LegacyModelDownloadDialog.tsx` | A checkbox, the native `title` of the model version | This file's SCSS gives 6 other dialogs their look (`dialogStyles`) |
| Model download confirmation | `advanced_settings/ModelDownloads.tsx` | Checkboxes to confirm consent and restrictions | The `dialog` rule of the form SCSS. A restricted license is confirmed for each kind separately |
| Runtime download confirmation | `advanced_settings/VcRuntimeSetup.tsx` | The consent checkbox | The `dialog` rule of the form SCSS |
| OCR model download confirmation | `ocr/OcrModels.tsx` | The consent checkbox | The `dialog` rule of the form SCSS |
| Translation license confirmation | `translation/Translation.tsx` | The consent checkbox | Its own class (`license_dialog`) |
| Confirmation of re-creating the connection key | `advanced_settings/AdvancedSettings.tsx` | 2 `<button>` elements | The shared dialog classes |
| Confirmation on leaving the settings | `config_page/topbar/Topbar.tsx` | 2 `<button>` elements | Its own class (`leave_dialog`). It went with the save bar in #1111 |
| Update modal | `others/modal_controller/ModalController.tsx` | The close button, the area outside that closes it when pressed | It opens from the update button in the top bar and shows the "Updater" page inside. It is the exception that does not darken the background to 50% black (decision 2 of #764) |
| Startup failure | `others/startup/StartupFailedDialog.tsx` | `<dialog open>` (not modal) with `role="alertdialog"`, the retry and quit buttons | Not replaced (H-03). It also appears when the other parts cannot render, so it is safer not to add dependencies. The kit has no AlertDialog either (U-12) |

### Other windows

| Window | Location | Hand-built elements | Replacement | Difficulty | Complications |
|---|---|---|---|---|---|
| Quick Chat | `quick_chat/QuickChat.tsx` (`quick-chat.html`) | `<textarea>`, the send `<button>` | The input field: U-06; send: the kit's `Button` | Medium | It waits for the same shared component (U-06) as the main input field |
| Tray companion | `companion_panel/CompanionPanel.tsx` | The feature `<button role="switch">` elements, the buttons that open and hide the main window | The kit's `Switch`, the kit's `Button` (replaced, #1171; each row is the switch's label) | Medium | Keep the way waiting (`aria-busy`) is shown |
| Companion handle | `companion_handle/CompanionHandle.tsx` | The feature buttons (`aria-pressed`), the choice of the edge to place it on (`aria-pressed`), the menu items, the hexagonal `polygon role="button"` | Not replaced (H-03) | — | It stays outside the comparison. It is not replaced even after U-03 and U-04 are added to the kit |
| Error screen | `others/error_boundary/AppErrorBoundary.tsx` | The button that copies the error and the update button (the close button is `CloseButton`) | Not replaced (H-03) | — | This screen appears when rendering breaks, so it is safer not to add dependencies |
| Subtitle overlay | `caption_overlay/` | No controls | — | — | Outside the comparison |

### VR UI

The VR UI is outside the comparison and is not replaced with shared components (the kit) either. These are the places in the VR UI that are written without the VR UI's own components. Under decision H-03, the filter and the collapsible section of the language window among them are brought in line with the VR UI's components.

| Location | Hand-built elements | Matching VR UI component | Handling (H-03) | Complications |
|---|---|---|---|---|
| Language window (`vr/VrLanguageWindow.tsx`) | The filter `<input type="search">`, the `<details>` that collapses the translation engines that cannot be used, the preset buttons with `aria-pressed`, the language buttons | The list uses `VrPickerList`. The collapsible section corresponds to `Disclosure` (`VrSettingsRows.tsx`). No component corresponds to the filter field yet | Bring the filter and the collapsible section in line with the VR UI's components | `Disclosure` keeps its open state only inside itself and has no disabled state. The language window's collapsible section keeps its open state outside, does not open or close while waiting or while controls are locked out, and shows a count, so that form is added to `Disclosure`. The filter field is built as a VR UI component, together with the behavior of Enter selecting the first match. The window still builds the same pattern as the main language selection (U-01) separately |
| Settings window (`vr/VrSettingsWindow.tsx`, `VrSettingsRows.tsx`) | The category buttons with `aria-pressed`, the `role="switch"` rows, `aria-pressed` in the rows of choices | The `VrSettingsRows` components themselves | As it is | — |
| Launcher buttons and toolbar (`vr/VrLauncher.tsx`, `VrToolbar.tsx`) | Buttons with `aria-pressed` | — | As it is | They are pressed with the VR pointer, so the VR rules decide their pressable area and their look |

## Elements with no shared component

These are elements that no component among the shared components can replace. Where shadcn/ui has a matching component, its name and the comparison document's decision item are given.

Under decision H-02, a shared component is made for every one of U-01 to U-12 and added to the kit. One with a related decision item is made after that item is decided. U-08 has no related decision item; U-10 and U-11 are decided by H-07 and H-08. The screens that are not replaced (H-03) do not use the added components. The "Add to the kit" column of the table shows where that line falls.

| ID | Element | Where it is used | shadcn/ui counterpart | Related decision | Add to the kit |
|---|---|---|---|---|---|
| U-01 | Language selection (a filter field paired with a grid of language buttons) | The main language selection, the VR UI's language window | Command (cmdk). There is none written with Radix | D-36 | Add (H-02). The VR UI's language window does not use it and is brought in line with the VR UI's components instead (H-03) (D-36 decided on 2026-11-25 that it stays hand-built and only its look follows the kit, #1178) |
| U-02 | A search that shows a result list (combobox) | Settings search | Combobox (Base UI), Command (cmdk), InputGroup | D-36, D-40 | Add (H-02) |
| U-03 | Buttons that stay pressed, and groups of buttons where only one can be chosen | Preset switching, translation engine selection, mute, the quick settings items, the catalog's grid and list, the "Captions and VR" switches for which settings are shown, the volume check (`VolumeCheckButton`), the companion handle's edges (not replaced, H-03) | Toggle, ToggleGroup (Radix). The "Captions and VR" switches change panels within the same page, so they also correspond to Tabs (Radix) | D-27 | Added as the kit's `Toggle`, `ToggleGroup` (#1175, H-02). The companion handle does not use it (H-03) |
| U-04 | A small panel that opens from a button | Quick settings, log display settings, the translation engine list, the color popover, the companion handle's menu (not replaced, H-03) | Popover, DropdownMenu (Radix) | D-25 | Added as the kit's `Popover` (#1175, H-02). The companion handle does not use it (H-03) |
| U-05 | A horizontal progress bar | Setup, model downloads, the runtime download, the OCR model download | Progress (Radix) | D-32. For circular progress there is `CircularProgress` | Add (H-02) |
| U-06 | A multi-line input field | The main input field, Quick Chat, the TTS generation options | Textarea | D-13 | Add (H-02) |
| U-07 | Choices shaped as cards (radio) | Theme selection | No component. One of the Field examples has choice cards that wrap a RadioGroupItem in a FieldLabel | D-16 | Add (H-02) |
| U-08 | A status row (badge, name, description, control) | "What was found" in setup | Item | "Other components" in the comparison document. Not split out as a component yet | Add (H-02) |
| U-09 | Cards and badges | Model downloads, the translation catalog, the OCR models, the engine catalog | Card, Badge | D-28, D-29 | Add (H-02) |
| U-10 | A delete confirmation shown inside a row | Models you added yourself, the translation catalog | AlertDialog or Popover come close | No established pattern | Add (H-02) |
| U-11 | A list of rows with fields and controls that can be edited in place (`<ul>`) | The term dictionary list | Table (without Radix) or Item | "Other components" in the comparison document | Add (H-02) |
| U-12 | A non-modal alert dialog | Startup failure | AlertDialog (Radix) | D-23 | Add (H-02). The place that would use it now, the startup failure dialog, is not replaced (H-03), so no screen uses it |

## Decisions made

These are the decisions on how to carry out the replacement that came out of this inventory. H-01 to H-03 were decided as below on 2026-11-23, H-04 on 2026-11-24, and H-05 to H-09 on 2026-11-25. The comparison document's decision items (D-xx) and the open questions of the settings screen component experiment (K-xx) are decided in their own documents. The decision items the rows of this inventory waited for (D-03, D-10, D-13, D-14, D-16, D-17, D-19, D-21, D-23 to D-29, D-32, D-36, D-37, D-40, D-43) and K-02 were all decided on 2026-11-25 ([Decisions made](shadcn-alignment.md#decisions-made) of the comparison document). Where a row still says that a part waits for one of them, the replacement that follows the decision is not done yet.

| ID | Question | Decision | Date decided | Reason |
|---|---|---|---|---|
| H-01 | In which order to replace hand-built elements with shared components and to move the styles to vanilla-extract (#957) | #957 moves the styles without changing the look, and the replacement follows, one component at a time | 2026-11-23 | #957 compares the screens before and after the move pixel by pixel to confirm that the look does not change. Mixing in the replacement would make this check unusable. Much of the replacement is waiting for decision items (D-03, D-10, D-14, D-23 and others), so mixing the two would stall #957 as well. The styles of the elements to be replaced also have to be moved once, which is extra work |
| H-02 | Which of the elements with no shared component get a shared component | Make a shared component for every one of U-01 to U-12 and add it to the kit. Make one with a related decision item after that item is decided | 2026-11-23 | The hand-built elements of the screens, including those with no shared component, are brought in line with shared components. Components used in only 1 or 2 places (language selection, settings search, the theme tiles and so on) are also built to the same rules as the shared components (`data-slot`, color tokens, tests) |
| H-03 | Whether to include the VR UI, the companion handle, the error screen and the startup failure dialog in the replacement | Keep them outside the comparison and do not replace them with shared components. Within the VR UI only, bring things in line with the VR UI's components (the filter and the collapsible section of the language window) | 2026-11-23 | The VR UI is a separate screen shaped by px steps and the VR pointer, so it is not aligned with the shared components. In the VR UI, only the language window writes its own filter and collapsible section; the other windows use the VR UI's components. The error screen and the startup failure dialog appear when other parts have broken, so it is safer not to add dependencies |
| H-04 | Whether a replaced element keeps the screen's current look or takes the kit's | It takes the kit's look (size, border, fill) as it is: the screens are aligned with the kit, which is aligned with shadcn/ui. The behavior (what a press does, what opens and closes, keyboard operation) does not change; a row whose behavior would change is stopped and listed as a question in its pull request. Each pull request records what looks different | 2026-11-24 | The replacement exists to bring the screens to the kit's look, so a changed look is its aim, not a side effect. A screen's look fixed before its replacement would have to be redone at the replacement |
| H-05 | How the button that opens the language window takes the kit's look, given that DESIGN.md described it as a field-like button | The kit's `Button` as it is: the language and its arrow are centered, and DESIGN.md no longer calls it field-like | 2026-11-25 | The kit's `Button` centers what it holds, and a screen cannot reliably change the kit's own alignment; a list-opening form added to the kit was not taken |
| H-06 | Whether the conversation's resend button, speaker name field, send button and the knob that opens the log's display settings take the kit's parts | They stay hand-built | 2026-11-25 | The resend button and the speaker name field scale with the log's own font size (em), the send button is a square as tall as the composer (at most 10rem, DESIGN.md), and the knob is part of the log settings' drawer (D-25); the kit's fixed sizes would change how they work |
| H-07 | How the delete confirmation shown inside a row (U-10) becomes a shared component | It stays inside the row, as now, and becomes a kit part | 2026-11-25 | The confirmation belongs to the row it removes; a dialog or a popover would take it away from the row |
| H-08 | What the term dictionary's list of rows (U-11) is built from | The same shape of component as the status rows (U-08) | 2026-11-25 | Both are a list of rows with a name, a state and controls; one component keeps them alike |
| H-09 | Whether the term dictionary rows' buttons keep the quiet look | They become plain, as DESIGN.md says: quiet is the secondary action paired with a filled one and is never used alone | 2026-11-25 | The rows' buttons stood alone in the quiet look, against DESIGN.md (found in #1170) |

---

# 手作りの部品の棚卸し: 画面ごとの一覧（日本語版）

共通の部品があるのに、画面ごとにネイティブの要素や `div` で手作りしている箇所を、画面ごとに一覧にした文書です。shadcn/ui（new-york-v4）に寄せた部品へ置き換える作業と、スタイルの vanilla-extract への移行（#957）の順序を決めるための下調べです。棚卸しの時点では、コードを変えていません。

- 状態: 棚卸し（2026-11-23）。置き換えの進め方（H-01〜H-03）は同じ日に、置き換えた要素の見た目（H-04）は 2026-11-24 に決まりました。置き換えは 2026-11-24 に始めました。置き換えたら、その行に PR の番号を添えて「置き換えた」と書きます。
- 照合したアプリ: develop（#983 のマージ後、`7a4b684`）
- 関係する文書: [部品の棚卸し: shadcn/ui との照合](shadcn-alignment.md)（判断項目 D-xx）、[設定画面の部品の実験](README.md)（kit と残課題 K-xx）、[ADR-010](../../adr/adr-010-frontend-stack.md)

## 読み方

- **共通の部品**は、下の「共通の部品の一覧」にあるものです。shadcn/ui に寄せた kit（`src-ui/views/kit/`）、全体の `common_components`、設定の `_components` と `_templates` の 3 つの層があります。
- **手作り**は、共通の部品を使わずに、ネイティブの要素（`<button>`、`<select>`、`<input>`、`<dialog>` など）や `div role="button"` をその画面に直接書き、その画面か近くのモジュールの SCSS で描いているものです。
- **置き換え先**は、いま共通の部品にあるものを書きます。共通の部品に当たるものがない要素は「受け皿がない」とし、置き換え先を下の「受け皿がない要素」の番号（U-xx）で書きます。
- **難しさ**は 3 段階です。
  - 低: 共通の部品がそのまま入ります。見た目の差は、判断の要らない範囲です。
  - 中: 共通の部品はありますが、props の形、試験、ほかの画面と共有しているスタイルも直す必要があります。見た目が変わるので、画面の確認が要ります。
  - 高: 判断項目（D-xx、K-xx）が決まるまで、置き換え先が定まりません。または、キーボード操作、待ちの表し方、フォーカスの振る舞いが変わります。
- VR パネル、字幕のオーバーレイ、コンパニオンの取っ手は、shadcn/ui との照合の外にしています（[照合の文書](shadcn-alignment.md)の「そのほか」）。この文書では、手作りの要素の場所だけを挙げます。VR パネル、コンパニオンの取っ手、エラーの画面、起動の失敗は、共通の部品への置き換えの対象にもしません。VR パネルの中だけは、言語の窓の絞り込みと畳みを VR パネルの部品にそろえます（H-03）。
- 置き換えは、スタイルの vanilla-extract への移行（#957）のあとに、部品ごとに進めます（H-01）。

## 共通の部品の一覧

### kit（`src-ui/views/kit/`）

shadcn/ui に寄せた部品です。見本のページ（`src-ui/kit-lab.html`）が全部を並べています。2026-11-24 からは、アプリの画面も、下の表で「置き換えた」と書いた行で使っています（残課題 K-01、H-04）。

| 部品 | 中身 | shadcn/ui で当たるもの |
|---|---|---|
| `Button` | `tone`（primary、plain、quiet、danger）と `size`（regular、compact、icon） | Button |
| `TextField` | ネイティブの `<input>`。`invalid` と `mono` | Input |
| `Select`、`SelectOption`、`SelectOptGroup` | ネイティブの `<select>` を包む | NativeSelect |
| `Switch` | Radix UI の Switch | Switch |
| `Toggle`、`ToggleGroup`、`ToggleGroupItem` | Radix UI の Toggle と ToggleGroup。`tone`（accent、warning）と `size`（regular、compact、icon）（#1175） | Toggle、ToggleGroup |
| `Popover`、`PopoverTrigger`、`PopoverAnchor`、`PopoverContent` | Radix UI の Popover。モーダルにはしない。`inset`（regular、tight）（#1175） | Popover |
| `Dialog`、`DialogHeader`、`DialogFooter`、`DialogTitle`、`DialogDescription` | ネイティブの `<dialog>`（`showModal()`）。開閉は `open` と `onOpenChange` | Dialog |
| `SettingGroup`、`SettingRow` | 見出し付きのまとまりと、名前・説明・操作の 1 行 | Field に近い（D-34） |

### `common_components`（`src-ui/views/common_components/`）

| 部品 | 中身 | 使っている画面 |
|---|---|---|
| `Checkbox` | ネイティブの input を隠して箱を描く | 設定の `CheckboxContainer` を通して多くの設定のページ、「デバイス」 |
| `Tooltip` | 吹き出し（Radix ではない、#766） | メインのレール、上のバー、タイトルバー、入力欄、停止とミュート、再送のボタン |
| `ToggleSwitch` | フォーカスを受けない `div` のスイッチ | メインの機能のスイッチだけ |
| `Empty`、`EmptyDescription` | 「結果なし」 | 設定の検索、言語の一覧 |
| `CircularProgress` | 丸い進み具合 | 取得のボタン、更新中の表示 |
| `ResetButton`、`CloseButton` | アイコンだけのボタン | `ResetButton` はメッセージの形と「字幕とVR」、`CloseButton` は通知とエラーの画面 |
| `MarqueeText` | 流れる文字 | なし（どの画面も使っていません） |

### 設定の部品（`setting_box/_components/` と `_templates/`）

設定の部品は 2 つの系統に分かれています。

- **行の部品の系統**: `_templates/Templates.tsx` の `DropdownMenuContainer`、`CheckboxContainer`、`SliderContainer`、`RadioButtonContainer`、`EntryWithSaveButtonContainer`、`ActionButtonContainer` などが、名前と説明と操作を 1 行にまとめます。中の部品は `_DropdownMenu`（自作の combobox）、`_Entry`、`Slider`、`RadioButton`、`ActionButton`、`ConnectionCheckButton`、`ColorEntryWithSaveButton`、`HotkeysEntry`、`AuthKey`、`WordFilter`、`MessageFormat` です。「デザイン」「デバイス」「字幕とVR」「ホットキー」「高度な設定」「実験的機能」「アップデート」「チャット読み取り（OCR）」「その他」と、「翻訳」「音声認識（ASR）」の一部が使います。
- **フォームの系統**: `FormRow`、`SetupSection`、`Fold`、`Lead`、`Hint` で枠と説明を組み、中の操作はネイティブの `<select>`、`<input>`、`<button>` を直接書きます。見た目は `advanced_settings/VoiceSettings.module.scss` のクラス（`primary`、`quiet`、`actions`、`card`、`badge`、`progress`、`checkLabel`、`dialog_text` など）が描きます。部品ではなく、クラスの集まりです。「テキスト読み上げ（TTS）」「ボイスチェンジャー（RVC）」「デバイス」の音声経路、「翻訳」のカタログ、「音声認識（ASR）」のリアルタイム、モデルの取得、OCR のモデルが使います。

どちらの系統も、部品の中身は kit を使わずにネイティブの要素で書いています（たとえば `ActionButton` と `ConnectionCheckButton` の中は `<button>`）。

ほかに、どちらの系統からも使う部品として、`Fold`（開閉、#820）、`FormRow`、`SetupSection`、`AdvancedSection`、`PagePointer`、`EnvReadout`、`FileDropZone`、`ThresholdComponent`（音量のメーターと一体のしきい値。D-41 で照合の外）があります。

### VR パネル（`src-ui/views/vr/`）

VR パネルだけで使う部品です。`VrWindow`（窓の枠）、`VrPickerList`（選択肢の一覧）、`VrSettingsRows`（スイッチの行、選択肢の段、開閉の `Disclosure`、選択肢の `Picker`）、`VrTooltip`（吹き出しの文字を Python 側に渡す）があります。VR パネルは px の段で描く別の画面なので、照合の外にしています。

## 全体にかかわること

画面ごとの表に入る前に、どの画面にも共通する手作りを挙げます。画面ごとの表では、これらを繰り返し書きません。

| 要素 | 現状 | 置き換え先 | 難しさ | 引っかかり |
|---|---|---|---|---|
| ボタン | kit の `Button` を使う画面はありません。kit の外の 78 個のファイルに 198 個の `<button>` があり、フォームの `primary` と `quiet` のクラスか、モジュールごとの SCSS で描いています | kit の `Button` | 高 | 2026-11-25 の決定で、高さは 4rem のまま（D-03）、variant は primary、plain、quiet、danger のままで、停止は danger です（D-10）。アイコンだけのボタン（タイトルバー、レールの開閉、`ActionButton`、`ResetButton`、`CloseButton`）は `size="icon"` に寄せますが、大きさは場所ごとに違います。押したままのボタン（`aria-pressed`）は Button ではなく Toggle（U-03） |
| ダイアログ | 14 個の `<dialog>` を画面ごとに書いています。そのうち 7 個は `LegacyModelDownloadDialog.module.scss` のクラスを共有し、取得の同意の 3 個はフォームの SCSS（`VoiceSettings.module.scss`）の `dialog` の規則で描いています | kit の `Dialog` とパーツ | 中 | #764 の決定 3 で、ダイアログは次に作り直すときにパーツの部品へ置き換えることになっています。2026-11-25 の決定で、土台はブラウザー標準の `<dialog>` のまま（D-23）、ボタンの並びは今のままで右上の閉じるボタンは付けず（D-24）、細部は kit に画面側を寄せます（D-43）。共有している SCSS は、7 個をまとめて移すまで消せません |
| フォームの選択欄 | 11 個のファイルに 33 個のネイティブの `<select>`。フォームのクラスで描いています | kit の `Select` | 中 | 行の部品の系統は自作の `_DropdownMenu` を使っていて、選択欄が 2 系統あります。どちらに寄せるかは D-14、いつ消すかは K-04。対応するエンジンで `appearance: base-select` を使う規則（`@supports` で検出）は kit の `Select` にないので、移す必要があります |
| フォームの入力欄 | 文字、数、URL、パスワードのネイティブの `<input>` | kit の `TextField` | 中 | 行の部品の系統の `_Entry` とは、左右の余白と使えない状態の見た目が違います（D-37）。`FormRow` が子を複製して `id` と `aria-describedby` を渡すので、kit の `TextField` がそれを受け取れることを確かめます |
| フォームのチェックボックス | 10 個のファイルに 13 個のネイティブのチェックボックス（`accent-color`）。フォームの系統の共通の `HintCheck` も、その 1 つです | `common_components` の `Checkbox`。設定のオンとオフはスイッチ（K-02） | 中 | K-02 は 2026-11-25 に案のとおり決まりました。オンとオフはスイッチ、チェックボックスは同意の確認だけです。土台はブラウザー標準の入力のままです（D-16） |
| ネイティブの `title` 属性 | 設定のレールの略称、使い方のプリセット、会話のログのルビと話者の名前、モデルの版、声の試聴のボタン | `common_components` の `Tooltip` | 低〜中 | ルビと版の表示はフォーカスを受けない要素です。`Tooltip` はフォーカスとホバーで開くので、フォーカスを受けない要素の扱いを決めます（D-21） |

## 画面ごとの一覧

### メインの画面

| 場所 | 手作りしている要素 | 置き換え先 | 難しさ | 引っかかり |
|---|---|---|---|---|
| 言語の選択（`main_section/language_selector/LanguageSelector.tsx`、`LanguageSelectorTopBar.tsx`） | 絞り込みの `<input type="search">`（`data-slot="input"` だけを付けた）、言語のボタンの格子、戻るボタン | 絞り込みの欄は kit の `TextField`。絞り込みと格子の組は U-01。戻るボタンは kit の `Button`（絞り込みの欄と戻るボタンは置き換えた、#1178。格子は手作りのまま、kit のトークン、フォーカスの輪、角丸にそろえた、D-36） | 高 | Enter で最初の候補を選ぶ振る舞いがあります。格子は 2 次元に並ぶので、listbox の矢印キーの規則と合いません。VR パネルの言語の窓が同じ形を別に作っています |
| 言語の窓を開くボタン（`language_selector_open_button/LanguageSelectorOpenButton.tsx`） | `aria-expanded` の `<button>` | kit の `Button`（置き換えた、#1146。kit の描き方どおり中央にそろえる、H-05） | 中 | 開くのはポップオーバーではなく、会話の場所を置き換える言語の選択です。開閉の関係は今のまま残します |
| 言語の入れ替えと、訳す言語の足し引き（`LanguageSwapButton.tsx`、`AddRemoveTargetLanguageButtons.tsx`） | `div role="button"` | kit の `Button`（`size="icon"`）（置き換えた、#1123） | 低 | `div` を `button` にするのは判断なしで寄せられます（照合の文書の「判断なしで寄せられる差」の 11 と同じ考え方） |
| 翻訳エンジンの選択（`TranslatorSelectorOpenButton.tsx`、`translator_selector/TranslatorSelector.tsx`） | 開くボタンが `div role="button"` と `aria-expanded`。開いた一覧の各エンジンが `div role="button"` と `aria-pressed` | 開くボタンは kit の `Button`。開いた一覧は U-04、エンジンの選択は U-03 | 高 | 一つだけを選ぶ選択なので、`aria-pressed` のボタンの集まりより radio の振る舞いが合います。使えないエンジンはフォーカスから外しています |
| プリセットの切り替え（`preset_tab_selector/PresetTabSelector.tsx`） | 3 つの `div role="button"` と `aria-pressed` | U-03 | 高 | 照合の文書の「判断なしで寄せられる差」の 11（`div` を `button` にする）は、まだ入っていません |
| メインの機能のスイッチ（`main_function_switch/MainFunctionSwitch.tsx`） | 行全体が `role="switch"`。中の見た目は `ToggleSwitch`。「ほかの機能」と設定のボタン | kit の `Switch`（D-19）、ボタンは kit の `Button` | 高 | 行全体を押せる形、待ちの表し方、使えない理由の吹き出し、小さいレールでの表示を保つ必要があります |
| クイック設定（`top_bar/right_side_components/RightSideComponents.tsx` の `QuickSettingsMenu`、`_buttons/OpenQuickSettingButton.tsx`） | 自作の開閉（Esc、外を押す、フォーカスが外に出ると閉じる）と `role="group"` の面。中の項目は `aria-pressed` のボタン | 面は U-04、中の項目は U-03 | 高 | 中身はトグルの集まりで、メニュー（`role="menu"`）ではありません（D-25） |
| 「入力と出力」のパネル（`RightSideComponents.tsx` の開くボタン、`io_flow_panel/IoFlowPanel.tsx`） | `aria-expanded` と `aria-controls` の開くボタン、閉じるボタン | kit の `Button`（置き換えた、#1122） | 低 | 開閉の関係は今のまま残します |
| 更新の知らせのボタン（`RightSideComponents.tsx`） | `<button>` | kit の `Button`（置き換えた、#1122） | 低 | 吹き出しは `Tooltip` を使っています |
| レールの操作（`sidebar_section/SidebarSection.tsx`、`open_settings/OpenSettings.tsx`、`sidebar_compact_mode_button/SidebarCompactModeButton.tsx`、`language_readout/LanguageReadout.tsx`、`engine_readout/EngineReadout.tsx`） | アイコンだけの `<button>` と、読み上げの欄を兼ねるボタン | kit の `Button`（`size="icon"`）（アイコンだけのボタンは置き換えた、#1141）。読み上げの欄は今のまま | 中 | 吹き出しは `Tooltip` を使っています。レールの幅（DESIGN.md「Layout」）で大きさが決まっています |
| 会話のログ（`log_box/message_container/MessageContainer.tsx`、`SpeakerNames.tsx`） | 話者の名前のボタン（`aria-expanded`）と、その場で開く名前の欄（ネイティブの `<input>`、保存と取り消しの `<button>`）。ルビと話者の名前の説明はネイティブの `title` | 欄は kit の `TextField`、ボタンは kit の `Button`、説明は `Tooltip`（話者名の欄とそのボタンは手作りのまま、H-06） | 中 | ルビは文の中の要素で、1 つの発言に何個も付きます。吹き出しを 1 つずつ付けると、ログが長いときの描画の量が増えます |
| 再送のボタン（`message_sub_menu_container/MessageSubMenuContainer.tsx`） | 長押しで再送する `<button>` | kit の `Button`（手作りのまま、H-06） | 中 | 長押しの判定（ポインタのイベント）を保ちます |
| ログの表示の設定（`message_log_settings_container/MessageLogSettingsContainer.tsx`） | 開くボタンが `div role="button"` と `aria-expanded`。Esc で閉じる面 | 開くボタンは kit の `Button`、面は U-04（開くボタンは手作りのまま、H-06） | 高 | — |
| 入力欄（`message_input_box/MessageInputBox.tsx`） | `<textarea>`、送信の `<button>` | 入力欄は U-06、送信は kit の `Button`（送信のボタンは手作りのまま、H-06） | 高 | 入力欄の角丸は 12px（DESIGN.md）。高さの伸び方を `field-sizing` で書くかは D-13 |
| 空の画面（`log_box/EmptyState.tsx`） | 「初期設定を開く」と機能を始める `<button>` | kit の `Button`（置き換えた、#1121） | 低 | 画面の置き方は照合の文書で「残す」にしています |
| リアルタイムの操作（`realtime_controls/RealtimeControls.tsx`） | 止める `<button>` | kit の `Button`（置き換えた、#1121） | 低 | — |
| 停止とミュート（`others/stop_actions/StopActions.tsx`） | 停止の `<button>`、ミュートの `aria-pressed` の `<button>`（押したときは琥珀色） | 停止は kit の `Button`（danger かは D-10）、ミュートは U-03 | 高 | 停止とミュートは独立した操作として保ちます（PRODUCT.md、DESIGN.md） |
| タイトルバー（`others/window_title_bar/WindowTitleBar.tsx`） | 最小化、最大化、閉じるの `<button>` | kit の `Button`（`size="icon"`） | 中 | ウィンドウを動かす領域と重なります。OS のタイトルバーに合わせた大きさです |

### 設定の画面（どのページにもある部分）

| 場所 | 手作りしている要素 | 置き換え先 | 難しさ | 引っかかり |
|---|---|---|---|---|
| 上のバー（`config_page/topbar/Topbar.tsx`） | 戻るの `<button>`。保存バーとそのボタン、離れるときの `<dialog>` は #1111 でなくなりました | kit の `Button`（置き換えた、#1173） | 低 | 残っていたのは戻るのボタンだけです。同じバーの停止とミュートは別の行にあります |
| 設定のレール（`config_page/sidebar_section/SidebarSection.tsx`） | ページを切り替える `<button>`（`aria-current="page"`）。略称のときのネイティブの `title` | ボタンは今のまま（ナビゲーションなので Tabs にしない、D-35）。略称の説明は `Tooltip`（置き換えた、#1132） | 低 | レールはホバーとフォーカスで広がり、略称は狭いときだけ出ます |
| 使い方のプリセット（`sidebar_section/usage_presets/UsagePresetSelector.tsx`） | `aria-expanded` の開閉のボタン、小さいレールでのネイティブの `title`、ネイティブのチェックボックス | 開閉は `Fold` か Collapsible（D-26）、説明は `Tooltip`、チェックボックスは `Checkbox` | 中 | 最後の 1 つは外せない規則（`last`）と待ちの表し方を保ちます |
| 設定の検索（`config_page/search_bar/SearchBar.tsx`） | 自作の `role="combobox"` と結果の一覧（`role="option"`）、消すボタン | U-02 | 高 | D-36、D-40 |

### 設定のページ

ページの名前は、アプリに出る名前（日本語）です。

| ページ | 場所 | 手作りしている要素 | 置き換え先 | 難しさ | 引っかかり |
|---|---|---|---|---|---|
| テキスト読み上げ（TTS） | `advanced_settings/VoiceSettings.tsx` | 10 個の `<select>`、文字の欄（`<input>`）、モニターの音量の `<input type="range">`、再読み込みのボタン | kit の `Select`、kit の `TextField`、設定の `Slider`、kit の `Button`（文字の欄と再読み込みのボタンは置き換えた、#1142。選択欄は D-14 を待つ） | 中 | フォームは自分で保存します（#1111）。選択はすぐに、打った文字はフォームを離れたときに保存します。`<label>` で包んだ選択欄にも `aria-label` を付けているので、kit の `Select` に移すときに名前の付け方をそろえます |
|  | `tts/TtsEngine.tsx` | 数の `<input type="number">`、3 個の `<select>`、URL の欄、既定に戻すボタンと確かめ直すボタン | kit の `TextField`、kit の `Select`、kit の `Button`（数と URL の欄とボタンは置き換えた、#1142。選択欄は D-14 を待つ） | 中 | 数の欄の `min`、`max`、`step` をそのまま渡せることを確かめます |
|  | `tts/GenerationOptions.tsx` | `<select>`、シードの `<input>`、`<textarea>`、選べる値を確かめるボタン | kit の `Select`、kit の `TextField`、U-06、kit の `Button`（シードの欄と確認のボタンは置き換えた、#1142。選択欄は D-14 を、複数行の欄は U-06 を待つ） | 中 | — |
|  | `tts/VirtualMicEntry.tsx`、`advanced_settings/StopVoiceButton.tsx` | 案内を開くボタン、止めるボタン | kit の `Button`（案内を開くボタンは置き換えた、#1142。停止のボタンは、停止を danger にするかの D-10 を待つ） | 中 | 止めるボタンは、止めている途中と止めた後の見た目を持ちます |
|  | `advanced_settings/SpeechServers.tsx` | パスの `<input>`、`<select>`、起動と停止と再読み込みのボタン | kit の `TextField`、kit の `Select`、kit の `Button`（パスの欄とボタンは置き換えた、#1142。選択欄は D-14 を待つ） | 中 | 「音声認識（ASR）」のページも同じ部品を使います |
|  | `advanced_settings/ModelDownloads.tsx`、`EngineCatalog.tsx`、`UserModels.tsx`、`VoiceAudition.tsx`、`catalogLayout.tsx` | メモリの余裕の `<select>`、版の `<select>`、`<progress>`、同意の `<dialog>` とチェックボックス、名前とパスの `<input>`、行の中の削除の確認、試聴のボタンのネイティブの `title`、グリッドとリストの切り替え（`aria-pressed`） | kit の `Select`、kit の `TextField`、kit の `Dialog`、kit の `Button`、`Tooltip`。進み具合は U-05、切り替えは U-03、カードは U-09、行の中の確認は U-10 | 高 | 「ボイスチェンジャー（RVC）」と OCR のモデル、翻訳のカタログと同じカードの形です。カードと印（Badge）はフォームのクラスで描いています |
| ボイスチェンジャー（RVC） | `advanced_settings/DirectVoiceSettings.tsx` | 3 個の `<select>`、数と文字の `<input>`、ハイパスフィルターのチェックボックス、選ぶ・始める・止める・保存のボタン | kit の `Select`、kit の `TextField`、スイッチ（K-02）、kit の `Button`（数とパスの欄とボタンは置き換えた、#1143。選択欄は D-14 を、チェックボックスは K-02 を待つ） | 中 | 始めるボタンは使えない理由を `aria-describedby` で示しています |
|  | `advanced_settings/VcRuntimeSetup.tsx` | `<progress>`、同意の `<dialog>` とチェックボックス、取得と使うボタン | kit の `Dialog`、kit の `Button`、U-05（取得、使う、取り消しのボタンは置き換えた、#1143。進み具合は U-05 を、ダイアログは D-23、D-24、D-43 を待つ） | 中 | 「翻訳」の GPU の実行環境も同じ部品を使います |
| デバイス | `device/VoiceRouteSettings.tsx` | 音声経路の `<select>`、ミュートと再開の `<button>` | kit の `Select`、kit の `Button`（ボタンは置き換えた、#1135。選択欄は D-14 を待つ） | 中 | ほかの行は行の部品の系統と `Checkbox` を使っています |
| デザイン | `appearance/ThemePicker.tsx` | テーマのタイル（ネイティブの `<input type="radio">` をカードの形に描く） | U-07 | 高 | 色の欄は `ColorEntryWithSaveButton` を使っています |
| 翻訳 | `translation/Translation.tsx` | ライセンスの確認の `<dialog>`（独自のクラス）とチェックボックス、追加の欄を開くボタン | kit の `Dialog`、kit の `Button`（入力欄を開くボタンは置き換えた、#1169。ライセンスのダイアログは D-23、D-24、D-43 を、そのチェックボックスは D-16 を待つ） | 中 | — |
|  | `translation/TranslationCatalog.tsx` | 名前、フォルダー、言語、URL、モデル、鍵の `<input>`、3 個の `<select>`、行の中の削除の確認、追加と使うボタン | kit の `TextField`、kit の `Select`、kit の `Button`。カードは U-09、行の中の確認は U-10（欄とボタンは置き換えた、#1169。選択欄は D-14 を、カードは U-09 を、行の中の確認は U-10 を待つ） | 中 | 鍵の欄は `type="password"` と `autoComplete="off"` を保ちます |
| 音声認識（ASR） | `transcription/RealtimeASRSettings.tsx` | 6 個の `<select>`、URL の欄、組み込みの語彙のチェックボックス、更新・始める・止めるのボタン | kit の `Select`、kit の `TextField`、スイッチ（K-02）、kit の `Button` | 中 | フォームは、ほかのページのフォームと同じく自分で保存します（#1111）。選択はすぐに、アドレスはEnterかフォームを離れたときに保存します |
|  | `transcription/VocabularyList.tsx`、`VocabularyFiles.tsx` | 書き方と読みの `<input>` が並ぶ行の一覧、行ごとの quiet のボタン、隠したファイルの `<input>` と読み込み・書き出しのボタン | kit の `TextField`、kit の `Button`。行の一覧は U-11（欄とボタンは置き換えた、#1170。行の一覧は U-11 を待つ） | 中 | ファイルを選ぶ形は、共通の `FileDropZone`（落とす形）とは違います |
|  | `transcription/AsrApiEntries.tsx` | API を足すフォームの名前、URL、モデル、鍵の `<input>` とプロトコルの `<select>`、カードの使うと削除のボタン、カードの中の削除の確認 | kit の `TextField`、kit の `Select`、kit の `Button`。カードは U-09、カードの中の確認は U-10（欄とボタンは置き換えた、#1170。選択欄は D-14 を、カードは U-09 を、カードの中の確認は U-10 を待つ） | 中 | 翻訳のカタログの API のフォームとカードと同じ形です（#414） |
| 字幕とVR | `vr/Vr.tsx` | 表示する設定の切り替え（「1 行」と「複数行」、「位置」と「回転」。それぞれ 2 つの `div role="button"` と `aria-pressed`）、既定に戻すボタン、試しに送るボタン | 切り替えは U-03、ボタンは kit の `Button`（ボタンは置き換えた、#1172。切り替えは U-03 と D-27 を待つ） | 高 | 試しに送るボタンは、押しても幅が変わらないように長い方の文言の幅を保っています（#912） |
| ホットキー | `hotkeys/Hotkeys.tsx`、`_components/hotkeys_entry/HotkeysEntry.tsx` | Quick Chat を開くボタン、ショートカットを消すボタン | kit の `Button`（置き換えた、#1131） | 低 | ほかは行の部品の系統です |
| 高度な設定 | `advanced_settings/AdvancedSettings.tsx`、`GpuCheck.tsx` | 接続用のキーを作り直すかを確かめる `<dialog>`、GPU の確認の始める・止める・写す・報告するボタン、ログの保存先のフォルダーを選ぶ・戻すボタン | kit の `Dialog`、kit の `Button`（GPU の確認とログの保存先のボタンは置き換えた、#1170。ダイアログは D-23、D-24、D-43 を待つ） | 中 | GPU の確認の表は Table に当たります（照合の文書の「そのほか」） |
| 実験的機能 | `experimental_features/ExperimentalFeatures.tsx` | なし（行の部品の系統だけ） | — | — | — |
| アップデート | `updater/Updater.tsx` | インストールと確認の `<button>`（独自のクラス） | kit の `Button`（置き換えた、#1129） | 低 | — |
| チャット読み取り（OCR） | `ocr/OcrModels.tsx` | `<progress>`、同意の `<dialog>` とチェックボックス、取得と取り消しのボタン | kit の `Dialog`、kit の `Button`、U-05（取得と取り消しのボタンは置き換えた、#1170。ダイアログは D-23、D-24、D-43 を、そのチェックボックスは D-16 を、進み具合は U-05 を待つ） | 中 | — |
|  | `ocr/OcrSharedWindow.tsx`、`OcrRegions.tsx`、`OcrStatus.tsx` | 共有と解除と戻すの `<button>`（`resetButton` のクラス、`aria-disabled`） | kit の `Button`（置き換えた、#1133） | 中 | 共有のボタンは `disabled` ではなく `aria-disabled` です。デスクトップの共有の確認が開いている間も、フォーカスをボタンに残すためです（D-07 と関係します） |
| その他（VRChat） | `vrchat/Vrchat.tsx`、`_components/word_filter/WordFilter.tsx`、`_components/message_format/MessageFormat.tsx` | ワードフィルターの追加と削除の `<button>`、メッセージの形の入れ替えの `div role="button"` | kit の `Button`（置き換えた、#1127） | 低 | どちらも共通の部品の中にあります。ワードフィルターは「音声認識（ASR）」のページに、メッセージの形はこのページにあります |
| ASTAROTについて | `about_vrct/AboutVrct.tsx` | 画像とリンクだけ | — | — | 照合の外 |

### ダイアログ

画面の上に開くダイアログです。どれもネイティブの `<dialog>` を画面ごとに書いています。置き換え先は kit の `Dialog` とパーツで、#764 の決定 3 のとおり、次に作り直すときにまとめて置き換えます。難しさは、どれも「全体にかかわること」のダイアログの行と同じ「中」です。起動の失敗は置き換えの対象にしません（H-03）。

| ダイアログ | 場所 | ダイアログの中の手作り | 引っかかり |
|---|---|---|---|
| 初期設定 | `_app_controllers/FirstRunSetupController.tsx` | `<select>`、3 個のチェックボックス、2 個の `<progress>`、12 個の `<button>`。「いまの状態」の行（Item の形、`data-slot` だけ） | 行の形は U-08。共有のダイアログのクラスに、独自の `FirstRunSetupController.css.ts` を足しています。対応が要る行を配置と形で分ける規則（DESIGN.md「Components」、#759）を保ちます |
| チャット読み取りの準備 | `_app_controllers/OcrSetupController.tsx` | 2 個の `<button>` | 共有のダイアログのクラス |
| 利用状況の送信の知らせ | `_app_controllers/TelemetryNoticeController.tsx` | 3 個の `<button>` | 共有のダイアログのクラスに、独自の SCSS を足しています |
| 音声認識の同意 | `_app_controllers/TranscriptionConsentController.tsx` | 3 個の `<button>` | 共有のダイアログのクラス |
| 仮想マイクの案内 | `_app_controllers/VirtualMicGuideController.tsx` | `<select>`、5 個の `<button>` | 共有のダイアログのクラス |
| 旧モデルの取得 | `_components/download_models/LegacyModelDownloadDialog.tsx` | チェックボックス、モデルの版のネイティブの `title` | このファイルの SCSS が、ほかの 6 個のダイアログの見た目（`dialogStyles`）になっています |
| モデルの取得の確認 | `advanced_settings/ModelDownloads.tsx` | 同意と制限の確認のチェックボックス | フォームの SCSS の `dialog` の規則。制限のあるライセンスは、種類ごとに確認を取ります |
| 実行環境の取得の確認 | `advanced_settings/VcRuntimeSetup.tsx` | 同意のチェックボックス | フォームの SCSS の `dialog` の規則 |
| OCR のモデルの取得の確認 | `ocr/OcrModels.tsx` | 同意のチェックボックス | フォームの SCSS の `dialog` の規則 |
| 翻訳のライセンスの確認 | `translation/Translation.tsx` | 同意のチェックボックス | 独自のクラス（`license_dialog`） |
| 接続用のキーの作り直しの確認 | `advanced_settings/AdvancedSettings.tsx` | 2 個の `<button>` | 共有のダイアログのクラス |
| 設定から離れるときの確認 | `config_page/topbar/Topbar.tsx` | 2 個の `<button>` | 独自のクラス（`leave_dialog`）。#1111 で保存バーと一緒になくなりました |
| アップデートのモーダル | `others/modal_controller/ModalController.tsx` | 閉じるボタン、外を押すと閉じる領域 | 上のバーの更新のボタンから開き、「アップデート」のページを中に出します。背景を 50% の黒にしていない例外です（#764 の判断 2） |
| 起動の失敗 | `others/startup/StartupFailedDialog.tsx` | `<dialog open>`（モーダルでない）と `role="alertdialog"`、再試行と終了のボタン | 置き換えの対象にしません（H-03）。ほかの部分が描けないときにも出すので、依存を増やさない方が安全です。kit に AlertDialog もありません（U-12） |

### ほかの窓

| 窓 | 場所 | 手作りしている要素 | 置き換え先 | 難しさ | 引っかかり |
|---|---|---|---|---|---|
| Quick Chat | `quick_chat/QuickChat.tsx`（`quick-chat.html`） | `<textarea>`、送信の `<button>` | 入力欄は U-06、送信は kit の `Button` | 中 | メインの入力欄と同じ受け皿（U-06）を待ちます |
| トレイのコンパニオン | `companion_panel/CompanionPanel.tsx` | 機能の `<button role="switch">`、メインを開くと隠すのボタン | kit の `Switch`、kit の `Button`（置き換えた、#1171。行はスイッチのラベル） | 中 | 待ち（`aria-busy`）の表し方を保ちます |
| コンパニオンの取っ手 | `companion_handle/CompanionHandle.tsx` | 機能のボタン（`aria-pressed`）、置く辺の選択（`aria-pressed`）、メニューの項目、六角形の `polygon role="button"` | 対象にしない（H-03） | — | 照合の外のまま。U-03 と U-04 を kit に足しても、置き換えません |
| エラーの画面 | `others/error_boundary/AppErrorBoundary.tsx` | エラーを写すボタンと更新のボタン（閉じるボタンは `CloseButton`） | 対象にしない（H-03） | — | 描画が壊れたときに出す画面なので、依存を増やさない方が安全です |
| 字幕のオーバーレイ | `caption_overlay/` | 操作なし | — | — | 照合の外 |

### VR パネル

VR パネルは照合の外で、共通の部品（kit）への置き換えの対象にもしません。VR パネルの中で、VR パネルの部品を使わずに書いている箇所を挙げます。H-03 の決定で、このうち言語の窓の絞り込みと畳みは、VR パネルの部品にそろえます。

| 場所 | 手作りしている要素 | VR パネルの部品で当たるもの | 扱い（H-03） | 引っかかり |
|---|---|---|---|---|
| 言語の窓（`vr/VrLanguageWindow.tsx`） | 絞り込みの `<input type="search">`、使えない翻訳エンジンを畳む `<details>`、プリセットの `aria-pressed` のボタン、言語の選択のボタン | 一覧は `VrPickerList` を使っています。畳みは `Disclosure`（`VrSettingsRows.tsx`）に当たります。絞り込みの欄に当たる部品はまだありません | 絞り込みと畳みを VR パネルの部品にそろえる | `Disclosure` は開閉を自分の中だけで持ち、使えない状態を持ちません。言語の窓の畳みは、開閉を外で持ち、待ちと操作の締め出しのときに開閉させず、件数を出しているので、`Disclosure` にその形を足します。絞り込みの欄は、Enter で最初の候補を選ぶ振る舞いごと、VR パネルの部品として作ります。メインの言語の選択（U-01）と同じ形を別に作っている点は変わりません |
| 設定の窓（`vr/VrSettingsWindow.tsx`、`VrSettingsRows.tsx`） | 分類の `aria-pressed` のボタン、`role="switch"` の行、選択肢の段の `aria-pressed` | `VrSettingsRows` の部品そのもの | 今のまま | — |
| 起動のボタンと道具のバー（`vr/VrLauncher.tsx`、`VrToolbar.tsx`） | `aria-pressed` のボタン | — | 今のまま | VR のポインタで押すので、押せる範囲と見た目は VR の規則で決めます |

## 受け皿がない要素

共通の部品の側に、置き換え先に当たる部品がない要素です。shadcn/ui に当たる部品があるものは、その名前と、照合の文書の判断項目を添えます。

H-02 の決定で、U-01〜U-12 のすべてに共通の部品を作り、kit に足します。関係する判断項目があるものは、それが決まってから作ります。U-08 には関係する判断項目がありません。U-10 と U-11 は H-07 と H-08 で決まりました。置き換えの対象にしない画面（H-03）は、足した部品を使いません。表の「kit に足すか」の列に、その分かれ目を書きました。

| ID | 要素 | 使っている場所 | shadcn/ui で当たるもの | 関係する判断 | kit に足すか |
|---|---|---|---|---|---|
| U-01 | 言語の選択（絞り込みの欄と、言語のボタンの格子の組） | メインの言語の選択、VR パネルの言語の窓 | Command（cmdk）。Radix で書いたものはありません | D-36 | 足す（H-02）。VR パネルの言語の窓は使わず、VR パネルの部品にそろえる（H-03）（2026-11-25 の D-36 の決定で手作りのまま残し、見た目だけを kit にそろえた、#1178） |
| U-02 | 結果の一覧を出す検索（combobox） | 設定の検索 | Combobox（Base UI）、Command（cmdk）、InputGroup | D-36、D-40 | 足す（H-02） |
| U-03 | 押したままのボタンと、一つだけを選ぶボタンの集まり | プリセットの切り替え、翻訳エンジンの選択、ミュート、クイック設定の項目、カタログのグリッドとリスト、「字幕とVR」の表示する設定の切り替え、音量の確認（`VolumeCheckButton`）、コンパニオンの取っ手の辺（置き換えの対象外、H-03） | Toggle、ToggleGroup（Radix）。「字幕とVR」の切り替えは、同じページの中のパネルを切り替えるので Tabs（Radix）にも当たります | D-27 | kit の `Toggle`、`ToggleGroup` として足した（#1175、H-02）。コンパニオンの取っ手は使わない（H-03） |
| U-04 | ボタンから開く小さな面 | クイック設定、ログの表示の設定、翻訳エンジンの一覧、色のポップオーバー、コンパニオンの取っ手のメニュー（置き換えの対象外、H-03） | Popover、DropdownMenu（Radix） | D-25 | kit の `Popover` として足した（#1175、H-02）。コンパニオンの取っ手は使わない（H-03） |
| U-05 | 横に伸びる進み具合 | 初期設定、モデルの取得、実行環境の取得、OCR のモデルの取得 | Progress（Radix） | D-32。丸い進み具合は `CircularProgress` があります | 足す（H-02） |
| U-06 | 複数行の入力欄 | メインの入力欄、Quick Chat、読み上げの生成の設定 | Textarea | D-13 | 足す（H-02） |
| U-07 | カードの形をした選択肢（radio） | テーマの選択 | 部品はありません。Field の例に、FieldLabel で RadioGroupItem を包む選択肢のカードがあります | D-16 | 足す（H-02） |
| U-08 | 状態の行（印、名前、説明、操作） | 初期設定の「いまの状態」 | Item | 照合の文書の「そのほか」。部品にはまだ分けていません | 足す（H-02） |
| U-09 | カードと印 | モデルの取得、翻訳のカタログ、OCR のモデル、エンジンのカタログ | Card、Badge | D-28、D-29 | 足す（H-02） |
| U-10 | 行の中で出す削除の確認 | 自分で足したモデル、翻訳のカタログ | AlertDialog か Popover が近い | 決まった形はありません | 足す（H-02） |
| U-11 | 欄と操作が並ぶ、その場で直せる行の一覧（`<ul>`） | 用語辞書の一覧 | Table（Radix を使わない）か Item | 照合の文書の「そのほか」 | 足す（H-02） |
| U-12 | モーダルでない警告のダイアログ | 起動の失敗 | AlertDialog（Radix） | D-23 | 足す（H-02）。いま使う場所の起動の失敗は置き換えの対象にしない（H-03）ので、画面で使う場所はありません |

## 決まった判断

この棚卸しから出た、置き換えの進め方の判断です。H-01〜H-03 は 2026-11-23 に、H-04 は 2026-11-24 に、H-05〜H-09 は 2026-11-25 に、下のとおり決まりました。照合の文書の判断項目（D-xx）と、設定画面の部品の実験の残課題（K-xx）は、それぞれの文書で決めます。この棚卸しの行が待っていた判断項目（D-03、D-10、D-13、D-14、D-16、D-17、D-19、D-21、D-23〜D-29、D-32、D-36、D-37、D-40、D-43）と K-02 は、2026-11-25 にすべて決まりました（照合の文書の[決まった判断](shadcn-alignment.md#決まった判断)）。行に「〜を待つ」と残っている部分は、決定に沿った置き換えがまだ済んでいないものです。

| ID | 問い | 決定 | 決めた日 | 理由 |
|---|---|---|---|---|
| H-01 | 手作りの要素を共通の部品に置き換える作業と、スタイルの vanilla-extract への移行（#957）を、どの順で進めるか | #957 は見た目を変えずに移し、置き換えはそのあとに部品ごとに進める | 2026-11-23 | #957 は、移す前と後の画面を画素で比べて見た目が変わらないことを確かめます。置き換えを混ぜると、この確かめ方が使えません。置き換えの多くは判断項目（D-03、D-10、D-14、D-23 など）を待っているので、混ぜると #957 も止まります。置き換える要素のスタイルも一度は移すことになり、その分の手間は増えます |
| H-02 | 受け皿がない要素のうち、どれに共通の部品を作るか | U-01〜U-12 のすべてに共通の部品を作り、kit に足す。関係する判断項目があるものは、それが決まってから作る | 2026-11-23 | 受け皿がない要素も含めて、画面の手作りの要素を共通の部品にそろえます。使う場所が 1〜2 か所のもの（言語の選択、設定の検索、テーマのタイルなど）も、共通の部品と同じ規則（`data-slot`、色のトークン、試験）で作ります |
| H-03 | VR パネル、コンパニオンの取っ手、エラーの画面、起動の失敗を、置き換えの対象に含めるか | 照合の外のままにし、共通の部品への置き換えの対象にしない。そのうえで、VR パネルの中だけで VR パネルの部品にそろえる（言語の窓の絞り込みと畳み） | 2026-11-23 | VR パネルは px の段と VR のポインタで決まる別の画面なので、共通の部品には寄せません。VR パネルの中では、言語の窓だけが絞り込みと畳みを自分で書いていて、ほかの窓は VR パネルの部品を使っています。エラーの画面と起動の失敗は、ほかの部分が壊れたときに出すので、依存を増やさない方が安全です |
| H-04 | 置き換えた要素は、画面の今の見た目を保つか、kit の見た目にするか | kit の見た目（寸法、枠、塗り）をそのまま使う。画面を、shadcn/ui に寄せた kit の見た目にそろえる。挙動（押したときの動き、開閉の関係、キーボードの操作）は変えない。挙動が変わる行は止めて、その PR の「判断が要ること」に挙げる。PR ごとに、見た目の変わったところを記録する | 2026-11-24 | 置き換えは、画面を kit の見た目にそろえるためのものです。見た目が変わるのは副作用ではなく、そろえる先そのものです。置き換えの前に画面の見た目を直すと、置き換えのときにやり直しになります |
| H-05 | DESIGN.md が入力欄のようなボタンとしていた、言語の窓を開くボタンに、kit の見た目をどう当てるか | kit の `Button` をそのまま使う。言語と矢印は中央にそろい、DESIGN.md の「入力欄のような」という記述は外す | 2026-11-25 | kit の `Button` は中身を中央にそろえ、kit のそろえ方は画面側から確実には変えられません。kit に一覧を開くボタンの形を足す案は採りませんでした |
| H-06 | 会話の欄の再送のボタン、話者名の欄、送信のボタン、ログの表示の設定を開くつまみを、kit の部品にするか | 手作りのまま残す | 2026-11-25 | 再送のボタンと話者名の欄はログの文字の大きさ（em）に合わせて拡大縮小し、送信のボタンは入力欄の高さの正方形（最大 10rem、DESIGN.md）で、つまみはログの設定の引き出し（D-25）と一体です。kit の固定の大きさにすると働きが変わります |
| H-07 | 行の中に出す削除の確認（U-10）を、どういう共通の部品にするか | 今と同じく行の中に出す形のまま、kit の部品にする | 2026-11-25 | 確認は、消す行のものです。ダイアログやポップオーバーにすると、行から離れます |
| H-08 | 用語辞書の行の並び（U-11）を、何で作るか | 状態の行（U-08）と同じ形の部品で作る | 2026-11-25 | どちらも、名前と状態と操作を持つ行の並びです。1 つの部品にすると、見た目がそろいます |
| H-09 | 用語辞書の行のボタンを quiet の見た目のままにするか | DESIGN.md のとおり plain にする。quiet は塗ったボタンと組になる副次の操作で、単独では使わない | 2026-11-25 | 行のボタンは quiet だけで並んでいて、DESIGN.md と食い違っていました（#1170 で見つかった） |
