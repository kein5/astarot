# vrct-core

Python のサイドカーの中核（`src-python/mainloop.py`、`controller.py`、`config.py`）を置き換える Rust クレートです。Issue #285 の範囲です。UI の要求を受けて答え、設定を読み書きし、起動と終了を受け持ちます。各機能の処理は `native/` のほかのクレートが担い、このクレートがそれらをエンドポイントにつなぎます。

## 現在の状態

- 要求の受け口（形式、ロック、初期化前の待機、即時に処理する要求、watchdog の知らせ）、エラーコード、設定（読み込み、Python 時代の設定からの移行、保存）、起動と終了ができています。試験も通ります。
- 仕様のエンドポイントはすべて実装しました（設定、翻訳とメッセージの送信、音声認識、TTS と声質変換、音声デバイス、OCR、VR のオーバーレイ、speech.cpp サーバ、モデル取得、テレメトリ、OSC、WebSocket と OBS、更新）。引退させたものと、決まっていないことは [docs/voice-stack/core-integration.md](../../docs/voice-stack/core-integration.md) にあります。
- 0.5.0 から、アプリは `src-tauri/src/backend_host.rs` からこのクレートを同じプロセスの中で動かします。これがただ一つのバックエンドで、Python のサイドカーは配布物に入りません。

## Python 版との対応

| Python | Rust |
|---|---|
| `mainloop.py` の `Main`（受信、キュー、ワーカー、ロック） | `dispatch` |
| `mainloop.py` の `run_mapping` | `controller::RUN_MAPPING` |
| `utils.py` の `encodeBase64`、`printResponse` の形式 | `protocol` |
| `utils.py` の `printLog`、`printResponse` のログ、伏せる規則 | `log` |
| `errors.py` の `ErrorCode`、`ERROR_METADATA`、`VRCTError` | `errors` |
| `config.py` の `Config` | `config`（キーと検査は `config::schema`） |
| `models/network_policy.py` の URL の検査 | `net_policy` |
| `models/transcription/realtime_settings.py`、`asr_vocabulary.py` の正規化 | `voice_settings` |
| `models/voice_conversion/settings.py` の `DirectSettings` | `voice_settings` |
| `languages.yml`、`transcription_languages.py` | `data/*.json`、`languages` |
| `controller.py` の `init`、`shutdown`、各エンドポイント | `controller`、`backend` |
| `controller.py` の `getSpeechServer*`、`startSpeechServer`、`stopSpeechServer`、`_speechServerEnded` | `controller::speech`（サーバのプロセスは `vrct-speech-server`） |
| `controller.py` のモデル取得（`getModelDownload*`、`start`/`cancel`/`applyModelDownload`）とテレメトリ（`*Telemetry*`） | `controller::downloads`、`controller::telemetry`（処理は `vrct-ops`） |
| `controller.py` の翻訳のキー・モデル・接続、`setEnableTranslation`、`setCtranslate2WeightType`、`model.py` の `getTranslate` と翻訳の履歴 | `controller::translation`（プロバイダは `vrct-translation`、ローカル翻訳は機能 `onnx-translation`（既定でオン）の `vrct-translate-onnx` と `controller::translation_onnx`。ONNX Runtime は実行時に読み込む。`docs/voice-stack/core-integration.md` の「決まったこと」） |
| `controller.py` の `_processMessage`、`chatMessage`、ロガー、`model.py` の読み（`convertMessageToTransliteration`） | `controller::messages`（読みの規則は `vrct-translation`） |
| `device_manager.py`、`controller.py` のデバイスの選択（`_audioTarget`、`_publishAudioDeviceLocked`、`applyAuto*Select`、`setSelected*`）、`getVirtualMicStatus`、`runVirtualMicTest` | `controller::audio_devices`（一覧、識別、監視、選択の規則、仮想マイクの確認は `vrct-audio-routing`） |
| `controller.py` と `model.py` のチャットの読み取り（`*Ocr*`、`ocrMessage`、`startOCRCapture`、`updateOCRCaptureSettings`） | `controller::ocr`（撮影、エンジン、パイプラインは `ocr-runtime`） |
| `controller.py` の音声認識（`setEnable/DisableTranscription*`、`setEnable/DisableCheck*Threshold`、`micMessage`、`speakerMessage`、`_audioPipelineFailed*`、認識のキー、起動時のエンジンの確認）と `model.py` の `_AudioDeviceSession` | `controller::transcription`（録音、エンジン、フレーズは `vrct-transcription`） |
| `controller.py` のリアルタイムの音声認識（`*RealtimeASR*`、`_enableRealtimeToggle`、`_startRealtime`、`_awaitAsrServer`） | `controller::realtime_asr`（セッションと字幕は `vrct_transcription::realtime`） |
| `controller.py` の TTS、直接の音声、声質変換、音声の経路（`getVoice*`、`setVoiceSettings`、`enableTts`、`disableTts`、`stopVoice`、`muteVoice`、`resumeVoice`、`*DirectVoice*`、`*VcRuntime*`、`getIoFlow`、`_publishChatVoice`、`_publishMicVoice`、TTS の `_speechServerEnded`）、`io_flow.py`、`io_trace.py` | `controller::voice`（読み上げは `vrct-tts`、直接の音声と RVC の worker と実行環境の準備は `vrct-voice-conversion`、経路のミュートと出力は `vrct-audio-routing`） |

## 変わらないこと

- 要求と応答の形式。1行の JSON で、`data` は Base64 にした JSON です。状態コード（200、400、404、409、423、500、403）とエラーの本体の形も同じです。
- ロックの規則。同じロックの要求は受信順に1つずつ処理し、ロックの待ちが約 20 秒を超えたら 423、初期化前の待ちが約 30 秒を超えたら 423 を返します。停止の要求と watchdog の知らせはキューを通りません。VR パネルからの中継は、許した一覧のエンドポイントだけを通します。
- `config.json` の場所、キー、既定値、並び、検査。Python が書いたファイルを読み、Python と同じ値を書き戻します。読めないファイルの退避、保存の遅延（2 秒）、すぐ保存するキー、`config.json.lock` のロック、保存失敗の通知と 30 秒ごとの再試行も同じです。
- API キーは `config.json` に書かず、同じフォルダの `secrets.json` に置きます（`src/config/secrets.rs`。Windows は DPAPI で暗号化、Linux は 0600）。古い `config.json` にあるキーは起動時に移し、読み戻せたものだけをファイルから除きます。保存先は `Services::secret_store` で差し替えられ、試験はメモリーの保存先を使います。
- 起動時の通知の順序と、`/run/initialization_complete` に入れるもの、入れないもの。

## Python 版と違う点

- **ステータス 348 のログ行**。UI に送りません。UI は表示せず捨てていました。`process.log` には書きます。
- **ログの行の形式**。Python の辞書の表記ではなく JSON で書きます。伏せる規則は同じです。
- **真偽値を数として扱わない**。Python では `True` が整数 1 として通る検査がありました（オーバーレイの表示秒数など）。Rust では数として扱いません。
- **翻訳エンジンの確認**。翻訳のプロバイダ（#277）は Python と同じに起動時に確かめます。Web 翻訳（Google、Bing、Papago）は配布していないので、エンジンの一覧に出しません（Python は「使える」と示し、毎回失敗していました。`languages::RETIRED_WEB_TRANSLATORS`）。代わりに、各社の公式の API（Google Cloud Translation の `Google_Cloud_API` と NAVER Cloud Platform の Papago の `Papago_API`）を利用者のキーで呼びます。これと Ollama の URL（`OLLAMA_URL`、既定は Python と同じ `http://localhost:11434`）は Python になかったもので、エンドポイント、エラーコード、設定キーは仕様の一覧に「中核のみ」として載せています（`tools/spec_core_additions.json`）。平文の HTTP は、この PC と LAN（プライベートなアドレス、リンクローカル、IPv6 のユニークローカル、`.local` の名前）にだけ送ります（`net_policy`）。音声認識のエンジン（#278）も Python と同じに確かめます。Whisper の API と Deepgram はキーでモデルの一覧を取り、Google と speech.cpp は確かめずに「使える」とします。API キーは Python と同じく残します。
- **読み（ひらがな・ローマ字）**。Python と同じく Sudachi（sudachi.rs）で解析します。辞書は同梱のファイル `_internal/build/sudachi/system.dic`（開発の checkout では `build/sudachi/system.dic`、`tools/sudachi_dictionary.py` が置く）を、読みを求める最初のメッセージで開きます（`Services::transliteration`、既定は `messages::shipped_readings`）。辞書がない、または読めないときは、読みのスイッチが入っていてもメッセージを読みなしで送り、理由を `process.log` に一度だけ書きます。Python は辞書を読めないと送信ごと失敗していました。どの辞書を配布物に入れるかは `docs/voice-stack/core-integration.md` の「判断が要ること」の 3 です。
- **プロキシ**。翻訳のプロバイダへの通信は `HTTP(S)_PROXY` を使いません（「判断が要ること」の 18）。
- **声質変換**。変換の持ち主はアプリのプロセスのスレッドで動き、別の router プロセスはありません。Linux の管理された経路での変換と Seed-VC は動きません（`vc_start_failed`）。実行環境の準備は RVC だけを出します（core-integration.md の「判断が要ること」の 10、「Linux の声質変換」「声質変換の router プロセス」）。
- **音声デバイス**。Windows のマイクは `Windows WASAPI` のホストの下だけに並びます。Python が MME などのホストで保存した選択は、起動時に WASAPI の同じデバイスへ移します。Linux で PipeWire のデバイスを並べるのは `pipewire` 機能を有効にしたときだけで、アプリ（src-tauri）は有効にします。試験は無効のまま動き、PipeWire が要りません。詳しくは [core-integration.md](../../docs/voice-stack/core-integration.md) の「判断が要ること」の 4 にあります。

## ほかの領域から使うもの

- `Core::deliver_transcription(Source::{Mic, Speaker, Ocr}, Recognized, guard)`: 音声認識と OCR の結果をメッセージの経路に渡します。ワードフィルタ、繰り返しの確認、翻訳、読み、チャットボックス、UI への通知、WebSocket、会話のログ、履歴まで行います。
- `Core::process_message(&messages::REALTIME_MIC など, ...)`: 結果を返す向き（リアルタイムの音声認識）に使います。
- `Core::realtime_toggles()`、`Core::realtime_requested(source)`、`Core::realtime_uses_bundled_server()`: リアルタイムの音声認識の状態。
- 音声認識の録音は `AudioDevices::set_capture_owner` に登録してあり、デバイスの変更で移ります。
- `Core::set_message_hooks(overlay, speech)`: VR のオーバーレイ（`OverlayMessage`）と音声（`SpokenMessage`、翻訳の前後の 2 回）の口です。設定されるまで何もしません。`Err` を返すと出力の失敗として通知します。音声の口は `controller::voice` が設定し、入力したチャットを読み上げます。オーバーレイの口を設定しないときは、メッセージの流れが VR の小さいログと大きいログに直接描きます（`Core::show_overlay_log`）。OCR の行は `Services::ocr_message` の既定（`ocr::pipeline_delivery`）でメッセージの流れに入ります。
- `Core::mic_voice_snapshot()` と `Core::publish_mic_voice(...)`: リアルタイム認識のマイクの確定文を読み上げます（`_publishMicVoice`）。確定文が届いたときに前者を取り、翻訳のあとで後者を呼びます（`realtime_asr` が `Core::process_realtime_mic` を通して呼びます）。`Core::cancel_mic_voice()` はマイクの読み上げを取り消します（認識の停止や開始のとき）。`Core::set_realtime_mic_probe(...)` はフローパネルに、リアルタイム認識を求めているかを伝えます。
- `Core::voice_target_idle(target)`: モデルの取得を適用してよいか（`japanese`・`multilingual` は TTS がそのサーバを使っていないか、`rvc` は声質変換が動いていないか）。

## 試験

```sh
cargo test --locked --manifest-path native/core/Cargo.toml
```

- `tests/config_reference.rs`: Python が書いた設定ファイル 50 通りを、Windows と Linux の規則で読み、Python と同じ内容を書き戻すことを確かめます。基準は `tests/data/python_config_reference.json` で、`python native/core/reference/dump_reference.py` が Python のバックエンドを実際に動かして作ります。
- `tests/error_codes.rs`: エラーコードが仕様書（`docs/spec/reference/error-codes.md`）と一致すること。中核のソースが使う大文字のコードが、すべて仕様書にあること。
- `tests/dispatch.rs`: ロック、初期化前の待機、423、404、500、即時処理、VR パネルの制限。
- `tests/lifecycle.rs`: 起動の通知の順序、初期化の完了、終了、watchdog、入力が閉じたときの終了、設定の移行と通知、保存の失敗と回復。
- `tests/speech_servers.rs`: speech.cpp サーバの設定、起動、停止、自然終了、終了時の後始末、デバイスの一覧。speech.cpp の代わりに小さな実行ファイル（`tests/fixture/fake_speech.rs`）を起動します。モデルも GPU も使わず、アプリのビルドにも含まれません。
- `tests/downloads.rs`: モデル取得の同意とカタログの版の確認、状態の取得、取り消し、設定への適用とその拒否、ハードウェアの確認、終了時の停止。通信は試験用の偽の経路で、ネットワークに出ません。
- `tests/telemetry.rs`: 通知に答えるまで何も送らないこと、答えの検査、`VRCT_TELEMETRY=off`、送る内容の表示、エラーコードの送信、終了後に送らないこと。送り先はこの PC のループバックに立てた受け側です。
- `tests/engine_checks.rs`: 起動時の確認に失敗したエンジンの扱いが Python と同じこと（サーバからモデルを探すエンジンの選択を消し、API キーは残す）。
- `tests/translation.rs`、`tests/messages.rs`: 翻訳のプロバイダ（ループバックの偽のサーバ、`vrct_translation::fake`）、ローカル翻訳（偽のモデル）、`/run/send_message_box` からチャットボックス・WebSocket・会話のログまで。
- `tests/translation_models.rs`: ONNX のローカル翻訳のモデルのフォルダ（小さな偽のファイル）。計算型で選ぶ形、自分で用意したモデルの一覧と断る理由と言語の表、計算デバイスの一覧、CPU への切り替えの知らせ、同意を得てカタログから取得したモデルが見つかること。試験では、プロバイダへの通信はループバックだけに限ります（`tests/common` の `Setup`）。
- `tests/audio_devices.rs`: 音声デバイスの一覧と選択肢、名前・ID・ホストでの選択と拒否したときに戻す値、Auto Select が OS の既定に従うこと、抜き差しで一覧が変わること、通知の順序、保存、Python が保存した選択、起動時の一覧、仮想マイクの案内と確認。デバイスはメモリの中の偽物（`tests/common/fake_audio.rs`）で、本物のデバイスには触れません。
- `tests/transcription.rs`、`tests/realtime_asr.rs`: 音声認識。マイクとスピーカーは 44.1 kHz と 48 kHz の PCM をデバイスと同じ間隔で渡す偽物（`tests/common/fake_capture.rs`）で、Google、Whisper の API、Deepgram、speech.cpp（モデルの一覧と Realtime の WebSocket）は 127.0.0.1 の偽のサーバ（`tests/common/fake_asr.rs`）です。
- `tests/legacy_weights.rs`: 旧 CTranslate2 の重みは、中核が既定のバックエンドのときだけ起動の後で消すこと。Python が作ったフォルダだけを消し、リンクをたどらないこと。
- `tests/ocr.rs`: チャットの読み取り。偽の画像と偽の認識器で、オンにできない理由、状態、設定、読んだ行がメッセージの流れを通って UI に届くこと。
- `tests/vr_overlay.rs`: VR のオーバーレイ。代わりの SteamVR で、字幕と VR パネルのオンとオフ、設定、失敗の通知、送ったメッセージが大きいログに描かれること。
- `tests/updates.rs`: Python と同じく止めてある更新の答え。
- `tests/voice.rs`: TTS のスイッチと内蔵サーバ、音声の設定、チャットとマイクの確定文の読み上げ（偽の認識サーバからリアルタイムの確定文を流し、訳を読み上げるまで）、声を流しているケーブルを認識に使わせないこと、停止とミュート、直接の音声と声質変換、実行環境の準備、フローパネル、終了。出力とマイクは `tests/common/fake_voice.rs`、speech.cpp とエンジンは `tests/common/fake_tts.rs` と `fake-speech-core`、RVC の worker は小さな実行ファイル（`tests/fixture/fake_rvc_worker.rs`）です。どれもアプリのビルドには含まれません。

利用者の文章、音声、API キーは、ログにも試験の出力にも入れません。
