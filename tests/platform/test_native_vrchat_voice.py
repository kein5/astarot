"""Opt-in: one typed message is shown by a real VRChat and heard once on the managed microphone.

The same send goes two ways. Over OSC it reaches the chatbox lab's speaker client, whose chat
bubble the camera client shows and the app's chat reading reads back, as
test_native_vrchat_roundtrip.py checks. Through the app's text to speech it goes into the managed
route, whose microphone (vrct.managed.source, "VRCT Managed Virtual Microphone") is what VRChat
hears when it is chosen as VRChat's microphone. A mute silences the voice and leaves the chatbox
working, and the app's exit leaves the microphone silent. VRChat's own side is read from the
speaker client's OSC output: its avatar parameter Voice (the level VRChat hears from its
microphone, 0 to 1) rises with each spoken message and stays at 0 while the route is muted
(decision 1 of #878). VRChat's own mute is turned off for the test through its OSC input
(/input/Voice, reading MuteSelf back) and put back as it was after it.

This replaces the vrchat-voice group that went with the Python backend (#746, decision 2):
its tests drove the managed route with the Python backend's PipeWire parts. Here the app's own
core drives it, and the microphone is read with PipeWire's pw-record. The speech server is the
stand-in of native_speech_server.py: a tone, no model.

Beyond the round trip's two clients and OCR models, it needs the managed route already set up on
this PC. The app sets it up when the managed route is saved, and keeps it after it closes; this
test does not set it up, and stops when it is missing. VRChat hears the voice only with VRCT
Managed Virtual Microphone chosen as the speaker client's microphone, and its OSC output on (the
lab's clients start with it). Nothing else of the PC's audio is read: only the managed
microphone, and of it only whether each 20 ms is sound.
"""
import json
import os
import shutil
import subprocess
import sys
from threading import Lock, Thread
import time

import socket

import pytest

import native_vrchat_lab as lab
from native_speech_server import SpeechServerFixture
from native_webdriver import NativeWebDriver
from test_native_ui import initial_state
from test_native_vrchat_roundtrip import MODELS, read_rows, squeeze

pytestmark = pytest.mark.skipif(
    sys.platform != "linux" or os.environ.get("ASTAROT_TEST_NATIVE_VRCHAT_VOICE") != "1",
    reason="opt-in: needs the chatbox lab's two local VRChat clients, the OCR models and the managed route",
)

SOURCE = "vrct.managed.source"
# 20 ms of 48 kHz mono s16le; a piece is sound when a sample reaches SOUND. The stand-in's tone
# reaches 12000 times its loudness steps (the quietest audible step is 0.1).
PIECE, SOUND = 960 * 2, 1000
# The stand-in speaks 3 s, with 143 ms of silence at each loudness step of 0; shorter gaps than
# GAP belong to one burst.
GAP, SPOKEN = 0.2, (2.5, 3.3)
# VRChat's Voice when it hears the stand-in's tone; it stays at 0 in silence.
HEARD = 0.05
WAIT = 20


def managed_route_present():
    """Whether the PC's PipeWire has the managed microphone (read only; pw-dump changes nothing)."""
    try:
        graph = json.loads(subprocess.run(["pw-dump"], capture_output=True, text=True, timeout=10, check=True).stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return False
    return any(item.get("info", {}).get("props", {}).get("node.name") == SOURCE for item in graph)


class ManagedMicrophone:
    """pw-record on the managed microphone: when each 20 ms arrived and whether it was sound."""

    def __init__(self):
        self.pieces, self.lock = [], Lock()

    def __enter__(self):
        self.process = subprocess.Popen(
            ["pw-record", "--raw", "--target", SOURCE, "--rate", "48000", "--channels", "1", "--format", "s16", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.thread = Thread(target=self._read, daemon=True)
        self.thread.start()
        return self

    def _read(self):
        while chunk := self.process.stdout.read(PIECE):
            loud = any(abs(int.from_bytes(chunk[i:i + 2], "little", signed=True)) >= SOUND for i in range(0, len(chunk) - 1, 2))
            with self.lock:
                self.pieces.append((time.monotonic(), loud))

    def __exit__(self, *exc):
        self.process.terminate()
        self.process.wait(5)
        self.thread.join(5)

    def bursts(self, start, end):
        """The bursts of sound between start and end, each as its length in seconds."""
        with self.lock:
            loud = [at for at, sound in self.pieces if start <= at <= end and sound]
        bursts = []
        for at in loud:
            if bursts and at - bursts[-1][1] < GAP:
                bursts[-1][1] = at
            else:
                bursts.append([at, at])
        return [round(last - first, 2) for first, last in bursts]

    def recording(self):
        with self.lock:
            return bool(self.pieces) and time.monotonic() - self.pieces[-1][0] < 1


class SpeakerVoice:
    """The speaker client's OSC output: when Voice (its microphone's level) and MuteSelf changed."""

    def __init__(self, port):
        self.port, self.values, self.lock = port, [], Lock()

    def __enter__(self):
        from pythonosc.osc_packet import OscPacket, ParseError

        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.bind(("127.0.0.1", self.port))
        self.socket.settimeout(.2)
        self.open = True

        def read():
            while self.open:
                try:
                    data = self.socket.recv(65536)
                    packet = OscPacket(data)
                except (OSError, ParseError):
                    continue
                for timed in packet.messages:
                    name = timed.message.address.rsplit("/", 1)[-1]
                    if timed.message.address.startswith("/avatar/parameters/") and name in ("Voice", "MuteSelf") and timed.message.params:
                        with self.lock:
                            self.values.append((time.monotonic(), name, timed.message.params[0]))

        self.thread = Thread(target=read, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.open = False
        self.thread.join(2)
        self.socket.close()

    def loudest(self, start, end):
        """The highest Voice VRChat reported between start and end (0 when it reported none)."""
        with self.lock:
            return max((float(value) for at, name, value in self.values if name == "Voice" and start <= at <= end), default=0.0)

    def muted(self):
        """VRChat's own mute as it last reported it, or None."""
        with self.lock:
            return next((bool(value) for _, name, value in reversed(self.values) if name == "MuteSelf"), None)

    def toggle_mute(self, osc_in):
        """Toggles VRChat's own mute (/input/Voice, as its mute button) and returns the state it
        reports back. VRChat reports MuteSelf only when it changes, so this is also how the test
        learns it."""
        from pythonosc.udp_client import SimpleUDPClient

        client = SimpleUDPClient("127.0.0.1", osc_in)
        with self.lock:
            before = len(self.values)
        client.send_message("/input/Voice", 1)
        time.sleep(.2)
        client.send_message("/input/Voice", 0)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with self.lock:
                changed = [bool(value) for _, name, value in self.values[before:] if name == "MuteSelf"]
            if changed:
                return changed[-1]
            time.sleep(.1)
        raise AssertionError("VRChat did not report MuteSelf after its mute was toggled: is its OSC output on, "
                             "and its microphone in toggle mode?")


def test_one_send_is_shown_by_vrchat_and_heard_once_on_the_managed_microphone(tmp_path):
    assert lab.ready(), "start the lab clients: python tools/chatbox_lab/launch_clients.py --clients 2"
    assert MODELS.is_dir(), f"OCR models not found: {MODELS}"
    assert managed_route_present(), "the managed route is not set up on this PC: save the managed route once in the app"
    speaker = lab.clients()["speaker"]
    stamp = time.strftime("%M%S")
    report = {"status": "failed", "real_vrchat": True, "real_ocr": True, "host_audio_changed": False,
              "speaker_osc_port": speaker["osc_in"], "messages": []}
    try:
        with SpeechServerFixture() as server, ManagedMicrophone() as microphone, SpeakerVoice(speaker["osc_out"]) as vrchat:
            state = initial_state(tmp_path)
            config = json.loads((state / "config.json").read_text(encoding="utf-8"))
            config.update(SEND_MESSAGE_TO_VRC=True, OSC_IP_ADDRESS="127.0.0.1", OSC_PORT=speaker["osc_in"],
                          VOICE_SETTINGS={"routing": "managed", "mode": "original",
                                          "japanese_server": "external", "japanese_url": server.url})
            (state / "config.json").write_text(json.dumps(config), encoding="utf-8")
            shutil.copytree(MODELS, state / "downloaded_models")
            with lab.OnlyCameraNamedVRChat(), NativeWebDriver(tmp_path / "ui", {"VRCT_CONFIG_DIR": str(state)}) as ui:
                ui.wait_main_ready()
                assert microphone.recording(), "pw-record does not read the managed microphone"

                def status(text):
                    ui.wait(f"return [...document.querySelectorAll('[role=status], [role=status] p')].some(e => e.textContent === {json.dumps(text)})")

                def route(button, shown):
                    ui.open_route_settings()
                    ui.click_text("button", button)
                    status(shown)
                    ui.close_settings()

                def send(base, index, heard_once):
                    text = f"{base} {stamp}{index}"
                    seen = set(read_rows(ui))
                    field = ui.command("POST", "/element", {"using": "css selector", "value": "textarea[data-message-input]"})
                    ui.element_command(field, "clear")
                    ui.element_command(field, "value", {"text": text})
                    sent = time.monotonic()
                    ui.click('[data-message-send]')
                    ui.wait("return document.querySelector('textarea[data-message-input]').value === ''")
                    rows, read_at = [], None
                    while time.monotonic() - sent < WAIT and read_at is None:
                        time.sleep(.3)
                        rows += [row for row in read_rows(ui) if row not in seen and row not in rows]
                        if any(squeeze(text) in squeeze(row) for row in rows):
                            read_at = time.monotonic() - sent
                    # The speech is over by now; wait out its tail before counting.
                    time.sleep(max(0, SPOKEN[1] + 1 - (time.monotonic() - sent)))
                    bursts = microphone.bursts(sent, time.monotonic())
                    loudest = vrchat.loudest(sent, time.monotonic())
                    report["messages"].append({"sent": text, "read_after_s": read_at and round(read_at, 1),
                                               "voice_bursts_s": bursts, "vrchat_voice_max": round(loudest, 3),
                                               "voice_expected": heard_once})
                    assert read_at is not None, f"not read back within {WAIT}s: {text}"
                    if heard_once:
                        assert len(bursts) == 1 and SPOKEN[0] <= bursts[0] <= SPOKEN[1], f"{text}: heard {bursts}"
                        assert loudest >= HEARD, (
                            f"{text}: VRChat reported no voice (Voice {loudest:.3f}) with its mute "
                            f"{'on' if vrchat.muted() else 'off'}. Choose VRCT Managed Virtual Microphone in the speaker client")
                    else:
                        assert bursts == [], f"{text}: heard {bursts} while muted"
                        assert loudest < HEARD, f"{text}: VRChat heard a voice (Voice {loudest:.3f}) while the route was muted"
                    # VRChat limits how often a chatbox may change; leave the bubble time to be replaced.
                    time.sleep(max(0, 4 - (time.monotonic() - sent)))

                # VRChat's own mute off for the test, and back as it was after it.
                if vrchat.toggle_mute(speaker["osc_in"]):
                    vrchat.toggle_mute(speaker["osc_in"])
                else:
                    report["vrchat_mute_was_on"] = True
                ui.set_switch("Chat reading (OCR)")
                route("Unmute", "Voice enabled (confirmed)")
                ui.set_switch("Text to speech (TTS)")
                send("Hello from ASTAROT", 0, heard_once=True)
                send("こんにちは、テストです", 1, heard_once=True)
                # A mute silences the voice; the chatbox goes on.
                route("Mute now", "Muted (confirmed)")
                send("muted but shown", 2, heard_once=False)
                ui.set_switch("Chat reading (OCR)", on=False)
                ui.assert_rendered()
                ui.close_app()
                if report.get("vrchat_mute_was_on"):
                    vrchat.toggle_mute(speaker["osc_in"])
            # The app's exit leaves the managed microphone silent.
            closed = time.monotonic()
            time.sleep(2)
            assert microphone.bursts(closed, time.monotonic()) == [], "the managed microphone sounded after the app closed"
            report["requests"] = len(server.requests)
        report["status"] = "passed"
    finally:
        (tmp_path / "vrchat-voice-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
