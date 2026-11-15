"""The virtual microphone check (#321): finding cable pairs and checking one end to end.

No device is opened: the cable is a fake that returns what was played into it.
"""
import json
from threading import Event
import time

import pytest

from models.audio_routing import virtual_mic as vm


def _id(name, host='Windows WASAPI'):
    return json.dumps([host, name])


CABLE_IN = _id('CABLE Input (VB-Audio Virtual Cable)')
CABLE_OUT = _id('CABLE Output (VB-Audio Virtual Cable)')
SPEAKERS = _id('Speakers (Realtek(R) Audio)')
MIC = _id('Microphone (Realtek(R) Audio)')


def test_pairs_the_two_ends_of_a_cable_and_nothing_else():
    pairs = vm.pair_cables([SPEAKERS, CABLE_IN], [MIC, CABLE_OUT])
    assert pairs == [{'playback': CABLE_IN, 'recording': CABLE_OUT,
                      'playback_label': 'CABLE Input (VB-Audio Virtual Cable)',
                      'recording_label': 'CABLE Output (VB-Audio Virtual Cable)'}]


def test_a_cable_end_without_its_other_half_is_not_offered():
    assert vm.pair_cables([CABLE_IN], [MIC]) == []
    assert vm.pair_cables([SPEAKERS], [CABLE_OUT]) == []


def test_a_real_sound_card_is_never_taken_for_a_cable():
    # A sound card's speakers and microphone share a driver name too.
    assert vm.pair_cables([SPEAKERS], [MIC]) == []


def test_steams_remote_play_loop_is_not_offered_as_vrchats_microphone():
    steam_out = _id('Speakers (Steam Streaming Microphone)')
    steam_in = _id('Microphone (Steam Streaming Microphone)')
    assert vm.pair_cables([steam_out], [steam_in]) == []
    assert [p['playback'] for p in vm.pair_cables([steam_out, CABLE_IN], [steam_in, CABLE_OUT])] == [CABLE_IN]


def test_each_cable_is_matched_with_its_own_other_end():
    voicemeeter_in = _id('VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)')
    voicemeeter_out = _id('VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)')
    pairs = vm.pair_cables([CABLE_IN, voicemeeter_in], [voicemeeter_out, CABLE_OUT])
    assert [(p['playback'], p['recording']) for p in pairs] == [(CABLE_IN, CABLE_OUT), (voicemeeter_in, voicemeeter_out)]


def test_the_tone_is_at_its_level_and_the_meter_reads_it():
    pcm = vm.tone()
    assert len(pcm) == 2 * int(vm.TONE_RATE * 0.35) + 2 * int(vm.TONE_RATE * 0.45)
    peak = vm.peak_dbfs(pcm)
    assert -12.5 < peak < -11.5
    assert peak >= vm.HEARD_DBFS
    assert vm.meter(peak) == pytest.approx(0.8, abs=0.02)
    assert vm.meter(vm.peak_dbfs(b'\0\0' * 100)) == 0.0
    assert vm.meter(-80.0) == 0.0
    assert vm.meter(0.0) == 1.0


class _Cable:
    """Both ends of a fake cable: what is written comes back out, scaled by gain."""
    def __init__(self, gain=1.0):
        import numpy as np
        self.np = np
        self.gain = gain
        self.buffer = bytearray()
        self.closed = []

    def output(self, identity):
        cable = self

        class Sink:
            def write(self, pcm, token):
                token.check()
                samples = cable.np.frombuffer(pcm, dtype='<i2') * cable.gain
                cable.buffer.extend(samples.astype('<i2').tobytes())

            def close(self, *, drain, token):
                cable.closed.append('playback')
        return Sink()

    def input(self, identity):
        cable = self

        class Source:
            def read(self):
                time.sleep(0.002)
                size = int(vm.TONE_RATE * vm.BLOCK_SECONDS) * 2
                block, cable.buffer[:] = bytes(cable.buffer[:size]), cable.buffer[size:]
                return block or b'\0\0' * (size // 2)

            def close(self):
                cable.closed.append('recording')
        return Source()


PAIR = {'playback': CABLE_IN, 'recording': CABLE_OUT}


def _run(cable, stop=None):
    levels = []
    result = vm.run_check(PAIR, report=levels.append, stop=stop or Event(),
                          open_output=cable.output, open_input=cable.input)
    return result, levels


def test_a_working_cable_is_heard_and_the_meter_moves():
    cable = _Cable()
    result, levels = _run(cable)
    assert result['heard'] is True and result['stopped'] is False
    assert -13 < result['peak_dbfs'] < -11
    assert max(levels) > 0.7
    assert levels[-1] == 0.0  # The meter rests when the check ends.
    assert sorted(cable.closed) == ['playback', 'recording']


def test_a_muted_cable_is_not_heard():
    result, levels = _run(_Cable(gain=0.0))
    assert result == {'heard': False, 'peak_dbfs': None, 'stopped': False}
    assert max(levels) == 0.0


def test_a_cable_at_a_very_low_volume_is_not_heard():
    result, _ = _run(_Cable(gain=0.01))
    assert result['heard'] is False and result['peak_dbfs'] < vm.HEARD_DBFS


def test_stop_ends_the_tone_and_the_check_at_once():
    stop = Event()
    stop.set()
    result, _ = _run(_Cable(), stop)
    assert result['stopped'] is True and result['heard'] is False


def test_a_recording_end_that_cannot_open_is_reported_and_nothing_plays():
    played = []

    def output(identity):
        played.append(identity)

    def failing_input(identity):
        raise OSError('Unanticipated host error')
    with pytest.raises(RuntimeError, match='virtual_mic_recording_unavailable'):
        vm.run_check(PAIR, report=lambda level: None, stop=Event(), open_output=output, open_input=failing_input)
    assert played == []


def test_a_playback_end_that_cannot_open_is_reported_and_the_recording_end_is_closed():
    cable = _Cable()

    def failing_output(identity):
        raise OSError('busy')
    with pytest.raises(RuntimeError, match='virtual_mic_playback_unavailable'):
        vm.run_check(PAIR, report=lambda level: None, stop=Event(), open_output=failing_output, open_input=cable.input)
    assert cable.closed == ['recording']


def test_only_one_check_runs_at_a_time_and_stop_reaches_it():
    check = vm.VirtualMicCheck()
    started, release = Event(), Event()

    def slow_input(identity):
        class Source:
            def read(self):
                started.set()
                release.wait(2)
                return b'\0\0' * 10

            def close(self):
                pass
        return Source()
    from threading import Thread
    outcome = {}
    worker = Thread(target=lambda: outcome.update(check.run(PAIR, lambda level: None, open_output=_Cable().output,
                                                            open_input=slow_input)))
    worker.start()
    assert started.wait(2)
    with pytest.raises(RuntimeError, match='virtual_mic_check_busy'):
        check.run(PAIR, lambda level: None)
    check.stop()
    release.set()
    worker.join(5)
    assert outcome['stopped'] is True
