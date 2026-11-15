"""The Whisper (faster-whisper / CTranslate2) weights that older versions downloaded.

Local speech recognition runs on speech.cpp since #288, and these folders are no longer
read. They can be large (up to about 3 GB each), so the user can see their size and delete
them from Settings. Nothing here runs on its own: both functions are called only when the
UI asks.

Only the folders the app itself created are touched: `<root>/weights/whisper/<name>` for
the names below. A link or a junction is never followed, whether it is one of those
folders or the `whisper` folder itself, and anything else under `whisper` is left alone.
"""

import os
import shutil
import stat

# The weight types the removed engine could download (the keys of its model table),
# each stored in a folder of that name.
WHISPER_WEIGHT_NAMES = (
    "tiny",
    "base",
    "small",
    "medium",
    "large-v1",
    "large-v2",
    "large-v3",
    "large-v3-turbo-int8",
    "large-v3-turbo",
)


def _plainDirectory(path):
    """True for a real directory: not a symbolic link, not a Windows junction or other reparse point."""
    try:
        info = os.lstat(path)
    except OSError:
        return False
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_reparse_tag", 0):
        return False
    return stat.S_ISDIR(info.st_mode)


def _whisperFolder(root):
    path = os.path.join(root, "weights", "whisper")
    return path if _plainDirectory(path) else None


def _folderBytes(path):
    """The bytes of the regular files under `path`, without following any link."""
    total = 0
    for current, directories, files in os.walk(path, followlinks=False):
        # os.walk lists a link to a directory among the directories but does not enter it.
        for name in files + directories:
            try:
                info = os.lstat(os.path.join(current, name))
            except OSError:
                continue
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
    return total


def _present(root):
    whisper = _whisperFolder(root)
    if whisper is None:
        return {}
    present = {}
    for name in WHISPER_WEIGHT_NAMES:
        path = os.path.join(whisper, name)
        if _plainDirectory(path):
            present[name] = path
    return present


def oldWhisperWeights(root):
    """What is left: {"total_bytes": int, "folders": [weight type, ...]}."""
    present = _present(root)
    return {
        "total_bytes": sum(_folderBytes(path) for path in present.values()),
        "folders": list(present),
    }


def deleteOldWhisperWeights(root):
    """Delete the known Whisper weight folders.

    Returns what remains in the same form as oldWhisperWeights, plus
    "freed_bytes" and "failed" (the folders that could not be removed, for example
    because another program holds a file open).
    """
    before = oldWhisperWeights(root)["total_bytes"]
    failed = []
    for name, path in _present(root).items():
        # Checked again right before removing: the folder may have been replaced by a link.
        if not _plainDirectory(path):
            continue
        try:
            # rmtree removes a link it meets inside the folder, never what the link points to.
            shutil.rmtree(path)
        except OSError:
            failed.append(name)
    whisper = _whisperFolder(root)
    if whisper is not None:
        try:
            # Only when nothing else is left in it.
            os.rmdir(whisper)
        except OSError:
            pass
    remaining = oldWhisperWeights(root)
    return {**remaining, "freed_bytes": max(0, before - remaining["total_bytes"]), "failed": failed}
