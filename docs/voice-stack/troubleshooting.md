# P1 troubleshooting

[日本語版](#p1トラブルシューティング日本語版)

| State | What to check |
|---|---|
| `http_404` / `http_503` | Whether the TTS model is loaded in speech.cpp. Whether the server is one for a different task |
| `http_400` | The registered voice name and the language. Do not add model-specific options you guessed |
| `expected_pcm` / `invalid_sample_rate` | Whether `/v1/audio/speech` returns audio/pcm and the correct X-Sample-Rate |
| `transport_error` / `request_timeout` | The localhost port, whether the server is running, and GPU load. A request is not resent automatically from the middle. The breakdown of `transport_error` appears in `last_error_detail` of `/get/data/voice_status` (`socket` is a failure to connect, read or write, `ended_early` means the response was cut off partway, `malformed` means the response was malformed, `stalled` is a timeout, and `interrupted` means a stop action cut it off) |
| `first_audio_timeout` | The response headers and the first PCM did not arrive within 10 seconds. Check model warmup, sentence length and GPU load. The connection and each later read have 2 seconds, and the whole request has 30 seconds |
| `realtime_asr_timeout` | No realtime caption result arrived. The first result on a connection is awaited for up to 120 seconds, later ones for up to 15 seconds. Check GPU load and the inference device. There is no automatic reconnection, so turn the switch off and on again |
| `language_or_text_unavailable` | Your own language, the selected translation target, a valid translated text, and a separate port for a server in another language |
| `audio_devices_unavailable` | On Windows, the WASAPI devices (from 0.5.0 the core's `native/audio-routing` reads them directly; up to 0.4, PyAudioWPatch). On Linux, the user's PipeWire session (the 0.5.0 core reads it with libpipewire-0.3; up to 0.4, pw-dump) |
| `speech_server_vulkan_missing` | The Vulkan build of speech.cpp cannot find the loader. Check `vulkan-1.dll` on Windows and `libvulkan.so.1` on Linux. To use the CPU on Linux, choose "CPU" under "Inference device" |
| `vc_feedback_blocked` | On Windows, the input and the output are the two ends of the same virtual cable. Choose a real microphone as the input |
| `vc_capture_overrun`, `vc_block_expired` | Conversion is not keeping up with real time. Stop other apps that use the GPU. The delay at the time it stopped is recorded under `voice conversion stopped` in `process.log` (a large `round_trip_ms` means waiting for the GPU to process; if only `block_age_ms` is large, the wait is before the block reaches the worker). The steps for Windows are [here](local-setup-windows.md#rvc) |
| `output_missing*` / `output_disconnected` | Refresh the list and choose the device again explicitly. There is no automatic switch to the default device |
| `output_stalled` / `output_drain_timeout` | The sink and source connections in the PipeWire graph, and the input selected in VRChat |
| `monitor_output_missing` / `monitor_output_disconnected` / `monitor_pipewire_unavailable` | A problem with the monitor output (listening on your own speakers) only. Speech to the virtual microphone continues. Choose the monitor output again on the TTS page |
| `monitor_feedback_blocked` | The virtual microphone and the TTS output cannot be chosen as the monitor output. Choose speakers or headphones |
| Speech plays twice | Turn off external reading tools (such as VRCT-TTS by the upstream author). A new send with a different ID is spoken separately, even for the same sentence |
| Queued but nothing is spoken | Speech is discarded on a queue overflow or after waiting more than 5 seconds. Check `dropped` in `/get/data/voice_status`. A wait over 5 seconds is also counted in `expired`, and the UI shows a warning when that count grows |
| The VRChat meter moves but the test is silent | The mic test records a short clip and plays it back, so start `New Test` while input is coming in. Also check the menu sounds, VRChat's Master and mic volume, and whether the OS output is muted |

When TTS is off or fails, the existing text sending keeps working. Received messages, microphone text and OCR text are not sent to the P1 TTS.
Deduplication of internal events remembers the same source/event ID for 120 seconds, up to the latest 512 entries.
A stop or a settings change during translation invalidates the old request through the generation number.
Logs and status hold only numbers and error codes, and no HTTP bodies or audio are newly saved.
In the settings UI, the voice name is typed in as the name registered with serve; voices are not listed automatically. The default model can be downloaded from the settings screen ([model downloads](model-downloads.md)).

---

# P1トラブルシューティング（日本語版）

| 状態 | 確認すること |
|---|---|
| `http_404` / `http_503` | speech.cppでTTSモデルを読み込み済みか。別taskのサーバーではないか |
| `http_400` | 登録voice名・language。推測したモデル別オプションを追加しない |
| `expected_pcm` / `invalid_sample_rate` | `/v1/audio/speech`がaudio/pcmと正しいX-Sample-Rateを返すか |
| `transport_error` / `request_timeout` | localhostのポート・サーバー稼働・GPU負荷。途中からの自動再送はしない。`transport_error`の内訳は`/get/data/voice_status`の`last_error_detail`に出る（`socket`は接続か読み書きの失敗、`ended_early`は応答が途中で切れた、`malformed`は応答の形が崩れていた、`stalled`は時間切れ、`interrupted`は止める操作で切れた） |
| `first_audio_timeout` | 応答ヘッダ＋最初のPCMが10秒内に届かなかった。モデルwarmup、文の長さ、GPU負荷を確認。接続/後続readは2秒、要求全体は30秒 |
| `realtime_asr_timeout` | リアルタイム字幕の結果が届かなかった。接続の最初の結果は120秒、以降は15秒まで待つ。GPU負荷と推論デバイスを確認。自動再接続はしないので、スイッチを入れ直す |
| `language_or_text_unavailable` | 自分の言語、選択した翻訳先、有効な訳文、他言語サーバーの別ポート |
| `audio_devices_unavailable` | WindowsはWASAPIのデバイス（0.5.0から中核の`native/audio-routing`が直接読む。0.4まではPyAudioWPatch）、LinuxはユーザーのPipeWireセッション（0.5.0の中核はlibpipewire-0.3で読む。0.4まではpw-dump） |
| `speech_server_vulkan_missing` | Vulkan版のspeech.cppがローダーを見つけられない。Windowsでは `vulkan-1.dll`、Linuxでは `libvulkan.so.1` を確認する。LinuxでCPUを使う場合は、推論デバイスで「CPU」を選ぶ |
| `vc_feedback_blocked` | Windowsで入力と出力が同じ仮想ケーブルの両端。入力に実際のマイクを選ぶ |
| `vc_capture_overrun`、`vc_block_expired` | 変換が実時間に追いついていない。GPUを使う他のアプリを止める。止まったときの遅れは、`process.log`の`voice conversion stopped`に残る（`round_trip_ms`が大きければGPUの処理待ち、`block_age_ms`だけが大きければワーカーへ渡すまでの待ち）。Windowsの手順は[ここ](local-setup-windows.md#rvc) |
| `output_missing*` / `output_disconnected` | 一覧更新・明示再選択。既定デバイスへ自動切替しない |
| `output_stalled` / `output_drain_timeout` | PipeWireグラフのsink/source接続、VRChat入力選択 |
| `monitor_output_missing` / `monitor_output_disconnected` / `monitor_pipewire_unavailable` | モニター出力（自分のスピーカーで聞く）だけの問題。仮想マイクへの読み上げは続く。TTSページでモニター出力先を選び直す |
| `monitor_feedback_blocked` | モニター出力先に仮想マイクやTTSの出力先は選べない。スピーカーかヘッドホンを選ぶ |
| 二重発声 | 外部の読み上げツール（上流作者のVRCT-TTSなど）をOFF。同じ文でも別IDの新規送信は別発声 |
| 待機中だが発声なし | キューoverflow/5秒超過は破棄。`/get/data/voice_status`のdroppedを確認。5秒超過はexpiredにも数え、増えるとUIが警告を出す |
| VRChatメーターは動くがテストは無音 | マイクテストは短く録音して再生するため、入力が来ている間に`New Test`を開始。メニュー音、VRChat Master/マイク音量、OS出力のミュートも確認 |

TTSが無効/失敗しても既存の文字送信を維持する。受信/マイク/OCRをP1のTTSへは送らない。
内部イベントの重複除去は同じsource/event IDを120秒・最新512件まで記憶する。
翻訳中のstop/設定変更は世代番号で旧要求を無効化する。
ログ/状態は数値とエラーコードだけで、HTTP本文や音声を新たに保存しない。
設定UIの声名はserveの登録名を入力する方式で、自動voice列挙はない。既定モデルは設定画面から取得できる（[取得機能](model-downloads.md)）。
