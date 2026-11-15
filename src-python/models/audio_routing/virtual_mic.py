"""The virtual microphone check on Windows (#321).

VRChat hears TTS and converted voice only through a virtual cable: VRCT-VOX plays into the
cable's playback side (such as "CABLE Input") and VRChat records its other side ("CABLE
Output"). This module finds such pairs and checks one end to end: it plays a short test
tone into the playback side and measures the level that comes out of the recording side.

Only the generated tone is played. What is recorded is reduced to a level on the spot and
never kept, logged or sent; a user's speech that happens to pass through the cable at the
same time is not stored either. Nothing here changes a saved device choice.
"""
from threading import Event, Lock, Thread
import math
import sys

from .devices_windows import device_name, is_virtual_cable, same_virtual_cable

# The tone: two short notes at -12 dBFS, loud enough to read clearly through a cable and
# quiet enough not to startle anyone who already hears the cable in VRChat.
TONE_RATE = 48000
TONE_AMPLITUDE = 0.25
TONE_NOTES = ((660.0, 0.35), (880.0, 0.45))
# A cable passes the tone at about its own level. Anything quieter than this did not
# arrive: the cable is muted, set to a very low volume, or is not one cable at all.
HEARD_DBFS = -30.0
# The meter's scale. Below the floor it shows nothing.
METER_FLOOR_DBFS = -60.0
BLOCK_SECONDS = 0.05
# Keep listening a little after the tone, for the cable's own buffering.
TAIL_SECONDS = 0.4


# Loops that count as a cable for feedback protection but are not offered as VRChat's
# microphone: Steam's belongs to Remote Play, and almost every VRChat user has it, so
# counting it would hide the guide from people who have no cable for VRChat.
_NOT_OFFERED = ('steam streaming',)


def supported():
    return sys.platform == 'win32'


def _offered(identity):
    return is_virtual_cable(identity) and not any(word in device_name(identity).lower() for word in _NOT_OFFERED)


def pair_cables(outputs, inputs):
    """Playback and recording ends of the same virtual cable.

    outputs and inputs are device identities (or names). Each playback end is matched with
    the recording end of the same driver; ends without their other half are left out.
    """
    pairs = []
    for output in outputs:
        if not _offered(output):
            continue
        match = next((item for item in inputs if is_virtual_cable(item) and same_virtual_cable(output, item)), None)
        if match is not None:
            pairs.append({'playback': output, 'recording': match,
                          'playback_label': device_name(output), 'recording_label': device_name(match)})
    return pairs


def find_cables():
    """The virtual cables on this computer. Raises when the device list cannot be read."""
    from .devices_windows import enumerate_endpoints, enumerate_outputs
    outputs = [item['id'] for item in enumerate_outputs()]
    inputs = [item['endpoint'].name for item in enumerate_endpoints('mic')]
    return pair_cables(outputs, inputs)


def tone(rate=TONE_RATE):
    """The test tone as mono 16-bit PCM, with short fades so it does not click."""
    import numpy as np
    parts = []
    for frequency, seconds in TONE_NOTES:
        count = int(rate * seconds)
        t = np.arange(count) / rate
        note = np.sin(2 * math.pi * frequency * t)
        fade = min(count // 2, int(rate * 0.02))
        envelope = np.ones(count)
        envelope[:fade] = np.linspace(0, 1, fade)
        envelope[-fade:] = np.linspace(1, 0, fade)
        parts.append(note * envelope)
    samples = np.concatenate(parts) * TONE_AMPLITUDE
    return (samples * 32767).astype('<i2').tobytes()


def peak_dbfs(pcm):
    """The peak of 16-bit PCM in dBFS; silence is -inf."""
    import numpy as np
    samples = np.frombuffer(pcm, dtype='<i2')
    if samples.size == 0:
        return float('-inf')
    peak = int(np.max(np.abs(samples.astype(np.int32))))
    return float('-inf') if peak == 0 else 20 * math.log10(peak / 32768)


def meter(dbfs):
    """A level for the meter, from 0 (at or below the floor) to 1 (full scale)."""
    if dbfs == float('-inf') or dbfs <= METER_FLOOR_DBFS:
        return 0.0
    return round(min(1.0, (dbfs - METER_FLOOR_DBFS) / -METER_FLOOR_DBFS), 3)


class _Token:
    """What WindowsOutput expects of a cancel token."""
    def __init__(self, event):
        self._event = event

    def is_set(self):
        return self._event.is_set()

    def check(self):
        if self._event.is_set():
            from models.tts.speechcpp_tts import SpeechError
            raise SpeechError('cancelled')


def run_check(pair, *, report, stop, open_output=None, open_input=None):
    """Play the tone into pair['playback'] and measure what comes out of pair['recording'].

    report(level) is called for each block with the meter level (0 to 1). stop is an Event:
    setting it ends the tone and the check at once (the user stopped or muted the voice).
    Returns {'heard': bool, 'peak_dbfs': float or None, 'stopped': bool}.
    Raises RuntimeError with a lowercase code when a device cannot be opened.
    """
    open_output = open_output or _open_output
    open_input = open_input or _open_input
    try:
        source = open_input(pair['recording'])
    except Exception as exc:
        raise RuntimeError('virtual_mic_recording_unavailable') from exc
    try:
        try:
            sink = open_output(pair['playback'])
        except Exception as exc:
            raise RuntimeError('virtual_mic_playback_unavailable') from exc
        pcm = tone()
        failed = []

        def play():
            token = _Token(stop)
            step = int(TONE_RATE * BLOCK_SECONDS) * 2
            try:
                for start in range(0, len(pcm), step):
                    if stop.is_set():
                        break
                    sink.write(pcm[start:start + step], token)
            except Exception as exc:  # A cancel, or the device went away.
                if not stop.is_set():
                    failed.append(exc)
            finally:
                try:
                    sink.close(drain=not stop.is_set(), token=token)
                except Exception:
                    pass

        player = Thread(target=play, name='vrct-virtual-mic-tone', daemon=True)
        player.start()
        blocks = int((sum(seconds for _, seconds in TONE_NOTES) + TAIL_SECONDS) / BLOCK_SECONDS)
        loudest = float('-inf')
        for _ in range(blocks):
            if stop.is_set():
                break
            level = peak_dbfs(source.read())
            loudest = max(loudest, level)
            report(meter(level))
        player.join(2)
        report(0.0)
        if failed:
            raise RuntimeError('virtual_mic_playback_unavailable')
        stopped = stop.is_set()
        return {'heard': not stopped and loudest >= HEARD_DBFS,
                'peak_dbfs': None if loudest == float('-inf') else round(loudest, 1),
                'stopped': stopped}
    finally:
        source.close()


def _open_output(identity):
    from .devices_windows import WindowsOutput
    return WindowsOutput(identity, TONE_RATE, 1)


class _Input:
    """The recording end, read in blocks as mono 16-bit PCM."""
    def __init__(self, identity):
        import pyaudiowpatch as audio
        from pyaudio_lock import pyaudio_op_lock
        from .devices_windows import _identity, _endpoint_rows, prepare_audio_thread
        prepare_audio_thread()
        self._lock = pyaudio_op_lock
        with pyaudio_op_lock:
            self.pa = audio.PyAudio()
            try:
                matches = [info for info in _endpoint_rows(self.pa, audio, 'mic')
                           if _identity(self.pa, info) == identity]
                if len(matches) != 1:
                    raise LookupError('endpoint_missing')
                info = matches[0]
                self.rate = int(info['defaultSampleRate'])
                self.channels = max(1, min(2, int(info['maxInputChannels'])))
                self.frames = max(1, int(self.rate * BLOCK_SECONDS))
                self.stream = self.pa.open(format=audio.paInt16, channels=self.channels, rate=self.rate,
                                           input=True, input_device_index=int(info['index']),
                                           frames_per_buffer=self.frames)
            except Exception:
                self.pa.terminate()
                raise

    def read(self):
        # The peak of every channel counts, so the samples need not be split.
        return self.stream.read(self.frames, exception_on_overflow=False)

    def close(self):
        with self._lock:
            try:
                self.stream.close()
            finally:
                self.pa.terminate()


def _open_input(identity):
    return _Input(identity)


class VirtualMicCheck:
    """One check at a time, stoppable from the stop and mute requests."""
    def __init__(self):
        self._lock = Lock()
        self._stop = None

    def stop(self):
        with self._lock:
            if self._stop is not None:
                self._stop.set()

    def run(self, pair, report, **kwargs):
        with self._lock:
            if self._stop is not None:
                raise RuntimeError('virtual_mic_check_busy')
            self._stop = stop = Event()
        try:
            return run_check(pair, report=report, stop=stop, **kwargs)
        finally:
            with self._lock:
                self._stop = None
