import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../../../logics/test/hookHarness.js";
import * as searchTargets from "../../../logics/configs/config_page_setter/_aux/configSearchTargets.ts";

// Where each setting lives after the information architecture review (#554,
// docs/design/information-architecture/README.md and the decisions on the Issue).

const box = path => new URL(`./setting_section/setting_box/${path}`, import.meta.url);
const read = path => readFileSync(box(path), "utf8");
const locales = Object.fromEntries(["en", "ja"].map(language =>
    [language, yaml.load(readFileSync(new URL(`../../../../locales/${language}.yml`, import.meta.url), "utf8"))]));
const loadSearch = runtime => loadModule(new URL("../../../logics/configs/config_page_setter/_aux/useConfigSearch.js", import.meta.url), runtime, {
    "@store": {}, "@logics_configs": {}, "@ui_configs": {}, "@root/locales/config.js": {},
    "../../../transcription/useRealtimeASR": {}, "../../../common/languageNames.ts": {}, "../../../voice/settingsNavigation": {},
    "./configSearchTargets.ts": searchTargets,
});

test("Q-06: the OSC address and port are under Advanced; the VRChat page leads there", async () => {
    const advanced = read("advanced_settings/AdvancedSettings.jsx");
    const page = advanced.split("export const AdvancedSettings = () => {")[1].split("\n};")[0];
    assert.match(page, /section_label_osc[\s\S]*<OscIpAddressContainer \/>\s*<OscPortContainer \/>/);

    const vrchat = read("vrchat/Vrchat.jsx");
    assert.doesNotMatch(vrchat, /OscIpAddressContainer|OscPortContainer/);
    assert.match(vrchat, /<VrchatPresence \/>/, "the page still says whether VRChat is found, with the step that turns OSC on");

    const runtime = hooks(), opened = [];
    const pointer = await loadModule(box("_components/page_pointer/PagePointer.jsx"), runtime, {
        "@store": { useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: id => opened.push(id) }) },
        "../form_row/FormRow": { FormRow: props => ({ type: "row", props }) },
    });
    const row = runtime.render(pointer.PagePointer, { label: "OSC", description: "", tab: "advanced_settings", button: "Open Advanced" });
    const button = find(row, node => node.type === "button");
    assert.equal(button.props.children, "Open Advanced");
    button.props.onClick();
    assert.deepEqual(opened, ["advanced_settings"]);
    assert.match(vrchat, /<PagePointer [^>]*tab="advanced_settings"/);

    const search = await loadSearch(hooks());
    for (const key of ["section_label_osc", "osc_ip_address", "osc_port"]) assert.deepEqual(search.settingTabs("advanced_settings", key), ["advanced_settings"]);
    for (const language of ["en", "ja"]) {
        const vrchatTexts = locales[language].config_page.vrchat;
        assert.equal(typeof vrchatTexts.osc_pointer.label, "string");
        assert.equal(typeof vrchatTexts.open_advanced_settings, "string");
    }
});

test("Q-07: input forwarding is in the RVC page's 「詳細設定」, no longer under Advanced", async () => {
    const advanced = read("advanced_settings/AdvancedSettings.jsx");
    assert.doesNotMatch(advanced, /DirectVoiceSettings/);

    const runtime = hooks();
    const DirectVoiceSettings = () => null, AdvancedSection = () => null;
    let voice = { directState: { active: true, mode: "passthrough" }, directOwner: "passthrough" };
    const rvc = await loadModule(box("rvc/Rvc.jsx"), runtime, {
        "../../../../../../logics/voice/useVoice": { useVoice: () => voice },
        "../advanced_settings/DirectVoiceSettings": { DirectVoiceSettings },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection },
    });
    const [conversion, fold] = runtime.render(rvc.Rvc).props.children;
    assert.equal(conversion.type, DirectVoiceSettings);
    assert.equal(conversion.props.variant, "rvc");
    assert.equal(fold.type, AdvancedSection);
    assert.equal(fold.props.children.type, DirectVoiceSettings);
    assert.deepEqual(fold.props.children.props, { variant: "legacy", subheading: true });
    // The fold's line says whether the input is forwarded now.
    assert.equal(fold.props.status, "voice.input_active");
    voice = { directState: { active: true, mode: "converted" }, directOwner: "rvc" };
    assert.equal(runtime.render(rvc.Rvc).props.children[1].props.status, "voice.input_stopped");

    // The settings search still finds it, on the RVC page.
    const source = readFileSync(new URL("../../../logics/configs/config_page_setter/_aux/useConfigSearch.js", import.meta.url), "utf8");
    assert.match(source, /tab: "rvc", setting_id: "direct_voice_settings", label: t\("voice\.input_title"\)/);
    assert.match(read("advanced_settings/DirectVoiceSettings.jsx"), /data-setting-id=\{variant === "rvc" \? "rvc_settings" : "direct_voice_settings"\}/);
});

test("a fold marks its line while a row inside it has unsaved edits", async () => {
    const element = (attributes = {}, children = []) => ({
        attributes: new Set(), dataset: attributes, children,
        toggleAttribute(name, on) { if (on) this.attributes.add(name); else this.attributes.delete(name); },
        closest: () => null,
        querySelector(selector) {
            assert.equal(selector, "[data-unsaved]");
            return this.children.find(child => child.attributes.has("data-unsaved")) ?? null;
        },
    });
    const changed = element({ settingLabel: "Pitch" }), untouched = element({ settingLabel: "Threads" });
    const open = element({}, [changed]), closed = element({}, [untouched]);
    const root = { querySelectorAll: selector => ({ "[data-setting-label]": [changed, untouched], label: [], details: [open, closed] })[selector] };
    const runtime = hooks();
    const section = await loadModule(new URL("./setting_section/SettingSection.jsx", import.meta.url), runtime, {
        "./setting_box/SettingBox": {}, "@store": {}, "@logics_configs": {}, "../../../../logics/voice/saveBar": {},
    });
    section.markUnsavedRows(root, new Set(["Pitch"]));
    assert.ok(changed.attributes.has("data-unsaved"));
    assert.ok(open.attributes.has("data-unsaved-inside"));
    assert.ok(!closed.attributes.has("data-unsaved-inside"));
    section.markUnsavedRows(root, new Set());
    assert.ok(!open.attributes.has("data-unsaved-inside"));
});

// The settings search over the real texts, in Japanese, with the page names as keys.
const searchOver = async language => {
    const runtime = hooks();
    const resources = { en: locales.en, ja: locales[language] };
    const lookup = (key, values) => {
        const text = key.split(".").reduce((node, part) => node?.[part], locales[language]);
        return typeof text === "string" ? text.replace(/\{\{(\w+)\}\}/g, (_, name) => values?.[name] ?? "") : key;
    };
    const { useConfigSearch } = await loadModule(new URL("../../../logics/configs/config_page_setter/_aux/useConfigSearch.js", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: lookup, i18n: { language } }) },
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: "translation" }, updateSelectedConfigTabId() {} }) },
        "@logics_configs": { useOcr: () => ({ currentSelectableOcrSourceLanguageList: { data: {} }, currentOcrSourceLanguage: { data: "ja" } }) },
        "../../../transcription/useRealtimeASR": { useRealtimeASR: () => ({ models: {}, settings: {} }) },
        "../../../common/languageNames.ts": { createLanguageNames: () => ({ fromCode: name => name, searchText: () => "", uiOptions: () => [] }) },
        "../../../voice/settingsNavigation": { requestSettingsNavigation: fn => fn() },
        "@ui_configs": { ui_configs: { selectable_ui_languages: [] } },
        "./configSearchTargets.ts": searchTargets,
        "@root/locales/config.js": { getResource: lng => resources[lng] },
    });
    return query => {
        runtime.render(useConfigSearch).setQuery(query);
        return runtime.render(useConfigSearch).results.map(result => [result.tab, result.setting_id, result.prereq?.parent_id ?? null]);
    };
};

test("the settings search finds the experimental features, the VR panel among them, and the pointers that lead there", async () => {
    const search = await searchOver("ja");
    const vrUi = search("VR UI");
    assert.ok(vrUi.some(([tab, id]) => tab === "experimental_features" && id === "experimental_features.vr_panel"), JSON.stringify(vrUi));
    assert.ok(vrUi.some(([tab, id]) => tab === "vr" && id === "vr_panel_pointer"), JSON.stringify(vrUi));
    // A feature's own setting is shown while the feature is on; until then the search leads to its switch.
    assert.deepEqual(search("ランチャーの位置").filter(([tab]) => tab === "experimental_features"),
        [["experimental_features", "experimental_features.vr_panel.reset_launcher", "experimental_features.vr_panel"]]);
    assert.ok(search("六芒星").some(([, id]) => id === "experimental_features.tray_companion"));
    // The page's notice and the buttons that open another page are not results.
    assert.deepEqual(search("試験中の機能です。どれも最初はオフ"), []);
    assert.deepEqual(search("「実験的機能」を開く"), []);
    assert.deepEqual(search("入力音声の転送"), [["rvc", "direct_voice_settings", null]]);
});

// A page's own parts, by the names of the components it draws, with 「詳細設定」 as one part
// that lists its own. Text and headings are left out.
const pageParts = (source, name) => {
    const page = source.split(`export const ${name} = () => {`)[1].split("\n};")[0];
    const body = page.slice(page.indexOf("return ("));
    const fold = body.includes("<AdvancedSection") ? body.split("<AdvancedSection")[1].split("</AdvancedSection>")[0] : "";
    const names = text => [...text.matchAll(/<([A-Z][A-Za-z_]+)/g)].map(match => match[1])
        .filter(part => !["SectionLabelComponent", "AdvancedSection"].includes(part));
    const outside = body.replace(fold, "");
    return { outside: names(outside), fold: names(fold) };
};

test("IA-03: the VRChat page keeps the chatbox in sight; what is set once, and the rows to the pages that hold VRChat's other settings, are in 「詳細設定」", () => {
    const { outside, fold } = pageParts(read("vrchat/Vrchat.jsx"), "Vrchat");
    assert.deepEqual(outside, ["VrchatPresence", "SendMessageToVrcContainer", "SendOnlyTranslatedMessagesContainer", "ChatReadingPointer"]);
    assert.deepEqual(fold, ["EnableNotificationVrcSfxContainer", "SendReceivedMessageToVrcContainer", "VrcMicMuteSyncContainer",
        "SendMessageFormatPartsContainer", "ReceivedMessageFormatPartsContainer", "PagePointer", "VoiceRouteSummary", "PagePointer"]);
    // The voice route and the speech output have one place each; this page only leads there.
    const source = read("vrchat/Vrchat.jsx");
    assert.doesNotMatch(source, /<VoiceRouteSettings|<TtsOutputDeviceSettings/);
    assert.match(source, /tab="tts"/);
});

test("the design and hotkeys pages keep a first start's settings in sight and fold the rest", () => {
    const appearance = pageParts(read("appearance/Appearance.jsx"), "Appearance");
    assert.deepEqual(appearance.outside, ["UiLanguageContainer", "UiScalingContainer"]);
    assert.deepEqual(appearance.fold, ["MessageLogUiScalingContainer", "FontFamilyContainer", "TransparencyContainer",
        "SendMessageButtonTypeContainer", "ShowResendButtonContainer", "AutoClearMessageInputBoxContainer",
        "ConvertMessageToHiraganaContainer", "ConvertMessageToRomajiContainer"]);
    const hotkeys = pageParts(read("hotkeys/Hotkeys.jsx"), "Hotkeys");
    assert.deepEqual(hotkeys.outside, ["StopHotkeysContainer"]);
    assert.deepEqual(hotkeys.fold, ["QuickChatHotkeyContainer", "ToggleHotkeysContainer"]);
    const source = read("hotkeys/Hotkeys.jsx");
    // Every hotkey still has its row: stop and mute in sight, the others in the fold.
    for (const id of ["stop_voice", "toggle_voice_mute", "open_quick_chat", "toggle_vrct_visibility", "toggle_translation",
        "toggle_transcription_send", "toggle_transcription_receive", "toggle_tts", "toggle_rvc"]) assert.match(source, new RegExp(`"${id}"`), id);
});

test("each fold's line has its words in both languages", () => {
    for (const language of ["en", "ja"]) {
        const status = locales[language].config_page.advanced_status;
        for (const key of ["on", "off", "appearance", "hotkeys_one", "hotkeys_other", "vrchat"]) assert.equal(typeof status[key], "string", `${language}: ${key}`);
        assert.equal(typeof locales[language].config_page.common.advanced_section, "string");
    }
});
