import assert from "node:assert/strict";
import { test } from "node:test";
import { companionStatus, panelState, runAction } from "./status.js";

const t = key => `t:${key}`;

test("the reported state holds only the switches, the UI language and the tray's words", () => {
    const status = companionStatus({ ready: true, mic: { state: "ok", data: true },
        translation: { state: "pending", data: false }, language: "ja", t });
    assert.deepEqual(status, {
        ready: true,
        mic: { on: true, pending: false },
        translation: { on: false, pending: true },
        language: "ja",
        menu: { start: "t:companion.menu_start", stop: "t:companion.menu_stop", panel: "t:companion.menu_panel",
            main: "t:companion.menu_main", quit: "t:companion.menu_quit" },
    });
});

test("an unknown language falls back to English and a missing switch reads as off", () => {
    const status = companionStatus({ ready: undefined, mic: undefined, translation: { data: "yes" }, language: "fr", t });
    assert.equal(status.ready, false);
    assert.equal(status.language, "en");
    assert.deepEqual(status.mic, { on: false, pending: false });
    assert.deepEqual(status.translation, { on: false, pending: false });
});

test("the panel says starting until the backend is ready, then whether the microphone listens", () => {
    assert.equal(panelState(null), "starting");
    assert.equal(panelState({ ready: false, mic: { on: true } }), "starting");
    assert.equal(panelState({ ready: true, mic: { on: true } }), "listening");
    assert.equal(panelState({ ready: true, mic: { on: false } }), "idle");
});

test("only the two switches can be asked for", () => {
    const calls = [];
    const main = { toggleTranscriptionSend: () => calls.push("mic"), toggleTranslation: () => calls.push("translation") };
    assert.equal(runAction("toggle_mic", main), true);
    assert.equal(runAction("toggle_translation", main), true);
    assert.equal(runAction("open_main", main), false);
    assert.equal(runAction("send_message", main), false);
    assert.deepEqual(calls, ["mic", "translation"]);
});
