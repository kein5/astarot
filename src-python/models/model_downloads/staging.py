"""One owner per download root, including across processes and interrupted runs."""
import json
import os
import re
import stat
import sys


class RootLease:
    def __init__(self, root):
        self.path = root / '.download.lock'
        self.fd = None

    def acquire(self):
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError('unsafe_destination')
            if sys.platform == 'win32':
                import msvcrt
                if os.fstat(fd).st_size == 0:
                    os.write(fd, b'\0'); os.lseek(fd, 0, 0)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            os.close(fd)
            if error.errno in (11, 13, 35):
                raise ValueError('download_busy') from None
            raise
        except Exception:
            os.close(fd); raise
        self.fd = fd

    def close(self):
        if self.fd is not None:
            os.close(self.fd); self.fd = None


def mark_owned(path, entry):
    data = dict(product='VRCT-VOX-model-download-v1', id=entry.id, revision=entry.revision,
                files=[a.filename for a in entry.artifacts], directory=path.name)
    with (path / 'owner.json').open('x', encoding='utf-8') as out:
        json.dump(data, out); out.flush(); os.fsync(out.fileno())


PARTIAL = re.compile(r'\.partial-[0-9a-f]{32}')


def _marker(path):
    marker = path / 'owner.json'
    if not stat.S_ISREG(marker.lstat().st_mode) or marker.stat().st_size > 4096:
        return None
    data = json.loads(marker.read_text(encoding='utf-8'))
    return data if isinstance(data, dict) else None


def _owned_children(path, name, entries, extra_files=()):
    """The children of path when its marker names an entry and staging name exactly and every
    child is a regular file that entry owns; None otherwise."""
    data = _marker(path)
    entry = entries.get(data.get('id')) if data is not None else None
    if (entry is None or data != dict(product='VRCT-VOX-model-download-v1', id=entry.id,
            revision=entry.revision, files=[a.filename for a in entry.artifacts], directory=name)):
        return None
    children = list(path.iterdir())
    allowed = {'owner.json', 'receipt.json', *extra_files, *(a.filename for a in entry.artifacts)}
    if any(p.name not in allowed or not stat.S_ISREG(p.lstat().st_mode) for p in children):
        return None
    return children


def recover_owned(root, entries, *, extra_files=()):
    """Caller holds RootLease. Never follow links or remove unrecognized content."""
    for path in root.glob('.partial-*'):
        if not PARTIAL.fullmatch(path.name) or not stat.S_ISDIR(path.lstat().st_mode):
            continue
        try:
            children = _owned_children(path, path.name, entries, extra_files)
            if children is None:
                continue
            for child in children: child.unlink()
            path.rmdir()
        except (FileNotFoundError, ValueError, TypeError, AttributeError):
            # Unknown/incomplete journals are not evidence that we own user files.
            continue


def reclaim_published(root, final, entry):
    """Move a published entry whose files failed their check out of the way; True if moved.

    Only a folder this app wrote moves: its marker names the entry and the staging name it was
    published from, and it holds only the entry's files, the marker and the receipt. It goes back
    to that staging name and is removed by the rule of recover_owned; if the process stops in
    between, the next owner of the root removes it. Anything else stays. Caller holds RootLease.
    """
    entries = {entry.id: entry}
    try:
        data = _marker(final)
        name = data.get('directory') if data is not None else None
        if not isinstance(name, str) or not PARTIAL.fullmatch(name):
            return False
        if _owned_children(final, name, entries) is None:
            return False
    except (FileNotFoundError, ValueError, TypeError, AttributeError):
        return False
    aside = root / name
    if os.path.lexists(aside):
        return False
    try:
        final.rename(aside)
    except OSError:
        # A file in use (Windows) keeps the folder where it is.
        return False
    try:
        recover_owned(root, entries)
    except OSError:
        pass  # The next owner of the root removes it.
    return True
