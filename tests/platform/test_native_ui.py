"""Opt-in actual Tauri/WebKitGTK -> shell sidecar -> full Model startup."""
import json
import os
import sys
import time

import pytest

from native_webdriver import NativeWebDriver


pytestmark = pytest.mark.skipif(
    sys.platform != "linux" or os.environ.get("ASTAROT_TEST_NATIVE_GUI") != "1",
    reason="requires built native Tauri, tauri-driver and a graphical session",
)


def initial_state(tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    (state / "config.json").write_text(json.dumps({
        "AUTO_DOWNLOAD_MODELS": False, "ENABLE_TELEMETRY": False, "TELEMETRY_NOTICE": 1,
        # The first-run setup (#557) is a modal dialog over the main page; these tests start past it.
        "FIRST_RUN_SETUP_PENDING": False,
        "AUTO_MIC_SELECT": False, "AUTO_SPEAKER_SELECT": False,
        "SEND_MESSAGE_TO_VRC": False, "VRC_MIC_MUTE_SYNC": False,
        "OSC_IP_ADDRESS": "127.0.0.2", "WEBSOCKET_SERVER": False,
        "UI_LANGUAGE": "en",
    }))
    return state


def test_model_free_native_app_renders_text_input_without_fatal_warning(tmp_path):
    state = initial_state(tmp_path)
    with NativeWebDriver(tmp_path / "ui", {"VRCT_CONFIG_DIR": str(state)}) as ui:
        ui.wait_main_ready()
        assert ui.evaluate("return document.title") == "ASTAROT"
        assert "ASTAROT" in ui.evaluate("return document.body.innerText")
        assert "An error occurred" not in ui.evaluate("return document.body.innerText")
        assert "download automatically, normally" not in ui.evaluate("return document.body.innerText")
        # DPMS Off reproduced the old black window while the DOM still worked.
        ui.assert_rendered()
        ui.close_app()


def x11_window(title):
    """The X11 id and the xwininfo report of the window with this exact title, or None."""
    import re
    import subprocess

    tree = subprocess.run(["xwininfo", "-root", "-tree"], capture_output=True, text=True, timeout=5).stdout
    match = re.search(r'^\s*(0x[0-9a-f]+) "' + re.escape(title) + '"', tree, re.MULTILINE)
    if match is None:
        return None
    report = subprocess.run(["xwininfo", "-id", match.group(1)], capture_output=True, text=True, timeout=5).stdout
    return match.group(1), report


def test_desktop_captions_are_an_unmanaged_window_above_the_others(tmp_path):
    """Linux on X11/XWayland: the caption window is override-redirect, so a window manager
    neither focuses it nor puts a focused full-screen game above it, and it shows the line
    just sent. Xvfb has no window manager; KWin's stacking is checked by hand."""
    state = initial_state(tmp_path)
    with NativeWebDriver(tmp_path / "ui", {"VRCT_CONFIG_DIR": str(state)}) as ui:
        ui.wait_main_ready()
        # The page was renamed from "VR" (#554); the desktop captions' switch is in sight on it.
        ui.open_voice_page("Captions and VR", '[data-setting-id="desktop_overlay"] input[type=checkbox]')
        assert ui.evaluate("return document.querySelector('[data-setting-id=\"desktop_overlay\"] input').checked") is False
        ui.evaluate("document.querySelector('[data-setting-id=\"desktop_overlay\"] input').click(); return true;")
        ui.wait("return document.querySelector('[data-setting-id=\"desktop_overlay\"] input').checked === true")
        deadline = time.monotonic() + 15
        while (found := x11_window("ASTAROT Captions")) is None or "IsViewable" not in found[1]:
            assert time.monotonic() < deadline, "the caption window did not appear"
            time.sleep(.2)
        xid, report = found
        (tmp_path / "caption-window.txt").write_text(report)
        assert "Override Redirect State: yes" in report, report
        ui.close_settings()
        field = ui.command("POST", "/element", {"using": "css selector", "value": "textarea[data-message-input]"})
        ui.element_command(field, "clear")
        ui.element_command(field, "value", {"text": "caption overlay check"})
        ui.click('[data-message-send]')
        ui.wait("return document.querySelector('textarea[data-message-input]').value === ''")
        # The overlay page reads its lines from the native side; its own document has the text.
        windows = ui.command("GET", "/window/handles")
        main = ui.command("GET", "/window")
        overlay = next(handle for handle in windows if handle != main)
        ui.command("POST", "/window", {"handle": overlay})
        ui.wait("return document.body.innerText.includes('caption overlay check')")
        ui.command("POST", "/window", {"handle": main})
        ui.close_app()


def test_native_settings_navigation_observes_open_and_close(tmp_path):
    """Settings open and close twenty times over two pages, and the main page comes back each time.
    The pages are the speech's and the captions' (#811): the VR page's single-line switch shows on
    every platform, where the desktop captions' switch shows only on X11."""
    state = initial_state(tmp_path)
    with NativeWebDriver(tmp_path / 'ui', {'VRCT_CONFIG_DIR': str(state)}) as ui:
        ui.wait_main_ready()
        for _ in range(20):
            ui.open_voice_settings()
            ui.close_settings()
            ui.wait("return document.querySelector('[data-main-page][data-showing=main]') !== null", timeout=3)
            ui.open_voice_page("Captions and VR", '[data-setting-id="overlay_small_log"] input')
            ui.close_settings()
            ui.wait("return document.querySelector('[data-main-page][data-showing=main]') !== null", timeout=3)
        ui.close_app()


MANAGED_SOURCE = "astarot.managed.source"


def managed_microphone_muted():
    """Whether the managed microphone is muted in the graph, as the voice gate left it.

    None when the graph holds no single managed microphone with one mute value. Read with
    pw-dump, so it is what PipeWire holds, not what the app says.
    """
    from tools.private_pipewire import nodes

    source = nodes().get(MANAGED_SOURCE)
    if source is None:
        return None
    mutes = [props["mute"] for props in source["info"].get("params", {}).get("Props", []) if "mute" in props]
    return mutes[0] if len(mutes) == 1 else None


def shown(text):
    """A script that is true once a status line of the page says this text."""
    return ("return [...document.querySelectorAll('[role=status], [role=status] p')]"
            f".some(e => e.textContent === {json.dumps(text)})")


@pytest.mark.skipif(os.environ.get("ASTAROT_TEST_NATIVE_ROUTE") != "1", reason="opt-in private PipeWire/WirePlumber graph")
def test_native_managed_route_unmutes_and_is_muted_again_after_a_restart(tmp_path):
    """The managed route of Linux through the app's window (#838).

    Saved, the route starts muted. Unmute opens the voice gate, and the window says "Voice enabled
    (confirmed)" only once the core has seen the microphone open in the graph: 0.5.2's core missed
    that change and stayed at "Muted (confirmed)" (fixed by 03294491e). Closing the app mutes the
    microphone again, and the next start shows the route muted.

    On a private PipeWire and WirePlumber (tools/private_pipewire.py); the user's own audio is
    not touched. Build the gate helper first: `python tools/build_voice_gate.py`.
    """
    from tools.private_pipewire import private_graph, wait_for
    from native_webdriver import ROOT

    state = initial_state(tmp_path)

    def saved_routing():
        return json.loads((state / "config.json").read_text()).get("VOICE_SETTINGS", {}).get("routing")

    with private_graph(config_fragment=ROOT / "config/pipewire/90-astarot-managed.conf"):
        with NativeWebDriver(tmp_path / "first", {"VRCT_CONFIG_DIR": str(state)}) as ui:
            ui.wait_main_ready()
            ui.open_route_settings()
            ui.select("Audio route", "managed")
            ui.click_text("button", "Save changes")
            wait_for(lambda: saved_routing() == "managed")
            ui.open_route_settings()
            ui.wait(shown("Muted (confirmed)"))
            assert managed_microphone_muted() is True
            ui.click_text("button", "Unmute")
            ui.wait(shown("Voice enabled (confirmed)"))
            assert managed_microphone_muted() is False
            ui.assert_rendered()
            ui.close_app()
        wait_for(lambda: managed_microphone_muted() is True)
        with NativeWebDriver(tmp_path / "second", {"VRCT_CONFIG_DIR": str(state)}) as ui:
            ui.wait_main_ready()
            ui.open_route_settings()
            ui.wait(shown("Muted (confirmed)"))
            assert managed_microphone_muted() is True
            ui.assert_rendered()
            ui.close_app()
