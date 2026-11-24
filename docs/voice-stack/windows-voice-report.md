# Windows voice verification record (2026-11-07)

[日本語版](#windows音声の検証記録--2026-11-07日本語版)

This is a record of running TTS, the bundled speech.cpp server, realtime captions, RVC, Seed-VC, input passthrough and the VR overlay on Windows. The steps are in [Windows voice features](local-setup-windows.md).

## Environment

| Item | Details |
|---|---|
| OS | Windows 11 build 26220 |
| CPU | Intel Core i7-1255U (2 performance cores, 8 efficiency cores, 12 logical cores). Power plan: High performance |
| GPU | The integrated Intel Iris Xe (Vulkan0 in speech.cpp) and an NVIDIA GeForce RTX 3060 Ti 8 GB connected over Thunderbolt (Vulkan1, driver 621.14) |
| speech.cpp | 0.10.0 windows-x64-vulkan (SHA-256 of `speech.exe`: `fa787d70…981b7`) |
| Torch | 2.11.0+cu128, Python 3.12.14 |
| Models | Irodori-TTS Q8_0, Qwen3-ASR 0.6B Q8_0, Silero VAD v6.2, Saisho Utane RVC v2, HuBERT, RMVPE. All verified against pinned versions and SHA-256 |

On this PC, both `auto` and `gpu` in speech.cpp choose the Iris Xe (Vulkan0). Unless stated otherwise, the TTS and bundled ASR results are values from this integrated GPU. RVC and Seed-VC run on the RTX with CUDA.

The checks with a real microphone are collected in the "Real microphone" section. The other tests did not use a real microphone or speakers. Audio was written to Steam's silent virtual output and read back through WASAPI loopback. In the RVC tests, the loopback was fed to the input in place of the virtual microphone, which could not be opened. Only the part that opens the input device is specific to the tests.

With the user's permission, a test with the built-in microphones was attempted, but `IAudioClient::Initialize` returned `E_ACCESSDENIED` for all three and none of them could be opened (the same with MME and DirectSound). Steam's virtual microphone failing to open was the same problem.

The cause was the per-app microphone permission for desktop apps in this PC's Insider Beta build 26220. Even with the Windows-wide setting set to allow, programs are treated differently, as follows.

| Program that opened the device | Result |
|---|---|
| `powershell.exe`, which comes with Windows and is signed | Succeeds without a prompt |
| An unsigned exe, the first time | The `PickerHost.exe` prompt appears, and the call waits until it is answered. Without version information, the name is blank: "Allow   to access your microphone?" |
| The same exe, the second time (it exited without the first prompt being answered) | `E_ACCESSDENIED` without a prompt. The same 30 minutes later |
| An exe with the same content copied to another location | The prompt appears again |
| An exe while the firewall prompt is open | `E_ACCESSDENIED` without a prompt. Once that is answered, the prompt appears, and no refusal is left behind |
| An unsigned exe with a `FileDescription` | The name appears: "Allow VRCT-VOX Probe to access your microphone?" |

Both `python.exe` and the packaged sidecar had been refused, because their first prompts were not answered. The record does not appear in the `ConsentStore\microphone\NonPackaged` list. Version information was added to the sidecar so that the prompt shows the VRCT-VOX name. Whether permission can be granted again from the settings screen has not been checked.

While the prompt is waiting, the thread that opens the device keeps holding PortAudio's shared lock. So operations in the same process that use PortAudio (refreshing the device list, switching automatic selection, starting and stopping the classic recording path) wait until the prompt is answered. The wait is up to 120 seconds for RVC and realtime captions, and until the answer for the classic recording path. The classic recording path gives up starting after 8 seconds and puts the reason in the message log. For the microphone, it tells the user to answer the prompt on the desktop. The prompt stays open. With the real microphone, it was confirmed that the device opens after a restart once permission is granted. Retrying only the start, without a restart, has not been checked. This lock serializes PortAudio's initialization and termination (table below). Removing it could bring back the crash during startup, so it has not been changed.

## Results

The whole sidecar was driven over the stdio IPC.

| Check | Result |
|---|---|
| Starting the bundled server with the TTS switch | 7.3 seconds. `speech.exe` ran on Vulkan0 |
| First sound of speech | 1.2 seconds after sending |
| Recognizing the same audio with the bundled ASR | "今日はとてもいい天気ですね。一緒に散歩に行きましょう。" ("The weather is very nice today. Let us go for a walk together.") |
| RVC conversion (retrieval blend 0) | 25.1 seconds of output for 25.0 seconds of input. No errors |
| RVC conversion (retrieval blend 0.5, a runtime prepared by the app, a path containing Japanese) | 8.46 seconds of output for 8.4 seconds of input. Peak while muted 1/32767, stopped in 0.12 seconds |
| Seed-VC conversion (same conditions) | Preparation took 33 seconds. 8.52 seconds of output for 8.4 seconds of input. Peak while muted 1/32767, stopped in 0.09 seconds |
| Recognizing the converted audio with the bundled ASR (Seed-VC) | The original sentence was recognized correctly |
| Recognizing the converted audio with the bundled ASR | The original sentence was recognized correctly |
| From the start of speaking to the start of the converted audio | 214 ms and 448 ms (two measurements through the loopback, with a wide spread) |
| Muting during conversion | Peak 1/32767 (within the audio engine's rounding). Conversion continues |
| Unmuting | The audio comes back |
| Stopping RVC | 0.22 seconds |
| Input passthrough | Correlation of 1.000 with the original audio |

In the real app (Tauri, WebView2), real mouse and key input was sent through the debug port.

| Check | Result |
|---|---|
| Resending with a long press | The message is resent, and the draft being typed is kept |
| A normal click | Starts editing |
| Recording and registering Ctrl+Space | Saved as "Ctrl + Space" and registered as an OS global shortcut |
| The width breakpoint at 125% and 150% scaling | Switches at 800 CSS px |
| The Windows voice page | Does not show the managed route, and RVC asks for an output device |

The following was also confirmed with the frozen sidecar (PyInstaller), over the same IPC.

| Check | Result |
|---|---|
| Package check | Passes `check_voice_distribution.py` |
| Startup | 3.5 seconds |
| TTS and ASR | Pass with the same steps as above |
| The router and the RVC worker | Start in the packaged form, finish loading Torch and get as far as just before audio input. The rest is not checked, because this PC has no input it can open |
| RVC and Seed-VC started from the packaged `voice_worker` | Converted audio sent through the real pipe. See the continuous run table below |
| License documents | Files for 128 packages in `_internal/licenses/python/`, including the LGPL of `soxr` and the COPYING of `zeroconf` |

The installer was compiled with `tauri build`. No real installation was done. It was confirmed that the same combination of `nsExec` and `tar` as the installer's works from a small NSIS script in a folder outside the ANSI code page.

## Bugs found only on real hardware

| Symptom | Cause | Fix |
|---|---|---|
| A 440 Hz tone breaks up into about 840 Hz | PortAudio's WASAPI mono playback | Pass stereo |
| The second audio device cannot start | PortAudio initializes COM only on the first thread | Initialize it on the thread that opens the device |
| The sidecar crashes with an access violation during startup | PortAudio's initialization and termination are not thread-safe | Serialize them with a shared lock |
| RVC stops after a few seconds | A PortAudio write blocks for the length of the audio | Move writing to a separate thread |
| One RVC block takes 150 ms | A process without a window is moved to the efficiency cores | Exclude it from power throttling |
| The packaged RVC worker exits immediately | The Python 3.11 extension modules in `_internal` hide the worker's Python 3.12 standard library | Run the worker in a separate folder |
| The RVC retrieval blend cannot start with a Japanese user name | faiss opens the file with the narrow-character C runtime | Read it in Python and pass it to faiss |
| The Seed-VC worker crashes at the end of an utterance | The fade-out of the voice just before stays in a silent block, and the protocol rejects silence that is not zero | Report that block as converted. Linux has the same path |
| An unrelated error appears when the microphone cannot be opened | In the handling of the start timeout, an exception from the late cleanup overwrites the reason | Report the timeout |

## Conversion speed

This is the processing time per block (80 ms). It was measured by converting audio data continuously. The GPU was connected over Thunderbolt (PCIe 3.0 x4), and waiting for kernel launches took most of the processing time. Turning on upstream's CUDA Graph removes this wait.

| Condition | Mean | p95 |
|---|---:|---:|
| RVC, no CUDA Graph, retrieval blend 0 | 70 ms | 90 ms |
| RVC, no CUDA Graph, retrieval blend 0.5 | 94 ms | 118 ms |
| RVC, CUDA Graph, retrieval blend 0 | 18 ms | 20 ms |
| RVC, CUDA Graph, retrieval blend 0.5 | 20 ms | 22 ms |
| Seed-VC, no CUDA Graph | 327 ms | 385 ms |
| Seed-VC, CUDA Graph and convolution search | 72 ms | 75 ms |

The faiss search itself took 1 ms. The retrieval blend was slow because the synchronization that waits for its result keeps GPU processing and CPU launches from overlapping.

Seed-VC's upstream has no CUDA Graph, so the adapter (`integrations/seed_vc/graphs.py`) wraps it from outside. `istft` and the sound source generation cannot go into the Graph, so they run as they are. The convolution search raises the peak of allocated memory to about 5.5 GB, but only during preparation. In steady operation it is about 1 GB.

RVC's CUDA Graph adds 130 MiB of VRAM allocation at capture, and takes about 0.9 seconds at the start.

### Checking that the voice does not change

The same audio was converted, and the spectral correlations were compared. RVC uses noise, so even two runs of the same path do not match.

| Comparison | RVC | Seed-VC |
|---|---:|---:|
| Without Graph, two runs | 0.933 | 1.000 (fixed random seed) |
| With Graph, two runs | 0.938 | 0.982 |
| Without Graph against with Graph | 0.935 | 0.951 |

The RVC difference is the same size as the difference between two runs of the same path. The Seed-VC difference is larger than that, but the envelope correlation was 0.99, and the bundled ASR recognized every output as the same sentence.

### Continuous run

The engines were started from the packaged `voice_worker`, and audio was sent in real time through the real pipe. The run was about 67 seconds, 840 blocks.

| Engine | Mean round trip | p95 | Max | Preparation |
|---|---:|---:|---:|---:|
| RVC (retrieval blend 0.5) | 30 ms | 33 ms | 48 ms | 22 s |
| Seed-VC | 74 ms | 79 ms | 85 ms | 34 s |

Neither built up delay. With a 3-second reference voice, Seed-VC's round trip averaged 81 ms and overran its slot, so a measurement at the start lightens the reference to 2 seconds. The margin before `vc_capture_overrun` is small. Running together with VRChat may drop it to an even lighter setting or leave it unable to keep up.

These are figures from this laptop. They do not guarantee the performance on another CPU or GPU.

## Runtime preparation

The app's preparation feature was run with real network transfers into a folder whose path contains Japanese, Hangul and emoji.

| Engine | Time taken | Size when done |
|---|---:|---:|
| RVC | 165 s | 5.48 GB |
| Seed-VC | 251 s | 6.86 GB |

The transfer speed is that of this connection. Both worked through loading `speech.exe`, Python, Torch and CUDA. Only `faiss.read_index` could not open a path outside the code page (table below).

## Checks with SteamVR

The real SteamVR was started with the null driver, and settings and logs were redirected to a temporary folder with `VR_CONFIG_PATH` and `VR_LOG_PATH`. The usual SteamVR settings were not changed.

| Check | Result |
|---|---|
| Sidecar connection and overlay creation | Succeeded |
| Japanese text that was sent can be read as pixels from another OpenVR client | Succeeded |
| 240 consecutive updates | 0 failures, 15.6 seconds |
| Rendering and error output after the updates | Rendering continued, no errors |
| The real app's VR UI (window capture and an OpenGL texture) | The launcher button reaches the overlay's pixels |

After the tests, the hashes of `steamvr.vrsettings` and `openvrpaths.vrpath` were confirmed to be unchanged.

## Long runs

The sidecar at commit `412ffc26` ran for 30 minutes from the development environment's `.venv` (2026-11-08). English speech was played to Steam's silent virtual output every 12 seconds and read from the WASAPI loopback through the path that captions the other person's voice. Recognition was Whisper tiny and translation was m2m100_418M (CTranslate2, int8), both on the CPU. A message was sent to the chatbox every 60 seconds, and the VR subtitle overlay was also on. SteamVR was a fake runtime. A test hook kept the microphone from opening.

| Check | Result |
|---|---|
| Recognizing utterances | All 150 utterances were recognized. One utterance was sometimes split in two, giving 222 results |
| Translation | All 222 have a translation |
| Sending to the chatbox | All 29 got a success response |
| From starting the audio to the first recognition result | Median 3.73 seconds, 95th percentile 3.88 seconds |
| Error notifications and tracebacks | 0 |
| VR captions | The image was updated until just before exit. At exit, no overlay was left behind and no call was made in error |
| Attempts to open the microphone | 0 |

| Metric (total of 2 processes) | At start | After 5 min | After 29 min 30 s | Slope after 5 min |
|---|---:|---:|---:|---:|
| Private memory | 3433.5 MB | 3600.2 MB | 3604.8 MB | +0.11 MB per minute |
| Handles | 1379 | 1395 | 1395 | -0.002 per minute |
| Threads | 60 | 60 | 56 | -0.06 per minute |

After 5 minutes, private memory moved up and down between 3599 and 3607 MB, with no sign of steady growth. CPU usage was 21 to 34%, counting one logical core as 100%. This test ran only 30 minutes, and it did not run the microphone, TTS or RVC.

### Running together with VRChat

On 2026-11-09, TTS, RVC, captions, translation, sending to the chatbox and the VR subtitle overlay ran together for 30 minutes while VRChat stayed in a world in desktop mode (`--no-vr`). SteamVR was the real one, started with the null driver. VRChat rendered on the RTX 3060 Ti.

A voice was played every 15 seconds, a message was sent to the chatbox every 60 seconds, and the same sentence was read out with TTS. RVC ran Saisho (retrieval blend 0) on the RTX with CUDA, with the loopback fed to the input as in the test above. Translation was m2m100_418M (int8) on the CPU. A test hook kept the microphone from opening. The number of attempts to open it was 0 in every run.

The speech.cpp device was changed for each condition. When this test ran, the app's settings offered only `auto`, `cpu` and `gpu`, so the RTX (Vulkan1) for B and C was specified with a test hook. Since then, the settings let you choose a GPU by name.

| | A | B | C | D |
|---|---|---|---|---|
| Commit | `9a1bb52d` (before the caption fix) | `5b2c3f9a` | `5b2c3f9a` | `5b2c3f9a` |
| TTS | Iris Xe | RTX | RTX | Iris Xe |
| Captions | Qwen3-ASR, Iris Xe | Qwen3-ASR, RTX | Qwen3-ASR, RTX | Whisper tiny, RTX with CUDA |
| Voices played | Japanese and English | Japanese and English | Japanese and English | English only |
| Utterances recognized | 120/120 | 120/120 | 120/120 | 120/120 |
| Final results | 240 | 240 | 240 | 180 |
| Delay to recognition (median / p95) | 3.99 / 6.64 s | 3.13 / 4.42 s | 3.14 / 4.41 s | 3.83 / 5.09 s |
| TTS | 30/30 | 30/30 | 30/30 | 30/30 |
| Chatbox sends | 30/30 | 30/30 | 30/30 | 30/30 |
| RVC | Ran for 30 min | **Stopped between 690 and 720 s** | Ran for 30 min | Ran for 30 min |
| Tracebacks | 0 | 0 | 0 | 0 |
| RTX VRAM peak | 2284 MB | 6700 MB | 7248 MB | 3148 MB |
| RTX usage | 49 to 75% | 41 to 65% (until the stop) | 42 to 86% | 31 to 83% |
| CPU usage (1 logical core = 100%) | 104 to 144% | 120 to 177% (until the stop) | 90 to 137% | 60 to 100% |
| VRChat FPS (median / p5 / min) | 68.4 / 40.7 / 32.9 | 84.8 / 53.8 / 43.6 | 98.2 / 65.8 / 51.7 | 90.8 / 28.2 / 17.2 |

The delay is the time from starting to play a voice to the first final result for that voice. VRChat's FPS is the value that VRChat writes to its own log every 10 seconds. For about 11 minutes from the start, D dropped to 26 to 30 once a minute. The cause was not investigated. For the chatbox, only the success responses to sends were counted, and whether the messages appeared on VRChat's screen was not checked.

B's RVC stopped with `vc_capture_overrun` (between 12:27:42 and 12:28:12). This is the designed behavior: conversion stops when more than half of the last 75 blocks (6 seconds) are late. Captions, TTS and the chatbox kept working to the end. VRChat's median FPS was 64.6 while RVC was running and 90.9 after it stopped.

In the same time window, at 12:27:51, the world's video player switched to the next song, and FPS dropped to 45.9. But B had not stopped at the three switches before that. In C, a video was opened right after the test started, and after that the log shows no playback start or switch, so VRChat's load was lighter than in B. These two runs alone cannot tell how often it stops or how the stop relates to the video.

In these two runs, with VRChat, TTS, captions and RVC all on the same RTX, RVC did not last 30 minutes in one of them (the results of two more runs with the same configuration are written below the next table). In A, with speech.cpp on the Iris Xe, and in D, with TTS on the Iris Xe and Whisper on CUDA, RVC did not stop in the single run of each.

Two more runs were made with the same configuration, with warm-up during startup in place (`c3646d47`). As in B and C, the RTX for speech.cpp was specified with a test hook.

| | E | F |
|---|---|---|
| Utterances recognized | 120/120 | 120/120 |
| Final results | 240 | 240 |
| Delay to recognition (median / p95) | 3.14 / 4.38 s | 3.12 / 4.38 s |
| TTS | 30/30 | 30/30 |
| Chatbox sends | 30/30 | 30/30 |
| RVC | Ran for 30 min | Ran for 30 min |
| Tracebacks | 0 | 0 |
| RTX VRAM peak | 6087 MB | 5798 MB |
| RTX usage | 49 to 77% | 55 to 74% |
| CPU usage (1 logical core = 100%) | 92 to 160% | 89 to 122% |
| VRChat FPS (median / p5 / min) | 90.5 / 72.1 / 64.7 | 86.7 / 70.7 / 60.4 |
| Times VRChat loaded a video URL | 7 | 10 |

Of the four runs with everything on the RTX (B, C, E and F), RVC stopped only once, in B. E and F loaded videos many times and did not stop, so a video switch alone does not stop it. B and C had no warm-up and E and F had it, but the warm-up runs only during startup and the runs are few, so the difference cannot be put down to the warm-up. Four runs cannot settle how often it stops or why. When RVC stops, the block delay and processing time at that moment are now recorded under `voice conversion stopped` in `process.log`. E and F did not stop, so whether this record helps with a real stop has not been checked yet.

The RTX VRAM values are `nvidia-smi`'s usage for the whole GPU, and include VRChat (1011 MB, measured after the test ended). With speech.cpp on the RTX, the dedicated memory of the TTS process grew from 1494 MB at the start to 2389 MB at the end. It grew in steps and stayed flat after each step. In C, the value rose from 5474 MB to 6368 MB at 90 seconds, briefly reached 7248 MB at 480 seconds, and then stayed between 6371 and 6408 MB until the end. The cause of the steps has not been fully investigated.

| Metric (total of the VRCT-VOX processes) | A | C | D |
|---|---:|---:|---:|
| Private memory (at start) | 11275.8 MB | 11454.3 MB | 10758.1 MB |
| Private memory (after 5 min) | 11494.7 MB | 12726.3 MB | 11220.7 MB |
| Private memory (after 29 min 30 s) | 11512.7 MB | 12765.2 MB | 11238.4 MB |
| Slope after 5 min | +0.62 MB per minute | +1.21 MB per minute | +0.70 MB per minute |
| Handles (start / 5 min / 29 min 30 s) | 4445 / 4651 / 4548 | 4557 / 4667 / 4783 | 3825 / 3899 / 3896 |
| Threads (start / 5 min / 29 min 30 s) | 208 / 203 / 200 | 223 / 229 / 212 | 175 / 182 / 167 |

B is left out of this table because its RVC process ends partway through. The results of running for 2 hours are in the next section.

### 2-hour continuous runs

On 2026-11-09, two 2-hour continuous runs were made from the development environment's `.venv`. TTS and captions (Qwen3-ASR) ran on the RTX 3060 Ti (Vulkan1, specified with a test hook), RVC (Saisho, retrieval blend 0) on the RTX with CUDA, and translation with m2m100_418M (int8) on the CPU. SteamVR was the real one, started with the null driver, and the VR subtitle overlay was on. The first run did not start VRChat. The second ran with VRChat in a world in desktop mode (`--no-vr`). In the second run, VRChat also rendered on the RTX.

A voice was played every 15 seconds, a message was sent to the chatbox every 60 seconds, and the same sentence was read out with TTS. The input was the loopback, and a test hook kept the microphone from opening. The number of attempts to open it was 0.

| | Without VRChat | With VRChat |
|---|---|---|
| Commit | `0fc06552` | `e600dc41` |
| Utterances recognized | 480/480 | 480/480 |
| Final results | 960 | 960 |
| Delay to recognition (median / p95) | 3.09 / 4.33 s | 3.16 / 4.42 s |
| Translation notifications | All 960 | All 960 |
| TTS | 120/120. 0 dropped, 0 errors | 120/120. 0 dropped, 0 errors |
| Chatbox sends | 120/120 (success responses) | 120/120 (success responses) |
| RVC | Ran for 2 hours | Ran for 2 hours |
| RVC state at the end | Conversion confirmed | Conversion confirmed |
| Tracebacks | 0 | 0 |
| RTX VRAM (whole GPU; after 5 min / before the end) | 4779 / 4779 MB | 6045 / 6076 MB (peak 6079 MB) |
| RTX usage | 18 to 67% | 45 to 75% |
| CPU usage (1 logical core = 100%) | 63 to 121% | 99 to 137% |
| VRChat FPS (median / p5 / min) | None | 78.5 / 59.3 / 18.9 |
| Times VRChat loaded a video URL | None | 31 |

| Metric (total of the VRCT-VOX processes; start / 5 min / 119 min 30 s) | Without VRChat | With VRChat |
|---|---:|---:|
| Private memory (MB) | 11565.4 / 12761.2 / 12843.2 | 11564.2 / 13090.1 / 13150.4 |
| Handles | 4586 / 4712 / 4718 | 4593 / 4703 / 4736 |
| Threads | 222 / 229 / 212 | 230 / 232 / 212 |

In the run without VRChat, private memory, as 15-minute averages, grew from 12772 MB at 15 to 30 minutes to 12849 MB at 75 to 90 minutes, and was 12839 MB at 105 to 120 minutes. The slope after 5 minutes is +0.88 MB per minute, but memory did not grow in the last 45 minutes.

In the run with VRChat, it grew slowly from 13095 MB at 15 to 30 minutes to 13134 MB at 105 to 120 minutes. The slope after 5 minutes is +0.44 MB per minute. The RTX VRAM also grew slowly, from 6045 MB to 6076 MB. That value covers the whole GPU including VRChat, so it is not known which process grew. For both increases, it is not known whether they continue beyond 2 hours.

VRChat's FPS, as medians per 15 minutes, was 75.1 to 83.8. The drop to 18.9 happened once, in the 90 to 105 minute window, and the cause was not investigated.

The tests with VRChat, TTS, captions and RVC all on the RTX now number five (B, C, E and F above, and this 2-hour run), about 3 hours 40 minutes in total. RVC stopped only once, in B. A single stop cannot settle the frequency or the cause. This 2-hour run did not stop either, so whether the `voice conversion stopped` record helps with a real stop has not been checked yet.

In both runs, the 480 English results were translated into Japanese. For the 480 Japanese results, the translation target is Japanese, so the same text as the source came back. 160 of the 960 are the fragment "行きましょう。" ("let us go."). The test audio made with TTS (8.4 seconds) has a separate burst of sound from 7.6 seconds to the end, and these results are thought to come from recognizing that part, but this was not confirmed by listening to the audio.

In both runs, two VR subtitle overlays were in the shown state at exit. Reading the image from another client gives `OverlayError_InvalidTexture`, so what they displayed was not checked. In both runs, the only entries in `error.log` were the two failures to connect to LM Studio and Ollama at startup.

### Seed-VC continuous runs

On 2026-11-10, Seed-VC ran in place of RVC with the same steps as the 2-hour test. TTS and captions were on the RTX (Vulkan1), Seed-VC on the RTX with CUDA, and translation on the CPU. VRChat was not started. The reference voice was an 8.4-second WAV made with TTS, and the runtime was in a path containing Japanese, Korean and emoji.

| 30-minute test | Before the fix | After the fix |
|---|---|---|
| Utterances recognized | 120/120 | 120/120 |
| Final results | 240 | 240 |
| Delay to recognition (median / p95) | 3.10 / 4.33 s | 3.08 / 4.31 s |
| TTS | 30/30 | 30/30 |
| Chatbox sends | 30/30 (success responses) | 30/30 (success responses) |
| Seed-VC | Ran for 30 min | Ran for 30 min |
| Tracebacks | 0 | 0 |
| CPU usage (1 logical core = 100%) | 411 to 439% | 112 to 132% |
| RTX usage | 48 to 77% | 48 to 71% |
| RTX VRAM peak (whole GPU) | 5219 MB | 5554 MB |

Before the fix, four threads of the Seed-VC worker each kept using about 94% of a CPU. The backend sets `KMP_BLOCKTIME=0` and `KMP_USE_YIELD=0`, which keep Intel OpenMP threads from spinning while they wait, but these were not passed to the conversion worker. OpenMP spins for 200 ms after work, so with a block arriving every 80 ms it never stops. Passing the two settings to the worker removed the spinning, so this was judged to be the cause, and the worker now gets them too.

The settings were compared with and without in a 3-minute test with the same steps: Seed-VC twice each, alternating, and RVC once each.

| | CPU usage (median) | Round trip (median) | Blocks converted | Most late blocks (last 75 blocks) |
|---|---:|---:|---:|---:|
| Seed-VC, without the settings | 421 / 426% | 78 / 78 ms | 820 / 802 | 14 / 13 |
| Seed-VC, with the settings | 123 / 124% | 63 / 63 ms | 1003 / 996 | 7 / 10 |
| RVC, without the settings | 84% | 31 ms | 2336 | 0 |
| RVC, with the settings | 73% | 31 ms | 2333 | 0 |

The block counts are cumulative from the start of the measurement to the last record.

In the 30 minutes after the fix, 122 of the 362 records taken every 5 seconds had late blocks within the last 75 blocks. The most was 13, which is below the threshold for stopping conversion (38). For each late block, the voice cuts out briefly.

With the same code (`f58b8ddc`), Seed-VC ran for 30 minutes with VRChat in a world in desktop mode (`--no-vr`). VRChat also rendered on the RTX. This is a single test.

| | Without VRChat | With VRChat |
|---|---|---|
| Utterances recognized | 120/120 | 120/120 |
| Final results | 240 | 240 |
| Delay to recognition (median / p95) | 3.08 / 4.31 s | 3.16 / 4.41 s |
| TTS | 30/30 | 30/30 |
| Chatbox sends | 30/30 (success responses) | 30/30 (success responses) |
| Seed-VC | Ran for 30 min | Ran for 30 min |
| Tracebacks | 0 | 0 |
| CPU usage (1 logical core = 100%) | 112 to 132% | 148 to 181% |
| RTX usage | 48 to 71% | 53 to 78% |
| RTX VRAM peak (whole GPU) | 5554 MB | 5906 MB |
| VRChat FPS (median / p5 / min) | None | 76.3 / 61.2 / 52.6 |
| Times VRChat loaded a video URL | None | 7 |
| Round trip (median) | 63 ms | 78 ms |
| Block delay (median of the 5-second medians) | 23 ms | 163 ms |
| Records with late blocks | 122/362 | 258/357 |
| Most late blocks (last 75 blocks) | 13 | 19 |

The run with VRChat did not stop, but the round trip came close to one block's 80 ms, and the median block delay reached 163 ms. Blocks more than 240 ms late are dropped, so the margin is smaller. Many records had late blocks, and the voice should cut out more often than without VRChat. How much of this is actually audible has not been checked.

### First recognition with an empty GPU cache

While preparing the test above, putting captions on the RTX made the captions stop 18.5 seconds after the start, with a notice that the device might have been disconnected. The cause was not the device. The driver cache was empty, and the first recognition on the connection went over the 15-second limit. This was reproduced by giving `speech.exe` an empty cache folder (Vulkan1, together with VRChat).

| Condition | Captions | Time to turn on the TTS switch | Time to start captions |
|---|---|---:|---:|
| Cache present, before the fix | All 10 utterances recognized, both times | 5.3 s | 3.5 s |
| No cache, before the fix | Stopped at 18.4 to 18.5 s, all 3 times | 51 to 93 s | 17.6 to 20.4 s |
| No cache, limit raised to 180 s for investigation | 25.7 s to the first final result. 9 of 10 utterances recognized | | |
| No cache, after the fix (`5b2c3f9a`) | No stop. 29.4 s to the first final result. 9 of 10 utterances recognized | | |

The one utterance that was not recognized has not been investigated. After the fix, the first result on a connection is awaited for up to 120 seconds, and the wait of the utterances queued behind it is counted again. From the second result on, the limit stays at 15 seconds, and there is no automatic reconnection either. On a timeout, a dedicated notice appears instead of the device notice.

With an empty cache, the first TTS sentence failed with `first_audio_timeout`, and speech started from the next sentence. The policy is not to read out old utterances, so this limit was not changed.

Doing the same on the Iris Xe (`auto`) recognized all 10 utterances, with about 5 seconds to the first result, but whether the cache could be emptied on this GPU has not been checked.

### Warm-up during startup

To prevent the two problems above, the bundled server now runs inference once during startup and discards the result. This was measured by starting `speech.exe` directly with an empty cache (RTX, without VRChat).

| First request | Time taken | Next request |
|---|---:|---|
| TTS "あ。" ("Ah.") | 0.08 s | The next ordinary sentence waits 8.0 s (it does not warm up) |
| TTS "こんにちは、今日はよろしくお願いします。" ("Hello, I look forward to working with you today.") | 7.95 s | Three sentences of different lengths took 0.94 s, 0.14 s and 0.09 s |
| ASR, 2 s of noise | 1.53 s | The second request took 0.12 s. Whether it warms up has not been checked |
| ASR, 6 s of noise | 8.33 s | Real speech took 0.08 s |
| ASR, real speech (for comparison) | 7.59 s | 0.09 s |

The whole app ran for 150 seconds on the RTX with an empty cache (without VRChat). Turning on the TTS switch took 41.4 seconds and starting captions took 19.4 seconds. All 10 utterances were recognized, and it took 5.6 seconds from detecting the first utterance to the first final result (29.4 seconds without warm-up). Both TTS requests succeeded.

Warm-up covers only Japanese TTS and ASR running on the GPU. Multilingual TTS gets no warm-up, because which voices it accepts has not been checked. If warm-up fails, only the first request is slower, and the server goes on starting.

## Frozen build of the current code

On 2026-11-09, the code including #172 to #174 (`fa688770`) was frozen, and TTS, captions of the speaker output and the GPU list were checked. All 15 items succeeded, with 0 tracebacks. The GPU list showed both the Iris Xe and the RTX. Tests that open the microphone were left out, so that the microphone prompt would not open while the user was away from the PC.

## Real microphone

On 2026-11-09, checks were made with the Surface's built-in microphone and the frozen sidecar. The user, sitting at the PC, read "今日はとても良い天気ですね。一緒に散歩に行きましょう。" ("The weather is very good today. Let us go for a walk together.") aloud. The audio was not saved. The frozen build is older than the caption fix (`5b2c3f9a`).

| What was checked | Result |
|---|---|
| The Windows microphone prompt | An exe in a new location showed "Allow VRCT-VOX to access your microphone?" |
| Classic recording while the prompt was unanswered | `AUDIO_OPEN_ERROR` after 9.0 s. Until the prompt was answered, the next start gave `AudioOpenBusy`. What the app's screen showed was not checked |
| RVC | Converted the voice from the real microphone. 83.9 s until ready, output peak 18832, stopped normally |
| Captions together with RVC | 9 final results. The text matched what was read |
| Captions only | 8 final results in 30 s. The text matched what was read |
| Classic recording (`external`, Whisper tiny) | 2 final results in 30 s. The text was close to what was read, but had misrecognitions ("天気" (weather) as "元気" (well), and "散歩" (walk) as "3本" (three, with a counter word)). 0 tracebacks |

In another run of captions only, 25 seconds gave 0 final results. It is not known whether that run overlapped with the reading, so the cause has not been settled. For classic recording, one run gave 0 final results and it is not known whether it overlapped with the reading, so the test was redone with the user reading on a cue on the screen. The table above shows that result. Two other runs, in which the user was away and did not speak, were left out of the results.

In the table above, the classic recording ran with the microphone threshold still at 40, where an earlier test had lowered it. The energy while reading, including the silences in between, was median 12, p95 1114 and max 1464.

With the default threshold of 300, there were 2 final results in 30 seconds ("どうもとてもいい?" and "どうもとてもいい 天気ですね、一緒に参考にいきましょう"). This run copied the build from 2026-11-08 00:13 to a new location, so it does not include the fix that waits for the microphone prompt (`1797fd77`). It started with the Surface's WASAPI device selected, but while the Windows prompt was open, the selection changed 5 seconds after the start to the Windows default input (MME's `Microsoft Sound Mapper`), and recognition ran on that input. 5 seconds is the same as the time after which this build gives up opening a device, but whether the two are related has not been checked. On this input, the energy while reading was median 12, p95 894 and max 1604.

After the prompt was answered, another try with the same executable kept the input on the Surface's WASAPI device. With threshold 300 there were 2 final results in 30 seconds ("今日はとてもいい天気ですね" and "今日はとてもいい天気ですね。一緒に3本に行きましょう。"). The energy while reading was median 7, p95 1375 and max 2570. The input changed only in the run with the prompt open, so the prompt may be involved, but each result comes from a single run.

## Screen changes after beta.6

On 2026-11-13, the screen changes that went into `develop` after beta.6 (#203 to #223) were checked on Windows. A development build (`3e30223f`) was started with a separate settings folder. The screens were operated through WebView2's debugging connection (CDP), at 125% scaling with the UI language set to Japanese. Keys were sent with `SendInput`. This is not a check with the user pressing a real keyboard.

| What was checked | Result |
|---|---|
| Hotkeys for TTS and voice (#218) | F13, F14, Shift+F15 and F16 were assigned. With the main screen in front, with another app (Character Map) in front, and after a restart, each key sent the same request as the button on the screen, and the same notice appeared. They did not work while settings were open |
| VRChat detection (#221) | With VRChat not running, "Quick settings" and Settings → "VRChat" showed "not found" with the steps. Turning sending off changed this to "Sending messages to VRChat is off." Starting the real VRChat changed both displays to "found", and quitting it returned them to "not found" (times below) |
| Translation model download (#213) | With no model present, two download notices appeared on the screen with an empty conversation, and "Review download" opened the confirmation screen. It also opened from "Translation" on the main screen, but took 22 seconds after the press (0.1 seconds after the fix below). Checking the consent box made the download button available, and when the download finished, translation turned on (times below) |
| Main screen bar and sidebar (#216, #217, #222) | At widths from 1200 to 320 CSS pixels, no text was cut off and nothing scrolled sideways. The first window opened at a width of 696 CSS pixels, in the narrow layout (fix below) |
| Settings page layout (#219, #220, #223) | On 13 pages, no text was cut off and nothing scrolled sideways. "Chat reading" showed a field that exists only on Windows (the reading area for the headset view). "Segmenting and queue" and "Recognition threshold" were collapsed, and could be opened and reached from the settings search. On the RVC page, the save bar showed "Save to apply: Use RVC for direct voice" |
| Notice position (#203, #206) | At widths of 870 and 696 CSS pixels, notices did not cover the switches, the input field or the send button |
| ASR server (#210) | `speech.exe` was not running after settings were opened and closed |
| Mute sync (#208) | It turned on with VRChat not running. The conditions for the notice that gives the reason it cannot be used were not set up |
| Display of messages that were not sent (#215) | Sending with sending turned off showed "Not sent to VRChat (off in settings)" in the log |
| Startup screen (#228) | On a normal start, the progress marks and the logo were the VRCT-VOX ones. The screen that downloads models at startup and the screen during an update were not displayed |
| Desktop caption overlay (#229) | Turning it on under Settings → "VR" opened the caption window, and turning it off closed it. The window stayed on top and passed clicks through, and turning it on and off did not change the foreground window (Character Map). On a 2496×1664 monitor, "Bottom of the screen" appeared at (250, 1011) with a width of 1997 and a height of 545, and "Top of the screen" appeared at y=48. Sent messages appeared with the original and the translation, and disappeared after the display time (6 seconds). The user's own messages appeared in blue text and the other person's in purple. Closing the app also closed the caption window. The results over the real VRChat and on the second monitor are below |

Starting the real VRChat and downloading the translation model were done with the user's approval. The times are single values on this PC. These two, the startup screen and the desktop caption overlay were checked on the same day, on development builds that included each change.

- VRChat detection: VRChat was started in desktop mode (`--no-vr`) from a state with Steam not running. The VRChat process appeared 30.6 seconds after the start action, and 17.7 seconds after that the display changed to "found". When VRChat was closed, the display returned to "not found" 3.5 seconds after the process ended. The display was read every 0.5 seconds.
- Translation model download: the approved translation model (`m2m100_418M-ct2-int8`, 476 MB for the whole folder) was moved to another place and downloaded again. After "Agree and download" was pressed, progress reached 100% in about 14 seconds, the notice "The translation model is here. Turning Translation on." appeared at about 18 seconds, and the translation switch turned on at about 22 seconds. The screen was read every 2 seconds. Translation from Japanese to English then worked. The downloaded model went into `src-python/weights/ctranslate2` together with the file that records that it passed the check (`.weight_verified.json`). The connection speed was not measured.
- Desktop caption overlay: VRChat was started in desktop mode, and one line each of the user's own message and the other person's message was passed directly to the caption window. No messages were sent to VRChat. Both with VRChat in a window (2514×1622) and in full screen through Alt+Enter (a 2496×1664 borderless window), the captions appeared over VRChat's screen. The window at the position of the caption text was VRChat, and the foreground window stayed VRChat while the captions were shown. The screen was checked by capturing an image of the whole desktop. In full screen, the captions sit above the bottom edge of the screen by the height of the taskbar, because their position is computed from the work area.
- Second monitor: this PC has two monitors. The primary one is 2496×1664 (125% scaling), and the other is 1920×1080 (100%). When the main screen was moved to the second monitor and captions were shown again, the band was 80% of the width and 34% of the height of that monitor's work area (1920×1032). "Bottom of the screen" appeared at (192, -430) with a width of 1536 and a height of 351, and "Top of the screen" appeared at (192, -1049). The left and right margins were both 192. The text size stayed at 28px.

The following were found and fixed in this check. The times are single values on this PC.

- Opening the confirmation screen after pressing "Translation" on the main screen took 22 seconds, because `transformers` was loaded before checking whether the model existed. Checking for the model first brought this down to 0.1 seconds.
- The first window size (870×654) was applied as physical pixels. At 125% scaling this is 696×523 CSS pixels, so the window opened in the narrow layout, and the settings button hid the other person's language in the sidebar. When there is no saved size yet, the scaling factor is now applied, and the window opens at 1088×818 physical pixels (871×655 CSS pixels).
- The VR UI's startup animation showed the original VRCT icon and logo. They were replaced with the VRCT-VOX icon and a logo in the display language. This was checked with the launcher image that reached the fake SteamVR (`tools/run_with_fake_vr.py`).
- The startup screen showed the original VRCT face icon, explanation image and logo. They were replaced with the VRCT-VOX icon and logo (#228).

## Simulated GPU configurations (2026-11-13)

This PC has two GPUs, so the behavior on a PC with only one GPU or with no GPU had not been checked. Narrowing the drivers with the Vulkan loader's environment variable `VK_LOADER_DRIVERS_DISABLE` changes the devices that `speech.exe` can see. The app passes its own environment variables to `speech.exe` unchanged, so the same narrowing also applies to the app's bundled server.

Recognition used Qwen3-ASR 0.6B (Q8_0), with the inference device set to "Automatic". A 96-second conversation between a man and a woman (TTS voices) was played at real-time speed. The delay is the time from the end of a voice to the arrival of the finalized sentence.

| Simulated configuration | Narrowing | Device that "Automatic" chose | Result |
|---|---|---|---|
| Discrete GPU only | `*ig*,*dzn*` | RTX 3060 Ti | With captions and speaker diarization, the delay was median 1.02 s and 1.33 s at the 90th percentile. GPU memory grew by about 2.1 GB |
| Integrated GPU only | `*nv*,*dzn*` | Iris Xe | With captions and speaker diarization, the delay was median 1.33 s and 1.63 s at the 90th percentile |
| No GPU | `*` | CPU | With captions only, the delay was median 2.71 s and 3.88 s at the 90th percentile, with the CPU at about 1.8 cores. Adding speaker diarization could not keep up, and the delay piled up to median 64 s and 122 s at the 90th percentile |
| No vendor driver, only the Direct3D 12 translation layer | `*nv*,*ig*` | Microsoft Direct3D12 (Intel(R) Iris(R) Xe Graphics) | The model loads, but the first computation fails and the server exits |

The following were found and fixed in this check.

- When the server running on the CPU had a speaker diarization model, captions were delayed by a large amount. When the speaker diarization model is on the CPU, the captions connection no longer asks for diarization. Captions appear without speaker labels. After the fix, the no-GPU configuration was run with a speaker diarization model specified, and the 20 finalized captions arrived without delay.
- In the configuration with only the Direct3D 12 translation layer, the server's exit showed a generic notice saying it "stopped unexpectedly". The app now tells apart the device errors that speech.cpp reports, and shows a notice (`speech_server_device_failed`) that suggests updating the driver or choosing another inference device.

The simulation shows only how a device is chosen and the speed on this PC's CPU and integrated GPU. AMD GPUs, bugs in other vendors' drivers and GPUs with little VRAM could not be simulated. The Direct3D 12 translation layer was the one present in this PC's Windows (Insider build 26220). Whether other PCs have it has not been checked.

## Not checked

- Downloading the translation model and where it is saved, in the app installed with the installer. The development build saves it to `src-python/weights`
- Display of the notice when mute sync cannot be used (for example, when the destination is another machine)
- The warning shown right after startup (#205). It disappears after 10 seconds, so the screen has to be read within a few seconds of startup
- Seeing captions from speech recognition of the microphone and the speaker in the desktop caption overlay over VRChat's screen. Monitors at 150% scaling or higher and apps in exclusive full screen have not been looked at either
- Hotkeys pressed on a real keyboard
- Listening through real speakers, and how close the voice came to the reference
- Why the selected input changed to another device while the Windows prompt was open. Switching from a device that cannot be opened to another device follows the [spec](../spec/data-and-persistence.md), but at the time the reason the device could not be opened was not logged. It is now recorded in `error.log`
- Real virtual cables such as VB-CABLE, and reception in VRChat. This PC cannot open recording devices
- GPU and CPU load with VRChat running in VR. The load in desktop mode is recorded above
- How the chatbox looks on VRChat's screen
- How often RVC stops with everything on the same GPU, and why. It stopped once in 5 runs (about 3 hours 40 minutes in total). On a PC with only one GPU, `auto` gives this configuration (in the simulation above, with only the discrete GPU left, `auto` chose that GPU)
- Whether an exe with a firewall block rule can find the real VRChat. Advertising works even with the rule, and a mock service advertised on the same PC could also be heard
- The cause of the rare access violation (0xC0000005) in CI's `backend-windows`. Repeating it locally did not reproduce it. On a failure, `crash_trace.log` is now written to the CI log
- VR operation with a real headset and controllers
- Real installation and updates. CI runs this test
- A real CPU-only PC and AMD GPUs. The no-GPU configuration was simulated on this PC by narrowing the drivers
- Continuous runs longer than 2 hours
- Long runs that include a real microphone
- The results of repeating Seed-VC together with VRChat, and how audible the voice cutouts are. The single 30-minute run did not stop

---

# Windows音声の検証記録 — 2026-11-07（日本語版）

TTS、同梱のspeech.cppサーバー、リアルタイム字幕、RVC、Seed-VC、入力の転送、VRオーバーレイをWindowsで動かした記録です。手順は[Windowsの音声機能](local-setup-windows.md)にあります。

## 環境

| 項目 | 内容 |
|---|---|
| OS | Windows 11 build 26220 |
| CPU | Intel Core i7-1255U（高性能コア2、効率コア8、12論理コア）。電源プランは高パフォーマンス |
| GPU | 内蔵のIntel Iris Xe（speech.cppのVulkan0）と、Thunderbolt接続のNVIDIA GeForce RTX 3060 Ti 8 GB（Vulkan1、ドライバー621.14） |
| speech.cpp | 0.10.0 windows-x64-vulkan（`speech.exe`のSHA-256は`fa787d70…981b7`） |
| Torch | 2.11.0+cu128、Python 3.12.14 |
| モデル | Irodori-TTS Q8_0、Qwen3-ASR 0.6B Q8_0、Silero VAD v6.2、Saisho Utane RVC v2、HuBERT、RMVPE。いずれも固定版とSHA-256で検証 |

speech.cppの`auto`と`gpu`は、このPCではどちらもIris Xe（Vulkan0）を選びます。特に断りのないTTSと同梱のASRの結果は、この内蔵GPUで動いた値です。RVCとSeed-VCはRTXのCUDAで動いています。

実マイクを使った確認は「実マイク」の節にまとめました。それ以外の試験では実マイクとスピーカーを使っていません。音声はSteamの無音の仮想出力へ書き、WASAPIのループバックで読み戻しました。RVCの試験では、開けない仮想マイクの代わりにループバックを入力へ当てています。入力デバイスを開く部分だけが試験用です。

内蔵マイクでの試験は利用者の許可を得て試みましたが、`IAudioClient::Initialize`が3台とも`E_ACCESSDENIED`を返して開けませんでした（MMEとDirectSoundでも同じ）。Steamの仮想マイクが開けなかったのも同じ現象です。

原因は、このPCのInsider Beta build 26220にある、デスクトップアプリごとのマイクの許可でした。Windowsの全体の設定は許可でも、次のように扱いが分かれます。

| 開いたプログラム | 結果 |
|---|---|
| Windows付属で署名のある`powershell.exe` | 確認なしで成功 |
| 未署名のexeの1回目 | `PickerHost.exe`の確認の画面が出て、答えるまで止まる。バージョン情報がないと「Allow   to access your microphone?」と名前が空欄になる |
| 同じexeの2回目（1回目に答えないまま終了） | 確認なしで`E_ACCESSDENIED`。30分後も同じ |
| 同じ中身のexeを別の場所へコピー | 改めて確認が出る |
| ファイアウォールの確認が開いている間のexe | 確認なしで`E_ACCESSDENIED`。答えれば確認が出て、拒否は残らない |
| `FileDescription`のある未署名のexe | 「Allow VRCT-VOX Probe to access your microphone?」と名前が出る |

`python.exe`も配布版のサイドカーも、最初の確認に答えなかったので拒否されていました。記録は`ConsentStore\microphone\NonPackaged`の一覧には現れません。サイドカーにはバージョン情報を入れ、確認の画面にVRCT-VOXの名前が出るようにしました。設定の画面から許可し直せるかは確かめていません。

確認を待つ間、デバイスを開くスレッドはPortAudioの共通のロックを持ったままです。そのため、同じプロセスでPortAudioを使う操作（デバイス一覧の更新、自動選択の切り替え、従来の録音経路の開始と停止）は、確認に答えるまで待たされます。待つのは、RVCとリアルタイム字幕では最大120秒、従来の録音経路では答えるまでです。従来の録音経路は8秒で開始を諦め、会話ログに理由を出します。マイクの場合は、デスクトップの確認に答えるよう案内します。確認の画面は残ります。許可したあとに起動し直せば開けることは、実マイクで確かめました。起動し直さずに開始だけをやり直した場合は確かめていません。このロックは、PortAudioの初期化と終了を直列化するためのものです（下の表）。外すと起動中の落ちる不具合を戻すおそれがあるため、変えていません。

## 結果

サイドカー全体を、stdioのIPCから操作しました。

| 確認 | 結果 |
|---|---|
| TTSスイッチで同梱サーバーを起動 | 7.3秒。`speech.exe`はVulkan0で動作 |
| 読み上げの最初の音 | 送信から1.2秒 |
| 同じ音声を同梱のASRで認識 | 「今日はとてもいい天気ですね。一緒に散歩に行きましょう。」 |
| RVCの変換（検索ブレンド0） | 入力25.0秒に対して出力25.1秒。エラーなし |
| RVCの変換（検索ブレンド0.5、アプリが準備した実行環境、日本語を含むパス） | 8.4秒の入力に対して8.46秒の出力。ミュートのピーク1/32767、停止0.12秒 |
| Seed-VCの変換（同じ条件） | 準備33秒。8.4秒の入力に対して8.52秒の出力。ミュートのピーク1/32767、停止0.09秒 |
| 変換後の音声を同梱のASRで認識（Seed-VC） | 元の文を正しく認識 |
| 変換後の音声を同梱のASRで認識 | 元の文を正しく認識 |
| 話し始めから変換音声の始まりまで | 214 msと448 ms（ループバック経由の2回の測定。ばらつきが大きい） |
| 変換中のミュート | ピーク1/32767（音声エンジンの丸めの範囲）。変換は継続 |
| 解除 | 音声が戻る |
| RVCの停止 | 0.22秒 |
| 入力の転送 | 元の音声との相関1.000 |

実アプリ（Tauri、WebView2）では、デバッグポートから実際のマウスとキーの入力を送りました。

| 確認 | 結果 |
|---|---|
| 長押しの再送 | 再送され、入力中の下書きは残る |
| 通常のクリック | 編集になる |
| Ctrl+Spaceの記録と登録 | 「Ctrl + Space」で保存され、OSのグローバルショートカットに登録される |
| 表示倍率125%と150%の幅の判定 | CSS pxの800を境に切り替わる |
| Windowsの音声ページ | 管理対象の経路を出さず、RVCは出力デバイスを求める |

凍結したサイドカー（PyInstaller）でも、同じIPCから次を確認しました。

| 確認 | 結果 |
|---|---|
| 配布物の検査 | `check_voice_distribution.py`に合格 |
| 起動 | 3.5秒 |
| TTSとASR | 上と同じ手順で合格 |
| ルーターとRVCワーカー | 配布物の形で起動し、Torchの読み込みを終えて音声入力の直前まで進む。この先はこのPCで開ける入力がないため未確認 |
| 配布物の`voice_worker`から起動したRVCとSeed-VC | 実際のパイプへ音声を流して変換。下の連続運転の表を参照 |
| ライセンス文書 | `_internal/licenses/python/`に128パッケージ分。`soxr`のLGPLと`zeroconf`のCOPYINGを含む |

インストーラーは`tauri build`でコンパイルしました。実際のインストールは行っていません。インストーラーと同じ`nsExec`と`tar`の組み合わせは、ANSIコードページ外のフォルダーで小さなNSISスクリプトから動くことを確かめました。

## 実物でだけ見つかった不具合

| 症状 | 原因 | 対処 |
|---|---|---|
| 440 Hzの音が約840 Hzに崩れる | PortAudioのWASAPIのモノラル再生 | ステレオで渡す |
| 2つ目の音声デバイスが開始できない | PortAudioがCOMを初期化するのは最初のスレッドだけ | 開くスレッドで初期化する |
| 起動中にサイドカーがアクセス違反で落ちる | PortAudioの初期化と終了はスレッド安全でない | 共通のロックで直列化する |
| RVCが数秒で止まる | PortAudioの書き込みが音声の長さだけ止まる | 書き込みを別スレッドへ分ける |
| RVCの1ブロックが150 ms | ウィンドウのないプロセスが効率コアへ回される | 電力制限の対象から外す |
| 配布物のRVCワーカーが即座に終了する | `_internal`のPython 3.11の拡張モジュールが、ワーカーのPython 3.12の標準ライブラリを隠す | ワーカーを別のフォルダーで動かす |
| 日本語のユーザー名でRVCの検索ブレンドが開始できない | faissがファイルを狭い文字のCランタイムで開く | Pythonで読んでfaissへ渡す |
| Seed-VCのワーカーが発話の終わりで落ちる | 無音のブロックに直前の声のフェードアウトが残り、プロトコルが非ゼロの無音を拒否する | そのブロックを変換済みとして報告する。Linuxにも同じ経路がある |
| マイクを開けないときに無関係なエラーが出る | 開始の時間切れの処理で、後片付けの遅れの例外が理由を上書きする | 時間切れを報告する |

## 変換の速度

1ブロック（80 ms）の処理時間です。音声データを連続で変換して測りました。GPUはThunderbolt経由（PCIe 3.0 x4）で、カーネルの起動待ちが処理時間の大半でした。上流のCUDA Graphを有効にすると、この待ちが消えます。

| 条件 | 平均 | p95 |
|---|---:|---:|
| RVC、CUDA Graphなし、検索ブレンド0 | 70 ms | 90 ms |
| RVC、CUDA Graphなし、検索ブレンド0.5 | 94 ms | 118 ms |
| RVC、CUDA Graph、検索ブレンド0 | 18 ms | 20 ms |
| RVC、CUDA Graph、検索ブレンド0.5 | 20 ms | 22 ms |
| Seed-VC、CUDA Graphなし | 327 ms | 385 ms |
| Seed-VC、CUDA Graphと畳み込みの探索 | 72 ms | 75 ms |

faissの検索そのものは1 msでした。検索ブレンドが遅かったのは、結果を待つ同期で、GPUの処理とCPUの起動が重ならなくなるためです。

Seed-VCの上流にCUDA Graphはないので、アダプター（`integrations/seed_vc/graphs.py`）で外から包みます。`istft`と音源の生成はGraphに入らないので、そのまま実行します。畳み込みの探索は確保メモリのピークが約5.5 GBになりますが、準備の間だけで、常時は約1 GBです。

RVCのCUDA GraphはキャプチャでVRAMの確保が130 MiB増え、開始時に約0.9秒かかります。

### 音声が変わらないことの確認

同じ音声を変換して、スペクトルの相関を比べました。RVCはノイズを使うので、同じ経路どうしでも一致しません。

| 比較 | RVC | Seed-VC |
|---|---:|---:|
| Graphなしどうし | 0.933 | 1.000（固定の乱数） |
| Graphありどうし | 0.938 | 0.982 |
| GraphなしとGraphあり | 0.935 | 0.951 |

RVCの差は、同じ経路どうしの差と同じ大きさです。Seed-VCの差はそれより大きいですが、エンベロープの相関は0.99で、同梱のASRは全部の出力を同じ文として認識しました。

### 連続運転

配布物の`voice_worker`から起動し、実際のパイプへ音声を実時間で流しました。約67秒、840ブロックです。

| エンジン | 往復の平均 | p95 | 最大 | 準備 |
|---|---:|---:|---:|---:|
| RVC（検索ブレンド0.5） | 30 ms | 33 ms | 48 ms | 22秒 |
| Seed-VC | 74 ms | 79 ms | 85 ms | 34秒 |

どちらも遅れは積み重なりませんでした。Seed-VCは、参照音声を3秒のままだと往復が平均81 msで枠を超えたので、開始時の計測で2秒へ軽くしています。`vc_capture_overrun`の余裕は小さく、VRChatと同時に動かすと、さらに軽い設定へ下がるか、間に合わない可能性があります。

これはこのノートPCの数値です。別のCPUやGPUでの性能を保証するものではありません。

## 実行環境の準備

アプリの準備機能を、実際の通信で、日本語・ハングル・絵文字を含むフォルダーへ実行しました。

| エンジン | 所要時間 | 完了後の大きさ |
|---|---:|---:|
| RVC | 165秒 | 5.48 GB |
| Seed-VC | 251秒 | 6.86 GB |

通信の速さはこの回線の値です。どちらも`speech.exe`、Python、Torch、CUDAの読み込みまで問題なく動きました。`faiss.read_index`だけが、コードページ外のパスを開けませんでした（下の表）。

## SteamVR

実物のSteamVRをnullドライバーで起動し、設定とログは`VR_CONFIG_PATH`と`VR_LOG_PATH`で一時フォルダーへ逃がしました。普段のSteamVRの設定は変えていません。

| 確認 | 結果 |
|---|---|
| サイドカーの接続とオーバーレイの作成 | 成功 |
| 送った日本語が別のOpenVRクライアントから画素として読める | 成功 |
| 240回の連続更新 | 失敗0、15.6秒 |
| 更新後の描画とエラー出力 | 描画は続き、エラーなし |
| 実アプリのVR UI（ウィンドウの取り込みとOpenGLテクスチャ） | ランチャーのボタンがオーバーレイの画素まで届く |

試験のあと、`steamvr.vrsettings`と`openvrpaths.vrpath`のハッシュが変わっていないことを確かめました。

## 長時間の運転

コミット`412ffc26`のサイドカーを、開発環境の`.venv`から30分動かしました（2026-11-08）。Steamの無音の仮想出力へ英語の音声を12秒ごとに流し、相手の声を字幕にする経路でWASAPIのループバックから読み取っています。認識はWhisper tiny、翻訳はm2m100_418M（CTranslate2、int8）で、どちらもCPUです。60秒ごとにチャットボックスへ送信し、VRの字幕オーバーレイも有効にしました。SteamVRは偽のランタイムです。マイクは試験用のフックで開けないようにしました。

| 確認 | 結果 |
|---|---|
| 発話の認識 | 150発話のすべてを認識。1発話が2つに分かれることがあり、結果は222件 |
| 翻訳 | 222件すべてに訳文あり |
| チャットボックスへの送信 | 29件すべて成功の応答 |
| 音声を流し始めてから最初の認識結果まで | 中央値3.73秒、95パーセンタイル3.88秒 |
| エラーの通知とトレースバック | 0件 |
| VRの字幕 | 終了の直前まで画像を更新。終了時にオーバーレイの消し忘れと呼び出しの誤りはなし |
| マイクを開こうとした回数 | 0回 |

| 指標（2プロセスの合計） | 開始時 | 5分後 | 29分30秒後 | 5分以降の傾き |
|---|---:|---:|---:|---:|
| プライベートメモリ | 3433.5 MB | 3600.2 MB | 3604.8 MB | 毎分+0.11 MB |
| ハンドル | 1379 | 1395 | 1395 | 毎分-0.002 |
| スレッド | 60 | 60 | 56 | 毎分-0.06 |

5分以降のプライベートメモリは3599〜3607 MBの間で上下し、増え続ける傾向は見えませんでした。CPU使用率は1論理コアを100%として21〜34%です。この試験は30分だけで、マイク、TTS、RVCは動かしていません。

### VRChatと同時の運転

2026-11-09に、VRChatをデスクトップ表示（`--no-vr`）でワールドに入れたまま、TTS、RVC、字幕、翻訳、チャットボックスの送信、VRの字幕オーバーレイを同時に30分動かしました。SteamVRは実物をnullドライバーで起動しています。VRChatの描画はRTX 3060 Tiです。

15秒ごとに声を流し、60秒ごとにチャットボックスへ送信して、同じ文をTTSで読み上げました。RVCはSaisho（検索ブレンド0）をRTXのCUDAで動かし、入力には上の試験と同じくループバックを当てています。翻訳はm2m100_418M（int8）でCPUです。マイクは試験用のフックで開けないようにしました。開こうとした回数は、どの回も0回です。

speech.cppの装置は条件ごとに変えました。この試験の時点でアプリの設定で選べたのは`auto`、`cpu`、`gpu`だけだったので、BとCのRTX（Vulkan1）は試験用のフックで指定しています。その後、設定からGPUを名前で選べるようにしました。

| | A | B | C | D |
|---|---|---|---|---|
| コミット | `9a1bb52d`（字幕の修正前） | `5b2c3f9a` | `5b2c3f9a` | `5b2c3f9a` |
| TTS | Iris Xe | RTX | RTX | Iris Xe |
| 字幕 | Qwen3-ASR、Iris Xe | Qwen3-ASR、RTX | Qwen3-ASR、RTX | Whisper tiny、RTXのCUDA |
| 流した声 | 日本語と英語 | 日本語と英語 | 日本語と英語 | 英語だけ |
| 発話の認識 | 120/120 | 120/120 | 120/120 | 120/120 |
| 確定結果の件数 | 240 | 240 | 240 | 180 |
| 認識までの遅れ（中央値 / p95） | 3.99 / 6.64秒 | 3.13 / 4.42秒 | 3.14 / 4.41秒 | 3.83 / 5.09秒 |
| TTS | 30/30 | 30/30 | 30/30 | 30/30 |
| チャットボックスの送信 | 30/30 | 30/30 | 30/30 | 30/30 |
| RVC | 30分継続 | **690〜720秒の間に停止** | 30分継続 | 30分継続 |
| トレースバック | 0件 | 0件 | 0件 | 0件 |
| RTXのVRAMのピーク | 2284 MB | 6700 MB | 7248 MB | 3148 MB |
| RTXの使用率 | 49〜75% | 41〜65%（停止まで） | 42〜86% | 31〜83% |
| CPU使用率（1論理コアを100%） | 104〜144% | 120〜177%（停止まで） | 90〜137% | 60〜100% |
| VRChatのFPS（中央値 / p5 / 最小） | 68.4 / 40.7 / 32.9 | 84.8 / 53.8 / 43.6 | 98.2 / 65.8 / 51.7 | 90.8 / 28.2 / 17.2 |

遅れは、声を流し始めてから、その声の最初の確定結果までの時間です。VRChatのFPSは、VRChat自身のログに10秒ごとに出る値です。Dは開始から約11分の間、1分ごとに26〜30まで下がりました。原因は調べていません。チャットボックスは送信の成功応答だけを数えており、VRChatの画面に表示されたかは見ていません。

BのRVCは、`vc_capture_overrun`で止まりました（12:27:42〜12:28:12の間）。直近75ブロック（6秒）の半分を超えて遅れたときに止める、設計どおりの動作です。字幕、TTS、チャットボックスは最後まで動きました。VRChatのFPSの中央値は、RVCが動いている間は64.6、止まったあとは90.9でした。

同じ時間帯の12:27:51に、ワールドの動画プレーヤーが次の曲へ切り替わり、FPSは45.9まで下がりました。ただ、Bではそれより前の3回の切り替えでは止まっていません。Cでは試験の開始直後に動画を開いたあと、再生の開始も切り替えもログになく、VRChatの負荷はBより軽い条件でした。この2回だけでは、停止の頻度も動画との関係も判断できません。

VRChat、TTS、字幕、RVCをすべて同じRTXに載せたこの2回では、1回でRVCが30分もちませんでした（同じ構成でさらに2回動かした結果は、次の表の下に書きました）。speech.cppをIris Xeに置いたAと、TTSをIris Xeに置いてWhisperをCUDAで動かしたDは、1回ずつの試験でRVCが止まりませんでした。

同じ構成で、起動中の暖機を入れた状態（`c3646d47`）で、さらに2回動かしました。speech.cppのRTXは、BとCと同じく試験用のフックで指定しています。

| | E | F |
|---|---|---|
| 発話の認識 | 120/120 | 120/120 |
| 確定結果の件数 | 240 | 240 |
| 認識までの遅れ（中央値 / p95） | 3.14 / 4.38秒 | 3.12 / 4.38秒 |
| TTS | 30/30 | 30/30 |
| チャットボックスの送信 | 30/30 | 30/30 |
| RVC | 30分継続 | 30分継続 |
| トレースバック | 0件 | 0件 |
| RTXのVRAMのピーク | 6087 MB | 5798 MB |
| RTXの使用率 | 49〜77% | 55〜74% |
| CPU使用率（1論理コアを100%） | 92〜160% | 89〜122% |
| VRChatのFPS（中央値 / p5 / 最小） | 90.5 / 72.1 / 64.7 | 86.7 / 70.7 / 60.4 |
| VRChatが動画のURLを読み込んだ回数 | 7回 | 10回 |

すべてをRTXに載せた4回（B、C、E、F）のうち、RVCが止まったのはBの1回だけです。EとFでは動画を何度も読み込みましたが止まらなかったので、動画の切り替えだけでは止まりません。BとCは暖機なし、EとFは暖機ありですが、暖機は起動中にしか動かないうえ、回数も少ないので、差が暖機によるものとは言えません。4回では、停止の頻度も原因も決められません。RVCが止まったときは、その時点のブロックの遅れと処理時間が`process.log`の`voice conversion stopped`に残るようにしました。EとFでは止まらなかったので、この記録が実際の停止で役に立つかはまだ確かめていません。

RTXのVRAMの値は`nvidia-smi`のGPU全体の使用量で、VRChat（試験の終了後に測って1011 MB）を含みます。speech.cppをRTXに載せると、TTSのプロセスの専用メモリーは開始時の1494 MBから終了時には2389 MBへ増えました。増え方は段差で、段差のあとは平らです。Cでは90秒で5474 MBから6368 MBへ上がり、480秒に一時的に7248 MBまで上がったあと、終了まで6371〜6408 MBでした。段差の原因は調べきれていません。

| 指標（VRCT-VOXのプロセスの合計） | A | C | D |
|---|---:|---:|---:|
| プライベートメモリ（開始時） | 11275.8 MB | 11454.3 MB | 10758.1 MB |
| プライベートメモリ（5分後） | 11494.7 MB | 12726.3 MB | 11220.7 MB |
| プライベートメモリ（29分30秒後） | 11512.7 MB | 12765.2 MB | 11238.4 MB |
| 5分以降の傾き | 毎分+0.62 MB | 毎分+1.21 MB | 毎分+0.70 MB |
| ハンドル（開始時 / 5分後 / 29分30秒後） | 4445 / 4651 / 4548 | 4557 / 4667 / 4783 | 3825 / 3899 / 3896 |
| スレッド（開始時 / 5分後 / 29分30秒後） | 208 / 203 / 200 | 223 / 229 / 212 | 175 / 182 / 167 |

Bは途中でRVCのプロセスが終わるので、この表から外しました。2時間動かした結果は、次の節に書きました。

### 2時間の連続運転

2026-11-09に、開発環境の`.venv`から2時間の連続運転を2回行いました。TTSと字幕（Qwen3-ASR）はRTX 3060 Ti（Vulkan1、試験用のフックで指定）、RVC（Saisho、検索ブレンド0）はRTXのCUDA、翻訳はm2m100_418M（int8）でCPUです。SteamVRは実物をnullドライバーで起動し、VRの字幕オーバーレイを有効にしました。1回目はVRChatを起動せず、2回目はVRChatをデスクトップ表示（`--no-vr`）でワールドに入れたまま動かしました。2回目は、VRChatの描画もRTXです。

15秒ごとに声を流し、60秒ごとにチャットボックスへ送信して、同じ文をTTSで読み上げました。入力はループバックで、マイクは試験用のフックで開けないようにしました。開こうとした回数は0回です。

| | VRChatなし | VRChatと同時 |
|---|---|---|
| コミット | `0fc06552` | `e600dc41` |
| 発話の認識 | 480/480 | 480/480 |
| 確定結果の件数 | 960 | 960 |
| 認識までの遅れ（中央値 / p95） | 3.09 / 4.33秒 | 3.16 / 4.42秒 |
| 訳文の通知 | 960件すべて | 960件すべて |
| TTS | 120/120。取りこぼしとエラーは0件 | 120/120。取りこぼしとエラーは0件 |
| チャットボックスの送信 | 120/120（成功の応答） | 120/120（成功の応答） |
| RVC | 2時間継続 | 2時間継続 |
| 終了時のRVCの状態 | 変換の確認が取れた状態 | 変換の確認が取れた状態 |
| トレースバック | 0件 | 0件 |
| RTXのVRAM（GPU全体。5分後 / 終了前） | 4779 / 4779 MB | 6045 / 6076 MB（ピーク6079 MB） |
| RTXの使用率 | 18〜67% | 45〜75% |
| CPU使用率（1論理コアを100%） | 63〜121% | 99〜137% |
| VRChatのFPS（中央値 / p5 / 最小） | なし | 78.5 / 59.3 / 18.9 |
| VRChatが動画のURLを読み込んだ回数 | なし | 31回 |

| 指標（VRCT-VOXのプロセスの合計。開始時 / 5分後 / 119分30秒後） | VRChatなし | VRChatと同時 |
|---|---:|---:|
| プライベートメモリ（MB） | 11565.4 / 12761.2 / 12843.2 | 11564.2 / 13090.1 / 13150.4 |
| ハンドル | 4586 / 4712 / 4718 | 4593 / 4703 / 4736 |
| スレッド | 222 / 229 / 212 | 230 / 232 / 212 |

VRChatなしの回のプライベートメモリは、15分ごとの平均で15〜30分の12772 MBから75〜90分の12849 MBまで増え、105〜120分は12839 MBでした。5分以降の傾きは毎分+0.88 MBですが、最後の45分は増えていません。

VRChatと同時の回は、15〜30分の13095 MBから105〜120分の13134 MBまで少しずつ増えました。5分以降の傾きは毎分+0.44 MBです。RTXのVRAMも6045 MBから6076 MBへ少しずつ増えました。VRChatを含むGPU全体の値なので、どのプロセスの増加かはわかりません。どちらの増加も、2時間を超えて続くかはわかりません。

VRChatのFPSは、15分ごとの中央値で75.1〜83.8でした。18.9まで下がったのは90〜105分の区間の1回で、原因は調べていません。

VRChat、TTS、字幕、RVCをすべてRTXに載せた試験は、上のB、C、E、Fとこの2時間の回で5回、合計で約3時間40分になりました。RVCが止まったのはBの1回だけです。1回の停止では、頻度も原因も決められません。この2時間の回でも止まらなかったので、`voice conversion stopped`の記録が実際の停止で役に立つかは、まだ確かめていません。

どちらの回も、英語の480件は日本語に訳されました。日本語の480件は、翻訳先が日本語なので、原文と同じ文が返っています。960件のうち160件は「行きましょう。」という断片です。TTSで作った試験音声（8.4秒）には、7.6秒から終わりまで別の音の塊があるので、そこを認識した結果と考えていますが、音声を聞いて確かめてはいません。

VRの字幕オーバーレイは、どちらの回も終了時に2枚が表示の状態でした。別のクライアントから画像を読むと`OverlayError_InvalidTexture`になるので、表示の内容は確かめていません。`error.log`に残ったのは、どちらの回も、起動時にLM StudioとOllamaへ接続できなかった2件だけです。

### Seed-VCの連続運転

2026-11-10に、2時間の試験と同じ手順で、RVCの代わりにSeed-VCを動かしました。TTSと字幕はRTX（Vulkan1）、Seed-VCはRTXのCUDA、翻訳はCPUです。VRChatは起動していません。参照音声はTTSで作った8.4秒のWAVで、実行環境は日本語、韓国語、絵文字を含むパスに置きました。

| 30分の試験 | 修正前 | 修正後 |
|---|---|---|
| 発話の認識 | 120/120 | 120/120 |
| 確定結果の件数 | 240 | 240 |
| 認識までの遅れ（中央値 / p95） | 3.10 / 4.33秒 | 3.08 / 4.31秒 |
| TTS | 30/30 | 30/30 |
| チャットボックスの送信 | 30/30（成功の応答） | 30/30（成功の応答） |
| Seed-VC | 30分継続 | 30分継続 |
| トレースバック | 0件 | 0件 |
| CPU使用率（1論理コアを100%） | 411〜439% | 112〜132% |
| RTXの使用率 | 48〜77% | 48〜71% |
| RTXのVRAMのピーク（GPU全体） | 5219 MB | 5554 MB |

修正前は、Seed-VCのワーカーの4つのスレッドが、それぞれ約94%のCPUを使い続けていました。バックエンドには、Intel OpenMPのスレッドが待機中に空回りしないようにする`KMP_BLOCKTIME=0`と`KMP_USE_YIELD=0`を設定していますが、変換のワーカーには渡していませんでした。OpenMPは処理のあと200 ms空回りするので、80 msごとにブロックが来ると止まりません。この2つをワーカーに渡すと空回りがなくなったので、これを原因と判断し、ワーカーにも渡すようにしました。

同じ手順の3分の試験で、設定のあり・なしを比べました。Seed-VCは交互に2回ずつ、RVCは1回ずつです。

| | CPU使用率（中央値） | 往復（中央値） | 変換したブロック | 遅れたブロックの最大（直近75ブロック） |
|---|---:|---:|---:|---:|
| Seed-VC、設定なし | 421 / 426% | 78 / 78 ms | 820 / 802 | 14 / 13 |
| Seed-VC、設定あり | 123 / 124% | 63 / 63 ms | 1003 / 996 | 7 / 10 |
| RVC、設定なし | 84% | 31 ms | 2336 | 0 |
| RVC、設定あり | 73% | 31 ms | 2333 | 0 |

ブロックの数は、計測の開始から最後の記録までの累計です。

修正後の30分では、5秒ごとの記録362回のうち122回で、直近75ブロックに遅れたブロックがありました。最大は13個で、変換を止める基準（38個）より少ない値です。遅れたブロックの分は、声が短く途切れます。

同じコード（`f58b8ddc`）で、VRChatをデスクトップ表示（`--no-vr`）でワールドに入れたまま、Seed-VCを30分動かしました。VRChatの描画もRTXです。1回だけの試験です。

| | VRChatなし | VRChatと同時 |
|---|---|---|
| 発話の認識 | 120/120 | 120/120 |
| 確定結果の件数 | 240 | 240 |
| 認識までの遅れ（中央値 / p95） | 3.08 / 4.31秒 | 3.16 / 4.41秒 |
| TTS | 30/30 | 30/30 |
| チャットボックスの送信 | 30/30（成功の応答） | 30/30（成功の応答） |
| Seed-VC | 30分継続 | 30分継続 |
| トレースバック | 0件 | 0件 |
| CPU使用率（1論理コアを100%） | 112〜132% | 148〜181% |
| RTXの使用率 | 48〜71% | 53〜78% |
| RTXのVRAMのピーク（GPU全体） | 5554 MB | 5906 MB |
| VRChatのFPS（中央値 / p5 / 最小） | なし | 76.3 / 61.2 / 52.6 |
| VRChatが動画のURLを読み込んだ回数 | なし | 7回 |
| 往復（中央値） | 63 ms | 78 ms |
| ブロックの遅れ（5秒ごとの中央値の中央値） | 23 ms | 163 ms |
| 遅れたブロックがあった記録 | 122/362回 | 258/357回 |
| 遅れたブロックの最大（直近75ブロック） | 13個 | 19個 |

VRChatと同時の回は止まりませんでしたが、往復が1ブロックの80 msに近づき、ブロックの遅れの中央値は163 msになりました。240 msを超えたブロックは捨てるので、余裕は小さくなります。遅れたブロックは多くの記録にあり、VRChatなしのときより声が途切れるはずです。実際にどれだけ聞こえるかは確かめていません。

### GPUのキャッシュが空のときの最初の認識

上の試験の準備でRTXに字幕を載せたところ、開始から18.5秒で字幕が止まり、デバイスが外れた可能性があるという案内が出ました。原因はデバイスではなく、ドライバーのキャッシュが空で、接続の最初の認識が15秒の上限を超えたことでした。`speech.exe`に空のキャッシュフォルダーを渡して再現しました（Vulkan1、VRChatと同時）。

| 条件 | 字幕 | TTSのスイッチをオンにする時間 | 字幕を開始する時間 |
|---|---|---:|---:|
| キャッシュあり、修正前 | 2回とも、10発話すべてを認識 | 5.3秒 | 3.5秒 |
| キャッシュなし、修正前 | 3回とも18.4〜18.5秒で停止 | 51〜93秒 | 17.6〜20.4秒 |
| キャッシュなし、上限を180秒にして調査 | 最初の確定結果まで25.7秒。10発話中9件を認識 | | |
| キャッシュなし、修正後（`5b2c3f9a`） | 停止なし。最初の確定結果まで29.4秒。10発話中9件を認識 | | |

認識できなかった1件は調べていません。修正後は、接続の最初の結果を120秒まで待ち、その後ろに並んだ発話の待ち時間も数え直します。2件目以降は15秒のままで、自動の再接続もしません。時間切れのときは、デバイスの案内ではなく専用の案内を出します。

キャッシュが空のときは、TTSの最初の1文が`first_audio_timeout`で失敗し、次の文から話し始めました。古い発話を読み上げない方針なので、この上限は変えていません。

Iris Xe（`auto`）で同じ操作をすると、10発話すべてを認識し、最初の結果まで約5秒でしたが、このGPUでキャッシュを空にできていたかは確かめていません。

### 起動中の暖機

上の2つを防ぐために、同梱のサーバーの起動中に1回だけ推論して、結果を捨てるようにしました。`speech.exe`を直接起動し、キャッシュを空にして測りました（RTX、VRChatなし）。

| 最初の要求 | かかった時間 | 次の要求 |
|---|---:|---|
| TTS「あ。」 | 0.08秒 | 次の普通の文で8.0秒待たされる（暖機にならない） |
| TTS「こんにちは、今日はよろしくお願いします。」 | 7.95秒 | 長さの違う3つの文が0.94秒、0.14秒、0.09秒 |
| ASR ノイズ2秒 | 1.53秒 | 2回目は0.12秒。暖機になるかは確かめていない |
| ASR ノイズ6秒 | 8.33秒 | 実際の音声が0.08秒 |
| ASR 実際の音声（比較） | 7.59秒 | 0.09秒 |

アプリ全体で、キャッシュを空にしてRTXで150秒動かしました（VRChatなし）。TTSのスイッチをオンにするまで41.4秒、字幕の開始に19.4秒です。10発話すべてを認識し、最初の発話の検出から最初の確定結果まで5.6秒でした（暖機なしでは29.4秒）。TTSは2件とも成功しました。

暖機はGPUで動く日本語のTTSとASRだけです。多言語のTTSは、受け付ける声を確かめていないので行いません。失敗しても、最初の要求が遅くなるだけで、サーバーの起動は続けます。

## 現在のコードの凍結物

2026-11-09に、#172〜#174を含むコード（`fa688770`）を凍結して、TTS、スピーカーの字幕、GPUの一覧を確かめました。15項目すべて成功し、トレースバックは0件です。GPUの一覧にはIris XeとRTXの両方が出ました。席を外している間にマイクの確認が開かないよう、マイクを開く試験は含めていません。

## 実マイク

2026-11-09に、Surfaceの内蔵マイクと凍結したサイドカーで確かめました。利用者がPCの前で「今日はとても良い天気ですね。一緒に散歩に行きましょう。」を読み上げました。音声は保存していません。凍結物は、字幕の修正（`5b2c3f9a`）より前のものです。

| 確認したこと | 結果 |
|---|---|
| Windowsのマイクの確認 | 新しい場所のexeで「Allow VRCT-VOX to access your microphone?」が出た |
| 確認に答えていない間の従来の録音 | 9.0秒で`AUDIO_OPEN_ERROR`。答えるまで、次の開始は`AudioOpenBusy`。アプリの画面での表示は見ていない |
| RVC | 実マイクの声を変換した。準備完了まで83.9秒、出力のピーク18832、正常に停止した |
| RVCと同時の字幕 | 確定結果9件。文は読み上げと一致した |
| 字幕だけ | 30秒で確定結果8件。文は読み上げと一致した |
| 従来の録音（`external`、Whisper tiny） | 30秒で確定結果2件。文は読み上げに近いが、誤認識があった（「天気」が「元気」、「散歩」が「3本」）。トレースバックは0件 |

字幕だけの試験は、別の回の25秒では確定結果が0件でした。読み上げの時間と重なっていたかわからないので、原因は決めていません。従来の録音は、読み上げと重なっていたかわからない回が確定結果0件だったので、利用者が画面の合図で読み上げる形でやり直しました。上の表はその結果です。ほかに2回、利用者が離席していて声を出していない回があったので、結果から外しました。

上の表の従来の録音は、マイクの閾値が以前の試験で下げた40のままでした。読み上げ中のエネルギーは、間の無音を含めて中央値12、p95 1114、最大1464です。

既定の閾値300では、30秒で確定結果2件でした（「どうもとてもいい?」「どうもとてもいい 天気ですね、一緒に参考にいきましょう」）。この回は、2026-11-08 00:13のビルドを新しい場所にコピーして実行したので、マイクの確認を待つ修正（`1797fd77`）を含みません。SurfaceのWASAPIを選んで開始しましたが、Windowsの確認の画面が開いている間に、開始から5秒で選択がWindowsの既定の入力（MMEの`Microsoft Sound Mapper`）に変わり、認識はこの入力で行われました。5秒は、このビルドでデバイスを開くのを諦めるまでの時間と同じですが、関係は確かめていません。この入力での読み上げ中のエネルギーは、中央値12、p95 894、最大1604です。

確認の画面に答えたあと、同じ実行ファイルでもう一度試すと、入力はSurfaceのWASAPIのまま変わりませんでした。閾値300で30秒に確定結果2件です（「今日はとてもいい天気ですね」「今日はとてもいい天気ですね。一緒に3本に行きましょう。」）。読み上げ中のエネルギーは、中央値7、p95 1375、最大2570でした。確認の画面が開いていた回だけ入力が変わったので、画面が関係している可能性はありますが、それぞれ1回の結果です。

## beta.6のあとの画面の変更

2026-11-13に、beta.6のあとに`develop`へ入った画面の変更（#203〜#223）をWindowsで確かめました。開発用のビルド（`3e30223f`）を、設定のフォルダーを分けて起動しています。画面はWebView2のデバッグ用の接続（CDP）から操作し、表示倍率は125%、UIの言語は日本語です。キーは`SendInput`で送りました。利用者が実際のキーボードで押した確認ではありません。

| 確認したこと | 結果 |
|---|---|
| 読み上げと声のホットキー（#218） | F13、F14、Shift+F15、F16を割り当てた。メイン画面が前のとき、別のアプリ（文字コード表）が前のとき、再起動したあとのそれぞれで、画面のボタンと同じ要求を送り、同じお知らせが出た。設定を開いている間は効かなかった |
| VRChatの検出（#221） | VRChatを起動していない状態で、「クイック設定」と「設定」→「VRChat」に「検出できません」と手順が出た。送信をオフにすると「VRChatへのメッセージ送信はオフです。」に変わった。実物のVRChatを起動すると両方の表示が「検出しました」に変わり、終了すると「検出できません」に戻った（時間は下） |
| 翻訳モデルの取得（#213） | モデルがない状態で、会話が空の画面に取得の案内が2件出て、「取得内容を確認」から確認の画面が開いた。メイン画面の「翻訳」からも開いたが、押してから22秒かかった（下の修正のあとは0.1秒）。同意の欄にチェックを入れると取得のボタンが押せるようになり、取得が終わると翻訳がオンになった（時間は下） |
| メイン画面の帯とサイドバー（#216、#217、#222） | 幅1200〜320 CSSピクセルで、文字の切れと横スクロールはなかった。初回のウィンドウは幅696 CSSピクセルの狭いレイアウトで開いた（下の修正） |
| 設定のページの構成（#219、#220、#223） | 13ページで文字の切れと横スクロールはなかった。「チャット読み取り」にWindowsだけの欄（ヘッドセットの映像の読み取り範囲）が出た。「区切りと待機の調整」と「認識のしきい値」は畳まれていて、設定の検索から開いて移れた。RVCのページで保存の帯が「保存すると適用: 直接音声でRVCを使う」になった |
| お知らせの位置（#203、#206） | 幅870と696 CSSピクセルで、お知らせはスイッチ、入力欄、送信ボタンに重ならなかった |
| ASRのサーバー（#210） | 設定を開いて閉じたあとも`speech.exe`は起動していなかった |
| ミュート同期（#208） | VRChatが動いていない状態でオンに切り替わった。使えない理由の案内は出る条件にしていない |
| 送らなかったメッセージの表示（#215） | 送信をオフにして送ると、ログに「VRChatには未送信（設定でオフ）」と出た |
| 起動中の画面（#228） | 通常の起動で、進み具合の印とロゴがVRCT-VOXのものになった。起動時にモデルを取得する画面と更新中の画面は表示していない |
| デスクトップの字幕オーバーレイ（#229） | 「設定」→「VR」でオンにすると字幕のウィンドウが開き、オフにすると閉じた。ウィンドウは最前面でクリックを通し、オンとオフを切り替えても前面のウィンドウ（文字コード表）は変わらなかった。2496×1664のモニターで、「画面の下」は(250, 1011)から幅1997・高さ545、「画面の上」はy=48に出た。送ったメッセージが原文と訳文で出て、表示時間（6秒）が過ぎると消えた。自分の発言は青、相手の発言は紫の文字で出た。アプリを閉じると字幕のウィンドウも閉じた。実物のVRChatの上と2枚目のモニターでの結果は下 |

実物のVRChatの起動と翻訳モデルの取得は利用者の承認を得て行いました。時間はこのPCでの1回の値です。この2つと起動中の画面、デスクトップの字幕オーバーレイは、同じ日にそれぞれの変更を入れた開発用のビルドで確かめています。

- VRChatの検出: Steamが動いていない状態からVRChatをデスクトップ表示（`--no-vr`）で起動しました。起動の操作から30.6秒でVRChatのプロセスが現れ、そこから17.7秒で「検出しました」に変わりました。VRChatを閉じるとプロセスが終わってから3.5秒で「検出できません」に戻りました。表示は0.5秒おきに読んでいます。
- 翻訳モデルの取得: 承認済みの翻訳モデル（`m2m100_418M-ct2-int8`、フォルダー全体で476 MB）をいったん別の場所へ移して取り直しました。「同意してダウンロード」を押してから約14秒で進み具合が100%になり、約18秒で「翻訳モデルを取得しました。翻訳をオンにします。」のお知らせが出て、約22秒で翻訳のスイッチがオンになりました。画面は2秒おきに読んでいます。そのあと日本語から英語への翻訳ができました。取得したモデルは検査に通った記録のファイル（`.weight_verified.json`）と一緒に`src-python/weights/ctranslate2`に入りました。回線の速さは測っていません。
- デスクトップの字幕オーバーレイ: VRChatをデスクトップ表示で起動し、字幕のウィンドウへ自分の発言と相手の発言を1行ずつ直接渡しました。VRChatへメッセージは送っていません。VRChatがウィンドウ表示（2514×1622）のときも、Alt+Enterでフルスクリーン（2496×1664の枠なしのウィンドウ）にしたときも、字幕はVRChatの画面の上に出ました。字幕の文字の位置にあるウィンドウはVRChatで、字幕を出しても前面のウィンドウはVRChatのままでした。画面はデスクトップ全体の画像を撮って見ています。フルスクリーンでは字幕がタスクバーの高さだけ画面の下の端から離れます。位置を作業領域から決めているためです。
- 2枚目のモニター: このPCにはモニターが2枚あります。主モニターが2496×1664（表示倍率125%）で、もう1枚が1920×1080（100%）です。メイン画面を2枚目へ移して字幕を出し直すと、帯はそのモニターの作業領域（1920×1032）の幅8割・高さ34%で、「画面の下」は(192, -430)から幅1536・高さ351、「画面の上」は(192, -1049)に出ました。左右の余白はどちらも192でした。文字の大きさは28pxのままでした。

この確認で見つけて直したものです。時間はこのPCでの1回の値です。

- メイン画面の「翻訳」を押してから確認の画面が開くまで22秒かかっていました。モデルがあるかを確かめる前に`transformers`を読み込んでいたためです。モデルを先に確かめるようにして0.1秒になりました。
- 初回のウィンドウの大きさ（870×654）を物理ピクセルとして当てていました。表示倍率125%では696×523 CSSピクセルになり、狭いレイアウトで開いて、サイドバーの相手の言語が設定のボタンに隠れます。保存した大きさがまだないときは表示倍率を掛けるようにして、1088×818物理ピクセル（871×655 CSSピクセル）で開くようになりました。
- VR UIの起動演出が本家VRCTのアイコンとロゴを出していました。VRCT-VOXのアイコンと、表示言語のロゴに替えました。偽のSteamVR（`tools/run_with_fake_vr.py`）に届いたランチャーの画像で確かめています。
- 起動中の画面が本家VRCTの顔のアイコン、説明の画像、ロゴを出していました。VRCT-VOXのアイコンとロゴに替えました（#228）。

## GPUの構成の模擬（2026-11-13）

このPCにはGPUが2つあるので、GPUが1つだけのPCやGPUのないPCでの動きは確かめられていませんでした。Vulkanのローダーの環境変数`VK_LOADER_DRIVERS_DISABLE`でドライバーを絞ると、`speech.exe`から見える装置を変えられます。アプリは自分の環境変数を`speech.exe`へそのまま渡すので、アプリの同梱サーバーにも同じ絞り方が効きます。

認識はQwen3-ASR 0.6B（Q8_0）、推論デバイスは「自動」です。男女2人の会話（96秒、読み上げの声）を実時間の速さで流しました。遅れは、声が終わってから確定した文が届くまでの時間です。

| 模擬した構成 | 絞り方 | 「自動」が選んだ装置 | 結果 |
|---|---|---|---|
| 単体のGPUだけ | `*ig*,*dzn*` | RTX 3060 Ti | 字幕と話者分離で、遅れは中央値1.02秒・90%で1.33秒。GPUメモリは約2.1 GB増えた |
| 内蔵GPUだけ | `*nv*,*dzn*` | Iris Xe | 字幕と話者分離で、遅れは中央値1.33秒・90%で1.63秒 |
| GPUなし | `*` | CPU | 字幕だけなら遅れは中央値2.71秒・90%で3.88秒で、CPUは約1.8コア分。話者分離を足すと間に合わず、遅れは中央値64秒・90%で122秒まで積み上がった |
| メーカーのドライバーがなく、Direct3D 12への変換層だけがある | `*nv*,*ig*` | Microsoft Direct3D12 (Intel(R) Iris(R) Xe Graphics) | モデルは読み込めるが、最初の計算で失敗してサーバーが終了した |

この確認で見つけて直したものです。

- CPUで動くサーバーに話者分離モデルがあると、字幕が大きく遅れました。話者分離モデルがCPUにあるときは、字幕の接続が話者分離を要求しないようにしました。字幕は話者のラベルなしで出ます。直したあと、GPUなしの構成で話者分離モデルを指定して流すと、確定した20個の字幕は遅れずに届きました。
- Direct3D 12への変換層しかない構成では、サーバーの終了が「予期せず停止しました」という一般的な案内になっていました。speech.cppが出す装置のエラーを見分けて、ドライバーの更新か別の推論デバイスの選択を勧める案内（`speech_server_device_failed`）を出すようにしました。

模擬で分かるのは、装置の選ばれ方と、このPCのCPUや内蔵GPUでの速さまでです。AMDのGPU、ほかのメーカーのドライバーの不具合、VRAMの小さいGPUは模擬できていません。Direct3D 12への変換層は、このPCのWindows（Insiderのbuild 26220）に入っていたものです。ほかのPCに入っているかは確かめていません。
## 未確認

- インストーラーで入れたアプリでの翻訳モデルの取得と保存先。開発用のビルドでは`src-python/weights`に保存します
- ミュート同期が使えないときの案内（送信先が別のマシンのときなど）の表示
- 起動してすぐに出る警告（#205）。10秒で消えるので、起動から数秒のうちに画面を読む必要があります
- マイクとスピーカーの音声認識から出た字幕を、VRChatの画面の上のデスクトップの字幕オーバーレイで見ること。表示倍率150%以上のモニターと、排他フルスクリーンのアプリの上も見ていません
- 実際のキーボードで押したホットキー
- 実際のスピーカーからの聴感。声がどれだけ参照に近づいたか
- Windowsの確認の画面が開いている間に、選んだ入力が別の機器へ変わった原因。開けない機器を別の機器へ切り替えるのは[仕様](../spec/data-and-persistence.md)どおりですが、当時は開けなかった理由がログに残りませんでした。今は`error.log`に残します
- VB-CABLEなど実物の仮想ケーブル、VRChatでの受信。このPCでは録音デバイスを開けません
- VRChatをVRで動かしたときのGPUとCPUの負荷。デスクトップ表示での負荷は上に記録しました
- VRChatの画面でのチャットボックスの表示
- すべてを同じGPUに載せたときにRVCが止まる頻度と、その原因。5回（合計約3時間40分）のうち1回止まりました。GPUが1つだけのPCでは`auto`でこの構成になります（上の模擬で、単体のGPUだけにすると`auto`がそのGPUを選びました）
- ファイアウォールのブロック規則があるexeから、実物のVRChatを見つけられるか。公開は規則があっても有効で、同じPCで公開した疑似サービスも聞き取れました
- CIの`backend-windows`でまれに起きるアクセス違反（0xC0000005）の原因。手元で繰り返しても再現せず、今は失敗時にCIのログへ`crash_trace.log`を出します
- 実物のヘッドセットとコントローラーでのVRの操作
- 実際のインストールと更新。この試験はCIが行います
- 実物のCPUだけのPCとAMDのGPU。GPUなしの構成は、このPCでドライバーを絞って模擬しました
- 2時間を超える連続運転
- 実マイクを含む長時間の運転
- VRChatと同時のSeed-VCを繰り返したときの結果と、声の途切れの聞こえ方。30分の1回は止まりませんでした
