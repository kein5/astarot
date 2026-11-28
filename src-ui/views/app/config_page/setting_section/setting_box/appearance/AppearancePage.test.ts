import assert from "node:assert/strict";
import { test } from "vitest";
import { componentName, componentOf, findIn, hooks, loadModule, nodesIn, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as languageNames from "../../../../../../logics/common/languageNames.ts";
import * as logFontSize from "../../../../../../logics/main/logFontSize.ts";
import { ui_configs } from "../../../../../../logics/ui_configs.ts";
import { settingTarget } from "../../../../../../logics/configs/config_page_setter/_aux/configSearchTargets.ts";

// The appearance settings page (Appearance.tsx) drawn with the real list of UI languages and their
// names. The appearance settings hook is a stand-in that holds the values the test gives and records
// every action; the shared rows are stand-ins that keep their props.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
type Setting = { state: string; data: unknown };
const ok = (data: unknown): Setting => ({ state: "ok", data });

async function appearancePage(values: Record<string, unknown> = {}, options: { language?: string; fonts?: Record<string, string> } = {}) {
    const calls: unknown[][] = [];
    const settings = new Proxy({}, { get: (_, key) => {
        const name = String(key);
        if (name in values) return values[name];
        if (name.startsWith("current")) return { state: `state-${name}`, data: `${name} value` };
        return (...args: unknown[]) => { calls.push([name, ...args]); };
    } });
    const breakPoint = () => { calls.push(["asyncUpdateBreakPoint"]); };
    const module = await loadModule<typeof import("./Appearance.tsx")>(new URL("./Appearance.tsx", import.meta.url), hooks(), {
        "@useI18n": { useI18n: () => ({ t, i18n: { language: options.language ?? "en" } }) },
        "../../../../../../logics/common/languageNames.ts": languageNames,
        "../../../../../../logics/main/logFontSize.ts": logFontSize,
        "@ui_configs": { ui_configs },
        "@store": { useStore_SelectableFontFamilyList: () => ({ currentSelectableFontFamilyList: ok(options.fonts ?? { "Yu Gothic UI": "Yu Gothic UI", Meiryo: "Meiryo" }) }) },
        "@logics_common": { useWindow: () => ({ asyncUpdateBreakPoint: breakPoint }) },
        "@logics_configs": { useAppearance: () => settings },
        "./ThemePicker": { ThemeContainer: "theme" },
        "../_templates/Templates": { SliderContainer: "slider", DropdownMenuContainer: "dropdown", RadioButtonContainer: "radio", SwitchContainer: "switch" },
        "../_components": { SectionLabelComponent: "section-label" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
        "../shared_items/SharedItems": { AutoClearMessageInputBoxContainer: "auto-clear", ConvertMessageToHiraganaContainer: "hiragana", ConvertMessageToRomajiContainer: "romaji" },
    });
    const page = () => module.Appearance();
    // A row of the page, drawn: its own component called with its props (none keeps state).
    const row = (name: string): TreeNode => {
        const node = findIn(page(), item => componentName(item) === name, name);
        const drawn = treeNode(componentOf(node)(node.props));
        assert.ok(drawn);
        return drawn;
    };
    return { module, calls, values, page, row, breakPoint };
}

test("the page puts the language, the size and the theme first, and the rest in the advanced fold whose line shows two of them", async () => {
    const p = await appearancePage({ currentMessageLogUiScaling: ok(120), currentTransparency: ok(null) });
    const tree = p.page();
    assert.equal(tree.type, "hints");
    const [first, fold] = [tree.props.children.props.children].flat();
    assert.deepEqual(nodesIn(first).map(node => componentName(node) ?? node.type).filter(name => name !== "div"),
        ["section-label", "UiLanguageContainer", "UiScalingContainer", "theme"]);
    assert.equal(findIn(first, node => node.type === "section-label").props.label, "config_page.appearance.section_label_display");
    assert.equal(fold.props.status, `config_page.advanced_status.appearance {"log":120,"transparency":"-"}`);
    const groups = [fold.props.children].flat().map(group => nodesIn(group).filter(node => node.type !== "div")
        .map(node => node.type === "section-label" ? [node.props.label, node.props.sub] : componentName(node) ?? node.type));
    assert.deepEqual(groups, [
        [["config_page.appearance.section_label_display_more", true], "MessageLogUiScalingContainer", "FontFamilyContainer", "TransparencyContainer"],
        [["config_page.appearance.section_label_send_buttons", true], "SendMessageButtonTypeContainer", "ShowResendButtonContainer", "auto-clear"],
        [["config_page.others.section_label_reading_aids", true], "hiragana", "romaji"]]);
    const unknown = await appearancePage({ currentMessageLogUiScaling: ok(undefined), currentTransparency: ok(80) });
    assert.equal(findIn(unknown.page(), node => node.type === "advanced").props.status, `config_page.advanced_status.appearance {"log":"-","transparency":80}`);
});

test("the UI language is chosen from the languages the app has, labelled in English too when the UI is in another language", async () => {
    const english = await appearancePage({ currentUiLanguage: ok("en") });
    let radio = english.row("UiLanguageContainer").props;
    assert.deepEqual([radio.setting_id, radio.name, radio.label, radio.desc, radio.keep_desc], ["ui_language", "ui_language", "config_page.appearance.ui_language.label", false, true]);
    assert.equal(radio.setting_id, settingTarget("appearance", "ui_language"));
    assert.deepEqual(radio.options, languageNames.createLanguageNames("en").uiOptions(ui_configs.selectable_ui_languages));
    assert.ok(radio.options.length > 1);
    assert.equal(radio.checked_variable, english.values.currentUiLanguage);
    radio.selectFunction("ja");
    assert.deepEqual(english.calls, [["setUiLanguage", "ja"]]);
    const japanese = await appearancePage({ currentUiLanguage: ok("ja") }, { language: "ja" });
    radio = japanese.row("UiLanguageContainer").props;
    assert.deepEqual([radio.label, radio.desc], ["UI Language", "config_page.appearance.ui_language.label"]);
    assert.deepEqual(radio.options, languageNames.createLanguageNames("ja").uiOptions(ui_configs.selectable_ui_languages), "the names in the UI's language");
    const unknown = await appearancePage({ currentUiLanguage: ok(undefined) });
    assert.deepEqual([unknown.row("UiLanguageContainer").props.label, unknown.row("UiLanguageContainer").props.desc], ["config_page.appearance.ui_language.label", false]);
});

test("the sizes of the window and of the message log go from 40 to 200 percent in steps of ten, and the window's redraws its layout", async () => {
    const p = await appearancePage({ currentUiScaling: { state: "pending", data: 110 }, currentMessageLogUiScaling: ok(90) });
    const labels = [40, 60, 80, 100, 120, 140, 160, 180, 200];
    const size = p.row("UiScalingContainer").props;
    assert.deepEqual([size.setting_id, size.label, size.valueLabelFormat, size.state, size.variable, size.min, size.max, size.step, size.show_label_values],
        ["ui_size", "config_page.appearance.ui_size.label", "value %", "pending", 110, 40, 200, 10, labels]);
    size.setterFunction(120);
    size.postUpdateAction();
    const log = p.row("MessageLogUiScalingContainer").props;
    assert.deepEqual([log.setting_id, log.label, log.valueLabelFormat, log.state, log.variable, log.min, log.max, log.step, log.show_label_values, log.postUpdateAction],
        ["textbox_ui_size", "config_page.appearance.textbox_ui_size.label", "value %", "ok", 90, 40, 200, 10, labels, undefined]);
    log.setterFunction(130);
    assert.deepEqual(p.calls, [["setUiScaling", 120], ["asyncUpdateBreakPoint"], ["setMessageLogUiScaling", 130]]);
    for (const [row, key] of [[size, "ui_size"], [log, "textbox_ui_size"]] as const) assert.equal(row.setting_id, settingTarget("appearance", key));
});

test("the window's transparency goes from 40 to 100 percent, with marks every ten", async () => {
    const p = await appearancePage({ currentTransparency: ok(85) });
    const row = p.row("TransparencyContainer").props;
    assert.deepEqual([row.setting_id, row.label, row.desc, row.valueLabelFormat, row.state, row.variable, row.min, row.max, row.step, row.marks_step, row.show_label_values],
        ["transparency", "config_page.appearance.transparency.label", "config_page.appearance.transparency.desc", "value %", "ok", 85, 40, 100, 1, 10, [40, 50, 60, 70, 80, 90, 100]]);
    row.setterFunction(70);
    assert.deepEqual(p.calls, [["setTransparency", 70]]);
});

test("the send button is hidden, shown, or shown with Enter not sending, and the resend button is a switch", async () => {
    const p = await appearancePage();
    const radio = p.row("SendMessageButtonTypeContainer").props;
    assert.deepEqual([radio.setting_id, radio.name, radio.label, radio.column, radio.options], ["send_message_button_type", "send_message_button_type",
        "config_page.appearance.send_message_button_type.label", true, ["hide", "show", "show_and_disable_enter_key"]
            .map(id => ({ id, label: `config_page.appearance.send_message_button_type.${id}` }))]);
    assert.deepEqual(radio.checked_variable, { state: "state-currentSendMessageButtonType", data: "currentSendMessageButtonType value" });
    radio.selectFunction("show");
    const resend = p.row("ShowResendButtonContainer").props;
    assert.deepEqual([resend.setting_id, resend.label, resend.desc], ["show_resend_button", "config_page.appearance.show_resend_button.label", "config_page.appearance.show_resend_button.desc"]);
    assert.deepEqual(resend.variable, { state: "state-currentShowResendButton", data: "currentShowResendButton value" });
    resend.toggleFunction();
    assert.deepEqual(p.calls, [["setSendMessageButtonType", "show"], ["toggleShowResendButton"]]);
    for (const row of [radio, resend]) assert.equal(row.setting_id, settingTarget("appearance", row.setting_id));
});

test("the font is chosen from the system's fonts, and a saved font missing from this system is listed with a note", async () => {
    const fonts = { "Yu Gothic UI": "Yu Gothic UI", Meiryo: "Meiryo" };
    const list = async (selected: unknown, given: Record<string, string> = fonts) => {
        const p = await appearancePage({ currentSelectedFontFamily: { state: "ok", data: selected } }, { fonts: given });
        return p.row("FontFamilyContainer").props;
    };
    const row = await list("Meiryo");
    assert.deepEqual([row.setting_id, row.dropdown_id, row.label, row.selected_id, row.state, row.list], ["font_family", "font_family", "config_page.appearance.font_family.label",
        "Meiryo", "ok", fonts]);
    assert.equal(row.setting_id, settingTarget("appearance", "font_family"));
    assert.deepEqual(Object.entries((await list("Noto Sans")).list), [["Noto Sans", `config_page.appearance.font_family.not_installed {"name":"Noto Sans"}`], ...Object.entries(fonts)],
        "first, with a note");
    assert.deepEqual((await list("Noto Sans", {})).list, {}, "before the system's fonts arrive, nothing is said missing");
    assert.deepEqual((await list(null)).list, fonts);
    const p = await appearancePage();
    p.row("FontFamilyContainer").props.selectFunction({ selected_id: "Meiryo" });
    assert.deepEqual(p.calls, [["setSelectedFontFamily", "Meiryo"]]);
});
