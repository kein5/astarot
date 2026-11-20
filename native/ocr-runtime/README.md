# ocr-runtime

Chat-bubble OCR and VRChat frame capture in Rust (issue #281): a port of
`src-python/models/ocr` (about 3,600 lines). Recognition runs PP-OCR on ONNX Runtime
through `ort`, with RapidOCR's pre- and post-processing reproduced exactly.

The backend core (`native/core`, `controller::ocr`) runs it in the application process
when the core is the backend: the chat reading endpoints, the start checks, the status
and the settings of a running pipeline. Read lines go to the core's message pipeline.
The Python module is unchanged and is still what the Python sidecar uses.

ONNX Runtime is linked in one of two ways, chosen by a feature:

- `download-binaries` (default): `ort`'s prebuilt ONNX Runtime 1.31.0, fetched at build
  time and linked statically. This crate's tests and `ocr-read` use it. On Windows the
  build links `DirectML.dll`, which is copied next to the binaries.
- `load-dynamic`: the library is loaded when the engine is first used, from
  `ORT_DYLIB_PATH`, else the library the application ships (`_internal/onnxruntime`), else
  `onnxruntime.dll` / `libonnxruntime.so` by name. A missing library is an error value
  (`engine::is_available()` is false), not a panic. The core uses this.

Either way the library and the process's one environment come from `native/onnx-runtime`
(`vrct-onnx-runtime`), which the local translation (`native/translate-onnx`) and the RVC
worker use too: `ort` keeps the first library a process loads and allows one environment per
process. The binaries stop ONNX Runtime's usage reports first thing
(`vrct_onnx_runtime::disable_telemetry_for_process`).

## What it does

| Python | Rust | Notes |
|---|---|---|
| `ocr_engine_rapidocr.py` + RapidOCR 3.9.2 | `engine.rs`, `det.rs`, `rec.rs`, `unclip.rs`, `numeric.rs` | Size bounds and vertical padding, DB detection and its post-processing, the perspective crop, batched CTC recognition, score rounding, Arabic display order, final filtering, `readtext_bgr_or_raise`. |
| OpenCV 4.10 calls RapidOCR makes | `cv/` | Bilinear and area resizing, contour tracing, convex hull, minimum-area rectangle, polygon filling, perspective warp with bicubic weights, 2×2 dilation, masked mean. Same arithmetic as `opencv-python-headless` 4.10.0.84. |
| `ocr_models.py`, `ocr_languages.py` | `models.rs`, `languages.rs` | Catalog pins (checked against `catalog.py`), size and SHA-256 checks, the character list read from `inference.yml` as PyYAML reads the pinned files. |
| `ocr_detection.py` | `detection.rs` | Reading regions per view, line grouping, block bounds, the chatbox style check. |
| `ocr_bubble_detector.py`, `ocr_chatbox_detector.py` | `chatbox.rs` | VRCT-VOX's own detector only (the verified download's file name; the upstream detector is never loaded). |
| `ocr_pipeline.py`, `ocr_failure.py` | `pipeline.rs`, `text.rs`, `failure.rs`, `priority.rs` | The tick, recognition reuse, deduplication, merging lines into a message, retries and backoff, settings while running, start checks with the `OCR_DISABLED_*` reasons, thread priority on Windows. |
| `ocr_capture*.py`, `process_check.py` | `capture/` | The facade (headset view while SteamVR runs, else the desktop window), PrintWindow (Windows), X11/XWayland (Linux), the ScreenCast portal's frame file (Linux), the OpenVR mirror (D3D11 on Windows, OpenGL on Linux), blank frames, the start probe. |

`ocr-read` reads PNG pictures and writes boxes, texts and scores to a JSON file; the
terminal only gets counts and timings. Nothing in the crate logs recognised text or
pixels; `Debug` output of words, messages and pictures shows sizes only.

### Where it differs from the Python implementation on purpose

- X11 is spoken directly (`x11rb`) instead of through `libX11` with ctypes. A vanished
  window or a lost server is an error value; there is no Xlib error handler that could
  exit the process.
- The OpenVR client library is loaded at run time: `VRCT_OPENVR_API`, else
  `openvr_api.dll` / `libopenvr_api.so` beside the executable, else by name. The
  interface versions are those of pyopenvr 2.12.1401 (`IVRCompositor_029`,
  `IVRSystem_023`). Their functions are called by position; each position is declared
  with its function's name (`vrct_openvr_client::fn_table!`) and checked against
  pyopenvr's tables (`native/openvr-client/tests/data/pyopenvr_fn_tables.json`).
- On Linux the mirror's OpenGL context comes from EGL (an offscreen pbuffer) instead of
  a hidden GLFW window.
- The derived keys file (`downloaded_models/.ocr-keys/`) is not written; the character
  list is read from `inference.yml` directly.
- The thread count uses the CPUs available to the process (`available_parallelism`)
  where Python used `os.cpu_count()`; both give "half the cores, at most four".
- Text keys use Unicode case folding (`caseless`) where Python hashed `str.casefold()`.

## Verification

`cargo test` runs everything below. The conformance tests compare with the Python
implementation and report themselves as skipped until the fixtures exist; set
`OCR_REQUIRE_REFERENCE=1` to make that a failure. The fixtures were made with the scripts
below, which ran the Python backend's OCR (`src-python/models/ocr`); they went with it in
0.6.0 (#285), so new fixtures can no longer be made this way. The commands and results are
the record of how the core was checked (the scripts are in the v0.5.2 tag).

```sh
python native/ocr-runtime/reference/setup_reference.py      # models and venv, ~/.cache/vrct-vox/ocr-reference
REF=~/.cache/vrct-vox/ocr-reference
$REF/venv/bin/python native/ocr-runtime/reference/dump_cv_cases.py
$REF/venv/bin/python native/ocr-runtime/reference/dump_reference.py
$REF/venv/bin/python native/ocr-runtime/reference/dump_pipeline_cases.py
cd native/ocr-runtime && OCR_REQUIRE_REFERENCE=1 cargo test --release -- --nocapture   # METRIC lines
```

`setup_reference.py` fetches the OCR catalog's models at their pinned revisions (checked
by SHA-256) and installs the application's own pins of RapidOCR, ONNX Runtime and
OpenCV with the hashes in `uv.lock`. `dump_reference.py` builds the test picture set and
records what `src-python/models/ocr` reads from it through the application's own code
(`getReader`, `readtext_bgr_or_raise`):

- **synthetic** (72 pictures): VRChat-like frames with chatbox bubbles and world signs,
  and crops of each bubble, in Japanese/English, Chinese, Korean, Russian, Thai, Arabic
  and Hindi, drawn with the repository's Noto Sans JP/KR/SC and the system's Noto fonts;
- **lab-crops** (150) and **lab-frames** (40): chatbox crops and whole frames from the
  chatbox lab's validation split (`tools/chatbox_lab`). These are VRCT-VOX's own captures
  and may not be published; they are only read locally and never committed.

### Results

Measured on 2026-11-15, Linux, AMD Ryzen 9 9900X, CPU, four inference threads. These
are measurements of this machine, not guarantees.

| Check | Result |
|---|---|
| Resizing (bilinear, area; 1 and 3 channels) | 192 / 192 cases identical |
| Contours (`RETR_LIST`, `CHAIN_APPROX_SIMPLE`) | 7,600 contours identical, in the same order (150 masks) |
| Convex hull, minimum-area rectangle, corner points | 600 / 600 identical |
| Polygon filling | 400 / 400 identical |
| Perspective transform and bicubic warp | 120 / 120 identical (matrices and pixels) |
| Box offset (Shapely area and perimeter, pyclipper offset) | 1,500 / 1,500 identical |
| Character lists from `inference.yml` | 6 / 6 identical to PyYAML |
| **Recognition, 262 pictures, 905 lines** | **texts 905 / 905 and boxes 905 / 905 identical** |
| Scores, with the ONNX Runtime library of the application's wheel (1.31.1) | 905 / 905 identical; `readtext` results identical in 262 / 262 pictures |
| Scores, with the ONNX Runtime `ort` bundles (1.31.0) | 891 / 905 identical, the rest differ by 1e-5 (one unit in the fifth decimal) |
| Line grouping, block bounds, chatbox style check, merged message | 708 / 708 blocks identical (384 judged chatboxes) |
| Near-duplicate check and case-insensitive keys | 3,000 / 3,000 string pairs identical |
| Chatbox detector boxes | 48 / 48 frames identical (43 chatboxes) |
| Pipeline behaviour (55 tests ported from the Python pipeline tests) | pass |
| Capture: frame file and facade (30 ported tests), X11 on a real XWayland window (opt-in) | pass |

About the scores: with identical input tensors (checked: 154,368 / 154,368 values), the
two ONNX Runtime builds differ by up to 1.1e-6 in the recogniser's probabilities, which
moves a score rounded to five decimals by one unit now and then. The conformance test
requires identical texts and boxes and scores within 1e-5; with
`OCR_EXACT_REFERENCE=1` (and the wheel's library through `--features ort/load-dynamic`
and `ORT_DYLIB_PATH`) it requires everything to be identical.

```sh
ORT_DYLIB_PATH=$REF/venv/lib/python3.14/site-packages/onnxruntime/capi/libonnxruntime.so.1.31.1 \
OCR_EXACT_REFERENCE=1 cargo test --release --features ort/load-dynamic --test engine_conformance
```

Two places where the reference itself is not the same on every machine:

- RapidOCR sorts lines by aspect ratio with NumPy's unstable sort before batching them
  in sixes. Lines with exactly equal ratios may land in different batches, which changes
  their padding. This runtime sorts stably.
- The chatbox style check computes luminance with `bgr @ weights` in float32, which
  NumPy hands to OpenBLAS; its last bit depends on the CPU's kernels. This runtime uses
  the fused chain that matches FMA-capable CPUs (99.99 % of values identical here); the
  decisions were identical on all test pictures.

### Speed (same machine)

| Pictures | Python (RapidOCR) | Rust, `ort`'s ONNX Runtime 1.31.0 | Rust, wheel's ONNX Runtime 1.31.1 |
|---|---|---|---|
| lab-crops, 150 chatbox crops | 143.7 ms each | 154.8 ms each (PNG decoding included) | – |
| lab-frames, 40 whole frames (2560 px wide) | 1,152 ms each | 1,286 ms each (PNG decoding included) | about 967 ms (sum of stages over 20 frames, PNG decoding included) |

Inference dominates (whole frame: detection 897 ms and recognition 281 ms with `ort`'s
build, 751 ms and 162 ms with the wheel's library); the reimplemented image steps take
about 45 ms per frame, plus 15 ms to decode the PNG. Python's figures exclude reading the
file. Which ONNX Runtime build ships is open (below).

### Not verified

- Windows: the PrintWindow, D3D11 mirror and thread-priority code is checked with
  `cargo check` and `cargo clippy --target x86_64-pc-windows-msvc` only.
- The OpenVR mirror on any headset, and the Linux OpenGL path against SteamVR (the
  Python path was only checked against a fake compositor too).
- The ScreenCast portal with the real helper (the frame file format is tested).
- The whole pipeline reading a live VRChat window; there is no bridge to the
  application yet.

## Open questions

1. **Bridge to the application.** The core runs the pipeline in the application process
   (#285); `src-python/models/ocr` went with the Python backend in 0.6.0, and with it the
   chatbox lab's `label.py`, which used the Python reader.
2. **ONNX Runtime build.** `ort`'s own ONNX Runtime 1.31.0 made detection 19 % and
   recognition 73 % slower than the official 1.31.1 library on this machine, and some
   scores differ by 1e-5. The core loads the library at run time (`load-dynamic`), so
   the official library gives identical results; which one ships, and where, is
   item 2 of `docs/voice-stack/core-integration.md`. The static build also failed to
   link with MSVC 14.43 (it needs a newer C++ library), and the Windows test
   `a_file_left_by_a_killed_helper_is_not_a_stream` relies on `/proc` and fails there.
3. **OpenVR client library.** pyopenvr shipped `openvr_api`; something must ship it next
   to the application (BSD-3-Clause, Valve) and be listed in `NOTICE.md`.
4. **Linux headset view.** EGL instead of GLFW for the OpenGL context: equivalent on paper,
   untested against SteamVR either way.
5. **Notices.** The crate reimplements algorithms of OpenCV (Apache-2.0), RapidOCR
   (Apache-2.0) and Clipper (Boost Software License) and follows GEOS's operation order
   for two formulas; `NOTICE.md` and the licence ledger need these once it ships.
6. **CI.** As with `native/rvc-runtime`, nothing runs these tests in CI yet.

## Provenance and licences

The image operations follow the published source of OpenCV 4.10.0 (Apache-2.0), the box
offset that of Clipper 6.4.2 as bundled by pyclipper 1.4.0 (Boost Software License 1.0),
and the pre- and post-processing that of RapidOCR 3.9.2 (Apache-2.0), so that results
match bit for bit; the conformance tests are the check. The Python scripts under
`reference/` are test tooling and are not shipped. Rust dependencies: `ort` (MIT/Apache),
`x11rb`, `windows`, `unicode-bidi`, `caseless`, `sha2`, `png`, `serde_json`,
`thiserror` (MIT/Apache), `libloading` (ISC).
