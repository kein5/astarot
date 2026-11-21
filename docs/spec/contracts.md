# 契約

変えてはいけない約束と、それを確かめているテスト。新しい機能や変更は、ここにある契約を破らないようにする。契約を変えるときは、理由と移行の手順を決めてからこの表を直す。

根拠の欄の`AGENTS.md`と`PRODUCT.md`は、ユーザーと合意した方針である。テストの欄が「手動」の契約は、変更のたびにレビューか実機の確認で守る。

## 互換性

| ID | 契約 | 根拠 | 確かめているもの |
|---|---|---|---|
| CT-01 | IPCのメッセージの形（`endpoint`と`data`の要求、`status`と`endpoint`と`result`の応答）と状態コードの意味を変えない | `AGENTS.md`「互換性」 | `native/core/tests/dispatch.rs`（受付と再試行）、`native/core/tests/endpoint_coverage.rs`の`the_ui_receives_the_answer_of_every_voice_endpoint_the_core_serves`（音声のエンドポイントが両側にある） |
| CT-02 | サイドカーが送る通知の名前はすべて`run_mapping`に定義する | 送る時点の例外を防ぐ | `native/core/src/controller/mod.rs`の`RUN_MAPPING`（通知の名前は1つの表にあり、表にない名前は送る時点で止まる）。`native/core/tests/run_mapping.rs`が、送る箇所に書いた名前、`format!`のひな形から作る名前、設定のキーから作るモデルの一覧と選択の名前を表と照らす |
| CT-03 | 既存のエンドポイント名、設定キー、OSCのアドレス、内部の識別子`VRCT`は、名前を変えるという理由だけで置き換えない。保存先やアプリIDを変えるときは移行の処理を用意する | `AGENTS.md`「互換性」、`docs/voice-stack/project-rename.md` | `tests/voice/test_fork_distribution_identity.py`、`tests/voice/test_config_and_distribution.py` |
| CT-04 | `config.json`は壊れた値や知らないキーがあっても起動できる。無効な値は保存しない | `native/core/src/config/` | `native/core/tests/config_versions.rs`、`config_reference.rs`、`settings_endpoints.rs` |
| CT-05 | 仕様書の一覧（`docs/spec/reference/`）はコードから生成したものと一致する | この仕様書 | 中核の一覧（`tools/spec_core_catalog.json`）が中核と一致することは`native/core/tests/spec_catalog.rs`、一覧がそれとUIのコードから作ったものと一致することは`tests/devtools/test_spec_catalog.py`（`python tools/spec_catalog.py --check`） |

## 利用者の操作と同意

| ID | 契約 | 根拠 | 確かめているもの |
|---|---|---|---|
| CT-10 | モデルの取得は、ライセンスとサイズを示して同意を得てから行う。起動時には自動で取得しない（`AUTO_DOWNLOAD_MODELS` は 0.5.0 で引退。キーは互換のために残す） | `AGENTS.md`「ユーザーの操作と同意」 | `native/core/tests/downloads.rs`、`native/ops`の`downloads/manager_tests.rs` |
| CT-11 | 取得できるモデルは版、サイズ、SHA-256、ライセンスを固定してカタログに載せる。非商用など制限のあるライセンスのモデルは既定にしない | `AGENTS.md`「配布物とライセンス」 | `native/core/tests/downloads.rs`（チャット読み取りの表との照合を含む）、`native/ocr-runtime/tests/models.rs`、`src-ui/logics/configs/ctranslate2License.test.ts` |
| CT-12 | 画面の変更によって、マイクの有効化、モデルの取得、メッセージの送信、音声経路の変更が勝手に起きない | `AGENTS.md`「ユーザーの操作と同意」 | 手動 |
| CT-13 | ホットキーは既定で割り当てない。設定画面を開いている間は無効にする | `docs/voice-stack/quick-chat-design.md` | `native/core/tests/config_reference.rs`（既存の割り当ての引き継ぎ）、手動 |
| CT-14 | クラウドへ送るのは、利用者がキーを登録してエンジンを選んだときだけ | `docs/spec/cross-cutting.md` | `src-ui/logics/configs/cloudTranscription.test.ts`、手動 |

## 停止と独立した制御

| ID | 契約 | 根拠 | 確かめているもの |
|---|---|---|---|
| CT-20 | 停止の要求（`stop_voice`、`mute_voice`など）は、ほかの処理を待たずにすぐ処理する | `PRODUCT.md`、`DESIGN.md` | `native/core/tests/dispatch.rs` |
| CT-21 | 「読み上げ停止」は読み上げだけを止め、読み上げのオンオフとミュートは変えない。停止の前に積まれた音声はあとで鳴らない | `DESIGN.md` | `native/core/tests/voice.rs`、`native/audio-routing`の`voice_route/tests.rs` |
| CT-22 | 読み上げ（TTS）とRVCは独立したスイッチで、片方の操作がもう片方を止めない | `AGENTS.md`「停止と独立した制御」 | `native/core/tests/voice.rs` |
| CT-23 | ミュートは再開の確認が済むまで解除しない。管理対象の経路とWindowsの出力デバイスでは読み上げと変換音声、そのスピーカーモニターを止め、再起動後もミュートを保つ。モニターの待機音声は捨て、解除後に古い音声を鳴らさない。TTS・RVCのスイッチと変換ワーカーはミュートで変えない | `docs/adr/adr-005-managed-microphone-lifetime.md`、[停止とミュート](cross-cutting.md#停止とミュート) | `native/core/tests/voice.rs`、`native/audio-routing`の`voice_route/tests.rs`と`mute_state.rs`の単体の試験、`tests/voice_gate_private.rs`、`tests/direct_suppression_private.rs`（私用のPipeWire） |
| CT-24 | Quick Chat、VRパネル、ホットキーの振る舞いを保つ | `AGENTS.md`、`PRODUCT.md` | `tests/platform/test_native_quick_chat.py`（リリース前に`tools/native_acceptance.py`の`quick_chat`のグループで流すGUIの試験）、`src-ui/logics/common/vrPanelWire.test.ts`、手動 |

## 秘密情報と安全

| ID | 契約 | 根拠 | 確かめているもの |
|---|---|---|---|
| CT-30 | APIキーとトークンの値をログに書かない。会話の本文を診断ログに書かない | `native/core/src/log.rs` | `native/core/src/log.rs`の単体の試験 |
| CT-31 | VRパネルからは、APIキー、トークン、モデル取得、ファイルを開く操作、終了、更新を要求できない | `src-ui/logics/common/vrPanelWire.ts` | `src-ui/logics/common/vrPanelWire.test.ts` |
| CT-32 | WebSocketはトークンのない接続を拒み、すべてのアドレスでは待ち受けない | `native/adapters/src/websocket.rs` | `native/adapters/tests/websocket.rs`、`native/adapters/tests/tls.rs` |
| CT-33 | 上流VRCTのチャット吹き出し検出モデルを含むOCRの重み、許諾のないモデル、Mia2026の音声を配布物に入れない | `AGENTS.md`「配布物とライセンス」 | `tests/voice/test_ocr_distribution.py`、`tests/voice/test_distribution_artifacts.py` |

## 画面と文言

| ID | 契約 | 根拠 | 確かめているもの |
|---|---|---|---|
| CT-40 | 表示する文言は`locales/`に置き、`en.yml`と`ja.yml`は必ずそろえる | `AGENTS.md`「UI」 | `tools/i18n_gate/check.mjs`（`python tools/dev.py check`の文言の検査。全キーが両方の言語にあり、値が空でないこと）、`src-ui/logics/configs/cloudTranscription.test.ts` |
| CT-41 | React 18、CSS Modules、Jotai、i18nextの構成を保ち、リモートのフォントを入れない | `AGENTS.md`「UI」 | 手動 |
| CT-42 | 言語の変更は要求ごとに対応づけ、失敗したら読み直す | `src-ui/logics/main/languageMutationCoordinator.ts` | `languageMutationCoordinator.test.ts`、`languageMutations.test.ts` |
| CT-43 | 未保存の変更があるまま離れるときは確かめる | `cross-cutting.md` | `src-ui/logics/voice/saveBar.test.ts`（保存バーの集計）、`src-ui/logics/voice/settingsNavigation.test.ts`（保存バーの確認がフォームの確認より先に尋ねられる送り方）、手動（ダイアログ） |
