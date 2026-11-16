# vrct-transcription

音声認識の Rust クレートです。Issue #278 の範囲で、Python の `src-python/models/transcription/` と、`model.py` の録音の部分（`_AudioDeviceSession`）を置き換えます。中核（`native/core`）がこのクレートをエンドポイントにつなぎます（`controller::transcription` と `controller::realtime_asr`）。

## 内容

| モジュール | 役割 | Python |
|---|---|---|
| `recorder` | 1 つの音源の録音。音量メーター、フレーズの切り出し、認識をまとめて動かす | `model.py` の `_AudioDeviceSession`、`transcription_recorder.py` |
| `energy` | 音量によるフレーズの切り出し（しきい値、自動しきい値、`MIC_RECORD_TIMEOUT`） | `speech_recognition` の `listen_energy_and_audio` |
| `phrases` | フレーズをつないで発話にする（`MIC_PHRASE_TIMEOUT`、15 秒の上限、`MIC_MAX_PHRASES`） | `transcription_transcriber.py` の `transcribeAudioQueue` |
| `providers` | Google、OpenAI 互換の API（Groq、OpenAI、カスタム）、Deepgram。キーの確認とモデルの一覧 | `transcription_providers.py`、`transcription_openai_compatible.py`、`transcription_deepgram.py` |
| `speechcpp` | speech.cpp のモデルの一覧と語彙（VRChat の用語を含む） | `speechcpp_asr.py`、`asr_vocabulary.py`、`vrchat_terms.py` |
| `realtime` | speech.cpp の Realtime の WebSocket に音声を流し、字幕と確定した文を届ける | `realtime_session.py`、`speechcpp_realtime.py`、`realtime_audio.py`、`realtime_events.py`、`realtime_delivery.py` |
| `capture` | 録音の口。Windows は WASAPI（スピーカーはループバック）、Linux は `vrct-asr-capture` | `capture_windows.py`、`capture_pipewire.py`、`capture_packets.py` |
| `pcm` | 音量（`audioop.rms`）、モノラル化、サンプリング周波数の変換、WAV と FLAC | `audioop`、`numpy`、`soxr` |

## Python と同じにしていること

- フレーズの切り出し。1024 フレームずつ音量を測り、しきい値を超えたら始め、0.8 秒の無音で終えます。前後に 0.5 秒までの無音を残し、0.3 秒に満たない音は捨てます。自動しきい値の減衰（毎秒 0.15）と倍率（1.5）も同じです。フレーズの長さの上限は `MIC_RECORD_TIMEOUT`（0 は上限なし）です。
- 発話のまとめ方。キューが空になるたびに、それまでの発話をまとめて認識し直します。`MIC_PHRASE_TIMEOUT` より長い無音、15 秒の音声、または無音のまま `MIC_PHRASE_TIMEOUT` が過ぎたら発話を終えます。結果は `MIC_MAX_PHRASES` に 1 を足した数まで待たせ、あふれたら古いものから捨てます。録音から認識へのキューは 20 件で、あふれたら古いものを捨てます。
- エンジンへの頼み方。候補の言語ごとに頼み、いちばん確かな結果を使います。言語が 1 つのときだけ言語を指定します。Whisper の API は `verbose_json` のセグメントを `MIC_AVG_LOGPROB` と `MIC_NO_SPEECH_PROB` で選びます（`gpt-*-transcribe` は `json`）。送る音声は 16 kHz の WAV で、Google には FLAC を送ります。Google は `speech_recognition` と同じ公開の既定キーと HTTPS の URL を使います。
- 失敗の扱い。認識できなかった候補は飛ばし、どの候補でも結果がなくエンジンが失敗したときは `ASR_ERROR` です。キーの確認はモデルの一覧が取れるか（Deepgram は `/auth/token`）で決め、待ち時間は 3 秒です。認識の待ち時間は接続 10 秒、読み書き 60 秒（Google は 10 秒）です。
- Realtime の約束事。24 kHz のモノラルを 20 ms ずつ送り、250 ms より古い音声は送りません。字幕の更新は 32 件、確定した文は 4 件まで待たせます。1 つの発話は 15 秒（接続して最初の発話は 120 秒）で終わらなければ失敗です。確定した文は受け取ってから 2 秒以内に届けられなければ「届けなかった」と字幕に書きます。

## Python と違う点

- **リサンプラー**。Python は soxr（HQ）でした。ここでは窓付き sinc のリサンプラーで、通過帯域は出力のナイキスト周波数の 95% です。
- **スピーカーのループバックの無音**。WASAPI のループバックは何も鳴っていない間は何も渡しません。Python は Realtime の経路だけで無音を足していました。ここでは録音の経路でも 60 ms 以上の空きを無音で埋めます。発話の終わりが、次に音が鳴るまで待たされないためです。
- **停止**。Python は止めるときに認識の要求が終わるのを最大 15 秒待ちました。ここでは録音だけを止めて戻り、途中の要求の結果は捨てます。
- **OpenAI 互換の API の再試行**。SDK と同じく、通信の失敗と 408、409、429、5xx のときに 2 回まで再試行します。Python の SDK の待ち時間（揺らぎつき）とは少し違います。
- **VAD**。Python は `MIC_ENABLE_VAD` のときに Silero VAD でフレーズを切っていました。モデルと ONNX Runtime の同梱が決まっていないので、ここでは音量による切り出しを使います（[core-integration.md](../../docs/voice-stack/core-integration.md) の「判断が要ること」）。

## 試験

```sh
cargo test --manifest-path native/transcription/Cargo.toml
```

単体の試験は音声の処理（音量、モノラル化、変換、FLAC、フレーズの切り出しとまとめ方）、言語の照合、語彙、Realtime のイベントです。エンドポイントを通した試験は中核の `tests/transcription.rs` と `tests/realtime_asr.rs` にあり、偽のデバイスと 127.0.0.1 の偽のサーバを使います。

認識した文、音声、API キーは、ログにも試験の出力にも入れません。
