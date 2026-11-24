# テストと品質計測の概要

この文書は、`README.md`と`docs/readmes/README.ja.md`に表示するテスト状態・行カバレッジ・ミューテーション率の各シールドの意味、テストの種類ごとの内訳、計測条件、JSONの生成元と更新手順をまとめた正本です。

## テストの3区分と対応づけ

ASTAROTのテストは、単体テスト・結合テスト・E2Eテストの3種類に分けて集計します。開発ツールや配布契約を確かめるPythonテストは、この3種類には入れず別区分として一覧に載せます。

| 区分 | 対象 | 確認する範囲 | 実行の場所 | 更新のタイミング |
|---|---|---|---|---|
| 単体テスト | Rustのソース内テスト（`native/*/src`、`src-tauri/src`）、画面側ロジックのVitest（`src-ui/logics/**/*.test.*`） | 関数・状態機械・設定パース・ルーティング計算などの単体振る舞い | CI（`voice-tests.yml`、`app-tests-windows.yml`、`build-linux.yml`） | `develop`へのpushごと |
| 結合テスト | Rustの`native/*/tests`（`core-integration`、`crates`、`headless`のPipeWire試験）、画面側部品・経路のVitest（`src-ui/views/**/*.test.*`） | 複数モジュール・実コア・偽サービス・PipeWire・画面部品の組み合わせ | CI（`voice-tests.yml`） | `develop`へのpushごと |
| E2Eテスト | 実コア＋Playwright画面試験（`tests/integration/`）、Windows実インストーラー更新試験（`tests/installer/`）、実アプリ受け入れ試験（`tools/native_acceptance.py`）、SERGULATH実機スイート（Windows PC＋Steam Frame） | 実アプリ・実インストーラー・実ヘッドセットでの一連の動作 | CI（`voice-tests.yml`、`installer-update-tests.yml`）および実機 | CI分はpush・PRごと。実アプリ受け入れとSERGULATHはベータ公開後・安定版前などの節目で実行（pushごとには更新されません） |
| 開発ツール・配布契約（別区分） | `tests/devtools/`、`tests/voice/`、`tools/i18n_gate/i18n_gate.test.mjs`、`tools/writing_gate/writing_gate.test.mjs` | 開発CLI、カタログ、配布物ポリシー、ライセンス、文章・文言ゲート | CI（`voice-tests.yml`） | `develop`へのpushごと |

## 件数の内訳（2026-11-24時点、`develop`）

件数はシールドには載せず、この表で管理します。実機の確認結果は環境と確認日を添えて記録します。

| 区分 | スイート | 件数（目安） | 実行の場所 |
|---|---|---:|---|
| 単体テスト | 画面側ロジック（`src-ui/logics/**/*.test.*`） | 126ファイル・1,224件 | CI（Linux・Windows） |
| 単体テスト | Rustソース内テスト（`native/*/src`、18クレート） | 929件（`#[test]`・`#[tokio::test]`定義数） | CI（Linux・Windows） |
| 単体テスト | Tauriアプリ本体ソース内テスト（`src-tauri/src`） | 123件 | CI（Windows`app-tests-windows.yml`・Linux`build-linux.yml`） |
| 結合テスト | 画面側部品・経路（`src-ui/views/**/*.test.*`） | 143ファイル・950件 | CI（Linux・Windows） |
| 結合テスト | Rust結合テスト（`native/*/tests`、15クレート） | 837件（`#[test]`・`#[tokio::test]`定義数） | CI（Linux・Windows） |
| E2Eテスト | Playwright＋実コア（`tests/integration/*.spec.ts`） | 11件（Chromium・WebKit） | CI（Linux・Windows） |
| E2Eテスト | Windowsインストーラー更新シナリオ（`tests/installer/`） | 1スイート（NSIS実インストーラー） | CI（Windows`installer-update-tests.yml`） |
| E2Eテスト | 実アプリ受け入れテスト（`tools/native_acceptance.py`・`tests/platform/`） | 5グループ・23件 | 実機（Linuxデスクトップ） |
| E2Eテスト | SERGULATH実機スイート（`kein5/sergulath`） | スイート定義に依存 | 実機（Windows PC＋Steam Frame） |
| 開発ツール・配布契約（別区分） | `tests/devtools/` | 319件 | CI（Linux・Windows） |
| 開発ツール・配布契約（別区分） | `tests/voice/` | 201件 | CI（Linux・Windows） |
| 開発ツール・配布契約（別区分） | `tools/i18n_gate/`・`tools/writing_gate/` | 2ファイル・29件 | CI（Linux・Windows） |

### 実機E2Eの更新タイミングと鮮度

SERGULATH実機スイートと`tools/native_acceptance.py`は実機（Windows PC＋Steam Frame、またはLinuxデスクトップ）で実行するため、`develop`へのpushごとには自動更新されません。ベータ公開後の実機確認や安定版リリース前などの節目で実行します。

E2Eシールドは、`0.7.0-beta.1`公開後のSERGULATH実機確認の結果がそろった時点で初版を追加します。実機結果が古くなる場合は、シールドの文言に最後の確認日を含めて鮮度を追えるようにします（例：`passing (2026-11-24)`）。

## 行カバレッジとミューテーション率

スコアは品質の保証ではなく、テストの抜けを見つけるための指標です。

| 指標 | 対象 | 初回・基準の計測値 | 計測日・条件 | 出所 |
|---|---|---|---|---|
| 画面側の行カバレッジ | `src-ui/**/*.{js,jsx,ts,tsx}`（試験・基盤・型宣言・`.css.ts`を除く） | 83.2%（12,219 / 14,682行） | 2026-11-24、`develop` `711b2a793`、`npm run test:coverage`（Vitest v8） | CI自動更新（`voice-tests.yml`→`publish-badges.yml`） |
| Rustの行カバレッジ | `tools/dev.py`の`NATIVE_CRATES`（17クレート合計） | 79.9%（未実行12,634行） | 2026-11-24、PR #1076、`tools/rust_coverage.py`（`cargo-llvm-cov`、ubuntu-latest） | CI自動更新（`voice-tests.yml`→`publish-badges.yml`） |
| Rustのミューテーション率 | 固定一覧の中核ファイルのみ（`docs/development.md`の「ミューテーションテストを回す場面」の表） | 96.0%（Killed 911、Timeout 14、Survived 39、Unviable 33） | 2026-11-23、`develop` `a38cb65dd`、`cargo-mutants` 27.1.0、Rust 1.100.0、Linux x86_64 | [Issue #550](https://github.com/kein5/astarot/issues/550)、節目で手動更新 |
| 画面側のミューテーション率 | `src-ui/`対象全体（`mutator.config.mjs`） | 未掲載（段階4の全件計測後に掲載） | 段階4完了時に[Issue #550](https://github.com/kein5/astarot/issues/550)へ記録 | 節目で手動更新 |

## シールドJSONの生成元と更新手順

外部サービスは増やさず、GitHub上のJSON（`shields.io`のエンドポイント形式）をREADMEのシールドから読みます。値がまだ無いシールド（画面側のミューテーション率、実機E2E）は先行して付けません。

### 1. CI自動更新のJSON（`badges`ブランチ）

- **置き場所**：`badges`ブランチの直下（`https://raw.githubusercontent.com/kein5/astarot/badges/<ファイル名>`）。
- **対象ファイル**：`coverage-ui.json`、`coverage-rust.json`、`tests-unit.json`、`tests-integration.json`、および出所と日時を記録する`metadata.json`。
- **生成と公開の仕組み**（次の順で更新します）
  1. `.github/workflows/voice-tests.yml`が`develop`へのpush（または手動実行）で`headless`（`npm run test:coverage`と`tools/test_badges.py ui`）と`rust-coverage`（`tools/rust_coverage.py --json`と`tools/test_badges.py rust-coverage`）を実行し、JSONをアーティファクトとして出力します。
  2. `voice-tests.yml`の完了を受けて`.github/workflows/publish-badges.yml`が動き、`tools/test_badges.py publish`でアーティファクトと各ジョブの合否・`app-tests-windows.yml`の最新結果を集計し、GitHub Git Data APIで`badges`ブランチへ書き込みます（変更が無ければコミットしません）。
- **初回の起動**：この仕組みを`develop`へマージすると、`develop`へのpushで`voice-tests.yml`→`publish-badges.yml`が順に動き、`badges`ブランチと4つのJSONが作られます。手動で作り直すときは`gh workflow run publish-badges.yml --repo kein5/astarot --ref develop -f run_id=<voice-testsのrun ID>`を実行します。

### 2. 節目・手動更新のJSON（`docs/testing/badges/`）

- **置き場所**：`develop`ブランチの`docs/testing/badges/`配下（`https://raw.githubusercontent.com/kein5/astarot/develop/docs/testing/badges/<ファイル名>`）。PRを通じて変更履歴と計測根拠を残します。
- **現在のファイル**：`docs/testing/badges/mutation-rust.json`（Rust中核ファイル固定一覧のミューテーション率、96.0%、2026-11-23計測）。
- **更新手順**（次の順で更新します）
  1. 節目計測（`docs/development.md`の「ミューテーションテストを回す場面」または実機E2E）を実行し、結果を[Issue #550](https://github.com/kein5/astarot/issues/550)や所定の記録先へ残します。
  2. `docs/testing/badges/<対象>.json`の`message`（E2Eは確認日を含む）と`color`を更新し、この文書の表の計測値・計測日・条件も同時に更新してPRを出します。
  3. 初めて値がそろったシールド（画面側ミューテーション率`mutation-ui.json`、E2Eテスト`tests-e2e.json`）は、そのPRで`README.md`と`docs/readmes/README.ja.md`のシールドも有効化します。
