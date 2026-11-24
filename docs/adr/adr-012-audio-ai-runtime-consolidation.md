---
date: 2026-11-17
status: accepted
era: rust-core
validity: current
implementation_status: not_applicable
implementation_note: 開発の原則と採用の規則を決めるもので、既存のコードは変えない（原文の Status）。原則は AGENTS.md の「音声 AI のランタイム」に写してある。
evidence:
  - docs/adr/adr-012-audio-ai-runtime-consolidation.md
  - AGENTS.md
---
# ADR-012: Audio AI Runtime Consolidation

[日本語版](#adr-012-音声-ai-のランタイムの集約日本語版)

Status: Accepted (2026-11-17). Sets the development principles, the division of responsibilities by function and the rules for adopting new models and runtimes. Existing code does not change.
Date: 2026-11-17
Decision owners: The repository maintainers
Related: Issue #507, [ADR 001 to 003](README.md), [ADR-004](adr-004-audio-integration-boundaries.md), [ADR-005](adr-005-managed-microphone-lifetime.md), [ADR-007](adr-007-translated-speech-through-voice-conversion.md), [ADR-008](adr-008-external-speech-engines.md), [ADR-011](adr-011-astarot-brand-and-multimodal-accessibility.md), [Core integration](../voice-stack/core-integration.md), [Inference runtime comparison](../voice-stack/inference-runtime-comparison.md), `AGENTS.md`, `NOTICE.md`

In this ADR, "the app" means the app in this repository. Its display name is ASTAROT, decided in ADR-011, and identifiers such as the executable name and the app ID remain VRCT-VOX.

> **Migration note** (2026-11-18, Issue #587): This ADR was written while it was in `docs/voice-stack/`. The files that the body names by file name only, `core-integration.md`, `model-downloads.md` and `release-candidates.md`, are still in `docs/voice-stack/` ([Core integration](../voice-stack/core-integration.md), [Model downloads](../voice-stack/model-downloads.md), [Release candidates](../voice-stack/release-candidates.md)). The body has not been rewritten.

## 1. Context

### 1.1 The cost of adding runtimes

The app combines speech recognition, text to speech, voice conversion, captions, OCR, translation and the VRChat integration. If each new model or feature brings its own inference runtime, the following burdens grow.

- **Distribution**: The release grows in size, in runtime and GPU libraries and in model download steps. What to bundle and what to download after consent has to be decided for each runtime.
- **Resources**: The app runs on the same PC as VRChat, so the CPU, GPU, VRAM and startup time of each runtime add up.
- **Maintenance**: Each runtime brings its own version tracking, troubleshooting, per-OS builds, combinations of GPU execution providers and tests with fakes.
- **Licensing**: The licenses of each runtime and model have to be tracked separately in `NOTICE.md` and the license register.
- **Verification**: Each runtime needs checks on real hardware on both Windows and Linux.

### 1.2 Current implementation (develop as of 2026-11-17)

| Function | Current implementation |
|---|---|
| Speech recognition (including realtime), text to speech | The bundled speech.cpp server |
| Speaker diarization | Nemotron 3 Diarization loaded into the same speech.cpp server ([Speaker diarization selection](../voice-stack/speaker-diarization-2026-11-13.md)) |
| VAD for recordings | There is a hook for it (`vrct_transcription::vad`), but the engine is undecided. For now, recordings are split by volume (item 13 of `core-integration.md`) |
| Speech enhancement, AI noise removal | Not implemented |
| Voice conversion (RVC) | An in-house Rust implementation, `native/rvc-runtime`. It runs in a separate process, `vrct-rvc-worker`, and infers with ONNX Runtime (`ort`). The ONNX Runtime and CUDA libraries and the HuBERT and RMVPE weights are downloaded after consent (`NOTICE.md`) |
| OCR | `native/ocr-runtime` (ONNX Runtime, `ort` with `load-dynamic`) |
| Local translation | `native/translate-onnx` (ONNX Runtime, `ort` with `load-dynamic`) |
| External translation services | A connection per provider in `native/translation` |
| External speech synthesis engines | Connects over loopback to engines the user installed, such as VOICEVOX (ADR-008) |
| Audio input and output, routes, virtual microphone | Rust (`native/audio-routing`, `native/asr-capture` and others) and OS APIs (WASAPI, PipeWire) |

For 0.5.0, the Python runtime, CTranslate2 and Seed-VC are being taken out of the release (`core-integration.md`). This ADR sets principles and a division of responsibilities so that the same direction holds when new models are added.

### 1.3 Relation to earlier ADRs

- ADR 001 decided not to add inference libraries to the app and to leave inference to speech.cpp. This ADR extends that approach to all audio AI.
- ADR 003 stated that "speech.cpp has no VC feature for raw audio". This is why RVC remains as an exception (section 6).
- The audio route and safety rules of ADR 002, ADR-005 and ADR-007 (cancellation, mute, silence on failure, no fallback to the original voice) do not change. Section 2.5 requires the same of new models.
- With the connection to external engines in ADR-008, the app holds no inference runtime, so this ADR does not decide whether that connection counts as an "independent AI runtime" (section 9).
- This ADR does not answer items 13 (the VAD engine) and 53 (the runtime for OCR, translation and VAD) of `core-integration.md`. Both are to be decided against the division in section 2 (section 9).

## 2. Decision

### 2.1 Principles

The following principle is adopted. The Japanese version quotes it word for word; the English below is a translation.

> As a rule, introducing a new audio AI model gives priority to an upstream contribution to speech.cpp. An inference engine specific to VRCT-VOX or an independent AI runtime is adopted only when both a technical reason why the existing foundation cannot achieve it and a clear advantage in performance, maintenance and distribution cost have been confirmed.

The principle is made concrete in these 6 points.

1. **Audio AI inference is, as a rule, consolidated in speech.cpp.** When bringing in a new model, consider proposing, porting and contributing it upstream before adding a runtime specific to the app.
2. **OCR and local translation use ONNX Runtime as their common inference foundation, as a rule.** They are not moved to speech.cpp or GGML only to match audio AI.
3. **Rust and the OS handle audio input and output, DSP and device control.** No new AI inference runtime is brought in for general-purpose signal processing.
4. **App-specific control stays in the app.** The UI, the translation flow, VRChat OSC, settings, authorization and the audio output policy are not the inference engine's responsibility.
5. **Existing exceptions are not forced out.** A feature that cannot be integrated into speech.cpp today, such as RVC, may continue as a managed exception with its reasons and boundaries written down.
6. **Consolidation is a means, not a goal.** The project does not make ports that worsen accuracy, latency, safety or maintainability, or open PRs that do not fit the upstream design approach.

What is consolidated in speech.cpp is "inference of audio AI models". It does not mean moving all audio processing, all machine learning or every ONNX dependency to speech.cpp.

### 2.2 Division of responsibilities by function (normative)

| Function and responsibility | Owner as a rule | The app's responsibilities and boundary |
|---|---|---|
| Speech recognition (ASR, STT) | speech.cpp | Audio input, recognition requests, choice of language and model, where partial and final results go |
| Text to speech (TTS) | speech.cpp | Speech requests, the choice between source text and translation, cancellation, output destination and playback control |
| Voice activity detection (VAD) | speech.cpp | The policy for finalizing an utterance from detection results, timeout and threshold settings |
| Speaker diarization and other speaker-related AI | speech.cpp preferred | Managing speakers within a session, display and privacy control |
| Speech enhancement and AI noise removal | speech.cpp preferred | Which input and output routes it applies to, quality and latency settings, on and off |
| Voice conversion (RVC and others) | The existing RVC runtime continues as a provisional exception (section 6) | Checking the conversion state, separating audio routes, stop, mute, silence on failure. Integration upstream is evaluated separately |
| Non-AI DSP (resampling, volume, mixing, gating and so on) | Rust and proven DSP libraries | Control of the realtime audio flow and of resources |
| Recording, playback, virtual microphone, device monitoring | Rust and OS APIs (PipeWire, WASAPI and others) | Input and output per OS, device identification and lifetime, stopping safely on failure |
| OCR (text detection and recognition) | ONNX Runtime | Screen capture, choosing the target region, formatting results and removing duplicates |
| Local translation | ONNX Runtime | Language choice, context, terminology, history, accepting and delivering translations |
| External translation and LLM services | The existing provider connections | Consent, credentials, control over the data sent, handling of failures |
| Captions, VR overlays, OBS, WebSocket, OSC | The app (Rust, UI, integration with VR and the OS) | Display, access control, delivery, history, user settings |
| Model download, verification and version management | The app | Explicit consent, showing licenses, pinning and checking versions and hashes, compatibility and rollback |

### 2.3 Steps for adding a new audio AI model

When bringing in a new model for ASR, TTS, VAD, speakers, speech enhancement or VC, evaluate in this order.

1. Check whether speech.cpp already has the same model or feature, and evaluate whether an existing model meets the requirement.
2. If not, look at speech.cpp's design, API, license and model format, and check whether the model can be converted to GGML or GGUF.
3. If it is feasible and fits upstream's scope, discuss it in advance in an issue or similar, and make an upstream contribution the first choice.
4. Until it lands upstream, measure performance and accuracy in a test branch or PoC of the app if needed. Do not keep test code around as a product dependency.
5. Pin the upstream version, and adopt it in the product only after checking API compatibility, the model's distribution terms and results on real Windows and Linux hardware.

If upstream does not accept the proposal, porting is not practical or it would not be ready in time, go to the exception procedure in section 2.4. This does not mean the upstream contribution must always be finished first. Recording the findings of steps 1 to 3 is enough.

### 2.4 Adopting a new runtime as an exception

Adding another inference runtime for audio AI requires approval as an exception in an ADR of its own. The exception ADR states at least the following.

- The specific feature, quality and performance requirements that speech.cpp cannot meet, and the results of verifying them
- Why proposing or porting upstream is unsuitable, impractical or too late
- A comparison with the other options (existing models, porting to speech.cpp, a DSP substitute)
- The added runtime's distribution size, dependencies, CPU, GPU, VRAM, license, security and operational burden
- The extent of Windows and Linux support, behavior without a GPU and safety on failure
- Who is responsible, the policy for updates and vulnerabilities, and the conditions for reconsidering upstream integration or removal

Approval needs both conditions in the original wording of the principle: a technical reason why the existing foundation cannot achieve it, and a clear advantage in performance, maintenance and distribution cost. Measured values come with the environment and conditions they were measured under. An exception is not a permanent entitlement; it is reviewed under the conditions in section 8.

### 2.5 Components other than inference

- Lightweight DSP and standard OS APIs may be adopted without moving them to speech.cpp. Overlap with existing features and realtime safety are still evaluated.
- Adding ONNX models for OCR and translation is outside the audio AI exception procedure. Such models must still run on the existing ONNX Runtime and follow the rules on model format and distribution.
- External cloud APIs are handled separately from local inference runtimes. Consent to sending data out, privacy and contract terms are checked separately.

### 2.6 Non-functional requirements at the boundaries

New models, runtimes and components meet the following.

**Realtime behavior and audio routes**

- Do not put inference directly on the time-critical paths of audio callbacks, the UI thread or device control.
- Measure latency, buffering, CPU, GPU and VRAM with ASR, translation, TTS and VC running at the same time.
- Do not assume that consolidating runtimes automatically improves VRAM sharing or GPU allocation.
- Explicit cancellation, mute and mode changes take effect regardless of inference delays or failures.
- A processing failure or a stopped external process must not cause an unintended switch to the original voice, old audio being sent again or other modes stopping along with it.
- Numeric conditions for latency and stopping follow the existing accepted ADRs and acceptance tests. Do not invent new thresholds without evidence.

**Dependencies, distribution and security**

- Treat the inference runtime, model weights, tokenizers and other distributed files separately, and check each one's license and whether it may be redistributed.
- Model downloads keep explicit user consent, pinned versions and checks of size and SHA-256 (`model-downloads.md`, the catalog).
- For each added component, provide entries in `NOTICE.md` and the license register, vulnerability monitoring, signatures or hashes, and update and removal procedures.
- When using an external server or IPC, document what is exposed, authentication, input validation, process lifetime and the handling of secrets.
- Adding a feature must not add unauthorized network traffic or unexpected storage of audio and conversation text.

**Boundaries and compatibility**

- Do not make app-specific UI or the VRChat integration depend on upstream speech.cpp.
- Handle differences between models in capability declarations and the connection layer. Do not assume a common API that does not exist.
- Check compatibility with settings, IPC, events and stored models, and the differences in features between OSes.
- When a change conflicts with an existing accepted ADR, write down the reason and the scope of the impact, and explicitly revise or supersede that ADR. Do not silently override an existing decision.

### 2.7 Responsibility for licenses and verification

- **Licenses**: The change that adds a model, engine, runtime or other distributed file (the PR, or the exception ADR for an exception) is responsible for checking its license and whether it may be redistributed. The results go in `NOTICE.md`, `docs/voice-stack/licensing.md` and the model catalog.
- **Windows and Linux verification**: A change adopted into the product states its results on both OSes in the PR. If it cannot be checked on one OS, write "not verified", and check it during release candidate verification (`release-candidates.md`) before it goes into a stable release.

## 3. Alternatives considered

| Option | Description | Why it was not chosen |
|---|---|---|
| Mixed runtimes | Pick the best runtime for each feature case by case | The costs in section 1.1 grow with every feature. The reasons for each choice and the conditions for revisiting it are not recorded either |
| Everything on GGML | Move OCR and translation to speech.cpp or GGML as well | OCR and translation are outside speech.cpp's scope and do not fit the upstream design. It would throw away the current implementation and verification on ONNX Runtime |
| No principle, keep things as they are | Keep the existing setup and decide on each new model case by case | The current setup stays, but there is no criterion that stops new models from adding runtimes |
| Rust runtimes other than ONNX Runtime (tract, rten, candle, burn) | Run OCR, translation and VAD on a different runtime | In the [inference runtime comparison](../voice-stack/inference-runtime-comparison.md), ONNX Runtime was the only one that ran every model. The option of moving VAD alone to another runtime remains undecided in item 53 of `core-integration.md` |

## 4. Consequences

**Gains**

- Adding new audio AI models is less likely to add runtimes, distributed files, licenses or verification scope.
- Upstream contributions reach all speech.cpp users, and the app has less code of its own to maintain.
- Whether to adopt a model or runtime can be decided with the same procedure and record format.

**Costs and risks**

- Waiting for upstream to accept a change can affect when a feature arrives.
- Changes in upstream's policy and versions affect the app. Pinning versions and reviewing under the conditions in section 8 limit this.
- Two runtimes, speech.cpp and ONNX Runtime, remain, so there will not be a single runtime. GPU allocation and VRAM are not unified automatically either.
- Writing exception ADRs adds work.

**How to migrate**

- Existing features are not rewritten all at once. This ADR does not change code.
- Where the existing implementation differs from the division in section 2.2 (RVC), it is treated as an exception under section 6.
- Open decisions (section 9) are made where they come up, measured against this ADR.

## 5. Non-goals

- Moving all machine learning processing to GGML or GGUF
- Giving speech.cpp OCR, machine translation or VRChat-specific UI
- Dropping or porting RVC right away
- Deciding to adopt specific new models (TEN VAD, Kokoro and others) through this ADR alone
- Rewriting existing features wholesale on the grounds of improving the architecture

## 6. Exceptions

### 6.1 Existing exception: the RVC runtime

RVC voice conversion continues as a managed exception. As long as speech.cpp has no practical VC foundation, migration is not required.

| Item | Details |
|---|---|
| Why speech.cpp cannot meet the need | speech.cpp has no VC feature that converts raw audio (ADR 003) |
| Implementation | `native/rvc-runtime` (in-house, MIT). It infers with ONNX Runtime through `ort` in a separate process, `vrct-rvc-worker`. Its owner is `native/voice-conversion` |
| Distribution | ONNX Runtime, the CUDA and cuDNN libraries and the HuBERT and RMVPE weights are not bundled. They are downloaded after consent (`NOTICE.md`) |
| Safety | On failure it stops and does not fall back to the original voice. Mute and suppression of the direct voice are handled separately (ADR-007, `native/voice-conversion`) |
| OS | On Linux, the managed route does not record through PipeWire yet, so what the core provides is limited (`native/voice-conversion/README.md`) |
| When to revisit | When speech.cpp gains a practical VC foundation. Otherwise, as in section 8 |

Of the items section 2.4 asks for, behavior without a GPU, the amount of CPU, GPU and VRAM, and the policy for updates and vulnerabilities have not been newly examined in this ADR (section 9).

OCR and local translation on ONNX Runtime follow the division in section 2.2, so they are not exceptions. The Seed-VC integration (`integrations/seed_vc/`) remains in the repository, but it is not in the release from 0.5.0 on, and this ADR does not treat it as a product runtime.

### 6.2 Approving new exceptions

A new exception is approved in its own ADR, following section 2.4. Before approval, record the findings of steps 1 to 3 in section 2.3.

> **Exception addendum** (2026-11-19, Issue #412): Running decoder-only translation LLMs such as TranslateGemma on an LLM runtime (ONNX Runtime GenAI, llama.cpp or similar) became a new exception ([ADR-015](adr-015-translation-llm-runtime-exception.md)). It is an exception to section 2.2 assigning local translation to ONNX Runtime, and its scope is limited to decoder-only translation LLMs. M2M100 and NLLB-200 stay on ONNX Runtime. The reason is that the current `native/translate-onnx` runs only the encoder-decoder form, and writing LLM generation in-house would rebuild features that LLM runtimes already have. speech.cpp does not handle machine translation (section 5), so the upstream contribution route in section 2.3 is not open either. Which runtime to use, the distribution size and the licenses are to be given in stage 2 of ADR-015. The body has not been rewritten.

> **Exception addendum** (2026-11-23, Issue #1061): Japanese text to speech inside the app through VOICEVOX CORE became a new managed exception ([ADR-019](adr-019-voicevox-core-tts-runtime-exception.md)). It is an exception to section 2.2 assigning text to speech to speech.cpp, and the default speech.cpp TTS and the external connection (ADR-008) stay. The product VVM files depend on a proprietary format (`vv-bin`) and on processing specific to `voicevox_onnxruntime`, and the terms forbid reverse engineering, so they cannot be converted to speech.cpp or contributed upstream, and they cannot share the existing ONNX Runtime (`1.31.0`). A thin Rust child process (`astarot-voicevox-worker`) dynamically loads the official `voicevox_core` C API (`0.17.1`, MIT) and the stable release of `voicevox_onnxruntime` `1.17.3` (CPU build), both downloaded after consent. To begin with, it uses only a representative pack under the standard terms. Whether to start the full implementation will be decided after seeing the results of a PoC on real Windows and Linux hardware. The body has not been rewritten.

## 7. Verification and acceptance criteria

A change that adopts a new model, runtime or exception checks the following.

| Aspect | What to check | How |
|---|---|---|
| Behavior | Requests, partial and final results, cancellation and failure notices work as the contract says | Tests with a fake server or a fake worker (`voice.rs`, `realtime_asr.rs` and others in `native/core/tests/`). They check the contract without the real thing |
| Quality | Accuracy and translation quality are no worse than before the replacement or than other options | An evaluation set and metrics for each model. Values come with their environment and conditions |
| Performance | The realtime behavior in section 2.6: latency, buffering, CPU, GPU and VRAM with ASR, translation, TTS and VC running at the same time | Measure on real Windows and Linux hardware. Numeric conditions follow the existing ADRs and acceptance tests |
| Safety | Cancellation, mute, silence on failure, no unintended switch to the original voice, no effect on other modes | Fault-injection tests (crashing the fake worker, stopping the server and so on) |
| Licenses and distribution | License and redistribution terms for each runtime, set of weights and tokenizer; pinned versions and SHA-256 | Checking `NOTICE.md` and the license register, the catalog matching its Rust copy (`tests/voice/test_native_ops_reference.py`), `tools/check_voice_distribution.py`, `tools/rust_licenses.py` |
| OS | The extent of Windows and Linux support | State it in the PR as in section 2.7. Anything that cannot be checked is marked "not verified" |

## 8. Revisit triggers

Revisit this ADR or an exception ADR when:

- speech.cpp gains a feature handled by an exception (such as VC) or a feature the project wants to add
- upstream changes its policy, or decides not to accept a proposal
- a model or runtime in use is upgraded to a new version
- performance or quality gets worse on real hardware
- the license, the redistribution terms or the download source changes (for example, the DirectML build of ONNX Runtime no longer being updated; see the [inference runtime comparison](../voice-stack/inference-runtime-comparison.md))
- a serious vulnerability is found in a runtime
- the range of supported OSes or GPUs changes

## 9. Open questions

- Whether connecting over loopback to an external engine the user installed (such as VOICEVOX in ADR-008) counts as an "independent AI runtime". The app neither bundles nor starts it, so it can be read as not counting, but this is not written down.
- Which metrics (latency, release size, VRAM and so on), and how large a difference, establish the "clear advantage" in section 2.4.
- The VAD engine for recordings (item 13 of `core-integration.md`) was decided as (c) on 2026-11-19. As section 2.2 says, the Silero VAD GGUF that speech.cpp downloads is used on the same server as realtime captions (3-4 of #278). speech.cpp 0.11.0 has no way to return segments with the detection model alone, so a recognition model has to be loaded for VAD. Whether to propose such a way upstream is decided in item 83 of the same document.
- How to choose the runtime for OCR and translation (item 53 of `core-integration.md`). Section 2.2 assigned OCR and translation to ONNX Runtime but did not decide how to distribute the ONNX Runtime library (item 2 of the same document). VAD went to speech.cpp with the decision above, so it is no longer part of this item.
- The items missing from the RVC exception record (section 6.1): behavior without a GPU, the amount of CPU, GPU and VRAM, the policy for updates and vulnerabilities, and who is responsible.
- Speech enhancement and AI noise removal have no implementation, and whether speech.cpp can handle them has not been examined.

---

# ADR-012: 音声 AI のランタイムの集約（日本語版）

Status: 採用（2026-11-17）。開発の原則、機能ごとの責務の分担、新しいモデルとランタイムの採用規則を定める。既存のコードは変えない。
Date: 2026-11-17
Decision owners: リポジトリの保守担当者
Related: Issue #507、[ADR 001〜003](README.md)、[ADR-004](adr-004-audio-integration-boundaries.md)、[ADR-005](adr-005-managed-microphone-lifetime.md)、[ADR-007](adr-007-translated-speech-through-voice-conversion.md)、[ADR-008](adr-008-external-speech-engines.md)、[ADR-011](adr-011-astarot-brand-and-multimodal-accessibility.md)、[中核の統合](../voice-stack/core-integration.md)、[推論ランタイムの比較](../voice-stack/inference-runtime-comparison.md)、`AGENTS.md`、`NOTICE.md`

この ADR の「アプリ」は本リポジトリのアプリを指す。表示名は ADR-011 で決めた ASTAROT で、実行ファイル名やアプリ ID などの識別子は VRCT-VOX のままである。

> **移行の注記**（2026-11-18、Issue #587）：この ADR は `docs/voice-stack/` にあったときに書いた。本文でファイル名だけを書いた `core-integration.md`、`model-downloads.md`、`release-candidates.md` は、いまも `docs/voice-stack/` にある（[中核の統合](../voice-stack/core-integration.md)、[モデルの取得](../voice-stack/model-downloads.md)、[配布候補](../voice-stack/release-candidates.md)）。本文は書き換えていない。

## 1. Context（背景）

### 1.1 ランタイムが増えることのコスト

アプリは音声認識、読み上げ、声質変換、字幕、OCR、翻訳、VRChat との連携をまとめている。モデルや機能を足すたびに独立した推論ランタイムを足すと、次の負担が増える。

- **配布**: 配布物のサイズ、ランタイムと GPU 向けのライブラリ、モデルの取得の手順が増える。何を同梱し、何を同意を得て取得するかを、ランタイムごとに決めることになる。
- **資源**: VRChat と同じ PC で動かすので、ランタイムごとの CPU、GPU、VRAM、起動の時間が積み重なる。
- **保守**: 版の追従、障害の調べ方、OS ごとのビルド、GPU の実行プロバイダの組み合わせ、偽物を使った試験を、ランタイムごとに持つことになる。
- **ライセンス**: ランタイムとモデルの許諾を、`NOTICE.md` とライセンス台帳で別々に追うことになる。
- **検証**: Windows と Linux の両方で、ランタイムごとに実機の確認が要る。

### 1.2 現在の実装（2026-11-17 の develop）

| 機能 | 現在の実装 |
|---|---|
| 音声認識（リアルタイムを含む）、読み上げ | 同梱の speech.cpp のサーバ |
| 話者分離 | 同じ speech.cpp のサーバに Nemotron 3 Diarization を読み込む（[話者分離の選定](../voice-stack/speaker-diarization-2026-11-13.md)） |
| 録音の VAD | 差し込む口（`vrct_transcription::vad`）はあるが、エンジンは未決。今は音量で区切る（`core-integration.md` の 13） |
| 音声強調、AI のノイズ除去 | 実装なし |
| 声質変換（RVC） | 自前の Rust 実装 `native/rvc-runtime`。別プロセスの `vrct-rvc-worker` で動き、ONNX Runtime（`ort`）で推論する。ONNX Runtime と CUDA のライブラリと HuBERT、RMVPE の重みは、同意を得てから取得する（`NOTICE.md`） |
| OCR | `native/ocr-runtime`（ONNX Runtime、`ort` の `load-dynamic`） |
| ローカル翻訳 | `native/translate-onnx`（ONNX Runtime、`ort` の `load-dynamic`） |
| 外部の翻訳サービス | `native/translation` のプロバイダごとの接続 |
| 外部の合成音声エンジン | 利用者が入れた VOICEVOX などにループバックで接続する（ADR-008） |
| 音声の入出力、経路、仮想マイク | Rust（`native/audio-routing`、`native/asr-capture` など）と OS の API（WASAPI、PipeWire） |

0.5.0 に向けて、Python の実行環境、CTranslate2、Seed-VC を配布物から外している（`core-integration.md`）。新しいモデルを足すときもこの方向を保つために、原則と分担を決める。

### 1.3 既存の ADR との関係

- ADR 001 はアプリに推論ライブラリを足さず、speech.cpp に任せると決めた。この ADR はその考え方を音声 AI 全体に広げる。
- ADR 003 は「speech.cpp には生の音声の VC 機能がない」とした。これが RVC を例外として残す理由である（6）。
- ADR 002、ADR-005、ADR-007 の音声経路と安全の決まり（取り消し、ミュート、失敗したら無音にする、元の声に戻さない）は変えない。2.5 で、新しいモデルにも同じことを求める。
- ADR-008 の外部エンジンへの接続は、アプリが推論ランタイムを持たないので、この ADR の「独立した AI ランタイム」に当たるかを決めていない（9）。
- `core-integration.md` の 13（VAD のエンジン）と 53（OCR、翻訳、VAD のランタイム）は、この ADR で答えを決めない。どちらも 2 の分担に照らして決める（9）。

## 2. Decision（決定）

### 2.1 原則

次の原則を採用する（原文のまま）。

> 新しい音声AIモデルの導入は、原則としてspeech.cppへのアップストリーム貢献を優先する。VRCT-VOX固有の推論エンジンや独立したAIランタイムは、既存基盤で実現できない技術的理由と、性能・保守・配布コスト上の明確な優位性が確認された場合に限って採用する。

この原則を、次の6点で具体化する。

1. **音声 AI の推論は、原則として speech.cpp に集める。** 新しいモデルを入れるときは、アプリ固有のランタイムを足す前に、上流への提案、移植、貢献を先に検討する。
2. **OCR とローカル翻訳は、原則として ONNX Runtime を共通の推論の基盤にする。** 音声 AI と揃えるためだけに、speech.cpp や GGML へ移すことはしない。
3. **音声の入出力、DSP、デバイスの制御は Rust と OS の機能が受け持つ。** 汎用の信号処理のために、新しい AI の推論ランタイムを持ち込まない。
4. **アプリ固有の制御はアプリが持つ。** UI、翻訳の流れ、VRChat の OSC、設定、認可、音声の出力の方針を、推論エンジンの責務にしない。
5. **既存の例外を無理に外さない。** RVC のように今は speech.cpp に統合できない機能は、必要な理由と境界を書いた管理対象の例外として続けてよい。
6. **揃えることは目的ではなく手段である。** 精度、遅延、安全性、保守性が悪くなる移植や、上流の設計の考え方に合わない PR は行わない。

speech.cpp に集めるのは「音声 AI のモデルの推論」である。すべての音声処理、すべての機械学習、すべての ONNX への依存を speech.cpp に移すという意味ではない。

### 2.2 機能ごとの責務の分担（規範）

| 機能と責務 | 原則の担当 | アプリの責務と境界 |
|---|---|---|
| 音声認識（ASR、STT） | speech.cpp | 音声の入力、認識の要求、言語とモデルの選択、途中と確定の結果の送り先 |
| 読み上げ（TTS） | speech.cpp | 発声の要求、原文と訳文の選択、取り消し、出力先と再生の制御 |
| 発話区間の検出（VAD） | speech.cpp | 検出の結果を使って発話を確定する方針、タイムアウトやしきい値の設定 |
| 話者分離と話者に関わる AI | speech.cpp を優先 | セッションの中の話者の管理、表示とプライバシーの制御 |
| 音声強調と AI のノイズ除去 | speech.cpp を優先 | 適用する入出力の経路、音質と遅延の設定、オンとオフ |
| 声質変換（RVC など） | 既存の RVC ランタイムを暫定の例外として続ける（6） | 変換の状態の確認、音声経路の分離、停止、ミュート、障害のときの無音。上流への統合は別に評価する |
| AI でない DSP（リサンプリング、音量、ミキシング、ゲートなど） | Rust と実績のある DSP ライブラリ | リアルタイムの音声の流れと資源の制御 |
| 録音、再生、仮想マイク、デバイスの監視 | Rust と OS の API（PipeWire、WASAPI など） | OS ごとの入出力、デバイスの識別と寿命、故障したときに安全に止めること |
| OCR（文字の検出と認識） | ONNX Runtime | 画面の取得、対象の範囲の選択、結果の整形と重複の除去 |
| ローカル翻訳 | ONNX Runtime | 言語の選択、文脈、用語、履歴、訳文の採用と配送 |
| 外部の翻訳サービスと LLM のサービス | 既存のプロバイダの接続 | 同意、認証情報、送るデータの制御、失敗したときの扱い |
| 字幕、VR のオーバーレイ、OBS、WebSocket、OSC | アプリ（Rust、UI、VR と OS との連携） | 表示、アクセスの制御、配送、履歴、利用者の設定 |
| モデルの取得、検査、版の管理 | アプリ | 明示の同意、ライセンスの表示、版とハッシュの固定と検査、互換性と戻し方 |

### 2.3 新しい音声 AI モデルを足す手順

ASR、TTS、VAD、話者に関わるモデル、音声強調、VC の新しいモデルを入れるときは、次の順に評価する。

1. speech.cpp に同じモデルや機能がもうあるかを調べ、既存のモデルで要求を満たせるかを評価する。
2. なければ、speech.cpp の設計、API、ライセンス、モデルの形式を調べ、GGML や GGUF に変換できるかを確かめる。
3. 実現でき、上流が扱う範囲に合うなら、Issue などで事前に相談し、上流に貢献することを第一の選択にする。
4. 上流に入るまでの間は、必要ならアプリの検証用のブランチや PoC で性能と精度を測る。検証用のコードを製品の依存として残し続けない。
5. 上流の版を固定し、API の互換性、モデルの配布の条件、Windows と Linux の実機の結果を確かめてから、製品に採用する。

上流が提案を受け入れない、移植が現実的でない、時期に間に合わないときは、2.4 の例外の手続きに進む。上流への貢献を必ず先に終えなければならないという意味ではない。手順の1から3を調べた結果を記録すればよい。

### 2.4 新しいランタイムを例外として採用する

音声 AI のために別の推論ランタイムを足すには、そのための ADR で例外として承認する。例外の ADR には、少なくとも次を書く。

- speech.cpp では満たせない具体的な機能、品質、性能の要件と、その検証の結果
- 上流への提案や移植が適切でない、現実的でない、時期に間に合わない理由
- ほかの案（既存のモデル、speech.cpp への移植、DSP での代わり）との比較
- 追加するランタイムの配布サイズ、依存、CPU、GPU、VRAM、ライセンス、セキュリティ、運用の負担
- Windows と Linux の対応の範囲、GPU のない環境での振る舞い、失敗したときの安全性
- 担当、更新と脆弱性への対応の方針、上流への統合や撤去を見直す条件

承認には、原則の原文にある2つの条件が両方とも要る。既存の基盤で実現できない技術的な理由と、性能、保守、配布のコストでの明確な優位性である。計測した値には、計測した環境と条件を添える。例外は恒久的な既得権ではなく、8 の条件で見直す。

### 2.5 推論以外の部品

- 軽い DSP や OS の標準の API は、speech.cpp に移さずに採用してよい。既存の機能との重複と、リアルタイムでの安全性は評価する。
- OCR と翻訳の ONNX のモデルを足すことは、音声 AI の例外の手続きの対象外である。既存の ONNX Runtime の上で動くこと、モデルの形式と配布の決まりに合うことは求める。
- 外部のクラウドの API は、ローカルの推論ランタイムとは別に扱う。外部へ送ることの同意、プライバシー、契約の条件を別に確かめる。

### 2.6 境界の非機能要件

新しいモデル、ランタイム、部品は、次を守る。

**リアルタイム性と音声経路**

- 推論を、音声のコールバック、UI のスレッド、デバイスの制御の急ぐ経路に直接置かない。
- ASR、翻訳、TTS、VC を同時に動かしたときの待ち時間、バッファ、CPU、GPU、VRAM を測る。
- ランタイムを揃えても、VRAM の共有や GPU の割り当てが自動でよくなるとはみなさない。
- 明示の取り消し、ミュート、モードの変更は、推論の遅れや失敗に左右されずに効く。
- 処理の失敗や外部のプロセスの停止で、意図しない元の声への切り替え、古い音声の再送、ほかのモードの巻き添えの停止を起こさない。
- 遅延や停止の数値の条件は、既存の採用済みの ADR と受け入れ試験に従う。根拠のない新しいしきい値を作らない。

**依存、配布、セキュリティ**

- 推論ランタイム、モデルの重み、トークナイザ、そのほかの配布物を分け、それぞれのライセンスと再配布の可否を確かめる。
- モデルの取得は、利用者の明示の同意、固定した版、サイズと SHA-256 の検査を保つ（`model-downloads.md`、カタログ）。
- 足した部品について、`NOTICE.md` とライセンス台帳、脆弱性の監視、署名やハッシュ、更新と撤去の手順を用意する。
- 外部のサーバや IPC を使うときは、公開する範囲、認証、入力の検査、プロセスの寿命、秘密の情報の扱いを書く。
- 機能を足すことで、無断の通信や、音声と会話の文の予期しない保存を増やさない。

**境界と互換性**

- アプリ固有の UI や VRChat との連携を、上流の speech.cpp に頼らせない。
- モデルごとの違いは、機能の申告（capability）と接続の層で扱う。ない共通の API を前提にしない。
- 設定、IPC、イベント、保存済みのモデルとの互換性と、OS ごとの機能の違いを確かめる。
- 既存の採用済みの ADR と食い違うときは、変える理由と影響の範囲を書いて、その ADR を明示的に改訂するか置き換える（supersede）。既存の決定を黙って上書きしない。

### 2.7 ライセンスと検証の責任

- **ライセンス**: モデル、エンジン、ランタイム、その他の配布物ごとに、ライセンスと再配布の可否を確かめるのは、それを足す変更（PR、例外なら例外の ADR）である。結果は `NOTICE.md`、`docs/voice-stack/licensing.md`、モデルのカタログに書く。
- **Windows と Linux の検証**: 製品に採用する変更は、両方の OS での結果を PR に書く。片方の OS で確かめられないときは「未確認」と書き、リリース候補の確認（`release-candidates.md`）で確かめてから正式版に入れる。

## 3. Alternatives considered（検討した案）

| 案 | 内容 | 採らなかった理由 |
|---|---|---|
| ランタイムの混在 | 機能ごとに一番よいランタイムをその都度選ぶ | 1.1 のコストが機能の数だけ増える。選んだ理由と見直す条件も残らない |
| すべて GGML にする | OCR と翻訳も speech.cpp や GGML に移す | OCR と翻訳は speech.cpp の扱う範囲の外にあり、上流の設計に合わない。ONNX Runtime で動いている今の実装と検証を捨てることになる |
| 原則を決めず、今のまま | 既存の構成を保ち、新しいモデルはその都度判断する | 今の構成は保てるが、新しいモデルでランタイムが増えるのを止める基準がない |
| ONNX Runtime 以外の Rust のランタイム（tract、rten、candle、burn） | OCR、翻訳、VAD を別のランタイムで動かす | [推論ランタイムの比較](../voice-stack/inference-runtime-comparison.md)では、全部のモデルが動いたのは ONNX Runtime だけだった。VAD だけを別にする案は `core-integration.md` の 53 で未決のまま |

## 4. Consequences（結果）

**得るもの**

- 新しい音声 AI のモデルを足しても、ランタイム、配布物、ライセンス、検証の範囲が増えにくい。
- 上流への貢献が speech.cpp の利用者全体に返り、アプリが自分で保守するコードが減る。
- モデルとランタイムの採否を、同じ手順と記録の形で判断できる。

**負担とリスク**

- 上流の受け入れを待つ時間が、機能の時期に影響することがある。
- 上流の方針や版の変化に影響を受ける。版を固定し、8 の条件で見直して抑える。
- speech.cpp と ONNX Runtime の2つが残るので、ランタイムが1つになるわけではない。GPU の割り当てや VRAM も自動では揃わない。
- 例外の ADR を書く手間が増える。

**移し方**

- 既存の機能を一度に書き換えない。この ADR はコードを変えない。
- 既存の実装が 2.2 の分担と違う部分（RVC）は、6 の例外として扱う。
- 未決の判断（9）は、この ADR に照らしてそれぞれの場で決める。

## 5. 非目標

- すべての機械学習の処理を GGML や GGUF に揃えること
- speech.cpp に OCR、機械翻訳、VRChat 固有の UI を持たせること
- RVC をすぐに廃止したり移植したりすること
- 特定の新しいモデル（TEN VAD、Kokoro など）の採用を、この ADR だけで決めること
- アーキテクチャの改善を理由に、既存の機能をまとめて書き換えること

## 6. Exceptions（例外）

### 6.1 既存の例外: RVC のランタイム

RVC の声質変換は、管理対象の例外として続ける。speech.cpp に実用的な VC の基盤がない間は、移行を義務にしない。

| 項目 | 内容 |
|---|---|
| speech.cpp で満たせない理由 | speech.cpp には生の音声を変換する VC の機能がない（ADR 003） |
| 実装 | `native/rvc-runtime`（自前、MIT）。別プロセスの `vrct-rvc-worker` で、`ort` を通して ONNX Runtime で推論する。持ち主は `native/voice-conversion` |
| 配布 | ONNX Runtime、CUDA と cuDNN のライブラリ、HuBERT と RMVPE の重みは同梱しない。同意を得てから取得する（`NOTICE.md`） |
| 安全性 | 失敗したら止め、元の声に戻さない。ミュートと直接の音声の抑制は別に扱う（ADR-007、`native/voice-conversion`） |
| OS | Linux の管理された経路は PipeWire での録音がまだないので、中核が提供する範囲に制限がある（`native/voice-conversion/README.md`） |
| 見直す条件 | speech.cpp に実用的な VC の基盤ができたとき。そのほかは 8 による |

2.4 が求める項目のうち、GPU のない環境での振る舞い、CPU、GPU、VRAM の量、更新と脆弱性への対応の方針は、この ADR では新しく調べていない（9）。

ONNX Runtime 系の OCR とローカル翻訳は、2.2 の分担どおりなので例外ではない。Seed-VC の統合（`integrations/seed_vc/`）はリポジトリに残っているが、0.5.0 から配布物に入っておらず、この ADR では製品のランタイムとして扱わない。

### 6.2 新しい例外の承認

新しい例外は、2.4 に従って例外ごとの ADR で承認する。承認の前に、2.3 の手順の1から3を調べた結果を記録する。

> **例外の追記**（2026-11-19、Issue #412）：TranslateGemma のような decoder-only の翻訳の LLM を LLM 用の実行基盤（ONNX Runtime GenAI や llama.cpp など）で動かすことを新しい例外とした（[ADR-015](adr-015-translation-llm-runtime-exception.md)）。2.2 でローカル翻訳の担当を ONNX Runtime としたことの例外で、範囲は decoder-only の翻訳の LLM に限る。M2M100 と NLLB-200 は ONNX Runtime のままである。理由は今の `native/translate-onnx` が encoder-decoder の形だけを動かし、LLM の生成を自前で書くと LLM の実行基盤が持つ機能を作り直すことになるため。speech.cpp は機械翻訳を扱わない（5）ので、2.3 の上流への貢献の道もない。どの実行基盤にするか、配布の大きさ、ライセンスは ADR-015 の段階 2 で示す。本文は書き換えていない。

> **例外の追記**（2026-11-23、Issue #1061）：VOICEVOX CORE によるアプリ内の日本語読み上げを新しい管理対象の例外とした（[ADR-019](adr-019-voicevox-core-tts-runtime-exception.md)）。2.2 で読み上げの担当を speech.cpp としたことの例外で、既定の speech.cpp 読み上げと外部接続（ADR-008）は維持する。製品版 VVM は独自形式（`vv-bin`）と `voicevox_onnxruntime` 固有処理に依存し、規約上もリバースエンジニアリング禁止のため speech.cpp への変換・上流貢献や既存 ONNX Runtime（`1.31.0`）との共有ができない。薄い Rust 子プロセス（`astarot-voicevox-worker`）から同意取得した公式 `voicevox_core` C API（`0.17.1`、MIT）と `voicevox_onnxruntime` 正式版 `1.17.3`（CPU 版）を動的ロードし、初回は標準規約のみの代表パックから始める。本実装の着手は Windows・Linux 実機 PoC の結果を見て判断する。本文は書き換えていない。

## 7. Verification / Acceptance criteria（検証と受け入れの条件）

新しいモデル、ランタイム、例外を採用する変更は、次を確かめる。

| 観点 | 確かめること | 方法 |
|---|---|---|
| 動作 | 要求、途中と確定の結果、取り消し、失敗の通知が契約どおりに動く | 偽のサーバや偽の worker を使う試験（`native/core/tests/` の `voice.rs`、`realtime_asr.rs` など）。実物を使わずに契約を確かめる |
| 品質 | 精度や訳の質が、置き換える前や他の案より悪くならない | モデルごとの評価の組と指標。値には環境と条件を添える |
| 性能 | 2.6 のリアルタイム性。ASR、翻訳、TTS、VC を同時に動かしたときの待ち時間、バッファ、CPU、GPU、VRAM | Windows と Linux の実機で測る。数値の条件は既存の ADR と受け入れ試験に従う |
| 安全性 | 取り消し、ミュート、障害のときの無音、元の声への意図しない切り替えがないこと、ほかのモードを巻き込まないこと | 失敗を注入する試験（偽の worker を落とす、サーバを止めるなど） |
| ライセンスと配布 | ランタイム、重み、トークナイザごとのライセンス、再配布の可否、版と SHA-256 の固定 | `NOTICE.md` とライセンス台帳の確認、カタログと Rust の写しの一致（`tests/voice/test_native_ops_reference.py`）、`tools/check_voice_distribution.py`、`tools/rust_licenses.py` |
| OS | Windows と Linux の対応の範囲 | 2.7 のとおり PR に書く。確かめられないものは「未確認」 |

## 8. Revisit triggers（見直す条件）

次のときに、この ADR か例外の ADR を見直す。

- speech.cpp に、例外で扱っている機能（VC など）や、新しく足したい機能が入ったとき
- 上流が方針を変えたとき、または提案を受け入れないと決めたとき
- 使っているモデルやランタイムの版を上げるとき
- 実機で性能や品質が悪くなったとき
- ライセンス、再配布の条件、取得元が変わったとき（たとえば DirectML 版の ONNX Runtime の更新が止まっていること。[推論ランタイムの比較](../voice-stack/inference-runtime-comparison.md)）
- ランタイムに深刻な脆弱性が見つかったとき
- 対応する OS や GPU の範囲を変えるとき

## 9. 未決のこと

- 利用者が自分で入れた外部のエンジン（ADR-008 の VOICEVOX など）にループバックで接続する方式が、「独立した AI ランタイム」に当たるか。アプリは同梱も起動もしないので当たらないと読めるが、明記していない。
- 2.4 の「明確な優位性」を、どの指標（遅延、配布物のサイズ、VRAM など）で、どれだけの差があれば認めるか。
- 録音の VAD のエンジン（`core-integration.md` の 13）は、2026-11-19 に (c) に決まった。2.2 のとおり speech.cpp が取得する Silero VAD の GGUF を、リアルタイム字幕と同じサーバーで使う（#278 の 3-4）。speech.cpp 0.11.0 には検出のモデルだけで区間を返す方法がないので、VAD のために認識モデルを読み込む必要がある。その方法を上流に提案するかは同じ文書の 83 で決める。
- OCR と翻訳のランタイムの選び方（`core-integration.md` の 53）。2.2 は OCR と翻訳を ONNX Runtime としたが、ONNX Runtime のライブラリの配り方（同じ文書の 2）は決めていない。VAD は上の決定で speech.cpp に入ったので、この項目の対象から外れた。
- RVC の例外の記録で足りない項目（6.1）。GPU のない環境での振る舞い、CPU、GPU、VRAM の量、更新と脆弱性への対応の方針、担当。
- 音声強調と AI のノイズ除去は実装がなく、speech.cpp で扱えるかも調べていない。
