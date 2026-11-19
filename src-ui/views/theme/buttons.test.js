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

// shadcn/ui's Button sets its words in font-medium. These were 600.
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
];

test("buttons set their words in medium weight, as shadcn/ui's Button does", () => {
    for (const [path, ...anchors] of mediumButtons) {
        assert.match(ownDeclarations(path, ...anchors), /font-weight: 500;/, `${path}: ${anchors.at(-1)}`);
    }
    // The notice's action, the first button rule written in vanilla-extract.
    assert.match(read("../../logics/common/noticeAction.css.ts"), /export const action = style\(\{[^}]*fontWeight: 500,/);
});
