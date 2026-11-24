import assert from "node:assert/strict";
import { test } from "vitest";
import { actionFor, companionStatus, edgeAction, FEATURES, panelState, runAction, SWITCH_IDS, WHEEL_HINT_SEEN } from "./status.ts";
import { unchecked } from "../test/hookHarness.ts";

const t = (key: string) => `t:${key}`;
const off = { on: false, pending: false, blocked: false };

test("the reported state holds only the six switches, the UI language, the theme and the tray's words", () => {
    const theme = { preset: "forest", custom: { base: "#15261c", accent: "#62c98c" } };
    const status = companionStatus({ ready: true, mic: { state: "ok", data: true },
        translation: { state: "pending", data: false }, listening: { state: "ok", data: true },
        ocr: { state: "ok", data: false }, tts: { on: true, pending: false }, rvc: { on: false, pending: true },
        edge: "bottom", monitor: "\\\\.\\DISPLAY2", hinted: true, theme, language: "ja", t });
    assert.deepEqual(status, {
        ready: true,
        mic: { on: true, pending: false, blocked: false },
        translation: { on: false, pending: true, blocked: false },
        listening: { on: true, pending: false, blocked: false },
        ocr: off,
        tts: { on: true, pending: false, blocked: false },
        rvc: { on: false, pending: true, blocked: false },
        language: "ja",
        edge: "bottom",
        monitor: "\\\\.\\DISPLAY2",
        hinted: true,
        theme,
        menu: { start: "t:companion.menu_start", stop: "t:companion.menu_stop", panel: "t:companion.menu_panel",
            main: "t:companion.menu_main", quit: "t:companion.menu_quit", monitor: "t:companion.menu_monitor",
            primary: "t:companion.menu_monitor_primary", display: "t:companion.menu_monitor_display",
            missing: "t:companion.menu_monitor_missing" },
    });
});

test("an unknown language or edge falls back to English and the right edge, and a missing switch reads as off", () => {
    const status = companionStatus({ ready: undefined, mic: undefined, translation: { data: "yes" }, edge: "middle", theme: { preset: "bad", custom: { base: "nope", accent: "#123456" } }, language: "fr", t });
    assert.equal(status.ready, false);
    assert.equal(status.language, "en");
    assert.equal(status.edge, "right");
    assert.equal(status.monitor, "", "no monitor chosen: the primary one");
    assert.equal(status.hinted, null, "the wheel's hint is not known yet: the hexagram does not tell of it");
    assert.equal(status.theme, null, "an invalid theme falls back to the default theme");
    for (const feature of FEATURES) assert.deepEqual(status[feature], off, feature);
});

test("a switch whose main switch is greyed out is reported as such, the others as not (#562)", () => {
    const status = companionStatus({ ready: true, mic: { state: "ok", data: false }, translation: { state: "ok", data: false },
        tts: { on: false, pending: false }, blocked: { mic: true, tts: true }, language: "ja", t });
    assert.deepEqual(FEATURES.filter(feature => status[feature].blocked), ["mic", "tts"]);
});

test("the panel says starting until the backend is ready, then whether the microphone listens", () => {
    assert.equal(panelState(null), "starting");
    // Test data: a state with only what the panel reads.
    const state = (ready: boolean, on: boolean) => unchecked<Parameters<typeof panelState>[0]>({ ready, mic: { on } });
    assert.equal(panelState(state(false, true)), "starting");
    assert.equal(panelState(state(true, true)), "listening");
    assert.equal(panelState(state(true, false)), "idle");
});

test("each of the six switches has its action, and only those run", () => {
    const calls: string[] = [];
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
    // A switch the main window holds off is refused before its toggle runs.
    const asked: string[] = [];
    assert.equal(runAction("toggle_ocr", { ...toggles, refuse: feature => { asked.push(feature); return true; } }), false);
    assert.equal(runAction("toggle_mic", { ...toggles, refuse: () => false }), true);
    assert.deepEqual(asked, ["ocr"]);
    assert.deepEqual(calls, [...FEATURES, "mic"]);
    assert.deepEqual(Object.keys(SWITCH_IDS).sort(), [...FEATURES].sort());
});

test("the hexagram's common settings may ask for one of the four edges, and nothing else", () => {
    const edges: string[] = [];
    const toggles = { toggleTranscriptionSend: () => {}, toggleTranslation: () => {}, setEdge: (edge: string) => edges.push(edge) };
    for (const edge of ["right", "left", "top", "bottom"] as const) assert.equal(runAction(edgeAction(edge), toggles), true, edge);
    assert.deepEqual(edges, ["right", "left", "top", "bottom"]);
    assert.equal(runAction("edge_middle", toggles), false);
    assert.equal(runAction("edge_right", { ...toggles, setEdge: undefined }), false);
    assert.deepEqual(edges, ["right", "left", "top", "bottom"]);
});

// #536: the first time the hexagram comes out it tells that the wheel turns it, and asks the main
// window to keep that it has.
test("the hexagram's wheel hint, once told, is kept", () => {
    let kept = 0;
    const toggles = { toggleTranscriptionSend: () => {}, toggleTranslation: () => {}, setHinted: () => { kept += 1; } };
    assert.equal(runAction(WHEEL_HINT_SEEN, toggles), true);
    assert.equal(kept, 1);
    assert.equal(runAction(WHEEL_HINT_SEEN, { ...toggles, setHinted: undefined }), false);
    assert.equal(companionStatus({ ready: true, mic: undefined, translation: undefined, hinted: false, language: "ja", t }).hinted, false);
});

test("a monitor chosen in the tray menu is saved by name, and an empty name means the primary one", () => {
    const monitors: string[] = [];
    const toggles = { toggleTranscriptionSend: () => {}, toggleTranslation: () => {}, setMonitor: (name: string) => monitors.push(name) };
    assert.equal(runAction("monitor:\\\\.\\DISPLAY2", toggles), true);
    assert.equal(runAction("monitor:", toggles), true);
    assert.deepEqual(monitors, ["\\\\.\\DISPLAY2", ""]);
    assert.equal(runAction("monitor:x", { ...toggles, setMonitor: undefined }), false);
});
