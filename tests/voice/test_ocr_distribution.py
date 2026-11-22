"""Builds never ship OCR weights or the upstream chat-bubble detector."""

import pytest

from tools.distribution_policy import violation
from tools.linux_package import RUNTIME, check_tree


@pytest.mark.parametrize("name", [
    "rapidocr/__init__.py", "rapidocr/main.py", "rapidocr/config.yaml", "rapidocr/default_models.yaml",
    "_internal/rapidocr/inference_engine/onnxruntime/main.py",
])
def test_rapidocr_code_and_config_are_allowed(name):
    assert violation(name) is None


@pytest.mark.parametrize("name", [
    "_internal/rapidocr/models/PP-OCRv6_det_small.onnx",
    "_internal/rapidocr/models/PP-OCRv6_rec_small.onnx",
    "_internal/rapidocr/models/ch_ppocr_mobile_v2.0_cls_mobile.onnx",
    "_internal/ocr_onnx/chatbox_yolox_tiny.onnx",
    # The upstream detector stays out under any container or format.
    "_internal/chatbox_yolox_tiny.ort", "data/chatbox_yolox_tiny.onnx.zst", "x/CHATBOX_YOLOX_TINY.bin",
    # Downloaded PP-OCR files never travel with a build either.
    "downloaded_models/ppocrv6-small/rev/det.onnx",
    # Nor does VRCT-VOX's own detector: it is a consented download as well.
    "_internal/vrct_vox_chatbox_yolox_tiny.onnx",
    "downloaded_models/vrct-vox-chatbox-detector/rev/vrct_vox_chatbox_yolox_tiny.onnx",
])
def test_ocr_weights_and_detector_are_rejected(name):
    assert violation(name) == "Restricted OCR model"


def test_no_package_carries_the_python_ocr_runtime():
    # OCR runs in the app (ocr-runtime); the RapidOCR YAML was for the Python backend.
    from tools import app_resources
    for platform in ("windows", "linux"):
        assert not [name for name in app_resources.required(platform) if "rapidocr" in name]
    assert not [name for name in RUNTIME if "rapidocr" in name]


def test_linux_tree_without_weights_passes_and_a_weight_fails(tmp_path):
    package = tmp_path / "_internal/build"
    package.mkdir(parents=True)
    (package / "astarot-rvc-worker").write_text("x")
    check_tree(tmp_path)
    (tmp_path / "_internal/rapidocr/models").mkdir(parents=True)
    (tmp_path / "_internal/rapidocr/models/PP-OCRv6_rec_small.onnx").write_bytes(b"weights")
    with pytest.raises(ValueError, match="Restricted OCR"):
        check_tree(tmp_path)
