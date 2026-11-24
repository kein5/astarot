# Plan for moving the UI to TypeScript

[日本語版](#画面側の-typescript-移行計画日本語版)

This document gives the order and the division of the work that moves the UI's (`src-ui`) JavaScript to TypeScript. The authoritative source for its purpose and approach is Issue #544, and the decision to adopt it is [ADR-010](adr/adr-010-frontend-stack.md). The conventions for the mixed period (imports with extensions, using only syntax that can be erased, and so on) are in "TypeScript and styles in the UI" (UIのTypeScriptとスタイル) in [development.md](development.md).

## Approach

- Keep strictly to a migration that does not change behavior. Feature changes and fixes go in separate pull requests.
- Move the parts with few dependencies first. If a file being moved imports JavaScript that has not been moved yet, the types of the values it gets from there rely on inference, and the file cannot be typed strictly.
- Give moved files their real types. Do not stop the checks with `any`, double casts through `unknown`, `@ts-ignore` or the like. `tests/devtools/test_typescript_strictness.py` counts these ("Type strictness" below).
- Keep each pull request to an amount that can be reviewed. A few hundred lines is the guide. A large file gets a pull request of its own.
- At every stage, keep the build, the type check and the tests passing.

## Current size

When stage 7 was finished, the files in `src-ui` were as follows. `.jsx` counts as JavaScript.

| Area | JavaScript | TypeScript |
|---|---|---|
| `src-ui/logics` (excluding tests) | 0 files | 155 files, 744 KB (1 of them `.css.ts`) |
| `src-ui/views` (excluding tests) | 0 files | 219 files, 1.1 MB (19 of them vanilla-extract `.css.ts`) |
| Tests (`*.test.ts` and `src-ui/logics/test/`) | 0 files | 210 files, 1.5 MB |

This command lists the JavaScript that is left.

```sh
git ls-files src-ui | grep -E '\.(js|jsx|mjs)$' | grep -v -E '\.test\.|/logics/test/'
```

## Stages

| Stage | Target | State |
|---|---|---|
| 1 | Leaf modules in `logics` that import no unmigrated JavaScript | Done |
| 2 | The roots of the data layer (the store and IPC) | Done |
| 3 | Small hooks that depend only on the store and IPC | Done. The 5 that read the settings hooks were moved in stage 4 |
| 4 | The large modules in `logics` (one at a time) | Done. Received values are not newly checked at run time; they are passed on through declarations (stage 4 below) |
| 5 | JSX in `logics` (from `.jsx` to `.tsx`) | Done |
| 6 | `views` | Done |
| 7 | Tests and the test harness | Done. No JavaScript is left in `src-ui` or `locales` |
| 8 | Finishing (remove `allowJs` and tighten the checks) | Not started |

### Stage 1: leaf modules in `logics`

These are the modules that import no unmigrated JavaScript from within the project. They use only the React, Jotai and Tauri APIs.

- `common/fileDrop`, `common/fontLanguages`, `voice/saveBar`, `voice/rvcStartOptions`, `captionOverlay/bridge`
- `common/useConsentDialog`, `common/useLegacyDownloadStatus`, `ocr/useOcrSetup`, `translation/useTranslationSetup`, `transcription/useTranscriptionConsent`

The drag state, the save bar items, the RVC settings and start options, the requests to confirm translation models, and the requests for transcription consent with their 2 modes now have named types.

### Stage 2: the roots of the data layer

- `store` (the definitions of the Jotai atoms; 134 files refer to it)
- `common/useStdoutToPython` (sending to the backend; 53 files refer to it)
- The files that only re-export (`common/index`, `configs/index`, `main/index`)

Because these were typed first, the hooks from stage 3 on receive real types instead of inferred ones.

- Each atom got the type of the value it holds. Atoms that start as `null` or an empty array are declared with the type of the value that goes in later. The shapes of the values follow the existing TypeScript types (`SwitchBlocks`, `StartupFailure`, `MessageLogRow`, `IoFlow` and others) and `docs/spec/`.
- The fields that the store hooks return keep the names built from the atom names (`currentX`, `updateX`, `pendingX`, `errorX`) and now carry types. `currentSwitchBlocks.data` from `useStore_SwitchBlocks()` is `SwitchBlocks`.
- The 2 casts in `CompanionController.tsx` were removed, and `ALLOWED` in the type strictness check was emptied.
- The result of `useStdoutToPython` is `false`, `true` or a reply to a settings write, and its type is `StdoutResult`.
- To the store, the atoms built at run time from the settings (`ui_config_setter`) have the value type `unknown`. The hook that looks them up by name (`getStoreHook`) returns them in a form where neither the field names nor the value types are known. The types of the setting values were added on the `ui_config_setter` side in stage 4.

### Stage 3: small hooks

These are hooks of a few dozen lines that depend only on the store and IPC. They were moved in groups by feature (42 files).

- `transcription/` (`useRealtimeASR`, `useLocalAsrMigration`), `flow/` (`useIoFlow`, `useGpuMemory`), `translation/` (`useOpenTranslatorList`, `useTranslationCatalog`), `configs/useOcrSharedWindow`, `configs/config_page_setter/_aux/useSettingBoxScrollPosition`
- The hooks in `voice/` (`useVoice`, `useModelDownloads`, `useSpeechServers`, `useVirtualMic`, `useVcRuntimes`)
- `main/` (`languageMutations`, `useLanguageSettings`, `useMainFunction`, `useIsMainPageCompactMode`, `useMessageInputBoxRatio`, `useMessageLogScroll`), `setup/useFirstRunSetup`
- The 19 hooks in `common/` (`useMessage`, `useNotificationStatus`, `useVolume`, `useHandleOscQuery` and others). `TranslatedNotice`, which `useNotificationStatus` and `useHandleOscQuery` use, `MessageActions`, which wraps `useMessage`, and `useIsVrctAvailable`, which contains no JSX, were also moved early, ahead of stage 5.

Hooks that receive backend responses have a type that lists the fields the hook reads. The fields they do not read are left open (`[key: string]: unknown`), and views such as the settings screen read them. The types are declarations that follow the shape the core (`native/core`) sends and `docs/spec/`, and they are not checked at run time. Where a hook already checked values before (the flow diagram, the speech server status rows, the hardware list for model downloads, registered models and the translation catalog), that check is now a type guard. The receiving side (`useReceiveRoutes` in stage 4) also passes values on without new run-time checks.

The next 5 read fields of the settings hooks (`useTranslation`, `useTranscription`, `useOcr`, `useAppearance`). `ui_config_setter` builds the settings hooks at run time, so before the move their type was inferred as `{}`, and their fields could not be read without a cast. So these 5 were moved after `ui_config_setter` was moved in stage 4.

- `main/useSetupNeeds`, `main/useSwitchBlocks`, `setup/useRecognitionState`, `common/useStartupProgress`, `common/useWindow`

### Stage 4: large modules

As a rule, each file gets one pull request. The line counts are from when the migration plan was written.

| File | Lines | State |
|---|---|---|
| `configs/config_page_setter/ui_config_setter` | About 1,470 | Done |
| `useReceiveRoutes` | About 750 | Done |
| `_useBackendErrorHandling` | About 690 | Done |
| `configs/config_page_setter/useSettingsLogics` | About 470 | Done |
| `configs/config_page_setter/hotkeys/useHotkeys` | About 470 | Done |
| `configs/config_page_setter/_aux/useConfigSearch` | About 280 | Done |

`ui_config_setter` gives types to the fields that `useSettingsLogics` builds, so the 2 were moved in one pull request. `useConfigSearch`, which reads the settings hooks, and the 5 held back in stage 3 were moved in the same pull request.

- The value type of each setting is in `SettingValues` in `configs/config_page_setter/settingTypes.ts`. `SETTINGS_ARRAY` is checked against this type with `satisfies`, so a default value of the wrong type is a type error.
- When you add a setting, write both its entry in `SETTINGS_ARRAY` and its type in `SettingValues`. An entry whose name is not in `SettingValues` is a type error.
- The type of the fields that a settings hook (`createCategoryHook`) returns (`CategoryApi`) is built from `Category`, `Base_Name`, `logics_template_id` and `response_transform` of the `SETTINGS_ARRAY` entries.
- The tests and `tools/spec_catalog.py` read the `SETTINGS_ARRAY` entries as text. That is why the type definitions were split out into `settingTypes.ts`. Do not change the order of the keys in an entry either.

`useReceiveRoutes` and `_useBackendErrorHandling` handle the shapes of the backend's responses and errors. Both write the values they receive straight into the settings atoms and similar places. To keep the behavior unchanged, no new run-time checks of the received values were added, and only the checks that already existed (the check of initialization values, the type guards inside hooks) were kept. Each declaration is confined to one place, so that how far to check can be decided again later ("Type strictness" below). `StartPythonController` was moved in the same pull request too.

- The frame of a response is read with `readBackendResponse` as `BackendResponse` (`endpoint`, `status`, `result`). Logs (348) have no `endpoint`, so they are read as `""`, as before. A response without a numeric `status`, or with an `endpoint` that is not a string, stops at the entrance with a named `TypeError`, and the session records it.
- Where this file itself reads values inside a response (error codes, `data?.x` and so on), it reads them with `fieldOf`, which works like `?.`, and checks their type before using them. For values that match the specification, the result is the same as before.
- The place where the cloud speech recognition authentication key is written back has its name built from `CloudTranscriptionBase`, so it gets a type without an added declaration.
- `tools/spec_catalog.py` reads these 2 source files as text and picks up the route table and the error codes. How the table is written has not changed.

`useHotkeys` does not depend on the settings list, so it was moved apart from the rest.

- Types with the same shape as on the Rust side were declared for the values that native commands and events return: the answer of `quick_chat_shortcut_platform` (`ShortcutPlatform`), the key presses that arrive from the portal (`PortalActivation`) and the keys that the desktop assigned (`PortalAssigned`). These are declarations only and are not checked at run time.
- The main window (`store.appWindow`) is read through a small function. When it is not set, the function stops with a named `TypeError` (the same handling as in `CornerRadiusController`).

### Stage 5: JSX in `logics`

`common/MessageActions`, `common/TranslatedNotice` and `common/useIsVrctAvailable` were moved in stage 3 (`useIsVrctAvailable` contains no JSX, so it is `.ts`).

`voice/useSettingsDraft` was moved in the same pull request as the first round of stage 6. It is a general-purpose hook that the settings screen's forms use, and it takes the type of the draft as a parameter (`T`). The draft, `canSave`, `pending` and `savedFromResponse` use the same type. A write sends either the draft or, with `patch`, only the fields that changed (`DraftWriteValue<T>`).

### Stage 6: `views`

As ADR-010 says, the rule is to move views along with the work that touches those screens. When moving them in bulk, start with the small windows.

1. `common_components`, `theme`
2. `quick_chat`, `caption_overlay`, `companion_handle`, `companion_panel`
3. `vr`
4. `app`. It is the largest area, so the settings screen's `setting_box` is moved section by section.

Steps 1 to 3 are done (`theme`, `companion_handle` and `companion_panel` were already TypeScript).

- Each component got a props type.
- `caption_overlay` checks the shape of the captions it receives from a native command (`CaptionSnapshot`, `captionOverlay/lines.ts`) before drawing them. Captions with the wrong shape are not drawn, and only a warning that leaves out their content is emitted.
- The VR settings window reads the AI translation model fields with a small function instead of looking them up by a name string. A test that checks the operations the VR UI sends picks up the names from the source, so the names are written out as they are, not assembled.
- The `as { ... }` casts that TypeScript files in `views` (`CompanionController.tsx`, `ExperimentalFeatures.tsx`, `UsagePresetSelector.tsx`) used when there were no types were removed.

These 3 files in `vr` were moved together with other areas.

- `VrLogWindow`: it passes `savedView` to `LogBox` (`app/main_page`), so it was moved with `main_page`.
- `VrIoFlowWindow`: it uses `IoFlowView`, so it was moved with `io_flow`.
- `VrApp`: it contains the receiver (`VrStateReceiver`) that writes the state arriving from the main window straight into atoms. It was moved after `useReceiveRoutes`, under the same policy (no new run-time checks). Writing the main window's values straight into the atoms of the same name is declared in one place, the type guard `isMirroredAtom` ("Type strictness" below).

`app` is moved in this order, with one pull request per area.

1. `app/others` and the entry point of `app`
2. `app/_app_controllers` (in 2 rounds)
3. `app/main_page` (with `VrLogWindow`)
4. `app/io_flow` (with `VrIoFlowWindow` and the split of the `FlowNode` type)
5. `app/config_page`. `setting_box` is split by section.

Step 1 is done.

- `EnvReadout` (`setting_box/_components/env_readout`), a settings screen component that `VrchatPresence` in `app/others` uses, was moved early too. `tone` and `progress` are union types of the values the page passes (`EnvReadoutTone`, `EnvReadoutProgress`).
- `app/others/index.ts` re-exports without extensions (as `common_components/index.ts` does). It can point to the files both before and after their move.
- The stop and mute buttons (`StopActions`) read open fields (`[key: string]: unknown`) of the audio state (`VoiceStatus`, `RouteSnapshot`). They use the number of waiting items only when it is a number, and the mute request only when it is `true` or `false`.
- Notifications (`SnackbarController`) no longer pass a class for each notification. react-toastify 11 reads `toastClassName` only from the container, so that class was not applied on screen before either. The look does not change. Whether to apply it will be decided after the look is checked.

The first round of step 2 moved the 16 files in `app/_app_controllers` and `index`.

- The state of the main functions from before the settings screen opens (`MainFunctionsStateMemory`) got a type in the store. When the settings screen opens, the controller also writes `translation`, so the type includes it. The initial value does not have it, so it is an optional field.
- The rounded corners read the Windows version from User-Agent Client Hints (`navigator.userAgentData`). The TypeScript DOM types do not have it yet, so `src-ui/navigatorUAData.d.ts` declares only the parts that are read. WebKitGTK does not have the property, so it is declared as optional.
- Messages from Quick Chat are received as the type that a native command returns (`QuickChatRequest`). As in `quickChat/bridge.ts`, this is a declaration only and is not checked at run time.

The next 6 were left for the second round, because typing them was a large job. The second round moved the 5 other than `StartPythonController`, after the settings screen components. `StartPythonController` is moved together with `useReceiveRoutes`.

- `FirstRunSetupController`, `VirtualMicGuideController`, `TranslationSetupController`: they pass props to settings screen components (`LegacyModelDownloadDialog` and others, in JavaScript). Some props cannot be passed with the components' inferred types, so the components get types too.
- `StartPythonController`: it passes the responses it receives to `useReceiveRoutes` (it was moved together with `useReceiveRoutes`).
- `VrPanelSyncController`: it checks the send requests that arrive from the VR UI before passing them to the backend. It needs a type guard that checks the arriving values.
- `CaptionOverlayController`: it builds the value for the caption window (`CaptionSnapshot`) from the setting values.

These are the places where the second round changed how the code is written.

- Send requests from the VR UI are received as `VrPanelStdoutRequest`. As before, their path is checked against the relay list (`isRelayAllowed`, a type guard) before they are sent. Value and language requests are passed on as the panel sends them, with declarations only.
- A change to the conversation log is sent when its value has the shape `{ data: array of rows }` (type guard `isLogState`).
- The value sent to the caption window is built as the type that the window checks (`CaptionSnapshot`).
- `ModelDownloadJob` in the download hook (`useModelDownloads.ts`) now declares the fields that first-run setup reads (`job_id`, `phase`, `error_code`, `received_bytes`, `total_bytes`). These are declarations only and are not checked at run time.

Step 4 (`app/io_flow`) was moved before step 3. `VrIoFlowWindow` and the main screen's `IoFlowPanel` were moved in the same pull request.

- The nodes of the flow diagram (`FlowNode`, `flow/flowGraph.ts`) were split into a union of types for each kind (`InputNode`, `RecognitionNode`, `TranslateNode`, `SpeechNode`, `ConversionNode`, `LiveVoiceNode`, `OutputNode`). The nodes it builds have the same fields in the same order as before.
- The flow diagram types (`ioFlow.ts`) follow the shape that the core always sends, and a lane's `translation` and `targets` are no longer optional. These are declarations, and as before, the only run-time check is the type guard in `useIoFlow` (that there are 2 lanes).

Step 3 (`app/main_page`) is split into 2 rounds. The first round moved the sidebar (the language settings, the main switches), the top bar (the quick settings menu), the language list and `RealtimeControls`.

- Whether a press landed outside a menu or list is asked through the shared type `TargetHolder` (`logics/common/targetHolder.ts`) ("Type strictness" below).
- Which side a language field belongs to is received as a union type (`LanguageSelectorKey`).
- The types in `useVoice.ts` were corrected to the shape that the core sends. A row in the list of direct voice inputs is a pair of an identifier and a label (`VoiceSourceRow`), and the direct voice state declares `output_route` and the RVC fields of the saved settings (`DirectVoiceSettings`). These are declarations only and are not checked at run time.

The second round moved the conversation column (the log, the input field, the character count warning, the log size), `MainSection`, `MainPage`, `startupContext` and `VrLogWindow`.

- The types of the text that a log row shows were declared, in the shape of "Messages" (メッセージ) in `docs/spec`. They are `MessageLogText`, `MessageLogContent`, `TransliterationToken` and the fields of `MessageLogRow` in `realtimeCaptionState.ts`, and the type of a new message (`NewBackendMessage`) in `useMessage.ts`. These are declarations only and are not checked at run time.
- The blank row left by a removed row (`GoneRow<Id>`, `messageLogView.ts`) takes over the type of the original row's `id`, and the log uses that as the key as it is.
- The display state that the VR log window keeps while it is closed is `SavedLogView`.
- The input field stops with a named `TypeError` when it is drawn outside the provider of the message actions (`MessageActionsProvider`). It stopped at the same place before.
- The `inert` attribute, which the React 18 types do not have, is declared in `src-ui/inertAttribute.d.ts` as `inert?: "" | undefined`. The page writes `inert=""` when it hides something and writes nothing otherwise.
  - Later change: when React was raised to 19 (PR #495), this declaration was removed. The React 19 types hold `inert` as a boolean, and React 19 treats `inert=""` as false and does not write the attribute. The page writes it as a boolean: `inert={whether to hide}`.

Step 5 (`app/config_page`) starts from the components (`setting_box/_components`) and the templates (`_templates`) that the pages use. The pages then move on top of those props types. The first round moved `_atoms` (input fields, dropdowns, download buttons, buttons that open a page) and the small components that depend on no other component (labels, headings, descriptions, hints, rows, folds, pointers to pages, input fields with a save button, authentication keys, colors, action buttons, connection checks, file locations, the telemetry contents, compute device names).

- Each component exports its props type (`LabelComponentProps` and others). To avoid missing any props that pages pass, the types were decided after looking at every caller.
- A row (`FormRow`) reads only `id` and `aria-describedby` from its child element (`RowControlProps`).
- `focus` and `blur` on an input field do nothing when there is no element. They are not called before the field is drawn, so they behave as before.

The second round moved the remaining components (sliders, threshold rows, shortcut fields, dropdowns, choices, word filters, formats, the download confirmation for built-in models, compute devices, credential pairs), the row templates (`_templates/Templates`) and `_components/index`.

- The props of a row template combine the row's props (`TemplateRowProps`) and the props of the component it draws (`SliderContainerProps` and others). The common row (`CommonContainer`) takes the type of all the props passed to it as a parameter, and checks the component it draws against those props minus the row's own props. Passing the wrong component is a type error.
- A dropdown list is `DropdownList` (`[]` until it arrives), and a choice is `RadioOption`. The type of the choices is a parameter, so in model selection, the component under each model receives that model's choices.
- The download confirmation for built-in models (`LegacyModelDownloadDialog`) reads the catalog as a type with only the fields this window reads (`ReviewCatalog`). As with the hook's catalog, this is a declaration only and is not checked at run time.
- The credential pair (`CredentialPair`) builds the keys `current${B}URL` and `current${B}AuthKey` from the provider's name and turns them into a type.

The settings pages are moved section by section. The first round moved "Device" (`device/`) and "Speech recognition (ASR)" (`transcription/`).

- The types in `useRealtimeASR.ts` changed from a list of only the fields the hook reads to declarations of the shape that the core sends (`RealtimeAsrSettings` and others). These are declarations only and are not checked at run time.
- The `base` of a cloud speech recognition engine is `CloudTranscriptionBase` (`configs/cloudTranscription.ts`), a union type of 4 values.
- The field values that the save logic (`useSaveButtonLogic`) returns are `unknown`. The page turns them into the same string that the field shows before passing them to the input field (`entryText`).

The second round moved the voice pages (`tts/` and `rvc/` under "Speech") and the voice and model parts of the advanced settings (`VoiceSettings`, `DirectVoiceSettings`, `VoiceAudition`, `SpeechServers`, `StatusLine`, `EngineCatalog`, `VcRuntimeSetup`, `ModelDownloads`, `UserModels`).

- The values that hooks receive from the core got declared types: the catalog rows (`ModelCatalogRow`) and jobs of `useModelDownloads`; the voice settings of `useVoice` (all of whose values are strings), the output devices, the range of seed values a model accepts and its instructions, and the engines' voices; the profiles and devices of `useSpeechServers`; and the catalog and jobs of `useVcRuntimes`. These are declarations only and are not checked at run time.
- `reserve` and `only` of `ModelDownloads` are optional props. The `reserve={undefined}` that the download confirmation for built-in models passed was removed.
- When there are no settings, they are read through a function that stops with a named `TypeError` (`SpeechServers` and `DirectVoiceSettings`). They stopped at the same place before.

The third round moved the "Advanced" page (`AdvancedSettings`, about 690 lines).

- The save logic holds field values as `unknown`. `fieldValue` and `fieldText` turn them into the same string that React writes to the field before they are passed on.
- A reply to a write is read only when the backend returned one (`answerOf`). The error code for the TLS pair is used only when it is a string; otherwise the result is `save_unconfirmed`, as before.

The fourth round moved the "Translation" page (`Translation`, about 970 lines), the translation catalog and the download of the GPU builds for local translation (`TranslationGpuRuntimes`). `TranslationGpuRuntimes` could be moved without being rewritten, because the download component (`VcRuntimeSetup`) and the catalog now had types. The download of the llama.cpp server (`TranslationLlamaRuntimes`), which #703 added on develop, was also moved in the same pull request when develop was merged in. The catalog passes `onInstalled` to it, so that prop got a type.

- A catalog entry is passed to its card paired with the group it belongs to (`CatalogEntry`).
- The rows of models that the user added have no `non_commercial` or `license`, so the license check and the license text read those fields only when they exist.
- How the definitions that tests read with regular expressions (`EXTERNAL_API_PROVIDERS`, `LOCAL_LLM_PROVIDERS`, `ENGINE_GROUPS`) are written has not changed.

The fifth round moved the remaining pages (VR captions in `vr/`, chat reading in `ocr/`, appearance, the shared rows, VRChat, hotkeys, about the app and updates).

- The VR captions page receives the overlay log settings that the backend answered to a write through one declaration (the overload of `answeredSettings`) ("Type strictness" below).
- The `id` of a choice (`RadioButton`) accepts `string | number`, because the number of flow bands (1 to 3) is compared as a numeric id and returned as it is. The argument of `selectFunction` has the type of the ids of the choices passed in.
- The chat reading model download reads the catalog as a type with only the fields this page shows (`OcrCatalogModel`). This is a declaration only and is not checked at run time.
- The pattern that decides which page files the tests read was widened to `/\.(jsx|tsx)$/`.

The sixth round moved the frame of the settings screen (`ConfigPage`, `SettingSection`, `SettingBox`, `setting_box/index`, the settings menu, search, the top bar and the save bar, the version display), which completed `app/config_page`.

- `setting_box/index.ts` re-exports without extensions (as `app/others/index.ts` does).
- Focus goes back to the open tab and to the button that opened the settings only when the element has `focus()` (type guard `focusable`).
- For the confirmation when leaving (`vrct:settings-leave`), `detail.proceed` is accepted only when it is a function. This is the same way the settings forms read it (`leaveAction` of `useSettingsDraft`).

### Stage 7: tests and the harness

The test files and the harness in `src-ui/logics/test/` were turned into TypeScript. The tests run on Vitest ("UI tests (Vitest)" (UIの試験（Vitest）) in [development.md](development.md)). Until the tests became TypeScript, they were handled as follows.

- A pull request that moved source files rewrote only the lines of the tests that named the moved files (`./saveBar.js` to `./saveBar.ts` and so on). It did not change how the tests were written, how they ran or the harness API.
- Tests that read the source as text, rewrite it and then load it (`useStdoutToPython.test.js`, `languageMutations.test.js`) erase the types with `stripTypeScriptTypes` from `node:module` before rewriting the import lines. Type-only imports disappear, so only value imports are rewritten.
- The harness's `loadModule` loads `.ts` and `.tsx` files through Vite's transform (`harnessModules.ts`). Type-only imports (`import type`) disappear, so they need no mocks. It finds the matching mock even when a dependency is named without an extension.

The 4 harness files (`hookHarness`, `bridgeHarness`, `vitestSetup`, `vrPanelStateScan`) were moved first. The tests move on top of them, in one pull request per group.

- The tests and their infrastructure run on Node, so their types are checked with `tsconfig.test.json`. Only this configuration reads the Node types (`@types/node`), and the tests and infrastructure were removed from `tsconfig.json`, which checks the app's source. `npm run typecheck` runs both.
- The tests get the same rules as the app's source (`strict`, and no `any`, double casts or `@ts-...`). `test_typescript_strictness.py` counts the tests too.
- `loadModule<M>` returns the type of the source module that the test names (`typeof import("./Foo.tsx")`). That the exports of the loaded source have that type is declared in one place, the overload of `loaded` in `hookHarness.ts`. It is not checked.
- The nodes of a drawn tree (what `find` searches) are treated as React elements (`ReactElement`). Every object in the tree is an element, so this is declared in one place, `asNode` in `hookHarness.ts`. As the React types say, an element's `props` hold the values passed to it as they are.
- A hook's memory (the slots of `useState` and the like) holds values of that hook's type, because the same hooks use them in the same order. This is declared in one place, `held` in `hookHarness.ts`.
- `@babel/standalone` has no types, so only the `transform` that the infrastructure uses is declared, in `src-ui/logics/test/babelStandalone.d.ts`.
- Values that the tests pass to the code without a declared type go through `unchecked<T>()` in `hookHarness.ts`. These are test values that have only the fields the code reads, and values of a deliberately different shape passed to observe how the code behaves. Which of the two a value is gets written where `unchecked` is called. The tests use no casts; this one place holds the declaration.

The 206 tests were moved on top of the harness in 9 pull requests, one per group (#749 to #757). No test changed its name, inputs, checked values or count (Vitest ran 207 files and 1569 cases, the same as before the move).

- More places now check a found node with `assert.ok` before reading it. Where a test used to fail with a `TypeError` from reading `null`, it now fails at the same place with an `AssertionError`.
- Right after the move, `unchecked` was used in about 200 places. Besides the 2 uses, it also served where a component taken from the drawn tree was drawn and where an element's `ref` was read. Each test file also had its own functions, for example to check a found node or to read the locales. This was because the areas were moved in parallel.
- By the decision of 2026-11-20, these were gathered into the harness. `unchecked` remains only for the 2 uses (marked with a `Test data:` or `On purpose:` comment), now in 90 places. The harness's helper functions are listed in "The test harness" below.

### Stage 8: finishing

- Remove `allowJs` from `tsconfig.json`. By the end of stage 7, the source and tests in `src-ui` and the 2 files in `locales` (`config`, and `useI18n`, which `@useI18n` points to) had all become TypeScript, so this work can start. The configuration files at the root of the repository (`vite.config.js`, `vitest.config.js` and others) and the scripts in `tools/` are outside the type check.
- Tighten the type check step by step. The candidates are `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noUnusedLocals` and `noUnusedParameters`. Turn them on one at a time, and fix the errors that appear before going on to the next.
- For lint, ESLint was replaced by Biome (`biome.json`, [development guide](development.md#uiのlintと整形biome)). `.eslintrc.json` was removed.

## Type strictness

- `tsconfig.json` is `strict`. It checks only the TypeScript files; JavaScript files are only read with inferred types.
- `tests/devtools/test_typescript_strictness.py` counts `any`, `as unknown as`, `@ts-ignore`, `@ts-nocheck` and `@ts-expect-error` in the TypeScript files of `src-ui`. Those that cannot be removed yet are listed in `ALLOWED` with their count for each file. The test fails when a count goes up and when it goes down, so when you remove one, lower the list as well.
- Code that handles DOM elements checks them with type guards instead of casts that assume a type. For example, `Element` has no `focus()`, so `useConsentDialog` treats only the elements that have `focus` as `Focusable`.
- TypeScript treats a computed key as `string`, so it cannot confirm that `{ [key]: value }` has a key named `K`. The store declares this in only one place, with the overload of `field()`. It holds because the names are passed one at a time.
- For the same reason, the settings list (`ui_config_setter.ts`) has 2 declarations. Both are for the types of fields and atoms built in a loop from the `SETTINGS_ARRAY` entries, whose names TypeScript cannot follow.
  - The overload of `buildCategoryApiFromSettings` declares that the fields a settings hook returns are as `CategoryApi` describes. `useSettingsLogics`, which builds the fields, and `CategoryApi`, which builds the type, make the names from the same entries.
  - The overload of `useSettingValue` declares that the value of a settings atom has the type in `SettingValues`. The atom starts from a default value checked with `satisfies`, and only that setting's hook writes to it.
- Do not add declarations for computed keys anywhere else. When you need the same shape, use `field()` or these 2 types (`CategoryApi` and `SettingValues`).
- Whether a press landed outside a menu or list is asked through `TargetHolder` (`contains(target: EventTarget | null)`) in `logics/common/targetHolder.ts`. In the DOM types, an event's target is an `EventTarget`, and `Element.contains` accepts only a `Node`. Method parameters are compared in both directions, so an element can be assigned to `TargetHolder` as it is, and the question can be asked without narrowing the target. This holds because what gets pressed is an element of the page. Use this type for the same check, and do not add declarations of the same shape.
- `answeredValue` in the draft hook (`useSettingsDraft.tsx`) is also a declaration that cannot be checked. It receives the value that the backend answered to a write as the same type (`T`) as the saved value (the return value of `savedFromResponse`, if there is one). Like the atom values, it is declared and not checked.
- `answeredSettings` on the VR captions page (`Vr.tsx`) is the same kind of declaration. It receives the settings that the backend answered to a write as the overlay log settings (`OverlayLogSettings`).
- `src-ui/cssProperties.d.ts` adds names that start with `--` to React's `CSSProperties`. Passing a CSS custom property (such as `--checkbox-size`) in an inline style needs no `as CSSProperties`.
- `src-ui/i18next.d.ts` turns off `strictInterpolationChecks`, a type setting of i18next. In i18next 27 this setting became on by default, and `t(key)` and `t(key, options)` became separate signatures. The locale files are YAML read at run time, so i18next does not know which variables a message takes, and this check cannot verify the variables. With the setting off, the type of `t` is the same as in i18next 26, and `t` can be passed as it is to the UI's translation type (a single function, `t(key, options?)`).
- The parameter types of the hooks that receive backend responses are declarations of the shape that the core sends. The side that receives the responses and passes them to the hooks (`useReceiveRoutes`) passes them on without checks. Passing `result`, as it arrived, to the hooks and functions that the route table names as strings is declared in one place, the type guard `isCallable` (`(...args: unknown[]) => unknown`) in `useReceiveRoutes.ts`. It checks only that the target is a function, as before. When the `data` of a 400 response is written back to the settings, the overload of `keptValue` in `_useBackendErrorHandling.ts` declares it as the type of the target `update…`. That the VR UI's entry point (`VrApp.tsx`) writes values arriving from the main window into the atoms of the same name is declared with the type guard `isMirroredAtom`. It checks only that the atom exists, as before. Only the values that hooks already checked before are checked, by the type guards inside the hooks. The same goes for `updateFromBackend…`, `setSuccess…` and `deleteSuccess…` of the settings hooks. However, for a setting that turns a list into another shape with `response_transform`, the received value is checked to be a list before it is turned.
- The settings hooks return typed fields. The `as { ... }` casts that TypeScript in `views` used when there were no types were removed in stage 6.

## The test harness

The tests (`*.test.ts`) get the same rules as the app (decision of 2026-11-20): `strict`, with no `any`, double casts or `@ts-...`. Whatever types cannot confirm is declared one place at a time, inside the helper functions of the harness (`src-ui/logics/test/`), and the tests themselves use no casts.

- The declarations are in the following places. All of them are overloads and are not checked at run time (`componentOf` and `componentNamed` check only that the value is a function).
  - `hookHarness.ts`
    - `loaded`: the exports of the loaded source have the type of the module that the test names
    - `asNode`: the objects in a drawn tree are elements
    - `held`: a hook's slot holds a value of that hook's type
    - `unchecked`: values without a declared type that the tests pass to the code
    - `asComponent` (inside `componentOf` and `componentNamed`): a component that a test draws itself accepts the props passed to it and returns the tree that is read
    - `timerHandle`, `asTimerFunction`: a fake timer's id is a number, and the fakes stand in for the global timers
  - `bridgeHarness.ts`
    - `settingAtom`: a settings atom in the registry is a primitive atom of the setting's state
- `unchecked` has only 2 uses: (1) test values that have only the fields the code reads, and (2) values of a deliberately different shape passed to observe how the code behaves. Where it is called, put a comment that starts with `Test data:` or `On purpose:`. For anything else, use the helper functions below.
- The helper functions that the tests use again and again are in the harness.
  - Searching the tree: `find`, `findIn` (fails when nothing is found), `nodesIn`, `treeNode`, `componentName`
  - Drawing components: `componentOf`, `componentNamed`, `draw`, `drawWith`. A component that takes a `ref` is drawn like any other, because in React 19 `ref` is one of the props
  - An element's `ref`: `refOf`, `setRef`
  - Reading values of unknown type: `isRecord`, `fieldOf`
  - Fake timers: `timerHandle`, `timerNumber`, `asTimerFunction`
  - Locales (`locales.ts`): `readLocale`, `localeAt`, `textAt`, `branchAt`. When they read a language file, they check that it consists only of strings and maps.
  - Notifications and settings atoms (`bridgeHarness.ts`): `Notice` (the body is a `ReactNode`, the options are `NotificationOptions`), `noticeText`, `settingAtom`
- Packages used only for their types (`@types/node`, `@babel/types`) go in the development dependencies.

## Steps for moving a file

This section is a record. No JavaScript is left in `src-ui` or `locales`, so there are no more files to move. Import extensions now follow the rule in the [development guide](development.md#uiのtypescriptとスタイル移行中) (a relative import includes the extension, as in `./name.ts`). The "drop the extension" in step 3 below is the step from before that rule existed.

1. Rename the file to `.ts` (`.tsx` if it contains JSX) with `git mv`.
2. Add types. Do not give narrow types, without checking, to values that come from outside (backend responses, settings, the DOM).
3. Update the references.
   - In views and other source files, drop the extension from the import (Vite finds the `.ts`).
   - In tests that Node reads directly, and in the harness's `loadModule(new URL(...))`, use `.ts`.
   - Also check that no Python test or script in `tools/` points to the path.
4. Run `python tools/dev.py check --scope ui` and `python tools/dev.py check --scope tooling`.

---

# 画面側の TypeScript 移行計画（日本語版）

画面側（`src-ui`）の JavaScript を TypeScript へ移す順序と切り分けです。目的と進め方の正本は Issue #544、採用の判断は [ADR-010](adr/adr-010-frontend-stack.md) です。混在期の書き方（拡張子つきの import、消去できる構文だけを使うことなど）は [development.md](development.md) の「UIのTypeScriptとスタイル」にあります。

## 方針

- 振る舞いを変えない移行に徹します。機能の変更や修正は別の PR にします。
- 依存の少ない範囲から移します。移すファイルが未移行の JavaScript を import していると、そこから受け取る値の型が推論頼みになり、厳密に型を付けられないためです。
- 移したファイルには、実際の型を付けます。`any`、`unknown` を経由した二重のキャスト、`@ts-ignore` などで検査を止めることはしません。`tests/devtools/test_typescript_strictness.py` がこれを数えます（下の「型の厳しさ」）。
- 1 回の PR はレビューできる量にします。目安は数百行です。大きなファイルは 1 本で 1 回の PR にします。
- どの段階でも、ビルド、型検査、試験が通る状態を保ちます。

## 現状の量

第 7 段を終えた時点で、`src-ui` の中のファイルは次のとおりです。`.jsx` は JavaScript に含めます。

| 範囲 | JavaScript | TypeScript |
|---|---|---|
| `src-ui/logics`（試験を除く） | 0 本 | 155 本、744KB（うち `.css.ts` が 1 本） |
| `src-ui/views`（試験を除く） | 0 本 | 219 本、1.1MB（うち vanilla-extract の `.css.ts` が 19 本） |
| 試験（`*.test.ts` と `src-ui/logics/test/`） | 0 本 | 210 本、1.5MB |

残りの JavaScript の一覧は、次のコマンドで出せます。

```sh
git ls-files src-ui | grep -E '\.(js|jsx|mjs)$' | grep -v -E '\.test\.|/logics/test/'
```

## 段階

| 段 | 対象 | 状態 |
|---|---|---|
| 1 | 未移行の JavaScript を import しない `logics` の葉のモジュール | 済み |
| 2 | データ層の根（ストアと IPC） | 済み |
| 3 | ストアと IPC だけに依存する小さなフック | 済み。設定のフックを読む 5 本は第 4 段で移した |
| 4 | `logics` の大きなモジュール（1 本ずつ） | 済み。受け取る値は実行時に新しく確かめず、宣言で渡す（下の第 4 段） |
| 5 | `logics` の中の JSX（`.jsx` から `.tsx` へ） | 済み |
| 6 | `views` | 済み |
| 7 | 試験とテスト用のハーネス | 済み。`src-ui` と `locales` に JavaScript は残っていない |
| 8 | 仕上げ（`allowJs` を外し、検査を強める） | 未着手 |

### 第 1 段：`logics` の葉のモジュール

プロジェクトの中の未移行の JavaScript を import しないモジュールです。React、Jotai、Tauri の API だけを使います。

- `common/fileDrop`、`common/fontLanguages`、`voice/saveBar`、`voice/rvcStartOptions`、`captionOverlay/bridge`
- `common/useConsentDialog`、`common/useLegacyDownloadStatus`、`ocr/useOcrSetup`、`translation/useTranslationSetup`、`transcription/useTranscriptionConsent`

ドラッグの状態、保存バーの項目、RVC の設定と起動オプション、翻訳モデルの確認の要求、文字起こしの同意の要求とその 2 つのモードに、名前の付いた型ができました。

### 第 2 段：データ層の根

- `store`（Jotai の atom の定義。134 本のファイルが参照しています）
- `common/useStdoutToPython`（バックエンドへの送信。53 本が参照しています）
- 再輸出だけのファイル（`common/index`、`configs/index`、`main/index`）

ここを先に型付けしたので、第 3 段以降のフックは推論ではなく実際の型を受け取れます。

- atom ごとに、持つ値の型を決めました。`null` や空の配列で始まる atom は、後で入る値の型で宣言しています。値の形は、すでにある TypeScript の型（`SwitchBlocks`、`StartupFailure`、`MessageLogRow`、`IoFlow` など）と `docs/spec/` に合わせました。
- ストアのフックが返すフィールドは、atom の名前から作る名前（`currentX`、`updateX`、`pendingX`、`errorX`）のまま型が付きます。`useStore_SwitchBlocks()` の `currentSwitchBlocks.data` は `SwitchBlocks` です。
- `CompanionController.tsx` の 2 つのキャストを外し、型の厳しさの検査の `ALLOWED` を空にしました。
- `useStdoutToPython` の結果は `false`、`true`、設定の書き込みへの応答のどれかで、型は `StdoutResult` です。
- 設定から実行時に作る atom（`ui_config_setter`）は、ストアから見ると値の型が `unknown` です。名前で引くフック（`getStoreHook`）は、フィールドの名前も値の型も分からない形で返します。設定の値の型は第 4 段で `ui_config_setter` の側に付けました。

### 第 3 段：小さなフック

ストアと IPC だけに依存する、数十行ほどのフックです。機能ごとにまとめて移しました（42 本）。

- `transcription/`（`useRealtimeASR`、`useLocalAsrMigration`）、`flow/`（`useIoFlow`、`useGpuMemory`）、`translation/`（`useOpenTranslatorList`、`useTranslationCatalog`）、`configs/useOcrSharedWindow`、`configs/config_page_setter/_aux/useSettingBoxScrollPosition`
- `voice/` のフック（`useVoice`、`useModelDownloads`、`useSpeechServers`、`useVirtualMic`、`useVcRuntimes`）
- `main/`（`languageMutations`、`useLanguageSettings`、`useMainFunction`、`useIsMainPageCompactMode`、`useMessageInputBoxRatio`、`useMessageLogScroll`）、`setup/useFirstRunSetup`
- `common/` のフック 19 本（`useMessage`、`useNotificationStatus`、`useVolume`、`useHandleOscQuery` など）。`useNotificationStatus` と `useHandleOscQuery` が使う `TranslatedNotice`、`useMessage` を包む `MessageActions`、JSX を含まない `useIsVrctAvailable` も、第 5 段から前倒しして移しました。

バックエンドの応答を受け取るフックは、フックが読むフィールドを並べた型を持ちます。読まないフィールドは開いたままにし（`[key: string]: unknown`）、設定画面などのビューが読みます。型は中核（`native/core`）が送る形と `docs/spec/` に合わせた宣言で、実行時には確かめません。前からフックが値を確かめていた所（流れの図、音声サーバーの状態の行、モデルの取得のハードウェアの一覧、登録したモデル、翻訳のカタログ）は、その確認を型ガードにしています。受け取る側（第 4 段の `useReceiveRoutes`）も、実行時に新しく確かめずに渡します。

次の 5 本は設定のフック（`useTranslation`、`useTranscription`、`useOcr`、`useAppearance`）のフィールドを読みます。設定のフックは `ui_config_setter` が実行時に作るので、移す前は型が `{}` と推論され、キャストなしではフィールドを読めませんでした。そのため、第 4 段で `ui_config_setter` を移してから、この 5 本を移しました。

- `main/useSetupNeeds`、`main/useSwitchBlocks`、`setup/useRecognitionState`、`common/useStartupProgress`、`common/useWindow`

### 第 4 段：大きなモジュール

1 本で 1 回の PR にするのが基本です。行数は移行計画を書いた時点のものです。

| ファイル | 行数 | 状態 |
|---|---|---|
| `configs/config_page_setter/ui_config_setter` | 約 1,470 | 済み |
| `useReceiveRoutes` | 約 750 | 済み |
| `_useBackendErrorHandling` | 約 690 | 済み |
| `configs/config_page_setter/useSettingsLogics` | 約 470 | 済み |
| `configs/config_page_setter/hotkeys/useHotkeys` | 約 470 | 済み |
| `configs/config_page_setter/_aux/useConfigSearch` | 約 280 | 済み |

`ui_config_setter` は `useSettingsLogics` が作るフィールドに型を付けるので、2 本を 1 回の PR で移しました。設定のフックを読む `useConfigSearch` と、第 3 段で後に回した 5 本も同じ PR で移しています。

- 設定ごとの値の型は `configs/config_page_setter/settingTypes.ts` の `SettingValues` にあります。`SETTINGS_ARRAY` は `satisfies` でこの型と照らし合わせるので、既定値の型が違えば型の誤りになります。
- 設定を足すときは、`SETTINGS_ARRAY` の項目と `SettingValues` の型の両方を書きます。`SettingValues` にない名前の項目は型の誤りになります。
- 設定のフック（`createCategoryHook`）が返すフィールドの型（`CategoryApi`）は、`SETTINGS_ARRAY` の `Category`、`Base_Name`、`logics_template_id`、`response_transform` から組み立てます。
- 試験と `tools/spec_catalog.py` は `SETTINGS_ARRAY` の項目を文字列として読みます。型の定義を `settingTypes.ts` に分けたのはそのためです。項目のキーの並びも変えないでください。

`useReceiveRoutes` と `_useBackendErrorHandling` は、バックエンドからの応答とエラーの形を扱います。どちらも受け取った値をそのまま設定の atom などに書き込みます。振る舞いを変えないように、受け取る値を実行時に新しく確かめることはせず、すでにあった確認（初期化の値の確認、フックの中の型ガード）だけを残しました。どこまで確かめるかは、あとで決め直せるように宣言を 1 か所ずつに閉じ込めています（下の「型の厳しさ」）。`StartPythonController` も同じ PR で移しました。

- 応答の枠は `readBackendResponse` で `BackendResponse`（`endpoint`、`status`、`result`）として読みます。ログ（348）には `endpoint` がないので、前と同じく `""` として読みます。数値の `status` がないものと、文字列でない `endpoint` を持つものは、入口で名前の付いた `TypeError` で止まり、セッションが記録します。
- 応答の中の値をこのファイル自身が読む所（エラーコード、`data?.x` など）は、`fieldOf` で `?.` と同じように読み、型を確かめてから使います。仕様どおりの値では前と同じです。
- cloud の音声認識の認証キーを書き戻す先は、`CloudTranscriptionBase` から名前を組み立てるので、宣言を足さずに型が付きます。
- `tools/spec_catalog.py` は 2 本のソースを文字列として読み、経路の表とエラーコードを拾います。表の書き方は変えていません。

`useHotkeys` は設定の一覧に依存しないので、ほかとは別に移しました。

- ネイティブのコマンドとイベントが返す値に、Rust と同じ形の型を宣言しました。`quick_chat_shortcut_platform` の答え（`ShortcutPlatform`）、ポータルから届くキーの押下（`PortalActivation`）、デスクトップが割り当てたキー（`PortalAssigned`）です。宣言だけで、実行時には確かめません。
- メインウィンドウ（`store.appWindow`）は小さな関数を通して読みます。設定されていないときは名前の付いた `TypeError` で止まります（`CornerRadiusController` と同じ扱い）。

### 第 5 段：`logics` の中の JSX

`common/MessageActions`、`common/TranslatedNotice`、`common/useIsVrctAvailable` は、第 3 段で移しました（`useIsVrctAvailable` は JSX を含まないので `.ts`）。

`voice/useSettingsDraft` は第 6 段の 1 回目と同じ PR で移しました。設定画面のフォームが使う汎用のフックで、下書きの型を引数（`T`）に取ります。下書き、`canSave`、`pending`、`savedFromResponse` が同じ型を使います。書き込みが送る値は下書きか、`patch` のときは変わったフィールドだけです（`DraftWriteValue<T>`）。

### 第 6 段：`views`

ADR-010 のとおり、画面を触る作業に合わせて移すのが基本です。まとめて移すときは、小さな窓から始めます。

1. `common_components`、`theme`
2. `quick_chat`、`caption_overlay`、`companion_handle`、`companion_panel`
3. `vr`
4. `app`。最も大きい範囲なので、設定画面の `setting_box` は区画ごとに分けて移します。

1 から 3 は済みました（`theme`、`companion_handle`、`companion_panel` は前から TypeScript でした）。

- 部品ごとに props の型を置きました。
- `caption_overlay` はネイティブのコマンドから受け取る字幕（`CaptionSnapshot`、`captionOverlay/lines.ts`）の形を確かめてから描きます。形の合わない字幕は描かず、中身を含まない警告だけを出します。
- VR の設定の窓は AI の翻訳のモデルのフィールドを、名前の文字列で引く代わりに小さな関数で読みます。VR パネルが送る操作を確かめる試験がソースの名前を拾うので、名前は組み立てずに書いたままにしています。
- 型がなかったころに `views` の TypeScript（`CompanionController.tsx`、`ExperimentalFeatures.tsx`、`UsagePresetSelector.tsx`）が書いていた `as { ... }` は外しました。

`vr` のうち次の 3 本は、ほかの区画と一緒に移しました。

- `VrLogWindow`: `LogBox`（`app/main_page`）に `savedView` を渡すので、`main_page` と一緒に移しました。
- `VrIoFlowWindow`: `IoFlowView` を使うので、`io_flow` と一緒に移しました。
- `VrApp`: メインウィンドウから届く状態をそのまま atom に書き込む受け取り口（`VrStateReceiver`）を含みます。`useReceiveRoutes` の後に、同じ方針（実行時に新しく確かめない）で移しました。同じ名前の atom にメインの値をそのまま書き込むことは、型ガード `isMirroredAtom` の 1 か所で宣言しています（下の「型の厳しさ」）。

`app` は次の順に区画ごとの PR で移します。

1. `app/others` と `app` の入口
2. `app/_app_controllers`（2 回に分けます）
3. `app/main_page`（`VrLogWindow` も）
4. `app/io_flow`（`VrIoFlowWindow` と、`FlowNode` の型の分割も）
5. `app/config_page`。`setting_box` は区画ごとに分けます。

1 は済みました。

- `app/others` の `VrchatPresence` が使う設定画面の部品 `EnvReadout`（`setting_box/_components/env_readout`）も、前倒しして移しました。`tone` と `progress` はページが渡す値のユニオン型（`EnvReadoutTone`、`EnvReadoutProgress`）です。
- `app/others/index.ts` は拡張子なしで再輸出します（`common_components/index.ts` と同じ）。移す前と後のどちらのファイルも指せます。
- 停止とミュートのボタン（`StopActions`）は、音声の状態（`VoiceStatus`、`RouteSnapshot`）の開いたフィールド（`[key: string]: unknown`）を読みます。待ちの数は数値のときだけ、ミュートの要求は `true` か `false` のときだけ使います。
- 通知（`SnackbarController`）は、通知ごとのクラスを渡すのをやめました。react-toastify 11 は `toastClassName` をコンテナーからしか読まないので、そのクラスは前から画面に付いていませんでした。見た目は変わりません。付けるかどうかは見た目を確かめてから決めます。

2 の 1 回目で、`app/_app_controllers` の 16 本と `index` を移しました。

- 設定画面を開く前のメイン機能の状態（`MainFunctionsStateMemory`）に、ストアで型を付けました。設定画面を開くと、コントローラーが `translation` も書き込むので、型にはそれも含めます。初めの値にはないので、省略できるフィールドです。
- 角の丸みは、Windows のバージョンを User-Agent Client Hints（`navigator.userAgentData`）から読みます。TypeScript の DOM の型にはまだないので、`src-ui/navigatorUAData.d.ts` で読む所だけを宣言しています。WebKitGTK にはないプロパティなので、省略できるものとして宣言しています。
- Quick Chat から受け取るメッセージは、ネイティブのコマンドが返す型（`QuickChatRequest`）として受け取ります。`quickChat/bridge.ts` と同じく宣言だけで、実行時には確かめません。

次の 6 本は、型を付ける作業が大きいので 2 回目に回しました。2 回目で、`StartPythonController` を除く 5 本を、設定画面の部品の後に移しました。`StartPythonController` は `useReceiveRoutes` と一緒に移します。

- `FirstRunSetupController`、`VirtualMicGuideController`、`TranslationSetupController`: 設定画面の部品（`LegacyModelDownloadDialog` など、JavaScript）に props を渡します。部品の推論された型では渡せないものがあるので、部品にも型を付けます。
- `StartPythonController`: 受け取った応答を `useReceiveRoutes` に渡します（`useReceiveRoutes` と一緒に移しました）。
- `VrPanelSyncController`: VR パネルから届く送信の要求を、確かめてからバックエンドへ渡します。届く値を確かめる型ガードが要ります。
- `CaptionOverlayController`: 設定の値から、字幕の窓に渡す値（`CaptionSnapshot`）を組み立てます。

2 回目で書き方を変えた所は次のとおりです。

- VR パネルから届く送信の要求は `VrPanelStdoutRequest` として受け取ります。パスは前と同じく中継の一覧（`isRelayAllowed`、型ガード）で確かめてから送ります。値と言語の要求は、パネルが送るとおりに宣言だけで渡します。
- 会話ログの差分は、値が `{ data: 行の配列 }` の形のときに送ります（型ガード `isLogState`）。
- 字幕の窓へ送る値は、窓が確かめる型（`CaptionSnapshot`）として組み立てます。
- 取得のフック（`useModelDownloads.ts`）の `ModelDownloadJob` に、初回セットアップが読むフィールド（`job_id`、`phase`、`error_code`、`received_bytes`、`total_bytes`）を宣言しました。宣言だけで、実行時には確かめません。

4（`app/io_flow`）は 3 より先に移しました。`VrIoFlowWindow` と、メイン画面の `IoFlowPanel` も同じ PR で移しています。

- フローの図の節点（`FlowNode`、`flow/flowGraph.ts`）を、種類ごとの型（`InputNode`、`RecognitionNode`、`TranslateNode`、`SpeechNode`、`ConversionNode`、`LiveVoiceNode`、`OutputNode`）のユニオンに分けました。作る節点のフィールドと並びは前と同じです。
- 流れの図の型（`ioFlow.ts`）は、中核が必ず送る形に合わせ、レーンの `translation` と `targets` を省略できないものにしました。宣言だけで、実行時に確かめるのは前と同じく `useIoFlow` の型ガード（2 つのレーンがあること）だけです。

3（`app/main_page`）は 2 回に分けます。1 回目で、サイドバー（言語の設定、メインのスイッチ）、上のバー（クイック設定のメニュー）、言語の一覧、`RealtimeControls` を移しました。

- メニューや一覧の外を押したかどうかの判定は、共有の型 `TargetHolder`（`logics/common/targetHolder.ts`）で尋ねます（下の「型の厳しさ」）。
- 言語の欄がどちら側かは、ユニオン型（`LanguageSelectorKey`）で受け取ります。
- `useVoice.ts` の型を中核が送る形に直しました。直接音声の入力の一覧の行は識別子とラベルの組（`VoiceSourceRow`）で、直接音声の状態には `output_route` と、保存した設定の RVC のフィールド（`DirectVoiceSettings`）を宣言しています。宣言だけで、実行時には確かめません。

2 回目で、会話の列（ログ、入力欄、文字数の警告、ログの大きさ）、`MainSection`、`MainPage`、`startupContext` と `VrLogWindow` を移しました。

- ログの行が表示する文の型を宣言しました（`docs/spec` の「メッセージ」に合わせた形）。`realtimeCaptionState.ts` の `MessageLogText`、`MessageLogContent`、`TransliterationToken` と `MessageLogRow` のフィールド、`useMessage.ts` の新しいメッセージの型（`NewBackendMessage`）です。宣言だけで、実行時には確かめません。
- 消えた行の空行（`GoneRow<Id>`、`messageLogView.ts`）は元の行の `id` の型を引き継ぎ、ログはそのまま key に使います。
- VR のログの窓が閉じている間に保っておく表示の状態は `SavedLogView` です。
- 入力欄は、メッセージの操作の提供元（`MessageActionsProvider`）の外で描かれたときに名前の付いた `TypeError` で止まります。前も同じ所で止まっていました。
- React 18 の型にない `inert` 属性は、`src-ui/inertAttribute.d.ts` で `inert?: "" | undefined` として宣言しています。ページは隠すときに `inert=""` を書き、それ以外は書きません。
  - 後の変更: React 19 に上げたとき（PR #495）、この宣言は消しました。React 19 の型は `inert` を真偽値で持ち、React 19 は `inert=""` を偽として扱って属性を書きません。ページは `inert={隠すかどうか}` と真偽値で書きます。

5（`app/config_page`）は、ページが使う部品（`setting_box/_components`）とテンプレート（`_templates`）から移します。ページはその props の型の上に移します。1 回目で、`_atoms`（入力欄、プルダウン、ダウンロードのボタン、ページを開くボタン）と、ほかの部品に依存しない小さな部品（ラベル、見出し、説明、ヒント、行、折りたたみ、ページへの案内、保存ボタン付きの入力欄、認証キー、色、操作のボタン、接続の確認、ファイルの置き場、テレメトリーの中身、計算機器の名前）を移しました。

- 部品ごとに props の型を輸出しています（`LabelComponentProps` など）。ページから渡される props を漏らさないように、呼ぶ側をすべて見て決めました。
- 行（`FormRow`）は子の要素から `id` と `aria-describedby` だけを読みます（`RowControlProps`）。
- 入力欄の `focus` と `blur` は、要素がないときは何もしません。描く前には呼ばれないので、前と同じに動きます。

2 回目で、残りの部品（スライダー、しきい値の行、ショートカットの欄、プルダウン、選択肢、言葉のフィルター、書式、組み込みモデルの取得の確認、計算機器、認証情報の組）と、行のテンプレート（`_templates/Templates`）、`_components/index` を移しました。

- 行のテンプレートの props は、行の props（`TemplateRowProps`）と描く部品の props の組み合わせです（`SliderContainerProps` など）。共通の行（`CommonContainer`）は渡された props 全体の型を引数に取り、描く部品をその props から行自身の props を除いたものと照らし合わせます。部品の取り違えは型の誤りになります。
- プルダウンの一覧は `DropdownList`（届くまでは `[]`）、選択肢は `RadioOption` です。選択肢の型を引数に取るので、モデルの選択では各モデルの下の部品がそのモデルの選択肢を受け取ります。
- 組み込みモデルの取得の確認（`LegacyModelDownloadDialog`）は、カタログをこの窓が読むフィールドだけの型（`ReviewCatalog`）として読みます。フックのカタログと同じく、宣言だけで実行時には確かめません。
- 認証情報の組（`CredentialPair`）は、提供元の名前から `current${B}URL` と `current${B}AuthKey` のキーを組み立てて型にしています。

設定のページは区画ごとに移します。1 回目で「機器」（`device/`）と「音声認識」（`transcription/`）を移しました。

- `useRealtimeASR.ts` の型を、フックが読むフィールドだけを並べた形から、中核が送る形の宣言に変えました（`RealtimeAsrSettings` など）。宣言だけで、実行時には確かめません。
- cloud の音声認識のエンジンの `base` は、4 つの値のユニオン型 `CloudTranscriptionBase`（`configs/cloudTranscription.ts`）です。
- 保存のロジック（`useSaveButtonLogic`）が返す欄の値は `unknown` です。ページは、欄が表示するのと同じ文字列にしてから入力欄に渡します（`entryText`）。

2 回目で、音声のページ（「読み上げ」の `tts/`、`rvc/`）と、詳細設定のうち音声とモデルのもの（`VoiceSettings`、`DirectVoiceSettings`、`VoiceAudition`、`SpeechServers`、`StatusLine`、`EngineCatalog`、`VcRuntimeSetup`、`ModelDownloads`、`UserModels`）を移しました。

- フックが中核から受け取る値に宣言の型を付けました。`useModelDownloads` のカタログの行（`ModelCatalogRow`）とジョブ、`useVoice` の音声の設定（値はすべて文字列）、出力機器、モデルが受け付けるシード値の範囲と指示、エンジンの声、`useSpeechServers` のプロファイルと機器、`useVcRuntimes` のカタログとジョブです。宣言だけで、実行時には確かめません。
- `ModelDownloads` の `reserve` と `only` は省略できる props です。組み込みモデルの取得の確認が渡していた `reserve={undefined}` は外しました。
- 設定がないときは、名前の付いた `TypeError` で止まる関数を通して読みます（`SpeechServers` と `DirectVoiceSettings`）。前も同じ所で止まっていました。

3 回目で、「詳細設定」のページ（`AdvancedSettings`、約 690 行）を移しました。

- 保存のロジックが持つ `unknown` の欄の値は、`fieldValue` と `fieldText` で、React が欄に書くのと同じ文字列にしてから渡します。
- 書き込みへの応答は、バックエンドが応答を返したときだけ読みます（`answerOf`）。TLS の組のエラーコードは文字列のときだけ使い、それ以外は前と同じく `save_unconfirmed` です。

4 回目で、「翻訳」のページ（`Translation`、約 970 行）と、翻訳のカタログ、ローカルの翻訳の GPU 版の取得（`TranslationGpuRuntimes`）を移しました。`TranslationGpuRuntimes` は、取得の部品（`VcRuntimeSetup`）とカタログに型が付いたので、書き換えずに移せました。develop の #703 で足された llama.cpp のサーバーの取得（`TranslationLlamaRuntimes`）も、develop を取り込んだときに同じ PR で移しました。カタログが `onInstalled` を渡すので、その props に型を付けています。

- カタログの項目は、属するグループと組にしてカードに渡します（`CatalogEntry`）。
- ユーザーが足したモデルの行には `non_commercial` や `license` がないので、ライセンスの判定と文は、そのフィールドがあるときだけ読みます。
- 試験が正規表現で読む定義（`EXTERNAL_API_PROVIDERS`、`LOCAL_LLM_PROVIDERS`、`ENGINE_GROUPS`）の書き方は変えていません。

5 回目で、残りのページ（VR の字幕の `vr/`、チャット読み取りの `ocr/`、見た目、共有の行、VRChat、ホットキー、このアプリについて、更新）を移しました。

- VR の字幕のページは、書き込みにバックエンドが答えたオーバーレイのログの設定を、1 か所の宣言（`answeredSettings` のオーバーロード）で受け取ります（下の「型の厳しさ」）。
- 選択肢（`RadioButton`）の `id` は `string | number` を受け付けます。フローの帯の件数（1〜3）が数値の id のまま比べられ、そのまま返されるためです。`selectFunction` の引数は、渡した選択肢の id の型です。
- チャット読み取りのモデルの取得は、カタログをこのページが表示するフィールドだけの型（`OcrCatalogModel`）として読みます。宣言だけで、実行時には確かめません。
- 試験がページのファイルを読む条件は `/\.(jsx|tsx)$/` に広げました。

6 回目で、設定画面の枠（`ConfigPage`、`SettingSection`、`SettingBox`、`setting_box/index`、設定のメニュー、検索、上のバーと保存バー、版の表示）を移し、`app/config_page` が済みました。

- `setting_box/index.ts` は拡張子なしで再輸出します（`app/others/index.ts` と同じ）。
- 開いたタブと設定を開いたボタンへフォーカスを戻すのは、要素が `focus()` を持つときだけです（型ガード `focusable`）。
- 離れるときの確認（`vrct:settings-leave`）の `detail.proceed` は、関数のときだけ受け取ります。設定のフォーム（`useSettingsDraft` の `leaveAction`）と同じ読み方です。

### 第 7 段：試験とハーネス

試験のファイルと `src-ui/logics/test/` のハーネスを TypeScript にしました。試験は Vitest で動きます（[development.md](development.md) の「UIの試験（Vitest）」）。試験を TypeScript にするまでは、次のように扱っていました。

- ソースを移す PR では、試験のうち移したファイルを名指しする行だけを書き換えます（`./saveBar.js` を `./saveBar.ts` にするなど）。試験の書き方、実行の方法、ハーネスの API は変えません。
- ソースを文字列として読んで書き換えてから読み込む試験（`useStdoutToPython.test.js`、`languageMutations.test.js`）は、`node:module` の `stripTypeScriptTypes` で型を消してから import の行を書き換えます。型だけの import は消えるので、書き換えるのは値の import です。
- ハーネスの `loadModule` は `.ts` と `.tsx` を、Vite の変換を通して読み込みます（`harnessModules.ts`）。型だけの import（`import type`）は消えるので、モックは要りません。依存の指定に拡張子がなくても、対応するモックを見つけます。

ハーネスの 4 本（`hookHarness`、`bridgeHarness`、`vitestSetup`、`vrPanelStateScan`）を先に移しました。試験はこの上に、まとまりごとの PR で移します。

- 試験と基盤は Node で動くので、型は `tsconfig.test.json` で検査します。Node の型（`@types/node`）を読むのはこの設定だけで、アプリのソースを検査する `tsconfig.json` からは試験と基盤を外しました。`npm run typecheck` は両方を走らせます。
- 試験にも、アプリのソースと同じ規則（`strict`、`any` と二重のキャストと `@ts-...` を使わない）を当てます。`test_typescript_strictness.py` が試験も数えます。
- `loadModule<M>` は、試験が名指すソースのモジュールの型（`typeof import("./Foo.tsx")`）を返します。読み込んだソースの輸出がその型を持つことは、`hookHarness.ts` の `loaded` のオーバーロードの 1 か所で宣言しています。確かめはしません。
- 描いた木（`find` が探すもの）の節は React の要素（`ReactElement`）として扱います。木の中のオブジェクトはどれも要素なので、`hookHarness.ts` の `asNode` の 1 か所でそう宣言しています。要素の `props` は React の型のとおり、渡された値をそのまま持ちます。
- フックの記憶（`useState` などのスロット）は、同じ順で同じフックが使うので、そのフックの型の値を持ちます。`hookHarness.ts` の `held` の 1 か所でそう宣言しています。
- `@babel/standalone` には型がないので、基盤が使う `transform` だけを `src-ui/logics/test/babelStandalone.d.ts` で宣言しています。
- 試験がコードに渡す値のうち、宣言された型を持たないもの（コードが読むフィールドだけを持つ試験用の値と、コードの振る舞いを見るためにわざと渡す形の違う値）は、`hookHarness.ts` の `unchecked<T>()` を通します。どちらなのかは、呼ぶ所に書きます。試験の中でキャストは使わず、この 1 か所で宣言します。

試験の 206 本は、ハーネスの上にまとまりごとの 9 本の PR（#749〜#757）で移しました。どの試験も、名前、入力、確かめる値、件数は変えていません（Vitest は 207 ファイル、1569 件で、移す前と同じ）。

- 見つけた節を読む前に `assert.ok` で確かめる所が増えました。前に `null` を読んで `TypeError` で落ちていた所が、同じ所で `AssertionError` で落ちます。
- 移した直後の `unchecked` は約 200 か所で、2 つの使い方のほかに、描いた木から取り出した部品を描く所や、要素の `ref` を読む所にも使っていました。また、見つけた節を確かめる関数やロケールを読む関数などが、試験のファイルごとにありました。区画を並行して移したためです。
- 2026-11-20 の決定で、これらをハーネスに寄せました。`unchecked` は 2 つの使い方（`Test data:` と `On purpose:` のコメントを付ける）だけに残し、90 か所になりました。ハーネスの補助関数は下の「試験のハーネス」にあります。

### 第 8 段：仕上げ

- `tsconfig.json` から `allowJs` を外します。第 7 段までで、`src-ui` のソースと試験、`locales` の 2 本（`config`、`@useI18n` が指す `useI18n`）はすべて TypeScript になったので、着手できます。リポジトリの直下の設定（`vite.config.js`、`vitest.config.js` など）と `tools/` のスクリプトは、型検査の対象の外です。
- 型の検査を段階的に強めます。候補は `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitReturns`、`noUnusedLocals`、`noUnusedParameters` です。1 つずつ有効にし、出たエラーを直してから次に進みます。
- lint は ESLint をやめて Biome にしました（`biome.json`、[開発ガイド](development.md#uiのlintと整形biome)）。`.eslintrc.json` は外しました。

## 型の厳しさ

- `tsconfig.json` は `strict` です。TypeScript のファイルだけを検査し、JavaScript のファイルは型を推論して読むだけです。
- `tests/devtools/test_typescript_strictness.py` は、`src-ui` の TypeScript のファイルにある `any`、`as unknown as`、`@ts-ignore`、`@ts-nocheck`、`@ts-expect-error` を数えます。まだ外せないものは、ファイルごとの数を `ALLOWED` に書きます。数が増えても減っても失敗するので、外したら一覧も減らします。
- DOM の要素を扱うところでは、型を決めつけるキャストの代わりに型ガードで確かめます。たとえば `Element` には `focus()` がないので、`useConsentDialog` は `focus` を持つ要素だけを `Focusable` として扱います。
- TypeScript は計算したキーを `string` として扱うので、`{ [key]: value }` が名前 `K` のキーを持つことを確かめられません。ストアでは `field()` のオーバーロードで 1 か所だけそう宣言しています。名前を 1 つずつ渡すので成り立ちます。
- 同じ理由で、設定の一覧（`ui_config_setter.ts`）に 2 か所の宣言があります。どちらも `SETTINGS_ARRAY` の項目からループで作るフィールドや atom の型で、TypeScript はその名前を追えません。
  - `buildCategoryApiFromSettings` のオーバーロードは、設定のフックが返すフィールドが `CategoryApi` のとおりであることを宣言します。フィールドを作る `useSettingsLogics` と、型を組み立てる `CategoryApi` は同じ項目から名前を作ります。
  - `useSettingValue` のオーバーロードは、設定の atom の値が `SettingValues` の型であることを宣言します。atom は `satisfies` で確かめた既定値から始まり、その設定のフックだけが書き込みます。
- 計算したキーについては、これ以外の場所で宣言を増やしません。同じ形が要るときは `field()` か、この 2 つの型（`CategoryApi` と `SettingValues`）を使います。
- メニューや一覧の外を押したかどうかの判定は、`logics/common/targetHolder.ts` の `TargetHolder`（`contains(target: EventTarget | null)`）で尋ねます。DOM の型ではイベントの対象が `EventTarget` で、`Element.contains` は `Node` しか受け取りません。メソッドの引数は両方向で照らし合わされるので、要素はそのまま `TargetHolder` に代入でき、対象を絞らずに尋ねられます。押されるのはページの要素なので成り立ちます。同じ判定にはこの型を使い、同じ形の宣言を増やしません。
- 下書きのフック（`useSettingsDraft.tsx`）の `answeredValue` も確かめられない宣言です。書き込みにバックエンドが答えた値を、保存した値と同じ型（`T`）として受け取ります（`savedFromResponse` があればその戻り値）。atom の値と同じく、宣言だけで確かめません。
- VR の字幕のページ（`Vr.tsx`）の `answeredSettings` も同じ宣言です。書き込みにバックエンドが答えた設定を、オーバーレイのログの設定（`OverlayLogSettings`）として受け取ります。
- `src-ui/cssProperties.d.ts` は、React の `CSSProperties` に `--` で始まる名前を足しています。インラインの style で CSS のカスタムプロパティ（`--checkbox-size` など）を渡すときに、`as CSSProperties` は要りません。
- `src-ui/i18next.d.ts` は、i18next の型の設定 `strictInterpolationChecks` を切っています。i18next 27 でこの設定が既定で有効になり、`t(key)` と `t(key, options)` が別のシグネチャになりました。ロケールのファイルは実行時に読む YAML なので、i18next はメッセージがどの変数を取るかを知らず、この検査では変数を確かめられません。切ると `t` の型は i18next 26 のときと同じになり、画面側の翻訳の型（`t(key, options?)` の 1 つの関数）にそのまま渡せます。
- バックエンドの応答を受け取るフックの引数の型は、中核が送る形の宣言です。応答を受け取ってフックに渡す側（`useReceiveRoutes`）は、確かめずに渡します。経路の表が文字列で名指すフックと関数に `result` を届いたまま渡すことは、`useReceiveRoutes.ts` の型ガード `isCallable`（`(...args: unknown[]) => unknown`）の 1 か所で宣言しています。確かめるのは関数であることだけで、前と同じです。400 応答の `data` を設定に書き戻すときは、`_useBackendErrorHandling.ts` の `keptValue` のオーバーロードで、渡す先の `update…` の型として宣言します。VR パネルの入口（`VrApp.tsx`）がメインウィンドウから届いた値を同じ名前の atom に書き込むことは、型ガード `isMirroredAtom` で宣言します。確かめるのは atom があることだけで、前と同じです。前からフックが確かめていた値だけは、フックの中の型ガードで確かめます。設定のフックの `updateFromBackend…`、`setSuccess…`、`deleteSuccess…` も同じです。ただし `response_transform` で一覧を別の形に変える設定は、変える前に受け取った値が一覧であることを確かめます。
- 設定のフックは型の付いたフィールドを返します。`views` の TypeScript が型のなかったころに書いた `as { ... }` は、第 6 段で外しました。

## 試験のハーネス

試験（`*.test.ts`）にも、アプリと同じ規則を当てます（2026-11-20 の決定）。`strict` で、`any`、二重のキャスト、`@ts-...` を使いません。型で確かめられない所は、ハーネス（`src-ui/logics/test/`）の補助関数の中で 1 か所ずつ宣言し、試験の中ではキャストを使いません。

- 宣言の場所は次のとおりです。どれもオーバーロードで宣言し、実行時には確かめません（`componentOf` と `componentNamed` は、関数であることだけを確かめます）。
  - `hookHarness.ts`
    - `loaded`: 読み込んだソースの輸出が、試験の名指すモジュールの型を持つ
    - `asNode`: 描いた木の中のオブジェクトは要素である
    - `held`: フックのスロットは、そのフックの型の値を持つ
    - `unchecked`: 試験がコードに渡す、宣言された型を持たない値
    - `asComponent`（`componentOf`、`componentNamed` の中）: 試験が自分で描く部品が、渡す props を受け取り、読む木を返す
    - `timerHandle`、`asTimerFunction`: 偽のタイマーの id は番号で、偽物は大域のタイマーの代わりになる
  - `bridgeHarness.ts`
    - `settingAtom`: 登録簿の設定の atom は、設定の状態のプリミティブな atom である
- `unchecked` は 2 つの使い方だけに使います。(1) コードが読むフィールドだけを持つ試験用の値、(2) コードの振る舞いを見るためにわざと渡す形の違う値。呼ぶ所に、`Test data:` か `On purpose:` で始まるコメントを置きます。ほかの用途には、下の補助関数を使います。
- 試験が繰り返し使う補助関数はハーネスにあります。
  - 木を探す: `find`、`findIn`（見つからなければ失敗）、`nodesIn`、`treeNode`、`componentName`
  - 部品を描く: `componentOf`、`componentNamed`、`draw`、`drawWith`。`ref` を受け取る部品も、React 19 では `ref` が props の 1 つなので、ほかの部品と同じに描きます
  - 要素の `ref`: `refOf`、`setRef`
  - 型の分からない値を読む: `isRecord`、`fieldOf`
  - 偽のタイマー: `timerHandle`、`timerNumber`、`asTimerFunction`
  - ロケール（`locales.ts`）: `readLocale`、`localeAt`、`textAt`、`branchAt`。言語のファイルが文字列と対応表だけでできていることを、読むときに確かめます。
  - 通知と設定の atom（`bridgeHarness.ts`）: `Notice`（本文は `ReactNode`、オプションは `NotificationOptions`）、`noticeText`、`settingAtom`
- 型だけを使うパッケージ（`@types/node`、`@babel/types`）は、開発用の依存に書きます。

## 移すときの手順

この節は記録です。`src-ui` と `locales` に JavaScript は残っていないので、移すファイルはもうありません。import の拡張子は、いまは[開発の手引き](development.md#uiのtypescriptとスタイル移行中)の決まり（相対 import は `./name.ts` のように拡張子まで書く）に従います。下の 3 の「拡張子なしにします」は、その決まりができる前の手順です。

1. 移すファイルを `git mv` で `.ts`（JSX を含むなら `.tsx`）にします。
2. 型を付けます。外から受け取る値（バックエンドの応答、設定、DOM）には、確かめないまま狭い型を付けません。
3. 参照を書き換えます。
   - ビューやほかのソースの import は、拡張子なしにします（Vite が `.ts` を見つけます）。
   - Node でそのまま読む試験の import と、ハーネスの `loadModule(new URL(...))` は、`.ts` にします。
   - Python の試験や `tools/` がパスを指していないかも確かめます。
4. `python tools/dev.py check --scope ui` と `python tools/dev.py check --scope tooling` を実行します。
