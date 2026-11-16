"""Models the user registers under a name (#403): the registry and the controller routes."""

import ast
import json
import os
from pathlib import Path

import pytest

from models.model_downloads.user_models import FILE_NAME, UserModels
from test_controller_integration import controller_module as controller_module

__all__ = ['controller_module']


@pytest.fixture
def files(tmp_path):
    model = tmp_path / 'voice.gguf'
    model.write_bytes(b'GGUF' + b'x' * 60)
    return tmp_path, str(model)


def register(models, path, target='japanese', name='My voice', **extra):
    return models.register({'target': target, 'name': name, 'paths': {'model': path, **extra}})


def test_a_registered_file_is_listed_without_being_opened_or_copied(files):
    root, path = files
    models = UserModels(root / FILE_NAME)
    state = register(models, path)
    (row,) = state['models']
    assert (row['name'], row['target'], row['status'], row['total_bytes']) == ('My voice', 'japanese', 'ok', 64)
    assert row['paths'] == {'model': path} and row['id'].startswith('user-')
    assert sorted(p.name for p in root.iterdir()) == [FILE_NAME, 'voice.gguf'], 'nothing copied, no temporary left'
    saved = json.loads((root / FILE_NAME).read_text(encoding='utf-8'))
    assert saved['version'] == 1 and saved['models'][0]['files']['model']['size'] == 64
    assert models.usable(row['id']) == ('japanese', {'model': path})


def test_a_changed_or_missing_file_is_reported_and_cannot_be_used(files):
    root, path = files
    models = UserModels(root / FILE_NAME)
    id = register(models, path)['models'][0]['id']
    Path(path).write_bytes(b'GGUF but different')
    assert models.state()['models'][0]['status'] == 'changed'
    with pytest.raises(ValueError, match='user_model_changed'):
        models.usable(id)
    os.remove(path)
    assert models.state()['models'][0]['status'] == 'missing'
    with pytest.raises(ValueError, match='user_model_missing'):
        models.usable(id)


@pytest.mark.parametrize('request_, code', [
    (None, 'user_model_invalid'),
    ({'target': 'ocr', 'name': 'x', 'paths': {'model': 'PATH'}}, 'user_model_invalid'),
    ({'target': 'japanese', 'name': 'x', 'paths': {'model': 'PATH'}, 'url': 'https://x'}, 'user_model_invalid'),
    ({'target': 'japanese', 'name': ' x', 'paths': {'model': 'PATH'}}, 'user_model_name_invalid'),
    ({'target': 'japanese', 'name': 'a\nb', 'paths': {'model': 'PATH'}}, 'user_model_name_invalid'),
    ({'target': 'japanese', 'name': 'x' * 81, 'paths': {'model': 'PATH'}}, 'user_model_name_invalid'),
    ({'target': 'japanese', 'name': 'x', 'paths': {'index': 'PATH'}}, 'user_model_invalid'),
    ({'target': 'japanese', 'name': 'x', 'paths': {'model': 'voice.gguf'}}, 'user_model_path_invalid'),
    ({'target': 'rvc', 'name': 'x', 'paths': {'model': 'PATH'}}, 'user_model_file_type'),
    ({'target': 'japanese', 'name': 'x', 'paths': {'model': 'MISSING'}}, 'user_model_file_missing'),
])
def test_bad_registrations_are_refused_and_write_nothing(files, request_, code):
    root, path = files
    models = UserModels(root / FILE_NAME)
    if isinstance(request_, dict):
        request_ = json.loads(json.dumps(request_).replace('MISSING', json.dumps(str(root / 'none.gguf'))[1:-1])
                              .replace('PATH', json.dumps(path)[1:-1]))
    with pytest.raises(ValueError, match=code):
        models.register(request_)
    assert not (root / FILE_NAME).exists()


def test_the_same_name_or_file_is_refused_within_a_target(files):
    root, path = files
    models = UserModels(root / FILE_NAME)
    register(models, path)
    with pytest.raises(ValueError, match='user_model_exists'):
        register(models, path, name='Other name')
    with pytest.raises(ValueError, match='user_model_exists'):
        other = root / 'other.gguf'
        other.write_bytes(b'GGUF')
        register(models, str(other))
    # One file may serve another target.
    assert len(register(models, path, target='multilingual')['models']) == 2


def test_removing_forgets_the_registration_and_keeps_the_file(files):
    root, path = files
    models = UserModels(root / FILE_NAME)
    id = register(models, path)['models'][0]['id']
    with pytest.raises(ValueError, match='user_model_unknown'):
        models.remove({'id': 'user-none'})
    assert models.remove({'id': id}) == {'models': []}
    assert Path(path).exists()


def test_an_unreadable_list_is_reported_and_never_overwritten(files):
    root, path = files
    (root / FILE_NAME).write_text('{ not json', encoding='utf-8')
    models = UserModels(root / FILE_NAME)
    assert models.state() == {'models': [], 'error_code': 'user_models_unreadable'}
    with pytest.raises(ValueError, match='user_models_unreadable'):
        register(models, path)
    assert (root / FILE_NAME).read_text(encoding='utf-8') == '{ not json'


def test_rvc_takes_a_model_and_an_optional_index(files):
    root, _ = files
    pth, index = root / 'voice.pth', root / 'voice.index'
    pth.write_bytes(b'pth'); index.write_bytes(b'index')
    models = UserModels(root / FILE_NAME)
    row = models.register({'target': 'rvc', 'name': 'A', 'paths': {'model': str(pth), 'index': str(index)}})['models'][0]
    assert row['paths'] == {'model': str(pth), 'index': str(index)} and row['total_bytes'] == 8
    alone = root / 'alone.pth'
    alone.write_bytes(b'pth')
    row = models.register({'target': 'rvc', 'name': 'B', 'paths': {'model': str(alone)}})['models'][1]
    assert row['paths'] == {'model': str(alone)}
    with pytest.raises(ValueError, match='user_model_file_type'):
        models.register({'target': 'rvc', 'name': 'C', 'paths': {'model': str(alone), 'index': str(pth)}})


def test_switching_writes_only_the_profile_path_after_the_same_checks_as_a_download(controller_module, files, monkeypatch):
    root, path = files
    c = controller_module.Controller()
    c.user_models = UserModels(root / FILE_NAME)
    c._speech_settings['profiles']['japanese'].update(model='/old.gguf', low_latency=True, device='cpu')
    id = c.registerUserModel({'target': 'japanese', 'name': 'Mine', 'paths': {'model': path}})['result']['models'][0]['id']
    # The saved value the user saw must still be there.
    stale = c.applyUserModel({'id': id, 'expected': {'model': '/elsewhere.gguf'}})
    assert (stale['status'], stale['result']['error_code']) == (409, 'settings_changed')
    monkeypatch.setattr(c.speech_servers, 'state', lambda: {'japanese': {'state': 'ready'}})
    assert c.applyUserModel({'id': id, 'expected': {'model': '/old.gguf'}})['result']['error_code'] == 'model_target_busy'
    monkeypatch.undo()
    answer = c.applyUserModel({'id': id, 'expected': {'model': '/old.gguf'}})
    assert answer['status'] == 200 and answer['result']['models'][0]['id'] == id
    row = c.getSpeechServerSettings()['result']['profiles']['japanese']
    assert (row['model'], row['low_latency'], row['device']) == (path, True, 'cpu')
    assert c.speech_servers.state()['japanese']['state'] == 'stopped'
    assert c.voice_events.status()['accepted'] == 0


def test_a_changed_file_is_not_switched_to(controller_module, files):
    root, path = files
    c = controller_module.Controller()
    c.user_models = UserModels(root / FILE_NAME)
    id = c.registerUserModel({'target': 'japanese', 'name': 'Mine', 'paths': {'model': path}})['result']['models'][0]['id']
    Path(path).write_bytes(b'other')
    answer = c.applyUserModel({'id': id, 'expected': {'model': ''}})
    assert (answer['status'], answer['result']['error_code']) == (400, 'user_model_changed')
    assert c.getSpeechServerSettings()['result']['profiles']['japanese']['model'] == ''


def test_rvc_switching_sets_both_paths_and_keeps_the_runtime(controller_module, files):
    from models.voice_conversion.settings import DirectSettings

    root, _ = files
    pth = root / 'voice.pth'
    pth.write_bytes(b'pth')
    c = controller_module.Controller()
    c.user_models = UserModels(root / FILE_NAME)
    c._direct_settings = DirectSettings(rvc_runtime='/owned/runtime', rvc_model='/old.pth', rvc_index='/old.index', rvc_pitch=3)
    id = c.registerUserModel({'target': 'rvc', 'name': 'Mine', 'paths': {'model': str(pth)}})['result']['models'][0]['id']
    assert c.applyUserModel({'id': id, 'expected': {'model': '/old.pth', 'index': '/old.index'}})['status'] == 200
    saved = c._direct_settings
    # A model registered without an index clears the old one: it belongs to the old voice.
    assert (saved.rvc_model, saved.rvc_index, saved.rvc_runtime, saved.rvc_pitch) == (str(pth), '', '/owned/runtime', 3)
    assert not c.direct_voice.health()['requested']


@pytest.mark.parametrize('method,payload', [
    ('registerUserModel', None), ('removeUserModel', {}), ('applyUserModel', {'id': 'x'}),
    ('applyUserModel', {'id': '', 'expected': {}}),
])
def test_malformed_requests_fail_with_a_code(controller_module, tmp_path, method, payload):
    c = controller_module.Controller()
    c.user_models = UserModels(tmp_path / FILE_NAME)
    answer = getattr(c, method)(payload)
    assert answer['status'] == 400 and answer['result']['error_code'].startswith('user_model')
    assert not (tmp_path / FILE_NAME).exists()


def test_user_model_routes_are_registered_and_masked_in_the_log():
    root = Path(__file__).resolve().parents[2]
    tree = ast.parse((root / 'src-python/mainloop.py').read_text(encoding='utf-8'))
    paths = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    import utils
    for path in ('/get/data/user_models', '/run/register_user_model', '/run/remove_user_model', '/run/apply_user_model'):
        assert path in paths
        assert utils._isSensitiveEndpoint(path), path
