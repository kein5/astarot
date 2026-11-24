"""No package carries a model file, whatever its format, name or folder (tools/distribution_policy.py).

The app downloads every model with the user's consent into its data folder. A model that was
copied into a package by mistake (an RVC voice's .pth, a translation .gguf) must stop the build,
not only the OCR weights the policy began with."""

import pathlib
import subprocess

import pytest

from tools import distribution_policy
from tools.distribution_policy import violation
from tools.linux_package import check_tree

ROOT = pathlib.Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("name", [
    "_internal/rvc/voice.pth", "_internal/rvc/voice.index", "_internal/llm/translategemma-4b.gguf",
    "models/encoder.safetensors", "_internal/build/speechcpp/ggml-model-q8.bin", "VRCT-VOX/x/silero_vad.onnx",
    "_internal/x.ort", "a/weights.npy", "a/weights.npz", "a/model.pkl", "a/model.tflite", "a/model.h5",
    "a/frozen_graph.pb", "a/model.ckpt", "a/model.pt",
    # Compressed or left half downloaded.
    "data/encoder.onnx.zst", "data/model.gguf.part", "DATA/MODEL.GGUF",
])
def test_a_model_file_is_refused_wherever_it_is(name):
    assert violation(name) == "Model file"


@pytest.mark.parametrize("name", [
    # What the 0.6.0 packages hold beside the app: notices, the readings' dictionary, ONNX Runtime.
    "_internal/build/speechcpp/notices/ggml-LICENSE", "_internal/build/sudachi/system.dic",
    "_internal/build/speechcpp/bundle.json", "_internal/libonnxruntime.so.1.24.4", "_internal/onnxruntime.dll",
    "_internal/licenses/rust/crates.json", "README.md", "astarot-rvc-worker.exe",
])
def test_the_files_a_package_holds_today_are_allowed(name):
    assert violation(name) is None


def test_an_allowed_model_is_named_by_its_exact_path(monkeypatch):
    monkeypatch.setattr(distribution_policy, "ALLOWED_MODELS", {"_internal/vad/silero.onnx": "MIT; shipped for #000"})
    assert violation("_internal/vad/silero.onnx") is None
    assert violation("_internal/vad/other.onnx") == "Model file"
    assert violation("_internal/other/silero.onnx") == "Model file"


def test_no_model_is_allowed_today():
    assert distribution_policy.ALLOWED_MODELS == {}


def test_a_linux_tree_with_a_stray_model_fails(tmp_path):
    (tmp_path / "_internal/build").mkdir(parents=True)
    (tmp_path / "_internal/build/astarot-rvc-worker").write_text("x")
    check_tree(tmp_path)
    (tmp_path / "_internal/rvc").mkdir()
    (tmp_path / "_internal/rvc/voice.pth").write_bytes(b"weights")
    with pytest.raises(ValueError, match="Model file"):
        check_tree(tmp_path)


def test_source_archive_allows_hk_config_and_rvc_test_fixtures_only():
    # Binary packages still refuse them.
    assert violation("hk.pkl") == "Model file"
    assert violation("native/rvc-runtime/tests/data/tiny_v2_f0_40k.pth") == "Model file"

    # Source archives allow those explicit repo paths, bare or inside the archive prefix.
    assert violation("hk.pkl", source_archive=True) is None
    assert violation("VRCT-VOX-source.zip/hk.pkl", source_archive=True) is None
    assert violation("VRCT-VOX-source.zip/native/rvc-runtime/tests/data/tiny_v2_f0_40k.pth", source_archive=True) is None
    assert violation("VRCT-VOX-source.zip/native/rvc-runtime/tests/data/tiny_hubert/pytorch_model.bin", source_archive=True) is None

    # Stray models, OCR weights, and private voice assets remain refused even in source archives.
    assert violation("VRCT-VOX-source.zip/src-tauri/model.pkl", source_archive=True) == "Model file"
    assert violation("VRCT-VOX-source.zip/native/rvc-runtime/voice.pth", source_archive=True) == "Model file"
    assert violation("VRCT-VOX-source.zip/native/rvc-runtime/tests/data/chatbox_yolo.onnx", source_archive=True) == "Restricted OCR model"
    assert violation("VRCT-VOX-source.zip/native/rvc-runtime/tests/data/mia2026.pth", source_archive=True) == "Private voice asset"


def test_tracked_repository_files_pass_source_archive_inspection():
    tracked = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True).splitlines()
    failures = [
        (path, reason)
        for path in tracked
        if (reason := violation(f"VRCT-VOX-source.zip/{path}", source_archive=True)) is not None
    ]
    assert failures == []
