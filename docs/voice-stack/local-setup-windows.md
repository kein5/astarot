# Using the voice features on Windows

[日本語版](#windowsで音声機能を使う日本語版)

On Windows you can use TTS, the bundled speech.cpp server, realtime captions and RVC. Seed-VC ran on the Python backend up to 0.4 and cannot be used in 0.5.0 (item 10 of the decisions needed in [core integration](core-integration.md)). Unlike on Linux, the app cannot create a virtual microphone. To get your voice to VRChat, use a virtual cable that you install separately.

The record of the checks of these steps on real hardware is in the [Windows voice verification record](windows-voice-report.md). A real microphone was checked only with a Surface's built-in microphone. The checks with the VRChat screen and with a real cable product are not finished yet.

## What you need

- A GPU driver. The bundled speech.cpp is the Vulkan build and uses `vulkan-1.dll`, which the driver installs. Without it the server does not start. There is no CPU-only build of speech.cpp for Windows. On a PC that has `vulkan-1.dll` but where no GPU is found, "Automatic" chooses the CPU. Captions alone also ran on the CPU ([simulated GPU setups](windows-voice-report.md#gpuの構成の模擬2026-11-13); the median delay was 2.7 seconds on a Core i7-1255U). When the GPU fails to compute (for example on a PC with no vendor driver and only a translation layer to Direct3D 12), a message suggests updating the driver or choosing another inference device.
- A virtual cable. Install by hand a product that pairs a playback end with a recording end, such as VB-CABLE. The app does not install it.
- Models. Download voice models from the download fields in Settings after checking their license and size.
- RVC runs on an NVIDIA GPU with CUDA support or on a CPU that can convert in real time. From 0.6.0 it can also use a DirectX 12 GPU through DirectML ("Voice changer (RVC)" below).

## Audio route

1. Under "TTS" in Settings, choose the cable's **playback end** (for example, CABLE Input) as the output device.
2. In VRChat, choose the cable's **recording end** (for example, CABLE Output) as the microphone.

The output device list shows only WASAPI devices. An MME or DirectSound choice saved by an earlier version stays in the list while that device exists, and it keeps working.

TTS and RVC both write to this output device. The Windows audio engine mixes the two sounds. Do not connect the physical microphone directly to the cable. If you choose the cable's recording end as the input, your voice would come back to you, so the app refuses to start (`vc_feedback_blocked`). Captions also refuse to read the cable that your voice goes out to (`realtime_endpoint_feedback`). A cable used for something else can be used for captions.

Mute applies both to TTS and to the voice sent to the output device. The OS has no way to block the sound, so the app writes silence in its place. The stream keeps running. When you choose "Suppress direct input" for reading out the microphone's translation, the app silences the voice the same way.

## Text to speech (TTS)

Under "TTS" in Settings, download a model and choose "Bundled server" as the server. Turning on the TTS switch on the main screen starts the server. You can also give the URL of a speech.cpp server that runs outside the app.

For the bundled server's inference device, you can choose "Automatic", "CPU" or "GPU", or pick one of the PC's GPUs by name. "Automatic" and "GPU" choose the discrete GPU with the most memory among those that can be used for compute. When there is only an integrated GPU, "Automatic" uses the CPU. When the saved GPU is not found, it is shown with "(not found)".

When the GPU driver's cache is empty (for example right after a driver update), the first start takes longer. With the RTX 3060 Ti in the tested PC, turning on the TTS switch took 41 seconds (with VRChat not running at the same time). While the bundled server starts, the app synthesizes one short sentence and discards the sound, so that the driver is ready. If the cache is still there, this step takes almost no time.

## Realtime captions

Under "Speech recognition" → "Realtime captions" in Settings, choose "Bundled server" as the server and set the ASR and VAD models. The microphone and listening switches on the main screen then use this route. If the server stays on "External server", the switches use the earlier recording (a cloud speech recognition API). The start button on the realtime captions settings page works with either choice.

Listening reads the sound that goes to the chosen speakers through WASAPI loopback. While nothing is playing, the app treats it as silence.

While the bundled server starts, the app recognizes noise once and discards the result, so that the GPU driver is ready. Even so, it waits up to 120 seconds for the first result on a connection. From the second result on, it stops when a result takes more than 15 seconds, and it does not reconnect automatically.

## Voice changer (RVC)

You can download the runtime from the "RVC runtime" field on the RVC settings page or under input forwarding in "Advanced". Once you check the license, the size and the location and agree, the app does the following automatically. Neither Git nor a development environment is needed.

RVC conversion is done by `astarot-rvc-worker.exe` (`native/rvc-runtime`), which is in the release package (from 2026-11-15). The RVC runtime is prepared as follows. The app offers the GPU runtime on a PC with the NVIDIA driver (`nvcuda.dll`) and the CPU runtime on a PC without it.

1. For the GPU runtime: ONNX Runtime 1.31.0 (the CUDA 13 build: `Microsoft.ML.OnnxRuntime.Gpu.Windows`, Microsoft's official package on NuGet) and NVIDIA's CUDA 13.4 and cuDNN 9.26 libraries (the PyPI wheels `nvidia-cuda-runtime`, `nvidia-cublas`, `nvidia-curand`, `nvidia-cuda-nvrtc` and `nvidia-cudnn-cu13`). For the CPU runtime, only the CPU build of ONNX Runtime 1.31.0 (`Microsoft.ML.OnnxRuntime`). The app checks each archive's size and SHA-256 and extracts only the DLLs the worker loads into `lib\`. It deletes each archive after extracting it. Up to 2026-11-18, ONNX Runtime was downloaded from GitHub releases. A runtime prepared at that time can be used as it is without preparing it again, because the files in `lib\` have the same names.
2. It downloads the base models (HuBERT's `config.json` and `pytorch_model.bin`, and `rmvpe.onnx`) and verifies their hashes.
3. It runs the worker's `--probe` to check that the downloaded libraries load and can compute. If the GPU runtime cannot use the GPU (the driver is older than 580, or the GPU is older than Turing, that is, the GTX 16 and RTX 20 series), it shows that conversion will run on the CPU and finishes.
4. If the same folder holds an earlier PyTorch-based runtime, it deletes that runtime's files (`venv`, `python`, `engine`, `engine.zip`, and the pinned `rmvpe.pt` and `preprocessor_config.json`). It keeps the model and audio files inside `engine` (`.pth`, `.index`, `.wav` and so on).

The Seed-VC runtime (a Python environment built with uv) does not appear in the download list in 0.5.0 (`native/voice-conversion/src/runtime.rs`). Settings that chose Seed-VC in an earlier version are moved to RVC when they are loaded.

| | RVC |
|---|---|
| Approximate download size | GPU about 1.8 GB, CPU about 0.6 GB |
| Free space needed | GPU about 2.7 GB, CPU about 0.8 GB |
| Size when finished | Not measured (the extracted files total about 2.1 GB for GPU and about 0.6 GB for CPU) |
| Python it depends on | None |

The table gives values for Windows. The RVC values are estimates calculated from the sizes of the pinned files; they were not measured by downloading on Windows. The values for Linux are in the [Linux steps](local-setup-linux.md#rvcの実行環境).

The runtime is stored in `vc_runtimes` in the app's data folder. If a download fails or is cancelled partway, the finished steps are skipped next time. When it finishes, press "Use this runtime" to save. To remove the runtime, delete this folder. The uninstaller's "Delete the application data" option also removes it.

Voice models are separate. Download them from the download field on the RVC settings page, or point to one whose rights you have checked.

From 0.6.0, you can also download "ONNX Runtime · DirectML" under "Models and runtime". Automatic selection tries CUDA, then DirectML on a discrete GPU, then the CPU. The CPU stops with `vc_cpu_too_slow` if it does not keep up in the speed check before starting.

On the Linux test PC, starting RVC took 2 to 9 seconds on the GPU (depending on how busy the PC was) and 9 to 11 seconds on the CPU. When converting on the CPU, the app groups the audio into 0.5-second chunks and converts them on a separate thread, and the converted voice arrives about 1.3 seconds late. If the CPU cannot keep up, conversion stops with `vc_capture_overrun`.

To keep sending your voice while RVC is stopped, use input forwarding. It sends the microphone sound to the output device as it is. In 0.5.0 the app (the Rust core) carries the audio. Up to 0.4 Python carried it, so a brief stall on the PC could cause a short dropout. How dropouts behave in 0.5.0 has not been checked. If the output device receives no audio for 2 seconds or more, the app treats it as disconnected and stops.

Conversion speed depends on how much of the GPU and CPU is free. Each block has to finish converting within its own length (`RVC_BLOCK_MS` in "Advanced"; the default, "Automatic", picks at start a length the GPU can keep up with; it was fixed at 80 ms before). A block that is late now and then is dropped and conversion continues, so the voice breaks for a moment. If half or more of the recent blocks are late, conversion stops with `vc_capture_overrun`. The app never plays the original sound in place of the converted voice. Seed-VC up to 0.4 measured the processing time at start and, if it could not keep up, reduced the reference voice length and the diffusion steps step by step. Running TTS or captions on the same GPU leaves even less margin. In a test on the tested PC with VRChat, TTS, captions and RVC all on an RTX 3060 Ti, RVC stopped after about 12 minutes in 1 of 4 runs of 30 minutes. It did not stop in 1 run of 2 hours. Seed-VC did not stop in 1 run of 30 minutes with the same setup, but more blocks were dropped for being late. The measurements are in the [verification record](windows-voice-report.md).

### Preparing it by hand

This is for developers. For RVC, prepare a folder with the layout below and point to it in Settings. The contents are the files pinned in `ort`, `nvidia_libraries` and `rvc_assets` in `native/voice-conversion/src/runtime.rs`, which `rvc_runtime` combines (with Python up to 0.4, `RVC_LIBRARIES` and `RVC_ASSETS` in `src-python/models/voice_conversion/runtime_setup.py`). The worker is `build\astarot-rvc-worker.exe`, which you build with `python tools/build_rvc_worker.py` (Rust is required).

```text
runtime\
  lib\        onnxruntime.dll, onnxruntime_providers_cuda.dll, onnxruntime_providers_shared.dll,
              cudart64_13.dll, cublas64_13.dll, cublasLt64_13.dll, curand64_10.dll,
              nvrtc64_130_0.dll, nvrtc-builtins64_134.dll, cudnn*64_9.dll
              (only onnxruntime.dll for CPU)
  assets\     hubert_base\config.json, hubert_base\pytorch_model.bin, rmvpe\rmvpe.onnx
```

The earlier PyTorch-based runtime (`venv`, `engine`) can no longer be used for RVC.

## When the microphone does not open

`asr_capture_stream_create_failed` means that the microphone could not be opened. Check whether another app holds it, and check "Privacy & security" → "Microphone" in Windows Settings.

Some Windows builds (the one checked was Insider Beta build 26220) ask for microphone permission for each desktop app. The first time an app opens the microphone, a prompt appears, and opening waits until you answer. ASTAROT waits 120 seconds, and if there is still no answer it stops with `asr_capture_start_timeout`. The prompt appears on the desktop, so it cannot be seen from inside a VR headset.

If the process ends without an answer, the exe at the same location is refused from then on without a prompt and gets `asr_capture_stream_create_failed`. This is the same for MME, DirectSound and WASAPI. An exe at another location gets a new prompt. A development build (such as `src-tauri\target\debug\astarot.exe`) is treated the same way.

The microphone is also refused without a prompt while another system prompt, such as the firewall prompt, is open. This refusal is not recorded, so if you answer that prompt and start again, the microphone prompt appears. Up to 0.4, a sidecar at a new location raised the firewall prompt at startup, so the two prompts could overlap on the first start. From 0.5.0 the core listened inside the app's process, so the prompt was about the app's executable. After the fix in #442, the app does not raise the firewall prompt (next paragraph).

The firewall prompt appeared because the mDNS used to advertise OSCQuery listened on UDP port 5353 on all interfaces (`native/adapters/src/osc/mdns.rs` in 0.5.x, Python's zeroconf up to 0.4). Windows asks about each program that receives from the network, per executable path. While the prompt was showing, a rule that blocks incoming traffic for that path already existed, and choosing to allow turned it into an allow rule (2026-11-21). For a path with a rule, no prompt appeared even when the network type differed from the rule's. The prompt appeared every time a version's ZIP was extracted to a different folder, or the install location or the executable's name changed, because the path changed (#442).

After the fix in #442, mDNS on Windows does not receive on port 5353. For each interface it creates a socket on `0.0.0.0` with a port the OS picks, and only sends, with TTL 0. A send-only socket raises no prompt and creates no rule. The app makes up for not receiving as follows. Linux receives on port 5353 as before.

- It announces the advertised services again every 5 seconds. VRChat started after the app also gets them within 5 seconds.
- Discovery queries are sent from a port other than 5353, so they are mDNS legacy unicast (RFC 6762, section 6.7), and the answers come straight back to the socket that asked. The TTL of these answers is at most 10 seconds, so the query interval is kept at 5 seconds or less.
- Two peers that do not receive cannot find each other. To test advertising and discovery on Windows, provide a peer that receives on port 5353 (`LoopbackPeer` in `native/adapters/tests/osc.rs`).

The fixed mDNS was run in a test exe placed at a path with no rule (2026-11-21, Windows 11, two IPv4 interfaces): no prompt appeared and no rule was added. In place of VRChat, a peer that behaves like MeaMod.DNS, which VRChat uses, ran from an exe with an allow rule. This peer receives on port 5353 on every interface except loopback, and answers queries from ports other than 5353 directly to the sender. When the peer was started first, the app found it at once. When the peer was started 20 seconds later, the peer received the app's announcement within 1 second, and the app found the peer in about 2 seconds. After the peer was stopped, the app stopped finding it in about 5 seconds. A check with the real VRChat, and a check at a path that got a block rule when the prompt was cancelled in 0.5.x, have not been done yet.

When you try a version up to 0.5.x, choose to allow at the prompt. According to Microsoft's documentation, cancelling or closing the prompt creates rules that block incoming traffic for that program, one for TCP and one for UDP ([Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)). VRChat was started with `--no-vr` to compare an exe with an allow rule and an exe with a block rule (2026-11-09): in both, OSCQuery advertising was active and the service was visible from another process. A mock `_oscjson._tcp` service advertised on the same PC was found by a program at a path with a block rule just as by a program with an allow rule (2 times). Whether the real VRChat can be found from an exe with a block rule has not been checked.

## Tests that need no models

The versions of the development tools are pinned in `mise.toml` ([development guide](../development.md#用意するツール)). Install them first with `mise install`.

```powershell
mise install
mise run setup:headless
mise run check:voice
```

These tests do not connect to real devices. Up to 0.5, PyAudioWPatch, which the Python backend used to connect to real devices, was installed in the `.venv` of `mise run setup:app`; it was removed with the backend in 0.6.0 (#285).

---

# Windowsで音声機能を使う（日本語版）

Windowsでは、TTS、同梱のspeech.cppサーバー、リアルタイム字幕、RVCを使えます。Seed-VCは0.4までのPythonバックエンドで動いていたもので、0.5.0では使えません（[中核の統合](core-integration.md)の「判断が要ること」の10）。Linuxと違い、アプリは仮想マイクを作れません。VRChatへ声を届けるには、別途インストールした仮想ケーブルを使います。

この手順の実機確認の記録は[Windows音声の検証記録](windows-voice-report.md)にあります。実マイクはSurfaceの内蔵マイクでだけ確かめました。VRChatの画面、実物のケーブル製品での確認はまだ終わっていません。

## 必要なもの

- GPUドライバー。同梱のspeech.cppはVulkan版で、ドライバーが入れる`vulkan-1.dll`を使います。ないとサーバーは起動しません。speech.cppのWindows版にCPU専用の配布はありません。`vulkan-1.dll`があってGPUが見つからないPCでは、「自動」はCPUを選びます。字幕だけならCPUでも動きました（[GPUの構成の模擬](windows-voice-report.md#gpuの構成の模擬2026-11-13)。Core i7-1255Uで遅れの中央値は2.7秒）。GPUが計算に失敗するとき（メーカーのドライバーがなく、Direct3D 12への変換層だけがあるPCなど）は、ドライバーの更新か別の推論デバイスを勧める案内が出ます。
- 仮想ケーブル。VB-CABLEなど、再生側と録音側の組になった製品を手動で入れます。アプリは入れません。
- モデル。音声モデルは設定画面の取得欄から、ライセンスとサイズを確認して取得します。
- RVCはCUDA対応のNVIDIAのGPUか、実時間で変換できるCPUで動きます。0.6.0からはDirectMLでDirectX 12対応のGPUも使えます（下の「RVC」）。

## 音声の経路

1. 設定の「TTS」で、出力デバイスにケーブルの**再生側**（例: CABLE Input）を選びます。
2. VRChatのマイクに、ケーブルの**録音側**（例: CABLE Output）を選びます。

出力デバイスの一覧はWASAPIの機器だけを表示します。以前の版で保存したMMEやDirectSoundの選択は、その機器がある間は一覧に残り、そのまま動きます。

TTSとRVCは、どちらもこの出力デバイスに書き込みます。Windowsの音声エンジンが2つの音を混ぜます。物理マイクをケーブルへ直接つながないでください。入力にケーブルの録音側を選ぶと、声が自分に戻るので開始を拒否します（`vc_feedback_blocked`）。字幕も、声の出力先のケーブルを読もうとすると拒否します（`realtime_endpoint_feedback`）。別の用途のケーブルは字幕に使えます。

ミュートは、TTSと、出力デバイスへ送る声の両方に効きます。OS側に遮断の仕組みがないので、アプリが無音に置き換えて書き込みます。ストリームは動き続けます。マイクの訳文読み上げで「直接音声を止める」を選ぶと、同じ方法で声を無音にします。

## TTS

設定の「TTS」でモデルを取得し、サーバーに「同梱サーバー」を選びます。メイン画面のTTSスイッチをオンにすると、サーバーが起動します。外部で動かすspeech.cppサーバーのURLを指定することもできます。

同梱のサーバーの推論デバイスは、「自動」「CPU」「GPU」のほかに、PCのGPUを名前で選べます。「自動」と「GPU」は、計算に使える独立GPUのうちメモリが最も多いものを選びます。内蔵GPUしかないときは「自動」でCPUを使います。保存したGPUが見つからないときは「見つかりません」と表示します。

GPUドライバーのキャッシュが空のとき（ドライバーを更新した直後など）は、最初の起動に時間がかかります。検証したPCのRTX 3060 Tiでは、TTSのスイッチをオンにするまで41秒かかりました（VRChatを同時に動かしていない場合）。アプリは同梱のサーバーの起動中に短い文を1回合成して音を捨て、ドライバーの準備を済ませます。キャッシュが残っていれば、この処理はほとんど時間がかかりません。

## リアルタイム字幕

設定の「音声認識」→「リアルタイム字幕」で、サーバーに「同梱サーバー」を選び、ASRとVADのモデルを設定します。すると、メイン画面のマイクと聞き取りのスイッチがこの経路を使います。「外部サーバー」のままなら、スイッチは従来の録音（クラウドの音声認識API）を使います。リアルタイム字幕の設定画面の開始ボタンは、どちらの選択でも使えます。

聞き取りはWASAPIのループバックで、選んだスピーカーに流れる音を読みます。何も再生していない間は、無音として扱います。

同梱のサーバーの起動中に、ノイズを1回認識して結果を捨て、GPUドライバーの準備を済ませます。それでも接続の最初の結果は120秒まで待ちます。2件目からは15秒を超えると止まり、自動では再接続しません。

## RVC

RVCの設定画面、または「高度な設定」の入力の転送にある「RVCの実行環境」の欄から、実行環境を取得できます。ライセンス、サイズ、保存先を確認して同意すると、次を自動で行います。Gitも開発環境もいりません。

RVCの変換は、配布物に入っている`astarot-rvc-worker.exe`（`native/rvc-runtime`）が行います（2026-11-15から）。RVCの実行環境の準備は、次のとおりです。NVIDIAのドライバー（`nvcuda.dll`）があるPCにはGPU用、ないPCにはCPU用を出します。

1. GPU用は、ONNX Runtime 1.31.0（CUDA 13版。NuGetにあるMicrosoftの公式パッケージ`Microsoft.ML.OnnxRuntime.Gpu.Windows`）と、NVIDIAのCUDA 13.4とcuDNN 9.26のライブラリ（PyPIの`nvidia-cuda-runtime`、`nvidia-cublas`、`nvidia-curand`、`nvidia-cuda-nvrtc`、`nvidia-cudnn-cu13`のwheel）。CPU用は、ONNX Runtime 1.31.0のCPU版（`Microsoft.ML.OnnxRuntime`）だけです。アーカイブごとにサイズとSHA-256を照合し、ワーカーが読み込むDLLだけを`lib\`に取り出します。アーカイブは取り出したあとに消します。2026-11-18まではONNX RuntimeをGitHubのリリースから取得していました。そのときに準備した実行環境は、`lib\`のファイルが同じ名前なので、準備し直さずにそのまま使えます。
2. 基礎モデル（HuBERTの`config.json`と`pytorch_model.bin`、`rmvpe.onnx`）を取得して、ハッシュを検証します。
3. ワーカーの`--probe`で、取得したライブラリが読み込めて計算できることを確かめます。GPU用でGPUを使えないとき（ドライバーが580より古い、GPUがTuring＝GTX 16・RTX 20シリーズより前）は、CPUで変換すると表示して完了します。
4. 同じフォルダーに以前のPyTorch形式の実行環境があれば、そのファイル（`venv`、`python`、`engine`、`engine.zip`、固定の`rmvpe.pt`と`preprocessor_config.json`）を削除します。`engine`の中のモデルや音声のファイル（`.pth`、`.index`、`.wav`など）は残します。

Seed-VCの実行環境（uvで作るPythonの環境）は、0.5.0では取得の一覧に出ません（`native/voice-conversion/src/runtime.rs`）。以前の版でSeed-VCを選んでいた設定は、読み込むときにRVCへ移します。

| | RVC |
|---|---|
| 通信量の目安 | GPU用 約1.8 GB、CPU用 約0.6 GB |
| 必要な空き容量 | GPU用 約2.7 GB、CPU用 約0.8 GB |
| 完了後の大きさ | 未計測（取り出すファイルの合計はGPU用 約2.1 GB、CPU用 約0.6 GB） |
| 依存のPython | なし |

表はWindowsでの値です。RVCの値は、固定したファイルの大きさから計算した目安で、Windowsで取得して測ってはいません。Linuxでの値は[Linuxの手順](local-setup-linux.md#rvcの実行環境)にあります。

保存先はアプリのデータフォルダーの`vc_runtimes`です。途中で失敗したり中止したりしても、終わった手順は次回に飛ばします。終わったら「この実行環境を使う」を押して保存します。消したいときはこのフォルダーを削除します。アンインストーラーの「データを削除」でも消えます。

声のモデルは別です。RVCの設定画面の取得欄から取得するか、権利を確認したものを指定します。

0.6.0からは「モデルと実行環境」で「ONNX Runtime · DirectML」も取得できます。自動選択ではCUDA、独立GPUのDirectML、CPUの順に試します。CPUは開始前の速度確認に間に合わないと `vc_cpu_too_slow` で止まります。

RVCの開始は、Linuxの検証PCでGPUなら2〜9秒（PCの混み具合で変わります）、CPUなら9〜11秒でした。CPUで変換するときは、0.5秒ずつまとめて別のスレッドで変換し、変換した声は約1.3秒遅れて届きます。CPUが追いつかないと`vc_capture_overrun`で停止します。

RVCを止めている間も声を届けたいときは、入力の転送を使います。マイクの音をそのまま出力デバイスへ送ります。0.5.0ではアプリ（Rustの中核）が音声を運びます。0.4まではPythonが運んでいたので、PCが一瞬詰まると短く途切れることがありました。0.5.0での途切れ方は確かめていません。出力デバイスが2秒以上音声を受け取らないときは、外れたものとして止めます。

変換の速さはGPUとCPUの空きに左右されます。1ブロックは、その長さ（「高度な設定」の`RVC_BLOCK_MS`。既定の「自動」では、開始するときにGPUで間に合う長さを選びます。以前は80 msに固定）のうちに変換し終える必要があります。一時的に遅れたブロックは捨てて続け、声が短く途切れます。直近の半分以上が遅れると、`vc_capture_overrun`で停止します。声の代わりに原音を流すことはありません。0.4までのSeed-VCは、開始時に処理時間を測り、間に合わないときは参照音声の長さと拡散ステップを段階的に減らしていました。TTSや字幕を同じGPUで動かすと、余裕はさらに小さくなります。検証したPCでVRChat、TTS、字幕、RVCをすべてRTX 3060 Tiに載せた試験では、30分の4回のうち1回、RVCが約12分で止まりました。2時間の1回では止まっていません。Seed-VCを同じ構成で30分動かした1回では止まりませんでしたが、遅れて捨てたブロックは増えました。測定は[検証記録](windows-voice-report.md)にあります。

### 手動で用意する場合

開発者向けです。RVCは次の構成のフォルダーを用意して、設定で指定します。中身は`native/voice-conversion/src/runtime.rs`の`ort`、`nvidia_libraries`、`rvc_assets`（`rvc_runtime`がまとめる）に固定したファイルです（0.4までのPythonでは`src-python/models/voice_conversion/runtime_setup.py`の`RVC_LIBRARIES`と`RVC_ASSETS`）。ワーカーは`build\astarot-rvc-worker.exe`で、`python tools/build_rvc_worker.py`でビルドします（Rustが必要です）。

```text
runtime\
  lib\        onnxruntime.dll、onnxruntime_providers_cuda.dll、onnxruntime_providers_shared.dll、
              cudart64_13.dll、cublas64_13.dll、cublasLt64_13.dll、curand64_10.dll、
              nvrtc64_130_0.dll、nvrtc-builtins64_134.dll、cudnn*64_9.dll
              （CPU用はonnxruntime.dllだけ）
  assets\     hubert_base\config.json、hubert_base\pytorch_model.bin、rmvpe\rmvpe.onnx
```

以前のPyTorchを使う実行環境（`venv`、`engine`）は、RVCでは使えなくなりました。

## マイクが開けないとき

`asr_capture_stream_create_failed`は、マイクを開けなかったことを示します。ほかのアプリの占有と、Windowsの設定の「プライバシーとセキュリティ」→「マイク」を確かめます。

一部のWindows（確認したのはInsider Beta build 26220）は、デスクトップアプリごとにマイクの許可を確認します。初めて開くときに確認の画面が出て、答えるまで開く処理が止まります。ASTAROTは120秒待ち、それでも答えがなければ`asr_capture_start_timeout`で止まります。確認の画面はデスクトップに出るので、VRのヘッドセットの中からは見えません。

答えないままプロセスが終わると、同じ場所のexeは次から確認なしで拒否され、`asr_capture_stream_create_failed`になります。MME、DirectSound、WASAPIのどれでも同じです。別の場所のexeには、改めて確認が出ます。開発用のビルド（`src-tauri\target\debug\astarot.exe`など）から試すときも同じ扱いです。

ファイアウォールの確認など、別のシステムの確認が開いている間も、確認なしで拒否されます。こちらは記録に残らないので、その確認に答えてから開始し直せば確認が出ます。0.4までは、新しい場所のサイドカーが起動時にファイアウォールの確認を出したので、最初の開始で重なることがありました。0.5.0からは中核がアプリのプロセスの中で待ち受けたので、確認の対象はアプリの実行ファイルになりました。#442で直したあとは、アプリはファイアウォールの確認を出しません（次の段落）。

ファイアウォールの確認は、OSCQueryの公開に使うmDNSが全インターフェースのUDP 5353番で待ち受けていたために出ました（0.5.xは`native/adapters/src/osc/mdns.rs`、0.4まではPythonのzeroconf）。Windowsは、ネットワークから受け取るプログラムを実行ファイルのパスごとに確認します。確認が出ている間に、そのパスの受信をブロックする規則がもうできていて、許可を選ぶと許可の規則になりました（2026-11-21）。規則のあるパスでは、ネットワークの種類が規則と違っても確認は出ませんでした。版ごとのZIPを別のフォルダーに展開したときや、インストール先や実行ファイルの名前が変わったときに毎回出たのは、パスが変わったためです（#442）。

#442で直したあと、WindowsのmDNSは5353番で受け取りません。インターフェースごとに`0.0.0.0`とOSが選ぶポートでソケットを作り、TTL 0で送るだけにします。送るだけのソケットには確認が出ず、規則もできません。受け取らない分は次のように補います。Linuxは前と同じく5353番で受け取ります。

- 公開しているサービスを5秒ごとに知らせ直します。アプリより後に起動したVRChatにも、5秒以内に届きます。
- 探索の問い合わせは5353番以外のポートから送るので、mDNSのlegacy unicast（RFC 6762の6.7節）になり、答えは問い合わせたソケットに直接届きます。この答えのTTLは10秒までなので、問い合わせの間隔は5秒より長くしません。
- 受け取らないものどうしは、互いを見つけられません。Windowsで公開と探索を試験するときは、5353番で受け取る相手を用意します（`native/adapters/tests/osc.rs`の`LoopbackPeer`）。

直したmDNSを規則のないパスに置いた試験用のexeで動かすと（2026-11-21、Windows 11、IPv4のインターフェースが2つ）、確認は出ず、規則も増えませんでした。VRChatの代わりには、VRChatが使うMeaMod.DNSと同じように動く相手を、許可の規則のあるexeで動かしています。この相手はloopback以外の全インターフェースの5353番で受け取り、5353番以外から来た問い合わせには問い合わせ元へ直接答えます。先に相手を起動したときは、アプリの側はすぐに相手を見つけました。相手を20秒後に起動したときは、相手は1秒以内にアプリの知らせを受け取り、アプリの側は2秒ほどで相手を見つけました。相手を止めると、5秒ほどで見つからなくなりました。実物のVRChatとの確認と、0.5.xで確認をキャンセルしてブロックの規則ができたパスでの確認は、まだしていません。

0.5.xまでの版を試すときは、確認で許可を選びます。Microsoftの説明では、確認をキャンセルしたり閉じたりすると、そのプログラムの受信をブロックする規則がTCPとUDPに1つずつできます（[Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)）。VRChatを`--no-vr`で起動して、許可の規則があるexeとブロックの規則があるexeを比べたところ（2026-11-09）、どちらもOSCQueryの公開は有効になり、別のプロセスからサービスが見えました。同じPCで公開した疑似の`_oscjson._tcp`サービスを、ブロックの規則があるパスのプログラムから検索すると、許可の規則があるプログラムと同じように見つかりました（2回）。実物のVRChatをブロックの規則があるexeから見つけられるかは、確かめていません。

## モデル不要のテスト

開発に使うツールの版は`mise.toml`で固定しています（[開発ガイド](../development.md#用意するツール)）。先に`mise install`で入れておきます。

```powershell
mise install
mise run setup:headless
mise run check:voice
```

このテストは実デバイスに接続しません。0.5まではPythonのバックエンドで実デバイスに接続するためのPyAudioWPatchを`mise run setup:app`の`.venv`に入れていましたが、バックエンドと一緒に0.6.0で消しました（#285）。
