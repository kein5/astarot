import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

// Most of the app's buttons are still drawn rule by rule in each screen's styles, not by one
// component. These tests hold what the shadcn/ui alignment (docs/design/components/shadcn-alignment.md)
// made the same for all of them, so a new copy of a button rule does not bring the old values back.
// A button replaced by the kit's Button leaves these lists: kit.test.ts holds the kit's own rules
// (docs/design/components/hand-built-inventory.md records which ones were replaced).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const views = "../";
const box = views + "app/config_page/setting_section/setting_box/";

// The declarations a rule writes itself, before any nested rule: the text from the selector to
// the first brace after its opening one. Each anchor is looked for after the one before it. In a
// .css.ts the anchor is the style's start (`export const x = style({`, `globalStyle(...`, or a
// selector key such as `"&:disabled": {`), and the text runs the same way to the next brace.
// A template literal's placeholders (`${vars.x}`, `${setup} button`) are not braces of a rule:
// they are read as `$(...)`, in the source and in the anchors alike.
const placeholders = (text: string) => text.replace(/\$\{([^{}]*)\}/g, "$($1)");
const ownDeclarations = (path: string, ...given: string[]) => {
    const source = placeholders(read(path));
    const anchors = given.map(placeholders);
    let at = 0;
    for (const anchor of anchors) {
        const found = source.indexOf(anchor, at);
        assert.ok(found >= 0, `${path}: ${anchor}`);
        at = found;
    }
    // The rule opens at the anchor's last brace, or at the first brace after the anchor.
    const last = anchors.at(-1) ?? "";
    const open = last.includes("{") ? at + last.lastIndexOf("{") : source.indexOf("{", at);
    const close = source.slice(open + 1).search(/[{}]/);
    return source.slice(open + 1, open + 1 + close);
};

// shadcn/ui's Button sets its words in font-medium. The settings forms' buttons and their copies
// were 600; the other buttons with words and a fill or an outline were the regular 400.
const mediumButtons = [
    [box + "advanced_settings/VoiceSettings.css.ts", 'globalStyle(inForm("button"), {'],
    [box + "_components/connection_check_button/ConnectionCheckButton.css.ts", "export const button = style({"],
    [box + "translation/Translation.css.ts", "globalStyle(`$" + "{license_actions} button`, {"],
    [views + "app/others/error_boundary/AppErrorBoundary.css.ts", "export const update_button = style({"],
    [views + "app/others/modal_controller/ModalController.css.ts", "export const close_button = style({"],
    [views + "app/config_page/topbar/Topbar.css.ts", "export const stop = style({"],
    [views + "app/main_page/main_section/top_bar/TopBar.css.ts", "export const stop = style({"],
    [box + "_components/page_pointer/PagePointer.css.ts", "globalStyle(button, {"],
    [box + "_components/_atoms/_download_button/_DownloadButton.css.ts", "export const download_button = style({"],
    [box + "updater/Updater.css.ts", "export const refresh_button = style({"],
    [views + "app/others/startup/StartupFailedDialog.css.ts", "globalStyle(`$" + "{actions} button`, {"],
    [views + "app/others/error_boundary/AppErrorBoundary.css.ts", "export const copy_error_message_button = style({"],
    [views + "app/others/error_boundary/AppErrorBoundary.css.ts", "export const status_link_button = style({"],
    [views + "quick_chat/QuickChat.css.ts", "globalStyle(`$" + "{container} button`, {"],
    [views + "app/main_page/main_section/language_selector/language_selector_top_bar/LanguageSelectorTopBar.css.ts", "export const go_back_button_wrapper = style({"],
];

test("buttons set their words in medium weight, as shadcn/ui's Button does", () => {
    for (const [path, ...anchors] of mediumButtons) {
        const medium = path.endsWith(".css.ts") ? /fontWeight: 500,/ : /font-weight: 500;/;
        assert.match(ownDeclarations(path, ...anchors), medium, `${path}: ${anchors.at(-1)}`);
    }
    // The rules written in vanilla-extract: the notice's action, and Save and Cancel when naming a speaker.
    assert.match(read("../../logics/common/noticeAction.css.ts"), /export const action = style\(\{[^}]*fontWeight: 500,/);
    assert.match(read("../app/main_page/main_section/message_container/log_box/message_container/SpeakerNames.css.ts"), /const button = \{[^}]*fontWeight: 500,/);
});

// shadcn/ui dims a control that cannot be used to half (disabled:opacity-50), as the kit does
// (shared.css.ts). These were .6, and .45 for the settings top bar's discard and save. The
// forms' rule is shared by their fields, selects, checkboxes and buttons.
const halfDisabled = [
    [box + "advanced_settings/VoiceSettings.css.ts", 'globalStyle(inForm(":disabled"), {'],
    [box + "_components/connection_check_button/ConnectionCheckButton.css.ts", "export const button = style({", '"&:disabled": {'],
    [box + "updater/Updater.css.ts", "export const refresh_button = style({", '"&:disabled": {'],
    [box + "translation/Translation.css.ts", "globalStyle(`$" + "{license_actions} button:disabled`, {"],
    [views + "app/config_page/topbar/Topbar.css.ts", "export const stop = style({", '"&:disabled": {'],
    [views + "app/main_page/main_section/top_bar/TopBar.css.ts", "export const stop = style({", '"&:disabled": {'],
    [views + "app/others/error_boundary/AppErrorBoundary.css.ts", "export const update_button = style({", '"&:disabled": {'],
    [views + "quick_chat/QuickChat.css.ts", "globalStyle(`$" + "{container} button:disabled`, {"],
];

test("a button or form control that cannot be used is half as strong, as in shadcn/ui", () => {
    for (const [path, ...anchors] of halfDisabled) {
        const half = path.endsWith(".css.ts") ? /opacity: 0?\.5,/ : /opacity: 0?\.5;/;
        assert.match(ownDeclarations(path, ...anchors), half, `${path}: ${anchors.join(" ")}`);
    }
});
