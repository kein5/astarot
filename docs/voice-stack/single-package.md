# A single Windows release package (#288)

[日本語版](#windows-の配布物の一本化288日本語版)

The source of truth for the requirements, decisions and acceptance criteria of issue #288, "Remove the two CPU/CUDA variants", is the issue body and the decision comments on the issue (2026-11-14 to 11-15, 2026-11-18 to 11-19). This document summarizes the state of the implementation on develop as of 2026-11-18 (after 0.5.1) and the steps for the remaining work. On 2026-11-19 all the remaining decisions were made ("Decisions made"). The implementation plan and the split into PRs are in an issue comment (2026-11-19).

The related records are these.

- The decisions needed in [core integration](core-integration.md): the rest of local translation (1), how to ship ONNX Runtime (2), the VAD for speech recognition (13), the CUDA build (20), when to remove `src-python/` (27) and measuring local translation (34)
- Execution providers and quantization formats for local translation: [`native/translate-onnx/README.md`](../../native/translate-onnx/README.md)
- Conversion to ONNX and the comparison with CTranslate2: [`tools/translation_onnx/README.md`](../../tools/translation_onnx/README.md)
- [Comparison of inference runtimes](inference-runtime-comparison.md), [platform verification record](platform-verification.md)
- [GPU for local translation and preparing publication](local-translation-gpu-2026-11-18.md) (the fix that made the translation graph run on DirectML, and the tools for publishing the models)

## Status of the acceptance criteria

| Acceptance criterion | Status | Evidence |
|---|---|---|
| The Windows release is a single package with no CPU/CUDA distinction | Met (from the next version) | In 0.5.1, `VRCT-VOX.zip` and `VRCT-VOX_cuda.zip` had the same 729 files (102,141,609 bytes extracted). The only files with different contents were the 2 separately built files, `vrct-vox.exe` and `_internal/build/astarot-rvc-worker.exe`, and their sizes were the same. Decision 3 dropped the CUDA build, and the release process builds only `VRCT-VOX.zip` ("C. Plan for a single package") |
| Measure speech recognition and local translation running on NVIDIA, AMD and Intel GPUs | Not done | The decision of 2026-11-15 removed it from the prerequisites for 0.4.0. The plan is in "Plan for measuring each GPU vendor". Local translation has no way to run on a GPU yet (decision 5) |
| Existing users' settings carry over, and there is a notice about the removal of faster-whisper | Met from 0.3.0 through the 0.5 series. Removed in 0.6.0 (decision 4) | "Care for existing users" |
| The bundled files contain no CTranslate2 or CUDA libraries | Met (from 0.5.0) | 0.5.0 removed Python from the release package. From 2026-11-18, the release package check (`tools/distribution_policy.py`) stops a candidate when it finds CTranslate2 or the CUDA math libraries |

## A. Speech recognition inventory (faster-whisper and speech.cpp)

The faster-whisper engine was removed in 0.3.0 (2026-11-15, #306). The table below is the inventory of 2026-11-14 (an issue comment), rewritten for the 0.5.1 core. The items marked "cannot be matched" were dropped by the decision of 2026-11-14.

| Feature | faster-whisper (up to 0.2) | speech.cpp (0.5.1 core) | Verdict | Handling |
|---|---|---|---|---|
| Choice of model size | 9 kinds: tiny, base, small, medium, large-v1 to v3, large-v3-turbo and large-v3-turbo-int8 | Whisper does not run. Choose from Qwen3-ASR 0.6B and 1.7B (30 languages), Parakeet TDT 0.6B v3 (25 European languages), three Japanese-only models (ReazonSpeech v2, Parakeet TDT-CTC 0.6B ja, Haas-ja v1.0) and Nemotron 3.5 Transcribe (40 languages, large) | Cannot be matched | Dropped (decision 2026-11-14) |
| Small models | tiny is about 75 MB, base about 145 MB | The smallest are 0.35 GB (Japanese only) and 0.51 GB (multilingual) | Cannot be matched | Part of the drop. Whether they are usable on a low-end CPU has not been measured |
| Supported languages | 69 languages in the app's language table | 30 languages with Qwen3-ASR, 38 with Parakeet v3 added | 31 languages cannot be matched | Dropped (decision 2026-11-14) |
| Specifying the language | Yes | Yes, only languages the model accepts. Japanese-only models accept only Japanese | Equivalent | ― |
| Automatic language detection | Yes. It chose among the candidates by likelihood (`language_probability`) | Qwen3-ASR and others detect with `auto`, and the detected language decides the translation direction. There is no likelihood value. Models that do not detect the language (such as the Japanese-only models) refuse `auto` (`realtime_language_auto_unsupported`) | Partly equivalent | There is no choosing among candidates. The details of language detection are part 3-3 of #278 |
| Confidence thresholds (`avg_logprob`, `no_speech_prob`) | Configurable | speech.cpp's responses have no such values | Cannot be matched | Only the UI was dropped. The setting values and the IPC stay because the OpenAI-compatible cloud engine uses them (decision 2026-11-14) |
| Repetition suppression (`no_repeat_ngram_size`) | Configurable | No matching option | Cannot be matched | Dropped (decision 2026-11-14) |
| Compute device and compute type | CPU and CUDA (NVIDIA only). The compute type can also be chosen | CPU and Vulkan (NVIDIA, AMD, Intel). Precision is chosen through the model's quantization (Q8_0 and so on) | Replaced | The compute type setting was dropped (decision 2026-11-14). The GPU is chosen in the speech.cpp server settings |
| Working with VAD | Passes audio segmented by the app's Silero VAD | In realtime recognition, the server's Silero VAD (GGUF; `silero-vad` in the model download catalog) segments the audio | Equivalent for realtime | The VAD for cloud engine recording has not worked since it moved to the core in 0.5.0 (item 13 in core-integration; part 3-4 of #278). This is a separate problem from replacing faster-whisper |
| Realtime recognition | Recognizes once per segment. Partial results come from resending a growing buffer | Receives partial results one after another over Realtime (WebSocket) | Equivalent or better | The latency comparison with Python is in #278 |
| Model download | Pinned to a Hugging Face commit, with the SHA-256 of every file checked | The model download catalog pins the version, size, SHA-256 and license | Equivalent | ― |
| How it starts | Choosing the engine is enough; the model is loaded inside the sidecar | A server in a separate process. A setting chose whether turning on the switch starts the bundled server (`REALTIME_ASR_SETTINGS.start_server`, on by default). #1396 removed the setting: the switch always starts it | Behavior changed | Item 3 of the decision of 2026-11-14 |

The features that only speech.cpp has are specifying vocabulary and telling speakers apart.

## Care for existing users

The settings carry-over, the notice and the deletion of old Whisper weights were included from 0.3.0 through the 0.5 series (they moved to the core in 0.5.0). Decision 4 removed them in 0.6.0.

Through the 0.5 series, they worked as follows.

- When `LOCAL_ASR_MIGRATION` in the saved settings was below 2, the settings were carried over once. If the engine was `Whisper`, it became `SpeechCpp` (local); on Windows, the realtime recognition target became the bundled server; and the notice flag (`LOCAL_ASR_NOTICE_PENDING`) was set. The settings before the carry-over were copied to `config.json.before-migration-<段階>` (`<段階>` is the stage).
- A notice was shown once at startup (`LocalAsrNoticeController.jsx`). It said that Whisper was gone and whether the needed models (speech recognition and VAD) were downloaded, and it had a button that opened Settings.
- Old Whisper weights (the folders with the 9 model names under `<データ>/weights/whisper/`) could be deleted, only when the user asked (`OldWhisperWeights.jsx` in Settings, and the notice).

From 0.6.0, it works as follows.

- There is no carry-over. A saved `Whisper` loads as no selection, the same as the removed Google engine. The user chooses an engine again, as on a first start (the first-run setup screen opens when no engine is chosen). Users who update directly from 0.2 or earlier to 0.6.0 do not keep their engine.
- `LOCAL_ASR_MIGRATION` is still written as `2`, so that a version 0.5 or earlier does not redo the carry-over when a user goes back to it. `LOCAL_ASR_NOTICE_PENDING` is discarded as a retired key. No copy from before the carry-over is written.
- The notice, the old weights field and the 4 endpoints (`/get/data/local_asr_notice`, `/set/disable/local_asr_notice`, `/get/data/old_whisper_weights`, `/run/delete_old_whisper_weights`) are gone. The old weights folders are left untouched.
- The tests are `a_saved_whisper_choice_loads_as_none_without_a_notice` and `no_copy_before_a_migration_is_written_any_more` in `native/core/tests/lifecycle.rs`, `the_old_whisper_weights_are_left_alone` in `settings_endpoints.rs`, and `config_reference.rs`, which defines the differences from Python's results.
- The manual's "If you used Whisper in an earlier version" (`site/*/features/transcription.md`) was updated in a site PR timed with the 0.6.0 release.

Other care for users is as follows.

- From 0.5.0, the old CTranslate2 translation weights are deleted after startup without a notice (the decisions made in core-integration). Whether to give a notice is still open as item 26 in core-integration.
- For users who had installed the CUDA build, the update to 0.5.0 replaces `_internal` and removes `_internal/nvidia`. From the next update on, they update as the standard build (item 20 in core-integration).

## C. Plan for a single package

### Current state

- `backend_cuda.spec` was removed together with `spec/backend.spec` when 0.5.0 took Python out of the release package (`8f186f6c`).
- The `cuda` extra (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`) was for running the Python backend in `src-python/` in the development `.venv_cuda` (`bat/install.bat`, `mise run setup:app`), and it was not in the release package. It was removed with the backend on 2026-11-20 (#285).
- The 0.5.1 Windows ZIP is about 36 MB, about 0.1 GB extracted. In 0.4, the CPU build was about 0.4 GB and the CUDA build about 1.7 GB. GPU support for speech recognition (the Vulkan build of speech.cpp) is included. GPU support for local translation goes in with #277, following the outcome of decision 5 (decision 2 (c) of #630).

### The CUDA build was dropped (decision 3, 2026-11-19)

From 0.5.0, the CUDA build's ZIP held nothing that the standard build lacked. Decision 3 dropped the CUDA build, with the following changes.

- **Name**: The Windows release is one file, `VRCT-VOX.zip`. It gets no new name and keeps the standard build's name. The rename to ASTAROT is handled by the migration of the internal identifiers (#635).
- **Installer** (`src-tauri/nsis/template.nsi`): The edition selection page, `PACKAGE_SHA256_GPU` and the size estimate for the GPU build are gone. `/EDITION=` is accepted and ignored. Even when an app up to 0.5 passes `/EDITION=gpu` during an update, the installer gets `VRCT-VOX.zip`. The same holds when `/VERSION` installs version 0.5 or earlier. The test is the case "`/EDITION=cpu` and `/EDITION=gpu` get the same ZIP" in `tests/installer/windows_update_scenarios.py`.
- **Embedding the hash** (`tools/installer_package_hashes.py`): It takes a single `--package` and writes `PACKAGE_SHA256`.
- **Release process**: The jobs in `release.yml` that build the candidate are `build` and `candidate` (there is also `changelog`). `tools/release_candidate.py` requires only `VRCT-VOX.zip` and the installer for a Windows candidate. `release-cuda` and `release-all` in `package.json` are gone.
- **App**: `src-tauri/src/app_update.rs` does not pass `/EDITION=`. The check for `_internal/nvidia` is gone too. The core's `/run/update_cuda_software` stays because it is part of the IPC contract, and it behaves the same as `/run/update_software`. The edition argument was removed from the core's `SoftwareUpdates::install`. The UI calls only `/run/update_software`. The "CUDA" mark was removed from the version display at the bottom left of Settings (the mark appeared when the compute device list included CUDA, and it could be confused with the package name).
- **Site**: The download display (`releases.mjs`) handles both new releases without a CUDA build and old releases with one (`tools/check_site_downloads.mjs` has both cases). Removing the edition choice and the description of the CUDA build from the install guide (`site/*/guide/install.mdx` and others) was done in a separate PR, timed with the first release without a CUDA build (0.6.0). The site is published from develop, so changing it earlier would have contradicted the guide for the release of that time.

From the new version on, `VRCT-VOX_cuda.zip` is not in the release. External procedures that fetch it stop working, so the change was marked with `!` and `BREAKING CHANGE:`. The `VRCT-VOX_cuda.zip` files in the 0.5 series releases stay as they are.

### When to remove the `cuda` extra

When `src-python/` was removed (2026-11-20, item 27 in core-integration, #285), `cuda` in `pyproject.toml`, `uv.lock`, `bat/install.bat`, the tasks in `mise.toml`, `pytest.ini` and the text in `docs/development.md` were removed with it. `.gitignore` and `vite.config.js` keep the names, so that old `.venv_cuda` and `.venv_linux` folders left in a local checkout stay out of tracking and file watching.

## Plan for measuring each GPU vendor

This is the plan for producing the evidence for the acceptance criterion "measure on NVIDIA, AMD and Intel GPUs". By the decision of 2026-11-15, it is not a condition that holds back a release.

### Targets

| Component | Runtime | NVIDIA | Intel | AMD | No GPU |
|---|---|---|---|---|---|
| Speech recognition (bundled speech.cpp 0.11.2, Vulkan build) | Vulkan | Measure (discrete GPU) | Measure (integrated GPU) | Not verified (no hardware to measure on) | Measure (simulated by keeping the Vulkan driver from loading) |
| Local translation (`native/translate-onnx`) | DirectML | Measure | Measure | Not verified | ― |
| | CUDA | Measure | ― | ― | ― |
| | OpenVINO | ― | Measure | ― | ― |
| | CPU (baseline) | ― | ― | ― | int8 and float32 already measured (`tools/translation_onnx/README.md`) |

### What to prepare before measuring

1. Speech recognition: the bundled speech.cpp, plus Qwen3-ASR 0.6B Q8_0 and Silero VAD from the catalog (downloaded with consent). The measuring tool is `native/core/examples/live_asr.rs` from #278. It starts the core the same way the app does and feeds audio at the same interval as a device. This waits for #278 to be merged.
2. Local translation: the ONNX translation models have been published since 2026-11-19 and are downloaded from the catalog (to build them yourself, use `tools/translation_onnx/export.py`; downloading the original model needs consent). ONNX Runtime with GPU execution providers is not bundled (the bundled one is the CPU build). The CUDA and DirectML builds can be downloaded inside the app after consent, and other builds (such as the OpenVINO build) are pointed to with `ORT_DYLIB_PATH`. The tools are `astarot-translate` and `tools/translation_onnx/compare.py`, which runs it. `astarot-translate` chooses the device with an option such as `--device directml:<番号>` (`<番号>` is the adapter number), and prints on standard error the execution provider that actually ran and any fallback to the CPU. For DirectML, use a folder made by an `export.py` from after 2026-11-18 (earlier ones do not run because of `allowzero=1` in `Reshape`). Before measuring, you can check that the GPU gives the same translation as the CPU with the small model from `tools/translation_onnx/tiny.py` and `a_device_decodes_as_the_cpu_does` in `tests/real.rs`.

### Procedure

- For speech.cpp, choose the GPU by giving a name from `speech devices --json` (such as `Vulkan0`) in the server settings. On a PC with both an integrated and a discrete GPU, `auto` may choose the integrated GPU, so name each one and measure them separately. For DirectML, choose by adapter number. Confirm which number is which GPU before recording (`inference-runtime-comparison.md` only inferred it from the speed).
- Simulate a setup without a GPU by keeping the Vulkan driver from loading with `VK_LOADER_DRIVERS_DISABLE=*`, and check that the work falls back to the CPU. Also try once a setup where only the translation layer to Direct3D 12 remains. For that setup there is a record of the model loading and then failing at the first computation (`windows-voice-report.md`).
- Measure the first cold start with an empty shader cache separately from the second and later starts.
- For audio, feed Japanese and English sentences made with Windows speech synthesis (5 or more of each) at the same interval as a device. Note in the record that it is not a human voice. Measure the character error rate, but do not put the recognized text in the logs or in the record.
- For translation, use the same 30 Japanese and 30 English conversational sentences as the existing comparison. Run M2M100 418M in float32 and float16 on the GPU, and in int8 on the CPU (baseline). The beam count follows the model's settings.

### What to measure

- Speech recognition: the time from the end of speech to the final result (median and 90th percentile), the time to the first partial result, the character error rate, the time from server start to ready (first cold start and second start), the peak GPU memory, the CPU usage per process and any notice of a fallback to the CPU or of a failure.
- Local translation: the time per sentence (excluding loading), the loading time, the number of translations that match CPU int8 and the BLEU score, the GPU memory, whether the execution provider falls back to the CPU (`/run/translation_compute_device_fallback`) and whether an out-of-memory error can be told apart from its message (item 30 in core-integration).
- Simultaneous use: the latency when speech recognition, local translation and text to speech run on the same GPU (item 34 in core-integration).

### Pass criteria (proposal)

- It actually ran on the chosen GPU. Confirm this with the device name in the speech.cpp log and the execution provider that `astarot-translate` prints, and check that no notice of a fallback to the CPU appears.
- The results are equivalent to the CPU's. For speech recognition, the difference in character error rate is within 0.01; for local translation, the BLEU difference stays within the same range as the existing comparison (−0.48 to +0.27 against CTranslate2).
- The speech recognition latency to the final result is not longer than on the CPU of the same PC.

The numeric thresholds are a proposal and have not been decided.

### How to record

Write down the version, the commit, the OS and its version, the GPU model, the driver version, the connection (integrated, discrete, external), the amount of GPU memory and what else was running at the same time. Add the results to the [platform verification record](platform-verification.md) first, then change the cells of the matrix. Do not write anything that identifies the owner of the PC. Do not present values from one PC as a general guarantee.

### AMD GPUs (reports from users, decision 6)

There is no AMD hardware to measure on, so the gap is filled with reports from users (decision of 2026-11-19). Telemetry is not extended. Lowering both the psychological barrier and the actual effort for the people who report was made a design requirement, which led to the following form.

- A tool that measures automatically: you only press "Run the check" under "Advanced" → "GPU report" in Settings, and the core measures (`native/core/src/controller/gpu_check.rs`). It uses the text to speech and speech recognition models already downloaded, with the bundled speech.cpp commands, and runs fixed short sentences on the CPU and on each GPU. Of the items in "What to measure" in the plan above, it covers the loading time, the processing time and the speed relative to real time, the device actually used, the character error rate against the CPU and the kind of failure. It downloads no models and does not use the microphone, the speakers or VRChat. On one PC it took about 1 minute (Windows 11, RTX 3060 Ti, Iris Xe and CPU, Irodori-TTS Q8_0 and Qwen3-ASR 0.6B Q8_0; 36 seconds for text to speech on the CPU).
- Show everything that will be sent beforehand: the result appears on screen as the full formatted JSON, with a table per device. What is copied and what is sent to GitHub are exactly the same string as the full text on screen. The app sends nothing.
- Include no personally identifying information: the report holds only the version, device names, rounded memory amounts, driver versions, the names the models carry, times and error rates. It leaves out file locations, the user name, the PC name, text and audio, and speech.cpp messages (which contain file locations). A core test (`native/core/tests/gpu_check.rs`) checks that user names and text do not get into the report.
- How to send: "Report on GitHub" opens the issue form (`.github/ISSUE_TEMPLATE/gpu_report.yml`) with the result filled in. You can check it once more on GitHub before submitting. A GitHub account is required.
- Calling for reports: reports are requested on a how-to page of the site and in the release notes. The site is published from develop, so the how-to page is added in step with the release that includes this feature.

Translation measurement (`translation.measured`) is added after #277, which makes the GPU execution providers downloadable. The current report holds only the list of compute devices that can be chosen for translation. The results that arrive are added to the "platform verification record" as user reports, with the version, the GPU and the result.

## Decisions made (2026-11-19)

These are the decisions recorded in issue #288, PR #616 and PR #630. "Open decisions" below is kept as a record of the options before the decisions.

| Decision item | Decision | Implementation |
|---|---|---|
| 1. speech.cpp backend configuration | (c). Make GPU-vendor-specific builds (such as CUDA) downloadable with consent. Do not bundle them. Keep the basic bundled setup (one Vulkan build on Windows; a Vulkan build and a CPU build on Linux) | Upstream does not distribute a CUDA build (upstream's `docs/install.md` says it can be built but is neither verified nor distributed), so this project builds and distributes it. It goes in as two parts: the build process and the mechanism for downloading with consent |
| 2. Replacing NLLB | (a). Publish it in a form that shows the license (CC-BY-NC-4.0, non-commercial) and the size and lets the user choose whether to agree. The default stays M2M100 (decision 78 of #630) | #277 |
| 3. CUDA build package | Drop it | "The CUDA build was dropped" |
| 4. Announcing the removal of faster-whisper, and the migration | Do not keep the announcement and migration screens. Do not keep the carry-over or the screen for deleting old Whisper weights either (removed in 0.6.0) | The PR that removes "Care for existing users" |
| 5. How to run local translation on a GPU | The default distribution is the CUDA build and the CPU build. DirectML is an optional extra download and is not bundled (decision 2 (c) of #630) | #277 |
| 6. Measuring AMD GPUs | Ask users for reports. Do not extend telemetry. Lowering the psychological barrier and the actual effort for the people who report is required (provide a tool that measures automatically and shows the result, show everything to be sent beforehand, include no personally identifying information) | The PR that adds the measuring tool and the report form |

## Open decisions (record from before the decisions)

1. The bundled speech.cpp backend configuration (open item 1 in the issue): at present, Windows has one 0.11.2 Vulkan build (the same executable also runs on the CPU), and Linux has two, a Vulkan build and a CPU build (the CPU build when there is no Vulkan loader). The options are (a) keep it as is; (b) add a CPU-only build on Windows too (a way out for PCs with a broken Vulkan driver; the release package grows); (c) make GPU-vendor-specific builds (such as CUDA) downloadable with consent (not bundled). The input for the decision is the NVIDIA and Intel results from the measurement plan.
2. Whether to replace NLLB (open item 2 in the issue): the BLEU difference after conversion to ONNX was −0.48 to +0.27 across 5 models. NLLB 3.3B was slightly lower in all 4 directions into English (#310). NLLB is CC-BY-NC-4.0, so it is not the default. The default is M2M100 418M (MIT). The options are (a) convert NLLB to ONNX and publish it, keeping the non-commercial consent; (b) do not publish it, and let users convert and place it themselves (there is a place for your own models); (c) look into replacing it with another model. Whether to publish is decided together with item 1 in core-integration. This is within the scope of #277.
3. The CUDA build package (item 20 in core-integration): the options are (a) keep building it with the same contents; (b) drop it and map the installer's GPU choice to the standard build. The steps for (b) are in "Procedure" above. Even with (a), the installer's description text and size estimate are fixed.
4. Announcing the removal of faster-whisper, and the migration period (open item 3 in the issue): in practice, faster-whisper was removed in 0.3.0 (2026-11-15) with no migration period. The announcement was made in the 0.3.0 release notes, in a one-time notice at startup and in the manual. The remaining decision is how long to keep the carry-over (stage 2 of `LOCAL_ASR_MIGRATION`) and the screen for deleting old Whisper weights. The options are (a) keep them for now (the code is small); (b) remove them at a milestone version (users who update from 0.2 or earlier after the removal do not keep their engine); (c) keep only the screen for deleting the weights.
5. How to run local translation on a GPU (the rest of item 2 in core-integration): only the CPU build of ONNX Runtime is bundled, so the acceptance criterion "local translation running on a GPU" cannot be checked with the release package until this is decided (it can be measured by placing the libraries by hand). The options are (b) from item 2 in core-integration, bundling the DirectML build (about 18.5 MB more, and ONNX Runtime goes down to 1.24.4), and (c), downloading it after consent. This is within the scope of #277.
    - On 2026-11-19, (c) was chosen. The release package stays CPU-only, and the CUDA build (when the NVIDIA driver is present) and the DirectML build (Windows) are downloaded after the user agrees. The acceptance criterion that the release package contains no CUDA libraries does not change. GPU execution with the release package is measured with the downloaded builds.
6. How to fill the gap in the AMD GPU measurements: the options are (a) leave it unverified and write "Not verified" in the matrix (the current form); (b) give users a measuring procedure and take their reports; (c) set up an environment with an AMD GPU.

## Remaining work

- Implementing decision 1 (the table in "Decisions made"). Decisions 4 and 6 went into 0.6.0 (`native/core/src/controller/gpu_check.rs`, `.github/ISSUE_TEMPLATE/gpu_report.yml`).
- Measure speech recognition after #278 is merged. Measure local translation once the translation models are built.
- The app sizes in `site/*/guide/requirements.mdx` were updated to the values of the 0.6.0 release package on 2026-11-23 (the Windows ZIP is about 0.17 GB and about 0.46 GB extracted; the Linux tar.gz is about 0.19 GB and about 0.51 GB extracted). The estimate "about 11 GB on Windows for every feature" comes to about 11.6 GB when the upper limits of the table's items are added up, and it was left unchanged as an estimate.

---

# Windows の配布物の一本化（#288）（日本語版）

Issue #288「CPU/CUDA 2バリアント解消」の要件、決定、受け入れ条件の正本は、Issue の本文と Issue に付いた決定のコメント（2026-11-14〜11-15、2026-11-18〜11-19）です。この文書は 2026-11-18 の develop（0.5.1 の後）での実装の状態と、残りの作業の手順をまとめたものです。2026-11-19 に残りの判断がすべて決まりました（「決まったこと」）。実装の計画と PR の分け方は Issue のコメント（2026-11-19）にあります。

関係する記録は次のとおりです。

- [中核への統合](core-integration.md)の「判断が要ること」。ローカル翻訳の残り（1）、ONNX Runtime の配り方（2）、音声認識の VAD（13）、CUDA 版（20）、`src-python/` を消す時期（27）、ローカル翻訳の計測（34）
- ローカル翻訳の実行プロバイダと量子化の形: [`native/translate-onnx/README.md`](../../native/translate-onnx/README.md)
- ONNX への変換と CTranslate2 との比較: [`tools/translation_onnx/README.md`](../../tools/translation_onnx/README.md)
- [推論の実行基盤の比較](inference-runtime-comparison.md)、[対応環境の検証の記録](platform-verification.md)
- [ローカル翻訳の GPU と公開の準備](local-translation-gpu-2026-11-18.md)（DirectML で翻訳のグラフが動くようにした直しと、モデルの公開の道具）

## 受け入れ条件の状態

| 受け入れ条件 | 状態 | 根拠 |
|---|---|---|
| Windows の配布物が単一パッケージで、CPU と CUDA の区別がない | 満たす（次の版から） | 0.5.1 の `VRCT-VOX.zip` と `VRCT-VOX_cuda.zip` は同じ 729 個のファイル（展開して 102,141,609 バイト）でした。中身が違うのは別々にビルドした `vrct-vox.exe` と `_internal/build/astarot-rvc-worker.exe` の2つで、大きさは同じでした。判断 3 で CUDA 版をやめ、リリースの工程は `VRCT-VOX.zip` だけを作ります（「C. パッケージの一本化」） |
| NVIDIA、AMD、Intel の各 GPU で、音声認識とローカル翻訳の GPU 実行を実測 | 未実施 | 2026-11-15 の決定で 0.4.0 の前提から外した。計画は「GPU ベンダーの実測の計画」。ローカル翻訳は GPU で動かす手段がまだない（判断 5） |
| 既存利用者の設定が引き継がれ、faster-whisper の廃止の案内がある | 0.3.0 から 0.5 系まで満たした。0.6.0 で外した（判断 4） | 「既存の利用者への配慮」 |
| 同梱物に CTranslate2 と CUDA のライブラリがない | 満たす（0.5.0 から） | 0.5.0 で Python を配布物から外した。2026-11-18 から、配布物の検査（`tools/distribution_policy.py`）が CTranslate2 と CUDA の数学ライブラリを見つけると候補を止める |

## A. 音声認識の棚卸し（faster-whisper と speech.cpp）

faster-whisper のエンジンは 0.3.0（2026-11-15、#306）で除きました。下の表は 2026-11-14 の棚卸し（Issue のコメント）を、0.5.1 の中核に合わせて書き直したものです。「同等にできない」とした項目は 2026-11-14 の決定で廃止しました。

| 機能 | faster-whisper（0.2 まで） | speech.cpp（0.5.1 の中核） | 判定 | 扱い |
|---|---|---|---|---|
| モデルの大きさの選択 | 9 種。tiny、base、small、medium、large-v1〜v3、large-v3-turbo、large-v3-turbo-int8 | Whisper は動かない。Qwen3-ASR 0.6B と 1.7B（30 言語）、Parakeet TDT 0.6B v3（欧州の 25 言語）、日本語専用の 3 つ（ReazonSpeech v2、Parakeet TDT-CTC 0.6B ja、Haas-ja v1.0）、Nemotron 3.5 Transcribe（40 言語、大型）から選ぶ | 同等にできない | 廃止（決定 2026-11-14） |
| 小さいモデル | tiny は約 75 MB、base は約 145 MB | 最小で日本語専用 0.35 GB、多言語 0.51 GB | 同等にできない | 廃止に含む。性能の低い CPU で実用になるかは計っていない |
| 対応する言語 | アプリの言語の表で 69 言語 | Qwen3-ASR で 30 言語、Parakeet v3 を足して 38 言語 | 31 言語が同等にできない | 廃止（決定 2026-11-14） |
| 言語の指定 | できる | できる。モデルが受け付ける言語だけ。日本語専用のモデルは日本語だけ | 同等 | ― |
| 言語の自動判定 | できる。確からしさ（`language_probability`）で候補の中から選んでいた | Qwen3-ASR などは `auto` で判定し、判定した言語で翻訳の向きを決める。確からしさの値はない。言語を判定しないモデル（日本語専用のモデルなど）は `auto` を断る（`realtime_language_auto_unsupported`） | 一部同等 | 候補の中から選ぶ処理はない。言語の判定の細部は #278 の区切り 3-3 |
| 信頼度のしきい値（`avg_logprob`、`no_speech_prob`） | 設定できる | speech.cpp の答えに値がない | 同等にできない | 画面だけを廃止。設定の値と IPC は、OpenAI 互換のクラウドのエンジンが使うので残す（決定 2026-11-14） |
| 繰り返しの抑制（`no_repeat_ngram_size`） | 設定できる | 当たるオプションがない | 同等にできない | 廃止（決定 2026-11-14） |
| 計算デバイスと計算型 | CPU と CUDA（NVIDIA だけ）。計算型も選べる | CPU と Vulkan（NVIDIA、AMD、Intel）。精度はモデルの量子化（Q8_0 など）で選ぶ | 置き換えた | 計算型の設定は廃止（決定 2026-11-14）。GPU は speech.cpp のサーバの設定で選ぶ |
| VAD との連携 | アプリの Silero VAD で区切った音声を渡す | リアルタイム認識ではサーバの Silero VAD（GGUF。モデル取得のカタログの `silero-vad`）が区切る | リアルタイムは同等 | クラウドのエンジンの録音の VAD は、0.5.0 で中核に移したあと動いていない（core-integration の 13。#278 の区切り 3-4）。faster-whisper の置き換えとは別の問題 |
| リアルタイム認識 | 区切りごとに1回認識する。途中経過は伸びていくバッファを送り直して出す | Realtime（WebSocket）で途中経過を逐次受け取る | 同等以上 | Python との遅れの比較は #278 |
| モデルの取得 | Hugging Face のコミットに固定し、全ファイルの SHA-256 を確かめる | モデル取得のカタログに版、大きさ、SHA-256、ライセンスを固定する | 同等 | ― |
| 起動のしかた | エンジンを選ぶだけで、サイドカーの中にモデルを読み込む | 別のプロセスのサーバ。スイッチを入れたときに同梱のサーバを起動するかを設定で選べた（`REALTIME_ASR_SETTINGS.start_server`、既定はオン）。#1396 で設定をなくし、スイッチが常に起動する | 仕様を変えた | 決定 2026-11-14 の 3 |

speech.cpp にだけある機能は語彙の指定と話者の区別です。

## 既存の利用者への配慮

設定の引き継ぎ、お知らせ、古い Whisper の重みの削除は 0.3.0 から 0.5 系まで入っていました（0.5.0 で中核に移しました）。判断 4 により 0.6.0 で外しました。

0.5 系までの形は次のとおりでした。

- 保存した設定の `LOCAL_ASR_MIGRATION` が 2 より小さいとき、設定を一度だけ引き継ぎました。エンジンが `Whisper` なら `SpeechCpp`（ローカル）にし、Windows ではリアルタイム認識の接続先を同梱のサーバにして、お知らせの印（`LOCAL_ASR_NOTICE_PENDING`）を立てました。引き継ぐ前の設定は `config.json.before-migration-<段階>` に写しました。
- 起動時に一度だけお知らせを出しました（`LocalAsrNoticeController.jsx`）。Whisper がなくなったことと、必要なモデル（音声認識と VAD）が取得済みかを示し、設定を開くボタンを置いていました。
- 古い Whisper の重み（`<データ>/weights/whisper/` の下の 9 種の名前のフォルダ）を、利用者が頼んだときだけ消せました（設定の `OldWhisperWeights.jsx` とお知らせ）。

0.6.0 からは次のとおりです。

- 引き継ぎをしません。保存された `Whisper` は、外した Google と同じく未選択として読み込みます。利用者は最初の起動と同じくエンジンを選び直します（エンジンを選んでいないと初期設定の画面が開きます）。0.2 以前から 0.6.0 へ直接更新した利用者は、エンジンが引き継がれません。
- `LOCAL_ASR_MIGRATION` は `2` を書き続けます。0.5 以前の版へ戻したときに、その版が引き継ぎをやり直さないためです。`LOCAL_ASR_NOTICE_PENDING` は引退したキーとして捨てます。引き継ぐ前の写しは書きません。
- お知らせ、古い重みの欄、4 つのエンドポイント（`/get/data/local_asr_notice`、`/set/disable/local_asr_notice`、`/get/data/old_whisper_weights`、`/run/delete_old_whisper_weights`）はありません。古い重みのフォルダには触れません。
- 試験は `native/core/tests/lifecycle.rs` の `a_saved_whisper_choice_loads_as_none_without_a_notice` と `no_copy_before_a_migration_is_written_any_more`、`settings_endpoints.rs` の `the_old_whisper_weights_are_left_alone`、Python の結果との違いを決める `config_reference.rs` です。
- マニュアルの「以前の版でWhisperを使っていた場合」（`site/*/features/transcription.md`）は、0.6.0 のリリースに合わせてサイトの PR で直しました。

ほかの利用者への配慮は次のとおりです。

- 旧 CTranslate2 の翻訳の重みは、0.5.0 から起動の後に知らせずに消します（core-integration の「決まったこと」）。知らせるかどうかは core-integration の 26 で未決です。
- CUDA 版を入れていた利用者は、0.5.0 への更新で `_internal` が置き換わり、`_internal/nvidia` が消えます。次の更新からは標準版として更新します（core-integration の 20）。

## C. パッケージの一本化の計画

### いまの状態

- `backend_cuda.spec` は、0.5.0 で Python を配布物から外したとき（`8f186f6c`）に `spec/backend.spec` と一緒に消えました。
- `cuda` extra（`nvidia-cublas-cu12`、`nvidia-cudnn-cu12`）は、開発用の `.venv_cuda`（`bat/install.bat`、`mise run setup:app`）で `src-python/` の Python のバックエンドを動かすためのもので、配布物には入っていませんでした。2026-11-20 に、バックエンドと一緒に消しました（#285）。
- 0.5.1 の Windows の ZIP は約 36 MB、展開して約 0.1 GB です。0.4 の CPU 版は約 0.4 GB、CUDA 版は約 1.7 GB でした。音声認識の GPU 対応（speech.cpp の Vulkan 版）は入っています。ローカル翻訳の GPU 対応は、判断 5 の決定（#630 の判断 2 (c)）に沿って #277 で入れます。

### CUDA 版をやめた（判断 3、2026-11-19）

CUDA 版の ZIP には、0.5.0 から標準版にないものが何もありませんでした。判断 3 で CUDA 版をやめ、次のように変えました。

- **名前**: Windows の配布物は `VRCT-VOX.zip` の1つです。新しい名前は付けず、標準版の名前をそのまま使います。ASTAROT への改名は、内部識別子の移行（#635）で扱います。
- **インストーラー**（`src-tauri/nsis/template.nsi`）: 版を選ぶ画面、`PACKAGE_SHA256_GPU`、GPU 版の容量の目安をなくしました。`/EDITION=` は受け付けて読みません。0.5 までのアプリが更新のときに `/EDITION=gpu` を渡しても、`VRCT-VOX.zip` を取ります。`/VERSION` で 0.5 以前の版を入れるときも同じです。試験は `tests/installer/windows_update_scenarios.py` の「`/EDITION=cpu` と `/EDITION=gpu` が同じ ZIP を取る」場合です。
- **ハッシュの組み込み**（`tools/installer_package_hashes.py`）: `--package` の1つだけで、`PACKAGE_SHA256` を書きます。
- **リリースの工程**: `release.yml` の候補を作るジョブは `build` と `candidate` です（ほかに `changelog` があります）。`tools/release_candidate.py` は Windows の候補に `VRCT-VOX.zip` とインストーラーだけを求めます。`package.json` の `release-cuda` と `release-all` はなくしました。
- **アプリ**: `src-tauri/src/app_update.rs` は `/EDITION=` を渡しません。`_internal/nvidia` の判定もなくしました。中核の `/run/update_cuda_software` は IPC の契約なので残し、`/run/update_software` と同じ動きです。中核の `SoftwareUpdates::install` からエディションの引数を外しました。UI は `/run/update_software` だけを呼びます。設定の左下の版の表示から「CUDA」の印を外しました（計算デバイスの一覧に CUDA があると出ていた印で、配布物の名前と紛れるため）。
- **サイト**: ダウンロードの表示（`releases.mjs`）は、CUDA 版のない新しいリリースと、CUDA 版のある古いリリースの両方を扱えます（`tools/check_site_downloads.mjs` に両方の場合があります）。導入の案内（`site/*/guide/install.mdx` など）から版の選択と CUDA 版の説明を外すのは、CUDA 版のない最初のリリース（0.6.0）に合わせて別の PR で行いました。サイトは develop から公開するので、先に変えると当時のリリースの案内と食い違うためです。

新しい版から `VRCT-VOX_cuda.zip` はリリースに載りません。それを取りに行く外部の手順は動かなくなるので、変更には `!` と `BREAKING CHANGE:` を付けました。0.5 系のリリースの `VRCT-VOX_cuda.zip` はそのまま残ります。

### `cuda` extra を消す時期

`src-python/` を消したとき（2026-11-20、core-integration の 27、#285）に、`pyproject.toml` の `cuda`、`uv.lock`、`bat/install.bat`、`mise.toml` のタスク、`pytest.ini`、`docs/development.md` の記述を一緒に消しました。`.gitignore` と `vite.config.js` は、手元に残った古い `.venv_cuda` と `.venv_linux` を追跡と監視から外すために、名前を残しています。

## GPU ベンダーの実測の計画

受け入れ条件の「NVIDIA、AMD、Intel の各 GPU で実測」の根拠を作るための計画です。2026-11-15 の決定により、リリースを止める条件にはしていません。

### 対象

| 部品 | 実行基盤 | NVIDIA | Intel | AMD | GPU なし |
|---|---|---|---|---|---|
| 音声認識（同梱の speech.cpp 0.11.2、Vulkan 版） | Vulkan | 計る（単体 GPU） | 計る（内蔵 GPU） | 未検証（計れる機器がない） | 計る（Vulkan のドライバーを読ませない模擬） |
| ローカル翻訳（`native/translate-onnx`） | DirectML | 計る | 計る | 未検証 | ― |
| | CUDA | 計る | ― | ― | ― |
| | OpenVINO | ― | 計る | ― | ― |
| | CPU（基準） | ― | ― | ― | int8 と float32 は計測済み（`tools/translation_onnx/README.md`） |

### 計る前にそろえるもの

1. 音声認識: 同梱の speech.cpp と、カタログの Qwen3-ASR 0.6B Q8_0 と Silero VAD（同意を得て取得します）。計測の道具は #278 の `native/core/examples/live_asr.rs` です。中核をアプリと同じく起動し、デバイスと同じ間隔で音声を流します。#278 のマージを待ちます。
2. ローカル翻訳: ONNX の翻訳モデルは 2026-11-19 から公開していて、カタログから取得します（自分で作るときは `tools/translation_onnx/export.py`。元のモデルの取得に同意が要ります）。GPU の実行プロバイダを含む ONNX Runtime は同梱していません（同梱は CPU 版）。CUDA 版と DirectML 版はアプリの中で同意を得てから取得でき、ほかの版（OpenVINO 版など）は `ORT_DYLIB_PATH` で指します。道具は `astarot-translate` と、それを動かす `tools/translation_onnx/compare.py` です。`astarot-translate` は `--device directml:<番号>` などで機器を選び、実際に動いた実行プロバイダと CPU への切り替えを標準エラーに出します。DirectML では、2026-11-18 より後の `export.py` で作ったフォルダを使います（前のものは `Reshape` の `allowzero=1` のため動きません）。計る前に、`tools/translation_onnx/tiny.py` の小さなモデルと `tests/real.rs` の `a_device_decodes_as_the_cpu_does` で、その GPU で CPU と同じ訳になることを確かめられます。

### 手順

- speech.cpp では、`speech devices --json` の名前（`Vulkan0` など）をサーバの設定で指定して GPU を選びます。内蔵 GPU と単体 GPU がある PC では `auto` が内蔵 GPU を選ぶことがあるので、両方を名前で指定して別々に計ります。DirectML ではアダプターの番号で選びます。番号と GPU の対応を確かめてから記録します（`inference-runtime-comparison.md` では速さから推定しただけです）。
- GPU なしの構成は `VK_LOADER_DRIVERS_DISABLE=*` で Vulkan のドライバーを読ませずに模擬し、CPU に戻ることを確かめます。Direct3D 12 の変換層だけが残る構成も1回試します。この構成では、モデルは読めて最初の計算で失敗した記録があります（`windows-voice-report.md`）。
- シェーダーのキャッシュを空にした冷えた起動の1回目と、2回目以降を分けて計ります。
- 音声は、Windows の音声合成で作った日本語と英語の文（それぞれ 5 文以上）を、デバイスと同じ間隔で流します。人の声ではないことを記録に書きます。文字の誤り率は計りますが、認識した文はログにも記録にも出しません。
- 翻訳には、既存の比較と同じ会話を想定した日本語 30 文と英語 30 文を使います。M2M100 418M の float32 と float16 を GPU で、int8 を CPU（基準）で動かします。ビーム数はモデルの設定に従います。

### 計るもの

- 音声認識: 発話の終わりから確定まで（中央値と 90 パーセンタイル）、最初の途中経過まで、文字の誤り率、サーバの起動から準備ができるまで（冷えた1回目と2回目）、GPU メモリーの最大、プロセスごとの CPU 使用率、CPU への切り替えや失敗の知らせ。
- ローカル翻訳: 1 文の時間（読み込みを除く）、読み込みの時間、CPU の int8 との訳文の一致数と BLEU、GPU メモリー、実行プロバイダから CPU への切り替え（`/run/translation_compute_device_fallback`）の有無、メモリー不足を文面で見分けられるか（core-integration の 30）。
- 同時に使うとき: 音声認識、ローカル翻訳、読み上げを同じ GPU で動かしたときの遅れ（core-integration の 34）。

### 合格の目安（案）

- 選んだ GPU で実際に動いたこと。speech.cpp のログの機器名と `astarot-translate` が出す実行プロバイダで確かめ、CPU への切り替えの知らせが出ないこと。
- 結果が CPU と同等であること。音声認識は文字の誤り率の差が 0.01 以内、ローカル翻訳は BLEU の差が既存の比較（CTranslate2 との差 −0.48〜+0.27）と同じ幅に収まること。
- 音声認識の確定までの遅れが、同じ PC の CPU より長くならないこと。

数値の目安は案で、決まっていません。

### 記録のしかた

版、コミット、OS とその版、GPU の型番、ドライバーの版、接続（内蔵、単体、外付け）、GPU メモリーの量、同時に動いていたものを書きます。結果は[対応環境の検証の記録](platform-verification.md)に足してから、マトリクスの欄を変えます。PC の持ち主が分かる情報は書きません。ある PC での値を一般の保証にはしません。

### AMD の GPU（利用者からの報告、判断 6）

AMD の GPU は計れる機器がないので、利用者からの報告で埋めます（2026-11-19 の決定）。テレメトリは広げません。報告する人の心理的な障壁と実際の手間を下げることを設計の条件にしたので、次の形にしました。

- 自動で計る道具: 設定の「高度な設定」→「GPUの動作の報告」の「確かめる」を押すだけで中核が計ります（`native/core/src/controller/gpu_check.rs`）。同梱の speech.cpp のコマンドで取得済みの読み上げと音声認識のモデルを使い、決まった短い文を CPU と各 GPU で動かします。上の計画の「計るもの」のうち、読み込みの時間、処理の時間と実時間に対する速さ、実際に使われた機器、CPU との文字の誤り率、失敗の種類が入ります。モデルを取得せず、マイク、スピーカー、VRChat を使いません。ある PC で 1 分ほどでした（Windows 11、RTX 3060 Ti と Iris Xe と CPU、Irodori-TTS Q8_0 と Qwen3-ASR 0.6B Q8_0。CPU の読み上げに 36 秒）。
- 送る内容を事前に全部見せる: 結果は整形した JSON の全文を画面に出し、機器ごとの表も添えます。コピーする内容と GitHub に送る内容は、画面の全文とまったく同じ文字列です。アプリは何も送りません。
- 個人を特定する情報を含めない: 入るのは版、機器の名前、丸めたメモリーの量、ドライバの版、モデルが持つ名前、時間と誤り率だけです。ファイルの場所、ユーザー名、PC の名前、文と音声、speech.cpp のメッセージ（ファイルの場所を含む）は入れません。中核の試験（`native/core/tests/gpu_check.rs`）が、利用者名や文が報告に入らないことを確かめます。
- 送り方: 「GitHubで報告する」が Issue の様式（`.github/ISSUE_TEMPLATE/gpu_report.yml`）を結果を入れた状態で開きます。送る前に GitHub の画面でもう一度確かめられます。GitHub のアカウントが要ります。
- 募集の告知: サイトの手順のページとリリースノートで募ります。サイトは develop から公開するので、手順のページはこの機能が入ったリリースに合わせて足します。

翻訳の計測（`translation.measured`）は、GPU の実行プロバイダを取得できるようになる #277 の後に足します。いまの報告には、翻訳で選べる計算デバイスの一覧だけが入ります。届いた結果は「対応環境の検証の記録」に、利用者からの報告として版と GPU と結果を足します。

## 決まったこと（2026-11-19）

Issue #288 と PR #616、PR #630 に記録した決定です。下の「判断が要ること」は、決める前の選択肢の記録として残します。

| 判断 | 決定 | 実装 |
|---|---|---|
| 1. speech.cpp のバックエンドの構成 | (c)。GPU ベンダー専用のビルド（CUDA など）を、同意を得て取得できる形にする。同梱はしない。同梱の基本の構成（Windows は Vulkan 版 1 つ、Linux は Vulkan 版と CPU 版）は保つ | 上流は CUDA 版を配っていない（上流の `docs/install.md` で「ビルドはできるが確かめも配布もしていない」）ので、このプロジェクトでビルドして配る。ビルドの工程と、同意を得て取得する仕組みに分けて入れる |
| 2. NLLB の差し替え | (a)。ライセンス（CC-BY-NC-4.0、非商用）と大きさを見せて、同意するかを選ばせる形で公開する。既定は M2M100 のまま（#630 の判断 78） | #277 |
| 3. CUDA 版のパッケージ | やめる | 「CUDA 版をやめた」 |
| 4. faster-whisper の廃止の告知と移行 | 告知と移行の画面は残さない。引き継ぎと古い Whisper の重みの削除の画面も残さない（0.6.0 で外す） | 「既存の利用者への配慮」を外す PR |
| 5. ローカル翻訳を GPU で動かす手段 | 既定の配布は CUDA 版と CPU 版。DirectML は任意の追加のダウンロードで、同梱しない（#630 の判断 2 (c)） | #277 |
| 6. AMD の GPU の実測 | 利用者からの報告を募る。テレメトリは広げない。報告する人の心理的な障壁と実際の手間を下げることを必須とする（自動で計測して結果を出す道具を用意する、送る内容を事前に全部見せる、個人を特定する情報を含めない） | 計測の道具と報告の様式を入れる PR |

## 判断が要ること（決める前の記録）

1. 同梱する speech.cpp のバックエンドの構成（Issue の未決事項の 1）: いまは Windows が 0.11.2 の Vulkan 版 1 つ（同じ実行ファイルで CPU でも動く）、Linux が Vulkan 版と CPU 版の 2 つ（Vulkan のローダーがなければ CPU 版）です。案は (a) このまま、(b) Windows にも CPU だけのビルドを足す（Vulkan のドライバーが壊れた PC の逃げ道。配布物が増える）、(c) GPU ベンダー専用のビルド（CUDA など）を同意を得て取得できるようにする（同梱はしない）、です。決める材料は、実測の計画で得る NVIDIA と Intel の結果です。
2. NLLB の差し替えの検討（Issue の未決事項の 2）: ONNX にしたときの BLEU の差は、5 つのモデルで −0.48〜+0.27 でした。NLLB 3.3B は英語へ訳す 4 方向がそろって少し低い結果でした（#310）。NLLB は CC-BY-NC-4.0 なので既定にしません。既定は M2M100 418M（MIT）です。案は (a) NLLB を ONNX にして公開し、非商用の同意を残す、(b) 公開せず、利用者が自分で変換して置く（自分のモデルの置き場所がある）、(c) ほかのモデルへの差し替えを調べる、です。公開するかどうかは core-integration の 1 と一緒に決めます。#277 の範囲です。
3. CUDA 版のパッケージ（core-integration の 20）: 案は (a) 同じ中身で作り続ける、(b) やめて、インストーラーの GPU の選択を標準版に読み替える、です。(b) の手順は上の「手順」にあります。(a) でも、インストーラーの説明文と容量の目安は直します。
4. faster-whisper の廃止の告知と移行期間（Issue の未決事項の 3）: 実際には 0.3.0（2026-11-15）で、移行期間を置かずに除きました。告知は 0.3.0 のリリースノート、起動時に一度だけのお知らせ、マニュアルで行いました。残る判断は、引き継ぎ（`LOCAL_ASR_MIGRATION` の段階 2）と古い Whisper の重みの削除の画面をいつまで残すかです。案は (a) 当面残す（コードは小さい）、(b) 区切りの版で外す（外した後に 0.2 以前から更新した利用者は、エンジンが引き継がれない）、(c) 重みの削除の画面だけ残す、です。
5. ローカル翻訳を GPU で動かす手段（core-integration の 2 の残り）: 同梱は CPU 版の ONNX Runtime だけなので、受け入れ条件の「ローカル翻訳の GPU 実行」は、これが決まるまで配布物では確かめられません（ライブラリを手で置けば計れます）。案は core-integration の 2 の (b) DirectML 版を同梱する（約 18.5 MB 増え、ONNX Runtime が 1.24.4 に下がる）と、(c) 同意を得てから取得する、です。#277 の範囲です。
    - 2026-11-19 に (c) に決まりました。配布物は CPU 版だけのままで、CUDA 版（NVIDIA のドライバーがあるとき）と DirectML 版（Windows）は利用者が同意してから取得します。CUDA のライブラリを配布物に入れないという受け入れ条件は変わりません。配布物の GPU 実行の実測は、取得した版で行います。
6. AMD の GPU の実測をどう埋めるか: 案は (a) 未検証のまま、マトリクスに「未検証」と書く（いまの形）、(b) 利用者に計測の手順を渡して報告を受ける、(c) AMD の GPU のある環境を用意する、です。

## 残っている作業

- 判断 1 の実装（「決まったこと」の表）。判断 4 と 6 は 0.6.0 で入れました（`native/core/src/controller/gpu_check.rs`、`.github/ISSUE_TEMPLATE/gpu_report.yml`）。
- #278 のマージの後に、音声認識の実測を行います。翻訳のモデルを作ったら、ローカル翻訳の実測を行います。
- `site/*/guide/requirements.mdx` のアプリの大きさは、2026-11-23 に 0.6.0 の配布物の値に直しました（Windows の ZIP は約 0.17 GB で展開して約 0.46 GB、Linux の tar.gz は約 0.19 GB で展開して約 0.51 GB）。「すべての機能をそろえるなら Windows で約 11 GB」の目安は、表の各項目の上限を足すと約 11.6 GB で、目安として変えていません。
