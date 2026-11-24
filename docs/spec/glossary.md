# Glossary

[日本語版](#用語集日本語版)

Words used in the specification and the code. Names shown on screen follow `locales/en.yml`, under the same keys that the Japanese version takes from `locales/ja.yml`.

| Term | Meaning | Name in the code |
|---|---|---|
| Sidecar | The earlier name for the backend. It handles translation, speech recognition, OSC and other processing. Up to 0.4 it was a Python process that the UI started; from 0.5.0 it is the Rust core that runs inside the app | `native/core`, `src-tauri/src/backend_host.rs` (up to 0.4: `bin/vrct-vox-sidecar`, `src-python/`) |
| Endpoint | The destination of an IPC request or notification. A string such as `/get/data/…` | `mapping`, `run_mapping` |
| Request | A message from the UI to the sidecar. A response always comes back | `asyncStdoutToPython` |
| Notification | A message the sidecar sends on its own. The UI does not reply | `controller.run`, `/run/…` |
| Initialization complete | The sidecar sending all settings together at startup | `/run/initialization_complete` |
| Save bar | The bar at the top of the settings screen that shows the number of unsaved changes and the "Save" and "Discard" buttons | `SaveBar`, `setSaveBarEntry` |
| Tab | The mechanism that switches between up to three pairs of language and translator (1 to 3) | `selected_tab_no` |
| Your language, Target language | The language you speak, and the languages to translate into (up to three) | `selected_your_languages`, `selected_target_languages` |
| Built-in model | The local translation model (M2M100) that runs inside the app on ONNX Runtime. The translation engine ID stays `CTranslate2` for compatibility (up to 0.4 it ran on CTranslate2). Local speech recognition uses the models of the bundled server (speech.cpp). The earlier transcription (Whisper) models went out of use in #288 | `weights/` |
| Bundled server | The speech.cpp server that the app starts and manages (TTS and ASR) | `speech_server` |
| External server | A speech.cpp server that the user started separately | `external` |
| Audio route | The path that brings TTS and RVC audio to VRChat | `voice_route` |
| Managed route | On screen: "Managed virtual microphone (Linux)". The route that uses a Linux virtual microphone the app creates. Mute works on both TTS and RVC | `managed`, `astarot.managed.source` |
| Existing external cable | The route that uses a virtual cable the user prepared | `external` |
| Input forwarding (RVC) | Converting the microphone voice with RVC and sending it to the virtual microphone (on Windows, to the output device) | `direct_voice` |
| Generation number | A number that advances at every stop. It keeps TTS from earlier generations from playing | `generation`, `epoch`, `_voice_generation` |
| Chat reading | The OCR feature that reads the VRChat chatbox from the screen | `ocr_capture` |
| Realtime speech recognition | Speech recognition that shows subtitles while you are still speaking. The main switch uses it on Linux, and on Windows when the bundled server is chosen | `realtime_asr`, `/run/realtime_caption` |
| Subtitle overlay | The display that shows the conversation in your VR view (single line, multiple lines) | `overlay_small_log`, `overlay_large_log` |
| VR UI | The wrist launcher and windows you operate inside VR | `vr_panel` |
| Quick Chat | An input-only window that opens with a hotkey | `quick_chat` |
| OSCQuery | The mechanism for finding VRChat's OSC receiver. VRC mic mute sync uses it | `tinyoscquery` |
| VRC mic mute sync | The feature that does not send microphone recognition results while you are muted in VRChat | `vrc_mic_mute_sync` |
| Mic word filter | The feature that does not send recognition results containing words you listed | `mic_word_filter` |

---

# 用語集（日本語版）

仕様書とコードで使う言葉。画面の名前は`locales/ja.yml`に合わせる。

| 用語 | 意味 | コードでの名前 |
|---|---|---|
| サイドカー | バックエンドの以前の呼び名。翻訳、音声認識、OSCなどの処理を受け持つ。0.4まではUIが起動するPythonのプロセス、0.5.0からはアプリの中で動くRustの中核 | `native/core`、`src-tauri/src/backend_host.rs`（0.4まで`bin/vrct-vox-sidecar`、`src-python/`） |
| エンドポイント | IPCの要求と通知の宛先。`/get/data/…`のような文字列 | `mapping`、`run_mapping` |
| 要求 | UIからサイドカーへのメッセージ。必ず応答が返る | `asyncStdoutToPython` |
| 通知 | サイドカーが自分から送るメッセージ。UIは返事をしない | `controller.run`、`/run/…` |
| 初期化の完了 | 起動時にサイドカーが全設定をまとめて送ること | `/run/initialization_complete` |
| 保存バー | 設定画面の上部にある、未保存の変更の件数と「保存」「破棄」のボタン | `SaveBar`、`setSaveBarEntry` |
| タブ | 言語と翻訳エンジンの組を3つまで切り替える仕組み（1〜3） | `selected_tab_no` |
| あなたの言語、相手の言語 | 自分が話す言語と、訳す先の言語（最大3つ） | `selected_your_languages`、`selected_target_languages` |
| 内蔵モデル | アプリの中でONNX Runtimeで動くローカル翻訳（M2M100）のモデル。翻訳エンジンのIDは互換のため`CTranslate2`のまま（0.4まではCTranslate2で動かしていた）。ローカルの音声認識は同梱サーバー（speech.cpp）のモデルを使う。以前の文字起こし（Whisper）のモデルは #288 で使わなくなった | `weights/` |
| 同梱サーバー | アプリが起動して管理するspeech.cppのサーバー（TTSとASR） | `speech_server` |
| 外部サーバー | 利用者が別に起動したspeech.cppのサーバー | `external` |
| 音声経路 | 読み上げとRVCの音声をVRChatへ届ける道筋 | `voice_route` |
| 管理対象の経路 | 画面では「管理対象の仮想マイク（Linux）」。アプリが作るLinuxの仮想マイクを使う経路。ミュートは読み上げとRVCの両方に効く | `managed`、`astarot.managed.source` |
| 既存の外部ケーブル | 利用者が用意した仮想ケーブルを使う経路 | `external` |
| 入力の転送（RVC） | マイクの声をRVCで変換して仮想マイク（Windowsでは出力デバイス）へ流すこと | `direct_voice` |
| 世代番号 | 停止のたびに進む番号。古い世代の読み上げを鳴らさないために使う | `generation`、`epoch`、`_voice_generation` |
| チャット読み取り | VRChatのチャットボックスを画面から読み取るOCRの機能 | `ocr_capture` |
| リアルタイム音声認識 | 話している途中から字幕を出す音声認識。Linuxと、同梱サーバーを選んだWindowsのメインスイッチが使う | `realtime_asr`、`/run/realtime_caption` |
| 字幕オーバーレイ | VRの視界に会話を出す表示（一行・複数行） | `overlay_small_log`、`overlay_large_log` |
| VR UI | VRの中で操作する手首のランチャーとウィンドウ | `vr_panel` |
| チャット入力の小窓 | ホットキーで開く入力専用のウィンドウ | `quick_chat` |
| OSCQuery | VRChatのOSCの受け口を探す仕組み。VRCマイクミュート同期に使う | `tinyoscquery` |
| VRCマイクミュート同期 | VRChatでミュートしている間、マイクの認識結果を送らない機能 | `vrc_mic_mute_sync` |
| ワードフィルター | 指定した語を含む認識結果を送らない機能 | `mic_word_filter` |
