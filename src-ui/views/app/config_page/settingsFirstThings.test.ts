import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { hooks, loadModule, find, unchecked } from "../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../logics/test/hookHarness.ts";
import * as featureLabel from "../../../logics/common/featureLabel.ts";
import * as searchTargets from "../../../logics/configs/config_page_setter/_aux/configSearchTargets.ts";
import * as revealSettingModule from "../../../logics/configs/revealSetting.ts";
import * as settingsMenu from "../../../logics/configs/settingsMenu.ts";
import * as usagePresets from "../../../logics/configs/usagePresets.ts";

// A locale file: texts under nested keys. The type lets a test both follow keys and read a text;
// what is really there is what the tests check (typeof ... === "string"), as before.
type Texts = string & { readonly [key: string]: Texts };
// Test data: a locale file, read as the nested texts it is.
const locale = (language: string) => unchecked<Texts>(yaml.load(readFileSync(new URL(`../../../../locales/${language}.yml`, import.meta.url), "utf8")));

const all = (tree: unknown, predicate: (node: TreeNode) => boolean, found: TreeNode[] = []) => { find(tree, node => { if (predicate(node)) found.push(node); return false; }); return found; };
// A node's own component: the pages' function components, drawn here as functions.
const component = (node: TreeNode) => unchecked<(props: unknown) => TreeNode | null>(node.type);
// Whether a node is drawn by the function component of that name.
const named = (node: TreeNode, name: string) => typeof node.type === "function" && node.type.name === name;
const icon = (name: string) => Object.assign(() => null, { icon: name });
// The menu's tabs, group by group: SidebarSection draws the groups, each group its tabs.
const menuTabs = (runtime: HookRuntime, tree: unknown) => all(tree, node => node.props?.group?.tabs)
    .flatMap(group => all(runtime.render(component(group), group.props), node => typeof node.props?.tab_id === "string"));

test("chat reading has a page of its own, and search lists it there", async () => {
    const runtime = hooks();
    let tab = "ocr";
    const pages = Object.fromEntries(["Device", "Tts", "Rvc", "Appearance", "Translation", "Transcription", "Vrchat", "Ocr",
        "AdvancedSettings", "Vr", "Hotkeys", "AboutVrct", "Updater"].map(name => [name, name]));
    const { SettingBox } = await loadModule<typeof import("./setting_section/setting_box/SettingBox.tsx")>(new URL("./setting_section/setting_box/SettingBox.tsx", import.meta.url), runtime, {
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: tab } }) }, "@setting_box": pages,
    });
    const ocr = runtime.render(SettingBox);
    assert.ok(ocr);
    assert.equal(ocr.type, "Ocr");
    for (const id of ["vrchat", "others"]) {
        tab = id;
        const page = runtime.render(SettingBox);
        assert.ok(page);
        assert.equal(page.type, "Vrchat");
    }

    const search = await loadModule<typeof import("../../../logics/configs/config_page_setter/_aux/useConfigSearch.ts")>(new URL("../../../logics/configs/config_page_setter/_aux/useConfigSearch.ts", import.meta.url), runtime, {
        "@store": {}, "@logics_configs": {}, "@ui_configs": {}, "@root/locales/config.js": {},
        "../../../transcription/useRealtimeASR": {}, "../../../common/languageNames.ts": {}, "../../../voice/settingsNavigation": {},
        "./configSearchTargets.ts": searchTargets, "../../revealSetting.ts": revealSettingModule,
    });
    assert.deepEqual(search.settingTabs("ocr", "source_language"), ["ocr"]);
    assert.deepEqual(search.settingTabs("others", "send_message_to_vrc"), ["vrchat"]);
    // The Device page leads to it on the VRChat page (#554, IA-03).
    assert.deepEqual(search.settingTabs("others", "vrc_mic_mute_sync"), ["vrchat"]);
    assert.deepEqual(search.settingTabs("translation", "deepl_auth_key"), ["translation"]);
});

test("the side menu groups its pages in the order a conversation uses them, each page with an icon and a name in both languages", async () => {
    const runtime = hooks();
    const svg = (name: string) => (name.endsWith(".svg?react") ? icon(name) : name);
    const images = ["mic", "tts_speaker", "voice_conversion", "mui_palette", "translation", "mui_graphic_eq", "mui_head_mounted_device",
        "mui_keyboard_alt", "mui_code_blocks", "refresh", "chat_transcribe", "mui_document_scanner"];
    const sidebar = await loadModule<typeof import("./sidebar_section/SidebarSection.tsx")>(new URL("./sidebar_section/SidebarSection.tsx", import.meta.url), runtime, {
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: "device" }, updateSelectedConfigTabId() {} }),
            useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }) },
        ...Object.fromEntries(images.map(name => [`@images/${name}.svg?react`, svg(`${name}.svg?react`)])),
        "@images/brand/icon-small.svg": "brand", "../version_label/VersionLabel.tsx": { VersionLabel: "version" },
        "../../../../logics/common/featureLabel.ts": featureLabel, "../../../../logics/configs/settingsMenu.ts": settingsMenu,
        "../../../../logics/configs/usagePresets.ts": usagePresets, "./usage_presets/UsagePresetSelector.tsx": { UsagePresetSelector: "presets" },
        "@logics_configs": { useUsagePresets: () => ({ currentUsagePresets: { data: ["all"] } }) },
    });
    const tree = runtime.render(sidebar.SidebarSection);
    const groups = all(tree, node => node.props?.group?.tabs).map(node => node.props.group);
    // #554 (Q-02, Q-03): four groups with headings; the devices are with the settings set once.
    assert.deepEqual(groups.map(group => [group.id, group.tabs]), [
        ["conversation", ["translation", "transcription", "vrchat", "vr"]],
        ["voice_and_reading", ["tts", "rvc", "ocr"]],
        ["comfort", ["device", "appearance", "hotkeys"]],
        ["app", ["updater", "advanced_settings", "experimental_features", "about_vrct"]],
    ]);
    const tabs = menuTabs(runtime, tree).map(node => node.props.tab_id);
    assert.deepEqual(tabs, groups.flatMap(group => group.tabs));
    assert.equal(settingsMenu.FIRST_SETTINGS_TAB, "translation");
    assert.match(readFileSync(new URL("../../../logics/store.ts", import.meta.url), "utf8"),
        /createAtomWithHook\("translation", "SelectedConfigTabId"\)/, "settings open on the first page of the menu");
    const shown = (id: string) => sidebar.TabIcon({ tab_id: id, className: "" });
    assert.ok(shown("ocr"));
    const ocrIcon = shown("ocr"), vrchatIcon = shown("vrchat");
    assert.ok(ocrIcon && vrchatIcon);
    assert.notEqual(ocrIcon.type, vrchatIcon.type);
    for (const language of ["en", "ja"]) {
        const strings = locale(language);
        assert.equal(typeof strings.config_page.side_menu_labels.ocr, "string");
        // The menu and the settings search both name a page by this key; a missing one showed the raw key.
        for (const id of tabs) assert.equal(typeof strings.config_page.side_menu_labels[id], "string", `${language}: ${id}`);
        for (const group of groups) assert.equal(typeof strings.config_page.side_menu_groups[group.id], "string", `${language}: ${group.id}`);
        for (const key of ["provider_in_use", "provider_ready", "provider_not_set"]) assert.equal(typeof strings.config_page.translation[key], "string");
    }
});

test("a feature's settings menu tab shows its name on one line and keeps the whole name in its tooltip and for screen readers", async () => {
    const runtime = hooks();
    const names: Record<string, string> = { "config_page.side_menu_labels.transcription": "Speech recognition (ASR)" };
    const svg = (name: string) => icon(name);
    const images = ["mic", "tts_speaker", "voice_conversion", "mui_palette", "translation", "mui_graphic_eq", "mui_head_mounted_device",
        "mui_keyboard_alt", "mui_code_blocks", "refresh", "chat_transcribe", "mui_document_scanner"];
    const sidebar = await loadModule<typeof import("./sidebar_section/SidebarSection.tsx")>(new URL("./sidebar_section/SidebarSection.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => names[key] ?? key }) },
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: "device" }, updateSelectedConfigTabId() {} }),
            useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }) },
        ...Object.fromEntries(images.map(name => [`@images/${name}.svg?react`, svg(`${name}.svg?react`)])),
        "@images/brand/icon-small.svg": "brand", "../version_label/VersionLabel.tsx": { VersionLabel: "version" },
        "../../../../logics/common/featureLabel.ts": featureLabel, "../../../../logics/configs/settingsMenu.ts": settingsMenu,
        "../../../../logics/configs/usagePresets.ts": usagePresets, "./usage_presets/UsagePresetSelector.tsx": { UsagePresetSelector: "presets" },
        "@logics_configs": { useUsagePresets: () => ({ currentUsagePresets: { data: ["all"] } }) },
    });
    const [tab] = menuTabs(runtime, runtime.render(sidebar.SidebarSection)).filter(node => node.props.tab_id === "transcription");
    const tree = runtime.render(component(tab), tab.props);
    const button = find(tree, node => node.type === "button");
    assert.ok(button);
    assert.equal(button.props["aria-label"], "Speech recognition (ASR)");
    assert.equal(button.props.title, "Speech recognition (ASR)");
    assert.ok(find(tree, node => node.type === "p" && node.props?.children === "Speech recognition"));
    assert.equal(find(tree, node => node.type === "span"), null, "the short name has no second line");
    // A tab without a short name needs no tooltip: its text is its whole name.
    const [device] = menuTabs(runtime, runtime.render(sidebar.SidebarSection)).filter(node => node.props.tab_id === "device");
    const deviceButton = find(runtime.render(component(device), device.props), node => node.type === "button");
    assert.ok(deviceButton);
    assert.equal(deviceButton.props.title, undefined);
});

test("speech recognition opens on the engine choice and its two systems; the rest is in 「詳細設定」, the timing numbers folded under a line that shows them", async () => {
    const source = readFileSync(new URL("./setting_section/setting_box/transcription/Transcription.tsx", import.meta.url), "utf8");
    const page = source.split("export const Transcription = () => {")[1].split("\n};")[0];
    const order = [...page.matchAll(/<([A-Z][A-Za-z_]+)/g)].map(match => match[1]);
    // The engine, then its two systems as the translation catalog splits them (#414): speech.cpp
    // on your PC with its models and server, then the APIs with their keys. The word filter, the
    // timing and the realtime captions' server are set once (#554). The old Whisper models'
    // screen went in 0.6.0 (#288). The page keeps its descriptions out of sight, as hints (#614).
    assert.deepEqual(order, ["HintDescriptions", "TranscriptionEngine_Container", "EngineGroup", "SpeechServers", "EngineGroup", "CloudTranscription_Container",
        "AdvancedSection", "Mic_Container", "Speaker_Container", "RealtimeASRSettings"]);
    assert.match(page, /<EngineGroup group="speechcpp">\s*<SpeechServers profiles=\{\["asr"\]\} \/>\s*<\/EngineGroup>\s*<EngineGroup group="api">\s*<CloudTranscription_Container \/>\s*<\/EngineGroup>/);
    assert.match(page, /<AdvancedSection [^>]*>\s*<Mic_Container \/>\s*<Speaker_Container \/>\s*<RealtimeASRSettings \/>\s*<\/AdvancedSection>/);
    const section = (name: string) => source.split(`const ${name} = () => {`)[1].split("\n};")[0];
    // The word filter is a list people edit; it stays in sight. The three numbers are folded.
    assert.match(section("Mic_Container"), /<MicWordFilter_Box \/>\s*<TimingFold record=\{currentMicRecordTimeout\.data\} phrase=\{currentMicPhraseTimeout\.data\} queue=\{currentMicMaxWords\.data\}>\s*<MicRecordTimeout_Box \/>\s*<MicPhraseTimeout_Box \/>\s*<MicMaxWords_Box \/>\s*<\/TimingFold>/);
    assert.match(section("Speaker_Container"), /<TimingFold record=\{currentSpeakerRecordTimeout\.data\} phrase=\{currentSpeakerPhraseTimeout\.data\} queue=\{currentSpeakerMaxWords\.data\}>\s*<SpeakerRecordTimeout_Box \/>\s*<SpeakerPhraseTimeout_Box \/>\s*<SpeakerMaxWords_Box \/>\s*<\/TimingFold>/);
    // Whisper's thresholds and model choice went with the engine (#288): the engine choice stands alone.
    assert.doesNotMatch(section("TranscriptionEngine_Container"), /thresholds_title|AvgLogprob|NoSpeechProb|WhisperWeightType|ComputeDevice/);

    const runtime = hooks();
    const SetupSection = () => null;
    const dependencies = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(match => [match[1], {}]));
    const t = (key: string, options?: Record<string, unknown>) => options ? `${key}:${Object.values(options).join(",")}` : key;
    const transcription = await loadModule<typeof import("./setting_section/setting_box/transcription/Transcription.tsx")>(new URL("./setting_section/setting_box/transcription/Transcription.tsx", import.meta.url), runtime, {
        ...dependencies, react: runtime.api, "@useI18n": { useI18n: () => ({ t }) },
        "@logics_configs": { useTranscription: () => ({ currentMicRecordTimeout: { data: 3 }, currentMicPhraseTimeout: { data: 5 }, currentMicMaxWords: { data: 10 },
            currentSpeakerPhraseTimeout: { data: 4 }, currentSelectableTranscriptionEngines: { data: [] } }) },
        "../../../../../../logics/configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: [] },
        "../_components/setup_section/SetupSection": { SetupSection },
    });
    const drawnPage = runtime.render(transcription.Transcription);
    // The line of 「詳細設定」 shows the pauses that end a message; the APIs are no longer in it.
    const line = find(drawnPage, node => node.props?.status?.startsWith?.("config_page.advanced_status"));
    assert.ok(line);
    assert.equal(line.props.status, "config_page.advanced_status.transcription:5,4");
    const mic = find(drawnPage, node => named(node, "Mic_Container"));
    assert.ok(mic);
    const fold = find(component(mic)(mic.props), node => named(node, "TimingFold"));
    assert.ok(fold);
    const drawn = component(fold)(fold.props);
    assert.ok(drawn);
    assert.equal(drawn.type, SetupSection);
    assert.equal(drawn.props.title, "config_page.transcription.timing_title");
    assert.equal(drawn.props.status, "config_page.transcription.timing_status:3,5,10");
    assert.equal(drawn.props.attention, undefined, "closed until opened");
});

test("each API speech recognition provider is one fold; the selected one stays open, and the user's own server is marked as theirs", async () => {
    const runtime = hooks();
    const SetupSection = () => null;
    const source = readFileSync(new URL("./setting_section/setting_box/transcription/Transcription.tsx", import.meta.url), "utf8");
    const dependencies = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(match => [match[1], {}]));
    const engines = [{ id: "Groq_Whisper", base: "GroqWhisper", key: "groq_whisper" }, { id: "Deepgram", base: "Deepgram", key: "deepgram" },
        { id: "Custom_Whisper", base: "CustomWhisper", key: "custom_whisper", has_url: true, own: true }];
    const state = { currentSelectedTranscriptionEngine: { data: "Deepgram" }, currentSelectableTranscriptionEngines: { data: ["SpeechCpp", "Groq_Whisper", "Deepgram"] },
        currentCustomWhisperURL: { data: "" }, currentMicPhraseTimeout: { data: 5 }, currentSpeakerPhraseTimeout: { data: 4 },
        getSelectableTranscriptionEngines() {}, getSelectedTranscriptionEngine() {},
        ...Object.fromEntries(engines.map(engine => [`current${engine.base}AuthKey`, { data: null }])) };
    const transcription = await loadModule<typeof import("./setting_section/setting_box/transcription/Transcription.tsx")>(new URL("./setting_section/setting_box/transcription/Transcription.tsx", import.meta.url), runtime, {
        ...dependencies, react: runtime.api, "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@logics_configs": { useTranscription: () => state },
        "../../../../../../logics/configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: engines },
        "../_components/setup_section/SetupSection": { SetupSection },
    });
    const page = runtime.render(transcription.Transcription);
    // The folds are in the API group (#414), no longer inside 「詳細設定」.
    const group = find(page, node => node.props?.group === "api");
    assert.ok(group);
    const cloud = find(group, node => named(node, "CloudTranscription_Container"));
    assert.ok(cloud);
    // A value's children, read as node?.props?.children reads them.
    const childrenOf = (node: unknown): unknown => typeof node === "object" && node !== null ? Reflect.get(node, "props")?.children : undefined;
    const text = (node: unknown): string => typeof node === "string" ? node : [childrenOf(node)].flat().map(text).join("");
    const folds = all(runtime.render(component(cloud), cloud.props), node => node.type === SetupSection)
        .map(node => [text(node.props.title), node.props.status.split(".").at(-1), node.props.attention]);
    assert.deepEqual(folds, [
        ["config_page.transcription.select_transcription_engine.engines.groq_whisper", "provider_ready", false],
        ["config_page.transcription.select_transcription_engine.engines.deepgram", "provider_in_use", true],
        ["config_page.transcription.select_transcription_engine.engines.custom_whisper config_page.transcription.select_transcription_engine.badge_own", "provider_not_set", false],
    ]);
    // The mark is the catalogs' badge for what the user added (dashed edge).
    const lastFold = all(runtime.render(component(cloud), cloud.props), node => node.type === SetupSection).at(-1);
    assert.ok(lastFold);
    const badge = find(lastFold.props.title, node => node.props?.["data-tone"]);
    assert.ok(badge);
    assert.equal(badge.props["data-tone"], "own");
    const groupDrawn = component(group)(group.props);
    assert.ok(groupDrawn);
    assert.equal(groupDrawn.props["data-engine-group"], "api");
    assert.equal(find(groupDrawn, node => node.props?.["data-setting-id"])?.props["data-setting-id"], "cloud_section", "the settings search still leads here");
});

test("the VRChat page no longer carries chat reading; it ends with the way to that page", async () => {
    const runtime = hooks(), opened: string[] = [];
    const source = readFileSync(new URL("./setting_section/setting_box/vrchat/Vrchat.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /ocr\/Ocr/);
    const dependencies = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(match => [match[1], {}]));
    const ja = locale("ja");
    const t = (key: string, values: Record<string, string>) => key.split(".").reduce<Texts>((node, part) => node?.[part], ja).replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name]);
    const store = { "@store": { useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (id: string) => opened.push(id) }) } };
    const pagePointer = await loadModule<typeof import("./setting_section/setting_box/_components/page_pointer/PagePointer.tsx")>(new URL("./setting_section/setting_box/_components/page_pointer/PagePointer.tsx", import.meta.url), runtime, {
        ...store, "@useI18n": { useI18n: () => ({ t }) }, "../form_row/FormRow": { FormRow: () => null },
        "../../../../../../../logics/configs/revealSetting.ts": { revealSetting() {} },
        "../../../../sidebar_section/SidebarSection.tsx": { TabIcon: () => null },
    });
    const vrchat = await loadModule<typeof import("./setting_section/setting_box/vrchat/Vrchat.tsx")>(new URL("./setting_section/setting_box/vrchat/Vrchat.tsx", import.meta.url), runtime, {
        ...dependencies, ...store, react: runtime.api, "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@logics_configs": { useOthers: () => ({ currentEnableNotificationVrcSfx: { data: true }, currentEnableVrcMicMuteSync: { data: false } }) },
        "../_components/page_pointer/PagePointer": pagePointer,
        "../_components/hint/Hint": { HintDescriptions: "hints" },
    });
    // The page keeps its rows' descriptions out of sight, as hints (#614).
    const wrapped = runtime.render(vrchat.Vrchat);
    assert.equal(wrapped.type, "hints");
    const page = wrapped.props.children;
    const last = page.props.children.at(-1);
    const pointer = last.type(last.props);
    // The heading and the button that names the page; no sentence repeats where the settings are.
    assert.equal(pointer.props.children.length, 2);
    const link = pointer.props.children[1];
    assert.equal(link.type, pagePointer.PageLinkButton);
    const button = find(runtime.render(link.type, link.props), node => node.type === "button");
    assert.ok(button);
    const words = find(button, node => node.type === "span" && typeof node.props.children === "string");
    assert.ok(words);
    assert.equal(words.props.children, "「チャット読み取り（OCR）」を開く");
    button.props.onClick();
    assert.deepEqual(opened, ["ocr"]);
    for (const language of ["en", "ja"]) {
        const strings = locale(language).config_page;
        assert.equal(typeof strings.page_link.open, "string");
        for (const key of ["timing_title", "timing_status"]) assert.equal(typeof strings.transcription[key], "string");
    }
});

test("each translation provider is one fold that says whether it can be used; the one in use stays open", async () => {
    const runtime = hooks();
    const engines = [{ id: "DeepL_API", label: "DeepL API", is_available: true }, { id: "Gemini_API", label: "Gemini API", is_available: false },
        { id: "Ollama", label: "Ollama", is_available: true }];
    let selected = { 1: "CTranslate2", 2: "Ollama", 3: "CTranslate2" };
    const SetupSection = () => null;
    const source = readFileSync(new URL("./setting_section/setting_box/translation/Translation.tsx", import.meta.url), "utf8");
    const dependencies = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(match => [match[1], {}]));
    const translation = await loadModule<typeof import("./setting_section/setting_box/translation/Translation.tsx")>(new URL("./setting_section/setting_box/translation/Translation.tsx", import.meta.url), runtime, {
        ...dependencies, react: runtime.api,
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@store": { useStore_TranslationEngines: () => ({ currentTranslationEngines: { data: engines } }),
            useStore_SelectedTranslationEngines: () => ({ currentSelectedTranslationEngines: { data: selected } }) },
        "../_components/setup_section/SetupSection": { SetupSection },
        // The translation catalog (#413) has cards, not provider folds.
        "./TranslationCatalog": { TranslationCatalogSection: () => null },
    });
    // Translation's own sections are not exported; draw them through the page.
    const page = runtime.render(translation.Translation);
    const folds: [string, unknown, unknown, unknown][] = [];
    // The APIs and local LLMs are in 「詳細設定」 (#554), which opens by itself while a preset uses one.
    const [, advanced] = page.props.children;
    assert.equal(advanced.props.attention, true);
    assert.equal(advanced.props.status, "config_page.advanced_status.translation");
    for (const section of [advanced.props.children].flat()) {
        const drawn = section.type(section.props);
        if (!drawn) continue;
        for (const provider of all(drawn, node => typeof node.props?.id === "string" && typeof node.type === "function")) {
            const fold = component(provider)(provider.props);
            assert.ok(fold);
            assert.equal(fold.type, SetupSection);
            folds.push([provider.props.id, fold.props.title, fold.props.status, fold.props.attention]);
        }
    }
    assert.deepEqual(folds.map(fold => fold[0]), ["DeepL_API", "Google_Cloud_API", "Papago_API", "Plamo_API", "Gemini_API", "OpenAI_API",
        "Groq_API", "OpenRouter_API", "LMStudio", "Ollama", "OpenAI_Compatible"]);
    const by = Object.fromEntries(folds.map(([id, ...rest]) => [id, rest]));
    assert.deepEqual(by.DeepL_API, ["DeepL API", "config_page.translation.provider_ready", false]);
    assert.deepEqual(by.Gemini_API, ["Gemini API", "config_page.translation.provider_not_set", false]);
    assert.deepEqual(by.Ollama, ["Ollama", "config_page.translation.provider_in_use", true]);
    assert.deepEqual(by.Plamo_API, ["Plamo_API", "config_page.translation.provider_not_set", false], "an engine the list does not know keeps its id");
});
