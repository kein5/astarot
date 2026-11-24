import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { hooks, loadModule, find, drawWith } from "../../../logics/test/hookHarness.ts";
import { readLocale, localeAt, textAt } from "../../../logics/test/locales.ts";
import type { LocaleBranch } from "../../../logics/test/locales.ts";
import type { HookRuntime, TreeNode } from "../../../logics/test/hookHarness.ts";
import * as searchTargets from "../../../logics/configs/config_page_setter/_aux/configSearchTargets.ts";
import * as revealSettingModule from "../../../logics/configs/revealSetting.ts";

// Where each setting lives after the information architecture review (#554,
// docs/design/information-architecture/README.md and the decisions on the Issue).

const box = (path: string) => new URL(`./setting_section/setting_box/${path}`, import.meta.url);
const read = (path: string) => readFileSync(box(path), "utf8");
const locales: Record<string, LocaleBranch> = Object.fromEntries(["en", "ja"].map(language => [language, readLocale(language)]));
const loadSearch = (runtime: HookRuntime) => loadModule<typeof import("../../../logics/configs/config_page_setter/_aux/useConfigSearch.ts")>(new URL("../../../logics/configs/config_page_setter/_aux/useConfigSearch.ts", import.meta.url), runtime, {
    "@store": {}, "@logics_configs": {}, "@ui_configs": {}, "@root/locales/config.ts": {},
    "../../../transcription/useRealtimeASR": {}, "../../../common/languageNames.ts": {}, 
    "./configSearchTargets.ts": searchTargets, "../../revealSetting.ts": revealSettingModule,
});

test("Q-06: the OSC address and port are under Advanced; the VRChat page leads there", async () => {
    const advanced = read("advanced_settings/AdvancedSettings.tsx");
    const page = advanced.split("export const AdvancedSettings = () => {")[1].split("\n};")[0];
    assert.match(page, /section_label_osc[\s\S]*<OscIpAddressContainer \/>\s*<OscPortContainer \/>/);

    const vrchat = read("vrchat/Vrchat.tsx");
    assert.doesNotMatch(vrchat, /OscIpAddressContainer|OscPortContainer/);
    assert.match(vrchat, /<VrchatPresence \/>/, "the page still says whether VRChat is found, with the step that turns OSC on");

    const runtime = hooks(), opened: string[] = [], revealed: unknown[] = [];
    const pointer = await loadModule<typeof import("./setting_section/setting_box/_components/page_pointer/PagePointer.tsx")>(box("_components/page_pointer/PagePointer.tsx"), runtime, {
        "@store": { useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (id: string) => opened.push(id) }) },
        "../form_row/FormRow": { FormRow: (props: object) => ({ type: "row", props }) },
        "../../../../../../../logics/configs/revealSetting.ts": { revealSetting: (target: unknown) => revealed.push(target) },
        "../../../../sidebar_section/SidebarSection.tsx": { TabIcon: () => null },
    });
    const press = (row: unknown) => {
        const link = find(row, node => node.type === pointer.PageLinkButton);
        assert.ok(link);
        // PageLinkButton is a function component, drawn here as a function.
        const button = find(drawWith(runtime, link), node => node.type === "button");
        assert.ok(button);
        button.props.onClick();
    };
    press(runtime.render(pointer.PagePointer, { label: "OSC", description: "", tab: "advanced_settings", action: "Change" }));
    assert.deepEqual(opened, ["advanced_settings"]);
    assert.deepEqual(revealed, [], "without a target the page opens at its top");
    press(runtime.render(pointer.PagePointer, { label: "Sync", tab: "vrchat", target: "vrc_mic_mute_sync", action: "Set up" }));
    assert.deepEqual(opened, ["advanced_settings", "vrchat"]);
    assert.deepEqual(revealed, [{ setting_id: "vrc_mic_mute_sync" }], "a setting in a fold is opened and shown");
    assert.match(vrchat, /<PagePointer [^>]*tab="advanced_settings"/);

    const search = await loadSearch(hooks());
    // The OSCQuery switch (#559) sits with them.
    for (const key of ["section_label_osc", "osc_ip_address", "osc_port", "osc_query"]) assert.deepEqual(search.settingTabs("advanced_settings", key), ["advanced_settings"]);
    for (const language of ["en", "ja"]) {
        assert.equal(typeof localeAt(locales[language], "config_page.vrchat.osc_pointer.label"), "string");
        assert.equal(typeof localeAt(locales[language], "config_page.vrchat.osc_pointer.action"), "string");
    }
});

test("Q-07: input forwarding is in the RVC page's 「詳細設定」, no longer under Advanced", async () => {
    const advanced = read("advanced_settings/AdvancedSettings.tsx");
    assert.doesNotMatch(advanced, /DirectVoiceSettings/);

    const runtime = hooks();
    const DirectVoiceSettings = () => null, AdvancedSection = () => null;
    let voice = { directState: { active: true, mode: "passthrough" }, directOwner: "passthrough" };
    const rvc = await loadModule<typeof import("./setting_section/setting_box/rvc/Rvc.tsx")>(box("rvc/Rvc.tsx"), runtime, {
        "../../../../../../logics/voice/useVoice": { useVoice: () => voice },
        "../advanced_settings/DirectVoiceSettings": { DirectVoiceSettings },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
    });
    const page = runtime.render(rvc.Rvc);
    // The page keeps its descriptions out of sight, as hints (#614), the fold's form included.
    assert.equal(page.type, "hints");
    const [conversion, fold] = page.props.children;
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
    const source = readFileSync(new URL("../../../logics/configs/config_page_setter/_aux/useConfigSearch.ts", import.meta.url), "utf8");
    assert.match(source, /tab: "rvc", setting_id: "direct_voice_settings", label: t\("voice\.input_title"\)/);
    assert.match(read("advanced_settings/DirectVoiceSettings.tsx"), /data-setting-id=\{variant === "rvc" \? "rvc_settings" : "direct_voice_settings"\}/);
});

// #614: the TTS page keeps its descriptions out of sight, as hints, its servers' part included.
test("the TTS page wraps its form and its servers in the hints", async () => {
    const runtime = hooks();
    const VoiceSettings = () => null, SpeechServers = () => null;
    const tts = await loadModule<typeof import("./setting_section/setting_box/tts/Tts.tsx")>(box("tts/Tts.tsx"), runtime, {
        "../advanced_settings/VoiceSettings": { VoiceSettings }, "../advanced_settings/SpeechServers": { SpeechServers },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
    });
    const page = runtime.render(tts.Tts);
    assert.equal(page.type, "hints");
    const [form, servers] = page.props.children;
    assert.equal(form.type, VoiceSettings);
    assert.equal(servers.type, SpeechServers);
    assert.deepEqual(servers.props.profiles, ["japanese", "multilingual"]);
});

// The settings search over the real texts, in Japanese, with the page names as keys.
const searchOver = async (language: string) => {
    const runtime = hooks();
    const resources: Record<string, LocaleBranch> = { en: locales.en, ja: locales[language] };
    const lookup = (key: string, values?: Record<string, string>) => {
        const text = localeAt(locales[language], key);
        return typeof text === "string" ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values?.[name] ?? "") : key;
    };
    const { useConfigSearch } = await loadModule<typeof import("../../../logics/configs/config_page_setter/_aux/useConfigSearch.ts")>(new URL("../../../logics/configs/config_page_setter/_aux/useConfigSearch.ts", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: lookup, i18n: { language } }) },
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: "translation" }, updateSelectedConfigTabId() {} }) },
        "@logics_configs": { useOcr: () => ({ currentSelectableOcrSourceLanguageList: { data: {} }, currentOcrSourceLanguage: { data: "ja" } }) },
        "../../../transcription/useRealtimeASR": { useRealtimeASR: () => ({ models: {}, settings: {} }) },
        "../../../common/languageNames.ts": { createLanguageNames: () => ({ fromCode: (name: string) => name, searchText: () => "", uiOptions: () => [] }) },
        
        "@ui_configs": { ui_configs: { selectable_ui_languages: [] } },
        "./configSearchTargets.ts": searchTargets, "../../revealSetting.ts": revealSettingModule,
        "@root/locales/config.ts": { getResource: (lng: string) => resources[lng] },
    });
    return (query: string) => {
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
    // The page's notice and the buttons that open another page are not results; a button's
    // words lead to the row it sits on when they are in that row's group.
    assert.deepEqual(search("試験中の機能です。どれも最初はオフ"), []);
    assert.deepEqual(search("ミュート同期を設定"), []);
    assert.deepEqual(search("VR UIを設定"), [["vr", "vr_panel_pointer", null]]);
    assert.deepEqual(search("入力音声の転送"), [["rvc", "direct_voice_settings", null]]);
});

// A page's own parts, by the names of the components it draws, with 「詳細設定」 as one part
// that lists its own. Text and headings are left out.
const pageParts = (source: string, name: string) => {
    const page = source.split(`export const ${name} = () => {`)[1].split("\n};")[0];
    const body = page.slice(page.indexOf("return ("));
    const fold = body.includes("<AdvancedSection") ? body.split("<AdvancedSection")[1].split("</AdvancedSection>")[0] : "";
    const names = (text: string) => [...text.matchAll(/<([A-Z][A-Za-z_]+)/g)].map(match => match[1])
        // HintDescriptions only says how the page's descriptions are shown (#614).
        .filter(part => !["SectionLabelComponent", "AdvancedSection", "HintDescriptions"].includes(part));
    const outside = body.replace(fold, "");
    return { outside: names(outside), fold: names(fold) };
};

test("IA-03: the VRChat page keeps the chatbox in sight; what is set once, and the rows to the pages that hold VRChat's other settings, are in 「詳細設定」", () => {
    const { outside, fold } = pageParts(read("vrchat/Vrchat.tsx"), "Vrchat");
    assert.deepEqual(outside, ["VrchatPresence", "SendMessageToVrcContainer", "SendOnlyTranslatedMessagesContainer", "ChatReadingPointer"]);
    assert.deepEqual(fold, ["EnableNotificationVrcSfxContainer", "SendReceivedMessageToVrcContainer", "VrcMicMuteSyncContainer",
        "SendMessageFormatPartsContainer", "ReceivedMessageFormatPartsContainer", "PagePointer", "VoiceRouteSummary", "PagePointer"]);
    // The voice route and the speech output have one place each; this page only leads there.
    const source = read("vrchat/Vrchat.tsx");
    assert.doesNotMatch(source, /<VoiceRouteSettings|<TtsOutputDeviceSettings/);
    assert.match(source, /tab="tts"/);
});

test("the design and hotkeys pages keep a first start's settings in sight and fold the rest", () => {
    const appearance = pageParts(read("appearance/Appearance.tsx"), "Appearance");
    // The theme (#965) is drawn as its colours and stays in sight with the window's size.
    assert.deepEqual(appearance.outside, ["UiLanguageContainer", "UiScalingContainer", "ThemeContainer"]);
    assert.deepEqual(appearance.fold, ["MessageLogUiScalingContainer", "FontFamilyContainer", "TransparencyContainer",
        "SendMessageButtonTypeContainer", "ShowResendButtonContainer", "AutoClearMessageInputBoxContainer",
        "ConvertMessageToHiraganaContainer", "ConvertMessageToRomajiContainer"]);
    const hotkeys = pageParts(read("hotkeys/Hotkeys.tsx"), "Hotkeys");
    // That hotkeys are paused while settings are open is said by a readout, before the rows (#614).
    assert.deepEqual(hotkeys.outside, ["EnvReadout", "StopHotkeysContainer"]);
    assert.deepEqual(hotkeys.fold, ["QuickChatHotkeyContainer", "ToggleHotkeysContainer"]);
    const source = read("hotkeys/Hotkeys.tsx");
    // Every hotkey still has its row: stop and mute in sight, the others in the fold.
    for (const id of ["stop_voice", "toggle_voice_mute", "open_quick_chat", "toggle_vrct_visibility", "toggle_translation",
        "toggle_transcription_send", "toggle_transcription_receive", "toggle_tts", "toggle_rvc"]) assert.match(source, new RegExp(`"${id}"`), id);
});

test("each fold's line has its words in both languages", () => {
    for (const language of ["en", "ja"]) {
        for (const key of ["on", "off", "appearance", "hotkeys_one", "hotkeys_other", "vrchat"]) assert.equal(typeof localeAt(locales[language], `config_page.advanced_status.${key}`), "string", `${language}: ${key}`);
        assert.equal(typeof localeAt(locales[language], "config_page.common.advanced_section"), "string");
    }
});

test("the Device page chooses the microphone and the speaker first; their sensitivity, the voice route and mute sync are in 「詳細設定」", () => {
    const source = read("device/Device.tsx");
    const page = source.split("export const Device = () => {")[1].split("\n};")[0];
    const [outside, fold] = page.split("<AdvancedSection");
    assert.deepEqual([...outside.matchAll(/<(\w+Container) part="(\w+)"/g)].map(match => match.slice(1)), [["MicContainer", "device"], ["SpeakerContainer", "device"]]);
    assert.deepEqual([...fold.matchAll(/<(\w+)(?: part="(\w+)")?/g)].map(match => match.slice(1).filter(Boolean).join(":")),
        ["MicContainer:sensitivity", "SpeakerContainer:sensitivity", "VoiceRouteSettings", "PagePointer"]);
    assert.match(fold, /tab="vrchat" target="vrc_mic_mute_sync"/);
    assert.doesNotMatch(source, /<VrcMicMuteSyncContainer/, "mute sync has one place, the VRChat page");
    // A row elsewhere that changes the route opens this page on it.
    assert.match(read("device/VoiceRouteSettings.tsx"), /<PageLinkButton tab="device" action=\{t\("voice_ui\.edit_route"\)\} target="voice_route" \/>/);
});

test("chat reading keeps what it needs to start in sight; where and how often it reads are in 「詳細設定」", () => {
    const source = read("ocr/Ocr.tsx");
    const { outside, fold } = pageParts(source, "Ocr");
    assert.deepEqual(outside, ["Main_Container"]);
    assert.deepEqual(fold, ["Detection_Container", "CaptureTarget_Container", "Performance_Container"]);
    const main = source.split("const Main_Container = () => {")[1].split("\n};")[0];
    assert.match(main, /<OcrStatus[\s\S]*<OcrSourceLanguage_Box \/>[\s\S]*<OcrSharedWindow \/>[\s\S]*<OcrModels/);
    for (const language of ["en", "ja"]) assert.equal(typeof localeAt(locales[language], "config_page.advanced_status.ocr"), "string");
});

test("text to speech keeps the engine, the voice and the output in sight; the monitor, generation and microphone speech are in 「詳細設定」", () => {
    const source = read("advanced_settings/VoiceSettings.tsx");
    const page = source.split("export const VoiceSettings = () => {")[1].split("\n};")[0];
    const [before, rest] = page.split("<AdvancedSection");
    const fold = rest.split("</AdvancedSection>")[0];
    for (const part of [/aria-label=\{t\("voice\.mode"\)\}/, /t\("voice\.output_device"\)/, /<VirtualMicEntry \/>/, /<TtsEngine /, /input\(`\$\{role\}_voice`\)/])
        assert.match(before, part);
    for (const part of [/monitor_heading/, /<GenerationOptions /, /t\("voice\.mic_mode"\)/, /t\("voice\.conversion"\)/]) {
        assert.match(fold, part);
        assert.doesNotMatch(before, part);
    }
    // The form saves all of it, also what is folded: the fold is inside the form.
    assert.ok(page.indexOf("<form") < page.indexOf("<AdvancedSection") && page.indexOf("</AdvancedSection>") < page.indexOf("</form>"));
});

test("「詳細設定」 starts closed, opens by itself for something in use, and can still be closed", async () => {
    const runtime = hooks();
    const fold = await loadModule<typeof import("./setting_section/setting_box/_components/advanced_section/AdvancedSection.tsx")>(box("_components/advanced_section/AdvancedSection.tsx"), runtime, {
        "../fold/Fold": { Fold: "fold" },
    });
    let tree = runtime.render(fold.AdvancedSection, { status: "line", children: "inside" });
    // A bar of the app's one fold.
    assert.equal(tree.type, "fold");
    assert.equal(tree.props.open, false);
    assert.ok("data-advanced" in tree.props);
    assert.deepEqual(tree.props.summary.props.children.map((part: TreeNode | undefined) => part?.props?.children), ["config_page.common.advanced_section", "line"]);
    tree = runtime.render(fold.AdvancedSection, { status: "line", attention: true, children: "inside" });
    tree = runtime.render(fold.AdvancedSection, { status: "line", attention: true, children: "inside" });
    assert.equal(tree.props.open, true, "a provider in use opens it");
    tree.props.onToggle({ currentTarget: { open: false } });
    tree = runtime.render(fold.AdvancedSection, { status: "line", attention: true, children: "inside" });
    assert.equal(tree.props.open, false, "the user can close it again");
});

test("translation keeps its local model and its catalog in sight; the APIs and local LLMs it counts on the fold's line are the ones drawn in it", () => {
    const source = read("translation/Translation.tsx");
    const { outside, fold } = pageParts(source, "Translation");
    // The translation catalog (#413) is a section of its own after the fold (#597), not inside it.
    assert.deepEqual(outside, ["AITranslation_Container", "TranslationCatalogSection"]);
    assert.ok(source.indexOf("<TranslationCatalogSection />") > source.indexOf("</AdvancedSection>"), "the catalog comes after 「詳細設定」");
    // What an LLM engine is sent leads the fold, once for the APIs and the local servers (#614);
    // what they are all asked besides the text closes it, once for both (#392).
    assert.deepEqual(fold, ["Lead", "ExternalTranslationAPI_Container", "LocalLLM_Container", "LLMTranslationOptions_Container"]);
    const providers = (name: string) => [...source.split(`const ${name} = () => {`)[1].split("\n};")[0].matchAll(/<Provider id="(\w+)">/g)].map(match => match[1]);
    const list = (name: string) => {
        const match = source.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\]);`));
        assert.ok(match);
        return JSON.parse(match[1]);
    };
    assert.deepEqual(providers("ExternalTranslationAPI_Container"), list("EXTERNAL_API_PROVIDERS"));
    assert.deepEqual(providers("LocalLLM_Container"), list("LOCAL_LLM_PROVIDERS"));
});

test("speech recognition shows its engine and the engine's two systems in sight; what is set once is in 「詳細設定」", () => {
    const source = read("transcription/Transcription.tsx");
    const { outside, fold } = pageParts(source, "Transcription");
    // #414: speech.cpp on your PC (its models and server), then the APIs (one fold per provider
    // with its key), as the translation catalog splits translation (#413). The APIs left
    // 「詳細設定」; the realtime captions stayed, since they are set once.
    assert.deepEqual(outside, ["TranscriptionEngine_Container", "EngineGroup", "SpeechServers", "EngineGroup", "CloudTranscription_Container"]);
    assert.deepEqual(fold, ["Mic_Container", "Speaker_Container", "RealtimeASRSettings"]);
    assert.deepEqual([...source.matchAll(/<EngineGroup group="(\w+)">/g)].map(match => match[1]), ["speechcpp", "api"]);
    // The search finds both groups by their names, and leads to their headings.
    assert.match(source, /const ENGINE_GROUPS = \{ speechcpp: "speechcpp_section", api: "cloud_section" \};/);
    for (const language of ["en", "ja"]) {
        const texts = "config_page.transcription";
        for (const id of ["speechcpp_section", "cloud_section"]) {
            assert.equal(typeof localeAt(locales[language], `${texts}.${id}.label`), "string", `${language}: ${id}`);
            assert.equal(typeof localeAt(locales[language], `${texts}.${id}.desc`), "string", `${language}: ${id}`);
        }
        assert.equal(typeof localeAt(locales[language], `${texts}.select_transcription_engine.badge_own`), "string");
        assert.match(textAt(locales[language], "config_page.advanced_status.transcription"), /\{\{phrase\}\}[\s\S]*\{\{speaker\}\}/);
        assert.doesNotMatch(textAt(locales[language], "config_page.advanced_status.transcription"), /\{\{cloud\}\}/);
    }
});

test("captions and VR turns the captions on in sight; where they sit, how they look and what they show are in 「詳細設定」", () => {
    const source = read("vr/Vr.tsx");
    const page = source.split("export const Vr = () => {")[1].split("\n};")[0];
    const [before, rest] = page.split("<AdvancedSection");
    const [fold, after] = rest.split("</AdvancedSection>");
    assert.match(before, /setting_id="overlay_small_log"[\s\S]*toggleIsEnabledOverlaySmallLog[\s\S]*setting_id="overlay_large_log"[\s\S]*toggleIsEnabledOverlayLargeLog/);
    assert.match(before, /<DesktopCaptionOverlay part="enable" \/>/);
    for (const part of [/data-setting-id="vr_overlay"/, /<OverlaySettingsContainer/, /<DesktopCaptionOverlay part="details" \/>/, /<CommonSettingsContainer \/>/, /restore_default_settings/])
        assert.match(fold, part);
    assert.match(after, /<PagePointer [^>]*tab="experimental_features"/);
    // The overlay editor no longer carries its own switch: it is the one in sight.
    assert.doesNotMatch(source.split("const OverlaySettingsContainer = (")[1].split("\n};")[0], /CheckboxContainer/);
    const desktop = readFileSync(box("vr/DesktopCaptionOverlay.tsx"), "utf8");
    const enable = desktop.split('if (part === "enable") return (')[1].split("\n    );")[0];
    assert.match(enable, /setting_id="desktop_overlay"/);
    assert.doesNotMatch(enable, /desktop_overlay_position|desktop_overlay_font_size/);
});
