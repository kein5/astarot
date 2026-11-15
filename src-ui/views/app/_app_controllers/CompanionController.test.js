import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule } from "../../../logics/test/hookHarness.js";
import { flush } from "../../../logics/test/bridgeHarness.js";
import * as status from "../../../logics/companion/status.js";

async function setup(context, { companion }) {
    const runtime = hooks(), calls = [], listeners = new Map(), toggles = [];
    const state = { ready: false, mic: { state: "ok", data: false }, request: null, mode: false, queue: [], quits: 0 };
    const store = {};
    const invoke = async (command, args) => {
        calls.push([command, args]);
        if (command === "companion_mode") return companion;
        if (command === "companion_take") return state.queue.splice(0);
        return undefined;
    };
    const listen = async (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name); };
    const { CompanionController } = await loadModule(new URL("./CompanionController.jsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { invoke },
        "@tauri-apps/api/event": { listen },
        "@useI18n": { useI18n: () => ({ t: key => key, i18n: { language: "ja" } }) },
        "@store": { store, useStore_CompanionMode: () => ({ currentCompanionMode: { data: state.mode },
            updateCompanionMode: value => { state.mode = value; } }) },
        "@logics_common": { useIsBackendReady: () => ({ currentIsBackendReady: { data: state.ready } }),
            useWindow: () => ({ asyncQuitApp: () => { state.quits++; } }) },
        "@logics_main": { useMainFunction: () => ({ currentTranscriptionSendStatus: state.mic,
            currentTranslationStatus: { state: "ok", data: false },
            toggleTranscriptionSend: () => toggles.push("mic"), toggleTranslation: () => toggles.push("translation") }) },
        "../../../logics/transcription/useTranscriptionConsent": { useTranscriptionConsent: () => ({ request: state.request }) },
        "../../../logics/companion/status.js": status,
    });
    const render = async () => { runtime.render(CompanionController); await flush(); };
    await render(); await render();
    context.after(() => runtime.unmount());
    return { state, store, calls, listeners, toggles, render, of: name => calls.filter(([c]) => c === name).map(([, a]) => a) };
}

test("outside the companion form it only asks once and changes nothing", async context => {
    const s = await setup(context, { companion: false });
    await s.render();
    assert.deepEqual(s.calls.map(([command]) => command), ["companion_mode"]);
    assert.equal(s.store.companion_mode, undefined);
    assert.equal(s.listeners.size, 0);
});

test("in the companion form it reports the switches and runs what the tray and the panel ask", async context => {
    const s = await setup(context, { companion: true });
    assert.equal(s.store.companion_mode, true);
    assert.equal(s.of("companion_publish").at(-1).status.ready, false);
    s.state.ready = true; s.state.mic = { state: "ok", data: true };
    await s.render();
    const reported = s.of("companion_publish").at(-1).status;
    assert.equal(reported.ready, true);
    assert.deepEqual(reported.mic, { on: true, pending: false });
    assert.equal(reported.language, "ja");
    s.state.queue.push("toggle_mic", "toggle_translation", "unknown");
    await s.listeners.get("companion-requested")();
    assert.deepEqual(s.toggles, ["mic", "translation"]);
    s.listeners.get("companion-quit")();
    assert.equal(s.state.quits, 1);
});

test("a consent the user must answer brings the hidden main window forward", async context => {
    const s = await setup(context, { companion: true });
    assert.deepEqual(s.of("companion_show_main"), []);
    s.state.request = { endpoint: "/set/enable/transcription_send", mode: "choose" };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 1);
});
