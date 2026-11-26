# P1 Linux / CachyOS / WiVRn

[日本語版](#p1-linux--cachyos--wivrn日本語版)

This page gives the steps for development and CLI tests in a source checkout. For the released Linux app, see the [AppImage guide](appimage.md) and the [Linux build steps](linux-build-pipeline.md).

The verification notes describe the state at the time of each piece of work from 2026-10-27 on. For the CLI → virtual microphone → VRChat desktop route below, the user confirmed the voice by playing back VRChat's built-in microphone test. The meter stopping after a stop partway through was also confirmed. Not verified: the whole sequence of the real VRCT app sending to VRChat's audio and OSC at the same time, reception by other users and an HMD. A single PoC with the already downloaded Irodori-TTS MF / speech.cpp 0.8.11 and [30 measurements](benchmarks.md) on a dedicated PipeWire graph with 0.9.0 were confirmed. No new models were downloaded.

## Native startup status

From 0.5.0 the app's backend is the Rust core running inside the app, and the Python sidecar for development is gone ([core integration](core-integration.md)).
The Python backend, its Python environment (`.venv_linux`, `mise run setup:app`), the CLI and the tests were removed in 0.6.0 (#285).

### Development environment

The versions of Python, uv and Rust are pinned in `mise.toml` ([development guide](../development.md#用意するツール)).

```sh
mise install
mise run setup:headless   # dependencies for tests without models (build/dev/headless-venv)
mise run setup:resources  # src-tauri/bin/_internal, read by tauri dev and cargo check
```

For `setup:resources`, see the [development guide](../development.md#tauriが読む資源を用意する).

### Prepare the bundled server and the audio helpers

In a development launch, the backend reads the bundled speech.cpp server and the audio route helpers from `build/` in the source tree.
A new checkout or worktree has no `build/`, so unless you prepare it, pressing "Start server" under "TTS" or "Speech recognition" in Settings fails.

```sh
mise run build:voice-gate
python tools/speechcpp_bundle.py --variant linux-x64-vulkan --archive /path/to/speech-0.11.2-linux-x64-vulkan.zip --output build/speechcpp
python tools/speechcpp_bundle.py --variant linux-x64-cpu --archive /path/to/speech-0.11.2-linux-x64-cpu.zip --output build/speechcpp-cpu
```

`build_voice_gate.py` builds `build/astarot-voice-gate`, `astarot-source-bridge` and `astarot-screen-capture`. It needs `libpipewire-0.3-dev`.
Without `astarot-screen-capture`, "Share a window…" in chat reading stops with `screencast_helper_missing` (`src-tauri/src/portal_screencast.rs`).
Up to 0.5.x, `vrct-vc-worker` and `vrct-asr-capture` were also built and bundled. `vrct-vc-worker` was the helper that the Python backend (up to 0.4) used to start the bundled server and voice conversion, and `vrct-asr-capture` was the recording helper for speech recognition on Linux. The core no longer starts either of them, so 0.6.0 removed them together with their source (ADR-014, #809).

`speechcpp_bundle.py` takes an archive with a pinned version and SHA-256 and places the `speech` binary and the bundled license documents in the output folder. As in the release package, the Vulkan build goes in `build/speechcpp` and the CPU build in `build/speechcpp-cpu`. `bundle.json` decides which build a folder holds; the folder's name does not.
If you do not have the archive locally, give `--download` instead of `--archive` and the tool downloads it. It goes online only when `--download` is given.
One of the two builds is enough. With only the CPU build, inference runs only on the CPU. With only the Vulkan build you can still choose "CPU", but it needs the Vulkan loader (`libvulkan.so.1`). If the output folder already exists, the tool stops without overwriting it. With `--replace`, it keeps a build of the same version as it is and replaces only the parts of a different version.
If you have already built a Linux candidate, you may copy `build/linux/build/speechcpp` and `build/linux/build/speechcpp-cpu` with `cp -a`.
The app checks the version and the hashes at every start and does not accept symbolic links, so copy the files instead of linking them.
If neither of the two is found or passes the check, starting the bundled server stops with `speech_bundle_missing_or_invalid`.

Models downloaded in a development launch are saved in `downloaded_models/` in the same folder as `config.json`. In a development build, unless `ASTAROT_CONFIG_DIR` is set, that folder is the one that holds the executable (such as `src-tauri/target/debug/`, which git does not track) (`folders` in `src-tauri/src/backend_host.rs`). The Python backend (up to 0.4) saved models in `src-python/downloaded_models/`.

On Linux, chat reading captures the VRChat window through X11/XWayland. While SteamVR runs, it reads the headset image through OpenGL (confirmed only with a fake SteamVR). A native Wayland window can be read once the user shares it under "Chat reading" in Settings (XDG ScreenCast portal; a development build uses `build/astarot-screen-capture`). Recording for the legacy ASR is not supported.
On 2026-11-11 this was confirmed with the real VRChat running on Proton (two clients in a local test instance) and the real PP-OCR models (CachyOS, KDE Plasma 6.8, Wayland). The X11/XWayland route read the chat that the other client sent. The sharing route read VRChat running inside a nested Xwayland (a native Wayland window as KWin sees it) once that window was shared. At the time this was recorded as "5 of 6 sentences (development build), 4 (AppImage)", but that was a mistake in the checking procedure, not a failure to read (corrected on 2026-11-12). The message log draws only the lines visible on screen, so the lines after the log filled the screen were not counted. VRChat inside gamescope and VRChat on Wine's Wayland driver have not been confirmed (with gamescope 3.17 the window crashed, and the Proton-GE build used did not accept the Wayland driver setting). For pasting in voice typing mode, the text was confirmed to arrive in the real VRChat chat box. Desktops other than KDE, such as GNOME, have not been confirmed.
On 2026-11-12 the same setup was measured again by sending 12 sentences (Japanese and English, including sentences long enough to wrap to 2 lines) every 10 seconds (development build: develop `5d4b1a16` plus the changes of #196). Both the X11/XWayland route and the sharing route read all 12 sentences, and the time from sending to appearing in the log was 0.6 to 1.5 seconds (4.2 seconds for one sentence on X11). The speech bubble detection model was not installed, so text on signs also mixes into the results. The test world moves the speaker and the camera every few seconds, so the distance and the background differ for each sentence. During the check, the title of the speaker's window was changed so that the search by name would not pick up the speaker's window (both clients are named `VRChat`).
This procedure downloads only the Python dependencies and does not run the download scripts for ASR/TTS/VC weights.
Downloading Python and the package traffic need a network connection. For the system GTK/WebKitGTK dependencies, see [Tauri's official prerequisites](https://v2.tauri.app/start/prerequisites/).

Up to 0.4, `VRCT_DEV_VENV=.venv_linux` at app start selected this environment. The 0.5.0 app does not start Python, so it does not read this variable.
`ASTAROT_CONFIG_DIR=/absolute/path/to/state` (the 0.6.x releases also read `VRCT_CONFIG_DIR`, its name up to 0.5.x) changes where `config.json`, the logs, `downloaded_models/` and `vc_runtimes/` are stored. Without it, the usual locations are used.
It does not change the location of the bundled resources (`build/`) or the UI resources. You do not need to copy the existing settings into the test directory.
Up to 0.4, turning on automatic model download under "Other" downloaded the built-in translation model at the next start. 0.5.0 stopped the download at start and removed the switch from Settings (the setting key remains for compatibility). Models are downloaded only through an explicit action on the consent screen.

The automated startup test of the Python backend (`tests/platform/test_native_backend.py`) was removed with the backend in 0.6.0. Tests such as `native/core/tests/lifecycle.rs` check the core's startup, the carry-over of settings and restarts.

## RVC runtime

On Linux (x86-64) too, you can download the RVC runtime from the app. The screens and the flow are the same as on Windows. The Seed-VC runtime belonged to the Python backend up to 0.4 and does not appear in the list in 0.5.0 (`native/voice-conversion/src/runtime.rs`). What this section says about Seed-VC is a record of 0.4 and earlier. On Linux, the app uses the managed audio route and takes the input for voice conversion from PipeWire. The "RVC runtime" field is under "Settings" → "RVC" or under "Input forwarding" in "Advanced". Press "Review download" and check the license, the size and the location. The download starts when you agree. Nothing is downloaded until you agree.

You need the following.

- An x86-64 PC. On any other PC, the download field is not shown.
- To convert on the GPU, an NVIDIA GPU and the NVIDIA driver. The app checks whether the driver is running by whether `/proc/driver/nvidia/version` exists. Where this file is missing, as with nouveau, it offers the CPU runtime.

RVC conversion is done by `astarot-rvc-worker` (`native/rvc-runtime`), which is in the release package (from 2026-11-15). RVC can be downloaded without the driver. The app offers the GPU runtime on a PC with the driver and the CPU runtime on a PC without it. Once you agree, it does the following in order.

1. For the GPU runtime, it downloads ONNX Runtime 1.31.0 (the CUDA 13 build: `Microsoft.ML.OnnxRuntime.Gpu.Linux`, Microsoft's official package on NuGet) and NVIDIA's CUDA 13.4 and cuDNN 9.26 libraries (the PyPI wheels `nvidia-cuda-runtime`, `nvidia-cublas`, `nvidia-curand`, `nvidia-cuda-nvrtc` and `nvidia-cudnn-cu13`). For the CPU runtime, it downloads only the CPU build of ONNX Runtime 1.31.0 (`Microsoft.ML.OnnxRuntime`). It checks each archive's size and SHA-256, extracts only the `.so` files the worker loads into `lib/`, and deletes the archive. Up to 2026-11-18, ONNX Runtime was downloaded from GitHub releases. A runtime prepared at that time can be used as it is without preparing it again, because the files in `lib/` have the same names.
2. It downloads the base models (HuBERT's `config.json` and `pytorch_model.bin`, and `rmvpe.onnx`) and verifies their hashes.
3. It runs the worker's `--probe` to check that the downloaded libraries load and can compute. If the GPU runtime cannot use the GPU (the driver is older than 580, or the GPU is older than Turing, that is, the GTX 16 and RTX 20 series), it shows that conversion will run on the CPU and finishes.
4. If the same folder holds an earlier PyTorch-based runtime, it deletes that runtime's files (`venv`, `python`, `engine`, `engine.zip`, and the pinned `rmvpe.pt` and `preprocessor_config.json`). It keeps the model and audio files inside `engine` (`.pth`, `.index`, `.wav` and so on).

With Seed-VC up to 0.4, agreeing started the following steps in order. Neither Git nor a development environment was needed.

1. It downloads a pinned version of `uv`: the official release `uv-x86_64-unknown-linux-gnu.tar.gz`, checked against its size and SHA-256.
2. It installs Python and the hash-pinned dependencies (`integrations/seed_vc/requirements.lock`).
3. It downloads the engine itself (a GitHub archive) and verifies its contents. Before extracting, it checks the number of entries, the extracted size, the compression ratio, the paths and the entry types (regular files and folders only). After extracting, and after applying the bundled patch for Seed-VC, it compares a digest made from the names and contents of all files with a pinned value. If they do not match, it deletes what it extracted and does not install (security audit SEC-04).
4. It downloads the base models and verifies their hashes.
5. It checks `torch.cuda.is_available()` with the runtime's Python.

| | RVC | Seed-VC (up to 0.4) |
|---|---|---|
| Approximate download size | GPU about 1.9 GB, CPU about 0.6 GB | About 6.4 GB |
| Free space needed | GPU about 3.3 GB, CPU about 0.7 GB | About 18 GB |
| Size when finished | GPU about 2.5 GB, CPU about 0.55 GB | About 9.5 GB |
| Python it depends on | None | 3.11 |

The RVC column holds values from one download of each runtime on 2026-11-15, on the same PC as below. The download size is the catalog value (the total of the pinned files: 1.87 GB for GPU, 0.56 GB for CPU), the size when finished is from `du -sh`, and the time taken was 260 seconds for GPU and 10 seconds for CPU. The free space needed is an estimate: the extracted files and the base models plus the largest archive (cuDNN for GPU, 0.52 GB), rounded up. The peak during the download was not measured.

The Seed-VC column holds values measured from one download of each runtime on one PC on 2026-11-11 (CachyOS, RTX 4080 SUPER, NVIDIA driver 620.70.06, btrfs, wired connection). The download size is the number of bytes the network device received during the download (4.83 GB for RVC, 6.28 GB for Seed-VC). The free space needed is the peak size of the folder during the download (`du -sb`), rounded up: 15.6 GB for RVC and 17.5 GB for Seed-VC. The `uv` cache and the install location are counted separately. When the file system supports it, `uv` shares data between the two (reflink or hard link), and the space actually used is then smaller. The time taken was 62 seconds for RVC and 139 seconds for Seed-VC, but it varies widely with the connection speed.

The runtime is stored in `vc_runtimes` in the same folder as `config.json`. In the released app this is `~/.config/astarot/vc_runtimes` (`~/.config/vrct-vox/vc_runtimes` up to 0.5.x). In a development launch from source, unless `ASTAROT_CONFIG_DIR` is set, it is `vc_runtimes` in the folder that holds the executable (such as `src-tauri/target/debug/`, which git does not track; with the Python backend up to 0.4, `src-python/vc_runtimes`). If a download fails or is cancelled partway, the finished steps are skipped next time. With Seed-VC up to 0.4, cancelling stopped `uv` together with the processes `uv` had started, and `uv` also ended when the app crashed. When it finishes, press "Use this runtime" to save. To remove the runtime, delete this folder.

Voice models are separate. Download them from the download field on the RVC settings page, or point to one whose rights you have checked. For Seed-VC up to 0.4, you specified a reference voice you had permission to use (a WAV of 1 to 30 seconds).

What was confirmed is the download on the PC above, and starting the RVC and Seed-VC workers with the downloaded runtimes to convert synthesized speech. Audio quality, other distributions and downloading from the released app (AppImage) have not been checked.

To prepare it by hand, RVC uses the `lib/` and `assets/` layout (the same as in the [Windows steps](local-setup-windows.md#手動で用意する場合); the `.so` names follow `ort` and `nvidia_libraries` in `native/voice-conversion/src/runtime.rs`, which `rvc_runtime` combines). Seed-VC up to 0.4 followed the steps in the [Seed-VC README](https://github.com/kein5/astarot/blob/v0.5.2/integrations/seed_vc/README.md). The earlier PyTorch-based RVC runtime can no longer be used.

## Temporary virtual microphone

First connect earphones or the WiVRn audio device, and check with `wpctl status` that VRChat's output goes to that device.
If there is only `Dummy Output`, connect an audio output before you create a loopback in the normal session.
This time, the game output moved to a virtual sink that was created with no output connected, so the sink was deleted without playing any speech.
Setting `priority.session=-100` or a smart filter alone did not prevent the mix-up when no other output existed.

After this preparation, start a temporary loopback in a terminal, without replacing the existing audio settings.
Use the sink/source setup from the [PipeWire loopback documentation](https://docs.pipewire.org/page_module_loopback.html).

```sh
pw-loopback --capture-props='media.class=Audio/Sink node.name=vrct.voice.sink node.description="VRCT Voice Input" audio.position=[MONO]' --playback-props='media.class=Audio/Source node.name=vrct.voice.source node.description="VRCT Virtual Microphone" audio.position=[MONO] node.passive=true'
```

Check with `pw-dump` / `pw-link -l` / `wpctl status` that the sink and the source were created.
Keep the routes apart: **VRChat output → earphones, ASTAROT output → dedicated sink, dedicated source → VRChat input**.
If the game output is connected to the dedicated sink, end the loopback without playing any speech and fix the output target.
While the physical audio device is disconnected, WirePlumber may choose this virtual node as the active default output or input (observed this time too).
Set other apps' output and the ASR input explicitly, and check `wpctl status` before and after creating the nodes.
ASTAROT itself does not fall back to the default device.
Set VRChat's microphone to **VRCT Virtual Microphone**.
Do not link the physical microphone, the game output or WiVRn audio directly to this sink.
To finish, press Ctrl-C in the loopback terminal. Only the temporary nodes go away.
For automated tests only, use the core example that plays through a dedicated PipeWire graph (`--route managed --private-pipewire` in `native/core/examples/live_speech.rs`) and the tests (`spoken_route_live` and `voice_managed_live` in `voice-tests.yml`).

## speech.cpp to the virtual microphone

Start with local models that the user has already prepared after checking their licenses (the paths below are examples).
Without a reference voice, use `none`. With one, register a voice.gguf whose speaker has given consent.

Up to 0.5, the Python backend's CLI (`tools/voice_cli.py`) played speech into the virtual microphone. It was removed with the backend in 0.6.0 (#285).
To run and measure the core's text to speech with a real speech.cpp and a real output, use `native/core/examples/live_speech.rs`.
On Linux, `--route managed --private-pipewire` plays into the managed route on a private PipeWire and measures when the sound starts to be heard on the virtual microphone (usage is at the top of the file).

## Manual acceptance and the P2 entry point

- VRChat's [microphone test](https://wiki.vrchat.com/wiki/Settings#Microphone) records briefly and then plays the recording back.
  If you wait long between starting the test and sending, the speech may fall outside the recorded span.
  Match the timing, for example by pressing `New Test` while the input meter moves.
  Audio is sent once per request. Do not confuse this with the number of playbacks through the recording's `Play Again`.
- Whether the input meter stops after a stop or Ctrl-C. Playback of a clip that VRChat has already recorded is outside what ASTAROT's stop covers.
- Delete the loopback → an error, with no fallback to the physical speakers. Restore it → after an explicit reselection, retry with a new sentence.
- Draw a diagram of the WiVRn input and output, and keep the game audio and the TTS monitor out of future ASR input.
- P2 external VC: set the other software's input to the physical microphone and its output to a **conversion-only sink**, and check it on its own.
  Do not connect it to VRChat until you have confirmed a setup with no automatic fallback to the raw microphone.
  Record the silence when VC stops, the model, OS and version, the latency, the VRAM and the terms of use, then decide whether to adopt it.
  Mix directly into the P1 TTS sink only after the P2 router has been verified.

## Persistent managed virtual microphone (added after the B verification)

This is an optional feature for source checkouts. Its names differ from those of the temporary microphone above.
In the later automated host and VRChat acceptance, the configuration was placed temporarily and the services were restarted,
and the original settings were restored after the test. An agent checked the preparation and restoration of the initial screen and ran the acceptance sequence automatically.
This does not mean that the whole VRCT GUI is ready on Linux. In the later UI component and stdio integration tests, the production input box,
the voice settings UI and the production Main/Controller were connected to a real TTS and a separate PipeWire. The Tauri connection and the surrounding services were replaced,
so the startup of the whole app, settings persistence and the real Model initialization are not verified.

1. Prepare the system C compiler, pkg-config and the PipeWire development headers, and build in the repository root.
   The CachyOS environment used this time already had them. No Python packages or voice models are added.

   ```sh
   uv run --no-project python tools/build_voice_gate.py
   ```

2. At a time when live audio may be interrupted, place the configuration in the user's PipeWire configuration.
   This restart interrupts audio connections, including VRChat and WiVRn.
   Do not replace other configuration. If a file with the same name already exists, check its contents before you replace it.

   ```sh
   mkdir -p ~/.config/pipewire/pipewire.conf.d
   cp config/pipewire/90-astarot-managed.conf ~/.config/pipewire/pipewire.conf.d/90-astarot-managed.conf
   systemctl --user restart pipewire pipewire-pulse wireplumber
   ```

   In versions up to 0.6.0, the template is `90-vrct-managed.conf`, which creates `vrct.managed.*` nodes.
   While a file with that name stays in place, the app does not prepare the route automatically and reports `managed_setup_manual_config_legacy`.
   Delete the old file, then place the new template (ADR-014, 2.8).

3. With a real output such as earphones connected, check `wpctl status` / `pw-link -l`.
   Route explicitly: the game audio to the earphones, the TTS output to `astarot.managed.tts`, the VC output to `astarot.managed.vc`,
   and VRChat's input to **ASTAROT Managed Virtual Microphone** (`astarot.managed.source`).
   `priority.session=-100` is not a setting that forbids choosing the node as the system-wide default. Automatic selection, such as when the real output
   disappears, needs a separate check. Do not choose this sink as the default output.
4. Save "Managed virtual microphone (Linux)" in ASTAROT's text to speech settings.
   It starts muted. It outputs nothing until "Unmute" confirms it.
   "Mute now" stops the TTS and VC that enter this route.
   The existing "Stop" cancels only TTS. The held mute in external cable mode also applies only to TTS.
   The external cable selection is kept even after you switch to managed.
5. `voice_mute_state.json` is created in the same directory as the app's `config.json`.
   Corruption or a failed write is treated as an error and as a mute request, and no success is shown.
   After repairing it so that it can be written, request a mute, and resume once the mute is confirmed.

Up to 0.5, a CLI (`tools/voice_route.py`) could read or change the state while ASTAROT was stopped, by naming the same state file.
It used the Python backend's PipeWire parts, so it was removed with the backend in 0.6.0 (#285).
A running ASTAROT goes back to mute when it detects a state change from outside, so use the UI for normal operation.

To undo this, first confirm the mute, switch ASTAROT back to the external cable setting, and choose a safe input again in VRChat.
Delete **only** the `~/.config/pipewire/pipewire.conf.d/90-astarot-managed.conf` that you placed, and
restart the user services above at a time when audio may be interrupted. The app's held mute
remains, so resume explicitly if needed. Do not delete a whole PipeWire configuration directory.

A normal ASTAROT exit mutes the gate and leaves the endpoint in place. If the exit handling does not run, as with SIGKILL or a power loss,
the gate keeps its last state. Force-quitting ASTAROT while it is unmuted does not by itself stop the external VC's sound.
ASTAROT mutes again when it restarts. Stopping the PipeWire daemon also removes the virtual microphone,
so VRChat's input fallback in that case still needs a check on real hardware.

---

# P1 Linux / CachyOS / WiVRn（日本語版）

このページはソースcheckoutでの開発・CLI試験の手順。配布版のLinuxアプリは
[AppImageガイド](appimage.md)と[Linuxビルド手順](linux-build-pipeline.md)を参照。

検証の記載は、2026-10-27以降の各作業時点のもの。以下のCLI→仮想マイク→VRChat desktopの経路は、
ユーザーが内蔵マイクテストの再生で声を確認済み。途中停止後のメーター停止も確認。
実VRCTアプリからVRChatの音声・OSCへ同時配信する一連の動作、他ユーザーでの受信、HMDは未検証。
取得済みIrodori-TTS MF / speech.cpp 0.8.11の単発PoCと、0.9.0の専用PipeWireグラフでの
[30回測定](benchmarks.md)は確認済み。新規モデル取得は行っていない。

## ネイティブ起動の作業状況

0.5.0からアプリのバックエンドはアプリの中で動くRustの中核で、開発用のPython sidecarはなくなった（[中核の統合](core-integration.md)）。
PythonのバックエンドとそのPython環境（`.venv_linux`、`mise run setup:app`）、CLI、試験は0.6.0で消した（#285）。

### 開発環境

Python、uv、Rustの版は`mise.toml`で固定している（[開発ガイド](../development.md#用意するツール)）。

```sh
mise install
mise run setup:headless   # モデルなしの試験の依存（build/dev/headless-venv）
mise run setup:resources  # tauri dev と cargo check が読む src-tauri/bin/_internal
```

`setup:resources`については[開発ガイド](../development.md#tauriが読む資源を用意する)を参照。

### 同梱サーバーと音声ヘルパーを用意する

開発起動のバックエンドは、同梱speech.cppサーバーと音声経路のヘルパーをソースツリーの`build/`から読む。
新しいcheckoutやworktreeには`build/`がないので、用意しないと設定の「TTS」や「音声認識」で「サーバーを起動」を押しても失敗する。

```sh
mise run build:voice-gate
python tools/speechcpp_bundle.py --variant linux-x64-vulkan --archive /path/to/speech-0.11.2-linux-x64-vulkan.zip --output build/speechcpp
python tools/speechcpp_bundle.py --variant linux-x64-cpu --archive /path/to/speech-0.11.2-linux-x64-cpu.zip --output build/speechcpp-cpu
```

`build_voice_gate.py`は、`build/astarot-voice-gate`、`astarot-source-bridge`、`astarot-screen-capture`をビルドする。`libpipewire-0.3-dev`が必要。
`astarot-screen-capture`がないと、チャット読み取りの「ウィンドウを共有…」は`screencast_helper_missing`で止まる（`src-tauri/src/portal_screencast.rs`）。
0.5.xまでは`vrct-vc-worker`と`vrct-asr-capture`もビルドして同梱していた。`vrct-vc-worker`は0.4までのPythonバックエンドが同梱サーバーと声質変換の起動に使ったヘルパー、`vrct-asr-capture`はLinuxの音声認識の録音のヘルパーで、中核はどちらも起動しなくなったので、0.6.0でソースごと消した（ADR-014、#809）。

`speechcpp_bundle.py`は、版とSHA-256を固定した書庫から、`speech`本体と同梱のライセンス文書を出力先に置く。配布物と同じく、Vulkan版は`build/speechcpp`、CPU版は`build/speechcpp-cpu`に置く。どちらのビルドかは`bundle.json`で決まり、フォルダの名前では決まらない。
書庫が手元になければ、`--archive`の代わりに`--download`を指定すると取得する。通信するのは`--download`を指定したときだけ。
片方だけでも動く。CPU版だけなら推論はCPUだけになる。Vulkan版だけでも「CPU」を選べるが、Vulkanローダー（`libvulkan.so.1`）が要る。出力先がすでにあると、上書きせずに止まる。`--replace`を付けると、同じ版はそのまま残し、別の版の部品だけを置き換える。
Linux候補をビルド済みなら、`build/linux/build/speechcpp`と`build/linux/build/speechcpp-cpu`を`cp -a`でコピーしてもよい。
アプリは起動のたびに版とハッシュを検査し、シンボリックリンクは受け付けないので、リンクではなくコピーにする。
2つとも見つからないか検査に合わないと、同梱サーバーの起動は`speech_bundle_missing_or_invalid`で止まる。

開発起動で取得したモデルは、`config.json`と同じフォルダの`downloaded_models/`に保存される。開発用のビルドでは、`ASTAROT_CONFIG_DIR`を指定しなければ実行ファイルのあるフォルダ（`src-tauri/target/debug/`など。gitの対象外）になる（`src-tauri/src/backend_host.rs`の`folders`）。0.4までのPythonバックエンドは`src-python/downloaded_models/`に保存していた。

Linuxのチャット読み取りは、VRChatのウィンドウをX11/XWayland経由で取り込む。SteamVRが動いている間は、ヘッドセットの映像をOpenGLで読む（偽のSteamVRでだけ確認）。Waylandネイティブのウィンドウは、利用者が設定の「チャット読み取り」で共有すると読み取れる（XDG ScreenCast portal。開発ビルドは`build/astarot-screen-capture`を使う）。従来ASRの録音は未対応。
2026-11-11に、Protonで動く実際のVRChat（ローカルの試験インスタンスにクライアントを2つ）と、実際のPP-OCRのモデルで確認した（CachyOS、KDE Plasma 6.8、Wayland）。X11/XWaylandの経路は、もう一方のクライアントが送ったチャットを読めた。共有の経路は、入れ子のXwayland（KWinから見るとWaylandネイティブのウィンドウ）の中で動かしたVRChatを共有して読めた。このとき「6文のうち5文（開発ビルド）、4文（AppImage）」と記録したが、読めなかったのではなく、確認の手順の誤りだった（2026-11-12に訂正）。会話ログは画面に見えている行だけを描くので、ログが画面を埋めたあとの行を数えられていなかった。gamescopeの中のVRChatと、WineのWaylandドライバーで動くVRChatでは確認できていない（gamescope 3.17はウィンドウが落ち、使ったProton-GEはWaylandドライバーの指定を受け付けなかった）。音声タイピングモードの貼り付けは、実際のVRChatのチャット欄に文字が入ることを確認した。GNOMEなど、KDE以外のデスクトップでは確認できていない。
2026-11-12に、同じ構成で12文（日本語と英語、2行に折り返す長さの文を含む）を10秒おきに送って測り直した（開発ビルド、develop `5d4b1a16`に#196の変更を足したもの）。X11/XWaylandの経路、共有の経路とも12文すべてを読み、送ってからログに出るまでは0.6〜1.5秒だった（X11の1文だけ4.2秒）。吹き出しの検出モデルは入れていないので、看板の文字も結果に混じる。試験用のワールドは数秒ごとに話し手とカメラの位置を変えるため、距離や背景は文ごとに違う。確認のときは、名前の検索が話し手側のウィンドウを拾わないよう、話し手側のウィンドウのタイトルを変えた（2つのクライアントがどちらも`VRChat`という名前になるため）。
この手順はPython依存のみを取得し、ASR/TTS/VC重みの取得スクリプトは実行しない。
Pythonの取得・package通信にはネットワークが必要。システムのGTK/WebKitGTK依存は
[Tauri公式の準備手順](https://v2.tauri.app/start/prerequisites/)を参照。

0.4までは、アプリの起動時に`VRCT_DEV_VENV=.venv_linux`でこの環境を選択できた。0.5.0のアプリはPythonを起動しないので、この変数を読まない。
`ASTAROT_CONFIG_DIR=/absolute/path/to/state`は（0.5.xまでの名前`VRCT_CONFIG_DIR`も0.6.xの間は読む）、`config.json`、ログ、`downloaded_models/`、`vc_runtimes/`の保存先を変える。指定しなければ従来の保存先を使う。
同梱資源（`build/`）とUI資源の場所は変えない。既存設定を試験用ディレクトリへコピーする必要はない。
0.4までは「その他」のモデル自動取得をONにすると、次回起動時に内蔵翻訳のモデルを取得した。0.5.0では起動時の自動取得をやめ、スイッチも設定画面から外した（設定のキーは互換のために残る）。モデルの取得は、同意の画面からの明示の操作だけで行う。

Pythonバックエンドの起動の自動試験（`tests/platform/test_native_backend.py`）は、バックエンドと一緒に0.6.0で消した。中核の起動、設定の引き継ぎ、再起動は`native/core/tests/lifecycle.rs`などが確かめる。

## RVCの実行環境

Linux（x86-64）でも、RVCの実行環境をアプリから取得できます。画面と流れはWindowsと同じです。Seed-VCの実行環境は0.4までのPythonバックエンドのもので、0.5.0では一覧に出ません（`native/voice-conversion/src/runtime.rs`）。この節のSeed-VCの記述は0.4までの記録です。Linuxでは管理対象の音声経路を使い、PipeWireから声質変換用の入力を取り込みます。「設定」→「RVC」、または「高度な設定」の「入力音声の転送」に、「RVCの実行環境」の欄があります。「取得内容を確認」を押し、ライセンス、サイズ、保存先を確認して同意すると始まります。同意するまで、何も取得しません。

必要なものは次のとおりです。

- x86-64のPC。それ以外では、取得の欄を表示しません。
- GPUで変換するには、NVIDIAのGPUとNVIDIAのドライバー。アプリは`/proc/driver/nvidia/version`があるかどうかで、ドライバーが動いているかを確かめます。nouveauなど、このファイルがない環境ではCPU用の実行環境を出します。

RVCの変換は、配布物に入っている`astarot-rvc-worker`（`native/rvc-runtime`）が行います（2026-11-15から）。RVCはドライバーがなくても取得できます。ドライバーがあるPCにはGPU用、ないPCにはCPU用の実行環境を出します。同意すると、次を順に行います。

1. GPU用は、ONNX Runtime 1.31.0（CUDA 13版。NuGetにあるMicrosoftの公式パッケージ`Microsoft.ML.OnnxRuntime.Gpu.Linux`）と、NVIDIAのCUDA 13.4とcuDNN 9.26のライブラリ（PyPIの`nvidia-cuda-runtime`、`nvidia-cublas`、`nvidia-curand`、`nvidia-cuda-nvrtc`、`nvidia-cudnn-cu13`のwheel）を取得します。CPU用は、ONNX Runtime 1.31.0のCPU版（`Microsoft.ML.OnnxRuntime`）だけです。アーカイブごとにサイズとSHA-256を照合し、ワーカーが読み込む`.so`だけを`lib/`に取り出して、アーカイブは消します。2026-11-18まではONNX RuntimeをGitHubのリリースから取得していました。そのときに準備した実行環境は、`lib/`のファイルが同じ名前なので、準備し直さずにそのまま使えます。
2. 基礎モデル（HuBERTの`config.json`と`pytorch_model.bin`、`rmvpe.onnx`）を取得して、ハッシュを検証します。
3. ワーカーの`--probe`で、取得したライブラリが読み込めて計算できることを確かめます。GPU用でGPUを使えないとき（ドライバーが580より古い、GPUがTuring＝GTX 16・RTX 20シリーズより前）は、CPUで変換すると表示して完了します。
4. 同じフォルダーに以前のPyTorch形式の実行環境があれば、そのファイル（`venv`、`python`、`engine`、`engine.zip`、固定の`rmvpe.pt`と`preprocessor_config.json`）を削除します。`engine`の中のモデルや音声のファイル（`.pth`、`.index`、`.wav`など）は残します。

0.4までのSeed-VCでは、同意すると次を順に行いました。Gitも開発環境もいりませんでした。

1. 固定版の`uv`を取得します。公式リリースの`uv-x86_64-unknown-linux-gnu.tar.gz`で、サイズとSHA-256を照合します。
2. Pythonと、ハッシュを固定した依存（`integrations/seed_vc/requirements.lock`）を入れます。
3. エンジン本体（GitHubのアーカイブ）を取得して、内容を検証します。展開する前に、項目の数と展開後の容量、圧縮率、パス、種類（通常のファイルとフォルダーだけ）を確かめます。展開して、Seed-VCには同梱のパッチを当てたあと、全ファイルの名前と中身から作ったダイジェストを固定値と照合します。合わなければ、展開したものを消してインストールしません（セキュリティ監査 SEC-04）。
4. 基礎モデルを取得して、ハッシュを検証します。
5. 実行環境のPythonで`torch.cuda.is_available()`を確かめます。

| | RVC | Seed-VC（0.4まで） |
|---|---|---|
| 通信量の目安 | GPU用 約1.9 GB、CPU用 約0.6 GB | 約6.4 GB |
| 必要な空き容量 | GPU用 約3.3 GB、CPU用 約0.7 GB | 約18 GB |
| 完了後の大きさ | GPU用 約2.5 GB、CPU用 約0.55 GB | 約9.5 GB |
| 依存のPython | なし | 3.11 |

RVCの列は、2026-11-15に下と同じPCで1回ずつ取得した値です。通信量はカタログの値（固定したファイルの合計、GPU用1.87 GB、CPU用0.56 GB）で、完了後の大きさは`du -sh`、かかった時間はGPU用260秒、CPU用10秒でした。必要な空き容量は、取り出したファイルと基礎モデルに、いちばん大きいアーカイブ（GPU用はcuDNN、0.52 GB）を足して切り上げた目安で、取得中の最大値は測っていません。

Seed-VCの列は、2026-11-11に1台のPCで1回ずつ取得して測った値です（CachyOS、RTX 4080 SUPER、NVIDIAドライバー620.70.06、btrfs、有線の回線）。通信量は、取得中にネットワーク機器が受信したバイト数です（RVCは4.83 GB、Seed-VCは6.28 GB）。必要な空き容量は、取得中のフォルダーの大きさ（`du -sb`）の最大値を切り上げた値で、RVCは15.6 GB、Seed-VCは17.5 GBでした。`uv`のキャッシュと導入先を別々に数えています。`uv`は、ファイルシステムが対応していれば両者でデータを共有するので（reflinkまたはハードリンク）、その場合に実際に使う容量はこれより小さくなります。かかった時間はRVCが62秒、Seed-VCが139秒ですが、回線の速さで大きく変わります。

保存先は、`config.json`と同じフォルダーの`vc_runtimes`です。配布版では`~/.config/astarot/vc_runtimes`（0.5.xまでは`~/.config/vrct-vox/vc_runtimes`）、ソースからの開発起動では、`ASTAROT_CONFIG_DIR`を指定しなければ実行ファイルのあるフォルダーの`vc_runtimes`になります（`src-tauri/target/debug/`など。gitの対象外です。0.4までのPythonバックエンドでは`src-python/vc_runtimes`）。途中で失敗したり中止したりしても、終わった手順は次回に飛ばします。0.4までのSeed-VCでは、中止すると`uv`と`uv`が起動したプロセスをまとめて止め、アプリが異常終了したときも`uv`は一緒に終わりました。終わったら「この実行環境を使う」を押して保存します。消したいときは、このフォルダーを削除します。

声のモデルは別です。RVCの設定画面の取得欄から取得するか、権利を確認したものを指定します。0.4までのSeed-VCには、利用が許可された参照音声（1〜30秒のWAV）を指定しました。

確認できたのは、上のPCでの取得と、取得した実行環境でRVCとSeed-VCのワーカーを起動して、合成した音声を変換するところまでです。音質、ほかのディストリビューション、配布版（AppImage）からの取得は確かめていません。

手動で用意する場合、RVCは`lib/`と`assets/`の構成（[Windowsの手順](local-setup-windows.md#手動で用意する場合)と同じで、`.so`の名前は`native/voice-conversion/src/runtime.rs`の`ort`と`nvidia_libraries`（`rvc_runtime`がまとめる）のとおり）を使います。0.4までのSeed-VCは[Seed-VCのREADME](https://github.com/kein5/astarot/blob/v0.5.2/integrations/seed_vc/README.md)の手順でした。以前のPyTorchを使うRVCの実行環境は使えなくなりました。

## 一時的な仮想マイク

最初にイヤホンまたはWiVRnの音声デバイスを接続し、`wpctl status`で
VRChat出力がそのデバイスへ流れていることを確認する。
`Dummy Output`しかない場合は、通常セッションにloopbackを作る前に音声出力を接続する。
今回、出力未接続で作った仮想sinkへゲーム出力が移動したため、発声せず削除した。
`priority.session=-100`やsmart filterの指定だけでは、他の出力がない状態の混線を防げなかった。

準備後、既存の音声設定を置換せず、端末で一時loopbackを起動する。
[PipeWire loopback原典](https://docs.pipewire.org/page_module_loopback.html)のsink/source構成を使う。

```sh
pw-loopback --capture-props='media.class=Audio/Sink node.name=vrct.voice.sink node.description="VRCT Voice Input" audio.position=[MONO]' --playback-props='media.class=Audio/Source node.name=vrct.voice.source node.description="VRCT Virtual Microphone" audio.position=[MONO] node.passive=true'
```

`pw-dump` / `pw-link -l` / `wpctl status` でsink/sourceが作られたことを確認。
**VRChat出力→イヤホン、ASTAROT出力→専用sink、専用source→VRChat入力**に分離する。
ゲーム出力が専用sinkにつながった場合は発声せずloopbackを終了し、出力先を修正する。
物理音声デバイスが切断中だと、WirePlumberがこの仮想ノードを有効な既定出力/入力に
選ぶ場合がある（今回も観測）。他アプリの出力とASR入力は明示指定し、作成前後の
`wpctl status`を確認する。ASTAROT自身は既定デバイスへのfallbackを行わない。
VRChatのマイクを **VRCT Virtual Microphone** に指定する。
物理マイク、ゲーム出力、WiVRn音声をこのsinkへ直接リンクしない。
終了時はloopback端末でCtrl-C。一時ノードだけが消える。
自動試験だけなら、専用のPipeWireのグラフで流す中核の例（`native/core/examples/live_speech.rs`の`--route managed --private-pipewire`）と試験（`voice-tests.yml`の`spoken_route_live`と`voice_managed_live`）を使用する。

## speech.cpp→仮想マイク

ユーザーが許諾確認して用意済みのローカルモデルで起動（以下はパス例）。
参照音声を使わない場合は `none`。使う場合は本人同意済みのvoice.ggufを登録。

0.5まではPythonのバックエンドのCLI（`tools/voice_cli.py`）で読み上げを仮想マイクへ流した。0.6.0でバックエンドと一緒に消した（#285）。
中核の読み上げを本物のspeech.cppと出力で流して測るには、`native/core/examples/live_speech.rs`を使う。
Linuxでは`--route managed --private-pipewire`で、私用のPipeWireの管理された経路に流し、仮想マイクで聞こえ始める時刻を測る（使い方はファイルの先頭）。

## 手動受入とP2入口

- VRChatの[マイクテスト](https://wiki.vrchat.com/wiki/Settings#Microphone)は短い録音の後に再生する。
  テスト開始してから送信を長く待つと、録音区間から音声が外れる可能性がある。
  入力メーターが動いている間に`New Test`を押すなどしてタイミングを合わせる。
  音声送信は各要求1回。録音の`Play Again`による再生回数とは区別する。
- 停止/Ctrl-C後に入力メーターが止まるか。VRChatがすでに録音したclipの再生はASTAROTの停止対象外。
- loopbackを削除→エラー、物理スピーカーへのfallbackなし。復元→明示再選択後に新しい文で再試行。
- WiVRn入力/出力を図示し、ゲーム音声・TTS monitorを将来のASR入力から除外する。
- P2外部VC: 別ソフトの入力を物理マイク、出力を**変換専用sink**へ設定して単体確認。
  生マイクの自動fallbackがない設定を確認するまでVRChatへつながない。
  VC停止時の無音、モデル/OS/版、遅延、VRAM、利用条件を記録して採用判断する。
  P1のTTS sinkへ直接混ぜる操作はP2 routerの検証後に行う。

## 常駐する管理対象の仮想マイク（B検証後の追加）

これはソースcheckout向けの任意機能。上の一時マイクとは名前が異なる。
後続のホスト・VRChat自動受入で一時配置と再起動を実施し、
試験後に元の設定へ戻した。初期画面の準備と復元はエージェントが確認し、受入シーケンスを自動実行した。
VRCT全GUIのLinux対応完了を意味しない。後続のUI部品・stdio統合試験では本番入力欄・
音声設定UIと本番Main/Controllerを実TTS・独立PipeWireへ接続した。Tauri接続と周辺サービスは差し替えており、
アプリ全体の起動・設定永続化・実Model初期化は未検証。

1. systemのC compiler、pkg-config、PipeWire開発headersを用意し、repo rootでビルドする。
   CachyOSの今回の環境には既に揃っていた。Pythonパッケージや音声モデルは追加しない。

   ```sh
   uv run --no-project python tools/build_voice_gate.py
   ```

2. 実音声が中断してよいタイミングで、設定をユーザーのPipeWire設定へ配置する。
   この再起動はVRChat/WiVRnを含む音声接続を中断する。
   他の設定は置換しない。既に同名ファイルがある場合は内容を確認してから置換する。

   ```sh
   mkdir -p ~/.config/pipewire/pipewire.conf.d
   cp config/pipewire/90-astarot-managed.conf ~/.config/pipewire/pipewire.conf.d/90-astarot-managed.conf
   systemctl --user restart pipewire pipewire-pulse wireplumber
   ```

   0.6.0までの版のテンプレートは`90-vrct-managed.conf`で、`vrct.managed.*`のノードを作る。
   その名前のファイルを置いたままでは、アプリは経路を自動で準備せず、`managed_setup_manual_config_legacy`を出す。
   古いファイルを消してから、新しいテンプレートを置く（ADR-014の2.8）。

3. イヤホンなどの実出力を接続した状態で `wpctl status` / `pw-link -l` を確認する。
   ゲーム音声はイヤホンへ、TTS出力は `astarot.managed.tts`、VC出力は `astarot.managed.vc` へ、
   VRChatの入力は **ASTAROT Managed Virtual Microphone** (`astarot.managed.source`) へ明示指定する。
   `priority.session=-100` はOS全体のdefault選択を禁止する設定ではない。実出力が消えた場合などの
   自動選択は別途確認が必要で、既定出力にこのsinkを選ばない。
4. ASTAROTの読み上げ設定で「管理対象の仮想マイク（Linux）」を保存する。
   初期状態はミュート。「ミュートを解除」で確認済みになるまで出力しない。
   「ミュートする」はこの経路に入ったTTS/VCを止める。
   既存の「停止」はTTSだけを取り消す。外部ケーブルモードの保持ミュートもTTSだけに適用する。
   外部ケーブルの選択値はmanagedへ切り替えても保存される。
5. `voice_mute_state.json` はアプリの `config.json` と同じディレクトリに作られる。
   破損や書込み失敗はエラーとミュート要求として扱い、成功表示しない。
   書込み可能な状態へ修復後にミュートを要求し、確認されてから再開する。

0.5までは、ASTAROTの停止中に同じstate fileを明示して状態を見たり変えたりするCLI（`tools/voice_route.py`）があった。
PythonのバックエンドのPipeWireの部品を使っていたので、0.6.0でバックエンドと一緒に消した（#285）。
起動中のASTAROTは外部からの状態変更を検出するとミュートへ戻すため、通常操作にはUIを使う。

戻すには、まずミュート確認後にASTAROTを外部ケーブル設定へ戻し、VRChatで安全な入力を選び直す。
配置した `~/.config/pipewire/pipewire.conf.d/90-astarot-managed.conf` **だけ**を削除し、
音声を中断してよいタイミングで上記userサービスを再起動する。アプリ側の保持ミュートは
残るため、必要なら明示再開する。任意のPipeWire設定ディレクトリ全体は削除しない。

通常のASTAROT終了ではgateをミュートしてendpointを残す。SIGKILLや電源断で終了処理が走らない
場合はgateの直前の状態が残る。解除中のASTAROT強制終了だけでは外部VCの音は止まらない。
ASTAROT再起動時は再度ミュートする。PipeWire daemon停止では仮想マイクも消えるため、
その際のVRChat入力fallbackは引き続き実機確認が必要。
