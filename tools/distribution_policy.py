"""Path policy for the final artifact inspection (check_voice_distribution.py)."""

PRIVATE_VOICE_NAMES = frozenset("mia2026" + suffix for suffix in (".pth", ".index", ".zip", ".png"))
MODEL_SUFFIXES = (".onnx", ".pth", ".pt", ".ckpt", ".safetensors", ".gguf", ".bin", ".pdparams", ".pdmodel", ".pdiparams")
ARCHIVE_SUFFIXES = (".zip", ".7z", ".tar", ".tgz", ".tar.gz", ".tar.xz", ".rar")


# GPL-licensed encoders bundled by PyAV's FFmpeg wheels. The Python backend kept them out with a
# stub for `av`; the rule stays so that no package carries them.
GPL_CODEC_PREFIXES = ("libx264", "libx265", "x264", "x265")


def violation(name):
    parts = str(name).replace("\\", "/").lower().split("/")
    base = parts[-1]
    if base in PRIVATE_VOICE_NAMES:
        return "Private voice asset"
    if base.startswith("translator_engines"):
        return "Upstream-only translator_engines"
    if base.startswith(GPL_CODEC_PREFIXES) and (".so" in base or base.endswith(".dll")):
        return "GPL codec library"
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
    return None
