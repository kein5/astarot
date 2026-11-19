import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

// The app's buttons are still drawn rule by rule in each screen's styles, not by one component.
// These tests hold what the shadcn/ui alignment (docs/design/components/shadcn-alignment.md)
// made the same for all of them, so a new copy of a button rule does not bring the old values back.
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const views = "../";
const box = views + "app/config_page/setting_section/setting_box/";

// The declarations a rule writes itself, before any nested rule: the text from the selector to
// the first brace after its opening one. Each anchor is looked for after the one before it.
const ownDeclarations = (path, ...anchors) => {
    const source = read(path);
    let at = 0;
    for (const anchor of anchors) {
        const found = source.indexOf(anchor, at);
        assert.ok(found >= 0, `${path}: ${anchor}`);
        at = found;
    }
    const open = source.indexOf("{", at);
    const close = source.slice(open + 1).search(/[{}]/);
    return source.slice(open + 1, open + 1 + close);
};

// shadcn/ui's Button sets its words in font-medium. The settings forms' buttons and their copies
// were 600; the other buttons with words and a fill or an outline were the regular 400.
const mediumButtons = [
    [box + "advanced_settings/VoiceSettings.module.scss", "button { width: fit-content"],
    [box + "_components/connection_check_button/ConnectionCheckButton.module.scss", ".button {"],
    [box + "hotkeys/Hotkeys.module.scss", ".open_quick_chat {"],
    [box + "translation/Translation.module.scss", ".license_actions {", "button {"],
    [box + "updater/Updater.module.scss", ".install_button {"],
    [box + "vr/Vr.module.scss", ".sample_text_button {"],
    [box + "vr/Vr.module.scss", ".restore_default_settings_button {"],
    [views + "app/config_page/topbar/Topbar.module.scss", ".leave_actions button {"],
    [views + "app/others/error_boundary/AppErrorBoundary.module.scss", ".update_button {"],
    [views + "app/others/modal_controller/ModalController.module.scss", ".close_button {"],
    [views + "app/config_page/topbar/Topbar.module.scss", ".discard, .save {"],
    [views + "app/config_page/topbar/Topbar.module.scss", ".back {"],
    [views + "app/config_page/topbar/Topbar.module.scss", ".stop {"],
    [views + "app/main_page/main_section/top_bar/TopBar.module.scss", ".stop {"],
    [box + "_components/page_pointer/PagePointer.module.scss", "button.open_page[data-page-pointer] {"],
    [box + "_components/_atoms/_download_button/_DownloadButton.module.scss", ".download_button {"],
    [box + "_components/word_filter/WordFilter.module.scss", ".add_button {"],
    [box + "ocr/Ocr.module.scss", ".resetButton {"],
    [box + "updater/Updater.module.scss", ".check_button {"],
    [box + "updater/Updater.module.scss", ".refresh_button {"],
    [views + "app/others/startup/StartupFailedDialog.module.scss", ".actions {", "button {"],
    [views + "app/others/error_boundary/AppErrorBoundary.module.scss", ".copy_error_message_button {"],
    [views + "app/others/error_boundary/AppErrorBoundary.module.scss", ".status_link_button {"],
    [views + "quick_chat/QuickChat.module.scss", "button { font: inherit;"],
    [views + "app/main_page/main_section/message_container/log_box/LogBox.module.scss", ".setup button {"],
    [views + "app/main_page/main_section/io_flow_panel/IoFlowPanel.module.scss", ".close {"],
    [views + "app/main_page/main_section/realtime_controls/RealtimeControls.module.scss", "button {"],
    [views + "app/main_page/main_section/language_selector/language_selector_top_bar/LanguageSelectorTopBar.module.scss", ".go_back_button_wrapper {"],
];

test("buttons set their words in medium weight, as shadcn/ui's Button does", () => {
    for (const [path, ...anchors] of mediumButtons) {
        assert.match(ownDeclarations(path, ...anchors), /font-weight: 500;/, `${path}: ${anchors.at(-1)}`);
    }
    // The rules written in vanilla-extract: the notice's action, and Save and Cancel when naming a speaker.
    assert.match(read("../../logics/common/noticeAction.css.ts"), /export const action = style\(\{[^}]*fontWeight: 500,/);
    assert.match(read("../app/main_page/main_section/message_container/log_box/message_container/SpeakerNames.css.ts"), /const button = \{[^}]*fontWeight: 500,/);
});
