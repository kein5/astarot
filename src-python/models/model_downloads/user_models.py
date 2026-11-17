"""Model files the user registers under a name, listed next to the reviewed catalog (#403).

A registration only remembers where a file is: nothing is copied, moved, downloaded or
deleted, and removing a registration leaves the file alone. Using a registered model is a
separate request that writes its paths into the settings, through the same checks as applying
a download (the saved value the user saw, the target stopped).

The registrations live in `user_models.json` next to config.json. Each file is recorded with
its size and modification time; a file that is gone or differs from the recorded one is
reported (`missing`, `changed`) and cannot be used until it is registered again. No SHA-256 is
computed: a model file can be several GiB.

Names and paths are the user's own data. Nothing here logs them, and the IPC routes carry
`user_model` in their names so the process log masks their payloads (utils.py).
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import stat
from threading import RLock
from uuid import uuid4

FILE_NAME = 'user_models.json'
FORMAT_VERSION = 1
# A registered file goes where a catalog file of the same target goes (catalog.SPEECH_FIELDS,
# DIRECT_VOICE_SETTINGS rvc_model / rvc_index). Translation and chat reading are not offered.
SPEECH_TARGETS = ('japanese', 'multilingual', 'asr', 'vad', 'diarization')
TARGETS = (*SPEECH_TARGETS, 'rvc')
SUFFIXES = {'model': '.gguf'}
RVC_SUFFIXES = {'model': '.pth', 'index': '.index'}
NAME_LIMIT = 80
PATH_LIMIT = 4096
MODEL_LIMIT = 200


def suffixes(target):
    """{role: file suffix} a target takes; the model role is required, the RVC index is not."""
    return RVC_SUFFIXES if target == 'rvc' else SUFFIXES


def valid_name(name):
    return (isinstance(name, str) and name == name.strip() and 0 < len(name) <= NAME_LIMIT
            and all(ch.isprintable() for ch in name))


def same_path(a, b):
    return os.path.normcase(os.path.normpath(a)) == os.path.normcase(os.path.normpath(b))


def file_record(path):
    """{path, size, mtime_ns} of a regular file (links followed), or a ValueError code."""
    try:
        info = os.stat(path)
    except OSError:
        raise ValueError('user_model_file_missing') from None
    if not stat.S_ISREG(info.st_mode):
        raise ValueError('user_model_file_missing')
    return {'path': path, 'size': info.st_size, 'mtime_ns': info.st_mtime_ns}


def file_status(record):
    """'ok', 'missing' or 'changed' for one recorded file."""
    try:
        current = file_record(record['path'])
    except ValueError:
        return 'missing'
    return 'ok' if (current['size'], current['mtime_ns']) == (record['size'], record['mtime_ns']) else 'changed'


def _valid_row(row):
    if not isinstance(row, dict) or not isinstance(row.get('id'), str) or row.get('target') not in TARGETS:
        return False
    files = row.get('files')
    roles = suffixes(row['target'])
    return (valid_name(row.get('name')) and isinstance(files, dict) and 'model' in files and set(files) <= set(roles)
            and all(isinstance(f, dict) and isinstance(f.get('path'), str) and type(f.get('size')) is int
                    and type(f.get('mtime_ns')) is int for f in files.values()))


class UserModels:
    """The registrations of one state directory. Every method is safe to call from any thread."""

    def __init__(self, path):
        self.path = Path(path)
        self.lock = RLock()

    def _read(self):
        try:
            text = self.path.read_text(encoding='utf-8')
        except FileNotFoundError:
            return []
        except OSError:
            raise ValueError('user_models_unreadable') from None
        try:
            data = json.loads(text)
        except ValueError:
            raise ValueError('user_models_unreadable') from None
        if (not isinstance(data, dict) or data.get('version') != FORMAT_VERSION
                or not isinstance(data.get('models'), list) or not all(_valid_row(row) for row in data['models'])):
            # A file of a newer version or edited by hand is left as it is, never overwritten.
            raise ValueError('user_models_unreadable')
        return data['models']

    def _write(self, models):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f'.{FILE_NAME}.{uuid4().hex}.tmp')
        try:
            with temporary.open('x', encoding='utf-8') as output:
                json.dump({'version': FORMAT_VERSION, 'models': models}, output, ensure_ascii=False, indent=2)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.path)
        except OSError:
            temporary.unlink(missing_ok=True)
            raise ValueError('user_models_write_failed') from None

    @staticmethod
    def _view(row):
        statuses = [file_status(record) for record in row['files'].values()]
        status = 'missing' if 'missing' in statuses else 'changed' if 'changed' in statuses else 'ok'
        return {'id': row['id'], 'target': row['target'], 'name': row['name'],
                'paths': {role: record['path'] for role, record in row['files'].items()},
                'total_bytes': sum(record['size'] for record in row['files'].values()),
                'registered_at': row.get('registered_at'), 'status': status}

    def state(self):
        """{models: [{id, target, name, paths, total_bytes, registered_at, status}]}, and
        `error_code` when the file cannot be read."""
        with self.lock:
            try:
                return {'models': [self._view(row) for row in self._read()]}
            except ValueError as error:
                return {'models': [], 'error_code': str(error)}

    def register(self, request):
        """Adds `{target, name, paths: {role: path}}`. The file must exist; it is not opened."""
        if not isinstance(request, dict) or set(request) != {'target', 'name', 'paths'}:
            raise ValueError('user_model_invalid')
        target, name, paths = request['target'], request['name'], request['paths']
        if target not in TARGETS or not isinstance(paths, dict):
            raise ValueError('user_model_invalid')
        if not valid_name(name):
            raise ValueError('user_model_name_invalid')
        roles = suffixes(target)
        if 'model' not in paths or not set(paths) <= set(roles):
            raise ValueError('user_model_invalid')
        for role, path in paths.items():
            if (not isinstance(path, str) or not path or len(path) > PATH_LIMIT or '\0' in path
                    or path != path.strip() or not os.path.isabs(path)):
                raise ValueError('user_model_path_invalid')
            if not path.lower().endswith(roles[role]):
                raise ValueError('user_model_file_type')
        files = {role: file_record(path) for role, path in paths.items()}
        with self.lock:
            models = self._read()
            if len(models) >= MODEL_LIMIT:
                raise ValueError('user_model_limit')
            for row in models:
                if row['target'] == target and (row['name'] == name or same_path(row['files']['model']['path'], paths['model'])):
                    raise ValueError('user_model_exists')
            models.append({'id': 'user-' + uuid4().hex[:12], 'target': target, 'name': name, 'files': files,
                           'registered_at': datetime.now(timezone.utc).isoformat(timespec='seconds')})
            self._write(models)
            return self.state()

    def remove(self, request):
        """Forgets `{id}`. The files stay where they are, and settings that name them keep them."""
        if not isinstance(request, dict) or set(request) != {'id'} or not isinstance(request['id'], str):
            raise ValueError('user_model_invalid')
        with self.lock:
            models = self._read()
            kept = [row for row in models if row['id'] != request['id']]
            if len(kept) == len(models):
                raise ValueError('user_model_unknown')
            self._write(kept)
            return self.state()

    def usable(self, id):
        """(target, {role: path}) of a registration whose files are as recorded."""
        with self.lock:
            row = next((row for row in self._read() if row['id'] == id), None)
        if row is None:
            raise ValueError('user_model_unknown')
        view = self._view(row)
        if view['status'] != 'ok':
            raise ValueError('user_model_' + view['status'])
        return view['target'], view['paths']
