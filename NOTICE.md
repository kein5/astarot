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
reimplementation (`native/rvc-runtime`, MIT), shipped as `vrct-rvc-worker`; its
Rust dependencies are listed with the app's (see "Rust crates in VRCT-VOX
builds" below). ONNX Runtime,
the NVIDIA CUDA and cuDNN libraries and the HuBERT and RMVPE weights it uses are
not bundled: the app fetches them from their providers after the user's
consent (see "RVC base models" below). Voice recordings and additional TTS/ASR/VC model weights are not
bundled. Mia2026 is validation-only. The Seed-VC integration kept in the
repository (`integrations/seed_vc/`) contains files marked GPL-3.0-only; builds
up to 0.4.x carried it, and 0.5.0 and later builds do not. Engine dependencies
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
SHA-256 and sources. From 0.5.0 the speech recognition runs in Rust, which cuts
phrases by energy and does not use this model, so the builds carry neither the
files nor their texts; both remain in the repository
(`src-python/models/transcription/silero_vad/`, `licenses/silero-vad/`).

## Outfit typeface (ASTAROT brand)

The ASTAROT wordmark in `docs/brand/astarot/` is outlined from Outfit Bold, and
the logos set their subtitle in Outfit. Outfit is licensed under the SIL Open
Font License 1.1, Copyright 2021 The Outfit Project Authors. VRCT-VOX will
bundle Outfit font files for the subtitle and other brand text; that is part
of the P1 UI work, and no build ships them yet. The license text and the
sources are in `licenses/outfit/`.

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
in VRCT-VOX builds" below); the models for it are not published yet
(`docs/voice-stack/core-integration.md`, item 1). The setting keeps the values
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
in `uv.lock`) are used only by the development tools, the tests and the Python
backend source kept in the repository, and carry their own licenses.
JavaScript dependencies are listed in `package.json`. Rust dependencies are
covered in the next section.

## Rust crates in VRCT-VOX builds

The application (`vrct-vox`) and the RVC worker (`vrct-rvc-worker`) are built
from Rust crates. Every build lists the crates compiled into these two
executables for its platform, with each crate's license, in
`_internal/licenses/rust/README.md` (`crates.json` holds the same list), and
carries the license texts each crate publishes in
`_internal/licenses/rust/<crate>-<version>/`. `tools/rust_licenses.py` makes
the list from the lock files (`src-tauri/Cargo.lock`,
`native/rvc-runtime/Cargo.lock`) when the package is built. The application
also contains the backend core and the crates it uses (`native/core`,
`native/adapters`, `native/audio-routing`, `native/ops`, `native/speech-server`,
`native/translation`, `native/translate-onnx`, `native/tts`,
`native/voice-conversion`, `native/vr-overlay`, `native/openvr-client`,
`native/ocr-runtime`, `native/transcription`); they are VRCT-VOX's own
code under `LICENSE`, and the list marks them so.

`native/ocr-runtime` (chat reading) reimplements, so that its results match
the earlier Python implementation, the image operations of OpenCV 4.10.0
(Apache-2.0, OpenCV team), the pre- and post-processing of RapidOCR 3.9.2
(Apache-2.0, RapidAI) and the polygon offset of Clipper 6.4.2 as bundled by
pyclipper 1.4.0 (Boost Software License 1.0, Angus Johnson); it follows GEOS's
order of operations for two area and length formulas. No source file of these
projects is included. ONNX Runtime is not built into the application: chat
reading loads the library at run time (see
`docs/voice-stack/core-integration.md`, item 2).

`native/translate-onnx` (local translation) is the fork's own code (MIT). It
uses `tokenizers` (Apache-2.0, Hugging Face) for SentencePiece segmentation and
loads the same ONNX Runtime library as chat reading at run time; ONNX Runtime
(MIT, Microsoft) and its execution providers (DirectML, CUDA, OpenVINO,
MIGraphX, WebGPU) are not bundled. No translation model is bundled: the M2M100
(MIT) and NLLB-200 (CC-BY-NC-4.0) conversions are offered only through the
consented model catalog once published, and a model the user places in the
`translation-models` folder is under its own license, which the user is
responsible for.

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
a build includes the dictionary, it is in `_internal/build/sudachi/` with the
distribution's `LEGAL` and `LICENSE-2.0.txt`, which carry these notices.
`tools/sudachi_dictionary.py` fetches it from the official release at a pinned
version, size and SHA-256. Which edition (full, core or small) builds include
is still open (`docs/voice-stack/core-integration.md`, item 3).

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
