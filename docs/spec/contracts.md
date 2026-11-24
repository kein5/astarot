# Contracts

[日本語版](#契約日本語版)

Promises that must not change, and the tests that check them. New features and changes must not break the contracts here. To change a contract, first decide the reason and the migration steps, then update this table.

`AGENTS.md` and `PRODUCT.md` in the Basis column are policies agreed with the user. A contract whose Checked by column says "Manual" is kept by review or by a check on real hardware at every change.

## Compatibility

| ID | Contract | Basis | Checked by |
|---|---|---|---|
| CT-01 | Do not change the form of IPC messages (requests with `endpoint` and `data`, responses with `status`, `endpoint` and `result`) or the meaning of the status codes | `AGENTS.md`, "Compatibility" | `native/core/tests/dispatch.rs` (receiving and retrying), `the_ui_receives_the_answer_of_every_voice_endpoint_the_core_serves` in `native/core/tests/endpoint_coverage.rs` (the voice endpoints exist on both sides) |
| CT-02 | Every notification name the sidecar sends is defined in `run_mapping` | Prevents exceptions at send time | `RUN_MAPPING` in `native/core/src/controller/mod.rs` (notification names are in one table, and a name missing from the table stops at send time). `native/core/tests/run_mapping.rs` checks against the table the names written where notifications are sent, the names built from `format!` templates, and the model list and selection names built from settings keys |
| CT-03 | Existing endpoint names, settings keys, OSC addresses and the internal identifier `VRCT` are not replaced only for the sake of renaming. When the storage location or the app ID changes, provide a migration | `AGENTS.md`, "Compatibility", `docs/voice-stack/project-rename.md` | `tests/voice/test_fork_distribution_identity.py`, `tests/voice/test_config_and_distribution.py` |
| CT-04 | The app starts even when `config.json` holds broken values or unknown keys. Invalid values are not saved. But values saved by a newer version than the running one are not used, and are written back to the file (#560) | `native/core/src/config/` | `native/core/tests/config_versions.rs`, `config_reference.rs`, `settings_endpoints.rs` |
| CT-05 | The spec's lists (`docs/spec/reference/`) match what is generated from the code | This specification | `native/core/tests/spec_catalog.rs` checks that the core's list (`tools/spec_core_catalog.json`) matches the core; `tests/devtools/test_spec_catalog.py` (`python tools/spec_catalog.py --check`) checks that the lists match what is built from it and from the UI code |

## User actions and consent

| ID | Contract | Basis | Checked by |
|---|---|---|---|
| CT-10 | A model is downloaded only after showing its license and size and getting consent. Nothing is downloaded automatically at startup (`AUTO_DOWNLOAD_MODELS` was retired in 0.5.0; the key stays for compatibility) | `AGENTS.md`, "User actions and consent" | `native/core/tests/downloads.rs`, `downloads/manager_tests.rs` in `native/ops` |
| CT-11 | Models that can be downloaded are listed in the catalog with their version, size, SHA-256 and license pinned. A model under a restricted license, such as non-commercial use, is not made the default | `AGENTS.md`, "Packages and licenses" | `native/core/tests/downloads.rs` (including the comparison with the chat reading table), `native/ocr-runtime/tests/models.rs`, `src-ui/logics/configs/ctranslate2License.test.ts` |
| CT-12 | A change to the screens does not turn on the microphone, download a model, send a message or change the audio route on its own | `AGENTS.md`, "User actions and consent" | Manual |
| CT-13 | Hotkeys are not assigned by default. They are turned off while the settings screen is open | `docs/voice-stack/quick-chat-design.md` | `native/core/tests/config_reference.rs` (carrying over existing assignments), manual |
| CT-14 | Data goes to a cloud service only when the user has registered a key and chosen that engine | `docs/spec/cross-cutting.md` | `src-ui/logics/configs/cloudTranscription.test.ts`, manual |

## Stop and independent controls

| ID | Contract | Basis | Checked by |
|---|---|---|---|
| CT-20 | Stop requests (`stop_voice`, `mute_voice` and others) are handled at once, without waiting for other work | `PRODUCT.md`, `DESIGN.md` | `native/core/tests/dispatch.rs` |
| CT-21 | "Stop speech" stops only TTS and does not change the TTS on/off state or mute. Audio queued before the stop does not play later | `DESIGN.md` | `native/core/tests/voice.rs`, `voice_route/tests.rs` in `native/audio-routing` |
| CT-22 | TTS and RVC have independent switches, and operating one does not stop the other | `AGENTS.md`, "Stop and independent controls" | `native/core/tests/voice.rs` |
| CT-23 | Mute is not released until the resume has been confirmed. On the managed route and the Windows output device, mute stops TTS, the converted voice and their speaker monitor, and stays on after a restart. Audio waiting for the monitor is dropped, and old audio does not play after mute is released. Mute does not change the TTS and RVC switches or the conversion worker | `docs/adr/adr-005-managed-microphone-lifetime.md`, [Stop and mute](cross-cutting.md#停止とミュート) | `native/core/tests/voice.rs`, the unit tests in `voice_route/tests.rs` and `mute_state.rs` of `native/audio-routing`, `tests/voice_gate_private.rs`, `tests/direct_suppression_private.rs` (private PipeWire) |
| CT-24 | Keep the behavior of Quick Chat, VR panels and hotkeys | `AGENTS.md`, `PRODUCT.md` | `tests/platform/test_native_quick_chat.py` (a GUI test run before a release in the `quick_chat` group of `tools/native_acceptance.py`), `src-ui/logics/common/vrPanelWire.test.ts`, manual |

## Secrets and safety

| ID | Contract | Basis | Checked by |
|---|---|---|---|
| CT-30 | API key and token values are not written to logs. Conversation text is not written to the diagnostic log | `native/core/src/log.rs` | The unit tests in `native/core/src/log.rs` |
| CT-31 | The VR panel cannot request API keys, tokens, model downloads, actions that open files, quitting or updating | `src-ui/logics/common/vrPanelWire.ts` | `src-ui/logics/common/vrPanelWire.test.ts` |
| CT-32 | WebSocket refuses connections without a token and does not listen on all addresses | `native/adapters/src/websocket.rs` | `native/adapters/tests/websocket.rs`, `native/adapters/tests/tls.rs` |
| CT-33 | OCR weights including upstream VRCT's chat bubble detection model, models without permission, and Mia2026's voice are not put in distributions | `AGENTS.md`, "Packages and licenses" | `tests/voice/test_ocr_distribution.py`, `tests/voice/test_distribution_artifacts.py` |

## Screens and text

| ID | Contract | Basis | Checked by |
|---|---|---|---|
| CT-40 | Text shown on screen lives in `locales/`, and `en.yml` and `ja.yml` are always kept in step | `AGENTS.md`, "UI" | `tools/i18n_gate/check.mjs` (the string check in `python tools/dev.py check`: every key exists in both languages and no value is empty), `src-ui/logics/configs/cloudTranscription.test.ts` |
| CT-41 | Keep the React 19, CSS Modules, Jotai and i18next stack, and do not add remote fonts | `AGENTS.md`, "UI" | Manual |
| CT-42 | Each language change is matched to its request, and the state is read again on failure | `src-ui/logics/main/languageMutationCoordinator.ts` | `languageMutationCoordinator.test.ts`, `languageMutations.test.ts` |
| CT-43 | Settings save by themselves; leaving with a refused or unsaved value drops it without asking (#1111) | `cross-cutting.md` | `src-ui/logics/voice/useSettingsDraft.test.ts` (no leave guard), `src-ui/views/app/config_page/topbar/AppliesNow.test.ts` (the top bar), `tests/integration/autoSave.spec.ts` |

---

# 契約（日本語版）

変えてはいけない約束と、それを確かめているテスト。新しい機能や変更は、ここにある契約を破らないようにする。契約を変えるときは、理由と移行の手順を決めてからこの表を直す。

根拠の欄の`AGENTS.md`と`PRODUCT.md`は、ユーザーと合意した方針である。確かめているものの欄が「手動」の契約は、変更のたびにレビューか実機の確認で守る。

## 互換性

| ID | 契約 | 根拠 | 確かめているもの |
|---|---|---|---|
| CT-01 | IPCのメッセージの形（`endpoint`と`data`の要求、`status`と`endpoint`と`result`の応答）と状態コードの意味を変えない | `AGENTS.md`「互換性」 | `native/core/tests/dispatch.rs`（受付と再試行）、`native/core/tests/endpoint_coverage.rs`の`the_ui_receives_the_answer_of_every_voice_endpoint_the_core_serves`（音声のエンドポイントが両側にある） |
| CT-02 | サイドカーが送る通知の名前はすべて`run_mapping`に定義する | 送る時点の例外を防ぐ | `native/core/src/controller/mod.rs`の`RUN_MAPPING`（通知の名前は1つの表にあり、表にない名前は送る時点で止まる）。`native/core/tests/run_mapping.rs`が、送る箇所に書いた名前、`format!`のひな形から作る名前、設定のキーから作るモデルの一覧と選択の名前を表と照らす |
| CT-03 | 既存のエンドポイント名、設定キー、OSCのアドレス、内部の識別子`VRCT`は、名前を変えるという理由だけで置き換えない。保存先やアプリIDを変えるときは移行の処理を用意する | `AGENTS.md`「互換性」、`docs/voice-stack/project-rename.md` | `tests/voice/test_fork_distribution_identity.py`、`tests/voice/test_config_and_distribution.py` |
| CT-04 | `config.json`は壊れた値や知らないキーがあっても起動できる。無効な値は保存しない。ただし、自分より新しい版が保存した値は、使わずにファイルへ書き戻す（#560） | `native/core/src/config/` | `native/core/tests/config_versions.rs`、`config_reference.rs`、`settings_endpoints.rs` |
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
| CT-21 | 「読み上げを停止」は読み上げだけを止め、読み上げのオンオフとミュートは変えない。停止の前に積まれた音声はあとで鳴らない | `DESIGN.md` | `native/core/tests/voice.rs`、`native/audio-routing`の`voice_route/tests.rs` |
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
| CT-41 | React 19、CSS Modules、Jotai、i18nextの構成を保ち、リモートのフォントを入れない | `AGENTS.md`「UI」 | 手動 |
| CT-42 | 言語の変更は要求ごとに対応づけ、失敗したら読み直す | `src-ui/logics/main/languageMutationCoordinator.ts` | `languageMutationCoordinator.test.ts`、`languageMutations.test.ts` |
| CT-43 | 設定は自分で保存し、断られた値や保存していない値のまま離れると何も聞かずに捨てる（#1111） | `cross-cutting.md` | `src-ui/logics/voice/useSettingsDraft.test.ts`（離れるときの確認がない）、`src-ui/views/app/config_page/topbar/AppliesNow.test.ts`（上のバー）、`tests/integration/autoSave.spec.ts` |
