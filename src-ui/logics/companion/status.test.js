import assert from "node:assert/strict";
import { test } from "node:test";
import { actionFor, companionStatus, edgeAction, FEATURES, panelState, runAction } from "./status.ts";

const t = key => `t:${key}`;
const off = { on: false, pending: false };

test("the reported state holds only the six switches, the UI language and the tray's words", () => {
    const status = companionStatus({ ready: true, mic: { state: "ok", data: true },
        translation: { state: "pending", data: false }, listening: { state: "ok", data: true },
        ocr: { state: "ok", data: false }, tts: { on: true, pending: false }, rvc: { on: false, pending: true },
        edge: "bottom", language: "ja", t });
    assert.deepEqual(status, {
        ready: true,
        mic: { on: true, pending: false },
        translation: { on: false, pending: true },
        listening: { on: true, pending: false },
        ocr: off,
        tts: { on: true, pending: false },
        rvc: { on: false, pending: true },
        language: "ja",
        edge: "bottom",
        menu: { start: "t:companion.menu_start", stop: "t:companion.menu_stop", panel: "t:companion.menu_panel",
            main: "t:companion.menu_main", quit: "t:companion.menu_quit" },
    });
});

test("an unknown language or edge falls back to English and the right edge, and a missing switch reads as off", () => {
    const status = companionStatus({ ready: undefined, mic: undefined, translation: { data: "yes" }, edge: "middle", language: "fr", t });
    assert.equal(status.ready, false);
    assert.equal(status.language, "en");
    assert.equal(status.edge, "right");
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

test("the hexagram's common settings may ask for one of the four edges, and nothing else", () => {
    const edges = [];
    const toggles = { toggleTranscriptionSend: () => {}, toggleTranslation: () => {}, setEdge: edge => edges.push(edge) };
    for (const edge of ["right", "left", "top", "bottom"]) assert.equal(runAction(edgeAction(edge), toggles), true, edge);
    assert.deepEqual(edges, ["right", "left", "top", "bottom"]);
    assert.equal(runAction("edge_middle", toggles), false);
    assert.equal(runAction("edge_right", { ...toggles, setEdge: undefined }), false);
    assert.deepEqual(edges, ["right", "left", "top", "bottom"]);
});
