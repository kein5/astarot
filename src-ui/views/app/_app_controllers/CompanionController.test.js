import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule } from "../../../logics/test/hookHarness.js";
import { flush } from "../../../logics/test/bridgeHarness.js";
import * as status from "../../../logics/companion/status.ts";

async function setup(context, { on = false } = {}) {
    const runtime = hooks(), calls = [], listeners = new Map(), toggles = [];
    const state = { on, ready: false, mic: { state: "ok", data: false }, request: null, setup: null,
        startup: "running", queue: [], quits: 0 };
    const store = {};
    const invoke = async (command, args) => {
        calls.push([command, args]);
        if (command === "companion_take") return state.queue.splice(0);
        return undefined;
    };
    const listen = async (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name); };
    const { CompanionController } = await loadModule(new URL("./CompanionController.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { invoke },
        "@tauri-apps/api/event": { listen },
        "@useI18n": { useI18n: () => ({ t: key => key, i18n: { language: "ja" } }) },
        "@store": { store },
        "@logics_common": { useIsBackendReady: () => ({ currentIsBackendReady: { data: state.ready } }),
            useWindow: () => ({ asyncQuitApp: () => { state.quits++; } }) },
        "@logics_configs": { useExperimentalFeature: id => id === "tray_companion" && state.on },
        "@logics_main": { useMainFunction: () => ({ currentTranscriptionSendStatus: state.mic,
            currentTranslationStatus: { state: "ok", data: false },
            toggleTranscriptionSend: () => toggles.push("mic"), toggleTranslation: () => toggles.push("translation") }) },
        "../../../logics/common/useBackendStartup": { useBackendStartup: () => ({ startupState: state.startup }) },
        "../../../logics/transcription/useTranscriptionConsent": { useTranscriptionConsent: () => ({ request: state.request }) },
        "../../../logics/translation/useTranslationSetup": { useTranslationSetup: () => ({ request: state.setup }) },
        "../../../logics/companion/status.ts": status,
        "../../../logics/companion/dialogs.ts": { watchOpenDialogs: () => () => {} },
    });
    const render = async () => { runtime.render(CompanionController); await flush(); };
    await render(); await render();
    context.after(() => runtime.unmount());
    return { state, store, calls, listeners, toggles, render,
        of: name => calls.filter(([command]) => command === name).map(([, args]) => args) };
}

test("while the experimental feature is off it calls nothing and listens to nothing", async context => {
    const s = await setup(context);
    s.state.ready = true;
    await s.render();
    assert.deepEqual(s.calls, []);
    assert.equal(s.listeners.size, 0);
    assert.equal(s.store.companion_hide, undefined);
});

test("turned on, it starts the tray, reports the switches and runs what the tray and the panel ask", async context => {
    const s = await setup(context, { on: true });
    assert.deepEqual(s.of("companion_set"), [{ enabled: true }]);
    await s.store.companion_hide();
    assert.equal(s.of("companion_hide_main").length, 1);
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

test("turned off again, it stops the tray once and closing the window quits as before", async context => {
    const s = await setup(context, { on: true });
    s.state.on = false;
    await s.render();
    await s.render();
    assert.deepEqual(s.of("companion_set"), [{ enabled: true }, { enabled: false }]);
    assert.equal(s.store.companion_hide, undefined);
    assert.equal(s.listeners.size, 0);
});

test("the recognition consent and the translation model's review bring the hidden main window forward", async context => {
    const s = await setup(context, { on: true });
    assert.deepEqual(s.of("companion_show_main"), []);
    s.state.request = { endpoint: "/set/enable/transcription_send", mode: "choose" };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 1);
    s.state.request = null;
    await s.render();
    s.state.setup = { resume: true, weightType: null };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 2);
});

test("a failed start asks for the main window even before the settings arrive", async context => {
    const s = await setup(context);
    s.state.startup = "failed";
    await s.render();
    assert.equal(s.of("companion_show_main").length, 1);
    assert.deepEqual(s.of("companion_set"), []);
});
