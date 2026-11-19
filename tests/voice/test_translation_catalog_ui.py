"""The translation catalog (#413) with the production component, hook and IPC routes, an
offline backend peer and a headless browser: the two groups, the built-in entries told apart
from the user's, adding an entry of each group, using one and removing one. Nothing leaves this
PC; the peer answers as the core does (native/core/tests/translation_catalog.rs).

The translation page's model list (#565) is drawn here too (tests/voice/translation-page-ui-entry):
it lists only the models the user can use or download, and a model the download catalog offers
opens the shared download review."""

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
# The built-in weights of the local translation (TRANSLATION_WEIGHTS in native/core/src/languages.rs).
WEIGHTS = ["m2m100_418M-ct2-int8", "m2m100_1.2B-ct2-int8", "nllb-200-distilled-600M-ct2-int8",
           "nllb-200-distilled-1.3B-ct2-int8", "nllb-200-3.3B-ct2-int8"]
REVISION = "a" * 40


def translation_entry(model_id, name, license="MIT"):
    """A download catalog entry of target `translation`, shaped as the core sends it
    (Downloads::catalog). Nothing is published: the repository and the files are fake."""
    repo = f"example/{model_id}"
    artifacts = [dict(filename=filename, size=size, sha256="b" * 64, role=role, remote=[]) for filename, size, role in [
        ("manifest.json", 2_048, "manifest"), ("encoder_model_quantized.onnx", 150_000_000, "encoder"),
        ("decoder_model_merged_quantized.onnx", 200_000_000, "decoder"), ("vocabulary.data", 128_000_000, "weights"),
        ("tokenizer.json", 4_000_000, "tokenizer"), ("vocab.json", 2_000_000, "vocabulary")]]
    return dict(id=model_id, target="translation", name=name, provider="Meta / ASTAROT", repo=repo, revision=REVISION,
                license=license, licenses=[f"https://huggingface.co/{repo}/blob/{REVISION}/README.md"], notice="translation",
                artifacts=artifacts, total_bytes=sum(a["size"] for a in artifacts),
                destination=f"C:\\Data\\downloaded_models\\{model_id}\\{REVISION}",
                source=f"https://huggingface.co/{repo}/tree/{REVISION}", guidance=None, speech=None, profile=None,
                sources=[f"https://huggingface.co/{repo}/tree/{REVISION}"])


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
        peer = SimpleNamespace(sent=[], replies=[], errors=[], entries=[], refuse=None, sequence=0, key_store_works=True,
                               selected=WEIGHTS[0], weights={weight: False for weight in WEIGHTS}, models=[],
                               retired_folder_used=False)
        page.on("pageerror", lambda error: peer.errors.append(str(error)))

        def catalog():
            engine = copy.deepcopy(BUILTIN_ENGINE) + [
                dict(e, origin="user", weight=f"user:{e['id']}", available=True,
                     in_use=e.get("in_use", False)) for e in peer.entries if e["group"] == "engine"]
            api = copy.deepcopy(BUILTIN_API) + [dict(e, origin="user") for e in peer.entries if e["group"] == "api"]
            return dict(engine=engine, api=api, runtimes=["onnx"], protocols=["openai_compatible"],
                        retired_folder_used=peer.retired_folder_used)

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
                    # A key store that refuses the key: the core holds it in memory for the run.
                    stored = peer.key_store_works and bool(data.get("auth_key"))
                    entry.update(has_key=stored, key_in_memory=not stored, in_use=False)
                peer.entries.append(entry)
                reply(ep, catalog())
            elif ep == "/run/use_translation_catalog_entry":
                for entry in peer.entries:
                    entry["in_use"] = entry["id"] == data["id"]
                reply(ep, catalog())
            elif ep == "/run/remove_translation_catalog_entry":
                peer.entries = [e for e in peer.entries if e["id"] != data["id"]]
                reply(ep, catalog())
            # The translation page (?view=translation): the local model and its downloads.
            elif ep == "/get/data/selected_ctranslate2_weight_type":
                reply(ep, peer.selected)
            elif ep == "/get/data/selectable_ctranslate2_weight_type_dict":
                reply(ep, peer.weights)
            elif ep == "/get/data/model_download_catalog":
                reply(ep, dict(catalog_version="test-catalog", models=peer.models, legacy_models=[]))
            elif ep == "/get/data/model_download_state":
                peer.sequence += 1
                reply(ep, dict(observation_id=str(peer.sequence), jobs={}, downloaded={}))
            elif ep == "/get/data/user_models":
                reply(ep, dict(models=[]))
            elif ep == "/run/start_model_download":
                peer.sequence += 1
                job = dict(job_id="job-1", phase="queued", received_bytes=0, total_bytes=1, paths={}, error_code=None)
                reply(ep, dict(observation_id=str(peer.sequence), jobs={data["id"]: job}, downloaded={}))

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


def test_an_api_entry_whose_key_the_store_refused_says_how_long_its_key_lasts(ui):
    from playwright.sync_api import expect

    page, peer = ui
    # The key store does not take the key (a locked keyring): the entry is added all the same
    # and the core holds the key until the app closes (ADR-013).
    peer.key_store_works = False
    form = page.locator("[data-catalog-add=api]")
    form.locator("summary").click()
    form.get_by_label("Display name").fill("Home server")
    form.get_by_label("Address (URL)").fill("http://192.168.1.5:8000/v1")
    form.get_by_label("API key").fill("secret-key")
    form.get_by_role("button", name="Add").click()
    card = page.locator("[data-catalog-item='tr-1']")
    expect(card.get_by_text("Only until you close the app (not saved)")).to_be_visible()
    expect(card.get_by_text("the app holds it only until you close it")).to_be_visible()
    expect(card.get_by_text("Kept in the app's key store")).to_have_count(0)
    expect(card.get_by_role("button", name="Use as the OpenAI-compatible connection")).to_be_enabled()
    expect(form.get_by_label("API key")).to_have_value("")
    assert "secret-key" not in card.inner_text()

    # The app was closed before the store took the key: the entry stays, without a key, and
    # says what to do instead of offering a switch that cannot work.
    peer.entries[0].update(key_in_memory=False)
    page.reload()
    card = page.locator("[data-catalog-item='tr-1']")
    expect(card.get_by_text("No API key", exact=True)).to_be_visible()
    expect(card.get_by_role("alert")).to_contain_text("Remove the entry and add it again.")
    expect(card.get_by_role("button", name="Use as the OpenAI-compatible connection")).to_be_disabled()
    expect(card.get_by_role("button", name="Remove")).to_be_enabled()


def open_translation_page(page, query=""):
    """The whole translation page; its 「モデルと処理デバイス」 opened as a user would."""
    page.goto(page.url.split("?")[0].replace("/translation-catalog-ui-entry/", "/translation-page-ui-entry/") + query)
    # A cold Vite may optimize the page's dependencies and load it again; wait until that is over.
    page.wait_for_load_state("networkidle")
    setup = page.locator("details[data-setup]").first
    summary = setup.locator(":scope > summary")
    summary.wait_for(timeout=60000)
    if setup.get_attribute("open") is None:
        summary.click()
    return setup


def test_the_catalog_is_a_section_of_its_own_after_more_settings(ui):
    from playwright.sync_api import expect

    page, _peer = ui
    open_translation_page(page)
    catalog = page.get_by_role("region", name="Translation catalog")
    advanced = page.locator("details[data-advanced]")
    # In sight without opening 「詳細設定」, which stays closed (#597).
    expect(catalog).to_be_visible()
    expect(advanced).to_have_count(1)
    assert advanced.get_attribute("open") is None
    expect(advanced.get_by_role("region", name="Translation catalog")).to_have_count(0)
    after = page.evaluate("""() => {
        const fold = document.querySelector('details[data-advanced]');
        const catalog = document.querySelector('section[aria-label="Translation catalog"]');
        return Boolean(fold.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING);
    }""")
    assert after, "the catalog comes after 「詳細設定」"


def test_without_a_published_model_only_the_selected_one_and_yours_are_listed(ui):
    from playwright.sync_api import expect

    page, peer = ui
    # A model added in the translation catalog is listed under its own name.
    peer.entries.append(dict(id="tr-5", group="engine", name="my-model", runtime="onnx", folder="C:\\Models\\mine",
                             languages=[], status="ok", registered_at=None))
    peer.weights["user:tr-5"] = True
    # Another target's entry offers no translation model.
    peer.models = [dict(translation_entry("rvc-example", "Example voice"), target="rvc")]
    setup = open_translation_page(page)
    expect(setup.locator(":scope > summary")).to_contain_text("m2m100_418M-ct2-int8 · cannot be downloaded yet")
    models = setup.get_by_role("radiogroup", name="Translation model")
    expect(models.get_by_role("radio")).to_have_count(2)
    expect(models.get_by_text("m2m100_418M-ct2-int8", exact=True)).to_be_visible()
    expect(models.get_by_text("my-model", exact=True)).to_be_visible()
    for weight in WEIGHTS[1:]:
        expect(models.get_by_text(weight, exact=True)).to_have_count(0)
    # The selected model stays, marked; nothing in the list leads to a review that offers nothing.
    expect(models.get_by_text("Not available yet")).to_be_visible()
    expect(models.get_by_role("button")).to_have_count(0)
    # The note points to the other engines, in sight: not folded under "Details".
    note = setup.get_by_text("The included translation models cannot be downloaded yet.")
    expect(note).to_be_visible()
    expect(note).to_contain_text('use an external translation API or a local LLM under "More settings" below')
    expect(page.get_by_text("CTranslate2")).to_have_count(0)
    assert sent(peer, "/run/start_model_download") == []
    if os.environ.get("VRCT_TEST_SCREENSHOTS"):
        page.screenshot(path=os.path.join(os.environ["VRCT_TEST_SCREENSHOTS"], "translation-models-none.png"))
    # A narrow window: the list and the note wrap instead of widening the page.
    page.set_viewport_size({"width": 480, "height": 1600})
    expect(note).to_be_visible()
    overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, overflow


def test_a_published_model_gets_its_row_and_its_review_opens_the_shared_download(ui):
    from playwright.sync_api import expect

    page, peer = ui
    peer.models = [translation_entry("m2m100-418m-onnx-int8", "M2M100 418M · int8"),
                   translation_entry("nllb-200-distilled-600m-onnx-int8", "NLLB-200 distilled 600M · int8", "CC-BY-NC-4.0")]
    setup = open_translation_page(page)
    expect(setup.locator(":scope > summary")).to_contain_text("m2m100_418M-ct2-int8 · not downloaded")
    models = setup.get_by_role("radiogroup", name="Translation model")
    expect(models.get_by_role("radio")).to_have_count(2)
    expect(models.get_by_text("nllb-200-distilled-600M-ct2-int8", exact=True)).to_be_visible()
    expect(models.get_by_text("m2m100_1.2B-ct2-int8", exact=True)).to_have_count(0)
    expect(models.get_by_text("Not available yet")).to_have_count(0)
    expect(setup.get_by_text("The included translation models cannot be downloaded yet.")).to_have_count(0)
    reviews = models.get_by_role("button", name="Review download")
    expect(reviews).to_have_count(2)
    screenshots = os.environ.get("VRCT_TEST_SCREENSHOTS")
    if screenshots:
        page.screenshot(path=os.path.join(screenshots, "translation-models-published.png"))

    reviews.first.click()
    review = page.get_by_role("dialog", name="Model download and terms").first
    expect(review).to_be_visible()
    if screenshots:
        page.screenshot(path=os.path.join(screenshots, "translation-models-review.png"))
    # The review shows the model of the row it was opened from.
    expect(review.get_by_role("group", name="M2M100 418M")).to_be_visible()
    expect(review.get_by_role("group", name="NLLB-200 distilled 600M")).to_have_count(0)
    review.get_by_role("group", name="M2M100 418M").get_by_role("button", name="Review download").click()
    consent = page.get_by_role("dialog", name="Model download and terms").last
    expect(consent.get_by_text("Meta / ASTAROT", exact=False)).to_be_visible()
    start = consent.get_by_role("button", name="Agree and download")
    expect(start).to_be_disabled()
    consent.get_by_role("checkbox").check()
    start.click()
    expect(page.locator("dialog[open]").filter(has_text="I have reviewed the source")).to_have_count(0)
    assert sent(peer, "/run/start_model_download") == [
        dict(id="m2m100-418m-onnx-int8", consent=True, catalog_version="test-catalog")]


def test_the_catalog_fits_a_narrow_window(ui, tmp_path):
    from playwright.sync_api import expect

    page, peer = ui
    peer.entries.append(dict(id="tr-9", group="engine", name="長い名前の自分の翻訳モデル（NLLB-200 3.3B 蒸留していない版）",
                             runtime="onnx", folder="C:\\Users\\someone\\Documents\\とても長いフォルダーの名前\\translation\\nllb-200-3.3B-onnx-int8",
                             languages=[], status="ok", registered_at=None))
    # An API entry whose key is held only until the app closes: the longest key text.
    peer.entries.append(dict(id="tr-10", group="api", name="家の翻訳サーバー（LANの中のOpenAI互換のAPI）", protocol="openai_compatible",
                             url="http://192.168.1.5:8000/v1/a/very/long/path/that/keeps/going", model="", has_key=False,
                             key_in_memory=True, in_use=False, status="ok", registered_at=None))
    page.set_viewport_size({"width": 480, "height": 1600})
    page.goto(page.url.split("?")[0] + "?width=440")
    card = page.locator("[data-catalog-item='tr-9']")
    expect(card).to_be_visible()
    expect(page.locator("[data-catalog-item='tr-10']").get_by_text("Only until you close the app (not saved)")).to_be_visible()
    overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, overflow
    if os.environ.get("VRCT_TEST_SCREENSHOTS"):
        page.screenshot(path=os.path.join(os.environ["VRCT_TEST_SCREENSHOTS"], "translation-catalog-narrow.png"), full_page=True)


def test_the_retired_folder_note_shows_only_while_the_folder_holds_something(ui):
    """#597: models placed in translation-models are no longer listed. The core says only
    whether that folder holds a folder; the page then says so above the model list."""
    from playwright.sync_api import expect

    page, peer = ui
    setup = open_translation_page(page)
    expect(setup.get_by_role("radiogroup", name="Translation model")).to_be_visible()
    assert ("/get/data/translation_catalog", None) in peer.sent
    expect(page.locator("[data-retired-models-folder]")).to_have_count(0)


def test_the_retired_folder_note_leads_to_the_add_form_by_keyboard_in_a_narrow_japanese_window(ui):
    from playwright.sync_api import expect

    page, peer = ui
    peer.retired_folder_used = True
    page.set_viewport_size({"width": 480, "height": 900})
    setup = open_translation_page(page, "?lang=ja")
    note = setup.locator("[data-retired-models-folder]")
    expect(note).to_be_visible()
    expect(note).to_contain_text("translation-modelsフォルダーに置いたモデルは一覧に出なくなりました。")
    expect(note).to_contain_text("「自分のモデルを追加」で追加し直してください。")
    # Above the model list, which no longer has the folder's models.
    models = setup.get_by_role("radiogroup", name="翻訳モデル")
    note_box, models_box = note.bounding_box(), models.bounding_box()
    assert note_box["y"] + note_box["height"] <= models_box["y"] + 1, (note_box, models_box)
    # The add form sits folded at the catalog's end, out of sight.
    form = page.locator("[data-catalog-add=engine]")
    name = form.get_by_label("表示する名前")
    expect(name).not_to_be_visible()
    overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, overflow
    if os.environ.get("VRCT_TEST_SCREENSHOTS"):
        page.screenshot(path=os.path.join(os.environ["VRCT_TEST_SCREENSHOTS"], "translation-retired-folder-note.png"))

    # Reached with Tab and pressed with Enter, as a keyboard user would.
    button = note.get_by_role("button", name="「自分のモデルを追加」を開く")
    page.locator("body").focus()
    for _ in range(80):
        page.keyboard.press("Tab")
        if button.evaluate("el => el === document.activeElement"):
            break
    else:
        raise AssertionError("the note's button is not reachable with Tab")
    page.keyboard.press("Enter")
    # Every fold around the form opens, the form is in view and its first field has the focus.
    expect(form).to_have_attribute("open", "")
    assert form.evaluate("el => { for (let d = el; d; d = d.parentElement) if (d.tagName === 'DETAILS' && !d.open) return false; return true; }")
    expect(name).to_be_focused()
    expect(name).to_be_in_viewport()
    if os.environ.get("VRCT_TEST_SCREENSHOTS"):
        page.screenshot(path=os.path.join(os.environ["VRCT_TEST_SCREENSHOTS"], "translation-retired-folder-add-form.png"))
    # Nothing was sent by going there.
    assert sent(peer, "/run/register_translation_catalog_entry") == []