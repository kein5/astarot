# Measurement procedures and P0 equipment

[日本語版](#計測手順とp0設備日本語版)

Per-stage latency across the whole audio pipeline, from the microphone to the translated voice, is in [Measuring and reducing audio pipeline latency (2026-11-18)](pipeline-latency-2026-11-18.md).
The setup that tracks latency p50 and p95 over time in Bencher (core timings measured in CI, and how to send values from real models) is in [Continuous tracking of audio pipeline latency](pipeline-latency-tracking.md).
The comparison of RVC inference across execution methods (CPU, CUDA, DirectML, WebGPU) and the procedure for measuring it on a desktop PC (`tools/rvc_worker_bench.py`) are in [Comparison of execution methods for RVC inference (2026-11-20)](rvc-execution-providers-2026-11-20.md).
End-to-end measurements of the delay on the Windows voice conversion route with their breakdown, and design proposals such as automatic adjustment of the chunk length, are in [Research and design for lower voice changer latency (2026-11-20)](rvc-low-latency-2026-11-20.md).

The performance targets are in §8 of the specification. Repeated measurements have been taken on a dedicated PipeWire graph on Linux.
The UI → VRChat performance gate has not been judged.
Test durations with the fake server are not TTS inference speed or VRChat latency.

The later UI component and stdio integration tests are 16 independent cases that go from the production input field and settings UI through the real Main/Controller.
The time from just before the real TTS stdio write to the first sound at the virtual microphone was 294 to 627 ms depending on the conditions, and cancel and mute took 57 ms and 72 ms. The Tauri connection and the surrounding services were replaced for testing,
so these single values under differing conditions are not used to claim p95 or meeting spec §8. They are not aggregated with the 30 backend-started repetitions below.

## Linux repeated measurement (speech.cpp 0.9.0, n=30)

The later managed route + VRChat real TTS test measured 3 normal runs of
event → first sound at the virtual microphone, and real cancel/mute. It is not combined with the 30 independent-graph runs below.
The same test also reproduced the detection delay when the server is force-killed, so values for the stop operation are not extrapolated to stopping on a failure.
The fix report for connection acceptance monitoring records independent-graph tests of real server failure and recovery
for each monitoring interval. This is a separate group from the 30 normal speech runs below and from VRChat acceptance.
The post-fix host and VRChat retest confirmed one playback each in 3 normal runs and 3 recovery runs, and
silencing of the virtual microphone in 79 to 84 ms in 3 failure runs. These are not used to judge the UI-started performance gate or p95.

Measured JSON /
timestamp CSV.
The same existing Irodori MF F16, RTX 4080 SUPER / Vulkan0, voice `none`.
Excluding the 20.60-second startup warmup and the 2 preceding requests, the same Japanese test sentence was spoken 30 times.
speech.cpp had been updated to 0.9.0 on the host before this measurement. These values are not aggregated with the single 0.8.11 value.

| Measurement boundary | p50 | p95 | p99 |
|---|---:|---:|---:|
| backend event created → first non-silent PCM write | 60.419 ms | 62.493 ms | 63.526 ms |
| backend event created → first non-silent read from the dedicated virtual source | 85.094 ms | 125.998 ms | 127.239 ms |

48 kHz mono s16le, playback set to 20 ms, capture set to 10 ms.
PipeWire 1.6.10, a dedicated daemon + WirePlumber `policy` profile (no physical device monitor).
The normal desktop audio settings were left unchanged, and the dedicated processes and nodes were removed after measuring.
VRChat ran as desktop `--no-vr` and the WiVRn server was also running, but HMD audio was not connected.
GPU contention was not controlled, and FPS was not measured. Observed GPU memory use was 6606 MiB after the start and 9961 MiB after the end.
UI IPC, the normal desktop audio route, VRChat internals, the network and audibility are not included.
This differs from the UI start condition in spec §8, so these numbers do not count as passing the P1 performance gate.
With n=30, the nearest-rank p99 is the maximum, not a stable tail estimate.

## Repeated stop, disconnect and recovery (synthetic PCM, n=30)

Measured JSON.
A sustained signal independent of inference time was sent to real PipeWire.
Each run confirmed 4 entries in the waiting queue and 16 discarded on overflow, 0 entries in the queue after stopping, an error on device removal,
rejection of new requests during removal, and speech again after re-creation and explicit reselection.
Another virtual sink was set as the default in the dedicated environment, and continuous monitoring of its source found 0 non-silent chunks.

| Measurement boundary | p50 | p95 | p99 |
|---|---:|---:|---:|
| cancel call → worker idle | 10.100 ms | 15.230 ms | 15.258 ms |
| cancel call → last non-silent read | 39.943 ms | 41.885 ms | 42.184 ms |
| virtual device removed → worker idle | 6.208 ms | 8.418 ms | 11.388 ms |

After stopping, silence of 150 ms or more with the reader still running was also confirmed. The read time is an upper bound that includes the capture buffer,
and it does not stand in for Windows, physically unplugging and replugging USB/Bluetooth devices, or how long sound lingers in VRChat after a stop.

Separately, a failure smoke test with the synthetic PCM replaced by real speech.cpp TTS
also passed once. It confirmed cancellation including HTTP, device removal during speech, rejection of requests while no device exists,
and speech after re-creation and explicit reselection, and normal speech afterward also succeeded.
Passing `--server` to the CLI also runs this real-API failure smoke test before the repeated measurements.

## Repetition CLI

`tools/voice_acceptance.py` below was a tool that measured the Python backend's routes and text to speech. It was removed together with the backend on 2026-11-20 (#285). `tools/voice_latency.py`, which aggregated its output, was also removed, because the tool that wrote the CSV it read was gone (#810). This section is a record of the procedure up to 0.5. TTS in the core is measured with `native/core/examples/live_speech.rs`, and latency across the whole pipeline with `native/core/examples/pipeline_latency.rs`.

Requires `pipewire`, `wireplumber` (with policy profile support), `pw-loopback`, `pw-cat`, `pw-dump` and
`pw-metadata`. No GUI, external models or saved recordings are needed. Specify a new directory for the output.

```sh
# Stop, disconnect and recovery with a synthetic signal. No model needed.
uv run --no-project python tools/voice_acceptance.py --route-runs 30 --output /tmp/vrct-routing-run
# Also measure an existing local TTS that the user has prepared. Does not start a server or download models.
uv run --no-project python tools/voice_acceptance.py --server http://127.0.0.1:18080 --samples 30 --warmup 2 --output /tmp/vrct-vox-run
uv run --no-project python tools/voice_latency.py /tmp/vrct-vox-run/latency.csv
```

It uses a dedicated socket and temporary state, and does not connect to the normal default device or to physical microphones.
On failure it still leaves partial JSON/CSV and a failure code, and ends the processes it owns.
PCM is converted to counters and timestamps and then discarded. Text and raw audio are not saved in the report.
In the first development test, the startup check by matching WirePlumber's display name timed out,
so it was changed to check the actual PID and retested.
The isolation method is based on [PipeWire's official runtime/socket variables](https://docs.pipewire.org/page_man_pipewire_1.html) and
the `policy` profile in the installed WirePlumber configuration.

## Linux real-API smoke test (n=1)

Measurement JSON: CachyOS, RTX 4080 SUPER,
speech.cpp 0.8.11, an already downloaded Irodori MF F16, Vulkan0, voice `none`, 48 kHz mono.
After the 15.67-second load/warmup finished, the CLI's test sentence was sent to a temporary PipeWire sink/source.

| Boundary | Single observed value |
|---|---|
| event inside the CLI → first non-silent PCM write completed | 191.372 ms |
| CLI process start → non-silent PCM read at the virtual source | 304.746 ms |
| TTFA in speech.cpp's own log | 182 ms |

Non-silent data was confirmed at the virtual source, and the CLI exited with code 0. No raw audio, reference audio or PCM files
were saved. The test processes and nodes have been stopped and removed.
p50/p95/p99 and VRChat E2E performance are not judged from this single run. Windows, VRChat, HMD,
GPU contention, quality and long runs are unverified. The server binary and model hashes were recorded in the JSON.

`tools/voice_latency.py` (removed in #810) aggregated the following CSV (which contains no audio or text).

```csv
metric,environment,warm,start_ns,end_ns
```

It records the start and end measured with the same monotonic clock.
`uv run --no-project python tools/voice_latency.py measurements.csv` printed nearest-rank p50/p95/p99 and counts per metric /
environment / warm. It does not produce numbers from empty data.
A separate JSON matching the environment ID records the OS, CPU/GPU, driver, VRAM, VRChat FPS, speech.cpp
commit/binary hash, model ID/hash, voice ID (the audio itself is not saved), rate, device,
backend, server settings, warmup count and sample count.

## P1 measurement boundary

`last_first_write_ms` is **backend pipeline start → output write of the first non-silent PCM completed**.
It does not include anything before UI IPC, OS buffers, arrival at the virtual microphone, or VRChat's network.
That the first write happens without waiting for the whole PCM to be complete is verified with the fake.
Original-text mode is also queued at the end of the existing translation processing, so with translation ON the value includes that time.
Queue of 4, the oldest waiting entry discarded, messages older than 5 seconds discarded, requests cancelled at 30 seconds,
a limit of 60 seconds of audio, 2 seconds each for HTTP connect and each later read. The response headers and the first PCM share a 10-second deadline.
The PipeWire pipe holds up to 4096 bytes.

## VRChat desktop manual test

Record on real hardware. The user selected the dedicated virtual microphone
as VRChat's input and confirmed hearing the voice in the built-in record and playback test.
The next request was cancelled after about 8 seconds, and the discarding of 2 waiting entries, the input meter stopping and no resumption were also confirmed.
For the successful speech, the backend first write was 93.598 ms, and cancel to worker idle was 5.152 ms.
This is neither a latency measurement inside VRChat nor a confirmation of sending to other users.

The first, short sentence only made the meter react, and the second, long sentence failed with the 2-second timeout before the first PCM.
After the wait limit for the response headers plus the first PCM was split out and set to 10 seconds, the same long sentence was spoken and the user confirmed it.
Allowing a long first wait does not mean waiting that long every time; PCM that arrives is output at once.
The existing percentiles from 30 short sentences are kept as observations from before the fix and are not mixed with this single measurement.

## Real-hardware harness

1. Separate before and after warmup, and record the UI send time and the output write time for 30 or more short sentences.
2. Capture only approved measurement sounds from the virtual recording end, and measure arrival by onset or cross-correlation.
3. Measure VC with the physical input and the virtual output on the same clock. Do not substitute ASR/translation completion times for VC latency.
4. Compare FPS, VRAM, audio dropouts and buffers for VRChat + WiVRn with and without the HMD, and by GPU load.
5. If text or recordings are saved, turn that on separately and explicitly, and delete them after measuring.

| VC candidate | Real-hardware result | Adoption |
|---|---|---|
| VCClient Windows CUDA/ONNX RVC | Not measured | On hold |
| Seed-VC Realtime Windows/Linux | Not measured | On hold |
| VCClient Linux standard Beatrice | Per-model terms and real hardware unconfirmed | On hold |

A P2 selection record must include p50/p95, quality, drops, VRAM, supported OSes and license.

---

# 計測手順とP0設備（日本語版）

マイクから訳した声までの音声パイプライン全体の段ごとの遅延は、[音声パイプラインの遅延の計測と短縮（2026-11-18）](pipeline-latency-2026-11-18.md)にある。
遅延のp50とp95をBencherで時系列に追う仕組み（CIで測る中核の時間と、実モデルの値の送り方）は、[音声パイプラインの遅延の継続計測](pipeline-latency-tracking.md)にある。
RVCの推論を実行方式（CPU、CUDA、DirectML、WebGPU）ごとに比べた結果と、デスクトップPCで測る手順（`tools/rvc_worker_bench.py`）は、[RVCの推論の実行方式の比較（2026-11-20）](rvc-execution-providers-2026-11-20.md)にある。
Windowsの声の変換の経路の遅れを端から端まで測った結果と内訳、チャンク長の自動調整などの設計案は、[ボイスチェンジャーの低遅延化の調査と設計（2026-11-20）](rvc-low-latency-2026-11-20.md)にある。

性能目標は仕様書 §8。Linuxの専用PipeWireグラフでは反復測定済み。
UI→VRChatの性能ゲートは未判定。
fakeサーバーのテスト所要時間はTTS推論速度・VRChat遅延とは異なる。

後続のUI部品・stdio統合試験は、本番入力欄・設定UIから実Main/Controllerを通す
独立した16ケース。実TTSのstdio書込直前→仮想マイク初音は条件別に294〜627ms、
取消・ミュートは57ms・72ms。Tauri接続と周辺サービスを試験用に差し替えており、
単発・異条件の値からp95や仕様§8の達成を主張しない。下記のbackend起点30反復とは集約しない。

## Linux反復測定（speech.cpp 0.9.0、n=30）

後続のmanaged経路＋VRChat実TTS試験では、通常3回の
event→仮想マイク初音と実cancel/muteを測定した。以下の独立グラフ30回とは統合しない。
同試験でserver強制終了時の検出遅れも再現しており、停止操作の値を故障時停止へ外挿しない。
接続受付監視の修正レポートには、監視間隔ごとの実server故障・復旧の
独立グラフ試験を記録する。これは下記の通常発声30回やVRChatの受入れとは別群である。
修正後ホスト・VRChat再試験では、通常3回・復旧3回の各1回再生と、
故障3回の79〜84msでの仮想マイク無音化を確認した。UI起点の性能ゲートやp95の判定には使わない。

実測JSON /
timestamp CSV。
同じ既存Irodori MF F16、RTX 4080 SUPER / Vulkan0、voice `none`。
起動時warmup 20.60秒と先行2要求を除外し、同じ日本語のテスト文を30回発声した。
speech.cppはこの測定前にホスト側で0.9.0へ更新済みだった。0.8.11の単発値とは集約しない。

| 計測境界 | p50 | p95 | p99 |
|---|---:|---:|---:|
| backend event生成→最初の非無音PCM write | 60.419 ms | 62.493 ms | 63.526 ms |
| backend event生成→専用仮想sourceの最初の非無音read | 85.094 ms | 125.998 ms | 127.239 ms |

48 kHz mono s16le、playback指定20ms、capture指定10ms。
PipeWire 1.6.10、専用daemon＋WirePlumber `policy` profile（物理デバイスmonitorなし）。
通常デスクトップの音声設定を変えず、測定後に専用プロセスとノードを削除。
VRChatはdesktop `--no-vr`、WiVRn serverも起動中だったが、HMD音声は未接続。
GPU競合条件は制御しておらずFPSは未測定。観測したGPU使用メモリは開始後6606 MiB、終了後9961 MiB。
UI IPC、通常デスクトップ音声経路、VRChat内部・ネットワーク・聞こえは含まない。
仕様§8のUI開始条件と異なるため、この数値でP1性能ゲートを達成扱いにしない。
n=30のnearest-rank p99は最大値であり、安定したtail推定ではない。

## 停止・切断・復旧の反復（合成PCM、n=30）

実測JSON。
推論時間から切り離した持続信号を実PipeWireへ出力。
各回、待機キュー4件/overflow破棄16件、停止後キュー0件、デバイス削除時のエラー、
削除中の新規要求拒否、再作成・明示再選択後の再発声を確認。
別の仮想sinkを専用環境の既定に指定し、そのsourceを常時監視したところ非無音チャンク0件。

| 計測境界 | p50 | p95 | p99 |
|---|---:|---:|---:|
| cancel呼出→worker idle | 10.100 ms | 15.230 ms | 15.258 ms |
| cancel呼出→最後の非無音read | 39.943 ms | 41.885 ms | 42.184 ms |
| 仮想デバイス削除→worker idle | 6.208 ms | 8.418 ms | 11.388 ms |

停止後はreaderが稼働したまま150ms以上の無音も確認。read時刻はcapture bufferを含む上界で、
Windows、物理USB/Bluetooth抜き差し、VRChatの停止残留時間の代わりではない。

別途、合成PCMを実speech.cpp TTSへ置き換えた障害smoke
も1回PASS。HTTPを含む取消、発声中のデバイス削除、デバイス不在の要求拒否、
再作成・明示再選択後の発声を確認し、その後の通常発声も成功。
CLIに`--server`を渡すとこの実API障害smokeも反復測定の前に実行する。

## 反復CLI

以下の`tools/voice_acceptance.py`は、Pythonのバックエンドの経路と読み上げを測る道具だった。2026-11-20にバックエンドと一緒に消した（#285）。その出力を集計する`tools/voice_latency.py`も、読むCSVを書く道具がなくなったので消した（#810）。この節は0.5までの手順の記録である。中核の読み上げは`native/core/examples/live_speech.rs`、パイプライン全体の遅延は`native/core/examples/pipeline_latency.rs`で測る。

`pipewire`、`wireplumber`（policy profile対応）、`pw-loopback`、`pw-cat`、`pw-dump`、
`pw-metadata`が必要。GUI、外部モデル、録音保存は不要。出力先は新しいディレクトリを指定する。

```sh
# 合成信号による停止・切断・復旧。モデル不要。
uv run --no-project python tools/voice_acceptance.py --route-runs 30 --output /tmp/vrct-routing-run
# ユーザーが用意した既存ローカルTTSも測定。サーバー起動・モデル取得はしない。
uv run --no-project python tools/voice_acceptance.py --server http://127.0.0.1:18080 --samples 30 --warmup 2 --output /tmp/vrct-vox-run
uv run --no-project python tools/voice_latency.py /tmp/vrct-vox-run/latency.csv
```

専用ソケット・一時stateを使用し、通常の既定デバイスや物理マイクには接続しない。
失敗時も部分的なJSON/CSVと失敗コードを残し、所有プロセスを終了する。
PCMはカウンターと時刻に変換して破棄。本文・生音声はレポートに保存しない。
初回開発試験ではWirePlumberの表示名一致で起動判定がタイムアウトしたため、
実際のPIDで判定するよう修正して再試験した。
分離方法は[PipeWire公式のruntime/socket変数](https://docs.pipewire.org/page_man_pipewire_1.html)と
インストール済みWirePlumber設定の`policy` profileに基づく。

## Linux実APIスモーク（n=1）

測定JSON: CachyOS、RTX 4080 SUPER、
speech.cpp 0.8.11、取得済みIrodori MF F16、Vulkan0、声`none`、48 kHz mono。
load/warmup 15.67秒の終了後、CLIのテスト文を一時PipeWire sink/sourceへ送った。

| 境界 | 1回の観測値 |
|---|---|
| CLI内event→最初の非無音PCM write完了 | 191.372 ms |
| CLIプロセス起動→仮想sourceで非無音PCMをread | 304.746 ms |
| speech.cpp自身のログTTFA | 182 ms |

仮想sourceで非無音データを確認しCLIは終了コード0。生音声・参照音声・PCMファイルの
保存なし。試験用プロセス/ノードは停止・削除済み。
この1回からp50/p95/p99やVRChat E2E性能は判断しない。Windows、VRChat、HMD、
GPU競合、品質、長時間稼働は未検証。サーバーbinary/モデルhashをJSONに記録した。

`tools/voice_latency.py`（#810で消した）は以下のCSVを集計していた（音声・本文を含めない）。

```csv
metric,environment,warm,start_ns,end_ns
```

同じmonotonic clockで測った開始・終了を記録する。
`uv run --no-project python tools/voice_latency.py measurements.csv` はmetric /
environment / warm別にnearest-rank p50/p95/p99と件数を出していた。空データから数値は作らない。
環境IDに対応する別JSONへOS、CPU/GPU、driver、VRAM、VRChat FPS、speech.cppの
commit/binary hash、モデルID/hash、voice ID（音声自体は保存しない）、rate、device、
backend、server設定、warmup回数、サンプル数を記録する。

## P1の計測境界

`last_first_write_ms` は **backend pipeline開始→最初の非無音PCMの出力write完了**。
UI IPC手前、OSバッファ、仮想マイクの到達、VRChatのネットワークは含まない。
完成したPCM全体を待たずに最初のwriteが行われることはfakeで検証する。
原文モードも既存翻訳処理の末尾で投入するため、翻訳ON時はその時間を含む。
キュー4件、最古待機を破棄、5秒超過メッセージを破棄、要求30秒で取消、
音声60秒分で上限、HTTP connect/後続read各2秒。応答ヘッダと最初のPCMには共通10秒の期限を使う。
PipeWire pipeは4096 bytesまで。

## VRChatデスクトップ手動試験

実機記録。ユーザーが専用仮想マイクを
VRChatの入力に選び、内蔵の録音・再生テストで声が聞こえたと確認した。
次の要求を約8秒で取消し、待機2件破棄・入力メーター停止・再開なしも確認。
成功した発声のbackend first writeは93.598ms、取消からworker idleまでは5.152ms。
これはVRChat内の遅延計測でも、他ユーザーへの送信確認でもない。

初回短文はメーター反応のみ、2回目の長文は初回PCM前の2秒timeoutで失敗した。
応答ヘッダ＋初回PCMの待ち上限を10秒へ分離した後、同じ長文で発声・ユーザー確認が成功。
長い初回待ちを許しても毎回その秒数を待つわけではなく、届いたPCMはすぐに出力する。
短文30回の既存percentileは修正前の観測として保持し、今回の単発測定とは混合しない。

## 実機ハーネス

1. ウォームアップ前後を分け、短文30件以上でUI送信時刻と出力write時刻を取得。
2. 許可した計測音だけを仮想録音端から取得し、立ち上がり/相互相関で到達を測る。
3. VCは物理入力と仮想出力を同一clockで測る。ASR/翻訳の完了時刻をVC遅延に代用しない。
4. VRChat + WiVRn + HMD有/無、GPU負荷別にFPS/VRAM/音切れ/バッファを比較。
5. 本文や録音を保存する場合は別途明示的に有効化し、測定後に削除する。

| VC候補 | 実機結果 | 採用 |
|---|---|---|
| VCClient Windows CUDA/ONNX RVC | 未測定 | 保留 |
| Seed-VC Realtime Windows/Linux | 未測定 | 保留 |
| VCClient Linux標準Beatrice | モデル個別条件・実機未確認 | 保留 |

P2の選定記録はp50/p95、品質、ドロップ、VRAM、対応OS、ライセンスを必須とする。
