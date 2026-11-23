# NOTICE

## Optional voice integration in this fork

VRCT-VOX is an independent fork of VRCT. Original VRCT copyright and MIT
license notices are retained in `LICENSE`. The upstream chat-bubble model was
removed in 0.2.0 (see below); **fork binary distributions exclude all OCR
weights** while retaining their attribution documents.

The fork supports external engines and a fixed speech.cpp binary bundle with
separate third-party notices. Windows builds carry its Vulkan build; Linux builds
carry its CPU build and its Vulkan build of the same release side by side, each
with the same notices. RVC voice conversion is the fork's own
reimplementation (`native/rvc-runtime`, MIT), shipped as `astarot-rvc-worker`; its
Rust dependencies are listed with the app's (see "Rust crates in VRCT-VOX
builds" below). The ONNX Runtime the worker runs on (Microsoft's NuGet
packages), the NVIDIA CUDA and cuDNN libraries (NVIDIA's PyPI wheels) and the
HuBERT and RMVPE weights it uses are not bundled: the app fetches them from
their providers after the user's consent (see "RVC base models" below). Voice recordings and additional TTS/ASR/VC model weights are not
bundled. Mia2026 is validation-only. The Seed-VC integration
(`integrations/seed_vc/`, files marked GPL-3.0-only) was carried by builds up
to 0.4.x and left the repository with the Python backend in 0.6.0. Engine dependencies
and weights have their own licenses. See [voice licensing](docs/voice-stack/licensing.md) for component
boundaries, original sources, and unresolved binary distribution obligations.
Do not infer the complete stack's license from the main MIT license alone.

Upstream VRCT's `translator_engines` extension (Google, Bing and Papago web
translation) is licensed for official VRCT distributions only. VRCT-VOX does
not include it, so those web translators are not offered; DeepL and the LLM
providers remain, and from 0.5.0 the official Google Cloud Translation and
NAVER Papago APIs, used with the user's own key. The distribution policy rejects it in any build. For local
translation see "Downloadable CTranslate2 translation weights" below.

## Removed: VRCT's chat-bubble detection model

Commits up to VRCT-VOX 0.1.0 contain `src-python/models/ocr/onnx/chatbox_yolox_tiny.onnx`,
the chat-bubble detection model of upstream VRCT. It is not covered by the MIT
License: it is licensed under the VRCT Chat-Bubble Detection Model License
Agreement (Copyright (c) 2026 misyaguziya), whose text sits next to it in those
commits and in [upstream VRCT](https://github.com/misyaguziya/VRCT). That
agreement allows a fork to run the model while working on VRCT itself, and not
to ship it in a fork's own release.

VRCT-VOX never shipped or ran the model, and is no longer a fork that works on
VRCT, so the file was removed in 0.2.0. VRCT-VOX's own detector, trained
separately and published under MIT, is downloaded only with the user's consent
(see the OCR section below and `docs/ocr_model_license.md` for the background).

## Third-party OCR model weights (upstream VRCT; not in VRCT-VOX builds)

Upstream VRCT bundles these weights in its own builds. VRCT-VOX builds exclude
them, as stated above; the table is kept for attribution.

| Component | Version | License |
|---|---|---|
| YOLOX `yolox_tiny.pth` (COCO-pretrained base of the model above; not shipped, used only at training time) | 0.1.1rc0 | Apache-2.0 |
| RapidOCR (code and YAML config only; its bundled PP-OCR weights are stripped from builds) | 3.9.2 | Apache-2.0 |
| PaddleOCR PP-OCRv6 small det/rec and PP-OCRv5 mobile script recognisers (official ONNX exports by PaddlePaddle on Hugging Face; not shipped, downloaded only after the user agrees in Settings → Chat reading (OCR)) | pinned revisions in the model download catalog (`native/ops/src/downloads/catalog.rs`; up to 0.4.x `src-python/models/model_downloads/catalog.py`) | Apache-2.0 |

VRCT-VOX's own chat-bubble detector, `vrct_vox_chatbox_yolox_tiny.onnx`, is a
separate model: a YOLOX-Tiny trained from VRCT-VOX's own frames with
`tools/chatbox_lab` from Megvii's COCO weights (Apache-2.0), published under
MIT at [kein5/vrct-vox-chatbox-detector](https://huggingface.co/kein5/vrct-vox-chatbox-detector).
It is not derived from the upstream model or its outputs. It is not shipped either; it is downloaded only after the
user agrees in Settings → Chat reading (OCR) (catalog entry `vrct-vox-chatbox-detector`).

## Bundled Silero VAD model

The microphone and speaker transcription finds speech with the Silero VAD v5
model (MIT, Silero Team), as split into two ONNX graphs by faster-whisper (MIT,
SYSTRAN). Builds up to 0.4.x ship those two files (about 1.2 MB in all) and
their license texts in `licenses/silero-vad/`, which also lists their sizes,
SHA-256 and sources. From 0.5.0 the speech recognition runs in Rust, which does
not use these files, so the builds carry neither the files nor their texts. The
repository kept both until 0.6.0 removed them with the Python backend; the
0.4.x tags hold them. Voice activity detection on speech.cpp uses the Silero
VAD GGUF of the model download catalog, downloaded after consent.

## Outfit typeface (ASTAROT brand)

The ASTAROT wordmark in `docs/brand/astarot/` is outlined from Outfit Bold, and
the logos set their subtitle in Outfit. Outfit is licensed under the SIL Open
Font License 1.1, Copyright 2021 The Outfit Project Authors. VRCT-VOX will
bundle Outfit font files for the subtitle and other brand text; that is part
of the P1 UI work, and no build ships them yet. The license text and the
sources are in `licenses/outfit/`.

## shadcn/ui (component design)

The app's components are aligned with the components of
[shadcn/ui](https://github.com/shadcn-ui/ui) (`DESIGN.md`, "Components"):
their parts, `data-slot` names, sizes and state styles follow shadcn/ui's
Radix and native components, translated from Tailwind into vanilla-extract
and drawn in the ASTAROT colors. No shadcn/ui package is a dependency. The
first aligned components are the settings kit in `src-ui/views/kit/`.
shadcn/ui is licensed under the MIT License:

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Whisper weights from earlier versions

VRCT-VOX no longer uses or downloads Whisper weights. Local speech
recognition runs on speech.cpp, with models that are downloaded only after
consent from the model download catalog. Earlier versions downloaded Whisper
weights into `weights/whisper/` after checkbox consent. Those models derive
from [OpenAI Whisper](https://github.com/openai/whisper/blob/main/LICENSE)
(MIT); the pinned CTranslate2 conversions came from Systran (tiny through
large-v3), Zoont (large-v3-turbo-int8), and deepdml (large-v3-turbo). Files
left by those versions can be deleted in Settings → Speech recognition (ASR)
→ Old Whisper models.

## Downloadable speech recognition models (speech.cpp)

The speech recognition models are not shipped. Each file is downloaded from a
pinned Hugging Face revision only after the user agrees in Settings → Speech
recognition (ASR). The catalog offers every file that the bundled speech.cpp
lists for Qwen3-ASR 0.6B and 1.7B (Qwen, Apache-2.0), ReazonSpeech v2 (Reazon
Research, Apache-2.0), Parakeet TDT-CTC 0.6B ja and Parakeet TDT 0.6B v3
(NVIDIA, CC BY 4.0), Haas-ja v1.0 (Third Intelligence, Apache-2.0) and
Nemotron 3.5 Transcribe 30B-A4B (NVIDIA, OpenMDW-1.1), all converted to GGUF by
sakasegawa. `licenses/speechcpp-models/NOTICE.md` lists the sources, revisions
and the license review.

## Downloadable CTranslate2 translation weights

None of these weights ship with VRCT-VOX. Up to 0.4 the app downloaded the
selected one from Hugging Face into `weights/ctranslate2/`. Since 0.5.0 the
builds contain no CTranslate2: the app neither downloads nor reads these
weights, and removes those earlier versions downloaded after start-up. Local
translation now runs on ONNX Runtime (`native/translate-onnx`, see "Rust crates
in VRCT-VOX builds" below); its ONNX conversions of M2M100 418M and NLLB-200
distilled 600M and 1.3B are offered through the consented model catalog (see
that section). The setting keeps the values
in the table, which now select the ONNX conversion of the same model, and
Settings → Translation shows the license next to each model.

| Weight (setting value) | Downloaded from | Upstream model | License |
|---|---|---|---|
| `m2m100_418M-ct2-int8` (**default**) | `jncraton/m2m100_418M-ct2-int8` | `facebook/m2m100_418M` | MIT |
| `m2m100_1.2B-ct2-int8` | `jncraton/m2m100_1.2B-ct2-int8` | `facebook/m2m100_1.2B` | MIT |
| `nllb-200-distilled-600M-ct2-int8` | `JustFrederik/nllb-200-distilled-600M-ct2-int8` | `facebook/nllb-200-distilled-600M` | CC-BY-NC-4.0 (non-commercial) |
| `nllb-200-distilled-1.3B-ct2-int8` | `OpenNMT/nllb-200-distilled-1.3B-ct2-int8` | `facebook/nllb-200-distilled-1.3B` | CC-BY-NC-4.0 (non-commercial) |
| `nllb-200-3.3B-ct2-int8` | `OpenNMT/nllb-200-3.3B-ct2-int8` | `facebook/nllb-200-3.3B` | CC-BY-NC-4.0 (non-commercial) |

The next three paragraphs describe how 0.4.x and earlier downloaded these
weights; 0.5.0 and later do not download them.

Every built-in acquisition requires checkbox consent to the exact model and
manifest, including an already-selected NLLB model and its pinned
tokenizer files. The backend refuses download requests without that consent or with
an outdated manifest. NLLB-200 review always labels CC-BY-NC-4.0 as
non-commercial; selecting a different NLLB model also requires license
confirmation. Keeping an existing selection does not grant download consent.

CTranslate2 tokenizers derive from the upstream models in the table and carry
the same MIT or CC-BY-NC-4.0 terms. Acquisition now uses the tokenizer files
already included in the pinned CTranslate2 conversion repositories, with sizes
and SHA-256 in builtin_model_pins.py. The review total includes these files.
Inference reads only these verified local files; no separate upstream tokenizer
acquisition occurs. Existing Hub caches are retained but are not used for admission.
The changed acquisition manifest requires renewed consent before downloading.
No model files or new third-party dependencies are bundled by this change.

Consent is saved per model and manifest in `LEGACY_MODEL_DOWNLOAD_CONSENTS`.
Startup auto-acquisition requires a matching saved consent in addition to the
auto-download switch; legacy settings have no recorded consent. Existing
files and saved selections are preserved.

Earlier versions made `nllb-200-distilled-600M-ct2-int8` the default.
Configurations saved by those versions keep it, and the app shows a one-time
notice about its license.

This table and the OCR table above cover **model weights** only. Since 0.5.0
the builds contain no Python: the Python packages in `pyproject.toml` (resolved
in `uv.lock`) are used only by the development tools and the tests, and carry
their own licenses.
JavaScript dependencies are listed in `package.json`. Rust dependencies are
covered in the next section.

## Rust crates in VRCT-VOX builds

The application (`vrct-vox`) and the RVC worker (`astarot-rvc-worker`) are built
from Rust crates. Every build lists the crates compiled into these two
executables for its platform, with each crate's license, in
`_internal/licenses/rust/README.md` (`crates.json` holds the same list), and
carries the license texts each crate publishes in
`_internal/licenses/rust/<crate>-<version>/`. `tools/rust_licenses.py` makes
the list from the lock files (`src-tauri/Cargo.lock`,
`native/rvc-runtime/Cargo.lock`) when the package is built. The application
also contains the backend core and the crates it uses (`native/core`,
`native/adapters`, `native/app-identity`, `native/audio-routing`, `native/ops`, `native/speech-server`,
`native/translation`, `native/translate-onnx`, `native/tts`,
`native/voice-conversion`, `native/vr-overlay`, `native/openvr-client`,
`native/ocr-runtime`, `native/onnx-runtime`, `native/transcription`); they are VRCT-VOX's own
code under `LICENSE`, and the list marks them so.

`native/ocr-runtime` (chat reading) reimplements, so that its results match
the earlier Python implementation, the image operations of OpenCV 4.10.0
(Apache-2.0, OpenCV team), the pre- and post-processing of RapidOCR 3.9.2
(Apache-2.0, RapidAI) and the polygon offset of Clipper 6.4.2 as bundled by
pyclipper 1.4.0 (Boost Software License 1.0, Angus Johnson); it follows GEOS's
order of operations for two area and length formulas. No source file of these
projects is included. ONNX Runtime is not built into the application: chat
reading loads the library at run time. The packages ship the official CPU build
of ONNX Runtime 1.31.0 (MIT, Microsoft Corporation), taken from Microsoft's
NuGet package `Microsoft.ML.OnnxRuntime` 1.31.0, for it in
`_internal/onnxruntime`, with its license and third-party notices from the same
package in `_internal/licenses/onnxruntime` (`LICENSE`, `ThirdPartyNotices.txt`).

The VR overlay and chat reading's headset view load the OpenVR client library
at run time. The packages ship `libopenvr_api_64` of OpenVR SDK 2.12.14
(BSD-3-Clause, Valve Corporation), taken from the pyopenvr 2.12.1401 wheel
(BSD-3-Clause, Christopher Bruns) as builds up to 0.4.x did, in
`_internal/openvr`, with both license texts in `_internal/licenses/openvr`
(`LICENSE`, `pyopenvr-LICENSE`).

`native/translate-onnx` (local translation) is the fork's own code (MIT). It
uses `tokenizers` (Apache-2.0, Hugging Face) for SentencePiece segmentation and
loads the same ONNX Runtime library as chat reading at run time (the CPU build
above); the builds of ONNX Runtime with other execution providers (DirectML,
CUDA, OpenVINO, MIGraphX, WebGPU) are not bundled. For running translation on a
GPU the app offers two of them, fetched from their providers only after the
user's consent and kept in the settings folder (`vc_runtimes/`): the CUDA 13
build of ONNX Runtime 1.31.0 (MIT, Microsoft's NuGet package) with NVIDIA's
CUDA and cuDNN libraries (NVIDIA's PyPI wheels, under the CUDA EULA and the
cuDNN license), the same files as the RVC GPU runtime, where an NVIDIA driver
is found; and, on Windows, the DirectML build of ONNX Runtime 1.24.4 (MIT,
NuGet package `Microsoft.ML.OnnxRuntime.DirectML`) with DirectML 1.15.4 (NuGet
package `Microsoft.AI.DirectML`, under the Microsoft Software License Terms for
DirectML, which allow its use on Windows only and say it may send usage data to
Microsoft). The app loads one of them instead of the shipped CPU build at start
when the user chose its device for translation; chat reading then uses it too.
The RVC worker (`astarot-rvc-worker`) also loads the DirectML build, in its own
process, when it converts through DirectML.
No translation model is bundled: the int8 ONNX conversions of M2M100 418M
(MIT, the default; `kein5/m2m100_418M-onnx-int8`, with the MIT licence text in
`LICENSE`) and NLLB-200 distilled 600M and 1.3B (CC-BY-NC-4.0;
`kein5/nllb-200-distilled-600M-onnx-int8`,
`kein5/nllb-200-distilled-1.3B-onnx-int8`) are offered only through the
consented model catalog, pinned by revision, size and SHA-256 in
`native/ops/data/translation_models.json`, each with a model card that names
the source model, its authors (Meta AI) and the changes made. A model the user
adds to the translation catalog from a folder of their own is under its own
license, which the user is responsible for. A model under a non-commercial license, such as NLLB-200, is
never the default and downloads only after the user has also ticked a separate
acknowledgement that names its license and allows only non-commercial use; the
backend refuses the download without it. Selecting an NLLB-200 model keeps its
own license confirmation. The planned entries are recorded in
`docs/voice-stack/licensing.md`.

A decoder-only translation LLM such as TranslateGemma runs on llama.cpp's
`llama-server` (ADR-015), which is not bundled either. The app offers its
release b12125 from llama.cpp's GitHub releases (`ggml-org/llama.cpp`), a
Vulkan build and a CPU build for Windows and Linux on x86-64, fetched only
after the user's consent and pinned by size and SHA-256, and keeps the server
and the libraries it loads in the settings folder (`vc_runtimes/llamacpp-*`).
llama.cpp and ggml are under the MIT license (Copyright (c) 2023-2026 The ggml
authors; the Linux archives carry it as `LICENSE`). The Windows archives also
carry LLVM's OpenMP runtime (`libomp.dll`, Apache-2.0 WITH LLVM-exception, with
its license as `LICENSE-LLVM-OpenMP`). The server's libraries also contain
cpp-httplib (MIT) and nlohmann/json (MIT), and on Windows BoringSSL (Apache-2.0
and the OpenSSL and ISC licenses); their license texts are not in the archives.
On Linux the server uses the distribution's OpenSSL 3, `libgomp` and Vulkan
loader, which the app does not fetch. No model comes with it: the user adds a
GGUF file of their own and answers for its source and license. TranslateGemma
is under the Gemma Terms of Use and the Gemma Prohibited Use Policy, which
also bind the person who uses it; a catalog model under those terms downloads
only after a separate acknowledgement of them.

`native/transcription` (speech recognition) reimplements, so that phrases are
cut as before, the energy-based listening of SpeechRecognition 3.10.4
(BSD-3-Clause, Anthony Zhang) as the fork used by the earlier Python
implementation ran it, and `audioop`'s `rms` and `ratecv` of CPython
(PSF-2.0). No source file of these projects is included. It does not send
Google's web speech requests or carry that library's default key.

The crates are under permissive licenses (MIT, Apache-2.0, BSD, ISC, Zlib,
Unicode-3.0, CC0-1.0 and similar), except a few, such as `cssparser`,
`selectors` and `dwrote`, under the Mozilla Public License 2.0. VRCT-VOX does
not modify them. The source code of every listed crate, these included, is on
crates.io at the version listed (`https://crates.io/crates/<crate>/<version>`),
except `sudachi` (sudachi.rs, Apache-2.0, Works Applications), which is taken
from its GitHub repository at the commit of the tag v0.6.11
(`https://github.com/WorksApplications/sudachi.rs`). It embeds the
repository's settings and character definitions (`resources/`) under the same
license.

The application checks TLS certificates against Mozilla's root CA
certificates in the `webpki-roots` crate. That data is derived from the
[Common CA Database (CCADB)](https://www.ccadb.org/) and is used under the
[CCADB Data Usage Terms](https://www.ccadb.org/rootstores/usage#ccadb-data-usage-terms),
that is, the Community Data License Agreement – Permissive, Version 2.0
(CDLA-Permissive-2.0), whose text is in
`_internal/licenses/rust/webpki-roots-<version>/LICENSE`.

A few crates publish no license text in their package. For those, the texts
come from the crate's own repository or from the license's canonical text, as
recorded with their sources in
[`licenses/rust/supplements.json`](licenses/rust/supplements.json).

## SudachiDict (hiragana and romaji readings)

The readings shown with messages come from Sudachi (sudachi.rs, above) and a
SudachiDict system dictionary by Works Applications / the WAP Tokushima
Laboratory of AI and NLP, licensed under the Apache License 2.0. Parts of the
dictionary come from UniDic (Copyright (c) 2011-2013, The UniDic Consortium,
BSD-3-Clause) and from mecab-unidic-NEologd (Toshinori Sato, Apache-2.0). When
dictionary ships in `_internal/build/sudachi/` with the distribution's `LEGAL`
and `LICENSE-2.0.txt`, which carry these notices. Builds include the full
edition, which `tools/sudachi_dictionary.py` fetches from the official release
at a pinned version, size and SHA-256 (`docs/voice-stack/core-integration.md`,
item 3; issue #924).

## RVC base models

RVC voice conversion uses two base models that VRCT-VOX does not ship. After
the user agrees on the RVC runtime setup screen, the app fetches them from
[lj1995/VoiceConversionWebUI](https://huggingface.co/lj1995/VoiceConversionWebUI)
at a pinned revision and checks their sizes and SHA-256
([record](docs/voice-stack/rvc-base-artifacts.proposal.json)). That repository
marks them MIT.

| Model | Files | Upstream |
|---|---|---|
| HuBERT feature extractor (`hubert_base`) | `config.json`, `pytorch_model.bin` | [ContentVec](https://github.com/auspicious3000/contentvec) (MIT), built on [fairseq](https://github.com/facebookresearch/fairseq)'s HuBERT (MIT), as credited by [RVC](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) |
| RMVPE pitch extractor | `rmvpe.onnx` | [RMVPE](https://github.com/Dream-High/RMVPE) (Apache-2.0); weights trained by yxlllc and RVC-Boss |

## Windows installer download component

The Windows installer uses NScurl. Its retained notices for NScurl, Brotli,
curl, nghttp2, OpenSSL, zlib and Zstandard are embedded in the setup executable
under `$PLUGINSDIR/licenses/nscurl/` and can be read by extracting the installer
with 7-Zip, even if the application download fails. Both Windows application
ZIPs also include these texts in `_internal/licenses/nscurl/` (the `../nscurl/`
directory relative to the installed copy of this NOTICE).
The retained source copies are in
[`src-tauri/nsis/licenses/nscurl/`](src-tauri/nsis/licenses/nscurl/).

## LGPL and GPL components in VRCT-VOX builds

Since 0.5.0 the backend runs inside the application (`native/core`) and the
builds carry no frozen Python backend. The components below were in the frozen
backend of VRCT-VOX up to 0.4.x (`_internal` next to the `vrct-vox-sidecar`
executable) and are not in 0.5.0 and later builds. Each was a separate shared
library, Python extension module or Python source directory, so it could be
replaced with your own build of the same component and interface. Their license
texts were included under `_internal/licenses/python/` (Python packages) or
alongside the component.

| Component | Where in a 0.4.x build | License | Corresponding source |
|---|---|---|---|
| libsoxr, statically built into the `soxr` 1.1.0 extension module | `_internal/soxr/` | LGPL-2.1-or-later | [soxr 1.1.0 source distribution](https://pypi.org/project/soxr/1.1.0/#files) (contains libsoxr), [python-soxr](https://github.com/dofuuz/python-soxr) |
| FFmpeg libraries (libavcodec, libavformat, libavutil, libswresample, libswscale) shipped with `opencv-python-headless` 4.10.0.84 | Linux: `_internal/opencv_python_headless.libs/`; Windows: `_internal/cv2/opencv_videoio_ffmpeg*.dll` | LGPL-2.1-or-later | [FFmpeg](https://ffmpeg.org/download.html); build scripts and version in [opencv-python 84](https://github.com/opencv/opencv-python/tree/84) |
| libquadmath and libgfortran (GCC runtime) shipped with `opencv-python-headless` on Linux | `_internal/opencv_python_headless.libs/` | libquadmath: LGPL-2.1-or-later; libgfortran: GPL-3.0-or-later with the GCC Runtime Library Exception 3.1 | [GCC](https://gcc.gnu.org/) |
| `zeroconf` 0.152.0 (Python) | `_internal/zeroconf/` (source files, outside the PYZ archive) | LGPL-2.1-or-later | [zeroconf 0.152.0 source distribution](https://files.pythonhosted.org/packages/15/d2/7fa1e89251245a7135f13a653ccf0c8db46ab4ce1877007285b9da7e8865/zeroconf-0.152.0.tar.gz) |
| Seed-VC Realtime integration (Python source and its loader patch, run by an external worker) | Linux: `_internal/integrations/seed_vc/`; Windows: `_internal/voice_worker/integrations/seed_vc/` | GPL-3.0-only (license text included) | The files themselves; [seed-vc-realtime](https://github.com/jiaheguo521/seed-vc-realtime) |
| PyInstaller bootloader | `vrct-vox-sidecar` | GPL-2.0-or-later with the PyInstaller bootloader exception | [PyInstaller 6.10.0](https://pypi.org/project/pyinstaller/6.10.0/#files) |

On request through this repository's Issues, we will provide a copy of the
corresponding source code of the LGPL and GPL components above, as used in a
given release, for at least three years after that release.

PyAV was deliberately **not** included in any build: its binary wheels bundle
FFmpeg together with the GPL-licensed x264 and x265 encoders. The distribution
policy (`tools/distribution_policy.py`) still rejects PyAV libraries and
x264/x265 in any build.

---

# NOTICE（日本語版）

この日本語版は、上の英語版を参考のために訳したものです。英語版が正文で、内容が食い違うときは英語版に従います。

## このフォークの任意の音声連携

VRCT-VOXは、VRCTから独立したフォークです。元のVRCTの著作権表示とMITライセンスの表示は、`LICENSE`に残しています。上流のチャットの吹き出しのモデルは0.2.0で削除しました（下を参照）。**フォークのバイナリの配布物にはOCRの重みを一切入れません**が、その帰属表示の文書は残しています。

このフォークは、外部のエンジンと、版を固定したspeech.cppのバイナリ一式に対応しています。この一式には、別に第三者の表示が付いています。WindowsのビルドにはそのうちのVulkanのビルドを、Linuxのビルドには同じリリースのCPUのビルドとVulkanのビルドを並べて入れていて、どちらにも同じ表示が付いています。RVCの声質変換はこのフォーク自身の再実装（`native/rvc-runtime`、MIT）で、`astarot-rvc-worker`として配布します。そのRustの依存は、アプリの依存と一緒に一覧にしています（下の「VRCT-VOXのビルドに入るRustのクレート」を参照）。ワーカーが動く土台のONNX Runtime（MicrosoftのNuGetのパッケージ）、NVIDIAのCUDAとcuDNNのライブラリ（NVIDIAのPyPIのwheel）、ワーカーが使うHuBERTとRMVPEの重みは同梱しません。アプリは、利用者の同意を得たあとで、それぞれの提供元から取得します（下の「RVCのベースモデル」を参照）。音声の録音と、追加のTTS、ASR、VCのモデルの重みは同梱しません。Mia2026は検証にだけ使います。Seed-VCの連携（`integrations/seed_vc/`。ファイルにGPL-3.0-onlyと記してあります）は0.4.xまでのビルドに入っていて、0.6.0でPythonのバックエンドと一緒にリポジトリからなくなりました。エンジンの依存と重みには、それぞれのライセンスがあります。部品の境界、元の出どころ、解決していないバイナリの配布の義務は、[音声のライセンス](docs/voice-stack/licensing.md)を参照してください。主のMITライセンスだけを見て、全体のライセンスを判断しないでください。

上流VRCTの`translator_engines`の拡張（Google、Bing、PapagoのWeb翻訳）は、VRCTの公式の配布物にだけ許諾されています。VRCT-VOXはこの拡張を含まないので、これらのWeb翻訳は提供しません。DeepLとLLMのプロバイダーは残っていて、0.5.0からは、利用者自身のキーで使う公式のGoogle Cloud TranslationとNAVER PapagoのAPIもあります。配布の方針は、どのビルドでもこの拡張を拒否します。ローカルの翻訳は、下の「ダウンロードできるCTranslate2の翻訳の重み」を参照してください。

## 削除したもの：VRCTのチャットの吹き出しの検出モデル

VRCT-VOX 0.1.0までのコミットには、上流VRCTのチャットの吹き出しの検出モデル`src-python/models/ocr/onnx/chatbox_yolox_tiny.onnx`が入っています。このモデルはMITライセンスの対象ではありません。VRCT Chat-Bubble Detection Model License Agreement（Copyright (c) 2026 misyaguziya）で許諾されていて、その条文はそれらのコミットでファイルの隣にあり、[上流のVRCT](https://github.com/misyaguziya/VRCT)にもあります。この許諾は、フォークがVRCTそのものの作業をしている間にモデルを動かすことを認めますが、フォーク自身のリリースに入れて配ることは認めていません。

VRCT-VOXはこのモデルを配ったことも動かしたこともなく、VRCTの作業をするフォークでもなくなったので、0.2.0でこのファイルを削除しました。VRCT-VOX自身の検出モデルは、別に学習してMITで公開したもので、利用者の同意を得たときだけダウンロードします（下のOCRの節と、経緯は`docs/ocr_model_license.md`を参照）。

## 第三者のOCRのモデルの重み（上流VRCTのもの。VRCT-VOXのビルドには入らない）

上流VRCTは、自身のビルドにこれらの重みを同梱しています。上で書いたとおり、VRCT-VOXのビルドはこれらを除いています。表は帰属表示のために残しています。

| 部品 | 版 | ライセンス |
|---|---|---|
| YOLOX `yolox_tiny.pth`（上のモデルの、COCOで事前学習したベース。配布せず、学習のときにだけ使う） | 0.1.1rc0 | Apache-2.0 |
| RapidOCR（コードとYAMLの設定だけ。同梱のPP-OCRの重みはビルドから除く） | 3.9.2 | Apache-2.0 |
| PaddleOCRのPP-OCRv6 smallの検出と認識、PP-OCRv5 mobileの文字体系ごとの認識（PaddlePaddleがHugging Faceで公開した公式のONNXの書き出し。配布せず、利用者が「設定」の「チャット読み取り（OCR）」で同意したあとにだけダウンロードする） | モデルの取得のカタログで固定したリビジョン（`native/ops/src/downloads/catalog.rs`。0.4.xまでは`src-python/models/model_downloads/catalog.py`） | Apache-2.0 |

VRCT-VOX自身のチャットの吹き出しの検出モデル`vrct_vox_chatbox_yolox_tiny.onnx`は、別のモデルです。VRCT-VOX自身の画面のフレームから、MegviiのCOCOの重み（Apache-2.0）をもとに`tools/chatbox_lab`で学習したYOLOX-Tinyで、[kein5/vrct-vox-chatbox-detector](https://huggingface.co/kein5/vrct-vox-chatbox-detector)でMITのもとに公開しています。上流のモデルやその出力から派生したものではありません。これも配布せず、利用者が「設定」の「チャット読み取り（OCR）」で同意したあとにだけダウンロードします（カタログの項目`vrct-vox-chatbox-detector`）。

## 同梱のSilero VADのモデル

マイクとスピーカーの音声認識は、Silero VAD v5のモデル（MIT、Silero Team）で発話を見つけます。使うのは、faster-whisper（MIT、SYSTRAN）が2つのONNXのグラフに分けたものです。0.4.xまでのビルドは、この2つのファイル（合わせて約1.2 MB）とそのライセンスの文を`licenses/silero-vad/`に入れていて、そこにはファイルの大きさ、SHA-256、出どころも載せています。0.5.0からは音声認識がRustで動き、これらのファイルを使わないので、ビルドにはファイルもライセンスの文も入っていません。リポジトリは、0.6.0でPythonのバックエンドと一緒に削除するまで両方を持っていました。0.4.xのタグにはあります。speech.cppでの発話の区間の検出（VAD）は、モデルの取得のカタログにあるSilero VADのGGUFを使い、同意を得たあとにダウンロードします。

## Outfitの書体（ASTAROTのブランド）

`docs/brand/astarot/`にあるASTAROTのワードマークはOutfit Boldをアウトラインにしたもので、ロゴのサブタイトルはOutfitで組んでいます。OutfitはSIL Open Font License 1.1で許諾されています（Copyright 2021 The Outfit Project Authors）。VRCT-VOXは、サブタイトルとほかのブランドの文字のために、Outfitのフォントのファイルを同梱する予定です。これはP1のUIの作業の一部で、まだどのビルドにも入っていません。ライセンスの文と出どころは`licenses/outfit/`にあります。

## shadcn/ui（部品のデザイン）

アプリの部品は、[shadcn/ui](https://github.com/shadcn-ui/ui)の部品にそろえています（`DESIGN.md`の「Components」）。部品の構成、`data-slot`の名前、大きさ、状態ごとのスタイルはshadcn/uiのRadixの部品とネイティブの部品にならい、Tailwindからvanilla-extractに書き換えて、ASTAROTの色で描いています。shadcn/uiのパッケージは依存に入れていません。最初にそろえた部品は、`src-ui/views/kit/`の設定のキットです。shadcn/uiはMITライセンスで許諾されています。許諾の文は次のとおりです（原文のまま載せます）。

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 以前の版のWhisperの重み

VRCT-VOXは、Whisperの重みをもう使わず、ダウンロードもしません。ローカルの音声認識はspeech.cppで動き、モデルはモデルの取得のカタログから、同意を得たあとにだけダウンロードします。以前の版は、チェックボックスでの同意のあとに、Whisperの重みを`weights/whisper/`へダウンロードしていました。それらのモデルは[OpenAI Whisper](https://github.com/openai/whisper/blob/main/LICENSE)（MIT）から派生したもので、固定したCTranslate2への変換は、Systran（tinyからlarge-v3まで）、Zoont（large-v3-turbo-int8）、deepdml（large-v3-turbo）のものでした。それらの版が残したファイルは、「設定」の「音声認識（ASR）」の「古いWhisperのモデル」で削除できます。

## ダウンロードできる音声認識のモデル（speech.cpp）

音声認識のモデルは配布しません。各ファイルは、利用者が「設定」の「音声認識（ASR）」で同意したあとにだけ、固定したHugging Faceのリビジョンからダウンロードします。カタログには、同梱のspeech.cppが挙げる次のモデルのファイルがすべてあります。どれもsakasegawaがGGUFに変換したものです。

- Qwen3-ASR 0.6Bと1.7B（Qwen、Apache-2.0）
- ReazonSpeech v2（Reazon Research、Apache-2.0）
- Parakeet TDT-CTC 0.6B jaとParakeet TDT 0.6B v3（NVIDIA、CC BY 4.0）
- Haas-ja v1.0（Third Intelligence、Apache-2.0）
- Nemotron 3.5 Transcribe 30B-A4B（NVIDIA、OpenMDW-1.1）

出どころ、リビジョン、ライセンスの確認は`licenses/speechcpp-models/NOTICE.md`にあります。

## ダウンロードできるCTranslate2の翻訳の重み

これらの重みは、どれもVRCT-VOXに同梱していません。0.4までは、選んだ重みをアプリがHugging Faceから`weights/ctranslate2/`へダウンロードしていました。0.5.0からはビルドにCTranslate2が入っていません。アプリはこれらの重みをダウンロードも読み込みもせず、以前の版がダウンロードしたものを、起動したあとに削除します。ローカルの翻訳はいまONNX Runtimeで動きます（`native/translate-onnx`。下の「VRCT-VOXのビルドに入るRustのクレート」を参照）。M2M100 418MとNLLB-200 distilled 600Mと1.3BのONNXへの変換は、同意を得てから取得するモデルのカタログで提供します（その節を参照）。設定は表の値を保っていて、その値はいま同じモデルのONNXへの変換を選びます。「設定」の「翻訳」は、各モデルの隣にライセンスを示します。

| 重み（設定の値） | ダウンロード元 | 元のモデル | ライセンス |
|---|---|---|---|
| `m2m100_418M-ct2-int8`（**既定**） | `jncraton/m2m100_418M-ct2-int8` | `facebook/m2m100_418M` | MIT |
| `m2m100_1.2B-ct2-int8` | `jncraton/m2m100_1.2B-ct2-int8` | `facebook/m2m100_1.2B` | MIT |
| `nllb-200-distilled-600M-ct2-int8` | `JustFrederik/nllb-200-distilled-600M-ct2-int8` | `facebook/nllb-200-distilled-600M` | CC-BY-NC-4.0（非商用） |
| `nllb-200-distilled-1.3B-ct2-int8` | `OpenNMT/nllb-200-distilled-1.3B-ct2-int8` | `facebook/nllb-200-distilled-1.3B` | CC-BY-NC-4.0（非商用） |
| `nllb-200-3.3B-ct2-int8` | `OpenNMT/nllb-200-3.3B-ct2-int8` | `facebook/nllb-200-3.3B` | CC-BY-NC-4.0（非商用） |

次の3つの段落は、0.4.x以前の版がこれらの重みをどうダウンロードしていたかを書いたものです。0.5.0以降はダウンロードしません。

組み込みの取得はどれも、そのモデルとマニフェストそのものへの、チェックボックスでの同意が要ります。すでに選んでいるNLLBのモデルと、その固定したtokenizerのファイルも同じです。バックエンドは、その同意がない要求と、マニフェストが古い要求を拒否します。NLLB-200の確認では、CC-BY-NC-4.0をいつも非商用と示します。別のNLLBのモデルを選ぶときも、ライセンスの確認が要ります。いまの選択を保っても、ダウンロードへの同意にはなりません。

CTranslate2のtokenizerは表の元のモデルから派生していて、同じMITまたはCC-BY-NC-4.0の条件に従います。取得では、固定したCTranslate2の変換のリポジトリにすでに入っているtokenizerのファイルを使い、その大きさとSHA-256はbuiltin_model_pins.pyにあります。確認の画面の合計には、これらのファイルも入ります。推論は、確かめたこれらのローカルのファイルだけを読み、上流のtokenizerを別に取得することはありません。既存のHubのキャッシュは残しますが、受け入れには使いません。取得のマニフェストが変わったので、ダウンロードの前に同意をもう一度得ます。この変更で、モデルのファイルや新しい第三者の依存を同梱することはありません。

同意は、モデルとマニフェストごとに`LEGACY_MODEL_DOWNLOAD_CONSENTS`に保存します。起動時の自動の取得には、自動のダウンロードのスイッチに加えて、一致する保存済みの同意が要ります。以前の設定には、記録した同意がありません。既存のファイルと保存した選択は保ちます。

以前の版は`nllb-200-distilled-600M-ct2-int8`を既定にしていました。それらの版が保存した設定はこれを保ち、アプリはそのライセンスについて1回だけお知らせを出します。

この表と上のOCRの表が扱うのは、**モデルの重み**だけです。0.5.0からはビルドにPythonが入っていません。`pyproject.toml`のPythonのパッケージ（`uv.lock`で解決したもの）は開発の道具と試験だけが使い、それぞれのライセンスに従います。JavaScriptの依存は`package.json`に挙げています。Rustの依存は次の節で扱います。

## VRCT-VOXのビルドに入るRustのクレート

アプリ（`vrct-vox`）とRVCのワーカー（`astarot-rvc-worker`）は、Rustのクレートから作ります。どのビルドも、その環境向けにこの2つの実行ファイルに組み込んだクレートを、各クレートのライセンスと一緒に`_internal/licenses/rust/README.md`に挙げ（`crates.json`も同じ一覧を持ちます）、各クレートが公開するライセンスの文を`_internal/licenses/rust/<crate>-<version>/`に入れています。`tools/rust_licenses.py`が、パッケージを作るときにロックファイル（`src-tauri/Cargo.lock`、`native/rvc-runtime/Cargo.lock`）から一覧を作ります。アプリには、バックエンドの中核と、中核が使うクレート（`native/core`、`native/adapters`、`native/app-identity`、`native/audio-routing`、`native/ops`、`native/speech-server`、`native/translation`、`native/translate-onnx`、`native/tts`、`native/voice-conversion`、`native/vr-overlay`、`native/openvr-client`、`native/ocr-runtime`、`native/onnx-runtime`、`native/transcription`）も入っています。これらは`LICENSE`に従うVRCT-VOX自身のコードで、一覧にもそう示しています。

`native/ocr-runtime`（チャット読み取り）は、以前のPythonの実装と結果が一致するように、次の処理を書き直したものです。面積と長さの2つの式では、GEOSの計算の順序に従います。これらのプロジェクトのソースファイルは含みません。

- OpenCV 4.10.0（Apache-2.0、OpenCV team）の画像の処理
- RapidOCR 3.9.2（Apache-2.0、RapidAI）の前処理と後処理
- pyclipper 1.4.0が同梱するClipper 6.4.2（Boost Software License 1.0、Angus Johnson）の多角形のオフセット

ONNX Runtimeはアプリに組み込んでいません。チャット読み取りが実行時にライブラリを読み込みます。パッケージは、そのためにONNX Runtime 1.31.0の公式のCPUのビルド（MIT、Microsoft Corporation）を`_internal/onnxruntime`に入れています。これはMicrosoftのNuGetのパッケージ`Microsoft.ML.OnnxRuntime` 1.31.0から取ったもので、同じパッケージのライセンスと第三者の表示を`_internal/licenses/onnxruntime`（`LICENSE`、`ThirdPartyNotices.txt`）に入れています。

VRのオーバーレイと、チャット読み取りのヘッドセットの表示の読み取りは、実行時にOpenVRのクライアントのライブラリを読み込みます。パッケージは、OpenVR SDK 2.12.14（BSD-3-Clause、Valve Corporation）の`libopenvr_api_64`を`_internal/openvr`に入れています。0.4.xまでのビルドと同じく、pyopenvr 2.12.1401のwheel（BSD-3-Clause、Christopher Bruns）から取ったもので、両方のライセンスの文を`_internal/licenses/openvr`（`LICENSE`、`pyopenvr-LICENSE`）に入れています。

`native/translate-onnx`（ローカルの翻訳）は、このフォーク自身のコード（MIT）です。SentencePieceの分割に`tokenizers`（Apache-2.0、Hugging Face）を使い、実行時にチャット読み取りと同じONNX Runtimeのライブラリ（上のCPUのビルド）を読み込みます。ほかの実行プロバイダー（DirectML、CUDA、OpenVINO、MIGraphX、WebGPU）を持つONNX Runtimeのビルドは同梱しません。GPUで翻訳するために、アプリはそのうちの2つを提供します。どちらも利用者の同意を得たあとにだけ提供元から取得し、設定のフォルダー（`vc_runtimes/`）に置きます。

- NVIDIAのドライバーが見つかるときは、ONNX Runtime 1.31.0のCUDA 13のビルド（MIT、MicrosoftのNuGetのパッケージ）と、NVIDIAのCUDAとcuDNNのライブラリ（NVIDIAのPyPIのwheel。CUDA EULAとcuDNNのライセンスに従う）です。RVCのGPUの実行環境と同じファイルです。
- Windowsでは、ONNX Runtime 1.24.4のDirectMLのビルド（MIT、NuGetのパッケージ`Microsoft.ML.OnnxRuntime.DirectML`）と、DirectML 1.15.4（NuGetのパッケージ`Microsoft.AI.DirectML`）です。DirectMLはMicrosoft Software License Terms for DirectMLに従います。この条件はWindowsでだけ使うことを認め、DirectMLがMicrosoftへ利用のデータを送ることがあると書いています。

利用者が翻訳の機器にそのどちらかを選んだときは、アプリは起動時に、同梱のCPUのビルドの代わりにそれを読み込みます。そのときはチャット読み取りもそれを使います。RVCのワーカー（`astarot-rvc-worker`）も、DirectMLで変換するときは、自分のプロセスでDirectMLのビルドを読み込みます。

翻訳のモデルは同梱しません。次の変換は、同意を得てから取得するモデルのカタログでだけ提供し、`native/ops/data/translation_models.json`でリビジョン、大きさ、SHA-256を固定しています。どれにも、元のモデル、その作者（Meta AI）、加えた変更を書いたモデルカードが付いています。

- M2M100 418Mのint8のONNXへの変換（MIT、既定。`kein5/m2m100_418M-onnx-int8`。MITのライセンスの文は`LICENSE`にあります）
- NLLB-200 distilled 600Mと1.3Bのint8のONNXへの変換（CC-BY-NC-4.0。`kein5/nllb-200-distilled-600M-onnx-int8`、`kein5/nllb-200-distilled-1.3B-onnx-int8`）

利用者が自分のフォルダーから翻訳のカタログに足したモデルは、そのモデル自身のライセンスに従い、その責任は利用者にあります。NLLB-200のような非商用のライセンスのモデルは、既定にしません。そのライセンスを示して非商用の利用だけを認める別の確認にも利用者がチェックを入れたあとでだけダウンロードし、その確認がなければバックエンドはダウンロードを拒否します。NLLB-200のモデルを選ぶときの、そのモデルのライセンスの確認も残ります。予定している項目は`docs/voice-stack/licensing.md`に記録しています。

TranslateGemmaのような、デコーダーだけで作った翻訳のLLMは、llama.cppの`llama-server`で動きます（ADR-015）。`llama-server`も同梱しません。アプリは、llama.cppのGitHubのリリース（`ggml-org/llama.cpp`）からリリースb12125を提供します。x86-64のWindowsとLinux向けのVulkanのビルドとCPUのビルドで、利用者の同意を得たあとにだけ取得し、大きさとSHA-256で固定しています。サーバーと、サーバーが読み込むライブラリは、設定のフォルダー（`vc_runtimes/llamacpp-*`）に置きます。llama.cppとggmlはMITライセンスに従います（Copyright (c) 2023-2026 The ggml authors。Linuxのアーカイブは`LICENSE`として持っています）。Windowsのアーカイブは、LLVMのOpenMPの実行時ライブラリ（`libomp.dll`、Apache-2.0 WITH LLVM-exception。ライセンスは`LICENSE-LLVM-OpenMP`）も持っています。サーバーのライブラリには、cpp-httplib（MIT）とnlohmann/json（MIT）も入っていて、WindowsではBoringSSL（Apache-2.0と、OpenSSLとISCのライセンス）も入っています。これらのライセンスの文は、アーカイブに入っていません。Linuxでは、サーバーはディストリビューションのOpenSSL 3、`libgomp`、Vulkanのローダーを使い、アプリはこれらを取得しません。サーバーにモデルは付いていません。利用者が自分のGGUFのファイルを足し、その出どころとライセンスに責任を持ちます。TranslateGemmaはGemma Terms of UseとGemma Prohibited Use Policyに従い、この2つは使う人も拘束します。これらの条件に従うカタログのモデルは、それらへの別の確認のあとにだけダウンロードします。

`native/transcription`（音声認識）は、発話を以前と同じように区切るために、次の処理を書き直したものです。これらのプロジェクトのソースファイルは含みません。GoogleのWebの音声認識の要求は送らず、そのライブラリの既定のキーも持ちません。

- SpeechRecognition 3.10.4（BSD-3-Clause、Anthony Zhang）の、音の大きさによる聞き取り。以前のPythonの実装が使ったフォークが動かしていた形です。
- CPython（PSF-2.0）の`audioop`の`rms`と`ratecv`

クレートは寛容なライセンス（MIT、Apache-2.0、BSD、ISC、Zlib、Unicode-3.0、CC0-1.0など）に従います。ただし、`cssparser`、`selectors`、`dwrote`のようないくつかは、Mozilla Public License 2.0に従います。VRCT-VOXはこれらを変更していません。これらを含め、一覧のすべてのクレートのソースコードは、挙げた版でcrates.ioにあります（`https://crates.io/crates/<crate>/<version>`）。ただし`sudachi`（sudachi.rs、Apache-2.0、Works Applications）は、GitHubのリポジトリから、タグv0.6.11のコミットで取っています（`https://github.com/WorksApplications/sudachi.rs`）。このクレートは、リポジトリの設定と文字の定義（`resources/`）を同じライセンスのもとで組み込んでいます。

アプリは、`webpki-roots`のクレートにあるMozillaのルートCAの証明書で、TLSの証明書を確かめます。そのデータは[Common CA Database (CCADB)](https://www.ccadb.org/)から派生したもので、[CCADB Data Usage Terms](https://www.ccadb.org/rootstores/usage#ccadb-data-usage-terms)、つまりCommunity Data License Agreement – Permissive, Version 2.0（CDLA-Permissive-2.0）のもとで使っています。その文は`_internal/licenses/rust/webpki-roots-<version>/LICENSE`にあります。

いくつかのクレートは、パッケージにライセンスの文を入れていません。それらの文は、クレート自身のリポジトリか、ライセンスの正式な文から取っていて、その出どころは[`licenses/rust/supplements.json`](licenses/rust/supplements.json)に記録しています。

## SudachiDict（ひらがなとローマ字の読み）

メッセージと一緒に示す読みは、Sudachi（上のsudachi.rs）と、Works Applicationsとワークス徳島人工知能NLP研究所によるSudachiDictのシステム辞書から作ります。辞書はApache License 2.0で許諾されています。辞書の一部は、UniDic（Copyright (c) 2011-2013, The UniDic Consortium、BSD-3-Clause）とmecab-unidic-NEologd（Toshinori Sato、Apache-2.0）から来ています。辞書は、これらの表示を載せた配布物の`LEGAL`と`LICENSE-2.0.txt`と一緒に、`_internal/build/sudachi/`に入っています。ビルドにはfull版を入れていて、`tools/sudachi_dictionary.py`が公式のリリースから、固定した版、大きさ、SHA-256で取得します（`docs/voice-stack/core-integration.md`の3、Issue #924）。

## RVCのベースモデル

RVCの声質変換は、VRCT-VOXが配布しない2つのベースモデルを使います。利用者がRVCの実行環境の準備の画面で同意したあと、アプリはそれらを[lj1995/VoiceConversionWebUI](https://huggingface.co/lj1995/VoiceConversionWebUI)から固定したリビジョンで取得し、大きさとSHA-256を確かめます（[記録](docs/voice-stack/rvc-base-artifacts.proposal.json)）。そのリポジトリは、これらをMITとしています。

| モデル | ファイル | 元 |
|---|---|---|
| HuBERTの特徴の抽出（`hubert_base`） | `config.json`、`pytorch_model.bin` | [ContentVec](https://github.com/auspicious3000/contentvec)（MIT）。[fairseq](https://github.com/facebookresearch/fairseq)のHuBERT（MIT）をもとにしたもので、[RVC](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)がそう記しています |
| RMVPEの音の高さの抽出 | `rmvpe.onnx` | [RMVPE](https://github.com/Dream-High/RMVPE)（Apache-2.0）。重みはyxlllcとRVC-Bossが学習したもの |

## Windowsのインストーラーのダウンロードの部品

Windowsのインストーラーは、NScurlを使います。NScurl、Brotli、curl、nghttp2、OpenSSL、zlib、Zstandardについて残している表示は、セットアップの実行ファイルの`$PLUGINSDIR/licenses/nscurl/`に埋め込んであります。アプリのダウンロードに失敗しても、7-Zipでインストーラーを展開すれば読めます。Windowsのアプリの2つのZIPにも、これらの文が`_internal/licenses/nscurl/`（インストールしたこのNOTICEの写しから見て`../nscurl/`のディレクトリ）に入っています。残しているソースの写しは[`src-tauri/nsis/licenses/nscurl/`](src-tauri/nsis/licenses/nscurl/)にあります。

## VRCT-VOXのビルドに入るLGPLとGPLの部品

0.5.0からバックエンドはアプリの中（`native/core`）で動き、ビルドには固めたPythonのバックエンドが入っていません。下の部品は、0.4.xまでのVRCT-VOXの固めたバックエンド（`vrct-vox-sidecar`の実行ファイルの隣の`_internal`）に入っていて、0.5.0以降のビルドには入っていません。どれも独立した共有ライブラリ、Pythonの拡張モジュール、Pythonのソースのディレクトリだったので、同じ部品とインターフェースを持つ自分のビルドに置き換えられました。ライセンスの文は、`_internal/licenses/python/`（Pythonのパッケージ）か、部品の隣に入れていました。

| 部品 | 0.4.xのビルドでの場所 | ライセンス | 対応するソース |
|---|---|---|---|
| `soxr` 1.1.0の拡張モジュールに静的に組み込んだlibsoxr | `_internal/soxr/` | LGPL-2.1-or-later | [soxr 1.1.0のソースの配布物](https://pypi.org/project/soxr/1.1.0/#files)（libsoxrを含む）、[python-soxr](https://github.com/dofuuz/python-soxr) |
| `opencv-python-headless` 4.10.0.84に付いてくるFFmpegのライブラリ（libavcodec、libavformat、libavutil、libswresample、libswscale） | Linuxは`_internal/opencv_python_headless.libs/`、Windowsは`_internal/cv2/opencv_videoio_ffmpeg*.dll` | LGPL-2.1-or-later | [FFmpeg](https://ffmpeg.org/download.html)。ビルドのスクリプトと版は[opencv-python 84](https://github.com/opencv/opencv-python/tree/84)にあります |
| Linuxで`opencv-python-headless`に付いてくるlibquadmathとlibgfortran（GCCの実行時ライブラリ） | `_internal/opencv_python_headless.libs/` | libquadmathはLGPL-2.1-or-later、libgfortranはGPL-3.0-or-laterにGCC Runtime Library Exception 3.1を付けたもの | [GCC](https://gcc.gnu.org/) |
| `zeroconf` 0.152.0（Python） | `_internal/zeroconf/`（ソースのファイル。PYZのアーカイブの外） | LGPL-2.1-or-later | [zeroconf 0.152.0のソースの配布物](https://files.pythonhosted.org/packages/15/d2/7fa1e89251245a7135f13a653ccf0c8db46ab4ce1877007285b9da7e8865/zeroconf-0.152.0.tar.gz) |
| Seed-VC Realtimeの連携（Pythonのソースと、その読み込みのパッチ。外部のワーカーが動かす） | Linuxは`_internal/integrations/seed_vc/`、Windowsは`_internal/voice_worker/integrations/seed_vc/` | GPL-3.0-only（ライセンスの文を同梱） | ファイルそのもの。[seed-vc-realtime](https://github.com/jiaheguo521/seed-vc-realtime) |
| PyInstallerのブートローダー | `vrct-vox-sidecar` | GPL-2.0-or-laterにPyInstallerのブートローダーの例外を付けたもの | [PyInstaller 6.10.0](https://pypi.org/project/pyinstaller/6.10.0/#files) |

このリポジトリのIssuesで依頼があれば、上のLGPLとGPLの部品について、あるリリースで使ったものに対応するソースコードの写しを、そのリリースから少なくとも3年間提供します。

PyAVは、意図して**どのビルドにも入れていません**。PyAVのバイナリのwheelは、GPLのx264とx265のエンコーダーと一緒にFFmpegを同梱しているからです。配布の方針（`tools/distribution_policy.py`）は、今もどのビルドでもPyAVのライブラリとx264、x265を拒否します。
