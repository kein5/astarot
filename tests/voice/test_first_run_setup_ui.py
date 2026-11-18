"""The first-run setup (#557) in the production screens, with a model-free fake backend."""

import os
from urllib.parse import urlsplit

import pytest

from test_model_downloads_ui import ui as ui

# Shared pytest fixtures are intentionally re-exported for discovery.
__all__ = ["ui"]

pytestmark = pytest.mark.skipif(
    os.environ.get("VRCT_TEST_STUDIO_UI") != "1", reason="opt-in whole-app browser test"
)

# Requests that would turn something on: the setup must send none of them.
ACTIVATING = (
    "/set/enable/transcription_send",
    "/set/enable/transcription_receive",
    "/run/start_speech_server",
    "/run/start_realtime_asr",
    "/set/enable/translation",
)


@pytest.fixture
def first_run(ui, tmp_path):
    from models.transcription.realtime_settings import normalize_settings

    page, peer, reply, state = ui
    peer.realtime = normalize_settings({})
    peer.engine = None
    # The download is instant here: a start is verified at once, an apply writes the path.
    paths = {}

    def extra(endpoint, data):
        if endpoint == "/run/start_model_download":
            assert data["consent"] is True and data["catalog_version"] == peer.catalog["catalog_version"]
            paths[data["id"]] = f"/verified/{data['id']}.gguf"
            peer.jobs[data["id"]] = dict(job_id=f"job-{data['id']}", phase="ready",
                                         paths={"model": paths[data["id"]]}, error_code=None)
            reply(endpoint, state())
        elif endpoint == "/run/apply_model_download":
            entry = next(m for m in peer.catalog["models"] if m["id"] == data["id"])
            key = "model" if entry["target"] == "asr" else "vad_model"
            assert peer.settings["profiles"]["asr"][key] == data["expected"]["model"]
            peer.settings["profiles"]["asr"][key] = paths[data["id"]]
            peer.jobs[data["id"]]["phase"] = "applied"
            reply(endpoint, state())
        elif endpoint in ("/get/data/realtime_asr_settings", "/set/data/realtime_asr_settings"):
            if data is not None:
                peer.realtime = data
            reply(endpoint, peer.realtime)
        elif endpoint in ("/get/data/selected_transcription_engine", "/set/data/selected_transcription_engine"):
            if endpoint.startswith("/set/"):
                peer.engine = data
            reply(endpoint, peer.engine)
        elif endpoint == "/set/disable/first_run_setup":
            reply(endpoint, False)
        else:
            return False
        return True

    peer.extra = extra
    origin = urlsplit(page.url)
    page.set_viewport_size({"width": 1200, "height": 850})
    page.goto(f"{origin.scheme}://{origin.netloc}/tests/voice/studio-entry/?first_run")
    page.get_by_role("heading", name="ここから会話を始めましょう").wait_for()
    # What the start-up result brings in the app.
    reply("/get/data/first_run_setup", True)
    reply("/get/data/selected_transcription_engine", None)
    reply("/get/data/speech_server_settings", peer.settings)
    reply("/get/data/realtime_asr_settings", peer.realtime)
    return page, peer, tmp_path


def test_one_consent_prepares_recognition_and_turns_nothing_on(first_run):
    from playwright.sync_api import expect

    page, peer, tmp_path = first_run
    dialog = page.get_by_role("dialog", name="初期設定")
    expect(dialog).to_be_visible()
    expect(dialog).to_contain_text("ReazonSpeech v2")
    expect(dialog).to_contain_text("Silero VAD")
    expect(dialog).to_contain_text("Apache-2.0")
    page.screenshot(path=str(tmp_path / "first-run-consent.png"), full_page=True)
    start = dialog.get_by_role("button", name="準備を始める", exact=True)
    expect(start).to_be_disabled()
    assert not any(ep == "/run/start_model_download" for ep, _ in peer.sent)

    # Keyboard only: the consent and the start.
    dialog.get_by_role("checkbox").focus()
    page.keyboard.press("Space")
    expect(start).to_be_enabled()
    start.focus()
    page.keyboard.press("Enter")

    expect(dialog).to_contain_text("音声認識の準備ができました")
    page.screenshot(path=str(tmp_path / "first-run-done.png"), full_page=True)
    sent = [ep for ep, _ in peer.sent]
    assert sent.count("/run/start_model_download") == 2
    assert sent.count("/run/apply_model_download") == 2
    assert peer.realtime["server"] == "bundled"
    assert peer.engine == "SpeechCpp"
    assert not any(ep in ACTIVATING for ep in sent)

    dialog.get_by_role("button", name="完了", exact=True).click()
    expect(dialog).to_be_hidden()
    assert ("/set/disable/first_run_setup", None) in peer.sent


def test_narrow_window_keeps_the_dialog_and_its_actions_in_reach(first_run):
    from playwright.sync_api import expect

    page, _, tmp_path = first_run
    page.set_viewport_size({"width": 480, "height": 640})
    dialog = page.get_by_role("dialog", name="初期設定")
    expect(dialog).to_be_visible()
    box = dialog.bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 480
    # Nothing in it is wider than the dialog: long Japanese and model names wrap.
    overflow = dialog.evaluate("node => node.scrollWidth - node.clientWidth")
    assert overflow <= 1
    later = dialog.get_by_role("button", name="後で", exact=True)
    later.scroll_into_view_if_needed()
    expect(later).to_be_in_viewport()
    page.screenshot(path=str(tmp_path / "first-run-narrow.png"), full_page=False)
    # Escape puts it away for this run, without dismissing it for good.
    page.keyboard.press("Escape")
    expect(dialog).to_be_hidden()
