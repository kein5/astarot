---
name: testing
description: Steps for writing and running ASTAROT's tests and for mutation testing at milestones. Covers the test layer for a change (UI Vitest, Rust crates and the core, Playwright integration tests, contracts, pytest and unittest for packaging and tools, acceptance tests on a real machine), tests that do not flake (wait for events, pass the time in, no external services, microphones or models, show the state on failure), check scopes, and mutation testing of changed code and of everything before a stable release (#550) and keeping its results. Use when writing or fixing tests, choosing checks to run, running mutation testing or reading and reporting its results. ASTAROTの試験を書き、流し、節目で変異テストを回す手順。変更に合う試験の層（UIのVitest、Rustのクレートと中核、Playwrightの結合テスト、契約、配布の道具のpytestとunittest、実機の受け入れ試験）の選び方、揺らがない試験の書き方（出来事を待つ、時刻を渡す、外のサービスやマイクやモデルを使わない、落ちたときに状態を出す）、checkのスコープの選び方、変更した部分の変異テストと正式版の前の全体の変異テスト（#550）の運用と結果の残し方を扱う。試験を書く、直す、どの検査を流すか決める、変異テストを回す、その結果を読むときに使う。
---

# Writing and running tests

[日本語版](#試験を書いて回す日本語版)

The authority on the test tools, the commands and the details to watch in mutation testing is [the development guide](../../docs/development.md): "Choosing what to check", "UI tests (Vitest)", "Integration tests (Playwright)", "Mutation testing for the UI", "Rust coverage and mutation testing" and "When to run mutation testing". This skill covers only the order and the rules for writing and running tests. Narrowing down a failure in CI is in the [ci-triage skill](../ci-triage/SKILL.md), and tests on a real machine are in the [e2e skill](../e2e/SKILL.md).

## 1. Choose the test layer

Write the test in the smallest layer that fits what you want to check.

| What you want to check | Layer and location | Scope to run |
|---|---|---|
| UI logic (computing values, state, choosing text) | Vitest. `*.test.ts` in `src-ui`. The environment is Node, with no DOM | `node`, `ui` |
| Pure logic in a Rust crate | The crate's unit tests. Check boundaries with proptest too | `rust` |
| Behavior of the core (settings, audio routes, stop and mute) | The integration tests in `native/core/tests`. Use the fake `Services` (`native/core/tests/common`) | `rust` |
| From the UI through the core and out of the app | The Playwright integration tests (`tests/integration/`, [ADR-017](../../docs/adr/adr-017-integration-tests-through-the-core.md)). Both Chromium and WebKit | `integration` |
| Promises that must not change | Write the test in one of the layers above, and name it in the promise's row in `docs/spec/contracts.md` | The layer the test is in |
| The release package, model downloads, audio contracts | pytest (`tests/voice/`, `tests/voice/pytest.ini`) | `voice` |
| Development tools (`tools/`) | unittest (`tests/devtools/`, the standard library only) | `tooling` |
| Starting in the form of the release package, VR, VRChat | Acceptance tests on a real machine (`tests/platform/`, `tools/native_acceptance.py`). Most are skipped in CI | The e2e skill |

- Do not check the core's behavior with UI tests alone. Write the core's promises in the core's tests, and let the UI tests check what the UI is responsible for.
- Check VR handling with the fake SteamVR (`runtime::fake::FakeVr` in `native/vr-overlay`).
- Even when the tests in `tests/platform/` are skipped in CI, `tests/devtools/test_platform_imports.py` finds broken imports in them. If you delete or rename a helper, fix the tests that call it in the same pull request.

## 2. Write tests that do not flake

The rules below come from the fixes for #861, which looked into flaky CI runs (#967, #989), and from how the tests have been built so far.

- **Wait for events.** Do not sleep for a fixed number of seconds and then compare counts. Decide what to wait for (a window was created, a caption finished drawing, a session closed), and wait for it with a time limit. Make the limit long enough for a slow runner (a cold Windows runner).
- **Show the state on failure.** When a wait times out, print what it was waiting for and what the state was at that moment (`common::net::eventually_or` in the core's tests). For a test that failed once in CI, the cause cannot be narrowed down without this output.
- **Pass the time in.** Write code that depends on the time so that the time can be passed in from outside, and advance it from the test. In Vitest, use `vi.useFakeTimers({ toFake: [...] })` and `vi.advanceTimersByTime(ms)`.
- **Use nothing external.** Do not use external services, a real microphone, inference models or the GPU in tests. Replace external services with fakes (`standIns.ts` in the integration tests, the core's fake `Services`), and check what reached them. `check` does not start the microphone, speech output or GPU inference.
- **Inject failures.** Check failures partway through saving or starting with fakes that can fail on demand (`MemoryStore` for storing keys, a fake worker and so on).
- **Give each test its own place.** Create the settings folder, temporary files and ports for each test, and do not share them between tests.
- **Check so that a difference in values shows.** Check the resulting values, not that the code ran. Mutants that mutation testing leaves undetected mark places where values are not checked (see 4).

The details of writing UI tests and Rust tests (stand-ins for `loadModule`, `onTestFinished`, adding answers to `tauriStandIns.ts`, how to write proptest properties) are in the sections of the development guide.

## 3. Run

1. Run the scopes that match what you changed. Which scope goes with which change is in the table in "Entry points for development and verification" in [AGENTS.md](../../AGENTS.md).

   ```sh
   python tools/dev.py check                  # light checks (tooling, node, lint)
   python tools/dev.py check --scope ui       # UI tests, lint, types, build
   python tools/dev.py check --scope rust     # Rust crates (NATIVE_CRATES)
   python tools/dev.py check --scope voice    # release package and audio contracts
   python tools/dev.py check --scope integration
   ```

2. When you write a new test, confirm once that it fails on the code before the fix. Running it with the fix taken out shows whether the test looks at what you fixed.
3. Check a test you suspect of flaking by running it many times in a row with a workflow on a temporary branch (the record in #861). Do not merge the temporary branch.
4. CI does not retry failed tests (#1028). Do not hide a flaky test by adding retries. Record it in issue #1073 by the steps of the ci-triage skill, and fix it.

## 4. Run mutation testing (#550)

Mutation testing puts small changes into the source and checks whether any test fails. It does not run in CI; you run it by hand.

**In a pull request with changes**

- For a pull request that changes UI logic (`src-ui/logics`, `src-ui/views`) or the `src/` of a Rust crate, running `mise run mutation:changed` is recommended. It is not required.

  ```sh
  mise run mutation:changed -- --base astarot/develop   # when you fetch develop from a remote with another name
  mise run mutation:changed -- --dry-run                # only show what would run
  ```

- If you run it, write the numbers of Survived and NoCoverage mutants, and whether you read each one, in the "Verification" section of the pull request description. If you do not run it, write why (the pull-request skill).
- For each mutant that is left, read the code and decide whether a test is missing or the mutant is equivalent, that is, no input changes the result. If it is equivalent on the UI side, record it with a reason using `npx mutator accept <key> --reason "<reason>"`, and commit `mutator.accepted.json`.

**At milestones (before a stable release)**

- Before a stable release, run the whole UI side and the whole list of main Rust crates (the release skill). Do not run it for betas. The commands and the list of crates are in the table in "When to run mutation testing" in the development guide. To change the list, edit that table.
- It takes a long time (40 minutes to two and a half hours locally for the UI side), so run it detached from the terminal.
- Comment the results on the record issue. For now this is #550; after #550 is closed, open a record issue for each milestone. Do not write the results in the repository's documents. The figures change with the measurement conditions (version, parallelism, hardware), and in a document they are easily read as a guarantee of quality.
- Give the target range and the measurement conditions (version, parallelism, hardware) in the report, and do not present the score as a guarantee of quality.

**Easy to get wrong**

- On the UI side, add `--full-dry-run` when you do a full run after a run narrowed with `--include`, and when you narrow to a range that differs from the previous run. Without it, even mutations in files whose tests pass can become NoCoverage.
- Run the UI side with `npm run test:mutation` (`vitest.mutator.config.js`). With another configuration, the cache makes the score drop to near 0%. Do not run two at the same time in one working tree.
- When you run Rust in parallel with `-j`, do not set `CARGO_TARGET_DIR`. Run `native/core` one mutant at a time with `--in-place`, and do not edit that crate's files while it runs.
- Run crates that use proptest with `PROPTEST_DISABLE_FAILURE_PERSISTENCE=1`.
- With `-- --lib`, only the unit tests run, so also state in the report which kinds of tests ran.

---

# 試験を書いて回す（日本語版）

試験の道具、コマンド、変異テストの細かい注意の正本は[開発の手順](../../docs/development.md)の「Choosing what to check」「UI tests (Vitest)」「Integration tests (Playwright)」「Mutation testing for the UI」「Rust coverage and mutation testing」「When to run mutation testing」です。このスキルには試験を書いて回すときの順序と決まりだけを書きます。CIで落ちたときの切り分けは[ci-triageスキル](../ci-triage/SKILL.md)、実機の試験は[e2eスキル](../e2e/SKILL.md)にあります。

## 1. 試験の層を選ぶ

確かめたいことに合う、いちばん小さい層に書きます。

| 確かめたいこと | 層と場所 | 流すスコープ |
|---|---|---|
| 画面の論理（値の計算、状態、文言の選び方） | Vitest。`src-ui`の`*.test.ts`。Nodeの環境で、DOMはない | `node`、`ui` |
| Rustのクレートの純粋な論理 | クレートの単体の試験。境界はproptestでも確かめる | `rust` |
| 中核の振る舞い（設定、音声経路、停止とミュート） | `native/core/tests`の結合の試験。偽の`Services`（`native/core/tests/common`）を使う | `rust` |
| 画面から中核を通って外へ出るまで | Playwrightの結合テスト（`tests/integration/`、[ADR-017](../../docs/adr/adr-017-integration-tests-through-the-core.md)）。ChromiumとWebKitの両方 | `integration` |
| 変えてはいけない約束 | 上のどれかの層に書き、`docs/spec/contracts.md`の約束の行に試験の名前を挙げる | 試験のある層 |
| 配布物、モデルの取得、音声の契約 | pytest（`tests/voice/`、`tests/voice/pytest.ini`） | `voice` |
| 開発の道具（`tools/`） | unittest（`tests/devtools/`、標準ライブラリだけ） | `tooling` |
| 配布物の形での起動、VR、VRChat | 実機の受け入れ試験（`tests/platform/`、`tools/native_acceptance.py`）。CIではほとんどがskipされる | e2eスキル |

- 中核の動きを画面の試験だけで確かめません。中核の約束は中核の試験に書き、画面の試験は画面の受け持ちを確かめます。
- VRの扱いは偽のSteamVR（`native/vr-overlay`の`runtime::fake::FakeVr`）で確かめます。
- `tests/platform/`の試験はCIでskipされても、読み込みが壊れていれば`tests/devtools/test_platform_imports.py`が見つけます。補助を消したり名前を変えたりしたら、呼んでいる試験も同じPRで直します。

## 2. 揺らがない試験を書く

次の決まりはCIの揺らぎを調べた#861の直し（#967、#989）と、これまでの試験の作りから来ています。

- **出来事を待ちます。** 固定の秒数だけ眠ってから数を比べません。待つものを決め（窓ができた、字幕を描き終えた、セッションが閉じた）、上限の時間を付けて待ちます。上限は遅いランナー（冷えたWindows）でも足りる長さにします。
- **落ちたときに状態を出します。** 待ちが時間切れになったら、何を待っていて、そのときの状態がどうだったかを出します（中核の試験の`common::net::eventually_or`）。CIで1回だけ落ちた試験は、この出力がないと原因を絞れません。
- **時刻を渡します。** 時刻に頼る処理は、時刻を外から渡せる形にして、試験から進めます。Vitestでは`vi.useFakeTimers({ toFake: [...] })`と`vi.advanceTimersByTime(ms)`を使います。
- **外のものを使いません。** 外のサービス、実際のマイク、推論のモデル、GPUを試験で使いません。外のサービスは偽物（結合テストの`standIns.ts`、中核の偽の`Services`）で置き換え、届いたものを確かめます。`check`はマイク、読み上げの出力、GPUの推論を始めません。
- **失敗を注入します。** 保存や起動の途中の失敗は、失敗を起こせる偽物（鍵の保管の`MemoryStore`、偽のworkerなど）で確かめます。
- **試験ごとに場所を分けます。** 設定のフォルダー、一時ファイル、ポートは試験ごとに作り、試験の間で共有しません。
- **値の違いが分かるように確かめます。** 処理が走ったことではなく、結果の値を確かめます。変異テストで残った変異は、値を確かめていない場所の目印です（4を見る）。

画面の試験とRustの試験の細かい書き方（`loadModule`の差し替え、`onTestFinished`、`tauriStandIns.ts`への答えの追加、proptestの性質の書き方）は、開発の手順の各節にあります。

## 3. 流す

1. 変更したものに合うスコープを流します。対応は[AGENTS.md](../../AGENTS.md)の「開発と検証の入口」の表にあります。

   ```sh
   python tools/dev.py check                  # 軽量チェック（tooling、node、lint）
   python tools/dev.py check --scope ui       # 画面の試験、lint、型、ビルド
   python tools/dev.py check --scope rust     # Rustのクレート（NATIVE_CRATES）
   python tools/dev.py check --scope voice    # 配布物と音声の契約
   python tools/dev.py check --scope integration
   ```

2. 新しい試験を書いたら、直す前のコードで落ちることを一度確かめます。直しを外して流すと、試験が直したものを見ているかが分かります。
3. 揺らぎを疑う試験は一時ブランチのワークフローで何度も続けて流して確かめます（#861の記録）。一時ブランチはマージしません。
4. CIは失敗した試験を再試行しません（#1028）。揺らいだ試験は再試行を足して隠さず、ci-triageスキルの手順でIssue #1073に記録して直します。

## 4. 変異テストを回す（#550）

変異テストはソースに小さな変更を入れて、どれかの試験が落ちるかを確かめます。CIでは流さず、手で回します。

**変更したPRで**

- 画面の論理（`src-ui/logics`、`src-ui/views`）かRustのクレートの`src/`を変えたPRでは、`mise run mutation:changed`を回すことを勧めます。必須ではありません。

  ```sh
  mise run mutation:changed -- --base astarot/develop   # developを別の名前のremoteから取っているとき
  mise run mutation:changed -- --dry-run                # 何が流れるかだけを見る
  ```

- 回したら、PRの本文の「確認したこと」に、SurvivedとNoCoverageの数と、1つずつ読んだかを書きます。回さなかったら、その理由を書きます（pull-requestスキル）。
- 残った変異は1つずつコードを読み、試験が足りないのか、どの入力でも結果が変わらない等価な変異なのかを決めます。画面の側で等価なら、理由を付けて`npx mutator accept <key> --reason "<理由>"`で記録し、`mutator.accepted.json`をコミットします。

**節目（正式版の前）に**

- 正式版の前に、画面の側の全体と、Rustの主なクレートの一覧の全体を回します（releaseスキル）。ベータ版では回しません。コマンドとクレートの一覧は開発の手順の「When to run mutation testing」の表にあります。一覧を変えるときは、その表を直します。
- 長くかかる（画面の側は手元で40分から2時間半）ので、端末から切り離して流します。
- 結果は記録のIssueにコメントします。いまは#550で、#550を閉じたあとは節目ごとに記録のIssueを作ります。結果はリポジトリの文書に書きません。数字は計測の条件（版、並列の数、機械）で変わり、文書に書くと品質の保証と読まれやすいためです。
- 報告には対象の範囲と計測の条件（版、並列の数、機械）を添え、率を品質の保証として示しません。

**取り違えやすい点**

- 画面の側で、`--include`で絞って回したあとに全体を回すときと、前回と違う範囲に絞るときは、`--full-dry-run`を付けます。付けないと、試験が通るファイルの変異までNoCoverageになることがあります。
- 画面の側は`npm run test:mutation`（`vitest.mutator.config.js`）で回します。ほかの設定で回すと、キャッシュのせいで率が0%近くに落ちます。1つの作業ツリーで2つを同時に回しません。
- Rustで`-j`を付けて並列に回すときは、`CARGO_TARGET_DIR`を設定しません。`native/core`は`--in-place`で1つずつ回し、回している間はそのクレートのファイルを直しません。
- proptestを使うクレートは`PROPTEST_DISABLE_FAILURE_PERSISTENCE=1`で回します。
- `-- --lib`で回したときは単体の試験しか流れないので、報告に流した試験の種類も書きます。
