"""Whole production screens: keyboard navigation, viewport fit and model consent."""

import os
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from ui_details import open_engine_settings

from test_model_downloads_ui import ui as ui

# Shared pytest fixtures are intentionally re-exported for discovery.
__all__ = ["ui"]

pytestmark = pytest.mark.skipif(
    os.environ.get("VRCT_TEST_STUDIO_UI") != "1", reason="opt-in whole-app browser test"
)


# Screenshot file names keep the short names.
SHOT_NAMES = {"テキスト読み上げ（TTS）": "TTS", "ボイスチェンジャー（RVC）": "RVC"}


@pytest.fixture
def studio(ui):
    page, peer, reply, _ = ui
    from models.tts.settings import VoiceSettings
    from models.voice_conversion.settings import DirectSettings

    responses = {
        "/get/data/voice_settings": VoiceSettings().to_dict(),
        "/get/data/voice_output_devices": {"devices": [], "error": None},
        "/get/data/direct_voice_sources": {"sources": [], "error": None},
        "/get/data/direct_voice_state": {
            "observation_id": "1",
            "mode": "off",
            "active": False,
            "generation": 0,
            "settings": DirectSettings().to_dict(),
        },
    }

    def extra(endpoint, _data):
        if endpoint not in responses:
            return False
        reply(endpoint, responses[endpoint])
        return True

    peer.extra = extra
    origin = urlsplit(page.url)
    page.set_viewport_size({"width": 1200, "height": 850})
    page.goto(f"{origin.scheme}://{origin.netloc}/tests/voice/studio-entry/")
    page.get_by_role("heading", name="ここから会話を始めましょう").wait_for()
    return page, peer


def test_settings_menu_tabs_are_one_line_and_the_same_height(studio):
    # 「音声認識（ASR）」 and the other feature names took a second line for their short name,
    # so four tabs were 52 px high and the rest 40 px. Each tab is now one line that fits,
    # in both languages and also in a font whose kana are full width (Meiryo, Noto Sans CJK).
    page, _ = studio
    for lang in ("ja", "en"):
        page.goto(page.url.split("?")[0] + f"?lang={lang}")
        page.get_by_role("heading", name={"ja": "ここから会話を始めましょう", "en": "Your conversation starts here"}[lang]).wait_for()
        page.set_viewport_size({"width": 870, "height": 654})
        page.get_by_role("button", name="設定を開く" if lang == "ja" else "Open settings", exact=True).click()
        page.locator("button[aria-current=page]").first.wait_for()
        for font in ("", "Meiryo", "BIZ UDGothic"):
            tabs = page.evaluate(
                """font => [...document.querySelectorAll('[class*=tabs_wrapper] button')].map(b => {
                    const p = b.querySelector('p'); p.style.fontFamily = font;
                    const range = document.createRange(); range.selectNodeContents(p);
                    const row = { name: b.getAttribute('aria-label'), height: Math.round(b.getBoundingClientRect().height),
                        lines: new Set([...range.getClientRects()].map(x => Math.round(x.top))).size,
                        clipped: p.scrollWidth > p.clientWidth };
                    p.style.fontFamily = ''; return row; })""",
                font,
            )
            assert len(tabs) == 14, tabs
            assert all(tab["lines"] == 1 and not tab["clipped"] for tab in tabs), (lang, font, tabs)
            assert len({tab["height"] for tab in tabs}) == 1, (lang, font, tabs)
        asr = page.get_by_role("button", name="音声認識（ASR）" if lang == "ja" else "Speech recognition (ASR)", exact=True)
        assert asr.get_attribute("title") == ("音声認識（ASR）" if lang == "ja" else "Speech recognition (ASR)")


def _name_lines(page):
    """Each main switch's name (without its short name in brackets) and the lines it takes."""
    return page.evaluate(
        """() => [...document.querySelectorAll('[role=switch] p')].map(p => {
            const range = document.createRange();
            range.selectNodeContents(p.firstChild);
            const tops = new Set([...range.getClientRects()].map(rect => Math.round(rect.top)));
            return [p.firstChild.textContent, tops.size];
        })"""
    )


def test_feature_names_stay_on_one_line_in_the_default_window(studio):
    # The rail's scrollbar always takes 8 of its 240 px (overflow-y: scroll), and in a font whose
    # kana are full width (Noto Sans CJK on Linux, Meiryo) 「ボイスチェンジャー」 is nine full
    # characters wide. It broke before its last character in the default window (870 x 654).
    page, _ = studio
    page.set_viewport_size({"width": 870, "height": 654})
    page.wait_for_function("document.querySelectorAll('[role=switch] p').length >= 6")
    lines = dict(_name_lines(page))
    assert "ボイスチェンジャー" in lines, lines
    assert all(count == 1 for count in lines.values()), lines
    # The browser under test may hide scrollbars and draw its own font, so the room is measured
    # as the app has it: the switch's width less its sides, the toggle and the gap, less the
    # part of the 8 px scrollbar that the browser did not draw.
    room, size = page.evaluate(
        """() => {
            const p = [...document.querySelectorAll('[role=switch] p')].find(p => p.firstChild.textContent === 'ボイスチェンジャー');
            const sw = p.closest('[role=switch]'), style = getComputedStyle(sw);
            const toggle = sw.children[1].getBoundingClientRect().width;
            const scroll = sw.closest('[class*=scrollContainer]');
            const hidden = 8 - (scroll.offsetWidth - scroll.clientWidth);
            const room = sw.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
                - toggle - parseFloat(style.columnGap) - hidden;
            return [room, parseFloat(getComputedStyle(p).fontSize)];
        }"""
    )
    assert room >= 9 * size, (room, size)


def screenshot(page, name):
    page.evaluate(
        # An animation that goes idle after it was listed (a transition cancelled by the next
        # style change) never settles its promise, which hung the run at random; wait at most 3 s.
        "async () => { const settled = Promise.all(document.getAnimations().filter(a => a.playState !== \"idle\" && a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); await Promise.race([settled, new Promise(resolve => setTimeout(resolve, 3000))]); }"
    )
    if directory := os.environ.get("VRCT_STUDIO_SCREENSHOTS"):
        destination = Path(directory)
        destination.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(destination / f"{name}.png"))


def test_navigation_keyboard_and_all_settings(studio):
    from playwright.sync_api import expect

    page, _ = studio
    screenshot(page, "main-ja")
    settings = page.get_by_role("button", name="設定を開く", exact=True)
    settings.focus()
    page.keyboard.press("Enter")
    device = page.get_by_role("button", name="デバイス", exact=True)
    expect(device).to_be_visible()
    screenshot(page, "device-ja")
    for label in (
        "デザイン",
        "翻訳",
        "音声認識（ASR）",
        "VRChat",
        "字幕とVR",
        "ホットキー",
        "テキスト読み上げ（TTS）",
        "ボイスチェンジャー（RVC）",
        "高度な設定",
        "アップデート",
        "ASTAROTについて",
    ):
        tab = page.get_by_role("button", name=label, exact=True)
        tab.focus()
        page.keyboard.press("Enter")
        expect(tab).to_have_attribute("aria-current", "page")
        if label in ("テキスト読み上げ（TTS）", "ボイスチェンジャー（RVC）", "ホットキー", "デザイン", "ASTAROTについて"):
            screenshot(page, f"settings-{SHOT_NAMES.get(label, label)}-ja")
    page.get_by_role("button", name="戻る", exact=True).click()
    expect(settings).to_be_visible()
    expect(settings).to_be_focused()
    expect(device).not_to_be_visible()


SETTINGS_TABS = ("デバイス", "デザイン", "翻訳", "音声認識（ASR）", "VRChat", "字幕とVR", "ホットキー",
                 "テキスト読み上げ（TTS）", "ボイスチェンジャー（RVC）", "高度な設定")

# Every field a settings row offers: the forms' selects and inputs, and the older choice field.
_FIELDS = """() => [...document.querySelectorAll(
    '[data-setting-id] select, [data-setting-id] input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=color]),'
    + ' [data-setting-id] [class*=dropdown_toggle_button]')]
    .filter(el => el.getClientRects().length && !el.closest('details:not([open])') && !el.closest('[role=dialog]'))
    .map(el => { const r = el.getBoundingClientRect();
        const id = el.closest('[data-setting-id]').getAttribute('data-setting-id');
        return { id, short: el.matches('[data-field-width=short], [data-field-width=short] *'),
            tag: el.tagName, type: el.type || '', left: Math.round(r.left), width: Math.round(r.width) }; })"""


def _settings_fields(page, width):
    found = {}
    for label in SETTINGS_TABS:
        tab = page.get_by_role("button", name=label, exact=True)
        tab.click()
        page.wait_for_timeout(300)
        screenshot(page, f"fields-{SHOT_NAMES.get(label, label)}-{width}")
        found[label] = page.evaluate(_FIELDS)
    return found


def test_settings_fields_follow_the_width_rule(studio):
    # Fields were 556, 280, 200-240, 140 or 100 px wide depending on the page (#567). Now every
    # field lies in the field column, which starts at the same x on every page, and fills it
    # beside at most its own checkbox or buttons (a device's 自動選択, a hotkey's delete),
    # unless it holds a short value (a port, an address, a number: at most 14rem).
    # Rows without a label (the message format, the word list) and the threshold's number
    # beside its meter are composed controls and are left out.
    page, _ = studio
    page.get_by_role("button", name="設定を開く", exact=True).click()
    off = []
    for window in (1200, 870):
        page.set_viewport_size({"width": window, "height": 850})
        found = _settings_fields(page, window)
        columns = {(field["left"], field["width"]) for fields in found.values() for field in fields if field["tag"] == "SELECT"}
        assert len(columns) == 1, (window, columns)
        left, width = columns.pop()
        for label, fields in found.items():
            for field in fields:
                if field["id"] in ("send_message_format", "received_message_format", "mic_word_filter") or "threshold" in field["id"]:
                    continue
                inside = field["left"] >= left - 1 and field["left"] + field["width"] <= left + width + 1
                if not inside or not (field["width"] >= .6 * width or field["width"] <= 145):
                    off.append((window, left, width, label, field))
    assert not off, "\n".join(str(row) for row in off)


def test_small_window_and_reduced_motion(studio):
    from playwright.sync_api import expect

    page, _ = studio
    page.emulate_media(reduced_motion="reduce")
    for width, height in ((860, 620), (640, 480), (400, 300)):
        page.set_viewport_size({"width": width, "height": height})
        field = page.get_by_role("textbox", name="メッセージ", exact=True)
        expect(field).to_be_visible()
        bounds = field.bounding_box()
        assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= width + 1
        screenshot(page, f"main-{width}")
    page.get_by_role("button", name="設定を開く", exact=True).click()
    page.get_by_role("button", name="テキスト読み上げ（TTS）", exact=True).click()
    page.mouse.move(399, 290)
    screenshot(page, "tts-400")
    expect(page.get_by_role("button", name="戻る", exact=True)).to_be_in_viewport()


def test_empty_conversation_heading_stays_put_while_the_app_starts(studio):
    # At startup the list under the heading changes (the startup steps, then what the engines
    # still need) and the input box takes its saved height; a centred heading moved with both
    # (256, 235, 174, 195 px in 0.5.0-beta.5; 377, 341 px here). Every frame is sampled.
    page, _ = studio
    page.add_init_script(
        "window.__headingTops = [];"
        "const sample = () => { const h = document.querySelector('h1');"
        " if (h) { const top = Math.round(h.getBoundingClientRect().top);"
        " if (window.__headingTops.at(-1) !== top) window.__headingTops.push(top); }"
        " if (performance.now() < 6000) requestAnimationFrame(sample); };"
        "requestAnimationFrame(sample);"
    )
    page.reload()
    page.get_by_role("heading", name="ここから会話を始めましょう").wait_for()
    page.wait_for_timeout(3000)
    tops = page.evaluate("window.__headingTops")
    assert len(tops) == 1, tops


def _on_top(locator):
    """The element drawn at the locator's centre is the locator itself (nothing covers it)."""
    return locator.evaluate(
        "node => { const r = node.getBoundingClientRect();"
        " const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);"
        " return !!top && (top === node || node.contains(top)); }"
    )


def test_narrow_window_keeps_stop_mute_and_the_opened_sidebar_in_reach(studio):
    from playwright.sync_api import expect

    page, _ = studio
    stop = page.get_by_role("button", name="読み上げを停止", exact=True)
    for width in (400, 450):
        page.set_viewport_size({"width": width, "height": 600})
        actions = page.get_by_role("group", name="停止", exact=True)
        for button in actions.get_by_role("button").all():
            expect(button).to_be_in_viewport()
            assert _on_top(button), f"{width}px: a stop action is under another button"
    expect(stop).to_be_visible()

    # The update notice adds a button on the right (the app's updater is not in this
    # page, so a 200px stand-in takes its place): stop and mute still stay on top.
    page.get_by_role("link", name="ASTAROTの使い方を開く", exact=True).evaluate(
        "help => { const extra = document.createElement('button'); extra.textContent = 'update';"
        " extra.style.cssText = 'flex-shrink:0;width:200px'; help.parentElement.prepend(extra); }"
    )
    page.set_viewport_size({"width": 400, "height": 600})
    for button in page.get_by_role("group", name="停止", exact=True).get_by_role("button").all():
        assert _on_top(button), "a stop action is under the update notice"
        expect(button).to_be_in_viewport()
    page.reload()
    page.get_by_role("heading", name="ここから会話を始めましょう").wait_for()

    # A large UI size (170%) at the narrowest window: the opened sidebar stays inside it.
    page.evaluate("() => document.documentElement.style.setProperty('font-size', `${62.5 * 1.7}%`)")
    page.set_viewport_size({"width": 400, "height": 600})
    page.get_by_role("button", name="サイドバーを切り替える", exact=True).click()
    close = page.get_by_role("button", name="サイドバーを閉じる", exact=True)
    expect(close).to_be_visible()
    box = close.bounding_box()
    assert box["x"] + box["width"] <= 400, box
    assert _on_top(close)
    # Some conversation stays beside the sidebar, so a press outside can close it.
    page.mouse.click(395, 500)
    expect(close).to_have_count(0)


def test_stop_and_mute_keep_their_longest_words_in_view_at_the_default_ui_size(studio):
    # The narrowest bar's longest words come with a queue and a mute (「停止（12）」 and
    # 「ミュート中」). At the default UI size they still fit beside the icon rail in the smallest
    # window, in both languages: each button is wholly in view and nothing covers it.
    from playwright.sync_api import expect

    page, peer = studio
    studio_answers, observed = peer.extra, [0]
    busy = {
        "/get/data/voice_status": {"queued": 12, "active": True},
        "/get/data/voice_route": {"requested_muted": True, "ready": True, "pending": False, "managed": True},
    }

    def extra(endpoint, data):
        if endpoint not in busy:
            return studio_answers(endpoint, data)
        observed[0] += 1
        peer.replies.append(dict(endpoint=endpoint, result=dict(busy[endpoint], observation_id=str(observed[0])), status=200))
        return True

    peer.extra = extra
    for lang, stop, mute, title in (("ja", "読み上げを停止（12）", "ミュート", "ここから会話を始めましょう"),
                                    ("en", "Stop speech (12)", "Mute", "Your conversation starts here")):
        page.goto(page.url.split("?")[0] + f"?lang={lang}")
        page.get_by_role("heading", name=title).wait_for()
        for width in (400, 450):
            page.set_viewport_size({"width": width, "height": 600})
            for button in (page.get_by_role("button", name=stop, exact=True),
                           page.get_by_role("button", name=mute, exact=True, pressed=True)):
                expect(button).to_be_in_viewport(ratio=1)
                assert _on_top(button), f"{lang} {width}px: {button} is under another element"


def test_log_font_size_slider_takes_focus_only_once_opened(studio):
    from playwright.sync_api import expect

    page, _ = studio
    on_slider = (
        "() => { const el = document.activeElement;"
        " return !!el && (el.type === 'range' || !!el.closest('[role=slider]') || !!el.querySelector?.('[role=slider]')); }"
    )
    gear = page.get_by_role("button", name="ログのフォントサイズ", exact=True)
    gear.focus()
    expect(gear).to_be_focused()
    page.keyboard.press("Tab")
    assert not page.evaluate(on_slider), "Tab landed on the hidden slider"
    gear.focus()
    page.keyboard.press("Enter")
    expect(gear).to_have_attribute("aria-expanded", "true")
    for _ in range(5):
        page.keyboard.press("Tab")
        if page.evaluate(on_slider):
            break
    assert page.evaluate(on_slider), "the opened slider is reachable"


def test_log_font_size_settings_fit_the_log_in_a_low_window(studio):
    # #563: the opened panel was 18rem high whatever the log's height, so in a very low window
    # its slider was cut off by the log's edge. It is now no taller than the log, and its
    # settings scroll inside it; closed, it shows the same strip as before.
    from playwright.sync_api import expect

    page, _ = studio
    gear = page.get_by_role("button", name="ログのフォントサイズ", exact=True)
    geometry = (
        "gear => { const panel = gear.parentElement.parentElement, log = panel.parentElement;"
        " const p = panel.getBoundingClientRect(), l = log.getBoundingClientRect();"
        " const slider = panel.querySelector('input[type=range], [role=slider]');"
        " const s = slider && slider.getBoundingClientRect();"
        " return { panel: [p.top, p.bottom], log: [l.top, l.bottom],"
        " slider: s && [s.top, s.bottom], rem: parseFloat(getComputedStyle(document.documentElement).fontSize) }; }"
    )
    for width, height in ((870, 654), (870, 300), (400, 200)):
        page.set_viewport_size({"width": width, "height": height})
        page.mouse.move(0, 0)
        page.wait_for_timeout(300)
        closed = gear.evaluate(geometry)
        assert closed["panel"][1] <= closed["log"][0] + 2 * closed["rem"] + 1, (height, closed)
        gear.focus()
        page.keyboard.press("Enter")
        expect(gear).to_have_attribute("aria-expanded", "true")
        page.wait_for_timeout(300)
        opened = gear.evaluate(geometry)
        assert opened["panel"][0] >= opened["log"][0] - 1, (height, opened)
        assert opened["panel"][1] <= opened["log"][1] + 1, (height, opened)
        assert opened["slider"], "the slider is in the panel"
        slider = page.locator("input[type=range], [role=slider]").first
        slider.scroll_into_view_if_needed()
        bounds = gear.evaluate(geometry)
        assert bounds["log"][0] - 1 <= bounds["slider"][0] and bounds["slider"][1] <= bounds["log"][1] + 1, (height, bounds)
        screenshot(page, f"log-settings-{height}")
        page.keyboard.press("Escape")
        expect(gear).to_have_attribute("aria-expanded", "false")


def test_model_warning_in_styled_screen_keeps_explicit_consent(studio):
    from playwright.sync_api import expect

    page, peer = studio
    page.get_by_role("button", name="設定を開く", exact=True).click()
    page.get_by_role("button", name="テキスト読み上げ（TTS）", exact=True).click()
    open_engine_settings(page)
    page.get_by_role("button", name="取得内容を確認", exact=True).first.click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    expect(
        dialog.get_by_role("button", name="同意してダウンロード", exact=True)
    ).to_be_disabled()
    screenshot(page, "model-consent-ja")
    page.keyboard.press("Escape")
    expect(dialog).not_to_be_visible()
    assert not any(ep == "/run/start_model_download" for ep, _ in peer.sent)


def test_settings_checkboxes_are_reachable_from_the_keyboard(studio):
    from playwright.sync_api import expect

    page, _ = studio
    page.get_by_role("button", name="設定を開く", exact=True).click()
    page.get_by_role("button", name="VRChat", exact=True).click()
    # The drawn box replaces the native one, but the input stays in the tab order.
    box = page.get_by_role("checkbox").first
    expect(box).to_be_attached()
    for _ in range(60):
        page.keyboard.press("Tab")
        if box.evaluate("node => node === document.activeElement"):
            break
    expect(box).to_be_focused()


def test_vr_sample_text_stops_with_settings_and_only_the_button_restarts_it(studio):
    from playwright.sync_api import expect

    page, peer = studio

    def sends():
        return len([ep for ep, _ in peer.sent if ep == "/run/send_text_overlay"])

    settings = page.get_by_role("button", name="設定を開く", exact=True)
    settings.click()
    page.get_by_role("button", name="字幕とVR", exact=True).click()
    # The overlay editor and its sample text are in the page's 「詳細設定」 (#554).
    page.locator("details[data-advanced] > summary").first.click()
    start = page.get_by_role("button", name="サンプルの文を字幕オーバーレイに送る", exact=True)
    stop = page.get_by_role("button", name="送信を停止", exact=True)
    start.click()
    expect(stop).to_be_visible()
    for _ in range(40):
        if sends():
            break
        page.wait_for_timeout(50)
    assert sends()
    page.get_by_role("button", name="戻る", exact=True).click()
    expect(settings).to_be_visible()
    sent = sends()
    page.wait_for_timeout(1500)
    assert sends() == sent
    settings.click()
    # The VR page was only hidden, so this is the same button: it says start and nothing runs.
    expect(start).to_be_visible()
    expect(stop).to_have_count(0)
    page.wait_for_timeout(1500)
    assert sends() == sent
    start.click()
    expect(stop).to_be_visible()
    stop.click()
    expect(start).to_be_visible()


def test_vr_axes_are_a_row_whose_diagram_stays_in_the_field_column(studio):
    # The position and rotation diagram used to float in the middle of the page (#568). It is now
    # one row of the label and field columns: its axis names and step buttons stay right of the
    # row's label and inside the page, in both diagrams, wide and narrow.
    page, _ = studio
    page.get_by_role("button", name="設定を開く", exact=True).click()
    page.get_by_role("button", name="字幕とVR", exact=True).click()
    # The overlay editor is in the page's 「詳細設定」 (#554).
    page.locator("details[data-advanced] > summary").first.click()
    page.get_by_text("位置と回転", exact=True).wait_for()
    for width in (1200, 870):
        page.set_viewport_size({"width": width, "height": 850})
        for half in ("回転", "位置"):
            page.get_by_role("button", name=half, exact=True).click()
            screenshot(page, f"settings-VR-axes-{half}-{width}")
            box = page.evaluate(
                """() => {
                    const label = [...document.querySelectorAll('label, span')].find(e => e.textContent === '位置と回転');
                    const row = label.closest('[data-setting-label]');
                    const group = row.querySelector('[role=group]');
                    const page = row.parentElement.getBoundingClientRect();
                    // The axis names are drawn right-aligned in wider boxes: measure their words.
                    const words = [...group.querySelectorAll('p')].map(p => { const r = document.createRange();
                        r.selectNodeContents(p.firstChild); return r.getBoundingClientRect(); });
                    const parts = [...words, ...[...group.querySelectorAll('[role=button], [role=slider], input, button')]
                        .filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect())]
                        .filter(r => r.width > 0);
                    const label_box = label.getBoundingClientRect();
                    const stacked = group.getBoundingClientRect().top >= label_box.bottom - 1;
                    return { stacked, label_right: label_box.right, page_left: page.left, page_right: page.right,
                        left: Math.min(...parts.map(r => r.left)), right: Math.max(...parts.map(r => r.right)) };
                }"""
            )
            assert box["right"] <= box["page_right"] + 1 and box["left"] >= box["page_left"] - 1, (width, half, box)
            if not box["stacked"]:
                assert box["left"] >= box["label_right"], (width, half, box)
    sample = page.get_by_role("button", name="サンプルの文を字幕オーバーレイに送る", exact=True)
    assert sample.is_visible()


def test_settings_top_bar_stops_speech_and_mutes_without_starting_anything(studio):
    from playwright.sync_api import expect

    page, peer = studio
    page.get_by_role("button", name="設定を開く", exact=True).click()
    page.get_by_role("button", name="翻訳", exact=True).click()
    actions = page.get_by_role("group", name="停止", exact=True)
    stop = actions.get_by_role("button", name="読み上げを停止", exact=True)
    # The studio peer reports no route state: a plain mute, with one name everywhere (#436).
    mute = actions.get_by_role("button", name="ミュート", exact=True)
    expect(mute).not_to_have_attribute("aria-pressed", "true")
    before = len(peer.sent)
    stop.focus()
    page.keyboard.press("Enter")
    mute.focus()
    page.keyboard.press("Enter")
    def requests():
        return [ep for ep, _ in peer.sent[before:] if ep.startswith(("/run/", "/set/"))]

    for _ in range(50):
        if len(requests()) >= 2:
            break
        page.wait_for_timeout(50)
    # Only the stop and mute requests: nothing resumed, started or rerouted.
    assert requests() == ["/run/stop_voice", "/run/mute_voice"]
    expect(stop).to_be_visible()


def test_unavailable_translators_say_why_and_stay_out_of_the_tab_order(studio):
    from playwright.sync_api import expect

    page, peer = studio
    peer.replies.append(dict(endpoint="/get/data/selectable_translation_engines", result=["CTranslate2"], status=200))
    # The heading sits above the field-like button; the button's name carries both.
    opener = page.locator('[role="button"][aria-expanded][aria-label^="翻訳エンジン"]')
    opener.focus()
    page.keyboard.press("Enter")
    group = page.get_by_role("group", name="翻訳エンジン", exact=True)
    available = group.get_by_role("button").filter(has_text="CTranslate2")
    unavailable = group.get_by_role("button", name="Google", exact=True)
    expect(available).to_have_attribute("aria-disabled", "false")
    # The keyboard never lands on an unavailable engine, so the reason is on screen.
    reason = "選べないエンジンは、この言語や現在の設定では使えません。APIキーなどは設定の「翻訳」で確認できます。"
    expect(group.get_by_text(reason, exact=True)).to_be_visible()
    expect(group).to_have_accessible_description(reason)
    expect(unavailable).to_have_accessible_description(reason)
    expect(unavailable).to_have_attribute("aria-disabled", "true")
    screenshot(page, "translator-selector-ja")
    page.keyboard.press("Tab")
    expect(available).to_be_focused()
    page.keyboard.press("Tab")
    assert not group.evaluate("node => node.contains(document.activeElement)")


def test_translation_model_setup_is_folded_with_its_status(studio):
    from playwright.sync_api import expect

    page, _ = studio
    page.get_by_role("button", name="設定を開く", exact=True).click()
    page.get_by_role("button", name="翻訳", exact=True).click()
    setup = page.locator("details[data-setup]")
    expect(setup).to_have_count(1)
    expect(setup.locator("summary")).to_contain_text("モデルと処理デバイス")
    expect(setup).not_to_have_attribute("open", "")
