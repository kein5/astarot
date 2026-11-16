"""RVC control and pipe boundaries without any model or audio device."""

import sys

import pytest

from models.voice_conversion import direct_voice, protocol as p
from models.voice_conversion.settings import (
    DirectSettings,
    normalize_settings,
    start_options,
)
from tools.voice_acceptance import wait_for

OPTIONS = dict(
    engine="rvc",
    runtime="/allowed/rvc",
    model="/allowed/voice.pth",
    index="",
    pitch=0,
    index_rate=0.0,
)


def test_legacy_settings_gain_seed_default_without_losing_intent():
    saved = DirectSettings.from_dict(
        dict(mode="converted", runtime="/seed", reference="/ref.wav")
    )
    assert getattr(saved, "engine", None) == "seed-vc"
    assert saved.runtime == "/seed" and saved.reference == "/ref.wav"
    assert start_options(
        "converted", dict(runtime="/seed", reference="/ref.wav")
    ) == dict(runtime="/seed", reference="/ref.wav")


def test_rvc_settings_and_options_round_trip_without_installed_models():
    data = dict(
        mode="converted",
        engine="rvc",
        rvc_runtime="/not-installed",
        rvc_model="/permitted.pth",
        rvc_index="",
        rvc_pitch=-12,
        rvc_index_rate=0.0,
    )
    saved = normalize_settings(data)
    assert saved is not None and saved["engine"] == "rvc"
    assert DirectSettings.from_dict(saved).to_dict() == saved
    assert start_options("converted", OPTIONS) == OPTIONS


@pytest.mark.parametrize(
    "change",
    [
        dict(engine="unknown"),
        dict(pitch=True),
        dict(pitch=25),
        dict(pitch=1.5),
        dict(index_rate=float("nan")),
        dict(index_rate=True),
        dict(index_rate=1.1),
        dict(index_rate=0.5),
        dict(model="/x.wav"),
        dict(index="/x.txt"),
        dict(runtime=""),
        dict(download=True),
    ],
)
def test_invalid_rvc_options_rejected(change):
    with pytest.raises(ValueError):
        start_options("converted", dict(OPTIONS, **change))


def test_ready_handshake_binds_engine_to_session():
    ready = dict(p.ready_info("a" * 32, engine="rvc"), pcm_bytes=0)
    p.require_ready(ready, b"", "a" * 32, engine="rvc")
    with pytest.raises(p.ProtocolError, match="vc_ready_invalid"):
        p.require_ready(ready, b"", "a" * 32)
    with pytest.raises(p.ProtocolError):
        p.ready_info("a" * 32, engine="arbitrary-module")


def test_rvc_ready_says_where_it_converts_and_the_delay_it_adds():
    """What vrct-rvc-worker writes (src/bin/rvc_worker.rs, serve)."""
    session = "a" * 32
    gpu = dict(type="ready", protocol=1, session=session, engine="rvc", profile="low", rate=48000,
               channels=1, block_frames=3840, latency_ms=52, pcm_bytes=0)
    assert p.require_ready(gpu, b"", session, engine="rvc") == ("gpu", 52)
    cpu = dict(gpu, profile="cpu", latency_ms=1183)
    assert p.require_ready(cpu, b"", session, engine="rvc") == ("cpu", 1183)
    for change in (dict(profile="npu"), dict(latency_ms=-1), dict(latency_ms=10_001), dict(latency_ms=1.0),
                   dict(latency_ms=True), dict(latency_ms=None)):
        with pytest.raises(p.ProtocolError, match="vc_ready_invalid"):
            p.require_ready(dict(gpu, **change), b"", session, engine="rvc")
    missing = dict(gpu)
    del missing["latency_ms"]
    with pytest.raises(p.ProtocolError, match="vc_ready_invalid"):
        p.require_ready(missing, b"", session, engine="rvc")
    # Seed-VC's ready packet is unchanged and says nothing of either.
    seed = dict(p.ready_info(session), pcm_bytes=0)
    assert "latency_ms" not in seed and p.require_ready(seed, b"", session) == (None, None)
    with pytest.raises(p.ProtocolError, match="vc_ready_invalid"):
        p.require_ready(dict(seed, latency_ms=0), b"", session)


@pytest.mark.skipif(sys.platform != "linux", reason="Linux worker")
def test_factory_selects_rvc_without_loading_seed(monkeypatch):
    from models.voice_conversion import rvc_process
    from models.voice_conversion.isolated import IsolatedVCProcess

    received = []
    marker = object()
    monkeypatch.setattr(
        rvc_process, "RVCProcess", lambda options: received.append(options) or marker
    )
    assert isinstance(direct_voice.create_converted_process(OPTIONS), IsolatedVCProcess)
    assert received == [OPTIONS]
    assert direct_voice.create_worker_process(OPTIONS) is marker


def test_missing_rvc_runtime_fails_before_capture(tmp_path, monkeypatch):
    from models.voice_conversion import rvc_process

    worker = tmp_path / "vrct-rvc-worker"
    monkeypatch.setattr(rvc_process, "worker_binary", lambda: worker)
    # A build without the worker says so rather than pointing at the runtime.
    with pytest.raises(ValueError, match="vc_engine_unavailable"):
        direct_voice.create_converted_process(OPTIONS)
    worker.touch()
    with pytest.raises(ValueError, match="vc_runtime_missing"):
        direct_voice.create_converted_process(OPTIONS)


def test_a_runtime_of_the_earlier_python_kind_is_refused_before_capture(tmp_path, monkeypatch):
    """A saved runtime folder from the PyTorch runtime has no lib/: set it up again."""
    from models.voice_conversion import rvc_process

    worker = tmp_path / "vrct-rvc-worker"
    worker.touch()
    monkeypatch.setattr(rvc_process, "worker_binary", lambda: worker)
    runtime = tmp_path / "rvc"
    for name in ("venv/bin/python", "engine/infer.py", "assets/hubert_base/pytorch_model.bin",
                 "assets/hubert_base/config.json", "assets/rmvpe/rmvpe.pt"):
        (runtime / name).parent.mkdir(parents=True, exist_ok=True)
        (runtime / name).touch()
    model = tmp_path / "voice.pth"
    model.touch()
    options = dict(OPTIONS, runtime=str(runtime), model=str(model))
    with pytest.raises(ValueError, match="vc_runtime_missing"):
        rvc_process.RVCProcess(options)
    for name in ("lib/" + rvc_process.ORT_LIBRARY, "assets/rmvpe/rmvpe.onnx"):
        (runtime / name).parent.mkdir(parents=True, exist_ok=True)
        (runtime / name).touch()
    assert rvc_process.runtime_complete(runtime)


@pytest.mark.skipif(sys.platform != "linux", reason="Linux worker")
@pytest.mark.parametrize(
    "fault, expected",
    [
        ("converted", None),
        ("late", "vc_block_expired"),
        ("bypass", "vc_passthrough_forbidden"),
        ("wrong_session", "vc_output_invalid"),
        ("eof", "vc_worker_eof"),
        ("wrong_engine", "vc_ready_invalid"),
        ("load_stall", None),
    ],
)
def test_rvc_uses_same_bounded_stop_and_output_contract(
    tmp_path, monkeypatch, fault, expected
):
    from test_seedvc_live import fixture, send, ready

    with fixture(tmp_path, monkeypatch, mode=fault, engine="rvc") as (
        vc,
        captures,
        children,
        sent,
        closed,
        _,
    ):
        if fault == "load_stall":
            wait_for(lambda: children, timeout=3)
        elif fault == "wrong_engine":
            wait_for(lambda: vc.health()["error"], timeout=3)
            assert captures == []
        else:
            ready(vc, captures)
            assert not vc.health()["conversion_verified"]
            send(captures[-1])
            wait_for(
                lambda: vc.health()["conversion_verified"] or vc.health()["error"],
                timeout=3,
            )
        if expected:
            assert vc.health()["error"] == expected
            assert sent == []
        elif fault == "converted":
            assert vc.health()["conversion_verified"] and len(sent) == 1
            # The fake's ready packet is the GPU one with no added delay.
            assert (vc.health()["device"], vc.health()["latency_ms"]) == ("gpu", 0)
        vc.stop()
        before = list(sent)
        if captures:
            send(captures[-1])
        assert vc.close(3)
        assert sent == before and not vc.health()["active"]


def test_a_worker_that_cannot_keep_up_stops_with_that_reason():
    """The RVC worker on the CPU answers at once, so it says when it falls behind."""
    session = "a" * 32
    source = dict(p.input_info(session, 0, 1_000), pcm_bytes=p.PCM_BYTES)
    original = b"\1\0" * p.FRAMES
    failed = dict(type="failed", protocol=1, session=session, code="vc_capture_overrun", pcm_bytes=0)
    with pytest.raises(p.ProtocolError, match="vc_capture_overrun"):
        p.require_output(failed, b"", source, original, source["end_ns"])
    for change in (dict(code="vc_model_missing"), dict(session="b" * 32), dict(extra=1)):
        with pytest.raises(p.ProtocolError, match="vc_output_invalid"):
            p.require_output(dict(failed, **change), b"", source, original, source["end_ns"])
    with pytest.raises(p.ProtocolError, match="vc_output_invalid"):
        p.require_output(failed, b"\0\0", source, original, source["end_ns"])
