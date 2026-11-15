"""Private PipeWire acceptance for the fixed RVC process, with fake inference.

No physical input, target model, network service, or VRChat is involved.
"""
from contextlib import ExitStack
import json
import os
from pathlib import Path
import shutil
import sys
import time

import pytest

from models.audio_routing.pipewire_gate import PipeWireGate, SOURCE
from models.audio_routing.source_bridge import select_source
from tools.voice_acceptance import graph_snapshot, loopback, private_graph, wait_for
from tools.voice_b_poc import ToneCapture, settled, tone

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(sys.platform != 'linux' or os.environ.get('VRCT_TEST_RVC_ROUTE') != '1',
                               reason='opt-in private PipeWire RVC contract test')


@pytest.mark.parametrize('end', ['stop', 'worker_death', 'parent_pause'])
def test_rvc_contract_worker_to_private_mic_and_silence(tmp_path, monkeypatch, end):
    from models.voice_conversion import rvc_process
    from models.voice_conversion.rvc_process import RVCProcess
    from models.voice_conversion.direct_voice import create_converted_process
    from test_native_realtime import SyntheticProducer
    runtime = tmp_path / 'runtime'
    for name in ('lib/' + rvc_process.ORT_LIBRARY, *('assets/' + asset for asset in rvc_process.ASSETS)):
        (runtime / name).parent.mkdir(parents=True, exist_ok=True)
        (runtime / name).touch()
    model = tmp_path / 'fake.pth'
    model.touch()  # Deliberately not an inference model; only the fake worker reads it.
    worker = tmp_path / 'vrct-rvc-worker'
    worker.write_text('#!' + sys.executable + '\n' + '''
import sys,time,struct
sys.path.insert(0, 'src-python')
from models.voice_conversion import protocol as p
assert sys.argv[1::2] == ['--runtime', '--model', '--session', '--index', '--pitch', '--index-rate']
session = sys.argv[sys.argv.index('--session')+1]
out = sys.stdout.buffer
out.write(p.encode_packet(p.ready_info(session, engine='rvc'))); out.flush()
while True:
    info, pcm = p.read_packet(sys.stdin.buffer, timeout=3)
    samples = struct.unpack('<3840h', pcm)
    output = struct.pack('<3840h', *(int(x/2) for x in samples))
    out.write(p.encode_packet(dict(info, type='output', state='converted'), output)); out.flush()
''')
    worker.chmod(0o700)
    if end == 'parent_pause':
        # The router is a separate process that finds the worker in build/: put the fake
        # there for this run and put back whatever was there.
        installed = rvc_process.worker_binary()
        kept = installed.with_name(installed.name + '.kept')

        def restore():
            if kept.exists():
                kept.replace(installed)
            elif installed.exists() and installed.read_bytes() == worker.read_bytes():
                installed.unlink()
        installed.parent.mkdir(exist_ok=True)
        if installed.exists():
            installed.replace(kept)  # Same folder: a rename, never a copy across file systems.
        try:
            shutil.copy2(worker, installed)
        except BaseException:
            restore()
            raise
    else:
        monkeypatch.setattr(rvc_process, 'worker_binary', lambda: worker)
        restore = lambda: None  # noqa: E731
    report = dict(real_rvc=False, physical_capture=False, vrchat=False, case=end, status='failed')
    try:
        with private_graph(config_fragment=ROOT/'config/pipewire/90-vrct-managed.conf'), ExitStack() as stack:
            loopback(stack, 'vrct.native.caption')
            producer = stack.enter_context(SyntheticProducer(tone(440)*80))
            input_observer = ToneCapture(stack, 'vrct.native.caption.source')
            settled(input_observer, time.monotonic_ns(), 'input_not_stable', silent=True)
            capture = ToneCapture(stack, SOURCE)
            gate = PipeWireGate()
            gate.set_muted(False, gate.inspect()['identity'])
            factory = create_converted_process if end == 'parent_pause' else RVCProcess
            vc = factory(dict(engine='rvc', runtime=str(runtime), model=str(model),
                                 index='', pitch=0, index_rate=0.0))
            stack.callback(vc.close)
            vc.start(source=select_source(graph_snapshot(), 'vrct.native.caption.source'))
            wait_for(lambda: vc.health()['active'] or vc.health()['error'], timeout=5)
            assert vc.health()['active'], vc.health()
            settled(capture, time.monotonic_ns(), 'ready_not_silent', silent=True)
            producer.play()
            wait_for(lambda: capture.snapshot()['nonzero_frames'] > 5 or vc.health()['error'], timeout=5)
            assert vc.health()['conversion_verified'] and not vc.health()['error'], vc.health()
            assert capture.snapshot()['nonzero_frames'] > 5
            if end == 'parent_pause':
                import ctypes
                # PyDLL retains this process's GIL throughout the native call,
                # simulating a long collection without depending on heap size.
                pause = ctypes.PyDLL(None).usleep
                pause.argtypes, pause.restype = [ctypes.c_uint], ctypes.c_int
                assert pause(350_000) == 0
                time.sleep(.1)  # Allow health delivery after the imposed pause.
                assert vc.health()['active'] and not vc.health()['error'], vc.health()
                baseline = capture.snapshot()['nonzero_frames']
                wait_for(lambda: capture.snapshot()['nonzero_frames'] > baseline+10, timeout=3)
                vc.stop()
            elif end == 'stop':
                vc.stop()
            else:
                vc._child.kill()
                wait_for(lambda: vc.health()['error'], timeout=3)
            assert vc.close(timeout=3)
            settled(capture, time.monotonic_ns(), 'raw_fallback_after_stop', silent=True)
            # Input is still present throughout the two-second output-silence hold.
            assert input_observer.snapshot()['nonzero_frames'] > 50
            report.update(status='passed', after=vc.health(), silence_hold_ms=2000,
                          capture=capture.snapshot())
    finally:
        restore()
        (tmp_path/'report.json').write_text(json.dumps(report, indent=2)+'\n')
