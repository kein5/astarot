<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/astarot/logo-horizontal-dark.png">
    <img src="docs/brand/astarot/logo-horizontal-light.png" width="700" alt="ASTAROT: Speech, Translation, Accessibility, Revoicing &amp; OCR Toolkit">
  </picture>
</h1>

<!-- Badges read their values from GitHub (Actions, Releases, the repository) or from the files
     they link to, except License and Platform: those follow LICENSE and the release files. Keep docs/readmes/README.ja.md the same. -->
<p align="center">
  <a href="https://github.com/kein5/astarot/actions/workflows/voice-tests.yml?query=branch%3Adevelop"><img alt="Tests on Linux and Windows (develop)" src="https://img.shields.io/github/actions/workflow/status/kein5/astarot/voice-tests.yml?branch=develop&event=push&label=tests"></a>
  <a href="https://github.com/kein5/astarot/actions/workflows/build-linux.yml?query=branch%3Adevelop+event%3Aworkflow_dispatch"><img alt="Linux build of the latest release candidate" src="https://img.shields.io/github/actions/workflow/status/kein5/astarot/build-linux.yml?branch=develop&event=workflow_dispatch&label=Linux%20build"></a>
  <a href="https://github.com/kein5/astarot/actions/workflows/release.yml?query=branch%3Adevelop+event%3Aworkflow_dispatch"><img alt="Windows build of the latest release candidate" src="https://img.shields.io/github/actions/workflow/status/kein5/astarot/release.yml?branch=develop&event=workflow_dispatch&label=Windows%20build"></a>
  <a href="https://github.com/kein5/astarot/actions/workflows/github-code-scanning/codeql"><img alt="CodeQL analysis (develop)" src="https://img.shields.io/github/actions/workflow/status/kein5/astarot/github-code-scanning%2Fcodeql?branch=develop&label=CodeQL"></a>
</p>
<p align="center">
  <a href="https://github.com/kein5/astarot/releases/latest"><img alt="Latest stable release" src="https://img.shields.io/github/v/release/kein5/astarot?label=release"></a>
  <a href="https://github.com/kein5/astarot/releases"><img alt="Downloads from GitHub Releases" src="https://img.shields.io/github/downloads/kein5/astarot/total?label=downloads"></a>
  <a href="/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="https://github.com/kein5/astarot"><img alt="GitHub stars" src="https://img.shields.io/github/stars/kein5/astarot?label=stars&style=flat"></a>
</p>
<p align="center">
  <a href="https://kein5.github.io/astarot/en/guide/requirements"><img alt="Platforms: Windows and Linux" src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue"></a>
  <a href="/src-tauri/Cargo.toml"><img alt="Rust edition of the app" src="https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fkein5%2Fastarot%2Fdevelop%2Fsrc-tauri%2FCargo.toml&query=%24.package.edition&label=Rust%20edition&color=blue"></a>
  <a href="/mise.toml"><img alt="Rust toolchain pinned in mise.toml" src="https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fkein5%2Fastarot%2Fdevelop%2Fmise.toml&query=%24.tools.rust.version&label=Rust%20toolchain&color=blue"></a>
  <a href="/pyproject.toml"><img alt="Python version for the development tools and tests" src="https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fkein5%2Fastarot%2Fdevelop%2Fpyproject.toml&query=%24.project%5B%27requires-python%27%5D&label=Python&color=blue"></a>
  <a href="/mise.toml"><img alt="Node.js pinned in mise.toml" src="https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fkein5%2Fastarot%2Fdevelop%2Fmise.toml&query=%24.tools.node&label=Node.js&color=blue"></a>
</p>

[日本語](/docs/readmes/README.ja.md)

ASTAROT (formerly VRCT-VOX) is a desktop app for VRChat that combines speech recognition (ASR), text to speech (TTS), voice conversion (RVC), chat reading (OCR) and translation. It is derived from [VRCT](https://github.com/misyaguziya/VRCT) and maintained by [kein5](https://github.com/kein5). **It is not an official VRCT release and is not endorsed by the VRCT authors or VRChat.**

## Features

- **Translated speech.** Speak your chat input and confirmed translations with [speech.cpp](https://github.com/nyosegawa/speech.cpp) TTS (Irodori for Japanese, Qwen3-TTS for other languages) into a virtual microphone that VRChat uses. Voice output and OSC chat text are configured independently, so you can, for example, keep your own voice while translated speech and text are added.
- **Hear yourself.** Optionally play the same speech on your own speakers or headphones.
- **Voice conversion.** Convert your microphone with RVC. On Windows and Linux the app fetches its runtime after showing its license and size. It converts on an NVIDIA GPU (GeForce GTX 16 or RTX 20 series or later, driver 580 or later) and otherwise on the CPU, with a longer delay. Seed-VC is no longer offered from 0.5.0; a saved Seed-VC setting switches to RVC.
- **Realtime captions.** Transcribe your microphone and other players with bundled speech.cpp ASR servers.
- **Bundled servers.** Save, start and stop speech.cpp servers from the settings.
- **Model downloads.** Download fixed Irodori, Qwen3-TTS, RVC and speech recognition models (every recognizer speech.cpp offers, such as Qwen3-ASR, ReazonSpeech and Haas-ja) from Hugging Face. Each download asks for consent after showing its license and size. Files are checked by size and SHA-256 and applied separately. GPU/VRAM guidance suggests standard or lighter variants; it is a guide, not a guarantee.
- **Linux desktop.** Global shortcuts on Wayland (XDG portal), a managed PipeWire virtual microphone, PipeWire microphone selection, and Japanese input methods (fcitx/Mozc, ibus) in the AppImage. The VR UI, chat reading from a shared native Wayland window, and pasting in Voice Typing Mode (into X11/XWayland windows) work too.

RVC also needs its runtime, HuBERT and RMVPE. See [model downloads](/docs/voice-stack/model-downloads.md), [voice features on Windows](/docs/voice-stack/local-setup-windows.md) and [the Linux setup notes](/docs/voice-stack/local-setup-linux.md).

## Status and downloads

The latest release is on **[GitHub Releases](https://github.com/kein5/astarot/releases/latest)** (the release badge above shows its version). Versions count from 0.1.0, separately from upstream VRCT 3.x. Betas are published from `develop`, stable releases from `main`.

- **Linux:** AppImage, tar.gz, deb and rpm (x64, Vulkan). These have been tested with real models on CachyOS (KDE Plasma Wayland).
- **Windows:** installer and zip (CPU), and a CUDA zip. These have been tested with real models on a Windows 11 PC ([record](/docs/voice-stack/windows-voice-report.md)). They are not code-signed, so SmartScreen warns on first launch.

Every file has a `.sha256` and `SHA256SUMS-*` for checking downloads; these are not signatures. Installer and AppImage copies update themselves after checking the update's signature; ZIP and tar.gz copies are told about new versions; deb and rpm installs update through the package manager. An AUR package is planned but not submitted.

Known limitations:
- Chat reading (OCR) needs its models, which are not shipped: download them in Settings → Chat reading (OCR) → Recognition models after agreeing to their terms. On Linux it reads the VRChat window through XWayland. A native Wayland window (VRChat inside gamescope, for example) is read after you share it: Settings → Chat reading (OCR) → "Share a window…" opens your desktop's own window dialog.
- On Linux, the VR UI and chat reading from the headset view have been checked only with a stand-in for SteamVR, not with a real headset. Linux builds have been checked on KDE Plasma (Wayland) only.
- The Google, Bing and Papago web translators are unavailable (see License).

Report bugs and ask questions on **[Issues](https://github.com/kein5/astarot/issues)**, with OS, version, steps and redacted logs. Report vulnerabilities privately (see [SECURITY.md](SECURITY.md)). Do not send ASTAROT support requests to the VRCT maintainers.

## Getting started

- [TTS quick start (Japanese)](/docs/voice-stack/tts-quickstart-ja.md)
- [Troubleshooting](/docs/voice-stack/troubleshooting.md)
- [Accessibility: help with hearing, speaking and reading, and known limits](/ACCESSIBILITY.md)
- [Model downloads and GPU/VRAM guidance](/docs/voice-stack/model-downloads.md)
- [Original VRCT documentation](https://misyaguziya.github.io/VRCT-Docs/). It covers the upstream app, not the ASTAROT voice features.

## Names and storage

The app is shown as ASTAROT, but executables and packages still use `vrct-vox` / `VRCT-VOX`, and the application ID is `io.github.kein5.vrct-vox`. On Linux, configuration, data and cache live in `vrct-vox` directories (`~/.config/vrct-vox` and so on). See [names and identifiers](/docs/voice-stack/project-rename.md).

## Privacy and models

ASTAROT sends two kinds of usage events to its own receiver unless you turn that off (Settings → Advanced → "Send usage data"): that the app started, once a day, and an error by its fixed code, once a day per code. Each carries the app version, the OS and its version, the display language, and the PC's hardware (CPU, memory, GPUs and their driver versions). The app shows you exactly what it sends ("See what is sent"). The text and audio of conversations, audio device names and user names are never sent, and nothing is sent before you have answered a one-time notice. Upstream VRCT's Aptabase telemetry is not used, even when an old upstream key file exists. Translation and speech services you choose still receive the text or audio you send them; turning off usage data does not make every feature offline. See [privacy](/site/en/guide/privacy.md).

No model is bundled. TTS, ASR and RVC models are downloaded only on request, or provided by you. Built packages contain no OCR weights. The upstream chat-bubble detector, which may not be shipped in a fork's release, was removed from the repository in 0.2.0; commits up to 0.1.0 still hold it under its own [terms](https://github.com/kein5/astarot/blob/250cec9681752c2f897d9a15a38e647c38561842/src-python/models/ocr/onnx/LICENSE.en.txt), so do not package an old checkout wholesale. The Mia2026 test voice is for local testing only and is never distributed. The bundled speech.cpp binaries carry their own notices; each model has its own license.

## License and acknowledgements

ASTAROT is under the [MIT License](/LICENSE), and the original VRCT copyright and attribution are retained. External engines, model weights and the GPL-marked Seed-VC integration have their own terms, so the voice stack as a whole is not claimed to be MIT.

[NOTICE](/NOTICE.md#lgpl-and-gpl-components-in-vrct-vox-builds) lists the LGPL and GPL components in the builds, where to get their source and how to replace them. Two upstream components are deliberately left out:
- PyAV, because its wheels bundle the GPL x264/x265 encoders.
- Upstream's `translator_engines`, which is licensed for official VRCT only. This is why the Google, Bing and Papago web translators are unavailable.

Thank you to the VRCT team: **みしゃ / misyaguziya** (main development), **しいな / Shiina_12siy** (UI/UX and localization), **レラ / soumt-r** (technical advice), **どね / done_vrc** (logo), and [all VRCT contributors](https://github.com/misyaguziya/VRCT/graphs/contributors). ASTAROT builds on their work. It no longer tracks upstream VRCT; nothing is sent upstream without the repository owner's explicit decision ([policy](/docs/voice-stack/publication-and-upstream.md)).

VRChat and its associated properties are trademarks or registered trademarks of VRChat Inc. ASTAROT is not affiliated with VRChat Inc.

## Development

[mise](https://mise.jdx.dev/) installs the pinned Node, Rust, Python, uv and Cocogitto from `mise.toml` (`mise install`) and runs the routine tasks (`mise tasks` lists them). Start with `mise run doctor`, install the headless checks with `mise run setup:headless`, and install the UI dependencies with `mise run setup:ui`. `mise run check` runs the developer-tool, Node and lint checks. The [developer guide](docs/development.md) covers the voice, backend and Rust checks, browser tests and Cocogitto. See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, commit messages and pull requests. What each stable release changed is in [CHANGELOG.md](CHANGELOG.md), from 0.2.0 on; betas and earlier releases are described on [GitHub Releases](https://github.com/kein5/astarot/releases).

- [Build and CI guide (Japanese)](/docs/readme_build.md)
- [Linux build pipeline](/docs/voice-stack/linux-build-pipeline.md) and [AppImage](/docs/voice-stack/appimage.md)
- [Release candidate and draft workflow](docs/voice-stack/release-candidates.md)
- [Voice licenses and distribution boundaries](/docs/voice-stack/licensing.md)
