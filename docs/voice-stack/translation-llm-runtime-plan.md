# Plan for choosing and adding a translation LLM runtime (2026-11-19)

[日本語版](#翻訳の-llm-の実行基盤の選定と導入の計画2026-11-19日本語版)

Researched on 2026-11-19. Status: **proposal** (decisions 1, 2, 4, 5 and 7 were made on 2026-11-19; see 8). This is stage 2 of [ADR-015](../adr/adr-015-translation-llm-runtime-exception.md) and input for Issue #412. The maintainers decide, and this plan itself does not change code, the catalog or displayed text. The progress of the stage 3 implementation of the recommended option is in the table at the end of 6, and the measurement results are in "Measurements for 3-6" in 6.

This plan chooses an LLM runtime for running TranslateGemma inside the app, and summarizes the effect on the distribution's size, whether to bundle the runtime or fetch it later, and the licenses. The figures come from release information published as of 2026-11-19 (metadata returned by the GitHub, NuGet, PyPI and Hugging Face APIs), and no files were downloaded. Speed and memory were not measured (6).

## 1. Premises

- On 2026-11-19 the maintainers decided to run TranslateGemma on an LLM runtime, handled as an exception to ADR-012. Handling consent to the terms of the gated weights is also in scope for the implementation (Issue #412, ADR-015).
- The default translation engine and model do not change. TranslateGemma is used only when the user selects it.
- The app's current setup (develop as of 2026-11-19) is as follows.
  - Speech recognition and TTS run the bundled speech.cpp server in a separate process (GGML, Vulkan). The core's `native/speech-server` handles startup, the port, the readiness check and stopping.
  - Local translation and OCR use ONNX Runtime 1.31.0 (the CPU build is bundled).
  - The GPU runtime for voice conversion (the GPU build of ONNX Runtime, CUDA and cuDNN) is not bundled. After the user consents, it is fetched from Hugging Face, NuGet and PyPI with its versions and SHA-256 pinned (`native/voice-conversion/src/runtime.rs`).

## 2. Comparing the candidates

| Item | llama.cpp (`llama-server`) | ONNX Runtime GenAI |
|---|---|---|
| License | MIT | MIT |
| Version (2026-11-19) | b12529 (GitHub Release) | 0.20.0 (NuGet, PyPI) |
| Distribution size (Windows x64) | CPU build 25.7 MB, Vulkan build 38.9 MB (ZIP). The CUDA 13.5 build is 229.0 MB, plus 426.3 MB of CUDA runtime libraries | Library 4.9 MB (Python wheel). ONNX Runtime 1.32.0 is also needed. The CUDA build's library is 9.2 MB and needs the GPU build of ONNX Runtime and CUDA |
| Distribution size (Linux x64) | CPU build 23.9 MB, Vulkan build 36.9 MB (tar.gz). The CUDA build is 228.0 MB plus the runtime libraries | Library 7.2 MB (CUDA build 12.6 MB). ONNX Runtime 1.32.0 is also needed |
| GPU | Vulkan (NVIDIA, AMD, Intel), CUDA and others | CUDA. The DirectML build stopped being updated at 0.14.1 (ONNX Runtime 1.23.0) |
| Model format | GGUF (one file) | A folder of ONNX files and `genai_config.json` |
| Size of TranslateGemma 4B | 2.49 GB at Q4_K_M, 4.13 GB at Q8_0 (sizes of third-party conversions; text only) | About 3.09 GB as int4 ONNX (size of a third-party conversion) |
| How the app connects | An HTTP server in a separate process (`/completion`, OpenAI-compatible API). It can be managed the same way as the speech.cpp server | A C API loaded into the core's process. Rust needs its own FFI |
| Relation to the current base | The same GGML family as speech.cpp. Vulkan device selection and GPU handling are easy to align | The same ONNX Runtime as OCR and translation, but the bundled 1.31.0 has to be raised to 1.32.0. Raising it also moves the version used by OCR, translation and voice conversion |

Other Rust runtimes (mistral.rs, candle and others) were not compared this time, because it is unknown whether they run on Vulkan and how much work converting Gemma 3 takes.

## 3. Recommendation: run llama.cpp's `llama-server` in a separate process

The reasons are as follows.

- It can be managed the same way as the speech.cpp server (a separate process, port 0, a readiness check, stopping). If the runtime crashes, it does not take the core or the audio path down with it (2.4 of ADR-015).
- The Vulkan build can use NVIDIA, AMD and Intel GPUs and is about 13 MB larger than the CPU build. Its device selection can match speech.cpp's Vulkan device selection (`Vulkan0`, `Vulkan1`).
- It adds no C++ build to the core. A published build is pinned and fetched.
- ONNX Runtime GenAI needs the bundled ONNX Runtime to be upgraded, and its DirectML build for Windows is no longer updated. It would also need new FFI code in the core.

## 4. Distribution: do not bundle; fetch when selected

- The runtime is not put in the app's ZIP or AppImage. The distribution size does not change.
- When the user selects TranslateGemma and consents on the download screen, the app fetches a pinned version of `llama-server`. Only the Vulkan builds for Windows and Linux x64 are offered, and the same build is used when running on the CPU only (decision 5, decided on 2026-11-19). The CUDA build (over 600 MB with its runtime libraries) is not handled at first.
- What is fetched has its version, size and SHA-256 pinned. The source is one of the following two, which is decision 2.
  - (a) The GitHub Release (a pinned tag of `ggml-org/llama.cpp`). Add the GitHub Release hosts to the download allowlists (`HOSTS` in `native/ops/src/downloads/transport.rs` and `SOURCE_HOSTS` of the voice conversion runtime).
  - (b) Copy it to the project's Hugging Face repository. The current download mechanism (Hugging Face only) can stay as it is, but copying the files and adding the original license text take work.
- Bundling the runtime (the ZIP grows by 25.7 MB with the Windows CPU build) is not recommended, because it raises everyone's download size for a feature few people use.

## 5. Weights and consent to the terms

### 5.1 Obtaining the weights

The official weights (`google/translategemma-4b-it`) are gated and contain only 16-bit safetensors. There is no official GGUF version. Converting them to GGUF on the user's PC needs Python, and the app does not bundle Python. That leaves the following two options.

| Option | What it is | Advantages | Costs |
|---|---|---|---|
| (A) The project converts and publishes | The maintainers pass the gate of the official weights and convert them to GGUF (such as Q4_K_M) with llama.cpp's conversion tools. They publish the result on the project's account with the Gemma terms, the Prohibited Use Policy and `NOTICE`. No gate is added | Users need no sign-in and no token. The same form as the precedent (Irodori-TTS v4 Large) | The project becomes a distributor and takes on the obligations of section 3.1 of the terms. Converting and publishing are work for the maintainers |
| (B) Publish the conversion from (A) with a gate | Publish the same conversion as (A) behind a Hugging Face gate (acceptance of the terms) | Consent to the terms is also recorded by Hugging Face's mechanism | Users need a Hugging Face account and a token. The app needs a way to receive the token (kept in the OS credential store and attached only to requests to `huggingface.co`; ADR-013) |

The recommendation is (A). Under (A), the decision's "handling consent to the terms of the gated weights" is implemented as consent on the app's download screen (5.2). If (B) is chosen, add screens and tests for receiving, storing and deleting the token to stage 3.

### 5.2 Consent on the download screen

- Add the kind `gemma_terms` to the "restriction acknowledgement" added in #642. For an entry whose license string includes the Gemma Terms of Use, show links to the terms and to the Prohibited Use Policy before the download, state that the terms also apply to the person using the model, and require a checkbox separate from consent. Without that checkbox, the core refuses the download.
- Require this acknowledgement only for translation entries. Do not add it to Irodori-TTS v4 Large, which is under the same terms (decision 4, decided on 2026-11-19).
- Fetching the runtime (`llama-server`) also asks for consent, showing the MIT license and the download size.

## 6. Order of the stage 3 implementation

| Step | What | Main places |
|---|---|---|
| 3-1 | The `gemma_terms` kind of terms acknowledgement (5.2) | `native/ops/src/downloads/catalog.rs`, `manager.rs`, `ModelDownloads.tsx`, `locales/` |
| 3-2 | Fetching and verifying `llama-server` (pinned version, size and SHA-256, consent, source hosts) | `native/ops`, or a new module shaped like the voice conversion runtime |
| 3-3 | Managing the `llama-server` process (startup, port 0, readiness check, stopping, a notice when it crashes). Test with a fake server | Follow the management of the speech.cpp server (`native/speech-server`) |
| 3-4 | The translation provider. Build TranslateGemma's template text and send it to `/completion` (no system role, ISO codes for languages, no conversation context, temperature 0). Do not log the source text or the translation | `native/translation` |
| 3-5 | The catalog. Add the runtime `llamacpp` to the translation catalog's inference-engine group and make TranslateGemma 4B a built-in entry. List the model published under (A) with its version, size and SHA-256 pinned | `translation_catalog.rs`, and `native/ops/data/translation_models.json` or new data |
| 3-6 | Measurement (5 of ADR-015). Measure 4B's load time, maximum memory and VRAM and time per utterance, alongside VRChat, speech recognition and TTS, on Windows and Linux. Compare translation quality with NLLB-200 and M2M100 on the same sentences | Real hardware |
| 3-7 | Records. `NOTICE.md`, the license register, the model download document, the manual | Documents |

If the results of 3-6 do not meet the conditions in 5 of ADR-015, do not put the feature in the product, and revisit ADR-015.

### Progress of stage 3 (2026-11-19)

The stage was implemented with the recommended option (llama.cpp, (a) GitHub Release) and adjusted to the decisions of 2026-11-19 (decisions 2, 4 and 5).

| Step | State | What |
|---|---|---|
| 3-1 | Implemented | The `gemma_terms` acknowledgement. It applies only to translation entries, not to Irodori-TTS v4 Large (decision 4) |
| 3-2 | Implemented | `llama-server` from llama.cpp b12125 (the Vulkan builds for Windows and Linux x64 only) is fetched from the GitHub Release after consent. `github.com` and `release-assets.githubusercontent.com` were added to the source hosts (decisions 2 and 5) |
| 3-3 | Implemented | `llama` in `native/speech-server` owns the process. Tested with a fake server |
| 3-4 | Implemented | `translategemma` in `native/translation` builds the template text and sends it to `/completion` |
| 3-5 | Partly | `llamacpp` was added to the translation catalog's inference-engine group, and users can add their own GGUF file. The file path goes in the entry's `file` (`translation_catalog.json` is version 2 while such an entry exists). The built-in TranslateGemma entry is not listed until the (A) conversion is published (decision 3) |
| 3-6 | Partly | Load time, memory and VRAM, time per utterance and translation quality were measured on one Windows PC ("Measurements for 3-6" below). Measurements alongside VRChat, speech recognition and TTS, and on Linux, are not done yet |
| 3-7 | Partly | Recorded in `NOTICE.md`, the license register, [model downloads](model-downloads.md#翻訳のカタログ413) and the spec. The manual is not done yet |

### Measurements for 3-6 (2026-11-19, Windows)

With approval, a third-party GGUF conversion and the pinned `llama-server` were downloaded and measured. The downloaded files were deleted after the measurement. The source texts and the translations were not recorded.

- Environment: Windows 11 Home (build 26320), Intel Core i7-1255U (10 cores, 12 threads), 32 GB RAM, NVIDIA GeForce RTX 3060 Ti 8 GB (connected over Thunderbolt, driver 617.42) and Intel Iris Xe. The Vulkan build of llama.cpp b12125 (`llama-b12125-bin-win-vulkan-x64.zip`, SHA-256 `29db8012…`). `Vulkan0` is the Iris Xe and `Vulkan1` is the RTX 3060 Ti.
- Model: `translategemma-4b-it.Q4_K_M.gguf` from [mradermacher/translategemma-4b-it-GGUF](https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/tree/d37868f759d2f817a43d28dd80cf9f982ffa62fd) @ `d37868f759d2f817a43d28dd80cf9f982ffa62fd` (2,489,909,760 bytes, SHA-256 `81200d03e843d2ec1ece6eeafe7d13cb6e5211e1fcd336ade55790b683a08330`, text only).
- The server started with the same arguments as the app (`--ctx-size 2048 --parallel 1`; `--device VulkanN --n-gpu-layers 999` for a GPU, `--device none --n-gpu-layers 0` for the CPU), with the same template text as the app and `/completion` at temperature 0. For comparison, NLLB-200 distilled 600M and M2M100 418M ran as the int8 ONNX conversions for `native/translate-onnx`, on the CPU through the `astarot-translate` CLI (the CPU build of ONNX Runtime 1.32.0, used the same way as `tools/translation_onnx/compare.py`).
- Method: the load time runs from startup until `/health` returns 200. RAM is the process's peak working set (`GetProcessMemoryInfo`). VRAM is the largest increase in `nvidia-smi` usage over the level before startup (sampled every 0.25 seconds; the Iris Xe uses shared memory, so it cannot be measured). The time per utterance runs from the request to the answer, for short conversational sentences (30 in English and 30 in Japanese; the first sentence was left out as warm-up).
- Conditions: the only other process using the GPU was Steam, and VRAM use was 4 MiB before and after the measurement. The CPU was shared with other work (builds and tests from another session, `astarot-translate`), and the CPU usage of the whole PC during the measurement was 74% to 99%. The times may come out slower than on an idle PC.

| Item | TranslateGemma 4B Q4_K_M, RTX 3060 Ti | Same, Iris Xe | Same, CPU only | NLLB-200 600M int8, CPU | M2M100 418M int8, CPU |
|---|---|---|---|---|---|
| Load | 7.9–9.0 s | 36.2 s | 3.3–11.6 s | 9.4 s (to the first answer) | 3.7 s (to the first answer) |
| Peak RAM | 3.2 GB (`--cache-ram 0`) | 3.5 GB | 4.2 GB | 1.4 GB | 1.1 GB |
| VRAM increase | 2.7 GB | Cannot be measured | 0 | 0 | 0 |
| Per utterance, en→ja (median / 90th percentile) | 234 / 292–607 ms | 1,413 / 1,643 ms | 2,131 / 2,388 ms | 746 / 973 ms | 538 / 710 ms |
| Per utterance, ja→en (median / 90th percentile) | 211–217 / 243–347 ms | 1,437 / 1,557 ms | 2,132 / 2,334 ms | 735 / 1,106 ms | 456 / 600 ms |
| Generation speed | 74–87 tokens/s | 14 tokens/s | 15.5 tokens/s | — | — |

- The pairs of values for the RTX come from a run with the default settings and a run with `--cache-ram 0`. The CPU-only values are from a rerun with `--cache-ram 0`; the first run, when the PC was especially busy, is left out (medians of 4.9 s and 3.3 s, 90th percentile of 14.0 s). The CPU-only load time of 3.3 s was measured with the file already in the OS cache.
- By default, `llama-server` b12125 uses up to 8 GiB of RAM for the prompt cache. Translating the 800 WMT20 sentences on the RTX grew the process's memory to 11.4 GB. With `--cache-ram 0` it stayed at 3.2 GB, and neither the translations nor the speed changed. Each sentence is translated independently, so the app starts the server with `--cache-ram 0`.

Translation quality (the first 100 sentences of WMT20 in each direction, sacrebleu 2.6.0; BLEU is character-based for Japanese and Chinese and uses 13a for the others; values are BLEU / chrF):

| Direction | TranslateGemma 4B Q4_K_M | NLLB-200 600M int8 | M2M100 418M int8 |
|---|---|---|---|
| en-ja | 31.21 / 28.36 | 27.17 / 24.34 | 30.80 / 26.53 |
| ja-en | 17.07 / 46.88 | 11.11 / 37.88 | 10.62 / 37.48 |
| en-zh | 33.51 / 30.58 | 22.35 / 21.31 | 28.96 / 24.90 |
| zh-en | 22.67 / 54.41 | 20.25 / 50.43 | 18.05 / 49.77 |
| en-de | 29.37 / 58.41 | 29.27 / 57.77 | 23.22 / 53.52 |
| de-en | 36.91 / 63.65 | 30.95 / 55.90 | 30.82 / 57.64 |
| en-ru | 15.41 / 46.59 | 15.97 / 45.70 | 12.89 / 41.57 |
| ru-en | 30.87 / 62.76 | 35.66 / 63.97 | 30.04 / 60.59 |
| Average | 27.13 / 48.95 | 24.09 / 44.66 | 23.18 / 44.00 |

- TranslateGemma had the highest BLEU and chrF in 6 of the 8 directions, and in ja-en its BLEU was nearly 6 points higher. For en-ru and ru-en, NLLB-200 scored higher.
- NLLB-200 returned no translation for 4 of the 800 sentences, which were counted as empty translations. TranslateGemma (generation limit of 512 tokens) and M2M100 had no failures.
- Translation quality was measured only on the RTX 3060 Ti, not on the CPU or the Iris Xe.

Of the conditions in 5 of ADR-015, the values with VRChat, speech recognition and TTS running at the same time and the values on Linux are still missing. On the RTX 3060 Ti one utterance took 0.2 to 0.6 seconds, and the VRAM increase was 2.7 GB. On the CPU only, one utterance takes about 2 seconds.

## 7. Licenses

- llama.cpp and ggml are MIT. Check the licenses of the other components in the Release archives (such as the HTTP server and JSON libraries) against the contents of the version that is fetched, and record them in `NOTICE.md` and the license register (step 3-2).
- TranslateGemma's weights are under the Gemma Terms of Use and the Prohibited Use Policy. A conversion published under (A) comes with a copy of the terms, the Prohibited Use Policy, a `NOTICE` with the fixed sentence and a model card that states the conversion.
- ONNX Runtime GenAI is also MIT, but choosing it would require a separate check of what upgrading ONNX Runtime does to OCR, translation and voice conversion.

## 8. Decisions

1. Runtime: llama.cpp (recommended) or ONNX Runtime GenAI. → Decided: llama.cpp (2026-11-19).
2. Source of `llama-server`: (a) the GitHub Release (adding allowed hosts) or (b) a copy in the project's Hugging Face repository. → Decided: (a) the GitHub Release (2026-11-19).
3. Form of the weights: (A) publish without a gate, with the terms attached (recommended), or (B) publish with a gate and handle tokens in the app. (Undecided)
4. Whether to add the terms acknowledgement (`gemma_terms`) to Irodori-TTS v4 Large as well. → Decided: add it only to translation entries, not to Irodori-TTS v4 Large (2026-11-19).
5. GPUs handled first: only the Vulkan and CPU builds (recommended), or the CUDA build as well. → Decided: offer only the Vulkan build (2026-11-19). The Vulkan build is also used when running on the CPU only.
6. Quantization: use Q4_K_M (2.49 GB) as the base, or also offer Q8_0 (4.13 GB). To be decided by measurement (3-6). (Undecided; Q8_0 has not been measured yet)
7. Download for measurement: whether to allow downloading a third-party GGUF conversion and `llama-server` to try them before step 3-6 (several GB). → Allowed, and measured as in "Measurements for 3-6" in 6 (2026-11-19).

Decided during the implementation (decision of 2026-11-19): a `llamacpp` entry puts the GGUF file path in `file`, not in `folder`. While such an entry exists, `translation_catalog.json` is version 2, and earlier app versions that read only version 1 treat the whole file as unreadable (they do not overwrite it). Removing all `llamacpp` entries returns the file to version 1.

---

# 翻訳の LLM の実行基盤の選定と導入の計画（2026-11-19）（日本語版）

調べた日: 2026-11-19。状態: **提案**（判断項目 1、2、4、5、7 は 2026-11-19 に決定。8 を参照）。[ADR-015](../adr/adr-015-translation-llm-runtime-exception.md) の段階 2 で、Issue #412 の材料である。決めるのは保守担当者で、この計画そのものはコード、カタログ、表示する文言を変えていない。推奨の案での段階 3 の実装の進み具合は 6 の末尾の表に、計測の結果は 6 の「3-6 の計測」にある。

TranslateGemma をアプリの中で動かす LLM 用の実行基盤を選び、配布の大きさへの影響、同梱するか後から取得するか、ライセンスをまとめた。数値は 2026-11-19 に公開されていたリリースの情報（GitHub、NuGet、PyPI、Hugging Face の API が返すメタデータ）で、ファイルは取得していない。速さとメモリーは計っていない（6）。

## 1. 前提

- 保守担当者は 2026-11-19 に、TranslateGemma を LLM 用の実行基盤で動かし、ADR-012 の例外として扱うと決めた。ゲート付きの重みの規約への同意の扱いも実装の範囲に入る（Issue #412、ADR-015）。
- 既定の翻訳エンジンとモデルは変えない。TranslateGemma は利用者が選んだときだけ使う。
- アプリの今の構成（2026-11-19 の develop）は次のとおり。
  - 音声認識と読み上げは、同梱の speech.cpp のサーバーを別のプロセスで動かす（GGML、Vulkan）。中核の `native/speech-server` が起動、ポート、準備の確認、停止を受け持つ。
  - ローカル翻訳と OCR は ONNX Runtime 1.31.0（CPU 版を同梱）。
  - 声質変換の GPU の実行環境（ONNX Runtime の GPU 版、CUDA と cuDNN）は同梱せず、利用者の同意を得てから、版と SHA-256 を固定して Hugging Face、NuGet、PyPI から取得する（`native/voice-conversion/src/runtime.rs`）。

## 2. 候補の比較

| 項目 | llama.cpp（`llama-server`） | ONNX Runtime GenAI |
|---|---|---|
| ライセンス | MIT | MIT |
| 版（2026-11-19） | b12529（GitHub の Release） | 0.20.0（NuGet、PyPI） |
| 配布物の大きさ（Windows x64） | CPU 版 25.7 MB、Vulkan 版 38.9 MB（ZIP）。CUDA 13.5 版は 229.0 MB で、CUDA の実行時のライブラリが別に 426.3 MB | 本体 4.9 MB（Python のホイール）。ほかに ONNX Runtime 1.32.0 が要る。CUDA 版の本体は 9.2 MB で、ONNX Runtime の GPU 版と CUDA が要る |
| 配布物の大きさ（Linux x64） | CPU 版 23.9 MB、Vulkan 版 36.9 MB（tar.gz）。CUDA 版は 228.0 MB と実行時のライブラリ | 本体 7.2 MB（CUDA 版は 12.6 MB）。ほかに ONNX Runtime 1.32.0 |
| GPU | Vulkan（NVIDIA、AMD、Intel）、CUDA、ほか | CUDA。DirectML 版は 0.14.1（ONNX Runtime 1.23.0）で更新が止まっている |
| モデルの形 | GGUF（1つのファイル） | ONNX と `genai_config.json` のフォルダ |
| TranslateGemma 4B の大きさ | Q4_K_M で 2.49 GB、Q8_0 で 4.13 GB（第三者の変換の大きさ。文章だけ） | int4 の ONNX で約 3.09 GB（第三者の変換の大きさ） |
| アプリとのつなぎ方 | 別のプロセスの HTTP のサーバー（`/completion`、OpenAI 互換の API）。speech.cpp のサーバーと同じ形で管理できる | 中核のプロセスに読み込む C の API。Rust からは自前の FFI が要る |
| 今の基盤との関係 | speech.cpp と同じ GGML の系統。Vulkan の機器の選び方と GPU の扱いをそろえやすい | OCR と翻訳と同じ ONNX Runtime だが、同梱の 1.31.0 を 1.32.0 に上げる必要がある。上げると OCR、翻訳、声質変換の版も動く |

ほかの Rust の実行基盤（mistral.rs、candle など）は、Vulkan で動かせるか、Gemma 3 の変換の手間がわからないので、今回は比べていない。

## 3. 推奨：llama.cpp の `llama-server` を別のプロセスで動かす

理由は次のとおり。

- speech.cpp のサーバーと同じ形（別のプロセス、ポート 0、準備の確認、停止）で管理できる。実行基盤が落ちても、中核と音声の経路を巻き込まない（ADR-015 の 2.4）。
- Vulkan 版で NVIDIA、AMD、Intel の GPU を使え、CPU 版との差は約 13 MB である。speech.cpp の Vulkan の機器の選び方（`Vulkan0`、`Vulkan1`）とそろえられる。
- 中核に C++ のビルドを足さない。公開されたビルドを固定して取得する。
- ONNX Runtime GenAI は、同梱の ONNX Runtime の版を上げる必要があり、Windows の DirectML 版の更新が止まっている。中核への FFI も新しく書くことになる。

## 4. 配布：同梱せず、選んだときに取得する

- アプリの ZIP と AppImage には入れない。配布物の大きさは変わらない。
- 利用者が TranslateGemma を選び、取得の画面で同意したときに、`llama-server` の固定した版を取得する。出すのは Windows と Linux x64 の Vulkan 版だけで、CPU だけで動かすときも同じ版を使う（判断項目 5、2026-11-19 に決定）。CUDA 版（実行時のライブラリと合わせて 600 MB 以上）は最初は扱わない。
- 取得するものは版、大きさ、SHA-256 を固定する。取得元は次のどちらかで、判断項目 2 とする。
  - (a) GitHub の Release（`ggml-org/llama.cpp` の固定のタグ）。取得の許可の一覧（`native/ops/src/downloads/transport.rs` の `HOSTS` と、声質変換の実行環境の `SOURCE_HOSTS`）に GitHub の Release のホストを足す。
  - (b) プロジェクトの Hugging Face のリポジトリに写す。今の取得の仕組み（Hugging Face だけ）のままでよいが、写す作業と、元のライセンスの文を添える手間がかかる。
- 同梱する案（Windows の CPU 版で ZIP が 25.7 MB 増える）は、使う人が少ない機能のために全員の取得量を増やすので勧めない。

## 5. 重みと規約への同意

### 5.1 重みの入手

公式の重み（`google/translategemma-4b-it`）はゲート付きで、中身は 16 ビットの safetensors だけである。GGUF の公式の版はない。利用者の PC で GGUF に変換するには Python が要り、アプリは Python を同梱していない。そこで次の2つの形がある。

| 形 | 中身 | 利点 | 負担 |
|---|---|---|---|
| (A) プロジェクトが変換して公開する | 保守担当者が公式の重みのゲートを通り、llama.cpp の変換の道具で GGUF（Q4_K_M など）にする。Gemma の規約、禁止用途のポリシー、`NOTICE` を添えて、プロジェクトのアカウントに公開する。ゲートは付けない | 利用者はログインもトークンも要らない。前例（Irodori-TTS v4 Large）と同じ形 | プロジェクトが配る側になり、規約の 3.1 節の義務を負う。変換と公開は保守担当者の作業 |
| (B) (A) の変換をゲート付きで公開する | (A) と同じ変換を、Hugging Face のゲート（規約への同意）を付けて公開する | 規約への同意を Hugging Face の仕組みでも記録できる | 利用者は Hugging Face のアカウントとトークンが要る。アプリにトークンを受け取る仕組みが要る（OS の資格情報ストアに置き、`huggingface.co` への要求だけに付ける。ADR-013） |

推奨は (A)。決定の「ゲート付きの重みの規約への同意の扱い」は、(A) ではアプリの取得の画面での同意として実装する（5.2）。(B) を選ぶときは、トークンの受け取り、保存、消去の画面と試験を段階 3 に足す。

### 5.2 取得の画面での同意

- #642 で入れた「制限の確認」に、種類 `gemma_terms` を足す。ライセンスの文字列に Gemma Terms of Use が入る項目は、取得の前に、規約と禁止用途のポリシーへのリンク、その条件が使う人にも及ぶことを示し、同意とは別のチェックを求める。チェックがなければ中核が取得を断る。
- この確認を求めるのは翻訳の項目だけとする。同じ規約の Irodori-TTS v4 Large には付けない（判断項目 4、2026-11-19 に決定）。
- 実行基盤（`llama-server`）の取得にも、MIT のライセンスと取得する大きさを示して同意を求める。

## 6. 段階 3 の実装の順

| 段 | 中身 | おもな場所 |
|---|---|---|
| 3-1 | 規約の確認の種類 `gemma_terms`（5.2） | `native/ops/src/downloads/catalog.rs`、`manager.rs`、`ModelDownloads.tsx`、`locales/` |
| 3-2 | `llama-server` の取得と検証（版、大きさ、SHA-256 の固定、同意、取得元のホスト） | `native/ops` か、声質変換の実行環境と同じ形の新しいモジュール |
| 3-3 | `llama-server` のプロセスの管理（起動、ポート 0、準備の確認、停止、落ちたときの知らせ）。偽のサーバーで試験する | speech.cpp のサーバーの管理（`native/speech-server`）にならう |
| 3-4 | 翻訳のプロバイダ。TranslateGemma のテンプレートの文を組み立てて `/completion` に送る（system を送らない、言語は ISO の符号、会話の文脈を送らない、温度 0）。訳す文と訳文はログに出さない | `native/translation` |
| 3-5 | カタログ。翻訳のカタログの推論エンジン系に実行基盤 `llamacpp` を足し、TranslateGemma 4B を組み込みの項目にする。モデルは (A) で公開したものを、版、大きさ、SHA-256 を固定して載せる | `translation_catalog.rs`、`native/ops/data/translation_models.json` か新しいデータ |
| 3-6 | 計測（ADR-015 の 5）。4B の読み込みの時間、メモリーと VRAM の最大値、1発話の時間を、VRChat、音声認識、読み上げと同時に、Windows と Linux で測る。訳の質を NLLB-200 と M2M100 と同じ文で比べる | 実機 |
| 3-7 | 記録。`NOTICE.md`、ライセンス台帳、モデルの取得の文書、マニュアル | 文書 |

3-6 の結果が ADR-015 の 5 の条件に届かないときは、製品に入れずに ADR-015 を見直す。

### 段階 3 の進み具合（2026-11-19）

推奨の案（llama.cpp、(a) GitHub の Release）で実装し、2026-11-19 の決定（判断項目 2、4、5）に合わせて直した。

| 段 | 状態 | 中身 |
|---|---|---|
| 3-1 | 実装した | `gemma_terms` の確認。翻訳の項目だけに付き、Irodori-TTS v4 Large には付かない（判断項目 4） |
| 3-2 | 実装した | llama.cpp b12125 の `llama-server`（Windows と Linux x64 の Vulkan 版だけ）を、同意のあとで GitHub の Release から取得する。取得元のホストに `github.com` と `release-assets.githubusercontent.com` を足した（判断項目 2 と 5） |
| 3-3 | 実装した | `native/speech-server` の `llama` がプロセスを所有する。偽のサーバーで試験した |
| 3-4 | 実装した | `native/translation` の `translategemma` がテンプレートの文を組み立てて `/completion` に送る |
| 3-5 | 一部 | 翻訳のカタログの推論エンジン系に `llamacpp` を足し、利用者が自分の GGUF のファイルを追加できる。ファイルのパスは項目の `file` に入れる（`translation_catalog.json` は、その項目があるあいだ版 2 になる）。組み込みの TranslateGemma の項目は、(A) の変換を公開するまで載せない（判断項目 3） |
| 3-6 | 一部 | Windows の 1 台で、読み込みの時間、メモリーと VRAM、1発話の時間、訳の質を測った（下の「3-6 の計測」）。VRChat、音声認識、読み上げと同時の計測と Linux はまだ |
| 3-7 | 一部 | `NOTICE.md`、ライセンス台帳、[モデルの取得](model-downloads.md#翻訳のカタログ413)、仕様に書いた。マニュアルはまだである |

### 3-6 の計測（2026-11-19、Windows）

承認を得て、第三者の GGUF の変換と固定の `llama-server` を取得して測った。取得したファイルは計測のあとで消した。訳す文と訳文は記録していない。

- 環境：Windows 11 Home（ビルド 26320）、Intel Core i7-1255U（10 コア 12 スレッド）、RAM 32 GB、NVIDIA GeForce RTX 3060 Ti 8 GB（Thunderbolt 接続、ドライバー 617.42）と Intel Iris Xe。llama.cpp b12125 の Vulkan 版（`llama-b12125-bin-win-vulkan-x64.zip`、SHA-256 `29db8012…`）。`Vulkan0` が Iris Xe、`Vulkan1` が RTX 3060 Ti。
- モデル：[mradermacher/translategemma-4b-it-GGUF](https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/tree/d37868f759d2f817a43d28dd80cf9f982ffa62fd) @ `d37868f759d2f817a43d28dd80cf9f982ffa62fd` の `translategemma-4b-it.Q4_K_M.gguf`（2,489,909,760 bytes、SHA-256 `81200d03e843d2ec1ece6eeafe7d13cb6e5211e1fcd336ade55790b683a08330`、文章だけ）。
- 起動はアプリと同じ引数（`--ctx-size 2048 --parallel 1`、GPU は `--device VulkanN --n-gpu-layers 999`、CPU は `--device none --n-gpu-layers 0`）と、アプリと同じテンプレートの文、温度 0 の `/completion`。比べた NLLB-200 distilled 600M と M2M100 418M は、`native/translate-onnx` の int8 の ONNX の変換を `astarot-translate` の CLI で CPU で動かした（ONNX Runtime 1.32.0 の CPU 版、`tools/translation_onnx/compare.py` と同じ使い方）。
- 計り方：読み込みの時間は起動から `/health` が 200 を返すまで。RAM はプロセスの最大のワーキングセット（`GetProcessMemoryInfo`）。VRAM は `nvidia-smi` の使用量の、起動前からの増分の最大（0.25 秒ごと。Iris Xe は共有メモリーなので測れない）。1発話の時間は、短い会話の文（英語 30、日本語 30。最初の1文は暖機として除いた）の要求から答えまで。
- 条件：GPU を使うほかのプロセスは Steam だけで、計測の前後で VRAM は 4 MiB だった。CPU はほかの作業（別のセッションのビルドや試験、`astarot-translate`）と共有で、計測中の PC 全体の CPU 使用率は 74〜99 % だった。時間の値は静かな PC より遅く出ている可能性がある。

| 項目 | TranslateGemma 4B Q4_K_M・RTX 3060 Ti | 同・Iris Xe | 同・CPU だけ | NLLB-200 600M int8・CPU | M2M100 418M int8・CPU |
|---|---|---|---|---|---|
| 読み込み | 7.9〜9.0 秒 | 36.2 秒 | 3.3〜11.6 秒 | 9.4 秒（最初の答えまで） | 3.7 秒（最初の答えまで） |
| RAM の最大 | 3.2 GB（`--cache-ram 0`） | 3.5 GB | 4.2 GB | 1.4 GB | 1.1 GB |
| VRAM の増分 | 2.7 GB | 測れない | 0 | 0 | 0 |
| 1発話 en→ja（中央値 / 90 %） | 234 / 292〜607 ms | 1,413 / 1,643 ms | 2,131 / 2,388 ms | 746 / 973 ms | 538 / 710 ms |
| 1発話 ja→en（中央値 / 90 %） | 211〜217 / 243〜347 ms | 1,437 / 1,557 ms | 2,132 / 2,334 ms | 735 / 1,106 ms | 456 / 600 ms |
| 生成の速さ | 74〜87 トークン/秒 | 14 トークン/秒 | 15.5 トークン/秒 | — | — |

- RTX の 2 つの値は、既定の設定の回と `--cache-ram 0` の回である。CPU だけの値は、PC がとくに混んでいた最初の回（中央値 4.9 秒と 3.3 秒、90 % は 14.0 秒）を除き、`--cache-ram 0` で測り直した回を載せた。CPU だけの読み込みの 3.3 秒は、ファイルが OS のキャッシュに載っていたときの値である。
- b12125 の `llama-server` は、既定でプロンプトのキャッシュに RAM を最大 8 GiB 使う。RTX で WMT20 の 800 文を訳すと、プロセスのメモリーが 11.4 GB まで増えた。`--cache-ram 0` では 3.2 GB にとどまり、訳文も速さも変わらなかった。翻訳は1文ずつ独立しているので、アプリは `--cache-ram 0` で起動する。

訳の質（WMT20 の各方向の最初の 100 文、sacrebleu 2.6.0。BLEU は日本語と中国語が文字単位、ほかは 13a。値は BLEU / chrF）：

| 方向 | TranslateGemma 4B Q4_K_M | NLLB-200 600M int8 | M2M100 418M int8 |
|---|---|---|---|
| en-ja | 31.21 / 28.36 | 27.17 / 24.34 | 30.80 / 26.53 |
| ja-en | 17.07 / 46.88 | 11.11 / 37.88 | 10.62 / 37.48 |
| en-zh | 33.51 / 30.58 | 22.35 / 21.31 | 28.96 / 24.90 |
| zh-en | 22.67 / 54.41 | 20.25 / 50.43 | 18.05 / 49.77 |
| en-de | 29.37 / 58.41 | 29.27 / 57.77 | 23.22 / 53.52 |
| de-en | 36.91 / 63.65 | 30.95 / 55.90 | 30.82 / 57.64 |
| en-ru | 15.41 / 46.59 | 15.97 / 45.70 | 12.89 / 41.57 |
| ru-en | 30.87 / 62.76 | 35.66 / 63.97 | 30.04 / 60.59 |
| 平均 | 27.13 / 48.95 | 24.09 / 44.66 | 23.18 / 44.00 |

- TranslateGemma は 8 方向のうち 6 方向で BLEU と chrF がいちばん高く、ja-en では BLEU が 6 ポイント近く上だった。en-ru と ru-en は NLLB-200 のほうが高かった。
- NLLB-200 は 800 文のうち 4 文で訳を返さず、空の訳として数えた。TranslateGemma（生成の上限 512 トークン）と M2M100 に失敗はなかった。
- 訳の質は RTX 3060 Ti でだけ測った。CPU と Iris Xe では測っていない。

ADR-015 の 5 の条件のうち、VRChat、音声認識、読み上げと同時に動かしたときの値と Linux の値はまだない。RTX 3060 Ti では 1 発話が 0.2〜0.6 秒で、VRAM の増分は 2.7 GB だった。CPU だけでは 1 発話が約 2 秒かかる。

## 7. ライセンス

- llama.cpp と ggml は MIT。Release の配布物が含むほかの部品（HTTP サーバーや JSON のライブラリなど）のライセンスは、取得する版の中身で確かめ、`NOTICE.md` とライセンス台帳に書く（段階 3-2）。
- TranslateGemma の重みは Gemma Terms of Use と禁止用途のポリシーに従う。(A) で公開する変換には規約の写し、禁止用途のポリシー、決まった一文の `NOTICE`、変換したことを書いたモデルカードを添える。
- ONNX Runtime GenAI を選ぶ場合も MIT だが、ONNX Runtime の版を上げることの影響（OCR、翻訳、声質変換）を別に確かめる必要がある。

## 8. 判断項目

1. 実行基盤：llama.cpp（推奨）か ONNX Runtime GenAI か。→ llama.cpp に決定（2026-11-19）。
2. `llama-server` の取得元：(a) GitHub の Release（許可するホストを足す）か、(b) プロジェクトの Hugging Face のリポジトリに写すか。→ (a) GitHub の Release に決定（2026-11-19）。
3. 重みの形：(A) 規約を添えてゲートなしで公開する（推奨）か、(B) ゲート付きで公開してアプリでトークンを扱うか。（未決）
4. 規約の確認（`gemma_terms`）を Irodori-TTS v4 Large にも付けるか。→ 翻訳の項目だけに付け、Irodori-TTS v4 Large には付けないと決定（2026-11-19）。
5. 最初に扱う GPU：Vulkan 版と CPU 版だけにするか（推奨）、CUDA 版も入れるか。→ Vulkan 版だけを出すと決定（2026-11-19）。CPU だけで動かすときも Vulkan 版を使う。
6. 量子化：Q4_K_M（2.49 GB）を基本にするか、Q8_0（4.13 GB）も出すか。計測（3-6）で決める。（未決。Q8_0 はまだ測っていない）
7. 計測のための取得：段階 3-6 の前に、第三者の GGUF の変換と `llama-server` を取得して試すことを認めるか（数 GB）。→ 認められ、6 の「3-6 の計測」のとおり測った（2026-11-19）。

実装で決めたこと（2026-11-19 の決定）：`llamacpp` の項目は GGUF のファイルのパスを `folder` ではなく `file` に入れる。その項目があるあいだ `translation_catalog.json` は版 2 になり、版 1 しか読めない以前の版はファイル全体を読めないものとして扱う（上書きはしない）。`llamacpp` の項目をすべて削除すると版 1 に戻る。
