# Comparison of execution providers for RVC inference (2026-11-20)

[日本語版](#rvc-の推論の実行方式の比較2026-11-20日本語版)

This is a record of measuring the three RVC graphs (HuBERT, RMVPE and the synthesizer) with each ONNX Runtime execution provider. These results led to adding DirectML to the RVC worker (PR #788, "Application worker" in [`native/rvc-runtime/README.md`](../../native/rvc-runtime/README.md)). The steps for the decisions that wait for measurements on a desktop PC are also collected here.

All values were measured on the one PC below. They do not guarantee the speed on other PCs.

## Main points

- In graph-only time, DirectML was the fastest and had the smallest spread. With 80 ms blocks, p50 was 35.9 ms and p95 was 41.2 ms, and no block went over 80 ms.
- With every GPU provider, convolutions, matrix multiplications and the GRU stayed off the CPU. Only small int64 operations that compute shapes were placed on the CPU, and they took less than 0.6% of the graphs' wall time.
- Through the worker as well, DirectML was about 10 ms per packet faster than CUDA, and its p95 and maximum were also smaller when packets were sent at the send interval.
- On this PC, neither CUDA nor DirectML can keep up with the default 40 ms block. At 80 ms, both keep up.
- DirectML on the integrated GPU (Intel Iris Xe) takes about 240 ms for one 40 ms block and does not reach real time.
- With CUDA on the desktop PC (Linux, RTX 4080 SUPER), the p95 round trip for a 40 ms block was about 19 ms, well within the time ("Measurement results on the desktop PC").

## Measurement environment

- PC: Intel Core i7-1255U (2 performance cores, 8 efficiency cores, 12 threads), 32 GB of memory, on AC power, power plan Balanced
- OS: Windows 11 Home Insider Preview 26H2 (build 26320.9877)
- GPU: NVIDIA GeForce RTX 3060 Ti 8 GB (Thunderbolt external enclosure, PCIe x4), integrated Intel Iris Xe
- Drivers: NVIDIA 617.42 (supports CUDA 13.4), Intel 32.0.101.7085
- ONNX Runtime: 1.31.0 for CPU, CUDA and WebGPU. CUDA uses CUDA runtime 13.4.92, cuBLAS 13.8.0.4 and cuDNN 9.26.1.1 (the same versions as the RVC runtime). DirectML is 1.24.4 (DirectML.dll 1.15.4). WebGPU uses the plugin `onnxruntime-ep-webgpu` 0.6.0
- Model: Saisho Utane from the catalog (RVC v2, 48 kHz, with pitch). The SHA-256 of `model.pth`, HuBERT and `rmvpe.onnx` matched the pinned values

## Graph-only comparison

### Method

- The synthesizer and HuBERT graphs are the same ones the worker builds when it loads (`synth::build_graph`, `HubertCheckpoint::build_graph`). They were written out to ONNX files and run with ONNX Runtime for Python. RMVPE is the same `rmvpe.onnx` the worker uses.
- The inputs are random tensors in the shape the worker passes to the GPU for an 80 ms packet (block 8, crossfade 4, search 1, context 200 frames). No real audio or text was used. Every provider read the same files.
- One block is the time to run the three graphs once each, one after another. After 30 warm-up blocks, 3 processes × 300 blocks were collected for each provider (3 × 200 for the CPU). The order of the processes changed in each round.
- The thread counts match the worker: 6 for the CPU and 1 for the GPU providers. As in the worker, Windows power throttling was turned off.
- Each GPU provider was confirmed to run on the RTX 3060 Ti from the loaded driver DLLs and the GPU usage.

### Results (80 ms blocks)

| Provider | ONNX Runtime | p50 | p95 | Over 80 ms |
|---|---|---|---|---|
| CPU (6 threads) | 1.31.0 | 899.5 ms | 1364.6 ms | 600 / 600 |
| CUDA | 1.31.0 | 49.7 ms | 70.7 ms | 3 / 900 |
| DirectML | 1.24.4 | 35.9 ms | 41.2 ms | 0 / 900 |
| WebGPU (Vulkan) | 1.31.0 and EP 0.6.0 | 69.0 ms | 86.2 ms | 95 / 900 |
| WebGPU (Direct3D 12, for reference) | 1.31.0 and EP 0.6.0 | 84.2 ms | 93.1 ms | 749 / 900 |

The p50 and p95 of each graph are as follows (ms).

| Provider | HuBERT | RMVPE | Synthesizer |
|---|---|---|---|
| CPU | 412.9 / 616.6 | 85.1 / 261.6 | 366.1 / 674.3 |
| CUDA | 12.3 / 16.6 | 15.3 / 26.6 | 20.5 / 31.0 |
| DirectML | 12.9 / 14.7 | 7.9 / 9.1 | 15.0 / 17.6 |
| WebGPU (Vulkan) | 20.9 / 23.0 | 21.0 / 33.1 | 23.3 / 35.7 |
| WebGPU (Direct3D 12) | 21.9 / 22.7 | 32.1 / 34.1 | 29.8 / 38.3 |

- On the CPU, the p50 of each round varied widely, from 799 to 1110 ms.
- The WebGPU plugin 0.6.0 does not start on Vulkan as distributed. Dawn tries to load `vulkan-1.dll` by a relative name and fails with Windows error 87. The measurement was made with the system's Vulkan loader placed next to the plugin.

### Operations that fell back to the CPU

The ONNX Runtime profiler collected 50 runs of each graph after 10 warm-up runs.

| Provider | HuBERT | RMVPE | Synthesizer | Share of the graph's wall time (RMVPE / synthesizer) |
|---|---|---|---|---|
| CUDA | 0 | 6 | 10 | 0.38% / 0.44% |
| DirectML | 0 | 6 | 10 | 0.42% / 0.35% |
| WebGPU (Vulkan) | 0 | 8 | 10 | 0.57% / 0.54% |
| WebGPU (Direct3D 12) | 0 | 8 | 10 | 0.29% / 0.29% |

- In RMVPE, the operations placed on the CPU were `/Slice`, `/Concat`, `Gather`, `/fc/fc.0/gru/Gather`, `/fc/fc.0/gru/Unsqueeze` and `/fc/fc.0/gru/Concat`. With WebGPU, `/fc/fc.0/gru/ConstantOfShape` and `Gather_token_702` were also placed on the CPU. They compute the GRU batch size and the output shape from the input shape.
- In the synthesizer, the operations placed on the CPU were `Slice_29`, `Concat_783`, `Concat_801`, `Concat_808`, `Concat_825`, `Concat_832`, `Add_796`, `Add_798`, `Add_806` and `Add_830`. They are int64 computations on 1 to 8 elements that build the shape passed to Reshape from the input shape.
- With the setting that forbids falling back to the CPU (`session.disable_cpu_ep_fallback`), HuBERT loaded with every GPU provider. RMVPE and the synthesizer do not load.

### Output differences

The relative error (L2) against the CPU output was 7 × 10⁻⁵ or less with DirectML and WebGPU, and 1.0 to 2.3 × 10⁻³ with CUDA. The CUDA difference comes from TF32, which ONNX Runtime turns on by default. With `use_tf32=0` the error went down to 5 × 10⁻⁶, but one HuBERT run took 11.4 seconds and used up the GPU memory (8 GB).

### 40 ms blocks

The shape of the app's default 40 ms packet (block 4, crossfade 2, search 1, context 200 frames) was measured too, with 2 processes × 300 blocks.

| Provider | p50 | p95 | Over 40 ms |
|---|---|---|---|
| CUDA | 47.1 ms | 65.2 ms | 600 / 600 |
| DirectML (RTX 3060 Ti) | 33.7 ms | 38.2 ms | 18 / 600 |
| DirectML (Iris Xe) | 240.9 ms | 273.4 ms | 600 / 600 |

## Measurement through the worker

The worker from PR #788 was run over the VVC1 pipe, as the app runs it (the same method as `tools/rvc_worker_bench.py`). The audio was synthesized sound. "Per-packet processing time" is the time when the next packet is sent after the previous answer arrives, and shows how long the worker spends on one block. "Round trip at the send interval" is the round trip when a packet is sent every block length, as the microphone sends them. A range gives the spread of the values over 2 or 3 runs.

| Provider | Block | Per-packet processing time p50 / p95 | Round trip at the send interval p50 / p95 / max | Over the block length (round trip) |
|---|---|---|---|---|
| CUDA | 40 ms | 49.1–50.2 / 61.6–65.4 ms | 271–281 ms (delay builds up) | All |
| DirectML | 40 ms | 40.0–41.2 / 51.3–52.1 ms | 205–242 ms (delay builds up) | All |
| CUDA | 80 ms | 53.8–54.1 / 66.4–66.8 ms | 55.3–56.5 / 68.8–76.9 / 79.2–86.8 ms | 5 / 870 |
| DirectML | 80 ms | 44.0–46.1 / 53.7–55.2 ms | 57.1–60.0 / 64.8–67.7 / 69.8–74.6 ms | 0 / 870 |

- `auto` chose CUDA when both the CUDA runtime and the DirectML runtime were present, DirectML when only the DirectML runtime was present, and the CPU when neither was. DirectML chose the RTX 3060 Ti, whose `Discrete` is `1` in ONNX Runtime's device detection.
- At 40 ms, one packet takes longer than the block length, so sending at the send interval makes the delay build up. The app drops blocks older than 240 ms and stops when half or more of the recent blocks are late.

## Decisions

### Round 1 (2026-11-20, in response to this measurement)

1. Add DirectML to the RVC worker. Deal with two points during the implementation: the DirectML build of ONNX Runtime has stopped at 1.24.4, and the ranking on a desktop PC is not confirmed (PR #788).
2. Keep CUDA's TF32 at its default.
3. Stop considering WebGPU.
4. Do not offer CPU conversion on PCs with a CPU of this class. Before the worker starts converting on the CPU, it converts a 0.5-second block of test audio and measures the time. If the conversion does not finish within the block length, it does not start and reports `vc_cpu_too_slow` ("CPU speed check" in `native/rvc-runtime/README.md`). On this PC's CPU, one block took 1.07 seconds, and conversion did not start.
5. Do not add CUDA Graph for now.

### Round 2 (2026-11-20, on the points in PR #788 that needed a decision)

1. Do not change the default 40 ms block for now. On a strong PC, 40 ms gives less delay, so decide together with the measurement on a desktop PC.
2. Keep the `auto` order at CUDA, DirectML, CPU for now. Decide after measuring on a desktop PC.
3. Take DirectML on an integrated GPU out of `auto`. Iris Xe does not reach real time; this is the same reasoning as 4. When the worker starts converting under `auto`, it converts on the CPU if the GPU that DirectML uses (the first in DXGI's high-performance order) has `Discrete` set to `0`. `--device directml` and the check when downloading the runtime also use the integrated GPU.
4. Accept the limits of the DirectML build of ONNX Runtime 1.24.4 for now. DirectML is in maintenance only, and 1.24.4 is its last version. The worker's `ort` (2.0.0-rc.15) requires API 22 on Windows and runs on 1.24.4. Decide what to do when `ort` starts to require ONNX Runtime newer than 1.24.
5. Keep the comparison tables of the measurements as this measurement record.

### Round 3 (2026-11-20, on the PC to measure on and item 4 of round 1)

1. The measurements for items 1 and 2 of round 2 are made on a Linux desktop PC with an RTX 4080 SUPER. It has CUDA only, so it can measure item 1 of round 2 (the default 40 ms block). Proceed on the assumption that item 2 of round 2 (the `auto` order) cannot be measured on this PC.
2. Implement item 4 of round 1 (PR #791).

## Measurement on a desktop PC (plan)

Items 1 and 2 of the round 2 decisions wait for measurements on a desktop PC. The steps are as follows.

### PCs to measure

| PC | Providers to measure | What it tells |
|---|---|---|
| Windows desktop, NVIDIA GPU | CUDA and DirectML, 40 ms and 80 ms | The `auto` order (decision 2), and whether 40 ms is enough (decision 1) |
| Windows desktop, AMD or Intel discrete GPU | DirectML, 40 ms and 80 ms | Whether DirectML reaches real time on GPUs other than NVIDIA's |
| Linux desktop, NVIDIA GPU | CUDA, 40 ms and 80 ms | Whether 40 ms is enough (decision 1). DirectML is Windows only. Measured on the RTX 4080 SUPER PC ("Measurement results on the desktop PC" below) |

### What to prepare

- The app with PR #788 (the bundled `astarot-rvc-worker`)
- The RVC runtime (download it from the RVC page; on an NVIDIA PC it is the CUDA build)
- On Windows, "ONNX Runtime · DirectML" (download it from "Models and runtime" on the RVC page)
- The Saisho Utane model from the catalog (`model.pth`)

### Steps

```sh
python tools/rvc_worker_bench.py --worker <app>/_internal/build/astarot-rvc-worker.exe \
    --runtime <state>/vc_runtimes/rvc --directml <state>/vc_runtimes/onnxruntime-directml/lib \
    --model <model.pth> --devices cuda,directml --block-ms 40,80 --packets 300 --rounds 3 --json result.json
```

- `<state>` is the folder that holds the settings (`config.json`). On Linux, leave out `--directml` and use `--devices cuda`.
- Each run uses one worker, which takes about 5 seconds to get ready. The options above make 24 runs (3 rounds × 2 blocks × 2 providers × 2 methods), which take about 10 minutes.
- While measuring, close other apps that use the GPU (VRChat, SteamVR, games).
- Keep the output table and `result.json` together with the CPU, GPU, driver and OS versions.

### Guide for the decisions (proposal)

- Decision 1: If the p95 of the round trip at the send interval at 40 ms is below 40 ms, 40 ms is enough on that PC. If it is not enough on a desktop either, propose returning the default to 80 ms or setting a separate default for each provider.
- Decision 2: If, on an NVIDIA desktop too, DirectML's per-packet processing time and round-trip p95 are at or below CUDA's, propose putting DirectML first in `auto`. If CUDA is faster, keep the current order.

## Measurement results on the desktop PC (2026-11-20, Linux, RTX 4080 SUPER, CUDA)

Following the steps above, CUDA was measured at 40 ms and 80 ms with `tools/rvc_worker_bench.py` (3 rounds × 300 packets, 870 packets counted for each condition). The model was Saisho Utane from the catalog, and the audio was synthesized sound.

### Desktop PC environment

- OS: Linux (CachyOS). 32 logical CPUs.
- GPU: NVIDIA GeForce RTX 4080 SUPER (CUDA)
- During the measurement, other work was using about 8 cores' worth of CPU (load average 8.5 to 9.9). It was not measured again without that load.
- The CPU model and the versions of the GPU driver and ONNX Runtime are not in the results that were received.

### Results

#### Round trip at the send interval (ms)

| Block | p50 | p95 | Max | Over the block length | Over 240 ms |
|---|---|---|---|---|---|
| 40 ms | 16.6–17.0 | 18.1–20.1 | 23.7–24.2 | 0 / 870 | 0 / 870 |
| 80 ms | 21.7–24.6 | 45.1–46.6 | 51.7–52.0 | 0 / 870 | 0 / 870 |

#### Per-packet processing time (ms)

| Block | p50 | p95 | Max | Over the block length |
|---|---|---|---|---|
| 40 ms | 11.2–14.4 | 14.4–15.5 | 15.7–22.6 | 0 / 870 |
| 80 ms | 11.8–14.3 | 12.0–15.6 | 15.1–23.7 | 0 / 870 |

- All 12 runs returned `ready`, and every packet was converted. It took 2.2 to 3.2 seconds to reach `ready`.
- The p95 of the round trip at 40 ms was 18.1 to 20.1 ms, which meets the guide for decision 1 (below 40 ms).
- The p50 of the per-packet processing time at 40 ms was 11.2 to 14.4 ms, against 49.1 to 50.2 ms with CUDA on the laptop (RTX 3060 Ti over Thunderbolt).
- The p95 of the round trip at 80 ms (about 46 ms) was larger than at 40 ms (about 19 ms). The log from the measurement shows the GPU clock dropping to P3 to P5 at 80 ms. Our guess is that a longer send interval let the GPU clock drop and made the round trip longer. This was not isolated by locking the clock.
- Decision 2 (the `auto` order) is not settled by this result, because DirectML cannot be measured on this PC.

## What was not measured

- Conversion through the app, and checking by ear.
- AMD GPUs, and a Windows desktop PC.
- CUDA Graph, WebGPU graph capture, fp16.

---

# RVC の推論の実行方式の比較（2026-11-20）（日本語版）

RVC の3つのグラフ（HuBERT、RMVPE、合成器）を、ONNX Runtime の実行方式ごとに測った記録です。この結果から、RVC の worker に DirectML を足しました（PR #788、[`native/rvc-runtime/README.md`](../../native/rvc-runtime/README.md) の「Application worker」）。デスクトップ PC での計測を待っている判断の段取りも、ここにまとめます。

値はすべて下の1台で測ったものです。ほかの PC での速さを保証するものではありません。

## 要点

- グラフだけの時間では、DirectML が最も速く、ばらつきも最も小さい結果でした。80 ms のブロックで p50 は 35.9 ms、p95 は 41.2 ms で、80 ms を超えたブロックはありませんでした。
- どの GPU の方式でも、畳み込み、行列積、GRU は CPU に落ちていません。CPU に置かれたのは形を計算する int64 の小さな演算だけで、グラフの実時間の 0.6 % 未満でした。
- worker を通しても、DirectML は CUDA より1パケットあたり約 10 ms 速く、送る間隔どおりに送ったときの p95 と最大も小さくなりました。
- この PC では、既定の 40 ms のブロックを CUDA も DirectML も処理しきれません。80 ms ならどちらも追いつきます。
- 内蔵の GPU（Intel Iris Xe）の DirectML は、40 ms のブロック1つに約 240 ms かかり、実時間に届きません。
- デスクトップ PC（Linux、RTX 4080 SUPER）の CUDA では、40 ms のブロックの往復の p95 が約 19 ms で、十分に間に合いました（「デスクトップ PC での計測の結果」）。

## 計測した環境

- PC: Intel Core i7-1255U（性能コア2、効率コア8、12スレッド）、メモリ 32 GB、AC 電源、電源プランはバランス
- OS: Windows 11 Home Insider Preview 26H2（ビルド 26320.9877）
- GPU: NVIDIA GeForce RTX 3060 Ti 8 GB（Thunderbolt の外付けケース、PCIe x4）、内蔵の Intel Iris Xe
- ドライバー: NVIDIA 617.42（CUDA 13.4 に対応）、Intel 32.0.101.7085
- ONNX Runtime: CPU、CUDA、WebGPU は 1.31.0。CUDA は CUDA runtime 13.4.92、cuBLAS 13.8.0.4、cuDNN 9.26.1.1（RVC の実行環境と同じ版）。DirectML は 1.24.4（DirectML.dll 1.15.4）。WebGPU はプラグイン `onnxruntime-ep-webgpu` 0.6.0
- モデル: カタログの Saisho Utane（RVC v2、48 kHz、ピッチあり）。`model.pth`、HuBERT、`rmvpe.onnx` の SHA-256 は固定の値と一致しました

## グラフだけの比較

### 測り方

- 合成器と HuBERT のグラフは、worker が読み込み時に組み立てるものと同じです（`synth::build_graph`、`HubertCheckpoint::build_graph`）。ONNX ファイルに書き出して、Python の ONNX Runtime で動かしました。RMVPE は worker と同じ `rmvpe.onnx` です。
- 入力は、worker が 80 ms のパケットで GPU に渡す形（ブロック 8、クロスフェード 4、探索 1、文脈 200 フレーム）の乱数のテンソルです。実際の音声やテキストは使っていません。全方式で同じファイルを読みました。
- 1ブロックは、3つのグラフを続けて1回ずつ動かした時間です。慣らしの 30 ブロックのあと、方式ごとに 3 プロセス × 300 ブロック（CPU は 3 × 200）を集めました。プロセスの順は巡ごとに入れ替えました。
- スレッド数は worker と同じで、CPU が6、GPU の方式が1です。worker と同じく、Windows の省電力の抑制を切りました。
- どの GPU の方式も RTX 3060 Ti で動いたことを、読み込まれたドライバーの DLL と GPU の使用率で確かめました。

### 結果（80 ms のブロック）

| 方式 | ONNX Runtime | p50 | p95 | 80 ms 超え |
|---|---|---|---|---|
| CPU（6スレッド） | 1.31.0 | 899.5 ms | 1364.6 ms | 600 / 600 |
| CUDA | 1.31.0 | 49.7 ms | 70.7 ms | 3 / 900 |
| DirectML | 1.24.4 | 35.9 ms | 41.2 ms | 0 / 900 |
| WebGPU（Vulkan） | 1.31.0 と EP 0.6.0 | 69.0 ms | 86.2 ms | 95 / 900 |
| WebGPU（Direct3D 12、参考） | 1.31.0 と EP 0.6.0 | 84.2 ms | 93.1 ms | 749 / 900 |

グラフごとの p50 と p95 は次のとおりです（ms）。

| 方式 | HuBERT | RMVPE | 合成器 |
|---|---|---|---|
| CPU | 412.9 / 616.6 | 85.1 / 261.6 | 366.1 / 674.3 |
| CUDA | 12.3 / 16.6 | 15.3 / 26.6 | 20.5 / 31.0 |
| DirectML | 12.9 / 14.7 | 7.9 / 9.1 | 15.0 / 17.6 |
| WebGPU（Vulkan） | 20.9 / 23.0 | 21.0 / 33.1 | 23.3 / 35.7 |
| WebGPU（Direct3D 12） | 21.9 / 22.7 | 32.1 / 34.1 | 29.8 / 38.3 |

- CPU は巡ごとの p50 が 799〜1110 ms と大きくぶれました。
- WebGPU のプラグイン 0.6.0 は、配布されたままでは Vulkan で起動しません。Dawn が `vulkan-1.dll` を相対名で読もうとして、Windows のエラー 87 で失敗します。システムの Vulkan ローダーをプラグインの隣に置いて測りました。

### CPU に落ちた演算

ONNX Runtime のプロファイラで、グラフごとに慣らしの 10 回のあとの 50 回を集計しました。

| 方式 | HuBERT | RMVPE | 合成器 | グラフの実時間に対する割合（RMVPE / 合成器） |
|---|---|---|---|---|
| CUDA | 0 個 | 6 個 | 10 個 | 0.38 % / 0.44 % |
| DirectML | 0 個 | 6 個 | 10 個 | 0.42 % / 0.35 % |
| WebGPU（Vulkan） | 0 個 | 8 個 | 10 個 | 0.57 % / 0.54 % |
| WebGPU（Direct3D 12） | 0 個 | 8 個 | 10 個 | 0.29 % / 0.29 % |

- RMVPE で CPU に置かれたのは `/Slice`、`/Concat`、`Gather`、`/fc/fc.0/gru/Gather`、`/fc/fc.0/gru/Unsqueeze`、`/fc/fc.0/gru/Concat` です。WebGPU ではさらに `/fc/fc.0/gru/ConstantOfShape` と `Gather_token_702` が CPU に置かれました。入力の形から GRU のバッチ数や出力の形を求める計算です。
- 合成器で CPU に置かれたのは `Slice_29`、`Concat_783`、`Concat_801`、`Concat_808`、`Concat_825`、`Concat_832`、`Add_796`、`Add_798`、`Add_806`、`Add_830` です。入力の形から Reshape に渡す形を組み立てる、要素1〜8個の int64 の計算です。
- CPU への退避を禁じる設定（`session.disable_cpu_ep_fallback`）では、HuBERT はどの GPU の方式でも読み込めました。RMVPE と合成器は読み込めません。

### 出力の差

CPU の出力との相対誤差（L2）は、DirectML と WebGPU で 7 × 10⁻⁵ 以下、CUDA で 1.0〜2.3 × 10⁻³ でした。CUDA の差は、ONNX Runtime の既定で有効な TF32 によるものです。`use_tf32=0` にすると誤差は 5 × 10⁻⁶ まで下がりましたが、HuBERT が1回 11.4 秒になり、GPU のメモリ（8 GB）を使い切りました。

### 40 ms のブロック

アプリの既定の 40 ms のパケットの形（ブロック 4、クロスフェード 2、探索 1、文脈 200 フレーム）でも測りました。2 プロセス × 300 ブロックです。

| 方式 | p50 | p95 | 40 ms 超え |
|---|---|---|---|
| CUDA | 47.1 ms | 65.2 ms | 600 / 600 |
| DirectML（RTX 3060 Ti） | 33.7 ms | 38.2 ms | 18 / 600 |
| DirectML（Iris Xe） | 240.9 ms | 273.4 ms | 600 / 600 |

## worker での計測

PR #788 の worker を、アプリと同じく VVC1 のパイプで動かしました（`tools/rvc_worker_bench.py` と同じ測り方）。音は合成した音を使いました。「1パケットの処理時間」は前の答えが来てから次を送ったときの時間で、worker が1ブロックにかける時間を表します。「送る間隔どおりの往復」は、マイクと同じくブロックの長さごとに送ったときの往復です。範囲は2回か3回の値の幅を示します。

| 方式 | ブロック | 1パケットの処理時間 p50 / p95 | 送る間隔どおりの往復 p50 / p95 / 最大 | ブロックの長さ超え（往復） |
|---|---|---|---|---|
| CUDA | 40 ms | 49.1〜50.2 / 61.6〜65.4 ms | 271〜281 ms（遅れが積み上がる） | すべて |
| DirectML | 40 ms | 40.0〜41.2 / 51.3〜52.1 ms | 205〜242 ms（遅れが積み上がる） | すべて |
| CUDA | 80 ms | 53.8〜54.1 / 66.4〜66.8 ms | 55.3〜56.5 / 68.8〜76.9 / 79.2〜86.8 ms | 5 / 870 |
| DirectML | 80 ms | 44.0〜46.1 / 53.7〜55.2 ms | 57.1〜60.0 / 64.8〜67.7 / 69.8〜74.6 ms | 0 / 870 |

- `auto` は、CUDA の実行環境と DirectML の実行環境があると CUDA を、DirectML の実行環境だけなら DirectML を、どちらもなければ CPU を選びました。DirectML は、ONNX Runtime の機器の検出で `Discrete` が `1` の RTX 3060 Ti を選びました。
- 40 ms では、1パケットにかかる時間がブロックの長さを超えるので、送る間隔どおりに送ると遅れが積み上がります。アプリでは、240 ms より古いブロックを捨て、直近の半分以上が遅れると止まります。

## 決まったこと

### 1回目（2026-11-20、この計測を受けて）

1. RVC の worker に DirectML を足す。DirectML 版の ONNX Runtime が 1.24.4 で止まっている点と、デスクトップ PC での順位が未確認な点は実装時に扱う（PR #788）。
2. CUDA の TF32 は既定のまま使う。
3. WebGPU の検討はやめる。
4. この程度の CPU の PC では、CPU での変換は出さない。worker は CPU で変換を始める前に、試しの音で 0.5 秒のブロックを変換して時間を測る。ブロックの長さのうちに変換できなければ `vc_cpu_too_slow` で開始しない（`native/rvc-runtime/README.md` の「CPU speed check」）。この PC の CPU では1ブロックに 1.07 秒かかり、開始しなかった。
5. CUDA Graph は今は入れない。

### 2回目（2026-11-20、PR #788 の判断が要る点に対して）

1. 既定の 40 ms のブロックは今は変えない。強い PC では 40 ms のほうが遅れが小さいので、デスクトップ PC での計測と合わせて決める。
2. `auto` の順番は今は CUDA、DirectML、CPU のままにする。デスクトップ PC で測ってから決める。
3. 内蔵の GPU の DirectML は `auto` から外す。Iris Xe では実時間に届かないためで、4 と同じ考え方。worker は `auto` で変換を始めるとき、DirectML が使う GPU（DXGI の高性能の順で先頭のもの）の `Discrete` が `0` なら CPU で変換する。`--device directml` と、実行環境の取得の確認では内蔵の GPU も使う。
4. DirectML 版の ONNX Runtime 1.24.4 の制約は今は受け入れる。DirectML は保守だけの状態で、1.24.4 が最後の版。worker の `ort`（2.0.0-rc.15）は Windows で API 22 を求め、1.24.4 で動く。`ort` が 1.24 より新しい ONNX Runtime を求めるようになった時点で、対応を決める。
5. 計測の比較表は、この計測記録として残す。

### 3回目（2026-11-20、計測する PC と 1回目の 4 について）

1. 2回目の 1 と 2 のための計測は、Linux で RTX 4080 SUPER を積んだデスクトップ PC で行う。CUDA だけなので、測れるのは 2回目の 1（既定の 40 ms のブロック）の分。2回目の 2（`auto` の順番）は、この PC では測れない前提で進める。
2. 1回目の 4 を実装する（PR #791）。

## デスクトップ PC での計測（段取り）

2回目の判断の 1 と 2 は、デスクトップ PC での計測を待っています。手順は次のとおりです。

### 測る PC

| PC | 測る方式 | 分かること |
|---|---|---|
| Windows のデスクトップ、NVIDIA の GPU | CUDA と DirectML、40 ms と 80 ms | `auto` の順番（判断 2）と、40 ms で足りるか（判断 1） |
| Windows のデスクトップ、AMD か Intel の単体の GPU | DirectML、40 ms と 80 ms | NVIDIA 以外で DirectML が実時間に届くか |
| Linux のデスクトップ、NVIDIA の GPU | CUDA、40 ms と 80 ms | 40 ms で足りるか（判断 1）。DirectML は Windows だけ。RTX 4080 SUPER の PC で測った（下の「デスクトップ PC での計測の結果」） |

### 用意するもの

- PR #788 を含むアプリ（同梱の `astarot-rvc-worker`）
- RVC の実行環境（RVC のページから取得。NVIDIA の PC では CUDA 版になる）
- Windows では「ONNX Runtime · DirectML」（RVC のページの「モデルと実行環境」から取得）
- カタログの Saisho Utane のモデル（`model.pth`）

### 手順

```sh
python tools/rvc_worker_bench.py --worker <app>/_internal/build/astarot-rvc-worker.exe \
    --runtime <state>/vc_runtimes/rvc --directml <state>/vc_runtimes/onnxruntime-directml/lib \
    --model <model.pth> --devices cuda,directml --block-ms 40,80 --packets 300 --rounds 3 --json result.json
```

- `<state>` は設定（`config.json`）のあるフォルダです。Linux では `--directml` を付けず、`--devices cuda` にします。
- 1回の実行は worker 1つで、準備に約5秒かかります。上の指定では 3 巡 × 2 ブロック × 2 方式 × 2 測り方の 24 回で、10 分ほどかかります。
- 測っている間は、ほかに GPU を使うアプリ（VRChat、SteamVR、ゲーム）を閉じておきます。
- 出力の表と `result.json` を、CPU、GPU、ドライバー、OS の版と一緒に残します。

### 判断の目安（案）

- 判断 1: 送る間隔どおりの往復で、40 ms の p95 が 40 ms 未満なら、その PC では 40 ms で足ります。デスクトップでも足りなければ、既定を 80 ms に戻すか、方式ごとに既定を分けるかを提案します。
- 判断 2: NVIDIA のデスクトップでも DirectML の1パケットの処理時間と往復の p95 が CUDA 以下なら、`auto` で DirectML を先にすることを提案します。CUDA のほうが速ければ今の順を保ちます。

## デスクトップ PC での計測の結果（2026-11-20、Linux、RTX 4080 SUPER、CUDA）

上の手順どおり、`tools/rvc_worker_bench.py` で CUDA の 40 ms と 80 ms を測りました（3 巡 × 300 パケット、条件ごとに 870 パケットを集計）。モデルはカタログの Saisho Utane で、音は合成した音です。

### 計測した環境

- OS: Linux（CachyOS）。論理 CPU は 32 です。
- GPU: NVIDIA GeForce RTX 4080 SUPER（CUDA）
- 計測中、別の作業が CPU を約 8 コア分使っていました（負荷平均 8.5〜9.9）。負荷のない状態では測り直していません。
- CPU の型番、GPU のドライバーと ONNX Runtime の版は、受け取った結果に入っていません。

### 結果

#### 送る間隔どおりの往復（ms）

| ブロック | p50 | p95 | 最大 | ブロックの長さ超え | 240 ms 超え |
|---|---|---|---|---|---|
| 40 ms | 16.6〜17.0 | 18.1〜20.1 | 23.7〜24.2 | 0 / 870 | 0 / 870 |
| 80 ms | 21.7〜24.6 | 45.1〜46.6 | 51.7〜52.0 | 0 / 870 | 0 / 870 |

#### 1パケットの処理時間（ms）

| ブロック | p50 | p95 | 最大 | ブロックの長さ超え |
|---|---|---|---|---|
| 40 ms | 11.2〜14.4 | 14.4〜15.5 | 15.7〜22.6 | 0 / 870 |
| 80 ms | 11.8〜14.3 | 12.0〜15.6 | 15.1〜23.7 | 0 / 870 |

- 12 回とも `ready` が返り、すべてのパケットが変換されました。`ready` までは 2.2〜3.2 秒でした。
- 40 ms の往復の p95 は 18.1〜20.1 ms で、判断 1 の目安（40 ms 未満）を満たしました。
- 40 ms の1パケットの処理時間の p50 は、ノート PC（RTX 3060 Ti、Thunderbolt 接続）の CUDA の 49.1〜50.2 ms に対し、11.2〜14.4 ms でした。
- 80 ms の往復の p95（約 46 ms）は、40 ms（約 19 ms）より大きくなりました。計測中の記録では、80 ms のとき GPU のクロックが P3〜P5 まで下がっていました。送る間隔が長いと GPU のクロックが落ち、往復が延びたと推測しています。クロックを固定しての切り分けはしていません。
- 判断 2（`auto` の順番）は、この PC では DirectML を測れないので、この結果では決まりません。

## 計測しなかったこと

- アプリを通した変換と、聞いての確認。
- AMD の GPU と、Windows のデスクトップ PC。
- CUDA Graph、WebGPU のグラフキャプチャ、fp16。
