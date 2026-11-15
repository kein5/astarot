# 中核の統合と Python 同梱の終了（#285）

Python のサイドカーの中核（`mainloop.py`、`controller.py`、`config.py`）を Rust の `native/core`（vrct-core）へ移し、アプリのプロセスの中で動かす作業の記録です。2026-11-15 時点の状態を書きます。

## 構成

```mermaid
flowchart LR
  ui["UI（main ウィンドウ）"] -- "要求の行（1行の JSON）" --> host["src-tauri: backend_host.rs"]
  host -- "応答と通知の行（Channel）" --> ui
  host --> core["native/core（vrct-core）"]
  core --> d["dispatch: キュー・ロック・初期化前の待機"]
  d --> c["controller: 各エンドポイント"]
  c --> crates["native/ の各クレート（ops、adapters、speech-server …）"]
```

- UI は今までどおり `sidecarSession.js` でバックエンドと話します。`backendCommand.js` が、Python のサイドカーと Rust の中核のどちらかを、shell プラグインの `Command` と同じ形で渡します。
- 要求と応答の形式、状態コード、エラーの本体、ロックの規則は [IPC プロトコル](../spec/ipc-protocol.md) のままです。UI 側の変更は、この切り替えの部分だけです。
- 設定、ログ、モデルの保存先は Python のサイドカーと同じです。同じ `config.json` を読み書きします。

## 切り替え

アプリを環境変数 `VRCT_BACKEND=core` で起動したときだけ Rust の中核を使います。既定は Python のサイドカーです。すべてのエンドポイントがつながるまでは、この切り替えを開発用として残します。

## 統合テスト

`cargo test --locked --manifest-path native/core/Cargo.toml` で動きます。CI では `voice-tests.yml` の `core-integration`（ubuntu-latest と windows-latest）が実行します。モデル、音声デバイス、外部のネットワークは使いません。

| 試験 | 確かめること |
|---|---|
| `tests/lifecycle.rs` | 起動時の通知の順序と `/run/initialization_complete`、終了と設定の保存、watchdog、入力が閉じたときの終了、古い版の設定の移行と通知、保存の失敗と回復 |
| `tests/config_reference.rs` | Python が書いた設定ファイル 50 通りを Windows と Linux の規則で読み、Python と同じ内容を書き戻すこと（基準は Python を実際に動かして作る） |
| `tests/error_codes.rs` | エラーコードと本体の形が [エラーコード一覧](../spec/reference/error-codes.md) と一致すること |
| `tests/dispatch.rs` | 404、500、ロックの順序、20 秒と 30 秒で返す 423、停止の要求の即時処理、VR パネルの中継の制限 |
| `tests/endpoint_coverage.rs` | 実装したエンドポイントが仕様の一覧に載っていて、初期化前に待つかどうかと即時処理の区分が一致すること。残りが下の一覧と一致すること |
| `tests/speech_servers.rs` | speech.cpp サーバの設定、起動と停止、世代、自分で終わったサーバの報告、終了時の後片付け |
| `tests/downloads.rs` | モデル取得の同意とカタログの版、状態、取り消し、検証して公開すること、設定への適用とその拒否（`settings_changed`、`model_target_busy`）、ハードウェアの確認、終了時の停止 |
| `tests/telemetry.rs` | 通知に答えるまで何も送らないこと、答えの検査（`telemetry_notice_invalid`）、`VRCT_TELEMETRY=off`、送る内容の表示、エラーコードの送信、終了後に送らないこと |
| `tests/adapters_servers.rs` | WebSocket サーバとトークン（101 と 403）、ホスト・ポート・証明書の変更と巻き戻し、OBS のページとトークン、起動時の再開と失敗の通知、`WEBSOCKET_*` と `OBS_BROWSER_SOURCE_*` のエラーコード |
| `tests/adapters_osc.rs` | OSC の送り先の検査、入力中の表示の送信、VRChat のミュートとの同期、OSCQuery を失ったときの順序、VRChat の有無、終了後に何も変えないこと |

Python の `src-python/test/test_native_core_reference.py` は、Python 側の設定の規則が変わったのに基準データを作り直していないとき失敗します。

## Python の試験の棚卸し

`tests/` の Python の試験（関数 1,353 件）を、「新しい接続面で再カバーするもの」とそれ以外に分けました。

| 区分 | 内容 | 扱い |
|---|---|---|
| A | サイドカーを動くアプリとして試すもの（エンドポイント、設定の移行、起動と終了、モデル取得、エラーコード） | `native/core/tests/` で再カバーする |
| A-u | 移植先のクレートがまだ無いサイドカーの処理（リアルタイム音声認識のセッション、speech.cpp の ASR クライアント、声質変換の入力の切り替え） | 移植するときに一緒に再カバーする |
| B | 移植済みのクレートの単体の振る舞い | 各クレートの試験と同等性の試験がすでに持つ |
| C | ビルド、配布、開発用の道具、ブラウザや GUI の試験 | バックエンドの言語に関係なく残す |
| D | Python と一緒に消えるもの（PyInstaller、Seed-VC、CTranslate2、Python の実行環境の準備） | コードと一緒に引退させる |
| E | 実機やモデルが要るもの | headless の CI では動かさない |

区分 A のうち、再カバーが済んだもの:

| Python の試験 | 再カバーした試験 |
|---|---|
| `tests/voice/test_runtime_paths.py`（設定の保存先）、`tests/platform/test_runtime_settings.py` | `lifecycle.rs`、`config_reference.rs` |
| `tests/voice/test_quick_chat_config.py`、`test_vc_settings.py`、`test_realtime_settings.py`（設定の移行） | `config_reference.rs` |
| `tests/platform/test_native_backend.py`（初期化の完了、終了、設定が次の起動に残ること） | `lifecycle.rs` |
| `tests/voice/test_priority_cancel.py`（停止の要求がキューを飛ばすこと） | `dispatch.rs` |
| `tests/voice/test_speech_server_controls.py`、`test_speech_server_end_owner.py`（サーバの部分） | `speech_servers.rs` |
| `tests/voice/test_model_download_controller.py`、`test_model_download_policy.py` | `downloads.rs` |
| `tests/voice/test_telemetry_client.py`（エンドポイントの部分） | `telemetry.rs` |
| `tests/voice/test_security_regressions.py`（WebSocket と OBS の部分）と `src-python/test/` の WebSocket・OBS・OSC の試験 | `adapters_servers.rs`、`adapters_osc.rs` |

残りの区分 A（TTS、声質変換、リアルタイム音声認識、メッセージの送信）は、それぞれの機能をつなぐときに再カバーします。

## 往復の試験について

Issue のコメントは、音声認識・翻訳・TTS・声質変換・OCR の往復を統合テストで確かめるよう求めています。この PR の時点では、どれもまだ中核につながっていません。往復の試験は、次の形で用意する予定です。どれも headless の CI で動き、モデルを使いません。

- 翻訳: ローカル翻訳は偽のエンジン、オンラインのプロバイダは 127.0.0.1 の偽のサーバを相手に、`/run/send_message_box` から OSC・WebSocket・履歴までを確かめる
- TTS と音声認識: speech.cpp の偽のサーバ（`tests/fixture/fake_speech.rs` を広げる）を相手に、合成の要求と再生への受け渡し、認識結果の通知までを確かめる
- 声質変換: `vrct-rvc-worker` の代わりの小さな実行ファイルを相手に、起動と停止、失敗の扱いを確かめる
- OCR: 撮影を差し替えて画像を与え、偽の認識エンジンを相手に通知までを確かめる

## 残っているエンドポイント

次のエンドポイントは、まだ Rust の中核にありません。要求すると 404 を返します。`tests/endpoint_coverage.rs` がこの一覧と実装を照らし合わせます。

<!-- remaining-endpoints:begin -->
184 件。

- 翻訳のプロバイダ（#277）と翻字（58 件）: `/delete/data/deepl_auth_key`、`/delete/data/gemini_auth_key`、`/delete/data/groq_auth_key`、`/delete/data/openai_auth_key`、`/delete/data/openai_compatible_auth_key`、`/delete/data/openrouter_auth_key`、`/delete/data/plamo_auth_key`、`/get/data/connected_lmstudio`、`/get/data/connected_ollama`、`/get/data/deepl_auth_key`、`/get/data/gemini_auth_key`、`/get/data/groq_auth_key`、`/get/data/lmstudio_url`、`/get/data/openai_auth_key`、`/get/data/openai_compatible_auth_key`、`/get/data/openai_compatible_url`、`/get/data/openrouter_auth_key`、`/get/data/plamo_auth_key`、`/get/data/selectable_gemini_model_list`、`/get/data/selectable_groq_model_list`、`/get/data/selectable_lmstudio_model_list`、`/get/data/selectable_ollama_model_list`、`/get/data/selectable_openai_compatible_model_list`、`/get/data/selectable_openai_model_list`、`/get/data/selectable_openrouter_model_list`、`/get/data/selectable_plamo_model_list`、`/get/data/selected_gemini_model`、`/get/data/selected_groq_model`、`/get/data/selected_lmstudio_model`、`/get/data/selected_ollama_model`、`/get/data/selected_openai_compatible_model`、`/get/data/selected_openai_model`、`/get/data/selected_openrouter_model`、`/get/data/selected_plamo_model`、`/run/download_ctranslate2_weight`、`/run/lmstudio_connection`、`/run/ollama_connection`、`/set/data/deepl_auth_key`、`/set/data/gemini_auth_key`、`/set/data/groq_auth_key`、`/set/data/lmstudio_url`、`/set/data/openai_auth_key`、`/set/data/openai_compatible_auth_key`、`/set/data/openai_compatible_auth_key_and_url`、`/set/data/openai_compatible_url`、`/set/data/openrouter_auth_key`、`/set/data/plamo_auth_key`、`/set/data/selected_ctranslate2_weight_type`、`/set/data/selected_gemini_model`、`/set/data/selected_groq_model`、`/set/data/selected_lmstudio_model`、`/set/data/selected_ollama_model`、`/set/data/selected_openai_compatible_model`、`/set/data/selected_openai_model`、`/set/data/selected_openrouter_model`、`/set/data/selected_plamo_model`、`/set/disable/translation`、`/set/enable/translation`
- 音声認識（#278）とクラウドの認識（32 件）: `/delete/data/custom_whisper_auth_key`、`/delete/data/deepgram_auth_key`、`/delete/data/groq_whisper_auth_key`、`/delete/data/openai_whisper_auth_key`、`/get/data/custom_whisper_auth_key`、`/get/data/deepgram_auth_key`、`/get/data/groq_whisper_auth_key`、`/get/data/old_whisper_weights`、`/get/data/openai_whisper_auth_key`、`/get/data/realtime_asr_endpoints`、`/get/data/realtime_asr_models`、`/get/data/realtime_asr_settings`、`/get/data/realtime_asr_state`、`/run/delete_old_whisper_weights`、`/run/start_realtime_asr`、`/run/stop_realtime_asr`、`/set/data/custom_whisper_auth_key`、`/set/data/custom_whisper_auth_key_and_url`、`/set/data/custom_whisper_url`、`/set/data/deepgram_auth_key`、`/set/data/groq_whisper_auth_key`、`/set/data/mic_word_filter`、`/set/data/openai_whisper_auth_key`、`/set/data/realtime_asr_settings`、`/set/disable/check_mic_threshold`、`/set/disable/check_speaker_threshold`、`/set/disable/transcription_receive`、`/set/disable/transcription_send`、`/set/enable/check_mic_threshold`、`/set/enable/check_speaker_threshold`、`/set/enable/transcription_receive`、`/set/enable/transcription_send`
- 音声デバイス（audio-routing）（23 件）: `/get/data/auto_mic_select`、`/get/data/auto_speaker_select`、`/get/data/selectable_mic_device_list`、`/get/data/selectable_mic_device_options`、`/get/data/selectable_mic_host_list`、`/get/data/selectable_speaker_device_list`、`/get/data/selectable_speaker_device_options`、`/get/data/selected_mic_device`、`/get/data/selected_mic_device_id`、`/get/data/selected_mic_host`、`/get/data/selected_speaker_device`、`/get/data/selected_speaker_device_id`、`/get/data/virtual_mic_status`、`/run/virtual_mic_test`、`/set/data/selected_mic_device`、`/set/data/selected_mic_device_id`、`/set/data/selected_mic_host`、`/set/data/selected_speaker_device`、`/set/data/selected_speaker_device_id`、`/set/disable/auto_mic_select`、`/set/disable/auto_speaker_select`、`/set/enable/auto_mic_select`、`/set/enable/auto_speaker_select`
- TTS・声質変換・音声の経路（22 件）: `/get/data/direct_voice_sources`、`/get/data/direct_voice_state`、`/get/data/io_flow`、`/get/data/tts_engine_voices`、`/get/data/tts_model_options`、`/get/data/vc_runtime_catalog`、`/get/data/vc_runtime_state`、`/get/data/voice_output_devices`、`/get/data/voice_route`、`/get/data/voice_settings`、`/get/data/voice_status`、`/run/cancel_vc_runtime_setup`、`/run/disable_tts`、`/run/enable_tts`、`/run/mute_voice`、`/run/resume_voice`、`/run/start_direct_voice`、`/run/start_vc_runtime_setup`、`/run/stop_direct_voice`、`/run/stop_voice`、`/set/data/direct_voice_settings`、`/set/data/voice_settings`
- OCR（16 件）: `/get/data/ocr_capture_status`、`/get/data/ocr_model_readiness`、`/get/data/ocr_readiness`、`/set/data/ocr_bubble_min_text_length`、`/set/data/ocr_capture_region`、`/set/data/ocr_min_confidence`、`/set/data/ocr_poll_interval_ms`、`/set/data/ocr_source_language`、`/set/data/ocr_vr_capture_region`、`/set/data/ocr_window_title`、`/set/disable/ocr_capture`、`/set/disable/ocr_chatbox_filter`、`/set/disable/ocr_use_chatbox_detector`、`/set/enable/ocr_capture`、`/set/enable/ocr_chatbox_filter`、`/set/enable/ocr_use_chatbox_detector`
- オーバーレイと VR パネル（#282）（22 件）: `/get/data/vr_panel_layout`、`/run/send_text_overlay`、`/run/vr_launcher_reset`、`/run/vr_panel_layout_rendered`、`/run/vr_panel_recall_log`、`/run/vr_panel_tooltip`、`/run/vr_panel_windows`、`/set/data/overlay_large_log_settings`、`/set/data/overlay_small_log_settings`、`/set/data/overlay_vr_launcher_hand`、`/set/data/overlay_vr_panel_anchor`、`/set/data/overlay_vr_panel_opacity`、`/set/disable/overlay_large_log`、`/set/disable/overlay_small_log`、`/set/disable/overlay_vr_launcher_auto_hide`、`/set/disable/overlay_vr_panel`、`/set/disable/overlay_vr_panel_locked`、`/set/enable/overlay_large_log`、`/set/enable/overlay_small_log`、`/set/enable/overlay_vr_launcher_auto_hide`、`/set/enable/overlay_vr_panel`、`/set/enable/overlay_vr_panel_locked`
- メッセージの送信と記録（5 件）: `/run/open_filepath_config_file`、`/run/open_filepath_logs`、`/run/send_message_box`、`/set/disable/logger_feature`、`/set/enable/logger_feature`
- 更新とその他（6 件）: `/get/data/available_releases`、`/get/data/check_software_updates`、`/run/update_cuda_software`、`/run/update_software`、`/set/disable/check_software_updates`、`/set/enable/check_software_updates`
<!-- remaining-endpoints:end -->

## 判断が要ること

PR の残課題と同じものです。決まったら、この節を更新します。

1. **移植されていない機能の扱い**。#277（翻訳・翻字のプロバイダ）、#278（音声認識の流れとクラウドの認識）、#282（オーバーレイの Phase 2〜4）の Rust 版がまだありません。Python 同梱を終えるには、これらも移す必要があります。#285 の中で進めるか、各 Issue で先に進めるかを決めてください。
2. **切り替えの既定と Python の削除の時期**。今は `VRCT_BACKEND=core` のときだけ Rust の中核を使います。既定をいつ切り替え、`src-python/` と PyInstaller の工程をいつ消すかが未決です。
3. **使えないエンジンの表示**。プロバイダを移すまで、ローカル翻訳と speech.cpp 以外のエンジンを「使えない」と示します。保存されたキーとモデルの選択は消しません。Python は、起動時の確認に失敗したエンジンについて、一部の選択（LM Studio、Ollama、OpenAI 互換、Whisper API、Deepgram のモデル）を消していました。この違いを残すかどうか。
4. **ONNX 翻訳での計算デバイスと計算型**。設定の `SELECTED_TRANSLATION_COMPUTE_DEVICE` と `SELECTED_TRANSLATION_COMPUTE_TYPE` は CTranslate2 の考え方のままです。中核は CPU だけを、CTranslate2 と同じ計算型の一覧で示します。ONNX（CPU と DirectML）でこの設定をどう読み替えるか。
5. **旧 CTranslate2 の重み**。`/run/download_ctranslate2_weight`、`AUTO_DOWNLOAD_MODELS` による起動時の取得、カタログの `legacy_models` を移していません。重みの名前（`m2m100_418M-ct2-int8` など）は設定の互換のために残しています。ONNX のモデルの取得に置き換えるか、引退させるか。
6. **声質変換の実行環境の準備**。`/get/data/vc_runtime_*` と `/run/*_vc_runtime_setup`（Python の実行環境を用意するもの）は、RVC が Rust の worker になった今も要るか。
7. **配布物のレイアウト**。中核は speech.cpp を `_internal/build/speechcpp`（PyInstaller の資源フォルダ）で探します。Python を同梱しなくなった後の置き場所を決める必要があります。
8. **起動時の一覧に入れるもの**。Python と同じく `/get/data/speech_server_devices` を `/run/initialization_complete` に入れています。同梱の speech.cpp では子プロセスを起動するため、起動が最大で十数秒遅れることがあります。除外の一覧に足すか。
9. **ログの違い**。ステータス 348 のログ行を UI へ送りません（UI は捨てていました）。`process.log` の行は JSON で書きます。
10. **`serde_json` の機能**。中核は Python の辞書と同じ順序を保つため `preserve_order` を使い、tts クレートは `arbitrary_precision` を使います。どちらもアプリ全体の `serde_json` に及びます。src-tauri の試験は通っています。
11. **受け入れ条件の計測**。「起動時間と配布サイズが現行より改善している」はまだ計っていません。Python 同梱をやめた段階で計ります。
