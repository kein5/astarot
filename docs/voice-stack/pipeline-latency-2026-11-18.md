# Measuring and shortening voice pipeline latency (2026-11-18)

[日本語版](#音声パイプラインの遅延の計測と短縮2026-11-18日本語版)

This is a record of measuring, stage by stage, the time from speaking into the microphone until the translated voice starts to be heard, and of shortening the longest stages first (#556). Every value was measured on the PC described in "Measurement PC" below and is not a guarantee for any other environment.

## Summary of results

From the end of speech until the translated voice starts to be heard, p50 went down from 1,316 ms to 972 ms (p95 from 1,556 ms to 1,149 ms). Recognition accuracy and the way utterances are segmented were not changed.

| Stage | Before (p50) | After (p50) | Change made |
|---|---:|---:|---|
| End of speech → final recognition result | 770 ms | 704 ms | Set the segmentation padding to half the silence |
| Final result → message processing starts | 0 ms | 0 ms | None |
| Translation | 109 ms | 109 ms | Not changed |
| Chatbox send → voice becomes audible | 418 ms | 128 ms | Skipped the leading silence of the TTS audio |

Before the change, the longest stage was waiting for the recognition result to be finalized, at about 60% of the total. Next came the leading silence of the TTS audio at about 30%, and translation took just under 10%.

This work also added a setting that users can choose. Setting the silence that counts as the end of speech to 0.4 seconds makes finalization about 100 ms earlier again, and 0.3 seconds about 200 ms earlier. In exchange, an utterance is more likely to be split at a pause in the middle of a sentence ([Silence that ends an utterance](#silence-that-ends-an-utterance)). The default for this silence was set to 0.4 seconds on 2026-11-19 (see the addendum in the same section).

## Measurement PC

- CPU: AMD Ryzen 9 9950X3D (16 cores, 32 threads)
- GPU: NVIDIA GeForce RTX 4080 SUPER 16 GB (driver 620.70.06, PCIe 4.0 x16). The Radeon graphics built into the CPU were not used.
- Memory: 64 GB
- Storage: KIOXIA EXCERIA PRO G2 2 TB (NVMe). The models and the app are on this drive.
- OS: CachyOS (Linux 6.18.60-2-cachyos-lts), PipeWire 1.6.11

Other development work kept running during the measurements. The load average was 0.2 to 20 depending on the run, and other apps used about 6.8 GB of GPU memory. VRChat was not running. Translation runs on the CPU, so the translation p95 grew in runs with a high load. The before-and-after comparison comes from running the code before and after the change twice each, alternating between them ([Final comparison](#final-comparison)).

## Measurement method

The measurements used `native/core/examples/pipeline_latency.rs`. It starts the core inside its own process, as the app does, and replaces only the three parts below. It does not touch the PC's audio devices.

- Microphone: feeds a WAVE file in 10 ms pieces in real time. Each utterance is followed by 8 seconds of silence.
- TTS output: records the time at which the first sample loud enough to hear (amplitude above 64, about -54 dBFS) is written, and accepts audio at the same rate as a device (read-ahead up to 40 ms).
- Chatbox: a UDP socket listening on 127.0.0.2.

| Item | Details |
|---|---|
| Recognition | Qwen3-ASR 0.6B Q8_0 and Silero VAD v6.2 F32. Realtime captions running on the bundled speech.cpp 0.11.0 (Vulkan) on the RTX 4080 SUPER |
| Translation | Local translation (m2m100_418M, ONNX, int8) on the CPU. ONNX Runtime from the 0.5.1 release package |
| TTS | Qwen3-TTS 12Hz 0.6B CustomVoice Q8_0, voice `ryan`. The bundled speech.cpp on Vulkan |
| Route | Speak in Japanese, translate into English and read the translation aloud (`mic_mode: translated`) |
| Input | Six Japanese sentences made with Irodori-TTS v4.1 (2.7 to 5.6 seconds, 48 kHz). The first sentence is used as a warm-up, and the six sentences are played in three rounds, so one measurement has n=18 |

All times come from a monotonic clock (`vrct_tts::clock::monotonic_ns`). "End of speech" is the time at which the last 10 ms block within 30 dB of the loudest 10 ms block reached the core. The `/run/io_trace` values of the flow screen (#448) (translation, chatbox, speech synthesis) are recorded alongside. The harness outputs only times, counts and the character error rate (CER); it does not output the recognized text, the translations or the audio.

```sh
ORT_DYLIB_PATH=<_internal/onnxruntime/libonnxruntime.so from 0.5.1> \
cargo run --release --locked --manifest-path native/core/Cargo.toml --example pipeline_latency -- \
    --app-dir . --clips <folder with clip0.wav to clip6.wav and texts.txt> \
    --asr-model <Qwen3-ASR-0.6B-Q8_0.gguf> --vad-model <silero-vad-309K-v6.2-F32.gguf> \
    --tts-model <Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf> --translation <m2m100_418M-onnx-int8 folder> \
    --runs 3 --out results.jsonl
```

Not included: the OS recording and playback buffers, the virtual microphone, anything inside VRChat and the network. On a real setup, the recording helper (`vrct-asr-capture` on Linux) passes audio in 10 ms units and the realtime captions session sends it to the server 20 ms at a time, so the recording side adds a further delay of up to a few tens of milliseconds. That part was not measured.

## Breakdown before the change

These values were measured on the code before the change (the commit that only added the harness), under the same conditions as [Final comparison](#final-comparison) (n=36).

| Stage | p50 | p95 |
|---|---:|---:|
| End of speech → final recognition result | 770 ms | 850 ms |
| Final result → message processing starts | 0.0 ms | 0.5 ms |
| Translation | 109 ms | 272 ms |
| End of speech → chatbox send | 886 ms | 1,085 ms |
| Chatbox send → voice becomes audible | 418 ms | 708 ms |
| Of which: speech synthesis request → first write | 26 ms | 39 ms |
| Of which: first write → audible | 386 ms | 396 ms |
| End of speech → voice becomes audible | 1,316 ms | 1,556 ms |

In 12 of the 36 cases, the utterance was split in two (the same 2 of the 6 sentences split every time). The mean CER is 0.022. A measurement taken when the work started (n=18, load average 4.7) gave almost the same values (p50 from the end of speech to the voice: 1,308 ms).

## Leading silence in TTS audio

TTS in speech.cpp returns the first audio within a few tens of milliseconds. That audio, however, started with near silence. Played as it is, it keeps the listener waiting through the silence. These are the values measured by sending requests straight to the TTS server (same PC, Vulkan):

| Model | Until the first chunk arrives | Position of the first sample above amplitude 64 | Until the whole result is returned |
|---|---|---|---|
| Qwen3-TTS 0.6B Q8_0 (English, `ryan`, 6 sentences × 3) | 12 to 21 ms | 421 to 435 ms (every sentence) | 0.27 to 1.30 s for 2.5 to 11.7 s of audio |
| Irodori-TTS v4.1 F16 (Japanese, `none`, 6 sentences × 2) | 39 to 50 ms | 0 to 276 ms (median about 19 ms) | 78 to 111 ms for 2.7 to 5.6 s of audio |

Both generate audio much faster than real time, so skipping the leading silence does not make the audio after it break up.

Change made (`native/tts/src/onset.rs`): for TTS from speech.cpp, the part before the first sample above amplitude 64 is dropped. The 20 ms just before that sample are kept, and at most 1 second is dropped. Installed engines such as VOICEVOX are excluded, because users can set their leading silence (`prePhonemeLength` in COEIROINK). The deadline for microphone TTS to start (5 seconds) now counts from the first audible sound.

Effect (measured during the work, n=18 each): the time from the chatbox send until the voice becomes audible went down from 413 ms to 154 ms at p50 and from 729 ms to 341 ms at p95. From the speech synthesis request until the voice becomes audible took 116 to 138 ms at p50 (each run in this record).

## Finalizing the recognition result

In realtime captions, the VAD of the speech.cpp server (`server_vad`) decides where utterances are segmented. Before the change, no segmentation settings were sent, and the server ran with its defaults (500 ms of silence, 300 ms of padding).

speech.cpp finalizes an utterance only once it knows that no next utterance starts within twice the padding (`prefix_padding_ms`) (speech.cpp ADR "A detection of audio given a piece at a time gives speech_detect()'s regions, each once it is certain"). With the default pair, twice the padding (600 ms) is longer than the 500 ms of silence, so finalization had to wait 600 ms, not 500 ms. The recognition time comes on top of that. Shortening only the silence to 300 ms did not change the time to finalization (p50 759 ms) and only raised the number of utterances split in the middle of a sentence (table below).

Change made (`turn_detection` in `native/transcription/src/realtime/session.rs`): the session sends the silence length and a padding of half that length (up to 300 ms). When the padding is at most half the silence, the utterance is finalized as soon as the silence has lasted its full length. Where an utterance is split depends only on the silence length, so with the default of 500 ms the segmentation does not change.

### Silence that ends an utterance

Users can now choose the length of the silence in the "Realtime captions" settings (`REALTIME_ASR_SETTINGS.silence_duration_ms`, default 0.5 seconds; also 0.3, 0.4, 0.7 and 1 second). n=18 for each row.

| Silence / padding | Final p50 | Final p95 | Utterances split in two | Mean CER |
|---|---:|---:|---:|---:|
| 500 / 300 ms (before the change) | 763 ms | 818 ms | 6/18 | 0.022 |
| 300 / 300 ms (silence shortened only) | 759 ms | 862 ms | 9/18 | 0.049 |
| 500 / 250 ms (default after the change) | 704 ms | 834 ms | 6/18 | 0.022 |
| 400 / 200 ms | 599 ms | 673 ms | 9/18 | 0.049 |
| 300 / 150 ms | 507 ms | 575 ms | 9/18 | 0.049 |

On the code that already skipped the leading silence of the TTS audio, the p50 from the end of speech to the voice was 991 ms with 500 / 250 ms, 872 ms with 400 / 200 ms and 768 ms with 300 / 150 ms. With 0.4 and 0.3 seconds, the same sentence, which has no comma, split in two in all three rounds, and its CER rose from 0 to 0.16. A split sentence appears as two messages, both in the chatbox and in the TTS output. For that reason, the default stays at 0.5 seconds. The six input sentences are synthesized speech; the pauses in human speech vary more.

> **Addendum** (2026-11-19, #556): The default silence that ends an utterance was set to 0.4 seconds (padding 0.2 seconds). This is the 400 / 200 ms pair in the table above: finalization comes about 100 ms earlier, and utterances are more likely to be split in the middle of a sentence. The default applies only to settings in which no silence length has been chosen. A value that a user chose and saved is not changed. 0.5 seconds remains an option. The current behavior is described in [Data formats and storage](../spec/data-and-persistence.md#音声認識の数値設定).

## Final comparison

The code before the change (the commit that only added the harness) and the code after it were measured with the same harness, twice each, alternating between them (n=36 each). The load average at the start of the measurements was 0.2 to 0.7, and no other heavy work was running.

| Stage | Before p50 | Before p95 | After p50 | After p95 |
|---|---:|---:|---:|---:|
| End of speech → final recognition result | 770 ms | 850 ms | 704 ms | 752 ms |
| Translation | 109 ms | 272 ms | 109 ms | 270 ms |
| End of speech → chatbox send | 886 ms | 1,085 ms | 832 ms | 1,007 ms |
| Chatbox send → voice becomes audible | 418 ms | 708 ms | 128 ms | 289 ms |
| End of speech → voice becomes audible | 1,316 ms | 1,556 ms | 972 ms | 1,149 ms |
| Utterances split in two | 12/36 | | 12/36 | |
| Mean CER | 0.022 | | 0.022 | |

Between the two sets of runs, every stage differed by 10 ms or less at p50 (the p50 from the end of speech to the voice was 1,316 ms and 1,311 ms before the change, and 972 ms and 967 ms after it).

## Examined but not changed

- Translation (p50 105 to 110 ms; p95 about 300 to 570 ms in runs with a high load): the beam width (5 for M2M100) is the value that produces the same translations as CTranslate2. A smaller value is faster but changes the translations, so it was not changed. The ONNX Runtime in the Linux release package is the CPU build, so translation does not run on the GPU.
- Recognition model: with Haas-ja v1.0 and ReazonSpeech v2 (both Q8_0) instead, the p50 to finalization on the code after the change was 690 ms and 719 ms, no different from Qwen3-ASR 0.6B (704 ms). Most of the time to finalization is spent waiting for the silence. The mean CER on the synthesized input was 0.072 for Haas-ja and 0.225 for ReazonSpeech (0.022 for Qwen3-ASR). In these two runs, another program started using the GPU partway through (GPU usage was 98% at the start of the second run), so the TTS times were not compared.
- Translating early from partial results: in 11 of 18 cases, the finalized sentence was the same as the partial result just before it (the 500 / 250 ms run). That partial result, however, arrived at the same time as the final result (0 ms apart), so there is no time to translate it in advance.
- The time from the final result to the start of message processing was 0 to 1 ms, and the parts of message processing other than translation (chatbox, log and so on) took 0 to 1 ms. The VR overlay was not drawn (SteamVR was not running).
- Time to open the TTS output on Linux (`PipeWireOutput::open`): 2.5 to 9.3 ms on a small dedicated PipeWire graph (20 runs, `native/audio-routing/examples/output_open.rs`). It was not measured on the desktop's real graph.
- Voice conversion (RVC): in the Rust version of the app, voice conversion runs only on Windows (on Linux, the managed route does not support it yet). So only the conversion in the worker was measured here, with `rvc-stream`.

### Voice conversion (RVC, #531)

`rvc-stream` (`native/rvc-runtime`, CUDA, cuDNN 9.24, 1 thread) converted 25.6 seconds of audio made by joining the six Irodori-TTS sentences. The model was the RVC model saisho (48 kHz, with an index, index rate 0.75). Other programs used 0% of the GPU, and the load average was 1.0 to 1.5. Each condition was run twice.

| Block / crossfade / context | Mean time per block | p95 | Max | Blocks that missed their deadline | Delay added by splitting into blocks |
|---|---:|---:|---:|---:|---:|
| 80 / 40 / 2000 ms (the app's GPU setting) | 12.2 to 12.5 ms | 12.4 to 12.5 ms | 13 to 69 ms | 0/320 | 130 ms |
| 80 / 40 / 1000 ms | 11.8 to 12.1 ms | 12.0 to 12.1 ms | 58 to 60 ms | 0/320 | 130 ms |
| 40 / 20 / 2000 ms | 11.5 to 11.6 ms | 11.5 ms | 55 to 72 ms | 1 to 3/641 | 70 ms |
| 40 / 20 / 1000 ms | 10.9 to 11.0 ms | 10.9 to 11.0 ms | 56 to 70 ms | 1 to 3/641 | 70 ms |
| 20 / 10 / 1000 ms | 9.8 to 9.9 ms | 9.9 ms | 64 to 68 ms | 1 to 2/1282 | 40 ms |

The time to process one block hardly goes down when the block gets shorter, because feature extraction (HuBERT) reads the whole window, including the context, every time. In 9 of the 10 runs in the table, some block took 55 to 72 ms. A block of 80 ms still meets its deadline, but blocks of 40 ms or less fall behind. On the app's route, the 100 ms buffer of the Windows WASAPI output and the queue of converted output (up to 80 ms × 4) come on top of this. From this measurement, a block of 40 ms is expected to cut the conversion delay by about 60 ms. But that would need a mechanism that absorbs the rare slow block and a check on a real Windows machine. The default was not changed.

> **Addendum** (2026-11-19, #531): The default RVC block length was set to 40 ms. It can be changed under "Advanced" from 20 to 200 ms in 20 ms steps (`RVC_BLOCK_MS`, [Data formats and storage](../spec/data-and-persistence.md#直接音声の設定声の変換)). On the GPU, a 40 ms block is converted in one pass, with a crossfade of 20 ms. No mechanism to absorb the rare slow block was added. Blocks that miss their deadline are dropped as before, and if that keeps happening, conversion stops with `vc_capture_overrun`. It has not been measured on a real Windows machine yet.

> **Addendum** (2026-11-20, #531): The results and breakdown of an end-to-end measurement of the Windows route are in [Investigating and designing lower voice changer latency](rvc-low-latency-2026-11-20.md). On a laptop (RTX 3060 Ti), processing a 40 ms block did not meet its deadline.

> **Addendum** (2026-11-20, #531): The default block length changed to "Automatic". At start, the worker measures the time for one block on the GPU and picks the shortest length that meets the deadline (40 ms or more). A length chosen under "Advanced" takes precedence over "Automatic" ([Data formats and storage](../spec/data-and-persistence.md#直接音声の設定声の変換)).

## Proposed targets

A study that compared conversations in many languages found that in every language the gap when one speaker hands over to the next is short, and each language's mean was within about 250 ms of the overall mean (Stivers et al., 2009, PNAS 106(26), doi:10.1073/pnas.0903616106). With translation in between, recognition first waits for the silence that marks the end of speech (default 0.5 seconds), so it cannot get within that gap. The values below are therefore proposed as values that do not badly disrupt the pace of a conversation. Whether to adopt them has not been decided.

- From the end of speech until the translated voice starts to be heard: p50 1.0 second or less, p95 1.5 seconds or less
- From the end of speech until the chatbox send: p50 0.9 seconds or less

The conditions are speech recognition and TTS on the GPU, translation run locally (on the CPU) and no load from VRChat. The values after the change meet this proposal on the measured PC. Running VRChat at the same time, and PCs with slower GPUs, have not been measured yet.

## Continuing to measure

- The flow screen (#448) shows the time of translation, chatbox, speech synthesis and TTS for each message. Now that the leading silence is skipped, "Speech synthesis" for TTS is the time until audible sound is written.
- The flow screen does not show the time from the end of speech until the final result, because with realtime captions the app does not know when the speech ended. This interval is measured with `pipeline_latency`.
- `--silence-ms` of `pipeline_latency` lets you measure with a different silence that ends an utterance.

---

# 音声パイプラインの遅延の計測と短縮（2026-11-18）（日本語版）

マイクで話してから、訳した声が聞こえ始めるまでの時間を段ごとに測り、長い段から縮めた記録です（#556）。値はどれも下の「計測したPC」で測ったもので、ほかの環境での保証ではありません。

## 結果の要約

話し終わりから訳した声が聞こえ始めるまでは、p50で1,316 msから972 msに縮みました（p95は1,556 msから1,149 ms）。認識の精度と、発話の区切り方は変えていません。

| 段 | 変更前（p50） | 変更後（p50） | 手当て |
|---|---:|---:|---|
| 話し終わり → 認識の確定 | 770 ms | 704 ms | 区切りの余白を無音の半分にした |
| 確定 → メッセージの処理の開始 | 0 ms | 0 ms | — |
| 翻訳 | 109 ms | 109 ms | 変えていない |
| チャットボックスの送出 → 声が聞こえ始める | 418 ms | 128 ms | 読み上げの冒頭の無音を飛ばした |

変更前に最も長かった段は認識の確定待ちで、全体の約6割を占めていました。次が読み上げの冒頭の無音で約3割、翻訳は1割弱です。

利用者が選べる設定も足しました。話し終わりとみなす無音を0.4秒にすると確定はさらに約100 ms、0.3秒では約200 ms早くなります。そのかわり、文の途中の間でも区切られやすくなります（[区切りの無音の長さ](#区切りの無音の長さ)）。区切りの無音の既定は2026-11-19に0.4秒に決まりました（同じ節の追記）。

## 計測したPC

- CPU: AMD Ryzen 9 9950X3D（16コア32スレッド）
- GPU: NVIDIA GeForce RTX 4080 SUPER 16 GB（ドライバー620.70.06、PCIe 4.0 x16）。CPU内蔵のRadeonは使っていません。
- メモリ: 64 GB
- ストレージ: KIOXIA EXCERIA PRO G2 2 TB（NVMe）。モデルとアプリはこの上にあります。
- OS: CachyOS（Linux 6.18.60-2-cachyos-lts）、PipeWire 1.6.11

計測中もほかの開発作業が動いていました。負荷平均は回によって0.2〜20で、GPUのメモリはほかのアプリが約6.8 GB使っていました。VRChatは起動していません。翻訳はCPUで動くので、負荷の高い回は翻訳のp95が大きくなりました。前後の比較は、変更前と変更後を交互に2回ずつ流した結果です（[最終の比較](#最終の比較)）。

## 計測の方法

`native/core/examples/pipeline_latency.rs`で測りました。中核を、アプリと同じようにこのプロセスの中で起動し、次の3つだけを差し替えます。PCの音声デバイスには触れません。

- マイク: WAVEファイルを10 msずつ実時間で渡します。発話の後には8秒の無音を置きます。
- 読み上げの出力: 最初に聞こえる大きさ（振幅64、約-54 dBFSを超える）のサンプルが書かれた時刻を記録し、デバイスと同じ速さで受け取ります（先読みは40 msまで）。
- チャットボックス: 127.0.0.2で待つUDPのソケットです。

| 項目 | 内容 |
|---|---|
| 認識 | Qwen3-ASR 0.6B Q8_0とSilero VAD v6.2 F32。同梱のspeech.cpp 0.11.0（Vulkan）をRTX 4080 SUPERで動かすリアルタイム字幕 |
| 翻訳 | ローカルの翻訳（m2m100_418M、ONNX、int8）をCPUで。ONNX Runtimeは0.5.1の配布物のもの |
| 読み上げ | Qwen3-TTS 12Hz 0.6B CustomVoice Q8_0、声は`ryan`。同梱のspeech.cppをVulkanで |
| 経路 | 日本語で話し、英語に訳して読み上げる（`mic_mode: translated`） |
| 入力 | Irodori-TTS v4.1で作った日本語の6文（2.7〜5.6秒、48 kHz）。最初の1文をウォームアップに使い、6文を3巡して1回の計測をn=18とします |

時刻はどれも単調時計（`vrct_tts::clock::monotonic_ns`）です。「話し終わり」は、最も大きい10 msの区間から30 dB以内に入る最後の10 msの区間が中核に届いた時刻です。フロー画面（#448）の`/run/io_trace`の値（翻訳、チャットボックス、音声合成）も一緒に記録しています。ハーネスは時間、件数、文字誤り率（CER）だけを出し、認識した文、訳文、音声は出しません。

```sh
ORT_DYLIB_PATH=<0.5.1の_internal/onnxruntime/libonnxruntime.so> \
cargo run --release --locked --manifest-path native/core/Cargo.toml --example pipeline_latency -- \
    --app-dir . --clips <clip0.wav〜clip6.wavとtexts.txtのフォルダ> \
    --asr-model <Qwen3-ASR-0.6B-Q8_0.gguf> --vad-model <silero-vad-309K-v6.2-F32.gguf> \
    --tts-model <Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf> --translation <m2m100_418M-onnx-int8のフォルダ> \
    --runs 3 --out results.jsonl
```

含まないもの: OSの録音と再生のバッファ、仮想マイク、VRChatの中、ネットワーク。実機では、録音補助（Linuxは`vrct-asr-capture`）が10 ms単位で渡し、リアルタイム字幕のセッションが20 msずつサーバーへ送るので、録音の側でさらに数十ms以内の遅れが加わります。この分は測っていません。

## 変更前の内訳

変更前のコード（ハーネスだけを足したコミット）で、[最終の比較](#最終の比較)と同じ条件で測った値です（n=36）。

| 段 | p50 | p95 |
|---|---:|---:|
| 話し終わり → 認識の確定 | 770 ms | 850 ms |
| 確定 → メッセージの処理の開始 | 0.0 ms | 0.5 ms |
| 翻訳 | 109 ms | 272 ms |
| 話し終わり → チャットボックスの送出 | 886 ms | 1,085 ms |
| チャットボックスの送出 → 声が聞こえ始める | 418 ms | 708 ms |
| うち音声合成を頼んでから最初の書き出しまで | 26 ms | 39 ms |
| うち最初の書き出しから聞こえ始めるまで | 386 ms | 396 ms |
| 話し終わり → 声が聞こえ始める | 1,316 ms | 1,556 ms |

36件のうち12件は、発話が2つに分かれました（6文のうち同じ2文が毎回分かれます）。CERの平均は0.022です。作業を始めたときの計測（n=18、負荷平均4.7）も、ほぼ同じ値でした（話し終わり → 声のp50 1,308 ms）。

## 読み上げの冒頭の無音

speech.cppの読み上げは、最初の音を数十ミリ秒で返します。しかし、その音はほぼ無音で始まっていました。そのまま再生すると、無音のあいだ聞き手は待たされます。読み上げのサーバーに直接頼んで測った値は次のとおりです（同じPC、Vulkan）。

| モデル | 最初のチャンクが届くまで | 振幅64を超える最初のサンプルの位置 | 全体を返し終わるまで |
|---|---|---|---|
| Qwen3-TTS 0.6B Q8_0（英語、`ryan`、6文×3） | 12〜21 ms | 421〜435 ms（どの文も） | 音声2.5〜11.7秒に対して0.27〜1.30秒 |
| Irodori-TTS v4.1 F16（日本語、`none`、6文×2） | 39〜50 ms | 0〜276 ms（中央値約19 ms） | 音声2.7〜5.6秒に対して78〜111 ms |

どちらも実時間より十分速く作るので、冒頭の無音を飛ばしても、そのあとの音が途切れることはありません。

手当て（`native/tts/src/onset.rs`）: speech.cppの読み上げで、最初に振幅64を超えるサンプルより前の部分を捨てます。ただし直前の20 msは残し、捨てるのは1秒までです。VOICEVOXなどのインストール型のエンジンは対象外です。前置きの無音を利用者が設定できる（COEIROINKの`prePhonemeLength`）ためです。マイクの読み上げの開始期限（5秒）は、最初に聞こえる音から数えるようになりました。

効果（作業中の計測、各n=18）: チャットボックスの送出から声が聞こえ始めるまでがp50で413 msから154 msに、p95で729 msから341 msに縮みました。音声合成を頼んでから聞こえ始めるまでは、p50で116〜138 msです（この記録の各回）。

## 認識の確定

リアルタイム字幕の発話の区切りは、speech.cppのサーバーのVAD（`server_vad`）が決めます。変更前は区切りの指定を送らず、サーバーの既定（無音500 ms、余白300 ms）で動いていました。

speech.cppは、余白（`prefix_padding_ms`）の2倍のあいだに次の発話が始まらないと分かってから発話を確定します（speech.cppのADR「A detection of audio given a piece at a time gives speech_detect()'s regions, each once it is certain」）。既定の組では余白の2倍の600 msが無音の500 msより長いので、確定に要る待ちは無音の500 msではなく600 msでした。その後に認識の時間が加わります。無音だけを300 msにしても確定の時間は変わらず（p50 759 ms）、文の途中で区切られる件数だけが増えました（下の表）。

手当て（`native/transcription/src/realtime/session.rs`の`turn_detection`）: 無音の長さと、その半分（300 msまで）の余白を送ります。余白が無音の半分以下なら、無音が続いた時点で発話を確定します。どこで区切るかは無音の長さだけで決まるので、既定の500 msでは区切り方は変わりません。

### 区切りの無音の長さ

利用者が「リアルタイム字幕」の設定で無音の長さを選べるようにしました（`REALTIME_ASR_SETTINGS.silence_duration_ms`、既定0.5秒、0.3・0.4・0.7・1秒）。各n=18です。

| 無音 / 余白 | 確定 p50 | 確定 p95 | 2つに分かれた発話 | CERの平均 |
|---|---:|---:|---:|---:|
| 500 / 300 ms（変更前） | 763 ms | 818 ms | 6/18 | 0.022 |
| 300 / 300 ms（無音だけ短く） | 759 ms | 862 ms | 9/18 | 0.049 |
| 500 / 250 ms（変更後の既定） | 704 ms | 834 ms | 6/18 | 0.022 |
| 400 / 200 ms | 599 ms | 673 ms | 9/18 | 0.049 |
| 300 / 150 ms | 507 ms | 575 ms | 9/18 | 0.049 |

読み上げの冒頭の無音を飛ばしたあとのコードで、話し終わり → 声のp50は、500 / 250 msで991 ms、400 / 200 msで872 ms、300 / 150 msで768 msでした。0.4秒と0.3秒では、読点のない同じ1文が3巡とも2つに分かれ、その文のCERが0から0.16に上がりました。分かれた文は、チャットボックスにも読み上げにも2つのメッセージとして出ます。そのため既定は0.5秒のままにしています。入力の6文は合成した音声で、人の話し方の間はもっとばらつきます。

> **追記**（2026-11-19、#556）：区切りの無音の既定は0.4秒（余白0.2秒）に決まりました。上の表の400 / 200 msの組で、確定は約100 ms早くなり、文の途中で区切られやすくなります。既定に従うのは無音の長さを選んでいない設定だけです。選んで保存した値は変えません。0.5秒は選択肢に残ります。いまの扱いは[データ形式と保存](../spec/data-and-persistence.md#音声認識の数値設定)にあります。

## 最終の比較

変更前のコード（ハーネスだけを足したコミット）と変更後のコードを、同じハーネスで交互に2回ずつ測りました（各n=36）。計測の開始時の負荷平均は0.2〜0.7で、ほかの重い作業はありませんでした。

| 段 | 変更前 p50 | 変更前 p95 | 変更後 p50 | 変更後 p95 |
|---|---:|---:|---:|---:|
| 話し終わり → 認識の確定 | 770 ms | 850 ms | 704 ms | 752 ms |
| 翻訳 | 109 ms | 272 ms | 109 ms | 270 ms |
| 話し終わり → チャットボックスの送出 | 886 ms | 1,085 ms | 832 ms | 1,007 ms |
| チャットボックスの送出 → 声が聞こえ始める | 418 ms | 708 ms | 128 ms | 289 ms |
| 話し終わり → 声が聞こえ始める | 1,316 ms | 1,556 ms | 972 ms | 1,149 ms |
| 2つに分かれた発話 | 12/36 | | 12/36 | |
| CERの平均 | 0.022 | | 0.022 | |

2回の組のあいだの差は、どの段もp50で10 ms以内でした（話し終わり → 声のp50は、変更前が1,316 msと1,311 ms、変更後が972 msと967 ms）。

## 調べたが変えなかったもの

- 翻訳（p50 105〜110 ms、負荷の高い回のp95は約300〜570 ms）: ビーム幅（M2M100は5）はCTranslate2と同じ訳を出すための値です。小さくすると速くなりますが訳が変わるため、変えていません。Linuxの配布物のONNX RuntimeはCPU版なので、GPUでは動きません。
- 認識モデル: Haas-ja v1.0とReazonSpeech v2（どちらもQ8_0）に替えても、変更後のコードで確定までのp50は690 msと719 msで、Qwen3-ASR 0.6B（704 ms）と変わりませんでした。確定までの時間の大半は無音を待つ時間だからです。合成した入力でのCERの平均は、Haas-jaが0.072、ReazonSpeechが0.225でした（Qwen3-ASRは0.022）。この2回は途中からほかのプログラムがGPUを使っていたので（2回目の開始時にGPUの使用率98%）、読み上げの時間は比べていません。
- 途中結果で先に訳しておく案: 確定した文が直前の途中結果と同じだったのは18件中11件でした（500 / 250 msの回）。しかし、その途中結果が届くのは確定と同時（差0 ms）だったので、先に訳しておく時間がありません。
- 確定 → メッセージの処理の開始は0〜1 ms、メッセージの処理のうち翻訳以外（チャットボックス、ログなど）は0〜1 msでした。VRのオーバーレイは描いていません（SteamVRが動いていないため）。
- Linuxの読み上げの出力を開く時間（`PipeWireOutput::open`）: 専用のPipeWireの小さなグラフで2.5〜9.3 ms（20回、`native/audio-routing/examples/output_open.rs`）でした。デスクトップの実際のグラフでは測っていません。
- 声の変換（RVC）: Rust版のアプリでは、声の変換はWindowsでだけ動きます（Linuxは管理された経路が未対応）。そのため、ここではworkerの変換だけを`rvc-stream`で測りました。

### 声の変換（RVC、#531）

`rvc-stream`（`native/rvc-runtime`、CUDA、cuDNN 9.24、スレッド1）で、Irodori-TTSの6文をつないだ25.6秒の音声を変換しました。モデルはRVCのsaisho（48 kHz、indexあり、index rate 0.75）です。GPUの使用率はほかのプログラムでは0%で、負荷平均は1.0〜1.5でした。各条件2回です。

| ブロック / クロスフェード / 文脈 | 1ブロックの処理 平均 | p95 | 最大 | 間に合わなかったブロック | 区切りで生じる遅れ |
|---|---:|---:|---:|---:|---:|
| 80 / 40 / 2000 ms（アプリのGPU用） | 12.2〜12.5 ms | 12.4〜12.5 ms | 13〜69 ms | 0/320 | 130 ms |
| 80 / 40 / 1000 ms | 11.8〜12.1 ms | 12.0〜12.1 ms | 58〜60 ms | 0/320 | 130 ms |
| 40 / 20 / 2000 ms | 11.5〜11.6 ms | 11.5 ms | 55〜72 ms | 1〜3/641 | 70 ms |
| 40 / 20 / 1000 ms | 10.9〜11.0 ms | 10.9〜11.0 ms | 56〜70 ms | 1〜3/641 | 70 ms |
| 20 / 10 / 1000 ms | 9.8〜9.9 ms | 9.9 ms | 64〜68 ms | 1〜2/1282 | 40 ms |

1ブロックの処理時間は、ブロックを短くしてもほとんど縮みません。特徴抽出（HuBERT）が毎回、文脈を含む窓の全体を読むためです。表の10回のうち9回で、55〜72 msかかったブロックがありました。80 msのブロックなら間に合いますが、40 ms以下では遅れます。アプリの経路では、このほかにWindowsのWASAPIの出力の100 msのバッファと、変換の出力の待ち行列（80 ms×4まで）が加わります。この計測からは、ブロックを40 msにすると変換の遅れを約60 ms縮められる見込みです。ただし、まれな遅いブロックを吸収する仕組みと、Windowsの実機での確認が要ります。既定は変えていません。

> **追記**（2026-11-19、#531）：RVCのブロック長の既定は40 msに決まりました。「高度な設定」で20〜200 msの20 ms刻みで変えられます（`RVC_BLOCK_MS`、[データ形式と保存](../spec/data-and-persistence.md#直接音声の設定声の変換)）。GPUでは40 msのブロックを1回で変換し、クロスフェードは20 msです。まれな遅いブロックを吸収する仕組みは入れていません。間に合わないブロックはこれまでどおり捨て、続くと`vc_capture_overrun`で止まります。Windowsの実機ではまだ測っていません。

> **追記**（2026-11-20、#531）：Windowsの経路を端から端まで測った結果と内訳は、[ボイスチェンジャーの低遅延化の調査と設計](rvc-low-latency-2026-11-20.md)にあります。ノートPC（RTX 3060 Ti）では、40 msのブロックの処理が間に合いませんでした。

> **追記**（2026-11-20、#531）：ブロック長の既定は「自動」に変わりました。開始するときにworkerがGPUで1ブロックの時間を測り、間に合ういちばん短い長さ（40 ms以上）を選びます。「高度な設定」で選んだ長さは、自動より優先します（[データ形式と保存](../spec/data-and-persistence.md#直接音声の設定声の変換)）。

## 目標値の案

多くの言語の会話を比べた調査では、どの言語でも話し手が替わるときの間は短く、言語ごとの平均の違いは全体の平均から約250 ms以内でした（Stivers et al., 2009, PNAS 106(26), doi:10.1073/pnas.0903616106）。翻訳を挟む場合は、話し終わりを決める無音（既定0.5秒）を待ってから認識するので、この間には届きません。そこで、会話のテンポを大きく崩さない値として、次を案として示します。採用するかは決めていません。

- 話し終わり → 訳した声が聞こえ始めるまで: p50 1.0秒以下、p95 1.5秒以下
- 話し終わり → チャットボックスの送出: p50 0.9秒以下

条件は、音声認識と読み上げをGPUで動かし、翻訳はローカル（CPU）で、VRChatの負荷がないときです。変更後の値は、計測したPCでこの案を満たしています。VRChatを同時に動かしたときと、GPUの遅いPCではまだ測っていません。

## 続けて測るには

- フロー画面（#448）は、メッセージごとに翻訳、チャットボックス、音声合成、読み上げの時間を出します。読み上げの「音声合成」は、冒頭の無音を飛ばした後は、聞こえる音を書き出すまでの時間です。
- フロー画面は、話し終わりから確定までの時間を出しません。リアルタイム字幕では、アプリが話し終わりの時刻を知らないためです。この区間は`pipeline_latency`で測ります。
- `pipeline_latency`の`--silence-ms`で、区切りの無音を変えて測れます。
