import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
    USAGE_PRESETS, USAGE_PRESET_IDS, MAIN_SWITCHES, ALWAYS_SHOWN_TABS,
    pickedPresets, isSwitchShown, isTabShown, togglePreset, usagePresetLabelKey, usagePresetDescKey,
} from "./usagePresets.ts";
import { SETTINGS_MENU_TABS } from "./settingsMenu.ts";
import { localeAt, readLocale } from "../test/locales.ts";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const shown = (picked: string[], list: readonly string[], isShown: (picked: string[], id: string) => boolean) => list.filter(id => isShown(picked, id));

test("the presets are the ones the engine keeps, in the same order", () => {
    const schema = read("native/core/src/config/schema.rs");
    const match = schema.match(/pub const USAGE_PRESET_IDS: &\[&str\] = &(\[[^\]]*\]);/);
    assert.ok(match);
    const ids = JSON.parse(match[1]);
    assert.deepEqual([...USAGE_PRESET_IDS], ids);
    assert.match(schema, /\("USAGE_PRESETS", json!\(\["basic"\]\)\)/, "a new install starts with the basic preset (Q-15)");
});

test("each preset names main switches and settings pages that exist", () => {
    const view = read("src-ui/views/app/main_page/sidebar_section/main_function_switch/MainFunctionSwitch.tsx");
    const drawn = [...view.matchAll(/switch_id: "(\w+)"/g)].map(match => match[1]);
    assert.deepEqual([...MAIN_SWITCHES], drawn, "the switches in the main page's order");
    for (const preset of USAGE_PRESETS) {
        for (const id of preset.switches) assert.ok(MAIN_SWITCHES.includes(id), `${preset.id}: ${id}`);
        for (const tab of preset.tabs) assert.ok(SETTINGS_MENU_TABS.includes(tab), `${preset.id}: ${tab}`);
    }
    for (const tab of ALWAYS_SHOWN_TABS) assert.ok(SETTINGS_MENU_TABS.includes(tab), tab);
});

test("the table follows the design: what each preset shows", () => {
    // docs/design/information-architecture/README.md, 「用途の候補」.
    const expected = {
        basic: [["translation", "transcription_send", "transcription_receive"], ["translation", "transcription", "vrchat", "vr", "device"]],
        nonverbal: [["translation", "transcription_receive", "ocr", "tts"], ["translation", "transcription", "vrchat", "vr", "tts", "ocr"]],
        multilingual: [["translation", "transcription_send", "transcription_receive", "tts"], ["translation", "transcription", "vrchat", "vr", "tts"]],
        voice_changer: [["translation", "transcription_send", "rvc"], ["translation", "vrchat", "rvc", "device"]],
        all: [[...MAIN_SWITCHES], [...SETTINGS_MENU_TABS]],
    };
    for (const [id, [switches, tabs]] of Object.entries(expected)) {
        assert.deepEqual(shown([id], MAIN_SWITCHES, (picked, item) => isSwitchShown(picked, item)), switches, id);
        assert.deepEqual(shown([id], SETTINGS_MENU_TABS, (picked, item) => isTabShown(picked, item)).filter(tab => !ALWAYS_SHOWN_TABS.includes(tab)),
            tabs.filter(tab => !ALWAYS_SHOWN_TABS.includes(tab)), id);
    }
    // Design, hotkeys and the app's own pages are in every preset.
    assert.deepEqual([...ALWAYS_SHOWN_TABS], ["appearance", "hotkeys", "updater", "advanced_settings", "experimental_features", "about_vrct"]);
});

test("several presets show what any of them shows (Q-09)", () => {
    assert.deepEqual(shown(["nonverbal", "voice_changer"], MAIN_SWITCHES, (picked, item) => isSwitchShown(picked, item)),
        ["translation", "transcription_send", "transcription_receive", "ocr", "tts", "rvc"]);
    assert.deepEqual(shown(["basic", "multilingual"], MAIN_SWITCHES, (picked, item) => isSwitchShown(picked, item)),
        ["translation", "transcription_send", "transcription_receive", "tts"]);
    assert.ok(isTabShown(["basic", "voice_changer"], "rvc"));
    assert.ok(!isTabShown(["basic"], "rvc"));
});

test("nothing that runs is hidden, and nothing is hidden before the presets are known", () => {
    assert.equal(isSwitchShown(["basic"], "rvc"), false);
    assert.equal(isSwitchShown(["basic"], "rvc", true), true, "a switch that is on or changing stays in sight");
    assert.equal(isTabShown(["basic"], "tts", true), true, "the page open now stays in the menu");
    for (const unknown of [null, undefined, "basic", [], ["a_later_one"], { basic: true }]) {
        assert.equal(pickedPresets(unknown), null);
        assert.equal(isSwitchShown(pickedPresets(unknown), "rvc"), true);
        assert.equal(isTabShown(pickedPresets(unknown), "ocr"), true);
    }
    assert.deepEqual(pickedPresets(["voice_changer", "a_later_one", "basic"]), ["basic", "voice_changer"]);
    assert.deepEqual(pickedPresets(["basic", "all"]), ["all"], "a saved mix of specific and all collapses to all (#1107)");
});

test("picking and unpicking keeps the table's order, keeps all mutually exclusive with specific uses, and never leaves nothing picked", () => {
    assert.deepEqual(togglePreset(["basic"], "voice_changer"), ["basic", "voice_changer"]);
    assert.deepEqual(togglePreset(["voice_changer"], "basic"), ["basic", "voice_changer"]);
    assert.deepEqual(togglePreset(["basic", "voice_changer"], "basic"), ["voice_changer"]);
    assert.deepEqual(togglePreset(["basic"], "basic"), ["basic"], "the last one stays picked");
    // "all" and specific presets are mutually exclusive in both directions (#1107).
    assert.deepEqual(togglePreset(["all"], "basic"), ["basic"], "picking a specific use leaves show-all mode");
    assert.deepEqual(togglePreset(null, "basic"), ["basic"], "unknown counts as show-all, so picking a specific use leaves it");
    assert.deepEqual(togglePreset(["basic"], "all"), ["all"], "picking all clears a specific use");
    assert.deepEqual(togglePreset(["basic", "voice_changer"], "all"), ["all"], "picking all clears every specific use");
    assert.deepEqual(togglePreset(["all"], "all"), ["all"], "all stays picked when it is the only choice");
    assert.deepEqual(togglePreset(["basic", "all"], "basic"), ["basic"], "mixed state resolves to the chosen specific use");
});

test("every preset has a name and a description in both languages", () => {
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        const lookup = (key: string) => localeAt(strings, key);
        for (const id of USAGE_PRESET_IDS) {
            assert.equal(typeof lookup(usagePresetLabelKey(id)), "string", `${language}: ${id}`);
            assert.equal(typeof lookup(usagePresetDescKey(id)), "string", `${language}: ${id}`);
        }
    }
});
