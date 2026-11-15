"""The virtual microphone guide's endpoints (#321), on the production Controller source.

The device list and the check are replaced; no device is opened.
"""
import json
from types import SimpleNamespace

from test_controller_integration import controller_module  # noqa: F401

CABLE = {'playback': json.dumps(['Windows WASAPI', 'CABLE Input (VB-Audio Virtual Cable)']),
         'recording': json.dumps(['Windows WASAPI', 'CABLE Output (VB-Audio Virtual Cable)']),
         'playback_label': 'CABLE Input (VB-Audio Virtual Cable)',
         'recording_label': 'CABLE Output (VB-Audio Virtual Cable)'}


def _controller(module, *, output='', muted=False, check=None):
    sent = []
    stub = SimpleNamespace(
        voice_events=SimpleNamespace(settings=SimpleNamespace(output_device=output)),
        voice_route=SimpleNamespace(status=lambda: {'requested_muted': muted}),
        virtual_mic_check=check or SimpleNamespace(run=lambda pair, report: {'heard': True, 'peak_dbfs': -12.0, 'stopped': False}),
        run_mapping={'virtual_mic_level': '/run/virtual_mic_level'},
        run=lambda status, endpoint, data: sent.append((endpoint, data)))
    return stub, sent


def _windows(module, monkeypatch, cables):
    monkeypatch.setattr(module.virtual_mic, 'supported', lambda: True)
    if isinstance(cables, Exception):
        def fail():
            raise cables
        monkeypatch.setattr(module.virtual_mic, 'find_cables', fail)
    else:
        monkeypatch.setattr(module.virtual_mic, 'find_cables', lambda: cables)


def test_status_lists_the_cables_and_whether_tts_already_plays_into_one(controller_module, monkeypatch):  # noqa: F811
    _windows(controller_module, monkeypatch, [CABLE])
    # The TTS output saved through MME carries a name cut at 31 characters.
    stub, _ = _controller(controller_module, output=json.dumps(['MME', 'CABLE Input (VB-Audio Virtual C']))
    result = controller_module.Controller.getVirtualMicStatus(stub)['result']
    assert result['supported'] is True and result['cables'] == [CABLE] and result['error'] is None
    assert result['tts_output_is_cable'] is True


def test_status_without_a_cable_and_with_an_unreadable_list(controller_module, monkeypatch):  # noqa: F811
    _windows(controller_module, monkeypatch, [])
    stub, _ = _controller(controller_module)
    assert controller_module.Controller.getVirtualMicStatus(stub)['result'] == {
        'supported': True, 'cables': [], 'error': None, 'tts_output': None, 'tts_output_is_cable': False}
    _windows(controller_module, monkeypatch, OSError('no audio'))
    result = controller_module.Controller.getVirtualMicStatus(stub)['result']
    assert result['cables'] == [] and result['error'] == 'audio_devices_unavailable'


def test_linux_has_no_guide(controller_module, monkeypatch):  # noqa: F811
    monkeypatch.setattr(controller_module.virtual_mic, 'supported', lambda: False)
    monkeypatch.setattr(controller_module.virtual_mic, 'find_cables', lambda: (_ for _ in ()).throw(AssertionError('not read')))
    stub, _ = _controller(controller_module)
    assert controller_module.Controller.getVirtualMicStatus(stub)['result']['supported'] is False
    assert controller_module.Controller.runVirtualMicTest(stub, {'playback': CABLE['playback']}) == {
        'status': 409, 'result': {'error_code': 'virtual_mic_unsupported'}}


def test_the_check_reports_its_level_and_its_outcome(controller_module, monkeypatch):  # noqa: F811
    _windows(controller_module, monkeypatch, [CABLE])

    class Check:
        def run(self, pair, report):
            assert pair is CABLE
            report(0.8)
            report(0.0)
            return {'heard': True, 'peak_dbfs': -12.1, 'stopped': False}
    stub, sent = _controller(controller_module, check=Check())
    answer = controller_module.Controller.runVirtualMicTest(stub, {'playback': CABLE['playback']})
    assert answer == {'status': 200, 'result': {'heard': True, 'peak_dbfs': -12.1, 'stopped': False,
                                                'playback': CABLE['playback'], 'recording': CABLE['recording']}}
    assert sent == [('/run/virtual_mic_level', {'playback': CABLE['playback'], 'level': 0.8}),
                    ('/run/virtual_mic_level', {'playback': CABLE['playback'], 'level': 0.0})]


def test_no_tone_plays_while_the_voice_is_muted(controller_module, monkeypatch):  # noqa: F811
    _windows(controller_module, monkeypatch, [CABLE])

    class Check:
        def run(self, pair, report):
            raise AssertionError('no tone while muted')
    stub, _ = _controller(controller_module, muted=True, check=Check())
    assert controller_module.Controller.runVirtualMicTest(stub, {'playback': CABLE['playback']}) == {
        'status': 409, 'result': {'error_code': 'virtual_mic_voice_muted'}}


def test_only_a_cable_found_now_can_be_checked(controller_module, monkeypatch):  # noqa: F811
    _windows(controller_module, monkeypatch, [CABLE])
    stub, _ = _controller(controller_module)
    speakers = json.dumps(['Windows WASAPI', 'Speakers (Realtek(R) Audio)'])
    for data in ({'playback': speakers}, {}, None, 'x'):
        assert controller_module.Controller.runVirtualMicTest(stub, data) == {
            'status': 409, 'result': {'error_code': 'virtual_mic_missing'}}


def test_a_device_that_cannot_open_is_reported_by_its_code(controller_module, monkeypatch):  # noqa: F811
    _windows(controller_module, monkeypatch, [CABLE])

    class Check:
        def run(self, pair, report):
            raise RuntimeError('virtual_mic_recording_unavailable')
    stub, _ = _controller(controller_module, check=Check())
    assert controller_module.Controller.runVirtualMicTest(stub, {'playback': CABLE['playback']}) == {
        'status': 409, 'result': {'error_code': 'virtual_mic_recording_unavailable'}}


def test_stop_and_mute_end_a_check_under_way(controller_module):  # noqa: F811
    stopped = []
    stub = SimpleNamespace(virtual_mic_check=SimpleNamespace(stop=lambda: stopped.append(True)),
                           voice_events=SimpleNamespace(cancel=lambda: None),
                           voice_route=SimpleNamespace(mute=lambda: None),
                           getVoiceStatus=lambda: {'status': 200}, getVoiceRoute=lambda: {'status': 200})
    controller_module.Controller.stopVoice(stub)
    controller_module.Controller.muteVoice(stub)
    assert stopped == [True, True]


def test_the_notice_is_pending_until_dismissed(controller_module):  # noqa: F811
    controller_module.config.VIRTUAL_MIC_NOTICE_PENDING = True
    assert controller_module.Controller.getVirtualMicNotice() == {'status': 200, 'result': True}
    assert controller_module.Controller.setDisableVirtualMicNotice() == {'status': 200, 'result': False}
    assert controller_module.Controller.getVirtualMicNotice() == {'status': 200, 'result': False}
