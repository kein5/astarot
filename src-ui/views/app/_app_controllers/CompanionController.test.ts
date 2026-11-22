import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../../../logics/test/hookHarness.ts";
import { flush } from "../../../logics/test/bridgeHarness.ts";
import * as status from "../../../logics/companion/status.ts";
import * as voice from "../../../logics/voice/voiceActions.ts";
import * as switchBlocks from "../../../logics/main/switchBlocks.ts";
import type { CompanionStatus } from "../../../logics/companion/status.ts";

// What the controller hands the native commands it calls.
interface InvokeArgs {
    enabled?: boolean;
    status?: CompanionStatus;
}
// The switches, requests and settings the controller reads, and what it saved.
interface State {
    on: boolean;
    ready: boolean;
    mic: { state: string; data: boolean };
    request: { endpoint: string; mode: string } | null;
    setup: { resume: boolean; weightType: string | null } | null;
    blocks: Record<string, { reason: string; action: string }>;
    notice: { status: string; is_open: boolean } | null;
    startup: string;
    queue: string[];
    quits: number;
    edge: string;
    edgeSaved: unknown[];
    monitor: string;
    monitorSaved: unknown[];
    hinted: boolean;
    hintedSaved: unknown[];
    tray: boolean;
}

async function setup(context: TestContext, { on = false }: { on?: boolean } = {}) {
    const runtime = hooks(), calls: [string, InvokeArgs | undefined][] = [], listeners = new Map<string, () => unknown>(),
        toggles: string[] = [], notices: [string, unknown][] = [];
    const state: State = { on, ready: false, mic: { state: "ok", data: false }, request: null, setup: null, blocks: {}, notice: null,
        startup: "running", queue: [], quits: 0, edge: "right", edgeSaved: [], monitor: "", monitorSaved: [],
        hinted: false, hintedSaved: [],
        // Whether the app has a tray icon to put the main window away in.
        tray: true };
    const store: { companion_hide?: () => Promise<void> } = {};
    const invoke = async (command: string, args?: InvokeArgs) => {
        calls.push([command, args]);
        if (command === "companion_take") return state.queue.splice(0);
        if (command === "companion_hide_main") return state.tray;
        return undefined;
    };
    const listen = async (name: string, callback: () => unknown) => { listeners.set(name, callback); return () => listeners.delete(name); };
    const { CompanionController } = await loadModule<typeof import("./CompanionController.tsx")>(new URL("./CompanionController.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { invoke },
        "@tauri-apps/api/event": { listen },
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "ja" } }) },
        "@store": { store, useStore_SwitchBlocks: () => ({ currentSwitchBlocks: { data: state.blocks } }),
            useStore_NotificationStatus: () => ({ currentNotificationStatus: { data: state.notice } }) },
        "@logics_common": { useIsBackendReady: () => ({ currentIsBackendReady: { data: state.ready } }),
            useWindow: () => ({ asyncQuitApp: () => { state.quits++; } }),
            useNotificationStatus: () => ({ showNotification_Error: (message: string, options: unknown) => notices.push([message, options]) }) },
        "@logics_configs": { useExperimentalFeature: (id: string) => id === "tray_companion" && state.on,
            useExperimentalFeatures: () => ({ currentTrayCompanionEdge: { state: "ok", data: state.edge },
                setTrayCompanionEdge: (value: unknown) => { state.edgeSaved.push(value); },
                currentTrayCompanionMonitor: { state: "ok", data: state.monitor },
                setTrayCompanionMonitor: (value: unknown) => { state.monitorSaved.push(value); },
                currentTrayCompanionWheelHintShown: { state: "ok", data: state.hinted },
                setTrayCompanionWheelHintShown: (value: unknown) => { state.hintedSaved.push(value); } }) },
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
        "../../../logics/main/switchBlocks.ts": switchBlocks,
    });
    const render = async () => { runtime.render(CompanionController); await flush(); };
    await render(); await render();
    context.onTestFinished(() => runtime.unmount());
    const of = (name: string) => calls.filter(([command]) => command === name).map(([, args]) => args);
    // The status the tray was told last, which the test needs to be there.
    const published = () => {
        const args = of("companion_publish").at(-1);
        assert.ok(args?.status);
        return args.status;
    };
    // The handler the controller listens with for an event, which the test needs to be there.
    const listener = (name: string) => {
        const handler = listeners.get(name);
        assert.ok(handler, name);
        return handler;
    };
    // Closing the main window, as its close button does through the store.
    const hide = () => {
        assert.ok(store.companion_hide);
        return store.companion_hide();
    };
    return { state, store, calls, listeners, listener, toggles, notices, render, of, published, hide };
}

test("while the overlay feature is off it only serves the app's tray icon", async context => {
    const s = await setup(context);
    s.state.ready = true; s.state.mic = { state: "ok", data: true };
    await s.render();
    // The tray menu's words and the microphone's state, for the tray icon every run has.
    const reported = s.published();
    assert.equal(reported.ready, true);
    assert.deepEqual(reported.mic, { on: true, pending: false, blocked: false });
    assert.equal(reported.menu.quit, "companion.menu_quit");
    // The tray's "start or stop recognition" and "quit" work.
    s.state.queue.push("toggle_mic");
    await s.listener("companion-requested")();
    assert.deepEqual(s.toggles, ["mic"]);
    s.listener("companion-quit")();
    assert.equal(s.state.quits, 1);
    // Nothing of the overlay is started.
    assert.deepEqual(s.of("companion_set"), []);
    assert.deepEqual(s.of("companion_show_main"), []);
});

test("closing the main window puts it away in the tray in every run, and quits only without a tray", async context => {
    const s = await setup(context);
    await s.hide();
    assert.equal(s.of("companion_hide_main").length, 1);
    assert.equal(s.state.quits, 0, "put away in the tray, not quit");
    s.state.tray = false;
    await s.hide();
    assert.equal(s.state.quits, 1, "no tray icon to come back from: it quits as before");
    // The tray menu's Quit is how the app ends.
    s.listener("companion-quit")();
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
    await s.hide();
    assert.equal(s.of("companion_hide_main").length, 1);
    assert.equal(s.published().ready, false);
    assert.equal(s.published().hinted, null, "before the backend is ready, the wheel's hint is not known (#536)");
    s.state.ready = true; s.state.mic = { state: "ok", data: true };
    await s.render();
    const reported = s.published();
    assert.equal(reported.ready, true);
    assert.deepEqual(reported.mic, { on: true, pending: false, blocked: false });
    assert.equal(reported.language, "ja");
    assert.equal(reported.edge, "right");
    assert.equal(reported.hinted, false, "the hexagram has not told of the wheel yet");
    s.state.edge = "top";
    await s.render();
    assert.equal(s.published().edge, "top", "a changed edge is reported");
    assert.deepEqual(reported.ocr, { on: true, pending: false, blocked: false });
    voice.voiceActions.toggleTts = () => s.toggles.push("tts");
    voice.voiceActions.toggleRvc = () => s.toggles.push("rvc");
    context.onTestFinished(() => { voice.voiceActions.toggleTts = null; voice.voiceActions.toggleRvc = null; });
    // The main page publishes what its TTS switch shows; the tray and the handle get the same.
    voice.voiceSwitchStates.publish({ tts: { on: true, pending: false }, rvc: { on: false, pending: false } });
    context.onTestFinished(() => voice.voiceSwitchStates.publish({ tts: { on: false, pending: false }, rvc: { on: false, pending: false } }));
    await s.render();
    assert.deepEqual(s.published().tts, { on: true, pending: false, blocked: false });
    s.state.queue.push("toggle_mic", "toggle_translation", "toggle_listening", "toggle_ocr", "toggle_tts", "toggle_rvc", "unknown");
    await s.listener("companion-requested")();
    assert.deepEqual(s.toggles, ["mic", "translation", "listening", "ocr", "tts", "rvc"]);
    s.state.queue.push("edge_left");
    await s.listener("companion-requested")();
    assert.deepEqual(s.state.edgeSaved, ["left"], "the common settings save the edge as the settings page does");
    s.state.queue.push("monitor:\\\\.\\DISPLAY2");
    await s.listener("companion-requested")();
    assert.deepEqual(s.state.monitorSaved, ["\\\\.\\DISPLAY2"], "the tray's monitor menu saves the monitor");
    s.state.monitor = "\\\\.\\DISPLAY2";
    await s.render();
    assert.equal(s.published().monitor, "\\\\.\\DISPLAY2", "the chosen monitor is reported");
    // #536: the hexagram told of the wheel; the main window keeps it.
    s.state.queue.push("wheel_hint_seen");
    await s.listener("companion-requested")();
    assert.deepEqual(s.state.hintedSaved, [true]);
    s.state.hinted = true;
    await s.render();
    assert.equal(s.published().hinted, true);
    s.listener("companion-quit")();
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

test("a switch the main window greys out is not pressed from the tray; the main window comes forward and says why", async context => {
    const s = await setup(context);
    s.state.ready = true;
    s.state.blocks = { ocr: { reason: "ocr_language", action: "ocr" }, transcription_send: { reason: "asr_models", action: "transcription" } };
    await s.render();
    // OCR is on, so it can still be turned off; the microphone is off and blocked.
    s.state.queue.push("toggle_ocr", "toggle_mic", "toggle_translation");
    await s.listener("companion-requested")();
    assert.deepEqual(s.toggles, ["ocr", "translation"]);
    assert.deepEqual(s.notices, [["main_page.transcription_send: main_page.switch_blocked.asr_models", { category_id: "companion_blocked_mic" }]]);
    assert.equal(s.of("companion_show_main").length, 1);
    // The panel and the hexagram draw the microphone as greyed out; OCR, on, can still be turned off (#562).
    const reported = s.published();
    assert.deepEqual([reported.mic.blocked, reported.ocr.blocked, reported.translation.blocked], [true, false, false]);
});

test("an error notice that answers a switch pressed from the tray brings the main window forward", async context => {
    const s = await setup(context);
    s.state.ready = true;
    await s.render();
    // An error with no press from the tray before it stays in the main window.
    s.state.notice = { status: "error", is_open: true };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 0);
    s.state.queue.push("toggle_mic");
    await s.listener("companion-requested")();
    s.state.notice = { status: "success", is_open: true };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 0, "only an error is a refusal");
    s.state.notice = { status: "error", is_open: true };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 1);
    // Once answered, a later error does not bring it forward again.
    s.state.notice = { status: "error", is_open: true };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 1);
    // Nor does an error long after the press.
    const now = Date.now;
    context.onTestFinished(() => { Date.now = now; });
    s.state.queue.push("toggle_mic");
    await s.listener("companion-requested")();
    Date.now = () => now() + 31000;
    s.state.notice = { status: "error", is_open: true };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 1);
});

// #463: a press the switch carried out has been answered; an unrelated error after it (a failed
// translation, say) leaves the main window in the tray.
test("an error after the switch from the tray has changed does not bring the main window forward", async context => {
    const s = await setup(context);
    s.state.ready = true;
    await s.render();
    s.state.queue.push("toggle_mic");
    await s.listener("companion-requested")();
    s.state.mic = { state: "pending", data: false };
    await s.render();
    s.state.mic = { state: "ok", data: true };
    await s.render();
    s.state.notice = { status: "error", is_open: true };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 0);
    // A press that is still waiting is answered by the error.
    s.state.notice = null;
    s.state.queue.push("toggle_mic");
    await s.listener("companion-requested")();
    s.state.mic = { state: "pending", data: true };
    await s.render();
    s.state.notice = { status: "error", is_open: true };
    await s.render();
    assert.equal(s.of("companion_show_main").length, 1);
});

test("a failed start asks for the main window even before the settings arrive", async context => {
    const s = await setup(context);
    s.state.startup = "failed";
    await s.render();
    assert.equal(s.of("companion_show_main").length, 1);
    assert.deepEqual(s.of("companion_set"), []);
});
