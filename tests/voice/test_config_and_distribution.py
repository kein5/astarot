import zipfile

import pytest

from tools.check_voice_distribution import check


def _fake_build(root, platform):
    exe = ".exe" if platform == "windows" else ""
    (root / "speechcpp/notices").mkdir(parents=True)
    (root / f"speechcpp/speech{exe}").write_bytes(b"engine")
    (root / "speechcpp/bundle.json").write_text("{}")
    (root / f"vrct-rvc-worker{exe}").write_bytes(b"worker")
    (root / "licenses/rust").mkdir(parents=True)
    (root / "licenses/rust/crates.json").write_text("[]")
    return root


@pytest.mark.parametrize("platform", ["windows", "linux"])
def test_staged_internal_passes_the_guard_and_a_weight_in_the_build_is_caught(tmp_path, platform):
    from tools import app_resources
    build = _fake_build(tmp_path / "build", platform)
    output = tmp_path / "_internal"
    app_resources.stage(output, platform, build)
    check([output])
    assert (output / "licenses/VRCT/LICENSE").is_file() and (output / "licenses/VRCT/NOTICE.md").is_file()
    # Only what app_resources lists is copied: a model next to the engine would ship, so the guard
    # inspects the staged tree before any package is made.
    (build / "speechcpp/chatbox_yolox_tiny.onnx").write_bytes(b"FAKE MODEL")
    app_resources.stage(output, platform, build)
    with pytest.raises(ValueError, match="Restricted OCR"):
        check([output])


def test_distribution_guard_catches_stale_trees_and_zips(tmp_path):
    (tmp_path / "LICENSE.txt").write_text("keep attribution", encoding="utf-8")
    check([tmp_path])
    model = tmp_path / "chatbox_yolox_tiny.onnx"
    model.write_bytes(b"FAKE MODEL")
    with pytest.raises(ValueError, match="Restricted OCR"):
        check([tmp_path])
    archive_path = tmp_path / "fork.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.write(model, "_internal/ocr_onnx/chatbox_yolox_tiny.onnx")
    model.unlink()
    with pytest.raises(ValueError, match="Restricted OCR"):
        check([archive_path])


@pytest.mark.parametrize('name', ['Mia2026.pth', 'Mia2026.index', 'Mia2026.zip', 'Mia2026.png'])
def test_user_supplied_rvc_assets_cannot_enter_distribution(tmp_path, name):
    model = tmp_path / name
    model.write_bytes(b'FAKE PRIVATE ASSET')
    with pytest.raises(ValueError, match='Private voice'):
        check([tmp_path])
    with pytest.raises(ValueError, match='Private voice'):
        check([model])
    archive_path = tmp_path / 'fork.zip'
    with zipfile.ZipFile(archive_path, 'w') as archive:
        archive.write(model, 'assets/' + name.upper())
    model.unlink()
    with pytest.raises(ValueError, match='Private voice'):
        check([archive_path])
