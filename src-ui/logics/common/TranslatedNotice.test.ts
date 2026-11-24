import assert from "node:assert/strict";
import { test } from "vitest";
import i18next from "i18next";
import { draw, hooks, loadModule, treeNode } from "../test/hookHarness.ts";
import { readLocale, textAt } from "../test/locales.ts";

// A notice is an element of a function component that returns its text: the text it draws, or the
// test fails there.
const textOf = (notice: unknown) => {
    const node = treeNode(notice);
    assert.ok(node, "the notice is not an element");
    const text: unknown = draw(node);
    assert.equal(typeof text, "string");
    return String(text);
};

const resources = Object.fromEntries(["en", "ja"].map(language => [language, { translation: readLocale(language) }]));

const setup = async () => {
    const i18n = i18next.createInstance();
    // The app starts in English and applies the saved language once the engine has sent it.
    await i18n.init({ lng: "en", fallbackLng: "en", resources });
    const runtime = hooks();
    const translated = await loadModule<typeof import("./TranslatedNotice.tsx")>(new URL("./TranslatedNotice.tsx", import.meta.url), runtime,
        { "@useI18n": { useI18n: () => ({ t: i18n.t.bind(i18n) }) } });
    return { i18n, runtime, translated, draw: textOf };
};

test("a notice raised before the saved language is applied is drawn in that language", async () => {
    const s = await setup();
    const notice = s.runtime.api.createElement(s.translated.TranslatedNotice, { k: "common_warning.osc_query_remote_mic_stopped",
        labels: { sync: "config_page.others.vrc_mic_mute_sync.label", microphone: "main_page.transcription_send" } });
    assert.match(s.draw(notice), /^Messages go to another machine.*VRC mic mute sync.*Mic input/);
    await s.i18n.changeLanguage("ja");
    const text = s.draw(notice);
    assert.equal(text, textAt(resources.ja.translation, "common_warning.osc_query_remote_mic_stopped")
        .replaceAll("{{sync}}", "VRCマイクミュート同期").replaceAll("{{microphone}}", "マイク入力"));
    assert.doesNotMatch(text, /\{\{|Mic input/);
});

