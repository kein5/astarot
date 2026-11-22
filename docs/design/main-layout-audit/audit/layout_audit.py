"""Main screen layout audit (Issue #327). Audit material, not one of the repository's tests.

Renders tests/voice/studio-entry (the production MainPage with an offline sidecar peer that
answers with sample data only) in headless Chromium, resizes the viewport, takes screenshots
and records what detect.js finds. Run it from the repository root after
`python tools/dev.py setup --scope browser` and `npm ci`:

    AUDIT_OUT=build/layout-audit ASTAROT_TEST_STUDIO_UI=1 ASTAROT_TEST_CHROMIUM=/path/to/chrome \
    PYTHONPATH=tests/voice build/dev/browser-venv/bin/python -m pytest -c tests/voice/pytest.ini \
        --rootdir . docs/design/main-layout-audit/audit/layout_audit.py -q -p no:cacheprovider

It writes shots/<lang>-<state>-<size>.png and findings-<lang>.json under AUDIT_OUT.
Message text is never written to the findings: detect.js reports it as "(message)".
"""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from test_studio_ui import studio, ui  # noqa: F401
from test_docs_screenshots import answer, main_page_in_use, push, CLOCK

OUT = Path(os.environ["AUDIT_OUT"])
DETECT = (Path(__file__).parent / "detect.js").read_text()

SIZES = [
    ("400x200", 400, 200, 100),     # tauri minWidth/minHeight
    ("450x220", 450, 220, 100),     # tauri initial window size (before the saved geometry is applied)
    ("640x480", 640, 480, 100),
    ("800x600", 800, 600, 100),     # last narrow width (breakpoint is <= 800 CSS px at 100%)
    ("801x600", 801, 600, 100),     # first wide width
    ("870x654", 870, 654, 100),     # built-in first-run geometry
    ("1280x720", 1280, 720, 100),
    ("1366x768", 1366, 768, 100),
    ("1920x1080", 1920, 1080, 100),
    ("1280x720@150", 1280, 720, 150),  # UI size 150%
    ("1920x1080@200", 1920, 1080, 200),  # UI size 200%
]

LABELS = {
    "ja": dict(toggle="サイドバーを切り替える", close="サイドバーを閉じる", translator="翻訳エンジン", add="相手の言語を追加", your="あなたの言語",
               quick="クイック設定", flow="入力と出力", title="ここから会話を始めましょう"),
    "en": dict(toggle="Toggle sidebar", close="Close the sidebar", translator="Translator", add="Add a target language", your="Your Language",
               quick="Quick settings", flow="Inputs and outputs", title="Your conversation starts here"),
}


def apply_size(page, w, h, scale):
    page.set_viewport_size({"width": w, "height": h})
    # The same as UiSizeController and useWindow.asyncUpdateBreakPoint in the app.
    page.evaluate("""([scale]) => {
        document.documentElement.style.setProperty('font-size', `${62.5 * scale / 100}%`);
        document.documentElement.toggleAttribute('data-narrow', innerWidth <= 800 * scale / 100);
    }""", [scale])
    page.wait_for_timeout(350)


def settle(page):
    page.evaluate("async () => { await Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); }")


def record(page, lang, state, size, results):
    settle(page)
    name = f"{lang}-{state}-{size}"
    page.screenshot(path=str(OUT / "shots" / f"{name}.png"))
    data = page.evaluate(DETECT)
    data.update(lang=lang, state=state, size=size)
    results.append(data)


# State name -> (setup, teardown). Each setup starts from the main screen with nothing open.
def states(lang):
    L = LABELS[lang]

    def nothing(page, peer):
        pass

    def quick(page, peer):
        page.get_by_role("button", name=L["quick"]).click()
        page.wait_for_timeout(500)

    def close_escape(page, peer):
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    def your_language(page, peer):
        page.locator(f"button[aria-label^='{L['your']}']").first.click()
        page.wait_for_timeout(400)

    def close_your_language(page, peer):
        page.locator("button[aria-expanded='true']").first.click()
        page.wait_for_timeout(300)

    def translator(page, peer):
        page.get_by_text(L["translator"], exact=False).first.click()
        page.wait_for_timeout(400)

    def close_translator(page, peer):
        page.mouse.click(5, 5)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    def flow(page, peer):
        page.get_by_role("button", name=L["flow"], exact=True).click()
        page.wait_for_timeout(400)

    def close_flow(page, peer):
        page.get_by_role("button", name=L["flow"], exact=True).click()
        page.wait_for_timeout(300)

    def compact(page, peer):
        page.get_by_role("button", name=L["toggle"]).click()
        page.wait_for_timeout(400)

    def close_compact(page, peer):
        # A narrow window opens the rail over the conversation, on top of the toggle;
        # the rail then carries its own close button.
        close = page.get_by_role("button", name=L["close"])
        (close if close.count() else page.get_by_role("button", name=L["toggle"])).click()
        page.wait_for_timeout(300)

    return {
        "in-use": (nothing, nothing),
        "quick-settings": (quick, close_escape),
        "language-selector": (your_language, close_your_language),
        "translator-selector": (translator, close_translator),
        "io-flow": (flow, close_flow),
        "sidebar-toggled": (compact, close_compact),
    }


@pytest.mark.parametrize("lang", ["ja", "en"])
def test_layout_audit(studio, lang):  # noqa: F811
    page, peer = studio
    answer(peer)
    (OUT / "shots").mkdir(parents=True, exist_ok=True)
    origin = urlsplit(page.url)
    page.clock.set_fixed_time(CLOCK)
    page.emulate_media(reduced_motion="reduce")
    page.goto(f"{origin.scheme}://{origin.netloc}/tests/voice/studio-entry/?lang={lang}")
    page.get_by_role("heading", name=LABELS[lang]["title"]).wait_for()
    results = []
    errors = []

    # The empty main screen first, at every size.
    for size, w, h, scale in SIZES:
        apply_size(page, w, h, scale)
        record(page, lang, "empty", size, results)

    apply_size(page, 1280, 720, 100)
    main_page_in_use(page, peer, lang)
    # Three target languages, the sidebar's tallest form, and the language list the selector shows.
    slots = {"1": ("English", "United States"), "2": ("Korean", "South Korea"), "3": ("Chinese Simplified", "China")}
    push(peer, "/get/data/selected_target_languages", {preset: {slot: dict(language=name, country=c, enable=True) for slot, (name, c) in slots.items()} for preset in ("1", "2", "3")})
    from models.transcription.transcription_languages import transcription_lang
    push(peer, "/get/data/selectable_language_list", sorted(
        (dict(language=name, country=c) for name, cs in transcription_lang.items() for c in cs), key=lambda e: e["language"]))
    page.get_by_role("button", name=LABELS[lang]["add"]).wait_for()
    page.wait_for_timeout(500)

    for state, (setup, teardown) in states(lang).items():
        for size, w, h, scale in SIZES:
            apply_size(page, w, h, scale)
            try:
                setup(page, peer)
                record(page, lang, state, size, results)
                teardown(page, peer)
            except Exception as error:  # keep auditing the other states
                errors.append(dict(state=state, size=size, error=str(error).splitlines()[0]))
                page.keyboard.press("Escape")
                page.screenshot(path=str(OUT / "shots" / f"{lang}-{state}-{size}-error.png"))
    (OUT / f"findings-{lang}.json").write_text(json.dumps(dict(results=results, errors=errors), ensure_ascii=False, indent=1))
