# Architecture decision records (ADR)

[日本語版](#adrアーキテクチャ決定記録日本語版)

The authoritative copies of ASTAROT's architecture decision records (ADRs) are in this directory and nowhere else. This page is their index. New ADRs go here too.

- Numbers are sequential. A number that has been used is never reused, and the file name (`adr-NNN-<short English name>.md`) is not changed later either.
- For the current state, the front matter at the top of each ADR is authoritative. The Status line in the body stays as a record of the time of writing.
- The body of an ADR records the decision and its premises at the time of writing. When the situation changes later, the body is not rewritten; the change is shown in the front matter, in notes or in a later ADR.

## Index

The index table is generated from the front matter of each ADR by `python tools/adr_catalog.py --write`. Do not edit it by hand. It appears once, in [the Japanese version](#一覧), with its column headings and labels in Japanese: 題名 is the title, 日付 the date, 状態 the status, 実装 the implementation status, 有効性 the validity and 時代 the era.

The meaning of each column is in [Fields and values](#fields-and-values). When you read an old ADR, look at the era (時代) and the validity (有効性) first.

## Writing a new ADR

1. Copy [TEMPLATE.md](TEMPLATE.md) and create `adr-NNN-<short English name>.md`, using the number after the last one in the index.
2. Fill in the front matter. Set any value you have not checked to `unknown`; do not fill it in with a guess.
3. Regenerate the index table with `python tools/adr_catalog.py --write` (`mise run adr`). The `tooling` part of `python tools/dev.py check` runs `--check`, which checks for duplicate numbers, the fields and values, the `evidence` paths, links and a stale index.
4. Keep changes to the substance of a decision and changes that only move files or touch metadata in separate pull requests.

Write the text by the rules of the [ADR authoring guideline](authoring.md): where references go, facts and evidence, how fine-grained a decision is, and writing.

When you update an ADR later, do not rewrite the body either. When the implementation moves forward, update `implementation_status`, `implementation_checked` and `evidence`. When the decision changes, write a new ADR and update `validity` and `superseded_by` of the old one.

## Fields and values

The front matter uses only part of YAML: `key: value` lines, and lists made of consecutive `  - item` lines. When a value contains `: ` or ` #`, or starts with a symbol, put the value in double quotes. Do not write comments or blank lines.

| Field | When it is needed | Content |
|---|---|---|
| `date` | Required | The day the decision was written (`YYYY-MM-DD`): the date in the original's Date or Status line |
| `status` | Required | The state of the decision |
| `era` | Required | The premises at the time of writing (the background of the period) |
| `validity` | Required | Whether the decision still holds |
| `validity_note` | When `validity` is `implementation_changed` or `replaced` | What changed, and what took over |
| `superseded_by` | When `status` is `superseded` or `validity` is `replaced` | The ADR that replaced it (`ADR-NNN`) |
| `implementation_status` | Required | The result of checking the implementation |
| `implementation_checked` | When `implementation_status` is `pending`, `partial` or `implemented` | The day the implementation was checked |
| `implementation_note` | When `implementation_status` is `partial` | What remains, and what has not been checked |
| `evidence` | Can be left out only when both `validity` and `implementation_status` are `unknown` | The files that support the values, as paths inside the repository |

### status (state of the decision)

| Value | Shown in the index as | Meaning |
|---|---|---|
| `proposed` | 提案 (proposed) | Proposed, but adoption has not been decided |
| `accepted` | 採用 (accepted) | Adopted |
| `rejected` | 不採用 (rejected) | Considered and not adopted |
| `superseded` | 置き換え済み (superseded) | Decided to be replaced by a later ADR. Set `validity` to `replaced` and fill in `superseded_by` |
| `deprecated` | 廃止 (deprecated) | Dropped without a replacement |

Change `status` to `superseded` or `deprecated` only when the maintainers have decided so. When a later ADR has only taken over the decision in practice, leave `status` as it is and set `validity` to `replaced` (ADR 003 is such a case).

### implementation_status (state of the implementation check)

| Value | Shown in the index as | Meaning |
|---|---|---|
| `pending` | 未着手 (not started) | The implementation has not started |
| `partial` | 一部 (partial) | Only part of the decision is implemented, or it works only on some OSes or routes |
| `implemented` | 実装済み (implemented) | The scope of the decision is implemented. This does not mean that every acceptance on real hardware is done |
| `not_applicable` | 対象外 (not applicable) | The decision itself asks for no code change (a development principle, a deferred choice and so on) |
| `unknown` | 未確認 (not checked) | Not checked |

`status` and `implementation_status` are decided separately. Do not set `implemented` only because the ADR is `accepted`. When you have checked the implementation, set `implementation_checked` to that day and add the files you checked to `evidence`. Write the checks that remain in `implementation_note`.

### validity (whether the decision still holds)

| Value | Shown in the index as | Meaning |
|---|---|---|
| `current` | 有効 (current) | Both the principle of the decision and the implementation method written in the body still apply |
| `implementation_changed` | 実装の方式が変わった (implementation changed) | The principle of the decision still holds, but the implementation method written in the body (language, process layout, APIs used and so on) has changed |
| `replaced` | 置き換えられた (replaced) | A later ADR replaced the decision. For the current decision, read the ADR in `superseded_by` |
| `unknown` | 未確認 (not checked) | Not checked |

### era (background of the period)

| Value | Shown in the index as | Meaning |
|---|---|---|
| `python-sidecar` | Python のサイドカー (Python sidecar) | At the time of writing, the backend was the Python sidecar. This was the setup up to 0.4.x, and the ADR was written before the change that made the Rust core the only backend (2026-11-16, `8f186f6c`) |
| `rust-core` | Rust の中核 (Rust core) | At the time of writing, the Rust core (`native/core`) was the only backend (the setup since 0.5.0) |

ADRs from the `python-sidecar` era sometimes describe the implementation by Python module names or `src-python/` paths. The current implementation can be looked up in the tables that map Python to Rust in the README of each crate in `native/`. When a new era value is needed, add it to this table and to `ERA` in `tools/adr_catalog.py` at the same time.

## Summary of each ADR

ADR 001 to 003 were adopted on 2026-10-27 for the first voice stage (P1). They were first written in a single file, `docs/voice-stack/decisions.md`, and were split into one file each on 2026-11-18.

[ADR 001: External speech.cpp and an independent voice worker](adr-001-external-speechcpp-and-voice-worker.md) decided to connect TTS to an external speech.cpp over HTTP and to add no inference library, torch or model weights to the app. The PCM stream is played only after its format is validated, and requests are not resent automatically.

[ADR 002: Output and lifetime](adr-002-output-and-lifetime.md) decided to run HTTP and device operations on the worker, and to handle settings changes and stops with a cancel signal and by discarding the queue. There is no fake resampling, and audio is not sent to a different device after a reconnect.

[ADR 003: VC selection deferred](adr-003-voice-conversion-selection-deferred.md) decided to defer the choice of VC and to start from a contract with an external process and a virtual device. The candidates were VCClient and Seed-VC Realtime, and the VC engine and models are not bundled. Later, VC was settled on an in-house implementation, which is registered as an exception in section 6.1 of [ADR-012](adr-012-audio-ai-runtime-consolidation.md) (the status note at the top of ADR 003).

[ADR 004: Choose the boundaries of external inference and audio routes conditionally](adr-004-audio-integration-boundaries.md) is a proposal from the design evaluation of 2026-10-27. It does not replace the history of 001 to 003; it records a comparison of three options, the conditions that would reverse adoption and the PoCs not yet run. It does not mean a new implementation or approval for adoption.

[ADR-005: Virtual microphone lifetime and persistent mute](adr-005-managed-microphone-lifetime.md) was adopted on 2026-10-27 as the Linux implementation for source checkouts.

[ADR-006: Separate the connection check of external input from the VC conversion state](adr-006-external-source-health.md) was adopted on 2026-10-28 as a groundwork implementation that needs no model.

[ADR-007: Route translated speech through voice conversion](adr-007-translated-speech-through-voice-conversion.md) was proposed on 2026-11-14, and adopted and implemented the same day. It describes the design that feeds TTS audio into the input of RVC and Seed-VC so that the translation reaches others in the converted voice, and the reasons for separating mute from suppression of direct voice.

[ADR-008: Use external speech synthesis engines (VOICEVOX family, COEIROINK) for text to speech](adr-008-external-speech-engines.md) was adopted on 2026-11-15 and implemented in 0.3.0 (#272, #313). The app connects over loopback HTTP to VOICEVOX, SHAREVOX, AivisSpeech and COEIROINK v2 installed by the user, and speaks Japanese through them. The engines and voices are neither bundled nor downloaded.

[ADR-009: On Windows, rely on an external driver for the virtual microphone, and disclose the dependency in the Microsoft Store](adr-009-virtual-microphone-and-store.md) was adopted on 2026-11-15. MSIX cannot install drivers, and signing a driver of our own or redistributing an existing driver also comes with conditions, so VB-CABLE and similar drivers are not bundled. In the Store, following policy 10.2.4, the dependency is disclosed at the start of the description and in the certification notes, and the app supports the installation with detection at first start, guidance, re-detection and a self-diagnosis (implemented in 0.4.0). The underlying constraints are collected in [Platform constraints](../voice-stack/platform-constraints.md).

[ADR-010: Frontend stack (keep React and Vite, adopt TypeScript and vanilla-extract)](adr-010-frontend-stack.md) was adopted on 2026-11-15, with a staged move toward 0.5.0. React and Vite stay as they are; Vite+ was passed over, with the conditions for re-evaluating it kept. TypeScript types are added starting from logics, styles move from SCSS Modules to vanilla-extract, and Radix UI is the base for UI components. UI changes for 0.4.0 are made on the current stack.

[ADR-011: The ASTAROT name, a unified brand and multimodal accessibility as product policy](adr-011-astarot-brand-and-multimodal-accessibility.md) was adopted on 2026-11-16 as a product policy and brand specification. It set ASTAROT as the new name and "Speech, Translation, Accessibility, Revoicing & OCR Toolkit" as the official subtitle. The master files of the logo and icons are in `docs/brand/astarot/`. Of the display migration (P1), the app's display went into develop for 0.5.0. The identifier migration (P2) was decided in ADR-014 and has been moving in steps since 0.6.0. Identifiers such as the executable name and the app ID still use the VRCT-VOX name ([names and storage locations](../voice-stack/project-rename.md)).

[ADR-012: Audio AI Runtime Consolidation](adr-012-audio-ai-runtime-consolidation.md) was adopted on 2026-11-17 as a development principle. A new audio AI model comes in first as an upstream contribution to speech.cpp. An inference engine or standalone runtime specific to VRCT-VOX is adopted only after confirming both a technical reason that the existing base cannot do the job and a clear advantage in performance, maintenance and distribution cost. The responsibilities per function were split as follows: audio AI inference (ASR, TTS, VAD, speaker, speech enhancement) goes to speech.cpp, OCR and local translation to ONNX Runtime, audio input/output and non-AI DSP to Rust and OS features, and app-specific control such as captions and OSC to the app. RVC continues on its ONNX Runtime implementation as a managed exception, and moving it is not required. The ADR also sets the procedure for evaluating new models, what an exception ADR must contain, non-functional requirements, verification and the conditions for revisiting.

[ADR-013: Keep API keys in the OS credential store](adr-013-secret-store.md) was adopted on 2026-11-18. It moves the storage of the `SECRET_SETTINGS` items (API keys, the Papago Client ID) from `secrets.json` (DPAPI on Windows, plain text with mode 0600 on Linux) to Windows Credential Manager and the Secret Service on Linux. It was chosen over keeping things as they were and over encryption with a key the app manages, because it removes plain text on Linux and gives both OSes the same kind of protection. The migration is staged and moves only the items that could be read back, so a failure does not lose a key. The work was done in Issue #575, which also settled the 4 decisions still open at that point (environments without a Secret Service, `secrets.json` after the migration, store failures and an unreadable `secrets.json`). Each took the side that loses no key and adds no plain text, and they are written in ADR-013's section on decisions made during the work.

[ADR-014: Align internal identifiers with ASTAROT and carry over settings and models](adr-014-internal-identifier-migration.md) was adopted on 2026-11-19. It is P2 of ADR-011. In 0.6.0 it moves the app ID, the storage locations, the Windows install location and registry keys, the executable name, the Linux packages and audio routes, the credential names, the environment variables and the release file names to ASTAROT's names. The decision items follow the decisions in Issue #635. Moving the Windows install location and changing the registry keys are the opposite of the options recommended in #635. Both come together with migration handling (moving the folder, and reading the old keys and moving them to the new ones). When something cannot be moved, the app keeps working with the old location and name, and the old names are read throughout 0.6.x. The destinations of the update check and telemetry, the ID of the chat box detection model, and the settings, IPC and OSC contracts do not change. The implementation is done in 0.6.0, split into 12 PRs.

[ADR-016: Build the user-facing site on Rspress (React) instead of VitePress](adr-016-user-guide-site-on-rspress.md) was adopted on 2026-11-20. Of the decisions in the site redesign (PR #701), it replaces only the premise of keeping VitePress as the base and building components in Vue. The app's UI and shadcn/ui, which the components are being brought in line with, are React, so components and know-how are unified on React. The URLs and anchors that released apps open, English and Japanese, full-text search and publishing to GitHub Pages are kept. Rspress serves the default language's pages without a prefix, so a default language that handles only `/` is set up to keep `/ja/` and `/en/`.

[ADR-017: Write tests from the screen through the core as Playwright integration tests, and call only tests on the distributed app E2E](adr-017-integration-tests-through-the-core.md) was adopted on 2026-11-20. Tests are split into 3 layers: unit and contract (Vitest and Rust), integration tests and E2E. An integration test operates the screen, goes through the core and the Rust crates, and checks everything up to the outward exits and the result on the screen. Integration tests are written with Playwright in `tests/integration/` and run on every PR on Linux and Windows, in Chromium and WebKit. On the screen side, Tauri's official fake sends only the exchanges with the core to the host; on the core side, a crate dedicated to the test tooling starts the core with a fake `Services`. E2E means only tests that go through the shell and the OS in the form of the release build.

[ADR-018: Talk AI connects to external conversation services, and the app does not run conversation models](adr-018-talk-ai-through-external-services.md) was proposed on 2026-11-22 and adopted the same day (PR #969). It splits the counterpart of "Talk AI" in Issue #388 into cloud realtime APIs (OpenAI Realtime, Gemini Live) and a vLLM-Omni server that the user sets up, and connects both as services outside the app. The app neither bundles nor downloads a conversation model or its inference runtime. This is treated the same as "external translation services and LLM services" in 2.2 of ADR-012, and is not an exception to ADR-012. The app is responsible for consent before the screen and voice are sent, an indicator while sending, control of how much is sent, and not sending once stopped.

[ADR-019: Build VOICEVOX CORE into TTS with a dedicated worker that loads its C API dynamically (an exception to ADR-012)](adr-019-voicevox-core-tts-runtime-exception.md) was adopted on 2026-11-23 (Issue #1061). The product VVM files depend on the proprietary `vv-bin` format and on processing specific to `voicevox_onnxruntime`, and the terms also forbid reverse engineering, so they can be neither converted for speech.cpp and contributed upstream, nor shared with the existing ONNX Runtime (`1.31.0`). So in-app Japanese TTS with VOICEVOX CORE is made a managed exception to ADR-012, with a setup where a thin Rust child process, `astarot-voicevox-worker`, dynamically loads the official `voicevox_core` C API (`0.17.1`, MIT), the stable `voicevox_onnxruntime` release `1.17.3` (CPU build) and the Open JTalk dictionary, all fetched after consent. The first version starts with the CPU only and a representative pack under the standard terms, and does not include VOICEVOX Nemo (`n0.vvm`). The external engine connection of ADR-008 stays alongside it, and the credits are shown on the settings screen, the consent screen, `AboutVrct.tsx` and `NOTICE.md`. Whether to start the full implementation is decided after seeing the measurements of a PoC on real Windows and Linux machines.

## Relocation (2026-11-18)

Until 2026-11-18 the ADRs were in `docs/voice-stack/`. Their subjects had spread beyond voice (the frontend, the brand, secrets and so on), so they were gathered in this directory (Issue #587). The numbers and file names did not change. At the old paths, only pointers to this directory were left.

> **Addendum** (2026-11-18, Issue #587): The pointer pages left at the old paths (`docs/voice-stack/decisions.md` and `docs/voice-stack/adr-004〜013-*.md`) were deleted by the maintainers' decision. Before that, every reference inside the repository had been changed to `docs/adr/`. Links to the old paths no longer open, so look up the new path in the table below.

| Old path | Current path |
|---|---|
| `docs/voice-stack/decisions.md` (ADR 001 to 003 and the index) | [`adr-001-external-speechcpp-and-voice-worker.md`](adr-001-external-speechcpp-and-voice-worker.md), [`adr-002-output-and-lifetime.md`](adr-002-output-and-lifetime.md), [`adr-003-voice-conversion-selection-deferred.md`](adr-003-voice-conversion-selection-deferred.md), this page |
| `docs/voice-stack/adr-004-audio-integration-boundaries.md` | [`adr-004-audio-integration-boundaries.md`](adr-004-audio-integration-boundaries.md) |
| `docs/voice-stack/adr-005-managed-microphone-lifetime.md` | [`adr-005-managed-microphone-lifetime.md`](adr-005-managed-microphone-lifetime.md) |
| `docs/voice-stack/adr-006-external-source-health.md` | [`adr-006-external-source-health.md`](adr-006-external-source-health.md) |
| `docs/voice-stack/adr-007-translated-speech-through-voice-conversion.md` | [`adr-007-translated-speech-through-voice-conversion.md`](adr-007-translated-speech-through-voice-conversion.md) |
| `docs/voice-stack/adr-008-external-speech-engines.md` | [`adr-008-external-speech-engines.md`](adr-008-external-speech-engines.md) |
| `docs/voice-stack/adr-009-virtual-microphone-and-store.md` | [`adr-009-virtual-microphone-and-store.md`](adr-009-virtual-microphone-and-store.md) |
| `docs/voice-stack/adr-010-frontend-stack.md` | [`adr-010-frontend-stack.md`](adr-010-frontend-stack.md) |
| `docs/voice-stack/adr-011-astarot-brand-and-multimodal-accessibility.md` | [`adr-011-astarot-brand-and-multimodal-accessibility.md`](adr-011-astarot-brand-and-multimodal-accessibility.md) |
| `docs/voice-stack/adr-012-audio-ai-runtime-consolidation.md` | [`adr-012-audio-ai-runtime-consolidation.md`](adr-012-audio-ai-runtime-consolidation.md) |
| `docs/voice-stack/adr-013-secret-store.md` | [`adr-013-secret-store.md`](adr-013-secret-store.md) |

The bodies of ADR 001 to 003 are the original text; the only things added in the split were the migration and status notes. ADR 004 to 013 were moved with `git mv`, and the only change made in the move was to the targets of links that the change of directory would have broken. After that, front matter was added to the top of every ADR.

---

# ADR（アーキテクチャ決定記録）（日本語版）

ASTAROT の設計判断の記録（ADR）の正本は、このディレクトリだけにある。このページがその索引である。新しい ADR もここに置く。

- 番号は通し番号である。一度使った番号は使い直さず、ファイル名（`adr-NNN-<英語の短い名前>.md`）も後から変えない。
- いまの状態は、各 ADR の冒頭の front matter が正である。本文の Status 欄は、書いた時点の記録として残す。
- ADR の本文は、書いた時点の判断と前提の記録である。後から状況が変わっても本文は書き換えず、front matter、注記、後続の ADR で示す。

## 一覧

<!-- adr-index:start -->
<!-- 自動生成。手で編集しない。`python tools/adr_catalog.py --write`で更新する。 -->

| ADR | 題名 | 日付 | 状態 | 実装 | 有効性 | 時代 |
|---|---|---|---|---|---|---|
| [001](adr-001-external-speechcpp-and-voice-worker.md) | External speech.cpp and an independent voice worker | 2026-10-27 | 採用 | 実装済み | 実装の方式が変わった | Python のサイドカー |
| [002](adr-002-output-and-lifetime.md) | Output and lifetime | 2026-10-27 | 採用 | 実装済み | 実装の方式が変わった | Python のサイドカー |
| [003](adr-003-voice-conversion-selection-deferred.md) | VC selection deferred | 2026-10-27 | 採用 | 対象外 | 置き換えられた（[ADR-012](adr-012-audio-ai-runtime-consolidation.md)） | Python のサイドカー |
| [004](adr-004-audio-integration-boundaries.md) | Choose the boundaries of external inference and audio routes conditionally | 2026-10-27 | 提案 | 未確認 | 未確認 | Python のサイドカー |
| [005](adr-005-managed-microphone-lifetime.md) | Virtual microphone lifetime and persistent mute | 2026-10-27 | 採用 | 実装済み | 実装の方式が変わった | Python のサイドカー |
| [006](adr-006-external-source-health.md) | Separate the connection check of external input from the VC conversion state | 2026-10-28 | 採用 | 実装済み | 実装の方式が変わった | Python のサイドカー |
| [007](adr-007-translated-speech-through-voice-conversion.md) | Route translated speech through voice conversion | 2026-11-14 | 採用 | 一部 | 実装の方式が変わった | Python のサイドカー |
| [008](adr-008-external-speech-engines.md) | Use external speech synthesis engines (VOICEVOX family, COEIROINK) for text to speech | 2026-11-15 | 採用 | 実装済み | 実装の方式が変わった | Python のサイドカー |
| [009](adr-009-virtual-microphone-and-store.md) | On Windows, rely on an external driver for the virtual microphone, and disclose the dependency in the Microsoft Store | 2026-11-15 | 採用 | 一部 | 有効 | Python のサイドカー |
| [010](adr-010-frontend-stack.md) | Frontend stack (keep React and Vite, adopt TypeScript and vanilla-extract) | 2026-11-15 | 採用 | 一部 | 有効 | Python のサイドカー |
| [011](adr-011-astarot-brand-and-multimodal-accessibility.md) | The ASTAROT name, a unified brand and multimodal accessibility as product policy | 2026-11-16 | 採用 | 一部 | 有効 | Python のサイドカー |
| [012](adr-012-audio-ai-runtime-consolidation.md) | Audio AI Runtime Consolidation | 2026-11-17 | 採用 | 対象外 | 有効 | Rust の中核 |
| [013](adr-013-secret-store.md) | Keep API keys in the OS credential store | 2026-11-18 | 採用 | 実装済み | 有効 | Rust の中核 |
| [014](adr-014-internal-identifier-migration.md) | Align internal identifiers with ASTAROT and carry over settings and models | 2026-11-19 | 採用 | 一部 | 有効 | Rust の中核 |
| [015](adr-015-translation-llm-runtime-exception.md) | Run TranslateGemma translation on a runtime built for LLMs (an exception to ADR-012) | 2026-11-19 | 採用 | 一部 | 有効 | Rust の中核 |
| [016](adr-016-user-guide-site-on-rspress.md) | Build the user-facing site on Rspress (React) instead of VitePress | 2026-11-20 | 採用 | 実装済み | 有効 | Rust の中核 |
| [017](adr-017-integration-tests-through-the-core.md) | Write tests from the screen through the core as Playwright integration tests, and call only tests on the distributed app E2E | 2026-11-20 | 採用 | 実装済み | 有効 | Rust の中核 |
| [018](adr-018-talk-ai-through-external-services.md) | Talk AI connects to external conversation services, and the app does not run conversation models | 2026-11-22 | 採用 | 一部 | 有効 | Rust の中核 |
| [019](adr-019-voicevox-core-tts-runtime-exception.md) | Build VOICEVOX CORE into TTS with a dedicated worker that loads its C API dynamically (an exception to ADR-012) | 2026-11-23 | 採用 | 未着手 | 有効 | Rust の中核 |

<!-- adr-index:end -->

各列の意味は[項目と値](#項目と値)にある。古い ADR を読むときは、先に「時代」と「有効性」を見る。

## 新しい ADR の書き方

1. [TEMPLATE.md](TEMPLATE.md) を写して、一覧の最後の次の番号で `adr-NNN-<英語の短い名前>.md` を作る。
2. front matter を埋める。確かめていない値は `unknown` にし、推測で埋めない。
3. `python tools/adr_catalog.py --write`（`mise run adr`）で一覧の表を作り直す。`python tools/dev.py check` の `tooling` が `--check` を実行し、番号の重複、項目と値、`evidence` のパス、リンク、一覧の古さを確かめる。
4. 判断の内容を変える変更と、ファイルの移動やメタデータだけの変更は、別のプルリクエストに分ける。

文面は [ADR の執筆ガイドライン](authoring.md) の規約（参照の置き場所、事実と根拠、決定の粒度、表記）に従う。

ADR を後から更新するときも本文は書き換えない。実装が進んだら `implementation_status`、`implementation_checked`、`evidence` を直し、判断が変わるなら新しい ADR を書いて、古い ADR の `validity` と `superseded_by` を直す。

## 項目と値

front matter は YAML の一部だけを使う。`キー: 値` の行と、`  - 項目` の行が続くリストである。値に `: ` や ` #` が入るとき、または記号で始まるときは、値を二重引用符で囲む。コメントと空行は書かない。

| 項目 | 必要なとき | 中身 |
|---|---|---|
| `date` | 必須 | 判断を書いた日（`YYYY-MM-DD`）。原文の Date 欄か Status 欄の日付 |
| `status` | 必須 | 判断の状態 |
| `era` | 必須 | 書いた時点の前提（時代背景） |
| `validity` | 必須 | 判断がいまも有効か |
| `validity_note` | `validity` が `implementation_changed` か `replaced` のとき | 何が変わったか、何が引き継いだか |
| `superseded_by` | `status` が `superseded` か、`validity` が `replaced` のとき | 置き換えた ADR（`ADR-NNN`） |
| `implementation_status` | 必須 | 実装を確かめた結果 |
| `implementation_checked` | `implementation_status` が `pending`、`partial`、`implemented` のとき | 実装を確かめた日 |
| `implementation_note` | `implementation_status` が `partial` のとき | 残っていること、確かめていないこと |
| `evidence` | `validity` と `implementation_status` の両方が `unknown` のときだけ省ける | 値の裏付けにしたファイル。リポジトリの中のパスで書く |

### status（判断の状態）

| 値 | 一覧での表示 | 意味 |
|---|---|---|
| `proposed` | 提案 | 提案したが、採用を決めていない |
| `accepted` | 採用 | 採用した |
| `rejected` | 不採用 | 検討して採らなかった |
| `superseded` | 置き換え済み | 後続の ADR で置き換えると決めた。`validity` を `replaced` にし、`superseded_by` を書く |
| `deprecated` | 廃止 | 置き換えずにやめた |

`status` を `superseded` や `deprecated` に変えるのは、保守担当者がそう決めたときだけである。後続の ADR が判断を実際に引き継いだだけのときは、`status` は変えずに `validity` を `replaced` にする（ADR 003 がこれに当たる）。

### implementation_status（実装の確認状況）

| 値 | 一覧での表示 | 意味 |
|---|---|---|
| `pending` | 未着手 | 実装が始まっていない |
| `partial` | 一部 | 決定の一部だけが実装されている。または一部の OS や経路でだけ動く |
| `implemented` | 実装済み | 決定の範囲が実装されている。実機での受け入れがすべて済んだことは意味しない |
| `not_applicable` | 対象外 | 判断そのものがコードの変更を求めない（開発の原則、選定の保留など） |
| `unknown` | 未確認 | 確かめていない |

`status` と `implementation_status` は別々に決める。`accepted` であることだけを根拠に `implemented` にしない。実装を確かめたら、`implementation_checked` をその日にし、確かめたファイルを `evidence` に足す。残る確認は `implementation_note` に書く。

### validity（判断の現在の有効性）

| 値 | 一覧での表示 | 意味 |
|---|---|---|
| `current` | 有効 | 判断の原則も、本文に書いた実装の方式も、いまも当てはまる |
| `implementation_changed` | 実装の方式が変わった | 判断の原則はいまも有効だが、本文に書いた実装の方式（言語、プロセスの構成、使う API など）が変わった |
| `replaced` | 置き換えられた | 後続の ADR が判断を置き換えた。いまの判断は `superseded_by` の ADR を読む |
| `unknown` | 未確認 | 確かめていない |

### era（時代背景）

| 値 | 一覧での表示 | 意味 |
|---|---|---|
| `python-sidecar` | Python のサイドカー | 書いた時点のバックエンドは Python のサイドカーだった。0.4.x までの構成で、Rust の中核を唯一のバックエンドにした変更（2026-11-16、`8f186f6c`）より前に書いた |
| `rust-core` | Rust の中核 | 書いた時点で、Rust の中核（`native/core`）が唯一のバックエンドだった（0.5.0 からの構成） |

`python-sidecar` の ADR は、実装を Python のモジュール名や `src-python/` のパスで書いていることがある。いまの実装は、`native/` の各クレートの README にある Python との対応表で引ける。新しい時代の値が要るときは、この表と `tools/adr_catalog.py` の `ERA` に同時に足す。

## 各 ADR の要約

ADR 001〜003 は、2026-10-27 に音声の最初の段階（P1）のために採用した。もとは `docs/voice-stack/decisions.md` の1つのファイルに書かれていて、2026-11-18 に1件ずつのファイルに分けた。

[ADR 001: 外部speech.cppと独立した音声worker](adr-001-external-speechcpp-and-voice-worker.md)は、読み上げを外部の speech.cpp に HTTP でつなぎ、アプリに推論のライブラリ、torch、モデルの重みを足さないと決めた。PCM のストリームの形式を検証してから再生し、要求を自動で送り直さない。

[ADR 002: 出力と寿命](adr-002-output-and-lifetime.md)は、HTTP とデバイスの操作を worker で行い、設定の変更と停止を取り消しの信号とキューの破棄で扱うと決めた。疑似の resampling はせず、再接続の後に別のデバイスへ流さない。

[ADR 003: VCは選定保留](adr-003-voice-conversion-selection-deferred.md)は、VC の選定を保留し、外部プロセスと仮想デバイスの契約から始めると決めた。候補は VCClient と Seed-VC Realtime で、VC の本体とモデルは同梱しない。その後、VC は自前の実装に決まり、[ADR-012](adr-012-audio-ai-runtime-consolidation.md) の 6.1 で例外として登録した（ADR 003 の冒頭の状態の注記）。

[ADR 004: 外部推論と音声経路の境界を条件付きで選ぶ](adr-004-audio-integration-boundaries.md)
は2026-10-27の設計評価による提案。001〜003の履歴を置換せず、3案の比較、
採用を覆す条件、未実施のPoCを記録する。新しい実装や採用承認を意味しない。

[ADR-005: 仮想マイクの寿命と保持ミュート](adr-005-managed-microphone-lifetime.md)は2026-10-27に、ソースのcheckout向けのLinuxの実装として採用した。

[ADR-006: 外部入力の接続確認とVCの変換状態を分ける](adr-006-external-source-health.md)は2026-10-28に、モデルの要らない基盤の実装として採用した。

[ADR-007: 訳文の読み上げを声の変換に通す](adr-007-translated-speech-through-voice-conversion.md)は2026-11-14の提案で、同じ日に採用して実装した。RVCとSeed-VCの入力へ読み上げの音声を流し、訳文を変換後の声で届ける設計と、ミュートと直接音声の抑制を分ける理由を書いた。

[ADR-008: 外部の合成音声エンジンを読み上げに使う](adr-008-external-speech-engines.md)は2026-11-15に採用し、0.3.0で実装した（#272、#313）。利用者が入れたVOICEVOX、SHAREVOX、AivisSpeech、COEIROINK v2に、ループバックのHTTPで接続して日本語を読み上げる。エンジンと声は同梱も取得もしない。

[ADR-009: Windowsの仮想マイクは外部のドライバに頼り、Microsoft Storeでは依存を開示する](adr-009-virtual-microphone-and-store.md)は2026-11-15に採用した。MSIXはドライバを入れられず、自前のドライバの署名や既存のドライバの再配布にも条件があるので、VB-CABLEなどは同梱しない。Storeではポリシー10.2.4に従って説明文の冒頭と認証ノートで依存を開示し、アプリは初回起動での検出、案内、再検出、自己診断で導入を支える（0.4.0で実装した）。前提の制約は[プラットフォームの制約](../voice-stack/platform-constraints.md)にまとめた。

[ADR-010: フロントエンドのスタック（React と Vite を維持し、TypeScript と vanilla-extract を採用する）](adr-010-frontend-stack.md)は2026-11-15に採用し、0.5.0に向けて段階的に移行する。React と Vite はそのまま使い、Vite+ は見送って再評価の条件を残した。TypeScript は logics から型を付け、スタイルは SCSS Modules から vanilla-extract へ移し、UI 部品の土台に Radix UI を使う。0.4.0 の UI 変更は現行のスタックで行う。

[ADR-011: ASTAROT の名称、ブランド統一、マルチモーダル・アクセシビリティの製品方針](adr-011-astarot-brand-and-multimodal-accessibility.md)は2026-11-16に製品方針とブランド仕様として採用した。新しい名前を ASTAROT とし、正式サブタイトルを「Speech, Translation, Accessibility, Revoicing & OCR Toolkit」と決めた。ロゴとアイコンの原版は `docs/brand/astarot/` に置く。表示の移行（P1）のうち、アプリの表示は 0.5.0 に向けて develop に入れた。識別子の移行（P2）は ADR-014 で決め、0.6.0 から順に移している。実行ファイル名、アプリ ID などの識別子は、まだ VRCT-VOX の名前である（[名前と保存先](../voice-stack/project-rename.md)）。

[ADR-012: Audio AI Runtime Consolidation](adr-012-audio-ai-runtime-consolidation.md)は2026-11-17に開発の原則として採用した。新しい音声AIモデルは、まずspeech.cppへの上流の貢献で入れる。VRCT-VOX固有の推論エンジンや独立したランタイムは、既存の基盤で実現できない技術的な理由と、性能・保守・配布のコストでの明確な優位性の両方を確かめたときだけ採用する。機能ごとの責務の分担は、音声AIの推論（ASR、TTS、VAD、話者、音声強調）がspeech.cpp、OCRとローカル翻訳がONNX Runtime、音声の入出力とAIでないDSPがRustとOSの機能、字幕やOSCなど固有の制御がアプリとした。RVCは管理対象の例外としてONNX Runtimeの実装を続け、移行は義務にしない。新しいモデルの評価の手順、例外のADRに書くこと、非機能要件、検証、見直す条件も定めた。

[ADR-013: API キーを OS の資格情報ストアに保管する](adr-013-secret-store.md)は2026-11-18に採用した。`SECRET_SETTINGS`の項目（APIキー、PapagoのClient ID）の保管先を、`secrets.json`（WindowsはDPAPI、Linuxは0600の平文）から、Windowsの資格情報マネージャーとLinuxのSecret Serviceへ移す。現状維持とアプリが管理する鍵での暗号化を比べ、Linuxの平文をなくせることと、両OSで守られ方が揃うことから選んだ。移行は読み戻せた項目だけを移す段階的な形にし、失敗してもキーを失わない。実施はIssue #575で、そのときに残っていた4つの判断（Secret Serviceのない環境、移行した後の`secrets.json`、ストアの障害、読めない`secrets.json`）も決めた。どれもキーを失わず平文を増やさない側を選び、ADR-013の「実施で決めたこと」に書いた。

[ADR-014: 内部識別子を ASTAROT にそろえ、設定とモデルを引き継ぐ](adr-014-internal-identifier-migration.md)は2026-11-19に採用した。ADR-011 の P2 にあたる。アプリ ID、保存先、Windows のインストール先とレジストリのキー、実行ファイル名、Linux のパッケージと音声経路、資格情報の名前、環境変数、配布物の名前を、0.6.0 で ASTAROT の名前へ移す。判断の項目は Issue #635 の決定のとおりである。Windows のインストール先を移すこととレジストリのキーを変えることは、#635 で推奨した案と逆の決定である。どちらも移行の処理（フォルダーを移すことと、旧のキーを読んで新しいキーへ移すこと）と一緒に入れる。移せないときは旧の場所と名前で動き続け、旧の名前は 0.6.x の間は読む。更新確認とテレメトリの送信先、チャット欄検出モデルの ID、設定と IPC と OSC の契約は変えない。実装は 0.6.0 で行い、12 の PR に分ける。

[ADR-016: 利用者向けのサイトの土台を VitePress から Rspress（React）に替える](adr-016-user-guide-site-on-rspress.md)は2026-11-20に採用した。サイトの再設計（PR #701）の決定のうち、土台を VitePress のままにし部品を Vue で作るという前提だけを置き換える。アプリの UI と、部品を寄せる先の shadcn/ui が React なので、部品と知見を React にそろえる。配布済みのアプリが開く URL とアンカー、日英、全文検索、GitHub Pages への公開は保つ。Rspress は既定の言語のページを接頭辞なしで出すので、`/` だけを受け持つ既定の言語を置いて `/ja/` と `/en/` を保つ。

[ADR-017: 画面から中核まで通す試験を Playwright の結合テストにし、配布物で通す試験だけを E2E と呼ぶ](adr-017-integration-tests-through-the-core.md)は2026-11-20に採用した。試験を、単体と契約（Vitest と Rust）、結合テスト、E2E の 3 つの層に分ける。結合テストは、画面を操作して中核と Rust のクレートを通り、外への出口と画面の結果までを確かめる試験で、Playwright で `tests/integration/` に書き、すべての PR で Linux と Windows、Chromium と WebKit で流す。画面の側は Tauri の公式の偽物で中核とのやり取りだけをホストへ流し、中核の側は試験の道具の専用のクレートが偽物の `Services` で中核を起動する。E2E は、配布物の形で殻と OS を通す試験だけを指す。

[ADR-018: おしゃべりAIは外部の対話サービスにつなぎ、アプリは対話のモデルを動かさない](adr-018-talk-ai-through-external-services.md)は2026-11-22に提案し、同じ日に採用した（PR #969）。Issue #388 の「おしゃべりAI」の相手を、クラウドのリアルタイム API（OpenAI Realtime、Gemini Live）と、利用者が立てる vLLM-Omni のサーバーに分け、どちらもアプリの外のサービスとしてつなぐ。アプリは対話のモデルもその推論のランタイムも同梱せず、取得もしない。ADR-012 の 2.2 の「外部の翻訳サービスと LLM のサービス」と同じ扱いで、ADR-012 の例外ではない。アプリは、画面と声を送る前の同意、送っている間の表示、送る量の制御、止めたら送らないことを受け持つ。

[ADR-019: VOICEVOX CORE を専用ワーカーと C API の動的ロードで読み上げに組み込む（ADR-012 の例外）](adr-019-voicevox-core-tts-runtime-exception.md)は2026-11-23に採用した（Issue #1061）。製品版 VVM は `vv-bin` 独自形式と `voicevox_onnxruntime` 固有処理に依存し、規約上もリバースエンジニアリング禁止のため speech.cpp への変換・上流貢献も既存 ONNX Runtime（`1.31.0`）との共有もできない。そこで VOICEVOX CORE によるアプリ内日本語読み上げを ADR-012 の管理対象の例外とし、薄い Rust 子プロセス `astarot-voicevox-worker` から公式 `voicevox_core` C API（`0.17.1`、MIT）と `voicevox_onnxruntime` 正式版 `1.17.3`（CPU 版）、Open JTalk 辞書を動的ロードする構成を採る。3 つとも同意を得てから取得する。初回は CPU のみ・標準規約の代表パックから始め、VOICEVOX Nemo（`n0.vvm`）は含めない。ADR-008 の外部エンジン接続は並存させ、クレジットは設定画面・同意画面・`AboutVrct.tsx`・`NOTICE.md` に表示する。本実装の着手は Windows・Linux 実機 PoC の計測結果を見て判断する。

## 配置の移行（2026-11-18）

ADR は 2026-11-18 まで `docs/voice-stack/` にあった。対象が音声の外（フロントエンド、ブランド、秘密情報など）に広がったので、このディレクトリに集めた（Issue #587）。番号とファイル名は変えていない。古いパスには、ここへの案内だけを残した。

> **追記**（2026-11-18、Issue #587）：古いパスに残していた案内のページ（`docs/voice-stack/decisions.md` と `docs/voice-stack/adr-004〜013-*.md`）は、保守担当者の判断で削除した。リポジトリの中の参照は、その前にすべて `docs/adr/` へ直してある。古いパスへのリンクはもう開けないので、下の表で新しいパスを引く。

| 古いパス | いまのパス |
|---|---|
| `docs/voice-stack/decisions.md`（ADR 001〜003 と索引） | [`adr-001-external-speechcpp-and-voice-worker.md`](adr-001-external-speechcpp-and-voice-worker.md)、[`adr-002-output-and-lifetime.md`](adr-002-output-and-lifetime.md)、[`adr-003-voice-conversion-selection-deferred.md`](adr-003-voice-conversion-selection-deferred.md)、このページ |
| `docs/voice-stack/adr-004-audio-integration-boundaries.md` | [`adr-004-audio-integration-boundaries.md`](adr-004-audio-integration-boundaries.md) |
| `docs/voice-stack/adr-005-managed-microphone-lifetime.md` | [`adr-005-managed-microphone-lifetime.md`](adr-005-managed-microphone-lifetime.md) |
| `docs/voice-stack/adr-006-external-source-health.md` | [`adr-006-external-source-health.md`](adr-006-external-source-health.md) |
| `docs/voice-stack/adr-007-translated-speech-through-voice-conversion.md` | [`adr-007-translated-speech-through-voice-conversion.md`](adr-007-translated-speech-through-voice-conversion.md) |
| `docs/voice-stack/adr-008-external-speech-engines.md` | [`adr-008-external-speech-engines.md`](adr-008-external-speech-engines.md) |
| `docs/voice-stack/adr-009-virtual-microphone-and-store.md` | [`adr-009-virtual-microphone-and-store.md`](adr-009-virtual-microphone-and-store.md) |
| `docs/voice-stack/adr-010-frontend-stack.md` | [`adr-010-frontend-stack.md`](adr-010-frontend-stack.md) |
| `docs/voice-stack/adr-011-astarot-brand-and-multimodal-accessibility.md` | [`adr-011-astarot-brand-and-multimodal-accessibility.md`](adr-011-astarot-brand-and-multimodal-accessibility.md) |
| `docs/voice-stack/adr-012-audio-ai-runtime-consolidation.md` | [`adr-012-audio-ai-runtime-consolidation.md`](adr-012-audio-ai-runtime-consolidation.md) |
| `docs/voice-stack/adr-013-secret-store.md` | [`adr-013-secret-store.md`](adr-013-secret-store.md) |

ADR 001〜003 の本文は原文のままで、分けるときに足したのは移行と状態の注記だけである。ADR 004〜013 は `git mv` で移し、移すときに変えたのは、ディレクトリが変わって切れるリンクの行き先だけである。その後、すべての ADR の冒頭に front matter を足した。
