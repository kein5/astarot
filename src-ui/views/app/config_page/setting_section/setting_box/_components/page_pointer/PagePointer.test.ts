import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime } from "../../../../../../../logics/test/hookHarness.ts";

// A button on a settings page that opens another page names that page and what is done there
// (#537), in one label: 「「デバイス」で音声経路を変更」, not 「音声経路を変更」, which looked as if
// the change happened where the button is.

type Language = "en" | "ja";
const settingBox = new URL("../../", import.meta.url);
const locales = Object.fromEntries((["en", "ja"] as const).map(language =>
    [language, yaml.load(readFileSync(new URL(`../../../../../../../../locales/${language}.yml`, import.meta.url), "utf8"))]));
// One step into the locale tree, as `node?.[part]` read it.
const child = (node: unknown, part: string): unknown =>
    typeof node === "object" && node !== null ? Reflect.get(node, part) : undefined;
const lookup = (language: Language, key: string): unknown => key.split(".").reduce(child, locales[language]);
const translator = (language: Language) => (key: string, values: Record<string, unknown> = {}) => {
    const text = lookup(language, key);
    assert.equal(typeof text, "string", `${language}: ${key}`);
    return String(text).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));
};
const sources = readdirSync(settingBox, { recursive: true, encoding: "utf8" })
    .filter(path => /\.(jsx|tsx)$/.test(path) && !/\.test\./.test(path))
    .map(path => ({ path: path.replaceAll("\\", "/"), text: readFileSync(new URL(path.replaceAll("\\", "/"), settingBox), "utf8") }));

const load = (runtime: HookRuntime, language: Language, opened: string[] = []) =>
    loadModule<typeof import("./PagePointer.tsx")>(new URL("./PagePointer.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: translator(language) }) },
        "@store": { useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (id: string) => opened.push(id) }) },
        "../form_row/FormRow": { FormRow: (props: unknown) => ({ type: "row", props }) },
        "../../../../../../../logics/configs/revealSetting.ts": { revealSetting() {} },
        "../../../../sidebar_section/SidebarSection.tsx": { TabIcon: (props: unknown) => ({ type: "tab-icon", props }) },
    });

test("every button that opens another settings page names that page, with what is done there", async () => {
    const links = sources.flatMap(({ path, text }) => [...text.matchAll(/<(PagePointer|PageLinkButton)\b([^>]*?)\/>/gs)].map(([, , attributes = ""]) => ({
        path, tab: attributes.match(/\btab="(\w+)"/)?.[1], action: attributes.match(/\baction=\{t\("([\w.]+)"\)\}/)?.[1] ?? null,
    }))).filter(link => !link.path.endsWith("page_pointer/PagePointer.tsx"));
    assert.ok(links.every(link => link.tab), "each one names its page as a literal tab id");
    // The route row on the TTS, RVC and VRChat pages, mute sync on Device, the VR UI on Captions
    // and VR, and the OSC destination, the speech output and chat reading on VRChat.
    assert.deepEqual(links.map(link => `${link.path.split("/").at(-1)}:${link.tab}`).sort(), [
        "Device.tsx:vrchat", "VoiceRouteSettings.tsx:device", "Vr.tsx:experimental_features",
        "Vrchat.tsx:advanced_settings", "Vrchat.tsx:ocr", "Vrchat.tsx:tts"]);
    for (const language of ["ja", "en"] as const) {
        const t = translator(language);
        const { pageLinkLabel } = await load(hooks(), language);
        for (const link of links) {
            const page = t(`config_page.side_menu_labels.${link.tab}`);
            // Every link names its tab: the assertion above stops the test before this otherwise.
            const label = pageLinkLabel(t, link.tab ?? "", link.action ? t(link.action) : null);
            assert.ok(label.includes(language === "ja" ? `「${page}」` : page), `${language} ${link.path}: ${label}`);
            if (link.action) assert.ok(label.includes(t(link.action)), `${language} ${link.path}: ${label}`);
        }
    }
    const ja = translator("ja"), { pageLinkLabel } = await load(hooks(), "ja");
    assert.equal(pageLinkLabel(ja, "device", ja("voice_ui.edit_route")), "「デバイス」で音声経路を変更");
    assert.equal(pageLinkLabel(ja, "ocr"), "「チャット読み取り（OCR）」を開く");
});

test("the words that said where a setting is are left to the button", () => {
    // The row's line says what the setting does; the button says where it is set (#614).
    for (const language of ["ja", "en"] as const) {
        const keys = ["config_page.device.mute_sync_pointer", "config_page.vr.vr_panel_pointer.desc",
            "config_page.vrchat.osc_pointer.desc", "config_page.vrchat.tts_output_pointer", "voice_ui.route_current"];
        for (const text of keys.map(key => lookup(language, key))) {
            assert.equal(typeof text, "string");
            assert.doesNotMatch(String(text), language === "ja" ? /のページ|」で(?:変え|選び)/ : /\bpage\b|under Advanced/, `${language}: ${text}`);
        }
    }
});

test("the button leads with the page's menu icon, hidden from screen readers, and opens the page", async () => {
    const runtime = hooks(), opened: string[] = [];
    const { PageLinkButton } = await load(runtime, "en", opened);
    const button = runtime.render(PageLinkButton, { tab: "tts", action: "Choose the output" });
    assert.equal(button.type, "button");
    assert.equal(button.props.type, "button");
    assert.equal(button.props["data-page-pointer"], "tts");
    const [icon, words] = button.props.children;
    assert.equal(icon.props["aria-hidden"], "true");
    assert.equal(find(icon, node => node.props?.tab_id !== undefined)?.props.tab_id, "tts");
    assert.equal(words.props.children, "Choose the output on the Text to speech (TTS) page");
    button.props.onClick();
    assert.deepEqual(opened, ["tts"]);
});

test("no settings page opens another page except through the button that names it", () => {
    // The settings menu and the search are the other ways between pages; both are outside setting_box.
    const callers = sources.filter(({ text }) => /updateSelectedConfigTabId\(/.test(text)).map(({ path }) => path);
    assert.deepEqual(callers, ["_components/page_pointer/PagePointer.tsx"]);
});
