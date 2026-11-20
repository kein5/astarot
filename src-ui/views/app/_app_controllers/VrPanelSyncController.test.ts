import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../../../logics/test/hookHarness.ts";
import * as wire from "../../../logics/common/vrPanelWire.ts";
import * as windowFailures from "../../../logics/common/windowFailures.ts";

interface SyncSetup {
    registry?: Record<string, unknown>;
    values?: Record<string, unknown>;
    settings?: unknown[];
    openFailure?: unknown;
}
type Listener = (event?: unknown) => void;
interface InvokeArgs {
    open?: boolean;
    payload?: Record<string, unknown>;
}
type MainFunctionsMemory = { translation: boolean; transcription_send: boolean; transcription_receive: boolean };

async function setup(context: TestContext, { registry = {}, values = {}, settings = [], openFailure = null }: SyncSetup = {}) {
    const runtime = hooks(), lifecycle = hooks(), listeners = new Map<string, Listener>();
    const state = { enabled: true, configOpen: false, mic: true };
    const actions: unknown[][] = [], requests: unknown[][] = [], windows: unknown[] = [], pushes: [string, InvokeArgs][] = [],
        emitted: unknown[][] = [], notices: unknown[][] = [];
    let memory: MainFunctionsMemory = { translation: false, transcription_send: false, transcription_receive: false };
    const common = {
        useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: state.configOpen },
            setIsOpenedConfigPage: (value: boolean) => { state.configOpen = value; } }),
        useNotificationStatus: () => ({ showNotification_Error: (message: string, options: unknown) => notices.push([message, options]) }),
        useVolume: () => ({ currentMicThresholdCheckStatus: { data: false }, currentSpeakerThresholdCheckStatus: { data: false } }),
    };
    const { VrPanelSyncController } = await loadModule<typeof import("./VrPanelSyncController.tsx")>(new URL("./VrPanelSyncController.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { invoke: async (name: string, args: InvokeArgs) => {
            if (name === "set_vr_panel_window") {
                windows.push(args.open);
                if (args.open && openFailure) throw openFailure;
            }
            else pushes.push([name, args]);
            return true;
        } },
        "@tauri-apps/api/event": { emit: async (...args: unknown[]) => emitted.push(args), listen: (name: string, handler: Listener) => {
            listeners.set(name, handler);
            return Promise.resolve(() => { if (listeners.get(name) === handler) listeners.delete(name); });
        } },
        jotai: { getDefaultStore: () => ({ get: (atom: string) => values[atom], sub: () => () => {} }) },
        "@store": { dynamicStoreRegistry: registry },
        "../../../logics/configs/config_page_setter/ui_config_setter": { SETTINGS_ARRAY: settings },
        "@logics_common": common,
        "@logics_configs": { useVr: () => ({ currentIsEnabledOverlayVrPanel: { data: state.enabled } }) },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (...args: unknown[]) => requests.push(args) }) },
        "../../../logics/common/vrPanelWire": wire,
        "../../../logics/common/windowFailures.ts": windowFailures,
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "../../../logics/main/languageMutations": { isLanguageMutation: () => false, rejectLanguageMutation: () => {} },
    });
    const { ConfigPageCloseTriggerController } = await loadModule<typeof import("./ConfigPageCloseTriggerController.tsx")>(new URL("./ConfigPageCloseTriggerController.tsx", import.meta.url), lifecycle, {
        "@logics_common": common,
        "@store": { useStore_MainFunctionsStateMemory: () => ({ currentMainFunctionsStateMemory: { data: memory },
            updateMainFunctionsStateMemory: (value: MainFunctionsMemory) => { memory = value; } }) },
        "@logics_main": { useMainFunction: () => ({
            currentTranslationStatus: { data: false }, currentTranscriptionReceiveStatus: { data: false },
            currentTranscriptionSendStatus: { data: state.mic },
            setTranscriptionSend: (value: boolean, options: unknown) => { actions.push([value, options]); state.mic = value; },
            pendingTranscriptionSendStatus: () => {},
        }) },
    });
    context.onTestFinished(() => { runtime.unmount(); lifecycle.unmount(); });
    const render = () => { runtime.render(VrPanelSyncController); lifecycle.render(ConfigPageCloseTriggerController); };
    // The handler the controller listens with for an event, which the test needs to be there.
    const listener = (name: string) => {
        const handler = listeners.get(name);
        assert.ok(handler, name);
        return handler;
    };
    const config = (value: boolean) => { listener("vr-panel-config-page")({ payload: value }); render(); };
    render();
    return { state, actions, requests, windows, pushes, emitted, notices, listeners, listener, runtime, render, config };
}

// SEC-03: only the listed state goes to the VR panel, through its channel.
test("the VR panel gets the listed state through invoke, and nothing else", async context => {
    const registry = {
        Atom_TranslationStatus: "translation", Atom_VrPanelLayout: "layout", Atom_WebsocketHost: "host",
        Atom_DeepLAuthKey: "key", Atom_Hotkeys: "hotkeys", useStore_TranslationStatus: () => {},
    };
    const values = { translation: { data: true }, layout: { data: {} }, host: { data: "192.168.1.5" },
        key: { data: "secret" }, hotkeys: { data: {} } };
    const settings = [{ Category: "Vr", Base_Name: "VrPanelLayout" }, { Category: "AdvancedSettings", Base_Name: "WebsocketHost" },
        { Category: "Translation", Base_Name: "DeepLAuthKey" }];
    const view = await setup(context, { registry, values, settings });
    assert.equal(view.pushes.length, 1);
    const [name, { payload }] = view.pushes[0];
    assert.equal(name, "vr_panel_state_push");
    assert.ok(payload);
    assert.deepEqual(Object.keys(payload).sort(), ["TranslationStatus", "VrPanelLayout"]);
    assert.deepEqual(view.emitted, []); // nothing goes out as an event any more
    view.listener("vr-panel-ready")();
    assert.equal(view.pushes.length, 2);
});

test("recreating the VR panel leaves settings open and microphone paused", async context => {
    const view = await setup(context);
    view.config(true);
    assert.equal(view.state.mic, false);
    view.state.enabled = false;
    view.render();
    await Promise.resolve();
    view.state.enabled = true;
    view.render();
    view.config(false); // The new panel starts with no popup.
    assert.equal(view.state.configOpen, true);
    assert.equal(view.state.mic, false);
    assert.deepEqual(view.actions, [[false, { reason: "settings_pause" }]]);
    assert.deepEqual(view.windows, [true, false, true]);
    view.listener("vr-panel-stdout")({ payload: { path: "/set/enable/transcription_send" } });
    assert.deepEqual(view.requests, []); // The old panel no longer owns the pause.
});

// SEC-02 and SEC-07: only listed requests are relayed, and each is marked for the backend's own check.
test("the VR panel's requests are relayed marked as its own, and unlisted ones are dropped", async context => {
    const view = await setup(context);
    const relay = view.listener("vr-panel-stdout");
    relay({ payload: { path: "/set/enable/translation" } });
    relay({ payload: { path: "/set/data/overlay_vr_panel_opacity", value: 0.8 } });
    for (const path of ["/set/enable/telemetry", "/set/data/telemetry_notice", "/set/data/deepl_auth_key",
        "/run/shutdown", "/set/data/a_setting_added_later"]) relay({ payload: { path, value: { send: true } } });
    assert.deepEqual(view.requests, [
        ["/set/enable/translation", undefined, undefined, "vr_panel"],
        ["/set/data/overlay_vr_panel_opacity", 0.8, undefined, "vr_panel"],
    ]);
});

for (const dispose of ["disable", "unmount"]) {
    test(`late callbacks after ${dispose} cannot reacquire settings ownership`, async context => {
        const view = await setup(context);
        view.config(true);
        const oldConfig = view.listener("vr-panel-config-page");
        const oldStdout = view.listener("vr-panel-stdout");
        if (dispose === "disable") {
            view.state.enabled = false;
            view.render();
        } else view.runtime.unmount();
        // Unlisten is asynchronous; callbacks may already be queued.
        oldConfig({ payload: false });
        view.state.configOpen = false;
        oldConfig({ payload: true });
        assert.equal(view.state.configOpen, false);
        oldStdout({ payload: { path: "/set/enable/transcription_send" } });
        assert.deepEqual(view.requests, []);
        assert.equal(view.state.mic, false);
    });
}

test("a live panel closes its own settings and restores the microphone", async context => {
    const view = await setup(context);
    view.config(true);
    view.config(false);
    assert.equal(view.state.configOpen, false);
    assert.equal(view.state.mic, true);
    assert.deepEqual(view.actions, [[false, { reason: "settings_pause" }], [true, { reason: "settings_resume" }]]);
});

test("a live panel cannot close settings first opened on the desktop", async context => {
    const view = await setup(context);
    view.state.configOpen = true;
    view.render();
    view.config(true);
    view.config(false);
    assert.equal(view.state.configOpen, true);
    assert.equal(view.state.mic, false);
});

test("a VR panel window that cannot be opened is said once, and turning it off says nothing", async context => {
    const view = await setup(context, { openFailure: "vr_panel_surface_unavailable" });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(view.notices, [["common_error.window.vr_panel_surface_unavailable", { category_id: "vr_panel_open_failed" }]]);
    view.state.enabled = false;
    view.render();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.notices.length, 1);
    const other = await setup(context, { openFailure: "Os { code: 1400 }" });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(other.notices, [["common_error.window.vr_panel_open_failed", { category_id: "vr_panel_open_failed" }]]);
});
