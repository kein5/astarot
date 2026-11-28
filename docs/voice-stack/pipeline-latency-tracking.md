# Continuous measurement of voice pipeline latency (Bencher)

[日本語版](#音声パイプラインの遅延の継続計測bencher日本語版)

CI sends the p50 and p95 of the voice pipeline latency to Bencher, which tracks them over time (#738). Pushes to develop build up the history and the thresholds; on a pull request, the result compared with that start point appears in a comment. The threshold is an alert from a statistical test (t-test) set on p50 only. p95 is recorded and viewed in the graph. An alert does not fail CI and does not block merging.

What CI measures is the time that the core adds by itself. The recognition, translation and speech synthesis engines are replaced with fakes that answer at once. These values therefore cannot be compared with the #556 target (from the end of speech until the translated voice starts to be heard, p50 0.7 seconds or less, p95 1.0 second or less). The values to compare with the target are the ones `pipeline_latency` measures with real models ([Real-model values](#real-model-values)).

## What CI measures

`native/core/tests/pipeline_overhead.rs` takes the measurements. It starts the core as the app does and turns on Linux realtime captions, translation with DeepL, sending to the chatbox and TTS of the translation. It keeps streaming audio from the microphone and has a fake recognition server finalize one utterance at a time. It finalizes the next utterance only after the previous one has reached both the chatbox and the voice output.

| Part | Replaced by |
|---|---|
| Realtime captions server | `tests/common/fake_asr.rs`. It finalizes one utterance when the test asks and records the time. Like the real speech.cpp, it sets `TCP_NODELAY` on the connection. |
| Translation | DeepL from `astarot_translation::fake`. It answers at once. |
| TTS server | speech.cpp from `tests/common/fake_tts.rs`. It returns audio with 0.42 seconds of leading silence. This length matches the leading silence of Qwen3-TTS in speech.cpp (421 to 435 ms in [the 2026-11-18 record](pipeline-latency-2026-11-18.md)). It sets `TCP_NODELAY` on the connection. |
| TTS output | An output inside the test. It records the time at which it first writes a sample above amplitude 64, and accepts audio at the same rate as a device (read-ahead up to 40 ms). |
| Chatbox | A UDP socket listening on 127.0.0.2. |

The first 3 utterances are a warm-up and are not counted; the 40 utterances after them are counted. The two values are these:

| Benchmark | Interval |
|---|---|
| `core: final to chatbox` | From just before the recognition server sends the final result for an utterance until the chatbox message arrives |
| `core: final to audible speech` | From the same point until the TTS of the translation is first written at an audible level |

This interval includes the core's threads and queues, the requests to the servers on 127.0.0.1 and the step that skips the leading silence of the TTS audio. For example, removing the silence skip makes the p50 of `core: final to audible speech` grow from about 25 ms to about 405 ms (2026-11-20, a value checked on Linux).

In CI, `core-integration` in `voice-tests.yml` runs this test. The job runs on Windows and Linux, with a separate testbed for each OS (`ubuntu-latest`, `windows-latest`). The test runs as a debug build, so the values also differ from release build times. A failed measurement does not make `core-integration` fail.

To run it locally, use the command below. The values are also printed to standard error.

```sh
ASTAROT_PIPELINE_BMF=pipeline-latency.json cargo test --locked --manifest-path native/core/Cargo.toml \
    --test pipeline_overhead -- --ignored --nocapture
```

## Value format

The result is JSON in Bencher Metric Format (BMF). Each benchmark has these two measures:

| measure | Meaning | Unit |
|---|---|---|
| `latency-p50` | 50th percentile (nearest rank) | milliseconds |
| `latency-p95` | 95th percentile (nearest rank) | milliseconds |

The percentiles are computed the same way as in the `pipeline_latency` summary. The code that writes them is in `native/core/tests/bmf/mod.rs`, which the CI test and `pipeline_latency` share.

```json
{
  "core: final to chatbox": {
    "latency-p50": { "value": 22.7 },
    "latency-p95": { "value": 24.6 }
  }
}
```

## Sending to Bencher

The workflow `pipeline-latency.yml` sends the values. It runs after `voice-tests.yml` finishes, receives the results that `core-integration` left for each OS and sends them with the Bencher CLI (`bencherdev/bencher`) through `bencher run --adapter json`.

This workflow runs on `workflow_run`, so the version on develop always runs, not the version in the pull request. Changing this file in a pull request therefore does not change the steps that hold the Bencher key. A change takes effect once it is merged into develop. The workflow does not check out the repository's code; it receives only the JSON with the measurement results. It reads the pull request number, branch and commit from the values GitHub recorded for that run. The repository's security test (`tests/voice/test_security_regressions.py`) checks this workflow's permissions and the steps that receive the key.

| Trigger | How it sends |
|---|---|
| Push to develop | Sends to the branch `develop`. Resets the thresholds to this configuration every time (`--thresholds-reset`). The history is kept separately for each value of `BENCHER_START_POINT_IDEMPOTENCY_KEY` in the workflow (see below). |
| Pull request from a branch in the same repository | Sends to the pull request's branch. The start point is the target branch and its commit, and the start point's thresholds are copied. The results and alerts appear in a comment on the pull request. |
| Pull request from a fork, push to any other branch, merge queue | Does not send. |

Thresholds are set on `latency-p50` only. `latency-p95` has no threshold; its values are sent, recorded and viewed in the graph (decided on 2026-11-21, decision 5 of #738). p95 is the second-highest value of the 40 utterances, so a single hiccup on the runner makes it jump. Of the 22 alerts from 2026-11-20 to 21, while it still had a threshold, 21 were on p95, and every one was a one-off. If the core really gets slower, p50 rises too, so the p50 alert catches it. The sends from develop use `--thresholds-reset`, so the p95 threshold, which is no longer specified, disappears on the next send. The p50 threshold is set as follows:

- Test: t-test (`t_test`)
- History compared: up to the latest 64 results. No alert until 10 results have accumulated (`--threshold-min-sample-size 10`), because with few results the boundary is narrow and the runner's noise alone raises alerts.
- Upper boundary: 0.99. No alert on the lower side (when the values get faster).

When what is measured changes and the values shift by a step, the develop history is restarted from empty. Change `BENCHER_START_POINT_IDEMPOTENCY_KEY` for the develop send in `pipeline-latency.yml` to a new value: the first send with that value empties the history (`--start-point-reset`), and from the second send with the same value on, results are added to it. On 2026-11-21, the fake servers of the test got `TCP_NODELAY` (#738, #556) and the Linux values dropped by about 20 ms, so the history was restarted with `develop-2026-11-21-fake-servers-tcp-nodelay`.

An alert does not make `bencher run` fail (`--error-on-alert` is not set). The send step has `continue-on-error`, so the workflow does not fail when Bencher cannot be reached either. Because the send uses `--github-actions`, however, Bencher creates a check called "Bencher Report", and that check fails when there is an alert. This check is not one of the required checks in the develop ruleset, so it does not block merging.

### Setup by the maintainer

While the repository has no Bencher key and project, `pipeline-latency.yml` sends nothing and gives the reason in an annotation. Sending needs the following setup.

1. Create a public project on Bencher Cloud. Public projects can use the free plan. The free plan allows up to 65,535 metrics a day, and one CI send is 8 metrics (2 benchmarks × 2 measures × 2 OSes). Do not set up billing.
2. Create a project API key (a project key that starts with `bencher_run_`) and register it as the repository secret `BENCHER_API_KEY`.
3. Register the project slug as the repository variable `BENCHER_PROJECT`.
4. Run the workflow `bencher-measures.yml` by hand on develop (`gh workflow run bencher-measures.yml --ref develop`). It creates the measures `latency-p50` and `latency-p95` if they do not exist, and sets the unit of both to milliseconds (`milliseconds (ms)`). This step exists because the Bencher Console has no screen for creating measures, and a measure that Bencher creates by itself when values arrive first has no unit. Running it again gives the same result.

Steps 1 to 3 were done on 2026-11-21, with the project `astarot`.

## Real-model values

The values to compare with the #556 target are measured with real models in `native/core/examples/pipeline_latency.rs`. The procedure and the intervals it measures are in [the 2026-11-18 record](pipeline-latency-2026-11-18.md). That record is kept as it was written, so the crate name (`vrct_tts`, now `astarot_tts`) and the Linux recording helper (`vrct-asr-capture`; the core now records through PipeWire) are old names. With `--bmf <file>`, it writes the p50 and p95 of the summary in the same format.

| Benchmark | Interval |
|---|---|
| `pipeline: end of speech to audible speech` | From the end of speech until the translated voice starts to be heard (the interval of the #556 target) |
| `pipeline: end of speech to chatbox` | From the end of speech until the chatbox send |
| `pipeline: end of speech to final` | From the end of speech until the final recognition result |
| `pipeline: translation` | Translation |

### Judging the #556 target

On 2026-11-20, the definition of the values to compare with the target was decided as follows (#556).

- The interval is `pipeline: end of speech to audible speech` (from the end of speech until the translated voice starts to be heard), and the target is p50 0.7 seconds or less and p95 1.0 second or less.
- Utterances split into two or more parts are not counted. In a split utterance, the voice for the later part waits for the TTS of the earlier part to finish, which adds time that is not voice latency. The `pipeline_latency` summary and the `--bmf` values are computed only from utterances that were not split, and the summary gives the number of split ones as `split_utterances`.
- Recording and playback buffers (the Linux recording helper, PipeWire, Windows WASAPI) are not included. `pipeline_latency` measures without going through them. Values on a real setup go in a separate record.
- The target is judged on values from a quiet PC with VRChat not running. Quiet means a load average of 1 or less on Linux and, on Windows, which has no load average, CPU usage (the average over all logical processors) of 10% or less (the Windows guide value was decided on 2026-11-21, #738). Values with VRChat running are measured against a separate target.
- The summary records the state of the PC when the measurement starts and when it ends: `load_average` on Linux (the load averages over 1, 5 and 15 minutes) and `cpu_usage` on Windows (usage over 5 seconds, in %). Each is `null` on an OS where it cannot be read. The end value is read after the last utterance and the silence after it have been played. When a value is above the guide value, a message on standard error says so. How the values are read and judged is in `native/core/tests/machine_load.rs`.

This measurement does not run in CI. It needs the recognition, translation and TTS models (about 2.5 GB together), the speech.cpp executable, ONNX Runtime and the Japanese speech material, and GitHub's runners have no GPU. So the measurements are taken by hand on the maintainer's PCs, and the written file is sent to Bencher in the same form as CI. This arrangement was decided on 2026-11-21 (#738).

### PCs and testbeds

The measurements use the maintainer's three PCs. Testbed names follow the form `<OS>-<CPU>-<GPU>`. Translation runs on the CPU, so the name includes the CPU as well as the GPU. The Bencher project is public, so host names are left out.

| PC | Testbed | GPU for recognition and TTS |
|---|---|---|
| CachyOS (Linux 6.18), Ryzen 9 9950X3D, RTX 4080 SUPER 16 GB | `cachyos-9950x3d-rtx4080super` | `Vulkan0` (RTX 4080 SUPER) |
| Windows 11, a Core i7-1255U laptop with an RTX 3060 Ti connected over Thunderbolt | `win11-i7-1255u-rtx3060ti` | Check with `speech devices --json` (`Vulkan1` in the 2026-11-18 record) |
| A PC with an RTX 3060 12 GB | Not decided (decide after installing ASTAROT and add it to this table) | Not decided |

The names differ from the CI testbeds (`ubuntu-latest`, `windows-latest`), so the values do not mix.

### Where the values go in Bencher and when to measure

- Send to the dedicated branch `real-models`. When the CI send from develop restarts the history (`--start-point-reset`), it empties the history of the develop branch. If the hand measurements went to the `develop` branch, their series would be cut along with it. Link the measured commit with `--hash`.
- No thresholds are set, so there are no alerts. Once a testbed has 10 results, review whether to set them.
- Measure when a #556 change goes into develop, before a release, and otherwise once every 2 weeks. When measuring on more than one PC, measure the same commit.
- One measurement uses `--runs 10`. The six inputs are played in 10 rounds, and the utterances that were not split in two are counted. In the end-to-end check on 2026-11-21, 4 to 5 of the 6 were counted, which gives 40 to 50 per measurement. p95 uses the nearest rank, so with 20 or more counted, the single slowest one does not decide it. A measurement takes 15 to 20 minutes.

### Inputs and models

Every PC uses the same inputs and the same models, checked with SHA-256 after they are copied.

- The inputs are seven Japanese WAVE files (`clip0.wav` to `clip6.wav`; synthesized speech made with Irodori-TTS v4.1, 48 kHz, 16 bit) and `texts.txt`, which holds the correct sentences. The first one is a warm-up and is not counted. They are not in the repository; the maintainer copies them to each PC. `pipeline_latency` outputs only times, counts and the character error rate, not the text or the audio.
- Get the models from the app's model download screen, after checking their license and size. They are saved in `downloaded_models/<ID>/<revision>/` in the settings folder. Compare their SHA-256 with the values in the app's catalog (`native/ops/data/speechcpp_models.json`, `native/ops/src/downloads/catalog.rs`, `native/ops/data/translation_models.json`).

  | Use | Name in the app | File |
  |---|---|---|
  | Recognition | Qwen3-ASR 0.6B (Q8_0) | `Qwen3-ASR-0.6B-Q8_0.gguf` |
  | Voice activity detection | Silero VAD v6.2 · F32 | `silero-vad-309K-v6.2-F32.gguf` |
  | TTS | Qwen3-TTS 12Hz 0.6B CustomVoice · Q8_0 (voice `ryan`) | `Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf` |
  | Translation | M2M100 418M · int8 (`m2m100-418m-onnx-int8`) | A folder (6 files) |

- Fetch speech.cpp and ONNX Runtime into `build/` with the repository's tools, at the versions that the measured commit pins. Do not use the ones inside the installed app, because the versions pinned by the app and by the measured commit can differ.
- [The 2026-11-18 record](pipeline-latency-2026-11-18.md) (p50 972 ms, p95 1,149 ms) was measured with a translation model exported locally. That model's encoder and decoder hashes differ from those of the published `m2m100-418m-onnx-int8`. The hand-measured series uses the published version, so its values cannot be compared directly with the values in that record.

The SHA-256 values of the inputs are:

```
311b8c48cc5a1879e17483e8e528105c4a48a274c288d3bdda79dbed6e026f81  clip0.wav
0c854d1dfa74d4683bb1707d6a6ab501016782aaee68ccc097a39fd1e0852cbf  clip1.wav
8e73a92dbe19b63e7655b69ba3658ff07f15f56ffbc7c1f6bc5dc7da1063b01d  clip2.wav
1edb5214b04a7491b43c1c548e081618e2cb6cf80271ee5fb5952ef7fd487aae  clip3.wav
bd7e8d909097e43e53ac0f5f3e87dcf33fcd6ada82f077a21e0e66b5e7ab9912  clip4.wav
34822f755f988456461ffa722664daffdd8229307eac7a50c2cd166846899821  clip5.wav
e64d770924f2fad354e114032977abd3ef0204e20f276d2e52ff8e80986c300e  clip6.wav
dc39540143ace64b680bdaa0331b7706c487f5226bffcf41396dc71ff88331eb  texts.txt
```

### The key for sending

The maintainer enters the key for sending to Bencher on each PC. The CI key (the repository secret `BENCHER_API_KEY`) cannot be read back from GitHub, so it is not used for hand measurements.

- Create one key per PC in the Bencher Console, as an API key of the project `astarot` (a project key that starts with `bencher_run_`). Name the key after the testbed. When a PC is no longer used, revoke only that PC's key.
- Keep the key outside the PC, for example in a password manager. Enter it into the terminal only when sending, and clear it right after.
- Do not put it in a command argument (`--key`), because it would stay in the shell history and the process list. Do not write it in files, shell configuration, issues or chats either.

### One-time setup on each PC

1. Check out develop and install the tools with `mise install`. On Windows, Rust's MSVC toolchain also needs the Visual Studio C++ build tools.
2. Gather the inputs and models above and check their SHA-256 (`sha256sum` on Linux, `Get-FileHash` on Windows).
3. Get the Bencher CLI at the same version as CI (`bencherdev/bencher` in `pipeline-latency.yml`, now v0.6.16) from [the official releases](https://github.com/bencherdev/bencher/releases), compare it with the `.sha256` value in the release, and put it in a directory on the PATH under the name `bencher`. The file is `bencher-v<version>-linux-x86-64` on Linux and `bencher-v<version>-windows-x86-64.exe` on Windows.
4. The maintainer creates the key for the PC as described in "The key for sending" above.

### Each measurement

1. Update the checkout to the latest develop, fetch speech.cpp and ONNX Runtime again and build `pipeline_latency` (commands below).
2. Stop VRChat, SteamVR and any other heavy work. On Linux, wait until the load average (1 minute) is 1 or less. On Windows, start after checking in Task Manager or a similar tool that the CPU usage has settled.
3. Measure with `--runs 10`.
4. In the summary on standard error, check the number counted (`n`), the number of split utterances (`split_utterances`) and the state of the PC (`load_average` on Linux, `cpu_usage` on Windows). A run above the guide value prints a warning to standard error; do not send it, and measure again.
5. Check what will be sent (branch, commit, testbed and the 8 values) with `bencher run --dry-run`. A dry run needs no key and saves nothing to Bencher.
6. The maintainer enters the key, sends and clears the key right away.

On Linux (bash):

```sh
# Fetch the speech.cpp (Vulkan build) and ONNX Runtime pinned by the measured commit into build/, and build pipeline_latency
python tools/speechcpp_bundle.py --variant linux-x64-vulkan --download --output build/speechcpp --replace
python tools/runtime_libraries.py --platform linux --download --output build
cargo build --release --locked --manifest-path native/core/Cargo.toml --example pipeline_latency
build/speechcpp/speech devices --json   # Check the name of the GPU to use

T=cachyos-9950x3d-rtx4080super
C=$(git rev-parse --short=9 HEAD)
ORT_DYLIB_PATH="$PWD/build/onnxruntime/libonnxruntime.so" \
native/core/target/release/examples/pipeline_latency \
  --app-dir . --clips <input folder> \
  --asr-model <Qwen3-ASR-0.6B-Q8_0.gguf> --vad-model <silero-vad-309K-v6.2-F32.gguf> \
  --tts-model <Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf> --translation <m2m100-418m-onnx-int8 folder> \
  --device Vulkan0 --runs 10 --label "$T-$C" --out "results-$T-$C.jsonl" --bmf "pipeline-$T-$C.json"

# Check what will be sent (no key needed; nothing is saved)
bencher run --project astarot --branch real-models --hash "$(git rev-parse HEAD)" --testbed "$T" \
  --adapter json --file "pipeline-$T-$C.json" --dry-run

# The maintainer sends. Enter the key without showing it, and clear it after sending
read -rs -p 'Bencher key: ' BENCHER_API_KEY; echo; export BENCHER_API_KEY
bencher run --project astarot --branch real-models --hash "$(git rev-parse HEAD)" --testbed "$T" \
  --adapter json --file "pipeline-$T-$C.json"
unset BENCHER_API_KEY
```

On Windows (PowerShell):

```powershell
# Fetch the speech.cpp (Vulkan build) and ONNX Runtime pinned by the measured commit into build, and build pipeline_latency
python tools/speechcpp_bundle.py --variant windows-x64-vulkan --download --output build/speechcpp --replace
python tools/runtime_libraries.py --platform windows --download --output build
cargo build --release --locked --manifest-path native/core/Cargo.toml --example pipeline_latency
build\speechcpp\speech.exe devices --json   # Check the name of the RTX 3060 Ti (Vulkan0, Vulkan1 and so on)

$T = 'win11-i7-1255u-rtx3060ti'
$C = git rev-parse --short=9 HEAD
$env:ORT_DYLIB_PATH = "$PWD\build\onnxruntime\onnxruntime.dll"
native\core\target\release\examples\pipeline_latency.exe `
  --app-dir . --clips <input folder> `
  --asr-model <Qwen3-ASR-0.6B-Q8_0.gguf> --vad-model <silero-vad-309K-v6.2-F32.gguf> `
  --tts-model <Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf> --translation <m2m100-418m-onnx-int8 folder> `
  --device <name checked above> --runs 10 --label "$T-$C" --out "results-$T-$C.jsonl" --bmf "pipeline-$T-$C.json"

# Check what will be sent (no key needed; nothing is saved)
bencher run --project astarot --branch real-models --hash (git rev-parse HEAD) --testbed $T `
  --adapter json --file "pipeline-$T-$C.json" --dry-run

# The maintainer sends. Enter the key without showing it, and clear it after sending
$env:BENCHER_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'Bencher key' -AsSecureString)).Password
bencher run --project astarot --branch real-models --hash (git rev-parse HEAD) --testbed $T `
  --adapter json --file "pipeline-$T-$C.json"
Remove-Item Env:BENCHER_API_KEY
```

---

# 音声パイプラインの遅延の継続計測（Bencher）（日本語版）

音声パイプラインの遅延のp50とp95を、CIでBencherへ送って時系列で追います（#738）。developへのpushで履歴としきい値を積み、プルリクエストではその基点と比べた結果をコメントに出します。しきい値は、p50だけに付けた統計的な検定（t検定）によるアラートです。p95は記録してグラフで見ます。アラートでCIは失敗せず、マージも止めません。

CIで測るのは、中核が自分で足す時間です。認識、翻訳、音声合成のエンジンを、すぐに答える偽物に替えて測ります。そのため、#556の目標（話し終わりから訳した声が聞こえ始めるまで、p50で0.7秒以下、p95で1.0秒以下）と比べられる値ではありません。目標と比べる値は、実モデルで測る`pipeline_latency`の値です（[実モデルの値](#実モデルの値)）。

## CIで測るもの

`native/core/tests/pipeline_overhead.rs`が測ります。中核をアプリと同じように起動し、Linuxのリアルタイム字幕、DeepLでの翻訳、チャットボックスの送出、訳文の読み上げを有効にします。マイクから音声を流し続け、偽の認識サーバーに1回ずつ発話を確定させます。前の発話がチャットボックスと声の両方に届いてから、次の発話を確定させます。

| 部分 | 代わりに使うもの |
|---|---|
| リアルタイム字幕のサーバー | `tests/common/fake_asr.rs`。試験が頼んだときに1つの発話を確定させ、その時刻を記録します。本物のspeech.cppと同じく、接続に`TCP_NODELAY`を付けます。 |
| 翻訳 | `astarot_translation::fake`のDeepL。すぐに答えます。 |
| 読み上げのサーバー | `tests/common/fake_tts.rs`のspeech.cpp。冒頭に0.42秒の無音を付けて返します。speech.cppのQwen3-TTSの冒頭の無音（[2026-11-18の記録](pipeline-latency-2026-11-18.md)で421〜435 ms）に合わせた長さです。接続には`TCP_NODELAY`を付けます。 |
| 読み上げの出力 | 試験の中の出力。振幅64を超えるサンプルを最初に書いた時刻を記録し、デバイスと同じ速さで受け取ります（先読みは40 msまで）。 |
| チャットボックス | 127.0.0.2で待つUDPのソケットです。 |

最初の3つの発話は慣らしとして数えず、続く40の発話を数えます。値は次の2つです。

| ベンチマーク | 区間 |
|---|---|
| `core: final to chatbox` | 認識サーバーが発話の確定を送る直前から、チャットボックスのメッセージが届くまで |
| `core: final to audible speech` | 同じ時点から、訳文の読み上げが最初に聞こえる大きさで書かれるまで |

この区間には、中核のスレッドと待ち行列、127.0.0.1でのサーバーへの要求、読み上げの冒頭の無音を飛ばす処理が入ります。たとえば無音を飛ばす処理を外すと、`core: final to audible speech`のp50は約25 msから約405 msに延びます（2026-11-20、Linuxで確かめた値）。

CIでは`voice-tests.yml`の`core-integration`がこの試験を流します。ジョブはWindowsとLinuxで動き、testbedはOSごとに分けます（`ubuntu-latest`、`windows-latest`）。試験はデバッグビルドで動くので、値はリリースビルドの時間とも違います。計測が失敗しても`core-integration`は失敗しません。

手元では次のように流します。値は標準エラーにも出ます。

```sh
ASTAROT_PIPELINE_BMF=pipeline-latency.json cargo test --locked --manifest-path native/core/Cargo.toml \
    --test pipeline_overhead -- --ignored --nocapture
```

## 値の形式

結果はBencher Metric Format（BMF）のJSONです。ベンチマークごとに、次の2つのmeasureを持ちます。

| measure | 内容 | 単位 |
|---|---|---|
| `latency-p50` | 50パーセンタイル（最近接順位） | ミリ秒 |
| `latency-p95` | 95パーセンタイル（最近接順位） | ミリ秒 |

パーセンタイルの求め方は`pipeline_latency`の要約と同じです。書き出しの処理は`native/core/tests/bmf/mod.rs`にあり、CIの試験と`pipeline_latency`が共有します。

```json
{
  "core: final to chatbox": {
    "latency-p50": { "value": 22.7 },
    "latency-p95": { "value": 24.6 }
  }
}
```

## Bencherへの送り方

ワークフロー`pipeline-latency.yml`が送ります。`voice-tests.yml`が終わると動き、`core-integration`が残した結果をOSごとに受け取って、Bencher CLI（`bencherdev/bencher`）の`bencher run --adapter json`で送ります。

このワークフローは`workflow_run`で動くので、プルリクエストの版ではなく、常にdevelopにある版が動きます。そのため、プルリクエストでこのファイルを変えても、Bencherの鍵を持つ処理は変わりません。変更はdevelopにマージしてから効きます。リポジトリのコードはチェックアウトせず、計測の結果のJSONだけを受け取ります。プルリクエストの番号、ブランチ、コミットは、GitHubがその実行について記録した値から読みます。リポジトリの安全の試験（`tests/voice/test_security_regressions.py`）が、このワークフローの権限と、鍵を受け取る手順を確かめます。

| きっかけ | 送り方 |
|---|---|
| developへのpush | ブランチ`develop`に送ります。しきい値を毎回この設定に合わせます（`--thresholds-reset`）。履歴は、ワークフローの`BENCHER_START_POINT_IDEMPOTENCY_KEY`の値ごとに分かれます（下記）。 |
| 同じリポジトリのブランチからのプルリクエスト | プルリクエストのブランチに送ります。基点はマージ先のブランチとそのコミットで、基点のしきい値を写します。結果とアラートはプルリクエストのコメントに出ます。 |
| フォークからのプルリクエスト、ほかのブランチへのpush、マージキュー | 送りません。 |

しきい値は `latency-p50` だけに付けます。`latency-p95` にはしきい値を付けず、値を送って記録し、グラフで見ます（2026-11-21に決定、#738の判断5）。p95は40の発話の上から2番目の値なので、ランナーの1回の引っかかりで跳ねます。しきい値を付けていた2026-11-20から21日にかけてのアラート22件のうち21件がp95で、どれも単発でした。中核が本当に遅くなればp50も上がるので、p50のアラートで気づけます。developの送信は `--thresholds-reset` を付けているので、指定しなくなったp95のしきい値は次の送信で消えます。p50のしきい値は次の設定です。

- 検定: t検定（`t_test`）
- 比べる履歴: 直近の64件まで。10件たまるまではアラートを出しません（`--threshold-min-sample-size 10`）。件数が少ないうちは境界が狭く、ランナーのぶれだけでアラートが出るためです。
- 上側の境界: 0.99。下側（速くなったとき）はアラートを出しません。

測るものが変わって値が一段変わったときは、developの履歴を空からやり直します。`pipeline-latency.yml`のdevelopの送信の`BENCHER_START_POINT_IDEMPOTENCY_KEY`を新しい値に替えると、その値で最初に送ったときに履歴が空になり（`--start-point-reset`）、同じ値の2回目からは続きに積まれます。2026-11-21に、試験の偽のサーバーに`TCP_NODELAY`を付けて（#738、#556）、Linuxの値が約20 ms下がったので、`develop-2026-11-21-fake-servers-tcp-nodelay`でやり直しました。

アラートが出ても、`bencher run`は失敗しません（`--error-on-alert`を付けていません）。送る手順は`continue-on-error`なので、Bencherに届かないときもワークフローは失敗しません。ただし`--github-actions`を付けて送ると、Bencherが「Bencher Report」というチェックを作り、アラートがあるとそのチェックが失敗になります。このチェックはdevelopのルールセットの必須のチェックに入っていないので、マージは止まりません。

### 保守担当者がする準備

リポジトリにBencherの鍵とプロジェクトがないあいだは、`pipeline-latency.yml`は何も送らず、送らなかった理由を注記に出します。送るには、次の準備が要ります。

1. Bencher Cloudで公開のプロジェクトを作ります。公開のプロジェクトは無料のプランで使えます。無料のプランの上限は1日65,535メトリクスで、CIの1回の送信は8メトリクス（ベンチマーク2つ×measure 2つ×OS 2つ）です。課金の設定はしません。
2. プロジェクトのAPIキー（`bencher_run_`で始まるプロジェクトのキー）を作り、リポジトリのシークレット`BENCHER_API_KEY`に登録します。
3. プロジェクトのスラッグを、リポジトリの変数`BENCHER_PROJECT`に登録します。
4. ワークフロー`bencher-measures.yml`をdevelopで手動で実行します（`gh workflow run bencher-measures.yml --ref develop`）。measureの`latency-p50`と`latency-p95`がなければ作り、どちらも単位をミリ秒（`milliseconds (ms)`）にします。BencherのConsoleにはmeasureを作る画面がなく、先に値が送られてBencherが自動で作ったmeasureには単位がないためです。何度実行しても同じ結果になります。

2026-11-21に、プロジェクト`astarot`で1〜3を済ませました。

## 実モデルの値

#556の目標と比べる値は、`native/core/examples/pipeline_latency.rs`で実モデルを使って測ります。手順と測る区間は[2026-11-18の記録](pipeline-latency-2026-11-18.md)にあります。その記録は当時のままなので、クレートの名前（`vrct_tts`。今は`astarot_tts`）と、Linuxの録音の補助（`vrct-asr-capture`。今は中核がPipeWireで録音します）は古い名前です。`--bmf <ファイル>`を付けると、要約のp50とp95を同じ形式で書き出します。

| ベンチマーク | 区間 |
|---|---|
| `pipeline: end of speech to audible speech` | 話し終わりから、訳した声が聞こえ始めるまで（#556の目標の区間） |
| `pipeline: end of speech to chatbox` | 話し終わりから、チャットボックスの送出まで |
| `pipeline: end of speech to final` | 話し終わりから、認識の確定まで |
| `pipeline: translation` | 翻訳 |

### #556の目標の判定

2026-11-20に、目標と比べる値の定義を次のとおり決めました（#556）。

- 区間は`pipeline: end of speech to audible speech`（話し終わりから訳した声が聞こえ始めるまで）で、p50 0.7秒以下、p95 1.0秒以下を目標にします。
- 途中で2つ以上に分かれた発話は数えません。分かれた発話では、後半の声が前半の読み上げの終わりを待つので、声の遅れとは別の時間が入るためです。`pipeline_latency`の要約と`--bmf`の値は分かれなかった発話だけから求め、分かれた件数を要約の`split_utterances`に出します。
- 録音と再生のバッファ（Linuxの録音補助、PipeWire、WindowsのWASAPI）は含めません。`pipeline_latency`はこれらを通さずに測ります。実機での値は別の記録にします。
- PCが静かで、VRChatを動かしていないときの値で判定します。静かとは、Linuxでは負荷平均が1以下、負荷平均のないWindowsではCPUの使用率（すべての論理プロセッサーの平均）が10%以下のことです（Windowsの目安は2026-11-21に決定、#738）。VRChatを動かしたときの値は、別の目標として測ります。
- 要約には、計測を始めたときと終えたときのPCの様子を記録します。Linuxは`load_average`（1分、5分、15分の負荷平均）、Windowsは`cpu_usage`（5秒間の使用率、%）で、どちらも読めないOSでは`null`です。終えたときの値は、最後の発話とそのあとの無音を流し終えてから読みます。目安を超えたときは、標準エラーにその旨を出します。読み方と判定は`native/core/tests/machine_load.rs`にあります。

この計測はCIでは動きません。認識、翻訳、読み上げのモデル（合わせて約2.5 GB）、speech.cppの実行ファイル、ONNX Runtime、日本語の音声の素材が要ります。また、GitHubのランナーにはGPUがありません。そのため、保守担当者のPCで手で測り、書き出したファイルをCIと同じ形でBencherへ送ります。段取りは2026-11-21に決めました（#738）。

### 測るPCとテストベッド

保守担当者の3台で測ります。テストベッドの名前は`<OS>-<CPU>-<GPU>`の形にそろえます。翻訳はCPUで動くので、GPUだけでなくCPUも名前に入れます。Bencherのプロジェクトは公開なので、ホスト名は入れません。

| PC | テストベッド | 認識と読み上げのGPU |
|---|---|---|
| CachyOS（Linux 6.18）、Ryzen 9 9950X3D、RTX 4080 SUPER 16 GB | `cachyos-9950x3d-rtx4080super` | `Vulkan0`（RTX 4080 SUPER） |
| Windows 11、Core i7-1255UのノートPC、ThunderboltでつないだRTX 3060 Ti | `win11-i7-1255u-rtx3060ti` | `speech devices --json`で確かめる（2026-11-18の記録では`Vulkan1`） |
| RTX 3060 12 GBのPC | 未定（ASTAROTを入れたあとに決めて、この表に足す） | 未定 |

CIのテストベッド（`ubuntu-latest`、`windows-latest`）とは名前が違うので、値は混ざりません。

### Bencherでの置き場所と測る時期

- 専用の枝`real-models`に送ります。developのCIの送信は、履歴をやり直すとき（`--start-point-reset`）にdevelopの枝の履歴を空にします。手測りを`develop`の枝に送ると、手測りの系列も一緒に切れるためです。測ったコミットは`--hash`で結び付けます。
- しきい値は付けないので、アラートは出ません。テストベッドごとに10回分たまったら、付けるかどうかを見直します。
- 測るのは、#556の変更がdevelopに入ったとき、版を出す前、それ以外は2週間に1回です。複数のPCで測るときは、同じコミットで測ります。
- 1回の計測は`--runs 10`です。6つの入力を10巡し、2つに分かれなかった発話を数えます。2026-11-21の通し確認では6つのうち4〜5つを数えたので、1回に40〜50件になります。p95は最近接順位なので、数えた件数が20件以上あれば、最も遅い1件だけで決まりません。所要時間は15〜20分です。

### 入力とモデル

どのPCでも同じ入力と同じモデルを使い、写したあとにSHA-256で確かめます。

- 入力は、日本語の7つのWAVE（`clip0.wav`〜`clip6.wav`。Irodori-TTS v4.1で作った合成音声、48 kHz、16 bit）と、正解の文の`texts.txt`です。最初の1つは慣らしで、数えません。リポジトリには入れず、保守担当者が各PCに写します。`pipeline_latency`が出すのは時間、件数、文字誤り率だけで、文と音声は出しません。
- モデルは、アプリのモデルの取得の画面から、ライセンスと容量を確かめて取得します。保存先は設定のフォルダーの`downloaded_models/<ID>/<revision>/`です。SHA-256は、アプリのカタログ（`native/ops/data/speechcpp_models.json`、`native/ops/src/downloads/catalog.rs`、`native/ops/data/translation_models.json`）の値と比べます。

  | 用途 | アプリでの名前 | ファイル |
  |---|---|---|
  | 認識 | Qwen3-ASR 0.6B（Q8_0） | `Qwen3-ASR-0.6B-Q8_0.gguf` |
  | 発話の検出 | Silero VAD v6.2 · F32 | `silero-vad-309K-v6.2-F32.gguf` |
  | 読み上げ | Qwen3-TTS 12Hz 0.6B CustomVoice · Q8_0（声は`ryan`） | `Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf` |
  | 翻訳 | M2M100 418M · int8（`m2m100-418m-onnx-int8`） | フォルダー（6つのファイル） |

- speech.cppとONNX Runtimeは、測るコミットが固定する版を、リポジトリの道具で`build/`に取ります。インストールしたアプリの中のものは使いません。アプリと測るコミットで、固定の版がずれることがあるためです。
- [2026-11-18の記録](pipeline-latency-2026-11-18.md)（p50 972 ms、p95 1,149 ms）は、自分で書き出した翻訳のモデルで測りました。このモデルは、公開した`m2m100-418m-onnx-int8`とエンコーダーとデコーダーのハッシュが違います。手測りの系列は公開した版で測るので、その記録の値とはそのままでは比べられません。

入力のSHA-256は次のとおりです。

```
311b8c48cc5a1879e17483e8e528105c4a48a274c288d3bdda79dbed6e026f81  clip0.wav
0c854d1dfa74d4683bb1707d6a6ab501016782aaee68ccc097a39fd1e0852cbf  clip1.wav
8e73a92dbe19b63e7655b69ba3658ff07f15f56ffbc7c1f6bc5dc7da1063b01d  clip2.wav
1edb5214b04a7491b43c1c548e081618e2cb6cf80271ee5fb5952ef7fd487aae  clip3.wav
bd7e8d909097e43e53ac0f5f3e87dcf33fcd6ada82f077a21e0e66b5e7ab9912  clip4.wav
34822f755f988456461ffa722664daffdd8229307eac7a50c2cd166846899821  clip5.wav
e64d770924f2fad354e114032977abd3ef0204e20f276d2e52ff8e80986c300e  clip6.wav
dc39540143ace64b680bdaa0331b7706c487f5226bffcf41396dc71ff88331eb  texts.txt
```

### 送る鍵

Bencherに送る鍵は、保守担当者が各PCで自分で入れます。CIの鍵（リポジトリのシークレット`BENCHER_API_KEY`）はGitHubから読み出せないので、手測りには使いません。

- 鍵は、BencherのConsoleで、プロジェクト`astarot`のAPIキー（`bencher_run_`で始まるプロジェクトのキー）としてPCごとに1つ作ります。キーの名前はテストベッドの名前にします。PCを使わなくなったら、そのPCのキーだけを失効させます。
- キーはパスワードの管理の道具など、PCの外に保管します。送るときだけその端末に入れ、送ったらすぐ消します。
- コマンドの引数（`--key`）には書きません。シェルの履歴とプロセスの一覧に残るためです。ファイル、シェルの設定、Issue、チャットにも書きません。

### 各PCで1回だけする準備

1. developをcheckoutし、`mise install`で道具をそろえる。Windowsでは、RustのMSVCのためにVisual StudioのC++のビルドツールも要る。
2. 上の入力とモデルをそろえ、SHA-256を確かめる（Linuxは`sha256sum`、Windowsは`Get-FileHash`）。
3. BencherのCLIをCIと同じ版（`pipeline-latency.yml`の`bencherdev/bencher`、いまはv0.6.16）で[公式のリリース](https://github.com/bencherdev/bencher/releases)から取り、リリースにある`.sha256`の値と比べてから、`bencher`の名前でPATHの通った場所に置く。Linuxは`bencher-v<版>-linux-x86-64`、Windowsは`bencher-v<版>-windows-x86-64.exe`です。
4. 保守担当者が、上の「送る鍵」のとおりにPCのキーを作る。

### 毎回の計測

1. checkoutを最新のdevelopにし、speech.cppとONNX Runtimeを取り直して、`pipeline_latency`をビルドする（下のコマンド）。
2. VRChat、SteamVR、ほかの重い処理を止める。Linuxでは、負荷平均（1分）が1以下になるまで待つ。Windowsでは、タスクマネージャーなどでCPUの使用率が落ち着いたことを見てから始める。
3. `--runs 10`で測る。
4. 標準エラーに出る要約で、数えた件数（`n`）、分かれた発話の数（`split_utterances`）、PCの様子（Linuxは`load_average`、Windowsは`cpu_usage`）を確かめる。目安を超えた回は標準エラーに注意が出るので、送らずに測り直す。
5. `bencher run --dry-run`で、送る中身（枝、コミット、テストベッド、8つの値）を確かめる。dry runは鍵が要らず、Bencherに何も保存しない。
6. 保守担当者が鍵を入れて送り、すぐ消す。

Linux（bash）では次のとおりです。

```sh
# 測るコミットが固定するspeech.cpp（Vulkan版）とONNX Runtimeをbuild/に取り、pipeline_latencyをビルドする
python tools/speechcpp_bundle.py --variant linux-x64-vulkan --download --output build/speechcpp --replace
python tools/runtime_libraries.py --platform linux --download --output build
cargo build --release --locked --manifest-path native/core/Cargo.toml --example pipeline_latency
build/speechcpp/speech devices --json   # 使うGPUの名前を確かめる

T=cachyos-9950x3d-rtx4080super
C=$(git rev-parse --short=9 HEAD)
ORT_DYLIB_PATH="$PWD/build/onnxruntime/libonnxruntime.so" \
native/core/target/release/examples/pipeline_latency \
  --app-dir . --clips <入力のフォルダー> \
  --asr-model <Qwen3-ASR-0.6B-Q8_0.gguf> --vad-model <silero-vad-309K-v6.2-F32.gguf> \
  --tts-model <Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf> --translation <m2m100-418m-onnx-int8のフォルダー> \
  --device Vulkan0 --runs 10 --label "$T-$C" --out "results-$T-$C.jsonl" --bmf "pipeline-$T-$C.json"

# 送る中身を確かめる（鍵は要らない。何も保存しない）
bencher run --project astarot --branch real-models --hash "$(git rev-parse HEAD)" --testbed "$T" \
  --adapter json --file "pipeline-$T-$C.json" --dry-run

# 保守担当者が送る。鍵は画面に出さずに入れ、送ったら消す
read -rs -p 'Bencher key: ' BENCHER_API_KEY; echo; export BENCHER_API_KEY
bencher run --project astarot --branch real-models --hash "$(git rev-parse HEAD)" --testbed "$T" \
  --adapter json --file "pipeline-$T-$C.json"
unset BENCHER_API_KEY
```

Windows（PowerShell）では次のとおりです。

```powershell
# 測るコミットが固定するspeech.cpp（Vulkan版）とONNX Runtimeをbuildに取り、pipeline_latencyをビルドする
python tools/speechcpp_bundle.py --variant windows-x64-vulkan --download --output build/speechcpp --replace
python tools/runtime_libraries.py --platform windows --download --output build
cargo build --release --locked --manifest-path native/core/Cargo.toml --example pipeline_latency
build\speechcpp\speech.exe devices --json   # RTX 3060 Tiの名前（Vulkan0、Vulkan1など）を確かめる

$T = 'win11-i7-1255u-rtx3060ti'
$C = git rev-parse --short=9 HEAD
$env:ORT_DYLIB_PATH = "$PWD\build\onnxruntime\onnxruntime.dll"
native\core\target\release\examples\pipeline_latency.exe `
  --app-dir . --clips <入力のフォルダー> `
  --asr-model <Qwen3-ASR-0.6B-Q8_0.gguf> --vad-model <silero-vad-309K-v6.2-F32.gguf> `
  --tts-model <Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf> --translation <m2m100-418m-onnx-int8のフォルダー> `
  --device <上で確かめた名前> --runs 10 --label "$T-$C" --out "results-$T-$C.jsonl" --bmf "pipeline-$T-$C.json"

# 送る中身を確かめる（鍵は要らない。何も保存しない）
bencher run --project astarot --branch real-models --hash (git rev-parse HEAD) --testbed $T `
  --adapter json --file "pipeline-$T-$C.json" --dry-run

# 保守担当者が送る。鍵は画面に出さずに入れ、送ったら消す
$env:BENCHER_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'Bencher key' -AsSecureString)).Password
bencher run --project astarot --branch real-models --hash (git rev-parse HEAD) --testbed $T `
  --adapter json --file "pipeline-$T-$C.json"
Remove-Item Env:BENCHER_API_KEY
```
