import assert from "node:assert/strict";
import test from "node:test";
import { eventTarget, find, hooks, loadModule } from "../../logics/test/hookHarness.js";
import * as switchBlocks from "../../logics/main/switchBlocks.js";

async function launcher(context) {
    const runtime = hooks(), document = eventTarget(), window = eventTarget();
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const previousDocument = globalThis.document, previousWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;
    context.after(() => {
        runtime.unmount();
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    });
    const calls = [];
    const { VrLauncher } = await loadModule(new URL("./VrLauncher.jsx", import.meta.url), runtime, {
        "@logics_common": {
            useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: false } }),
            useVrPanelLogOutOfView: () => ({ currentVrPanelLogOutOfView: { data: false } }),
            useVrPanelLauncherIntro: () => ({ currentVrPanelLauncherIntro: { data: "idle" } }),
        },
        "@logics_main": { useMainFunction: () => ({}) },
        "@store": { useStore_SwitchBlocks: () => ({ currentSwitchBlocks: { data: {} } }) },
        "../../logics/main/switchBlocks": switchBlocks,
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: path => calls.push(path) }) },
        "@images/brand/icon-small.svg": "icon",
        "@images/brand/logo.svg": "logo",
        "./VrTooltip": { VrTooltipButton: "button" },
    });
    const tree = runtime.render(VrLauncher, { windows: { log: false, popup: null },
        toggleLog: () => calls.push("toggleLog"), openLog: () => calls.push("openLog"), togglePopup() {} });
    const logButton = find(tree, node => typeof node.props?.onLongPress === "function");
    assert.ok(logButton);
    const render = () => runtime.render(logButton.type, logButton.props);
    render();
    return { runtime, document, window, calls, render };
}

for (const signal of ["outside-release", "document-leave", "pointer-cancel", "window-blur", "button-leave", "button-blur", "unmount"]) {
    test(`launcher hold is cancelled by ${signal} before openLog/recall`, async context => {
        const view = await launcher(context);
        view.render().props.onMouseDown({ button: 0 });
        assert.match(view.render().props.className, /is_holding/);
        context.mock.timers.tick(599);
        if (signal === "outside-release") view.document.dispatch("mouseup", { button: 0, clientX: -1, clientY: -1 });
        if (signal === "document-leave") view.document.dispatch("mouseleave", {});
        if (signal === "pointer-cancel") view.document.dispatch("pointercancel", {});
        if (signal === "window-blur") view.window.dispatch("blur", {});
        if (signal === "button-leave") view.render().props.onMouseLeave();
        if (signal === "button-blur") view.render().props.onBlur();
        if (signal === "unmount") view.runtime.unmount();
        context.mock.timers.tick(1000);
        assert.deepEqual(view.calls, []);
        if (signal !== "unmount") assert.doesNotMatch(view.render().props.className, /is_holding/);
    });
}

test("launcher short click and intentional 600 ms hold retain their actions", async context => {
    const view = await launcher(context);
    view.render().props.onMouseDown({ button: 0 });
    context.mock.timers.tick(100);
    view.document.dispatch("mouseup", { button: 0 });
    view.render().props.onMouseUp();
    view.render().props.onClick();
    assert.deepEqual(view.calls, ["toggleLog"]);
    context.mock.timers.tick(1000);
    assert.deepEqual(view.calls, ["toggleLog"]);
    view.render().props.onMouseDown({ button: 0 });
    context.mock.timers.tick(599);
    assert.deepEqual(view.calls, ["toggleLog"]);
    context.mock.timers.tick(1);
    assert.deepEqual(view.calls, ["toggleLog", "openLog", "/run/vr_panel_recall_log"]);
    view.document.dispatch("mouseup", { button: 0 });
    view.render().props.onClick();
    context.mock.timers.tick(1000);
    assert.deepEqual(view.calls, ["toggleLog", "openLog", "/run/vr_panel_recall_log"]);
});

test("a cancelled hold can start again on the next primary press", async context => {
    const view = await launcher(context);
    view.render().props.onMouseDown({ button: 0 });
    context.mock.timers.tick(300);
    view.document.dispatch("mouseup", { button: 0, clientX: -1, clientY: -1 });
    view.render().props.onMouseDown({ button: 2 });
    context.mock.timers.tick(1000);
    assert.deepEqual(view.calls, []);
    view.render().props.onMouseDown({ button: 0 });
    context.mock.timers.tick(600);
    assert.deepEqual(view.calls, ["openLog", "/run/vr_panel_recall_log"]);
});

test("launcher cancellation listeners stay stable across renders and clean up on unmount", async context => {
    const view = await launcher(context);
    for (let i = 0; i < 3; i++) view.render();
    assert.deepEqual(view.document.added.map(([type]) => type), ["mouseup", "mouseleave", "pointercancel"]);
    assert.deepEqual(view.window.added.map(([type]) => type), ["blur"]);
    view.runtime.unmount();
    assert.deepEqual(view.document.removed, view.document.added);
    assert.deepEqual(view.window.removed, view.window.added);
});

// The function buttons, rendered with the given switch states, blocks and settings page state.
async function functionButtons({ blocks = {}, statuses = {}, configOpen = false } = {}) {
    const runtime = hooks(), calls = [];
    const status = name => statuses[name] ?? { state: "ok", data: false };
    const { VrLauncher } = await loadModule(new URL("./VrLauncher.jsx", import.meta.url), runtime, {
        "@logics_common": {
            useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: configOpen } }),
            useVrPanelLogOutOfView: () => ({ currentVrPanelLogOutOfView: { data: false } }),
            useVrPanelLauncherIntro: () => ({ currentVrPanelLauncherIntro: { data: "idle" } }),
        },
        "@logics_main": { useMainFunction: () => ({
            toggleTranslation: () => calls.push("translation"), currentTranslationStatus: status("translation"),
            toggleTranscriptionSend: () => calls.push("transcription_send"), currentTranscriptionSendStatus: status("transcription_send"),
            toggleTranscriptionReceive: () => calls.push("transcription_receive"), currentTranscriptionReceiveStatus: status("transcription_receive"),
            toggleOcrCapture: () => calls.push("ocr"), currentOcrCaptureStatus: status("ocr"),
        }) },
        "@store": { useStore_SwitchBlocks: () => ({ currentSwitchBlocks: { data: blocks } }) },
        "../../logics/main/switchBlocks": switchBlocks,
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: path => calls.push(path) }) },
        "@images/brand/icon-small.svg": "icon",
        "@images/brand/logo.svg": "logo",
        "./VrTooltip": { VrTooltipButton: "button" },
    });
    const tree = runtime.render(VrLauncher, { windows: { log: false, popup: null }, toggleLog() {}, openLog() {}, togglePopup() {} });
    const group = find(tree, node => node.props?.["aria-label"] === "vr_panel.tooltip.functions_group");
    const buttons = group.props.children.map(node => runtime.render(node.type, node.props));
    return { buttons, calls };
}

test("a VR switch whose setup is missing is greyed out, says why, and does nothing when pressed", async () => {
    const block = { reason: "ocr_models", action: "ocr_models" };
    const view = await functionButtons({ blocks: { ocr: block } });
    const [translation, , , ocr] = view.buttons;
    assert.match(ocr.props.className, /is_disabled/);
    assert.match(ocr.props.className, /is_blocked/);
    assert.equal(ocr.props["aria-disabled"], true);
    assert.equal(ocr.props.tipState, "OFF · vr_panel.switch_blocked.state");
    assert.equal(ocr.props.tipHelp, "vr_panel.switch_blocked.ocr_models");
    assert.equal(ocr.props.tipForce, true); // readable even with the tooltips turned off
    ocr.props.onClick();
    assert.deepEqual(view.calls, []);
    // The others are untouched.
    assert.doesNotMatch(translation.props.className, /is_disabled|is_blocked/);
    assert.equal(translation.props.tipForce, false);
    translation.props.onClick();
    assert.deepEqual(view.calls, ["translation"]);
});

test("the speech recognition block holds both the microphone and the listening buttons", async () => {
    const block = { reason: "asr_models", action: "transcription" };
    const view = await functionButtons({ blocks: { transcription_send: block, transcription_receive: block } });
    const [, send, receive] = view.buttons;
    for (const button of [send, receive]) {
        assert.equal(button.props.tipHelp, "vr_panel.switch_blocked.asr_models");
        button.props.onClick();
    }
    assert.deepEqual(view.calls, []);
});

test("a VR switch that is on, or on its way, stays usable when its setup goes missing", async () => {
    const block = { reason: "translation_model", action: "translation" };
    const on = await functionButtons({ blocks: { translation: block }, statuses: { translation: { state: "ok", data: true } } });
    assert.doesNotMatch(on.buttons[0].props.className, /is_blocked/);
    on.buttons[0].props.onClick();
    assert.deepEqual(on.calls, ["translation"]);
    const pending = await functionButtons({ blocks: { translation: block }, statuses: { translation: { state: "pending", data: false } } });
    assert.doesNotMatch(pending.buttons[0].props.className, /is_blocked/);
    assert.equal(pending.buttons[0].props.tipHelp, "vr_panel.tooltip.busy_help");
});

test("an open settings page explains the lock before a missing setup", async () => {
    const view = await functionButtons({ blocks: { ocr: { reason: "ocr_language", action: "ocr" } }, configOpen: true });
    const ocr = view.buttons[3];
    assert.equal(ocr.props.tipHelp, "vr_panel.locked_by_config_page");
    assert.equal(ocr.props.tipForce, false);
});

test("the VR panel has a text for every block its buttons can show", async () => {
    const { readFile } = await import("node:fs/promises");
    const shown = ["translation", "transcription_send", "transcription_receive", "ocr"];
    const blocks = switchBlocks.switchBlocks({
        needs: [{ id: "translation", weight: "m" }, { id: "transcription" }],
        ocr: { language_supported: true, missing_models: ["a"] },
    });
    const reasons = new Set(shown.map(id => blocks[id]?.reason).filter(Boolean));
    reasons.add("translation_downloading").add("ocr_language");
    for (const lang of ["en", "ja"]) {
        const text = await readFile(new URL(`../../../locales/${lang}.yml`, import.meta.url), "utf8");
        const section = text.slice(text.indexOf("\n    switch_blocked:", text.indexOf("\nvr_panel:")));
        for (const reason of ["state", ...reasons]) {
            assert.match(section, new RegExp(`\\n        ${reason}: "`), `${lang}: vr_panel.switch_blocked.${reason}`);
        }
    }
});
