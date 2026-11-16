# vrct-core

Python のサイドカーの中核（`src-python/mainloop.py`、`controller.py`、`config.py`）を置き換える Rust クレートです。Issue #285 の範囲です。UI の要求を受けて答え、設定を読み書きし、起動と終了を受け持ちます。各機能の処理は `native/` のほかのクレートが担い、このクレートがそれらをエンドポイントにつなぎます。

## 現在の状態

- 要求の受け口（形式、ロック、初期化前の待機、即時に処理する要求、watchdog の知らせ）、エラーコード、設定（読み込み、Python 時代の設定からの移行、保存）、起動と終了ができています。試験も通ります。
- エンドポイントは、設定の読み書きで完結するもの、言語と翻訳エンジンの選択、表示の設定、speech.cpp サーバ、モデル取得、テレメトリ、OSC、WebSocket と OBS のサーバを実装しました。どれが実装済みで何が残っているかは [docs/voice-stack/core-integration.md](../../docs/voice-stack/core-integration.md) にあります。実装していないエンドポイントへの要求には 404 を返します。
- アプリは `src-tauri/src/backend_host.rs` からこのクレートを同じプロセスの中で動かせます。ただし使うのは環境変数 `VRCT_BACKEND=core` で起動したときだけで、既定は今も Python のサイドカーです。

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
| `device_manager.py`、`controller.py` のデバイスの選択（`_audioTarget`、`_publishAudioDeviceLocked`、`applyAuto*Select`、`setSelected*`）、`getVirtualMicStatus`、`runVirtualMicTest` | `controller::audio_devices`（一覧、識別、監視、選択の規則、仮想マイクの確認は `vrct-audio-routing`） |

## 変わらないこと

- 要求と応答の形式。1行の JSON で、`data` は Base64 にした JSON です。状態コード（200、400、404、409、423、500、403）とエラーの本体の形も同じです。
- ロックの規則。同じロックの要求は受信順に1つずつ処理し、ロックの待ちが約 20 秒を超えたら 423、初期化前の待ちが約 30 秒を超えたら 423 を返します。停止の要求と watchdog の知らせはキューを通りません。VR パネルからの中継は、許した一覧のエンドポイントだけを通します。
- `config.json` の場所、キー、既定値、並び、検査。Python が書いたファイルを読み、Python と同じ値を書き戻します。読めないファイルの退避、保存の遅延（2 秒）、すぐ保存するキー、`config.json.lock` のロック、保存失敗の通知と 30 秒ごとの再試行も同じです。
- 起動時の通知の順序と、`/run/initialization_complete` に入れるもの、入れないもの。

## Python 版と違う点

- **ステータス 348 のログ行**。UI に送りません。UI は表示せず捨てていました。`process.log` には書きます。
- **ログの行の形式**。Python の辞書の表記ではなく JSON で書きます。伏せる規則は同じです。
- **真偽値を数として扱わない**。Python では `True` が整数 1 として通る検査がありました（オーバーレイの表示秒数など）。Rust では数として扱いません。
- **音声デバイス**。Windows のマイクは `Windows WASAPI` のホストの下だけに並びます。Python が MME などのホストで保存した選択は、起動時に WASAPI の同じデバイスへ移します。Linux で PipeWire のデバイスを並べるのは `pipewire` 機能を有効にしたときだけで、アプリ（src-tauri）は有効にします。試験は無効のまま動き、PipeWire が要りません。詳しくは [core-integration.md](../../docs/voice-stack/core-integration.md) の「判断が要ること」の 12 にあります。
- **翻訳エンジンの確認**。外部の翻訳・音声認識のプロバイダ（#277、#278）はまだ移していません。それまでは、ローカル翻訳と speech.cpp 以外を「使えない」と示します。起動時の確認に失敗したものとして Python と同じに扱い、サーバからモデルを探すエンジン（LM Studio、OpenAI 互換、Ollama、Whisper の API、Deepgram）のモデルの選択を消します。API キーは Python と同じく残します。

## 試験

```sh
cargo test --locked --manifest-path native/core/Cargo.toml
```

- `tests/config_reference.rs`: Python が書いた設定ファイル 50 通りを、Windows と Linux の規則で読み、Python と同じ内容を書き戻すことを確かめます。基準は `tests/data/python_config_reference.json` で、`python native/core/reference/dump_reference.py` が Python のバックエンドを実際に動かして作ります。
- `tests/error_codes.rs`: エラーコードが仕様書（`docs/spec/reference/error-codes.md`）と一致すること。
- `tests/dispatch.rs`: ロック、初期化前の待機、423、404、500、即時処理、VR パネルの制限。
- `tests/lifecycle.rs`: 起動の通知の順序、初期化の完了、終了、watchdog、入力が閉じたときの終了、設定の移行と通知、保存の失敗と回復。
- `tests/speech_servers.rs`: speech.cpp サーバの設定、起動、停止、自然終了、終了時の後始末、デバイスの一覧。speech.cpp の代わりに小さな実行ファイル（`tests/fixture/fake_speech.rs`）を起動します。モデルも GPU も使わず、アプリのビルドにも含まれません。
- `tests/downloads.rs`: モデル取得の同意とカタログの版の確認、状態の取得、取り消し、設定への適用とその拒否、ハードウェアの確認、終了時の停止。通信は試験用の偽の経路で、ネットワークに出ません。
- `tests/telemetry.rs`: 通知に答えるまで何も送らないこと、答えの検査、`VRCT_TELEMETRY=off`、送る内容の表示、エラーコードの送信、終了後に送らないこと。送り先はこの PC のループバックに立てた受け側です。

- `tests/engine_checks.rs`: 起動時の確認に失敗したエンジンの扱いが Python と同じこと（サーバからモデルを探すエンジンの選択を消し、API キーは残す）。
- `tests/audio_devices.rs`: 音声デバイスの一覧と選択肢、名前・ID・ホストでの選択と拒否したときに戻す値、Auto Select が OS の既定に従うこと、抜き差しで一覧が変わること、通知の順序、保存、Python が保存した選択、起動時の一覧、仮想マイクの案内と確認。デバイスはメモリの中の偽物（`tests/common/fake_audio.rs`）で、本物のデバイスには触れません。
- `tests/legacy_weights.rs`: 旧 CTranslate2 の重みは、中核が既定のバックエンドのときだけ起動の後で消すこと。Python が作ったフォルダだけを消し、リンクをたどらないこと。

利用者の文章、音声、API キーは、ログにも試験の出力にも入れません。
