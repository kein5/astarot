import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule } from "../../../logics/test/hookHarness.js";
import { flush } from "../../../logics/test/bridgeHarness.js";
import * as status from "../../../logics/companion/status.ts";
import * as voice from "../../../logics/voice/voiceActions.ts";

async function setup(context, { on = false } = {}) {
    const runtime = hooks(), calls = [], listeners = new Map(), toggles = [];
    const state = { on, ready: false, mic: { state: "ok", data: false }, request: null, setup: null,
        startup: "running", queue: [], quits: 0, edge: "right", edgeSaved: [], monitor: "", monitorSaved: [],
        // Whether the app has a tray icon to put the main window away in.
        tray: true };
    const store = {};
    const invoke = async (command, args) => {
        calls.push([command, args]);
        if (command === "companion_take") return state.queue.splice(0);
        if (command === "companion_hide_main") return state.tray;
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
        "@logics_configs": { useExperimentalFeature: id => id === "tray_companion" && state.on,
            useExperimentalFeatures: () => ({ currentTrayCompanionEdge: { state: "ok", data: state.edge },
                setTrayCompanionEdge: value => { state.edgeSaved.push(value); },
                currentTrayCompanionMonitor: { state: "ok", data: state.monitor },
                setTrayCompanionMonitor: value => { state.monitorSaved.push(value); } }) },
        "@logics_main": { useMainFunction: () => ({ currentTranscriptionSendStatus: state.mic,
            currentTranslationStatus: { state: "ok", data: false },
            currentTranscriptionReceiveStatus: { state: "ok", data: false }, currentOcrCaptureStatus: { state: "ok", data: true },
            toggleTranscriptionSend: () => toggles.push("mic"), toggleTranslation: () => toggles.push("translation"),
            toggleTranscriptionReceive: () => toggles.push("listening"), toggleOcrCapture: () => toggles.push("ocr") }) },
        "../../../logics/voice/voiceActions.ts": voice,
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

test("while the overlay feature is off it only serves the app's tray icon", async context => {
    const s = await setup(context);
    s.state.ready = true; s.state.mic = { state: "ok", data: true };
    await s.render();
    // The tray menu's words and the microphone's state, for the tray icon every run has.
    const reported = s.of("companion_publish").at(-1).status;
    assert.equal(reported.ready, true);
    assert.deepEqual(reported.mic, { on: true, pending: false });
    assert.equal(reported.menu.quit, "companion.menu_quit");
    // The tray's "start or stop recognition" and "quit" work.
    s.state.queue.push("toggle_mic");
    await s.listeners.get("companion-requested")();
    assert.deepEqual(s.toggles, ["mic"]);
    s.listeners.get("companion-quit")();
    assert.equal(s.state.quits, 1);
    // Nothing of the overlay is started.
    assert.deepEqual(s.of("companion_set"), []);
    assert.deepEqual(s.of("companion_show_main"), []);
});

test("closing the main window puts it away in the tray in every run, and quits only without a tray", async context => {
    const s = await setup(context);
    await s.store.companion_hide();
    assert.equal(s.of("companion_hide_main").length, 1);
    assert.equal(s.state.quits, 0, "put away in the tray, not quit");
    s.state.tray = false;
    await s.store.companion_hide();
    assert.equal(s.state.quits, 1, "no tray icon to come back from: it quits as before");
    // The tray menu's Quit is how the app ends.
    s.listeners.get("companion-quit")();
    assert.equal(s.state.quits, 2);
});

test("a dialog or a consent brings the main window forward from the tray, even with the overlay off", async context => {
    const s = await setup(context);
    s.state.request = { endpoint: "/set/enable/transcription_send", mode: "choose" };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 1);
});

test("turned on, it starts the overlay, reports the switches and runs what the tray and the panel ask", async context => {
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
    assert.equal(reported.edge, "right");
    s.state.edge = "top";
    await s.render();
    assert.equal(s.of("companion_publish").at(-1).status.edge, "top", "a changed edge is reported");
    assert.deepEqual(reported.ocr, { on: true, pending: false });
    voice.voiceActions.toggleTts = () => s.toggles.push("tts");
    voice.voiceActions.toggleRvc = () => s.toggles.push("rvc");
    context.after(() => { voice.voiceActions.toggleTts = null; voice.voiceActions.toggleRvc = null; });
    // The main page publishes what its TTS switch shows; the tray and the handle get the same.
    voice.voiceSwitchStates.publish({ tts: { on: true, pending: false }, rvc: { on: false, pending: false } });
    context.after(() => voice.voiceSwitchStates.publish({ tts: { on: false, pending: false }, rvc: { on: false, pending: false } }));
    await s.render();
    assert.deepEqual(s.of("companion_publish").at(-1).status.tts, { on: true, pending: false });
    s.state.queue.push("toggle_mic", "toggle_translation", "toggle_listening", "toggle_ocr", "toggle_tts", "toggle_rvc", "unknown");
    await s.listeners.get("companion-requested")();
    assert.deepEqual(s.toggles, ["mic", "translation", "listening", "ocr", "tts", "rvc"]);
    s.state.queue.push("edge_left");
    await s.listeners.get("companion-requested")();
    assert.deepEqual(s.state.edgeSaved, ["left"], "the common settings save the edge as the settings page does");
    s.state.queue.push("monitor:\\\\.\\DISPLAY2");
    await s.listeners.get("companion-requested")();
    assert.deepEqual(s.state.monitorSaved, ["\\\\.\\DISPLAY2"], "the tray's monitor menu saves the monitor");
    s.state.monitor = "\\\\.\\DISPLAY2";
    await s.render();
    assert.equal(s.of("companion_publish").at(-1).status.monitor, "\\\\.\\DISPLAY2", "the chosen monitor is reported");
    s.listeners.get("companion-quit")();
    assert.equal(s.state.quits, 1);
});

test("turned off again, it stops the overlay once; the window still goes to the tray when closed", async context => {
    const s = await setup(context, { on: true });
    s.state.on = false;
    await s.render();
    await s.render();
    assert.deepEqual(s.of("companion_set"), [{ enabled: true }, { enabled: false }]);
    assert.equal(typeof s.store.companion_hide, "function");
    // The tray icon stays, and still asks for its own actions.
    assert.ok(s.listeners.has("companion-requested") && s.listeners.has("companion-quit"));
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
