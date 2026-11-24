---
date: 2026-11-20
status: accepted
era: rust-core
validity: current
implementation_status: implemented
implementation_checked: 2026-11-23
evidence:
  - docs/adr/adr-017-integration-tests-through-the-core.md
  - src-ui/logics/common/backendCommand.ts
  - src-tauri/src/backend_host.rs
  - native/core/src/backend.rs
  - native/core/tests/common/mod.rs
  - tests/integration
  - native/browser-core-bridge
  - .github/workflows/voice-tests.yml
---
# ADR-017: Write tests from the screen through the core as Playwright integration tests, and call only tests on the distributed app E2E

[日本語版](#adr-017-画面から中核まで通す試験を-playwright-の結合テストにし配布物で通す試験だけを-e2e-と呼ぶ日本語版)

Status: Accepted (2026-11-20). The decided items are those listed under "What was decided" in Issue #821.
Date: 2026-11-20
Decision owners: The repository's maintainers
Related: Issue #821, Issue #810, PR #816, [the development guide](../development.md), `tests/platform/`, `tools/native_acceptance.py`

In this ADR, "the app" means the app in this repository. Its display name is ASTAROT (ADR-011), and its identifiers remain VRCT-VOX.

## 1. Context

As of 0.6.0, the UI is drawn with React in Tauri's WebView (WebView2 on Windows, WebKitGTK on Linux), and the core (`native/core`) runs inside the app process. The UI exchanges messages with the core one line at a time through `invoke("backend_start" / "backend_write" / "backend_kill")` and a Tauri Channel (`src-ui/logics/common/backendCommand.ts`, `src-tauri/src/backend_host.rs`).

There were three kinds of tests:

- Vitest: checks UI logic and components by rendering each component inside Node (`hookHarness`). It does not go through the core.
- Rust: checks the processing of the core and the crates. The core's tests replace recording, audio output, OSC, the key store and other services with fakes in `Options.services`, and send IPC lines directly. They do not go through the UI.
- GUI tests that actually run the distributed app (`tests/platform`, tauri-driver, Python): they need a screen and a desktop, and most are run by hand before a release.

No test checked, on every PR, the whole path from a request the UI sends, through the real core that handles it, to the screen changing with the core's answer. There was a Playwright test (in Python) that rendered the translation catalog in Chromium, but the other side was a fake and every CI skipped it, so #816 moved it to Vitest. When #810 took stock of the Python tests and decided to move them to Vitest and Rust in stages, it also decided where tests that go from the screen through the core belong and what to call them.

## 2. Decision

1. **Tests are split into three layers.**
   - Unit and contract: Vitest and Rust. They check UI logic and components, the processing of the core and the crates, and the promises about routes and names.
   - Integration tests: a single test operates the screen, goes through the core and the Rust crates, and checks both the exits to the outside (translation and TTS servers, the OSC receiver, the settings file) and the result on screen. The UI is the same bundle as in the distribution, and the core and the crates are real. What is faked is the app shell (Tauri's windows and IPC), the OS and devices, outside services, and models.
   - E2E: goes through the shell and the OS for real, in the form of the distribution. It checks that the distribution starts, its integration with the OS (windows, the tray, shortcuts, the subtitle window) and the real VRChat. Today's `tests/platform` and `tools/native_acceptance.py` are in this layer.
2. **Names**: tests that go from the screen to Rust are called "integration tests". "E2E" is used only for tests that run in the form of the distribution. The name of the tool (Playwright) does not decide what a test is called.
3. **Integration tests are written with Playwright (`@playwright/test`, TypeScript) and placed in `tests/integration/`.** They run in a dedicated CI job on every PR, on Linux and Windows, in both Chromium and WebKit. Chromium is the same family as WebView2, and Playwright's WebKit is the same engine as WebKitGTK (its version and build are not the same as the WebKitGTK of the distribution).
4. **How the screen and the core are connected**:
   - On the screen side, the real entry point is loaded without changing the app's code. Tauri calls are received by Tauri's official fake (`mockIPC` from `@tauri-apps/api/mocks`), and only the exchanges with the core (`backend_start`, `backend_write`, `backend_kill`) are passed to the host over WebSocket. Fakes answer the other calls.
   - On the core side, a crate dedicated to test tooling starts `vrct_core::Backend` with the same fake `Services` as the core's tests, and connects it to the WebSocket. It is not made an example in `native/core`, because an example does not represent a feature, and the purpose and dependencies of the test tooling are kept separate.
5. **What does not change**: integration tests check flows (the request sent, the core's answer, the state of the screen, saved values, what was sent outside). Checking rendering, such as overflow in a narrow window, is not their aim (the decision in #816). Checks of the OS and the distribution stay with E2E.

## 3. Alternatives considered

| Option | What it is | Why it was not chosen |
|---|---|---|
| Call tests that go from the screen to Rust "E2E" | Call them E2E even when a test host replaces the shell, and call tests on the distribution "acceptance tests" | "E2E passed" would then mean a result that did not go through Tauri's IPC and the OS |
| Use neither "integration" nor "E2E" | Call them "UI pass-through tests" and "distribution acceptance tests" | Each document would need an explanation of how these map to the common names |
| Add more tests that run the distributed app (tauri-driver) to check flows | Run them on the real app on every PR | They need a screen and a desktop and wait for the distribution build, which is too heavy for every PR. Playwright cannot drive a WebKitGTK WebView, so the tools would also stay split |
| Make the core's host an example in `native/core` | Build it with `cargo build --example` | An example does not represent a feature. The purpose and dependencies of the test tooling are kept apart from the core crate |
| Run only in Chromium | Takes about half the downloads and time | The Linux distribution renders with WebKitGTK. We want to see both families every time |
| Continue with Vitest's `hookHarness` only | Render each component, with the core faked | It does not go through the real core, so it cannot find mismatches between the UI and the core |

## 4. Consequences

- What we gain: mismatches in the flow between the UI and the core are found on every PR, in both engine families. E2E can focus on checks of the OS and the distribution.
- Costs:
  - CI spends more time building the host crate and downloading and starting the browsers (Chromium and WebKit, several hundred MB together).
  - When the app starts to use a new Tauri call, the entry point of the integration tests needs a fake for it. The tests are made to detect a call that has no fake and stop.
  - Playwright's WebKit differs from the distribution's WebKitGTK in version and build. Problems that occur only in WebKitGTK are checked with E2E.
- Migration: of today's `tests/platform` tests, the flows that do not need a real window (saving and reading back settings, a sent message reaching translation, OSC and TTS, and so on) move to integration tests when someone next works on the area they cover, and E2E narrows to checks of the OS and the distribution. Playwright in Python (such as the tool for the screenshots in the documents) is aligned with Playwright in Node once the integration test foundation is in place.

## 5. Verification and acceptance criteria

| Aspect | What to check | How |
|---|---|---|
| Location | The integration tests are in `tests/integration/`, and the host is in a crate dedicated to test tooling | The repository layout |
| CI | A dedicated job runs on every PR, on Linux and Windows, in Chromium and WebKit | The jobs in `.github/workflows/` and their run history |
| Coverage | The tests operate the screen and check the real core's answer and what reached the exits to the outside | The first scenario (Issue #821) |
| App code | No test-only branches were added to the app's code for the integration tests | The diff of the entry point and the host |

## 6. Revisit triggers

- When Tauri's IPC changes so that the official fake can no longer stand in for the exchanges with the core.
- When Playwright can drive a WebKitGTK WebView, so that tests can run on every PR in the form of the distribution.
- When the CI time of the integration tests grows longer than the other jobs and visibly lengthens the wait on PRs.

## 7. Open questions

- The prefix of the host crate's package name: whether it uses `vrct-`, like the current crates, or the form after package names are aligned to `astarot-` (P2 of ADR-014) is decided in the foundation PR.

> **Decision note** (2026-11-21, PR #824): the prefix was set to `vrct-`, the same as the current crates. The host is `vrct-browser-core-bridge`, and it changes to `astarot-` together with the other crates in PR 12 of ADR-014. The item above is kept as the record of the time it was written.

---

# ADR-017: 画面から中核まで通す試験を Playwright の結合テストにし、配布物で通す試験だけを E2E と呼ぶ（日本語版）

Status: 採用（2026-11-20）。決定の項目は Issue #821 の「決まったこと」のとおりである。
Date: 2026-11-20
Decision owners: リポジトリの保守担当者
Related: Issue #821、Issue #810、PR #816、[開発の手順](../development.md)、`tests/platform/`、`tools/native_acceptance.py`

この ADR の「アプリ」は本リポジトリのアプリを指す。表示名は ASTAROT（ADR-011）で、識別子は VRCT-VOX のままである。

## 1. Context（背景）

0.6.0 の時点で、UI は React で Tauri の WebView（Windows は WebView2、Linux は WebKitGTK）に描かれ、中核（`native/core`）はアプリのプロセスの中で動く。UI は `invoke("backend_start" / "backend_write" / "backend_kill")` と Tauri の Channel で中核と 1 行ずつやり取りする（`src-ui/logics/common/backendCommand.ts`、`src-tauri/src/backend_host.rs`）。

試験は次の 3 つだった。

- Vitest：UI の論理と部品を、Node の中で部品ごとに描いて確かめる（`hookHarness`）。中核は通らない。
- Rust：中核とクレートの処理を確かめる。中核の試験は、録音、音声の出力、OSC、鍵の保存先などを `Options.services` の偽物に差し替え、IPC の行を直接送る。UI は通らない。
- 配布物を実際に動かす GUI の試験（`tests/platform`、tauri-driver、Python）：画面とデスクトップが要り、多くはリリースの前に手で流す。

UI が送る要求を本物の中核が処理し、その答えで画面が変わるまでを、すべての PR で確かめる試験はなかった。翻訳のカタログを Chromium に描く Playwright の試験（Python）はあったが、相手は偽物で、どの CI でも skip されていたので #816 で Vitest に移した。#810 で Python の試験を棚卸しし、段階的に Vitest と Rust へ寄せると決めたときに、画面から中核まで通す試験の置き方と呼び方もあわせて決めた。

## 2. Decision（決定）

1. **試験を 3 つの層に分ける。**
   - 単体と契約：Vitest と Rust。UI の論理と部品、中核とクレートの処理、ルートや名前の約束を確かめる。
   - 結合テスト：画面を操作し、中核と Rust のクレートを通って、外への出口（翻訳や読み上げのサーバー、OSC の受け手、設定のファイル）と画面の結果までを 1 本で確かめる。UI は配布物と同じ bundle、中核とクレートは本物にする。偽物にするのは、アプリの殻（Tauri の窓と IPC）、OS と機器、外のサービス、モデルである。
   - E2E：配布物の形で、殻と OS を本物で通す。配布物の起動、OS との連携（窓、トレイ、ショートカット、字幕の窓）、実物の VRChat を確かめる。今の `tests/platform` と `tools/native_acceptance.py` がこれに当たる。
2. **呼び方**：画面から Rust まで通す試験を「結合テスト」と呼ぶ。「E2E」は、配布物の形で通す試験だけに使う。道具（Playwright）の名前では呼び方を決めない。
3. **結合テストは Playwright（`@playwright/test`、TypeScript）で書き、`tests/integration/` に置く。** CI の専用のジョブで、すべての PR で流す。Linux と Windows で、Chromium と WebKit の両方で流す。Chromium は WebView2 と同じ系統で、Playwright の WebKit は WebKitGTK と同じエンジンである（版と組み方は配布物の WebKitGTK と同じではない）。
4. **画面と中核のつなぎ方**：
   - 画面の側は、アプリのコードを変えずに、本物の入り口を読み込む。Tauri の呼び出しは Tauri の公式の偽物（`@tauri-apps/api/mocks` の `mockIPC`）で受け、中核とのやり取り（`backend_start`、`backend_write`、`backend_kill`）だけを WebSocket でホストへ流す。ほかの呼び出しには偽物が答える。
   - 中核の側は、試験の道具の専用のクレートが、`vrct_core::Backend` を中核の試験と同じ偽物の `Services` で起動し、WebSocket とつなぐ。`native/core` の example にはしない。example は機能を表さず、試験の道具としての目的と依存を分けて置くためである。
5. **変えないもの**：結合テストは流れ（送った要求、中核の答え、画面の状態、保存された値、外へ送られたもの）を確かめる。狭い窓のはみ出しなどの描画の確認は目的にしない（#816 の決定）。OS と配布物の確認は E2E に残す。

## 3. Alternatives considered（検討した案）

| 案 | 中身 | 採らなかった理由 |
|---|---|---|
| 画面から Rust まで通す試験を「E2E」と呼ぶ | 殻を試験のホストで置き換えていても E2E とし、配布物で通す試験は「受け入れ試験」と呼ぶ | 「E2E が通った」が、Tauri の IPC と OS を通していない結果を指すことになる |
| 結合と E2E の言葉を使わない | 「UI 通し試験」「配布物の受け入れ試験」と呼ぶ | 一般の呼び方と対応づける説明が文書ごとに要る |
| 配布物を動かす試験（tauri-driver）を増やして流れを確かめる | 実物のアプリで、すべての PR で流す | 画面とデスクトップが要り、配布物のビルドも待つので、すべての PR で流すには重い。Playwright は WebKitGTK の WebView を操作できないので、道具も分かれたままになる |
| 中核のホストを `native/core` の example にする | `cargo build --example` で組む | example は機能を表さない。試験の道具の目的と依存を、中核のクレートから分けておく |
| Chromium だけで流す | 取得と時間が半分ほどで済む | Linux の配布物は WebKitGTK で描く。両方の系統を毎回見たい |
| Vitest の `hookHarness` だけで続ける | 部品ごとに描き、中核は偽物にする | 本物の中核を通らないので、UI と中核のあいだの食い違いを見つけられない |

## 4. Consequences（影響）

- 得るもの：UI と中核のあいだの流れの食い違いを、すべての PR で、両方のエンジンの系統で見つけられる。E2E は OS と配布物の確認に絞れる。
- 負担：
  - CI に、ホストのクレートを組む時間と、ブラウザ（Chromium と WebKit、合わせて数百 MB）を取得して起動する時間が増える。
  - アプリが新しい Tauri の呼び出しを使うと、結合テストの入り口にその偽物が要る。偽物のない呼び出しは試験が見つけて止まるようにする。
  - Playwright の WebKit は、配布物の WebKitGTK と版と組み方が違う。WebKitGTK でしか起きない問題は E2E で見る。
- 移行：今の `tests/platform` の試験のうち、実物の窓を要らない流れ（設定の保存と読み戻し、メッセージの送信が翻訳、OSC、読み上げへ届くことなど）は、対象を触る機会に結合テストへ移し、E2E を OS と配布物の確認に絞る。Python の Playwright（文書の画面写真の道具など）は、結合テストの基盤ができたあとで Node の Playwright にそろえる。

## 5. Verification / Acceptance criteria（検証と受け入れの条件）

| 観点 | 確かめること | 方法 |
|---|---|---|
| 置き場所 | 結合テストが `tests/integration/` にあり、ホストが試験の道具の専用のクレートにある | リポジトリの構成 |
| CI | 専用のジョブが、すべての PR で、Linux と Windows、Chromium と WebKit で流れる | `.github/workflows/` のジョブと実行の記録 |
| 通す範囲 | 試験が画面を操作し、本物の中核の答えと、外への出口に届いたものを確かめる | 最初の場面（Issue #821） |
| アプリのコード | 結合テストのために、アプリのコードに試験用の分岐を足していない | 入り口とホストの差分 |

## 6. Revisit triggers（見直す条件）

- Tauri の IPC の作りが変わり、公式の偽物で中核とのやり取りを差し替えられなくなったとき。
- Playwright が WebKitGTK の WebView を操作できるようになり、配布物の形のまま、すべての PR で流せるようになったとき。
- 結合テストの CI の時間が、ほかのジョブより長くなり、PR の待ち時間を目に見えて延ばしたとき。

## 7. 未決のこと

- ホストのクレートのパッケージ名の接頭辞。今のクレートと同じ `vrct-` にするか、パッケージ名を `astarot-` にそろえる作業（ADR-014 の P2）のあとの形にするかは、基盤の PR で決める。

> **決定の注記**（2026-11-21、PR #824）：接頭辞は今のクレートと同じ `vrct-` に決まった。ホストは `vrct-browser-core-bridge` とし、ADR-014 の PR 12 でほかのクレートと一緒に `astarot-` へ替える。上の項目は書いた時点の記録として残す。
