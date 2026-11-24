# ASTAROT guide for development agents

[日本語版](#astarot-開発エージェント向けガイド日本語版)

ASTAROT (formerly VRCT-VOX) is a desktop app for VRChat that combines speech recognition (ASR), text to speech (TTS), voice conversion (RVC), chat reading (OCR) and translation. Its React 19 UI runs on Tauri, and the backend is the Rust core (`native/core`), which runs inside the app's process. From 0.5.0 the packages contain no Python. The Python backend (`src-python/`) was removed in 0.6.0. The record of the port is in `docs/voice-stack/core-integration.md`. The app's display name is ASTAROT (ADR-011). The repository was renamed to `kein5/astarot` at the stable release of 0.5.0. The executable names, the app ID and the storage locations for each OS are in `docs/voice-stack/project-rename.md`. The project is derived from [VRCT](https://github.com/misyaguziya/VRCT), and tracking upstream or staying compatible with it is not a goal.

This document is the starting point for work. For details, read the authoritative documents in the table below.

## How to approach the work

- Within the purpose and scope of the request, you may decide on your own which design changes and refactoring are needed and carry them out. The project does not forbid changes to particular files or modules, and does not make approval in advance mandatory.
- This permission does not extend to features the request did not ask for, a complete rebuild or external actions. Keep to the user's instructions, the policies on publishing, sending and distributing, and the license terms.
- Before you start, check the branch, HEAD and uncommitted changes. Do not delete or revert changes you did not make.
- When a document and the implementation disagree, do not decide mechanically that one of them is right. Find out whether the description is only out of date or the implementation breaks a policy it should follow. If you cannot decide, report it as unresolved.
- `docs/voice-stack/` still holds many dated verification records and proposals. Words such as "unreleased" (未公開), "next step" (次工程) and "this time" (今回) refer to the state at the time of writing. Read these documents as distinct from the policies that have been adopted.

## What to read for each kind of change

Reading only what is relevant is enough. You do not need to read everything every time.

| What you change | Read first |
|---|---|
| The product's purpose, the features it must keep, how users use it | `PRODUCT.md` |
| Features, the API (IPC endpoints), data formats, cross-cutting behavior, contracts | `docs/spec/README.md` (regenerate the list with `mise run spec`, which writes the core's `tools/spec_core_catalog.json` and then runs `python tools/spec_catalog.py --write`) |
| The UI's look, operation and accessibility | `DESIGN.md` |
| The development environment, verification commands, commit format | `docs/development.md` |
| English text (documents, UI text, commit messages, pull requests and issues, work reports) | `docs/writing/english-guideline.md` |
| Japanese text (documents, UI text, release notes, pull requests and issues, work reports) | `docs/writing/japanese-guideline.md` |
| Launching, builds, CI, release candidates | `docs/readme_build.md`, `docs/voice-stack/release-candidates.md` |
| Branches, pull requests, dependencies, models offered for download, text the app shows | `CONTRIBUTING.md` |
| Licenses of bundled components, models and dependency libraries | `NOTICE.md`, `docs/voice-stack/licensing.md` |
| The Rust backend core, and the record of the port from Python | `docs/voice-stack/core-integration.md` |
| Names, identifiers, storage locations, the relationship to upstream VRCT | `docs/voice-stack/project-rename.md`, `docs/voice-stack/publication-and-upstream.md`; for the rename to ASTAROT, `docs/adr/adr-011-astarot-brand-and-multimodal-accessibility.md` |
| The model download screens and consent | `docs/voice-stack/model-downloads.md` |
| Linux builds, AppImage, GUI tests on a real machine | `docs/voice-stack/linux-build-pipeline.md`, `docs/voice-stack/appimage.md` |
| Design decisions (ADRs) | `docs/adr/README.md` (the index, what the fields mean, how to write a new ADR) and each ADR. Check an ADR's state in the front matter at its top. |

## Entry points for development and verification

The entry point is `python tools/dev.py`. The versions of Node, Rust, Python, uv and Cocogitto are pinned in `mise.toml`, and `mise install` installs them. Frequent steps are set up as mise tasks (`mise run doctor`, `mise run check`, `mise run check:voice` and others; `mise tasks` lists them), and they run the same `tools/dev.py`. The npm scripts do not carry these shortcuts. They keep only what does not work without npm (Vite, Tauri, Vitest and type checking, plus launching and building the app). Check the list of scopes, the setup steps and the exit codes in `docs/development.md` and with `--help`.

```sh
python tools/dev.py doctor                  # show missing tools and dependencies
python tools/dev.py setup --scope headless  # prepare the dependencies for tests without models
python tools/dev.py check                   # light checks (tooling, node, lint)
```

The tools for UI audits, revising text, checking screens on a real machine, drawing diagrams and similar work are collected in `docs/agent-tools.md`.

After a change, run the light checks and the scope that matches what you changed. When the impact is wide, add more verification.

| What you changed | Also run |
|---|---|
| Python tools and their tests (`tools/`, `tests/voice/`), checks of the packages | `check --scope voice` (in a new Linux checkout, run `python tools/build_voice_gate.py` first) |
| The UI (`src-ui/`) or its text | `check --scope ui` |
| The Rust backend core (`native/core`) and the crates in `native/`, Tauri (`src-tauri/`) | `check --scope rust` (the crates it covers are `NATIVE_CRATES` in `tools/dev.py`; for other crates, `cargo test --manifest-path native/<crate>/Cargo.toml`) |
| Flows from the UI through the core (changes that touch both `src-ui/` and `native/core`), integration tests (`tests/integration/`, `native/browser-core-bridge`) | `check --scope integration` (run `setup --scope integration` first; ADR-017) |
| Several areas, or before a merge | `check --scope all` |
| Commits | `check --scope commits --base origin/develop` |

- Run browser tests, native GUI tests and checks of audio and model inference on a real machine explicitly, by their own procedures. The steps are in the sections of the documents above. The usual `check` does not include them.
- If the display turns off while you test the GUI on a real machine, rendering stops and the cause of the failure is misread. On a Linux desktop, run the tests under `tools/display_power_guard.py` (`docs/voice-stack/linux-build-pipeline.md`).
- When the impact is small, for example when only documents changed, verification may be scaled to match.

## Verification and completion reports

- Passing the light checks does not mean that the full tests or the checks on a real machine passed.
- Report successes, failures, skips, checks not run and missing environments separately. For a failure, add the relevant lines of its output.
- A completion report states these four points:
  - The main points of the change
  - The verification you ran, and its results
  - The verification you did not run, and why
  - Remaining concerns
- Give measured values with the environment and conditions they were measured under. Do not present performance on one PC as a general guarantee.
- Write a report in English following "Agent reports" in `docs/writing/english-guideline.md`, and a report in Japanese following "エージェントの報告文" in `docs/writing/japanese-guideline.md`.

## Commits and the changelog

The rules are the same as for human developers. The table of types, examples, the criteria for sorting changes and the release steps are in "Commit messages" and "Changelog and releases" in `CONTRIBUTING.md`.

- Write commit messages in English as Conventional Commits 1.0.0. The form is `<type>(<scope>)!: <summary>`. The summary is in the imperative, starts in lower case and has no period. Describe what changed in the words of the people it affects.
- Choose the type by what the change does: `feat` when users can do something new, `fix` for a bug users run into, and `feat(dev)`, `ci`, `build`, `chore` and the like for changes to development tools or CI only.
- When a setting, a file format, an IPC or OSC contract, or a supported environment can no longer be used as before, mark it with `!` and a `BREAKING CHANGE:` footer. In the footer, write what users or developers need to do.
- When the type alone would put a commit under the wrong CHANGELOG heading, add a `Changelog: user`, `Changelog: security`, `Changelog: internal` or `Changelog: skip` footer.
- Some environments do not have the commit-msg hook installed. Before you commit, check the message with `cog verify "<message>"`, and also pass `python tools/dev.py check --scope commits --base origin/develop`.
- `CHANGELOG.md` is written by `tools/changelog.py` and lists stable releases only. Do not edit it unless you were asked to prepare a stable release. To fix a section that has been written, first compare it with the output of `python tools/changelog.py print`. Changes in betas go in the notes of the GitHub prerelease, not in the CHANGELOG.
- Do not use `cog bump`. Do not create tags or push them. A tag is created when a maintainer publishes the GitHub Releases draft.
- When asked to prepare a release, set the version in `package.json`, then run `npm run update-version`. For a stable release only, then run `npm run changelog`. Make all of it one commit, `chore(release): version X.Y.Z`.

## Design decision records (ADRs)

`docs/adr/README.md` is the authoritative description of how to write ADRs and what their fields mean. Only the main points are listed here.

- Keep ADRs only in `docs/adr/`. Start a new ADR from `docs/adr/TEMPLATE.md`, and do not reuse a number.
- In the front matter at the top, record the state of adoption (`status`) and the state of implementation checks (`implementation_status`) separately. Do not take `accepted` alone as evidence that something is implemented. Do not make up values that have no evidence; if you have not checked, use `unknown`.
- When you read an old ADR, look first at `era` (the assumptions at the time it was written) and `validity` (whether it still holds, whether only the way of implementing it changed, or whether a later ADR replaced it). The body is a record of the time it was written, so do not rewrite it; show what changed in the front matter, in notes or in a later ADR.
- After you add an ADR or change front matter, regenerate the index table with `python tools/adr_catalog.py --write`. The `tooling` part of `check` runs it with `--check`, which checks for duplicate numbers, fields and values, evidence paths, links and an out-of-date table.
- Put moves of files and metadata-only changes in a separate pull request from changes to what a decision says.

## Skills

Skills that set out work procedures are in `skills/`. `.claude/skills` and `.agents/skills` are symbolic links to `skills/`. When your work matches a skill, read the skill before you go on.

- `adr`: when you write a design decision as an ADR, read one, correct its state or replace it
- `pull-request`: from cutting a branch to merging into develop, including the pull request description, the conditions for merging, stacked pull requests and hotfixes cut from main
- `release`: version bumps, release notes, drafts, publishing, the checks after publishing, and the merge that brings main back into develop
- `jp-writing`: writing and revising Japanese text. Use it every time for release notes.
- `ci-triage`: triaging failing or warning CI checks on pull requests and develop, including Bencher Report alerts, flaky test tracking in Issue #1073, and rerun scope selection

In a clone set up not to create symbolic links (the default of Git on Windows), each link becomes a file that holds one line. In that case, read `skills/<name>/SKILL.md` directly. When a skill and another document disagree, do not decide mechanically that one of them is right; check, then fix it in the same pull request.

## Important existing boundaries

The details are in the authoritative document for each. Only the main points are listed here.

- **External actions**: Contact upstream VRCT, propose that it take changes, or create a pull request for it (drafts included) only when explicitly instructed (`publication-and-upstream.md`). Push, open pull requests, publish Releases and upload to Hugging Face when the request covers it. A Release is published after a maintainer has checked it (`release-candidates.md`).
- **Packages and licenses**: Do not put OCR weights (the upstream chat bubble detection model included), models without permission to redistribute, or the Mia2026 voice into the packages. When you change dependencies or bundled components, check `NOTICE.md` and the license register. List each model offered for download in the catalog (`native/ops/src/downloads/catalog.rs`) with its version, size, SHA-256 and license pinned. Enter the same fields for an OCR model in chat reading's table too (`native/ocr-runtime/src/models.rs`); `native/core/tests/downloads.rs` detects any mismatch. Do not make a model with a restrictive license, such as a non-commercial one, the default.
- **Compatibility**: Do not bulk-replace the internal identifier `VRCT`, the settings format or the IPC and OSC contracts only because of a rename. When you change an identifier such as a storage location or the app ID, also provide a migration (`project-rename.md`).
- **User actions and consent**: Download a model only after showing its license and size and getting consent. Make sure a UI change does not by itself turn on a microphone, download a model, send a message or change an audio route.
- **Audio AI runtimes**: Bring in a new audio AI model first as an upstream contribution to speech.cpp. Add an app-specific inference engine or a separate runtime only when you have confirmed both a technical reason the existing foundation cannot do it and a clear advantage in performance, maintenance and distribution costs, and an ADR for that exception has approved it. The split is: audio AI inference (ASR, TTS, VAD, speaker, speech enhancement) goes to speech.cpp; OCR and local translation to ONNX Runtime; audio input and output and non-AI DSP to Rust and the OS; and control specific to the app, such as captions and OSC, to the app. As a managed exception, RVC keeps its ONNX Runtime implementation, and moving it is not required. The steps, non-functional requirements and verification are in ADR-012 (`docs/adr/adr-012-audio-ai-runtime-consolidation.md`).
- **Stop and independent controls**: Keep the behavior of stop and mute, the separate switches for TTS and RVC, Quick Chat, the VR UI and hotkeys (`PRODUCT.md`, `DESIGN.md`).
- **UI**: Keep the stack of React 19, vanilla-extract, Jotai and i18next. The staged move to TypeScript and Radix UI follows ADR-010, and the conventions for the mixed period are in `docs/development.md`. Do not migrate frameworks or bring in remote fonts. Put the text the app shows in `locales/`, and always update both `en.yml` and `ja.yml`. The text check in `check` (`tools/i18n_gate/check.mjs`) blocks missing keys, interpolation variables that differ and text hard-coded into the UI. Give a reason for any string left untranslated on purpose (`docs/development.md`, section "UIの文言と翻訳の検査" on checks of UI text and translations). Keyboard operation, visible focus, long Japanese text and narrow windows are also part of what you check. The UI is expected to run on both WebView2 on Windows and WebKitGTK on Linux. Use features that are Baseline Widely available as they are, and use newer features only with feature detection and a fallback display.
- **Parallel work**: When you have split the work with another session, do not edit or commit files outside the scope you agreed on.

## Updating AGENTS.md itself

- You may correct paths, commands and references, or correct facts within existing policy, as part of related work.
- To add a new prohibition, a new thing to protect or a new rule of approval in advance, or to make an existing rule stronger, first only propose it to the user.
- A change that loosens an existing prohibition or an approval boundary is not treated as a simple correction of facts either.
- When you add a condition to protect, write out the specification, behavior or compatibility to keep, rather than forbidding changes file by file, wherever you can.
- You may tidy up temporary notes and duplicated explanations. Do not, however, delete protection conditions agreed with the user without asking.
- Do not write here test counts, the latest commit, a list of what is unimplemented at a given time, performance figures on a particular PC, design proposals that have not been adopted, or instructions for one-off work.

---

# ASTAROT 開発エージェント向けガイド（日本語版）

ASTAROT（旧名 VRCT-VOX）は、VRChat 向けに音声認識（ASR）、読み上げ（TTS）、声質変換（RVC）、チャット読み取り（OCR）、翻訳をまとめたデスクトップアプリです。React 19 の UI を Tauri で動かし、バックエンドは Rust の中核（`native/core`）がアプリのプロセスの中で受け持ちます。0.5.0 から配布物に Python は入りません。Python のバックエンド（`src-python/`）は 0.6.0 で消しました。移植の記録は `docs/voice-stack/core-integration.md` にあります。アプリの表示名は ASTAROT です（ADR-011）。リポジトリは 0.5.0 の正式公開時に `kein5/astarot` へ改名しました。実行ファイル名、アプリ ID、OS ごとの保存先は `docs/voice-stack/project-rename.md` にあります。[VRCT](https://github.com/misyaguziya/VRCT) から派生したプロジェクトで、上流の追従や互換性は目標にしていません。

この文書は作業の入口です。詳しい内容は、下の表の正本を読んでください。

## 作業の基本姿勢

- 依頼の目的と範囲に沿って、必要な設計変更やリファクタリングは自分で判断して進めてよい。特定のファイルやモジュールを変更禁止にしたり、事前承認を必須にしたりはしていない。
- ただし、依頼にない機能追加や全面的な作り直し、外部への操作まで許されているわけではない。ユーザーの指示、公開・送信・配布の方針、ライセンスの条件は守る。
- 作業を始める前に、ブランチ、HEAD、未コミットの差分を確認する。自分が作っていない変更は消したり戻したりしない。
- 文書と実装が食い違っていたら、どちらかを機械的に正しいと決めない。説明が古いだけなのか、実装が守るべき方針を破っているのかを確かめる。判断できないときは未決として報告する。
- `docs/voice-stack/` には、日付付きの検証記録や提案が多く残っている。「未公開」「次工程」「今回」などの言葉は、書いた時点の状態を指す。採用済みの方針と区別して読む。

## 変更の対象ごとに読む資料

関係するものだけを読めば十分です。毎回すべてを読む必要はありません。

| 変更の対象 | 先に読む資料 |
|---|---|
| 製品の目的、守る機能、利用者の使い方 | `PRODUCT.md` |
| 機能、API（IPCのエンドポイント）、データ形式、横断的な振る舞い、契約 | `docs/spec/README.md`（一覧は `mise run spec` で作り直す。中核の `tools/spec_core_catalog.json` を書き出してから `python tools/spec_catalog.py --write` を流す） |
| UI の見た目、操作、アクセシビリティ | `DESIGN.md` |
| 開発環境、検証コマンド、コミット形式 | `docs/development.md` |
| 英語の文章（文書、画面の文言、コミットメッセージ、PR と Issue、作業の報告） | `docs/writing/english-guideline.md` |
| 日本語の文章（文書、画面の文言、リリースノート、PR と Issue、作業の報告） | `docs/writing/japanese-guideline.md` |
| 起動、ビルド、CI、配布候補 | `docs/readme_build.md`、`docs/voice-stack/release-candidates.md` |
| ブランチ、PR、依存、ダウンロードするモデル、表示する文言 | `CONTRIBUTING.md` |
| 同梱物、モデル、依存ライブラリのライセンス | `NOTICE.md`、`docs/voice-stack/licensing.md` |
| Rust のバックエンド中核と、Python からの移植の記録 | `docs/voice-stack/core-integration.md` |
| 名前、識別子、保存先、上流 VRCT との関係 | `docs/voice-stack/project-rename.md`、`docs/voice-stack/publication-and-upstream.md`、ASTAROT への改名は `docs/adr/adr-011-astarot-brand-and-multimodal-accessibility.md` |
| モデル取得の画面と同意 | `docs/voice-stack/model-downloads.md` |
| Linux のビルド、AppImage、実機での GUI 試験 | `docs/voice-stack/linux-build-pipeline.md`、`docs/voice-stack/appimage.md` |
| 設計判断（ADR） | `docs/adr/README.md`（索引、項目の意味、新しい ADR の書き方）と各 ADR。状態は冒頭の front matter で確かめる |

## 開発と検証の入口

入口は `python tools/dev.py` です。Node、Rust、Python、uv、Cocogitto の版は `mise.toml` で固定していて、`mise install` で入ります。よく使う手順は mise のタスクにしてあり（`mise run doctor`、`mise run check`、`mise run check:voice` など。一覧は `mise tasks`）、中身は同じ `tools/dev.py` です。npm のスクリプトにはこの近道を置かず、npm でないと動かないもの（Vite、Tauri、Vitest、型チェック、アプリの起動とビルド）だけを残しています。スコープの一覧、準備の手順、終了コードは `docs/development.md` と `--help` で確かめてください。

```sh
python tools/dev.py doctor                  # 足りない道具や依存を表示する
python tools/dev.py setup --scope headless  # モデルなしの試験に使う依存を準備する
python tools/dev.py check                   # 軽量チェック（tooling、node、lint）
```

UI の監査、文章の推敲、実機での画面の確認、図の作成などに使う道具は `docs/agent-tools.md` にまとめています。

変更したら、軽量チェックと、変更した箇所に対応するスコープを実行します。影響が広いときは、検証を足します。

| 変更したもの | 追加で実行するもの |
|---|---|
| Python の道具とその試験（`tools/`、`tests/voice/`）、配布の検査 | `check --scope voice`（新しい Linux の checkout では先に `python tools/build_voice_gate.py`） |
| UI（`src-ui/`）や文言 | `check --scope ui` |
| Rust のバックエンド中核（`native/core`）と `native/` のクレート、Tauri（`src-tauri/`） | `check --scope rust`（対象のクレートは `tools/dev.py` の `NATIVE_CRATES`。ほかのクレートは `cargo test --manifest-path native/<crate>/Cargo.toml`） |
| 画面から中核を通る流れ（`src-ui/` と `native/core` の両方にかかる変更）、結合テスト（`tests/integration/`、`native/browser-core-bridge`） | `check --scope integration`（先に `setup --scope integration`。ADR-017） |
| 複数の領域、統合の前 | `check --scope all` |
| コミット | `check --scope commits --base origin/develop` |

- ブラウザ試験、ネイティブ GUI 試験、実機での音声やモデル推論の確認は、別の手順で明示して実行します。手順は上の資料の各節にあります。通常の `check` には含まれません。
- 実機で GUI を試験している間にディスプレイが消えると、描画が止まり、失敗の原因を取り違えます。Linux のデスクトップでは `tools/display_power_guard.py` の下で実行します（`docs/voice-stack/linux-build-pipeline.md`）。
- 文書だけを変えたときなど、影響が小さい場合は、検証もそれに見合った範囲で構いません。

## 検証と完了の報告

- 軽量チェックが通っても、全テストや実機での確認が通ったことにはなりません。
- 成功、失敗、スキップ、未実行、環境不足を分けて書きます。失敗は出力の要点を添えます。
- 完了の報告には、次の 4 点を書きます。
  - 変更の要点
  - 実行した検証と、その結果
  - 実行しなかった検証と、その理由
  - 残っている懸念
- 計測した値には、計測した環境と条件を添えます。ある PC での性能を、一般的な保証として書きません。
- 報告の文章は、英語なら `docs/writing/english-guideline.md` の「Agent reports」に、日本語なら `docs/writing/japanese-guideline.md` の「エージェントの報告文」に従って書きます。

## コミットと変更履歴

人の開発者と同じ規約です。種別の表、例、分類の基準、リリースの手順は `CONTRIBUTING.md` の「Commit messages」と「Changelog and releases」にあります。

- コミットメッセージは Conventional Commits 1.0.0 で、英語で書きます。形は `<type>(<scope>)!: <summary>` です。要約は命令形で、先頭を小文字にし、句点を付けません。変わったことを、影響を受ける人の言葉で書きます。
- 種別は変更の中身で選びます。利用者ができることが増えたら `feat`、利用者が出会う不具合の修正は `fix`、開発の道具や CI だけの変更は `feat(dev)`、`ci`、`build`、`chore` などです。
- 設定、ファイルの形式、IPC や OSC の契約、対応する環境が前と同じに使えなくなるときは、`!` と `BREAKING CHANGE:` のフッターで明示します。フッターには利用者や開発者がすることを書きます。
- 種別だけでは CHANGELOG の分類がずれるときは `Changelog: user`、`Changelog: security`、`Changelog: internal`、`Changelog: skip` のフッターを付けます。
- commit-msg フックが入っていない環境もあります。コミットする前に `cog verify "<メッセージ>"` で確かめ、`python tools/dev.py check --scope commits --base origin/develop` も通します。
- `CHANGELOG.md` は `tools/changelog.py` が書くファイルで、載せるのは正式版だけです。正式版のリリースの準備を頼まれたとき以外は編集しません。書いた節を直すときは、まず `python tools/changelog.py print` の結果と比べます。ベータ版の変更は GitHub のプレリリースのノートに載せ、CHANGELOG には書きません。
- `cog bump` は使いません。タグは作らず、push もしません。タグは保守担当者が GitHub Releases の下書きを公開したときにできます。
- リリースの準備を頼まれたら、`package.json` の版、`npm run update-version` の順に進めます。正式版のときだけ、続けて `npm run changelog` を実行します。`chore(release): version X.Y.Z` で1つのコミットにします。

## 設計判断の記録（ADR）

書き方と項目の意味の正本は `docs/adr/README.md` です。ここには要点だけを挙げます。

- ADR は `docs/adr/` だけに置きます。新しい ADR は `docs/adr/TEMPLATE.md` から作り、番号は使い直しません。
- 冒頭の front matter で、採用の状態（`status`）と実装の確認状況（`implementation_status`）を分けて書きます。`accepted` だけを根拠に実装済みとはみなしません。裏付けのない値は作らず、確かめていなければ `unknown` にします。
- 古い ADR を読むときは、先に `era`（書いた時点の前提）と `validity`（いまも有効か、実装の方式だけが変わったか、後続の ADR で置き換えられたか）を見ます。本文は書いた時点の記録なので書き換えず、変わったことは front matter、注記、後続の ADR で示します。
- ADR を足したり front matter を変えたりしたら、`python tools/adr_catalog.py --write` で索引の表を作り直します。`check` の `tooling` が `--check` で、番号の重複、項目と値、裏付けのパス、リンク、表の古さを確かめます。
- ファイルの移動やメタデータだけの変更と、判断の内容を変える変更は、別のプルリクエストに分けます。

## スキル

作業の手順をまとめたスキルを `skills/` に置いています。`.claude/skills` と `.agents/skills` は `skills/` へのシンボリックリンクです。作業が当てはまるときは、スキルを読んでから進めます。

- `adr`: 設計判断を ADR に書く、読む、状態を直す、置き換えるとき
- `pull-request`: ブランチを切ってから develop にマージするまで。PR の本文、マージの条件、積み重ねた PR、main から切るホットフィックスを含む
- `release`: 版上げ、リリースノート、下書き、公開、公開後の確認、main を develop へ戻す統合
- `jp-writing`: 日本語の文章の執筆と推敲。リリースノートは毎回使う

シンボリックリンクを作らない設定の clone（Windows の Git の既定）では、リンクが中身 1 行のファイルになります。そのときは `skills/<名前>/SKILL.md` を直接読みます。スキルとほかの文書が食い違うときは、どちらかを機械的に正しいと決めず、確かめてから同じ PR で直します。

## 既存の重要な境界

詳しい内容は、それぞれの正本にあります。ここには要点だけを挙げます。

- **外部への操作**: 上流 VRCT への連絡、取り込みの打診、PR の作成（draft を含む）は、明示の指示がある場合だけ行います（`publication-and-upstream.md`）。push、PR、Release の公開、Hugging Face へのアップロードは、依頼の範囲に含まれているときに行います。Release は保守担当者が確認してから公開します（`release-candidates.md`）。
- **配布物とライセンス**: 上流のチャット吹き出し検出モデルを含む OCR の重み、許諾のないモデル、Mia2026 の音声を配布物に入れません。依存や同梱物を変えたら、`NOTICE.md` とライセンス台帳を確認します。ダウンロードできるモデルは、版、サイズ、SHA-256、ライセンスを固定してカタログ（`native/ops/src/downloads/catalog.rs`）に載せます。OCR のモデルはチャット読み取りの表（`native/ocr-runtime/src/models.rs`）にも同じ項目を入れます（食い違いは `native/core/tests/downloads.rs` が検出します）。非商用など制限のあるライセンスのモデルは既定にしません。
- **互換性**: 内部識別子の `VRCT`、設定の形式、IPC と OSC の契約は、名前を変えるという理由だけで一括置換しません。保存先やアプリ ID などの識別子を変えるときは、移行の処理も用意します（`project-rename.md`）。
- **ユーザーの操作と同意**: モデルの取得は、ライセンスとサイズを示して同意を得てから行います。UI の変更によって、マイクの有効化、モデルの取得、メッセージの送信、音声経路の変更が勝手に起きないようにします。
- **音声 AI のランタイム**: 新しい音声 AI モデルは、まず speech.cpp への上流の貢献で入れます。アプリ固有の推論エンジンや独立したランタイムは、既存の基盤で実現できない技術的な理由と、性能・保守・配布のコストでの明確な優位性の両方を確かめ、例外ごとの ADR で承認したときだけ足します。分担は、音声 AI の推論（ASR、TTS、VAD、話者、音声強調）が speech.cpp、OCR とローカル翻訳が ONNX Runtime、音声の入出力と AI でない DSP が Rust と OS の機能、字幕や OSC など固有の制御がアプリです。RVC は管理対象の例外として ONNX Runtime の実装を続け、移行は義務にしません。手順、非機能要件、検証は ADR-012（`docs/adr/adr-012-audio-ai-runtime-consolidation.md`）にあります。
- **停止と独立した制御**: 停止・ミュート、TTS と RVC の独立したスイッチ、Quick Chat、VR パネル、ホットキーの振る舞いを保ちます（`PRODUCT.md`、`DESIGN.md`）。
- **UI**: React 19、vanilla-extract、Jotai、i18next の構成を保ちます。TypeScript と Radix UI への段階移行は ADR-010 のとおりで、混在期の規約は `docs/development.md` にあります。フレームワークの移行や、リモートのフォントは入れません。表示する文言は `locales/` に置き、`en.yml` と `ja.yml` は必ず更新します。キーの不足、補間変数の食い違い、UI への直書きは `check` に含まれる文言の検査（`tools/i18n_gate/check.mjs`）が止めます。わざと訳さない文字列には理由を書きます（`docs/development.md` の「UIの文言と翻訳の検査」）。キーボード操作、フォーカスの表示、長い日本語の表示、狭いウィンドウも確認の対象です。Windows の WebView2 と Linux の WebKitGTK の両方で動くことを前提にします。Baseline Widely available の機能はそのまま使い、それより新しい機能は機能検出と代わりの表示を付けたときだけ使います。
- **並行作業**: 別のセッションと担当を分けているときは、合意した範囲の外のファイルを編集・コミットしません。

## AGENTS.md 自体の更新

- パス、コマンド、参照先の訂正や、既存方針の範囲内での事実の訂正は、関連する作業のついでに更新してかまいません。
- 新しい禁止事項、保護する対象、事前承認のルールを足すことや、既存のルールを強めることは、まずユーザーに提案するだけにします。
- 既存の禁止事項や承認の境界を緩める変更も、単なる事実の訂正としては扱いません。
- 保護したい条件を足すときは、できるだけファイル単位の変更禁止ではなく、守るべき仕様、振る舞い、互換性を具体的に書きます。
- 一時的な注意や重複した説明は整理してかまいません。ただし、ユーザーと合意した保護の条件は、無断で削除しません。
- テストの件数、最新のコミット、その時点の未実装の一覧、特定の PC での性能値、採用前の設計案、一度限りの作業の指示は、ここに書きません。
