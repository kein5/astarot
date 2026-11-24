---
date: 2026-11-14
status: accepted
era: python-sidecar
validity: implementation_changed
validity_note: 読み上げを変換の入力へ送り、ミュートと直接音声の抑制を分ける決定は変わらない。Rust の中核では変換の持ち主がアプリのスレッドで動き、router_protocol.py の制御の枠の代わりに直接の呼び出しで読み上げを渡す。Seed-VC は 0.5.0 で外れた。
implementation_status: partial
implementation_checked: 2026-11-18
implementation_note: Windows のデバイスの経路では動く。Linux の管理対象の経路は、native/audio-routing に PipeWire での録音がまだないので、変換を始めると vc_start_failed になる。
evidence:
  - native/voice-conversion/README.md
  - native/voice-conversion/src/process.rs
  - native/tts/src/converted.rs
---
# ADR-007: Route translated speech through voice conversion

[日本語版](#adr-007-訳文の読み上げを声の変換に通す日本語版)

Status: Accepted (2026-11-14). On Windows, checked with the real RVC on this PC. The managed route on Linux has not been checked on real hardware yet.
Date: 2026-11-14
Related: [ADR-004](adr-004-audio-integration-boundaries.md), [ADR-005](adr-005-managed-microphone-lifetime.md), [ADR-006](adr-006-external-source-health.md)

## What was asked

On 2026-11-14 the user asked: "We should make TTS and RVC work with translation in between too."

- **TTS**: already possible. For typed text, setting "Chat voice" to "Translated text" speaks the translation. For what is said into the microphone, setting "Realtime microphone speech" to "Speak the confirmed translation" speaks the confirmed translation of the realtime captions.
- **RVC and Seed-VC**: not possible. Only microphone audio goes into the conversion; TTS audio flows to the output without going through the conversion.

This proposal deals with the latter. It connects speaking into the microphone → speech recognition → translation → TTS → voice conversion → virtual microphone, and delivers the translation in the user's own voice after conversion.

## How it works now

- The app (`IsolatedVCProcess`) starts the conversion process (`router_worker`) separately and sends it control only. The control channel is "metadata-only" and carries no audio (`router_protocol.py`).
- The conversion process (`VCProcess`) captures the microphone at 48 kHz in 20 ms steps, groups the audio into 80 ms blocks and sends them to the inference child process. Each block carries its capture time, and blocks that are too old are dropped (`protocol.py`).
- For TTS, `VoiceEventBus` writes the PCM it received from speech.cpp to the output device through `AudioRouter`.
- Setting "Direct input while speaking" to "Suppress direct input" stops direct voice (including the converted voice) from being output.
  - On Windows, `DirectVoice.set_suppressed` silences the conversion output.
  - On Linux, the managed route mutes the VC sink with the OS gate and checks that state.
  - On both, while the setting is on, direct voice is not output even when nothing is being spoken.

## Decision (proposal)

1. **Setting**: add "Speak through voice conversion" to the "TTS" page. It is off by default. Even when it is on, if voice conversion is not running in "Convert", TTS is output as is, as before. In that case the status field shows the reason.
2. **Audio route**: the app converts TTS PCM to 48 kHz, mono, s16le and passes it to the conversion process. A new kind of frame (`speech`, PCM of 80 ms or less), plus `speech_end` and `speech_cancel`, are added to the control channel.
   - Because audio now travels on the control channel, the "metadata-only" of `router_protocol.py` changes. PCM is not logged. It is cut into pieces that do not exceed the frame limit (32 KiB).
   - Audio is sent at most 400 ms ahead of its playback time. Even when TTS is generated quickly, the conversion process is not made to pile it up.
   - Adding a separate pipe is not chosen, because on Windows it would need a way to pass a handle to the child process.
3. **Input replacement**: while there is TTS audio, `VCProcess` replaces each captured 20 ms of microphone audio with the same length of TTS audio. The time is the one from the microphone capture. This way the current freshness check and order check can be used as they are. If the TTS audio runs out in the middle of an utterance, silence goes in, not the microphone. After `speech_end`, once the audio is used up, it goes back to the microphone.
4. **Separate mute and suppression**: at present, "mute" and "suppression of direct voice" are one flag. They are split.
   - Mute: stops everything, including the audio that carries TTS (as now).
   - Suppression: silences only blocks that came from the microphone. Blocks that carry TTS are output.
   - On Linux, while this setting is on, the VC sink cannot be suppressed with the OS gate (because the translation also goes through it). `VCProcess` does the suppression by silencing block by block. The status field and the spec state that the suppression is no longer confirmed by the OS. The global mute is confirmed with the OS gate, as before.
5. **Stop actions**: "Stop speech", turning TTS off and a cancel of microphone TTS send `speech_cancel`, and the conversion process drops the audio it has buffered right away. The TTS queue does not move on until the audio of that utterance is used up.

## Options not taken

- **Mix conversion of the original voice with conversion of the translation**: the conversion has one input, so the two cannot be converted at the same time. While this setting is on, "Mix direct input and speech" cannot be selected.
- **Generate TTS in the conversion process**: the conversion process runs in a Torch environment. Moving the speech.cpp connection target and the queue there would give TTS stop and mute two owners.

## Consequences

- Delay: from the end of what was said until the translation is heard, the time for speech recognition, translation, TTS and conversion adds up. Conversion works in blocks, so this is expected to be at least 80 ms to a few hundred ms longer than TTS alone. Numbers will be written after measuring.
- Tests: a test worker that, in place of the conversion child process, transforms the input directly and returns it is used to check replacement, gaps, cancel, and combinations of mute and suppression. The real conversion is checked on this PC (Windows 11) with Saisho Utane's RVC model, receiving the output on the recording side of a virtual cable. The managed route on Linux is checked on a PC with PipeWire.
- Spec: update the mute section of [cross-cutting behavior](../spec/cross-cutting.md) and the description of the independent TTS and RVC switches in [contracts](../spec/contracts.md). The TTS and RVC switches stay independent. TTS goes through the conversion only when both are on.

## Implementation and checks (2026-11-14)

- The setting is `VoiceSettings.conversion` (`off`/`on`). `on` and "Mix direct input and speech" cannot be saved together.
- The app resamples TTS to 48 kHz in `ConvertedSpeechRouter` (soxr) and sends it in 80 ms pieces through `IsolatedVCProcess.speak`, at most 400 ms ahead of playback. The conversion process receives it in `VCProcess.speech_chunk` and replaces 20 ms of microphone audio.
- Mute and suppression of direct voice were split with `suppressed` in the control frame (`monitor_mute`). When `conversion` is `on`, the Linux gate does not suppress direct voice.
- Measured (Windows 11, RTX 3060 Ti, Saisho Utane, a fake input passing silence every 20 ms): the conversion round trip is about 31 ms. The level of the converted TTS has a median of about 3000, clearly louder than the quiet input sound (about 530). With suppression on, microphone blocks went to 0 and TTS was output. With suppression on, 47 ms passed from the start of sending until the converted TTS came out.
- A check with the app running (from speech.cpp TTS to the recording side of the virtual cable) has not been done yet.

## Conditions that reverse the decision

- Measurement shows that going through conversion delays the translation so much that it cannot be followed, or breaks it up.
- On Linux, block-by-block suppression breaks the promise of a mute confirmed by the OS ([ADR-005](adr-005-managed-microphone-lifetime.md)).

---

# ADR-007: 訳文の読み上げを声の変換に通す（日本語版）

Status: 採用（2026-11-14）。WindowsではこのPCの実物のRVCで確かめた。Linuxの管理対象の経路は、実機ではまだ確かめていない。
Date: 2026-11-14
Related: [ADR-004](adr-004-audio-integration-boundaries.md)、[ADR-005](adr-005-managed-microphone-lifetime.md)、[ADR-006](adr-006-external-source-health.md)

## 求められていること

利用者は2026-11-14に「TTSとRVCも翻訳を挟めるようにしよう」と依頼した。

- **TTS**: すでにできる。入力した文は「読み上げ」を「翻訳文」にすると訳文を読む。マイクの発言は「Realtimeマイクの発声」を「確定した翻訳を読み上げる」にすると、リアルタイム字幕の確定した訳文を読む。
- **RVCとSeed-VC**: できない。変換に入るのはマイクの音声だけで、読み上げの音声は変換を通らずに出力へ流れる。

この提案は後者を扱う。マイクで話す → 音声認識 → 翻訳 → 読み上げ → 声の変換 → 仮想マイク、とつなぎ、訳文を変換後の自分の声で届ける。

## いまの作り

- アプリ（`IsolatedVCProcess`）は変換のプロセス（`router_worker`）を別に起動し、制御だけを送る。制御の経路は「metadata-only」で、音声は流さない（`router_protocol.py`）。
- 変換のプロセス（`VCProcess`）はマイクを48 kHz、20 msずつ取り込み、80 msのブロックにまとめて推論の子プロセスへ送る。ブロックは取り込みの時刻を持ち、古すぎるものは捨てる（`protocol.py`）。
- 読み上げは`VoiceEventBus`がspeech.cppから受け取ったPCMを、`AudioRouter`で出力デバイスへ書く。
- 「翻訳発声中の直接音声」を「止める」にすると、直接音声（変換した声を含む）を出さない。
  - Windowsは`DirectVoice.set_suppressed`で変換の出力を無音にする。
  - Linuxは管理対象の経路でVCのsinkをOSのゲートでミュートし、その状態を確かめる。
  - どちらも、設定がオンのあいだは読み上げていないときも直接音声を出さない。

## 決定（提案）

1. **設定**: 「TTS」のページに「読み上げを声の変換に通す」を足す。初期値はオフ。オンでも、声の変換が「変換」で動いていないときは、これまでどおり読み上げをそのまま出す。そのときは状態の欄に理由を出す。
2. **音声の経路**: アプリは読み上げのPCMを48 kHz、モノラル、s16leに変換し、変換のプロセスへ渡す。制御の経路に新しい種類の枠（`speech`、80 ms以下のPCM）と、`speech_end`、`speech_cancel`を足す。
   - 制御の経路に音声を載せるので、`router_protocol.py`の「metadata-only」は変わる。PCMはログに残さない。枠の上限（32 KiB）を超えない大きさに切る。
   - 先に送るのは再生の時刻より最大400 ms先まで。読み上げが速く作られても、変換のプロセスに溜め込ませない。
   - 別のパイプを足す案は、Windowsでハンドルを子プロセスへ渡す仕組みが要るので取らない。
3. **入力の差し替え**: `VCProcess`は読み上げの音声があるあいだ、取り込んだマイクの20 msをその分の読み上げの音声に置き換える。時刻はマイクの取り込みのものを使う。こうすると、いまの鮮度の確認と順番の確認をそのまま使える。発話の途中で読み上げの音声が途切れたら、マイクではなく無音を入れる。`speech_end`のあと音声を使い切ったら、マイクへ戻す。
4. **ミュートと抑制を分ける**: いまは「ミュート」と「直接音声の抑制」が1つのフラグになっている。これを分ける。
   - ミュート: 読み上げを通した音声も含め、すべて止める（いまと同じ）。
   - 抑制: マイクから来たブロックだけを無音にする。読み上げを通したブロックは出す。
   - Linuxでは、この設定がオンのあいだVCのsinkをOSのゲートで抑制できない（訳文もそこを通るため）。抑制は`VCProcess`がブロックごとに無音にして行う。OSで確かめた抑制ではなくなることを、状態の欄と仕様に書く。全体のミュートは、これまでどおりOSのゲートで確かめる。
5. **止める操作**: 「読み上げ停止」、TTSのオフ、マイクの読み上げの取り消しは、`speech_cancel`を送り、変換のプロセスが溜めた音声をすぐ捨てる。読み上げの待ち行列は、その発声の音声を使い切るまで次へ進まない。

## 取らない案

- **元の声の変換と訳文の変換を混ぜる**: 変換の入力は1つなので、同時には変換できない。この設定がオンのあいだ「直接音声と読み上げを混ぜる」は選べない。
- **変換のプロセスで読み上げを作る**: 変換のプロセスはTorchの環境で動く。speech.cppの接続先や待ち行列をそこへ移すと、読み上げの停止とミュートの所有者が2つになる。

## 影響

- 遅れ: 発言の終わりから訳文が聞こえるまでに、音声認識、翻訳、読み上げ、変換の時間が足される。変換はブロック単位なので、読み上げだけのときより少なくとも80 msから数百 ms延びる見込みである。実測してから数字を書く。
- 試験: 変換の子プロセスの代わりに入力をそのまま変形して返す試験用のworkerで、差し替え、途切れ、取り消し、ミュートと抑制の組み合わせを確かめる。実物では、このPC（Windows 11）でSaisho UtaneのRVCモデルを使い、出力を仮想ケーブルの録音側で受けて確かめる。Linuxの管理対象の経路は、PipeWireのあるPCで確かめる。
- 仕様: [横断的な振る舞い](../spec/cross-cutting.md)のミュートの節と、[契約](../spec/contracts.md)のTTSとRVCの独立したスイッチの記述を更新する。TTSとRVCのスイッチは独立のまま。読み上げが変換を通るのは、2つが両方オンのときだけである。

## 実装と確認（2026-11-14）

- 設定は`VoiceSettings.conversion`（`off`/`on`）。`on`と「直接音声と読み上げを混ぜる」は一緒に保存できない。
- アプリは`ConvertedSpeechRouter`で読み上げを48 kHzにし（soxr）、`IsolatedVCProcess.speak`で80 msずつ、再生より最大400 ms先まで送る。変換のプロセスは`VCProcess.speech_chunk`で受け、マイクの20 msを置き換える。
- ミュートと直接音声の抑制は、制御の枠（`monitor_mute`）の`suppressed`で分けた。`conversion`が`on`のとき、Linuxのゲートは直接音声を抑えない。
- 実測（Windows 11、RTX 3060 Ti、Saisho Utane、偽の入力で20 msごとに無音を渡す）: 変換の往復は約31 ms。読み上げの変換後の音量は中央値約3000で、入力の小さな音（約530）よりはっきり大きい。抑制ありではマイクのブロックは0になり、読み上げは出た。抑制ありで、送り始めてから変換した読み上げが出るまで47 ms。
- アプリを起動しての確認（speech.cppの読み上げから、仮想ケーブルの録音側まで）はまだしていない。

## 覆す条件

- 実測で、変換を通すと訳文が聞き取れないほど遅れる、または途切れる場合。
- Linuxでブロックごとの抑制が、OSで確かめるミュートの約束（[ADR-005](adr-005-managed-microphone-lifetime.md)）を崩す場合。
