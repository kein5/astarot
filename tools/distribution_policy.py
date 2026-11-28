"""Path policy for the final artifact inspection (check_voice_distribution.py)."""

PRIVATE_VOICE_NAMES = frozenset("mia2026" + suffix for suffix in (".pth", ".index", ".zip", ".png"))
# The formats of model weights and of the files that come with them (an RVC voice's .index, numpy
# arrays, pickles). No package ships a model: the app downloads each one with the user's consent
# into its data folder. A file with one of these extensions is refused wherever it is and whatever
# its name, also inside a compressed or partial file (`model.onnx.zst`, `model.gguf.part`).
MODEL_EXTENSIONS = frozenset({
    "onnx", "ort", "pth", "pt", "ckpt", "safetensors", "gguf", "ggml", "bin", "index",
    "pdparams", "pdmodel", "pdiparams", "npy", "npz", "pkl", "pickle", "tflite", "h5", "hdf5",
    "keras", "pb", "mlmodel", "engine", "plan", "nemo", "caffemodel",
})
MODEL_SUFFIXES = tuple(sorted(f".{extension}" for extension in MODEL_EXTENSIONS))
# A model a package may carry after all: its exact path in the package (as `violation` sees it,
# lower case, with "/") and why, for example the license that allows it. A code owner reviews
# each entry (.github/CODEOWNERS lists this file). None is allowed today.
ALLOWED_MODELS = {}
# Tracked repository files that match MODEL_EXTENSIONS without being shipped models, allowed only
# when checking a git source archive (`--source-archive` in release.yml) and never in binary
# packages: hk.pkl is Apple Pkl configuration for hk git hooks (not a Python pickle), and
# native/rvc-runtime/tests/data/ holds tiny synthetic test fixtures for unit/integration tests.
SOURCE_ARCHIVE_ALLOWED_FILES = frozenset({"hk.pkl"})
SOURCE_ARCHIVE_ALLOWED_PREFIXES = ("native/rvc-runtime/tests/data/",)
ARCHIVE_SUFFIXES = (".zip", ".7z", ".tar", ".tgz", ".tar.gz", ".tar.xz", ".rar")
NATIVE_LIBRARY_SUFFIXES = (".dll", ".pyd", ".so", ".dylib")


# GPL-licensed encoders bundled by PyAV's FFmpeg wheels. The Python backend kept them out with a
# stub for `av`; the rule stays so that no package carries them.
GPL_CODEC_PREFIXES = ("libx264", "libx265", "x264", "x265")

# One package for every GPU (#288). Windows had a CPU and a CUDA package only because the Python
# backend loaded CTranslate2, whose GPU build needs NVIDIA's CUDA math libraries (the `cuda`
# extra: cuBLAS, cuDNN). Local recognition now runs on speech.cpp and local translation on ONNX
# Runtime, so neither may come back into a package. Libraries a user downloads with consent (the
# RVC runtime) go to the data folder, not into a package. Only native libraries count, so
# notices and folder names that mention them stay allowed.
CTRANSLATE2_FOLDERS = frozenset({"ctranslate2", "ctranslate2.libs"})
CTRANSLATE2_PREFIXES = ("ctranslate2", "libctranslate2")
CUDA_FOLDERS = frozenset({"nvidia"})
CUDA_LIBRARY_PREFIXES = ("cublas", "cudnn", "cudart", "libcublas", "libcudnn", "libcudart")


def _native_library(base):
    return base.endswith(NATIVE_LIBRARY_SUFFIXES) or ".so." in base


def _model_file(base):
    """Whether a file name carries a model format among its extensions (`x.onnx`, `x.onnx.zst`)."""
    return bool(MODEL_EXTENSIONS.intersection(base.split(".")[1:]))


def _allowed_in_source_archive(parts):
    rel_parts = parts[1:] if len(parts) > 1 and parts[0].endswith(".zip") else parts
    rel = "/".join(rel_parts)
    return rel in SOURCE_ARCHIVE_ALLOWED_FILES or rel.startswith(SOURCE_ARCHIVE_ALLOWED_PREFIXES)


def violation(name, *, source_archive=False):
    parts = str(name).replace("\\", "/").lower().split("/")
    base = parts[-1]
    folders = set(parts[:-1])
    if base in PRIVATE_VOICE_NAMES:
        return "Private voice asset"
    if base.startswith("translator_engines"):
        return "Upstream-only translator_engines"
    if base.startswith(GPL_CODEC_PREFIXES) and (".so" in base or base.endswith(".dll")):
        return "GPL codec library"
    if _native_library(base) and (folders & CTRANSLATE2_FOLDERS or base.startswith(CTRANSLATE2_PREFIXES)):
        return "CTranslate2 library"
    if _native_library(base) and (folders & CUDA_FOLDERS or base.startswith(CUDA_LIBRARY_PREFIXES)):
        return "CUDA library"
    if "av.libs" in parts or (len(parts) > 1 and parts[-2] == "av" and base.endswith((".so", ".pyd"))):
        return "PyAV native library"
    # PP-OCR download directories (ppocrv6-small/...) and upstream repo names count too.
    ocr = any(part in {"ocr", "ocr_onnx", "rapidocr", "rapidocr_onnxruntime"}
              or part.startswith(("ppocr", "pp-ocr")) for part in parts)
    if base.endswith(MODEL_SUFFIXES) and (ocr or "ocr" in base or base.startswith("chatbox_yolo")):
        return "Restricted OCR model"
    # The upstream chat-bubble detector may not ship under any name or format.
    if base.startswith("chatbox_yolo") or "chatbox_yolox" in base:
        return "Restricted OCR model"
    if _model_file(base) and "/".join(parts) not in ALLOWED_MODELS:
        if source_archive and _allowed_in_source_archive(parts):
            return None
        return "Model file"
    return None
