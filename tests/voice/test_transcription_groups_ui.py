"""The speech recognition page's two systems (#414) with the production page, hooks and IPC
routes, an offline backend peer and a headless browser: speech.cpp on your PC and the APIs, in
that order, under one engine choice that works by keyboard; an API engine without a key cannot
be chosen; what the user added is marked. Nothing leaves this PC and nothing starts by itself."""

import base64
from contextlib import ExitStack
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(
    os.environ.get("VRCT_TEST_SPEECH_UI") != "1", reason="opt-in browser integration"
)


@pytest.fixture
def ui(tmp_path):
    from playwright.sync_api import sync_playwright
    from models.model_downloads.manager import Downloads
    from models.model_downloads.user_models import FILE_NAME, UserModels
    from models.speech_server.settings import normalize_settings
    from models.transcription.realtime_settings import normalize_settings as asr_settings

    with ExitStack() as stack:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        log = stack.enter_context((tmp_path / "vite.log").open("w"))
        vite = subprocess.Popen(
            ["node", "node_modules/vite/bin/vite.js", ".", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
            cwd=ROOT, stdout=log, stderr=log,
        )

        def stop():
            vite.terminate()
            try:
                vite.wait(5)
            except subprocess.TimeoutExpired:
                vite.kill()
                vite.wait(3)

        stack.callback(stop)
        end = time.monotonic() + 30
        while "Local:" not in (tmp_path / "vite.log").read_text():
            assert vite.poll() is None and time.monotonic() < end
            time.sleep(0.05)
        browser = stack.enter_context(sync_playwright()).chromium.launch(
            executable_path=os.environ["VRCT_TEST_CHROMIUM"], headless=True
        )
        stack.callback(browser.close)
        page = browser.new_page(viewport={"width": 1000, "height": 1800})
        page.set_default_timeout(5000)
        # A cold Vite compiles every module on the first load, which takes longer than this on Windows.
        page.set_default_navigation_timeout(60000)
        # One recognition model the user registered (#407), listed with the catalog's.
        own = tmp_path / "own" / "my-recognizer.gguf"
        own.parent.mkdir()
        own.write_bytes(b"GGUF mine")
        registry = UserModels(tmp_path / FILE_NAME)
        registry.register({"target": "asr", "name": "My recognizer", "paths": {"model": str(own)}})
        peer = SimpleNamespace(
            sent=[], replies=[], errors=[], sequence=0,
            # A key is registered for Groq only; the other APIs cannot be chosen yet.
            engine="SpeechCpp", selectable=["SpeechCpp", "Groq_Whisper"],
            catalog=Downloads(tmp_path / "models").catalog(), user_models=registry.state(),
            settings=normalize_settings({}), asr=asr_settings({}),
            state={name: dict(state="stopped", generation=0, base_url=None, error_code=None)
                   for name in ("japanese", "multilingual", "asr")},
        )
        page.on("pageerror", lambda error: peer.errors.append(str(error)))

        def reply(endpoint, result, status=200):
            peer.replies.append(dict(endpoint=endpoint, result=result, status=status))

        def write(line):
            req = json.loads(line)
            ep = req["endpoint"]
            data = json.loads(base64.b64decode(req["data"])) if req.get("data") else None
            peer.sent.append((ep, data))
            peer.sequence += 1
            if ep == "/get/data/selected_transcription_engine":
                reply(ep, peer.engine)
            elif ep == "/set/data/selected_transcription_engine":
                peer.engine = data
                reply(ep, peer.engine)
            elif ep == "/get/data/selectable_transcription_engines":
                reply(ep, peer.selectable)
            elif ep == "/get/data/model_download_catalog":
                reply(ep, peer.catalog)
            elif ep == "/get/data/model_download_state":
                reply(ep, dict(observation_id=str(peer.sequence), jobs={}, downloaded={}))
            elif ep in ("/get/data/model_download_hardware", "/run/refresh_model_download_hardware"):
                reply(ep, dict(phase="ready", observation_id=str(peer.sequence), measured_at_ms=int(time.time() * 1000),
                               error_code=None, devices=[]))
            elif ep == "/get/data/user_models":
                reply(ep, peer.user_models)
            elif ep == "/get/data/speech_server_settings":
                reply(ep, peer.settings)
            elif ep == "/get/data/speech_server_state":
                reply(ep, peer.state)
            elif ep == "/get/data/speech_server_devices":
                reply(ep, dict(devices=[]))
            elif ep == "/get/data/realtime_asr_settings":
                reply(ep, peer.asr)
            elif ep == "/get/data/realtime_asr_state":
                reply(ep, {source: dict(state="idle", generation=0, requested=False) for source in ("mic", "speaker")})

        def read():
            result, peer.replies = peer.replies, []
            return result

        page.expose_function("sidecarWrite", write)
        page.expose_function("sidecarRead", read)
        peer.url = f"http://127.0.0.1:{port}/tests/voice/transcription-ui-entry/"
        page.goto(peer.url)
        # A cold Vite compiles the page's modules on the first load.
        page.locator("[data-engine-group]").first.wait_for(timeout=60000)
        yield page, peer
        assert not peer.errors


def sent(peer, endpoint):
    return [data for ep, data in peer.sent if ep == endpoint]


def started_anything(peer):
    """A download, a server, the microphone or a transcription engine switched without the user."""
    return [ep for ep, _ in peer.sent if ep.startswith(("/run/start_", "/set/enable/", "/run/apply_"))
            or ep == "/set/data/selected_transcription_engine"]


def test_the_page_shows_speechcpp_then_the_apis_and_marks_what_the_user_added(ui):
    from playwright.sync_api import expect

    page, peer = ui
    choice = page.get_by_role("group", name="Transcription engine used for speech recognition", exact=True)
    systems = choice.get_by_role("radiogroup")
    expect(systems).to_have_count(2)
    expect(systems.nth(0)).to_have_accessible_name("On your PC (speech.cpp)")
    expect(systems.nth(1)).to_have_accessible_name("API (cloud or your own server)")
    names = "radios => radios.map(radio => radio.closest('label').innerText.trim())"
    assert systems.nth(0).get_by_role("radio").evaluate_all(names) == ["Local (speech.cpp)"]
    assert systems.nth(1).get_by_role("radio").evaluate_all(names) == [
        "Groq Whisper", "OpenAI Whisper", "Deepgram", "Custom Whisper server"]
    expect(page.get_by_role("radio", name="Local (speech.cpp)", exact=True)).to_be_checked()
    row = page.locator("[data-setting-id=select_transcription_engine]")
    expect(row.get_by_role("status")).to_have_text("Selected engine: Local (speech.cpp)")

    # The two systems follow the choice in the same order, each under its subheading; the APIs
    # are no longer inside 「詳細設定」, which comes after them.
    groups = page.locator("[data-engine-group]")
    assert groups.evaluate_all("groups => groups.map(group => group.dataset.engineGroup)") == ["speechcpp", "api"]
    expect(groups.nth(0).get_by_role("heading", level=3).first).to_have_text("On your PC (speech.cpp)")
    expect(groups.nth(1).get_by_role("heading", level=3).first).to_have_text("API (cloud or your own server)")
    assert page.evaluate("""() => {
        const [local, api] = document.querySelectorAll('[data-engine-group]');
        const more = document.querySelector('details[data-advanced]');
        const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return after(document.querySelector('[data-setting-id=select_transcription_engine]'), local)
            && after(local, api) && after(api, more) && !more.querySelector('[data-engine-group]');
    }""")
    folds = groups.nth(1).locator("details[data-setup] > summary")
    # The fold's title is its first part; the badge and the state line follow it.
    assert folds.evaluate_all("rows => rows.map(row => row.firstElementChild.firstChild.textContent.trim())")[:4] == [
        "Groq Whisper", "OpenAI Whisper", "Deepgram", "Custom Whisper server"]
    # The user's own server is marked as theirs, with the catalogs' dashed badge; the app's are not.
    own = folds.nth(3).locator("[data-tone=own]")
    expect(own).to_have_text("Your server")
    expect(folds.nth(0).locator("[data-tone=own]")).to_have_count(0)
    expect(folds.nth(0)).to_contain_text("ready")
    expect(folds.nth(1)).to_contain_text("not set up")
    if os.environ.get("VRCT_TEST_SCREENSHOTS"):
        page.screenshot(path=os.path.join(os.environ["VRCT_TEST_SCREENSHOTS"], "transcription-groups.png"), full_page=True)

    # speech.cpp's models: the catalog's cards and, after them, the model the user registered.
    groups.nth(0).get_by_text("Models and servers", exact=True).click()
    mine = page.get_by_role("group", name="My recognizer", exact=True)
    expect(mine.locator("[data-tone=own]")).to_have_text("Your model")
    expect(page.get_by_role("group", name="Qwen3-ASR 0.6B", exact=True).locator("[data-tone=own]")).to_have_count(0)
    # Opening the page and its folds starts nothing and switches nothing.
    assert started_anything(peer) == []


def test_the_engine_is_chosen_by_keyboard_and_an_api_without_a_key_stays_disabled(ui):
    from playwright.sync_api import expect

    page, peer = ui
    local = page.get_by_role("radio", name="Local (speech.cpp)", exact=True)
    groq = page.get_by_role("radio", name="Groq Whisper", exact=True)
    expect(local).to_be_checked()
    expect(local).to_be_enabled()
    for name in ("OpenAI Whisper", "Deepgram", "Custom Whisper server"):
        expect(page.get_by_role("radio", name=name, exact=True)).to_be_disabled()
    # Tab stops once on the choice, at the selected engine.
    local.focus()
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Tab")
    expect(local).to_be_focused()
    # The arrow keys move across the two systems and choose: speech.cpp, then the API with a key.
    page.keyboard.press("ArrowDown")
    expect(groq).to_be_checked()
    expect(page.locator("[data-setting-id=select_transcription_engine]").get_by_role("status")).to_have_text(
        "Selected engine: Groq Whisper")
    assert sent(peer, "/set/data/selected_transcription_engine") == ["Groq_Whisper"]
    expect(groq).to_be_enabled()
    # The Groq fold opens, as the provider in use; the ones without a key stay disabled and the
    # arrow keys pass them by, back to speech.cpp.
    expect(page.locator("[data-engine-group=api] details[data-setup]").first).to_have_attribute("open", "")
    expect(groq).to_be_focused()
    page.keyboard.press("ArrowDown")
    expect(local).to_be_checked()
    assert sent(peer, "/set/data/selected_transcription_engine") == ["Groq_Whisper", "SpeechCpp"]
    for name in ("OpenAI Whisper", "Deepgram", "Custom Whisper server"):
        expect(page.get_by_role("radio", name=name, exact=True)).to_be_disabled()
    # Choosing an engine starts no download, server or microphone.
    assert [ep for ep in started_anything(peer) if ep != "/set/data/selected_transcription_engine"] == []


def test_the_groups_fit_a_narrow_window_in_japanese(ui):
    from playwright.sync_api import expect

    page, peer = ui
    page.set_viewport_size({"width": 480, "height": 1600})
    page.goto(peer.url + "?lang=ja&width=440")
    page.locator("[data-engine-group]").first.wait_for(timeout=30000)
    expect(page.get_by_role("radiogroup", name="お使いのPCで動かす（speech.cpp）", exact=True)).to_be_visible()
    expect(page.get_by_role("radiogroup", name="API（クラウドや自分のサーバー）", exact=True)).to_be_visible()
    expect(page.locator("[data-engine-group=api] [data-tone=own]")).to_have_text("自分のサーバー")
    overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, overflow
    # Each option stays inside the page.
    widths = page.locator("[data-radio-group] label").evaluate_all(
        "labels => labels.map(label => label.getBoundingClientRect().right)")
    assert max(widths) <= 480, widths
    if os.environ.get("VRCT_TEST_SCREENSHOTS"):
        page.screenshot(path=os.path.join(os.environ["VRCT_TEST_SCREENSHOTS"], "transcription-groups-narrow.png"), full_page=True)
