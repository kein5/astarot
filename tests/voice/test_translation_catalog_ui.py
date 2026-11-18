"""The translation catalog (#413) with the production component, hook and IPC routes, an
offline backend peer and a headless browser: the two groups, the built-in entries told apart
from the user's, adding an entry of each group, using one and removing one. Nothing leaves this
PC; the peer answers as the core does (native/core/tests/translation_catalog.rs)."""

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

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(
    os.environ.get("VRCT_TEST_TRANSLATION_CATALOG_UI") != "1", reason="opt-in browser test"
)

BUILTIN_ENGINE = [
    dict(id="m2m100_418M-ct2-int8", weight="m2m100_418M-ct2-int8", origin="builtin", name="m2m100_418M-ct2-int8",
         runtime="onnx", non_commercial=False, available=True, in_use=True),
    dict(id="nllb-200-distilled-600M-ct2-int8", weight="nllb-200-distilled-600M-ct2-int8", origin="builtin",
         name="nllb-200-distilled-600M-ct2-int8", runtime="onnx", non_commercial=True, available=False, in_use=False),
]
BUILTIN_API = [
    dict(id="DeepL_API", origin="builtin", name="DeepL_API", kind="cloud", available=False),
    dict(id="Ollama", origin="builtin", name="Ollama", kind="local_server", available=True),
]


@pytest.fixture
def ui(tmp_path):
    from playwright.sync_api import sync_playwright

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
        page.set_default_navigation_timeout(60000)
        peer = SimpleNamespace(sent=[], replies=[], errors=[], entries=[], refuse=None, sequence=0)
        page.on("pageerror", lambda error: peer.errors.append(str(error)))

        def catalog():
            engine = copy.deepcopy(BUILTIN_ENGINE) + [
                dict(e, origin="user", weight=f"user:{e['id']}", available=True,
                     in_use=e.get("in_use", False)) for e in peer.entries if e["group"] == "engine"]
            api = copy.deepcopy(BUILTIN_API) + [dict(e, origin="user") for e in peer.entries if e["group"] == "api"]
            return dict(engine=engine, api=api, runtimes=["onnx"], protocols=["openai_compatible"])

        def reply(endpoint, result, status=200):
            peer.replies.append(dict(endpoint=endpoint, result=result, status=status))

        def write(line):
            req = json.loads(line)
            ep = req["endpoint"]
            data = json.loads(base64.b64decode(req["data"])) if req.get("data") else None
            peer.sent.append((ep, data))
            if ep.startswith("/run/") and peer.refuse:
                code, peer.refuse = peer.refuse, None
                reply(ep, dict(error_code=code), 400)
            elif ep == "/get/data/translation_catalog":
                reply(ep, catalog())
            elif ep == "/run/register_translation_catalog_entry":
                peer.sequence += 1
                entry = {k: v for k, v in data.items() if k != "auth_key"}
                entry.update(id=f"tr-{peer.sequence}", status="ok", registered_at=None)
                if data["group"] == "api":
                    entry.update(has_key=bool(data.get("auth_key")), in_use=False)
                peer.entries.append(entry)
                reply(ep, catalog())
            elif ep == "/run/use_translation_catalog_entry":
                for entry in peer.entries:
                    entry["in_use"] = entry["id"] == data["id"]
                reply(ep, catalog())
            elif ep == "/run/remove_translation_catalog_entry":
                peer.entries = [e for e in peer.entries if e["id"] != data["id"]]
                reply(ep, catalog())

        def read():
            result, peer.replies = peer.replies, []
            return result

        page.expose_function("sidecarWrite", write)
        page.expose_function("sidecarRead", read)
        page.goto(f"http://127.0.0.1:{port}/tests/voice/translation-catalog-ui-entry/")
        yield page, peer
        assert not peer.errors


def sent(peer, endpoint):
    return [data for ep, data in peer.sent if ep == endpoint]


def test_two_groups_list_the_shipped_entries_apart_from_the_users(ui):
    from playwright.sync_api import expect

    page, peer = ui
    for group in ("engine", "api"):
        section = page.locator(f"[data-catalog-group={group}]")
        expect(section.get_by_text("You have not added any yet.")).to_be_visible()
        shipped = section.locator("details").first
        shipped.locator("summary").click()
        expect(shipped.get_by_text("Included", exact=True).first).to_be_visible()
    expect(page.locator("[data-catalog-item='nllb-200-distilled-600M-ct2-int8']").get_by_text("Non-commercial license")).to_be_visible()
    expect(page.locator("[data-catalog-item='Ollama']").get_by_text("Server you run")).to_be_visible()


def test_an_engine_entry_is_added_used_and_removed_with_a_confirmation(ui):
    from playwright.sync_api import expect

    page, peer = ui
    form = page.locator("[data-catalog-add=engine]")
    form.locator("summary").click()
    form.get_by_role("button", name="Add").click()
    expect(form.get_by_text("Enter a name.")).to_be_visible()
    assert sent(peer, "/run/register_translation_catalog_entry") == []
    form.get_by_label("Display name").fill("My NLLB")
    form.get_by_label("Folder of the model").fill('"C:\\Models\\nllb 1.3B"')
    form.get_by_label("Language codes (optional)").fill("ja, en")
    form.get_by_label("Language codes (optional)").press("Enter")
    expect(page.locator("[data-catalog-item='tr-1']")).to_be_visible()
    assert sent(peer, "/run/register_translation_catalog_entry") == [
        dict(group="engine", name="My NLLB", runtime="onnx", folder="C:\\Models\\nllb 1.3B", languages=["ja", "en"])]
    expect(form.get_by_label("Display name")).to_have_value("")

    card = page.locator("[data-catalog-item='tr-1']")
    expect(card.get_by_text("Added by you")).to_be_visible()
    expect(card.get_by_text("ja, en")).to_be_visible()
    card.get_by_role("button", name="Use for translation on your PC").click()
    expect(card.get_by_text("In use")).to_be_visible()
    # The local model in use cannot be removed.
    expect(card.get_by_role("button", name="Remove")).to_be_disabled()
    # A switch reads back the local weights and the compatible engine the settings show.
    assert ("/get/data/selectable_ctranslate2_weight_type_dict", None) in peer.sent


def test_an_api_entry_sends_its_key_once_and_shows_only_that_it_is_kept(ui):
    from playwright.sync_api import expect

    page, peer = ui
    form = page.locator("[data-catalog-add=api]")
    form.locator("summary").click()
    form.get_by_label("Display name").fill("Home server")
    form.get_by_label("Address (URL)").fill("http://192.168.1.5:8000/v1")
    form.get_by_role("button", name="Add").click()
    expect(form.get_by_text("Enter the API key.")).to_be_visible()
    form.get_by_label("API key").fill(" secret-key ")
    peer.refuse = "translation_catalog_url_invalid"
    form.get_by_role("button", name="Add").click()
    expect(page.get_by_text("This address cannot be used.")).to_be_visible()
    expect(form.get_by_label("Display name")).to_have_value("Home server")
    form.get_by_role("button", name="Add").click()
    card = page.locator("[data-catalog-item='tr-1']")
    expect(card).to_be_visible()
    assert sent(peer, "/run/register_translation_catalog_entry")[-1] == dict(
        group="api", name="Home server", protocol="openai_compatible", url="http://192.168.1.5:8000/v1", model="", auth_key="secret-key")
    expect(card.get_by_text("Kept in the app's key store")).to_be_visible()
    expect(card.get_by_text("The first model the server lists")).to_be_visible()
    assert "secret-key" not in card.inner_text()
    expect(form.get_by_label("API key")).to_have_value("")

    card.get_by_role("button", name="Use as the OpenAI-compatible connection").click()
    expect(card.get_by_text("In use")).to_be_visible()
    card.get_by_role("button", name="Remove").click()
    confirm = card.get_by_role("group", name="Remove Home server")
    expect(confirm.get_by_text("The entry and its API key are removed from the app.")).to_be_visible()
    confirm.get_by_role("button", name="Back").click()
    assert sent(peer, "/run/remove_translation_catalog_entry") == []
    card.get_by_role("button", name="Remove").click()
    card.get_by_role("button", name="Remove", exact=True).last.click()
    expect(page.locator("[data-catalog-item='tr-1']")).to_have_count(0)
    assert sent(peer, "/run/remove_translation_catalog_entry") == [dict(id="tr-1")]


def test_the_catalog_fits_a_narrow_window(ui, tmp_path):
    from playwright.sync_api import expect

    page, peer = ui
    peer.entries.append(dict(id="tr-9", group="engine", name="長い名前の自分の翻訳モデル（NLLB-200 3.3B 蒸留していない版）",
                             runtime="onnx", folder="C:\\Users\\someone\\Documents\\とても長いフォルダーの名前\\translation\\nllb-200-3.3B-onnx-int8",
                             languages=[], status="ok", registered_at=None))
    page.set_viewport_size({"width": 480, "height": 1600})
    page.goto(page.url.split("?")[0] + "?width=440")
    card = page.locator("[data-catalog-item='tr-9']")
    expect(card).to_be_visible()
    overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, overflow
    if os.environ.get("VRCT_TEST_SCREENSHOTS"):
        page.screenshot(path=os.path.join(os.environ["VRCT_TEST_SCREENSHOTS"], "translation-catalog-narrow.png"), full_page=True)
