# Research and design for lower voice changer latency (2026-11-20, #531)

[日本語版](#ボイスチェンジャーの低遅延化の調査と設計2026-11-20531日本語版)

This is the record of the "research and design" part of #531. We measured how the delay breaks down on the Windows voice conversion (RVC) path, and looked at automatic chunk-length tuning, audio input and output, processing on the GPU and the crossfade. All values were measured on the PCs in "Measured PCs" below and are not a guarantee for other environments. What needs deciding is collected in [Decision items](#decision-items).

## Decisions (2026-11-20)

The [decision items](#decision-items) below were decided as follows.

1. For automatic tuning, add only Option A (choose at startup) first. Decide on Option B (adjust during conversion) after measuring the round trip with VRChat running.
2. The startup choice works as proposed. The candidates are 40, 60, 80, 100, 120, 160 and 200 ms, the factor is 1.4, the worker chooses, and `ready` returns the chosen length.
3. The thresholds during conversion are only recorded as candidates, with the values in this document. They are not part of this implementation.
4. Add "Automatic" to the block length in "Advanced" and make "Automatic" the default. A length the user chose takes priority over automatic.
5. Decide the output rule after measuring the difference on VB-Cable.
6. Decide the crossfade after comparing by ear with a synthesized voice. Until then it stays at half the block.
7. Do not support ASIO.
8. How to ship it in 0.6.0 is decided on the implementation side, in line with decision 4 (make "Automatic" the default). If the call is not clear-cut, the implementation PR keeps it as a decision item. The implementation shipped it as a normal setting with "Automatic" as the default, not as an experimental feature. Experimental features are off by default, which does not fit the decision to make "Automatic" the default.
9. Use VB-Cable for the measurement in 5.

In the implementation of 1 to 4, the worker measures the time once with a 40 ms block and chooses the shortest candidate length that 1.4 times that time fits in. When we measured several lengths one after another in the same session, DirectML took 190 to 300 ms per block from the second length on (41 ms in a new session). So when DirectML chooses a length other than 40 ms, the worker loads the network again (about 3 seconds). CUDA did not behave this way, so it does not reload. The lengths chosen on the laptop were 80 ms with CUDA (5.4 seconds to `ready`) and 60 ms or 80 ms with DirectML (about 10 seconds). This is because DirectML's time at 40 ms (41 to 45 ms) straddles the boundary for choosing 60 ms (about 43 ms). The p50 of the end-to-end delay was 229.5 ms with CUDA and 231.5 ms with DirectML (10 runs each, in both cases runs where 80 ms was chosen).

The decision items of the implementation PR (#806) were decided as follows (2026-11-20).

- The chosen length is remembered for each combination of voice model and GPU and is not measured again after that. The worker records it in `<state>/vc_runtimes/rvc-block-lengths.json`. The reload when DirectML chooses a length other than 40 ms (about 10 seconds to `ready`) happens only the first time.
- A length saved in `RVC_BLOCK_MS` with a development build is treated as a length the user chose (not as automatic).

The 2 items that remained were decided as follows (2026-11-21).

- The output rule (decision item 5) stays as the current rule (start playing once the 100 ms buffer is full). Tightening the margin removes only part of the difference, and avoiding audio dropouts in the middle of a conversation took priority. The implementation does not change. The material is in [Output rule difference on VB-Cable](#output-rule-difference-on-vb-cable-material-for-decision-item-5).
- A recorded length is measured again when the user selects "Automatic" again in "Advanced". The remembered length is then not used, and the next time conversion starts, the GPU is measured again for that combination of voice model and GPU. No new button is added.

Decision item 6 (the crossfade cap) was decided as follows (2026-11-27, #928).

- The crossfade is capped at 20 ms. A 10 ms cap is not acceptable. In the worker's GPU layout (CUDA and DirectML), the crossfade is half the block, up to 20 ms. For an 80 ms block, the delay from the crossfade and the search goes from 50 ms to 30 ms, and the `latency_ms` in `ready`, which also includes the sample-rate conversions, goes from 52 ms to 32 ms. Blocks of 40 ms or less do not change, because half the block is already 20 ms or less.
- A 20 ms block keeps a crossfade of 10 ms (half the block), the length that sounded choppy in the check below. 20 ms is not among the automatic candidates (40 ms and up), so it is used only when the user chooses it in "Advanced".

The decision rests on a listening check. Japanese text read by Windows speech synthesis (Microsoft Haruka Desktop, 18.8 seconds) was converted with Saisho Utane from the catalog (RVC v2, 48 kHz, no index, no transposition). The conversion used the worker's layout (10 ms search, 2 s of left context, input high-pass) and changed only the crossfade. The six converted files were compared by ear ([samples](https://github.com/kein5/astarot/issues/928#issuecomment-7064024933), [result](https://github.com/kein5/astarot/issues/928#issuecomment-7208151039)). Whether the joins broke up depended on the length of the crossfade, not on the size of the block: every 10 ms crossfade sounded choppy, and every crossfade of 20 ms or more sounded fine.

| Block | Crossfade | Result |
|---|---|---|
| 20 ms | 10 ms (half the block) | Choppy at the joins, hard to listen to |
| 40 ms | 10 ms | Choppy at the joins, hard to listen to |
| 40 ms | 20 ms (half the block) | No problem heard |
| 80 ms | 10 ms | Choppy at the joins, hard to listen to |
| 80 ms | 20 ms | No problem heard |
| 80 ms | 40 ms (half the block, the layout before this decision) | No problem heard |

The blocks were converted back to back, not at real-time pace. The files therefore contain only the sound of the joins, not dropouts from blocks that are converted too late.

## Summary of the results

- We measured the delay on the Windows path end to end (laptop, Steam Streaming virtual devices, synthesized sound). The p50 from the onset of the input sound to the onset of the converted voice was 222 to 240 ms with CUDA at 80 ms blocks, and 176 to 187 ms with DirectML at 60 ms.
- The delay is almost fully explained as "read + block + crossfade and search + round trip + audio left in the output". With CUDA at 80 ms, the block is 80 ms, the crossfade and search 50 ms, the round trip about 54 ms and the audio left in the output about 50 ms.
- The processing time for one block hardly shrinks when the block gets shorter. On this laptop it takes about 50 ms with CUDA and about 40 ms with DirectML. So at the default 40 ms the processing cannot keep up, and the voice plays about 250 ms late while late blocks are dropped. The desktop PC (RTX 4080 SUPER) keeps up with 40 ms with time to spare.
- With a long send interval, the GPU clock drops and processing a block gets slower. On this laptop it falls to P3 (1,050 to 1,185 MHz) at 120 ms and to P5 (555 MHz at the lowest) at 200 ms, and the p95 of the round trip at 200 ms was about twice that of back-to-back processing. We think the same effect made the p95 of the round trip at 80 ms larger than at 40 ms on the desktop PC. A longer block does not necessarily give more headroom.
- For automatic tuning, the proposal is to choose "the shortest block whose processing keeps up" and to measure the headroom with the round trip at the send interval. How it behaves and its thresholds are decision items.
- During the measurement, we found a bug where conversion on Windows stopped at the second block, and fixed it in #801.

## Measured PCs

- Laptop: Intel Core i7-1255U, 32 GB of memory, Windows 11 Home Insider Preview (build 26320), NVIDIA GeForce RTX 3060 Ti 8 GB (Thunderbolt external enclosure, PCIe x4), driver 617.42. ONNX Runtime is 1.31.0 for CUDA and 1.24.4 for DirectML. The details of the environment are the same as in [Comparison of execution providers for RVC inference](rvc-execution-providers-2026-11-20.md#計測した環境).
- Model: Saisho Utane from the catalog (RVC v2, 48 kHz). No index is used.
- The desktop PC values are taken from [Measurement results on the desktop PC](rvc-execution-providers-2026-11-20.md#デスクトップ-pc-での計測の結果2026-11-20linuxrtx-4080-supercuda) in the same record (Linux, RTX 4080 SUPER, CUDA).

## The path and the breakdown of the delay

### Path

This is the Windows path as confirmed in the code (`native/audio-routing`, `native/voice-conversion`, `native/rvc-runtime`).

1. Microphone: received in WASAPI shared mode, converted to 48 kHz mono. It is read every 10 ms, without events (`wasapi/capture.rs`). The engine period is 10 ms.
2. Block: 20 ms segments are gathered into one block (40 ms by default). The first sound in a block waits until the block is complete.
3. Input queue: holds up to 4 blocks. Blocks older than 240 ms are dropped without being sent to the worker, and if more than half are dropped within 6 seconds, conversion stops with `vc_capture_overrun`.
4. Worker: only one block is sent at a time, and the sender waits for the answer. Inside the worker, the output lags the input by the crossfade (half the block) and the search (10 ms). Conversion between 48 kHz and 16 kHz adds about 2 ms (`latency_ms` in `ready`).
5. Output queue: holds up to 4 blocks.
6. Output: in WASAPI shared mode, playback starts once the 100 ms buffer is full (`wasapi/output.rs`). After that, the freed space is filled every 5 ms.

### End-to-end measurement

The measurement used `native/voice-conversion/examples/vc_path_latency.rs`. It uses the same conversion owner as the app (`VcProcess` and `DeviceRoute`), the worker and the WASAPI output, and takes the loopback of a virtual device in place of the microphone.

- A synthesized sound (a 180 Hz tone with harmonics, 400 ms) is played to the output of Steam Streaming Microphone 15 times, every 2 seconds. Its loopback is read every 10 ms, like the app's microphone, and converted. The converted voice goes to Steam Streaming Speakers.
- The loopbacks of the two devices are recorded with audio engine timestamps. The delay is measured from the onset of the input sound to the onset of the converted voice (where the 5 ms RMS reaches 1/10 of its maximum). In the runs that also recorded the delay from the cross-correlation of the envelopes (10 runs in the second round, and 1 run to check the example), it was within 3.2 ms of the onset delay every time.
- No real microphone or speaker was used. No audio or text was saved.
- `margin:0` is a prototype output for comparison. It does not wait for the buffer to fill and writes the audio as soon as it arrives. `full:100` follows the app's output rule on the prototype side, and records how much is left in the buffer each time it writes a block.

| Provider | Block | Output | Onset delay p50 (per run) | Round trip (`round_trip_ms`) | Runs |
|---|---|---|---|---|---|
| CUDA | 80 ms | App output | 222.5–239.8 ms | 53–54 ms | 5 |
| CUDA | 80 ms | `margin:0` | 209.0–225.5 ms | 53–54 ms | 4 |
| CUDA | 80 ms | `full:100` | 233.2–249.8 ms | 53–55 ms | 2 |
| DirectML | 80 ms | App output | 226.8–241.5 ms | 58 ms | 3 |
| DirectML | 80 ms | `margin:0` | 199.7 ms | — | 1 |
| DirectML | 60 ms | App output | 176.1–187.2 ms | 49 ms | 2 |
| DirectML | 60 ms | `margin:0` | 164.6 ms | 50 ms | 1 |
| CUDA | 120 ms | App output | 272.1–283.3 ms | 66 ms | 2 |
| CUDA | 40 ms | App output | 251.7–256.9 ms | 49 ms | 2 |
| DirectML | 40 ms | App output | 264.8 ms | — | 1 |

- The round trip is `round_trip_ms` at the end of a run. It was not recorded for the 12 runs of the first round.
- The spread within each run (the difference between minimum and maximum) was 10 to 25 ms at 60 ms and 80 ms, which keep up, 20 to 36 ms at 120 ms, and 55 to 114 ms at 40 ms, which does not keep up.
- At 40 ms, neither provider keeps up with the processing. Blocks pile up in the queue and are dropped once they are older than 240 ms. During the 30 seconds measured, conversion did not stop, but the audio of the dropped blocks is missing.

### Breakdown

This is the example of CUDA at 80 ms with the app output.

| Stage | Delay | How it was obtained |
|---|---|---|
| Microphone read | 0–10 ms | Read every 10 ms (code) |
| Block | 80 ms | Block length |
| Crossfade and search | 50 ms | 40 ms and 10 ms (code) |
| Sample-rate conversion | About 2 ms | From the worker's `latency_ms` |
| Round trip | About 54 ms | `round_trip_ms` |
| Audio left in the output | About 50 ms | Audio left in the output, measured with `full:100` (below) |
| Total | About 240 ms | Measured: 222 to 240 ms |

- The output delay is the length of audio still in the buffer when a new block is written. Measured with the prototype that follows the app's rule (`full:100`), its p50 was 50 to 70 ms. With `margin:0` it is 20 to 30 ms. In both, once a late block empties the buffer, the audio left grows by that delay.
- The difference that the output rule makes (between the app output and `margin:0`, measured back to back as a pair) was 6 to 18 ms with CUDA at 80 ms (4 pairs), and 23 ms with DirectML at 60 ms and 42 ms at 80 ms (1 pair each). This is smaller than the value expected from the 100 ms buffer (up to about 80 ms). As the code comments say, the Steam Streaming devices read 30 ms at a time and read twice in a row right after playback, so we think less of the 100 ms actually stays in the buffer. Devices that read 10 ms at a time (such as VB-Cable) should keep more. This was not measured.
- The microphone was not measured. A real microphone is read every 10 ms, like the loopback, so the difference is expected to be a few ms.

### Output rule difference on VB-Cable (material for decision item 5)

As material for deciding decision item 5 (the output rule), we set the output to VB-Cable ("CABLE Input" from VB-CABLE Driver Pack46) and measured the same way. The input was the Steam Streaming Microphone loopback as before, with 15 sounds in each run. The VB-Cable engine period was 10 ms, and the shortest in shared mode was 2.67 ms.

| Provider | Block | App output | `full:100` | `margin:0` |
|---|---|---|---|---|
| CUDA | 80 ms | 322–349 ms (2 runs) | 333–337 ms (2 runs) | 293–307 ms (3 runs) |
| DirectML | 60 ms | 277 ms | 301 ms | 261 ms |
| DirectML | 80 ms | 342 ms | — | 303 ms |

- In the pairs measured back to back, the difference between the app output and `margin:0` was 15 ms and 50 ms with CUDA at 80 ms, 39 ms with DirectML at 80 ms and 16 ms at 60 ms. The difference between `full:100` and `margin:0` is 34 to 44 ms. This is a little larger than on the Steam Streaming devices (6 to 42 ms), and it also varied more from run to run.
- The audio left in the buffer when writing had a p50 of 60 to 70 ms with `full:100` and 20 to 30 ms with `margin:0`.
- `margin:0` ran empty 13 to 22 times in 30 seconds. Each time, the audio cuts out briefly. A rule with no margin at all cannot be used; in practice, the chosen rule would keep a margin of about 20 to 30 ms. In that case, the saving is expected to be smaller than the differences above.
- Comparing `margin:0` runs with each other, VB-Cable was 70 to 85 ms slower than the Steam Streaming devices. We think this is the audio VB-Cable keeps in its own buffer. It is larger than what the output rule can save. It should change with the VB-Cable setting (Max Latency), but we have not measured with a different setting.

## Block length and processing time

With the same method as `tools/rvc_worker_bench.py --gpu-clocks`, we sent blocks of different lengths to the worker (200 packets each, the 190 after the first 10 counted, 1 run each). "At the send interval" is the round trip when packets are sent at the same interval as the microphone. "Back to back" is the time for one packet when the next is sent as soon as the answer arrives. The GPU state was read with `nvidia-smi` every 100 ms while sending at the send interval. When sending back to back, the GPU stayed at its maximum clock (1,935 to 1,950 MHz) for every block length.

### CUDA (laptop)

| Block | At the send interval p50 / p95 | Back to back p50 / p95 | Number over the block length | GPU state and clock |
|---|---|---|---|---|
| 20 ms | 284.8 / 327.3 ms | 48.2 / 63.8 ms | 190 / 190 | P2, 1,950 MHz |
| 40 ms | 275.9 / 315.3 ms | 50.1 / 63.9 ms | 190 / 190 | P2, 1,950 MHz |
| 60 ms | 52.6 / 64.7 ms | 52.0 / 63.9 ms | 30 / 190 | P2, 1,935 MHz |
| 80 ms | 55.1 / 68.2 ms | 55.8 / 69.1 ms | 0 / 190 | P2, 1,950 MHz |
| 120 ms | 64.2 / 74.2 ms | 57.5 / 71.3 ms | 0 / 190 | P3, 1,185 MHz |
| 200 ms | 75.8 / 137.6 ms | 58.0 / 69.7 ms | 0 / 190 | P3 and P5, 840 MHz (lowest 555 MHz) |

### DirectML (laptop)

| Block | At the send interval p50 / p95 | Back to back p50 / p95 | Number over the block length | GPU state and clock |
|---|---|---|---|---|
| 20 ms | 227.3 / 280.5 ms | 38.3 / 49.3 ms | 190 / 190 | P0, 1,935 MHz |
| 40 ms | 229.9 / 287.5 ms | 43.1 / 52.7 ms | 190 / 190 | P0, 1,935 MHz |
| 60 ms | 52.0 / 58.6 ms | 41.1 / 50.8 ms | 4 / 190 | P0, 1,590 MHz |
| 80 ms | 55.8 / 66.6 ms | 46.7 / 55.5 ms | 0 / 190 | P0, 1,410 MHz |
| 120 ms | 71.0 / 83.4 ms | 46.4 / 62.0 ms | 0 / 190 | P3, 1,050 MHz |
| 200 ms | 85.1 / 133.2 ms | 52.6 / 62.9 ms | 0 / 190 | P3 and P5, 1,140 MHz (lowest 675 MHz) |

- When 20 ms and 40 ms blocks are sent at the send interval, the answers fall further and further behind, and the round trip includes the time spent in the queue. It is not the processing time itself.
- Sent back to back, one packet took 48 to 58 ms with CUDA and 38 to 53 ms with DirectML, across the whole range from 20 ms to 200 ms. This is because feature extraction (HuBERT) reads the whole window, including 2 seconds of context, every time (the same trend as the rvc-stream measurement in [Audio pipeline latency](pipeline-latency-2026-11-18.md#声の変換rvc531)).
- The shortest block that keeps up on this PC is 80 ms with CUDA and 60 ms with DirectML. With DirectML at 60 ms, 4 of the 190 went over the block length.
- The longer the GPU rests, the lower its clock goes. With DirectML, the clock starts to drop from 60 ms, and at 120 ms the p50 at the send interval was 25 ms longer than back to back.
- With CUDA on the desktop PC (RTX 4080 SUPER), one packet takes 11 to 15 ms to process. The p95 of the round trip is 18.1 to 20.1 ms at 40 ms and 45.1 to 46.6 ms at 80 ms, and at 80 ms the clock had dropped to P3 to P5. On the desktop PC, 20 ms was not measured at the send interval.

## Bug found during the measurement (#801)

When we started measuring this path, conversion stopped at the second block with `vc_block_expired`. The owner set a block's time from the time its first 20 ms segment arrived. So when the first segment arrived late and the next one arrived right after it, the end of the block was in the future (8.4 ms ahead this time). This happens often with WASAPI read every 10 ms. #801 keeps the end of a block from being later than the time its last segment arrived. All the measurements above are values after the #801 fix.

## Design proposal

### Automatic chunk-length tuning

From the measurements, we take the following 3 points as given.

1. The processing time for one block hardly changes with the block length. How short the block can get is limited by that PC's processing time.
2. Headroom is measured with the round trip at the send interval. Back-to-back processing time does not include the slowdown from the GPU clock dropping. With DirectML at 120 ms on the laptop, the p50 was 46 ms back to back and 71 ms at the send interval.
3. A longer block also makes the GPU rest longer, and its clock drops. The headroom after lengthening is not known until it is measured again after the change. A longer block adds the same amount of delay, so choose the shortest block that keeps up. A short block does not let the GPU rest, so the clock also stays up.

From this, we propose the following two stages.

#### Choose at startup (Option A)

At the end of loading, the worker also converts a few blocks back to back on the GPU and chooses the first block length from that time (the same mechanism as the CPU speed check, `cpu_block_time`). For example, "the shortest candidate for which the back-to-back time × 1.4 is at most the block length". On the laptop, that gives 80 ms with CUDA (55.8 × 1.4 = 78) and 60 ms with DirectML (41.1 × 1.4 = 58). The desktop PC takes 11 to 15 ms per packet, so with candidates from 40 ms up, it gets 40 ms. 1.4 is a provisional value: at 60 ms and 80 ms on the laptop, the p95 at the send interval was 1.2 to 1.4 times the back-to-back p50. At present, the owner decides the block length and passes it to the worker, and checks in `ready` that the length is the same. If the worker chooses, a change is needed so that `ready` returns the chosen length and the owner follows it.

#### Adjust during conversion (Option B)

The owner already records the round trips of the last 6 seconds (`round_trip_ms`). It changes the block one step at a time as follows.

- Lengthen: when the p95 of the round trip goes over 0.8 times the block, or when round trips longer than the block go over 1% of the last 6 seconds.
- Shorten: when the p95 of the round trip stays below 0.6 times the next shorter block for 30 seconds. But do not go back to a length that recently failed to keep up.
- Change at most once every 30 seconds. This prevents a loop where, after lengthening, the GPU clock drops, the round trip grows and the block is lengthened again.

Changing the block length requires rebuilding the stream inside the worker. The loaded model stays usable, but the context and the crossfade start empty, so about one block of audio cuts out at the change. Restarting the worker stops conversion for about 5 seconds until `ready` (the laptop's figure). When other apps such as VRChat use the GPU, the round trip changes. Option B is there to change the block to follow that change. We have not yet measured with VRChat running.

### Output buffer

At present, playback starts once the 100 ms buffer is full. If the rule were instead "put a fixed length of silence before the first block and start playing at once", the audio left in the buffer could be sized to the variation of the round trip. When a late block empties the buffer, the length kept grows by that amount on its own. To reduce it again, processing that trims a few ms at a time from quiet blocks would be needed.

The difference measured on the Steam Streaming devices was 6 to 18 ms. On devices that read 10 ms at a time, it is expected to be larger. Before deciding, it needs to be measured with a virtual cable used for VRChat's input (such as VB-Cable).

### Audio input and output

- Changing the microphone read from reading every 10 ms to events (`AUDCLNT_STREAMFLAGS_EVENTCALLBACK`) saves about 5 ms on average.
- With `IAudioClient3`, the engine period can be shorter than 10 ms if the driver supports it. On this laptop, the built-in speakers went down to 5.33 ms, and the Steam Streaming devices offered only 10 ms (checked on the output devices; the microphone was not opened). The saving is a few ms on each side.
- Exclusive mode stops other apps from using that device. The microphone could no longer be shared with Discord and similar apps, and the output virtual cable would be taken over too. The proposal is not to make it the default.
- ASIO: Steinberg's ASIO SDK became dual-licensed under GPLv3 and its existing proprietary license from October 2025 ([KVR Audio article](https://www.kvraudio.com/news/steinberg-moves-vst-3-sdk-to-mit-open-source-license-asio-now-gplv3-65179), [SDK repository](https://github.com/audiosdk/asio)). This app is MIT-licensed, so using the SDK under GPLv3 would mean releasing the whole distribution under GPLv3. The proprietary license costs nothing but needs a contract with Steinberg, and the SDK cannot be kept in a public repository. ASIO helps only with microphones on audio interfaces that have ASIO drivers. The output to VRChat stays on a WASAPI virtual cable, so the saving is a few ms on the input side. The proposal for now is not to support it.

### Room for keeping the processing on the GPU

With DirectML at 80 ms on the laptop, the times of the three graphs (HuBERT, RMVPE, the synthesizer) added up to 35.8 ms (the sum of the p50 values in [Graph-only comparison](rvc-execution-providers-2026-11-20.md#グラフだけの比較)). One packet in the worker takes 46.7 ms back to back, so about 11 ms is spent outside the graphs. Outside the graphs, the worker does sample-rate conversion, feature interpolation, the crossfade, reading and writing the pipe, and copies between the CPU and the GPU. About 1 MB is copied per block, so we estimated the copy at under 1 ms even on PCIe 3.0 x4 (an estimate by calculation, with no profile taken). We think keeping the data on the GPU with IO binding would save a few ms at most. Profiling the CPU work outside the graphs first looks like the better step.

### Crossfade

At present the crossfade is phase-aligned (SOLA, with sine-squared weights), half the block long, with a 10 ms search. The output lags by the length of the crossfade and the search, which is 50 ms for an 80 ms block. A cap on the crossfade (for example 20 ms) would save 10 to 40 ms for blocks of 60 to 120 ms. Whether the audio breaks up with a short crossfade and short blocks has to be checked by ear. In particular, the pitch (RMVPE) looks only at the block plus 50 ms, so it may become unsteady with short blocks. Sound quality was not measured this time.

> **Addendum** (2026-11-27, #928): After a listening check, the crossfade was capped at 20 ms. See [Decisions](#decisions-2026-11-20).

## Decision items

1. Scope of automatic tuning: only Option A (choose at startup), or Option B (adjust during conversion) as well. The recommendation is to add Option A first, and decide on Option B after measuring the round trip with VRChat running.
2. How to choose at startup: the candidate blocks (for example 40, 60, 80, 100, 120, 160 and 200 ms), the factor (1.4 for now), and whether the worker or the owner chooses. If the worker chooses, change the contract between the worker and the owner so that `ready` returns the length.
3. Thresholds during conversion: the condition to lengthen (p95 over 0.8 times the block, or round trips over the block length above 1%), the condition to shorten (below 0.6 times the next shorter block for 30 seconds), the interval between changes (at most once every 30 seconds), and whether to accept about one block of audio cutting out at each change.
4. Relation to the manual setting: whether to add "Automatic" to the block length in "Advanced" (`RVC_BLOCK_MS`, 40 ms by default) and make it the default. On this laptop, the default 40 ms runs about 250 ms late while dropping blocks. The proposal is that a length the user chose takes priority over automatic.
5. Output rule: whether to change the rule of starting playback once 100 ms is full to a rule that puts a margin of silence first and plays at once. Before deciding, measure the difference on VB-Cable or a similar cable.
6. Crossfade cap: keep it at half the block, or set a cap (for example 20 ms). The proposal is to decide after comparing by ear, with a synthesized voice (such as Windows speech synthesis), blocks of 20, 40 and 80 ms with and without the cap.
7. ASIO: not supporting it (recommended), supporting it under GPLv3, or supporting it under the proprietary license.
8. How to ship it in 0.6.0: ship automatic tuning as an experimental feature, or make it the default.

## What was not measured

- The delay with a real microphone, with virtual cables such as VB-Cable, and inside VRChat.
- The round trip with VRChat running (when the two compete for the GPU).
- The end-to-end delay on the desktop PC, and 20 ms blocks there. AMD and Intel GPUs.
- Sound quality (short blocks, short crossfades).
- A profile of the worker's processing outside the graphs.

## Measuring further

The end-to-end delay (Windows) is measured as follows. For the two virtual devices, choose ones that do not play sound.

```sh
cargo run --release --manifest-path native/voice-conversion/Cargo.toml --example vc_path_latency -- \
    --worker <astarot-rvc-worker.exe> --runtime <state>/vc_runtimes/rvc \
    --directml <state>/vc_runtimes/onnxruntime-directml/lib --model <voice.pth> \
    --device cuda --block-ms 80 --output app --bursts 15
```

`--output full:100` records the audio left in the output with the same rule as the app, and `--output margin:0` uses the prototype that writes without waiting.

The block length and the GPU clock (NVIDIA) are measured as follows.

```sh
python tools/rvc_worker_bench.py --worker <astarot-rvc-worker> --runtime <state>/vc_runtimes/rvc \
    --model <voice.pth> --devices cuda --block-ms 20,40,60,80,120,200 --packets 200 --rounds 1 --gpu-clocks
```

---

# ボイスチェンジャーの低遅延化の調査と設計（2026-11-20、#531）（日本語版）

#531 の「調査と設計」の記録です。Windows の声の変換（RVC）の経路で遅れの内訳を測り、チャンク長の自動調整、音声の入出力、GPU 上での処理、クロスフェードを検討しました。値はどれも下の「計測した PC」で測ったもので、ほかの環境での保証ではありません。決めることは[判断項目](#判断項目)にまとめました。

## 決まったこと（2026-11-20）

下の[判断項目](#判断項目)は、次のとおり決まりました。

1. 自動調整は、まず案A（起動時に選ぶ）だけを入れます。案B（変換中に合わせる）は、VRChat を動かしながら往復を測ってから決めます。
2. 起動時の選び方は案のとおりです。候補は 40、60、80、100、120、160、200 ms、係数は 1.4 で、worker が選び、`ready` で選んだ長さを返します。
3. 変換中のしきい値は、文書の値を候補として記録しておくだけにします。今回の実装には入れません。
4. 「高度な設定」のブロックの長さに「自動」を足し、既定を「自動」にします。利用者が選んだ長さは自動より優先します。
5. 出力の規則は、VB-Cable で差を測ってから決めます。
6. クロスフェードは、合成した声で聞き比べてから決めます。それまではブロックの半分のままにします。
7. ASIO には対応しません。
8. 0.6.0 での出し方は、4 の決定（「自動」を既定にする）に合わせて実装の側で決めます。判断が割れる場合は、実装の PR に判断項目として残します。実装では、実験的機能にはせず、「自動」を既定とする通常の設定として出しました。実験的機能は既定でオフなので、「自動」を既定にする決定と合わないためです。
9. 5 の計測には VB-Cable を使います。

1〜4 の実装では、worker は 40 ms のブロックで一度だけ時間を測り、候補のうちその 1.4 倍が収まるいちばん短い長さを選びます。長さを変えながら同じセッションで測ると、DirectML では2つ目の長さから1ブロックが 190〜300 ms かかりました（新しいセッションでは 41 ms）。そのため、DirectML で 40 ms 以外を選んだときはネットワークを読み直します（約 3 秒）。CUDA ではこうならなかったので読み直しません。ノート PC で選ばれた長さは、CUDA が 80 ms（`ready` まで 5.4 秒）、DirectML が 60 ms か 80 ms（約 10 秒）でした。DirectML の 40 ms の時間（41〜45 ms）が、60 ms を選ぶ境目（約 43 ms）をまたぐためです。端から端までの遅れの p50 は、CUDA で 229.5 ms、DirectML で 231.5 ms でした（各 10 回、どちらも 80 ms が選ばれた回）。

実装の PR（#806）の判断項目は、次のとおり決まりました（2026-11-20）。

- 選んだ長さは、声のモデルと GPU の組み合わせごとに覚え、次からは測り直しません。worker が `<state>/vc_runtimes/rvc-block-lengths.json` に記録します。DirectML で 40 ms 以外を選んだときの読み直し（`ready` まで約 10 秒）は、最初の1回だけになります。
- 開発中のビルドで `RVC_BLOCK_MS` に保存した長さは、利用者が選んだ長さとして扱います（自動にはしません）。

残っていた2件は、次のとおり決まりました（2026-11-21）。

- 出力の規則（判断項目5）は、いまの規則（100 ms のバッファがいっぱいになってから再生する）のままにします。余裕を詰めても縮むのは差の一部だけで、会話の途中で音が落ちるのを避けることを優先しました。実装は変えません。材料は[VB-Cable での出力の規則の差](#vb-cable-での出力の規則の差判断項目5の材料)にあります。
- 記録した長さの測り直しは、利用者が「高度な設定」で「自動」を選び直したときに行います。そのとき覚えた長さは使わず、次に変換を始めるときに、その声のモデルと GPU の組み合わせで GPU を測り直します。新しいボタンは足しません。

判断項目6（クロスフェードの上限）は、次のとおり決まりました（2026-11-27、#928）。

- クロスフェードの上限を 20 ms にします。10 ms の上限は採りません。worker の GPU の並び（CUDA と DirectML）では、クロスフェードをブロックの半分にし、20 ms を超えないようにします。80 ms のブロックでは、クロスフェードと探索の分の遅れが 50 ms から 30 ms になります。標本化周波数の変換も含む `ready` の `latency_ms` は、52 ms から 32 ms になります。40 ms 以下のブロックは変わりません。ブロックの半分がもともと 20 ms 以下だからです。
- 20 ms のブロックは、クロスフェードがブロックの半分の 10 ms のままです。下の聴き比べで途切れて聞こえた長さです。20 ms は自動の候補（40 ms から）に入っていないので、利用者が「高度な設定」で選んだときだけ使われます。

決定の根拠は聴き比べです。Windows の音声合成（Microsoft Haruka Desktop）で読ませた日本語（18.8 秒）を、カタログの Saisho Utane（RVC v2、48 kHz、インデックスなし、ピッチ変更 0）で変換しました。変換は worker と同じ並び（探索 10 ms、左の文脈 2 秒、入力のハイパスあり）で行い、クロスフェードだけを変えました。変換した6ファイルを聴き比べています（[音声の用意](https://github.com/kein5/astarot/issues/928#issuecomment-7064024933)、[結果](https://github.com/kein5/astarot/issues/928#issuecomment-7208151039)）。つなぎ目が途切れるかは、ブロックの大きさではなくクロスフェードの長さで決まっていました。10 ms のものは全部途切れて聞こえ、20 ms 以上は問題ありませんでした。

| ブロック | クロスフェード | 結果 |
|---|---|---|
| 20 ms | 10 ms（ブロックの半分） | つなぎ目が途切れて聞きづらい |
| 40 ms | 10 ms | つなぎ目が途切れて聞きづらい |
| 40 ms | 20 ms（ブロックの半分） | 問題なし |
| 80 ms | 10 ms | つなぎ目が途切れて聞きづらい |
| 80 ms | 20 ms | 問題なし |
| 80 ms | 40 ms（ブロックの半分。この決定の前の形） | 問題なし |

ブロックは続けて変換し、実際の速さには合わせていません。そのため、聞こえるのはつなぎ目の音だけで、変換が間に合わないブロックによる途切れは入っていません。

## 結果の要約

- Windows の経路の遅れを、端から端まで測りました（ノート PC、Steam Streaming の仮想デバイス、合成音）。入力の音の立ち上がりから変換した声の立ち上がりまでの p50 は、CUDA の 80 ms のブロックで 222〜240 ms、DirectML の 60 ms で 176〜187 ms でした。
- 遅れは「読み取り＋ブロック＋クロスフェードと探索＋往復＋出力に残っている音」でほぼ説明できます。CUDA の 80 ms では、ブロックが 80 ms、クロスフェードと探索が 50 ms、往復が約 54 ms、出力に残っている音が約 50 ms です。
- 1ブロックの処理時間はブロックを短くしてもほとんど縮みません。このノート PC では CUDA で約 50 ms、DirectML で約 40 ms かかります。そのため既定の 40 ms では処理が追いつかず、遅れたブロックを捨てながら約 250 ms 遅れて鳴ります。デスクトップ PC（RTX 4080 SUPER）では 40 ms に十分間に合います。
- 送る間隔が長いと GPU のクロックが下がり、1ブロックの処理が遅くなります。このノート PC では 120 ms で P3（1,050〜1,185 MHz）、200 ms で P5（最低 555 MHz）まで下がり、200 ms の往復の p95 は続けて処理したときの約2倍になりました。デスクトップ PC で 80 ms の往復の p95 が 40 ms より大きくなったのも、同じ現象と考えています。ブロックを長くしても、余裕が増えるとは限りません。
- 自動調整は「処理が間に合う範囲でいちばん短いブロック」を選び、余裕は送る間隔どおりの往復で測る形を案にしました。動き方としきい値は判断項目です。
- 計測の途中で、Windows の変換が2つ目のブロックで止まる不具合を見つけ、#801 で直しました。

## 計測した PC

- ノート PC: Intel Core i7-1255U、メモリ 32 GB、Windows 11 Home Insider Preview（ビルド 26320）、NVIDIA GeForce RTX 3060 Ti 8 GB（Thunderbolt の外付けケース、PCIe x4）、ドライバー 617.42。ONNX Runtime は CUDA が 1.31.0、DirectML が 1.24.4 です。環境の詳細は [RVC の推論の実行方式の比較](rvc-execution-providers-2026-11-20.md#計測した環境)と同じです。
- モデル: カタログの Saisho Utane（RVC v2、48 kHz）。index は使っていません。
- デスクトップ PC の値は同じ記録の[デスクトップ PC での計測の結果](rvc-execution-providers-2026-11-20.md#デスクトップ-pc-での計測の結果2026-11-20linuxrtx-4080-supercuda)から引きました（Linux、RTX 4080 SUPER、CUDA）。

## 経路と遅れの内訳

### 経路

コード（`native/audio-routing`、`native/voice-conversion`、`native/rvc-runtime`）で確かめた Windows の経路です。

1. マイク: WASAPI の共有モードで、48 kHz モノラルに変換して受け取ります。イベントを使わず、10 ms ごとに読みます（`wasapi/capture.rs`）。エンジンの周期は 10 ms です。
2. ブロック: 20 ms の区切りを集めて1ブロックにします（既定 40 ms）。ブロックの最初の音は、ブロックがそろうまで待ちます。
3. 入力の待ち行列: 4ブロックまでためます。240 ms より古いブロックは worker に送らずに捨て、6 秒のうち半分を超えて捨てると `vc_capture_overrun` で止めます。
4. worker: 一度に1ブロックだけ送り、答えを待ちます。worker の中では、クロスフェード（ブロックの半分）と探索（10 ms）の分だけ出力が入力より遅れます。48 kHz と 16 kHz の変換で約 2 ms 加わります（`ready` の `latency_ms`）。
5. 出力の待ち行列: 4ブロックまでためます。
6. 出力: WASAPI の共有モードで、100 ms のバッファがいっぱいになってから再生を始めます（`wasapi/output.rs`）。そのあとは空いた分だけ 5 ms ごとに書き足します。

### 端から端までの計測

`native/voice-conversion/examples/vc_path_latency.rs` で測りました。アプリと同じ変換の持ち主（`VcProcess` と `DeviceRoute`）、worker、WASAPI の出力を使い、マイクの代わりに仮想デバイスの Loopback を使います。

- 合成した音（180 Hz の倍音の音、400 ms）を 2 秒おきに 15 回、Steam Streaming Microphone の出力に流します。その Loopback を、アプリのマイクと同じく 10 ms ごとに読んで変換します。変換した声は Steam Streaming Speakers に出します。
- 2つのデバイスの Loopback を、オーディオエンジンの時刻つきで記録します。入力の音の立ち上がりから、変換した声の立ち上がり（5 ms の RMS が最大の 1/10 に届いた所）までを測ります。包絡の相互相関で求めた遅れも記録した回（2巡目の 10 回と、例の確認の 1 回）では、立ち上がりの遅れとの差はどれも 3.2 ms 以内でした。
- 実際のマイクとスピーカーは使っていません。音とテキストは保存していません。
- `margin:0` は比べるための試作の出力です。バッファがいっぱいになるのを待たず、届いた音をすぐ書きます。`full:100` はアプリの出力と同じ規則を試作の側でなぞったもので、ブロックを書くたびにバッファの残りを記録します。

| 方式 | ブロック | 出力 | 立ち上がりの遅れ p50（回ごと） | 往復（`round_trip_ms`） | 回数 |
|---|---|---|---|---|---|
| CUDA | 80 ms | アプリの出力 | 222.5〜239.8 ms | 53〜54 ms | 5 |
| CUDA | 80 ms | `margin:0` | 209.0〜225.5 ms | 53〜54 ms | 4 |
| CUDA | 80 ms | `full:100` | 233.2〜249.8 ms | 53〜55 ms | 2 |
| DirectML | 80 ms | アプリの出力 | 226.8〜241.5 ms | 58 ms | 3 |
| DirectML | 80 ms | `margin:0` | 199.7 ms | — | 1 |
| DirectML | 60 ms | アプリの出力 | 176.1〜187.2 ms | 49 ms | 2 |
| DirectML | 60 ms | `margin:0` | 164.6 ms | 50 ms | 1 |
| CUDA | 120 ms | アプリの出力 | 272.1〜283.3 ms | 66 ms | 2 |
| CUDA | 40 ms | アプリの出力 | 251.7〜256.9 ms | 49 ms | 2 |
| DirectML | 40 ms | アプリの出力 | 264.8 ms | — | 1 |

- 往復は終わる時点の `round_trip_ms` です。1巡目の 12 回は記録していません。
- 各回の中のばらつき（最小と最大の差）は、間に合う 60 ms と 80 ms で 10〜25 ms、120 ms で 20〜36 ms、間に合わない 40 ms で 55〜114 ms でした。
- 40 ms では、どちらの方式も処理が追いつきません。ブロックは待ち行列にたまり、240 ms より古くなると捨てられます。測った 30 秒のあいだに変換は止まりませんでしたが、捨てたブロックの分だけ音が欠けます。

### 内訳

CUDA の 80 ms、アプリの出力の例です。

| 段 | 遅れ | 求め方 |
|---|---|---|
| マイクの読み取り | 0〜10 ms | 10 ms ごとに読む（コード） |
| ブロック | 80 ms | ブロックの長さ |
| クロスフェードと探索 | 50 ms | 40 ms と 10 ms（コード） |
| 標本化周波数の変換 | 約 2 ms | worker の `latency_ms` から |
| 往復 | 約 54 ms | `round_trip_ms` |
| 出力に残っている音 | 約 50 ms | `full:100` で出力の残りを測った値（下） |
| 合計 | 約 240 ms | 実測は 222〜240 ms |

- 出力の遅れは新しいブロックを書く時点でバッファに残っている音の長さです。アプリと同じ規則の試作（`full:100`）で測ると、その p50 は 50〜70 ms でした。`margin:0` では 20〜30 ms です。どちらも遅れて届いたブロックで一度空になると、その遅れの分だけ残りが増えます。
- 出力の規則による差（同じ組で続けて測った、アプリの出力と `margin:0` の差）は、CUDA の 80 ms で 6〜18 ms（4組）、DirectML の 60 ms で 23 ms、80 ms で 42 ms（1組ずつ）でした。100 ms のバッファから考えた値（最大 80 ms 程度）より小さめです。コードの注記にあるとおり、Steam Streaming のデバイスは 30 ms ずつ読み、再生の直後に2回続けて読むので、100 ms のうち実際に残る分が少ないためと考えています。10 ms ずつ読むデバイス（VB-Cable など）では、残る分がもっと多いはずです。こちらは測っていません。
- マイクは測っていません。実際のマイクの読み取りは Loopback と同じく 10 ms ごとなので、差は数 ms と見込んでいます。

### VB-Cable での出力の規則の差（判断項目5の材料）

判断項目5（出力の規則）を決める材料として、出力を VB-Cable（VB-CABLE Driver Pack46 の「CABLE Input」）にして同じ方法で測りました。入力はこれまでと同じ Steam Streaming Microphone の Loopback で、各回 15 回の音です。VB-Cable のエンジンの周期は 10 ms で、共有モードの最短は 2.67 ms でした。

| 方式 | ブロック | アプリの出力 | `full:100` | `margin:0` |
|---|---|---|---|---|
| CUDA | 80 ms | 322〜349 ms（2回） | 333〜337 ms（2回） | 293〜307 ms（3回） |
| DirectML | 60 ms | 277 ms | 301 ms | 261 ms |
| DirectML | 80 ms | 342 ms | — | 303 ms |

- 続けて測った組で、アプリの出力と `margin:0` の差は、CUDA の 80 ms で 15 ms と 50 ms、DirectML の 80 ms で 39 ms、60 ms で 16 ms でした。`full:100` と `margin:0` の差は 34〜44 ms です。Steam Streaming のデバイス（6〜42 ms）より少し大きく、回ごとのぶれも大きめでした。
- 書くときにバッファに残っていた音は、`full:100` で p50 60〜70 ms、`margin:0` で 20〜30 ms でした。
- `margin:0` は 30 秒のうちに 13〜22 回空になりました。そのたびに音が短く途切れます。余裕をまったく置かない規則は使えず、実際に選ぶなら 20〜30 ms ほどの余裕を置く形になります。その場合に縮むのは、上の差より小さい見込みです。
- `margin:0` 同士で比べると、VB-Cable は Steam Streaming のデバイスより 70〜85 ms 遅くなりました。VB-Cable が自分のバッファに持つ分と考えています。出力の規則で縮められる分より大きい値です。VB-Cable の設定（Max Latency）で変わるはずですが、設定を変えての計測はしていません。

## ブロックの長さと処理時間

`tools/rvc_worker_bench.py --gpu-clocks` と同じ方法で、worker にブロックの長さを変えて送りました（各 200 パケット、最初の 10 を除く 190 を集計、1回ずつ）。「送る間隔どおり」はマイクと同じ間隔で送ったときの往復、「続けて」は答えが来たらすぐ次を送ったときの1パケットの時間です。GPU の状態は送る間隔どおりのときに `nvidia-smi` で 100 ms ごとに読んだものです。続けて送ったときは、どのブロックでも最大のクロック（1,935〜1,950 MHz）のままでした。

### CUDA（ノート PC）

| ブロック | 送る間隔どおり p50 / p95 | 続けて p50 / p95 | ブロックの長さを超えた数 | GPU の状態とクロック |
|---|---|---|---|---|
| 20 ms | 284.8 / 327.3 ms | 48.2 / 63.8 ms | 190 / 190 | P2、1,950 MHz |
| 40 ms | 275.9 / 315.3 ms | 50.1 / 63.9 ms | 190 / 190 | P2、1,950 MHz |
| 60 ms | 52.6 / 64.7 ms | 52.0 / 63.9 ms | 30 / 190 | P2、1,935 MHz |
| 80 ms | 55.1 / 68.2 ms | 55.8 / 69.1 ms | 0 / 190 | P2、1,950 MHz |
| 120 ms | 64.2 / 74.2 ms | 57.5 / 71.3 ms | 0 / 190 | P3、1,185 MHz |
| 200 ms | 75.8 / 137.6 ms | 58.0 / 69.7 ms | 0 / 190 | P3 と P5、840 MHz（最低 555 MHz） |

### DirectML（ノート PC）

| ブロック | 送る間隔どおり p50 / p95 | 続けて p50 / p95 | ブロックの長さを超えた数 | GPU の状態とクロック |
|---|---|---|---|---|
| 20 ms | 227.3 / 280.5 ms | 38.3 / 49.3 ms | 190 / 190 | P0、1,935 MHz |
| 40 ms | 229.9 / 287.5 ms | 43.1 / 52.7 ms | 190 / 190 | P0、1,935 MHz |
| 60 ms | 52.0 / 58.6 ms | 41.1 / 50.8 ms | 4 / 190 | P0、1,590 MHz |
| 80 ms | 55.8 / 66.6 ms | 46.7 / 55.5 ms | 0 / 190 | P0、1,410 MHz |
| 120 ms | 71.0 / 83.4 ms | 46.4 / 62.0 ms | 0 / 190 | P3、1,050 MHz |
| 200 ms | 85.1 / 133.2 ms | 52.6 / 62.9 ms | 0 / 190 | P3 と P5、1,140 MHz（最低 675 MHz） |

- 20 ms と 40 ms を送る間隔どおりに送ると、答えが遅れていき、往復は待ち行列の時間を含みます。処理そのものの時間ではありません。
- 続けて送ったときの1パケットの時間は、20 ms から 200 ms まででも CUDA で 48〜58 ms、DirectML で 38〜53 ms でした。特徴抽出（HuBERT）が毎回、2 秒の文脈を含む窓の全体を読むためです（[音声パイプラインの遅延](pipeline-latency-2026-11-18.md#声の変換rvc531)の rvc-stream の計測と同じ傾向です）。
- 間に合う最短のブロックは、この PC では CUDA が 80 ms、DirectML が 60 ms です。DirectML の 60 ms は、190 のうち 4 がブロックの長さを超えました。
- GPU が休む時間が長いほど、クロックが下がります。DirectML では 60 ms からクロックが下がり始め、120 ms では送る間隔どおりの p50 が続けたときより 25 ms 長くなりました。
- デスクトップ PC（RTX 4080 SUPER）の CUDA では、1パケットの処理が 11〜15 ms です。往復の p95 は 40 ms で 18.1〜20.1 ms、80 ms で 45.1〜46.6 ms で、80 ms のときクロックが P3〜P5 に下がっていました。デスクトップ PC では 20 ms を送る間隔どおりに測っていません。

## 計測の途中で見つけた不具合（#801）

この経路の計測を始めると、変換が2つ目のブロックで `vc_block_expired` を出して止まりました。持ち主はブロックの時刻を最初の 20 ms の区切りが届いた時刻から決めていたので、最初の区切りが遅れて届き、次の区切りがすぐに届くと、ブロックの終わりが未来の時刻になっていました（今回は 8.4 ms 先）。10 ms ごとに読む WASAPI ではよく起きます。#801 で、ブロックの終わりが最後の区切りの届いた時刻より後にならないようにしました。上の計測はどれも #801 の修正のあとの値です。

## 設計案

### チャンク長の自動調整

測った結果から、次の3点を前提にします。

1. 1ブロックの処理時間はブロックの長さでほとんど変わりません。ブロックを短くできる下限は、その PC の処理時間で決まります。
2. 余裕は送る間隔どおりの往復で測ります。続けて処理した時間は GPU のクロックが下がる分を含みません。ノート PC の DirectML の 120 ms では、続けたときの p50 が 46 ms、送る間隔どおりでは 71 ms でした。
3. ブロックを長くすれば、GPU が休む時間も長くなり、クロックが下がります。長くしたときの余裕は長くしたあとで測り直すまで分かりません。ブロックを長くすると遅れも同じだけ増えるので、間に合う範囲でいちばん短いブロックを選びます。短いブロックは GPU を休ませないので、クロックも保たれます。

これをもとに、次の2段の案を示します。

#### 起動時に選ぶ（案A）

worker が読み込みの最後に GPU でも数ブロックを続けて変換し、その時間から最初のブロックを選びます（CPU の速さの確認 `cpu_block_time` と同じ仕組みです）。たとえば「続けたときの時間 × 1.4 がブロックの長さ以下になる、いちばん短い候補」とします。ノート PC では CUDA が 80 ms（55.8 × 1.4 = 78）、DirectML が 60 ms（41.1 × 1.4 = 58）です。デスクトップ PC は 1パケットが 11〜15 ms なので、候補を 40 ms 以上とすれば 40 ms です。1.4 は仮の値で、ノート PC の 60 ms と 80 ms で、送る間隔どおりの p95 が続けたときの p50 の 1.2〜1.4 倍だったことによります。いまは持ち主がブロックの長さを決めて worker に渡し、`ready` で同じ長さかを確かめています。worker が選ぶなら、`ready` で選んだ長さを返し、持ち主がそれに合わせる変更が要ります。

#### 変換中に合わせる（案B）

持ち主は直近 6 秒の往復をすでに記録しています（`round_trip_ms`）。次のようにブロックを1段ずつ変えます。

- 長くする: 往復の p95 がブロックの 0.8 倍を超えたとき、またはブロックの長さを超えた往復が 6 秒のうち 1 % を超えたとき。
- 短くする: 往復の p95 が1段短いブロックの 0.6 倍を下回る状態が 30 秒続いたとき。ただし、その長さで最近間に合わなかったときは戻しません。
- 変えるのは 30 秒に1回までにします。長くしたあとに GPU のクロックが下がり、往復が延びて、また長くする、を繰り返さないためです。

ブロックの長さを変えるには、worker の中でストリームを組み直す必要があります。モデルは読み込んだまま使えますが、文脈とクロスフェードは空から始まるので、変えたときに1ブロックほど音が途切れます。worker を起動し直すと、`ready` まで 5 秒ほど変換が止まります（ノート PC の値）。VRChat などほかのアプリが GPU を使うと往復が変わります。案B はその変化に合わせてブロックを変えるためのものです。VRChat を動かしながらの計測は、まだしていません。

### 出力のバッファ

いまは 100 ms のバッファがいっぱいになってから再生を始めます。代わりに「最初のブロックの前に決まった長さの無音を置いて、すぐ再生する」規則にすると、残っている音を往復のばらつきに合わせた長さにできます。遅れて届いたブロックで空になったら、残す長さはその分だけ自然に増えます。減らすには、静かなブロックで数 ms ずつ詰める処理が要ります。

Steam Streaming のデバイスで測った差は 6〜18 ms でした。10 ms ずつ読むデバイスでは、もっと大きくなる見込みです。決める前に、VRChat の入力に使われる仮想ケーブル（VB-Cable など）で測る必要があります。

### 音声の入出力

- マイクの読み取りを、10 ms ごとの読み取りからイベント（`AUDCLNT_STREAMFLAGS_EVENTCALLBACK`）に変えると、平均で約 5 ms 縮みます。
- `IAudioClient3` を使うと、ドライバーが対応していればエンジンの周期を 10 ms より短くできます。このノート PC の内蔵スピーカーは最短 5.33 ms、Steam Streaming のデバイスは 10 ms だけでした（出力のデバイスで確認。マイクは開いていません）。縮むのは片側で数 ms です。
- 排他モードは、ほかのアプリがそのデバイスを使えなくなります。マイクを Discord などと共有できなくなり、出力の仮想ケーブルも占有します。既定にはしない案です。
- ASIO: Steinberg の ASIO SDK は、2025年10月から GPLv3 と、これまでの独自ライセンスの二重ライセンスになりました（[KVR Audio の記事](https://www.kvraudio.com/news/steinberg-moves-vst-3-sdk-to-mit-open-source-license-asio-now-gplv3-65179)、[SDK のリポジトリ](https://github.com/audiosdk/asio)）。このアプリは MIT なので、GPLv3 で使うと配布物全体を GPLv3 で出すことになります。独自ライセンスは無償ですが、Steinberg との契約が要り、SDK を公開のリポジトリに置けません。ASIO の恩恵があるのは、ASIO のドライバーを持つオーディオインターフェースのマイクです。VRChat への出力は WASAPI の仮想ケーブルのままなので、縮むのは入力の側の数 ms です。いまは対応しない案です。

### GPU 上で完結させる余地

ノート PC の DirectML、80 ms では、3つのグラフ（HuBERT、RMVPE、合成器）の時間の和が 35.8 ms でした（[グラフだけの比較](rvc-execution-providers-2026-11-20.md#グラフだけの比較)の p50 の和）。worker の1パケットは続けて 46.7 ms なので、グラフの外に約 11 ms あります。グラフの外では標本化周波数の変換、特徴の補間、クロスフェード、パイプの読み書き、CPU と GPU のあいだのコピーをしています。コピーする量は1ブロックで 1 MB 程度なので、PCIe 3.0 x4 でも 1 ms 未満と見積もりました（計算による見積もりで、プロファイルは取っていません）。IO バインディングで GPU 上に置いたままにしても、縮むのは数 ms までと考えています。先に、グラフの外の CPU の処理をプロファイルする方がよさそうです。

### クロスフェード

いまは位相を合わせたクロスフェード（SOLA、sin の2乗の重み）で、長さはブロックの半分、探索は 10 ms です。クロスフェードと探索の長さだけ出力が遅れるので、80 ms のブロックでは 50 ms になります。クロスフェードに上限（たとえば 20 ms）を設けると、60〜120 ms のブロックで 10〜40 ms 縮みます。短いクロスフェードと短いブロックで音が途切れないかは、聞いて確かめる必要があります。とくに音の高さ（RMVPE）は、ブロックに 50 ms を足した長さしか見ないので、短いブロックで揺れやすくなるおそれがあります。音質は今回測っていません。

> **追記**（2026-11-27、#928）：聴き比べのあと、クロスフェードの上限は 20 ms に決まりました。[決まったこと](#決まったこと2026-11-20)にあります。

## 判断項目

1. 自動調整の範囲: 案A（起動時に選ぶ）だけにするか、案B（変換中に合わせる）も入れるか。推奨は、まず案A を入れ、VRChat を動かしながら往復を測ってから案B を決めることです。
2. 起動時の選び方: 候補のブロック（たとえば 40、60、80、100、120、160、200 ms）、係数（仮に 1.4）、選ぶのを worker と持ち主のどちらにするか。worker が選ぶ場合は、`ready` で長さを返すように worker と持ち主のあいだの取り決めを変えます。
3. 変換中のしきい値: 長くする条件（p95 がブロックの 0.8 倍超、またはブロック超えが 1 % 超）、短くする条件（1段短いブロックの 0.6 倍未満が 30 秒）、変える間隔（30 秒に1回まで）、変えるときに1ブロックほど音が途切れることを受け入れるか。
4. 手動の設定との関係: 「高度な設定」のブロックの長さ（`RVC_BLOCK_MS`、既定 40 ms）に「自動」を足して既定にするか。このノート PC では、既定の 40 ms だとブロックを捨てながら約 250 ms 遅れます。利用者が選んだ長さは、自動より優先する案です。
5. 出力の規則: 100 ms がいっぱいになってから再生する規則を、無音の余裕を置いてすぐ再生する規則に変えるか。決める前に、VB-Cable などで差を測ります。
6. クロスフェードの上限: ブロックの半分のままにするか、上限（たとえば 20 ms）を設けるか。合成した声（Windows の音声合成など）で、20、40、80 ms のブロックと上限ありなしを聞き比べてから決める案です。
7. ASIO: 対応しない（推奨）、GPLv3 で対応する、独自ライセンスで対応する、のどれにするか。
8. 0.6.0 での出し方: 自動調整を実験的機能として出すか、既定にするか。

## 計測しなかったこと

- 実際のマイク、VB-Cable などの仮想ケーブル、VRChat の中での遅れ。
- VRChat を動かしながら（GPU を取り合うとき）の往復。
- デスクトップ PC での端から端までの遅れと、20 ms のブロック。AMD と Intel の GPU。
- 音質（短いブロック、短いクロスフェード）。
- worker のグラフの外の処理のプロファイル。

## 続けて測るには

端から端までの遅れ（Windows）は、次のように測ります。2つの仮想デバイスには、音の出ないものを選びます。

```sh
cargo run --release --manifest-path native/voice-conversion/Cargo.toml --example vc_path_latency -- \
    --worker <astarot-rvc-worker.exe> --runtime <state>/vc_runtimes/rvc \
    --directml <state>/vc_runtimes/onnxruntime-directml/lib --model <voice.pth> \
    --device cuda --block-ms 80 --output app --bursts 15
```

`--output full:100` はアプリと同じ規則で出力の残りを記録し、`--output margin:0` は待たずに書く試作を使います。

ブロックの長さと GPU のクロック（NVIDIA）は、次のように測ります。

```sh
python tools/rvc_worker_bench.py --worker <astarot-rvc-worker> --runtime <state>/vc_runtimes/rvc \
    --model <voice.pth> --devices cuda --block-ms 20,40,60,80,120,200 --packets 200 --rounds 1 --gpu-clocks
```
