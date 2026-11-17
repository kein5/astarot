"""Production components/hooks/IPC with an offline sidecar peer and headless browser."""

import base64
from contextlib import ExitStack
import copy
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from types import SimpleNamespace

import pytest
from ui_details import open_engine_settings
from models.speech_server.settings import normalize_settings
from models.model_downloads.manager import Downloads

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(
    os.environ.get("VRCT_TEST_MODEL_DOWNLOAD_UI") != "1", reason="opt-in browser test"
)
# The card of the Japanese model the app suggests first (its F16 and Q8_0 files).
MF = "Irodori-TTS v4.1 Small MF"


@pytest.fixture
def ui(tmp_path):
    from playwright.sync_api import sync_playwright

    with ExitStack() as stack:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        log = stack.enter_context((tmp_path / "vite.log").open("w"))
        vite = subprocess.Popen(
            [
                "node",
                "node_modules/vite/bin/vite.js", ".",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--strictPort",
            ],
            cwd=ROOT,
            stdout=log,
            stderr=log,
        )

        def stop():
            vite.terminate()
            try:
                vite.wait(5)
            except subprocess.TimeoutExpired:
                vite.kill()
                vite.wait(3)

        stack.callback(stop)
        end = time.monotonic() + 15
        while "Local:" not in (tmp_path / "vite.log").read_text():
            assert vite.poll() is None and time.monotonic() < end
            time.sleep(0.05)
        browser = stack.enter_context(sync_playwright()).chromium.launch(
            executable_path=os.environ["VRCT_TEST_CHROMIUM"], headless=True
        )
        stack.callback(browser.close)
        page = browser.new_page(viewport={"width": 1200, "height": 1600})
        page.set_default_timeout(5000)
        # A cold Vite compiles every module on the first load, which takes longer than this on Windows.
        page.set_default_navigation_timeout(30000)
        peer = SimpleNamespace(
            sent=[],
            replies=[],
            errors=[],
            sequence=0,
            jobs={},
            downloaded={},
            settings=normalize_settings({}),
            state={
                name: dict(state="stopped", generation=0, error_code=None)
                for name in ("japanese", "multilingual", "asr")
            },
        )
        catalog = Downloads(tmp_path / "models").catalog()
        peer.catalog = catalog
        peer.hardware = dict(
            phase="ready",
            measured_at_ms=int(time.time() * 1000),
            error_code=None,
            devices=[
                dict(
                    name="Vulkan0",
                    description="NVIDIA GeForce RTX 4080 SUPER",
                    kind="gpu",
                    memory_total=16 * 1024**3,
                    memory_free=10 * 1024**3,
                )
            ],
        )
        page.on("pageerror", lambda error: peer.errors.append(str(error)))

        def reply(endpoint, result, status=200):
            peer.replies.append(dict(endpoint=endpoint, result=result, status=status))

        def state():
            peer.sequence += 1
            return dict(
                observation_id=str(peer.sequence), jobs=copy.deepcopy(peer.jobs),
                downloaded=copy.deepcopy(peer.downloaded),
            )

        def write(line):
            req = json.loads(line)
            ep = req["endpoint"]
            data = (
                json.loads(base64.b64decode(req["data"])) if req.get("data") else None
            )
            peer.sent.append((ep, data))
            if getattr(peer, "extra", None) and peer.extra(ep, data):
                return
            if ep == "/get/data/model_download_catalog":
                reply(ep, catalog)
            elif ep in (
                "/get/data/model_download_hardware",
                "/run/refresh_model_download_hardware",
            ):
                peer.sequence += 1
                reply(ep, dict(peer.hardware, observation_id=str(peer.sequence)))
            elif ep == "/get/data/model_download_state":
                reply(ep, state())
            elif ep == "/run/start_model_download":
                assert data["consent"] is True
                entry = next(m for m in catalog["models"] if m["id"] == data["id"])
                peer.jobs[data["id"]] = dict(
                    job_id="job1",
                    phase="downloading",
                    received_bytes=12,
                    total_bytes=entry["total_bytes"],
                    paths={},
                    error_code=None,
                )
                reply(ep, state())
            elif ep == "/run/cancel_model_download":
                peer.jobs[data["id"]]["phase"] = "cancelled"
                reply(ep, state())
            elif ep == "/run/apply_model_download":
                job = peer.jobs[data["id"]]
                peer.settings["profiles"]["japanese"]["model"] = job["paths"]["model"]
                job["phase"] = "applied"
                reply(ep, state())
            elif ep == "/get/data/speech_server_settings":
                reply(ep, peer.settings)
            elif ep == "/get/data/speech_server_state":
                reply(ep, peer.state)
            elif ep == "/set/data/speech_server_settings":
                peer.settings = data
                reply(ep, peer.settings)

        def read():
            result, peer.replies = peer.replies, []
            return result

        page.expose_function("sidecarWrite", write)
        page.expose_function("sidecarRead", read)
        page.goto(f"http://127.0.0.1:{port}/tests/voice/model-download-ui-entry/")
        open_engine_settings(page)
        yield page, peer, reply, state
        assert not peer.errors


def test_warning_consent_progress_cancel_and_no_activation(ui):
    from playwright.sync_api import expect

    page, peer, _, _ = ui
    page.get_by_role("button", name="Review download", exact=True).first.click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_contain_text("Aratako / sakasegawa")
    expect(dialog).to_contain_text("1,920,321,792")
    expect(dialog).to_contain_text("MIT + Apache-2.0")
    start = dialog.get_by_role("button", name="Agree and download", exact=True)
    expect(start).to_be_disabled()
    assert not any("start_model_download" in ep for ep, _ in peer.sent)
    dialog.get_by_role("checkbox").check()
    start.click()
    expect(page.get_by_role("progressbar")).to_be_visible()
    # The readout spins while it downloads; a cancelled download ends without a check.
    expect(page.locator("[data-model-download] [data-progress=working]")).to_have_count(1)
    page.get_by_role("button", name="Cancel download", exact=True).click()
    expect(page.get_by_text("Download cancelled.", exact=True)).to_be_visible()
    expect(page.locator("[data-model-download] [data-progress]")).to_have_count(0)
    assert not any(
        ep in ("/run/start_speech_server", "/run/start_direct_voice", "/run/enable_tts")
        for ep, _ in peer.sent
    )


def test_apply_requires_verified_completion_and_clean_draft(ui):
    from playwright.sync_api import expect

    page, peer, reply, state = ui
    page.get_by_role("button", name="Review download", exact=True).first.click()
    page.get_by_role("dialog").get_by_role("checkbox").check()
    page.get_by_role("button", name="Agree and download", exact=True).click()
    page.get_by_role("progressbar").wait_for()
    peer.jobs["irodori-v41-f16"].update(
        phase="ready", paths={"model": "/verified/model.gguf"}
    )
    reply("/get/data/model_download_state", state())
    apply = page.get_by_role("button", name="Apply model path", exact=True)
    expect(apply).to_be_enabled()
    # Finishing while the page is open turns the spinner into a check that draws itself.
    expect(page.locator("[data-model-download] [data-progress=done][data-arrived]")).to_have_count(1)
    field = page.get_by_label("Model GGUF path", exact=True)
    field.fill("/unsaved.gguf")
    expect(apply).to_be_disabled()
    expect(
        page.get_by_text("A path that this download replaces has unsaved edits.", exact=False)
    ).to_be_visible()
    page.get_by_role("button", name="Discard changes", exact=True).click()
    expect(apply).to_be_enabled()
    apply.click()
    expect(field).to_have_value("/verified/model.gguf")
    assert next(data for ep, data in peer.sent if ep == "/run/apply_model_download")[
        "expected"
    ] == {"model": ""}
    assert not any(ep == "/run/start_speech_server" for ep, _ in peer.sent)


def _download_ready(page, peer, reply, state):
    page.get_by_role("button", name="Review download", exact=True).first.click()
    page.get_by_role("dialog").get_by_role("checkbox").check()
    page.get_by_role("button", name="Agree and download", exact=True).click()
    page.get_by_role("progressbar").wait_for()
    peer.jobs["irodori-v41-f16"].update(
        phase="ready", paths={"model": "/verified/model.gguf"}
    )
    reply("/get/data/model_download_state", state())


def test_apply_right_after_download_keeps_other_unsaved_edits(ui):
    from playwright.sync_api import expect

    # Regression: a voice file or device chosen before downloading used to
    # disable Apply until the whole form was saved.
    page, peer, reply, state = ui
    voice = page.get_by_label("Voice GGUF path (optional)", exact=True)
    voice.fill("/unsaved-voice.gguf")
    page.get_by_label("Inference device", exact=True).select_option("gpu")
    _download_ready(page, peer, reply, state)
    apply = page.get_by_role("button", name="Apply model path", exact=True)
    expect(apply).to_be_enabled()
    apply.click()
    expect(page.get_by_label("Model GGUF path", exact=True)).to_have_value(
        "/verified/model.gguf"
    )
    expect(voice).to_have_value("/unsaved-voice.gguf")
    expect(page.get_by_label("Inference device", exact=True)).to_have_value("gpu")
    expect(page.get_by_text("Unsaved changes", exact=True)).to_be_visible()
    # Apply persisted only the model path; the other edits are still a draft.
    saved = peer.settings["profiles"]["japanese"]
    assert (saved["model"], saved["voice_file"], saved["device"]) == (
        "/verified/model.gguf", "", "auto"
    )
    assert not any(ep == "/set/data/speech_server_settings" for ep, _ in peer.sent)
    page.get_by_role("button", name="Save changes", exact=True).click()
    expect(page.get_by_text("Unsaved changes", exact=True)).to_have_count(0)
    saved = peer.settings["profiles"]["japanese"]
    assert (saved["model"], saved["voice_file"], saved["device"]) == (
        "/verified/model.gguf", "/unsaved-voice.gguf", "gpu"
    )
    assert not any(ep == "/run/start_speech_server" for ep, _ in peer.sent)


def test_apply_stays_blocked_while_the_target_server_runs(ui):
    from playwright.sync_api import expect

    page, peer, reply, state = ui
    _download_ready(page, peer, reply, state)
    peer.state["japanese"] = dict(state="preparing", generation=1, error_code=None)
    reply("/get/data/speech_server_state", peer.state)
    expect(
        page.get_by_role("button", name="Apply model path", exact=True)
    ).to_be_disabled()
    expect(
        page.get_by_text("Stop the target server or input before applying.", exact=False)
    ).to_be_visible()


def test_failure_stale_reply_and_rvc_requirements(ui):
    from playwright.sync_api import expect

    page, peer, reply, state = ui
    expect(page.get_by_text("HuBERT", exact=False).first).to_be_visible()
    expect(page.get_by_text("RMVPE", exact=False).first).to_be_visible()
    page.get_by_role("button", name="Review download", exact=True).first.click()
    page.get_by_role("dialog").get_by_role("checkbox").check()
    page.get_by_role("button", name="Agree and download", exact=True).click()
    page.get_by_role("progressbar").wait_for()
    stale = state()
    peer.jobs["irodori-v41-f16"].update(phase="failed", error_code="hash_mismatch")
    reply("/get/data/model_download_state", state())
    expect(
        page.get_by_text(
            "File verification failed. Settings were not changed.", exact=True
        )
    ).to_be_visible()
    reply("/get/data/model_download_state", stale)
    expect(
        page.get_by_role("button", name="Apply model path", exact=True)
    ).to_have_count(0)


def test_model_links_use_tauri_opener_and_report_failure(ui):
    from playwright.sync_api import expect

    page, _, _, _ = ui
    page.get_by_role("button", name="Review download", exact=True).first.click()
    page.evaluate("""() => {
        window.isTauri = true; window.openedModels = [];
        window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
            window.openedModels.push({ command, args }); throw new Error('opener denied');
        }};
    }""")
    page.get_by_role("dialog").get_by_role(
        "link", name="Model card and usage terms"
    ).click()
    expect(
        page.get_by_text(
            "Could not open the link in your browser. Copy the displayed URL to open it manually.",
            exact=True,
        )
    ).to_be_visible()
    calls = page.evaluate("window.openedModels")
    assert len(calls) == 1 and calls[0]["command"] == "plugin:opener|open_url"
    assert calls[0]["args"]["url"].startswith("https://huggingface.co/sakasegawa/")


def test_external_saved_path_refresh_preserves_unsaved_edits(ui):
    from playwright.sync_api import expect

    page, peer, reply, _ = ui
    field = page.get_by_label("Model GGUF path", exact=True)
    field.fill("/unsaved.gguf")
    peer.settings["profiles"]["japanese"]["model"] = "/externally-saved.gguf"
    reply("/get/data/speech_server_settings", peer.settings)
    expect(field).to_have_value("/unsaved.gguf")
    page.get_by_role("button", name="Discard changes", exact=True).click()
    expect(field).to_have_value("/externally-saved.gguf")


def test_consent_is_bound_to_the_catalog_shown_in_the_dialog(ui, tmp_path):
    from playwright.sync_api import expect

    page, peer, reply, _ = ui
    page.get_by_role("button", name="Review download", exact=True).first.click()
    catalog = peer.catalog
    approved_version = catalog["catalog_version"]
    catalog["catalog_version"] = "new-unreviewed-catalog"
    catalog["models"][0]["name"] = "Unreviewed replacement model"
    reply("/get/data/model_download_catalog", catalog)
    expect(page.get_by_text("Unreviewed replacement model", exact=True)).to_have_count(
        1
    )
    page.get_by_role("dialog").get_by_role("checkbox").check()
    page.get_by_role("button", name="Agree and download", exact=True).click()
    page.get_by_role("progressbar").wait_for()
    sent = next(data for ep, data in peer.sent if ep == "/run/start_model_download")
    assert sent["catalog_version"] == approved_version


def test_idle_render_does_not_repeat_catalog_requests(ui):
    from playwright.sync_api import expect

    page, peer, _, _ = ui
    # One card per model: the three Irodori models and the RVC voice.
    expect(
        page.get_by_role("button", name="Review download", exact=True)
    ).to_have_count(4)
    # Both mounted components ask once. State replies must not cause a fetch loop.
    page.wait_for_timeout(250)
    initial = sum(ep == "/get/data/model_download_catalog" for ep, _ in peer.sent)
    page.wait_for_timeout(250)
    assert (
        sum(ep == "/get/data/model_download_catalog" for ep, _ in peer.sent) == initial
    )


def test_gpu_guidance_selects_compact_model_and_keeps_active_job_visible(ui):
    from playwright.sync_api import expect

    page, peer, reply, _ = ui
    card = page.get_by_role("group", name=MF, exact=True)
    variant = card.get_by_label(f"File type of {MF}", exact=True)
    expect(variant).to_have_value("irodori-v41-f16")
    expect(card.get_by_text("Fits the free memory", exact=True)).to_be_visible()
    peer.hardware["devices"][0]["memory_free"] = 4500000000
    page.get_by_role("button", name="Refresh GPU and memory", exact=True).first.click()
    expect(variant).to_have_value("irodori-v41-q8")
    expect(
        page.get_by_text("Recommended for available memory", exact=True)
    ).to_be_visible()
    variant.select_option("irodori-v41-q8")
    card.get_by_role("button", name="Review download", exact=True).click()
    page.get_by_role("dialog").get_by_role("checkbox").check()
    page.get_by_role("button", name="Agree and download", exact=True).click()
    page.get_by_role("progressbar").wait_for()
    assert (
        next(data for ep, data in peer.sent if ep == "/run/start_model_download")["id"]
        == "irodori-v41-q8"
    )
    variant.select_option("irodori-v41-f16")
    expect(page.get_by_role("progressbar")).to_be_visible()
    page.get_by_role("button", name="Cancel download", exact=True).click()
    assert peer.jobs["irodori-v41-q8"]["phase"] == "cancelled"
    assert not any(ep == "/run/start_speech_server" for ep, _ in peer.sent)


def test_more_speechcpp_models_are_choices_and_large_shows_gemma_terms(ui):
    from playwright.sync_api import expect

    page, peer, _, _ = ui
    # Each Japanese model is a card in catalog order; the checked one keeps its two file types.
    cards = page.locator("[data-model-download]")
    expect(cards).to_have_count(4)
    assert cards.evaluate_all("rows => rows.map(row => row.getAttribute('aria-label'))") == [
        MF, "Irodori-TTS v4.1 Small", "Irodori-TTS v4 Large", "Saisho Utane"]
    variant = page.get_by_label(f"File type of {MF}", exact=True)
    expect(variant).to_have_value("irodori-v41-f16")
    assert [option.get_attribute("value") for option in variant.locator("option").all()] == [
        "irodori-v41-f16", "irodori-v41-q8"]
    expect(page.get_by_text("Small MF gives the first audio soonest.", exact=False)).to_be_visible()
    large = page.get_by_role("group", name="Irodori-TTS v4 Large", exact=True)
    # What a first-time user compares: what it does, its size, the hardware and the terms.
    expect(large).to_contain_text("A large model that reads Japanese.")
    expect(large).to_contain_text("3.61 GiB")
    expect(large).to_contain_text("Medium · about 3.84 GiB of memory (measured on Apple M5 (Metal))")
    expect(large).to_contain_text("too slow on a CPU")
    expect(large).to_contain_text("Not downloaded")
    expect(page.get_by_role("group", name=MF, exact=True)).to_contain_text("Suggested for Japanese")
    large.get_by_role("button", name="Review download", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_contain_text("Irodori-TTS v4 Large · Q8_0")
    expect(dialog).to_contain_text("Gemma Terms of Use")
    expect(dialog).to_contain_text("3,875,154,272 bytes")
    # Each of its terms is a link of its own, named by the file.
    for name in ("GEMMA_TERMS_OF_USE.md", "GEMMA_PROHIBITED_USE_POLICY.md", "LICENSE-MIT", "LICENSE-APACHE-2.0"):
        expect(dialog.get_by_role("link", name=name, exact=True)).to_have_count(1)
    # Nothing starts until the user agrees.
    assert not any(ep == "/run/start_model_download" for ep, _ in peer.sent)
    page.get_by_role("button", name="Back", exact=True).click()
    assert not peer.errors


def test_failed_hardware_probe_does_not_invent_capacity_or_disable_manual_choice(ui):
    from playwright.sync_api import expect

    page, peer, reply, _ = ui
    variant = page.get_by_label(f"File type of {MF}", exact=True)
    expect(variant).to_have_value("irodori-v41-f16")
    peer.hardware.update(phase="failed", devices=[], error_code="hardware_timeout")
    page.get_by_role("button", name="Refresh GPU and memory", exact=True).first.click()
    expect(
        page.get_by_text(
            "GPU information is unavailable. Choose a model manually or refresh.",
            exact=True,
        )
    ).to_be_visible()
    variant.select_option("irodori-v41-q8")
    page.get_by_role("button", name="Review download", exact=True).first.click()
    expect(page.get_by_role("dialog")).to_contain_text("Q8_0")
    assert not any(ep == "/run/start_model_download" for ep, _ in peer.sent)


def test_asr_profile_offers_every_speechcpp_recognizer_without_hardware_advice(ui):
    from playwright.sync_api import expect

    page, peer, _, _ = ui
    page.goto(page.url + "?view=asr")
    open_engine_settings(page)
    # Grouped by use: recognizers, the VAD every recognizer needs, and the optional diarization.
    expect(page.get_by_role("heading", level=4)).to_have_text(
        ["Speech recognition", "Voice activity detection (VAD)", "Telling speakers apart (optional)"])
    # speech.cpp's catalog decides the recognizers, their order and the file each name fetches.
    cards = page.locator("[data-model-download]")
    assert cards.evaluate_all("rows => rows.map(row => row.getAttribute('aria-label'))") == [
        "Qwen3-ASR 0.6B", "Qwen3-ASR 1.7B", "ReazonSpeech v2", "Parakeet TDT-CTC 0.6B ja",
        "Parakeet TDT 0.6B v3", "Haas-ja v1.0", "Nemotron 3.5 Transcribe 30B-A4B",
        "Silero VAD v6.2", "Nemotron 3 Diarization"]
    qwen = page.get_by_role("group", name="Qwen3-ASR 0.6B", exact=True)
    expect(qwen.get_by_label("File type of Qwen3-ASR 0.6B", exact=True)).to_have_value("qwen3-asr-06b-q8")
    expect(qwen).to_contain_text("Japanese")
    expect(page.get_by_text("Irodori-TTS v4.1 Small MF", exact=True)).to_have_count(0)
    expect(page.get_by_label("Memory headroom", exact=True)).to_have_count(0)
    expect(page.get_by_text("also needs a VAD model", exact=False).first).to_be_visible()
    expect(page.get_by_text("The models are the ones speech.cpp offers.", exact=False)).to_be_visible()
    # speech.cpp's start languages are the suggestion: Japanese for ReazonSpeech.
    expect(page.get_by_role("group", name="ReazonSpeech v2", exact=True)).to_contain_text("Suggested for Japanese")
    parakeet = page.get_by_role("group", name="Parakeet TDT 0.6B v3", exact=True)
    expect(parakeet.get_by_label("File type of Parakeet TDT 0.6B v3", exact=True)).to_have_value(
        "parakeet-tdt-06b-v3-f16")  # speech.cpp fetches F16 for this name
    expect(parakeet.locator("dl")).not_to_contain_text("Japanese")
    haas = page.get_by_role("group", name="Haas-ja v1.0", exact=True)
    kind = haas.get_by_label("File type of Haas-ja v1.0", exact=True)
    assert kind.locator("option").evaluate_all("rows => rows.map(row => row.value)") == [
        "haas-ja-q8", "haas-ja-f16", "haas-ja-q6", "haas-ja-q5", "haas-ja-q4"]
    kind.select_option("haas-ja-q4")
    expect(haas).to_contain_text("0.46 GiB")
    kind.select_option("haas-ja-q8")
    haas.get_by_role("button", name="Review download", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_contain_text("Third Intelligence / sakasegawa")
    expect(dialog).to_contain_text("656,381,472")
    expect(dialog).to_contain_text("speech.cpp 0.9.4 or later")
    dialog.get_by_role("checkbox").check()
    dialog.get_by_role("button", name="Agree and download", exact=True).click()
    expect(page.get_by_role("progressbar")).to_be_visible()
    assert next(data for ep, data in peer.sent if ep == "/run/start_model_download")["id"] == "haas-ja-q8"


def test_large_recognizer_shows_its_exact_size_and_license_before_consent(ui):
    from playwright.sync_api import expect

    page, peer, _, _ = ui
    page.goto(page.url + "?view=asr")
    open_engine_settings(page)
    card = page.get_by_role("group", name="Nemotron 3.5 Transcribe 30B-A4B", exact=True)
    expect(card.get_by_label("File type of Nemotron 3.5 Transcribe 30B-A4B", exact=True)).to_have_value(
        "nemotron-35-transcribe-iq4nl")
    expect(card).to_contain_text("Heavy")
    card.get_by_role("button", name="Review download", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_contain_text("18,997,225,856")
    expect(dialog).to_contain_text("OpenMDW-1.1")
    expect(dialog).to_contain_text("about 19 GB")
    dialog.get_by_role("button", name="Back", exact=True).click()
    assert not any(ep == "/run/start_model_download" for ep, _ in peer.sent)


def test_a_model_larger_than_the_gpu_is_marked_but_can_still_be_chosen(ui):
    """Issue #405: a warning mark and a plain note, compared with the GPU's total memory."""
    from playwright.sync_api import expect

    page, peer, _, _ = ui
    page.goto(page.url + "?view=asr")
    open_engine_settings(page)
    # The 16 GiB GPU of the fixture is smaller than Nemotron's IQ4_NL (about 19.8 GB).
    card = page.get_by_role("group", name="Nemotron 3.5 Transcribe 30B-A4B", exact=True)
    expect(card.get_by_text("May be too heavy", exact=True)).to_be_visible()
    expect(card).to_contain_text("Your PC may not be powerful enough for this model.")
    expect(card).to_contain_text("on a GPU with 16.00 GiB in total")
    expect(card).to_contain_text("You can still choose and try it.")
    # A model that fits gets no mark, and neither does a model without figures.
    haas = page.get_by_role("group", name="Haas-ja v1.0", exact=True)
    expect(haas.get_by_text("May be too heavy", exact=True)).to_have_count(0)
    expect(page.get_by_role("group", name="Silero VAD v6.2", exact=True).get_by_text(
        "May be too heavy", exact=True)).to_have_count(0)
    # Only guidance: the review, consent and download work as for any model.
    card.get_by_role("button", name="Review download", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_contain_text("Your PC may not be powerful enough for this model.")
    dialog.get_by_role("checkbox").check()
    dialog.get_by_role("button", name="Agree and download", exact=True).click()
    expect(page.get_by_role("progressbar")).to_be_visible()
    assert next(data for ep, data in peer.sent if ep == "/run/start_model_download")["id"] == \
        "nemotron-35-transcribe-iq4nl"


def test_speech_models_are_marked_on_a_pc_without_a_gpu(ui):
    from playwright.sync_api import expect

    page, peer, _, _ = ui
    peer.hardware["devices"] = [dict(name="CPU", description="CPU", kind="cpu", memory_total=None, memory_free=None)]
    page.get_by_role("button", name="Refresh GPU and memory", exact=True).first.click()
    mf = page.get_by_role("group", name=MF, exact=True)
    expect(mf.get_by_text("May be too heavy", exact=True)).to_be_visible()
    expect(mf).to_contain_text("No GPU was found.")
    # Each file type in the list says so too, so a lighter one can be told apart.
    expect(mf.get_by_label(f"File type of {MF}", exact=True).locator("option").first).to_contain_text(
        "may be too heavy")
    # An unmeasured PC is never shown as too weak.
    peer.hardware.update(phase="failed", devices=[], error_code="hardware_timeout")
    page.get_by_role("button", name="Refresh GPU and memory", exact=True).first.click()
    expect(page.get_by_text("May be too heavy", exact=True)).to_have_count(0)


def test_a_model_downloaded_before_a_restart_is_shown_and_prepared_with_consent(ui):
    """After a restart there are no jobs; the state's `downloaded` still names the files on disk."""
    from playwright.sync_api import expect

    page, peer, _, _ = ui
    q8, small = "C:/models/irodori-v41-q8/rev/q8.gguf", "C:/models/irodori-v41-small-f16/rev/small.gguf"
    peer.downloaded = {"irodori-v41-q8": {"model": q8}, "irodori-v41-small-f16": {"model": small}}
    peer.settings["profiles"]["japanese"]["model"] = q8
    page.reload()
    open_engine_settings(page)
    mf = page.get_by_role("group", name=MF, exact=True)
    # The file in use is shown first, even though F16 fits the free memory.
    expect(mf.get_by_label(f"File type of {MF}", exact=True)).to_have_value("irodori-v41-q8")
    expect(mf).to_contain_text("In use")
    small_card = page.get_by_role("group", name="Irodori-TTS v4.1 Small", exact=True)
    expect(small_card).to_contain_text("Downloaded")
    expect(small_card).to_contain_text("Already downloaded.")
    expect(page.get_by_role("group", name="Irodori-TTS v4 Large", exact=True)).to_contain_text("Not downloaded")
    # Getting it ready checks the files again, after the same review and consent; nothing is fetched.
    small_card.get_by_role("button", name="Check the files and get ready to use", exact=True).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_contain_text("These files are already downloaded.")
    expect(dialog).not_to_contain_text("This connects to Hugging Face")
    start = dialog.get_by_role("button", name="Agree and check", exact=True)
    expect(start).to_be_disabled()
    dialog.get_by_role("checkbox").check()
    start.click()
    sent = next(data for ep, data in peer.sent if ep == "/run/start_model_download")
    assert sent["id"] == "irodori-v41-small-f16" and sent["consent"] is True
    assert not any(ep in ("/run/apply_model_download", "/run/start_speech_server") for ep, _ in peer.sent)


def test_installed_engines_link_to_their_sites_and_show_whether_they_answer(ui):
    """VOICEVOX and the others are not downloaded: their cards send the user to the official site."""
    from playwright.sync_api import expect

    page, peer, reply, _ = ui

    def engines(ep, data):
        if ep != "/get/data/tts_engine_voices":
            return False
        up = data["engine"] == "voicevox"
        reply(ep, dict(request_id=data["request_id"], engine=data["engine"], url=data["url"], connected=up,
                       version="0.26.1" if up else None, voices=[], error_code=None if up else "tts_engine_not_ready"))
        return True

    peer.extra = engines
    cards = page.locator("[data-engine-card]")
    expect(cards).to_have_count(4)
    assert cards.evaluate_all("rows => rows.map(row => row.getAttribute('aria-label'))") == [
        "VOICEVOX", "COEIROINK", "AivisSpeech", "SHAREVOX"]
    expect(page.get_by_text("used under the terms on their official sites", exact=False)).to_be_visible()
    voicevox = page.get_by_role("group", name="VOICEVOX", exact=True)
    expect(voicevox.get_by_role("link", name="VOICEVOX website", exact=True)).to_have_attribute(
        "href", "https://voicevox.hiroshiba.jp/")
    expect(voicevox.get_by_role("link", name="Terms of use", exact=True)).to_have_attribute(
        "href", "https://voicevox.hiroshiba.jp/term/")
    expect(voicevox.get_by_role("button", name="Review download", exact=True)).to_have_count(0)
    expect(voicevox).to_contain_text("this app downloads nothing")
    # Without saved settings nothing is asked yet; each check is on request.
    expect(voicevox).to_contain_text("Not checked")
    assert not any(ep == "/get/data/tts_engine_voices" for ep, _ in peer.sent)
    voicevox.get_by_role("button", name="Check the connection to VOICEVOX again", exact=True).click()
    expect(voicevox).to_contain_text("Connected (VOICEVOX 0.26.1)")
    coeiroink = page.get_by_role("group", name="COEIROINK", exact=True)
    coeiroink.get_by_role("button", name="Check the connection to COEIROINK again", exact=True).click()
    expect(coeiroink).to_contain_text("Not connected")
    asked = [data for ep, data in peer.sent if ep == "/get/data/tts_engine_voices"]
    assert [(data["engine"], data["url"]) for data in asked] == [
        ("voicevox", "http://127.0.0.1:50021"), ("coeiroink", "http://127.0.0.1:50032")]
    assert all(data["request_id"].startswith("catalog-") and set(data) == {"engine", "url", "request_id"} for data in asked)
    # Checking starts, installs, selects and saves nothing (the GPU probe is the page's own).
    assert not any(ep.startswith("/set/") or (ep.startswith("/run/") and "hardware" not in ep) for ep, _ in peer.sent)


def test_a_model_of_ones_own_is_registered_listed_and_switched_to(ui, tmp_path):
    """#403: the registration form, the card next to the catalog's and the switch."""
    from playwright.sync_api import expect
    from models.model_downloads.user_models import FILE_NAME, UserModels

    page, peer, reply, _ = ui
    registry = UserModels(tmp_path / FILE_NAME)
    own = tmp_path / "own" / "mine.gguf"
    own.parent.mkdir()
    own.write_bytes(b"GGUF mine")

    def extra(ep, data):
        try:
            if ep == "/get/data/user_models":
                reply(ep, registry.state())
            elif ep == "/run/register_user_model":
                reply(ep, registry.register(data))
            elif ep == "/run/remove_user_model":
                reply(ep, registry.remove(data))
            elif ep == "/run/apply_user_model":
                target, paths = registry.usable(data["id"])
                assert target == "japanese" and data["expected"] == {"model": peer.settings["profiles"]["japanese"]["model"]}
                peer.settings["profiles"]["japanese"]["model"] = paths["model"]
                reply(ep, registry.state())
            else:
                return False
        except ValueError as error:
            reply(ep, {"error_code": str(error)}, 400)
        return True

    peer.extra = extra
    group = page.get_by_role("region", name="Reading Japanese", exact=True)
    group.get_by_text("Register a model of your own", exact=True).click()
    form = group.get_by_role("group", name="Register a model of your own for Reading Japanese", exact=True)
    # Nothing is sent until the form can pass.
    form.get_by_role("button", name="Register", exact=True).click()
    expect(form.get_by_role("alert")).to_have_text("Enter a name.")
    form.get_by_label("Display name").fill("My voice")
    form.get_by_label("Model file (.gguf)").fill(f'"{own}"')
    form.get_by_role("button", name="Register", exact=True).click()
    card = page.get_by_role("group", name="My voice", exact=True)
    expect(card).to_contain_text("Your model")
    expect(card).to_contain_text("Registered")
    expect(form.get_by_label("Display name")).to_have_value("")
    assert next(data for ep, data in peer.sent if ep == "/run/register_user_model") == {
        "target": "japanese", "name": "My voice", "paths": {"model": str(own)}}
    # Registering is not a save of the speech server settings around it.
    assert not any(ep == "/set/data/speech_server_settings" for ep, _ in peer.sent)
    # The card sits in the same list as the catalog's cards.
    expect(group.get_by_role("list").first.locator("[data-user-model]")).to_have_count(1)
    card.get_by_role("button", name="Use this model", exact=True).click()
    expect(card).to_contain_text("In use")
    expect(page.get_by_label("Model GGUF path", exact=True)).to_have_value(str(own))
    assert not any(ep in ("/run/start_speech_server", "/run/start_model_download") for ep, _ in peer.sent)
    # A changed file is said on the card and cannot be switched to.
    own.write_bytes(b"GGUF changed")
    reply("/get/data/user_models", registry.state())
    expect(card).to_contain_text("File changed")
    # Removing asks first and keeps the file.
    card.get_by_role("button", name="Remove registration", exact=True).click()
    card.get_by_role("button", name="Remove", exact=True).click()
    expect(page.locator("[data-user-model]")).to_have_count(0)
    assert own.exists()