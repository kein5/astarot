"""The Whisper weights older versions downloaded (#288): their size, and deleting only them."""
import os
import re
import shutil
from pathlib import Path

import pytest

from models.transcription import old_whisper_weights as weights


def write(path: Path, size: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    return path


@pytest.fixture
def root(tmp_path):
    whisper = tmp_path / "data" / "weights" / "whisper"
    write(whisper / "base" / "model.bin", 100)
    write(whisper / "base" / "config.json", 5)
    write(whisper / "large-v3-turbo" / "nested" / "model.bin", 1000)
    return tmp_path / "data"


def symlink(link: Path, target: Path, directory: bool) -> None:
    try:
        os.symlink(target, link, target_is_directory=directory)
    except (OSError, NotImplementedError):
        pytest.skip("this system cannot make symbolic links")


def test_the_names_are_those_the_removed_engine_downloaded():
    assert weights.WHISPER_WEIGHT_NAMES == ("tiny", "base", "small", "medium", "large-v1", "large-v2",
                                            "large-v3", "large-v3-turbo-int8", "large-v3-turbo")


def test_the_size_counts_the_known_folders(root):
    assert weights.oldWhisperWeights(str(root)) == {"total_bytes": 1105, "folders": ["base", "large-v3-turbo"]}


@pytest.mark.parametrize("layout", ["none", "empty", "file"])
def test_nothing_there_is_nothing_to_delete(tmp_path, layout):
    data = tmp_path / "data"
    if layout == "empty":
        (data / "weights" / "whisper").mkdir(parents=True)
    elif layout == "file":
        write(data / "weights" / "whisper", 3)
    assert weights.oldWhisperWeights(str(data)) == {"total_bytes": 0, "folders": []}
    result = weights.deleteOldWhisperWeights(str(data))
    assert result == {"total_bytes": 0, "folders": [], "freed_bytes": 0, "failed": []}
    if layout == "file":
        assert (data / "weights" / "whisper").read_bytes() == b"xxx"


def test_delete_removes_only_the_known_folders_and_keeps_anything_else(root):
    whisper = root / "weights" / "whisper"
    unknown_folder = write(whisper / "my-own-model" / "model.bin", 7)
    unknown_file = write(whisper / "notes.txt", 2)
    translation = write(root / "weights" / "ctranslate2" / "m2m100_418M-ct2-int8" / "model.bin", 9)

    result = weights.deleteOldWhisperWeights(str(root))

    assert result == {"total_bytes": 0, "folders": [], "freed_bytes": 1105, "failed": []}
    assert not (whisper / "base").exists() and not (whisper / "large-v3-turbo").exists()
    assert unknown_folder.read_bytes() == b"x" * 7
    assert unknown_file.read_bytes() == b"xx"
    assert translation.exists()
    # Not empty, so the whisper folder itself stays.
    assert whisper.is_dir()


def test_the_whisper_folder_goes_only_when_nothing_else_is_in_it(root):
    weights.deleteOldWhisperWeights(str(root))
    assert not (root / "weights" / "whisper").exists()
    assert (root / "weights").is_dir()


def test_a_known_name_that_is_a_link_is_not_followed(root, tmp_path):
    elsewhere = write(tmp_path / "elsewhere" / "model.bin", 50)
    symlink(root / "weights" / "whisper" / "small", elsewhere.parent, True)

    assert weights.oldWhisperWeights(str(root))["folders"] == ["base", "large-v3-turbo"]
    result = weights.deleteOldWhisperWeights(str(root))

    assert result["freed_bytes"] == 1105
    assert elsewhere.read_bytes() == b"x" * 50
    # The link itself is not a known folder either: it is left for the user.
    assert (root / "weights" / "whisper" / "small").is_symlink()


def test_a_link_inside_a_known_folder_is_neither_counted_nor_followed(root, tmp_path):
    outside = write(tmp_path / "outside" / "keep.bin", 70)
    symlink(root / "weights" / "whisper" / "base" / "to-file", outside, False)
    symlink(root / "weights" / "whisper" / "base" / "to-folder", outside.parent, True)

    assert weights.oldWhisperWeights(str(root))["total_bytes"] == 1105
    weights.deleteOldWhisperWeights(str(root))

    assert outside.read_bytes() == b"x" * 70
    assert not (root / "weights" / "whisper" / "base").exists()


def test_a_whisper_folder_that_is_a_link_is_left_alone(tmp_path):
    real = tmp_path / "real"
    write(real / "base" / "model.bin", 10)
    data = tmp_path / "data"
    (data / "weights").mkdir(parents=True)
    symlink(data / "weights" / "whisper", real, True)

    assert weights.oldWhisperWeights(str(data)) == {"total_bytes": 0, "folders": []}
    assert weights.deleteOldWhisperWeights(str(data))["freed_bytes"] == 0
    assert (real / "base" / "model.bin").exists()


def test_a_folder_that_cannot_be_removed_is_reported_with_what_remains(root, monkeypatch):
    remove = shutil.rmtree

    def busy(path, *args, **kwargs):
        if Path(path).name == "large-v3-turbo":
            raise PermissionError(13, "in use")
        remove(path, *args, **kwargs)

    monkeypatch.setattr(weights.shutil, "rmtree", busy)
    result = weights.deleteOldWhisperWeights(str(root))

    assert result == {"total_bytes": 1000, "folders": ["large-v3-turbo"], "freed_bytes": 105, "failed": ["large-v3-turbo"]}
    assert (root / "weights" / "whisper").is_dir()


def test_the_module_has_no_way_to_download():
    source = Path(weights.__file__).read_text(encoding="utf-8")
    assert not re.search(r"\b(requests|urllib|http|huggingface|download_)", source.split('"""', 2)[2])
