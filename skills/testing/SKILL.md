---
name: testing
description: ASTAROTの試験を書き、流し、節目で変異テストを回す手順。変更に合う試験の層（UIのVitest、Rustのクレートと中核、Playwrightの結合テスト、契約、配布の道具のpytestとunittest、実機の受け入れ試験）の選び方、揺らがない試験の書き方（出来事を待つ、時刻を渡す、外のサービスやマイクやモデルを使わない、落ちたときに状態を出す）、checkのスコープの選び方、変更した部分の変異テストと正式版の前の全体の変異テスト（#550）の運用と結果の残し方を扱う。試験を書く、直す、どの検査を流すか決める、変異テストを回す、その結果を読むときに使う。Use when writing or fixing tests in ASTAROT, choosing which checks to run, or running and reporting mutation testing.
---

# 試験を書いて回す

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
