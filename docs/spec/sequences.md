# Sequences

[日本語版](#シーケンス日本語版)

The exchanges in typical scenes. This is not every scene: the ones chosen show startup, frequent operations, exchanges with outside systems and the error paths. Message formats are in [IPC protocol](ipc-protocol.md), and the endpoints are in [the endpoint list](reference/ipc-endpoints.md).

## Startup

```mermaid
sequenceDiagram
  autonumber
  participant UI as UI (main)
  participant S as Sidecar
  participant Net as Network
  UI->>S: backend_start (from 0.5.0 the core inside the app, up to 0.4 bin/vrct-vox-sidecar)
  Note over S: The receiver and 3 workers start first.<br/>Requests with status False are held back with 423
  S-->>UI: /run/connected_network (null, no connection check is sent)
  S-->>UI: /run/initialization_progress = 1
  Note over S: Models are not downloaded automatically (download at startup was retired in 0.5.0)
  S-->>UI: /run/enable_ai_models (true or false)
  S->>Net: Check each engine's key and model list
  Note over S: Keys that could not be checked stay saved
  S-->>UI: /run/initialization_progress = 2
  S-->>UI: /run/selected_translation_engines, /run/translation_engines
  S-->>UI: /run/initialization_progress = 3, 4
  S-->>UI: /run/enable_osc_query (when OSCQuery cannot be used)
  S-->>UI: /run/initialization_complete {"/get/data/…": value}
  Note over S: Unlock all endpoints
  UI->>UI: Hand the values to their receivers, replace the placeholders on the main screen with the real values and enable operation
  UI->>S: Get the voice, speech server and model download states
  loop Every 20 seconds
    UI->>S: /run/feed_watchdog
  end
```

- When the sidecar writes a line other than a warning to stderr, the UI shows a persistent notification.
- `/run/enable_ai_models` is false only when the translation engine of the selected tab is CTranslate2 and its built-in model is missing. The UI shows no notification in that case. While the conversation is empty, the conversation area shows what is missing, together with a way to set it up ([Initialization, offline use and missing capabilities](cross-cutting.md#初期化中オフライン能力の不足)).
- For the branches on a failed spawn and on failed initialization items, and for how remounts and manual retries are handled, see [Startup and initialization](ipc-protocol.md#起動と初期化).

## Changing a setting

```mermaid
sequenceDiagram
  autonumber
  participant P as Settings screen
  participant UI as UI (logic)
  participant S as Sidecar
  participant F as config.json
  P->>UI: Change a value (a switch, or a field on Enter or when focus leaves it)
  UI->>UI: Set the value to pending
  UI->>S: /set/data/x (data = base64(JSON))
  S->>S: Endpoint lock, validation
  alt Passes validation
    S->>S: Save the value (written in one batch 2 seconds later)
    S-->>UI: 200 /set/data/x = the saved value
    UI->>P: Show the value (no "saved" notice)
    S->>F: Write a temporary file and replace the file with it
  else Fails validation
    S-->>UI: 400 {error_code: VALIDATION_…, data: previous value}
    UI->>P: Restore the previous value and report the reason
  end
```

When the languages or the translation engine change, these notifications arrive before the response.

```mermaid
sequenceDiagram
  participant UI
  participant S as Sidecar
  UI->>S: /set/data/selected_target_languages
  opt A language the engine does not support
    S-->>UI: /run/selected_your_languages, /run/selected_target_languages
    S-->>UI: 400 /run/translation_language_unsupported
  end
  S-->>UI: /run/selected_translation_engines
  S-->>UI: /run/translation_engines
  S-->>UI: 200 /set/data/selected_target_languages
  alt No response within 30 seconds, or 400, 404, 423 or 500
    UI->>S: Read all language values again
  end
```

## Sending a chat message

```mermaid
sequenceDiagram
  autonumber
  participant UI as UI
  participant S as Sidecar
  participant T as Translation engine
  participant V as VRChat (OSC)
  participant W as WebSocket, OBS
  participant Q as Speech queue
  UI->>UI: Add a "Sending…" row to the log
  UI->>S: /run/send_message_box {id, message}
  Note over S: Attach the voice generation number on receipt.<br/>Fix the content settings and the chatbox number when processing accepts it
  opt TTS is set to read the original text
    S->>Q: Queue the original text
  end
  opt Translation is on
    S->>T: Translate into each target language (in parallel)
    alt The engine fails
      S->>S: Translate again with CTranslate2
      S-->>UI: /run/selected_translation_engines, /run/translation_engines
      S-->>UI: 400 /run/error_translation_engine
    end
  end
  opt The current send setting is on, and no newer number has been sent to OSC
    S->>V: /chatbox/input [formatted text, true, notification sound]
  end
  opt TTS is set to read the translation, and the chosen slot has a real translation
    S->>Q: Queue the translation (dropped if its generation is old)
  end
  S->>W: {type: "CHAT", …}
  opt Some outputs throw an exception
    S-->>UI: 400 /run/message_output_error (a warning per output)
  end
  S-->>UI: 200 /run/send_message_box {id, original, translations, output_failures?}
  UI->>UI: Replace the row with one that has the translations
```

Fixing the settings, skipping stale OSC sends and handling output exceptions follow [Accepting and outputting messages](cross-cutting.md#メッセージの受付と出力). An exception in an output is reported when it happens, and the remaining processing continues.

For the row's state when sending fails, see [the data format of conversation messages](data-and-persistence.md).

## Microphone transcription

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant S as Sidecar
  participant Mic as Microphone
  participant E as Speech recognition engine
  participant V as VRChat (OSC)
  UI->>S: /set/enable/transcription_send
  S-->>UI: 200 /set/enable/transcription_send = whether it started
  opt The chosen microphone is missing
    S-->>UI: 400 /run/error_device {error_code: DEVICE_NO_MIC}
  end
  loop For each utterance
    Mic->>S: Sound above the sensitivity
    Note over S: Cut the utterance when silence continues, when it passes 15 seconds or when the wait time runs out
    S->>E: Recognize in each of your languages and take the most confident result
    alt Recognition fails
      S-->>UI: /set/disable/transcription_send = false
      S-->>UI: /run/transcription_recognition_error
    else Matches the word filter
      S-->>UI: /run/word_filter
    else Recognized
      S->>S: Translate (when on)
      S->>V: /chatbox/input (when sending is on)
      S-->>UI: /run/transcription_send_mic_message
    end
  end
```

- The speaker side (Listening) follows the same flow: it recognizes in the target languages and translates into your language. It sends to VRChat only when "Send received message to VRChat" is on, and the notification is `/run/transcription_receive_speaker_message`.
- On Linux, and on Windows with the bundled server chosen for real-time captions, the Mic input switch starts real-time speech recognition, and the results arrive as `/run/realtime_caption`. With the bundled server, each switch starts the server it uses on its own (#1242): Mic input's (`asr`), and Listening's own (`asr_listening`) while Listening has a model of its own; otherwise Listening uses `asr` too. A server a switch started stops once no source uses it. No setting turns this off (#1396, decided on 2026-11-28): a `start_server` that an earlier version saved is read and left out, and the settings page has no start or stop for these servers. It shows the state of each, Mic input's and Listening's own. A server that hangs is started again by turning its switch off and on. When Listening's own server does not fit in the GPU memory beside Mic input's, the Listening switch is refused with `realtime_asr_models_do_not_fit`, and nothing else changes. `/get/data/realtime_asr_models` lists the models of a source's server (`{"source": "speaker"}`, Mic input's without one).

## Text to speech and stopping

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant R as Receiver thread
  participant S as Sidecar (worker)
  participant Srv as Speech server
  participant Out as Output device
  UI->>S: /run/enable_tts {generation}
  S->>S: Check what to read, the language and the output
  opt Using the bundled server
    S->>Srv: Start it and wait until it is ready
  end
  alt The conditions are met
    S-->>UI: 200 voice state
  else They are not met
    S-->>UI: 409 {error_code: tts_…}
  end
  loop Queue
    S->>Srv: POST /v1/audio/speech
    Srv-->>S: audio/pcm
    S->>Out: Play
  end
  UI->>R: /run/stop_voice
  Note over R: Handled at once, without going through the queue
  R->>S: Advance the generation number, empty the queue and stop playback
  R-->>UI: 200
  UI->>R: /run/mute_voice
  R-->>UI: 200 {pending: true}
  Note over S: Stop both TTS and RVC (the virtual microphone's output on the managed route, the audio to the output device on Windows)
```

## Registering an API key

```mermaid
sequenceDiagram
  autonumber
  participant P as Settings screen
  participant S as Sidecar
  participant C as Cloud service
  P->>S: /set/data/groq_whisper_auth_key (Enter, or focus leaving the key field)
  S->>C: Get the model list (Deepgram checks with /v1/auth/token)
  alt Authentication and every model check succeed
    S->>S: Apply the target key and the prepared state inside the shared lock
    S-->>P: /run/selectable_groq_whisper_model_list
    S-->>P: /run/selected_groq_whisper_model
    S-->>P: 200 key
    P->>S: /get/data/selectable_transcription_engines, /get/data/selected_transcription_engine
    P->>P: Make the engine selectable
  else Cannot be confirmed (rejected, wrong format, network failure, no models, failed initialization)
    S->>S: The saved key and state stay as they are
    S-->>P: 400 {error_code: TRANSCRIPTION_API_AUTH_FAILED, data: the saved key}
    P->>P: Reset the field to the saved key and report the reason
  end
```

Translation keys (such as `/set/data/groq_auth_key`) follow the same flow, with the error code `AUTH_…`. Preparing and applying, concurrent changes and failures of the OpenAI-compatible URL follow [Changing API keys](cross-cutting.md#apiキーの変更).

Starting and stopping classic transcription and the volume meter, Auto selection and switching devices follow [Choosing and identifying audio devices](data-and-persistence.md#音声デバイスの選択と識別). On a device switch, the capture device that was opened is reported first, then the names before and after the change. Recording errors are detected without waiting for transcription processing, and the end is reported even when only the meter is running.

---

# シーケンス（日本語版）

代表的な場面のやり取り。すべての場面ではなく、起動、よく使う操作、外部とのやり取り、エラーの経路が分かるものを選んでいる。メッセージの形は[IPCプロトコル](ipc-protocol.md)、エンドポイントは[一覧](reference/ipc-endpoints.md)にある。

## 起動

```mermaid
sequenceDiagram
  autonumber
  participant UI as UI（main）
  participant S as サイドカー
  participant Net as ネットワーク
  UI->>S: backend_start（0.5.0 からアプリの中の中核。0.4 までは bin/vrct-vox-sidecar）
  Note over S: 受信とワーカー3本が先に動く。<br/>status False の要求は423で待たせる
  S-->>UI: /run/connected_network（null。接続の確認は送らない）
  S-->>UI: /run/initialization_progress = 1
  Note over S: モデルは自動では取得しない（0.5.0 で起動時の取得を引退）
  S-->>UI: /run/enable_ai_models（真偽）
  S->>Net: 各エンジンのキーとモデル一覧の確認
  Note over S: 確認できないキーも保存したままにする
  S-->>UI: /run/initialization_progress = 2
  S-->>UI: /run/selected_translation_engines、/run/translation_engines
  S-->>UI: /run/initialization_progress = 3、4
  S-->>UI: /run/enable_osc_query（OSCQueryが使えないとき）
  S-->>UI: /run/initialization_complete {"/get/data/…": 値}
  Note over S: 全エンドポイントのロックを外す
  UI->>UI: 受信先へ配り、メイン画面の仮の表示を実際の値に替えて操作を有効にする
  UI->>S: 音声・音声サーバー・モデル取得の状態を取得
  loop 20秒ごと
    UI->>S: /run/feed_watchdog
  end
```

- サイドカーのstderrに警告以外の行が出たら、UIは消えない通知を出す。
- `/run/enable_ai_models`が偽になるのは、選択中のタブの翻訳エンジンがCTranslate2で、その内蔵モデルがないときだけである。UIはこのとき通知を出さない。足りないものは、会話が空のあいだ、用意する入口と一緒に会話欄へ表示する（[初期化中、オフライン、能力の不足](cross-cutting.md#初期化中オフライン能力の不足)）。
- spawn失敗と初期化項目の失敗の分岐、再マウントと手動再試行の扱いは[起動と初期化](ipc-protocol.md#起動と初期化)を参照する。

## 設定の変更

```mermaid
sequenceDiagram
  autonumber
  participant P as 設定画面
  participant UI as UI（ロジック）
  participant S as サイドカー
  participant F as config.json
  P->>UI: 値を変える（スイッチ、またはEnterか欄を離れたときの文字の欄）
  UI->>UI: 値を pending にする
  UI->>S: /set/data/x（data = base64(JSON)）
  S->>S: エンドポイントのロック、検証
  alt 検証に通る
    S->>S: 値を保存（2秒後にまとめて書く）
    S-->>UI: 200 /set/data/x = 保存後の値
    UI->>P: 値を反映（「保存しました」の通知は出さない）
    S->>F: 一時ファイルに書いて置き換える
  else 検証に通らない
    S-->>UI: 400 {error_code: VALIDATION_…, data: 元の値}
    UI->>P: 元の値に戻し、理由を通知
  end
```

言語と翻訳エンジンの変更では、応答の前に次の通知が届く。

```mermaid
sequenceDiagram
  participant UI
  participant S as サイドカー
  UI->>S: /set/data/selected_target_languages
  opt エンジンが対応しない言語
    S-->>UI: /run/selected_your_languages、/run/selected_target_languages
    S-->>UI: 400 /run/translation_language_unsupported
  end
  S-->>UI: /run/selected_translation_engines
  S-->>UI: /run/translation_engines
  S-->>UI: 200 /set/data/selected_target_languages
  alt 30秒以内に応答がない、または400・404・423・500
    UI->>S: 言語に関する値をすべて読み直す
  end
```

## チャットの送信

```mermaid
sequenceDiagram
  autonumber
  participant UI as UI
  participant S as サイドカー
  participant T as 翻訳エンジン
  participant V as VRChat（OSC）
  participant W as WebSocket・OBS
  participant Q as 読み上げの待ち行列
  UI->>UI: ログに「送信中…」の行を出す
  UI->>S: /run/send_message_box {id, message}
  Note over S: 受信時に音声の世代番号を付ける。<br/>処理の受付時に内容設定とチャットボックスの番号を固定する
  opt TTS が原文を読む設定
    S->>Q: 原文を積む
  end
  opt 翻訳がオン
    S->>T: 相手の言語ごとに翻訳（並行）
    alt エンジンが失敗
      S->>S: CTranslate2 で訳し直す
      S-->>UI: /run/selected_translation_engines、/run/translation_engines
      S-->>UI: 400 /run/error_translation_engine
    end
  end
  opt 現在の送信設定がオンで、より新しい番号をOSCへ送っていない
    S->>V: /chatbox/input [書式を当てた文, true, 通知音]
  end
  opt TTS が訳を読む設定で、選んだ枠に実際の訳文がある
    S->>Q: 訳を積む（世代が古ければ捨てる）
  end
  S->>W: {type: "CHAT", …}
  opt 出力先の一部で例外
    S-->>UI: 400 /run/message_output_error（出力先別の警告）
  end
  S-->>UI: 200 /run/send_message_box {id, original, translations, output_failures?}
  UI->>UI: 行を訳つきに置き換える
```

設定の固定、古いOSC送信の省略、出力先の例外の扱いは[メッセージの受付と出力](cross-cutting.md#メッセージの受付と出力)に従う。各出力の例外はその時点で通知し、後続の処理を続ける。

送信に失敗した場合の行の状態は、[会話メッセージのデータ形式](data-and-persistence.md)を参照。

## マイクの文字起こし

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant S as サイドカー
  participant Mic as マイク
  participant E as 音声認識エンジン
  participant V as VRChat（OSC）
  UI->>S: /set/enable/transcription_send
  S-->>UI: 200 /set/enable/transcription_send = 開始できたか
  opt 選んだマイクがない
    S-->>UI: 400 /run/error_device {error_code: DEVICE_NO_MIC}
  end
  loop 発話ごと
    Mic->>S: 感度を超えた音
    Note over S: 無音が続く・15秒を超える・待ち時間を過ぎると区切る
    S->>E: 自分の言語ごとに認識し、確信度の高い結果を採る
    alt 認識に失敗
      S-->>UI: /set/disable/transcription_send = false
      S-->>UI: /run/transcription_recognition_error
    else ワードフィルターに一致
      S-->>UI: /run/word_filter
    else 認識できた
      S->>S: 翻訳（オンのとき）
      S->>V: /chatbox/input（送信がオンのとき）
      S-->>UI: /run/transcription_send_mic_message
    end
  end
```

- スピーカー側（聞き取り）は同じ流れで、相手の言語で認識し、自分の言語へ訳す。VRChatへ送るのは「受信したメッセージをVRChatに送信する」がオンのときだけで、通知は`/run/transcription_receive_speaker_message`になる。
- Linuxと、リアルタイム字幕で同梱サーバーを選んだWindowsでは、マイク入力のスイッチがリアルタイム音声認識を始め、結果は`/run/realtime_caption`で届く。同梱サーバーでは、それぞれのスイッチが自分の使うサーバーを単独で起動する（#1242）。マイク入力は`asr`、聞き取りは自分のモデルを持つ間は`asr_listening`で、そうでないときは聞き取りも`asr`を使う。スイッチが起動したサーバーは、使う入力がなくなると止める。これをオフにする設定はない（#1396、2026-11-28の決定）。以前の版が保存した`start_server`は読んで捨て、設定画面にもこれらのサーバーの起動と停止はない。設定画面はマイク入力のサーバーと聞き取りのサーバーのそれぞれの状態を示す。固まったサーバーは、そのスイッチを切って入れ直すと起動し直す。聞き取りのサーバーがマイク入力のサーバーと一緒にはGPUのメモリに収まらないときは、聞き取りのスイッチを`realtime_asr_models_do_not_fit`で断り、ほかには何も変えない。`/get/data/realtime_asr_models`は、入力が使うサーバーのモデルを返す（`{"source": "speaker"}`。省略するとマイク入力）。

## 読み上げと停止

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant R as 受信スレッド
  participant S as サイドカー（ワーカー）
  participant Srv as 音声サーバー
  participant Out as 出力デバイス
  UI->>S: /run/enable_tts {generation}
  S->>S: 読み上げの元・言語・出力先を確かめる
  opt 同梱サーバーを使う
    S->>Srv: 起動して準備を待つ
  end
  alt 条件がそろう
    S-->>UI: 200 音声の状態
  else そろわない
    S-->>UI: 409 {error_code: tts_…}
  end
  loop 待ち行列
    S->>Srv: POST /v1/audio/speech
    Srv-->>S: audio/pcm
    S->>Out: 再生
  end
  UI->>R: /run/stop_voice
  Note over R: キューを通らず、すぐ処理する
  R->>S: 世代番号を進め、待ち行列を空にし、再生を止める
  R-->>UI: 200
  UI->>R: /run/mute_voice
  R-->>UI: 200 {pending: true}
  Note over S: 読み上げとRVCの両方を止める（管理対象の経路は仮想マイクの出力、Windowsは出力デバイスへの音声）
```

## APIキーの登録

```mermaid
sequenceDiagram
  autonumber
  participant P as 設定画面
  participant S as サイドカー
  participant C as クラウドのサービス
  P->>S: /set/data/groq_whisper_auth_key（Enterか、キーの欄を離れたとき）
  S->>C: モデル一覧の取得（Deepgram は /v1/auth/token で確認）
  alt 認証とモデルの確認がすべて成功
    S->>S: 共有ロック内で対象のキーと準備済みの状態を反映
    S-->>P: /run/selectable_groq_whisper_model_list
    S-->>P: /run/selected_groq_whisper_model
    S-->>P: 200 キー
    P->>S: /get/data/selectable_transcription_engines、/get/data/selected_transcription_engine
    P->>P: エンジンを選べるようにする
  else 確かめられない（拒否、形式の誤り、通信失敗、モデルなし、初期化失敗）
    S->>S: 保存してあるキーと状態はそのまま
    S-->>P: 400 {error_code: TRANSCRIPTION_API_AUTH_FAILED, data: 保存してあるキー}
    P->>P: 欄を保存してあるキーに戻し、理由を通知
  end
```

翻訳のキー（`/set/data/groq_auth_key`など）も同じ流れで、エラーコードは`AUTH_…`になる。準備と反映、同時変更、OpenAI互換URLの失敗時の扱いは[APIキーの変更](cross-cutting.md#apiキーの変更)に従う。

従来の文字起こしと音量メーターの開始・停止、Auto選択、機器の切り替えは、[音声デバイスの選択と識別](data-and-persistence.md#音声デバイスの選択と識別)に従う。機器の切り替えでは、開けた収録先を通知してから変更前後の名前を知らせる。録音エラーは文字起こしの処理を待たずに検出し、メーターだけが動いている場合も終了を通知する。
