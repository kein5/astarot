---
date: 2026-11-23
status: accepted
era: rust-core
validity: current
implementation_status: pending
implementation_checked: 2026-11-23
evidence:
  - docs/adr/adr-019-voicevox-core-tts-runtime-exception.md
  - docs/adr/adr-012-audio-ai-runtime-consolidation.md
  - docs/adr/adr-008-external-speech-engines.md
---
# ADR-019: Build VOICEVOX CORE into TTS with a dedicated worker that loads its C API dynamically (an exception to ADR-012)

[日本語版](#adr-019-voicevox-core-を専用ワーカーと-c-api-の動的ロードで読み上げに組み込むadr-012-の例外日本語版)

Status: Accepted (2026-11-23, the record of the decision in Issue #1061). In-app Japanese TTS with VOICEVOX CORE becomes a managed exception to ADR-012, and the chosen setup is a thin Rust child process that dynamically loads the official C API and `voicevox_onnxruntime`. Whether to start the full implementation is decided separately, after seeing the results of PoCs on real Windows and Linux hardware.
Date: 2026-11-23
Decision owners: The repository's maintainers
Related: Issue #1061, [ADR-012](adr-012-audio-ai-runtime-consolidation.md), [ADR-008](adr-008-external-speech-engines.md), [ADR-015](adr-015-translation-llm-runtime-exception.md), [the license register](../voice-stack/licensing.md), [model downloads](../voice-stack/model-downloads.md), `NOTICE.md`

In this ADR, "the app" means the app in this repository. Its display name is ASTAROT (ADR-011). The layout at the time of writing is that of 0.6.0 (`rust-core`), in which the Rust core (`native/core`) runs inside the app process, and OCR, local translation and RVC use Microsoft's official ONNX Runtime `1.31.0`. The upstream versions used in the evaluation are `voicevox_core` `0.17.1`, `voicevox_onnxruntime` `1.17.3` (a stable release), `voicevox_vvm` `0.17.1`, and the Open JTalk system dictionary `v1.11.1`.

## 1. Context

### 1.1 The problem and the current TTS setup

Under 2.2 of ADR-012, ASTAROT's text to speech (TTS) is in principle gathered into speech.cpp. Japanese character voices are provided under ADR-008 by connecting over loopback HTTP to external speech synthesis engines (VOICEVOX, SHAREVOX, AivisSpeech, COEIROINK v2) that users install and start themselves.

This setup has two problems:

- Installing and starting an external engine separately takes a lot of effort, which is a burden for users who want to start just by choosing a voice on the settings screen.
- speech.cpp's Japanese TTS model (Irodori-TTS v4.1 Small MF) assumes a GPU, and is not practical in CPU-only environments or where VRAM should be left for VRChat (on the CPU of a Core i7-1255U, the first output takes 3 to 7 seconds, synthesis runs about 4 times slower than real time, and playback breaks up).

On the other hand, if `voicevox_core` (MIT from 0.16), the inference core of VOICEVOX, runs inside the app and only the character voices needed (`.vvm`) are downloaded with consent, Japanese character voices can be read aloud without starting an external engine.

### 1.2 Evaluation under 2.3 of ADR-012

Following 2.3 of ADR-012 (steps 1 to 3), integration into speech.cpp and sharing the existing ONNX Runtime were evaluated, with these results:

- **Replacing it with speech.cpp or contributing it upstream is not possible**: the product voice models (`.vvm`) depend on a proprietary format (`vv-bin`), the prosody analysis of Open JTalk, and processing specific to `voicevox_onnxruntime`. In addition, the `VOICEVOX 音声モデル 利用規約` (`TERMS.txt`) forbid reverse engineering, so converting the models to GGUF or porting them upstream to speech.cpp is impossible, both technically and under the terms. The character voices themselves cannot be replaced by speech.cpp's existing models either.
- **It cannot share the existing ONNX Runtime (1.31.0)**: from 0.16, `voicevox_core` moved the loading of `vv-bin` into `voicevox_onnxruntime`, and at startup it checks for a dedicated identification string (`VOICEVOX ORT Build Info:`) and `session.use_vv_bin=1`. The versions that `voicevox_core` `0.17.1` supports are `1.17.3〜1.29` (built with `--disable_contrib_ops`), which match neither the version nor the build of ASTAROT's own Microsoft official ONNX Runtime `1.31.0` (API v31). Further, `ort` can initialize only one `OrtApi` per process, and `voicevox_core` `0.17.1` has git dependencies on `ort-sys = 2.0.0-rc.12` and `open_jtalk-rs` (a C++ build), so it cannot be built directly into the main process.

For these reasons, bringing VOICEVOX CORE into in-app TTS needs an ADR of its own that sets its boundaries as a "managed exception", as was done for RVC (6.1 of ADR-012) and TranslateGemma (ADR-015).

## 2. Decision

Based on the maintainers' decision of 2026-11-23 (Issue #1061), this ADR sets the following.

1. **Scope of the exception**: in-app Japanese TTS with VOICEVOX CORE is a managed exception to 2.2 of ADR-012 (TTS runs on speech.cpp). The existing TTS on speech.cpp stays as it is, and the default TTS engine does not change. VOICEVOX CORE is used only when the user explicitly chooses it.
2. **Reasons for the exception (the two conditions in 2.1 of ADR-012)**:
   - **Technical and terms-of-use reasons the existing base cannot do it**: the product VVMs need the proprietary `vv-bin` format, the prosody analysis of Open JTalk and processing specific to `voicevox_onnxruntime`, and because reverse engineering is forbidden, they cannot be converted for speech.cpp or contributed upstream. They also cannot share the existing Microsoft ONNX Runtime `1.31.0`.
   - **A clear advantage in performance, maintenance and distribution cost**: in environments without a GPU, or where VRAM should be kept for VRChat, it can read aloud practically on the CPU alone, which is an advantage over the Japanese TTS of speech.cpp (whose playback breaks up on the CPU). Compared with ADR-008 (starting an external engine by hand), the setup burden also drops a lot. With option B1 below, a larger distribution, the maintenance of a C++ build, and LGPL obligations are all avoided too.
3. **How it is built in, and its runtime base (option B1)**:
   - A thin Rust child process, `astarot-voicevox-worker` (MIT), is bundled with the app.
   - The common base is not bundled in the distribution. After the user's consent, it is downloaded into the data folder and loaded dynamically with `libloading` when the worker starts. It consists of the official prebuilt `voicevox_core` C API (`0.17.1`, MIT, a zip of about 1.39 MiB for both Windows x64 and Linux x64), the stable `voicevox_onnxruntime` `1.17.3` (the CPU build, about 4.44 MiB on Windows x64 and about 6.45 MiB on Linux x64), and the Open JTalk system dictionary `v1.11.1` (BSD-3-Clause, 22.55 MiB compressed, about 102 MiB extracted). We do not wait for a stable release of the `1.23.2` prerelease.
   - At first, it uses **CPU inference only**, and uses no VRAM. A DirectML option for Windows (about 5.6 to 6.4 MiB, plus about 9 MiB for `DirectML.dll`) is considered at a later stage, after measurements on real hardware. The CUDA libraries (about 1.5 GiB) are neither bundled nor downloaded.
   - The worker communicates only over a dedicated local channel with the parent process (standard input and output, or private local IPC), and is not exposed to the network.
4. **The catalog and the range of VVMs**:
   - The unit of download and verification is a VVM file (with its version, size and SHA-256 pinned in the catalog), and downloads from GitHub Releases (a redirect from `github.com` to `release-assets.githubusercontent.com`) are supported. To keep these files from being bundled in the distribution by mistake, `vvm` is added to `MODEL_EXTENSIONS` in `tools/distribution_policy.py`.
   - The first step starts from a **representative pack under the standard terms only** (for example `0.vvm`, 56.6 MiB, with four characters: Shikoku Metan, Zundamon, Kasukabe Tsumugi and Amehare Hau). The first download of the common base (CPU) and the single `0.vvm` comes to about 85 to 89 MiB in total.
   - Extending to the VVMs that include the seven characters with individual restrictions (non-commercial only, or prior confirmation needed for corporate or commercial use) (`6`, `7`, `15`, `16`, `17`, `18` and `20.vvm`) proceeds separately, together with individual confirmation checks, once the implementation of the representative pack is settled.
   - VOICEVOX Nemo (`n0.vvm`) and the singing voices (`s0.vvm`) are not included.
5. **Division of roles with ADR-008 (connecting to external speech synthesis engines)**:
   - ADR-008 stays in force alongside this ADR, and is not replaced.
   - In-app VOICEVOX CORE covers "starting without a separate installation", "Japanese TTS on the CPU alone, without using VRAM", and "immediate use of the characters under the standard terms".
   - ADR-008 (the external connection) covers "using SHAREVOX, AivisSpeech and COEIROINK v2" and "using a VOICEVOX ENGINE the user runs on their own, custom dictionaries, GPU engines, and VVMs not in the catalog". The settings screen lists both side by side, shown so that they can be told apart, and lets the user choose.
6. **Licenses, consent and credit display (2.6 and 2.7 of ADR-012)**:
   - `VOICEVOX ENGINE` (LGPL-3.0) is not used, so no LGPL obligations arise.
   - To follow the own terms of `voicevox_onnxruntime` and of `.vvm` (credit is required, the voice library terms must be passed on to users, reverse engineering is forbidden), neither is bundled in the MIT distribution, and both are downloaded only after explicit consent.
   - Credits are shown in these four places: (a) directly below the voice selection on the settings screen (the exact credit string of the selected character and a link to its terms), (b) the download consent screen (`TERMS.txt`, links to the terms of the included characters, and a clear statement that credit is required), (c) the "About ASTAROT" screen (VOICEVOX attribution text shown directly in `AboutVrct.tsx`), and (d) `NOTICE.md` and the license register (`docs/voice-stack/licensing.md`).
7. **Realtime behavior and safety (2.6 of ADR-012)**:
   - Inference runs in the dedicated child process, not in audio callbacks or on the UI thread. Explicit cancel, mute and stop take effect at once, even during synthesis.
   - A crash or a timeout of the worker does not drag down the main app, the audio route, mute or other engines. On a failure, the app reports an error and keeps silent, and does not silently switch to the original voice or to another engine.
   - It uses the same sentence splitting, comma splitting and look-ahead synthesis as the existing `native/tts/src/engines.rs`, and meets the start deadline for reading the microphone aloud (within 5 seconds, 13 of ADR-008).
   - It does not write the text read aloud or the synthesized audio to logs, and does not add outside communication without consent.
8. **Stages, ownership, and the policy for updates and vulnerabilities (2.4 of ADR-012)**:
   - **Stages**: as the first stage, this ADR and PoC measurements on real Windows and Linux hardware (latency, CPU, memory) go ahead. Whether to start the second stage (the actual implementation) is decided after seeing their results.
   - **Ownership**: the repository's maintainers (the worker and the TTS integration are managed in `native/tts`, the download catalog and verification in `native/ops`, and the settings and credit display in `src-ui/`).
   - **Updates and vulnerabilities**: watch the releases of `voicevox_core`, `voicevox_onnxruntime` and `voicevox_vvm`. When raising a version, check the size, the SHA-256 and the diff of `TERMS.txt`, then update the catalog, `NOTICE.md` and the license register together. If a serious vulnerability or a change in the terms is found, stop new downloads of the affected items, and replace them with a fixed version or remove them.

## 3. Alternatives considered

| Option | What it is | Why it was not chosen |
|---|---|---|
| Option A: build the `voicevox_core` Rust crate directly into the main process | Call `voicevox_core` in the same process as `native/core` | The main app's Microsoft ONNX Runtime `1.31.0` and `voicevox_onnxruntime` (`1.17.3`) collide inside one process. The version difference of `ort-sys` and the git and C++ dependencies enter the main build, and an inference crash takes down the whole app |
| Option B2: build the `voicevox_core` crate directly in a separate Cargo workspace | Keep a separate child process, but build it from source as a Rust crate | `voicevox_core` is not published on crates.io, and maintaining the `open_jtalk-rs` (C++ build) and `ort` git dependencies in Windows and Linux CI is a heavy burden. Dynamically loading the official C API avoids that burden |
| Option C: bundle `VOICEVOX ENGINE` as a separate process | Bundle the full set of official engine executables with the app and connect over HTTP | `VOICEVOX ENGINE` falls under LGPL-3.0, which requires offering the source for three years and maintaining a procedure for replacing it. It adds several hundred MiB including a whole Python runtime, goes against the move away from Python in 0.5.0, and overlaps in role with ADR-008 |
| Keep the current state (only the external connection of ADR-008) | No in-app integration; starting VOICEVOX is left to the user | Installing and starting VOICEVOX separately stays required, so the barrier remains for users who want to start just by choosing a voice on the settings screen |
| Port to speech.cpp or contribute upstream | Convert the VVMs to GGUF and contribute them to speech.cpp | Impossible both technically and under the terms: it depends on the proprietary `vv-bin` format and the prosody analysis of Open JTalk, and it would also break the clause in `TERMS.txt` that forbids reverse engineering |

## 4. Consequences

**What we gain**

- Japanese character voices become usable just by downloading the representative pack from the settings screen, without installing and starting VOICEVOX separately.
- It runs on the CPU alone (0 VRAM use), so Japanese TTS becomes practical even on PCs without a GPU or where VRAM should be kept for VRChat.
- Loading the `voicevox_core` C API (MIT) dynamically avoids LGPL obligations, bundling binaries under their own terms in the distribution, and C++ and git dependencies in the main app.
- Separating it into a child process prevents ONNX Runtime conflicts and keeps inference crashes from spreading.

**Costs and risks**

- One more pair of an inference runtime (`voicevox_onnxruntime` `1.17.3`) and a C API becomes a managed item, which adds the burden of following versions, checking SHA-256 and `TERMS.txt`, and checking behavior on each OS (1.1 of ADR-012).
- Synthesis on the CPU handles each sentence in one batch (`StreamingTalk` in `voicevox_core` `0.17.1` is currently non-streaming, the same as `Talk`), so it cannot meet the overall latency target that assumes a GPU (#556: p50 of 1.0 second or less from the end of speech to the start of the voice). speech.cpp stays as the low-latency GPU path, and VOICEVOX CORE is positioned as the option for the CPU and for character voices.
- Users are asked to download about 85 to 89 MiB at first (the common base plus `0.vvm`, more than about 180 MiB after extraction), and to understand the consent to the terms and the credit requirements.
- `voicevox_onnxruntime` `1.17.3` is the latest stable release upstream, but it was published in 2025-03, so future OS updates and security updates will call for a decision on moving to a later version (such as a stable `1.23.x` or later).

**Migration policy**

- Do not break the existing TTS engine (speech.cpp), the external engine connection of ADR-008, the existing settings file, or the IPC contract.
- Before the actual implementation starts, measure a PoC of option B1 on real Windows x64 and Linux x64 hardware, and check latency, CPU and memory.

## 5. Verification and acceptance criteria

Before the actual implementation starts, and before it is accepted into the product, check the following. If they cannot be met, reconsider under the conditions in 6.

| Aspect | What to check | How |
|---|---|---|
| Performance (PoC and real hardware) | Synthesis latency for short sentences on the first and later runs, CPU and memory use during continuous speech, meeting the 5-second start deadline for reading the microphone aloud, no VRAM use | Measure a prototype of the option B1 worker on real Windows x64 and Linux x64 hardware, and record the results with the environment and conditions in Issue #1061 (2.7 of ADR-012) |
| Behavior and contract | Synthesis requests, sentence splitting and look-ahead, cancellation and failure notices work according to the existing TTS contract | Unit and integration tests in `native/tts` and `native/core` with a fake worker |
| Safety | A crash, timeout or failed start of the worker does not affect the main app, the audio route, mute or other engines. The app does not silently switch to the original voice or to another engine | Tests that inject failures (making a fake worker crash or lag) |
| Distribution and licenses | `.vvm` files, `voicevox_onnxruntime` and the Open JTalk dictionary are not bundled in the distribution by mistake. Versions, sizes and SHA-256 are pinned and recorded in `NOTICE.md` and the license register | `tools/distribution_policy.py` (with `vvm` added), `tools/check_voice_distribution.py`, `tools/rust_licenses.py`, `native/core/tests/downloads.rs` |
| Consent and credits | The common base and VVMs are not downloaded before consent. The exact credits and terms links appear directly below the voice selection, on the consent screen, in `AboutVrct.tsx` and in `NOTICE.md` | UI unit tests and Playwright integration tests |
| OS support | Dynamic loading, synthesis and playback work on both Windows x64 and Linux x64. If one of them stays unchecked, say so and check it in a release candidate | Checks on real hardware for both OSes (2.7 of ADR-012) |

## 6. Revisit triggers

Revisit this exception ADR when any of the following applies.

- When the PoC on real Windows or Linux hardware, or a check while running VRChat, cannot meet the 5-second start deadline or the acceptable range of CPU and memory.
- When speech.cpp gains a light Japanese TTS for the CPU, or a path that gives an equal experience, and this exception loses its advantage in performance and experience.
- When `voicevox_core`, `voicevox_onnxruntime` or `voicevox_vvm` stops being updated, their license or terms of use change, or a serious vulnerability is found.
- When deciding to move to a later stable `voicevox_onnxruntime` (such as `1.23.x` or later), or when adding the DirectML option for Windows.
- When deciding to extend the catalog to the VVMs that include characters with individual restrictions (`6`, `7`, `15`, `16`, `17`, `18` and `20.vvm`).
- When `StreamingTalk` in `voicevox_core` supports real streaming synthesis, and reconsidering the worker's IPC contract and the latency target becomes worthwhile.

## 7. Open questions

- **The results of the PoC on real Windows and Linux hardware, and whether to start the actual implementation**: decided after the measurements are collected in Issue #1061.
- **The detailed contract of the worker's IPC**: the form of requests, responses, cancellation and health checks is specified in `docs/spec/` when the actual implementation is designed.
- **The range and timing of extending to VVMs beyond the representative pack**: decided once the implementation of the representative pack is settled, together with the UI that checks the seven restricted characters one by one.
- **Whether to adopt the DirectML option for Windows**: decided at a later stage, after the measurements on the CPU on real hardware.
- **Details of routing when English or other languages are mixed in**: set in the specification at implementation time, including consistency with the existing external engine connection (ADR-008).

---

# ADR-019: VOICEVOX CORE を専用ワーカーと C API の動的ロードで読み上げに組み込む（ADR-012 の例外）（日本語版）

Status: 採用（2026-11-23、Issue #1061 の決定の記録）。VOICEVOX CORE によるアプリ内日本語読み上げを ADR-012 の管理対象の例外とし、薄い Rust 子プロセスから公式 C API と `voicevox_onnxruntime` を動的ロードする構成を採る。実装の本着手は、Windows と Linux の実機 PoC の結果を見てから別途判断する。
Date: 2026-11-23
Decision owners: リポジトリの保守担当者
Related: Issue #1061、[ADR-012](adr-012-audio-ai-runtime-consolidation.md)、[ADR-008](adr-008-external-speech-engines.md)、[ADR-015](adr-015-translation-llm-runtime-exception.md)、[ライセンス台帳](../voice-stack/licensing.md)、[モデルの取得](../voice-stack/model-downloads.md)、`NOTICE.md`

この ADR の「アプリ」は本リポジトリのアプリを指す。表示名は ASTAROT（ADR-011）である。書いた時点の構成は、Rust の中核（`native/core`）がアプリのプロセスの中で動き、OCR・ローカル翻訳・RVC に Microsoft 公式の ONNX Runtime `1.31.0` を使う 0.6.0 の構成（`rust-core`）である。評価に使った上流の版は `voicevox_core` `0.17.1`、`voicevox_onnxruntime` `1.17.3`（正式版）、`voicevox_vvm` `0.17.1`、Open JTalk システム辞書 `v1.11.1` である。

## 1. Context（背景）

### 1.1 課題と既存の読み上げ構成

ASTAROT の読み上げ（TTS）は、ADR-012 の 2.2 で原則として speech.cpp に寄せ、日本語のキャラクター音声は ADR-008 により利用者が自分で導入・起動した外部の合成音声エンジン（VOICEVOX、SHAREVOX、AivisSpeech、COEIROINK v2）へループバック HTTP で接続して提供している。

この構成には次の 2 つの課題がある。

- 外部エンジンを別に導入・起動する手間が大きく、設定画面から声を選ぶだけで使い始めたい利用者の負担になる。
- speech.cpp の日本語読み上げモデル（Irodori-TTS v4.1 Small MF）は GPU 前提であり、CPU のみの環境や VRAM を VRChat へ残したい環境では実用にならない（Core i7-1255U の CPU では初回 3〜7 秒かつ実時間の約 4 倍遅く再生が途切れる）。

一方、VOICEVOX の推論本体である `voicevox_core`（0.16 以降 MIT）をアプリ内で動かし、必要なキャラクターの声（`.vvm`）だけを同意つきで取得すれば、外部エンジンの起動なしで日本語キャラクター音声を読み上げられる。

### 1.2 ADR-012 の 2.3 に沿った評価

ADR-012 の 2.3（手順 1〜3）に沿って、speech.cpp への統合と既存 ONNX Runtime の共有を評価した結果は次のとおりである。

- **speech.cpp での代替・上流貢献は不可**: 製品版の音声モデル（`.vvm`）は独自形式（`vv-bin`）と Open JTalk の韻律解析、`voicevox_onnxruntime` の固有処理に依存する。加えて `VOICEVOX 音声モデル 利用規約`（`TERMS.txt`）はリバースエンジニアリングを禁止しており、GGUF への変換や speech.cpp への上流移植は技術的にも規約上も実現できない。キャラクター音声自体も speech.cpp の既存モデルで代替できない。
- **既存の ONNX Runtime（1.31.0）とは共有できない**: `voicevox_core` 0.16 以降は `vv-bin` の読み込み処理を `voicevox_onnxruntime` 側へ分離しており、起動時に専用の識別文字列（`VOICEVOX ORT Build Info:`）と `session.use_vv_bin=1` を確認する。`voicevox_core` `0.17.1` の対応版は `1.17.3〜1.29`（`--disable_contrib_ops` ビルド）であり、ASTAROT 本体の Microsoft 公式 ONNX Runtime `1.31.0`（API v31）とは版も構成も合わない。さらに `ort` は 1 プロセスにつき 1 つの `OrtApi` しか初期化できず、`voicevox_core` `0.17.1` は `ort-sys = 2.0.0-rc.12` と `open_jtalk-rs`（C++ ビルド）の git 依存を持つため、本体プロセスへ直接組み込めない。

以上から、VOICEVOX CORE をアプリ内読み上げに導入するには、RVC（ADR-012 の 6.1）や TranslateGemma（ADR-015）と同様の「管理対象の例外」として個別の ADR で境界を定める必要がある。

## 2. Decision（決定）

2026-11-23 の保守担当者の決定（Issue #1061）に基づき、次を定める。

1. **例外とする範囲**: VOICEVOX CORE によるアプリ内の日本語読み上げを、ADR-012 の 2.2（読み上げは speech.cpp）に対する管理対象の例外とする。既存の speech.cpp による読み上げはそのまま維持し、既定の TTS エンジンは変えない。VOICEVOX CORE は利用者が明示的に選んだときだけ使う。
2. **例外とする理由（ADR-012 の 2.1 の 2 条件）**:
   - **既存基盤で実現できない技術的・規約的理由**: 製品版 VVM は `vv-bin` 独自形式・Open JTalk 韻律解析・`voicevox_onnxruntime` 固有処理を必要とし、リバースエンジニアリング禁止のため speech.cpp への変換・上流貢献ができない。既存の Microsoft ONNX Runtime `1.31.0` とも共有できない。
   - **性能・保守・配布コスト上の明確な優位性**: GPU がない環境や VRAM を VRChat へ温存したい環境で、speech.cpp の日本語 TTS（CPU では再生が途切れる）に対して CPU のみで実用的に読み上げられる優位性がある。ADR-008（外部エンジン手動起動）と比べて導入負担も大きく下がる。下記の案 B1 により、配布物の増加・C++ ビルド保守・LGPL の義務も避けられる。
3. **組み込み方式と実行基盤（案 B1）**:
   - 薄い Rust 子プロセス `astarot-voicevox-worker`（MIT）をアプリに同梱する。
   - 共通基盤は配布物に同梱せず、利用者の同意を得てからデータフォルダーへ取得し、ワーカー起動時に `libloading` で動的ロードする。対象は公式ビルド済み `voicevox_core` C API（`0.17.1`、MIT、Windows x64・Linux x64 とも zip 約 1.39 MiB）、`voicevox_onnxruntime` 正式版 `1.17.3`（CPU 版、Windows x64 約 4.44 MiB / Linux x64 約 6.45 MiB）、Open JTalk システム辞書 `v1.11.1`（BSD-3-Clause、圧縮 22.55 MiB、展開後約 102 MiB）とする。プレリリース版 `1.23.2` の正式版は待たない。
   - 初回は **CPU 推論のみ** とし、VRAM を消費しない。Windows 向けの DirectML オプション（約 5.6〜6.4 MiB＋`DirectML.dll` 約 9 MiB）は実機計測を見て後段で検討する。CUDA ライブラリ（約 1.5 GiB）は同梱も取得もしない。
   - ワーカーの通信経路は親プロセスとの専用ローカル経路（標準入出力または非公開ローカル IPC）に限定し、ネットワークへ公開しない。
4. **カタログと VVM の範囲**:
   - 取得と検証の単位は VVM ファイル（版、サイズ、SHA-256 をカタログに固定）とし、GitHub Releases（`github.com` から `release-assets.githubusercontent.com` への転送）からの取得に対応する。配布物への誤同梱を防ぐため、`tools/distribution_policy.py` の `MODEL_EXTENSIONS` に `vvm` を追加する。
   - 初回は**標準規約のみの代表パック**（例: `0.vvm`、56.6 MiB、四国めたん・ずんだもん・春日部つむぎ・雨晴はうの 4 キャラクター）から始める。共通基盤（CPU）と `0.vvm` 1 本の初回ダウンロード合計は約 85〜89 MiB である。
   - 個別制限（非商用限定、法人・商用事前確認）がある 7 キャラクターを含む VVM（`6`・`7`・`15`・`16`・`17`・`18`・`20.vvm`）への拡張は、代表パックの実装が固まってから個別確認チェックとあわせて別途進める。
   - VOICEVOX Nemo（`n0.vvm`）と歌唱用（`s0.vvm`）は対象に含めない。
5. **ADR-008（外部合成音声エンジン接続）との住み分け**:
   - ADR-008 はそのまま有効として並存させ、置き換えない。
   - アプリ内 VOICEVOX CORE は「別途インストールなしで始められること」「CPU のみ・VRAM 非消費での日本語読み上げ」「標準規約キャラクターの即時利用」を担う。
   - ADR-008（外部接続）は「SHAREVOX・AivisSpeech・COEIROINK v2 の利用」「利用者が独自に運用する VOICEVOX ENGINE やカスタム辞書、GPU エンジン、カタログ未収録の VVM の利用」を担う。設定画面では両者を区別できる表示で並べて選べるようにする。
6. **ライセンス、同意、クレジット表示（ADR-012 の 2.6・2.7）**:
   - `VOICEVOX ENGINE`（LGPL-3.0）を使わないため、LGPL の義務は発生しない。
   - `voicevox_onnxruntime` と `.vvm` の独自規約（クレジット表記必須、音声ライブラリ規約の利用者への継承義務、リバースエンジニアリング禁止）を守るため、どちらも MIT の配布物へ同梱せず、明示の同意を得てから取得する。
   - クレジット表示は次の 4 箇所へ配置する。(a) 設定画面の声選択欄の直下（選択中キャラクターの正確なクレジット文字列と規約リンク）、(b) ダウンロード同意画面（`TERMS.txt` と収録キャラクター規約リンク、クレジット必須の明示）、(c) 「ASTAROT について」画面（`AboutVrct.tsx` への VOICEVOX 帰属文言の直接表示）、(d) `NOTICE.md` とライセンス台帳（`docs/voice-stack/licensing.md`）。
7. **リアルタイム性と安全性（ADR-012 の 2.6）**:
   - 推論は専用子プロセス内で行い、音声コールバックや UI スレッドに置かない。明示の取り消し・ミュート・停止は合成中でも即応する。
   - ワーカーの異常終了やタイムアウトでアプリ本体、音声経路、ミュート、他エンジンを巻き込まない。失敗時はエラーを通知して無音を保ち、元の声や別エンジンへ黙って切り替えない。
   - 既存の `native/tts/src/engines.rs` と同じ文分割・読点分割・先読み合成を使い、マイク読み上げの開始期限（5 秒以内、ADR-008 の 13）を満たす。
   - 読み上げ文や合成音声をログへ出さず、同意なしの外部通信を増やさない。
8. **段階、担当、更新と脆弱性対応の方針（ADR-012 の 2.4）**:
   - **段階**: 第 1 段階としてこの ADR と Windows・Linux 実機での PoC 計測（遅延・CPU・メモリ）を進め、その結果を見てから第 2 段階（本実装）の着手を判断する。
   - **担当**: リポジトリの保守担当者（ワーカーと TTS 統合は `native/tts`、取得カタログと検証は `native/ops`、設定とクレジット表示は `src-ui/` の領域で管理する）。
   - **更新と脆弱性対応**: `voicevox_core`・`voicevox_onnxruntime`・`voicevox_vvm` のリリースを確認し、版を上げる際はサイズ・SHA-256・`TERMS.txt` の差分を検査したうえでカタログ、`NOTICE.md`、ライセンス台帳を同時更新する。重大な脆弱性や規約変更が見つかった場合は、該当項目の新規取得を止め、修正版へ差し替えるか撤去する。

## 3. Alternatives considered（検討した案）

| 案 | 中身 | 採らなかった理由 |
|---|---|---|
| 案 A: 本体プロセスへ `voicevox_core` Rust クレートを直接組み込む | `native/core` と同じプロセスで `voicevox_core` を呼ぶ | 本体の Microsoft ONNX Runtime `1.31.0` と `voicevox_onnxruntime`（`1.17.3`）が 1 プロセス内で衝突する。`ort-sys` の版差と git・C++ 依存が本体ビルドへ入り、推論クラッシュでアプリ全体が落ちる |
| 案 B2: 別 Cargo ワークスペースで `voicevox_core` クレートを直接ビルドする | 子プロセスを分けつつ、Rust クレートからソースビルドする | `voicevox_core` は crates.io 未公開で、`open_jtalk-rs`（C++ ビルド）と `ort` の git 依存を Windows・Linux の CI で保守する負担が重い。公式 C API 動的ロードならその負担を避けられる |
| 案 C: `VOICEVOX ENGINE` を別プロセスで同梱する | 公式エンジン実行ファイル一式をアプリへ同梱し HTTP 接続する | `VOICEVOX ENGINE` は LGPL-3.0 対象となり 3 年間のソース提供と差し替え手順の保守が要る。Python 実行環境ごと数百 MiB 増え、0.5.0 の脱 Python の方針に逆行し、ADR-008 とも役割が重複する |
| 現行維持（ADR-008 の外部接続のみ） | アプリ内組み込みを行わず、利用者による VOICEVOX 起動に任せる | VOICEVOX 本体の別途導入と起動が必須のままで、設定画面から声を選ぶだけで始めたい利用者の障壁が解消しない |
| speech.cpp への移植・上流貢献 | VVM を GGUF へ変換し speech.cpp へ貢献する | `vv-bin` 独自形式と Open JTalk 韻律解析に依存し、`TERMS.txt` のリバースエンジニアリング禁止条項にも抵触するため技術的・規約的に不可 |

## 4. Consequences（影響）

**得るもの**

- 外部の VOICEVOX を別に導入・起動せず、設定画面から代表パックを取得するだけで日本語キャラクター音声を使えるようになる。
- CPU のみ（VRAM 消費 0）で動作し、GPU のない PC や VRAM を VRChat へ温存したい環境でも日本語読み上げが実用的になる。
- `voicevox_core` C API（MIT）の動的ロードにより、LGPL の義務、配布物への独自規約バイナリ同梱、本体への C++・git 依存を避けられる。
- 子プロセス分離により、ONNX Runtime の競合と推論クラッシュの波及を防げる。

**負担とリスク**

- 推論ランタイム（`voicevox_onnxruntime` `1.17.3`）と C API の組を 1 つ管理対象へ増やすため、版の追従、SHA-256 と `TERMS.txt` の確認、OS ごとの動作確認の負担が増える（ADR-012 の 1.1）。
- CPU での文単位一括合成（`voicevox_core` `0.17.1` の `StreamingTalk` は現時点で `Talk` と同等の非ストリーミング）のため、GPU 前提の全体遅延目標（#556 の話し終わりから発声開始まで p50 1.0 秒以下）とは両立しない。低遅延の GPU 経路としては speech.cpp を維持し、VOICEVOX CORE は CPU・キャラクター音声の選択肢として位置づける。
- 利用者には初回約 85〜89 MiB（共通基盤＋ `0.vvm`、展開後約 180 MiB 超）の取得と、規約同意・クレジット表記の理解を求める。
- `voicevox_onnxruntime` `1.17.3` は上流の正式版最新だが 2025-03 公開であり、今後の OS 更新やセキュリティ更新で上位版（`1.23.x` 以降の正式版など）への移行判断が必要になる。

**移行の方針**

- 既存の TTS エンジン（speech.cpp）、ADR-008 の外部エンジン接続、既存の設定ファイルと IPC 契約を壊さない。
- 本実装の着手前に、Windows x64 と Linux x64 の実機で案 B1 の PoC を計測し、遅延・CPU・メモリを確かめる。

## 5. Verification / Acceptance criteria（検証と受け入れの条件）

本実装の着手および製品への受け入れ前に、次を確かめる。満たせない場合は 6 の条件で見直す。

| 観点 | 確かめること | 方法 |
|---|---|---|
| 性能（PoC と実機） | 初回・2 回目以降の短文合成遅延、連続発話時の CPU 使用率とメモリ使用量、マイク読み上げ 5 秒開始期限への適合、VRAM 非消費 | Windows x64 と Linux x64 の実機で案 B1 ワーカー試作を計測し、環境と条件を添えて Issue #1061 へ記録する（ADR-012 の 2.7） |
| 動作と契約 | 合成要求、文分割と先読み、取り消し、失敗通知が既存の TTS 契約どおりに動く | 偽のワーカーを使う `native/tts`・`native/core` の単体・結合試験 |
| 安全性 | ワーカーのクラッシュ・タイムアウト・起動失敗で本体・音声経路・ミュート・他エンジンが影響を受けないこと。元の声や別エンジンへ黙って切り替えないこと | 失敗を注入する試験（偽のワーカーを異常終了・遅延させる） |
| 配布とライセンス | 配布物に `.vvm`・`voicevox_onnxruntime`・Open JTalk 辞書が誤同梱されないこと。版・サイズ・SHA-256 固定、`NOTICE.md` とライセンス台帳への記録 | `tools/distribution_policy.py`（`vvm` 追加）、`tools/check_voice_distribution.py`、`tools/rust_licenses.py`、`native/core/tests/downloads.rs` |
| 同意とクレジット | 同意前に共通基盤と VVM を取得しないこと。声選択欄直下・同意画面・`AboutVrct.tsx`・`NOTICE.md` に正確なクレジットと規約リンクが出ること | UI の単体試験と Playwright 結合試験 |
| OS 対応 | Windows x64 と Linux x64 の両方で動的ロード・合成・再生が動くこと。片方が未確認のままなら明記しリリース候補で確認すること | 両 OS の実機確認（ADR-012 の 2.7） |

## 6. Revisit triggers（見直す条件）

次のいずれかに当たるとき、この例外 ADR を見直す。

- Windows または Linux の実機 PoC、あるいは VRChat 併用時の確認で、5 秒開始期限や CPU・メモリの許容範囲を満たせなかったとき。
- speech.cpp に軽量な CPU 日本語 TTS または同等の体験を提供できる経路が入り、この例外の性能・体験上の優位性がなくなったとき。
- `voicevox_core`、`voicevox_onnxruntime`、`voicevox_vvm` の更新停止、ライセンスや利用規約の変更、深刻な脆弱性が見つかったとき。
- `voicevox_onnxruntime` の上位正式版（`1.23.x` 以降など）へ上げる判断をするとき、または Windows 向け DirectML オプションを追加するとき。
- 個別制限付きキャラクターを含む VVM（`6`・`7`・`15`・`16`・`17`・`18`・`20.vvm`）をカタログへ広げる判断をするとき。
- `voicevox_core` の `StreamingTalk` が実ストリーミング合成に対応し、ワーカーの IPC 契約や遅延目標を見直す価値が生じたとき。

## 7. 未決のこと

- **Windows・Linux 実機 PoC の結果と本実装の着手判断**: Issue #1061 で実測値を集めたうえで判断する。
- **ワーカー IPC の詳細契約**: リクエスト・応答・キャンセル・ヘルスチェックの形式は、本実装の設計時に `docs/spec/` へ仕様化する。
- **代表パック以外の VVM への拡張範囲と時期**: 制限付き 7 キャラクターの個別確認チェック UI とあわせて、代表パックの実装が固まってから判断する。
- **Windows 向け DirectML オプションの採否**: CPU 実機計測を見て後段で判断する。
- **英語など他言語との混在時のルーティング細部**: 既存の外部エンジン接続（ADR-008）との整合を含め、本実装時の仕様で定める。
