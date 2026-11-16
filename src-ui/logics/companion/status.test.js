import assert from "node:assert/strict";
import { test } from "node:test";
import { actionFor, companionStatus, FEATURES, panelState, runAction } from "./status.ts";

const t = key => `t:${key}`;
const off = { on: false, pending: false };

test("the reported state holds only the six switches, the UI language and the tray's words", () => {
    const status = companionStatus({ ready: true, mic: { state: "ok", data: true },
        translation: { state: "pending", data: false }, listening: { state: "ok", data: true },
        ocr: { state: "ok", data: false }, tts: { on: true, pending: false }, rvc: { on: false, pending: true },
        language: "ja", t });
    assert.deepEqual(status, {
        ready: true,
        mic: { on: true, pending: false },
        translation: { on: false, pending: true },
        listening: { on: true, pending: false },
        ocr: off,
        tts: { on: true, pending: false },
        rvc: { on: false, pending: true },
        language: "ja",
        menu: { start: "t:companion.menu_start", stop: "t:companion.menu_stop", panel: "t:companion.menu_panel",
            main: "t:companion.menu_main", quit: "t:companion.menu_quit" },
    });
});

test("an unknown language falls back to English and a missing switch reads as off", () => {
    const status = companionStatus({ ready: undefined, mic: undefined, translation: { data: "yes" }, language: "fr", t });
    assert.equal(status.ready, false);
    assert.equal(status.language, "en");
    for (const feature of FEATURES) assert.deepEqual(status[feature], off, feature);
});

test("the panel says starting until the backend is ready, then whether the microphone listens", () => {
    assert.equal(panelState(null), "starting");
    assert.equal(panelState({ ready: false, mic: { on: true } }), "starting");
    assert.equal(panelState({ ready: true, mic: { on: true } }), "listening");
    assert.equal(panelState({ ready: true, mic: { on: false } }), "idle");
});

test("each of the six switches has its action, and only those run", () => {
    const calls = [];
    const toggles = {
        toggleTranscriptionSend: () => calls.push("mic"), toggleTranslation: () => calls.push("translation"),
        toggleTranscriptionReceive: () => calls.push("listening"), toggleOcrCapture: () => calls.push("ocr"),
        toggleTts: () => calls.push("tts"), toggleRvc: () => calls.push("rvc"),
    };
    for (const feature of FEATURES) assert.equal(runAction(actionFor(feature), toggles), true, feature);
    assert.deepEqual(calls, [...FEATURES]);
    for (const action of ["open_main", "send_message", "toString", "__proto__", 1, null]) {
        assert.equal(runAction(action, toggles), false, String(action));
    }
    // The main page has not rendered its voice switches yet: nothing runs.
    assert.equal(runAction("toggle_tts", { ...toggles, toggleTts: null }), false);
    assert.deepEqual(calls, [...FEATURES]);
});
