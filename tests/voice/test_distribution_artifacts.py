import io
import importlib.util
import json
import shutil
import subprocess
import tarfile
from pathlib import Path
from types import SimpleNamespace
import zipfile

import pytest

from tools import check_voice_distribution as guard
from tools.linux_package import check_tree, inspect_tar, pack


def _zip_bytes(name, data=b"synthetic", prefix=b"", comment=b""):
    payload = io.BytesIO(prefix)
    payload.seek(0, io.SEEK_END)
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, data)
        archive.comment = comment
    return payload.getvalue()


def _inspect_payload(tmp_path, container, name, data):
    if container == "zip":
        output = tmp_path / "package.zip"
        output.write_bytes(_zip_bytes(name, data))
        guard.check([output])
    elif container == "tar":
        output = tmp_path / "package.tar.gz"
        with tarfile.open(output, "w:gz") as archive:
            member = tarfile.TarInfo("VRCT-VOX/" + name)
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
        inspect_tar(output)
    else:
        root = tmp_path / "VRCT-VOX"
        payload = root / name
        payload.parent.mkdir(parents=True, exist_ok=True)
        payload.write_bytes(data)
        if container == "tree":
            guard.check([root])
        elif container == "linux_tree":
            check_tree(root)
        else:
            pack(root, tmp_path / "package.tar.gz", require_runtime=False)


@pytest.mark.parametrize("container", ["zip", "tar"])
@pytest.mark.parametrize("adjust_offsets", [False, True])
@pytest.mark.parametrize("name,reason", [
    ("ocr_onnx/chatbox_yolox_tiny.onnx", "OCR"),
    ("voice/Mia2026.pth", "Private voice"),
])
def test_prefixed_nested_zip_is_inspected(tmp_path, container, name, reason, adjust_offsets):
    prefix = b"MZ executable preamble\n"
    payload = _zip_bytes(name, prefix=prefix) if adjust_offsets else prefix + _zip_bytes(name)
    assert zipfile.is_zipfile(io.BytesIO(payload))
    with pytest.raises(ValueError, match=reason):
        _inspect_payload(tmp_path, container, "_internal/payload.dat", payload)


@pytest.mark.parametrize("container", ["zip", "tar", "tree", "linux_tree", "pack"])
@pytest.mark.parametrize("levels", [1, 2])
def test_nested_zip_preserves_ocr_context(tmp_path, container, levels):
    payload = _zip_bytes("det.onnx")
    if levels == 2:
        payload = _zip_bytes("models\\more.dat", payload)
    with pytest.raises(ValueError, match="OCR"):
        _inspect_payload(tmp_path, container, "_internal/rapidocr/models/assets.zip", payload)


@pytest.mark.parametrize("container", ["zip", "tar", "tree", "linux_tree", "pack"])
def test_inspection_ignores_host_ocr_directory(tmp_path, container):
    host = tmp_path / "ocr"
    host.mkdir()
    # A file under a folder named like an OCR one, but no model: the host's own "ocr" folder is
    # not part of the package's names. (Any model file is refused; test_model_distribution.py.)
    _inspect_payload(host, container, "_internal/models/transcription/silero_vad/README.md", b"VAD")


@pytest.mark.parametrize("container", ["zip", "tar"])
@pytest.mark.parametrize("comment_size", [0, 65535])
def test_oversized_prefixed_nested_zip_is_rejected(tmp_path, monkeypatch, container, comment_size):
    monkeypatch.setattr(guard, "MAX_NESTED_ZIP", 128)
    payload = _zip_bytes("LICENSE.txt", prefix=b"MZ" + b"x" * 128, comment=b"c" * comment_size)
    with pytest.raises(ValueError, match="oversized"):
        _inspect_payload(tmp_path, container, "_internal/payload.dat", payload)


@pytest.mark.parametrize("container", ["zip", "tar", "tree"])
def test_a_damaged_prefixed_zip_is_not_taken_for_plain_data(tmp_path, container):
    # The end record is there, the central directory is not. Python 3.14's zipfile.is_zipfile
    # says this is no ZIP, which must not let the member through unread.
    payload = _zip_bytes("ocr_onnx/chatbox_yolox_tiny.onnx", prefix=b"MZ executable preamble\n")
    payload = payload.replace(b"PK\x01\x02", b"XX\x01\x02")
    with pytest.raises(ValueError, match="Cannot inspect ZIP"):
        _inspect_payload(tmp_path, container, "_internal/payload.dat", payload)


@pytest.mark.parametrize("container", ["zip", "tar"])
def test_large_non_archive_members_remain_allowed(tmp_path, monkeypatch, container):
    monkeypatch.setattr(guard, "MAX_NESTED_ZIP", 128)
    _inspect_payload(tmp_path, container, "_internal/runtime.dll", b"MZ" + b"x" * 1024)


@pytest.mark.parametrize("container", ["zip", "tar"])
def test_nested_zip_expansion_budget_is_shared(tmp_path, monkeypatch, container):
    payload = _zip_bytes("large.txt", b"x" * 4096)
    monkeypatch.setattr(guard, "MAX_INSPECTION_BYTES", len(payload) + 4095, raising=False)
    with pytest.raises(ValueError, match="budget"):
        _inspect_payload(tmp_path, container, "payload.dat", payload)


@pytest.mark.parametrize("container", ["zip", "tar"])
def test_nested_zip_entry_budget_is_shared(tmp_path, monkeypatch, container):
    payload = _zip_bytes("LICENSE.txt")
    monkeypatch.setattr(guard, "MAX_INSPECTION_ENTRIES", 1, raising=False)
    with pytest.raises(ValueError, match="budget"):
        _inspect_payload(tmp_path, container, "payload.dat", payload)


@pytest.mark.parametrize("container", ["zip", "tar"])
def test_nested_zip_depth_is_bounded(tmp_path, container):
    payload = _zip_bytes("LICENSE.txt")
    for _ in range(6):
        payload = _zip_bytes("payload.dat", payload, prefix=b"MZ")
    with pytest.raises(ValueError, match="nesting"):
        _inspect_payload(tmp_path, container, "payload.dat", payload)


@pytest.mark.parametrize("container", ["zip", "tar"])
def test_allowed_prefixed_nested_zip_remains_allowed(tmp_path, container):
    payload = _zip_bytes("models/transcription/silero_vad/LICENSE.txt", prefix=b"MZ")
    _inspect_payload(tmp_path, container, "_internal/payload.dat", payload)


@pytest.mark.parametrize("name", [
    "ocr_onnx/renamed.onnx", "rapidocr/models/rec.onnx",
    "CH_PP-OCRv4_det_infer.onnx", "models/ocr/weights/model.pth",
])
def test_all_ocr_weights_are_rejected_in_tree_and_zip(tmp_path, name):
    model = tmp_path / name
    model.parent.mkdir(parents=True, exist_ok=True)
    model.write_bytes(b"synthetic model")
    with pytest.raises(ValueError, match="OCR"):
        guard.check([tmp_path])
    output = tmp_path / "package.zip"
    with zipfile.ZipFile(output, "w") as archive:
        archive.write(model, name.upper().replace("/", "\\"))
    model.unlink()
    with pytest.raises(ValueError, match="OCR"):
        guard.check([output])



@pytest.mark.parametrize("name,reason", [
    ("_internal/av.libs/libx264-d6533a8d.so.165", "GPL codec"),
    ("_internal/av.libs/libavcodec-5e6b81c2.so.62.28.102", "PyAV"),
    ("_internal/av/_core.abi3.so", "PyAV"),
    ("_internal/av.libs/x265-215.dll", "GPL codec"),
    ("_internal/av/_core.cp311-win_amd64.pyd", "PyAV"),
])
def test_pyav_and_gpl_encoders_are_rejected(tmp_path, name, reason):
    with zipfile.ZipFile(tmp_path / "package.zip", "w") as archive:
        archive.writestr(name, b"synthetic library")
    with pytest.raises(ValueError, match=reason):
        guard.check([tmp_path])


@pytest.mark.parametrize("container", ["zip", "tar", "tree", "linux_tree"])
@pytest.mark.parametrize("name,reason", [
    # The 0.4 Windows package: the CTranslate2 wheel's own folder.
    ("_internal/ctranslate2/ctranslate2.dll", "CTranslate2"),
    ("_internal/ctranslate2/_ext.cp311-win_amd64.pyd", "CTranslate2"),
    ("_internal/ctranslate2/libiomp5md.dll", "CTranslate2"),
    # The Linux wheel keeps its libraries beside the package.
    ("_internal/ctranslate2.libs/libgomp-a34b3233.so.1.0.0", "CTranslate2"),
    ("_internal/ctranslate2.libs/libctranslate2-bc15bf3f.so.4.9.0", "CTranslate2"),
    # The `cuda` extra (nvidia-cublas-cu12, nvidia-cudnn-cu12) and the same libraries elsewhere.
    ("_internal/nvidia/cublas/bin/cublas64_12.dll", "CUDA"),
    ("_internal/nvidia/cudnn/bin/cudnn_ops64_9.dll", "CUDA"),
    ("_internal/nvidia/cuda_nvrtc/lib/libnvrtc.so.12", "CUDA"),
    ("_internal/build/speechcpp/cudart64_12.dll", "CUDA"),
    ("_internal/onnxruntime/cublasLt64_12.dll", "CUDA"),
    ("usr/lib/astarot/_internal/libcudnn.so.9", "CUDA"),
])
def test_ctranslate2_and_cuda_libraries_are_rejected(tmp_path, container, name, reason):
    with pytest.raises(ValueError, match=reason):
        _inspect_payload(tmp_path, container, name, b"synthetic library")


def test_single_package_runtimes_and_cuda_notices_remain_allowed(tmp_path):
    with zipfile.ZipFile(tmp_path / "package.zip", "w") as archive:
        # What the 0.5 Windows package carries for local inference.
        archive.writestr("_internal/onnxruntime/onnxruntime.dll", b"ort")
        archive.writestr("_internal/onnxruntime/onnxruntime_providers_shared.dll", b"ort")
        archive.writestr("_internal/build/speechcpp/speech.exe", b"speech.cpp")
        archive.writestr("_internal/build/speechcpp/ggml-vulkan.dll", b"ggml")
        # Notices may name the libraries; only the libraries themselves are refused.
        archive.writestr("_internal/licenses/nvidia/cudnn-LICENSE.txt", "notice")
        archive.writestr("_internal/licenses/ctranslate2/LICENSE", "notice")
    guard.check([tmp_path])


def test_lgpl_opencv_ffmpeg_libraries_remain_allowed(tmp_path):
    with zipfile.ZipFile(tmp_path / "package.zip", "w") as archive:
        archive.writestr("_internal/opencv_python_headless.libs/libavcodec-9aae324f.so.59.37.100", b"lgpl")
        archive.writestr("_internal/cv2/opencv_videoio_ffmpeg4100_64.dll", b"lgpl")
        archive.writestr("_internal/soxr/soxr_ext.cpython-311-x86_64-linux-gnu.so", b"lgpl")
    guard.check([tmp_path])


def test_renamed_nested_zip_is_still_inspected(tmp_path):
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        archive.writestr("ocr_onnx/chatbox_yolox_tiny.onnx", b"synthetic")
    with zipfile.ZipFile(tmp_path / "package.zip", "w") as archive:
        archive.writestr("_internal/resources/data.dat", payload.getvalue())
    with pytest.raises(ValueError, match="OCR"):
        guard.check([tmp_path])


@pytest.mark.parametrize("name", ["_internal/translator_engines.pyd", "translator_engines.cpython-311-x86_64-linux-gnu.so",
                                  "src-python/translator_engines.LICENSE.txt"])
def test_upstream_only_translator_engines_is_rejected(tmp_path, name):
    with zipfile.ZipFile(tmp_path / "package.zip", "w") as archive:
        archive.writestr(name, b"upstream-only")
    with pytest.raises(ValueError, match="translator_engines"):
        guard.check([tmp_path])

def test_guard_inspects_nested_zip_in_tree_and_zip(tmp_path):
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        archive.writestr("ocr_onnx/chatbox_yolox_tiny.onnx", b"synthetic")
    outer = tmp_path / "package.zip"
    with zipfile.ZipFile(outer, "w") as archive:
        archive.writestr("nested.zip", payload.getvalue())
    for path in [outer, tmp_path]:
        with pytest.raises(ValueError, match="OCR"):
            guard.check([path])


def test_guard_rejects_unreadable_zip(tmp_path):
    broken = tmp_path / "package.zip"
    broken.write_bytes(b"truncated zip")
    with pytest.raises(ValueError, match="inspect"):
        guard.check([broken])


def test_non_ocr_notices_remain_allowed_and_a_vad_model_does_not(tmp_path):
    with zipfile.ZipFile(tmp_path / "package.zip", "w") as archive:
        archive.writestr("models/transcription/silero_vad/LICENSE.txt", "attribution")
        archive.writestr("ocr_onnx/LICENSE.txt", "attribution")
    guard.check([tmp_path])
    # No model ships, the voice activity detector's neither (speech.cpp's VAD is a download).
    with zipfile.ZipFile(tmp_path / "package.zip", "a") as archive:
        archive.writestr("models/transcription/silero_vad/silero_encoder_v5.onnx", b"fake VAD")
    with pytest.raises(ValueError, match="Model file"):
        guard.check([tmp_path])


@pytest.mark.parametrize("entry", ["ocr_onnx/chatbox_yolox_tiny.onnx", "rapidocr/models/rec.onnx", "voice/Mia2026.pth"])
def test_nsis_payload_listing_rejects_prohibited_assets(tmp_path, monkeypatch, entry):
    installer = tmp_path / "setup.exe"
    installer.write_bytes(b"MZ fake installer")
    def run(args, **kwargs):
        assert args[:3] == ["7z", "l", "-slt"]
        assert args[-1] == str(installer)
        return SimpleNamespace(returncode=0, stdout=f"Path = {installer}\nType = Nsis\n\n----------\nPath = {entry}\nSize = 20\n", stderr="")
    monkeypatch.setattr("subprocess.run", run)
    with pytest.raises(ValueError, match="OCR|Private voice"):
        guard.check_nsis([installer])


@pytest.mark.parametrize("listing", ["", "Type = PE\n\n----------\nPath = .text\n", "Type = Nsis\n\n----------\nPath = unchecked.zip\n"])
def test_nsis_unknown_or_nested_payload_never_passes(tmp_path, monkeypatch, listing):
    installer = tmp_path / "setup.exe"
    installer.write_bytes(b"fake")
    monkeypatch.setattr("subprocess.run", lambda *a, **kw: SimpleNamespace(returncode=0, stdout=listing, stderr=""))
    with pytest.raises(ValueError):
        guard.check_nsis([installer])


def test_nsis_clean_listing_and_inspector_failure(tmp_path, monkeypatch):
    installer = tmp_path / "setup.exe"
    installer.write_bytes(b"fake")
    listing = "Type = Nsis\n\n----------\n" + "".join(
        f"Path = $PLUGINSDIR\\licenses\\nscurl\\{name}\nSize = 100\n\n"
        for name in ("LICENSE.md", "LICENSE.brotli.md", "LICENSE.curl.md", "LICENSE.nghttp2.md",
                     "LICENSE.openssl.md", "LICENSE.zlib.md", "LICENSE.zstd.md"))
    monkeypatch.setattr("subprocess.run", lambda *a, **kw: SimpleNamespace(returncode=0, stdout=listing, stderr=""))
    guard.check_nsis([installer])
    def fail(*a, **kw):
        raise FileNotFoundError("no 7z")
    monkeypatch.setattr("subprocess.run", fail)
    with pytest.raises(ValueError, match="inspect"):
        guard.check_nsis([installer])


@pytest.mark.parametrize("missing", [
    "LICENSE.md", "LICENSE.brotli.md", "LICENSE.curl.md", "LICENSE.nghttp2.md",
    "LICENSE.openssl.md", "LICENSE.zlib.md", "LICENSE.zstd.md",
])
def test_nsis_requires_each_retained_nscurl_notice(tmp_path, monkeypatch, missing):
    installer = tmp_path / "setup.exe"
    installer.write_bytes(b"fake")
    notices = Path(__file__).resolve().parents[2] / "src-tauri/nsis/licenses/nscurl"
    listing = "Type = Nsis\n\n----------\n" + "".join(
        f"Path = $PLUGINSDIR/licenses/nscurl/{path.name}\nSize = 100\n\n"
        for path in notices.iterdir() if path.name != missing)
    monkeypatch.setattr("subprocess.run", lambda *a, **kw: SimpleNamespace(returncode=0, stdout=listing, stderr=""))
    with pytest.raises(ValueError, match="NScurl notice"):
        guard.check_nsis([installer])


@pytest.mark.skipif(shutil.which("7z") is None, reason="7-Zip not installed")
def test_real_7zip_listing_does_not_mistake_zip_for_nsis(tmp_path, monkeypatch):
    candidate = tmp_path / "setup.exe"
    with zipfile.ZipFile(candidate, "w") as archive:
        archive.writestr("LICENSE.txt", "synthetic")
    original = subprocess.run
    def run(*args, **kwargs):
        result = original(*args, **kwargs)
        assert result.returncode == 0, result.stderr
        assert "Type = zip" in result.stdout
        return result
    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(ValueError, match="Cannot inspect NSIS"):
        guard.check_nsis([candidate])


def _zip_module():
    path = Path(__file__).resolve().parents[2] / "utils/zip.py"
    spec = importlib.util.spec_from_file_location("fork_zip_builder", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _zip_builder():
    return _zip_module().zip_files_and_directory


def test_the_package_puts_the_steamvr_manifest_beside_the_app(tmp_path):
    # SteamVR starts the binary the manifest names, relative to the manifest's folder (#1384).
    root = Path(__file__).resolve().parents[2]
    files = _zip_module().PACKAGE_FILES
    manifest = root / "src-tauri/steamvr/astarot.vrmanifest"
    assert "src-tauri/steamvr/astarot.vrmanifest" in files
    app = tmp_path / "astarot.exe"
    app.write_bytes(b"fake executable")
    output = tmp_path / "fork.zip"
    _zip_builder()(output, [app, manifest], [])
    with zipfile.ZipFile(output) as archive:
        assert set(archive.namelist()) == {"astarot.exe", "astarot.vrmanifest"}
        named = json.loads(archive.read("astarot.vrmanifest"))["applications"][0]["binary_path_windows"]
    assert named == "astarot.exe"


def test_package_builder_refuses_missing_inputs_before_replacing_output(tmp_path):
    output = tmp_path / "fork.zip"
    output.write_bytes(b"previous candidate")
    with pytest.raises(ValueError, match="exist"):
        _zip_builder()(output, [tmp_path / "missing.exe"], [])
    assert output.read_bytes() == b"previous candidate"


def test_package_builder_propagates_io_failure(tmp_path, monkeypatch):
    source = tmp_path / "app.exe"
    source.write_bytes(b"fake executable")
    def fail(*args, **kwargs):
        raise OSError("synthetic disk full")
    monkeypatch.setattr(zipfile.ZipFile, "write", fail)
    with pytest.raises(OSError, match="disk full"):
        _zip_builder()(tmp_path / "fork.zip", [source], [])


def test_package_builder_creates_auditable_zip(tmp_path):
    source = tmp_path / "app.exe"
    source.write_bytes(b"fake executable")
    resources = tmp_path / "_internal"
    resources.mkdir()
    (resources / "LICENSE.txt").write_text("retain original attribution")
    output = tmp_path / "fork.zip"
    _zip_builder()(output, [source], [resources])
    guard.check([output])
    with zipfile.ZipFile(output) as archive:
        assert set(archive.namelist()) == {"app.exe", "_internal/LICENSE.txt"}
        assert archive.testzip() is None
